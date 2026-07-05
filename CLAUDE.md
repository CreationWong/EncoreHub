# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

EncoreHub is a cross-platform AI chat desktop app — one client aggregating multiple AI providers (OpenAI, Anthropic, DeepSeek, Claude), with knowledge base, memory, skills, plugins, and MCP capabilities. Status: active development; core chat, web search, token counting, and auto-generated conversation titles are complete; RAG/vector DB and WASM sandbox are on the roadmap.

```
frontend (React + Tauri 2) --HTTP/SSE--> gateway (Go) --HTTP--> engine (Rust, axum)
       |                                        |                   |
       |  Tauri: engine in-process               |  multi-provider   |  SQLite + LanceDB(pending)
       |  (tokio task); gateway is               |  adapters         |  AES-256-GCM secret crypto
       |  the only sidecar                       |                   |  conversation crate (token)
```

In the **desktop app** the engine is not a separate process: the Tauri shell
depends on the `encorehub-engine` crate and starts its axum service in-process
on Tauri's tokio runtime. The gateway is the **only sidecar** spawned as a child
process. The engine also still builds as a **standalone binary** (gated by the
`standalone` Cargo feature) for headless deployment, pure-web dev, and CI.
See `docs/ENGINE_TAURI_MERGE_PLAN.md`.

Ports are negotiated at startup: in Tauri/client mode `find_free_port()` scans
from 10000 upward; in headless/dev mode the env vars `ENGINE_BIND` / `LISTEN_ADDR`
(or their defaults `:3000` / `:8080`) take precedence. The frontend receives the
actual ports via the `get_service_ports` Tauri command.

## Conventions

- Commit messages: English, format `type(scope): description` (e.g. `fix(engine): handle empty conversation list`)
- No copyright headers on new files
- Prefer native/standard-library APIs; avoid pulling in dependencies for trivial operations
- Before modifying auth-related code, flag the security implications explicitly
- Never log or comment API keys, tokens, or secrets — treat them as opaque strings
- Before writing code for non-trivial changes, briefly explain the approach; when multiple valid approaches exist, present them as options
- **Go: never use `any` in struct fields that will be JSON-serialized to external APIs.** `encoding/json` marshals `[]byte` as base64, which causes API rejections when the field is expected to be a JSON object. For function parameters/schemas passed to AI providers, use typed maps (`map[string]any`) or concrete structs. `json.RawMessage` is `[]byte` — it will be base64-encoded, not inlined.
- Frontend UI: use semantic color tokens (`success`/`warning`/`danger`/`info` + `-bg`/`-border` variants, defined in `styles/globals.css`, wired through `tailwind.config.js`) — never hardcode Tailwind palette colors like `red-400`
- Frontend errors/feedback: surface via the global toast store (`stores/toastStore.ts` — `toast.success/error/info`), not inline error bars
- Frontend a11y: icon-only buttons must carry an `aria-label`; keyboard focus uses the global `:focus-visible` ring (no per-component focus styling needed)

## Component Map

| Module | Language | Role | Status |
|--------|----------|------|--------|
| `frontend/` | TypeScript + React 18 + Tauri 2 | Desktop UI, streaming, settings/skill/memory/knowledge panels, slash commands, auto-generated conversation titles, token counting display | ✅ Active development |
| `gateway/` | Go 1.25 (Gin) | HTTP/SSE entry, multi-provider adapter, auth/rate-limit/CORS, reverse proxy to engine, web search integration | ✅ Complete with provider adapters |
| `engine/` | Rust (axum + tokio + rusqlite) | Conversations, memories, knowledge, skills storage & API, token counting, AES-256-GCM encryption, port negotiation | ✅ Core functionality complete |
| `data-services/` | Python 3.12 (FastAPI) | RAG/embedding/doc parsing, vector database | ⏳ Skeleton, not wired up |
| `proto/` | protobuf | gRPC schema for inter-service communication | ⏳ Schema complete, gRPC not yet enabled |

Why this language split: see `docs/adr/0001-language-split.md`.

## Essential Build & Test Commands

### Prerequisites

Node 22+ / pnpm 9 / Go 1.25 / Rust stable / Python 3.12 (for data-services only).

