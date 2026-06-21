# Tasks: F203 — goal_loop core 两处缺陷修复

**输入**: specs/203-fix-goal-loop-snapshot-smoke/fix-report.md + plan.md（权威，含 Codex 对抗审查修订）
**输出**: 本文件（specs/203-fix-goal-loop-snapshot-smoke/tasks.md）
**模式**: fix（最小变更，TDD 排序）
**日期**: 2026-06-21

---

## 任务格式说明

- `[P]` = 可与同阶段其他 [P] 任务并行（不同文件、无依赖）
- 每个任务包含：编号、标题、动作、产出文件、依赖、验收
- 严格 TDD：先写/改测试（红态确认），再实现（绿态验证）
- 任务编号从 T201 起（延续 plan.md 中约定的风格）

---

## ⚠️ Phase 2 Codex 审查修订（实现 must-fix，权威，凡与下方任务正文冲突以此为准）

第二轮 Codex 对抗审查（plan+tasks）结论"需修订"，以下 6 项为实现阶段硬性补强，已就地修订相关任务，实现时务必落实：

1. **smoke vitest selector 覆盖全部非 e2e project（WARNING #3b）**：仓库 vitest.config 有 5 个 project：`unit/integration/golden-master/self-hosting/e2e`。smoke"排除 e2e 实跑其余"必须覆盖 **unit+integration+golden-master+self-hosting** 四个（不能只写 unit+integration）。命令：`npx vitest run --project unit --project integration --project golden-master --project self-hosting`（或 vitest 支持的 `--project '!e2e'` 等价排除）。涉及 T201/T215/T216 与新 fixture 命令名。
2. **full 轮 `dist_not_built` SKIPPED → infra-failure 真正闭合（WARNING #7）**：新增 core 行为——`parseReport` 检测 `verify_mode==='full'` 且任一命令 `skipped_reason==='dist_not_built'` → 返回 `{degraded:'infra-failure', reason:'full verify 不应出现 dist_not_built（full 必须先 build）'}`。新增 fixture `report-full-skipped-dist.json` + 测试**断言 `degraded==='infra-failure'`**（不能只断言"非 REACHED_GOAL"）。见修订后 T202b / T207 / T211b-parse。
3. **parsePreservedConfigStates 处理 rename/quoted path（WARNING #5）**：解析须显式处理 `R  old -> new`（取目标路径，归类 staged）与带引号/转义路径；test 增 rename 行用例。见 T205b/T211。
4. **集成测试用 shell 执行命令字符串，非 execFileSync 拆 argv（WARNING #6，关键）**：core 返回的是**给 shell 执行的命令字符串**（含 `:(exclude)` pathspec、引号）。T213 必须用 `execSync(cmdString, {cwd, encoding:'utf-8'})`（经 /bin/sh）逐条执行规划出的命令字符串（先替换 `{i}`→`'1'`、`{stash_ref}`→实跑 rev-parse 结果），**禁止** `execFileSync('git', splitArgv)`（无法安全拆带引号 pathspec）。
5. **多 preserved path 可注入（WARNING #6 配套）**：`planSnapshotCommands`/`planRollbackCommands` 增可选第二参 `preservedPaths = PRESERVED_CONFIG_PATHSPECS`（默认不变，生产行为不变），使 T213 `multi-preserved-paths` 用例能注入 2 个路径验证多 argv 展开。
6. **full 轮 timeout 口径（WARNING #4）**：T215/T216 prose 明确 `max_verify_seconds` 为 **per-command**；full 补 vitest 后最坏耗时 ≈ Σ(build, vitest, lint, repo:check) 各自上限，需在 prose 注明并确认 lock/no-progress 预算可接受。

**关于 evaluateSmokeReadiness 命令集完整性（WARNING #3a）**：评估为**低危、有意不在 core 做命令名校验**——smoke readiness 仅触发非权威 escalate，full 轮严格门禁（先 build + 跑全量 vitest）才是权威，退化 smoke 至多多一次 full verify，绝不会假 REACHED_GOAL。命令集完整性由 verify.md 契约（mandate smoke 必跑命令集）负责，不让 core 耦合命令名。此为有意权衡，已在 verify.md 注明。

---

## Phase 1: Fixture 准备（无依赖，可优先建立）

**目标**: 在编写任何实现前先建好测试 fixture，让后续单测有真实数据可引用

**独立验证**: `ls plugins/spec-driver/tests/fixtures/goal-loop/report-smoke-skipped-e2e.json plugins/spec-driver/tests/fixtures/goal-loop/report-smoke-fail-real.json` 均存在且 JSON 合法

---

- [ ] T201 [P] 新建 fixture `report-smoke-skipped-e2e.json`

  **动作**: 新建文件，内容为 smoke 模式 report，layer2_commands 包含：
  - `tsc --noEmit`（exit_code=0, status=PASS）
  - `npx vitest run --project unit --project integration --project golden-master --project self-hosting`（**全部非 e2e project，修订 #1**）（exit_code=0, status=PASS）
  - `npx vitest run --project e2e`（exit_code=null, status=SKIPPED, skipped_reason="dist_not_built"）
  - p1_coverage_pct=100，layer1_5_evidence.status="COMPLIANT"

  **产出文件**: `plugins/spec-driver/tests/fixtures/goal-loop/report-smoke-skipped-e2e.json`

  **依赖**: 无

  **验收**:
  ```bash
  node -e "JSON.parse(require('fs').readFileSync('plugins/spec-driver/tests/fixtures/goal-loop/report-smoke-skipped-e2e.json','utf8'))" && echo OK
  ```
  期望输出 `OK`，无 JSON 解析错误。

---

