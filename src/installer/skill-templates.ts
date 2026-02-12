/**
 * SKILL.md 模板内容常量
 * 每个模板包含 frontmatter + 指令 + 内联三级降级 bash 逻辑
 */

import type { SkillDefinition } from './skill-installer.js';

// ============================================================
// reverse-spec（单模块 spec 生成）
// ============================================================

const REVERSE_SPEC_CONTENT = `---
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

\`\`\`text
$ARGUMENTS
\`\`\`

You **MUST** consider the user input before proceeding (if not empty).

## Purpose

通过 AST 静态分析 + LLM 混合三阶段流水线，将源代码逆向工程为结构化的 9 段式中文 Spec 文档。TypeScript/JavaScript 项目享有 AST 增强的精确分析，接口定义 100% 来自 AST 提取。

## Execution Flow

### 1. Parse Target

Interpret \`$ARGUMENTS\` to determine the analysis target:

- **Single file**: e.g., \`src/auth/login.ts\`
- **Directory**: e.g., \`src/auth/\` — analyze all TS/JS source files recursively
- **\`--deep\` flag**: Include function bodies in LLM context for deeper analysis
- **No argument**: Ask user to specify a target path

If the target doesn't exist, ERROR with suggestions based on project structure.

### 2. Run Pipeline

Execute the analysis pipeline, automatically detecting the best available execution method:

\`\`\`bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec generate $TARGET_PATH --deep
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec generate $TARGET_PATH --deep
else
  echo "无法找到 reverse-spec 命令" >&2
  echo "请安装: npm install -g reverse-spec" >&2
  echo "或确保 Node.js >=20.x 已安装（提供 npx）" >&2
  exit 1
fi
\`\`\`

如果需要自定义输出目录：

\`\`\`bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec generate $TARGET_PATH --deep --output-dir specs/
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec generate $TARGET_PATH --deep --output-dir specs/
else
  echo "无法找到 reverse-spec 命令" >&2
  echo "请安装: npm install -g reverse-spec" >&2
  echo "或确保 Node.js >=20.x 已安装（提供 npx）" >&2
  exit 1
fi
\`\`\`

**Pipeline stages**:
1. **预处理**: 扫描 TS/JS 文件 → ts-morph AST 分析 → CodeSkeleton 提取 → 敏感信息脱敏
2. **上下文组装**: 骨架 + 依赖 spec + 代码片段 → ≤100k token 预算的 LLM prompt
3. **生成增强**: Claude API 生成 9 段式中文 Spec → 解析验证 → Handlebars 渲染 → 写入 \`specs/*.spec.md\`

### 3. Handle Results

If pipeline succeeds, report:

\`\`\`
Spec 生成完成: specs/<name>.spec.md

分析摘要:
- 文件数: N
- 总行数: N LOC
- 导出 API: N 个
- Token 消耗: N
- 置信度: high|medium|low
- 警告: <warnings list>

后续步骤:
- 审查生成的 Spec 文档
- 使用 /reverse-spec-batch 批量生成全项目 Spec
- 使用 /reverse-spec-diff 检测 Spec 漂移
\`\`\`

If pipeline fails, fall back to manual analysis following the sections below.

### 4. Fallback: Manual Analysis

If the CLI pipeline is unavailable, perform manual analysis:

1. **Scan & inventory** all source files in scope
2. **Read and analyze** each file's exports, imports, types, and logic
3. **Generate spec** following the 9-section structure defined below
4. **Write** to \`specs/<target-name>.spec.md\`

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
3. **诚实标注不确定性**: 推断内容用 \`[推断: 理由]\`，模糊代码用 \`[不明确: 理由]\`
4. **只读安全性**: 仅向 \`specs/\` 写入输出，绝不修改源代码
5. **纯 Node.js 生态**: 所有依赖限于 npm 包
6. **双语文档**: 中文散文 + 英文代码标识符

## 语言规范

**所有 spec 文档的正文内容必须使用中文撰写。** 具体规则：

- **用中文**：所有描述、说明、分析、总结、表格内容
- **保留英文**：代码标识符、文件路径、类型签名、代码块内容
- **章节标题**：使用中文，例如 \`## 1. 意图\`、\`## 2. 接口定义\`
- **Frontmatter**：保留英文（YAML 键名）
`;

// ============================================================
// reverse-spec-batch（批量 spec 生成）
// ============================================================

