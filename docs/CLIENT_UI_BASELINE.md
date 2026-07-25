# EncoreHub 客户端 UI 基线

> 基线日期：2026-07-24
> 对应工作项：[CLIENT_UI_OPTIMIZATION_WORKFLOW.md](CLIENT_UI_OPTIMIZATION_WORKFLOW.md) 的 CUI-00 / UG0
> 输入计划：[CLIENT_UI_OPTIMIZATION_PLAN.md](CLIENT_UI_OPTIMIZATION_PLAN.md)
> 状态：已完成

## 1. 基线范围

本基线记录 UI 改造前的客户端现状，用于后续 CUI-01 至 CUI-12 的同视口对比。它不定义目标设计，也不把当前缺陷视为验收通过。

基线覆盖：

- 当前 `Sidebar + ChatView` 两栏结构。
- 无对话、空对话、短回复、长 Markdown、system、reasoning、tool call、streaming、stopped 和 failed 状态。
- token 为未知、0、普通值和大值时的显示。
- 超长 CJK 对话标题、Provider 名和 Model 名。
- 当前 Providers 三栏 Settings、已加密保存且 vault 锁定的 key 状态。
- `1600x1120`、`1200x800`、`900x700`、`680x480` 的亮色和暗色截图。

所有内容均来自开发/测试专用合成夹具，不读取 Gateway、用户数据库、API key、角色提示词或真实对话。生产入口 `src/main.tsx` 不导入基线代码，`ui-baseline.html` 的入口在非开发模式会直接拒绝运行。

## 2. 重现方法

### 2.1 启动基线页面

```powershell
pnpm --dir frontend dev --host 127.0.0.1
```

默认页面：

```text
http://127.0.0.1:1420/ui-baseline.html?scenario=long-markdown&theme=light
```

参数：

- `scenario` 使用第 3 节中的稳定 ID；未知值降级为 `long-markdown`。
- `theme` 只接受 `light` 或 `dark`；未知值降级为 `light`。
- 页面根元素设置 `data-ui-baseline-ready="true"` 后才视为完成首帧。
- ready 后关闭动画和 transition，避免流式光标造成无意义的像素差异。

### 2.2 重新生成截图

另开终端执行：

```powershell
pnpm --dir frontend capture:ui-baseline
```

截图脚本：

- 优先使用 `CHROME_PATH`，否则按 Windows、macOS、Linux 的常见路径查找 Chrome、Edge 或 Chromium。
- 每张截图使用 OS 临时目录下的隔离浏览器 profile。
- 只访问 `UI_BASELINE_URL`，默认是 `http://127.0.0.1:1420`。
- 验证 PNG signature 和宽高，生成 bytes 与 SHA-256 manifest。
- 默认写入 `docs/ui-baseline/<UI_BASELINE_DATE>/`；本次日期为 `2026-07-24`。

本次内置 Browser 连接因本机 Node 运行时路径不可用而无法启动，最终使用上述零依赖 headless Chrome 脚本生成证据。页面、视口、状态和输出校验与浏览器工具选择无关。

## 3. 状态夹具

| Scenario ID | 覆盖状态 | 关键边界 |
|---|---|---|
| `no-conversation` | 未选择对话 | 欢迎空状态、输入区仍可见 |
| `empty-conversation` | 已选择但无消息 | 空消息区、活动会话 |
| `short` | 一问一答 | `token_count = 0` 不显示 |
| `long-markdown` | CJK/Latin、列表、表格、代码 | 超长标题、Provider/Model、13,126 tokens |
| `system-message` | system JSON Markdown | system 与代码格式 |
| `reasoning` | 已完成 reasoning | 历史默认折叠、未知 telemetry |
| `tool-call` | 成功工具调用 | arguments、result、160 tokens |
| `streaming` | reasoning + tool + answer 增量 | Stop、Generating、流式光标 |
| `stopped` | 持久化部分回复 | stopped 标签、74 tokens |
| `failed` | provider 失败后的部分回复 | failed 标签、未知 token |
| `providers-locked` | Providers Settings | DeepSeek、已保存加密 key、vault locked |

夹具定义位于 `frontend/src/testing/clientUiFixtures.ts`；契约测试固定 scenario ID、视口、主题、可变数据克隆和不含 API key。

## 4. 截图证据

截图和 manifest 只作为本地验证产物生成在 `docs/ui-baseline/2026-07-24/`，该目录由 Git 忽略，不提交图片。完整尺寸、文件大小和 SHA-256 记录在本地 `manifest.json`。

### 4.1 长内容视口矩阵

