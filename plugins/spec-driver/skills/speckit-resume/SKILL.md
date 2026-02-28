---
name: speckit-resume
description: "恢复中断的 Speckit 研发流程 — 扫描已有制品并从断点继续编排"
disable-model-invocation: true
---

# Spec Driver — 中断恢复

你是 **Spec Driver** 的恢复编排器。你的职责是扫描已有的特性制品文件，确定中断点，并从断点继续执行后续编排阶段。

## 触发方式

```text
/spec-driver:speckit-resume
/spec-driver:speckit-resume --preset <balanced|quality-first|cost-efficient>
```

**说明**: 此命令无需需求描述参数，自动扫描当前特性目录的已有制品。不接受 `--rerun` 和 `--sync` 参数。如需选择性重跑某个阶段，请使用 `/spec-driver:speckit-feature --rerun <phase>`。

---

## 初始化阶段

在进入恢复流程之前，执行以下精简初始化（4 步）：

### 1. 项目环境检查

运行 `bash plugins/spec-driver/scripts/init-project.sh --json`，解析 JSON 输出获取：`NEEDS_CONSTITUTION`（是否需要创建项目宪法）、`NEEDS_CONFIG`（是否需要创建配置文件）、`HAS_SPECKIT_SKILLS`（是否存在已有 speckit skills）、`SKILL_MAP`（已有 skill 列表）。

### 2. Constitution 处理

如果 `NEEDS_CONSTITUTION = true`：暂停，提示用户先运行 `/speckit.constitution` 创建项目宪法。如果 constitution 存在：继续。

### 3. 配置加载

- 如果 `NEEDS_CONFIG = true`：交互式引导用户选择预设（balanced/quality-first/cost-efficient），从 `plugins/spec-driver/templates/driver-config-template.yaml` 复制模板到项目根目录，应用选择的预设
- 如果配置已存在：读取并解析 driver-config.yaml
- 如果 `--preset` 参数存在：临时覆盖预设
- 解析 `model_compat` 配置（可选）；缺失时使用 run 模式定义的默认跨运行时映射

### 4. Prompt 来源映射

```text
对于 phase ∈ [specify, clarify, checklist, plan, tasks, analyze, implement]:
  if .claude/commands/speckit.{phase}.md 存在:
    prompt_source[phase] = ".claude/commands/speckit.{phase}.md"
  else:
    prompt_source[phase] = "plugins/spec-driver/agents/{phase}.md"

# 以下阶段始终使用 Plugin 内置版本：
prompt_source[constitution] = "plugins/spec-driver/agents/constitution.md"
prompt_source[product-research] = "plugins/spec-driver/agents/product-research.md"
prompt_source[tech-research] = "plugins/spec-driver/agents/tech-research.md"
prompt_source[verify] = "plugins/spec-driver/agents/verify.md"
```

**注意**: resume 不执行"特性目录准备"步骤（步骤 5），因为目录已存在是恢复的前提条件。

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
  - 使用 /spec-driver:speckit-feature <需求描述> 启动新的研发流程
  """
  终止流程

if 特性目录存在但无任何制品文件:
  输出错误提示:
  """
  [错误] 特性目录 {feature_dir} 中未找到任何编排制品。

  恢复需要至少一个已生成的制品文件（如 spec.md、plan.md 等）。

  建议：
  - 使用 /spec-driver:speckit-feature <需求描述> 启动新的研发流程
  """
  终止流程
```

如果存在多个特性目录，提示用户选择要恢复的目录。

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
---
```

各阶段的详细编排逻辑（子代理调用、质量门触发、完成报告）与 `/spec-driver:speckit-feature` 一致，请参考 run 技能的工作流定义。

---

## 模型选择

从 driver-config.yaml 读取模型配置：

```text
1. --preset 命令行参数（临时覆盖，最高优先级）
2. driver-config.yaml 中的 agents.{agent_id}.model（用户自定义）
3. 当前 preset 的默认配置
```

模型名在 Task 调度前按 run 模式的“运行时兼容归一化”执行一次转换：
- `model_compat.runtime` 决定按 `claude` 或 `codex` 映射（`auto` 为默认）
- Codex 下允许直接使用 `gpt-5/o3/...`，也支持把 `opus/sonnet` 自动映射为 Codex 模型
- 若映射后模型不可用，回退到 `model_compat.defaults.{runtime}` 并记录 `[模型回退]`

配置文件路径: `plugins/spec-driver/templates/driver-config-template.yaml`（模板）或项目根目录 `driver-config.yaml`（用户配置）。
