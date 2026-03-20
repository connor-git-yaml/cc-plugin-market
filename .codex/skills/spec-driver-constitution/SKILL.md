---
name: spec-driver-constitution
description: "创建或更新项目宪法，并同步计划/规范/任务模板与运行时约束"
disable-model-invocation: false
---

## Codex Runtime Adapter

此 Skill 在安装时直接同步自 `$PLUGIN_DIR/skills/spec-driver-constitution/SKILL.md` 的描述与正文，只额外叠加以下 Codex 运行时差异：

- 命令别名：正文中的 `/spec-driver.constitution` 在 Codex 中等价于 `$spec-driver-constitution`
- 子代理执行：正文中的 `Task(...)` / `Task tool` 在 Codex 中视为当前会话内联子代理执行
- 并行回退：原并行组若当前环境无法并行，必须显式标注 `[回退:串行]`
- 模型兼容：保持 `--preset -> agents.{agent_id}.model(仅显式配置时生效) -> preset 默认` 优先级；runtime=codex 时先做 `model_compat` 归一化，不可用时标注 `[模型回退]`
- 质量门与产物：所有质量门、制品路径、写入边界与 source skill 完全一致，不得弱化或越界

---


# Spec Driver — 项目宪法维护器

你负责创建或更新项目宪法，确保 `.specify/memory/constitution.md` 与相关模板、命令覆盖和运行时约束保持一致。

## 触发方式

```text
/spec-driver.constitution [原则更新说明]
$spec-driver-constitution [原则更新说明]
```

你 **必须** 先考虑 `$ARGUMENTS` 中的用户输入（如果不为空）。

## 执行流程

1. 读取现有宪法文件 `.specify/memory/constitution.md`
   - 若文件不存在，先从 `.specify/templates/constitution-template.md` 复制
   - 识别所有 `[ALL_CAPS_IDENTIFIER]` 占位符
   - 如果用户指定原则数量，按用户要求调整，不机械沿用模板条数

2. 收集并推导占位值
   - 优先使用用户输入
   - 其次从仓库上下文推导（README、docs、现有 constitution、AGENTS/CLAUDE 约束等）
   - `RATIFICATION_DATE` 表示首次采纳日期；未知则写 `TODO(RATIFICATION_DATE): ...`
   - `LAST_AMENDED_DATE` 在本次有改动时更新为今天
   - `CONSTITUTION_VERSION` 按语义化规则递增：
     - MAJOR: 删除/重定义原则，产生不兼容治理变化
     - MINOR: 新增原则或实质扩展治理范围
     - PATCH: 纯澄清、措辞优化、错字修复

3. 生成更新后的宪法正文
   - 替换所有应落地的占位符，不保留未解释的方括号 token
   - 保持原有标题层级
   - 每条原则必须可执行、可验证，避免模糊措辞
   - Governance 段必须明确修订流程、版本策略与合规检查要求

4. 同步检查并修正相关制品
   - 读取 `.specify/templates/plan-template.md`，确保 Constitution Check 与最新原则一致
   - 读取 `.specify/templates/spec-template.md`，确保需求规范包含新的必填约束
   - 读取 `.specify/templates/tasks-template.md`，确保任务模板反映新的质量与治理要求
   - 如存在，读取 `.claude/commands/*.md` 与 `.codex/commands/*.md`，修正过时引用
   - 读取运行时指导文档（如 README、AGENTS、CLAUDE、docs/quickstart）并同步必要引用

5. 在宪法顶部写入 Sync Impact Report（HTML 注释）
   - 版本变更：old -> new
   - 修改/重命名的原则
   - 新增/删除的章节
   - 受影响模板清单（✅ 已更新 / ⚠ 待处理）
   - 延后处理的 TODO

6. 写回文件前自检
   - 无未解释的方括号占位符
   - 版本号与影响报告一致
   - 日期为 `YYYY-MM-DD`
   - 原则使用明确的 MUST/SHOULD 语义

7. 覆写 `.specify/memory/constitution.md`

8. 向用户输出摘要
   - 新版本号与 bump 原因
   - 仍需人工跟进的文件
   - 建议 commit message，例如 `docs: amend constitution to vX.Y.Z`

## 约束

- 只修改宪法及其直接同步依赖制品
- 不新建第二份模板或旁路文件
- 若关键信息无法推导，明确写入 `TODO(...)`，不要静默省略
