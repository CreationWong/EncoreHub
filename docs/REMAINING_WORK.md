# EncoreHub 剩余工作

> 合并自 PHASE2_DEV_PLAN.md / PHASE2_WORKFLOW.md / UI_REDESIGN_PROPOSAL.md 中未完成部分。
> 已完成的工作（阶段 0/2/3/4/5 代码、阶段 10 代码）不再列出。

---

## ◆ 最近完成（2026-07-01）

以下项在 master 分支已交付，代码+测试均通过：

- [x] **API key 持久化**：key 始终存储到 engine DB（明文或 AES-256-GCM 加密）；前端启动/进供应商面板自动 `loadKeys`（带重试 + 退避）；旧 localStorage key 自动迁移
- [x] **加密锁定态 key 显示**：供应商设置中加密+锁定时显示 `••••••••` 掩码 + `encrypted` 徽章，点眼睛图标弹内联密码框，解锁后显示明文
- [x] **CORS 重复 header 修复**：gw engine proxy 跳过 engine 响应的 `Access-Control-*` 头，消除 `http://tauri.localhost, *` 双值导致浏览器拦截的问题
- [x] **开发者面板 DevTools 按钮**：🐛 按钮直接打开 webview 原生检查器（`tauri` feature=`devtools`，release 构建可用）
- [x] **ChatRequest 扩展**：统一格式新增 `TopP`/`FrequencyPenalty`/`PresencePenalty`/`Stop`/`Seed`/`JSONMode`/`ReasoningEffort`/`MaxCompletionTokens`/`TopK`/`ThinkingBudget`
- [x] **OpenAI 适配器对齐**：`buildRequest()` 集中映射所有统一字段到 go-openai SDK
- [x] **Anthropic 适配器对齐 Claude Messages API**：透传 `top_p`/`top_k`/`stop_sequences`/`thinking`；处理 `content_block_stop`/`ping` SSE 事件；收集全部 text content blocks
- [x] **Chat handler 参数透传**：`SendMessageRequest` 支持全部新采样/推理参数
- [x] **Claude API 参考文档**：`docs/claude API/` 5 个 Markdown 文件（Messages / Batch / Token Count / Models / Overview）
- [x] **Conversation crate 骨架 + token 计数器**（阶段 6 2.1/2.2）：`engine/crates/conversation/` — `Usage` 结构体、`rough_token_count`（char/4 通用 + char/2 JSON）、`estimate_message_tokens`、`token_count_with_estimation`（API 用量 + 新消息估算）、`exceeds_token_limit`；16 个测试全部通过

---

## 一、手动验收项（代码已完成，需桌面环境确认）

这些项代码与自动化测试均已就位，仅需本地 `pnpm tauri dev` / `pnpm tauri build` 确认。

- [ ] **1.1 终端窗口隐藏**（阶段 1）：Windows 下启动不弹终端窗口；子进程长跑不卡死
- [ ] **1.2 自定义供应商联调**（阶段 3）：新增 OpenAI 兼容供应商可正常聊天；内置供应商可改端节点不可删
- [ ] **1.3 思考链 + 工具调用联调**（阶段 5）：DeepSeek reasoner / Anthropic thinking 推理可见可折叠；工具链可视化
- [ ] **1.4 Engine 进程内化**（阶段 10）：`pnpm tauri dev` 下 `/health` 返回 200、开发者面板显示 engine 存活；`pnpm tauri build` 安装包不含 engine exe；真实聊天全链路正常

---

## 二、对话智能层（阶段 6 / Sprint 1）

> 目标：长对话不超 token。新建 `engine/crates/conversation/`。

- [x] **2.1** 建 crate 骨架（mod/context/token/compress），接入 workspace
- [x] **2.2** token 计数器：按模型近似（本地估算 char/4，JSON char/2；Usage 追踪；含 16 个测试）
- [ ] **2.3** 上下文构建器：给定对话 + token 上限，产出消息序列
- [ ] **2.4** 滚动摘要：超限时旧消息压成 summary 存 `summaries` 表，保留近 N 轮原文
- [ ] **2.5** 网关 chat 接入：用引擎上下文构建替换「全量历史」
- [ ] **验收**：>50 轮对话不报超 token；摘要可见可审计；`cargo test -p conversation` 覆盖边界

---

## 三、data-services 唤醒（阶段 7 / Sprint 2）

> 目标：Python 承担 embedding / 文档解析 / 分块。

