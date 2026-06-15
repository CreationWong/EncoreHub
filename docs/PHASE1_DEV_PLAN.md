# EncoreHub Phase 1 详细开发计划

> 目标：3 个月内交付 MVP —— 一个可用的跨供应商 AI 聊天客户端
> 上一个里程碑：环境初始化完成 ✅

---

## 总览

```
Week 1-2   │ 存储层 + 数据模型        │ SQLite schema、LanceDB 初始化、gRPC proto
Week 3-4   │ Rust 对话引擎            │ 对话 CRUD、上下文管理、gRPC server
Week 5-6   │ Go API 网关 + 供应商适配  │ 路由、OpenAI 适配器、SSE 流式代理
Week 7-9   │ 前端聊天界面              │ Tauri 壳、聊天视图、流式渲染、侧边栏
Week 10-11 │ 集成联调                  │ 端到端打通、错误处理、日志
Week 12    │ 测试 + 打包               │ 集成测试、Windows/macOS 打包验证
```

---

## Sprint 1: 存储层与数据模型 (Week 1-2)

### 1.1 Proto 定义（补完）

**文件**：`proto/encorehub/v1/`
- [x] `common.proto` — 基础类型（Timestamp, Pagination）
- [x] `conversation.proto` — 对话服务
- [x] `memory.proto` — 记忆服务
- [ ] `knowledge.proto` — 知识库服务
- [ ] `search.proto` — 网络搜索服务
- [ ] `skill.proto` — Skill 管理服务

**产出**：`buf generate` 生成 Go/Rust/Python 代码

### 1.2 Rust 存储层 — SQLite

**文件**：`engine/crates/storage/sqlite/`

| 文件 | 职责 |
|------|------|
| `mod.rs` | 模块入口，Database 结构体 |
| `migrations.rs` | SQL 迁移管理 |
| `conversations.rs` | 对话/消息 CRUD |
| `memories.rs` | 记忆 CRUD |
| `config.rs` | 用户配置存取 |
| `search_cache.rs` | 搜索缓存表 |

**SQLite 表结构**：
```sql
-- 对话
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Chat',
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 消息
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
    content TEXT NOT NULL,
    parent_id TEXT,
    token_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- 消息工具调用
CREATE TABLE tool_calls (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    arguments TEXT NOT NULL
);

-- 对话摘要（长对话压缩）
CREATE TABLE conversation_summaries (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    summary_text TEXT NOT NULL,
    start_message_id TEXT NOT NULL,
    end_message_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- 钉选消息
CREATE TABLE pinned_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    note TEXT,
    pinned_at INTEGER NOT NULL
);

-- 全局记忆（元数据，向量存入 LanceDB）
CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK(scope IN ('conversation','global')),
    type TEXT NOT NULL CHECK(type IN ('working','episodic','semantic','pinned')),
    conversation_id TEXT,
    content TEXT NOT NULL,
    importance REAL DEFAULT 0.5,
    created_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL
);

-- FTS5 全文索引（记忆内容）
CREATE VIRTUAL TABLE memories_fts USING fts5(
    content,
    content_rowid='rowid'
);

-- 搜索缓存
CREATE TABLE search_cache (
    id TEXT PRIMARY KEY,
    query_hash TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    results_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

-- 用户配置
CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
```

### 1.3 Rust 存储层 — LanceDB

**文件**：`engine/crates/storage/lancedb/`

| 文件 | 职责 |
|------|------|
| `mod.rs` | LanceDB 连接管理 |
| `embeddings.rs` | 通用向量存储接口 |
| `memory_index.rs` | 记忆向量索引 |
| `knowledge_index.rs` | 知识库向量索引 |

**LanceDB 表设计**：
```rust
// 记忆索引表
// columns: id (string), embedding (fixed_size_list<float>[1536]), 
//           scope (string), memory_type (string), metadata (string/JSON)
```

### 1.4 Rust 核心 Crate 骨架

