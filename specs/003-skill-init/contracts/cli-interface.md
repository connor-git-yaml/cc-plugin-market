# CLI Interface Contract: `reverse-spec init`

**Date**: 2026-02-12

## Command Signature

```text
reverse-spec init [--global] [--remove]
```

## Options

| 选项 | 缩写 | 说明 | 默认值 |
| --- | --- | --- | --- |
| `--global` | `-g` | 安装到全局目录 `~/.claude/skills/` | false（项目级） |
| `--remove` | 无 | 移除已安装的 skill | false（安装模式） |

## Option Combinations

| 命令 | 行为 |
| --- | --- |
| `reverse-spec init` | 安装 3 个 skill 到 `.claude/skills/` |
| `reverse-spec init --global` | 安装 3 个 skill 到 `~/.claude/skills/` |
| `reverse-spec init --remove` | 移除 `.claude/skills/` 中的 reverse-spec skill |
| `reverse-spec init --remove --global` | 移除 `~/.claude/skills/` 中的 reverse-spec skill |

## Exit Codes

| 退出码 | 含义 |
| --- | --- |
| 0 | 操作成功（含部分 skill 跳过的情况） |
| 1 | 操作失败（所有 skill 安装/移除均失败） |

## Output Format

### 安装成功

```text
reverse-spec skills 安装完成:
  ✓ 已安装: .claude/skills/reverse-spec/SKILL.md
  ✓ 已安装: .claude/skills/reverse-spec-batch/SKILL.md
  ✓ 已安装: .claude/skills/reverse-spec-diff/SKILL.md

提示: 在 Claude Code 中使用 /reverse-spec 即可调用
```

### 更新（文件已存在）

```text
reverse-spec skills 已更新:
  ✓ 已更新: .claude/skills/reverse-spec/SKILL.md
  ✓ 已更新: .claude/skills/reverse-spec-batch/SKILL.md
  ✓ 已更新: .claude/skills/reverse-spec-diff/SKILL.md
```

### 移除成功

```text
reverse-spec skills 已移除:
  ✓ 已删除: .claude/skills/reverse-spec/
  ✓ 已删除: .claude/skills/reverse-spec-batch/
  ✓ 已删除: .claude/skills/reverse-spec-diff/
```

### 移除（无需清理）

```text
未检测到已安装的 reverse-spec skills，无需清理
```

### 部分失败

```text
reverse-spec skills 安装完成（部分失败）:
  ✓ 已安装: .claude/skills/reverse-spec/SKILL.md
  ⚠ 失败: .claude/skills/reverse-spec-batch/SKILL.md — 权限不足
  ✓ 已安装: .claude/skills/reverse-spec-diff/SKILL.md
```

### 全局模式提示

```text
reverse-spec skills 已安装到全局目录:
  ✓ 已安装: ~/.claude/skills/reverse-spec/SKILL.md
  ✓ 已安装: ~/.claude/skills/reverse-spec-batch/SKILL.md
  ✓ 已安装: ~/.claude/skills/reverse-spec-diff/SKILL.md

注意: 全局 skill 优先级高于项目级 skill
```

## Installed File Structure

### Per-Skill Directory

```text
.claude/skills/reverse-spec/
└── SKILL.md          # 包含 frontmatter + 指令 + 内联降级逻辑
```

### SKILL.md Internal Structure

```yaml
---
name: reverse-spec
description: |
  Use this skill when the user asks to: ...
---

## User Input
$ARGUMENTS

## Purpose
[skill 用途说明]

## Execution Flow

### Run Pipeline

[指令文本，包含内联降级 bash 代码块:]

```bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec generate "$TARGET_PATH" --deep
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec generate "$TARGET_PATH" --deep
else
  echo "无法找到 reverse-spec 命令" >&2
  echo "请安装: npm install -g reverse-spec" >&2
  exit 1
fi
```

[其余指令...]
```

## Integration with parse-args.ts

### CLICommand Extension

```typescript
// 现有类型扩展
interface CLICommand {
  subcommand: 'generate' | 'batch' | 'diff' | 'init';  // 新增 'init'
  // ... 现有字段 ...
  global: boolean;   // 新增: --global 选项
  remove: boolean;   // 新增: --remove 选项
}
```

### Parsing Rules

1. `init` 子命令不接受位置参数（无 target）
2. `--global` / `-g` 选项仅在 `init` 子命令下有效
3. `--remove` 选项仅在 `init` 子命令下有效
4. 非 `init` 子命令使用 `--global` 或 `--remove` 应报错

## Integration with CLI Help Text

```text
reverse-spec — 代码逆向工程 Spec 生成工具 vX.X.X

用法:
  reverse-spec generate <target> [--deep] [--output-dir <dir>]
  reverse-spec batch [--force] [--output-dir <dir>]
  reverse-spec diff <spec-file> <source> [--output-dir <dir>]
  reverse-spec init [--global] [--remove]
  reverse-spec --version / --help

子命令:
  generate    对指定文件或目录生成 Spec
  batch       批量生成整个项目的 Spec
  diff        检测 Spec 与源代码的漂移
  init        安装 Claude Code skills 到项目或全局目录

选项:
  --global, -g   安装到全局 ~/.claude/skills/（仅 init）
  --remove       移除已安装的 skills（仅 init）
  --deep         包含函数体进行深度分析（仅 generate）
  --force        强制重新生成所有 Spec（仅 batch）
  --output-dir   自定义输出目录
  --version, -v  显示版本号
  --help, -h     显示帮助信息
```
