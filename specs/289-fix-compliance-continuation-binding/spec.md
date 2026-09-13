# F289 · fix-compliance 续做 / 旁链入口收口（Tier 2 续做合同）

> 模式：spec-driver fix（门禁 / 判定器类：异构对抗常设档位，spec 与 implement 两阶段各 ≥2 切入角；Codex 审查暂停，异构档位缺席）。
> 来源：`docs/design/fix-compliance-continuation-binding-design.md`（2026-08-31 用户四轮拍板定稿，parked）。入口硬条件已满足：F270 已合入 master（8617ae3e），isFix 为存在性判据（`anchor.earliestFixLineIndex !== null`）；本卡串行于 F287（卡 A）/ F288（卡 B）之后，以 F288 后的路由链为基线。
> 基线：origin/master `b9a4aa92`（F288 合入后 rebase）。

## 1. 问题（改动前事实，已核实）

判定器（Stop hook）只认**当前会话主 transcript** 内 `spec-driver-fix` 的 skill 展开痕迹（`SKILL_EXPANSION_REGEX`，`detectFixSkillExpansion` 只为 `fix` 记基线；`resume` 被同一正则捕获但不消费）。三类 fix 流程零接触放行：

1. **resume 入口**：`/spec-driver:spec-driver-resume` 承接中断的 fix 流程，transcript 只有 `skills/spec-driver-resume` 展开。
2. **sidechain**：fix 展开发生在子代理 sidechain，主 transcript 结构性不可见。
3. **跨会话续做**：新会话续做 fix，无任何展开。

F270 已在 isFix 判据注释登记为能力边界并分流到本卡。

## 2. 用户故事

- US1 resume 续做 fix 的用户：收尾会话缺 verify 委派或制品占位时被按 Tier 2 合同阻断（最多 2 次后降级），补齐即放行。
- US2 跨会话裸续做（新会话直接编辑 `specs/NNN-fix-*/fix-report.md` / `verification-report.md`）：同 US1。
- US3 fix 展开在子代理 sidechain 里发生：主 Stop 仍能按 Tier 2 执法。
- US4 feature / story 的 resume、只 `cat` 提及 fix 制品的会话、非 fix 会话：**零误阻断、零落盘**（现状不变）。
- US5 Codex / 异构 harness：新增 hook 静默不动作；Tier 1 行为逐字不变。

## 3. 判定架构（两级证据 → 两级合同；设计 §3 原样承接）

| 级 | 绑定证据 | 合同 |
|---|---|---|
| Tier 1（现状） | 主 transcript 曾出现 `spec-driver-fix` 展开 | path A / path B 全套，**逐字不变** |
| Tier 2（新增） | 无 fix 展开，命中任一二级证据源（§4） | **磁盘制品齐全非占位**（fix-report Root Cause 节 + `verification/verification-report.md` 非空；no-op 走 path B 原样）+ **本会话 ≥1 次 verify 类委派**；implement 委派**不要求** |

不变量：两级互斥取严（有展开走 Tier 1，无展开才评估 Tier 2）；`isFix` 判据本身不动；F270/F287/F288 的锚点 / 闸门 / 预算 / 指纹 / 佐证语义零改动——Tier 2 不合规**复用同一条路由链**（`routeBlockEnforcement`：block 档指纹三分 + 放行佐证；warn 恒 0；off 零接触）。

## 4. 三条二级证据源与判定窗口锚点（必答项，spec 层定死；spec 阶段异构对抗 C-1~C-4 后重定）

**关键修正（对抗复审 C-2）**：判定窗口锚点必须是**真实绑定事件行**，绝不用会话起点 -1。原设计把「证据窗口锚点」坍缩成一个并对 (b)/(c) 喂 -1，会让闸门三从 line 0 计数（长会话 in-flight verify 无法推迟 = 误阻断）、账本 sinceTs=null（补充恒空 = 误阻断）、佐证窗口跨到会话前段（数进无关阻断反馈 = 误放行）。

