# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

EncoreHub is a cross-platform AI chat desktop app — one client aggregating multiple AI providers (OpenAI, Anthropic, DeepSeek), with knowledge base, memory, skills, plugins, and MCP capabilities. Status: early development; core chat works, RAG/vector DB and WASM sandbox are on the roadmap.

```
frontend (React + Tauri 2) --HTTP/SSE--> gateway (Go) --HTTP--> engine (Rust)
                                               |                   |
                                           providers            SQLite
                                           (OpenAI/Anthropic   (+ LanceDB
                                            /DeepSeek)          pending)
```

## Conventions

- Commit messages: English, format `type(scope): description` (e.g. `fix(engine): handle empty conversation list`)
- No copyright headers on new files
- Prefer native/standard-library APIs; avoid pulling in dependencies for trivial operations
- Before modifying auth-related code, flag the security implications explicitly
- Never log or comment API keys, tokens, or secrets — treat them as opaque strings
- Before writing code for non-trivial changes, briefly explain the approach; when multiple valid approaches exist, present them as options
- Frontend UI: use semantic color tokens (`success`/`warning`/`danger`/`info` + `-bg`/`-border` variants, defined in `styles/globals.css`, wired through `tailwind.config.js`) — never hardcode Tailwind palette colors like `red-400`
- Frontend errors/feedback: surface via the global toast store (`stores/toastStore.ts` — `toast.success/error/info`), not inline error bars
- Frontend a11y: icon-only buttons must carry an `aria-label`; keyboard focus uses the global `:focus-visible` ring (no per-component focus styling needed)

## Component Map

| Module | Language | Role |
|--------|----------|------|
| `frontend/` | TypeScript + React 18 + Tauri 2 | Desktop UI, streaming, settings/skill/memory/knowledge panels, slash commands |
| `gateway/` | Go 1.25 (Gin) | HTTP/SSE entry, multi-provider adapter, auth/rate-limit/CORS, reverse proxy to engine |
| `engine/` | Rust (axum + tokio + rusqlite) | Conversations, memories, knowledge, skills storage & API; listens on `127.0.0.1:3000` |
| `data-services/` | Python 3.12 (FastAPI) | RAG/embedding/doc parsing — **skeleton, not wired up yet** |
| `proto/` | protobuf | gRPC schema — **stubs not yet generated/enabled** |

Why this language split: see `docs/adr/0001-language-split.md`.

## Essential Build & Test Commands

### Prerequisites

Node 22+ / pnpm 9 / Go 1.25 / Rust stable / Python 3.12 (for data-services only).

### Development (all from repo root)

```bash
# Start everything (use three terminals for real dev)
cd engine   && cargo run --bin encorehub-engine    # listens :3000
cd gateway  && go run ./cmd/gateway                # listens :8080
cd frontend && pnpm dev                            # Vite :1420
# or Tauri desktop: cd frontend && pnpm tauri dev
```

Makefile shortcuts (from root):
```
make dev           # docker-compose up redis + engine & gateway & frontend in parallel
make build         # build all components
make test          # run all tests
make lint          # lint all
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
| `go build -o bin/gateway ./cmd/gateway` | Build binary |
| `golangci-lint run ./...` | Lint |

**Engine** (`cd engine`):
| Command | What |
|---------|------|
| `cargo run --bin encorehub-engine` | Run engine |
| `cargo test` | Run all tests |
| `cargo clippy -- -D warnings` | Lint |
| `cargo fmt --check` | Format check |
| `cargo build --release` | Release build |

### Run a single test

```bash
cd frontend && pnpm vitest run -t "test name pattern"
cd gateway  && go test ./internal/handler -run TestName
cd engine   && cargo test test_name
```

## Tauri Desktop Packaging

The Tauri v2 config is at `frontend/src-tauri/tauri.conf.json`. Key points when building the installer:

- **External binaries**: `tauri.conf.json` → `bundle.externalBin` references `binaries/encorehub-engine` and `binaries/gateway`. Tauri auto-appends `.exe` on Windows but does **not** append the Rust target triple. If the build produces `encorehub-engine-x86_64-pc-windows-msvc.exe`, you must copy it to `encorehub-engine.exe` (and similarly for `gateway`) before running `pnpm tauri build`.
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

### Engine Proxy

Gateway proxies `/api/v1/{skills,memories,knowledge}/*` transparently to the Rust engine via `engine.Client` (`gateway/internal/engine/client.go`). Conversations are proxied too, except the chat endpoint (`POST /conversations/:id/chat`) which the gateway handles directly (provider orchestration + SSE streaming).

### Frontend State (Zustand)

- `conversationStore` — active conversation, message list, streaming state, optimistic updates with rollback on failure
- `settingsStore` — provider selection, API keys (session-memory only, not persisted to localStorage by default), settings modal tab

### Slash Command System

Commands are declared in `frontend/src/commands/slash.ts` as a `SlashCommand[]` array. Each command has an `id`, `name`, `description`, and `run(args, ctx)` where `ctx` provides access to conversation and settings stores. Add new commands by appending to the array — they auto-register in the input box's `/` completion menu.

### Engine Crate Structure

The engine is a Cargo workspace with three crates:
- `crates/core` — shared `EngineError` type and data types
- `crates/storage` — `Database` abstraction (SQLite via rusqlite with bundled libsqlite3; `lancedb/` and `blob/` modules are placeholders)
- `crates/skill` — `SkillRegistry` that loads Markdown skills from a directory, with YAML frontmatter parsing

The main binary (`src/main.rs`) wires: open SQLite → load skills → build axum router → serve. The router is defined in `src/api/mod.rs` and each resource group (conversations, knowledge, memories, skills, plugins) is a submodule.

### Skills Directory

Skills are Markdown files with YAML frontmatter loaded from `skills/` (relative to the engine binary). The engine ships with three built-in skills: `code-explainer`, `summarize`, `web-search`.

## Configuration

**Environment variables** (copy `.env.example` → `.env`):
- `LISTEN_ADDR` / `ENGINE_URL` / `ENGINE_BIND` — service binding
- `ENCOREHUB_AUTH_TOKEN` — sets bearer auth on gateway (unset = no auth, fine for localhost)
- `ENCOREHUB_CORS_ORIGINS` — comma-separated extra CORS origins
- `ENCOREHUB_RATE_LIMIT_RPS` (30) / `ENCOREHUB_RATE_LIMIT_BURST` (60)

**Frontend** (`.env.local` from `frontend/.env.example`):
- `VITE_GATEWAY_URL` / `VITE_ENGINE_URL` / `VITE_AUTH_TOKEN`

API keys for providers go in `.env` (server-side). The frontend sends them via `X-Provider-Key` header per-request; keys live in session memory only.

## CI

GitHub Actions (`.github/workflows/ci.yml`): 4 parallel jobs — frontend (pnpm lint → test → build), gateway (go vet → test → build), engine (fmt → clippy → test → build), data-services (ruff → mypy → pytest). Triggers on push/PR to `master`/`main`.

## Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/health` | Gateway + engine liveness (always 200; check `engine.ok` for readiness) |
| `GET /metrics` | Prometheus metrics (public, no auth) |
| `POST /api/v1/conversations/:id/chat` | Send message, returns SSE stream when `stream: true` |
| `GET/POST /api/v1/conversations` | List / create conversations |
| `GET/PATCH/DELETE /api/v1/conversations/:id` | CRUD for a single conversation |
| `/api/v1/{skills,memories,knowledge}/*` | Proxied to engine |

All requests get an `X-Request-ID` header (generated if missing, propagated downstream).
