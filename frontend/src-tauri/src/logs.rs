//! In-memory ring buffer for sidecar (engine/gateway) logs, feeding the in-app
//! developer panel. Lines are tagged with their source and a best-effort level,
//! and secrets are redacted before a line enters the buffer. The sole exception
//! is an explicitly marked communication event while developer diagnostics are
//! enabled; that mode is user-confirmed and still receives redacted auth headers.
//!
//! Lines at or above the configured file level (Info by default) are mirrored
//! to a daily file under the active runtime `log/` directory so issues can be
//! diagnosed after the app closes. Full communication entries are always kept
//! in memory only and reach disk solely through an explicit user export.

use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Max lines kept in memory. Older lines are dropped as new ones arrive.
const MAX_LINES: usize = 2000;
const MAX_EXPORT_BYTES: usize = 8 * 1024 * 1024;

/// How many days of log files to keep; older files are pruned at startup.
const LOG_RETENTION_DAYS: i64 = 7;

/// Where a log line came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Engine,
    Gateway,
    Desktop,
    Frontend,
}

impl Source {
    pub fn from_service(name: &str) -> Source {
        match name {
            "encorehub-engine" => Source::Engine,
            "gateway" => Source::Gateway,
            _ => Source::Desktop,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Source::Engine => "engine",
            Source::Gateway => "gateway",
            Source::Desktop => "desktop",
            Source::Frontend => "frontend",
        }
    }
}

/// Severity, parsed best-effort from the line text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warn,
    Info,
    Debug,
}

impl Level {
    pub fn parse(level: &str) -> Option<Level> {
        match level.trim().to_ascii_lowercase().as_str() {
            "error" => Some(Level::Error),
            "warn" | "warning" => Some(Level::Warn),
            "info" => Some(Level::Info),
            "debug" => Some(Level::Debug),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Level::Error => "error",
            Level::Warn => "warn",
            Level::Info => "info",
            Level::Debug => "debug",
        }
    }

    fn severity(self) -> u8 {
        match self {
            Level::Error => 0,
            Level::Warn => 1,
            Level::Info => 2,
            Level::Debug => 3,
        }
    }

    fn should_write_to_file(self, file_level: Level) -> bool {
        self.severity() <= file_level.severity()
    }
}

/// One captured log line.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LogEntry {
    /// Monotonic sequence number — the frontend pulls everything after the last
    /// seq it has seen, so polling never misses or duplicates a line.
    pub seq: u64,
    pub source: Source,
    pub level: Level,
    pub message: String,
}

/// Thread-safe ring buffer of log entries.
pub struct LogBuffer {
    inner: Mutex<Inner>,
    /// File mirror threshold. Memory keeps every captured line; disk keeps
    /// entries at or above this level. Defaults to Info.
    file_level: Mutex<Level>,
    /// Preserve explicitly marked communication bodies only after the user has
    /// enabled the dedicated full-communication logging control.
    preserve_diagnostics: AtomicBool,
    /// Optional file mirror. `None` when no log dir was configured (e.g. tests).
    file: Option<Mutex<FileSink>>,
}

struct Inner {
    entries: VecDeque<LogEntry>,
    next_seq: u64,
}

/// Appends redacted log lines to a per-day file under `dir`. Rotates by date:
/// when the day changes, it opens a new `encorehub-YYYY-MM-DD.log`.
struct FileSink {
    dir: PathBuf,
    current_day: String,
    file: Option<File>,
}

impl FileSink {
    fn new(dir: PathBuf) -> FileSink {
        FileSink {
            dir,
            current_day: String::new(),
            file: None,
        }
    }

