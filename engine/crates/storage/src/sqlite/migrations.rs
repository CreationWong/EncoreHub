//! Database migrations — idempotent schema initialization.

use encorehub_core::EngineError;
use rusqlite::Connection;

type Result<T> = std::result::Result<T, EngineError>;

const MIGRATIONS: &[&str] = &[
    // 001: Core tables
    "
    CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Chat',
        provider TEXT NOT NULL DEFAULT 'openai',
        model TEXT NOT NULL DEFAULT 'gpt-4o',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
        content TEXT NOT NULL DEFAULT '',
        parent_id TEXT,
        token_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        arguments TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_tool_calls_message ON tool_calls(message_id);
    ",
    // 002: Summaries + pinned
    "
    CREATE TABLE IF NOT EXISTS conversation_summaries (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        summary_text TEXT NOT NULL,
        start_message_id TEXT NOT NULL,
        end_message_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pinned_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        note TEXT,
        pinned_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pinned_conversation ON pinned_messages(conversation_id);
    ",
    // 003: Memories + FTS
    "
    CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK(scope IN ('conversation', 'global')),
        type TEXT NOT NULL CHECK(type IN ('working', 'episodic', 'semantic', 'pinned')),
        conversation_id TEXT,
        content TEXT NOT NULL DEFAULT '',
        importance REAL DEFAULT 0.5,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, last_accessed_at);
    CREATE INDEX IF NOT EXISTS idx_memories_conversation ON memories(conversation_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        content_rowid='rowid'
    );
    ",
    // 004: Search cache + config
    "
    CREATE TABLE IF NOT EXISTS search_cache (
        id TEXT PRIMARY KEY,
        query_hash TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        results_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_search_cache_hash ON search_cache(query_hash);
    CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON search_cache(expires_at);

    CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
    );
    ",
    // 005: Knowledge base
    "
    CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        file_type TEXT NOT NULL,
        chunk_count INTEGER DEFAULT 0,
        size_bytes INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        token_count INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id, chunk_index);

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content,
        content_rowid='rowid'
    );
    ",
    // 006: Encrypted secrets + crypto metadata
    //
    // `secrets` holds per-provider API keys. When encryption is enabled the
    // `ciphertext`/`nonce` columns carry an AES-256-GCM blob and `plaintext` is
    // NULL; when encryption is off they carry the key verbatim in `plaintext`
    // (user opted into at-rest plaintext) and ciphertext/nonce are NULL.
    //
    // `crypto_meta` is a single-row table (id=1) holding the Argon2id salt and
    // an encrypted verifier used to check the master password. Absence of a row
    // (or enabled=0) means the database is not encrypted. Never stores the
    // master key or any password — only the salt and verifier.
    "
    CREATE TABLE IF NOT EXISTS secrets (
        provider_id TEXT PRIMARY KEY,
        plaintext TEXT,
        ciphertext BLOB,
        nonce BLOB,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crypto_meta (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        salt BLOB NOT NULL,
        verifier_ciphertext BLOB NOT NULL,
        verifier_nonce BLOB NOT NULL,
        updated_at INTEGER NOT NULL
    );
    ",
    // 007: Reasoning chain + tool-call execution state
    //
    // `messages.reasoning` stores the model's chain-of-thought (DeepSeek
    // `reasoning_content` / Anthropic `thinking`) separately from the visible
    // answer in `content`. NULL/empty when the model emits no reasoning.
    //
    // `tool_calls` gains `result` (tool output once executed) and `status`
    // (pending | success | error). EncoreHub does not yet execute tools, so
    // these default to an empty result and 'pending'; the columns let the
    // gateway persist call args now and a future executor fill results later.
    "
    ALTER TABLE messages ADD COLUMN reasoning TEXT NOT NULL DEFAULT '';
    ALTER TABLE tool_calls ADD COLUMN result TEXT NOT NULL DEFAULT '';
    ALTER TABLE tool_calls ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
    ",
    // 008: Persisted chat-turn lifecycle.
    //
    // The user message is the turn root. Existing messages predate explicit
    // lifecycle tracking and are therefore terminal completed records.
    "
    ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'
        CHECK(status IN ('pending', 'completed', 'failed', 'stopped'));
    CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
    ",
    // 009: Persist provider reply telemetry.
    //
    // Nullable columns preserve the distinction between an actual zero and
    // telemetry that was unavailable (including every pre-migration message).
    // `token_count` remains for old clients and records.
    "
    ALTER TABLE messages ADD COLUMN input_tokens INTEGER;
    ALTER TABLE messages ADD COLUMN output_tokens INTEGER;
    ALTER TABLE messages ADD COLUMN duration_ms INTEGER;
    ALTER TABLE messages ADD COLUMN finish_reason TEXT;
    ",
    // 010: Versioned character profiles and immutable conversation snapshots.
    //
    // Character rows are soft-deleted so historical conversations retain an
    // auditable identity. The version table keeps every accepted profile
    // revision, while conversations copy the prompt-bearing fields used when
    // they were created or explicitly upgraded.
    "
    CREATE TABLE character_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        default_provider TEXT NOT NULL DEFAULT '',
        default_model TEXT NOT NULL DEFAULT '',
        opening_message TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
    );

    CREATE UNIQUE INDEX idx_character_profiles_active_name
        ON character_profiles(name COLLATE NOCASE)
        WHERE deleted_at IS NULL;
    CREATE INDEX idx_character_profiles_updated
        ON character_profiles(deleted_at, updated_at DESC);

    CREATE TABLE character_profile_versions (
        character_id TEXT NOT NULL REFERENCES character_profiles(id),
        version INTEGER NOT NULL CHECK(version >= 1),
        name TEXT NOT NULL,
        avatar TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        default_provider TEXT NOT NULL DEFAULT '',
        default_model TEXT NOT NULL DEFAULT '',
        opening_message TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        PRIMARY KEY(character_id, version)
    );

    INSERT INTO character_profiles
        (id, name, default_provider, default_model, version, created_at, updated_at)
    VALUES
        ('default', 'Default character', 'openai', 'gpt-4o', 1,
         CAST(strftime('%s', 'now') AS INTEGER) * 1000,
         CAST(strftime('%s', 'now') AS INTEGER) * 1000);

    INSERT INTO character_profile_versions
        (character_id, version, name, default_provider, default_model, created_at)
    VALUES
        ('default', 1, 'Default character', 'openai', 'gpt-4o',
         CAST(strftime('%s', 'now') AS INTEGER) * 1000);

    ALTER TABLE conversations ADD COLUMN character_id TEXT NOT NULL DEFAULT 'default';
    ALTER TABLE conversations ADD COLUMN character_version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE conversations ADD COLUMN character_name_snapshot TEXT NOT NULL DEFAULT 'Default character';
    ALTER TABLE conversations ADD COLUMN character_avatar_snapshot TEXT NOT NULL DEFAULT '';
    ALTER TABLE conversations ADD COLUMN character_description_snapshot TEXT NOT NULL DEFAULT '';
    ALTER TABLE conversations ADD COLUMN character_prompt_snapshot TEXT NOT NULL DEFAULT '';
    ALTER TABLE conversations ADD COLUMN character_opening_snapshot TEXT NOT NULL DEFAULT '';
    ALTER TABLE conversations ADD COLUMN character_tags_snapshot TEXT NOT NULL DEFAULT '[]';
    CREATE INDEX idx_conversations_character
        ON conversations(character_id, character_version, updated_at DESC);
    ",
    // 011: Explicit character version graph with mutable working copies.
    "
    ALTER TABLE character_profiles ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE character_profiles ADD COLUMN active_branch TEXT NOT NULL DEFAULT 'main';
    ALTER TABLE character_profile_versions ADD COLUMN parent_version INTEGER;
    ALTER TABLE character_profile_versions ADD COLUMN branch_name TEXT NOT NULL DEFAULT 'main';
    ALTER TABLE character_profile_versions ADD COLUMN message TEXT NOT NULL DEFAULT '';

    UPDATE character_profile_versions
       SET parent_version = CASE WHEN version > 1 THEN version - 1 ELSE NULL END,
           message = CASE
               WHEN version = 1 THEN 'Initial version'
               ELSE 'Imported version ' || version
           END;

    CREATE TABLE character_profile_branches (
        character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        head_version INTEGER NOT NULL,
        created_from_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(character_id, name),
        FOREIGN KEY(character_id, head_version)
            REFERENCES character_profile_versions(character_id, version)
    );

    INSERT INTO character_profile_branches
        (character_id, name, head_version, created_from_version, created_at, updated_at)
    SELECT profile.id, 'main', profile.version, 1, profile.created_at, profile.updated_at
      FROM character_profiles profile;

    CREATE INDEX idx_character_versions_parent
        ON character_profile_versions(character_id, parent_version);
    ",
    // 012: Persist the final provider round as a context-window snapshot.
    //
    // Billing telemetry remains cumulative across tool rounds. These nullable
    // fields keep context occupancy independent without inventing values for
    // legacy messages or providers that omit usage.
    "
    ALTER TABLE messages ADD COLUMN context_input_tokens INTEGER;
    ALTER TABLE messages ADD COLUMN context_output_tokens INTEGER;
    ",
    // 013: Persist provider prompt-cache telemetry.
    //
    // These are nullable so legacy messages remain distinguishable from a
    // provider-reported zero. Input usage continues to represent the complete
    // prompt size; cache creation/read are subsets used for reporting.
    "
    ALTER TABLE messages ADD COLUMN cache_creation_input_tokens INTEGER;
    ALTER TABLE messages ADD COLUMN cache_read_input_tokens INTEGER;
    ",
];

