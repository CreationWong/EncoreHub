//! HTTP API layer built on axum.
//!
//! Provides REST endpoints for the frontend to interact with the engine.

mod conversations;

use axum::{routing::get, Router};
use encorehub_storage::Database;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

/// Shared application state passed to all handlers.
pub struct AppState {
    pub db: Database,
}

pub type SharedState = Arc<AppState>;

/// Build the full API router.
pub fn build_router(db: Database) -> Router {
    let state = Arc::new(AppState { db });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Messages sub-route (using :id syntax for axum compatibility)
        .route("/api/conversations/:id/messages", get(conversations::get_messages).post(conversations::send_message))
        // Conversation by ID
        .route("/api/conversations/:id", get(conversations::get_one).delete(conversations::delete))
        // Conversation collection
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
