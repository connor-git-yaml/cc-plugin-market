# Feature 158 — SWE-Bench Grounding Lift Detail Report

**Generated**: 2026-05-09
**Stage**: dry-run 完成；Pass Rate / Token Cost 实测数据待 Stage 7b
**Parent**: [147 报告 §10](../147-competitor-evaluation-platform/competitive-evaluation-report.md#10-swe-bench-grounding-lift-实验feature-157)

---

## 1. 摘要

本 detail 报告是 Feature 158 SWE-Bench Grounding Lift 实验的 **per-run 明细 + 风险展开**，与 [147 报告 §10](../147-competitor-evaluation-platform/competitive-evaluation-report.md) executive summary 配套。两份文档的 Pass Rate 矩阵 / Token Cost 表数据由同一份脚本生成，必须保持一致。

**当前状态（2026-05-09）**：
- ✅ Spec/plan/tasks/checklist/analysis 设计文档完成（~3700 行，2 轮 Codex 对抗审查 + clarify + analyze pass）
- ✅ Telemetry hook 落地（`src/mcp/agent-context-tools.ts` writeTelemetry + recordAndReturn wrapper，4 状态单测全过）
- ✅ 评测主脚本完成（`scripts/eval-mcp-augmented.mjs` 542 行，3 group + dry-run + stop-loss）
- ✅ Oracle 退化匹配脚本完成（`scripts/eval-diff-fuzzy-match.mjs` multiset Jaccard，15 单测）
- ✅ 验收脚本完成（`scripts/verify-feature-158.mjs` 6 检查点 + verification-report 输出）
- ✅ Fixture 入库（10 个 SWE-Bench Lite Python task + 同名 .goldpatch.diff，含 `_DEGRADATION_NOTE.md`）
- ⏸ 待 Stage 7b：`npm run baseline:collect` for sympy/astropy/pytest（~25-35 min） + 实跑 ≥45 runs（~3-4h, ~$15-25 API 成本）

---

## 2. 数据集与降级声明

按 [147 §10.1 实验设计](../147-competitor-evaluation-platform/competitive-evaluation-report.md#101-实验设计)，本实验使用 SWE-Bench Lite Python 子集 10 个 fixture。

### 2.1 已触发的降级

详见 `tests/baseline/swe-bench-lite/fixtures/_DEGRADATION_NOTE.md`：

- **目标日期阈值** ≥ 2024-01-01 → **未达成**
- **fallback 阈值** ≥ 2023-07-01 → **未达成**
- **最终采用**：dataset-max 2023-06-29（HuggingFace SWE-Bench Lite 数据集自身上限），按 created_at 降序取最新 10 个，最旧 2022-09-16

### 2.2 训练集泄漏风险评估

| 风险维度 | 影响 | 缓解 |
|---------|------|------|
| Claude 训练集已包含部分 SWE-Bench Lite instance 的 patch | Group A pass rate **可能虚高** | 报告结论 §10.4 必须显式标注泄漏风险；Group A 数值仅作"参考下界" |
| Group B/C 同样可能借助训练集"记忆" | 三组都受影响，但相对 lift 仍可信 | 重点观察 Group C - Group A 的相对差，而非绝对值 |
| 未来需 SWE-Bench Verified（持有时间更新）做 clean held-out | 当前 SWE-Bench Lite 不含 2024+ 数据 | follow-up Feature；本 Feature 不解决 |

---

## 3. Per-Run 明细（待 Stage 7b 实跑后填入）

### 3.1 实验配置

```
fixture 总数: 10（SWE-L001 ~ L010）
对照组: A (bare) / B (spec-push) / C (mcp-pull)
重复: N=3 per (task, group)
预期总 runs: 90（10 task × 3 group × N=3）
stop-loss: $40 USD
oracle: ast-diff（默认）/ functional（P3 实测后部分升级）
```

### 3.2 单 run 详细结果（占位，Stage 7b 后由 `eval-report.mjs` 生成）

| Run ID | Group | Task | Repeat | Oracle Result | Wall (ms) | Cost (USD) | MCP Tool Calls | MCP Response Bytes | claudeCliVersion | specPushDegraded |
|--------|-------|------|--------|---------------|-----------|-----------|----------------|--------------------|--------------------|-------------------|
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

### 3.3 Group C 子分析：MCP tool 调用情况（FR-E-005 可选）

```
mcpToolCallCount = 0 的 run 数 / Group C 总 runs：<pending>
mcpToolCallCount > 0 的 run 数 / Group C 总 runs：<pending>
```

按 EC-2 处理：若 `mcpToolCallCount = 0` 占比高（如 > 50%），说明 mandatory tool use instruction 失效，需在 system prompt 加强引导；分析时区分"agent 实际使用 MCP" vs "agent 完全忽略"两种情况。

---

## 4. 风险展开分析

### 4.1 EC-3：Spectra graph 覆盖目标 repo（硬前置 P4）

| Repo | baseline:collect 状态 | graph.json 大小 | modules 数 | symbols 数 | spec.md 文件数 |
|------|----------------------|----------------|-----------|-----------|--------------|
| sympy/sympy | ⏸ 待 Stage 1 | <pending> | <pending> | <pending> | <pending> |
| astropy/astropy | ⏸ 待 Stage 1 | <pending> | <pending> | <pending> | <pending> |
| pytest-dev/pytest | ⏸ 待 Stage 1 | <pending> | <pending> | <pending> | <pending> |

若 baseline:collect 失败（如 sympy 因 C extension 太多解析失败）→ Group B `loadSpectraContextForSweBench` 返回 null，标 `specPushDegraded: true`。

### 4.2 EC-6：5-10 task 统计功效不足

10 task × N=3 = 30 runs / group，**bootstrap 95% CI** 宽度估计在 ±20-30% pass rate（基于 Beta(α, β) 后验近似）。任何 Group 间差异 < 15% 都不应宣称显著。报告结论必须遵守 spec FR-E-003 的边界标注。

### 4.3 EC-7：训练集泄漏

详见 §2.2。本批 fixture 全部为 2022-09 ~ 2023-06 时段，落入 Claude 训练集风险中-高。

### 4.4 EC-2：Group C agent 不调 MCP tool

mandatory tool use instruction 可能失效（agent 凭直觉跳过 grounding 直接修改）。已通过 telemetry JSONL `mcpToolCallCount` 记录实际调用次数，实测后必能区分"调过" vs "未调"。

### 4.5 训练集泄漏 + 降级双重影响

由于本批 fixture 已跨过两层降级（2024-01 → 2023-07 → dataset-max），结论必须双重限定：
1. 单条结论"探索性 pilot"（小样本）
2. 加注"训练集泄漏风险高，Group A 数值参考下界"

---

## 5. dry-run 验收数据（2026-05-09）

| 检查项 | 结果 |
|-------|------|
| `npm run build` | ✅ 退出码 0，TypeScript 零错误 |
| `npx vitest run` | ✅ 3484 passed / 3 skipped / 20 todo / **0 failed**（含 telemetry 4 状态矩阵 + fuzzy-match 15 cases） |
| `npm run repo:check` | ✅ 全部 pass |
| `node scripts/verify-feature-158.mjs` | ⏸ ①②③④ PASS（fixture 数量 / schema / dry-run 退出码 / SC-009a env var）；⑤⑥ 待本报告 + §10 章节落地后 PASS |
| `eval-mcp-augmented --group A/B/C --dry-run` | ✅ 三组全 0 退出码 |
| `eval-mcp-augmented --all-fixtures --group C --dry-run` | ✅ 10 fixture 全 0 退出码 |

---

## 6. 后续行动（Stage 7b — 用户实跑）

按 [Feature 158 plan.md](plan.md) §实施阶段：

```bash
# 前置：P3 / P4 / P5 完整验证
node scripts/verify-feature-158.mjs  # 必须 ①②③④ + ⑤⑥（本报告 + §10 完成）全 PASS

# Stage 1 baseline:collect（~25-35 min）
npm run baseline:collect -- --target sympy/sympy --mode full
npm run baseline:collect -- --target astropy/astropy --mode full
npm run baseline:collect -- --target pytest-dev/pytest --mode full

# Stage 7a Pilot（1 task × 3 group × N=1，~10 min，~$2）
node scripts/eval-mcp-augmented.mjs --group A --task SWE-L001-pytest-module-imported-twice-under --repeat 1
node scripts/eval-mcp-augmented.mjs --group B --task SWE-L001-pytest-module-imported-twice-under --repeat 1
node scripts/eval-mcp-augmented.mjs --group C --task SWE-L001-pytest-module-imported-twice-under --repeat 1

# Stage 7b 全量（10 task × 3 group × N=3 = 90 runs，~3-4h，~$15-25）
for task in $(ls tests/baseline/swe-bench-lite/fixtures/SWE-L*.json | xargs -n1 basename | sed 's/.json//'); do
  for group in A B C; do
    node scripts/eval-mcp-augmented.mjs --group $group --task $task --repeat 3 --stop-loss 40
  done
done

# 数据汇总 + 报告填入
node scripts/eval-report.mjs  # 生成 §10.2 矩阵 + §10.3 Token 表（auto）
# § 10.4 / 本报告 §3 / §4 由人工撰写并修订
```

---

## 7. 与 Feature 155 / 147 的关系

- **Feature 155**：本实验**直接验证对象**，3 个 MCP tool 由 155 实现；本 Feature 在 Feature 155 已 ship 文件 `src/mcp/agent-context-tools.ts` 上加 telemetry hook（最小侵入，4 状态单测保证向后兼容）
- **Feature 147**：本实验是 **§10 子章节**，复用既有评测基础设施（worktree 协议、`prepareWorktree / runTask / runPrimaryOracle` import）；不污染 `eval-task-runner.mjs` 的 `SUPPORTED_TOOLS`

---

*本 detail 报告由 Feature 158 主编排器（Opus 4.7）于 2026-05-09 dry-run 阶段生成。Pass Rate / Token Cost 实测数据待 Stage 7b 实跑后填入；§10.4 结论 + §3 per-run 明细 + §4 风险展开由用户实测后人工修订。*
