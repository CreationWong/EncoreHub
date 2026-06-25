# Engine Tauri 进程内化 — 实施计划

> 状态：**已实施（代码完成，待桌面手动验收）** — 提交 `feat(desktop): run engine in-process in Tauri (stage 10)`
> 关联：PHASE2_WORKFLOW.md 阶段 10
> 设计依据：可行性分析确认"方案 A（保留 axum HTTP + 独立 binary 编译目标，仅嵌入 Tauri 进程启动）"风险最低、收益明确。

## 目标

把 Engine 从"独立 exe + 外部 spawn"变为"Tauri 进程内 tokio 启动 axum"，同时保留独立 binary 编译目标给无头模式。

四个关键约束：
1. **独立 binary 继续可用**（无头部署、纯 web dev、CI 脚本）
2. **Gateway 零改动**（仍通过 `:3000` HTTP 访问 Engine）
3. **Tauri 打包少一个 externalBin**（engine exe 不再装进安装包）
4. **Cargo feature flag 控制**（编译时选库还是 binary）

---

## 任务分解

### 10.0 前置：确认现状

**验收**：以下声明为真再做后续，防返工。
- [ ] `engine/src/lib.rs` 已存在，导出 `api`/`crypto`/`logging` 三个模块
- [ ] `engine/src/api/mod.rs` 的 `build_router` 是纯函数，不依赖 `#[tokio::main]` 上下文
- [ ] `engine/` 是 Cargo workspace root，Tauri `frontend/src-tauri/` 是独立的 Cargo 项目
- [ ] 前后端三个 `pnpm test` / `go test` / `cargo test` 全绿
- [ ] `make dev` 和 `pnpm tauri dev` 均能正常启动

---

### 10.1 Engine：添加 `standalone` feature flag

**文件**：`engine/Cargo.toml`

**操作要点**：
- 加 `[features]` 区块，声明 `standalone` feature
- `standalone` 不引入额外依赖（axum/tokio 是 workspace dep，两边都用到）
- 把 `[[bin]]` 改为 conditional：`standalone` 开启时编译 binary targets，否则只产 lib

**Cargo.toml 变化示意**（仅示意，非代码）：
```toml
[features]
default = []
standalone = []

# When standalone is off, this is a library crate consumed by Tauri.
# When on, both binaries (encorehub-engine + encorehub-mcp) are built.
```

> 说明：`[[bin]]` 不能 conditional（Cargo 限制），所以实际做法是把 binary 移到 `src/bin/` 或用 `required-features`。推荐方案：两个 binary 的 Cargo.toml 声明加 `required-features = ["standalone"]`，这样不加 feature 时不编译它们。

**验收**：
- `cargo build`（不加 feature）→ 只产 lib，不编译 binary
- `cargo build --features standalone` → 产出 `encorehub-engine` + `encorehub-mcp` 两个 binary
- `cargo test` 全通过（lib 模式下测试是 `#[cfg(test)]`，不受影响）
- `cargo test --features standalone` 也全通过

---

### 10.2 Engine：`main.rs` 加 feature gate

**文件**：`engine/src/main.rs`

**操作要点**：
- 在文件开头加 `#[cfg(feature = "standalone")]` 编译门控，或整个 `main()` 函数门控
- `mcp_server.rs` 同理加 `#[cfg(feature = "standalone")]`
- 编译为库时这些入口点不存在，编译器跳过

**验收**：
- `cargo build` 不会因缺少 main 而报错
- `cargo build --features standalone` 正常产出 binary

---

### 10.3 Engine：导出进程内启动函数

**文件**：`engine/src/lib.rs`（或新增 `engine/src/embed.rs`）

**操作要点**：
- 导出一个 `pub async fn serve(db, skill_registry, bind_addr, log_control)` 函数
- 函数内部就是现在 `main.rs` 的 `axum::serve(listener, app).await`
- 这个函数同时被 `main.rs`（standalone 模式）和 Tauri（嵌入模式）调用
- Tauri 侧在 `tokio::spawn` 里调用它，Engine 跑在 Tauri 的 tokio runtime 里

**验收**：
- standalone：`cargo run --features standalone --bin encorehub-engine` 行为与改动前一致
- 库：函数可被外部 crate 调用（签名正确、无 missing symbol）

---

### 10.4 Tauri：引入 Engine 为依赖

**文件**：`frontend/src-tauri/Cargo.toml`

**操作要点**：
- 添加路径依赖：
  ```toml
  [dependencies]
  encorehub-engine = { path = "../../engine", default-features = false }
  ```