- [ ] T202 [P] 新建 fixture `report-smoke-fail-real.json`

  **动作**: 新建文件，内容为 smoke 模式 report，layer2_commands 包含：
  - `tsc --noEmit`（exit_code=1, status=FAIL）
  - `npx vitest run --project e2e`（exit_code=null, status=SKIPPED, skipped_reason="dist_not_built"）
  - p1_coverage_pct=100，layer1_5_evidence.status="COMPLIANT"

  **产出文件**: `plugins/spec-driver/tests/fixtures/goal-loop/report-smoke-fail-real.json`

  **依赖**: 无

  **验收**:
  ```bash
  node -e "JSON.parse(require('fs').readFileSync('plugins/spec-driver/tests/fixtures/goal-loop/report-smoke-fail-real.json','utf8'))" && echo OK
  ```
  期望输出 `OK`。

---

- [ ] T202b [P] 新建 fixture `report-full-skipped-dist.json`（修订 #2，full 契约违反）

  **动作**: 新建 full 模式 report，layer2_commands 含一条 `{name:"npx vitest run --project e2e", exit_code:null, status:"SKIPPED", skipped_reason:"dist_not_built"}`（full 轮不应出现，用于验证 parseReport 降级为 infra-failure），其余字段（npm run build PASS 等）齐全合法。

  **产出文件**: `plugins/spec-driver/tests/fixtures/goal-loop/report-full-skipped-dist.json`

  **依赖**: 无

  **验收**:
  ```bash
  node -e "JSON.parse(require('fs').readFileSync('plugins/spec-driver/tests/fixtures/goal-loop/report-full-skipped-dist.json','utf8'))" && echo OK
  ```
  期望输出 `OK`。

---

## Phase 2: 单测红态——更新既有断言 + 新增单测（在实现前先跑至红）

**目标**: 在修改 goal-loop-core.mjs 之前，先把单测更新成"期望新行为"的状态，运行后确认这些用例失败（红态），再进入实现阶段。

**独立验证**: `node --test plugins/spec-driver/tests/goal-loop-core.test.mjs 2>&1 | grep -E "fail|Error"` 有输出（新/改用例红态），既有无关用例仍绿。

---

- [ ] T203 更新 `planSnapshotCommands` 的 deepEqual 断言（T-GL-19 对应）

  **动作**: 在 `plugins/spec-driver/tests/goal-loop-core.test.mjs` 中找到 `planSnapshotCommands` isClean=false 的 deepEqual 断言，更新为含 pathspec 排除的期望序列：
  ```js
  [
    'git stash push --include-untracked -m "goal_loop-S{i}" -- . \':(exclude).specify/orchestration-overrides.yaml\'',
    'git rev-parse stash@{0}',
    'git stash apply --index {stash_ref}',
  ]
  ```
  isClean=true 仍期望 `[]`，断言不变。

  **产出文件**: `plugins/spec-driver/tests/goal-loop-core.test.mjs`（修改）

  **依赖**: T201、T202（fixture 已存在）

  **验收（红态）**:
  ```bash
  node --test plugins/spec-driver/tests/goal-loop-core.test.mjs 2>&1 | grep -c "planSnapshotCommands"
  ```
  期望该测试块失败（当前 core 输出旧命令，断言不匹配）。

---

- [ ] T204 更新 `planRollbackCommands` 的 deepEqual 断言（T-GL-12b 对应）

  **动作**: 在 `plugins/spec-driver/tests/goal-loop-core.test.mjs` 中找到 `planRollbackCommands` clean=false 和 clean=true 的 deepEqual 断言，更新为含 `-e` 排除的期望序列：

  clean=false 期望：
  ```js
  [
    'git reset --hard HEAD',
    "git clean -fd -e '.specify/orchestration-overrides.yaml'",
    `git stash apply --index ${VALID_SHA_2}`,
  ]
  ```
  clean=true 期望：
  ```js
  [
    'git reset --hard HEAD',
    "git clean -fd -e '.specify/orchestration-overrides.yaml'",
  ]
  ```

  **产出文件**: `plugins/spec-driver/tests/goal-loop-core.test.mjs`（修改）

  **依赖**: T203（同文件，顺序编辑）

  **验收（红态）**:
  ```bash
  node --test plugins/spec-driver/tests/goal-loop-core.test.mjs 2>&1 | grep -c "planRollbackCommands"
  ```
  期望该测试块失败。

---

- [ ] T205 新增 `assessPreservedConfigSafety` 单测（8 个用例，porcelain 解析各状态）

  **动作**: 在 `plugins/spec-driver/tests/goal-loop-core.test.mjs` 末尾新增 `describe('assessPreservedConfigSafety', ...)` 块，覆盖以下用例（entries 形式：`[{path, state}]`，state 值由调用方从 porcelain 解析后传入）：

  | 用例 | 输入 entries | 期望 |
  |------|-------------|------|
  | absent → 安全 | `[{path:'…yaml', state:'absent'}]` | `{safe:true, unsafe:[]}` |
  | untracked → 安全 | `[{path:'…yaml', state:'untracked'}]` | `{safe:true, unsafe:[]}` |
  | tracked-clean → 安全 | `[{path:'…yaml', state:'tracked-clean'}]` | `{safe:true, unsafe:[]}` |
  | staged → 不安全 | `[{path:'…yaml', state:'staged'}]` | `{safe:false, unsafe:[{path,state,reason}]}` |
  | tracked-modified → 不安全 | `[{path:'…yaml', state:'tracked-modified'}]` | `{safe:false, unsafe:[{path,state,reason}]}` |
  | 多 path 全安全 | `[{…,state:'untracked'},{…,state:'absent'}]` | `{safe:true, unsafe:[]}` |
  | 多 path 一个不安全 | `[{…,state:'untracked'},{…,state:'staged'}]` | `{safe:false, unsafe}` 仅含 staged 项 |
  | 空数组 → 安全 | `[]` | `{safe:true, unsafe:[]}` |

  注：`assessPreservedConfigSafety(entries)` 只做"状态→安全"分类；**porcelain 原始文本→state 的解析必须另由 core 纯函数 `parsePreservedConfigStates` 承担并单测**（见 T205b / T211），不得落在 SKILL.md prose（主线程精化 #2 / Codex 风险 #3）。

  **产出文件**: `plugins/spec-driver/tests/goal-loop-core.test.mjs`（修改）

  **依赖**: T204

  **验收（红态）**:
  ```bash
  node --test plugins/spec-driver/tests/goal-loop-core.test.mjs 2>&1 | grep -E "assessPreservedConfigSafety.*fail"
  ```
  期望 8 个新用例均失败（函数尚未实现）。

