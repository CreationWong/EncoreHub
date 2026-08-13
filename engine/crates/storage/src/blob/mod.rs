//! Blob storage for binary files (uploaded documents, images, etc.).
//!
//! Uses the local filesystem with content-addressable paths (SHA-256 hash).
//! Files are stored under `{data_path}/blobs/{first_2_hex}/{rest}.bin`.

use encorehub_core::EngineError;
use std::path::{Path, PathBuf};
use uuid::Uuid;

type Result<T> = std::result::Result<T, EngineError>;

/// Blob store backed by the local filesystem.
pub struct BlobStore {
    base_path: PathBuf,
}

/// Files moved out of the live blob namespace pending a database commit.
pub struct StagedBlobDeletion {
    staging_path: PathBuf,
    entries: Vec<(PathBuf, PathBuf)>,
}

impl StagedBlobDeletion {
    /// Number of live blobs isolated by this atomic operation.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether no matching live blob existed.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Restore every staged file after a database rollback.
    pub fn rollback(self) -> Result<()> {
        let mut first_error = None;
        for (original, staged) in self.entries.into_iter().rev() {
            if let Some(parent) = original.parent() {
                if let Err(error) = std::fs::create_dir_all(parent) {
                    first_error.get_or_insert(error);
                    continue;
                }
            }
            if let Err(error) = std::fs::rename(staged, original) {
                first_error.get_or_insert(error);
            }
        }
        let _ = std::fs::remove_dir_all(self.staging_path);
        match first_error {
            Some(error) => Err(error.into()),
            None => Ok(()),
        }
    }

    /// Permanently reclaim staged files after the database commit succeeds.
    pub fn commit(self) -> Result<()> {
        if self.staging_path.exists() {
            std::fs::remove_dir_all(self.staging_path)?;
        }
        Ok(())
    }
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
        let hex = Self::content_hash(data);

        let path = self.blob_path(&hex);
        if path.exists() {
            return Ok(hex);
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
        if let Err(error) = std::fs::write(&temporary, data) {
            let _ = std::fs::remove_file(&temporary);
            return Err(error.into());
        }
        if let Err(error) = std::fs::rename(&temporary, &path) {
            let _ = std::fs::remove_file(&temporary);
            return Err(error.into());
        }
        Ok(hex)
    }

    /// Compute the lowercase content address without writing the payload.
    pub fn content_hash(data: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        let hash = Sha256::digest(data);
        let mut hex = String::with_capacity(hash.len() * 2);
        const HEX_DIGITS: &[u8; 16] = b"0123456789abcdef";
        for byte in hash {
            hex.push(HEX_DIGITS[(byte >> 4) as usize] as char);
            hex.push(HEX_DIGITS[(byte & 0x0f) as usize] as char);
        }
        hex
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

    /// Atomically hide several blobs so a caller can commit or roll back later.
    pub fn stage_delete<'a>(
        &self,
        hashes: impl IntoIterator<Item = &'a str>,
    ) -> Result<StagedBlobDeletion> {
        let staging_path = self
            .base_path
            .join(".trash")
            .join(Uuid::new_v4().to_string());
        let mut entries = Vec::new();
        for hash in hashes {
            let original = self.blob_path(hash);
            if !original.exists() {
                continue;
            }
            let staged = staging_path.join(format!("{hash}.bin"));
            if let Some(parent) = staged.parent() {
                std::fs::create_dir_all(parent)?;
            }
            if let Err(error) = std::fs::rename(&original, &staged) {
                let batch = StagedBlobDeletion {
                    staging_path,
                    entries,
                };
                let _ = batch.rollback();
                return Err(error.into());
            }
            entries.push((original, staged));
        }
        Ok(StagedBlobDeletion {
            staging_path,
            entries,
        })
    }

    /// Enumerate valid content hashes currently present on disk.
    pub fn list_hashes(&self) -> Result<Vec<String>> {
        let mut hashes = Vec::new();
        if !self.base_path.exists() {
            return Ok(hashes);
        }
        for prefix_entry in std::fs::read_dir(&self.base_path)? {
            let prefix_entry = prefix_entry?;
            if !prefix_entry.file_type()?.is_dir() {
                continue;
            }
            let prefix = prefix_entry.file_name().to_string_lossy().to_string();
            if prefix.len() != 2 || !prefix.bytes().all(|value| value.is_ascii_hexdigit()) {
                continue;
            }
            for blob_entry in std::fs::read_dir(prefix_entry.path())? {
                let blob_entry = blob_entry?;
                if !blob_entry.file_type()?.is_file() {
                    continue;
                }
                let name = blob_entry.file_name().to_string_lossy().to_string();
                let Some(rest) = name.strip_suffix(".bin") else {
                    continue;
                };
                let hash = format!("{prefix}{rest}").to_ascii_lowercase();
                if hash.len() == 64 && hash.bytes().all(|value| value.is_ascii_hexdigit()) {
                    hashes.push(hash);
                }
            }
        }
        hashes.sort();
        hashes.dedup();
        Ok(hashes)
    }
}

#[cfg(test)]
mod tests {
    use super::BlobStore;

    /// The standard-library encoder must preserve the persisted digest format.
    #[test]
    fn store_uses_lowercase_sha256_and_round_trips_content() {
        let directory = tempfile::tempdir().unwrap();
        let store = BlobStore::new(directory.path()).unwrap();

        let digest = store.store(b"abc").unwrap();

        assert_eq!(
            digest,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(store.get(&digest).unwrap(), Some(b"abc".to_vec()));
    }

    #[test]
    fn staged_deletion_can_commit_or_rollback_as_one_unit() {
        let directory = tempfile::tempdir().unwrap();
        let store = BlobStore::new(directory.path()).unwrap();
        let restored = store.store(b"restore").unwrap();
        let removed = store.store(b"remove").unwrap();

        let batch = store.stage_delete([restored.as_str()]).unwrap();
        assert!(store.get(&restored).unwrap().is_none());
        batch.rollback().unwrap();
        assert_eq!(store.get(&restored).unwrap(), Some(b"restore".to_vec()));

        let batch = store.stage_delete([removed.as_str()]).unwrap();
        batch.commit().unwrap();
        assert!(store.get(&removed).unwrap().is_none());
    }
}
