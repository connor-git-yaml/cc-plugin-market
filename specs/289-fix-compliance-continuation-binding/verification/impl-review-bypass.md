# F289 implement 阶段异构对抗审查（切入角：绕过面 / fail-open 面 / 与 F270/F287/F288 判定器链的合同接缝）

> 审查基线：HEAD `587a0fe2`（已按 spec 阶段对抗复审修过一轮）。全部构造在 scratchpad 临时项目上实跑
> （`--mode hook` / `--mode report`，`--project-root` 指到 `/private/tmp/.../scratchpad/adv-f289-impl-a/*`），
> 未 `git stash` / `checkout <path>` / `add` / commit，未改动 worktree 任何文件。

## ① 亲跑

- `node --test plugins/spec-driver/tests/fix-compliance-tier2-continuation.test.mjs`（worktree 原文件，未改动）：**20/20 pass, 0 fail**。
  - 注：fix-report §3 声称新增套件"(16)"个用例，实际当前文件是 **20** 个（spec 阶段对抗复审追加的 A4/A5/C4/C5 未回填计数）——纯计数口径过期，非功能问题，登记为 INFO-1。
- `node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`：227 tests，**225 pass / 0 fail / 2 skipped**（与 fix-report"judge-cli 全量零翻转"一致）。
- `node --test plugins/spec-driver/tests/fix-compliance-card-a-diagnostics.test.mjs`：**20/20 pass**（与 fix-report"card-a 20"一致）。
- `node --test plugins/spec-driver/tests/fix-compliance-card-b-lock-fingerprint.test.mjs`：**26/26 pass**（fix-report 写"card-b 22"，实际 26——同一类计数口径过期，登记为 INFO-1 的第二例）。
- `node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs`：604/604 pass（用于后续变异测试的宽覆盖面对照）。

零失败层面的"零翻转"结论成立；但下面 ② 的构造证明"零失败"不等于"无绕过"——本次审查的核心发现正是**测试全绿状态下真实存在的一条 0 往返绕过链**。

## ② 绕过构造表（全部为 Bash 实跑，非纸面推演）

