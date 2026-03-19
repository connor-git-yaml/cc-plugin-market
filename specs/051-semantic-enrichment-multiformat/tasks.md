# Tasks: 语义增强 + 多格式输出

**Input**: Design documents from `specs/051-semantic-enrichment-multiformat/`
**Prerequisites**: plan.md, spec.md, data-model.md

**Tests**: spec.md 中的 User Stories 包含验收场景，plan.md 中明确列出了单元测试和集成测试用例。本任务清单包含测试任务。

**Organization**: 按 User Story 分组，支持独立实现和测试。US1/US2 共享 enricher 基础设施，US3 独立于 LLM 增强。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件，无依赖）
- **[Story]**: 所属 User Story（US1, US2, US3, US4, US5）

---

## Phase 1: Setup (共享基础设施)

**Purpose**: OutputFormat 扩展和工具函数骨架创建

- [x] T001 扩展 `OutputFormatSchema` 枚举，添加 `'json'` 和 `'all'` 两个值 — `src/panoramic/interfaces.ts`
- [x] T002 [P] 创建 `llm-enricher.ts` 模块骨架，导出 `enrichFieldDescriptions` 和 `enrichConfigDescriptions` 函数签名（暂用 stub 实现直接返回原数据）— `src/panoramic/utils/llm-enricher.ts`
- [x] T003 [P] 创建 `multi-format-writer.ts` 模块骨架，导出 `WriteMultiFormatOptions` 类型和 `writeMultiFormat` 函数签名（暂用 stub 实现）— `src/panoramic/utils/multi-format-writer.ts`

**Checkpoint**: OutputFormat 扩展已生效，两个新工具模块骨架存在，现有测试全部通过（零回归）

---

## Phase 2: Foundational (阻塞性前置依赖)

**Purpose**: LLM 调用基础设施——`callLLMSimple` 内部函数 + `EnrichFieldResult` Zod Schema

- [x] T004 在 `llm-enricher.ts` 中实现内部函数 `callLLMSimple`：使用 `detectAuth()` 检测认证，API Key 时直接使用 Anthropic SDK，CLI 代理时调用 `callLLMviaCli`；默认模型 `claude-3-5-haiku-20241022`，支持 `PANORAMIC_LLM_MODEL` 环境变量覆盖；超时 60s — `src/panoramic/utils/llm-enricher.ts`
- [x] T005 在 `llm-enricher.ts` 中定义 `EnrichFieldResultSchema`（Zod: `{name: string, description: string}`）和 `EnrichBatchResultSchema`（`z.array(EnrichFieldResultSchema)`），用于验证 LLM 返回的 JSON — `src/panoramic/utils/llm-enricher.ts`

**Checkpoint**: LLM 调用基础设施就绪，后续 US1/US2 可并行实现各自的 enrichment 逻辑

---

## Phase 3: User Story 1 — DataModelGenerator LLM 语义增强 (Priority: P1)

**Goal**: 当 `useLLM=true` 时，DataModelGenerator 自动为 description 为 null 的字段批量调用 LLM 推断说明，添加 `[AI]` 前缀标注

**Independent Test**: 对包含多个 Python dataclass 的项目运行 DataModelGenerator（useLLM=true），验证字段 description 不再为 null，且包含 `[AI]` 标注

### Tests for User Story 1

> **NOTE: 先写测试，确认测试 FAIL 后再实现**

