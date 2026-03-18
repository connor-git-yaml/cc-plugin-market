# 问题修复报告

## 问题描述
reverse-spec 插件安装后 MCP server 启动失败（`plugin:reverse-spec:reverse-spec · ✘ failed`），原因是 `.mcp.json` 中硬编码了错误的绝对路径。用户要求使用方案 1（变量 / npx 方式）解决，确保跨机器可移植。

## 根因分析
- **根因**: `plugins/reverse-spec/.mcp.json` 中 MCP server 的 `args` 字段硬编码了绝对路径 `/Users/connorlu/Desktop/.workspace2.nosync/reverse-spec/dist/cli/index.js`，而该路径不存在（项目已迁移到 `cc-plugin-market/` 目录）
- **引入原因**: 项目从 `reverse-spec/` 迁移到 `cc-plugin-market/` 时（commit `9dd9d73`），`.mcp.json` 中的绝对路径未同步更新。更根本的问题是：使用绝对路径本身就不适合分发型插件

## 影响范围
- 受影响文件: `plugins/reverse-spec/.mcp.json`（1 个文件）
- 受影响功能: reverse-spec 的 4 个 MCP 工具（`prepare`、`generate`、`batch`、`diff`）全部不可用；skill 模式不受影响（skill 直接调用 CLI）

## 修复策略
### 方案 A（推荐）— npx + CLAUDE_PLUGIN_ROOT
将 `.mcp.json` 改为使用 `npx reverse-spec mcp-server` 命令，与 README 文档中的推荐配置保持一致：

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

**优点**:
1. 跨机器可移植，不依赖特定安装路径
2. 与 README 文档一致，消除文档/实现不一致
3. `npx` 会自动解析已全局安装的 CLI 或按需下载
4. `cwd` 使用 `${CLAUDE_PLUGIN_ROOT}` 确保工作目录正确

**风险**: npx 首次调用时可能有数秒延迟（需下载包）；已全局安装时无延迟

### 方案 B（备选）— node + CLAUDE_PLUGIN_ROOT 变量路径
在 args 中使用变量替换：
```json
{
  "command": "node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/../../dist/cli/index.js", "mcp-server"]
}
```

**缺点**: 依赖插件目录和 dist/ 的相对位置关系，在 npm 发布后（dist 在包内，plugins 也在包内）路径关系可能变化；且 `${CLAUDE_PLUGIN_ROOT}` 在 `args` 字段中的变量替换行为未经确认

## Spec 影响
- 需要更新的 spec: 无需更新（这是配置 bug，非功能变更）
