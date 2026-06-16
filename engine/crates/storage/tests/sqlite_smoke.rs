//! Smoke integration tests for the SQLite storage layer.
//!
//! Exercises the migration runner + a representative slice of CRUD on
//! conversations / messages / memories, using a temp-file SQLite database
//! (the production code path requires a real path; `:memory:` works but
//! parent-dir handling differs across platforms).

use encorehub_core::{Memory, MemoryScope, MemoryType, Message, Role};
use encorehub_storage::Database;
use tempfile::TempDir;

fn fresh_db() -> (TempDir, Database) {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("test.db");
    let db = Database::open_and_return(&db_path).expect("open db");
    (dir, db)
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
fn message_append_and_retrieve_keeps_order() {
    let (_dir, db) = fresh_db();
    let conv = encorehub_core::Conversation::new("c", "x", "y");
    db.create_conversation(&conv).unwrap();

    let m1 = Message::new(&conv.id, Role::User, "hi", None);
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
