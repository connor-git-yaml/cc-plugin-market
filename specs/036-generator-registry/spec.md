# Feature Specification: GeneratorRegistry 注册中心

**Feature Branch**: `036-generator-registry`
**Created**: 2026-03-19
**Status**: Draft
**Input**: User description: "实现 Generator 的注册、发现和启用/禁用管理的中心化注册机制"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generator 注册与 ID 冲突检测 (Priority: P1)

作为系统的初始化流程，在应用启动时通过 `bootstrapGenerators()` 函数将所有内置 DocumentGenerator 实例注册到 GeneratorRegistry 中，并在注册时自动检测 ID 冲突——如果两个 Generator 使用了相同的 id，注册过程应立即报错以防止静默覆盖。

**Why this priority**: Generator 注册是整个全景文档化能力的基础设施。没有注册机制，后续所有 Phase 1-3 的 Generator 无法被发现和调度。ID 冲突检测保障了 Registry 数据一致性，是安全运行的前提。

**Independent Test**: 创建 3+ 个 Mock Generator 实例，调用 register() 逐一注册，验证注册成功；再注册一个 id 重复的 Generator，验证抛出冲突错误且 Registry 状态不被污染。

**Acceptance Scenarios**:

1. **Given** 一个空的 GeneratorRegistry 实例，**When** 依次注册 3 个拥有不同 id 的 Mock Generator，**Then** Registry 内部持有这 3 个 Generator，通过 list() 返回的列表长度为 3，且按注册顺序排列
2. **Given** 已注册了 id 为 "mock-readme" 的 Generator，**When** 再次注册一个 id 也为 "mock-readme" 的不同 Generator 实例，**Then** register() 抛出包含冲突信息的 Error，Registry 中仍只保留原先注册的那一个实例
3. **Given** CLI 或 MCP 入口调用 bootstrapGenerators()，**When** 再次调用 bootstrapGenerators()，**Then** 函数幂等执行——不会重复注册已有的 Generator，Registry 状态不变

---

### User Story 2 - 按 ID 查询与全量列出 (Priority: P1)

作为全景文档化流程的调度器，在需要执行特定 Generator 时能够通过 id 精确查找到对应的 Generator 实例；在需要展示所有可用 Generator 时，能够列出全量列表并附带每个 Generator 的启用/禁用状态。

**Why this priority**: 查询和列出是 Registry 的核心读操作，与注册同等重要。按 id 查询是后续编排器（batch-orchestrator）定向调度的基础；全量列出是用户查看和管理 Generator 的入口。

**Independent Test**: 注册若干 Generator，通过 get(id) 查询存在和不存在的 id，验证返回正确的实例或 null/undefined；通过 list() 获取全量列表，验证每条记录包含 Generator 实例及其启用/禁用状态。

**Acceptance Scenarios**:

1. **Given** Registry 中已注册 id 为 "mock-readme"、"data-model"、"config-ref" 的 3 个 Generator，**When** 调用 get("data-model")，**Then** 返回 id 为 "data-model" 的 Generator 实例
2. **Given** Registry 中已注册若干 Generator，**When** 调用 get("non-existent-id")，**Then** 返回 undefined（或 null），不抛出异常
3. **Given** Registry 中已注册 3 个 Generator 且 "config-ref" 被禁用，**When** 调用 list()，**Then** 返回包含 3 个条目的列表，每个条目包含 Generator 实例和 enabled 布尔状态，其中 "config-ref" 的 enabled 为 false，其余为 true

---

### User Story 3 - 按 ProjectContext 过滤适用 Generator (Priority: P1)

作为全景文档化的自动编排机制，在对某个项目执行文档生成时，根据项目的 ProjectContext（编程语言、包管理器、workspace 类型、配置文件等）自动筛选出适用于该项目的 Generator 子集，跳过不适用和已禁用的 Generator。

**Why this priority**: filterByContext 是 GeneratorRegistry 区别于 LanguageAdapterRegistry 的核心差异化能力，也是后续 batch-orchestrator 编排文档生成任务的关键依赖。它调用每个 Generator 的 isApplicable() 方法，需要正确处理同步和异步两种返回类型。

**Independent Test**: 创建 3+ 个 Mock Generator（isApplicable 分别返回 true、false、Promise<true>），注册到 Registry 并调用 filterByContext()，验证返回结果仅包含适用且启用的 Generator。

**Acceptance Scenarios**:

