//! Conversation API handlers.

use crate::api::SharedState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use encorehub_core::{
    CharacterSnapshot, CharacterUpgradePreview, Conversation, Message, MessageStatus, Role,
    ToolCall, DEFAULT_CHARACTER_ID,
};
use encorehub_storage::{AttachmentRecord, BlobStore, Database};
use serde::{Deserialize, Serialize};

// ===== Request / Response types =====

#[derive(Debug, Deserialize)]
pub struct CreateConversationRequest {
    #[serde(default = "default_title")]
    pub title: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub character_id: Option<String>,
}

fn default_title() -> String {
    "New Chat".into()
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
    pub character_id: String,
    pub character_version: i64,
    pub character_snapshot: CharacterSnapshot,
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
    pub character_id: String,
    pub character_version: i64,
    pub character_snapshot: CharacterSnapshot,
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
    pub attachments: Vec<AttachmentSummary>,
    pub token_count: i32,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub cache_creation_input_tokens: Option<i32>,
    pub cache_read_input_tokens: Option<i32>,
    pub context_input_tokens: Option<i32>,
    pub context_output_tokens: Option<i32>,
    pub duration_ms: Option<i64>,
    pub finish_reason: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct AttachmentSummary {
    pub id: String,
    pub conversation_id: String,
    pub file_name: String,
    pub mime_type: String,
    pub file_category: String,
    pub size_bytes: i64,
    pub processing_status: String,
    pub processing_method: String,
    pub error_message: String,
}

impl From<AttachmentRecord> for AttachmentSummary {
    fn from(value: AttachmentRecord) -> Self {
        Self {
            id: value.id,
            conversation_id: value.conversation_id,
            file_name: value.file_name,
            mime_type: value.mime_type,
            file_category: value.file_category,
            size_bytes: value.size_bytes,
            processing_status: value.processing_status,
            processing_method: value.processing_method,
            error_message: value.error_message,
        }
    }
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
    let provider = req.provider.trim();
    let model = req.model.trim();
    if provider.is_empty() != model.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "provider and model must be set together".into(),
            }),
        ));
    }
    let selection = if provider.is_empty() {
        None
    } else {
        Some((provider, model))
    };
    let title = req.title.trim();
    let title = if title.is_empty() { "New Chat" } else { title };
    let character_id = req
        .character_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .unwrap_or(DEFAULT_CHARACTER_ID);
    let conv = state
        .db
        .create_conversation_for_character(title, selection, character_id)
        .map_err(domain_error)?;

    Ok(Json(build_conversation_response(conv, 0)))
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
            build_conversation_response(c, count)
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
            let attachments = attachment_summaries(&state.db, &m.id);
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
                attachments,
                token_count: m.token_count,
                input_tokens: m.input_tokens,
                output_tokens: m.output_tokens,
                cache_creation_input_tokens: m.cache_creation_input_tokens,
                cache_read_input_tokens: m.cache_read_input_tokens,
                context_input_tokens: m.context_input_tokens,
                context_output_tokens: m.context_output_tokens,
                duration_ms: m.duration_ms,
                finish_reason: m.finish_reason,
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
        character_id: conv.character_id,
        character_version: conv.character_version,
        character_snapshot: conv.character_snapshot,
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
    let store = BlobStore::new(state.db.data_directory().join("blobs")).map_err(internal_error)?;
    let unreferenced = state.db.delete_conversation(&id).map_err(internal_error)?;
    for sha256 in unreferenced {
        store.delete(&sha256).map_err(internal_error)?;
    }
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
    Ok(Json(build_conversation_response(conv, 0)))
}

#[derive(Debug, Deserialize)]
pub struct UpgradeCharacterRequest {
    pub expected_character_version: i64,
}

