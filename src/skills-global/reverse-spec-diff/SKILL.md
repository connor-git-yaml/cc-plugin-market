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

### 2. Run Drift Detection Pipeline

Execute the drift detection using the globally installed `reverse-spec` CLI:

```bash
reverse-spec diff <spec-file> <source-target>
```

如果需要自定义输出目录：

```bash
reverse-spec diff <spec-file> <source-target> --output-dir drift-logs/
```

流水线自动执行以下步骤：
1. 从 spec HTML 注释加载基线 `CodeSkeleton`
2. 对当前源代码进行 AST 分析
3. 结构差异比较（`compareSkeletons`）
4. 噪声过滤（空白/注释/import 重排序）
5. 语义差异评估（LLM，可选）
6. 组装 `DriftReport` 并写入 `drift-logs/`

### 3. Fallback: Manual Analysis

如果 CLI 流水线不可用（依赖未安装、编译错误等），手动执行：

1. 读取 spec 文件，提取接口定义章节
2. 对源代码进行 AST 分析
3. 对比 spec 中的导出符号与当前代码
4. 按严重级别分类差异：
   - **HIGH**: 删除的导出（Breaking Change）
   - **MEDIUM**: 签名修改、行为变更
   - **LOW**: 新增导出

### 4. Output Drift Report

报告自动写入 `drift-logs/{module}-drift-{date}.md`，包含：
- YAML frontmatter（spec 路径、源码路径、版本）
- 汇总统计表（按严重级别和变更类型）
- 逐项漂移详情（ID、类别、位置、旧/新值、建议更新）
- 综合建议

### 5. Offer Update

**在任何 spec 更新前必须提示用户确认。**

Ask: "是否需要更新 spec 以匹配当前代码？这将运行 `/reverse-spec` 并使用现有 spec 作为基线。"

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
