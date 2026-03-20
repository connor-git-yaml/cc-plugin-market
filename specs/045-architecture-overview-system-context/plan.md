# Implementation Plan: 架构概览与系统上下文视图

**Branch**: `045-architecture-overview-system-context` | **Date**: 2026-03-20 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/045-architecture-overview-system-context/spec.md`

---

## Summary

实现 `ArchitectureOverviewGenerator`，把 `RuntimeTopologyGenerator`、`WorkspaceIndexGenerator` 和 `CrossPackageAnalyzer` 的结构化输出组合为统一的 `ArchitectureOverviewModel`，再渲染为一份可读的架构概览文档。045 的职责是 **组合与视图建模**，不是重复解析 Dockerfile / Compose / workspace / dependency graph。

本 Feature 的技术重点有三点：

1. 通过组合现有 panoramic generator 的输出，保证 045 与 043 / 041 语义一致
2. 在 `generate()` 阶段产出模板无关的结构化架构视图模型，为 050 直接复用
3. 在上游输入不完整时做版块级降级，而不是整份文档失败

---

## Technical Context

**Language/Version**: TypeScript 5.7.3, Node.js >= 20  
**Primary Dependencies**: 现有 panoramic generators、`handlebars`、`zod`、Node.js built-ins  
**Storage**: 文件系统（`specs/` 文档、`templates/`、`tests/`）  
**Testing**: `vitest`, `npm run lint`, `npm run build`  
**Target Platform**: Node.js CLI / MCP panoramic pipeline  
**Project Type**: 单仓库 TypeScript project  
**Performance Goals**: 单次 045 生成应复用上游结构化输出与现有扫描逻辑，不引入明显高于 043/040/041 串行组合的额外复杂度  
**Constraints**:

- 不新增 parser registry 或平行解析基础设施
- 不在 045 中重新解析 Dockerfile / Compose / workspace / import graph
- 045 只预留 050 共享结构，不提前实现模式提示与解释
- 045 需兼容缺失 runtime / workspace / cross-package 输入的降级场景
- 所有写操作限于 `specs/045-architecture-overview-system-context/`、`src/panoramic/`、`templates/`、`tests/`

**Scale/Scope**: 1 个新 generator、1 份共享架构视图模型、1 个模板、若干测试与 registry / barrel 集成

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| **I. 双语文档规范** | 适用 | PASS | 文档和 spec 以中文叙述，代码标识符与路径保持英文 |
| **II. Spec-Driven Development** | 适用 | PASS | 已按 spec -> plan -> tasks 路线推进 |
| **III. 诚实标注不确定性** | 适用 | PASS | 缺失上游输入时将显式输出 warning / missing section |
| **IV. AST / 静态提取优先** | 适用 | PASS | 045 不重新解析源码事实，直接消费静态结构化输出 |
| **V. 混合分析流水线** | 部分适用 | PASS | 本 Feature 不引入 LLM 语义推断，只做组合式建模 |
| **VI. 只读安全性** | 适用 | PASS | 仅修改允许的源代码、模板、测试和 spec 制品 |
| **VII. 纯 Node.js 生态** | 适用 | PASS | 无新增非 Node 运行时依赖 |
| **X. 质量门控不可绕过** | 适用 | PASS | 保留 design/tasks/verify 门禁 |
| **XI. 验证铁律** | 适用 | PASS | 后续实现必须附带真实 lint/build/test 证据 |

**结论**: 当前设计通过，无需豁免。

---

## Project Structure

### Documentation (this feature)

```text
specs/045-architecture-overview-system-context/
├── spec.md
├── research/
│   └── tech-research.md
├── research.md
├── plan.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── architecture-overview-output.md
├── checklists/
│   ├── requirements.md
│   └── architecture.md
└── tasks.md
```

### Source Code (repository root)

```text
src/panoramic/
├── architecture-overview-generator.ts   # [新增] 045 组合式 generator
├── architecture-overview-model.ts       # [新增] 045/050 共享架构视图模型
├── generator-registry.ts                # [修改] 注册 architecture-overview
├── index.ts                             # [修改] 导出 generator + 共享模型
├── runtime-topology-generator.ts        # [复用，不重构事实提取]
├── workspace-index-generator.ts         # [复用]
└── cross-package-analyzer.ts            # [复用]

templates/
└── architecture-overview.hbs            # [新增] 架构概览模板