### Development (all from repo root)

```bash
# Start everything (use three terminals for real dev)
cd engine   && cargo run --features standalone --bin encorehub-engine  # listens :3000 (or ENGINE_BIND)
cd gateway  && go run ./cmd/gateway                # listens :8080 (or LISTEN_ADDR)
cd frontend && pnpm dev                            # Vite :1420
# or Tauri desktop: cd frontend && pnpm tauri dev  (engine in-process, ports auto-negotiated from 10000)
```

Makefile shortcuts (from root):
```
make dev           # docker-compose up redis + engine & gateway & frontend in parallel
make build         # build all components
make build-ci      # CI: engine+gateway parallel, then frontend
make check         # fast static checks (cargo check + go vet + tsc --noEmit)
make test          # run all tests
make lint          # lint all
make fmt           # format all (Biome + cargo fmt + gofmt)
make tauri-build   # desktop installer (.msi + .exe)
make dist          # alias for tauri-build
```

### Per-component commands

**Frontend** (`cd frontend`):
| Command | What |
|---------|------|
| `pnpm dev` | Vite dev server (port 1420) |
| `pnpm build` | `tsc && vite build` → `dist/` |
| `pnpm tauri dev` | Tauri desktop dev |
| `pnpm tauri build` | Tauri desktop production build — generates `.msi` and `.exe` installer |
| `pnpm test` | Vitest (jsdom, `src/**/*.test.{ts,tsx}`) |
| `pnpm lint` | Biome check `src/` |
| `pnpm lint:fix` | Biome auto-fix |

**Gateway** (`cd gateway`):
| Command | What |
|---------|------|
| `go run ./cmd/gateway` | Run gateway |
| `go test ./...` | Run all tests |
| `go vet ./...` | Static analysis |
| `go build -trimpath -ldflags="-s -w" -o bin/gateway ./cmd/gateway` | Release build |
| `golangci-lint run ./...` | Lint |

**Engine** (`cd engine`):

The engine compiles in two modes via the `standalone` Cargo feature. Without it
the crate is library-only (consumed in-process by the Tauri desktop app); with
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

- **Tauri / client mode**: When `ENGINE_BIND` and `LISTEN_ADDR` are unset, the desktop app calls `find_free_port(10000)` from `engine/src/lib.rs` to find two free ports on `127.0.0.1` (engine first, gateway next). The gateway sidecar receives `ENGINE_URL` and `LISTEN_ADDR` as env vars. The frontend calls `invoke("get_service_ports")` at startup to resolve the actual ports.
- **Headless / dev mode**: Ports always come from env vars (`ENGINE_BIND`, `LISTEN_ADDR`, `ENGINE_URL`) or their defaults (`127.0.0.1:3000`, `:8080`).
- The Tauri `ServiceState` struct stores `engine_port` and `gateway_port`; `check_engine_health` and `check_gateway_health` use them instead of hardcoded ports.
- Frontend `config.ts` exports `applyServicePorts(gwPort, engPort)` and getter functions (`apiBase()`, `gatewayUrl()`, `engineUrl()`, `healthGatewayUrl()`) — no hardcoded URLs downstream.

## Tauri Desktop Packaging

The Tauri v2 config is at `frontend/src-tauri/tauri.conf.json`. Key points when building the installer:

- **External binaries**: `tauri.conf.json` → `bundle.externalBin` references only `binaries/gateway` (the engine now runs in-process, so it is no longer a sidecar). Tauri auto-appends `.exe` on Windows but does **not** append the Rust target triple. If the build produces `gateway-x86_64-pc-windows-msvc.exe`, you must copy it to `gateway.exe` before running `pnpm tauri build`.
- **Build script**: `.\scripts\build.ps1 -Tauri` handles everything (engine check, gateway build, sidecar copy with target-triple alias, Tauri bundle). Supports `-Debug`, `-Parallel`, `-SkipInstall` flags.
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
3. **Model returns tool_calls** → gateway's `providerStream()` loop intercepts `web_search`, executes it via `executeWebSearch()` (DuckDuckGo HTML scraping by default; Bing/Google require env API keys, fall back to DuckDuckGo with a warning SSE event), formats results, builds a follow-up request via `cloneRequestForNextRound()` that appends an assistant message (with `ToolCalls`) and a tool message (with `ToolCallID`), then calls the model again (max 3 rounds).
4. **Frontend** receives `tool_call` and `tool_result` SSE events → `conversationStore` tracks `streamingToolCalls` → rendered in `MessageBubble.ToolCallCard` (collapsed by default, click to expand). The `warning` SSE event triggers `toast.warning()`.
5. Search providers live in `gateway/internal/search/`. DuckDuckGo uses `html.duckduckgo.com` (no-JS version, parsed with `golang.org/x/net/html`). The Instant Answer API (`api.duckduckgo.com`) is **not used** — it only returns Wikipedia abstracts, not web results.

