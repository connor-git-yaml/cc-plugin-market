---
feature: F5 Reading UX
branch: 132-reading-ux
phase: implement
subphase: step-5-risk-regression
created: 2026-04-20
---

# F5 R1-R7 风险回归验证 Checklist（T-046）

## 验证策略说明

- **代码级审查**：通过 grep + 代码阅读验证实现存在
- **单测级验证**：通过已通过的单元测试验证行为
- **[E2E_DEFERRED]**：需要 Anthropic API Key 的真实 E2E 验证，当前环境不可用

---

## R1：BFS < 3 节点降级到纯 RAG（FR-014 / SC-007）

| 项目 | 状态 | 验证方式 |
|------|------|---------|
| BFS 命中 < 3 节点时 `fallbackMode = 'rag-only'` | ✅ 通过 | 单测：`graph-retriever.test.ts`（"BFS 命中 2 个节点时应设 fallbackMode = rag-only"）|
| BFS 命中 0 个节点时 `fallbackMode = 'rag-only'` | ✅ 通过 | 单测：`graph-retriever.test.ts`（"BFS 命中 0 个节点时应设 fallbackMode = rag-only"）|
| 恰好 3 个节点时 `fallbackMode` 为 undefined | ✅ 通过 | 单测：`graph-retriever.test.ts`（"BFS 恰好命中 3 个节点时 fallbackMode 应为 undefined"）|
| `rag-only` 时 `rag-reranker` 仍正常运行 | ✅ 通过 | 单测：`rag-reranker.test.ts` |

**结论：R1 验证通过（单测级）**

---

## R2：embedding provider 首次加载 + singleton 复用（R2 缓解：避免重复加载 100MB 模型）

| 项目 | 状态 | 验证方式 |
|------|------|---------|
| embedding provider 模块级 singleton 实现存在 | ✅ 通过 | 代码审查：`rag-reranker.ts` L53-76，`let _cachedProvider: EmbeddingProvider \| null = null`，`if (!_cachedProvider)` |
| embedding 加载失败时降级为 `bfs-only` | ✅ 通过 | 单测：`rag-reranker.test.ts`（"embedding 加载失败时降级为 bfs-only"）|
| singleton 跨调用复用（第二次不重新 new） | ✅ 通过 | 代码审查：`getOrCreateEmbeddingProvider()` 实现，缓存检查在 L65 |

**结论：R2 验证通过（代码审查 + 单测级）**

---

## R3：Hyperedge 召回稳定性（prompt 显式列候选）

| 项目 | 状态 | 验证方式 |
|------|------|---------|
| prompt 显式包含 hyperedge 候选列表 | ✅ 通过 | 代码审查：`prompt-builder.ts` L165-168，`formatHyperedgeCandidates(graphCtx.hyperedges)` |
| `formatHyperedgeCandidates` 函数实现存在 | ✅ 通过 | 代码审查：`prompt-builder.ts` L80-89 |
| prompt 中 hyperedge 候选列表格式正确（含 label + rationale） | ✅ 通过 | 单测：`prompt-builder.test.ts`（hyperedge 候选列表存在断言）|
| `[graph hyperedge]` specPath 格式 citation 正确处理 | ✅ 通过 | 单测：`citation.test.ts`（hyperedge citation 格式验证）|

**结论：R3 验证通过（代码审查 + 单测级）**

---

## R4：graph.html 力导向阈值（Q3 锁定：≥ 2000 节点切静态模式）

| 项目 | 状态 | 验证方式 |
|------|------|---------|
| `FORCE_THRESHOLD = 2000` 常量存在 | ✅ 通过 | 代码审查：`html-template.ts` L22，`const FORCE_THRESHOLD = 2000` |
| `isLarge = nodes.length >= FORCE_THRESHOLD` 逻辑 | ✅ 通过 | 代码审查：`html-template.ts` L683 |
| 节点数 ≥ 2000 时不调用 forceSimulation | ✅ 通过 | 单测：`html-template.test.ts`（"≥ 2000 节点应生成静态坐标布局"）|
| 大图横幅元素存在 | ✅ 通过 | 单测：`html-template.test.ts`（`large-graph-banner` 断言）|
| 500-2000 节点区间额外调参 | ✅ 通过 | 代码审查：`html-template.ts` L712，`alphaDecay` + `strength` 设置 |

**结论：R4 验证通过（代码审查 + 单测级）**

---

