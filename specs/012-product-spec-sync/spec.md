# Feature Specification: 产品规范聚合（--sync）

**Feature Branch**: `012-product-spec-sync`
**Created**: 2026-02-15
**Status**: Implemented
**Input**: 为 Speckit Driver Pro 新增产品规范聚合功能（--sync 模式），将增量功能 spec（specs/NNN-xxx/）智能合并为产品级活文档（specs/products/<product>/current-spec.md），解决"有增量记录但无全景视图"的规范管理缺口

## 背景与动机

随着项目积累 11 个增量功能 spec（001-010 属于 reverse-spec，011 属于 speckit-driver-pro），出现了一个结构性问题：没有任何一份文档描述某个产品的完整当前状态。开发者需要阅读并在脑中"合并"多个 spec 才能理解产品全貌。

这是软件工程中的经典问题——增量记录（delta log）与聚合现状（living document）的关系。参考行业最佳实践（Rust RFC vs Reference、Python PEP vs Language Reference、TC39 提案 vs ECMAScript 年度规范），采用"双层规范架构"：增量 spec 作为历史记录（类 RFC），产品级活文档反映当前状态（类 Reference）。

**关键设计决策**：不改动现有 `specs/NNN-xxx/` 目录结构（避免影响 Speckit 脚本的 30+ 处路径引用），而是新增 `specs/products/` 目录作为聚合层。

## User Scenarios & Testing

### User Story 1 - 增量 spec 聚合为产品活文档 (Priority: P1)

项目维护者在完成一轮功能实现后，运行 `/speckit-driver-pro --sync`，系统自动扫描所有增量 spec 目录，按产品归属分组，将每个产品的多个 spec 智能合并为一份 current-spec.md。合并时遵循时间顺序和类型规则（INITIAL 作为基础，FEATURE 追加，FIX 更新行为，REFACTOR 替换架构，ENHANCEMENT 增强描述），最终产出反映产品当前完整状态的活文档。

**Why this priority**: 这是该功能的核心能力——智能合并增量 spec 为产品全景。没有这个能力，产品级视图需要人工手动维护，既耗时又容易遗漏。

**Independent Test**: 在包含 11 个增量 spec（分属 2 个产品）的项目上运行 --sync，检查 specs/products/ 下是否为每个产品生成了 current-spec.md，且内容包含所有活跃功能的合并描述。

**Acceptance Scenarios**:

1. **Given** specs/ 下存在 11 个 NNN-xxx 功能目录, **When** 运行 --sync, **Then** 系统正确识别出 2 个产品（reverse-spec 和 speckit-driver-pro）并为每个产品生成 current-spec.md
2. **Given** reverse-spec 有 10 个增量 spec（含 INITIAL/FEATURE/FIX/REFACTOR/ENHANCEMENT 类型）, **When** 生成活文档, **Then** 活文档中功能列表正确反映合并后的状态：FIX 更新了行为描述、REFACTOR 替换了旧架构、被取代的功能标记为"已废弃"
3. **Given** 某个产品只有 1 个 spec（初始版本）, **When** 生成活文档, **Then** 仍生成 current-spec.md（简化版，基本等于原 spec 的重新格式化）
4. **Given** 已有 specs/products/product-mapping.yaml 且用户手动编辑过, **When** 重新运行 --sync, **Then** 保留用户手动添加的映射条目不被覆盖

---

### User Story 2 - 产品归属自动判定与映射管理 (Priority: P2)

系统能自动分析每个增量 spec 的内容，判定其属于哪个产品（通过标题关键词、功能领域、技术栈等线索）。判定结果持久化到 product-mapping.yaml，用户可手动编辑覆盖。手动映射在重跑 sync 时不被自动推断覆盖。

**Why this priority**: 产品归属的准确性直接决定聚合质量。自动判定减少人工配置负担，手动覆盖提供纠错能力。

**Independent Test**: 在一个新项目中添加多个不同产品的 spec，运行 --sync，检查 product-mapping.yaml 中的归属是否正确，且手动修改后重跑不会丢失手动条目。

**Acceptance Scenarios**:

