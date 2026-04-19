# Phase 0 研究决策记录：Harden — SpecStore Abstraction

**Feature Branch**: `128-harden-spec-store`
**研究日期**: 2026-04-19

---

## Decision 1：SpecStore 的设计边界

### 问题

`batch-orchestrator.ts` 在步骤 5/6 存在一个私有函数 `mergeIndexSpecs`（第 912-966 行），以及在第 639 行调用 `mergeIndexSpecs(collectedModuleSpecs, existingStoredSpecs, toProjectPath)` 的组合模式。`buildDocGraph`（第 643-648 行）接收 `collectedModuleSpecs` 和 `existingStoredSpecs` 两个独立参数。`CoverageAuditor`（第 742-753 行）接收已构建的 `docGraph`，不直接做合并。

核心问题：**合并逻辑分散在 orchestrator 内部，consumer 侧拿到的是已合并的视图（`docGraph.specs`），还是原始列表？**

### 决策

将 SpecStore 设计为**纯数据包装类**（不持久化、不扫描磁盘），在 `batch-orchestrator.ts` 的步骤 4 结束后实例化，构造时接收：
- `collectedModuleSpecs: ModuleSpec[]`（本次生成）
- `storedSpecs: StoredModuleSpecSummary[]`（已从磁盘扫描）
- `projectRoot: string`

对外暴露 4 个只读视图（见 data-model.md），替换现有 `mergeIndexSpecs` 的调用点以及 `buildDocGraph` 的双参数传递。

### 理由

- 不引入额外的磁盘 I/O 层（`scanStoredModuleSpecs` 已在 orchestrator 最早调用，第 297 行）
- 符合宪法原则 III（如无必要勿增实体）：不新建文件系统抽象，只做逻辑封装
- `mergeIndexSpecs` 已经是正确方向（Fix 127），SpecStore 只是将其升格为显式类型

### 替代方案及拒绝理由

| 替代方案 | 拒绝理由 |
|---|---|
| 在 SpecStore 内部调用 `scanStoredModuleSpecs`（自扫描） | 与现有磁盘扫描时机耦合，难以在测试中注入 |
| 通过 Singleton 在整个进程中共享 SpecStore 状态 | MCP Server 是长期进程，Singleton 状态在多次 batch 调用间会污染 |
| 将合并逻辑下移到 `DocGraphBuilder` | DocGraphBuilder 职责是构建图，不应兼管"所有已知 spec"的合并语义 |

---

## Decision 2：SpecStore 的放置位置

### 问题

应该新建 `src/spec-store/` 目录，还是放入现有目录？

### 决策

新建 `src/spec-store/index.ts`（主类） + `src/spec-store/spec-identity.ts`（identity 相关类型）。

不放入 `src/generator/` 或 `src/panoramic/`，因为 SpecStore 横跨 batch 层和 panoramic 层，属于独立概念层。

### 理由

- `src/generator/` 职责是渲染输出，不是查询状态
- `src/panoramic/` 是文档生成层，SpecStore 是基础数据层
- 独立目录边界清晰，符合宪法原则 III 对职责划分的要求

### 替代方案及拒绝理由

| 替代方案 | 拒绝理由 |
|---|---|
| `src/batch/spec-store.ts` | 与 orchestrator 同目录会造成循环依赖风险（orchestrator import spec-store，spec-store 又 import orchestrator 类型） |
| `src/panoramic/builders/spec-store.ts` | 过度依赖 panoramic 层，batch-readme-generator 和 index-generator 无需关心 panoramic 内部 |

---

## Decision 3：`sourceKind` 字段命名与命名约定

### 问题

spec.md 中使用的名称是 `source_kind`（snake_case），但现有 frontmatter schema 全部使用 camelCase（`sourceTarget`、`relatedFiles`、`skeletonHash`）。

### 决策

字段名统一使用 **camelCase**：`sourceKind`（而非 `source_kind`）。

### 理由

- 现有 `SpecFrontmatterSchema`（`src/models/module-spec.ts` 第 35-51 行）全部字段为 camelCase，保持一致性
- 手动解析器 `extractStoredModuleSpecSummary`（`doc-graph-builder.ts` 第 364-485 行）用字面量前缀匹配，混用风格会增加 bug 面
- spec.md 第 98 行提到 `souce_kind`（原文有拼写错误），作者意图是字段名，不限定 case

### 替代方案及拒绝理由

| 替代方案 | 拒绝理由 |
|---|---|
| `source_kind`（snake_case） | 与全文件 camelCase 约定冲突，需要在手动解析器中增加特殊分支 |
| `identity` 或 `specKind` | 不如 `sourceKind` 语义直接，且与 spec.md 描述不一致 |

---

## Decision 4：Dev 热重载机制选型

### 问题

MCP Server 是长期进程（`src/mcp/server.ts`），通过 `@modelcontextprotocol/sdk` 运行，调用 `runBatch` 等函数。ESM import cache 在 Node.js 进程内不可清除，导致每次修改源代码都需要 kill + restart。

可选方案：
1. **tsx watch**：`tsx --watch src/mcp/index.ts` 监听文件变化并重启进程
2. **child_process spawn**（子进程模式）：主进程保持 MCP 协议栈，子进程运行业务逻辑，变更时重启子进程
3. **自建 ESM loader**：通过 `--experimental-loader` 拦截 import，在每次调用前清除 cache

### 决策