pub async fn preview_character_upgrade(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<CharacterUpgradePreview>, (StatusCode, Json<ErrorResponse>)> {
    state
        .db
        .preview_character_upgrade(&id)
        .map(Json)
        .map_err(domain_error)
}

pub async fn upgrade_character(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(request): Json<UpgradeCharacterRequest>,
) -> Result<Json<ConversationResponse>, (StatusCode, Json<ErrorResponse>)> {
    if request.expected_character_version < 1 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "expected_character_version must be positive".into(),
            }),
        ));
    }
    let conversation = state
        .db
        .upgrade_conversation_character(&id, request.expected_character_version)
        .map_err(domain_error)?;
    let message_count = state
        .db
        .get_messages(&id)
        .map(|messages| messages.len())
        .unwrap_or(0);
    Ok(Json(build_conversation_response(
        conversation,
        message_count,
    )))
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
    Ok(Json(build_conversation_response(conv, 0)))
}

pub async fn get_messages(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<MessageResponse>>, (StatusCode, Json<ErrorResponse>)> {
    let messages = state.db.get_messages(&id).map_err(internal_error)?;

    let responses: Vec<MessageResponse> = messages
        .into_iter()
        .map(|m| {
            let attachments = attachment_summaries(&state.db, &m.id);
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
                attachments,
                token_count: m.token_count,
                input_tokens: m.input_tokens,
                output_tokens: m.output_tokens,
                cache_creation_input_tokens: m.cache_creation_input_tokens,
                cache_read_input_tokens: m.cache_read_input_tokens,
                context_input_tokens: m.context_input_tokens,
                context_output_tokens: m.context_output_tokens,
                duration_ms: m.duration_ms,
                finish_reason: m.finish_reason,
                status: m.status.as_str().to_string(),
                created_at: m.created_at.to_rfc3339(),
            }
        })
        .collect();

    Ok(Json(responses))
}

