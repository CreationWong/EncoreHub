//! Conversation API handlers.

use crate::api::SharedState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use encorehub_core::{Conversation, Memory, MemoryScope, MemoryType, Message, Role, ToolCall};
use serde::{Deserialize, Serialize};

// ===== Request / Response types =====

#[derive(Debug, Deserialize)]
pub struct CreateConversationRequest {
    #[serde(default = "default_title")]
    pub title: String,
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default = "default_model")]
    pub model: String,
}

fn default_title() -> String {
    "New Chat".into()
}
fn default_provider() -> String {
    "openai".into()
}
fn default_model() -> String {
    "gpt-4o".into()
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct ConversationResponse {
    pub id: String,
    pub title: String,
    pub provider: String,
    pub model: String,
    pub message_count: usize,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct ConversationDetail {
    pub id: String,
    pub title: String,
    pub provider: String,
    pub model: String,
    pub messages: Vec<MessageResponse>,
    pub summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct MessageResponse {
    pub id: String,
    pub role: String,
    pub content: String,
    pub parent_id: Option<String>,
    pub tool_calls: Vec<ToolCallResponse>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ToolCallResponse {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Serialize)]
pub struct ListResponse {
    pub conversations: Vec<ConversationResponse>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
pub struct SendMessageResponse {
    pub user_message: MessageResponse,
    pub assistant_message: MessageResponse,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

// ===== Handlers =====

pub async fn create(
    State(state): State<SharedState>,
    Json(req): Json<CreateConversationRequest>,
) -> Result<Json<ConversationResponse>, (StatusCode, Json<ErrorResponse>)> {
    let conv = Conversation::new(&req.title, &req.provider, &req.model);
    state
        .db
        .create_conversation(&conv)
        .map_err(internal_error)?;

    Ok(Json(ConversationResponse {
        id: conv.id,
        title: conv.title,
        provider: conv.provider,
        model: conv.model,
        message_count: 0,
        created_at: conv.created_at.to_rfc3339(),
        updated_at: conv.updated_at.to_rfc3339(),
    }))
}

pub async fn list(
    State(state): State<SharedState>,
) -> Result<Json<ListResponse>, (StatusCode, Json<ErrorResponse>)> {
    let conversations = state
        .db
        .list_conversations(100, 0)
        .map_err(internal_error)?;

    let total = conversations.len();
    let items: Vec<ConversationResponse> = conversations
        .into_iter()
        .map(|c| {
            // Count messages for each conversation
            let count = state
                .db
                .get_messages(&c.id)
                .map(|msgs| msgs.len())
                .unwrap_or(0);
            ConversationResponse {
                id: c.id,
                title: c.title,
                provider: c.provider,
                model: c.model,
                message_count: count,
                created_at: c.created_at.to_rfc3339(),
                updated_at: c.updated_at.to_rfc3339(),
            }
        })
        .collect();

    Ok(Json(ListResponse {
        conversations: items,
        total,
    }))
}

pub async fn get_one(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<ConversationDetail>, (StatusCode, Json<ErrorResponse>)> {
    let conv = state.db.get_conversation(&id).map_err(not_found)?;
    let messages = state.db.get_messages(&id).map_err(internal_error)?;
    let summary = state
        .db
        .get_latest_summary(&id)
        .map_err(internal_error)?
        .map(|s| s.summary_text);

    let message_responses: Vec<MessageResponse> = messages
        .into_iter()
        .map(|m| {
            let tool_calls = state
                .db
                .get_tool_calls(&m.id)
                .unwrap_or_default()
                .into_iter()
                .map(|tc| ToolCallResponse {
                    id: tc.id,
                    name: tc.name,
                    arguments: tc.arguments,
                })
                .collect();

            MessageResponse {
                id: m.id,
                role: m.role.as_str().to_string(),
                content: m.content,
                parent_id: m.parent_id,
                tool_calls,
                created_at: m.created_at.to_rfc3339(),
            }
        })
        .collect();

    Ok(Json(ConversationDetail {
        id: conv.id,
        title: conv.title,
        provider: conv.provider,
        model: conv.model,
        messages: message_responses,
        summary,
        created_at: conv.created_at.to_rfc3339(),
        updated_at: conv.updated_at.to_rfc3339(),
    }))
}

pub async fn delete(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    state.db.delete_conversation(&id).map_err(internal_error)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct UpdateRequest {
    pub title: String,
}

pub async fn update(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateRequest>,
) -> Result<Json<ConversationResponse>, (StatusCode, Json<ErrorResponse>)> {
    let title = req.title.trim();
    if title.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "title cannot be empty".into(),
            }),
        ));
    }
    state
        .db
        .update_conversation_title(&id, title)
        .map_err(internal_error)?;
    let conv = state.db.get_conversation(&id).map_err(not_found)?;
    Ok(Json(ConversationResponse {
        id: conv.id,
        title: conv.title,
        provider: conv.provider,
        model: conv.model,
        message_count: 0,
        created_at: conv.created_at.to_rfc3339(),
        updated_at: conv.updated_at.to_rfc3339(),
    }))
}

pub async fn get_messages(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<MessageResponse>>, (StatusCode, Json<ErrorResponse>)> {
    let messages = state.db.get_messages(&id).map_err(internal_error)?;

    let responses: Vec<MessageResponse> = messages
        .into_iter()
        .map(|m| {
            let tool_calls = state
                .db
                .get_tool_calls(&m.id)
                .unwrap_or_default()
                .into_iter()
                .map(|tc| ToolCallResponse {
                    id: tc.id,
                    name: tc.name,
                    arguments: tc.arguments,
                })
                .collect();

            MessageResponse {
                id: m.id,
                role: m.role.as_str().to_string(),
                content: m.content,
                parent_id: m.parent_id,
                tool_calls,
                created_at: m.created_at.to_rfc3339(),
            }
        })
        .collect();

    Ok(Json(responses))
}

#[derive(Debug, Deserialize)]
pub struct AddMessageRequest {
    pub content: String,
    pub role: String,
    #[serde(default)]
    pub parent_id: Option<String>,
}

/// Store a message without generating a reply.
/// Used by the Go gateway when it handles the AI call itself.
pub async fn add_message(
    State(state): State<SharedState>,
    Path(conv_id): Path<String>,
    Json(req): Json<AddMessageRequest>,
) -> Result<Json<MessageResponse>, (StatusCode, Json<ErrorResponse>)> {
    let _conv = state.db.get_conversation(&conv_id).map_err(not_found)?;
    let role = Role::from_str(&req.role).unwrap_or(Role::User);
    let msg = Message::new(&conv_id, role, &req.content, req.parent_id);
    state.db.append_message(&msg).map_err(internal_error)?;

    Ok(Json(build_msg_response(&msg, &[])))
}

/// Send a message and get a mock AI reply.
///
/// **Dev-only.** This is a placeholder kept for engine smoke tests; in
/// production the Go gateway handles the AI call and writes both messages via
/// `add_message`. Returns 503 unless `ENCOREHUB_DEV_MOCK=1` is set.
pub async fn send_message(
    State(state): State<SharedState>,
    Path(conv_id): Path<String>,
    Json(req): Json<SendMessageRequest>,
) -> Result<Json<SendMessageResponse>, (StatusCode, Json<ErrorResponse>)> {
    let mock_enabled = std::env::var("ENCOREHUB_DEV_MOCK")
        .map(|v| v == "1" || v == "true")
        .unwrap_or(false);
    if !mock_enabled {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                error: "engine mock chat is disabled; route chat through the gateway. \
                        Set ENCOREHUB_DEV_MOCK=1 to enable for local testing."
                    .into(),
            }),
        ));
    }

    // Verify conversation exists
    let _conv = state.db.get_conversation(&conv_id).map_err(not_found)?;

    // 1. Store user message
    let user_msg = Message::new(&conv_id, Role::User, &req.content, None);
    state.db.append_message(&user_msg).map_err(internal_error)?;

    // 2. Get conversation context for mock reply
    let messages = state.db.get_messages(&conv_id).map_err(internal_error)?;

    // 3. Generate mock AI reply (echo with context awareness)
    let mock_reply = generate_mock_reply(&req.content, &messages);

    let assistant_msg = Message::new(
        &conv_id,
        Role::Assistant,
        &mock_reply,
        Some(user_msg.id.clone()),
    );
    state
        .db
        .append_message(&assistant_msg)
        .map_err(internal_error)?;

    // 4. If this is the 2nd message (first user+assistant pair), auto-title
    if messages.len() <= 1 {
        let title = generate_title(&req.content);
        let _ = state.db.update_conversation_title(&conv_id, &title);
    }

    // 5. Consolidate conversation memory (store summary to global memory)
    maybe_consolidate_memory(&state, &conv_id, &req.content, &mock_reply);

    Ok(Json(SendMessageResponse {
        user_message: build_msg_response(&user_msg, &[]),
        assistant_message: build_msg_response(&assistant_msg, &[]),
    }))
}

