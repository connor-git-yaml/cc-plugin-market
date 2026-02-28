# Spec Driver — 产品规范活文档

> **产品**: spec-driver
> **版本**: 聚合自 9 个增量 spec（011–019）
> **最后聚合**: 2026-02-28
> **生成方式**: Spec Driver sync 子代理自动聚合
> **状态**: 活跃

---

## 目录

1. [产品概述](#1-产品概述)
2. [目标与成功指标](#2-目标与成功指标)
3. [用户画像与场景](#3-用户画像与场景)
4. [范围与边界](#4-范围与边界)
5. [当前功能全集](#5-当前功能全集)
6. [非功能需求](#6-非功能需求)
7. [当前技术架构](#7-当前技术架构)
8. [设计原则与决策记录](#8-设计原则与决策记录)
9. [已知限制与技术债](#9-已知限制与技术债)
10. [假设与风险](#10-假设与风险)
11. [被废弃的功能](#11-被废弃的功能)
12. [变更历史](#12-变更历史)
13. [术语表](#13-术语表)
14. [附录：增量 spec 索引](#14-附录增量-spec-索引)

---

## 1. 产品概述

Spec Driver 是一个 **自治研发编排器 Claude Code Plugin**（v3.3.0），将 Spec-Driven Development (SDD) 的完整研发流程——从调研到规范到规划到实现到验证——统一编排为单一命令触发的自动化流水线。

**核心定位**：面向采用 Spec-Driven Development 方法论的开发团队，提供"一句需求描述 → 完整功能交付"的自治编排能力，将原本需要 9+ 次手动 Skill 调用的流程压缩为 1 次触发。

**核心价值**：

- **自治编排**：10 阶段全流程自动推进，仅在关键决策点暂停征询用户意见
- **调研驱动**：在规范编写之前，自动进行产品调研（市场、竞品、用户场景）和技术调研（架构选型、依赖评估），输出产研交叉分析
- **灵活调研路由**：6 种调研模式预设（full/tech-only/product-only/codebase-scan/skip/custom），智能推荐 + 命令行参数覆盖，按需裁剪调研深度（018）
- **多模式支持**：完整流程（speckit-feature）、快速需求（speckit-story）、快速修复（speckit-fix）、中断恢复（speckit-resume）、规范聚合（speckit-sync）、文档生成（speckit-doc）六种模式
- **验证铁律**：要求实现子代理在声称完成前必须在当前上下文中实际运行验证命令，拒绝推测性的"should pass"声明（017）
- **三级门禁策略**：strict / balanced / autonomous 三级门禁 + 门禁级独立配置 + 设计硬门禁（017）
- **双阶段代码审查**：Spec 合规审查（逐条 FR 检查）+ 代码质量审查（设计/安全/性能/可维护性），两阶段独立报告（017）
- **并行子代理加速**：验证闭环三并行、调研阶段并行、clarify+checklist 并行，串行回退安全网（019）
- **质量门控**：5 道质量门（研究门、设计门、分析门、任务门、验证门），CRITICAL 问题自动阻断
- **多语言验证**：支持 12+ 种语言/构建系统的自动检测和验证闭环
- **产品规范聚合**：将增量功能 spec 智能合并为 14 章节的产品级活文档（016）
- **开源文档生成**：一键生成 README/LICENSE/CONTRIBUTING/CODE_OF_CONDUCT 文档套件（015）

**分发方式**：

- **Claude Code Plugin Marketplace**：通过 `claude plugin install spec-driver` 安装，Plugin 名 `spec-driver`
- **6 个独立 Skill 命令**：`/spec-driver:speckit-feature`、`/spec-driver:speckit-story`、`/spec-driver:speckit-fix`、`/spec-driver:speckit-resume`、`/spec-driver:speckit-sync`、`/spec-driver:speckit-doc`

---

## 2. 目标与成功指标

### 产品愿景

让 AI 驱动的研发流程具备自治编排能力——开发者用一句话描述需求，系统自主完成从调研到验证的全流程，在关键决策点智能暂停征询意见，最终交付经过验证的完整功能实现。同时通过验证铁律、三级门禁策略和双阶段代码审查确保产出代码的可信度和规范合规性。

### 产品级 KPI

| 指标 | 目标值 | 来源 |
|------|--------|------|
| 完整流程人工介入次数 | ≤ 4 次关键决策 | SC-001 (011) |
| 调研报告竞品覆盖 | ≥ 3 个竞品对比 + ≥ 2 个技术方案评估 | SC-002 (011) |
| 语言/构建系统验证覆盖 | ≥ 12 种 | SC-003 (011) |
| 中断恢复能力 | 基于已有制品正确恢复 | SC-004 (011) |
| cost-efficient 预设 Opus 使用率 | ≤ 30% | SC-005 (011) |
| 手动 Skill 调用次数削减 | 从 ≥ 9 次降至 1 次 | SC-006 (011) |
| story 模式阶段数 / 人工介入 | 5 阶段 / ≤ 2 次 | SC-007 (011) |
| fix 模式阶段数 / 人工介入 | 4 阶段 / ≤ 1 次 | SC-008 (011) |
| 产品规范聚合覆盖率 | 100% 活跃功能 | SC-007 (012) |
| 产品归属自动判定准确率 | ≥ 95% | SC-008 (012) |
| sync 命令上下文加载量 | 约 120 行（非 706 行单体） | SC-002 (013) |
| 旧命令残留 | 0（speckitdriver 引用全部清除） | SC-001 (014) |
| 产品活文档章节完整度 | 14 个标准章节 | SC-001 (016) |
| 验证铁律证据覆盖率 | ≥ 90% 场景产生新鲜验证证据 | SC-001 (017) |
| 三级门禁策略切换 | strict/balanced/autonomous 正确工作 | SC-003 (017) |
| 设计硬门禁不可绕过 | 所有策略含 autonomous 下均暂停 | SC-005 (017) |
| 向后兼容 | 未修改配置用户零破坏性变更 | SC-006 (017) |
| 调研模式 full 向后兼容 | 行为与当前版本 100% 一致 | SC-001 (018) |
| skip 模式调研耗时 | 降为 0 | SC-002 (018) |
| 验证闭环并行加速 | 耗时减少 ≥ 30% | SC-001 (019) |
| 调研阶段并行加速 | 耗时减少 ≥ 40% | SC-002 (019) |
| 并行回退成功率 | 100% 回退到串行 | SC-005 (019) |

---

## 3. 用户画像与场景

### 用户角色

| 角色 | 描述 | 主要使用场景 |
|------|------|------------|
| **全栈开发者** | 需要端到端实现新功能 | `/spec-driver:speckit-feature <需求>` 启动完整研发流程 |
| **迭代开发者** | 有明确需求变更，不需要深度调研 | `/spec-driver:speckit-story <需求>` 快速需求通道 |
| **Bug 修复者** | 发现 bug 需要快速定位和修复 | `/spec-driver:speckit-fix <问题>` 快速修复 |
| **技术主管 (Tech Lead)** | 需要产品全景文档、新成员 onboarding；需要精细控制门禁策略 | `/spec-driver:speckit-sync` 产品规范聚合；配置 `gate_policy: strict` 确保每个质量门暂停（017） |
| **质量工程师** | 关注验证覆盖率和代码审查质量 | 借助验证铁律确保实现子代理提供新鲜验证证据；查阅双阶段审查报告定位 spec 偏差和代码质量问题（017） |
| **独立开发者 (Solo Dev)** | 快速原型阶段希望减少打断 | 配置 `gate_policy: autonomous` 接近全自动运行；使用 `--research skip` 跳过调研（017, 018） |
| **开源项目维护者** | 需要生成 README 等开源文档 | `/spec-driver:speckit-doc` 一键生成文档套件（015） |
| **流程恢复者** | 流程中断后需要继续 | `/spec-driver:speckit-resume` 恢复编排 |
| **新团队成员** | 通过 `/` 补全菜单发现可用功能 | 浏览 6 个独立命令及语义描述 |

### 核心使用场景

1. **完整研发流程（speckit-feature）**：开发者输入一句需求描述，编排器智能推荐调研模式（full/tech-only/skip 等），经用户确认后执行 10 阶段编排（Constitution → 调研[按模式裁剪] → 产研汇总 → 需求规范 → 需求澄清+质量检查[并行] → 设计门禁 → 技术规划 → 任务分解 → 一致性分析 → 代码实现 → 验证闭环[Spec 合规+代码质量并行 → 工具链验证]），三级门禁策略控制暂停行为
2. **快速需求实现（speckit-story）**：跳过调研阶段，5 阶段快速通道（Constitution → 规范 → 规划+任务 → 实现 → 验证），设计门禁默认豁免，人工介入 ≤ 2 次
3. **快速 Bug 修复（speckit-fix）**：4 阶段最短路径（问题诊断 → 修复规划 → 代码修复 → 验证闭环），输出 fix-report.md，设计门禁默认豁免，人工介入 ≤ 1 次
4. **中断恢复（speckit-resume）**：扫描已有制品文件判断进度，从断点恢复编排流程
5. **产品规范聚合（speckit-sync）**：扫描 `specs/` 下所有增量 spec，按产品归属智能合并为 14 章节的 `current-spec.md` 活文档，输出文档质量评估
6. **开源文档生成（speckit-doc）**：交互式选择文档模式（精简/完整）和开源协议（8 种），自动提取项目元信息，一键生成 README.md、LICENSE、CONTRIBUTING.md、CODE_OF_CONDUCT.md（015）

---

## 4. 范围与边界

### 范围内

- 10 阶段自治编排流程（run/speckit-feature 模式）
- 6 种调研模式（full/tech-only/product-only/codebase-scan/skip/custom）+ 智能推荐 + `--research <mode>` 命令行覆盖（018）
- story 快速需求模式（5 阶段）和 fix 快速修复模式（4 阶段）
- 中断恢复（resume）：基于已有制品扫描恢复点
- 选择性重跑（`--rerun <phase>`）：重跑指定阶段并标记后续制品为过期
- 产品调研 + 技术调研（可并行执行）+ 产研汇总（019）
- 5 道质量门（GATE_RESEARCH、GATE_DESIGN、GATE_ANALYSIS、GATE_TASKS、GATE_VERIFY）
- 三级门禁策略（strict/balanced/autonomous）+ 门禁级独立配置 + 设计硬门禁（017）
- 验证铁律：要求新鲜验证证据，拒绝推测性完成声明（017）
- 双阶段代码审查：Spec 合规审查 + 代码质量审查，独立报告（017）
- 并行子代理加速：3 个并行组（VERIFY_GROUP、RESEARCH_GROUP、DESIGN_PREP_GROUP）+ 串行回退安全网（019）
- 模型分级配置（balanced / quality-first / cost-efficient 三种预设 + 自定义）
- 12+ 种语言/构建系统的多语言验证闭环
- 产品规范聚合（sync）：增量 spec 智能合并为 14 章节产品级活文档（012, 016）
- 产品归属自动判定 + product-mapping.yaml 持久化
- 开源文档生成（doc）：交互式协议选择 + 文档模式 + README/LICENSE/CONTRIBUTING/CODE_OF_CONDUCT 一键生成（015）
- 6 个独立 Skill 命令（speckit-feature / speckit-story / speckit-fix / speckit-resume / speckit-sync / speckit-doc）
- Claude Code Plugin 标准架构（plugin.json + skills/ + agents/ + hooks/ + scripts/ + templates/）

### 范围外

- **源代码逆向分析**：代码到 Spec 的逆向工程由 reverse-spec Plugin 负责
- **AST 静态分析**：Spec Driver 不执行 AST 分析，委派给 Speckit 子代理（speckit-doc 的 AST 分析除外，由 reverse-spec prepare 命令提供）
- **IDE 实时集成**：VS Code 等 IDE 中的实时编排状态显示
- **跨产品 spec**：每个增量 spec 属于且仅属于一个产品
- **Plugin 自动版本更新和安全签名**
- **共享模块（_shared/）**：技能间的公共逻辑提取（归入二期）
- **Hooks 层验证铁律增强**：PreToolUse/PostToolUse + 结构化 verification-evidence.json 为 MVP 第二批（017）

---

## 5. 当前功能全集

### FR-GROUP-1: 主编排器与流程控制

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-001 | 主编排器 SKILL.md 作为"研发总监"统筹 10 阶段完整研发流程 | 011 | 活跃 |
| FR-002 | 通过 Claude Code Task tool 委派子代理执行具体工作 | 011 | 活跃 |
| FR-006 | "信任但验证"自动推进策略：默认自动继续，仅 CRITICAL 问题暂停 | 011 | 已更新（017 增强为三级门禁策略） |
| FR-007 | 人工介入 ≤ 4 次：产研确认、CRITICAL 阻断、任务确认、验证确认 | 011 | 已更新（017 按门禁策略动态调整） |
| FR-020 | 每个阶段完成后制品持久化到文件系统，支持中断恢复 | 011 | 活跃 |
| FR-021 | 选择性重跑：指定重跑某阶段，后续制品标记 `[STALE]` | 011 | 已更新（019 重跑不触发整组并行） |
| FR-022 | 子代理失败自动重试最多 2 次，仍失败则暂停交用户决策 | 011 | 活跃 |
| FR-023 | 每个阶段开始/完成时输出阶段级进度提示和关键产出摘要 | 011 | 已更新（018 跳过步骤标注 `[已跳过]`） |

### FR-GROUP-2: 调研与产研汇总

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-003 | 调研阶段：产品调研（Phase 1a）+ 技术调研（Phase 1b），full 模式下可并行执行 | 011, 019 | 已更新（019 改为并行，011 原为串行） |
| FR-004 | 调研阶段内部模块可并行执行（市场分析、竞品分析等） | 011 | 活跃 |
| FR-005 | 主编排器生成产研汇总 research-synthesis.md，含产品x技术交叉分析矩阵 | 011 | 已更新（019 作为并行汇合点执行） |

### FR-GROUP-3: 灵活调研路由（018 ENHANCEMENT）

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-R-001 | 6 种调研模式预设：full / tech-only / product-only / codebase-scan / skip / custom | 018 | 活跃 |
| FR-R-002 | 每种模式定义明确的输出制品集合（full 输出 3 份，tech-only 输出 1 份，skip 无输出等） | 018 | 活跃 |
| FR-R-003 | 编排器基于需求描述文本特征（关键词+启发式规则）智能推荐调研模式，展示推荐理由 | 018 | 活跃 |
| FR-R-004 | 展示推荐模式 + 所有可选模式列表，等待用户确认或选择替代 | 018 | 活跃 |
| FR-R-005 | spec-driver.config.yaml 支持 `research.default_mode` 和 `research.custom_steps` 配置 | 018 | 活跃 |
| FR-R-006 | `--research <mode>` 命令行参数直接指定调研模式，跳过推荐和交互 | 018 | 活跃 |
| FR-R-007 | 编排器根据实际调研模式动态调整后续阶段的上下文注入内容 | 018 | 活跃 |
| FR-R-008 | tech-research 子代理支持在无 product-research.md 输入时独立执行 | 018 | 活跃 |
| FR-R-009 | GATE_RESEARCH 行为根据调研模式动态调整（skip 模式跳过门禁） | 018 | 活跃 |
| FR-R-010 | 跳过的调研步骤在进度输出中标注 `[已跳过 - 调研模式: {mode}]`，保持编号可追溯 | 018 | 活跃 |
| FR-R-011 | `--rerun research` 重新进入调研模式选择流程（非直接重跑上次模式） | 018 | 活跃 |
| FR-R-012 | skip 模式下在 spec.md 头部记录跳过决策，确保可追溯 | 018 | 活跃 |
| FR-R-013 | GATE_DESIGN 在所有调研模式下保持启用，不因跳过调研而被间接绕过 | 018 | 活跃 |
| FR-R-014 | 完成报告动态列出实际生成的调研制品，跳过步骤标注 `[已跳过]` | 018 | 活跃 |

### FR-GROUP-4: 多模式支持

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-024 | story 快速模式：跳过调研，5 阶段完成（Constitution → 规范 → 规划+任务 → 实现 → 验证） | 011 | 活跃 |
| FR-025 | story 模式规范阶段自动读取现有代码和 spec 作为上下文 | 011 | 活跃 |
| FR-026 | story 模式人工介入 ≤ 2 次 | 011 | 活跃 |
| FR-027 | fix 快速模式：4 阶段（问题诊断 → 修复规划 → 代码修复 → 验证闭环） | 011 | 活跃 |
| FR-028 | fix 模式诊断阶段输出 fix-report.md（根因、影响范围、修复策略） | 011 | 活跃 |
| FR-029 | fix 模式人工介入 ≤ 1 次 | 011 | 活跃 |
| FR-030 | fix 完成后自动检查并更新受影响的 spec 文件 | 011 | 活跃 |
| FR-031 | story/fix 模式范围过大时（> 5 模块 / > 20 文件）建议切换 run 模式 | 011 | 活跃 |

### FR-GROUP-5: 验证铁律与双阶段审查（017 ENHANCEMENT）

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-V-001 | 实现子代理必须在当前执行上下文中实际运行验证命令，将输出作为完成的必要证据 | 017 | 活跃 |
| FR-V-002 | 拒绝不包含新鲜验证证据的完成声明（"should pass""looks correct"等推测性表述） | 017 | 活跃 |
| FR-V-003 | 验证子代理对验证证据进行二次核查——检查实际运行记录，非依赖自我声明 | 017 | 活跃 |
| FR-V-004 | 验证证据缺失时提供明确错误信息，说明缺少哪类验证（构建/测试/Lint） | 017 | 活跃 |
| FR-V-005 | 验证阶段拆分为 Spec 合规审查 + 代码质量审查两个独立阶段 | 017 | 活跃 |
| FR-V-006 | Spec 合规审查逐条检查 FR 状态：已实现/部分实现/未实现/过度实现 | 017 | 活跃 |
| FR-V-007 | 代码质量审查从设计模式、安全性、性能、可维护性四维度评估 | 017 | 活跃 |
| FR-V-008 | 两项审查各自输出独立结构化报告，问题按 CRITICAL/WARNING/INFO 分级 | 017 | 活跃 |
| FR-V-009 | 两项审查可并行执行以缩短总耗时 | 017, 019 | 活跃（019 实现并行调度） |

### FR-GROUP-6: 门禁粒度与设计硬门禁（017 ENHANCEMENT）

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-G-001 | 三级门禁策略：strict（全暂停）/ balanced（关键暂停）/ autonomous（仅失败暂停） | 017 | 活跃 |
| FR-G-002 | balanced 默认策略，未配置新字段时行为与当前版本一致（向后兼容） | 017 | 活跃 |
| FR-G-003 | 门禁级独立配置：`gates.{GATE_NAME}.pause: always/auto/on_failure`，优先于全局策略 | 017 | 活跃 |
| FR-G-004 | 每次门禁决策输出格式化日志：门禁名称、当前策略、决策结果、原因 | 017 | 活跃 |
| FR-G-005 | 设计门禁（GATE_DESIGN）在 feature 模式下不可绕过，无论策略和门禁级配置 | 017 | 活跃 |
| FR-G-006 | 设计门禁在 story/fix 模式下默认豁免 | 017 | 活跃 |
| FR-G-007 | 用户可通过配置覆盖 story/fix 模式的设计门禁豁免行为 | 017 | 活跃 |
| FR-G-008 | 配置文件新增字段向后兼容，无法识别的字段/值输出警告不阻断 | 017 | 活跃 |

### FR-GROUP-7: 并行子代理加速（019 ENHANCEMENT）

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-P-001 | 验证闭环并行：`parallel(spec-review, quality-review) → verify → GATE_VERIFY`，适用 Feature/Story/Fix 全模式 | 019 | 活跃 |
| FR-P-002 | 所有并行子代理完成后才执行门禁汇合检查，不提前触发 | 019 | 活跃 |
| FR-P-003 | Feature full 模式下 product-research 和 tech-research 并行启动，Phase 1c 作为汇合点 | 019 | 活跃 |
| FR-P-004 | 并行模式下 tech-research 以独立模式运行（不传入 product-research.md） | 019 | 活跃 |
| FR-P-005 | Feature 模式 Phase 3 中 clarify 和 checklist 并行委派，GATE_DESIGN 汇合 | 019 | 活跃 |
| FR-P-006 | 并行调度异常时自动回退到串行执行，输出回退日志 | 019 | 活跃 |
| FR-P-007 | 完成报告标注并行/串行执行状态 | 019 | 活跃 |
| FR-P-008 | 并行化仅修改 SKILL.md 编排 prompt，不修改子代理 prompt 或脚本 | 019 | 活跃 |
| FR-P-009 | 并行子代理中某个失败时不中断其他，等待全部完成后统一处理 | 019 | 活跃 |
| FR-P-010 | 门禁行为语义不变——仅触发时机从串行末尾变为并行汇合后 | 019 | 活跃 |
| FR-P-011 | `--rerun` 以单个子代理为粒度，不因属于并行组而触发整组重跑 | 019 | 活跃 |

### FR-GROUP-8: 验证闭环

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-008 | 验证子代理通过特征文件自动检测项目语言和构建系统 | 011 | 活跃 |
| FR-009 | 支持 12+ 种语言/构建系统验证 | 011 | 活跃 |
| FR-010 | Monorepo 支持：每个子项目独立验证并汇总报告 | 011 | 活跃 |
| FR-016 | 两层验证：Layer 1 Spec-Code 对齐 + Layer 2 项目原生工具链 | 011 | 已更新（017 将 Layer 1 演化为 spec-review + quality-review 双阶段） |
| FR-017 | 验证工具未安装时优雅降级（跳过 + 标记"未安装"） | 011 | 活跃 |
| FR-018 | 用户可通过 spec-driver.config.yaml 自定义构建/Lint/测试命令 | 011 | 活跃 |

### FR-GROUP-9: 模型分级配置

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-011 | 三种预设：balanced、quality-first、cost-efficient | 011 | 活跃 |
| FR-012 | spec-driver.config.yaml 自定义每个子代理模型 | 011 | 活跃 |
| FR-019 | 高信心歧义自动选择推荐项（≤ 2 处、有明确推荐时），标注 `[AUTO-RESOLVED]` | 011 | 活跃 |

### FR-GROUP-10: Plugin 架构与初始化

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-013 | 标准 Claude Code Plugin 发布：plugin.json + skills/ + agents/ + hooks/ + scripts/ + templates/ | 011, 014 | 活跃（014 更新元数据为 spec-driver v3.0.0） |
| FR-014 | 首次使用时自动初始化 .specify/ 目录 | 011 | 活跃 |
| FR-015 | 自包含全部子代理 prompt，检测到已有 speckit skills 时优先使用已有版本 | 011 | 活跃 |

### FR-GROUP-11: 产品规范聚合（sync）

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-S-001 | `speckit-sync` 命令触发独立的产品规范聚合流程 | 012, 013 | 活跃（013 拆分为独立 Skill） |
| FR-S-002 | 扫描 `specs/` 下所有 `NNN-*` 目录，读取 spec.md | 012 | 活跃 |
| FR-S-003 | 自动判定每个 spec 的产品归属，持久化到 product-mapping.yaml | 012 | 活跃 |
| FR-S-004 | 保留 product-mapping.yaml 用户手动编辑条目不被覆盖 | 012 | 活跃 |
| FR-S-005 | 按时间顺序和类型规则智能合并（INITIAL/FEATURE/FIX/REFACTOR/ENHANCEMENT） | 012 | 活跃 |
| FR-S-006 | 为每个产品生成 `specs/products/<product>/current-spec.md` | 012 | 活跃 |
| FR-S-007 | 活文档标注每个功能的来源 spec 和状态（活跃/已更新/已废弃） | 012 | 活跃 |
| FR-S-008 | 活文档包含变更历史索引，链接原始 spec 文件 | 012 | 活跃 |
| FR-S-009 | 聚合完成输出结构化报告（spec 数、产品数、功能统计） | 012 | 已更新（016 新增文档质量评估字段） |
| FR-S-010 | 聚合流程不修改原始 spec 文件（只读） | 012 | 活跃 |
| FR-S-011 | 聚合结果幂等——相同输入产生相同输出 | 012 | 活跃 |
| FR-S-012 | 产品文档模板扩展至 14 章节（含目标与成功指标、用户画像、非功能需求等） | 016 | 活跃 |
| FR-S-013 | sync 子代理 prompt 包含信息推断规则——从 User Stories 推断用户画像，从边界条件推断非功能需求等 | 016 | 活跃 |
| FR-S-014 | sync 子代理 prompt 包含内容质量标准——每章节最低内容要求（建议性，信息不足标注"待补充"） | 016 | 活跃 |
| FR-S-015 | 聚合完成报告新增文档质量评估——各章节填充状态（完整/部分/待补充） | 016 | 活跃 |

### FR-GROUP-12: 技能拆分架构（013 REFACTOR）

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-SK-001 | `skills/speckit-feature/SKILL.md`：独立的完整 10 阶段编排 + 初始化 + 重试 + 重跑 + 模型选择 | 013 | 活跃 |
| FR-SK-002 | `skills/speckit-resume/SKILL.md`：精简初始化 + 制品扫描 + 恢复执行 | 013 | 活跃 |
| FR-SK-003 | `skills/speckit-sync/SKILL.md`：独立的规范聚合流程 | 013 | 活跃 |
| FR-SK-004 | 每个 SKILL.md 正确配置 frontmatter：name/description/disable-model-invocation | 013, 014 | 活跃（014 更新 name 为 speckit-* 格式） |
| FR-SK-005 | run 技能含 `--rerun <phase>` 重跑功能，resume 不含 | 013 | 活跃 |
| FR-SK-006 | resume 无可恢复制品时提示用户使用 run | 013 | 活跃 |
| FR-SK-007 | sync 在 specs/ 空或不存在时给出明确提示 | 013 | 活跃 |
| FR-SK-008 | 三个技能完全独立，不依赖共享引用文件 | 013 | 活跃 |
| FR-SK-009 | 技能文件引用路径使用 `plugins/spec-driver/` 前缀 | 013, 014 | 活跃（014 从 speckitdriver 更新） |

### FR-GROUP-13: 命名体系（014 REFACTOR）

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-N-001 | plugin.json name 为 `spec-driver`，version 为 `3.0.0` | 014 | 活跃（[推断] 版本号已随功能迭代升至 v3.3.0） |
| FR-N-002 | 6 个 SKILL.md frontmatter name：speckit-feature/speckit-story/speckit-fix/speckit-resume/speckit-sync/speckit-doc | 014, 015 | 活跃（015 新增 speckit-doc） |
| FR-N-003 | 所有命令格式统一为 `/spec-driver:speckit-*` | 014 | 活跃 |
| FR-N-004 | 产品显示名统一为 `Spec Driver`（替代 Speckitdriver / Speckit Driver Pro） | 014 | 活跃 |
| FR-N-005 | 所有 agents/*.md 路径前缀为 `plugins/spec-driver/` | 014 | 活跃 |
| FR-N-006 | postinstall.sh 安装标记为 `.spec-driver-installed` | 014 | 活跃 |
| FR-N-007 | settings.json 注册名为 `spec-driver@cc-plugin-market` | 014 | 活跃 |
| FR-N-008 | README.md 包含迁移说明（旧命令→新命令映射表） | 014 | 活跃 |

### FR-GROUP-14: 开源文档生成（015 FEATURE）

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-D-001 | 生成 README.md 包含 ≥ 8 个标准章节（标题/Badge、描述、功能特性、安装、使用示例、项目结构、技术栈、测试、贡献、License） | 015 | 活跃 |
| FR-D-002 | README.md 中生成 shields.io 格式 Badge（至少 License Badge） | 015 | 活跃 |
| FR-D-003 | 自动提取项目元信息（package.json、git config、目录结构），降级策略处理缺失字段 | 015 | 活跃 |
| FR-D-004 | AST 分析增强 README 功能特性章节（支持 TS/JS，超时降级） | 015 | 活跃 |
| FR-D-005 | 8 种开源协议选项（MIT、Apache-2.0、GPL-3.0 等），静态 SPDX 模板生成 LICENSE | 015 | 活跃 |
| FR-D-006 | 两种文档模式：精简（README + LICENSE）/ 完整（+ CONTRIBUTING + CODE_OF_CONDUCT） | 015 | 活跃 |
| FR-D-007 | CONTRIBUTING.md 含开发环境搭建、代码规范、提交规范、PR 流程四章节，从 package.json scripts 提取实际命令 | 015 | 活跃 |
| FR-D-008 | CODE_OF_CONDUCT.md 基于 Contributor Covenant v2.1，自动填充联系方式 | 015 | 活跃 |
| FR-D-009 | 交互流程编排：元信息提取 → 模式选择 → 协议选择 → 批量生成 → 逐文件冲突检测 | 015 | 活跃 |
| FR-D-010 | 文件安全：已存在文件展示 diff 预览，覆盖前自动备份为 .bak | 015 | 活跃 |
| FR-D-011 | README.md 预埋 HTML 注释标记，为二期 `--update` 预留锚点 | 015 | 活跃 |
| FR-D-012 | 生成文档默认使用英文（开源社区国际化惯例） | 015 | 活跃 |

### FR-GROUP-15: 横切关注点

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-032 | 命令名称统一为 `spec-driver:speckit-*` 格式 | 011, 014 | 活跃（014 完成最终命名） |
| FR-C-001 | 所有生成制品遵循中文正文 + 英文代码标识符规范（speckit-doc 除外，默认英文） | 011, 015 | 活跃 |
| FR-C-002 | sync 子代理始终使用 Opus 模型（聚合分析需要深度推理） | 012 | 活跃 |
| FR-C-003 | 配置文件新增不超过 3 个顶层字段，保持配置简洁性 | 017 | 活跃 |
| FR-C-004 | 所有新增能力零运行时依赖，在现有架构内实现 | 017, 019 | 活跃 |

---

## 6. 非功能需求

### 性能

| 需求 | 目标 | 来源 |
|------|------|------|
| Plugin 自身脚本执行 | < 5 秒 | 011 |
| 全流程耗时 | 取决于 LLM API 延迟 | 011 |
| sync 技能上下文加载 | 约 120 行（原 706 行） | 013 |
| run 技能上下文加载 | 约 350 行 | 013 |
| resume 技能上下文加载 | 约 150 行 | 013 |
| 验证闭环并行加速 | 耗时减少 ≥ 30%（对比串行） | 019 |
| 调研阶段并行加速（full 模式） | 耗时减少 ≥ 40%（对比串行） | 019 |
| skip 调研模式耗时 | 调研阶段耗时降为 0 | 018 |
| speckit-doc 端到端时间 | ≤ 3 分钟（含交互） | 015 |

### SKILL.md 规模约束

| 需求 | 目标 | 来源 |
|------|------|------|
| 每个 SKILL.md 行数上限 | ≤ 400 行（SHOULD） | NFR-001 (013) |
| 官方建议词数 | 1,500–2,000 words | NFR-001 (013) |

### 可靠性

- 子代理失败自动重试最多 2 次，超限交用户决策（011）
- 制品持久化到文件系统，支持中断后恢复（011）
- Web 搜索失败时降级为本地代码库分析模式（011）
- Monorepo 某子项目验证失败不阻断其他子项目（011）
- sync 聚合结果幂等（012）
- 并行调度失败时自动回退到串行执行，100% 回退成功率（019）
- 验证命令超时或异常退出标记为"执行异常"，不作为通过依据（017）

### 兼容性

- 平台：macOS、Linux、Windows WSL
- Claude Code：支持 Plugin、Skill、Task tool 协议
- 模型：Anthropic Claude Sonnet 和 Opus
- 目标项目语言：12+ 种语言/构建系统
- 配置向后兼容：未配置新字段时所有行为与升级前一致（017, 018）
- 调研模式向后兼容：无 `research` 配置段时默认 full 模式（018）

### 可用性

- 阶段级进度提示（`[N/10] 正在执行...`），完成时输出关键产出摘要（011）
- 跳过的步骤显示 `[已跳过 - 调研模式: {mode}]`，保持编号可追溯（018）
- 6 个命令在 `/spec-driver:` 补全菜单中独立可见，各附语义描述（013, 015）
- 门禁决策输出格式化日志：门禁名称、策略、结果、原因（017）
- 约定优于配置——单字段切换即可完成门禁策略变更（017）
- speckit-doc 先交互后生成模式——收集所有用户选择后再统一生成文件（015）

---

## 7. 当前技术架构

### 技术栈（v3.3.0 纯声明式架构）

- **Bash 5.x** — 安装脚本（postinstall.sh、init-project.sh）
- **Markdown** — 主编排器 prompt（SKILL.md x6）、子代理 prompt（agents/*.md x14）
- **YAML** — 配置文件（spec-driver.config.yaml、plugin.json）
- **无运行时依赖**：Plugin 完全由 Markdown prompt + Bash 脚本 + YAML 配置构成，运行在 Claude Code 沙箱中

### 项目结构

```text
plugins/spec-driver/                    # Plugin 根目录（014 从 speckitdriver 重命名）
├── .claude-plugin/
│   └── plugin.json                     # Plugin 元数据（name: spec-driver, version: 3.3.0）
├── hooks/
│   └── hooks.json                      # SessionStart hook
├── scripts/
│   ├── postinstall.sh                  # 安装后初始化（标记: .spec-driver-installed）
│   └── init-project.sh                 # 项目级 .specify/ 初始化
├── skills/                             # 6 个独立 Skill（013 拆分 + 015 新增）
│   ├── speckit-feature/SKILL.md        # 完整 10 阶段编排（约 350 行，含并行调度指令）
│   ├── speckit-story/SKILL.md          # story 快速需求（含验证闭环并行）
│   ├── speckit-fix/SKILL.md            # fix 快速修复（含验证闭环并行）
│   ├── speckit-resume/SKILL.md         # 中断恢复（约 150 行）
│   ├── speckit-sync/SKILL.md           # 产品规范聚合（约 120 行）
│   └── speckit-doc/SKILL.md            # 开源文档生成（015 新增）
├── agents/                             # 14 个子代理 prompt
│   ├── constitution.md                 # Phase 0: 宪法检查
│   ├── product-research.md             # Phase 1a: 产品调研（可与 tech-research 并行）
│   ├── tech-research.md                # Phase 1b: 技术调研（支持独立执行模式）
│   ├── specify.md                      # Phase 2: 需求规范
│   ├── clarify.md                      # Phase 3: 需求澄清（可与 checklist 并行）
│   ├── checklist.md                    # Phase 3.5: 质量检查表（可与 clarify 并行）
│   ├── plan.md                         # Phase 4: 技术规划
│   ├── tasks.md                        # Phase 5: 任务分解
│   ├── analyze.md                      # Phase 5.5: 一致性分析
│   ├── implement.md                    # Phase 6: 代码实现（含验证铁律约束）
│   ├── spec-review.md                  # Phase 7a: Spec 合规审查（017 新增）
│   ├── quality-review.md               # Phase 7b: 代码质量审查（017 新增）
│   ├── verify.md                       # Phase 7c: 工具链验证（Layer 2 保留）
│   └── sync.md                         # 产品规范聚合子代理
├── templates/
│   ├── product-research-template.md    # 产品调研报告模板
│   ├── tech-research-template.md       # 技术调研报告模板
│   ├── research-synthesis-template.md  # 产研汇总模板
│   ├── verification-report-template.md # 验证报告模板
│   ├── product-spec-template.md        # 产品活文档模板（14 章节，016 扩展）
│   └── spec-driver.config-template.yaml     # 驱动配置模板（含 gate_policy、gates、research 段）
└── README.md                           # Plugin 说明（含迁移指引）
```

### 编排流程架构

```text
用户输入需求
  → 主编排器（SKILL.md "研发总监"）
    → 编排器智能推荐调研模式（018: 关键词+启发式）
      → 用户确认/覆盖调研模式
    → Task tool 委派子代理（agents/*.md）
      → 可并行委派（019: RESEARCH_GROUP / DESIGN_PREP_GROUP / VERIFY_GROUP）
      → 子代理读取模板（templates/*.md）
        → 子代理输出制品到 specs/[feature]/
    → 主编排器检查质量门（5 道，017 增强）
      → 门禁策略判定（strict/balanced/autonomous）
      → 设计门禁: 硬门禁，feature 模式不可跳过
      → 通过: 自动推进下一阶段
      → 阻断: 暂停征询用户
    → 验证闭环（017 双阶段 + 019 并行）
      → parallel(spec-review, quality-review) → verify → GATE_VERIFY
    → 循环直至验证闭环完成
    → 并行调度失败 → 自动回退串行模式（019 安全网）
```

### 模型配置策略

| 预设 | 重分析任务（调研/规范/规划/分析） | 执行任务（澄清/清单/任务/实现/验证） |
|------|--------------------------------|----------------------------------|
| **balanced**（默认） | Opus | Sonnet |
| **quality-first** | Opus | Opus |
| **cost-efficient** | Sonnet | Sonnet |

### spec-driver.config.yaml 配置结构（v3.3.0）

```yaml
# 模型预设
model_preset: balanced        # balanced / quality-first / cost-efficient

# 门禁策略（017 新增）
gate_policy: balanced          # strict / balanced / autonomous
gates:                         # 门禁级独立配置（可选）
  GATE_RESEARCH:
    pause: auto                # always / auto / on_failure
  GATE_DESIGN:
    pause: always              # feature 模式下忽略此配置（硬门禁）
  GATE_ANALYSIS:
    pause: on_failure
  GATE_TASKS:
    pause: always
  GATE_VERIFY:
    pause: always

# 调研路由（018 新增）
research:
  default_mode: auto           # auto / full / tech-only / product-only / codebase-scan / skip
  custom_steps: []             # 仅 default_mode: custom 时生效

# 自定义命令
custom_commands:
  build: ""
  test: ""
  lint: ""
```

> 关键设计决策已迁移至【设计原则与决策记录】章节，详见下方。

---

## 8. 设计原则与决策记录

### Constitution 适用性评估

Spec Driver 作为正向研发编排器，与 reverse-spec（逆向分析工具）遵循不同的约束。

| # | reverse-spec 原则 | Spec Driver 适用性 | 说明 |
|---|-------------------|-------------------|------|
| I | AST 精确性优先 | 不直接适用 | 编排器不执行 AST 分析，委派给子代理 |
| II | 混合分析流水线 | 不直接适用 | 编排器使用 Web 搜索 + 代码分析的不同范式 |
| III | 诚实标注不确定性 | 适用 | 调研输出用 `[推断]`/`[INFERRED]` 标记 |
| IV | 只读安全性 | **豁免** | 正向研发工具写入源代码是核心功能 |
| V | 纯 Node.js 生态 | 部分适用 | Plugin 零运行时依赖；verify 调用用户工具链不算新依赖 |
| VI | 双语文档规范 | 适用 | 所有制品遵循中文正文 + 英文标识符（speckit-doc 默认英文除外） |

### Spec Driver 自有原则

| # | 原则 | 说明 |
|---|------|------|
| I | **自治优先，关键暂停** | 默认自动推进，仅质量门失败时暂停；三级策略控制暂停粒度（017） |
| II | **调研驱动规范** | 规范编写前可选择性完成产品+技术调研，调研深度按需裁剪（018） |
| III | **制品持久化** | 每阶段产出即时持久化，支持中断恢复 |
| IV | **零运行时依赖** | Plugin 纯声明式，运行在 Claude Code 沙箱 |
| V | **模式适配复杂度** | feature/story/fix/doc 四种模式匹配不同复杂度需求 |
| VI | **命令可发现性** | 独立技能 + 语义描述，通过 `/` 菜单渐进发现 |
| VII | **验证铁律** | 拒绝推测性完成声明，必须提供新鲜验证证据（017） |
| VIII | **设计先于实现** | 设计门禁在 feature 模式下不可绕过，确保方向正确后再动手（017） |
| IX | **约定优于配置** | 合理默认值开箱即用，高级用户可逐项精细配置（017） |
| X | **并行加速，串行兜底** | 可并行的子代理并行执行，调度失败自动回退串行（019） |

### 关键决策记录

| 决策 | 选择 | 被拒绝方案 | 理由 | 来源 |
|------|------|-----------|------|------|
| Plugin 架构 | 纯声明式（Markdown + YAML + Bash） | Node.js 运行时 | 零运行时依赖，完全在 Claude Code 沙箱运行 | 011 |
| 子代理委派 | Claude Code Task tool | 直接 API 调用 | 利用平台内置能力，无需自建通信层 | 011 |
| 调研流程 | 产品+技术可并行 | 产品→技术强制串行 | tech-only 模式已证明技术调研可独立执行，并行不降质（019 更新） | 011, 019 |
| 产研汇总 | 主编排器亲自执行 | 委派子代理 | 交叉分析需要全局视角 | 011 |
| 技能拆分 | 完全独立（方案 A） | 共享模块（_shared/） | 降低耦合，共享归入二期 | 013 |
| 命名体系 | spec-driver + speckit-* | 保留 speckitdriver | 语义清晰，Plugin 名和技能前缀分离 | 014 |
| 旧技能迁移 | Strangler Fig 模式 | Big-bang 替换 | 降低回滚风险 | 013 |
| sync 聚合模型 | 始终 Opus | 按预设配置 | 聚合分析需要深度推理 | 012 |
| sync 模板结构 | 14 章节完整结构 | 7 章节精简结构 | 行业标准 PRD 结构，支撑单一信息源定位 | 016 |
| 验证铁律实现层 | Prompt 层优先（MVP 第一批） | Hooks 层 | Prompt 层可独立交付价值且零新增依赖 | 017 |
| 双阶段审查定位 | 现有 verify 阶段内部重构 | 替换 verify | 最小化对现有流程的破坏，Layer 2 工具链验证保留 | 017 |
| 门禁配置结构 | 2 个新增顶层字段（gate_policy + gates） | 嵌套在现有字段中 | 满足 ≤ 3 个新增字段约束，结构清晰 | 017 |
| 设计门禁豁免 | Feature 启用 / Story+Fix 豁免 | 全模式统一启用 | Story/Fix 面向小范围增量，暂停打断与设计初衷矛盾 | 017 |
| 调研路由方案 | 6 种预设 + 智能推荐 + 命令行覆盖 | 固定流水线 | 按需裁剪调研深度，避免小需求浪费 Token | 018 |
| 智能推荐实现 | 关键词 + 启发式规则 | 额外 LLM 调用 | 与 Bash/Markdown Plugin 技术栈一致，零额外成本 | 018 |
| 并行化范围 | 仅修改 SKILL.md | 修改子代理 prompt | 最小化变更范围，子代理无需感知并行 | 019 |
| 验证并行方案 | parallel(spec-review, quality-review) → verify 串行 | 三者完全并行 | verify 需读取前两者报告，完全并行降低检查深度 | 019 |
| 并行回退机制 | 编排器 LLM 语义判断 | 程序化错误分类 | Task tool 不提供可编程区分接口，Prompt 层指令与现有重试互补 | 019 |

---

## 9. 已知限制与技术债

### 已知限制

| 来源 | 类别 | 描述 | 状态 |
|------|------|------|------|
| 011 | 限制 | 全流程耗时取决于 LLM API 延迟，无法精确预估 | 设计约束 |
| 011 | 限制 | 验证阶段依赖用户已安装的工具链，未安装则跳过 | 设计约束 |
| 012 | 限制 | 每个 spec 属于且仅属于一个产品（不支持跨产品 spec） | 设计约束 |
| 012 | 限制 | 自动归属判定可能对关联性不明显的 FIX 类 spec 误判 | 未解决 |
| 013 | 限制 | 三个技能完全独立拆分，存在少量逻辑重复（如初始化） | 设计决策（共享归入二期） |
| 015 | 限制 | speckit-doc 仅最佳支持 Node.js（TS/JS）项目，非 Node.js 项目降级为有限元信息 | 设计约束 |
| 015 | 限制 | MVP 阶段文件冲突处理为逐文件询问，不提供批量选项 | 设计决策 |
| 017 | 限制 | 验证铁律 MVP 仅 Prompt 层实现，依赖 LLM 遵循约束，无程序化强制 | 设计决策（Hooks 层归入 MVP 第二批） |
| 017 | 限制 | 并行调度失败检测依赖 LLM 语义判断，非精确的程序化错误分类 | 设计约束（Task tool 限制） |
| 018 | 限制 | 智能推荐基于关键词启发式规则，复杂语义场景可能推荐不准确 | 设计约束 |
| 019 | 限制 | 并行化后 tech-research 不再接收 product-research.md 输入（full 模式下），综合质量依赖 synthesis 阶段弥补 | 设计决策 |
| [推断] | 限制 | story/fix 模式的 SKILL.md 行数和具体内容结构未在 spec 中详细定义 | 待补充 |

### 技术债

| 来源 | 描述 | 风险 |
|------|------|------|
| 013 | 共享模块（_shared/）推迟到二期，技能间存在冗余的初始化逻辑和配置加载逻辑 | 低 |
| 014 | 旧名称 `.speckitdriver-installed` 标记文件可能残留在已安装用户的环境中 | 低 |
| 017 | 验证铁律 Hooks 层（PreToolUse/PostToolUse + verification-evidence.json）推迟到 MVP 第二批 | 中 |
| [推断] | Plugin 无自动版本更新机制，v2.0.0→v3.3.0 需手动重装 | 中 |

---

## 10. 假设与风险

### 关键假设

| 假设 | 来源 | 风险等级 |
|------|------|---------|
| 用户已安装 Claude Code 并拥有 API 访问权限（Sonnet + Opus） | 011 | 低 |
| 项目已初始化 Git 仓库 | 011 | 低 |
| Claude Code Task tool 支持子代理委派和模型指定 | 011 | 中 |
| Claude Code Task tool 支持并行（或 run_in_background）方式启动多个子代理 | 019 | 中 |
| Web 搜索工具（WebSearch / Perplexity MCP）可用于调研 | 011 | 低 |
| 用户理解 Spec-Driven Development 基本概念 | 011 | 低 |
| 增量 spec 编号反映时间顺序（编号大 = 更新） | 012 | 低 |
| Claude Code Plugin 系统支持 skills/ 自动发现 | 013 | 低 |
| Claude Code `/` 补全菜单展示所有已注册 Skill 的 name 和 description | 013 | 低 |
| LLM 能可靠遵循 Prompt 层植入的验证铁律约束 | 017 | 中 |
| 关键词+启发式规则足以覆盖大多数调研模式推荐场景 | 018 | 低 |

### 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Claude Code Task tool API 变更 | 低 | 高 | Plugin 纯声明式，适配变更成本低 |
| LLM API 频繁超时/不可用 | 中 | 中 | 自动重试 + 中断恢复机制 |
| 调研阶段 Web 搜索不可用 | 低 | 低 | 降级为本地代码库分析；可使用 skip/codebase-scan 模式（018） |
| 用户混淆新旧命令格式 | 低 | 低 | README 迁移说明 + 旧命令完全删除 |
| 技能拆分后逻辑不一致 | 低 | 中 | 完全独立拆分（无共享依赖） |
| Opus 模型成本过高导致用户流失 | 中 | 中 | 三种预设（cost-efficient 可全用 Sonnet）；skip 调研模式减少 Token 消耗（018） |
| 配置复杂度膨胀阻碍用户采纳 | 中 | 中 | 约定优于配置——单字段切换门禁策略，零配置开箱体验（017） |
| AI 未验证就声称完成 | 高 | 高 | 验证铁律 + 双阶段审查 + 验证证据二次核查（017） |
| Story 模式体验因门禁退化 | 中 | 中 | 设计门禁在 story/fix 模式下默认豁免（017） |
| 并行调度失败导致流程中断 | 低 | 高 | 串行回退安全网，100% 回退成功率（019） |
| Rate limit 限制并行子代理数 | 中 | 低 | 编排器检测 rate limit 自动降级为串行（019） |

---

## 11. 被废弃的功能

| 功能 | 原始描述 | 取代者 | 原因 |
|------|---------|--------|------|
| 单体 `speckitdriver` 技能 | 011 初始设计为单一 SKILL.md（706 行） | 013: 6 个独立技能 | 单体文件上下文预算浪费，命令不可发现 |
| `--resume` 参数 | 011 初始设计为 run 命令的参数 | 013: 独立 `speckit-resume` 命令 | 提升可发现性，无需记忆参数语法 |
| `--sync` 参数 | 012 设计为命令参数 | 013: 独立 `speckit-sync` 命令 | 最轻量操作应独立，降低上下文加载 |
| `speckitdriver` Plugin 名 | 011/012/013 使用的 Plugin 名称 | 014: `spec-driver` | 语义更清晰，Plugin 名与技能前缀分离 |
| `/speckitdriver:run` 命令格式 | 013 拆分后的命令格式 | 014: `/spec-driver:speckit-feature` | 统一 speckit-* 前缀，语义一致 |
| `/speckitdriver:story` 命令 | 013 拆分后的 story 命令 | 014: `/spec-driver:speckit-story` | 同上 |
| `/speckitdriver:fix` 命令 | 013 拆分后的 fix 命令 | 014: `/spec-driver:speckit-fix` | 同上 |
| `/speckitdriver:resume` 命令 | 013 拆分后的 resume 命令 | 014: `/spec-driver:speckit-resume` | 同上 |
| `/speckitdriver:sync` 命令 | 013 拆分后的 sync 命令 | 014: `/spec-driver:speckit-sync` | 同上 |
| `Speckit Driver Pro` 产品名 | 011 初始产品显示名 | 014: `Spec Driver` | 简化命名，去除 Pro 后缀 |
| `speckit-driver-pro` Plugin 注册名 | 011 初始 Plugin 注册名 | 014: `spec-driver`（经 `speckitdriver` 中间态） | 两次重命名最终定为 spec-driver |
| `skills/speckit-driver-pro/` 目录 | 011 初始技能目录 | 013: 6 个独立技能目录 | 单体目录被删除，拆分为 6 个 |
| 7 章节产品文档模板 | 012 初始模板仅含 7 章节 | 016: 14 章节完整模板 | 缺少行业标准章节（目标、用户、非功能需求等） |
| 产品调研→技术调研强制串行 | 011 初始设计 tech-research 依赖 product-research.md | 019: 并行启动 + synthesis 汇合 | tech-only 模式已证明技术调研可独立执行 |
| 子代理间全串行委派 | 011 初始设计（调研阶段内部模块除外） | 019: 3 个并行组 | 验证闭环、调研、clarify+checklist 均可并行 |
| 固定 full 调研流水线 | 011 初始设计所有 Feature 模式执行全套调研 | 018: 6 种调研模式 + 智能推荐 | 小需求无需全套调研，浪费 Token 和时间 |

---

## 12. 变更历史

| # | Spec ID | 类型 | 日期 | 摘要 |
|---|---------|------|------|------|
| 1 | [011-speckit-driver-pro](../../011-speckit-driver-pro/spec.md) | INITIAL | 2026-02-15 | 核心能力建立：10 阶段自治编排、12 个子代理、4 道质量门、story/fix 快速模式、模型分级、多语言验证 |
| 2 | [012-product-spec-sync](../../012-product-spec-sync/spec.md) | FEATURE | 2026-02-15 | 新增产品规范聚合（--sync）：增量 spec 智能合并、产品归属判定、product-mapping.yaml |
| 3 | [013-split-skill-commands](../../013-split-skill-commands/spec.md) | REFACTOR | 2026-02-15 | 拆分单体技能为 run/resume/sync 三个独立命令，优化上下文预算和命令可发现性 |
| 4 | [014-rename-spec-driver](../../014-rename-spec-driver/spec.md) | REFACTOR | 2026-02-15 | 重命名 speckitdriver → spec-driver v3.0.0，技能统一 speckit-* 前缀，110+ 处引用全量更新 |
| 5 | [015-speckit-doc-command](../../015-speckit-doc-command/spec.md) | FEATURE | 2026-02-15 | 新增 speckit-doc 命令：开源文档一键生成（README/LICENSE/CONTRIBUTING/CODE_OF_CONDUCT），交互式协议选择 |
| 6 | [016-optimize-sync-product-doc](../../016-optimize-sync-product-doc/spec.md) | ENHANCEMENT | 2026-02-15 | 优化 sync 产品文档：模板扩展至 14 章节，新增推断规则与质量门控 |
| 7 | [017-adopt-superpowers-patterns](../../017-adopt-superpowers-patterns/spec.md) | ENHANCEMENT | 2026-02-27 | 借鉴 Superpowers 行为约束模式：验证铁律、三级门禁策略、双阶段代码审查、设计硬门禁 |
| 8 | [018-flexible-research-routing](../../018-flexible-research-routing/spec.md) | ENHANCEMENT | 2026-02-27 | Feature 模式灵活调研路由：6 种调研模式预设、智能推荐、命令行参数覆盖 |
| 9 | [019-parallel-subagent-speedup](../../019-parallel-subagent-speedup/spec.md) | ENHANCEMENT | 2026-02-27 | 并行子代理加速：验证闭环三并行、调研并行、clarify+checklist 并行、串行回退安全网 |

---

## 13. 术语表

| 术语 | 定义 |
|------|------|
| **主编排器 (Orchestrator)** | SKILL.md 中定义的"研发总监"角色，负责全局决策、质量把控、人机交互管理，通过 Task tool 委派子代理 |
| **子代理 (Sub-Agent)** | agents/ 目录下的 14 个专门化 Markdown prompt，分别负责 constitution/research/specify/clarify/checklist/plan/tasks/analyze/implement/spec-review/quality-review/verify/sync |
| **研发制品 (Artifact)** | 流程中产出的结构化文档：product-research.md、tech-research.md、research-synthesis.md、spec.md、plan.md、tasks.md、verification-report.md 等 |
| **质量门 (Quality Gate)** | 5 道检查点——GATE_RESEARCH（调研门）、GATE_DESIGN（设计硬门禁）、GATE_ANALYSIS（分析门）、GATE_TASKS（任务门）、GATE_VERIFY（验证门），行为由门禁策略和门禁级配置控制（017） |
| **门禁策略 (Gate Policy)** | 控制所有质量门行为的全局配置，取值 strict（全暂停）/ balanced（关键暂停）/ autonomous（仅失败暂停），默认 balanced（017） |
| **设计硬门禁 (Design Hard Gate)** | GATE_DESIGN 在 feature 模式下不可绕过的特殊门禁，无论策略配置均暂停等待用户批准设计方案（017） |
| **验证铁律 (Verification Iron Rule)** | 要求实现子代理在声称完成前必须提供新鲜验证证据（实际运行的命令输出），拒绝推测性声明（017） |
| **验证证据 (Verification Evidence)** | 子代理在当前执行上下文中实际运行验证命令后产生的输出记录，包含命令名称、执行时间、退出状态。"新鲜"指在当前任务的当前迭代中产生（017） |
| **Spec 合规审查 (Spec Compliance Review)** | 双阶段审查的第一阶段，逐条检查 FR 实现状态（已实现/部分实现/未实现/过度实现），由 spec-review.md 子代理执行（017） |
| **代码质量审查 (Code Quality Review)** | 双阶段审查的第二阶段，从设计模式、安全性、性能、可维护性四维度评估，由 quality-review.md 子代理执行（017） |
| **调研模式 (Research Mode)** | Feature 模式中调研阶段执行哪些步骤的配置值，6 种预设：full/tech-only/product-only/codebase-scan/skip/custom。确定优先级：命令行 > 配置文件 > 智能推荐（018） |
| **调研推荐 (Research Recommendation)** | 编排器基于需求描述文本特征（关键词+启发式规则）生成的推荐信息，包含推荐模式、理由、替代列表（018） |
| **并行组 (Parallel Group)** | 一组可同时启动的子代理 Task，共享一个汇合点。3 个并行组：VERIFY_GROUP（spec-review + quality-review）、RESEARCH_GROUP（product-research + tech-research）、DESIGN_PREP_GROUP（clarify + checklist）（019） |
| **汇合点 (Join Point)** | 并行组中所有子代理完成后的检查点，通常对应质量门禁或编排器亲自执行的步骤（019） |
| **串行回退 (Serial Fallback)** | 并行调度失败时自动切换到串行执行模式的安全机制（019） |
| **驱动配置 (Driver Config)** | spec-driver.config.yaml 文件，存储模型预设、门禁策略、调研路由、自定义命令等用户偏好 |
| **产品映射 (Product Mapping)** | product-mapping.yaml 文件，记录每个增量 spec 的产品归属，支持手动覆盖 |
| **产品活文档 (Product Living Spec)** | specs/products/<product>/current-spec.md，通过聚合增量 spec 反映产品完整现状的 14 章节活文档 |
| **speckit-feature** | 完整 10 阶段研发编排命令，支持灵活调研路由和并行子代理 |
| **speckit-story** | 5 阶段快速需求实现命令（跳过调研，设计门禁默认豁免） |
| **speckit-fix** | 4 阶段快速修复命令（诊断→修复→验证，设计门禁默认豁免） |
| **speckit-resume** | 中断恢复命令（扫描制品→恢复执行） |
| **speckit-sync** | 产品规范聚合命令（增量 spec → 14 章节活文档） |
| **speckit-doc** | 开源文档生成命令（交互式协议选择 + README/LICENSE/CONTRIBUTING/CODE_OF_CONDUCT）（015） |
| **Strangler Fig 模式** | 迁移策略——先创建新技能并验证，再删除旧技能，避免 big-bang 风险 |
| **STALE 标记** | 选择性重跑后对下游制品添加的 `[STALE: 上游阶段已重跑]` 标记 |
| **Phase** | 编排流程中的一个阶段（如 Phase 1a: 产品调研、Phase 7: 验证闭环） |
| **AUTO-RESOLVED** | 高信心歧义由系统自动选择推荐项时的标注 |
| **disable-model-invocation** | SKILL.md frontmatter 配置项，控制 Claude 是否可基于对话内容自动加载该技能 |

---

## 14. 附录：增量 spec 索引

| # | Spec ID | 类型 | 文件路径 |
|---|---------|------|---------|
| 1 | 011-speckit-driver-pro | INITIAL | [specs/011-speckit-driver-pro/spec.md](../../011-speckit-driver-pro/spec.md) |
| 2 | 012-product-spec-sync | FEATURE | [specs/012-product-spec-sync/spec.md](../../012-product-spec-sync/spec.md) |
| 3 | 013-split-skill-commands | REFACTOR | [specs/013-split-skill-commands/spec.md](../../013-split-skill-commands/spec.md) |
| 4 | 014-rename-spec-driver | REFACTOR | [specs/014-rename-spec-driver/spec.md](../../014-rename-spec-driver/spec.md) |
| 5 | 015-speckit-doc-command | FEATURE | [specs/015-speckit-doc-command/spec.md](../../015-speckit-doc-command/spec.md) |
| 6 | 016-optimize-sync-product-doc | ENHANCEMENT | [specs/016-optimize-sync-product-doc/spec.md](../../016-optimize-sync-product-doc/spec.md) |
| 7 | 017-adopt-superpowers-patterns | ENHANCEMENT | [specs/017-adopt-superpowers-patterns/spec.md](../../017-adopt-superpowers-patterns/spec.md) |
| 8 | 018-flexible-research-routing | ENHANCEMENT | [specs/018-flexible-research-routing/spec.md](../../018-flexible-research-routing/spec.md) |
| 9 | 019-parallel-subagent-speedup | ENHANCEMENT | [specs/019-parallel-subagent-speedup/spec.md](../../019-parallel-subagent-speedup/spec.md) |
