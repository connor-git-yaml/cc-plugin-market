# 数据模型：F170c

**Feature**：F170c — Spectra MCP Tool Description + Response 优化
**生成时间**：2026-05-28

---

## 新增实体

### TopImpacted

表示受影响节点的排名条目，用于 `impact` 和 `detect_changes` tool 的 response。

```typescript
interface TopImpacted {
  id: string;     // symbol 标识符，与 BfsAffected.id 对应
  score: number;  // 影响评分，= 1 / depth，范围 (0, 1]，按降序排列
}
```

**约束**：
- 数组长度 ∈ [0, 5]（`maxItems = 5`）
- 按 `score` 降序排列；同 score 时按 `id` 字母序升序（stable tiebreaker）
- producer 在 success 路径 MUST 总是产出此字段（即使为空数组）
- schema 侧声明为 optional（`topImpacted?: TopImpacted[]`），兼容旧 consumer

### TopRelevantCaller

表示 `context` tool 返回的关键调用方条目。

```typescript
interface TopRelevantCaller {
  id: string;          // symbol 标识符，与 collectNeighbors 返回的 id 对应
  confidence: number;  // 来自 graph edge 的 confidenceScore，范围 [0, 1]
  score: number;       // 排序分，当前 = confidence（distance=1 时的简化公式）
}
```

**约束**：
- 数组长度 ∈ [0, 3]（`maxItems = 3`）
- 按 `score` 降序排列；同 score 时按 `id` 字母序升序
- producer 在 success 路径 MUST 总是产出此字段
- schema 侧声明为 optional，兼容旧 consumer

### RiskTier（顶层字段 — 修订：响应 codex C-1，始终 mirror 嵌套）

`detect_changes` tool response 新增的顶层 `riskTier` 字段（值始终 = `riskSummary.riskTier`，浅 mirror 现有嵌套）。

```typescript
type RiskTier = 'low' | 'medium' | 'high';
```

**计算来源**：**不**独立计算。值始终等于现有 `riskSummary.riskTier`（由现状代码 `handleDetectChanges` 调用 `computeRiskTier(0, totalAffected)` 计算，agent-context-tools.ts:671）。

**enrichment degraded 行为**（修订）：顶层 `riskTier` **不**走 fallback "low"。理由：`riskSummary.riskTier` 是**主流程**计算（不属于 enrichment）；enrichment degraded 仅来自 ranking/hint 计算抛异常，此时 `riskSummary.riskTier` 仍是真实值，顶层 `riskTier` 继续 mirror 真实值即可。

| 路径 | 顶层 riskTier 行为 |
|------|-----------------|
| success | = `riskSummary.riskTier`（真实计算值） |
| enrichment degraded | = `riskSummary.riskTier`（仍真实，主流程未受影响） |
| handler error | 不出现（按 FR-013） |

**与 spec Tool×Path 矩阵的偏差记录**：spec degraded 列写 `riskTier: "low"` fallback；本 plan 不实施此 fallback（mirror 更安全）。此偏差不触发 spec amendment，因 mirror 在 producer/consumer 合同下语义更严格（参见 `plan.md` D 节修订）。

**注意**：此顶层 `riskTier` 与 `riskSummary.riskTier`（原有嵌套字段）值始终相同，两者并存，不互相替代（FR-012 要求原有字段保留不变）。

---

## 新增标志字段

### _enrichmentDegraded

response 顶层 optional flag，当主流程成功但 enrichment 计算抛异常时标注为 `true`。

```typescript
_enrichmentDegraded?: true;  // 仅 degraded 路径存在，其他路径缺失
```

**语义**：
- 缺失（success 路径）：所有 M7 新字段为真实计算值
- `true`（enrichment degraded 路径）：M7 新字段为 fallback 值，主流程数据（`affected` / `changedSymbols` 等）仍可信
- **不出现于** handler error 路径（FR-013）

---

## Tool × Path 字段矩阵（数据流向）

| Tool | success 路径新增字段（producer MUST 产出） | enrichment degraded fallback | handler error（不新增字段） |
|------|------------------------------------------|------------------------------|---------------------------|
| `impact` | `topImpacted: TopImpacted[]`（≤5）、`nextStepHint: string`（≥5 字符）、`_enrichmentDegraded` 缺失 | `topImpacted: []`、`nextStepHint: ""`、`_enrichmentDegraded: true` | 按升级前格式 |
| `detect_changes` | `riskTier: RiskTier`（mirror `riskSummary.riskTier`）、`topImpacted: TopImpacted[]`（≤5）、`nextStepHint: string`（≥5 字符）、`_enrichmentDegraded` 缺失 | `riskTier: <mirror 真实值>`（不走 "low" fallback）、`topImpacted: []`、`nextStepHint: ""`、`_enrichmentDegraded: true` | 按升级前格式 |
| `context` | `topRelevantCallers: TopRelevantCaller[]`（≤3）、`nextStepHint: string`（≥5 字符）、`_enrichmentDegraded` 缺失 | `topRelevantCallers: []`、`nextStepHint: ""`、`_enrichmentDegraded: true` | 按升级前格式 |

**字段所有权**（严禁跨 tool 污染）：
- `riskTier`（顶层）：仅属于 `detect_changes`，不出现在 `impact` 或 `context`
- `topImpacted`：属于 `impact` 和 `detect_changes`，不属于 `context`
- `topRelevantCallers`：仅属于 `context`
- `nextStepHint` 和 `_enrichmentDegraded`：全部 3 个 tool

---

## 现有字段保留（FR-012 约束）

以下现有字段的数据结构、字段名、类型、嵌套层级**完全不变**：

| Tool | 保留字段 |
|------|---------|
| `impact` | `affected`、`summary`（含 `summary.riskTier`）、`effectiveDepth`、`effectiveBudget`、`effectiveMinConfidence`、`effectiveDirection`、`warnings` |
| `detect_changes` | `changedSymbols`、`affectedSymbols`、`riskSummary`（含 `riskSummary.riskTier`）、`unmappedFiles`、`effectiveBudget`、`effectiveDepth`、`effectiveMinConfidence`、`warnings` |
| `context` | `definition`、`callers`、`callees`、`imports`、`relatedSpec` |
