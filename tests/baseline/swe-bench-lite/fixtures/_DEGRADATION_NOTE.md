# SWE-Bench Lite Fixture Import — 降级记录

## 概要

T-021 fixture 导入触发日期阈值降级。spec.md FR-A-003 / EC-7 / CON-2 要求所有 fixture
`createdAt` ≥ `2024-01-01`（fallback `2023-07-01`），但 SWE-Bench Lite 数据集本身
最新 issue 的 `created_at` 上限不超过 ~2023-06（数据集发布时间限制）。

## 降级路径

- 严格阈值：`2024-01-01` → 候选数不足 5
- 退化阈值：`2023-07-01` → 候选数仍不足
- **最终采用**：放弃日期阈值，按 `created_at` 降序取最新 10 个候选

## 实际 appliedThreshold

`2023-06-29-dataset-max`

## 降级原因

`fallback-2023-07-01-yielded-0-below-min-5; further-degraded-to-dataset-max-date`

## 训练集泄漏风险增量评估

Claude（截至训练集 cutoff）大概率覆盖 ≤ 2023-06 的 sympy / astropy / pytest commit
diff。本批 fixture 不能用于"clean held-out"的统计声明；§6.4 结论 audit 中需明确：

1. Group A bare baseline 的 pass rate **可能虚高**（因模型可能记忆 goldPatch）
2. Grounding lift（C - A 差值）仍有信号意义：若 spec push / MCP pull 的提升
   显著，至少说明 grounding 在记忆基础上仍能贡献 incremental signal
3. 真正的 leakage-free 验证需要 SWE-Bench Verified（2024+）或自建 fixture

## 选定 repo 范围

astropy/astropy, pytest-dev/pytest, sympy/sympy

## 后续 mitigation

- 升级 SWE-Bench dataset 至 SWE-Bench Verified（待 dataset 发布）
- 自建 fixture：从 sympy/astropy 2024 后 PR 中手挑

> 本文件由 `scripts/swe-bench-fixture-import.py` 在触发降级时自动生成。