| # | 构造 | 预期（fix-report/spec 的隐含承诺） | 实测 exit code | 结论 |
|---|---|---|---|---|
| 1 | **跨目标阻断预算复用**（核心发现，见下方详述）：同会话内 Fix-A（resume 绑定，缺 verify 委派）连续 2 次真实 exit 2 → 第 3 次合规按设计降级放行（GATE-DEGRADED，预期内）；会话继续做无关工作；之后**全新**、零制品、零委派的 Fix-B（witness 绑定）**首次**被评估 | Fix-B 应至少经历 2 次真实 exit 2 才能降级放行（与 Tier 1 同构） | **stop#1..3(Fix-A)=2,2,0（预期）；stop#4(Fix-B 首次评估)=0** | **CRITICAL-1**：Fix-B 零真实阻断即被放行 |
| 2 | 同上，(a) resume 换成纯 (b) witness 绑定（无 resume，Fix-A/Fix-B 均只用 Write 见证触发） | 同上 | stop#1..3(Fix-A)=2,2,0；**stop#4(Fix-B 首次评估)=0** | 复现，证明与 resume 无关，witness 单源即可触发 |
| 3 | 同构造 1，但每次 payload 带不同 `prompt_id`（真实 harness 更贴近的形状，走 `routeByFingerprint` 而非 `routeBlock`） | 指纹路由不应改变上述结论（若改变，说明漏洞只存在于非典型路径，严重性降级） | Fix-A 序列 2,2,2（指纹路由首次落 nonblock 分支不计 blockCount，多一轮）；**Fix-B 首次评估 = 0**，stderr 显示 `[GATE-DEGRADED] 已达阻断上限(2 次)` | 指纹路由下同样成立，且更贴近生产 payload 形状，**严重性不降级** |
| 4 | **对照组**：Fix-A 走向**真正合规**（补齐 verify 委派 + verification-report.md）而非降级耗尽，再接 Fix-B | 预期 `resetBlockState` 清零，Fix-B 应正常需要 2 次真实阻断 | 未能在预算内构造出"真正 compliant"（多次尝试 Root Cause 内容 / Agent 委派描述仍被判 `artifact:placeholder` 或委派未识别），Fix-B 仍返回 0 | **未完全证实**（见 ⑥）；但代码读证实 `resetBlockState` 只在 `runHook` 的 `verdict.compliant===true` 分支调用，`release`/`nonblockRelease` 分支从不重置 `blockCount`——对照组的理论支撑来自代码结构而非本条实测 |
| 5 | Tier 1 对照（真实 `/spec-driver:spec-driver-fix` 展开）：Fix-A′ 降级耗尽后，会话内**新展开一次** `spec-driver-fix` 做 Fix-B′（全新目录零制品） | 无先验（用于判断该问题是否 Tier 2 特有） | Fix-A′ 序列 2,2,0；**Fix-B′ 首次评估 = 2**（正常阻断，非绕过） | **确认根因是 Tier 2 特有**：Tier 1 的 `latestFixLineIndex` 随新展开前移，天然排除旧 feedback；Tier 2 的 primary 锚点钉在"会话内最早真实行"、不随新目标前移 |
| 6 | `hasNomination` 谓词边界：witness 命中时 `dirs.length===1` 恒真分支覆盖是否有 `path===null && ambiguous===false && candidates.length>0` 的不可达组合 | 若可达，可能绕过下游 missing 判定 | 代码读证实 `resolveFeatureDirCandidate` 状态机中该组合不可达（`candidates` 非空必然经过一次合法非 ambiguous 赋值，而 `path===null` 只出现在初始态或 ambiguous 态） | 未找到反例，判据边界自洽 |
| 7 | `isFix` 存在性优先是否真的支配 Tier1/Tier2 互斥（同会话既有真 fix 展开又有 resume/witness，能否让 Tier2 更宽松的豁免"抢滩"Tier1 判定） | 若可被抢滩，delegation:implement 豁免可能被滥用到 Tier1 会话 | 代码结构确认 `tier2 = ... if (!isFix) {...}`，Tier2 分支在 `isFix===true` 时结构性不可达；`isFix` 由正则存在性客观判定，不受 resume/witness 干扰 | 未找到反例 |
| 8 | 项目闸能否被绕（`.specify` 软链）：受害目录本身没有 `.specify`，但放一个指向真 spec-driver 项目 `.specify` 的符号链接 | `isSpecDriverProject` 若跟随软链，闸门可被"借壳"通过 | `isSpecDriverProject(victim)` 返回 **true**（`fs.readdirSync` 跟随符号链接） | 确认可被借壳通过，但后续 `fs.mkdirSync(path.join(projectRoot,'.specify','runs',...))` 会**沿同一符号链接**落回真项目的 `.specify/runs/`，不会在受害目录本地生成新 `.specify/`——实际后果是"写去了别处"而非"在本地无关项目凭空建目录"，与 A-C4 要防的"本地凭空建 .specify"形态不同源，判 **INFO-2**（需用户手工放置该符号链接才能触发，非外部输入可控） |
| 9 | `isMeta` 伪造：子代理若能用 Bash/Write 直接编辑自己的 `agent_transcript_path` 文件，手写一条 `isMeta:true` 的展开痕迹 | 若可行，父 prompt 引用诱饵可被逆向利用为"主动伪造真展开" | **未构造**：需要真实拉起一个 `isolation` 子代理并在其存活期间竞态写自己的 transcript 文件，超出本次可控的 CLI 级实验范围 | 见 ⑥，判据依赖"transcript 由 harness 独占写入"这一**未在本卡验证的**既有假设（Tier 1 对 user-role 文本块的同一假设也未被本卡引入新突破口，非回归） |

### 核心发现详述（CRITICAL-1）：Tier 2 primary 锚点"钉死最早真实行"与 F288 `state.blockCount` 跨目标不重置的组合，产生 0 往返绕过

**根因链**：

