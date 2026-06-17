# EncoreHub Phase 2 详细开发计划

> 目标：从「能聊天」进化到「有记忆、懂上下文、真语义检索」
> 上一个里程碑：Phase 1 MVP 完成 ✅（多供应商聊天、SSE 流式、面板齐全、131 测试）

---

## 背景：Phase 1 的实际落点

Phase 1 收尾时的真实状态（与原计划对比）：

- ✅ **超额**：Gateway 三家适配器（OpenAI/Anthropic/DeepSeek）、全中间件栈、Web 搜索、Prometheus
- ✅ **完成**：前端全部面板 + slash 命令 + SSE 流式渲染
- 🟡 **CRUD 完成，智能层缺失**：Engine 是 SQLite + FTS5 服务，缺对话引擎灵魂
- 🔴 **骨架**：data-services 仅 `/health`；proto 从未生成

两份 ADR 已合理改写计划：gRPC → HTTP/JSON（ADR 0002）、RAG 注入移至网关侧。

**Phase 2 路线决断**：RAG 走 **Python data-services 承担 embedding/解析**，引擎只存向量。

---

## 总览

```
Sprint 1 │ 对话智能层          │ conversation crate：上下文构建、token 计数、压缩摘要
Sprint 2 │ data-services 唤醒  │ embedding API、文档解析、RAG 检索端点 + 测试
Sprint 3 │ 向量检索打通        │ LanceDB 落地、引擎存/查向量、替换 FTS5 桩
Sprint 4 │ 契约与文档对齐      │ proto 决断、blob 误标修正、架构图校准
Sprint 5 │ 供应商模板化        │ 统一适配器模板、可改端节点、自定义供应商
Sprint 6 │ 密钥本地加密存储    │ 用户口令加密 sk、开关式启用、解锁/重置、内存缓存即清
Sprint 7 │ 思考链 + 工具调用链 │ 结构化 SSE 事件、适配器解析 reasoning/tool、前端折叠展示
Sprint 8 │ 隐藏终端窗口        │ Windows CREATE_NO_WINDOW、修复管道死锁隐患
Sprint 9 │ 开发者模式          │ 程序/网关/引擎状态 + 实时日志查看面板
```

---

## 开发优先级（执行顺序）

按「用户可感知价值 / 实现成本 / 依赖关系」三维权衡,推荐执行顺序如下:

| 顺序 | Sprint | 优先级 | 理由 |
|------|--------|--------|------|
| 1 | **S8 隐藏终端窗口** | 🔴 P0 | 成本极低、立刻改善打包观感,且修复管道死锁隐患;无依赖 |
| 2 | **S9 开发者模式** | 🔴 P0 | 复用 S8 的日志捕获,顺势完成;为后续所有调试提供可观测性 |
| 3 | **S5 供应商模板化** | 🟠 P1 | 用户高频可感知(自定义供应商/改端节点);为 S6/S7 提供清晰的供应商抽象 |
| 4 | **S6 密钥加密存储** | 🟠 P1 | 安全刚需;依赖 S5 的供应商档案落定后再做密钥落库更顺 |
| 5 | **S7 思考链+工具链** | 🟠 P1 | 体验亮点;SSE 协议破坏性变更,前后端需同步,工作量较大 |
| 6 | **S1 对话智能层** | 🟡 P2 | 最大技术短板但用户无感知;长对话场景才触发,可稍后 |
| 7 | **S2 data-services** | 🟡 P2 | RAG 链起点;依赖 embedding 选型决策 |
| 8 | **S3 向量检索** | 🟡 P2 | 依赖 S2;替换 FTS5 桩 |
| 9 | **S4 契约文档对齐** | 🟢 P3 | 随时可做的收尾;建议穿插在各 Sprint 完成后增量更新 |

**排序逻辑**:
- 先做 **S8/S9**(低成本、改善体验与可观测性,为后续开发铺路)
- 再做 **S5→S6→S7**(用户可感知的功能线,S5 是 S6 的前置)
- 最后做 **S1→S2→S3**(RAG/智能线,技术价值高但用户无感,依赖链最长)
- **S4** 不单独排期,随各 Sprint 增量更新文档与契约

