# EncoreHub Phase 2 开发流程书

> 用途:把 Phase 2 拆成可逐步执行、可打勾的任务清单。每个任务粒度适合「单次交给 AI 完成」。
> 配套:详细设计见 [PHASE2_DEV_PLAN.md](./PHASE2_DEV_PLAN.md)、UI 见 [UI_REDESIGN_PROPOSAL.md](./UI_REDESIGN_PROPOSAL.md)
> 用法:完成一项就把 `[ ]` 改成 `[x]`。每个阶段做完跑一次对应组件的 lint + test 再打勾。

---

## 进度总览（完成一个阶段就打勾）

- [x] **阶段 0**：UI 地基（色 token + Toast + a11y 基线）
- [ ] **阶段 1**：隐藏终端窗口（S8）
- [x] **阶段 2**：开发者模式（S9）
- [x] **阶段 3**：供应商模板化（S5）
- [x] **阶段 4**：密钥口令加密（S6）
- [x] **阶段 5**：思考链 + 工具调用链（S7）
- [ ] **阶段 6**：对话智能层（S1）
- [ ] **阶段 7**：data-services 唤醒（S2）
- [ ] **阶段 8**：向量检索打通（S3）
- [ ] **阶段 9**：契约与文档对齐（S4）
- [ ] **阶段 10**：Engine 进程内化（S10）

> 当前进度指针：**阶段 6**（对话智能层）。注:阶段 1 的 1.3 为手动桌面验证项,待本地 `pnpm tauri dev` 确认无终端弹窗后再勾选总览阶段 1;阶段 3 的 3.9 为手动联调项(需起全栈 + 真实 key),代码路径已就位,待本地实测新增自定义供应商聊天后确认;阶段 5 的 5.9 为手动联调项(需起全栈 + 真实 DeepSeek reasoner / Anthropic thinking key),代码路径与单测已就位,待本地实测推理可见可折叠与工具链可视化后确认。

---

## 执行约定

- 每个「任务」是一次 AI 会话能完成的最小单元,带验收点
- 顺序自上而下;阶段内任务也尽量按序
- 涉及安全的任务(阶段 4)单独评审,密钥/密码禁止进日志
- 每阶段收尾:对应组件跑 `lint` + `test`,绿了再勾「阶段完成」

---

## 阶段 0 · UI 地基

> 目标:建立后续所有新界面复用的设计原语,避免返工。改动集中在 `frontend/src`。

- [x] 0.1 语义色 token：在 `styles/globals.css` 增加 `success/warning/danger/info` 及其 `-bg`/`-border` 变体,亮/暗双主题,接入 Tailwind token
- [x] 0.2 替换硬编码色：把现有 `green-400`/`red-500/10`/`amber-500`/`#1e1e1e` 等替换为语义 token
- [x] 0.3 统一 Toast 组件：新建可全局调用的 toast(success/error/info),右下角堆叠、可关闭、自动消失
- [x] 0.4 接入 Toast：把 ChatView 红色错误条、各设置面板内联错误改为统一 toast
- [x] 0.5 a11y 基线：统一 `focus-visible` 焦点环;为现有图标按钮补 `aria-label` 规范(建立约定供后续遵循)
- [x] **阶段 0 完成**：`pnpm lint && pnpm test` 通过 → 勾选总览阶段 0

---

## 阶段 1 · 隐藏终端窗口（S8）

> 目标:Windows 启动不弹终端。改动在 `frontend/src-tauri/src/main.rs`。

- [x] 1.1 给引擎/网关两个 `Command` 加 `CREATE_NO_WINDOW`：引入 `std::os::windows::process::CommandExt`,`.creation_flags(0x08000000)`,`cfg(target_os="windows")` 门控
- [x] 1.2 修复管道死锁隐患:为 `stdout`/`stderr` 起读取线程持续 drain(为阶段 2 日志做准备,先简单丢弃或 `eprintln`)
- [ ] 1.3 验证:`pnpm tauri dev` 与打包后启动,确认 Windows 下无终端弹窗、子进程长跑不卡
- [ ] **阶段 1 完成** → 勾选总览阶段 1

