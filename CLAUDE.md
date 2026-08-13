# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

EncoreHub is an AI chat desktop app aggregating multiple AI providers (OpenAI, Anthropic, DeepSeek, Claude), with knowledge base, memory, skills, plugins, and MCP capabilities. Status: active development; core chat, web search, token counting, local Knowledge/Memory vector retrieval, file upload, and auto-generated conversation titles are complete; hybrid ranking and the WASM sandbox remain on the roadmap. Windows, macOS, and Linux compile/no-bundle CI is required, but no platform is advertised as release-supported until its installed-app smoke passes.

```
frontend (React + Tauri 2) --HTTP/SSE--> gateway (Go) --HTTP--> engine (Rust, axum)
       |                                        |                   |
       |  Tauri loads Engine Runtime             |  multi-provider   |  SQLite + SQLite-Vec
       |                                        |                   |  local LanceDB (primary knowledge)
       |  (.dll/.so/.dylib); Gateway             |  adapters         |  AES-256-GCM secret crypto
       |  remains a sidecar                      |                   |  conversation crate (token)
```

In the **desktop app** the engine still runs in the desktop process, but the
Tauri executable loads it from the versioned Engine Runtime dynamic library
instead of statically linking it. The gateway remains a child-process sidecar.
HTML extraction is provided by a separately packaged RUSTScrapling dynamic
library; Curl remains inside Engine Runtime as the network and SSRF boundary.
The engine also builds as a **standalone binary** (gated by the `standalone`
Cargo feature) for headless deployment, pure-web dev, and CI. See
[ADR-0004](docs/adr/0004-engine-in-process-and-internal-auth.md) and
[ADR-0008](docs/adr/0008-versioned-desktop-runtime-modules.md).

Ports are negotiated at startup: in Tauri/client mode `find_free_port()` scans
from 10000 upward; in headless/dev mode the env vars `ENGINE_BIND` / `LISTEN_ADDR`
(or their defaults `:3000` / `:8080`) take precedence. The frontend receives
only the actual Gateway port via the `get_service_ports` Tauri command.

## Conventions

- Commit messages: English, format `type(scope): description` (e.g. `fix(engine): handle empty conversation list`)
- No copyright headers on new files
- Before modifying auth-related code, flag the security implications explicitly
- Never log or comment API keys, tokens, or secrets — treat them as opaque strings
- Before writing code for non-trivial changes, briefly explain the approach; when multiple valid approaches exist, present them as options
- **Go: never use `any` in struct fields that will be JSON-serialized to external APIs.** `encoding/json` marshals `[]byte` as base64, which causes API rejections when the field is expected to be a JSON object. For function parameters/schemas passed to AI providers, use typed maps (`map[string]any`) or concrete structs. `json.RawMessage` is `[]byte` — it will be base64-encoded, not inlined.
- Frontend UI: use semantic color tokens (`success`/`warning`/`danger`/`info` + `-bg`/`-border` variants, defined in `styles/globals.css`, wired through `tailwind.config.js`) — never hardcode Tailwind palette colors like `red-400`
- Frontend errors/feedback: surface via the global toast store (`stores/toastStore.ts` — `toast.success/error/info`), not inline error bars
- Frontend a11y: icon-only buttons must carry an `aria-label`; keyboard focus uses the global `:focus-visible` ring (no per-component focus styling needed)

### Dependency Policy

- Use the language standard library, browser APIs, and platform-native APIs first. Do not add a dependency for basic formatting, parsing, collection operations, file or process handling, hashing wrappers, retries, small state helpers, or ordinary UI composition when the existing runtime can implement it clearly and safely.
- A new third-party dependency must provide substantial behavior that will be reused by multiple modules, features, or workflows. Adding one or more packages solely to implement one simple feature is prohibited by default.
- Do not adopt a "one feature, one dependency" design. Before adding a package, document its consumers, why the standard library or an existing dependency is insufficient, maintenance and security implications, and the removal boundary.
- Exceptions require an explicit technical justification. Valid examples include security-reviewed cryptography, standards-compliant protocol or document parsers, complex domain engines, database or platform integration, or deliberate redundancy and fallback required for reliability.
- Prefer an already-approved project dependency when it fits the requirement without weakening correctness or creating inappropriate coupling. Do not add overlapping libraries that solve the same problem without a documented migration or fallback plan.
- Remove a dependency when its last real consumer is removed. Generated manifests and lockfiles must be regenerated in the same change.
- Apply this policy equally to production code, tests, build scripts, code generation, and developer tooling.

