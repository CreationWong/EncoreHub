//! Memory API handlers.

use crate::api::SharedState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use encorehub_core::{
    CharacterMemorySettings, Memory, MemoryGroup, MemoryGroupInheritance, MemoryKind, MemoryMode,
    MemoryScope, MemoryState, MemoryType,
};
use serde::{Deserialize, Serialize};

/// Query parameters accepted by vector memory search.

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    #[serde(default = "default_top_k")]
    pub top_k: i64,
    pub scope: Option<String>,
    pub conversation_id: Option<String>,
    pub character_id: Option<String>,
    pub group_id: Option<String>,
    pub retrieval: Option<String>,
}

fn default_top_k() -> i64 {
    5
}

#[derive(Debug, Serialize)]
pub struct MemoryResponse {
    pub id: String,
    pub scope: String,
    pub memory_type: String,
    pub conversation_id: Option<String>,
    pub group_id: String,
    pub source_character_id: Option<String>,
    pub state: String,
    pub kind: String,
    pub canonical_key: Option<String>,
    pub reason: String,
    pub source_turn_id: Option<String>,
    pub created_by_model: String,
    pub confidence: f32,
    pub content: String,
    pub importance: f32,
    pub created_at: String,
    pub last_accessed_at: String,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub results: Vec<MemoryResponse>,
    pub query: String,
    pub backend: &'static str,
}

/// Result of an idempotent model-selected memory write.
#[derive(Debug, Serialize)]
pub struct RememberResponse {
    #[serde(flatten)]
    pub memory: MemoryResponse,
    pub created: bool,
}

