# F206 评测基座恢复报告（F212 headline 前置）

> 背景：F206 战役的全部运行态基座（`.calibration-output/{calibrated-pool,sets}.json`、
> `tests/baseline/swe-bench-verified/fixtures/`、run_artifacts、campaign worktree 现场）已从磁盘清除；
> specs/206 未按 FR-011 入库校准报告/锚文件（仅 goal-prompt.md 存了两个 16 hex 截断锚）。
> headline 复测要求与 F206 全池结算**同池同口径** —— 本文档记录恢复链与逐项验证，供审计。

## 恢复链（全部确定性/可交叉验证，零猜测残留）

| 步骤 | 来源 | 验证 |
|------|------|------|
| 1. 全池 11 task 枚举 | 会话转录 `__gstack__rN` runId（c5 GStack **仅**在 h2h 全池批跑过 → 其 runId 集合 = 全池）| 恰 11 个唯一 task；与 `__spec-driver-spectra-mcp__` runId 集合、campaign-2 报告"8/11 任务 3/3 + V006/V008/V010 失分"完全一致 |
| 2. 池成员身份交叉 | 校准会话 982e33e9 日志（"6 discriminating / 11 候选"，VB003 判 true 后早停）| 候选序 = V001..V010 + VB003 恰 11；6 discriminating = frozen∪validation 已知 6 员 ✓ |
| 3. Docker 镜像物证 | `docker images` 残留 `sweb.eval.*` | 8 sympy + pytest-10081 + astropy-14995（=VB003 nddataref-mask）与池 repo 构成吻合 |
| 4. fixtures 重建 | zsh 历史恢复的两条原始 import 命令（V 批 / VB 批），离线 HF 缓存重跑 | **V 批字节级命中 F176 冻结锚** `fixtureContentHash=19d8d42…`（精确 64hex）+ `taskSetHash=6c5ed1c0…` ✓✓ —— importer 确定性实证 |
| 5. VB003 身份 | VB 批重导入 20 个 id 与转录枚举逐一相同；VB003 slug=`astropy-in-v5-nddataref-mask` | frozen 集 `298cf1279245ce17…` + validation 集 `b7b961edf3d92cff…` **两锚前缀命中**（用 eval-split-sets 自身 `computeTaskSetHash`）✓✓ |

## 诚实边界（falsification 附录素材）

- **VB003 fixture 无独立内容锚**：goal-prompt.md 只记了两集合的 taskSetHash（id 级）；VB003 的内容级 hash 未被冻结记录。缓解：importer 已被 V 批证明字节级确定 + HF 数据集内容离线缓存不变 → VB003 内容漂移概率极低，但无法像 V 批那样精确证明。
- **锚是 16 hex 截断**（64 bit）：碰撞概率可忽略，但非全量比对。
- **specs/206 锚文件缺失是流程债**：FR-011 要求的"清单+锚入库"没做全（只散在 goal-prompt.md）。本次把池清单 + 全部锚固化进 `pool-11.json`（tracked），补上这笔债。
- 校准批当时 driver = **claude-sonnet-4-6**（`DEFAULT_DRIVER_MODEL`，F206 validate/pool 链同源）——headline 复测沿用同 driver 保口径；A/B（cohort-batch 链）沿用其 manifest 默认 claude-opus-4-7（F176/188 epoch 口径），两链不互比（C1 红线）。

## 复测口径钉死

- headline = **c3 × 11 task × N=3 = 33 run**（c1/c5/c4 引用既有数据不重测，与任务描述"全池 33 run"一致）。
- runner 链 = F206 同款：`eval-task-runner`（--tool spec-driver-spectra-mcp + --swebench-oracle）经 `ParallelRunPool`；oracle 语义 T0 后冻结零改动。
- F208 enforcement：评测 cwd 无 fix-compliance 配置 → 默认 `block`（208 spec W-1/FR-015），worktree plugin 代码 = master 4d1fb05（含 F208）。