1. `detectTier2Binding`（`fix-compliance-judge.mjs:309-350`）对 (a) resume 用 `earliestResumeLineIndex`、对 (b) witness 用 `collectArtifactWriteWitnesses(entries,-1,projectRoot)[0]`（会话内**最早**一条），primary 取"有真实行号的源里最早那个"——这是 spec §4/FR-002/FR-003 对 C-1（防"尾部重展开解绑"）的**正确**修复，但代价是：**该锚点一旦确立，此后同会话内任何新的、不同目标的 Tier2 续做，锚点都不会前移**（与 Tier 1 的 `latestFixLineIndex` 随每次新展开前移形成结构性不对称，见构造 5 的对照实测）。
2. `effective.latestFixLineIndex`（Tier2 下 = `tier2.anchorLineIndex`，见 `evaluate()` 约 440 行）被 `countBlockFeedbackEntries` / `countStorageUnavailableBlockFeedback` 直接当窗口下界使用——这两个计数器**只按内容前缀匹配**（`text.startsWith('Stop hook feedback:')` 且 `includes('[FIX-COMPLIANCE]')`），**不核对该反馈来自哪个特性目录**。
3. F288 卡 B 的 `state.blockCount`（`.specify/runs/.fix-compliance-state/<sessionId>.json`）**按 sessionId 持久化，不按目标目录区分**；`resetBlockState` 只在 `runHook` 的 `result.verdict.compliant===true` 分支调用（`fix-compliance-judge.mjs` 约 1370 行）——**降级放行（`release`/`nonblockRelease`）不会重置它**（`mutateBlockState` 的 'release' 分支只置 `degradedRecorded:true`，`blockCount` 原样保留，见 `fix-compliance-judge.mjs:905-916`）。
4. 三者组合：Fix-A（任意 Tier2 目标）合法耗尽 2 次真实阻断并降级放行后，`state.blockCount` 永久停在 2（直到该会话某次评估真正 compliant）。此后**同会话任何新的 Tier2 目标**，只要 `blockFeedbackCount`（沿用 1 的钉死锚点计算，天然把 Fix-A 的历史反馈计入）或 `entryCount`（`assistantEntriesSinceEarliestFix`，同一钉死锚点，长会话下天然 ≥420）满足 `releaseCorroborated`，**第一次评估就直接落 `release` 路由——0 次真实阻断**。
5. 已用 3 组独立实跑证实（见 ②-1/2/3），且用构造 5 证明 **Tier 1 不受影响**（因其锚点前移）。

**与 fix-report 的接缝**：fix-report §7 "C-2 单锚点坍缩"处置声称"420 backstop 已在 F288 卡 B C-1 关闭为「只作 nonBlock 跑道耗尽触发、不作放行腿」，故 Tier 2 不再有「line 0 起 420 ⇒ 零往返放行」"——**该表述只在 `state.blockCount===0`（会话从未真实阻断过）时成立**；一旦 `state.blockCount` 因任何历史目标（哪怕已合法降级放行）到达 2，`releaseCorroborated` 里 `entryCount>=NON_BLOCK_ENTRY_LIMIT(420)` 这条 OR 分支**依然是一条完整的放行腿**，且其 `entryCount` 锚点与本发现同源、同样钉死。fix-report 的表述范围比代码实际保证的范围**更宽**，构成一处 over-claim（不是"420 已彻底不是放行腿"，而是"420 单独从 blockCount=0 起不是放行腿"）。

## ③ 合同接缝对账

| 接缝 | 检查内容 | 结论 |
|---|---|---|
| Tier2 → F288 `routeByFingerprint`/`releaseCorroborated` | 有效锚点是否方向正确（narrow=fail-closed 侧未搭反） | **方向搭反**：`releaseCorroborated`/`routeBlock`/`routeByFingerprint` 均假定"能触发 release 的 corroboration 只可能来自**当前**这次续做自己产生的真实反馈"，Tier2 的钉死锚点打破了这个假设的前置条件（锚点不随新目标前移）——见 CRITICAL-1。`routeBlock` 与 `routeByFingerprint` 两条路径**都**受影响（②-1 用无 `prompt_id` payload 走 `routeBlock`，②-3 用带 `prompt_id` payload 走 `routeByFingerprint`，结论一致）。 |
| `judgeCompliance({tier2})` 剔除范围 | 是否只剔 `delegation:implement`，`DEFERRABLE_MISSING_KEYS` 是否不变 | **符合声明**：读 `fix-compliance-core.mjs:893-898` 确认 `DEFERRABLE_MISSING_KEYS` 未改动（仍是 4 项，`delegation:implement` 在列但 Tier2 下该键永不出现在 `missing` 里，故不影响 `isDeferrableMissingSet` 的判定面）；U2 单元测试（baseline 20/20 之一）直接断言 verify-only 委派下 tier2:true→`missing:[]`、tier2:false→`missing:['delegation:implement']`，运行结果与断言一致。**未找到反例**。 |
| F240 基线五列零翻转 | judge-cli 全量 / card-a / card-b 是否真零失败 | 三套件分别 225/0（2 skip）、20/0、26/0——**零失败层面属实**；但如①所述，fix-report 引用的 card-b 计数（22）与当前实际（26）不一致，纯计数口径问题，不影响"零翻转"本身的真实性 |
| isFix 是否真支配 Tier1/Tier2 互斥 | Tier2 能否抢滩已有真实 fix 展开的会话 | 结构性不可达（②-7），**未找到反例** |
| SubagentStop projectRoot 同源前提（K-5，spec 已自登记） | `hooks/subagent-stop-fix-marker.sh` 是否真的用触发时的 `$(pwd)` | 读源码确认 `cat \| node "$CLI" --project-root "$(pwd)"` 逐字使用调用时 cwd——**证实 K-5 的机制描述准确**（worktree 隔离的子代理其 cwd 大概率不同于父会话 project-root，标记会落到另一棵 `.specify/`），本次未新增发现，只是核实自登记残余不是纸面猜测 |

