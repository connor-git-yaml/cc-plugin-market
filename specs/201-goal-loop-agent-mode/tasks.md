---
feature: 201-goal-loop-agent-mode
title: "goal_loop agent_mode — 可执行任务分解"
status: Draft
created: 2026-06-20
---

# Feature 201 — 任务分解（tasks.md）

## 概述

按 plan.md §12 三阶段组织。共 **28 个任务**，覆盖 23 条 FR，对应 22 个测试 ID（T-GL-01~21 含 T-GL-12b）。core 为 **12 个纯函数** + 文件锁 I/O 边界助手。

- **Phase A**（声明层+配置）：T001~T010，无行为变更，可并行起步
- **Phase B**（确定性 core + CLI，TDD）：T011~T020，纯函数先测后实现
- **Phase C**（编排散文+verify JSON+集成测试）：T021~T028，含 golden-text 校验

标注 `[P]` = 可与同阶段其他任务并行；标注 `[Codex 必须]` = 涉及 `plugins/spec-driver/` 改动，提交前必须经 Codex 对抗审查（FR-022）。

---

## Phase A：声明层 + 配置（无行为变更）

**目标**：完成所有枚举扩展、schema 新增、配置示例、fixture、golden 模板。本阶段改动均不引入运行时行为变更（base 默认仍为 `single`），可先行提交并由 Codex 审查，为 Phase B 解除依赖。

**独立验证**：vitest 全量零失败 + npm run build 零类型错误。T-GL-01/02/03/04/15 全绿。

---

### T001 — schema enum 扩展（FR-001）[Codex 必须]

**文件**：`plugins/spec-driver/contracts/orchestration-schema.mjs`

**改动**：
- 在 `agent_mode` Zod 枚举新增字面量 `'goal_loop'`
- 更新该枚举的 `error_map` 文案，列出 `goal_loop`（使合法值枚举对用户可见）

**依赖**：无。Phase A 起点任务。

**对应 FR**：FR-001

**对应测试**：T-GL-01

**验收条件**：
1. `agent_mode: 'goal_loop'` 通过 Zod schema 校验，无 error
2. 传入非法 `agent_mode: 'invalid_xyz'` 的 error 文案中包含字面量 `goal_loop`
3. `npm run build` 类型检查零错误

**执行标注**：属于"写实现"步骤，但逻辑简单（纯 enum 扩展）。修改完后立即运行 T-GL-01 对应单测确认。

---

### T002 — orchestration.yaml 注释更新（FR-002，FR-015）

**文件**：`plugins/spec-driver/config/orchestration.yaml`

**改动**：
- 在 feature mode 的 implement phase 附近（SKILL.md 分派逻辑区域）新增注释，说明：
  - base 默认 `agent_mode: single`（goal_loop 默认关闭，FR-015）
  - 通过 `.specify/orchestration-overrides.yaml` 的 `modes.feature` 整段替换可激活 `goal_loop`
  - 参考 `plugins/spec-driver/templates/goal-loop-override-template.yaml` 获取 golden 模板
- 注释仅为说明性文字，**不改任何 YAML 字段值**

**依赖**：无，可并行 [P]。

**对应 FR**：FR-002、FR-015

**对应测试**：T-GL-02（resolver 校验 base 默认仍为 single）

**验收条件**：
1. `orchestrator-cli get-phases feature` 输出的 implement phase `agent_mode` 仍为 `single`
2. 注释完整、双语（中文说明 + 英文 key 名）
3. YAML 语法合法（yaml lint 零错误）

---

### T003 — config-schema.mjs 新增 goal_loop 段（FR-005/006/007）[Codex 必须] [P]

**文件**：`plugins/spec-driver/scripts/lib/config-schema.mjs`

**改动**：
- 在现有 Zod config schema 中新增可选 `goal_loop` 段：
  ```ts
  goal_loop: z.object({
    max_iterations: z.number().int().min(1).default(5),
    no_progress_max_rounds: z.number().int().min(1).default(2),
    max_verify_seconds: z.number().positive().default(300),
    max_tool_invocations: z.number().int().min(1).default(50),
  }).optional()
  ```
- 标注：`goal_loop` 段为可选，不破坏现有 config 校验（后向兼容）
- 默认值与 plan §2（配置项落点）一致

**依赖**：无，可并行 [P]。

**对应 FR**：FR-005、FR-006、FR-007

**对应测试**：Phase B T015 中 `decideStop` / `computeDelta` / `selectVerifyMode` 会读取这些值（通过 fixture 传入）

**验收条件**：
1. 含 `goal_loop` 段的 config 通过 Zod 校验
2. 不含 `goal_loop` 段的现有 config 仍通过校验（后向兼容）
3. `npm run build` 零类型错误

---

### T004 — spec-driver.config.yaml 示例段（FR-005/006/007）[P]

**文件**：`spec-driver.config.yaml`

**改动**：
- 在 `spec-driver.config.yaml` 末尾新增 `goal_loop` 段示例，**默认全部注释掉**（不激活）：
  ```yaml
  # goal_loop 配置（Feature 201）
  # 仅在 .specify/orchestration-overrides.yaml 启用 goal_loop 时生效
  # goal_loop:
  #   max_iterations: 5
  #   no_progress_max_rounds: 2
  #   max_verify_seconds: 300
  #   max_tool_invocations: 50
  ```

**依赖**：T003（schema 先定义，示例才正确）

**对应 FR**：FR-005、FR-006、FR-007

**对应测试**：无直接单测，属于文档性变更

**验收条件**：
1. 文件 YAML 语法合法
2. 注释掉的段不影响 config 解析（不触发任何 schema 校验）
3. 示例值与 T003 中 Zod schema 的 default 一致

---

### T005 — golden override 模板（FR-016）[P]

**文件**：`plugins/spec-driver/templates/goal-loop-override-template.yaml`（新增）

**改动**：新建 golden override 模板，内容为：
- `version` 字段：与 base `orchestration.yaml` 的 `version` 字段一致（运行时读取后填入，或从 orchestration.yaml 手动对齐）
- `modes.feature`：完整 feature phase 列表（逐字从 `orchestrator-cli get-phases feature` 输出拷贝，base 的完整 phase 序列）
- 其中仅 implement phase 的 `agent_mode` 改为 `goal_loop`，其余所有 phase 字段与 base 完全等价
- 文件顶部注释说明：
  1. 使用方法（复制到 `.specify/orchestration-overrides.yaml`）
  2. 整段替换语义（modes.feature 不继承 base，必须含完整 phase 列表）
  3. 漂移风险（FR-016 诚实标注：base phase 序列未来变更时 version-mismatch warning 会提示）
  4. reward hacking 残留风险声明（FR-023）

**依赖**：T001（schema 必须先接受 goal_loop enum），T002（base orchestration 注释明确）

**对应 FR**：FR-015、FR-016、FR-023

**对应测试**：T-GL-03（模板经 resolver 后仅 implement.agent_mode 变化），T-GL-04（version 不一致检测）

**验收条件**：
1. 文件存在且 YAML 语法合法
2. `orchestrator-cli effective-orchestration feature` 用此模板作为 override 后，除 implement phase 的 `agent_mode=goal_loop` 外其余 phase 与 base 逐字段等价
3. 模板中 `version` 字段与当前 base `orchestration.yaml` 一致
4. 文件顶部有漂移风险和 reward hacking 诚实说明注释

---

### T006 — override fixture valid-overrides-goal-loop.yaml（FR-015/016）[P]

