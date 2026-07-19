# Feature Specification: M8 收官评测 closeout — calibrate 判分对齐(T0) + F208 后全池复测 + 真 oracle 重判复核 + 触发率 A/B

**Feature Branch**: `212-eval-rerun-m8-closeout`
**Created**: 2026-07-19
**Status**: Draft
**Base**: master `4d1fb05`
**前身**: [188-eval-rerun-m8-revalidation](../188-eval-rerun-m8-revalidation/) —— 已完成 P1(133 离线重判, directional 成立) + P2 setup-ready 但**从未跑**(阻塞于全局 spectra plugin + 9-12hr 配额窗口)。本 feature 是其**收官续作**：188 的 P2 落地 + 新增 T0 判分对齐 + F208 后全池 headline 复测。
**上游依据**: [F206 第二战役终报](../206-eval-calibrated-harness/goal-campaign-2-report.md) / F208(fix 模式流程依从) / F210(eval-validate 侧 oracle_error 对齐) / F187(swebench-execution oracle) / F197(评测公正性 6 缺陷修) / F176(swebench 预注册 fresh-freeze)

## 背景与定位

M8 修完价值传导链后的**终局验证**。F206 第二战役终报预测：其后续路径 #1（F208 修 fix 依从性，消 20-30% 仪式坍塌方差 + 打 V008×2）落地后**全池 c3 ≈88%**。F208 已 ship（慢验坍塌 0/6）——本 feature 回答 F208 enforcement 开启下 c3 的**真实水平**（对照锚点：GStack 90.9% / 裸 Claude 77.4% / 战役后 81.8%）。

范围哲学（沿用 188）：**不改任何竞品方法论 / importer；oracle 语义仅 T0 一次性修正后 freeze，跑批中零改动**。唯一生产代码改动是 T0（calibrate 侧判分口径对齐 F210）。其余产物是评测结论 + 一份入库 PUBLISH-REPORT-M8。

### 已决策（用户 2026-07-19 拍板，AskUserQuestion）

- **D-1 feature 编号**：188 计划号**已被占用**（`188-eval-rerun-m8-revalidation` 已 committed master，含 PUBLISH-REPORT-M8）。本 feature 取**新号 212**、slug `eval-rerun-m8-closeout`，交叉链接 188，新报告 supersede/链接旧报告。（原 task brief "188 从未占用" 前提证伪。）
- **D-2 执行编排（cheap-first，spend 门控）**：先做 $0 + 代码工作（T0 + 133 重判），prep + dry-run 付费批（33-run + A/B），再交用户 go/no-go 决定是否烧 SiliconFlow $ / OAuth 配额。付费批不在本 feature 无人值守自动跑。

## User Scenarios & Testing

### User Story 0 — T0 前置·calibrate 侧 oracle_error 对齐（Priority: P0，freeze 之前必做）

`scripts/eval-calibrate.mjs` 聚合层（`aggregateRunResults`）现仅剔 run 级 `infra`/`error`，缺 **oracle 级 `oracle_error` 哨兵**——F210 只修了 eval-validate 侧（`scripts/eval-validate.mjs` 的 `readOracleOutcome`/`computeValidationStats` 为参照实现）。现状 bug：`resolvePass = (r) => Boolean(readOraclePassed(r.fixturePath))` 把 oracle `classification:'error'`（venv 缺失/dataset build 失败 = **仪器坏了**，非候选 fail）经 `Boolean()` 归 0=fail，把 infra 假报伪装成 passRate=0.0。

**Why P0**: freeze oracle 语义、跑任何批之前必须做完（避免"跑中换判分"）；是纯代码 + 单测、$0、无凭据依赖。

**Independent Test**: `vitest run tests/unit/feature-206-calibrated-harness.test.ts` 绿，含新增 oracle_error 剔分母用例。

**Acceptance Scenarios**:

1. **Given** 一份 fixture `taskExecution.primaryOracle.classification==='error'`，**When** calibrate 的 oracle outcome 解析器读它，**Then** 返回 `'oracle_error'` 哨兵（镜像 F210 `readOracleOutcome`：`'pass'→true / 'fail'→false / 'error'→'oracle_error' / 未知漂移→null / legacy {passed} 无 classification 才二值回退`）。
2. **Given** `aggregateRunResults` 收到含 oracle_error 的 results，**When** 聚合，**Then** oracle_error **剔出 cohortPasses 分母**、单独计 `oracleErrorCount`、计入 `excludedRate`（与 infra/error 同"无法评估"口径）；哨兵是 truthy 字符串，分流顺序**必须先于** `? 1 : 0` truthy 判断（单测锁定顺序，否则误判 pass）。
3. **Given** 现有 T-C7 `aggregateRunResults` 全部旧用例，**When** 跑测，**Then** 零回归（新增字段 `oracleErrorCount` 为 additive，旧解构不破）。

### User Story 1 — F208 后全池复测（headline，Priority: P1）

F208 enforcement=block 下重跑全池 33 run（c1/c3 最小集口径沿用 F206）；产出四方终表更新 + 坍塌率对照（战役期 20-30% → F208 后实测）；诚实标注 N=33 噪声带。

**Why P1**: 是 M8 headline 结论，但**烧订阅配额 + 依赖 Claude/Codex OAuth**（现实测 OAuth 401 已过期，需用户先 `claude /login`）+ 需 disable 全局 spectra plugin。**D-2 门控**：prep + dry-run 后交用户 go/no-go。

**Acceptance Scenarios**:

1. **Given** OAuth 已 host shell 重授权 + SiliconFlow key 就位 + 全局 spectra plugin 已 disable + oracleSpecHash 与 F176/F197 冻结值比对无意外漂移，**When** 跑全池 33 run，**Then** 每 run 产出 `{classification, failureSource, reason}`，oracle_error/infra/error 按 T0 口径剔分母。
2. **Given** 33 run 判分完成，**When** 聚合，**Then** 更新四方终表（GStack / 裸 Claude / 战役后 / F208 后 c3），报坍塌率对照，N=33 噪声带诚实标注。

### User Story 2 — 133 份 M7 答卷离线重判·复核（Priority: P1，≈$0）

`~/.spec-driver-bench-patches/m7-f176/` 用 F187/F197 swebench-execution oracle 重判 → 回答"fuzzy 翻案排名在真实判分下成立否"。用 F197 修好的链（report 权威 / error(含 oracle_error) 剔分母 / Verified dataset 映射）+ freeze 工具写 `oracleSpecHash`。

**Why P1**: 无凭据依赖、$0、可立即跑。188 P1 已给 directional 结论（c3 85.7%），本轮**复核**（含 T0 后的 oracle_error 口径）确认或修正。

**Acceptance Scenarios**:

1. **Given** 跑前抽检 untracked.tgz 分类（188 §5 实测 133 份零候选源码/测试，CL-1 vacuous——本轮复核该假设）+ freeze 工具重冻结当前 oracle 语义（写 oracleSpecHash，与 F176/F197 值比对无意外漂移），**When** 对每份跑 `runSwebenchInstance`(dataset=verified)，**Then** 产出 `{classification, failureSource, reason}`，error/oracle_error 剔分母、单独计。
2. **Given** 133 判分完成，**When** 按 cohort 聚合，**Then** 报真 oracle cohort 排名 + 每 cohort `n_total / n_valid / error_rate`；error_rate>30% 标"低置信、不可比、不参与翻案判定"。
3. **Given** 真 oracle 排名 vs M7 fuzzy 结论，**When** 撰写，**Then** 明确回答"fuzzy 翻案排名在真实判分下成立 or 推翻"，附 N=133(cohort 内 N≤30) + 方法局限，不 over-claim。

### User Story 3 — 触发率工程 A/B（Priority: P2，完成 188 遗留 P2）

c3 的 mcp-trace 触发率 vs F176 基线（SC-002 显著性诚实标注）。跑 c1(control)+c3(spec-driver-spectra-mcp) × 10 task × N=3 = 60 runs，测双指标。

