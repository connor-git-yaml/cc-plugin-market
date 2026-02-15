# Speckit Driver Pro — 产品级活规范

**最后更新**: 2026-02-15
**聚合来源**: 2 个增量功能规范
**当前版本**: 基于 specs/012-product-spec-sync 为止的全部已实现功能

> 本文档由 Speckit Driver Pro 的 sync 子代理自动生成，反映产品的当前完整状态。
> 增量功能规范保留在 `specs/NNN-xxx/` 目录中作为决策历史记录。

---

## 产品概述

Speckit Driver Pro 是一个**自治研发编排器 Claude Code Plugin**，将 Spec-Driven Development 的 9 个手动 skill 调用统一为一个完整的自治编排流程。开发者只需输入一句需求描述，Driver Pro 即自动驱动从调研到规范、从规划到实现、从验证到交付的完整研发生命周期。

**定位**: 自治研发编排器 Claude Code Plugin —— Spec-Driven Development 的"研发总监"
**目标用户**: 使用 Claude Code 的开发者，已理解 Spec-Driven Development 基本概念（spec、plan、tasks 等制品含义）
**核心价值**: 将手动 skill 调用次数从 >= 9 次降至 1 次，全程仅在 <= 4 个关键决策点暂停征询用户意见，显著降低人工介入频率

---

## 当前功能全集

### 功能总览

| 编号 | 功能 | 来源 spec | 状态 | 说明 |
|------|------|----------|------|------|
| F-001 | 一键启动完整研发流程 | 011-speckit-driver-pro | ✅ 活跃 | 输入一句需求，自动编排 10 阶段研发流程 |
| F-002 | 产品调研与技术调研驱动的规范生成 | 011-speckit-driver-pro | ✅ 活跃 | 串行调研（产品调研 -> 技术调研）+ 产研汇总 |
| F-003 | 多语言验证闭环 | 011-speckit-driver-pro | ✅ 活跃 | 自动检测 12+ 种语言/构建系统，双层验证 |
| F-004 | 模型分级配置 | 011-speckit-driver-pro | ✅ 活跃 | 三档预设 + 子代理级自定义模型配置 |
| F-005 | Plugin 安装与初始化 | 011-speckit-driver-pro | ✅ 活跃 | 标准 Claude Code Plugin，首次使用自动初始化 |
| F-006 | 子代理自包含与兼容 | 011-speckit-driver-pro | ✅ 活跃 | 内置全部子代理 prompt，兼容项目已有 speckit skills |
| F-007 | 自动推进与质量门 | 011-speckit-driver-pro | ✅ 活跃 | "信任但验证"策略，4 道质量门自动把控 |
| F-008 | 制品持久化与流程恢复 | 011-speckit-driver-pro | ✅ 活跃 | 中断后基于已有制品自动恢复进度 |
| F-009 | 选择性重跑与级联过期 | 011-speckit-driver-pro | ✅ 活跃 | 指定阶段重跑，后续制品自动标记过期 |
| F-010 | 阶段级进度反馈 | 011-speckit-driver-pro | ✅ 活跃 | 每阶段开始/完成时报告进度和关键产出摘要 |
| F-011 | 子代理失败自动重试 | 011-speckit-driver-pro | ✅ 活跃 | 自动重试 2 次，仍失败则暂停交用户决策 |
| F-012 | 高信心歧义自动解决 | 011-speckit-driver-pro | ✅ 活跃 | <= 2 处歧义且有明确推荐时自动选择，标注 [AUTO-RESOLVED] |
| F-013 | 产品规范聚合（--sync） | 012-product-spec-sync | ✅ 活跃 | 增量 spec 智能合并为产品级活文档，双层规范架构 |

### 详细功能描述

#### F-001: 一键启动完整研发流程

**来源**: specs/011-speckit-driver-pro/spec.md (User Story 1, FR-001, FR-002, FR-006, FR-007)
**状态**: ✅ 活跃

开发者在 Claude Code 中输入一句需求描述（如"给项目添加用户认证功能"），Driver Pro 自动启动完整的 Spec-Driven Development 流程：从调研到规范到规划到实现到验证，全程仅在关键决策点暂停征询用户意见，其余步骤自动推进。主编排器作为"研发总监"统筹 10 个阶段的完整研发流程，通过 Claude Code 的 Task tool 委派子代理执行具体工作。

**当前行为**:
- 系统自动按 10 个阶段依次编排执行，仅在 <= 4 个关键决策点暂停询问用户
- 实现"信任但验证"的自动推进策略：默认自动继续，仅在质量门不通过（CRITICAL 问题）时暂停
- 人工介入点控制在 <= 4 个：(1) 产研结论确认 (2) CRITICAL 质量问题阻断 (3) 任务计划确认 (4) 最终验证确认
- 所有质量门均通过时自动推进到下一阶段，不暂停询问用户