## R5：reading 模式性能收益（冷 < 300s / 热 < 60s）

| 项目 | 状态 | 验证方式 |
|------|------|---------|
| reading 模式跳过 5 个产品文档 generator | ✅ 通过 | 单测：`batch-project-docs.test.ts`（`READING_SKIP_IDS` 断言）|
| reading 模式跳过 Coverage Audit | ✅ 通过 | 代码审查：`batch-orchestrator.ts` L998-1000 |
| reading 模式跳过 Docs Bundle | ✅ 通过 | 代码审查：`batch-orchestrator.ts` L1042-1044 |
| 冷启动 < 300s 实测 | [E2E_DEFERRED] | 需 API Key + graphify 项目真实运行 |
| 热启动 < 60s 实测 | [E2E_DEFERRED] | 需 API Key + graphify 项目真实运行 |

**结论：R5 代码级实现验证通过；性能实测 [E2E_DEFERRED]（verify 阶段执行）**

---

## R6：Citation 定位准确性（specPath + lineRange + excerpt 三字段有效）

| 项目 | 状态 | 验证方式 |
|------|------|---------|
| Citation 三字段（specPath/lineRange/excerpt）必填 | ✅ 通过 | 单测：`citation.test.ts`（三字段格式断言）|
| lineRange 越界时跳过并记录 warn | ✅ 通过 | 单测：`citation.test.ts`（"lineRange 越界时应跳过并记录 warn"）|
| 集成测试中 5 类问题 100% 包含 Citation | ✅ 通过 | 单测：`qa-integration.test.ts`（10 条测试全绿）|
| specPath 在实际文件系统可定位 | [E2E_DEFERRED] | 需真实项目文件系统验证 |

**结论：R6 Citation 结构验证通过；实际文件定位精度 [E2E_DEFERRED]**

---

## R7：graph.html 体积超 5 MB 输出 warn（FR-024）

| 项目 | 状态 | 验证方式 |
|------|------|---------|
| `DEFAULT_FILE_SIZE_WARN_BYTES = 5 * 1024 * 1024` 常量存在 | ✅ 通过 | 代码审查：`html-template.ts` L24 |
| 体积超阈值时输出 `[warn] graph.html 预估体积 X MB 超过 Y MB 阈值` | ✅ 通过 | 代码审查：`html-template.ts` L47-49 |
| warn 不阻断生成流程 | ✅ 通过 | 代码审查：warn 后继续返回 HTML，无 throw |
| 单测：体积超 5MB 有 warn 断言 | ✅ 通过 | 单测：`html-template.test.ts`（R7 体积警告断言）|
| 零 CDN 引用（F-007 修复）| ✅ 通过 | 代码审查：`html-template.ts` 文档注释"零外部 CDN 引用"；单测零 CDN 断言 |

**结论：R7 验证通过（代码审查 + 单测级）**

---

## 综合验证状态

| 风险 | 状态 | DEFERRED 项 |
|------|------|------------|
| R1（BFS 降级） | ✅ 通过（单测级） | 无 |
| R2（embedding singleton） | ✅ 通过（代码审查 + 单测） | 无 |
| R3（hyperedge 召回） | ✅ 通过（代码审查 + 单测） | 无 |
| R4（力导向阈值 2000） | ✅ 通过（代码审查 + 单测） | 无 |
| R5（性能收益） | 部分通过（代码级）| 冷/热启动实测 [E2E_DEFERRED] |
| R6（Citation 定位） | 部分通过（结构级）| 文件定位精度 [E2E_DEFERRED] |
| R7（html 体积 warn） | ✅ 通过（代码审查 + 单测） | 无 |

**7 条风险中，5 条已完整验证，2 条有代码级验证 + E2E_DEFERRED 标记。**

## DEFERRED 清单（需 verify 阶段执行）

| 项目 | 风险 | verify 阶段操作 |
|------|------|---------------|
| 冷启动 < 300s | R5 | 使用 API Key 对 graphify 示例项目运行 `--mode=reading` |
| 热启动 < 60s | R5 | 同上，连续运行两次测量热启动 |
| Citation specPath 文件定位精度 | R6 | 对真实项目问答后，验证返回的 specPath 可 `fs.readFileSync` 读取 |
| Hyperedge Citation 真实精度 | R3+R6 | 对含 F4 hyperedge 的项目运行问答，验证 `[graph hyperedge]` citation 有意义 |
