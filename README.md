# EncoreHub

AI 聊天桌面客户端 — 在一个跨平台桌面工作区中聚合多家模型供应商，并提供角色档案、知识库、记忆、Skill、Plugin 与 MCP 能力。

> 状态：早期开发。骨架完整、核心功能可用（多供应商聊天、角色档案、Knowledge/Memory 本地向量检索、文件上传、密钥加密、token 计数、端口协商、开发者模式），但插件 WASM 沙箱、混合排序和 gRPC 全链路仍在路上。统一待办见 [`docs/REMAINING_WORK.md`](docs/REMAINING_WORK.md)。
> 当前尚未声明正式平台支持：Windows 开发路径可用，Windows/macOS/Linux 均进入 CI 编译与 no-bundle smoke；各平台完成安装后启动验收前都视为预发布。

## 架构速览

```
frontend (React + Tauri 2) ──HTTP/SSE──> gateway (Go) ──HTTP──> engine (Rust, axum)
      │                                         │                    │
      │  Tauri 桌面壳 + Engine Runtime 动态库      │ 多 provider 适配    │ SQLite/SQLite-Vec + LanceDB
      │  (.dll/.so/.dylib) + gateway sidecar       │ (OpenAI / Anthropic │ 密钥加密(AES-256-GCM)
      │                                         │  / DeepSeek)        │ 对话/记忆/知识/Skill
```

| 模块 | 语言 | 角色 |
|------|------|------|
| `frontend/` | TypeScript + React 18 + Tauri 2 | 桌面 UI、流式 SSE、token 计数展示、设置/Skill/Memory/Knowledge/Web Search/Security/Developer 面板、Slash 工具补全；Tauri 通过版本化 C ABI 加载 Engine Runtime 动态库并拉起 Gateway sidecar，端口自动协商，日志落盘 |
| `gateway/` | Go 1.25 (Gin) | HTTP/SSE 入口，模板化多 provider 适配，内置联网搜索工具，认证/限流/CORS，引擎反向代理 |
| `engine/` | Rust (axum + tokio + rusqlite + LanceDB) | 对话/记忆/知识/附件/Skill/密钥存储与 API；Rust 文档解析与分块；LanceDB Knowledge 主索引；SQLite-Vec Knowledge 回退和单轮 Memory 索引；桌面模式产出 Engine Runtime 与独立 RUSTScrapling 动态库 |
| `proto/` | protobuf 定义 | gRPC schema（**目前 stub 未生成、未启用**） |

为什么是这种语言切分，见 [`docs/adr/0001-language-split.md`](docs/adr/0001-language-split.md)；桌面 Engine 进程模型与内部认证见 [`docs/adr/0004-engine-in-process-and-internal-auth.md`](docs/adr/0004-engine-in-process-and-internal-auth.md)；可独立升级的桌面模块边界见 [`docs/adr/0008-versioned-desktop-runtime-modules.md`](docs/adr/0008-versioned-desktop-runtime-modules.md)；角色版本与对话快照边界见 [`docs/adr/0005-character-profile-snapshots.md`](docs/adr/0005-character-profile-snapshots.md)。

## Quickstart（开发模式）

