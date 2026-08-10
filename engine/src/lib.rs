//! Library facade for `encorehub-engine`.
//!
//! `main.rs` and `mcp_server.rs` are thin binary entrypoints (compiled only
//! with the `standalone` feature). The versioned `desktop-runtime` cdylib wraps
//! this crate for Tauri without exposing Rust types across the module boundary.
//! Integration tests under `tests/` likewise import the [`api`] router builder
//! without spawning a process.

pub mod api;
pub mod crypto;
pub mod document_processing;
pub mod logging;
pub mod scrapling;

// Re-export the storage and skill types so embedders (Tauri) can name the
// arguments to [`serve`] without depending on those crates directly.
pub use encorehub_skill::SkillRegistry;
pub use encorehub_storage::Database;

use logging::LogControl;

/// Environment variable used by standalone deployments and the gateway.
pub const ENGINE_AUTH_TOKEN_ENV: &str = "ENCOREHUB_ENGINE_AUTH_TOKEN";

/// Read the internal Engine token without ever including its value in errors.
pub fn require_internal_auth_token() -> anyhow::Result<String> {
    let token = std::env::var(ENGINE_AUTH_TOKEN_ENV)
        .map_err(|_| anyhow::anyhow!("{ENGINE_AUTH_TOKEN_ENV} must be set"))?;
    let token = token.trim();
    if token.is_empty() {
        anyhow::bail!("{ENGINE_AUTH_TOKEN_ENV} must not be empty");
    }
    Ok(token.to_owned())
}

/// Try to find a free TCP port on 127.0.0.1, probing from `start_port`.
///
/// Binds a synchronous listener to test availability, then immediately drops
/// it — there is a TOCTOU race between drop and real bind, but in practice
/// the OS reuses ports slowly enough that this is reliable for desktop use.
/// Returns `start_port` as a fallback if no port can be bound (should not
/// happen on a healthy system).
pub fn find_free_port(start_port: u16) -> u16 {
    for port in start_port..=65535 {
        let addr = format!("127.0.0.1:{port}");
        if std::net::TcpListener::bind(&addr).is_ok() {
            return port;
        }
    }
    start_port
}

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
    internal_auth_token: String,
) -> anyhow::Result<()> {
    serve_with_shutdown(
        db,
        skill_registry,
        log_control,
        bind_addr,
        internal_auth_token,
        std::future::pending(),
    )
    .await
}

/// Run the engine until `shutdown` resolves.
///
/// The desktop runtime module uses this variant so Engine can be restarted
/// without terminating the Tauri process. Standalone deployments keep using
/// [`serve`], which has no external shutdown future.
pub async fn serve_with_shutdown<F>(
    db: Database,
    skill_registry: SkillRegistry,
    log_control: Option<LogControl>,
    bind_addr: String,
    internal_auth_token: String,
    shutdown: F,
) -> anyhow::Result<()>
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    let internal_auth_token = internal_auth_token.trim().to_owned();
    if internal_auth_token.is_empty() {
        anyhow::bail!("internal Engine authentication token must not be empty");
    }
    let app = api::build_router_with(db, skill_registry, log_control, internal_auth_token);
    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await?;
    Ok(())
}
