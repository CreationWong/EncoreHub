# 0008 - Versioned desktop runtime modules

* **Status**: Accepted
* **Date**: 2026-08-07
* **Decision makers**: Project lead

## Context

The Tauri executable previously statically linked the complete Rust Engine.
Updating memory, knowledge, vector, or document-processing code therefore
required rebuilding and replacing the desktop executable even when the UI and
window lifecycle were unchanged. Rust's native dynamic ABI is not stable
between toolchain versions, so directly linking a Rust `dylib` would not make
independent upgrades reliable.

Gateway is already an independent executable with a loopback HTTP contract.
Engine also has a stable HTTP data plane, but desktop lifecycle, path, token,
and log integration need a small host boundary.

## Decision

The desktop release consists of independently buildable runtime modules:

| Component | Artifact | Compatibility boundary |
| --- | --- | --- |
| Desktop | `encorehub-desktop` executable | Tauri commands and Engine Runtime C ABI |
| Engine | `encorehub_desktop_runtime.dll`, `libencorehub_desktop_runtime.so`, or `libencorehub_desktop_runtime.dylib` | C ABI version plus Engine HTTP API |
| HTML parser | `encorehub_rust_scrapling.dll`, `libencorehub_rust_scrapling.so`, or `libencorehub_rust_scrapling.dylib` | RUSTScrapling C ABI version |
| Gateway | `encorehub-gateway` executable | Gateway/Engine HTTP health and API contract |
| Frontend | Assets embedded by the Desktop build | Tauri command and Gateway HTTP APIs |

Engine Runtime exposes only lifecycle operations and an opaque handle through
C ABI version 1. Rust structs, allocators, async runtimes, and errors never
cross the library boundary. Startup configuration is UTF-8 JSON owned by the
caller. Errors use a caller-owned buffer, and logs use a callback valid until
the opaque handle is stopped.

Every Engine build emits `engine-runtime.json` with module version, ABI
version, target triple, profile, size, SHA-256, native dependencies, and the
same identity fields for the independently packaged RUSTScrapling companion.
Desktop verifies the Engine ABI export before resolving lifecycle functions,
and the component builder verifies the parser artifact against the manifest.
An incompatible ABI requires a coordinated rebuild; implementation-only
upgrades may replace a library and manifest independently.

Component builds accept one or several comma-separated names:

```text
node scripts/build-components.mjs --components engine --release
node scripts/build-components.mjs --components engine,gateway --release
node scripts/build-components.mjs --components desktop --release
```

PowerShell `-Components` and Bash `--components` delegate to the same builder,
so selection and validation are identical across Windows, Linux, and macOS.
Building only Desktop requires compatible Engine and Gateway artifacts to
already exist; it never silently rebuilds modules omitted by the caller.

## Consequences

- Engine-heavy dependencies leave the Tauri executable's link graph.
- RUSTScrapling and its dependency graph also remain outside both the Tauri
  executable and the main Engine Runtime dynamic library.
- Engine and Gateway can be rebuilt, tested, and upgraded without rebuilding
  Desktop when their compatibility boundaries remain satisfied.
- Windows, Linux, and macOS use the same ABI and build selection semantics;
  only dynamic-library filenames and bundle resource mappings differ.
- Dynamic-library loading becomes a startup failure point. Errors include the
  checked paths, missing symbol, or ABI mismatch instead of falling back to an
  unsafe module.
- Engine still shares Desktop's process crash domain. Gateway remains isolated
  as a child process.

## Alternatives rejected

- **Keep one statically linked desktop executable**: simplest deployment, but
  prevents independent Engine upgrades and keeps the Desktop link graph large.
- **Rust `dylib` dependency**: no explicit ABI and unsafe across toolchain
  upgrades.
- **Engine sidecar executable**: stable process boundary, but adds another
  process lifecycle and duplicates the desktop-owned path/log integration.
- **Split every Engine crate into a dynamic library**: creates many unstable
  internal boundaries without an independent upgrade requirement.

## Related work

- [ADR-0004](0004-engine-in-process-and-internal-auth.md) defines the process,
  authentication, and HTTP boundaries retained by this decision.
- [ADR-0007](0007-rust-native-data-pipeline.md) keeps data processing native to
  Rust inside the Engine Runtime module.
