//! Portable user-data backup, statistics, and cleanup operations.
//!
//! Configuration, credentials, caches, and derived indexes never enter the
//! backup. Imports are additive and preserve existing rows on identifier
//! conflicts.

use super::Database;
use crate::{BlobStore, StagedBlobDeletion};
use encorehub_core::EngineError;
use rusqlite::{params_from_iter, types::ValueRef, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use std::collections::{BTreeMap, BTreeSet, HashSet};

type Result<T> = std::result::Result<T, EngineError>;

/// Stable schema identifier for portable, configuration-free backups.
pub const DATA_BACKUP_SCHEMA: &str = "encorehub.user-data";
/// Current portable backup revision.
pub const DATA_BACKUP_VERSION: u32 = 1;

/// Tables containing user-owned, non-configuration data in dependency order.
const USER_DATA_TABLES: &[&str] = &[
    "character_profiles",
    "character_profile_versions",
    "character_profile_branches",
    "character_memory_settings",
    "memory_groups",
    "character_memory_group_inheritance",
    "conversations",
    "conversation_character_memory_modes",
    "messages",
    "tool_calls",
    "conversation_summaries",
    "pinned_messages",
    "attachments",
    "memories",
    "documents",
    "document_chunks",
];

/// Independently selectable user-data domains for portable backup operations.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum DataDomain {
    Characters,
    Conversations,
    Memories,
    Knowledge,
}

impl DataDomain {
    /// Return every supported domain in stable UI order.
    pub const fn all() -> [Self; 4] {
        [
            Self::Characters,
            Self::Conversations,
            Self::Memories,
            Self::Knowledge,
        ]
    }
}

/// Counts and byte totals shown in the user-facing data manager.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DataOverview {
    pub conversations: i64,
    pub messages: i64,
    pub attachments: i64,
    pub attachment_bytes: i64,
    pub memories: i64,
    pub knowledge_documents: i64,
    pub cache_entries: i64,
}

/// Lightweight row used by the selectable conversation data manager.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DataConversation {
    pub id: String,
    pub title: String,
    pub message_count: i64,
    pub attachment_count: i64,
    pub updated_at: String,
}

/// Versioned backup containing relational rows and content-addressed blobs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserDataBackup {
    pub schema: String,
    pub version: u32,
    pub exported_at: String,
    /// Requested logical domains. Dependency rows may appear in multiple domains.
    #[serde(default)]
    pub domains: BTreeSet<DataDomain>,
    pub tables: BTreeMap<String, Vec<Value>>,
    /// Lowercase hex avoids platform-specific binary JSON behavior.
    pub blobs: BTreeMap<String, String>,
}

/// Additive import outcome for user feedback and audit logs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportSummary {
    pub imported_rows: usize,
    pub skipped_rows: usize,
    pub imported_blobs: usize,
}

/// Result of deleting conversations and reclaiming their blobs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConversationCleanup {
    pub conversations: usize,
    pub blobs: Vec<String>,
}

/// Result of clearing regenerable cache records and orphaned blob files.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CacheCleanup {
    pub cache_entries: usize,
    pub referenced_blob_hashes: Vec<String>,
}

