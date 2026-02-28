# Feature Specification: Speckit Driver Pro

**Feature Branch**: `011-speckit-driver-pro`
**Created**: 2026-02-15
**Updated**: 2026-02-15
**Status**: Draft
**Input**: 设计并开发 Speckit Driver Pro — 一个自治研发编排器 Claude Code Plugin
**Plugin Name**: `speckitdriver`（命令格式：`/speckitdriver:run`、`/speckitdriver:story`、`/speckitdriver:fix`、`/speckitdriver:resume`、`/speckitdriver:sync`）

## User Scenarios & Testing

### User Story 1 - 一键启动完整研发流程 (Priority: P1)

开发者在 Claude Code 中输入一句需求描述（如"给项目添加用户认证功能"），Speckit Driver Pro 自动启动完整的 Spec-Driven Development 流程：从调研到规范到规划到实现到验证，全程仅在关键决策点暂停征询用户意见，其余步骤自动推进。

**Why this priority**: 这是产品的核心价值主张——将 Spec Kit 的 9 个手动 skill 调用统一为一个自治编排流程，显著降低人工介入频率。没有这个能力，产品等同于现有的手动 speckit 命令序列。

**Independent Test**: 用户输入一句需求描述后，Driver Pro 自动依次完成 constitution 检查、调研、规范、澄清、规划、任务分解、分析、实现、验证全流程，最终产出完整的功能代码和验证报告。可通过检查 specs/[feature]/ 目录下是否生成了完整的制品链（research/、spec.md、plan.md、tasks.md、verification/）来验证。

**Acceptance Scenarios**:

1. **Given** 项目已初始化且 constitution 存在, **When** 用户输入需求描述并触发 Driver Pro, **Then** 系统自动按 10 个阶段依次编排执行，仅在 ≤ 4 个关键决策点暂停询问用户
2. **Given** Driver Pro 正在执行流程, **When** 某个质量门检测到 CRITICAL 问题, **Then** 系统自动暂停并清晰展示问题、影响和修复选项，等待用户决策
3. **Given** Driver Pro 正在执行流程, **When** 所有质量门均通过, **Then** 系统自动推进到下一阶段，不暂停询问用户
4. **Given** 用户对某个阶段的产出不满意（如调研结论需要调整）, **When** 用户指定重跑该阶段, **Then** 系统重新执行该阶段并将后续阶段的制品标记为过期，提示用户是否需要级联重跑

---

### User Story 2 - 产品调研与技术调研驱动的规范生成 (Priority: P1)

开发者输入需求后，Driver Pro 在生成需求规范之前，先自动进行产品调研（市场需求验证、竞品分析、用户场景验证）和技术调研（架构方案选型、依赖库评估、设计模式调研），两者串行执行（技术调研依赖产品调研结论），每个调研阶段内部的不同模块可并行。调研完成后输出产研汇总结论（research-synthesis.md），包含产品×技术交叉分析矩阵和最终推荐方案。

**Why this priority**: 调研阶段是本产品与所有现有 Spec-Driven Development 工具的核心差异化能力。没有调研，规范编写缺少市场和技术基础，容易导致方向偏离或技术选型不当。

**Independent Test**: 输入需求描述后，检查 specs/[feature]/research/ 目录下是否生成了 product-research.md、tech-research.md、research-synthesis.md 三份报告，且 research-synthesis.md 包含产品×技术交叉分析矩阵和 MVP 范围建议。

**Acceptance Scenarios**:

1. **Given** 用户输入需求描述, **When** Driver Pro 进入调研阶段, **Then** 先执行产品调研（市场需求验证、竞品分析、用户场景），产品调研完成后再基于其结论启动技术调研
2. **Given** 产品调研阶段, **When** 存在多个独立的调研模块, **Then** 不同模块可并行执行以提高效率
3. **Given** 产品调研和技术调研均完成, **When** 主编排器生成产研汇总, **Then** 汇总报告包含交叉分析矩阵、可行性评估、风险评估和最终推荐方案
4. **Given** 产研汇总完成, **When** 呈现给用户, **Then** 用户可确认调研方向、要求补充调研、或调整范围

---

### User Story 3 - 多语言验证闭环 (Priority: P2)

实现阶段完成后，Driver Pro 自动检测项目使用的编程语言和构建系统，运行对应的构建、Lint 和测试命令，验证代码质量和 Spec-Code 对齐，输出结构化验证报告。支持 12+ 种语言/构建系统，支持 Monorepo 多语言项目。

