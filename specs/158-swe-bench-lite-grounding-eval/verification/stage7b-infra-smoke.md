# Feature 158 Stage 7b — 基础设施 Smoke 验证

> **目的**：确认 Stage 7b（≥45 runs eval，~$15-30 LLM 成本）启动前，关键 E2E 链路已通过验证。

---

## 前置条件（Stage 7b 启动 Gate）

| 条件 | 状态 | 验证方式 |
|------|------|----------|
| `npm run build` 成功，`dist/cli/index.js` 存在 | ✅ 已验证（Feature 160 Phase 3） | `ls dist/cli/index.js` |
| `npx vitest run` ≥ 3518 tests pass（含新增 Smoke C/E） | ⏳ 待 Stage 7b 启动前确认 | `npx vitest run` |
| Smoke A（MCP stdio E2E）: CI 自动通过 或 skip（无 baseline） | ⏳ 待确认 | `npx vitest run tests/integration/mcp-server-stdio.test.ts` |
| Smoke B（Claude + MCP）: 手动验证 1 run ~$0.5 | ⏳ 待手动执行 | 见 Feature 160 smoke-b-d-checklist.md |
| micrograd baseline 已 clone 且 graph.json 存在 | ⏳ 待确认 | `ls ~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json` |

---

## Smoke 测试分布

| Smoke | 文件 | 类型 | LLM 成本 |
|-------|------|------|----------|
| A: MCP stdio 子进程 E2E | `tests/integration/mcp-server-stdio.test.ts` | 自动（CI 中） | $0（需 build + baseline）|
| B: Claude Code + MCP | `specs/160-.../smoke-b-d-checklist.md` | 手动 | ~$0.5 |
| C: Cohort dry-run 结构 | `tests/unit/eval-mcp-classic-cohort.test.ts` | 自动（CI 中） | $0 |
| D: spec-driver + MCP | `specs/160-.../smoke-b-d-checklist.md` | 手动 | ~$0.5-1 |
| E: parseMcpToolCallTrace | `tests/unit/eval-mcp-parse-trace.test.ts` | 自动（CI 中） | $0 |

---

## 已知 Stage 7b 风险（修复前已存在）

1. **`dist/cli/index.js` 缺失**: `writeMcpConfig()` 在 mcp-pull cohort 启动时立即抛错 → Feature 160 Phase 3 已通过 `npm run build` 修复
2. **parseMcpToolCallTrace 真实格式**: 仅合成数据测试 → Feature 160 Smoke E 补充了 12 个真实格式单测
3. **cohort 参数结构从未验证**: Feature 160 Smoke C 补充了 buildClaudeArgs/writeMcpConfig 结构验证

---

## Stage 7b 启动建议

1. 先跑 `npm run build && npx vitest run` 确认全 pass
2. 执行 Smoke B 手动验证（~$0.5，~5 min）
3. 如果 Smoke B 通过 → 可以启动 Stage 7b（`--group C --task SWE-L001 --repeat 1 --dry-run` 先 dry-run）
4. 如果 Smoke B 失败 → 修复 `scripts/eval-task-runner.mjs` 的 claude args 构造后再跑
