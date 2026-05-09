---
feature: 158
title: SWE-Bench Lite Grounding Eval — 任务清单
branch: claude/focused-sutherland-5ccdfb
created: 2026-05-09
status: Draft
phase: tasks
---

# Feature 158 — 任务清单

> **⚠️ implement 阶段必读硬约束**：本 tasks.md 经 Codex round-4 审查，6 critical + 6 warning + 5 info 全部记录在 [`tasks-codex-revisions.md`](tasks-codex-revisions.md)。**所有冲突以附录为准**（涉及 bootstrap API / fixture loader 路径 / spectra graph 物化 / SKIP 语义 / perf 字段名 / schema 1.1→1.2 兼容验证 / 单测 .ts 路径等）。

**输入制品**：`specs/158-swe-bench-lite-grounding-eval/spec.md` + `plan.md` + `tasks-codex-revisions.md`  
**关键串行路径（已修订 Codex round-4 C-4）**：T-001 → T-002 → T-003 → T-005 → T-006 → T-007 → T-008 → T-009 → T-010 → T-011 → T-012 → T-013/T-014 → T-015 → T-016  
**总任务数**：17 个（新增 T-002b fallback；详见各 Phase）  
**可并行段**：T-004a~e（5 个 fixture）、T-006 与 T-007 早期框架、T-013 框架与 T-014 scaffold  
**实现策略**：MVP First — Phase A 先通 T-002 spike 硬前置（PASS 后 T-008-T-010 才能跑），再并行 fixture 设计

---

## Phase A — Fixture & Harness（Week 1，Day 1-7）

**目标**：建立最小可跑单元（1 task × mcp-pull 联通），为 Phase B 全量评估打基础  
**阻塞前置**：T-002（spectra MCP 连通性 spike）PASS 后方可进入 T-008

---

### T-001 — eval-task-runner.mjs 新增 mcp-pull stub + buildClaudeArgs wtDir 参数

**对应 plan**：plan §3 T1  
**关联**：FR-002、SC-003  
**工作量**：S（< 0.5d）  
**Codex risk hint**：涉及 buildClaudeArgs 接口签名变更，须核实所有调用方已透传 wtDir

**改动文件**：

| 文件 | 操作 | 关键修改 |
|------|------|---------|
| `scripts/eval-task-runner.mjs` | modify | (1) `SUPPORTED_TOOLS` 数组追加 `'mcp-pull'`；(2) `buildClaudeArgs` 签名改为 `({ tool, prompt, wtDir, bypassPermissions })`；(3) mcp-pull case 注入 `--mcp-config ${wtDir}/.mcp.json` / `--allowedTools mcp__spectra__impact,mcp__spectra__context,mcp__spectra__detect_changes,Read,Grep,Glob,Bash` / `--output-format stream-json --include-partial-messages` / `--model sonnet`；(4) 补充 mcp-pull 的 stub（不实际触发 LLM） |

**Definition of Done**：
- `grep -c "mcp-pull" scripts/eval-task-runner.mjs` > 0
- `grep -c "mcp-config" scripts/eval-task-runner.mjs` > 0
- `grep -c "wtDir" scripts/eval-task-runner.mjs` > 0（函数签名含参数）
- `npx vitest run` 中 `SUPPORTED_TOOLS.includes('mcp-pull')` 断言通过（见 T-007）

**依赖**：无（可立即开始）

---

### T-002 — spectra MCP 连通性 smoke spike（T-008/T-009 硬前置）

**对应 plan**：plan §3 T2  
**关联**：FR-002、SC-004、W-07 缓解  
**工作量**：M（0.5-1d）  
**Codex risk hint**：T2 FAIL 意味着 FR-002 技术路径失效，须重新审查 plan §8 D-1 决策

**改动文件**：

| 文件 | 操作 | 关键修改 |
|------|------|---------|
| `specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/.mcp.json.template` | new | `{"mcpServers":{"spectra":{"command":"spectra","args":["mcp-server"]}}}` 模板；cwd 通过 spawn parent 继承；W-07 cwd fallback 验证在此 spike 中确认 |

