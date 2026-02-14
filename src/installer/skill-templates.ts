/**
 * SKILL.md 模板内容常量
 * 精简版：Claude Code 原生模式优先，使用 prepare 子命令获取 AST 数据
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

\\\`\\\`\\\`text
$ARGUMENTS
\\\`\\\`\\\`

## Execution Flow

### 1. Parse Target

从 \\\`$ARGUMENTS\\\` 确定分析目标（文件或目录）。无参数时询问用户。支持 \\\`--deep\\\` 标志。

### 2. AST 预分析（可选，推荐）

尝试运行 CLI 获取精确的 AST 骨架（导出签名、导入、类型）：

\\\`\\\`\\\`bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec prepare $TARGET_PATH --deep
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec prepare $TARGET_PATH --deep
fi
\\\`\\\`\\\`

如果 CLI 不可用，跳过此步——直接读取源文件分析。

### 3. 生成 Spec

基于 AST 输出（如有）和源代码，生成 9 段式中文 Spec 文档：

1. **意图** — 模块目的和存在理由
2. **接口定义** — 所有导出 API（签名必须来自代码，不可捏造）
3. **业务逻辑** — 核心算法和工作流
4. **数据结构** — 类型、接口、枚举
5. **约束条件** — 性能、安全、平台约束
6. **边界条件** — 错误处理、降级策略
7. **技术债务** — TODO/FIXME、改进空间
8. **测试覆盖** — 已测试行为、覆盖缺口
9. **依赖关系** — 内部/外部依赖

不确定的内容用 \\\`[推断: 理由]\\\` 标注。

### 4. 写入

写入 \\\`specs/<name>.spec.md\\\`。仅写入 specs/ 目录，不修改源代码。

**语言**: 中文正文 + 英文代码标识符/路径/代码块
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

\\\`\\\`\\\`text
$ARGUMENTS
\\\`\\\`\\\`

## Execution Flow

### 1. 项目扫描

扫描项目结构，识别顶层模块（src/ 子目录、monorepo 包等），检查 specs/ 中已有的 spec。

### 2. 展示计划并确认

列出待分析模块（按依赖顺序），显示文件数和 LOC，等待用户确认后再执行。

### 3. 逐模块生成

对每个模块执行 \\\`/reverse-spec\\\`。跳过已存在的 spec（除非用户指定 --force）。

CLI 批量模式（如可用）：

\\\`\\\`\\\`bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec batch [--force] [--output-dir specs]
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec batch [--force] [--output-dir specs]
fi
\\\`\\\`\\\`

### 4. 汇总报告

报告生成结果：成功/跳过/失败模块、跨模块观察。

**语言**: 中文正文 + 英文代码标识符/路径/代码块
**规则**: 按依赖顺序处理；可恢复（中断后跳过已完成）；不重复已有 spec
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

\\\`\\\`\\\`text
$ARGUMENTS
\\\`\\\`\\\`

## Execution Flow

### 1. Parse Arguments

格式: \\\`<spec-file> [source-target]\\\`。spec 不存在时建议先运行 /reverse-spec。

### 2. 漂移检测

优先使用 CLI：

\\\`\\\`\\\`bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec diff $SPEC_FILE $SOURCE_TARGET [--output-dir drift-logs/]
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec diff $SPEC_FILE $SOURCE_TARGET [--output-dir drift-logs/]
fi
\\\`\\\`\\\`

CLI 不可用时手动分析：读取 spec 接口定义，对比当前源码导出符号，按严重级别分类（HIGH=删除导出, MEDIUM=签名变更, LOW=新增导出）。

### 3. 输出报告

写入 \\\`drift-logs/{module}-drift-{date}.md\\\`，包含汇总统计和逐项差异详情。

### 4. 确认更新

**必须提示用户确认**后才能更新 spec。不可自动更新。

**语言**: 中文正文 + 英文代码标识符/路径/代码块
**规则**: 只读分析；关注语义差异；忽略空白/注释变更；突出破坏性变更
`;

// ============================================================
// 导出 Skill 定义集合
// ============================================================

export const SKILL_DEFINITIONS: readonly SkillDefinition[] = [
  { name: 'reverse-spec', content: REVERSE_SPEC_CONTENT },
  { name: 'reverse-spec-batch', content: REVERSE_SPEC_BATCH_CONTENT },
  { name: 'reverse-spec-diff', content: REVERSE_SPEC_DIFF_CONTENT },
] as const;