- [x] T006 [P] [US1] 编写 `enrichFieldDescriptions` 单元测试——正常增强：mock LLM 返回 JSON，验证 `[AI]` 前缀和字段匹配 — `tests/panoramic/utils/llm-enricher.test.ts`
- [x] T007 [P] [US1] 编写 `enrichFieldDescriptions` 单元测试——保留人工注释：description 非 null 的字段不被覆盖 — `tests/panoramic/utils/llm-enricher.test.ts`
- [x] T008 [P] [US1] 编写 `enrichFieldDescriptions` 单元测试——空数据：models=[] 时不调用 LLM — `tests/panoramic/utils/llm-enricher.test.ts`
- [x] T009 [P] [US1] 编写 `enrichFieldDescriptions` 单元测试——`[AI]` 前缀不叠加：已有 `[AI]` 前缀的字段跳过 — `tests/panoramic/utils/llm-enricher.test.ts`
- [x] T010 [P] [US1] 编写 DataModelGenerator 集成测试——`generate(input, {useLLM: true})` 端到端验证（mock LLM）— `tests/panoramic/data-model-generator.test.ts`

### Implementation for User Story 1

- [x] T011 [US1] 实现 `enrichFieldDescriptions` 完整逻辑：深拷贝 models → 收集 `description === null` 且不以 `[AI]` 开头的字段 → 按模型分组 → 构造 prompt → 调用 `callLLMSimple` → Zod 验证响应 → 匹配回字段并添加 `[AI] ` 前缀 → 单个模型失败时 catch 跳过 — `src/panoramic/utils/llm-enricher.ts`
- [x] T012 [US1] 修改 `DataModelGenerator.generate()` 集成 LLM enrichment：`_options` 改为 `options`，排序后插入 `if (options?.useLLM) { sortedModels = await enrichFieldDescriptions(sortedModels); }`，新增 import — `src/panoramic/data-model-generator.ts`

**Checkpoint**: DataModelGenerator 的 LLM 语义增强完整可用，所有 US1 测试通过

---

## Phase 4: User Story 2 — ConfigReferenceGenerator LLM 语义增强 (Priority: P1)

**Goal**: 当 `useLLM=true` 时，ConfigReferenceGenerator 自动为 description 为空字符串的配置项批量调用 LLM 推断说明，添加 `[AI]` 前缀标注

**Independent Test**: 对包含 pyproject.toml 的项目运行 ConfigReferenceGenerator（useLLM=true），验证配置项有说明文本且含 `[AI]` 标注

### Tests for User Story 2

> **NOTE: 先写测试，确认测试 FAIL 后再实现**

- [x] T013 [P] [US2] 编写 `enrichConfigDescriptions` 单元测试——正常增强：mock LLM 返回 JSON，验证 `[AI]` 前缀和配置项匹配 — `tests/panoramic/utils/llm-enricher.test.ts`
- [x] T014 [P] [US2] 编写 `enrichConfigDescriptions` 单元测试——保留已有 description：非空的配置项不被覆盖 — `tests/panoramic/utils/llm-enricher.test.ts`
- [x] T015 [P] [US2] 编写 `enrichConfigDescriptions` 单元测试——空数据：files=[] 时不调用 LLM — `tests/panoramic/utils/llm-enricher.test.ts`
- [x] T016 [P] [US2] 编写 ConfigReferenceGenerator 集成测试——`generate(input, {useLLM: true})` 端到端验证（mock LLM）— `tests/panoramic/config-reference-generator.test.ts`

### Implementation for User Story 2

- [x] T017 [US2] 实现 `enrichConfigDescriptions` 完整逻辑：深拷贝 files → 收集 `description === ''` 且不以 `[AI]` 开头的配置项 → 按文件分组 → 构造 prompt → 调用 `callLLMSimple` → Zod 验证响应 → 匹配回配置项并添加 `[AI] ` 前缀 → 单个文件失败时 catch 跳过 — `src/panoramic/utils/llm-enricher.ts`
- [x] T018 [US2] 修改 `ConfigReferenceGenerator.generate()` 集成 LLM enrichment：`_options` 改为 `options`，排序后插入 `if (options?.useLLM) { sortedFiles = await enrichConfigDescriptions(sortedFiles); }`，新增 import — `src/panoramic/config-reference-generator.ts`

**Checkpoint**: ConfigReferenceGenerator 的 LLM 语义增强完整可用，所有 US2 测试通过

---

