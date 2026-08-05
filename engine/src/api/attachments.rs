//! Conversation attachment upload, retrieval, and deletion API.
//!
//! Rust validates and stores bytes; rich-text conversion prefers Pandoc and
//! then uses the native document-processing module in the Engine process.

use crate::api::{ErrorResponse, SharedState};
use crate::document_processing::parse_rich_text;
use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, HeaderValue, StatusCode},
    response::Response,
    Json,
};
use encorehub_storage::{AttachmentRecord, BlobStore};
use std::{path::Path as FilePath, process::Command};
use uuid::Uuid;

const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;
type ApiError = (StatusCode, Json<ErrorResponse>);

/// Return every attachment associated with a conversation.
pub async fn list(
    State(state): State<SharedState>,
    Path(conversation_id): Path<String>,
) -> Result<Json<Vec<AttachmentRecord>>, ApiError> {
    state
        .db
        .get_conversation(&conversation_id)
        .map_err(not_found)?;
    state
        .db
        .list_attachments(&conversation_id)
        .map(Json)
        .map_err(internal)
}

/// Return one attachment's metadata without exposing its absolute path.
pub async fn get(
    State(state): State<SharedState>,
    Path((conversation_id, attachment_id)): Path<(String, String)>,
) -> Result<Json<AttachmentRecord>, ApiError> {
    state
        .db
        .get_attachment(&conversation_id, &attachment_id)
        .map(Json)
        .map_err(not_found)
}

/// Accept one bounded multipart upload and extract readable text.
pub async fn upload(
    State(state): State<SharedState>,
    Path(conversation_id): Path<String>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<AttachmentRecord>), ApiError> {
    state
        .db
        .get_conversation(&conversation_id)
        .map_err(not_found)?;
    let mut upload = None;
    while let Some(field) = multipart.next_field().await.map_err(bad_request)? {
        if field.name() != Some("file") {
            continue;
        }
        let file_name = sanitize_file_name(field.file_name().unwrap_or("attachment"));
        let mime_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_ascii_lowercase();
        let bytes = field.bytes().await.map_err(bad_request)?.to_vec();
        if bytes.len() > MAX_ATTACHMENT_BYTES {
            return Err(bad_request("attachment exceeds the 20 MiB limit"));
        }
        upload = Some((file_name, mime_type, bytes));
        break;
    }
    let (file_name, mime_type, bytes) = upload.ok_or_else(|| bad_request("file field required"))?;
    let category = classify_file(&file_name, &mime_type)
        .ok_or_else(|| bad_request("unsupported attachment type"))?;
    let store = BlobStore::new(state.db.data_directory().join("blobs")).map_err(internal)?;
    let sha256 = store.store(&bytes).map_err(internal)?;
    let (status, method, extracted_text, error_message) = process_upload(
        &state.db.data_directory(),
        &file_name,
        &mime_type,
        category,
        &bytes,
    );
    let now = chrono::Utc::now().timestamp_millis();
    let attachment = AttachmentRecord {
        id: Uuid::new_v4().to_string(),
        conversation_id,
        message_id: None,
        file_name,
        mime_type,
        file_category: category.into(),
        size_bytes: bytes.len() as i64,
        storage_path: BlobStore::relative_path(&sha256),
        sha256,
        processing_status: status,
        processing_method: method,
        extracted_text,
        error_message,
        created_at: now,
        updated_at: now,
    };
    state.db.insert_attachment(&attachment).map_err(internal)?;
    Ok((StatusCode::CREATED, Json(attachment)))
}

