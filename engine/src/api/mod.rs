mod config;
mod conversations;
mod knowledge;
mod memories;
mod plugins;
mod secrets;
mod skills;

use crate::crypto::MasterKey;
use crate::logging::LogControl;
use axum::{
    body::Body,
    extract::State,
    http::{header, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
    Json, Router,
};
use encorehub_skill::SkillRegistry;
use encorehub_storage::Database;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tower_http::trace::TraceLayer;

pub struct AppState {
    pub db: Database,
    pub skill_registry: Mutex<SkillRegistry>,
    /// Derived master key, present only while the database is unlocked. Held in
    /// memory only — never persisted — and zeroized when cleared on lock. A
    /// `None` here with encryption enabled means the caller must unlock first.
    pub master_key: Mutex<Option<MasterKey>>,
    /// Runtime control over the tracing subscriber's level filter. `None` in
    /// contexts that don't install a subscriber (e.g. integration tests).
    pub log_control: Option<LogControl>,
    /// Shared only with trusted internal callers. `None` deliberately rejects
    /// every protected request so an empty configuration can never fail open.
    internal_auth_token: Option<Arc<str>>,
}

pub type SharedState = Arc<AppState>;

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

#[derive(Debug, Serialize)]
struct DatabaseStatus {
    ok: bool,
    latency_ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
    database: DatabaseStatus,
}

#[derive(Debug, Serialize)]
struct LivenessResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
}

pub fn build_router(
    db: Database,
    skill_registry: SkillRegistry,
    log_control: LogControl,
    internal_auth_token: String,
) -> Router {
    build_router_with(db, skill_registry, Some(log_control), internal_auth_token)
}

/// Build the router with an optional [`LogControl`]. Integration tests pass
/// `None` (they don't install a tracing subscriber); the binary passes `Some`.
pub fn build_router_with(
    db: Database,
    skill_registry: SkillRegistry,
    log_control: Option<LogControl>,
    internal_auth_token: String,
) -> Router {
    let internal_auth_token = internal_auth_token.trim();
    let internal_auth_token = if internal_auth_token.is_empty() {
        None
    } else {
        Some(Arc::<str>::from(internal_auth_token))
    };
    let state = Arc::new(AppState {
        db,
        skill_registry: Mutex::new(skill_registry),
        master_key: Mutex::new(None),
        log_control,
        internal_auth_token,
    });

    let protected = Router::new()
        // Plugins
        .route(
            "/api/plugins",
            get(plugins::list_plugins).post(plugins::install_plugin),
        )
        // Skills
        .route("/api/skills", get(skills::list_skills))
        .route("/api/skills/match", get(skills::match_skills))
        .route("/api/skills/:id/toggle", post(skills::toggle_skill))
        // Knowledge base
        .route(
            "/api/knowledge",
            get(knowledge::list).post(knowledge::ingest),
        )
        .route("/api/knowledge/search", get(knowledge::search))
        .route("/api/knowledge/:id", delete(knowledge::delete))
        // Memory search
        .route("/api/memories", get(memories::list))
        .route("/api/memories/search", get(memories::search))
        .route("/api/memories/:id", delete(memories::delete))
        // Messages
        .route(
            "/api/conversations/:id/messages/append",
            post(conversations::add_message),
        )
        .route(
            "/api/conversations/:id/messages",
            get(conversations::get_messages).post(conversations::send_message),
        )
        .route(
            "/api/conversations/:id/turns",
            post(conversations::begin_turn),
        )
        .route(
            "/api/conversations/:id/turns/:turn_id/finalize",
            post(conversations::finalize_turn),
        )
        // Conversations
        .route(
            "/api/conversations/:id",
            get(conversations::get_one)
                .delete(conversations::delete)
                .patch(conversations::update),
        )
        .route(
            "/api/conversations/:id/title",
            patch(conversations::update_title),
        )
        .route(
            "/api/conversations",
            get(conversations::list).post(conversations::create),
        )
        // Config (key/value JSON store — e.g. provider_profiles)
        .route("/api/config/:key", get(config::get).put(config::put))
        // Secrets / encryption lifecycle
        .route("/api/secrets/status", get(secrets::status))
        .route("/api/secrets/enable", post(secrets::enable))
        .route("/api/secrets/disable", post(secrets::disable))
        .route("/api/secrets/unlock", post(secrets::unlock))
        .route("/api/secrets/lock", post(secrets::lock))
        .route("/api/secrets/reset-password", post(secrets::reset_password))
        .route("/api/secrets/clear", post(secrets::clear))
        .route("/api/secrets", get(secrets::list).put(secrets::put_key))
        .route(
            "/api/secrets/:provider_id",
            get(secrets::get_key).delete(secrets::delete_key),
        )
        // Readiness includes database state and is internal-only. `/health`
        // remains a compatibility alias for older trusted callers.
        .route("/health/ready", get(readiness_check))
        .route("/health", get(readiness_check))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_internal_auth,
        ));

    Router::new()
        .route("/health/live", get(liveness_check))
        .merge(protected)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn require_internal_auth(
    State(state): State<SharedState>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let authorized = state
        .internal_auth_token
        .as_deref()
        .is_some_and(|expected| valid_bearer_token(request.headers(), expected));

    if !authorized {
        return (
            StatusCode::UNAUTHORIZED,
            [(header::WWW_AUTHENTICATE, "Bearer")],
            Json(ErrorResponse {
                error: "unauthorized".to_string(),
            }),
        )
            .into_response();
    }

    next.run(request).await
}

fn valid_bearer_token(headers: &axum::http::HeaderMap, expected: &str) -> bool {
    let Some(candidate) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return false;
    };

    constant_time_eq(candidate.as_bytes(), expected.as_bytes())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }

    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

async fn liveness_check() -> Json<LivenessResponse> {
    Json(LivenessResponse {
        status: "ok",
        service: "encorehub-engine",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn readiness_check(State(state): State<SharedState>) -> (StatusCode, Json<HealthResponse>) {
    // Cheap round-trip: read a config row that always exists post-migration.
    // Failure here means SQLite is unreachable / locked — the rest of the
    let start = Instant::now();
    let (http_status, status, db) = match state.db.get_config("engine.version") {
        Ok(_) => (
            StatusCode::OK,
            "ok",
            DatabaseStatus {
                ok: true,
                latency_ms: start.elapsed().as_millis(),
                error: None,
            },
        ),
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "not_ready",
            DatabaseStatus {
                ok: false,
                latency_ms: start.elapsed().as_millis(),
                error: Some(e.to_string()),
            },
        ),
    };

    (
        http_status,
        Json(HealthResponse {
            status,
            service: "encorehub-engine",
            version: env!("CARGO_PKG_VERSION"),
            database: db,
        }),
    )
}
