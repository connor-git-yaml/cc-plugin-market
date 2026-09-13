# F289 Tier 2 续做合同 · 第三轮（delta）对抗审查——误伤面 / 正确性 / 回归覆盖

> 切入角：误伤面（误阻断诚实用户）/ 正确性 / 回归覆盖。审查基线：HEAD `3bee4d5a`（对比 `db8664e4`）。
> 本轮只审最新两处修复：(1) `detectTier2Binding` 佐证锚点 `corroborationAnchorLineIndex`（三源各记 `latestActivityLineIndex`，取最大值，替换原先 `blockFeedbackCount`/`storageUnavailableFeedbackCount` 窗口下界）；(2) sidechain `main`/`carried` 双空时 candidate 由 `{path:null,ambiguous:false}` 改为 `{path:null,ambiguous:true}`。
> 默认「假设修复有副作用、尝试证伪」。全部实验在 scratchpad 隔离进行（`.../scratchpad/adv-f289-delta-b/`），`git status`/`git diff --stat` 复核：本 worktree 全程零改动。

## ① 亲跑

- `node --test plugins/spec-driver/tests/fix-compliance-tier2-continuation.test.mjs` → **23/23 pass**（U1-U5/A1-A5/B1-B3/C1-C5/E1-E3/D1-D2）。
- `fix-compliance-judge-cli` + `fix-compliance-card-a-diagnostics` + `fix-compliance-card-b-lock-fingerprint` + `fix-compliance-core` 四套合计 **877 tests → 875 pass / 0 fail / 2 skip**（skip 与本卡无关）。Tier 1 零翻转在这四套上成立。

## ② corroborationAnchor 误伤面：发现一个可复现的 CRITICAL 级自伤缺陷

### 核心结论

`corroborationAnchorLineIndex = Math.max(所有命中源的 latestActivityLineIndex)` 这个构造，把"跨目标佐证不复用"（E1 要防的绕过面）和"同目标内合法重复活动会前移佐证窗口"（未被察觉的误伤面）**焊在了同一个数字上**——它不区分"新目标绑定事件"与"同一目标的第 N 次合法编辑/续做"，只要命中源里出现任何更晚的活动行，窗口下界就跟着走。这直接反驳了 fix-report.md §7 impl-C1 行的原话（`specs/289-fix-compliance-continuation-binding/fix-report.md:101`）：

> "跨目标续做时佐证窗口前移，Fix-B 须自付 2 次阻断；**单目标时 == primary，零行为变化**。"

`corroborationAnchorLineIndex == primary` 只在"该目标全程只产生一次绑定活动"这一退化情形下成立；只要同一目标内出现第二次witness写入或第二次resume展开（现实中极常见——修 typo、按反馈补内容、上下文压缩后分段续做），`corroborationAnchorLineIndex` 就会前移到那次活动之后，与 primary 分道扬镳，**行为并非"零变化"**。

### 实测构造（真实驱动生产 CLI，spawnSync，未 mock 任何环节）

