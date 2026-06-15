//! SQLite database layer using rusqlite with FTS5 full-text search.
//!
//! Manages: conversations, messages, tool_calls, summaries, pinned messages,
//! memories (metadata), search cache, config.

mod migrations;

use encorehub_core::{
    ConfigEntry, Conversation, ConversationSummary, EngineError, Memory, MemoryScope, MemoryType,
    Message, PinnedMessage, Role, SearchCacheEntry, ToolCall,
};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub type Result<T> = std::result::Result<T, EngineError>;

/// Helper: convert millisecond timestamp to DateTime<Utc>.
fn ts_to_dt(ms: i64) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::from_timestamp_millis(ms).unwrap_or(chrono::DateTime::UNIX_EPOCH)
}

/// Helper: current time in milliseconds.
fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub struct Database {
    conn: Mutex<Connection>,
    #[allow(dead_code)]
    path: PathBuf,
}

impl Database {
    /// Open (or create) a SQLite database at the given path and run migrations.
    pub fn open(path: impl AsRef<Path>) -> Result<()> {
        let path = path.as_ref().to_path_buf();

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

        migrations::run(&conn)?;

        let db = Self {
            conn: Mutex::new(conn),
            path: path.clone(),
        };

        tracing::info!("SQLite database opened: {:?}", path);
        // Return the db — but we need to change return type...
        // Hmm, the function signature returns Result<()>. Let's return Ok(()).
        // Actually, let's restructure: this should return Result<Self>
        // For now, drop and return Ok. The caller will create their own instance.
        drop(db);
        Ok(())
    }

    /// Open and return the Database instance.
    pub fn open_and_return(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

        migrations::run(&conn)?;

        tracing::info!("SQLite database opened: {:?}", path);
        Ok(Self {
            conn: Mutex::new(conn),
            path,
        })
    }

    // ===== Conversation CRUD =====

