# PUBLISH-REPORT-M9-interim — F237 V008 修复复测（F216 证据门后全池重跑）

> **状态**：interim（本报告是 M9 阶段性收口，非 M9 全量收官）
> **交叉链接**：[../212-eval-rerun-m8-closeout/PUBLISH-REPORT-M8.md](../212-eval-rerun-m8-closeout/PUBLISH-REPORT-M8.md) · [../216-fix-noop-evidence-gate/spec.md](../216-fix-noop-evidence-gate/spec.md) · [../216-fix-noop-evidence-gate/verification/verification-report.md](../216-fix-noop-evidence-gate/verification/verification-report.md) · [trace.md](trace.md) · [pool-11.json](../212-eval-rerun-m8-closeout/pool-11.json) · [evidence/](evidence/)
> **诚实边界**：结论受样本量（N=33，V008 单任务 N=3）+ 任务筛选（F176 冻结 11 task）+ 方法局限约束，不外推 SWE-bench Verified 全集。
> **实测窗口**：2026-08-01 18:40 CST 发射 → 2026-08-02 03:00 CST 收官（主批 6.72h + 预算保护截停 + resume 0.67h，含离线重判）。

---

## 1. Headline — F216 证据门后全池复测

在 F216（no-op 出口可执行证据门，`enforcement=block`）落地后的仓内源判定器下，用与 F212 headline 完全一致的口径（`driver=claude-sonnet-4-6`、pool 链结算、oracle timeout=1.2M ms、全池 11 task × cohort c3 × 3 repeat = 33 run）重跑：

- **c3 = 28/33 = 84.8%**，**33/33 判分零剔除**（数据来源：`f237-headline.json` 批内 26/31 + 2 个 oracle_error 经离线重判并入 pass，见 §7-4/7-5；`f237-anomalies.json` 记录全部 6 条异常，`resolution` 字段均为 `included-as-pass`/`counted-as-fail`/`documented`，无一条 `excluded`）
- vs **F212 c3 27/33 = 81.8%**：**+1 run（+3.0pp）**
- vs **GStack 30/33 = 90.9%**：差距 **9.1pp → 6.1pp**（3 run → 2 run）**收窄**，未反超
- **V008**：F212 1/3 → **F237 2/3**（观察到部分改善，描述性，非完全转化，见 §3/§5）

**GATE-B 首 run 早期门 PASS 实证**（`f237-earlygate.log`）：发射后连续 134 次 `WAIT stale-fixture`（正确识别并拒绝 F212 遗留旧 fixture，`runTimestampUtc=2026-07-19` 早于 `launchEpoch=1785581214`），第 135 行落地 `PASS plugin-dir=<eval-wt>/plugins/spec-driver`（发射后约 42 分钟）——**33-run 批确证跑在含 F216 证据门的仓内源判定器上**，非全局 npm 缓存 4.3.0 旧判定器。

---

## 2. 四方终表

| Cohort | F206 战役后 | F212（F208 后）| F237（F216 后）|
|---|---|---|---|
| c5 GStack | 90.9% (30/33) | （对照，未重测）| （对照，未重测；仍为 90.9% 锚点）|
| **c3 spec-driver+Spectra** | 81.8% (27/33) | 81.8% (27/33, CI [69.7%,93.9%]) | **84.8% (28/33)** ¹ |
| c1 裸 Claude | 77.4% (24/31, 7月) | （未重测）| （未重测，Non-Goals 排除）|
| c4 SuperPowers | 66.7% (22/33) | （未重测）| （未重测，Non-Goals 排除）|