## Phase 5: User Story 3 — 多格式输出（JSON + Mermaid） (Priority: P1)

**Goal**: 扩展输出能力支持 `'json'` 和 `'all'`，调用层可同时输出 `.md`、`.json`、`.mmd` 三种格式文件

**Independent Test**: 以 `outputFormat='all'` 运行任意 Generator，验证输出目录中同时生成 `.md`、`.json`、`.mmd` 三个文件

### Tests for User Story 3

> **NOTE: 先写测试，确认测试 FAIL 后再实现**

- [x] T019 [P] [US3] 编写 `writeMultiFormat` 单元测试——markdown 格式：仅生成 `.md` — `tests/panoramic/utils/multi-format-writer.test.ts`
- [x] T020 [P] [US3] 编写 `writeMultiFormat` 单元测试——json 格式：仅生成 `.json`，验证 `JSON.parse()` 成功 — `tests/panoramic/utils/multi-format-writer.test.ts`
- [x] T021 [P] [US3] 编写 `writeMultiFormat` 单元测试——all 格式含 mermaid：生成 `.md` + `.json` + `.mmd` — `tests/panoramic/utils/multi-format-writer.test.ts`
- [x] T022 [P] [US3] 编写 `writeMultiFormat` 单元测试——all 格式不含 mermaid：生成 `.md` + `.json`，不生成空 `.mmd` — `tests/panoramic/utils/multi-format-writer.test.ts`
- [x] T023 [P] [US3] 编写 `writeMultiFormat` 单元测试——JSON 特殊字符：包含 Unicode、反斜杠的数据正确序列化 — `tests/panoramic/utils/multi-format-writer.test.ts`
- [x] T024 [P] [US3] 编写 `writeMultiFormat` 单元测试——输出目录自动创建：目录不存在时 `mkdirSync` recursive — `tests/panoramic/utils/multi-format-writer.test.ts`

### Implementation for User Story 3

- [x] T025 [US3] 实现 `writeMultiFormat` 完整逻辑：根据 `outputFormat` 决定写哪些文件——`'markdown'` 仅写 `.md`，`'json'` 仅写 `.json`（`JSON.stringify(structuredData, null, 2)`），`'all'` 写 `.md` + `.json` + 条件 `.mmd`；`mkdirSync` 创建目录；返回文件路径列表 — `src/panoramic/utils/multi-format-writer.ts`
- [x] T026 [US3] 导出 `utils/index.ts` 或确保 `multi-format-writer.ts` 可从 panoramic 子系统外部引用（供未来 batch/MCP 调用层使用）— `src/panoramic/utils/multi-format-writer.ts`

**Checkpoint**: `writeMultiFormat` 工具函数完整可用，所有 US3 测试通过

---

## Phase 6: User Story 4 — LLM 不可用时的静默降级 (Priority: P2)

**Goal**: 确保 `useLLM=true` 但 LLM 不可用时（无 API Key、超时、API 错误）不报错，输出与 `useLLM=false` 一致

**Independent Test**: 在未设置 ANTHROPIC_API_KEY 且未登录 Claude Code 的环境中，以 `useLLM=true` 运行 Generator，验证不报错

### Tests for User Story 4

- [x] T027 [P] [US4] 编写 `enrichFieldDescriptions` 降级测试——LLM 不可用（detectAuth 返回 `preferred: null`）时静默返回原始数据 — `tests/panoramic/utils/llm-enricher.test.ts`
- [x] T028 [P] [US4] 编写 `enrichFieldDescriptions` 降级测试——LLM 调用抛出异常时静默降级 — `tests/panoramic/utils/llm-enricher.test.ts`
- [x] T029 [P] [US4] 编写 `enrichFieldDescriptions` 降级测试——部分批次失败（多个模型中一个失败），其余正常增强 — `tests/panoramic/utils/llm-enricher.test.ts`
- [x] T030 [P] [US4] 编写 `enrichConfigDescriptions` 降级测试——LLM 不可用时静默返回原始数据 — `tests/panoramic/utils/llm-enricher.test.ts`