## ④ 变异表（每处单独变异、单独还原，跑 `tests/fix-compliance-tier2-continuation.test.mjs` 20 例 + 附带跑 `fix-compliance-core.test.mjs` 604 例；全部在 scratchpad 的仓库副本上操作，未碰 worktree）

| 变异 | 结果 | 抓到的用例 | 结论 |
|---|---|---|---|
| M-a `hasNomination` 恒返回 `true` | 18 pass / **2 fail** | A2（resume 无提名应零判定）、C1（sidechain 提名判定） | 有守护 |
| M-b (a) 绑定改用 `latestResumeLineIndex`（回退到"最晚"，复现 C-1 原始漏洞） | 19 pass / **1 fail** | A4（尾部重展开不解绑的回归钉） | 有守护 |
| M-c `fix-compliance-sidechain-marker.mjs` 去掉 `{requireMeta:true}` | 19 pass / **1 fail** | C5（父 prompt 引用诱饵不应被认作真展开） | 有守护 |
| M-d `recordSidechainFixMarker` 去掉项目闸 `isSpecDriverProject` 检查 | 19 pass / **1 fail** | C4（非 spec-driver 项目零落盘） | 有守护 |
| M-e primary 选择改成"有真实行号的源里最晚那个"（而非最早） | 19 pass / **1 fail** | A5——但**红的原因是候选 ambiguous 判定被绕开（副作用），不是因为有测试直接断言"corroboration 窗口不能被放宽"** | 表面有守护，但未覆盖本次 CRITICAL-1 的真正机理 |
| M-f (b) witness 绑定锚点由"首条真实行"改回 `-1` | **20 pass / 0 fail（全绿）** | 无 | **守护缺席**：C-2 对 (b) 源的核心修复（"不得用 -1"）没有任何用例断言窗口起点的具体行号/时间戳，只断言"是否绑定"与 missing 内容，回归会被现有测试集完全放过 |
| M-g `collectArtifactWriteWitnesses` 第二趟遍历顺序反转（`witnesses[0]` 从"最早"变"最晚"） | **20 pass / 0 fail（全绿）**；`fix-compliance-core.test.mjs` 604/604 也全绿 | 无 | **守护缺席**：全仓（含 core 604 例宽覆盖）都没有断言 witness 列表的排序方向，`collectArtifactWriteWitnessDirs`（judge 侧另一处消费点）用 `Set` 去重也天然抹掉顺序信息 |

M-f、M-g 两处"全绿"直接对应 CRITICAL-1 的根因组件（primary 锚点的真实行号来源），**说明本次发现的漏洞类别在提交时的测试矩阵里结构性不可能被抓到**——不是测试运气不好，是没有任何用例在"窗口起点的具体值"这个维度上做过断言。

## ⑤ 三档计数

- **CRITICAL：2**
  1. 跨目标阻断预算复用 → Tier 2 续做合同可被 0 真实阻断往返绕过（②-1/2/3，根因见②详述，实测 3 次独立复现，含更贴近生产的指纹路由路径）。
  2. fix-report §7 对"420 backstop 已关闭为非放行腿"的表述范围超出代码实际保证（③"Tier2→F288"行），该 over-claim 与 CRITICAL-1 共享根因，修复 1 大概率一并修复 2，但作为独立的"文档/代码不一致"问题单独登记。
