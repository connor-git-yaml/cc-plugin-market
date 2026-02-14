# Tasks: 修复 Batch LLM 调用默认配置

**Input**: Design documents from `specs/007-fix-batch-llm-defaults/`
**Prerequisites**: plan.md, spec.md, research.md, contracts/llm-config.md

**Tests**: 不新增测试文件，仅更新已有测试并在 Polish 阶段验证全量测试通过。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: 添加共享基础设施——`getTimeoutForModel()` 函数，供 US1 和 US3 使用

**CRITICAL**: US1 和 US3 的动态超时功能依赖此函数

- [x] T001 在 `src/core/llm-client.ts` 中添加并导出 `getTimeoutForModel(model: string): number` 函数，按 contracts/llm-config.md 规定的超时值实现模型族模式匹配（opus→300000, sonnet→120000, haiku→60000, 默认→180000）

**Checkpoint**: `getTimeoutForModel` 可被其他模块导入使用

---

## Phase 2: User Story 1 - 批量生成不再因超时反复失败 (Priority: P1)

**Goal**: 更换默认模型为 Sonnet 并启用动态超时，使 batch 默认配置下 LLM 调用不再超时失败

**Independent Test**: 运行 `npm test` 验证默认配置变更后所有测试通过；可选在真实项目上运行 `reverse-spec batch` 验证模块不再超时

### Implementation for User Story 1

- [x] T002 [P] [US1] 修改 `src/core/llm-client.ts` 中 `getDefaultConfig()` 函数：将默认模型从 `'claude-opus-4-6'` 改为 `'claude-sonnet-4-5-20250929'`，并将 `timeout` 从固定 `120_000` 改为 `getTimeoutForModel(model)` 动态计算
- [x] T003 [P] [US1] 修改 `src/auth/cli-proxy.ts` 中 `getDefaultCLIProxyConfig()` 函数：将默认模型从 `'claude-opus-4-6'` 改为 `'claude-sonnet-4-5-20250929'`，从 `../core/llm-client.js` 导入 `getTimeoutForModel`，将 `timeout` 从固定 `120_000` 改为 `getTimeoutForModel(model)` 动态计算
- [x] T004 [US1] 修改 `src/core/llm-client.ts` 中 `LLMConfig` 接口的 JSDoc 注释：将 model 字段注释从 `默认 'claude-opus-4-6'` 更新为 `默认 'claude-sonnet-4-5-20250929'`，将 timeout 字段注释从 `默认 120_000` 更新为 `默认根据模型动态计算`

**Checkpoint**: 默认配置已切换为 Sonnet + 动态超时，batch 场景下 LLM 调用不再因默认模型太慢而超时

---

## Phase 3: User Story 2 - 消除冗余提示词浪费 (Priority: P2)

**Goal**: 消除系统提示词重复注入，确保 LLM 请求中系统提示词只出现一次

**Independent Test**: 检查 `prepareContext` 不再将 systemPrompt 传入 `assembleContext`，`callLLMviaSdk` 和 `callLLMviaCliProxy` 各自仅注入一次

### Implementation for User Story 2

- [x] T005 [US2] 修改 `src/core/single-spec-orchestrator.ts` 中 `prepareContext()` 函数：移除 `const systemPrompt = buildSystemPrompt('spec-generation');` 行，移除 `assembleContext` 调用中的 `templateInstructions: systemPrompt` 参数，并移除不再使用的 `buildSystemPrompt` 导入
- [x] T006 [US2] 验证 `src/core/llm-client.ts` 中 `callLLMviaSdk` 和 `callLLMviaCliProxy` 的系统提示词注入逻辑正确保留（无需修改，仅确认）

**Checkpoint**: 系统提示词在整个调用链路中仅注入一次，SDK 路径通过 `system` 参数、CLI 路径通过 prompt 拼接

---

## Phase 4: Polish & Validation

**Purpose**: 确保所有改动不破坏现有功能，全量测试和构建通过

- [x] T007 运行 `npm test` 确认全部测试通过，修复任何因默认模型或提示词变更导致的测试失败
- [x] T008 运行 `npm run lint` 确认无 lint 错误
- [x] T009 运行 `npm run build` 确认 TypeScript 编译通过

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 1)**: 无依赖，可立即开始
- **US1 (Phase 2)**: 依赖 Phase 1 的 `getTimeoutForModel` 函数
- **US2 (Phase 3)**: 无依赖于 Phase 2（独立的 bug 修复），但建议在 US1 之后执行以便验证整体流程
- **Polish (Phase 4)**: 依赖 US1 和 US2 全部完成

### User Story Dependencies

- **US1 (P1)**: 依赖 T001（getTimeoutForModel），不依赖 US2
- **US2 (P2)**: 不依赖 US1，可独立实施和测试
- **US3 (P3)**: 由 US1 的 `getTimeoutForModel` 机制自动满足——当用户通过环境变量设置不同模型时，超时会自动适配，无需额外任务

### Within Each User Story

- T002 和 T003 标记 [P]，修改不同文件可并行执行
- T004 依赖 T002（同文件修改）
- T005 独立于其他任务

### Parallel Opportunities

- T002 和 T003 可并行（分别修改 llm-client.ts 和 cli-proxy.ts）
- T007、T008、T009 虽然是顺序验证，但彼此独立

---

## Implementation Strategy

### MVP First (US1)

1. 完成 T001：添加 `getTimeoutForModel`
2. 完成 T002 + T003（并行）：切换默认模型 + 动态超时
3. 完成 T004：更新注释
4. **验证**：`npm test` 通过即可确认 MVP 生效

### Full Delivery

1. MVP (T001-T004) → 默认模型和超时修复
2. T005-T006 → 提示词去重
3. T007-T009 → 全量验证

---

## Notes

- 总计 9 个任务，涉及 3 个源文件 + 测试验证
- US3 不需要独立任务——`getTimeoutForModel` 机制自动覆盖环境变量场景
- T006 是验证性任务（确认不需要修改），非编码任务
- 预计总改动量 <50 行代码