// ===== Mock AI Logic (placeholder until Go gateway is ready) =====

fn generate_mock_reply(user_input: &str, history: &[Message]) -> String {
    let input_lower = user_input.to_lowercase();

    if input_lower.contains("hello") || input_lower.contains("hi") || input_lower.contains("你好")
    {
        return format!(
            "Hello! I'm EncoreHub's assistant (currently in mock mode). \
             You have {} messages in this conversation. \
             How can I help you today?",
            history.len()
        );
    }

    if input_lower.contains("who are you") || input_lower.contains("你是谁") {
        return "I'm EncoreHub, a multi-provider AI chat client. \
                I'm currently running in mock mode — the real AI backends \
                (OpenAI, Anthropic, Gemini, etc.) will be wired up soon via the Go gateway. \
                Right now I can store and retrieve conversations using SQLite!"
            .into();
    }

    if input_lower.contains("memory") || input_lower.contains("记忆") {
        return format!(
            "**Memory System Status**\n\n\
             - Conversation memory: active ({} messages stored in SQLite)\n\
             - Global memory: schema ready, LanceDB pending\n\
             - FTS5 full-text search: enabled\n\
             - Memory consolidation: runs after each user-assistant pair\n\n\
             Your messages are being persisted and will be searchable!",
            history.len()
        );
    }

    if input_lower.contains("help") || input_lower.contains("帮助") {
        return "**EncoreHub Commands**\n\n\
                - `hello` — greeting\n\
                - `who are you` — about EncoreHub\n\
                - `memory` — memory system status\n\
                - `help` — this message\n\
                - Anything else — I'll echo back with context\n\n\
                *More commands coming as features are added!*"
            .into();
    }

    // Default: context-aware echo
    format!(
        "[Mock AI Reply]\n\n\
         You said: \"{}\"\n\n\
         This conversation has {} total messages. \
         Your message has been stored in SQLite (id: {}).\n\n\
         _The real AI will replace this mock reply once the Go gateway is connected._",
        user_input,
        history.len(),
        history.last().map(|m| m.id.as_str()).unwrap_or("?"),
    )
}

