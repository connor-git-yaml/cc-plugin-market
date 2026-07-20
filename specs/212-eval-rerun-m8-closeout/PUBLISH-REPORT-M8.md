# PUBLISH-REPORT-M8 — M8 收官评测 closeout（Feature 212）

> **状态**：final（付费批已收官；指标 2 重判终值见 §4）。**承接** [188 PUBLISH-REPORT-M8](../188-eval-rerun-m8-revalidation/PUBLISH-REPORT-M8.md)（本报告 supersede/扩展之）。
> **交叉链接**：[F176 swebench 预注册](../176-swe-bench-verified-cross-cohort/) · [F206 第二战役终报](../206-eval-calibrated-harness/goal-campaign-2-report.md) · [F187 oracle](../187-eval-harness-v2-failtopass-oracle/) · [F197 公正性](../197-f187-eval-integrity-closeout/) · [F208 fix 依从](../208-fix-mode-process-compliance/) · F210 eval-validate oracle_error · [POOL-RECOVERY.md](POOL-RECOVERY.md)
> **诚实边界**：所有结论受样本量（headline N=33 / A/B c3 N=30 / 133 cohort 内 N≤30）+ 任务筛选 + 方法局限约束，不外推 Verified 全集。
> **实测窗口**：2026-07-19 21:06 ～ 07-20 14:24（headline 7.21h + A/B 主体 ~7.3h + 尾批 1.6h + docker 死窗离线重判）。

## 1. T0 — calibrate 侧判分对齐 oracle_error（✅ 完成）

**问题**：`eval-calibrate.mjs` 聚合层（`aggregateRunResults`）只剔 run 级 infra/error，缺 oracle 级 `oracle_error` 哨兵——F210 只修了 eval-validate 侧。旧 `resolvePass = Boolean(readOraclePassed(...))` 把 oracle `classification:'error'`（venv 缺失/dataset build 失败=仪器坏了）经 `Boolean()` 归 0=fail，把 infra 假报伪装成 passRate=0.0。

**修复**（镜像 F210）：新增 tri-state `oracleOutcomeFromFixture`/`readOracleOutcome`（classification 穷尽映射 `pass→true / fail→false / error→'oracle_error' / 未知→null / legacy {passed} 回退`）；`aggregateRunResults` 识别 `'oracle_error'` 哨兵（分流先于 truthy 判断）→ 剔 cohortPasses 分母 + 计 `oracleErrorCount` + 计入 `excludedRate`；删死代码 `readOraclePassed`。

**验证**：+19 单测；目标测试 139 passed；全量 `tests/unit` **2972 passed / 0 regression**。Codex（gpt-5.5 high，新 session 无 resume）**0 HIGH / 0 MED / 1 LOW**（abortReason 文案）已闭环。

**freeze**：T0 不在 SEMANTIC_MODULES（5 语义模块 sha T0 前后完全一致，零贡献实证）；但 F176 冻结（6-14）后 master 侧 415e46e（F206 陈旧缓存毒化修复）已致 `oracleSpecHash f4fbd0f9→f4044f21` 漂移 → 按任务 brief"T0 后 freeze"用 freeze 工具 re-freeze specs/176 prereg（taskSetHash/fixtureContentHash/promptSha256 三项零变化）。本轮所有判分（headline/A/B/重判）在冻结语义下进行，跑批中零改动；三 hash 门实测两次开火（拦脏树 + 拦判分漂移）后 PASS。

## 2. 133 份 M7 答卷真 oracle 重判（✅ 引用 188 结论，本轮不 re-run）

**裁定（用户 2026-07-19）**：引用 188 P1 权威结论，不 re-run。**依据**：`eval-offline-rejudge.mjs` **不 import eval-calibrate.mjs**，自带聚合（classification pass/fail/error + error_rate>30% lowConfidence）——**从无 calibrate 的 bug、已正确 error 剔分母**，故 **T0 与 133 重判正交**，re-run 只复现 188、不验证 T0；且 re-run 需重建 SWE-bench Docker env（数小时、188 记录 flaky）。

**188 P1 结论（引用）**：真 FAIL_TO_PASS oracle **定性推翻** M7 fuzzy 的"重流程降低完成率"误判（系对"修复+补测试"形态的结构性惩罚=测量伪影，M7 §4.5 翻案成立）。OAuth-401 生成层污染校正后竞争口径 **c3 85.7% / c4 100% / c5 85.7%**（详见 [188 §2.2b](../188-eval-rerun-m8-revalidation/PUBLISH-REPORT-M8.md)）。**强度=directional**：受 10 任务可解性筛选 + cohort 内 N≤20-29 + 仅 2 抽验限制。

