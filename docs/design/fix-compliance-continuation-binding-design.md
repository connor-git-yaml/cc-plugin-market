# fix-compliance 续做/旁链入口收口 — 设计文档

> 状态:**已定稿待实现(parked)**。实现**串行于 F270 合入 master 之后**(理由见 §6)。
> 来源:F270 P2 对抗审查(2026-09-01)分流的独立卡;设计定稿 2026-08-31(用户四轮拍板)。
> 类别:**门禁/判定器类**——实现期须走异构对抗档位(Codex 暂停期 ≥2 切入角),commit 标注档位缺席。
> 实现启动时经 spec-driver 流程转正为 `specs/NNN-fix-*/spec.md`(编号届时 fetch 后取,避多 worktree 撞号)。

## 1. 问题:三个判定器零接触入口

fix-compliance 判定器(Stop hook)的 isFix 判据只认**当前会话主 transcript** 内 `spec-driver-fix` 的字面 skill 展开痕迹(`SKILL_EXPANSION_REGEX`,fix-compliance-core.mjs:53;F270 后为 `anchor.earliestFixLineIndex !== null` 存在性判据)。以下 fix 流程 transcript 无该展开 → 判定器零接触放行:

1. **resume 入口**:`/spec-driver:spec-driver-resume` 是所有中断流程的唯一恢复入口、承接 fix 委派链;其 transcript 只含 `skills/spec-driver-resume` 展开。
2. **sidechain**:fix 展开发生在子代理 sidechain,主 transcript 结构性不可见。
3. **跨会话续做**:新会话续做 fix、无任何展开(判定器只看当前会话)。

先于 F270 存在的能力边界(改动前后行为一致,实测 resume 会话 `fixSession` 恒 false),F270 已在 isFix 判据注释如实登记并显式裁决「范围超出本卡 D-1,分流跟进」——即本卡。

## 2. 关键事实(设计前已核实,均有出处)

- **F270 未合入**:在分支 `claude/compliance-evidence-ledger-0f0e5e`(P1 账本采集器 4addfaed + P2 锚点三分 98ccf7d5;P3+ 未完)。master 上 isFix 仍是旧判据 `anchor.mode === 'fix'`。本卡与 F270-P2 改**同一段代码**。
- **账本帮不上忙(C-14)**:skill 展开是 harness 注入到 user 消息的**文本,不是工具调用**——PostToolUse 账本结构性看不见它。本卡三个子案**均不依赖账本**;对 F270 的依赖是文本/语义冲突(同段 isFix),非架构依赖。
- **SubagentStop 可用**(F270 `research/harness-field-probe.md` 实测):payload 携 `agent_id` / `agent_type`(可为空串) / `agent_transcript_path`——sidechain transcript 可寻址,fix 展开在其中**可被同一条正则检出**。
- **T-2 陷阱**(同 probe 预登记):SubagentStop 语境下 `background_tasks` **含触发者自身**——若在 SubagentStop 上做在途判定必须按 `agent_id` 剔除自身,否则恒判在途 → 门禁静默失效。本设计不在 SubagentStop 做在途判定,陷阱不触发,但扩展者须知。
- **resume 展开已被捕获未被消费**:`SKILL_EXPANSION_REGEX` 的 mode 捕获组匹配 `resume`,`detectFixSkillExpansion` 只是不为它记基线。
- **既有可复用机械**:fix-dir 提名(`ARTIFACT_PATH_REGEX` 锚定 fix-report.md/verification-report.md 路径 + `BASH_WRITE_INDICATOR_REGEX` 写指示符)、F227 磁盘核验、F257 写入见证、F256 short-name 兜底。

## 3. 判定架构:两级证据 → 两级合同

| 级 | 绑定证据 | 欠什么才放行 |
|---|---|---|
| **Tier 1 完整合同**(现状) | transcript 内曾出现 `spec-driver-fix` 展开(F270 存在性判据) | 现行 path A(fix-report + implement 委派 + verify 委派 + verification-report)/ path B(no-op)全套,**逐字不变** |
| **Tier 2 续做合同**(新增) | 无 fix 展开,命中任一二级 fix 证据(§4) | **磁盘制品齐全非占位**(fix-report + verification/verification-report;no-op 走 path B 原样——其复现证据本就要求本会话内产生)+ **本会话 ≥1 次 verify 类委派**。implement 委派**不要求**(可能发生在上个会话,本 transcript 不可能含它) |

不变量:

- 两级互斥取严:有展开走 Tier 1,无展开才评估 Tier 2。`isFix` 判据本身不动——Tier 2 是其 `false` 分支上的新增评估,不是改写。F270 十轮收敛的锚点/闸门语义(earliestFix 基线、闸门三、BLOCK_LIMIT、IN_FLIGHT_DEFER 等)零改动。
- Tier 2 的「本会话 verify 委派」与 resume 流程自身的 Phase 7(verify 委派)天然重合——合规路径零额外成本,这是选它作最低要求的产品理由(收尾会话收尾前重验,本来就该做)。
- 用户拍板(2026-08-31):续做合同取「制品齐全 + ≥1 verify 委派」档,显式否决「完整合同不降」(误阻断面大)与「仅制品齐全」(委派契约虚设)两档。

## 4. 三条二级证据源

### (a) resume 入口

检出 `spec-driver-resume` 展开(现有正则,新增消费)后,在判定窗口内跑**既有** nomination 机械找 fix-dir 提名(制品路径锚定 + Bash 写指示符门 + 磁盘核验;`cat` 纯提及不算)。

- resume + fix 提名 → Tier 2。
- resume 无提名 → feature/story 续做,零判定(现状)。**feature/story-resume 大面积误阻断被结构性排除**——这是分流时预登记的硬约束。