1. **Given** 一个 spec 标题包含产品名"Reverse-Spec", **When** 自动判定归属, **Then** 正确归类到 reverse-spec 产品
2. **Given** 一个修复类 spec（如 fix-batch-quality）, **When** 自动判定归属, **Then** 根据修复对象（batch 属于 reverse-spec）正确归类
3. **Given** 一个无法明确判定归属的 spec, **When** 自动判定失败, **Then** 标记为"unclassified"并在报告中提示，不阻断其他产品的聚合
4. **Given** product-mapping.yaml 中有用户手动添加的条目, **When** 重新运行 --sync, **Then** 手动条目保留不变

---

### Edge Cases

- 当某个 spec 目录下没有 spec.md 文件时，跳过该目录并记录警告
- 当两个 spec 对同一功能的描述存在冲突时，编号更大（更新）的 spec 优先
- 当 REFACTOR 类型的 spec 大幅改变产品架构时，旧架构描述被新描述替换，旧内容不保留在活文档中
- 当 specs/products/ 目录不存在时，自动创建
- 当重复运行 --sync 但增量 spec 无变化时，生成结果应幂等（内容相同）

## Requirements

### Functional Requirements

- **FR-024**: 系统 MUST 支持 `--sync` 参数，触发独立的产品规范聚合流程（不执行标准 10 阶段工作流）
- **FR-025**: 系统 MUST 扫描 `specs/` 下所有匹配 `NNN-*` 模式的功能目录，读取每个目录中的 spec.md
- **FR-026**: 系统 MUST 自动判定每个增量 spec 的产品归属，并将结果持久化到 `specs/products/product-mapping.yaml`
- **FR-027**: 系统 MUST 保留 product-mapping.yaml 中用户手动编辑的条目，自动推断不覆盖手动映射
- **FR-028**: 系统 MUST 按时间顺序和类型规则（INITIAL/FEATURE/FIX/REFACTOR/ENHANCEMENT）智能合并增量 spec
- **FR-029**: 系统 MUST 为每个产品生成 `specs/products/<product>/current-spec.md`，包含产品概述、当前功能全集、技术架构、变更历史等完整内容
- **FR-030**: 活文档 MUST 明确标注每个功能的来源 spec 和状态（活跃/已更新/已废弃）
- **FR-031**: 活文档 MUST 包含变更历史索引，链接到每个增量 spec 的原始文件
- **FR-032**: 系统 MUST 在聚合完成后输出结构化报告，包含扫描 spec 数、产品数、每个产品的功能统计
- **FR-033**: 聚合流程 MUST 不修改任何增量 spec 原始文件（只读操作）
- **FR-034**: 聚合结果 MUST 幂等——相同输入重复运行产生相同输出

### Key Entities

- **产品映射 (Product Mapping)**: product-mapping.yaml 文件，记录每个增量 spec 属于哪个产品，支持手动覆盖
- **产品活文档 (Product Living Spec)**: specs/products/<product>/current-spec.md，反映某个产品的当前完整状态
- **Sync 子代理 (Sync Sub-Agent)**: agents/sync.md，负责扫描、归属判定、智能合并的专业子代理
- **聚合类型 (Spec Type)**: INITIAL/FEATURE/FIX/REFACTOR/ENHANCEMENT，决定合并策略

## Success Criteria

### Measurable Outcomes

- **SC-007**: 运行 --sync 后，每个已识别产品的 current-spec.md 包含该产品所有活跃功能的合并描述，覆盖率 100%
- **SC-008**: product-mapping.yaml 的产品归属准确率 ≥ 95%（标准项目中，最多 1 个 spec 需手动修正归属）
- **SC-009**: 活文档的功能列表正确反映合并语义：FIX 不新增功能、REFACTOR 替换旧架构、被取代功能标记为废弃
- **SC-010**: 重复运行 --sync（增量 spec 无变化时）产出内容一致（幂等）

### Assumptions

- 项目使用 Speckit 的标准目录结构（specs/NNN-xxx/spec.md）
- 增量 spec 的编号反映时间顺序（编号大 = 更新）
- 每个增量 spec 属于且仅属于一个产品（不支持跨产品 spec）
- sync 子代理始终使用 Opus 模型（聚合分析需要深度推理）
