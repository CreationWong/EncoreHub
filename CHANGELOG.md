# Changelog

EncoreHub 项目变更记录。日期均为 UTC。

## Unreleased — 2026-08-03

### Added

- **附件与本地检索**：聊天输入框支持按钮和拖拽上传图片、富文本及普通文本；附件元数据和内容寻址位置写入 SQLite，图片按模型视觉声明直传，非视觉模型由用户显式选择系统 OCR 或视觉模型。
- **Memory 与 Knowledge**：Knowledge 使用嵌入式本地 LanceDB 主索引并同步 SQLite-Vec 后备，LanceDB 不可用时自动回退；每轮完成的对话以 SQLite-Vec 建立 episodic memory 索引。
- **Rust 数据管线**：移除 Python、FastAPI、PyOxidizer 与 Chroma；384 维本地 embedding、Unicode 分块及 DOCX/ODT/EPUB/HTML/RTF 回退解析全部在 Rust Engine 内完成，Pandoc 仍作为可选的高保真首选转换器。
- **开源合规清单**：桌面发布按 Rust 目标三元组自动解析 npm、Cargo 和 Go 的生产依赖闭包，生成带精确版本与 SPDX 许可证标识的完整组件清单；About 弹窗支持按包名、版本、许可证和生态搜索，未知许可证会阻止发布构建。
- **供应商调试**：开发者模式下可从模型供应商和元数据供应商打开侧边调试面板，按当前草稿的供应商、端点和模型筛选实时网络通信记录。
- **设置草稿保护**：供应商表单在供应商之间切换时保留未保存内容；离开供应商设置或关闭设置前可选择保存、放弃或取消离开。
- **维护规范**：代码文件必须使用文件头、标准文档注释和人类可读的意图注释，并对大型更新和底层重构维护本变更记录。

### Changed

- **通信日志隐私**：完整请求和响应内容仅保存在进程内存中，不再写入日常日志文件；导出时通过系统原生保存对话框由用户指定路径。
- **诊断覆盖**：供应商验证和模型发现统一使用诊断 HTTP 客户端；未开启完整记录时仍保留不含请求头和正文的通信元数据。
- **供应商保存逻辑**：草稿发生任何变更后即可触发保存，验证错误在保存时集中提示；模型发现的独立保存不会覆盖尚未提交的端点、路由或密钥编辑。

### Fixed

- **LanceDB 构建工具**：本地构建在未全局安装 `protoc` 时通过 Cargo 自动解析当前平台的 vendored binary，不再要求用户手动修改 `PATH`。
- **模型发现提示**：端点返回成功状态但响应为空或不是受支持的 JSON 模型列表时，显示专属错误并保留本地模型。
- **设置交互**：离开确认支持保存、放弃和取消三种结果，避免切换项目时静默丢失供应商配置。

## Unreleased — 2026-06-16 / 2026-06-17

> 一次密集开发会话的产出。所有 P0 阻塞问题修复，前端从骨架变成可用产品，三端测试覆盖从 0 起步至 60+ 个用例。

### Added (2026-06-17)

