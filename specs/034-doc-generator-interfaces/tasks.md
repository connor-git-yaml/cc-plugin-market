# Tasks: DocumentGenerator + ArtifactParser 接口定义

**Input**: Design documents from `/specs/034-doc-generator-interfaces/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), data-model.md

**Tests**: spec.md 中 FR-022/FR-023/FR-024 明确要求单元测试，因此本任务清单包含测试任务。测试采用 TDD 方式：先写测试 -> 确认失败 -> 实现。

**Organization**: 任务按 User Story 分组，支持独立实现和测试。由于本 Feature 的 5 个 Story 中前 4 个均为 P1 且共享同一文件 `src/panoramic/interfaces.ts`，Story 1-3 合并为一个 Phase 以避免文件冲突。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件、无依赖）
- **[Story]**: 所属 User Story（US1-US5）
- 每个任务包含明确的文件路径

---

## Phase 1: Setup（项目结构初始化）

**Purpose**: 创建 `src/panoramic/` 和 `tests/panoramic/` 目录结构

- [x] T001 创建 `src/panoramic/` 目录和空的 `interfaces.ts` 文件骨架（含文件头注释和 zod 导入）—— `src/panoramic/interfaces.ts`
- [x] T002 [P] 创建 `tests/panoramic/` 目录和空的测试文件骨架 —— `tests/panoramic/schemas.test.ts`、`tests/panoramic/mock-generator.test.ts`

**Checkpoint**: 目录结构就绪，`npm run build` 零错误通过（空文件不影响编译）

---

## Phase 2: User Stories 1-3 — 核心接口 + Zod Schema（Priority: P1）

**Goal**: 在 `src/panoramic/interfaces.ts` 中完成 DocumentGenerator、ArtifactParser 两大核心接口定义，以及所有 Zod Schema 和辅助类型。这三个 P1 Story 共享同一文件，合并为一个 Phase 以避免并发文件冲突。

**Independent Test**:
- `npm run build` 零错误通过
- Zod Schema 单元测试全部通过（`npm test -- tests/panoramic/schemas.test.ts`）

### Tests（TDD：先写测试，确认失败，再实现）

- [x] T003 [US3] 编写 Zod Schema 单元测试：GeneratorMetadataSchema 合法输入通过验证 —— `tests/panoramic/schemas.test.ts`
- [x] T004 [P] [US3] 编写 Zod Schema 单元测试：GeneratorMetadataSchema 缺失 id 抛出 ZodError —— `tests/panoramic/schemas.test.ts`
- [x] T005 [P] [US3] 编写 Zod Schema 单元测试：GeneratorMetadataSchema id 非 kebab-case 抛出 ZodError —— `tests/panoramic/schemas.test.ts`
- [x] T006 [P] [US3] 编写 Zod Schema 单元测试：ArtifactParserMetadataSchema 合法输入通过、空 filePatterns 抛出 ZodError —— `tests/panoramic/schemas.test.ts`
- [x] T007 [P] [US3] 编写 Zod Schema 单元测试：GenerateOptionsSchema 默认值填充、useLLM 覆盖、无效 outputFormat 抛出 ZodError —— `tests/panoramic/schemas.test.ts`
- [x] T008 [P] [US3] 编写 Zod Schema 单元测试：ProjectContextSchema 合法输入通过、空 projectRoot 抛出 ZodError —— `tests/panoramic/schemas.test.ts`
- [x] T009 [P] [US3] 编写 Zod Schema 单元测试：`z.infer<typeof Schema>` 与对应 interface 类型兼容性检查 —— `tests/panoramic/schemas.test.ts`

### Implementation

- [x] T010 [US1] [US2] [US3] 定义 OutputFormatSchema（枚举 `'markdown'`）和 OutputFormat 类型 —— `src/panoramic/interfaces.ts`
- [x] T011 [US1] [US3] 定义 GenerateOptionsSchema 和 GenerateOptions 类型（useLLM、templateOverride、outputFormat 三个可选字段，含默认值）—— `src/panoramic/interfaces.ts`
- [x] T012 [US1] [US2] [US3] 定义 ProjectContextSchema 和 ProjectContext 类型（最小占位版本：projectRoot + configFiles Map）—— `src/panoramic/interfaces.ts`
- [x] T013 [US1] [US3] 定义 GeneratorMetadataSchema 和 GeneratorMetadata 类型（id kebab-case、name、description）—— `src/panoramic/interfaces.ts`
- [x] T014 [US2] [US3] 定义 ArtifactParserMetadataSchema 和 ArtifactParserMetadata 类型（id kebab-case、name、filePatterns 至少一个）—— `src/panoramic/interfaces.ts`
- [x] T015 [US1] 定义 DocumentGenerator<TInput, TOutput> 泛型接口，包含 id、name、description 只读属性和 isApplicable/extract/generate/render 四个方法签名 —— `src/panoramic/interfaces.ts`
- [x] T016 [US2] 定义 ArtifactParser<T> 泛型接口，包含 id、name 只读属性、filePatterns 只读数组和 parse/parseAll 两个方法签名 —— `src/panoramic/interfaces.ts`
- [x] T017 [US1] [US2] 导出所有类型、接口和 Schema（named exports），确保 `npm run build` 零错误 —— `src/panoramic/interfaces.ts`

**Checkpoint**: 运行 `npm run build` 零错误；运行 `npm test -- tests/panoramic/schemas.test.ts` 全部通过

---

## Phase 3: User Story 4 — Mock Generator 全生命周期验证（Priority: P1）

**Goal**: 提供 MockReadmeGenerator 实现 DocumentGenerator 接口全部方法，并通过单元测试验证 isApplicable -> extract -> generate -> render 四步生命周期。

**Independent Test**: `npm test -- tests/panoramic/mock-generator.test.ts` 全部通过

### Tests（TDD：先写测试，确认失败，再实现）

- [x] T018 [US4] 编写 Mock Generator 单元测试：isApplicable — 包含 package.json 的 ProjectContext 返回 true —— `tests/panoramic/mock-generator.test.ts`
- [x] T019 [P] [US4] 编写 Mock Generator 单元测试：isApplicable — 不包含 package.json 的 ProjectContext 返回 false —— `tests/panoramic/mock-generator.test.ts`
- [x] T020 [P] [US4] 编写 Mock Generator 单元测试：isApplicable — 空 Map 的 ProjectContext 返回 false —— `tests/panoramic/mock-generator.test.ts`
- [x] T021 [P] [US4] 编写 Mock Generator 单元测试：extract — 正确提取 projectName 和 description —— `tests/panoramic/mock-generator.test.ts`
- [x] T022 [P] [US4] 编写 Mock Generator 单元测试：extract — 缺失字段使用默认值（`'unknown-project'`、`'No description provided'`）—— `tests/panoramic/mock-generator.test.ts`
- [x] T023 [P] [US4] 编写 Mock Generator 单元测试：generate — 输出包含 title、description 和 sections —— `tests/panoramic/mock-generator.test.ts`
- [x] T024 [P] [US4] 编写 Mock Generator 单元测试：render — 输出为合法 Markdown（包含 `#` 标题和段落）—— `tests/panoramic/mock-generator.test.ts`
- [x] T025 [P] [US4] 编写 Mock Generator 单元测试：render — sections 为空数组时仅输出 title 和 description —— `tests/panoramic/mock-generator.test.ts`
- [x] T026 [US4] 编写 Mock Generator 单元测试：全链路 e2e — extract -> generate -> render 顺序调用，最终 Markdown 包含项目名称 —— `tests/panoramic/mock-generator.test.ts`