1. **Given** Registry 中注册了 3 个 Mock Generator：A（isApplicable 返回 true）、B（isApplicable 返回 false）、C（isApplicable 返回 Promise<true>），且全部启用，**When** 调用 filterByContext(projectContext)，**Then** 返回 [A, C]，不包含 B
2. **Given** Registry 中注册了 Generator D（isApplicable 返回 true）但 D 被禁用，**When** 调用 filterByContext(projectContext)，**Then** 返回结果中不包含 D
3. **Given** Registry 中注册了 5 个 Generator，其中 2 个的 isApplicable 返回异步 Promise<boolean>，**When** 调用 filterByContext(projectContext)，**Then** 所有异步结果被正确 await，返回的列表仅包含 isApplicable 解析为 true 且启用的 Generator

---

### User Story 4 - 启用/禁用状态管理 (Priority: P2)

作为高级用户或配置系统，能够对已注册的 Generator 进行启用/禁用切换，使得被禁用的 Generator 在 filterByContext 过滤和 list 展示中正确反映其状态，但不从 Registry 中物理移除。

**Why this priority**: 启用/禁用机制为用户提供了按需定制文档生成范围的能力，属于蓝图明确要求的功能。但相比注册、查询和过滤，它的使用频率较低，且初始阶段所有 Generator 默认启用即可满足基本需求。

**Independent Test**: 注册 Generator 后验证默认为启用状态；调用禁用操作后验证 list() 和 filterByContext() 的行为变化；再次调用启用操作后验证状态恢复。

**Acceptance Scenarios**:

1. **Given** 新注册一个 Generator，**When** 未执行任何启用/禁用操作，**Then** 该 Generator 默认状态为启用（enabled = true）
2. **Given** Registry 中 id 为 "mock-readme" 的 Generator 当前为启用状态，**When** 对其执行禁用操作，**Then** list() 中该 Generator 的 enabled 变为 false，filterByContext() 不再包含它
3. **Given** Registry 中 id 为 "mock-readme" 的 Generator 当前为禁用状态，**When** 对其执行启用操作，**Then** list() 中该 Generator 的 enabled 恢复为 true，filterByContext() 重新包含它（前提 isApplicable 返回 true）
4. **Given** 尝试对不存在的 id 执行启用/禁用操作，**When** 调用操作方法，**Then** 抛出包含明确错误信息的 Error

---

### User Story 5 - 单例模式与测试支持 (Priority: P2)

作为系统架构的一部分，GeneratorRegistry 以进程级单例形式运行，确保全局唯一性；同时提供 resetInstance() 方法供单元测试在用例之间重置状态，避免测试间污染。

**Why this priority**: 单例模式参考现有 LanguageAdapterRegistry 的成熟设计，保证全局一致性。resetInstance() 是测试可维护性的关键，但对运行时功能无影响。

**Independent Test**: 多次调用 getInstance() 验证返回同一实例；调用 resetInstance() 后再获取实例验证为全新空白实例。

**Acceptance Scenarios**:

1. **Given** 首次获取 GeneratorRegistry 实例，**When** 再次调用 getInstance()，**Then** 返回的是同一个对象引用（=== 相等）
2. **Given** Registry 中已注册多个 Generator，**When** 调用 resetInstance() 后再获取实例，**Then** 新实例中 list() 返回空列表，原先注册的 Generator 不存在

---

### Edge Cases