**spike 执行步骤**（手动，不入 vitest）：

```bash
# step 1: rsync micrograd 源码到临时 worktree
# step 2: spectra batch（micrograd）生成 graph.json（复用 ~/.spectra-baselines/karpathy/micrograd）
# step 3: 写入 ~/.spec-driver-bench-worktrees/spike-T2/.mcp.json
# step 4: spawn claude --print --mcp-config --allowedTools mcp__spectra__impact
#         --output-format stream-json --include-partial-messages
#         -p "Use mcp__spectra__impact with target='Value.relu' and report"
```

**Definition of Done**（二选一）：
- PASS：stream-json stdout 含 `tool_use` block，name = `mcp__spectra__impact`，`result.is_error == false`，无 `permission_denial`
- FAIL：记录失败原因，暂停 plan，review FR-002（不可静默绕过）

**依赖**：T-001（mcp-pull stub 存在，buildClaudeArgs 可生成正确参数）

---

### T-003 — T158-micrograd-1 fixture（最简 baseline task）

**对应 plan**：plan §3 T3、§2 新建文件  
**关联**：FR-001、SC-001、US-3  
**工作量**：S（< 0.5d）

**改动文件**：

| 文件 | 操作 | 关键意图 |
|------|------|---------|
| `specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/T158-micrograd-1.json` | new | 单函数补全 task；control 组预期 60-80% PASS；`primaryOracle.checks.length >= 2`（W-6 AND 语义）；`expectedSpectraToolCalls: ["impact"]` |

**fixture 结构要求**：

```jsonc
{
  "taskId": "T158-micrograd-1",
  "target": "karpathy/micrograd",
  "startCommit": "<sha>",
  "prompt": "...",
  "setupCommands": ["..."],
  "primaryOracle": {
    "kind": "functional",
    "checks": [
      { "cmd": "pytest test_engine.py::...", "mustPass": true, "timeoutMs": 10000 },
      { "cmd": "pytest test_engine.py::...", "mustPass": true, "timeoutMs": 10000 }
    ]
  },
  "expectedSpectraToolCalls": ["impact"]
}
```

**Definition of Done**：
- `node scripts/eval-task-fixture-check.mjs --task T158-micrograd-1` 输出 `sanity: ok`
- `jq '.primaryOracle.checks | length' ...T158-micrograd-1.json` >= 2
- `jq '.expectedSpectraToolCalls' ...T158-micrograd-1.json` 非 null 数组

**依赖**：T-001（eval-task-runner.mjs mcp-pull 可 run，验证接通 T-002 spike 路径）

---

### T-004a — [P] T158-micrograd-2 fixture（caller graph 跨函数依赖）

**对应 plan**：plan §3 T4a、§2 新建文件  
**关联**：FR-001、SC-001、US-3  
**工作量**：S  

**改动文件**：`specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/T158-micrograd-2.json`（new）

**内容要求**：caller graph 跨函数依赖场景；`expectedSpectraToolCalls: ["impact", "context"]`；control 组预期 30-50% PASS；`checks.length >= 2`

**Definition of Done**：`eval-task-fixture-check.mjs --task T158-micrograd-2` 输出 `sanity: ok`；`checks.length >= 2`

**依赖**：T-003 完成后并行（五个 fixture 互不依赖）

---

### T-004b — [P] T158-micrograd-3 fixture（bug fix + detect_changes）

**对应 plan**：plan §3 T4b、§2 新建文件  
**关联**：FR-001、SC-001、US-3  
**工作量**：S  

**改动文件**：`specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/T158-micrograd-3.json`（new）

**内容要求**：含 caller graph 传播链的 bug fix；`expectedSpectraToolCalls: ["detect_changes", "context"]`；`checks.length >= 2`

**Definition of Done**：`eval-task-fixture-check.mjs --task T158-micrograd-3` 输出 `sanity: ok`；`checks.length >= 2`