### Code Comments and Change History

These requirements apply to every repository-owned code file, including source code, tests, build scripts, and configuration expressed as code. Generated files and vendored third-party code are exempt and must not be edited merely to add comments.

- **Every code file must begin with a file header comment** that states the file's responsibility and, when useful, its important ownership or architectural boundary. Use the language's conventional comment syntax. Do not use copyright boilerplate as the file header.
- **Every function, method, class, interface, and other public or non-trivial declaration must have a documentation comment** in the language's standard style: JSDoc/TSDoc for JavaScript and TypeScript, doc comments for Rust and Go, docstrings for Python, and the closest equivalent in other languages. Document intent, contracts, side effects, invariants, failure behavior, or non-obvious constraints instead of restating the signature.
- **Use ordinary single-line comments for local explanations.** Comments should explain why a decision exists, what invariant is protected, or why an apparently simpler implementation is unsafe. Reserve block comments for documentation syntax or explanations that genuinely require multiple lines.
- **Comment coverage must be at least 40% in each individual code file.** Calculate this as comment lines divided by non-blank code lines, using the repository's comment-coverage tooling when available. Documentation-comment lines, meaningful file-header lines, and meaningful single-line comments count; blank comment lines, disabled code, generated text, and comments that merely paraphrase the next statement do not count. The requirement is per file and cannot be satisfied by averaging across the repository.
- **Never add line-by-line narration.** Reject comments such as `increment counter`, `return result`, or prose that simply translates the syntax. If the code is already self-explanatory, document the surrounding contract or design reason rather than narrating each operation.
- **Never leave conversation or refactoring-history artifacts in code comments.** Prohibited examples include `← 新增`, `新版`, `旧版`, `已迁移至`, `temporary fix`, references to an Agent/user conversation, or notes describing how the code differed before the current change. Git and `CHANGELOG.md` own history; comments describe the current system only.
- **Review comments whenever behavior changes.** Update or remove stale comments in the same change, and treat inaccurate documentation as a defect.
- **Update `CHANGELOG.md` for every new version, broad code update, or foundational refactor.** Record the user-visible or architectural outcome under the appropriate release and category. Do not use source comments as a substitute for the changelog, and do not add changelog entries for trivial comment-only or formatting-only edits.

#### Changelog Policy

- Follow [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).
- Keep exactly one `## [Unreleased]` section at the top of the release history. Never add a date or version number to `Unreleased`.
- Use release headings in the form `## [MAJOR.MINOR.PATCH] - YYYY-MM-DD`. Dates are UTC and use ISO 8601 calendar format.
- Use only the applicable standard categories, ordered as `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`. Omit empty categories and never duplicate a category within one release.
- Write entries for users and maintainers: describe the observable behavior, compatibility impact, security outcome, or architectural boundary. Do not use commit-message fragments, implementation diaries, development-session summaries, or issue-status narration.
- Keep each change in exactly one best-fit category. Put bug fixes in `Fixed`, including fixes discovered by tests; do not create a `Tests` category for test counts or coverage snapshots.
- Do not record routine formatting, comment-only edits, generated-file refreshes with no behavioral impact, or other internal churn unless they materially affect consumers or release operations.
- When cutting a release, move the relevant entries from `[Unreleased]` into a new versioned section and leave a fresh `[Unreleased]` section in place. Never rewrite the contents of an already published release except to correct factual errors.

#### Component Version Policy

