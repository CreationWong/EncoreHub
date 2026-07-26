//! Conversation API handlers.

use crate::api::SharedState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use encorehub_core::{
    Conversation, Memory, MemoryScope, MemoryType, Message, MessageStatus, Role, ToolCall,
};
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
    #[serde(default)]
    pub reasoning: String,
    pub parent_id: Option<String>,
    pub tool_calls: Vec<ToolCallResponse>,
    pub token_count: i32,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ToolCallResponse {
    pub id: String,
    pub name: String,
    pub arguments: String,
    pub result: String,
    pub status: String,
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
                    result: tc.result,
                    status: tc.status,
                })
                .collect();

            MessageResponse {
                id: m.id,
                role: m.role.as_str().to_string(),
                content: m.content,
                reasoning: m.reasoning,
                parent_id: m.parent_id,
                tool_calls,
                token_count: m.token_count,
                status: m.status.as_str().to_string(),
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
    pub title: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
}

pub async fn update(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateRequest>,
) -> Result<Json<ConversationResponse>, (StatusCode, Json<ErrorResponse>)> {
    if req.title.is_none() && req.provider.is_none() && req.model.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "at least one field is required".into(),
            }),
        ));
    }
    if req.provider.is_some() != req.model.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "provider and model must be updated together".into(),
            }),
        ));
    }

    if let Some(title) = req.title.as_deref() {
        let title = title.trim();
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
    }

    if let (Some(provider), Some(model)) = (req.provider.as_deref(), req.model.as_deref()) {
        let provider = provider.trim();
        let model = model.trim();
        if provider.is_empty() || model.is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "provider and model cannot be empty".into(),
                }),
            ));
        }
        state
            .db
            .update_conversation_model(&id, provider, model)
            .map_err(internal_error)?;
    }
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

/// Update conversation title specifically for tool-based updates.
/// This endpoint provides a simpler interface for tools that want to update titles.
#[derive(Debug, Deserialize)]
pub struct UpdateTitleRequest {
    pub title: String,
}

pub async fn update_title(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateTitleRequest>,
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
    if title.len() > 100 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "title too long (max 100 characters)".into(),
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
                    result: tc.result,
                    status: tc.status,
                })
                .collect();

            MessageResponse {
                id: m.id,
                role: m.role.as_str().to_string(),
                content: m.content,
                reasoning: m.reasoning,
                parent_id: m.parent_id,
                tool_calls,
                token_count: m.token_count,
                status: m.status.as_str().to_string(),
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
    #[serde(default)]
    pub reasoning: String,
    #[serde(default)]
    pub token_count: i32,
    #[serde(default)]
    pub tool_calls: Vec<AddToolCall>,
}

#[derive(Debug, Deserialize)]
pub struct AddToolCall {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub arguments: String,
    #[serde(default)]
    pub result: String,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BeginTurnRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct FinalizeTurnRequest {
    pub status: String,
    #[serde(default)]
    pub assistant: Option<FinalizeAssistantRequest>,
}

#[derive(Debug, Deserialize)]
pub struct FinalizeAssistantRequest {
    pub content: String,
    #[serde(default)]
    pub reasoning: String,
    #[serde(default)]
    pub token_count: i32,
    #[serde(default)]
    pub tool_calls: Vec<AddToolCall>,
}

#[derive(Debug, Serialize)]
pub struct FinalizeTurnResponse {
    pub user_message: MessageResponse,
    pub assistant_message: Option<MessageResponse>,
}

pub async fn begin_turn(
    State(state): State<SharedState>,
    Path(conv_id): Path<String>,
    Json(req): Json<BeginTurnRequest>,
) -> Result<Json<MessageResponse>, (StatusCode, Json<ErrorResponse>)> {
    state.db.get_conversation(&conv_id).map_err(not_found)?;
    if req.content.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "message content required".into(),
            }),
        ));
    }

    let mut user = Message::new(&conv_id, Role::User, req.content, None);
    user.status = MessageStatus::Pending;
    state.db.begin_chat_turn(&user).map_err(internal_error)?;
    Ok(Json(build_msg_response(&user, &[])))
}

pub async fn finalize_turn(
    State(state): State<SharedState>,
    Path((conv_id, turn_id)): Path<(String, String)>,
    Json(req): Json<FinalizeTurnRequest>,
) -> Result<Json<FinalizeTurnResponse>, (StatusCode, Json<ErrorResponse>)> {
    let status = MessageStatus::from_str(&req.status)
        .filter(|status| status.is_terminal())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "terminal turn status required".into(),
                }),
            )
        })?;

    let (assistant, tool_calls) = if let Some(input) = req.assistant {
        let mut message = Message::new(
            &conv_id,
            Role::Assistant,
            input.content,
            Some(turn_id.clone()),
        )
        .with_reasoning(input.reasoning);
        message.token_count = input.token_count;
        message.status = status;
        let calls = input
            .tool_calls
            .into_iter()
            .map(|input| {
                let mut call = ToolCall::new(&message.id, input.name, input.arguments);
                if !input.id.is_empty() {
                    call.id = input.id;
                }
                call.result = input.result;
                if let Some(status) = input.status {
                    call.status = status;
                }
                call
            })
            .collect::<Vec<_>>();
        (Some(message), calls)
    } else {
        (None, Vec::new())
    };

    state
        .db
        .finalize_chat_turn(&conv_id, &turn_id, status, assistant.as_ref(), &tool_calls)
        .map_err(internal_error)?;
    let user = state.db.get_message(&turn_id).map_err(internal_error)?;
    let assistant_message = if let Some(message) = assistant {
        let stored = state.db.get_message(&message.id).map_err(internal_error)?;
        let stored_calls = state
            .db
            .get_tool_calls(&stored.id)
            .map_err(internal_error)?;
        Some(build_msg_response(&stored, &stored_calls))
    } else {
        None
    };
    Ok(Json(FinalizeTurnResponse {
        user_message: build_msg_response(&user, &[]),
        assistant_message,
    }))
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
    let mut msg =
        Message::new(&conv_id, role, &req.content, req.parent_id).with_reasoning(&req.reasoning);
    msg.token_count = req.token_count;
    state.db.append_message(&msg).map_err(internal_error)?;

    // Persist any tool calls the gateway parsed from the provider stream.
    let mut stored_calls = Vec::with_capacity(req.tool_calls.len());
    for tc in &req.tool_calls {
        let mut call = ToolCall::new(&msg.id, &tc.name, &tc.arguments);
        if !tc.id.is_empty() {
            call.id = tc.id.clone();
        }
        call.result = tc.result.clone();
        if let Some(status) = &tc.status {
            call.status = status.clone();
        }
        if let Err(e) = state.db.insert_tool_call(&call) {
            tracing::warn!("failed to store tool call: {}", e);
        } else {
            stored_calls.push(call);
        }
    }

    Ok(Json(build_msg_response(&msg, &stored_calls)))
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
        reasoning: msg.reasoning.clone(),
        parent_id: msg.parent_id.clone(),
        tool_calls: tool_calls
            .iter()
            .map(|tc| ToolCallResponse {
                id: tc.id.clone(),
                name: tc.name.clone(),
                arguments: tc.arguments.clone(),
                result: tc.result.clone(),
                status: tc.status.clone(),
            })
            .collect(),
        token_count: msg.token_count,
        status: msg.status.as_str().to_string(),
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
