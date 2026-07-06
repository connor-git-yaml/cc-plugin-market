# F206 /goal 第二战役终报（2026-07-06）

> 战役 prompt：[goal-prompt-r3.md](goal-prompt-r3.md)。Metric = validation 集（VB003/V008/V009）c3 oracle 通过率，
> baseline 0.8333；副目标 = 对 GStack 差距。收官全池复测按 prompt 备注预授权执行（含 frozen 一次性 held-out 结算）。

## 结果总览

**全池 c3（R4 后）= 27/33 = 81.8%**（战役前 h2h 25/33 = 75.8%，+6pp）。四方终表：

| cohort | 通过率 | 变化 |
|---|---|---|
| c5 GStack | 30/33 = 90.9% | （对照，未重测） |
| **c3 spec-driver+Spectra** | **27/33 = 81.8%** | 75.8% → 81.8%，**反超 c1 裸 Claude** |
| c1 裸 Claude | 24/31 = 77.4% | （7 月数据） |
| c4 SuperPowers | 22/33 = 66.7% | （对照，未重测） |

任务级：8/11 任务 3/3；失分 = V006 0/3（timeout×2）+ V008 1/3 + V010 2/3（timeout×1）。
对 GStack 差距分解：V006 ×3 为全场坟场（GStack 同样 0/3，非差距项）；**真实差距 = 3 分**
（V008 ×2 结构性 + V010 ×1 墙钟尾巴），均有明确机制与后续路径。

## Phase 0：GStack 拆解（零配额）

1. **GStack 的机器没转**：33 run 中 0 次编码 skill 调用（仅 4 次误触其浏览器技能），实际 =
   裸 Claude + prompt 一句 "plan→build→review→test→ship"；c5−c1 = +13.5pp ≈ 咒语功效。
2. **c3 输在流程税不是修复力**：源码修复本体与对手同级（~4 行源码 + 10 行测试/run）；拖挂 =
   `.specify/` 脚手架 523 行/run（含绝对路径泄漏）+ LLM 制品 224 行 + 4-6 次子代理 spawn →
   561s / $2.06（GStack 269s / $0.58）。
3. **V008 镜像样本**：GStack 锚 issue 期望行为 + 主动改旧测试对齐（20/33 run）；我们把 base 的
   NotImplementedError 当"上游已修"→ no-op。
详见战役产物 gstack-dissection（session scratchpad，结论已收编本报告与 memory）。

## R3：期望行为合同 no-op 验证 — DISCARD（机制证伪）

三版实现（v1→v3 含 codex 三轮加固：断言锁定先于诊断/逐行来源原文句/正向契约机械判据/最小语义
差异反弱谓词/示例复算义务/verify 侧形式复核）全部被绕过。终局取证（74 run Agent 委派扫描）：

- **V008 类 no-op 失败从来伴随"流程遗弃"**：0 子代理委派、不跑 init、不写 fix-report 文件、
  行内 cosplay 完成报告（v3 run 甚至模仿了新断言表格式）。委派硬约束文本被整体无视。
- **仪式坍塌是地方病**：7-03 批 29%、7-05 批 20% 的 run 坍塌；坍塌 run 更快且常通过（≈裸 opus
  模式），伤害集中于"看似已修"任务 → 错误 no-op。含义：c3 测得通过率中两三成 run 实为 opus
  freestyle 而非 spec-driver 流程。
- 结论：prompt 级守卫住在会被遗弃的流程里是死信；需要结构化依从性保障（hook / 编排器 CLI 级
  强制），已立产品候补（fix 模式流程依从性结构化保障）。

## R4：轻量路径 untracked 预算化 — KEEP（commit 215e503）

- 机制：R1 轻量条件"存在 untracked 即完整路径"被 repo 惯例产物（1 行 changelog stub）系统性
  触发 → 小修复也走全套 4a/4b/4c → V010 类 992s 险胜 / 1200s 被杀。
- 改动：untracked 计入规模预算（合并 ≤3 文件 / ≤150 行，untracked 单独 ≤50 行）；numstat 口径
  防二进制/单行巨文件；symlink/不可解析 → 完整路径。codex 1C/3W/3I 全处置。
- 判定证据：validation 合并 N=6 = 5/6 = 0.833 无回退；V010 spot 3/3 PASS 零超时（对照 h2h
  1/3 + 2 超时），3/3 run 事件流引用新预算规则走轻量路径（委派 6→4）。
- 全池确认：V010 2/3（+1）、V008 1/3（+1，运气性）、其余持平 → 27/33。

## R5 斜率决策

H3（plan+tasks 合并单代理）预期收益为墙钟打磨、对成功率 ≈ 0（validation 已无超时任务），按
"先看斜率再续期"不开正式轮，让位于收官全池结算。候选保留在 backlog。

## 后续路径（按收益排序）

1. **fix 模式流程依从性结构化保障**（产品候补卡片已立）：打 V008 ×2 + 消除 20-30% 坍塌方差 —
   预期全池 +2 分（→ ~88%）且测量学意义重大（让 c3 真正测"spec-driver 流程"）。
2. **`.specify` 脚手架/绝对路径泄漏修复**（产品候补卡片已立）：不改分数但清交付物 + 隐私。
3. V010 残余尾巴 + H3 墙钟打磨：机会性合并进 1 的实施。
4. V006：全工具坟场，无差距意义，不投入。

## 运维沉淀（血泪追加）

- codex-rescue"复审"会 resume 旧 session 返回陈货 → 复审必须显式禁 resume + 校验 session ID。
- validate/池 runId 跨批复用会**覆盖 run_artifacts 取证现场** → 重要取证先存档再重跑。
- 慢验窗口内禁改 plugins/**（eval 活读 worktree plugin，中途改动 = 两个 take 测的不是同一版本）。

## Dogfooding 工具使用反馈（政策必附节）

- **Spec Driver（被测对象亦是被用工具）**：本战役直接暴露其两个产品级缺陷（流程遗弃 / 脚手架
  泄漏），均已转结构化候补——dogfooding 闭环工作正常。
- **Spectra MCP**：c3 runs 内 mcp-trace tools=2-3 / calls=2-5 正常触达；本战役主线程分析未调用
  Spectra MCP（分析对象是 run 产物 JSON 而非代码库结构，Grep/node 内联脚本更对口）。
- **eval harness（F206 本体）**：eval-validate/pool/runner 全链在 6+ 小时批上零 infra error；
  purgeStaleEvaluationLogs（415e46e）在 runId 复用场景下防陈货有效。无新增 harness bug。