- Version `frontend`, `gateway`, and `engine` independently. Their authoritative declarations are `frontend/version.json`, `gateway/internal/buildinfo/version.json`, and `engine/version.json`; do not derive one component's application version from Cargo, npm, or Tauri package versions.
- Mirror each component's public three-part version into its ecosystem metadata whenever `MAJOR`, `COMPATIBILITY`, or `FEATURE` changes: Frontend updates the root/frontend npm manifests plus Tauri package/config metadata, and Engine updates its Cargo workspace metadata. Cargo/npm/Tauri cannot represent the fourth `PATCH` tier, so patch-only mainline rolls must leave ecosystem versions unchanged. Refresh affected lockfiles in the same change.
- Use `VMAJOR.COMPATIBILITY.FEATURE.PATCH` for component versions. `MAJOR` is a formal release generation changed only by an explicit developer decision. Increment `COMPATIBILITY` for compatibility, security, or major-feature changes; increment `FEATURE` for ordinary features, removals, UI changes, and bug fixes; reset every less-significant tier after either manual increment.
- Treat `PATCH` as the mainline commit counter. Pushes to `main` or `master` automatically increment it only for affected components; shared release/build infrastructure increments all components. Version-roll commits must not recursively trigger another roll.
- Generate every build ID as UTC `yyMMdd` followed by the final six digits of Unix epoch seconds. All components produced by one build share one Build ID, and every UI, diagnostic, manifest, health response, and startup log that displays a version must also display its Build ID.
- In formal user-facing UI, display `VMAJOR.COMPATIBILITY.FEATURE (Build BUILD_ID)`. Display the full four-part version only in debug/developer mode, errors, and logs: `VMAJOR.COMPATIBILITY.FEATURE.PATCH (Build BUILD_ID)`. The Build ID is never hidden.
- Each component must declare half-open compatible ranges (`min <= peer < max_exclusive`) for both peers. Startup/readiness must verify compatibility bilaterally: each component must accept the other's exact four-part version. Missing, malformed, or mutually incompatible metadata is a startup failure, not a retryable readiness state.
- Use `pnpm version:show`, `pnpm version:bump -- COMPONENT TIER`, and `pnpm version:auto -- --base REF --head REF` for version operations. Do not edit compatibility ranges as a side effect of a tier bump; compatibility policy changes require deliberate review.

Before completing a code change, verify that every touched code file has a meaningful file header, uses standard documentation comments for functions and declarations, meets the 40% per-file comment coverage threshold, contains no line-by-line narration or process-history artifacts, and includes a `CHANGELOG.md` entry when the change qualifies.

## Component Map

| Module | Language | Role | Status |
|--------|----------|------|--------|
| `frontend/` | TypeScript + React 18 + Tauri 2 | Desktop UI, streaming, settings/skill/memory/knowledge panels, slash commands, auto-generated conversation titles, token counting display | ✅ Active development |
| `gateway/` | Go 1.25 (Gin) | HTTP/SSE entry, multi-provider adapter, auth/rate-limit/CORS, reverse proxy to engine, web search integration | ✅ Complete with provider adapters |
| `engine/` | Rust (axum + tokio + rusqlite + LanceDB) | Conversations, attachments, native document parsing, Memory/Knowledge retrieval, skills, token counting, encryption, and port negotiation | ✅ Core functionality complete |
| `proto/` | protobuf | gRPC schema for inter-service communication | ⏳ Schema complete, gRPC not yet enabled |

Why this language split: see [ADR-0001](docs/adr/0001-language-split.md).

## Essential Build & Test Commands

### Prerequisites

Node 22+ / pnpm 10 / Go 1.25 / Rust stable. The standard build scripts resolve a vendored Protocol Buffers compiler when `PROTOC` and PATH do not provide one; direct Cargo commands must set `PROTOC`. Pandoc is optional for high-fidelity rich-text conversion.

### Development (all from repo root)

```bash
pnpm setup
pnpm dev       # prepare Engine Runtime and Gateway, then start Tauri
```

Root `package.json` scripts are the canonical workspace entrypoint:
```
pnpm check         # workspace contracts + static checks
pnpm build         # standalone Engine + Gateway + Frontend
pnpm test          # all component tests
pnpm test:docs     # Markdown links, OpenAPI/routes, ADR and command contracts
pnpm lint          # all component lint gates
pnpm format        # Biome + rustfmt + gofmt
pnpm build:desktop # current-platform Tauri bundle
pnpm build:components -- --components engine,gateway --release # selected modules
```

The Makefile is a compatibility shim that delegates to these scripts; do not add build logic there.

### Per-component commands