**文件**：`plugins/spec-driver/tests/fixtures/orchestration/valid-overrides-goal-loop.yaml`（新增）

**改动**：新建测试 fixture，内容为：
- 最小化 goal_loop override（`modes.feature` 整段替换，implement phase `agent_mode: goal_loop`，其余 phase 与 base 等价）
- `version` 与 base 一致（供 T-GL-03 测 resolver 合并后语义正确）

**依赖**：T005（基于 golden 模板内容）

**对应 FR**：FR-015、FR-016

**对应测试**：T-GL-02、T-GL-03、T-GL-04

**验收条件**：
1. 文件存在且 YAML 语法合法
2. 被 orchestration-resolver 解析时不抛 schema 错误
3. resolver 合并后 implement phase `agent_mode` = `goal_loop`

---

### T007 — 测试：schema + opt-in + golden 等价 + 字段锁（T-GL-01/02/03/04/15）

**文件**：`plugins/spec-driver/tests/orchestration-resolver.test.mjs`（修改，新增测试用例）

**改动**：在现有 orchestration-resolver.test.mjs 中新增以下测试用例（不修改已有用例）：

- **T-GL-01**：`goal_loop` 通过 schema 校验；非法 agent_mode 的 error_map 文案含 `goal_loop`
- **T-GL-02**：base 配置 + 无 override → feature implement phase agent_mode = `single`
- **T-GL-03**：`valid-overrides-goal-loop.yaml` fixture 经 resolver 后，implement phase agent_mode = `goal_loop`，其余 phase 与 base **逐字段等价**（遍历比对 phase id、phase 名称、所有字段，仅 implement.agent_mode 不同）
- **T-GL-04**：`version-mismatch-overrides.yaml`（已有 fixture）经 resolver → diagnostics 含 `version-mismatch`；版本一致 → diagnostics 为空
- **T-GL-15**：直接解析 `orchestration.yaml`，断言 GATE_VERIFY 的 `default_behavior = 'always'` 且 `severity = 'critical'`（字段锁，FR-021）

**依赖**：T001（schema）、T005（golden 模板）、T006（fixture）

**对应 FR**：FR-001、FR-015、FR-016、FR-021

**对应测试**：T-GL-01、T-GL-02、T-GL-03、T-GL-04、T-GL-15

**验收条件**：
1. 全部 5 个新测试用例在 `npx vitest run` 通过
2. 现有 orchestration-resolver.test.mjs 中所有原有测试不变
3. T-GL-03 的"逐字段等价"断言逐 phase id 比较，不接受松散的"大致等价"

**重要**：此文件属于 `plugins/spec-driver/tests/`，改动须经 Codex 审查。

---

### T008 — report fixture 目录与样例文件（FR-010）

**文件**：`plugins/spec-driver/tests/fixtures/goal-loop/`（新建目录）
- `plugins/spec-driver/tests/fixtures/goal-loop/report-pass-full.json`（新增）
- `plugins/spec-driver/tests/fixtures/goal-loop/report-fail-regression.json`（新增）
- `plugins/spec-driver/tests/fixtures/goal-loop/report-skipped-command.json`（新增）
- `plugins/spec-driver/tests/fixtures/goal-loop/report-missing-exit-code.json`（新增）
- `plugins/spec-driver/tests/fixtures/goal-loop/report-invalid-json.txt`（新增，故意非法 JSON，用于测 parseReport 降级）
- `plugins/spec-driver/tests/fixtures/goal-loop/report-smoke-pass.json`（新增，smoke 模式）
- `plugins/spec-driver/tests/fixtures/goal-loop/report-full-pass.json`（新增，full 模式）

**fixture 字段要求**：每个 `.json` 严格遵循 plan §2 verification-report schema（含 `round`、`verify_mode`、`layer2_commands[].exit_code`、`layer1_fr_coverage`、`layer1_5_evidence`、`regression_check`、`delta_inputs`）。`report-missing-exit-code.json` 中某条 command 故意缺 `exit_code` 字段。

**依赖**：无。Phase A 可并行 [P]。

**对应 FR**：FR-010

**对应测试**：T-GL-05~T-GL-13、T-GL-19（所有 core 单测的输入 fixture）

**验收条件**：
1. 目录下 7 个文件均存在
2. 各 `.json` 文件 JSON 语法合法（`report-invalid-json.txt` 除外，刻意非法）
3. `layer2_commands` 中每条命令均含 `name`、`exit_code`（或刻意缺失）、`status`、`skipped_reason` 字段

---

### T009 — Codex 对抗审查制品目录初始化（FR-022）

**文件**：`specs/201-goal-loop-agent-mode/verification/`（已存在）

**改动**：
- 确认目录存在（已存在，有 codex-adversarial-review-spec.md 和 codex-adversarial-review-plan.md）
- 无需额外创建文件；Phase A 提交前须产出 `codex-adversarial-review-phase-a.md`（Phase A 实施后 Codex 审查产出）

**依赖**：无。此为工程约定任务，确认审查流程就绪。

**对应 FR**：FR-022

**验收条件**：
1. `specs/201-goal-loop-agent-mode/verification/` 目录存在
2. Phase A commit 前，codex-rescue 子代理对 T001~T008 改动完成对抗审查，产出 `codex-adversarial-review-phase-a.md`（含 CRITICAL/WARNING/INFO 三档计数，CRITICAL 全 closed）

---

### T010 — Phase A 验证与提交

**验证命令**（按顺序，全部零失败后才提交）：

```bash
npx vitest run                          # T-GL-01/02/03/04/15 全绿 + 现有测试不变
npm run build                           # 零类型错误
npm run repo:check                      # 零告警
```

**提交约定**：
- 显式路径 commit（禁 `git add -A`）
- 排除 `specs/src.spec.md`（自动再生产物）
- commit message 含 Codex 审查结论摘要
- commit 前必须完成 T009 描述的 Codex 对抗审查

---

## Phase B：确定性 core + CLI（TDD，纯函数先测后实现）

**目标**：实现 `goal-loop-core.mjs` 的 **12 个纯函数** + `goal-loop-cli.mjs` CLI 包装 + I/O 集成测试。所有纯函数按 TDD 执行：**先写失败测试（Red）→ 再实现到绿（Green）**，不允许"先实现后补测"。**全部 core 实现都在 Phase B**（含 formatIterationLogEntry）。

**独立验证**：`npx vitest run` core 单测 T-GL-05~19 全绿，`npm run build` 零类型错误。

---

### T011 — core 骨架（全函数空桩）+ 真实失败断言测试（TDD Red）[Codex 必须]

**文件**：
- `plugins/spec-driver/scripts/lib/goal-loop-core.mjs`（新增，**仅空桩骨架**）
- `plugins/spec-driver/tests/goal-loop-core.test.mjs`（新增，真实断言）

**改动（修正 Codex C-04：import 崩 ≠ 红）**：
1. **先建 core 骨架**：创建 `goal-loop-core.mjs`，导出全部 **12 个函数的空桩**，**每个桩 `throw new Error('NotImplemented: <fnName>')`**（**不是** return undefined——修正 Codex C-04：返回 undefined 会让 `result.exit_reason` 触发 TypeError 而非干净断言失败；抛 NotImplemented 被 `node:test` 捕获为该用例的失败 = 干净的红）。目的：让测试文件 `import` **能成功解析**（不 import error），每个用例因桩抛错而**干净失败**（红）。
2. **再写真实断言**（非 `assert.fail` 占位）：每个测试用例写**真实的输入→期望输出断言**，喂 T008 的 fixture。此时桩抛 NotImplemented，断言所在用例全部干净失败（红）。