## 3. headline — F208 后全池复测（✅ 33/33 判分，零剔除）

> 全池 11 task 基座为磁盘清盘后重建：转录三角恢复 + fixtures 字节级命中冻结锚（19d8d42 精确）+ 双集合锚前缀命中，全链见 [POOL-RECOVERY.md](POOL-RECOVERY.md)。

**c3（F208 enforcement=block）= 27/33 = 81.8%，bootstrap 95% CI [69.7%, 93.9%]** —— 与 F206 战役后 27/33 **持平**；**~88% 预测在点估计上未兑现**（88% 在 CI 带内，N=33 无法统计区分，但预测的 +2 分未出现）。

| task | F206 | F212 | Δ | 备注 |
|---|---|---|---|---|
| V001-V005/V007/V009（7 task）| 3/3 | 3/3 | 0 | 稳定满分 |
| V006（坟场）| 0/3 | 0/3（timeout×3）| 0 | GStack 同样 0/3，非差距项 |
| **V008（靶心）** | 1/3 | **1/3** | **0** | **未转化**，见下 |
| V010 | 2/3 | 3/3 | +1 | R4 墙钟尾巴清了 |
| VB003 | 3/3 | 2/3（timeout×1）| −1 | 新超时（单发，噪声带）|

**坍塌率：战役期 20-30% → 0/29（✅ F208 依从性目标达成）**。分母口径（可审计，对 `f212-headline.json` n_total=33 − n_gen_timeout=4）：**完成生成的 29 个 run**（27 oracle pass + V008 两个 oracle fail）全部带完整 `.specify` 流程制品；4 个 gen_timeout（V006×3 + VB003×1）中途被杀、无从判定坍塌（V006 历史上所有 cohort 同死于墙钟）。F206 定义的"opus freestyle 坍塌"（无制品+行内 cosplay 报告）在 29 个可判定 run 中绝迹。注：老"0 委派=坍塌"代理指标在轻量路径（第一战役 a'：≤3 文件小修复单代理设计）下已失效，本判定以流程制品存在性为准。

**V008 未转化的失败形态（取证）**：r1/r2 patch **零源码改动**（r1=gitignore+project-context+fix-report；r2=仅 fix-report），fix-report 原文自信断言 *"对当前工作树的核实表明，报告中的两个症状均已被历史修复消除，无需任何代码改动"* 并引 `contains.py:50` "已修正"——**方向误读（把 base 态当已修复）原样复现，只是穿上 F208 合规外衣**（流程完整、结构化 no-op 出口）。两 run MCP 引用 ×0（未进入代码分析）。**结论：预测因果链"消坍塌→V008 转化"前半兑现、后半未获支持（V008 仍 1/3，N=3）——证据指向 V008 根因不是坍塌而是核实方向反转，prompt/依从层都够不到它**（与 F208 verification-report 的 V008 0/2 观察一致，本轮复确认）。

**测量质量**：infra=0 / error=0 / oracle_error=0 / oracle_missing=0（**首个零剔除全池批**）。口径：driver=claude-sonnet-4-6（F206 pool 链同源）；oracle timeout=1.2M ms（pool 链沿 F206 结算口径，≠ prereg 冻结 300000 的 cohort-batch 链口径——188 P1 同款 lineage deviation，结果 meta 显式记录）。

## 4. 触发率 A/B（✅ 完成 188 遗留 P2 / SC-002）

c1/c3 × 10 task（F176 冻结集）× N=3 = 60 run 全部生成完成。driver **实测 claude-opus-4-8**（manifest 默认字段沿写 4-7，本机 CLI 2.1.215 实际解析 4-8，如实记）；jury=on（SiliconFlow）。

**指标 1 — 触发率（预注册机判，全量 N=30）**：

- c3 每 run MCP 调用：**mean = 3.87**，bootstrap 95% CI **[3.10, 4.60]**（分布 0-8；3 个零触发 run 诚实在内）
- **显著提升 vs F176**（CI 下界 3.10 > 1.77 基线）✅；**SC-002 达标**（CI 下界 ≥ 2.0）✅ —— **2.2× 基线**
- 数据源：runner 内建 mcp-trace 逐 run 记录（与 F176 1.77 基线同源）；c1 恒 0（无 MCP 注入）仅机制对照不入 lift

