# 快速上手: 032-rename-speckit-to-spec-driver

**Date**: 2026-03-18

---

## 变更概述

将项目中所有 `speckit` 前缀统一重命名为 `spec-driver`，消除命名不一致。这是一个纯 rename-only Feature，不涉及任何代码逻辑变更。

---

## 执行步骤概览

### Step 1: 目录重命名（git mv）

```bash
cd plugins/spec-driver/skills/
git mv speckit-feature spec-driver-feature
git mv speckit-story spec-driver-story
git mv speckit-fix spec-driver-fix
git mv speckit-resume spec-driver-resume
git mv speckit-sync spec-driver-sync
git mv speckit-doc spec-driver-doc
```

### Step 2: 命令文件重命名（git mv）

```bash
cd .claude/commands/
git mv speckit.analyze.md spec-driver.analyze.md
git mv speckit.checklist.md spec-driver.checklist.md
git mv speckit.clarify.md spec-driver.clarify.md
git mv speckit.constitution.md spec-driver.constitution.md
git mv speckit.implement.md spec-driver.implement.md
git mv speckit.plan.md spec-driver.plan.md
git mv speckit.specify.md spec-driver.specify.md
git mv speckit.tasks.md spec-driver.tasks.md
git mv speckit.taskstoissues.md spec-driver.taskstoissues.md
```

### Step 3: 文件内容批量替换

对每个区域的文件执行文本替换（详见 data-model.md 中的文件清单）：
- SKILL.md `name` 字段: `speckit-*` -> `spec-driver-*`
- 命令引用: `/speckit.*` -> `/spec-driver.*`
- Skill 名引用: `speckit-*` -> `spec-driver-*`
- HTML 锚点: `<!-- speckit:` -> `<!-- spec-driver:`
- 变量名: `HAS_SPECKIT_SKILLS` -> `HAS_SPEC_DRIVER_SKILLS`
- 函数名: `detect_speckit_skills` -> `detect_spec_driver_skills`
- JSON 键名: `speckit_skills` -> `spec_driver_skills`

### Step 4: 验证

```bash
# 确认无遗漏
grep -r "speckit" --include="*.md" --include="*.json" --include="*.sh" --include="*.yaml" --include="*.hbs" \
  --exclude-dir=".git" | grep -v "specs/[0-9][0-9][0-9]-"

# 测试通过
npm test

# Lint 通过
npm run lint
```

---

## 关键注意事项

1. **历史 spec 目录不动**: `specs/011-speckit-driver-pro/` 和 `specs/015-speckit-doc-command/` 及所有其他历史 Feature 目录保持原样
2. **原子性执行**: 所有重命名必须在一次操作中完成，避免中间状态导致引用断裂
3. **先 git mv 再改内容**: 确保 git 能正确识别文件移动而非删除+新增
4. **验证迁移文档**: 完成后在 README 中加入迁移指南，告知用户从 `speckit.*` 到 `spec-driver.*` 的变更
