# EncoreHub 项目问题分析与改进报告

> 审查日期：2026-07-12
> 审查基线：`master` / `0241cef`
> 审查范围：`frontend/`、`frontend/src-tauri/`、`gateway/`、`engine/`、`data-services/`、Docker、CI、根级脚本与主要文档
> 结论性质：代码与本地验证结果的静态审计，不包含真实供应商 API、打包安装器或多操作系统的端到端验收
> 执行计划：[IMPROVEMENT_WORKFLOW.md](IMPROVEMENT_WORKFLOW.md)

## 1. 结论摘要

EncoreHub 的核心功能已经具备一定自动化测试基础：前端 128 个测试、Rust workspace 45 个测试、Tauri 10 个测试在本机通过，Go vet 与 Rust clippy 也通过。当前问题不在于“完全没有实现”，而在于安全边界、持久化语义、发布路径和工程基线没有同时收敛。

当前版本不应作为可分发版本发布，主要原因如下：

1. **存在两个停止发布级问题**：engine 的 secrets API 可绕过 gateway 直接访问；默认日志会把完整对话、记忆和知识上下文写入磁盘。
2. **当前 CI 基线不是绿色**：frontend lint、gateway test、engine fmt 均已复现失败；data-services job 在干净环境下也存在依赖安装与空测试问题。
3. **声明的部署路径无法成立**：两个 Dockerfile 与当前工具链/feature 不一致；Linux/macOS Tauri 构建和 sidecar 查找仍按 Windows 假设实现。
4. **聊天状态有双重事实来源**：前端在失败时回滚，gateway 却已写入 user message；流式 assistant message 又以 fire-and-forget 方式持久化，重载后的记录可能与屏幕上看到的内容不同。
5. **文档无法稳定充当事实来源**：ADR、`CLAUDE.md`、OpenAPI 文件和当前实现之间存在多处明显漂移。

问题分级：

| 级别 | 数量 | 含义 |
|---|---:|---|
| P0 | 2 | 停止发布，优先处理安全与隐私暴露 |
| P1 | 9 | 高优先级，影响数据正确性、构建、部署或可用性 |
| P2 | 5 | 中优先级，影响性能、维护效率和事实一致性 |

## 2. 验证基线

### 2.1 已执行命令

| 模块 | 命令 | 结果 |
|---|---|---|
| Frontend | `pnpm lint` | **失败**，Biome 报 29 个 error |
| Frontend | `pnpm test -- --run` | 通过，17 个文件、128 个测试 |
| Frontend | `pnpm build` | 通过；主 JS chunk 1,071.71 kB，gzip 357.38 kB |
| Gateway | `go test ./...` | **失败**，标题长度契约 1 个断言失败 |
| Gateway | `go vet ./...` | 通过 |
| Engine | `cargo fmt --check` | **失败**，`conversation/src/token.rs` 有格式差异 |
| Engine | `cargo clippy --all-targets --features standalone -- -D warnings` | 通过 |
| Engine | `cargo test` | 通过，但只执行默认成员 `encorehub-engine` 的 21 个测试 |
| Engine | `cargo test --workspace` | 通过，执行 workspace 的 45 个测试 |
| Tauri | `cargo check` | 通过，Windows 当前目标可编译 |
| Tauri | `cargo test` | 通过，10 个测试 |
| Root | `pnpm exec concurrently --version` | **失败**，命令未安装 |

### 2.2 未执行项

- 本机没有 Docker，未执行 `docker compose build/up`。Docker 结论来自 Dockerfile、Cargo feature 和 Go toolchain 的确定性冲突。
- `data-services` 没有已安装的 ruff、mypy、pytest，也没有 `uv.lock` 或本地虚拟环境。未下载其大型 ML 依赖；相关结论来自 `pyproject.toml`、CI 命令和源文件。
- 未执行真实 OpenAI/Anthropic/DeepSeek 请求、联网搜索、Tauri 安装器、macOS/Linux 打包和依赖 CVE 扫描。