**指标 2 — 完成率 lift（c3/c1 真 oracle，同批同 oracle，重判后零残余 E）**：

- c1（裸 opus-4-8）= **27/30 = 90.0%**；c3 = **23/30 = 76.7%**
- **lift = 0.852**，bootstrap 95% CI **[0.655, 1.043]**（差值 −13.3pp，CI [−33.3pp, +3.3pp]）——**CI 含 1.0 → 噪声带内不显著**，方向为负
- 逐任务：c3 失分 V006 0/3（c1 也仅 1/3，坟场）+ V007 1/3（c1 2/3）+ V008 2/3（c1 3/3）+ V010 2/3（c1 3/3）
- **诚实解读**：在强驱动（opus-4-8）+ 可解性筛选过的 F176 10 任务上，工具流程呈**净开销方向**（不显著）。按 C1 红线，本结果**不与** sonnet 链/F206 数据做解释性比较（"driver 强度 × 流程收益是否交互"是开放问题，需同链对照数据才可回答，登记 §9-5）。同批内值得记：**裸 opus-4-8 的 V008 3/3**（方向误读病不困扰裸驱动——它不做"先核实是否已修"的流程步骤）。

**oracle docker 死窗事故与修复**：跑批后段 Docker daemon 死亡（07-20 晨），19 个 run（12 c1 + 7 c3）oracle 判 `error/infra`——**T0 冻结语义正确分桶**（oracle_error 剔分母不混 fail，正是本 feature 修的病在真实故障中的首次实战）。patch 全存（31 c1 + 32 c3 核验）→ 按 188 先例**离线重判**（`runSwebenchInstance` 复用、语义模块零改动、全新 runId 零覆盖、timeout 1.2M）。重判前 per-cohort oracle_error 率 c1 40% / c3 23%（c1 超 30% 低置信线，重判后按终值报）。

## 5. 四方终表（headline 后更新）

| Cohort | F206 战役后 | F212（F208 后）|
|--------|-------------|----------------|
| c5 GStack | 30/33 = 90.9% | （对照，未重测）|
| **c3 spec-driver+Spectra** | **27/33 = 81.8%** | **27/33 = 81.8%**（CI 69.7-93.9%；预测 ~88% 未兑现）|
| c1 裸 Claude | 24/31 = 77.4%（7月）| （对照，未重测；A/B 内 opus 链 c1 另测，跨链禁比）|
| c4 SuperPowers | 22/33 = 66.7% | （对照，未重测）|

对 GStack 差距结构未变：V006 双方坟场不计，真实差距仍 = V008×2（结构性方向误读）± 1 分噪声（V010/VB003 互换）。

## 6. M8-SC 闭合裁定

- **SC-002（触发率 ≥2/run）**：✅ **闭合** —— c3 = 3.87 [3.10, 4.60]，双门（显著提升 vs 1.77 + 达标 ≥2.0）预注册机判全过，全量 N=30。
- **SC-004（评测可信度）**：✅ **闭合** —— 188 P1 裁定成立（directional）+ 本轮补齐：T0 判分口径对齐、全池批零剔除测量、docker 死窗在冻结语义下正确分桶并经离线重判恢复——可信度链条端到端演练了一次真实基础设施故障并守住口径。
- **headline 结论（诚实）**：F208 依从性达成（坍塌 0/29）但 c3 分数持平 81.8%；**~88% 预测在点估计上未兑现**（预测的 +2 未出现；88% 仍在 CI [69.7,93.9] 带内，N=33 不构成统计否证）；剩余差距定位到 V008 方向误读（非依从问题），转产品候补（§9-1）。
- **C1 红线**（承 188 FR-015）：133（M7-era）/ headline（sonnet 链）/ A/B（opus 链）三个 epoch **互不横比 c3 绝对率**；133 只对 M7 fuzzy，headline 只对 F206 全池，A/B 只对 F176 telemetry。

## 7. Falsification 附录（运维实录，逐条如实）