**Why this priority**: 验证闭环是保证研发质量的最后一道防线。没有自动验证，AI 生成的代码可能包含编译错误、lint 违规或测试失败，需要人工逐项检查。

**Independent Test**: 在一个 TypeScript + Rust 的 Monorepo 项目中运行 Driver Pro，验证阶段自动检测到两种语言，分别执行对应的构建和测试命令，输出包含两种语言独立结果的验证报告。

**Acceptance Scenarios**:

1. **Given** 实现阶段完成, **When** 进入验证阶段, **Then** 系统通过特征文件（package.json、Cargo.toml、go.mod、pom.xml 等）自动检测项目使用的语言和构建系统
2. **Given** 检测到项目语言, **When** 执行验证, **Then** 对每种语言分别执行构建、Lint 和测试命令，并输出独立的验证结果
3. **Given** 某个验证工具未安装（如 golangci-lint）, **When** 尝试执行, **Then** 优雅跳过并标记为"工具未安装"，不阻断整体验证流程
4. **Given** 用户在 spec-driver.config.yaml 中自定义了构建命令, **When** 执行验证, **Then** 使用用户自定义命令而非自动检测的默认命令

---

### User Story 4 - 模型分级配置 (Priority: P2)

开发者可根据项目预算和质量要求，选择不同的模型配置预设（balanced、quality-first、cost-efficient），或在 spec-driver.config.yaml 中精细配置每个子代理使用的模型。重分析任务（调研、规范、规划、分析）默认使用 Opus，执行任务（澄清、清单、任务分解、实现、验证）默认使用 Sonnet。

**Why this priority**: 模型选择直接影响输出质量和 API 成本。架构设计和调研需要深度推理用 Opus，而模板填充和代码生成用 Sonnet 足够。灵活配置让用户在质量和成本间找到最佳平衡。

**Independent Test**: 使用 balanced 预设启动流程，观察调研阶段使用 Opus、任务分解阶段使用 Sonnet；切换到 quality-first 预设后，所有阶段均使用 Opus。

**Acceptance Scenarios**:

1. **Given** 首次使用 Driver Pro, **When** 没有 spec-driver.config.yaml, **Then** 提示用户选择预设（balanced/quality-first/cost-efficient）并创建配置文件
2. **Given** 用户选择 balanced 预设, **When** 执行流程, **Then** 主编排器/调研/规范/规划/分析使用 Opus，其余使用 Sonnet
3. **Given** 用户在 spec-driver.config.yaml 中单独配置了某个子代理的模型, **When** 执行该子代理, **Then** 使用用户配置的模型而非预设默认值

---

### User Story 5 - Claude Code Plugin 安装与初始化 (Priority: P3)

开发者通过 Claude Code 的 Plugin marketplace 机制安装 Speckit Driver Pro，安装后在任意项目中首次使用时自动初始化 .specify/ 目录（包括脚本、模板、宪法模板），并检查项目是否已有 constitution。

**Why this priority**: 良好的安装和初始化体验是用户采纳的基础。但它是支撑性功能，不是核心价值。

**Independent Test**: 在一个空项目中安装并首次触发 Driver Pro，检查 .specify/ 目录是否正确创建，模板和脚本是否就位。

**Acceptance Scenarios**:

1. **Given** 用户安装了 Plugin, **When** 在新项目中首次触发, **Then** 自动运行初始化脚本创建 .specify/ 目录结构
2. **Given** 项目已有 .specify/ 目录和 constitution, **When** 触发 Driver Pro, **Then** 跳过初始化，直接进入流程编排
3. **Given** 项目没有 constitution, **When** 触发 Driver Pro, **Then** 先引导用户定义项目宪法，再进入功能研发流程

---

### User Story 6 - 快速需求实现（story 模式） (Priority: P1)

开发者有一个明确的需求变更（如"给用户列表添加分页功能"），不需要深度的市场调研和竞品分析，希望跳过调研阶段直接进入规范-规划-实现的快速通道。系统通过分析现有 spec 文档和代码库，直接生成增量规范和实现方案。

**Why this priority**: 大部分日常开发任务（功能迭代、需求变更）不需要完整调研，完整 10 阶段流程过于繁重。提供快速通道可将常见场景的耗时减少 60%+，是提高实际使用率的关键。

