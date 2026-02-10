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

Analyze existing source code and generate a structured specification document (.spec.md) that captures intent, interfaces, business logic, constraints, edge cases, and technical debt. The generated spec is compatible with spec-kit's spec-driven development workflow, enabling future forward-engineering iterations.

## Execution Flow

### 1. Parse Target

Interpret `$ARGUMENTS` to determine the analysis target:

- **Single file**: e.g., `src/auth/login.ts`
- **Directory**: e.g., `src/auth/` — analyze all source files recursively
- **Module/pattern**: e.g., `src/auth/**/*.ts` or a logical module name
- **No argument**: Analyze the entire project (warn user about scope, ask for confirmation)

If the target doesn't exist, ERROR with suggestions based on project structure.

### 2. Determine Output Location

- Default: `specs/<target-name>.spec.md` (relative to project root)
- If `--out <path>` is specified in arguments, use that path
- If target is a directory, output to `specs/<dirname>.spec.md`
- If target is a file, output to `specs/<filename-without-ext>.spec.md`
- Create the `specs/` directory if it doesn't exist

### 3. Scan & Inventory

For the target scope, build an inventory:

1. **List all source files** in scope (skip binary, node_modules, vendor, build artifacts)
2. **Detect language(s)** and framework(s) in use
3. **Identify entry points**: exports, main functions, route handlers, class constructors
4. **Map dependencies**: imports, injections, inherited classes, external packages
5. **Estimate complexity**: file count, total LOC, cyclomatic complexity (rough estimate)

If scope exceeds ~50 files or ~5000 LOC, switch to **incremental mode** (see Section 8).

### 4. Extract Architectural Overview

Analyze code structure to determine:

- **Component type**: library, service, CLI tool, UI component, middleware, data model, etc.
- **Architectural pattern**: MVC, event-driven, pipeline, repository pattern, etc.
- **Key abstractions**: primary classes/interfaces/types and their relationships
- **Data flow**: how data enters, transforms, and exits the component

### 5. Deep Analysis — Extract Spec Sections

For each major unit (class, module, significant function), extract:

#### 5a. Intent (意图)
- What problem does this code solve?
- Infer from: function/class names, comments, docstrings, README references, test descriptions
- If unclear, state the inferred intent and mark with `[INFERRED]`

#### 5b. Interface (接口定义)
- Public API: exported functions, class methods, REST/GraphQL endpoints, CLI commands
- Input types and parameters (with defaults if present)
- Return types and output shapes
- Events emitted or consumed
- Configuration options / environment variables read

#### 5c. Business Logic (业务逻辑)
- Core algorithms and decision trees
- State machines or workflow steps
- Validation rules (input validation, business rule validation)
- Transformation pipelines
- Conditional branches with business significance

#### 5d. Data Structures (数据结构)
- Type definitions, interfaces, schemas
- Database models/migrations if present
- API request/response shapes
- Internal state shapes

#### 5e. Constraints (约束)
- Performance characteristics (timeouts, rate limits, batch sizes)
- Security measures (auth checks, sanitization, encryption)
- Resource limits (memory, connections, file size)
- Platform/environment requirements
- Invariants maintained by the code

#### 5f. Edge Cases (边界条件)
- Error handling patterns (try/catch, Result types, error codes)
- Null/undefined/empty handling
- Boundary conditions in loops, pagination, recursion
- Race conditions or concurrency handling
- Graceful degradation / fallback behavior
- Identified from: catch blocks, guard clauses, default cases, test edge cases

#### 5g. Technical Debt (技术债务)
- TODO/FIXME/HACK/XXX comments
- Suppressed linting rules (eslint-disable, @ts-ignore, noinspection)
- Dead code (unreachable branches, unused exports)
- Copy-pasted logic (near-duplicate blocks)
- Missing error handling (bare catches, swallowed errors)
- Outdated dependencies or deprecated API usage
- Missing tests for critical paths
- Hardcoded values that should be configurable
- Overly complex functions (high cyclomatic complexity)

### 6. Cross-Reference with Tests

If test files exist for the target:

1. Map test cases to spec sections (which behaviors are tested?)
2. Identify **untested paths** — business logic without corresponding tests
3. Extract **implicit requirements** from test assertions that aren't obvious in source
4. Note test quality: are tests unit/integration/e2e? Mock-heavy? Brittle?

### 7. Generate .spec.md

Write the spec file using this template:

```markdown
---
type: component-spec
version: 1.0
generated_by: reverse-spec
source_target: <target path>
related_files:
  - <list of analyzed files>
last_updated: <current date YYYY-MM-DD>
confidence: <high|medium|low — based on code clarity and documentation>
---

# <组件名称> 规格文档

> 由 reverse-spec 从现有代码自动生成。
> 请在用于正向开发之前审查和完善。

## 1. 意图

<该组件的功能和存在的原因>

## 2. 接口定义

### 公开 API

<导出的函数、方法、端点及其签名>

### 配置项

<环境变量、配置选项>

### 事件 / 信号

<发出或消费的事件>

## 3. 业务逻辑

<核心算法、决策树、工作流>

### 关键规则

<从代码中提取的业务规则编号列表>

## 4. 数据结构

<类型定义、接口、Schema>

## 5. 约束条件

### 性能
<超时、限制、批量大小>

### 安全
<认证、输入清理、加密>

### 平台
<环境要求、依赖>

## 6. 边界条件

<错误处理模式、边界条件、降级策略>

| 条件 | 处理方式 | 位置 |
|------|----------|------|
| <边界条件> | <处理方式> | <file:line> |

## 7. 技术债务

| 项目 | 严重程度 | 位置 | 描述 |
|------|----------|------|------|
| <债务项> | 高/中/低 | <file:line> | <描述> |

## 8. 测试覆盖

- **已测试**：<已测试的行为列表>
- **未测试**：<已识别的覆盖缺口>
- **测试质量备注**：<观察结果>

## 9. 依赖关系

### 内部依赖
<该模块依赖的其他项目模块>

### 外部依赖
<第三方包及版本>

## 附录：文件清单

| 文件 | 代码行数 | 主要用途 |
|------|----------|----------|
| <file> | <loc> | <用途> |
```

### 8. Incremental Mode (Large Codebases)

When scope exceeds thresholds (~50 files or ~5000 LOC):

1. **Generate index spec first**: `specs/_index.spec.md` with high-level architecture overview
2. **Break into sub-specs**: One .spec.md per major directory or module
3. **Report progress**: After each sub-spec, report what's done and what remains
4. **Cross-reference**: Each sub-spec links to related sub-specs
5. **Ask user**: "Generated spec for `src/auth/`. Continue with `src/api/`?" (proceed unless stopped)

### 9. Quality Self-Check

Before finalizing, validate:

- [ ] All public interfaces documented
- [ ] No `[INFERRED]` markers without justification
- [ ] Technical debt items have severity ratings
- [ ] Edge cases table is populated (not empty)
- [ ] File inventory matches actual analyzed files
- [ ] Frontmatter `related_files` is accurate

Report any items that couldn't be fully analyzed with reasons.

### 10. Completion Report

Output a summary:

```
✅ Reverse spec generated: specs/<name>.spec.md

📊 Analysis Summary:
- Files analyzed: N
- Total LOC: N
- Public APIs found: N
- Business rules extracted: N
- Edge cases identified: N
- Technical debt items: N
- Test coverage gaps: N
- Confidence: high|medium|low

💡 Next steps:
- Review and refine the generated spec
- Use /speckit.plan to create implementation plan from spec
- Use /speckit.tasks to break down into tasks
```

## 语言规范

**所有 spec 文档的正文内容必须使用中文撰写。** 具体规则：

- **用中文**：所有描述、说明、分析、总结、表格内容、注释
- **保留英文**：代码标识符（函数名、类名、变量名）、文件路径、类型签名、代码块内容
- **章节标题**：使用中文，例如 `## 1. 意图`、`## 2. 接口定义`
- **表格表头**：使用中文，例如 `| 条件 | 处理方式 | 位置 |`
- **Frontmatter**：保留英文（YAML 键名）

示例：
- 正确：`该模块负责管理 AI Agent 的完整生命周期`
- 正确：`通过 \`runEmbeddedPiAgent()\` 函数启动 Agent 运行`
- 错误：`This module manages the AI Agent lifecycle`

## Guidelines

- **诚实标注不确定性**：用 `[推断]` 标记猜测的意图，用 `[不明确]` 标记模糊代码
- **保留开发者上下文**：在 spec 中包含相关代码注释
- **避免过度抽象**：保持 spec 具体且可追溯到实际代码
- **语言无关输出**：spec 格式适用于任何源代码语言
- **遵守 .gitignore**：除非明确指定，不分析被忽略的文件
- **只读操作**：此命令不会修改源代码