| 源 | 检出 | 判定窗口锚点（真实绑定事件行） | 不绑定的形态（对照组） |
|---|---|---|---|
| (a) resume | mode 捕获 = resume，取**最早**一次 resume 展开行（对抗复审 C-1：用最晚会被尾部再展开一次 resume 零往返解绑） | 最早 resume 展开行 lineIndex + timestamp | resume 无 fix-dir **提名事件**（feature / story 续做；只读 / cat 提及） |
| (b) 裸会话写入见证 | `collectArtifactWriteWitnesses`（**仅** Write / Edit 写 `specs/NNN-fix-*/fix-report.md` + 成功回执；对抗复审 C-3：**不含** verification-report.md、**不含** Bash——扩任一即复活 F257 第 3 轮红队绕过） | **首条**见证写入行 lineIndex + timestamp | 只读 / cat / 提及；写 fix 目录下其他文件；只写 verification-report / heredoc / cp 写制品（登记为残余，见 §7） |
| (c) sidechain 标记 | 主 Stop 读到**本会话**标记（SubagentStop hook 写；子代理 transcript 内 fix 展开且 **`isMeta === true`**——对抗复审 C-1：sidechain 首条 user 文本 = 父编排器 prompt 引用 isMeta=false，不算子代理真展开） | 若同时有 (b) 见证：取首条见证行；否则回落会话起点（残余，见 §7） | 标记 session_id ≠ 本会话；标记缺席；父 prompt 引用展开字面（isMeta=false）；**main 与标记 candidatePath 双空（无处定位 fix 目录）⟹ 不绑定**（与 (a) resume 无提名对称，delta 双角收敛：非硬阻断亦非 F224 免费通行） |

**提名事件谓词（对抗复审 C-2）**：「有提名」= 合法候选 ∨ ambiguous ∨ 候选历史非空（提名**事件**存在），不是 `candidate.path !== null`——否则一条光杆 mv 到非规范名即 path=null、按无提名零判定，在 Tier 2 上重开 F224 收窄的绕过面。绑定后 ambiguous 逐字沿用 Tier 1（missing: feature-dir）。

**primary 锚点**：多源命中取**有真实行号的源里最早那个**（证据窗口够宽 + 排除绑定前的反馈）；仅 sidechain 命中且无见证行时才回落 -1（残余）。codes 保留全部命中源。

## 5. 功能需求

