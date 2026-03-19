# Tasks: GeneratorRegistry 注册中心

**Input**: Design documents from `specs/036-generator-registry/`
**Prerequisites**: plan.md (required), spec.md (required), data-model.md

**Tests**: spec.md SC-005 明确要求单元测试覆盖 7 个核心场景，因此本任务清单包含测试任务且遵循 Tests First 策略。

**Organization**: 任务按 User Story 组织以支持增量交付。每个 Story 可独立实现和验证。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件、无依赖）
- **[Story]**: 所属 User Story（US1-US5）
- 所有路径均为项目根目录相对路径

---

## Phase 1: Setup

**Purpose**: 新增文件骨架，确保项目结构就绪

- [x] T001 创建 `src/panoramic/generator-registry.ts` 文件骨架——包含空的 `GeneratorRegistry` 类导出、`GeneratorEntry` 接口导出和 `bootstrapGenerators()` 函数导出（仅 stub，方法体留空或 throw 'not implemented'）
- [x] T002 [P] 创建 `tests/panoramic/generator-registry.test.ts` 测试文件骨架——import vitest describe/it/expect，import GeneratorRegistry 及相关类型，添加空 describe 块

**Checkpoint**: 文件结构就绪，`npm run build` 编译通过（stub 导出），`npm test` 可发现新测试文件

---

## Phase 2: Foundational (阻塞性前置)

**Purpose**: 实现 GeneratorEntry 接口和 GeneratorRegistry 的单例骨架——所有 User Story 依赖这些基础设施

- [x] T003 在 `src/panoramic/generator-registry.ts` 中定义 `GeneratorEntry` 接口——包含 `readonly generator: DocumentGenerator<any, any>` 和 `readonly enabled: boolean` 两个字段
- [x] T004 在 `src/panoramic/generator-registry.ts` 中实现 `GeneratorRegistry` 类的内部存储结构——private constructor、`generators: Map<string, DocumentGenerator<any, any>>`、`enabledState: Map<string, boolean>`、`generatorOrder: DocumentGenerator<any, any>[]`
- [x] T005 实现 `GeneratorRegistry.getInstance()` 和 `GeneratorRegistry.resetInstance()` 静态方法——参考 `src/adapters/language-adapter-registry.ts` 的单例模式

**Checkpoint**: 单例基础就绪，可获取空 Registry 实例

---

## Phase 3: User Story 1 — Generator 注册与 ID 冲突检测 (Priority: P1)

**Goal**: 实现 register() 方法的两阶段验证（ID 格式校验 + 冲突检测），确保 Registry 数据一致性

**Independent Test**: 创建 3+ 个 Mock Generator 实例注册到 Registry，验证注册成功；再注册 ID 重复的 Generator，验证抛出冲突错误且 Registry 状态不被污染

### Tests First (US1)

> **先写测试，确认失败，再实现**

- [x] T006 [P] [US1] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：注册 3 个不同 id 的 Mock Generator 后，list() 返回长度为 3 且按注册顺序排列
- [x] T007 [P] [US1] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：注册 id 重复的 Generator 时抛出包含冲突信息的 Error，Registry 中仍只保留原先实例
- [x] T008 [P] [US1] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：注册 id 不符合 kebab-case 格式（含大写/空格/特殊字符）时抛出格式错误，Registry 状态不变

### Implementation (US1)

- [x] T009 [US1] 在 `src/panoramic/generator-registry.ts` 的 `register()` 方法中实现 Phase A——使用 `GeneratorMetadataSchema` 的正则 `/^[a-z][a-z0-9-]*$/` 验证 `generator.id`，不符合时抛出格式错误（Error 消息包含非法 id 值）
- [x] T010 [US1] 在 `src/panoramic/generator-registry.ts` 的 `register()` 方法中实现 Phase B——检查 `generators.has(id)`，已存在时抛出冲突错误（Error 消息包含已注册 Generator 的 id 和 name），两阶段任一失败不修改任何内部状态
- [x] T011 [US1] 在 `src/panoramic/generator-registry.ts` 的 `register()` 方法中实现提交步骤——同时写入 `generators.set(id, generator)`、`enabledState.set(id, true)` 和 `generatorOrder.push(generator)`

