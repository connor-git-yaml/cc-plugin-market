# 问题修复报告

## 问题描述

Codex 对抗性审查发现 Feature 103（多格式导出）及上游 graph/query 层存在 4 个 HIGH 级问题：
graph.json 路径生产者/消费者不一致、community metadata 从未持久化、budget 非硬上限、Obsidian 文件名碰撞。

---

## 问题 1：graph.json 路径不一致

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `spectra query`/`spectra export`/MCP 找不到 graph.json | 硬编码 `{cwd}/_meta/graph.json` |
| Why 2 | 为何与生产者路径不一致？ | `graph.ts` 默认 `outputDir = path.join(cwd, 'specs')`，写入 `specs/_meta/graph.json` |
| Why 3 | 为何消费者用了不同路径？ | 各命令独立实现路径逻辑，无共享常量/helper |
| Why 4 | 为何没有被测试捕获？ | export/query 测试 mock 了文件系统，未测试真实路径 |

**Root Cause**: 缺少统一的 graph.json 路径 resolver；各消费者独立硬编码，与生产者约定不一致。
**Root Cause Chain**: 路径不一致 → 各自硬编码 → 无共享 helper → 单元测试 mock 掩盖

### 影响范围扫描

| 文件 | 位置 | 模式 | 分类 | 修复动作 |
|------|------|------|------|----------|
| `src/cli/commands/query.ts` | L60 | `join(cwd, '_meta', 'graph.json')` | 同源 | 改用共享 helper |
| `src/cli/commands/export.ts` | L75 | `path.join(cwd, '_meta', 'graph.json')` | 同源 | 改用共享 helper |
| `src/mcp/graph-tools.ts` | L26 | `join(cwd, '_meta', 'graph.json')` | 同源 | 改用共享 helper |
| `src/cli/commands/community.ts` | L44-45 | `outputDir = path.join(cwd, 'specs')` | 安全 | 生产者，一致无需改 |
| `src/cli/commands/graph.ts` | L134 | `outputDir = path.join(cwd, 'specs')` | 安全 | 生产者，一致无需改 |

### 修复策略

**方案 A（推荐）**: 新建 `src/panoramic/graph/graph-paths.ts`，导出 `resolveGraphJsonPath(cwd: string, outputDir?: string): string`，默认返回 `path.join(cwd, 'specs', '_meta', 'graph.json')`。query/export/mcp 全部改用该 helper。
**方案 B（备选）**: 在每个消费者中直接修改路径字符串，不引入 helper。简单但仍有分散风险。

---

## 问题 2：metadata.community 从未写入 graph.json

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `graph_node` 返回 `community: null`，`graph_community` 返回"社区不存在" | `getNode()`/`getCommunity()` 读 `node.metadata['community']`，但该字段为空 |
| Why 2 | 为何字段为空？ | `buildKnowledgeGraph()` 构建图时不持久化社区 ID |
| Why 3 | 为何 community.ts 不回写？ | `runCommunityAnalysis()` 返回 CommunityResult 但 community.ts 只写 GRAPH_REPORT.md，不更新 graph.json |
| Why 4 | 为何设计时未考虑？ | Feature 102（community analysis）与 Feature 101（graph builder）开发时未协商持久化契约 |

**Root Cause**: 社区检测结果只写入 Markdown 报告，未回写到 graph.json 节点 metadata。
**Root Cause Chain**: MCP 读 metadata → metadata 为空 → community.ts 不回写 → 设计契约缺失

### 影响范围扫描

| 文件 | 位置 | 模式 | 分类 | 修复动作 |
|------|------|------|------|----------|
| `src/cli/commands/community.ts` | L44-79 | 运行分析后仅写 report | 同源 | 回写社区 ID 到 graph 节点并重存 graph.json |
| `src/panoramic/graph/graph-query.ts` | L437-438, L549 | 读 `metadata['community']` | 安全 | 回写后即可工作，无需改 |
| `src/mcp/graph-tools.ts` | L164 | 描述字段 `metadata.community` | 安全 | 回写后即可工作 |

### 修复策略

**方案 A（推荐）**: 在 `community.ts` 中，`runCommunityAnalysis()` 完成后，遍历 `communityResult.nodeCommunityMap`，将社区 ID 注入 `graphJson.nodes[i].metadata.community`（字符串），然后覆盖写 `graph.json`。
**方案 B**: 改 `getNode()`/`getCommunity()` 不依赖 `metadata.community`，改为加载 GRAPH_REPORT.md 或另存社区映射文件。复杂度高，不推荐。

---

## 问题 3：budget 非硬上限

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `budget: 1` 时返回 3 个节点 | `truncateByBudget` 不裁剪 pinnedIds |
| Why 2 | 为何所有匹配节点都被 pin？ | `pinnedIds = new Set(scored.map(s => s.id))` — 全部得分节点 |
| Why 3 | 为何把全部得分节点作为 seed？ | BFS 需要起始点，设计者将所有匹配节点作为起点 |
| Why 4 | 为何未限制起点数？ | 认为起点必须全保留，低估了大匹配集场景 |

**Root Cause**: 以所有得分节点为 seed，且 pinnedIds 免裁剪，导致 budget 仅约束 BFS 扩展节点，对直接匹配节点无效。

### 修复策略

**方案 A（推荐）**: 将 startIds 裁剪到 `scored.slice(0, budget).map(s => s.id)`，确保 seed 本身不超过 budget；pinnedIds 机制不变（保留 seed），但 seed 数量受约束。
**方案 B**: 修改 `truncateByBudget` 对 pinnedIds 也施加上限。更复杂，但保留了更多灵活性。

---

## 问题 4：Obsidian 文件名碰撞（Feature 103）

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 相同 sanitized 标签的 god node 页面互相覆盖 | `fs.writeFileSync` 无碰撞检测 |
| Why 2 | 为何路径可能重复？ | `sanitizeFilename` 将 `/`, `:`, ` ` 统一替换为 `-`，不同原始标签可得相同输出 |
| Why 3 | 为何没有加 disambiguator？ | Feature 103 设计时未考虑同名节点场景（monorepo 常见） |
| Why 4 | 为何测试未捕获？ | 测试用的都是唯一标签，没有构造碰撞场景 |

**Root Cause**: 文件名依赖 label sanitize 结果，无节点 ID 参与，无碰撞检测机制。

### 修复策略

**方案 A（推荐）**: 在 `generateObsidianVault` 中维护 `seenPaths = new Set<string>()`。检测到碰撞时，在 `buildGodNodePage` 的 relativePath 上追加 `godNode.id` 的前 6 位（已经是可打印字符的 FNV 哈希风格）作为后缀。
**方案 B**: 始终在文件名中包含节点 ID 哈希。无碰撞风险，但文件名冗长。

---

## 影响汇总

受影响文件：6 个（3 个 Feature 103 消费者修复 + 1 个 community 回写 + 1 个 graph-query budget + 1 个 obsidian-exporter）

## Spec 影响

- `specs/103-multi-format-export/spec.md` → 无需更新（碰撞处理属 FR-005 的实现质量改善）
- `specs/103-multi-format-export/tasks.md` → 无需更新
- 其他 spec → 无需更新
