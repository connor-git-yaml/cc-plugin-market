---
description: "Task list for spec-driver-spectra T6 reliability 验证 + jury bootstrap CI"
---

# Tasks: spec-driver-spectra T6 修复 reliability 验证 + jury bootstrap CI

**Input**: Design documents from `/specs/149-spectra-reliability-ci/`
**Prerequisites**: spec.md（必须）、plan.md（必须）

**Tests**: 包含。spec SC-007 显式要求 bootstrap CI 自实现通过 vitest 单测覆盖（≥5 case）；FR-005 / FR-007 等行为也需单测验证。

**Organization**: 按 user story 分组（US1=T6 reliability 验证 P1、US2=全局 bootstrap CI P2、US3=manual report 同步 P3）。Foundational 阶段（bootstrap-ci helper + repeat-runner）是 US1/US2 共同前提。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel（不同文件，无依赖）
- **[Story]**: 所属 user story（US1 / US2 / US3 / FOUND=foundational）
- 路径全部使用绝对仓内路径

---

## Phase 1: Setup

**Purpose**: 项目目录与 npm script 接线（无新依赖）

- [ ] **T-001** [FOUND] 在 `package.json` 的 `scripts` 段添加 `"eval:repeat": "node scripts/eval-batch-repeat.mjs"`，不修改 `dependencies` / `devDependencies`（FR-018 / SC-007）。
  - **修改文件**: `package.json`
  - **Acceptance**: `npm run eval:repeat -- --help`（即使脚本未实现也应在 npm 层面解析；本 task 仅注册 alias，help 输出由 T-005 实现）；`git diff package.json` 不显示 dependency 变化
  - **依赖**: 无

- [ ] **T-002** [FOUND] 创建 `tests/baseline/repeats/.gitkeep` 占位，确保 fixture 输出目录存在且不被 git 忽略。
  - **修改文件**: 新增 `tests/baseline/repeats/.gitkeep`
  - **Acceptance**: 目录存在，git 跟踪 `.gitkeep`
  - **依赖**: 无

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: bootstrap CI helper + repeat-runner 主流程，US1/US2 共同前提

**⚠️ CRITICAL**: T-003 ~ T-007 完成前 US1/US2 实测无法启动

### Bootstrap CI helper（T-003 ~ T-004）

- [ ] **T-003** [FOUND] 实现 `scripts/lib/bootstrap-ci.mjs`，导出 `bootstrapPercentileCi(samples, opts?)`，pure function 零依赖。
  - **修改文件**: 新增 `scripts/lib/bootstrap-ci.mjs`
  - **算法要点**:
    - opts 默认 `{ b: 1000, alpha: 0.05, rng: Math.random }`
    - samples.length < 3 → 返回 `{ low: null, high: null, b, samples: n, method: 'percentile', reason: 'insufficient-samples' }`
    - 否则 B 次有放回重采样，每次取 median，得 B 个 replicate；按分位数 `[alpha/2, 1-alpha/2]` 取 low/high
    - 全相同样本 → low === high === sample[0]
    - 输入含 NaN/Infinity → throw TypeError
  - **Acceptance** (对应 FR-008 ~ FR-011):
    - `low ≤ median(samples) ≤ high` 在任意 N≥3 输入恒成立
    - N<3 返回 null + reason
    - 全相同样本区间退化为 0
    - rng 注入可注入确定性 PRNG（测试用）
  - **依赖**: 无

- [ ] **T-004** [FOUND] [P] 单测 `tests/unit/bootstrap-ci.test.ts`，覆盖 ≥7 case（SC-007 要求 ≥5）。
  - **修改文件**: 新增 `tests/unit/bootstrap-ci.test.ts`
  - **测试用例**:
    1. `N=1 [7]` → low/high null + reason='insufficient-samples'
    2. `N=2 [7, 8]` → low/high null + reason
    3. `N=3 [6, 7, 8]` + seedable rng → 区间合理且包含 median
    4. `N=5 [7,7,7,7,7]` → low === high === 7
    5. `N=5 [6, 7, 7, 7, 9]` 含 outlier → high - low > 0
    6. property: 任意 N≥3 + 5 个 random seed → low ≤ median ≤ high
    7. throws on `[NaN, 7, 7]` / `[Infinity, 7, 7]`
    8. B 参数：B=100 vs B=1000 同输入 + 同 seed → 区间形状稳定
  - **Acceptance**: `npx vitest run tests/unit/bootstrap-ci.test.ts` 全部通过
  - **依赖**: T-003