---

- [ ] T205b 新增 `parsePreservedConfigStates` 单测（raw porcelain → entries，主线程精化 #2）

  **动作**: 在 `plugins/spec-driver/tests/goal-loop-core.test.mjs` 新增 `describe('parsePreservedConfigStates', ...)` 块。**输入为真实 `git status --porcelain` 文本字符串**（非预解析对象），验证解析到正确 state 枚举。覆盖 porcelain v1 各状态行：

  | 用例 | porcelain 输入（针对 `.specify/orchestration-overrides.yaml`） | 期望 state |
  |------|------|-----------|
  | 未跟踪 | `?? .specify/orchestration-overrides.yaml\n` | `untracked` |
  | 路径不在输出（不存在/tracked 干净）| `` 或仅含其他路径 | `absent`（视为安全；tracked-clean 同样不出现，合并按安全处理） |
  | index 暂存修改 | `M  .specify/orchestration-overrides.yaml\n` | `staged` |
  | 新增已暂存 | `A  .specify/orchestration-overrides.yaml\n` | `staged` |
  | 暂存+工作区均改 | `MM .specify/orchestration-overrides.yaml\n` | `staged`（index 列非空即 staged 优先） |
  | 仅工作区修改（未暂存）| ` M .specify/orchestration-overrides.yaml\n` | `tracked-modified` |
  | 多 path 混合 | 两路径不同状态 | 各自正确 state |
  | 含引号/特殊路径（porcelain 对含空格路径加引号）| `?? ".specify/has space.yaml"\n` | 正确去引号匹配 |

  **实现约束**: 解析必须基于 porcelain v1 的固定列格式（前两字符 XY + 空格 + 路径），不靠脆弱正则猜测；对 rename（`R `）等列保守归类为 staged。

  **产出文件**: `plugins/spec-driver/tests/goal-loop-core.test.mjs`（修改）

  **依赖**: T205

  **验收（红态）**:
  ```bash
  node --test plugins/spec-driver/tests/goal-loop-core.test.mjs 2>&1 | grep -E "parsePreservedConfigStates"
  ```
  期望新用例失败（函数尚未实现）。

---

- [ ] T206 新增 `evaluateSmokeReadiness` 单测（6 个用例）

  **动作**: 在 `plugins/spec-driver/tests/goal-loop-core.test.mjs` 新增 `describe('evaluateSmokeReadiness', ...)` 块，覆盖：

  | 用例 | 场景 | 期望 |
  |------|------|------|
  | 全 SKIPPED（vacuous 防护 C3）| layer2 全 `status:'SKIPPED'`，无非 SKIPPED 命令 | `false` |
  | 非 SKIPPED 有 FAIL | 含 `status:'FAIL'` 非 SKIPPED 命令 | `false` |
  | ≥1 非 SKIPPED PASS + 其余 SKIPPED → escalate | 使用 fixture `report-smoke-skipped-e2e.json` | `true` |
  | p1_coverage_pct !== 100 | p1=80 | `false` |
  | layer1_5 非 COMPLIANT | evidence.status='UNKNOWN' | `false` |
  | UNKNOWN 命令存在 → 不 escalate | 含 `status:'UNKNOWN'`（非 SKIPPED 且非 PASS）| `false` |

  **产出文件**: `plugins/spec-driver/tests/goal-loop-core.test.mjs`（修改）

  **依赖**: T205（同文件，继续追加）

  **验收（红态）**:
  ```bash
  node --test plugins/spec-driver/tests/goal-loop-core.test.mjs 2>&1 | grep -E "evaluateSmokeReadiness.*fail"
  ```
  期望 6 个新用例均失败（函数尚未实现）。

---

- [ ] T207 新增 `decideStop` 新场景单测（含 C1 回归保护，4 个用例）

  **动作**: 在 `plugins/spec-driver/tests/goal-loop-core.test.mjs` 的 `decideStop` describe 块中追加以下用例：

  | 用例 | 场景 | 期望 |
  |------|------|------|
  | smoke 含 SKIPPED e2e + 非 e2e 全 PASS → escalate_full | 使用 fixture `report-smoke-skipped-e2e.json`，未降级，非末轮 | `action==='escalate_full'` |
  | smoke 全 SKIPPED → 不 escalate（vacuous 防护） | layer2 全 SKIPPED，p1=100，COMPLIANT | `action !== 'escalate_full'` |
  | full 含 SKIPPED 命令 → 永不 REACHED_GOAL | verify_mode='full'，含 SKIPPED 命令 | `exit_reason !== 'REACHED_GOAL'` |
  | full 报告 → 永不 escalate_full（C1 回归）| verify_mode='full'，p1=100，COMPLIANT，全 PASS | `action !== 'escalate_full'`（必须是 `REACHED_GOAL`）|
  | **既有 report-smoke-pass.json（全 PASS）仍 escalate_full（不回归，修订 Codex#2）** | smoke 全 PASS 在新结构下走 evaluateSmokeReadiness | `action==='escalate_full'` |
  | **既有 round==max smoke 仍 escalate（不回归，修订 Codex#2）** | round===max_iterations 的 smoke pass | `action==='escalate_full'`（escalate 优先于 MAX_ITERATIONS）|

  **另在 `parseReport` describe 块新增（修订 #2，omission #7 真闭合）**：用 fixture `report-full-skipped-dist.json` 断言 `parseReport(text).degraded === 'infra-failure'`（**不是**只测"非 REACHED_GOAL"——必须断言契约违反降级）；并补一条 smoke 轮 dist_not_built SKIPPED **不**降级（`parseReport` 返回 `{report}`）的对照用例。

  **产出文件**: `plugins/spec-driver/tests/goal-loop-core.test.mjs`（修改）

  **依赖**: T206（同文件，继续追加）

  **验收（红态）**:
  ```bash
  node --test plugins/spec-driver/tests/goal-loop-core.test.mjs 2>&1 | grep -c "fail"
  ```
  期望有新失败用例（其中 C1 回归测试依赖 decideStop 重构，当前路径未变，可能暂绿——重点是 "smoke SKIPPED e2e → escalate_full" 新路径测试红）。