**Checkpoint**: 运行 `npm test`，T006/T007/T008 对应测试全部通过

---

## Phase 4: User Story 2 — 按 ID 查询与全量列出 (Priority: P1)

**Goal**: 实现 get(id)、list()、isEmpty() 方法，提供 Registry 的核心读操作

**Independent Test**: 注册若干 Generator 后，通过 get(id) 查询存在和不存在的 id，验证返回正确实例或 undefined；通过 list() 获取全量列表，验证每条记录包含 Generator 实例及其启用/禁用状态

### Tests First (US2)

- [x] T012 [P] [US2] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：get("data-model") 返回对应 Generator 实例；get("non-existent-id") 返回 undefined，不抛出异常
- [x] T013 [P] [US2] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：list() 返回包含 3 个 GeneratorEntry 的数组，每个 entry 包含 generator 实例和 enabled 布尔状态
- [x] T014 [P] [US2] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：空 Registry 调用 isEmpty() 返回 true，注册后返回 false；空 Registry 调用 list() 返回空数组

### Implementation (US2)

- [x] T015 [P] [US2] 在 `src/panoramic/generator-registry.ts` 中实现 `get(id)` 方法——从 `generators` Map 中查找并返回，未命中返回 `undefined`
- [x] T016 [P] [US2] 在 `src/panoramic/generator-registry.ts` 中实现 `list()` 方法——遍历 `generatorOrder`，为每个 Generator 构建 `GeneratorEntry` 对象（包含 generator 实例引用和 `enabledState.get(id)` 状态），返回新数组（防御性拷贝）
- [x] T017 [P] [US2] 在 `src/panoramic/generator-registry.ts` 中实现 `isEmpty()` 方法——返回 `generatorOrder.length === 0`

**Checkpoint**: 运行 `npm test`，T012/T013/T014 对应测试全部通过

---

## Phase 5: User Story 3 — 按 ProjectContext 过滤适用 Generator (Priority: P1)

**Goal**: 实现 filterByContext() 异步方法，根据 ProjectContext 自动筛选出适用且启用的 Generator 子集

**Independent Test**: 创建 3+ 个 Mock Generator（isApplicable 分别返回 true、false、Promise<true>），注册到 Registry 并调用 filterByContext()，验证返回结果仅包含适用且启用的 Generator

### Tests First (US3)

- [x] T018 [P] [US3] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：3 个 Mock Generator（A: isApplicable 返回 true，B: 返回 false，C: 返回 Promise<true>），filterByContext() 返回 [A, C]
- [x] T019 [P] [US3] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：某个 Generator 的 isApplicable() 抛出运行时异常时，该 Generator 被跳过，不中断整体过滤流程，结果不包含它
- [x] T020 [P] [US3] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：空 Registry 调用 filterByContext() 返回空数组，不抛异常

### Implementation (US3)

- [x] T021 [US3] 在 `src/panoramic/generator-registry.ts` 中实现 `filterByContext(context: ProjectContext)` 方法——遍历 `generatorOrder`，跳过 `enabledState.get(id) === false` 的项，对启用项使用 `Promise.resolve(generator.isApplicable(context))` 统一包装同步/异步返回值
- [x] T022 [US3] 在 `filterByContext()` 方法中使用 `Promise.allSettled()` 并发执行所有 isApplicable 调用——对 rejected 的 Promise 记录 `console.warn` 警告并跳过，收集 fulfilled 且值为 true 的 Generator，按注册顺序返回

**Checkpoint**: 运行 `npm test`，T018/T019/T020 对应测试全部通过

---

## Phase 6: User Story 4 — 启用/禁用状态管理 (Priority: P2)

**Goal**: 实现 setEnabled() 方法，支持按 id 切换 Generator 的启用/禁用状态

**Independent Test**: 注册 Generator 后验证默认为启用状态；禁用后验证 list() 和 filterByContext() 行为变化；重新启用后验证状态恢复

### Tests First (US4)

