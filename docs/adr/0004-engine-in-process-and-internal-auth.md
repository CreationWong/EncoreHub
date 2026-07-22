# 0004 - Engine in-process desktop runtime and internal authentication

* **Status**: Accepted
* **Date**: 2026-07-19
* **Decision makers**: Project lead

## Context

The original desktop topology packaged both Engine and Gateway as child
processes. That duplicated process discovery and packaging logic, encouraged
mutable data beside installed executables, and exposed a predictable Engine
HTTP port without an authentication boundary. The React webview could also be
tempted to call Engine directly, bypassing Gateway policy and provider logic.

Engine is still required as a standalone service for headless development and
container deployment, so moving it into the desktop process cannot remove its
HTTP contract or standalone binary.

## Decision

### Desktop process topology

The Tauri desktop binary links the `encorehub-engine` library and starts its
Axum server as a task on Tauri's Tokio runtime. Gateway is the only packaged
sidecar. Gateway continues to call Engine over loopback HTTP/JSON, preserving
the same boundary used by standalone deployments.

The standalone Engine binaries remain behind the Cargo `standalone` feature
for Docker, headless development, and CI. Desktop and standalone modes share
the same router and storage implementation.

### Internal authentication boundary

Every desktop start generates a fresh 256-bit token from the operating
system's cryptographic random source. Tauri passes the token directly to the
in-process Engine and to the Gateway child through
`ENCOREHUB_ENGINE_AUTH_TOKEN`.

The token:

- exists only in Desktop, Engine, and Gateway process memory;
- is never returned through a Tauri command or included in the React bundle;
- is never persisted to SQLite or written to logs;
- is distinct from the optional external Gateway token
  `ENCOREHUB_AUTH_TOKEN`.

Standalone and container deployments must inject the same non-empty
`ENCOREHUB_ENGINE_AUTH_TOKEN` into Engine and Gateway. Missing configuration
fails before either service listens. Rotating the token restarts Engine and
Gateway as one deployment unit.

Engine exposes only `GET /health/live` without authentication. Readiness,
compatibility health, and every `/api/*` route require
`Authorization: Bearer <internal-token>`. Engine does not provide browser
CORS. React calls Gateway only; Gateway owns browser CORS, optional external
authentication, rate limiting, provider access, and SSE.

### Ports and runtime files

Desktop chooses free loopback ports at startup and gives React only the
negotiated Gateway port through `get_service_ports`. Mutable SQLite and log
files live under Tauri's `app_data_dir`; bundled skills are read from
`resource_dir`. Standalone paths remain explicitly configurable through
environment variables.

## Consequences

- Desktop ships one sidecar instead of two and no longer searches for an
  Engine executable.
- Engine failure now shares the Desktop process crash domain. Service health
  remains observable through Gateway readiness and the developer panel.
- The loopback HTTP boundary remains testable and deployment-equivalent, at
  the cost of a local HTTP hop inside the desktop process.
- Frontend code has no Engine URL or internal credential and cannot bypass
  Gateway policy.
- Packaged and standalone modes must keep the same authenticated Engine API;
  neither mode may introduce a permissive fallback token.

## Alternatives rejected

- **Keep two desktop sidecars**: preserves stronger process isolation but
  retains platform-specific discovery, migration, and packaging complexity.
- **Call Engine through Rust FFI only**: removes the HTTP hop but creates a
  second desktop-only contract and diverges from standalone behavior.
- **Expose Engine directly to React**: leaks the internal trust boundary into
  the webview and duplicates Gateway authentication, CORS, and routing policy.
- **Reuse the external Gateway token**: couples two different trust domains
  and risks exposing an Engine credential to frontend build configuration.

## Related work

- [ADR-0001](0001-language-split.md) retains the language split; this ADR
  supersedes only its desktop packaging consequence.
- [ADR-0002](0002-http-first-grpc-later.md) keeps HTTP/JSON as the current
  Gateway-to-Engine transport.
- [Improvement workflow](../IMPROVEMENT_WORKFLOW.md) WF-02 and WF-09 record the
  authentication and packaging implementation evidence.
