---
name: reverse-spec
description: |
  Use this skill when the user asks to:
  - Generate a spec/specification from existing code
  - Document or analyze a module's architecture
  - Reverse engineer what a piece of code does
  - Create .spec.md documentation for a file, directory, or module
  - Understand the intent, interfaces, and business logic of existing code
  Supports single files (e.g., src/auth/login.ts), directories (e.g., src/auth/), or entire modules.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Purpose

通过 AST 静态分析 + LLM 混合三阶段流水线，将源代码逆向工程为结构化的 9 段式中文 Spec 文档。TypeScript/JavaScript 项目享有 AST 增强的精确分析，接口定义 100% 来自 AST 提取。

## Execution Flow

### 1. Parse Target

Interpret `$ARGUMENTS` to determine the analysis target:

- **Single file**: e.g., `src/auth/login.ts`
- **Directory**: e.g., `src/auth/` — analyze all TS/JS source files recursively
- **`--deep` flag**: Include function bodies in LLM context for deeper analysis
- **No argument**: Ask user to specify a target path

If the target doesn't exist, ERROR with suggestions based on project structure.

### 2. Run Pipeline

Execute the three-stage hybrid analysis pipeline by running the following TypeScript code via bash:

```bash
npx tsx -e "
import { generateSpec } from './src/core/single-spec-orchestrator.js';

const result = await generateSpec('$TARGET_PATH', {
  deep: $DEEP_FLAG,
  outputDir: 'specs',
  projectRoot: '.'
});

console.log(JSON.stringify(result, null, 2));
"
```

**Pipeline stages**:
1. **预处理**: 扫描 TS/JS 文件 → ts-morph AST 分析 → CodeSkeleton 提取 → 敏感信息脱敏
2. **上下文组装**: 骨架 + 依赖 spec + 代码片段 → ≤100k token 预算的 LLM prompt
3. **生成增强**: Claude API 生成 9 段式中文 Spec → 解析验证 → Handlebars 渲染 → 写入 `specs/*.spec.md`

### 3. Handle Results

If pipeline succeeds, report:

```
✅ Spec 生成完成: specs/<name>.spec.md

📊 分析摘要:
- 文件数: N
- 总行数: N LOC
- 导出 API: N 个
- Token 消耗: N
- 置信度: high|medium|low
- 警告: <warnings list>

💡 后续步骤:
- 审查生成的 Spec 文档
- 使用 /reverse-spec-batch 批量生成全项目 Spec
- 使用 /reverse-spec-diff 检测 Spec 漂移
```

If pipeline fails, fall back to manual analysis following the sections below.

### 4. Fallback: Manual Analysis

If the TypeScript pipeline is unavailable (e.g., dependencies not installed), perform manual analysis:

1. **Scan & inventory** all source files in scope
2. **Read and analyze** each file's exports, imports, types, and logic
3. **Generate spec** following the 9-section structure defined below
4. **Write** to `specs/<target-name>.spec.md`

### 5. 9-Section Spec Structure

Each generated spec must contain these 9 sections in Chinese:

1. **意图** — 模块目的和存在理由
2. **接口定义** — 所有导出 API（签名必须精确，不可捏造）
3. **业务逻辑** — 核心算法、决策树、工作流
4. **数据结构** — 类型定义、接口、Schema
5. **约束条件** — 性能、安全、平台约束
6. **边界条件** — 错误处理、边界条件、降级策略
7. **技术债务** — TODO/FIXME、缺失测试、硬编码值
8. **测试覆盖** — 已测试行为、覆盖缺口
9. **依赖关系** — 内部/外部依赖

## Constitution Rules (不可违反)

1. **AST 精确性优先**: 接口定义 100% 来自 AST/代码，绝不由 LLM 捏造
2. **混合分析流水线**: 强制三阶段（预处理 → 上下文组装 → 生成增强）
3. **诚实标注不确定性**: 推断内容用 `[推断: 理由]`，模糊代码用 `[不明确: 理由]`
4. **只读安全性**: 仅向 `specs/` 写入输出，绝不修改源代码
5. **纯 Node.js 生态**: 所有依赖限于 npm 包
6. **双语文档**: 中文散文 + 英文代码标识符

## 语言规范

**所有 spec 文档的正文内容必须使用中文撰写。** 具体规则：

- **用中文**：所有描述、说明、分析、总结、表格内容
- **保留英文**：代码标识符、文件路径、类型签名、代码块内容
- **章节标题**：使用中文，例如 `## 1. 意图`、`## 2. 接口定义`
- **Frontmatter**：保留英文（YAML 键名）