## 3. P0：停止发布问题

### P0-1 Engine API 无认证且 CORS 全开放，可直接读取或清除 secrets

**证据**

- Engine 对任意 origin、method、header 放行：[engine/src/api/mod.rs](../engine/src/api/mod.rs#L81)。
- Secrets 的读取、写入、清空、解锁、重置密码等路由没有认证层：[engine/src/api/mod.rs](../engine/src/api/mod.rs#L133)。
- `GET /api/secrets/:provider_id` 直接返回解密后的 key：[engine/src/api/secrets.rs](../engine/src/api/secrets.rs#L254)。
- Tauri 模式从固定起点 `10000` 顺序找端口，engine 通常位于可预测端口：[frontend/src-tauri/src/main.rs](../frontend/src-tauri/src/main.rs#L233)。
- Docker 模式把 engine 绑定到 `0.0.0.0:3000` 并发布宿主机端口：[docker-compose.yml](../docker-compose.yml#L28)。

**攻击路径**

1. 在桌面模式下，本地任意进程可以绕过 gateway 直接请求 engine。
2. 在浏览器未额外施加 Private Network Access 拦截的环境中，恶意网页可扫描 `127.0.0.1:10000` 附近端口；engine 的 `Access-Control-Allow-Origin: *` 允许页面读取响应。
3. 在 Docker 默认配置下，同一网络或宿主机可直接访问公开的 `:3000`。即使 gateway 配置了 `ENCOREHUB_AUTH_TOKEN`，直接访问 engine 仍绕过该认证。
4. 数据库处于明文模式时 key 始终可读；处于加密但已解锁状态时，key 同样可读。`/api/secrets/clear` 还允许无认证破坏数据。

**影响**

- 供应商 API key 泄露。
- 对话、记忆、知识、配置和密钥可被读取或破坏。
- Gateway 的 CORS、认证和限流无法保护直连 engine 的流量。

**修复建议**

1. 为 gateway 到 engine 建立内部认证 seam。桌面启动时生成随机高熵 token，通过环境变量或进程内配置同时交给 gateway 和 engine；除 `/health/live` 外的 engine 路由全部强制认证。
2. Engine 不应对浏览器提供通用 CORS。若没有前端直连需求，移除 CORS；若保留，只允许实际 Tauri origin，并且认证仍不可省略。
3. Docker 不发布 engine 宿主机端口，只把它放在 compose 内部网络；gateway 是唯一外部入口。
4. 对 secrets、config 和 destructive endpoints 添加缺 token、错 token、恶意 origin、锁定态的集成测试。
5. 长期可考虑 Unix domain socket、Windows named pipe 或进程内调用，进一步减少 localhost HTTP 攻击面。

**验收标准**

- 未带内部 token 的 secrets 请求返回 401/403。
- 外部 origin 无法读取 engine 响应。
- `docker compose` 下宿主机不能直连 `:3000`。
- Gateway auth 开启或关闭都不能改变 engine 的内部认证要求。

### P0-2 默认日志把完整对话和 RAG 上下文写入磁盘

**证据**

- 每次 tool loop 的后续请求都以 Info 级别记录完整 `ChatRequest`：[gateway/internal/handler/chat.go](../gateway/internal/handler/chat.go#L313)。该对象包含 messages、system prompt、memory、knowledge 和工具结果。
- 标题生成失败时记录完整 request；空标题时还记录 response 和 raw 内容：[gateway/internal/handler/chat.go](../gateway/internal/handler/chat.go#L896)。
- Tauri 会收集 gateway stderr，并把 Info 及以上日志默认镜像到每日文件：[frontend/src-tauri/src/logs.rs](../frontend/src-tauri/src/logs.rs#L100)、[frontend/src-tauri/src/logs.rs](../frontend/src-tauri/src/logs.rs#L219)。
- 日志 redactor 只针对 key/token/password 等 secret 模式，不会清除普通用户对话、记忆或知识内容：[frontend/src-tauri/src/logs.rs](../frontend/src-tauri/src/logs.rs#L264)。

**影响**

- 用户对话、私有知识库内容和检索到的记忆会落到明文日志。
- 日志备份、支持包、云盘同步或多用户机器会扩大数据暴露面。
- 这与“日志只做诊断、不包含敏感业务内容”的合理用户预期冲突。

**修复建议**

1. 生产日志禁止记录 prompt、message、tool result、provider response body。只记录 request ID、conversation ID、provider、model、round、计数和耗时。
2. 若确需 payload 调试，使用显式、短时、默认关闭的诊断模式，并禁止写文件；UI 必须提示会记录内容。
3. 错误日志对上游 response body 做长度限制与字段白名单，不直接拼接原文。
4. 加入 canary 测试：发送唯一敏感字符串后，断言内存日志和文件日志均不含该字符串。

**验收标准**

- Tool loop、标题失败和 provider 失败路径的日志中不出现用户输入或检索内容。
- 默认日志级别下只保留元数据和错误分类。

## 4. P1：高优先级问题

### P1-1 Secrets 加密启用和密码轮换不是事务操作

**证据**

- 启用加密时先逐条覆盖 secret，最后才更新 crypto metadata：[engine/src/api/secrets.rs](../engine/src/api/secrets.rs#L115)。
- 重置密码时先逐条用新 key 重加密，最后才替换 salt/verifier：[engine/src/api/secrets.rs](../engine/src/api/secrets.rs#L192)。
- 每次 `upsert_secret` 和 `set_crypto_meta` 是独立数据库调用，接口没有把整次迁移包进一个 SQLite transaction。

**失败模式**

- `enable` 中途失败：部分行已变成 ciphertext，但 metadata 仍显示未启用，相关 key 无法正常读取。
- `reset-password` 中途失败：数据库同时存在旧 key 和新 key 加密的行，metadata 只会指向其中一把 key，另一部分可能永久无法恢复。
- 当前测试只覆盖成功路径，没有磁盘满、约束错误或注入失败后的 rollback 验证。

**修复建议**

- 把“读取全部 secrets、转换、写回、更新 metadata”下沉为一个 storage module 方法，在单个 SQLite transaction 中完成。
- 先在内存完成全部解密/加密，确认成功后再进入 transaction 写入。
- 增加逐步故障注入测试，确保任何一步失败后数据库内容和旧密码仍完全可用。

### P1-2 Chat 持久化与前端状态语义不一致

**证据**

- Gateway 在校验 API key、provider adapter 和 provider 调用之前就写入 user message：[gateway/internal/handler/chat.go](../gateway/internal/handler/chat.go#L128)、[gateway/internal/handler/chat.go](../gateway/internal/handler/chat.go#L212)。
- User message 写入失败被降级为合成 ID，provider 调用仍继续；assistant 写入失败只记 warning：[gateway/internal/handler/chat.go](../gateway/internal/handler/chat.go#L694)。
- 流式 assistant 使用 goroutine fire-and-forget 写入，SSE `done` 不等待持久化确认：[gateway/internal/handler/chat.go](../gateway/internal/handler/chat.go#L494)。
- 前端在 stream error 时删除 optimistic user message：[frontend/src/stores/conversationStore.ts](../frontend/src/stores/conversationStore.ts#L465)。重新加载后，gateway 已写入的“失败消息”会重新出现。
- 用户中止时前端把 partial answer 仅保存在本地；gateway 的 stream error 路径不会保存该 partial assistant：[frontend/src/stores/conversationStore.ts](../frontend/src/stores/conversationStore.ts#L488)。

**影响**

- 屏幕状态、SQLite 状态和重新加载后的状态不一致。
- 缺 key、provider 失败、网络中断和 Stop 操作会产生幽灵消息或丢失 partial answer。
- 进程在发送 `done` 后退出时，assistant message 可能永久丢失。

**修复建议**

1. 先完成 provider/key/请求参数校验，再创建 turn。
2. 为 message 增加 `pending/completed/failed/stopped` 状态，明确失败请求是否保留，而不是前后端各自推断。
3. Assistant 持久化必须被 await；只有写入成功后才发送最终 `done`，写入失败要发送结构化错误。
4. 所有 engine 调用使用 request context 和明确 timeout，不使用无界 `context.Background()`。
5. 增加“失败后刷新”“中止后刷新”“engine 写失败”“SSE done 后立即退出”的端到端测试。

### P1-3 Search 参数与远端响应没有大小上限，可触发内存耗尽

**证据**

- `max_results` 只有等于 0 时才设默认值，没有上下界校验：[gateway/internal/handler/search_handler.go](../gateway/internal/handler/search_handler.go#L16)。
- DDG parser 直接用该值作为 slice capacity：[gateway/internal/search/search.go](../gateway/internal/search/search.go#L189)。负数会 panic，极大正数会尝试巨额分配。
- DuckDuckGo response 使用无界 `io.ReadAll`，且没有先检查 HTTP status：[gateway/internal/search/search.go](../gateway/internal/search/search.go#L154)。

**影响**

- 在 gateway 对网络开放且 auth 未配置时，一个请求即可造成 500、内存压力或进程 OOM。
- 异常远端响应也可消耗大量内存。

**修复建议**

- 对 `query` 长度和 `max_results` 做 binding 校验，例如 `1 <= max_results <= 10`。
- 对 HTTP 请求体和 provider response 使用 `http.MaxBytesReader`/`io.LimitReader`。
- 非 2xx 先返回分类错误，不解析为正常搜索结果。
- 添加负数、超大整数、超长 query、超大响应和非 2xx 测试。

### P1-4 Rate limiter 状态无回收，客户端 IP 信任策略也未固定

**证据**

- 每个新 IP 都永久存入 `map[string]*rate.Limiter`，没有 TTL、容量上限或清理 goroutine：[gateway/internal/router/router.go](../gateway/internal/router/router.go#L187)。
- Router 没有显式调用 `SetTrustedProxies`；`c.ClientIP()` 对转发头的解释依赖 Gin 默认值和部署拓扑。

**影响**

- 长期运行或暴露到网络后，来源 IP 基数可造成 limiter map 持续增长。
- 若部署错误地信任客户端可控的转发头，攻击者可以绕过单 IP 限速并加速 map 增长。

**修复建议**

- 使用有 TTL 和最大容量的 limiter store，定期清理空闲项。
- 显式配置可信代理；桌面/直接监听模式禁用代理信任。
- 增加伪造 `X-Forwarded-For`、大量 IP 和清理周期测试。

### P1-5 Docker 构建与当前代码契约冲突

**证据**

- Engine 二进制要求 `standalone` feature：[engine/Cargo.toml](../engine/Cargo.toml#L70)，Dockerfile 却执行普通 `cargo build --release`，随后复制一个在干净构建中不会产生的二进制：[engine/Dockerfile](../engine/Dockerfile#L1)。
- Gateway `go.mod` 要求 Go 1.25：[gateway/go.mod](../gateway/go.mod#L1)，Docker builder 仍为 Go 1.23：[gateway/Dockerfile](../gateway/Dockerfile#L1)。
- Engine runtime image 没有复制 `skills/`，standalone main 却从 `../skills` 加载：[engine/src/main.rs](../engine/src/main.rs#L54)。
- Dockerfile 仍 `EXPOSE 50051/9090`，与当前 HTTP-only 架构和 compose 注释不一致。

**影响**

- `docker compose build` 在干净环境下无法完成 engine/gateway 镜像。
- 即使手工绕过构建，容器内 built-in skills 也不会加载。

**修复建议**

- Engine 使用 `cargo build --release --features standalone --bin encorehub-engine`。
- Gateway builder 与 `go.mod` 使用同一版本，最好从单一版本来源生成。
- 显式复制 skills 到固定资源目录，通过 `ENCOREHUB_SKILLS_DIR` 读取。
- 删除遗留 EXPOSE，增加 compose build + health smoke CI。

### P1-6 “跨平台桌面”发布路径实际仍是 Windows-only

**证据**

- 运行时 sidecar 查找只尝试 `.exe` 和 `x86_64-pc-windows-msvc`：[frontend/src-tauri/src/main.rs](../frontend/src-tauri/src/main.rs#L452)。
- Unix build script 只复制无 target triple 的 gateway 文件：[scripts/build.sh](../scripts/build.sh#L182)。
- `TAURI_CMD` 被赋值为包含空格的 `"tauri build"`，随后作为一个参数传给 `pnpm tauri`：[scripts/build.sh](../scripts/build.sh#L42)、[scripts/build.sh](../scripts/build.sh#L195)。该命令不会等价于 `pnpm tauri build`。
- 数据库和日志写到 executable directory：[frontend/src-tauri/src/main.rs](../frontend/src-tauri/src/main.rs#L199)、[frontend/src-tauri/src/main.rs](../frontend/src-tauri/src/main.rs#L326)。macOS app bundle 和系统级 Linux 安装目录通常不可写，也不应保存用户数据。
- Tauri 配置却声明 `targets: "all"`：[frontend/src-tauri/tauri.conf.json](../frontend/src-tauri/tauri.conf.json#L30)。

**影响**

- Linux/macOS 构建可能在 bundling 阶段失败，或安装后找不到 gateway。
- 即使 gateway 启动，数据库/日志初始化也可能因目录权限失败。

**修复建议**

- 用 Tauri sidecar API 和平台 target triple 处理二进制，不手写 Windows 文件名搜索。
- 使用 `app.path().app_data_dir()` 存数据库和日志，resource dir 只放只读 skills/assets。
- 修正 Bash 参数数组，并让 debug/release 各自映射到单独 subcommand。
- CI 至少增加 Windows、macOS、Linux 的 `cargo check` 与 bundle dry-run；每个平台做一次安装后启动 smoke test。

### P1-7 当前 CI 基线为红色

**已复现失败**

- Frontend lint：29 个 error，包含格式、import 顺序、a11y 和 non-null assertion；CI 在 [ci.yml](../.github/workflows/ci.yml#L30) 的 lint 步骤停止。
- Gateway test：`TestCleanGeneratedTitle_EnforcesTitleLength` 期望 `EncoreHub 对话标题`，实际为 `EncoreHub 对话标题自`；实现和测试的混合标题截断契约不一致：[gateway/internal/handler/chat_test.go](../gateway/internal/handler/chat_test.go#L232)、[gateway/internal/handler/chat.go](../gateway/internal/handler/chat.go#L1196)。
- Engine fmt：`engine/crates/conversation/src/token.rs` 未通过 rustfmt；CI 在 [ci.yml](../.github/workflows/ci.yml#L62) 停止。

**Data-services 的结构性失败**

- ruff/mypy/pytest 位于 optional extra `dev`，CI 的 `uv sync` 没有请求 `--extra dev`：[data-services/pyproject.toml](../data-services/pyproject.toml#L42)、[ci.yml](../.github/workflows/ci.yml#L82)。
- `mypy strict = true`，但唯一 handler 没有返回类型：[data-services/src/main.py](../data-services/src/main.py#L21)。
- 仓库没有 data-services 测试文件；标准 pytest 在零测试时返回 exit code 5。
- 没有 `uv.lock`，依赖全部是开放下界，CI 和 Docker 构建不可复现。

**修复建议**

1. 先恢复所有现有 gate，不通过删除规则或跳过 job 来“变绿”。
2. 将 Python 工具移到 `[dependency-groups].dev`，或明确 `uv sync --extra dev --frozen`，并提交 lockfile。
3. Data-services 骨架至少增加 health 测试和返回类型；未启用模块可保留明确的 `501 Not Implemented` 契约。
4. CI 增加 clean-tree 检查，避免 `go mod tidy` 或格式化产生未提交变更却不失败。

### P1-8 Rust workspace 和 Tauri 测试没有被 CI 正确覆盖

**证据**

- `engine/Cargo.toml` 同时是 workspace root 和 package，`cargo metadata` 显示 `workspace_default_members` 只有 `encorehub-engine`。
- 因此 CI 的 `cargo test` 和 `cargo test --features standalone` 只执行 root package；conversation、storage、skill crate 的测试没有进入这两步：[ci.yml](../.github/workflows/ci.yml#L63)。
- 本地 `cargo test` 只运行 21 个测试，`cargo test --workspace` 运行 45 个测试。
- `frontend/src-tauri` 是独立 Cargo package，当前 CI 完全没有编译或运行它；本地可运行的 10 个日志测试因此不是 gate。

**修复建议**

- Engine 改为 `cargo test --workspace`，standalone 入口另用 `cargo test -p encorehub-engine --features standalone --all-targets`。
- Clippy 使用 `--workspace --all-targets`，并明确 feature 组合。
- Frontend job 增加 `cargo check/test --manifest-path src-tauri/Cargo.toml`，平台特定代码放入 OS matrix。

### P1-9 Health 接口不能表达数据库 readiness

**证据**

- Engine 即使数据库检查失败仍返回 HTTP 200 且顶层 `status: "ok"`，仅在嵌套字段写 `database.ok=false`：[engine/src/api/mod.rs](../engine/src/api/mod.rs#L153)。
- Gateway 的 engine client 只检查 HTTP status，不解析 `database.ok`：[gateway/internal/engine/client.go](../gateway/internal/engine/client.go#L138)。
- Gateway 因此会把数据库已坏的 engine 报告为 `engine.ok=true`：[gateway/internal/handler/health.go](../gateway/internal/handler/health.go#L36)。

**影响**

- Frontend 启动门禁、监控和未来容器 healthcheck 会在数据库不可用时继续放行。
- 用户进入主界面后才在 CRUD 操作中看到分散错误。

**修复建议**

- 分离 `/health/live` 与 `/health/ready`。
- Readiness 在数据库不可用时返回 503；gateway readiness 应解析并传播 engine readiness。
- Compose 和桌面启动流程使用 readiness，liveness 只判断进程是否需要重启。

## 5. P2：中优先级问题

### P2-1 根 `package.json` 的开发入口不可用

**证据**

- `dev` 使用未声明、未安装的 `concurrently`，本地执行 `pnpm exec concurrently --version` 已失败：[package.json](../package.json#L14)。
- `engine:dev`/`engine:build` 未传 `standalone`，与 required feature 冲突：[package.json](../package.json#L11)。
- `pnpm --filter '*' list --depth -1` 同时选中 root 和 frontend；root 的 `test`/`lint` 又执行同一 filter，存在自选递归风险：[package.json](../package.json#L15)。

**建议**

- 删除重复入口，统一以 Makefile/scripts 为单一入口；或把 root 配成正式 pnpm workspace 并显式排除 root。
- 给根脚本增加最小 smoke test，确保 README 中列出的命令可执行。

### P2-2 Tool rounds 的 token 用量被覆盖而不是累计

**证据**

- Gateway 每轮执行 `totalTokens = tokens`，只持久化最后一轮用量：[gateway/internal/handler/chat.go](../gateway/internal/handler/chat.go#L386)。
- Frontend 的 `streamTokenCount` 同样在每次 usage event 时覆盖：[frontend/src/stores/conversationStore.ts](../frontend/src/stores/conversationStore.ts#L442)。
- Gateway 每轮覆盖 `fullContent`，而前端会累计所有 delta；模型在 tool call 前输出文本时，屏幕内容和持久化内容还会不同。

**影响**

- 启用 web search 或多轮工具时，token 显示和成本统计偏低。
- Reload 后 assistant 内容可能与流式过程中看到的内容不同。

**建议**

- 明确 usage event 是 delta 还是 cumulative，再按契约累计并去重。
- 让 gateway 返回最终权威 usage/message ID，前端不要自己生成最终计数。
- 增加两轮、三轮 tool call 的内容与 usage 集成测试。

### P2-3 Data-services 的依赖面远大于当前实现

**证据**

- 当前实现只有一个 health endpoint 和 5 个 TODO：[data-services/src/main.py](../data-services/src/main.py#L1)。
- 运行依赖已包含 sentence-transformers、llama-index、pandas、celery、grpc 等完整技术栈：[data-services/pyproject.toml](../data-services/pyproject.toml#L6)。
- Docker 与 compose 默认构建和启动该模块，即使 gateway/engine 当前没有使用它。

**影响**

- 依赖解析、镜像构建、供应链扫描和本地安装成本很高，却没有对应功能收益。
- 开放版本范围与无 lockfile 让未来第一次真正启用时更难定位兼容问题。

**建议**

- 在功能落地前只保留 FastAPI/uvicorn 最小依赖；解析、embedding、RAG 依赖按 extra 或子模块逐步引入。
- Compose 用 profile 控制未接通模块，不作为默认启动链路。
- 先定义 `/embed`、`/parse`、`/chunk` 的小型接口和测试，再选择模型与打包技术。

### P2-4 Frontend 主 bundle 过大，动态 import 没有形成有效分包

**证据**

- 本地 production build 的主 chunk 为 1,071.71 kB，gzip 357.38 kB，Vite 发出 `>500 kB` warning。
- Vite 同时提示 `@tauri-apps/api/core` 和 `confirmStore` 既被动态 import 又被静态 import，相关动态 import 不会形成独立 chunk。

**影响**

- 桌面首屏解析时间和内存占用增加；低性能设备更明显。
- 设置、代码高亮等非首屏功能被提前加载。

**建议**

- Lazy-load Settings、DeveloperPanel、Markdown syntax highlighter 和 Tauri-only modules。
- 避免同一模块静态与动态混用；必要时通过单一 adapter module 暴露。
- 建立 bundle budget，例如主入口 gzip 小于 250 kB，并在 CI 使用构建统计检查。

### P2-5 文档与实现漂移，降低维护和自动化代理的可信度

**证据**

- 修复前 `CLAUDE.md` 引用不存在的 `docs/ENGINE_TAURI_MERGE_PLAN.md`：[CLAUDE.md](../CLAUDE.md#L22)。
- 修复前 ADR-0001 仍描述 Tauri 同时打包 engine 与 gateway sidecar，但当前 engine 已进程内化：[docs/adr/0001-language-split.md](adr/0001-language-split.md#L32)。
- 修复前 `CLAUDE.md` 的 slash command 列表包含不存在的 `/export`，并遗漏当前多个命令；真实注册表见 [frontend/src/commands/slash.ts](../frontend/src/commands/slash.ts#L22)。
- 修复前的 `docs/openapi.yaml` 实际是 OpenAI 官方 API 规范，title/server 都指向 OpenAI，而不是 EncoreHub；原始快照现归档为 [vendor reference](vendor/openai-openapi-reference.yaml#L1)。文件约 2.9 MB、73,854 行，原命名容易让人误认为是本项目契约。

**影响**

- 新维护者和自动化代理会按错误发布拓扑、命令或 API 契约工作。
- ADR 失去“不重复讨论已决事项”的价值。

**建议**

- 把外部参考移动到 `docs/vendor/` 并明确来源；为 EncoreHub 维护小型、可校验的 OpenAPI。
- 为文档增加本地链接检查和关键命令 smoke test。
- ADR 不直接覆盖历史；新增 ADR 记录 engine 进程内化，并把旧 ADR 的后果链接到新 ADR。
- 从代码生成 endpoint/command 清单，减少手工同步。

**处理记录（2026-07-19）**

- ADR-0004 固定桌面 Engine 进程内化、唯一 Gateway sidecar、内部 token、公开 liveness 与 app data/resource 路径；ADR-0001 保留语言切分历史并明确只有旧打包后果被替代。WF-06 已建立的 ADR-0003 继续作为 Chat turn 状态与失败语义的权威决策。
- OpenAI 2,908,193-byte 参考规范归档为 `docs/vendor/openai-openapi-reference.yaml`；项目契约改为 36,881-byte `docs/openapi.json`，覆盖 31 个浏览器侧 Gateway path，并与显式 Gin route 和资源 proxy 做自动比对。
- `CLAUDE.md` 改为有效 ADR/OpenAPI 链接，11 个 Slash command 与 TypeScript 注册表逐项同步；同时清除 `/export`、`VITE_ENGINE_URL`、不存在的 config proxy 和 payload logging 等陈旧说明。README 与 `.env.example` 的命令和配置入口同步收敛。
- 新增 4 项无第三方依赖的文档契约测试，检查维护文档本地链接、OpenAPI 结构/引用/路由、Slash 注册表、ADR 连接和 CI 命令。GitHub Actions 新增独立 Docs job 执行 `pnpm test:docs`，根 `test:contracts` 同时纳入该 gate。

## 6. 建议执行顺序

### 阶段 0：立即止血（1-2 天）

1. 删除所有完整 request/response payload 日志。
2. Engine 非 health 路由增加内部 token；收紧或移除 CORS。
3. Compose 停止发布 engine 端口，并默认只绑定 gateway 到 loopback，除非用户显式选择网络部署。
4. 为 P0 两项加入回归测试后再继续发布工作。

### 阶段 1：恢复可信工程基线（1-3 天）

1. 修复 frontend lint、gateway 标题契约、engine rustfmt。
2. 修正 data-services dev 依赖、最小测试和 lockfile。
3. Engine CI 改用 `--workspace`，增加 Tauri job。
4. 增加 Docker clean build smoke test。

### 阶段 2：统一聊天持久化语义（3-5 天）

1. 定义 turn 状态与失败/中止行为。
2. 让 user/assistant/tool calls 的提交形成清晰的原子操作或可恢复流程。
3. SSE `done` 只在权威状态落库后发送。
4. 加入刷新后的端到端断言和 tool-round usage 测试。

### 阶段 3：修复发布与运行平台（3-5 天）

1. 修复 Docker toolchain、feature 和资源复制。
2. Tauri 使用 app data/resource 标准目录与正式 sidecar API。
3. Windows/macOS/Linux 建立最小构建和启动矩阵。

### 阶段 4：收敛维护成本（持续）

1. 限制 search/request/response 大小，给 limiter 增加回收。
2. 缩减 data-services 当前依赖面。
3. 拆分前端 bundle。
4. 对齐 ADR、OpenAPI、README 和命令清单。

## 7. 发布门槛建议

下一次标记可发布版本前，至少满足：

- P0 回归测试通过，engine secrets 无法被未认证请求或任意网页 origin 读取。
- 日志 canary 测试证明用户内容不落盘。
- 四个 CI job 全绿，Rust workspace 与 Tauri 都进入 gate。
- `docker compose build` 在干净 runner 通过，engine 不发布宿主机端口。
- 缺 key、provider 失败、Stop、中途断网后，刷新页面得到的消息状态与用户当时看到的状态一致。
- Windows 安装包完成手动验收；若继续宣称 cross-platform，macOS/Linux 至少各有一次安装后启动 smoke test。

## 8. 最优先建议

第一项应处理 **P0-1 engine 内部认证与 CORS**。它的修复同时建立真正的内部安全 seam，使 Docker、Tauri、gateway auth 和 secrets threat model 有统一落点。紧接着删除 payload 日志，因为当前每一次 tool loop 都可能扩大隐私数据在磁盘上的副本。完成这两项后，再恢复 CI 绿色；否则后续改动没有可靠 gate，也无法证明安全修复持续有效。
