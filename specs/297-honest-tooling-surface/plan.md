# 实施计划：P1-I 诚实工具面（M11 卡 A）

## Constitution Check

原则 VIII：`/goal` 授权下主线程直接实现，制品最小集。引用的 FR-001 ~ FR-008 全部登记在矩阵。返回面契约先行（`contracts/` 先于 `src/mcp/**`）。

## FR → Phase 覆盖矩阵

| FR | 类别 | Phase | 落点 |
|---|---|---|---|
| FR-001 | 实现型 | A | `src/knowledge-graph/call-resolution-labels.ts`、`call-resolver.ts`、`receiver-type-resolution.ts`、`contracts/mcp-return-surface-contract.yaml` |
| FR-002 | 实现型 | A | `src/panoramic/graph/graph-builder.ts`、`graph-types.ts` |
| FR-003 | 实现型 | B | `src/knowledge-graph/query-helpers.ts`（`edgeProvenance`）、`src/mcp/agent-context-tools.ts` |
| FR-004 | 实现型 | B | `query-helpers.ts`、`agent-context-tools.ts`、描述文案 |
| FR-005 | 实现型 | B | `src/mcp/lib/tool-response.ts`、`src/mcp/graph-tools.ts` |
| FR-006 | 实现型 | C | `tests/unit/mcp/tools-list-order.test.ts`、`tests/e2e/feature-180-graph-tools.e2e.test.ts` |
| FR-007 | 实现型 | C | `feature-180` e2e T-003-D3 |
| FR-008 | 实现型 | D | `scratchpad/cardA-ab/run-ab.sh`（一次性重算器，不入库；结果见 verification） |

## 裁剪登记

无。

## 设计决策

- `resolution` 只取词表 strategy 重算 stage / basis（`canonicalResolution`）：旧 producer / 手改 graph.json 的自相矛盾三元组不透传。
- 同 key 多边合并：`resolution` 取首条（与置信度 first-wins 同步），`callSites` 合并全部（排序去重 cap 20，`callSiteCount` 全量）。
- `tokenBudget.payloadBytes` 按附加本字段之前的文本计（否则自指），本字段自身 ~100 字节不计；超 cap 无可截断 key 时如实报超限。
- `matchScore` 改名而非并存：并存会让消费方继续读旧键。
- 数字分支至少含一位数字（不改本卡）；`tools/list` 顺序 = 注册顺序（未改为字母序，改序是行为变化）。
