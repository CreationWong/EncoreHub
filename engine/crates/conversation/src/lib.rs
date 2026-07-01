//! Conversation management crate for EncoreHub.
//!
//! Responsibilities:
//! - Token counting (rough estimation + usage tracking)
//! - Context window builder (given messages + token budget → optimal message sequence)
//! - Rolling summarisation (compress old messages when context overflows)
//!
//! Status: token counter is implemented; context builder and compressor are next.

pub mod token;
