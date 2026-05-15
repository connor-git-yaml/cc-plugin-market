# 修复规划 — Feature 164: C cohort mcpToolCallCount=0

## 根因

`buildGroupCPrompt` 指令不足：首个强制工具为 `mcp__spectra__context`（需要 symbolId，
prompt 未提供），导致 Claude 跳过工具调用。

## 修复范围

**最小化变更**：只修改 `scripts/eval-mcp-augmented.mjs` 的 `buildGroupCPrompt` 函数。

## 修复方案

改用 `mcp__spectra__detect_changes`（只需 `baseRef`，无需 symbolId）为首个强制调用：
1. 步骤 1：强制调用 `detect_changes`，`baseRef: "HEAD~1"`
2. 步骤 2：若步骤 1 有 changedSymbols，对第一个调 `context`
3. 步骤 3：完成 bug 修复

允许 `graph-not-built` 错误：即使工具失败，telemetry 仍记录调用。

## 回归风险

低：只改 C cohort prompt 文本，A/B cohort 不受影响；现有测试（eval-mcp-augmented-classic）
测的是不同文件。

## 验证方案

1. 编写单元测试：验证新 prompt 包含 `detect_changes` 指令
2. `npx vitest run` 零失败
3. `npm run build` 零错误
4. 重跑 C cohort 9 runs：`mcpToolCallCount > 0 ≥ 5/9`

## 不在范围

- Pre-build spectra graph for Python repos（T053 范围）
- 修改 A/B cohort 逻辑
- 修改 MCP server 实现