¹ 33/33 是判分覆盖，28/33 为 pass-rate 点估计。既有产物 `f237-headline.json` 中的 `stats.ci`（`[70.97%, 96.77%]`）是基于批内 **31**-run（剔 2 个待重判 oracle_error 前）的 bootstrap 结果；离线重判并入 2 个 pass 后，编排器按同构口径（percentile bootstrap，B=10000，固定 seed=237）对合并 33-run 重算得 **95% CI = [72.7%, 97.0%]**。重算产物已落 `<eval-wt>/.calibration-output/f237-merged-ci.json`（LCG 定种 seed=237 可复现；系 run-level、固定 11-task 池条件下的 percentile bootstrap，非 task-cluster/hierarchical；与仓内 cohort-aggregate 默认 B=1000+Math.random 不同属独立重算专用）。N=33 下 CI 宽度天然较大（±12pp 级），F212 的 81.8% 与 GStack 的 90.9% 均落在带内——**本轮 +3.0pp 提升在统计上不足以单批定论**，方向信号以 V008 的逐任务机制取证为主要支撑（见 §5/§6），非纯率值对比。

**对 GStack 差距结构**：净变化 = **V008 +1、VB003 +1、V002 −1、V010 0 = +1 run**；VB003 +1 与 V002 −1 互为镜像单发 timeout 噪声对消（F212 对 VB003 −1 的原判即「单发，噪声带」），**结构性变化只有 V008 +1**；距 GStack 差 2 run = **V002 r3（timeout 噪声）+ V008 r3（no-op 边界）**；V006 双方同为 0/3 坟场，非差距项。

---

## 3. 逐任务对照表（F237 vs F212）

| task | F212 | F237 | Δ | 备注 |
|---|---|---|---|---|
| V001 | 3/3 | 3/3 | 0 | 稳定满分 |
| V002 | 3/3 | 2/3 | **−1** | r3 gen_timeout（20min 生成上限打穿，能力终态计 fail，非剔除） |
| V003 | 3/3 | 3/3 | 0 | 稳定满分 |
| V004 | 3/3 | 3/3 | 0 | 稳定满分 |
| V005 | 3/3 | 3/3 | 0 | 稳定满分 |
| V006（坟场） | 0/3 | 0/3 | 0 | r1 oracle fail + r2/r3 gen_timeout，GStack 同样 0/3，非差距项 |
| V007 | 3/3 | 3/3 | 0 | 批内 2/2（剔 r2 oracle_error）+ 离线重判 r2→pass，终值 3/3 |
| **V008（靶心）** | **1/3** | **2/3** | **+1** | r1/r2 真实修复 pass，r3 no-op 出口 fail，见 §5/§6 |
| V009 | 3/3 | 3/3 | 0 | 稳定满分 |
| V010 | 3/3 | 3/3 | 0 | 终审更正：此前误从 F206 列取数，F212 表列序为 F206→F212，V010 正确值 3/3，本轮无变化 |
| VB003 | 2/3 | **3/3** | **+1** | 终审更正：F212 正确值 2/3（timeout×1，F212 原判「单发，噪声带」）；本轮批内 2/2（剔 r3 oracle_error）+ 离线重判 r3→pass，终值 3/3；与 V002 −1 互为镜像单发 timeout 噪声对消 |
| **合计** | **27/33** | **28/33** | **+1** | — |

---

## 4. C1 红线声明

本轮结果**仅与 F206/F212 全池 sonnet 链（headline / pool-rerun 链）横比**——driver 同为 `claude-sonnet-4-6`、同一 pool 链结算口径、同一 11-task 冻结集。**不与以下两条链做绝对率横比**（沿用 F212 §6 既定红线，F212 本身承接 188 P1 结论）：

- **133（M7-era）重判链**：仅对 M7 fuzzy 判分的翻案结论适用，与本轮判分口径（真 FAIL_TO_PASS oracle）不构成同源比较基础。
- **A/B（opus 链）**：driver 为 `claude-opus-4-8`，与本轮 `claude-sonnet-4-6` 不同源，F212 §4 已实证 opus 链上 c3/c1 lift 方向与 sonnet 链历史观察不同（driver 强度 × 流程收益交互是开放问题，不能跨链外推）。

---