### Auto-Generated Conversation Titles

- **Manual rename** has highest priority: user-edited titles must not be overwritten by automatic generation
- **Requested rename** uses the `update_conversation_title` tool and shows the tool call/result in chat
- **Automatic title generation** runs as a hidden non-streaming gateway request after the first user message, in parallel with the visible chat response; it emits `title_update` or `title_error` SSE before `done`
- **Gateway** provides `POST /api/v1/conversations/:id/generate-title` for explicit `/retitle` requests (`force: true`) and guarded automatic requests (`force: false`)
- **Engine** stores title updates via conversation PATCH/title update endpoints; it does not own AI title generation
- Automatic generation uses the conversation's configured model and must not automatically switch to a non-reasoning or lighter model; provider-native reasoning disable flags are allowed for the hidden title request (DeepSeek V4 uses `thinking.type=disabled`)
- Limits: Chinese-only ≤20 chars, English-only ≤15 words, mixed Chinese/English ≤15 chars; timeout 30s; 3 retries with full request/response/error logging
- Titles are displayed in the conversation list and conversation header with edit functionality

### Frontend State (Zustand)

- `conversationStore` — active conversation, message list, streaming state (content + reasoning + tool calls), `streamTokenCount` capture, optimistic updates with rollback on failure
- `settingsStore` — provider selection, API keys (session-memory only, not persisted to localStorage by default), settings modal tab; `searchEnabled`/`searchProvider` toggle; `loadKeys()` loads from engine secrets DB with retry/backoff
- `secretsStore` — encryption status (`enabled`/`locked`/`unlocked`), `storedIds` from `list()` (works while locked), `unlock(password)` for inline decryption
- `providerStore` — custom provider profiles (CRUD via engine config API)
- `confirmStore` — promise-based confirmation dialog (`confirm.ask(title, msg, danger?)`); replaces all browser `window.confirm()` calls
- `toastStore` — 4 kinds: `success` / `error` / `info` / `warning`; imperative `toast.*()` helpers

### Slash Command System

Commands are declared in `frontend/src/commands/slash.ts` as a `SlashCommand[]` array. Each command has an `id`, `name`, `description`, and `run(args, ctx)` where `ctx` provides access to conversation and settings stores. Add new commands by appending to the array — they auto-register in the input box's `/` completion menu.

**Current Commands**:
- `/clear` - Clear conversation
- `/model` - Switch model/provider
- `/retitle` - Force AI title regeneration for the current conversation
- `/export` - Export conversation
- `/help` - Show available commands

### Engine Crate Structure

The engine is a Cargo workspace with four crates:
- `crates/core` — shared `EngineError` type and data types (`Message`, `Conversation`, `Memory`, `Role`, `Usage`, etc.)
- `crates/conversation` — token counting (`rough_token_count`, `estimate_message_tokens`, `token_count_with_estimation`, `exceeds_token_limit`, `Usage` struct with total() method)
- `crates/storage` — `Database` abstraction (SQLite via rusqlite with bundled libsqlite3; `lancedb/` and `blob/` modules are placeholders)
- `crates/skill` — `SkillRegistry` that loads Markdown skills from a directory, with YAML frontmatter parsing
- Built-in skills: `code-explainer`, `summarize`, `web-search` (with dynamic tool support)