---

## 阶段 2 · 开发者模式（S9）

> 目标:软件内查看程序/网关/引擎状态与实时日志。Tauri + 前端。

- [x] 2.1 日志缓冲:把阶段 1 的读取线程改为写入环形缓冲(限行数),区分来源(engine/gateway)与级别
- [x] 2.2 日志推送:`app.emit()` 实时推前端,或暴露 `#[tauri::command]` 拉取
- [x] 2.3 状态采集:复用 `check_engine_health`/`check_gateway_health` 周期轮询,采集 PID/端口/运行时长
- [x] 2.4 设置开关:设置中新增「开发者模式」开关(默认关)
- [x] 2.5 开发者面板:状态卡片(三方存活灯+PID+端口)+ 日志视图(实时滚动、按来源/级别过滤、搜索、清空、导出)
- [x] 2.6 脱敏:日志展示前过滤密钥/密码
- [x] **阶段 2 完成**:`pnpm lint && pnpm test` 通过 → 勾选总览阶段 2

---

## 阶段 3 · 供应商模板化（S5）

> 目标:统一适配器模板,所有供应商可改端节点,支持自定义供应商。Gateway + Engine + 前端。

- [x] 3.1 网关:定义 `ProviderProfile`(id/name/protocol/base_url/models/auth_header/enabled)
- [x] 3.2 网关:提炼 `openai-compatible` 模板适配器(接受 `base_url`),OpenAI/DeepSeek 复用
- [x] 3.3 网关:Anthropic 模板保留独立,但同样接受 `base_url`
- [x] 3.4 网关:Registry 改为运行时可注册;内置档案作为默认预置
- [x] 3.5 存储:供应商档案存引擎 `config` 表(key=`provider_profiles`),网关启动/变更时拉取刷新
- [x] 3.6 前端:`ProviderDef` 加 `baseUrl`/可编辑 `models`/`protocol`;列表从静态常量移入持久化 store
- [x] 3.7 前端:`ProvidersPanel` 加「新增/编辑/删除供应商」表单(套阶段 0 设计)
- [x] 3.8 前端:`ProviderSwitcher` 改为读 store
- [ ] 3.9 验收:新增一个 OpenAI 兼容自定义供应商可正常聊天;内置可改端节点不可删(手动联调项,需起全栈 + 真实 key)
- [x] **阶段 3 完成**:gateway `go test` + frontend `lint/test` 通过 → 勾选总览阶段 3

---

## 阶段 4 · 密钥口令加密（S6）

> ⚠️ 安全敏感:开工前先评审威胁模型。密钥/密码全程不透明,禁止进日志/注释。Engine + Tauri + 前端。

- [x] 4.1 引擎:加 `aes-gcm` + `argon2` 依赖;建 `secrets` 表 + `crypto_meta`(salt/verifier)
- [x] 4.2 引擎:实现 Argon2id 派生 + AES-256-GCM 加解密;verifier 校验密码;主密钥仅内存
- [x] 4.3 引擎:加密时 zeroize 中间态;提供加密/解密/重置/清空接口
- [x] 4.x 网关:加密模式下聊天从引擎取解密 sk(`X-Provider-Key` 为空时回退)
- [x] 4.4 前端:设置中「加密数据库」开关 + 首次设密码流程(加密现有 sk)
- [x] 4.5 前端:启动解锁弹窗(已加密时),密码错误用 verifier 拒绝并提示
- [x] 4.6 生命周期:主密钥内存缓存,关闭软件清理;下次打开重新要求输入
- [x] 4.7 重置密码:旧密码验证 → 新密码重加密所有 sk;UI 警示「忘记不可恢复」
- [x] 4.8 验收:`sqlite3` 看不到明文 sk;重启需密码;重置后旧密码失效;`grep` 确认无密钥/密码泄漏
- [x] **阶段 4 完成**:engine `cargo test` + frontend `lint/test` 通过 + 安全自查 → 勾选总览阶段 4