/// Stream original bytes to the Gateway for active multimodal requests.
pub async fn content(
    State(state): State<SharedState>,
    Path((conversation_id, attachment_id)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let attachment = state
        .db
        .get_attachment(&conversation_id, &attachment_id)
        .map_err(not_found)?;
    let store = BlobStore::new(state.db.data_directory().join("blobs")).map_err(internal)?;
    let bytes = store
        .get(&attachment.sha256)
        .map_err(internal)?
        .ok_or_else(|| not_found("attachment blob missing"))?;
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&attachment.mime_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    Ok(response)
}

/// Extract image text with the local OCR service explicitly selected by the user.
pub async fn ocr(
    State(state): State<SharedState>,
    Path((conversation_id, attachment_id)): Path<(String, String)>,
) -> Result<Json<AttachmentRecord>, ApiError> {
    let mut attachment = state
        .db
        .get_attachment(&conversation_id, &attachment_id)
        .map_err(not_found)?;
    if attachment.file_category != "image" {
        return Err(bad_request("system OCR requires an image attachment"));
    }
    if attachment.processing_method == "system_ocr" && !attachment.extracted_text.is_empty() {
        return Ok(Json(attachment));
    }
    let store = BlobStore::new(state.db.data_directory().join("blobs")).map_err(internal)?;
    let bytes = store
        .get(&attachment.sha256)
        .map_err(internal)?
        .ok_or_else(|| not_found("attachment blob missing"))?;
    let text = run_system_ocr(&state.db.data_directory(), &attachment.file_name, &bytes)
        .map_err(bad_request)?;
    state
        .db
        .update_attachment_processing(
            &conversation_id,
            &attachment_id,
            "ready",
            "system_ocr",
            &text,
            "",
        )
        .map_err(internal)?;
    attachment.processing_method = "system_ocr".into();
    attachment.extracted_text = text;
    attachment.error_message.clear();
    attachment.updated_at = chrono::Utc::now().timestamp_millis();
    Ok(Json(attachment))
}

/// Remove metadata and delete a blob after its final reference disappears.
pub async fn delete(
    State(state): State<SharedState>,
    Path((conversation_id, attachment_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let (sha256, unreferenced) = state
        .db
        .delete_attachment(&conversation_id, &attachment_id)
        .map_err(not_found)?;
    if unreferenced {
        BlobStore::new(state.db.data_directory().join("blobs"))
            .map_err(internal)?
            .delete(&sha256)
            .map_err(internal)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

fn classify_file(file_name: &str, mime: &str) -> Option<&'static str> {
    let extension = FilePath::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if mime.starts_with("image/")
        && matches!(
            extension.as_str(),
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp"
        )
    {
        return Some("image");
    }
    if matches!(
        extension.as_str(),
        "docx" | "odt" | "rtf" | "html" | "htm" | "epub"
    ) {
        return Some("rich_text");
    }
    if mime.starts_with("text/")
        || matches!(
            extension.as_str(),
            "txt" | "md" | "csv" | "json" | "yaml" | "yml" | "xml" | "log" | "toml"
        )
    {
        return Some("text");
    }
    None
}

fn process_upload(
    data_dir: &FilePath,
    file_name: &str,
    mime: &str,
    category: &str,
    bytes: &[u8],
) -> (String, String, String, String) {
    if category == "image" {
        return (
            "ready".into(),
            "vision".into(),
            String::new(),
            String::new(),
        );
    }
    if category == "text" {
        return match String::from_utf8(bytes.to_vec()) {
            Ok(text) => (
                "ready".into(),
                format!("plain_text:{mime}"),
                text,
                String::new(),
            ),
            Err(_) => parser_failure("text file is not valid UTF-8"),
        };
    }
    convert_rich_text(data_dir, file_name, bytes)
}

fn convert_rich_text(
    data_dir: &FilePath,
    file_name: &str,
    bytes: &[u8],
) -> (String, String, String, String) {
    let work = data_dir.join("parser");
    if std::fs::create_dir_all(&work).is_err() {
        return parser_failure("cannot create parser workspace");
    }
    let input = work.join(format!("{}-{file_name}", Uuid::new_v4()));
    if std::fs::write(&input, bytes).is_err() {
        return parser_failure("cannot stage rich-text document");
    }
    if let Ok(output) = Command::new("pandoc")
        .arg(&input)
        .args(["--to", "gfm"])
        .output()
    {
        if output.status.success() {
            let _ = std::fs::remove_file(&input);
            return (
                "ready".into(),
                "pandoc".into(),
                String::from_utf8_lossy(&output.stdout).into_owned(),
                String::new(),
            );
        }
    }
    let _ = std::fs::remove_file(&input);
    match parse_rich_text(file_name, bytes) {
        Ok(text) => ("ready".into(), "rust".into(), text, String::new()),
        Err(error) => parser_failure(&format!("Pandoc and native parser failed: {error}")),
    }
}

/// Run a locally installed OCR executable without sending bytes over the network.
fn run_system_ocr(data_dir: &FilePath, file_name: &str, bytes: &[u8]) -> Result<String, String> {
    let work = data_dir.join("ocr");
    std::fs::create_dir_all(&work)
        .map_err(|error| format!("cannot create OCR workspace: {error}"))?;
    let extension = FilePath::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("png");
    let input = work.join(format!("{}.{}", Uuid::new_v4(), extension));
    std::fs::write(&input, bytes)
        .map_err(|error| format!("cannot stage image for OCR: {error}"))?;

    #[cfg(target_os = "windows")]
    let native_result = run_windows_ocr(&input);
    #[cfg(not(target_os = "windows"))]
    let native_result: Result<String, String> = Err("native OS OCR is unavailable".into());

    let result = native_result.or_else(|native_error| {
        Command::new("tesseract")
            .arg(&input)
            .arg("stdout")
            .output()
            .map_err(|error| format!("{native_error}; tesseract is unavailable: {error}"))
            .and_then(|output| {
                if output.status.success() {
                    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
                } else {
                    Err(format!(
                        "{native_error}; tesseract failed: {}",
                        String::from_utf8_lossy(&output.stderr).trim()
                    ))
                }
            })
    });
    let _ = std::fs::remove_file(&input);
    result.and_then(|text| {
        if text.trim().is_empty() {
            Err("local OCR found no readable text".into())
        } else {
            Ok(text)
        }
    })
}

/// Invoke the embedded Windows Runtime OCR adapter through Windows PowerShell.
#[cfg(target_os = "windows")]
fn run_windows_ocr(input: &FilePath) -> Result<String, String> {
    let script = include_str!("windows_ocr.ps1");
    let script_path = input.with_extension("ocr.ps1");
    std::fs::write(&script_path, script)
        .map_err(|error| format!("cannot stage Windows OCR adapter: {error}"))?;
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-File"])
        .arg(&script_path)
        .arg(input)
        .output();
    let _ = std::fs::remove_file(&script_path);
    let output = output.map_err(|error| format!("Windows OCR is unavailable: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Windows OCR failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn parser_failure(message: &str) -> (String, String, String, String) {
    (
        "failed".into(),
        "none".into(),
        String::new(),
        message.into(),
    )
}

fn sanitize_file_name(value: &str) -> String {
    FilePath::new(value)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("attachment")
        .chars()
        .take(255)
        .collect()
}

fn bad_request(error: impl ToString) -> ApiError {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            error: error.to_string(),
        }),
    )
}
fn not_found(error: impl ToString) -> ApiError {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: error.to_string(),
        }),
    )
}
fn internal(error: impl ToString) -> ApiError {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: error.to_string(),
        }),
    )
}
