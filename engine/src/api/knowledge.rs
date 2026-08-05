//! Knowledge base API handlers.

use crate::{api::SharedState, document_processing::chunk_text};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use encorehub_core::{Document, DocumentChunk};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct IngestRequest {
    pub title: String,
    pub content: String,
    #[serde(default = "default_file_type")]
    pub file_type: String,
}

fn default_file_type() -> String {
    "text".into()
}

#[derive(Debug, Serialize)]
pub struct DocumentResponse {
    pub id: String,
    pub title: String,
    pub file_type: String,
    pub chunk_count: i32,
    pub size_bytes: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchChunkResponse {
    pub id: String,
    pub document_id: String,
    pub content: String,
    pub chunk_index: i32,
    pub score: f64,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchChunkResponse>,
    pub query: String,
    pub backend: &'static str,
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    #[serde(default = "default_top_k")]
    pub top_k: i64,
}

fn default_top_k() -> i64 {
    5
}

/// Ingest a document (text content) — chunk and index it.
pub async fn ingest(
    State(state): State<SharedState>,
    Json(req): Json<IngestRequest>,
) -> Result<Json<DocumentResponse>, (StatusCode, Json<super::ErrorResponse>)> {
    let chunks = chunk_text(&req.content, 1_000, 200);
    let chunk_count = chunks.len() as i32;

    let doc = Document {
        id: Uuid::new_v4().to_string(),
        title: req.title.clone(),
        file_type: req.file_type.clone(),
        chunk_count,
        size_bytes: req.content.len() as i64,
        created_at: chrono::Utc::now(),
    };

    state.db.insert_document(&doc).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    for (i, chunk_text) in chunks.iter().enumerate() {
        let chunk = DocumentChunk {
            id: Uuid::new_v4().to_string(),
            document_id: doc.id.clone(),
            content: chunk_text.clone(),
            chunk_index: i as i32,
            token_count: (chunk_text.len() / 4) as i32,
        };
        state.db.insert_chunk(&chunk).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;
        state.db.index_knowledge_chunk(&chunk).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;
    }

    let stored_chunks = state.db.list_chunks(&doc.id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;
    if let Some(store) = &state.knowledge_vectors {
        if let Err(error) = store.upsert_document(&doc.id, &stored_chunks).await {
            tracing::warn!(document_id = %doc.id, error = %error, "LanceDB write failed; SQLite-Vec fallback is active");
        }
    }

    Ok(Json(DocumentResponse {
        id: doc.id,
        title: doc.title,
        file_type: doc.file_type,
        chunk_count,
        size_bytes: doc.size_bytes,
        created_at: doc.created_at.to_rfc3339(),
    }))
}

/// List all documents.
pub async fn list(
    State(state): State<SharedState>,
) -> Result<Json<Vec<DocumentResponse>>, (StatusCode, Json<super::ErrorResponse>)> {
    let docs = state.db.list_documents(100, 0).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    let items: Vec<DocumentResponse> = docs
        .into_iter()
        .map(|d| DocumentResponse {
            id: d.id,
            title: d.title,
            file_type: d.file_type,
            chunk_count: d.chunk_count,
            size_bytes: d.size_bytes,
            created_at: d.created_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(items))
}

/// Delete a document and all its chunks.
pub async fn delete(State(state): State<SharedState>, Path(id): Path<String>) -> StatusCode {
    if let Some(store) = &state.knowledge_vectors {
        if let Err(error) = store.delete_document(&id).await {
            tracing::warn!(document_id = %id, error = %error, "LanceDB delete failed; relational cleanup will continue");
        }
    }
    match state.db.delete_document(&id) {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::NOT_FOUND,
    }
}

/// Search embedded LanceDB and automatically use SQLite-Vec when unavailable.
pub async fn search(
    State(state): State<SharedState>,
    Query(params): Query<SearchQuery>,
) -> Result<Json<SearchResponse>, (StatusCode, Json<super::ErrorResponse>)> {
    let lance_results = match &state.knowledge_vectors {
        Some(store) => store.search(&params.q, params.top_k).await,
        None => Err(encorehub_core::EngineError::VectorStore(
            "LanceDB was unavailable during Engine startup".into(),
        )),
    };
    let (items, backend) = match lance_results {
        Ok(items) => (
            items
                .into_iter()
                .map(|hit| SearchChunkResponse {
                    id: hit.chunk_id,
                    document_id: hit.document_id,
                    content: hit.content,
                    chunk_index: hit.chunk_index,
                    score: hit.score,
                })
                .collect(),
            "lance_db",
        ),
        Err(error) => {
            tracing::warn!(error = %error, "LanceDB search unavailable; using SQLite-Vec");
            let results = state
                .db
                .search_knowledge_vectors(&params.q, params.top_k)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(super::ErrorResponse {
                            error: e.to_string(),
                        }),
                    )
                })?;
            let items = results
                .into_iter()
                .map(|hit| SearchChunkResponse {
                    id: hit.item.id,
                    document_id: hit.item.document_id,
                    content: hit.item.content,
                    chunk_index: hit.item.chunk_index,
                    score: hit.score,
                })
                .collect();
            (items, "sqlite_vec")
        }
    };

    Ok(Json(SearchResponse {
        results: items,
        query: params.q,
        backend,
    }))
}
