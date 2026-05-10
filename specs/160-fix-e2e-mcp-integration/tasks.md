# 修复任务清单 — Feature 160

## T1: Smoke A — MCP server stdio 子进程 E2E 测试

**文件**: `tests/integration/mcp-server-stdio.test.ts`  
**依赖**: dist/cli/index.js（npm run build 后）; micrograd baseline（可选，无则 skip）

- [ ] 用 `@modelcontextprotocol/sdk/client/stdio.js` 的 `Client + StdioClientTransport` spawn dist/cli mcp-server
- [ ] 调 `tools/list`，验证返回 ≥ 9 个 tool（含 impact/context/detect_changes）
- [ ] 调 `impact` tool（target=<abs Value.relu>, depth=2），验证 `affected` 数组 + `effectiveDirection`
- [ ] 调 `context` tool（symbol=<abs MLP>），验证 `definition`/`callers`/`callees` 字段
- [ ] 调 `detect_changes` tool（小型 diff），验证 `changedSymbols` 数组
- [ ] 无 dist/cli/index.js 或 无 micrograd baseline → `describe.skip`（CI 友好）
- [ ] 测试超时 30s，关闭 transport

## T2: Smoke C — cohort dry-run 结构验证

**文件**: `tests/unit/eval-mcp-classic-cohort.test.ts`  
**依赖**: `eval-task-runner.mjs` 的 `buildClaudeArgs` / `writeMcpConfig` 导出

- [ ] control cohort `buildClaudeArgs` → 不含 `--mcp-config` / `stream-json`
- [ ] spec-driver-spectra cohort → `--output-format text`，不含 `--mcp-config`
- [ ] mcp-pull cohort → `--output-format stream-json` + `--mcp-config <wtDir>/.mcp.json`
- [ ] mcp-pull cohort + `--allowedTools` 含 `mcp__spectra__impact`
- [ ] mcp-pull 无 wtDir → 抛 `Error` 含 "wtDir"
- [ ] `writeMcpConfig` 写入 temp dir → JSON 含 `mcpServers.spectra.command = 'node'`
- [ ] `writeMcpConfig` → `args[0]` 指向真实存在的 `dist/cli/index.js`
- [ ] 无 `dist/cli/index.js` → `writeMcpConfig` 抛 `Error`

## T3: Smoke E — parseMcpToolCallTrace 真实格式 unit tests

**文件**: `tests/unit/eval-mcp-parse-trace.test.ts`  
**依赖**: `eval-task-runner.mjs` 的 `parseMcpToolCallTrace` / `parseStreamJsonUsage` 导出

### parseMcpToolCallTrace (8 tests)
- [ ] 空字符串 → `trace=[], w3Flag=true`
- [ ] 无 `mcp__spectra__` tool_use 的 stream-json → `trace=[], w3Flag=true`
- [ ] 单次 impact（真实格式含 `id/type/timestamp`）→ 1 entry, `callCount=1`
- [ ] 同一工具多次调用 → `callCount` 正确累加
- [ ] 多工具混合 → 各 `toolName` 独立 entry
- [ ] `tool_use + tool_result` 配对含 `tool_use_id` → `totalDurationMs` 非 null
- [ ] `expectedSpectraToolCalls=[]` + 有调用 → `w3Flag=false`
- [ ] `expectedSpectraToolCalls=['context']` 但只调了 impact → `w3Flag=true`

### parseStreamJsonUsage (4 tests)
- [ ] 空字符串 → 全字段 null
- [ ] 末尾含 `{"type":"result","modelUsage":{"claude-sonnet-4-6":{costUSD:0.05,...}}}` → 正确提取
- [ ] `modelUsage` 多 model key → 正确累加
- [ ] `costUSD=0` 或全 0 → `costUsd=null`（非正数不填）

## T4: 手动验证清单

**文件**: `specs/160-fix-e2e-mcp-integration/verification/smoke-b-d-checklist.md`

- [ ] 写 Smoke B 手动步骤（需 LLM：claude + MCP 子进程 1 fixture 单 run）
- [ ] 写 Smoke D 手动步骤（需 LLM：spec-driver-fix + MCP 结合验证）

## T5: Feature 158 infra smoke 补记

**文件**: `specs/158-swe-bench-lite-grounding-eval/verification/stage7b-infra-smoke.md`

- [ ] 记录 Smoke A/C/E 自动化测试状态
- [ ] 记录 Smoke B/D 手动验证状态（待执行）
- [ ] 声明 Stage 7b 启动前置条件

## 验证步骤

```bash
# 1. 跑新增测试
npx vitest run tests/unit/eval-mcp-classic-cohort.test.ts
npx vitest run tests/unit/eval-mcp-parse-trace.test.ts
npx vitest run tests/integration/mcp-server-stdio.test.ts

# 2. 全套回归
npx vitest run   # ≥ 3518 + 新增 ≥ 12 pass

# 3. 构建验证
npm run build && npm run repo:check && npm run release:check
```