---

## Phase 3: core 实现——修改 goal-loop-core.mjs

**目标**: 实现缺陷 1（pathspec 排除 + preflight）和缺陷 2（evaluateSmokeReadiness + decideStop 重构），使 Phase 2 的红态测试转绿。

**独立验证**: `node --test plugins/spec-driver/tests/goal-loop-core.test.mjs` 全部 PASS（≥92 既有 + 新增用例）。

---

- [ ] T208 引入 `PRESERVED_CONFIG_PATHSPECS` 常量（缺陷 1 前置）

  **动作**: 在 `plugins/spec-driver/scripts/lib/goal-loop-core.mjs` 顶部导出区域新增模块级常量：
  ```js
  /** goal_loop 循环配置路径——跨快照保留，不得被 stash/clean 触碰 */
  export const PRESERVED_CONFIG_PATHSPECS = [
    '.specify/orchestration-overrides.yaml',
  ];
  ```
  该常量作为 `planSnapshotCommands` / `planRollbackCommands` 的命令生成依据，同时暴露给测试和 CLI。

  **产出文件**: `plugins/spec-driver/scripts/lib/goal-loop-core.mjs`（修改）

  **依赖**: T203、T204（断言已准备好）

  **验收**:
  ```bash
  node -e "import('./plugins/spec-driver/scripts/lib/goal-loop-core.mjs').then(m=>console.log(m.PRESERVED_CONFIG_PATHSPECS))"
  ```
  期望输出 `[ '.specify/orchestration-overrides.yaml' ]`。

---

- [ ] T209 修改 `planSnapshotCommands`——加 pathspec 排除（缺陷 1）

  **动作**: 修改 `plugins/spec-driver/scripts/lib/goal-loop-core.mjs` 中的 `planSnapshotCommands(isClean, preservedPaths = PRESERVED_CONFIG_PATHSPECS)`（**新增可选第二参，默认常量，生产行为不变，仅供测试注入多路径——修订 #5**）：
  - isClean=true 仍返回 `[]`（不变）
  - isClean=false 时，stash 命令从 `preservedPaths` 展开多个独立 `':(exclude)<path>'` argv，拼成：
    ```
    git stash push --include-untracked -m "goal_loop-S{i}" -- . ':(exclude).specify/orchestration-overrides.yaml'
    ```
  - **禁止** join 成单字符串：多 preserved path 时，每个排除项是独立 token（数组中独立字符串元素）
  - 保持后两条命令不变：`git rev-parse stash@{0}` 和 `git stash apply --index {stash_ref}`

  **产出文件**: `plugins/spec-driver/scripts/lib/goal-loop-core.mjs`（修改）

  **依赖**: T208

  **验收**:
  ```bash
  node --test plugins/spec-driver/tests/goal-loop-core.test.mjs 2>&1 | grep -E "planSnapshotCommands.*ok|✓.*planSnapshot"
  ```
  期望 T-GL-19 对应断言变绿。

---

- [ ] T210 修改 `planRollbackCommands`——加 `-e` 排除（缺陷 1）

  **动作**: 修改 `plugins/spec-driver/scripts/lib/goal-loop-core.mjs` 中的 `planRollbackCommands(S_i, preservedPaths = PRESERVED_CONFIG_PATHSPECS)`（**新增可选第二参，默认常量，生产行为不变——修订 #5**）：
  - `git clean -fd` 替换为展开 `preservedPaths` 的多个独立 `-e <path>` argv，例如：
    `"git clean -fd -e '.specify/orchestration-overrides.yaml'"`
  - 多 preserved path 时，每个 `-e <path>` 是独立字符串 token，禁止 join
  - clean=true 和 clean=false 路径的 base 命令均使用新形式
  - `git reset --hard HEAD` 不变，`git stash apply --index ${S_i.ref}` 不变

  **产出文件**: `plugins/spec-driver/scripts/lib/goal-loop-core.mjs`（修改）

  **依赖**: T209

  **验收**:
  ```bash
  node --test plugins/spec-driver/tests/goal-loop-core.test.mjs 2>&1 | grep -E "planRollbackCommands.*ok|✓.*planRollback"
  ```
  期望 T-GL-12b 对应断言变绿。

---

