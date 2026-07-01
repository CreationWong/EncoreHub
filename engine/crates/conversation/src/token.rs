//! Token counting for conversation context management.
//!
//! Two strategies:
//! 1. **Rough estimation** — `content.len() / bytes_per_token` (4 for text, 2 for JSON).
//!    Universal, zero-cost, works across all providers.
//! 2. **API-reported usage** — exact counts from provider responses
//!    (Anthropic `usage`, OpenAI `usage`). Preferred when available.
//!
//! The canonical context-window measurement is
//! [`token_count_with_estimation`]: last API-reported usage + rough estimate for
//! messages added since that API call. This avoids cumulative double-counting and
//! stays accurate across compaction boundaries.
//!
//! ## Provider notes
//!
//! - **Anthropic**: returns `usage { input_tokens, output_tokens,
//!   cache_creation_input_tokens, cache_read_input_tokens }` on every response.
//!   The `count_tokens` endpoint gives exact pre-flight counts.
//! - **OpenAI**: returns `usage { prompt_tokens, completion_tokens, total_tokens }`.
//!   No pre-flight token count API; use rough estimation.
//! - **DeepSeek**: same shape as OpenAI.
//!
//! When API-reported counts are unavailable the rough estimator is the fallback
//! for all providers.

use encorehub_core::Message;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Default bytes-per-token for general text (English prose).
pub const BYTES_PER_TOKEN_DEFAULT: usize = 4;

/// Bytes-per-token for JSON / JSONL — dense single-character tokens
/// (`{`, `}`, `:`, `,`, `"`) push the real ratio closer to 2.
pub const BYTES_PER_TOKEN_JSON: usize = 2;

/// Conservative token estimate for an image placeholder (resized to ≤ 2000×2000
/// px → ⌈(w×h)/750⌉ ≤ 5333; we use 2000 as a safe average).
pub const IMAGE_TOKEN_ESTIMATE: usize = 2000;

/// Assumed token cost for a single tool definition in the system prompt.
/// Real cost depends on the JSON Schema size; this is a rule-of-thumb average.
pub const TOOL_DEFINITION_TOKEN_ESTIMATE: usize = 200;

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/// Token usage snapshot from a provider API response.
///
/// All fields are optional — different providers report different subsets.
/// Fill in whatever the provider returned; the combinators skip zeros.
#[derive(Debug, Clone, Copy, Default)]
pub struct Usage {
    pub input_tokens: usize,
    pub output_tokens: usize,
    pub cache_creation_input_tokens: usize,
    pub cache_read_input_tokens: usize,
}

impl Usage {
    /// Total context-window tokens represented by this usage snapshot.
    ///
    /// This is `input + cache_creation + cache_read + output` — the full
    /// context size at the time of the API call.  Use this as the base when
    /// computing [`token_count_with_estimation`].
    pub fn total(&self) -> usize {
        self.input_tokens
            + self.cache_creation_input_tokens
            + self.cache_read_input_tokens
            + self.output_tokens
    }
}

// ---------------------------------------------------------------------------
// Rough estimation
// ---------------------------------------------------------------------------

/// Rough token count from a UTF-8 string.
///
/// Uses `content.len() / bytes_per_token`.  For general English text a
/// 4-byte-per-token ratio is a reasonable approximation across GPT-4,
/// Claude, and DeepSeek tokenisers.  For JSON / JSONL prefer 2.
pub fn rough_token_count(content: &str, bytes_per_token: usize) -> usize {
    if content.is_empty() {
        return 0;
    }
    // Round up so a single character still counts as 1 token.
    content.len().div_ceil(bytes_per_token)
}

/// Convenience: rough token count with the default 4 bytes-per-token ratio.
pub fn rough_token_count_default(content: &str) -> usize {
    rough_token_count(content, BYTES_PER_TOKEN_DEFAULT)
}

