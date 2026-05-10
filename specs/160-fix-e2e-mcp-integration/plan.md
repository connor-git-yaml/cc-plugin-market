# 修复规划 — Feature 160: E2E MCP 集成 Smoke 测试

## 修复方向

基于 fix-report.md 推荐方案 A：补齐 Smoke A/C/E 自动化测试，Smoke B/D 写手动验证清单。

## 最小化变更清单

| 变更 | 文件 | 类型 |
|------|------|------|
| 新增 Smoke A：MCP stdio 子进程 E2E | `tests/integration/mcp-server-stdio.test.ts` | 新增 |
| 新增 Smoke C：cohort dry-run 结构验证 | `tests/unit/eval-mcp-classic-cohort.test.ts` | 新增 |
| 新增 Smoke E：parseMcpToolCallTrace 真实格式 | `tests/unit/eval-mcp-parse-trace.test.ts` | 新增 |
| 新增手动 Smoke B/D 验证清单 | `specs/160-fix-e2e-mcp-integration/verification/smoke-b-d-checklist.md` | 新增 |
| Feature 158 smoke 验证补记 | `specs/158-swe-bench-lite-grounding-eval/verification/stage7b-infra-smoke.md` | 新增 |

**不修改任何现有源文件**（bugs 是测试缺口，不是逻辑错误）。

## 各测试文件设计

### Smoke A — `tests/integration/mcp-server-stdio.test.ts`

```
前置条件：
  - dist/cli/index.js 存在（npm run build 后）
  - micrograd baseline graph.json 存在（~/.spectra-baselines/micrograd-output/.../_meta/graph.json）
  - 任一条件不满足 → describe.skip（CI 友好）

测试流程：
  1. 用 @modelcontextprotocol/sdk Client + StdioClientTransport spawn dist/cli/index.js mcp-server
  2. 调用 tools/list，验证返回 9 个 tool（prepare/generate/batch/diff/panoramic-query/graph_*/impact/context/detect_changes）
  3. 向 temp dir 复制 micrograd graph.json
  4. 调用 impact(target=<abs-Value-relu>, depth=2)，验证 affected 数组非空
  5. 调用 context(symbol=<abs-MLP>)，验证返回 definition/callers/callees 字段
  6. 调用 detect_changes(diff=<小型 diff>)，验证返回 changedSymbols 数组
  7. 关闭 transport

超时：30s（子进程启动 + 3 次 tool 调用）
```

### Smoke C — `tests/unit/eval-mcp-classic-cohort.test.ts`

```
测试 buildClaudeArgs（不 spawn claude）：
  - control cohort → args 不含 --mcp-config / --output-format stream-json
  - spec-driver-spectra cohort → args 含 --output-format text，不含 --mcp-config
  - mcp-pull cohort → args 含 --output-format stream-json / --mcp-config <wtDir>/.mcp.json /
                       --allowedTools 含 mcp__spectra__impact
  - mcp-pull cohort 无 wtDir → 抛 Error

测试 writeMcpConfig（不 spawn claude，需 dist/cli/index.js 存在）：
  - 写入临时目录的 .mcp.json
  - 验证 JSON 结构含 mcpServers.spectra.command = 'node'
  - 验证 args[0] = dist/cli/index.js 绝对路径（文件真实存在）
  - dist/cli/index.js 不存在时 → 抛 Error
```

### Smoke E — `tests/unit/eval-mcp-parse-trace.test.ts`

```
parseMcpToolCallTrace 8 个测试：
  1. 空字符串 → trace=[], w3Flag=true
  2. 无 mcp__spectra__ tool_use → trace=[], w3Flag=true
  3. 单次 impact 调用（真实格式含 id/ts/timestamp）→ trace 含 1 entry, callCount=1
  4. 同一工具多次调用 → callCount 正确累加
  5. 多工具混合调用 → 各 toolName 独立 entry
  6. tool_use + tool_result 配对 → totalDurationMs 计算（非 null）
  7. expectedSpectraToolCalls=[] + 有调用 → w3Flag=false（无 expectation 不算 trap）
  8. expectedSpectraToolCalls=['context'] 但只调了 impact → w3Flag=true

parseStreamJsonUsage 4 个测试：
  9. 空输入 → 全 null
  10. 末尾含 {"type":"result","modelUsage":{"claude-sonnet-4-6":{...}}} → 正确提取
  11. modelUsage 多 model key → 正确累加
  12. costUSD=0 → costUsd=null（非正数不填）
```

## 回归风险评估

- 新增测试文件不修改任何现有代码，回归风险极低
- Smoke A 在无 baseline / 无 dist 时 skip，不影响 CI 正常运行
- Smoke C 中 `writeMcpConfig` 需要 dist/cli/index.js 存在；CI 中若不 build 则 skip 该测试

## 验证方案

```bash
npx vitest run tests/integration/mcp-server-stdio.test.ts
npx vitest run tests/unit/eval-mcp-classic-cohort.test.ts
npx vitest run tests/unit/eval-mcp-parse-trace.test.ts
npx vitest run  # 全套 ≥ 3518 + 新增 ≥ 12 tests pass
npm run build && npm run repo:check && npm run release:check
```
