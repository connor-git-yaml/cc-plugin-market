---
feature: 210-fix-eval-validate-infra-oracle
mode: fix
based_on: fix-report.md（方案 A）
status: planned
---

# 修复规划 — eval-validate.mjs 汇总层 infra-oracle 假报

> **rev.1（2026-07-11）**：按设计阶段 codex 对抗审查（0C/4W/4I）修订——桶名
> `n_oracle_infra` → `n_oracle_error`（W-1：error 也可能 failureSource='fixture'，名字对齐
> classification 而非归因）；`readOracleOutcome` 改穷尽映射（W-2：unavailable/未知漂移值
> → null 剔分母）；take1 复现场景的 main 层出口修正为 FR-006 floor exit 2 而非 W-4（W-3）；
> 单测 11 → 15 条（W-4）。处置详情见 fix-report.md 末节。

## 1. 修复目标（对齐 fix-report 方案 A）

`scripts/eval-validate.mjs` 的汇总层新增第四态 `n_oracle_error` 桶：当 `success` run 的
`taskExecution.primaryOracle.classification === 'error'`（oracle 未真正执行——failureSource
可能是 'infra' 如 venv 缺失导致 `cmd="(skipped: dataset build error)"`，也可能是 'fixture'
如 dataset mismatch；两者都是"仪器/夹具未评估候选"）时，不再落入 `n_pass=0/n_valid=1` 的
假 fail，而是剔分母 + 计入 `infraFailRate` 分子，与 `n_infra`/`n_error`/`n_oracle_missing`
同列"无法评估"。修复后 take1 场景（3/3 oracle-error）`infraFailRate=1.0 > 0.20` 触发既有
FR-006 floor（`process.exit(2)`，错误信息含 oracle_error 计数），不再让 `/goal` 拿到假
`passRate=0.0`；W-4 fail-closed（`n_valid=0`）作为混合场景（无法评估占比低于 floor 但有效
样本为零）的后备出口，两分支同 exit 2。

**范围边界（严格遵守 fix-report 影响范围扫描结论）**：
- 只改 `scripts/eval-validate.mjs`。
- **不改** `scripts/lib/classify-oracle.mjs`（源码摘要纳入 `oracleSpecHash` 预注册校验，任何
  改动触发校验失败；本次也不需要改，`classifyRunForRanking` 的 error→null 口径已是参照对象）。
- **不改** `scripts/eval-calibrate.mjs` 的 `oraclePassedFromFixture` / 内部 `readOraclePassed`
  （calibrate 侧 false-on-error 是有意的保守口径，注释已明示；转 follow-up 候选，不在本次范围）。

## 2. 具体变更清单

### 2.1 新增 `readOracleOutcome(fixturePath)`（新导出函数，不改动 `readOraclePassed`）

在 `scripts/eval-validate.mjs` 内新增一个独立导出函数，**不修改**现有 `readOraclePassed`
（L175-179，保持原样，其 6 个既有单测零改动继续通过）：