- **engine**：`/health` 返回 JSON——`{status, service, version (CARGO_PKG_VERSION), database: {ok, latency_ms, error?}}`，db round-trip 用 `get_config("engine.version")`
- **engine**：新 `PATCH /api/conversations/:id { title }` 支持会话重命名（auto-titling 之外的用户覆盖）
- **engine**：tests/api_smoke.rs — 用 `tower::ServiceExt::oneshot` 跑 axum 路由集成测试（health / conversations CRUD / rename / knowledge ingest+search+delete / memories empty list/search / skills empty）；为此新增 src/lib.rs 暴露 `pub mod api`
- **engine/storage tests**：rename + updated_at 不回退测试
- **gateway**：`engine_proxy` 透传单测 5 个、`handler/chat` 纯函数单测 7 个
- **gateway**：`engine.Client.RenameConversation` + `ConversationHandler.Rename` + router PATCH 路由
- **frontend**：`services/api.ts` 单测 7 个、`commands/slash.ts` 单测 12 个、`MessageBubble` DOM 渲染 5 个、`renameConversation` 乐观/回滚 3 个
- **frontend**：InputBox bash-style ↑/↓ 历史导航（空草稿 + 光标 0 触发，发送/切会话复位）
- **frontend**：`/inspect` slash 命令——把当前会话状态 dump 成 fenced JSON system message
- **frontend**：MemoryPanel + KnowledgePanel 加 Quote 按钮——把内容写到 `pendingDraft` 并关 Settings；InputBox 监听 `pendingDraft` 把它 append 到本地 input
- **frontend**：MessageBubble system 分支改用 ReactMarkdown，`/inspect` 的 fenced JSON 现在能渲染高亮（之前是 `<pre>` 显示 raw 反引号）
- **frontend**：`conversationStore` `setDraft`/`clearDraft` actions 单测
- **frontend**：KnowledgePanel "Load .txt/.md" 文件选择按钮（File.text() 自动填 title + content）
- **frontend**：`/clear` 与侧边栏 Trash 改成 `window.confirm` 二次确认（不可逆操作）
- **frontend**：ConversationList 双击会话标题 inline 编辑（Enter 保存 / Esc 取消 / Blur 保存），乐观更新 + 失败回滚
- **frontend**：Sidebar 一键主题切换（Sun/Moon 图标在 dark↔light 间循环；展开/折叠两态都有；system 留给 Settings 配）
- **frontend tests**：MessageBubble 5（用户对齐 / markdown / 流式光标 / system fenced JSON / clipboard 复制）、ConversationList 5（rename Enter/Esc/blur + delete confirm）、Sidebar 4（theme cycle + Settings 入口）、InputBox 7（slash 菜单出现 / Tab 补全 / Arrow 导航 / Esc 清空 / plain Enter 发送 / 空 Enter no-op / 流式 Stop）、services/{skills,memories,knowledge} 12（URL/body 形状契约 + 编码）、services/conversation 6（list/get/create/delete/rename）、KnowledgePanel 4（list/ingest/search/delete + 响应类型 regression）、MemoryPanel 4（list/search/quote/delete）、SkillsPanel 4（list/toggle/回滚/empty）

### Added (2026-06-16)

- **gateway**：Prometheus `/metrics` 端点（`requests_total`、`request_duration_seconds`、`in_flight_requests`），按 gin 匹配路由打标签
- **gateway**：`/api/v1/health` 增加引擎反向 ping，返回 `{engine: {url, ok, latency_ms}}`
- **gateway**：`X-Request-ID` 中间件——无则生成 16 字节 hex，有则透传；通过 `engine.WithRequestID` 自动转发到 engine 调用
- **gateway**：透明代理 `/api/v1/{skills,memories,knowledge}` → engine `/api/...`
- **gateway**：Bearer auth（`ENCOREHUB_AUTH_TOKEN`）、按 IP rate limit、CORS allowlist（`ENCOREHUB_CORS_ORIGINS`）
- **gateway**：graceful shutdown（SIGINT/SIGTERM 上 `srv.Shutdown` with 5s timeout）
- **gateway**：RAG context 注入——chat 请求时自动从 engine 拉 top-3 memory + knowledge chunk 拼到 system prompt
- **frontend**：完整设置面板（`Ctrl/Cmd+,`），Tabs：Providers / Skills / Knowledge / Memories / Appearance
- **frontend**：Slash 命令面板——`/new /clear /stop /model /settings /skills /knowledge /memory /help`，IME-safe，箭头键导航 + Tab 补全 + Esc 取消
- **frontend**：流式可中断（Stop 按钮 + Esc），中断时已流出的内容保留并标 `(stopped)`
- **frontend**：消息复制按钮（消息级 + 代码块级），代码块带语言标签
- **frontend**：`VITE_GATEWAY_URL` / `VITE_ENGINE_URL` / `VITE_AUTH_TOKEN` 集中配置
- **frontend**：vitest 接通，conversationStore + slash + api 共 23 测试
- **engine**：SQLite 集成测试 5 个（CRUD + FTS5 删除/搜索/scope 过滤）
- **docs**：根 `README.md`，`docs/IMPROVEMENT_REPORT.md`，`docs/adr/0001-language-split.md`，`docs/adr/0002-http-first-grpc-later.md`
- **docs**：CHANGELOG.md（本文件）

