# 0002 — Inter-service transport: HTTP/JSON now, gRPC later

* **状态**：Accepted
* **日期**：2026-06-16
* **决策者**：项目主导

## 背景

`DEVELOPMENT_PLAN.md` 的架构图把 gateway → engine → data-services 都画成 gRPC 链路，并在依赖里声明了 `tonic` (Rust) / `grpc-go` (Go) / `grpcio` (Python)。但实际跑的是 HTTP/JSON：

- engine 用 axum 监听 `127.0.0.1:3000`；
- gateway 用 `engine.Client` 通过 `net/http` 调 engine；
- `proto/encorehub/*.proto` 存在 6 个文件，`buf.gen.yaml` 配了 remote plugins，但**从未跑过 `buf generate`**——`proto/gen/{go,rust,python}` 这三个目录甚至不存在。

新人按蓝图找 gRPC 找不到，会困惑。本 ADR 把这个差距记录下来并固定决策。

## 决策

**当前阶段固化为 HTTP/JSON。** gRPC 留作未来工作，但不在 P1 路线上。

理由：

1. **buf remote plugins 锁定外部依赖**。`buf.gen.yaml` 用 `buf.build/protocolbuffers/go` 等 remote plugin，构建时需要 buf CLI + 网络 + buf.build 账户。本地纯 protoc 替代要管理 4 套 protoc-gen 工具版本，工程负担与三端 stub 同步加起来 = 几天。
2. **现状能跑**。RAG 链路（chat 拼 memory + knowledge）已经接通；流式 SSE 在 HTTP/1.1 上工作良好；Tauri sidecar 内 loopback HTTP 没有性能压力。
3. **单 binary 部署不变**：HTTP server 与 gRPC server 都能从一个 axum / gin 进程暴露，未来加 gRPC 不需要拆服务。
4. **类型重复成本可控**：当前 Go `engine.Client` 与 Rust 响应结构对齐靠手工 + 集成测试。代码量小（~250 行）。规模继续扩张才需要 gRPC 自动生成。

## 何时迁

满足任一就值得动手：

- gateway → engine 单次请求超过 5KB JSON（场景：批量 ingest、长 history） — gRPC + protobuf 节流明显
- 需要 server-stream 的能力（例如引擎主动推送 memory 更新）— SSE 在写多读多的场景上限低
- data-services 接入：Python ↔ Rust 之间的复杂数据结构（embedding 张量、文档树）走 JSON 不经济
- 类型同步出错次数 ≥ 2（生产 bug 来源是 gateway/engine 字段对不上）

迁移路径：先用 `buf generate --template buf.gen.yaml` 跑通本地一对接口（`Conversations.List`），验证三端 stub；然后按"对话 → 记忆 → 知识"的顺序逐步替换。HTTP 端点保留 6 个月，方便回滚。

## 现在的"假状态"清理

- `gateway/go.mod`：已移除 `google.golang.org/grpc` 与 `protobuf`（前一次 `go mod tidy` 清掉了）。
- `engine/Cargo.toml`：tonic/prost 仍在依赖里，但只编进 `encorehub-mcp` binary 用作 stdio MCP server——不是 gateway↔engine 通道。
- `data-services/pyproject.toml`：`grpcio` / `grpcio-tools` 已从当前 runtime 与 lock 移除；只有满足本 ADR 的迁移条件并完成 `DATA_SERVICES_CAPABILITIES.md` 准入记录后，才能以独立 extra 或模块重新引入。
- `docker-compose.yml`：`50051` / `9090` 端口已经从 ports 列表移除（前一次提交修过），只暴露 `3000`/`8080`。

## 参考

- `docs/IMPROVEMENT_REPORT.md` §三 — 把这件事归类为 P1 差距
- `docs/adr/0001-language-split.md` — 多语言切分的代价里也提到了类型同步问题
