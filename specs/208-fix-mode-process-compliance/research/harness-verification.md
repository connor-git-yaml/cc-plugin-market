# 主编排器交叉验证附录:hooks 强制力三重实锤(2026-07-06)

> tech-research.md 标注了 2 个前提性不确定性(§5 风险 #1/#3)。本附录是主编排器用 Bash 实测
> 的交叉验证记录,**两个不确定性均已解决**;在与评测同构的 headless 入口下,plugin hooks 的
> 执行与 Stop hook exit 2 阻断-反馈闭环已被简单 spike 验证。
> spike 环境:scratchpad/hook-spike(插件副本 + 副作用标记,不污染源码);模型 haiku,成本 <$0.03。
>
> **外推边界(codex W-2 修正)**:spike 用 haiku + 极简任务("say ok"/写一个文件),证明的是
> **闭环机制存在**;不证明 opus + 真实 fix 技能展开 + 复杂 no-op 场景下模型必然按复杂补救指令
> 完成流程——该端到端可靠性属 plan 阶段验收任务。另:exit 2 阻断 + stderr 回注模型的语义依赖
> 当前 Claude Code CLI 行为,升级存在脆弱性,需以可重跑的回归 spike 守护(plan 细化)。

## 结论一:评测 harness 入口已核实,无禁 hooks flag(解决风险 #1)

真正驱动 c3 评测 run 的入口是 `scripts/eval-task-runner.mjs`(**不是**调研报告勘察的
`llm-backend-dispatcher.mjs`——那是 judge/jury 评分调度器)。cohort3 spawn args
(eval-task-runner.mjs L300-321,只读核实):

```
claude --print --model claude-opus-4-7 --output-format stream-json --include-partial-messages
  --verbose --permission-mode acceptEdits|bypassPermissions
  --plugin-dir <spectraPluginDir> --plugin-dir <specDriverPluginDir>
  --allowedTools <COHORT3_ALLOWED_TOOLS> [--dangerously-skip-permissions] -- <prompt>
```

- **无 `--bare` / 无 hooks 禁用 / 无自定义 `--settings`**
- prompt 走位置参数(slash 展开成 skill 注入 transcript——这一点是 Stop hook 会话自判信号的基础)

## 结论二:评测加载 worktree 源码版 plugin(解决风险 #3)

`specDriverPluginDir` 经 `--plugin-dir` 注入,指向**本 worktree 的 `plugins/spec-driver`**
(与 F206 战役记录"eval 活读本 worktree plugin"、慢验协议先 disable 全局 plugin 防歧义一致)。
改动落 `plugins/spec-driver/**` 后评测直接可见,无全局缓存(4.2.1)遮蔽问题。

## 结论三:plugin hooks 在 headless 下全事件真实执行 + Stop 阻断闭环成立(三重实锤)

### 实锤 1 — F206 真实评测产物中的 hook 事件

74 run 的 stdout.log(stream-json)含 `"hook_event":"SessionStart"` hook_started/hook_response
事件(两个 plugin 各一)——plugin hooks 机制在 F206 评测中**已经在运行**。

### 实锤 2 — 副作用标记 spike:全部 hook 类型执行

插件副本的 stop-task-check / pre-tool-use-guard / post-tool-use-format 加写盘标记后,
`claude --print --plugin-dir <副本> -- "create a file..."`(acceptEdits)的 hook-trace.log:

```
pre-tool-use-guard      ← PreToolUse 执行 ✅
post-tool-use-format    ← PostToolUse 执行 ✅
stop-task-check         ← Stop 执行 ✅
```

**重要观察盲区**:stream-json 只对 SessionStart emit hook 事件;PreToolUse/PostToolUse/Stop
执行但不留流事件,非阻断 hook 的 stderr 在 --print 下也不透传。
→ 设计含义 (1):此前从 run_artifacts 看不到 Stop 事件是**假阴性**,不能据此判 hooks 失效;
→ 设计含义 (2):依从性判据不能依赖 stream 事件,必须依赖文件系统状态或 transcript 解析。

### 实锤 3 — Stop hook exit 2 阻断-反馈-补救-放行完整闭环

副本 Stop hook 改为:`must-do.txt` 不存在 → stderr 输出补救指令 + exit 2。
`claude --print -- "say only ok"` 的 hook-trace 时间线:

```
t+0s  stop-hook-invoked            ← 模型答完 "ok" 试图收口,被 exit 2 阻断
t+3s  pre-tool-use-guard/post-...  ← 模型收到 stderr reason,执行 Write 补救
t+7s  stop-hook-invoked → released ← must-do.txt(内容 "done" 一字不差)已存在,放行
exit=0,最终输出 "ok"
```

证明在评测同构环境(headless + --plugin-dir + acceptEdits)下:
1. Stop hook exit 2 **阻断收口** ✅
2. stderr reason **回注模型上下文**并驱动正确补救行为 ✅
3. 判据满足后放行,**自然有界**(补救完成即不再阻断)✅

## 对 spec 的设计输入(主编排器判断)

1. **会话自判信号的死结解法**:坍塌 run 不跑 init、不落任何"流程自愿产生的痕迹",标记文件方案
   (调研风险 #2 缓解 (3))对坍塌 run 无效。可靠信号 = **用户消息中的 fix skill 展开注入**
   (transcript 首条 user 消息含 spec-driver-fix SKILL 内容/命令标记)——skill 展开由 harness
   完成,模型无法遗弃。Stop hook payload 自带 `transcript_path`,可解析。
2. **委派计数来源**:transcript JSONL 中的 Task tool_use 记录(harness 写入,模型无法伪造),
   而非模型自陈。
3. **阻断 reason 是"最后一道 prompt"**:实锤 3 证明 reason 文本直接驱动模型行为,其内容质量
   (给出具体、可执行的补救指引——补流程或走合法 no-op 出口)应成为 FR 的一部分。
4. **有界化**:exit 2 阻断次数需上限(防真死循环);Stop hook payload 的 `stop_hook_active`
   字段(文档)可辅助判断是否已在阻断后继续中,避免无限循环。
5. c3 观察到的 SessionStart×2(spectra + spec-driver 双 plugin)提示:新增 hook 的自判要
   防"非 fix 会话误伤"(feature/story 模式会话、普通会话都挂着同一份 plugin hooks)。
