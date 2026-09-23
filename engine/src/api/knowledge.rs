//! Knowledge base API handlers.

use crate::{api::SharedState, document_processing::chunk_text};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use encorehub_core::{Document, DocumentChunk};
use encorehub_storage::{reciprocal_rank_fusion, RRF_K};
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
    /// Retrieval route; defaults to hybrid (FTS5 + vector, RRF fused).
    #[serde(default)]
    pub retrieval: RetrievalMode,
}

/// Which route serves a knowledge search.
#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalMode {
    /// FTS5 exact-term matching only.
    Lexical,
    /// Embedding similarity only (LanceDB, falling back to SQLite-Vec).
    Vector,
    /// Both routes fused with reciprocal rank fusion.
    #[default]
    Hybrid,
}

fn default_top_k() -> i64 {
    5
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub q: Option<String>,
    #[serde(default = "default_list_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_list_limit() -> i64 {
    100
}

/// One stored document chunk returned by the chunk browser.
#[derive(Debug, Serialize)]
pub struct ChunkResponse {
    pub id: String,
    pub document_id: String,
    pub content: String,
    pub chunk_index: i32,
    pub token_count: i32,
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

/// List documents, optionally filtered by a title substring.
pub async fn list(
    State(state): State<SharedState>,
    Query(params): Query<ListQuery>,
) -> Result<Json<Vec<DocumentResponse>>, (StatusCode, Json<super::ErrorResponse>)> {
    let limit = params.limit.clamp(1, 500);
    let offset = params.offset.max(0);
    let docs = state
        .db
        .search_documents(params.q.as_deref(), limit, offset)
        .map_err(|e| {
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

/// List every stored chunk of one document for inspection.
pub async fn chunks(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<ChunkResponse>>, (StatusCode, Json<super::ErrorResponse>)> {
    let chunks = state.db.list_chunks(&id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;
    let items = chunks
        .into_iter()
        .map(|chunk| ChunkResponse {
            id: chunk.id,
            document_id: chunk.document_id,
            content: chunk.content,
            chunk_index: chunk.chunk_index,
            token_count: chunk.token_count,
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

/// One retrieval candidate shared by both routes before fusion.
#[derive(Debug, Clone)]
struct ChunkCandidate {
    id: String,
    document_id: String,
    content: String,
    chunk_index: i32,
}

fn chunk_response(candidate: ChunkCandidate, score: f64) -> SearchChunkResponse {
    SearchChunkResponse {
        id: candidate.id,
        document_id: candidate.document_id,
        content: candidate.content,
        chunk_index: candidate.chunk_index,
        score,
    }
}

/// Route result: candidates with their display score, best first.
type RouteHits = Vec<(ChunkCandidate, f64)>;

/// Error shape every Knowledge handler returns.
type ApiError = (StatusCode, Json<super::ErrorResponse>);

fn internal_error(error: encorehub_core::EngineError) -> ApiError {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(super::ErrorResponse {
            error: error.to_string(),
        }),
    )
}

/// Run the vector route, preferring LanceDB and falling back to SQLite-Vec.
async fn vector_route(
    state: &SharedState,
    query: &str,
    top_k: i64,
) -> Result<(RouteHits, &'static str), ApiError> {
    let lance_results = match &state.knowledge_vectors {
        Some(store) => store.search(query, top_k).await,
        None => Err(encorehub_core::EngineError::VectorStore(
            "LanceDB was unavailable during Engine startup".into(),
        )),
    };
    match lance_results {
        Ok(hits) => Ok((
            hits.into_iter()
                .map(|hit| {
                    (
                        ChunkCandidate {
                            id: hit.chunk_id,
                            document_id: hit.document_id,
                            content: hit.content,
                            chunk_index: hit.chunk_index,
                        },
                        hit.score,
                    )
                })
                .collect(),
            "lance_db",
        )),
        Err(error) => {
            tracing::warn!(error = %error, "LanceDB search unavailable; using SQLite-Vec");
            let results = state
                .db
                .search_knowledge_vectors(query, top_k)
                .map_err(internal_error)?;
            Ok((
                results
                    .into_iter()
                    .map(|hit| {
                        (
                            ChunkCandidate {
                                id: hit.item.id,
                                document_id: hit.item.document_id,
                                content: hit.item.content,
                                chunk_index: hit.item.chunk_index,
                            },
                            hit.score,
                        )
                    })
                    .collect(),
                "sqlite_vec",
            ))
        }
    }
}

/// Run the lexical route over the FTS5 chunk index. Display scores are
/// rank-based (`1.0` for the best hit, decaying by position) because BM25
/// magnitudes are not comparable across queries.
fn lexical_route(state: &SharedState, query: &str, top_k: i64) -> Result<RouteHits, ApiError> {
    let results = state
        .db
        .search_chunks_fts(query, top_k)
        .map_err(internal_error)?;
    Ok(results
        .into_iter()
        .enumerate()
        .map(|(index, (chunk, _rank))| {
            (
                ChunkCandidate {
                    id: chunk.id,
                    document_id: chunk.document_id,
                    content: chunk.content,
                    chunk_index: chunk.chunk_index,
                },
                1.0 / (index as f64 + 1.0),
            )
        })
        .collect())
}

/// Search embedded LanceDB and automatically use SQLite-Vec when unavailable.
/// The default hybrid route fuses lexical and vector rankings.
pub async fn search(
    State(state): State<SharedState>,
    Query(params): Query<SearchQuery>,
) -> Result<Json<SearchResponse>, (StatusCode, Json<super::ErrorResponse>)> {
    let (items, backend) = match params.retrieval {
        RetrievalMode::Vector => {
            let (hits, backend) = vector_route(&state, &params.q, params.top_k).await?;
            (
                hits.into_iter()
                    .map(|(candidate, score)| chunk_response(candidate, score))
                    .collect(),
                backend,
            )
        }
        RetrievalMode::Lexical => {
            let hits = lexical_route(&state, &params.q, params.top_k)?;
            (
                hits.into_iter()
                    .map(|(candidate, score)| chunk_response(candidate, score))
                    .collect(),
                "sqlite_fts",
            )
        }
        RetrievalMode::Hybrid => {
            let (vector_hits, _) = vector_route(&state, &params.q, params.top_k).await?;
            let lexical_hits = lexical_route(&state, &params.q, params.top_k)?;
            let vector_only: Vec<ChunkCandidate> = vector_hits
                .into_iter()
                .map(|(candidate, _)| candidate)
                .collect();
            let lexical_only: Vec<ChunkCandidate> = lexical_hits
                .into_iter()
                .map(|(candidate, _)| candidate)
                .collect();
            let fused = reciprocal_rank_fusion(
                &[&vector_only, &lexical_only],
                |candidate| candidate.id.as_str(),
                RRF_K,
            );
            // Normalize so the leading result reports relevance 1.0; the raw
            // RRF sum depends on the number of routes and is not user-facing.
            let top_score = fused.first().map(|(_, score)| *score).unwrap_or(1.0);
            let limit = params.top_k.max(0) as usize;
            (
                fused
                    .into_iter()
                    .take(limit)
                    .map(|(candidate, score)| {
                        let normalized = if top_score > 0.0 {
                            score / top_score
                        } else {
                            0.0
                        };
                        chunk_response(candidate, normalized)
                    })
                    .collect(),
                "hybrid",
            )
        }
    };

    Ok(Json(SearchResponse {
        results: items,
        query: params.q,
        backend,
    }))
}
