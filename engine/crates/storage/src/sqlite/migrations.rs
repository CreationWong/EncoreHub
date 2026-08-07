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
    // 014: Conversation attachment metadata.
    //
    // Binary payloads live in the content-addressed blob directory. SQLite
    // owns lifecycle, provenance, parsing state, and message association.
    "
    CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_category TEXT NOT NULL CHECK(file_category IN ('image', 'rich_text', 'text')),
        size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
        sha256 TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        processing_status TEXT NOT NULL DEFAULT 'ready'
            CHECK(processing_status IN ('pending', 'ready', 'failed')),
        processing_method TEXT NOT NULL DEFAULT '',
        extracted_text TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE INDEX idx_attachments_conversation
        ON attachments(conversation_id, created_at);
    CREATE INDEX idx_attachments_message ON attachments(message_id);
    CREATE INDEX idx_attachments_sha256 ON attachments(sha256);
    ",
    // 015: Local vector indexes for knowledge fallback and per-turn memory.
    //
    // LanceDB remains the primary knowledge index. These SQLite-Vec tables are
    // the explicit offline fallback and the authoritative lightweight memory
    // index. Metadata stays relational so vec0 rows never own lifecycle.
    "
    CREATE TABLE knowledge_vector_metadata (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id TEXT NOT NULL UNIQUE REFERENCES document_chunks(id) ON DELETE CASCADE
    );
    CREATE VIRTUAL TABLE knowledge_vectors USING vec0(embedding float[384]);

    CREATE TABLE memory_vector_metadata (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL UNIQUE REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE VIRTUAL TABLE memory_vectors USING vec0(embedding float[384]);
    ",
    // 016: Role-scoped memory groups, lifecycle state, and mode settings.
    //
    // Existing memories remain queryable in the built-in global group until a
    // user explicitly reclassifies them. No legacy row is promoted by this
    // migration.
    "
    CREATE TABLE memory_groups (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        name TEXT NOT NULL,
        group_type TEXT NOT NULL CHECK(group_type IN ('character', 'global', 'custom')),
        owner_character_id TEXT REFERENCES character_profiles(id) ON DELETE CASCADE,
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(profile_id, name)
    );

    CREATE UNIQUE INDEX idx_memory_groups_profile_global
        ON memory_groups(profile_id) WHERE group_type = 'global';
    CREATE UNIQUE INDEX idx_memory_groups_character_default
        ON memory_groups(owner_character_id) WHERE group_type = 'character';
    CREATE INDEX idx_memory_groups_profile
        ON memory_groups(profile_id, group_type, updated_at DESC);

    INSERT INTO memory_groups
        (id, profile_id, name, group_type, created_at, updated_at)
    VALUES
        ('global', 'local', 'Global', 'global',
         CAST(strftime('%s', 'now') AS INTEGER) * 1000,
         CAST(strftime('%s', 'now') AS INTEGER) * 1000);

    INSERT INTO memory_groups
        (id, profile_id, name, group_type, owner_character_id, created_at, updated_at)
    SELECT 'character:' || id, 'local', name, 'character', id,
           CAST(strftime('%s', 'now') AS INTEGER) * 1000,
           CAST(strftime('%s', 'now') AS INTEGER) * 1000
      FROM character_profiles
     WHERE deleted_at IS NULL;

    CREATE TABLE character_memory_settings (
        character_id TEXT PRIMARY KEY REFERENCES character_profiles(id) ON DELETE CASCADE,
        default_mode TEXT NOT NULL DEFAULT 'simple'
            CHECK(default_mode IN ('simple', 'rag', 'rag_enhanced', 'realistic')),
        realistic_enabled INTEGER NOT NULL DEFAULT 0 CHECK(realistic_enabled IN (0, 1)),
        updated_at INTEGER NOT NULL
    );

    INSERT INTO character_memory_settings(character_id, default_mode, realistic_enabled, updated_at)
    SELECT id, 'simple', 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000
      FROM character_profiles
     WHERE deleted_at IS NULL;

    CREATE TABLE character_memory_group_inheritance (
        character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
        group_id TEXT NOT NULL REFERENCES memory_groups(id) ON DELETE CASCADE,
        access_mode TEXT NOT NULL DEFAULT 'read'
            CHECK(access_mode IN ('read', 'read_write')),
        priority INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(character_id, group_id)
    );

    ALTER TABLE memories ADD COLUMN group_id TEXT NOT NULL DEFAULT 'global';
    ALTER TABLE memories ADD COLUMN source_character_id TEXT;
    ALTER TABLE memories ADD COLUMN state TEXT NOT NULL DEFAULT 'long_term'
        CHECK(state IN ('transient', 'short_term', 'long_term', 'permanent_candidate', 'permanent', 'forgotten'));
    ALTER TABLE memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'event'
        CHECK(kind IN ('fact', 'preference', 'event', 'instruction', 'summary'));
    ALTER TABLE memories ADD COLUMN canonical_key TEXT;
    ALTER TABLE memories ADD COLUMN reason TEXT NOT NULL DEFAULT '';
    ALTER TABLE memories ADD COLUMN source_turn_id TEXT;
    ALTER TABLE memories ADD COLUMN created_by_model TEXT NOT NULL DEFAULT '';
    ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 0.5
        CHECK(confidence >= 0.0 AND confidence <= 1.0);

    CREATE INDEX idx_memories_group_state
        ON memories(group_id, state, last_accessed_at DESC);
    CREATE INDEX idx_memories_source_character
        ON memories(source_character_id, created_at DESC);
    CREATE UNIQUE INDEX idx_memories_permanent_key
        ON memories(group_id, canonical_key)
        WHERE state = 'permanent' AND canonical_key IS NOT NULL;
    ",
    // 017: Conversation + character memory-mode high-water mark.
    //
    // A role's default seeds new conversations. Existing conversations may
    // move from Simple to RAG to RAG Enhanced, but never move backwards or
    // enter Realistic mode after the conversation has started.
    "
    CREATE TABLE conversation_character_memory_modes (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        character_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
        mode_floor TEXT NOT NULL
            CHECK(mode_floor IN ('simple', 'rag', 'rag_enhanced', 'realistic')),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(conversation_id, character_id)
    );

    INSERT INTO conversation_character_memory_modes
        (conversation_id, character_id, mode_floor, updated_at)
    SELECT c.id, c.character_id, COALESCE(s.default_mode, 'simple'),
           CAST(strftime('%s', 'now') AS INTEGER) * 1000
      FROM conversations c
      LEFT JOIN character_memory_settings s ON s.character_id = c.character_id;
    ",
    // 018: Repair and realign the derived memory FTS index.
    //
    // Older non-transactional writes could persist a memory row after an FTS
    // rowid collision returned an error. Rebuild from the authoritative table;
    // future writes replace stale rowids atomically in `store_memory`.
    "
    DELETE FROM memories_fts;
    INSERT INTO memories_fts(rowid, content)
    SELECT rowid, content FROM memories;
    ",
];