**验收标准**:
- 用户输入需求描述后，Driver Pro 自动依次完成 constitution 检查、调研、规范、澄清、规划、任务分解、分析、实现、验证全流程
- specs/[feature]/ 目录下生成完整制品链（research/、spec.md、plan.md、tasks.md、verification/）
- 某个质量门检测到 CRITICAL 问题时，系统自动暂停并清晰展示问题、影响和修复选项

---

#### F-002: 产品调研与技术调研驱动的规范生成

**来源**: specs/011-speckit-driver-pro/spec.md (User Story 2, FR-003, FR-004, FR-005)
**状态**: ✅ 活跃

在生成需求规范之前，Driver Pro 先自动进行产品调研（市场需求验证、竞品分析、用户场景验证）和技术调研（架构方案选型、依赖库评估、设计模式调研），两者串行执行（技术调研依赖产品调研结论），每个调研阶段内部的不同模块可并行。调研完成后输出产研汇总结论（research-synthesis.md），包含产品 x 技术交叉分析矩阵和最终推荐方案。

**当前行为**:
- 先执行产品调研（市场需求验证、竞品分析、用户场景），产品调研完成后再基于其结论启动技术调研
- 调研阶段内部的不同模块可并行执行以提高效率
- 产品调研和技术调研完成后，由主编排器生成产研汇总结论（research-synthesis.md）
- 汇总报告包含交叉分析矩阵、可行性评估、风险评估和最终推荐方案

**验收标准**:
- specs/[feature]/research/ 目录下生成 product-research.md、tech-research.md、research-synthesis.md 三份报告
- research-synthesis.md 包含产品 x 技术交叉分析矩阵和 MVP 范围建议
- 用户可确认调研方向、要求补充调研、或调整范围

---

#### F-003: 多语言验证闭环

**来源**: specs/011-speckit-driver-pro/spec.md (User Story 3, FR-008, FR-009, FR-010, FR-016, FR-017, FR-018)
**状态**: ✅ 活跃

实现阶段完成后，Driver Pro 自动检测项目使用的编程语言和构建系统，运行对应的构建、Lint 和测试命令，验证代码质量和 Spec-Code 对齐，输出结构化验证报告。支持 12+ 种语言/构建系统，支持 Monorepo 多语言项目。

**当前行为**:
- 通过特征文件（package.json、Cargo.toml、go.mod、pom.xml 等）自动检测项目语言和构建系统
- 支持语言/构建系统：JavaScript/TypeScript（npm/pnpm/yarn/bun）、Java（Maven/Gradle）、Kotlin（Gradle）、Swift（SPM/Xcode）、C/C++（CMake/Make）、Rust（Cargo）、Go（go mod）、Python（pip/poetry/uv）、C#（.NET）、Elixir（Mix）、Ruby（Bundler）
- 双层验证：Layer 1 Spec-Code 对齐验证（语言无关）+ Layer 2 项目原生工具链验证（语言相关）
- 支持 Monorepo 项目，对每个子项目独立执行验证并汇总报告
- 验证工具未安装时优雅降级（跳过该工具，标记为"未安装"），不阻断验证流程
- 用户可在 driver-config.yaml 中自定义构建/Lint/测试命令，覆盖自动检测结果

**验收标准**:
- 对每种检测到的语言分别执行构建、Lint 和测试命令，输出独立验证结果
- Monorepo 中某个子项目验证失败时，不阻断其他子项目的验证
- 验证报告包含 Spec-Code 对齐和原生工具链两层验证结果

---

#### F-004: 模型分级配置

**来源**: specs/011-speckit-driver-pro/spec.md (User Story 4, FR-011, FR-012)
**状态**: ✅ 活跃

开发者可根据项目预算和质量要求，选择不同的模型配置预设（balanced、quality-first、cost-efficient），或在 driver-config.yaml 中精细配置每个子代理使用的模型。

**当前行为**:
- 三档预设配置：
  - **balanced**（默认）：主编排器/调研/规范/规划/分析使用 Opus，其余使用 Sonnet
  - **quality-first**：所有阶段均使用 Opus
  - **cost-efficient**：Opus 调用次数 <= 总子代理调用次数的 30%
- 首次使用时若无 driver-config.yaml，提示用户选择预设并创建配置文件
- 用户可在 driver-config.yaml 中单独配置某个子代理的模型，覆盖预设默认值

