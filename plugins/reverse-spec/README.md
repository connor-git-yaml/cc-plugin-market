# reverse-spec — Claude Code Plugin

通过 AST 静态分析 + LLM 混合流水线，将遗留源代码逆向工程为结构化 Spec 文档。

## 功能

### Skills（3 个）

| Skill | 触发方式 | 说明 |
|-------|---------|------|
| `reverse-spec` | `/reverse-spec <path>` | 对单个文件或目录生成 9 段式 Spec 文档 |
| `reverse-spec-batch` | `/reverse-spec-batch` | 批量生成整个项目的 Spec（按模块级聚合） |
| `reverse-spec-diff` | `/reverse-spec-diff` | 检测 Spec 与源代码之间的漂移 |

### MCP Server（4 个工具）

通过 MCP 协议暴露以下工具供 Claude Code 直接调用：

| 工具 | 说明 |
|------|------|
| `prepare` | AST 预处理 + 上下文组装（无需 API Key） |
| `generate` | 完整 Spec 生成流水线 |
| `batch` | 批量 Spec 生成 |
| `diff` | Spec 漂移检测 |

## 安装方式

### 方式一：Marketplace 安装（推荐）

1. 将本仓库添加为 Claude Code Plugin Marketplace：

   ```bash
   claude plugin marketplace add <repo-url-or-local-path>
   ```

2. 安装 reverse-spec plugin：

   ```bash
   claude plugin install reverse-spec
   ```

3. 重启 Claude Code 会话，plugin 自动加载。

### 方式二：npm 全局安装

```bash
npm install -g reverse-spec
```

安装后可直接使用 CLI：

```bash
reverse-spec generate src/auth/ --deep
reverse-spec batch --force
reverse-spec diff .specs/auth.spec.md src/auth/
reverse-spec mcp-server  # 启动 MCP stdio server
```

## 配置

### 认证

支持两种认证方式（自动检测，优先级从高到低）：

1. **ANTHROPIC_API_KEY** 环境变量 — 直接 SDK 调用
2. **Claude Code CLI 订阅登录** — spawn CLI 子进程代理

### MCP Server 配置

Plugin 安装后，`.mcp.json` 自动配置 MCP server：

```json
{
  "mcpServers": {
    "reverse-spec": {
      "command": "npx",
      "args": ["reverse-spec", "mcp-server"],
      "cwd": "${CLAUDE_PLUGIN_ROOT}"
    }
  }
}
```

## 使用示例

```bash
# 单模块 Spec 生成
/reverse-spec src/auth/

# 批量生成
/reverse-spec-batch

# 漂移检测
/reverse-spec-diff .specs/auth.spec.md src/auth/
```

## 许可证

MIT
