//! Library facade for `encorehub-engine`.
//!
//! `main.rs` and `mcp_server.rs` are thin binary entrypoints; this crate
//! exists primarily so integration tests under `tests/` can import the
//! axum `Router` builder without spawning a process.

pub mod api;
pub mod crypto;