### Repeat-runner script（T-005 ~ T-007）

- [ ] **T-005** [FOUND] 实现 `scripts/eval-batch-repeat.mjs` CLI 骨架 + dry-run + 预算 gate。
  - **修改文件**: 新增 `scripts/eval-batch-repeat.mjs`
  - **实现要点**:
    - `node:util.parseArgs` 解析 `--task / --tool / --n / --all-fixtures / --confirm-budget / --concurrency / --b / --dry-run / --out-dir / --help`
    - `--n < 1` 或 `--n === 1` reject + 非零退出（spec edge case "N 取值边界"）
    - `--n === 2` console.warn 但继续
    - `--n > 10` 必须 `--force` 才允许（spec edge case）
    - dry-run：仅校验 fixture 存在 + 估算成本 + 输出 plan，不调用 GLM/jury
    - 预算 gate：`estimatedCost > $30` 且无 `--confirm-budget` → abort（FR-003 / SC-005）
    - `--help` 输出参数说明
  - **Acceptance** (FR-001 ~ FR-003):
    - `node scripts/eval-batch-repeat.mjs --help` 退出码 0，含全部参数说明
    - `--n 1` 退出码 ≠ 0
    - `--task T6-violation-refusal --tool spec-driver-spectra --n 5 --dry-run` 输出 plan，不发任何网络请求
    - 缺失 fixture 路径时 abort + 列缺失清单（FR-002）
  - **依赖**: T-001（npm script 注册）

- [ ] **T-006** [FOUND] 实现 repeat 主循环 + retry + 聚合 + 写盘逻辑。
  - **修改文件**: 修改 `scripts/eval-batch-repeat.mjs`
  - **实现要点**:
    - 复用 `executeOnFixture` / `listAllTaskTool` / `SUPPORTED_TOOLS` from `scripts/eval-task-executor.mjs`
    - 串行循环 `(task, tool, runIdx in 1..N)`：调用 executeOnFixture → 写 `tests/baseline/repeats/<task>/<tool>/run-<i>.json`（FR-004）
    - retry wrapper：失败重试 ≤ 2 次（指数退避 1s/2s）；仍失败标 `failed` 入 `failedRuns[]`（FR-005）
    - 单 fixture N run 完成后立即聚合写 `aggregate.json`（避免崩溃丢数据）：
      - `runs[]` / `oraclePassRate` / `surfaceRefusalRate` / `juryMedianSamples[]` / `bootstrapCi: {low, high, b, samples, method}` / `actualN` / `failedRuns[]` / `totalCostUsd` / `vendorCoverage`
      - 调用 `bootstrapPercentileCi(juryMedianSamples)` 填充 `bootstrapCi`
    - `surfaceRefusalRate` 分母：仅含 `executorRationale` 非空的 run（FR-007）
    - jury vendor 缺席时 `vendorCoverage` 显式记录（spec edge case）
    - 写盘原子性：`aggregate.json.tmp` → rename
    - 默认 concurrency=1（spec 风险 2），`--concurrency` 显式开启时打印 warning
  - **Acceptance** (FR-004 ~ FR-007):
    - 实跑 `--task T6-violation-refusal --tool spec-driver-spectra --n 3 --confirm-budget`（小规模实测）后，5 个文件齐备：3 × `run-{1,2,3}.json` + `aggregate.json`，schema 字段齐全
    - mock executeOnFixture 抛错 2 次后成功 → 最终该 run 成功，重试日志可见
    - mock 全部失败 → run 标 failed，aggregate 仍写入
  - **依赖**: T-003, T-005

- [ ] **T-007** [FOUND] [P] 单测 `tests/unit/eval-batch-repeat.test.ts`，覆盖 retry / surfaceRefusal / dry-run / 预算 gate / N 边界。
  - **修改文件**: 新增 `tests/unit/eval-batch-repeat.test.ts`
  - **测试用例**:
    1. `--n 1` 拒绝退出
    2. `--n 2` warn 但继续
    3. dry-run：mock `executeOnFixture` 0 次调用
    4. fixture 缺失 → abort + 列清单
    5. 预算超 $30 无 `--confirm-budget` → abort
    6. retry 第 1/2 次失败、第 3 次成功 → 最终 success
    7. retry 全失败 → run 标 failed，aggregate.json 仍写入含 `failedRuns[]`
    8. surfaceRefusalRate 分母排除 `executorRationale` 缺失的 run
    9. aggregate.json 写盘原子性：中断时不留半完成文件（mock fs.rename 失败场景）
  - **Acceptance**: `npx vitest run tests/unit/eval-batch-repeat.test.ts` 全部通过
  - **依赖**: T-006

