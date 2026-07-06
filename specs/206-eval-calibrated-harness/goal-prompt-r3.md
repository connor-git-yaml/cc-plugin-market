# F206 /goal 第二战役 Prompt（GStack 拆解 → 第 3-5 轮迭代）

> **用途**：head-to-head 终表（GStack 90.9% > c1 77.4% ≈ c3 75.8% > SuperPowers 66.7%）后的第二轮优化战役。
> **前置**：第 1 轮 a' 已 KEEP（4b50109 已 push）；第 2 轮 no-op 门禁已 DISCARD 回滚（Goodhart：症状复现≠期望行为）。
> **入库**：本文件入库；运行产物不入库。

---

## 复制以下内容给 /goal

```text
Goal: 提升 c3（spec-driver + Spectra MCP）在 F206 validation 集上的 SWE-bench oracle 通过率，
并缩小与 GStack（90.9% 新标杆）的差距。

背景（2026-07-06 head-to-head 终表，修好仪器上 99 run 零 infra error）：
c5 GStack 30/33=90.9%（仅 V006 失分）> c1 裸 77.4% ≈ c3 我们 25/33=75.8% > c4 SuperPowers 66.7%。
c3 在 8/11 任务 3/3（含前重灾 VB003）；失分集中：V006 0/3(全场坟场) + V008 0/3(no-op 方向反转)
+ V010 1/3(2 新超时待察)。第 2 轮教训（已回滚）：no-op 门禁验证"症状消失"被合规绕过——
V008 上 agent 把 base 的 NotImplementedError 当"已修复"，症状复现通过 + repo 旧测试通过 →
带完美证据空手收口。任何验证必须锚"期望行为满足"，不是"症状不再出现"。

Scope（允许修改）:
- plugins/spec-driver/**（skills / agents / orchestration / scripts / config 模板）
- Spectra MCP 上下文供给相关源码（src/ 中 MCP server / context 工具链）
禁止（红线）:
- scripts/eval-*.mjs、scripts/lib/**（评测 harness）。例外=仪器修复先例：若发现 harness 测量
  完整性 bug（假报/缓存/口径），暂停迭代，作为独立 fix 走 codex 审查+commit（不计轮次），修完再测
- tests/baseline/**、.calibration-output/** 原件（sets.json / calibrated-pool*.json 不改；新增分析文件可以）
- frozen 集（SWE-V005/V001/V003）不得运行、不得针对性调优
- 禁止任务 ID 特判/答案硬编码（过拟合=作废）；允许读全部留存 run 产物做诊断

Metric: validation 集（SWE-VB003 / SWE-V008 / SWE-V009）c3 oracle 通过率。
Baseline = 0.8333（第 1 轮 a'-only 状态，N=6 实测 5/6；当前 plugin 即此状态）。
Direction: maximize（副目标：对 GStack 差距；全池对比仅在战役收官时跑一次）。

═══ Phase 0（必先做，零 LLM 配额）：GStack 拆解 ═══
材料全在本地：
- ~/.claude/skills/gstack/**（它的 skill 文件本体：AGENTS.md/ARCHITECTURE.md/BROWSER.md 等）
- run_artifacts/*__gstack__r*/predictions.jsonl（它 33 个 run 的完整 patch）
- tests/baseline/tasks/<task>/gstack-c5-r*/full.json（wall/diffStat/oracle 细节）
- 对照我方同任务产物（spec-driver-spectra-mcp 同路径）
产出（写 scratchpad/gstack-dissection.md）：
1. 流程结构对比：它的 plan→build→review→test→ship 每步实际做什么（从 skill 文件+patch 形态反推）
2. patch 形态对比：文件数/行数/测试处理方式（改旧测试?新增?不动?）/制品噪声
3. 时间分布对比（fixture wall 数据）
4. V006 上它怎么死的（大家都死,死法是否不同）、V008 上它 3/3 怎么赢的（我们 0/3 的镜像样本!）
5. **≥3 条可移植假设，按预期收益排序**（每条注明证据+移植到 spec-driver 的具体位置）

═══ 第 3 轮（预注册）：期望行为合同 no-op 验证 ═══
替代已回滚的第 2 轮门禁，核心差异：
- fix 模式诊断阶段必须从问题描述提取「期望行为断言」（输入→期望输出/契约，如"as_set() 应返回
  集合对象而非抛异常"），写入 fix-report.md 专节
- 零源码改动收口时，verify 子代理必须在当前工作树执行期望行为断言并证明**满足**（命令+退出码+
  输出摘要）；症状不复现 ≠ 期望行为满足；repo 既有测试不作为期望行为证据（可能编码旧契约）
- 期望行为不满足 → 不是 no-op，必须回去修；无法构造断言 → BLOCKED 收口（有界，不回环超 1 次）
- 实施后 codex 对抗审查（只读约束）+ 快验，慢验按下方协议

═══ 第 4-5 轮：从 Phase 0 的 top 假设取（一轮一假设） ═══

Verify 协议（分层）:
1. 快验：npx vitest run 零失败 + npm run build 零错误 + npm run repo:check pass
2. 慢验（~45min/invocation，烧真配额）——严格按此序列（血泪固化）：
   a. 确认 Surge 在跑 + Docker daemon 健康（docker pull alpine:3.20 秒级完成；若挂→硬杀全家
      pkill -9 -f "Docker Desktop|com.docker" 后 open -a Docker 等就绪）
   b. node scripts/build-spectra-stamped.mjs（repo:sync 之后 dist 必陈旧，不跑=c3 秒 error）
   c. claude plugin disable spec-driver@cc-plugin-market --scope user && claude plugin disable
      spectra@cc-plugin-market --scope user
   d. node scripts/eval-validate.mjs --sets .calibration-output/sets.json --goal --concurrency 1
      --budget-ms 4500000 --output .calibration-output/current-rN.json
   e. **无论成败**立即 enable 恢复两个 plugin（用 trap 包装脚本保证）
   f. 每轮跑 2 次 invocation 凑 N=6（与 baseline 协议对齐；warmup 每次会真跑 2 个 control run，
      已知成本，接受）
3. 判定（预注册）：
   - 合并 N=6 ≥5/6 且机制性证据成立（对应失败形态确实消失）→ weak-keep，保留+commit（codex 已审）
   - 合并 <5/6 或目标形态未消 → DISCARD，git checkout 干净回滚
   - eval-validate exit 2 = 本轮无效（环境），修复重跑不计轮次
   - V008 是第 3 轮的靶心指标：它 ≥2/3 才算机制性证据成立
4. 环境自检提醒：dist 门禁报错=先跑 b；ConnectionRefused=查 Surge；oracle 陈旧缓存已由
  purgeStaleEvaluationLogs 自动防护（415e46e）

纪律:
- 一轮一假设；每轮记 scratchpad/goal-iterations.md（假设/改动/PASSRATE/判定/机制证据）
- 生产代码质量不降级；SKILL/agent 改动过 repo:sync 后镜像同步
- 配额：慢验 ≥3 轮检查 Claude Max 面板；Phase 0 零配额可随时做

Iterations: Phase 0 + 3 轮（第 3 轮预注册 + 2 轮取自 Phase 0 假设；先看斜率再续期）
```

---

## 备注

- baseline 0.8333 对应当前已 push 的 plugin 状态（a' KEEP、第 2 轮已回滚），无需重测
- 战役收官时可选：全池 11 任务 c3 复测一次（33 run）更新四方表的 c3 行，与 GStack 差距以全池口径结算
- V010 的 2 个新超时（7 月 3/3 → h2h 1/3）未解释，若 Phase 0 或轮次中顺带发现根因，记录但不专门开轮