/// Return the recommended bytes-per-token ratio for a file extension.
///
/// JSON / JSONL / JSONC have many single-character tokens and estimate better
/// at 2 bytes/token.  Everything else defaults to 4.
pub fn bytes_per_token_for_file_type(extension: &str) -> usize {
    match extension.to_lowercase().as_str() {
        "json" | "jsonl" | "jsonc" => BYTES_PER_TOKEN_JSON,
        _ => BYTES_PER_TOKEN_DEFAULT,
    }
}

// ---------------------------------------------------------------------------
// Per-message estimation
// ---------------------------------------------------------------------------

/// Estimate tokens consumed by a single [`Message`].
///
/// Covers:
/// - `content` (the visible text)
/// - `reasoning` (chain-of-thought, if any)
/// - A small fixed overhead for role / metadata markers (~4 tokens).
pub fn estimate_message_tokens(msg: &Message) -> usize {
    let mut tokens = 4; // role + framing overhead
    tokens += rough_token_count_default(&msg.content);
    if !msg.reasoning.is_empty() {
        tokens += rough_token_count_default(&msg.reasoning);
    }
    tokens
}

/// Sum of [`estimate_message_tokens`] over a slice of messages.
pub fn estimate_messages_tokens(messages: &[Message]) -> usize {
    messages.iter().map(estimate_message_tokens).sum()
}

// ---------------------------------------------------------------------------
// Context-window measurement
// ---------------------------------------------------------------------------

/// Canonical context-window size in tokens.
///
/// Computed as: **last API-reported token count** + **rough estimate for every
/// message added since that API call**.
///
/// This avoids the double-counting that would occur from cumulative estimation
/// (each round the same history would be re-estimated) and stays accurate even
/// after a compaction boundary.
///
/// When `last_usage` is `None` (e.g. no API call has happened yet) falls back
/// to a pure rough estimate of **all** messages.
pub fn token_count_with_estimation(
    all_messages: &[Message],
    last_usage: Option<Usage>,
) -> usize {
    match last_usage {
        Some(usage) if usage.total() > 0 => {
            // If the last API call covered N messages, we need the count of
            // *new* messages added since then.  In the absence of a precise
            // message index from the provider we use a heuristic: find the
            // last assistant message (the one the usage came from) and
            // estimate everything *after* it.
            let covered = count_messages_covered_by_usage(all_messages);
            let new_messages = &all_messages[covered..];
            usage.total() + estimate_messages_tokens(new_messages)
        }
        _ => estimate_messages_tokens(all_messages),
    }
}

/// Heuristic: walk backwards from the end, find the last assistant message
/// (which carries the usage), and return the index *after* it so that
/// `all_messages[covered..]` contains only messages not yet included in the
/// API-reported count.
fn count_messages_covered_by_usage(messages: &[Message]) -> usize {
    for (i, msg) in messages.iter().enumerate().rev() {
        if matches!(msg.role, encorehub_core::Role::Assistant) {
            return i + 1; // include this assistant message
        }
    }
    messages.len() // fallback: treat all as covered
}

