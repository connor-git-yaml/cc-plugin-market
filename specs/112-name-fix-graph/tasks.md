---
feature_id: "112"
title: "修复：graph.json 路径统一、community 持久化、budget 硬上限、Obsidian 碰撞检测"
mode: fix
status: ready
created: 2026-04-12
---

# Tasks: Fix 112 — graph.json 路径统一 + community 持久化 + budget 硬上限 + Obsidian 碰撞检测

**Input**: `specs/112-name-fix-graph/plan.md`、`specs/112-name-fix-graph/fix-report.md`
**模式**: fix（最小变更，无功能范围扩展）
**直接修改文件**: 6 个（含 1 个新建 + 1 个类型扩展）
**新增测试文件**: 4 个
**风险等级**: LOW

---

## Group 1：graph.json 路径统一

**目标**: 新建共享路径 helper，消除三处消费者的硬编码路径（`_meta/graph.json`），统一为与生产者一致的 `specs/_meta/graph.json`。

**验证**: `resolveGraphJsonPath(cwd)` 返回值结尾为 `specs/_meta/graph.json`；`query`/`export`/`mcp` 不再含硬编码路径字符串。

- [x] T001 新建 `src/panoramic/graph/graph-paths.ts`，导出 `resolveGraphJsonPath(cwd: string): string`，返回 `path.join(cwd, 'specs', '_meta', 'graph.json')`；同时导出文件的 JSDoc 注释说明与生产者 `graph-builder.ts writeKnowledgeGraph` 保持一致
- [x] T002 [P] 修改 `src/cli/commands/query.ts` L60：移除 `join(cwd, '_meta', 'graph.json')` 硬编码，改用 `resolveGraphJsonPath(process.cwd())`；在文件顶部添加对应 import（依赖 T001）
- [x] T003 [P] 修改 `src/cli/commands/export.ts` L75：移除 `path.join(cwd, '_meta', 'graph.json')` 硬编码，改用 `resolveGraphJsonPath(cwd)`；在文件顶部添加对应 import（依赖 T001）
- [x] T004 [P] 修改 `src/mcp/graph-tools.ts` L26：移除 `join(process.cwd(), '_meta', 'graph.json')` 硬编码，改用 `resolveGraphJsonPath(process.cwd())`；在文件顶部添加对应 import（依赖 T001）
- [x] T005 新增 `tests/panoramic/graph-paths.test.ts`：覆盖场景——`resolveGraphJsonPath('/some/cwd')` 返回 `/some/cwd/specs/_meta/graph.json`；不同平台分隔符兼容性断言（依赖 T001）

**Checkpoint**: T001-T005 完成后，三个消费者路径统一，单元测试覆盖路径正确性。

---

## Group 2：community ID 持久化

**目标**: `runCommunityCommand` 完成社区分析后，将 `nodeCommunityMap` 中的社区 ID 回写到 `graphJson.nodes[i].metadata.community`，并覆盖写 `graph.json`，使 MCP 的 `graph_node`/`graph_community` 工具能正确返回社区信息。

**验证**: 执行 `runCommunityCommand` 后，重新加载 `graph.json`，随机抽取节点的 `metadata.community` 字段非空且为字符串。

- [x] T006 修改 `src/cli/commands/community.ts`：在 `runCommunityAnalysis()` 调用完成后，新增持久化逻辑——导入 `loadGraph`、`detectCommunities`（来自 `../../panoramic/community/community-detector.js`）与 `writeKnowledgeGraph`（来自 `../../panoramic/graph/index.js`）；重新调用 `detectCommunities(loadGraph(graphJson), { minSize })` 获取 `nodeCommunityMap`，遍历 `graphJson.nodes` 注入 `metadata['community'] = String(communityId)`，最后调用 `writeKnowledgeGraph(graphJson, outputDir)` 覆盖写回（新增行数约 15 行，不修改现有返回值）
- [x] T007 新增 `tests/panoramic/community-persist.test.ts`：构造包含多个节点的最小 `graphJson` fixture，调用 `runCommunityCommand` 流程（或直接调用持久化逻辑），断言写入后 `graphJson.nodes` 中至少存在非空 `metadata.community` 字段（依赖 T006）

**Checkpoint**: T006-T007 完成后，MCP community 工具可正确读取社区 ID。

---

## Group 3：budget 硬上限

**目标**: 修复 `graph-query.ts` 的 `query()` 方法，将 BFS 起点（`startIds`）裁剪到 `budget` 数量，确保 `budget: 1` 时总返回节点数 ≤ 1。

**验证**: `query('broad-term', { budget: 1 })` → `result.nodes.length ≤ 1`；`budget >= scored.length` 时行为不变。