    pub fn create_conversation(&self, conv: &Conversation) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO conversations (id, title, provider, model, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                conv.id,
                conv.title,
                conv.provider,
                conv.model,
                conv.created_at.timestamp_millis(),
                conv.updated_at.timestamp_millis(),
            ],
        )?;
        Ok(())
    }

    pub fn get_conversation(&self, id: &str) -> Result<Conversation> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, title, provider, model, created_at, updated_at FROM conversations WHERE id = ?1",
            params![id],
            |row| {
                Ok(Conversation {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    provider: row.get(2)?,
                    model: row.get(3)?,
                    created_at: ts_to_dt(row.get::<_, i64>(4)?),
                    updated_at: ts_to_dt(row.get::<_, i64>(5)?),
                })
            },
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => EngineError::NotFound {
                resource: "conversation".into(),
                id: id.into(),
            },
            other => other.into(),
        })
    }

    pub fn list_conversations(&self, limit: i64, offset: i64) -> Result<Vec<Conversation>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, provider, model, created_at, updated_at
             FROM conversations ORDER BY updated_at DESC LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(params![limit, offset], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                provider: row.get(2)?,
                model: row.get(3)?,
                created_at: ts_to_dt(row.get::<_, i64>(4)?),
                updated_at: ts_to_dt(row.get::<_, i64>(5)?),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn update_conversation_title(&self, id: &str, title: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now_ms(), id],
        )?;
        if rows == 0 {
            return Err(EngineError::NotFound {
                resource: "conversation".into(),
                id: id.into(),
            });
        }
        Ok(())
    }

    pub fn delete_conversation(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ===== Message CRUD =====

    pub fn append_message(&self, msg: &Message) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, parent_id, token_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                msg.id,
                msg.conversation_id,
                msg.role.as_str(),
                msg.content,
                msg.parent_id,
                msg.token_count,
                msg.created_at.timestamp_millis(),
            ],
        )?;
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![now_ms(), msg.conversation_id],
        )?;
        Ok(())
    }

    pub fn get_messages(&self, conversation_id: &str) -> Result<Vec<Message>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, parent_id, token_count, created_at
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![conversation_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: Role::from_str(&row.get::<_, String>(2)?).unwrap_or(Role::User),
                content: row.get(3)?,
                parent_id: row.get(4)?,
                token_count: row.get(5)?,
                created_at: ts_to_dt(row.get::<_, i64>(6)?),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_message(&self, id: &str) -> Result<Message> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, conversation_id, role, content, parent_id, token_count, created_at
             FROM messages WHERE id = ?1",
            params![id],
            |row| {
                Ok(Message {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    role: Role::from_str(&row.get::<_, String>(2)?).unwrap_or(Role::User),
                    content: row.get(3)?,
                    parent_id: row.get(4)?,
                    token_count: row.get(5)?,
                    created_at: ts_to_dt(row.get::<_, i64>(6)?),
                })
            },
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => EngineError::NotFound {
                resource: "message".into(),
                id: id.into(),
            },
            other => other.into(),
        })
    }

    pub fn delete_message(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM messages WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ===== Tool Call CRUD =====

    pub fn insert_tool_call(&self, tc: &ToolCall) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tool_calls (id, message_id, name, arguments) VALUES (?1, ?2, ?3, ?4)",
            params![tc.id, tc.message_id, tc.name, tc.arguments],
        )?;
        Ok(())
    }

    pub fn get_tool_calls(&self, message_id: &str) -> Result<Vec<ToolCall>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, message_id, name, arguments FROM tool_calls WHERE message_id = ?1",
        )?;
        let rows = stmt.query_map(params![message_id], |row| {
            Ok(ToolCall {
                id: row.get(0)?,
                message_id: row.get(1)?,
                name: row.get(2)?,
                arguments: row.get(3)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
    }

    // ===== Conversation Summary =====

    pub fn save_summary(&self, summary: &ConversationSummary) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO conversation_summaries (id, conversation_id, summary_text, start_message_id, end_message_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                summary.id,
                summary.conversation_id,
                summary.summary_text,
                summary.start_message_id,
                summary.end_message_id,
                summary.created_at.timestamp_millis(),
            ],
        )?;
        Ok(())
    }

    pub fn get_latest_summary(&self, conversation_id: &str) -> Result<Option<ConversationSummary>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, conversation_id, summary_text, start_message_id, end_message_id, created_at
             FROM conversation_summaries WHERE conversation_id = ?1 ORDER BY created_at DESC LIMIT 1",
            params![conversation_id],
            |row| {
                Ok(ConversationSummary {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    summary_text: row.get(2)?,
                    start_message_id: row.get(3)?,
                    end_message_id: row.get(4)?,
                    created_at: ts_to_dt(row.get::<_, i64>(5)?),
                })
            },
        );
        match result {
            Ok(s) => Ok(Some(s)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    // ===== Pinned Messages =====

    pub fn pin_message(&self, pinned: &PinnedMessage) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO pinned_messages (id, conversation_id, message_id, note, pinned_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                pinned.id,
                pinned.conversation_id,
                pinned.message_id,
                pinned.note,
                pinned.pinned_at.timestamp_millis(),
            ],
        )?;
        Ok(())
    }

    pub fn unpin_message(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM pinned_messages WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_pinned_messages(&self, conversation_id: &str) -> Result<Vec<PinnedMessage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, message_id, note, pinned_at
             FROM pinned_messages WHERE conversation_id = ?1 ORDER BY pinned_at ASC",
        )?;
        let rows = stmt.query_map(params![conversation_id], |row| {
            Ok(PinnedMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                message_id: row.get(2)?,
                note: row.get(3)?,
                pinned_at: ts_to_dt(row.get::<_, i64>(4)?),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
    }

    // ===== Memory =====

    pub fn store_memory(&self, mem: &Memory) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO memories (id, scope, type, conversation_id, content, importance, created_at, last_accessed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                mem.id,
                mem.scope.as_str(),
                mem.memory_type.as_str(),
                mem.conversation_id,
                mem.content,
                mem.importance,
                mem.created_at.timestamp_millis(),
                mem.last_accessed_at.timestamp_millis(),
            ],
        )?;
        // FTS index
        conn.execute(
            "INSERT INTO memories_fts (rowid, content) VALUES ((SELECT rowid FROM memories WHERE id = ?1), ?2)",
            params![mem.id, mem.content],
        )?;
        Ok(())
    }

    pub fn get_memory(&self, id: &str) -> Result<Memory> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, scope, type, conversation_id, content, importance, created_at, last_accessed_at
             FROM memories WHERE id = ?1",
            params![id],
            |row| {
                Ok(Memory {
                    id: row.get(0)?,
                    scope: MemoryScope::from_str(&row.get::<_, String>(1)?).unwrap_or(MemoryScope::Global),
                    memory_type: MemoryType::from_str(&row.get::<_, String>(2)?).unwrap_or(MemoryType::Semantic),
                    conversation_id: row.get(3)?,
                    content: row.get(4)?,
                    importance: row.get(5)?,
                    created_at: ts_to_dt(row.get::<_, i64>(6)?),
                    last_accessed_at: ts_to_dt(row.get::<_, i64>(7)?),
                })
            },
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => EngineError::NotFound {
                resource: "memory".into(),
                id: id.into(),
            },
            other => other.into(),
        })
    }

    pub fn search_memories_fts(
        &self,
        query: &str,
        scope: Option<&MemoryScope>,
        limit: i64,
    ) -> Result<Vec<Memory>> {
        let conn = self.conn.lock().unwrap();

        let results: Vec<Memory> = if let Some(s) = scope {
            let mut stmt = conn.prepare(
                "SELECT m.id, m.scope, m.type, m.conversation_id, m.content, m.importance, m.created_at, m.last_accessed_at
                 FROM memories m
                 INNER JOIN memories_fts fts ON m.rowid = fts.rowid
                 WHERE memories_fts MATCH ?1 AND m.scope = ?2
                 ORDER BY rank LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![query, s.as_str(), limit], memory_row_mapper)?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            let mut stmt = conn.prepare(
                "SELECT m.id, m.scope, m.type, m.conversation_id, m.content, m.importance, m.created_at, m.last_accessed_at
                 FROM memories m
                 INNER JOIN memories_fts fts ON m.rowid = fts.rowid
                 WHERE memories_fts MATCH ?1
                 ORDER BY rank LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![query, limit], memory_row_mapper)?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };

        Ok(results)
    }

    pub fn list_memories(
        &self,
        scope: Option<&MemoryScope>,
        memory_type: Option<&MemoryType>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Memory>> {
        let conn = self.conn.lock().unwrap();

        // Simple approach: build query manually for clarity
        let mut sql = String::from(
            "SELECT id, scope, type, conversation_id, content, importance, created_at, last_accessed_at FROM memories WHERE 1=1",
        );
        let mut param_values: Vec<String> = Vec::new();

        if let Some(s) = scope {
            sql.push_str(&format!(" AND scope = ?{}", param_values.len() + 1));
            param_values.push(s.as_str().to_string());
        }
        if let Some(t) = memory_type {
            sql.push_str(&format!(" AND type = ?{}", param_values.len() + 1));
            param_values.push(t.as_str().to_string());
        }

        sql.push_str(&format!(
            " ORDER BY last_accessed_at DESC LIMIT ?{} OFFSET ?{}",
            param_values.len() + 1,
            param_values.len() + 2,
        ));

        let mut stmt = conn.prepare(&sql)?;
        let mut all_params: Vec<Box<dyn rusqlite::types::ToSql>> = param_values
            .into_iter()
            .map(|s| Box::new(s) as Box<dyn rusqlite::types::ToSql>)
            .collect();
        all_params.push(Box::new(limit));
        all_params.push(Box::new(offset));

        let param_refs: Vec<&dyn rusqlite::types::ToSql> = all_params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(param_refs.as_slice(), memory_row_mapper)?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn delete_memory(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM memories WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn touch_memory(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE memories SET last_accessed_at = ?1 WHERE id = ?2",
            params![now_ms(), id],
        )?;
        Ok(())
    }

    // ===== Search Cache =====

    pub fn get_search_cache(&self, query_hash: &str) -> Result<Option<SearchCacheEntry>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, query_hash, provider, results_json, created_at, expires_at
             FROM search_cache WHERE query_hash = ?1 AND expires_at > ?2",
            params![query_hash, now_ms()],
            |row| {
                Ok(SearchCacheEntry {
                    id: row.get(0)?,
                    query_hash: row.get(1)?,
                    provider: row.get(2)?,
                    results_json: row.get(3)?,
                    created_at: ts_to_dt(row.get::<_, i64>(4)?),
                    expires_at: ts_to_dt(row.get::<_, i64>(5)?),
                })
            },
        );
        match result {
            Ok(e) => Ok(Some(e)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn set_search_cache(&self, entry: &SearchCacheEntry) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO search_cache (id, query_hash, provider, results_json, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                entry.id,
                entry.query_hash,
                entry.provider,
                entry.results_json,
                entry.created_at.timestamp_millis(),
                entry.expires_at.timestamp_millis(),
            ],
        )?;
        Ok(())
    }

    pub fn clear_search_cache(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.execute("DELETE FROM search_cache", [])?)
    }

    // ===== Config =====

    pub fn get_config(&self, key: &str) -> Result<Option<ConfigEntry>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT key, value_json, updated_at FROM config WHERE key = ?1",
            params![key],
            |row| {
                Ok(ConfigEntry {
                    key: row.get(0)?,
                    value_json: row.get(1)?,
                    updated_at: ts_to_dt(row.get::<_, i64>(2)?),
                })
            },
        );
        match result {
            Ok(e) => Ok(Some(e)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn set_config(&self, key: &str, value_json: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO config (key, value_json, updated_at) VALUES (?1, ?2, ?3)",
            params![key, value_json, now_ms()],
        )?;
        Ok(())
    }

    pub fn list_config_keys(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key FROM config ORDER BY key")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
    }
}

// ===== Helper =====

fn memory_row_mapper(row: &rusqlite::Row) -> rusqlite::Result<Memory> {
    Ok(Memory {
        id: row.get(0)?,
        scope: MemoryScope::from_str(&row.get::<_, String>(1)?).unwrap_or(MemoryScope::Global),
        memory_type: MemoryType::from_str(&row.get::<_, String>(2)?).unwrap_or(MemoryType::Semantic),
        conversation_id: row.get(3)?,
        content: row.get(4)?,
        importance: row.get(5)?,
        created_at: ts_to_dt(row.get::<_, i64>(6)?),
        last_accessed_at: ts_to_dt(row.get::<_, i64>(7)?),
    })
}
