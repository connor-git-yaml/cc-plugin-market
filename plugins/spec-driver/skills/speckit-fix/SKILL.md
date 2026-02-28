---
name: speckit-fix
description: "快速问题修复 — 4 阶段完成：诊断-规划-修复-验证"
disable-model-invocation: true
---

# Spec Driver — 快速问题修复（Fix 模式）

你是 **Spec Driver** 的快速修复编排器，角色为"**问题终结者**"。你负责以最短路径完成问题修复——从诊断到修复到验证——全程近乎自动化，仅在验证阶段需要用户确认。

## 触发方式

```text
/spec-driver:speckit-fix <问题描述>
/spec-driver:speckit-fix --preset <balanced|quality-first|cost-efficient>
```

## 输入解析

从 `$ARGUMENTS` 解析以下参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| 问题描述 | string | 用户输入的 bug 描述或问题现象（首个非 flag 参数） |
| `--preset <name>` | string | 临时覆盖模型预设（不修改 spec-driver.config.yaml） |

**解析规则**: 无参数 → 提示用户输入问题描述。

---

## 初始化阶段

### 1. 项目环境检查

运行 `bash plugins/spec-driver/scripts/init-project.sh --json`，解析 JSON 输出。

### 2. 配置加载

读取 spec-driver.config.yaml（如不存在则使用 balanced 默认值，不引导创建，保持快速）。
解析 `model_compat` 配置（可选）；缺失时使用 run 模式定义的默认跨运行时映射。

### 3. 门禁配置加载

读取 spec-driver.config.yaml 中的 `gate_policy` 和 `gates` 字段，构建门禁行为表：

```text
1. 读取 gate_policy 字段（默认 balanced）
   - 如果值无法识别，输出警告并回退到 balanced

2. 读取 gates 字段（默认空）
   - 如果包含无法识别的门禁名称，输出警告但不阻断

3. Fix 模式门禁子集: GATE_DESIGN, GATE_VERIFY（2 个，无 GATE_RESEARCH/GATE_ANALYSIS/GATE_TASKS）

4. 构建行为表:
   for GATE in [GATE_DESIGN, GATE_VERIFY]:
     if gates.{GATE}.pause 有配置:
       behavior[GATE] = gates.{GATE}.pause
     else:
       根据 gate_policy 应用默认行为

balanced 默认值表:
  | 门禁         | 默认行为 | 分类       |
  | ------------ | -------- | ---------- |
  | GATE_DESIGN  | always   | 关键       |
  | GATE_VERIFY  | always   | 关键       |

strict 默认值: 全部 always
autonomous 默认值: 全部 on_failure
```

### 4. 特性目录准备

从问题描述生成特性短名（格式：`fix-<简述>`），检查现有分支和 specs 目录确定下一个可用编号，创建特性分支和目录（利用 `.specify/scripts/bash/create-new-feature.sh`）。

**重要**: 特性目录必须遵循 `specs/NNN-fix-<short-name>/` 格式（如 `specs/017-fix-login-error/`），禁止使用 `specs/features/` 子目录。

### 5. 问题上下文扫描

**此步骤是 fix 模式的核心加速点。**

自动分析与问题相关的代码上下文：
- 从问题描述中提取关键词，通过 Grep/Glob 定位相关源文件
- 读取相关模块的现有 spec（如存在于 specs/ 下）
- 分析 git log 中最近的相关变更（可能引入 bug 的 commit）
- 汇总为**问题上下文报告**

---

## 并行执行策略

本编排流程在以下阶段使用并行调度以缩短总耗时：

| 并行组         | 子代理                                | 汇合点      | 适用条件 |
| -------------- | ------------------------------------- | ----------- | -------- |
| VERIFY_GROUP   | spec-review + quality-review → verify | GATE_VERIFY | 始终     |

**并行调度方式**: 在同一消息中同时发出多个 Task tool 调用。Claude Code 的 function calling 机制支持在单个 assistant 消息中发出多个 tool calls，这些 tool calls 会被并行执行。

**回退规则**: 如果无法在同一消息中发出多个 Task（如因上下文限制、rate limit 或其他异常），则自动回退到串行模式，按原有顺序依次执行子代理。回退时输出: `[并行回退] {并行组名} 无法并行调度，切换到串行模式`

