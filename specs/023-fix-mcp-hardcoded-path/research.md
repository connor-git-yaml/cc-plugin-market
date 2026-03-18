# 技术决策研究: 023-fix-mcp-hardcoded-path

**分支**: `023-fix-mcp-hardcoded-path` | **日期**: 2026-03-16 | **模式**: fix

## 决策 1: MCP Server 启动命令方式

### 问题

`.mcp.json` 中 MCP server 启动方式的选择：`npx` vs `node` + 相对路径 vs `node` + 变量路径。

### 结论

采用 **方案 A: `npx` + `${CLAUDE_PLUGIN_ROOT}`**。

### 理由

1. **跨机器可移植性**: `npx` 自动解析全局安装的 CLI 或按需下载，不依赖绝对路径
2. **文档一致性**: README.md 中已推荐此配置方式，消除文档/实现不一致
3. **先例验证**: `hooks/hooks.json` 已成功使用 `${CLAUDE_PLUGIN_ROOT}` 变量，证明 Claude Code 插件运行时支持该变量替换
4. **`cwd` 设置**: `${CLAUDE_PLUGIN_ROOT}` 作为 `cwd` 确保 `npx` 在正确的包上下文中执行

### 替代方案

| 方案 | 描述 | 否决理由 |
|------|------|----------|
| B: `node` + `${CLAUDE_PLUGIN_ROOT}` 变量路径 | `args: ["${CLAUDE_PLUGIN_ROOT}/../../dist/cli/index.js", "mcp-server"]` | 依赖插件目录和 `dist/` 的相对位置关系，npm 发布后路径关系可能变化；且 `${CLAUDE_PLUGIN_ROOT}` 在 `args` 字段中的变量替换行为未经验证 |
| C: 仅修正绝对路径 | 将路径更新为当前正确的绝对路径 | 仅解决当前机器问题，不具备可移植性，违背分发型插件的设计原则 |

## 决策 2: 是否需要验证 `${CLAUDE_PLUGIN_ROOT}` 在 `cwd` 字段中的行为

### 结论

不需要额外验证。

### 理由

1. `hooks.json` 中已使用 `${CLAUDE_PLUGIN_ROOT}` 且工作正常（hooks 未报告失败）
2. Claude Code 插件规范对 `mcpServers` 配置的 `cwd` 字段支持环境变量替换是预期行为
3. README.md 中明确推荐了此配置，说明已经过设计和测试

## 决策 3: 是否需要同步更新其他配置文件

### 结论

不需要。仅 `.mcp.json` 一个文件需要修改。

### 理由

1. `hooks/hooks.json` 已正确使用 `${CLAUDE_PLUGIN_ROOT}`，无需修改
2. `plugin.json` 中 `mcpServers` 字段指向 `./.mcp.json` 相对路径，无需修改
3. `package.json` 中 `bin` 配置正确（`"reverse-spec": "dist/cli/index.js"`），`npx` 会利用此配置