**验收标准**:
- 不同预设下，各子代理使用的模型符合预设规则
- 自定义配置优先级高于预设默认值
- cost-efficient 预设下 Opus 调用次数 <= 总子代理调用次数的 30%

---

#### F-005: Plugin 安装与初始化

**来源**: specs/011-speckit-driver-pro/spec.md (User Story 5, FR-013, FR-014)
**状态**: ✅ 活跃

开发者通过 Claude Code 的 Plugin marketplace 机制安装 Speckit Driver Pro，安装后在任意项目中首次使用时自动初始化 .specify/ 目录（包括脚本、模板、宪法模板），并检查项目是否已有 constitution。

**当前行为**:
- 作为标准 Claude Code Plugin 发布，包含 plugin.json、SKILL.md、agents/、scripts/、templates/ 等标准结构
- 首次使用时自动运行初始化脚本创建 .specify/ 目录结构
- 项目已有 .specify/ 目录和 constitution 时跳过初始化，直接进入流程编排
- 项目没有 constitution 时先引导用户定义项目宪法，再进入功能研发流程

**验收标准**:
- 新项目首次触发时 .specify/ 目录正确创建，模板和脚本就位
- 已有 .specify/ 的项目直接进入流程编排
- 缺少 constitution 时引导用户创建

---

#### F-006: 子代理自包含与兼容

**来源**: specs/011-speckit-driver-pro/spec.md (FR-015)
**状态**: ✅ 活跃

Plugin 自包含全部 10 个子代理 prompt（agents/ 目录），开箱即用无需额外安装 speckit skills。同时兼容项目已有定制。

**当前行为**:
- Plugin 内置全部子代理 prompt：constitution、research（产品/技术调研）、specify、clarify、checklist、plan、tasks、analyze、implement、verify
- 初始化阶段检测项目中是否已有 `.claude/commands/speckit.*.md`
- 若存在则优先使用项目已有版本（尊重用户定制）
- 若不存在则使用 Plugin 内置版本

**验收标准**:
- 无 speckit skills 的项目可直接使用 Driver Pro
- 已有定制 speckit skills 的项目优先使用已有版本

---

#### F-007: 自动推进与质量门

**来源**: specs/011-speckit-driver-pro/spec.md (FR-006, FR-007)
**状态**: ✅ 活跃

4 道自动化质量门贯穿研发流程，确保每个阶段的产出质量。

**当前行为**:
- 4 道质量门：澄清门、宪法门、分析门、验证门
- 每个门有明确的通过/阻断标准
- 通过时自动推进，不暂停
- 检测到 CRITICAL 问题时自动暂停，清晰展示问题、影响和修复选项，等待用户决策

**验收标准**:
- 全部质量门通过时自动推进到下一阶段
- CRITICAL 问题触发暂停，提供清晰的问题描述和操作选项

---

#### F-008: 制品持久化与流程恢复

**来源**: specs/011-speckit-driver-pro/spec.md (FR-020, Edge Case 1)
**状态**: ✅ 活跃

每个阶段完成后将制品持久化到文件系统，支持中断后恢复。

**当前行为**:
- 每个阶段完成后将制品持久化到 specs/[feature]/ 目录
- 用户中途中断流程（如关闭终端）后重新启动时，通过检查已生成的制品文件判断进度
- 从上次完成的阶段继续，不重复执行已完成的步骤

**验收标准**:
- 流程中断后重新启动，系统能基于已有制品判断进度并从正确位置恢复

---

#### F-009: 选择性重跑与级联过期

**来源**: specs/011-speckit-driver-pro/spec.md (FR-021, User Story 1 Scenario 4)
**状态**: ✅ 活跃

用户可指定重新执行某个阶段，系统自动处理后续制品的过期标记。

**当前行为**:
- 用户可指定重新执行某个阶段（如"重跑调研"或"重跑规划"）
- 系统重新执行该阶段并将后续阶段的已有制品标记为过期（在文件头添加 `[STALE: 上游阶段已重跑]` 标记）
- 提示用户是否级联重跑后续阶段

**验收标准**:
- 指定重跑后，后续阶段制品正确标记为过期
- 用户可选择是否级联重跑

---

#### F-010: 阶段级进度反馈

**来源**: specs/011-speckit-driver-pro/spec.md (FR-023)
**状态**: ✅ 活跃

主编排器在每个阶段提供清晰的进度反馈。

**当前行为**:
- 每个阶段开始时输出阶段级进度提示（格式如"[3/10] 正在执行技术规划..."）
- 阶段完成时输出该阶段关键产出的简要摘要（如"技术规划完成：选定 PostgreSQL + Redis，生成 3 个 API 契约"）

