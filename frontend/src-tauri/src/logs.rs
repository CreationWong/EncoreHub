//! In-memory ring buffer for sidecar (engine/gateway) logs, feeding the in-app
//! developer panel. Lines are tagged with their source and a best-effort level,
//! and secrets are redacted before a line ever enters the buffer — so neither
//! the buffer nor anything the frontend pulls can contain an API key.

use std::collections::VecDeque;
use std::sync::Mutex;

use serde::Serialize;

/// Max lines kept in memory. Older lines are dropped as new ones arrive.
const MAX_LINES: usize = 2000;

/// Where a log line came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Engine,
    Gateway,
    Desktop,
}

impl Source {
    pub fn from_service(name: &str) -> Source {
        match name {
            "encorehub-engine" => Source::Engine,
            "gateway" => Source::Gateway,
            _ => Source::Desktop,
        }
    }
}

/// Severity, parsed best-effort from the line text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warn,
    Info,
    Debug,
}

/// One captured log line.
#[derive(Clone, Debug, Serialize)]
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
}

struct Inner {
    entries: VecDeque<LogEntry>,
    next_seq: u64,
}

impl LogBuffer {
    pub fn new() -> LogBuffer {
        LogBuffer {
            inner: Mutex::new(Inner {
                entries: VecDeque::with_capacity(MAX_LINES),
                next_seq: 1,
            }),
        }
    }

    /// Tag, redact, and append a raw line. The stream ("out"/"err") nudges the
    /// level when the text itself carries no hint.
    pub fn push(&self, source: Source, stream: &str, raw: &str) {
        let level = detect_level(raw, stream);
        let message = redact(raw);
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

impl Default for LogBuffer {
    fn default() -> Self {
        LogBuffer::new()
    }
}

/// Best-effort level detection. Looks for a level keyword anywhere in the line
/// (covers both `ERROR foo` and `[2024-...] WARN foo` shapes); falls back to
/// the stream — stderr is treated as a warning, stdout as info.
fn detect_level(line: &str, stream: &str) -> Level {
    let lower = line.to_ascii_lowercase();
    if contains_word(&lower, "error") || contains_word(&lower, "fatal") || lower.contains("panic") {
        Level::Error
    } else if contains_word(&lower, "warn") || contains_word(&lower, "warning") {
        Level::Warn
    } else if contains_word(&lower, "debug") || contains_word(&lower, "trace") {
        Level::Debug
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
    fn leaves_ordinary_text_alone() {
        let r = redact("listening on 127.0.0.1:3000, ready");
        assert_eq!(r, "listening on 127.0.0.1:3000, ready");
        // "key" inside "keyboard" must not trigger masking
        let r2 = redact("keyboard shortcut registered");
        assert_eq!(r2, "keyboard shortcut registered");
    }
}
