# 代码质量审查报告

**Feature**: 131-anchor-hyperedges-schema
**审查基准**: 6 个功能 commit，1867 tests passed，build 零错误

## 总体评级：GOOD（A 级）

| 维度 | 评级 |
|------|------|
| 架构合理性 | GOOD |
| 设计模式合理性 | EXCELLENT |
| 安全性 | GOOD |
| 性能 | GOOD |
| 可读性 | EXCELLENT |
| 可维护性 | GOOD |

CRITICAL: 0 | WARNING: 5 | INFO: 4

## WARNING（必修/建议修）

### W-1 doc-graph-builder.ts 达 722 行（STRUCTURAL_DEBT）

建议在 F5 前把 `runAnchorIntegration` / `runHyperedgeIntegration` 拆到 `src/panoramic/builders/anchor-integration.ts`。**本轮不阻断**。

### W-2 extractor.ts:180 类型转型会 runtime crash

`new Error('JSON 解析失败') as unknown as z.ZodError`。调用方访问 `.issues` 会崩溃。

**修复**：`failedSamples.errors` 类型改为 `z.ZodError | Error`，或定义独立的失败结果类型。

### W-3 OpenAI vs Local Provider 计时 API 不一致

OpenAI Provider 用 `Date.now()`（毫秒整数），Local Provider 用 `performance.now()`（亚毫秒浮点）。同一字段精度不统一。

**修复**：统一为 `performance.now()`。

### W-4 DOC_NODE_KINDS 重复定义

`prompt.ts:22` 和 `extractor.ts:30` 两处相同常量 `['spec', 'document']`。

**修复**：提取到 `src/panoramic/hyperedges/constants.ts`。

### W-5 graph-tools.ts 工具编号顺序倒置

注释 "工具 6: graph_hyperedges"（line 212）在 "工具 5: graph_god_nodes"（line 289）之前。

**修复**：调换代码块顺序，使编号与顺序对应。

## INFO

- I-1 `extractModuleSpecMetadata` 为死代码（未导出、未被外部调用）
- I-2 `getSemanticEdges` 无索引（线性扫描）——大图性能隐患
- I-3 local-provider 缺并发加载测试
- I-4 local-provider 模块级 singleton 跨 test 共享状态（已有 `_resetPipelineForTest`，注释需强调）

## 正面发现

- `extractJsonArray` + fallback JSON.parse 双层容错
- Zod schema 与 TypeScript 接口三方一致
- EmbeddingProvider Open/Closed 友好
- direction-audit 白名单通过 `SEMANTIC_EDGE_RELATIONS` 共享合同
- 测试 mock 合理（injection 而非 module-level vi.mock）

## 建议

**必修（进入 verify 前）**：W-2 类型转型（会 crash）
**建议修（本 feature 内）**：W-3 / W-4（一致性 + 去重，改动小）
**可选**：W-1 / W-5 / INFO 项可规划到 F5

总体建议：修 W-2 + W-3 + W-4 后进入 verify。