**12 个核心纯函数**（含 C-03 新增 `interpretImpactResult` + W-04 新增 `formatIterationLogEntry`）：classifyCommand / evaluateMetric / detectRegression / computeDelta / decideStop / decideDispatch / selectVerifyMode / planSnapshotCommands / planRollbackCommands / parseReport / **interpretImpactResult** / **formatIterationLogEntry**

**测试用例（真实断言，对应 T-GL-05~17/19/20/21）**：
- T-GL-05 `decideStop` 末轮达标优先 ｜ T-GL-06 `decideStop` max_iterations ｜ T-GL-07 `computeDelta`+`decideStop` 无进展 ｜ T-GL-08 `computeDelta` 有进展不早停 ｜ T-GL-09 `evaluateMetric` SKIPPED 不达标 ｜ T-GL-10 `classifyCommand` 缺 exit_code→UNKNOWN ｜ T-GL-11 `parseReport` 非法→infra-failure ｜ T-GL-12 `detectRegression` smoke↔full 分桶不误判 ｜ T-GL-12b `planRollbackCommands` 双分支命令序列 ｜ T-GL-13 `decideStop` rollback 失败最高优先 ｜ T-GL-14 `decideDispatch` 误配降级 ｜ T-GL-16 `selectVerifyMode` round 策略 ｜ T-GL-17 `interpretImpactResult` graph-not-built→skipped+warning（**纯函数，C-03 修正**）｜ T-GL-19 `planSnapshotCommands` 双分支 ｜ T-GL-20（W-05）`decideStop` infra-failure 连续 N 轮→NO_PROGRESS ｜ T-GL-21（W-04）`formatIterationLogEntry` 内嵌 JSON 可解析（绿在 T024）

> 全部 12 函数在 T011 建空桩（throw NotImplemented）+ 写真实红断言；T012~T017 逐函数转绿（含 `formatIterationLogEntry` 在 T017 一并实现，**全部 core 实现都在 Phase B**）。T024（Phase C）是 e2e/golden-text 校验"T022 散文确实调用 formatIterationLogEntry 并写 iteration-log.md"，**不重复实现 core 函数**。

格式沿用 `node:test` + `assert`。T-GL-15（GATE_VERIFY 字段锁）在 T007；T-GL-18（文件锁 I/O）在 T019。

**依赖**：T008（report fixture）

**执行标注**：TDD **Red**——桩抛 NotImplemented，真实断言用例全干净红（非 import 崩、非 TypeError）。确认全红后进入 T012~T017 逐函数实现转绿。

**对应 FR**：FR-003~FR-014、FR-017

---

### T012 — 实现 classifyCommand（FR-009）[Codex 必须]

**文件**：`plugins/spec-driver/scripts/lib/goal-loop-core.mjs`（修改，替换空桩为实现）

**改动**：实现 `classifyCommand(cmdResult)`（纯函数，FR-009）：
- `skipped_reason` 非 null → `SKIPPED` ｜ `exit_code` 缺失/非数字 → `UNKNOWN` ｜ `exit_code === 0` → `PASS` ｜ `exit_code !== 0`（含超时）→ `FAIL`

**依赖**：T011（骨架 + 红测试就绪）

**TDD 步骤（Green）**：实现后运行 vitest，T-GL-10 由红转绿，其余仍红（符合预期，逐函数推进）。

**对应 FR**：FR-009 ｜ **对应测试**：T-GL-10

---

### T013 — evaluateMetric 与 parseReport（FR-008/009/010）[Codex 必须]

**文件**：`plugins/spec-driver/scripts/lib/goal-loop-core.mjs`（修改）

**改动**：实现两个纯函数：

**`evaluateMetric(report)`**（FR-008）：
- 输入：验证报告对象（plan schema）
- 返回：`boolean`（达标 true/false）
- 达标条件（全部满足）：
  1. `layer2_commands` 中所有 status 均为 `PASS`（无 FAIL/SKIPPED/UNKNOWN）
  2. `layer1_fr_coverage.p1_coverage_pct === 100`
  3. `layer1_5_evidence.status === 'COMPLIANT'`

**`parseReport(jsonText)`**（FR-010/GL-03）：
- 输入：字符串（verify agent 产出的 JSON 文本）
- 返回：`{ report: ReportObject }` 或 `{ degraded: 'infra-failure', reason: string }`
- 降级条件：JSON 解析失败、schema 必填字段缺失、任一 `layer2_commands` 缺 `exit_code`（强制 UNKNOWN）
- **纯函数，不写日志**（日志由调用方编排器写，plan §1.1 修正 WL-01）

**依赖**：T012（文件已存在，classifyCommand 可复用）

**TDD 步骤**：实现后运行 vitest，确认 T-GL-09、T-GL-11 变绿。

**对应 FR**：FR-008、FR-009、FR-010

**对应测试**：T-GL-09、T-GL-11

---

### T014 — computeDelta 与 detectRegression（FR-006/013）[Codex 必须]

**文件**：`plugins/spec-driver/scripts/lib/goal-loop-core.mjs`（修改）

**改动**：实现两个纯函数：

**`computeDelta(prevReport, curReport)`**（FR-006）：
- 输入：两轮 report 对象（prevReport 可为 null，第一轮无前一轮）
- 返回：`{ delta: [d1, d2, d3, d4, d5], hasProgress: boolean }`
  - d1 = `layer2_pass_count` 变化
  - d2 = `p1_fr_coverage_pct` 变化
  - d3 = `layer1_5_status_score` 变化（COMPLIANT=2/PARTIAL=1/EVIDENCE_MISSING=0）
  - d4 = `regression_count` 变化（负 = 改善）
  - d5 = `net_loc_delta`（来自 report 的 `delta_inputs.net_loc_delta`）
- `hasProgress`：五维向量至少一维非 0 则 true，全 0 则 false

**`detectRegression(prevReport, curReport)`**（FR-013）：
- 输入：同模式（smoke/full）的前一轮和本轮 report
- **核心约束**：只比较 `verify_mode` 相同的 command（smoke↔smoke / full↔full，plan OQ-03 GL-04 修正）
- 返回：`{ regression: boolean, commands: string[] }`（commands = 本轮 FAIL 但前轮 PASS 的命令名）
- `prevReport === null`（第一轮）→ `{ regression: false, commands: [] }`

**依赖**：T013

**TDD 步骤**：实现后运行 vitest，确认 T-GL-07、T-GL-08、T-GL-12 变绿。特别验证 T-GL-12 的 smoke↔full 跨模式不误判（smoke 未跑 lint，full 跑了 lint 后 lint 失败，不得判 lint regression）。

**对应 FR**：FR-006、FR-013

**对应测试**：T-GL-07、T-GL-08、T-GL-12

---

### T015 — planSnapshotCommands 与 planRollbackCommands（FR-013）[Codex 必须]

**文件**：`plugins/spec-driver/scripts/lib/goal-loop-core.mjs`（修改）

**改动**：实现两个纯函数（git 命令序列规划，plan §2 OQ-02）：

