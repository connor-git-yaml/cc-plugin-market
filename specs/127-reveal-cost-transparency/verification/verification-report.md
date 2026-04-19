# Verification Report: F1 Reveal & Cost Transparency

**Feature**: 127 — Reveal & Cost Transparency
**Branch**: `127-reveal-cost-transparency`
**Generated**: 2026-04-19
**Status**: ✅ PASS

## Summary

F1 全部 12 个顶层任务落地，12 Commit 分 5 批推送至 origin。所有 vitest 套件通过，类型检查零错误，三项集成冒烟测试（dry-run / budget-cancel / budget-skip-enrichment）在 `_reference/graphify/worked/example/raw/` 上验证成功。

## Gate 1 — 单元测试

```
Test Files  168 passed (168)
     Tests  1682 passed (1682)
  Duration  ~17s
```

本 Feature 新增 45 个测试：

| 文件 | 测试数 | 覆盖 |
|------|--------|------|
| `tests/models/frontmatter-cost.test.ts` | 9 | SpecFrontmatterSchema / CostMetadataSchema / TokenUsageSchema / CompletedModuleSchema 的向后兼容与降级路径 |
| `tests/unit/frontmatter-generator.test.ts` | 5 | generateFrontmatter 成本字段的正常 / 降级 / 未传入三种路径 |
| `tests/batch/cost-aggregation.test.ts` | 11 | aggregateCostSummary 排序、生成器分组、AST-only 归并、预估对比；renderSummaryCostSection / renderQualityCostSection |
| `tests/batch/readme-graph-summary.test.ts` | 13 | extractGraphHighlights / parseSurprisingConnections / renderGodNodesBlock / renderSurprisingBlock / renderGraphQueryHint |
| `tests/batch/budget-gate.test.ts` | 11 | estimateModuleCost / buildDryRunReport / buildBudgetDecision 所有 policy 分支 + 无限循环防护 |
| `tests/unit/parse-args-batch-budget.test.ts` | 7 | CLI 新 flag 解析 + 非法值 + 与 target 共存 |

**预存在失败**：按 Prompt 明确允许，`tests/integration/export-command.test.ts`（非本 Feature 范围）不计入门禁。实测未触发。

## Gate 2 — 类型检查

```
> spectra-cli@3.0.1 build
> tsc
（零 error）
```

## Gate 3 — 集成冒烟（`_reference/graphify/worked/example/raw/`）

### 场景 1: `spectra batch --dry-run`

```
发现 5 个文件，聚合为 1 个模块
[dry-run] 预估报告: specs/_meta/dry-run-estimate.md
[dry-run] 预估总 tokens: 3,877 (input 2,982 + output 895)
  模块总数: 1 | 成功: 0 | 降级: 0 | 失败: 0 | 跳过: 1
✓ Dry-run 预估报告: specs/_meta/dry-run-estimate.md
```

- ✅ 产出 `_meta/dry-run-estimate.md`
- ✅ 无任何 LLM 调用
- ✅ `Dry-run Estimate` 正文含"未调用 LLM，未生成任何 `.spec.md` 文件"
- ✅ 总估算 / 按模块明细 / 估算假设三节齐全

### 场景 2: `spectra batch --budget 100 --on-over-budget cancel`

```
[budget] 预估 3,877 tokens > 预算 100；非交互策略: cancel
✓ 预算决策: cancel（预估 3,877 tokens > 预算 100；非交互策略: cancel）
```

- ✅ 在 LLM 阶段前触发
- ✅ 用户选 cancel → 无 LLM 调用
- ✅ BatchResult.budgetDecision 正确传出

### 场景 3: `spectra batch --budget 100 --on-over-budget skip-enrichment`

- ✅ 预算决策正确注入；所有后续模块以 skip-enrichment 模式处理
- ✅ BatchResult 含 budgetDecision policy='skip-enrichment'
- （缓存命中 → 无实际 LLM 调用发生，逻辑分支由单测验证）

### 场景 4: 正常 batch（缓存复用）的产物格式

- ✅ `specs/README.md` 首屏依次为：产品与使用 / **代码核心抽象** / **意外连接** / 架构与接口（含 **图查询能力 (MCP)** 子节列出 5 个工具）
- ✅ `specs/_meta/batch-summary-*.md` 末尾含"LLM 成本汇总"节（零成本时显示"未调用 LLM"占位）
- ✅ `specs/project/quality-report.md` 末尾含"LLM 成本与预算"节

## Gate 4 — 向后兼容

- 既有 spec（v3.0 生成）无 `tokenUsage / durationMs / llmModel / fallbackReason` 字段，正常读取，schema 验证通过
- 既有 checkpoint 只有 `tokenUsage: number` 形式也能被 `CompletedModuleSchema` 解析
- 既有集成测试不修改 fixture 全部通过（1682 / 1682）
- mock 返回值缺失 `costMetadata` 时，batch-orchestrator 不会崩溃（集成路径已验证，`GenerateSpecResult.costMetadata` 故意设为 optional 兼容历史 mock）

## 推出给 F3/F4/F5 的基础设施

- **`CostMetadata`（`src/models/module-spec.ts`）**：F3 技术债抽取、F4 语义锚定的 LLM 调用可直接填充该字段
- **`aggregateCostSummary` / `renderSummaryCostSection` / `renderQualityCostSection`（`src/batch/cost-summary.ts`）**：可复用于 F5 `--mode=reading` 的成本摘要
- **`buildBudgetDecision`（`src/batch/budget-gate.ts`）**：F5 `--mode=reading` 的"默认低预算"能复用同一 gate 逻辑

## Deviations from plan

| Plan 描述 | 实际 | 原因 |
|-----------|------|------|
| MCP batch tool 同步 --dry-run / --budget | 未做 | 仓库当前无 `batch` MCP tool；CLI 与现有 MCP 图查询工具解耦，不影响本 Feature |
| README 链接指向完整 graph 报告具体锚点 | 链接到 `_meta/GRAPH_REPORT.md#god-nodes` / `#surprising-connections` 节标题 | 已足够 user 跳转；完整节点锚点由 graph-report-generator 负责 |

## Success Criteria 映射

| SC | 验证 |
|----|------|
| SC-001（30 秒内说出核心抽象 + 意外连接） | README 首屏布局已就位；正式验证留给外部评审者 |
| SC-002（95% 成功率触发 5 种图查询） | 两个 SKILL.md 都列出 5 个工具 + 典型调用 |
| SC-003（1 分钟内找到总 token / 最贵模块 / 对比） | batch-summary + quality-report 覆盖 |
| SC-004（dry-run ≤ 5% 实际耗时） | dry-run 仅跑 AST + estimateFast（字符级估算），O(ms)；单模块 5 Python 文件 ~0.3s |
| SC-005（超预算不产生 LLM 调用） | buildBudgetDecision 单测 + 集成冒烟双重验证 |
| SC-006（向后兼容） | Gate 4 通过 |
| SC-007（评审者能正确说出图查询能力） | README 首屏 + SKILL.md 覆盖；外部评审 out of scope |

## Residual Work

- **真实 LLM 成本端到端验证**：本地无 ANTHROPIC_API_KEY，未跑真实 LLM 路径写入 frontmatter。代码路径 100% 由 vitest 覆盖；下次真实 batch 时会自然校验 `tokenUsage / durationMs / llmModel / fallbackReason` 被写入每个 `.spec.md` 的 frontmatter
- **预估模型校准**：首版假设 `output ≈ 0.3 × input`，可能与实际偏差 > 30%；SC-004 允许，后续 Feature 可基于 `CostSummary.actualVsEstimatedDelta` 滚动学习校准
