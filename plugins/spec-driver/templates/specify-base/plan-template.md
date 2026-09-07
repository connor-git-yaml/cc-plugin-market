# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the plan phase of the spec-driver orchestrator (e.g. `/spec-driver:spec-driver-feature`). See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]  
**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]  
**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]  
**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]  
**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]
**Project Type**: [single/web/mobile - determines source structure]  
**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]  
**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]  
**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Codebase Reality Check

> **必选区块**：plan 子代理必须对每个将被修改的目标文件执行 Reality Check。

| 文件路径 | LOC | 方法/函数数 | TODO/FIXME | 超长函数(>200L) | 需前置清理 |
|----------|-----|------------|------------|-----------------|-----------|
| [path]   | [N] | [N]        | [N]        | [Y/N]           | [Y/N]     |

**前置清理 Task**（仅在需要时填写）：
- [ ] `[CLEANUP]` {清理任务描述} — 原因: {触发规则}

## Impact Assessment

> **必选区块**：评估变更的影响半径和风险等级。

| 维度 | 评估 |
|------|------|
| **直接修改文件数** | [N] |
| **间接受影响文件数** | [N]（调用方/依赖方） |
| **跨包影响** | [无 / 涉及 {包列表}] |
| **数据迁移** | [无 / {迁移描述}] |
| **API/契约变更** | [无 / {变更描述}] |
| **风险等级** | [LOW / MEDIUM / HIGH] |

**风险等级判定理由**: [简述判定依据]

**分阶段计划**（仅 HIGH 风险时必填）：
- Phase A: {范围} — 验证点: {验证方法}
- Phase B: {范围} — 验证点: {验证方法}

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

## FR → Phase 覆盖矩阵

> **必选区块**：逐行列出 spec 中的**每一条** FR 及其认领 Phase。spec 有 N 条 FR，本表就必须有 N 行——**不允许抽样、不允许省略未认领行**。分母 N 由重算命令现取（如 `grep -c '^- \*\*FR-0' specs/[###-feature]/spec.md`），命令原文与其输出一并写在本区块内。

**Phase 集合（交叉校验的取值域）** = { 本 plan 实际定义的全部 Phase 名 }，逐个定义见本文件的分 Phase 章节。

| FR | 类别 | 需求项 / 跨切 | 认领 Phase | 实现落点 | 验证点 |
|----|------|--------------|-----------|---------|--------|
| FR-001 | [实现型 / 约束型] | [需求项 N / 跨切] | [A / A,C / — / 移交 F<NNN>] | [文件路径与改动位] | [判据或演示编号] |

**行格式定义（逐条必守）**：

- **「类别」列每行必填，取值二选一**——`实现型` / `约束型`。**类别是后续四条兜底规则（交叉校验 / 裁剪登记强制 / 自动判「未实现」/ 任务不变量）的前置判别**，缺该列时这四条无从分支。**类别列留空、或取值不在这两个值内的行，按「判不出⇒从严」判该矩阵未通过。**
- **约束型行的「认领 Phase」列一律填占位符 `—`**，该占位符**不参与** Phase 集合交叉校验；其判定态走三取值（已核验未违反 / 已违反 / 未核验），不走「认领 / 裁剪」二分。
- **「认领 Phase」列可多值**（一条 FR 可被多个 Phase 同时认领，写作 `A,C`）。**统计覆盖数时按 FR 去重**——被 2 个 Phase 认领的 FR 仍只计 **1 行 / 1 条**，不得重复计数。
- **实现型行的每个 Phase 取值必须 ∈ Phase 集合**。取值不在集合内的行一律判为**失去认领**，与从未被认领同等处理（写一个不存在的 Phase 名不能让某条 FR 显示为已覆盖）。Phase 集合取不到时按校验不成立处理，判该矩阵未通过，**不得因「判不出」而默认放行**。
- **移交项不是裁剪项**。整体移交给后续卡的 FR，「认领 Phase」列填 `移交 F<NNN>`——**移交是未完成态**，不入「裁剪登记」章节。
- **类别归属须在本阶段一次性完成并留痕，不得在 verify 阶段静默改判。** **「不得静默改判」不等于「不得质疑」**：verify **可以**对某行的类别提出异议并单列取值「**类别存疑**」（归入合并律不通过侧），它**不得**做的只是无声地改掉类别列。异议须附「该 FR 是否存在一份**本次要新造或改写的制品**承载它」的判定与产生该判定的命令原文及其原始输出。**把本条写成「不得质疑」会关闭该类别的唯一下游复核位**——`约束型` 是一条免任务 / 免裁剪登记 / 免 `GATE_TASKS` 接受点与 MUST 裁剪预算 / 免自动判「未实现」、却计入实现量口径 (b) 分子的四重免检通道。
- **本区块是冻结对象**：`GATE_TASKS` 时点由编排器对本节规范化内容取哈希。冻结后**禁止对正文无痕改写**；如需修订，在本章节**之外**追加带时间戳的「冻结后修订记录」（写明发现时点 / 发现者 / 原取值 / 新取值）。