- [ ] **3.1** 定型：embedding 本地模型选型 + 维度 + 是否需 GPU（写进文档）
- [ ] **3.2** 结构：建 `embedding/` / `parsing/` / `rag/` / `schemas.py`
- [ ] **3.3** `POST /embed`：文本 → 向量（批量）
- [ ] **3.4** `POST /parse`：文档字节 → 纯文本 + 元数据（PDF/Word/MD/HTML）
- [ ] **3.5** `POST /chunk`：长文本 → 分块（带 overlap）
- [ ] **3.6** 测试：补 pytest 真实用例，`ruff/mypy/pytest` 不再空过
- [ ] **验收**：data-services CI 三项通过

---

## 四、向量检索打通（阶段 8 / Sprint 3）

> 目标：LanceDB 落地，替换 FTS5 桩。

- [ ] **4.1** LanceDB 表初始化（memories_vec / knowledge_chunks_vec，维度对齐阶段 7）
- [ ] **4.2** 实现 `insert`：写入时调 data-services `/embed` 取向量存 LanceDB
- [ ] **4.3** 实现 `query`：embedding query → 近邻 → top-k
- [ ] **4.4** 替换 `search_memories` / `search_chunks` 桩为「向量 + FTS5 混合」检索
- [ ] **4.5** 网关 RAG 注入升级为语义 top-k
- [ ] **验收**：语义检索命中同义不同词；混合召回去重；引擎集成测试覆盖 ingest → query

---

## 五、契约与文档对齐（阶段 9 / Sprint 4）

> 目标：消除文档/契约漂移。可穿插在前面各阶段后增量做。

- [ ] **5.1** proto 决断：接入 `buf generate`，或移入 `docs/future/` 冻结
- [ ] **5.2** 修正 blob 误标（已实现，更新 CLAUDE.md + 架构图）
- [ ] **5.3** 架构图 RAG 能力校准（向量 + FTS5 混合）
- [ ] **5.4** CLAUDE.md 更新：data-services 实际职责、engine crate 列表补 conversation、provider adapter 新字段文档

---

## 六、UI 打磨（提取自 UI_REDESIGN_PROPOSAL.md 剩余项）

### P1 — 提升「懂上下文」的友好感

- [ ] **6.1** 聊天区顶部栏：显示对话标题（可点击重命名）+ 当前 provider·model 徽章 + 更多菜单
- [ ] **6.2** 内容宽度约束：消息区最大宽度 ~720-760px 居中，宽屏不拉通
- [ ] **6.3** 替换 `window.confirm`：`ConversationList.tsx` 和 `slash.ts` 中 2 处仍用原生弹窗

### P2 — 精致度打磨

- [ ] **6.4** 骨架屏：列表/面板加载用骨架屏替代裸 spinner
- [ ] **6.5** 消息操作条：助手消息 hover 浮现复制/重新生成/引用按钮；代码块复制按钮常驻
- [ ] **6.6** 对话列表分组：按时间分组（今天/昨天/更早），当前项高亮用 accent 竖条
- [ ] **6.7** 输入框进度环：字数接近上限时染 `warning` 色
- [ ] **6.8** Slash 命令菜单：加图标 + 分组 + ARIA `role="listbox"`

### P3 — 覆盖更多场景

- [ ] **6.9** 响应式：窗口 < 768px 时侧栏自动折叠；设置弹窗转全屏 sheet

---

## 执行顺序建议

按「用户可感知价值 / 实现成本 / 依赖关系」：

1. **手动验收**（§一）：先跑一遍桌面确认，清掉积压的待验证项
2. **UI 打磨 P1**（§六 6.1-6.3）：成本低、感知强
3. **对话智能层**（§二）：最大技术短板，长对话场景刚需
4. **data-services**（§三）→ **向量检索**（§四）：依赖链，RAG 核心
5. **文档对齐**（§五）：穿插增量更新
6. **UI 打磨 P2/P3**（§六 6.4-6.9）：精致度收尾

---

## 主要风险

- **embedding 模型选型**：本地模型体积/性能 vs API 成本，需早定维度避免返工
- **data-services 打包**：Python 运行时纳入 Tauri 安装包复杂度高
- **proto 漂移**：6 个 proto 维护却不生成，持续有分叉风险
- **LanceDB 依赖**：arrow-rs 版本兼容性需验证
- **Anthropic 适配器模型列表**：Anthropic 无 `/models` API，当前硬编码默认模型列表；需定期同步新模型或改用动态获取

---

*最后更新：2026-07-01*