## 5. V008 逐 run 取证表（FR-002/SC-002）

三行完整取证（`evidence/v008-r{1,2,3}/` 共 12 文件、零 `.absent`；`fix-report.md` 通过取证 watcher 抢救副本或存活 bench worktree 双源获取，`meta.json` 记录逐 run 权威口径）：

| run | closureForm | 证据门触发状态 | missing keys | 最终判定 | oracle | fix-report 摘录（≤200 字） | patch diff 摘要 |
|---|---|---|---|---|---|---|---|
| **r1** | repair（真实修复） | 不适用（repair 路径，diagnose 直接判定"需修"，未进入 no-op 分支） | N/A | 合规，四阶段全套制品（`diagnose/plan/implement/verify`） | **pass** | "根因：`Contains.as_set()` 未返回其解集 `self.args[1]`，而是抛出 `NotImplementedError`……应直接返回 `self.args[1]`"（5-Why 追溯，方案 A 采纳） | `sympy/sets/contains.py` 单行改动（`raise NotImplementedError()` → `return self.args[1]`）+ `test_contains.py` 断言由"抛异常"改为"返回对应集合"（3 条新断言）+ 4 个 spec-driver 流程制品新增 |
| **r2** | repair（真实修复，与 r1 同构） | 不适用（同上） | N/A | 合规，四阶段全套制品 | **pass** | 同 r1 款 5-Why 根因链与方案 A（`return self.args[1]`），另附 monkeypatch 验证四条断言 | 与 r1 同款单行源码修复 + 测试更新 + 4 个流程制品（521 行差异主因流程文本量，源码改动本质相同） |
| **r3** | **no-op** | **触发且完整履约**：两条 `SPEC-DRIVER-REPRO` 复现对账真实执行且均 PASS + 委派 `verify` 子代理独立核实（结论"判定成立"）+ `no-op-verify` 阶段完成，审计事件 `blockEvents=0`（零阻断一次通过）——原始执行转录摘录见 `evidence/v008-r3/repro-execution-excerpt.log`（35 行，可见先 `timeout` 命令 FAIL 后改 `signal.alarm` 重试 PASS 的真实执行） | 无（证据完整，非"缺证据阻断"场景，故不落入 EC-001/002/003/004 任一豁免/阻断分支） | 证据门判定"合规"放行 no-op（但方向判断错误，见 §6） | **fail** | "该问题在当前代码库中已被上游历史修复解决，无需任何代码改动……两个原始症状……均已消除，任何代码改动都会与既有测试及上游修复冲突" | **零 sympy 源码改动**——仅 `.gitignore` + `.specify/project-context.yaml` + `fix-report.md`（3 个非源码文件，117 行） |

**审计事件时间线**（`.specify/runs/2026-08.jsonl`，`workflow-run-summary` 事件）：r1 `16:13:37Z` → r2 `16:27:51Z` → r3 `16:34:55Z`，三次顺序独立会话，同一 base 代码（`c5fb611eed` 之后的 HEAD）。

---

## 6. 诚实结论（对称模板）

### 6a. 未完全转化归因（r3 仍 fail，X=2<3）

V008 本轮观察到部分改善（1/3 → 2/3，描述性，N=3 单任务差 1 run 不构成统计结论），r3 的失败**不是**证据门未触发或判据太松导致的漏判，机制归因如下：

**(a) 证据门是否被实际触发**：**是**。r3 完整进入并履约了 F216 的 no-op 出口证据门——两条真实 Bash 复现命令在主 transcript 可见执行、均得到约定的 `SPEC-DRIVER-REPRO: PASS` 判定，`verify` 子代理独立核实判定成立，`no-op-verify` 阶段完成，`blockEvents=0`（无一次因缺证据被阻断，属零阻断一次通过，而非降级放行）。

**(b) 是否命中已知能力边界**：对照 `216-fix-noop-evidence-gate/spec.md` 的 EC-001..EC-009 逐条核实，**均不命中**——

