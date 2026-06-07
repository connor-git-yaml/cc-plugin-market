# 验证报告 — Feature 179

## 验证摘要

| 项目 | 状态 | 说明 |
|------|------|------|
| `npm run build` | ✅ PASS | TypeScript 零错误 |
| `npx vitest run` (第2轮) | ✅ PASS | 4111 passed, 0 failed |
| `npm run repo:check` | ✅ PASS | 49 项全通过 |
| Codex 对抗审查 | ✅ 无 CRITICAL | CRITICAL 均因读错 worktree（已核实为假报）|

## 7 处改动核查

| # | 文件 | 状态 |
|---|------|------|
| T01 | `src/batch/batch-orchestrator.ts:1565` → `normalizeGraphForWrite(graphJson, { stripTimestamps: true })` | ✅ |
| T02 | `tests/e2e/feature-175-batch-incremental.e2e.test.ts` 注释更新 | ✅ |
| T03 | `scripts/eval-task-runner.mjs:286` 补 `--full` | ✅ |
| T04 | `scripts/feature-170c-sc002-driver-eval.mjs:121` 补 `--full` | ✅ |
| T05 | `scripts/feature-170d-driver-preference.mjs:145` 补 `--full` | ✅ |
| T06 | `scripts/lib/driver-eval-core.mjs:17` `findFuzzyMatches` → `resolveSymbolFuzzy` | ✅ |
| T07 | `scripts/feature-170c-sc002-driver-eval.mjs:50` `findFuzzyMatches` → `resolveSymbolFuzzy` | ✅ |

## Codex 审查处理

| 等级 | 条目 | 处理 |
|------|------|------|
| CRITICAL | "核心补丁未落地" | 假报 — Codex 读取了错误的 worktree (`vigorous-heyrovsky-0339d8` vs `unruffled-rosalind-5150e5`)，实际改动已就位（grep 已确认）|
| WARNING | "3 处 eval 未补 --full" | 假报，同上 |
| WARNING | "eval prompt 未改" | 假报，同上 |
| WARNING | "readNormalizedGraph 掩盖 byte-stable" | **真实建议，已采纳** — 在场景10 (b) 前新增 `expect(graphRawAfterFull.graph?.generatedAt).toBe('1970-01-01T00:00:00.000Z')` 断言（F179 落盘护栏）|
| INFO | HTML 含 epoch | 接受 — UI 仅显示 nodeCount/edgeCount，epoch 在数据属性中无功能影响 |

## 测试失败说明

- 第1轮全量：2 failed（`eval-quota-store` + `watch-command`）— 均为已知 flaky
  - `eval-quota-store.test.ts PC-T1`：跨进程 fork 锁竞争，单独重跑即通过
  - `watch-command.test.ts`：chokidar/fsevents 在 sandboxed worktree 不稳定（项目级已知问题，见 memory）
- 第2轮全量：4111 passed, 0 failed ✅

## 验收标准达成

- [x] 同语义两次 full batch → graph.json 落盘 `graph.generatedAt` = `'1970-01-01T00:00:00.000Z'`（过-claim 闭合）
- [x] eval 3 处 code-only batch 补 `--full`
- [x] eval 2 处 `findFuzzyMatches` → `resolveSymbolFuzzy`
- [x] F175 E2E 场景10 新增落盘侧 epoch 断言（byte-stable 护栏）
- [x] 4111 vitest + build + repo:check 全绿
- [x] Codex 对抗审查唯一真实 WARNING 已采纳并修复
