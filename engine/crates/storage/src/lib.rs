pub mod blob;
pub mod lancedb;
pub mod sqlite;

pub use blob::{BlobStore, StagedBlobDeletion};
pub use lancedb::{ChunkEmbeddingResult, LanceDbConfig, LanceDbStore};
pub use sqlite::{
    decode_hex, encode_hex, AttachmentRecord, CacheCleanup, ConversationCleanup, DataConversation,
    DataDomain, DataOverview, Database, ImportSummary, UserDataBackup, VectorBackend,
    VectorSearchHit,
};

/// Convenience result type for storage operations.
pub type Result<T> = std::result::Result<T, encorehub_core::EngineError>;
