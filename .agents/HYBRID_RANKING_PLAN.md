# 混合检索（FTS5 + 向量）实施计划（P2）

> 状态：已完成（2026-09-22）。对应 `.agents/REMAINING_WORK.md` §5（Vector Search And RAG Follow-up）。
> 已确认决策：RRF 融合（k=60）；hybrid 设为默认检索模式；顺带做小规模召回基准。

## 目标

1. Knowledge 与 Memory 检索默认使用 FTS5 + 向量双路召回、RRF 融合并按 id 去重；
2. 保留 `vector` / `lexical` 显式可选，便于对比与回退；
3. 固定小语料基准作为回归门禁，防止融合层退化。

## 现状（证据）

- Knowledge 纯向量：`engine/src/api/knowledge.rs:239-284`（LanceDB 主、SQLite-Vec 回退）；`chunks_fts` 建表后仅 MCP server 查询（`engine/src/mcp_server.rs:250`）。
- Memory 由调用方二选一：`engine/src/api/memories.rs:202-256`（`lexical` → `search_memories_fts[_for_groups]`，`vector` → `search_memory_vectors_for_groups`）。
- FTS 查询辅助已存在：`engine/crates/storage/src/sqlite/mod.rs:852-895`（memories）、`:1832`（chunks）。
- 搜索响应 `backend` 现为 `lance_db` / `sqlite_vec` / `sqlite_fts`，前端 Knowledge 面板展示该标签。

## 决策

- **RRF**：`score(id) = Σ 1/(60 + rank)`，rank 从 1 起；同一 id 只出现一次并取最优名次。BM25 与余弦距离不可比，RRF 免归一化与调参。
- **hybrid 默认**：Knowledge 未传 `retrieval` 时 hybrid；Memory 的 `retrieval` 缺省 hybrid；`vector` / `lexical` 仍可用。
- **基准**：内置固定小语料 fixture，断言 hybrid 命中集合与排序不低于任一单路，作为 cargo 测试门禁。

## 阶段与检查清单

### Phase 1 · storage 融合原语（✅）

- [x] RRF 融合函数：`crates/storage/src/fusion.rs`，输入两路有序结果（按 id 访问器），输出去重后的融合排序与分数。
- [x] 单元测试：空路、单路、完全重叠、名次并列、超出 k 的长尾。

### Phase 2 · Knowledge 接入（✅）

- [x] `GET /api/knowledge/search` 走 FTS + 向量双路 → RRF；响应 `backend=hybrid`。
- [x] 可选 `retrieval=vector|lexical|hybrid`（缺省 hybrid）。
- [x] 集成测试：词面与语义同时命中的 chunk 只返回一次且排序靠前；`retrieval=vector` 行为与现状一致。

### Phase 3 · Memory 接入（✅）

- [x] `retrieval` 增加 `hybrid` 并设为缺省；组/归档作用域过滤复用现有 `*_for_groups` 逻辑。
- [x] 集成测试：作用域过滤在融合结果上仍生效；`lexical` / `vector` 回归不变（含 RAG 模式下向量索引写入）。

### Phase 4 · 前端与文档（✅）

- [x] Knowledge 结果的 backend 标签支持 `hybrid` / `sqlite_fts`（中英词条）。
- [x] README（中英）路线图、架构图（FTS + 向量 + RRF）、CLAUDE.md、CHANGELOG 同步。

### 基准（✅ 小规模）

- [x] `hybrid_retrieval_preserves_route_findings_on_fixed_corpus`：固定 6 篇语料 + 4 条查询，断言融合不丢失任一单路召回，并要求语料中存在两路不一致的查询（`probe uptime`：词面第一与向量第一不同）。

修正：原计划中的「Memories 检索模式选择器」并不存在——前端 Memory 搜索从不传 `retrieval`，默认切换即对用户生效，因此无 UI 改动。

## 验收门禁

- `cd engine && cargo test`、`cargo clippy --all-targets --features standalone -- -D warnings`
- `cd gateway && go test ./...`（Engine 端点被网关代理，无路由变化时预期无改动）
- `cd frontend && pnpm check && pnpm vitest run && pnpm lint`
- `pnpm test:docs`

## 明确不做（本期）

- 语义 embedding 模型替换：`REMAINING_WORK` §5 的评估项。若基准显示词面兜底不足再单独开题。
- Reranker 精排：先验证 RRF 是否够用。