**依赖**：T-003 完成后（可与 T-004a/c/d/e 并行）

---

### T-004c — [P] T158-micrograd-4 fixture（中等难度 refactor）

**对应 plan**：plan §3 T4c、§2 新建文件  
**关联**：FR-001、SC-001、US-3  
**工作量**：S  

**改动文件**：`specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/T158-micrograd-4.json`（new）

**内容要求**：refactor task；control 组预期 40-60% PASS；`expectedSpectraToolCalls: ["context"]`；`checks.length >= 2`

**Definition of Done**：`eval-task-fixture-check.mjs --task T158-micrograd-4` 输出 `sanity: ok`；`checks.length >= 2`

**依赖**：T-003 完成后（可与 T-004a/b/d/e 并行）

---

### T-004d — [P] T158-nanoGPT-5 fixture（nanoGPT target）

**对应 plan**：plan §3 T4d、§2 新建文件  
**关联**：FR-001、SC-001、US-3  
**工作量**：S  

**改动文件**：`specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/T158-nanoGPT-5.json`（new）

**内容要求**：nanoGPT target（扩大 target 多样性）；`expectedSpectraToolCalls: ["context"]`；中等难度；`checks.length >= 2`

**Definition of Done**：`eval-task-fixture-check.mjs --task T158-nanoGPT-5` 输出 `sanity: ok`；`checks.length >= 2`

**依赖**：T-003 完成后（可与 T-004a/b/c/e 并行）

---

### T-004e — [P] T158-micrograd-6 fixture（高难度锚点）

**对应 plan**：plan §3 T4e、§2 新建文件  
**关联**：FR-001、SC-001、US-3  
**工作量**：S  

**改动文件**：`specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/T158-micrograd-6.json`（new）

**内容要求**：控制 control 组预期 20-40% PASS（防地板效应）；`checks.length >= 2`

**Definition of Done**：`eval-task-fixture-check.mjs --task T158-micrograd-6` 输出 `sanity: ok`；`checks.length >= 2`

**依赖**：T-003 完成后（可与 T-004a/b/c/d 并行）

---

### T-005 — eval-mcp-augmented.mjs 入口脚本

**对应 plan**：plan §3 T5、§2 新建文件  
**关联**：FR-003、SC-002、US-1  
**工作量**：M（0.5-1d）  
**Codex risk hint**：resume 逻辑（fixture 存在则 skip）须与 --force flag 精确联动，避免重复跑产生计费

**改动文件**：

| 文件 | 操作 | 关键意图 |
|------|------|---------|
| `scripts/eval-mcp-augmented.mjs` | new | ~150 行；3 对照组调度入口；参数：`--task <T158-X>` / `--cohort <control|spectra-push|spectra-mcp-pull|all>` / `--repeats <N>` / `--dry-run` / `--concurrency <1|2>` / `--force`；fixture 输出文件已存在则 skip（resume 策略）；`--dry-run` 不实际调 LLM |

**cohort → tool name 映射**（必须用 canonical 名）：

| cohort 参数 | runner tool name | fixture output dir |
|------------|-----------------|-------------------|
| `control` | `control` | `tests/baseline/tasks/T158-{N}/control/full.json` |
| `spectra-push` | `spec-driver-spectra` | `tests/baseline/tasks/T158-{N}/spec-driver-spectra/full.json` |
| `spectra-mcp-pull` | `mcp-pull` | `tests/baseline/tasks/T158-{N}/mcp-pull/full.json` |

**Definition of Done**：
- `node scripts/eval-mcp-augmented.mjs --task T158-micrograd-1 --cohort all --repeats 1 --dry-run` 退出码 0
- 脚本输出三个 fixture 路径占位（dry-run 模式，不实际写文件或写 stub JSON）
- `fs.existsSync('scripts/eval-mcp-augmented.mjs')` 为 true

**依赖**：T-001（buildClaudeArgs 接口已定）、T-002（spike PASS，MCP 路径可行）、T-003（至少一个 fixture 存在）