### (b) 裸会话写入见证(跨会话无 resume 形态)

无任何展开,但会话内有对 `specs/NNN-fix-*/fix-report.md` 或 `.../verification/verification-report.md` 的**写入见证**(Write/Edit tool_use,或带写指示符的 Bash;F257 机械)→ Tier 2。

- 读/提及不绑(防 `cat` 误绑)。
- 写 fix 目录下**其他**文件(如 spec.md)不绑——保守收窄到收口制品本身。

### (c) sidechain 两级接力(用户拍板:检测与执法分离)

- **检测**:新增 `SubagentStop` hook。恒 exit 0(零阻断风险);payload 形状守卫(同 F270 ledger `isClaudeShape` 模式,Codex/异构 payload 静默跳过);读 `agent_transcript_path` **单趟**扫 fix 展开(同一正则 + 20MB 上限 + F257 单趟纪律——该正则有 O(K×N) 诱饵退化前科,SubagentStop 是新增扫描面,perf 要求随 spec 带走);命中 → 在 `.fix-compliance-state` 家族落**会话键控标记**(键 = session_id + agent_id)。
- **执法**:主 Stop 判定器读到**本会话**标记 → Tier 2。阻断只发生在 Stop 边界(exit 2 语义 F208→F270 十轮已验),单一执法点。
- 显式否决「SubagentStop 直接 exit 2 阻断」:harness 行为未验、每子代理停止都跑完整判定(热路径)、须处理 T-2。

## 5. 新增误阻断类与残余绕过面(如实清单,用户已逐条认可)

**新增误阻断类**(方向 fail-closed、BLOCK_LIMIT=2 自愈,按 F256「类 X」纪律登记):

1. **旧 fix 制品的顺手编辑**:会话只改已完结 fix 报告的 typo → (b) 绑定 → 制品齐但无 verify 委派 → 阻断。代价:补 1 次廉价 verify 委派或 2 次 stop 降级。频率低,接受。
2. **resume 到极早期 fix**(尚无制品写入)→ 无提名 → 不绑定。**漏判非误判**,与现状一致,登记为边界。

**残余绕过面**(本卡不消除,登记):

3. **拆会话逃 implement 委派**:会话 1 展开 fix 后弃;会话 2 resume 内 inline 改码 + 1 次 verify 委派 + 制品齐 → Tier 2 放行。仍严格于现状(零判定)。彻底闭合需 F270 账本跨会话聚合委派证据(账本已按 session 落盘委派记录)——**显式非目标,follow-up 候选**。
4. **sidechain 标记可删**:标记是磁盘态,`rm` 即逃 (c)。与既有状态文件篡改同类,但**无 transcript 侧对账兜底**(旁链痕迹主 transcript 结构性缺席,闸门三式天花板造不出来)。如实登记,弱于 Tier 1 防护。
5. **transcript 截断清零**等既有共性弱点不变(F270 p2-adversarial 已登记,真闭合属账本对账范畴)。

**Codex 面**:`SubagentStop` 是 Claude 事件;Codex 读插件 hooks.json(F264),新 hook 靠 payload 形状守卫在 Codex 下静默不动作。hooks.json 变更须与 M10 P0-B 双注册守卫协调。

## 6. 排序与实现入口条件

- **为何串行于 F270**:二者改同一段 isFix 分支代码,必撞文本冲突;且 Tier 2 设计对着 F270 的存在性判据形态写,对着 master 旧判据实现等于对着将作废的基座开工。用户拍板:spec 现在落盘,实现等 F270 合入。
- **实现入口硬条件**:① F270 已合入 master;② 本设计经 spec-driver 流程转正(specify → 异构对抗 spec-review ≥2 切入角 → plan → …),编号届时取;③ 门禁类纪律全程适用(charter 快照走权威路径再生勿 `-u`;fixture 驱动 judge CLI 测试)。
- **spec 阶段必答项(设计层刻意不定,防拍脑袋)**:Tier 2 三源各自的**判定窗口锚点**——(a) resume 源候选锚 = resume 展开行;(b)/(c) 无任何展开,候选锚 = 会话起点或首条见证/标记行。F270 P2 整轮都在修锚点选取的病根(earliest/latest 之辨),Tier 2 锚点须以同等严谨度在 spec 阶段论证并过对抗审查,不得沿用直觉默认。
- **验收骨架**(spec 阶段细化为 FR/SC):每个绑定源 × {放行 / 阻断 / 自愈} 至少一例;对照组钉死:feature-resume 不绑定、`cat` 提及不绑定、非 Claude payload 下 SubagentStop hook 零落盘、Tier 1 行为逐字回归(现有全量用例零翻转);SubagentStop 扫描 perf 上界(单趟 + 20MB)。
- **里程碑归属建议**:M10 P1-K「Spec Driver 引擎正确性」簇,或独立 fix 卡,待 milestone-next 循环拍板。

## 7. 决策台账(2026-08-31,用户四轮拍板)

| # | 决策点 | 裁决 |
|---|---|---|
| 1 | 收口范围 | **全量**(resume + sidechain + 跨会话),非仅 resume |
| 2 | 与 F270 排序 | **串行**:spec 现在写,实现等 F270 合入;否决并入 F270 / 立即并行实现 |
| 3 | 续做合同 | **制品齐全 + 本会话 ≥1 verify 委派**;implement 委派豁免,拆会话残余登记 |
| 4 | sidechain 机制 | **两级接力**(SubagentStop 检测 exit 0 + 主 Stop 执法);否决 SubagentStop 直接阻断 |