| # | 构造 | 方法 | OLD（`db8664e4`）exit 序列 | NEW（HEAD）exit 序列 | 判定 |
|---|---|---|---|---|---|
| M1 | (b) witness 源：单目标写 `fix-report.md` 后又 `Edit` 同文件一次（如 typo 二改），中间各插一次阻断+回灌 | `probe-self-injury.mjs` | 2,2,**0**（第 3 次自愈） | 2,2,**2**（`state-budget-uncorroborated`，未自愈） | **自伤已复现**（对应任务 (a)/(d)） |
| M2 | 同上，但每次阻断后都紧跟一次编辑响应反馈（"最自然的合规行为"），连续 8 轮 | `probe-self-injury-perpetual.mjs` | 2,2,**0,0,0,0,0,0**（第 3 轮起恒放行） | 2,2,2,2,2,2,2,**2**（8 轮全阻断，**从未自愈**） | **CRITICAL：永久阻断**，不是"多等一轮"，是只要用户持续用编辑响应反馈就永不释放 |
| M3 | 同 M1，但 hook payload 带 `prompt_id`（每轮不同，走 `routeByFingerprint` 指纹路由而非 `routeBlock`） | `probe-self-injury-fp.mjs` | （未跑 OLD，NEW 侧确认） | 2,2,**2**，状态文件 `blockCount:2, degradedRecorded:false` | 指纹路由与非指纹路由**共用同一 `releaseCorroborated`**，两条路径同样中招 |
| M4 | (a) resume 源：单目标下"正常分段续做"——首次 resume+提名后被阻断，之后不写任何新证据、只是再展开一次 `/spec-driver:spec-driver-resume`（无新提名，靠既有提名延续），连续 6 轮 | `probe-resume-reexpand.mjs` | 2,2,**0,0,0,0**（第 3 轮起自愈） | 2,2,2,2,2,**2**（6 轮全阻断，未自愈） | **自伤同样发生在 (a) 源**（对应任务 (b)），resume 重新展开本身就会前移窗口 |
| M5 | 停止编辑后回归验证：M1 场景在第 3 轮阻断后，第 4 轮**不再编辑**、只是重新调用 Stop | `probe-self-injury-recover.mjs` | — | r1,r2,r3=2,2,2；r4=**0** | 确认不是"永久锁死"而是"窗口跟着最后一次合法活动走"——只要用户在获得 2 条阻断反馈前**不再产生新witness/resume事件**就能如期自愈；但只要继续用编辑响应阻断（M2 的自然行为），就会一直被反复"打回起点" |
| M6 | 单一见证、无重复活动的最简单情形（对应任务 (c)：单目标 == primary 是否成立） | 由 A1-A5/B1-B3/C1-C5 既有 23 项测试隐含覆盖 | — | 与 OLD 逐字一致 | **(c) 成立**：仅当目标全程只有一次绑定活动时 `corroborationAnchorLineIndex == primary`，此时确无行为变化 |

M1/M2/M4 均用 `git archive db8664e4` 抽取的隔离快照与 HEAD 做严格 A/B（同一份 transcript 构造脚本，只换 CLI 路径），排除了"本来就会阻断"的混淆——**OLD 代码在完全相同的操作序列下总能正常释放，NEW 代码不能**，因果关系明确指向本轮 `corroborationAnchor` 改动。

### 根因

比较三源里各自的 `latestActivityLineIndex` 定义：
- (a) resume：`anchor.latestResumeLineIndex`——**任何一次**新的 `/spec-driver:spec-driver-resume` 展开都会推高它，不要求这次展开携带新提名；
- (b) witness：`witnesses[witnesses.length-1].lineIndex`——**任何一次**新的 `Write`/`Edit` 命中 `fix-report.md`（同一 dir 也算）都会推高它；
- 二者都没有"这是不是同一个目标在继续，还是切换到了新目标"的判别，只看"是否有更晚的同类活动"。

而 fix-report 描述的设计意图明确是**针对跨目标**（"Fix-A 降级后再 resume 到 Fix-B"）——`detectTier2Binding` 里的实现注释也这样写（`fix-compliance-judge.mjs:314-316`），但落地代码用的判据（"该源最晚一次活动"）无法区分"新目标"与"旧目标的第 N 次合法续做"，本质上是**用时间先后代替了目标身份**，把一个身份判据问题错误地建模成了时间戳问题。

### 影响面评估

- 触发门槛低、场景自然：修 fix-report.md 里的 typo、按 Stop 反馈逐步补内容（这是判定器 stderr 自己教用户做的事——"请把模板占位符替换为真实内容"）、长会话里因上下文压缩重新走一次 `/spec-driver:spec-driver-resume`，都是完全正常、判定器自身鼓励的行为。
- 后果不是"多等一次"：M2 证明持续这样做会让 release valve **永不触发**，直接与"护栏 R-6：Stop hook 不可 brick 会话"（memory / CLAUDE.local.md 反复强调的不变量）冲突；也直接架空 F276 卡 C（`storageUnavailableFeedbackCount`）与 F288 卡 B 6b（`blockFeedbackCount`）两条"防止诚实用户被拖垮存储/自愈失败而永久锁死"的既有防线——它们与 `blockFeedbackCount` 共用同一个 `corroborationAnchor`，同样会被同目标重复编辑"清零"。
- 真实语料现状：本机 383 份 transcript 里 0 个 Tier2 命中（见⑤），此缺陷**尚未在生产触发过**，是潜伏缺陷而非已发生事故；但一旦 Tier 2 合同被真实使用（这正是本卡的目的），触发概率不为零——尤其是判定器自己的 stderr 会诱导用户去做"编辑 fix-report.md 补内容"这个恰好会踩雷的动作。

