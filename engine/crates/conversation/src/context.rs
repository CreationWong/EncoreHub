//! Context-window construction.
//!
//! Selects the provider message sequence for one request: stored summary plus
//! the newest run of raw messages that fits a token budget. The budget is
//! supplied by the caller after system prompt, tools, and the current turn have
//! been reserved, so this module only decides which history to send.
//!
//! Selection is suffix-contiguous: a message is never sent without every newer
//! message after it, because a gap in the transcript reads as a non-sequitur.
//! Messages covered by an applicable summary are dropped from the sequence —
//! the summary text carries them instead.

use crate::token::{estimate_message_tokens, rough_token_count_default};
use encorehub_core::Message;

/// A stored compaction summary and the last message it covers.
///
/// `end_message_id` is the boundary that makes the summary auditable: messages
/// after it are candidates for the request, messages through it are dropped.
#[derive(Debug, Clone, Copy)]
pub struct ContextSummary<'a> {
    pub text: &'a str,
    pub end_message_id: &'a str,
}

/// Provider message selection produced by [`build_context`].
#[derive(Debug, Clone)]
pub struct ContextSelection {
    /// Messages to send, oldest first.
    pub messages: Vec<Message>,
    /// Estimated tokens of `messages` plus an included summary.
    pub estimated_tokens: usize,
    /// History messages left out of this request (summarized or trimmed).
    pub dropped_messages: usize,
    /// Whether the summary text was applied, counting against the budget.
    pub summary_included: bool,
}