---

### T-006 — eval-task-runner.mjs 新增 parseMcpToolCallTrace + prepareWorktree 写 .mcp.json + spectra batch 触发

**对应 plan**：plan §2 修改文件（stream-json 解析段）、plan §3 T1 后半段  
**关联**：FR-005、FR-002、US-2、SC-003、SC-004、W-3 缓解  
**工作量**：M（0.5-1d）  
**Codex risk hint**：parseMcpToolCallTrace 纯函数的 w3Flag 计算逻辑（callCount=0 或 toolName 不在 expectedSpectraToolCalls）须与 spec §W-3 定义严格对齐；endsWith 匹配短名（CL-001）

**改动文件**：

| 文件 | 操作 | 关键修改 |
|------|------|---------|
| `scripts/eval-task-runner.mjs` | modify | (1) 新增 `parseMcpToolCallTrace(stdout, expectedSpectraToolCalls)` 纯函数：从 stream-json 提取 `tool_use` block（name 以 `mcp__spectra__` 开头），输出 `[{ toolName, callCount, firstCallTurn, totalDurationMs }]`，计算 `w3Flag`；(2) `prepareWorktree` 后对 mcp-pull cohort 写入 `${wtDir}/.mcp.json`（内容来自 `.mcp.json.template`）；(3) `runTask` 调用前对 micrograd target 跑 `spectra batch` 一次（共享，不重复；nanoGPT 单独一次）；(4) `assembleTaskFixture` 在 perf 子对象写入 `mcpToolCallTrace`（mcp-pull：数组；其余：null）和 `w3Flag`（mcp-pull：boolean；其余：null） |

**Definition of Done**（见 T-007 vitest 覆盖）：
- 给定含 `tool_use` block 的 stream-json 文本，`parseMcpToolCallTrace` 返回 `callCount > 0`
- `callCount = 0` 时 `w3Flag = true`
- toolName 不在 `expectedSpectraToolCalls`（endsWith 匹配）时 `w3Flag = true`
- control / spectra-push cohort 的 fixture `mcpToolCallTrace === null`

**依赖**：T-001（SUPPORTED_TOOLS 和 buildClaudeArgs 已完成）

---

### T-007 — vitest 单测：parseMcpToolCallTrace + buildClaudeArgs mcp-pull case + SUPPORTED_TOOLS 断言

**对应 plan**：plan §2 测试要求列  
**关联**：FR-002、FR-005、NFR-004  
**工作量**：S（< 0.5d）

**改动文件**：

| 文件 | 操作 | 关键意图 |
|------|------|---------|
| `tests/unit/eval-task-runner.test.mjs`（或已有 eval-task-runner 测试文件） | new/modify | 新增以下断言：(1) `SUPPORTED_TOOLS.includes('mcp-pull')` 为 true；(2) `buildClaudeArgs({ tool: 'mcp-pull', wtDir: '/tmp/x', prompt: '...' })` 输出含 `--mcp-config /tmp/x/.mcp.json` 和 `--allowedTools mcp__spectra__impact,...`；(3) `parseMcpToolCallTrace` 给定 fixture stream-json：callCount 类型 number、firstCallTurn 类型 number；(4) callCount=0 → w3Flag=true；(5) toolName 以 `mcp__spectra__impact` endsWith `impact`（CL-001 短名匹配）；toolName 不在 `["detect_changes"]` → w3Flag=true |

**Definition of Done**：
- `npx vitest run tests/unit/eval-task-runner.test.mjs` 输出 0 failed
- 所有 parseMcpToolCallTrace 和 buildClaudeArgs 断言明确通过（不可 skip）

**依赖**：T-001、T-006（被测函数已实现）

---

## Phase B — Eval & Aggregation（Week 2，Day 8-11）

**目标**：完整跑 3 cohort × 6 task × N=3 = 54 runs，产出 fixture 落盘  
**前置**：Phase A 全部完成（T-001 到 T-007）+ T-002 spike PASS

