//! Conversation management crate for EncoreHub.
//!
//! Responsibilities:
//! - Token counting (rough estimation + usage tracking)
//! - Context window builder (given messages + token budget → optimal message sequence)
//! - Rolling summarisation (compress old messages when context overflows)
//!
//! Status: token counter and context builder are implemented; automatic
//! rolling summarisation is next.

pub mod context;
pub mod token;
