//! Black-box integration tests against the engine's axum router.
//!
//! Builds the same Router the binary uses, then drives it with
//! `tower::ServiceExt::oneshot` so we exercise routing, extractors, and
//! serializer wiring without binding a TCP port.

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use encorehub_engine::api::build_router;
use encorehub_skill::SkillRegistry;
use encorehub_storage::Database;
use serde_json::{json, Value};
use tempfile::TempDir;
use tower::ServiceExt;

fn make_app() -> (TempDir, axum::Router) {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("test.db");
    let db = Database::open_and_return(&db_path).expect("open db");
    let skills = SkillRegistry::load(dir.path().join("nonexistent-skills"));
    let app = build_router(db, skills);
    (dir, app)
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
        .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["service"], "encorehub-engine");
    assert_eq!(v["status"], "ok");
    assert_eq!(v["database"]["ok"], true);
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
    assert!(listed["conversations"].as_array().unwrap().iter().any(|c| c["id"] == id));

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
    assert!(hits["results"].as_array().unwrap().len() >= 1);

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
