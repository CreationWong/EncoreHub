# EncoreHub

AI 聊天桌面客户端 — 一个客户端聚合多家供应商，附带知识库、记忆、Skill、Plugin、MCP 能力。

> 状态：早期开发。骨架完整、核心功能可用（多供应商聊天、模板化供应商、密钥加密、token 计数、端口协商、开发者模式），但 RAG/向量库、插件 WASM 沙箱、gRPC 全链路仍在路上。详见
> [`docs/REMAINING_WORK.md`](docs/REMAINING_WORK.md) 与 [`docs/IMPROVEMENT_REPORT.md`](docs/IMPROVEMENT_REPORT.md) 中按 P0/P1/P2 标注的差距清单。
> 当前尚未声明正式平台支持：Windows 开发路径可用，Windows/macOS/Linux 均进入 CI 编译与 no-bundle smoke；各平台完成安装后启动验收前都视为预发布。

## 架构速览

```
frontend (React + Tauri 2) ──HTTP/SSE──> gateway (Go) ──HTTP──> engine (Rust, axum)
      │                                         │                    │
      │  Tauri 桌面壳：engine 跑在进程内          │ 多 provider 适配    │ SQLite + LanceDB(pending)
      │  (tokio task)，gateway 为唯一 sidecar     │ (OpenAI / Anthropic │ 密钥加密(AES-256-GCM)
      │                                         │  / DeepSeek)        │ 对话/记忆/知识/Skill
```

| 模块 | 语言 | 角色 |
|------|------|------|
| `frontend/` | TypeScript + React 18 + Tauri 2 | 桌面 UI、流式 SSE、token 计数展示、设置/Skill/Memory/Knowledge/Security/Developer 面板、Slash 命令；Tauri 层启动 engine in-process + 拉起 gateway sidecar，端口自动协商，日志落盘 |
| `gateway/` | Go 1.25 (Gin) | HTTP/SSE 入口，模板化多 provider 适配，认证/限流/CORS，引擎反向代理 |
| `engine/` | Rust (axum + tokio + rusqlite) | 对话/记忆/知识/Skill/密钥 存储与 API；AES-256-GCM 密钥加密；token 计数器（conversation crate）；桌面模式下 Tauri 在进程内启动 axum，无头模式编译为独立二进制 |
| `data-services/` | Python 3.12 (FastAPI) | RAG/embedding/文档解析（**目前为骨架，未接通**） |
| `proto/` | protobuf 定义 | gRPC schema（**目前 stub 未生成、未启用**） |

为什么是这种语言切分，见 [`docs/adr/0001-language-split.md`](docs/adr/0001-language-split.md)。

## Quickstart（开发模式）

需要：Node 22+ / pnpm 10 / Go 1.25 / Rust stable。

```bash
pnpm setup
pnpm dev
```

`pnpm dev` 会构建当前平台的 Gateway sidecar 并启动 Tauri；Engine 在桌面进程内运行，内部 token 自动生成。在右下 Settings (`Ctrl/Cmd + ,`) → Providers 填一个 API key 即可对话。只调试单个组件时使用 `pnpm dev:frontend`、`pnpm dev:gateway`、`pnpm dev:engine` 或 `pnpm dev:data`。

## 配置

复制 `.env.example` → `.env`：

| 变量 | 默认 | 说明 |
|------|------|------|
| `LISTEN_ADDR` | `127.0.0.1:8080` | gateway 监听 |
| `ENGINE_URL` | `http://127.0.0.1:3000` | gateway → engine |
| `ENGINE_BIND` | `127.0.0.1:3000` | engine 监听（容器里改 `0.0.0.0:3000`） |
| `ENCOREHUB_ENGINE_AUTH_TOKEN` | 无 | Engine 内部 Bearer token；standalone/Docker 必填，Engine 与 Gateway 必须相同；Tauri 每次启动自动生成 |
| `ENCOREHUB_AUTH_TOKEN` | _空_ | 设了则 gateway `/api/v1/*` 校验 `Authorization: Bearer …`；前端通过 `VITE_AUTH_TOKEN` 传 |
| `ENCOREHUB_GATEWAY_HOST` | `127.0.0.1` | Compose 的 Gateway host binding；仅显式网络部署时改为 `0.0.0.0` |
| `ENCOREHUB_CORS_ORIGINS` | _空_ | 追加 CORS 来源（逗号分隔） |
| `ENCOREHUB_RATE_LIMIT_RPS` | `30` | 每 IP 限速 |
| `ENCOREHUB_RATE_LIMIT_BURST` | `60` | 每 IP 突发上限 |
| `ENCOREHUB_RATE_LIMIT_TTL_SECONDS` | `600` | 空闲 client limiter 回收时间 |
| `ENCOREHUB_RATE_LIMIT_MAX_CLIENTS` | `10000` | limiter store 硬容量；满时淘汰最久未使用项 |
| `ENCOREHUB_TRUSTED_PROXIES` | _空_ | 可提供转发 IP 的代理 IP/CIDR（逗号分隔）；桌面/直连模式保持为空 |
| `ENCOREHUB_DEV_MOCK` | _空_ | `1`/`true` 时无 API key 也能拿到 mock 回复（仅本地） |

