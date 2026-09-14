# Feature Specification: P1-I 诚实工具面（M11 卡 A）

**Feature Branch**: `master`（`/goal` 授权下主线程直接实现；feature 模式制品按最小集补齐）
**Created**: 2026-09-15 · **Status**: shipped

## 背景

M10「诚实的图」只兑现一半：MCP 返回面缺图边解析 stage / 策略标签、`confidence` 在三套语义间漂移（边分数 / 节点标签 / fuzzy 匹配分）、无 tokenBudget、
`tools/list` 与 top-N 顺序无确定性回归、callers / callees 不带调用点行号（F277 账本 #22）。

## 用户场景

- US-1：agent 拿到 `context.callers[]` 时能区分「AST 索引直查」与「占位启发式」，并直接跳到调用点行。
- US-2：agent 看到 `confidence` 时知道它是数值分数，标签在 `confidenceLabel`，名字相似度在 `matchScore`，不再混读。
- US-3：agent 每次调用都知道 payload 多大、离上限多远、有没有被收缩。
- US-4：同一输入两次调用响应逐字节相同；`tools/list` 顺序有合同。

## 功能需求

- **FR-001**: calls 边带 `resolution { stage, strategy, basis }`（词表 `contracts/mcp-return-surface-contract.yaml` ↔ `src/knowledge-graph/call-resolution-labels.ts` 机械对拍）。
- **FR-002**: calls 边带 `callSites[]`（line / column，排序去重，cap 20）与 `callSiteCount`；同 (source, target) 多调用点在 graph-builder 合并。
- **FR-003**: `context.callers[] / callees[]`、`impact.affected[]`、`detect_changes.affectedSymbols[]`、`graph_node.neighbors[].edge` 透传 `confidenceLabel` / `resolution` / `callSites` / `callSiteCount`（图里没有的字段诚实缺席）。
- **FR-004**: 词表统一：`context.definition.confidence` → `confidenceLabel`；`fuzzyMatches[].confidence` → `matchScore`；`resolvedConfidence` → `resolvedMatchScore`（breaking，登记在合同 `breakingChanges`）。
- **FR-005**: 成功响应 envelope 带 `tokenBudget { payloadBytes, capBytes, estimatedTokens, truncated, truncatedKeys? }`（12 个工具：3 agent-context + 3 file-nav + 6 graph）。
- **FR-006**: `tools/list` 顺序钉进合同 `determinism.toolsListOrder`（单测按注册顺序逐位对拍；e2e 两次逐字节相同）；impact / context / graph_node 同输入两次响应逐字节相同（e2e）。
- **FR-007**: 每一项返回面变化有客户端侧（stdio 序列化后）可见性测试。
- **FR-008**: 外部语料 A/B（GORM / HikariCP 钉死 commit）：节点 id / 边多重集 / 准确率读数逐字不变，只多新字段。

## 回归护栏（裁决不变量）

F266 空图 fail-loud 与诚实 envelope 不回退；相似度命中永不进 impact / context（`matchScore < 0.9` 不 autoResolve 用例 H-6）；builder 戳只可见不判定（未触碰）。
