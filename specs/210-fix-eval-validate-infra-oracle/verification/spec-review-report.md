# Spec 合规审查报告 — F210 eval-validate 汇总层 infra-oracle 假报修复

> 审查执行:spec-driver:spec-review 子代理(sonnet),2026-07-11;子代理无 Write 权限,由编排器落盘存档。

## 审查范围与方法

本任务为 `mode: fix`(无 spec.md FR 清单),审查基准改为 fix-report.md 根因结论 + plan.md rev.1 变更清单 + tasks.md rev.1 验收标准三者与实际代码的逐项比对。已直接 Read 全文:
- `scripts/eval-validate.mjs`(当前工作区完整状态,408 行)
- `tests/unit/feature-206-calibrated-harness.test.ts`(相关 describe 块,L1-55、L446-1004)
- `scripts/lib/classify-oracle.mjs`(`classifyRunForRanking`,确认参照口径未变)
- `scripts/eval-calibrate.mjs`(`oraclePassedFromFixture`/`readOraclePassed`,确认范围外文件零改动)

**工具使用说明**:按偏好规则本应优先用 `mcp__plugin_spectra_spectra__context/impact` 核对 caller 一致性,但 plan.md §6 已记录本 feature 规划阶段两次调用均返回 `symbol-not-found`(graph 未覆盖 `scripts/*.mjs`),本次审查复测同一限制仍成立,故按任务提示直接 Read/Grep 验证,与规划阶段结论一致,非新发现问题。

## 逐项核对结果

| 序号 | 核对项 | 结论 | 证据 |
|------|--------|------|------|
| 1 | `readOracleOutcome` classification 穷尽映射 + legacy 回退 | **一致** | `scripts/eval-validate.mjs:213-228`:`pass→true / fail→false / error→'oracle_error' / 其他(含 unavailable/未知漂移)→null`;无 `classification` 字段才回退 `passed===true`;`catch→null`。与 plan §2.1 rev.1 骨架逐字符对齐 |
| 2 | `'oracle_error'` 哨兵分支置于 `null` 判断与 truthy 判断之前 | **一致(T002 验收满足)** | `computeValidationStats`(L110-127):`if (passed==='oracle_error') {...continue}` 在 `if (passed===null)` 之前,两者均在 `if (passed){...}` truthy 判断之前。代码注释明确标注顺序依赖(L113-114),并有防御单测锁定 |
| 3 | `main()` 五处接线齐全 | **一致(T003 验收满足)** | L293 聚合回调改用 `readOracleOutcome`;L297(infraFailRate 超阈信息)+ L304(n_valid=0 信息)均追加 `oracle_error=${stats.n_oracle_error}`;L368 JSON 输出含 `n_oracle_error` 字段(紧邻 `n_oracle_missing` 之后);L386 摘要行含 `oracle_error=${stats.n_oracle_error}`。五处全部落地 |
| 4 | 15 条单测与 plan §5.1 rev.1 一一对应 | **一致(T004 验收满足)** | `computeValidationStats` 4 条(L870/883/895/910,含单条剔分母、全 oracle_error、四桶互斥、truthy 哨兵防御)+ `readOracleOutcome` 11 条(L934/938/942/948/954/958/962/966/970/977/982,含 pass/fail/error-infra/error-fixture/unavailable/未知漂移/legacy true/legacy false/文件不存在或损坏/无 oracle 字段/take1 复现场景)= 15 条,与 plan §5.1 清单逐条对应,无缺漏、无多余 |
| 5 | 范围边界:仅改两个目标文件 | **一致** | `scripts/lib/classify-oracle.mjs` 的 `classifyRunForRanking`(L122-128)与文档记载完全一致,未见改动痕迹;`scripts/eval-calibrate.mjs` 的 `oraclePassedFromFixture`(L415-420)与 `readOraclePassed`(L423-427,仍为 `catch→false` 保守口径)未见 classification/oracle_error 相关改动,与"本次不改"结论一致 |

## 附加核对

- `readOraclePassed`(L185-189)本体逐字未改,其既有 T-C9 单测块(L461-485,6 个 `it`)原样保留 —— 符合 plan §4.1 "零改动、零回归"声明。
- `computeValidationStats` 既有 T-C3 单测(`oracle` mock 直接构造 `true/false/null`)与 F210 新增用例共存,未见既有断言被修改 —— 符合"净增量式扩展"设计。
- `infraFailRate` 分子公式(L144)`(n_infra + n_error + n_oracle_missing + n_oracle_error) / results.length`,与 plan §2.2 一致。
- take1 复现场景单测(L982-1003)精确钉死 fix-report 描述的故障语义(`n_oracle_error===3 && n_valid===0 && passRate===null && infraFailRate===1`),直接验证根因闭环。

## 问题分级汇总

- **CRITICAL**: 0 个
- **WARNING**: 0 个
- **INFO**: 0 个(未发现范围外改动或过度实现;design-phase codex 已处置的 W-1~W-4 均已在代码中体现且经单测锁定)

## 总体判定

**合规**。git 工作区未提交改动(`scripts/eval-validate.mjs` + `tests/unit/feature-206-calibrated-harness.test.ts`)与 fix-report.md 根因结论、plan.md rev.1 变更清单(§2.1/2.2/2.3/§3/§5.1)、tasks.md rev.1(T001-T004)逐项一致,无遗漏、无偏离、无过度实现,范围边界(仅改两文件)严格遵守。