- **FR-001 两级互斥**：`evaluate` 在 isFix === false 分支新增 Tier 2；Tier 1 逐字不变（judge-cli 全量 + card-a / card-b 零翻转）。**Tier 2 各消费点基线 = primary 绑定事件行，不是 -1**（C-2：不再宣称"锚点/闸门/预算/佐证语义零改动"——Tier 1 零改动，Tier 2 各窗口按真实锚点）。
- **FR-002 (a) resume 绑定**：`detectFixSkillExpansion` 同趟增记 earliestResumeLineIndex / earliestResumeTimestamp（F257 单趟）；以**最早** resume 行为锚跑 `resolveFeatureDirCandidate`；**提名事件存在**（谓词见 §4）⟹ Tier 2，否则零判定。
- **FR-003 (b) 写入见证绑定**：无展开时跑 `collectArtifactWriteWitnesses`（有序，行号 + timestamp）；非空 ⟹ Tier 2，锚 = 首条见证行；提名 = 见证目录（单）/ ambiguous（多，走 F224）。**合同以 `collectArtifactWriteWitnessDirs` 现实现为准**：Write/Edit × fix-report.md × 成功回执——不扩 verification-report、不扩 Bash（C-3；扩宽复活 F257）。
- **FR-004 (c) SubagentStop 检测 hook**：薄壳 `hooks/subagent-stop-fix-marker.sh`（恒 exit 0 零输出）→ `lib/fix-compliance-sidechain-marker.mjs`：**① 项目闸**（对抗复审 C-4：复用 ledger-writer 的 `isSpecDriverProject`，置于任何 selfdiag / marker 写**之前**——否则每个子代理停止都在非 spec-driver 项目凭空建 .specify/，同 F270 采集器 CRITICAL-2）；② 形状守卫（session_id / agent_transcript_path 非空，agent_id 缺席按空串）；③ 读 agent_transcript_path（≤ MAX_TRANSCRIPT_BYTES）**单趟** `detectFixSkillExpansion(entries, { requireMeta: true })`（C-1：只认 isMeta===true）；命中 ⟹ 写标记 `<sid>.sidechain.<agent>.json`（{ sessionId, agentId, agentType, fixLineIndex, candidatePath, recordedAt }）；失败走自诊断（同 ledger-writer FR-005）。**不做在途判定**（T-2）。
- **FR-005 (c) 执法**：主 Stop 在 Tier 1 缺席时枚举本会话标记；存在 ⟹ Tier 2。标记只读不删；resetBlockState 不删标记（fail-closed）。
- **FR-006 Tier 2 合同判定**：复用 `judgeCompliance` path A 剔除 delegation:implement（豁免；DEFERRABLE_MISSING_KEYS / no-op path B 不动）；delegation:verify 由**绑定锚点起**的 transcript 委派 ∪ 账本补充（sinceTs = primary 锚 timestamp；-1 回落时 ledger-window-undetermined）满足；制品占位判据沿用。
- **FR-007 路由复用**：Tier 2 不合规 ⟹ 同一 `routeBlockEnforcement`。**佐证 / 指纹 / 闸门三窗口从 primary 绑定锚点计量**（非 -1）；F288 卡 B C-1 已把 420 backstop 关闭为「只作 nonBlock 跑道耗尽触发、非放行腿」，故 Tier 2 无「line 0 起 420 ⇒ 零往返放行」——放行仍须 harness 回灌反馈 ≥ BLOCK_LIMIT。
- **FR-008 可观测性**：审计事件新增 tier: 1|2（fail-open 事件 null）+ 绑定码 tier2-bound-{resume,witness,sidechain}（userFacing:false，进 JUDGE 表 + schema enum）；--mode report 输出 tier / tier2Source。stderr 沿用 buildFeedbackText（missing 枚举不新增）。
- **FR-009 hooks 分发合同**：hooks.json 注册 SubagentStop；新脚本登记为 **Claude 独有**（CLAUDE_ONLY_HOOK_SCRIPT_SUFFIXES）而**不进** OWNED_HOOK_EXPECTED_EVENT——本卡不做 Codex 侧 SubagentStop 适配（FR-012），generator 按 Claude 独有过滤、不分发；OWNED 表仍 6 条；判定器不 import 新 lib，JUDGE_FILE_SET 不变。
- **FR-010 诚实登记**：残余（§7）写进 judge JSDoc + CLI 合同文档新节，措辞不得写成"闭合"。
- **FR-011 性能**：SubagentStop 扫描单趟、≤20MB；结构钉（函数体内 detectFixSkillExpansion( 恰一次）+ 绝对预算（in-process ≤ 10ms @ 真实 p99；薄壳端到端受 node 启动主导）+ 本机真实 sidechain 分位数写进验证报告。
- **FR-012 Codex 面**：新 hook **不分发**到 Codex；**Codex 是否触发 SubagentStop 及 payload 形状本卡未实测**（探针只采到 Claude 样本，违反 F264「harness 字段行为须本机实测」纪律故如实标未测）——防线 = hook_event_name==='SubagentStop' 等值 + 项目闸 + 形状守卫；即便被第三方手工挂到 Codex，无 agent_transcript_path 即静默零落盘。

## 6. 验收（SC，机械可验）

- SC-001 三源 × {放行 / 阻断 / 自愈} ≥ 9 条端到端 + 反例夹具：尾部重展开 resume 不解绑（A-C1）/ 光杆 mv 仍绑定走 F224（A-C2）/ 非 spec-driver 项目零落盘（A-C4）/ 父 prompt 引用（isMeta=false）不检出（B-C1）。
- SC-002 对照组零翻转：feature-resume 不绑定；cat 提及不绑定；写 spec.md / 只写 verification-report / heredoc 不绑定；非 Claude payload 零落盘；judge-cli 全量 + card-a + card-b 零翻转（F240 基线五列逐字不变）。
- SC-003 SubagentStop 薄壳恒 exit 0 零输出（CLI 缺失 / node 缺失 / 抛错 / 超限 / 方言 payload / 非 spec-driver 项目）。
- SC-004 hooks 分发守卫：OWNED 表 6 条、Claude 独有表含新脚本；codex-hooks 五套 vitest 零翻转；validate-codex-hooks --canonical-source pass；Claude 独有表条目所挂事件核对（新脚本挂 SubagentStop，登记为不适配 Codex 的显式例外）。
- SC-005 单趟结构钉（detectFixSkillExpansion( 函数体内恰一次）+ 绝对预算：**N=624 全量真实 sidechain 语料 in-process p99=4.19ms / JIT 稳态 max=4.79ms / 冷启动 max≈6.58–6.83ms（verify 实测）**（≪ 10ms），验证报告固定写全量 N 与分位数（非抽样片段——impl 误伤面实测抽样可低估尾部 >2×）。
- SC-006 异构对抗：spec 阶段 ×2 角（已完成，C-1~C-4 + W 已处置）+ implement 阶段 ×2 角，CRITICAL 清零、WARNING 逐条处置或登记；verify 子代理复核 PASS。

## 7. 新增误阻断类与残余绕过面（如实清单）

- **误阻断 1**：旧 fix 制品顺手编辑 fix-report.md typo ⟹ (b) 绑定 ⟹ 缺 verify 委派 ⟹ 阻断。代价按真实分布**不止「1 次廉价 verify」**——master 历史 fix 目录约 1/4 缺 verification-report、少量缺 Root Cause 标题（对抗复审 W-6），被绑定后须补齐制品或吃 2 次 Stop 降级。
- **误阻断 2（对抗复审 spec-C-2 + impl 误伤面 C-2 修订）**：**任何早锚**（真实绑定行或 -1 回落）在超长会话（≥420 assistant entry）下都会耗尽闸门三预算 ⟹ 合法 in-flight verify 无法推迟、落回阻断（fail-closed、2 次自愈）——这是 F257 有界化的**预期**行为，不是 -1 特有（impl Probe 4 实测真实早锚同样耗尽，推翻早期「有见证行即无此问题」的表述）。sidechain-only 无见证时锚回落 -1 只是把该边界提前到会话起点，量级差异、非新类。
- **边界 3**：resume 到极早期 fix（无制品、无提名事件）⟹ 不绑定（漏判非误判）。
- **残余 4**：sidechain 标记可 rm，无 transcript 侧对账兜底（弱于 Tier 1）。
- **残余 5**：(b) 只认 Write/Edit × fix-report.md——heredoc / cp / node -e 写制品、只写 verification-report、sed -i 编辑（提名侧认、见证侧不认）均不绑定（fail-open 漏判；扩宽复活 F257 绕过，刻意不扩）。
- **残余 6**：拆会话逃 implement 委派（已豁免，仍严于现状）；transcript 截断清零等共性弱点不变。
- **残余 7（真实语料现实，对抗复审 W-1 / 语料统计）**：(a) resume 源本机 383 份 transcript **0 命中**，且 spec-driver-resume skill 当前无 fix 恢复逻辑——(a) 现为**前向结构占位**，待「给 resume 补 fix 恢复」跟进卡落地后才有真实信号（登记，不当已生效能力）。(c) sidechain 源全语料**唯一 1 命中是父 prompt 引用诱饵**（isMeta 判据已排除）；SubagentStop + 标记是**新基建**（此前不存在故 0 真命中），前向生效。
- **残余 9（跨目标阻断预算 = per-session，delta 双角收敛后如实登记）**：F288 的 `blockCount` / 降级状态按 **session** 持久（非按 fix 目录）。同会话 Fix-A 付满 2 次真实阻断后，全新 Fix-B 可复用该预算 0 往返降级放行。曾试「佐证锚逐目标前移」修复，但它把同目标合法重复编辑也误伤成永久 fail-closed（delta 误伤面实测 8 轮零自愈），且仍被 Bash-pivot 绕过（delta 绕过面），故**还原为 per-session** 并如实登记：前提是 Fix-A 须先付 2 次真实阻断（本门为合规推动非硬边界），Tier 2 真实语料 0 例。**根治 = per-target 阻断预算**（改 F288 状态键 `<sid>`→`<sid>+dir`），移交 M11 独立立卡，不在已交付安全门上同 session 叠第三次重构。
- **残余 10（sidechain 无提名不覆盖）**：子代理展开了 fix 但主 transcript 与标记都无处定位 fix 目录 ⟹ 不绑定、门禁不覆盖（exit 0 零判定，与 (a) resume 无提名对称）。这是「无法定位则无法判定」的诚实上限，非硬阻断（消除误伤面 C-1）亦非 F224 免费通行（消除绕过面 C-3）。
- **残余 8（对抗复审 W-9）**：Tier 2 放行地板 = 1 次任意 review 类委派（合同拍板）；(b)/(c) 锚为真实绑定行后，会话前段无关流程的 verify 委派不再计入窗口（原 -1 锚会串号，已收）。

## 8. 明确不做

SubagentStop 直接阻断；SubagentStop 侧在途判定；账本跨会话聚合；改 isFix / BLOCK_LIMIT / 闸门 / 指纹 / 佐证语义；Codex 侧 SubagentStop 等价事件适配；给 resume skill 补 fix 恢复（残余 7 的跟进卡，独立立项）；把 (b) 见证扩到 verification-report / Bash（复活 F257 绕过）。

## 9. 风险登记（K）

- K-1 SKILL_EXPANSION_REGEX O(K×N) 诱饵退化在新扫描面重现 ⟹ 单趟 + 20MB 上限 + 结构钉 + 绝对预算。
- K-2 标记与状态文件同目录：resetBlockState 只删 <sid>.json，不误删标记（回归钉）。
- K-3 sidechain-only 无见证 ⟹ 锚 -1（误阻断 2）：登记，fail-closed、2 次自愈；有见证即真实行。
- K-4 hooks.json 新事件对老 harness：未知事件名被忽略（WorktreeCreate 先例）。
- K-5（对抗复审 W-5）主 Stop 与 SubagentStop 的 projectRoot 同源前提（均 $(pwd)）在子代理 isolation: worktree 下未实测 ⟹ 标记可能落到另一 .specify/（(c) 静默失效，漏判方向）；登记待探针。
- K-6（对抗复审 I-4）同项目他会话可植入 <victimSid>.sidechain.x.json 让受害会话 Tier 2 误阻断（DoS 面，非绕过）；标记无 TTL / sweep，状态目录随会话累积（登记，清理机制为跟进项）。
