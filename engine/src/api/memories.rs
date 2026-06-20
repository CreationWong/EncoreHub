//! Memory API handlers.

use crate::api::SharedState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use encorehub_core::{MemoryScope, MemoryType};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    #[serde(default = "default_top_k")]
    pub top_k: i64,
    pub scope: Option<String>,
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
    pub content: String,
    pub importance: f32,
    pub created_at: String,
    pub last_accessed_at: String,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub results: Vec<MemoryResponse>,
    pub query: String,
}

#[derive(Debug, Serialize)]
pub struct ListResponse {
    pub memories: Vec<MemoryResponse>,
    pub total: usize,
}

/// Search memories using FTS5 full-text search.
pub async fn search(
    State(state): State<SharedState>,
    Query(params): Query<SearchQuery>,
) -> Result<Json<SearchResponse>, (StatusCode, Json<super::ErrorResponse>)> {
    let scope = params.scope.as_deref().and_then(MemoryScope::from_str);

    let results = state
        .db
        .search_memories_fts(&params.q, scope.as_ref(), params.top_k)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;

    // Touch accessed memories
    for mem in &results {
        let _ = state.db.touch_memory(&mem.id);
    }

    let items: Vec<MemoryResponse> = results
        .into_iter()
        .map(|m| MemoryResponse {
            id: m.id,
            scope: m.scope.as_str().to_string(),
            memory_type: m.memory_type.as_str().to_string(),
            conversation_id: m.conversation_id,
            content: m.content,
            importance: m.importance,
            created_at: m.created_at.to_rfc3339(),
            last_accessed_at: m.last_accessed_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(SearchResponse {
        results: items,
        query: params.q,
    }))
}

/// List all memories (paginated).
pub async fn list(
    State(state): State<SharedState>,
    Query(params): Query<ListQuery>,
) -> Result<Json<ListResponse>, (StatusCode, Json<super::ErrorResponse>)> {
    let scope = params.scope.as_deref().and_then(MemoryScope::from_str);
    let mem_type = params.memory_type.as_deref().and_then(MemoryType::from_str);

    let memories = state
        .db
        .list_memories(
            scope.as_ref(),
            mem_type.as_ref(),
            params.limit,
            params.offset,
        )
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
}

fn default_limit() -> i64 {
    50
}
