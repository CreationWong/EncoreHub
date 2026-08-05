//! Attachment metadata persistence for conversation-scoped uploaded files.

use super::Database;
use encorehub_core::EngineError;
use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};

type Result<T> = std::result::Result<T, EngineError>;

/// Metadata and processing state for one content-addressed attachment.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttachmentRecord {
    pub id: String,
    pub conversation_id: String,
    pub message_id: Option<String>,
    pub file_name: String,
    pub mime_type: String,
    pub file_category: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub storage_path: String,
    pub processing_status: String,
    pub processing_method: String,
    pub extracted_text: String,
    pub error_message: String,
    pub created_at: i64,
    pub updated_at: i64,
}

const ATTACHMENT_COLUMNS: &str = "id, conversation_id, message_id, file_name, \
    mime_type, file_category, size_bytes, sha256, storage_path, processing_status, \
    processing_method, extracted_text, error_message, created_at, updated_at";

/// Rebuild an attachment record from the stable column projection.
fn attachment_from_row(row: &Row<'_>) -> rusqlite::Result<AttachmentRecord> {
    Ok(AttachmentRecord {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        message_id: row.get(2)?,
        file_name: row.get(3)?,
        mime_type: row.get(4)?,
        file_category: row.get(5)?,
        size_bytes: row.get(6)?,
        sha256: row.get(7)?,
        storage_path: row.get(8)?,
        processing_status: row.get(9)?,
        processing_method: row.get(10)?,
        extracted_text: row.get(11)?,
        error_message: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

impl Database {
    /// Insert attachment metadata after its blob has been written successfully.
    pub fn insert_attachment(&self, attachment: &AttachmentRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO attachments
             (id, conversation_id, message_id, file_name, mime_type, file_category,
              size_bytes, sha256, storage_path, processing_status, processing_method,
              extracted_text, error_message, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                attachment.id,
                attachment.conversation_id,
                attachment.message_id,
                attachment.file_name,
                attachment.mime_type,
                attachment.file_category,
                attachment.size_bytes,
                attachment.sha256,
                attachment.storage_path,
                attachment.processing_status,
                attachment.processing_method,
                attachment.extracted_text,
                attachment.error_message,
                attachment.created_at,
                attachment.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Return every attachment for a conversation in upload order.
    pub fn list_attachments(&self, conversation_id: &str) -> Result<Vec<AttachmentRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut statement = conn.prepare(&format!(
            "SELECT {ATTACHMENT_COLUMNS} FROM attachments
             WHERE conversation_id = ?1 ORDER BY created_at, id"
        ))?;
        let rows = statement.query_map([conversation_id], attachment_from_row)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    /// Load one attachment while enforcing its conversation ownership.
    pub fn get_attachment(&self, conversation_id: &str, id: &str) -> Result<AttachmentRecord> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            &format!("SELECT {ATTACHMENT_COLUMNS} FROM attachments WHERE id = ?1 AND conversation_id = ?2"),
            params![id, conversation_id],
            attachment_from_row,
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => EngineError::NotFound {
                resource: "attachment".into(),
                id: id.into(),
            },
            other => other.into(),
        })
    }

    /// Associate uploaded attachments with the authoritative persisted message.
    pub fn bind_attachments_to_message(
        &self,
        conversation_id: &str,
        message_id: &str,
        attachment_ids: &[String],
    ) -> Result<usize> {
        let mut conn = self.conn.lock().unwrap();
        let transaction = conn.transaction()?;
        let now = chrono::Utc::now().timestamp_millis();
        let mut updated = 0;
        for id in attachment_ids {
            updated += transaction.execute(
                "UPDATE attachments SET message_id = ?1, updated_at = ?2
                 WHERE id = ?3 AND conversation_id = ?4 AND message_id IS NULL",
                params![message_id, now, id, conversation_id],
            )?;
        }
        transaction.commit()?;
        Ok(updated)
    }

    /// Update parser output after external processing.
    pub fn update_attachment_processing(
        &self,
        conversation_id: &str,
        id: &str,
        status: &str,
        method: &str,
        extracted_text: &str,
        error_message: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let updated = conn.execute(
            "UPDATE attachments SET processing_status=?1, processing_method=?2, extracted_text=?3, error_message=?4, updated_at=?5 WHERE id=?6 AND conversation_id=?7",
            params![status, method, extracted_text, error_message, chrono::Utc::now().timestamp_millis(), id, conversation_id],
        )?;
        if updated == 0 {
            return Err(EngineError::NotFound {
                resource: "attachment".into(),
                id: id.into(),
            });
        }
        Ok(())
    }

    /// Delete metadata and report whether its content hash is now unreferenced.
    pub fn delete_attachment(&self, conversation_id: &str, id: &str) -> Result<(String, bool)> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let sha256 = tx
            .query_row(
                "SELECT sha256 FROM attachments WHERE id=?1 AND conversation_id=?2",
                params![id, conversation_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => EngineError::NotFound {
                    resource: "attachment".into(),
                    id: id.into(),
                },
                other => other.into(),
            })?;
        tx.execute("DELETE FROM attachments WHERE id=?1", [id])?;
        let references: i64 = tx.query_row(
            "SELECT COUNT(*) FROM attachments WHERE sha256=?1",
            [&sha256],
            |row| row.get(0),
        )?;
        tx.commit()?;
        Ok((sha256, references == 0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use encorehub_core::Conversation;

    /// Build a real migrated database with the parent conversation required by FKs.
    fn database() -> (tempfile::TempDir, Database, String) {
        let temp = tempfile::tempdir().unwrap();
        let database = Database::open_and_return(temp.path().join("encorehub.db")).unwrap();
        let conversation = Conversation::new("Attachments", "openai", "gpt-4o");
        let id = conversation.id.clone();
        database.create_conversation(&conversation).unwrap();
        (temp, database, id)
    }

    #[test]
    fn attachment_metadata_round_trips_and_lists_by_conversation() {
        let (_temp, database, conversation_id) = database();
        let attachment = AttachmentRecord {
            id: "attachment-1".into(),
            conversation_id: conversation_id.clone(),
            message_id: None,
            file_name: "notes.txt".into(),
            mime_type: "text/plain".into(),
            file_category: "text".into(),
            size_bytes: 5,
            sha256: "ab1234".into(),
            storage_path: "ab/1234.bin".into(),
            processing_status: "ready".into(),
            processing_method: "plain_text".into(),
            extracted_text: "hello".into(),
            error_message: String::new(),
            created_at: 1,
            updated_at: 1,
        };

        database.insert_attachment(&attachment).unwrap();

        assert_eq!(
            database.list_attachments(&conversation_id).unwrap(),
            vec![attachment]
        );
    }

    #[test]
    fn attachment_binding_failure_rolls_back_pending_turn() {
        let (_temp, database, conversation_id) = database();
        let attachment = AttachmentRecord {
            id: "attachment-1".into(),
            conversation_id: conversation_id.clone(),
            message_id: None,
            file_name: "image.png".into(),
            mime_type: "image/png".into(),
            file_category: "image".into(),
            size_bytes: 1,
            sha256: "ab1234".into(),
            storage_path: "ab/1234.bin".into(),
            processing_status: "ready".into(),
            processing_method: "vision".into(),
            extracted_text: String::new(),
            error_message: String::new(),
            created_at: 1,
            updated_at: 1,
        };
        database.insert_attachment(&attachment).unwrap();
        let mut message = encorehub_core::Message::new(
            &conversation_id,
            encorehub_core::Role::User,
            "[Attachment: image.png]",
            None,
        );
        message.status = encorehub_core::MessageStatus::Pending;

        let result = database
            .begin_chat_turn_with_attachments(&message, &[attachment.id.clone(), "missing".into()]);

        assert!(result.is_err());
        assert!(database.get_messages(&conversation_id).unwrap().is_empty());
        assert_eq!(
            database
                .get_attachment(&conversation_id, &attachment.id)
                .unwrap()
                .message_id,
            None
        );
    }

    #[test]
    fn conversation_delete_only_reclaims_unshared_attachment_hashes() {
        let (_temp, database, first_conversation_id) = database();
        let second = Conversation::new("Second", "openai", "gpt-4o");
        database.create_conversation(&second).unwrap();
        for (id, conversation_id, sha256) in [
            ("shared-first", &first_conversation_id, "shared-hash"),
            ("shared-second", &second.id, "shared-hash"),
            ("unique-first", &first_conversation_id, "unique-hash"),
        ] {
            database
                .insert_attachment(&AttachmentRecord {
                    id: id.into(),
                    conversation_id: conversation_id.clone(),
                    message_id: None,
                    file_name: "image.png".into(),
                    mime_type: "image/png".into(),
                    file_category: "image".into(),
                    size_bytes: 1,
                    sha256: sha256.into(),
                    storage_path: format!("{sha256}.bin"),
                    processing_status: "ready".into(),
                    processing_method: "vision".into(),
                    extracted_text: String::new(),
                    error_message: String::new(),
                    created_at: 1,
                    updated_at: 1,
                })
                .unwrap();
        }

        let hashes = database
            .delete_conversation(&first_conversation_id)
            .unwrap();

        assert_eq!(hashes, vec!["unique-hash"]);
        assert_eq!(database.list_attachments(&second.id).unwrap().len(), 1);
    }
}
