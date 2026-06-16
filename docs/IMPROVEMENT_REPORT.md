# EncoreHub 代码改进报告

**生成日期**: 2026-06-16
**审计范围**: 全仓库（frontend / gateway / engine / data-services / proto / plugins / docs / CI）
**对照基线**: `DEVELOPMENT_PLAN.md` (Phase 1–4 蓝图)

---

## 一、TL;DR

工程骨架已搭好（4 语言工作区、CI、Tauri 打包、3 个 Provider 适配器），但**实现深度远落后于蓝图**。核心智能能力（RAG/向量库/插件沙箱/记忆系统/Python 数据服务）均为空壳；gRPC 架构只停留在依赖声明层，实际服务间通信靠 HTTP/JSON；测试、README、ADR 三项基础工程资产几乎缺失。

按优先级，建议先解决 **CI 红线（P0）→ 安全与配置一致性（P0）→ 核心能力补齐（P1）→ 工程质量（P2）** 四档。

---

## 二、立即修复（P0：阻断或高风险）

### 2.1 CI Go 版本不匹配，构建必然失败
- 现状：`go.mod` 声明 `go 1.25.0`，`.github/workflows/ci.yml` 用 `go-version: "1.23"`。
- 影响：CI 上 `go build` 直接失败；现在能通过的工作流可能是因为只跑了部分 job 或 cache。
- 修复：将 CI 升至 `1.25.x`，或把 `go.mod` 降到 `1.23`（推荐前者，与依赖兼容性更好）。

### 2.2 Docker Compose 端口与运行时不一致
- 现状：`docker-compose.yml` 配 `ENGINE_ADDR=engine:50051`，但 Rust 引擎实际监听 `127.0.0.1:3000`（`engine/src/main.rs`）。
- 影响：`docker compose up` 起不来联调链路。
- 修复：要么把引擎改成 axum + tonic 双监听，要么把 compose 改成 `ENGINE_URL=http://engine:3000` 并去掉 50051 暴露。

### 2.3 环境变量名混乱
- 现状：`.env.example` 用 `ENGINE_ADDR`，`gateway/cmd/gateway/main.go` 读 `ENGINE_URL`，compose 又是 `ENGINE_ADDR`。
- 修复：统一到 `ENGINE_URL`（已在代码里使用），更新 `.env.example` 与 compose。

### 2.4 安全 — Gateway 缺认证、限流、CORS 收紧
- 现状：`gateway/internal/router/router.go` 仅挂 Logger/Recovery/CORS，且 `Access-Control-Allow-Origin: *` 通配。无 API key 校验、无 rate limiter，蓝图承诺的 `ratelimit/` 目录不存在。
- 影响：本地桌面应用尚可，但任何暴露在网络上的部署都是**裸奔**。`X-Provider-Key` 明文头转发也会被中间人截获。
- 修复路径：
  1. 引入最简 token 中间件（前端在 Tauri 启动时注入随机 token，gateway 校验）。
  2. 用 `tollbooth` 或 `golang.org/x/time/rate` 加按 IP/Token 的限流。
  3. CORS 改成 allowlist（`tauri://localhost`, `http://localhost:1420`）。

### 2.5 Mock 代码残留生产路径
- `gateway/internal/handler/chat.go` 中 `generateMockReply`/`mockStream`/`mockReply` 仍在调用链上。
- `engine/src/api/conversations.rs:322` 注释 *Mock AI Logic (placeholder until Go gateway is ready)* 仍在跑。
- 修复：用 feature flag 或环境开关把 mock 隔离到 dev 模式，正式路径直接走 provider。

---

## 三、核心能力补齐（P1：蓝图承诺 vs 现实）

下表是蓝图声明 vs 当前代码状态的差距清单：

| 能力 | 蓝图位置 | 现状 | 建议 |
|------|----------|------|------|
| LanceDB 向量库 | DEVELOPMENT_PLAN §3 | `engine/crates/storage/src/lancedb/mod.rs` 三处 TODO，连接/插入/相似度全空 | 先打通连接 + 单表 upsert/query；用 `arrow-rs` 0.55+ |
| RAG 管线 | §3 数据处理 | `data-services/src/main.py` 5 条 TODO，仅 30 行 FastAPI 框架 | 切实现：分块 → embedding → 写 LanceDB → query 接口；先 OpenAI/Bge embedding 二选一 |
| Python 数据服务 | §3 | `__init__.py` 空，`main.py` 全占位 | 见上；先做 `/ingest` `/search` 两个 endpoint |
| WASM 插件沙箱 | §3 Plugin 系统 | `plugins/hello-world/plugin.json` 一个清单，引擎里 wasmtime 已被注释 | 启用 wasmtime；定义 plugin host ABI；先支持 stdout-only 插件 |
| MCP Client | §3 | 仅 `engine/src/mcp_server.rs` 单向 server | 加 client 侧多传输层（stdio/sse/http）|
| 记忆系统 / 知识图谱 | §3 | 只有 SQLite 元数据 CRUD，无向量检索 | 待 LanceDB 通畅后接上 |
| gRPC 全链路 | §2 架构图 | 6 个 `.proto`，0 个 `.pb.go/_pb2.py/.pb.rs`；`buf.gen.yaml` 存在但未跑 | 跑 `buf generate`，让 gateway↔engine↔data-services 至少有一对走 gRPC，验证链路 |

