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

        conn.execute_batch(sql)
            .map_err(|e| EngineError::Migration(format!("migration v{version} failed: {e}")))?;

        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO _migrations (version, applied_at) VALUES (?1, ?2)",
            rusqlite::params![version, now],
        )
        .map_err(|e| {
            EngineError::Migration(format!("failed to record migration v{version}: {e}"))
        })?;

        tracing::info!("Applied migration v{}", version);
    }

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
}