impl Database {
    /// Return lightweight counts without exposing database paths or config rows.
    pub fn data_overview(&self) -> Result<DataOverview> {
        let conn = self.conn.lock().unwrap();
        let count = |table: &str| -> Result<i64> {
            Ok(
                conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })?,
            )
        };
        Ok(DataOverview {
            conversations: count("conversations")?,
            messages: count("messages")?,
            attachments: count("attachments")?,
            attachment_bytes: conn.query_row(
                "SELECT COALESCE(SUM(size_bytes), 0) FROM attachments",
                [],
                |row| row.get(0),
            )?,
            memories: count("memories")?,
            knowledge_documents: count("documents")?,
            cache_entries: count("search_cache")?,
        })
    }

    /// Snapshot every portable user-data table while holding one SQLite lock.
    pub fn export_user_data(&self) -> Result<UserDataBackup> {
        self.export_user_data_for(DataDomain::all())
    }

    /// Snapshot selected domains plus the rows required by their foreign keys.
    pub fn export_user_data_for(
        &self,
        domains: impl IntoIterator<Item = DataDomain>,
    ) -> Result<UserDataBackup> {
        let domains = domains.into_iter().collect::<BTreeSet<_>>();
        if domains.is_empty() {
            return Err(EngineError::InvalidArgument(
                "at least one data domain must be selected".into(),
            ));
        }
        let selected_tables = tables_for_domains(&domains);
        let conn = self.conn.lock().unwrap();
        let mut tables = BTreeMap::new();
        for table in USER_DATA_TABLES {
            if selected_tables.contains(*table) {
                tables.insert((*table).to_string(), export_table(&conn, table)?);
            }
        }
        Ok(UserDataBackup {
            schema: DATA_BACKUP_SCHEMA.into(),
            version: DATA_BACKUP_VERSION,
            exported_at: chrono::Utc::now().to_rfc3339(),
            domains,
            tables,
            blobs: BTreeMap::new(),
        })
    }

    /// Export only selected conversations and their character dependencies.
    pub fn export_conversations(&self, ids: &[String]) -> Result<UserDataBackup> {
        let ids = normalized_ids(ids)?;
        let conn = self.conn.lock().unwrap();
        ensure_conversations_exist(&conn, &ids)?;
        let placeholders = sql_placeholders(ids.len());
        let params = ids.iter().map(String::as_str).collect::<Vec<_>>();
        let mut tables = BTreeMap::new();
        for (table, predicate) in [
            ("conversations", format!("id IN ({placeholders})")),
            (
                "conversation_character_memory_modes",
                format!("conversation_id IN ({placeholders})"),
            ),
            ("messages", format!("conversation_id IN ({placeholders})")),
            (
                "tool_calls",
                format!(
                    "message_id IN (SELECT id FROM messages WHERE conversation_id IN ({placeholders}))"
                ),
            ),
            (
                "conversation_summaries",
                format!("conversation_id IN ({placeholders})"),
            ),
            (
                "pinned_messages",
                format!("conversation_id IN ({placeholders})"),
            ),
            (
                "attachments",
                format!("conversation_id IN ({placeholders})"),
            ),
            (
                "character_profiles",
                format!(
                    "id IN (SELECT character_id FROM conversations WHERE id IN ({placeholders}))"
                ),
            ),
            (
                "character_profile_versions",
                format!(
                    "character_id IN (SELECT character_id FROM conversations WHERE id IN ({placeholders}))"
                ),
            ),
            (
                "character_profile_branches",
                format!(
                    "character_id IN (SELECT character_id FROM conversations WHERE id IN ({placeholders}))"
                ),
            ),
            (
                "character_memory_settings",
                format!(
                    "character_id IN (SELECT character_id FROM conversations WHERE id IN ({placeholders}))"
                ),
            ),
            (
                "memory_groups",
                format!(
                    "owner_character_id IN (
                         SELECT character_id FROM conversations WHERE id IN ({placeholders})
                     )"
                ),
            ),
        ] {
            tables.insert(
                table.to_string(),
                export_table_where(&conn, table, &predicate, &params)?,
            );
        }
        Ok(UserDataBackup {
            schema: DATA_BACKUP_SCHEMA.into(),
            version: DATA_BACKUP_VERSION,
            exported_at: chrono::Utc::now().to_rfc3339(),
            domains: BTreeSet::from([DataDomain::Conversations]),
            tables,
            blobs: BTreeMap::new(),
        })
    }

    /// List every conversation without the chat screen's display limit.
    pub fn list_data_conversations(&self) -> Result<Vec<DataConversation>> {
        let conn = self.conn.lock().unwrap();
        let mut statement = conn.prepare(
            "SELECT c.id, c.title, COUNT(DISTINCT m.id), COUNT(DISTINCT a.id), c.updated_at
               FROM conversations c
               LEFT JOIN messages m ON m.conversation_id = c.id
               LEFT JOIN attachments a ON a.conversation_id = c.id
              GROUP BY c.id
              ORDER BY c.updated_at DESC",
        )?;
        let rows = statement.query_map([], |row| {
            let updated_at = row.get::<_, i64>(4)?;
            Ok(DataConversation {
                id: row.get(0)?,
                title: row.get(1)?,
                message_count: row.get(2)?,
                attachment_count: row.get(3)?,
                updated_at: chrono::DateTime::from_timestamp_millis(updated_at)
                    .unwrap_or(chrono::DateTime::UNIX_EPOCH)
                    .to_rfc3339(),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    /// Merge a validated backup into the current database in one transaction.
    pub fn import_user_data(&self, backup: &UserDataBackup) -> Result<ImportSummary> {
        if backup.schema != DATA_BACKUP_SCHEMA || backup.version != DATA_BACKUP_VERSION {
            return Err(EngineError::InvalidArgument(
                "unsupported EncoreHub user-data backup".into(),
            ));
        }
        if backup
            .tables
            .keys()
            .any(|table| !USER_DATA_TABLES.contains(&table.as_str()))
        {
            return Err(EngineError::InvalidArgument(
                "backup contains an unsupported data table".into(),
            ));
        }

        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        transaction.execute_batch("PRAGMA defer_foreign_keys = ON;")?;
        let mut summary = ImportSummary {
            imported_rows: 0,
            skipped_rows: 0,
            imported_blobs: 0,
        };
        for table in USER_DATA_TABLES {
            let Some(rows) = backup.tables.get(*table) else {
                continue;
            };
            let schema = table_schema(&transaction, table)?;
            for row in rows {
                let inserted = import_row(&transaction, table, &schema, row)?;
                if inserted {
                    summary.imported_rows += 1;
                } else {
                    summary.skipped_rows += 1;
                }
            }
        }
        rebuild_full_text_indexes(&transaction)?;
        transaction.commit()?;
        Ok(summary)
    }

    /// Delete every conversation atomically and return hashes safe to reclaim.
    pub fn clear_conversation_history(&self) -> Result<ConversationCleanup> {
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        let blobs = query_strings(&transaction, "SELECT DISTINCT sha256 FROM attachments")?;
        let conversations = transaction.execute("DELETE FROM conversations", [])?;
        transaction.commit()?;
        Ok(ConversationCleanup {
            conversations,
            blobs,
        })
    }

    /// Stage attachment files and clear history under one database transaction.
    pub fn clear_conversation_history_atomically(
        &self,
        store: &BlobStore,
    ) -> Result<(ConversationCleanup, StagedBlobDeletion)> {
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        let blobs = query_strings(
            &transaction,
            "SELECT DISTINCT sha256 FROM attachments ORDER BY sha256",
        )?;
        let staged = store.stage_delete(blobs.iter().map(String::as_str))?;
        let conversations = match transaction.execute("DELETE FROM conversations", []) {
            Ok(count) => count,
            Err(error) => {
                let _ = staged.rollback();
                return Err(error.into());
            }
        };
        if let Err(error) = transaction.commit() {
            let _ = staged.rollback();
            return Err(error.into());
        }
        Ok((
            ConversationCleanup {
                conversations,
                blobs,
            },
            staged,
        ))
    }

    /// Delete a validated conversation selection and its unshared blobs atomically.
    pub fn delete_conversations_atomically(
        &self,
        ids: &[String],
        store: &BlobStore,
    ) -> Result<(ConversationCleanup, StagedBlobDeletion)> {
        let ids = normalized_ids(ids)?;
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        ensure_conversations_exist(&transaction, &ids)?;
        let placeholders = sql_placeholders(ids.len());
        let params = ids.iter().map(String::as_str).collect::<Vec<_>>();
        let blobs = query_strings_with_params(
            &transaction,
            &format!(
                "SELECT DISTINCT candidate.sha256
                   FROM attachments candidate
                  WHERE candidate.conversation_id IN ({placeholders})
                    AND NOT EXISTS (
                        SELECT 1 FROM attachments retained
                         WHERE retained.sha256 = candidate.sha256
                           AND retained.conversation_id NOT IN ({placeholders})
                    )
                  ORDER BY candidate.sha256"
            ),
            &params
                .iter()
                .chain(params.iter())
                .copied()
                .collect::<Vec<_>>(),
        )?;
        let staged = store.stage_delete(blobs.iter().map(String::as_str))?;
        let conversations = match transaction.execute(
            &format!("DELETE FROM conversations WHERE id IN ({placeholders})"),
            params_from_iter(params),
        ) {
            Ok(count) => count,
            Err(error) => {
                let _ = staged.rollback();
                return Err(error.into());
            }
        };
        if let Err(error) = transaction.commit() {
            let _ = staged.rollback();
            return Err(error.into());
        }
        Ok((
            ConversationCleanup {
                conversations,
                blobs,
            },
            staged,
        ))
    }

    /// Clear database-backed search cache and report hashes still owned by data.
    pub fn clear_regenerable_cache(&self) -> Result<CacheCleanup> {
        let conn = self.conn.lock().unwrap();
        let cache_entries = conn.execute("DELETE FROM search_cache", [])?;
        let referenced_blob_hashes = query_strings(
            &conn,
            "SELECT DISTINCT sha256 FROM attachments ORDER BY sha256",
        )?;
        Ok(CacheCleanup {
            cache_entries,
            referenced_blob_hashes,
        })
    }

    /// Stage orphaned files and clear regenerable cache in one transaction.
    pub fn clear_regenerable_cache_atomically(
        &self,
        store: &BlobStore,
    ) -> Result<(CacheCleanup, StagedBlobDeletion)> {
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        let referenced_blob_hashes = query_strings(
            &transaction,
            "SELECT DISTINCT sha256 FROM attachments ORDER BY sha256",
        )?;
        let referenced = referenced_blob_hashes.iter().collect::<HashSet<_>>();
        let orphaned = store
            .list_hashes()?
            .into_iter()
            .filter(|hash| !referenced.contains(hash))
            .collect::<Vec<_>>();
        let staged = store.stage_delete(orphaned.iter().map(String::as_str))?;
        let cache_entries = match transaction.execute("DELETE FROM search_cache", []) {
            Ok(count) => count,
            Err(error) => {
                let _ = staged.rollback();
                return Err(error.into());
            }
        };
        if let Err(error) = transaction.commit() {
            let _ = staged.rollback();
            return Err(error.into());
        }
        Ok((
            CacheCleanup {
                cache_entries,
                referenced_blob_hashes,
            },
            staged,
        ))
    }
}

/// Resolve logical domains to a dependency-complete relational table set.
fn tables_for_domains(domains: &BTreeSet<DataDomain>) -> HashSet<&'static str> {
    let mut tables = HashSet::new();
    let mut include_characters = false;
    for domain in domains {
        match domain {
            DataDomain::Characters => include_characters = true,
            DataDomain::Conversations => {
                include_characters = true;
                tables.extend([
                    "conversations",
                    "conversation_character_memory_modes",
                    "messages",
                    "tool_calls",
                    "conversation_summaries",
                    "pinned_messages",
                    "attachments",
                ]);
            }
            DataDomain::Memories => {
                include_characters = true;
                tables.extend([
                    "memory_groups",
                    "character_memory_group_inheritance",
                    "memories",
                ]);
            }
            DataDomain::Knowledge => {
                tables.extend(["documents", "document_chunks"]);
            }
        }
    }
    if include_characters {
        tables.extend([
            "character_profiles",
            "character_profile_versions",
            "character_profile_branches",
            "character_memory_settings",
        ]);
    }
    tables
}

/// Export arbitrary SQLite scalar values without weakening table ownership.
fn export_table(conn: &rusqlite::Connection, table: &str) -> Result<Vec<Value>> {
    export_table_where(conn, table, "1 = 1", &[])
}

/// Export a whitelisted table subset using caller-bound scalar parameters.
fn export_table_where(
    conn: &rusqlite::Connection,
    table: &str,
    predicate: &str,
    parameters: &[&str],
) -> Result<Vec<Value>> {
    let mut statement = conn.prepare(&format!("SELECT * FROM {table} WHERE {predicate}"))?;
    let columns = statement
        .column_names()
        .iter()
        .map(|name| (*name).to_string())
        .collect::<Vec<_>>();
    let rows = statement.query_map(params_from_iter(parameters), |row| {
        let mut object = Map::new();
        for (index, column) in columns.iter().enumerate() {
            object.insert(column.clone(), sqlite_value(row.get_ref(index)?));
        }
        Ok(Value::Object(object))
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

/// Normalize a user selection and reject empty or duplicate identifiers.
fn normalized_ids(ids: &[String]) -> Result<Vec<String>> {
    let ids = ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Err(EngineError::InvalidArgument(
            "at least one conversation must be selected".into(),
        ));
    }
    Ok(ids)
}

fn sql_placeholders(count: usize) -> String {
    std::iter::repeat_n("?", count)
        .collect::<Vec<_>>()
        .join(", ")
}

/// Fail the whole batch if any requested conversation disappeared.
fn ensure_conversations_exist(conn: &rusqlite::Connection, ids: &[String]) -> Result<()> {
    let found: i64 = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM conversations WHERE id IN ({})",
            sql_placeholders(ids.len())
        ),
        params_from_iter(ids.iter().map(String::as_str)),
        |row| row.get(0),
    )?;
    if found != ids.len() as i64 {
        return Err(EngineError::InvalidArgument(
            "one or more selected conversations no longer exist".into(),
        ));
    }
    Ok(())
}

/// Map SQLite primitives to lossless JSON values for the current schema.
fn sqlite_value(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) => Value::Number(value.into()),
        ValueRef::Real(value) => Number::from_f64(value)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Text(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => Value::Array(
            value
                .iter()
                .map(|byte| Value::Number((*byte).into()))
                .collect(),
        ),
    }
}

/// Load the current table schema so imported keys cannot become SQL syntax.
struct TableSchema {
    columns: HashSet<String>,
    primary_key: Vec<String>,
}

/// Load current columns and primary-key order for conflict-safe additive imports.
fn table_schema(transaction: &Transaction<'_>, table: &str) -> Result<TableSchema> {
    let mut statement = transaction.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(1)?, row.get::<_, usize>(5)?))
    })?;
    let mut columns = HashSet::new();
    let mut primary_key = Vec::new();
    for row in rows {
        let (column, position) = row?;
        columns.insert(column.clone());
        if position > 0 {
            primary_key.push((position, column));
        }
    }
    primary_key.sort_by_key(|(position, _)| *position);
    Ok(TableSchema {
        columns,
        primary_key: primary_key.into_iter().map(|(_, column)| column).collect(),
    })
}