### Changed

- **gateway**：CORS 从 `*` 改 allowlist；mock 回复隔离到 `ENCOREHUB_DEV_MOCK=1`，否则无 API key 直接返回 401
- **engine**：`/api/conversations/:id/messages` POST 在 `ENCOREHUB_DEV_MOCK` 未启用时返回 503，避免 mock 路径意外被前端命中
- **engine**：`engine/src/main.rs` 监听地址改成 `ENGINE_BIND` 环境变量驱动（默认 `127.0.0.1:3000`，容器里设 `0.0.0.0:3000`）
- **engine**：`api/skills.rs` 三处 `Mutex.lock().unwrap()` 改为返回 500 + tracing::error，避免毒锁带崩进程
- **frontend**：API key 默认会话内存（不入 localStorage），需在 DevTools `localStorage.encorehub-persist-keys = "1"` 显式 opt-in 持久化
- **frontend**：未实现的 provider（Google / Ollama）在 UI 上灰显加 `soon` 标签，不再点击后默默 404
- **frontend**：SSE 解析按事件块（`\n\n` 分隔）+ `event:` 字段 dispatch，修了 usage 数字混入正文的 bug
- **gateway**：`go mod tidy` 移除声明但零引用的 `gobreaker` / `redis/v9` / `gorilla/websocket` / `otel` / `zap` / `grpc` / `protobuf`
- **docker-compose.yml**：移除幽灵 50051/9090 端口（gRPC 未实装），统一 `ENGINE_URL=http://engine:3000`
- **CI**：`go-version` 从 1.23 升到 1.25 与 `go.mod` 对齐

### Fixed

- **gateway/handler/chat**：`memory search` 内联调用硬编码 `http://127.0.0.1:3000`——容器/网络部署直接挂；现在统一走 `engine.Client`
- **frontend SSE**：`event: usage` 后跟的 `{"input_tokens":…}` 之前被当成正文 delta 拼接到回复里，污染对话；按 SSE spec 修正
- **frontend InputBox**：中文输入法回车不再误发送（`isComposing` 检测）
- **frontend**：流式中断后丢失内容——现在保留已生成 + `(stopped)` 标记入消息列表

### Security

- gateway 默认无 auth（适合 Tauri 本机 sidecar），有 `ENCOREHUB_AUTH_TOKEN` 时 `/api/v1/*` 强制 Bearer + constant-time 比较
- CORS 不再 `*`，限制到 Tauri / `localhost:1420` 等 allowlist
- API key 不再默认进 localStorage（XSS 隐患），等待接 Tauri stronghold/keyring
- `/metrics` 公开（无 auth）——同 kube-prom 惯例；如部署在公网应用反代加 IP 白名单

### Tests

### Fixed (2026-06-17)

- **frontend bug found by axum smoke test**：`KnowledgeListResponse` 前端类型 `{documents, total}` 与引擎实际响应（flat `Vec<DocumentResponse>`）不符，导致 Knowledge tab 上传后看不到自己的文档。Service 改为返回 `KnowledgeDoc[]`，Panel `setDocs(r)` 同步。

### Tests

| 模块 | 用例数 |
|------|--------|
| frontend (vitest) | 80 |
| gateway/router | 11 |
| gateway/provider/anthropic | 10 |
| gateway/handler | 15 |
| engine/api smoke | 7 |
| engine/storage | 6 |
| engine 单元（skill/migrations） | 2 |
| **合计** | **131** |
