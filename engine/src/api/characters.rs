use crate::api::{ErrorResponse, SharedState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use encorehub_core::{CharacterProfile, EngineError};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const MAX_NAME_CHARS: usize = 100;
const MAX_AVATAR_CHARS: usize = 4096;
const MAX_DESCRIPTION_CHARS: usize = 16_384;
const MAX_SYSTEM_PROMPT_CHARS: usize = 65_536;
const MAX_OPENING_MESSAGE_CHARS: usize = 16_384;
const MAX_PROVIDER_CHARS: usize = 100;
const MAX_MODEL_CHARS: usize = 200;
const MAX_TAGS: usize = 50;
const MAX_TAG_CHARS: usize = 64;

type ApiError = (StatusCode, Json<ErrorResponse>);

#[derive(Debug, Deserialize)]
pub struct CreateCharacterRequest {
    pub name: String,
    #[serde(default)]
    pub avatar: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub default_provider: String,
    #[serde(default)]
    pub default_model: String,
    #[serde(default)]
    pub opening_message: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCharacterRequest {
    pub expected_version: i64,
    pub name: Option<String>,
    pub avatar: Option<String>,
    pub description: Option<String>,
    pub system_prompt: Option<String>,
    pub default_provider: Option<String>,
    pub default_model: Option<String>,
    pub opening_message: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct CharacterListResponse {
    pub characters: Vec<CharacterProfile>,
    pub total: usize,
}

pub async fn create(
    State(state): State<SharedState>,
    Json(request): Json<CreateCharacterRequest>,
) -> Result<(StatusCode, Json<CharacterProfile>), ApiError> {
    let mut profile = CharacterProfile::new(request.name);
    profile.avatar = request.avatar;
    profile.description = request.description;
    profile.system_prompt = request.system_prompt;
    profile.default_provider = request.default_provider;
    profile.default_model = request.default_model;
    profile.opening_message = request.opening_message;
    profile.tags = normalize_tags(request.tags);
    normalize_profile(&mut profile);
    validate_profile(&profile)?;
    state
        .db
        .create_character_profile(&profile)
        .map_err(map_engine_error)?;
    Ok((StatusCode::CREATED, Json(profile)))
}

pub async fn list(
    State(state): State<SharedState>,
) -> Result<Json<CharacterListResponse>, ApiError> {
    let characters = state
        .db
        .list_character_profiles()
        .map_err(map_engine_error)?;
    let total = characters.len();
    Ok(Json(CharacterListResponse { characters, total }))
}

pub async fn get_one(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<CharacterProfile>, ApiError> {
    state
        .db
        .get_character_profile(&id)
        .map(Json)
        .map_err(map_engine_error)
}

pub async fn update(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(request): Json<UpdateCharacterRequest>,
) -> Result<Json<CharacterProfile>, ApiError> {
    if request.expected_version < 1 {
        return Err(bad_request("expected_version must be positive"));
    }
    if request.name.is_none()
        && request.avatar.is_none()
        && request.description.is_none()
        && request.system_prompt.is_none()
        && request.default_provider.is_none()
        && request.default_model.is_none()
        && request.opening_message.is_none()
        && request.tags.is_none()
    {
        return Err(bad_request("at least one profile field is required"));
    }

    let mut profile = state
        .db
        .get_character_profile(&id)
        .map_err(map_engine_error)?;
    if let Some(value) = request.name {
        profile.name = value;
    }
    if let Some(value) = request.avatar {
        profile.avatar = value;
    }
    if let Some(value) = request.description {
        profile.description = value;
    }
    if let Some(value) = request.system_prompt {
        profile.system_prompt = value;
    }
    if let Some(value) = request.default_provider {
        profile.default_provider = value;
    }
    if let Some(value) = request.default_model {
        profile.default_model = value;
    }
    if let Some(value) = request.opening_message {
        profile.opening_message = value;
    }
    if let Some(value) = request.tags {
        profile.tags = normalize_tags(value);
    }
    normalize_profile(&mut profile);
    validate_profile(&profile)?;
    profile.version = request.expected_version + 1;
    profile.updated_at = chrono::Utc::now();
    state
        .db
        .update_character_profile(&profile, request.expected_version)
        .map_err(map_engine_error)?;
    Ok(Json(profile))
}

pub async fn delete(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state
        .db
        .delete_character_profile(&id)
        .map_err(map_engine_error)?;
    Ok(StatusCode::NO_CONTENT)
}

fn normalize_profile(profile: &mut CharacterProfile) {
    profile.name = profile.name.trim().to_string();
    profile.avatar = profile.avatar.trim().to_string();
    profile.description = profile.description.trim().to_string();
    profile.system_prompt = profile.system_prompt.trim().to_string();
    profile.default_provider = profile.default_provider.trim().to_string();
    profile.default_model = profile.default_model.trim().to_string();
    profile.opening_message = profile.opening_message.trim().to_string();
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    tags.into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .filter(|tag| seen.insert(tag.to_lowercase()))
        .collect()
}

fn validate_profile(profile: &CharacterProfile) -> Result<(), ApiError> {
    validate_required_length("name", &profile.name, MAX_NAME_CHARS)?;
    validate_length("avatar", &profile.avatar, MAX_AVATAR_CHARS)?;
    validate_length("description", &profile.description, MAX_DESCRIPTION_CHARS)?;
    validate_length(
        "system_prompt",
        &profile.system_prompt,
        MAX_SYSTEM_PROMPT_CHARS,
    )?;
    validate_length(
        "opening_message",
        &profile.opening_message,
        MAX_OPENING_MESSAGE_CHARS,
    )?;
    validate_length(
        "default_provider",
        &profile.default_provider,
        MAX_PROVIDER_CHARS,
    )?;
    validate_length("default_model", &profile.default_model, MAX_MODEL_CHARS)?;
    if profile.default_provider.is_empty() != profile.default_model.is_empty() {
        return Err(bad_request(
            "default_provider and default_model must be set together",
        ));
    }
    if profile.tags.len() > MAX_TAGS {
        return Err(bad_request("too many tags"));
    }
    for tag in &profile.tags {
        validate_length("tags", tag, MAX_TAG_CHARS)?;
    }
    Ok(())
}

fn validate_required_length(field: &str, value: &str, max: usize) -> Result<(), ApiError> {
    if value.is_empty() {
        return Err(bad_request(&format!("{field} cannot be empty")));
    }
    validate_length(field, value, max)
}

fn validate_length(field: &str, value: &str, max: usize) -> Result<(), ApiError> {
    if value.chars().count() > max {
        return Err(bad_request(&format!("{field} exceeds {max} characters")));
    }
    Ok(())
}

fn bad_request(message: &str) -> ApiError {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            error: message.into(),
        }),
    )
}

fn map_engine_error(error: EngineError) -> ApiError {
    let status = match &error {
        EngineError::NotFound { .. } => StatusCode::NOT_FOUND,
        EngineError::AlreadyExists { .. } | EngineError::InvalidArgument(_) => StatusCode::CONFLICT,
        EngineError::Validation { .. } => StatusCode::BAD_REQUEST,
        _ => {
            tracing::error!(error_type = %std::any::type_name_of_val(&error), "character operation failed");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    };
    (
        status,
        Json(ErrorResponse {
            error: error.to_string(),
        }),
    )
}