pub fn run(conn: &Connection) -> Result<()> {
    // Migration tests and maintenance tools may pass a raw connection; ensure
    // vector-table migrations do not depend on Database's open helper.
    super::register_sqlite_vec();
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

    /// Open a raw migration-test connection after registering SQLite-Vec.
    fn open_test_connection() -> Connection {
        super::super::register_sqlite_vec();
        Connection::open_in_memory().unwrap()
    }

    #[test]
    fn test_migrations_run_idempotent() {
        let conn = open_test_connection();
        // First run
        run(&conn).unwrap();
        // Second run should be idempotent
        run(&conn).unwrap();
    }

    #[test]
    fn telemetry_migration_preserves_legacy_messages_as_unknown() {
        let conn = open_test_connection();
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
        // The legacy row must advance through conversation mode high-water marks.
        assert_eq!(version, 18);
    }

    #[test]
    fn character_migration_projects_legacy_conversations_to_default_snapshot() {
        let conn = open_test_connection();
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
        // Legacy rows advance through conversation mode high-water marks.
        assert_eq!(version, 18);
    }

    #[test]
    fn role_memory_migration_seeds_groups_settings_and_legacy_columns() {
        let conn = open_test_connection();
        run(&conn).unwrap();

        let global_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM memory_groups
                  WHERE id = 'global' AND group_type = 'global'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(global_count, 1);

        let default_group: (String, String) = conn
            .query_row(
                "SELECT id, owner_character_id FROM memory_groups
                  WHERE owner_character_id = 'default'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            default_group,
            ("character:default".into(), "default".into())
        );

        let mode: String = conn
            .query_row(
                "SELECT default_mode FROM character_memory_settings
                  WHERE character_id = 'default'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(mode, "simple");

        let memory_columns: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('memories')
                  WHERE name IN (
                      'group_id', 'source_character_id', 'state', 'kind',
                      'canonical_key', 'reason', 'source_turn_id',
                      'created_by_model', 'confidence'
                  )",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(memory_columns, 9);
    }

    #[test]
    fn failed_migration_rolls_back_schema_and_version_record() {
        let conn = open_test_connection();
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