**Independent Test**: 用户输入需求描述后，Driver Pro 跳过调研阶段，直接分析代码库和现有 spec，生成增量 spec → plan → tasks → 实现 → 验证。可通过检查 specs/[feature]/ 目录下 **没有** research/ 子目录来验证跳过了调研。

**Acceptance Scenarios**:

1. **Given** 项目已初始化, **When** 用户输入 `/speckitdriver:story <需求描述>`, **Then** 系统跳过调研阶段（Phase 1a/1b/1c），直接从需求分析和 spec 生成开始，5 阶段完成全流程
2. **Given** story 模式执行中, **When** 进入规范阶段, **Then** 系统自动读取现有代码和相关 spec 文档作为上下文，生成针对性的增量规范
3. **Given** story 模式执行中, **When** 人工介入, **Then** 最多 2 次关键决策（任务确认 + 验证确认），比完整流程的 4 次更少
4. **Given** story 模式完成后, **When** 用户运行 `/speckitdriver:sync`, **Then** 新生成的 spec 能正确聚合到产品活文档中

---

### User Story 7 - 快速问题修复（fix 模式） (Priority: P1)

开发者发现一个 bug 或需要修复一个已知问题（如"登录页面在移动端布局错位"），希望 Driver Pro 快速定位问题根因、生成修复方案并实现。系统通过分析现有 spec、问题描述和代码库直接进入诊断-修复-验证的最短路径。

**Why this priority**: Bug 修复是最频繁的开发活动之一，需要最快速的响应。完整流程甚至 story 模式都不够精简，fix 模式将流程压缩到 4 阶段，实现"描述问题→自动修复"的极速体验。

**Independent Test**: 用户描述问题后，Driver Pro 分析代码和 spec 定位根因，生成修复方案并实现。可通过检查 specs/[feature]/ 目录下存在 `fix-report.md`（问题诊断 + 修复方案）来验证走的是 fix 流程。

**Acceptance Scenarios**:

1. **Given** 项目已初始化, **When** 用户输入 `/speckitdriver:fix <问题描述>`, **Then** 系统进入 4 阶段快速修复流程：问题诊断 → 修复规划 → 代码修复 → 验证闭环
2. **Given** fix 模式执行中, **When** 进入问题诊断阶段, **Then** 系统自动读取相关 spec 和代码文件，输出根因分析报告（root cause、影响范围、修复策略）
3. **Given** fix 模式执行中, **When** 人工介入, **Then** 最多 1 次关键决策（验证确认），实现近乎全自动修复
4. **Given** fix 完成后, **When** 修复涉及 spec 变更, **Then** 系统自动更新受影响的 spec 文件，保持 spec-code 同步

---

### Edge Cases

