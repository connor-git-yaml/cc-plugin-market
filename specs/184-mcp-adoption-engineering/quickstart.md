# Quickstart: F184 MCP 触发率工程

本文档面向**接手实现的开发者**，快速理解 F184 的改动范围和实施要点。

## 三分钟速览

F184 做 4 件事，全部是 MCP 层局部改动，无新模块、无数据迁移：

| 改动 | 文件 | 性质 | 优先级 |
|------|------|------|--------|
| view_file 接入 fuzzy symbol resolve | `src/mcp/file-nav-tools.ts` | 逻辑修改 | P1 MUST |
| MCP server instructions 注入 | `src/mcp/server.ts` | 构造参数扩充 | P1 MUST |
| server 5 工具 description 补齐 | `src/mcp/server.ts` | 纯字符串 | P1 MUST |
| graph 6 工具 description 补 Use when | `src/mcp/graph-tools.ts` | 纯字符串 | P2 SHOULD |

## 最重要的一个注意事项

**FR-002 instructions 必须放第二个参数**：

```typescript
// 错误（不生效）：
new McpServer({ name: 'spectra', version: '...', instructions: '...' })

// 正确（SDK 1.26.0 已核实）：
new McpServer(
  { name: 'spectra', version: '...' },
  { instructions: '...' }
)
```

## view_file fuzzy 实施要点

1. 在 `src/mcp/file-nav-tools.ts` 的 import 行追加 `resolveSymbolFuzzy`
2. 在 `resolveSymbolRange` 的 `canon.reason === 'not-found'` 分支接入 fuzzy（约 15 行）
3. 精确范本在 `agent-context-tools.ts:173-185`，逻辑完全相同，只是返回形式不同
4. `autoResolveThreshold` 使用默认 0.9，不传 opts（EC-008 约束）
5. fuzzy 成功后需用 resolved id 重新调 `findNode` 拿 lineRange（不能用 `canonicalizeSymbolId` 的结果）
6. `resolveSymbolRange` 返回类型需新增 `fuzzyResolved?: boolean`
7. `handleViewFile` 中检测 `sym.fuzzyResolved === true` 时 push `'fuzzy-resolved'` 到 warnings

## FR-008 deferred 说明

graph_node fuzzy（FR-008）在本 feature 中**不实现**（路径 B，deferred）。理由见 `plan.md` 的"FR-008 路径决议"章节。tasks.md 中会有一个明确的 deferred 记录条目。

## 验收门槛

实现完成后按序跑：
```bash
npx vitest run                  # 4250+ 全通过
npm run build                   # 零 TypeScript 错误
npm run repo:check              # 57 项全绿
# 然后运行 E2E（需要 baseline graph 就绪）：
# npx vitest run tests/e2e/feature-184-view-file-fuzzy.e2e.test.ts
```
