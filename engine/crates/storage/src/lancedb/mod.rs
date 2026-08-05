//! Embedded LanceDB storage for persistent Knowledge vectors.
//!
//! SQLite remains authoritative for document metadata and chunk text. This
//! module owns a rebuildable local vector projection whose failures are
//! intentionally surfaced to the API layer so it can use SQLite-Vec.

use crate::sqlite::{local_embedding, EMBEDDING_DIMENSIONS};
use arrow_array::types::Float32Type;
use arrow_array::{FixedSizeListArray, Float32Array, Int32Array, RecordBatch, StringArray};
use arrow_schema::{DataType, Field, Schema};
use encorehub_core::{DocumentChunk, EngineError};
use futures::TryStreamExt;
use lancedb::connection::Connection;
use lancedb::query::{ExecutableQuery, QueryBase};
use lancedb::{connect, DistanceType, Table};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Stable table name for the rebuildable Knowledge vector projection.
const KNOWLEDGE_TABLE: &str = "knowledge_chunks";

/// Storage-local result that keeps LanceDB errors behind the Engine contract.
type Result<T> = std::result::Result<T, EngineError>;

/// Configuration for one embedded LanceDB directory.
#[derive(Debug, Clone)]
pub struct LanceDbConfig {
    /// Directory containing LanceDB data files.
    pub data_path: PathBuf,
}

impl LanceDbConfig {
    /// Derive mutable storage from the Engine data directory unless overridden.
    pub fn for_data_directory(data_directory: impl AsRef<Path>) -> Self {
        let data_path = std::env::var_os("ENCOREHUB_LANCEDB_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| data_directory.as_ref().join("lancedb"));
        Self { data_path }
    }
}

/// Serialized operation gate around an embedded LanceDB connection path.
///
/// LanceDB connections are opened lazily. This keeps Engine startup available
/// when the vector directory temporarily fails and gives each Knowledge call a
/// deterministic error that can activate SQLite-Vec fallback.
pub struct LanceDbStore {
    data_path: PathBuf,
    operation: Mutex<()>,
}

impl LanceDbStore {
    /// Prepare a local LanceDB directory without opening any table eagerly.
    pub fn open(config: LanceDbConfig) -> Result<Self> {
        std::fs::create_dir_all(&config.data_path)?;
        tracing::info!(path = %config.data_path.display(), "LanceDB knowledge store configured");
        Ok(Self {
            data_path: config.data_path,
            operation: Mutex::new(()),
        })
    }

    /// Replace every Knowledge vector belonging to a relational document.
    ///
    /// Deleting before adding prevents stale vectors when a document is
    /// re-ingested with fewer chunks. The operation gate makes that replacement
    /// atomic from the perspective of this Engine process.
    pub async fn upsert_document(&self, document_id: &str, chunks: &[DocumentChunk]) -> Result<()> {
        let _guard = self.operation.lock().await;
        let connection = self.connect().await?;
        let table = self.knowledge_table(&connection).await?;
        table
            .delete(&document_filter(document_id))
            .await
            .map_err(vector_error)?;
        if chunks.is_empty() {
            return Ok(());
        }

        let batch = chunks_to_batch(chunks)?;
        table.add(batch).execute().await.map_err(vector_error)?;
        Ok(())
    }

    /// Search Knowledge vectors by cosine distance using the shared embedding.
    pub async fn search(&self, query: &str, top_k: i64) -> Result<Vec<ChunkEmbeddingResult>> {
        let _guard = self.operation.lock().await;
        let connection = self.connect().await?;
        let table = self.knowledge_table(&connection).await?;
        if table.count_rows(None).await.map_err(vector_error)? == 0 {
            return Ok(Vec::new());
        }

        let embedding = local_embedding(query);
        let batches = table
            .query()
            .nearest_to(embedding.as_slice())
            .map_err(vector_error)?
            .distance_type(DistanceType::Cosine)
            .limit(top_k.clamp(1, 100) as usize)
            .execute()
            .await
            .map_err(vector_error)?
            .try_collect::<Vec<_>>()
            .await
            .map_err(vector_error)?;

        batches.iter().try_fold(Vec::new(), |mut hits, batch| {
            hits.extend(batch_to_results(batch)?);
            Ok(hits)
        })
    }

    /// Remove every vector for one document while retaining the table schema.
    pub async fn delete_document(&self, document_id: &str) -> Result<()> {
        let _guard = self.operation.lock().await;
        let connection = self.connect().await?;
        let table = self.knowledge_table(&connection).await?;
        table
            .delete(&document_filter(document_id))
            .await
            .map_err(vector_error)?;
        Ok(())
    }

    /// Open a local connection for the duration of one serialized operation.
    async fn connect(&self) -> Result<Connection> {
        let uri = self.data_path.to_string_lossy();
        connect(uri.as_ref()).execute().await.map_err(vector_error)
    }