#[derive(Debug, Serialize)]
pub struct ListResponse {
    pub memories: Vec<MemoryResponse>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
pub struct MemoryGroupListResponse {
    pub groups: Vec<MemoryGroup>,
    pub total: usize,
}

/// User-controlled fields for a new custom memory group.
#[derive(Debug, Deserialize)]
pub struct CreateMemoryGroupRequest {
    pub name: String,
}

/// Editable fields for an existing custom memory group.
#[derive(Debug, Deserialize)]
pub struct UpdateMemoryGroupRequest {
    pub name: Option<String>,
    pub archived: Option<bool>,
}

/// Explicit policy for disposing of memories when a custom group is deleted.
#[derive(Debug, Deserialize)]
pub struct DeleteMemoryGroupQuery {
    pub strategy: String,
    pub target_group_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CharacterMemorySettingsResponse {
    pub settings: CharacterMemorySettings,
    pub inherited_groups: Vec<MemoryGroupInheritance>,
    pub visible_group_ids: Vec<String>,
}

/// Effective memory mode pinned to one conversation + character pair.
#[derive(Debug, Serialize)]
pub struct ConversationMemoryModeResponse {
    pub conversation_id: String,
    pub character_id: String,
    pub mode: MemoryMode,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCharacterMemorySettingsRequest {
    pub default_mode: String,
    #[serde(default)]
    pub realistic_enabled: bool,
    #[serde(default)]
    pub inherited_groups: Vec<MemoryGroupInheritance>,
}

#[derive(Debug, Deserialize)]
pub struct RememberRequest {
    pub conversation_id: String,
    pub character_id: String,
    pub source_turn_id: String,
    pub created_by_model: String,
    pub content: String,
    pub kind: String,
    pub reason: String,
    #[serde(default = "default_importance")]
    pub importance: f32,
    #[serde(default = "default_confidence")]
    pub confidence: f32,
    pub canonical_key: Option<String>,
    pub target_group_id: Option<String>,
}

fn default_importance() -> f32 {
    0.5
}

fn default_confidence() -> f32 {
    0.7
}

/// Search memories using role-scoped vector or lexical retrieval.
pub async fn search(
    State(state): State<SharedState>,
    Query(params): Query<SearchQuery>,
) -> Result<Json<SearchResponse>, (StatusCode, Json<super::ErrorResponse>)> {
    let scope = params.scope.as_deref().and_then(MemoryScope::from_str);
    let mut visible_groups = if let Some(character_id) = params.character_id.as_deref() {
        Some(
            state
                .db
                .visible_memory_group_ids(character_id)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(super::ErrorResponse {
                            error: e.to_string(),
                        }),
                    )
                })?,
        )
    } else {
        None
    };
    if let Some(group_id) = params.group_id.as_deref() {
        if let Some(groups) = visible_groups.as_mut() {
            if !groups.iter().any(|visible| visible == group_id) {
                return Err((
                    StatusCode::FORBIDDEN,
                    Json(super::ErrorResponse {
                        error: "memory group is not visible to this character".into(),
                    }),
                ));
            }
        }
        visible_groups = Some(vec![group_id.to_string()]);
    }
    let retrieval = params.retrieval.as_deref().unwrap_or("vector");
    let (results, backend) = match retrieval {
        "lexical" => {
            let mut results = if let Some(groups) = visible_groups.as_deref() {
                state
                    .db
                    .search_memories_fts_for_groups(&params.q, groups, params.top_k)
            } else {
                state
                    .db
                    .search_memories_fts(&params.q, scope.as_ref(), params.top_k)
            }
            .map_err(internal_error)?;
            if results.is_empty() {
                if let Some(groups) = visible_groups.as_deref() {
                    // Simple mode may store English-normalized facts while the
                    // recall query is in another language. A bounded recent
                    // fallback remains explicit and role-scoped.
                    results = state
                        .db
                        .list_memories_for_groups(None, None, groups, params.top_k.clamp(1, 10), 0)
                        .map_err(internal_error)?;
                }
            }
            (results, "sqlite_fts")
        }
        "vector" => {
            let results = state
                .db
                .search_memory_vectors_for_groups(
                    &params.q,
                    params.conversation_id.as_deref(),
                    visible_groups.as_deref(),
                    params.top_k,
                )
                .map_err(internal_error)?
                .into_iter()
                .map(|hit| hit.item)
                .collect();
            (results, "sqlite_vec")
        }
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(super::ErrorResponse {
                    error: "retrieval must be vector or lexical".into(),
                }),
            ));
        }
    };

    let results = results
        .into_iter()
        .filter(|memory| scope.as_ref().is_none_or(|value| &memory.scope == value))
        .collect::<Vec<_>>();
    for memory in &results {
        let _ = state.db.touch_memory(&memory.id);
    }
    let items = results.into_iter().map(memory_response).collect();

    Ok(Json(SearchResponse {
        results: items,
        query: params.q,
        backend,
    }))
}

/// List all memories (paginated).
pub async fn list(
    State(state): State<SharedState>,
    Query(params): Query<ListQuery>,
) -> Result<Json<ListResponse>, (StatusCode, Json<super::ErrorResponse>)> {
    let scope = params.scope.as_deref().and_then(MemoryScope::from_str);
    let mem_type = params.memory_type.as_deref().and_then(MemoryType::from_str);

    let memories = if let Some(group_id) = params.group_id.as_deref() {
        state.db.list_memories_for_groups(
            scope.as_ref(),
            mem_type.as_ref(),
            &[group_id.to_string()],
            params.limit,
            params.offset,
        )
    } else if let Some(character_id) = params.character_id.as_deref() {
        let groups = state
            .db
            .visible_memory_group_ids(character_id)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(super::ErrorResponse {
                        error: e.to_string(),
                    }),
                )
            })?;
        state.db.list_memories_for_groups(
            scope.as_ref(),
            mem_type.as_ref(),
            &groups,
            params.limit,
            params.offset,
        )
    } else {
        state.db.list_memories(
            scope.as_ref(),
            mem_type.as_ref(),
            params.limit,
            params.offset,
        )
    }
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    let total = memories.len();
    let items: Vec<MemoryResponse> = memories
        .into_iter()
        .map(|m| MemoryResponse {
            id: m.id,
            scope: m.scope.as_str().to_string(),
            memory_type: m.memory_type.as_str().to_string(),
            conversation_id: m.conversation_id,
            group_id: m.group_id,
            source_character_id: m.source_character_id,
            state: m.state.as_str().into(),
            kind: m.kind.as_str().into(),
            canonical_key: m.canonical_key,
            reason: m.reason,
            source_turn_id: m.source_turn_id,
            created_by_model: m.created_by_model,
            confidence: m.confidence,
            content: m.content,
            importance: m.importance,
            created_at: m.created_at.to_rfc3339(),
            last_accessed_at: m.last_accessed_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(ListResponse {
        memories: items,
        total,
    }))
}

