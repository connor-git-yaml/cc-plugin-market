# Tasks: 026 LLM Prompt 语言参数化

## Phase 1: Setup

- [x] T001 创建特性分支 `026-multilang-prompt-parameterize`

## Phase 2: Core — buildSystemPrompt 参数化

- [x] T002 修改 `src/core/llm-client.ts`：`LLMConfig` 新增 `languageTerminology?: LanguageTerminology` 字段
- [x] T003 修改 `src/core/llm-client.ts`：`buildSystemPrompt(mode, terminology?)` 新增可选参数
- [x] T004 修改 `src/core/llm-client.ts`：spec-generation prompt 中 4 处 TS 硬编码术语替换为 terminology 模板变量（无 terminology 时使用 TS 默认值）
- [x] T005 修改 `src/core/llm-client.ts`：`callLLMviaSdk` 和 `callLLMviaCliProxy` 从 cfg 传透 terminology 到 buildSystemPrompt

## Phase 3: Pipeline 集成

- [x] T006 修改 `src/core/single-spec-orchestrator.ts`：从 Registry 获取 skeleton 对应的 terminology，传递给 `callLLM` config
- [x] T007 修改 `src/diff/drift-orchestrator.ts`：`evaluateBehaviorChange` 调用时传递 `currentSkeleton.language`

## Phase 4: noise-filter 多语言化

- [x] T008 修改 `src/diff/noise-filter.ts`：`normalizeForComparison` 新增 `language` 参数，支持 Python `#` 注释
- [x] T009 修改 `src/diff/noise-filter.ts`：`isImportReorder` 新增 `language` 参数，支持 Python import 模式
- [x] T010 修改 `src/diff/noise-filter.ts`：`filterNoise` 新增可选 `language` 参数并传透

## Phase 5: 测试

- [x] T011 更新 `tests/unit/llm-client.test.ts`：测试 buildSystemPrompt 接受 terminology 参数
- [x] T012 新增或更新 `tests/unit/noise-filter.test.ts`：测试多语言注释和 import 模式
- [x] T013 运行全量测试验证零回归
