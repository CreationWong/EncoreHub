# Changelog

本文件记录 EncoreHub 的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。发布日期使用 UTC。

## [Unreleased]

### Changed

- **CI/CD 发布流程**：安装包改为通过手动工作流选择 Windows、macOS、Linux 或全部平台构建，并以对应版本变更记录和贡献者清单发布到 GitHub Releases；自动组件版本递增仅响应主分支生产代码变更，文档、配置样板、工作流、包文件、构建脚本及测试变更均被排除。

### Fixed

- **Gateway 搜索回归测试**：DuckDuckGo 零结果流程固定使用本地 Engine Curl 响应，不再因 CI 环境偶然访问到真实搜索结果而随机失败。
- **前端开源清单回归测试**：About 弹窗交互改用小型代表性组件夹具，完整生成清单继续由独立契约验证，避免 CI 因一次渲染数百行许可证数据而超时。

## [0.1.4] - 2026-08-14

### Added

- **独立组件版本与兼容性认证**：Frontend、Gateway、Engine 分别维护四段式版本及对端兼容范围；构建始终生成并展示共享 Build ID，正式界面省略提交位，开发者模式、错误和日志保留完整版本。程序启动时执行双向版本范围认证，不兼容或缺失版本元数据会阻止就绪；代码进入主干后仅自动递增受影响组件的提交位。
- **数据管理**：设置新增 Data 页面，统计对话、消息、附件、记忆与 Knowledge 数据；支持按角色、对话、记忆和 Knowledge 原子数据域选择导出，并可逐项多选对话后只导出或原子删除所选对话。合并导入的版本化 JSON 备份不含配置和凭据，也可清空全部对话历史、清理搜索缓存和孤立附件 blob。依赖记录自动补齐，导入保持现有同 ID 数据，附件内容按 SHA-256 校验后写入。
- **DuckDuckGo 组合搜索源**：单一 DuckDuckGo provider 并行请求 `https://html.duckduckgo.com/` 与 Instant Answer API；HTML 语法树提供设定数量的主要网页结果，Instant Answer 额外提供最多三条带类型标记的精选答案或摘要。任一路失败时保留另一侧结果并附带警告，历史 `duckduckgo_html` 设置自动迁移。
- **结构化联网搜索与网页读取**：`web_search` 默认使用组合 DuckDuckGo，并支持自定义 SearXNG 与 OpenSERP JSON 接口；移除 Bing/Google HTML 抓取、通用 JSON 映射、关键词相关性猜测、CAPTCHA 和可见浏览器流程。`web_fetch` 继续通过 Curl 执行逐跳 SSRF、DNS 固定、重定向、超时和大小限制，再由独立打包的 RUSTScrapling 动态库提取 HTML 正文并以不可信数据边界交给模型。
- **附件与本地检索**：聊天输入框支持按钮和拖拽上传图片、富文本及普通文本；附件元数据和内容寻址位置写入 SQLite，图片按模型视觉声明直传，非视觉模型由用户显式选择系统 OCR 或视觉模型。
- **角色记忆与 Knowledge**：记忆模式绑定角色，记忆按角色默认组、全局组和自定义组隔离；模型只有在判断信息长期有用时才调用 `memory_remember`，普通消息不会自动写入。简单模式只写关系库，RAG 使用 SQLite-Vec，增强模式混合本地 LanceDB Knowledge；LanceDB 不可用时自动回退 SQLite-Vec。
- **记忆组管理**：记忆设置默认按角色分组，支持自定义组的新建、重命名、归档和显式删除；角色可继承其他组并分别授予只读或读写权限，角色默认组与全局组受保护。
- **Rust 数据管线**：移除 Python、FastAPI、PyOxidizer 与 Chroma；384 维本地 embedding、Unicode 分块及 DOCX/ODT/EPUB/HTML/RTF 回退解析全部在 Rust Engine 内完成，Pandoc 仍作为可选的高保真首选转换器。
- **开源合规清单**：桌面发布按 Rust 目标三元组自动解析 npm、Cargo 和 Go 的生产依赖闭包，生成带精确版本与 SPDX 许可证标识的完整组件清单；About 弹窗支持按包名、版本、许可证和生态搜索，未知许可证会阻止发布构建。
- **供应商调试**：开发者模式下可从模型供应商和元数据供应商打开侧边调试面板，按当前草稿的供应商、端点和模型筛选实时网络通信记录。
- **设置草稿保护**：供应商表单在供应商之间切换时保留未保存内容；离开供应商设置或关闭设置前可选择保存、放弃或取消离开。
- **维护规范**：代码文件必须使用文件头、标准文档注释和人类可读的意图注释，并对大型更新和底层重构维护本变更记录。

### Changed

