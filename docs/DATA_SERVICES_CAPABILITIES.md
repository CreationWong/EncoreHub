# Data Services Capability Contract and Dependency Budget

> Status: contract-only; no parsing, embedding, chunking, RAG, worker, or gRPC implementation is enabled.
> Baseline date: 2026-07-18.

## Current Baseline

| Metric | Baseline |
|---|---:|
| Direct runtime dependencies | 2 (`fastapi`, `uvicorn`) |
| Locked packages, including dev tools | 30 |
| `uv.lock` size | 86,068 bytes |
| Model artifacts | 0 bytes |
| GPU runtime | None |
| Synced Windows dev environment | 90.1 MiB |

Before WF-10, the lock contained 169 packages and was 760,769 bytes. The development environment included 119 now-removed packages such as Torch, CUDA-related packages, Sentence Transformers, LlamaIndex, Pandas, Celery, Redis clients, and gRPC tooling. The 90.1 MiB figure includes Ruff, mypy, pytest, and HTTPX; it is not a Docker runtime image measurement.

## HTTP Contract

The following endpoints are present so callers and future implementations share one schema before capability work begins:

| Endpoint | Request model | Success model | Current behavior |
|---|---|---|---|
| `POST /embed` | `EmbedRequest` | `EmbedResponse` | Structured `501 CapabilityUnavailable` |
| `POST /parse` | `ParseRequest` | `ParseResponse` | Structured `501 CapabilityUnavailable` |
| `POST /chunk` | `ChunkRequest` | `ChunkResponse` | Structured `501 CapabilityUnavailable` |

FastAPI validates declared limits before returning `501`; invalid requests return `422`. A future implementation must preserve these models or introduce an explicitly versioned contract change.

## Dependency Admission

Capability packages are not speculative runtime dependencies. Each implementation PR must place its packages in a capability-specific extra or separate deployable module and update the table below with measured values from the target wheel set and container image.

| Group | Current state | Candidate stack to evaluate | Model/artifact size | Hardware | License review | Packaging impact required before admission |
|---|---|---|---:|---|---|---|
| Parsing | Not admitted | PyMuPDF, python-docx, markdown-it-py, lxml | 0 now; measure wheels | CPU | PyMuPDF AGPL/commercial choice is blocking; verify every parser | Native wheels, supported document formats, image delta |
| Embedding | Not admitted | sentence-transformers, Torch, hosted API client | No model selected; record exact weights | CPU/GPU decision required | Library and model licenses both required | Wheel/image delta, model download/cache policy, offline startup |
| RAG/chunking | Not admitted | Standard library first; evaluate LlamaIndex or LangChain only if justified | 0 now | CPU by default | Verify selected framework and transitive stack | Benchmark against a small in-house implementation; image delta |
| Workers | Not admitted | Celery and a broker only after an async workload exists | 0 | CPU plus external service | Verify client and server distribution terms | Separate Compose profile, persistence, ports, operational ownership |
| gRPC | Not admitted | grpcio/grpcio-tools after an ADR trigger is met | 0 | CPU | Verify runtime and generated-code licenses | Native wheels, generated stubs, toolchain pin, rollback path |

No row may change to admitted with `TBD` in the last four columns. Size figures must include both installed dependencies and container layer delta; embedding work must additionally record the exact model name, dimensions, weight size, CPU latency, GPU requirement, and model license.

## Operation

Data Services is opt-in and is not part of the default Compose stack:

```bash
pnpm docker:build:data
pnpm docker:up:data
```

The `data` profile currently starts only the contract service on loopback port 8000. Redis, Celery, model downloads, and Engine integration are intentionally absent until a capability passes the admission gate above.
