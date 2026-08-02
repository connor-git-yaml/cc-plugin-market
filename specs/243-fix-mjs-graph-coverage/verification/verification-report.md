---
feature: 243-fix-mjs-graph-coverage
phase: 4c-verify
generated_at: 2026-08-03T01:40:00+08:00
---

# 验证闭环报告（Phase 4c）

> **数字时效括注（2026-08-03 补）**：本报告正文的图节点/边数字采集于旧底座（`2e3a4cd`）。
> 本 fix 已 rebase 至 `264338b`（并行交付的 `242-fix-callsite-syntax-coverage`）并按同构对拍法重测，
> 旧数字不可复现、已作废。**最新数字见 `node-edge-totals.json`**（before 6102/9438 → after 7052/11792）。
> 正文保留原貌作为当时的验证现场记录，不逐行改写。结论（六指标全 pass、归因 100% 来自 `.mjs/.cjs`）在新底座复测后不变。

## 三命令结果表

| 命令 | 退出码 | 关键计数 | flaky 处置 |
|------|--------|----------|------------|
| `npx vitest run`（全量） | 0 | Test Files: 491 passed \| 4 skipped (495)；Tests: 6023 passed \| 18 skipped \| 21 todo (6062) | 无失败文件命中已知 flaky 清单（watch-command / batch-orchestrator-incremental / community-analysis / cli-e2e --version 均未触发，本轮全绿一次通过，未启用隔离重跑） |
| `npm run build` | 0 | prebuild（inline-d3 无变化跳过写入）→ tsc 零类型错误 → postbuild 盖章 `commit=2e3a4cdd (dirty)` | N/A |
| `npm run repo:check` | 0 | 全部检测项 `pass`（含 `graph-quality:duplicate-canonical-id/dangling-edge/contains-coverage/orphan-ratio/legacy-ignored-nodes/freshness` 六项、`worktree-local-state` 三项等约 90 条门禁全绿） | N/A |

**Vitest 抽样噪声说明**：全量输出中出现的 `✗ 错误: ...`、`[jury] claude-sonnet-4-6 FAILED: rate limit`、`mod ... failed` 等文本均为受测代码的**错误路径断言**（CLI 参数校验/降级/rate-limit 模拟等测试用例主动构造的失败场景，属预期输出），非真实测试失败；最终 `Test Files 491 passed | 4 skipped`、`EXIT:0` 为准。

## 验证证据核查

### T001 — `walkTsJsFiles` 白名单 + docstring

`src/batch/stages/source-discovery.ts` L516-517 endsWith 判定新增 `.mjs`/`.cjs` 两分支；L392 docstring「收集 .ts/.tsx/.js/.jsx/.mjs/.cjs 文件」、L480 docstring「递归扫描 .ts/.tsx/.js/.jsx/.mjs/.cjs 文件」均已同步更新，且 L484 起追加 F243 注释说明扩容原因。**确认落地**。

### T002 — `TSJS_COLLECTOR_EXTENSIONS` 镜像

`src/panoramic/graph/source-commit.ts` L36-38：`new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])`，字面量精确无拼写差异。**确认落地**。（4b quality-review 已记录 INFO：L35/L40 注释仍引用已迁移的 `batch-orchestrator.ts`，为 F220 遗留非本次引入，不阻断。）

### T003 — `ignore-oracle.ts` `TSJS_EXTENSIONS`

`src/panoramic/graph/quality/ignore-oracle.ts` L112-114：`new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])`，字面量精确无拼写差异。**确认落地**。

### T004 — `source-commit.test.ts` 断言更新

`git diff` 确认 `expected` 集合字面量由 `'.ts', '.tsx', '.js', '.jsx'` 扩为含 `.mjs', '.cjs'`，附 F243 注释。属「镜像面本身扩容」的一致性断言更新，非放宽断言强度。**确认落地**。

### T005 — 新建回归测试（含落点偏差）

实际落点为 `tests/batch/source-discovery.test.ts`（非计划中的 `src/batch/stages/source-discovery.test.ts`），tasks.md 已如实登记该偏差及理由（避免与 F220 stage 依赖矩阵守护冲突）。Read 全文确认 3 个 `it` 用例：(1) `.mjs`/`.cjs` 采集 + exports 非空、(2) `.mjs` 显式后缀 import 可解析为绝对路径、(3) `TSJS_SKELETON_IGNORE_DIRS` 命中目录（`dist`/`node_modules`/`.hidden`）内 `.mjs`/`.cjs` 仍被剪枝。三项断言均落地为真实可执行用例，非占位。**确认落地**。