## ③ sidechain `ambiguous:true` 误伤面

| 构造 | 结果 | 判定 |
|---|---|---|
| 无提名（main/carried 双空）+ 有 verify 委派 | exit 0 + `feature-dir-unresolvable`（F224 宽松早退） | 与 fix-report 描述一致 |
| 无提名 + 无 verify 委派，连续 2 次阻断 + 2 条回灌，第 3 次不再回灌 | 2,2,**0** | **与 "光杆 mv"（(a) 源 ambiguous:true）对齐**：都走硬判但都能 2 次自愈——因为此形态下 `witnessAnchor=null`，`latestActivityLineIndex` 回落 -1（被 `corroborationAnchorLineIndex` 的 `filter(n=>n>=0)` 排除），窗口保持全会话最宽，未触发②的自伤逻辑 |

任务里担心的"是否会与 (a) 光杆 mv 处置不对齐"**未发现反例**——sidechain-only 无 witness 的场景恰好因为没有真实锚点可供"前移"，反而绕开了②的问题（这是巧合式地安全，不是刻意设计出的豁免；一旦该 sidechain 命中与一个 witness 命中同时存在于同一目标，就会重新落入②的一般性问题，此时 sidechain 自身的 `latestActivityLineIndex` 不再是 -1 而是 `witnessAnchor.lineIndex`，同样会被 witness 的重复写入牵着走）。

`main`/`carried` 双空 ⟹ `ambiguous:true` 本身没有引入新的误伤——它是把此前"无条件硬阻断"的一种形状改造成"与光杆 mv 同构的可自愈硬阻断（无 verify 时）/ 宽松早退（有 verify 时）"，两条支路都验证与描述相符，均属于**修复了一个既有误阻断**（`impl-review-misblock.md` CRITICAL-1），未发现该修复自身引入的新误伤面。

## ④ 回归覆盖（变异测试，均在 scratchpad 隔离副本上进行，未改动 worktree 源码）

| 变异 | 方法 | 结果 | 结论 |
|---|---|---|---|
| 撤销 corroborationAnchor（`corroborationAnchor = effective.latestFixLineIndex` 恒定，不分 tier） | 整份 `plugins/spec-driver` 复制到 scratchpad + sed 改一行 | E1 **翻红**（`0 !== 2`），其余 22 项仍绿 | E1 对本轮修复(1)有效钉住 |
| 撤销 sidechain ambiguous:true（改回 `{path:null,ambiguous:false}`） | 同上 | E2 **翻红**（`2 !== 0`），其余 22 项仍绿 | E2 对本轮修复(2)有效钉住 |
| 撤销账本 sinceTs（`readLedgerDelegations(... {sinceTs:null})` 恒空） | 同上 | E3 **翻红**（`2 !== 0`） | E3 对（非本轮，但同批次新增的）sinceTs 覆盖有效——闭合了 `impl-review-misblock.md` CRITICAL-2 的**账本**半边 |
| 撤销"闸门三真实锚点"（Tier2 `effective.earliestFixLineIndex`/`latestFixLineIndex` 强制回 -1，**保留** `latestFixTimestamp` 不动以隔离出纯窗口效应） | 同上 | **23/23 仍全绿** | **CRITICAL-2 的"闸门三真实锚点"半边依然零回归覆盖**——`impl-review-misblock.md` 报告的这项缺口在 23 个测试的当前状态下仍未闭合（fix-report 已如实改写 spec §7 措辞将其定性为"F257 有界化的预期行为"而非缺陷，未声称已补测试，故此项不构成 over-claim，但作为回归覆盖缺口如实登记） |
| 未覆盖的新代码路径 | 逐行核对 | `detectFixSkillExpansion` 里 `Number.isInteger(anchor.latestResumeLineIndex) ? ... : anchor.earliestResumeLineIndex` 的 `:` 分支（fallback）在现有实现下不可达（两者总是同步置值），非功能性缺口，仅为防御性冗余 | INFO 级，不影响正确性 |
| **本轮②发现的"同目标重复witness/resume"路径** | 逐条核对 A1-A5/B1-B3/C1-C5/E1-E3/D1-D2 | **23 项测试里没有任何一条构造"同一目标内两次witness写入"或"同一目标内两次resume展开"** | **这正是让②的 CRITICAL 缺陷得以在合并前未被发现的根本原因**——建议至少补 2 条：(i) 单目标二次witness+中间穿插阻断反馈的自愈钉；(ii) 单目标二次resume展开+中间穿插阻断反馈的自愈钉。两条都应断言"第 3 次即放行"（对齐 OLD 行为 / A3 的既有自愈语义），撤销②的修复时应翻红 |

