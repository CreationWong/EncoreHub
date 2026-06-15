pub mod blob;
pub mod lancedb;
pub mod sqlite;

pub use sqlite::Database;

/// Convenience result type for storage operations.
pub type Result<T> = std::result::Result<T, encorehub_core::EngineError>;
