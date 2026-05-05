# Feature Specification: spec-driver-spectra T6 修复 reliability 验证 + jury bootstrap CI

**Feature Branch**: `149-spectra-reliability-ci`
**Created**: 2026-05-04
**Status**: Draft
**Input**: User description: "spec-driver-spectra T6 修复 reliability 验证 + jury bootstrap CI"

## 背景与问题陈述

Feature 147（competitor-evaluation-platform）Sprint 3 收尾阶段，通过 Codex 对抗审查（adversarial review）暴露两个未解决的统计可信度问题：

1. **spec-driver-spectra prompt 修复仅有 n=1 证据**：`scripts/eval-task-runner.mjs:124-145` 的 prompt 模板修复（commit `222479e`），在 T6（violation refusal）任务上仅做了 1 次重跑验证 surface refusal 行为，对外报告（`specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` §4.2.a）已诚实标注 "preliminary evidence"，但作为"评估 harness 缺陷已修复"的结论支撑明显不足。
2. **cross-LLM jury median 缺 confidence interval**：Sprint 3 的 25 fixture 重测实验显示 jury 评分跨 run 自然波动 ±1（11/25 fixture |Δ|≥1），意味着 auto-report §4.1 评分矩阵中"工具间均分差距 ≤ 0.5"的差异不能作为可信的质量排名信号；当前所有数字都是 single-run snapshot，没有不确定度区间。

这两个问题如果不解决，Feature 147 报告的对外结论既可能高估（声称已修复但其实只是单次幸运），也可能误导（用 single-run 均分排序工具）。本 Feature 的目标是通过受控的 N≥5 重跑实验，给出统计上可信的结论。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 验证 spec-driver-spectra T6 prompt 修复在 reliability 维度成立 (Priority: P1)

作为 Feature 147 报告的对外发布人，我需要把 §4.2.a 中"评估 harness 缺陷已修复"的证据从 n=1 升级到 n≥5，以便确认（或推翻）这个对外承诺，避免因单次幸运结果向用户传递错误信号。

**Why this priority**: 这是 Feature 147 报告对外发布前的最后一个 blocking 问题。如果 reliability 验证失败（surface refusal rate < 80%），需要立即在 manual report 中撤回相关结论，否则会损害 spec-driver 工具评估的公信力。业务价值最高，时间敏感。

**Independent Test**: 单独运行新增的 `eval-batch-repeat.mjs` 脚本，对 T6 spec-driver-spectra fixture 跑 n=5，统计 surface refusal rate 即可验证。不依赖其他 user story 的产物。

**Acceptance Scenarios**:

1. **Given** spec-driver-spectra T6 fixture 已存在（schema 1.1）且 prompt 修复已 commit，**When** 运行 `npm run eval:repeat -- --task T6-violation-refusal --tool spec-driver-spectra --n 5`，**Then** 输出聚合报告含 5 次 run 的 oracle pass rate / surface refusal rate / jury median 及标准差，且 surface refusal rate ≥ 80%（即 5 次至少 4 次 surface refusal）。
2. **Given** repeat 实验完成，**When** 任意一次 run 结果中 `executorRationale` 字段为空或缺失，**Then** 工具应明确报告该 run 不计入 surface refusal 统计，但仍计入 oracle pass / jury 统计。
3. **Given** repeat 实验某次 run 的 GLM API 超时，**When** 重试 2 次后仍失败，**Then** 工具应记录该 run 状态为 `failed`，并在最终聚合时按"实际成功 run 数"作分母（不按 N=5 强行计算），同时在报告中显式标记降级。

---

### User Story 2 - 全局 jury bootstrap 95% CI 升级评分矩阵 (Priority: P2)

作为 Feature 147 报告的撰写者，我需要把 auto-report §4.1 评分矩阵从 single-run snapshot 升级为 "median [low, high]" 的 bootstrap CI 形式，以便读者能直接判断工具间分差是否显著、是否值得作为质量排名依据。

**Why this priority**: 影响整份对外报告的可信度框架，但不像 P1 那样阻塞发布（可以在评分矩阵下方加 disclaimer 临时缓解）。投入产出比依赖 25 fixture × 5 重跑（约 $25 + GLM driver $0.05）的成本是否在预算内。

**Independent Test**: 单独运行 `eval-batch-repeat.mjs --all-fixtures --n 5`，再运行 bootstrap CI helper 计算每个 fixture 的 jury median 95% CI；最终验证 aggregate.json 中是否新增 `bootstrapCi: {low, high, samples}` 字段。

**Acceptance Scenarios**:

1. **Given** 25 个 fixture 已存在（schema 1.1），**When** 运行 `npm run eval:repeat -- --all-fixtures --n 5`，**Then** 25 × 5 = 125 个独立 run 全部成功（或失败时按 P1 降级策略处理），每个 fixture 的聚合结果含 `juryMedians: [s1, s2, ..., s5]` 数组。
2. **Given** 5 个 jury median 样本已收集，**When** 运行 bootstrap CI helper（B=1000 重采样），**Then** 输出 `low` 和 `high` 满足 `low ≤ median(samples) ≤ high`，且 `(high - low)` 反映样本分布宽度（5 样本全相同时区间为 0）。
3. **Given** bootstrap CI 已计算，**When** 渲染 auto-report §4.1 评分矩阵，**Then** 每个工具列显示形如 `7.8 [6.5, 9.0] (n=5×4 task)` 的格式，且 95% CI 重叠的工具明确标注"分差不显著"。

---

### User Story 3 - manual report §4.2.a evidence 段升级与 auto-report 同步 (Priority: P3)

作为 Feature 147 报告的最终发布人，我需要把 P1 验证的定量结果回填到 `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` §4.2.a 与 `competitive-evaluation-report-auto.md` §4.1 / §4.3，让两份报告在 evidence 一致性上闭环。

**Why this priority**: 文档落地动作，依赖 P1 + P2 已完成。技术风险最低，但对外发布前必须做。

**Independent Test**: 阅读 manual report §4.2.a 应能直接看到 "n=5 surface refusal rate = X%" 字样和 P1 实验的来源 fixture 路径；auto-report §4.1 评分矩阵格式应已切换。

**Acceptance Scenarios**:

1. **Given** P1 实验完成且 reliability 已确认（≥80%），**When** 更新 manual report §4.2.a，**Then** 该段含定量数字（n=5 surface refusal rate, oracle pass rate, jury median 范围）和明确结论（"评估 harness 缺陷已修复"或"未达可靠性阈值，撤回结论"）。
2. **Given** P2 实验完成且 bootstrap CI 已写入 aggregate.json，**When** 重新运行 `npm run eval:report`，**Then** auto-report §4.1 评分矩阵显示 CI 区间，§4.3 jury agreement 章节同步更新（含 95% CI 视角的工具排名讨论）。
3. **Given** P1 实验失败（reliability < 80%），**When** 更新 manual report §4.2.a，**Then** 该段必须显式撤回原 "harness 缺陷已修复" 结论，并把工具排名讨论从"已确认"降级为"待二次验证"。

---

### Edge Cases

- **GLM API 间歇性超时 / 429 限流**：单 run 应支持自动重试（指数退避，最多 2 次），仍失败时该 run 标记 failed 并不阻塞其他 run 推进；最终 N 不足 5 时降级为"实际成功数 ≥ 3"作为 P1 acceptance 的最低门槛，否则整体 fail。
- **Jury vendor 三家中任一返回失败**：参考 Sprint 3 已有的 jury fallback 逻辑（中位数从可用样本计算），但 aggregate.json 中应明确记录哪些 vendor 缺席（vendor coverage 字段），bootstrap CI 不能因为某 vendor 间歇缺席而虚高。
- **Fixture 不存在或 schema 不匹配**：repeat-runner 应在 dry-run 阶段一次性校验所有 25 个 fixture 路径与 schema 版本，缺失时立即 abort 并提示用户先跑 `eval-task-executor.mjs` 重建 fixture。
- **N 取值边界**：N=1 时直接拒绝（无统计意义），N=2 时给出 warning 但允许运行，N≥3 时正常计算 bootstrap CI（B=1000 重采样足够）。N 上限默认 10（更高需 `--force` 防止误烧 token）。
- **Bootstrap CI 自实现不依赖外部库**：所有重采样、分位数计算用 Node.js 内建 Math + 简单数组操作；不引入 simple-statistics / d3-array 等运行时依赖。
- **Cost 超预算保护**：repeat-runner 启动时根据 `N × fixture 数 × 单 run 单价表`估算总成本，若 > $30 必须 `--confirm-budget` 才能运行。
- **同 fixture 多 run 写盘冲突**：每个 run 写入独立路径 `tests/baseline/repeats/<task>/<tool>/run-<i>.json`，最终聚合写入 `tests/baseline/repeats/<task>/<tool>/aggregate.json` 含 bootstrapCi 字段；不覆盖原始 schema 1.1 fixture（保持 single-run baseline 不变）。
- **manual report 撤回路径**：P1 失败时不能"沉默删除"原结论，必须保留撤回声明的 changelog（git diff 可追溯）。

## Requirements *(mandatory)*

### Functional Requirements

#### Repeat-runner（核心）

