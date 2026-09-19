# ADR-0011: Multi-participant conversations (multi-AI group chat)

- **Status**: Accepted
- **Date**: 2026-09-19
- **Deciders**: EncoreHub maintainers
- **Related**: ADR-0003 (chat turn state and stream finalization), ADR-0005 (character profile snapshots)

## Context

Every conversation stored exactly one character association: `conversations.character_id`
plus one frozen `character_snapshot`, one `provider`/`model` pair, and `messages` rows
that carried no speaker identity. The Gateway chat handler resolved a single provider
adapter and key, streamed one assistant, and finalized one assistant message per turn.

The product now needs a Grok-style group bot workspace: the user sends one message and
several AI characters answer in sequence, each with its own persona, model, and visible
identity, so later members can react to earlier replies in the same turn.

ADR-0003 explicitly rejected a separate chat-turns table because there was "no current
multi-assistant use case". Group chat invalidates that assumption: one user message can
legitimately produce several assistant messages.

## Decision

1. **Participants are first-class rows.** A new `conversation_participants` table stores
   an ordered roster (`position`), each member's frozen `character_snapshot`,
   `character_id` + `character_version`, and per-member `provider`/`model`. Existing
   single-character conversations simply have no roster rows; their legacy columns keep
   working unchanged. The first member also fills the conversation's legacy columns so
   memory-mode resolution and history rendering keep their existing paths.

2. **Messages carry speaker attribution.** `messages.sender_character_id` is nullable and
   set only for group assistant messages. It is an id, not a copied snapshot: the roster
   holds the frozen identity, so renaming a character later cannot rewrite history and no
   snapshot bytes are duplicated per message.

3. **One turn can commit several assistants.** `finalize_chat_turn` accepts a slice of
   `AssistantTurn { message, tool_calls }` and inserts them in one transaction with the
   user terminal status. The single-assistant request field stays supported for
   compatibility; `assistants[]` is additive.

4. **Group routing lives in the Gateway.** A dedicated
   `POST /api/v1/conversations/:id/group-chat` endpoint walks the roster in order.
   Explicit `@` mentions (ids from the composer, with a name-matching fallback) select
   only the addressed members; otherwise the conversation's `reply_mode` decides:
   `sequential` asks everyone, `smart` lets a member decline with a `[[NO_REPLY]]`
   sentinel that is never persisted.

5. **The SSE contract is participant-segmented.** `participant_started`,
   `participant_done`, `participant_skipped`, and `participant_error` frame each member;
   `delta`, `reasoning`, and `usage` carry `participant_id`. One terminal `done` event
   carries the authoritative `user_message` plus `assistant_messages[]` in speaking
   order. The single-chat stream is untouched.

6. **Group v1 answers from the transcript only.** Member requests are built with the
   existing prompt composer and frozen snapshots but with Gateway tools disabled, so a
   group turn cannot recursively execute `web_search`/`web_fetch`/memory tools per
   member yet. Memory retrieval still resolves per member against that member's visible
   groups.

## Consequences

- Group transcripts reconstruct fully after reload, including speaker identity; single
  chat behavior, storage layout, and SSE consumers are unaffected.
- Character edits do not propagate into an existing group, matching the ADR-0005
  snapshot policy. Upgrading a group to newer character revisions is future work.
- Per-member tools, participant editing after creation, and participant accent colors
  stored on the profile are explicitly deferred; accent colors are currently a
  frontend-side palette indexed by roster position.
- The Engine must migrate existing databases forward with a non-idempotent
  `ALTER TABLE`; the migration-replay smoke test drops the new columns before replaying
  later migrations.