---

### T-008 — 跑 control cohort × 6 task × N=3（18 runs）

**对应 plan**：plan §3 T6（第一批）  
**关联**：FR-003、FR-004、US-1、NFR-001  
**工作量**：L（含等待 wall clock ~1.5h，实际编码 S）

**执行命令**：

```bash
node scripts/eval-mcp-augmented.mjs --cohort control --repeats 3 \
  --task T158-micrograd-1,T158-micrograd-2,T158-micrograd-3,T158-micrograd-4,T158-nanoGPT-5,T158-micrograd-6
```

**产出路径**（不入库）：`tests/baseline/tasks/T158-{1-6}/control/full.json`

**预算监控**：每 batch 完成后检查累计 `costUsd`；达 $35（70% 上限）时主动 pause，review 是否调降 N

**Definition of Done**：
- 18 个 `tests/baseline/tasks/T158-*/control/full.json` 文件存在（或 SC-007 SKIP 逻辑触发）
- 每个 fixture `JSON.parse` 通过，含 `taskId`、`tool: "control"`、`perf.wallTimeMs` 字段
- `w3Flag === null`（control cohort 不填）

**依赖**：T-005（eval-mcp-augmented.mjs 存在）、T-004a~e（所有 6 个 fixture 入库）

---

### T-009 — 跑 spectra-push cohort × 6 task × N=3（18 runs）

**对应 plan**：plan §3 T6（第二批）  
**关联**：FR-003、FR-004、US-1、NFR-001  
**工作量**：L（wall clock ~1.5h）

**执行命令**：

```bash
node scripts/eval-mcp-augmented.mjs --cohort spectra-push --repeats 3 \
  --task T158-micrograd-1,T158-micrograd-2,T158-micrograd-3,T158-micrograd-4,T158-nanoGPT-5,T158-micrograd-6
```

**产出路径**（不入库）：`tests/baseline/tasks/T158-{1-6}/spec-driver-spectra/full.json`

**Definition of Done**：
- 18 个 fixture 存在，`tool: "spec-driver-spectra"`
- `mcpToolCallTrace === null`（spectra-push cohort 不记录 trace）
- `perf.tokensInput` 存在（用于 SC-006 token ratio）

**依赖**：T-008 完成（串行跑，避免并发超 API rate limit）

---

### T-010 — 跑 mcp-pull cohort × 6 task × N=3（18 runs）+ W-3 trap 监控

**对应 plan**：plan §3 T6（第三批）、plan §7 W-02  
**关联**：FR-002、FR-003、FR-004、FR-005、SC-004、US-1、US-2、W-3 缓解  
**工作量**：L（wall clock ~2h，含 W-3 监控人工介入）  
**Codex risk hint**：单 task 中 ≥ 2/3 runs 的 w3Flag=true 须触发暂停规则，不可静默跳过

**执行命令**：

```bash
node scripts/eval-mcp-augmented.mjs --cohort spectra-mcp-pull --repeats 3 \
  --task T158-micrograd-1,T158-micrograd-2,T158-micrograd-3,T158-micrograd-4,T158-nanoGPT-5,T158-micrograd-6
```

**产出路径**（不入库）：`tests/baseline/tasks/T158-{1-6}/mcp-pull/full.json`

**W-3 暂停规则**：单 task 3 runs 中 >= 2 runs `w3Flag === true` → 暂停，调整 fixture prompt，重跑该 task（见 T-011）

**Definition of Done**：
- 18 个 fixture 存在，`tool: "mcp-pull"`
- 每个 fixture `mcpToolCallTrace` 为数组（可空 `[]`，但不为 `null`）
- 每个 fixture `w3Flag` 为 boolean
- W-3-FLAGGED 任务比例在报告中记录（不阻断验收）

**依赖**：T-009 完成（串行跑）

---

### T-011 — （条件触发）W-3 trap 调试与 fixture prompt 调整