/// Insert one object using only columns proven to exist in the whitelisted table.
fn import_row(
    transaction: &Transaction<'_>,
    table: &str,
    schema: &TableSchema,
    row: &Value,
) -> Result<bool> {
    let object = row.as_object().ok_or_else(|| {
        EngineError::InvalidArgument(format!("backup row for {table} is not an object"))
    })?;
    if object.is_empty() || object.keys().any(|column| !schema.columns.contains(column)) {
        return Err(EngineError::InvalidArgument(format!(
            "backup row for {table} contains invalid columns"
        )));
    }
    if row_already_exists(transaction, table, &schema.primary_key, object)? {
        return Ok(false);
    }
    let columns = object.keys().cloned().collect::<Vec<_>>();
    let placeholders = (1..=columns.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let values = columns
        .iter()
        .map(|column| json_to_sqlite(&object[column]))
        .collect::<Result<Vec<_>>>()?;
    let sql = format!(
        "INSERT OR IGNORE INTO {table} ({}) VALUES ({placeholders})",
        columns.join(", ")
    );
    Ok(transaction.execute(&sql, params_from_iter(values))? > 0)
}

/// Skip rows already present before table triggers can reject a duplicate.
fn row_already_exists(
    transaction: &Transaction<'_>,
    table: &str,
    primary_key: &[String],
    object: &Map<String, Value>,
) -> Result<bool> {
    if primary_key.is_empty()
        || primary_key
            .iter()
            .any(|column| !object.contains_key(column))
    {
        return Ok(false);
    }
    let predicate = primary_key
        .iter()
        .enumerate()
        .map(|(index, column)| format!("{column} = ?{}", index + 1))
        .collect::<Vec<_>>()
        .join(" AND ");
    let values = primary_key
        .iter()
        .map(|column| json_to_sqlite(&object[column]))
        .collect::<Result<Vec<_>>>()?;
    let sql = format!("SELECT 1 FROM {table} WHERE {predicate} LIMIT 1");
    Ok(transaction
        .query_row(&sql, params_from_iter(values), |row| row.get::<_, i64>(0))
        .optional()?
        .is_some())
}

/// Convert imported JSON scalars back into SQLite-owned values.
fn json_to_sqlite(value: &Value) -> Result<rusqlite::types::Value> {
    use rusqlite::types::Value as SqlValue;
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::Bool(value) => Ok(SqlValue::Integer(i64::from(*value))),
        Value::Number(value) => value
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| value.as_f64().map(SqlValue::Real))
            .ok_or_else(|| EngineError::InvalidArgument("invalid numeric backup value".into())),
        Value::String(value) => Ok(SqlValue::Text(value.clone())),
        Value::Array(values) => values
            .iter()
            .map(|item| {
                item.as_u64()
                    .filter(|value| *value <= u8::MAX as u64)
                    .map(|value| value as u8)
                    .ok_or_else(|| {
                        EngineError::InvalidArgument("invalid binary backup value".into())
                    })
            })
            .collect::<Result<Vec<_>>>()
            .map(SqlValue::Blob),
        Value::Object(_) => Err(EngineError::InvalidArgument(
            "nested backup objects are not supported".into(),
        )),
    }
}

