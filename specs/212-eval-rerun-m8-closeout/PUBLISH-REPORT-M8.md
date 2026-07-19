# PUBLISH-REPORT-M8 — M8 收官评测 closeout（Feature 212）

> **状态**：living（headline + A/B 待付费批回填）。**承接** [188 PUBLISH-REPORT-M8](../188-eval-rerun-m8-revalidation/PUBLISH-REPORT-M8.md)（本报告 supersede/扩展之）。
> **交叉链接**：[F176 swebench 预注册](../176-swe-bench-verified-cross-cohort/) · [F206 第二战役终报](../206-eval-calibrated-harness/goal-campaign-2-report.md) · [F187 oracle](../187-eval-harness-v2-failtopass-oracle/) · [F197 公正性](../197-f187-eval-integrity-closeout/) · [F208 fix 依从](../208-fix-mode-process-compliance/) · [F210 eval-validate oracle_error]
> **诚实边界**：所有结论受样本量（headline N=33 / A/B c3 N=30 / 133 cohort 内 N≤30）+ 任务筛选 + 方法局限约束，不外推 Verified 全集。

## 1. T0 — calibrate 侧判分对齐 oracle_error（✅ 完成）

**问题**：`eval-calibrate.mjs` 聚合层（`aggregateRunResults`）只剔 run 级 infra/error，缺 oracle 级 `oracle_error` 哨兵——F210 只修了 eval-validate 侧。旧 `resolvePass = Boolean(readOraclePassed(...))` 把 oracle `classification:'error'`（venv 缺失/dataset build 失败=仪器坏了）经 `Boolean()` 归 0=fail，把 infra 假报伪装成 passRate=0.0。

**修复**（镜像 F210）：新增 tri-state `oracleOutcomeFromFixture`/`readOracleOutcome`（classification 穷尽映射 `pass→true / fail→false / error→'oracle_error' / 未知→null / legacy {passed} 回退`）；`aggregateRunResults` 识别 `'oracle_error'` 哨兵（分流先于 truthy 判断）→ 剔 cohortPasses 分母 + 计 `oracleErrorCount` + 计入 `excludedRate`；删死代码 `readOraclePassed`。

**验证**：+19 单测；目标测试 139 passed；全量 `tests/unit` **2972 passed / 0 regression**。Codex（gpt-5.5 high，新 session 无 resume）**0 HIGH / 0 MED / 1 LOW**（abortReason 文案）已闭环。

**freeze**：`oracleSpecHash` 由 manifest + fixture/prompt hash 派生，**不含 eval-calibrate.mjs** → T0 不扰动冻结 oracle 语义，无需 re-freeze。commit `465fc11`。

## 2. 133 份 M7 答卷真 oracle 重判（✅ 引用 188 结论，本轮不 re-run）

**裁定（用户 2026-07-19）**：引用 188 P1 权威结论，不 re-run。**依据**：`eval-offline-rejudge.mjs` **不 import eval-calibrate.mjs**，自带聚合（classification pass/fail/error + error_rate>30% lowConfidence）——**从无 calibrate 的 bug、已正确 error 剔分母**，故 **T0 与 133 重判正交**，re-run 只复现 188、不验证 T0；且 re-run 需重建 SWE-bench Docker env（数小时、188 记录 flaky）。

**188 P1 结论（引用）**：真 FAIL_TO_PASS oracle **定性推翻** M7 fuzzy 的"重流程降低完成率"误判（系对"修复+补测试"形态的结构性惩罚=测量伪影，M7 §4.5 翻案成立）。OAuth-401 生成层污染校正后竞争口径 **c3 85.7% / c4 100% / c5 85.7%**（详见 [188 §2.2b](../188-eval-rerun-m8-revalidation/PUBLISH-REPORT-M8.md)）。**强度=directional**：受 10 任务可解性筛选（非代表性子集，绝对率不可外推）+ cohort 内 N≤20-29 + 仅 2 抽验限制。

## 3. headline — F208 后全池复测〔待付费批回填〕

**目的**：F208 enforcement=block 下重跑 F206 全池（33 held-out task），验证战役后路径 #1 预测 c3 ≈88%。
**执行**：见 [RUNBOOK.md §2](RUNBOOK.md)。**当前阻塞**：Claude OAuth 过期 / 全局 spectra plugin 待 disable / Docker daemon 待起。

〔待回填：c3 F208 后 passRate（N=33，噪声带）+ 坍塌率对照（战役期 20-30% → F208 后实测）〕

## 4. 触发率 A/B〔待付费批回填〕（完成 188 遗留 P2 / SC-002）

**目的**：c1/c3 × 10 × N=3 = 60 runs，双指标 vs F176 基线。见 [RUNBOOK.md §3](RUNBOOK.md)。

〔待回填：指标 1 触发率均值 + bootstrap 95% CI（锚 F176 1.77 / 阈值 2.0）+ 指标 2 c3/c1 完成率 lift + 显著性机判〕

## 5. 四方终表〔headline 后更新〕

| Cohort | F206 战役后（现状） | F208 后（本轮 headline） |
|--------|--------------------|--------------------------|
| c5 GStack | 30/33 = 90.9% | （对照，未重测） |
| c1 裸 Claude | 77.4% | （最小集对照） |
| **c3 spec-driver+Spectra** | **27/33 = 81.8%** | **〔待回填，预测 ~88%〕** |
| c4 SuperPowers | 22/33 = 66.7% | （对照，未重测） |

## 6. M8-SC 闭合裁定〔headline/A/B 后终裁〕

- **SC-004（评测可信度）**：T0（calibrate↔validate 判分口径统一）+ 133 引用 188（真 oracle 推翻 fuzzy 误判 directional 成立）→ **方向成立**；headline 提供 F208 后新证据维度。
- **SC-002（触发率）**：⏳ 待 A/B 双指标回填。
- **C1 红线**（承 188 FR-015）：133（M7-era 重判）与 headline/A/B（post-F208 新 runs）**不同 epoch + 不同构造，禁横向比 c3 passRate**；133 只对 M7 fuzzy，A/B 只对 F176 telemetry。

## 7. Dogfooding 四维度反馈〔跑后补充〕

- **MCP 可用性**：〔待跑后补〕（评测任务天然低频用 Spectra；T0 是纯 diff+参照实现审查，直接读文件更合适——同 188 结论）。
- **信息完整性**：spec-driver 编排 CLI + eval 脚本导出契约清晰；188 制品可复用度高。
- **流程顺畅度**：〔待跑后补〕。
- **结果准确性**：T0 单测 + Codex 双验；〔headline/A/B 判分准确性跑后补〕。