**Frontend** (`cd frontend`):
| Command | What |
|---------|------|
| `pnpm dev` | Vite dev server (port 1420) |
| `pnpm check` | TypeScript type check without build output |
| `pnpm build` | `tsc && vite build` → `dist/`, then enforce the 300 KiB initial-JS gzip budget |
| `pnpm analyze:bundle` | Build and write chunk/module plus initial-load reports to `dist/` |
| `pnpm bundle:check` | Recheck `dist/.vite/manifest.json` against `BUNDLE_BUDGET_KIB` (default 300) |
| `pnpm tauri dev` | Tauri desktop dev |
| `pnpm tauri build` | Tauri desktop production build — generates `.msi` and `.exe` installer |
| `pnpm test` | Vitest (jsdom, `src/**/*.test.{ts,tsx}`) |
| `pnpm test:bundle` | Node contract tests for the static-closure budget calculation |
| `pnpm lint` | Biome check `src/`, bundle/docs contract scripts, and Vite config |
| `pnpm lint:fix` | Biome auto-fix |

**Gateway** (`cd gateway`):
| Command | What |
|---------|------|
| `go run ./cmd/gateway` | Run gateway |
| `go test ./...` | Run all tests |
| `go vet ./...` | Static analysis |
| `go build -trimpath -ldflags="-s -w" -o bin/encorehub-gateway ./cmd/gateway` | Release build |
| `golangci-lint run ./...` | Lint |

**Engine** (`cd engine`):

The engine compiles in two modes via the `standalone` Cargo feature. Without it
the crate is library-only and is linked into `encorehub-desktop-runtime`; with
it the `encorehub-engine` and `encorehub-mcp` binaries are built. Run/build
commands that need an actual executable must pass `--features standalone`.

| Command | What |
|---------|------|
| `cargo run --features standalone --bin encorehub-engine` | Run engine standalone |
| `cargo test` | Run all tests (library mode) |
| `cargo test --features standalone` | Run all tests with the binaries compiled |
| `cargo clippy --all-targets --features standalone -- -D warnings` | Lint |
| `cargo fmt --check` | Format check |
| `cargo build --release --features standalone` | Release build (produces both binaries) |
| `cargo test -p encorehub-conversation` | Run token counter tests only |

### Run a single test

```bash
cd frontend && pnpm vitest run -t "test name pattern"
cd gateway  && go test ./internal/handler -run TestName
cd engine   && cargo test test_name
```

> The engine's integration tests build in library mode; pass `--features standalone` only when a test exercises the binary entrypoints.

## Port Negotiation

- **Tauri / client mode**: When `ENGINE_BIND` and `LISTEN_ADDR` are unset, the Engine Runtime and desktop shell negotiate two free ports on `127.0.0.1` (engine first, gateway next). The gateway sidecar receives `ENGINE_URL` and `LISTEN_ADDR` as env vars. The frontend calls `invoke("get_service_ports")` at startup to resolve only the Gateway port.
- **Headless / dev mode**: Ports always come from env vars (`ENGINE_BIND`, `LISTEN_ADDR`, `ENGINE_URL`) or their defaults (`127.0.0.1:3000`, `:8080`).
- The Tauri `ServiceState` struct stores `engine_port` and `gateway_port`; `check_engine_health` and `check_gateway_health` use them instead of hardcoded ports.
- Frontend `config.ts` exports `applyServicePorts(gwPort)` and Gateway URL getters (`apiBase()`, `gatewayUrl()`, `gatewayLivenessUrl()`, `gatewayReadinessUrl()`) — React never connects directly to Engine.

## Tauri Desktop Packaging

The Tauri v2 config is at `frontend/src-tauri/tauri.conf.json`. Key points when building the installer:

- **Runtime modules**: `tauri.conf.json` -> `bundle.externalBin` references `binaries/encorehub-gateway`; platform overlays package `encorehub_desktop_runtime.dll`, `libencorehub_desktop_runtime.so`, or `libencorehub_desktop_runtime.dylib` under `lib/`, together with the dynamically linked libcurl dependencies declared by `engine-runtime.json`. Runtime launch uses `app.shell().sidecar("encorehub-gateway")`, while the desktop validates the Engine Runtime ABI before resolving lifecycle symbols.
- **Resources and mutable state**: built-in skills are mapped to `resource_dir/skills`. All Desktop mutable state lives under `app_data_dir`: SQLite at `data/encorehub.db` and daily file logs at `log/encorehub-YYYY-MM-DD.log`. Developer-panel exports use a native Tauri command, writing to the OS Downloads directory or `app_data_dir/log` as fallback. The installation directory contains only binaries, runtime libraries, bundled resources, and startup configuration. Startup configuration comes from packaged files, environment variables, or process-memory values and must not be persisted in SQLite. Windows legacy installation-directory `data/` and `log/` remain read-only migration sources, are copy-verified with a marker, and are retained until explicit uninstall.
- **Build scripts**: `pnpm build:desktop` builds Engine Runtime, Gateway, and the current-platform Tauri bundle. `pnpm build:components -- --components <list>` accepts `engine`, `gateway`, `desktop`, `frontend`, and `engine-standalone`; PowerShell/Bash wrappers expose the same selection.
- Build output: MSI at `src-tauri/target/release/bundle/msi/`, NSIS exe at `bundle/nsis/`.
- The Tauri binary itself is at `src-tauri/target/release/encorehub-desktop.exe`.

## Architecture Patterns

### Gateway Middleware Stack

Order is significant: `request-id` → `gin.Logger` → `gin.Recovery` → `CORS` → `rate-limit` → `metrics` → `auth`. Auth is **skipped** when `ENCOREHUB_AUTH_TOKEN` is unset (default local dev).

### Provider Adapter Pattern (Gateway)

All AI providers implement the `provider.Adapter` interface (`gateway/internal/provider/adapter.go`):
- `Chat(ctx, req, apiKey) → *ChatResponse`
- `ChatStream(ctx, req, apiKey) → <-chan StreamEvent`
- `ListModels(ctx, apiKey) → []ModelInfo`
- `ValidateKey(ctx, apiKey) → error`

Concrete adapters live in `gateway/internal/provider/{openai,anthropic,deepseek}/`. The `provider.Registry` maps provider IDs to adapters.

The unified `ChatRequest` type includes: `Model`, `Messages`, `Stream`, `MaxTokens`, `MaxCompletionTokens`, `Temperature`, `TopP`, `FrequencyPenalty`, `PresencePenalty`, `Stop`, `Seed`, `SystemPrompt`, `JSONMode`, `ReasoningEffort`, `TopK`, `ThinkingBudget`, `Tools` (function tool definitions for model-invokable actions, e.g. `web_search`). Each adapter's `buildRequest()` maps these to provider-native fields.

### Engine Proxy

Gateway proxies `/api/v1/{skills,memories,knowledge}/*` transparently to the Rust engine via `engine.Client` (`gateway/internal/engine/client.go`). Conversations are proxied too, except the chat endpoint (`POST /conversations/:id/chat`) which the gateway handles directly (provider orchestration + SSE streaming).

**CORS header filtering**: The engine proxy at `gateway/internal/handler/engine_proxy.go` skips `Access-Control-*` response headers from the engine to prevent duplicate CORS headers that would be rejected by browsers.

### Token Counting Flow

1. **Gateway** captures `input_tokens` + `output_tokens` from provider SSE `usage` events (or non-streaming response), sends them to the frontend as SSE `event: usage` frames, and persists `token_count` on the assistant message via `engine.AppendMessageRequest.TokenCount`.
2. **Engine** stores `token_count: i32` on each `Message` (core type) and returns it in `MessageResponse`. The `conversation` crate (`engine/crates/conversation/src/token.rs`) provides:
   - `rough_token_count(content, bytes_per_token)` — `content.len() / bytes_per_token` (4 for text, 2 for JSON/JSONL)
   - `estimate_message_tokens(msg)` / `estimate_messages_tokens(msgs)` — per-message/per-conversation estimates including reasoning overhead
   - `token_count_with_estimation(messages, last_usage)` — API-reported usage + rough estimate for new messages since the last API call
   - `exceeds_token_limit(messages, limit, usage)` — threshold check
   - `Usage` struct with `input_tokens`/`output_tokens`/`cache_*` and `total()`