    /// Write one already-redacted line, prefixed with a local timestamp and the
    /// source/level. Best-effort: any IO error is dropped (logging must never
    /// crash the app).
    fn write_line(&mut self, source: Source, level: Level, message: &str) {
        let now = chrono::Local::now();
        let day = now.format("%Y-%m-%d").to_string();
        if self.file.is_none() || day != self.current_day {
            let path = self.dir.join(format!("encorehub-{day}.log"));
            match OpenOptions::new().create(true).append(true).open(&path) {
                Ok(f) => {
                    self.file = Some(f);
                    self.current_day = day;
                }
                Err(_) => {
                    self.file = None;
                    return;
                }
            }
        }
        if let Some(f) = self.file.as_mut() {
            let ts = now.format("%H:%M:%S%.3f");
            let clean = strip_ansi(message);
            let _ = writeln!(f, "{ts} [{:?}/{:?}] {clean}", source, level);
        }
    }
}

/// Strip ANSI SGR escape sequences (color codes) so the on-disk log is plain
/// text. Sidecars emit colorized output; the file should be editor-friendly.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // ESC — skip an optional '[' then everything up to the final byte
            // of a CSI sequence (a letter in @-~).
            if chars.peek() == Some(&'[') {
                chars.next();
            }
            for cc in chars.by_ref() {
                if cc.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Remove `encorehub-*.log` files older than the retention window. Best-effort.
fn prune_old_logs(dir: &PathBuf) {
    let cutoff = chrono::Local::now().date_naive() - chrono::Duration::days(LOG_RETENTION_DAYS);
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        // Parse the date out of `encorehub-YYYY-MM-DD.log`.
        let Some(rest) = name.strip_prefix("encorehub-") else {
            continue;
        };
        let Some(date_str) = rest.strip_suffix(".log") else {
            continue;
        };
        if let Ok(date) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
            if date < cutoff {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

/// Export the visible (already redacted) developer-panel entries through the
/// native filesystem. The messages are redacted again at this trust boundary
/// so a forged webview invocation cannot write obvious key material.
pub fn export_log_entries(
    path: &Path,
    entries: &[LogEntry],
    preserve_diagnostics: bool,
) -> io::Result<()> {
    if entries.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "there are no log entries to export",
        ));
    }
    if entries.len() > MAX_LINES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "log export exceeds the in-memory limit",
        ));
    }
    let export_bytes = entries.iter().fold(0_usize, |total, entry| {
        total.saturating_add(entry.message.len())
    });
    if export_bytes > MAX_EXPORT_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "log export exceeds the byte limit",
        ));
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)?;
    for entry in entries {
        let stripped = strip_ansi(&entry.message);
        let message = if preserve_diagnostics && is_communication_event(&stripped) {
            stripped
        } else {
            redact(&stripped)
        };
        writeln!(
            file,
            "[{}/{}] {}",
            entry.source.as_str(),
            entry.level.as_str(),
            message
        )?;
    }
    file.sync_all()
}

impl LogBuffer {
    pub fn new() -> LogBuffer {
        LogBuffer {
            inner: Mutex::new(Inner {
                entries: VecDeque::with_capacity(MAX_LINES),
                next_seq: 1,
            }),
            file_level: Mutex::new(Level::Info),
            preserve_diagnostics: AtomicBool::new(false),
            file: None,
        }
    }

    /// Like `new`, but also mirrors lines to a daily file under `log_dir`.
    /// Creates the directory if needed and prunes logs older than the retention
    /// window. Falls back to memory-only if the directory can't be created.
    pub fn with_log_dir(log_dir: PathBuf) -> LogBuffer {
        let file = match fs::create_dir_all(&log_dir) {
            Ok(()) => {
                prune_old_logs(&log_dir);
                Some(Mutex::new(FileSink::new(log_dir)))
            }
            Err(e) => {
                eprintln!("log dir unavailable, file logging disabled: {e}");
                None
            }
        };
        LogBuffer {
            inner: Mutex::new(Inner {
                entries: VecDeque::with_capacity(MAX_LINES),
                next_seq: 1,
            }),
            file_level: Mutex::new(Level::Info),
            preserve_diagnostics: AtomicBool::new(false),
            file,
        }
    }

    pub fn set_file_level(&self, level: Level) {
        *self.file_level.lock().unwrap() = level;
    }