```js
/**
 * 从 fixture JSON 文件读 oracle 结果的四态 outcome（true=pass / false=候选 fail /
 * null=不可评估（fixture 不可读、无 oracle 字段、classification 为 unavailable/未知漂移值）/
 * 'oracle_error'=oracle 因基建/夹具问题未真正执行（primaryOracle.classification==='error'，
 * failureSource 可为 'infra' 如 venv 缺失 → dataset build 失败，或 'fixture' 如 dataset
 * mismatch；同 classifyRunForRanking 的 error 口径，但单独分桶保留诊断信息）。
 *
 * classification 穷尽映射（codex W-2）：'pass'→true / 'fail'→false / 'error'→'oracle_error' /
 * 其他已知外值（legacy 'unavailable'、未知漂移）→null 剔分母（与 classifyRunForRanking
 * :122-127 同口径，保守 fail-closed）。仅当 classification 字段**不存在**（legacy
 * {kind,passed} 结构 / swebenchResult fallback）才回退 passed===true 二值，行为与现状一致。
 *
 * 字段提取链与 oraclePassedFromFixture（eval-calibrate.mjs:415-419）一致（primaryOracle
 * ?? swebenchResult ?? oracleResult ?? result）。canonical fixture 中 baseResult
 * （swebench-oracle.mjs:247-252）保证 passed = classification==='pass'，pass/fail 两行判
 * classification 与判 passed 等价。
 */
export function readOracleOutcome(fixturePath) {
  try {
    const fix = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    const oracle = fix?.taskExecution?.primaryOracle
      ?? fix?.swebenchResult ?? fix?.oracleResult ?? fix?.result;
    if (oracle == null) return null;
    if ('classification' in oracle) {
      const c = oracle.classification;
      if (c === 'pass') return true;
      if (c === 'fail') return false;
      if (c === 'error') return 'oracle_error';
      return null; // legacy 'unavailable' / 未知漂移值 → 剔分母（fail-closed）
    }
    return oracle.passed === true; // legacy {kind,passed}：无 classification 字段才走二值
  } catch { return null; }
}
```

返回值类型刻意对齐 `computeValidationStats` 现有 `getOraclePassed` 回调契约
（`boolean|null`），只新增一个 `'oracle_error'` 哨兵值，**不**采用 fix-report 文字描述的
四字符串枚举 —— 后者会要求同时重写 `computeValidationStats` 内部分桶逻辑与全部既有
T-C3 mock（这些 mock 直接构造 `true`/`false`/`null` 回调，与 outcome 字符串不兼容），
扩大回归面且与"最小化变更范围"的 fix 原则冲突。采用 `boolean|null|'oracle_error'` 净增量
方案，`computeValidationStats` 现有分支保持字面不变，仅新增一条 `'oracle_error'` 判断。
哨兵是 truthy 字符串——必须在 `if (passed)` truthy 判断**之前**分流（分支顺序由单测锁定，
codex W-4 防御用例）。

### 2.2 `computeValidationStats(results, getOraclePassed)`（L100-138）—— 净增量式扩展

回调契约由 `boolean|null` 扩展为 `boolean|null|'infra'`（`getOraclePassed` 参数名保留不
改，签名位置/顺序不变，只放宽可接受返回值集合，不引入新形参）：

```js
if (r.status === 'success') {
  const passed = getOraclePassed ? getOraclePassed(r) : null;
  if (passed === 'oracle_error') {
    // oracle 因基建/夹具问题未真正执行（仪器坏了，非候选 fail）→ 剔分母，单独计数。
    // 哨兵是 truthy 字符串，必须先于下方 if (passed) truthy 判断分流（顺序由单测锁定）
    n_oracle_error++;
    continue;
  }
  if (passed === null) {
    n_oracle_missing++;
    continue;
  }
  n_valid++;
  if (passed) { n_pass++; passSamples.push(1); }
  else { passSamples.push(0); }
  continue;
}
```

其余分支（`infra` status / `gen_timeout` / `error`）字面不变。

新增局部变量 `n_oracle_error = 0`（与其余计数器同一行声明），纳入返回对象：

```js
return { passRate, ci, n_valid, n_pass, n_infra, n_gen_timeout, n_error,
         n_oracle_missing, n_oracle_error, infraFailRate, n_total: results.length };
```

`infraFailRate` 分子补 `n_oracle_error`（与 `n_infra`/`n_error`/`n_oracle_missing` 同列
"无法评估"）：

```js
const infraFailRate = results.length > 0
  ? (n_infra + n_error + n_oracle_missing + n_oracle_error) / results.length
  : 0;
```

函数头部 JSDoc（L85-99）补一行 `n_oracle_error` 语义说明，与既有 `n_oracle_missing` 并列。

