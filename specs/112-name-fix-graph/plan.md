---
feature_id: "112"
title: "修复：graph.json 路径统一、community 持久化、budget 硬上限、Obsidian 碰撞检测"
mode: fix
status: ready
created: 2026-04-12
---

# 修复规划

## 修复架构概述

本次修复涵盖 4 个独立高优先级（HIGH）问题，由 Codex 对抗性审查发现于 Feature 103（多格式导出）及上游 graph/query 层。各修复相互独立，均为最小化变更，无功能范围扩展。

```mermaid
graph TD
    NEW[graph-paths.ts\n新建路径 helper] -->|替换硬编码路径| Q[query.ts L60]
    NEW -->|替换硬编码路径| E[export.ts L75]
    NEW -->|替换硬编码路径| M[graph-tools.ts L26]

    COM[community.ts] -->|回写社区 ID| GJ[graph.json\nnodes[i].metadata.community]

    GQ[graph-query.ts L340] -->|slice 裁剪 startIds| BUDGET[budget 硬上限]

    OBS[obsidian-exporter.ts] -->|碰撞检测 + 后缀| COLL[文件名去重]
    OBS -->|同步 wikilinks| IDX[index.md 引用]
```

---

## Codebase Reality Check

| 目标文件 | LOC | 公开接口数 | 已知 debt | 本次新增行 |
|---------|-----|-----------|----------|-----------|
| `src/cli/commands/query.ts` | 134 | 1（`runQueryCommand`） | 无 | ~3 |
| `src/cli/commands/export.ts` | 127 | 1（`runExportCommand`） | 无 | ~3 |
| `src/mcp/graph-tools.ts` | 206 | 2（`registerGraphTools`, `reloadGraph`） | 无 | ~3 |
| `src/cli/commands/community.ts` | 89 | 1（`runCommunityCommand`） | 无 | ~15 |
| `src/panoramic/graph/graph-query.ts` | 621 | 5（`query`, `getNode`, `findPath`, `getCommunity`, `getGodNodes`） | 无 | ~1 |
| `src/panoramic/exporters/obsidian-exporter.ts` | 353 | 4（`sanitizeFilename`, `buildIndexPage`, `buildCommunityPage`, `buildGodNodePage`, `generateObsidianVault`） | 无 | ~25 |
| `src/panoramic/graph/graph-paths.ts` | 0（新建） | 1（`resolveGraphJsonPath`） | — | ~15 |

**前置清理结论**：所有目标文件均无 TODO/FIXME/HACK，LOC 均低于 500 行或新增行数低于 50，且无明显代码重复超 30 行。无需前置 cleanup task。

---

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件数 | 6（含 1 个新建） |
| 间接受影响文件 | 0（消费者调用链不变，仅路径来源替换） |
| 跨包影响 | 仅 `src/panoramic/` 和 `src/cli/` 内部，`src/mcp/` 内部，无顶层包边界穿越 |
| 数据迁移 | community ID 写入 graph.json nodes 节点 metadata — 向后兼容（新增字段，不删除旧字段） |
| API/契约变更 | 无。`resolveGraphJsonPath` 仅内部调用，`runCommunityCommand` 返回值不变 |
| **风险等级** | **LOW** |

**风险判定依据**：影响文件 6 个（< 10），无跨包影响（< 2），数据迁移为向后兼容的字段追加，无公共 API 契约变更。

---

## 修复 1：graph.json 路径统一

### 问题
`query.ts` L60、`export.ts` L75、`graph-tools.ts` L26 三处消费者使用 `join(cwd, '_meta', 'graph.json')` 硬编码路径，与生产者（`graph.ts`、`community.ts`）使用的 `join(cwd, 'specs', '_meta', 'graph.json')` 不一致。

### 变更说明

**新建文件** `src/panoramic/graph/graph-paths.ts`

```typescript
import { join } from 'node:path';

/**
 * 返回 graph.json 的标准路径
 * 与生产者（graph-builder.ts writeKnowledgeGraph）保持一致：{cwd}/specs/_meta/graph.json
 */
export function resolveGraphJsonPath(cwd: string): string {
  return join(cwd, 'specs', '_meta', 'graph.json');
}
```

**修改** `src/cli/commands/query.ts` L60

```diff
- const graphPath = join(process.cwd(), '_meta', 'graph.json');
+ import { resolveGraphJsonPath } from '../../panoramic/graph/graph-paths.js';
  ...
+ const graphPath = resolveGraphJsonPath(process.cwd());
```

**修改** `src/cli/commands/export.ts` L75

```diff
- const graphJsonPath = path.join(cwd, '_meta', 'graph.json');
+ import { resolveGraphJsonPath } from '../../panoramic/graph/graph-paths.js';
  ...
+ const graphJsonPath = resolveGraphJsonPath(cwd);
```