- [x] T023 [P] [US4] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：新注册 Generator 默认 enabled = true；禁用后 list() 中该项 enabled 变为 false，filterByContext() 不再包含它
- [x] T024 [P] [US4] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：禁用后再启用，list() 中 enabled 恢复为 true，filterByContext() 重新包含它（前提 isApplicable 返回 true）
- [x] T025 [P] [US4] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：对不存在的 id 执行 setEnabled() 抛出包含明确错误信息的 Error

### Implementation (US4)

- [x] T026 [US4] 在 `src/panoramic/generator-registry.ts` 中实现 `setEnabled(id: string, enabled: boolean)` 方法——检查 `generators.has(id)`，不存在时抛出 `Error: Generator '${id}' not found in registry`；存在时更新 `enabledState.set(id, enabled)`

**Checkpoint**: 运行 `npm test`，T023/T024/T025 对应测试全部通过

---

## Phase 7: User Story 5 — 单例模式与测试支持 (Priority: P2)

**Goal**: 验证 GeneratorRegistry 单例行为正确，resetInstance() 可安全重置状态

**Independent Test**: 多次调用 getInstance() 验证返回同一实例；调用 resetInstance() 后再获取实例验证为全新空白实例

### Tests (US5)

> 注意：单例和 resetInstance 的实现已在 Phase 2 中完成（T005），此 Phase 仅补充对应的验证测试

- [x] T027 [P] [US5] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：连续两次调用 getInstance() 返回同一对象引用（=== 相等）
- [x] T028 [P] [US5] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：Registry 中已注册多个 Generator，调用 resetInstance() 后再 getInstance()，新实例 list() 返回空列表

**Checkpoint**: 运行 `npm test`，T027/T028 对应测试全部通过

---

## Phase 8: bootstrapGenerators 集成与入口调用

**Purpose**: 实现 bootstrapGenerators() 函数并将其接入 CLI 和 MCP 两个入口点

### Tests First

- [x] T029 [P] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：调用 bootstrapGenerators() 后 Registry 非空，包含 MockReadmeGenerator（id 为 "mock-readme"）
- [x] T030 [P] 在 `tests/panoramic/generator-registry.test.ts` 中编写测试：连续调用 bootstrapGenerators() 两次，Registry 中 Generator 数量不变，不抛出任何异常（幂等性）

### Implementation

- [x] T031 在 `src/panoramic/generator-registry.ts` 底部实现 `bootstrapGenerators()` 函数——获取单例，检查 `isEmpty()`（非空则直接 return），空时注册 `new MockReadmeGenerator()`
- [x] T032 [P] 在 `src/cli/index.ts` 的 `main()` 函数中，紧接 `bootstrapAdapters()` 之后添加 `bootstrapGenerators()` 调用——同时在文件顶部添加 `import { bootstrapGenerators } from '../panoramic/generator-registry.js';`
- [x] T033 [P] 在 `src/mcp/server.ts` 的 `createMcpServer()` 函数中，紧接 `bootstrapAdapters()` 之后添加 `bootstrapGenerators()` 调用——同时在文件顶部添加 `import { bootstrapGenerators } from '../panoramic/generator-registry.js';`

**Checkpoint**: 运行 `npm test`，T029/T030 对应测试通过；`npm run build` 编译通过零错误

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: 全局验证、代码质量和文档完善

- [x] T034 [P] 运行 `npm run build` 验证编译通过零错误，确认 `generator-registry.ts` 与 `interfaces.ts` 类型系统无冲突（SC-006）
- [x] T035 [P] 运行 `npm test` 验证所有测试通过（SC-005），检查测试覆盖 7 个核心场景：注册、冲突检测、查询、列出、过滤（含同步/异步 isApplicable）、启用/禁用切换、幂等初始化
- [x] T036 [P] 运行 `npm run lint` 验证代码风格无告警，修复可能存在的 lint 问题
- [x] T037 审查 `generator-registry.ts` 中的代码注释——确保所有公开方法有中文 JSDoc 注释，类注释包含职责说明和设计决策引用

---

## FR 覆盖映射表