## ⑤ 真实语料

- 枚举 `~/.claude/projects/` 下所有路径含 `cc-plugin-market` 的项目目录（129 个 worktree 级目录），收集全部 `.jsonl` 文件，共 **383 份**（与 `impl-review-misblock.md` 记录的 383/386 同量级，语料自然增长属正常）。
- 用 OLD（`db8664e4`）与 NEW（HEAD）CLI 各跑一次 `--mode report`，比对 `tier`/`fixSession`/`transcriptDiagnostics`/`missing`/`compliant` 五个字段：**383 份中差异 = 0**，1 份因批量压测时系统负载导致单次 spawnSync 超时（文件本身 1.4MB，非判定器 bug，重试可过，不计入有效对比）。
- 全部 383 份中，NEW 代码判 `tier===2` 的文件数 = **0**——即本机全部真实历史会话里，Tier 2 续做合同至今未被真实触发过一次，与 `impl-review-misblock.md`"(a) 0 命中"的记录一致。
- **重要保留意见**：`--mode report` 是无状态的单次快照（不落盘、不经过 `routeBlock`/`routeByFingerprint`），其输出对象（`runReport` 构造的 `out`）**不包含** `blockFeedbackCount`/`storageUnavailableFeedbackCount` 字段——`corroborationAnchor` 只影响这两个字段的计算,而它们只在 `--mode hook` 的多次调用状态机里起作用。**因此"跑 report 模式做 A/B 对比"这一验证手段，结构上不可能观测到②描述的缺陷**，363 份零差异只能证明"verdict 本身没有跑偏"，不能作为"corroboration 机制没有回归"的证据——这也是②的缺陷能在本卡先前的 spec/impl 两轮异构对抗（均含真实语料环节）中未被发现的部分原因（另一部分原因是③④指出的"无重复活动构造"覆盖缺口）。真实、有效的验证手段是②采用的方式：`--mode hook` 多次真实调用 + 状态文件观测。

## ⑥ Over-claim 核实

### fix-report.md §7 "implement 阶段处置" 四行