### Implementation for User Story 4

- [x] T031 [US4] 审查并补强 `callLLMSimple` 和 `enrichFieldDescriptions`/`enrichConfigDescriptions` 的 try-catch 降级逻辑：确保 `detectAuth()` 返回 `preferred: null` 时提前返回；确保每个批次独立 catch，单批次失败不中断后续批次 — `src/panoramic/utils/llm-enricher.ts`

**Checkpoint**: LLM 不可用场景下所有降级测试通过，无异常抛出

---

## Phase 7: User Story 5 — 零回归保障 (Priority: P2)

**Goal**: 在默认配置（`useLLM=false`，`outputFormat='markdown'`）下，系统行为与变更前完全一致

**Independent Test**: 以默认选项运行所有现有 Generator，对比变更前后输出一致

### Tests for User Story 5

- [x] T032 [P] [US5] 编写 DataModelGenerator 回归测试——`useLLM=false`（默认）时 `generate()` 不调用任何 LLM 接口 — `tests/panoramic/data-model-generator.test.ts`
- [x] T033 [P] [US5] 编写 ConfigReferenceGenerator 回归测试——`useLLM=false`（默认）时 `generate()` 不调用任何 LLM 接口 — `tests/panoramic/config-reference-generator.test.ts`
- [x] T034 [P] [US5] 编写回归测试——`useLLM` 参数未传递时默认为 false，行为与变更前一致 — `tests/panoramic/data-model-generator.test.ts`

### Implementation for User Story 5

- [x] T035 [US5] 运行全量现有测试套件（`npm test`），确保所有现有测试在新代码下全部通过 — 项目根目录

**Checkpoint**: 所有现有测试 + 新增回归测试全部通过，默认行为零回归

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 代码质量、文档、边界情况补强

- [x] T036 [P] 补充 `llm-enricher.ts` 和 `multi-format-writer.ts` 的 JSDoc 注释和模块头注释 — `src/panoramic/utils/llm-enricher.ts`, `src/panoramic/utils/multi-format-writer.ts`
- [x] T037 [P] 更新 `interfaces.ts` 中 `OutputFormatSchema` 的 JSDoc 注释，说明新增的 `'json'` 和 `'all'` 值 — `src/panoramic/interfaces.ts`
- [x] T038 运行 `npm run lint` 检查所有新增/修改文件的代码风格 — 项目根目录
- [x] T039 运行全量测试套件（`npm test`）确认所有测试通过 — 项目根目录

---

## FR 覆盖映射表

| FR | 描述 | 覆盖 Task |
|----|------|-----------|
| FR-001 | DataModelGenerator `useLLM=true` 时收集空字段批量调用 LLM | T011, T012 |
| FR-002 | ConfigReferenceGenerator `useLLM=true` 时收集空配置项批量调用 LLM | T017, T018 |
| FR-003 | LLM 推断的 description 以 `[AI]` 前缀标注 | T011, T017 (实现), T006, T013 (测试) |
| FR-004 | LLM 批量调用按模型/文件分组 | T011, T017 |
| FR-005 | 复用现有 `detectAuth` + Anthropic SDK / CLI 代理 | T004 |
| FR-006 | 已有人工注释的字段/配置项保持不变 | T011, T017 (实现), T007, T014 (测试) |
| FR-007 | LLM 不可用时静默降级 | T031 (实现), T027, T028, T030 (测试) |
| FR-008 | 单个批次失败不中断整体流程 | T031 (实现), T029 (测试) |
| FR-009 | OutputFormat 支持 `'json'` 和 `'all'` | T001 |
| FR-010 | `outputFormat='json'` 输出 `.json` 文件 | T025 (实现), T020 (测试) |
| FR-011 | `outputFormat='all'` 输出 `.md` + `.json` + `.mmd` | T025 (实现), T021 (测试) |
| FR-012 | `.mmd` 文件仅包含 Mermaid 源码 | T025 (实现), T021 (测试) |
| FR-013 | 多格式输出在调用层处理，`render()` 签名不变 | T025, T026 |
| FR-014 | `useLLM=false` 时不调用 LLM | T032, T034 (测试), T012, T018 (条件分支) |
| FR-015 | `outputFormat='markdown'` 仅输出 `.md` | T019 (测试), T025 (实现) |
| FR-016 | DocumentGenerator 接口签名不变 | T001 (仅改 OutputFormatSchema 枚举值) |

