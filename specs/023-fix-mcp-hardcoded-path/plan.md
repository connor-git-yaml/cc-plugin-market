# 修复规划: 023-fix-mcp-hardcoded-path

**分支**: `023-fix-mcp-hardcoded-path` | **日期**: 2026-03-16 | **模式**: fix
**前序制品**: `fix-report.md`、`research.md`

## Summary

修复 `plugins/reverse-spec/.mcp.json` 中硬编码的错误绝对路径，改为使用 `npx reverse-spec mcp-server` + `${CLAUDE_PLUGIN_ROOT}` 方式，使 MCP server 在任意机器上均可正常启动。这是一个单文件、单行级别的配置修复，变更范围极小。

## Technical Context

**语言/版本**: N/A（纯 JSON 配置文件修改）
**受影响文件**: `plugins/reverse-spec/.mcp.json`（1 个文件）
**变更行数**: 约 5 行（整个文件内容替换）
**存储**: N/A
**测试**: 手动验证 — 重新加载插件后确认 MCP server 状态从 `failed` 变为正常
**目标平台**: Claude Code 插件运行时

## Constitution Check

*GATE: fix 模式下的精简检查，仅覆盖项目级原则和直接相关的 Plugin 约束。*

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 适用 | PASS | 本规划文档使用中文撰写，代码标识符保持英文 |
| II. Spec-Driven Development | 适用 | PASS | 通过 spec-driver fix 模式执行，有完整制品链（fix-report → research → plan） |
| III. 诚实标注不确定性 | 适用 | PASS | 无不确定项，所有信息已通过源文件验证确认 |
| VI. 只读安全性 | 不适用 | N/A | 修改的是插件配置文件，非目标源代码 |
| VII. 纯 Node.js 生态 | 适用 | PASS | `npx` 是 npm 生态的标准工具，未引入非 Node.js 依赖 |
| XII. 向后兼容 | 适用 | PASS | 修复后行为与预期一致（MCP server 正常启动），不破坏任何现有功能 |

**Constitution Check 结果**: 全部 PASS，无 VIOLATION。

## 变更清单

### 变更 1（唯一变更）: 修复 `.mcp.json` 配置

**文件**: `plugins/reverse-spec/.mcp.json`

**当前内容（错误）**:
```json
{
  "mcpServers": {
    "reverse-spec": {
      "command": "node",
      "args": ["/Users/connorlu/Desktop/.workspace2.nosync/reverse-spec/dist/cli/index.js", "mcp-server"]
    }
  }
}
```

**修复后内容**:
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

**变更要点**:
1. `command`: `"node"` -> `"npx"`
2. `args`: 移除硬编码绝对路径，改为 `["reverse-spec", "mcp-server"]`
3. 新增 `cwd`: `"${CLAUDE_PLUGIN_ROOT}"` 确保工作目录正确

## Project Structure

### Documentation (this feature)

```text
specs/023-fix-mcp-hardcoded-path/
├── fix-report.md         # 问题诊断报告（已有）
├── research.md           # 技术决策研究
└── plan.md               # 本文件 — 修复规划
```

### Source Code (affected)

```text
plugins/reverse-spec/
├── .mcp.json             # <-- 唯一需修改的文件
├── .claude-plugin/
│   └── plugin.json       # mcpServers 指向 ./.mcp.json（无需修改）
├── hooks/
│   └── hooks.json        # 已正确使用 ${CLAUDE_PLUGIN_ROOT}（无需修改）
├── scripts/
│   └── postinstall.sh    # 无需修改
├── skills/               # 无需修改
└── README.md             # 无需修改
```

## 回归风险评估

| 风险项 | 概率 | 影响 | 缓解措施 |
|--------|------|------|----------|
| `npx` 首次调用延迟（需下载包） | 低 | 低 | 仅在未全局安装时发生，且仅首次有延迟；已全局安装时无影响 |
| `${CLAUDE_PLUGIN_ROOT}` 在 `cwd` 中不被替换 | 极低 | 高 | `hooks.json` 已验证该变量在插件运行时可用；且 README 推荐此配置 |
| 修改破坏其他插件功能 | 无 | N/A | 变更仅限 `.mcp.json` 一个文件，不影响 hooks、skills、scripts |
| npm 包 `reverse-spec` 未发布导致 `npx` 找不到 | 低 | 高 | 包已发布到 npm（`package.json` 中 `name: "reverse-spec"`）；可通过 `npm view reverse-spec` 验证 |

**总体回归风险**: 极低。单文件配置修改，不涉及任何代码逻辑变更。

## 修复验证方案

### 验证步骤

1. **静态验证**: 确认 `.mcp.json` 文件内容符合预期格式
   ```bash
   cat plugins/reverse-spec/.mcp.json
   # 预期: command=npx, args=["reverse-spec","mcp-server"], cwd=${CLAUDE_PLUGIN_ROOT}
   ```

2. **JSON 格式验证**: 确认文件是合法 JSON
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('plugins/reverse-spec/.mcp.json','utf8')); console.log('JSON valid')"
   ```

3. **一致性验证**: 确认配置与 README 推荐一致
   - README 推荐: `{"command":"npx","args":["reverse-spec","mcp-server"],"cwd":"${CLAUDE_PLUGIN_ROOT}"}`
   - 修复后配置应完全匹配

4. **功能验证**（需 Claude Code 环境）: 重新加载插件，确认 MCP server 状态
   - 预期: `plugin:reverse-spec:reverse-spec` 状态从 `failed` 变为正常
   - 4 个 MCP 工具（`prepare`、`generate`、`batch`、`diff`）应可用

### 验证通过标准

- [ ] `.mcp.json` 内容正确，JSON 格式合法
- [ ] 不含任何硬编码绝对路径
- [ ] 使用 `${CLAUDE_PLUGIN_ROOT}` 变量（与 `hooks.json` 保持一致的模式）
- [ ] 与 README.md 中的推荐配置一致
- [ ] 构建通过（`npm run lint` 不受影响，因为这是 JSON 文件非 TypeScript）

## Complexity Tracking

| 决策 | 理由 | 否决的更简单方案 |
|------|------|-----------------|
| N/A | 本次修复采用最简方案 | N/A |

修复方案本身就是最简单的方案：单文件、单处变更、直接采用项目 README 已推荐的标准配置。无复杂度偏差。
