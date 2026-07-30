# 0005 - Versioned character profiles and conversation snapshots

* **Status**: Accepted
* **Date**: 2026-07-29
* **Decision makers**: Project lead

## Context

EncoreHub originally projected one "Default character" from the selected
Provider and Model. That projection could not own a reusable character prompt,
support Tavern-compatible data later, or explain which prompt revision produced
an historical conversation. Reading a mutable character row on every chat turn
would silently change old conversations and make provider requests unauditable.

Character content is user-controlled. It may contain text that resembles tool
authorization, safety overrides, or EncoreHub's own prompt delimiters. Such text
must never expand the tools registered by Gateway code or replace application
constraints.

## Decision

### Engine authority and version history

Engine owns `CharacterProfile`. The code and API use `character_id` rather than
`role` so the entity cannot be confused with `Message.role`.

Every accepted edit increments `version` and writes an immutable
`character_profile_versions` row. Character deletion is soft deletion: deleted
profiles disappear from active CRUD results, while their version records and
historical Conversation snapshots remain. The stable `default` profile is
created by migration and cannot be deleted.

### Conversation snapshots

Conversation creation reads one active character revision and atomically stores:

- `character_id` and `character_version`;
- name, avatar, description, system prompt, opening message, and tag snapshots;
- the final Provider and Model after explicit conversation selection or
  character defaults are resolved.

Chat requests use only this stored snapshot. Editing a CharacterProfile affects
new Conversations, never existing ones. A separate preview endpoint compares an
old snapshot with the current profile; applying that upgrade requires the
caller's expected character version and replaces the snapshot in one
transaction.

### Prompt trust order

Gateway composes provider system prompts in this order:

1. application constraints;
2. untrusted character content from the Conversation snapshot;
3. Skill instructions;
4. Memory and Knowledge context;
5. tool instructions.

Each non-empty segment has an explicit boundary. Reserved boundary markers in
user-controlled segments are escaped. Character text can influence the answer's
content and tone, but the available tool collection is built independently by
Gateway code. Follow-up requests remove tools in code and replace only the final
trusted tool section.

React accesses CharacterProfile and upgrade APIs through Gateway. It never calls
Engine directly and does not compose authoritative prompts.

## Consequences

- Historical Conversations remain reproducible after character edits or
  deletion, at the cost of duplicated prompt text in SQLite.
- Character updates and Conversation upgrades use optimistic version checks;
  clients must handle HTTP 409 and reload before retrying.
- The default character gives pre-migration Conversations a valid association
  without changing their Provider, Model, or messages.
- CUI-11 can build management UI against stable service/store contracts, and
  CUI-12 can add Tavern adapters without changing the Conversation audit model.
- Prompt segmentation improves reviewability but is not treated as a model-side
  security sandbox; actual authority remains in code-controlled tool
  registration and application policy.

## Alternatives rejected

- **Use Provider/Model as a character identity**: cannot own prompt versions or
  survive model changes.
- **Read the latest profile on every turn**: silently mutates historical
  behavior and breaks auditability.
- **Copy only `character_id` onto Conversation**: still requires mutable reads
  and loses behavior after deletion.
- **Allow character text to declare tools**: turns imported/user-authored data
  into an authorization channel.
- **Hard-delete profiles and cascade Conversations**: destroys user history.

## Related work

- [Remaining work](../REMAINING_WORK.md) tracks character-card compatibility and
  final UI validation.
- [EncoreHub OpenAPI](../openapi.json) is the browser-facing CharacterProfile
  and upgrade contract.
- [ADR-0004](0004-engine-in-process-and-internal-auth.md) keeps Engine behind the
  authenticated Gateway boundary in desktop and standalone modes.
