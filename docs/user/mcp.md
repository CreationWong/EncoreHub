# 把 EncoreHub 接入 MCP 客户端

EncoreHub 随桌面安装包发布一个本地 MCP（Model Context Protocol）服务器，把本机知识库与记忆暴露给支持 MCP 的外部 AI 客户端（Claude Desktop、各类 MCP 客户端）。服务器通过标准输入输出（stdio）通信，不监听端口、不访问网络。

## 可用工具

| 工具 | 说明 |
|------|------|
| `search_knowledge` | 在知识库中检索（FTS5 词面 + 向量语义，RRF 混合排序） |
| `search_memory` | 检索已保存的记忆（同样为混合检索） |
| `list_skills` | 列出本机已安装的技能及其触发词 |

## 安装位置

MCP 服务器二进制随安装包发布在安装目录的 `lib/` 下，与引擎运行时库同目录：

| 平台 | 路径 |
|------|------|
| macOS | `EncoreHub.app/Contents/Resources/lib/encorehub-mcp` |
| Windows | `<安装目录>\lib\encorehub-mcp.exe` |
| Linux | `<安装目录>/lib/encorehub-mcp` |

数据库位于应用数据目录（macOS `~/Library/Application Support/com.0d000721.encorehub.desktop/data/encorehub.db`，Windows `%APPDATA%\com.0d000721.encorehub.desktop\data\encorehub.db`，Linux `~/.local/share/com.0d000721.encorehub.desktop/data/encorehub.db`）。

## 客户端配置

在客户端配置中加入（把路径替换为实际安装路径）：

```json
{
  "mcpServers": {
    "encorehub": {
      "command": "/Applications/EncoreHub.app/Contents/Resources/lib/encorehub-mcp",
      "args": [
        "--db",
        "/Users/<你>/Library/Application Support/com.0d000721.encorehub.desktop/data/encorehub.db",
        "--skills-dir",
        "/Applications/EncoreHub.app/Contents/Resources/skills"
      ]
    }
  }
}
```

说明：

- 显式传入 `--db` 与 `--skills-dir` 可以让配置在任何工作目录下都可用；省略时默认读取 `data/encorehub.db` 与数据库同级的 `skills/`。
- 也支持环境变量 `ENGINE_DB` 与 `ENCOREHUB_SKILLS_DIR`，命令行参数优先。
- 建议先启动一次 EncoreHub 桌面应用，确保数据库与索引已创建。

## 故障排查

- **客户端报无法启动**：确认 `lib/` 下二进制存在且有执行权限（macOS/Linux）。
- **返回空结果**：确认桌面应用中已导入知识或保存记忆，并且数据库路径与上表一致。
- **数据库被占用**：SQLite 支持多进程读取，正常使用无需关闭桌面应用；如遇锁定，关闭应用后重试。