    /// Open the stable table or create its empty Arrow schema on first use.
    async fn knowledge_table(&self, connection: &Connection) -> Result<Table> {
        let names = connection
            .table_names()
            .execute()
            .await
            .map_err(vector_error)?;
        if names.iter().any(|name| name == KNOWLEDGE_TABLE) {
            return connection
                .open_table(KNOWLEDGE_TABLE)
                .execute()
                .await
                .map_err(vector_error);
        }
        connection
            .create_empty_table(KNOWLEDGE_TABLE, knowledge_schema())
            .execute()
            .await
            .map_err(vector_error)
    }
}

/// One domain-shaped result returned from LanceDB vector search.
#[derive(Debug, Clone, PartialEq)]
pub struct ChunkEmbeddingResult {
    /// Stable relational chunk identifier.
    pub chunk_id: String,
    /// Stable relational document identifier.
    pub document_id: String,
    /// Source text retained for retrieval context.
    pub content: String,
    /// Zero-based position within the source document.
    pub chunk_index: i32,
    /// Cosine-derived relevance in the inclusive zero-to-one range.
    pub score: f64,
}

/// Define the persistent Arrow contract shared by writes and query decoding.
fn knowledge_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("document_id", DataType::Utf8, false),
        Field::new("content", DataType::Utf8, false),
        Field::new("chunk_index", DataType::Int32, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                // Arrow's standard fixed-list builder exposes a nullable child
                // field even when EncoreHub writes only finite values.
                Arc::new(Field::new("item", DataType::Float32, true)),
                EMBEDDING_DIMENSIONS as i32,
            ),
            false,
        ),
    ]))
}

/// Convert relational chunks into a single LanceDB-compatible record batch.
fn chunks_to_batch(chunks: &[DocumentChunk]) -> Result<RecordBatch> {
    let vectors = FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
        chunks.iter().map(|chunk| {
            Some(
                local_embedding(&chunk.content)
                    .into_iter()
                    .map(Some)
                    .collect::<Vec<_>>(),
            )
        }),
        EMBEDDING_DIMENSIONS as i32,
    );
    RecordBatch::try_new(
        knowledge_schema(),
        vec![
            Arc::new(StringArray::from_iter_values(
                chunks.iter().map(|chunk| chunk.id.as_str()),
            )),
            Arc::new(StringArray::from_iter_values(
                chunks.iter().map(|chunk| chunk.document_id.as_str()),
            )),
            Arc::new(StringArray::from_iter_values(
                chunks.iter().map(|chunk| chunk.content.as_str()),
            )),
            Arc::new(Int32Array::from_iter_values(
                chunks.iter().map(|chunk| chunk.chunk_index),
            )),
            Arc::new(vectors),
        ],
    )
    .map_err(vector_error)
}

/// Decode one LanceDB query batch and validate its projected column types.
fn batch_to_results(batch: &RecordBatch) -> Result<Vec<ChunkEmbeddingResult>> {
    let ids = string_column(batch, "id")?;
    let document_ids = string_column(batch, "document_id")?;
    let contents = string_column(batch, "content")?;
    let chunk_indexes = batch
        .column_by_name("chunk_index")
        .and_then(|column| column.as_any().downcast_ref::<Int32Array>())
        .ok_or_else(|| invalid_batch("chunk_index", "Int32"))?;
    let distances = batch
        .column_by_name("_distance")
        .and_then(|column| column.as_any().downcast_ref::<Float32Array>())
        .ok_or_else(|| invalid_batch("_distance", "Float32"))?;

    Ok((0..batch.num_rows())
        .map(|row| ChunkEmbeddingResult {
            chunk_id: ids.value(row).to_owned(),
            document_id: document_ids.value(row).to_owned(),
            content: contents.value(row).to_owned(),
            chunk_index: chunk_indexes.value(row),
            score: (1.0 - f64::from(distances.value(row))).clamp(0.0, 1.0),
        })
        .collect())
}

/// Downcast a required UTF-8 column with a bounded storage diagnostic.
fn string_column<'a>(batch: &'a RecordBatch, name: &str) -> Result<&'a StringArray> {
    batch
        .column_by_name(name)
        .and_then(|column| column.as_any().downcast_ref::<StringArray>())
        .ok_or_else(|| invalid_batch(name, "Utf8"))
}

/// Quote a document identifier for Lance SQL predicates.
fn document_filter(document_id: &str) -> String {
    format!("document_id = '{}'", document_id.replace('\'', "''"))
}

/// Normalize third-party storage errors behind the Engine error boundary.
fn vector_error(error: impl std::fmt::Display) -> EngineError {
    EngineError::VectorStore(error.to_string())
}

/// Create a precise schema mismatch error without exposing full stored data.
fn invalid_batch(column: &str, expected: &str) -> EngineError {
    EngineError::VectorStore(format!(
        "LanceDB query column {column} is missing or is not {expected}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal relational chunk for persistent round-trip coverage.
    fn chunk(id: &str, document_id: &str, content: &str, index: i32) -> DocumentChunk {
        DocumentChunk {
            id: id.to_owned(),
            document_id: document_id.to_owned(),
            content: content.to_owned(),
            chunk_index: index,
            token_count: content.len() as i32 / 4,
        }
    }

    #[tokio::test]
    async fn knowledge_vectors_round_trip_and_delete_by_document() {
        let directory = tempfile::tempdir().unwrap();
        let store = LanceDbStore::open(LanceDbConfig {
            data_path: directory.path().join("knowledge.lancedb"),
        })
        .unwrap();
        let chunks = vec![
            chunk("chunk-rust", "doc-rust", "rust ownership borrowing", 0),
            chunk("chunk-cooking", "doc-rust", "cooking pasta sauce", 1),
        ];

        store.upsert_document("doc-rust", &chunks).await.unwrap();
        let hits = store.search("rust ownership", 2).await.unwrap();

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].chunk_id, "chunk-rust");
        assert!(hits[0].score >= hits[1].score);

        store.delete_document("doc-rust").await.unwrap();
        assert!(store.search("rust", 5).await.unwrap().is_empty());
    }

    #[test]
    fn document_filters_escape_sql_string_literals() {
        assert_eq!(
            document_filter("document' OR true"),
            "document_id = 'document'' OR true'"
        );
    }
}
