# 契约: 重命名映射表

**Date**: 2026-03-18
**Status**: Approved

---

## 概述

本契约定义 `speckit -> spec-driver` 重命名的精确映射规则。所有任务实现必须严格按照此映射执行，不得偏离。

---

## 映射规则

### Rule 1: 目录名替换

```
speckit-{suffix} -> spec-driver-{suffix}
```

适用于: `plugins/spec-driver/skills/speckit-*/` 目录

### Rule 2: 命令文件名替换

```
speckit.{phase}.md -> spec-driver.{phase}.md
```

适用于: `.claude/commands/speckit.*.md` 文件

### Rule 3: YAML name 字段替换

```yaml
# Before
name: speckit-{suffix}

# After
name: spec-driver-{suffix}
```

适用于: 所有 SKILL.md 的 Front Matter

### Rule 4: 命令触发路径替换

```
/speckit.{phase} -> /spec-driver.{phase}
```

适用于: 所有文件内容中的命令引用

### Rule 5: Skill 触发路径替换

```
/spec-driver:speckit-{suffix} -> /spec-driver:spec-driver-{suffix}
speckit-{suffix} -> spec-driver-{suffix}  (作为 Skill 名引用时)
```

适用于: 所有文件内容中的 Skill 名称引用

### Rule 6: HTML 锚点替换

```html
<!-- speckit:section:{name} --> -> <!-- spec-driver:section:{name} -->
<!-- speckit:section:{name}:end --> -> <!-- spec-driver:section:{name}:end -->
```

适用于: README.md 和其他含锚点标记的文件

### Rule 7: 变量名替换

```bash
HAS_SPECKIT_SKILLS -> HAS_SPEC_DRIVER_SKILLS
detect_speckit_skills -> detect_spec_driver_skills
speckit_skills -> spec_driver_skills
```

适用于: `init-project.sh`、SKILL.md 文件

### Rule 8: 路径修正（特殊情况）

```
plugins/speckit-driver-pro/ -> plugins/spec-driver/
```

适用于: `.claude/settings.local.json` 中的过时路径

---

## 排除规则

### 绝对排除（不得修改的文件）

1. `specs/[0-9][0-9][0-9]-*/` -- 所有历史 Feature spec 目录下的所有文件
2. `specs/032-rename-speckit-to-spec-driver/spec.md` -- 本 Feature 的 spec 文件
3. `.git/` -- Git 内部目录

### 条件排除（部分保留的引用）

1. `specs/products/product-mapping.yaml` 中的 `id` 字段值（如 `011-speckit-driver-pro`）
2. `CLAUDE.md` 中的历史 spec 目录路径（如 `specs/011-speckit-driver-pro/`）

---

## 验证契约

### 替换完成后，以下断言必须为真：

```bash
# 1. 非排除区域无 speckit 残留
grep -r "speckit" \
  --include="*.md" --include="*.json" --include="*.sh" --include="*.yaml" --include="*.hbs" \
  --exclude-dir="specs/011-speckit-driver-pro" \
  --exclude-dir="specs/015-speckit-doc-command" \
  --exclude-dir="specs/032-rename-speckit-to-spec-driver" \
  . | grep -v "specs/[0-9][0-9][0-9]-" | wc -l
# 期望输出: 0（或仅限 product-mapping.yaml 中的历史 ID）

# 2. 新 Skill 目录存在
ls plugins/spec-driver/skills/spec-driver-{feature,story,fix,resume,sync,doc}/SKILL.md
# 期望输出: 6 个文件全部存在

# 3. 新命令文件存在
ls .claude/commands/spec-driver.{analyze,checklist,clarify,constitution,implement,plan,specify,tasks,taskstoissues}.md
# 期望输出: 9 个文件全部存在

# 4. 旧 Skill 目录不存在
ls plugins/spec-driver/skills/speckit-* 2>&1
# 期望输出: No such file or directory

# 5. 旧命令文件不存在
ls .claude/commands/speckit.* 2>&1
# 期望输出: No such file or directory

# 6. 测试通过
npm test
# 期望输出: 全部通过

# 7. Lint 通过
npm run lint
# 期望输出: 无错误
```
