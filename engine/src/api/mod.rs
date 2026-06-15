mod conversations;
mod knowledge;
mod memories;

use axum::{routing::{get, post, delete}, Router};
use encorehub_storage::Database;
use serde::Serialize;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

pub struct AppState {
    pub db: Database,
}

pub type SharedState = Arc<AppState>;

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

pub fn build_router(db: Database) -> Router {
    let state = Arc::new(AppState { db });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
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
