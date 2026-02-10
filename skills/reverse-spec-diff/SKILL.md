---
name: reverse-spec-diff
description: |
  Use this skill when the user asks to:
  - Compare code against its spec to find drift
  - Check if spec is still in sync with code
  - Find new behaviors not documented in spec
  - Identify spec items that no longer exist in code
  - Validate spec accuracy after code changes
  Useful after code changes to keep specs current, or before refactoring to understand what's changed.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Purpose

Detect specification drift between a .spec.md and its corresponding source code. Useful after code changes to keep specs current, or before refactoring to understand what's changed.

## Execution Flow

### 1. Parse Arguments

Expected format: `<spec-file> [source-target]`

- `<spec-file>`: Path to existing .spec.md (required)
- `[source-target]`: Path to source code (optional — inferred from spec's `related_files` frontmatter)

If spec file doesn't exist, suggest running `/reverse-spec` first.

### 2. Load & Parse Spec

Read the .spec.md and extract:
- All documented interfaces (function signatures, endpoints, types)
- All documented business rules
- All documented edge cases
- All documented constraints
- Technical debt items
- File inventory from appendix

### 3. Analyze Current Code

Re-scan the source target using the same analysis as `/reverse-spec` but keep results in memory (don't write).

### 4. Compute Diff

Compare spec vs current code:

#### Added in Code (not in spec)
- New public APIs / exports
- New business logic branches
- New error handling
- New dependencies
- New files not in inventory

#### Removed from Code (still in spec)
- APIs documented but no longer exported
- Business rules documented but logic removed
- Files in inventory but deleted

#### Modified
- Signature changes (parameters added/removed/renamed)
- Logic changes (different branching, new conditions)
- Constraint changes (different limits, new validations)

### 5. Output Drift Report

```markdown
# Spec Drift Report: <component name>

**Spec**: <spec-file path>
**Source**: <source path>
**Analyzed**: <current date>

## Summary
- Additions (code → spec needed): N
- Removals (spec → code deleted): N
- Modifications: N
- Drift severity: LOW | MEDIUM | HIGH

## Additions (in code, missing from spec)
| Item | Type | Location | Description |
|------|------|----------|-------------|

## Removals (in spec, missing from code)
| Item | Spec Section | Description |
|------|-------------|-------------|

## Modifications (changed since spec)
| Item | Spec Says | Code Shows | Location |
|------|-----------|------------|----------|

## Recommendation
<Whether to update spec, update code, or both>
```

### 6. Offer Update

Ask: "Would you like me to update the spec to match current code? This will run `/reverse-spec` with the existing spec as a baseline."

Do NOT auto-update. Wait for user confirmation.

## 语言规范

**所有漂移报告的正文内容必须使用中文撰写。** 具体规则：

- **用中文**：所有描述、说明、分析、总结、表格内容、建议
- **保留英文**：代码标识符（函数名、类名、变量名）、文件路径、类型签名、代码块内容
- **表格表头**：使用中文，例如 `| 项目 | 类型 | 位置 | 描述 |`

## Guidelines

- 这是**只读分析**——未经用户同意不修改任何文件
- 关注**语义**差异，而非格式/风格变化
- 忽略空白、纯注释变更和 import 重排序
- **突出标记破坏性变更**（删除/修改的公开 API）
