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
                .uri("/health")
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
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(readiness.status(), StatusCode::UNAUTHORIZED);
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
    // Memories are populated by chat-side consolidation logic; from a fresh
    // db the HTTP surface should still respond with empty arrays rather than
    // 500.
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