- [x] T008 修改 `src/panoramic/graph/graph-query.ts` L340：将 `const startIds = scored.map((s) => s.id)` 改为 `const startIds = scored.slice(0, Math.max(1, budget)).map((s) => s.id)`；共 1 行修改，不引入新依赖
- [x] T009 新增 `tests/panoramic/graph-query-budget.test.ts`：构造含 5+ 节点的内存图，执行 broad 关键词查询（得分节点 > 1）并传入 `budget: 1`，断言 `result.nodes.length ≤ 1`；同时测试 `budget >= scored.length` 时结果不丢节点（依赖 T008）

**Checkpoint**: T008-T009 完成后，budget 约束对直接匹配节点生效，回归测试覆盖边界场景。

---

## Group 4：Obsidian 文件名碰撞检测

**目标**: 在 `generateObsidianVault` 写盘前插入碰撞检测逻辑，相同 sanitized 路径的后来节点追加 FNV 哈希前 6 位后缀，避免文件覆盖；同时扩展 `ObsidianPage` 类型以携带 `nodeId`。

**验证**: 两个原始 label 不同但 `sanitizeFilename` 结果相同的 god node，生成的 `relativePath` 互不相同。

- [x] T010 修改 `src/panoramic/exporters/export-types.ts`：在 `ObsidianPage` interface 新增可选字段 `nodeId?: string`，加中文 JSDoc 说明用途
- [x] T011 修改 `src/panoramic/exporters/obsidian-exporter.ts` 的 `generateObsidianVault` 函数：在写盘 for 循环前插入碰撞检测——维护 `seenPaths = new Map<string, string>()`，对 god-nodes/ 下的页面检测碰撞并追加 `fnv1a32(nodeId + relativePath).toString(16).slice(0, 6)` 后缀生成去重 `relativePath`；同时修改 `buildGodNodePage` 使其在返回的 `ObsidianPage` 中填充 `nodeId: godNode.id`（依赖 T010；新增行数约 25 行）
- [x] T012 修改 `tests/panoramic/obsidian-collision.test.ts`（如已存在则修改，否则新增）：构造两个 `sanitizeFilename` 结果相同的 god node，调用 `generateObsidianVault`，断言生成的两个文件 `relativePath` 互不相同且各自内容均被保留（依赖 T011）

**Checkpoint**: T010-T012 完成后，Obsidian 导出在碰撞场景下行为确定，无文件丢失。

---

## Phase Final：构建与全量验证

- [x] T013 执行 `npm run build`，确认 TypeScript 零类型错误、零编译警告（依赖 T001-T012）
- [x] T014 执行 `npx vitest run`，确认全量测试通过（含新增的 graph-paths、community-persist、graph-query-budget、obsidian-collision 共 4 个测试文件）（依赖 T013）

---

## 依赖关系与执行顺序

### 任务依赖图

```
T001（新建 graph-paths.ts）
  ├── T002（query.ts 使用 helper）      [可与 T003、T004 并行]
  ├── T003（export.ts 使用 helper）     [可与 T002、T004 并行]
  ├── T004（graph-tools.ts 使用 helper）[可与 T002、T003 并行]
  └── T005（graph-paths 单元测试）

T006（community.ts 持久化回写）
  └── T007（community 持久化测试）

T008（graph-query.ts budget slice）
  └── T009（budget 硬上限回归测试）

T010（ObsidianPage 类型扩展）
  └── T011（obsidian-exporter 碰撞检测）
        └── T012（碰撞场景测试）

T013（npm run build）← 依赖 T001-T012 全部完成
T014（npx vitest run）← 依赖 T013
```

### Group 间并行机会

| Group | 依赖 | 可与哪些 Group 并行 |
|-------|------|---------------------|
| Group 1（路径统一）| 无 | Group 2、Group 3、Group 4 均可并行启动 |
| Group 2（community 持久化）| 无（与 Group 1 独立）| Group 1、Group 3、Group 4 |
| Group 3（budget 硬上限）| 无 | Group 1、Group 2、Group 4 |
| Group 4（Obsidian 碰撞）| 无 | Group 1、Group 2、Group 3 |
| Phase Final | 所有 Group 完成 | 无 |

**结论**：4 个修复 Group 相互独立，可完全并行执行（4 人同时开发最优）；单人开发推荐按 plan.md 建议顺序：Group 1 → Group 3 → Group 2 → Group 4。

---

## 问题覆盖映射

| fix-report 问题 | 任务 |
|----------------|------|
| 问题 1：graph.json 路径不一致 | T001, T002, T003, T004, T005 |
| 问题 2：metadata.community 从未写入 | T006, T007 |
| 问题 3：budget 非硬上限 | T008, T009 |
| 问题 4：Obsidian 文件名碰撞 | T010, T011, T012 |
| 构建与全量验证 | T013, T014 |

**覆盖率**: 4/4 问题，100%
