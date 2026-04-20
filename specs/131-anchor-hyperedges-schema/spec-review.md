# Spec 合规审查报告

**Feature**: F4 Anchor — 函数级语义锚定 + Hyperedges + graph.json schema v2.0
**审查日期**: 2026-04-20
**分支**: `131-anchor-hyperedges-schema`
**审查范围**: 26 FR / 12 AC / 6 clarify 决议 / 5 Out-of-Scope 项 / 读写边界约束

## 摘要

| 维度 | 数量 |
|------|------|
| FR 通过（已实现） | 24/26 |
| FR 部分实现 | 1（FR-006 WARNING） |
| FR 未实现 | 0 |
| FR 可选豁免 | 1（FR-025 INFO） |
| AC 通过 | 10/12 |
| AC 警告 | 1（AC-001） |
| AC 待人工 | 1（AC-003） |
| clarify 决议落地 | 6/6 |
| CRITICAL | 0 |
| WARNING | 2 |
| INFO | 1 |

## 关键发现

### W-001：FR-006 / AC-001 — `graph-builder.ts` 运行态 schemaVersion 仍为 '1.0'

**证据**：`src/panoramic/graph/graph-builder.ts:351` 硬编码 `schemaVersion: '1.0'`；实际运行输出不会写 '2.0'。

**影响**：AC-001（"批处理后 graph.json schemaVersion 为 '2.0'"）无法在运行时满足。

**修复**：`schemaVersion: '2.0'`，或根据是否含语义边/hyperedges 动态选择。

### W-002：AC-003 人工验证待执行

标注为"交付后人工"，非代码问题。

### I-001：FR-025（可选）

`graph_community` 未追加 `hyperedgesInvolving` 字段；tasks.md 明确延后 Polish 阶段。

## clarify 6 决议落地

| Q | 决议 | 状态 | 证据 |
|---|------|------|------|
| Q1 rationale_for 仅 LLM | ✓ | `edge-builder.ts` 仅生成 references / conceptually_related_to |
| Q2 evidenceSource repo-relative | ✓ | `chunker.ts:396-401` toRepoRelative 处理 |
| Q3 hyperedge 混合 ≥1 代码节点 | ✓ | `extractor.ts:208-220` codeNodeIdSet 校验 |
| Q4 阈值 >= threshold | ✓ | `similarity.ts:95` |
| Q5 EXTRACTED/INFERRED/AMBIGUOUS | ✓ | 代码库内无 CONFIRMED/SPECULATIVE |
| Q6 feature flag 双入口 | ✓ | `doc-graph-builder.ts` 读 env+CLI → extractor 接 boolean |

## 读写边界验证

| 边界 | 状态 |
|------|------|
| src/spec-store/ 只读 | ✓ 合规 |
| specs/project/technical-debt.md 禁止 | ✓ 合规 |
| src/debt-scanner/ 禁止 | ✓ 合规 |
| plugins/spec-driver/ 禁止 | ✓ 合规 |
| F1 BudgetGate 兼容 | ✓ tokenUsage 格式合规 |

## 建议

**有条件通过**：修复 W-001（`graph-builder.ts:351` 的 schemaVersion 运行态写入）后进入 verify。其他均合规。
