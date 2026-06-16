//! Skill API handlers.

use crate::api::SharedState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use encorehub_skill::SkillRegistry;
use serde::{Deserialize, Serialize};
use std::sync::MutexGuard;

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

/// Acquire the skill-registry lock or return 500 — never panic.
///
/// `PoisonError` only happens if a thread holding the lock panicked, which
/// must not take the whole engine down with it.
fn lock_registry(
    state: &SharedState,
) -> Result<MutexGuard<'_, SkillRegistry>, StatusCode> {
    state.skill_registry.lock().map_err(|err| {
        tracing::error!(?err, "skill registry lock poisoned");
        StatusCode::INTERNAL_SERVER_ERROR
    })
}

fn to_response(s: &encorehub_skill::Skill) -> SkillResponse {
    SkillResponse {
        id: s.id.clone(),
        name: s.name.clone(),
        description: s.description.clone(),
        version: s.version.clone(),
        author: s.author.clone(),
        enabled: s.enabled,
        builtin: s.builtin,
        triggers: s.triggers.clone(),
        tool_count: s.tools.len(),
    }
}

/// List all skills.
pub async fn list_skills(
    State(state): State<SharedState>,
) -> Result<Json<SkillListResponse>, StatusCode> {
    let registry = lock_registry(&state)?;
    let skills: Vec<SkillResponse> = registry.list().into_iter().map(to_response).collect();
    Ok(Json(SkillListResponse { skills }))
}

/// Toggle a skill on/off.
pub async fn toggle_skill(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(req): Json<ToggleRequest>,
) -> Result<StatusCode, StatusCode> {
    let mut registry = lock_registry(&state)?;
    if registry.toggle(&id, req.enabled) {
        Ok(StatusCode::OK)
    } else {
        Ok(StatusCode::NOT_FOUND)
    }
}

/// Find skills matching a query.
pub async fn match_skills(
    State(state): State<SharedState>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<SkillListResponse>, StatusCode> {
    let query = params.get("q").map(|s| s.as_str()).unwrap_or("");
    let registry = lock_registry(&state)?;
    let skills: Vec<SkillResponse> = registry
        .find_matches(query)
        .into_iter()
        .map(to_response)
        .collect();
    Ok(Json(SkillListResponse { skills }))
}