- **FR-001**: 系统 MUST 提供 `scripts/eval-batch-repeat.mjs` CLI，接受 `--task <id>` / `--tool <name>` / `--n <int>` / `--all-fixtures` / `--confirm-budget` 等参数。
- **FR-002**: repeat-runner MUST 在启动时校验所有目标 fixture 路径与 schema 1.1 兼容性，缺失则 abort 并打印缺失清单。
- **FR-003**: repeat-runner MUST 在启动时根据成本表估算总 token 成本；若超过 `$30` 必须 `--confirm-budget` flag 才继续；否则 abort 并打印估算结果。
- **FR-004**: 每个 run MUST 写入独立路径 `tests/baseline/repeats/<task>/<tool>/run-<i>.json`，schema 与单次 fixture 一致（`taskExecution` / `juryScores` 等字段）。
- **FR-005**: 单 run 失败时（GLM API 错误 / 解析错误 / 任意 jury vendor 全部失败），MUST 重试最多 2 次（指数退避 1s / 2s）。
- **FR-006**: 最终聚合 MUST 写入 `tests/baseline/repeats/<task>/<tool>/aggregate.json`，包含字段 `runs[]` / `oraclePassRate` / `surfaceRefusalRate` / `juryMedianSamples[]` / `bootstrapCi: {low, high, samples, b}` / `actualN` / `failedRuns[]` / `totalCostUsd`。
- **FR-007**: aggregate.json 的 `surfaceRefusalRate` MUST 通过 `executorRationale` 字段是否包含 surface refusal 关键词（参考 Sprint 3 现有判定逻辑）来计算；如果该字段缺失，该 run 不计入 surface refusal 分母（同时 oracle / jury 仍计入）。

#### Bootstrap CI helper

- **FR-008**: 系统 MUST 提供 bootstrap CI helper（可作为 `scripts/eval-batch-repeat.mjs` 内部函数或独立 `scripts/eval-bootstrap-ci.mjs`），输入 N≥3 的样本数组，输出 95% CI [low, high]。
- **FR-009**: bootstrap 实现 MUST 使用 percentile method（B=1000 默认，可通过 `--b <int>` 调整），不依赖任何运行时新增 npm 包。
- **FR-010**: 当输入样本 N < 3，bootstrap helper MUST 返回 `{low: null, high: null, reason: 'insufficient-samples'}`，由调用方决定如何在报告中展示。
- **FR-011**: bootstrap CI 区间 MUST 满足 `low ≤ median(samples) ≤ high`；若样本全相同则 `low === high === sample[0]`。

#### Auto-report 集成

- **FR-012**: `scripts/eval-report.mjs` MUST 检测 `tests/baseline/repeats/**/aggregate.json` 是否存在；存在时 §4.1 评分矩阵 MUST 渲染为 `<median> [<low>, <high>] (n=<actualN>×<task 数>)` 格式，否则保留原 single-run 渲染（向后兼容）。
- **FR-013**: 当工具 A 的 `[low_A, high_A]` 与工具 B 的 `[low_B, high_B]` 区间重叠，auto-report MUST 在该对工具间标注 "分差不显著（CI overlap）"。
- **FR-014**: §4.3 jury agreement 章节 MUST 新增 "Bootstrap CI 视角下的工具排名" 子节，列出 N≥5 的工具按 median 排序及对应 CI。

#### Manual report 同步

- **FR-015**: `competitive-evaluation-report.md` §4.2.a MUST 由人工（或 spec-driver-fix 流程）更新，含 P1 实验定量结果（actualN, surfaceRefusalRate, juryMedian 范围）。
- **FR-016**: 若 P1 实验 surfaceRefusalRate < 80%，§4.2.a MUST 显式撤回原 "评估 harness 缺陷已修复" 结论；不允许沉默删除。

#### 不变量与约束

- **FR-017**: 系统 MUST NOT 修改 `src/` 下任何 spec-driver / spectra 产品代码。
- **FR-018**: 系统 MUST NOT 引入新的 npm 运行时依赖（dev dependency 也避免，bootstrap 自实现）。
- **FR-019**: 系统 MUST NOT 覆盖现有 `tests/baseline/tasks/<task>/<tool>/full.json`（single-run baseline）；所有 repeat 产物写入独立 `tests/baseline/repeats/` 目录。
- **FR-020**: 系统 SHOULD 复用现有 jury / cost-backfill / report 链路（`eval-judge-jury.mjs` / `eval-cost-backfill.mjs` / `eval-report.mjs`），避免重复实现。

### Key Entities

