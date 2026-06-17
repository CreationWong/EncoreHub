//! EncoreHub Core Engine

use encorehub_engine::api;
use encorehub_skill::SkillRegistry;
use encorehub_storage::Database;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(fmt::layer().with_target(false))
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    tracing::info!("EncoreHub Engine starting...");

    // Database
    let db = Database::open_and_return("data/encorehub.db")?;
    db.set_config("engine.version", r#""0.2.0""#)?;
    tracing::info!("Database ready");

    // Skills
    let skill_registry = SkillRegistry::load("../skills");
    tracing::info!("Skills loaded: {} total", skill_registry.list().len());

    // HTTP server
    let app = api::build_router(db, skill_registry);
    let bind_addr = std::env::var("ENGINE_BIND").unwrap_or_else(|_| "127.0.0.1:3000".to_string());
    tracing::info!("Listening on http://{}", bind_addr);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
