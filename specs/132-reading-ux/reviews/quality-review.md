---
feature: F5 Reading UX
branch: 132-reading-ux
phase: quality-review
created: 2026-04-20
verdict: WITH RESERVATIONS
reviewer: quality-review
---

# F5 Reading UX — 代码质量审查

## 摘要

整体架构清晰（7 步 pipeline）、类型覆盖到位、测试覆盖路径广。**主要问题**：
1. `qa/index.ts` 对 `injectDebtContext` 用 `undefined as unknown as` 类型欺骗
2. `qa/rag-reranker.ts` nodeVectors 全部使用 queryVector 代理，导致 chunk-node 相似度语义错误
3. `html-template.ts` Graham Scan `>= 0` 判断在共线点场景生成不完整凸包

## P1 重要（建议修复）

| # | 维度 | 位置 | 描述 | 修复 |
|---|------|------|------|------|
| P1-1 | 类型严格 | `qa/index.ts:197` | `undefined as unknown as ...` 欺骗 `injectDebtContext` registry 参数 | 改 `injectDebtContext` 签名为 `registry?: …` 可选；或 QnAOptions 暴露 registry |
| P1-2 | 语义错误 | `qa/rag-reranker.ts:150-163` | nodeVectors 全用 queryVector 代理，filterByThreshold 每个 chunk × 每个 bfsNode 计算完全相同相似度，rankedChunk.nodeId 与实际语义无关 | 改用 chunk-query 单一相似度排序 + nodeId 选最近 BFS 节点的 id |
| P1-3 | 并发 | `qa/rag-reranker.ts:57-69` | module 级 singleton 无并发保证（Node 单线程下低风险，但 createEmbeddingProvider 若引入 async 会破坏） | 改为 Promise 缓存：`let _initPromise: Promise<…> \| null` |
| P1-4 | 凸包 Bug | `html-template.ts:544` | Graham Scan `>= 0` 共线点退化为 < 3 hull 点，凸包渲染不完整 | 改为 `> 0`（保留共线点） |
| P1-5 | 测试 | `tests/panoramic/qa/rag-reranker.test.ts` | `getEmbeddingProvider()` 工厂抛错路径无测试（setEmbeddingProviderForTesting 绕过） | 新增 mock createEmbeddingProvider 抛错的测试用例，验证 fallbackMode='bfs-only' |
| P1-6 | 测试 | `tests/panoramic/html-template.test.ts` | 力导向阈值边界 1999/2000/2001 未单测（plan §8 要求） | 新增 3 条边界测试 |

## P2 次要（可交付后）

8 项（略）：querySelector CSS 转义 / 搜索 O(n²) / engineCache 无驱逐 / runBudgetGate 异常混合 / citation 文件不存在时 validateLineRange 放行 / graph-retriever.ts:73 `as` cast 弱类型 / index.test.ts 弱断言 / overBudget warn 缺 projectRoot

## 10 个维度评级

- 类型严格度：NEEDS_IMPROVEMENT（P1-1 类型欺骗 + P1-2 语义错误）
- 错误处理：GOOD
- 单元测试质量：中（弱断言 + 关键边界缺失 + 语义错误被测试掩盖）
- 命名可读性：GOOD
- F5 特定风险：P1-2 / P1-3 / P1-4 三项
- 性能：NEEDS_IMPROVEMENT（O(nodes × chunks) 重复计算 + 搜索 O(n²)）
- 兼容性：EXCELLENT（默认行为零改动）
- 可观测性：GOOD
- 安全：GOOD（querySelector CSS 转义小瑕疵）
- CLAUDE.md 规则：GOOD

## 总体结论

**WITH RESERVATIONS**

- P0: 0
- P1: 6（P1-2 / P1-4 影响 F5 核心差异化点，建议 Phase 7c 前修）
- P2: 8
- 测试覆盖评级：中
