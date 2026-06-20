//! Generic key/value config API. Currently used for `provider_profiles`
//! (the templated provider list the gateway loads), but the handlers work for
//! any config key backed by the `config` table.
//!
//! Values are opaque JSON: the engine stores and returns them verbatim and
//! does not interpret their shape. No secrets are stored here — provider
//! profiles carry endpoints and header *names*, never API keys.

use crate::api::SharedState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::Value;

/// GET /api/config/:key — return the stored JSON value, or `null` if unset.
pub async fn get(
    State(state): State<SharedState>,
    Path(key): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<super::ErrorResponse>)> {
    match state.db.get_config(&key) {
        Ok(Some(entry)) => {
            // value_json is whatever was last PUT; parse it back to JSON. A
            // corrupt row shouldn't 500 the caller — fall back to null.
            let value = serde_json::from_str(&entry.value_json).unwrap_or(Value::Null);
            Ok(Json(value))
        }
        Ok(None) => Ok(Json(Value::Null)),
        Err(e) => Err(internal(e)),
    }
}

/// PUT /api/config/:key — store the request body verbatim as the value.
///
/// Special-cases `log_level`: after persisting, applies the new level to the
/// running tracing subscriber so it takes effect immediately (no restart).
pub async fn put(
    State(state): State<SharedState>,
    Path(key): Path<String>,
    Json(body): Json<Value>,
) -> Result<StatusCode, (StatusCode, Json<super::ErrorResponse>)> {
    if key == "log_level" {
        // Validate + apply before persisting so a bad value is rejected.
        if let Some(level) = body.as_str() {
            if let Some(ctrl) = state.log_control.as_ref() {
                ctrl.set(level).map_err(|e| {
                    (
                        StatusCode::BAD_REQUEST,
                        Json(super::ErrorResponse { error: e }),
                    )
                })?;
            }
        } else {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(super::ErrorResponse {
                    error: "log_level must be a JSON string".into(),
                }),
            ));
        }
    }
    let value_json = serde_json::to_string(&body).map_err(internal)?;
    state.db.set_config(&key, &value_json).map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, Json<super::ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(super::ErrorResponse {
            error: e.to_string(),
        }),
    )
}
