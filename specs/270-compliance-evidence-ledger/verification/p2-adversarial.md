# F270 P2 锚点三分 · 异构对抗审查留痕

门禁类第十轮,Codex 配额暂停 → **异构对抗 ×2 切入角**(fail-open / fail-closed)。**Codex 审查暂停,异构档位缺席**。

## 对抗 A · fail-open 面(锚点绕过 / 证据窗口漏缺失)

**终版结论:无可利用 CRITICAL,fail-open 面净收窄。** 深核后 draft 的 resume-C1 降级为既有能力边界。

| 项 | 判定 | 处置 |
|---|---|---|
| Q1 isFix 存在性可否诱导 null / 误判 | **fail-closed** ✓ | earliestFix 首命中即钉死单调;展开只扫 user.textBlocks,tool_result 走独立 toolResultBlocks 刻意不并入 → 伪造被挡死 |
| Q2 latestFix 窗口 + earliest/latest 不对称 | **fail-closed** ✓ | latestFix 只增不减;推到末尾=空窗口→resolveFeatureDirCandidate 返回初值 `{path:null,ambiguous:false}`→`featureDirUndetermined=false`**不触 F224 早退**→落 compliant:false→exit 2(自伤) |
| Q3 5 消费点是否全切、anchorLineIndex 残留判据 | **全切净** ✓ | judge 内 anchorLineIndex 仅剩注释,5 下界全 latestFix(主线程独立 grep 复核一致);mode 仅诊断输出、runHook 不消费 |
| Q4 P2b 审计落账 / transcript-empty | **安全** ✓ | appendAuditEvent 严格挂 compliant 分支、纯追加不改 verdict;transcript-empty 是 loud 化净增可观测性 |

**登记的既有面(非本卡回归)**:
- **resume/sidechain/跨会话入口盲区**(draft C-1):isFix 只认 transcript 内 `spec-driver-fix` 字面展开;resume 恢复的 fix 流程 transcript 无该展开 → 不判定。**改动前后行为一致(已实测:resume 会话 fixSession 恒 false)**,非本卡引入。已在 isFix 判据注释如实登记 + spawn_task 分流(收口需配二级信号防误伤 feature/story 的 resume)。
- **transcript 截断逃逸**(A-Q4 W):被判方 Stop 前 `: > transcript` 清零 → transcript-empty → exit 0。既有共性弱点,改动前空 transcript 同样放行;P2b 反而加了审计痕迹。真闭合属 P0-A(账本对账 transcript 存在性)范畴。
- **W-2 F224 fail-open 闸位置放宽**:`featureDirUndetermined && hasVerifyClassDelegation` 的构造可埋在 fix 阶段中段(下界前移)。A 判定"相对改动前仍变好、非新增能力",登记不修。

## 对抗 A 已处置项
- **I-1 承重注释漂移**(judge:369-378 形态 3 仍写 anchorLineIndex):✅ 已改为 latestFixLineIndex 并说明与病根 iv 的关系。
- **over-claim 措辞**(isFix 注释"病根 iv 已闭合"):✅ 改为如实——只封会话内被顶掉那支,resume/sidechain/跨会话是既有边界。
- **W-3 存在性判据对称代价**(fix→feature/story 误阻断新类):✅ 已在 isFix 注释按 F256「类 X」纪律登记(方向 fail-closed、可自愈)。
- **I-2 mode 语义分裂**(审计 isFix=true 而 mode='doc'):✅ **定性澄清后无需改代码**。核实 `buildAuditEvent` 落盘字段**不含 mode**(A 把 `--mode report` 的 JSON 误当审计事件);report JSON 里 `fixSession`(=isFix)与 `mode` 是**两个正交字段**——「曾否 fix 展开」与「最晚展开是什么」,并列即完整信息,非分裂。isFix 注释已写明"anchor.mode 仍如实报最晚任意展开(诊断语义不变)"。

## 对抗 B · fail-closed 面(误伤 / 回归)

**终版结论:CRITICAL 0 条,阻断(false-block)轴净收窄。**

| 项 | 判定 | 依据 |
|---|---|---|
| Q2 窗口切 latestFix | **改对了,严格放宽** | 🔴 **`latestFixLineIndex ≤ anchorLineIndex` 恒成立**(最晚 fix ≤ 最晚任意展开)→ 新窗口 **⊇** 旧窗口 → 5 消费点只增证据 → **结构上不可能把 compliant 翻 block**。主线程 5 序列穷举实测确认 ⊇ 关系 |
| Q4 基线更新 | **正确,未掩盖回归** | compliant-noop/legacy-repair 的 0→1 恰是 FR-024 合规留痕;**关键对照组 `non-fix-session` 仍钉 eventCount:0/specifyDirCreated:false** → 证明落盘严格门控在 isFix=true 之后(runHook `!result.isFix` 先短路),从未 fix 会话仍零落盘 |
| Q1 isFix 存在性收口 | **非新造 FP** | 撤掉的是"掩盖既有误报的意外逃逸阀"(切模式绕过),本 diff 不新造误报;自愈成立(补制品 / 开新 session) |

**登记的护栏回退(spec 授权,须显式)**:
- **W-2 · transcript-empty 回退 F240 US5「空态零落盘」**:真全空 transcript(session 刚建/写盘竞态/harness 截断)在 Stop 时会在无关项目 `mkdir .specify/runs/` 写 degraded 事件。**exit 0 不阻断,纯审计噪声/目录污染,非 fail-closed。** spec **FR-045 明裁**此形态(空 transcript 是审计黑洞→改 loud),有测试钉死,是刻意决策非疏漏。缓解:短但非空会话(1 user+1 assistant 无 fix)仍走 isFix=false 零落盘,只有真全空文件命中,低频。**这是本卡唯一授权的护栏回退,如实登记。**

## 两路总评
- fail-open(A):净收窄,无 CRITICAL。
- fail-closed(B):净收窄(窗口 ⊇ 消除病根 iv 误阻断),无 CRITICAL,唯一护栏回退(transcript-empty US5)经 FR-045 授权。
- **P2 合入判定:通过。** 5 项次级发现全处置(注释漂移修复 / over-claim 如实化 / W-3 新误阻断类登记 / resume 盲区分流 / I-2 定性澄清)。
