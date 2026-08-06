//! SQLite-Vec persistence and deterministic local embedding for offline retrieval.
//!
//! Knowledge uses this module when the embedded LanceDB store is unavailable.
//! Per-turn conversation memory always uses it because those records are small
//! and intentionally coupled to the relational SQLite lifecycle.

use super::{Database, Result};
use encorehub_core::{DocumentChunk, Memory};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

/// Dimension shared by LanceDB and SQLite-Vec indexes.
pub const EMBEDDING_DIMENSIONS: usize = 384;

/// Vector backend reported to API clients for observability.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VectorBackend {
    /// Embedded persistent LanceDB knowledge collection.
    LanceDb,
    /// Embedded SQLite-Vec index owned by Rust.
    SqliteVec,
}

/// One nearest-neighbor row returned by SQLite-Vec.
#[derive(Debug, Clone, PartialEq)]
pub struct VectorSearchHit<T> {
    /// Relational record associated with the vector row.
    pub item: T,
    /// Cosine-derived relevance in the inclusive zero-to-one range.
    pub score: f64,
}

impl Database {
    /// Insert or replace one knowledge chunk in the offline SQLite-Vec index.
    pub fn index_knowledge_chunk(&self, chunk: &DocumentChunk) -> Result<()> {
        let embedding = embedding_json(&local_embedding(&chunk.content));
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let rowid = ensure_vector_row(&tx, "knowledge_vector_metadata", "chunk_id", &chunk.id)?;
        tx.execute("DELETE FROM knowledge_vectors WHERE rowid = ?1", [rowid])?;
        tx.execute(
            "INSERT INTO knowledge_vectors(rowid, embedding) VALUES (?1, ?2)",
            params![rowid, embedding],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Search the offline knowledge index using cosine distance.
    pub fn search_knowledge_vectors(
        &self,
        query: &str,
        limit: i64,
    ) -> Result<Vec<VectorSearchHit<DocumentChunk>>> {
        let conn = self.conn.lock().unwrap();
        let embedding = embedding_json(&local_embedding(query));
        let mut statement = conn.prepare(
            "SELECT c.id, c.document_id, c.content, c.chunk_index, c.token_count, v.distance
               FROM knowledge_vectors v
               JOIN knowledge_vector_metadata m ON m.rowid = v.rowid
               JOIN document_chunks c ON c.id = m.chunk_id
              WHERE v.embedding MATCH ?1 AND k = ?2
              ORDER BY v.distance",
        )?;
        let rows = statement.query_map(params![embedding, bounded_limit(limit)], |row| {
            let distance = row.get::<_, f64>(5)?;
            Ok(VectorSearchHit {
                item: DocumentChunk {
                    id: row.get(0)?,
                    document_id: row.get(1)?,
                    content: row.get(2)?,
                    chunk_index: row.get(3)?,
                    token_count: row.get(4)?,
                },
                score: distance_to_score(distance),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    /// Insert or replace one conversation-turn memory vector.
    pub fn index_memory(&self, memory: &Memory) -> Result<()> {
        let embedding = embedding_json(&local_embedding(&memory.content));
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let rowid = ensure_vector_row(&tx, "memory_vector_metadata", "memory_id", &memory.id)?;
        tx.execute("DELETE FROM memory_vectors WHERE rowid = ?1", [rowid])?;
        tx.execute(
            "INSERT INTO memory_vectors(rowid, embedding) VALUES (?1, ?2)",
            params![rowid, embedding],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Search per-turn memory vectors and optionally restrict conversation scope.
    pub fn search_memory_vectors(
        &self,
        query: &str,
        conversation_id: Option<&str>,
        limit: i64,
    ) -> Result<Vec<VectorSearchHit<Memory>>> {
        self.search_memory_vectors_for_groups(query, conversation_id, None, limit)
    }

    /// Search memory vectors while enforcing the role-visible group boundary.
    pub fn search_memory_vectors_for_groups(
        &self,
        query: &str,
        conversation_id: Option<&str>,
        group_ids: Option<&[String]>,
        limit: i64,
    ) -> Result<Vec<VectorSearchHit<Memory>>> {
        let candidates = self.search_memory_rowids(query, limit.saturating_mul(4))?;
        let mut hits = Vec::new();
        for (memory_id, score) in candidates {
            let memory = self.get_memory(&memory_id)?;
            let group_visible =
                group_ids.is_none_or(|groups| groups.iter().any(|group| group == &memory.group_id));
            if group_visible
                && conversation_id.is_none_or(|id| memory.conversation_id.as_deref() == Some(id))
            {
                hits.push(VectorSearchHit {
                    item: memory,
                    score,
                });
            }
            if hits.len() >= bounded_limit(limit) as usize {
                break;
            }
        }
        Ok(hits)
    }

    /// Verify that the compiled SQLite-Vec extension is available.
    pub fn sqlite_vec_version(&self) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT vec_version()", [], |row| row.get(0))
            .map_err(Into::into)
    }

    fn search_memory_rowids(&self, query: &str, limit: i64) -> Result<Vec<(String, f64)>> {
        let conn = self.conn.lock().unwrap();
        let embedding = embedding_json(&local_embedding(query));
        let mut statement = conn.prepare(
            "SELECT m.memory_id, v.distance
               FROM memory_vectors v
               JOIN memory_vector_metadata m ON m.rowid = v.rowid
              WHERE v.embedding MATCH ?1 AND k = ?2
              ORDER BY v.distance",
        )?;
        let rows = statement.query_map(params![embedding, bounded_limit(limit)], |row| {
            Ok((row.get(0)?, distance_to_score(row.get(1)?)))
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }
}

/// Produce a normalized feature-hashing embedding without external model files.
///
/// LanceDB and SQLite-Vec use this same FNV-1a token hashing contract so their
/// results stay query-compatible. This intentionally favors deterministic
/// offline behavior without model files.
pub fn local_embedding(text: &str) -> Vec<f32> {
    let mut vector = vec![0.0_f32; EMBEDDING_DIMENSIONS];
    for token in text.split(|character: char| !character.is_alphanumeric()) {
        let token = token.trim().to_lowercase();
        if token.is_empty() {
            continue;
        }
        let hash = token.bytes().fold(2_166_136_261_u32, |value, byte| {
            (value ^ u32::from(byte)).wrapping_mul(16_777_619)
        });
        let index = hash as usize % EMBEDDING_DIMENSIONS;
        vector[index] += if hash & 0x8000_0000 == 0 { 1.0 } else { -1.0 };
    }
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        vector.iter_mut().for_each(|value| *value /= norm);
    }
    vector
}

fn ensure_vector_row(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    id_column: &str,
    id: &str,
) -> Result<i64> {
    let select = format!("SELECT rowid FROM {table} WHERE {id_column} = ?1");
    if let Some(rowid) = tx.query_row(&select, [id], |row| row.get(0)).optional()? {
        return Ok(rowid);
    }
    let insert = format!("INSERT INTO {table}({id_column}) VALUES (?1)");
    tx.execute(&insert, [id])?;
    Ok(tx.last_insert_rowid())
}

fn embedding_json(vector: &[f32]) -> String {
    serde_json::to_string(vector).expect("finite local embedding serializes")
}

fn bounded_limit(limit: i64) -> i64 {
    limit.clamp(1, 100)
}

fn distance_to_score(distance: f64) -> f64 {
    (1.0 - distance).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedding_is_normalized_and_deterministic() {
        let first = local_embedding("Local vector memory");
        let second = local_embedding("Local vector memory");
        let norm = first.iter().map(|value| value * value).sum::<f32>().sqrt();
        assert_eq!(first, second);
        assert!((norm - 1.0).abs() < 0.000_01);
    }
}
