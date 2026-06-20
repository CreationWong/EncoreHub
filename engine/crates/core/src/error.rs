//! Unified error types for the EncoreHub engine.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum EngineError {
    // === Database errors ===
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("database migration error: {0}")]
    Migration(String),

    #[error("not found: {resource} (id={id})")]
    NotFound { resource: String, id: String },

    #[error("already exists: {resource} (id={id})")]
    AlreadyExists { resource: String, id: String },

    // === Vector store errors ===
    #[error("vector store error: {0}")]
    VectorStore(String),

    #[error("embedding dimension mismatch: expected {expected}, got {actual}")]
    DimensionMismatch { expected: usize, actual: usize },

    // === Validation errors ===
    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    #[error("validation error: {message}")]
    Validation {
        message: String,
        field: Option<String>,
    },

    // === Conversation errors ===
    #[error("conversation not found: {0}")]
    ConversationNotFound(String),

    #[error("message not found: {0}")]
    MessageNotFound(String),

    #[error("context window exceeded: {current_tokens} tokens (limit: {limit_tokens})")]
    ContextWindowExceeded {
        current_tokens: usize,
        limit_tokens: usize,
    },

    // === Memory errors ===
    #[error("memory consolidation failed: {0}")]
    ConsolidationFailed(String),

    // === Search errors ===
    #[error("search provider error: {provider} - {message}")]
    SearchProvider { provider: String, message: String },

    #[error("search rate limited: {provider}")]
    SearchRateLimited { provider: String },

    // === IO errors ===
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    // === Serialization errors ===
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    // === Config errors ===
    #[error("config error: {0}")]
    Config(String),

    // === Internal errors ===
    #[error("internal error: {0}")]
    Internal(String),
}

/// Convenience Result type for the engine.
pub type EngineResult<T> = Result<T, EngineError>;