**`planSnapshotCommands(isClean)`**：
- `isClean = true`：返回 `[]`（不 stash，S_i = { clean: true, ref: '<HEAD>' }）
- `isClean = false`：返回 `['git stash push --include-untracked -m "goal_loop-S{i}"', 'git rev-parse stash@{0}', 'git stash apply --index {stash_ref}']`
- 注意：实际 `{i}` 和 `{stash_ref}` 为占位符，编排器执行时替换；函数返回命令模板字符串数组

**`planRollbackCommands(S_i)`**：
- `S_i = { clean: true, ref: '<HEAD>' }`：返回 `['git reset --hard HEAD', 'git clean -fd']`
- `S_i = { clean: false, ref: '<stash_sha>' }`：返回 `['git reset --hard HEAD', 'git clean -fd', 'git stash apply --index <stash_sha>']`
- `git clean -fd` 安全性注明（plan §2 已分析）：不带 `-x` 保留 .gitignore 文件，不带 `-ff` 不删嵌套 git 仓库

**依赖**：T014

**TDD 步骤**：实现后运行 vitest，确认 T-GL-12b、T-GL-19 变绿。

**对应 FR**：FR-013

**对应测试**：T-GL-12b、T-GL-19

---

### T016 — selectVerifyMode + decideDispatch + interpretImpactResult（FR-007/017/012）[Codex 必须]

**文件**：`plugins/spec-driver/scripts/lib/goal-loop-core.mjs`（修改）

**改动**：实现三个纯函数：

**`selectVerifyMode(round, maxIterations, aboutToExit)`**（FR-007 + plan OQ-03）：
- `round < maxIterations && !aboutToExit` → `'smoke'`；`round === maxIterations || aboutToExit` → `'full'`
- smoke 定义：`tsc --noEmit` + `npx vitest run`；full：`npm run build` + lint + `npm run repo:check`

**`decideDispatch(phaseId, agentMode)`**（FR-017）：
- `goal_loop && phaseId === 'implement'` → `{ dispatch: 'goal_loop' }`
- `goal_loop && phaseId !== 'implement'` → `{ dispatch: 'single', warning: '...' }`（误配降级）
- 其他 → `{ dispatch: agentMode }`（透传）

**`interpretImpactResult(mcpResult)`**（FR-012，修正 Codex C-03——把"测不存在的 injectSpectraImpact"改成可测纯函数）：
- 输入：Spectra MCP `impact` 工具的返回（或错误对象）。**纯函数：只解释结果，不发起 MCP 调用**（实际 MCP 调用由编排器在散文里发起，把结果喂给本函数）。
- `mcpResult` 含有效 impact 数据 → `{ injected: true, summary: '<摘要文本>' }`
- `mcpResult` 为错误/`graph-not-built`/空 → `{ injected: false, skipped: true, warning: 'Spectra impact 不可用：{reason}，本轮跳过注入' }`
- 这样 T-GL-17 测的是 `interpretImpactResult` 这个真实可 import 的纯函数；编排器（T022 散文）负责发起 MCP 调用并把结果传入。

**依赖**：T015

**TDD 步骤**：实现后确认 T-GL-14、T-GL-16、T-GL-17 变绿。

**对应 FR**：FR-007、FR-017、FR-012

**对应测试**：T-GL-14、T-GL-16、T-GL-17

---

### T017 — decideStop（FR-004/005/006/013/014）[Codex 必须]

**文件**：`plugins/spec-driver/scripts/lib/goal-loop-core.mjs`（修改）

**改动**：实现核心函数 `decideStop`：

```javascript
/**
 * 每轮 verify 后按固定优先级判定停止/处置
 * @param {Object} params
 * @param {Object} params.report - 本轮 verification-report
 * @param {number} params.round - 当前轮次（1-based）
 * @param {Object} params.config - goal_loop 配置（max_iterations, no_progress_max_rounds）
 * @param {Object[]} params.prevReports - 历史 report 数组
 * @param {{ success: boolean }|null} params.rollbackResult - 本轮回滚结果（null=无回滚）
 * @returns {{ stop: boolean, exit_reason: string, action: string }}
 */
export function decideStop({ report, round, config, prevReports, rollbackResult }) { ... }
```

**regression 输入契约（修正 Codex C-01 + W1）**：`decideStop` **内部自行调用** `detectRegression(prevSameMode, report)` 计算 regression，**不依赖外部传入 regression 参数、也不信任 report 自带的 regression_check 字段**（后者由 verify 子代理产出，职责分离下不作为编排器的权威判据）。**W1 修正**：`prevSameMode` 不是 `prevReports[last]`，而是在 `prevReports` 中**从后向前找 verify_mode 与本轮相同的最近一条**（degraded 报告跳过）——否则 full→smoke→full FAIL 序列里，当前 full 与中间 smoke 跨桶比较会漏判 full 回归。decideStop 的入参保持 `{report, round, config, prevReports, rollbackResult}`，regression 由 core 内部确定性推导，单测可完全覆盖。

**优先级（FR-004，严格顺序）**：
1. `rollbackResult !== null && !rollbackResult.success` → `stop=true, exit_reason='ROLLBACK_FAILED', action='goto_gate_verify'`
2. `detectRegression(prevSameMode, report).regression === true` → `action='rollback'`；`stop=false`（视剩余预算 continue）或 `stop=true`（预算耗尽），`exit_reason='REGRESSION_ROLLBACK'`
3. `evaluateMetric(report) === true`（**无论是否 round===maxIterations**，达标优先）：
   - `report.verify_mode === 'full'` → `stop=true, exit_reason='REACHED_GOAL', action='goto_gate_verify'`
   - `report.verify_mode === 'smoke'`（**Codex C2 修正**：smoke 全绿不得直接达标，plan §OQ-03 要求达标退出前经一次 full verify）→ `stop=false, exit_reason=null, action='escalate_full'`（编排器据此升级到 full verify 重判）
4. `round >= config.max_iterations` → `stop=true, exit_reason='MAX_ITERATIONS', action='goto_gate_verify'`
5. infra-failure（本轮 report.degraded 或超预算）/ `computeDelta` 连续 `no_progress_max_rounds` 轮全 0 → `stop=true, exit_reason='NO_PROGRESS', action='goto_gate_verify'`
6. 否则 → `stop=false, exit_reason=null, action='continue'`

**关键细节**：同轮"达标 + max_iterations 同时满足"→ exit_reason = `'REACHED_GOAL'`（FR-004 同轮冲突规则）；同轮"regression + max_iterations"→ 先 regression 回滚（优先级 2 高于 4）。

**附带实现 `formatIterationLogEntry(entry)`**（core #12，FR-019）：返回含内嵌 ```json 围栏的 markdown 块（供 T-GL-21 在 T011 红、此处转绿）。**全部 core 纯函数实现至此在 Phase B 完成。**

**依赖**：T016（computeDelta、evaluateMetric、detectRegression、interpretImpactResult 已就绪）

**TDD 步骤**：实现后确认 T-GL-05、T-GL-06、T-GL-07、T-GL-13、T-GL-20、T-GL-21 全绿。

**对应 FR**：FR-004、FR-005、FR-006、FR-013、FR-014、FR-019

**对应测试**：T-GL-05、T-GL-06、T-GL-07、T-GL-13、T-GL-20、T-GL-21

---

### T018 — goal-loop-cli.mjs 子命令 CLI 包装（FR-018）[Codex 必须]

**文件**：`plugins/spec-driver/scripts/goal-loop-cli.mjs`（新增）