---

## 阶段 5 · 思考链 + 工具调用链（S7）

> 目标:前端展示推理过程与工具调用。⚠️ SSE 协议破坏性变更,前后端同步。Gateway + 前端 + Engine。

- [x] 5.1 网关:`StreamEvent` 加 `Reasoning`/`ToolCall`/`ToolResult` 变体
- [x] 5.2 网关:SSE `delta` payload 改结构化 JSON(前端 `default:忽略` 同步改)
- [x] 5.3 网关:适配器解析 OpenAI/DeepSeek `reasoning_content`+`tool_calls`、Anthropic `thinking`+`tool_use`
- [x] 5.4 前端:`Message` 加 `reasoning?`;`ToolCall` 扩展 `result`/`status`;store 加流式累积字段
- [x] 5.5 前端:`chat.ts` 处理新事件 → `onReasoning`/`onToolCall`/`onToolResult`
- [x] 5.6 前端:MessageBubble 加默认折叠「思考过程」块(muted、左竖线)
- [x] 5.7 前端:工具调用卡片(名/参数/结果/状态),`tool` 角色补渲染
- [x] 5.8 存储:reasoning 与 tool_calls 持久化(tool_calls 表已存在)
- [ ] 5.9 验收:DeepSeek reasoner/Anthropic thinking 推理可见可折叠;工具链可视化;无推理时不显空块
- [x] **阶段 5 完成**:三端 lint/test 通过 → 勾选总览阶段 5

---

## 阶段 6 · 对话智能层（S1）

> 目标:长对话不超 token。新建 `engine/crates/conversation/`。

- [ ] 6.1 建 crate 骨架 `conversation`(mod/context/token/compress),接入 workspace
- [ ] 6.2 token 计数器(按模型近似,tiktoken-rs 或本地估算)
- [ ] 6.3 上下文构建器:给定对话 + token 上限,产出消息序列
- [ ] 6.4 滚动摘要:超限时旧消息压成 summary 存 `summaries` 表,保留近 N 轮原文
- [ ] 6.5 网关 chat 接入:用引擎上下文构建替换「全量历史」
- [ ] 6.6 验收:>50 轮对话不报超 token;摘要可见可审计;`cargo test -p conversation` 覆盖边界
- [ ] **阶段 6 完成** → 勾选总览阶段 6

---

## 阶段 7 · data-services 唤醒（S2）

> 目标:Python 承担 embedding/解析/分块。`data-services/`。⚠️ 先定 embedding 模型与维度。

- [ ] 7.1 定型:embedding 本地模型选型 + 维度 + 是否需 GPU(写进文档)
- [ ] 7.2 结构:建 `embedding/`/`parsing/`/`rag/`/`schemas.py`
- [ ] 7.3 `POST /embed`:文本 → 向量(批量)
- [ ] 7.4 `POST /parse`:文档字节 → 纯文本 + 元数据(PDF/Word/MD/HTML)
- [ ] 7.5 `POST /chunk`:长文本 → 分块(带 overlap)
- [ ] 7.6 测试:补 pytest 真实用例,`ruff/mypy/pytest` 不再空过
- [ ] **阶段 7 完成**:data-services CI 三项通过 → 勾选总览阶段 7

---

## 阶段 8 · 向量检索打通（S3）

> 目标:LanceDB 落地,替换 FTS5 桩。Engine + 联调 data-services。

