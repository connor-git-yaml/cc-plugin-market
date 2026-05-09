---
feature: 158
title: SWE-Bench Lite Grounding Eval — tasks.md Codex round-4 修订附录
created: 2026-05-09
phase: tasks
status: hard-constraint
---

# Feature 158 — tasks.md Codex round-4 修订附录

> **本附录是 implement phase 的硬约束**：以下 6 critical + 6 warning + 5 info 必须在 implement 时按附录覆写 tasks.md 原描述。所有冲突以本附录为准。

---

## 已实测核实的事实（不要再 grep）

| 项 | 实测值（仓库当前状态） |
|----|---------------------|
| `scripts/lib/bootstrap-ci.mjs` 导出 API | **只有 `bootstrapPercentileCi(samples, opts)`**；返回 `{ low, high, b, samples, method }`（不是 `{ passRate, ci95Lower, ci95Upper }`） |
| `scripts/eval-task-runner.mjs` perf 字段（line 366-372）| `perf: { totalWallMs, ..., estimatedCostUsd: null }`（不是 `wallTimeMs / costUsd`） |
| `scripts/eval-task-runner.mjs` cost 字段（line 387）| `taskExecution: { ..., costUsd: null }`（cost 在 taskExecution 子对象，不在 perf） |
| `scripts/eval-task-fixture-check.mjs` line 32 | `TASK_FIXTURES_DIR = path.join(PROJECT_ROOT, 'specs/147-...')` 硬编码 |
| 单测路径 | `tests/unit/eval-task-runner.test.ts`（**`.ts` 不是 `.mjs`**） |
| `scripts/baseline-diff.mjs` minor version 处理 | minor diff 须 `--ignore-quality` flag，否则 exit 2 |
| `.gitignore` | 已含 `tests/baseline/tasks/`（不需新增） |

---

## CRITICAL 修订（6 项，必修）

### CR-1：T-012 修正 bootstrap API（覆写 T-012）

**原描述错误**：T-012 引用 `bootstrapCI` 函数，期望返回 `{ passRate, ci95Lower, ci95Upper, repeats: 3 }`。

**修订**：T-012 实际须：
- import `{ bootstrapPercentileCi }` from `scripts/lib/bootstrap-ci.mjs`
- 调用：`bootstrapPercentileCi(samples, { b: 1000, alpha: 0.05 })`
- 返回字段映射：`{ ci95Lower: result.low, ci95Upper: result.high, passRate: median(samples), repeats: samples.length }`
- 在 `eval-mcp-augmented.mjs` 中实现一个 `aggregateBootstrap(samples)` adapter 函数

**DoD 增量**：
- `grep -c "bootstrapPercentileCi" scripts/eval-mcp-augmented.mjs` > 0
- `grep -c "bootstrapCI" scripts/eval-mcp-augmented.mjs` == 0（确保不用错 API）
- vitest 单测：给定 18 sample [0,0,1,...]，aggregateBootstrap 返回 ci95Lower < ci95Upper 且都 ∈ [0, 1]

### CR-2：T-001 + T-003 fixture loader 路径扩展（覆写 T-001/T-003）

**原描述缺失**：T-001 只改 eval-task-runner.mjs，未提 eval-task-fixture-check.mjs；T-003 DoD 要求 `eval-task-fixture-check.mjs --task T158-micrograd-1` PASS，但当前脚本 TASK_FIXTURES_DIR 硬编码 specs/147，T158 fixture 不会被找到。

**修订**：T-001 增子项：
- (4) `scripts/eval-task-fixture-check.mjs` 修改 TASK_FIXTURES_DIR 为数组 `[specs/158-..., specs/147-...]`，按顺序查找
- (5) `scripts/eval-task-runner.mjs` 的 `loadTaskFixture(taskId)` 同步改为多目录查找

**DoD 增量**：
- `grep -c "158-swe-bench-lite-grounding-eval" scripts/eval-task-runner.mjs` > 0
- `grep -c "158-swe-bench-lite-grounding-eval" scripts/eval-task-fixture-check.mjs` > 0
- T-003 完成后 `node scripts/eval-task-fixture-check.mjs --task T158-micrograd-1` 不报 "fixture not found"

### CR-3：T-002 spike 命令具象 + spectra graph 物化路径锁定（覆写 T-002）

**原描述模糊**：T-002 写"spectra batch 复用 ~/.spectra-baselines/karpathy/micrograd"，但 spectra MCP server 的 graph lookup 实际从 `process.cwd()/specs/_meta/graph.json` 读，路径不闭合。

**修订**：T-002 spike 步骤具象化：