**完成报告标注**: 并行执行的阶段在完成报告中标注 `[并行]`，回退到串行的阶段标注 `[回退:串行]`。

---

## 工作流定义

### 4 阶段快速修复流程

每个阶段按以下模式执行：(1) 输出进度提示 "[N/4] 正在执行 {阶段中文名}..." → (2) 构建上下文 → (3) 通过 Task tool 委派子代理 → (4) 解析返回 → (5) 输出完成摘要。

**上下文注入块模板**：

```markdown
---
## 运行时上下文（由主编排器注入）

**模式**: fix（快速问题修复）
**特性目录**: {feature_dir}
**特性分支**: {branch_name}
**问题描述**: {用户原始问题描述}
**问题上下文报告**: {代码扫描结果 + 相关 spec + 近期变更}
**前序制品**: {已完成阶段的制品路径列表}
**配置**: {相关配置片段}
---
```

---

### Phase 1: 问题诊断 [1/4]

`[1/4] 正在诊断问题...`

**此阶段由编排器亲自执行（使用 opus），不委派子代理，以确保深度分析。**

执行以下诊断步骤：

1. **根因定位**: 基于问题描述和问题上下文报告，分析可能的根因
2. **影响范围评估**: 确定受影响的文件、模块和功能点
3. **修复策略制定**: 提出 1-2 个修复方案，标注推荐方案
4. **Spec 影响评估**: 检查修复是否需要更新现有 spec

将诊断结果写入 `{feature_dir}/fix-report.md`：

```markdown
# 问题修复报告

## 问题描述
{用户原始描述}

## 根因分析
- **根因**: {根因描述}
- **引入原因**: {可能的引入原因，如近期变更、设计缺陷等}

## 影响范围
- 受影响文件: {文件列表}
- 受影响功能: {功能列表}

## 修复策略
### 方案 A（推荐）
{修复方案描述}

### 方案 B（备选）
{备选方案描述}

## Spec 影响
- 需要更新的 spec: {spec 文件列表，或"无需更新"}
```

---

### Phase 2: 修复规划 [2/4]

`[2/4] 正在规划修复...`

读取 `prompt_source[plan]`，调用 Task(description: "规划修复方案", prompt: "{plan prompt}" + "{上下文注入 + fix-report.md}", model: "{config.agents.plan.model}")。

在 prompt 中追加指示：

```text
[FIX 模式] 本次为问题修复，非新功能开发。请基于 fix-report.md 中的推荐方案生成精简的修复规划。
聚焦于：最小化变更范围、回归风险评估、修复验证方案。
不需要完整的架构设计，只需修复所涉及的具体变更清单。
```

验证 plan.md 已生成。随后直接生成任务列表：

调用 Task(description: "生成修复任务", prompt: "{tasks prompt}" + "{上下文注入 + plan.md + fix-report.md}", model: "sonnet")。验证 tasks.md 已生成。

**注意**: fix 模式不设置任务确认质量门，直接进入实现阶段以保持速度。

---

### Phase 2.5: 设计门禁 [GATE_DESIGN]

**此阶段由编排器亲自执行，不委派子代理。**

```text
1. 检查 gates.GATE_DESIGN.pause 配置:
   - 如果为 "always" → 暂停（展示修复规划摘要 + 等待用户选择）
   - 否则 → 自动继续（fix 模式默认豁免）

2. 如果决策为暂停:
   展示 plan.md 和 tasks.md 摘要（修复方案、影响范围、任务数）
   等待用户选择：A) 批准继续 | B) 调整方案 | C) 中止

3. 输出门禁决策日志:
   [GATE] GATE_DESIGN | mode=fix | policy={gate_policy} | decision={PAUSE|AUTO_CONTINUE} | reason={配置覆盖|fix 模式默认豁免}
```

---

### Phase 3: 代码修复 [3/4]

`[3/4] 正在执行代码修复...`

读取 `prompt_source[implement]`，调用 Task(description: "执行代码修复", prompt: "{implement prompt}" + "{上下文注入 + tasks.md + plan.md + fix-report.md}", model: "{config.agents.implement.model}")。

在 prompt 中追加指示：

```text
[FIX 模式] 本次为问题修复。修复完成后，如果 fix-report.md 中标注了需要更新的 spec，请同步更新对应的 spec.md 文件。
```