选择**方案 1（tsx watch 模式）**：
- Dev 模式下通过 `SPECTRA_DEV=1` 或 `--dev` 标志启动时，`cli/commands/mcp-server.ts` 内部用 `child_process.spawn('tsx', ['--watch', ...])` 运行实际 MCP 进程
- 非 dev 模式下行为与现在完全一致
- CI 中通过 `SPECTRA_DEV=0`（默认）或不传 `--dev` 禁用

### 理由

- `tsx` 已是 devDependency（package.json 中用于 `npm run dev`），不增加新依赖
- tsx watch 能在文件变化时自动重启子进程，实测延迟 < 2 秒
- child_process 方案（方案 2）需要实现 IPC 协议转发，复杂度高，超出 P2 范围
- 自建 ESM loader（方案 3）在 Node 20 中仍是实验性 API，稳定性不足

### 约束

- dev 模式必须在 `src/cli/commands/mcp-server.ts` 中隔离，不得修改 `src/mcp/server.ts`（生产代码）
- 非 dev 模式 **0% 性能影响**（不启动任何 watcher）
- CI 环境通过 `process.env.CI === 'true'` 自动禁用（即使传了 `--dev`）

### 替代方案及拒绝理由

| 替代方案 | 拒绝理由 |
|---|---|
| child_process IPC 转发 | 需实现 MCP 协议帧转发，复杂度超出 P2 |
| nodemon | 需作为 devDependency，功能与 tsx watch 重叠，无必要引入 |
| 自建 ESM cache cleaner | Node 20 实验 API，且 MCP SDK 的 transport 层不支持无状态重加载 |

---

## Decision 5：依赖方向 Audit 算法选型

### 问题

需要一个工具能对 `graph.json`（NetworkX 格式）中的每条 `cross-module` 边做方向正确性判断。目前 graph 中边的 `source` 和 `target` 来自 `doc-graph-builder.ts` 的 `buildReferenceList`（第 227-276 行），该函数遍历 `dependencyGraph.edges`（AST import 分析结果）。

### 决策

**算法选型：基于 AST import 边的对比校验**（不做图结构反向推断）。

工具接收 `graph.json` 路径，同时接收 `dependencyGraph`（或从 `_meta/architecture-ir.json` 加载），对每条 `cross-module` 类型的边，查找 AST import 证据：
- `source → target` 方向有 import 证据 → 方向确认正确
- `source → target` 无证据但 `target → source` 有证据 → 方向确认错误
- 两方向均无直接 import 证据 → 方向可疑（由 LLM 语义推断产生）

输出 `DirectionAuditReport`（见 data-model.md）。

### 理由

- 图结构反向推断需要额外的图算法，在没有 ground truth 时结果不可靠
- AST import 是当前 Spectra 的 ground truth（宪法原则 V：AST 精确性优先）
- `dependency-cruiser` 已有 import 方向数据，直接复用

### 替代方案及拒绝理由

| 替代方案 | 拒绝理由 |
|---|---|
| 图结构拓扑反向推断 | 无 ground truth，对无 import 证据的项目会产生大量假阳性 |
| LLM 判断方向正确性 | 违反宪法原则 V（AST 精确性优先，LLM 不得产生结构化数据） |
| 人工审查 | 非自动化，不满足 SC-005（10 分钟自动跑完） |

---

## Decision 6：SpecIdentity 字段与 Frontmatter 集成方式

### 问题

F1（`127-reveal-cost-transparency`）也在修改 `SpecFrontmatterSchema`，加入 `tokenUsage`/`durationMs`/`llmModel`/`fallbackReason` 字段。F2 需要加入 `sourceKind`/`derivedFrom`。两个 PR 可能冲突。

### 决策

F2 的修改范围：
- `SpecFrontmatterSchema`（`src/models/module-spec.ts`）增加：
  ```typescript
  sourceKind: z.enum(['canonical', 'derived', 'bundle_copy']).optional(),
  derivedFrom: z.string().nullable().optional(),
  ```
- `StoredModuleSpecSummary`（`src/panoramic/builders/doc-graph-builder.ts`）增加对应字段
- `extractStoredModuleSpecSummary` 手动解析器增加对应分支
- `generateFrontmatter`（`src/generator/frontmatter.ts`）增加 `sourceKind`/`derivedFrom` 可选参数

F2 **不触碰**：`tokenUsage`、`durationMs`、`llmModel`、`fallbackReason`（F1 领地）。

### 理由

字段独立，Schema 扩展的合并冲突仅发生在 Zod schema 文件的同一位置，实际上 F1/F2 添加的是不同字段，只要 merge 顺序合理，冲突可手动解决（约 5 行 diff）。

---

## Decision 7：Orphan Spec 识别时机

### 问题

SpecStore 何时识别 orphan？在构造时还是查询时？

### 决策

**构造时预计算**：在 SpecStore 构造函数中，对每个 `storedSpec`，检查 `path.join(projectRoot, storedSpec.sourceTarget)` 是否存在（`fs.existsSync`）。将 orphan 记录为独立集合。

### 理由

- 查询频率高（5 个消费方都会查），预计算避免重复 I/O
- 构造时 projectRoot 已知，判断条件确定
- 对空目录或未初始化项目，`storedSpecs` 为空，orphan 集合也为空，符合 spec 的 edge case 要求

### 约束

- orphan 判断**仅对 storedSpecs**，`collectedModuleSpecs`（本次生成）不做 orphan 判断
- `sourceTarget` 是目录路径时，判断目录存在；是文件路径时，判断文件存在