    pub fn file_level(&self) -> Level {
        *self.file_level.lock().unwrap()
    }

    pub fn set_preserve_diagnostics(&self, enabled: bool) {
        self.preserve_diagnostics.store(enabled, Ordering::Release);
    }

    /// Tag, redact, and append a raw line. The stream ("out"/"err") nudges the
    /// level when the text itself carries no hint.
    pub fn push(&self, source: Source, stream: &str, raw: &str) {
        self.append(source, detect_level(raw, stream), raw);
    }

    /// Append a line whose level is already known (e.g. forwarded from the
    /// in-process engine's tracing subscriber, where the real level is exact and
    /// shouldn't be re-guessed from the text).
    pub fn push_event(&self, source: Source, level: Level, raw: &str) {
        self.append(source, level, raw);
    }

    /// Redact, mirror to disk, and append one entry at the given level.
    fn append(&self, source: Source, level: Level, raw: &str) {
        let stripped = strip_ansi(raw);
        let preserve_diagnostics = self.preserve_diagnostics.load(Ordering::Acquire);
        let memory_only_communication = preserve_diagnostics && is_communication_event(&stripped);
        let message = if memory_only_communication {
            stripped
        } else {
            redact(&stripped)
        };
        // Full communication entries may contain request/response bodies. They
        // stay memory-only until the user explicitly exports the buffer.
        let file_level = self.file_level();
        if !memory_only_communication && level.should_write_to_file(file_level) {
            if let Some(file) = self.file.as_ref() {
                if let Ok(mut sink) = file.lock() {
                    sink.write_line(source, level, &message);
                }
            }
        }
        let mut inner = self.inner.lock().unwrap();
        let seq = inner.next_seq;
        inner.next_seq += 1;
        inner.entries.push_back(LogEntry {
            seq,
            source,
            level,
            message,
        });
        while inner.entries.len() > MAX_LINES {
            inner.entries.pop_front();
        }
    }

    /// Return every entry with `seq > after`, oldest first.
    pub fn since(&self, after: u64) -> Vec<LogEntry> {
        let inner = self.inner.lock().unwrap();
        inner
            .entries
            .iter()
            .filter(|e| e.seq > after)
            .cloned()
            .collect()
    }

    /// Drop all buffered entries. Sequence numbers keep increasing so any
    /// in-flight frontend cursor simply sees nothing until new lines arrive.
    pub fn clear(&self) {
        self.inner.lock().unwrap().entries.clear();
    }
}

fn is_communication_event(message: &str) -> bool {
    message.contains("[communication]") || message.contains("channel=communication")
}

impl Default for LogBuffer {
    fn default() -> Self {
        LogBuffer::new()
    }
}

/// Best-effort level detection. Looks for a level keyword anywhere in the line
/// (covers both `ERROR foo` and `[2024-...] WARN foo` shapes); falls back to
/// the stream — stderr is treated as a warning, stdout as info.
fn detect_level(line: &str, stream: &str) -> Level {
    let lower = strip_ansi(line).to_ascii_lowercase();
    if ["error", "err", "fatal", "ftl"]
        .iter()
        .any(|level| contains_word(&lower, level))
        || lower.contains("panic")
    {
        Level::Error
    } else if ["warn", "warning", "wrn"]
        .iter()
        .any(|level| contains_word(&lower, level))
    {
        Level::Warn
    } else if ["debug", "dbg", "trace", "trc"]
        .iter()
        .any(|level| contains_word(&lower, level))
    {
        Level::Debug
    } else if ["info", "inf"]
        .iter()
        .any(|level| contains_word(&lower, level))
    {
        Level::Info
    } else if stream == "err" {
        Level::Warn
    } else {
        Level::Info
    }
}