const REVERSE_SPEC_BATCH_CONTENT = `---
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

\`\`\`text
$ARGUMENTS
\`\`\`

You **MUST** consider the user input before proceeding (if not empty).

## Purpose

Systematically reverse-engineer specs for an entire codebase. Generates an index spec with architecture overview, then iterates through modules producing individual .spec.md files.

## Execution Flow

### 1. Project Survey

Scan the project root to understand structure:

1. **Detect project type**: monorepo, single app, library, CLI, etc.
2. **Identify top-level modules**: \`src/\` subdirectories, packages in monorepo, major feature folders
3. **Estimate total scope**: file count, LOC per module
4. **Detect existing specs**: Check \`specs/\` directory for already-generated specs

### 2. Generate Batch Plan

Present the analysis plan to the user:

\`\`\`markdown
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
\`\`\`

Wait for user confirmation before proceeding.

### 3. Run Batch Pipeline

Execute the batch pipeline, automatically detecting the best available execution method:

\`\`\`bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec batch
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec batch
else
  echo "无法找到 reverse-spec 命令" >&2
  echo "请安装: npm install -g reverse-spec" >&2
  echo "或确保 Node.js >=20.x 已安装（提供 npx）" >&2
  exit 1
fi
\`\`\`

如果需要强制重新生成所有 spec：

\`\`\`bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec batch --force
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec batch --force
else
  echo "无法找到 reverse-spec 命令" >&2
  echo "请安装: npm install -g reverse-spec" >&2
  echo "或确保 Node.js >=20.x 已安装（提供 npx）" >&2
  exit 1
fi
\`\`\`

如果需要自定义输出目录：

\`\`\`bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec batch --output-dir specs/
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec batch --output-dir specs/
else
  echo "无法找到 reverse-spec 命令" >&2
  echo "请安装: npm install -g reverse-spec" >&2
  echo "或确保 Node.js >=20.x 已安装（提供 npx）" >&2
  exit 1
fi
\`\`\`

### 4. Final Summary

After batch completes:

\`\`\`markdown
## Batch Reverse-Spec Complete

**Generated**: N/M specs
**Index**: specs/_index.spec.md
**Total time**: ~N minutes

### Generated Specs:
- specs/auth.spec.md (high confidence)
- specs/models.spec.md (medium confidence)
- specs/api.spec.md (skipped by user)

### Project-Wide Observations:
- <Cross-module patterns noticed>
- <Shared technical debt themes>
- <Architecture recommendations>
\`\`\`

## 语言规范

**所有 spec 文档的正文内容必须使用中文撰写。** 具体规则：

- **用中文**：所有描述、说明、分析、总结、表格内容、注释
- **保留英文**：代码标识符（函数名、类名、变量名）、文件路径、类型签名、代码块内容
- **章节标题**：使用中文，例如 \`## 1. 意图\`、\`## 2. 接口定义\`
- **表格表头**：使用中文，例如 \`| 模块 | 规格 | 用途 | 依赖 |\`
- **Frontmatter**：保留英文（YAML 键名）

## Guidelines

- 按**依赖顺序**处理模块（基础模块优先）
- **可恢复**：如果中断，检查已有 specs 并跳过已完成的模块
- **不重复生成**已存在的 spec，除非用户指定 \`--force\`
- 每个模块的 spec 保持**自包含**，但通过索引交叉引用
`;

// ============================================================
// reverse-spec-diff（spec 漂移检测）
// ============================================================

const REVERSE_SPEC_DIFF_CONTENT = `---
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

\`\`\`text
$ARGUMENTS
\`\`\`

You **MUST** consider the user input before proceeding (if not empty).

## Purpose

Detect specification drift between a .spec.md and its corresponding source code. Useful after code changes to keep specs current, or before refactoring to understand what's changed.

## Execution Flow

### 1. Parse Arguments

Expected format: \`<spec-file> [source-target]\`

- \`<spec-file>\`: Path to existing .spec.md (required)
- \`[source-target]\`: Path to source code (optional — inferred from spec's \`related_files\` frontmatter)

If spec file doesn't exist, suggest running \`/reverse-spec\` first.

### 2. Run Drift Detection Pipeline

Execute the drift detection, automatically detecting the best available execution method:

\`\`\`bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec diff $SPEC_FILE $SOURCE_TARGET
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec diff $SPEC_FILE $SOURCE_TARGET
else
  echo "无法找到 reverse-spec 命令" >&2
  echo "请安装: npm install -g reverse-spec" >&2
  echo "或确保 Node.js >=20.x 已安装（提供 npx）" >&2
  exit 1
fi
\`\`\`

如果需要自定义输出目录：

\`\`\`bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec diff $SPEC_FILE $SOURCE_TARGET --output-dir drift-logs/
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec diff $SPEC_FILE $SOURCE_TARGET --output-dir drift-logs/
else
  echo "无法找到 reverse-spec 命令" >&2
  echo "请安装: npm install -g reverse-spec" >&2
  echo "或确保 Node.js >=20.x 已安装（提供 npx）" >&2
  exit 1
fi
\`\`\`

流水线自动执行以下步骤：
1. 从 spec HTML 注释加载基线 \`CodeSkeleton\`
2. 对当前源代码进行 AST 分析
3. 结构差异比较（\`compareSkeletons\`）
4. 噪声过滤（空白/注释/import 重排序）
5. 语义差异评估（LLM，可选）
6. 组装 \`DriftReport\` 并写入 \`drift-logs/\`

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

报告自动写入 \`drift-logs/{module}-drift-{date}.md\`，包含：
- YAML frontmatter（spec 路径、源码路径、版本）
- 汇总统计表（按严重级别和变更类型）
- 逐项漂移详情（ID、类别、位置、旧/新值、建议更新）
- 综合建议

### 5. Offer Update

**在任何 spec 更新前必须提示用户确认。**

Ask: "是否需要更新 spec 以匹配当前代码？这将运行 \`/reverse-spec\` 并使用现有 spec 作为基线。"

Do NOT auto-update. Wait for user confirmation.

## 语言规范

**所有漂移报告的正文内容必须使用中文撰写。** 具体规则：

- **用中文**：所有描述、说明、分析、总结、表格内容、建议
- **保留英文**：代码标识符（函数名、类名、变量名）、文件路径、类型签名、代码块内容
- **表格表头**：使用中文，例如 \`| 项目 | 类型 | 位置 | 描述 |\`

## Guidelines

- 这是**只读分析**——未经用户同意不修改任何文件
- 关注**语义**差异，而非格式/风格变化
- 忽略空白、纯注释变更和 import 重排序
- **突出标记破坏性变更**（删除/修改的公开 API）
`;

// ============================================================
// 导出 Skill 定义集合
// ============================================================

export const SKILL_DEFINITIONS: readonly SkillDefinition[] = [
  { name: 'reverse-spec', content: REVERSE_SPEC_CONTENT },
  { name: 'reverse-spec-batch', content: REVERSE_SPEC_BATCH_CONTENT },
  { name: 'reverse-spec-diff', content: REVERSE_SPEC_DIFF_CONTENT },
] as const;