### Implementation

- [x] T027 [US4] 定义 ReadmeInput 类型（projectName、description、hasPackageJson）—— `src/panoramic/mock-readme-generator.ts`
- [x] T028 [US4] 定义 ReadmeOutput 和 ReadmeSection 类型（title、description、sections）—— `src/panoramic/mock-readme-generator.ts`
- [x] T029 [US4] 实现 MockReadmeGenerator.id / name / description 只读属性 —— `src/panoramic/mock-readme-generator.ts`
- [x] T030 [US4] 实现 MockReadmeGenerator.isApplicable()：同步检查 `context.configFiles.has('package.json')` —— `src/panoramic/mock-readme-generator.ts`
- [x] T031 [US4] 实现 MockReadmeGenerator.extract()：读取 package.json 提取 name 和 description，缺失时使用默认值 —— `src/panoramic/mock-readme-generator.ts`
- [x] T032 [US4] 实现 MockReadmeGenerator.generate()：将 ReadmeInput 转换为 ReadmeOutput（含 Installation/Usage 默认 sections）—— `src/panoramic/mock-readme-generator.ts`
- [x] T033 [US4] 实现 MockReadmeGenerator.render()：同步拼接 Markdown 字符串（标题 + 描述 + sections）—— `src/panoramic/mock-readme-generator.ts`
- [x] T034 [US4] 导出 MockReadmeGenerator 及相关类型，确保 `npm run build` 零错误 —— `src/panoramic/mock-readme-generator.ts`