| FR | 描述 | 覆盖任务 |
|----|------|----------|
| FR-001 | 单例模式 getInstance() / resetInstance() | T004, T005, T027, T028 |
| FR-002 | register() 方法 | T009, T010, T011, T006 |
| FR-003 | register() ID 冲突检测 | T010, T007 |
| FR-004 | register() ID 格式校验（kebab-case） | T009, T008 |
| FR-005 | get(id) 方法 | T015, T012 |
| FR-006 | list() 方法（含状态） | T016, T013 |
| FR-007 | filterByContext() 异步方法 | T021, T022, T018 |
| FR-008 | Promise.resolve() 统一包装同步/异步 | T021, T018 |
| FR-009 | filterByContext() 跳过禁用项 | T021, T023 |
| FR-010 | filterByContext() 异常容错 | T022, T019 |
| FR-011 | 启用/禁用管理 + 默认启用 | T026, T023, T024 |
| FR-012 | 不存在 id 的启用/禁用报错 | T026, T025 |
| FR-013 | bootstrapGenerators() 幂等注册 | T031, T029 |
| FR-014 | bootstrapGenerators() 多次调用不重复 | T031, T030 |
| FR-015 | isEmpty() 方法 | T017, T014 |
| FR-016 | 同文件或拆分模块灵活性 | T001（同文件方案） |

**FR 覆盖率**: 16/16 = **100%**

---

## Dependencies & Execution Order

### Phase 依赖关系

- **Phase 1 (Setup)**: 无依赖——可立即开始
- **Phase 2 (Foundational)**: 依赖 Phase 1 完成——**阻塞所有 User Story**
- **Phase 3 (US1 注册)**: 依赖 Phase 2 完成
- **Phase 4 (US2 查询/列出)**: 依赖 Phase 2 完成，与 Phase 3 无直接依赖但 list() 实现隐式依赖 register()
- **Phase 5 (US3 过滤)**: 依赖 Phase 3 (register) + Phase 4 (list)，因为 filterByContext 需要已注册的 Generator
- **Phase 6 (US4 启用/禁用)**: 依赖 Phase 3 (register)，可与 Phase 5 并行
- **Phase 7 (US5 单例测试)**: 依赖 Phase 2（实现已完成），纯测试任务，可与 Phase 3-6 并行
- **Phase 8 (bootstrap 集成)**: 依赖 Phase 3 (register) + Phase 4 (isEmpty)
- **Phase 9 (Polish)**: 依赖所有前序 Phase 完成

### User Story 间依赖

- **US1 (注册)** 和 **US2 (查询/列出)**: 同为 P1，US2 依赖 US1 的 register() 来填充数据
- **US3 (过滤)**: P1，依赖 US1+US2
- **US4 (启用/禁用)**: P2，依赖 US1（register），可与 US3 并行
- **US5 (单例)**: P2，仅需 Phase 2 基础设施，可最早开始测试

### Story 内部并行机会

- 每个 Story 的 Tests First 任务（标记 [P]）可并行编写
- US2 的三个 Implementation 任务（T015/T016/T017）可并行，因为它们操作不同方法
- Phase 8 的 T032/T033（CLI 和 MCP 入口修改）可并行
- Phase 9 的 T034/T035/T036 可并行

### 推荐实现策略

**MVP First（推荐）**:

1. Phase 1-2: Setup + Foundational（~15 min）
2. Phase 3: US1 注册（核心基础）
3. Phase 4: US2 查询/列出
4. Phase 5: US3 过滤（此时 3 个 P1 Story 全部就绪，核心功能可用）
5. **STOP and VALIDATE**: 运行 `npm test` + `npm run build`
6. Phase 6-8: P2 Stories + bootstrap 集成
7. Phase 9: Polish

**关键路径**: Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 8 -> Phase 9

---

## Notes

- 所有新代码位于 `src/panoramic/generator-registry.ts` 单文件内（FR-016 同文件方案）
- 测试文件为 `tests/panoramic/generator-registry.test.ts` 单文件
- 修改的现有文件仅 2 个：`src/cli/index.ts` 和 `src/mcp/server.ts`（各添加 1 行 import + 1 行调用）
- Mock Generator 在测试中内联定义，不需要额外的测试辅助文件
- 每个测试 describe 块前使用 `beforeEach(() => GeneratorRegistry.resetInstance())` 避免测试间污染
