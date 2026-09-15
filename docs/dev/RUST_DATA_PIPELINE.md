# Rust Data Pipeline Contract

> Status: native parsing, deterministic embedding, LanceDB Knowledge indexing,
> and SQLite-Vec fallback are active in the Rust Engine.

记忆准入、模式、生命周期、模型工具和永久记忆策略由
[记忆系统设计](MEMORY_SYSTEM_DESIGN.md) 统一定义。本文档仅定义当前 Rust
数据处理和向量存储约定。

## Ownership

The data pipeline is an in-process Engine capability. It does not expose a
separate port, container, sidecar, or Python runtime. SQLite is authoritative
for attachment, document, chunk, and memory metadata. Vector stores are
rebuildable projections of that relational data.

## Document Processing

Rich-text uploads prefer an installed Pandoc executable. When Pandoc is absent
or conversion fails, the Engine parses these formats natively:

| Format | Native path |
|---|---|
| DOCX | Bounded ZIP read of `word/document.xml` |
| ODT | Bounded ZIP read of `content.xml` |
| EPUB | Bounded extraction of HTML/XHTML members |
| HTML/HTM | Visible text, block boundaries, and common entities |
| RTF | Lightweight control-word and escape removal |

Archive members are capped at 40 MiB expanded size. The parser accepts bytes,
so fallback does not write another temporary file. PDF parsing remains deferred
until a license-compatible Rust parser and resource limits are selected.

Text chunking uses Unicode scalar boundaries, a 1,000-character target, and a
200-character overlap. CJK text and emoji cannot trigger byte-boundary panics.

## Vector Storage

Both vector stores use the `encorehub-feature-hash-v1` contract: tokenized text
is hashed with FNV-1a into 384 dimensions and L2-normalized. This keeps primary
and fallback results query-compatible without model files or network access.

| Data | Primary | Mirrored/fallback |
|---|---|---|
| Knowledge chunks | Embedded LanceDB | SQLite-Vec |
| One-turn conversation Memory | SQLite-Vec | None |

Knowledge ingestion follows this order:

1. Write the relational document and chunks to SQLite.
2. Index every chunk in SQLite-Vec.
3. Replace the document's LanceDB rows.
4. Log a bounded warning if LanceDB fails; keep the successful SQLite data.

Knowledge search reports `backend: "lance_db"` on a successful LanceDB query
and `backend: "sqlite_vec"` when LanceDB is unavailable. Deletes attempt
LanceDB cleanup and always continue with authoritative relational deletion.

## Local Paths And Build

LanceDB defaults to `<engine data directory>/lancedb`. Desktop mode therefore
stores it below the Tauri `app_data_dir`; standalone and container modes derive
it from the SQLite database directory. `ENCOREHUB_LANCEDB_PATH` is an optional
explicit override.

The runtime has no Python dependency. Building the LanceDB Rust SDK requires
`protoc`; local build scripts prefer `PROTOC` or PATH and otherwise resolve a
platform-specific vendored binary through Cargo. GitHub Actions uses
`arduino/setup-protoc`, and the Engine Docker builder installs `protobuf-dev`.
Direct Cargo commands must provide `PROTOC` themselves.

## Verification

The storage test suite performs a real temporary-directory LanceDB round trip:
upsert, cosine search, and document-scoped delete. Document tests cover Unicode
overlap, DOCX XML/entities, HTML blocks/entities, and malformed archives.
