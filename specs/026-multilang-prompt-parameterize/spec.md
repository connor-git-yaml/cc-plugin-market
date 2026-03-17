# Feature 026: LLM Prompt 与上下文语言参数化

> 编号: 026 | 状态: **implementing** | Blueprint: 024 Feature 2

## 背景

Feature 025 已完成 LanguageAdapter 抽象层和 `LanguageTerminology` 类型定义，
`context-assembler.ts`、`semantic-diff.ts`、`secret-redactor.ts` 中的代码块标记和测试文件检测已参数化。

但 `llm-client.ts` 中的 `buildSystemPrompt` 仍硬编码 TypeScript 术语：
- "TypeScript 代码块"
- "导出函数/类/类型"
- "import 导入"

`noise-filter.ts` 中的注释移除和 import 重排序检测也仅支持 JS/TS 语法。

## 需求

### FR-026-01: buildSystemPrompt 语言参数化
- `buildSystemPrompt` 接受可选 `LanguageTerminology` 参数
- spec-generation 模式下，用术语替换硬编码 TS 描述
- 无 terminology 时保持现有行为（向后兼容）

### FR-026-02: callLLM 传透 terminology
- `LLMConfig` 扩展 `languageTerminology` 可选字段
- `callLLM` 将 terminology 传递到 `buildSystemPrompt`

### FR-026-03: 编排器自动获取 terminology
- `single-spec-orchestrator.ts` 从 Registry 查找适配器获取 terminology
- 传递给 `callLLM` 调用

### FR-026-04: drift-orchestrator 传递 language
- `evaluateBehaviorChange` 调用时传递 `currentSkeleton.language`

### FR-026-05: noise-filter 多语言化
- `normalizeForComparison` 支持 Python `#` 注释
- `isImportReorder` 支持 Python `import`/`from...import` 模式
- 提供语言参数化接口

## 验收标准

- TS/JS 项目的 prompt 输出与修改前语义一致
- 传入 Python terminology 时，prompt 正确使用对应术语
- 所有现有测试零回归
- noise-filter 正确处理 Python 注释和 import