/// Build the message sequence for a request under `budget` tokens.
///
/// A summary is applied only when its text fits the budget and its
/// `end_message_id` is present in `messages`; otherwise the summary is ignored
/// and recent raw messages are selected instead, so a stale or oversized
/// summary never blocks the request. The selected sequence never exceeds the
/// budget: a single message larger than the remaining budget is dropped rather
/// than sent.
pub fn build_context(
    messages: &[Message],
    budget: usize,
    summary: Option<ContextSummary<'_>>,
) -> ContextSelection {
    let summary_tokens = summary
        .map(|candidate| rough_token_count_default(candidate.text))
        .unwrap_or(0);
    // Candidates start after the summary boundary; a summary whose boundary is
    // missing from the transcript cannot be applied without guessing.
    let (candidates, summary_tokens, summary_included) = match summary {
        Some(candidate) if summary_tokens <= budget => {
            match messages
                .iter()
                .position(|message| message.id == candidate.end_message_id)
            {
                Some(index) => (&messages[index + 1..], summary_tokens, true),
                None => (messages, 0, false),
            }
        }
        _ => (messages, 0, false),
    };

    let remaining = budget - summary_tokens;
    let mut selected: Vec<Message> = Vec::new();
    let mut used = 0usize;
    for message in candidates.iter().rev() {
        let cost = estimate_message_tokens(message);
        if used + cost > remaining {
            break;
        }
        used += cost;
        selected.push(message.clone());
    }
    // Walking backwards found the newest suffix; restore chronological order.
    selected.reverse();

    ContextSelection {
        dropped_messages: messages.len() - selected.len(),
        messages: selected,
        estimated_tokens: summary_tokens + used,
        summary_included,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use encorehub_core::Role;

    /// Assistant message carrying tool calls, to prove payload cost is counted.
    fn make_msg(role: Role, content: &str) -> Message {
        Message::new("conv-1", role, content, None)
    }

    #[test]
    fn keeps_everything_when_history_fits() {
        let messages = vec![
            make_msg(Role::User, "Hi"),
            make_msg(Role::Assistant, "Hello!"),
        ];

        let selection = build_context(&messages, 1_000, None);

        assert_eq!(selection.messages.len(), 2);
        assert_eq!(selection.dropped_messages, 0);
        assert!(!selection.summary_included);
        assert_eq!(selection.estimated_tokens, 11);
    }

    #[test]
    fn trims_oldest_messages_and_keeps_a_contiguous_suffix() {
        // Each message is 4 overhead + ceil(40/4) = 14 tokens.
        let messages: Vec<Message> = (0..5)
            .map(|index| make_msg(Role::User, &format!("{:040}", index)))
            .collect();

        // Budget fits exactly two messages (28 tokens), so three are dropped.
        let selection = build_context(&messages, 28, None);

        assert_eq!(selection.messages.len(), 2);
        assert_eq!(selection.messages[0].content, messages[3].content);
        assert_eq!(selection.messages[1].content, messages[4].content);
        assert_eq!(selection.dropped_messages, 3);
        assert_eq!(selection.estimated_tokens, 28);
    }

    #[test]
    fn includes_a_message_that_exactly_fills_the_budget() {
        let message = make_msg(Role::User, &"x".repeat(40));
        let cost = estimate_message_tokens(&message);

        let selection = build_context(std::slice::from_ref(&message), cost, None);

        assert_eq!(selection.messages.len(), 1);
        assert_eq!(selection.estimated_tokens, cost);
    }

    #[test]
    fn zero_budget_sends_no_history() {
        let messages = vec![make_msg(Role::User, "Hi")];

        let selection = build_context(&messages, 0, None);

        assert!(selection.messages.is_empty());
        assert_eq!(selection.dropped_messages, 1);
        assert_eq!(selection.estimated_tokens, 0);
    }

    #[test]
    fn drops_a_single_message_larger_than_the_budget() {
        let messages = vec![make_msg(Role::User, &"x".repeat(4_000))];

        let selection = build_context(&messages, 100, None);

        assert!(selection.messages.is_empty());
        assert_eq!(selection.dropped_messages, 1);
    }

    #[test]
    fn applies_a_summary_and_selects_the_messages_after_it() {
        let messages = vec![
            make_msg(Role::User, "old question"),
            make_msg(Role::Assistant, "old answer"),
            make_msg(Role::User, "recent question"),
            make_msg(Role::Assistant, "recent answer"),
        ];
        let summary = ContextSummary {
            text: "Old context",
            end_message_id: &messages[1].id,
        };

        let selection = build_context(&messages, 1_000, Some(summary));

        assert!(selection.summary_included);
        assert_eq!(selection.messages.len(), 2);
        assert_eq!(selection.messages[0].content, "recent question");
        // Both covered messages and any trimmed tail count as dropped.
        assert_eq!(selection.dropped_messages, 2);
        // Summary text: ceil(11/4) = 3 tokens, plus both recent messages.
        assert_eq!(
            selection.estimated_tokens,
            3 + estimate_message_tokens(&messages[2]) + estimate_message_tokens(&messages[3]),
        );
    }

    #[test]
    fn ignores_a_summary_whose_text_exceeds_the_budget() {
        let messages = vec![make_msg(Role::User, "Hi")];
        let long_summary = "s".repeat(4_000);
        let summary = ContextSummary {
            text: &long_summary,
            end_message_id: &messages[0].id,
        };

        let selection = build_context(&messages, 100, Some(summary));

        assert!(!selection.summary_included);
        // The raw history fits, so it is sent instead of the oversized summary.
        assert_eq!(selection.messages.len(), 1);
        assert_eq!(selection.dropped_messages, 0);
    }

    #[test]
    fn ignores_a_summary_whose_range_end_is_unknown() {
        let messages = vec![make_msg(Role::User, "Hi")];
        let summary = ContextSummary {
            text: "Old context",
            end_message_id: "missing-message",
        };

        let selection = build_context(&messages, 1_000, Some(summary));

        assert!(!selection.summary_included);
        assert_eq!(selection.messages.len(), 1);
        assert_eq!(selection.estimated_tokens, 5);
    }

    #[test]
    fn summary_and_tail_share_the_budget() {
        // Summary text: 40 chars -> 10 tokens; budget 24 leaves 14 for history.
        let summary_text = "s".repeat(40);
        let messages: Vec<Message> = (0..3)
            .map(|index| make_msg(Role::User, &format!("{:040}", index)))
            .collect();
        let summary = ContextSummary {
            text: &summary_text,
            end_message_id: "not-in-history",
        };

        // Boundary id missing -> summary is ignored, all three fit instead.
        let with_broken_boundary = build_context(&messages, 42, Some(summary));
        assert_eq!(with_broken_boundary.messages.len(), 3);

        let summary = ContextSummary {
            text: &summary_text,
            end_message_id: &messages[0].id,
        };
        let selection = build_context(&messages, 42, Some(summary));

        // 10 summary tokens + 14 per message: budget 42 fits messages[1..3],
        // leaving the covered range out and nothing for a fourth message.
        assert!(selection.summary_included);
        assert_eq!(selection.messages.len(), 2);
        assert_eq!(selection.messages[0].content, messages[1].content);
        assert_eq!(selection.estimated_tokens, 38);
    }
}
