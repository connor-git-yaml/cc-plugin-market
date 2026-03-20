# Feature Research: 架构中间表示（Architecture IR）导出

**Feature**: `056-architecture-ir-export`  
**Date**: 2026-03-20  
**Blueprint Source**: `specs/054-multi-source-doc-system-blueprint/blueprint.md` § `5.1 Phase 0`

---

## Research Scope

本次调研只回答 056 的三个核心问题：

1. 统一事实源应从哪里来，才能避免与 043/045/053 漂移
2. `ArchitectureIR` 应该如何建模，才能同时支撑 JSON、Structurizr DSL 和 Mermaid 互通
3. 如何接入现有 panoramic batch / registry / multi-format 流程，而不破坏现有输出合同

---

## Existing Fact Sources

### 1. `architecture-overview` 已经是最接近 IR 的统一结构入口

- `ArchitectureOverviewGenerator` 组合消费：
  - `runtime-topology`
  - `workspace-index`
  - `cross-package-deps`
- 它已经把事实统一为：
  - `ArchitectureViewSection`
  - `ArchitectureViewNode`
  - `ArchitectureViewEdge`
  - `ArchitectureEvidence`
- 045 的设计目标本身就包含“模板无关的结构化架构视图模型，为后续能力复用”。

**结论**: 056 应优先从 `ArchitectureOverviewOutput.model` 做结构映射，再按需补充 runtime/workspace/cross-package 的附加字段，而不是重新扫描源码或配置。

### 2. `runtime-topology` 提供部署细节，适合补全 deployment IR

- `RuntimeTopologyOutput.topology` 已包含：
  - service / container / image / stage
  - dependsOn / ports / env / build stage
- 这些字段比 045 的部署摘要更细，适合作为 deployment view 的补充属性来源。

**结论**: deployment IR 的主骨架来自 045，细节属性来自 043。

### 3. `workspace-index` 与 `cross-package-deps` 适合补全 component / dependency 视图

- `WorkspaceOutput` 提供 package、group、dependencyDiagram
- `CrossPackageOutput` 提供分层、拓扑顺序、循环依赖和统计

**结论**: component 基础实体映射可直接复用 workspace package/group；跨包关系优先沿用 cross-package 事实，不重新构建 import graph。

---

## Key Decisions

### 决策 1: `ArchitectureIR` 是新的统一事实模型，但不替代上游 generator

- **Decision**: 新增共享 `ArchitectureIR` 模型和 builder；045/043/040/041 继续负责事实提取，056 负责统一映射与导出。
- **Rationale**: 满足蓝图“统一建模 + 导出，不重写既有 generator”的要求。
- **Rejected alternatives**:
  - 直接让每个视图各自输出 Structurizr：会形成多套事实源
  - 让 Structurizr DSL 成为事实源：违背蓝图“Structurizr 只是导出合同”

### 决策 2: 045 结构模型作为主入口，043/040/041 作为补充证据与属性

- **Decision**: builder 输入优先接受 `ArchitectureOverviewOutput`，然后选配 `RuntimeTopologyOutput`、`WorkspaceOutput`、`CrossPackageOutput`。
- **Rationale**: 保证 system context / deployment / component 的实体和关系与现有 Mermaid/Markdown 架构输出一致。
- **Impact**: 056 可以“无损复用” 045 关系，不需要重新解析 Dockerfile、Compose、workspace 或 AST。

### 决策 3: Mermaid 互通采用“适配层”，不再维护第二套 Mermaid 专用模型

- **Decision**: 从 `ArchitectureIR.views` 导出 Mermaid 互通对象与聚合 `.mmd` 源码。
- **Rationale**: 满足“IR 与 Mermaid 有明确互通规则，而不是两套互不兼容的数据结构”。
- **Impact**: 045 现有 Mermaid section 可映射到 IR view；056 输出也可重新生成 Mermaid。

### 决策 4: 扩展 multi-format writer 以支持额外导出文件

- **Decision**: 保持 `markdown/json/all` 枚举不变，在 `all` 模式下允许额外写出 `structurizr.dsl`。
- **Rationale**: 满足现有 output format 合同兼容，同时实现新增导出类型。
- **Impact**:
  - `markdown`: 仅 `.md`
  - `json`: 仅 `.json`
  - `all`: `.md` + `.json` + 可选 `.mmd` + 可选 `.dsl`

---

## Proposed IR Shape

`ArchitectureIR` 至少需要覆盖以下概念：

- `metadata`
  - project name
  - generatedAt
  - sources / warnings / stats
- `elements`
  - `softwareSystem`
  - `container`
  - `component`
  - `deploymentNode`
  - `infrastructureNode`
  - `externalSystem`
- `relationships`
  - source / destination
  - interaction / dependency type
  - protocol / description / evidence / source tags
- `views`
  - `systemContext`
  - `deployment`
  - `component`
- `exports`
  - structurizr DSL
  - JSON-ready payload
  - Mermaid interoperability descriptor

**Mapping Rule**:

- `architecture-overview.section=system-context` -> IR `views.systemContext`
- `architecture-overview.section=deployment` -> IR `views.deployment`
- `architecture-overview.section=layered` -> IR `views.component`
- `ArchitectureEvidence.source` -> IR source tags / evidence
- `runtime services/containers/images` -> IR deployment/container metadata
- `workspace groups/packages` -> IR component hierarchy
- `cross-package deps` -> IR component relationships

---

## Verification Strategy

056 需要至少三层验证：

1. **Builder unit tests**: 验证 045/043/040/041 组合输出能稳定映射为单一 `ArchitectureIR`
2. **Exporter tests**: 验证 JSON 与 Structurizr DSL 都包含 system context / deployment 所需实体
3. **Integration tests**: 验证 generator registry + batch 输出链路可以真实写出 `.md/.json/.mmd/.dsl`

如条件允许，再用当前仓库或一个真实 fixture 跑一次样例导出，并写入 verification report。

---

## Research Outcome

056 最稳妥的实现路径是：

1. 以 045 `ArchitectureOverviewModel` 为统一结构主入口
2. 用 043/040/041 的结构化输出补齐属性与证据
3. 新增 `ArchitectureIR` + builder + exporter + Mermaid adapter
4. 以新的 panoramic generator 接入 registry / batch
5. 通过现有 multi-format 流程写出 JSON/Mermaid，并在 `all` 模式额外写出 `structurizr.dsl`

这条路径满足蓝图依赖、最小侵入和双端兼容要求。
