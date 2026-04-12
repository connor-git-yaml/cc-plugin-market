# Feature Specification: 社区检测与架构洞察分析

**Feature Branch**: `102-community-analysis`  
**Created**: 2026-04-12  
**Status**: Draft  
**Input**: 社区检测 + God Node 识别 + GRAPH_REPORT.md。基于 Feature 101 生成的 _meta/graph.json，对知识图谱执行社区检测、God Node 度数分析和跨社区异常边发现，输出可读的架构洞察报告。

## User Scenarios & Testing

### User Story 1 - 一键生成架构洞察报告 (Priority: P1)

开发者在已有 `_meta/graph.json` 的项目中运行 `spectra community` 命令，系统自动完成社区检测、God Node 识别和异常边发现，生成一份人类可读的 `GRAPH_REPORT.md` 架构洞察报告。

**Why this priority**: 这是本 Feature 的端到端核心流程，涵盖所有子能力的串联，是用户获取价值的唯一入口。

**Independent Test**: 给定一个包含 `_meta/graph.json` 的项目目录，运行 `spectra community`，验证报告文件生成且内容结构完整。

**Acceptance Scenarios**:

1. **Given** 项目已执行 `spectra graph` 生成了 `_meta/graph.json`，**When** 用户运行 `spectra community`，**Then** 系统在 `_meta/` 下生成 `GRAPH_REPORT.md`，包含概述、God Nodes、社区列表、Surprising Connections、Knowledge Gaps 五个区块
2. **Given** `_meta/graph.json` 包含 50 个节点和 80 条边，**When** 运行社区分析，**Then** 检测出 3+ 个社区，每个社区包含节点数、内聚度评分、核心节点 Top 3
3. **Given** 图中存在度数远高于均值的节点，**When** 运行 God Node 分析，**Then** 报告中列出这些节点及其度数、主要关系类型、所属社区

### User Story 2 - graph.json 缺失时的优雅降级 (Priority: P1)

开发者在未运行过 `spectra graph` 的项目中执行 `spectra community`，系统给出清晰的错误提示而非崩溃。

**Why this priority**: 容错是基础可用性要求，与核心流程同等重要。

**Independent Test**: 在无 `_meta/graph.json` 的目录运行命令，验证提示信息。

**Acceptance Scenarios**:

1. **Given** 项目目录下不存在 `_meta/graph.json`，**When** 用户运行 `spectra community`，**Then** 系统输出提示"请先运行 `spectra graph` 生成知识图谱"并以非零退出码退出
2. **Given** `_meta/graph.json` 存在但内容为空或格式异常，**When** 运行命令，**Then** 系统输出格式错误提示并退出

### User Story 3 - batch 后自动生成报告 (Priority: P2)

开发者运行 `spectra batch` 完成全量文档生成后，系统在 post-processing 链中自动执行社区分析并生成报告，无需手动二次运行。

**Why this priority**: 自动化集成减少操作步骤，但依赖核心分析能力先就绪。

**Independent Test**: 运行 `spectra batch`，验证 `_meta/GRAPH_REPORT.md` 自动生成。

**Acceptance Scenarios**:

1. **Given** 用户运行 `spectra batch` 且 graph 构建成功，**When** post-processing 进入社区分析步骤，**Then** 自动生成 `_meta/GRAPH_REPORT.md`
2. **Given** graph 构建失败（无 architectureIR 等输入），**When** post-processing 执行到社区分析，**Then** 静默跳过，不中断 batch 流程

### User Story 4 - 自定义最小社区阈值 (Priority: P3)

开发者通过 `--min-size` 参数控制社区检测的最小节点数，过滤掉过小的社区以聚焦关键模块。

**Why this priority**: 高级配置能力，默认行为已满足大多数场景。

**Independent Test**: 运行 `spectra community --min-size 5`，验证报告中不包含少于 5 个节点的社区。

**Acceptance Scenarios**:

