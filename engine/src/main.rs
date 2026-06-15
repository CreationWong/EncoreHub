//! EncoreHub Core Engine
//!
//! The Rust backend providing:
//! - Conversation management with SQLite persistence
//! - Memory system (conversation + global, LanceDB + SQLite)
//! - REST API for the frontend and Go gateway
//! - MCP Server/Client protocol (coming)
//! - Skill execution engine (coming)
//! - Plugin host (coming)
//! - Web search orchestration (coming)
//! - OS abstraction layer (coming)

mod api;

use encorehub_storage::Database;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing/logging
    tracing_subscriber::registry()
        .with(fmt::layer().with_target(false))
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    tracing::info!("EncoreHub Engine starting...");

    // Open SQLite database
    let db = Database::open_and_return("data/encorehub.db")?;
    tracing::info!("Database initialized ({} migrations applied)", 4);

    // Verify database works
    let config_key = "engine.version";
    db.set_config(config_key, r#""0.1.0""#)?;

    // Build the HTTP router
    let app = api::build_router(db);
    let bind_addr = "127.0.0.1:3000";

    tracing::info!("EncoreHub Engine listening on http://{}", bind_addr);

    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
