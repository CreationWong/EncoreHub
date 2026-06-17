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