```bash
# step 1: 准备 wtDir（参考 prepareWorktree 的 ~/.spec-driver-bench-worktrees/spike-T2/）
WTDIR=$HOME/.spec-driver-bench-worktrees/spike-T2-mcp
mkdir -p "$WTDIR" && cd "$WTDIR"
rsync -a --exclude=node_modules ~/.spectra-baselines/micrograd/ "$WTDIR/"

# step 2: 在 wtDir 内运行 spectra batch（产物落 specs/_meta/）
cd "$WTDIR" && spectra batch --no-llm

# step 3: 验证 graph.json 物化路径
test -f "$WTDIR/specs/_meta/graph.json" || { echo "FAIL: graph not at expected path"; exit 1; }

# step 4: 写入 .mcp.json
cat > "$WTDIR/.mcp.json" <<EOF
{"mcpServers":{"spectra":{"command":"spectra","args":["mcp-server"]}}}
EOF

# step 5: 启动 claude --print + MCP
cd "$WTDIR"
claude --print --mcp-config "$WTDIR/.mcp.json" \
  --allowedTools "mcp__spectra__impact" \
  --output-format stream-json --include-partial-messages --verbose \
  --model sonnet \
  -p "Use mcp__spectra__impact with target='Value.relu' and report what tool returns" \
  > /tmp/spike-T2-output.json 2>&1

# step 6: 验证 PASS 条件
grep -c '"name":"mcp__spectra__impact"' /tmp/spike-T2-output.json   # ≥ 1 expected
grep -c '"is_error":true' /tmp/spike-T2-output.json                  # == 0 expected
grep -c '"permission_denial"' /tmp/spike-T2-output.json              # == 0 expected
```

**DoD 增量**：
- `test -f $WTDIR/specs/_meta/graph.json`
- 上述 step 6 三条 grep 都符合期望

### CR-4：T-002b fallback 任务（新增）

**理由**：plan §8 D-1 写"若 cwd graph lookup 失败，fixture prompt 显式传 projectRoot=$wtDir"，但 tasks.md 没对应任务。

**新增 T-002b**：
- 触发条件：T-002 step 6 验证失败（mcp__spectra__impact 没触发，可能是 graph 路径找不到）
- 改动：在 `eval-task-runner.mjs` 的 mcp-pull case 中，将 `wtDir` 写入 fixture prompt 末尾（"If using spectra MCP tools, set projectRoot=$wtDir"）
- DoD：T-002 step 6 重跑，三条 grep 全部符合期望

### CR-5：T-008/009/010 删除 SKIP 绕过路径（覆写）

**原描述漏洞**：T-008 DoD 写"18 个 full.json 存在（或 SC-007 SKIP 逻辑触发）"，让人误以为 fixture 不存在也能让 T-008 PASS。

**修订**：

- T-008/T-009/T-010 的 DoD：**强制要求 18 个 full.json 真实生成**，不接受 SKIP；任务未完成不能进入 T-012
- SC-007/SC-004 的 SKIP 语义仅适用于 verify 阶段在干净 repo 上跑（无 fixture），**不适用于 eval 阶段任务的 DoD**
- T-008/009/010 增加预算 pause：累计 costUsd 达 $35 主动 pause，等用户决断

### CR-6：perf/cost 字段名统一（覆写 T-001 + T-014）

**原描述错位**：tasks.md 多处提到 `perf.wallTimeMs`、`perf.costUsd`，但实测仓库现状是 `perf.totalWallMs` + `taskExecution.costUsd`。

**修订**：

- T-001 (3) 改为：`assembleTaskFixture` 在 `perf` 子对象内**新增** `mcpToolCallTrace` 和 `w3Flag` 字段（已有 totalWallMs / estimatedCostUsd 不动；保持向后兼容）；cost 字段读 `taskExecution.costUsd`（现有 backfill 脚本路径）
- T-014 SC-006 token ratio 计算路径：`perf.tokensInput + perf.tokensOutput`（现有 schema 1.1 字段）
- T-014 SC-007 cost 累加路径：**`taskExecution.costUsd`**（不是 `perf.costUsd`）
- T-014 SC-004 验收路径：`perf.mcpToolCallTrace` 数组 + `perf.w3Flag` boolean

### CR-7：T-015 真实 schema 1.1→1.2 兼容验证（覆写）

**原描述不充分**：T-015 只跑同 schema 内自比，不能证明 schema 1.1 旧 fixture vs schema 1.2 新 fixture 的兼容性。

**修订**：T-015 新增 synthetic 测试：
- 手工准备 schema 1.1 fixture（旧）：从现有 12 个 perf anchor 随便 cp 一个
- 手工准备 schema 1.2 fixture（新）：在旧版基础上加 `perf.mcpToolCallTrace: null` + `perf.w3Flag: null`
- 跑 `npm run baseline:diff -- old.json new.json --ignore-quality`，期望 exit 0（不是 exit 2）
- 若 exit 2 不接受 minor version diff，T-015 须修 baseline-diff.mjs 把 mcpToolCallTrace / w3Flag 加白名单

**DoD 增量**：
- `node scripts/baseline-diff.mjs <synthetic-1.1.json> <synthetic-1.2.json>` exit 0（或文档化为何 exit 2）

---