pub fn run(conn: &Connection) -> Result<()> {
    // Create migrations tracking table
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );",
    )
    .map_err(|e| EngineError::Migration(format!("failed to create _migrations table: {e}")))?;

    let current_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let version = i as i64 + 1;
        if version <= current_version {
            continue;
        }

        apply_migration(conn, version, sql)?;

        tracing::info!("Applied migration v{}", version);
    }

    Ok(())
}

fn apply_migration(conn: &Connection, version: i64, sql: &str) -> Result<()> {
    conn.execute_batch("BEGIN IMMEDIATE;")
        .map_err(|e| EngineError::Migration(format!("migration v{version} begin failed: {e}")))?;
    if let Err(error) = conn.execute_batch(sql) {
        let _ = conn.execute_batch("ROLLBACK;");
        return Err(EngineError::Migration(format!(
            "migration v{version} failed: {error}"
        )));
    }

    let now = chrono::Utc::now().timestamp_millis();
    if let Err(error) = conn.execute(
        "INSERT INTO _migrations (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![version, now],
    ) {
        let _ = conn.execute_batch("ROLLBACK;");
        return Err(EngineError::Migration(format!(
            "failed to record migration v{version}: {error}"
        )));
    }
    conn.execute_batch("COMMIT;")
        .map_err(|e| EngineError::Migration(format!("migration v{version} commit failed: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrations_run_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        // First run
        run(&conn).unwrap();
        // Second run should be idempotent
        run(&conn).unwrap();
    }

    #[test]
    fn telemetry_migration_preserves_legacy_messages_as_unknown() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE _migrations (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );",
        )
        .unwrap();

        for (index, sql) in MIGRATIONS.iter().take(8).enumerate() {
            conn.execute_batch(sql).unwrap();
            conn.execute(
                "INSERT INTO _migrations (version, applied_at) VALUES (?1, 1)",
                [index as i64 + 1],
            )
            .unwrap();
        }
        conn.execute_batch(
            "INSERT INTO conversations
             (id, title, provider, model, created_at, updated_at)
             VALUES ('legacy-conversation', 'Legacy', 'openai', 'gpt-4o', 1, 1);
             INSERT INTO messages
             (id, conversation_id, role, content, reasoning, parent_id,
              token_count, status, created_at)
             VALUES
             ('legacy-message', 'legacy-conversation', 'assistant', 'answer', '',
              NULL, 12, 'completed', 1);",
        )
        .unwrap();

        run(&conn).unwrap();

        #[derive(Debug, PartialEq)]
        struct LegacyTelemetry {
            input_tokens: Option<i32>,
            output_tokens: Option<i32>,
            cache_creation_input_tokens: Option<i32>,
            cache_read_input_tokens: Option<i32>,
            duration_ms: Option<i64>,
            finish_reason: Option<String>,
        }

        let telemetry = conn
            .query_row(
                "SELECT input_tokens, output_tokens,
                        cache_creation_input_tokens, cache_read_input_tokens,
                        duration_ms, finish_reason
                 FROM messages WHERE id = 'legacy-message'",
                [],
                |row| {
                    Ok(LegacyTelemetry {
                        input_tokens: row.get(0)?,
                        output_tokens: row.get(1)?,
                        cache_creation_input_tokens: row.get(2)?,
                        cache_read_input_tokens: row.get(3)?,
                        duration_ms: row.get(4)?,
                        finish_reason: row.get(5)?,
                    })
                },
            )
            .unwrap();
        assert_eq!(
            telemetry,
            LegacyTelemetry {
                input_tokens: None,
                output_tokens: None,
                cache_creation_input_tokens: None,
                cache_read_input_tokens: None,
                duration_ms: None,
                finish_reason: None,
            }
        );
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM _migrations", [], |row| row.get(0))
            .unwrap();
        // The legacy row must advance through the cache-telemetry migration.
        assert_eq!(version, 13);
    }

    #[test]
    fn character_migration_projects_legacy_conversations_to_default_snapshot() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE _migrations (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );",
        )
        .unwrap();

        for (index, sql) in MIGRATIONS.iter().take(9).enumerate() {
            conn.execute_batch(sql).unwrap();
            conn.execute(
                "INSERT INTO _migrations (version, applied_at) VALUES (?1, 1)",
                [index as i64 + 1],
            )
            .unwrap();
        }
        conn.execute_batch(
            "INSERT INTO conversations
             (id, title, provider, model, created_at, updated_at)
             VALUES ('legacy-conversation', 'Legacy', 'anthropic', 'claude', 1, 1);",
        )
        .unwrap();

        run(&conn).unwrap();

        let snapshot: (String, i64, String, String) = conn
            .query_row(
                "SELECT character_id, character_version,
                        character_name_snapshot, character_prompt_snapshot
                 FROM conversations WHERE id = 'legacy-conversation'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            snapshot,
            (
                "default".into(),
                1,
                "Default character".into(),
                String::new()
            )
        );

        let default_character: (String, i64) = conn
            .query_row(
                "SELECT name, version FROM character_profiles WHERE id = 'default'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(default_character, ("Default character".into(), 1));
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM _migrations", [], |row| row.get(0))
            .unwrap();
        // Character projection is followed by the cache-telemetry migration.
        assert_eq!(version, 13);
    }

    #[test]
    fn failed_migration_rolls_back_schema_and_version_record() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE _migrations (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );",
        )
        .unwrap();

        let result = apply_migration(
            &conn,
            99,
            "CREATE TABLE rollback_probe (id INTEGER);
             INSERT INTO missing_table VALUES (1);",
        );
        assert!(result.is_err());

        let table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name = 'rollback_probe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let version_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _migrations WHERE version = 99",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 0);
        assert_eq!(version_count, 0);
    }
}
