# F289 Tier 2 续做合同 · 第三轮（delta）对抗审查——绕过面 / fail-open

> 切入角：绕过面 / fail-open。审查基线：HEAD `3bee4d5a`（对比 implement 阶段修复前 `db8664e4`）。
> 本轮只审最新两处修复：(1) `detectTier2Binding` 佐证锚点 `corroborationAnchorLineIndex`（三源各记
> `latestActivityLineIndex`，取最大值，替换原先 `blockFeedbackCount`/`storageUnavailableFeedbackCount`
> 窗口下界）；(2) sidechain `main`/`carried` 双空时 candidate 由 `{path:null,ambiguous:false}` 改为
> `{path:null,ambiguous:true}`。默认「假设修复有漏洞、尝试证伪」。全部实验在 scratchpad 隔离进行
> （`.../scratchpad/adv-f289-delta-a/`），未 `git stash`/`checkout <path>`/`add`/commit，未改动 worktree
> 任何文件；`git status` 复核全程干净。

与同批次 `delta-review-misblock.md`（误伤面角）交叉核对：该报告已在 §③ 明确把"sidechain
ambiguous:true 是否降低绕过门槛"这一问题划出其审查范围，交给本报告（绕过面角）——本报告 CRITICAL-2
直接回答了这个问题：**是，门槛被显著降低**。

## ① 亲跑

- `node --test plugins/spec-driver/tests/fix-compliance-tier2-continuation.test.mjs`（worktree 原文件，未改动）：**23/23 pass, 0 fail**（U1-U5/A1-A5/B1-B3/C1-C5/E1-E3/D1-D2）。

## ② 核心发现表

| # | 构造 | 预期（fix-report 隐含承诺） | 实测 | 判定 |
|---|---|---|---|---|
| 1 | **跨目标 Bash-pivot 绕过**（详述见③）：(a) resume 绑定 Fix-A，仅用 **Bash**（非 Write/Edit 工具）写指示符提名 Fix-A → 2 次真实 exit 2 → 仅用 Bash 写指示符（不再展开 resume、不用 Write/Edit）pivot 到全新 Fix-B → Fix-B 首次评估 | Fix-B 应至少经历 2 次真实 exit 2（impl-C1 的设计意图） | **stop#1,2(Fix-A)=2,2；stop#3(Fix-B 首次评估)=0**（GATE-DEGRADED），且用差异化 staging 确证候选真的切到 Fix-B（stderr 出现"缺少验证报告"，只有 Fix-B 缺 verification-report.md） | **CRITICAL-1**：impl-C1 修复不完整，Bash-only pivot 仍 0 往返绕过 |
| 2 | 同 1，改用纯 (b) witness 绑定（**无 resume**，Fix-A 用 Write 工具建立唯一 witness，pivot 到 Fix-B 仅用 Bash） | 同上 | **stop#1,2(Fix-A)=2,2；stop#3(Fix-B)=0**，同样以缺 verification-report.md 确证已切换 | 复现，证明与 resume 无关，(a)/(b) 两源同型 |
| 3 | 同 1，改用带 `prompt_id`（每次不同）的 payload，走 `routeByFingerprint` 而非 `routeBlock` | 指纹路由不应改变结论 | 首次 `nonblock`（fingerprint 路由固有的"首次无 last 可比"），第 2/3 次 `block`（blockCount→2），**第 4 次（Fix-B）=0** | 指纹路由同样中招，`routeBlock`/`routeByFingerprint` 两路共享同一 `counts.blockFeedbackCount`，无一幸免 |
| 4 | **sidechain 免费通行证**：真实调用 `recordSidechainFixMarker` CLI（非直接摆数据）记一个"子代理展开 `/spec-driver:spec-driver-fix` 但零写入"的标记（`candidatePath:null`），主会话零提名 + 一次 `Agent(subagent_type:'spec-driver:verify')` 委派（同样零真实产出要求），**首次** Stop | 若真无法定位目录才应降级；理应仍需佐证/往返 | **首次 Stop 即 exit 0，stderr 为空**；`--mode hook` A/B：**`db8664e4` 同构造 exit 2**（`missing:['feature-dir','fix-report.md']`，`tier2-bound-sidechain`），**HEAD exit 0**（`transcriptDiagnostics:['feature-dir-unresolvable']`，早退，`verdict:null`，未经 `BLOCK_LIMIT`/佐证机制） | **CRITICAL-2**：本delta修复把一个此前需要 2 次真实阻断才能降级放行的会话，变成 0 历史、0 往返、0 corroboration 的无条件放行 |