- 这会引入 engine 的所有传递依赖（tokio、axum、rusqlite 等）到 Tauri 的构建图
- Engine 的 `default-features = false` 确保 standalone feature 不开（不编译 binary 入口点）
- Skill 注册表路径问题：当前 `SkillRegistry::load("../skills")` 是相对 CWD。Tauri 进程的 CWD 不同，需要改为通过参数传入技能目录路径

**验收**：
- `cd frontend/src-tauri && cargo check` 通过（Tauri + Engine 依赖树的类型检查）
- Tauri 编译不被 engine 的依赖污染（无 link 冲突）

---

### 10.5 Tauri：进程内启动 Engine

**文件**：`frontend/src-tauri/src/main.rs`

**操作要点**：
- 在 `setup()` 闭包里，不再 spawn 外部 `encorehub-engine.exe`，改为：
  1. 打开 SQLite 数据库（复用 engine 的 `Database::open`）
  2. 加载 SkillRegistry
  3. `tokio::spawn(encorehub_engine::serve(...))` 启动 axum
- 保留 stdout/stderr drain 逻辑（Engine 的 tracing 日志转进 Tauri 的 LogBuffer），方式从"读管道"改为"注册 tracing subscriber layer"
- Engine 仍监听 `127.0.0.1:3000`，Gateway 继续通过 HTTP 访问
- 将 Engine 从 `tauri.conf.json` 的 `externalBin` 中移除

**验收**：
- `pnpm tauri dev` 启动正常，Engine 存活、`/health` 返回 200
- Gateway 能正常代理请求到 Engine
- 开发者面板显示 Engine 状态正常（不再依赖 spawn/pid 模型）
- 关闭窗口后 Engine 随 Tauri 进程优雅退出

---

### 10.6 构建脚本与打包

**文件**：`frontend/src-tauri/tauri.conf.json`、构建脚本

**操作要点**：
- `tauri.conf.json` → `bundle.externalBin` 只保留 `binaries/gateway`，移除 engine
- 如工程有 Makefile / CI 脚本做了 engine binary 的 `cp` / 重命名操作，去掉对应步骤
- 确认 `pnpm tauri build` 产出的安装包不包含 `encorehub-engine.exe`

**验收**：
- `pnpm tauri build` 成功，安装包中无 engine 独立 exe
- 安装后启动正常，Chat 可用

---

### 10.7 无头回归

确保独立 binary 不受影响。

**操作要点**：
- standalone binary 的 `make build` / CI build step 需显式传 `--features standalone`
- 更新 `make build` 中的 engine 构建命令
- 更新 CI（`.github/workflows/ci.yml`）中 engine 的 build job 加 standalone feature

**验收**：
- `cargo build --features standalone --bin encorehub-engine` 产出可独立运行的 engine binary
- `make dev`（三终端跑 engine + gateway + frontend）仍可用
- CI engine build job 通过

---

### 10.8 收尾

- [ ] 更新 CLAUDE.md：引擎编译命令加 `--features standalone` 注释、架构图标注 Engine 嵌入方式
- [ ] 跑全量测试：`cargo test`、`cargo test --features standalone`、`go test ./...`（gateway）、`pnpm test`（frontend）
- [ ] 全栈冒烟：启动后发送一条真实聊天消息，确认 engine→gateway→provider 全链路正常

---

## 改动文件清单

| 文件 | 改动类型 | 改动量估计 |
|------|---------|----------|
| `engine/Cargo.toml` | 新增 `[features]` + `required-features` | ~8 行 |
| `engine/src/main.rs` | 加 `#[cfg(feature = "standalone")]` | ~2 行 |
| `engine/src/mcp_server.rs` | 加 `#[cfg(feature = "standalone")]` | ~2 行 |
| `engine/src/lib.rs` | 新增 `serve()` 函数 | ~20 行 |
| `frontend/src-tauri/Cargo.toml` | 新增 engine 依赖 | ~2 行 |
| `frontend/src-tauri/src/main.rs` | spawn 外部 exe → 进程内启动 | ~30 行 |
| `frontend/src-tauri/tauri.conf.json` | 移除 engine externalBin | ~1 行 |
| CI / Makefile | 加 `--features standalone` | ~5 行 |
| `CLAUDE.md` | 更新编译命令 | ~5 行 |

**总改动面**：~75 行，8 个文件。无新 crate、无 API 破坏、Gateway 零改动。

---