3. **Frontend** `conversationStore.sendMessage()` wires `onUsage` callback, sums input+output, and stores `token_count` on the optimistic assistant message. `MessageBubble` renders the count (e.g. `1.2k tokens` in muted text) next to the "Assistant" label.

### Web Search Flow (Tool-based)

When the user toggles search on (globe icon in the input box):

1. **Gateway** registers a `web_search` function tool on the provider request. The model decides when — and with what query — to invoke it.
2. The provider adapter passes tools via `ChatRequest.Tools` → `go-openai` SDK. The adapter's `toOpenAITools()` maps `provider.Tool` → `goopenai.Tool`, passing `FunctionDefinition.Parameters` as `map[string]any` (**never** `[]byte` — `encoding/json` base64-encodes `[]byte` and providers reject it).
3. **Model returns tool_calls** → gateway's `providerStream()` loop intercepts `web_search`, executes the selected configured Provider without silently switching providers, formats results, builds a follow-up request via `cloneRequestForNextRound()` that appends an assistant message (with `ToolCalls`) and a tool message (with `ToolCallID`), then calls the model again (max 3 rounds).
4. **Frontend** receives `tool_call` and `tool_result` SSE events → `conversationStore` tracks `streamingToolCalls` → rendered in `MessageBubble.ToolCallCard` (collapsed by default, click to expand). The `warning` SSE event triggers `toast.warning()`.
5. Search providers live in `gateway/internal/search/`. DuckDuckGo uses its Instant Answer JSON API; SearXNG and OpenSERP use explicitly configured JSON endpoints. Providers preserve upstream order and only validate URLs, deduplicate, and enforce the result limit. There is no HTML search fallback, CAPTCHA flow, browser automation, client-side relevance score, or silent provider switch.
6. Every provider request uses the authenticated Engine `/api/network/fetch` endpoint. Curl applies redirect, DNS/SSRF, timeout, and response-size policy. Explicitly configured SearXNG/OpenSERP endpoints may target private addresses; DuckDuckGo and `web_fetch` cannot.
7. The same toggle registers `web_fetch` for a specific public URL. Public page reads cannot carry custom headers or cookies. Curl retrieves the page, then the independently packaged RUSTScrapling library strips scripts, styles, and page chrome and bounds readable HTML text. Gateway only retains a plain-text/JSON/XML fallback and marks all page data untrusted.

### Auto-Generated Conversation Titles

- **Manual rename** has highest priority: user-edited titles must not be overwritten by automatic generation
- **Requested rename** uses the `update_conversation_title` tool and shows the tool call/result in chat
- **Automatic title generation** runs as a hidden non-streaming gateway request after the first user message, in parallel with the visible chat response; it emits `title_update` or `title_error` SSE before `done`
- **Gateway** provides `POST /api/v1/conversations/:id/generate-title` for explicit title regeneration (`force: true`) and guarded automatic requests (`force: false`)
- **Engine** stores title updates via conversation PATCH/title update endpoints; it does not own AI title generation
- Automatic generation uses the conversation's configured model and must not automatically switch to a non-reasoning or lighter model; provider-native reasoning disable flags are allowed for the hidden title request (DeepSeek V4 uses `thinking.type=disabled`)
- Limits: Chinese-only ≤20 chars, English-only ≤15 words, mixed Chinese/English ≤15 chars; timeout 30s; 3 retries with redacted metadata-only failure logging
- Titles are displayed in the conversation list and conversation header with edit functionality

### Character Profiles and Prompt Snapshots

- Engine owns versioned `CharacterProfile` records. Use `character_id`; never introduce a character type named `Role` because `Message.role` is the protocol role.
- Every Conversation stores `character_id`, character version, prompt-bearing character snapshot, and final provider/model. Character edits affect only new Conversations.
- Existing Conversations can change character revisions only through the explicit preview/apply upgrade endpoint with an expected-version check.
- Deleted characters are soft-deleted so historical Conversation snapshots remain readable. The migrated `default` character cannot be deleted.
- Gateway composes provider prompts in this order: application constraints -> validated user system date/time/timezone -> character snapshot -> Skill -> Memory/Knowledge -> tool instructions.
- Character, Skill, Memory, and Knowledge text is user-controlled context. It cannot register tools or weaken application constraints; tool availability is decided only by Gateway code. See [ADR-0005](docs/adr/0005-character-profile-snapshots.md).