/// Persist one model-selected memory after enforcing role and group policy.
pub async fn remember(
    State(state): State<SharedState>,
    Json(request): Json<RememberRequest>,
) -> Result<(StatusCode, Json<RememberResponse>), (StatusCode, Json<super::ErrorResponse>)> {
    let content = request.content.trim();
    let reason = request.reason.trim();
    if content.is_empty() || content.chars().count() > 4_000 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse {
                error: "memory content must contain 1 to 4000 characters".into(),
            }),
        ));
    }
    if reason.is_empty() || reason.chars().count() > 1_000 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse {
                error: "memory reason must contain 1 to 1000 characters".into(),
            }),
        ));
    }
    let kind = MemoryKind::from_str(request.kind.trim()).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse {
                error: "kind must be fact, preference, event, instruction, or summary".into(),
            }),
        )
    })?;
    let conversation = state
        .db
        .get_conversation(&request.conversation_id)
        .map_err(|e| {
            (
                StatusCode::NOT_FOUND,
                Json(super::ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;
    if conversation.character_id != request.character_id {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse {
                error: "conversation does not belong to the supplied character".into(),
            }),
        ));
    }
    let settings = state
        .db
        .get_character_memory_settings(&request.character_id)
        .map_err(|e| {
            (
                StatusCode::NOT_FOUND,
                Json(super::ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;
    let group_id = request
        .target_group_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("character:{}", request.character_id));
    let can_write = state
        .db
        .can_character_write_memory_group(&request.character_id, &group_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;
    if !can_write {
        return Err((
            StatusCode::FORBIDDEN,
            Json(super::ErrorResponse {
                error: "character cannot write to the selected memory group".into(),
            }),
        ));
    }
    if let Some(existing) = state
        .db
        .find_equivalent_memory(&group_id, &kind, content)
        .map_err(internal_error)?
    {
        return Ok((
            StatusCode::OK,
            Json(RememberResponse {
                memory: memory_response(existing),
                created: false,
            }),
        ));
    }
    let memory_state =
        if matches!(settings.default_mode, MemoryMode::Realistic) && settings.realistic_enabled {
            MemoryState::Transient
        } else {
            MemoryState::LongTerm
        };
    let mut memory = Memory::new_in_group(
        group_id,
        Some(request.character_id),
        Some(request.conversation_id),
        content,
        request.importance,
        kind,
        memory_state,
    );
    memory.reason = reason.to_string();
    memory.source_turn_id = Some(request.source_turn_id);
    memory.created_by_model = request.created_by_model.trim().to_string();
    memory.confidence = request.confidence.clamp(0.0, 1.0);
    memory.canonical_key = request
        .canonical_key
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    state.db.store_memory(&memory).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;
    if !matches!(settings.default_mode, MemoryMode::Simple) {
        if let Err(error) = state.db.index_memory(&memory) {
            tracing::warn!(memory_id = %memory.id, %error, "memory vector indexing failed");
        }
    }
    Ok((
        StatusCode::CREATED,
        Json(RememberResponse {
            memory: memory_response(memory),
            created: true,
        }),
    ))
}

/// List role, global, and custom memory groups for the local profile.
pub async fn list_groups(
    State(state): State<SharedState>,
) -> Result<Json<MemoryGroupListResponse>, (StatusCode, Json<super::ErrorResponse>)> {
    let groups = state.db.list_memory_groups(false).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;
    let total = groups.len();
    Ok(Json(MemoryGroupListResponse { groups, total }))
}

/// Create a custom memory group owned by the local profile.
pub async fn create_group(
    State(state): State<SharedState>,
    Json(request): Json<CreateMemoryGroupRequest>,
) -> Result<(StatusCode, Json<MemoryGroup>), (StatusCode, Json<super::ErrorResponse>)> {
    let name = validate_group_name(&request.name)?;
    let group = state.db.create_custom_memory_group(name).map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse {
                error: error.to_string(),
            }),
        )
    })?;
    Ok((StatusCode::CREATED, Json(group)))
}

