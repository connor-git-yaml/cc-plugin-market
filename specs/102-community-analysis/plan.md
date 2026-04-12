# Implementation Plan: 社区检测与架构洞察分析

**Branch**: `102-community-analysis` | **Date**: 2026-04-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/102-community-analysis/spec.md`

## Summary

基于 Feature 101 生成的 `_meta/graph.json`，实现 Louvain 社区检测、God Node 识别和跨社区异常边发现，输出 `_meta/GRAPH_REPORT.md` 架构洞察报告。参考 Graphify 的分析管道设计，保持架构最简。

## Technical Context

**Language/Version**: TypeScript 5.x + Node.js 20.x+
**Primary Dependencies**: graphology + graphology-communities-louvain（新增）；复用现有 GraphJSON 类型
**Storage**: 文件系统（读取 `_meta/graph.json`，写入 `_meta/GRAPH_REPORT.md`）
**Testing**: vitest
**Target Platform**: CLI（Node.js）
**Performance Goals**: 5,000 节点社区检测 < 5s，God Node < 1s，betweenness 采样 < 3s，报告生成 < 1s
**Constraints**: betweenness 采样 ≤ 1000 次；graphology 是唯一新增运行时依赖
**Scale/Scope**: 典型项目图 100-5000 节点

## Constitution Check

- **原则 III (YAGNI)**: 不注册为 Generator（单一用途的 post-processing 步骤）；不实现 suggest_questions（非需求）；不支持多输出格式（仅 Markdown）
- **原则 VIII (Spec-Driven)**: 通过 spec-driver 流程执行
- **原则 IX (依赖)**: graphology 是核心算法依赖，有明确使用场景

## Project Structure

### Documentation

```text
specs/102-community-analysis/
├── spec.md
├── plan.md          # 本文件
└── tasks.md
```

### Source Code

```text
src/panoramic/community/
├── community-detector.ts     # Louvain 社区检测 + oversized 分裂
├── god-node-analyzer.ts      # God Node 识别 + 启发式过滤
├── surprising-edges.ts       # 跨社区异常边 + betweenness 采样
├── graph-report-generator.ts # GRAPH_REPORT.md Markdown 渲染
└── index.ts                  # 统一导出

src/cli/commands/
└── community.ts              # spectra community CLI 命令

tests/unit/
├── community-detector.test.ts
├── god-node-analyzer.test.ts
└── surprising-edges.test.ts

tests/panoramic/
└── community-analysis.test.ts  # 端到端集成测试
```

## 核心设计决策

### 1. 纯函数架构（参考 Graphify）

每个模块导出纯函数，输入 GraphJSON 或 graphology Graph 实例，输出结构化结果。不使用类封装，不引入状态。

```text
loadGraph(graphJson) → Graph
  ↓
detectCommunities(graph, options) → CommunityResult
  ↓
findGodNodes(graph, communities) → GodNode[]
  ↓
findSurprisingEdges(graph, communities, options) → SurprisingEdge[]
  ↓
generateReport(stats, communities, godNodes, surprises) → string
```

### 2. graphology 作为内存图结构

从 GraphJSON（NetworkX node-link 格式）加载到 graphology UndirectedGraph，复用 graphology 的度数计算、邻居遍历、子图提取等 API。不自行实现邻接表。

### 3. God Node 过滤策略（参考 Graphify）

Graphify 排除文件级 hub 和概念节点。本项目对应调整为：
- 排除 `kind: 'package'`（天然高连接的容器节点）
- 排除仅有 `contains` 关系的节点（纯结构容器）
- 保留阈值：度数 > 均值 + 2σ

### 4. Surprising Connections 评分（参考 Graphify）

Graphify 使用复合评分（置信度 + 跨文件类型 + 跨社区 + 外围→枢纽）。本项目简化为：
- 跨社区加成（必须是不同社区的边）
- 置信度权重（AMBIGUOUS > INFERRED > EXTRACTED，低置信度更"意外"）
- betweenness centrality 采样（BFS，≤ 1000 个源节点随机采样）

### 5. 不使用 Generator Registry

GRAPH_REPORT.md 是单一用途的分析产物，不需要 extract/generate/render 三阶段流程。直接在 post-processing 中调用 `generateReport()` 函数。

### 6. batch 集成

在 `batch-orchestrator.ts` 的 graph 构建之后，增加一行调用：

```text
const graphJson = buildKnowledgeGraph(...)
writeKnowledgeGraph(graphJson, outputDir)
// Feature 102: 社区分析
runCommunityAnalysis(graphJson, outputDir)  // 新增
```

容错：try-catch 包裹，失败时 logger.warn 不中断 batch。

## 依赖关系

```text
T001 安装 graphology
  ↓
T002 community-detector.ts ──→ T005 graph-report-generator.ts
T003 god-node-analyzer.ts  ──→ T005
T004 surprising-edges.ts   ──→ T005
  ↓
T006 community.ts (CLI)
T007 batch-orchestrator 集成
  ↓
T008 单元测试
T009 集成测试
```