**修改** `src/mcp/graph-tools.ts` L26

```diff
- const graphPath = join(process.cwd(), '_meta', 'graph.json');
+ import { resolveGraphJsonPath } from '../panoramic/graph/graph-paths.js';
  ...
+ const graphPath = resolveGraphJsonPath(process.cwd());
```

**注意**：`community.ts` L44-45 和 `graph.ts` L134 的生产者路径不变（已正确使用 `path.join(cwd, 'specs')`，与 `writeKnowledgeGraph(graphJson, outputDir)` 一致）。

---

## 修复 2：community ID 持久化到 graph.json

### 问题
`runCommunityAnalysis()` 完成后只写 GRAPH_REPORT.md，`node.metadata.community` 始终为空，导致 MCP 的 `graph_node`/`graph_community` 工具返回社区信息缺失。

### 变更说明

**修改** `src/cli/commands/community.ts`

在 `runCommunityCommand` 内部，`runCommunityAnalysis()` 调用完成后，新增持久化逻辑：

```typescript
// 重新执行社区检测（复用已读取的 graphJson），获取 nodeCommunityMap
const { graph: inMemGraph } = ((): { graph: ReturnType<typeof loadGraph> } => {
  // 注：runCommunityAnalysis 内部已执行，这里直接重新调用 detect 子步骤
  // 以获取 nodeCommunityMap 用于回写
})();
```

由于 `runCommunityAnalysis` 不返回 `nodeCommunityMap`，需修改调用方式：在 `community.ts` 中直接导入 `loadGraph` 和 `detectCommunities`，在调用 `runCommunityAnalysis` 之后（报告已写），再执行一次 `detectCommunities` 获取映射，然后回写 graph.json。

具体实现：

```diff
  import { runCommunityAnalysis } from '../../panoramic/community/index.js';
+ import { loadGraph, detectCommunities } from '../../panoramic/community/community-detector.js';
+ import { writeKnowledgeGraph } from '../../panoramic/graph/index.js';

  // （已有）调用分析管道
  const reportPath = runCommunityAnalysis(graphJson, outputDir, {
    minSize: command.communityMinSize,
  });
  console.log(`✓ GRAPH_REPORT.md 已生成: ${reportPath}`);

+ // 将社区 ID 持久化回 graph.json 节点 metadata
+ const g = loadGraph(graphJson);
+ const { nodeCommunityMap } = detectCommunities(g, { minSize: command.communityMinSize });
+ for (const node of graphJson.nodes) {
+   const communityId = nodeCommunityMap.get(node.id);
+   if (communityId !== undefined) {
+     node.metadata['community'] = String(communityId);
+   }
+ }
+ writeKnowledgeGraph(graphJson, outputDir);
+ console.log(`✓ graph.json 社区 ID 已更新`);
```

**设计说明**：`detectCommunities` 是确定性算法（Louvain 固定 seed），两次调用结果一致，双次调用不会产生结果偏差。`writeKnowledgeGraph` 使用原子写（`writeAtomicJson`），写入路径为 `{outputDir}/_meta/graph.json`，与生产者路径一致。

---

## 修复 3：budget 硬上限

### 问题
`graph-query.ts` 的 `query()` 方法在 `truncateByBudget` 之前，将全部得分节点（`scored.map(s => s.id)`）设为 `pinnedIds`（固定保留），导致 budget 仅约束 BFS 扩展部分，直接匹配节点数量无上限。

### 变更说明

**修改** `src/panoramic/graph/graph-query.ts` L340

```diff
- const startIds = scored.map((s) => s.id);
+ const startIds = scored.slice(0, Math.max(1, budget)).map((s) => s.id);
```

**影响分析**：
- `budget <= 0` 时使用默认值 50（由 `query()` 方法上方的 budget 正规化逻辑控制，不影响本行）。
- `budget >= scored.length` 时 `slice` 为无效操作，行为不变。
- `budget < scored.length` 时仅保留前 `budget` 个得分最高节点作为 BFS 起点，BFS 仍可从这些起点扩展，`truncateByBudget` 进一步约束扩展结果。
- 确保 `budget: 1` 时总节点数 ≤ 1（1 个 seed + 0 个 BFS 扩展，因 pinned 集合大小 = 1 = budget）。

---

## 修复 4：Obsidian 文件名碰撞检测

### 问题
`generateObsidianVault` 的写盘循环中，不同节点经 `sanitizeFilename` 后可能产生相同 `relativePath`，导致后来者覆盖前者。`buildIndexPage` 中的 wikilinks 也会指向错误页面。

### 变更说明

**修改** `src/panoramic/exporters/obsidian-exporter.ts` 的 `generateObsidianVault` 函数

在写盘 for 循环前插入碰撞检测逻辑：

