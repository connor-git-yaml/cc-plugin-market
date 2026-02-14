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

## Execution Flow

### 1. 项目扫描

扫描项目结构，识别顶层模块（src/ 子目录、monorepo 包等），检查 specs/ 中已有的 spec。

### 2. 展示计划并确认

列出待分析模块（按依赖顺序），显示文件数和 LOC，等待用户确认后再执行。

### 3. 逐模块生成

对每个模块执行 `/reverse-spec`。跳过已存在的 spec（除非用户指定 --force）。

CLI 批量模式（如可用）：

```bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec batch [--force] [--output-dir specs/]
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec batch [--force] [--output-dir specs/]
fi
```

### 4. 汇总报告

报告生成结果：成功/跳过/失败模块、跨模块观察。

**语言**: 中文正文 + 英文代码标识符/路径/代码块
**规则**: 按依赖顺序处理；可恢复（中断后跳过已完成）；不重复已有 spec