- [ ] T211 新增 `assessPreservedConfigSafety` 纯函数并导出（缺陷 1 preflight）

  **动作**: 在 `plugins/spec-driver/scripts/lib/goal-loop-core.mjs` 中新增并导出函数：
  ```js
  /**
   * 检查 preserved config 路径是否处于安全状态（preflight 守护，缺陷 1）
   * @param {{ path: string, state: 'absent'|'untracked'|'tracked-clean'|'tracked-modified'|'staged' }[]} entries
   *   由编排器调用 `git status --porcelain -- <paths>` 并解析后传入
   * @returns {{ safe: boolean, unsafe: { path: string, state: string, reason: string }[] }}
   */
  export function assessPreservedConfigSafety(entries) { ... }
  ```
  规则：
  - `absent`/`untracked`/`tracked-clean` → 安全
  - `staged`/`tracked-modified` → 不安全，推入 unsafe 数组，reason 说明"该状态会被 git reset --hard 摧毁"
  - entries=[] → `{safe:true, unsafe:[]}`
  - safe = unsafe.length === 0

  **同时新增并导出 `parsePreservedConfigStates(porcelainText, preservedPaths)`（主线程精化 #2，把脆弱解析放进可单测 core）**：
  ```js
  /**
   * 解析 `git status --porcelain -- <paths>` 文本为 preserved config 状态数组
   * @param {string} porcelainText  git status --porcelain 原始 stdout
   * @param {string[]} preservedPaths  需检查的路径（如 PRESERVED_CONFIG_PATHSPECS）
   * @returns {{ path: string, state: 'absent'|'untracked'|'tracked-clean'|'tracked-modified'|'staged' }[]}
   */
  export function parsePreservedConfigStates(porcelainText, preservedPaths) { ... }
  ```
  规则（porcelain v1 固定列：XY + 空格 + 路径，含空格路径带引号）：
  - 路径未出现在输出 → `absent`（tracked-clean 同样不出现，统一按安全归类）
  - `??` → `untracked`
  - index 列（X）非空非 `?` → `staged`（含 `M `/`A `/`MM`/`AM` 等，index 有暂存即 staged 优先）
  - 仅工作区列（Y）非空、index 列为空格 → `tracked-modified`（如 ` M`）
  - **rename/copy 行 `R `/`C `（修订 #3）**：格式为 `R  old -> new`，须取**两端路径**（old 与 new）分别匹配 preservedPaths，命中任一即归类 `staged`（preserved config 被 rename 即视为不安全）
  - **quoted/escaped 路径（修订 #3）**：porcelain 对含特殊字符路径加双引号并 C-style 转义（如 `"\303\251"`）；匹配前须去引号 + 反转义。我们的 preserved path 是简单 ASCII 不会被引号化，但 parser 须健壮处理引号包裹形式，避免误判 absent。
  - 路径（去引号/反转义后）精确匹配 preservedPaths

  porcelain 解析**只在此 core 函数**，SKILL.md prose 不再自行解析（只负责跑 `git status --porcelain` 把原文喂给 CLI）。

  **同时（修订 #2）在 `parseReport` 增 full 契约校验**：检测 `report.verify_mode === 'full'` 且任一 `layer2_commands[].skipped_reason === 'dist_not_built'` → 返回 `{ degraded:'infra-failure', reason:'full verify 不应出现 dist_not_built SKIPPED（full 必须先 build）' }`（在现有 schema 校验之后、返回 `{report}` 之前插入）。smoke 轮的 dist_not_built SKIPPED 正常放行（不降级）。

  **产出文件**: `plugins/spec-driver/scripts/lib/goal-loop-core.mjs`（修改）

  **依赖**: T210

  **验收**:
  ```bash
  node --test plugins/spec-driver/tests/goal-loop-core.test.mjs 2>&1 | grep -E "assessPreservedConfigSafety|parsePreservedConfigStates"
  ```
  期望 `assessPreservedConfigSafety`（8）+ `parsePreservedConfigStates`（解析各状态）用例全部 PASS。

---

- [ ] T212 新增 `evaluateSmokeReadiness` 并重构 `decideStop` 优先级 3（缺陷 2）

  **动作**: 在 `plugins/spec-driver/scripts/lib/goal-loop-core.mjs` 中：

  **Step A — 新增 `evaluateSmokeReadiness`**：
  ```js
  /**
   * 判定 smoke 报告是否满足 escalate_full 条件（非权威触发，缺陷 2）
   * @param {Object} report
   * @returns {boolean}
   */
  export function evaluateSmokeReadiness(report) { ... }
  ```
  判据：
  - `report.layer1_fr_coverage.p1_coverage_pct === 100`
  - `report.layer1_5_evidence.status === 'COMPLIANT'`
  - 所有**非 SKIPPED** layer2 命令均为 PASS（SKIPPED 不阻塞）
  - ≥1 条非 SKIPPED 命令（vacuous-truth 防护 C3）
  - UNKNOWN 命令视为"非 SKIPPED 且非 PASS"→ 不满足

  **Step B — 重构 `decideStop` 优先级 3**（干净结构，按主线程精化要求）：

  将原 `if (!isDegraded && evaluateMetric(report)) { ... }` 块替换为：
  ```js
  // 优先级 3（重构后，主线程精化）
  if (!isDegraded) {
    if (report.verify_mode === 'full') {
      if (evaluateMetric(report)) {
        return { stop: true, exit_reason: 'REACHED_GOAL', action: 'goto_gate_verify' };
      }
      // full 未达标 → 继续后续优先级
    } else {
      // smoke / 非 full 分支（C1 不变量：escalate_full 仅此路径返回）
      if (evaluateSmokeReadiness(report)) {
        return { stop: false, exit_reason: null, action: 'escalate_full' };
      }
      // smoke 未满足 evaluateSmokeReadiness → 继续后续优先级
    }
  }
  ```

  **C1 不变量保证**：`evaluateSmokeReadiness` 调用**严格**在 `verify_mode !== 'full'` 分支（else 分支）内，full 报告走 `evaluateMetric` 路径，从纯函数层面不存在 full → escalate_full 路径。

  **注意**：原有 `report-smoke-pass.json`（verify_mode=smoke，全 PASS，p1=100，COMPLIANT）需确认仍能触发 escalate_full——在新结构中：`evaluateSmokeReadiness(report-smoke-pass)` 应为 true（全 PASS 满足"非 SKIPPED 均 PASS 且 ≥1"），故该 fixture 既有测试不回归。

  **产出文件**: `plugins/spec-driver/scripts/lib/goal-loop-core.mjs`（修改）

  **依赖**: T211

  **验收**:
  ```bash
  node --test plugins/spec-driver/tests/goal-loop-core.test.mjs
  ```
  期望全部（≥92 既有 + 新增）PASS，零失败。

---

## Phase 4: 集成测试——新建真实 git 集成测试文件

**目标**: 用真实 git 命令验证 stash/clean 的文件系统副作用，补全 Codex omission 清单 #2 要求的 8 个场景。

**独立验证**: `node --test plugins/spec-driver/tests/goal-loop-snapshot-rollback-integration.test.mjs` 全部 PASS。

---