**验收标准**:
- 每个阶段开始和完成时均有进度输出
- 摘要包含该阶段的关键产出信息

---

#### F-011: 子代理失败自动重试

**来源**: specs/011-speckit-driver-pro/spec.md (FR-022, Edge Case 6)
**状态**: ✅ 活跃

子代理执行失败时的自动恢复机制。

**当前行为**:
- 主编排器自动重试最多 2 次（无固定超时，依赖 Claude Code Task tool 内置超时）
- 2 次重试仍失败则暂停交用户决策（重试/跳过/中止）
- 向用户展示错误上下文、失败原因和操作选项

**验收标准**:
- 子代理失败后自动重试不超过 2 次
- 重试仍失败时暂停，用户可选择重试/跳过/中止

---

#### F-012: 高信心歧义自动解决

**来源**: specs/011-speckit-driver-pro/spec.md (FR-019)
**状态**: ✅ 活跃

减少不必要的人工介入，对高信心歧义自动决策。

**当前行为**:
- 对 <= 2 处歧义且有明确推荐项时，自动选择推荐项
- 在 spec 中标注 [AUTO-RESOLVED]，透明记录自动决策

**验收标准**:
- 高信心歧义自动解决，标注 [AUTO-RESOLVED]
- 低信心歧义仍暂停征询用户

---

#### F-013: 产品规范聚合（--sync）

**来源**: specs/012-product-spec-sync/spec.md (User Story 1, User Story 2, FR-024 ~ FR-034)
**状态**: ✅ 活跃

将增量功能规范（`specs/NNN-xxx/`）智能合并为产品级活文档（`specs/products/{product}/current-spec.md`），解决"有增量记录但无全景视图"的规范管理缺口。采用行业最佳实践的"双层规范架构"：增量 spec 作为历史记录（类 RFC），产品级活文档反映当前状态（类 Reference）。

**当前行为**:

- 通过 `--sync` 参数触发独立聚合流程，不执行标准 10 阶段工作流
- 扫描 specs/ 下所有 NNN-xxx 功能目录，自动判定产品归属
- 按时间顺序和类型规则（INITIAL/FEATURE/FIX/REFACTOR/ENHANCEMENT）智能合并
- 为每个产品生成 `specs/products/{product}/current-spec.md`
- 产品映射持久化到 specs/products/product-mapping.yaml，支持手动编辑覆盖
- 不修改任何增量 spec 原始文件（只读操作）
- 聚合结果幂等——相同输入重复运行产生相同输出
- sync 子代理始终使用 Opus 模型（聚合分析需要深度推理）

**验收标准**:

- 每个已识别产品的 current-spec.md 包含该产品所有活跃功能的合并描述，覆盖率 100%
- product-mapping.yaml 的产品归属准确率 >= 95%
- FIX 不新增功能、REFACTOR 替换旧架构、被取代功能标记为废弃
- 重复运行（增量 spec 无变化时）产出内容一致

---

## 当前技术架构

> 纯声明式 Plugin 架构，无运行时依赖。

**技术栈**: Markdown prompts + YAML 配置 + Bash 脚本（纯声明式 Claude Code Plugin，无编译型运行时依赖）

**项目结构**:

```text
speckit-driver-pro/
  plugin.json              # Plugin 元数据
  SKILL.md                 # 主编排器 prompt（"研发总监"角色）
  agents/                  # 10 个子代理 prompt
    constitution.md        # 宪法检查子代理
    research-product.md    # 产品调研子代理
    research-tech.md       # 技术调研子代理
    specify.md             # 需求规范子代理
    clarify.md             # 澄清子代理
    checklist.md           # 清单子代理
    plan.md                # 规划子代理
    tasks.md               # 任务分解子代理
    analyze.md             # 分析子代理
    implement.md           # 实现子代理
    verify.md              # 验证子代理
  scripts/                 # 初始化和辅助脚本
  templates/               # 制品模板（含产品活文档模板）
  driver-config.yaml       # 驱动配置（模型预设、自定义命令等）
```

**核心架构模式**: 主编排器 + 12 子代理

- **主编排器**（SKILL.md）：定义"研发总监"角色，负责全局决策、质量把控、人机交互管理，包含完整的 10 阶段工作流定义、决策框架和 --sync 聚合模式
- **12 个子代理**（agents/ 目录）：constitution、research-product、research-tech、specify、clarify、checklist、plan、tasks、analyze、implement、verify、sync，每个子代理有独立的工具权限和模型配置
- **委派机制**：通过 Claude Code 的 Task tool 委派子代理执行

**10 阶段工作流**:

