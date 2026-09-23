//! EncoreHub MCP Server
//!
//! Implements the Model Context Protocol (MCP) over stdio using JSON-RPC 2.0,
//! exposing EncoreHub's knowledge base and memories to any MCP-compatible AI
//! client. The server reads requests from stdin, writes responses to stdout,
//! and sends diagnostics to stderr so the protocol stream stays clean.
//!
//! Retrieval matches the desktop app: the FTS5 and SQLite-Vec routes are fused
//! with reciprocal rank fusion. LanceDB is intentionally not opened here — the
//! MCP process is a separate short-lived child that only needs SQLite, and the
//! SQLite-Vec index is always written before LanceDB, so recall is preserved.
//!
//! Configuration comes from CLI flags first, then environment variables, so an
//! MCP client config can pin explicit paths without inheriting a shell:
//!   `--db <path>`            or `ENGINE_DB`
//!   `--skills-dir <path>`    or `ENCOREHUB_SKILLS_DIR`
//!
//! Only compiled with the `standalone` feature (see `Cargo.toml`).
#![cfg(feature = "standalone")]

use encorehub_core::{DocumentChunk, Memory};
use encorehub_skill::SkillRegistry;
use encorehub_storage::{reciprocal_rank_fusion, Database, RRF_K};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

/// Fallback data path, matching the standalone Engine's default.
const DEFAULT_DB_PATH: &str = "data/encorehub.db";

/// MCP protocol revision this server implements when the client proposes
/// nothing newer; a client-proposed version is echoed for compatibility.
const DEFAULT_PROTOCOL_VERSION: &str = "2024-11-05";

// ===== Server configuration =====

/// Resolved runtime configuration for one MCP server process.
#[derive(Debug, Clone)]
struct ServerConfig {
    db_path: PathBuf,
    skills_dir: PathBuf,
}

/// Parse CLI flags over environment defaults.
///
/// The skills directory defaults next to the database so a copied client
/// config with only `--db` still resolves a stable location.
fn parse_args(args: impl Iterator<Item = String>) -> ServerConfig {
    let mut db = std::env::var("ENGINE_DB").unwrap_or_else(|_| DEFAULT_DB_PATH.to_string());
    let mut skills = std::env::var("ENCOREHUB_SKILLS_DIR").unwrap_or_default();

    let mut args = args.peekable();
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--db" => {
                if let Some(value) = args.next() {
                    db = value;
                }
            }
            "--skills-dir" => {
                if let Some(value) = args.next() {
                    skills = value;
                }
            }
            // Unknown flags are ignored so future clients can pass extras.
            _ => {}
        }
    }

    let db_path = PathBuf::from(db);
    let skills_dir = if skills.is_empty() {
        db_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("skills")
    } else {
        PathBuf::from(skills)
    };
    ServerConfig {
        db_path,
        skills_dir,
    }
}

// ===== JSON-RPC 2.0 Types =====

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)] // part of the JSON-RPC wire shape; deserialized, not read
    jsonrpc: String,
    /// Absent for notifications, which must never receive a response.
    #[serde(default)]
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

impl JsonRpcResponse {
    /// Successful response for one request id.
    fn result(id: Option<Value>, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: Some(result),
            error: None,
        }
    }

    /// Error response for one request id.
    fn error(id: Option<Value>, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.into(),
            }),
        }
    }
}

// ===== MCP Protocol Types =====

#[derive(Debug, Serialize)]
struct ServerCapabilities {
    tools: ToolListCapability,
}

#[derive(Debug, Serialize)]
struct ToolListCapability {
    #[serde(rename = "listChanged")]
    list_changed: bool,
}

#[derive(Debug, Serialize)]
struct InitializeResult {
    #[serde(rename = "protocolVersion")]
    protocol_version: String,
    capabilities: ServerCapabilities,
    #[serde(rename = "serverInfo")]
    server_info: ServerInfo,
}

#[derive(Debug, Serialize)]
struct ServerInfo {
    name: String,
    version: String,
}

#[derive(Debug, Serialize)]
struct Tool {
    name: String,
    description: String,
    #[serde(rename = "inputSchema")]
    input_schema: Value,
}

#[derive(Debug, Deserialize)]
struct ToolCallParams {
    name: String,
    #[serde(default)]
    arguments: Value,
}

// ===== Server loop =====