- [ ] T213 新建 `goal-loop-snapshot-rollback-integration.test.mjs`（8 个集成用例）

  **动作**: 新建 `plugins/spec-driver/tests/goal-loop-snapshot-rollback-integration.test.mjs`，包含以下 8 个用例（每个用例独立 temp dir，用 `node:os.tmpdir()` + unique subdir，`finally` 块 `fs.rmSync(tmpDir, {recursive:true, force:true})`，命令用 `node:child_process.execFileSync` 执行，超时 10s）：

  | 用例标签 | 场景 | 验证副作用 |
  |---------|------|-----------|
  | `untracked-X-survives-snapshot` | 创建 `.specify/orchestration-overrides.yaml`（untracked），执行 planSnapshotCommands(false) 产出的 stash 命令（替换占位符） | stash push 后 X 文件仍存在（pathspec 排除成功，X 不被 stash 卷走） |
  | `tracked-staged-X-preflight-blocks` | 新建 X 并 git add（staged），调 `assessPreservedConfigSafety([{path, state:'staged'}])` | 返回 safe=false，不执行 stash，X 不丢失 |
  | `new-staged-X-preflight-blocks` | `echo content > X && git add X`（new-staged），调 `assessPreservedConfigSafety` | 同上 |
  | `isClean-true-no-commands` | 干净仓库（无 untracked/staged），planSnapshotCommands(true) | 返回 []，执行 [] 不出错，X 不受影响 |
  | `multi-preserved-paths-both-survive` | 两个 preserved path 均为 untracked，执行 snapshot stash | stash 命令含两个独立 argv 排除项（展开不 join），两个文件均存活 |
  | `stash-apply-index-full-roundtrip` | snapshot 后改代码（echo change >> tracked-file.js），rollback 后 | 改动消失（tracked file 还原），X 存活（clean -e 排除） |
  | `clean-fd-minus-e-protects-X` | rollback 时 X 为 untracked，执行 planRollbackCommands 产出的 clean 命令 | X 在 `git clean -fd -e '<path>'` 后仍存在 |
  | `multiple-minus-e-both-survive` | 两个 preserved path，执行 rollback 的 clean 命令（两个 -e 参数） | 两个文件均存活 |

  **实现约束**:
  - **用 shell 执行 core 规划出的命令字符串（修订 #4，关键）**：`execSync(cmdString, {cwd:tmpDir, encoding:'utf-8'})`——core 返回的是给 shell 跑的命令字符串（含 `:(exclude)` pathspec + 引号），经 /bin/sh 解析才正确；**禁止** `execFileSync('git', splitArgv)`（无法安全拆带引号 pathspec）。固定命令（git init/config/add/commit、断言用的 ls/cat）可用 execFileSync。
  - 多 path 用例用注入参数（修订 #5）：`planSnapshotCommands(false, ['.specify/orchestration-overrides.yaml', '.other/keep.yaml'])` 等，验证多个独立 `':(exclude)'`/`-e` argv 均生效。
  - 每 test case 独立 temp dir；支持 `TEST_TMPDIR`（`const base = process.env.TEST_TMPDIR || os.tmpdir()`）
  - git init 后需 `git config user.email` + `git config user.name`（否则 commit 失败）
  - 占位符替换：snapshot 命令中 `{i}`→`'1'`，`{stash_ref}`→实跑 `git rev-parse stash@{0}` 的输出；rollback 命令中 ref 占位→实际 40-hex SHA

  **产出文件**: `plugins/spec-driver/tests/goal-loop-snapshot-rollback-integration.test.mjs`（新建）

  **依赖**: T212（core 实现完毕后才能验证副作用正确）

  **验收**:
  ```bash
  node --test plugins/spec-driver/tests/goal-loop-snapshot-rollback-integration.test.mjs
  ```
  期望全部 8 个用例 PASS，无 FAIL/SKIP（非超时）。

---

## Phase 5: CLI 暴露——goal-loop-cli.mjs 新增子命令

**目标**: 把 `assessPreservedConfigSafety` 暴露为 CLI 子命令，供编排器（SKILL.md 散文）在 shell 层调用。

**独立验证**: `echo '[{"path":".specify/orchestration-overrides.yaml","state":"staged"}]' | node plugins/spec-driver/scripts/goal-loop-cli.mjs assess-preserved-config-safety -` 输出 JSON 含 `safe:false`。

---

- [ ] T214 在 `goal-loop-cli.mjs` 新增 `assess-preserved-config-safety` 子命令

  **动作**: 修改 `plugins/spec-driver/scripts/goal-loop-cli.mjs`，让 CLI **吃原始 `git status --porcelain` 文本**（解析在 core，编排器零解析）：
  1. 顶部注释 `Usage` 节追加：
     ```
     *   node goal-loop-cli.mjs assess-preserved-config-safety <porcelainFile|-（stdin）>
     *     # 输入 = `git status --porcelain -- <PRESERVED_CONFIG_PATHSPECS>` 原始 stdout
     *     # CLI 内部 parsePreservedConfigStates(porcelain, PRESERVED_CONFIG_PATHSPECS) → assessPreservedConfigSafety
     ```
  2. dispatch switch 追加 case（读原始 porcelain 文本，用常量做 preservedPaths，core 解析+判定）：
     ```js
     case 'assess-preserved-config-safety': {
       const porcelain = args[0] === '-' ? readStdin() : fs.readFileSync(args[0], 'utf-8');
       const entries = parsePreservedConfigStates(porcelain, PRESERVED_CONFIG_PATHSPECS);
       output(assessPreservedConfigSafety(entries));
       break;
     }
     ```
  3. import 行补充 `assessPreservedConfigSafety`、`parsePreservedConfigStates`、`PRESERVED_CONFIG_PATHSPECS` 导入
  4. 如需 `readStdin()` helper（同步读 fd 0）则新增

  **产出文件**: `plugins/spec-driver/scripts/goal-loop-cli.mjs`（修改）

  **依赖**: T211（函数已导出）

  **验收**（直接喂真实 porcelain 文本，端到端含解析）:
  ```bash
  printf '?? .specify/orchestration-overrides.yaml\n' \
    | node plugins/spec-driver/scripts/goal-loop-cli.mjs assess-preserved-config-safety -
  ```
  期望输出 `{"safe":true,"unsafe":[]}`（untracked 安全）。
  ```bash
  printf 'M  .specify/orchestration-overrides.yaml\n' \
    | node plugins/spec-driver/scripts/goal-loop-cli.mjs assess-preserved-config-safety -
  ```
  期望输出 JSON 含 `"safe":false` 且 `unsafe` 非空（staged 被拦）。