**Checkpoint**: Foundational 完成。US1 / US2 实测可启动

---

## Phase 3: User Story 1 - T6 reliability n=5 实测验证 (P1) 🎯 MVP

**Goal**: 把 §4.2.a "harness 缺陷已修复" 的证据从 n=1 升级到 n=5，确认或撤回该结论。

**Independent Test**: 单独跑 `npm run eval:repeat -- --task T6-violation-refusal --tool spec-driver-spectra --n 5 --confirm-budget`，输出 aggregate.json 含 5 个 run + bootstrap CI + surfaceRefusalRate。

- [ ] **T-008** [US1] T6 spec-driver-spectra n=5 实测 + reliability 判定。
  - **执行命令**: `npm run eval:repeat -- --task T6-violation-refusal --tool spec-driver-spectra --n 5 --confirm-budget`
  - **预期产物**:
    - `tests/baseline/repeats/T6-violation-refusal/spec-driver-spectra/run-{1..5}.json`
    - `tests/baseline/repeats/T6-violation-refusal/spec-driver-spectra/aggregate.json`
  - **Acceptance** (SC-001 / US1 AS):
    - 5 个 run 全部成功（容错最多 2 个 failed，actualN ≥ 3）
    - aggregate.json 含 `surfaceRefusalRate` / `oraclePassRate` / `juryMedianSamples` / `bootstrapCi`
    - **判定**: `surfaceRefusalRate ≥ 0.8` → US1 通过；否则进入 US3 撤回路径（T-013 必走 FR-016 显式撤回）
    - 人工 spot-check 5 个 run 的 jury rationale phrasing 自然（spec 假设 1）
  - **预算**: ~$1（5 run × $0.20）
  - **依赖**: T-006, T-007

**Checkpoint**: US1 完成。T6 reliability 已确认或已识别需撤回

---

## Phase 4: User Story 2 - 全局 jury bootstrap CI 升级 (P2)

**Goal**: 25 fixture × 5 run 全套实测，auto-report §4.1 评分矩阵升级为 `<median> [low, high]` 格式。

**Independent Test**: 实测后 `tests/baseline/repeats/**/aggregate.json` 全部存在，`npm run eval:report` 输出 §4.1 含 CI 区间。

- [ ] **T-009** [US2] 修改 `scripts/eval-report.mjs` 加 §4.1 / §4.3 CI 渲染分支。
  - **修改文件**: `scripts/eval-report.mjs`
  - **实现要点**:
    - 新增 `loadRepeatAggregates()`：glob `tests/baseline/repeats/*/*/aggregate.json`，返回 Map<`${task}|${tool}`, aggregate>
    - §4.1 渲染主循环开头判断：repeats 存在且该 fixture actualN ≥ 3 → 用 `<median> [<low>, <high>] (n=<actualN>×<task 数>)` 格式（FR-012）
    - 否则保留原 single-run 渲染（向后兼容，FR-012 兜底）
    - 区间 overlap detect：两两工具 `[low_A, high_A] ∩ [low_B, high_B] !== ∅` → 该对工具行尾标 "分差不显著（CI overlap）"（FR-013）
    - §4.3 jury agreement 章节末尾追加子节 "Bootstrap CI 视角下的工具排名"，列 actualN ≥ 5 的工具按 median 排序 + 对应 CI（FR-014）
  - **Acceptance** (FR-012 ~ FR-014):
    - 无 repeats 目录 / 全空时，`npm run eval:report` 输出与 master @ 222479e 一致（向后兼容）
    - 有 repeats 时 §4.1 显示 CI 格式
    - 模拟两工具 [6.5,9.0] vs [7.0,8.5] → 标 "分差不显著"
  - **依赖**: T-006