fn generate_title(content: &str) -> String {
    let title = content
        .chars()
        .take(50)
        .collect::<String>()
        .replace('\n', " ")
        .trim()
        .to_string();
    if title.is_empty() {
        "New Chat".into()
    } else {
        title
    }
}

/// After each user-assistant exchange, consolidate memories.
fn maybe_consolidate_memory(state: &SharedState, conv_id: &str, user_input: &str, ai_reply: &str) {
    // Store conversation-scoped episodic memory
    let mem = Memory::new(
        MemoryScope::Conversation,
        MemoryType::Episodic,
        Some(conv_id.to_string()),
        format!("User: {}\nAssistant: {}", user_input, ai_reply),
        0.5,
    );
    if let Err(e) = state.db.store_memory(&mem) {
        tracing::warn!("Failed to store memory: {}", e);
    }

    // Every 5th exchange, also create a global memory
    if let Ok(msgs) = state.db.get_messages(conv_id) {
        let user_count = msgs.iter().filter(|m| m.role == Role::User).count();
        if user_count > 0 && user_count % 5 == 0 {
            let global_mem = Memory::new(
                MemoryScope::Global,
                MemoryType::Semantic,
                None,
                format!(
                    "In conversation '{}', the user discussed: {}",
                    conv_id, user_input
                ),
                0.7,
            );
            let _ = state.db.store_memory(&global_mem);
        }
    }
}

fn build_msg_response(msg: &Message, tool_calls: &[ToolCall]) -> MessageResponse {
    MessageResponse {
        id: msg.id.clone(),
        role: msg.role.as_str().to_string(),
        content: msg.content.clone(),
        parent_id: msg.parent_id.clone(),
        tool_calls: tool_calls
            .iter()
            .map(|tc| ToolCallResponse {
                id: tc.id.clone(),
                name: tc.name.clone(),
                arguments: tc.arguments.clone(),
            })
            .collect(),
        created_at: msg.created_at.to_rfc3339(),
    }
}

// ===== Error helpers =====

fn not_found(e: encorehub_core::EngineError) -> (StatusCode, Json<ErrorResponse>) {
    let msg = match &e {
        encorehub_core::EngineError::NotFound { resource, id } => {
            format!("{} not found: {}", resource, id)
        }
        _ => e.to_string(),
    };
    (StatusCode::NOT_FOUND, Json(ErrorResponse { error: msg }))
}

fn internal_error(e: encorehub_core::EngineError) -> (StatusCode, Json<ErrorResponse>) {
    tracing::error!("Internal error: {}", e);
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: e.to_string(),
        }),
    )
}