### Frontend State (Zustand)

- `conversationStore` — active conversation, message list, streaming state (content + reasoning + tool calls), `streamTokenCount` capture, optimistic updates with rollback on failure
- `settingsStore` — provider selection, API keys (session-memory only, not persisted to localStorage by default), settings modal tab; `searchEnabled`/`searchProvider` toggle; `loadKeys()` loads from engine secrets DB with retry/backoff
- `secretsStore` — encryption status (`enabled`/`locked`/`unlocked`), `storedIds` from `list()` (works while locked), `unlock(password)` for inline decryption
- `providerStore` — custom provider profiles (CRUD via engine config API)
- `confirmStore` — promise-based confirmation dialog (`confirm.ask(title, msg, danger?)`); replaces all browser `window.confirm()` calls
- `toastStore` — 4 kinds: `success` / `error` / `info` / `warning`; imperative `toast.*()` helpers

### Slash Tool Requests

Typing `/` opens an LLM-tool completion menu backed by metadata in `frontend/src/tools/slashTools.ts`. This menu must not contain or execute application shortcuts such as settings, new conversation, or clear conversation. Add future LLM tools to the Frontend metadata registry and the trusted Gateway executor registry together.

`/web_search <query>` is an explicit, pre-executed tool request. The Gateway ignores the ordinary web-search toggle and any request-selected provider, resolves the Provider from Engine-backed Web Search Settings, runs the search before generation, and gives the original user message plus untrusted search results to the LLM. The stream emits `tool_call` and `tool_result`, and the final assistant message persists the call. A Slash request cannot register or authorize an unknown tool.

### Engine Crate Structure

The engine is a Cargo workspace with seven crates:
- `crates/core` — shared `EngineError` type and data types (`Message`, `Conversation`, `Memory`, `Role`, `Usage`, etc.)
- `crates/conversation` — token counting (`rough_token_count`, `estimate_message_tokens`, `token_count_with_estimation`, `exceeds_token_limit`, `Usage` struct with total() method)
- `crates/desktop-runtime` — versioned C ABI dynamic library that owns the Engine Tokio runtime and HTTP lifecycle in desktop builds
- `crates/rust-scrapling-runtime` — stable C ABI wrapper around vendored RUSTScrapling, packaged as an independent parser dynamic library
- `crates/protoc-resolver` — vendored cross-platform `protoc` path resolver used by build tooling
- `crates/storage` — SQLite relational/blob storage, SQLite-Vec Memory and fallback indexes, plus embedded LanceDB Knowledge storage
- `crates/skill` — `SkillRegistry` that loads Markdown skills from a directory, with YAML frontmatter parsing
- Built-in skills: `code-explainer`, `summarize`, `web-search` (with dynamic tool support)

The main binary (`src/main.rs`) wires: open SQLite → load skills → install a reloadable tracing subscriber → resolve `ENGINE_BIND` (or default `127.0.0.1:3000`) → call `encorehub_engine::serve(...)`. `serve()` (in `src/lib.rs`) builds the axum router and runs it; it is shared by the standalone binary and `crates/desktop-runtime`, which owns its own Tokio runtime behind the C ABI. `lib.rs` also exports `find_free_port(start_port)` for port negotiation. `main.rs` and `mcp_server.rs` are gated behind `#![cfg(feature = "standalone")]` so the library build skips them. The router is defined in `src/api/mod.rs` and each resource group (conversations, knowledge, memories, skills, plugins, secrets, config) is a submodule.

### Skills Directory

Skills are Markdown files with YAML frontmatter. Desktop loads bundled skills from Tauri `resource_dir/skills`; standalone mode uses `ENCOREHUB_SKILLS_DIR` or its local development default. The engine ships with three built-in skills: `code-explainer`, `summarize`, `web-search`. The web-search skill supports dynamic tool calls for real-time web information retrieval.

### Provider Enhancements

- **Anthropic Claude API**: Full parameter support including `reasoning_effort`, `top_k`, `thinking_budget`, and enhanced sampling parameters
- **Enhanced sampling**: All providers now support `top_p`, `frequency_penalty`, `presence_penalty`, `seed`, `stop`, and `json_mode`
- **Tool calling**: Dynamic tool registration with `web_search` integration and provider-specific tool formatting

