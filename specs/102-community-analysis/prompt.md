# Feature 102: community-analysis

## Prompt

```
/spec-driver:spec-driver-feature 102-community-analysis

社区检测 + God Node 识别 + GRAPH_REPORT.md。基于 Feature 101 生成的 _meta/graph.json，对知识图谱执行 Louvain 社区检测、God Node 度数分析和跨社区异常边发现，输出可读的架构洞察报告。

## 需求概述

### 核心能力

1. **社区检测（Louvain 算法）**
   - 新增依赖 `graphology` + `graphology-communities-louvain`（纯 JS，无 native addon）
   - 从 `_meta/graph.json`（NetworkX node-link 格式）加载图
   - Louvain 社区检测，输出每个节点的 communityId
   - oversized 社区处理：若某社区 > 25% 总节点 且 >= 10 个节点 → 对该社区子图二次分裂
   - 社区元数据：节点数、核心节点 Top 3（度数最高）、cohesion 评分（社区内边数 / 可能边数）

2. **God Node 识别**
   - 按度数（degree）降序排列所有节点
   - God Node 阈值：度数 > 均值 + 2σ（标准差）
   - 启发式过滤（排除误报）：
     - 排除 `kind: 'package'`（file-level hub，天然高连接）
     - 排除度数全部为 `contains` 关系的节点（纯容器，无实质依赖）
     - 排除孤立函数（仅有 1-2 条非 contains 边）
   - 输出 god nodes 列表：name、degree、连接最多的关系类型、所属社区

3. **Surprising Connections 发现**
   - 跨社区边分析：找出连接不同社区的高 betweenness 边
   - betweenness centrality 近似计算（采样法，避免 O(V*E) 全量计算）
   - 输出 Top 10 surprising connections：source → target、跨社区标注、置信度

4. **GRAPH_REPORT.md 生成**
   - 输出路径：`specs/project/graph-report.md`（或 `_meta/graph-report.md`）
   - 结构：
     ```markdown
     # Architecture Graph Report
     
     ## 概述
     节点: {N}, 边: {M}, 社区: {K}
     
     ## God Nodes
     | 节点 | 度数 | 主要关系类型 | 社区 |
     
     ## 社区列表
     | 社区 ID | 节点数 | Cohesion | 核心节点 Top 3 |
     
     ## Surprising Connections
     | Source | Target | 跨社区 | 置信度 | 说明 |
     
     ## Knowledge Gaps
     孤立节点（度数 0-1）和低覆盖模块列表
     ```
   - batch 完成后自动生成（在 batch-orchestrator post-processing 链中注入，位于 graph.json 构建之后）

5. **CLI 命令**
   - `spectra community [--min-size <N>]`：独立运行社区分析（基于已有 graph.json）
   - 新建 `src/cli/commands/community.ts`

### 性能目标

| 场景 | 目标 |
|------|------|
| 5,000 节点社区检测 | < 5 秒 |
| God Node 计算 | < 1 秒 |
| betweenness 近似（1000 采样） | < 3 秒 |
| GRAPH_REPORT.md 生成 | < 1 秒 |

### 与现有系统的关系

- **Feature 101 graph.json** (`src/panoramic/graph/`)
  - `GraphJSON`：`{ directed, multigraph, graph: {...}, nodes: [...], links: [...] }` — NetworkX node-link 格式
  - `GraphNode`：`{ id, kind, label, metadata? }`，kind 包括 module/package/component/spec/document
  - `GraphEdge`：`{ source, target, relation, confidence, confidenceScore }`
  - `buildKnowledgeGraph(options)` → `GraphJSON`
  - `writeKnowledgeGraph(graphJson, outputDir)` → 原子写入 `_meta/graph.json`

- **batch-orchestrator.ts Post-processing**
  - Feature 101 已在 post-processing 链中注入 graph 构建
  - 社区分析应在 graph 构建之后紧接执行

- **Generator Registry**
  - 可选择将 graph-report 注册为一个 generator（`DocumentGenerator<GraphJSON, string>` 接口）
  - 或作为独立 post-processing 步骤（不走 generator registry）

### 目录结构建议

```
src/panoramic/community/
  community-detector.ts     # Louvain 社区检测 + oversized 分裂
  god-node-analyzer.ts      # God Node 度数分析 + 启发式过滤
  surprising-edges.ts       # 跨社区异常边 + betweenness 近似
  graph-report-generator.ts # GRAPH_REPORT.md 渲染
  index.ts                  # 统一导出
src/cli/commands/
  community.ts              # spectra community 命令
tests/unit/
  community-detector.test.ts
  god-node-analyzer.test.ts
  surprising-edges.test.ts
tests/panoramic/
  community-analysis.test.ts  # 端到端：graph.json → report
```

### 约束

- graphology 是唯一新增运行时依赖（`graphology` + `graphology-communities-louvain`）
- 社区检测必须容错：graph.json 不存在时 graceful exit + 提示先运行 `spectra graph`
- betweenness 采样数 ≤ 1000（避免大图 OOM）
- 所有新增代码遵循项目现有模式：TypeScript strict、Zod schema 验证、中文注释
- GRAPH_REPORT.md 内容使用中文，节点名/路径保持英文
```

## 上下文速查

| 文件 | 作用 |
|------|------|
| `src/panoramic/graph/graph-types.ts` | GraphNode / GraphEdge / GraphJSON 类型定义 |
| `src/panoramic/graph/graph-builder.ts` | `buildKnowledgeGraph()` + `writeKnowledgeGraph()` |
| `src/panoramic/graph/confidence-mapper.ts` | 置信度映射逻辑 |
| `src/batch/batch-orchestrator.ts` | Post-processing 钩子链 |
| `src/cli/commands/graph.ts` | Feature 101 CLI 命令（参考模式） |
| `src/panoramic/generators/` | Generator 注册模式参考 |

### 里程碑上下文

- 属于 **M-100 Spectra Evolution** Phase 2
- 优先级 P2，目标版本 v3.2.0
- 前置依赖：Feature 101 (graph-persistence) ✅ 已完成
- **后续依赖本 Feature 的有 2 个**：103 (multi-format-export)、104 (pretooluse-hook)