**FR 覆盖率**: 16/16 = **100%**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无前置依赖，可立即开始
- **Phase 2 (Foundational)**: 依赖 Phase 1 中的 T002（enricher 骨架存在）
- **Phase 3 (US1) / Phase 4 (US2)**: 均依赖 Phase 2 完成（callLLMSimple + Zod Schema 就绪）
- **Phase 5 (US3)**: 仅依赖 Phase 1 中的 T001（OutputFormat 扩展）和 T003（writer 骨架），与 Phase 3/4 无依赖
- **Phase 6 (US4)**: 依赖 Phase 3 和 Phase 4 完成（需有实际 enrichment 逻辑来测试降级）
- **Phase 7 (US5)**: 依赖 Phase 3、4、5 完成（需所有变更就位后验证零回归）
- **Phase 8 (Polish)**: 依赖所有前序 Phase 完成

### User Story Dependencies

- **US1 (DataModel LLM 增强)** 与 **US2 (ConfigRef LLM 增强)**: 共享 enricher 基础设施（Phase 2），之后可并行实现
- **US3 (多格式输出)**: 与 US1/US2 完全独立，仅依赖 Phase 1 的 OutputFormat 扩展
- **US4 (降级)**: 依赖 US1 + US2 的实现（需要有代码来测试降级逻辑）
- **US5 (零回归)**: 依赖所有功能变更完成后做回归验证

### Story 内部并行机会

- **Phase 1**: T002 和 T003 可并行（不同文件）
- **Phase 3**: T006-T010 的 5 个测试任务可全部并行（同一测试文件但无依赖）
- **Phase 4**: T013-T016 的 4 个测试任务可全部并行
- **Phase 5**: T019-T024 的 6 个测试任务可全部并行
- **Phase 6**: T027-T030 的 4 个测试任务可全部并行
- **Phase 7**: T032-T034 的 3 个测试任务可全部并行
- **Phase 3 与 Phase 5**: 可完全并行推进（US1 与 US3 无依赖）

### Implementation Strategy

**推荐: MVP First + Parallel**

```
Phase 1 (Setup)
    ├── Phase 2 (Foundational)
    │       ├── Phase 3 (US1: DataModel LLM)  ──┐
    │       └── Phase 4 (US2: ConfigRef LLM)  ──┤
    └── Phase 5 (US3: 多格式输出)  ─────────────┤  (可与 Phase 3/4 并行)
                                                 ├── Phase 6 (US4: 降级)
                                                 ├── Phase 7 (US5: 回归)
                                                 └── Phase 8 (Polish)
```

1. 先完成 Phase 1 + Phase 2（共享基础设施）
2. 并行推进 Phase 3 (US1) + Phase 4 (US2) + Phase 5 (US3)——三个 P1 Story 互不依赖
3. 所有 P1 完成后，Phase 6 (US4) 和 Phase 7 (US5) 顺序验证
4. Phase 8 收尾

**MVP 范围**: US1 (DataModel LLM 语义增强) + US3 (多格式输出) 构成最小可演示版本

---

## Notes

- [P] 标记的任务 = 不同文件或无依赖，可并行
- [USN] 标记映射到 spec.md 中的 User Story
- 每个 Story 完成后独立验证
- 测试先写，确认 FAIL 后再实现
- 每个任务完成后 commit
- 在任何 Checkpoint 处可暂停验证