**改动**：创建薄 CLI 包装（仿 `orchestrator-cli.mjs` 风格）。**统一接口契约（修正 Codex C-02）**：所有"需要复杂结构输入"的子命令一律接受**单个 JSON payload**（文件路径或 stdin），输出 JSON 到 stdout；简单标量子命令用位置参数。T022 散文必须按本契约调用（两边一致）。

```
goal-loop-cli.mjs <subcommand> [args]

纯 core 子命令（输出 JSON，调 goal-loop-core.mjs）：
  parse-report <reportJsonFile>          → { report: {...} } | { degraded: 'infra-failure', reason }
  classify-command <cmdJsonFile>         → { status: 'PASS|FAIL|SKIPPED|UNKNOWN' }
  decide-stop <payloadJsonFile>          → { stop, exit_reason, action }
       payload = { report, round, config, prevReports, rollbackResult }（单文件，含全部入参）
  plan-snapshot <isClean:true|false>     → { commands: [...] }
  plan-rollback <snapshotJsonFile>       → { commands: [...] }   snapshot = { clean, ref }
  select-verify-mode <round> <max> <aboutToExit:true|false>  → { mode: 'smoke|full' }
  decide-dispatch <phaseId> <agentMode>  → { dispatch, warning? }
  interpret-impact <mcpResultJsonFile>   → { injected, summary } | { skipped, warning }

I/O 边界子命令（非纯，文件锁）：
  acquire-lock <lockPath>                → { acquired: true } | { acquired: false, reason }
  release-lock <lockPath>                → { released: true }
```

> 契约一致性由 T022 散文的 CLI 调用与本清单逐一对齐保证；T025 golden-text 校验断言散文只调用本清单中的子命令名。

**acquireLock / releaseLock 实现**（FR-018）：
- `acquireLock(lockPath)`：尝试 `O_EXCL` 创建 `.lock` 文件；文件已存在 → 返回 `{ acquired: false, reason: 'lock_exists' }`；成功 → 写入 `{ pid, start_time }` 返回 `{ acquired: true }`
- `releaseLock(lockPath)`：删除 `.lock` 文件

**依赖**：T017（core 全部 12 个纯函数已实现）

**对应 FR**：FR-018

**对应测试**：T-GL-18（集成测试，见 T019）

---

### T019 — 集成测试：文件锁 I/O 边界（T-GL-18）[Codex 必须]

**文件**：`plugins/spec-driver/tests/goal-loop-core.test.mjs`（修改，新增 I/O 集成测试 describe 块）

**改动**：在测试文件末尾新增**集成测试段**（与纯函数单测分开 describe 块明确标注"I/O 集成，非纯函数"）：

**T-GL-18**（FR-018 文件锁集成测试，temp-dir）：
- 用 `os.tmpdir()` 创建临时目录
- 第一次 `acquireLock(tmpLockPath)` → `{ acquired: true }`
- 第二次立即 `acquireLock(tmpLockPath)` → `{ acquired: false, reason: 'lock_exists' }`
- `releaseLock(tmpLockPath)` → 锁文件消失；第三次 `acquireLock` → `{ acquired: true }`
- 测试后清理 temp 目录

> **注（C-03 修正）**：T-GL-17（Spectra impact 降级）已改为**纯函数** `interpretImpactResult` 测试，在 T011（红）+ T016（绿）覆盖，**不再**是这里的集成测试；编排器发起真实 MCP 调用属 e2e（verify 阶段）。

**依赖**：T018（CLI/lock 已就绪）

**对应 FR**：FR-018

**对应测试**：T-GL-18

---

### T020 — Phase B 验证与提交

**验证命令**：

```bash
npx vitest run                          # 纯函数 T-GL-05~17 + T-GL-19/20/21 全绿 + I/O 集成 T-GL-18 全绿（T-GL-21b 散文接线在 Phase C）
npm run build                           # 零类型错误
npm run repo:check                      # 零告警
```

**提交前**：
1. 运行 Codex 对抗审查（`goal-loop-core.mjs`、`goal-loop-cli.mjs`、`goal-loop-core.test.mjs` 是本阶段最高风险文件）
2. 产出 `specs/201-goal-loop-agent-mode/verification/codex-adversarial-review-phase-b.md`
3. CRITICAL 全修复后才提交

**显式路径 commit**（禁 `git add -A`，排除 `specs/src.spec.md`）

---

## Phase C：编排散文 + verify JSON 模式 + 集成测试

**目标**：完成 feature SKILL.md 的 goal_loop 编排散文块、verify.md 的 JSON 输出模式、补全 T-GL-17 集成测试断言、以及全量验证。

**独立验证**：vitest + build + repo:check + release:check 全过。

---

### T021 — feature SKILL.md：goal_loop 分派分支（FR-002）[Codex 必须]

**文件**：`plugins/spec-driver/skills/spec-driver-feature/SKILL.md`（修改）

**改动位置**：在现有"执行模式"小节的 agent_mode 分派逻辑处（plan §1.3，SKILL.md:178-254 附近），新增 `goal_loop` 分支判断：

```markdown
当 implement phase 的 effective agent_mode 为 `goal_loop` 时（通过 `goal-loop-cli.mjs decide-dispatch implement goal_loop` 确认分派）：
→ 执行下方「goal_loop 闭环编排」小节
→ 而非单次 Task("implement", ...)

否则（single，base 默认）：
→ 保持原单次 Task("implement", ...) 路径不变
```

**注意**：仅添加分支判断和指向，**不在此处写闭环逻辑**（闭环逻辑在 T022）。

**依赖**：T018（goal-loop-cli.mjs 已就绪，分派可调用）

**对应 FR**：FR-002

**验收条件**：
1. 现有 implement phase single 路径文字不变
2. 新增分支明确调用 `goal-loop-cli.mjs decide-dispatch` 确认分派
3. 分支后指向 goal_loop 闭环小节（T022 会添加）

---

### T022 — feature SKILL.md：goal_loop 闭环编排散文（FR-003/004/005/006/007/011/012/013/014/018/019）[Codex 必须]

**文件**：`plugins/spec-driver/skills/spec-driver-feature/SKILL.md`（修改）

**改动**：在工作流执行章节末尾新增独立小节「goal_loop 闭环编排」，包含以下编号步骤（散文 + 伪码混合，与 batch_loop 风格对齐）：

