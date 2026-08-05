//! Blob storage for binary files (uploaded documents, images, etc.).
//!
//! Uses the local filesystem with content-addressable paths (SHA-256 hash).
//! Files are stored under `{data_path}/blobs/{first_2_hex}/{rest}.bin`.

use encorehub_core::EngineError;
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, EngineError>;

/// Blob store backed by the local filesystem.
pub struct BlobStore {
    base_path: PathBuf,
}

impl BlobStore {
    /// Create a new blob store at the given base path.
    pub fn new(base_path: impl AsRef<Path>) -> Result<Self> {
        let base_path = base_path.as_ref().to_path_buf();
        std::fs::create_dir_all(&base_path)?;
        Ok(Self { base_path })
    }

    /// Derive a content-addressable path from a SHA-256 hex string.
    fn blob_path(&self, sha256_hex: &str) -> PathBuf {
        let (prefix, rest) = sha256_hex.split_at(2);
        self.base_path.join(prefix).join(format!("{rest}.bin"))
    }

    /// Return the stable path used to open a previously stored blob.
    pub fn path_for(&self, sha256_hex: &str) -> PathBuf {
        self.blob_path(sha256_hex)
    }

    /// Return the platform-independent relative location persisted in SQLite.
    pub fn relative_path(sha256_hex: &str) -> String {
        let (prefix, rest) = sha256_hex.split_at(2);
        format!("{prefix}/{rest}.bin")
    }

    /// Store data and return its SHA-256 identifier.
    pub fn store(&self, data: &[u8]) -> Result<String> {
        use sha2::{Digest, Sha256};
        let hash = Sha256::digest(data);
        let hex = hex::encode(hash);

        let path = self.blob_path(&hex);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        std::fs::write(&path, data)?;
        Ok(hex)
    }

    /// Retrieve data by SHA-256 hash.
    pub fn get(&self, sha256_hex: &str) -> Result<Option<Vec<u8>>> {
        let path = self.blob_path(sha256_hex);
        if path.exists() {
            Ok(Some(std::fs::read(&path)?))
        } else {
            Ok(None)
        }
    }

    /// Delete data by SHA-256 hash.
    pub fn delete(&self, sha256_hex: &str) -> Result<bool> {
        let path = self.blob_path(sha256_hex);
        if path.exists() {
            std::fs::remove_file(&path)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
}