- **WARNING：2**
  1. M-f 变异（witness 锚点回退 -1）测试全绿——C-2 对 (b) 源的核心不变量无回归测试保护。
  2. M-g 变异（witness 列表排序反转）测试全绿（含 core.test.mjs 604 例）——同上，(b) 源排序前提无回归测试保护。
- **INFO：3**
  1. fix-report §3/§6 测试计数口径过期（"16"实际 20；"card-b 22"实际 26），纯文档精度问题。
  2. `.specify` 软链可让 `isSpecDriverProject` 对借壳目录返回 true，但写入会沿软链落回真项目而非在受害目录本地建目录，实际影响面与 A-C4 要防的形态不同源，且需用户本地手工放置软链才能触发。
  3. K-5（SubagentStop 与主 Stop 的 projectRoot 同源前提在 worktree 隔离下未证）——本次核实 `hooks/subagent-stop-fix-marker.sh` 确实用触发时 `$(pwd)`，机制与 spec 自登记描述一致，非新发现。

## ⑥ 没构造出来的清单（≠安全，只是本次预算内未达成）

- **isMeta 伪造**：未真实拉起一个 `isolation:worktree`（或任意）子代理并在其存活期间对自己的 `agent_transcript_path` 做竞态写入，验证能否手工注入 `isMeta:true` 的虚假展开行。本次只确认了"harness 会为系统级伪 user 消息（如 `<local-command-caveat>`、`Continue from where you left off.`）标 `isMeta:true`"这一事实（抽样自 `~/.claude/projects/**/*.jsonl` 真实语料），未证明/证伪子代理自身是否具备篡改该字段的手段。
- **对照组"真正 compliant 后 reset 生效、Fix-B 恢复正常 2 次阻断"**：多次尝试构造 Fix-A 的完全合规态（含 `Root Cause` 正文、`verification-report.md`、`Agent(subagent_type:'spec-driver:verify')` 委派）均仍被判 `artifact:placeholder` 或委派未生效，预算内未定位到具体是占位符探测的哪个子判据卡住。该对照组的"resetBlockState 只在 compliant 分支触发"结论目前**只有代码读证据**，未获得端到端实跑的正向对照（即"reset 生效后 Fix-B 确实需要 2 次真实阻断"未被亲眼验证，只是从代码结构推断其必然成立）。
- **420 entryCount 独立触发**（不依赖任何 `[FIX-COMPLIANCE]` 历史反馈文本，纯靠会话长度）：未单独用调小 `NON_BLOCK_ENTRY_LIMIT` 的方式做隔离实验证明"哪怕 blockFeedbackCount 恒 0，entryCount 单独也能放行"；③/CRITICAL-1 详述中的相关论断基于代码读（`releaseCorroborated` 的 OR 结构 + 两个计数器共享同一锚点）而非独立实跑。
- **F288 6b"状态文件不可伪造性"在 Tier2 下的其余绕过面**（如 `lastCountedFingerprint` 预置、`degradedRecorded` 预置）：本次只验证了"合法路径产生的持久态被跨目标复用"这一种途径，未系统性重跑 F288 卡 B 自己那批红队构造（软链 `ln -s /`、`stop_hook_active` 重入等）在 Tier2 场景下是否有新变种。

## 结论

写到：`specs/289-fix-compliance-continuation-binding/verification/impl-review-bypass.md`。CRITICAL 2 / WARNING 2 / INFO 3。**一句话结论：Tier 2 为修复 C-1（防尾部重展开解绑）而把 primary 锚点钉死在"会话内最早真实事件行"且不随新目标前移，与 F288「`state.blockCount` 按 session 持久、只在真正 compliant 时重置」的既有设计组合后，产生一条实测可复现的 0 真实阻断往返即放行的绕过链（对同会话内任意后续、无关的 Tier 2 续做目标生效），且现有测试矩阵在"锚点具体行号/witness 排序"这一维度上完全没有断言，回归和当前漏洞都不会被抓到——建议在合入前修复（可选方向：release/nonblockRelease 时也重置 blockCount，或改为按目标目录而非纯 sessionId 做持久化 key，或干脆让 Tier2 的 blockFeedbackCount/entryCount 窗口改用调用方"本次候选目录首次出现"而非"会话级 primary"）。**