**对应 plan**：plan §3 T6 W-3 trap 暂停规则、plan §7 W-02  
**关联**：US-2、W-3 缓解  
**工作量**：M（视触发情况，0.5-1d）

**触发条件**：T-010 跑完后，任一 task 的 mcp-pull cohort 3 runs 中 >= 2 runs `w3Flag = true`

**改动文件**：

| 文件 | 操作 | 关键修改 |
|------|------|---------|
| 对应的 `specs/158-.../research/task-fixtures/T158-*.json` | modify | 在 `prompt` 字段中添加提示，引导 agent 主动调用 spectra tool（如"请使用 spectra impact 工具分析函数调用链"）；不得引入额外 confound |

**Definition of Done**：
- 修改后重跑该 task mcp-pull cohort N=3，`w3Flag === false` 的 run >= 2
- 重跑结果覆盖原 fixture（或通过 --force 强制覆盖）

**依赖**：T-010（W-3 触发才执行；无触发则跳过）

---

### T-012 — bootstrap CI 聚合（lib/bootstrap-ci.mjs）

**对应 plan**：plan §3（FR-004 关联）  
**关联**：FR-004、US-4、SC-004  
**工作量**：S（< 0.5d）

**改动文件**：

| 文件 | 操作 | 关键意图 |
|------|------|---------|
| `scripts/lib/bootstrap-ci.mjs` | verify（已有，直接引用）| 确认 1000 resample 默认值（CL-003 已收口）；读取 T158-* fixture 的 `passed` 字段（或等效 oracle 结果），输出 `{ passRate, ci95Lower, ci95Upper, repeats: 3 }` |

**聚合脚本调用方式**（在 eval-mcp-augmented.mjs 或独立脚本中）：

```js
import { bootstrapCI } from './lib/bootstrap-ci.mjs';
const ci = bootstrapCI(passResults, 1000); // passResults: boolean[]
```

**Definition of Done**：
- 给定 3 次运行的 pass/fail 数组，`bootstrapCI` 返回含 `ci95Lower`、`ci95Upper`、`passRate` 字段的对象
- `npx vitest run` 中 bootstrap-ci 相关测试通过（若已有测试）

**依赖**：T-010（有实际 fixture 数据后可完整验证）

---

## Phase C — Report & Verify（Week 2，Day 12-13）

**目标**：人工撰写 §6 报告章节，完整实现 verify 脚本，全量验收通过

---

### T-013 — 人工撰写 §6 SWE-Bench-Style Grounding Lift 章节

**对应 plan**：plan §3 T7、§2 修改文件（competitive-evaluation-report.md）  
**关联**：FR-006、SC-005、SC-006、US-4  
**工作量**：M（0.5-1d）

**改动文件**：

| 文件 | 操作 | 关键修改 |
|------|------|---------|
| `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` | modify | 追加 §6 章节（~150 行）；**必须使用管道 markdown table 语法**（`\| col \| col \|`，SC-005 grep 验证） |

**§6 必含元素**：

1. `## 6. SWE-Bench-Style Grounding Lift`（精确标题，SC-005 grep）
2. 3 cohort × 6 task pass rate 矩阵（markdown table，每 cohort 一行汇总，含 bootstrap 95% CI）
3. Tool call trace 统计（mcp-pull 平均 spectra call 次数 / W-3-FLAGGED 比例）
4. Token 效率对比（push vs mcp-pull，量化 ratio，注明方向）
5. `### Limitation` 子节（三条：single-turn only / micrograd 外部效度 / N=6×N=3 统计功效）
6. 结论段：明确"是否拒绝 H₀ / 数据方向 / follow-up 建议"

**Definition of Done**（可机器验证）：
- `grep -ci "SWE-Bench-Style Grounding Lift" specs/147-.../competitive-evaluation-report.md` > 0
- `grep -c "^|.*|.*|" specs/147-.../competitive-evaluation-report.md` >= 3（管道表格行）
- `grep -ci "Limitation" specs/147-.../competitive-evaluation-report.md` > 0（子节存在）