/// Rename, archive, or restore a custom memory group.
pub async fn update_group(
    State(state): State<SharedState>,
    Path(group_id): Path<String>,
    Json(request): Json<UpdateMemoryGroupRequest>,
) -> Result<Json<MemoryGroup>, (StatusCode, Json<super::ErrorResponse>)> {
    if request.name.is_none() && request.archived.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse {
                error: "name or archived is required".into(),
            }),
        ));
    }
    let name = request
        .name
        .as_deref()
        .map(validate_group_name)
        .transpose()?;
    let group = state
        .db
        .update_custom_memory_group(&group_id, name, request.archived)
        .map_err(|error| {
            (
                StatusCode::BAD_REQUEST,
                Json(super::ErrorResponse {
                    error: error.to_string(),
                }),
            )
        })?;
    Ok(Json(group))
}

/// Delete a custom group using the caller's explicit content disposition.
pub async fn delete_group(
    State(state): State<SharedState>,
    Path(group_id): Path<String>,
    Query(params): Query<DeleteMemoryGroupQuery>,
) -> Result<StatusCode, (StatusCode, Json<super::ErrorResponse>)> {
    let (transfer_target, delete_memories) = match params.strategy.as_str() {
        "transfer" => (params.target_group_id.as_deref(), false),
        "delete_memories" => (None, true),
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(super::ErrorResponse {
                    error: "strategy must be transfer or delete_memories".into(),
                }),
            ));
        }
    };
    if params.strategy == "transfer" && transfer_target.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse {
                error: "target_group_id is required for transfer".into(),
            }),
        ));
    }
    state
        .db
        .delete_custom_memory_group(&group_id, transfer_target, delete_memories)
        .map_err(|error| {
            (
                StatusCode::BAD_REQUEST,
                Json(super::ErrorResponse {
                    error: error.to_string(),
                }),
            )
        })?;
    Ok(StatusCode::NO_CONTENT)
}

/// Normalize and bound a user-visible memory group name.
fn validate_group_name(value: &str) -> Result<&str, (StatusCode, Json<super::ErrorResponse>)> {
    let name = value.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse {
                error: "memory group name must contain 1 to 80 characters".into(),
            }),
        ));
    }
    Ok(name)
}

