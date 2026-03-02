# 验证报告 — 020-fix-plugin-script-path

**日期**: 2026-03-02
**模式**: fix（快速修复）
**分支**: 020-fix-plugin-script-path

---

## Layer 1: Spec-Code 对齐验证

### FR-001: SessionStart Hook 路径写入

| 检查项 | 状态 | 说明 |
|--------|------|------|
| postinstall.sh 在 SessionStart 时执行 | PASS | hooks.json v2 格式，`type: "command"` 指向 `${CLAUDE_PLUGIN_ROOT}/scripts/postinstall.sh` |
| 确定插件绝对路径 (PLUGIN_DIR) | PASS | 优先 `$CLAUDE_PLUGIN_ROOT`，回退 `dirname "$SCRIPT_DIR"` |
| 确定项目根目录 (PROJECT_DIR) | PASS | 优先 `$CLAUDE_PROJECT_DIR`，回退 `$(pwd)` |
| 创建 `.specify/` 目录 | PASS | `mkdir -p` + `|| true`，非阻塞 |
| 写入 `.specify/.spec-driver-path` | PASS | `echo -n "$PLUGIN_DIR" > ...`，幂等覆盖写入 |
| 写入失败不阻塞会话 | PASS | 所有错误路径 `return 0` |

### FR-002: SKILL.md 路径发现

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 6 个 SKILL.md 含路径发现代码块 | PASS | speckit-feature/story/fix/resume/doc/sync 均包含一致的路径发现段 |
| 读取 `.specify/.spec-driver-path` | PASS | `PLUGIN_DIR=$(cat .specify/.spec-driver-path)` |
| 回退逻辑 | PASS | `PLUGIN_DIR="plugins/spec-driver"` |
| 脚本调用使用 `$PLUGIN_DIR` | PASS | 所有 `init-project.sh`/`scan-project.sh` 调用已更新 |

### FR-003: 模板/Agent 路径解析

| 检查项 | 状态 | 说明 |
|--------|------|------|
| SKILL.md 中模板引用 | PASS | `$PLUGIN_DIR/templates/...` |
| SKILL.md 中 agents 引用 | PASS | `$PLUGIN_DIR/agents/...` |
| agents/*.md 中模板引用 | PASS | 4 个 agent 文件的模板回退路径已更新为 `$PLUGIN_DIR/templates/...` |

### FR-004: codex-skills.sh 兼容

| 检查项 | 状态 | 说明 |
|--------|------|------|
| REPO_ROOT 已移除 | PASS | 改为 `PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"` |
| source skill 路径使用 PLUGIN_DIR | PASS | `$PLUGIN_DIR/skills/speckit-*/SKILL.md` |
| 生成的 wrapper 使用 $PLUGIN_DIR | PASS | agents 引用模板已更新 |

### FR-005: 向后兼容

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 无 .spec-driver-path 时回退正常 | PASS | 所有 SKILL.md 回退到 `"plugins/spec-driver"` |
| 源码开发场景兼容 | PASS | reverse-spec 项目内仍可通过 fallback 路径工作 |

### FR-006: 幂等性

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 多次 SessionStart 不出错 | PASS | `write_plugin_path` 每次覆盖写入，幂等 |
| 版本升级后路径自动更新 | PASS | 每次 SessionStart 重新写入最新 PLUGIN_DIR |

---

## Layer 2: 工具链验证

### 构建/Lint

| 工具 | 命令 | 结果 |
|------|------|------|
| TypeScript | `tsc --noEmit` | PASS（0 错误） |

### 测试

| 工具 | 命令 | 结果 |
|------|------|------|
| Vitest | `npm test` | PASS（40 文件，319 用例，0 失败） |

### Bash 语法

| 脚本 | 命令 | 结果 |
|------|------|------|
| postinstall.sh | `bash -n` | PASS |
| codex-skills.sh | `bash -n` | PASS |

---

## Layer 3: 一致性验证

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 插件目录内无遗留硬编码路径 | PASS | `grep -r "plugins/spec-driver/"` 仅 README.md 目录结构图（文档展示） |
| 6 个 SKILL.md 路径发现段格式一致 | PASS | 代码块结构、fallback 值完全相同 |
| hooks.json v2 格式正确 | PASS | JSON 合法，结构符合 Claude Code hook spec |

---

## 总结

| 维度 | 状态 |
|------|------|
| Spec 对齐 | PASS（6/6 FR 覆盖） |
| 工具链验证 | PASS（构建+Lint+测试） |
| 一致性 | PASS |
| **总体** | **PASS** |

### 修改范围统计

- 修改文件: 13
  - `scripts/postinstall.sh` — 扩展路径写入功能
  - `hooks/hooks.json` — v2 格式升级
  - `skills/speckit-{feature,story,fix,resume,doc,sync}/SKILL.md` (6 个) — 路径发现 + 引用替换
  - `scripts/codex-skills.sh` — REPO_ROOT → PLUGIN_DIR
  - `agents/{tech-research,product-research,sync,verify}.md` (4 个) — 模板路径更新
  - `README.md` — codex-skills.sh 调用示例更新
- 新增文件: 0
- 删除文件: 0
