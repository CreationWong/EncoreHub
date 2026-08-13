//! User-facing management for non-configuration application data.
//!
//! Backups are portable JSON and intentionally exclude settings, credentials,
//! search cache, and derived vector indexes.

use crate::api::{ErrorResponse, SharedState};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use encorehub_storage::{
    BlobStore, DataConversation, DataDomain, DataOverview, ImportSummary, UserDataBackup,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

type ApiError = (StatusCode, Json<ErrorResponse>);

/// Optional comma-separated domains for an atomic scoped export.
#[derive(Debug, Deserialize)]
pub struct ExportQuery {
    domains: Option<String>,
}

/// Shared selection contract for conversation export and deletion.
#[derive(Debug, Deserialize)]
pub struct ConversationSelection {
    pub conversation_ids: Vec<String>,
}

/// Cache cleanup response separates database records from disk blobs.
#[derive(Debug, Serialize)]
pub struct CacheCleanupResponse {
    pub cache_entries: usize,
    pub orphaned_blobs: usize,
}

/// Conversation cleanup response reports the destructive scope.
#[derive(Debug, Serialize)]
pub struct HistoryCleanupResponse {
    pub conversations: usize,
    pub deleted_blobs: usize,
}

/// Return counts used by the Data settings panel.
pub async fn overview(State(state): State<SharedState>) -> Result<Json<DataOverview>, ApiError> {
    state.db.data_overview().map(Json).map_err(internal)
}

/// List conversations for granular selection in the data manager.
pub async fn conversations(
    State(state): State<SharedState>,
) -> Result<Json<Vec<DataConversation>>, ApiError> {
    state
        .db
        .list_data_conversations()
        .map(Json)
        .map_err(internal)
}

/// Export user-owned data plus attachment bytes as a versioned JSON document.
pub async fn export(
    State(state): State<SharedState>,
    Query(query): Query<ExportQuery>,
) -> Result<Json<UserDataBackup>, ApiError> {
    let domains = parse_domains(query.domains.as_deref())?;
    let backup = state
        .db
        .export_user_data_for(domains)
        .map_err(domain_error)?;
    with_attachment_content(&state, backup)
}

/// Export only selected conversations and the records required to restore them.
pub async fn export_conversations(
    State(state): State<SharedState>,
    Json(selection): Json<ConversationSelection>,
) -> Result<Json<UserDataBackup>, ApiError> {
    let backup = state
        .db
        .export_conversations(&selection.conversation_ids)
        .map_err(domain_error)?;
    with_attachment_content(&state, backup)
}

/// Delete only selected conversations in one database and blob transaction.
pub async fn delete_conversations(
    State(state): State<SharedState>,
    Json(selection): Json<ConversationSelection>,
) -> Result<Json<HistoryCleanupResponse>, ApiError> {
    let store = BlobStore::new(state.db.data_directory().join("blobs")).map_err(internal)?;
    let (cleanup, staged) = state
        .db
        .delete_conversations_atomically(&selection.conversation_ids, &store)
        .map_err(domain_error)?;
    let deleted_blobs = staged.len();
    if let Err(error) = staged.commit() {
        tracing::warn!(error = %error, "staged selected conversation blobs remain for deferred cleanup");
    }
    Ok(Json(HistoryCleanupResponse {
        conversations: cleanup.conversations,
        deleted_blobs,
    }))
}

fn with_attachment_content(
    state: &SharedState,
    mut backup: UserDataBackup,
) -> Result<Json<UserDataBackup>, ApiError> {
    let store = BlobStore::new(state.db.data_directory().join("blobs")).map_err(internal)?;
    for hash in attachment_hashes(&backup) {
        let bytes = store
            .get(&hash)
            .map_err(internal)?
            .ok_or_else(|| internal("attachment content is missing"))?;
        backup
            .blobs
            .insert(hash, encorehub_storage::encode_hex(&bytes));
    }
    Ok(Json(backup))
}

/// Parse the stable public names without accepting unknown backup scope.
fn parse_domains(value: Option<&str>) -> Result<Vec<DataDomain>, ApiError> {
    let Some(value) = value else {
        return Ok(DataDomain::all().into());
    };
    value
        .split(',')
        .map(|domain| match domain {
            "characters" => Ok(DataDomain::Characters),
            "conversations" => Ok(DataDomain::Conversations),
            "memories" => Ok(DataDomain::Memories),
            "knowledge" => Ok(DataDomain::Knowledge),
            _ => Err(bad_request("unsupported data domain")),
        })
        .collect()
}

/// Additively import a validated user-data backup and its attachment content.
pub async fn import(
    State(state): State<SharedState>,
    Json(backup): Json<UserDataBackup>,
) -> Result<Json<ImportSummary>, ApiError> {
    let store = BlobStore::new(state.db.data_directory().join("blobs")).map_err(internal)?;
    let existing = store
        .list_hashes()
        .map_err(internal)?
        .into_iter()
        .collect::<HashSet<_>>();
    let mut decoded_blobs = Vec::with_capacity(backup.blobs.len());
    for (expected_hash, encoded) in &backup.blobs {
        let bytes = encorehub_storage::decode_hex(encoded).map_err(bad_request)?;
        let actual_hash = BlobStore::content_hash(&bytes);
        if &actual_hash != expected_hash {
            return Err(bad_request("backup attachment digest mismatch"));
        }
        decoded_blobs.push((expected_hash.clone(), bytes));
    }
    let attachment_hashes = attachment_hashes(&backup);
    let blob_hashes = backup.blobs.keys().cloned().collect::<HashSet<_>>();
    if attachment_hashes != blob_hashes {
        return Err(bad_request(
            "backup attachment metadata and content do not match",
        ));
    }
    let mut written: Vec<String> = Vec::new();
    for (hash, bytes) in decoded_blobs {
        if let Err(error) = store.store(&bytes) {
            for written_hash in written {
                let _ = store.delete(&written_hash);
            }
            return Err(internal(error));
        }
        if !existing.contains(&hash) {
            written.push(hash);
        }
    }
    let mut summary = match state.db.import_user_data(&backup) {
        Ok(summary) => summary,
        Err(error) => {
            for hash in written {
                let _ = store.delete(&hash);
            }
            return Err(domain_error(error));
        }
    };
    summary.imported_blobs = backup.blobs.len();
    Ok(Json(summary))
}

/// Delete all conversation history while preserving characters, memory, and knowledge.
pub async fn clear_history(
    State(state): State<SharedState>,
) -> Result<Json<HistoryCleanupResponse>, ApiError> {
    let store = BlobStore::new(state.db.data_directory().join("blobs")).map_err(internal)?;
    let (cleanup, staged) = state
        .db
        .clear_conversation_history_atomically(&store)
        .map_err(internal)?;
    let deleted_blobs = staged.len();
    if let Err(error) = staged.commit() {
        tracing::warn!(error = %error, "staged conversation blobs remain for deferred cleanup");
    }
    Ok(Json(HistoryCleanupResponse {
        conversations: cleanup.conversations,
        deleted_blobs,
    }))
}

/// Remove regenerable database cache and blob files no longer referenced by data.
pub async fn clear_cache(
    State(state): State<SharedState>,
) -> Result<Json<CacheCleanupResponse>, ApiError> {
    let store = BlobStore::new(state.db.data_directory().join("blobs")).map_err(internal)?;
    let (cleanup, staged) = state
        .db
        .clear_regenerable_cache_atomically(&store)
        .map_err(internal)?;
    let orphaned_blobs = staged.len();
    if let Err(error) = staged.commit() {
        tracing::warn!(error = %error, "staged cache blobs remain for deferred cleanup");
    }
    Ok(Json(CacheCleanupResponse {
        cache_entries: cleanup.cache_entries,
        orphaned_blobs,
    }))
}

/// Read attachment hashes from the whitelisted attachment export rows.
fn attachment_hashes(backup: &UserDataBackup) -> HashSet<String> {
    backup
        .tables
        .get("attachments")
        .into_iter()
        .flatten()
        .filter_map(|row| row.get("sha256")?.as_str().map(str::to_string))
        .collect()
}

/// Map invalid backup content to a stable client error.
fn bad_request(error: impl ToString) -> ApiError {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            error: error.to_string(),
        }),
    )
}

/// Preserve validation errors while hiding internal storage detail.
fn domain_error(error: encorehub_core::EngineError) -> ApiError {
    match error {
        encorehub_core::EngineError::InvalidArgument(message) => bad_request(message),
        other => internal(other),
    }
}

/// Return a generic storage failure after recording the local diagnostic.
fn internal(error: impl ToString) -> ApiError {
    tracing::error!(error = %error.to_string(), "data management operation failed");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: "data management operation failed".into(),
        }),
    )
}
