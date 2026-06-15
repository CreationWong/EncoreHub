//! Unified data types for the EncoreHub engine.
//!
//! These types are the canonical representation used throughout the Rust backend.
//! Proto-generated types are converted to/from these domain types at the gRPC boundary.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ===== Conversation =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub provider: String,
    pub model: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Conversation {
    pub fn new(title: impl Into<String>, provider: impl Into<String>, model: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            title: title.into(),
            provider: provider.into(),
            model: model.into(),
            created_at: now,
            updated_at: now,
        }
    }
}

// ===== Message =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: Role,
    pub content: String,
    pub parent_id: Option<String>,
    pub token_count: i32,
    pub created_at: DateTime<Utc>,
}

impl Message {
    pub fn new(
        conversation_id: impl Into<String>,
        role: Role,
        content: impl Into<String>,
        parent_id: Option<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            conversation_id: conversation_id.into(),
            role,
            content: content.into(),
            parent_id,
            token_count: 0,
            created_at: Utc::now(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    User,
    Assistant,
    System,
    Tool,
}

impl Role {
    pub fn as_str(&self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::System => "system",
            Role::Tool => "tool",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "user" => Some(Role::User),
            "assistant" => Some(Role::Assistant),
            "system" => Some(Role::System),
            "tool" => Some(Role::Tool),
            _ => None,
        }
    }
}

// ===== Tool Call =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub message_id: String,
    pub name: String,
    pub arguments: String, // JSON string
}

impl ToolCall {
    pub fn new(message_id: impl Into<String>, name: impl Into<String>, arguments: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            message_id: message_id.into(),
            name: name.into(),
            arguments: arguments.into(),
        }
    }
}

// ===== Conversation Summary =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSummary {
    pub id: String,
    pub conversation_id: String,
    pub summary_text: String,
    pub start_message_id: String,
    pub end_message_id: String,
    pub created_at: DateTime<Utc>,
}

// ===== Pinned Message =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinnedMessage {
    pub id: String,
    pub conversation_id: String,
    pub message_id: String,
    pub note: Option<String>,
    pub pinned_at: DateTime<Utc>,
}

// ===== Memory =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    pub id: String,
    pub scope: MemoryScope,
    pub memory_type: MemoryType,
    pub conversation_id: Option<String>,
    pub content: String,
    pub importance: f32,
    pub created_at: DateTime<Utc>,
    pub last_accessed_at: DateTime<Utc>,
}

impl Memory {
    pub fn new(
        scope: MemoryScope,
        memory_type: MemoryType,
        conversation_id: Option<String>,
        content: impl Into<String>,
        importance: f32,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            scope,
            memory_type,
            conversation_id,
            content: content.into(),
            importance: importance.clamp(0.0, 1.0),
            created_at: now,
            last_accessed_at: now,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScope {
    Conversation,
    Global,
}

impl MemoryScope {
    pub fn as_str(&self) -> &'static str {
        match self {
            MemoryScope::Conversation => "conversation",
            MemoryScope::Global => "global",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "conversation" => Some(MemoryScope::Conversation),
            "global" => Some(MemoryScope::Global),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryType {
    Working,
    Episodic,
    Semantic,
    Pinned,
}

impl MemoryType {
    pub fn as_str(&self) -> &'static str {
        match self {
            MemoryType::Working => "working",
            MemoryType::Episodic => "episodic",
            MemoryType::Semantic => "semantic",
            MemoryType::Pinned => "pinned",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "working" => Some(MemoryType::Working),
            "episodic" => Some(MemoryType::Episodic),
            "semantic" => Some(MemoryType::Semantic),
            "pinned" => Some(MemoryType::Pinned),
            _ => None,
        }
    }
}

// ===== Search =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub full_content: Option<String>,
    pub relevance_score: f32,
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchCacheEntry {
    pub id: String,
    pub query_hash: String,
    pub provider: String,
    pub results_json: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

// ===== Document (Knowledge Base) =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub file_type: String,
    pub chunk_count: i32,
    pub size_bytes: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentChunk {
    pub id: String,
    pub document_id: String,
    pub content: String,
    pub chunk_index: i32,
    pub token_count: i32,
}

// ===== Skill =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub enabled: bool,
    pub builtin: bool,
    pub triggers: Vec<String>,
    pub tools: Vec<SkillTool>,
    pub install_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillTool {
    pub name: String,
    pub description: String,
    pub parameters_schema: String, // JSON Schema
}

// ===== User Config =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigEntry {
    pub key: String,
    pub value_json: String,
    pub updated_at: DateTime<Utc>,
}

// ===== Context (for chat requests) =====

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChatContext {
    pub memories: Vec<MemoryRef>,
    pub knowledge_chunks: Vec<KnowledgeRef>,
    pub search_results: Vec<SearchResultRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRef {
    pub id: String,
    pub scope: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeRef {
    pub document_id: String,
    pub chunk_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultRef {
    pub title: String,
    pub url: String,
    pub snippet: String,
}