```markdown
### goal_loop 闭环编排

激活条件：implement phase 的 effective agent_mode == goal_loop（由 T021 分派分支进入）

前置：
- 读取 goal_loop 配置（spec-driver.config.yaml 的 goal_loop 段，含 max_iterations/no_progress_max_rounds/max_verify_seconds/max_tool_invocations）
- 确认单实例锁：`goal-loop-cli.mjs acquire-lock {feature_dir}/goal-loop/.lock`（FR-018）
  - 冲突 → 输出"已有 goal_loop 实例运行"，进 GATE_VERIFY，不继续
- 初始化迭代日志：{feature_dir}/goal-loop/iteration-log.md（FR-019）

循环体（i = 1..max_iterations）：
  步骤 1：建立轮次 snapshot（FR-013）
    - `git status --porcelain` 判断工作区是否干净
    - 调 `goal-loop-cli.mjs plan-snapshot <isClean>` → 获取命令序列
    - 逐条执行命令，检查退出码；任一非零 → 记录失败，进 GATE_VERIFY
    - 记录 S_i = { clean, ref } 到迭代日志

  步骤 2：注入 Spectra impact 上下文（FR-011/012）
    - 编排器调 Spectra MCP `impact` 工具（或捕获其错误），把返回喂 `goal-loop-cli.mjs interpret-impact <mcpResultJson>`
    - interpret-impact 返回 { injected, summary } → 摘要注入 implement agent prompt；日志记 injection_status=injected
    - 返回 { skipped, warning }（MCP 不可用/graph-not-built）→ 跳过注入，日志记 injection_status=skipped+warning；**不中止**（FR-012）

  步骤 3：执行 implement 子代理（FR-003）
    - 委派 Task("implement", prompt="{注入后内容}+此为 goal_loop 第{i}轮")
    - **不在 implement prompt 中接受或转发任何达标声明**（FR-010 职责分离）

  步骤 4：选择 verify 模式（FR-007）
    - 调 `goal-loop-cli.mjs select-verify-mode {i} {max_iterations} {aboutToExit=false}` → smoke 或 full

  步骤 5：执行 verify 子代理（FR-010）
    - 委派 Task("verify", prompt="GOAL_LOOP_MODE=round-{i} verify_mode={smoke|full} 此次 verify 由 goal_loop 触发，必须独立实跑所有命令并捕获真实退出码，不得引用 implement agent 任何达标声明，额外输出 {feature_dir}/goal-loop/verification-report-round-{i}.json")
    - 读取 verification-report-round-{i}.json
    - 调 `goal-loop-cli.mjs parse-report verification-report-round-{i}.json` → 解析报告（parseReport）
    - 解析失败（infra-failure）→ 本轮标 infra-failure，记录原因，按 FR-007 计入早停判定

  步骤 6：决策（FR-004 优先级）
    - 调 `goal-loop-cli.mjs decide-stop --round={i} --config={config} --report=... --prev-reports=... --rollback-result=null`
    - 按 decide-stop 输出处置：
      a. exit_reason=ROLLBACK_FAILED → 立即进 GATE_VERIFY，输出失败详情（FR-014）
      b. exit_reason=REGRESSION_ROLLBACK → 调 plan-rollback → 执行回滚命令序列 → 逐条检查退出码（非零→标回滚失败→re-decide）→ 记日志 → 视预算 continue/stop
      c. action=escalate_full（smoke 轮 metric 满足，stop=false、exit_reason=null；Codex C2 修正：smoke 全绿绝不直接判 REACHED_GOAL）→ 强制触发 full verify 一次（plan OQ-03）→ 重跑步骤 4-6（aboutToExit=true，select-verify-mode 返回 full）；full 轮再判达标
      d. exit_reason=REACHED_GOAL（full 模式已确认达标）→ 退出 loop（成功），进 GATE_VERIFY
      e. exit_reason=MAX_ITERATIONS / NO_PROGRESS → 退出 loop（fallback），进 GATE_VERIFY，输出摘要
      f. action=continue → i++，循环

  每轮末尾：追加结构化迭代日志条目（FR-019）：
    { round: i, metric: ..., delta: ..., exit_reason, snapshot: S_i, timestamp }

后置：
  - 释放单实例锁：`goal-loop-cli.mjs release-lock {feature_dir}/goal-loop/.lock`
  - 清理迭代期间创建的 stash entries（非 clean 轮的 S_i.ref → `git stash drop`，严格后置于所有 apply）
```

**reward hacking 诚实标注（FR-023）**：散文中 MUST 包含一段"护栏现状说明"：
> GATE_IMPLEMENT_MID 默认 `on_failure/non_critical`（仅 implement mode）。goal_loop 不依赖 GATE_IMPLEMENT_MID 作为护栏，每轮结束即 verify 已覆盖中途检查价值。真正强护栏：GATE_VERIFY（always/critical）+ Layer 1.5 证据 + Codex 对抗审查。reward hacking/测试过拟合为诚实残留风险（FR-023）。

**依赖**：T021（分派分支）、T018（goal-loop-cli 已可调用）

**对应 FR**：FR-003、FR-004、FR-005、FR-006、FR-007、FR-011、FR-012、FR-013、FR-014、FR-018、FR-019、FR-023

**验收条件**：
1. 散文含编号步骤（1~6），优先级顺序与 FR-004 一致
2. 每步明确调哪个 CLI 子命令
3. 每步明确检查退出码，任一非零如何处置
4. 含 reward hacking 护栏现状诚实说明
5. 格式与 batch_loop 散文风格对齐（编号步骤 + 伪码 + MUST 标记）

---

### T023 — verify.md goal_loop JSON 输出模式（FR-010）[Codex 必须]

**文件**：`plugins/spec-driver/agents/verify.md`（修改）

**改动**：在 verify.md 适当位置（建议在"输出产物"小节末尾）新增独立段落「goal_loop JSON 输出模式」：

```markdown
### goal_loop JSON 输出模式

当编排器 prompt 中注入 `GOAL_LOOP_MODE=round-{i}` 时，除常规 Markdown 验证报告（verification-report.md）外，必须**额外**产出以下结构化 JSON 文件：

文件路径：`{feature_dir}/goal-loop/verification-report-round-{i}.json`

必须字段（schema 定义见 plan.md §2）：
- `round`：轮次号（从 prompt 中提取）
- `timestamp`：ISO 8601 时间戳
- `verify_mode`：`smoke` 或 `full`（从 prompt 的 `verify_mode=` 提取）
- `wall_seconds`：实际耗时（秒）
- `layer2_commands`：每条命令必须含 `name`、`exit_code`（真实退出码，不得缺省）、`status`、`duration_seconds`、`output_summary`、`skipped_reason`
- `layer1_fr_coverage`：`p1_total`、`p1_covered`、`p1_coverage_pct`、`uncovered_fr_ids`
- `layer1_5_evidence`：`status`（COMPLIANT/PARTIAL/EVIDENCE_MISSING）、`detail`
- `regression_check`：`previously_passing_commands`、`now_failing`、`regression_detected`
- `delta_inputs`：`layer2_pass_count`、`p1_fr_coverage_pct`、`layer1_5_status_score`、`regression_count`、`net_loc_delta`

重要约束（职责分离，FR-010 N-01）：
- `layer2_commands[].exit_code` MUST 为命令真实执行退出码，不得基于 implement agent 的任何声明填写
- 缺退出码或无法验证的条目，`status` MUST 填 `UNKNOWN`
- 不改 Layer 1/1.5/2 现有验证逻辑，仅新增 JSON 落盘

降级（goal_loop core parseReport 处理）：
- 若本轮 verify 无法产出合法 JSON（输出截断/schema 非法），goal_loop core 将该轮标 infra-failure
```

**依赖（修正 Codex W-02）**：仅依赖 plan §2 的 verification-report schema（已定），**与 T022 解耦、可并行 [P]**——JSON schema 与 GOAL_LOOP_MODE 触发条件 spec/plan 已固定，不必等 SKILL.md 散文写完。

**对应 FR**：FR-010

**验收条件**：
1. verify.md 中新增段落存在
2. 段落明确：何时触发（GOAL_LOOP_MODE 注入）、输出文件路径、必须字段、职责分离约束
3. 不修改 Layer 1/1.5/2 现有验证逻辑描述

---

### T024 — 迭代日志 e2e/golden-text 接线校验（FR-019）[Codex 必须] [P]

> `formatIterationLogEntry` 纯函数本体的红测（T-GL-21）在 T011、绿在 T017（Phase B）。本 task 是 Phase C 的**接线校验**——确认 T022 散文确实调用了它并把结果写入 iteration-log.md，**不重复实现 core 函数**（修正 Codex Phase 矛盾）。

