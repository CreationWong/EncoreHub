# ADR-0012: Asynchronous group runner, personas, and user commands

- **Status**: Accepted
- **Date**: 2026-09-19
- **Deciders**: EncoreHub maintainers
- **Related**: ADR-0011 (multi-participant conversations), ADR-0003 (chat turn state)

## Context

ADR-0011 shipped a synchronous group turn: one HTTP request walked the roster,
streamed each reply, and finalized a single Engine turn. That model cannot
express what the product now needs:

- bots that address each other or the user with `@name`, so a discussion can
  continue without new user input;
- user messages that keep generating after the client disconnects (the app may
  be closed while a discussion is still being answered);
- user-only controls to stop or pause the discussion;
- per-group human identity (name, avatar, description) and autonomy settings
  with global defaults.

A request-scoped SSE stream also means the client is the scheduler: closing the
tab stops the group, and two clients cannot observe the same conversation.

## Decision

1. **The queue is the scheduler.** `conversation_queue_items` persists every
   pending turn with a source-derived priority: `mention` (0) > `user` (1) >
   `auto` (2). Items survive restarts; claims left by a crashed runner are
   requeued after a stale threshold.

2. **One background runner per conversation** lives in the Gateway. It claims
   the highest-priority item, generates the answering members, appends their
   replies, and turns `@mentions` in those replies into new mention items. The
   runner uses Engine vault keys only: background work never reads provider
   credentials from an HTTP request. It retires after five idle minutes; the
   queue re-arms it when a client watches the conversation or a message lands.

3. **Async turns append instead of finalizing a chat turn.** The user message
   is persisted at enqueue time, and each generated reply is appended with
   `parent_id` pointing at the previous transcript message. The ADR-0003 turn
   state machine keeps owning the synchronous single-chat flow; group turns no
   longer create pending user roots.

4. **Events replace the long request.** `POST /group-messages` returns 202 with
   the persisted user message; `GET /group-events` is an SSE subscription to
   the runner (`message_appended`, `participant_*`, `runner_state`,
   `queue_updated`). The synchronous `POST /group-chat` endpoint stays until the
   desktop client migrates.

5. **Commands are user-only by construction.** Only content entering through
   `POST /group-messages` is command-parsed; AI output never reaches that
   handler. `/stop` cancels the in-flight generation, clears the queue, and
   pauses the group; `/pause` and `/resume` toggle the pause flag. Commands
   leave a language-neutral system note (`/stop`).

6. **Settings layer globally and per group.** The global
   `group_chat_settings` config value is the template for new groups;
   each conversation stores a full `group_settings` object (auto chat,
   max auto turns — `null` means unlimited, `0` means user-only, bot mentions,
   pause flag, user persona). Character snapshots stay frozen per member.

## Consequences

- Groups keep talking while no client is connected; the desktop client becomes
  a viewer rather than the scheduler.
- The auto-turn counter is in-memory, so a runner restart resets the chain
  budget. Persisting it is deliberate future work.
- Provider failures surface as `participant_error` events without stopping the
  remaining members; a fully failed item is completed rather than retried.
- The synchronous endpoint and the async pipeline coexist until the frontend
  switches; the sync path remains the compatibility surface.
