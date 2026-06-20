//! Secrets API: provider API-key storage with optional master-password
//! encryption (Sprint 6).
//!
//! Two modes, tracked by `crypto_meta.enabled`:
//! - **plaintext** (default): keys stored verbatim in `secrets.plaintext`. The
//!   user opted into at-rest plaintext; the UI warns about the risk.
//! - **encrypted**: keys stored as AES-256-GCM ciphertext under a key derived
//!   from the master password. Reads/writes require an unlocked session (the
//!   master key cached in `AppState::master_key`).
//!
//! Security invariants:
//! - Passwords and the derived master key are never persisted or logged.
//! - Error responses are generic ("incorrect password") — no key material,
//!   no password echo, no distinguishing which secret failed to decrypt.

use crate::api::{ErrorResponse, SharedState};
use crate::crypto::{self, MasterKey};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use encorehub_core::{CryptoMeta, SecretRow};
use serde::{Deserialize, Serialize};

type ApiError = (StatusCode, Json<ErrorResponse>);

fn err(code: StatusCode, msg: impl Into<String>) -> ApiError {
    (code, Json(ErrorResponse { error: msg.into() }))
}

fn internal(e: impl std::fmt::Display) -> ApiError {
    err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

// ===== Request/response shapes =====

#[derive(Serialize)]
pub struct StatusResponse {
    /// Whether the database is in encrypted mode.
    pub encrypted: bool,
    /// Whether a master key is currently cached (only meaningful when encrypted).
    pub unlocked: bool,
}

#[derive(Deserialize)]
pub struct EnableRequest {
    pub password: String,
    /// Optional extra keys to seed at enable time (e.g. the session keys the
    /// frontend holds), merged with any existing plaintext secrets.
    #[serde(default)]
    pub keys: std::collections::HashMap<String, String>,
}

#[derive(Deserialize)]
pub struct PasswordRequest {
    pub password: String,
}

#[derive(Deserialize)]
pub struct ResetRequest {
    pub old_password: String,
    pub new_password: String,
}

#[derive(Deserialize)]
pub struct PutKeyRequest {
    pub provider_id: String,
    pub key: String,
}

#[derive(Serialize)]
pub struct KeyResponse {
    pub key: String,
}

#[derive(Serialize)]
pub struct ListResponse {
    /// Provider ids that have a stored secret. Values are never listed.
    pub provider_ids: Vec<String>,
}

// ===== Handlers =====

/// GET /api/secrets/status
pub async fn status(State(state): State<SharedState>) -> Result<Json<StatusResponse>, ApiError> {
    let meta = state.db.get_crypto_meta().map_err(internal)?;
    let encrypted = meta.map(|m| m.enabled).unwrap_or(false);
    let unlocked = state.master_key.lock().unwrap().is_some();
    Ok(Json(StatusResponse {
        encrypted,
        unlocked,
    }))
}

/// POST /api/secrets/enable — turn on encryption, set the master password, and
/// encrypt all existing plaintext secrets (plus any seeded `keys`).
pub async fn enable(
    State(state): State<SharedState>,
    Json(req): Json<EnableRequest>,
) -> Result<StatusCode, ApiError> {
    if let Some(m) = state.db.get_crypto_meta().map_err(internal)? {
        if m.enabled {
            return Err(err(StatusCode::CONFLICT, "already encrypted"));
        }
    }
    if req.password.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "password required"));
    }

    let salt = crypto::generate_salt();
    let key = crypto::derive_key(req.password, &salt).map_err(crypto_err)?;
    let (vct, vnonce) = crypto::make_verifier(&key).map_err(crypto_err)?;

    // Gather everything to encrypt: existing plaintext rows + seeded keys.
    let mut plaintext: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for row in state.db.list_secrets().map_err(internal)? {
        if let Some(pt) = row.plaintext {
            plaintext.insert(row.provider_id, pt);
        }
    }
    for (pid, k) in req.keys {
        plaintext.insert(pid, k);
    }

    // Re-store each as ciphertext.
    for (pid, pt) in &plaintext {
        let (ct, nonce) = key.encrypt(pt.as_bytes()).map_err(crypto_err)?;
        state
            .db
            .upsert_secret(&encrypted_row(pid, ct, nonce))
            .map_err(internal)?;
    }

    state
        .db
        .set_crypto_meta(&CryptoMeta {
            enabled: true,
            salt,
            verifier_ciphertext: vct,
            verifier_nonce: vnonce,
            updated_at: chrono::Utc::now(),
        })
        .map_err(internal)?;

    // Unlocked immediately after enabling.
    *state.master_key.lock().unwrap() = Some(key);
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/secrets/disable — verify password, decrypt all secrets back to
/// plaintext, and turn encryption off.
pub async fn disable(
    State(state): State<SharedState>,
    Json(req): Json<PasswordRequest>,
) -> Result<StatusCode, ApiError> {
    let key = derive_and_verify(&state, req.password)?;

    for row in state.db.list_secrets().map_err(internal)? {
        if let (Some(ct), Some(nonce)) = (row.ciphertext, row.nonce) {
            let pt = key.decrypt(&ct, &nonce).map_err(crypto_err)?;
            let pt = String::from_utf8(pt).map_err(|_| internal("corrupt secret"))?;
            state
                .db
                .upsert_secret(&plaintext_row(&row.provider_id, pt))
                .map_err(internal)?;
        }
    }

    state.db.clear_crypto_meta().map_err(internal)?;
    *state.master_key.lock().unwrap() = None;
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/secrets/unlock — derive the key from the password, verify it
/// against the stored verifier, and cache it for the session.
pub async fn unlock(
    State(state): State<SharedState>,
    Json(req): Json<PasswordRequest>,
) -> Result<StatusCode, ApiError> {
    let key = derive_and_verify(&state, req.password)?;
    *state.master_key.lock().unwrap() = Some(key);
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/secrets/lock — drop the cached master key (zeroized on drop).
pub async fn lock(State(state): State<SharedState>) -> Result<StatusCode, ApiError> {
    *state.master_key.lock().unwrap() = None;
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/secrets/reset-password — verify the old password, then re-derive a
/// new key (new salt) and re-encrypt every secret + the verifier.
pub async fn reset_password(
    State(state): State<SharedState>,
    Json(req): Json<ResetRequest>,
) -> Result<StatusCode, ApiError> {
    if req.new_password.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "new password required"));
    }
    let old_key = derive_and_verify(&state, req.old_password)?;

    let new_salt = crypto::generate_salt();
    let new_key = crypto::derive_key(req.new_password, &new_salt).map_err(crypto_err)?;

    for row in state.db.list_secrets().map_err(internal)? {
        if let (Some(ct), Some(nonce)) = (row.ciphertext, row.nonce) {
            let pt = old_key.decrypt(&ct, &nonce).map_err(crypto_err)?;
            let (nct, nnonce) = new_key.encrypt(&pt).map_err(crypto_err)?;
            state
                .db
                .upsert_secret(&encrypted_row(&row.provider_id, nct, nnonce))
                .map_err(internal)?;
        }
    }

    let (vct, vnonce) = crypto::make_verifier(&new_key).map_err(crypto_err)?;
    state
        .db
        .set_crypto_meta(&CryptoMeta {
            enabled: true,
            salt: new_salt,
            verifier_ciphertext: vct,
            verifier_nonce: vnonce,
            updated_at: chrono::Utc::now(),
        })
        .map_err(internal)?;

    *state.master_key.lock().unwrap() = Some(new_key);
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/secrets/clear — wipe all secrets and crypto metadata. Used when the
/// master password is forgotten (unrecoverable; the UI warns first).
pub async fn clear(State(state): State<SharedState>) -> Result<StatusCode, ApiError> {
    state.db.clear_secrets().map_err(internal)?;
    state.db.clear_crypto_meta().map_err(internal)?;
    *state.master_key.lock().unwrap() = None;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/secrets — list provider ids that have a stored key (no values).
pub async fn list(State(state): State<SharedState>) -> Result<Json<ListResponse>, ApiError> {
    let provider_ids = state
        .db
        .list_secrets()
        .map_err(internal)?
        .into_iter()
        .map(|r| r.provider_id)
        .collect();
    Ok(Json(ListResponse { provider_ids }))
}

/// GET /api/secrets/:provider_id — return the decrypted key. In encrypted mode
/// this requires an unlocked session.
pub async fn get_key(
    State(state): State<SharedState>,
    Path(provider_id): Path<String>,
) -> Result<Json<KeyResponse>, ApiError> {
    let row = state
        .db
        .get_secret(&provider_id)
        .map_err(internal)?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "no key for provider"))?;

    let key = decrypt_row(&state, &row)?;
    Ok(Json(KeyResponse { key }))
}