前端用 `frontend/.env.example` → `.env.local`：`VITE_GATEWAY_URL` / `VITE_AUTH_TOKEN`。React 不配置或直连 Engine。

Compose 显式网络部署必须同时启用独立的 Gateway 外部认证；不要复用 Engine 内部 token：

```dotenv
ENCOREHUB_GATEWAY_HOST=0.0.0.0
ENCOREHUB_AUTH_TOKEN=<独立生成的随机值>
```

### 端口协商

- **Client / Tauri 模式**：`ENGINE_BIND` 与 `LISTEN_ADDR` 未设时，桌面壳从 10000 向上自动扫描可用端口（engine 先、gateway 后）。前端通过 `get_service_ports` Tauri command 获取端口并构建 API URL。
- **Headless / 开发模式**：端口始终走 env（`ENGINE_BIND`、`LISTEN_ADDR`），或使用 loopback 默认值 `127.0.0.1:3000` / `127.0.0.1:8080`。
- 固定端口只需设上述 env 变量即可。

## Ops & 可观测性

| Endpoint | 用途 |
|----------|------|
| `GET /api/v1/health/live` | Gateway 进程 liveness；不探测依赖，进程可响应即返回 200 |
| `GET /api/v1/health/ready` | Gateway + Engine database readiness；返回 `{status, service, engine: {url, ok, latency_ms}}`，依赖失败返回 503 |
| `GET/POST /api/v1/log-level` | 读取/设置运行时日志等级（`error\|warn\|info\|debug`）。POST 立即应用到 gateway(zerolog)与 engine(tracing reload)，并持久化到引擎 config，重启保留 |
| `GET /metrics` | Prometheus 指标（公开，无 auth）。包含 `encorehub_gateway_requests_total{method,route,status}`、`encorehub_gateway_request_duration_seconds` 直方图、`encorehub_gateway_in_flight_requests` |

监控与进程重启探针使用 `/health/live`；启动门禁、流量接入和 Compose dependency 使用 `/health/ready`。Search API 的 JSON body 上限为 8 KiB，query 最多 500 个 Unicode code point，`max_results` 为 1-10；任一远端搜索响应最多读取 2 MiB。

每个请求 gateway 会注入 `X-Request-ID`（如客户端已带则透传），并 reflect 到响应头；引擎下游调用同样透传，方便跨服务串联日志。

**桌面数据与日志**：Tauri 把数据库写到系统 `app_data_dir/data/encorehub.db`，把 engine/gateway/desktop 三方脱敏日志写到 `app_data_dir/log/encorehub-YYYY-MM-DD.log`，按天切分、保留 7 天。Windows 旧版 executable directory 下的 `data/`、`log/` 会先复制并逐文件校验，再写迁移 marker；旧副本不在应用启动时删除。升级和卸载不会删除新的 app data，旧安装目录副本只在显式卸载时由 installer hook 清理。

## 关键功能

- **多 provider（模板化）**：内置 OpenAI / Anthropic / DeepSeek，并支持新增/编辑/删除自定义供应商、改端节点(base_url)、编辑模型列表。档案持久化在引擎，网关运行时热加载
- **流式 SSE**：可中断（前端 InputBox 的 Stop 按钮 / Esc）；支持 reasoning（chain-of-thought）可见可折叠
- **Token 计数**：每次对话后 assistant 消息右上角显示 input+output token 总数（如 `1.2k tokens`）；引擎 `conversation` crate 提供 char/4 近似估算 + API 用量追踪
- **端口自动协商**：Tauri 桌面模式下从 10000 自动找可用端口，避免多实例冲突；headless 模式走 env 固定端口
- **Slash 命令**：在输入框打 `/` 出补全 — `/new /clear /stop /model /settings /skills /knowledge /memory /help`
- **设置面板**（`Ctrl/Cmd + ,`）：Providers / Skills / Knowledge / Memories / Security / Appearance（开启开发者模式后多一个 Developer 标签）
- **密钥加密（可选）**：Security 标签设主密码后，API key 以 AES-256-GCM 加密落库（Argon2id 派生主密钥）。开启后每次打开需解锁；主密钥仅驻内存。保护**静态磁盘泄露**，不防运行中已解锁会话。未开启时密钥明文落库或仅会话内存
- **开发者模式**：Appearance 里开启后，Developer 标签可看 engine/gateway/desktop 三方存活状态（含动态端口号）、实时日志（按来源/级别过滤、搜索、导出），并运行时调整日志等级
- **RAG 上下文注入**：每次对话自动把 memory 与 knowledge 检索结果拼到 system prompt（top_k=3）
- **联网搜索**：点击输入框地球图标开启后，模型获得 `web_search` 工具，可主动搜索网页（DuckDuckGo/Bing/Google）。搜索结果作为 tool result 返回模型，模型引用来源生成回复

