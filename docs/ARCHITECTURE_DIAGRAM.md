# EncoreHub Architecture

> Current runtime architecture as of 2026-08-05. Historical design choices are
> recorded under `docs/adr/`; implementation follow-up lives in
> [`REMAINING_WORK.md`](REMAINING_WORK.md).

## Runtime Topology

```mermaid
flowchart LR
    UI["React UI<br/>chat, settings, knowledge, memory"]
    TAURI["Tauri desktop host<br/>runtime paths and lifecycle"]
    GATEWAY["Go Gateway<br/>HTTP/SSE, providers, search, auth"]
    ENGINE["Rust Engine in-process<br/>axum API and data pipeline"]
    PROVIDERS["AI and search providers"]
    SQLITE["SQLite<br/>authoritative metadata"]
    SQLVEC["SQLite-Vec<br/>turn memory + Knowledge fallback"]
    LANCE["Embedded LanceDB<br/>primary Knowledge vectors"]
    BLOBS["Content-addressed blobs<br/>uploaded attachments"]
    PANDOC["Optional Pandoc<br/>rich-text conversion"]

    UI --> TAURI
    UI -->|"HTTP/SSE"| GATEWAY
    TAURI -->|"starts in process"| ENGINE
    TAURI -->|"only sidecar"| GATEWAY
    GATEWAY -->|"internal HTTP + bearer token"| ENGINE
    GATEWAY --> PROVIDERS
    ENGINE --> SQLITE
    ENGINE --> SQLVEC
    ENGINE --> LANCE
    ENGINE --> BLOBS
    ENGINE -.->|"preferred when installed"| PANDOC
```

The frontend never connects directly to Engine. Tauri negotiates loopback ports
and exposes only the Gateway port to React. A per-start random bearer token
protects all Engine business and readiness routes; `/health/live` is the only
unprotected Engine endpoint.

## Knowledge And Memory

```mermaid
flowchart TD
    UPLOAD["Attachment or Knowledge text"]
    PARSE["Rust document pipeline<br/>Pandoc first, native fallback"]
    CHUNK["Unicode-safe overlapping chunks"]
    META["SQLite documents and chunks"]
    EMBED["384-dimensional local embedding"]
    LANCE["LanceDB primary index"]
    FALLBACK["SQLite-Vec fallback index"]
    QUERY["Knowledge query"]
    RESULT["RAG context"]
    TURN["Completed conversation turn"]
    MEMORY["SQLite memory metadata + SQLite-Vec"]

    UPLOAD --> PARSE --> CHUNK
    CHUNK --> META
    CHUNK --> EMBED
    EMBED --> LANCE
    EMBED --> FALLBACK
    QUERY --> LANCE --> RESULT
    LANCE -.->|"operation unavailable"| FALLBACK
    FALLBACK --> RESULT
    TURN --> MEMORY --> RESULT
```

SQLite owns lifecycle and metadata. LanceDB and SQLite-Vec are local vector
projections. Knowledge writes always mirror into SQLite-Vec before LanceDB, so
retrieval remains available after a primary-store failure. Per-turn Memory uses
SQLite-Vec directly because its dataset is small and follows SQLite lifecycle.

## Attachment Routing

```mermaid
flowchart TD
    FILE["Uploaded file"]
    META["Attachment metadata table"]
    BLOB["SHA-256 content-addressed blob"]
    IMAGE{"Image?"}
    VISION{"Selected model supports vision?"}
    DIRECT["Provider-native image payload"]
    USERMODE{"User image strategy"}
    OCR["System OCR"]
    VMODEL["User-selected vision model"]
    TEXT{"Rich text?"}
    PANDOC["Pandoc when available"]
    RUST["Native Rust parser"]
    PROMPT["Typed text attachment in prompt"]

    FILE --> META
    FILE --> BLOB
    FILE --> IMAGE
    IMAGE -->|"yes"| VISION
    VISION -->|"yes"| DIRECT
    VISION -->|"no"| USERMODE
    USERMODE --> OCR
    USERMODE --> VMODEL
    IMAGE -->|"no"| TEXT
    TEXT -->|"yes"| PANDOC
    PANDOC -.->|"missing or failed"| RUST
    TEXT -->|"plain text"| PROMPT
    RUST --> PROMPT
```

## Build And Deployment

- Desktop packages the Gateway as the only sidecar; Engine is a linked Rust
  library running on Tauri's async runtime.
- Mutable SQLite, LanceDB, blobs, and logs live under platform app data, never
  the installation resource directory.
- Standalone Engine remains available behind Cargo's `standalone` feature.
- LanceDB builds require `protoc`; local build scripts resolve a vendored binary
  when `PROTOC` and PATH do not provide one, while CI and Docker install it.
- Containers publish Gateway only; Engine and all embedded stores stay on the
  private Compose network and persistent Engine volume.
