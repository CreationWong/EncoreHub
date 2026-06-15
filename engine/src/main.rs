//! EncoreHub Core Engine
//!
//! The Rust backend providing:
//! - Conversation management with SQLite persistence
//! - Memory system (conversation + global, LanceDB + SQLite)
//! - Knowledge base (vector search + fulltext)
//! - MCP Server/Client protocol implementation
//! - Skill execution engine
//! - Plugin host (WASM runtime)
//! - Web search orchestration
//! - OS abstraction layer

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
    tracing::info!("Database initialized");

    // Verify database works with a simple operation
    let config_key = "engine.version";
    db.set_config(config_key, r#""0.1.0""#)?;
    if let Some(entry) = db.get_config(config_key)? {
        tracing::info!("Config '{}' = {}", entry.key, entry.value_json);
    }

    tracing::info!("EncoreHub Engine ready. Press Ctrl+C to stop.");

    // Keep alive until shutdown signal
    tokio::signal::ctrl_c().await?;
    tracing::info!("EncoreHub Engine shutting down...");

    Ok(())
}
