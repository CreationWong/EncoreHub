//! SQLite persistence for versioned characters and their conversation snapshots.

use super::{
    conversation_from_row, now_ms, parse_tags_json, Database, Result, CONVERSATION_COLUMNS,
};
use encorehub_core::{
    CharacterBranch, CharacterHistory, CharacterProfile, CharacterUpgradePreview, CharacterVersion,
    Conversation, EngineError, DEFAULT_CHARACTER_ID,
};
use rusqlite::{params, Connection, ErrorCode, Row};

const CHARACTER_COLUMNS: &str = "id, name, avatar, description, system_prompt, default_provider,
     default_model, opening_message, tags_json, version, revision, active_branch,
     created_at, updated_at, deleted_at";

fn character_from_row(row: &Row<'_>) -> rusqlite::Result<CharacterProfile> {
    Ok(CharacterProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        avatar: row.get(2)?,
        description: row.get(3)?,
        system_prompt: row.get(4)?,
        default_provider: row.get(5)?,
        default_model: row.get(6)?,
        opening_message: row.get(7)?,
        tags: parse_tags_json(row.get(8)?),
        version: row.get(9)?,
        revision: row.get(10)?,
        active_branch: row.get(11)?,
        created_at: super::ts_to_dt(row.get::<_, i64>(12)?),
        updated_at: super::ts_to_dt(row.get::<_, i64>(13)?),
        deleted_at: row.get::<_, Option<i64>>(14)?.map(super::ts_to_dt),
    })
}

fn character_version_from_row(row: &Row<'_>) -> rusqlite::Result<CharacterVersion> {
    Ok(CharacterVersion {
        character_id: row.get(0)?,
        version: row.get(1)?,
        parent_version: row.get(2)?,
        branch_name: row.get(3)?,
        message: row.get(4)?,
        name: row.get(5)?,
        avatar: row.get(6)?,
        description: row.get(7)?,
        system_prompt: row.get(8)?,
        default_provider: row.get(9)?,
        default_model: row.get(10)?,
        opening_message: row.get(11)?,
        tags: parse_tags_json(row.get(12)?),
        created_at: super::ts_to_dt(row.get::<_, i64>(13)?),
    })
}

fn character_branch_from_row(row: &Row<'_>) -> rusqlite::Result<CharacterBranch> {
    Ok(CharacterBranch {
        character_id: row.get(0)?,
        name: row.get(1)?,
        head_version: row.get(2)?,
        created_from_version: row.get(3)?,
        created_at: super::ts_to_dt(row.get::<_, i64>(4)?),
        updated_at: super::ts_to_dt(row.get::<_, i64>(5)?),
    })
}

fn get_character_version(
    conn: &Connection,
    character_id: &str,
    version: i64,
) -> Result<CharacterVersion> {
    conn.query_row(
        "SELECT character_id, version, parent_version, branch_name, message,
                name, avatar, description, system_prompt, default_provider,
                default_model, opening_message, tags_json, created_at
           FROM character_profile_versions
          WHERE character_id = ?1 AND version = ?2",
        params![character_id, version],
        character_version_from_row,
    )
    .map_err(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => EngineError::NotFound {
            resource: "character version".into(),
            id: format!("{character_id}@{version}"),
        },
        other => other.into(),
    })
}

fn apply_version_to_working_copy(
    conn: &Connection,
    version: &CharacterVersion,
    revision: i64,
    active_branch: &str,
    updated_at: i64,
) -> Result<()> {
    let tags_json = serde_json::to_string(&version.tags)?;
    conn.execute(
        "UPDATE character_profiles SET
            name = ?1, avatar = ?2, description = ?3, system_prompt = ?4,
            default_provider = ?5, default_model = ?6, opening_message = ?7,
            tags_json = ?8, version = ?9, revision = ?10, active_branch = ?11,
            updated_at = ?12
         WHERE id = ?13 AND deleted_at IS NULL",
        params![
            version.name,
            version.avatar,
            version.description,
            version.system_prompt,
            version.default_provider,
            version.default_model,
            version.opening_message,
            tags_json,
            version.version,
            revision,
            active_branch,
            updated_at,
            version.character_id,
        ],
    )?;
    Ok(())
}