/// Check whether a conversation exceeds a given token limit.
///
/// Returns `true` when even the rough estimate (worst case) is over the limit.
/// Callers should use this as a trigger for compaction or truncation.
pub fn exceeds_token_limit(messages: &[Message], limit: usize, last_usage: Option<Usage>) -> bool {
    token_count_with_estimation(messages, last_usage) > limit
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use encorehub_core::{Message, Role};

    // ---- rough_token_count ----

    #[test]
    fn empty_string_is_zero() {
        assert_eq!(rough_token_count("", 4), 0);
    }

    #[test]
    fn single_char_counts_as_one() {
        assert_eq!(rough_token_count("a", 4), 1);
    }

    #[test]
    fn typical_english_sentence() {
        // "Hello world" = 11 chars → ceil(11/4) = 3
        assert_eq!(rough_token_count("Hello world", 4), 3);
    }

    #[test]
    fn json_dense_ratio() {
        let json = r#"{"key":"value","num":42}"#; // 24 chars → ceil(24/2) = 12
        assert_eq!(rough_token_count(json, 2), 12);
    }

    // ---- bytes_per_token_for_file_type ----

    #[test]
    fn json_variants_use_2() {
        assert_eq!(bytes_per_token_for_file_type("json"), 2);
        assert_eq!(bytes_per_token_for_file_type("jsonl"), 2);
        assert_eq!(bytes_per_token_for_file_type("jsonc"), 2);
        assert_eq!(bytes_per_token_for_file_type("JSON"), 2); // case-insensitive
    }

    #[test]
    fn other_extensions_use_4() {
        assert_eq!(bytes_per_token_for_file_type("md"), 4);
        assert_eq!(bytes_per_token_for_file_type("txt"), 4);
        assert_eq!(bytes_per_token_for_file_type("rs"), 4);
        assert_eq!(bytes_per_token_for_file_type(""), 4);
    }

    // ---- Usage ----

    #[test]
    fn usage_total_sums_all_fields() {
        let u = Usage {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 20,
        };
        assert_eq!(u.total(), 180);
    }

    #[test]
    fn default_usage_is_zero() {
        assert_eq!(Usage::default().total(), 0);
    }

    // ---- estimate_message_tokens ----

    fn make_msg(role: Role, content: &str) -> Message {
        Message::new("conv-1", role, content, None)
    }

    #[test]
    fn user_message_estimate() {
        let msg = make_msg(Role::User, "Hello, how are you?"); // 19 chars → ceil(19/4)=5 + 4 overhead = 9
        assert_eq!(estimate_message_tokens(&msg), 9);
    }

    #[test]
    fn message_with_reasoning() {
        let mut msg = make_msg(Role::Assistant, "The answer is 42.");
        msg.reasoning = "Let me think about this step by step...".into();
        // content: 18 chars → ceil(18/4)=5
        // reasoning: 40 chars → ceil(40/4)=10
        // overhead: 4
        // total: 19
        assert_eq!(estimate_message_tokens(&msg), 19);
    }

    // ---- estimate_messages_tokens ----

    #[test]
    fn sum_over_messages() {
        let msgs = vec![
            make_msg(Role::User, "Hi"),
            make_msg(Role::Assistant, "Hello!"),
        ];
        // "Hi" = 2 chars → ceil(2/4)=1 + 4 = 5
        // "Hello!" = 6 chars → ceil(6/4)=2 + 4 = 6
        // total = 11
        assert_eq!(estimate_messages_tokens(&msgs), 11);
    }

    // ---- token_count_with_estimation ----

    #[test]
    fn fallback_when_no_usage() {
        let msgs = vec![make_msg(Role::User, "Hi")];
        assert_eq!(
            token_count_with_estimation(&msgs, None),
            estimate_messages_tokens(&msgs),
        );
    }

    #[test]
    fn fallback_when_zero_usage() {
        let msgs = vec![make_msg(Role::User, "Hi")];
        assert_eq!(
            token_count_with_estimation(&msgs, Some(Usage::default())),
            estimate_messages_tokens(&msgs),
        );
    }

    #[test]
    fn appends_estimate_to_usage() {
        let msgs = vec![
            make_msg(Role::User, "Question?"),
            make_msg(Role::Assistant, "Answer."),
            make_msg(Role::User, "Follow-up?"), // new since last API call
        ];
        let usage = Usage {
            input_tokens: 10,
            output_tokens: 5,
            ..Default::default()
        };
        let result = token_count_with_estimation(&msgs, Some(usage));
        // usage.total() = 15
        // last assistant is at index 1, so new = msgs[2..]
        // "Follow-up?" = 11 chars → ceil(11/4)=3 + 4 = 7
        // total = 22
        assert_eq!(result, 22);
    }

    // ---- exceeds_token_limit ----

    #[test]
    fn under_limit() {
        let msgs = vec![make_msg(Role::User, "Hi")];
        assert!(!exceeds_token_limit(&msgs, 100, None));
    }

    #[test]
    fn over_limit() {
        let msgs = vec![make_msg(Role::User, &"x".repeat(10_000))];
        assert!(exceeds_token_limit(&msgs, 100, None));
    }
}