### 2.3 `main()` 接线（L293 / L297 / L304 / L309-326 / L336）

| 行 | 现状 | 变更 |
|---|------|------|
| L293 | `computeValidationStats(results, (r) => r.fixturePath ? readOraclePassed(r.fixturePath) : null)` | 回调改用 `readOracleOutcome`：`(r) => r.fixturePath ? readOracleOutcome(r.fixturePath) : null` |
| L297 | infraFailRate 超阈错误信息只报 `infra=${n_infra} oracle_missing=${n_oracle_missing}` | 追加 `oracle_error=${stats.n_oracle_error}` |
| L304 | n_valid=0 错误信息同上 | 同上追加 `oracle_error=${stats.n_oracle_error}` |
| L309-326 | 输出 JSON 无 `n_oracle_error` 字段 | 新增 `n_oracle_error: stats.n_oracle_error` 字段（紧邻 `n_oracle_missing` 之后） |
| L336 | 摘要行 `passRate=... n=... infra=... wall=...` | 追加 `oracle_error=${stats.n_oracle_error}` |

不改动 L296（floor 比较逻辑本身）、L303（`n_valid===0` 判断本身）——两处判据字面不变，
自动因 `computeValidationStats` 分桶修正而生效。**main 层出口顺序（codex W-3 修正）**：
3/3 oracle-error 场景 `infraFailRate=1.0 > 0.20`，先命中 L296 FR-006 floor 分支 exit 2
（错误信息含 oracle_error 计数）；L303 W-4（`n_valid===0`）是混合场景（无法评估占比 ≤
floor 但有效样本为零，如 n=50 中 10 个 oracle_error + 40 个 status infra 被剔后……实际
该场景 infraFailRate 也超 floor，W-4 真正兜底的是理论边界）的后备。两分支同 exit 2，
/goal 侧行为等价（识别为"本轮无效"），不调整检查顺序。

## 3. 向后兼容路径

| 场景 | fixture 形态 | `readOracleOutcome` 返回 | 说明 |
|------|-------------|--------------------------|------|
| canonical pass | `taskExecution.primaryOracle.classification==='pass'` | `true` | `baseResult` 保证 `passed = classification==='pass'`，判 classification 与判 passed 等价 |
| canonical fail | `classification==='fail'` | `false` | 同上，`passed=false` |
| canonical error（infra 源） | `classification==='error', failureSource==='infra'` | `'oracle_error'` | 新增分支，本次修复核心（venv 缺失等） |
| canonical error（fixture 源） | `classification==='error', failureSource==='fixture'` | `'oracle_error'` | 同桶（codex W-1：dataset mismatch / W1 mismatch 也是仪器未评估候选），桶名对齐 classification |
| legacy 'unavailable' / 未知漂移 classification | `classification` 存在但非 pass/fail/error | `null` | codex W-2：与 classifyRunForRanking:122-127 同口径剔分母，归 `n_oracle_missing`（fail-closed） |
| legacy（无 `classification` 字段，如旧 `{kind,passed}` / `swebenchResult` fallback） | 无 `classification` | `oracle.passed===true` 的布尔值 | 仅此场景回退二值，与现状 `readOraclePassed` 行为一致 |
| fixture 不可读 / JSON 损坏 / 无任何 oracle 字段 | — | `null` | 与 `readOraclePassed` 现状语义一致，归 `n_oracle_missing` |

## 4. 回归风险评估

### 4.1 `getOraclePassed` 回调契约变更的影响面

搜索确认（Grep，`scripts/` + 全仓）：`computeValidationStats` 与 `readOraclePassed` 仅有
两处引用者——`scripts/eval-validate.mjs` 自身 `main()`（L293 唯一调用点）与
`tests/unit/feature-206-calibrated-harness.test.ts`（T-C3 / T-C9 两个 describe 块）。
无其他脚本 `import` 本文件符号，无外部 caller。