> 说明:S5/S6/S7 线与 S1/S2/S3 线相互独立,若有两人可并行推进。单人则按上表顺序。

---

## Sprint 1: 对话智能层（最大短板，P0）

**新建 crate**：`engine/crates/conversation/`

| 文件 | 职责 |
|------|------|
| `mod.rs` | 模块入口，`ConversationManager` |
| `context.rs` | 上下文窗口构建器：按 token 预算拼装历史消息 |
| `token.rs` | token 计数器（按模型分词近似，tiktoken-rs 或本地估算） |
| `compress.rs` | 超长对话压缩/摘要：滚动摘要 + 保留近 N 轮原文 |

**核心能力**：
- [ ] 上下文构建：给定对话 + token 上限，产出送入模型的消息序列
- [ ] token 预算：超限时触发压缩，保证不超 provider 上下文窗口
- [ ] 滚动摘要：旧消息压成 summary，存 `summaries` 表（Phase 1 已建表）
- [ ] 网关侧接入：chat 处理器调用引擎的上下文构建,替换当前「全量历史」

**验收标准**：
- 长对话（>50 轮）不再因超 token 报错
- 压缩后摘要可见、可审计（存库）
- `cargo test -p conversation` 覆盖边界：空对话、单条、超长

---

## Sprint 2: data-services 唤醒（Python RAG 后端）

**现状**：`data-services/src/main.py` 仅 30 行 FastAPI + `/health`，5 个 TODO。

**目标结构**：
```
data-services/src/
  main.py            # 注册路由
  embedding/         # embedding 生成（本地模型 + API 可选）
  parsing/           # 文档解析 PDF/Word/Markdown/HTML
  rag/               # 分块 + 检索编排
  schemas.py         # Pydantic 请求/响应模型
```

**端点**：
- [ ] `POST /embed` — 文本 → 向量（批量）
- [ ] `POST /parse` — 文档字节 → 纯文本 + 元数据
- [ ] `POST /chunk` — 长文本 → 分块（带 overlap）
- [ ] `GET /health` — 已存在，补 embedding 模型就绪检查

**验收标准**：
- CI 的 `ruff/mypy/pytest` 有真实测试覆盖（当前空过）
- embedding 维度与引擎 LanceDB schema 对齐（Sprint 3 联调）
- 文档明确：本地模型选型 + 维度 + 是否需 GPU

---

## Sprint 3: 向量检索打通（LanceDB 落地）

**现状**：`engine/crates/storage/src/lancedb/mod.rs` 的 insert/query 全是 TODO 桩，返回 `Ok(())`/空。

**任务**：
- [ ] LanceDB 表初始化：memories_vec、knowledge_chunks_vec（维度对齐 Sprint 2）
- [ ] 实现 `insert`：写入时调用 data-services `/embed` 取向量，存 LanceDB
- [ ] 实现 `query`：检索时 embedding query → 向量近邻 → 返回 top-k
- [ ] 替换 `search_memories`/`search_chunks` 的 FTS5 桩为「向量 + FTS5 混合」
- [ ] 网关 RAG 注入升级：从纯关键词改为语义 top-k

**数据流**：
```
ingest:  doc → engine → data-services(/parse,/chunk,/embed) → LanceDB + SQLite
query:   text → data-services(/embed) → engine LanceDB 近邻 → top-k 注入上下文
```

**验收标准**：
- 语义检索能命中「同义不同词」的内容（FTS5 做不到）
- 混合检索：向量召回 + FTS5 精确匹配合并去重
- 引擎集成测试覆盖 ingest → query 全链路

---

## Sprint 4: 契约与文档对齐（低成本高收益）

- [ ] **proto 决断**：补 `buf generate` 接入，或移入 `docs/future/` 明确冻结，消除漂移
- [ ] **修正 blob 误标**：`blob/mod.rs` 已完整实现（SHA-256 内容寻址），更新 CLAUDE.md 和架构图
- [ ] **架构图校准**：RAG 标注从「Context Injection」改为反映真实能力（向量 + FTS5 混合）
- [ ] **CLAUDE.md 更新**：data-services 从「未接入」改为实际职责；engine crate 列表补 conversation

