---
name: spec-driver-resume
description: "恢复中断的 Spec-driver 研发流程 — 扫描已有制品并从断点继续编排"
disable-model-invocation: true
---

## Codex Runtime Adapter

此 Skill 在安装时直接同步自 `$PLUGIN_DIR/skills/spec-driver-resume/SKILL.md` 的描述与正文，只额外叠加以下 Codex 运行时差异：

- 命令别名：正文中的 `/spec-driver:spec-driver-resume` 在 Codex 中等价于 `$spec-driver-resume`
- 子代理执行：正文中的 `Task(...)` / `Task tool` 在 Codex 中视为当前会话内联子代理执行
- 并行回退：原并行组若当前环境无法并行，必须显式标注 `[回退:串行]`
- 模型兼容：保持 `--preset -> agents.{agent_id}.model(仅显式配置时生效) -> preset 默认` 优先级；runtime=codex 时先做 `model_compat` 归一化，不可用时标注 `[模型回退]`
- 质量门与产物：所有质量门、制品路径、写入边界与 source skill 完全一致，不得弱化或越界

---


# Spec Driver — 中断恢复

你是 **Spec Driver** 的恢复编排器。你的职责是扫描已有的特性制品文件，确定中断点，并从断点继续执行后续编排阶段。

## 触发方式

```text
$spec-driver-resume
$spec-driver-resume --preset <balanced|quality-first|cost-efficient>
```

**说明**: 此命令无需需求描述参数，自动扫描当前特性目录的已有制品。不接受 `--rerun` 和 `--sync` 参数。如需选择性重跑某个阶段，请使用 `$spec-driver-feature --rerun <phase>`。

---

## 初始化阶段

在进入恢复流程之前，执行以下精简初始化（5 步）：

### 0. 插件路径发现

在执行任何脚本或读取插件文件前，确定插件根目录：

```bash
if [ -f .specify/.spec-driver-path ]; then
  PLUGIN_DIR=$(cat .specify/.spec-driver-path)
else
  PLUGIN_DIR="plugins/spec-driver"
fi
```

后续所有 `$PLUGIN_DIR/` 引用均通过上述路径发现机制解析。

### 1. 项目环境检查

运行 `bash "$PLUGIN_DIR/scripts/init-project.sh" --json`，解析 JSON 输出获取：`NEEDS_CONSTITUTION`（是否需要创建项目宪法）、`NEEDS_CONFIG`（是否需要创建配置文件）、`HAS_SPEC_DRIVER_SKILLS`（是否存在已有 spec-driver skills）、`SKILL_MAP`（已有 skill 列表）。

### 2. Constitution 处理

如果 `NEEDS_CONSTITUTION = true`：暂停，提示用户先运行项目宪法入口创建项目宪法（Claude: `/spec-driver.constitution`；Codex: `$spec-driver-constitution`）。如果 constitution 存在：继续。

### 3. 配置加载

- 如果 `NEEDS_CONFIG = true`：交互式引导用户选择预设（balanced/quality-first/cost-efficient），从 `$PLUGIN_DIR/templates/spec-driver.config-template.yaml` 复制模板到项目根目录，应用选择的预设
- 如果配置已存在：读取并解析 spec-driver.config.yaml
- 如果 `--preset` 参数存在：临时覆盖预设
- 解析 `model_compat` 和 `codex_thinking` 配置（可选）；缺失时使用 run 模式定义的默认跨运行时映射与思考等级映射

### 4. 项目上下文注入（project-context，可选）

- 若项目根目录存在 `.specify/project-context.yaml` 或 `.specify/project-context.md`，在进入后续阶段前读取该文件
- 从该文件中提取“声明且实际存在”的文档与参考路径，生成 `project_context_block`
- 将 `project_context_block` 追加到各阶段运行时上下文注入块
- 若声明路径不存在，输出 `[参考路径缺失] {path}`，不中断流程，并在阶段总结与最终报告中列为风险项
- 若无 project-context 文件，设置 `project_context_block = "未配置"`

### 4.5 在线调研策略解析（project-context 扩展）

为降低“恢复执行时越过在线调研证据门禁”的风险，读取 project-context 后追加在线调研策略解析：

```text
输入: .specify/project-context.yaml/.md 内容（如存在）

1. 是否要求在线调研
   - 若检测到以下任一关键词，设置 online_research_required=true：
     ["perplexity", "sonar-pro-search", "在线调研", "在线搜索"]
   - 否则 online_research_required=false

2. 调研点数量约束
   - online_research_max_points=5（默认）
   - online_research_min_points=0（默认）
   - 若 project-context 明确给出更严格阈值，按项目阈值覆盖

3. 运行时变量
   - online_research_required: bool
   - online_research_min_points: int
   - online_research_max_points: int
```

### 5. Prompt 来源映射

```text
对于 phase ∈ [specify, clarify, checklist, plan, tasks, analyze, implement]:
  if 当前运行时为 Codex 且 .codex/commands/spec-driver.{phase}.md 存在:
    prompt_source[phase] = ".codex/commands/spec-driver.{phase}.md"
  else if 当前运行时为 Claude 且 .claude/commands/spec-driver.{phase}.md 存在:
    prompt_source[phase] = ".claude/commands/spec-driver.{phase}.md"
  else if .codex/commands/spec-driver.{phase}.md 存在:
    prompt_source[phase] = ".codex/commands/spec-driver.{phase}.md"
  else if .claude/commands/spec-driver.{phase}.md 存在:
    prompt_source[phase] = ".claude/commands/spec-driver.{phase}.md"
  else:
    prompt_source[phase] = "$PLUGIN_DIR/agents/{phase}.md"

# 以下阶段始终使用 Plugin 内置版本：
prompt_source[constitution] = "$PLUGIN_DIR/agents/constitution.md"
prompt_source[product-research] = "$PLUGIN_DIR/agents/product-research.md"
prompt_source[tech-research] = "$PLUGIN_DIR/agents/tech-research.md"
prompt_source[verify] = "$PLUGIN_DIR/agents/verify.md"
```

