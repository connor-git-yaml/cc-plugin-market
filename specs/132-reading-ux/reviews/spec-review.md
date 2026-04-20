---
feature: F5 Reading UX
branch: 132-reading-ux
phase: spec-review
created: 2026-04-20
verdict: WITH RESERVATIONS
reviewer: spec-review
---

# F5 Reading UX — Spec 合规审查

## 摘要

- **FR**：24 条 → 21 ✅ / 3 ⚠️ 部分（87.5% 完整）
- **SC**：7 条 → 1 完整代码级 / 4 DEFERRED / 2 部分
- **Risk**：R1-R7 → 5 完整 / 1 部分 / 1 DEFERRED
- 无 CRITICAL，但 4 个 WARNING 级问题在合并前建议处理

## FR 追溯（关键项）

| FR | 状态 | 证据 |
|----|------|------|
| FR-001~FR-007 (mode dispatcher) | ✅ | parse-args.ts / batch-orchestrator.ts / batch-project-docs.ts / mcp/server.ts |
| FR-008 性能 | ⚠️ DEFERRED | 代码层跳过已实现；实测数值缺 API key |
| FR-009~FR-017 (问答 pipeline) | ✅ | qa/ 8 文件 + MCP natural-language 路由 |
| FR-012 100% Citation | ⚠️ 部分 | LLM 空 citations 且 pre-built 也空时无拒绝机制（极端场景，见 W-004）|
| FR-014 BFS<3 降级 | ⚠️ 部分 | 一级降级 OK；二级（RAG 也空时）无"图谱数据不足"return 分支（W-002）|
| FR-018~FR-022 graph.html | ✅ | html-template.ts + D3 + 2000 阈值 |
| FR-023 大图日志 warn | ⚠️ 部分 | 横幅 ✅；**服务端 `[warn] graph node count exceeds 2000 …` log 缺失**（W-001）|
| FR-024 5MB warn | ✅ | batch-orchestrator.ts + html-template.ts |

## SC 验证状态

| SC | 状态 | 说明 |
|----|------|------|
| SC-001 | DEFERRED | 冷 < 300s / 热 < 60s，需 API key |
| SC-002 | DEFERRED | mock 结构验证通过；真实 LLM 质量需 E2E |
| SC-003 | MANUAL | 浏览器 35 项 checklist |
| SC-004 | ⚠️ DEFERRED + 语义偏差 | `[graph hyperedge]` 虚拟 specPath 与 spec 要求"指向 spec.md 中 `[conceptually_related_to]` 区块"字面不符（W-003，建议澄清 spec 允许等价 excerpt） |
| SC-005 | MANUAL | 浏览器 click-jump 行为 |
| SC-006 | ✅ 代码审查 | 唯一 LLM 调用 `llm-caller.ts`，必经 `runBudgetGate` |
| SC-007 | ⚠️ 部分 | BFS<3 一级降级单测通过；二级降级提示未验证（W-002 关联）|

## Risk R1-R7

- R1 BFS<3：一级 ✅ / 二级 ⚠️（W-002）
- R2 embedding singleton：✅（低风险 race，P1-3 建议改为 Promise 缓存）
- R3 hyperedge label 候选：✅
- R4 force layout 2000：✅
- R5 reading 性能：DEFERRED
- R6 Citation 漂移：✅ 结构级；DEFERRED 定位精度
- R7 体积 warn：✅

## Out of Scope 合规

- GraphQL / 多轮 / 实时协同 / 流式：无代码 ✅
- plugins/spec-driver/：`git diff master..HEAD -- plugins/spec-driver/` 空 ✅

## 决策一致性

- Q1/Q2/Q3 spec/plan/tasks 数值三层一致 ✅
- Q1 实测数字 DEFERRED

## WARNING 修复清单

| ID | 问题 | 修复 |
|----|------|------|
| W-001 | FR-023 服务端 log 缺失 | batch-orchestrator.ts 调用 buildHtmlTemplate 前检测 nodes.length ≥ 2000 时 logger.warn |
| W-002 | FR-014 二级降级缺失 | qa/index.ts Step 3 后检查 rag-only fallback + 0 chunks，return "图谱数据不足"提示 |
| W-003 | SC-004 hyperedge specPath 语义偏差 | spec 层澄清：`[graph hyperedge]` + `he.rationale` 为 spec.md 中 `[conceptually_related_to]` 区块内容的等价引用（不修代码），或在 citation 层补充 sourceSpecPath 指向 hyperedge 原始文件 |
| W-004 | FR-012 citation 兜底 | qa/index.ts finalCitations.length === 0 时在 answer 前加"[注意：无引用，图谱数据不足]" |

## DEFERRED 清单（6 项）

SC-001 / SC-002 真实质量 / SC-004 真实 / SC-003 / SC-005 浏览器 / Citation 文件系统定位精度 → verify 阶段需 API key + 浏览器

## 结论

**PASS WITH RESERVATIONS**。4 WARNING 在 Phase 7c 前应修 W-001 / W-002（影响 FR 字面合规）；W-003 澄清；W-004 可交付。