| 视口 | Light | Dark |
|---|---|---|
| 1600x1120 | `long-markdown-light-1600x1120.png` | `long-markdown-dark-1600x1120.png` |
| 1200x800 | `long-markdown-light-1200x800.png` | `long-markdown-dark-1200x800.png` |
| 900x700 | `long-markdown-light-900x700.png` | `long-markdown-dark-900x700.png` |
| 680x480 | `long-markdown-light-680x480.png` | `long-markdown-dark-680x480.png` |

### 4.2 关键状态

| 状态 | 截图 |
|---|---|
| Streaming / dark / 1200x800 | `streaming-dark-1200x800.png` |
| Failed / light / 1200x800 | `failed-light-1200x800.png` |
| Providers locked / light / 1200x800 | `providers-locked-light-1200x800.png` |

其余状态通过第 3 节 URL 参数重复渲染，由夹具契约和组件测试覆盖；不为每个等价状态提交重复 PNG。

## 5. 当前行为 smoke

| 行为 | 当前结果 | 证据 |
|---|---|---|
| 对话创建、选择、删除和双击重命名 | 现有组件路径可用 | ConversationList 5 tests |
| 侧栏打开、折叠、拖拽范围和主题切换 | 现有组件路径可用 | Sidebar 6 tests |
| user/assistant/system/tool/reasoning 渲染 | 现有状态可渲染 | MessageBubble 9 tests |
| assistant 复制 | 只复制最终 content | MessageBubble copy test |
| 输入、Slash、搜索、发送、停止和 IME guard | 现有路径可用 | InputBox 7 tests |
| 多对话后台流、失败回滚和重命名回滚 | store 状态保持一致 | conversationStore 25 tests |
| 基线 scenario、主题、视口与安全约束 | 固定且可克隆 | clientUiFixtures 5 tests |
| Providers 已保存 key 的 locked 状态 | 固定掩码和 ENCRYPTED 状态可见 | Providers locked screenshot |

专项结果：6 个测试文件、57 项测试通过。测试中的预期失败分支只输出 error type 和 length，不包含合成消息或 secret。

完整 Frontend gate 结果：

- `pnpm --dir frontend check`：通过。
- `pnpm --dir frontend lint`：72 个文件通过。
- `pnpm --dir frontend test -- --run`：20 个测试文件、144 项测试通过。
- `pnpm --dir frontend build`：通过；初始 JavaScript gzip 为 111.58 KiB / 300 KiB。
- production build 只包含 `index.html`，不包含开发专用 `ui-baseline.html` 入口。
- `pnpm test:docs`：4 项文档与契约测试通过。
- `pnpm --dir frontend capture:ui-baseline`：11 张截图、PNG 尺寸和 SHA-256 manifest 通过。

## 6. 基线发现

| ID | 当前现象 | 影响 | 后续工作项 |
|---|---|---|---|
| BL-01 | 页面只有 Sidebar + ChatView，没有顶部全局导航和主区上下文栏 | 应用级命令与会话上下文没有稳定位置 | CUI-01、CUI-03 |
| BL-02 | Provider/Model 位于侧栏底部，长名称逐字换行并显著增加底栏高度 | 列表空间被挤占，信息不可快速扫描 | CUI-02、CUI-03 |
| BL-03 | 侧栏当前范围为 200-480px，折叠后仍保留 48px 图标栏 | 与目标 260-380px 和完全隐藏语义不一致 | CUI-02 |
| BL-04 | 消息正文约 768px；user 与 assistant 都使用带头像/标题的消息行 | 1600px 下正文偏窄，回复层级与参考图不一致 | CUI-04 |
| BL-05 | token 显示在 Assistant 标题行，13.1k tokens 与模型标签共用顶部基线 | 不属于对应回复的底部状态组 | CUI-04、CUI-08 |
| BL-06 | streaming 同时已有 answer 时 reasoning 保持折叠 | 用户看不到仍在增长的思考区 | CUI-04 |
| BL-07 | `ChatView` 对消息和每次流增量无条件 smooth `scrollIntoView` | 用户向上阅读时会被抢回底部；长对话首载直接落到底部 | CUI-05 |
| BL-08 | 680x480 下固定 256px 侧栏只给主区留下约 424px；textarea placeholder 换行，代码与表格依赖横向滚动 | 最小窗口可操作但不舒适，内容扫描困难 | CUI-02、CUI-05、CUI-09 |
| BL-09 | 输入区由 textarea、搜索双按钮和发送按钮分散排列；字符数从第一个字符起常驻 | 与目标一体式 composer 和 85% 后提示不一致 | CUI-05 |
| BL-10 | Providers 详情顺序为 endpoint -> key -> models，模型使用多行文本框，enabled 位于底部 | 配置流程和参考 Image #2 不一致 | CUI-06 |
| BL-11 | Settings 打开时 Provider 未默认选中；详情区先显示空提示 | 每次进入都需要额外选择，无法立即确认当前 Provider | CUI-06 |
| BL-12 | 当前无角色 tab、CharacterProfile、角色版本或 prompt 快照 | 添加角色不能只做前端入口 | CUI-10、CUI-11、CUI-12 |