## 关键风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| Tauri 与 Engine 的 tokio 版本冲突 | 低 | 两者都锁定 `tokio 1.x full`，Rust 生态对此兼容性成熟 |
| rusqlite bundled 在 Tauri 进程里表现正常 | 低 | 已有多项目嵌入先例；但如果 Tauri 有 file lock 问题，可切 WAL 模式 |
| SkillRegistry 路径硬编码 `../skills` | 中 | 必须改为参数传入；Tauri 进程 CWD 与 dev binary 不同 |
| Engine panic 拖垮 Tauri UI | 中 | axum serve 在 `tokio::spawn` 里，panic 只在当前 task 传播，不 kill 主进程；但需要处理 graceful shutdown |
| 纯 Web dev（`pnpm dev`）不再可用 | 低 | standalone binary 保留，手动起 engine binary + gateway + vite 即可 |

---

## 不做什么（明确排除）

- 不把 axum handler 改为 Tauri command（那是方案 B 的事）
- 不动 Gateway（保持独立 Go 进程不变）
- 不删除 `crypto`/`api` 模块的任何代码
- 不创建新的 engine crate

---

> **给接手 Agent 的提示**：这是一个"编译时选择库/二进制"的纯工程化任务。先做 10.0 的验收确认，再做 10.1-10.3（引擎侧 feature），然后 10.4-10.5（Tauri 侧接入），最后 10.6-10.7（打包 & CI）。每个 .x 任务独立可验证，按序执行不要跳。

---

## 实施记录（落地后补充）

实际改动与计划一致，记录几处与"改动文件清单"略有出入的实现细节：

- **`engine/src/lib.rs`**：除 `serve()` 外，额外 `pub use encorehub_storage::Database` 和 `pub use encorehub_skill::SkillRegistry`，让 Tauri 侧无需直接依赖 storage/skill 两个内部 crate 即可命名 `serve()` 的参数。`serve()` 签名为 `serve(db, skill_registry, log_control: Option<LogControl>, bind_addr: String)`，复用已有的 `api::build_router_with`。
- **`engine/src/main.rs`**：除 feature gate 外，`main()` 末尾改为调用 `encorehub_engine::serve(...)`（去掉重复的 `build_router` + `axum::serve`），避免两处维护。
- **新增 `frontend/src-tauri/src/log_layer.rs`**（计划未单列）：进程内 engine 没有 stdout/stderr 管道可 drain，改为一个 `tracing_subscriber::Layer`（`LogBufferLayer`），把 engine 的 tracing 事件按真实 level 注入开发者面板 `LogBuffer`。配套在 `logs.rs` 加 `LogBuffer::push_event(source, level, msg)`（已知 level 不再从文本猜），并把原 `push` 重构为共用 `append`。
- **`frontend/src-tauri/src/main.rs`**：在 `main()` 里安装带 `reload` 层的全局 tracing subscriber（`fmt` 终端层 + `LogBufferLayer`），并构造 `LogControl` 支持运行时 `/api/config/log_level` 切换——与 standalone binary 行为对齐。`setup()` 中新增 `start_engine()`：解析 DB / skills 路径 → `Database::open_and_return` → 应用 DB 持久化的 log_level → `SkillRegistry::load` → `tauri::async_runtime::spawn(serve(...))`。`ServiceState` 去掉 engine 子进程句柄，改为 `engine_started: Instant`；`get_service_status` 把 engine 报告为与桌面同 PID 的常驻任务；窗口销毁时只 kill gateway 子进程（engine 随进程退出，WAL 模式下安全）。
- **路径解析**（对应风险表"SkillRegistry 路径硬编码"）：DB 用 `ENGINE_DB` 环境变量，否则 `exe_dir/data/encorehub.db`；skills 用 `ENCOREHUB_SKILLS_DIR`，否则 Tauri `resource_dir()/skills`，再退回 `exe_dir/skills`——均不依赖 CWD。
- **CI**：engine job 用 `cargo clippy --all-targets --features standalone`，并分别跑 `cargo test` 与 `cargo test --features standalone`（库 + 二进制两种模式）。

**自动化验证全绿**：engine 双模式 build/test/clippy/fmt、tauri `cargo check`/clippy/test/fmt、gateway `go test ./...`、frontend `vitest run`（105 通过）。

**待手动验收**（需桌面环境，代码路径已就位）：`pnpm tauri dev` 下 `/health` 返回 200 + 开发者面板显示 engine 存活；`pnpm tauri build` 安装包不含 engine exe；真实聊天消息走通 engine→gateway→provider 全链路。
