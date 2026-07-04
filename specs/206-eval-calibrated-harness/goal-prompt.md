# F206 /goal 优化 Prompt（c3 validation 通过率）

> **用途**：校准批产出 sets.json 后，把下方 prompt 交给 `/goal`（autoresearch）启动"修改 → 验证 → KEEP/DISCARD"自主迭代循环。
> **前置**：`.calibration-output/sets.json` 已生成（frozen/validation 各 3 任务）；Surge 常驻；全局 spec-driver/spectra plugin 已 disable；Docker 运行。
> **入库**：本文件入库（F206 流程制品）；baseline.json / current.json 等运行产物不入库。

---

## 复制以下内容给 /goal

```text
Goal: 提升 c3（spec-driver + Spectra MCP）在 F206 validation 集上的 SWE-bench oracle 通过率。

背景（校准批实测，2026-07 校准 11 候选 66 run）：6 个 discriminating 任务上 c1（裸 claude）
passRate=1.0（~140s / ~$0.30 / 改 4-8 文件就修对），c3 passRate=0.0（33 run 零通过）。
差距不是任务难度，是工具流程开销。c3 两种失败形态：
(a) gen_timeout：spec-driver 全流程在 20min 单 run 超时内跑不完（实测多 run 800-1200s 被杀）；
(b) 跑完但 oracle FAIL：改 22 个文件（多为 spec/plan 制品、uncommitted），真正的代码修复缺失或错误。
MCP 链路本身通（tools=2-3, totalCalls=5），瓶颈在流程重、不聚焦、时间花在制品而非修复。

Scope（允许修改）:
- plugins/spec-driver/**（skills / agents / orchestration / scripts / config 模板）
- Spectra MCP 上下文供给相关源码（src/ 中 MCP server / context 工具链）
禁止修改（画红线）:
- scripts/eval-*.mjs、scripts/lib/**（评测 harness——改它=作弊仪器）
- tests/baseline/**、.calibration-output/**（sets.json / 校准池）
- oracle 链路与 CALIBRATION_* 合同
- frozen 集 3 任务（SWE-V005 / SWE-V001 / SWE-V003）：迭代中不得运行、不得针对性调优（held-out 合同）
允许：读 validation run 产物（worktree 日志 / fixture）诊断失败模式；
禁止：把任务特定答案 / 任务 ID 特判硬编码进 plugin（过拟合=作废）。

Metric: eval-validate 末行 PASSRATE（validation 集 = SWE-VB003 / SWE-V008 / SWE-V009，
cohort c3，N=1×3 任务）。Baseline = 0.0000。

Direction: maximize。

Verify（分层，先快后慢）:
1. 快验（每次改动后，~2min）：npx vitest run（相关单测零失败）+ npm run build 零错误。
2. 慢验（快验过了才跑，~30-60min/轮，烧真配额）：
   # 第一轮先建 baseline（若 .calibration-output/baseline.json 不存在）：
   node scripts/eval-validate.mjs --sets .calibration-output/sets.json --goal \
     --concurrency 1 --output .calibration-output/baseline.json
   # 之后每轮：
   node scripts/eval-validate.mjs --sets .calibration-output/sets.json --goal \
     --concurrency 1 --baseline .calibration-output/baseline.json \
     --output .calibration-output/current.json
3. 判定：
   - 脚本输出 KEEP（新 CI 下界 > 旧均值+0.05）→ 保留改动，current.json 复制为新 baseline
   - DISCARD 但 n_pass 从 0 升到 ≥1 → 弱信号：同改动重跑一次慢验，复现则按 KEEP 处理并在
     日志标注 weak-keep（n=3 小样本下正式 KEEP 门槛≈2/3，0→1/3 的真实进步会被 CI 判 DISCARD，
     这是已知的统计功效限制，勿因此丢弃方向正确的改动）
   - DISCARD 且 n_pass 无变化 → git 干净回滚本轮改动
   - exit 2（连接门禁被拒 / infra 作废 / 无有效样本）→ 本轮无效，修环境后重跑，不算 0 进步
4. 环境自检（每轮慢验前）：Surge 在跑（脚本自带连接门禁会拦）；全局 spec-driver/spectra
   plugin 处于 disable（否则 c3 skill-invocation 门禁 fail）；Docker 运行。

纪律:
- 一轮只验证一个假设（单变量），改动小而聚焦；每轮在迭代日志记录 假设/改动/PASSRATE/判定
- 生产代码质量不降级：改 plugins/spec-driver 源码走既有测试约定，新行为补单测
- 建议首批假设方向（按校准诊断排序）：
  a. 小 bug-fix 任务轻量快路径：fix/story 模式裁剪 phase，避免全流程制品开销
  b. 时间预算感知：临近超时优先产出并保留实际代码修复（patch 必须留在 worktree 且非 untracked-only）
  c. MCP 上下文利用率：确认 impact/context 调用真的用于缺陷定位，而非仪式性调用
- 配额：每轮慢验 ≈ 3 run × 10-20min；跑 ≥6 轮检查一次 Claude Max 配额面板

Iterations: 5（先看斜率，再决定是否续期）
```

---

## 已知限制与后续

- **n=3 统计功效**：正式 KEEP 门槛实际约 2/3 通过率；0→1/3 靠 weak-keep 复跑规则兜底。
  持久解法 = 扩候选池重校准把 validation 撑到 ≥6 任务（见 calibration-runbook「扩候选池」）。
- **weakSeparation**：6 个 discriminating 全部为 N=3 退化 CI 弱分离；方向一致性（6/6 同向
  c1>c3，另 5 个非 discriminating 候选同趋势）支撑聚合结论，但单任务结论不稳。
- **frozen 集**（V005/V001/V003）只在里程碑时用 `--milestone-frozen` 跑一次做对照，
  绝不进迭代循环。
- anchor hash：frozen `298cf1279245ce17…` / validation `b7b961edf3d92cff…`（sets.json 生成时
  打印；换池必须重记）。