**双指标（沿用 188，消除 lift 退化歧义）**：
- **指标 1 触发率**：c3 每 run MCP 调用数，均值 + bootstrap 95% CI；锚点 = F176 基线 1.77 调用/run + SC-002 阈值 ≥2/run。c1 恒 0（无 MCP 注入），仅机制对照、不入 lift 分母。
- **指标 2 完成率 lift**：真 oracle passRate lift = `c3/c1`。触发率本身不算 lift（c1=0 分母退化）。

**Why P2**: 烧配额 + OAuth 依赖，排无依赖 P0/P1 之后。**D-2 门控**：与 headline 同批 prep/dry-run，交用户 go/no-go。

**Acceptance Scenarios**:

1. **Given** OAuth 重授权 + key 就位 + 配额未超限 + 全局 spectra disable，**When** 跑 c1/c3 × 10 × N=3，**Then** telemetry(`SPECTRA_MCP_TELEMETRY_PATH`)采 c3 每 run MCP 调用数（含 `parent_tool_use_id` 子代理归因）。
2. **Given** 60 runs telemetry 落盘，**When** 聚合，**Then** 报指标 1(触发率均值+CI) + 指标 2(c3/c1 lift)。
3. **Given** N=30(c3)，**When** 给显著性，**Then** 机判口径："显著提升 vs F176" ⟺ CI 下界>1.77；"达标" ⟺ CI 下界≥2.0；CI 跨越 → "噪声带内、不显著"。不达标如实报。

### Edge Cases

- **OAuth 跑批中过期**：长批/隔夜 resume 前必 `claude /login` preflight（既往 401 事故）。子进程 401 → 暂停，不静默产假阴性。
- **配额超限**：≥30 runs 时每 6 runs 查配额 dashboard；≥60% weekly → **停下问用户**，不擅自烧穿。
- **oracleSpecHash 不符**：跑前 `checkPreregistration` 若报 hash mismatch → hard-fail，禁跑中换判分。
- **全局 spectra plugin 冲突**：launch 前 `claude plugin disable spectra@cc-plugin-market --scope user`（否则 entryValidation hard-fail / 触发率测量失真）。
- **validate/池 runId 跨批复用**会覆盖 run_artifacts 取证现场 → 重要取证先存档再重跑。

## Requirements

- **FR-001（T0）**: calibrate 侧新增 tri-state oracle outcome 解析器（`oracleOutcomeFromFixture` + `readOracleOutcome`），classification 穷尽映射镜像 F210；`aggregateRunResults` 消费之，`oracle_error` 剔分母 + 计 `oracleErrorCount` + 计入 `excludedRate`；哨兵分流顺序先于 truthy 判断。带单测。
- **FR-002**: T0 完成后 freeze oracle 语义，跑批期间 `scripts/eval-*.mjs`/oracle 语义模块**零改动**。
- **FR-003**: 全池 33 run + 133 重判 + A/B 各产诚实结论，样本量/error_rate/方法局限显式标注，不外推。
- **FR-004**: 产 PUBLISH-REPORT-M8（manual 入库），交叉链接 188/F176/F206 报告；闭合 M8-SC-002(触发率)/SC-004(评测可信度) 裁定。
- **FR-005**: 每 phase Codex 对抗审查；push 前列 report 等用户确认；`specs/**/src.spec.md`（若存在）排除出 commit。
- **FR-006**: 评测产物不入库（run_artifacts / .swebench-venv 全 gitignore）；显式路径提交，禁 `git add -A`。

## Success Criteria

- **SC-T0**: calibrate 侧 oracle_error 剔分母单测绿（镜像 F210 语义），零回归。
- **SC-1**: 四方终表更新（含 F208 后 c3 新数 + 坍塌率对照）。
- **SC-2（复核 SC-004）**: 133 重判结论（成立/推翻，诚实给）。
- **SC-3（SC-002）**: 触发率 A/B 双指标（触发率 CI + 完成率 lift），显著性诚实裁定。
- **SC-4**: PUBLISH-REPORT-M8 产出 + M8-SC-002/004 闭合裁定 + dogfooding 四维度反馈节。