**Checkpoint**: 运行 `npm test -- tests/panoramic/mock-generator.test.ts` 全部通过；`npm run build` 零错误

---

## Phase 4: User Story 5 — 与现有代码库正交性保障（Priority: P2）

**Goal**: 验证新增的 `src/panoramic/` 目录与现有 `src/adapters/`、`src/models/`、`src/core/` 完全正交，互不影响。

**Independent Test**: `npm test` 全部测试通过（含现有测试 + 新增测试）；`git diff` 确认未修改现有目录

- [x] T035 [US5] 运行完整测试套件 `npm test`，确认现有全部测试仍然通过（零新增失败）
- [x] T036 [P] [US5] 验证 `src/panoramic/interfaces.ts` 和 `src/panoramic/mock-readme-generator.ts` 不从 `src/adapters/`、`src/models/`、`src/core/` 导入任何模块
- [x] T037 [P] [US5] 验证 `git diff` 确认 `src/adapters/`、`src/models/`、`src/core/` 目录下无任何文件变更

**Checkpoint**: 正交性验证通过，现有功能不受影响

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 文档、代码质量和最终验证

- [x] T038 [P] 为 `src/panoramic/interfaces.ts` 中所有接口和类型添加中文 JSDoc 注释（id、name、description、每个方法的参数和返回值说明）—— `src/panoramic/interfaces.ts`
- [x] T039 [P] 为 `src/panoramic/mock-readme-generator.ts` 添加中文 JSDoc 注释 —— `src/panoramic/mock-readme-generator.ts`
- [x] T040 运行 `npm run build` 确认最终编译零错误
- [x] T041 运行 `npm test` 确认全部测试通过（退出码 0）
- [x] T042 运行 `npm run lint`（如存在）确认代码风格通过

---

## FR 覆盖映射表

