# Tasks: 通用数据模型文档生成（Feature 038）

**Input**: Design documents from `/specs/038-data-model-doc/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup（基础类型定义）

**Purpose**: 定义 DataModelGenerator 所需的 Zod Schema 和 TypeScript 类型

- [x] T001 在 `src/panoramic/data-model-generator.ts` 中定义 DataModelField / DataModel / ModelRelation / DataModelInput / DataModelOutput 的 Zod Schema 和对应 TypeScript 类型，参照 `specs/038-data-model-doc/data-model.md` 的实体定义
- [x] T002 创建 `templates/data-model.hbs` Handlebars 模板，包含文档标题、统计摘要、按语言分组的模型字段表格和 Mermaid ER 图代码块

---

## Phase 2: Foundational（DataModelGenerator 骨架）

**Purpose**: 实现 DataModelGenerator 类骨架和 isApplicable() 方法，注册到 GeneratorRegistry

**⚠️ CRITICAL**: 后续所有 user story 实现都依赖此骨架

- [x] T003 在 `src/panoramic/data-model-generator.ts` 中实现 DataModelGenerator 类骨架，实现 `DocumentGenerator<DataModelInput, DataModelOutput>` 接口，包含 id/name/description 元数据和四个方法的占位实现
- [x] T004 实现 `isApplicable(context)` 方法：检查 `context.detectedLanguages` 是否包含 `'python'` 或 `'typescript'`
- [x] T005 在 `src/panoramic/generator-registry.ts` 的 `bootstrapGenerators()` 中注册 DataModelGenerator 实例

**Checkpoint**: DataModelGenerator 可通过 GeneratorRegistry 被发现，isApplicable() 正确判断项目适用性

---

## Phase 3: User Story 1 — 从 Python 数据模型生成文档 (Priority: P1) 🎯 MVP

**Goal**: 从 Python dataclass / Pydantic BaseModel 提取字段定义，生成数据模型文档

**Independent Test**: 对包含 @dataclass 和 BaseModel 的 Python 文件运行 extract() → generate() → render()，验证输出文档包含所有字段

### Tests for User Story 1

- [x] T006 [P] [US1] 在 `tests/panoramic/data-model-generator.test.ts` 中创建测试文件和测试夹具（fixture）：编写包含 @dataclass 定义的 Python 文件字符串、包含 Pydantic BaseModel 定义的 Python 文件字符串
- [x] T007 [P] [US1] 在 `tests/panoramic/data-model-generator.test.ts` 中编写 Python dataclass 字段提取测试：验证提取出字段名、类型注解、默认值
- [x] T008 [P] [US1] 在 `tests/panoramic/data-model-generator.test.ts` 中编写 Python Pydantic model 字段提取测试：验证提取出字段名、类型、Field() 中的 default 和 description
- [x] T009 [US1] 在 `tests/panoramic/data-model-generator.test.ts` 中编写 Python 数据模型 generate() + render() 测试：验证输出 Markdown 包含字段表格和模型名称

### Implementation for User Story 1

- [x] T010 [US1] 在 `src/panoramic/data-model-generator.ts` 中实现 `extractPythonDataModels()` 内部函数：使用 TreeSitterAnalyzer 解析 Python 文件，识别 @dataclass 装饰器和 BaseModel 基类，遍历 class body 提取类型注解字段（expression_statement > assignment / type 节点）
- [x] T011 [US1] 在 `src/panoramic/data-model-generator.ts` 中实现 Pydantic `Field()` 参数解析：识别 call 节点中的 keyword_argument，提取 default 和 description 值
- [x] T012 [US1] 在 `src/panoramic/data-model-generator.ts` 中实现 `extract()` 方法的 Python 部分：使用 scanFiles 获取 .py 文件列表，调用 extractPythonDataModels() 收集所有 DataModel
- [x] T013 [US1] 实现 `generate()` 方法：将 DataModelInput 转换为 DataModelOutput，包含排序后的模型列表和统计摘要；实现关系分析（继承关系从 bases 提取）
- [x] T014 [US1] 实现 `render()` 方法：使用 Handlebars 编译 `templates/data-model.hbs` 模板，将 DataModelOutput 渲染为 Markdown 字符串

**Checkpoint**: Python dataclass 和 Pydantic model 可被完整提取并生成文档

---

## Phase 4: User Story 2 — 从 TypeScript 接口/类型生成文档 (Priority: P2)

**Goal**: 从 TypeScript interface / type alias 提取属性定义，生成数据模型文档

**Independent Test**: 对包含 interface 和 type alias 的 TypeScript 文件运行 extract() → generate() → render()

### Tests for User Story 2

- [x] T015 [P] [US2] 在 `tests/panoramic/data-model-generator.test.ts` 中编写 TypeScript interface 属性提取测试：验证提取出属性名、类型、可选标记
- [x] T016 [P] [US2] 在 `tests/panoramic/data-model-generator.test.ts` 中编写 TypeScript type alias 属性提取测试

### Implementation for User Story 2

- [x] T017 [US2] 在 `src/panoramic/data-model-generator.ts` 中实现 `extractTypeScriptDataModels()` 内部函数：使用 TreeSitterAnalyzer 获取 CodeSkeleton，筛选 kind === 'interface' 或 'type' 的 exports，从 members 中提取 kind === 'property' 的条目，解析 signature 获取属性名和类型
- [x] T018 [US2] 将 TypeScript 提取逻辑集成到 `extract()` 方法中：扫描 .ts/.tsx 文件，调用 extractTypeScriptDataModels()，合并到 DataModelInput

**Checkpoint**: TypeScript interface 和 type alias 可被提取并与 Python 模型一起生成文档

---

## Phase 5: User Story 3 — 生成 Mermaid ER 图 (Priority: P2)

**Goal**: 从数据模型间关系生成 Mermaid erDiagram 代码块

**Independent Test**: 提供包含继承和引用关系的数据模型，验证 ER 图语法正确

### Tests for User Story 3

- [x] T019 [P] [US3] 在 `tests/panoramic/data-model-generator.test.ts` 中编写 Mermaid ER 图生成测试：验证继承关系、引用关系的 erDiagram 语法正确

### Implementation for User Story 3

- [x] T020 [US3] 在 `src/panoramic/data-model-generator.ts` 中实现 `generateErDiagram()` 内部函数：遍历 DataModel 列表生成 erDiagram 实体定义（含字段名和类型），遍历 ModelRelation 列表生成关系线
- [x] T021 [US3] 在 `generate()` 方法中集成关系分析逻辑：对每个字段的 typeStr 检查是否引用已知模型名，构建 has/contains 关系；调用 generateErDiagram() 生成 erDiagram 字符串填入 DataModelOutput

**Checkpoint**: ER 图正确反映模型间继承、引用和集合关系

---

## Phase 6: User Story 4 — 项目适用性判断与 Registry 集成 (Priority: P3)

**Goal**: isApplicable() 准确判断，DataModelGenerator 在 Registry 中可被发现

### Tests for User Story 4

- [x] T022 [P] [US4] 在 `tests/panoramic/data-model-generator.test.ts` 中编写 isApplicable() 测试：Python-only 项目返回 true、TypeScript-only 项目返回 true、Go-only 项目返回 false
- [x] T023 [P] [US4] 在 `tests/panoramic/data-model-generator.test.ts` 中编写 Registry 集成测试：验证 bootstrapGenerators() 后可通过 get('data-model') 获取实例，filterByContext() 对含 Python/TS 的项目返回 DataModelGenerator

### Implementation for User Story 4

- [x] T024 [US4] 验证并完善 Phase 2 中已实现的 isApplicable() 和 Registry 注册逻辑，确保边界情况覆盖（空 detectedLanguages、混合语言项目等）

**Checkpoint**: DataModelGenerator 正确注册、可被过滤发现

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 边界情况处理、构建验证和最终检查

- [x] T025 [P] 处理空结果边界情况：extract() 返回空模型列表时 generate() 应返回空文档结构，render() 应生成包含"未检测到数据模型"提示的 Markdown
- [x] T026 运行 `npm run build` 确认零编译错误
- [x] T027 运行 `npm test` 确认 panoramic 全量测试通过（118/118），其他测试失败为预存在的 worktree wasm 路径问题
- [x] T028 运行 `npm run lint` 确认代码风格合规

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1 完成
- **US1 (Phase 3)**: 依赖 Phase 2 完成
- **US2 (Phase 4)**: 依赖 Phase 2 完成，可与 US1 并行
- **US3 (Phase 5)**: 依赖 US1 或 US2 至少一个完成（需要 generate() 方法存在）
- **US4 (Phase 6)**: 依赖 Phase 2 完成，可与 US1/US2 并行
- **Polish (Phase 7)**: 依赖所有 user story 完成

### User Story Dependencies

- **US1 (P1)**: Phase 2 完成后即可开始 — 无其他 story 依赖
- **US2 (P2)**: Phase 2 完成后即可开始 — 可与 US1 并行
- **US3 (P2)**: 依赖 generate() 方法框架存在 — 建议在 US1 之后
- **US4 (P3)**: Phase 2 完成后即可开始 — 可与其他 story 并行

### Parallel Opportunities

- T006 / T007 / T008 可并行编写测试
- T015 / T016 可并行编写测试
- T019 / T022 / T023 可并行编写测试
- US1 和 US2 的实现阶段可并行

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1: 类型定义和模板
2. 完成 Phase 2: Generator 骨架和 Registry 注册
3. 完成 Phase 3: Python 数据模型提取和文档生成
4. **STOP and VALIDATE**: 运行测试验证 Python 数据模型文档可正确生成

### Incremental Delivery

1. Setup + Foundational → Generator 骨架可用
2. + US1 → Python 数据模型文档可用（MVP）
3. + US2 → TypeScript 数据模型文档可用
4. + US3 → Mermaid ER 图可用
5. + US4 → Registry 集成完善
6. + Polish → 构建验证和边界处理

---

## Summary

- **Total tasks**: 28
- **US1 (Python 数据模型)**: 9 tasks (T006-T014)
- **US2 (TypeScript 接口/类型)**: 4 tasks (T015-T018)
- **US3 (Mermaid ER 图)**: 3 tasks (T019-T021)
- **US4 (适用性判断)**: 3 tasks (T022-T024)
- **Setup + Foundational**: 5 tasks (T001-T005)
- **Polish**: 4 tasks (T025-T028)
- **Suggested MVP scope**: Phase 1 + 2 + 3 (User Story 1)