1. **Given** 用户运行 `spectra community --min-size 5`，**When** 社区检测完成，**Then** 报告中仅展示节点数 >= 5 的社区，小社区的节点归入 "其他" 类别

---

### Edge Cases

- graph.json 中所有节点孤立（度数均为 0）→ 报告显示"无有效社区"，God Nodes 为空
- graph.json 只有 1-2 个节点 → 跳过社区检测，仅输出基础统计
- 某社区包含超过 25% 总节点 → 触发二次分裂
- 所有边为 `contains` 关系 → God Node 过滤后可能为空，报告说明原因
- 图规模超大（>5000 节点）→ betweenness 采样限制在 1000 次，保证性能

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 从 `_meta/graph.json`（NetworkX node-link 格式）加载知识图谱并构建内存图结构
- **FR-002**: 系统 MUST 执行 Louvain 社区检测算法，为每个节点分配 communityId
- **FR-003**: 系统 MUST 处理 oversized 社区：当某社区节点数 > 25% 总节点 且 >= 10 个节点时，对该社区子图执行二次分裂
- **FR-004**: 系统 MUST 计算每个社区的元数据：节点数、核心节点 Top 3（度数最高）、cohesion 评分（社区内边数 / 可能边数）
- **FR-005**: 系统 MUST 识别 God Node：度数 > 均值 + 2σ 的节点，并排除 `kind: 'package'` 节点、纯 `contains` 关系节点
- **FR-006**: 系统 MUST 发现 Surprising Connections：识别跨社区的高 betweenness 边，betweenness centrality 使用采样法（≤ 1000 次采样）
- **FR-007**: 系统 MUST 生成 `_meta/GRAPH_REPORT.md`，包含概述、God Nodes 表格、社区列表表格、Surprising Connections 表格、Knowledge Gaps 列表
- **FR-008**: 系统 MUST 提供 `spectra community [--min-size <N>]` CLI 命令
- **FR-009**: 系统 MUST 在 `_meta/graph.json` 不存在时输出友好提示并退出
- **FR-010**: 系统 MUST 集成到 batch-orchestrator 的 post-processing 链中，在 graph.json 构建之后自动执行

### Key Entities

- **Community**: 一组高度内聚的图节点集合，包含 communityId、节点列表、内聚度评分、核心节点
- **GodNode**: 连接度异常高的节点，包含 id、degree、主要关系类型、所属社区
- **SurprisingConnection**: 跨社区的高 betweenness 边，包含 source、target、跨社区标注、置信度

## Success Criteria

### Measurable Outcomes

- **SC-001**: 5,000 节点规模的图谱社区检测完成时间 < 5 秒
- **SC-002**: God Node 计算完成时间 < 1 秒
- **SC-003**: betweenness 近似计算（1000 采样）完成时间 < 3 秒
- **SC-004**: GRAPH_REPORT.md 生成完成时间 < 1 秒
- **SC-005**: 生成的报告结构完整，包含所有 5 个必需区块
- **SC-006**: graph.json 不存在时用户看到明确提示，无堆栈跟踪泄漏

## Assumptions

- Feature 101 (graph-persistence) 已完成，`_meta/graph.json` 格式稳定
- graphology + graphology-communities-louvain 是唯一新增运行时依赖
- 报告内容使用中文，节点名/路径保持英文
- God Node 过滤策略参考 Graphify 实现：排除文件级 hub（kind: 'package'）和纯容器节点（仅 contains 关系）
- Surprising Connections 评分参考 Graphify 的复合评分策略：置信度权重 + 跨社区加成

## Dependencies

- **Feature 101** (graph-persistence): 提供 `_meta/graph.json` 和 GraphJSON/GraphNode/GraphEdge 类型定义 ✅ 已完成
- **Downstream**: Feature 103 (multi-format-export) 和 Feature 105 (mcp-graph-query) 依赖本 Feature
