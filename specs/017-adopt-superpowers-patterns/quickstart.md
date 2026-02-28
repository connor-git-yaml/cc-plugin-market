# 快速上手指南: 借鉴 Superpowers 行为约束模式与增强人工控制权

**特性分支**: `017-adopt-superpowers-patterns`
**目标读者**: 实现子代理（implement 阶段）和新加入的贡献者

## 概述

本特性为 Spec Driver 引入 4 项核心能力：验证铁律、双阶段代码审查、三级门禁策略、设计硬门禁。所有变更限于 Markdown prompt 文件、YAML 配置和 Shell 脚本，不涉及 TypeScript 代码或新增运行时依赖。

## 变更文件速查表

### 修改文件

| 文件 | 变更内容 | 优先级 |
|------|---------|--------|
| `plugins/spec-driver/agents/implement.md` | 植入验证铁律约束段落 | MVP 第一批 |
| `plugins/spec-driver/agents/verify.md` | 拆分为双阶段触发 + 验证证据检查 | MVP 第一批 |
| `plugins/spec-driver/skills/speckit-feature/SKILL.md` | 编排器新增 gate_policy 条件分支 + GATE_DESIGN 暂停点 | MVP 第一批 |
| `plugins/spec-driver/skills/speckit-story/SKILL.md` | 编排器新增 gate_policy 条件分支 + GATE_DESIGN 豁免逻辑 | MVP 第一批 |
| `plugins/spec-driver/skills/speckit-fix/SKILL.md` | 编排器新增 gate_policy 条件分支 + GATE_DESIGN 豁免逻辑 | MVP 第一批 |
| `plugins/spec-driver/templates/spec-driver.config-template.yaml` | 新增 gate_policy + gates 配置段 | MVP 第一批 |
| `plugins/spec-driver/scripts/init-project.sh` | 支持新配置字段初始化引导 | MVP 第一批 |
| `spec-driver.config.yaml`（项目级示例） | 同步新增配置字段 | MVP 第一批 |

### 新增文件

| 文件 | 职责 | 优先级 |
|------|------|--------|
| `plugins/spec-driver/agents/spec-review.md` | Spec 合规审查子代理——逐条检查 FR 实现状态 | MVP 第一批 |
| `plugins/spec-driver/agents/quality-review.md` | 代码质量审查子代理——设计/安全/性能/可维护性四维度评估 | MVP 第一批 |

### MVP 第二批（Hooks 层，本次 plan 范围外的增强）

| 文件 | 职责 |
|------|------|
| `plugins/spec-driver/hooks/pre-commit-verify.sh` | PreToolUse hook——拦截未验证的 git commit |
| `plugins/spec-driver/hooks/post-verify-collect.sh` | PostToolUse hook——收集验证证据到 JSON |
| `.claude/settings.json` 模板片段 | hooks 配置注入模板 |

## 核心概念

### 1. 验证铁律

implement.md 子代理在声称任务完成前，**必须**在当前执行上下文中实际运行验证命令（构建、测试、Lint），并将命令输出包含在返回消息中。以下表述将被拒绝：

```text
禁止表述（会被 verify 子代理拒绝）:
- "should pass"
- "looks correct"
- "tests will likely pass"
- "代码看起来没问题"

要求表述（包含实际输出）:
- "运行 npm test，输出: 23 tests passed, 0 failed"
- "运行 npm run build，退出码 0，无错误"
```

### 2. 三级门禁策略

在 `spec-driver.config.yaml` 中配置 `gate_policy`:

```yaml
gate_policy: balanced  # 默认值，向后兼容

# 可选值:
# strict    — 所有门禁暂停等待确认
# balanced  — 关键门禁暂停（GATE_DESIGN/GATE_TASKS/GATE_VERIFY），非关键自动继续
# autonomous — 仅失败或 CRITICAL 问题时暂停
```

### 3. 门禁级配置

高级用户可对每个门禁独立配置：

```yaml
gates:
  GATE_RESEARCH:
    pause: auto          # 始终自动继续
  GATE_DESIGN:
    pause: always        # 始终暂停（feature 模式下此配置被忽略——硬门禁始终生效）
  GATE_TASKS:
    pause: on_failure    # 仅失败时暂停
  GATE_VERIFY:
    pause: always        # 始终暂停
```

门禁级配置优先于 gate_policy 全局策略。

### 4. 设计硬门禁

- **Feature 模式**: spec.md 生成后强制暂停等待用户确认，不受任何配置影响
- **Story 模式**: 默认跳过设计门禁
- **Fix 模式**: 默认跳过设计门禁

### 5. 双阶段审查

验证阶段（Phase 7）内部拆分为 3 个子调用：

```text
Phase 7: 验证闭环
  ├── 7a: spec-review.md   → Spec 合规审查报告（逐条 FR 状态）
  ├── 7b: quality-review.md → 代码质量审查报告（四维度评估）
  └── 7c: verify.md         → 工具链验证（构建/Lint/测试）
```

## 开发顺序建议

1. **先改配置**：spec-driver.config-template.yaml 新增 gate_policy + gates
2. **再建子代理**：创建 spec-review.md 和 quality-review.md
3. **改编排器**：SKILL.md 中增加门禁决策逻辑和 GATE_DESIGN 暂停点
4. **改子代理**：implement.md 植入铁律 + verify.md 增加证据检查
5. **最后改脚本**：init-project.sh 支持新配置字段