---

## 四、工程质量（P2：可持续性）

### 4.1 测试覆盖近乎为零
- Go: 0 个 `_test.go` 文件
- 前端: 0 个 `.test.tsx` / `.test.ts`
- Python: 0 个 `test_*.py`
- Rust: 仅 `skill/parser.rs`、`storage/sqlite/migrations.rs` 含 `#[test]`

CI 却在跑 `go test ./...` / `cargo test` / `pytest` / `pnpm test`——是**绿色的因为没有测试可以失败**，不是因为代码经过了验证。建议：
1. 每个 provider 适配器（OpenAI/Anthropic/DeepSeek）至少加一组对 SSE 解析的 table-driven test。
2. Rust 引擎给 `storage::sqlite` 与 `api::conversations` 各加 1–2 个集成测试（用 `:memory:` SQLite）。
3. 前端给 `conversationStore` 写一组 zustand store 单测。

### 4.2 README/ADR 缺失
- 根目录无 `README.md`，子模块也没有。新人首次接触只能读 30KB 的 `DEVELOPMENT_PLAN.md`。
- `docs/adr/` 存在但为空。
- 建议立刻补：
  - 根 `README.md`：项目定位、quickstart（一条命令起本地栈）、目录导航。
  - `docs/adr/0001-language-split.md`：解释为何选择 Go/Rust/Python 三语言。
  - `docs/adr/0002-grpc-vs-http.md`：把现在的 HTTP 现状与未来 gRPC 计划写下来，避免下次又走偏。

### 4.3 依赖膨胀，声明但零引用
Gateway 的 `go.mod` 引入了 `sony/gobreaker`、`go-redis/v9`、`gorilla/websocket`、`prometheus/client_golang`、`go.opentelemetry.io/otel`，但 `gateway/internal/` 下 0 处引用。建议：
- 要么本期就把熔断 + 指标接上（`/metrics` endpoint，每个 provider 一个 circuit breaker）；
- 要么从 `go.mod` 移除，用到再加。

### 4.4 Rust 异常处理的 panic 隐患
`engine/src/api/skills.rs:44,70,84` 对 `Mutex.lock().unwrap()`，`mcp_server.rs` 多处 `serde_json::...unwrap()` 处于请求处理路径上。建议：
- Mutex：`PoisonError` 在 axum handler 里用 `?` + `IntoResponse` 转 500，不要 unwrap。
- JSON：解析错误返回 400，序列化错误返回 500。

### 4.5 日志栈不统一
Go 网关混用 zerolog 与声明的 zap；Rust 用 tracing；Python 未配。建议全栈统一 JSON 行格式 + 字段约定（`request_id`/`provider`/`model`/`latency_ms`），便于以后接 Loki/ClickHouse。

### 4.6 前端骨架空壳目录
`frontend/src/components/{knowledge,settings}/` 创建了但几乎没文件。要么本周补上，要么先删掉避免误导。

---

## 五、安全清单（值得单独 review 一遍）

1. CORS `*` → allowlist。
2. `X-Provider-Key` 明文转发 → 在 gateway 层做密钥代管，用户 token 与 provider key 解耦。
3. 前端 `settingsStore.ts` 当前不持久化 API key 是合理的——明确**不要**为了方便加 localStorage 持久化，要走 Tauri secure storage / OS keychain。
4. SQLite 文件路径默认在用户目录，权限默认 0644——Windows 不太敏感，但 Linux/macOS 建议 0600。
5. CI 应加 `gosec` / `cargo-audit` / `pip-audit` / `npm audit`。

---

## 六、建议的执行顺序（4–6 周节奏）

**Week 1（救火）**
- 修 CI Go 版本、统一 `ENGINE_URL`、修 compose、收紧 CORS、加最简 token 中间件、清理 mock 代码。

**Week 2（写文档+测试地基）**
- 补根 `README.md` 与两份 ADR。
- 给 3 个 provider 适配器写 SSE 解析单测，给 Rust storage 写 in-memory 集成测试。

**Week 3–4（核心能力 1：RAG）**
- 跑通 LanceDB 连接 + 简单 upsert/query。
- Python 数据服务实现 `/ingest`、`/search`，先用 OpenAI embedding。
- 前端加最小知识库页面验证端到端。

**Week 5（核心能力 2：插件 + gRPC）**
- 跑 `buf generate`，把 gateway→engine 的对话接口先迁一条到 gRPC。
- 启用 wasmtime，跑通 hello-world 插件。

**Week 6（生产化）**
- 接入 prometheus `/metrics`、gobreaker；
- 加 `cargo-audit`/`gosec`/`npm audit` 到 CI；
- 跑一次实际 Tauri 安装包冒烟测试。

---

## 七、附：本次审计未深入的盲区

- 未实测安装包（`test-install/` 目录存在但未验证）；
- 未审计 Tauri `tauri.conf.json` 的 `allowlist` 是否过宽；
- 未对 SSE 流处理做并发压力测试；
- `skills/` 目录内容未深入解读，仅看了 parser 测试。

如要进一步深入任一方向，建议按"P0→P1→P2"清单逐项开 issue 跟踪。