fn get_character_from_connection(
    conn: &Connection,
    id: &str,
    include_deleted: bool,
) -> Result<CharacterProfile> {
    let deleted_clause = if include_deleted {
        ""
    } else {
        " AND deleted_at IS NULL"
    };
    conn.query_row(
        &format!(
            "SELECT {CHARACTER_COLUMNS} FROM character_profiles
             WHERE id = ?1{deleted_clause}"
        ),
        params![id],
        character_from_row,
    )
    .map_err(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => EngineError::NotFound {
            resource: "character".into(),
            id: id.into(),
        },
        other => other.into(),
    })
}

fn map_character_write_error(error: rusqlite::Error, id: &str) -> EngineError {
    match &error {
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == ErrorCode::ConstraintViolation =>
        {
            EngineError::AlreadyExists {
                resource: "character".into(),
                id: id.into(),
            }
        }
        _ => error.into(),
    }
}

fn insert_character_version(
    conn: &Connection,
    profile: &CharacterProfile,
    tags_json: &str,
    parent_version: Option<i64>,
    message: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO character_profile_versions
         (character_id, version, name, avatar, description, system_prompt,
          default_provider, default_model, opening_message, tags_json, created_at,
          parent_version, branch_name, message)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            profile.id,
            profile.version,
            profile.name,
            profile.avatar,
            profile.description,
            profile.system_prompt,
            profile.default_provider,
            profile.default_model,
            profile.opening_message,
            tags_json,
            profile.updated_at.timestamp_millis(),
            parent_version,
            profile.active_branch,
            message,
        ],
    )
    .map_err(|error| map_character_write_error(error, &profile.id))?;
    Ok(())
}

fn resolved_model(profile: &CharacterProfile, selection: Option<(&str, &str)>) -> (String, String) {
    if let Some((provider, model)) = selection {
        return (provider.into(), model.into());
    }
    if !profile.default_provider.is_empty() && !profile.default_model.is_empty() {
        return (
            profile.default_provider.clone(),
            profile.default_model.clone(),
        );
    }
    ("openai".into(), "gpt-4o".into())
}

fn resolved_upgrade_model(
    profile: &CharacterProfile,
    conversation: &Conversation,
) -> (String, String) {
    if !profile.default_provider.is_empty() && !profile.default_model.is_empty() {
        return (
            profile.default_provider.clone(),
            profile.default_model.clone(),
        );
    }
    (conversation.provider.clone(), conversation.model.clone())
}

fn changed_fields(
    conversation: &Conversation,
    profile: &CharacterProfile,
    proposed_provider: &str,
    proposed_model: &str,
) -> Vec<String> {
    let proposed = profile.snapshot();
    let current = &conversation.character_snapshot;
    let mut fields = Vec::new();
    for (name, changed) in [
        ("name", current.name != proposed.name),
        ("avatar", current.avatar != proposed.avatar),
        ("description", current.description != proposed.description),
        (
            "system_prompt",
            current.system_prompt != proposed.system_prompt,
        ),
        (
            "opening_message",
            current.opening_message != proposed.opening_message,
        ),
        ("tags", current.tags != proposed.tags),
        ("provider", conversation.provider != proposed_provider),
        ("model", conversation.model != proposed_model),
    ] {
        if changed {
            fields.push(name.into());
        }
    }
    fields
}