**注意**: resume 不执行"特性目录准备"步骤，因为目录已存在是恢复的前提条件。

---

## 无可恢复制品检查

在执行恢复扫描之前，检查是否存在可恢复的特性目录：

```text
if 当前项目 specs/ 下无任何特性目录（NNN-xxx 格式）:
  输出错误提示:
  """
  [错误] 未找到可恢复的特性目录。

  恢复命令需要一个已有的特性目录（specs/NNN-xxx/），其中包含至少一个编排制品文件。

  建议：
  - 使用 $spec-driver-feature <需求描述> 启动新的研发流程
  """
  终止流程

if 特性目录存在但无任何制品文件:
  输出错误提示:
  """
  [错误] 特性目录 {feature_dir} 中未找到任何编排制品。

  恢复需要至少一个已生成的制品文件（如 spec.md、plan.md 等）。

  建议：
  - 使用 $spec-driver-feature <需求描述> 启动新的研发流程
  """
  终止流程
```

如果存在多个特性目录，提示用户选择要恢复的目录。

---

## 在线调研证据恢复检查（前置硬门禁）

在确定 `feature_dir` 后、恢复点判定前执行：

```text
if online_research_required:
  1. 检查 {feature_dir}/research/online-research.md 是否存在
  2. 若存在，解析 points_count / skip_reason：
     - points_count < online_research_min_points → BLOCKED
     - points_count > online_research_max_points → BLOCKED
     - points_count == 0 且 skip_reason 为空 → BLOCKED
  3. 若文件不存在或校验失败:
     - 记录 [恢复修正] online-research 缺失/无效
     - 强制恢复点不高于 Phase 1d（在线调研补充）
     - 不允许直接进入 Phase 2 及之后阶段
```

---

## 中断恢复机制

扫描 `{feature_dir}` 下的制品文件，从后向前确定恢复点：

```text
verification-report.md 存在    → 流程已完成
tasks.md + 代码变更存在        → 从 verify (Phase 7) 恢复
tasks.md 存在                  → 从 analyze (Phase 5.5) 恢复
plan.md 存在                   → 从 tasks (Phase 5) 恢复
spec.md 存在且有 Clarifications → 从 checklist (Phase 3.5) 恢复
spec.md 存在                   → 从 clarify (Phase 3) 恢复
research-synthesis.md 存在     → 从 specify (Phase 2) 恢复
online-research.md 缺失/无效且 online_research_required=true → 从在线调研补充（Phase 1d）恢复
product/tech-research.md 存在  → 从对应阶段恢复
无制品                         → 从头开始
```

输出恢复信息：

```text
[恢复] 检测到已有制品，从 Phase {N} ({阶段名}) 继续...

已有制品:
  ✅ {已完成的制品列表}
  ⏳ {待生成的制品}
```

---

## 恢复后执行流程

从恢复点继续执行后续阶段（读取已有制品，不重新生成）。恢复后的每个阶段按以下模式执行：(1) 输出进度提示 "[N/10] 正在执行 {阶段中文名}..." → (2) 读取子代理 prompt 文件 → (3) 构建上下文注入块 → (4) 通过 Task tool 委派子代理 → (5) 解析返回 → (6) 检查质量门 → (7) 输出完成摘要。

**上下文注入块模板**（追加到每个子代理 prompt 末尾）：

```markdown
---
## 运行时上下文（由主编排器注入）

**特性目录**: {feature_dir}
**特性分支**: {branch_name}
**前序制品**: {已完成阶段的制品路径列表}
**配置**: {相关配置片段}
**恢复模式**: 从 Phase {N} 恢复
**项目上下文**: {project_context_block}
---
```

各阶段的详细编排逻辑（子代理调用、质量门触发、完成报告）与 `$spec-driver-feature` 一致，请参考 run 技能的工作流定义。

恢复模式下同样必须执行 feature 模式定义的 `GATE_RESEARCH` 在线调研硬门禁，不得因“已有部分制品”跳过。

---

## 模型选择

从 spec-driver.config.yaml 读取模型配置：

```text
1. --preset 命令行参数（临时覆盖，最高优先级）
2. spec-driver.config.yaml 中的 agents.{agent_id}.model（仅当该子代理显式配置时生效）
3. 当前 preset 的默认配置
```

模型名在 Task 调度前按 run 模式的“运行时兼容归一化”执行一次转换：
- `model_compat.runtime` 决定按 `claude` 或 `codex` 映射（`auto` 为默认）
- Codex 下默认把 `opus/sonnet/haiku` 映射到 `gpt-5.4`，并使用 `codex_thinking` 选择思考等级（`medium|high|xhigh`）
- 若映射后模型不可用，回退到 `model_compat.defaults.{runtime}` 并记录 `[模型回退]`

配置文件路径: `$PLUGIN_DIR/templates/spec-driver.config-template.yaml`（模板）或项目根目录 `spec-driver.config.yaml`（用户配置）。