/// True if `needle` appears in `haystack` bounded by non-alphanumeric edges, so
/// "info" doesn't match inside "reinforcement". `haystack` must be lowercase.
fn contains_word(haystack: &str, needle: &str) -> bool {
    let bytes = haystack.as_bytes();
    let mut start = 0;
    while let Some(pos) = haystack[start..].find(needle) {
        let i = start + pos;
        let before_ok = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
        let after = i + needle.len();
        let after_ok = after >= bytes.len() || !bytes[after].is_ascii_alphanumeric();
        if before_ok && after_ok {
            return true;
        }
        start = i + needle.len();
    }
    false
}

/// Redact anything that looks like a secret before it enters the buffer. This
/// is defensive: sidecars shouldn't log keys, but a stray line must never leak
/// one into the developer panel. We mask:
///   - common API-key prefixes (sk-, sk-ant-, ghp_, etc.) and the token after
///   - the value following key/token/password/secret/authorization markers
fn redact(line: &str) -> String {
    if contains_payload_field(line) {
        return "[redacted payload log]".to_string();
    }

    let mut out = String::with_capacity(line.len());
    let mut chars = line.char_indices().peekable();

    while let Some((i, c)) = chars.next() {
        // Try to match a bearer-style secret prefix at a word boundary.
        let at_boundary = i == 0
            || !line[..i]
                .chars()
                .next_back()
                .map(|p| p.is_ascii_alphanumeric())
                .unwrap_or(false);
        if at_boundary && c.is_ascii_alphabetic() {
            let rest = &line[i..];
            if let Some(len) = secret_token_len(rest) {
                out.push_str("***");
                // Advance the iterator past the masked token.
                for _ in 0..len.saturating_sub(1) {
                    chars.next();
                }
                continue;
            }
        }
        out.push(c);
    }

    redact_after_markers(&out)
}