- 非 EC-001（假证据填充）：主 transcript 有对应 Bash 执行记录，非空文本字样。
- 非 EC-002（INCONCLUSIVE）：两条复现命令均正常退出并得到明确 PASS，非超时/非零退出/字段缺失。
- 非 EC-003（无法构造 repro）：r3 实际构造并执行了可运行的复现命令，不属于"环境依赖缺失、无法构造"场景。
- 非 EC-004（旧版本兼容）：fix-report 携带完整新版证据字段（`复现对账` 段）。
- 非 EC-007（非 Bash 工具执行）：两条复现命令均经 Bash 工具执行。
- 非 EC-008（纯 repair 形态零源码改动伪装）：r3 是 no-op 形态，本身就没有源码改动的承诺，不适用"声称已修但 patch 无 diff"的伪装定义。
- 非 EC-009（复现命令副作用）：两条命令均为只读断言（构造对象/触发异常检查），无源码或状态改动。

**(c) F216 完整执行，r3 命中其已预注册的语义相关性/症状完整性边界**：证据门本身的设计意图是验证"claim 的可复现性"（模型声称的症状是否真实存在/真实消失），而 **不是**验证"claim 与任务目标（oracle 的 `FAIL_TO_PASS` 语义断言）是否对齐"——这是 `216-fix-noop-evidence-gate/spec.md`（FR-002 附近，L127/L131）**预先声明并入范围外的能力边界**：证据门不判断 repro 是否语义对应 issue、不检查声明是否覆盖全部症状。r3 的两条复现命令验证的是**症状层面**——"`Piecewise` 构造不再抛 `AttributeError`"、"`as_set()` 抛 `NotImplementedError` 而非返回 `Contains`"——这两个断言在当前 base 代码上确实为真（`c5fb611eed` commit 已把早期 `return self` 改为 `raise NotImplementedError()`）。但 oracle 的 `FAIL_TO_PASS` 测试断言的是 **`as_set()` 的功能实现语义**——返回正确的集合值（`self.args[1]`），而非"不抛出旧式错误"（机械定义见 fixture `<eval-wt>/tests/baseline/swe-bench-verified/fixtures/SWE-V008-sympy-contains-as-set-returns.json:18,27`：`failToPass=["test_as_set"]`、`goldPatch` 单行改动 `raise NotImplementedError()` → `return self.args[1]`）。r1/r2 的三次独立会话（同 base 代码）判定"需修"并真修，r3 判定"已修好"，三者分歧**纯在方向解读**，不在证据执行的真实性上。

**对照 F212 佐证"边界" vs "新失败形态"的区分**：F212 的 V008 两个 no-op（r1/r2）均为「无证据自信断言」——fix-report 直接称"已被上游修复"却零 repro（zero repro，证据门理论上可机械拦截）。F216 落地后，该「假 claim」形态在 F237 已绝迹（no-op 频次亦由 2/3 → 1/3）；F237 唯一的 no-op（r3）带真实 repro（完整执行且判定为真），这正是 F216 设计要消灭的「虚构复现」形态被消灭后的结果。

**结论**：F216 证据门完整履约（真复现 + 独立核实 + 零阻断放行）——**F216 消灭了它设计要消灭的形态（假 claim / 零 repro），r3 命中的是它自身预注册声明不覆盖的边界（真 claim 但目标语义错位）**，不构成漏判，也不是本轮观察到的新失败形态。

**下一步机制方向（诚实标注为 M10 候选，非本轮承诺）**：no-op 出口的复现对账若要求覆盖 issue 的 `FAIL_TO_PASS` 语义断言本身（而非症状消失断言），理论上可机械拦截此形态；但存在待评估的可行性边界——driver 在诊断阶段通常**拿不到** oracle 隐藏测试的具体断言内容（这是评测设计的隔离要求，防止 driver 直接读测试抄答案），"要求对账覆盖测试语义"与"不能泄漏测试内容给 driver"之间存在张力，需要专门设计（如"结构化症状-目标映射合同"而非直接暴露测试代码）才可能落地，本轮不展开方案设计。

