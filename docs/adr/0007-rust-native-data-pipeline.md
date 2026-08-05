# 0007 - Rust Native Data Pipeline And Embedded Vector Storage

* **Status**: Accepted
* **Date**: 2026-08-05
* **Decision makers**: Project owner
* **Supersedes**: The Python Data Services and Chroma portions of [ADR-0001](0001-language-split.md)

## Context

The optional Python/FastAPI service required a separate runtime, packaging path,
PyOxidizer executable, and Chroma process. Desktop builds failed while preparing
that parser, and the split duplicated embedding and chunking logic across Rust
and Python. The feature is local-first and does not require a remote service.

## Decision

The Rust Engine owns the entire local data path:

- Pandoc is preferred when installed; DOCX, ODT, EPUB, HTML, and RTF otherwise
  use bounded native Rust parsing.
- Unicode-safe chunking and the deterministic 384-dimensional feature-hash
  embedding run in process.
- Embedded LanceDB is the primary persistent Knowledge vector index.
- SQLite remains authoritative for document/chunk metadata and always mirrors
  Knowledge vectors into SQLite-Vec.
- SQLite-Vec stores per-turn conversation Memory and temporarily answers
  Knowledge searches whenever LanceDB initialization or an operation fails.
- `ENCOREHUB_LANCEDB_PATH` may override the default `<engine data>/lancedb`
  directory. Installation resources never hold mutable vector data.

Python, FastAPI, PyOxidizer, Chroma, and their container/CI jobs are removed.
The LanceDB Rust SDK requires `protoc` at compile time. Local build scripts use
an explicit `PROTOC`, a PATH installation, or a platform-specific vendored
binary resolved through Cargo, in that order. CI installs it, and the Engine
container includes it in its builder.

## Consequences

- Desktop startup and document ingestion need no Python runtime or data-service
  process.
- Knowledge writes remain queryable through SQLite-Vec even if LanceDB fails.
- The Engine binary gains the Arrow/DataFusion/Lance dependency closure and has
  a slower clean build; release size and startup impact require measurement.
- The local deterministic embedding favors offline reproducibility over model
  quality. A semantic model is only introduced after recall benchmarks justify
  its runtime and packaging cost.

## References

- [Rust data pipeline contract](../RUST_DATA_PIPELINE.md)
- [Remaining work](../REMAINING_WORK.md)