## ③ CRITICAL-1 详述：impl-C1 的"跨目标佐证前移"只堵住了部分绕过路径

**根因链**：

1. `resolveFeatureDirCandidate`（`fix-compliance-core.mjs`）的候选状态机对 `Write`/`Edit` 工具与
   **`Bash`**（经 `hasBashWriteIndicator`/`BASH_WRITE_INDICATOR_REGEX`，`fix-compliance-core.mjs:66`）
   一视同仁，都能推进"最后写入者获胜"的 `candidate.path`——这对 Tier 1/Tier 2 的**候选解析**从来如此，
   非本轮改动引入。
2. 但本轮新增的**佐证锚点**追踪（`detectTier2Binding`，`fix-compliance-judge.mjs:309-362`）对每个源的
   `latestActivityLineIndex` 定义是**窄口径**：
   - (a) resume 源：`Number.isInteger(anchor.latestResumeLineIndex) ? anchor.latestResumeLineIndex : anchor.earliestResumeLineIndex`
     ——只在**又一次** `/spec-driver:spec-driver-resume` **展开**时前移，不感知 `resolveFeatureDirCandidate`
     状态机的任何写入事件；
   - (b) witness 源：`witnesses[witnesses.length-1].lineIndex`——`witnesses` 来自
     `collectArtifactWriteWitnesses`（`fix-compliance-core.mjs:1162`），该函数逐字只认
     `ARTIFACT_WRITER_TOOL_NAMES = {Write, Edit}`（同文件:1029），**不含 Bash**（这是 spec 阶段
     C-3 已如实登记的"残余 5"——但残余 5 讨论的是"纯 Bash 会话可能整体逃过 (b) 源的**检出/绑定**"，
     是一种"漏判/未识别为 Tier2"的 fail-open；本发现是**另一件事**：会话已经通过 (a) 或 (b) 的**正常
     渠道**完成绑定检出，只是绑定**之后**用 Bash 做的一次 candidate pivot 不被佐证锚点追踪——候选解析
     承认这次 pivot（判定对象真的换成了 Fix-B），佐证窗口却假装它没发生。
3. 于是：Fix-A 通过 resume 或一次 Write 见证正常绑定、正常耗尽 2 次真实阻断并降级放行（`state.blockCount`
   停在 2，不因降级放行而重置——`routeBlock`/`routeByFingerprint` 的 `release`/`nonblockRelease` 分支只置
   `degradedRecorded:true`）；此后**仅用 Bash** pivot 到一个从未出现过的全新 Fix-B，`corroborationAnchorLineIndex`
   （`fix-compliance-judge.mjs:361`）依旧钉在 resume/witness 的旧行号，`countBlockFeedbackEntries`
   （`fix-compliance-judge.mjs:474`）把 Fix-A 的 2 条历史回灌算进 Fix-B 的"佐证"，`state.blockCount>=BLOCK_LIMIT`
   与 `blockFeedbackCount>=BLOCK_LIMIT` 同时成立 ⟹ Fix-B **首次评估即降级放行**。
4. 已用 4 种独立构造证实（②-1/2/3 + 下方 witness-only 变体），resume 源、witness 源、`routeBlock`、
   `routeByFingerprint` 全部命中，无一方向"天然免疫"。

**与 fix-report.md §7 的接缝（over-claim，见④）**：`fix-report.md:101` impl-C1 一行写"跨目标续做时佐证
窗口前移，Fix-B 须自付 2 次阻断"——该表述隐含"任何跨目标 pivot 都会被佐证窗口追踪到"，但佐证窗口的
"前移"只在 pivot **恰好经由** resume 重新展开或 Write/Edit 工具写入时才发生；经由 Bash 的 pivot（`resolveFeatureDirCandidate`
明确支持、且是 F225/F230 一路加固过的合法提名形态，非边缘用法）不会推动任一源的 `latestActivityLineIndex`。
残余 9（`fix-report.md` §7 末尾）声称"佐证锚已逐目标前移堵住降级复用面"，同样只在"pivot 经 Write/Edit
或新 resume 展开"这一子集上成立。