/// Rebuild derived text indexes after additive relational imports.
fn rebuild_full_text_indexes(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute_batch(
        "DELETE FROM memories_fts;
         INSERT INTO memories_fts(rowid, content) SELECT rowid, content FROM memories;
         DELETE FROM chunks_fts;
         INSERT INTO chunks_fts(rowid, content) SELECT rowid, content FROM document_chunks;",
    )?;
    Ok(())
}

/// Collect a single text projection with deterministic ordering supplied by SQL.
fn query_strings(conn: &rusqlite::Connection, sql: &str) -> Result<Vec<String>> {
    query_strings_with_params(conn, sql, &[])
}

fn query_strings_with_params(
    conn: &rusqlite::Connection,
    sql: &str,
    parameters: &[&str],
) -> Result<Vec<String>> {
    let mut statement = conn.prepare(sql)?;
    let rows = statement.query_map(params_from_iter(parameters), |row| row.get::<_, String>(0))?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

/// Encode bytes without adding a dependency for a backup-only representation.
pub fn encode_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

/// Decode the strict lowercase/uppercase hexadecimal backup representation.
pub fn decode_hex(value: &str) -> Result<Vec<u8>> {
    if value.len() % 2 != 0 {
        return Err(EngineError::InvalidArgument("invalid hex payload".into()));
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let high = hex_digit(pair[0])?;
            let low = hex_digit(pair[1])?;
            Ok((high << 4) | low)
        })
        .collect()
}