- **`main()` 调用点**：本计划已在 2.3 节显式改为传 `readOracleOutcome`；`computeValidationStats`
  的回调"读什么" 由调用方决定，函数体内部分桶逻辑对 `boolean|null` 输入字面不变
  （新增 `'infra'` 分支不影响原有 `true`/`false`/`null` 路径的判断顺序或结果）。
- **T-C3 `computeValidationStats` 既有单测**（L748-859，8 个 `it`）：这些用例直接构造本地
  `oracle` mock（`(r) => true|false|null`，不经过 `readOraclePassed`/`readOracleOutcome`），
  从未产出 `'oracle_error'` 返回值 → **零改动、零回归**（新增的 `passed === 'oracle_error'`
  分支永不命中这些既有 mock，保持原判定路径）。
- **T-C9 `readOraclePassed` 既有单测**（L460-486，6 个 `it`）：测的是 `readOraclePassed`
  本体，本次不改该函数 → **零改动、零回归**。
- **T-C9 `buildValidationJobs` / `CALIBRATION_COHORT_TO_TOOL` 既有单测**：与本次改动无交集，
  不受影响。

### 4.2 潜在遗漏点

- `readOracleOutcome` 与 `oraclePassedFromFixture` 字段提取链（`primaryOracle ??
  swebenchResult ?? oracleResult ?? result`）重复书写（未跨文件复用），但两者维护主体
  不同（`eval-calibrate.mjs` 明确"本次不改"），重复优于跨文件引入隐式耦合；若未来该链路
  再变需同步改两处——已在函数 JSDoc 注明"与 oraclePassedFromFixture 一致"作为可追溯锚点。
- `infraFailRate` 分母口径不变（仍是 `results.length`），只是分子多算一类，不影响既有
  `n_infra` 单飞场景（全 infra→`n_oracle_error`恒 0，无交叉污染，两桶来源不同 status
  分支：`n_infra` 来自 `r.status==='infra'`，`n_oracle_error` 来自 `r.status==='success'`
  内部再判定，互斥不重叠）。
- `'oracle_error'` 哨兵是 truthy 字符串：若未来重构把哨兵分支挪到 `if (passed)` truthy
  判断之后，会被误计 pass——由防御单测（构造回调直接返回 `'oracle_error'`，断言
  `n_pass===0 && n_valid===0 && n_oracle_error===1`）锁定分支顺序（codex W-4）。

## 5. 验证方案

### 5.1 新增单测（`tests/unit/feature-206-calibrated-harness.test.ts`）

在 T-C3 `computeValidationStats` describe 块内新增（贴合既有用例风格，直接构造回调而非
真实文件 I/O）：

1. `success + getOraclePassed 返回 'oracle_error' → 计入 n_oracle_error，剔分母（不算 fail）`
   （单条 oracle_error + 一条 pass，断言 `n_oracle_error===1`、`n_valid===1`、`passRate===1`）
2. `全 'oracle_error' → n_valid=0 + passRate=null（fail-closed 触发条件），infraFailRate=1`
   （对齐既有"全 error"/"全 oracle 缺失"两个同构用例的断言风格）
3. `'oracle_error' 与 'error'/'infra'-status/'oracle_missing' 混合 → 四桶互不覆盖`
   （构造 `status='infra'` 一条 + `status='success'`+`getOraclePassed→'oracle_error'` 一条 +
   `status='success'`+`getOraclePassed→null` 一条 + `status='error'` 一条，断言
   `n_infra===1 && n_oracle_error===1 && n_oracle_missing===1 && n_error===1 && n_valid===0`）
4. **truthy 哨兵防御（codex W-4）**：`'oracle_error' 是 truthy 字符串但绝不计 pass`
   （回调恒返 `'oracle_error'`，断言 `n_pass===0 && n_valid===0 && n_oracle_error===N`；
   锁定哨兵分支必须先于 `if (passed)` truthy 判断）