---

## Phase 6: Prose 更新——verify.md 和 SKILL.md

**目标**: 让 prose 契约与 core 实现保持一致；覆盖 full 显式含 vitest、smoke SKIPPED 约定、preflight 接线、infra-failure 约定。

**两个文件可并行编辑 [P]。**

**独立验证**: `npm run repo:check` 通过（prose 修改后 repo:check 不报 lint 类错误）。

---

- [ ] T215 [P] 修改 `verify.md`——补全 full 命令集 + smoke SKIPPED 约定 + infra-failure 约定

  **动作**: 修改 `plugins/spec-driver/agents/verify.md`，覆盖以下三点：

  **1. full 轮命令集补全（Codex CRITICAL #3）**：
  在 goal_loop JSON 输出模式段中，full 的 layer2_commands 描述更新为明确含 vitest：
  ```
  full 模式 layer2 命令集（必须按此顺序，每条各加 timeout {max_verify_seconds}s 前缀——见下方 timeout 说明）：
  1. npm run build          → dist 就位
  2. npx vitest run         → 含 e2e（dist 已就位，无 build 依赖 SKIPPED）
  3. npm run lint           → （如适用）
  4. npm run repo:check
  ```
  **timeout 口径（修订 #6）**：`max_verify_seconds` 为 **per-command** 墙钟上限（非整轮共享）；full 补 vitest 后最坏耗时 ≈ Σ 各命令上限，prose 须注明并提示 full 轮总时长上升、确认 lock TTL / no-progress 预算可接受。

  **2. smoke SKIPPED 约定（Codex omission #5 + 修订 #1）**：
  在 smoke 模式段新增约定：
  - 检测 `dist/` 缺失时，对 build 依赖 e2e（`tests/e2e/**`，即 vitest `e2e` project）记 `status:"SKIPPED", skipped_reason:"dist_not_built"`
  - 必须使用 vitest project selector 真正排除 e2e 实跑**全部其余非 e2e project**：`npx vitest run --project unit --project integration --project golden-master --project self-hosting`（**四个都要，不能只 unit+integration**），不得只口头标 SKIPPED 而不实跑
  - 其余命令记真实 exit_code

  **3. full 轮 SKIPPED → infra-failure（Codex omission #7）**：
  新增约定：
  - full 轮若出现 `skipped_reason="dist_not_built"` 命令（full 应已 build，出现即契约违反）→ 在 report 中标 `degraded:"infra-failure", reason:"full verify 不应出现 dist_not_built SKIPPED"`
  - 该 report 被 core `decideStop` 识别为 infra-failure，不视为普通 continue

  **产出文件**: `plugins/spec-driver/agents/verify.md`（修改）

  **依赖**: T212（core 实现明确后再更新 prose，保证一致）

  **验收**:
  ```bash
  grep -n "npm run build" plugins/spec-driver/agents/verify.md
  grep -n "dist_not_built" plugins/spec-driver/agents/verify.md
  grep -n "infra-failure" plugins/spec-driver/agents/verify.md
  ```
  期望三者均有命中，内容与约定一致。

---

- [ ] T216 [P] 修改 `SKILL.md`——full/smoke build 次序 + preflight 调用点 + assessPreservedConfigSafety 接线

  **动作**: 修改 `plugins/spec-driver/skills/spec-driver-feature/SKILL.md`，覆盖以下三点：

  **1. full 先 build 再 vitest（L367-368 区域）**：
  明确 full 模式的命令次序：
  ```
  full 模式：先 npm run build（使 dist/ 就位），再 npx vitest run（含 e2e），再 lint，再 repo:check
  ```
  smoke 模式：`tsc --noEmit` + `npx vitest run --project unit --project integration --project golden-master --project self-hosting`（排除 e2e project、覆盖全部非 e2e，修订 #1），检测 `dist/` 缺失时对 e2e 标 SKIPPED，不 build。

  **2. preflight 调用点（新增，编排器零解析——解析全在 core）**：
  在"进入快照前"步骤中，明确编排器 preflight 流程（**不在 prose 解析 porcelain**，直接把原文管道给 CLI，由 core 的 `parsePreservedConfigStates` 解析）：
  ```
  编排器在执行 plan-snapshot 前必须：
  1. git status --porcelain -- .specify/orchestration-overrides.yaml > {tmp}.porcelain
  2. SAFE=$(node "$PLUGIN_DIR/scripts/goal-loop-cli.mjs" assess-preserved-config-safety {tmp}.porcelain)
     # CLI 内部 parsePreservedConfigStates(porcelain, PRESERVED_CONFIG_PATHSPECS) → assessPreservedConfigSafety
  3. 若 SAFE.safe == false → 硬失败，输出指引："preserved config <path> 处于 <state> 态，
     goal_loop 期望其 untracked；中止防数据丢失"，不进入 stash，转 GATE_VERIFY
  4. 若 SAFE.safe == true → 执行 plan-snapshot 规划的 stash 命令
  ```
  **关键**：porcelain → state 的解析**不写进 SKILL.md prose**（主线程精化 #2 / Codex 风险 #3：prose 解析无单测，错了 preflight 形同虚设）。prose 只负责跑 `git status --porcelain` 和管道给 CLI；解析与判定均在已单测的 core 函数。

  **产出文件**: `plugins/spec-driver/skills/spec-driver-feature/SKILL.md`（修改）

  **依赖**: T212、T214（core + CLI 就绪后 prose 接线）

  **验收**:
  ```bash
  grep -n "npm run build" plugins/spec-driver/skills/spec-driver-feature/SKILL.md
  grep -n "assess-preserved-config-safety" plugins/spec-driver/skills/spec-driver-feature/SKILL.md
  ```
  期望两者均有命中；且 **SKILL.md 中不得出现自行解析 porcelain XY 列的规则表**（解析归 core）。