**文件**：`engine/crates/core/`

| 文件 | 职责 |
|------|------|
| `types/mod.rs` | Conversation, Message, Memory, ToolCall 等类型定义 |
| `error/mod.rs` | 统一错误类型（thiserror） |

---

## Sprint 2: Rust 对话引擎 (Week 3-4)

### 2.1 gRPC Server

**文件**：`engine/src/`

| 文件 | 职责 |
|------|------|
| `main.rs` | 入口：初始化 DB、启动 gRPC server |
| `grpc/mod.rs` | gRPC 服务注册 |
| `grpc/conversation.rs` | ConversationService 实现 |

### 2.2 对话管理 Crate

**文件**：`engine/crates/conversation/`

| 文件 | 职责 |
|------|------|
| `manager/mod.rs` | ConversationManager — 对话生命周期 |
| `manager/create.rs` | 创建对话 |
| `manager/append.rs` | 追加消息 |
| `manager/branch.rs` | 消息分支/重新生成 |
| `manager/delete.rs` | 删除对话 |
| `context/mod.rs` | ContextManager — Token 窗口管理 |
| `context/builder.rs` | 上下文组装（消息 + 记忆 + 摘要） |
| `context/token_counter.rs` | Token 计数（tiktoken-rs） |
| `compressor/mod.rs` | 长对话压缩为摘要 |
| `storage/mod.rs` | 对话存储实现（SQLite backend） |

**关键逻辑**：
```
ContextBuilder.build(conversation_id):
  1. 从 SQLite 加载最近消息（不超过 token 预算的 70%）
  2. 查询对话记忆（LanceDB 向量检索相关记忆）
  3. 查询全局记忆（LanceDB 向量检索相关记忆）
  4. 如果有摘要，注入系统消息
  5. 如果有钉选消息，注入
  6. 返回 [system_prompt, ...memories, ...pinned, summary, ...messages]
```

### 2.3 基础 OS 抽象层

**文件**：`engine/crates/os-abstraction/`

| 文件 | 职责 |
|------|------|
| `mod.rs` | OS 能力 trait 定义 |
| `filesystem/mod.rs` | 文件读写（跨平台路径处理） |
| `clipboard/mod.rs` | 剪贴板读写 |
| `shell/mod.rs` | Shell 命令执行（沙箱） |

---

## Sprint 3: Go API 网关 (Week 5-6)

### 3.1 HTTP 路由与中间件

**文件**：`gateway/internal/router/`

| 文件 | 职责 |
|------|------|
| `router.go` | Gin 路由注册 |
| `middleware/auth.go` | API Key 验证中间件 |
| `middleware/ratelimit.go` | 令牌桶限流 |
| `middleware/logging.go` | 请求日志 |
| `middleware/cors.go` | CORS 配置 |
| `handler/chat.go` | POST /api/v1/chat |
| `handler/conversation.go` | CRUD /api/v1/conversations |
| `handler/health.go` | GET /health |

### 3.2 供应商适配器

**文件**：`gateway/internal/provider/`

| 文件 | 职责 |
|------|------|
| `adapter.go` | Adapter 接口定义 |
| `registry.go` | 供应商注册表 |
| `openai/adapter.go` | OpenAI Chat Completions → 统一格式 |
| `openai/stream.go` | OpenAI SSE → 统一 Event Stream |
| `anthropic/adapter.go` | Anthropic Messages → 统一格式 |
| `anthropic/stream.go` | Anthropic SSE → 统一 Event Stream |
| `custom/template.go` | 自定义 OpenAI 兼容供应商模板 |

**统一 Adapter 接口**：
```go
type Adapter interface {
    ID() string
    Chat(ctx context.Context, req *UnifiedRequest) (*UnifiedResponse, error)
    ChatStream(ctx context.Context, req *UnifiedRequest) (<-chan ChatEvent, error)
    ListModels(ctx context.Context) ([]Model, error)
    ValidateKey(ctx context.Context, key string) error
}
```

