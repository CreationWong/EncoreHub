//! Smoke integration tests for the SQLite storage layer.
//!
//! Exercises the migration runner + a representative slice of CRUD on
//! conversations / messages / memories, using a temp-file SQLite database
//! (the production code path requires a real path; `:memory:` works but
//! parent-dir handling differs across platforms).

use encorehub_core::{
    CryptoMeta, Memory, MemoryScope, MemoryType, Message, MessageStatus, Role, SecretRow,
};
use encorehub_storage::Database;
use tempfile::TempDir;

fn fresh_db() -> (TempDir, Database) {
    let (dir, db, _) = fresh_db_with_path();
    (dir, db)
}

fn fresh_db_with_path() -> (TempDir, Database, std::path::PathBuf) {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("test.db");
    let db = Database::open_and_return(&db_path).expect("open db");
    (dir, db, db_path)
}

#[test]
fn migrations_run_on_fresh_db() {
    let (_dir, db) = fresh_db();
    // If migrations didn't apply, set_config would fail because the
    // `app_config` (or equivalent) table wouldn't exist.
    db.set_config("smoke.test", r#""ok""#).expect("set config");
    let v = db.get_config("smoke.test").expect("get config");
    assert!(v.is_some(), "config round-trip");
}

#[test]
fn conversation_lifecycle() {
    let (_dir, db) = fresh_db();

    let conv = encorehub_core::Conversation::new("first", "openai", "gpt-4o");
    db.create_conversation(&conv).expect("create");

    let fetched = db.get_conversation(&conv.id).expect("get");
    assert_eq!(fetched.id, conv.id);
    assert_eq!(fetched.title, "first");

    db.update_conversation_title(&conv.id, "renamed")
        .expect("rename");
    let after = db.get_conversation(&conv.id).expect("get after rename");
    assert_eq!(after.title, "renamed");

    let list = db.list_conversations(10, 0).expect("list");
    assert_eq!(list.len(), 1);

    db.delete_conversation(&conv.id).expect("delete");
    assert!(
        db.get_conversation(&conv.id).is_err(),
        "should be gone after delete"
    );
}

#[test]
fn rename_bumps_updated_at() {
    let (_dir, db) = fresh_db();
    let conv = encorehub_core::Conversation::new("orig", "x", "y");
    db.create_conversation(&conv).unwrap();

    let before = db.get_conversation(&conv.id).unwrap().updated_at;

    // SQLite created_at uses second-level precision via UNIX time; sleep 1.1s
    // is overkill for CI but keeps the assertion robust against clock skew.
    std::thread::sleep(std::time::Duration::from_millis(1100));

    db.update_conversation_title(&conv.id, "new title").unwrap();
    let after = db.get_conversation(&conv.id).unwrap();

    assert_eq!(after.title, "new title");
    assert!(
        after.updated_at >= before,
        "updated_at should not move backwards: before={before} after={after_t}",
        before = before,
        after_t = after.updated_at,
    );
}

#[test]
fn message_append_and_retrieve_keeps_order() {
    let (_dir, db) = fresh_db();
    let conv = encorehub_core::Conversation::new("c", "x", "y");
    db.create_conversation(&conv).unwrap();

    let mut m1 = Message::new(&conv.id, Role::User, "hi", None);
    m1.status = MessageStatus::Pending;
    let m2 = Message::new(&conv.id, Role::Assistant, "hello", Some(m1.id.clone()));
    let m3 = Message::new(&conv.id, Role::User, "again", Some(m2.id.clone()));

    for m in [&m1, &m2, &m3] {
        db.append_message(m).expect("append");
    }

    let fetched = db.get_messages(&conv.id).expect("messages");
    assert_eq!(fetched.len(), 3);
    assert_eq!(fetched[0].content, "hi");
    assert_eq!(fetched[2].content, "again");
    assert_eq!(fetched[1].parent_id.as_deref(), Some(m1.id.as_str()));
    assert_eq!(fetched[0].status, MessageStatus::Pending);
    assert_eq!(fetched[1].status, MessageStatus::Completed);
}

#[test]
fn message_status_schema_defaults_and_rejects_invalid_states() {
    let (_dir, db, db_path) = fresh_db_with_path();
    let conv = encorehub_core::Conversation::new("status", "openai", "gpt-4o");
    db.create_conversation(&conv).unwrap();

    let connection = rusqlite::Connection::open(db_path).unwrap();
    connection
        .execute(
            "INSERT INTO messages
             (id, conversation_id, role, content, reasoning, parent_id, token_count, created_at)
             VALUES ('legacy-message', ?1, 'user', 'hello', '', NULL, 0, 1)",
            [&conv.id],
        )
        .unwrap();
    let default_status: String = connection
        .query_row(
            "SELECT status FROM messages WHERE id = 'legacy-message'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(default_status, "completed");

    connection
        .execute(
            "UPDATE messages SET status = 'pending' WHERE id = 'legacy-message'",
            [],
        )
        .unwrap();
    assert!(connection
        .execute(
            "UPDATE messages SET status = 'unknown' WHERE id = 'legacy-message'",
            [],
        )
        .is_err());
}

#[test]
fn memory_fts_search_finds_global_content() {
    let (_dir, db) = fresh_db();

    let mem = Memory::new(
        MemoryScope::Global,
        MemoryType::Semantic,
        None,
        "EncoreHub uses Tauri for the desktop shell",
        0.8,
    );
    db.store_memory(&mem).expect("store");

    let hits = db
        .search_memories_fts("Tauri", Some(&MemoryScope::Global), 10)
        .expect("fts");
    assert!(
        hits.iter().any(|m| m.id == mem.id),
        "expected to find seeded memory, got {hits:?}"
    );

    let punctuated_hits = db
        .search_memories_fts("Tauri?", Some(&MemoryScope::Global), 10)
        .expect("literal punctuation query");
    assert!(
        punctuated_hits.iter().any(|m| m.id == mem.id),
        "punctuation must not change literal memory search semantics"
    );

    // Scope filter excludes when wrong scope used
    let hits_conv = db
        .search_memories_fts("Tauri", Some(&MemoryScope::Conversation), 10)
        .expect("fts conv");
    assert!(
        hits_conv.iter().all(|m| m.id != mem.id),
        "conversation-scoped search must not return global memory"
    );
}

#[test]
fn memory_delete_removes_from_fts() {
    let (_dir, db) = fresh_db();
    let mem = Memory::new(
        MemoryScope::Global,
        MemoryType::Episodic,
        None,
        "ephemeral fact about widgets",
        0.5,
    );
    db.store_memory(&mem).unwrap();

    let before = db
        .search_memories_fts("widgets", None, 10)
        .expect("fts before");
    assert!(before.iter().any(|m| m.id == mem.id));

    db.delete_memory(&mem.id).expect("delete");

    let after = db
        .search_memories_fts("widgets", None, 10)
        .expect("fts after");
    assert!(
        after.iter().all(|m| m.id != mem.id),
        "deleted memory must not surface in FTS"
    );
}

type SecretSnapshot = (
    Vec<(String, Option<String>, Option<Vec<u8>>, Option<Vec<u8>>)>,
    Option<(bool, Vec<u8>, Vec<u8>, Vec<u8>)>,
);

fn secret_snapshot(db: &Database) -> SecretSnapshot {
    let rows = db
        .list_secrets()
        .unwrap()
        .into_iter()
        .map(|row| (row.provider_id, row.plaintext, row.ciphertext, row.nonce))
        .collect();
    let meta = db.get_crypto_meta().unwrap().map(|meta| {
        (
            meta.enabled,
            meta.salt,
            meta.verifier_ciphertext,
            meta.verifier_nonce,
        )
    });
    (rows, meta)
}

fn plaintext_secret(provider_id: &str, value: &str) -> SecretRow {
    SecretRow {
        provider_id: provider_id.to_string(),
        plaintext: Some(value.to_string()),
        ciphertext: None,
        nonce: None,
        updated_at: chrono::Utc::now(),
    }
}

fn encrypted_secret(provider_id: &str, marker: u8) -> SecretRow {
    SecretRow {
        provider_id: provider_id.to_string(),
        plaintext: None,
        ciphertext: Some(vec![marker; 24]),
        nonce: Some(vec![marker; 12]),
        updated_at: chrono::Utc::now(),
    }
}

fn crypto_meta(marker: u8) -> CryptoMeta {
    CryptoMeta {
        enabled: true,
        salt: vec![marker; 16],
        verifier_ciphertext: vec![marker; 24],
        verifier_nonce: vec![marker; 12],
        updated_at: chrono::Utc::now(),
    }
}

fn inject_secret_transition_failure(
    db_path: &std::path::Path,
    write_step: usize,
    clears_meta: bool,
) {
    let sql = match write_step {
        0 => {
            "CREATE TRIGGER fail_secret_a BEFORE INSERT ON secrets
             WHEN NEW.provider_id = 'provider-a'
             BEGIN SELECT RAISE(ABORT, 'injected provider-a failure'); END;"
        }
        1 => {
            "CREATE TRIGGER fail_secret_b BEFORE INSERT ON secrets
             WHEN NEW.provider_id = 'provider-b'
             BEGIN SELECT RAISE(ABORT, 'injected provider-b failure'); END;"
        }
        2 if clears_meta => {
            "CREATE TRIGGER fail_crypto_meta BEFORE DELETE ON crypto_meta
             BEGIN SELECT RAISE(ABORT, 'injected metadata failure'); END;"
        }
        2 => {
            "CREATE TRIGGER fail_crypto_meta BEFORE INSERT ON crypto_meta
             BEGIN SELECT RAISE(ABORT, 'injected metadata failure'); END;"
        }
        _ => unreachable!(),
    };
    rusqlite::Connection::open(db_path)
        .unwrap()
        .execute_batch(sql)
        .unwrap();
}

fn assert_failed_transition_survives_restart(
    dir: TempDir,
    db: Database,
    db_path: std::path::PathBuf,
    before: &SecretSnapshot,
) {
    assert_eq!(&secret_snapshot(&db), before);
    drop(db);

    let reopened = Database::open_and_return(&db_path).unwrap();
    assert_eq!(&secret_snapshot(&reopened), before);
    drop(reopened);
    drop(dir);
}

#[test]
fn enable_secret_encryption_rolls_back_each_write_step() {
    for write_step in 0..=2 {
        let (dir, db, db_path) = fresh_db_with_path();
        db.upsert_secret(&plaintext_secret("provider-a", "key-a"))
            .unwrap();
        db.upsert_secret(&plaintext_secret("provider-b", "key-b"))
            .unwrap();
        let before = secret_snapshot(&db);
        inject_secret_transition_failure(&db_path, write_step, false);

        let result = db.enable_secret_encryption(
            &[
                encrypted_secret("provider-a", 1),
                encrypted_secret("provider-b", 2),
            ],
            &crypto_meta(3),
        );
        let error = result.expect_err("injected write must fail");
        assert!(
            error.to_string().contains("injected"),
            "write step {write_step} failed for the wrong reason: {error}"
        );
        assert_failed_transition_survives_restart(dir, db, db_path, &before);
    }
}

#[test]
fn rotate_secret_encryption_rolls_back_each_write_step() {
    for write_step in 0..=2 {
        let (dir, db, db_path) = fresh_db_with_path();
        db.upsert_secret(&encrypted_secret("provider-a", 1))
            .unwrap();
        db.upsert_secret(&encrypted_secret("provider-b", 2))
            .unwrap();
        db.set_crypto_meta(&crypto_meta(3)).unwrap();
        let before = secret_snapshot(&db);
        inject_secret_transition_failure(&db_path, write_step, false);

        let result = db.rotate_secret_encryption(
            &[
                encrypted_secret("provider-a", 4),
                encrypted_secret("provider-b", 5),
            ],
            &crypto_meta(6),
        );
        let error = result.expect_err("injected write must fail");
        assert!(
            error.to_string().contains("injected"),
            "write step {write_step} failed for the wrong reason: {error}"
        );
        assert_failed_transition_survives_restart(dir, db, db_path, &before);
    }
}

#[test]
fn disable_secret_encryption_rolls_back_each_write_step() {
    for write_step in 0..=2 {
        let (dir, db, db_path) = fresh_db_with_path();
        db.upsert_secret(&encrypted_secret("provider-a", 1))
            .unwrap();
        db.upsert_secret(&encrypted_secret("provider-b", 2))
            .unwrap();
        db.set_crypto_meta(&crypto_meta(3)).unwrap();
        let before = secret_snapshot(&db);
        inject_secret_transition_failure(&db_path, write_step, true);

        let result = db.disable_secret_encryption(&[
            plaintext_secret("provider-a", "key-a"),
            plaintext_secret("provider-b", "key-b"),
        ]);
        let error = result.expect_err("injected write must fail");
        assert!(
            error.to_string().contains("injected"),
            "write step {write_step} failed for the wrong reason: {error}"
        );
        assert_failed_transition_survives_restart(dir, db, db_path, &before);
    }
}
