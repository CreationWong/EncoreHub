# EncoreHub Remaining Work

> Last updated: 2026-07-30.
> This is the single backlog document. Completed phase plans, reports, and UI baseline evidence were removed from docs after their remaining items were folded here.

## 1. Release And Platform Validation

- [ ] Run Windows, macOS, and Linux install-after-build smoke tests.
- [ ] Confirm Windows startup does not show a terminal window and long-running child processes do not block shutdown.
- [ ] Confirm Tauri debug startup health: gateway readiness returns OK, developer panel reports engine alive, and real chat works end to end.
- [ ] Confirm packaged installers keep mutable app data and logs outside the install directory.
- [ ] Run target viewport, light/dark theme, keyboard, IME, focus-return, long CJK text, and reduced-motion UI checks.
- [ ] Generate one final visual comparison record before merging the UI branch into main.
- [ ] Run the full repository gate on the merge candidate: frontend bundle budget, full tests, OpenAPI/docs contracts, and secret log canary.

## 2. CUI-12 Tavern / SillyTavern Character Card Adapter

- [ ] Fix the supported character-card versions and field mapping in a small contract document.
- [ ] Add public-license sanitized sample fixtures.
- [ ] Implement JSON parser/serializer.
- [ ] Implement PNG metadata reader/writer.
- [ ] Route JSON and PNG import through one validation pipeline.
- [ ] Enforce file size, image size, text length, nesting depth, and decompression/parsing resource limits.
- [ ] Show import preview with version, unknown extensions, and same-name conflict handling; default to creating a new character.
- [ ] Export as explicit JSON or PNG, preserving unknown fields and extensions for round trip.
- [ ] Block scripts, HTML, remote resources, and tool-authorization instructions embedded in cards.
- [ ] Add regression tests for corrupted PNG, malformed base64, duplicate metadata, unknown versions, and over-limit content.

## 3. Conversation Context And Long-Chat Intelligence

- [ ] Build a context constructor that accepts a conversation plus token budget and returns the provider message sequence.
- [ ] Add rolling summaries: compress old turns into a summaries table while preserving the latest raw turns.
- [ ] Wire gateway chat to use the engine context constructor instead of sending full history.
- [ ] Validate more than 50-turn conversations avoid provider token-limit failures.
- [ ] Make summaries visible and auditable.
- [ ] Cover token-budget boundaries with conversation crate tests.

## 4. Data Services Capability Activation

- [ ] Select embedding stack, dimensions, CPU/GPU requirement, model size, and license; record the decision.
- [ ] Split data-services into embedding, parsing, rag, and shared schemas.
- [ ] Implement POST /embed for batched text-to-vector conversion.
- [ ] Implement POST /parse for PDF, Word, Markdown, and HTML bytes to text plus metadata.
- [ ] Implement POST /chunk with overlap-aware text chunking.
- [ ] Replace placeholder tests with real pytest coverage.
- [ ] Keep ruff, mypy, and pytest meaningful in CI.

## 5. Vector Search And RAG

- [ ] Initialize LanceDB tables for memories_vec and knowledge_chunks_vec using the selected embedding dimension.
- [ ] Embed and insert vectors during memory and knowledge writes.
- [ ] Implement query embedding and nearest-neighbor top-k lookup.
- [ ] Replace search_memories and search_chunks stubs with vector plus FTS5 hybrid retrieval.
- [ ] Upgrade gateway RAG injection to use semantic top-k context.
- [ ] Add integration coverage for ingest to query.
- [ ] Validate synonym hits, mixed lexical/semantic recall, and duplicate removal.

## 6. Contract And Documentation Alignment

- [ ] Decide proto future: wire buf generate, or move proto files to a frozen future/parking area.
- [ ] Sync CLAUDE.md with the current data-services role, engine crate list, conversation module, provider adapter fields, and desktop storage/log paths.
- [ ] Update the architecture diagram for current UI workspace, settings workspace, character profile flow, and future vector plus FTS5 RAG.
- [ ] Re-check small OpenAPI, markdown local links, and key command smoke after doc cleanup.

## 7. UI Polish Backlog To Revalidate

- [ ] Add skeleton loading states for lists and panels.
- [ ] Add assistant message action bar for copy, regenerate, and quote once turn semantics are stable.
- [ ] Keep code block copy button consistently available.
- [ ] Revalidate conversation list grouping and selected-state accent after the browser-style workspace changes.
- [ ] Add composer progress indicator with warning color near input limits.
- [ ] Revalidate Slash tool menu icons, keyboard navigation, ARIA roles, and mobile placement as more LLM tools are registered.
- [ ] Revalidate compact and drawer behavior for windows below 768px after settings moved into workspace tabs.

## 8. Release Governance

- [ ] Close or explicitly accept all remaining P0/P1 report risks with evidence or ADRs.
- [ ] Confirm every remaining WF/CUI item has either implementation evidence, a deferral note, or a backlog entry in this file.
- [ ] Keep platform claims aligned with actual smoke-test evidence.