- **RepeatAggregate**：单 (task, tool) pair 的 N 次 run 聚合结果，含 oracle pass rate、surface refusal rate、jury median 样本数组、bootstrap CI、实际成功 N、失败 run 列表、总成本。
- **BootstrapCi**：95% confidence interval 三元组 `{low, high, b, samples, method: 'percentile'}`；samples < 3 时退化为 `{low: null, high: null, reason}`。
- **RepeatRun**：单次 run 的完整 fixture（schema 1.1 兼容），新增 `runIndex` 与 `parentTaskTool` 字段标识所属聚合。
- **CostEstimate**：repeat-runner 启动前的预算检查记录，含 per-run 单价（GLM driver + 3 jury vendor）、估算总成本、用户确认状态。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: T6 spec-driver-spectra n=5 重跑后，surface refusal rate ≥ 80%（即 ≥ 4/5 run 在 `executorRationale` 中显式 surface refusal）。若失败，manual report §4.2.a 必须显式撤回原结论。
- **SC-002**: 25 fixture × N=5 重跑全部完成（容忍 ≤ 5% run 因 API 错误降级，但每个 fixture 的 actualN ≥ 3 才计入 §4.1 CI 渲染），所有 aggregate.json 写盘且通过 schema 校验。
- **SC-003**: auto-report §4.1 评分矩阵渲染含 95% CI `[low, high]` 区间，且 `(high - low)` 数值与 5 个 sample 的实际分布一致（手算 spot-check 任意 3 个 fixture）。
- **SC-004**: manual report §4.2.a evidence 段升级（从 "n=1, preliminary" 到 "n=5, actualN=X, surfaceRefusalRate=Y%"），含明确的"已修复"或"撤回"结论，且 changelog 在 git diff 中可追溯。
- **SC-005**: total cost ≤ $30（用户预算 $27 估算上浮 ~10% buffer）；超预算时自动 abort + `--confirm-budget` flag 才能继续。
- **SC-006**: 整个流程可由单条 npm script 触发并产出最终 report：`npm run eval:repeat -- --all-fixtures --n 5 && npm run eval:report`。
- **SC-007**: zero new runtime dependencies（`package.json` dependencies/devDependencies 字段不增加），bootstrap CI 自实现通过 `npx vitest run` 单元测试覆盖（至少 5 个测试用例：N<3 / N=3 / N=5 全相同 / N=5 含 outlier / B 参数变化）。

## Out of Scope

- 不修改 `src/spec-driver/` 或 `src/spectra/` 产品代码（任何对 spec-driver 工具本身行为的改动属于另一 Feature）。
- 不扩展 task fixture 数量（仍是 25 fixture，不新增 task）。
- 不实现真实 multi-turn 对话采样（multi-turn 实跑成本高，超出本 Feature 预算；保持 single-turn driver 不变）。
- 不重构现有 `eval-task-executor.mjs` / `eval-task-runner.mjs` / `eval-judge-jury.mjs`（只扩展，不动现有路径）。
- 不引入 statistical significance test（如 Mann-Whitney / permutation test）；本 Feature 只做 bootstrap percentile CI，更复杂的检验作为 follow-up。
- 不做 cross-tool baseline 对比模式（保持 `baseline-diff.mjs` 现状，不扩展为 cross-tool）。
- 不修改 schema 1.1 本身；repeat 产物的 aggregate.json 是新增 schema（schema 1.1 fixture 增加 `bootstrapCi` 字段属于另一 Feature）。
- 不集成到 CI / GitHub Actions（本 Feature 只提供本地 npm script；CI 接入作为 follow-up，由 baseline 框架统一处理）。

## 依赖与前置条件

- Feature 147 Sprint 3 已完成，包括 prompt 修复 commit `222479e`、25 fixture schema 1.1 已落地。
- 现有 npm scripts `eval:task-executor` / `eval:task-runner` / `eval:judge-jury` / `eval:report` 工作正常 [推断：基于上下文摘要]。
- GLM driver / 3 jury vendor 配额可承担 ~$30 实验。
- manual report `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` 与 auto-report `specs/147-competitor-evaluation-platform/competitive-evaluation-report-auto.md` 路径稳定，未在并行 worktree 中被改写。

## 假设与风险

- **假设 1**：单次 run 之间确实独立（GLM 与 3 jury vendor 不共享上下文 / 不缓存 prior run 结果）。若实际有缓存，bootstrap CI 会低估真实方差。验证手段：spot-check 5 个 run 的 jury rationale 文本应有自然 phrasing 差异。
- **假设 2**：`executorRationale` 中 surface refusal 的判定关键词（Sprint 3 已实现）足够准确，假阳/假阴 ≤ 10%。失败缓解：P1 acceptance 时人工 spot-check 5 个 run。
- **风险 1**：N=5 在 bootstrap percentile method 下的 CI 偏窄（小样本 well-known issue）；本 Feature 接受这个限制，在报告中明确标注 "small-sample CI, interpret with caution"。
- **风险 2**：25 fixture × 5 run = 125 个 GLM 调用 + 375 个 jury 调用，若并发太高会触发限流。缓解：默认串行（concurrency=1），`--concurrency` flag 显式开启时用户自负风险。
- **风险 3**：manual report §4.2.a 修订涉及对外结论翻转的可能（若 P1 失败），需要走 spec-driver-fix 流程，本 Feature 的 plan 阶段需明确切换路径。