### 6b. 转化交叉核验（r1/r2 均转化为 pass）

r1/r2 确因**完整修复路径**通过（四阶段制品全套：`diagnose/plan/implement/verify`，且 `patch.diff` 中含真实源码改动，非零 diff 伪装），审计可证：

- **结果路径证据（与机制假设相容）**：两次会话均记录 `completedPhases: [diagnose, plan, implement, verify]`、`artifacts` 含 `plan.md`/`tasks.md`/`verification-report.md` 全套、`verificationFailures: []`——不是"改标题切分支"式绕门（F216 FR-018 已知边界），是完整走完 fix 工作流并落盘全部制品。
- **timeout 类波动对称性说明**：本批同时观察到 VB003（F212 2/3 → F237 3/3，+1，见终审更正后 §3）——一个单发 timeout 消失（VB003）与一个单发 timeout 新增（V002，见下条）互为镜像噪声对消，说明 N=3 下 ±1 run 的 timeout 类波动本身就在正常噪声带内，V010 终审更正后实为 0 变化，不再作为"同向佐证"引用。

**须诚实标注的混淆因素**（不能不加核验就归功于证据门）：

1. **treatment 不是纯 F216**：从 F212 冻结基线（`4852bf1`）到本轮基线（`0d292e3`），`plugins/spec-driver` 累计含 F213-F236 全部变更，判定器直接相关的至少还有 F218（判定器拆分，[行为保持]声明）+ F228（占位符误报收口）+ F229/F230/F231（绕过闭合三连）。归因指向 F216（V008 病根对应的设计机制：no-op 出口证据门），但**不能排除**这些累计 delta 中某一项对 V008 也有间接贡献（如 F228/F229 修复的绕过窗口若恰好在 V008 的某次尝试路径上被触发过）——本轮取证未覆盖"逐项 delta 消融"（ablation），无法精确切分贡献比例。
2. **N=3 下单 run 波动不可排除**：本批同时观察到 V002（3/3→2/3，反向 −1）——同样是单个 run 的状态翻转（r3 从 pass 变 gen_timeout），且与"证据门介入"无逻辑关联（V002 不属于 no-op 病灶范畴，纯粹是生成侧超时）。这佐证了在 N=3 重复下，**±1 run 级别的波动本身就在正常噪声带内**，V008 的 +1 也无法排除单纯运气成分——尤其考虑到 r1/r2 与 r3 在**完全相同的 base 代码**上给出了相反的方向判断，说明模型对该任务的判断本身具有较高方差，不是"证据门确定性纠正"式的稳定改进。

**综合结论**：r1/r2 转化有结果路径证据（与机制假设相容：证据门相关判定器 delta + 完整制品链），但因果强度应表述为**"有支持性证据、非独占证据"**——不宣称"F216 单独证明使 V008 从 1/3 提升到 2/3"，而是"F216 及其伴随的判定器累计修复，加上本身存在的方差，共同解释了这次观察到的部分改善（描述性）"。

---

## 7. Falsification 附录（运维实录，沿用 F212 §7 格式）

