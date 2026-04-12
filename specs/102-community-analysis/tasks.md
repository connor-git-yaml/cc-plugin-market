# Tasks: 社区检测与架构洞察分析

**Input**: Design documents from `/specs/102-community-analysis/`
**Prerequisites**: plan.md, spec.md

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

**Purpose**: 安装依赖，建立模块骨架

- [ ] T001 [US1] 安装 graphology 依赖：`npm install graphology graphology-communities-louvain graphology-types`
- [ ] T002 [US1] 创建 `src/panoramic/community/index.ts` 模块入口，统一导出

---

## Phase 2: Core Analysis（基础算法模块）

**Purpose**: 实现三个核心分析函数，每个函数为独立纯函数

- [ ] T003 [P] [US1] 实现 `src/panoramic/community/community-detector.ts`
  - `loadGraph(graphJson: GraphJSON): UndirectedGraph` — 从 NetworkX node-link 格式加载到 graphology
  - `detectCommunities(graph, options?: { minSize?: number }): CommunityResult` — Louvain 检测 + oversized 社区二次分裂 + cohesion 评分
  - 类型：`CommunityResult = { communities: CommunityInfo[], nodeCommunityMap: Map<string, number> }`
  - 类型：`CommunityInfo = { id: number, nodes: string[], coreNodes: string[], cohesion: number }`

- [ ] T004 [P] [US1] 实现 `src/panoramic/community/god-node-analyzer.ts`
  - `findGodNodes(graph, nodeCommunityMap): GodNode[]` — 度数 > 均值 + 2σ，过滤 kind='package' 和纯 contains 节点
  - 类型：`GodNode = { id: string, label: string, degree: number, primaryRelation: string, communityId: number }`

- [ ] T005 [P] [US1] 实现 `src/panoramic/community/surprising-edges.ts`
  - `findSurprisingEdges(graph, nodeCommunityMap, options?: { sampleSize?: number }): SurprisingEdge[]` — 跨社区边 + betweenness 采样 + 复合评分
  - 类型：`SurprisingEdge = { source: string, target: string, relation: string, confidence: string, crossCommunity: boolean, score: number }`
  - betweenness 采样默认 ≤ 1000 个源节点

**Checkpoint**: 三个核心算法模块可独立单元测试

---

## Phase 3: User Story 1 - 一键生成架构洞察报告 (Priority: P1) 

**Goal**: 完成 CLI 命令到报告生成的端到端链路

**Independent Test**: 运行 `spectra community`，验证 `_meta/GRAPH_REPORT.md` 生成

### Implementation

- [ ] T006 [US1] 实现 `src/panoramic/community/graph-report-generator.ts`
  - `generateReport(graphStats, communities, godNodes, surprisingEdges): string` — 渲染 Markdown 报告
  - 报告区块：概述（节点/边/社区数）→ God Nodes 表格 → 社区列表表格 → Surprising Connections 表格 → Knowledge Gaps
  - 内容使用中文，节点名/路径保持英文

- [ ] T007 [US1] 实现 `src/cli/commands/community.ts`
  - `runCommunityCommand(command: CLICommand): Promise<void>`
  - 读取 `_meta/graph.json`，调用分析管道，写入 `_meta/GRAPH_REPORT.md`
  - 支持 `--min-size <N>` 参数
  - graph.json 不存在时输出友好提示并退出

- [ ] T008 [US1] 在 `src/cli/index.ts` 注册 community 命令，添加帮助文本

- [ ] T009 [US1] 更新 `src/panoramic/community/index.ts` 统一导出所有公共 API

**Checkpoint**: `spectra community` 命令端到端可用

---

## Phase 4: User Story 2 - 容错处理 (Priority: P1)

**Goal**: graph.json 缺失/损坏时的优雅降级

- [ ] T010 [US2] 在 `community.ts` CLI 中添加 graph.json 存在性检查和格式验证
  - 不存在 → 提示 "请先运行 `spectra graph` 生成知识图谱"
  - 格式异常 → 提示格式错误信息
  - 空图（0 节点）→ 输出基础统计，跳过分析

---

## Phase 5: User Story 3 - batch 自动集成 (Priority: P2)

**Goal**: batch post-processing 自动执行社区分析

- [ ] T011 [US3] 在 `src/batch/batch-orchestrator.ts` 的 graph 构建之后注入社区分析调用
  - 导入 `runCommunityAnalysis` 入口函数
  - try-catch 包裹，失败时 logger.warn 不中断 batch
  - 创建 `src/panoramic/community/` 中的 `runCommunityAnalysis(graphJson, outputDir)` 入口

---

## Phase 6: Tests

**Purpose**: 单元测试 + 集成测试

- [ ] T012 [P] 创建 `tests/unit/community-detector.test.ts`
  - 测试 loadGraph 加载正确性
  - 测试 Louvain 社区检测结果
  - 测试 oversized 社区分裂
  - 测试 cohesion 评分计算
  - 测试空图/小图边界

- [ ] T013 [P] 创建 `tests/unit/god-node-analyzer.test.ts`
  - 测试 God Node 阈值（均值 + 2σ）
  - 测试 kind='package' 过滤
  - 测试纯 contains 关系过滤
  - 测试无 God Node 场景

- [ ] T014 [P] 创建 `tests/unit/surprising-edges.test.ts`
  - 测试跨社区边识别
  - 测试 betweenness 采样一致性
  - 测试复合评分排序

- [ ] T015 创建 `tests/panoramic/community-analysis.test.ts`
  - 端到端：构造 GraphJSON → 运行完整分析管道 → 验证报告内容结构
  - 性能基准：5000 节点 < 5s

---

## Phase 7: Polish

- [ ] T016 检查所有新增导出在 `src/panoramic/community/index.ts` 中完整
- [ ] T017 验证 `spectra --help` 包含 community 命令说明

---

## Dependency Graph

```text
T001 → T002 → T003, T004, T005 (并行)
T003, T004, T005 → T006 → T007 → T008
T007 → T010
T006 → T011
T003, T004, T005 → T012, T013, T014 (并行)
T007 → T015
```

## Parallel Execution

```text
并行组 1: T003 + T004 + T005（三个核心算法模块互不依赖）
并行组 2: T012 + T013 + T014（三个单元测试互不依赖）
```