**文件**：`plugins/spec-driver/tests/goal-loop-core.test.mjs`（修改，新增 golden-text 断言）

**改动**：golden-text 校验 T022 散文含迭代日志接线：

```javascript
// T-GL-21b（FR-019 接线）：SKILL.md 散文调用 formatIterationLogEntry 并写 iteration-log
it('T-GL-21b: 散文含迭代日志接线', () => {
  assert.ok(skillMd.includes('formatIterationLogEntry') || skillMd.includes('迭代日志'));
  assert.ok(skillMd.includes('iteration-log'));
});
```

> 真正的"日志确被写盘且可解析"由 verify 阶段 e2e（跑一轮真实 goal_loop 后断言 iteration-log.md 存在且每块 JSON 可解析）兜底——写盘是 I/O，不在纯函数单测范围。

**依赖**：T022（散文已写迭代日志接线）；可与 T023 并行 [P]

**对应 FR**：FR-019

**对应测试**：T-GL-21b（golden-text）+ e2e（verify 阶段）

---

### T025 — golden-text 校验测试（FR-003/022）[Codex 必须]

**文件**：`plugins/spec-driver/tests/goal-loop-core.test.mjs`（修改）

**改动**：新增 golden-text 校验断言段（独立 describe 块）：

```javascript
// golden-text 校验：SKILL.md 散文含必需步骤与 MUST 标记
describe('goal_loop SKILL.md golden-text 校验', () => {
  const skillMd = fs.readFileSync('plugins/spec-driver/skills/spec-driver-feature/SKILL.md', 'utf-8');

  it('SKILL.md 含 goal_loop 分派分支', () => {
    assert.ok(skillMd.includes('goal_loop'));
    assert.ok(skillMd.includes('decide-dispatch'));
  });
  it('SKILL.md 含编号步骤：建立 snapshot（步骤 1）', () => {
    assert.ok(skillMd.includes('plan-snapshot') || skillMd.includes('snapshot'));
  });
  it('SKILL.md 含 Spectra impact 注入（步骤 2）', () => {
    assert.ok(skillMd.includes('Spectra MCP') || skillMd.includes('impact'));
  });
  it('SKILL.md 含 verify GOAL_LOOP_MODE 注入（步骤 5）', () => {
    assert.ok(skillMd.includes('GOAL_LOOP_MODE'));
  });
  it('SKILL.md 含 decide-stop 调用（步骤 6）', () => {
    assert.ok(skillMd.includes('decide-stop'));
  });
  it('SKILL.md 含 reward hacking 护栏诚实说明（FR-023）', () => {
    assert.ok(skillMd.includes('reward hacking') || skillMd.includes('测试过拟合'));
    assert.ok(skillMd.includes('GATE_VERIFY'));
  });
  it('SKILL.md 含单实例锁 acquire-lock（FR-018）', () => {
    assert.ok(skillMd.includes('acquire-lock'));
  });
});
```

**依赖**：T022（SKILL.md 散文已写完）

**对应 FR**：FR-003、FR-018、FR-022、FR-023

**验收条件**：所有 golden-text 断言通过 vitest

---

### T026 — Codex skills 同步（工程约定）

**文件**：`.codex/skills/spec-driver-feature/SKILL.md`（通过脚本自动同步，**不手动修改**）

**改动**：在 T022 完成后执行：
```bash
bash plugins/spec-driver/scripts/codex-skills.sh install
```

此脚本将 `plugins/spec-driver/skills/spec-driver-feature/SKILL.md` 同步到 `.codex/skills/spec-driver-feature/SKILL.md`（加 wrapper 头）。

**依赖**：T022（source-of-truth 修改完毕）

**对应 FR**：FR-002（plan §3 Source-of-Truth 约定）

**验收条件**：
1. `.codex/skills/spec-driver-feature/SKILL.md` 文件内容与 `plugins/spec-driver/skills/spec-driver-feature/SKILL.md` 同步（含 goal_loop 分支）
2. wrapper 头不含 goal_loop 段（wrapper 自动加，无需关心）

---

### T027 — repo:sync + 全量验证（FR-020）

**执行步骤**：

```bash
# 1. repo sync（修改 plugins/spec-driver/ 后必须）
npm run repo:sync

# 2. 全量验证（SC-005）
npx vitest run                  # T-GL-01~19 全绿 + 现有测试不变
npm run build                   # 零类型错误
npm run repo:check              # 零告警
npm run release:check           # 通过（不涉发布版本号变更）

# 3. 验证 feature mode 行为不回归（FR-020）
node plugins/spec-driver/scripts/orchestrator-cli.mjs get-phases feature   # base 默认 implement.agent_mode=single
node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration feature --annotate
```

**对应 FR**：FR-020

**验收条件**：
1. vitest 全量零失败（含 T-GL-01~T-GL-19 所有新测试）
2. build 零类型错误
3. repo:check 零告警
4. release:check 通过
5. 现有 8 mode 测试（orchestration-resolver、delegation-contract、orchestrator）不变

---

### T028 — Phase C Codex 审查 + 最终提交（FR-022）

**改动**：
- 运行 codex-rescue 子代理，对 Phase C 所有改动（SKILL.md、verify.md、test 补全）进行对抗审查
- 产出 `specs/201-goal-loop-agent-mode/verification/codex-adversarial-review-phase-c.md`
  - 含 CRITICAL/WARNING/INFO 三档计数
  - CRITICAL 全修复才提交
- 修复 CRITICAL 后重跑 T027 验证
- 最终提交（显式路径，禁 `git add -A`，排除 `specs/src.spec.md`）

**对应 FR**：FR-022

---

## FR 覆盖映射表

> 测试归属说明（修正 Codex W-03）：T-GL-01/02/03/04/15 在 `orchestration-resolver.test.mjs`（T007）；T-GL-05~17/19/20/21 是 **core 纯函数测试**，红断言在 **T011**、随对应实现 task 转绿；T-GL-18 文件锁集成在 T019。下表"测试"列标注红/绿 task。

| FR | 覆盖任务（实现） | 测试（红@T011 / 绿@实现，或 T007/T019） |
|----|---------|---------|
| FR-001 | T001 | T-GL-01 @T007 |
| FR-002 | T002、T021 | T-GL-02 @T007 |
| FR-003 | T022 | T-GL-21 @T011/T024；golden-text @T025 |
| FR-004 | T017(decideStop) | T-GL-05/06/13/20 红@T011 绿@T017 |
| FR-005 | T003、T004、T017 | T-GL-06 红@T011 绿@T017 |
| FR-006 | T003、T014(computeDelta)、T017 | T-GL-07/08 红@T011 绿@T014/T017 |
| FR-007 | T003、T004、T016(selectVerifyMode)、T022 | T-GL-16 红@T011 绿@T016；T-GL-20 @T017 |
| FR-008 | T013(evaluateMetric) | T-GL-09 红@T011 绿@T013 |
| FR-009 | T012(classifyCommand)、T013 | T-GL-09/10 红@T011 绿@T012/T013 |
| FR-010 | T008(fixture)、T013(parseReport)、T023(verify.md) | T-GL-11 红@T011 绿@T013 |
| FR-011 | T016(interpretImpactResult)、T022(散文步骤 2) | T-GL-17 红@T011 绿@T016 |
| FR-012 | T016(interpretImpactResult)、T022 | T-GL-17 红@T011 绿@T016 |
| FR-013 | T014(detectRegression)、T015(planSnapshot/Rollback)、T022 | T-GL-12/12b/19 红@T011 绿@T014/T015 |
| FR-014 | T017(decideStop rollback 失败)、T022 | T-GL-13 红@T011 绿@T017 |
| FR-015 | T002、T006 | T-GL-02 @T007 |
| FR-016 | T005、T006 | T-GL-03/04 @T007 |
| FR-017 | T016(decideDispatch) | T-GL-14 红@T011 绿@T016 |
| FR-018 | T018(acquireLock)、T022 | T-GL-18 @T019（集成）；golden-text @T025 |
| FR-019 | T017(formatIterationLogEntry 实现)、T022(散文接线) | T-GL-21 红@T011 绿@T017；接线 T-GL-21b @T024 |
| FR-020 | T027(全量验证) | 现有 mode 测试不变 |
| FR-021 | T007(T-GL-15 字段锁) | T-GL-15 @T007 |
| FR-022 | T009、T020、T028 | 制品存在性校验 |
| FR-023 | T005(模板注释)、T022(散文护栏说明)、T025(golden-text) | golden-text @T025 |