- **Data 设置页**：重新布局为数据概览、会话管理和维护操作三个区域；会话支持按标题搜索、按最近更新、最早更新、标题或消息数排序，并可批量选择当前筛选结果。备份与导入集中到维护区，全量历史删除与缓存清理分区显示。
- **启动体验**：桌面服务启动期间显示与主工作区一致的工具栏、工作区边框、空状态图标和主题色，并以低干扰进度反馈当前启动阶段。
- **版本元数据与进程诊断**：npm、Cargo 与 Tauri 的三段式包版本同步为组件公开版本；开发者 Processes 页面为 Desktop、Engine、Gateway 展示完整四段版本与始终可见的 Build ID。
- **桌面运行时模块化**：Tauri 主程序不再静态链接完整 Engine，改为按平台加载带 ABI 版本校验的 Engine Runtime `.dll` / `.so` / `.dylib`；Engine、Gateway、Desktop、Frontend 和 standalone Engine 可按一个或多个组件独立构建与升级。
- **网页解析模块边界**：RUSTScrapling 以独立 `.dll` / `.so` / `.dylib` companion 随 Engine Runtime 构建和校验，不并入 `encorehub_desktop_runtime`；Curl 仍是唯一网络传输层，RUSTScrapling 只接收已经过网络策略校验的 HTML。
- **依赖收敛**：移除前端未使用的路由、查询、命令面板、样式合并及 Tauri 插件依赖，清理 Rust 工作区和子 crate 的未消费声明；Blob SHA-256 的十六进制编码改用 Rust 标准库实现，`tower` 限定为测试依赖。
- **通信日志隐私**：完整请求和响应内容仅保存在进程内存中，不再写入日常日志文件；导出时通过系统原生保存对话框由用户指定路径。
- **诊断覆盖**：供应商验证和模型发现统一使用诊断 HTTP 客户端；未开启完整记录时仍保留不含请求头和正文的通信元数据。
- **供应商保存逻辑**：草稿发生任何变更后即可触发保存，验证错误在保存时集中提示；模型发现的独立保存不会覆盖尚未提交的端点、路由或密钥编辑。

### Fixed

- **Tauri 版本锁定**：Frontend 公共版本递增时同步刷新 `src-tauri/Cargo.lock` 中的工作区包版本，且不更新第三方依赖，避免许可证清单生成和安装包构建因 `--locked` 检查失败。
- **供应商名称输入**：新增供应商名称支持完整 UTF-8 文本和输入法组合输入，不再从显示名称生成 ASCII ID；供应商 ID 改为创建时自动生成的 UUID，中文等非拉丁名称可直接保存。
- **工具后回复提前结束**：成功的 `web_search`/`web_fetch` 后允许模型继续使用受限的 `web_fetch` 从搜索结果或网页转向明确 API，并以执行层硬限制最多三次抓取、拒绝同一 URL 重复抓取；搜索失败且没有结果时不再开放 `web_fetch` 猜测地址。模型若只输出“我来抓取/搜索”等过渡句会自动纠正一次，不再保存为 Complete。Anthropic 流的 `max_tokens` 等真实结束原因也不会再被尾部通用 `stop` 覆盖。
- **DuckDuckGo 零结果与空回复**：Instant Answer 没有精选摘要时继续使用同次组合请求的 HTML 网页结果，不再把单路零结果误报为整体失败；工具跟进的可见正文在协议清理后为空时不再以 Completed 保存。
- **搜索 API 偶发连接超时**：搜索提供商请求预算提高到 15 秒，Curl 连接阶段不再被额外截断为 5 秒；网络失败现在以脱敏的超时、DNS、连接或 TLS 类别返回，不再统一显示无法诊断的 `Curl request failed`。
- **动态网页读取**：RUSTScrapling 在 JavaScript 页面壳没有静态正文时回退提取 OpenGraph 标题和 HTML meta 描述，不再把可解析但正文为空的页面误报为解析器失败；脚本、样式和动态挂载节点仍不会作为正文返回。
- **Rust Release 构建性能**：模块化 Engine Runtime 的常规 Release profile 不再启用全量 LTO 和单代码生成单元，保留三级优化与符号裁剪并恢复 16 个并行 codegen units；Engine 变更后的 Runtime 增量构建不再长时间停在最后一个 crate。
- **记忆工具写入失败**：Memory 关系行与 SQLite FTS 索引改为单事务写入，遇到历史遗留的 FTS rowid 时自动替换，不再出现记忆实际落库但 `memory_remember` 返回 `constraint failed`；迁移 18 会从权威关系表重建已有错配索引。
- **跨对话记忆读取**：Simple 模式注册受角色可见组约束的 `memory_search` 工具，通过 SQLite FTS 按需读取既有记忆；模型不再因新对话缺少历史上下文而声称没有已存记忆。
- **重复记忆写入**：Engine 对同组、同种类且仅大小写、空白或标点不同的记忆执行幂等写入，重复 `memory_remember` 调用返回已有记录而不新增副本。
- **LanceDB 构建工具**：本地构建在未全局安装 `protoc` 时通过 Cargo 自动解析当前平台的 vendored binary，不再要求用户手动修改 `PATH`。
- **模型发现提示**：端点返回成功状态但响应为空或不是受支持的 JSON 模型列表时，显示专属错误并保留本地模型。
- **设置交互**：离开确认支持保存、放弃和取消三种结果，避免切换项目时静默丢失供应商配置。

## [0.1.0] - 2026-06-17

### Added

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
- **frontend Knowledge**：修正知识列表响应类型与 Engine 实际返回值不一致的问题，上传后的文档现在会立即显示。

### Security

- gateway 默认无 auth（适合 Tauri 本机 sidecar），有 `ENCOREHUB_AUTH_TOKEN` 时 `/api/v1/*` 强制 Bearer + constant-time 比较
- CORS 不再 `*`，限制到 Tauri / `localhost:1420` 等 allowlist
- API key 不再默认进 localStorage（XSS 隐患），等待接 Tauri stronghold/keyring
- `/metrics` 公开（无 auth）——同 kube-prom 惯例；如部署在公网应用反代加 IP 白名单
