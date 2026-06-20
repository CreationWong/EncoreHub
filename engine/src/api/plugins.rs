//! Plugin API handlers.
//!
//! Plugins are directories containing a plugin.json manifest.
//! Future: WASM runtime for sandboxed plugin execution.

use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::api::SharedState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginManifest {
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    #[serde(default)]
    pub hooks: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PluginInfo {
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub enabled: bool,
    pub hooks: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PluginListResponse {
    pub plugins: Vec<PluginInfo>,
}

/// List all installed plugins.
pub async fn list_plugins(State(_state): State<SharedState>) -> Json<PluginListResponse> {
    let mut plugins = Vec::new();

    // Scan ../plugins directory
    if let Ok(entries) = std::fs::read_dir("../plugins") {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let manifest_path = path.join("plugin.json");
                if let Ok(content) = std::fs::read_to_string(&manifest_path) {
                    if let Ok(manifest) = serde_json::from_str::<PluginManifest>(&content) {
                        plugins.push(PluginInfo {
                            name: manifest.name,
                            version: manifest.version,
                            description: manifest.description,
                            author: manifest.author,
                            enabled: true,
                            hooks: manifest.hooks,
                        });
                    }
                }
            }
        }
    }

    Json(PluginListResponse { plugins })
}

#[derive(Debug, Deserialize)]
pub struct InstallRequest {
    pub name: String,
    pub description: String,
    pub hooks: Vec<String>,
}

/// Install a new plugin (creates the directory and manifest).
pub async fn install_plugin(
    State(_state): State<SharedState>,
    Json(req): Json<InstallRequest>,
) -> Result<Json<PluginInfo>, StatusCode> {
    let dir = Path::new("../plugins").join(&req.name);
    std::fs::create_dir_all(&dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let manifest = PluginManifest {
        name: req.name.clone(),
        version: "1.0.0".into(),
        description: req.description,
        author: "user".into(),
        hooks: req.hooks,
        permissions: vec!["read_config".into()],
    };

    let json =
        serde_json::to_string_pretty(&manifest).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    std::fs::write(dir.join("plugin.json"), json).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(PluginInfo {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        enabled: true,
        hooks: manifest.hooks,
    }))
}