**覆盖率：23/23 FR，100%。core 纯函数 12 个全部有红→绿成对测试。**

---

## 依赖关系与并行机会

### Phase 依赖

```
Phase A（T001~T009）
  → Phase B（T011~T019，依赖 T001/T006/T008）
    → Phase C（T021~T028，依赖 T017/T018）
```

### Phase A 内部并行机会

以下 Phase A 任务可并行执行（无互相依赖）：

- T001、T002、T003 可并行（互不依赖）
- T004 依赖 T003
- T005 依赖 T001、T002
- T006 依赖 T005
- T007（测试）依赖 T001、T005、T006
- T008 独立，可最早并行

**Phase A 最优并行路径**：T001 + T002 + T003 + T008 同时启动 → T004（等 T003）、T005（等 T001/T002）→ T006（等 T005）→ T007（等 T001/T005/T006）

### Phase B 内部顺序（TDD 严格顺序）

T011（测试桩）→ T012（classifyCommand）→ T013（evaluateMetric+parseReport）→ T014（computeDelta+detectRegression）→ T015（planSnapshot+planRollback）→ T016（selectVerifyMode+decideDispatch）→ T017（decideStop）→ T018（CLI）→ T019（集成测试）

**Phase B 不可并行**（TDD 要求先红后绿，逐函数实现）。

### Phase C 内部顺序

T021（分派分支）→ T022（散文主体）→ T023（verify.md，可与 T024 并行）+ T024（T-GL-17 补全）→ T025（golden-text）→ T026（codex-skills.sh）→ T027（全量验证）→ T028（最终 Codex 审查）

### User Story 间依赖

- US-3（git 回滚）依赖 US-1（闭环基础）
- US-4（opt-in）独立，可 Phase A 完整验证
- US-5（Spectra 注入）依赖 US-1 闭环散文就绪

---

## 注意事项与工程约定

### Codex 对抗审查必须节点

以下任务改动 `plugins/spec-driver/` 下代码或测试，每次 commit 前必须运行 Codex 对抗审查（FR-022）：

| 提交节点 | 必须审查的文件 | 产出制品 |
|---------|--------------|---------|
| Phase A commit | T001、T003、T007 | `codex-adversarial-review-phase-a.md` |
| Phase B commit | T011~T019（所有 core/CLI/测试） | `codex-adversarial-review-phase-b.md` |
| Phase C commit | T021~T025（SKILL.md、verify.md、测试补全） | `codex-adversarial-review-phase-c.md` |

### 工程约定（NFR-003）

- **显式路径 commit**：每次 commit 列出精确文件路径，禁 `git add -A`
- **排除 specs/src.spec.md**：自动再生产物，不入库
- **改动后 repo:sync**：修改 `plugins/spec-driver/` 后运行 `npm run repo:sync`
- **提交前全量检查**：`npx vitest run` + `npm run build` + `npm run repo:check` 零失败

### GL-09 细化：max_tool_invocations 计数口径（修正 Codex W-01）

**问题（W-01）**：子代理**内部**的 tool 调用次数主编排器（LLM）**拿不到**（Task 结果的 `usage` 只含 token 数，不含子代理内部 tool 次数）。把不可见数据作为硬验收条件是错的。

**修正口径——只用编排器可观测的数据**：
- `max_tool_invocations` 重定义为**编排器单轮发起的可见委派/工具调用计数**（编排器自己发起的 Task("implement")、Task("verify")、各 `goal-loop-cli.mjs` 子命令调用、MCP impact 调用——这些都是编排器自己发起、可自计数），**不是** verify 子代理内部的 tool 次数。
- 它是一个**粗粒度安全上限**（防编排器在某轮异常打转），不是精确计量器；诚实标注为 best-effort。
- 配套：`max_verify_seconds`（单轮 verify 墙钟，**经 `timeout {N}s` 前缀强制**，可机器校验）是主预算；`max_tool_invocations` 为辅助上限。
- 超限（任一）→ 本轮标 infra-failure，喂 `decide-stop` 的 report.degraded → 计入 NO_PROGRESS 判定（FR-007）。
- **对应实现/测试**：T022 散文步骤 6 前编排器自计数比较；T-GL-20（在 T011/T017）测 `decideStop` 对 infra-failure 输入连续 N 轮 → NO_PROGRESS（这是可测的纯函数路径）。

---

## 执行摘要

**阶段**：任务分解
**状态**：成功
**产出制品**：`specs/201-goal-loop-agent-mode/tasks.md`

**关键数字**：
- 任务总数：28 个任务（T001~T028）
- 阶段划分：Phase A（10 任务）+ Phase B（10 任务）+ Phase C（8 任务）
- 覆盖 FR：23/23（100%）
- 覆盖测试：19 个（T-GL-01~19 全部映射到具体任务）
- Phase A 可并行：T001/T002/T003/T008 四任务可同时启动（约 40% Phase A 并行度）
- Phase B 严格串行（TDD 要求）
- Phase C 部分并行：T023+T024 可并行

**关键依赖链**：
`T001（schema enum）→ T005（golden 模板）→ T006（fixture）→ T007（resolver 测试）→ T011（测试桩）→ T012~T017（core 逐函数 TDD）→ T018（CLI）→ T021~T022（SKILL.md 散文）→ T025（golden-text 校验）→ T027（全量验证）`

**最大执行风险**：

1. **T022（SKILL.md 散文）是最高风险任务**：散文块的 LLM 解释质量直接决定 goal_loop 闭环是否在实际编排时正确执行。缓解：core 纯函数 100% 单测（已在 Phase B 覆盖）把确定性逻辑移出散文；T025 golden-text 校验守护散文必需步骤；Codex 对抗审查兜底。
2. **T007 T-GL-03 逐字段等价断言**：golden 模板须覆盖 base feature 的所有 phase（整段替换语义），若 base 有未覆盖 phase，测试会失败。执行前需用 `orchestrator-cli get-phases feature` 拉完整 phase 列表。
3. **CLI 子命令契约一致性**：T022 散文调用的每个 `goal-loop-cli.mjs <子命令>` 必须与 T018 清单逐字对齐（parse-report / decide-stop / plan-snapshot / plan-rollback / select-verify-mode / decide-dispatch / interpret-impact / acquire-lock / release-lock）。T025 golden-text 校验断言散文只调用清单内子命令名，防止实现期接口漂移。