/// Parse one ASCII hexadecimal nibble.
fn hex_digit(value: u8) -> Result<u8> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(EngineError::InvalidArgument("invalid hex payload".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use encorehub_core::{Conversation, Message, Role};

    /// Build a migrated database isolated from the developer's real data.
    fn database() -> (tempfile::TempDir, Database) {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open_and_return(directory.path().join("encorehub.db")).unwrap();
        (directory, database)
    }

    #[test]
    fn backup_round_trip_is_additive_and_excludes_configuration() {
        let (_source_dir, source) = database();
        let conversation = Conversation::new("Portable", "openai", "gpt-4o");
        source.create_conversation(&conversation).unwrap();
        source
            .append_message(&Message::new(&conversation.id, Role::User, "hello", None))
            .unwrap();
        source
            .set_config("private-setting", "\"excluded\"")
            .unwrap();

        let backup = source.export_user_data().unwrap();
        assert!(!backup.tables.contains_key("config"));

        let (_target_dir, target) = database();
        let first = target.import_user_data(&backup).unwrap();
        let second = target.import_user_data(&backup).unwrap();
        assert!(first.imported_rows >= 2);
        assert!(second.skipped_rows >= 2);
        assert_eq!(target.get_messages(&conversation.id).unwrap().len(), 1);
        assert!(target.get_config("private-setting").unwrap().is_none());
    }

    #[test]
    fn scoped_backup_contains_only_selected_domain_and_dependencies() {
        let (_directory, source) = database();

        let backup = source
            .export_user_data_for([DataDomain::Knowledge])
            .unwrap();

        assert_eq!(backup.domains, BTreeSet::from([DataDomain::Knowledge]));
        assert_eq!(
            backup.tables.keys().map(String::as_str).collect::<Vec<_>>(),
            vec!["document_chunks", "documents"]
        );
        assert!(!backup.tables.contains_key("character_profiles"));
        assert!(!backup.tables.contains_key("conversations"));
    }

    #[test]
    fn selected_conversation_backup_and_delete_do_not_touch_other_conversations() {
        let (_directory, source) = database();
        let selected = Conversation::new("Selected", "openai", "gpt-4o");
        let retained = Conversation::new("Retained", "openai", "gpt-4o");
        source.create_conversation(&selected).unwrap();
        source.create_conversation(&retained).unwrap();
        source
            .append_message(&Message::new(&selected.id, Role::User, "portable", None))
            .unwrap();

        let backup = source
            .export_conversations(std::slice::from_ref(&selected.id))
            .unwrap();
        assert_eq!(backup.tables["conversations"].len(), 1);
        assert_eq!(backup.tables["messages"].len(), 1);
        assert!(backup.tables["memory_groups"]
            .iter()
            .any(|row| row["id"] == "character:default"));

        let (_target_directory, target) = database();
        target.import_user_data(&backup).unwrap();
        assert!(target.get_conversation(&selected.id).is_ok());
        assert!(target.get_conversation(&retained.id).is_err());

        let store = BlobStore::new(source.data_directory().join("blobs")).unwrap();
        let (deleted, staged) = source
            .delete_conversations_atomically(std::slice::from_ref(&selected.id), &store)
            .unwrap();
        staged.commit().unwrap();
        assert_eq!(deleted.conversations, 1);
        assert!(source.get_conversation(&selected.id).is_err());
        assert!(source.get_conversation(&retained.id).is_ok());
    }

    #[test]
    fn clear_history_preserves_other_user_data() {
        let (_directory, database) = database();
        let conversation = Conversation::new("Clear", "openai", "gpt-4o");
        database.create_conversation(&conversation).unwrap();
        let result = database.clear_conversation_history().unwrap();
        assert_eq!(result.conversations, 1);
        assert!(database.list_conversations(10, 0).unwrap().is_empty());
        assert!(!database.list_memory_groups(true).unwrap().is_empty());
    }
}
