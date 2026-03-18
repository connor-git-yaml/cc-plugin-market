# 技术决策研究: 032-rename-speckit-to-spec-driver

**Date**: 2026-03-18
**Status**: Completed

---

## Decision 1: 重命名执行策略

### 结论

采用 **git mv + sed 批量替换** 策略，分三步执行：
1. `git mv` 重命名目录/文件（保留 git 历史追踪）
2. `sed -i` / 手动编辑替换文件内容中的 `speckit` 引用
3. `grep -r` 全量验证无遗漏

### 理由

- `git mv` 保留文件重命名历史，便于 `git log --follow` 追踪
- 文本替换是确定性操作，不涉及逻辑变更，`sed` 是最高效的工具
- 分步执行便于 review：先看文件结构变化（`git mv`），再看内容变化（`sed`）

### 替代方案

| 方案 | 拒绝理由 |
|------|----------|
| 手动逐文件编辑 | 效率低，易遗漏 |
| 脚本全自动替换（不区分文件类型） | 可能误伤二进制文件或 git 内部文件 |
| 正则表达式模糊匹配 | 本次替换均为精确字符串，无需正则复杂度 |

---

## Decision 2: 排除范围界定

### 结论

排除以下路径的 `speckit` 引用，不做修改：
- `specs/[0-9][0-9][0-9]-*/` -- 所有历史 Feature spec 目录（已生成的历史产物）
- `specs/032-rename-speckit-to-spec-driver/` -- 本 Feature 自身的 spec 文件
- `specs/products/product-mapping.yaml` 中的 `id` 字段（历史 Feature ID）
- `.git/` -- Git 内部目录

### 理由

- 历史 Feature 目录是不可变的设计制品，修改会破坏 git 追溯性
- 历史 Feature ID（如 `011-speckit-driver-pro`）与目录名绑定，保持一致性
- 本 Feature 的 spec.md 本身就在讨论 `speckit` 重命名，修改会造成文档自引用混乱

### 替代方案

| 方案 | 拒绝理由 |
|------|----------|
| 全量替换包括历史 spec | 破坏 git 追溯性，违反 FR-017 |
| 仅排除 011 和 015 两个目录 | 不完整，其他历史 spec 中也有引用 |

---

## Decision 3: `init-project.sh` JSON 输出键名变更处理

### 结论

将 JSON 输出键名从 `speckit_skills:found` / `speckit_skills:none` 重命名为 `spec_driver_skills:found` / `spec_driver_skills:none`，同步更新所有下游消费者（SKILL.md 中的解析逻辑）。

### 理由

- JSON 键名是下游 SKILL.md prompt 中硬编码引用的标识符
- 保持键名与变量名 `HAS_SPEC_DRIVER_SKILLS` 一致，降低维护认知负担
- 属于 rename-only 行为变更的唯一例外，但因下游同步更新，实际行为不变

### 替代方案

| 方案 | 拒绝理由 |
|------|----------|
| 保留旧 JSON 键名 `speckit_skills` | 与 `HAS_SPEC_DRIVER_SKILLS` 命名不一致，增加混淆 |

---

## Decision 4: 命令文件重命名后的触发路径兼容性

### 结论

不提供向后兼容层（如旧命令文件重定向），仅在迁移文档中说明用户侧需要的更新操作。

### 理由

- Claude Code 命令系统不支持别名/重定向机制
- 旧命令文件删除后，用户输入 `/speckit.plan` 会得到"命令不存在"的明确错误
- 迁移文档已覆盖用户侧操作步骤（FR-019）

### 替代方案

| 方案 | 拒绝理由 |
|------|----------|
| 保留旧文件作为 wrapper | 增加维护负担，且 Claude Code 无标准 redirect 机制 |
| 同时保留新旧文件 | 命名不一致的根本问题未解决 |

---

## Decision 5: `current-spec.md` 处理策略

### 结论

更新 `specs/products/spec-driver/current-spec.md` 中的 `speckit` 引用为 `spec-driver`，但保留历史 Feature ID（如 `011-speckit-driver-pro`）不变。

### 理由

- `current-spec.md` 是活文档，由 `spec-driver-sync` Skill 定期重新生成
- 如果不更新，下次 sync 时可能产生混合命名
- 历史 Feature ID 是不可变标识符，与 `specs/` 目录名绑定

### 替代方案

| 方案 | 拒绝理由 |
|------|----------|
| 跳过 current-spec.md | 活文档中的旧命名会在下次 sync 时造成混乱 |
| 删除后由 sync 重新生成 | 不确定 sync 是否已适配新命名，引入不必要风险 |