**依赖**：T-010、T-012（有 54 runs 数据 + CI 聚合结果）

---

### T-014 — verify-feature-158.mjs 完整实现（SC-001 到 SC-008）

**对应 plan**：plan §3 T8（前半段）、plan §6 验证子任务表  
**关联**：FR-007、SC-001~008、US-5  
**工作量**：M（0.5-1d）  
**Codex risk hint**：SC-004 SKIP 逻辑（fixture 不存在时不算 FAIL）、SC-006 SKIP 逻辑（control token 为 null 时）、SC-007 WARN 逻辑须精确匹配 plan §6 表格定义

**改动文件**：

| 文件 | 操作 | 关键意图 |
|------|------|---------|
| `scripts/verify-feature-158.mjs` | new | ~200 行；参数：`--target <path>` / `--out <file>` / `--repeats N`；输出 `[SC-00N] PASS/SKIP/WARN/FAIL: ...` 格式；全部非 FAIL 则 exit 0 |

**各 SC 验证手段**（依 plan §6 表格）：

| SC | 验证手段 | SKIP/WARN 条件 |
|----|---------|---------------|
| SC-001 | `fs.readdirSync` 计数 ≥ 4 + `eval-task-fixture-check.mjs` + JSON parse `checks.length >= 2` | 无 SKIP |
| SC-002 | `fs.existsSync` + `execSync --dry-run` exit 0 | 无 SKIP |
| SC-003 | `grep -ci "mcp-pull"` + `grep -ci "mcp-config"` > 0 | 无 SKIP |
| SC-004 | 解析 `tests/baseline/tasks/T158-*/mcp-pull/full.json`，验证 `mcpToolCallTrace` 类型 + `w3Flag` 类型 | fixture 不存在 → SKIP |
| SC-005 | grep 标题 + 管道表格行 >= 3 + "Limitation" 子节 | 无 SKIP |
| SC-006 | 解析 fixture `perf.tokensInput + perf.tokensOutput` 计算 ratio | control token 为 null → SKIP |
| SC-007 | 遍历所有 fixture 累加 `perf.costUsd` ≤ 50 | fixture 不存在 → SKIP；`costUsd` 缺失 → WARN |
| SC-008 | stdout 含 8 行 `[SC-00N]` 输出；FAIL count == 0 → exit 0 | — |

**Definition of Done**：
- `node scripts/verify-feature-158.mjs --dry-run`（或等效测试模式）退出码 0
- SC-001 到 SC-008 每条输出格式符合 `[SC-00N] PASS/SKIP/WARN/FAIL: ...`

**依赖**：T-005（eval-mcp-augmented.mjs 存在，SC-002 可验收）、T-013（报告 §6 存在，SC-005 可验收）

---

### T-015 — baseline-diff.mjs 兼容性回归（NFR-005 plan-level 必做）

**对应 plan**：plan §3 T8（后半段）、plan §2 修改文件（baseline-diff.mjs）  
**关联**：NFR-005、plan §2 修改说明  
**工作量**：S（< 0.5d）  
**Codex risk hint**：schema 1.2 新字段（`mcpToolCallTrace`、`w3Flag`）若未加白名单，可能触发 baseline-diff drift 误报，污染现有 12 个 perf anchor 的基线对比

**改动文件**：

| 文件 | 操作 | 关键修改 |
|------|------|---------|
| `scripts/baseline-diff.mjs` | modify | 验证现有白名单字段比对逻辑是否会把 `mcpToolCallTrace` / `w3Flag` 标为 drift；若触发，加白名单条目或在字段比对时排除 null-only 新字段 |

**Definition of Done**：
- `npm run baseline:diff -- tests/baseline/micrograd/spectra/full.json tests/baseline/micrograd/spectra/full.json` 0 drift 误报
- 对现有 12 个 perf anchor fixture 各跑一次 baseline-diff，全部无 drift 误报
- （若有 mcp-pull fixture）mcp-pull fixture 的 `mcpToolCallTrace` 字段不触发 drift 误报

