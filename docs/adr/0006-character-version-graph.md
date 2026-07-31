# 0006 - Explicit character version graph

* **Status**: Accepted
* **Date**: 2026-07-30
* **Decision makers**: Project lead

## Context

ADR-0005 made every character edit an immutable version. That behavior turned
routine saves into noisy history and could not represent parallel character
directions. Users need deliberate checkpoints, restoration, and branches while
retaining the immutable Conversation snapshots defined by ADR-0005.

## Decision

Each CharacterProfile is a mutable working copy with two independent counters:

- `revision` is the optimistic lock and increments on every accepted working
  copy change;
- `version` identifies the immutable version node currently loaded as the
  working copy base.

Saving edits updates only the working copy and its `revision`. Creating a
version is an explicit operation with a required message. It creates the next
character-wide version number, records its parent and active branch, and moves
that branch head. New characters start with Version 1 on `main`.

A branch is a named ref created from any immutable version. Creating it also
checks it out and loads that version into the working copy. Restoring a version
loads its content into the current working copy without deleting nodes or
implicitly creating a new node. A later explicit version can therefore form a
new edge from the restored node.

Engine owns graph mutations and performs them transactionally. Gateway proxies
the routes, and the client presents all character histories as one global tree.
Conversation snapshots and explicit Conversation upgrades retain ADR-0005's
semantics.

## Consequences

- Routine saves no longer pollute character history.
- Branch heads and parent links preserve alternate directions without copying
  entire characters at the UI layer.
- Clients use `revision`, not `version`, for profile mutation conflicts.
- Restoring changes the working copy and increments `revision`; it never
  rewrites immutable history.
- Version numbers are unique within one character, while branch names are
  unique within that character.

## Related work

- [ADR-0005](0005-character-profile-snapshots.md) defines immutable
  Conversation snapshots and prompt trust ordering.
- [EncoreHub OpenAPI](../openapi.json) defines the working-copy and history
  routes.
