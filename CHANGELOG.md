# Changelog

EncoreHub 项目变更记录。日期均为 UTC。

## Unreleased — 2026-06-16

> 一次密集开发会话的产出。所有 P0 阻塞问题修复，前端从骨架变成可用产品，三端测试覆盖从 0 起步至 ~50 个用例。

### Added

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
- **frontend**：vitest 接通，conversationStore + slash commands 共 16 测试
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

| 模块 | 用例数 |
|------|--------|
| frontend (vitest) | 16 |
| gateway/router | 11 |
| gateway/provider/anthropic | 10 |
| gateway/handler | 7 |
| engine/storage | 5 |
| engine 单元（skill/migrations） | 2 |
| **合计** | **51** |