impl Database {
    pub fn create_character_profile(&self, profile: &CharacterProfile) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        let tags_json = serde_json::to_string(&profile.tags)?;
        transaction
            .execute(
                "INSERT INTO character_profiles
                 (id, name, avatar, description, system_prompt, default_provider,
                  default_model, opening_message, tags_json, version, revision,
                  active_branch, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    profile.id,
                    profile.name,
                    profile.avatar,
                    profile.description,
                    profile.system_prompt,
                    profile.default_provider,
                    profile.default_model,
                    profile.opening_message,
                    tags_json,
                    profile.version,
                    profile.revision,
                    profile.active_branch,
                    profile.created_at.timestamp_millis(),
                    profile.updated_at.timestamp_millis(),
                ],
            )
            .map_err(|error| map_character_write_error(error, &profile.id))?;
        insert_character_version(&transaction, profile, &tags_json, None, "Initial version")?;
        transaction.execute(
            "INSERT INTO character_profile_branches
             (character_id, name, head_version, created_from_version, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3, ?4, ?4)",
            params![
                profile.id,
                profile.active_branch,
                profile.version,
                profile.created_at.timestamp_millis(),
            ],
        )?;
        let memory_group_id = format!("character:{}", profile.id);
        transaction.execute(
            "INSERT INTO memory_groups
                (id, profile_id, name, group_type, owner_character_id, created_at, updated_at)
             VALUES (?1, 'local', ?2, 'character', ?3, ?4, ?4)",
            params![
                memory_group_id,
                profile.name,
                profile.id,
                profile.created_at.timestamp_millis(),
            ],
        )?;
        transaction.execute(
            "INSERT INTO character_memory_settings
                (character_id, default_mode, realistic_enabled, updated_at)
             VALUES (?1, 'simple', 0, ?2)",
            params![profile.id, profile.created_at.timestamp_millis()],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn get_character_profile(&self, id: &str) -> Result<CharacterProfile> {
        let conn = self.conn.lock().unwrap();
        get_character_from_connection(&conn, id, false)
    }

    pub fn list_character_profiles(&self) -> Result<Vec<CharacterProfile>> {
        let conn = self.conn.lock().unwrap();
        let mut statement = conn.prepare(&format!(
            "SELECT {CHARACTER_COLUMNS} FROM character_profiles
             WHERE deleted_at IS NULL
             ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, updated_at DESC"
        ))?;
        let rows = statement.query_map([], character_from_row)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn update_character_profile(
        &self,
        profile: &CharacterProfile,
        expected_revision: i64,
    ) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        let tags_json = serde_json::to_string(&profile.tags)?;
        let rows = transaction
            .execute(
                "UPDATE character_profiles SET
                    name = ?1, avatar = ?2, description = ?3, system_prompt = ?4,
                    default_provider = ?5, default_model = ?6, opening_message = ?7,
                    tags_json = ?8, revision = ?9, updated_at = ?10
                 WHERE id = ?11 AND revision = ?12 AND deleted_at IS NULL",
                params![
                    profile.name,
                    profile.avatar,
                    profile.description,
                    profile.system_prompt,
                    profile.default_provider,
                    profile.default_model,
                    profile.opening_message,
                    tags_json,
                    profile.revision,
                    profile.updated_at.timestamp_millis(),
                    profile.id,
                    expected_revision,
                ],
            )
            .map_err(|error| map_character_write_error(error, &profile.id))?;
        if rows == 0 {
            get_character_from_connection(&transaction, &profile.id, false)?;
            return Err(EngineError::InvalidArgument(format!(
                "character revision conflict: expected {expected_revision}"
            )));
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn get_character_history(&self, id: &str) -> Result<CharacterHistory> {
        let conn = self.conn.lock().unwrap();
        let character = get_character_from_connection(&conn, id, false)?;
        let mut branch_statement = conn.prepare(
            "SELECT character_id, name, head_version, created_from_version,
                    created_at, updated_at
               FROM character_profile_branches
              WHERE character_id = ?1
              ORDER BY CASE WHEN name = 'main' THEN 0 ELSE 1 END, name",
        )?;
        let branches = branch_statement
            .query_map(params![id], character_branch_from_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut version_statement = conn.prepare(
            "SELECT character_id, version, parent_version, branch_name, message,
                    name, avatar, description, system_prompt, default_provider,
                    default_model, opening_message, tags_json, created_at
               FROM character_profile_versions
              WHERE character_id = ?1
              ORDER BY version DESC",
        )?;
        let versions = version_statement
            .query_map(params![id], character_version_from_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(CharacterHistory {
            character,
            branches,
            versions,
        })
    }

    pub fn list_character_histories(&self) -> Result<Vec<CharacterHistory>> {
        self.list_character_profiles()?
            .into_iter()
            .map(|character| self.get_character_history(&character.id))
            .collect()
    }

    pub fn commit_character_version(
        &self,
        id: &str,
        expected_revision: i64,
        message: &str,
    ) -> Result<CharacterProfile> {
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        let mut profile = get_character_from_connection(&transaction, id, false)?;
        if profile.revision != expected_revision {
            return Err(EngineError::InvalidArgument(format!(
                "character revision conflict: expected {expected_revision}"
            )));
        }
        let parent_version = profile.version;
        profile.version = transaction.query_row(
            "SELECT COALESCE(MAX(version), 0) + 1
               FROM character_profile_versions WHERE character_id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        profile.revision += 1;
        profile.updated_at = super::ts_to_dt(now_ms());
        let tags_json = serde_json::to_string(&profile.tags)?;
        insert_character_version(
            &transaction,
            &profile,
            &tags_json,
            Some(parent_version),
            message,
        )?;
        let rows = transaction.execute(
            "UPDATE character_profile_branches
                SET head_version = ?1, updated_at = ?2
              WHERE character_id = ?3 AND name = ?4",
            params![
                profile.version,
                profile.updated_at.timestamp_millis(),
                id,
                profile.active_branch,
            ],
        )?;
        if rows == 0 {
            return Err(EngineError::NotFound {
                resource: "character branch".into(),
                id: format!("{id}:{}", profile.active_branch),
            });
        }
        transaction.execute(
            "UPDATE character_profiles
                SET version = ?1, revision = ?2, updated_at = ?3
              WHERE id = ?4 AND revision = ?5 AND deleted_at IS NULL",
            params![
                profile.version,
                profile.revision,
                profile.updated_at.timestamp_millis(),
                id,
                expected_revision,
            ],
        )?;
        transaction.commit()?;
        Ok(profile)
    }

    pub fn create_character_branch(
        &self,
        id: &str,
        expected_revision: i64,
        name: &str,
        from_version: i64,
    ) -> Result<CharacterProfile> {
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        let profile = get_character_from_connection(&transaction, id, false)?;
        if profile.revision != expected_revision {
            return Err(EngineError::InvalidArgument(format!(
                "character revision conflict: expected {expected_revision}"
            )));
        }
        let version = get_character_version(&transaction, id, from_version)?;
        let timestamp = now_ms();
        transaction
            .execute(
                "INSERT INTO character_profile_branches
                 (character_id, name, head_version, created_from_version, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?3, ?4, ?4)",
                params![id, name, from_version, timestamp],
            )
            .map_err(|error| map_character_write_error(error, &format!("{id}:{name}")))?;
        apply_version_to_working_copy(
            &transaction,
            &version,
            expected_revision + 1,
            name,
            timestamp,
        )?;
        transaction.commit()?;
        get_character_from_connection(&conn, id, false)
    }

    pub fn restore_character_version(
        &self,
        id: &str,
        expected_revision: i64,
        version_number: i64,
    ) -> Result<CharacterProfile> {
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        let profile = get_character_from_connection(&transaction, id, false)?;
        if profile.revision != expected_revision {
            return Err(EngineError::InvalidArgument(format!(
                "character revision conflict: expected {expected_revision}"
            )));
        }
        let version = get_character_version(&transaction, id, version_number)?;
        apply_version_to_working_copy(
            &transaction,
            &version,
            expected_revision + 1,
            &profile.active_branch,
            now_ms(),
        )?;
        transaction.commit()?;
        get_character_from_connection(&conn, id, false)
    }

    pub fn delete_character_profile(&self, id: &str) -> Result<()> {
        if id == DEFAULT_CHARACTER_ID {
            return Err(EngineError::InvalidArgument(
                "the default character cannot be deleted".into(),
            ));
        }
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute(
            "UPDATE character_profiles SET deleted_at = ?1, updated_at = ?1
             WHERE id = ?2 AND deleted_at IS NULL",
            params![now_ms(), id],
        )?;
        if rows == 0 {
            return Err(EngineError::NotFound {
                resource: "character".into(),
                id: id.into(),
            });
        }
        Ok(())
    }

    pub fn create_conversation_for_character(
        &self,
        title: &str,
        selection: Option<(&str, &str)>,
        character_id: &str,
    ) -> Result<Conversation> {
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        let profile = get_character_from_connection(&transaction, character_id, false)?;
        let (provider, model) = resolved_model(&profile, selection);
        let conversation = Conversation::new(title, provider, model).with_character(
            &profile.id,
            profile.version,
            profile.snapshot(),
        );
        let tags_json = serde_json::to_string(&conversation.character_snapshot.tags)?;
        transaction.execute(
            "INSERT INTO conversations
             (id, title, provider, model, character_id, character_version,
              character_name_snapshot, character_avatar_snapshot,
              character_description_snapshot, character_prompt_snapshot,
              character_opening_snapshot, character_tags_snapshot,
              created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                conversation.id,
                conversation.title,
                conversation.provider,
                conversation.model,
                conversation.character_id,
                conversation.character_version,
                conversation.character_snapshot.name,
                conversation.character_snapshot.avatar,
                conversation.character_snapshot.description,
                conversation.character_snapshot.system_prompt,
                conversation.character_snapshot.opening_message,
                tags_json,
                conversation.created_at.timestamp_millis(),
                conversation.updated_at.timestamp_millis(),
            ],
        )?;
        transaction.execute(
            "INSERT INTO conversation_character_memory_modes
                (conversation_id, character_id, mode_floor, updated_at)
             SELECT ?1, ?2, default_mode, ?3
               FROM character_memory_settings WHERE character_id = ?2",
            params![
                conversation.id,
                conversation.character_id,
                conversation.created_at.timestamp_millis(),
            ],
        )?;
        transaction.commit()?;
        Ok(conversation)
    }

    pub fn preview_character_upgrade(
        &self,
        conversation_id: &str,
    ) -> Result<CharacterUpgradePreview> {
        let conversation = self.get_conversation(conversation_id)?;
        let profile = self.get_character_profile(&conversation.character_id)?;
        let (proposed_provider, proposed_model) = resolved_upgrade_model(&profile, &conversation);
        let fields = changed_fields(&conversation, &profile, &proposed_provider, &proposed_model);
        Ok(CharacterUpgradePreview {
            conversation_id: conversation.id,
            character_id: conversation.character_id,
            from_version: conversation.character_version,
            to_version: profile.version,
            changed: conversation.character_version != profile.version || !fields.is_empty(),
            changed_fields: fields,
            current_snapshot: conversation.character_snapshot,
            proposed_snapshot: profile.snapshot(),
            current_provider: conversation.provider,
            proposed_provider,
            current_model: conversation.model,
            proposed_model,
        })
    }

    pub fn upgrade_conversation_character(
        &self,
        conversation_id: &str,
        expected_version: i64,
    ) -> Result<Conversation> {
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        let mut conversation = transaction
            .query_row(
                &format!("SELECT {CONVERSATION_COLUMNS} FROM conversations WHERE id = ?1"),
                params![conversation_id],
                conversation_from_row,
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => EngineError::NotFound {
                    resource: "conversation".into(),
                    id: conversation_id.into(),
                },
                other => other.into(),
            })?;
        if conversation.character_version != expected_version {
            return Err(EngineError::InvalidArgument(format!(
                "conversation character version conflict: expected {expected_version}"
            )));
        }
        let profile =
            get_character_from_connection(&transaction, &conversation.character_id, false)?;
        let (provider, model) = resolved_upgrade_model(&profile, &conversation);
        let snapshot = profile.snapshot();
        let tags_json = serde_json::to_string(&snapshot.tags)?;
        let updated_at = now_ms();
        let rows = transaction.execute(
            "UPDATE conversations SET
                provider = ?1, model = ?2, character_version = ?3,
                character_name_snapshot = ?4, character_avatar_snapshot = ?5,
                character_description_snapshot = ?6, character_prompt_snapshot = ?7,
                character_opening_snapshot = ?8, character_tags_snapshot = ?9,
                updated_at = ?10
             WHERE id = ?11 AND character_version = ?12",
            params![
                provider,
                model,
                profile.version,
                snapshot.name,
                snapshot.avatar,
                snapshot.description,
                snapshot.system_prompt,
                snapshot.opening_message,
                tags_json,
                updated_at,
                conversation_id,
                expected_version,
            ],
        )?;
        if rows == 0 {
            return Err(EngineError::InvalidArgument(format!(
                "conversation character version conflict: expected {expected_version}"
            )));
        }
        transaction.commit()?;

        conversation.provider = provider;
        conversation.model = model;
        conversation.character_version = profile.version;
        conversation.character_snapshot = snapshot;
        conversation.updated_at = super::ts_to_dt(updated_at);
        Ok(conversation)
    }
}
