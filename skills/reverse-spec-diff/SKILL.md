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

## Execution Flow

### 1. Parse Arguments

格式: `<spec-file> [source-target]`。spec 不存在时建议先运行 /reverse-spec。

### 2. 漂移检测

优先使用 CLI：

```bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec diff $SPEC_FILE $SOURCE_TARGET [--output-dir drift-logs/]
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec diff $SPEC_FILE $SOURCE_TARGET [--output-dir drift-logs/]
fi
```

CLI 不可用时手动分析：读取 spec 接口定义，对比当前源码导出符号，按严重级别分类（HIGH=删除导出, MEDIUM=签名变更, LOW=新增导出）。

### 3. 输出报告

写入 `drift-logs/{module}-drift-{date}.md`，包含汇总统计和逐项差异详情。

### 4. 确认更新

**必须提示用户确认**后才能更新 spec。不可自动更新。

**语言**: 中文正文 + 英文代码标识符/路径/代码块
**规则**: 只读分析；关注语义差异；忽略空白/注释变更；突出破坏性变更
