//! A `tracing` layer that forwards Desktop events into the shared [`LogBuffer`].
//! Engine Runtime events arrive through the versioned dynamic-library callback
//! and use the same buffer, redaction, and file-retention path.

use std::fmt::Write as _;
use std::sync::Arc;

use tracing::field::{Field, Visit};
use tracing::Subscriber;
use tracing_subscriber::layer::Context;
use tracing_subscriber::Layer;

use crate::logs::{Level, LogBuffer, Source};

/// Layer that mirrors every captured event into the developer-panel log buffer.
pub struct LogBufferLayer {
    logs: Arc<LogBuffer>,
}

impl LogBufferLayer {
    pub fn new(logs: Arc<LogBuffer>) -> Self {
        Self { logs }
    }
}

impl<S: Subscriber> Layer<S> for LogBufferLayer {
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        let mut visitor = MessageVisitor(String::new());
        event.record(&mut visitor);

        let meta = event.metadata();
        let level = match *meta.level() {
            tracing::Level::ERROR => Level::Error,
            tracing::Level::WARN => Level::Warn,
            tracing::Level::INFO => Level::Info,
            // The buffer has no Trace variant; fold trace into debug.
            tracing::Level::DEBUG | tracing::Level::TRACE => Level::Debug,
        };

        // Prefix the target (module path) so panel lines read like the old
        // sidecar output, e.g. "encorehub_engine::api: Listening on ...".
        let line = format!("{}:{}", meta.target(), visitor.0);
        self.logs
            .push_event(source_from_target(meta.target()), level, &line);
    }
}

fn source_from_target(target: &str) -> Source {
    if target.starts_with("encorehub_engine")
        || target.starts_with("encorehub_storage")
        || target.starts_with("encorehub_skill")
        || target.starts_with("tower_http")
        || target.starts_with("axum")
        || target.starts_with("hyper")
    {
        Source::Engine
    } else {
        Source::Desktop
    }
}

/// Collects an event's fields into a single string: the special `message`
/// field first, then any remaining fields as ` key=value`.
struct MessageVisitor(String);

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            let _ = write!(self.0, " {value:?}");
        } else {
            let _ = write!(self.0, " {}={:?}", field.name(), value);
        }
    }
}
