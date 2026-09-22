# 长对话上下文上下文工程实施计划（P1）

> 状态：Phase 1 已完成（2026-09-22），Phase 2 待开始。对应 `.agents/REMAINING_WORK.md` §3（Conversation Context And Long-Chat Intelligence）。
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

### Phase 2 · Engine 上下文构造器

- [ ] `conversation` crate 增加 `build_context(messages, budget) -> Vec<Message>`：保留最新原始轮次，超出预算的部分由摘要替代，工具调用载荷按预算折叠。
- [ ] 边界测试：预算为 0、单条超长消息、摘要本身超预算、恰好等于预算。

### Phase 3 · 网关接入构造器

- [ ] 网关调用 Engine 构造器（或复用同一实现）替换 `keepRecent` 截断；
- [ ] 保留 `context_summary`/`context_keep_recent` 兼容旧客户端，新路径以构造器结果为准；
- [ ] 覆盖 50+ 轮会话的回归用例，断言不再触发供应商 token 上限。

### Phase 4 · 自动滚动摘要

- [ ] 达到阈值时由 Engine 生成摘要（经网关调用用户所选模型），写入 `conversation_summaries`；
- [ ] 摘要与原始消息区间（start/end message id）可审计，面板展示来源区间；
- [ ] 手动压缩与自动滚动共用同一落库路径，手动优先。

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