| FR 编号 | 需求描述 | 覆盖任务 |
|---------|---------|---------|
| FR-001 | DocumentGenerator 泛型接口定义（id、name、description） | T015, T013 |
| FR-002 | isApplicable 方法签名（boolean \| Promise\<boolean\>） | T015 |
| FR-003 | extract 方法签名（Promise\<TInput\>） | T015 |
| FR-004 | generate 方法签名（Promise\<TOutput\>） | T015 |
| FR-005 | render 方法签名（string \| Promise\<string\>） | T015 |
| FR-006 | 生命周期顺序 isApplicable -> extract -> generate -> render | T026 |
| FR-007 | ArtifactParser 泛型接口定义（id、name） | T016, T014 |
| FR-008 | filePatterns 只读属性（glob 格式） | T016 |
| FR-009 | parse 方法签名（Promise\<T\>） | T016 |
| FR-010 | parseAll 方法签名（Promise\<T[]\>） | T016 |
| FR-011 | DocumentGenerator Zod Schema（GeneratorMetadataSchema） | T013, T003-T005 |
| FR-012 | ArtifactParser Zod Schema（ArtifactParserMetadataSchema） | T014, T006 |
| FR-013 | Zod Schema 推导类型与 interface 类型兼容 | T009 |
| FR-014 | GenerateOptions Zod Schema | T011, T007 |
| FR-015 | GenerateOptions 类型定义（useLLM、templateOverride、outputFormat） | T011 |
| FR-016 | ProjectContext 最小占位版本（projectRoot、configFiles） | T012, T008 |
| FR-017 | Mock Generator 实现 DocumentGenerator 全部方法 | T029-T034 |
| FR-018 | Mock isApplicable 基于条件返回布尔值 | T030, T018-T020 |
| FR-019 | Mock extract 返回符合 TInput 的数据 | T031, T021-T022 |
| FR-020 | Mock generate 转换为 TOutput | T032, T023 |
| FR-021 | Mock render 渲染 Markdown | T033, T024-T025 |
| FR-022 | Mock Generator 单元测试覆盖四方法 | T018-T026 |
| FR-023 | Zod Schema 单元测试（合法/非法输入） | T003-T009 |
| FR-024 | 单元测试全部通过（退出码 0） | T041 |
| FR-025 | 所有新增代码在 src/panoramic/ 下 | T001, T036 |
| FR-026 | 新接口与现有类型正交 | T036, T037 |
| FR-027 | npm run build 零错误 | T017, T034, T040 |
| FR-028 | Strategy 模式一致性 | T015 |
| FR-029 | 唯一 id 标识符为 Registry 预留 | T013, T015 |

**FR 覆盖率**: 29/29 = **100%**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖 — 可立即开始
- **Phase 2 (核心接口 + Schema)**: 依赖 Phase 1 — 需要目录结构就绪
- **Phase 3 (Mock Generator)**: 依赖 Phase 2 — 需要 DocumentGenerator 接口和辅助类型存在
- **Phase 4 (正交性验证)**: 依赖 Phase 2 + Phase 3 — 需要所有新增代码完成
- **Phase 5 (Polish)**: 依赖 Phase 2 + Phase 3 — 代码实现完成后补充文档和最终验证

### User Story Dependencies

- **US1 (DocumentGenerator 接口)** + **US2 (ArtifactParser 接口)** + **US3 (Zod Schema)**: 三者共享 `interfaces.ts` 文件，合并在 Phase 2 顺序实现
- **US4 (Mock Generator)**: 依赖 US1/US3 提供的接口和类型定义
- **US5 (正交性保障)**: 依赖 US1-US4 全部完成后进行验证

### Story 内部并行机会

- **Phase 2 测试任务 T003-T009**: 全部在同一文件 `schemas.test.ts` 内，但 describe 块独立，T004-T009 标记 [P] 可并行编写
- **Phase 3 测试任务 T018-T026**: 全部在同一文件 `mock-generator.test.ts` 内，T019-T025 标记 [P] 可并行编写
- **Phase 5 的 T038/T039**: 不同文件，可并行

### Recommended Implementation Strategy

**推荐**: 顺序 MVP 策略

由于本 Feature 仅涉及 2 个源文件和 2 个测试文件，且 US1-US3 共享 `interfaces.ts`，并行机会有限。推荐按 Phase 顺序执行：

1. Phase 1: Setup（~5 分钟）
2. Phase 2: 核心接口 + Schema + 测试（~45 分钟）—— TDD 循环
3. Phase 3: Mock Generator + 测试（~30 分钟）—— TDD 循环
4. Phase 4: 正交性验证（~5 分钟）
5. Phase 5: Polish（~15 分钟）

**预计总工时**: ~1.5 小时

---

## Notes

- [P] 任务 = 不同文件或同文件内独立代码块，无数据依赖
- [USN] 标记所属 User Story，便于追溯
- Phase 2 的 T010-T017 虽在同一文件内但按文件内部顺序排列，应顺序执行
- Phase 3 的 T027-T034 同理，按实现顺序排列
- 每个 Phase 完成后运行 `npm run build` 和 `npm test` 做回归验证
- 不创建 `src/panoramic/index.ts` barrel 文件，待 Feature 036 GeneratorRegistry 时统一创建