### 6.1 可复用的现有能力

- `conversationStore` 已有按 Conversation 隔离的消息和流式 cache，可作为分会话草稿/滚动状态的落点。
- Message 已有 `reasoning`、tool calls、`status` 和合计 `token_count`，CUI-04 可以先完成纯展示重构。
- InputBox 已处理中文输入法组合态 Enter、Slash、搜索和停止，不需要重写发送语义。
- Sidebar 已有拖拽宽度和本地持久化，可收敛范围后复用。
- Provider profile、secrets vault 和完整 profile PUT 已存在，CUI-06 只需要重构详情 draft；检测与发现仍需 CUI-07 契约。
- Settings 已有一级导航、Provider 中间列表和右侧详情结构，目标应保留而不是改成新页面。

## 7. UG0 验收记录

- [x] 固定 1600x1120、1200x800、900x700、680x480 四个视口。
- [x] 保存四视口亮暗主题的长内容截图。
- [x] 建立空、短、长、代码、system、reasoning、tool、streaming、stopped、failed 和 Providers locked 合成状态。
- [x] 覆盖未知、0、普通和大 token 数，以及超长 CJK/Provider/Model 文本。
- [x] 记录现有新建、选择、删除、重命名、发送、停止、搜索与设置 smoke。
- [x] 夹具只存在于测试/开发入口，不读取或写入真实服务数据。
- [x] 截图脚本验证 PNG、尺寸并生成 SHA-256 manifest。
- [x] 当前问题已映射到 CUI-01 至 CUI-12，没有在 CUI-00 修改生产 UI 行为。

UG0 已通过；CUI-01 的完成证据见下一节。后续截图必须使用相同 scenario、主题和视口；若目标布局有意改变可见内容，应在对比记录中说明，而不是覆盖本基线。

## 8. CUI-01 对比记录

CUI-01 使用同一组 scenario、主题和视口在本地 `docs/ui-baseline/2026-07-24-cui-01/` 生成了独立 manifest，没有覆盖本文件第 4 节的 CUI-00 原始基线。图片和 manifest 均不进入 Git。

关键证据：

- `long-markdown-light-1600x1120.png`：64px GlobalNav、独立 workspace 和 64px ContextHeader。
- `long-markdown-light-680x480.png`：顶部导航、上下文栏和 composer 无重叠；现有侧栏宽度问题保留给 CUI-02。
- `streaming-dark-1200x800.png`：固定 header/feed/composer 槽位与现有 Stop 流程共存。
- `providers-locked-light-1200x800.png`：Settings overlay、vault 锁定状态与新应用骨架无冲突。

CUI-01 只建立结构和视觉层级，没有移动 Sidebar Provider、改变 MessageBubble、修改 InputBox 命令语义或关闭 Tauri 原生窗口装饰。

## 9. CUI-02 对比记录

CUI-02 使用相同矩阵在本地 `docs/ui-baseline/2026-07-25-cui-02/` 生成 13 张图片。该目录由 Git 忽略，仓库只保留下列文字结论：

- `long-markdown-light-1600x1120.png`：300px Sidebar、Characters/Conversations tabs、日期分组和 ContextHeader ProviderSwitcher 层级稳定。
- `long-markdown-light-680x480.png`：260px 最小侧栏、长标题和 Provider/Model 分别截断，无控件重叠；Composer 的窄窗换行留给 CUI-05。
- `characters-light-1200x800.png`：Default character 投影可见，不显示未接通的添加、导入或删除入口。
- `sidebar-closed-light-1200x800.png`：侧栏宽度归零，主工作区填满可用空间，PanelLeft 按钮可恢复侧栏。
- `long-markdown-dark-1200x800.png`：暗色选中面、accent 标识、分组标签和模型元数据保持清晰层级。

从 CUI-02 起，验证图片和 manifest 不再进入 Git；此前 CUI-00/CUI-01 已跟踪的视觉产物也从索引移除，但本机文件保留供当前工作区验收。