## ④ CRITICAL-2 详述：sidechain `ambiguous:true` 与既有 F224 宽松通道叠加成本非对称的免费通行证

`fix-compliance-judge.mjs:338-344`（(c) 分支）：`main`/`carried` 双空 ⟹
`candidate = {path:null, ambiguous:true, candidates:[]}`。这与 `fix-compliance-judge.mjs:648` 的
`featureDirUndetermined = resolvedPath===null && candidate.ambiguous===true` 及 `:737-740` 的
`if (featureDirUndetermined && hasVerifyClassDelegation) return {..., transcriptDiagnostics:[featureDirUnresolvable], verdict:null}`
叠加——这是 **F224 的既有宽松早退通道**（`runHook` 见 `transcriptDiagnostics.length>0` 即 `return 0`，
在 `BLOCK_LIMIT`/佐证机制**之前**短路，`fix-compliance-judge.mjs:1414`），历史上已被 F224→F230 两轮
CRITICAL 收窄过。

问题不在于"这条通道存在"（Tier 1 的光杆 `mv` 到非规范名 + verify 委派同样能走它，这是 spec 阶段就
接受的 SC-005 已知限界），而在于**这条通道对 (c) 源的构造成本远低于对 (a) 源**：

| | 触发 `ambiguous:true` 的成本 | 是否需要本会话主 transcript 做任何真实工作 |
|---|---|---|
| (a) resume（既有 F224/F230 已加固形态） | 本会话主 transcript 需**真实展开**一次 fix skill、**真实提名**一个目录、再把它 `mv` 到非规范名 | 需要 |
| (c) sidechain（本轮新增可达形态） | 任意一个被派发的子代理展开一次 `/spec-driver:spec-driver-fix` 且**在被 SubagentStop 捕获前未写出任何制品**（探查后放弃、被打断、上下文耗尽都会天然产生这个形状） | **不需要**——主 transcript 可以零提名、零写入 |

实测（`recordSidechainFixMarker` CLI 真实调用，非直接 `writeSidechainMarker` 摆数据）：一个子代理 transcript
只有 `EXPANSION('fix')` + 一句 assistant 文本、**零**工具调用，即可写出 `candidatePath:null` 的合法标记；
主会话只需一次 `Agent(subagent_type:'spec-driver:verify', description:'验证修复结果')`（`VERIFY_ROLE_REGEX`
纯文本匹配，`extractDelegationsAfter` 不要求任何 tool_result 回执，`fix-compliance-core.mjs:677-699`），
**首次** Stop 即 exit 0、stderr 为空、审计事件 `{compliant:null, missing:[], blockCount:null, degraded:true}`
（`tryAppendFailOpenEvent`，`fix-compliance-judge.mjs:1374`——**不含** `tier`/`tier2-bound-sidechain`，事后
无法从审计流区分这是"真的目录改名不可寻"还是"子代理探了一下就走了"）。

A/B 确认这是本轮新引入的行为（非既有残余的重新表述）：

```
db8664e4（本轮修复前）同构造：exit 2，missing:["feature-dir","fix-report.md"]，tier:2，tier2-bound-sidechain
HEAD（本轮修复后）  同构造：exit 0，stderr 空，diagnostics:["feature-dir-unresolvable"]（早退，无 tier 字段）
```

`impl-review-misblock.md`（round 2，误伤面角）正是提出这个修复方向的报告，其定位始终是"修一个真实存在的
误阻断"（真实语料 624 份 0 正例，判定为"潜伏但尚未发生"），未从"这个新可达形状本身有多便宜"的角度评估;
`impl-review-bypass.md`（round 2，绕过面角）审查时该改动尚不存在（两份 round 2 报告共享同一基线
`587a0fe2`，此改动是**综合**两份报告后才写出的）。故本轮是这段代码第一次接受绕过角度的审视。

## ⑤ 变异测试（scratchpad 隔离副本，`git archive HEAD` 抽取，未碰 worktree；每次单独变异、单独还原）

