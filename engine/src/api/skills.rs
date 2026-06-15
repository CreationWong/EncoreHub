//! Skill API handlers.

use crate::api::SharedState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use encorehub_skill::SkillRegistry;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub struct SkillState {
    pub registry: Mutex<SkillRegistry>,
}

#[derive(Debug, Serialize)]
pub struct SkillResponse {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub enabled: bool,
    pub builtin: bool,
    pub triggers: Vec<String>,
    pub tool_count: usize,
}

#[derive(Debug, Serialize)]
pub struct SkillListResponse {
    pub skills: Vec<SkillResponse>,
}

#[derive(Debug, Deserialize)]
pub struct ToggleRequest {
    pub enabled: bool,
}

/// List all skills.
pub async fn list_skills(
    State(state): State<SharedState>,
) -> Json<SkillListResponse> {
    let registry = state.skill_registry.lock().unwrap();
    let skills: Vec<SkillResponse> = registry
        .list()
        .into_iter()
        .map(|s| SkillResponse {
            id: s.id.clone(),
            name: s.name.clone(),
            description: s.description.clone(),
            version: s.version.clone(),
            author: s.author.clone(),
            enabled: s.enabled,
            builtin: s.builtin,
            triggers: s.triggers.clone(),
            tool_count: s.tools.len(),
        })
        .collect();

    Json(SkillListResponse { skills })
}

/// Toggle a skill on/off.
pub async fn toggle_skill(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(req): Json<ToggleRequest>,
) -> StatusCode {
    let mut registry = state.skill_registry.lock().unwrap();
    if registry.toggle(&id, req.enabled) {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

/// Find skills matching a query.
pub async fn match_skills(
    State(state): State<SharedState>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Json<SkillListResponse> {
    let query = params.get("q").map(|s| s.as_str()).unwrap_or("");
    let registry = state.skill_registry.lock().unwrap();
    let matches = registry.find_matches(query);
    let skills: Vec<SkillResponse> = matches
        .into_iter()
        .map(|s| SkillResponse {
            id: s.id.clone(),
            name: s.name.clone(),
            description: s.description.clone(),
            version: s.version.clone(),
            author: s.author.clone(),
            enabled: s.enabled,
            builtin: s.builtin,
            triggers: s.triggers.clone(),
            tool_count: s.tools.len(),
        })
        .collect();

    Json(SkillListResponse { skills })
}