**没有正式 FR 列表时的占位口径**：本区块必须输出显式的一行 **「不适用（本次无 FR 列表）」**，并写明判定依据（如上游 spec 不含 `## Functional Requirements` 章节，附判定命令与其原始输出）。**产出仅有表头、无内容却被标记为已完成的形式主义空表，与漏做同等判为不合格。**

**类别判定依据**（本表下方逐条留痕）：约束型的三项测试须同时成立——(1) 规定的是「不得发生某事」或「整体保持某种性质」；(2) 没有任何 Phase 会认领实现它；(3) 也不可能裁剪它。任一不成立即判实现型。**从严方向**：凡「存在一份本次要新造或改写的制品来承载它」的条款，一律判实现型，哪怕其措辞是禁止式。**「本次要新造或改写的制品」的界定**：指本 feature 的 plan / tasks 将创建或修改的**仓库内受 git 跟踪的可交付文件**（代码、配置、模板、prompt、文档等，须能落到具体路径）；**运行时记录不算承载制品**——verify 报告、`[GATE]` 日志行、`.specify/runs/**` 等「执行本流程自然产生的记录」不构成承载，否则任何 FR 都能靠「在 verify 报告里写一句」自指满足。

## 裁剪登记

> **必选区块**：任何**类别为「实现型」**且在覆盖矩阵中标为「未认领」的 FR，必须在本章节出现并写明裁剪理由。**存在未认领且未登记裁剪的实现型 FR 时，本 plan 不得被判定为可进入下一 Phase。**

| # | FR | 强度标注 | 裁剪理由 | 去掉后功能是否仍可实现 | 与 spec 论证是否一致 |
|---|----|---------|---------|---------------------|-------------------|
| 1 | FR-0XX | [MUST / [必须] / SHOULD / [可选]] | [理由] | [是 / 否 + 论证] | [一致 / 改判 + 改判理由] |

- **约束型 FR 禁止进入本章节**——裁剪一条负向约束等于用合规动作解除约束；正确做法是改 spec 并留痕。
- **移交项不进本章节**（移交是未完成态，不是裁剪）。
- **`MUST` / `[必须]` 项的裁剪不是本章节能自行放行的**：本章节只完成「显式声明不做」，**谁批准**由 `GATE_TASKS` 的裁剪接受口径承担——须在该门单列成组并被显式接受，不得与 `[可选]` 项混在同一份清单里一并放行，也不得以「plan 里已写理由」替代显式接受。
- **逐项「必须 / 可选」标注**：须对本 Feature 的全部需求项逐项标注「必须 / 可选」；标注为可选的项默认不实现，且不实现的决定必须落入本章节而非静默省略。
- **本章节的强度上限须诚实登记**：登记解决的是「静默不做」变「显式声明不做」，**不构成**对裁剪合理性的任何背书。

## 关键量反向普查

> **必选区块**：对本次改动涉及的**每一个关键量**（常量、字段名、键名、枚举值、配置项）列出其在全仓的**全部消费点清单**（含文件路径与行号）。

**执行环境声明（可复现性的前置，必写）**：本节命令的输出与执行环境强相关，须在命令之前声明——(1) 所用 `grep` 的**实际实现**（本仓已实测存在 `grep` 被 shell function 覆写为 `ugrep` 的情形，取数命令 `type grep | head -2`）；(2) 该实现是否**遵守 `.gitignore`**（遵守时 `dist/`、`node_modules/` 等路径自动缺席）；(3) 输出路径**是否带 `./` 前缀**（不带时，任何 `| grep -v "^./<dir>"` 形式的排除管道是**空转**）。**跨环境复跑出现计数差异时，先核对 grep 实现，再判为漂移。**

| # | 关键量 | 本次处置 | 消费点：命中行 | 消费点：文件 | 认领 FR |
|---|-------|---------|--------------|-------------|--------|
| K1 | [常量 / 字段名 / 键名 / 枚举值 / 配置项] | [改 / 不改] | [N] | [N] | [FR-0XX] |

**逐条普查（每条一小节，三项缺一不可）**：