/// Run the JSON-RPC loop until the input stream ends.
///
/// One line is one JSON-RPC message. Protocol errors are answered with a null
/// id (JSON-RPC parse-error rule) and never terminate the loop, so a malformed
/// message from one client does not take the session down.
fn serve<R: BufRead, W: Write>(reader: R, mut writer: W, db: &Database, skills: &SkillRegistry) {
    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }

        let request: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => {
                let response = JsonRpcResponse::error(None, -32700, error.to_string());
                let _ = writeln!(writer, "{}", serde_json::to_string(&response).unwrap());
                let _ = writer.flush();
                continue;
            }
        };

        // Notifications (no id) are fire-and-forget by JSON-RPC contract.
        if let Some(response) = handle_request(&request, db, skills) {
            let _ = writeln!(writer, "{}", serde_json::to_string(&response).unwrap());
            let _ = writer.flush();
        }
    }
}

/// Dispatch one request; `None` means the message was a notification.
fn handle_request(
    request: &JsonRpcRequest,
    db: &Database,
    skills: &SkillRegistry,
) -> Option<JsonRpcResponse> {
    let id = request.id.clone();
    let response = match request.method.as_str() {
        "initialize" => handle_initialize(request),
        "tools/list" => handle_tools_list(request),
        "tools/call" => handle_tools_call(request, db, skills),
        // MCP clients send initialized/other notifications; acknowledge by
        // staying silent, as required for messages without an id.
        _ if id.is_none() => return None,
        _ => JsonRpcResponse::error(id, -32601, format!("Method not found: {}", request.method)),
    };
    Some(response)
}

/// Handle `initialize`, echoing the client's proposed protocol version.
fn handle_initialize(request: &JsonRpcRequest) -> JsonRpcResponse {
    let proposed = request
        .params
        .as_ref()
        .and_then(|params| params.get("protocolVersion"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_PROTOCOL_VERSION);
    let version = encorehub_engine::version::current();
    let display = match version.build_id {
        Some(build_id) => format!("{} (Build {})", version.version, build_id),
        None => version.version,
    };

    JsonRpcResponse::result(
        request.id.clone(),
        serde_json::to_value(InitializeResult {
            protocol_version: proposed.to_string(),
            capabilities: ServerCapabilities {
                tools: ToolListCapability {
                    list_changed: false,
                },
            },
            server_info: ServerInfo {
                name: "EncoreHub MCP Server".into(),
                version: display,
            },
        })
        .unwrap(),
    )
}

/// Advertise the tools backed by local Engine data.
fn handle_tools_list(request: &JsonRpcRequest) -> JsonRpcResponse {
    let tools = vec![
        Tool {
            name: "search_knowledge".into(),
            description: "Search the EncoreHub knowledge base (hybrid FTS + vector retrieval)"
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search query" },
                    "top_k": { "type": "integer", "default": 5 }
                },
                "required": ["query"]
            }),
        },
        Tool {
            name: "search_memory".into(),
            description: "Search EncoreHub memories (hybrid FTS + vector retrieval)".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search query" },
                    "scope": { "type": "string", "enum": ["conversation", "global"] },
                    "top_k": { "type": "integer", "default": 5 }
                },
                "required": ["query"]
            }),
        },
        Tool {
            name: "list_skills".into(),
            description: "List available EncoreHub skills and their triggers".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        },
    ];

    JsonRpcResponse::result(request.id.clone(), serde_json::json!({ "tools": tools }))
}

/// Execute one tool call and wrap the payload in an MCP text content block.
fn handle_tools_call(
    request: &JsonRpcRequest,
    db: &Database,
    skills: &SkillRegistry,
) -> JsonRpcResponse {
    let id = request.id.clone();
    let params: ToolCallParams = match request
        .params
        .as_ref()
        .and_then(|params| serde_json::from_value(params.clone()).ok())
    {
        Some(params) => params,
        None => return JsonRpcResponse::error(id, -32602, "Invalid params"),
    };

    let result = match params.name.as_str() {
        "search_knowledge" => search_knowledge(db, &params.arguments),
        "search_memory" => search_memory(db, &params.arguments),
        "list_skills" => list_skills(skills),
        other => {
            return JsonRpcResponse::error(id, -32602, format!("Unknown tool: {other}"));
        }
    };

    // MCP tool results are content blocks; the JSON payload travels as text so
    // any client can render it without a second schema negotiation.
    JsonRpcResponse::result(
        id,
        serde_json::json!({
            "content": [{ "type": "text", "text": serde_json::to_string(&result).unwrap() }]
        }),
    )
}

// ===== Tool implementations =====