## WARNING 修订（6 项）

### WR-1：T-001 工作量改 M（覆写已应用：CR-2 已合并）

### WR-2：T-002 PASS 条件可执行（覆写已应用：CR-3 已合并具体 grep 命令）

### WR-3：T-003/T-004 fixture 难度校准 → 移到 T-008/009/010 实测

**原描述**：T-003 写"control 组预期 60-80% PASS"是设计意图，DoD 只验证 sanity ok。

**修订**：
- T-003/T-004 DoD 保持 sanity ok（设计阶段不实测难度）
- 在 T-008/T-009/T-010 完成后，T-011 增子项：检查 control cohort 18 runs 的 pass rate 是否覆盖 [20%, 80%] 区间（避免地板/天花板效应）；偏离则记入 §6 Limitation 子节

### WR-4：T-007 单测路径改 .ts（覆写）

**原描述错误**：T-007 写 `tests/unit/eval-task-runner.test.mjs`。

**修订**：所有单测路径改为 `tests/unit/eval-task-runner.test.ts`（仓库实际路径）。

**DoD 增量**：
- `npx vitest run tests/unit/eval-task-runner.test.ts` PASS
- `npx vitest run tests/unit/eval-task-fixture-check.test.ts` 现有测试不被破坏（schema 1.2 新字段可选）

### WR-5：T-013 §6 报告 DoD 加强

**原 DoD 弱**：只 grep 标题、表格行数、Limitation。

**修订 DoD**：
- §6 内必须包含具体 cohort 名（control、spec-driver-spectra、mcp-pull）作为表格行（grep 三个 cohort 名各 ≥ 1）
- §6 内必须有 ≥ 6 个百分比数字（match `\d+(\.\d+)?%`，覆盖 6 task pass rate）
- §6 内必须有 "95% CI" 字样（grep ≥ 1）
- §6 内必须有 "tokens" 字样（grep ≥ 1）
- §6 内必须有"W-3"或"trap"字样（grep ≥ 1，证明 trace 已分析）

### WR-6：T-014 拆 scaffold/full（覆写）

**原描述模糊**：T-014 既要 scaffold 又要 full，与 T-013 早期框架并行存在依赖冲突。

**修订**：拆为 T-014a + T-014b：
- T-014a：verify-feature-158.mjs scaffold（SC-001/002/003 三条已有 fixture/脚本可立即验，不依赖 T-008-T-013；可与 T-006 并行）
- T-014b：full verify（SC-004/005/006/007/008，依赖 T-008-T-013 完成）

---

## INFO（5 项，仅说明）

| INFO | 说明 |
|------|------|
| `.gitignore` 已含 `tests/baseline/tasks/`，无需新建 task；T-016 增子项 `git check-ignore tests/baseline/tasks/T158-1/control/full.json` 作保险 |
| T-005 / T-010 cohort 命名一致（map → mcp-pull/full.json），无需修订 |
| `npm run baseline:diff` / `repo:check` / `build` 已存在，T-016 命令直接可用 |
| T-008/T-009/T-010 拆分按 cohort 是合理调度，不强制合并 |
| T-010 / T-011 W-3 阈值 "3 runs 中 ≥ 2 runs w3Flag=true → 暂停" 描述精确，无需修订 |

---

## 任务清单合并后的最终编号（implement 阶段使用）

| 编号 | 任务 | 修订状态 |
|------|------|---------|
| T-001 | eval-task-runner.mjs + fixture loader 扩展（CR-2） | 工作量 M |
| T-002 | spectra MCP smoke spike（CR-3 具体步骤）| - |
| T-002b | fallback：fixture prompt 显式传 projectRoot（CR-4）| **新增** |
| T-003 | T158-micrograd-1 fixture | - |
| T-004a~e | 5 个并行 fixture | - |
| T-005 | eval-mcp-augmented.mjs 入口 | - |
| T-006 | parseMcpToolCallTrace 函数 | - |
| T-007 | 单测（**.ts** 路径，WR-4）| - |
| T-008 | control cohort 18 runs（**强制真实生成**，CR-5）| - |
| T-009 | spec-driver-spectra cohort 18 runs（**强制**，CR-5）| - |
| T-010 | mcp-pull cohort 18 runs（**强制**，CR-5）| - |
| T-011 | W-3 trap 调试 + 难度校准（WR-3）| - |
| T-012 | bootstrap CI 聚合（**bootstrapPercentileCi**，CR-1）| - |
| T-013 | §6 报告（**加强 DoD**，WR-5）| - |
| T-014a | verify-feature-158.mjs scaffold（WR-6）| **拆分** |
| T-014b | verify-feature-158.mjs full（WR-6）| **拆分** |
| T-015 | baseline-diff 兼容性（**synthetic 测试**，CR-7）| - |
| T-016 | 全量验收（含 codex review，依 plan §1 提及）| - |

总任务数：**18 个**（原 16 + T-002b + T-014a/b 拆分）