### T006 — `ignore-oracle.test.ts` 新增用例

`git diff` 确认新增 3 个用例：`tmp/a.mjs → ignored`、`venv/a.mjs → 不 ignored`、`venv/a.cjs → 不 ignored`，均带 F243 说明注释，验证 `.mjs`/`.cjs` 路由到 TSJS 分支而非 union 兜底。**确认落地**（比 tasks.md 描述的 2 个用例多 1 个 `.cjs` 用例，属增值非缺失）。

### T007/T008 — 图重建与六指标对比

实读 `specs/_meta/graph.json`：节点 7048、边 9648，与 `docs/design/milestone-M9-codex-trusted-live-graph.md` §7.5.4 落账表完全一致（见下节锚定文件核对）。`after-graph-quality.json` 六指标：`duplicateCanonicalId` pass / `containsCoverage` 5849/5849=100% / `orphanRatio` offending 0、`allNodeZeroDegreeRatio` 1.46%（优于 before 2.18%）/ `danglingEdges` pass / `legacyAndIgnoredNodes` pass / `freshness.state = dirty`（预期内，因工作树含本次未提交改动，`overallVerdict` 仍 pass，本轮 `repo:check` 现场复核 `graph-quality:freshness` 亦为 pass）。**确认落地**。

### T009 — M9 §7.5.4 文档落账

`docs/design/milestone-M9-codex-trusted-live-graph.md` §7.5.4 条目标题已更新为「✅ 已修复（F243）」，正文含 F243 处置说明、before/after 对比表（节点/边、symbol 节点、contains 覆盖率、orphan/dangling/duplicate/legacy 六指标、全节点零度率）、归因方法说明、已知残留（`.mts`/`.cts`）、方法论教训。数字非占位符，与 T008 实测一致。**确认落地**。

## 锚定文件生成与核对（闭合 4a WARNING）

已生成 `specs/243-fix-mjs-graph-coverage/verification/node-edge-totals.json`：

| 口径 | 节点 | 边 | 来源 |
|------|------|-----|------|
| `original_baseline` | 6097 | 8065 | 编排器 before 采集 @2e3a4cd 未改动树（fix-report.md「已验证的前提」表「before 基线」行） |
| `reproduced_before` | 6098 | 8066 | implement 归因核对时还原三处源码重造（差值 +1/+1 为新增测试文件 `tests/batch/source-discovery.test.ts` 自身 module 节点 + contains 边，该文件未提交但存在于 worktree） |
| `after`（本次实读） | 7048 | 9648 | `node -e "require('./specs/_meta/graph.json')"` 直接读取磁盘文件 |
| `m9_doc_claim` | 7048 | 9648 | M9 文档落账表 after 列 |

`cross_check` 结论：`MATCH — 实读值与 M9 落账数字一致`。4a WARNING（总节点/边数缺归档锚定）**已闭合**。

## [Spec 合规] 汇总（引用 4a 结论）

4a `spec-review-report.md`：**PASS**，1 条 WARNING（总节点/边数缺归档锚定，已由本报告闭合）、1 条 INFO。FR 覆盖映射（plan.md 8 条变更清单）全部对应任务已完成，tasks.md T001-T010 全部 `[x]`，T011 `[~]`（未触发，`src.spec.md` 无需还原，`git status` 亦确认无该文件改动）。

## [代码质量] 汇总（引用 4b 结论）

4b `quality-review-report.md`：**EXCELLENT**，0 CRITICAL / 0 WARNING / 1 INFO（`source-commit.ts` L35/L40 注释仍指向已迁移的 `batch-orchestrator.ts`，为 F220 遗留，非本次改动引入，不阻断本次交付）。

## 最终判定

**PASS**

- 三命令逐条亲自重跑，退出码全 0，无回归、无 flaky 触发
- T001-T010 全部逐条抽验代码/文件实际存在且内容与声明一致，T005/T006 落点/数量偏差均已如实登记且不影响验证覆盖
- M9 §7.5.4 落账数字（7048/9648）与实读 `specs/_meta/graph.json` 完全一致
- 三处源码常量集合逐字核对，均为 `.mjs`/`.cjs` 精确扩容，无拼写差异
- 4a WARNING（节点/边总数归档锚定缺失）已由 `node-edge-totals.json` 闭合
- 4a/4b 既有结论（PASS / EXCELLENT）经本轮独立复核未发现新问题，予以采纳
