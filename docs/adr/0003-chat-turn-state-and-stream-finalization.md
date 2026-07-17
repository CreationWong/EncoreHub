# 0003 - Chat turn state and stream finalization

* **Status**: Accepted
* **Date**: 2026-07-16
* **Decision makers**: Project lead

## Context

The chat path currently has three competing sources of truth. The Gateway
persists the user before provider validation, persists the assistant in a
background goroutine, and emits an empty SSE `done` frame before that write is
known to have succeeded. The Frontend creates final-looking message IDs and
removes the optimistic user on errors, while SQLite may already contain it.
Tool rounds also overwrite content and usage instead of accumulating them.

The result is different state before and after reload for missing keys,
provider failures, interrupted streams, user Stop, and Engine write failures.

## Decision

### Turn identity and state

The persisted user message is the turn root and its message ID is the turn ID.
Every message has a status:

```text
pending -> completed | failed | stopped
```

Existing and non-chat messages migrate as `completed`. New user turn roots are
created as `pending`. Terminal states are immutable. A terminal assistant
message, when present, uses the same terminal status and points to the user
message through `parent_id`.

### Failure and Stop semantics

- Provider/key/model/request validation happens before a turn is created.
- After a pending turn exists, provider failure keeps the user message and
  marks the turn `failed` so the failure remains auditable after reload.
- If a failed stream produced partial assistant content, reasoning, or tool
  calls, that partial assistant is persisted with `failed` status.
- User Stop persists the partial assistant, if any, and marks both messages
  `stopped`. A Stop before any assistant output still marks the user turn
  `stopped`.
- If Engine finalization fails, Gateway must not emit a success `done` event.
  It emits a structured error and makes a bounded best-effort attempt to mark
  the pending turn failed.

### Persistence boundary

Engine owns the atomic finalization transaction. In one SQLite transaction it
inserts the optional assistant, inserts every tool call, updates the user turn
to its terminal status, and updates the conversation timestamp. Gateway waits
for this transaction before returning JSON or emitting SSE `done`.

Normal Engine calls inherit the request context and an explicit timeout.
Cancellation cleanup derives a context from the request with cancellation
removed and adds a short timeout, so Stop can be persisted without creating an
unbounded background operation.

### SSE and usage contract

- `turn_started` carries the persisted pending user message. Frontend replaces
  its optimistic ID immediately.
- Each `usage` event is the delta for one provider round. Gateway and Frontend
  add the deltas; neither treats the latest event as cumulative.
- Gateway concatenates visible content and reasoning from every tool round.
- `done` is emitted only after Engine finalization and carries the authoritative
  user message, assistant message, and accumulated usage.
- `error` data is always JSON. It contains a stable code and safe message, plus
  authoritative persisted messages when available; provider text can never
  inject an SSE frame.

Frontend never manufactures final message IDs, token counts, or terminal
statuses. After error or local Stop it reloads the conversation until the turn
is terminal, then replaces streaming scratch state with Engine state.

## Consequences

- A provider failure remains visible after reload instead of disappearing and
  later returning as a ghost message.
- Stop and partial failure consume storage, but become retryable and auditable.
- Engine gains a schema migration and an atomic finalize-turn endpoint.
- Gateway and Frontend SSE types change together; legacy empty `done` frames
  are not an authoritative success signal.
- Hidden automatic title generation remains best effort and is not part of the
  turn transaction.

## Alternatives rejected

- **Delete the user message on every failure**: loses auditability and races
  with reload/disconnect handling.
- **Separate `chat_turns` table**: duplicates identity already represented by
  the user message and adds joins without a current multi-assistant use case.
- **Persist after sending `done`**: keeps the acknowledged-write loss window.
- **Let Frontend upload partial content on Stop**: makes the renderer a second
  authority for persisted model output.

## Related work

- `docs/IMPROVEMENT_REPORT.md` P1-2 and P2-2
- `docs/IMPROVEMENT_WORKFLOW.md` WF-06
- ADR-0002, HTTP/JSON remains the inter-service transport
