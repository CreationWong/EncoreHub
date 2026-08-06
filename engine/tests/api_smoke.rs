//! Black-box integration tests against the engine's axum router.
//!
//! Builds the same Router the binary uses, then drives it with
//! `tower::ServiceExt::oneshot` so we exercise routing, extractors, and
//! serializer wiring without binding a TCP port.

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
    middleware::{self, Next},
    response::Response,
};
use encorehub_engine::api::build_router_with;
use encorehub_skill::SkillRegistry;
use encorehub_storage::Database;
use rusqlite::Connection;
use serde_json::{json, Value};
use tempfile::TempDir;
use tower::ServiceExt;

const TEST_AUTH_TOKEN: &str = "wf02-engine-test-token";

async fn inject_test_auth(mut request: Request<Body>, next: Next) -> Response {
    request.headers_mut().insert(
        header::AUTHORIZATION,
        "Bearer wf02-engine-test-token".parse().unwrap(),
    );
    next.run(request).await
}

fn make_app() -> (TempDir, axum::Router) {
    let (dir, app, _path) = make_app_with_path();
    (dir, app)
}

fn make_app_with_path() -> (TempDir, axum::Router, std::path::PathBuf) {
    let (dir, app, db_path) = make_raw_app_with_path();
    let app = app.layer(middleware::from_fn(inject_test_auth));
    (dir, app, db_path)
}

fn make_raw_app_with_path() -> (TempDir, axum::Router, std::path::PathBuf) {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("test.db");
    let db = Database::open_and_return(&db_path).expect("open db");
    let skills = SkillRegistry::load(dir.path().join("nonexistent-skills"));
    let app = build_router_with(db, skills, None, TEST_AUTH_TOKEN.to_string());
    (dir, app, db_path)
}