1. **GATE-B mtime 守卫按设计拦下 F212 遗留旧 fixture**：`f237-earlygate.log` 前 134 行全部为 `WAIT stale-fixture`（`runTimestampUtc=2026-07-19` 早于 `launchEpoch=1785581214`），无一次误判通过；第 135 行首个新 run（`V001 r1`）落盘后立即 `PASS plugin-dir=.../plugins/spec-driver`，判定器路径核验闭环。
2. **取证 watcher 跨主批 `aborted`（预算保护截停）持续存活**：`f237-watcher-heartbeat.log` 心跳记录持续至 `2026-08-01T19:00:24Z`（与 `f237-batch-status.json` 的 `updatedAt` 及 `f237-headline.json` 的 `generatedAt` 一致），全程共 1954 行心跳，跨越"主批 exit=2 截停 → resume 起跑 → completed"整个窗口未中断；批次终态 `completed` 后 watcher 按设计退出（终止条件读 `status` 字段，见 plan §3.4）。此机制实战确保了两个 PASS run（r1/r2）在 `--cleanup on-success` 删除 bench worktree **之前**已被抢救（`fixReportSource: watcher-copy`）。
3. **主批预算保护截停（非故障）+ resume 分段**：`f237-headline.log:566` 记录 `⏸ 整批预算不足以完整跑下一 task（余 46min < 需 65min）——已跑数据保留，--resume 续跑`，主批以 `exit=2` 主动止损（`f237-headline.log:579` 记 `总计 pass 24/29 ... wall=6.72h`）；resume 段（`f237-headline.log:615` `--resume：meta 校验 ✅，载入 30 条既有结果`）**载入并跳过 30 条终态 run，补 3 个计分 run（VB003×3），另执行 3 个 warmup control invocation**，`wall=0.67h`（`f237-headline.log:733`），最终 `exit=0` completed。
4. **V007 r2 未被 resume 重跑，走离线重判路径**：其 `runner status=success` 是 resume 的跳过判据（非 oracle 结果），但其 `oracle classification=error`（docker 镜像层瞬时故障）未被 resume 逻辑感知为"需要重跑"——与 F212 §7-4/188 同先例，改用离线重判器（`f237-rejudge-oracle-errors.mjs`，F212 脚本适配版，oracle 语义模块零改动）复用既有 patch 重跑判分。
5. **docker 镜像层瞬时故障 ×2（V007 r2 + VB003 r3）**：`classifyReason` 均含"镜像层失败标志"字样，判分基础设施抖动而非能力失败；`f237-rejudge-result.json` 记录两者离线重判均 → `pass`，`f237-anomalies.json` 标注 `resolution: included-as-pass`。
6. **trap 按原始记录状态恢复 plugin，双次兑现**：`f237-plugin-orig-state.json` 记录发射前原始状态 `{sd:true, sp:true}`（两插件均为 enabled）；跑批期间 `f237-plugin-disabled-verify.json` 确认两者已被 disable（`{sd:false, sp:false}`）；`f237-launch.log` 尾行确认收尾 `[launch] plugin 已按原始记录状态恢复（spec-driver origSd=true spectra origSp=true）`——主批截停（exit=2）与最终 completed（exit=0）两次退出路径均正确触发了 trap 恢复（主批日志亦含同款恢复行，resume 段结束时再次确认），未残留"评测用户全局插件被误关闭"的副作用。

---

## 8. Followup 候补

1. **V008 r3 残余失败形态**（产品，承接 §6a）：no-op 出口证据门若要覆盖任务语义对齐（而非仅症状可复现性），需要设计"结构化症状-目标映射合同"，且必须先解决"driver 不能直接看到 oracle 隐藏测试内容"这一评测设计约束下的可行性问题；不在本轮方案化，留 M10 候选评估。
2. **runId 跨链撞名覆盖取证的基础设施修复**（F212 §9-2 遗留）：本轮仍靠手动存档 + 取证 watcher 规避，未落地"pool 链 runId 加后缀"的一次性修复。
3. **4.4.0 分发未推送 `origin/master`**（P-7，与本 feature 目标无关）：origin 停在 `ce2c036`，npm latest 仍为 4.3.0，marketplace clone 落后 origin/master 80+ commit；不在本 feature 处理范围，但阻塞下一次"用户直接体验 F216 证据门"的分发路径，建议尽快单独排期。
4. **全局 npm 缓存 4.3.0 判定器 drift**（P-4/P-5）：本轮已条件性证明（依赖 P-8+P-9 机械保证）不影响评测链路本身，但该 drift 客观存在且未修复，留待后续 feature 视需要处理。
5. **treatment 消融评估**（承接 §6b 混淆因素 1）：若未来需要精确切分 F216 对 V008 的独立贡献比例，需要专门设计"仅回退 F216、保留 F218/F228/F229/F230/F231"的对照批次，本轮范围未覆盖。