- [ ] 8.1 LanceDB 表初始化(memories_vec/knowledge_chunks_vec,维度对齐阶段 7)
- [ ] 8.2 实现 `insert`:写入时调 data-services `/embed` 取向量存 LanceDB
- [ ] 8.3 实现 `query`:embedding query → 近邻 → top-k
- [ ] 8.4 替换 `search_memories`/`search_chunks` 桩为「向量 + FTS5 混合」检索
- [ ] 8.5 网关 RAG 注入升级为语义 top-k
- [ ] 8.6 验收:语义检索命中同义不同词;混合召回去重;引擎集成测试覆盖 ingest→query
- [ ] **阶段 8 完成**:engine `cargo test` 通过 → 勾选总览阶段 8

---

## 阶段 9 · 契约与文档对齐（S4）

> 目标:消除文档/契约漂移。可穿插在前面各阶段后增量做。

- [ ] 9.1 proto 决断:接入 `buf generate`,或移入 `docs/future/` 冻结
- [ ] 9.2 修正 blob 误标(已实现,更新 CLAUDE.md + 架构图)
- [ ] 9.3 架构图 RAG 能力校准(向量 + FTS5 混合)
- [ ] 9.4 CLAUDE.md 更新:data-services 实际职责、engine crate 列表补 conversation、新增加密/开发者模式说明
- [ ] **阶段 9 完成** → 勾选总览阶段 9

---

## 阶段 10 · Engine 进程内化（S10）

> 目标:Engine 嵌入 Tauri 进程内启动 axum(保留 `:3000`),同时保留独立 binary 给无头模式。Cargo feature flag 控制编译目标。Gateway 零改动。详细设计见 [ENGINE_TAURI_MERGE_PLAN.md](./ENGINE_TAURI_MERGE_PLAN.md)。

### 10.0 前置验收

- [ ] 10.0 确认 `engine/src/lib.rs` 已导出 `api`/`crypto`/`logging`;`build_router` 为纯函数;三端 lint/test 全绿

### 10.1-10.3 Engine 侧

- [ ] 10.1 Engine Cargo.toml:加 `[features]` + `standalone`,两个 `[[bin]]` 加 `required-features = ["standalone"]`
- [ ] 10.2 Engine `main.rs` + `mcp_server.rs`:加 `#[cfg(feature = "standalone")]` 门控
- [ ] 10.3 Engine `lib.rs`:导出 `pub async fn serve(…)` 进程内 axum 启动函数
- [ ] **验收**:`cargo build` 只产 lib、`cargo build --features standalone` 产出两个 binary;`cargo test` 全绿

### 10.4-10.5 Tauri 侧

- [ ] 10.4 Tauri `Cargo.toml`:加 `encorehub-engine = { path = "../../engine", default-features = false }`
- [ ] 10.5 Tauri `main.rs`:去掉外部 spawn engine exe,改为进程内 `tokio::spawn(encorehub_engine::serve(…))`;日志 subscriber layer 替代管道 drain
- [ ] **验收**:`pnpm tauri dev` 启动正常,Engine `:3000/health` 返回 200;开发者面板显示 Engine 存活

### 10.6-10.7 打包 & 无头

- [ ] 10.6 `tauri.conf.json`:externalBin 移出 engine;构建/CI 脚本加 `--features standalone`
- [ ] 10.7 无头独立 binary 验证:`cargo build --features standalone --bin encorehub-engine` 产出可独立运行 binary;`make dev` 三终端流程仍可用
- [ ] **验收**:`pnpm tauri build` 成功且安装包不含 engine exe;独立 binary 可单独启动

### 10.8 收尾

- [ ] 10.8 全栈冒烟:真实聊天消息确认全链路(engine→gateway→provider)正常;更新 CLAUDE.md 编译命令与架构描述
- [ ] **阶段 10 完成**:三端 lint/test 全绿(CI 通过) → 勾选总览阶段 10

---

## 完成标准

全部 11 个阶段勾选完毕,且:
- 各组件 lint + test 全绿,CI 通过
- 安全自查(阶段 4)无密钥/密码泄漏
- 文档与代码一致(阶段 9)

> 进度指针更新约定:每完成一个阶段,把「进度总览」下方的 `当前进度指针` 改到下一阶段。



