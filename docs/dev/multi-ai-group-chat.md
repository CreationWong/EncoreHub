# Multi-AI group conversations

Developer reference for the multi-participant conversation feature
("多 AI 对话" workspace app). Architecture decisions live in
[ADR-0011](../adr/0011-multi-participant-conversations.md).

## Data model

| Location | Field | Meaning |
| --- | --- | --- |
| `conversations` | `reply_mode` | `sequential` (default) or `smart` |
| `conversation_participants` | `position`, `character_id`, `character_version`, `name`, `avatar`, `description`, `system_prompt`, `opening_message`, `tags_json`, `provider`, `model` | Frozen roster row per member |
| `messages` | `sender_character_id` | Group member that produced an assistant message |

Single-character conversations have no roster rows and keep using the legacy
`character_*` snapshot columns. The first group member fills those columns too,
so per-conversation memory-mode resolution (`conversation_character_memory_modes`)
and existing rendering paths keep working.

Engine APIs: `POST /api/conversations` accepts `participants[]` plus
`reply_mode`; `GET /api/conversations/:id` returns both; `PATCH` accepts
`reply_mode`. `POST /api/conversations/:id/turns/:turn_id/finalize` accepts
`assistants[]` (each with `sender_character_id`) and returns
`assistant_messages[]`. `POST /api/conversations/:id/memory-mode/resolve`
accepts an optional `?character_id=` for a specific member.

## Gateway endpoint

`POST /api/v1/conversations/:id/group-chat` (see
`gateway/internal/handler/group_chat.go`):

1. Load the conversation; reject when it has fewer than two participants.
2. Select speakers: explicit `mentions[]` ids win; otherwise parse `@<name>`
   from the content; otherwise the roster answers according to `reply_mode`.
3. Resolve each selected member's adapter and API key (`X-<Provider>-Key` header,
   then the Engine vault). A missing key fails the request before any turn is
   created. The CORS middleware reflects the preflight `X-<Provider>-Key`
   headers for allowed origins so one request can carry a key per member
   provider.
4. Persist the user turn once, then stream each member sequentially. Later
   members see earlier replies from the same turn in their prompt history.
5. Finalize the turn once with every reply, preserving speaking order.

### SSE contract

| Event | Payload |
| --- | --- |
| `turn_started` | `{ user_message }` |
| `participant_started` | `{ participant_id, name, avatar, provider, model, position }` |
| `delta` / `reasoning` | `{ content, participant_id }` |
| `usage` | `{ input_tokens, output_tokens, participant_id }` |
| `participant_done` | `{ participant_id, content, reasoning }` |
| `participant_skipped` | `{ participant_id }` (smart mode declined) |
| `participant_error` | `{ participant_id, message }` (member failed, turn continues) |
| `done` (terminal) | `{ user_message, assistant_messages[], usage }` |
| `error` (terminal) | `{ code, message, user_message?, assistant_messages? }` |

`participant_done` is a streaming boundary; the authoritative persisted message
is only available in the terminal `done`/`error` payload, matching ADR-0003.

## Reply modes

- **Sequential** — every selected member answers in roster order.
- **Smart** — every selected member is asked to answer; the Gateway appends a
  `[[NO_REPLY]]` instruction and drops any reply that is exactly that sentinel.
- **Mentions** always override the mode and select only the addressed members.

## Frontend

- Workspace tab: `multi-chat` (`workspaceStore`, `GlobalNav`,
  `WorkspaceSurface`, `WorkspaceLauncher`); the surface is lazily imported to
  stay outside the initial JS bundle.
- `frontend/src/components/multichat/` — workspace shell, group creation
  dialog, transcript view, composer with an `@` member menu.
- `frontend/src/stores/multiChatStore.ts` — group list, active transcript,
  per-member streaming segments.
- `frontend/src/services/groupChat.ts` — SSE client for the endpoint above;
  `frontend/src/services/conversation.ts` — roster/reply-mode DTOs.

## Deferred work

- Gateway tools (web search, web fetch, memory tools) inside group turns.
- Editing the roster of an existing group; upgrading snapshots to newer
  character revisions.
- Participant accent colors persisted on the character profile instead of the
  frontend palette.
