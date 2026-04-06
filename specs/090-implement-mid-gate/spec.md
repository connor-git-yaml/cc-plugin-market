---
feature: 090-implement-mid-gate
title: 实现中期门禁
status: Draft
created: 2026-04-06
research_mode: tech-only
---

# Feature Specification: 实现中期门禁（GATE_IMPLEMENT_MID）

**Feature Branch**: `feature/090-implement-mid-gate`
**Created**: 2026-04-06
**Status**: Draft

## 概述

在 `spec-driver-implement` 编排器的 Phase 4（Implementation）中，在完成 50%（向下取整）任务后插入 GATE_IMPLEMENT_MID 轻量级检查点，检测架构劣化信号和前置假设有效性。小型 Feature（<=5 tasks）自动跳过该门禁。

**问题背景**：implement 完成全部任务后才进入 Phase 5 验证闭环，大型 Feature（>10 tasks）中如果在 50% 时已经偏离架构方向或推翻了 tasks.md 的前置假设，完成全部任务后再发现的修复成本远高于中途拦截。OctoAgent 实战中多次出现"完成后才发现底层 API 不支持预期行为"的情况。

**技术调研支撑**：业界 CI/CD 平台（Jenkins input step、GitLab `when: manual`）验证了"执行中途暂停检查"是成熟工程模式；主流 AI 编码工具（Cursor、Copilot Workspace、Devin）均无"自动中途质量评估"功能，GATE_IMPLEMENT_MID 是差异化能力。

---

## User Scenarios & Testing

### User Story 1 - 大型 Feature 中途拦截架构偏移（P0）

**作为** spec-driver-implement 的使用者，
**我希望** 在 implement 完成 50% 任务后，编排器自动检查已完成代码是否引入架构劣化信号、tasks.md 的前置假设是否仍然成立，
**以便于** 在偏离过深之前及时发现和修正，降低全部完成后才发现问题的修复成本。

**Given-When-Then 验收场景**：

```
Scenario 1.1: 正常触发门禁检查
  Given tasks.md 包含 12 个 task（>5 阈值）
    And 编排器已完成 6 个 task（50% 向下取整 = 6）
  When GATE_IMPLEMENT_MID 触发
  Then 编排器执行轻量级检查（架构劣化信号 + 前置假设验证）
    And 根据 gate behavior 决定 PAUSE 或 AUTO_CONTINUE
    And 输出 [GATE] GATE_IMPLEMENT_MID 日志行

Scenario 1.2: 门禁检查发现 CRITICAL 问题
  Given GATE_IMPLEMENT_MID 触发
    And 检查发现已完成任务引入了与 plan.md 不一致的模块结构
  When gate behavior 为 on_failure
  Then 编排器暂停并展示问题摘要
    And 用户选择：A) 修复后继续 | B) 强制继续 | C) 中止
```

### User Story 2 - 小型 Feature 自动跳过门禁（P0）

**作为** 小型 fix/feature 的开发者，
**我希望** 当 tasks.md 中的任务数 <=5 时，GATE_IMPLEMENT_MID 自动跳过，不打断实施流程，
**以便于** 小变更保持高效，不被不必要的流程负担拖慢。

**Given-When-Then 验收场景**：

```
Scenario 2.1: 小型 Feature 跳过门禁
  Given tasks.md 包含 4 个 task（<=5 阈值）
  When 编排器进入 Phase 4
  Then 直接执行完整 Phase 4，不拆分为 4a/GATE/4b
    And 输出 [GATE] GATE_IMPLEMENT_MID | SKIPPED | reason=task_count<=5

Scenario 2.2: 恰好 5 个 task 仍跳过
  Given tasks.md 包含 5 个 task（==5 阈值）
  When 编排器进入 Phase 4
  Then 跳过 GATE_IMPLEMENT_MID
    And 输出 [GATE] GATE_IMPLEMENT_MID | SKIPPED | reason=task_count<=5

Scenario 2.3: 恰好 6 个 task 触发门禁
  Given tasks.md 包含 6 个 task（>5 阈值）
  When 编排器完成第 3 个 task（floor(6*0.5)=3）
  Then 触发 GATE_IMPLEMENT_MID 检查
```

### User Story 3 - 门禁行为可配置（P1）

**作为** 项目维护者，
**我希望** 通过 spec-driver.config.yaml 的 `gates.GATE_IMPLEMENT_MID.pause` 配置项独立控制门禁行为（always/auto/on_failure），
**以便于** 根据项目阶段和团队偏好灵活调整中期门禁的严格程度。

**Given-When-Then 验收场景**：

```
Scenario 3.1: 显式配置覆盖默认值
  Given spec-driver.config.yaml 中配置 gates.GATE_IMPLEMENT_MID.pause: always
    And gate_policy 为 balanced（默认 on_failure）
  When GATE_IMPLEMENT_MID 触发
  Then 编排器使用 always 行为（强制暂停），而非默认 auto
    And 输出 [GATE] GATE_IMPLEMENT_MID | override=有

Scenario 3.2: 无显式配置时使用策略默认值
  Given spec-driver.config.yaml 中未配置 gates.GATE_IMPLEMENT_MID
    And gate_policy 为 balanced
  When GATE_IMPLEMENT_MID 触发
  Then 编排器使用 balanced 默认行为 on_failure
    And 输出 [GATE] GATE_IMPLEMENT_MID | override=无
```