---

## Sprint 5: 供应商模板化（自定义供应商 + 可改端节点）

**核心洞察**：当前三个适配器中,OpenAI 与 DeepSeek 几乎重复(DeepSeek = OpenAI + `cfg.BaseURL`),Anthropic 因 `x-api-key`/`system`/SSE 格式不同而独立。「自定义供应商」与「修改端节点」本质是同一需求——**把硬编码适配器收敛为「模板 + 可编辑供应商档案」**。

### 5.1 后端:供应商档案模型(Gateway)

把适配器从「编译期固定」改为「配置驱动」。定义供应商档案:

```
ProviderProfile {
  id, name,
  protocol: "openai-compatible" | "anthropic",  // 决定走哪套 wire 格式
  base_url,            // 可改端节点
  models[],
  auth_header,         // "Authorization: Bearer" 或 "x-api-key"
  enabled
}
```

**任务**：
- [ ] 提炼 `openai-compatible` 模板适配器:接受 `base_url` 参数,OpenAI/DeepSeek/自定义 OpenAI 兼容站点全部复用
- [ ] Anthropic 保留独立模板(协议差异),但同样接受 `base_url`
- [ ] Registry 从「启动期静态」改为「可运行时注册」(`Register()` 已存在但从未调用)
- [ ] 内置档案(OpenAI/Anthropic/DeepSeek)作为默认档案预置,用户档案叠加其上

### 5.2 档案存储

- [ ] 供应商档案存引擎 `config` 表(已有 `get/set/list_config`),key 如 `provider_profiles`
- [ ] 网关启动 + 收到变更时从引擎拉取档案,刷新 Registry

### 5.3 前端:供应商编辑器

当前 `constants/providers.ts` 是硬编码静态数组,无 `baseUrl` 字段,无法增删改。

- [ ] `ProviderDef` 增加 `baseUrl`、可编辑 `models`、`protocol` 字段
- [ ] 供应商列表从静态常量移入 `settingsStore`(持久化),变为可变
- [ ] `ProvidersPanel` 增加「新增/编辑/删除供应商」表单:名称、协议、端节点、模型列表、密钥
- [ ] `ProviderSwitcher` 改为读 store 而非常量
- [ ] 内置供应商可改端节点(如换代理/中转站),但不可删除

**验收标准**：
- 用户能新增一个 OpenAI 兼容的自定义供应商并正常聊天
- 所有供应商(含内置)均可修改端节点
- 删除自定义供应商不影响内置

---

## Sprint 6: 密钥本地加密存储（用户口令方案）

> ⚠️ **安全敏感**:本 Sprint 触及密钥存储,实施前需评审威胁模型。密钥与口令全程作为不透明字符串处理,**禁止日志/注释中出现明文**。

**现状**:密钥默认仅存会话内存;localStorage 仅在 DevTools 手动置 `encorehub-persist-keys=1` 时写入,代码注释已自陈 XSS 暴露风险。引擎 `config` 表为明文 JSON,无加密层、无 crypto 依赖。

**目标**:用户**自选**是否加密数据库。开启后用主密码加密 sk 落库;每次打开软件需输入密码解锁,密码仅缓存内存,关闭即清理;支持重置密码。

### 6.1 加密方案（口令派生）

- [ ] 加密算法:`AES-256-GCM`(authenticated,防篡改),Rust 侧 `aes-gcm` crate
- [ ] 主密钥派生:`Argon2id` 从用户密码派生(随机 salt 存库),**派生出的 key 仅驻内存**
- [ ] 校验串:存一段用主密钥加密的已知明文(verifier),用于校验输入密码是否正确
- [ ] 存储:`secrets(provider_id, ciphertext, nonce, updated_at)` 表 + `crypto_meta(salt, verifier, ...)` 元数据

### 6.2 解锁生命周期

