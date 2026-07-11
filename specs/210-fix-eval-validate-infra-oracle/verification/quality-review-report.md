# F210 代码质量审查报告

审查对象：`scripts/eval-validate.mjs`（新增 `readOracleOutcome` + `computeValidationStats` 第四态桶）+
`tests/unit/feature-206-calibrated-harness.test.ts`（新增 15 条断言）。工作区未提交改动，diff +206/-11。

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | EXCELLENT | 净增量式扩展：不改 `readOraclePassed`/`oraclePassedFromFixture`/`classify-oracle.mjs`，只在唯一调用点（`main()` L342）切换回调，与 plan.md 范围边界完全一致；`n_oracle_error` 与既有 `n_oracle_missing`/`n_infra`/`n_error` 桶并列，互斥不重叠（by construction：来自不同 `status` 分支或同一 `success` 分支内互斥的 `passed` 值判断） |
| 设计模式合理性 | GOOD | `boolean\|null\|'oracle_error'` 哨兵值扩展回调契约，避免了 plan 中提到的"四枚举重写全部 mock"方案，权衡记录在 plan.md §2.1，务实；唯一瑕疵是与 `eval-calibrate.mjs::oraclePassedFromFixture` 的字段提取链（`primaryOracle ?? swebenchResult ?? oracleResult ?? result`）重复书写而非复用——已在 JSDoc 显式承认并留可追溯锚点，属已知可接受的技术债 |
| 安全性 | N/A | 纯本地 JSON 文件读取 + 内存判定，无外部输入拼接、无反序列化风险、无路径穿越入口（`fixturePath` 来自内部 `ParallelRunPool` 结果，非用户可控） |
| 性能 | N/A | 单文件同步读取 + O(1) 分支判定，无 N+1、无循环嵌套；不适用性能维度 |
| 可读性 | EXCELLENT | 分支顺序注释明确解释"哨兵 truthy 必须先于 `if (passed)` 判断"（why 导向）；`computeValidationStats` 头部 JSDoc 逐条列出五态语义（infra/oracle_missing/oracle_error/gen_timeout/error/success），比代码本身更早交代意图 |
| 可维护性 | GOOD | 新增代码量小（净 +72 行含大段 JSDoc），无重复代码块超阈值；`readOracleOutcome` 与 `readOraclePassed` 并存但语义边界清晰（旧函数保留供回归测试锁定，新函数是唯一生产路径）——建议 follow-up 决定 `readOraclePassed` 的去留而非无限期共存（见问题清单 INFO-1） |

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| INFO | 可维护性 | `scripts/eval-validate.mjs:185-189`（`readOraclePassed`）| 修复后该导出函数在生产代码路径（`main()`）已无调用者，仅被单测引用作回归锚点（T-C9 6 条用例）。长期存在会造成"两个几乎同名、语义不同的读取函数"认知负担 | 非本次范围（plan.md 已显式排除），可在后续 fix/refactor 中评估是否连同其单测一并归档删除，或加一行注释标注"仅供回归测试，生产路径见 readOracleOutcome" |
| INFO | 可读性 | `scripts/eval-validate.mjs:213-228`（`readOracleOutcome`）| `'classification' in oracle` 依赖 `oracle` 为对象；若上游 fixture 出现非对象类型（字符串/数字/布尔）的 `primaryOracle`，`in` 操作符会抛 `TypeError`，虽被外层 `try/catch` 兜住退化为 `null`（fail-closed，语义上不算错），但属于"意外抓获正确结果"而非显式防御，注释未提及此隐性依赖 | 可选：加一行注释说明"非对象 oracle 由外层 try/catch 兜底为 null"，明确这是有意识的隐性防御而非巧合；不阻断合并 |
| INFO | 可维护性 | `scripts/eval-validate.mjs:213-228` | 若 `primaryOracle` 意外是数组（如上游 schema 回归产出 `[]`），`'classification' in oracle` 不抛错（数组是对象）且恒为 `false`，代码会走 legacy 分支 `oracle.passed === true` → `undefined === true` → `false`（判定为"候选 fail"而非 fail-closed 的 `null`）。属边界外情形（当前 `classify-oracle.mjs` 保证 `primaryOracle` 恒为对象），风险极低 | 若未来要收紧穷尽性，可在 `oracle == null` 判断后加 `typeof oracle !== 'object'` 早退；当前无实际触发路径，不建议为此新增代码复杂度 |

无 CRITICAL、无 WARNING。

## 关键正向发现（非问题，供归档留痕）

- **分支顺序回归防御到位**：`computeValidationStats` 中 `passed === 'oracle_error'` 判断先于隐式 truthy 判断，且有专门单测（`F210 truthy 哨兵防御`，L910-921）用恒返回 `'oracle_error'` 的 mock 钉死顺序——这是本次修复最容易被未来重构破坏的点，测试覆盖到位。
- **take1 复现场景闭环**：`tests/unit/...` L982-1003 直接用 `readOracleOutcome` + `computeValidationStats` 端到端复现 fix-report 描述的故障（3/3 oracle-error），断言 `n_valid=0 / passRate=null / infraFailRate=1`，与 `main()` 里 FR-006 floor exit 2 出口语义吻合，不是同义反复的弱断言。
- **classification 穷尽映射合规**：`'pass'/'fail'/'error'` 三态显式处理，其余值（含 legacy `'unavailable'`、未知漂移值）统一 fail-closed 到 `null`，与 `scripts/lib/classify-oracle.mjs` 的 `OracleClass` 类型定义（`'pass'|'fail'|'error'`）保持一致，未引入该模块之外杜撰的新分类。
- **回归面确认为零**：`readOraclePassed` 及其 6 条既有单测字面未改动；`computeValidationStats` 既有 8 条 T-C3 用例使用本地 mock（不产出 `'oracle_error'`），未触及新分支；`buildValidationJobs`/`CALIBRATION_COHORT_TO_TOOL` 相关测试与本次改动无交集。`npx vitest run tests/unit/feature-206-calibrated-harness.test.ts` 119/119 通过；全量 `npx vitest run` 428 files / 5082 tests 通过，0 失败、18 skipped（既有基线）、21 todo（既有基线）。
- **输出 JSON 纯增量**：`n_oracle_error` 字段插入在 `n_oracle_missing` 之后，全仓搜索确认无其他 `.mjs`/plugin 脚本解析 `eval-validate.mjs --output` 产物的既有字段做严格 schema 校验，新增字段不构成破坏性变更。
- **命名与既有风格一致**：`n_oracle_error` 与 `n_oracle_missing` 同构（snake_case 与文件内其余计数器风格一致，非驼峰混用）。

## 死角排查（第 5 项要求）

全文 Grep `primaryOracle|oraclePassed|readOracle` 确认 `scripts/eval-validate.mjs` 内仅一处消费点（`main()` L342 的 `computeValidationStats` 回调），无其他遗漏的读 oracle/passed 路径未跟进新语义。`readOraclePassed`（L185-189）保留但已确认无生产调用者。

## 总体质量评级

**EXCELLENT**

评级依据：零 CRITICAL、零 WARNING、仅 3 条 INFO（均为边界外/低风险的可选加固建议，不阻断合并）；改动范围严格对齐 plan.md 承诺边界；15 条新单测覆盖穷尽映射 + 分支顺序防御 + 端到端复现场景，无同义反复弱断言；全量测试与目标文件测试均 0 失败。

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 0 个
- INFO: 3 个
