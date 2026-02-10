---
name: reverse-spec-batch
description: |
  Use this skill when the user asks to:
  - Generate specs for an entire project or codebase
  - Document all modules systematically
  - Create a complete specification index for the project
  - Batch process multiple modules for spec generation
  This skill generates an architecture overview index, then iterates through modules producing individual .spec.md files.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Purpose

Systematically reverse-engineer specs for an entire codebase. Generates an index spec with architecture overview, then iterates through modules producing individual .spec.md files.

## Execution Flow

### 1. Project Survey

Scan the project root to understand structure:

1. **Detect project type**: monorepo, single app, library, CLI, etc.
2. **Identify top-level modules**: `src/` subdirectories, packages in monorepo, major feature folders
3. **Estimate total scope**: file count, LOC per module
4. **Detect existing specs**: Check `specs/` directory for already-generated specs

### 2. Generate Batch Plan

Present the analysis plan to the user:

```markdown
## Reverse-Spec Batch Plan

**Project**: <name>
**Type**: <project type>
**Total scope**: N files, ~N LOC

### Modules to analyze (in dependency order):

| # | Module | Files | LOC | Existing Spec? | Priority |
|---|--------|-------|-----|----------------|----------|
| 1 | core/utils | 5 | 320 | No | Foundation |
| 2 | models/ | 8 | 890 | No | Data layer |
| 3 | auth/ | 12 | 1450 | Yes (outdated) | Critical |
| ... | | | | | |

**Estimated effort**: ~N minutes with AI analysis

Proceed with all? Or select specific modules (e.g., "1,3,5" or "auth/ models/")
```

Wait for user confirmation before proceeding.

### 3. Generate Index Spec

Create `specs/_index.spec.md`:

```markdown
---
type: project-index
version: 1.0
generated_by: reverse-spec-batch
last_updated: <date>
---

# <Project Name> — Architecture Overview

## System Purpose
<High-level what this project does>

## Architecture
<Pattern: monolith/microservice/serverless/etc>
<Key architectural decisions visible in code>

## Module Map
| Module | Spec | Purpose | Dependencies |
|--------|------|---------|--------------|
| <mod>  | [link](./mod.spec.md) | <purpose> | <deps> |

## Cross-Cutting Concerns
- Authentication: <how handled>
- Error handling: <pattern>
- Logging: <approach>
- Configuration: <approach>

## Technology Stack
- Language(s): ...
- Framework(s): ...
- Database(s): ...
- Key libraries: ...
```

### 4. Iterate Through Modules

For each module in the plan:

1. Run the equivalent of `/reverse-spec <module-path>`
2. Write to `specs/<module-name>.spec.md`
3. Update `specs/_index.spec.md` module map with link
4. Report: "✅ Generated spec for <module> (N/M complete). Continue?"
5. If user says stop, save progress and report remaining modules

### 5. Final Summary

After all modules (or user stop):

```markdown
## Batch Reverse-Spec Complete

**Generated**: N/M specs
**Index**: specs/_index.spec.md
**Total time**: ~N minutes

### Generated Specs:
- ✅ specs/auth.spec.md (high confidence)
- ✅ specs/models.spec.md (medium confidence)
- ⏭️ specs/api.spec.md (skipped by user)

### Project-Wide Observations:
- <Cross-module patterns noticed>
- <Shared technical debt themes>
- <Architecture recommendations>
```

## 语言规范

**所有 spec 文档的正文内容必须使用中文撰写。** 具体规则：

- **用中文**：所有描述、说明、分析、总结、表格内容、注释
- **保留英文**：代码标识符（函数名、类名、变量名）、文件路径、类型签名、代码块内容
- **章节标题**：使用中文，例如 `## 1. 意图`、`## 2. 接口定义`
- **表格表头**：使用中文，例如 `| 模块 | 规格 | 用途 | 依赖 |`
- **Frontmatter**：保留英文（YAML 键名）

## Guidelines

- 按**依赖顺序**处理模块（基础模块优先）
- **可恢复**：如果中断，检查已有 specs 并跳过已完成的模块
- **不重复生成**已存在的 spec，除非用户指定 `--force`
- 每个模块的 spec 保持**自包含**，但通过索引交叉引用