---

## 9. Dogfooding 四维度反馈（政策必附）

- **MCP 可用性**：本 feature 编排主线（spec/plan/tasks/跑批监控/取证/报告撰写）**未直接调用 Spectra MCP 工具**——本 feature 是纯评测复测，无源码改动、无需 symbol 级依赖分析。**评测对象本体**（cohort c3 driver）在 33 个 run 内使用了 Spectra MCP（如 `SWE-V010-r3` fixture 记录 `impact` 调用 ×3 + `context` 调用 ×2，共 5 次），但这是被测项而非编排工具链，二者定位不同，如实分列。
- **信息完整性**：Spec Driver 生成的 spec/plan/tasks 制品对本轮"评测执行计划"这一非常规形态（无源码 Codebase Reality Check）**支持完整**——plan.md §0 改动面声明作为替代结构落地顺畅；但发现一个流程空白：**跑批发射前的环境漂移核验**（P-6/P-8/P-9：全局 plugin 状态、`FIX_COMPLIANCE_CLI` 覆盖、判定器加载路径歧义）完全依赖编排器 Phase 0/Phase 2 手工诊断 + Codex 逐轮补丁堵漏，Spec Driver 框架本身无"评测发射前环境核验模板"这类内建能力——如果未来评测复测类 feature 会重复出现，值得考虑固化为可复用的 checklist/脚本骨架。
- **流程顺畅度**：spec → plan → tasks → implement（跑批）→ verify 五阶段全部走通；每阶段 Codex 对抗审查合计发现并吸收 **Phase 1（spec）1 条"不充分"裁决需补前提 + Phase 3（plan）7 CRITICAL/7 WARNING + Phase 4（tasks）8 CRITICAL/7 WARNING + Phase 5（implement ops 脚本）6 CRITICAL/5 WARNING**，全部在**跑批发射前**修复（含 C5"on-success 即删现场"这类若未拦下会导致 V008 二次取证缺失的关键缺陷）——"设计期抓 bug 比跑批后便宜 100×"经验（F212 已有同结论）本轮再次验证：本轮零因发射器 bug 导致的数据损失。
- **结果准确性**：无 Spectra 相关准确性问题（未在编排主线调用）。Spec Driver 制品与实际跑批结果高度吻合——本报告撰写过程中对全部关键数字（headline 计数、per-task 分数、V008 三行取证）逐一对照原始 JSON/日志/patch 文件核实，无发现制品叙事与原始数据的实质性偏差（详见 §9 成本节脚注中关于 `meta.wallMs` 字段口径的一处技术性澄清，非叙事错误）。

---

## 10. 成本与配额