| 变异 | 结果 | 抓到的用例 | 结论 |
|---|---|---|---|
| `corroborationAnchorLineIndex` 改回 `primary.anchorLineIndex`（最早，任务要求变异 ①） | 22 pass / **1 fail** | E1（`0 !== 2`） | 有守护——回退到"最早锚"会立刻被 E1 抓住 |
| `Math.max(...latestActivities)` 改 `Math.min(...)`（任务要求变异 ②） | **23 pass / 0 fail（全绿）** | 无 | **守护缺席**：23 个用例里没有一个构造"多源同时命中且 `latestActivityLineIndex` 互不相同"的场景（每个用例要么单源、要么多源退化为同一行），`Math.max`→`Math.min` 在现有测试矩阵下是**观察等价**的——见⑥ WARNING-1 |
| sidechain `ambiguous:true` 改回 `ambiguous:false`（任务要求变异 ③） | 22 pass / **1 fail** | E2（`2 !== 0`） | 有守护——但如④所述，"有测试守护这次改动做了什么"与"这次改动本身是否安全"是两个问题；E2 只钉住了"改动确实生效"，不判断"生效后是否可被便宜地滥用" |

## ⑥ 三档计数

**CRITICAL（3）**

1. **跨目标 Bash-pivot 绕过残留**（②-1/2/3 + ③ 根因链）：impl-C1 的佐证锚点前移机制只覆盖"pivot 经由
   新 resume 展开"与"pivot 经由 Write/Edit 工具写入"两种形态；`resolveFeatureDirCandidate` 同等承认的
   **Bash 写指示符** pivot 不被任一源的 `latestActivityLineIndex` 追踪，`corroborationAnchorLineIndex`
   停留在旧目标行号，使全新目标可复用旧目标的历史阻断反馈实现 0 真实往返降级放行。resume 源、witness 源、
   `routeBlock`、`routeByFingerprint` 四种组合均实测复现。
2. **fix-report.md §7 over-claim**：`fix-report.md:101` "单目标时 == primary，零行为变化" 与"跨目标续做时
   佐证窗口前移，Fix-B 须自付 2 次阻断"、以及残余 9 "佐证锚已逐目标前移堵住降级复用面"，均未限定"仅当
   pivot 经 resume 展开或 Write/Edit 工具"这一前提，与①③实测的 Bash-pivot 反例矛盾，构成 over-claim。
   与发现 1 共享根因，但作为独立的"文档/代码保证范围不一致"问题单独登记（沿用 `impl-review-bypass.md`
   CRITICAL-2 的既有登记惯例）。
3. **sidechain `ambiguous:true` 免费通行证**（②-4 + ④）：本轮为修复一个误阻断而把 (c) 源的退化提名形状
   接入既有 F224 宽松通道，但该形状的构造成本远低于 (a) 源历史上被两轮（F224→F230）加固时假定的"必须
   在本会话真实做过一次提名再改名"门槛——只需一个零产出的廉价子代理 + 一次文本匹配即成立的 verify 委派，
   即可让一个从未被阻断过一次、零真实修复产出的全新会话首次 Stop 就无条件、零审计 `tier` 归属地放行。
   直接回答 `delta-review-misblock.md` §③ 明确交办给本报告的问题：**是**，绕过门槛因本轮改动而显著降低。

**WARNING（2）**

1. `Math.max`→`Math.min` 的变异在全部 23 个测试上观察等价（⑤）。当前测试矩阵没有任何"多源同时命中
   且 `latestActivityLineIndex` 不同"的构造（E1/E2 均是单源退化），意味着"取最大值"这一关键方向性
   决策本身缺乏回归保护——不是当前代码有 bug（`Math.max` 是对的），而是这一行如果被未来重构悄悄改动
   （例如"简化"为取平均或误写反），不会被任何自动化测试发现。
2. 现有 23 个测试均未构造"绑定经由 Write/Edit 或 resume 正常建立，随后用 **Bash** 写指示符 pivot 到
   新目标"这一形态——CRITICAL-1 的确切绕过形状在提交时的测试矩阵里结构性不可能被抓到（`E1`/`E2` 的
   pivot 构造统一使用 `Write` 工具）。这是发现 1 能在 round 2 两份异构对抗 + 本次 implement 合并之间
   未被发现的直接原因。

**INFO（3）**

1. 任务条目 (b)（"Fix-B 最晚活动行早于 Fix-A 回灌，乱序 transcript"）：核实 `corroborationAnchorLineIndex`
   与 `countBlockFeedbackEntries` 均只按 `lineIndex`（transcript 内物理行序）比较，不读取/比较
   `timestamp`——乱序时间戳不构成独立于发现 1 的额外绕过面（发现 1 的根因是"事件类型未被追踪"，不是
   "时间戳被伪造/乱序"）。
