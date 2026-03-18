# 数据模型: 032-rename-speckit-to-spec-driver

**Date**: 2026-03-18
**Status**: Completed

---

## 概述

本 Feature 为纯 rename-only 变更，不涉及新增实体或数据结构。以下记录的是受影响的"命名实体"及其映射关系。

---

## 命名映射表

### Skill 目录名映射

| 旧名称 | 新名称 | 位置 |
|--------|--------|------|
| `speckit-feature` | `spec-driver-feature` | `plugins/spec-driver/skills/` |
| `speckit-story` | `spec-driver-story` | `plugins/spec-driver/skills/` |
| `speckit-fix` | `spec-driver-fix` | `plugins/spec-driver/skills/` |
| `speckit-resume` | `spec-driver-resume` | `plugins/spec-driver/skills/` |
| `speckit-sync` | `spec-driver-sync` | `plugins/spec-driver/skills/` |
| `speckit-doc` | `spec-driver-doc` | `plugins/spec-driver/skills/` |

### 命令文件名映射

| 旧名称 | 新名称 | 位置 |
|--------|--------|------|
| `speckit.analyze.md` | `spec-driver.analyze.md` | `.claude/commands/` |
| `speckit.checklist.md` | `spec-driver.checklist.md` | `.claude/commands/` |
| `speckit.clarify.md` | `spec-driver.clarify.md` | `.claude/commands/` |
| `speckit.constitution.md` | `spec-driver.constitution.md` | `.claude/commands/` |
| `speckit.implement.md` | `spec-driver.implement.md` | `.claude/commands/` |
| `speckit.plan.md` | `spec-driver.plan.md` | `.claude/commands/` |
| `speckit.specify.md` | `spec-driver.specify.md` | `.claude/commands/` |
| `speckit.tasks.md` | `spec-driver.tasks.md` | `.claude/commands/` |
| `speckit.taskstoissues.md` | `spec-driver.taskstoissues.md` | `.claude/commands/` |

### 变量与函数名映射

| 旧名称 | 新名称 | 类型 |
|--------|--------|------|
| `HAS_SPECKIT_SKILLS` | `HAS_SPEC_DRIVER_SKILLS` | 环境变量 / Prompt 变量 |
| `detect_speckit_skills()` | `detect_spec_driver_skills()` | Bash 函数名 |
| `speckit_skills:found` | `spec_driver_skills:found` | JSON 输出键名 |
| `speckit_skills:none` | `spec_driver_skills:none` | JSON 输出键名 |

### HTML 锚点映射

| 旧格式 | 新格式 |
|--------|--------|
| `<!-- speckit:section:* -->` | `<!-- spec-driver:section:* -->` |
| `<!-- speckit:section:*:end -->` | `<!-- spec-driver:section:*:end -->` |

### 命令触发路径映射

| 旧路径 | 新路径 |
|--------|--------|
| `/speckit.analyze` | `/spec-driver.analyze` |
| `/speckit.checklist` | `/spec-driver.checklist` |
| `/speckit.clarify` | `/spec-driver.clarify` |
| `/speckit.constitution` | `/spec-driver.constitution` |
| `/speckit.implement` | `/spec-driver.implement` |
| `/speckit.plan` | `/spec-driver.plan` |
| `/speckit.specify` | `/spec-driver.specify` |
| `/speckit.tasks` | `/spec-driver.tasks` |
| `/speckit.taskstoissues` | `/spec-driver.taskstoissues` |

### Skill 触发路径映射

| 旧路径 | 新路径 |
|--------|--------|
| `/spec-driver:speckit-feature` | `/spec-driver:spec-driver-feature` |
| `/spec-driver:speckit-story` | `/spec-driver:spec-driver-story` |
| `/spec-driver:speckit-fix` | `/spec-driver:spec-driver-fix` |
| `/spec-driver:speckit-resume` | `/spec-driver:spec-driver-resume` |
| `/spec-driver:speckit-sync` | `/spec-driver:spec-driver-sync` |
| `/spec-driver:speckit-doc` | `/spec-driver:spec-driver-doc` |

---

## 受影响文件清单（按区域分组）

### 区域 1: Plugin Skills（6 目录 + 6 SKILL.md）