1. **探针假阳性误发射**：v1 OAuth 探针 `*ok*` glob 被 401 报错里的 "t**ok**en" 匹配 → 无凭证误点火；发射器自身 bash 变量 bug 让批起跑前崩掉（零消耗零污染）。修复=输出整串精确匹配。
2. **Claude app 周期 ×3 的 plugin 重新 enable**：app 重启会把 user-scope plugin 重新 enable。第 1 次：8 个 c3 run 被 runner 冲突门禁连拒 → 驱动 fail-closed 正确中止（损失 ~35min；1 个成功 run 被 resume 保留）。对策=plugin 守卫 sidecar（45s 重申 disable）。第 2 次：**会话级 scratchpad 被清 → 守卫脚本消失崩死** → 收尾 7 个 c3 run 秒败（resume 补跑全部成功）。对策=脚本迁稳定路径 + setsid 双重脱离；第 3 次 app 周期批安然存活。
3. **Docker daemon 死亡窗**：A/B 后段 daemon 死（Surge 存活，非既往"Surge 僵死连带"模式；诱因疑 app 周期/内存压力）。19 run oracle error/infra；16 个 sweb 镜像全存；重启 daemon + 离线重判恢复。
4. **runId 跨链撞名覆盖取证**：headline（pool 链）与 A/B（cohort-batch 链）run_artifacts runId 同为 `task__tool__rN` → A/B c3 复用并**覆盖了 headline 的原始 stdout/patch**（取证提取早于覆盖 13 分钟；fixtures 与结果 JSON 两链后缀不同未受损）。
5. **驱动版本漂移**：A/B manifest 默认 claude-opus-4-7，CLI 实际解析 claude-opus-4-8；以实测为准（同批内一致，within-batch 比较有效）。
6. **直播误报更正**：headline 跑批直播中按 runner `success` 状态报了 "V008 3/3"——runner success ≠ oracle pass，终表 V008 = 1/3。教训：逐 run 播报必须以 oracle 判分为准。
7. **重启杀批 ×2 与 resume 三连对账**：单层 nohup 子进程随 app 重启死（进程组清杀）；setsid 后免疫。headline 27/33 与 A/B 60/60 均经 (task,tool,repeat) 级幂等 resume 无损衔接，三次实战全对账。
8. **oracle timeout 谱系 deviation（跨链不一致，如实并置）**：headline（pool 链）oracle timeout=1.2M ms（沿 F206 结算口径）≠ prereg 冻结 oracleSpecHash 内的 300000（cohort-batch 链口径）；A/B 生成期用 300000、离线重判用 1.2M（容 docker 冷拉，188 P1 同款先例）。判分语义模块两侧同一冻结版本，timeout 差异只影响"慢 oracle 是否被判 error"，重判环节已将其影响清零（终值零残余 E）。

## 8. Dogfooding 四维度反馈（政策必附）

- **MCP 可用性**：Spectra MCP 在 c3 run 内触达 3.87 次/run（本 feature 被测项本体）；主线程编排低频使用（评测任务形态，同 188 结论非缺陷）。
- **信息完整性**：runner/cohort-batch/validate 导出面完整支撑薄驱动零改造拼装（ParallelRunPool + computeValidationStats + runSwebenchInstance）；缺口 = cohort-batch 链 fixture 不带 mcpToolCalls（触发率被迫走日志序贯解析）→ §9-2。
- **流程顺畅度**：spec-driver 编排 + 每阶段 Codex 对抗审查在**跑批前**抓 6H/3M 真雷（repeat-index 错位、warmup 反破坏、resume 交叉污染、预算杀伪装、prereg 三重门缺失等）；"设计期抓 bug 比跑批后便宜 100×"再验证。
- **结果准确性**：预注册机判（触发率双门）+ 冻结语义（三 hash 门实测两次开火）+ fail-closed（两次实战正确中止）——测量链在 7 类真实故障下全部守住口径。

## 9. Followup 候补（转 M9+/产品卡）

1. **V008 方向误读**（产品，最高值）：核实方向反转对 prompt/依从层免疫——候选 = fix 模式"issue 期望行为 vs 工作树现状"双向对账合同（结构化门，非 prompt；R3 三版 prompt 级已证伪）。
2. 评测 infra 三小件：pool 链 runId 加后缀（防跨链覆盖）；cohort-batch fixture 内嵌 mcpToolCalls；runner oracle 前 docker healthcheck + 有界重试。
3. plugin 守卫升级为 harness 内建（batch 生命周期钩子，替代外挂 sidecar）。
4. 上报 Claude Code upstream：app 重启重新 enable user-scope plugin（评测场景测量污染源）。
5. **driver 强度 × 流程收益交互**（开放问题）：opus 链 lift 0.85（不显著负向）与 sonnet 链历史观察方向不同——是否真有交互只能用**同链 c1/c3 对照**回答（如 sonnet 链补 c1 全池），本报告按 C1 不下结论。
