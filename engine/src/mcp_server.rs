//! EncoreHub MCP Server
//!
//! Implements the Model Context Protocol (MCP) over stdio using JSON-RPC 2.0.
//! Exposes EncoreHub tools to any MCP-compatible AI client.
//!
//! Usage: encorehub-mcp
//!   Reads JSON-RPC requests from stdin, writes responses to stdout.
//!   Logs go to stderr.

use encorehub_storage::Database;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};

// ===== JSON-RPC 2.0 Types =====

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
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

// ===== Main =====

fn main() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    let reader = BufReader::new(stdin.lock());

    let db = Database::open_and_return("data/encorehub.db")
        .expect("Failed to open database");

    eprintln!("EncoreHub MCP Server v0.1.0 ready");

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        if line.trim().is_empty() {
            continue;
        }

        let req: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                write_error(&mut stdout, None, -32700, &e.to_string());
                continue;
            }
        };

        let id = req.id.clone();
        let response = handle_request(&req, &db);

        writeln!(stdout, "{}", serde_json::to_string(&response).unwrap()).unwrap();
        stdout.flush().unwrap();
    }
}

fn handle_request(req: &JsonRpcRequest, db: &Database) -> JsonRpcResponse {
    match req.method.as_str() {
        "initialize" => handle_initialize(req),
        "tools/list" => handle_tools_list(req),
        "tools/call" => handle_tools_call(req, db),
        "notifications/initialized" => JsonRpcResponse {
            jsonrpc: "2.0".into(),
            id: req.id.clone(),
            result: Some(serde_json::json!({})),
            error: None,
        },
        _ => {
            let mut resp = JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id: req.id.clone(),
                result: None,
                error: Some(JsonRpcError {
                    code: -32601,
                    message: format!("Method not found: {}", req.method),
                }),
            };
            resp
        }
    }
}

fn handle_initialize(req: &JsonRpcRequest) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".into(),
        id: req.id.clone(),
        result: Some(serde_json::to_value(InitializeResult {
            protocol_version: "2024-11-05".into(),
            capabilities: ServerCapabilities {
                tools: ToolListCapability { list_changed: false },
            },
            server_info: ServerInfo {
                name: "EncoreHub MCP Server".into(),
                version: "0.1.0".into(),
            },
        }).unwrap()),
        error: None,
    }
}

fn handle_tools_list(req: &JsonRpcRequest) -> JsonRpcResponse {
    let tools = vec![
        Tool {
            name: "search_knowledge".into(),
            description: "Search the knowledge base for relevant documents and chunks".into(),
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
            description: "Search conversation memories (both conversation-scoped and global)".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search query" },
                    "scope": { "type": "string", "enum": ["conversation", "global"] }
                },
                "required": ["query"]
            }),
        },
        Tool {
            name: "web_search".into(),
            description: "Search the web using DuckDuckGo (free, no API key required)".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search query" },
                    "max_results": { "type": "integer", "default": 5 }
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

    JsonRpcResponse {
        jsonrpc: "2.0".into(),
        id: req.id.clone(),
        result: Some(serde_json::json!({ "tools": tools })),
        error: None,
    }
}

fn handle_tools_call(req: &JsonRpcRequest, db: &Database) -> JsonRpcResponse {
    let params: ToolCallParams = match req.params.as_ref().and_then(|p| serde_json::from_value(p.clone()).ok()) {
        Some(p) => p,
        None => {
            return JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id: req.id.clone(),
                result: None,
                error: Some(JsonRpcError { code: -32602, message: "Invalid params".into() }),
            };
        }
    };

    let result = match params.name.as_str() {
        "search_knowledge" => {
            let query = params.arguments.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let top_k = params.arguments.get("top_k").and_then(|v| v.as_i64()).unwrap_or(5);
            match db.search_chunks_fts(query, top_k) {
                Ok(chunks) => serde_json::to_value(
                    chunks.iter().map(|(c, score)| serde_json::json!({
                        "content": c.content,
                        "document_id": c.document_id,
                        "score": score,
                    })).collect::<Vec<_>>()
                ).unwrap_or_default(),
                Err(e) => serde_json::json!({"error": e.to_string()}),
            }
        }
        "search_memory" => {
            let query = params.arguments.get("query").and_then(|v| v.as_str()).unwrap_or("");
            match db.search_memories_fts(query, None, 5) {
                Ok(memories) => serde_json::to_value(
                    memories.iter().map(|m| serde_json::json!({
                        "content": m.content,
                        "scope": m.scope.as_str(),
                        "importance": m.importance,
                    })).collect::<Vec<_>>()
                ).unwrap_or_default(),
                Err(e) => serde_json::json!({"error": e.to_string()}),
            }
        }
        "web_search" => {
            let query = params.arguments.get("query").and_then(|v| v.as_str()).unwrap_or("");
            // For now, return a note that web search is done via the gateway
            serde_json::json!({
                "message": format!("Web search for '{}' would be performed via the gateway's DuckDuckGo integration. Use the /api/v1/search endpoint.", query)
            })
        }
        "list_skills" => {
            serde_json::json!({
                "skills": [
                    {"name": "web-search", "description": "Search the web using DuckDuckGo", "triggers": ["search for", "look up", "@web"]},
                    {"name": "code-explainer", "description": "Explain code snippets", "triggers": ["explain this code", "what does this code do", "@explain"]}
                ]
            })
        }
        _ => {
            return JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id: req.id.clone(),
                result: None,
                error: Some(JsonRpcError { code: -32602, message: format!("Unknown tool: {}", params.name) }),
            };
        }
    };

    JsonRpcResponse {
        jsonrpc: "2.0".into(),
        id: req.id.clone(),
        result: Some(serde_json::json!({
            "content": [{ "type": "text", "text": serde_json::to_string(&result).unwrap() }]
        })),
        error: None,
    }
}

fn write_error(stdout: &mut dyn Write, id: Option<Value>, code: i32, message: &str) {
    let resp = JsonRpcResponse {
        jsonrpc: "2.0".into(),
        id,
        result: None,
        error: Some(JsonRpcError {
            code,
            message: message.to_string(),
        }),
    };
    writeln!(stdout, "{}", serde_json::to_string(&resp).unwrap()).unwrap();
    stdout.flush().unwrap();
}