- 当用户中途中断流程（如关闭终端）后重新启动时，Driver Pro 通过检查已生成的制品文件判断进度，从上次完成的阶段继续，不重复执行已完成的步骤
- 当产品调研的 Web 搜索因网络问题失败时，系统优雅降级为基于本地代码库分析的调研模式，不阻断整个流程
- 当项目宪法中的原则与调研结论产生冲突时（如宪法要求"纯 Node.js 生态"但调研建议使用 Rust WASM），系统在产研汇总中明确标注冲突并由用户决策
- 当 Monorepo 中某个子项目的验证失败时，不阻断其他子项目的验证，独立报告每个子项目的结果
- 当用户在调研确认阶段要求补充调研时，系统能追加调研而非重新执行全部调研
- 当子代理执行失败或返回异常时，主编排器自动重试最多 2 次（默认），仍失败则暂停并向用户展示错误上下文、失败原因和操作选项（重试/跳过/中止）
- 当 story/fix 模式检测到需求范围过大（涉及 > 5 个模块或 > 20 个文件变更时），系统建议用户切换到完整 run 模式以获得调研支持
- 当 fix 模式无法通过代码和 spec 分析定位根因时，系统自动建议切换到 story 模式或补充调试信息

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 提供主编排器 skill（SKILL.md），作为"研发总监"统筹 10 个阶段的完整研发流程
- **FR-002**: 系统 MUST 通过 Claude Code 的 Task tool 委派子代理执行具体工作，主编排器负责高层决策和质量把控
- **FR-003**: 系统 MUST 实现串行的调研流程：产品调研（Phase 1a）完成后，其结论作为技术调研（Phase 1b）的输入
- **FR-004**: 系统 MUST 支持调研阶段内部的模块并行执行（如产品调研中的市场分析、竞品分析可并行）
- **FR-005**: 系统 MUST 在产品调研和技术调研完成后，由主编排器生成产研汇总结论（research-synthesis.md），包含产品×技术交叉分析矩阵
- **FR-006**: 系统 MUST 实现"信任但验证"的自动推进策略：默认自动继续，仅在质量门不通过（CRITICAL 问题）时暂停
- **FR-007**: 系统 MUST 将人工介入点控制在 ≤ 4 个关键决策点：(1) 产研结论确认 (2) CRITICAL 质量问题阻断 (3) 任务计划确认 (4) 最终验证确认
- **FR-008**: 系统 MUST 提供验证子代理，通过特征文件自动检测项目语言和构建系统
- **FR-009**: 验证子代理 MUST 支持以下语言/构建系统：JavaScript/TypeScript（npm/pnpm/yarn/bun）、Java（Maven/Gradle）、Kotlin（Gradle）、Swift（SPM/Xcode）、C/C++（CMake/Make）、Rust（Cargo）、Go（go mod）、Python（pip/poetry/uv）、C#（.NET）、Elixir（Mix）、Ruby（Bundler）
- **FR-010**: 验证子代理 MUST 支持 Monorepo 项目，对每个子项目独立执行验证并汇总报告
- **FR-011**: 系统 MUST 提供模型分级配置，支持 balanced、quality-first、cost-efficient 三个预设
- **FR-012**: 系统 MUST 允许用户通过 spec-driver.config.yaml 自定义每个子代理使用的模型
- **FR-013**: 系统 MUST 作为标准 Claude Code Plugin 发布，包含 plugin.json、SKILL.md、agents/、scripts/、templates/ 等标准结构
- **FR-014**: 系统 MUST 在首次使用时自动初始化项目的 .specify/ 目录结构
- **FR-015**: Plugin MUST 自包含全部子代理 prompt（agents/ 目录），开箱即用无需额外安装 speckit skills。同时在初始化阶段检测项目中是否已有 .claude/commands/speckit.*.md，若存在则优先使用项目已有版本（尊重用户定制），若不存在则使用 Plugin 内置版本
- **FR-016**: 系统 MUST 在验证阶段执行两层验证：Layer 1 Spec-Code 对齐验证（语言无关）+ Layer 2 项目原生工具链验证（语言相关）
- **FR-017**: 系统 MUST 在验证工具未安装时优雅降级（跳过该工具，标记为"未安装"），不阻断验证流程
- **FR-018**: 系统 MUST 允许用户在 spec-driver.config.yaml 中自定义构建/Lint/测试命令，覆盖自动检测结果
- **FR-019**: 系统 MUST 对高信心歧义自动选择推荐项（≤ 2 处且有明确推荐时），在 spec 中标注 [AUTO-RESOLVED]，减少不必要的人工介入
- **FR-020**: 系统 MUST 在每个阶段完成后将制品持久化到文件系统，支持中断后基于已有制品恢复流程
- **FR-023**: 主编排器 MUST 在每个阶段开始时输出阶段级进度提示（格式如"[3/10] 正在执行技术规划..."），阶段完成时输出该阶段关键产出的简要摘要（如"技术规划完成：选定 PostgreSQL + Redis，生成 3 个 API 契约"）
- **FR-022**: 子代理执行失败时，主编排器 MUST 自动重试最多 2 次（无固定超时，依赖 Claude Code Task tool 内置超时），2 次重试仍失败则暂停交用户决策（重试/跳过/中止）
- **FR-021**: 系统 MUST 支持选择性重跑：用户可指定重新执行某个阶段（如"重跑调研"或"重跑规划"），系统重新执行该阶段并将后续阶段的已有制品标记为过期（在文件头添加 `[STALE: 上游阶段已重跑]` 标记），提示用户是否级联重跑后续阶段
- **FR-024**: 系统 MUST 提供 story 快速模式（`/speckitdriver:story`），跳过调研阶段（Phase 1a/1b/1c），直接从 spec 生成开始，5 阶段完成：Constitution 检查 → 需求规范（基于代码+现有 spec 分析）→ 规划+任务 → 实现 → 验证
- **FR-025**: story 模式 MUST 在规范阶段自动读取项目现有代码结构和相关 spec 文档作为上下文，替代调研报告作为规范输入
- **FR-026**: story 模式 MUST 将人工介入控制在 ≤ 2 次：任务确认 + 验证确认
- **FR-027**: 系统 MUST 提供 fix 快速模式（`/speckitdriver:fix`），4 阶段完成：问题诊断（根因定位）→ 修复规划 → 代码修复 → 验证闭环
- **FR-028**: fix 模式 MUST 在诊断阶段自动分析相关 spec 和代码文件，输出 fix-report.md 包含根因分析、影响范围和修复策略
- **FR-029**: fix 模式 MUST 将人工介入控制在 ≤ 1 次：仅验证确认
- **FR-030**: fix 模式 MUST 在修复完成后自动检查是否需要更新受影响的 spec 文件，保持 spec-code 同步
- **FR-031**: story/fix 模式 SHOULD 在检测到需求范围过大时（涉及 > 5 个模块或 > 20 个文件），建议用户切换到完整 run 模式
- **FR-032**: Plugin 命令名称 MUST 统一为 `speckitdriver:xxx` 格式（run/story/fix/resume/sync），取代旧的 `speckit-driver-pro:xxx` 格式