- [ ] **设置开关**:用户在设置中选择「加密数据库」开/关
- [ ] **开启加密**:首次设置主密码 → 派生 key → 加密现有 sk → 落库
- [ ] **打开软件**:若已加密,启动时弹出解锁框输入密码;校验 verifier 通过后,主密钥缓存内存
- [ ] **运行期**:sk 在内存中解密供聊天使用,密钥不再常驻前端
- [ ] **关闭软件**:清理内存中的主密钥与解密后的 sk(显式 zeroize)
- [ ] **下次打开**:重新要求输入密码
- [ ] **重置密码**:旧密码验证通过 → 用新密码重新派生 key → 重加密所有 sk(忘记旧密码则只能清空重填,不可恢复)

### 6.3 未开启加密时

- [ ] 保持现状(会话内存),或以明文落库(需明确告知用户风险),由 6.1 开关决定

**验收标准**：
- 开启加密后,`sqlite3` 直接打开 DB 看不到任何明文 sk
- 关闭软件再打开,需输入正确密码才能聊天;密码错误被 verifier 拒绝
- 重置密码后旧密码失效、新密码可解锁
- 内存中主密钥在关闭时被清理(无残留)
- 日志/错误信息全程无密钥/密码泄漏(专项 grep 验证)

---

## Sprint 8: 隐藏网关与引擎终端窗口

**现状**(`frontend/src-tauri/src/main.rs`):网关与引擎用 `std::process::Command` 在 `.setup()` 中手动拉起,**无 `CREATE_NO_WINDOW` 标志**,Windows 下会弹出终端窗口。且 stdout/stderr 虽 `Stdio::piped()` 但**从不读取**,有缓冲区填满导致子进程死锁的隐患。

**任务**：
- [ ] Windows 下给两个 `Command` 加 `.creation_flags(0x08000000)`(CREATE_NO_WINDOW),`cfg` 门控 `target_os = "windows"`,引入 `std::os::windows::process::CommandExt`
- [ ] 顺带修复 piped 但不读取的死锁隐患(与 Sprint 9 日志捕获合并:起读取线程持续 drain)

**验收标准**：
- Windows 下启动应用不再弹出任何终端窗口
- 子进程长时间运行输出大量日志不卡死

---


## Sprint 7: 思考链 + 工具调用链前端展示

**现状**:SSE 仅 `delta`(纯文本)/`usage`/`done`/`error` 四类事件,`delta` 是裸文本非 JSON。适配器只取消息正文,忽略 OpenAI `reasoning_content`、Anthropic `thinking` 块、`tool_calls`/`tool_use`。前端 `Message` 类型**已有** `tool_calls[]` 和 `tool` 角色,但永远是空数组、从不渲染;无 reasoning 字段。引擎 schema **已有** `tool_calls` 表 —— 存储层已为工具调用预留。

### 7.1 协议升级(Gateway)

- [ ] `StreamEvent` 新增变体:`Reasoning{delta}`、`ToolCall{id,name,args}`、`ToolResult{id,result,status}`
- [ ] SSE `delta` payload 从裸文本改为**结构化 JSON**(前端 `default:忽略` 分支当前会静默丢弃新事件,需同步改)
- [ ] 适配器解析:OpenAI/DeepSeek 取 `reasoning_content` 与 `tool_calls`;Anthropic 取 `thinking`/`redacted_thinking` 块与 `tool_use`

### 7.2 数据模型

- [ ] `Message` 增加 `reasoning?: string`(或分段);`ToolCall` 扩展 `result`/`status`
- [ ] store 增加流式累积字段:`streamingReasoning`、流式工具调用列表
- [ ] 落库:reasoning 与 tool_calls 持久化(tool_calls 表已存在)

### 7.3 前端展示

- [ ] **思考链**:助手消息上方一个**默认折叠**的「思考过程」区块,流式时实时追加,完成后可展开/收起;视觉弱化(muted、小字、左侧竖线)区别于正文
- [ ] **工具调用链**:每次工具调用渲染为一张卡片(工具名 + 参数 + 结果 + 状态图标),按调用顺序排列,可折叠;`tool` 角色消息补渲染分支
- [ ] 流式中的合成气泡需同时携带 reasoning 与 tool 状态

**验收标准**：
- DeepSeek `deepseek-reasoner` / Anthropic thinking 模型的推理过程可见且可折叠
- 工具调用全链路(发起→参数→结果)在消息内可视化
- 不支持 reasoning 的模型不显示空的思考区块