- `plugins/spec-driver/skills/speckit-feature/SKILL.md` (10 处引用)
- `plugins/spec-driver/skills/speckit-story/SKILL.md` (7 处引用)
- `plugins/spec-driver/skills/speckit-fix/SKILL.md` (5 处引用)
- `plugins/spec-driver/skills/speckit-resume/SKILL.md` (11 处引用)
- `plugins/spec-driver/skills/speckit-sync/SKILL.md` (8 处引用)
- `plugins/spec-driver/skills/speckit-doc/SKILL.md` (27 处引用)

### 区域 2: Codex Skills（6 SKILL.md）

- `.codex/skills/spec-driver-feature/SKILL.md` (6 处引用)
- `.codex/skills/spec-driver-story/SKILL.md` (5 处引用)
- `.codex/skills/spec-driver-fix/SKILL.md` (2 处引用)
- `.codex/skills/spec-driver-resume/SKILL.md` (6 处引用)
- `.codex/skills/spec-driver-sync/SKILL.md` (6 处引用)
- `.codex/skills/spec-driver-doc/SKILL.md` (27 处引用)

### 区域 3: 命令文件（9 文件）

- `.claude/commands/speckit.analyze.md` (4 处引用)
- `.claude/commands/speckit.checklist.md` (2 处引用)
- `.claude/commands/speckit.clarify.md` (5 处引用)
- `.claude/commands/speckit.constitution.md` (1 处引用)
- `.claude/commands/speckit.implement.md` (1 处引用)
- `.claude/commands/speckit.plan.md` (2 处引用)
- `.claude/commands/speckit.specify.md` (5 处引用)
- `.claude/commands/speckit.tasks.md` (2 处引用)
- `.claude/commands/speckit.taskstoissues.md` (0 处内部引用，仅文件名)

### 区域 4: Plugin 脚本（4 文件）

- `plugins/spec-driver/scripts/init-project.sh` (11 处引用)
- `plugins/spec-driver/scripts/codex-skills.sh` (12 处引用)
- `plugins/spec-driver/scripts/postinstall.sh` (6 处引用)
- `plugins/spec-driver/scripts/scan-project.sh` (1 处引用)

### 区域 5: Plugin 模板（3 文件）

- `plugins/spec-driver/templates/specify-base/plan-template.md` (7 处引用)
- `plugins/spec-driver/templates/specify-base/tasks-template.md` (1 处引用)
- `plugins/spec-driver/templates/specify-base/checklist-template.md` (2 处引用)

### 区域 6: Plugin 文档与配置（5 文件）

- `plugins/spec-driver/README.md` (35 处引用)
- `plugins/spec-driver/.claude-plugin/plugin.json` (1 处引用)
- `plugins/spec-driver/agents/sync.md` (6 处引用)
- `plugins/spec-driver/agents/constitution.md` (1 处引用)
- `plugins/spec-driver/contracts/scan-project-output.md` (2 处引用)
- `plugins/spec-driver/templates/product-spec-template.md` (3 处引用)

### 区域 7: .specify 独立模板与脚本（4 文件）

- `.specify/templates/plan-template.md` (7 处引用)
- `.specify/templates/tasks-template.md` (1 处引用)
- `.specify/templates/checklist-template.md` (2 处引用)
- `.specify/scripts/bash/check-prerequisites.sh` (3 处引用)

### 区域 8: 根级文件（4 文件）

- `README.md` (56 处引用)
- `CLAUDE.md` (6 处引用)
- `.claude-plugin/marketplace.json` (2 处引用)
- `.claude/settings.local.json` (1 处引用)

### 区域 9: 产品活文档（2 文件）

- `specs/products/spec-driver/current-spec.md` (64 处引用)
- `specs/products/product-mapping.yaml` (4 处引用，其中 2 处为保留的历史 ID)

---

## 汇总统计

| 维度 | 数量 |
|------|------|
| 目录重命名 | 6 个（Plugin Skills） |
| 文件重命名 | 9 个（命令文件） |
| 文件内容修改 | 约 45 个文件 |
| 引用替换总数 | 约 310+ 处（不含历史 spec 目录） |
| 排除的历史文件 | 约 80+ 个（`specs/[0-9][0-9][0-9]-*/` 下） |
