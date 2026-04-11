# Implementation Plan: 深度代码反求增强

**Branch**: `095-deep-reverse-spec` | **Date**: 2026-04-11 | **Spec**: [spec.md](./spec.md)

---

## Summary

本计划将 reverse-spec 的核心生成管线从"AST 骨架 + 占位符降级"升级为"AST 骨架 + 控制流切片 + LLM 语义桥接"。

当前管线的根本缺陷有三处：

1. `parseLLMResponse`（`src/core/llm-client.ts:541`）对缺失章节直接注入"此章节待补充"占位符，而非从代码中补全
2. `assembleContext` 的 `codeSnippets` 仅在 `--deep` 模式下激活，且传入整文件原文——导致 LLM 缺乏函数体语义上下文
3. `file-scanner.ts` 的 `UNIVERSAL_IGNORE_DIRS` 未包含 examples/vendor/dist 等语义目录，`module-grouper.ts` 无目录语义分类能力

技术方案：新增 2 个组件（`CodeSliceExtractor`、`DirectoryClassifier`），修改 4 处现有组件（`assembleContext` 扩展、`buildSystemPrompt` 强化、`parseLLMResponse` 占位符消除、Python mapper 属性提取），零新增 npm 依赖。

---

## 任务组划分

### 任务组 A：代码切片提取器（FR-001、FR-004、FR-010）

**新建**：`src/core/code-slice-extractor.ts`

- 通过 `ExportSymbol.startLine/endLine` 定位函数体，提取控制流骨架（if/for/try + 调用链 + return）
- 函数优先级：(1) 公开导出 (2) 被多处 import (3) 含复杂控制流
- Token 预算裁剪：默认 40k（maxTokens * 0.4），按 priority 降序裁剪
- Minified 检测：行长 > 500 字符占比 > 30% → 跳过

### 任务组 B：目录分类器（FR-005、FR-006、FR-013）

**新建**：`src/batch/directory-classifier.ts`
**修改**：`src/utils/file-scanner.ts`（UNIVERSAL_IGNORE_DIRS 扩展）、`src/batch/module-grouper.ts`（GroupingOptions 新增 classifyDirectories）

- 三信号组合：目录名模式（高权重）+ 文件内容特征（中权重）+ Import 反向引用（高权重，可覆盖名称判定）
- 分类类别：source / test / example / vendor / config / docs
- 用户覆盖：ProjectConfig 新增 excludeDirs/includeDirs

### 任务组 C：上下文增强组装器（FR-007、FR-008、FR-010）

**修改**：`src/core/context-assembler.ts`、`src/core/single-spec-orchestrator.ts`

- AssemblyOptions 新增可选字段 `codeSlices` 和 `readmeContext`
- 裁剪优先级：skeleton > codeSlices > readmeContext > codeSnippets > dependencies
- prepareContext 插入切片提取调用（步骤 2.5）和 README 读取（步骤 2.6）

### 任务组 D：LLM Prompt 更新与占位符消除（FR-002、FR-003、FR-012）

**修改**：`src/core/llm-client.ts`、`src/core/query-mappers/python-mapper.ts`

- parseLLMResponse：仅在 LLM 降级时保留 fallback，正常流程不注入占位符
- buildSystemPrompt：追加"绝对禁止占位符"约束段
- generateAstOnlyContent：基于骨架数据生成有意义的签名表格和流程描述
- python-mapper：`_extractClassMembers` 增加 `__init__` 中 `self.xxx` 属性提取

---

## 依赖顺序

```
A（切片提取器）→ C（上下文组装器，依赖 A 的 CodeSlice 类型）→ D（Prompt 更新，与 C 协同）
B（目录分类器）独立，可并行
```

推荐执行序：D（最轻量）→ A → C → B

---

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件 | 6（orchestrator、context-assembler、llm-client、module-grouper、file-scanner、python-mapper） |
| 新增文件 | 2（code-slice-extractor.ts、directory-classifier.ts） |
| 新增测试 | 2（code-slice-extractor.test.ts、directory-classifier.test.ts） |
| 风险等级 | **MEDIUM** |
| 数据迁移 | 无 |
| 接口变更 | 全部为可选字段扩展，向后兼容 |

---

## Constitution Check

全部 PASS，无 VIOLATION。关键决策：
- `EnrichedContextAssembler` 取消为独立组件，改为扩展 `AssemblyOptions`（原则 III 合规）
- 切片提取复用现有 `web-tree-sitter`，零新增依赖（原则 VIII 合规）
- 所有接口扩展为可选字段（原则 XIII 合规）