The main binary (`src/main.rs`) wires: open SQLite → load skills → install a reloadable tracing subscriber → resolve `ENGINE_BIND` (or default `127.0.0.1:3000`) → call `encorehub_engine::serve(...)`. `serve()` (in `src/lib.rs`) builds the axum router and runs it; it is shared by the standalone binary and the Tauri desktop app (which calls it from `tokio::spawn` on its own runtime). `lib.rs` also exports `find_free_port(start_port)` — a synchronous TCP probe used by Tauri for port negotiation. `main.rs` and `mcp_server.rs` are gated behind `#![cfg(feature = "standalone")]` so the library build skips them. The router is defined in `src/api/mod.rs` and each resource group (conversations, knowledge, memories, skills, plugins, secrets, config) is a submodule.

### Skills Directory

Skills are Markdown files with YAML frontmatter loaded from `skills/` (relative to the engine binary). The engine ships with three built-in skills: `code-explainer`, `summarize`, `web-search`. The web-search skill supports dynamic tool calls for real-time web information retrieval.

### Provider Enhancements

- **Anthropic Claude API**: Full parameter support including `reasoning_effort`, `top_k`, `thinking_budget`, and enhanced sampling parameters
- **Enhanced sampling**: All providers now support `top_p`, `frequency_penalty`, `presence_penalty`, `seed`, `stop`, and `json_mode`
- **Tool calling**: Dynamic tool registration with `web_search` integration and provider-specific tool formatting

## Configuration

**Environment variables** (copy `.env.example` → `.env`):
- `LISTEN_ADDR` / `ENGINE_URL` / `ENGINE_BIND` — service binding and port negotiation (see Port Negotiation section)
- `ENCOREHUB_AUTH_TOKEN` — sets bearer auth on gateway (unset = no auth, fine for localhost)
- `ENCOREHUB_CORS_ORIGINS` — comma-separated extra CORS origins
- `ENCOREHUB_RATE_LIMIT_RPS` (30) / `ENCOREHUB_RATE_LIMIT_BURST` (60)
- `ENCOREHUB_DEV_MOCK` — set to `1`/`true` to enable mock replies without an API key (dev only)

**Frontend** (`.env.local` from `frontend/.env.example`):
- `VITE_GATEWAY_URL` / `VITE_ENGINE_URL` / `VITE_AUTH_TOKEN`
- In Tauri/client mode these are overridden at runtime by `applyServicePorts()` after `get_service_ports` resolves.

API keys for providers go in `.env` (server-side). The frontend sends them via `X-Provider-Key` header per-request; keys live in session memory only (or encrypted at rest in the engine DB when the secrets vault is enabled).

## CI

GitHub Actions (`.github/workflows/ci.yml`): 4 parallel jobs — frontend (pnpm lint → test → build), gateway (go vet → test → build), engine (fmt → clippy → test → build), data-services (ruff → mypy → pytest). Triggers on push/PR to `master`/`main`.

## Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/health` | Gateway + engine liveness (always 200; check `engine.ok` for readiness) |
| `GET /metrics` | Prometheus metrics (public, no auth) |
| `GET/POST /api/v1/log-level` | Runtime log level (read/set; persists to engine config) |
| `POST /api/v1/conversations/:id/chat` | Send message, returns SSE stream when `stream: true` |
| `GET/POST /api/v1/conversations` | List / create conversations |
| `GET/PATCH/DELETE /api/v1/conversations/:id` | CRUD for a single conversation |
| `POST /api/v1/conversations/:id/generate-title` | AI-generate conversation title (`force` controls manual vs guarded automatic behavior) |
| `/retitle` command | Force AI title regeneration for the current conversation |
| `GET/PUT /api/v1/providers` | List / update provider profiles |
| `POST /api/v1/search` | Web search (DuckDuckGo, Bing, Google) |
| `/api/v1/{skills,memories,knowledge,secrets}/*` | Proxied to engine |
| `/api/v1/config/*` | Proxied to engine (runtime config) |

All requests get an `X-Request-ID` header (generated if missing, propagated downstream).

### Recent Updates & Completed Features

- ✅ **Auto-generating conversation titles** with `/retitle` command
- ✅ **Enhanced web search tool** with DuckDuckGo, Bing, and Google providers
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
