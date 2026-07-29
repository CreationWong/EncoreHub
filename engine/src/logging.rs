//! Runtime-adjustable log level for the engine.
//!
//! `tracing_subscriber`'s `EnvFilter` is fixed once the subscriber is built, so
//! to change the level at runtime we install a `reload` layer and keep a handle
//! to it. The handle's concrete type is unwieldy to name, so we erase it behind
//! a closure stored in [`LogControl`]. The `/api/config/log_level` handler calls
//! [`LogControl::set`] to apply a new level immediately.

use std::sync::Arc;

/// The setter closure behind [`LogControl`]: applies a level string, returning
/// an error message on invalid input or reload failure.
type SetFn = Arc<dyn Fn(&str) -> Result<(), String> + Send + Sync>;

/// Type-erased control over the running subscriber's level filter.
#[derive(Clone)]
pub struct LogControl {
    set: SetFn,
}

impl LogControl {
    pub fn new<F>(set: F) -> Self
    where
        F: Fn(&str) -> Result<(), String> + Send + Sync + 'static,
    {
        Self { set: Arc::new(set) }
    }

    /// Apply a new level (e.g. "info", "debug"). Invalid input is rejected.
    pub fn set(&self, level: &str) -> Result<(), String> {
        (self.set)(level)
    }
}

/// Normalize a user-supplied level string to a valid tracing directive, or None
/// if it isn't one of the accepted levels. Accepts case-insensitively.
pub fn normalize_level(level: &str) -> Option<&'static str> {
    match level.trim().to_ascii_lowercase().as_str() {
        "error" => Some("error"),
        "warn" | "warning" => Some("warn"),
        "info" => Some("info"),
        "debug" => Some("debug"),
        "trace" => Some("trace"),
        _ => None,
    }
}