新增 `readOracleOutcome` 独立 describe 块（贴合 T-C9 `readOraclePassed` 现有用 `tmpFixture`
写临时文件的风格）：

5. `classification==='pass' → true`
6. `classification==='fail' → false`
7. `classification==='error' (failureSource='infra') → 'oracle_error'`（核心回归用例）
8. `classification==='error' (failureSource='fixture'，如 W1 mismatch) → 'oracle_error'`
   （codex W-1：夹具错同桶，桶名对齐 classification）
9. `classification==='unavailable'（legacy）→ null`（codex W-2：与 classifyRunForRanking
   同口径剔分母）
10. `classification 为未知漂移值（如 'weird-future-value'）→ null`（codex W-2）
11. `legacy（无 classification 字段，仅 {kind,passed:true}）→ true`（向后兼容）
12. `legacy（无 classification 字段，仅 {kind,passed:false}）→ false`（向后兼容）
13. `文件不存在 / JSON 损坏 → null`
14. `fixture 无任何 oracle 字段（{}/{taskExecution:{}}）→ null`
15. **take1 复现场景**：3 条 `status='success'` fixture 均为
    `{taskExecution:{primaryOracle:{classification:'error', failureSource:'infra',
    passed:false, cmd:'(skipped: dataset build error)'}}}}` → 经
    `computeValidationStats(results, (r) => readOracleOutcome(r.fixturePath))` 断言
    `n_oracle_error===3 && n_valid===0 && passRate===null && infraFailRate===1`
    （直接钉死 fix-report 描述的故障复现语义："3/3 oracle-error → n_valid=0，main 层由
    FR-006 floor exit 2 拦截"，而非此前 "n_valid=3 / n_infra=0" 的假报）

### 5.2 需要跑的回归

1. `npx vitest run tests/unit/feature-206-calibrated-harness.test.ts` — 必须全绿（含本次
   新增 15 条 + 既有全部用例零回归）。
2. `npx vitest run`（全量）— 确认无跨文件副作用（本次改动不涉及其他模块，预期零影响）。
3. `npm run build` — 类型检查零错误（`.mjs` 无 tsc 直接编译但仓库 build 可能含 lint/type
   check 链路，按仓库约定跑一遍）。

### 5.3 明确不做

- 不跑真实 docker/swebench harness 端到端复现（本次改动是纯函数汇总逻辑，单测 mock 已
  覆盖三态语义；真实基建复现成本高且不改变判定逻辑正确性结论）。
- 不改 `scripts/eval-calibrate.mjs` / `scripts/lib/classify-oracle.mjs`（见第 1 节范围边界）。
- 不更新 spec（F206 spec 的 FR-006 infra floor / W-4 fail-closed 语义不变，本修复只是让
  oracle 侧 infra 正确进入既有语义，不改合同，fix-report 已确认）。

## 6. 工具使用反馈（Dogfooding）

本次规划阶段尝试用 `mcp__plugin_spectra_spectra__impact` 查 `readOraclePassed` /
`computeValidationStats` 的 caller（按 caller-analysis 场景应优先 MCP）：两次调用均返回
`symbol-not-found`，`fuzzyMatches` 全部指向仓库内无关的 `_reference/GitNexus/` 索引条目，
说明当前 graph 未覆盖 `scripts/*.mjs`（评测 harness 脚本不在 graph 建图范围内，或 graph
已过期/未针对本 worktree 重建）。降级用 Grep 全仓搜索确认调用方，结果与 fix-report 的
影响范围扫描结论一致（唯一调用点为 `main()` 与既有单测文件）。建议后续把
`scripts/**/*.mjs` 纳入 Spectra graph 建图范围（或确认当前 self-dogfood baseline 是否本就
排除 `scripts/`），否则评测 harness 相关的 fix/refactor 任务无法享受 MCP caller-analysis
优势，只能反复退化到 Grep。
