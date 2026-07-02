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
    extract::State,
    routing::{delete, get, patch, post},
    Json, Router,
};
use encorehub_skill::SkillRegistry;
use encorehub_storage::Database;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tower_http::cors::{Any, CorsLayer};
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

pub fn build_router(
    db: Database,
    skill_registry: SkillRegistry,
    log_control: LogControl,
) -> Router {
    build_router_with(db, skill_registry, Some(log_control))
}

/// Build the router with an optional [`LogControl`]. Integration tests pass
/// `None` (they don't install a tracing subscriber); the binary passes `Some`.
pub fn build_router_with(
    db: Database,
    skill_registry: SkillRegistry,
    log_control: Option<LogControl>,
) -> Router {
    let state = Arc::new(AppState {
        db,
        skill_registry: Mutex::new(skill_registry),
        master_key: Mutex::new(None),
        log_control,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
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
        // Health
        .route("/health", get(health_check))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health_check(State(state): State<SharedState>) -> Json<HealthResponse> {
    // Cheap round-trip: read a config row that always exists post-migration.
    // Failure here means SQLite is unreachable / locked — the rest of the
    // service is effectively dead but we still report 200 so the gateway can
    // distinguish "engine process up but database broken" from "engine down".
    let start = Instant::now();
    let db = match state.db.get_config("engine.version") {
        Ok(_) => DatabaseStatus {
            ok: true,
            latency_ms: start.elapsed().as_millis(),
            error: None,
        },
        Err(e) => DatabaseStatus {
            ok: false,
            latency_ms: start.elapsed().as_millis(),
            error: Some(e.to_string()),
        },
    };

    Json(HealthResponse {
        status: "ok",
        service: "encorehub-engine",
        version: env!("CARGO_PKG_VERSION"),
        database: db,
    })
}