---

## Requirements

### Functional Requirements

#### MUST

**FR-001**: 在 `spec-driver-implement/SKILL.md` 的 Phase 4 中，当 tasks.md 任务总数 >5 时，将现有单次 implement 子代理调用拆分为三段结构：Phase 4a（前半段实施）→ GATE_IMPLEMENT_MID（中期门禁）→ Phase 4b（后半段实施）。

**FR-002**: GATE_IMPLEMENT_MID 的触发时机为 tasks.md 中的 top-level task 完成数达到总数的 50%（向下取整，即 `floor(total_tasks * 0.5)`）。

**FR-003**: GATE_IMPLEMENT_MID 的检查内容包含两项轻量级信号检测：
  - **(a) 架构劣化信号**：已完成任务的变更文件列表是否偏离 plan.md 的预期范围（如出现未在 plan 中提及的核心模块改动）。
  - **(b) 前置假设验证**：tasks.md 中声明的前置条件和依赖假设是否在实际代码中仍然成立（如 API 是否存在、文件路径是否有效、依赖模块是否如预期暴露接口）。

**FR-004**: 当 tasks.md 中的 top-level task 总数 <=5 时，GATE_IMPLEMENT_MID 自动跳过，编排器直接执行完整 Phase 4 不拆分。跳过时输出日志 `[GATE] GATE_IMPLEMENT_MID | SKIPPED | reason=task_count<=5`。

**FR-005**: 在 `spec-driver.config.yaml` 的 `gates` 字段中支持 `GATE_IMPLEMENT_MID.pause` 配置项，取值范围与现有门禁一致：`always | auto | on_failure`。

**FR-006**: GATE_IMPLEMENT_MID 的行为遵循现有门禁行为表构建逻辑：
  - 若 `gates.GATE_IMPLEMENT_MID.pause` 有显式配置，使用该值
  - 否则根据 `gate_policy` 应用默认行为：
    - `balanced`: `on_failure`（发现问题才暂停，无问题自动继续）
    - `strict`: `always`（强制暂停，等待用户确认）
    - `autonomous`: `on_failure`（仅发现问题时暂停）

**FR-007**: 在 `spec-driver-implement/SKILL.md` 的门禁配置加载（初始化阶段 Step 4）中，将 GATE_IMPLEMENT_MID 加入 Implement 模式门禁子集。

**FR-008**: 在 `spec-driver-feature/SKILL.md` 的门禁配置加载（初始化阶段 Step 4）中，将 GATE_IMPLEMENT_MID 加入 Feature 模式门禁子集和行为表。

**FR-009**: GATE_IMPLEMENT_MID 由编排器亲自执行（不委派子代理），与 GATE_TASKS / GATE_VERIFY 的执行模式一致。

#### SHOULD

**FR-010**: Phase 4a 的 implement 子代理 prompt 中应追加指令，明确告知"执行 tasks.md 中前 N 个任务后返回中间进度报告"（N = `floor(total_tasks * 0.5)`），并要求报告已变更的文件列表。

**FR-011**: Phase 4b 的 implement 子代理 prompt 中应注入 Phase 4a 的执行摘要（已完成的 task ID 列表、变更文件列表），确保上下文连续性。

**FR-012**: GATE_IMPLEMENT_MID 的输出格式应与现有门禁日志一致：`[GATE] GATE_IMPLEMENT_MID | policy={gate_policy} | override={有/无} | decision={PAUSE|AUTO_CONTINUE|SKIPPED} | reason={理由}`。

**FR-013**: 在 `spec-driver.config.yaml` 的注释中增加 GATE_IMPLEMENT_MID 的示例配置项（保持注释状态，与现有 `gates` 注释块风格一致）。

#### MAY

**FR-014**: 门禁检查结果可写入 `specs/{feature}/trace.md`（若 trace 机制已存在），便于事后审计。

**FR-015**: 未来可将 50% 触发阈值改为可配置（如 `gates.GATE_IMPLEMENT_MID.threshold: 0.5`），但当前版本硬编码 50% 以符合 YAGNI 原则。

---

### Key Entities

| 实体 | 位置 | 职责 |
|------|------|------|
| `GATE_IMPLEMENT_MID` | `spec-driver-implement/SKILL.md` Phase 4 | 中期门禁检查点，编排器亲自执行 |
| `gates.GATE_IMPLEMENT_MID.pause` | `spec-driver.config.yaml` | 门禁行为配置（always/auto/on_failure） |
| Phase 4a | `spec-driver-implement/SKILL.md` | 前半段实施（执行前 50% 任务） |
| Phase 4b | `spec-driver-implement/SKILL.md` | 后半段实施（执行剩余任务） |
| top-level task count | 运行时计算 | 从 tasks.md 中用 `[x]` / `[ ]` 正则匹配 top-level checkbox 行计数 |

