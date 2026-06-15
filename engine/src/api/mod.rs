mod conversations;
mod knowledge;
mod memories;
mod plugins;
mod skills;

use axum::{routing::{delete, get, post}, Router};
use encorehub_skill::SkillRegistry;
use encorehub_storage::Database;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

pub struct AppState {
    pub db: Database,
    pub skill_registry: Mutex<SkillRegistry>,
}

pub type SharedState = Arc<AppState>;

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

pub fn build_router(db: Database, skill_registry: SkillRegistry) -> Router {
    let state = Arc::new(AppState {
        db,
        skill_registry: Mutex::new(skill_registry),
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Plugins
        .route("/api/plugins", get(plugins::list_plugins).post(plugins::install_plugin))
        // Skills
        .route("/api/skills", get(skills::list_skills))
        .route("/api/skills/match", get(skills::match_skills))
        .route("/api/skills/:id/toggle", post(skills::toggle_skill))
        // Knowledge base
        .route("/api/knowledge", get(knowledge::list).post(knowledge::ingest))
        .route("/api/knowledge/search", get(knowledge::search))
        .route("/api/knowledge/:id", delete(knowledge::delete))
        // Memory search
        .route("/api/memories", get(memories::list))
        .route("/api/memories/search", get(memories::search))
        .route("/api/memories/:id", delete(memories::delete))
        // Messages
        .route("/api/conversations/:id/messages/append", post(conversations::add_message))
        .route("/api/conversations/:id/messages", get(conversations::get_messages).post(conversations::send_message))
        // Conversations
        .route("/api/conversations/:id", get(conversations::get_one).delete(conversations::delete))
        .route("/api/conversations", get(conversations::list).post(conversations::create))
        // Health
        .route("/health", get(health_check))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health_check() -> &'static str {
    "ok"
}