| # | 原话 | 核实结果 |
|---|---|---|
| impl-C1（绕过面，跨目标佐证） | "跨目标续做时佐证窗口前移，Fix-B 须自付 2 次阻断；**单目标时 == primary，零行为变化**" | **发现反例**（见②）。跨目标那半句成立（E1 证实）；"单目标零行为变化"半句为 over-claim，仅在"目标全程单次绑定活动"的退化情形成立，不满足时会导致自伤性误阻断，最坏情形下永久不自愈 |
| impl-C1（误伤面，sidechain ambiguous） | "已改：… 与「光杆 mv」同走 F224 宽松通道（有 verify 委派 ⟹ exit 0…；无 ⟹ 走 ambiguous 硬判，与 (a) 对齐）" | 未找到反例——两条支路均按描述复现（见③） |
| impl-C2（绕过面，420 over-claim 收敛） | "该表述已随 impl-C1 修复收敛：佐证只认 harness 回灌反馈…合并态实测无 420 放行腿" | 未找到反例（未独立重跑 430-entry backstop 探针，但该结论建立在 F288 卡 B C-1 的既有删除上，非本轮新增代码，逻辑链核对一致） |
| impl-C2（误伤面，spec 归因 + C-2 覆盖） | "已改 spec §7 措辞 + 补 E3…" | 字面未 over-claim（没有声称"两处缺口都已补测试"，只声称补了 E3 且改了措辞）；但④证实**闸门三真实锚点**半边的回归覆盖缺口截至本轮仍未闭合，如实登记为遗留项而非本条声明的反例 |

### spec.md §7 "残余清单" 9 项逐条核实

| # | 原话摘要 | 核实结果 |
|---|---|---|
| 误阻断1 | 旧 fix 目录改 typo → witness 绑定 → 缺 verify 委派即阻断；代价"须补齐制品或吃 2 次 Stop 降级" | 未找到直接反例，但**与②存在未登记的关联/放大**：若"补齐制品"本身需要对 fix-report.md 做第二次、第三次编辑（现实中常见——一次补不全 Root Cause），"2 次 Stop 降级"的代价上界在②描述的条件下不成立（可能不封顶）。建议在该条下追加交叉引用 |
| 误阻断2 | 任何早锚在超长会话（≥420 entry）下都会耗尽闸门三预算，定性为 F257 有界化的"预期"而非缺陷 | 未找到反例；与②是不同机制（闸门三 in-flight 预算 vs 本卡佐证计数），未发现二者矛盾 |
| 边界3 | resume 到极早期 fix（无制品无提名）不绑定，定性为漏判非误判 | 未找到反例（未深入测试，字面判据清晰，风险方向明确是漏判） |
| 残余4 | sidechain 标记可 rm，无 transcript 侧对账兜底 | 未找到反例（未测试，非本轮改动范围） |
| 残余5 | (b) 只认 Write/Edit × fix-report.md，不认 verification-report.md / Bash | **独立核实为真**：`ANCHORED_ARTIFACT_PATH_REGEX = /^(specs\/\d+-fix-[a-z0-9-]+)\/fix-report\.md$/`（`fix-compliance-core.mjs:1059`）逐字只匹配 `fix-report.md`，`ARTIFACT_WRITER_TOOL_NAMES` 只含 `Write`/`Edit`（同文件:1029），与描述完全一致，非 over-claim |
| 残余6 | 拆会话逃 implement 委派已豁免；transcript 截断清零 | 未找到反例（未测试，非本轮改动范围） |
| 残余7 | (a) resume 383 份 0 命中；(c) sidechain 624 份仅 1 命中（父prompt引用诱饵，已被 isMeta 排除） | **前半独立复核为真**（本轮 383 份全量 report 扫描，tier2 命中数 = 0，见⑤）；**后半（624 份 sidechain 专用语料的 1 命中）本轮未独立重新枚举**（本轮的语料扫描用主 transcript 路径，未单独定位 sidechain 专用 transcript 文件集），沿用轮 2 结论，非本轮验证范围 |
| 残余8 | Tier2 放行地板 = 1 次 review 类委派；真实锚代替 -1 后会话前段无关 verify 不再串号 | 未找到反例（未测试，非本轮改动范围） |
| 残余9（本轮新增） | 跨目标"佐证"窗口已逐目标前移；"证据"窗口（verify 委派检出）仍用最早锚，故 Fix-B 若自身备齐全制品仍可能复用早锚内的 verify 委派 | 未找到反例——这是与②**方向相反、正交**的另一个真实残余（②是"佐证窗口前移过头、误伤同目标"；残余9 是"证据窗口完全不前移、可能被跨目标复用"），二者是同一改动在两个不同窗口上做了不同取舍的两种代价，均属实，不冲突 |