### Key Entities

- **主编排器 (Orchestrator)**: Driver Pro 的核心 skill，定义角色为"研发总监"，负责全局决策、质量把控、人机交互管理。包含完整的 10 阶段工作流定义和决策框架
- **子代理 (Sub-Agent)**: 10 个专门化的子代理，分别负责 constitution、research（产品/技术调研）、specify、clarify、checklist、plan、tasks、analyze、implement、verify。每个子代理有独立的工具权限和模型配置
- **研发制品 (Artifact)**: 流程中产出的结构化文档，包括 product-research.md、tech-research.md、research-synthesis.md、spec.md、plan.md、tasks.md、checklists/、verification-report.md 等
- **质量门 (Quality Gate)**: 4 道自动化质量检查点——澄清门、宪法门、分析门、验证门。每个门有明确的通过/阻断标准
- **驱动配置 (Driver Config)**: spec-driver.config.yaml 文件，存储模型预设、自定义命令、验证配置等用户偏好

## Success Criteria

### Measurable Outcomes

- **SC-001**: 用户从输入需求描述到获得完整实现和验证报告，全程人工介入不超过 4 次关键决策
- **SC-002**: 调研阶段产出的 research-synthesis.md 包含 ≥ 3 个竞品的对比分析和 ≥ 2 个技术方案的评估
- **SC-003**: 验证阶段能正确检测并执行 ≥ 12 种语言/构建系统中已安装的工具链
- **SC-004**: 流程中断后重新启动时，系统能基于已有制品判断进度并从正确位置恢复
- **SC-005**: 使用 cost-efficient 预设时，Opus 调用次数 ≤ 总子代理调用次数的 30%
- **SC-006**: 使用 Driver Pro 后，单次功能开发的手动 skill 调用次数从 ≥ 9 次降至 1 次（仅触发 Driver Pro）
- **SC-007**: story 模式完成一次常规需求变更的阶段数为 5（对比 run 模式的 10），人工介入 ≤ 2 次
- **SC-008**: fix 模式完成一次 bug 修复的阶段数为 4，人工介入 ≤ 1 次

## Clarifications

### Session 2026-02-15

- Q: 用户能否主动跳过或单独重跑某个阶段？ → A: 支持选择性重跑，用户可指定重跑某个阶段，后续阶段制品自动标记为过期
- Q: 子代理 prompt 从哪里来——强依赖项目已有 speckit skills 还是 Plugin 自包含？ → A: 自包含 + 兼容，Plugin 内置全部子代理 prompt，检测到项目已有 speckit skills 时优先使用已有版本
- Q: 子代理失败时的重试策略？ → A: 默认自动重试最多 2 次，无固定超时，仍失败则暂停交用户决策
- Q: 长时间运行的进度反馈机制？ → A: 阶段级进度反馈，每个阶段开始/完成时报告进度和关键产出摘要

### Assumptions

- 用户已安装 Claude Code 并拥有 API 访问权限（Sonnet 和 Opus 模型）
- 项目已初始化 Git 仓库
- Plugin 自包含全部子代理 prompt，无需项目预装 speckit skills；若项目已有定制版 speckit skills 则优先使用
- Web 搜索工具（WebSearch 或 Perplexity MCP）可用于调研阶段；如不可用则降级为本地分析
- 用户理解 Spec-Driven Development 的基本概念，知道 spec、plan、tasks 等制品的含义