pub async fn delete_message(
    State(state): State<SharedState>,
    Path((conversation_id, message_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    state
        .db
        .delete_message_branch(&conversation_id, &message_id)
        .map_err(domain_error)?;
    Ok(StatusCode::NO_CONTENT)
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
    pub input_tokens: Option<i32>,
    #[serde(default)]
    pub output_tokens: Option<i32>,
    #[serde(default)]
    pub cache_creation_input_tokens: Option<i32>,
    #[serde(default)]
    pub cache_read_input_tokens: Option<i32>,
    /// The final provider round is the authoritative context snapshot; billing
    /// fields above may aggregate several tool rounds.
    #[serde(default)]
    pub context_input_tokens: Option<i32>,
    #[serde(default)]
    pub context_output_tokens: Option<i32>,
    #[serde(default)]
    pub duration_ms: Option<i64>,
    #[serde(default)]
    pub finish_reason: Option<String>,
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
    #[serde(default)]
    pub replace_message_id: Option<String>,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
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
    pub input_tokens: Option<i32>,
    #[serde(default)]
    pub output_tokens: Option<i32>,
    #[serde(default)]
    pub cache_creation_input_tokens: Option<i32>,
    #[serde(default)]
    pub cache_read_input_tokens: Option<i32>,
    /// Final-round fields separate context occupancy from cumulative billing
    /// telemetry when a user turn invokes tools more than once.
    #[serde(default)]
    pub context_input_tokens: Option<i32>,
    #[serde(default)]
    pub context_output_tokens: Option<i32>,
    #[serde(default)]
    pub duration_ms: Option<i64>,
    #[serde(default)]
    pub finish_reason: Option<String>,
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
    if req.content.trim().is_empty() && req.attachment_ids.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "message content required".into(),
            }),
        ));
    }

    for attachment_id in &req.attachment_ids {
        state
            .db
            .get_attachment(&conv_id, attachment_id)
            .map_err(domain_error)?;
    }
    let mut user = Message::new(&conv_id, Role::User, req.content, None);
    user.status = MessageStatus::Pending;
    if let Some(replaced_message_id) = req
        .replace_message_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        state
            .db
            .replace_chat_turn_with_attachments(&user, replaced_message_id, &req.attachment_ids)
            .map_err(domain_error)?;
    } else {
        state
            .db
            .begin_chat_turn_with_attachments(&user, &req.attachment_ids)
            .map_err(domain_error)?;
    }
    Ok(Json(build_msg_response(&state.db, &user, &[])))
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
        message.input_tokens = input.input_tokens;
        message.output_tokens = input.output_tokens;
        message.cache_creation_input_tokens = input.cache_creation_input_tokens;
        message.cache_read_input_tokens = input.cache_read_input_tokens;
        message.context_input_tokens = input.context_input_tokens;
        message.context_output_tokens = input.context_output_tokens;
        message.duration_ms = input.duration_ms;
        message.finish_reason = input.finish_reason;
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
        Some(build_msg_response(&state.db, &stored, &stored_calls))
    } else {
        None
    };
    Ok(Json(FinalizeTurnResponse {
        user_message: build_msg_response(&state.db, &user, &[]),
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
    msg.input_tokens = req.input_tokens;
    msg.output_tokens = req.output_tokens;
    msg.cache_creation_input_tokens = req.cache_creation_input_tokens;
    msg.cache_read_input_tokens = req.cache_read_input_tokens;
    msg.context_input_tokens = req.context_input_tokens;
    msg.context_output_tokens = req.context_output_tokens;
    msg.duration_ms = req.duration_ms;
    msg.finish_reason = req.finish_reason;
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

    Ok(Json(build_msg_response(&state.db, &msg, &stored_calls)))
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

    Ok(Json(SendMessageResponse {
        user_message: build_msg_response(&state.db, &user_msg, &[]),
        assistant_message: build_msg_response(&state.db, &assistant_msg, &[]),
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
             - Conversation history: active ({} messages stored in SQLite)\n\
             - Curated memory: created only by an explicit memory tool call\n\
             - Knowledge vectors: LanceDB primary, SQLite-Vec fallback\n\
             - FTS5 full-text search: enabled\n\n\
             Messages are persisted separately from curated memory.",
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

fn attachment_summaries(db: &Database, message_id: &str) -> Vec<AttachmentSummary> {
    db.list_attachments_for_message(message_id)
        .unwrap_or_default()
        .into_iter()
        .map(AttachmentSummary::from)
        .collect()
}

fn build_msg_response(db: &Database, msg: &Message, tool_calls: &[ToolCall]) -> MessageResponse {
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
        attachments: attachment_summaries(db, &msg.id),
        token_count: msg.token_count,
        input_tokens: msg.input_tokens,
        output_tokens: msg.output_tokens,
        cache_creation_input_tokens: msg.cache_creation_input_tokens,
        cache_read_input_tokens: msg.cache_read_input_tokens,
        context_input_tokens: msg.context_input_tokens,
        context_output_tokens: msg.context_output_tokens,
        duration_ms: msg.duration_ms,
        finish_reason: msg.finish_reason.clone(),
        status: msg.status.as_str().to_string(),
        created_at: msg.created_at.to_rfc3339(),
    }
}

fn build_conversation_response(
    conversation: Conversation,
    message_count: usize,
) -> ConversationResponse {
    ConversationResponse {
        id: conversation.id,
        title: conversation.title,
        provider: conversation.provider,
        model: conversation.model,
        character_id: conversation.character_id,
        character_version: conversation.character_version,
        character_snapshot: conversation.character_snapshot,
        message_count,
        created_at: conversation.created_at.to_rfc3339(),
        updated_at: conversation.updated_at.to_rfc3339(),
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

fn domain_error(e: encorehub_core::EngineError) -> (StatusCode, Json<ErrorResponse>) {
    let status = match &e {
        encorehub_core::EngineError::NotFound { .. } => StatusCode::NOT_FOUND,
        encorehub_core::EngineError::AlreadyExists { .. } => StatusCode::CONFLICT,
        encorehub_core::EngineError::InvalidArgument(_)
        | encorehub_core::EngineError::Validation { .. } => StatusCode::BAD_REQUEST,
        _ => {
            tracing::error!(error_type = %std::any::type_name_of_val(&e), "conversation domain operation failed");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    };
    (
        status,
        Json(ErrorResponse {
            error: e.to_string(),
        }),
    )
}