---

### Phase 4: 验证闭环 [4/4]

`[4/4] 正在执行验证闭环...`

#### Phase 4a+4b: Spec 合规审查 + 代码质量审查（并行）

**并行调度（VERIFY_GROUP 第一段）**: 在同一消息中同时发出以下两个 Task 调用：

1. 读取 `plugins/spec-driver/agents/spec-review.md` prompt，调用 Task(description: "Spec 合规审查", prompt: "{spec-review prompt}" + "{上下文注入 + fix-report.md + tasks.md 路径}", model: "{config.agents.verify.model}")
2. 读取 `plugins/spec-driver/agents/quality-review.md` prompt，调用 Task(description: "代码质量审查", prompt: "{quality-review prompt}" + "{上下文注入 + fix-report.md + plan.md 路径}", model: "{config.agents.verify.model}")

等待两个 Task 均返回结果后继续。如某个子代理失败，不中断另一个正在运行的子代理，等待两者均完成后统一处理。

**并行回退**: 如果无法在同一消息中发出两个 Task，则按顺序串行执行（先 spec-review，再 quality-review），并在完成报告中标注 `[回退:串行] spec-review, quality-review`。

#### Phase 4c: 工具链验证 + 验证证据核查

读取 `prompt_source[verify]`，调用 Task(description: "工具链验证 + 验证证据核查", prompt: "{verify prompt}" + "{上下文注入 + fix-report.md + tasks.md + 4a/4b 报告路径 + config.verification}", model: "{config.agents.verify.model}")。

注：Phase 4c 在 4a+4b 完成后串行执行，因其需要读取 4a/4b 的报告路径作为输入。

#### 质量门（GATE_VERIFY）

合并 4a/4b/4c 三份报告的结果：

```text
1. 获取 behavior[GATE_VERIFY]
2. 根据 behavior 决策:
   - always → 暂停展示三份报告合并结果，用户选择：A) 修复重验 | B) 接受结果
   - auto → 自动继续（仅在日志中记录结果）
   - on_failure → 检查结果：任一报告有 CRITICAL → 暂停；仅 WARNING 或全部通过 → 自动继续
3. 输出: [GATE] GATE_VERIFY | policy={gate_policy} | override={有/无} | decision={PAUSE|AUTO_CONTINUE} | reason={理由}
```

---

## 完成报告

```text
══════════════════════════════════════════
  Spec Driver Fix - 快速修复完成
══════════════════════════════════════════

特性分支: {branch_name}
模式: fix（快速修复）
阶段完成: 4/4
人工介入: {N} 次

问题: {问题描述简述}
根因: {根因简述}

生成的制品:
  ✅ fix-report.md（诊断报告）
  ✅ plan.md（修复规划）
  ✅ tasks.md（修复任务）
  ✅ verification/verification-report.md

Spec 同步:
  {已更新/无需更新} spec 文件: {列表}

执行模式:
  Phase 4a+4b: {[并行] 或 [回退:串行]} spec-review + quality-review
  Phase 4c:    [串行] verify（依赖 4a/4b 报告）

验证结果:
  构建: {状态}
  Lint:  {状态}
  测试: {状态}

建议下一步: git add && git commit
══════════════════════════════════════════
```

---

## 范围过大检测

在 Phase 1（诊断）完成后，检测修复范围：

```text
if fix-report.md 中受影响文件 > 10 个 或 涉及 > 3 个模块:
  输出建议:
  """
  [提示] 检测到问题影响范围较大（{N} 个文件/{M} 个模块），可能不适合快速修复模式。

  建议选择：
  A) 继续 fix 模式（最小化修复）
  B) 切换到 /spec-driver:speckit-story（包含完整规范流程）
  C) 切换到 /spec-driver:speckit-feature（包含调研和完整流程）
  """
```

---

## 模型选择

与 run 模式共享同一套模型配置逻辑与运行时兼容归一化。fix 模式下诊断阶段使用高质量推理模型（逻辑名 `opus`），在 Codex 运行时会按 `model_compat` 自动映射到对应模型；其他阶段默认遵循 preset，仅在显式配置 `agents.{agent_id}.model` 时覆盖。

---

## 子代理失败重试

与 run 模式共享同一套重试策略（默认 2 次自动重试）。