1. **可复现检索命令原样写入**——命令**原文**（不是命令的描述、不是重构后的等价写法）写进产物，使审阅者无需重构即可复跑。
2. **原始输出**——附该命令的**原始输出（逐行在场）**——**不得以计数替代原始输出**：清单条数、声明条数与原始输出行数须三向相等。
3. **消费点清单条数 == 声明条数 == 该行检索命令的实际输出计数（三向相等）**——**任一不符时必须报出不符并阻止进入实现阶段**（只比「声明数 == 实测数」对「清单被删一行而数字未动」恒真）。该一致性校验是本产物具备捕获力的判据，缺失即视为该产物为摆设。

**计数单位必须分列、不得相加**：命中行（`grep -n` 的输出行数）/ 文件（`grep -l` 的去重文件数）/ 取值出现处（`grep -o`，一行可含多个取值）是三个单位。总换算式须逐项写出并独立复算——**换算式在场并不自动保证算对**。

**本普查的能力边界（必写，不得被总括为「已解决」）**：上述一致性校验的判据输入**按定义就是执行者自己申报的集合**，因此它**覆盖不了「该申报的关键量是否都申报了」**——未申报项不进入校验，陈述恒真。凡把本章节口径为「关键量漏盘问题已解决」即为 over-claim。

**本次不涉及任何关键量时的占位口径**：本区块必须输出显式的一行 **「不适用（本次无关键量变更）」**，并附产生该判定的命令与其原始输出。**不得留空、不得填写形式主义空表**——仅有表头、无内容却被标记为已完成的空表，与漏做同等判为不合格。

## 推断前提登记

> **必选区块**：把本 plan 中一切**未实测的断言**显式登记为推断前提，并为每条给出可证伪的运行时口径命令。

**标记契约**：复用仓库宪法既定的 **`[推断]` / `[INFERRED]`** 两个标记，**不另造标记体系**。取数方法为全文检索该标记后**按命题去重**（不是按标记出现次数），命令原文与原始输出写入本区块；同一命题在多处出现只计 1 条。

**三类划分（分母口径，两个单位分列）**：

| 桶 | 判定 | 是否计入实证分母 |
|----|------|----------------|
| `[推断]` | 可证伪，且有与陈述**同一命题**的运行时口径命令 | **计入** |
| 能力边界声明 | 逻辑上恒真、或不描述被检系统的运行时行为（含「若走某条已被否决的路线会如何」这类反事实条件句） | **不计入** |
| 已核实 | 已附命令**与其原始输出片段** | **不计入** |

### 一、`[推断]`（计入分母）

| # | 陈述 | 推断理由（为何未实测） | 与陈述**同一命题**的证实 / 证伪命令 | 若被证伪的影响 |
|---|------|---------------------|--------------------------------|-------------|
| P-1 | `[推断]` [断言] | [为何此刻无法实测] | [命令 + 判据阈值 + 计数单位] | [对本 plan 的影响面] |

- **命令必须与陈述同一命题**——用相邻命题的命令背书（如用「文件存在」证明「实现正确」）一律退回。
- **编号不重排**：条目移出本桶时保留编号占位并写明去向，避免后续制品引用断链。

### 二、能力边界声明（不计入分母）

| # | 声明 | 为何不作为推断前提（恒真 / 不描述运行时行为） | 已有的实证支持（不改变其恒真性） |
|---|------|------------------------------------------|------------------------------|
| B-1 | [声明] | [理由] | [留痕位置] |

### 三、已核实（不计入分母）

> **进桶门槛**：只写复核命令而**无原始输出片段**者，一律退回 `[推断]` 并计入分母。**「已核实」不是自助豁免桶。**

| # | 原为推断的陈述 | 核实命令（原文） | **原始输出片段** | 结论 |
|---|--------------|---------------|---------------|------|
| V-1 | [陈述] | [命令原文] | [原始输出，不是命令名、不是结论转述] | [证实 / 证伪] |

### 四、回填分工声明

本章节各条的**实证结论由 verify 阶段逐条实跑给出**，但 verify **只在 `verification-report` 中输出 PASS / FAIL**，**不回填** `spec.md` / `plan.md`；确需回填时由编排器或 implement 侧完成。

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (plan phase output)
├── research.md          # Phase 0 output (plan phase)
├── data-model.md        # Phase 1 output (plan phase)
├── quickstart.md        # Phase 1 output (plan phase)
├── contracts/           # Phase 1 output (plan phase)
└── tasks.md             # Phase 2 output (tasks phase — NOT created by plan phase)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