**依赖**：T-001、T-006（schema 1.2 字段定义完成）

---

### T-016 — 全量验收（lint + build + repo:check + verify-feature-158）

**对应 plan**：plan §3 T9  
**关联**：NFR-002、NFR-004、SC-008、US-5  
**工作量**：S（< 0.5d）

**执行顺序**（硬性，任一失败须停止）：

```bash
npm run build                          # TypeScript 0 error
npx vitest run                         # 0 failed
npm run repo:check                     # repo 同步检查
npm run baseline:diff -- ...           # 12 perf anchor 无 drift 误报（T-015 验证）
node scripts/verify-feature-158.mjs   # exit 0，SC-001 到 SC-008 全部 PASS/SKIP/WARN
```

**Definition of Done**：
- 上述所有命令退出码 0
- `verify-feature-158.mjs` stdout 含 8 行 `[SC-00N]` 输出，FAIL count == 0

**依赖**：T-007（vitest）、T-013（§6 报告）、T-014（verify 脚本）、T-015（baseline-diff 回归）

---

## FR 覆盖映射

| FR | 对应任务 |
|----|---------|
| FR-001 Task Fixture 设计 | T-003、T-004a、T-004b、T-004c、T-004d、T-004e |
| FR-002 MCP Pull 对照组接入 | T-001、T-002、T-006、T-007 |
| FR-003 三对照组并行跑 | T-005、T-008、T-009、T-010 |
| FR-004 N=3 重测 + Bootstrap CI | T-008、T-009、T-010、T-012 |
| FR-005 Tool Call Trace 监控 | T-006、T-007、T-010 |
| FR-006 §6 报告输出 | T-013 |
| FR-007 verify-feature-158.mjs | T-014 |

**NFR 覆盖**：

| NFR | 对应任务 |
|-----|---------|
| NFR-001 总成本 ≤ $50 | T-008/T-009/T-010（预算监控）、T-016（SC-007 验收） |
| NFR-002 开发时间 ≤ 2 周 | 全 Phase 时间切片（A/B/C） |
| NFR-003 可复现性 | T-003~T-004e（fixture 入库）；运行产物不入库 |
| NFR-004 Node-only | T-001/T-005/T-006（无 Python/Docker 依赖） |
| NFR-005 Schema 向后兼容 | T-006（schema 1.2 null-safe）、T-015（baseline-diff 回归） |

---

## 依赖与并行说明

### Phase 依赖关系

```
Phase A（T-001 → T-002 → T-003 → T-004a~e + T-005 + T-006 + T-007）
    ↓
Phase B（T-008 → T-009 → T-010 → T-011（条件）→ T-012）
    ↓
Phase C（T-013 + T-014 + T-015 → T-016）
```

### 关键串行约束

- **T-002 是 T-005/T-008 的硬前置**：spike FAIL 则暂停，不可继续进入 Phase B
- **T-008 → T-009 → T-010 串行**：避免并发超 Anthropic API rate limit
- **T-016 依赖 T-013 + T-014 + T-015 全完成**：任一失败须停止

### 并行机会

- **T-004a~e 五个 fixture 可完全并行**（五个独立 JSON 文件，互无依赖）
- **T-006（stream-json 解析）与 T-004a~e 可并行**（改动不同代码段）
- **T-013（报告撰写）与 T-014 早期框架（stub SC 输出）可提前并行**（T-014 不等 §6 完成即可写框架）

### 推荐实现策略（MVP First）

1. T-001 → T-002（spike PASS 确认）→ T-003（最简 fixture）
2. 并行：T-004a~e + T-006 + T-007（fixture 组 + 解析逻辑 + 单测）
3. T-005（eval-mcp-augmented.mjs 入口）→ Phase A 完成检查点
4. T-008 → T-009 → T-010（串行跑 54 runs，wall clock ~4.5h）
5. T-011（条件触发）→ T-012（CI 聚合）
6. T-013 + T-014 → T-015 → T-016（全量验收）
