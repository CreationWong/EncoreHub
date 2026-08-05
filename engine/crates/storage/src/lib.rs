pub mod blob;
pub mod lancedb;
pub mod sqlite;

pub use blob::BlobStore;
pub use lancedb::{ChunkEmbeddingResult, LanceDbConfig, LanceDbStore};
pub use sqlite::{AttachmentRecord, Database, VectorBackend, VectorSearchHit};

/// Convenience result type for storage operations.
pub type Result<T> = std::result::Result<T, encorehub_core::EngineError>;