/// Read role-scoped memory mode and inherited groups.
pub async fn character_settings(
    State(state): State<SharedState>,
    Path(character_id): Path<String>,
) -> Result<Json<CharacterMemorySettingsResponse>, (StatusCode, Json<super::ErrorResponse>)> {
    let settings = state
        .db
        .get_character_memory_settings(&character_id)
        .map_err(|e| {
            (
                StatusCode::NOT_FOUND,
                Json(super::ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;
    let inherited_groups = state
        .db
        .list_character_memory_inheritance(&character_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;
    let visible_group_ids = state
        .db
        .visible_memory_group_ids(&character_id)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;
    Ok(Json(CharacterMemorySettingsResponse {
        settings,
        inherited_groups,
        visible_group_ids,
    }))
}

/// Replace role-scoped memory mode and inherited group permissions.
pub async fn update_character_settings(
    State(state): State<SharedState>,
    Path(character_id): Path<String>,
    Json(request): Json<UpdateCharacterMemorySettingsRequest>,
) -> Result<Json<CharacterMemorySettingsResponse>, (StatusCode, Json<super::ErrorResponse>)> {
    let default_mode = MemoryMode::from_str(request.default_mode.trim()).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse {
                error: "default_mode must be simple, rag, rag_enhanced, or realistic".into(),
            }),
        )
    })?;
    if matches!(default_mode, MemoryMode::Realistic) && !request.realistic_enabled {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse {
                error: "realistic mode requires realistic_enabled".into(),
            }),
        ));
    }
    if request.inherited_groups.len() > 64 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse {
                error: "at most 64 inherited memory groups are allowed".into(),
            }),
        ));
    }
    let settings = CharacterMemorySettings {
        character_id: character_id.clone(),
        default_mode,
        realistic_enabled: request.realistic_enabled,
        updated_at: chrono::Utc::now(),
    };
    state
        .db
        .update_character_memory_configuration(&settings, &request.inherited_groups)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(super::ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;

    // A role may enter RAG after memories were created in Simple mode or may
    // inherit a group whose owner used Simple mode. Backfill visible vectors
    // whenever a vector-backed mode is selected.
    if !matches!(settings.default_mode, MemoryMode::Simple) {
        let group_ids = state
            .db
            .visible_memory_group_ids(&character_id)
            .map_err(internal_error)?;
        let memories = state
            .db
            .list_memories_for_groups(None, None, &group_ids, 100_000, 0)
            .map_err(internal_error)?;
        for memory in memories {
            if let Err(error) = state.db.index_memory(&memory) {
                tracing::warn!(memory_id = %memory.id, %error, "memory vector backfill failed");
            }
        }
    }
    character_settings(State(state), Path(character_id)).await
}

/// Resolve the monotonic memory mode used by the current conversation.
pub async fn resolve_conversation_mode(
    State(state): State<SharedState>,
    Path(conversation_id): Path<String>,
) -> Result<Json<ConversationMemoryModeResponse>, (StatusCode, Json<super::ErrorResponse>)> {
    let (character_id, mode) = state
        .db
        .resolve_conversation_memory_mode(&conversation_id)
        .map_err(|error| {
            (
                StatusCode::NOT_FOUND,
                Json(super::ErrorResponse {
                    error: error.to_string(),
                }),
            )
        })?;
    Ok(Json(ConversationMemoryModeResponse {
        conversation_id,
        character_id,
        mode,
    }))
}

/// Convert storage failures produced during policy backfill into API errors.
fn internal_error(error: encorehub_core::EngineError) -> (StatusCode, Json<super::ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(super::ErrorResponse {
            error: error.to_string(),
        }),
    )
}

/// Serialize the shared relational memory shape consistently across endpoints.
fn memory_response(memory: Memory) -> MemoryResponse {
    MemoryResponse {
        id: memory.id,
        scope: memory.scope.as_str().into(),
        memory_type: memory.memory_type.as_str().into(),
        conversation_id: memory.conversation_id,
        group_id: memory.group_id,
        source_character_id: memory.source_character_id,
        state: memory.state.as_str().into(),
        kind: memory.kind.as_str().into(),
        canonical_key: memory.canonical_key,
        reason: memory.reason,
        source_turn_id: memory.source_turn_id,
        created_by_model: memory.created_by_model,
        confidence: memory.confidence,
        content: memory.content,
        importance: memory.importance,
        created_at: memory.created_at.to_rfc3339(),
        last_accessed_at: memory.last_accessed_at.to_rfc3339(),
    }
}

/// Delete a memory.
pub async fn delete(State(state): State<SharedState>, Path(id): Path<String>) -> StatusCode {
    match state.db.delete_memory(&id) {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::NOT_FOUND,
    }
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
    pub scope: Option<String>,
    pub memory_type: Option<String>,
    pub character_id: Option<String>,
    pub group_id: Option<String>,
}

fn default_limit() -> i64 {
    50
}