### 3.3 协议转换

**文件**：`gateway/internal/protocol/`

| 文件 | 职责 |
|------|------|
| `unified_request.go` | 统一请求结构体 |
| `unified_response.go` | 统一响应结构体 + ChatEvent |
| `stream/manager.go` | SSE Stream 管理器（多路复用） |
| `stream/adapter.go` | 供应商 SSE → 统一 SSE 转换 |

### 3.4 gRPC 客户端

**文件**：`gateway/internal/`

| 文件 | 职责 |
|------|------|
| `engine/client.go` | 连接 Rust Engine 的 gRPC 客户端 |

---

## Sprint 4: 前端聊天界面 (Week 7-9)

### 4.1 基础框架

**文件**：`frontend/src/`

| 文件 | 职责 |
|------|------|
| `main.tsx` | 入口 | ✅
| `App.tsx` | 路由 + 布局 | ✅
| `styles/globals.css` | 全局样式 + CSS 变量 | ✅

### 4.2 状态管理

**文件**：`frontend/src/stores/`

| 文件 | 职责 |
|------|------|
| `conversationStore.ts` | 对话列表、当前对话、消息状态 (Zustand) |
| `settingsStore.ts` | 用户配置、供应商设置、主题 |
| `streamStore.ts` | SSE 流式状态管理 |

### 4.3 API 服务层

**文件**：`frontend/src/services/`

| 文件 | 职责 |
|------|------|
| `api.ts` | HTTP 客户端封装（fetch + 超时 + 重试） |
| `chat.ts` | 发送消息、流式读取 SSE |
| `conversation.ts` | 对话 CRUD API |
| `provider.ts` | 供应商/模型列表 API |

### 4.4 聊天核心组件

**文件**：`frontend/src/components/chat/`

| 文件 | 职责 |
|------|------|
| `ChatView.tsx` | 聊天主视图（消息列表 + 输入框） | ✅ stub
| `MessageBubble.tsx` | 单条消息气泡（Markdown 渲染、代码高亮、头像） |
| `MessageList.tsx` | 消息列表（虚拟滚动优化） |
| `InputBox.tsx` | 输入框（多行、Enter 发送、Shift+Enter 换行） |
| `StreamingText.tsx` | 流式文本打字机效果渲染 |
| `ContextPanel.tsx` | 侧边上下文面板（记忆/知识库引用） |
| `EmptyState.tsx` | 空状态/欢迎页 |

### 4.5 侧边栏组件

**文件**：`frontend/src/components/sidebar/`

| 文件 | 职责 |
|------|------|
| `Sidebar.tsx` | 侧边栏容器 | ✅ stub
| `ConversationList.tsx` | 对话列表（搜索、排序、右键菜单） |
| `ConversationItem.tsx` | 单个对话项 |
| `ProviderSwitcher.tsx` | 供应商/模型下拉切换 |
| `SearchBar.tsx` | 全局搜索（Command Palette 触发） |

### 4.6 设置面板

**文件**：`frontend/src/components/settings/`

| 文件 | 职责 |
|------|------|
| `SettingsPanel.tsx` | 设置面板容器（抽屉式） |
| `ProviderConfig.tsx` | 供应商 API Key 配置表单 |
| `ModelConfig.tsx` | 模型参数（temperature, max_tokens 等） |
| `ThemeConfig.tsx` | 主题切换（暗色/亮色/系统） |
| `ShortcutConfig.tsx` | 快捷键配置 |

### 4.7 通用组件

**文件**：`frontend/src/components/common/`

| 文件 | 职责 |
|------|------|
| `CommandPalette.tsx` | Ctrl+K 全局命令面板 |
| `Toast.tsx` | 消息提示 |
| `Modal.tsx` | 通用弹窗 |
| `Dropdown.tsx` | 下拉菜单 |
| `Tooltip.tsx` | 工具提示 |
| `IconButton.tsx` | 图标按钮 |

