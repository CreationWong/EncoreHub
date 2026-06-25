//! Library facade for `encorehub-engine`.
//!
//! `main.rs` and `mcp_server.rs` are thin binary entrypoints (compiled only
//! with the `standalone` feature). This crate is also consumed directly by the
//! Tauri desktop app, which calls [`serve`] to run the axum service in-process
//! on its own tokio runtime instead of spawning a separate engine executable.
//! Integration tests under `tests/` likewise import the [`api`] router builder
//! without spawning a process.

pub mod api;
pub mod crypto;
pub mod logging;

// Re-export the storage and skill types so embedders (Tauri) can name the
// arguments to [`serve`] without depending on those crates directly.
pub use encorehub_skill::SkillRegistry;
pub use encorehub_storage::Database;

use logging::LogControl;

/// Run the engine's axum API on `bind_addr` until the listener stops.
///
/// Shared by the standalone binary and the Tauri embed path. The caller owns
/// process-level concerns (opening the database, loading skills, installing a
/// tracing subscriber); this function only builds the router and serves it.
/// Pass `Some(log_control)` to enable the runtime `/api/config/log_level`
/// switch, or `None` when no reloadable subscriber is installed.
pub async fn serve(
    db: Database,
    skill_registry: SkillRegistry,
    log_control: Option<LogControl>,
    bind_addr: String,
) -> anyhow::Result<()> {
    let app = api::build_router_with(db, skill_registry, log_control);
    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