## Configuration

**Environment variables** (copy `.env.example` → `.env`):
- `LISTEN_ADDR` / `ENGINE_URL` / `ENGINE_BIND` — service binding and port negotiation (see Port Negotiation section)
- `ENCOREHUB_ENGINE_AUTH_TOKEN` — Gateway-to-Engine bearer token; required in standalone/Docker, generated in memory by Tauri
- `ENCOREHUB_AUTH_TOKEN` — sets bearer auth on gateway (unset = no auth, fine for localhost)
- `ENCOREHUB_CORS_ORIGINS` — comma-separated extra CORS origins
- `ENCOREHUB_RATE_LIMIT_RPS` (30) / `ENCOREHUB_RATE_LIMIT_BURST` (60)
- `ENCOREHUB_RATE_LIMIT_TTL_SECONDS` (600) / `ENCOREHUB_RATE_LIMIT_MAX_CLIENTS` (10000)
- `ENCOREHUB_TRUSTED_PROXIES` — comma-separated proxy IPs/CIDRs; empty disables forwarded client IP trust
- `ENCOREHUB_DEV_MOCK` — set to `1`/`true` to enable mock replies without an API key (dev only)
- `ENCOREHUB_LANCEDB_PATH` — optional local LanceDB directory override; defaults below the Engine data directory

**Frontend** (`.env.local` from `frontend/.env.example`):
- `VITE_GATEWAY_URL` / `VITE_AUTH_TOKEN`
- In Tauri/client mode these are overridden at runtime by `applyServicePorts()` after `get_service_ports` resolves.

AI provider API keys are entered through the frontend and sent via `X-Provider-Key` or loaded from the Engine vault; they are not read from root `.env`. SearXNG and OpenSERP search settings contain only their configured endpoint and engine options. Provider keys live in session memory only or encrypted at rest when the secrets vault is enabled.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs docs, frontend, gateway, and engine checks; the manual build workflow covers three-platform desktop builds and container smoke. Triggers on push/PR to `master`/`main`.

## Key Endpoints

The canonical browser-facing contract is [docs/openapi.json](docs/openapi.json).
The table below is only a quick index.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/health/live` | Gateway process liveness (always 200 while serving) |
| `GET /api/v1/health/ready` | Gateway + Engine database readiness (200 or 503) |
| `GET /metrics` | Prometheus metrics (public, no auth) |
| `GET/POST /api/v1/log-level` | Runtime log level (read/set; persists to engine config) |
| `POST /api/v1/conversations/:id/chat` | Send message, returns SSE stream when `stream: true` |
| `GET/POST /api/v1/conversations` | List / create conversations |
| `GET/PATCH/DELETE /api/v1/conversations/:id` | CRUD for a single conversation |
| `POST /api/v1/conversations/:id/generate-title` | AI-generate conversation title (`force` controls manual vs guarded automatic behavior) |
| `GET/PUT /api/v1/providers` | List / update provider profiles |
| `POST /api/v1/search` | Structured web search (DuckDuckGo, SearXNG, OpenSERP) |
| `/api/v1/{skills,memories,knowledge,secrets}/*` | Proxied to engine |

All requests get an `X-Request-ID` header (generated if missing, propagated downstream).

### Recent Updates & Completed Features

- ✅ **Auto-generating conversation titles** with `/retitle` command
- ✅ **Structured web search tool** with DuckDuckGo, SearXNG, and OpenSERP providers
- ✅ **Token counting** with rough estimation and API usage tracking
- ✅ **Provider adapter expansion** with full sampling parameter support
- ✅ **CORS duplicate header fix** for engine proxy
- ✅ **API key persistence** with optional AES-256-GCM encryption
- ✅ **Developer panel** with DevTools button and real-time logging
- ✅ **Anthropic Claude API alignment** with enhanced parameters

### Development Focus Areas

Current development is focused on:
1. **Manual testing** of desktop app features (Tauri integration, web search, tool calls)
2. **UI enhancements** for better user experience (conversation titles, provider badges)
3. **API expansion** with additional provider parameters and features
4. **Performance optimization** and refinement of existing features