### 4.8 Tauri 集成

**文件**：`frontend/src-tauri/`

| 文件 | 职责 |
|------|------|
| `tauri.conf.json` | Tauri 配置 | ✅
| `Cargo.toml` | Rust 依赖 | ✅
| `src/main.rs` | 窗口入口 + 插件注册 | ✅
| `src/commands/mod.rs` | Tauri IPC Commands |
| `src/commands/window.rs` | 窗口控制（最小化、托盘） |
| `src/commands/os.rs` | OS 功能 IPC（文件选择、通知） |

---

## Sprint 5: 集成联调 (Week 10-11)

### 5.1 端到端数据流

```
用户输入 "Hello"
  → 前端 InputBox.onSubmit()
  → services/chat.ts POST /api/v1/chat { stream: true }
  → Go 网关 handler/chat.go
    → engine/client.go gRPC GetContext(conversation_id) → Rust 组装上下文
    → provider/openai/adapter.go ChatStream(unifiedReq)
    → OpenAI API POST /v1/chat/completions { stream: true }
    → SSE → adapter 转换为统一 ChatEvent
    → SSE → 前端 StreamingText 渲染
  → Rust append message to SQLite
```

### 5.2 错误处理矩阵

| 错误场景 | 处理方式 |
|----------|----------|
| 供应商 API Key 无效 | 前端弹窗提示配置 |
| 供应商速率限制 | 自动重试 + 前端提示等待 |
| 网络超时 | 自动重试 3 次，失败后提示 |
| 流中断 | 保留已接收内容 + 重试按钮 |
| gRPC 引擎不可达 | 网关降级，使用内存对话 |
| 数据库写入失败 | 事务回滚 + 错误日志 |

### 5.3 日志与可观测性

- **Rust**：tracing crate + JSON 格式日志
- **Go**：zap 结构化日志
- **前端**：console 分级日志 + Tauri log plugin
- 统一 request-id 贯穿全链路

---

## Sprint 6: 测试与打包 (Week 12)

### 6.1 测试任务

| 模块 | 测试类型 | 覆盖目标 |
|------|----------|----------|
| Rust 存储层 | 单元测试 | SQLite CRUD 全覆盖 |
| Rust 上下文组装 | 单元测试 | Token 预算、记忆注入逻辑 |
| Go 适配器 | 单元测试 | 请求/响应格式转换正确性 |
| Go 流式转换 | 单元测试 | SSE event 转换 |
| 前端组件 | Vitest + Testing Library | 核心交互覆盖 |
| 全链路 | 集成测试 | 发送消息 → 收到回复 → 存入数据库 |

### 6.2 打包任务

| 平台 | 任务 |
|------|------|
| Windows | `pnpm tauri build` → MSI 安装包 |
| macOS | `pnpm tauri build` → DMG (Apple Silicon) |
| Linux | `pnpm tauri build` → AppImage |

---

## 文件清单

### 待创建文件总数：~80 个

| 模块 | 已创建 | 待创建 | 合计 |
|------|--------|--------|------|
| Proto | 3 | 3 | 6 |
| Rust Engine | 3 | ~25 | ~28 |
| Go Gateway | 2 | ~18 | ~20 |
| Python Data | 2 | ~8 | ~10 |
| Frontend | 8 | ~22 | ~30 |
| Config/Infra | 15 | 3 | 18 |
| **合计** | **33** | **~79** | **~112** |

---

## 依赖关系图

```
Proto 定义 ──────┐
                 ├──→ Rust 存储层 ──→ Rust gRPC Server ──┐
                 │                                        │
                 ├──→ Go gRPC Client ──→ Go 供应商适配器 ──┤
                 │                                        │
                 └──→ 前端 API 类型 ──────────────────────┤
                                                          │
                                                    集成联调
                                                          │
                                                    测试 + 打包
```

---

*文档版本: v1.0 | 2026-06-15*
