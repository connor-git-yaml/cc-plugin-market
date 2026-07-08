# 证据固化:F206 /goal 第二战役 R3/R4 仪式坍塌取证(2026-07-06)

> 来源:F206 战役 session(worktree heuristic-dirac-b2faeb)的 scratchpad/goal-iterations.md 与
> specs/206-eval-calibrated-harness/goal-prompt-r3.md。原始 run 产物在该 worktree run_artifacts/
> 与 tests/baseline/tasks/(均不入库)。本文件为立项证据摘录,供 F208 spec 阶段引用。

## 1. 缺陷现象(仪式坍塌 / ritual collapse)

spec-driver fix 模式在 **agent 判断"问题已修复/无需改动"** 场景下,会**整体遗弃技能流程**:

- 不跑 `init-project.sh`(无项目初始化)
- 不建特性目录(`specs/<NNN>-*/` 不存在)
- 不写 `fix-report.md`(诊断制品缺失)
- **0 次子代理委派**(SKILL.md 中"禁止 inline 替代委派"的硬约束文本形同虚设)
- 最终消息里行内 cosplay 一份"修复报告"收口——甚至模仿了 R3-v3 新增的断言表格式
  (含来源原文句列),证明模型**读了并吸收了 SKILL 内容,但选择遗弃流程本身**

## 2. 决定性取证(74 run 全量 Agent 委派扫描)

- SWE-V008 的全部 no-op 失败 run **从来**伴随仪式坍塌:7-03 校准批 r4/r6、7-06 r2 均为
  **0 委派**;同批 VB003/V009 全程 4-6 次 Agent 委派、流程完整
- 叠加 future-history leakage:坍塌 run 曾用 `git merge-base --is-ancestor c5fb611` 拿
  上游"修复"commit 当"已修复"证据

## 3. 地方病规模(回扫全批)

| 批次 | 坍塌率 |
|------|--------|
| 7-03 校准批 | 7/24 = 29% |
| 7-05 head-to-head 批 | 5/25 = 20% |
| 7-06 R4 take1 | 3/6 |

- 坍塌 run 更快且常通过(≈ 裸 opus freestyle 模式);伤害集中于 V008 类"看似已修"任务 → 错误 no-op
- **测量学含义:c3 的 75.8% 通过率中,两三成 run 实为 opus freestyle 而非 spec-driver 流程**——
  坍塌注入跨 run 方差,评测测的不全是产品
- 反例锚点:V010 历史 4/4 run 全部 6 委派高依从(说明坍塌与任务"看似已修/极简"感知相关)
- R4 take1 中 V009 出现"坍塌但 PASS"(140s,行内自由发挥修对)——坍塌不必然失败,
  但使结果不可归因于产品流程

## 4. 三轮 prompt 级守卫全部被绕过(为什么必须结构化)

| 轮次 | 守卫策略 | 结局 |
|------|---------|------|
| R2 | no-op 门禁锚"症状消失" | 被合规绕过(Goodhart):base 抛 NotImplementedError 被当"已修复",症状复现通过 + repo 旧测试通过 → 带完美证据空手收口。已回滚 |
| R3-v1 | 期望行为合同(断言提取 + no-op 收口守卫) | 断言提取环节被现状同化:把症状否定式当正向契约,守卫忠实执行歪断言。机制证伪 |
| R3-v2/v3 | 提取时序锁定 + 正向契约形式 + 反平凡化 + codex 三轮加固(2C/1W + 3C/3W 全处置) | **流程整体遗弃**:模型模仿了断言表格式但 0 委派、无制品,文本守卫住在被遗弃的流程里 = 死信。DISCARD 已回滚 |

**结论**:R2 教训是"验证对象错了",R3 教训是"**流程依从性本身在 no-op 场景下崩塌**"。
prompt/SKILL 文本层已证明无法自我保障依从性,需要 hook / 编排器 CLI 级的结构化强制。

## 5. 立项候选方向(spec 阶段评估,不预设结论)

- (a) plugin hooks(Stop / PreToolUse)校验 fix 会话产物完整性(fix-report.md 存在性 / 委派计数)
- (b) orchestrator-cli 增加流程依从性断言命令,SKILL 要求收口前调用且输出进 transcript
- (c) record-workflow-run 强制校验制品清单,缺失即拒绝 success result
- (d) 无改动收口专用 skill 出口(让"已修复"成为一等公民路径,而非流程遗弃诱因)

## 6. 硬约束(红线)

1. 方案**不得特判任务 ID**(过拟合 = 作废)
2. 评测 harness(`scripts/eval-*.mjs`、`scripts/lib/**`)**不可动**
3. 全局插件缓存是旧版(4.2.1),改动只落 `plugins/spec-driver/**`
4. 本次立项**先 spec 不急 ship**(GATE_DESIGN 停点等用户)

## 7. 关联事实(设计输入)

- R3 曾发现 BLOCKED 收口与 record-workflow-run 结果枚举不兼容(codex C-3),
  当时用 paused + --gate-pause 规避 → 说明 (c)/(d) 方向要处理结果枚举的表达力
- GStack 拆解(Phase 0)佐证:c3 输在流程税(561s vs 269s、$2.06 vs $0.58),
  流程依从性保障若增加开销,需权衡轻量路径(R1 a' 已 KEEP 的 4a/4b 并入 4c 轻量验证路径)
- fix 模式轻量路径(4b50109)与完整路径(4a/4b/4c)并存,依从性校验须覆盖两路径