async fn body_json(resp: axum::http::Response<Body>) -> Value {
    let bytes = to_bytes(resp.into_body(), 1 << 20).await.expect("body");
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

fn json_post(method: &str, path: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[tokio::test]
async fn health_returns_json_with_db_ok() {
    let (_dir, app) = make_app();
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/health/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["service"], "encorehub-engine");
    assert_eq!(v["status"], "ok");
    assert_eq!(v["database"]["ok"], true);
}

#[tokio::test]
async fn liveness_is_public_but_readiness_requires_auth() {
    let (_dir, app, _) = make_raw_app_with_path();

    let live = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health/live")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(live.status(), StatusCode::OK);

    let readiness = app
        .oneshot(
            Request::builder()
                .uri("/health/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(readiness.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn readiness_returns_503_when_database_probe_fails() {
    let (_dir, app, db_path) = make_raw_app_with_path();
    let connection = Connection::open(db_path).expect("open second connection");
    connection
        .execute_batch("DROP TABLE config;")
        .expect("break readiness probe");

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health/ready")
                .header(header::AUTHORIZATION, format!("Bearer {TEST_AUTH_TOKEN}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = body_json(response).await;
    assert_eq!(body["status"], "not_ready");
    assert_eq!(body["database"]["ok"], false);
}

#[tokio::test]
async fn protected_resources_reject_missing_and_wrong_tokens() {
    for path in [
        "/api/secrets/status",
        "/api/config/wf02-probe",
        "/api/conversations",
    ] {
        for authorization in [None, Some("Bearer wrong-token")] {
            let (_dir, app, _) = make_raw_app_with_path();
            let mut request = Request::builder().uri(path);
            if let Some(value) = authorization {
                request = request.header(header::AUTHORIZATION, value);
            }
            let response = app
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                StatusCode::UNAUTHORIZED,
                "path={path}, authorization={authorization:?}"
            );
        }
    }
}

#[tokio::test]
async fn protected_resources_accept_the_internal_token_without_cors() {
    for path in [
        "/api/secrets/status",
        "/api/config/wf02-probe",
        "/api/conversations",
    ] {
        let (_dir, app, _) = make_raw_app_with_path();
        let response = app
            .oneshot(
                Request::builder()
                    .uri(path)
                    .header(header::AUTHORIZATION, format!("Bearer {TEST_AUTH_TOKEN}"))
                    .header(header::ORIGIN, "https://evil.example")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "path={path}");
        assert!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .is_none(),
            "Engine must not grant browser CORS access for {path}"
        );
    }
}

#[tokio::test]
async fn empty_router_token_fails_closed() {
    let dir = TempDir::new().expect("tempdir");
    let db = Database::open_and_return(dir.path().join("test.db")).expect("open db");
    let skills = SkillRegistry::load(dir.path().join("nonexistent-skills"));
    let app = build_router_with(db, skills, None, String::new());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/conversations")
                .header(header::AUTHORIZATION, "Bearer ")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn create_then_list_then_get_then_rename_then_delete() {
    let (_dir, app) = make_app();

    // Create
    let resp = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/conversations",
            json!({"title":"first","provider":"openai","model":"gpt-4o"}),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = body_json(resp).await;
    let id = created["id"].as_str().expect("id").to_string();
    assert_eq!(created["title"], "first");

    // List
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/conversations")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = body_json(resp).await;
    assert_eq!(listed["total"], 1);
    assert!(listed["conversations"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["id"] == id));

    // Get
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/conversations/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let one = body_json(resp).await;
    assert_eq!(one["title"], "first");

    // Rename
    let resp = app
        .clone()
        .oneshot(json_post(
            "PATCH",
            &format!("/api/conversations/{id}"),
            json!({"title":"renamed"}),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let renamed = body_json(resp).await;
    assert_eq!(renamed["title"], "renamed");

    // Change the authoritative provider/model without creating a conversation.
    let resp = app
        .clone()
        .oneshot(json_post(
            "PATCH",
            &format!("/api/conversations/{id}"),
            json!({"provider":"anthropic","model":"claude-sonnet-4"}),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let updated = body_json(resp).await;
    assert_eq!(updated["id"], id);
    assert_eq!(updated["title"], "renamed");
    assert_eq!(updated["provider"], "anthropic");
    assert_eq!(updated["model"], "claude-sonnet-4");

    // Delete
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/conversations/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Get again -> 404
    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/conversations/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn rename_rejects_empty_title() {
    let (_dir, app) = make_app();

    let create = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/conversations",
            json!({"title":"x","provider":"","model":""}),
        ))
        .await
        .unwrap();
    let id = body_json(create).await["id"].as_str().unwrap().to_string();

    let resp = app
        .oneshot(json_post(
            "PATCH",
            &format!("/api/conversations/{id}"),
            json!({"title":"   "}),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn update_rejects_incomplete_provider_model_pair() {
    let (_dir, app) = make_app();

    let create = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/conversations",
            json!({"title":"x","provider":"openai","model":"gpt-4o"}),
        ))
        .await
        .unwrap();
    let id = body_json(create).await["id"].as_str().unwrap().to_string();

    let resp = app
        .oneshot(json_post(
            "PATCH",
            &format!("/api/conversations/{id}"),
            json!({"provider":"anthropic"}),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn skills_list_works_with_empty_registry() {
    let (_dir, app) = make_app();
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/skills")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert!(v["skills"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn knowledge_ingest_list_search_delete() {
    let (_dir, app) = make_app();

    // Ingest
    let resp = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/knowledge",
            json!({
                "title": "encorehub-readme",
                "content": "EncoreHub uses Tauri for the desktop shell.",
            }),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let doc = body_json(resp).await;
    let doc_id = doc["id"].as_str().unwrap().to_string();
    assert_eq!(doc["title"], "encorehub-readme");
    assert!(doc["chunk_count"].as_i64().unwrap() >= 1);

    // List
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/knowledge")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let listed = body_json(resp).await;
    // engine returns a flat array (Vec<DocumentResponse>), not {documents,total}
    let arr = listed.as_array().expect("list returns an array");
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["id"], doc_id);

    // Search
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/knowledge/search?q=Tauri&top_k=3")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let hits = body_json(resp).await;
    assert!(!hits["results"].as_array().unwrap().is_empty());

    // Delete
    let resp = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/knowledge/{doc_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "delete status = {}",
        resp.status()
    );
}

#[tokio::test]
async fn memories_list_and_search_are_empty_initially() {
    // A fresh database has groups and role settings, but no memory is created
    // until a model explicitly invokes a memory tool.
    let (_dir, app) = make_app();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/memories")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["total"], 0);
    assert!(v["memories"].as_array().unwrap().is_empty());

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/memories/search?q=anything")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["query"], "anything");
    assert!(v["results"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn character_memory_groups_and_mode_settings_are_role_scoped() {
    let (_dir, app) = make_app();
    let created = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/characters",
            json!({"name": "Archivist"}),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let character_id = body_json(created).await["id"].as_str().unwrap().to_string();

    let groups = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/memory-groups")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(groups.status(), StatusCode::OK);
    let groups = body_json(groups).await;
    assert!(groups["groups"].as_array().unwrap().iter().any(|group| {
        group["owner_character_id"] == character_id && group["group_type"] == "character"
    }));
    assert!(groups["groups"]
        .as_array()
        .unwrap()
        .iter()
        .any(|group| group["group_type"] == "global"));

    let settings_path = format!("/api/characters/{character_id}/memory-settings");
    let settings = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(&settings_path)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(settings.status(), StatusCode::OK);
    let settings = body_json(settings).await;
    assert_eq!(settings["settings"]["default_mode"], "simple");
    assert!(settings["visible_group_ids"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "global"));

    let updated = app
        .oneshot(json_post(
            "PUT",
            &settings_path,
            json!({
                "default_mode": "rag",
                "realistic_enabled": false,
                "inherited_groups": []
            }),
        ))
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(body_json(updated).await["settings"]["default_mode"], "rag");
}

#[tokio::test]
async fn conversation_memory_mode_only_upgrades_and_never_enters_realistic() {
    let (_dir, app) = make_app();
    let conversation = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/conversations",
            json!({"title": "mode floor", "character_id": "default"}),
        ))
        .await
        .unwrap();
    let conversation_id = body_json(conversation).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let resolve_path = format!("/api/conversations/{conversation_id}/memory-mode/resolve");

    let initial = app
        .clone()
        .oneshot(json_post("POST", &resolve_path, json!({})))
        .await
        .unwrap();
    assert_eq!(body_json(initial).await["mode"], "simple");

    let rag = app
        .clone()
        .oneshot(json_post(
            "PUT",
            "/api/characters/default/memory-settings",
            json!({
                "default_mode": "rag",
                "realistic_enabled": false,
                "inherited_groups": []
            }),
        ))
        .await
        .unwrap();
    assert_eq!(rag.status(), StatusCode::OK);
    let upgraded = app
        .clone()
        .oneshot(json_post("POST", &resolve_path, json!({})))
        .await
        .unwrap();
    assert_eq!(body_json(upgraded).await["mode"], "rag");

    let simple = app
        .clone()
        .oneshot(json_post(
            "PUT",
            "/api/characters/default/memory-settings",
            json!({
                "default_mode": "simple",
                "realistic_enabled": false,
                "inherited_groups": []
            }),
        ))
        .await
        .unwrap();
    assert_eq!(simple.status(), StatusCode::OK);
    let retained = app
        .clone()
        .oneshot(json_post("POST", &resolve_path, json!({})))
        .await
        .unwrap();
    assert_eq!(body_json(retained).await["mode"], "rag");

    let realistic = app
        .clone()
        .oneshot(json_post(
            "PUT",
            "/api/characters/default/memory-settings",
            json!({
                "default_mode": "realistic",
                "realistic_enabled": true,
                "inherited_groups": []
            }),
        ))
        .await
        .unwrap();
    assert_eq!(realistic.status(), StatusCode::OK);
    let still_rag = app
        .oneshot(json_post("POST", &resolve_path, json!({})))
        .await
        .unwrap();
    assert_eq!(body_json(still_rag).await["mode"], "rag");
}

#[tokio::test]
async fn custom_memory_group_crud_requires_explicit_memory_disposition() {
    let (_dir, app) = make_app();
    let source = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/memory-groups",
            json!({"name": "Shared research"}),
        ))
        .await
        .unwrap();
    assert_eq!(source.status(), StatusCode::CREATED);
    let source_id = body_json(source).await["id"].as_str().unwrap().to_string();

    let renamed = app
        .clone()
        .oneshot(json_post(
            "PATCH",
            &format!("/api/memory-groups/{source_id}"),
            json!({"name": "Release research"}),
        ))
        .await
        .unwrap();
    assert_eq!(renamed.status(), StatusCode::OK);
    assert_eq!(body_json(renamed).await["name"], "Release research");

    let target = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/memory-groups",
            json!({"name": "Archive target"}),
        ))
        .await
        .unwrap();
    let target_id = body_json(target).await["id"].as_str().unwrap().to_string();

    let settings = app
        .clone()
        .oneshot(json_post(
            "PUT",
            "/api/characters/default/memory-settings",
            json!({
                "default_mode": "simple",
                "realistic_enabled": false,
                "inherited_groups": [{
                    "character_id": "default",
                    "group_id": source_id,
                    "access_mode": "read_write",
                    "priority": 0
                }]
            }),
        ))
        .await
        .unwrap();
    assert_eq!(settings.status(), StatusCode::OK);

    let conversation = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/conversations",
            json!({"title": "group transfer", "character_id": "default"}),
        ))
        .await
        .unwrap();
    let conversation_id = body_json(conversation).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let remembered = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/memories",
            json!({
                "conversation_id": conversation_id,
                "character_id": "default",
                "source_turn_id": "turn-transfer",
                "created_by_model": "test-model",
                "content": "Release research belongs to the shared project.",
                "kind": "fact",
                "reason": "group transfer test",
                "target_group_id": source_id
            }),
        ))
        .await
        .unwrap();
    assert_eq!(remembered.status(), StatusCode::CREATED);

    let missing_strategy = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/memory-groups/{source_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_strategy.status(), StatusCode::BAD_REQUEST);

    let deleted = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!(
                    "/api/memory-groups/{source_id}?strategy=transfer&target_group_id={target_id}"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);

    let transferred = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/memories?group_id={target_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(transferred.status(), StatusCode::OK);
    assert_eq!(body_json(transferred).await["total"], 1);

    let protected = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/api/memory-groups/global?strategy=delete_memories")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(protected.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn memory_remember_requires_explicit_call_and_role_group_permission() {
    let (_dir, app) = make_app();
    let conversation = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/conversations",
            json!({"title": "memory", "character_id": "default"}),
        ))
        .await
        .unwrap();
    let conversation_id = body_json(conversation).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let saved = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/memories",
            json!({
                "conversation_id": conversation_id,
                "character_id": "default",
                "source_turn_id": "turn-1",
                "created_by_model": "test-model",
                "content": "The user prefers concise technical answers.",
                "kind": "preference",
                "reason": "This preference is useful across future conversations.",
                "importance": 0.8,
                "confidence": 0.95,
                "canonical_key": "preference.response_style"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(saved.status(), StatusCode::CREATED);
    let saved = body_json(saved).await;
    assert_eq!(saved["group_id"], "character:default");
    assert_eq!(saved["state"], "long_term");
    assert_eq!(saved["kind"], "preference");
    assert_eq!(saved["canonical_key"], "preference.response_style");
    assert_eq!(saved["created"], true);
    let saved_id = saved["id"].as_str().unwrap().to_string();

    let duplicate = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/memories",
            json!({
                "conversation_id": conversation_id,
                "character_id": "default",
                "source_turn_id": "turn-duplicate",
                "created_by_model": "test-model",
                "content": "The user prefers concise technical answers",
                "kind": "preference",
                "reason": "The model attempted to remember the same fact again.",
                "canonical_key": "preference.response_style"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::OK);
    let duplicate = body_json(duplicate).await;
    assert_eq!(duplicate["created"], false);
    assert_eq!(duplicate["id"], saved_id);

    let lexical = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/memories/search?q=%E6%88%91%E6%98%AF%E8%B0%81&character_id=default&retrieval=lexical")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(lexical.status(), StatusCode::OK);
    let lexical = body_json(lexical).await;
    assert_eq!(lexical["backend"], "sqlite_fts");
    assert_eq!(lexical["results"].as_array().unwrap().len(), 1);

    let listed = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/memories?character_id=default")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    assert_eq!(body_json(listed).await["total"], 1);

    let denied = app
        .oneshot(json_post(
            "POST",
            "/api/memories",
            json!({
                "conversation_id": conversation_id,
                "character_id": "default",
                "source_turn_id": "turn-2",
                "created_by_model": "test-model",
                "content": "Do not write private role data into the global group.",
                "kind": "fact",
                "reason": "permission test",
                "target_group_id": "global"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn fts_search_accepts_user_punctuation_as_literal_text() {
    let (_dir, app) = make_app();

    let ingest = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/knowledge",
            json!({
                "title": "literal-search-fixture",
                "content": "A C++ guide for foo/bar published on 2026-07-15.",
            }),
        ))
        .await
        .unwrap();
    assert_eq!(ingest.status(), StatusCode::OK);

    for (path, should_match) in [
        ("/api/memories/search?q=%3F%3F%3F&top_k=3", false),
        ("/api/memories/search?q=what%3F&top_k=3", false),
        ("/api/memories/search?q=C%2B%2B&top_k=3", false),
        ("/api/memories/search?q=foo%2Fbar&top_k=3", false),
        ("/api/memories/search?q=2026-07-15&top_k=3", false),
        ("/api/knowledge/search?q=%3F%3F%3F&top_k=3", false),
        ("/api/knowledge/search?q=what%3F&top_k=3", false),
        ("/api/knowledge/search?q=C%2B%2B&top_k=3", true),
        ("/api/knowledge/search?q=foo%2Fbar&top_k=3", true),
        ("/api/knowledge/search?q=2026-07-15&top_k=3", true),
    ] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "path={path}");
        if should_match {
            let payload = body_json(response).await;
            assert!(
                !payload["results"].as_array().unwrap().is_empty(),
                "literal query should match fixture: path={path}"
            );
        }
    }
}

#[tokio::test]
async fn config_get_unset_returns_null_then_roundtrips() {
    let (_dir, app) = make_app();

    // Unset key → null (not 404), so the gateway can treat "no profiles yet"
    // as "use builtin defaults".
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/config/provider_profiles")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await, Value::Null);

    // PUT an array value.
    let profiles = json!([
        {"id": "openai", "name": "OpenAI", "protocol": "openai", "base_url": "https://api.openai.com/v1"}
    ]);
    let resp = app
        .clone()
        .oneshot(json_post(
            "PUT",
            "/api/config/provider_profiles",
            profiles.clone(),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // GET returns exactly what we stored.
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/config/provider_profiles")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await, profiles);
}

// ===== Secrets / encryption lifecycle =====

async fn get_text(app: &axum::Router, uri: &str) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    (status, body_json(resp).await)
}

fn reopen_test_app(db_path: &std::path::Path, skills_path: &std::path::Path) -> axum::Router {
    let db = Database::open_and_return(db_path).expect("reopen db");
    let skills = SkillRegistry::load(skills_path);
    build_router_with(db, skills, None, TEST_AUTH_TOKEN.to_string())
        .layer(middleware::from_fn(inject_test_auth))
}

#[tokio::test]
async fn secrets_plaintext_mode_store_and_read() {
    let (_dir, app) = make_app();

    // Default: not encrypted.
    let (status, v) = get_text(&app, "/api/secrets/status").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(v["encrypted"], false);
    assert_eq!(v["unlocked"], false);

    // Store a key in plaintext mode.
    let resp = app
        .clone()
        .oneshot(json_post(
            "PUT",
            "/api/secrets",
            json!({"provider_id":"openai","key":"sk-plain-123"}),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Read it back.
    let (status, v) = get_text(&app, "/api/secrets/openai").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(v["key"], "sk-plain-123");
}

#[tokio::test]
async fn secrets_enable_encrypts_existing_then_lock_unlock() {
    let (_dir, app) = make_app();

    // Seed a plaintext key.
    app.clone()
        .oneshot(json_post(
            "PUT",
            "/api/secrets",
            json!({"provider_id":"openai","key":"sk-existing"}),
        ))
        .await
        .unwrap();

    // Enable encryption — existing key gets encrypted, session unlocked.
    let resp = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/enable",
            json!({"password":"correct horse","keys":{"deepseek":"sk-seeded"}}),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let (_, v) = get_text(&app, "/api/secrets/status").await;
    assert_eq!(v["encrypted"], true);
    assert_eq!(v["unlocked"], true);

    // Both keys readable while unlocked.
    let (_, v) = get_text(&app, "/api/secrets/openai").await;
    assert_eq!(v["key"], "sk-existing");
    let (_, v) = get_text(&app, "/api/secrets/deepseek").await;
    assert_eq!(v["key"], "sk-seeded");

    // Lock → reads fail with 423 LOCKED.
    let resp = app
        .clone()
        .oneshot(json_post("POST", "/api/secrets/lock", json!({})))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    let (status, _) = get_text(&app, "/api/secrets/openai").await;
    assert_eq!(status, StatusCode::LOCKED);

    // Wrong password rejected.
    let resp = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/unlock",
            json!({"password":"wrong"}),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // Correct password unlocks.
    let resp = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/unlock",
            json!({"password":"correct horse"}),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    let (status, v) = get_text(&app, "/api/secrets/openai").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(v["key"], "sk-existing");
}

#[tokio::test]
async fn secrets_enable_failure_rolls_back_rows_and_metadata_after_restart() {
    let (dir, app, db_path) = make_app_with_path();

    for (provider_id, key) in [
        ("openai", "sk-openai-old"),
        ("anthropic", "sk-anthropic-old"),
    ] {
        let response = app
            .clone()
            .oneshot(json_post(
                "PUT",
                "/api/secrets",
                json!({"provider_id": provider_id, "key": key}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    rusqlite::Connection::open(&db_path)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER fail_crypto_meta_insert
             BEFORE INSERT ON crypto_meta
             BEGIN
                 SELECT RAISE(ABORT, 'injected crypto metadata failure');
             END;",
        )
        .unwrap();

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/enable",
            json!({
                "password": "enable-password",
                "keys": {"deepseek": "sk-deepseek-new"}
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    drop(app);

    let reopened = reopen_test_app(&db_path, &dir.path().join("nonexistent-skills"));
    let (_, status) = get_text(&reopened, "/api/secrets/status").await;
    assert_eq!(status["encrypted"], false);
    assert_eq!(status["unlocked"], false);

    for (provider_id, expected_key) in [
        ("openai", "sk-openai-old"),
        ("anthropic", "sk-anthropic-old"),
    ] {
        let (status, payload) = get_text(&reopened, &format!("/api/secrets/{provider_id}")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["key"], expected_key);
    }
    let (status, _) = get_text(&reopened, "/api/secrets/deepseek").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn secrets_reset_password_old_fails_new_works() {
    let (dir, app, db_path) = make_app_with_path();

    app.clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/enable",
            json!({
                "password": "old-pw",
                "keys": {
                    "openai": "sk-openai",
                    "anthropic": "sk-anthropic"
                }
            }),
        ))
        .await
        .unwrap();

    // Reset password.
    let resp = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/reset-password",
            json!({"old_password":"old-pw","new_password":"new-pw"}),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    drop(app);

    // A fresh process starts locked: the old password fails and the new one
    // unlocks every re-encrypted provider key.
    let reopened = reopen_test_app(&db_path, &dir.path().join("nonexistent-skills"));
    let resp = reopened
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/unlock",
            json!({"password":"old-pw"}),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    let resp = reopened
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/unlock",
            json!({"password":"new-pw"}),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    for (provider_id, expected_key) in [("openai", "sk-openai"), ("anthropic", "sk-anthropic")] {
        let (status, payload) = get_text(&reopened, &format!("/api/secrets/{provider_id}")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["key"], expected_key);
    }
}

#[tokio::test]
async fn secrets_reset_failure_keeps_old_password_and_all_keys_after_restart() {
    let (dir, app, db_path) = make_app_with_path();

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/enable",
            json!({
                "password": "old-password",
                "keys": {
                    "openai": "sk-openai-old",
                    "anthropic": "sk-anthropic-old"
                }
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    rusqlite::Connection::open(&db_path)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER fail_crypto_meta_rotate
             BEFORE INSERT ON crypto_meta
             BEGIN
                 SELECT RAISE(ABORT, 'injected crypto metadata failure');
             END;",
        )
        .unwrap();

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/reset-password",
            json!({"old_password": "old-password", "new_password": "new-password"}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    drop(app);

    let reopened = reopen_test_app(&db_path, &dir.path().join("nonexistent-skills"));
    let response = reopened
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/unlock",
            json!({"password": "old-password"}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    for (provider_id, expected_key) in [
        ("openai", "sk-openai-old"),
        ("anthropic", "sk-anthropic-old"),
    ] {
        let (status, payload) = get_text(&reopened, &format!("/api/secrets/{provider_id}")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["key"], expected_key);
    }

    reopened
        .clone()
        .oneshot(json_post("POST", "/api/secrets/lock", json!({})))
        .await
        .unwrap();
    let response = reopened
        .oneshot(json_post(
            "POST",
            "/api/secrets/unlock",
            json!({"password": "new-password"}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn secrets_disable_returns_to_plaintext() {
    let (_dir, app) = make_app();

    app.clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/enable",
            json!({"password":"pw","keys":{"openai":"sk-xyz"}}),
        ))
        .await
        .unwrap();

    let resp = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/disable",
            json!({"password":"pw"}),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Now plaintext mode; key still readable without unlock.
    let (_, v) = get_text(&app, "/api/secrets/status").await;
    assert_eq!(v["encrypted"], false);
    let (status, v) = get_text(&app, "/api/secrets/openai").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(v["key"], "sk-xyz");
}

#[tokio::test]
async fn secrets_disable_failure_keeps_encrypted_rows_and_password_after_restart() {
    let (dir, app, db_path) = make_app_with_path();

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/enable",
            json!({
                "password": "disable-password",
                "keys": {
                    "openai": "sk-openai-encrypted",
                    "anthropic": "sk-anthropic-encrypted"
                }
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    rusqlite::Connection::open(&db_path)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER fail_crypto_meta_delete
             BEFORE DELETE ON crypto_meta
             BEGIN
                 SELECT RAISE(ABORT, 'injected crypto metadata failure');
             END;",
        )
        .unwrap();

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/disable",
            json!({"password": "disable-password"}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    drop(app);

    let connection = rusqlite::Connection::open(&db_path).unwrap();
    let non_encrypted_rows: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM secrets
             WHERE plaintext IS NOT NULL OR ciphertext IS NULL OR nonce IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(non_encrypted_rows, 0);
    drop(connection);

    let reopened = reopen_test_app(&db_path, &dir.path().join("nonexistent-skills"));
    let response = reopened
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/unlock",
            json!({"password": "disable-password"}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    for (provider_id, expected_key) in [
        ("openai", "sk-openai-encrypted"),
        ("anthropic", "sk-anthropic-encrypted"),
    ] {
        let (status, payload) = get_text(&reopened, &format!("/api/secrets/{provider_id}")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["key"], expected_key);
    }
}

#[tokio::test]
async fn config_log_level_rejects_non_string() {
    let (_dir, app) = make_app();
    // A non-string value for log_level must be rejected (it's a level name).
    let resp = app
        .clone()
        .oneshot(json_post("PUT", "/api/config/log_level", json!(123)))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // A valid string level persists (log_control is None in tests, so no apply).
    let resp = app
        .clone()
        .oneshot(json_post("PUT", "/api/config/log_level", json!("debug")))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let (status, v) = get_text(&app, "/api/config/log_level").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(v, json!("debug"));
}

#[tokio::test]
async fn secrets_encrypted_db_has_no_plaintext_key_on_disk() {
    // Acceptance check (4.8): with encryption on, the raw SQLite file must not
    // contain the plaintext API key anywhere. This is the programmatic stand-in
    // for inspecting the DB with the `sqlite3` CLI.
    let (_dir, app, db_path) = make_app_with_path();

    const SECRET: &str = "sk-super-secret-DO-NOT-LEAK-9c1f";
    let resp = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/secrets/enable",
            json!({"password":"pw-1234","keys":{"openai": SECRET}}),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Checkpoint the WAL so the encrypted row is flushed into the main db file,
    // then scan the raw bytes of every db file for the plaintext secret.
    let _ = get_text(&app, "/api/secrets/status").await;
    drop(app); // release the connection so the OS flushes

    let mut found_in_any = false;
    for suffix in ["", "-wal", "-shm"] {
        let p = format!("{}{}", db_path.display(), suffix);
        if let Ok(bytes) = std::fs::read(&p) {
            if bytes.windows(SECRET.len()).any(|w| w == SECRET.as_bytes()) {
                found_in_any = true;
            }
        }
    }
    assert!(
        !found_in_any,
        "plaintext API key must not appear anywhere in the on-disk database"
    );
}

#[tokio::test]
async fn append_message_persists_reasoning_and_tool_calls() {
    let (_dir, app) = make_app();

    // Create a conversation.
    let resp = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/conversations",
            json!({"title":"reason","provider":"deepseek","model":"deepseek-reasoner"}),
        ))
        .await
        .unwrap();
    let id = body_json(resp).await["id"].as_str().unwrap().to_string();

    // Append an assistant message carrying reasoning + a tool call.
    let resp = app
        .clone()
        .oneshot(json_post(
            "POST",
            &format!("/api/conversations/{id}/messages/append"),
            json!({
                "content": "The answer is 4.",
                "role": "assistant",
                "reasoning": "2 plus 2 is 4.",
                "tool_calls": [
                    {"name": "calculator", "arguments": "{\"a\":2,\"b\":2}", "result": "4", "status": "success"}
                ]
            }),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let appended = body_json(resp).await;
    assert_eq!(appended["reasoning"], "2 plus 2 is 4.");
    assert_eq!(appended["tool_calls"][0]["name"], "calculator");
    assert_eq!(appended["tool_calls"][0]["status"], "success");

    // Re-read via GET to confirm it round-trips from storage.
    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/conversations/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let detail = body_json(resp).await;
    let msg = &detail["messages"][0];
    assert_eq!(msg["reasoning"], "2 plus 2 is 4.");
    assert_eq!(msg["tool_calls"][0]["result"], "4");
    assert_eq!(msg["tool_calls"][0]["arguments"], "{\"a\":2,\"b\":2}");
}

#[tokio::test]
async fn character_versions_snapshot_new_conversations_and_upgrade_explicitly() {
    let (_dir, app) = make_app();

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/characters",
            json!({
                "name": "Archivist",
                "description": "Answers from documented evidence.",
                "system_prompt": "Version one prompt",
                "default_provider": "anthropic",
                "default_model": "claude-sonnet-4",
                "opening_message": "What should we research?",
                "tags": ["research"]
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let character = body_json(response).await;
    let character_id = character["id"].as_str().unwrap().to_string();
    assert_eq!(character["version"], 1);

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/conversations",
            json!({"title": "Old", "character_id": character_id}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let old_conversation = body_json(response).await;
    let old_id = old_conversation["id"].as_str().unwrap().to_string();
    assert_eq!(old_conversation["provider"], "anthropic");
    assert_eq!(old_conversation["model"], "claude-sonnet-4");
    assert_eq!(old_conversation["character_version"], 1);
    assert_eq!(
        old_conversation["character_snapshot"]["system_prompt"],
        "Version one prompt"
    );

    let response = app
        .clone()
        .oneshot(json_post(
            "PATCH",
            &format!("/api/characters/{character_id}"),
            json!({
                "expected_revision": 1,
                "system_prompt": "Version two prompt",
                "default_model": "claude-opus-4"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let working_copy = body_json(response).await;
    assert_eq!(working_copy["version"], 1);
    assert_eq!(working_copy["revision"], 2);

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            &format!("/api/characters/{character_id}/versions"),
            json!({
                "expected_revision": 2,
                "message": "Use the stronger research model"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let committed = body_json(response).await;
    assert_eq!(committed["version"], 2);
    assert_eq!(committed["revision"], 3);

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/conversations",
            json!({"title": "New", "character_id": character_id}),
        ))
        .await
        .unwrap();
    let new_conversation = body_json(response).await;
    assert_eq!(new_conversation["character_version"], 2);
    assert_eq!(new_conversation["model"], "claude-opus-4");
    assert_eq!(
        new_conversation["character_snapshot"]["system_prompt"],
        "Version two prompt"
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/conversations/{old_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let old_detail = body_json(response).await;
    assert_eq!(old_detail["character_version"], 1);
    assert_eq!(
        old_detail["character_snapshot"]["system_prompt"],
        "Version one prompt"
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/conversations/{old_id}/character-upgrade"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let preview = body_json(response).await;
    assert_eq!(preview["from_version"], 1);
    assert_eq!(preview["to_version"], 2);
    assert_eq!(preview["changed"], true);

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            &format!("/api/conversations/{old_id}/character-upgrade"),
            json!({"expected_character_version": 1}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let upgraded = body_json(response).await;
    assert_eq!(upgraded["character_version"], 2);
    assert_eq!(upgraded["model"], "claude-opus-4");
    assert_eq!(
        upgraded["character_snapshot"]["system_prompt"],
        "Version two prompt"
    );
}

#[tokio::test]
async fn character_history_branches_and_restore_preserve_the_version_graph() {
    let (_dir, app) = make_app();
    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/characters",
            json!({"name": "Editor", "system_prompt": "Main prompt"}),
        ))
        .await
        .unwrap();
    let character = body_json(response).await;
    let character_id = character["id"].as_str().unwrap();

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            &format!("/api/characters/{character_id}/branches"),
            json!({
                "expected_revision": 1,
                "name": "alternative",
                "from_version": 1
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let branched = body_json(response).await;
    assert_eq!(branched["active_branch"], "alternative");
    assert_eq!(branched["revision"], 2);

    let response = app
        .clone()
        .oneshot(json_post(
            "PATCH",
            &format!("/api/characters/{character_id}"),
            json!({
                "expected_revision": 2,
                "system_prompt": "Alternative prompt"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            &format!("/api/characters/{character_id}/versions"),
            json!({"expected_revision": 3, "message": "Alternative direction"}),
        ))
        .await
        .unwrap();
    let committed = body_json(response).await;
    assert_eq!(committed["version"], 2);
    assert_eq!(committed["revision"], 4);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/characters/{character_id}/history"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let history = body_json(response).await;
    assert_eq!(history["branches"].as_array().unwrap().len(), 2);
    assert_eq!(history["versions"].as_array().unwrap().len(), 2);
    assert_eq!(history["versions"][0]["parent_version"], 1);
    assert_eq!(history["versions"][0]["branch_name"], "alternative");

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            &format!("/api/characters/{character_id}/versions/1/restore"),
            json!({"expected_revision": 4}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let restored = body_json(response).await;
    assert_eq!(restored["version"], 1);
    assert_eq!(restored["revision"], 5);
    assert_eq!(restored["active_branch"], "alternative");
    assert_eq!(restored["system_prompt"], "Main prompt");

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/characters/history")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let global = body_json(response).await;
    assert!(global["histories"].as_array().unwrap().len() >= 2);
}

#[tokio::test]
async fn deleting_character_keeps_historical_conversation_snapshot() {
    let (_dir, app) = make_app();
    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/characters",
            json!({"name": "Temporary", "system_prompt": "Snapshot canary"}),
        ))
        .await
        .unwrap();
    let character_id = body_json(response).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/conversations",
            json!({"title": "History", "character_id": character_id}),
        ))
        .await
        .unwrap();
    let conversation_id = body_json(response).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let response = app
        .clone()
        .oneshot(json_post(
            "DELETE",
            &format!("/api/characters/{character_id}"),
            Value::Null,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/conversations/{conversation_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let historical = body_json(response).await;
    assert_eq!(historical["character_id"], character_id);
    assert_eq!(
        historical["character_snapshot"]["system_prompt"],
        "Snapshot canary"
    );

    let response = app
        .oneshot(json_post(
            "POST",
            "/api/conversations",
            json!({"title": "Rejected", "character_id": character_id}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn character_api_enforces_default_delete_conflicts_and_text_limits() {
    let (_dir, app) = make_app();

    let response = app
        .clone()
        .oneshot(json_post("DELETE", "/api/characters/default", Value::Null))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);

    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(json_post(
                "POST",
                "/api/characters",
                json!({"name": "Same name"}),
            ))
            .await
            .unwrap();
        if response.status() != StatusCode::CREATED {
            assert_eq!(response.status(), StatusCode::CONFLICT);
        }
    }

    let response = app
        .oneshot(json_post(
            "POST",
            "/api/characters",
            json!({
                "name": "Too long",
                "system_prompt": "x".repeat(65_537)
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn concurrent_conversation_creation_uses_one_character_revision() {
    let (_dir, app) = make_app();
    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/characters",
            json!({"name": "Concurrent", "system_prompt": "Stable revision"}),
        ))
        .await
        .unwrap();
    let character_id = body_json(response).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let first = app.clone().oneshot(json_post(
        "POST",
        "/api/conversations",
        json!({"title": "First", "character_id": character_id}),
    ));
    let second = app.clone().oneshot(json_post(
        "POST",
        "/api/conversations",
        json!({"title": "Second", "character_id": character_id}),
    ));
    let (first, second) = tokio::join!(first, second);
    let first = body_json(first.unwrap()).await;
    let second = body_json(second.unwrap()).await;

    for conversation in [first, second] {
        assert_eq!(conversation["character_version"], 1);
        assert_eq!(
            conversation["character_snapshot"]["system_prompt"],
            "Stable revision"
        );
    }
}

#[tokio::test]
async fn chat_turn_begin_and_finalize_return_authoritative_messages() {
    let (_dir, app) = make_app();

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/conversations",
            json!({"title":"turn","provider":"deepseek","model":"deepseek-chat"}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let conversation_id = body_json(response).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            &format!("/api/conversations/{conversation_id}/turns"),
            json!({"content": "hello"}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let user = body_json(response).await;
    assert_eq!(user["role"], "user");
    assert_eq!(user["status"], "pending");
    let turn_id = user["id"].as_str().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            &format!("/api/conversations/{conversation_id}/turns/{turn_id}/finalize"),
            json!({
                "status": "completed",
                "assistant": {
                    "content": "world",
                    "reasoning": "checked",
                    "token_count": 42,
                    "input_tokens": 30,
                    "output_tokens": 12,
                    "cache_creation_input_tokens": 8,
                    "cache_read_input_tokens": 14,
                    "context_input_tokens": 24,
                    "context_output_tokens": 12,
                    "duration_ms": 750,
                    "finish_reason": "stop",
                    "tool_calls": [{
                        "id": "provider-call-1",
                        "name": "web_search",
                        "arguments": "{\"query\":\"hello\"}",
                        "result": "found",
                        "status": "success"
                    }]
                }
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let finalized = body_json(response).await;
    assert_eq!(finalized["user_message"]["id"], turn_id);
    assert_eq!(finalized["user_message"]["status"], "completed");
    assert_eq!(finalized["assistant_message"]["status"], "completed");
    assert_eq!(finalized["assistant_message"]["parent_id"], turn_id);
    assert_eq!(finalized["assistant_message"]["token_count"], 42);
    assert_eq!(finalized["assistant_message"]["input_tokens"], 30);
    assert_eq!(
        finalized["assistant_message"]["cache_creation_input_tokens"],
        8
    );
    assert_eq!(
        finalized["assistant_message"]["cache_read_input_tokens"],
        14
    );
    assert_eq!(finalized["assistant_message"]["context_input_tokens"], 24);
    assert_eq!(finalized["assistant_message"]["context_output_tokens"], 12);
    assert_eq!(finalized["assistant_message"]["output_tokens"], 12);
    assert_eq!(finalized["assistant_message"]["duration_ms"], 750);
    assert_eq!(finalized["assistant_message"]["finish_reason"], "stop");
    assert_eq!(
        finalized["assistant_message"]["tool_calls"][0]["id"],
        "provider-call-1"
    );

    let (_, conversation) = get_text(&app, &format!("/api/conversations/{conversation_id}")).await;
    assert_eq!(conversation["messages"][0], finalized["user_message"]);
    assert_eq!(conversation["messages"][1], finalized["assistant_message"]);

    let memories = app
        .oneshot(
            Request::builder()
                .uri("/api/memories")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(memories.status(), StatusCode::OK);
    assert_eq!(body_json(memories).await["total"], 0);
}

#[tokio::test]
async fn attachment_only_turn_returns_safe_attachment_summary_without_placeholder_text() {
    let (_dir, app, db_path) = make_app_with_path();
    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/conversations",
            json!({"title":"attachment turn","provider":"openai","model":"gpt-4o"}),
        ))
        .await
        .unwrap();
    let conversation_id = body_json(response).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    rusqlite::Connection::open(&db_path)
        .unwrap()
        .execute(
            "INSERT INTO attachments
             (id, conversation_id, message_id, file_name, mime_type, file_category,
              size_bytes, sha256, storage_path, processing_status, processing_method,
              extracted_text, error_message, created_at, updated_at)
             VALUES (?1, ?2, NULL, 'screen.png', 'image/png', 'image', 5, 'hash',
                     'ha/sh.bin', 'ready', 'system_ocr', 'private OCR text', '', 1, 1)",
            rusqlite::params!["attachment-1", conversation_id],
        )
        .unwrap();

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            &format!("/api/conversations/{conversation_id}/turns"),
            json!({"content": "", "attachment_ids": ["attachment-1"]}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let user = body_json(response).await;
    assert_eq!(user["content"], "");
    assert_eq!(user["attachments"][0]["id"], "attachment-1");
    assert_eq!(user["attachments"][0]["file_name"], "screen.png");
    assert!(user["attachments"][0].get("storage_path").is_none());
    assert!(user["attachments"][0].get("extracted_text").is_none());

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/conversations/{conversation_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let detail = body_json(response).await;
    assert_eq!(detail["messages"][0]["content"], "");
    assert_eq!(
        detail["messages"][0]["attachments"][0]["id"],
        "attachment-1"
    );
}

#[tokio::test]
async fn chat_turn_finalize_failure_keeps_pending_root_without_assistant() {
    let (dir, app, db_path) = make_app_with_path();

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            "/api/conversations",
            json!({"title":"failure","provider":"deepseek","model":"deepseek-chat"}),
        ))
        .await
        .unwrap();
    let conversation_id = body_json(response).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            &format!("/api/conversations/{conversation_id}/turns"),
            json!({"content": "hello"}),
        ))
        .await
        .unwrap();
    let turn_id = body_json(response).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    rusqlite::Connection::open(&db_path)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER fail_assistant_insert
             BEFORE INSERT ON messages WHEN NEW.role = 'assistant'
             BEGIN SELECT RAISE(ABORT, 'injected assistant failure'); END;",
        )
        .unwrap();

    let response = app
        .clone()
        .oneshot(json_post(
            "POST",
            &format!("/api/conversations/{conversation_id}/turns/{turn_id}/finalize"),
            json!({
                "status": "completed",
                "assistant": {
                    "content": "must roll back",
                    "tool_calls": [{"name": "web_search", "arguments": "{}"}]
                }
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    drop(app);

    let reopened = reopen_test_app(&db_path, &dir.path().join("nonexistent-skills"));
    let (_, conversation) =
        get_text(&reopened, &format!("/api/conversations/{conversation_id}")).await;
    assert_eq!(conversation["messages"].as_array().unwrap().len(), 1);
    assert_eq!(conversation["messages"][0]["id"], turn_id);
    assert_eq!(conversation["messages"][0]["status"], "pending");
}
