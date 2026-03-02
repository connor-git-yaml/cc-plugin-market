# 快速上手指南: 插件脚本路径发现机制修复

**Feature Branch**: `020-fix-plugin-script-path`

---

## 变更概述

本修复解决 Spec Driver 插件在全局安装（通过 Plugin Marketplace）后，在新项目中执行 Skill 命令时脚本路径找不到的问题。

---

## 修改的文件清单

共 **9 个文件**需修改：

### Bash 脚本（3 个文件）

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `plugins/spec-driver/scripts/postinstall.sh` | 功能扩展 | 新增路径写入逻辑（PLUGIN_DIR → .specify/.spec-driver-path） |
| `plugins/spec-driver/hooks/hooks.json` | 格式升级 | 旧版格式 → 新版格式 + `${CLAUDE_PLUGIN_ROOT}` 路径 |
| `plugins/spec-driver/scripts/codex-skills.sh` | Bug 修复 | `REPO_ROOT` 三级路径推算 → `PLUGIN_DIR` 一级路径推算 |

### SKILL.md（5 个文件）

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `plugins/spec-driver/skills/speckit-feature/SKILL.md` | 路径改写 | 添加 PLUGIN_DIR 发现逻辑，替换硬编码路径 |
| `plugins/spec-driver/skills/speckit-story/SKILL.md` | 路径改写 | 同上 |
| `plugins/spec-driver/skills/speckit-fix/SKILL.md` | 路径改写 | 同上 |
| `plugins/spec-driver/skills/speckit-resume/SKILL.md` | 路径改写 | 同上 |
| `plugins/spec-driver/skills/speckit-doc/SKILL.md` | 路径改写 | 同上 |

### 文档（1 个文件）

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `README.md` | 路径更新 | 更新 codex-skills.sh 的调用示例中的相对路径引用 |

---

## 实现顺序

```text
1. postinstall.sh    → 扩展路径写入逻辑（基础设施）
2. hooks.json        → 格式升级（确保 postinstall.sh 可被正确调用）
3. codex-skills.sh   → 修复 REPO_ROOT 路径推算
4. SKILL.md x 5      → 添加路径发现逻辑
5. README.md         → 更新文档引用
```

---

## 验证步骤

### 场景 1: 全局安装在新项目中使用

```bash
# 1. 在新项目中启动 Claude Code 会话（触发 SessionStart）
# 2. 验证 .specify/.spec-driver-path 已生成
cat .specify/.spec-driver-path
# 预期输出: /Users/xxx/.claude/plugins/cache/cc-plugin-market/spec-driver/3.1.0

# 3. 执行任意 Skill 命令
/spec-driver:speckit-feature "测试需求"
# 预期: init-project.sh 被正确发现和执行
```

### 场景 2: 源码开发场景

```bash
# 在 reverse-spec 项目中
/spec-driver:speckit-feature "测试需求"
# 预期: 行为与修复前完全一致
```

### 场景 3: 幂等性验证

```bash
# 多次打开会话
cat .specify/.spec-driver-path  # 内容不变，无重复
```
