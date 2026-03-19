# Feature Specification: 文档图谱与交叉引用索引

**Feature Branch**: `044-doc-graph-cross-reference-index`
**Created**: 2026-03-20
**Status**: Implemented
**Input**: User description: "开发 044 这条路，实现 DocGraphBuilder 与 CrossReferenceIndex"

---

## User Scenarios & Testing

### User Story 1 - 自动插入关联 Spec 链接 (Priority: P1)

作为阅读生成 spec 的开发者，我希望每份模块 spec 中都能自动出现关联 spec 链接，这样我可以从当前模块快速跳转到内部关联模块或被引用模块，而不需要手工搜索整个 `specs/` 目录。

**Why this priority**: 这是蓝图 044 的首要用户价值，也是 046 的前置基础设施。没有自动互链，文档图谱只能停留在调试信息层，用户无法直接感知收益。

**Independent Test**: 对一个包含“同模块内部引用 + 跨模块引用”的 fixture 构建图谱并应用 CrossReferenceIndex，验证输出 spec Markdown 中同时出现自链接摘要和跨模块 spec 链接，链接路径与 anchor 有效。

**Acceptance Scenarios**:

1. **Given** 一个目录模块 spec，且模块内多个文件之间存在相对 import，**When** 应用 CrossReferenceIndex 渲染 spec，**Then** 文档中出现“同模块引用”链接，指向当前 spec 的稳定 anchor，并标注内部引用计数或样例文件。
2. **Given** 模块 `src/api` 依赖模块 `src/core`，且两者均已生成 spec，**When** 渲染 `src/api.spec.md`，**Then** 文档中出现指向 `src/core.spec.md#module-spec` 的跨模块链接。
3. **Given** 目标模块 spec 不存在，**When** 构建文档图谱，**Then** 当前 spec 不生成断链，而是将该依赖记录到缺口节点列表中。

---

### User Story 2 - 构建源码模块到 spec 的统一图谱 (Priority: P1)

作为后续 046 覆盖率审计的实现者，我希望系统能生成统一的文档图谱，明确表示“源码模块 -> spec 文件 -> 引用边 -> 缺口节点”，这样后续能力可以直接复用这份基础设施，而不是重新解析同一批事实。

**Why this priority**: 044 在蓝图中被定义为 046 的共享基础设施。如果没有统一图谱，后续覆盖率统计只能重复扫描 `specs/` 和源码，设计就偏离了“共享抽取、不同渲染”。

**Independent Test**: 对一组 ModuleSpec 和一个 DependencyGraph 运行 DocGraphBuilder，验证输出图谱中包含完整的 source-to-spec 映射、引用边和缺口节点。

**Acceptance Scenarios**:

1. **Given** 一个依赖图包含 4 个源码模块，其中 3 个已有 spec，**When** 构建文档图谱，**Then** 图谱中包含 3 条 source-to-spec 映射，以及 1 个 missing-spec 节点。
2. **Given** 一组已有 spec 文件中只有部分文档已包含交叉引用区块，**When** 从磁盘扫描图谱，**Then** 图谱能正确区分 `linked` 与 `unlinked` 两类 spec 节点。

---

### User Story 3 - 输出图谱调试/序列化结果 (Priority: P2)

作为维护者，我希望 044 在批处理后输出一份 JSON 调试文件，这样我可以直接查看模块映射、交叉引用和缺口诊断结果，便于排查为什么某些 spec 没有被互链。

**Why this priority**: 这是验证 044 正确性的最低成本手段，也直接支撑后续 046 的 coverage 报告实现。

**Independent Test**: 对一个小型项目运行 batch + 044 集成流程，验证输出目录中存在 doc-graph JSON 文件，且包含映射、引用和缺口字段。

**Acceptance Scenarios**:

1. **Given** 一个项目 batch 完成后，**When** 044 集成逻辑执行，**Then** 输出目录中生成 `doc-graph.json` 或等价调试文件，包含 `sourceToSpec`、`references`、`missingSpecs`、`unlinkedSpecs`。

---

## Edge Cases

- **root 散文件**：当 batch 将根目录散文件逐个生成为单文件 spec 时，DocGraphBuilder 必须按精确文件路径匹配 spec，而不是强行归并到 `root`。
- **目录模块与单文件模块并存**：路径匹配应优先使用 `ModuleSpec.frontmatter.relatedFiles` 与最长前缀规则，避免 `src/api.ts` 被错误映射到 `src/api/` 目录 spec。
- **跳过生成的旧 spec**：如果本次 batch 因 `force=false` 跳过某些 spec，044 仍应能从磁盘读取这些 spec 作为可链接目标。
- **无关联引用的模块**：允许不渲染“关联 Spec”区块，但图谱 JSON 中仍应存在该模块节点。
- **目标 spec 已存在但尚未互链**：应归类为 `unlinked`，不是 `missing`。

---

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 新增 `DocGraphBuilder`，构建“源码模块 / spec / 引用 / 缺口”的统一图谱。
- **FR-002**: 系统 MUST 从 `DependencyGraph` 中解析文件级引用，并映射到模块级 spec 节点。
- **FR-003**: 系统 MUST 基于 `ModuleSpec.frontmatter.sourceTarget`、`relatedFiles` 和 `outputPath` 建立 `source module -> spec file` 映射。
- **FR-004**: 系统 MUST 区分两种引用：
  - 同模块引用：多个文件级引用归并到当前模块 spec 的自链接
  - 跨模块引用：指向其他模块 spec 的链接
- **FR-005**: 系统 MUST 能识别“应生成但尚未生成”的 missing-spec 节点。
- **FR-006**: 系统 MUST 能识别“已生成但未互链”的 unlinked-spec 节点。
- **FR-007**: 系统 MUST 新增 `CrossReferenceIndex`，将图谱转换为 `ModuleSpec` 的结构化交叉引用数据。
- **FR-008**: 系统 MUST 在 `module-spec.hbs` 中渲染交叉引用区块，并提供稳定 anchor 供其他 spec 跳转。
- **FR-009**: 系统 MUST 在批处理流程中集成 044，使 batch 生成的 spec 自动获得交叉引用链接。
- **FR-010**: 系统 MUST 输出图谱调试/序列化文件，供维护者和后续 046 复用。
- **FR-011**: 系统 SHOULD 能从磁盘扫描既有 spec，并解析最小 frontmatter 与互链状态。
- **FR-012**: 系统 SHOULD 保持单模块 generate 路径兼容，不因新增交叉引用字段破坏既有 render 行为。

### Key Entities

- **DocGraphSpecNode**: 表示一个 spec 节点，包含 sourceTarget、specPath、relatedFiles、linkStatus。
- **DocGraphReference**: 表示一条引用关系，包含 from、to、kind（same-module/cross-module）、targetAnchor。
- **DocGraphGap**: 表示缺口节点，包含 missing-spec 与 unlinked-spec 两类。
- **ModuleCrossReferenceIndex**: 注入到 `ModuleSpec` 的结构化交叉引用区块。

---

## Success Criteria

- **SC-001**: 对一个包含同模块与跨模块引用的 fixture，渲染后的 spec Markdown 中同时出现自链接和跨模块链接。
- **SC-002**: DocGraphBuilder 输出的图谱能正确列出 `source module -> spec file` 映射，并识别 missing/unlinked 两类节点。
- **SC-003**: batch 集成后，输出目录中出现 doc-graph 调试 JSON，且内容与实际 spec/依赖关系一致。
- **SC-004**: 新增或修改的 unit/integration tests 全部通过，`npm run lint` 和 `npm run build` 通过。
