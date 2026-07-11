---
feature: 210-fix-eval-validate-infra-oracle
mode: fix
based_on: plan.md（方案 A）
status: ready
---

# 修复任务 — eval-validate.mjs 汇总层 infra-oracle 假报

> **rev.1（2026-07-11）**：按设计阶段 codex 对抗审查（0C/4W）同步 plan.md rev.1——桶名
> `n_oracle_error`、哨兵 `'oracle_error'`、classification 穷尽映射、单测 11→15 条、
> take1 场景 main 层出口为 FR-006 floor exit 2。

**输入**: `fix-report.md`（5-Why 根因 + codex 处置）+ `plan.md` rev.1（方案 A 变更清单）
**范围边界**: 只改 `scripts/eval-validate.mjs`；不改 `scripts/lib/classify-oracle.mjs`、`scripts/eval-calibrate.mjs`

## 任务列表

- [x] T001 新增 `readOracleOutcome(fixturePath)` 导出函数
  **文件**: `scripts/eval-validate.mjs`（新增函数，紧邻 `readOraclePassed`，L175 附近，不修改 `readOraclePassed` 本体）
  **内容**: 字段提取链对齐 `oraclePassedFromFixture`（`primaryOracle ?? swebenchResult ?? oracleResult ?? result`）；`oracle == null → null`；classification 穷尽映射（`'classification' in oracle` 时：`'pass'→true / 'fail'→false / 'error'→'oracle_error' / 其他值（legacy 'unavailable'、未知漂移）→null`）；仅无 classification 字段才回退 `oracle.passed === true`（legacy {kind,passed} 兼容）；`catch → null`。JSDoc 说明四态语义、与 `classifyRunForRanking` error/unavailable 口径对齐但单独分桶保留诊断信息。
  **验收**: 函数导出可被测试文件 import；不修改 `readOraclePassed` 任何字符。

- [x] T002 `computeValidationStats` 净增量扩展支持 `'oracle_error'` 哨兵值
  **文件**: `scripts/eval-validate.mjs`（L100-138 `computeValidationStats`）
  **内容**: `success` 分支内 `getOraclePassed` 返回值新增 `passed === 'oracle_error'` 判断分支 → `n_oracle_error++` 并 `continue`（**必须置于 `passed === null` 与 `if (passed)` truthy 判断之前**——哨兵是 truthy 字符串，顺序错误会误计 pass）；新增局部计数器 `n_oracle_error = 0`；返回对象新增字段 `n_oracle_error`；`infraFailRate` 分子补 `n_oracle_error`（`(n_infra + n_error + n_oracle_missing + n_oracle_error) / results.length`）；函数头部 JSDoc 补充 `n_oracle_error` 语义说明。其余分支（`infra` status / `gen_timeout` / `error` / `passed===null` / `passed===true|false`）字面不变。
  **验收**: 既有 T-C3 mock（直接构造 `true|false|null` 回调）行为零变化；新增 `'oracle_error'` 分支不影响原判断顺序。

- [x] T003 `main()` 接线新桶字段
  **文件**: `scripts/eval-validate.mjs`（L293 聚合调用 / L297 & L304 fail-closed 错误信息 / L309-326 输出 JSON / L336 摘要行）
  **内容**:
  - L293 聚合调用回调改为 `(r) => r.fixturePath ? readOracleOutcome(r.fixturePath) : null`（原 `readOraclePassed` 替换为 `readOracleOutcome`）
  - L297（infraFailRate 超阈错误信息）、L304（`n_valid===0` 错误信息）追加 `oracle_error=${stats.n_oracle_error}`
  - L309-326 输出 JSON 新增 `n_oracle_error: stats.n_oracle_error` 字段（紧邻 `n_oracle_missing` 之后）
  - L336 摘要行追加 `oracle_error=${stats.n_oracle_error}`
  - 不改动 L296（floor 比较逻辑本身）、L303（`n_valid===0` 判断本身）字面 —— 依赖 T002 分桶修正自动生效
  **验收**: 3/3 oracle-error 场景下 `infraFailRate=1.0 > 0.20` 触发既有 FR-006 floor `process.exit(2)`（错误信息含 oracle_error 计数；W-4 n_valid=0 为后备出口，两分支同 exit 2）；JSON 输出含 `n_oracle_error` 字段。

- [x] T004 新增单测覆盖四态语义（`computeValidationStats` + `readOracleOutcome`）
  **文件**: `tests/unit/feature-206-calibrated-harness.test.ts`
  **内容**: 按 plan.md rev.1 §5.1 新增 15 条用例：
  - T-C3 `computeValidationStats` describe 块内 4 条（单条 oracle_error 剔分母不算 fail / 全 oracle_error → n_valid=0+passRate=null+infraFailRate=1 / 四桶混合互不覆盖 / **truthy 哨兵防御**：回调恒返 'oracle_error' 断言 n_pass===0 && n_valid===0）
  - 新增 `readOracleOutcome` describe 块 11 条（classification pass/fail/error(infra 源)/error(fixture 源) + unavailable→null + 未知漂移值→null + legacy passed:true/false 回退 + 文件不存在/JSON 损坏 + 无 oracle 字段 + take1 复现场景：3 条 success+classification='error' fixture 经 `computeValidationStats` 断言 `n_oracle_error===3 && n_valid===0 && passRate===null && infraFailRate===1`）
  **验收**: 15 条新用例全绿；既有全部用例（T-C3 8 条 + T-C9 6 条 + 其他）零回归。

- [x] T005 回归验证
  **文件**: 无（验证任务）
  **内容**:
  1. `npx vitest run tests/unit/feature-206-calibrated-harness.test.ts` 全绿
  2. `npx vitest run`（全量）零失败
  3. `npm run build` 类型检查零错误
  **验收**: 三项命令均无失败/报错；输出记录于交付报告。

- [x] T006 Codex 对抗审查 + 收尾（按仓库约定：commit 前必跑）
  **文件**: 无（流程任务）
  **内容**: 通过 `codex:codex-rescue` 子代理对 T001-T004 改动做对抗性审查（挑战为先视角）；critical/warning 项修复后重跑 T005；在交付报告中记录 codex 结论处置情况。
  **验收**: codex critical 项清零或有明确合理性判断记录；重跑测试仍全绿。

## 依赖关系

- T001 → T002（`computeValidationStats` 的单测复现场景需要 `readOracleOutcome` 已存在，但函数体本身可独立实现）
- T002 → T003（`main()` 接线依赖分桶逻辑已扩展）
- T001 + T002 + T003 → T004（单测覆盖三者行为）
- T004 → T005 → T006（先测后验后审）

无并行任务标记：本次改动集中在单文件 `scripts/eval-validate.mjs` 的同一函数簇，串行执行风险更低（避免同文件并发编辑冲突）。

## FR / 根因覆盖映射

| 根因项 | 对应任务 |
|--------|---------|
| `readOraclePassed` 只读二值 `passed`，无 classification 判断 | T001（新增 `readOracleOutcome` 四态读取，不改动原函数） |
| `computeValidationStats` 无 oracle_error 桶，success run 的 oracle-error 落入 fail 分母 | T002 |
| `main()` 聚合/输出/摘要未接线新桶 | T003 |
| 单测缺 classification='error' 负例（含 fixture 源 / unavailable / 未知漂移 / truthy 防御） | T004 |
| 需确认修复后 take1 场景触发既有 fail-closed 语义（FR-006 floor exit 2） | T004（复现用例）+ T005 |
