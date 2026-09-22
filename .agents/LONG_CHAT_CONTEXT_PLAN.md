# 长对话上下文上下文工程实施计划（P1）

> 状态：Phase 1–4 已完成（2026-09-22）；剩余：真实供应商的 50+ 轮验证。对应 `.agents/REMAINING_WORK.md` §3（Conversation Context And Long-Chat Intelligence）。
> 本文是 AI 工作文档，完成后将结果回填到 `REMAINING_WORK.md` 与 `CHANGELOG.md`。

## 目标

让长对话在任何供应商窗口下都能稳定续聊，并且压缩摘要跨重启、跨设备可用：

1. 压缩摘要由 Engine 持久化，重新打开会话即可恢复并继续参与 token 预算；
2. Engine 提供"消息序列 + token 预算 → 供应商消息序列"的上下文构造器，网关不再按消息条数粗暴截断；
3. 超阈值时自动滚动摘要，用户可在上下文面板审阅。

## 现状（证据）

- 前端压缩摘要是本地文本拼贴，只存在于内存 `compactions`（`frontend/src/stores/contextManagementStore.ts:613`），刷新即丢。
- Engine 已有 `conversation_summaries` 表与 `save_summary`/`get_latest_summary`，但 `save_summary` 无任何调用者；`get_one` 返回的 `summary` 字段前端声明后从未消费（`engine/src/api/conversations.rs:317-321`、`frontend/src/services/conversation.ts:171`）。
- 网关仅在客户端传 `context_summary` 时按 `context_keep_recent`（默认 6）截断，完全不看 token 预算（`gateway/internal/handler/chat.go:1949-1959`）。
- `conversation` crate 只有 token 计数器，上下文构造器与压缩器尚未实现（`engine/crates/conversation/src/lib.rs:5-8`）。
- 已知风险：超过约 50 轮后可能触发供应商 token 上限错误。

## 阶段与检查清单

### Phase 1 · 摘要持久化与恢复（✅ 2026-09-22）

- [x] Engine：`POST /api/conversations/:id/summary` 保存摘要（替换该会话旧摘要），校验会话与首尾消息存在。
- [x] Engine：`DELETE /api/conversations/:id/summary` 清除摘要，供面板"清除压缩"使用。
- [x] Engine：`GET /api/conversations/:id` 增加 `summary_end_message_id`，前端据此还原 `keepRecent`。
- [x] Gateway：新增代理路由并同步 `docs/openapi.json` 与 docs contract。
- [x] 前端：`compactConversation` 成功后落库；打开/预取会话时从 `summary` 还原 `CompactionState`。
- [x] 测试：Engine 摘要保存/替换/删除/校验（`engine/tests/api_smoke.rs`）；前端落库与还原（`contextManagementStore.test.ts`、`conversationStore.test.ts`）；契约测试通过。

遗留决策：还原时的 `createdAt` 取当前时间，首个回合的 token 校准回退到估算，收到 provider 快照后自动重拟合；如需更精确可在 `ConversationDetail` 暴露 `summary_created_at`。

### Phase 2 · Engine 上下文构造器（✅ 2026-09-22）

- [x] `conversation` crate 新增 `context::build_context`：摘要与历史共享预算，按"从新到旧逐个纳入"选取连续后缀；摘要文本超预算或区间端点缺失时自动忽略摘要，回退为纯历史选择。
- [x] 边界测试：预算为 0、单条超长消息、摘要本身超预算、恰好等于预算、摘要区间端点缺失（`engine/crates/conversation/src/context.rs`）。

### Phase 3 · 网关接入构造器（✅ 2026-09-22，群聊除外）

- [x] 新增 Engine 内部端点 `POST /api/conversations/:id/context`，返回 `start_message_id` 与估算信息；客户端摘要与边界优先，否则使用已存储摘要。
- [x] 前端在聊天请求中声明模型窗口 `context_window`（取上下文面板同一来源）；网关据此计算预算 = 窗口 − 输出预留 − 系统提示（摘要由 Engine 计费，避免重复扣除）− 安全余量。
- [x] 网关按 Engine 返回的起点重建历史；Engine 失败或起点找不到时回退旧行为。未声明窗口的旧客户端保持按消息条数截断。
- [x] 测试：Engine 端点选择用例（预算/摘要/存储摘要）、网关闭环用例（声明窗口后按引擎起点构造请求）、预算与回退单元测试。
- [ ] 群聊回合（`group-chat`、异步 runner）仍使用旧截断逻辑，待 Phase 4 统一。

Phase 3 说明：验收标准中的"50+ 轮不再触发供应商上限"由"选中历史估算恒 ≤ 预算"保证（`build_context` 的严格预算行为），未做真实供应商压测。

### Phase 4 · 自动滚动摘要（✅ 2026-09-22）

- [x] 网关新增 `POST /api/v1/conversations/:id/summarize-context`：用会话自身的服务商/模型生成摘要并落库；已有摘要会折叠进新摘要并保留原起始消息，实现滚动。
- [x] 前端在自动压缩阈值触发与手动「压缩上下文」时调用该端点，用模型摘要替换本地预览；失败时保留本地摘要，聊天继续按 token 预算回退。
- [x] 摘要区间（start/end message id）随 `GET /api/v1/conversations/{id}` 返回，上下文面板展示摘要覆盖的消息条数。
- [x] 群聊回合接入同一预算选择：成员模型在服务商配置中声明了上下文窗口时按 token 预算裁剪历史；未配置窗口、Engine 调用失败或选择结果为空时回退完整历史（当前用户消息只存在于运行中的历史里，必须送达模型）。

## 契约要点（Phase 1）

```
POST /api/v1/conversations/{id}/summary
{ "summary": string, "start_message_id": string, "end_message_id": string }
→ 200 { id, conversation_id, summary_text, start_message_id, end_message_id, created_at }

DELETE /api/v1/conversations/{id}/summary → 204
```

`GET /api/v1/conversations/{id}` 增加 `summary_end_message_id: string | null`；
`keepRecent = 消息总数 - index(summary_end_message_id) - 1`，找不到时回退默认值 6。

## 明确不做（本期）

- 语义 embedding 模型替换 feature hashing（REMAINING_WORK §5，另行评估）。
- 摘要内容的智能生成（Phase 4 才引入 LLM，Phase 1 仍是前端本地摘要文本）。

## 验收门禁

- `cd engine && cargo test`、`cargo clippy --all-targets --features standalone -- -D warnings`
- `cd gateway && go test ./... && go vet ./...`
- `cd frontend && pnpm check && pnpm test && pnpm lint`
- `pnpm test:docs`