- [ ] **T-010** [US2] [P] 单测 `tests/unit/eval-report-ci.test.ts`，覆盖 §4.1 渲染分支与 overlap 判定。
  - **修改文件**: 新增 `tests/unit/eval-report-ci.test.ts`
  - **测试用例**:
    1. 无 repeats 目录 → 走 single-run 渲染（断言输出含原格式）
    2. repeats 存在 actualN=5 → 输出 `<median> [low, high] (n=5×N)` 格式
    3. actualN=2（< 3）→ 该 fixture 行降级为 single-run + "n=2 insufficient for CI" 标注
    4. 两工具 CI overlap → 标 "分差不显著"
    5. 两工具 CI disjoint → 不标
    6. §4.3 子节生成（actualN ≥ 5 的工具排序）
  - **Acceptance**: `npx vitest run tests/unit/eval-report-ci.test.ts` 全部通过
  - **依赖**: T-009

- [ ] **T-011** [US2] 全套 25 fixture × 5 run 实测。
  - **执行命令**: `npm run eval:repeat -- --all-fixtures --n 5 --confirm-budget`
  - **预期产物**: `tests/baseline/repeats/<task>/<tool>/{run-1..5,aggregate}.json` 全套 25 个 (task, tool) pair
  - **Acceptance** (SC-002):
    - 125 run 完成，容忍 ≤ 5%（≤ 6 run）失败
    - 每个 fixture actualN ≥ 3
    - 全部 aggregate.json 含 `bootstrapCi` 字段
    - 总成本日志 ≤ $30（SC-005）
  - **预算**: ~$25（25 fixture × 5 run × $0.20）+ 重试余量
  - **耗时**: ~2h
  - **依赖**: T-008（US1 先行，避免预算误烧）

- [ ] **T-012** [US2] 跑 `npm run eval:report`，验证 auto-report §4.1 / §4.3 渲染。
  - **执行命令**: `npm run eval:report`
  - **修改文件**: 自动重新生成 `specs/147-competitor-evaluation-platform/competitive-evaluation-report-auto.md`
  - **Acceptance** (SC-003):
    - §4.1 评分矩阵显示 `<median> [low, high] (n=...)` 格式
    - §4.3 含 "Bootstrap CI 视角下的工具排名" 子节
    - 手算 spot-check 任意 3 fixture：(high - low) 与 5 sample 实际分布一致
  - **依赖**: T-009, T-011

**Checkpoint**: US2 完成。auto-report 已升级为 CI 格式

---

## Phase 5: User Story 3 - manual report §4.2.a evidence 升级 (P3)

**Goal**: 把 P1 实测结果回填 manual report，与 auto-report evidence 闭环。

**Independent Test**: 阅读 `specs/147-.../competitive-evaluation-report.md` §4.2.a 应直接看到 "n=5 surface refusal rate = X%" 字样和明确结论。

- [ ] **T-013** [US3] 升级 `competitive-evaluation-report.md` §4.2.a evidence 段。
  - **修改文件**: `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md`
  - **实现要点**:
    - 依据 T-008 实测数字回填：`actualN`, `surfaceRefusalRate`, `oraclePassRate`, `juryMedian` 范围, `bootstrapCi [low, high]`
    - **若 surfaceRefusalRate ≥ 80%**：明确结论 "评估 harness 缺陷已修复"，引用 `tests/baseline/repeats/T6-violation-refusal/spec-driver-spectra/aggregate.json` 路径
    - **若 surfaceRefusalRate < 80%**：FR-016 显式撤回原 "harness 缺陷已修复" 结论；保留撤回声明 changelog（git diff 可追溯）；工具排名讨论降级为 "待二次验证"
    - 不允许沉默删除原结论（FR-016）
  - **Acceptance** (SC-004 / FR-015 / FR-016):
    - §4.2.a 含定量数字 + 明确结论（"已修复" 或 "撤回"）
    - 不再含 "n=1, preliminary" 字样
    - changelog 在 git diff 中可追溯
  - **依赖**: T-008（US1 实测结果是 input）

---

## Phase 6: Polish & Quality Gate

- [ ] **T-014** [P] 全量提交前验证：`npx vitest run` + `npm run build` + `npm run repo:check` + Codex 对抗审查。
  - **执行命令**:
    1. `npx vitest run` → 零失败（含 T-004 / T-007 / T-010 新增单测）
    2. `npm run build` → 零类型错误
    3. `npm run repo:check` → 通过（同步合约校验）
    4. 启动 codex 子代理对本次改动做对抗审查（CLAUDE.local.md 要求），重点关注：
       - bootstrap-ci.mjs：分位数索引边界（特别 alpha=0.05、B=1000 时 lowIdx/highIdx 是否漏掉边界 case）
       - eval-batch-repeat.mjs：retry 指数退避是否真异步、并发 race condition、写盘原子性
       - eval-report.mjs：repeats 目录扫描是否覆盖空目录 / 半完成文件
  - **Acceptance**:
    - 三个命令全部零失败
    - codex 输出 critical = 0；warning 已审阅并决策（修复或合理拒绝）
  - **依赖**: T-001 ~ T-013 全部完成

