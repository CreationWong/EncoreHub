use super::{now_ms, Database, Result};
use encorehub_core::{EngineError, Message, MessageStatus, Role, ToolCall};
use rusqlite::{params, Transaction};

impl Database {
    /// Persist a pending user message as the root of a new chat turn.
    pub fn begin_chat_turn(&self, user_message: &Message) -> Result<()> {
        if user_message.role != Role::User
            || user_message.status != MessageStatus::Pending
            || user_message.parent_id.is_some()
        {
            return Err(invalid_turn("begin requires a root pending user message"));
        }

        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        insert_message(&tx, user_message)?;
        touch_conversation(&tx, &user_message.conversation_id)?;
        tx.commit()?;
        Ok(())
    }

    /// Atomically finish a pending chat turn. The optional assistant and all
    /// of its tool calls commit together with the user terminal status.
    pub fn finalize_chat_turn(
        &self,
        conversation_id: &str,
        user_message_id: &str,
        terminal_status: MessageStatus,
        assistant: Option<&Message>,
        tool_calls: &[ToolCall],
    ) -> Result<()> {
        if !terminal_status.is_terminal() {
            return Err(invalid_turn("final status must be terminal"));
        }
        match assistant {
            Some(message) => {
                if message.role != Role::Assistant
                    || message.conversation_id != conversation_id
                    || message.parent_id.as_deref() != Some(user_message_id)
                    || message.status != terminal_status
                {
                    return Err(invalid_turn("assistant does not belong to the turn"));
                }
                if tool_calls.iter().any(|call| call.message_id != message.id) {
                    return Err(invalid_turn("tool call does not belong to the assistant"));
                }
            }
            None if !tool_calls.is_empty() => {
                return Err(invalid_turn("tool calls require an assistant message"));
            }
            None if terminal_status == MessageStatus::Completed => {
                return Err(invalid_turn("completed turns require an assistant message"));
            }
            None => {}
        }

        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let (stored_conversation_id, role, current_status) = tx
            .query_row(
                "SELECT conversation_id, role, status FROM messages WHERE id = ?1",
                params![user_message_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => EngineError::NotFound {
                    resource: "chat turn".into(),
                    id: user_message_id.into(),
                },
                other => other.into(),
            })?;
        if stored_conversation_id != conversation_id
            || role != Role::User.as_str()
            || current_status != MessageStatus::Pending.as_str()
        {
            return Err(invalid_turn("turn root is not pending"));
        }

        if let Some(message) = assistant {
            insert_message(&tx, message)?;
            for call in tool_calls {
                tx.execute(
                    "INSERT INTO tool_calls
                     (id, message_id, name, arguments, result, status)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        call.id,
                        call.message_id,
                        call.name,
                        call.arguments,
                        call.result,
                        call.status,
                    ],
                )?;
            }
        }

        tx.execute(
            "UPDATE messages SET status = ?1 WHERE id = ?2 AND status = 'pending'",
            params![terminal_status.as_str(), user_message_id],
        )?;
        touch_conversation(&tx, conversation_id)?;
        tx.commit()?;
        Ok(())
    }
}

fn insert_message(tx: &Transaction<'_>, message: &Message) -> Result<()> {
    tx.execute(
        "INSERT INTO messages
         (id, conversation_id, role, content, reasoning, parent_id, token_count,
          input_tokens, output_tokens, duration_ms, finish_reason, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            message.id,
            message.conversation_id,
            message.role.as_str(),
            message.content,
            message.reasoning,
            message.parent_id,
            message.token_count,
            message.input_tokens,
            message.output_tokens,
            message.duration_ms,
            message.finish_reason,
            message.status.as_str(),
            message.created_at.timestamp_millis(),
        ],
    )?;
    Ok(())
}

fn touch_conversation(tx: &Transaction<'_>, conversation_id: &str) -> Result<()> {
    let updated = tx.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now_ms(), conversation_id],
    )?;
    if updated == 0 {
        return Err(EngineError::NotFound {
            resource: "conversation".into(),
            id: conversation_id.into(),
        });
    }
    Ok(())
}

fn invalid_turn(message: &str) -> EngineError {
    EngineError::InvalidArgument(format!("invalid chat turn: {message}"))
}