## 仓库导航

```
.
├── frontend/             React + Tauri
│   ├── src/components/   chat / sidebar / settings
│   ├── src/services/     api / chat / config (env-driven + Tauri port negotiation)
│   ├── src/stores/       zustand
│   ├── src/commands/     slash 命令注册表
│   └── src-tauri/        Tauri 桌面壳：engine in-process、gateway sidecar、端口协商、日志落盘、打包配置
├── gateway/internal/
│   ├── handler/          chat / conversation / engine_proxy / search / loglevel / 供应商档案
│   ├── provider/         openaicompat(模板) / anthropic 适配 + 运行时 registry
│   ├── router/           CORS / auth / rate-limit
│   └── engine/           Rust 引擎 HTTP 客户端
├── engine/
│   ├── src/api/          axum routes (conversations / memories / knowledge / skills / config / secrets)
│   ├── src/crypto.rs     AES-256-GCM + Argon2id 密钥加密
│   ├── src/logging.rs    运行时日志等级 reload
│   ├── src/lib.rs        serve() + find_free_port() — Tauri 共用入口
│   └── crates/           core / conversation(token 计数) / storage / skill
├── scripts/              workspace contract、sidecar 准备及平台构建脚本
├── data-services/        Python（骨架）
├── docs/
│   ├── REMAINING_WORK.md      剩余工作 + 最近完成
│   ├── IMPROVEMENT_REPORT.md  审计 + P0/P1/P2 差距
│   └── adr/                   架构决策记录
├── docker-compose.yml
├── package.json          唯一规范的 workspace 命令入口
└── DEVELOPMENT_PLAN.md   总体蓝图
```

## 测试与构建

```bash
# 快速检查（不产构建产物）
pnpm check

# Engine standalone + Gateway + Frontend
pnpm build

# 测试 & Lint
pnpm test
pnpm lint
pnpm format

# Docker
pnpm docker:build
pnpm docker:up
pnpm docker:ps
```

CI 配置见 `.github/workflows/ci.yml`，包含 Frontend、Gateway、Engine、Windows/macOS/Linux Desktop、Data Services 与 Container gate。

## 桌面打包

```bash
# 构建当前平台的 Gateway sidecar 与 Tauri 安装包
pnpm build:desktop
```

产物在 `frontend/src-tauri/target/release/bundle/`；Windows 生成 `msi/` 与 `nsis/`。脚本会为当前 Rust host target 构建 Gateway sidecar，Tauri 运行时通过官方 sidecar resolver 启动；Engine 已内嵌在 Tauri 进程中。macOS/Linux 安装包在完成对应平台安装后 smoke 前不作为受支持发布物。

## 安全说明

- Gateway 默认 CORS 只放 Tauri webview（`tauri://localhost`、`http(s)://tauri.localhost`）与 `localhost:1420`；扩展请用 `ENCOREHUB_CORS_ORIGINS`。
- Engine 不提供浏览器 CORS；仅 `/health/live` 公开，`/health/ready` 和全部业务路由强制校验 `ENCOREHUB_ENGINE_AUTH_TOKEN`。Compose 不向宿主机发布 Engine 端口。
- Gateway 默认不信任 `X-Forwarded-For`；仅部署在明确代理后方时配置 `ENCOREHUB_TRUSTED_PROXIES`。
- `ENCOREHUB_AUTH_TOKEN` 不设时 gateway 不强制 auth（适合本机 sidecar），任何网络暴露的部署 **必须** 设。
- **API key 存储**：默认仅会话内存，不入 localStorage。在 Security 标签开启加密后，key 以 AES-256-GCM 加密落引擎库（Argon2id 派生主密钥、随机 salt、verifier 校验口令），主密钥仅驻内存、关闭即清。此方案保护**静态磁盘泄露**，不防运行中已解锁会话或渲染层 XSS。忘记主密码不可恢复（只能清空重填）。
- 密钥/口令全程作为不透明字符串处理，不进日志/落盘（日志写盘前统一脱敏）。
- Gateway 在 Tauri 模式和默认 Compose 配置下绑定 `127.0.0.1`，仅显式网络部署才允许覆盖。

## 许可证

私有仓库，作者保留所有权利。