| 阶段 | 名称 | 子代理 | 默认模型（balanced） |
|------|------|--------|---------------------|
| Phase 0 | 宪法检查 | constitution | Opus |
| Phase 1a | 产品调研 | research-product | Opus |
| Phase 1b | 技术调研 | research-tech | Opus |
| Phase 2 | 需求规范 | specify | Opus |
| Phase 3 | 澄清 | clarify | Sonnet |
| Phase 4 | 清单 | checklist | Sonnet |
| Phase 5 | 技术规划 | plan | Opus |
| Phase 6 | 任务分解 | tasks | Sonnet |
| Phase 7 | 分析 | analyze | Opus |
| Phase 8 | 实现 | implement | Sonnet |
| Phase 9 | 验证 | verify | Sonnet |

**4 道质量门**:

1. **澄清门**（Phase 3 后）：检查需求歧义是否已全部解决
2. **宪法门**（Phase 0）：检查需求是否符合项目宪法原则
3. **分析门**（Phase 7 后）：检查技术方案可行性
4. **验证门**（Phase 9）：检查代码质量和 Spec-Code 对齐

**关键设计决策**:
- 纯声明式 Plugin 架构，无编译型运行时依赖，仅由 Markdown prompts + YAML + Bash 组成（来源: specs/011-speckit-driver-pro）
- 调研流程串行（产品调研 -> 技术调研），调研内部模块可并行（来源: specs/011-speckit-driver-pro）
- "信任但验证"自动推进策略，人工介入点 <= 4 个（来源: specs/011-speckit-driver-pro）
- Plugin 自包含全部子代理 prompt，兼容项目已有 speckit skills（来源: specs/011-speckit-driver-pro）
- 双层验证架构：Spec-Code 对齐（语言无关）+ 原生工具链（语言相关）（来源: specs/011-speckit-driver-pro）

---

## 已知限制与技术债

| 来源 spec | 类别 | 描述 | 状态 |
|----------|------|------|------|
| 011-speckit-driver-pro | 限制 | Web 搜索因网络问题失败时，降级为基于本地代码库分析的调研模式，调研深度受限 | 未解决 |
| 011-speckit-driver-pro | 限制 | 项目宪法原则与调研结论可能产生冲突（如宪法要求"纯 Node.js 生态"但调研建议 Rust WASM），需人工决策 | 未解决 |
| 011-speckit-driver-pro | 限制 | 子代理无固定超时机制，依赖 Claude Code Task tool 内置超时 | 未解决 |
| 011-speckit-driver-pro | 限制 | 补充调研为追加模式而非全量重跑，可能导致新旧调研结论之间存在不一致 | 未解决 |
| 011-speckit-driver-pro | 假设 | 用户已安装 Claude Code 并拥有 Sonnet 和 Opus 模型的 API 访问权限 | 前置条件 |
| 011-speckit-driver-pro | 假设 | 项目已初始化 Git 仓库 | 前置条件 |
| 011-speckit-driver-pro | 假设 | 用户理解 Spec-Driven Development 基本概念 | 前置条件 |

---

## 被废弃的功能

> 无。这是产品的初始版本（011-speckit-driver-pro），不存在被废弃的功能。

---

## 变更历史

| 编号 | 功能 spec | 类型 | 日期 | 摘要 |
| ------ | ---------- | ------ | ------ | ------ |
| 001 | 011-speckit-driver-pro | INITIAL | 2026-02-15 | Speckit Driver Pro 产品初始版本：自治研发编排器 Claude Code Plugin，主编排器 + 11 子代理架构，10 阶段工作流 + 4 质量门，支持 12+ 语言验证、模型分级配置、制品持久化与流程恢复 |
| 002 | 012-product-spec-sync | FEATURE | 2026-02-15 | 新增产品规范聚合功能（--sync）：增量 spec 智能合并为产品级活文档，双层规范架构，自动产品归属判定，幂等聚合 |

---

## 附录：增量 spec 索引

| spec | 标题 | 类型 | 关键变更 |
| ------ | ------ | ------ | --------- |
| [011-speckit-driver-pro](../../011-speckit-driver-pro/spec.md) | Speckit Driver Pro | INITIAL | 产品初始版本：一键研发编排、串行调研、多语言验证闭环、模型分级配置、Plugin 安装初始化、子代理自包含、4 质量门、制品持久化、选择性重跑、进度反馈、失败重试、高信心歧义自动解决 |
| [012-product-spec-sync](../../012-product-spec-sync/spec.md) | 产品规范聚合（--sync） | FEATURE | 新增 --sync 模式、sync 子代理、产品活文档模板，双层规范架构（增量 spec + 产品级活文档） |
