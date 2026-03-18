# Tasks: 023-fix-mcp-hardcoded-path

**Input**: `specs/023-fix-mcp-hardcoded-path/fix-report.md`, `specs/023-fix-mcp-hardcoded-path/plan.md`
**模式**: fix（快速问题修复）
**总任务数**: 3
**受影响文件**: 1（`plugins/reverse-spec/.mcp.json`）

## Format: `[ID] Description`

- 本次为单文件配置修复，无 User Story 分组，无并行标记
- 任务按执行顺序排列

---

## Phase 1: 修复实施

**Purpose**: 修复 `.mcp.json` 中硬编码的绝对路径

- [x] T001 将 `plugins/reverse-spec/.mcp.json` 中的 MCP server 配置从 `"command": "node"` + 硬编码绝对路径替换为 `"command": "npx"` + `"args": ["reverse-spec", "mcp-server"]` + `"cwd": "${CLAUDE_PLUGIN_ROOT}"`

**变更详情**:

当前内容（错误）:
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

修复后内容:
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

---

## Phase 2: 验证

**Purpose**: 确认修复正确且无回归

- [x] T002 验证 `plugins/reverse-spec/.mcp.json` 是合法 JSON 且内容符合预期：`command` 为 `"npx"`，`args` 为 `["reverse-spec", "mcp-server"]`，`cwd` 为 `"${CLAUDE_PLUGIN_ROOT}"`，不含任何硬编码绝对路径
- [x] T003 验证修复后配置与 `plugins/reverse-spec/README.md` 中推荐的 MCP 配置一致，且与 `plugins/reverse-spec/hooks/hooks.json` 使用 `${CLAUDE_PLUGIN_ROOT}` 的模式保持一致

---

## 修复需求覆盖映射

| 修复需求 | Task ID | 说明 |
|----------|---------|------|
| 移除硬编码绝对路径 | T001 | 删除 `/Users/connorlu/...` 路径 |
| 改用 npx 启动方式 | T001 | `command: "npx"`, `args: ["reverse-spec", "mcp-server"]` |
| 添加 `${CLAUDE_PLUGIN_ROOT}` 作为 cwd | T001 | 确保跨机器可移植 |
| JSON 格式合法性 | T002 | 静态验证 |
| 与 README 推荐配置一致 | T003 | 一致性验证 |
| 与 hooks.json 变量使用模式一致 | T003 | 模式一致性验证 |

**覆盖率**: 100%（fix-report.md 和 plan.md 中所有修复要求均已覆盖）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (修复实施)**: 无前置依赖，立即执行
- **Phase 2 (验证)**: 依赖 Phase 1 完成

### Execution Strategy

本次修复为最简单级别：单文件、单处变更。建议直接顺序执行 T001 -> T002 -> T003，预计总耗时 < 2 分钟。

---

## Notes

- 本次修复不涉及任何代码逻辑变更，仅修改 JSON 配置文件
- `npm run lint` 不受影响（lint 仅检查 TypeScript 文件）
- 功能验证（MCP server 状态从 `failed` 变为正常）需在 Claude Code 环境中手动确认
