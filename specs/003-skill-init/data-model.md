# Data Model: 003-skill-init

**Date**: 2026-02-12

## Entities

### SkillDefinition

表示一个可安装的 skill 单元。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| name | string | skill 标识名（如 `reverse-spec`、`reverse-spec-batch`、`reverse-spec-diff`） |
| content | string | SKILL.md 的完整文本内容（包含 frontmatter + markdown 指令 + 内联降级逻辑） |

**唯一性规则**: `name` 在整个 Skill Pack 中唯一，同时也是安装目录名。

### InstallTarget

表示 skill 安装的目标位置。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| mode | `'project'` \| `'global'` | 安装模式 |
| basePath | string | 目标基础路径。项目级为 `process.cwd()/.claude/skills/`，全局级为 `~/.claude/skills/` |

### InstallResult

表示单个 skill 的安装/移除结果。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| skillName | string | skill 标识名 |
| status | `'installed'` \| `'updated'` \| `'removed'` \| `'skipped'` \| `'failed'` | 操作结果状态 |
| targetPath | string | 实际写入的文件路径 |
| error | string \| undefined | 失败时的错误信息 |

### InstallSummary

表示一次完整安装/移除操作的汇总。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| mode | `'project'` \| `'global'` | 安装模式 |
| action | `'install'` \| `'remove'` | 操作类型 |
| results | InstallResult[] | 每个 skill 的操作结果 |
| targetBasePath | string | 目标基础路径 |

## Relationships

```text
SkillDefinition  1──*  InstallResult   （每个 SkillDefinition 对应一个安装结果）
InstallTarget    1──1  InstallSummary  （每次操作针对一个目标位置）
InstallSummary   1──*  InstallResult   （一次操作产生多个结果）
```

## State Transitions

### InstallResult.status

```text
                  ┌─────────────┐
                  │  (开始安装)  │
                  └──────┬──────┘
                         │
                    ┌────┴────┐
                    │ 检测目标 │
                    └────┬────┘
                         │
               ┌─────────┼─────────┐
               │         │         │
          文件不存在   文件已存在   写入失败
               │         │         │
               ▼         ▼         ▼
          installed   updated    failed
               │         │
               │    (--remove)
               │         │
               ▼         ▼
                   removed / skipped（文件不存在时）
```

## Validation Rules

- `SkillDefinition.name`: 仅允许小写字母、数字和连字符，最大 64 字符（匹配 Claude Code skill 命名规则）
- `InstallTarget.basePath`: 必须是绝对路径
- `InstallSummary.results`: 长度必须等于 Skill Pack 中的 skill 数量（当前为 3）
