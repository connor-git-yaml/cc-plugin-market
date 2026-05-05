# Implementation Plan: spec-driver-spectra T6 修复 reliability 验证 + jury bootstrap CI

**Branch**: `149-spectra-reliability-ci` | **Date**: 2026-05-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/149-spectra-reliability-ci/spec.md`

## Summary

本 Feature 解决 Feature 147 Sprint 3 收尾阶段两个统计可信度问题：(1) spec-driver-spectra T6 prompt 修复仅有 n=1 证据；(2) auto-report §4.1 评分矩阵缺 confidence interval。技术路径：在 `scripts/` 下新增 repeat-runner（`eval-batch-repeat.mjs`）+ 自实现 percentile bootstrap helper（`scripts/lib/bootstrap-ci.mjs`），复用现有 `eval-task-executor.mjs` / `eval-judge-jury.mjs` / `eval-cost-backfill.mjs` / `eval-report.mjs` 链路；新增 fixture 输出到 `tests/baseline/repeats/<task>/<tool>/` 独立目录，**不覆盖** master @ 222479e 的 single-run baseline；`eval-report.mjs` 检测 repeats 目录存在时切换为 `<median> [low, high] (n=...)` 渲染，否则保留原 single-run 渲染（向后兼容）。

## Technical Context

**Language/Version**: Node.js 20.x ESM（`.mjs`）+ TypeScript 5.x（vitest 单测）
**Primary Dependencies**: 不引入新运行时依赖；复用现有 `scripts/eval-task-executor.mjs` exports（`executeOnFixture`, `listAllTaskTool`, `SUPPORTED_TOOLS`）、`scripts/eval-judge-jury.mjs` exports（`runJuryOnFixture`, `DEFAULT_JUDGES`）、`scripts/eval-cost-backfill.mjs`、`scripts/eval-report.mjs` 渲染层
**Storage**: Filesystem（JSON fixture 写入 `tests/baseline/repeats/<task>/<tool>/run-<i>.json` 与 `aggregate.json`）
**Testing**: vitest（`tests/unit/*.test.ts`，每个 describe 独立 setup/teardown，禁用 any）
**Target Platform**: 本地 dev shell + 未来 CI workflow_dispatch（本 Feature 仅落地本地 npm script）
**Project Type**: single project（无前后端分离）
**Performance Goals**: 25 fixture × 5 run = 125 GLM driver 调用 + 375 jury 调用，单 run 串行约 30-60s，估算总耗时 ~2h；预算 ≤ $30（用户实际预算 $27 + ~10% buffer）
**Constraints**:
- 不允许修改 `src/` 下任何 spec-driver / spectra 产品代码（FR-017 / Constitution II）
- 不引入新 npm 运行时依赖（FR-018 / spec edge case "Bootstrap CI 自实现"）
- 不覆盖现有 `tests/baseline/tasks/<task>/<tool>/full.json` single-run baseline（FR-019）
- 不修改 schema 1.1 本身（OOS）
- bootstrap percentile method，B=1000 默认（FR-009）
- N=1 拒绝运行；N=2 warn；N≥3 才计 CI（spec edge case "N 取值边界" / FR-010）

**Scale/Scope**:
- 新增 ~2 个 script 文件 + 1 个 lib 文件 + 2 个单测文件
- 修改 `scripts/eval-report.mjs` 渲染分支（向后兼容降级）
- 修改 `package.json` 加 `eval:repeat` script
- 修改 `specs/147-.../competitive-evaluation-report.md` §4.2.a evidence 段（实测后回填）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 检查项 | 本 Feature 处理 |
|------|--------|----------------|
| I 双语文档 | 中文正文 + 英文术语 | plan / tasks / fixture comment 全中文，bootstrap CI / percentile 等保持英文 ✅ |
| II Spec-Driven | 不直接改 src/ | 本 Feature 全部产物在 `scripts/` + `tests/` + `specs/`，零 `src/` 改动 ✅ |
| III YAGNI | 不增冗余抽象 | bootstrap CI 自实现 ~30 行，不引第三方库；不为"未来可能多种 CI 方法"加 strategy 抽象，只实现 percentile method（spec OOS 已显式排除 BCa）✅ |
| IV 诚实标注 | `[推断]` 标记 | aggregate.json 字段含 `failedRuns[]`、`actualN`、`reason: 'insufficient-samples'` 等显式降级标识 ✅ |
| V AST 精确性 | 不影响（无 AST 流水线相关代码） | N/A |
| VI 混合分析流水线 | 不影响 | N/A |
| 质量门控 | vitest + build + repo:check | T-014 显式跑 `npx vitest run` + `npm run build` + `npm run repo:check` ✅ |
| 模型选择 | 测试场景用 Sonnet | repeat-runner 内部 GLM driver / jury 沿用 Sprint 3 配置（GLM 是测试 fixture，3-vendor jury 也是测试），与本 Feature 无关；本 Feature 自身 implement 阶段使用 Opus ✅ |

无 violation，**Constitution Check 通过**，无需 Complexity Tracking 表。

## Project Structure

### Documentation (this feature)

```text
specs/149-spectra-reliability-ci/
├── spec.md              # 已存在
├── plan.md              # 本文件
├── tasks.md             # 同 phase 一并产出
└── (无 contracts/ research.md data-model.md，story 模式合并产出)
```

### Source Code (repository root)

```text
scripts/
├── eval-batch-repeat.mjs           # 【新增】CLI 入口，repeat-runner 主流程
├── eval-task-executor.mjs          # 复用，不动
├── eval-judge-jury.mjs             # 复用，不动
├── eval-cost-backfill.mjs          # 复用，不动
├── eval-report.mjs                 # 【修改】§4.1 渲染分支：检测 repeats 时切 CI 格式
└── lib/
    └── bootstrap-ci.mjs            # 【新增】percentile bootstrap CI helper（pure JS）

tests/
├── baseline/
│   ├── tasks/<task>/<tool>/full.json     # 不覆盖（single-run baseline 保持）
│   └── repeats/                          # 【新增目录】
│       └── <task>/<tool>/
│           ├── run-1.json                # 单 run 完整 fixture
│           ├── ...
│           ├── run-N.json
│           └── aggregate.json            # 聚合结果含 bootstrapCi
└── unit/
    ├── bootstrap-ci.test.ts              # 【新增】至少 5 case（FR-009 / SC-007）
    └── eval-batch-repeat.test.ts         # 【新增】单测 + dry-run integration

specs/147-competitor-evaluation-platform/
├── competitive-evaluation-report.md      # 【修改】§4.2.a evidence 段升级
└── competitive-evaluation-report-auto.md # 由 eval-report.mjs 自动重新生成

package.json                              # 【修改】加 "eval:repeat" script
```

**Structure Decision**: 沿用现有 single project 结构（`scripts/` + `tests/`），不分 backend/frontend。新增产物全部在已有目录树下扩展，不引入新顶层目录（除 `tests/baseline/repeats/` 数据目录是 fixture 产物自然分支）。

## Architecture

### 数据流 (Data Flow)

```
[user CLI] npm run eval:repeat -- --all-fixtures --n 5
   ↓
[eval-batch-repeat.mjs]
   ├─ Phase 0 dry-run: 校验 25 fixture 路径 + schema 1.1 + 估算成本（FR-002 / FR-003）
   │     └─ 超 $30 → abort 除非 --confirm-budget
   ├─ Phase 1 串行循环 (task, tool, runIndex):
   │     ├─ executeOnFixture(...) [复用 eval-task-executor.mjs]
   │     │     └─ 内部已含 GLM driver + claude --print + jury invocation
   │     ├─ 失败重试 ≤ 2 次（指数退避 1s/2s）（FR-005）
   │     ├─ 写 run-<i>.json (FR-004)
   │     └─ 累加 totalCostUsd
   ├─ Phase 2 聚合 per (task, tool):
   │     ├─ 计算 oraclePassRate / surfaceRefusalRate / juryMedianSamples[]
   │     ├─ 调 bootstrap-ci(juryMedianSamples) → {low, high, b, samples} (FR-008/9/10/11)
   │     └─ 写 aggregate.json (FR-006)
   └─ 输出 console summary
   ↓
[eval-report.mjs]
   ├─ 扫 tests/baseline/repeats/**/aggregate.json
   ├─ 存在 → §4.1 渲染 "<median> [low,high] (n=<actualN>×<task 数>)" 格式 (FR-012)
   │        + 重叠工具标 "分差不显著（CI overlap）" (FR-013)
   │        + §4.3 加 "Bootstrap CI 视角下的工具排名" 子节 (FR-014)
   └─ 不存在 → 走原 single-run 渲染（向后兼容）
