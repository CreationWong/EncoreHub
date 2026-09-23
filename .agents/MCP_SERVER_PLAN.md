# MCP Server 产品化与 Client 计划（P3）

> 状态：Phase 1 已完成（2026-09-22），Phase 2 待开始。已确认决策：先做 Server 产品化并打包进桌面 sidecar，之后另立项 MCP Client。

## 目标

1. 让现有 stdio MCP server 成为随桌面安装包发布的真实能力：正确的数据/技能路径、与 App 一致的混合检索、真实技能列表、协议正确性、测试覆盖；
2. 外部 MCP 客户端（Claude Desktop 等）可指向该 sidecar 接入 EncoreHub 的知识与记忆；
3. 之后立项 MCP Client（外部服务器 → EncoreHub 工具循环）。

## 现状（证据）

- `engine/src/mcp_server.rs`：stdio JSON-RPC，`initialize`/`tools/list`/`tools/call`；DB 路径硬编码 `data/encorehub.db`；检索仅 FTS；`list_skills` 硬编码；notification 仍回响应；无测试。
- `engine/src/main.rs:32`：Engine 用 `ENGINE_DB` 环境变量（默认 `data/encorehub.db`），MCP server 应沿用同一约定。
- 桌面 `frontend/src-tauri/tauri.conf.json` 的 externalBin 仅含 gateway。
- `docs/adr/0002-http-first-grpc-later.md` 有过时的 tonic/prost 描述。

## Phase 1 · Server 正确性与能力对齐（✅ 2026-09-22）

- [x] 路径解析：`--db` / `ENGINE_DB`，`--skills-dir` / `ENCOREHUB_SKILLS_DIR`；技能目录缺失时返回空列表。
- [x] 检索对齐 App：SQLite-Vec + FTS5 → RRF 混合（不依赖 LanceDB，MCP 进程只开 SQLite）。
- [x] `list_skills` 改用 `SkillRegistry::load` 的真实技能。
- [x] 协议：notification 不回包；`initialize` 协商 protocolVersion；serverInfo 版本带 Build ID。
- [x] 抽出可测试的 `serve`，补协议测试（9 个：参数解析、initialize、tools/list、tools/call、list_skills、notification、未知方法/工具、坏 JSON 存活）。
- [x] 文档：ADR-0002 修正、CHANGELOG。

## Phase 2 · 打包为桌面 sidecar（macOS 已验证，三平台待验）

- [x] 构建脚本产出并打包 `encorehub-mcp`：`prepare-engine-runtime.mjs` 以 `--features standalone --bin encorehub-mcp` 构建，重定位依赖（macOS `@loader_path` + ad-hoc 签名）并随 `engine-native/` 一起进安装包的 `lib/`，与 libcurl 闭包同目录（不单独走 externalBin，避免二次依赖打包）；manifest `engine-runtime.json` 记录 `mcp` 条目（file/size/sha256）。
- [x] macOS 实测：产物在 `lib/` 运行 `initialize`/`tools/list` 正常、notification 无回包、`@loader_path` 依赖可加载。
- [ ] Windows / Linux 构建与安装后验证（含 DLL/SO 闭包）。
- [ ] 启动参数由安装布局决定（resource_dir 技能目录、app_data_dir 数据库）——留给 Phase 3 的配置导出一并落地。

## Phase 3 · 用户接入与文档

- [ ] 设置页"复制 MCP 配置"（解析后的绝对路径）；`docs/user/mcp.md`；README / CLAUDE.md 更新。

## Phase 4 · MCP Client（另立项）

- [ ] 服务器配置与生命周期、stdio 握手与 `tools/list` 发现、桥进网关工具循环、设置面板、安全评审（拉起本地进程是信任边界）。

## 验收门禁

- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets -- -D warnings` 与 `cargo clippy -p encorehub-engine --all-targets --features standalone -- -D warnings`
- `cargo test --workspace` 与 `cargo test -p encorehub-engine --all-targets --features standalone`
- 后续阶段：三平台构建 + 安装后 smoke