需要：Node 20+ / pnpm 10 / Go 1.25 / Rust stable，以及 [Tauri 2 对应平台的系统依赖](https://v2.tauri.app/start/prerequisites/)。标准构建脚本优先使用 `PROTOC` 或 PATH 中的 `protoc`，未安装时通过 Cargo 自动解析当前平台的 vendored binary。直接运行 Cargo 时仍需自行设置 `PROTOC`。Pandoc 可选，用于更高保真地转换富文本；未安装时 Engine 使用原生 Rust 解析器。

```bash
pnpm setup
pnpm dev
```

`pnpm dev` 会构建当前平台的 Gateway sidecar 并启动 Tauri；Engine 在桌面进程内运行，内部 token 自动生成。通过右上角 Settings 齿轮（或 `Ctrl/Cmd + ,`）打开设置工作区，在 Providers 中填入 API key 即可对话。

只调试单个组件时使用 `pnpm dev:frontend`、`pnpm dev:gateway` 或 `pnpm dev:engine`。Knowledge、Memory、文档处理与向量检索均由 Engine 进程内完成，不需要额外数据服务。

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
| `ENCOREHUB_LANCEDB_PATH` | `<engine data>/lancedb` | 可选的 LanceDB 本地目录覆盖；默认与 Engine SQLite 数据目录同属 app data |
| `ENCOREHUB_DEV_MOCK` | _空_ | `1`/`true` 时无 API key 也能拿到 mock 回复（仅本地） |

前端用 `frontend/.env.example` → `.env.local`：`VITE_GATEWAY_URL` / `VITE_AUTH_TOKEN`。React 不配置或直连 Engine。

Compose 显式网络部署必须同时启用独立的 Gateway 外部认证；不要复用 Engine 内部 token：

```dotenv
ENCOREHUB_GATEWAY_HOST=0.0.0.0
ENCOREHUB_AUTH_TOKEN=<独立生成的随机值>
```

### 端口协商

- **Client / Tauri 模式**：`ENGINE_BIND` 与 `LISTEN_ADDR` 未设时，桌面壳从 10000 向上自动扫描可用端口（engine 先、gateway 后）。前端通过 `get_service_ports` Tauri command 只获取 Gateway 端口并构建 API URL。
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

浏览器侧 Gateway API 的规范契约见 [`docs/openapi.json`](docs/openapi.json)；第三方 API 快照统一放在 [`docs/vendor/`](docs/vendor/README.md)，不代表 EncoreHub 路由。

**桌面数据与日志**：Tauri 在所有桌面平台上把可变状态统一写到系统 `app_data_dir`：数据库位于 `data/encorehub.db`，脱敏日志位于 `log/encorehub-YYYY-MM-DD.log`。日志按天切分并保留 7 天。Developer 面板可打开日志目录，并通过原生 Tauri 命令把当前筛选结果导出到系统 Downloads；Downloads 不可用时回退到 `app_data_dir/log`。安装目录只承载运行库、可执行文件、打包资源和启动配置；启动配置来自打包文件、环境变量或进程内生成值，不写入 SQLite。Windows 旧版安装目录中的 `data/`、`log/` 仍作为只读迁移源执行一次性复制校验与 marker 迁移。

## 关键功能

- **多 provider（模板化）**：内置 OpenAI / Anthropic / DeepSeek，并支持新增/编辑/删除自定义供应商、改端节点(base_url)、编辑模型列表。档案持久化在引擎，网关运行时热加载
- **流式 SSE**：可中断（前端 InputBox 的 Stop 按钮 / Esc）；支持 reasoning（chain-of-thought）可见可折叠
- **Token 计数**：每次对话后 assistant 回复右下角显示 input+output token 总数（如 `1.2k tokens`）；引擎 `conversation` crate 提供 char/4 近似估算 + API 用量追踪
- **端口自动协商**：Tauri 桌面模式下从 10000 自动找可用端口，避免多实例冲突；headless 模式走 env 固定端口
- **Slash 工具请求**：输入 `/` 显示可扩展的 LLM 工具补全，不包含设置、新建等应用快捷入口。`/web_search 查询内容` 会忽略普通联网搜索开关，先强制调用 Web Search 设置中选定的 Provider，再把原问题与搜索结果一并交给 LLM
- **工作区标签**：Home 常驻；Workbench 与 Settings 可按需打开、切换和关闭，设置快捷键为 `Ctrl/Cmd + ,`
- **设置工作区**：Providers / Web Search / Skills / Knowledge / Memories / Security / Appearance / About（开启开发者模式后多一个 Developer 分区）
- **密钥加密（可选）**：Security 标签设主密码后，API key 以 AES-256-GCM 加密落库（Argon2id 派生主密钥）。开启后每次打开需解锁；主密钥仅驻内存。保护**静态磁盘泄露**，不防运行中已解锁会话。未开启时密钥明文落库或仅会话内存
- **开发者模式**：Appearance 里开启后，Developer 标签可看 engine/gateway/desktop 三方存活状态（含动态端口号）、实时日志（按来源/级别过滤、搜索、导出），并运行时调整日志等级
- **RAG 上下文注入**：每次对话自动把 memory 与 knowledge 检索结果拼到 system prompt（top_k=3）
- **联网搜索**：Gateway 内置 `web_search` 系统工具，不依赖或暴露为 Skill。输入区地球菜单控制当前对话是否允许搜索；默认使用 DuckDuckGo Instant Answer API，也可在 Web Search 设置中选择自定义 SearXNG 或 OpenSERP JSON 接口。搜索不抓取搜索引擎 HTML、不运行浏览器，也没有 CAPTCHA 交互或隐式 provider 降级
- **网页读取**：`web_fetch` 由 Engine 内的 Curl 执行 DNS、重定向、超时、大小限制和 SSRF 策略；HTML 交给同目录独立打包的 RUSTScrapling 动态库提取正文，脚本、样式和页面 chrome 不进入模型上下文

## 仓库导航

```
.
├── frontend/             React + Tauri
│   ├── src/components/   chat / sidebar / settings / workspace
│   ├── src/services/     api / chat / config / webSearch (Engine-backed settings)
│   ├── src/stores/       zustand
│   ├── src/tools/        Slash LLM 工具展示元数据
│   └── src-tauri/        Tauri 桌面壳：engine in-process、gateway sidecar、端口协商、日志落盘、打包配置
├── gateway/internal/
│   ├── handler/          chat / conversation / engine_proxy / search + config / loglevel / 供应商档案
│   ├── provider/         openaicompat(模板) / anthropic 适配 + 运行时 registry
│   ├── router/           CORS / auth / rate-limit
│   ├── search/           DuckDuckGo Instant Answer / SearXNG / OpenSERP Provider
│   └── engine/           Rust 引擎 HTTP 客户端
├── engine/
│   ├── src/api/          axum routes (conversations / memories / knowledge / skills / config / secrets)
│   ├── src/crypto.rs     AES-256-GCM + Argon2id 密钥加密
│   ├── src/logging.rs    运行时日志等级 reload
│   ├── src/lib.rs        serve() + find_free_port() — Tauri 共用入口
│   └── crates/           core / conversation(token 计数) / storage / skill
├── scripts/              workspace contract、sidecar 准备及平台构建脚本
├── docs/
│   ├── RUST_DATA_PIPELINE.md  Rust 文档、向量与回退契约
│   ├── REMAINING_WORK.md      统一待办与发布验收清单
│   ├── openapi.json           EncoreHub Gateway API 契约
│   ├── vendor/                第三方 API 参考快照（非项目契约）
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
pnpm test:docs
pnpm lint
pnpm format

# Docker
pnpm docker:build
pnpm docker:up
pnpm docker:ps

```

CI 配置见 `.github/workflows/ci.yml`，包含 Docs、Frontend、Gateway、Engine、Windows/macOS/Linux Desktop 与 Container gate。

Frontend production build 会检查首屏静态 JavaScript 依赖闭包，默认 gzip budget 为 300 KiB。运行 `pnpm --dir frontend analyze:bundle` 可在 `frontend/dist/` 生成 `bundle-analysis.json`（chunk/module 明细）和 `bundle-budget.json`（首屏闭包与预算结果）；CI 始终保留这两份统计。只有在计划性收紧阈值时才设置 `BUNDLE_BUDGET_KIB`，不得用它放宽 CI gate。

## 桌面打包

```bash
# 构建当前平台的 Engine Runtime、Gateway 与 Tauri 桌面程序
pnpm build:desktop

# 仅升级 Engine Runtime 动态库
pnpm build:components -- --components engine --release

# 同时构建 Engine Runtime 与 Gateway，不重建桌面程序
pnpm build:components -- --components engine,gateway --release
```

完整产物仍在 `frontend/src-tauri/target/release/bundle/`。桌面运行单元分为 `EncoreHub` 主程序、`encorehub_desktop_runtime.dll` / `libencorehub_desktop_runtime.so` / `libencorehub_desktop_runtime.dylib`、独立的 `encorehub_rust_scrapling.dll` / `libencorehub_rust_scrapling.so` / `libencorehub_rust_scrapling.dylib`、同目录动态链接的 libcurl 原生库、`encorehub-gateway` sidecar 和只读资源。Engine Runtime 使用版本化 C ABI，模块清单会记录主 Runtime、RUSTScrapling companion 及其 ABI、大小、SHA-256 和原生依赖；桌面构建会拒绝静态回退、缺少 companion/libcurl 或 ABI 不兼容的产物。Windows 构建会通过仓库 `vcpkg.json` 将 shared triplet 安装到 `.cache/vcpkg-runtime`；可通过 `VCPKG_EXE` 指定 vcpkg，Visual Studio 常见安装位置会自动探测。Linux 需要 shared libcurl 开发包，macOS 使用 Homebrew curl，打包脚本会保留或重写同目录加载路径。PowerShell 可使用 `.\scripts\build.ps1 -Components engine,gateway`，Unix 可使用 `./scripts/build.sh --components engine,gateway`。macOS/Linux 安装包在完成对应平台安装后 smoke 前不作为受支持发布物。

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