---

### Non-Functional Requirements

**NFR-001 向后兼容**：所有变更为追加型。未配置 `gates.GATE_IMPLEMENT_MID` 且 gate_policy 为 `balanced` 时，行为为 `on_failure`（仅发现问题才暂停），无问题时自动继续，与升级前的 Phase 4 一次性执行体验无实质差异。

**NFR-002 文件隔离**：仅修改以下 3 个文件，不触碰其他 SKILL.md、agent prompt 或脚本：
  - `plugins/spec-driver/skills/spec-driver-implement/SKILL.md`
  - `plugins/spec-driver/skills/spec-driver-feature/SKILL.md`
  - `spec-driver.config.yaml`

**NFR-003 YAGNI 约束**：不引入新的配置 Schema 文件、运行时脚本或 npm 依赖。检查逻辑内联在 SKILL.md 的伪代码块中，与现有门禁实现方式一致。

**NFR-004 检查轻量性**：GATE_IMPLEMENT_MID 检查内容严格限制为两项信号扫描（架构劣化 + 假设验证），不做全量代码分析、性能评估或安全扫描——这些是 Phase 5 Verification 的职责。

---

## Success Criteria

**SC-001**: `plugins/spec-driver/skills/spec-driver-implement/SKILL.md` 包含 Phase 4a / GATE_IMPLEMENT_MID / Phase 4b 三段结构，且门禁由编排器亲自执行。

**SC-002**: `spec-driver.config.yaml` 的 `gates` 注释块中包含 `GATE_IMPLEMENT_MID` 配置示例。

**SC-003**: `plugins/spec-driver/skills/spec-driver-implement/SKILL.md` 的门禁配置加载（Step 4）中，Implement 模式门禁子集包含 GATE_IMPLEMENT_MID，行为表包含 balanced/strict/autonomous 三策略默认值。

**SC-004**: `plugins/spec-driver/skills/spec-driver-feature/SKILL.md` 的门禁配置加载（Step 4）中，Feature 模式门禁子集包含 GATE_IMPLEMENT_MID，行为表包含三策略默认值。

**SC-005**: GATE_IMPLEMENT_MID 包含 <=5 tasks 自动跳过逻辑，输出 `SKIPPED` 日志。

**SC-006**: `npm run repo:check` 全部 pass。

---

### Edge Cases

**EC-001 tasks.md 无法解析**：若 tasks.md 中无法通过 `[ ]` / `[x]` 正则匹配提取 top-level task 列表（格式异常或为空），则跳过 GATE_IMPLEMENT_MID 并输出 `[GATE] GATE_IMPLEMENT_MID | SKIPPED | reason=tasks_unparseable`。不阻断流程。

**EC-002 门禁配置缺失**：若 `spec-driver.config.yaml` 中无 `gates` 字段或无 `GATE_IMPLEMENT_MID` 条目，按 `gate_policy` 的默认值执行。若 `gate_policy` 也缺失，回退到 `balanced`（即 `auto`）。

**EC-003 50% 精确计算**：
  - 奇数任务数（如 7）：`floor(7 * 0.5) = 3`，完成第 3 个 task 后触发
  - 偶数任务数（如 10）：`floor(10 * 0.5) = 5`，完成第 5 个 task 后触发
  - 恰好 6 个 task：`floor(6 * 0.5) = 3`，完成第 3 个 task 后触发

**EC-004 边界任务数**：
  - 0 个 task：直接跳过 Phase 4（无需实施），GATE_IMPLEMENT_MID 不触发
  - 1 个 task：<=5 阈值，跳过门禁
  - 5 个 task：<=5 阈值，跳过门禁
  - 6 个 task：>5 阈值，触发门禁（在完成第 3 个 task 后）

**EC-005 tasks.md 含嵌套子任务**：仅计算 top-level task 行（Markdown 缩进层级 0 或 Phase 标题下第一级 checkbox），嵌套子任务不计入总数。

**EC-006 部分 task 已在先前 run 中完成**：无论 tasks.md 中已有多少 `[x]` 标记，编排器始终基于 tasks.md 中的**全量 top-level task 数**决定 <=5 跳过判断和 50% 触发点。分母 = 全量 task 数，不做已完成状态过滤。这确保计算逻辑简单确定（符合 YAGNI），也与 <=5 跳过阈值的语义一致——"这个 Feature 本身就很小"。

**EC-007 gate_policy 为无法识别的值**：按现有逻辑输出警告并回退到 `balanced`，GATE_IMPLEMENT_MID 使用 `auto` 默认行为。

**EC-008 implement 子代理 4a 失败**：若 Phase 4a 的子代理调用失败（返回错误或超时），不进入 GATE_IMPLEMENT_MID，直接标记 Phase 4 为 FAILED 并进入错误处理流程。