/// PUT /api/secrets — store/replace one provider key. Encrypts when in
/// encrypted mode (requires unlock); otherwise stores plaintext.
pub async fn put_key(
    State(state): State<SharedState>,
    Json(req): Json<PutKeyRequest>,
) -> Result<StatusCode, ApiError> {
    if encryption_enabled(&state)? {
        let guard = state.master_key.lock().unwrap();
        let key = guard.as_ref().ok_or_else(locked)?;
        let (ct, nonce) = key.encrypt(req.key.as_bytes()).map_err(crypto_err)?;
        state
            .db
            .upsert_secret(&encrypted_row(&req.provider_id, ct, nonce))
            .map_err(internal)?;
    } else {
        state
            .db
            .upsert_secret(&plaintext_row(&req.provider_id, req.key))
            .map_err(internal)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/secrets/:provider_id
pub async fn delete_key(
    State(state): State<SharedState>,
    Path(provider_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state.db.delete_secret(&provider_id).map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

// ===== Helpers =====

fn crypto_err(e: crypto::CryptoError) -> ApiError {
    use crypto::CryptoError::*;
    match e {
        WrongPassword => err(StatusCode::UNAUTHORIZED, "incorrect password"),
        // Generic for the rest — don't leak which stage failed.
        _ => err(StatusCode::INTERNAL_SERVER_ERROR, "crypto operation failed"),
    }
}

fn locked() -> ApiError {
    err(StatusCode::LOCKED, "database is locked")
}

fn encryption_enabled(state: &SharedState) -> Result<bool, ApiError> {
    Ok(state
        .db
        .get_crypto_meta()
        .map_err(internal)?
        .map(|m| m.enabled)
        .unwrap_or(false))
}

/// Derive a key from `password` and verify it against the stored verifier.
/// Returns the derived key on success; `WrongPassword` → 401.
fn derive_and_verify(state: &SharedState, password: String) -> Result<MasterKey, ApiError> {
    let meta = state
        .db
        .get_crypto_meta()
        .map_err(internal)?
        .filter(|m| m.enabled)
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "encryption not enabled"))?;
    let key = crypto::derive_key(password, &meta.salt).map_err(crypto_err)?;
    crypto::verify(&key, &meta.verifier_ciphertext, &meta.verifier_nonce).map_err(crypto_err)?;
    Ok(key)
}

/// Decrypt a stored row to plaintext, handling both modes. Encrypted rows
/// require an unlocked session.
fn decrypt_row(state: &SharedState, row: &SecretRow) -> Result<String, ApiError> {
    if let Some(pt) = &row.plaintext {
        return Ok(pt.clone());
    }
    match (&row.ciphertext, &row.nonce) {
        (Some(ct), Some(nonce)) => {
            let guard = state.master_key.lock().unwrap();
            let key = guard.as_ref().ok_or_else(locked)?;
            let pt = key.decrypt(ct, nonce).map_err(crypto_err)?;
            String::from_utf8(pt).map_err(|_| internal("corrupt secret"))
        }
        _ => Err(internal("secret row has neither plaintext nor ciphertext")),
    }
}

fn encrypted_row(provider_id: &str, ciphertext: Vec<u8>, nonce: Vec<u8>) -> SecretRow {
    SecretRow {
        provider_id: provider_id.to_string(),
        plaintext: None,
        ciphertext: Some(ciphertext),
        nonce: Some(nonce),
        updated_at: chrono::Utc::now(),
    }
}

fn plaintext_row(provider_id: &str, plaintext: String) -> SecretRow {
    SecretRow {
        provider_id: provider_id.to_string(),
        plaintext: Some(plaintext),
        ciphertext: None,
        nonce: None,
        updated_at: chrono::Utc::now(),
    }
}