---

## Phase 7: 收尾验证

**目标**: 全量通过后提交，确保零回归、repo:check / build 全绿。

**严格依赖顺序（以下任一步失败必须停止）。**

---

- [ ] T217 全量单测绿态验证（core 单测）

  **动作**: 运行全量 goal-loop core 单测，确认零失败。

  **依赖**: T212、T207（所有 core 实现 + 单测追加完成）

  **验收**:
  ```bash
  node --test plugins/spec-driver/tests/goal-loop-core.test.mjs
  ```
  期望输出：所有用例 PASS（≥92 既有 + 新增 ~20 个），零 FAIL，零 SKIP。

---

- [ ] T218 集成测试绿态验证

  **动作**: 运行真实 git 集成测试，确认 8 个场景全部 PASS。

  **依赖**: T213、T217（core 全绿后跑集成）

  **验收**:
  ```bash
  node --test plugins/spec-driver/tests/goal-loop-snapshot-rollback-integration.test.mjs
  ```
  期望：8 个用例全部 PASS，无 FAIL。

---

- [ ] T219 [P] `npm run build` 通过（类型检查 + 构建）

  **依赖**: T218

  **验收**:
  ```bash
  npm run build
  ```
  期望：零错误，零警告（build 包含 tsc 或等价步骤）。

---

- [ ] T220 [P] `npm run repo:check` 通过

  **依赖**: T218

  **验收**:
  ```bash
  npm run repo:check
  ```
  期望：零错误。如涉及 docs/preference sync（verify.md/SKILL.md 更改导致 docs:sync 脏状态），先运行：
  ```bash
  npm run repo:sync
  npm run repo:check
  ```

---

- [ ] T221 `npm run release:check` 通过（如触发 release contract 变更）

  **动作**: 确认 release contract 未被意外改动。

  **依赖**: T219、T220

  **验收**:
  ```bash
  npm run release:check
  ```
  期望：零错误（本次修复未改动 contracts/release-contract.yaml，应直接通过）。

---

## 依赖关系图

```text
Phase 1（Fixture）
  T201 ─────────────────────────────────┐
  T202 ─────────────────────────────────┤
                                        ↓
Phase 2（单测红态）                    T203 → T204 → T205 → T206 → T207
                                                                      ↓
Phase 3（core 实现）                        T208 → T209 → T210 → T211 → T212
                                                                          ↓
Phase 4（集成测试）                                                      T213
                                                                          ↓
Phase 5（CLI）                                                           T214
                                                                          ↓
Phase 6（Prose，可并行）                         T215 [P] ────────────→ ↓
                                                 T216 [P] ────────────→ T217
                                                                          ↓
Phase 7（收尾）                               T217 → T218 → T219 [P] → T221
                                                              T220 [P] ↗
```

**并行机会汇总**:
- T201、T202 可同时创建（不同文件）
- T215、T216 可并行编辑（不同 prose 文件）
- T219、T220 可并行运行（不同验证命令）

---

## 计划覆盖自检

### Codex omission 清单全覆盖

| # | 要求 | 覆盖任务 |
|---|------|---------|
| 1 | preserved config 保护范围 = untracked-only + staged preflight 硬失败 | T208、T209、T210、T211、T216 |
| 2 | 新增 snapshot/rollback 真实 git 集成测试（8 场景） | T213 |
| 3 | command builder 多 preserved path 展开为多独立 argv | T209（stash）、T210（clean）、T213（multi 用例） |
| 4 | full verify 命令集显式含 `npm run build` + `npx vitest run` | T215（verify.md）、T216（SKILL.md） |
| 5 | smoke "跳过 dist 依赖 e2e" 用真实 vitest project selector 排除 | T215、T216 |
| 6 | evaluateSmokeReadiness 单测 6 用例 + decideStop C1 回归 | T206、T207 |
| 7 | full 轮 dist_not_built SKIPPED → infra-failure（非普通 continue）| T215、T207（单测验证） |

### 两条主线程精化覆盖

| 精化要求 | 覆盖任务 |
|---------|---------|
| decideStop 优先级 3 干净结构（smoke 只调 evaluateSmokeReadiness，full 只调 evaluateMetric，C1 不变量） | T212（核心实现）、T207（C1 回归测试） |
| porcelain 解析进 core 可单测（新增 `parsePreservedConfigStates(porcelainText, paths)`，吃**原始 porcelain 文本**；`assessPreservedConfigSafety(entries)` 只做分类；prose 零解析）| T211（两函数实现）、T205（分类 8 用例）、**T205b（解析各 porcelain 状态用例）**、T214（CLI 端到端吃 porcelain）、T216（SKILL.md 只管道不解析）|

### 测试计划全覆盖

| 测试项 | 覆盖任务 |
|--------|---------|
| 既有 planSnapshot/planRollback deepEqual 断言更新 | T203、T204 |
| assessPreservedConfigSafety 单测（8 用例，含 porcelain 各状态） | T205 |
| evaluateSmokeReadiness 单测（6 用例） | T206 |
| decideStop 新场景（C1 回归 + smoke SKIPPED + full SKIPPED 不达标）| T207 |
| 真实 git 集成测试（8 场景）| T213 |
| 2 个新 fixture | T201、T202 |
| verify.md prose（full vitest + smoke SKIPPED + infra-failure 约定）| T215 |
| SKILL.md prose（build 次序 + preflight 调用点 + porcelain 解析接线）| T216 |
| CLI 暴露 assess-preserved-config-safety 子命令 | T214 |
| 全量收尾验证（node --test + build + repo:check + release:check）| T217~T221 |