/// Read a required string argument, defaulting to empty (FTS treats an empty
/// literal query as "no results", which is the honest answer).
fn string_argument(arguments: &Value, key: &str) -> String {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// Read a bounded positive limit argument.
fn limit_argument(arguments: &Value, default: i64) -> i64 {
    arguments
        .get("top_k")
        .and_then(Value::as_i64)
        .filter(|value| *value > 0)
        .unwrap_or(default)
        .min(50)
}

/// Hybrid knowledge search over the SQLite-Vec and FTS5 chunk indexes.
fn search_knowledge(db: &Database, arguments: &Value) -> Value {
    let query = string_argument(arguments, "query");
    let top_k = limit_argument(arguments, 5);

    let vector_hits = match db.search_knowledge_vectors(&query, top_k) {
        Ok(hits) => hits.into_iter().map(|hit| hit.item).collect::<Vec<_>>(),
        Err(error) => return serde_json::json!({ "error": error.to_string() }),
    };
    let lexical_hits = match db.search_chunks_fts(&query, top_k) {
        Ok(hits) => hits
            .into_iter()
            .map(|(chunk, _rank)| chunk)
            .collect::<Vec<DocumentChunk>>(),
        Err(error) => return serde_json::json!({ "error": error.to_string() }),
    };

    let fused = reciprocal_rank_fusion(
        &[&vector_hits, &lexical_hits],
        |chunk| chunk.id.as_str(),
        RRF_K,
    );
    // Normalize so the leading hit reports relevance 1.0, matching the app.
    let top_score = fused.first().map(|(_, score)| *score).unwrap_or(1.0);
    serde_json::json!(fused
        .into_iter()
        .take(top_k as usize)
        .map(|(chunk, score)| {
            serde_json::json!({
                "content": chunk.content,
                "document_id": chunk.document_id,
                "score": if top_score > 0.0 { score / top_score } else { 0.0 },
            })
        })
        .collect::<Vec<_>>())
}

/// Hybrid memory search across the SQLite-Vec and FTS5 memory indexes.
///
/// The external client has no character context, so group scoping stays open
/// (the same behavior as an unscoped Engine API search).
fn search_memory(db: &Database, arguments: &Value) -> Value {
    let query = string_argument(arguments, "query");
    let top_k = limit_argument(arguments, 5);

    let vector_hits = match db.search_memory_vectors_for_groups(&query, None, None, top_k) {
        Ok(hits) => hits.into_iter().map(|hit| hit.item).collect::<Vec<_>>(),
        Err(error) => return serde_json::json!({ "error": error.to_string() }),
    };
    let lexical_hits = match db.search_memories_fts(&query, None, top_k) {
        Ok(memories) => memories,
        Err(error) => return serde_json::json!({ "error": error.to_string() }),
    };

    let fused = reciprocal_rank_fusion(
        &[&vector_hits, &lexical_hits],
        |memory| memory.id.as_str(),
        RRF_K,
    );
    serde_json::json!(fused
        .into_iter()
        .take(top_k as usize)
        .map(|(memory, _score)| memory_summary(&memory))
        .collect::<Vec<_>>())
}

/// Project one memory into the fields an external client needs.
fn memory_summary(memory: &Memory) -> Value {
    serde_json::json!({
        "content": memory.content,
        "scope": memory.scope.as_str(),
        "importance": memory.importance,
    })
}

/// List the skills actually loaded from the configured skills directory.
fn list_skills(skills: &SkillRegistry) -> Value {
    serde_json::json!(skills
        .list()
        .into_iter()
        .map(|skill| {
            serde_json::json!({
                "name": skill.name,
                "description": skill.description,
                "triggers": skill.triggers,
            })
        })
        .collect::<Vec<_>>())
}

// ===== Entry point =====

fn main() {
    let config = parse_args(std::env::args().skip(1));
    let db = Database::open_and_return(&config.db_path).unwrap_or_else(|error| {
        eprintln!(
            "EncoreHub MCP Server failed to open {}: {error}",
            config.db_path.display()
        );
        std::process::exit(1);
    });
    let skills = SkillRegistry::load(&config.skills_dir);

    eprintln!(
        "EncoreHub MCP Server ready (db={}, skills={})",
        config.db_path.display(),
        config.skills_dir.display()
    );

    let stdin = std::io::stdin();
    serve(
        BufReader::new(stdin.lock()),
        std::io::stdout().lock(),
        &db,
        &skills,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// Open a throwaway database in a temp directory.
    fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let db = Database::open_and_return(dir.path().join("mcp.db")).expect("open db");
        (dir, db)
    }

    /// Build a request from its JSON wire form.
    fn request(json: &str) -> JsonRpcRequest {
        serde_json::from_str(json).expect("request json")
    }

    #[test]
    fn parse_args_prefers_flags_over_environment() {
        let config = parse_args(
            ["--db", "/tmp/custom.db", "--skills-dir", "/tmp/skills"]
                .into_iter()
                .map(String::from),
        );
        assert_eq!(config.db_path, PathBuf::from("/tmp/custom.db"));
        assert_eq!(config.skills_dir, PathBuf::from("/tmp/skills"));
    }

    #[test]
    fn parse_args_defaults_skills_next_to_database() {
        let config = parse_args(std::iter::empty::<String>());
        assert_eq!(
            config.skills_dir,
            config.db_path.parent().unwrap().join("skills")
        );
    }

    #[test]
    fn initialize_echoes_the_client_protocol_version() {
        let (_dir, db) = test_db();
        let skills = SkillRegistry::load("/nonexistent-skills");
        let response = handle_request(
            &request(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}"#),
            &db,
            &skills,
        )
        .expect("initialize must answer");

        let result = response.result.expect("initialize result");
        assert_eq!(result["protocolVersion"], "2025-03-26");
        assert_eq!(result["serverInfo"]["name"], "EncoreHub MCP Server");
        assert!(
            result["serverInfo"]["version"]
                .as_str()
                .unwrap()
                .contains("Build"),
            "serverInfo must carry the Build ID: {result:?}"
        );
    }

    #[test]
    fn tools_list_advertises_the_three_local_tools() {
        let (_dir, db) = test_db();
        let skills = SkillRegistry::load("/nonexistent-skills");
        let response = handle_request(
            &request(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#),
            &db,
            &skills,
        )
        .expect("tools/list must answer");

        let result = response.result.expect("tools result");
        let names: Vec<&str> = result["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["search_knowledge", "search_memory", "list_skills"]);
    }

    #[test]
    fn tool_calls_return_text_content_and_handle_empty_indexes() {
        let (_dir, db) = test_db();
        let skills = SkillRegistry::load("/nonexistent-skills");
        for (id, tool) in [(3, "search_knowledge"), (4, "search_memory")] {
            let call = format!(
                r#"{{"jsonrpc":"2.0","id":{id},"method":"tools/call","params":{{"name":"{tool}","arguments":{{"query":"anything"}}}}}}"#
            );
            let response = handle_request(&request(&call), &db, &skills).expect("tool answer");
            let result = response.result.expect("tool result");
            assert_eq!(result["content"][0]["type"], "text");
            assert_eq!(result["content"][0]["text"], "[]");
        }
    }

    #[test]
    fn list_skills_uses_the_loaded_registry() {
        let (_dir, db) = test_db();
        let skills = SkillRegistry::load("/nonexistent-skills");
        let response = handle_request(
            &request(
                r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"list_skills"}}"#,
            ),
            &db,
            &skills,
        )
        .expect("tool answer");

        let result = response.result.expect("tool result");
        // A missing skills directory is an empty list, never a hardcoded one.
        assert_eq!(result["content"][0]["text"], "[]");
    }

    #[test]
    fn notifications_never_receive_a_response() {
        let (_dir, db) = test_db();
        let skills = SkillRegistry::load("/nonexistent-skills");
        for notification in [
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            r#"{"jsonrpc":"2.0","method":"some/future/notification"}"#,
        ] {
            assert!(
                handle_request(&request(notification), &db, &skills).is_none(),
                "notification must stay silent: {notification}"
            );
        }
    }

    #[test]
    fn unknown_methods_and_tools_are_reported_as_errors() {
        let (_dir, db) = test_db();
        let skills = SkillRegistry::load("/nonexistent-skills");
        let unknown_method = handle_request(
            &request(r#"{"jsonrpc":"2.0","id":6,"method":"resources/list"}"#),
            &db,
            &skills,
        )
        .expect("error answer");
        assert_eq!(unknown_method.error.unwrap().code, -32601);

        let unknown_tool = handle_request(
            &request(r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"nope"}}"#),
            &db,
            &skills,
        )
        .expect("error answer");
        assert_eq!(unknown_tool.error.unwrap().code, -32602);
    }

    #[test]
    fn serve_answers_good_lines_and_survives_malformed_json() {
        let (_dir, db) = test_db();
        let skills = SkillRegistry::load("/nonexistent-skills");
        let input = concat!(
            "{not json}\n",
            "\n",
            r#"{"jsonrpc":"2.0","id":8,"method":"tools/list"}"#,
            "\n",
        );

        let mut output = Vec::new();
        serve(Cursor::new(input), &mut output, &db, &skills);
        let lines: Vec<serde_json::Value> = String::from_utf8(output)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();

        // One parse error (null id) plus one tools/list result; blank lines
        // and notifications produce nothing.
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["error"]["code"], -32700);
        assert!(lines[0]["id"].is_null());
        assert_eq!(lines[1]["id"], 8);
        assert!(lines[1]["result"]["tools"].is_array());
    }
}