- **SiliconFlow 实付**：**$0**——headline 链（`eval-pool-rerun.mjs`）未 import `eval-judge-jury.mjs`，无 jury 调用，`SILICONFLOW_API_KEY` 本轮未被消耗。
- **Claude Max 配额消耗**：**advisory 人工模式**（无 dashboard API，同 F212 §7 先例，非可编程自动检测阈值的硬门）。本轮墙钟消耗 ≈ **7.39h**（主批 6.72h + resume 0.67h，来源：`f237-headline.log:579,733` 明确记录）；driver 全程 `claude-sonnet-4-6`；配额提醒行（`QUOTA_REMINDER_EVERY=6`）在主批期间共出现 **5 次**（6/12/18/24/30 run 节点，`f237-headline.log` 逐条可核），全部转发为进度播报，**未触发 ≥60% weekly 阈值的用户中断决策**（无对应对话记录）。
- **notional 成本参考**（非实付，仅作规模量级参考）：对 33 个 judged run 中的 30 个（有 fixture 落盘的成功 run；3 个 gen_timeout run 无 fixture 无成本记录）汇总 `perf.estimatedCostUsd` 字段，合计 **≈$102.14**——这是"若按 token 计价的 API 折算金额"，**不是实付**（Claude Max 订阅边际成本为 $0）。单 run 样例：`SWE-V010-r3` `estimatedCostUsd=$5.756249650000003 ≈ $5.76`（fixture 现场核对确认）。
- **`meta.wallMs` 字段口径澄清**（技术性，非叙事误差）：`f237-headline.json` 的 `meta.wallMs=2429601ms（≈40.5min）` 对不上"7.39h 总墙钟"的叙事数字——现场核实发现该字段实为**最终一次调用（resume 段）的局部计量**（`2429601ms≈0.675h`，与 `f237-headline.log:733` 记录的 resume `wall=0.67h` 高度吻合），因为 `meta` 块在每次 `--resume` 调用后被整体覆盖写入，未保留主批段（6.72h）的历史值。本报告 §10 的"7.39h"总墙钟数字取自日志的两段独立记录相加（`6.72h + 0.67h`），而非直接引用该 JSON 字段，特此说明口径来源避免误读。
- **若发生中断/续跑的额外开销**：主批因预算保护 `exit=2` 主动截停一次（非用户中断），resume 后无额外重跑已完成 run（(task,tool,repeat) 级幂等确认跳过 30 条终态结果），额外开销仅为 resume 段本身的 0.67h（补跑 VB003 三个 run），无因中断导致的重复计费或数据丢失。

---

## 11. SC 达成清单

| SC | 描述 | 状态 | 依据 |
|---|---|---|---|
| SC-001 | 33/33 判分零剔除或每一处剔除都有明确分类原因 | ✅ 达成 | `f237-anomalies.json` 6 条异常全记录分类；批内 2 个 oracle_error 经离线重判并入终值，终态零剔除 |
| SC-002 | V008 三行取证表完整，字段全非空 | ✅ 达成 | `evidence/v008-r{1,2,3}/` 共 12 文件、0 个 `.absent`；本报告 §5 逐字段完整呈现 |
| SC-003 | `PUBLISH-REPORT-M9-interim.md` 存在，含四方终表/C1 红线/诚实结论三要素 | ✅ 达成 | 本文件 §2/§4/§6 |
| SC-004 | 每 phase 均有 Codex 对抗审查记录 | **PARTIAL → 闭环中** | verify phase 的 Codex 对抗审查已执行（本轮终审 3C/5W），findings 修复后由 verify 子代理复核（见 verification-report 修订版）；全部五 phase（specify/plan/tasks/ops/verify）审查记录 trace.md 可定位 |
| SC-005 | push 前交付报告出现且等用户确认后才 push | **待用户**（本报告完成后，由编排器在 push 前另行执行交付报告 + 等待确认） | — |
| SC-006 | 诚实结论对称结构（5a/5b 均有实质内容） | ✅ 达成 | 本文件 §6a（未完全转化归因）、§6b（转化交叉核验）均有实质分析，非仅一侧有内容 |
| SC-007 | `git status --porcelain` 仅显示预期显式路径改动 | ✅ 达成 | verify 子代理已实证核验（见 `verification/verification-report.md` SC-007）：`git status --porcelain --untracked-files=all` 仅显示 `specs/237-v008-retest-gstack/**` 内改动，无评测产物混入 |
| SC-008 | 成本小节存在，SiliconFlow 实付 <$10 | ✅ 达成 | 本文件 §10，SiliconFlow 实付 $0 |
| SC-009 | `FIX_COMPLIANCE_CLI` 核验记录留档 + 发射器脚本显式 `unset` | ✅ 达成 | `f237-launch.log:1,585` 两次记录 `FIX_COMPLIANCE_CLI count after unset: 0`（主批 + resume 各一次） |