```

### 模块边界

- **`scripts/lib/bootstrap-ci.mjs`** — 纯函数，零副作用，零依赖
  - export `bootstrapPercentileCi(samples: number[], opts?: { b?: number; alpha?: number; rng?: () => number }): { low: number|null; high: number|null; b: number; samples: number; method: 'percentile'; reason?: string }`
  - opts.rng 注入用于测试可重现性（默认 Math.random）
  - alpha 默认 0.05（即 95% CI，取 [2.5%, 97.5%] 分位）

- **`scripts/eval-batch-repeat.mjs`** — orchestrator，不含算法
  - import `executeOnFixture`, `listAllTaskTool`, `SUPPORTED_TOOLS` from eval-task-executor
  - import `runJuryOnFixture` from eval-judge-jury（如 executeOnFixture 已内含 jury 调用，则按现有合约）
  - import `bootstrapPercentileCi` from lib/bootstrap-ci
  - CLI 用 `node:util.parseArgs`（Node 20+ 内建，零依赖）

- **`scripts/eval-report.mjs`** — 仅扩展 §4.1 / §4.3 渲染分支
  - 新增辅助函数 `loadRepeatAggregates(): Map<string, RepeatAggregate>` 扫盘
  - §4.1 渲染前判断 aggregate 是否存在；存在用新格式，否则原格式

### 关键算法：Percentile Bootstrap CI

```js
// 伪代码（实际实现 ~30 行）
function bootstrapPercentileCi(samples, { b = 1000, alpha = 0.05, rng = Math.random } = {}) {
  if (samples.length < 3) return { low: null, high: null, b, samples: samples.length, method: 'percentile', reason: 'insufficient-samples' };
  const n = samples.length;
  const replicates = new Array(b);
  for (let i = 0; i < b; i++) {
    let sum = 0;
    const resample = new Array(n);
    for (let j = 0; j < n; j++) resample[j] = samples[Math.floor(rng() * n)];
    resample.sort((a, b) => a - b);
    // median of resample
    replicates[i] = n % 2 === 1 ? resample[(n - 1) / 2] : (resample[n / 2 - 1] + resample[n / 2]) / 2;
  }
  replicates.sort((a, b) => a - b);
  const lowIdx = Math.floor(b * (alpha / 2));
  const highIdx = Math.ceil(b * (1 - alpha / 2)) - 1;
  return {
    low: replicates[lowIdx],
    high: replicates[highIdx],
    b,
    samples: n,
    method: 'percentile',
  };
}
```

不变量：
- `low ≤ median(samples) ≤ high`（FR-011）
- 全相同样本 → `low === high === sample[0]`（FR-011 / SC-007 case "N=5 全相同"）
- N < 3 → `{low: null, high: null, reason: 'insufficient-samples'}`（FR-010）

### Failure Mode 处理

| 场景 | 处理 | 对应 FR |
|------|------|---------|
| 单 run GLM API 超时/429 | 重试 2 次（指数退避 1s, 2s），仍失败 → run 标 `failed` 入 `failedRuns[]` | FR-005 / Edge case |
| 任一 jury vendor 全部失败 | 复用 Sprint 3 fallback：median 从可用 vendor 算，aggregate.json 记 `vendorCoverage` | Edge case |
| Fixture 缺失 | dry-run 阶段一次性校验，缺失立即 abort | FR-002 |
| 总成本 > $30 | abort，除非 --confirm-budget | FR-003 / SC-005 |
| `executorRationale` 缺失 | 该 run 不计入 surfaceRefusal 分母，仍计入 oracle / jury | FR-007 |
| 写盘冲突 | 每 run 独立路径 `run-<i>.json` | Edge case |
| N < 3 | bootstrap 返回 null，§4.1 该 fixture 显示 single-run 数字 + "n=<X> insufficient for CI" 标注 | FR-010 |

## Implementation Strategy

### 文件 1: `scripts/lib/bootstrap-ci.mjs`

实现要点：
- 单一 export `bootstrapPercentileCi`
- 不读盘、不 spawn、不 import 任何项目模块（pure function）
- 防御性：samples 必须是 finite number 数组，否则 throw `TypeError`
- rng 注入设计便于单测确定性（fixture 用 seedable PRNG）

### 文件 2: `scripts/eval-batch-repeat.mjs`

实现要点：
- CLI 参数：`--task <id>`、`--tool <name>`、`--n <int>`（默认 5）、`--all-fixtures`、`--confirm-budget`、`--concurrency <int>`（默认 1）、`--b <int>`（bootstrap B，默认 1000）、`--dry-run`、`--out-dir <path>`
- 主流程：
  1. 解析 args；`--n < 1` 直接 reject；`--n === 1` reject（无统计意义）；`--n === 2` warn 但继续
  2. enumerate targets：单 (task, tool) 或 listAllTaskTool() 全集
  3. dry-run：校验所有 fixture 路径 + schema 1.1 字段（spot-check `taskExecution.juryScores` 存在）+ 调用成本表估算
  4. 预算 gate：cost > $30 且无 `--confirm-budget` → abort
  5. 串行循环：对每 (task, tool, runIdx) 调 `executeOnFixture(...)`（复用 fixture path 逻辑但写入 repeats 目录）
  6. retry wrapper：try → 失败 sleep 1s 重试 → 失败 sleep 2s 重试 → 失败标 failed
  7. 每个 fixture N run 完成后，立即聚合写 aggregate.json（避免中间崩溃丢数据）
  8. 全部完成后输出 console table summary
- 默认 concurrency=1（spec 风险 2：避免限流）
- 写盘原子性：写 `aggregate.json.tmp` → rename，避免半完成文件被 eval-report 误读

### 文件 3: `scripts/eval-report.mjs` 修改

实现要点：
- 新增 `loadRepeatAggregates()` 函数：glob `tests/baseline/repeats/*/*/aggregate.json`，返回 Map<taskTool, aggregate>
- §4.1 渲染主循环开头：先 load repeats；存在则切渲染分支
- 新格式：`7.8 [6.5, 9.0] (n=5×4 task)`；overlap detect: 两两比对 [low_A, high_A] ∩ [low_B, high_B] 非空 → 标记
- 不修改原 single-run 路径，**向后兼容**（用户没跑 repeats 时输出与现在一致）

### 文件 4: `package.json`

加一行 script：

```json
"eval:repeat": "node scripts/eval-batch-repeat.mjs"
```

不引入新依赖。

### 文件 5: manual report §4.2.a 升级（T-013，依赖 T-012 实测结果）

依据 P1 / P2 实测数字回填；若 surfaceRefusalRate < 80%，按 FR-016 显式撤回原结论。

## Testing Strategy

### Unit Tests (vitest)

**`tests/unit/bootstrap-ci.test.ts`** — SC-007 要求至少 5 个用例：

1. `N < 3 returns insufficient-samples`：输入 `[7]` / `[7, 8]` → low/high = null + reason
2. `N = 3 normal case`：输入 `[6, 7, 8]` + 固定 seed rng → low ≤ 7 ≤ high，区间合理
3. `N = 5 all same`：输入 `[7, 7, 7, 7, 7]` → low === high === 7
4. `N = 5 with outlier`：输入 `[6, 7, 7, 7, 9]` + 固定 seed → high - low > 0，median in interval
5. `B parameter respected`：B=100 与 B=1000 同输入下区间宽度差异稳定（用 fixed seed）
6. `Invariant: low ≤ median(samples) ≤ high` 任意 N≥3 输入下成立（property-based 风格，5 random seeds）
7. `Throws on non-finite input`：`[NaN, 7, 7]` → throw TypeError

**`tests/unit/eval-batch-repeat.test.ts`** — 至少覆盖：

1. `--n 1` rejects with non-zero exit
2. `--n 2` warns but proceeds（spy console.warn）
3. dry-run mode：mock `executeOnFixture` 不被调用，仅打印 plan
4. fixture 缺失时 abort + 打印缺失清单
5. 预算超 $30 无 `--confirm-budget` → abort
6. retry logic：mock `executeOnFixture` 第 1 次 throw、第 2 次 throw、第 3 次 success → 最终成功
7. retry 全部失败 → run 标 failed，aggregate.json 仍写入（含 `failedRuns[]`）
8. surfaceRefusalRate 计算：3 run 含 rationale + 2 run 缺失 → rate = (含 surface keyword 的 run 数) / 3，分母不算缺失的 2 个

### Integration Test

T-011 dry-run：实跑 `npm run eval:repeat -- --task T6-violation-refusal --tool spec-driver-spectra --n 3 --dry-run`，验证 plan 输出 + 不发生实际 API 调用。

### 实测验证（T-012）

T6 spec-driver-spectra n=5 实跑（约 $1，5-8 min），写入 `tests/baseline/repeats/T6-violation-refusal/spec-driver-spectra/`，spot-check：
- 5 个 run-i.json 均含完整 schema 1.1 字段
- aggregate.json 含 surfaceRefusalRate / oraclePassRate / juryMedianSamples / bootstrapCi
- surfaceRefusalRate ≥ 80%（SC-001）

随后全套 25 fixture × 5 run 实跑（~$25，~2h），写入全部 `tests/baseline/repeats/<task>/<tool>/aggregate.json`（SC-002）。

### 提交前 Quality Gate

T-014：
1. `npx vitest run` 零失败（含新增 unit tests）
2. `npm run build` 零类型错误（虽无 src/ 改动，但 vitest TS 解析覆盖单测文件）
3. `npm run repo:check` 通过（同步合约校验）
4. Codex 对抗审查（CLAUDE.local.md 要求）

## Performance / Cost

| 项目 | 估算 |
|------|------|
| 单 GLM driver 调用 | ~$0.05 |
| 单 fixture jury 调用（3 vendor 各 1 次） | ~$0.15 |
| 单 fixture × 1 run 总成本 | ~$0.20 |
| 25 fixture × 5 run | 25 × 5 × $0.20 = **$25** |
| 余量（重试 + jury fallback 重调） | ~$2 |
| **预算上限（FR-003 + SC-005）** | **$30** |
| 实测耗时（concurrency=1，单 run 30-60s） | ~2h |

预算 gate（FR-003）：repeat-runner 启动时按 `--n × 目标 fixture 数 × $0.20` 估算；> $30 abort。

## Constitution Re-check (Post-Design)

设计完成后再次核验：

- ✅ 仍零 src/ 改动（FR-017 + Constitution II）
- ✅ 零新 npm 依赖（FR-018，bootstrap 自实现）
- ✅ 不覆盖 single-run baseline（FR-019）
- ✅ 不为"未来 BCa method"加 strategy 抽象（YAGNI / Constitution III）
- ✅ aggregate.json 含显式降级字段（actualN / failedRuns / reason: 'insufficient-samples'，Constitution IV）
- ✅ vitest + build + repo:check 跑通是 T-014 必跑项

**Constitution Check 仍通过**，无需 Complexity Tracking。

## Complexity Tracking

> 本 Feature 无 Constitution violation，本节留空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| —         | —          | —                                   |