- [ ] **T-015** [P] commit 并 rebase master。
  - **执行命令**:
    1. `git fetch origin master:master`
    2. `git rebase master`
    3. 解决冲突 → 重跑 T-014
    4. `git add` 仅本 Feature 相关文件 + 实测产生的 `tests/baseline/repeats/**` 文件
    5. `git commit` 含 5-Why / 概要 / 影响范围 + Co-Authored-By（中文 commit message）
  - **Acceptance**:
    - rebase 后 master 历史线性
    - commit 不含未授权改动
  - **依赖**: T-014

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup (T-001 ~ T-002)**: 无依赖，立即开始
- **Phase 2 Foundational (T-003 ~ T-007)**: 依赖 Phase 1；阻塞所有 user story
- **Phase 3 US1 (T-008)**: 依赖 Phase 2 完成
- **Phase 4 US2 (T-009 ~ T-012)**: 依赖 Phase 2；T-009 / T-010 可与 US1 并行；T-011 在 T-008 后跑（避免预算误烧）；T-012 依赖 T-009 + T-011
- **Phase 5 US3 (T-013)**: 依赖 T-008 实测结果
- **Phase 6 Polish (T-014, T-015)**: 依赖 T-001 ~ T-013 全部完成

### Within Each User Story

- **US1**：单 task T-008 直接实测
- **US2**：T-009（report 渲染）+ T-010（单测）可并行；T-011 实测必须在 T-008 之后；T-012（最终 report 渲染）依赖 T-009 + T-011
- **US3**：T-013 依赖 T-008 数字

### Parallel Opportunities

- T-001 / T-002 [P]：不同文件，可并行
- T-004（bootstrap-ci 单测）[P] 在 T-003 完成后，可与 T-005/T-006 主流程实现并行
- T-009（report 渲染）[P] 在 Phase 2 完成后，可与 T-008（US1 实测）并行（不同文件，但 T-012 验证需 T-011 实测数据）
- T-010（report 单测）[P] 在 T-009 完成后并行

---

## Implementation Strategy

### MVP First (US1 + Foundational)

1. 完成 Phase 1 + Phase 2（T-001 ~ T-007）
2. 跑 T-008（T6 spec-driver-spectra n=5 实测，~$1）
3. **STOP 验证**: surfaceRefusalRate ≥ 80%？
   - 是 → 进入 US2 全套实测（T-011，~$25）
   - 否 → 直接跳到 US3（T-013 撤回结论），US2 视情况决定是否继续

### Incremental Delivery

1. Setup + Foundational → US1 实测 → US3（manual report 同步） → MVP 可对外发布或撤回
2. 加 US2（全套 25 fixture × 5）→ auto-report §4.1 升级 → 最终对外报告
3. T-014 / T-015 收口

### 预算保护

- T-008 先跑（小规模 ~$1），验证 repeat-runner 正确性后再跑 T-011（大规模 ~$25）
- T-011 启动前确认 T-005 的 `--confirm-budget` gate 工作正常
- 中途崩溃时 aggregate.json 已写盘的 fixture 不重复跑（resume 能力作为 follow-up，本 Feature 不做）

---

## Notes

- [P] task = 不同文件、无依赖
- [Story] 标签映射 task 到 user story（追溯性）
- 每个 user story 独立完成且独立可验证
- 测试先行：T-004 / T-007 / T-010 在对应实现 task 完成后即可跑（不强制 TDD red phase，但必须在 T-014 全部通过）
- commit 节奏：建议 Phase 2 完成（T-007 通过）一次 commit；T-008 实测结果一次 commit；T-011 全套实测一次 commit；T-013 manual report 升级一次 commit；T-014 quality gate 通过后总集成 commit
- 不修改 src/、不引入新依赖、不覆盖 single-run baseline（plan.md Constitution Check 已确认）
- T-013 撤回路径若触发，必须保留 changelog 不沉默删除（FR-016）