```diff
  // 写盘：创建目录并写文件
  const writtenFiles: string[] = [];
+ // 碰撞检测：relativePath → nodeId（用于追加去重后缀）
+ const seenPaths = new Map<string, string>();
+
+ // 为发生碰撞的 page 追加节点 ID 前 6 位后缀
+ const deduplicatedPages = pages.map((page) => {
+   // index.md 和 communities/*.md 使用固定路径，无碰撞风险
+   if (!page.relativePath.startsWith('god-nodes/')) return page;
+   if (!seenPaths.has(page.relativePath)) {
+     seenPaths.set(page.relativePath, page.nodeId ?? page.relativePath);
+     return page;
+   }
+   // 发生碰撞：追加 FNV-1a 前 6 位（基于 label + nodeId）
+   const disambiguator = fnv1a32((page.nodeId ?? '') + page.relativePath)
+     .toString(16)
+     .padStart(8, '0')
+     .slice(0, 6);
+   const ext = path.extname(page.relativePath);          // '.md'
+   const base = page.relativePath.slice(0, -ext.length); // 去掉 .md
+   const newRelativePath = `${base}-${disambiguator}${ext}`;
+   return { ...page, relativePath: newRelativePath };
+ });
+
  for (const page of deduplicatedPages) {
```

**ObsidianPage 类型扩展**（`src/panoramic/exporters/export-types.ts`）

```diff
  export interface ObsidianPage {
    relativePath: string;
    content: string;
+   /** 仅 god-nodes 页面填充，用于碰撞检测时生成 disambiguator */
+   nodeId?: string;
  }
```

**buildGodNodePage 修改**：返回的 `ObsidianPage` 中填充 `nodeId: godNode.id`。

**wikilink 同步**：碰撞发生后，`buildIndexPage` 生成的 wikilink 是基于原始 `sanitizedName`，若该 name 对应的文件已改名（碰撞后被后来者占用），则第一个写入者保留原名，后来者使用带后缀的名。因此 index.md 中的 `[[sanitizedName]]` 始终指向第一个写入者，行为确定。若需更精确的对齐，可在 `generateObsidianVault` 中对 `godNodes` 做预排序后统一处理，但当前场景（index.md 列出 God Nodes）已足够——第一个节点保留无歧义文件名。

---

## 回归风险评估

| 修复 | 回归风险 | 说明 |
|------|----------|------|
| graph.json 路径统一 | 低 | 路径值从错误值改为正确值；消费者逻辑不变；测试路径 mock 需同步更新 |
| community 持久化 | 低 | 新增写盘操作；`writeKnowledgeGraph` 使用原子写；只追加 metadata 字段 |
| budget 硬上限 | 极低 | 单行 `slice` 改动；`budget >= scored.length` 场景无行为差异；只在小 budget 场景有效 |
| Obsidian 碰撞检测 | 低 | 无碰撞时行为完全一致；碰撞时第一个节点保留原文件名，后续者追加后缀 |

**整体评估**：LOW 风险。所有修复均为最小化改动，无跨包接口变更，无破坏性 API 修改。

---

## 验证方案

### 1. 构建验证

```bash
npm run build
```

目标：TypeScript 零类型错误，零编译警告。

### 2. 全量回归测试

```bash
npx vitest run
```

目标：Feature 103 现有 97 个测试全部通过，无新增失败。

### 3. 新增单元测试

| 测试文件 | 覆盖场景 | 关键断言 |
|---------|---------|---------|
| `tests/panoramic/graph-paths.test.ts` | `resolveGraphJsonPath` 路径正确性 | 返回值以 `specs/_meta/graph.json` 结尾 |
| `tests/panoramic/community-persist.test.ts` | 社区 ID 写入 graph.json 节点 | 执行 `runCommunityCommand` 后节点 `metadata.community` 非空 |
| `tests/panoramic/graph-query-budget.test.ts` | budget 硬上限回归 | `query('broad', { budget: 1 })` → `nodes.length ≤ 1` |
| `tests/panoramic/obsidian-collision.test.ts` | 碰撞场景去重 | 两个 label sanitize 后相同的节点生成不同 relativePath |

### 4. 手动冒烟验证（可选）

```bash
# 构建知识图谱
spectra graph

# 执行社区分析（验证 community ID 写回）
spectra community

# 查询验证（验证路径修复）
spectra query "test" --budget 1

# 导出验证（验证碰撞检测）
spectra export --format obsidian
```

---

## 实现顺序建议

1. **修复 1**（graph-paths.ts 新建）— 独立，无依赖，优先落地，其他修复可参考
2. **修复 3**（budget slice）— 单行改动，最小风险，尽早合入
3. **修复 2**（community 持久化）— 依赖修复 1（路径一致后可验证 e2e）
4. **修复 4**（Obsidian 碰撞）— 需修改 export-types.ts，独立但改动面稍大