---

## Sprint 9: 开发者模式（状态与日志查看）

**现状**:已有 `check_engine_health` / `check_gateway_health` 两个 Tauri 命令(`ureq` 健康检查),但 sidecar 的 stdout/stderr 从不读取,日志无处可看;无 `tauri-plugin-log`,无日志文件。

**目标**:软件内置「开发者模式」,集中查看程序、网关、引擎的运行状态与实时日志。

### 9.1 日志捕获(Tauri 侧)

- [ ] 为网关/引擎子进程起读取线程,持续 drain `stdout`/`stderr`(`BufReader::lines`)——同时解决 Sprint 8 的死锁隐患
- [ ] 日志写入环形缓冲(限行数/内存)+ 通过 `app.emit()` 实时推送前端,或暴露 `#[tauri::command]` 拉取
- [ ] 区分来源(engine/gateway)与级别(info/warn/error)

### 9.2 状态采集

- [ ] 复用现有健康检查命令,周期性轮询 engine/gateway 存活
- [ ] 采集进程信息:PID、运行时长、端口、版本(若可得)

### 9.3 前端开发者面板

- [ ] 设置中新增「开发者模式」开关(默认关闭,普通用户不打扰)
- [ ] 状态卡片:程序 / 网关(:8080) / 引擎(:3000) 各自的存活灯、PID、端口
- [ ] 日志视图:实时滚动、按来源/级别过滤、搜索、清空、复制/导出
- [ ] 视觉上归入设置面板或独立抽屉,与现有 AppearancePanel 等并列

**验收标准**：
- 开发者模式可见三方实时状态(存活/异常一目了然)
- 引擎/网关日志在面板内实时滚动,可过滤与导出
- 关闭开发者模式后不影响正常使用,无性能负担
- 日志展示前做脱敏(不显示密钥/密码,与 Sprint 6 一致)

---

## 里程碑与风险

| 里程碑 | 标志 |
|--------|------|
| M1 | 长对话不再超 token，压缩可审计 |
| M2 | data-services 三端点 + 测试通过 CI |
| M3 | 语义检索端到端打通，FTS5 桩退役 |
| M4 | 文档/契约与代码一致 |
| M5 | 自定义供应商可用，所有供应商可改端节点 |
| M6 | 用户口令加密 sk 落库，解锁/重置可用，DB 无明文 |
| M7 | 思考链与工具调用链在前端可视化 |
| M8 | Windows 启动不弹终端窗口 |
| M9 | 开发者模式可见三方状态与实时日志 |

**主要风险**：
- **embedding 模型选型**：本地模型体积/性能 vs API 成本，需早定维度避免返工
- **多进程部署复杂度**：data-services 加入后，Tauri 打包需多带一个 Python 运行时或服务
- **proto 漂移**：6 个 proto 维护却不生成，Sprint 4 前持续有静默分叉风险
- **忘记主密码不可恢复**（Sprint 6）：口令派生方案下,忘记密码只能清空重填 sk,须在 UI 明确警示
- **SSE 协议破坏性变更**（Sprint 7）：`delta` 从裸文本改结构化 JSON 是破坏性变更，须前后端同步发布，旧客户端 `default:忽略` 会丢事件
- **供应商模板抽象**（Sprint 5）：Anthropic 协议差异大，强行统一模板可能反增复杂度，保留双模板更稳
- **跨平台终端隐藏**（Sprint 8）：`CREATE_NO_WINDOW` 仅 Windows,macOS/Linux 无终端弹窗问题,但日志捕获逻辑需跨平台一致

---

## 待你定夺的决策点

1. **Sprint 5 内置供应商**：是否允许用户改内置供应商端节点(支持中转站场景),还是仅自定义供应商可改
2. **Sprint 6 未加密时落库行为**：用户不开加密时,sk 是保持「仅会话内存」(关软件即失),还是明文落库(方便但有风险)
3. **执行顺序**：Sprint 5/6/7/8/9 相对独立于 1–4(RAG 线)。8/9 是体验/调试改进,成本低见效快,可优先;是否先做 8/9 再做 5/6/7?


