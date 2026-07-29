//! Unified data types for the EncoreHub engine.
//!
//! These types are the canonical representation used throughout the Rust backend.
//! Proto-generated types are converted to/from these domain types at the gRPC boundary.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ===== Character Profile =====

pub const DEFAULT_CHARACTER_ID: &str = "default";
pub const DEFAULT_CHARACTER_NAME: &str = "Default character";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CharacterSnapshot {
    pub name: String,
    pub avatar: String,
    pub description: String,
    pub system_prompt: String,
    pub opening_message: String,
    pub tags: Vec<String>,
}

impl CharacterSnapshot {
    pub fn default_character() -> Self {
        Self {
            name: DEFAULT_CHARACTER_NAME.into(),
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterProfile {
    pub id: String,
    pub name: String,
    pub avatar: String,
    pub description: String,
    pub system_prompt: String,
    pub default_provider: String,
    pub default_model: String,
    pub opening_message: String,
    pub tags: Vec<String>,
    pub version: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

impl CharacterProfile {
    pub fn new(name: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            avatar: String::new(),
            description: String::new(),
            system_prompt: String::new(),
            default_provider: String::new(),
            default_model: String::new(),
            opening_message: String::new(),
            tags: Vec::new(),
            version: 1,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        }
    }

    pub fn snapshot(&self) -> CharacterSnapshot {
        CharacterSnapshot {
            name: self.name.clone(),
            avatar: self.avatar.clone(),
            description: self.description.clone(),
            system_prompt: self.system_prompt.clone(),
            opening_message: self.opening_message.clone(),
            tags: self.tags.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterUpgradePreview {
    pub conversation_id: String,
    pub character_id: String,
    pub from_version: i64,
    pub to_version: i64,
    pub changed: bool,
    pub changed_fields: Vec<String>,
    pub current_snapshot: CharacterSnapshot,
    pub proposed_snapshot: CharacterSnapshot,
    pub current_provider: String,
    pub proposed_provider: String,
    pub current_model: String,
    pub proposed_model: String,
}

// ===== Conversation =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub provider: String,
    pub model: String,
    pub character_id: String,
    pub character_version: i64,
    pub character_snapshot: CharacterSnapshot,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Conversation {
    pub fn new(
        title: impl Into<String>,
        provider: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            title: title.into(),
            provider: provider.into(),
            model: model.into(),
            character_id: DEFAULT_CHARACTER_ID.into(),
            character_version: 1,
            character_snapshot: CharacterSnapshot::default_character(),
            created_at: now,
            updated_at: now,
        }
    }

    pub fn with_character(
        mut self,
        character_id: impl Into<String>,
        character_version: i64,
        character_snapshot: CharacterSnapshot,
    ) -> Self {
        self.character_id = character_id.into();
        self.character_version = character_version;
        self.character_snapshot = character_snapshot;
        self
    }
}

// ===== Message =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: Role,
    pub content: String,
    /// Model chain-of-thought (DeepSeek `reasoning_content` / Anthropic
    /// `thinking`), kept separate from the visible answer. Empty when none.
    #[serde(default)]
    pub reasoning: String,
    pub parent_id: Option<String>,
    pub token_count: i32,
    /// Provider-reported prompt/input usage. None when the provider did not
    /// report usage or for records created before telemetry persistence.
    pub input_tokens: Option<i32>,
    /// Provider-reported completion/output usage.
    pub output_tokens: Option<i32>,
    /// Time spent consuming provider generation responses, excluding tool work.
    pub duration_ms: Option<i64>,
    /// Raw provider finish reason (for example `stop`, `length`, `tool_use`).
    pub finish_reason: Option<String>,
    #[serde(default)]
    pub status: MessageStatus,
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
            reasoning: String::new(),
            parent_id,
            token_count: 0,
            input_tokens: None,
            output_tokens: None,
            duration_ms: None,
            finish_reason: None,
            status: MessageStatus::Completed,
            created_at: Utc::now(),
        }
    }

    /// Attach reasoning (chain-of-thought) to a message, builder-style.
    pub fn with_reasoning(mut self, reasoning: impl Into<String>) -> Self {
        self.reasoning = reasoning.into();
        self
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageStatus {
    Pending,
    #[default]
    Completed,
    Failed,
    Stopped,
}

impl MessageStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Stopped => "stopped",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "stopped" => Some(Self::Stopped),
            _ => None,
        }
    }

    pub fn is_terminal(self) -> bool {
        !matches!(self, Self::Pending)
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

    #[allow(clippy::should_implement_trait)]
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
    /// Tool output once executed. Empty while pending.
    #[serde(default)]
    pub result: String,
    /// Execution state: "pending" | "success" | "error".
    #[serde(default = "default_tool_status")]
    pub status: String,
}

fn default_tool_status() -> String {
    "pending".into()
}

impl ToolCall {
    pub fn new(
        message_id: impl Into<String>,
        name: impl Into<String>,
        arguments: impl Into<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            message_id: message_id.into(),
            name: name.into(),
            arguments: arguments.into(),
            result: String::new(),
            status: default_tool_status(),
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

    #[allow(clippy::should_implement_trait)]
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

    #[allow(clippy::should_implement_trait)]
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

// ===== Secrets / encryption =====

/// A stored provider API key. Exactly one of `plaintext` (encryption off) or
/// the `ciphertext`/`nonce` pair (encryption on) is populated. The struct is
/// the opaque storage shape; the engine binary owns the crypto that interprets
/// it. Never log this — it carries key material.
#[derive(Debug, Clone)]
pub struct SecretRow {
    pub provider_id: String,
    pub plaintext: Option<String>,
    pub ciphertext: Option<Vec<u8>>,
    pub nonce: Option<Vec<u8>>,
    pub updated_at: DateTime<Utc>,
}

/// Single-row crypto metadata: the Argon2id salt and an encrypted verifier
/// blob used to check a candidate master password. Holds no key/password.
#[derive(Debug, Clone)]
pub struct CryptoMeta {
    pub enabled: bool,
    pub salt: Vec<u8>,
    pub verifier_ciphertext: Vec<u8>,
    pub verifier_nonce: Vec<u8>,
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