2. 任务条目 (e)（sidechain-only 回落 `-1` 时 `corroborationAnchorLineIndex=-1`，是否回到全会话佐证窗口）：
   核实为真（`latestActivities` 过滤 `n>=0` 后为空 ⟹ 回落 `-1`；`countHookFeedbackEntries` 对 `-1`
   等价于"从会话起点起算"），但这与本轮改动前的 `tier2.anchorLineIndex`（同样在此形态下取 `-1`）**逐字
   一致**，不是本轮引入的新回退面，属已在源码注释（`detectTier2Binding` 顶部"残余，见 fix-report §7"）
   如实登记的既有残余延续，非独立发现。
3. 与 `delta-review-misblock.md` 交叉印证：该报告独立发现 `corroborationAnchorLineIndex` 存在**方向
   相反**的自伤性缺陷——同一目标内的**合法**重复活动（二次编辑 witness 制品 / 二次展开 resume）同样会
   前移锚点，把窗口前的合法阻断反馈误排除出佐证计数，最坏情形下（用户持续按判定器提示编辑响应）自愈
   永久不触发。两份报告分别从"该前移不够"（本报告，绕过面）与"该前移太随意"（misblock 报告，误伤面）
   两个方向证伪同一处实现，共同指向同一个根因诊断：`latestActivityLineIndex` 的定义把"时间上更晚的
   同类事件"当成了"目标身份是否切换"的代理指标，两者并不等价——正确的前移条件应该是"候选目录/绑定目标
   是否变化"，而不是"该源类型是否出现了更晚一次同类事件"。修复应统一到同一处，不应分别打补丁。

## ⑦ 没构造出来的清单（≠安全，只是本次预算内未达成）

- **`hasVerifyClassDelegation` 的账本补充半边**（`ledgerSupplement`，`fix-compliance-judge.mjs:665-672`）
  是否能替代 CRITICAL-2 里"主 transcript 一次 verify 委派"这一步、把成本降到"只需写一行账本 JSON"——
  代码读显示理论上可行（`featureDirUndetermined && hasVerifyClassDelegation` 的 `delegations` 已包含账本
  补充，源码注释 `fix-compliance-judge.mjs:718-721` 自己也承认这是"用户拍板接受的下界，只防疏忽不防
  蓄意"），但本轮未实际构造账本文件验证端到端效果，作为 CRITICAL-2 的成本下界补充说明，不单独计分。
- **CRITICAL-1 与 CRITICAL-3（sidechain 免费通行证）组合**：未测试"sidechain 免费通行证"是否也能反向
  被 Bash-pivot 手法从"任意会话"收窄到"任意会话+跨目标佐证复用"叠加使用——两者互相独立已经各自成立
  0 往返，组合大概率不会更差，判断优先级不高，本轮未验证。
- 未重新核实 round 2 遗留的"isMeta 伪造""K-6 跨会话标记 DoS"等未构造项——不在本轮授权的两处最新
  修复范围内，维持 round 2 报告的既有登记。

## 结论

写到：`specs/289-fix-compliance-continuation-binding/verification/delta-review-bypass.md`。CRITICAL 3 /
WARNING 2 / INFO 3。**一句话结论**：本轮两处修复都各自解决了它们声称要解决的问题（E1/E2 变异测试证实），
但都只覆盖了问题的一个子集——跨目标佐证前移只认"新 resume 展开"与"Write/Edit 见证"两种 pivot 信号，
Bash 写指示符 pivot（候选解析本身认可的合法提名形态）仍可 0 往返复用旧目标的阻断历史；sidechain
`ambiguous:true` 为修一个真实误阻断而接入的 F224 宽松通道，构造成本远低于该通道历史上假定的门槛，
使一个零历史、零真实产出的全新会话即可无条件放行。两处均建议在合入前修复，且应与
`delta-review-misblock.md` 发现的方向相反的自伤性缺陷一并处理——两者共享同一个"用时间先后代替目标
身份"的根因，理想修法是让佐证窗口的前移条件显式挂在"候选目录是否变化"上，而不是任一源"是否出现更晚
一次同类事件"。