tests/panoramic/
└── architecture-overview-generator.test.ts  # [新增] 单元 / 组合测试
```

**Structure Decision**: 045 只在 `src/panoramic/` 新增组合层与共享 view model，不改动 parser 基础设施，也不新增 CLI / batch 特殊分支。

---

## Phase 0: Research Decisions

### 决策 1: 使用 Composite Generator，而不是重复解析

- **Decision**: `ArchitectureOverviewGenerator.extract()` 内部组合调用 `RuntimeTopologyGenerator`、`WorkspaceIndexGenerator`、`CrossPackageAnalyzer`
- **Rationale**: 直接沿用现有抽象，保证 045 与上游结构化输出事实一致
- **Alternatives considered**:
  - 045 自己重解析原始文件：会复制逻辑并造成漂移
  - 045 只读磁盘上的渲染后文档：契约脆弱，不适合作为 050 输入

### 决策 2: 为 050 单独引入共享 `ArchitectureOverviewModel`

- **Decision**: 新增 `src/panoramic/architecture-overview-model.ts`
- **Rationale**: 让 045 的结构化输出与 Handlebars 模板解耦，050 可直接复用节点、关系和来源证据
- **Alternatives considered**:
  - 直接复用 `ArchitectureOverviewOutput` 作为共享边界：会把模板与文档元数据泄漏到 050
  - 只输出 Markdown：无法支撑后续增强层

### 决策 3: 采用版块级降级，而不是整体失败

- **Decision**: 对 system-context / deployment / layered 三个版块分别建模 availability 与 warning
- **Rationale**: 兼容单体项目、无 Compose 项目和缺失 monorepo 信号的项目
- **Alternatives considered**:
  - 任一输入缺失即失败：会降低 panoramic 在真实项目上的可用性

---

## Phase 1: Design & Contracts

### 1. Shared Model

新增 `src/panoramic/architecture-overview-model.ts`，定义以下共享实体：

- `ArchitectureOverviewModel`
- `ArchitectureViewSection`
- `ArchitectureViewNode`
- `ArchitectureViewEdge`
- `ArchitectureEvidence`
- `ArchitectureModuleSummary`
- `DeploymentUnitSummary`
- `ArchitectureOverviewStats`

**Design Rule**: 共享模型不包含标题、Markdown、Handlebars 字段；只承载 045/050 共享结构化事实。

### 2. Generator Design

新增 `src/panoramic/architecture-overview-generator.ts`：

- `id = 'architecture-overview'`
- `isApplicable(context)`
- `extract(context)`
- `generate(input)`
- `render(output)`

#### `extract()` 设计

1. 检查上游 generator 的 `isApplicable()`
2. 按适用性分别调用：
   - `RuntimeTopologyGenerator.extract()/generate()`
   - `WorkspaceIndexGenerator.extract()/generate()`
   - `CrossPackageAnalyzer.extract()/generate()`
3. 对不可用或失败的输入记录 warning，而不是中断整个 045

#### `generate()` 设计

1. 基于 `RuntimeTopology` 生成 deployment view：
   - 服务、容器、镜像、target stage、依赖关系
2. 基于 `WorkspaceOutput` + `CrossPackageOutput` 生成 layered view：
   - workspace 分组
   - 包级依赖 / level / cycle group
   - 模块职责摘要
3. 基于以上结果生成 system context view：
   - 项目节点
   - 关键服务节点
   - 关键模块组节点
   - 系统级关系边
4. 计算 availability、stats、warnings 和 evidence

#### `render()` 设计

通过 `templates/architecture-overview.hbs` 输出：

- 文档元信息
- summary + warnings
- Mermaid system context
- Mermaid deployment view
- Mermaid layered view
- 模块职责摘要表
- 缺失版块说明

### 3. Mermaid Rendering

045 需要生成三类 Mermaid 文本：

- `systemContextDiagram`
- `deploymentDiagram`
- `layeredDiagram`

渲染策略：

- 限制系统上下文节点数量，只保留项目、入口服务、关键模块组和核心依赖
- 部署视图直接引用 043 的服务/容器/image 关系
- 分层视图以 workspace group 和包级核心依赖为主，循环依赖保留警告标记

### 4. Contracts

在 `contracts/architecture-overview-output.md` 中定义：

- 结构化输入边界
- 结构化输出边界
- 渲染必备版块
- 降级行为约定

### 5. Agent Context Update

运行 `.specify/scripts/bash/update-agent-context.sh codex`，同步 045 的技术上下文。

---

## Verification Strategy

1. 定向单元 / 组合测试：
   - `npx vitest run tests/panoramic/architecture-overview-generator.test.ts`
2. 回归相关 panoramic 测试：
   - `tests/panoramic/runtime-topology-generator.test.ts`
   - `tests/panoramic/workspace-index-generator.test.ts`
   - `tests/panoramic/cross-package-analyzer.test.ts`
   - `tests/panoramic/generator-registry.test.ts`
3. 静态验证：
   - `npm run lint`
   - `npm run build`
4. 提交前主线同步：
   - `git fetch origin && git rebase origin/master`

---

## Risks & Mitigations

- **风险**: 045 输出与 043 / 041 事实漂移  
  **缓解**: 只复用上游结构化输出，不重推导底层关系

- **风险**: Mermaid 图过度复杂，文档不可读  
  **缓解**: 视图模型先做聚合，只展示关键节点和高价值关系

- **风险**: 部分项目缺少 monorepo 或运行时信号  
  **缓解**: 建立 availability / warning 机制，版块级降级

- **风险**: 050 需要解释链但 045 未保留证据  
  **缓解**: 在 `ArchitectureOverviewModel` 中保留 `ArchitectureEvidence[]`

---

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 无 | N/A | 当前方案无需为宪法违规做豁免 |