/// Drop whole lines that contain structured request/response payload fields.
/// The gateway should never emit them, but this keeps legacy or stray sidecar
/// logs from reaching the in-memory panel, file mirror, or exported log file.
fn contains_payload_field(line: &str) -> bool {
    const FIELDS: [&str; 9] = [
        "body",
        "request",
        "response",
        "raw",
        "prompt",
        "system_prompt",
        "content",
        "query",
        "tool_result",
    ];

    let lower = line.to_ascii_lowercase();
    FIELDS.iter().any(|field| {
        [
            format!(r#""{field}":"#),
            format!("{field}="),
            format!("{field}: "),
        ]
        .iter()
        .any(|marker| contains_field_marker(&lower, marker))
    })
}

fn contains_field_marker(line: &str, marker: &str) -> bool {
    let mut search_from = 0;
    while let Some(relative) = line[search_from..].find(marker) {
        let start = search_from + relative;
        let left_boundary = start == 0
            || line[..start]
                .chars()
                .next_back()
                .is_some_and(|c| !c.is_ascii_alphanumeric() && c != '_');
        if left_boundary {
            return true;
        }
        search_from = start + marker.len();
    }
    false
}

/// If `s` starts with a known secret prefix followed by a plausible token body,
/// return the full token length (prefix + body); otherwise None.
fn secret_token_len(s: &str) -> Option<usize> {
    const PREFIXES: [&str; 6] = ["sk-ant-", "sk-", "ghp_", "gho_", "xoxb-", "AIza"];
    for p in PREFIXES {
        if s.len() > p.len() && s.starts_with(p) {
            let body: String = s[p.len()..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            // Require a reasonably long body to avoid masking ordinary words.
            if body.len() >= 8 {
                return Some(p.len() + body.len());
            }
        }
    }
    None
}

/// Mask the value following `key=`, `token: `, `password ...`, `authorization`,
/// `secret`, `api_key` markers (case-insensitive), with `=` or `:` separators.
/// Runs as a fixed-point loop: each pass masks the first not-yet-masked value
/// and recomputes positions against the mutated string, stopping when a pass
/// changes nothing (so an already-`***` value is never re-masked).
fn redact_after_markers(input: &str) -> String {
    const MARKERS: [&str; 7] = [
        "authorization",
        "api_key",
        "apikey",
        "password",
        "secret",
        "token",
        "key",
    ];
    const MASK: &str = "***";

    let mut result = input.to_string();
    loop {
        let lower = result.to_ascii_lowercase();
        let mut masked_this_pass = false;

        'markers: for marker in MARKERS {
            let mut search_from = 0;
            while let Some(rel) = lower[search_from..].find(marker) {
                let mstart = search_from + rel;
                let after_marker = mstart + marker.len();
                search_from = after_marker;

                // Marker must end on a word boundary so "key" misses "keyboard".
                let boundary = after_marker >= lower.len()
                    || !lower.as_bytes()[after_marker].is_ascii_alphanumeric();
                if !boundary {
                    continue;
                }

                // Walk to a `:`/`=` separator, tolerating spaces and quotes.
                let mut idx = after_marker;
                let mut found_sep = false;
                for ch in result[after_marker..].chars() {
                    if ch == ':' || ch == '=' {
                        idx += ch.len_utf8();
                        found_sep = true;
                        break;
                    }
                    if ch == ' ' || ch == '"' || ch == '\'' {
                        idx += ch.len_utf8();
                        continue;
                    }
                    break;
                }
                if !found_sep {
                    continue;
                }

                // Skip whitespace/quotes after the separator to reach the value.
                let value_start = idx
                    + result[idx..]
                        .chars()
                        .take_while(|c| *c == ' ' || *c == '"' || *c == '\'')
                        .map(|c| c.len_utf8())
                        .sum::<usize>();
                if value_start >= result.len() {
                    continue;
                }
                let value_len = result[value_start..]
                    .chars()
                    .take_while(|c| !c.is_whitespace() && *c != '"' && *c != '\'' && *c != ',')
                    .map(|c| c.len_utf8())
                    .sum::<usize>();
                if value_len == 0 {
                    continue;
                }
                // Already masked → leave it and keep scanning (prevents looping).
                if &result[value_start..value_start + value_len] == MASK {
                    continue;
                }
                result.replace_range(value_start..value_start + value_len, MASK);
                masked_this_pass = true;
                break 'markers;
            }
        }

        if !masked_this_pass {
            return result;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_caps_and_orders() {
        let buf = LogBuffer::new();
        for i in 0..(MAX_LINES + 50) {
            buf.push(Source::Engine, "out", &format!("line {i}"));
        }
        let all = buf.since(0);
        assert_eq!(all.len(), MAX_LINES);
        // oldest retained line is the 51st pushed (0-indexed 50)
        assert_eq!(all.first().unwrap().message, "line 50");
        assert!(all[0].seq < all[1].seq);
    }

    #[test]
    fn since_returns_only_newer() {
        let buf = LogBuffer::new();
        buf.push(Source::Gateway, "out", "a");
        buf.push(Source::Gateway, "out", "b");
        let first = buf.since(0);
        let cursor = first.last().unwrap().seq;
        buf.push(Source::Gateway, "out", "c");
        let next = buf.since(cursor);
        assert_eq!(next.len(), 1);
        assert_eq!(next[0].message, "c");
    }

    #[test]
    fn clear_empties_but_keeps_seq() {
        let buf = LogBuffer::new();
        buf.push(Source::Engine, "out", "a");
        buf.clear();
        assert!(buf.since(0).is_empty());
        buf.push(Source::Engine, "out", "b");
        // seq kept climbing, so the new line is seq 2, not 1
        assert_eq!(buf.since(0)[0].seq, 2);
    }

    #[test]
    fn level_detection() {
        assert_eq!(detect_level("ERROR boom", "out"), Level::Error);
        assert_eq!(detect_level("thread panicked at ...", "out"), Level::Error);
        assert_eq!(detect_level("[2024] WARN slow", "out"), Level::Warn);
        assert_eq!(detect_level("DEBUG x", "out"), Level::Debug);
        assert_eq!(detect_level("listening on :3000", "out"), Level::Info);
        // stderr with no keyword leans warn
        assert_eq!(detect_level("something", "err"), Level::Warn);
        // word-boundary: "info" inside another word doesn't force info, and
        // "error" must be a standalone word
        assert_eq!(detect_level("reinforcement step", "out"), Level::Info);

        let zerolog_info = "\u{1b}[90m10:09AM\u{1b}[0m \u{1b}[32mINF\u{1b}[0m Gateway listening";
        assert_eq!(detect_level(zerolog_info, "err"), Level::Info);
        let zerolog_warn = "\u{1b}[90m10:09AM\u{1b}[0m \u{1b}[33mWRN\u{1b}[0m search fallback";
        assert_eq!(detect_level(zerolog_warn, "err"), Level::Warn);
    }

    #[test]
    fn keeps_safe_payload_metadata_and_strips_ansi() {
        let buf = LogBuffer::new();
        let raw = "\u{1b}[32mINF\u{1b}[0m has_system_prompt=true tool-loop follow-up request";
        buf.push(Source::Gateway, "err", raw);

        let entry = &buf.since(0)[0];
        assert_eq!(entry.level, Level::Info);
        assert_eq!(
            entry.message,
            "INF has_system_prompt=true tool-loop follow-up request"
        );
    }

    #[test]
    fn redacts_bearer_prefixes() {
        let r = redact("loaded key sk-abc123def456ghi for openai");
        assert!(!r.contains("sk-abc123def456ghi"), "got: {r}");
        assert!(r.contains("***"));
        let r2 = redact("anthropic sk-ant-api03-XXXXXXXXYYYY done");
        assert!(!r2.contains("XXXXXXXXYYYY"), "got: {r2}");
    }

    #[test]
    fn redacts_after_markers() {
        let r = redact("Authorization: Bearer-fake-not-prefixed-1234567");
        // the token after Authorization: gets masked
        assert!(r.contains("***"), "got: {r}");
        let r2 = redact(r#"{"api_key":"plain-secret-value"}"#);
        assert!(!r2.contains("plain-secret-value"), "got: {r2}");
        let r3 = redact("password=hunter2trustno1");
        assert!(!r3.contains("hunter2trustno1"), "got: {r3}");
    }

    #[test]
    fn drops_payload_fields_from_memory_and_file_logs() {
        const CANARY: &str = "WF01-CANARY-private-conversation-content";
        let dir = std::env::temp_dir().join(format!(
            "encorehub-payload-log-test-{}-{}",
            std::process::id(),
            chrono::Local::now()
                .timestamp_nanos_opt()
                .unwrap_or_default()
        ));
        let buf = LogBuffer::with_log_dir(dir.clone());

        let payload_fields = [
            "body",
            "request",
            "response",
            "raw",
            "prompt",
            "system_prompt",
            "content",
            "query",
            "tool_result",
        ];
        for field in payload_fields {
            let raw = format!(r#"{{"level":"info","{field}":"{CANARY}"}}"#);
            buf.push(Source::Gateway, "out", &raw);
        }
        buf.push(Source::Gateway, "out", &format!("query={CANARY}"));
        buf.push(Source::Gateway, "out", &format!("response: {CANARY}"));

        let buffered = buf.since(0);
        assert_eq!(buffered.len(), payload_fields.len() + 2);
        assert!(
            buffered.iter().all(|entry| !entry.message.contains(CANARY)),
            "memory log leaked payload: {buffered:?}"
        );

        let day = chrono::Local::now().format("%Y-%m-%d").to_string();
        let path = dir.join(format!("encorehub-{day}.log"));
        let text = std::fs::read_to_string(&path).expect("log file should exist");
        assert!(!text.contains(CANARY), "file log leaked payload: {text}");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn preserves_only_marked_communication_payloads_with_full_logging() {
        const CANARY: &str = "developer-visible-prompt";
        let buf = LogBuffer::new();
        buf.set_preserve_diagnostics(true);

        buf.push_event(
            Source::Frontend,
            Level::Info,
            &format!(r#"[communication] {{"body":"{CANARY}"}}"#),
        );
        buf.push_event(
            Source::Frontend,
            Level::Info,
            &format!(r#"{{"body":"{CANARY}"}}"#),
        );

        let entries = buf.since(0);
        assert!(entries[0].message.contains(CANARY));
        assert!(!entries[1].message.contains(CANARY));
    }

    #[test]
    fn leaves_ordinary_text_alone() {
        let r = redact("listening on 127.0.0.1:3000, ready");
        assert_eq!(r, "listening on 127.0.0.1:3000, ready");
        // "key" inside "keyboard" must not trigger masking
        let r2 = redact("keyboard shortcut registered");
        assert_eq!(r2, "keyboard shortcut registered");
    }

    #[test]
    fn strip_ansi_removes_color_codes() {
        let colored = "\u{1b}[32m INFO\u{1b}[0m starting up";
        assert_eq!(strip_ansi(colored), " INFO starting up");
        // plain text is unchanged
        assert_eq!(strip_ansi("no codes here"), "no codes here");
    }

    #[test]
    fn file_logging_defaults_to_info_threshold() {
        let dir = std::env::temp_dir().join(format!(
            "encorehub-log-test-{}-{}",
            std::process::id(),
            chrono::Local::now()
                .timestamp_nanos_opt()
                .unwrap_or_default()
        ));
        let buf = LogBuffer::with_log_dir(dir.clone());

        buf.push_event(Source::Engine, Level::Debug, "debug skipped");
        buf.push_event(Source::Engine, Level::Info, "info kept");

        let day = chrono::Local::now().format("%Y-%m-%d").to_string();
        let path = dir.join(format!("encorehub-{day}.log"));
        let text = std::fs::read_to_string(&path).expect("log file should exist");
        assert!(!text.contains("debug skipped"), "got: {text}");
        assert!(text.contains("info kept"), "got: {text}");

        buf.set_file_level(Level::Debug);
        buf.push_event(Source::Engine, Level::Debug, "debug kept");
        let text = std::fs::read_to_string(&path).expect("log file should exist");
        assert!(text.contains("debug kept"), "got: {text}");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn parses_file_log_level_names() {
        assert_eq!(Level::parse("ERROR"), Some(Level::Error));
        assert_eq!(Level::parse("warning"), Some(Level::Warn));
        assert_eq!(Level::parse(" info "), Some(Level::Info));
        assert_eq!(Level::parse("debug"), Some(Level::Debug));
        assert_eq!(Level::parse("trace"), None);
    }

    #[test]
    fn native_export_writes_selected_file_and_redacts_again() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("selected.txt");
        let entries = vec![LogEntry {
            seq: 1,
            source: Source::Gateway,
            level: Level::Info,
            message: "loaded key sk-export-canary-123456789".into(),
        }];

        export_log_entries(&path, &entries, false).unwrap();
        let text = fs::read_to_string(&path).unwrap();

        assert!(text.contains("[gateway/info]"));
        assert!(!text.contains("sk-export-canary"));
    }

    #[test]
    fn full_communication_entries_are_memory_only_until_export() {
        let temp = tempfile::tempdir().unwrap();
        let log_dir = temp.path().join("logs");
        let export_path = temp.path().join("export.txt");
        let buf = LogBuffer::with_log_dir(log_dir.clone());
        buf.set_preserve_diagnostics(true);
        buf.push_event(
            Source::Frontend,
            Level::Info,
            r#"[communication] {"body":"memory-only-canary"}"#,
        );

        let day = chrono::Local::now().format("%Y-%m-%d").to_string();
        let daily_path = log_dir.join(format!("encorehub-{day}.log"));
        assert!(
            !daily_path.exists(),
            "communication trace created a log file"
        );

        let entries = buf.since(0);
        assert!(entries[0].message.contains("memory-only-canary"));
        export_log_entries(&export_path, &entries, true).unwrap();
        assert!(fs::read_to_string(export_path)
            .unwrap()
            .contains("memory-only-canary"));
    }
}
