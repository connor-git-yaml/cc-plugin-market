# Plan: 026 LLM Prompt 语言参数化

## 架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| terminology 传递方式 | 通过 `LLMConfig.languageTerminology` | 最小化 API 变更，保持向后兼容 |
| 默认行为 | 无 terminology 时使用内联 TS 默认值 | 零回归 |
| noise-filter 参数化 | 增加 `language` 参数到 `filterNoise` | 保持简洁，不过度抽象 |

## 变更清单

### 1. `src/core/llm-client.ts`

- `buildSystemPrompt(mode, terminology?)` — 新增可选参数
- spec-generation prompt 中替换：
  - "TypeScript 代码块" → `${terminology.codeBlockLanguage} 代码块`
  - "导出函数/类/类型的完整签名" → `所有${terminology.exportConcept}的完整签名`
  - 数据结构章节 "TypeScript 代码块" → `${terminology.codeBlockLanguage} 代码块`
  - 依赖关系 "npm 包" → 根据语言动态描述
- `LLMConfig` 新增 `languageTerminology?: LanguageTerminology`
- `callLLMviaSdk` / `callLLMviaCliProxy` 传透 terminology

### 2. `src/core/single-spec-orchestrator.ts`

- `prepareContext` 或 `generateSpec` 中通过 Registry 获取 terminology
- 传递给 `callLLM` 的 config

### 3. `src/diff/drift-orchestrator.ts`

- `evaluateBehaviorChange` 调用增加第 4 参数 `currentSkeleton.language`

### 4. `src/diff/noise-filter.ts`

- `normalizeForComparison` 接受 `language` 参数
- 根据语言选择注释模式（JS: `//`, `/* */`; Python: `#`; Go: `//`, `/* */`）
- `isImportReorder` 接受 `language` 参数
- 根据语言选择 import 正则
- `filterNoise` 接受可选 `language` 参数

### 5. 测试

- `llm-client.test.ts`: 测试 terminology 参数化
- `noise-filter.test.ts`: 测试多语言注释和 import 模式
- 回归: 确保现有测试全部通过

## 不做

- 不修改 `context-assembler.ts`（025 已完成）
- 不修改 `secret-redactor.ts`（025 已完成）
- 不新增依赖
