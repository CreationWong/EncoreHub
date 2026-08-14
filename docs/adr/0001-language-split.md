# 0001 — 多语言模块切分

* **状态**：Superseded in part by [ADR-0007](0007-rust-native-data-pipeline.md)
* **日期**：2026-06-16
* **决策者**：项目主导

> 本 ADR 记录最初的四语言设计。Engine sidecar 部分由
> [ADR-0004](0004-engine-in-process-and-internal-auth.md) 替代，Python 数据服务与
> Chroma 部分由 [ADR-0007](0007-rust-native-data-pipeline.md) 替代。

## 背景

EncoreHub 是单仓项目，但被拆成 4 个语言子模块：

- `frontend/` — TypeScript + React + Tauri
- `gateway/` — Go
- `engine/` — Rust

新人首要问题是"为什么不全用一个语言"，本 ADR 把背后的取舍记下来。

## 决策

按 **运行时性质** 切分，而不是按"喜欢的语言"切分。

| 子模块 | 选择 | 真正的取舍 |
|--------|------|-----------|
| **frontend** | React + Tauri | Tauri 用 Rust 内核，包体积约 5–10 MB（Electron 的 1/10）；与 engine 的 Rust 生态一致，前端壳层直接复用一些库 |
| **gateway** | Go | 高并发 IO 网关 + 多 provider HTTP 适配的最佳生态。Go 的 `net/http` + Gin + 协程模型适合"包大量上游、流式转发"的角色；静态二进制部署简单 |
| **engine** | Rust | 长期持有进程内对话/记忆/知识/向量库需要稳定低延迟的本地存储；当前还负责原生文档处理、LanceDB 与 SQLite-Vec，详见 ADR-0007 |

## 权衡

**接受的代价**

1. **CI 3 个语言组件**：用 GitHub Actions 并行跑，单语言失败不阻塞其他。
2. **跨语言通信成本**：现阶段所有跨进程通信走 HTTP/JSON。蓝图是 gRPC，但 stub 生成与三端对齐属于另一笔投入，目前未启用（详见 `docs/REMAINING_WORK.md` §6）。
3. **类型重复**：`Conversation` / `Memory` / `Skill` 等结构在 TS/Go/Rust 各定义一份。当前手工同步可控；接 gRPC 后由 protoc 生成。
4. **打包（历史决策）**：Tauri 最初把 engine 与 gateway 都作为 sidecar。当前 Engine 已进程内运行，数据管线也已内嵌；打包与认证边界见 ADR-0004 和 ADR-0007。

**没接受的代价**

- 不会为了"统一语言"把 engine 用 Go 重写——存储层那一摊性能/内存敏感代码用 Go GC 不划算。
- 不会用 Node 当 gateway——Go 协程模型对"30 路并发 SSE 转发到不同 provider"更稳。
- 原先拒绝用 Rust 实现 RAG/embedding；该判断已由 ADR-0007 根据本地离线与打包约束取代。

## 后果

* 仓库根目录看起来比单语言项目复杂；这个 ADR + README 是新人的第一站。
* 各子模块**禁止**因为跨语言不便而把对方的职责吃过来。例：
  - gateway 不应该自己读 SQLite —— 走 engine HTTP。
  - engine 不应该自己调 OpenAI —— 走 gateway 的 provider 适配。
  - 前端不应该绕过 gateway 直接打 engine —— 当前前端的 service 层都通过 `API_BASE`（gateway）。
* 后续如果要加新模块，先问"它和现有 3 个语言组件能复用吗？" 默认答案应该是 **复用**，新增语言 = 新 ADR。

## 相关链接

- [ADR-0004：Engine 进程内化与内部认证](0004-engine-in-process-and-internal-auth.md)
- [ADR-0007：Rust 原生数据管线](0007-rust-native-data-pipeline.md)
- [剩余工作](../REMAINING_WORK.md) — 当前实现与发布验收待办
- [完整蓝图](../DEVELOPMENT_PLAN.md)