## ⑦ CRITICAL / WARNING / INFO

**CRITICAL（1）**

1. **corroborationAnchor 自伤性误阻断**：`corroborationAnchorLineIndex` 用"三源最晚活动行的最大值"代替按目标身份切分，导致同一目标内的合法重复活动（二次编辑 witness 制品 / 二次展开 resume）会不断前移佐证计数窗口下界，把窗口前的合法阻断反馈排除出计数。M2 实测：若用户按判定器自身提示持续编辑响应每次阻断（最自然的合规行为），release valve **连续 8 轮验证未曾触发**，而同操作序列在改动前的代码上第 3 轮即正常自愈——方向是永久性 fail-closed，与"Stop hook 不可 brick 会话"的护栏不变量冲突,且直接证伪 fix-report.md 自身"单目标时零行为变化"的声明。(a)/(b) 两源均可复现，`routeBlock`/`routeByFingerprint` 两条路由路径均受影响。真实语料尚无正例（功能未上线触发），是潜伏缺陷。

**WARNING（2）**

1. **回归覆盖缺口，且正是①/②缺陷的成因**：23 个新/既有测试中，没有任何一条构造"同一目标内两次witness写入"或"同一目次目标内两次resume展开"的场景，导致 CRITICAL-1 描述的缺陷得以在两轮异构对抗 + 本次 implement 合并之间完全未被察觉。建议至少补 2 条自愈钉子（单目标二次witness / 二次resume，中间插入阻断反馈，断言"第 3 次即放行"）。
2. **`impl-review-misblock.md` CRITICAL-2 的"闸门三真实锚点"半边回归覆盖仍未闭合**：本轮只补了 E3（账本 sinceTs 半边），Tier2 `effective.earliestFixLineIndex`/`latestFixLineIndex` 真实锚点这一半（in-flight 推迟 / 委派窗口）撤回为 -1 后，23 个测试仍全绿。fix-report 已将其对应的行为定性为"F257 有界化的预期"（改了 spec 措辞，非声称已补测试），故不构成 over-claim，但作为可被静默回退而不被发现的代码路径，建议登记跟进。

**INFO（1）**

1. `--mode report` 结构上无法观测 `blockFeedbackCount`/`storageUnavailableFeedbackCount`，因此"真实语料 report 模式零差异"这类验证手段对 corroboration 机制的回归**完全没有检测力**——如果未来还想用语料回归防线来保护这部分逻辑，需要改用 `--mode hook` 多次调用 + 状态文件观测（本报告②采用的方式），单纯扩大 report 模式语料量并不会提高这部分代码的保护水平。

## 没构造出来 / 超出本轮范围的清单

- 未独立重新枚举真实 sidechain（624 份）专用语料核实"1 命中"这一数字，沿用轮 2 结论。
- 未重新验证 F224 sidechain ambiguous:true 扩大适用面之后，是否给"绕过面"审查引入新的可讨论面（例如故意不提名、只挂一个 verify 描述性子代理即可换 exit 0 的门槛是否因本次改动而降低）——该角度按分工属另一位审查者（绕过面）的范围,本报告只在③确认了误伤面自身未见回归。
- 未重新验证 SC-004/SC-006 及其余非本轮改动的验收标准。

---

**三档计数：CRITICAL 1 / WARNING 2 / INFO 1**

**一行结论**：sidechain `ambiguous:true` 修复本身干净（未发现新误伤，两条支路行为与 fix-report 描述一致）；但 `corroborationAnchor`（三源最晚活动行取最大值）的实现把"防跨目标复用"和"同目标合法重复活动"混为一谈，构成一个可复现、方向为永久 fail-closed 的 CRITICAL 级自伤缺陷，直接证伪了 fix-report §7 "单目标时零行为变化"的声明，且现有 23 项测试对此路径零覆盖——建议合入前修复（方向：佐证窗口的"前移"应以目标/候选目录是否变化为条件，而非单纯取时间上最晚的同类活动），并补齐对应的回归钉子。
