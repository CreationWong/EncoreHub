//! Persisted group-conversation queue.
//!
//! The Gateway claims one item at a time, generates the reply, and completes
//! the item. Mention items outrank user messages, which outrank voluntary bot
//! continuation, so addressing someone always gets an answer first. Items
//! survive restarts; a claim left behind by a crashed runner is requeued once
//! it is older than the stale threshold.

use super::{now_ms, ts_to_dt, Database, Result};
use encorehub_core::{QueueItem, QueueSource, QueueStatus};
use rusqlite::{params, Row};

const QUEUE_COLUMNS: &str = "id, conversation_id, source, priority, sender_character_id,
     target_character_id, content, status, created_at, claimed_at";

/// A claim older than this is treated as abandoned and requeued.
pub const STALE_CLAIM_MS: i64 = 5 * 60 * 1000;

fn queue_item_from_row(row: &Row<'_>) -> rusqlite::Result<QueueItem> {
    Ok(QueueItem {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        source: QueueSource::from_str(&row.get::<_, String>(2)?).unwrap_or(QueueSource::User),
        priority: row.get(3)?,
        sender_character_id: row.get(4)?,
        target_character_id: row.get(5)?,
        content: row.get(6)?,
        status: QueueStatus::from_str(&row.get::<_, String>(7)?).unwrap_or(QueueStatus::Pending),
        created_at: ts_to_dt(row.get::<_, i64>(8)?),
        claimed_at: row
            .get::<_, Option<i64>>(9)?
            .map(ts_to_dt),
    })
}

impl Database {
    /// Append one pending turn to a conversation's queue.
    pub fn enqueue_item(&self, item: &QueueItem) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO conversation_queue_items
             (id, conversation_id, source, priority, sender_character_id,
              target_character_id, content, status, created_at, claimed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                item.id,
                item.conversation_id,
                item.source.as_str(),
                item.priority,
                item.sender_character_id,
                item.target_character_id,
                item.content,
                item.status.as_str(),
                item.created_at.timestamp_millis(),
                item.claimed_at.map(|value| value.timestamp_millis()),
            ],
        )?;
        Ok(())
    }

    /// List every non-terminal item in claim order (for UI and recovery).
    pub fn list_queue_items(&self, conversation_id: &str) -> Result<Vec<QueueItem>> {
        let conn = self.conn.lock().unwrap();
        let mut statement = conn.prepare(&format!(
            "SELECT {QUEUE_COLUMNS} FROM conversation_queue_items
              WHERE conversation_id = ?1 AND status IN ('pending', 'claimed')
              ORDER BY priority ASC, created_at ASC"
        ))?;
        let rows = statement.query_map(params![conversation_id], queue_item_from_row)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    /// Atomically claim the highest-priority pending item, if any.
    pub fn claim_next_item(&self, conversation_id: &str) -> Result<Option<QueueItem>> {
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        let claimed_id: Option<String> = transaction
            .query_row(
                "SELECT id FROM conversation_queue_items
                  WHERE conversation_id = ?1 AND status = 'pending'
                  ORDER BY priority ASC, created_at ASC LIMIT 1",
                params![conversation_id],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        let Some(item_id) = claimed_id else {
            return Ok(None);
        };
        let updated = transaction.execute(
            "UPDATE conversation_queue_items
                SET status = 'claimed', claimed_at = ?1
              WHERE id = ?2 AND status = 'pending'",
            params![now_ms(), item_id],
        )?;
        if updated != 1 {
            transaction.commit()?;
            return Ok(None);
        }
        let item = transaction.query_row(
            &format!("SELECT {QUEUE_COLUMNS} FROM conversation_queue_items WHERE id = ?1"),
            params![item_id],
            queue_item_from_row,
        )?;
        transaction.commit()?;
        Ok(Some(item))
    }

    /// Mark one claimed item as processed.
    pub fn complete_queue_item(&self, item_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE conversation_queue_items SET status = 'done' WHERE id = ?1",
            params![item_id],
        )?;
        Ok(())
    }

    /// Cancel every pending or in-flight item and report how many were dropped.
    ///
    /// Used by the user-only `/stop` command: the runner observes the empty
    /// queue after its current generation is cancelled.
    pub fn clear_queue(&self, conversation_id: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.execute(
            "UPDATE conversation_queue_items SET status = 'cancelled'
              WHERE conversation_id = ?1 AND status IN ('pending', 'claimed')",
            params![conversation_id],
        )?)
    }

    /// Return claims abandoned by a crashed runner back to pending.
    pub fn requeue_stale_claims(&self, conversation_id: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let stale_before = now_ms() - STALE_CLAIM_MS;
        Ok(conn.execute(
            "UPDATE conversation_queue_items
                SET status = 'pending', claimed_at = NULL
              WHERE conversation_id = ?1 AND status = 'claimed'
                AND COALESCE(claimed_at, 0) < ?2",
            params![conversation_id, stale_before],
        )?)
    }
}
