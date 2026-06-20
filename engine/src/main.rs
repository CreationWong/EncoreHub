//! EncoreHub Core Engine

use encorehub_engine::api;
use encorehub_engine::logging::{normalize_level, LogControl};
use encorehub_skill::SkillRegistry;
use encorehub_storage::Database;
use tracing_subscriber::{fmt, prelude::*, reload, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Open the database first so we can read the persisted log level before the
    // subscriber is built.
    let db = Database::open_and_return("data/encorehub.db")?;

    // Resolve the initial log level: RUST_LOG (highest priority) > persisted
    // config `log_level` > "info" default.
    let persisted_level = db
        .get_config("log_level")
        .ok()
        .flatten()
        .and_then(|e| serde_json::from_str::<String>(&e.value_json).ok())
        .and_then(|s| normalize_level(&s).map(str::to_string));

    let initial_filter = match std::env::var("RUST_LOG") {
        Ok(v) => EnvFilter::new(v),
        Err(_) => EnvFilter::new(persisted_level.as_deref().unwrap_or("info")),
    };

    // Wrap the filter in a reload layer so the level can be changed at runtime
    // via /api/config/log_level.
    let (filter_layer, reload_handle) = reload::Layer::new(initial_filter);
    tracing_subscriber::registry()
        .with(filter_layer)
        .with(fmt::layer().with_target(false))
        .init();

    let log_control = LogControl::new(move |level| {
        let directive =
            normalize_level(level).ok_or_else(|| format!("invalid log level: {level}"))?;
        reload_handle
            .reload(EnvFilter::new(directive))
            .map_err(|e| e.to_string())
    });

    tracing::info!("EncoreHub Engine starting...");

    db.set_config("engine.version", r#""0.2.0""#)?;
    tracing::info!("Database ready");

    // Skills
    let skill_registry = SkillRegistry::load("../skills");
    tracing::info!("Skills loaded: {} total", skill_registry.list().len());

    // HTTP server
    let app = api::build_router(db, skill_registry, log_control);
    let bind_addr = std::env::var("ENGINE_BIND").unwrap_or_else(|_| "127.0.0.1:3000".to_string());
    tracing::info!("Listening on http://{}", bind_addr);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