- **isApplicable 抛出异常**: 某个 Generator 的 isApplicable() 在 filterByContext 过程中抛出运行时异常时，该 Generator 应被跳过（视为不适用），不应导致整个过滤流程中断，同时应记录警告信息 [AUTO-RESOLVED: 采用防御性编程策略，与 LanguageAdapterRegistry 的容错设计一致。单个 Generator 的异常不应影响其他 Generator 的过滤结果]
- **空 Registry 调用 filterByContext**: Registry 中无任何注册 Generator 时调用 filterByContext()，应返回空数组而非抛出异常
- **空 Registry 调用 list**: Registry 中无任何注册 Generator 时调用 list()，应返回空数组
- **id 格式校验**: register() 应验证 Generator 的 id 符合 kebab-case 格式（与 GeneratorMetadataSchema 的正则约束 `/^[a-z][a-z0-9-]*$/` 一致），不符合时拒绝注册并抛出格式错误
- **bootstrapGenerators 在 Registry 已被外部填充后调用**: bootstrapGenerators() 的幂等逻辑应基于内容检查（而非空状态检查），避免外部已注册的 Generator 阻止内置 Generator 的注册 [AUTO-RESOLVED: 幂等检查采用标志位或已知 id 检查，参考 bootstrapAdapters() 的 isEmpty() 检查模式但适配内置 Generator 列表]

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 提供 `GeneratorRegistry` 类，实现进程级单例模式（`getInstance()` / `resetInstance()`），与现有 `LanguageAdapterRegistry` 的单例设计保持一致
- **FR-002**: 系统 MUST 提供 `register(generator)` 方法，接受 `DocumentGenerator` 实例并将其注册到 Registry 内部存储中
- **FR-003**: `register()` MUST 在注册前检测 id 冲突——当待注册 Generator 的 id 已存在于 Registry 中时，抛出包含冲突双方信息的 Error，且 Registry 状态不被修改
- **FR-004**: `register()` MUST 验证 Generator 的 id 符合 kebab-case 格式（匹配 `GeneratorMetadataSchema` 的正则 `/^[a-z][a-z0-9-]*$/`），不符合时拒绝注册
- **FR-005**: 系统 MUST 提供 `get(id)` 方法，按 id 查询单个已注册的 Generator 实例，id 不存在时返回 `undefined`
- **FR-006**: 系统 MUST 提供 `list()` 方法，返回所有已注册 Generator 的列表，每个条目包含 Generator 实例及其当前启用/禁用状态
- **FR-007**: 系统 MUST 提供 `filterByContext(projectContext)` 异步方法，遍历所有已注册且启用的 Generator，调用其 `isApplicable(context)` 方法，返回适用于当前项目的 Generator 列表
- **FR-008**: `filterByContext()` MUST 使用 `Promise.resolve()` 统一包装 `isApplicable()` 的同步/异步返回值，正确处理 `boolean | Promise<boolean>` 联合类型
- **FR-009**: `filterByContext()` MUST 跳过已禁用的 Generator，不调用其 `isApplicable()` 方法
- **FR-010**: `filterByContext()` SHOULD 对 `isApplicable()` 抛出异常的 Generator 采用防御性处理——跳过该 Generator 并记录警告，不中断整体过滤流程
- **FR-011**: 系统 MUST 提供启用/禁用管理能力，支持按 id 切换 Generator 的启用状态；新注册的 Generator 默认为启用状态
- **FR-012**: 启用/禁用操作 MUST 对不存在的 id 抛出明确错误
- **FR-013**: 系统 MUST 提供 `bootstrapGenerators()` 函数，幂等注册所有内置 Generator（至少包含 MockReadmeGenerator），该函数在 CLI 和 MCP 入口处紧接 `bootstrapAdapters()` 之后调用
- **FR-014**: `bootstrapGenerators()` MUST 具备幂等性——多次调用不会重复注册，不会抛出冲突错误
- **FR-015**: 系统 MUST 提供 `isEmpty()` 方法，返回 Registry 中是否无任何已注册 Generator 的布尔值，用于区分"未初始化"和"无适用 Generator"两种状态
- **FR-016**: 交付物 MAY 在 `generator-registry.ts` 文件内将 `GeneratorRegistry` 类和 `bootstrapGenerators()` 函数定义在同一模块中，也可按需拆分为独立模块

### Key Entities

- **GeneratorRegistry**: Generator 的中心化注册中心，维护 id 到 DocumentGenerator 实例的映射以及每个 Generator 的启用/禁用状态。进程级单例，全局唯一
- **GeneratorEntry**: list() 返回的列表条目数据结构，包含 Generator 实例引用和当前 enabled 布尔状态
- **bootstrapGenerators**: 幂等初始化函数，负责在应用启动时注册所有内置 Generator 到 Registry

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 注册 3 个以上 Mock Generator 后，通过 Registry 按 ProjectContext 过滤出适用的 Generator 子集，返回结果与各 Generator 的 isApplicable() 返回值完全一致
- **SC-002**: Registry 支持按 id 精确查询单个 Generator（命中返回实例，未命中返回 undefined），支持 list() 全量列出所有已注册 Generator 及其启用/禁用状态
- **SC-003**: 对已注册 Generator 执行禁用后，filterByContext() 不再返回该 Generator；重新启用后恢复正常过滤行为
- **SC-004**: bootstrapGenerators() 连续调用两次，Registry 中 Generator 数量不变，不抛出任何异常
- **SC-005**: 所有单元测试通过（`npm test` 退出码 0），测试覆盖注册、冲突检测、查询、列出、过滤（含同步/异步 isApplicable）、启用/禁用切换、幂等初始化共 7 个核心场景
- **SC-006**: `npm run build` 编译通过零错误，`generator-registry.ts` 与现有 `interfaces.ts` 类型系统无冲突
