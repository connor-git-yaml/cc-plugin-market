# Research: 统一 spec 输出目录引用（.specs → specs）

**Date**: 2026-02-15
**Feature**: `010-fix-dotspecs-to-specs`

## R1: 影响范围扫描

**Decision**: 全量搜索项目中所有 `.specs` 引用，分类为源代码、文档、plugin 三个层面。

**Findings**:

### 源代码文件（运行时影响）

| 文件 | 行号 | 引用类型 |
|------|------|----------|
| `src/core/single-spec-orchestrator.ts` | 244 | 默认 `outputDir = '.specs'` |
| `src/batch/batch-orchestrator.ts` | 131, 145, 233, 243 | 硬编码 `'.specs'` 路径（4 处） |
| `src/batch/checkpoint.ts` | 11 | `DEFAULT_CHECKPOINT_PATH = '.specs/...'` |
| `src/mcp/server.ts` | 67 | zod default `'.specs'` |
| `src/cli/commands/batch.ts` | 36 | 输出消息 `.specs/_index.spec.md` |
| `src/installer/skill-templates.ts` | 68, 98, 112, 114 | Skill 模板字符串（4 处） |

### SKILL.md 文件

| 文件 | 引用数 |
|------|--------|
| `src/skills-global/reverse-spec/SKILL.md` | 5 处 |
| `src/skills-global/reverse-spec-batch/SKILL.md` | 6 处 |
| `plugins/reverse-spec/skills/reverse-spec/SKILL.md` | 5 处 |
| `plugins/reverse-spec/skills/reverse-spec-batch/SKILL.md` | 6 处 |

### 文档文件

| 文件 | 引用数 |
|------|--------|
| `CLAUDE.md` | 1 处 |
| `plugins/reverse-spec/README.md` | 2 处 |
| `specs/001-reverse-spec-v2/` 下多个文件 | ~10 处 |
| `specs/002-cli-global-distribution/` 下多个文件 | ~5 处 |
| `specs/009-plugin-marketplace/` 下多个文件 | ~3 处 |

### 排除项（不修改）

| 文件 | 原因 |
|------|------|
| `specs/008-fix-spec-absolute-paths/spec.md` | 历史 spec，描述"改为 .specs"的需求本身，保留历史准确性 |
| `specs/008-fix-spec-absolute-paths/tasks.md` | 历史 tasks，记录已完成的任务内容 |
| `specs/010-fix-dotspecs-to-specs/spec.md` | 本次 spec，引用 `.specs` 是为了描述"从 .specs 改为 specs" |
| `specs/010-fix-dotspecs-to-specs/checklists/` | 本次 checklist，同上 |

**Rationale**: Feature 008 的 spec 和 tasks 是历史文档，描述的是"当时的需求"，修改会扭曲历史记录。Feature 010 自身的文档也不需要改。

## R2: Constitution 合规性

**Decision**: 此变更仅涉及字符串替换，与 Constitution 所有原则兼容。

- **IV. 只读安全性**：Constitution 原文写的是 `specs/` 和 `drift-logs/`，将输出目录改回 `specs/` 恰好与 Constitution 一致
- 无新增依赖，无功能变更，无架构变更

## R3: .gitignore 影响

**Decision**: 需要检查 `.gitignore` 中是否有 `.specs/` 相关条目需要同步修改回 `specs/`。

**Finding**: Feature 008 将 checkpoint 路径从 `specs/.reverse-spec-checkpoint.json` 改为 `.specs/.reverse-spec-checkpoint.json`，需要改回。
