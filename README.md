# EncoreHub

跨平台 AI 聊天客户端 — 一个客户端聚合多家供应商，附带知识库、记忆、Skill、Plugin、MCP 能力。

> 状态：早期开发。骨架完整、核心功能可用，但 RAG/向量库、插件 WASM 沙箱、gRPC 全链路仍在路上。详见
> [`docs/IMPROVEMENT_REPORT.md`](docs/IMPROVEMENT_REPORT.md) 中按 P0/P1/P2 标注的差距清单。

## 架构速览

```
frontend (React + Tauri)  ──HTTP/SSE──>  gateway (Go) ──HTTP──>  engine (Rust)
                                                │                   │
                                            providers           SQLite + (LanceDB pending)
                                            (OpenAI / Anthropic / DeepSeek)
```

| 模块 | 语言 | 角色 |
|------|------|------|
| `frontend/` | TypeScript + React 18 + Tauri 2 | 桌面 UI、流式渲染、设置/Skill/Memory/Knowledge 面板、Slash 命令 |
| `gateway/` | Go 1.25 | HTTP/SSE 入口，多 provider 适配，认证/限流/CORS，引擎反向代理 |
| `engine/` | Rust (axum + tokio + rusqlite) | 对话/记忆/知识/Skill 存储与 API；监听 `127.0.0.1:3000` |
| `data-services/` | Python 3.12 (FastAPI) | RAG/embedding/文档解析（**目前为骨架，未接通**） |
| `proto/` | protobuf 定义 | gRPC schema（**目前 stub 未生成、未启用**） |

为什么是这种语言切分，见 [`docs/adr/0001-language-split.md`](docs/adr/0001-language-split.md)。

## Quickstart（开发模式）

需要：Node 22+ / pnpm 9 / Go 1.25 / Rust stable。

```bash
# 1. 启动 engine（Rust，监听 127.0.0.1:3000）
cd engine && cargo run --bin encorehub-engine

# 2. 启动 gateway（Go，监听 :8080）
cd gateway && go run ./cmd/gateway

# 3. 启动前端（Vite dev，1420）
cd frontend && pnpm install && pnpm dev
# 或 Tauri 桌面调试：
# cd frontend && pnpm tauri dev
```

打开 <http://localhost:1420>。在右下 Settings (`Ctrl/Cmd + ,`) → Providers 填一个 API key 即可对话。

## 配置

复制 `.env.example` → `.env`：

| 变量 | 默认 | 说明 |
|------|------|------|
| `LISTEN_ADDR` | `:8080` | gateway 监听 |
| `ENGINE_URL` | `http://127.0.0.1:3000` | gateway → engine |
| `ENGINE_BIND` | `127.0.0.1:3000` | engine 监听（容器里改 `0.0.0.0:3000`） |
| `ENCOREHUB_AUTH_TOKEN` | _空_ | 设了则 gateway `/api/v1/*` 校验 `Authorization: Bearer …`；前端通过 `VITE_AUTH_TOKEN` 传 |
| `ENCOREHUB_CORS_ORIGINS` | _空_ | 追加 CORS 来源（逗号分隔） |
| `ENCOREHUB_RATE_LIMIT_RPS` | `30` | 每 IP 限速 |
| `ENCOREHUB_RATE_LIMIT_BURST` | `60` | 每 IP 突发上限 |
| `ENCOREHUB_DEV_MOCK` | _空_ | `1`/`true` 时无 API key 也能拿到 mock 回复（仅本地） |

前端用 `frontend/.env.example` → `.env.local`：`VITE_GATEWAY_URL` / `VITE_ENGINE_URL` / `VITE_AUTH_TOKEN`。

## Ops & 可观测性

| Endpoint | 用途 |
|----------|------|
| `GET /api/v1/health` | gateway + engine 反向探活；返回 `{status, service, engine: {url, ok, latency_ms}}`。**永远 200**——即使 engine 不可达也是 200，靠 `engine.ok` 区分 readiness |
| `GET /metrics` | Prometheus 指标（公开，无 auth）。包含 `encorehub_gateway_requests_total{method,route,status}`、`encorehub_gateway_request_duration_seconds` 直方图、`encorehub_gateway_in_flight_requests` |

每个请求 gateway 会注入 `X-Request-ID`（如客户端已带则透传），并 reflect 到响应头；引擎下游调用同样透传，方便跨服务串联日志。

## 关键功能

- **多 provider**：OpenAI / Anthropic / DeepSeek（gateway 层内置）
- **流式 SSE**：可中断（前端 InputBox 的 Stop 按钮 / Esc）
- **Slash 命令**：在输入框打 `/` 出补全 — `/new /clear /stop /model /settings /skills /knowledge /memory /help`
- **设置面板**（`Ctrl/Cmd + ,`）：Providers / Skills / Knowledge / Memories / Appearance
- **RAG 上下文注入**：每次对话自动把 memory 与 knowledge 检索结果拼到 system prompt（top_k=3）
- **DuckDuckGo 网搜**：请求体加 `"search": true`

## 仓库导航

```
.
├── frontend/             React + Tauri
│   ├── src/components/   chat / sidebar / settings
│   ├── src/services/     api / chat / config (env-driven)
│   ├── src/stores/       zustand
│   └── src/commands/     slash 命令注册表
├── gateway/internal/
│   ├── handler/          chat / conversation / engine_proxy / search
│   ├── provider/         openai / anthropic / deepseek 适配
│   ├── router/           CORS / auth / rate-limit
│   └── engine/           Rust 引擎 HTTP 客户端
├── engine/
│   ├── src/api/          axum routes (conversations / memories / knowledge / skills)
│   └── crates/           core / storage / skill
├── data-services/        Python（骨架）
├── docs/
│   ├── IMPROVEMENT_REPORT.md   审计 + P0/P1/P2 差距
│   └── adr/                    架构决策记录
├── docker-compose.yml
└── DEVELOPMENT_PLAN.md   总体蓝图
```

## 测试与构建

```bash
# 整体构建（每个模块各自跑）
cd frontend     && pnpm lint && pnpm build
cd gateway      && go vet ./... && go build ./... && go test ./...
cd engine       && cargo fmt --check && cargo clippy && cargo test
cd data-services && uv sync && uv run ruff check src/ && uv run pytest
```

CI 配置见 `.github/workflows/ci.yml`，4 个语言并行 job。

## 安全说明

- 默认 CORS 只放 Tauri / `localhost:1420`；扩展请用 `ENCOREHUB_CORS_ORIGINS`。
- `ENCOREHUB_AUTH_TOKEN` 不设时 gateway 不强制 auth（适合本机 sidecar），任何网络暴露的部署 **必须** 设。
- 前端 API key 默认 **会话内存** 存放，不入 localStorage；若开发想持久化在 DevTools 里 `localStorage.setItem("encorehub-persist-keys", "1")`。生产应接 Tauri stronghold/keyring。

## 许可证

私有仓库，作者保留所有权利。
