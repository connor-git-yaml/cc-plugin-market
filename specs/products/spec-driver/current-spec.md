# Spec Driver — 产品规范活文档

> **产品**: spec-driver
> **版本**: 聚合自 4 个增量 spec（011–014）
> **最后聚合**: 2026-02-15
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

Spec Driver 是一个 **自治研发编排器 Claude Code Plugin**（v3.0.0），将 Spec-Driven Development (SDD) 的完整研发流程——从调研到规范到规划到实现到验证——统一编排为单一命令触发的自动化流水线。

**核心定位**：面向采用 Spec-Driven Development 方法论的开发团队，提供"一句需求描述 → 完整功能交付"的自治编排能力，将原本需要 9+ 次手动 Skill 调用的流程压缩为 1 次触发。

**核心价值**：

- **自治编排**：10 阶段全流程自动推进，仅在 ≤ 4 个关键决策点暂停征询用户意见
- **调研驱动**：在规范编写之前，自动进行产品调研（市场、竞品、用户场景）和技术调研（架构选型、依赖评估），输出产研交叉分析
- **多模式支持**：完整流程（speckit-feature）、快速需求（speckit-story）、快速修复（speckit-fix）、中断恢复（speckit-resume）、规范聚合（speckit-sync）五种模式
- **质量门控**：4 道自动化质量检查点（澄清门、宪法门、分析门、验证门），CRITICAL 问题自动阻断
- **多语言验证**：支持 12+ 种语言/构建系统的自动检测和验证闭环
- **产品规范聚合**：将增量功能 spec 智能合并为产品级活文档

**分发方式**：

- **Claude Code Plugin Marketplace**：通过 `claude plugin install spec-driver` 安装，Plugin 名 `spec-driver`
- **5 个独立 Skill 命令**：`/spec-driver:speckit-feature`、`/spec-driver:speckit-story`、`/spec-driver:speckit-fix`、`/spec-driver:speckit-resume`、`/spec-driver:speckit-sync`

---

## 2. 目标与成功指标

### 产品愿景

让 AI 驱动的研发流程具备自治编排能力——开发者用一句话描述需求，系统自主完成从调研到验证的全流程，在关键决策点智能暂停征询意见，最终交付经过验证的完整功能实现。

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

---

## 3. 用户画像与场景

### 用户角色

| 角色 | 描述 | 主要使用场景 |
|------|------|------------|
| **全栈开发者** | 需要端到端实现新功能 | `/spec-driver:speckit-feature <需求>` 启动完整研发流程 |
| **迭代开发者** | 有明确需求变更，不需要深度调研 | `/spec-driver:speckit-story <需求>` 快速需求通道 |
| **Bug 修复者** | 发现 bug 需要快速定位和修复 | `/spec-driver:speckit-fix <问题>` 快速修复 |
| **技术主管** | 需要产品全景文档，新成员 onboarding | `/spec-driver:speckit-sync` 产品规范聚合 |
| **流程恢复者** | 流程中断后需要继续 | `/spec-driver:speckit-resume` 恢复编排 |
| **新团队成员** | 通过 `/` 补全菜单发现可用功能 | 浏览 5 个独立命令及语义描述 |

### 核心使用场景

1. **完整研发流程（speckit-feature）**：开发者输入一句需求描述，系统自动执行 10 阶段编排（Constitution 检查 → 产品调研 → 技术调研 → 产研汇总 → 需求规范 → 需求澄清 → 质量检查 → 技术规划 → 任务分解 → 一致性分析 → 代码实现 → 验证闭环），全程 ≤ 4 次人工介入
2. **快速需求实现（speckit-story）**：跳过调研阶段，基于现有代码和 spec 分析直接进入 5 阶段快速通道（Constitution → 规范 → 规划+任务 → 实现 → 验证），人工介入 ≤ 2 次
3. **快速 Bug 修复（speckit-fix）**：4 阶段最短路径（问题诊断 → 修复规划 → 代码修复 → 验证闭环），输出 fix-report.md，人工介入 ≤ 1 次
4. **中断恢复（speckit-resume）**：扫描已有制品文件判断进度，从断点恢复编排流程
5. **产品规范聚合（speckit-sync）**：扫描 `specs/` 下所有增量 spec，按产品归属智能合并为 `current-spec.md` 活文档

---

## 4. 范围与边界

### 范围内

- 10 阶段自治编排流程（run/speckit-feature 模式）
- story 快速需求模式（5 阶段）和 fix 快速修复模式（4 阶段）
- 中断恢复（resume）：基于已有制品扫描恢复点
- 选择性重跑（`--rerun <phase>`）：重跑指定阶段并标记后续制品为过期
- 产品调研（市场、竞品、用户场景）+ 技术调研（架构选型、依赖评估）+ 产研汇总
- 4 道质量门（澄清门、宪法门、分析门、验证门）
- 模型分级配置（balanced / quality-first / cost-efficient 三种预设 + 自定义）
- 12+ 种语言/构建系统的多语言验证闭环
- 产品规范聚合（sync）：增量 spec 智能合并为产品级活文档
- 产品归属自动判定 + product-mapping.yaml 持久化
- 5 个独立 Skill 命令（speckit-feature / speckit-story / speckit-fix / speckit-resume / speckit-sync）
- Claude Code Plugin 标准架构（plugin.json + skills/ + agents/ + hooks/ + scripts/ + templates/）

### 范围外

- **源代码逆向分析**：代码到 Spec 的逆向工程由 reverse-spec Plugin 负责
- **AST 静态分析**：Spec Driver 不执行 AST 分析，委派给 Speckit 子代理
- **IDE 实时集成**：VS Code 等 IDE 中的实时编排状态显示
- **并行子代理执行**：子代理间为串行委派（调研阶段内部模块除外）
- **跨产品 spec**：每个增量 spec 属于且仅属于一个产品
- **Plugin 自动版本更新和安全签名**
- **共享模块（_shared/）**：三个技能间的公共逻辑提取（归入二期）

---

## 5. 当前功能全集

### FR-GROUP-1: 主编排器与流程控制

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-001 | 主编排器 SKILL.md 作为"研发总监"统筹 10 阶段完整研发流程 | 011 | 活跃 |
| FR-002 | 通过 Claude Code Task tool 委派子代理执行具体工作 | 011 | 活跃 |
| FR-006 | "信任但验证"自动推进策略：默认自动继续，仅 CRITICAL 问题暂停 | 011 | 活跃 |
| FR-007 | 人工介入 ≤ 4 次：产研确认、CRITICAL 阻断、任务确认、验证确认 | 011 | 活跃 |
| FR-020 | 每个阶段完成后制品持久化到文件系统，支持中断恢复 | 011 | 活跃 |
| FR-021 | 选择性重跑：指定重跑某阶段，后续制品标记 `[STALE]` | 011 | 活跃 |
| FR-022 | 子代理失败自动重试最多 2 次，仍失败则暂停交用户决策 | 011 | 活跃 |
| FR-023 | 每个阶段开始/完成时输出阶段级进度提示和关键产出摘要 | 011 | 活跃 |

### FR-GROUP-2: 调研与产研汇总

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-003 | 串行调研：产品调研（Phase 1a）→ 技术调研（Phase 1b），结论串行传递 | 011 | 活跃 |
| FR-004 | 调研阶段内部模块可并行执行（市场分析、竞品分析等） | 011 | 活跃 |
| FR-005 | 主编排器生成产研汇总 research-synthesis.md，含产品x技术交叉分析矩阵 | 011 | 活跃 |

### FR-GROUP-3: 多模式支持

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

### FR-GROUP-4: 验证闭环

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-008 | 验证子代理通过特征文件自动检测项目语言和构建系统 | 011 | 活跃 |
| FR-009 | 支持 12+ 种语言/构建系统验证：JS/TS(npm/pnpm/yarn/bun)、Java(Maven/Gradle)、Kotlin、Swift(SPM/Xcode)、C/C++(CMake/Make)、Rust(Cargo)、Go、Python(pip/poetry/uv)、C#(.NET)、Elixir(Mix)、Ruby(Bundler) | 011 | 活跃 |
| FR-010 | Monorepo 支持：每个子项目独立验证并汇总报告 | 011 | 活跃 |
| FR-016 | 两层验证：Layer 1 Spec-Code 对齐（语言无关）+ Layer 2 项目原生工具链（语言相关） | 011 | 活跃 |
| FR-017 | 验证工具未安装时优雅降级（跳过 + 标记"未安装"） | 011 | 活跃 |
| FR-018 | 用户可通过 driver-config.yaml 自定义构建/Lint/测试命令 | 011 | 活跃 |

### FR-GROUP-5: 模型分级配置

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-011 | 三种预设：balanced、quality-first、cost-efficient | 011 | 活跃 |
| FR-012 | driver-config.yaml 自定义每个子代理模型 | 011 | 活跃 |
| FR-019 | 高信心歧义自动选择推荐项（≤ 2 处、有明确推荐时），标注 `[AUTO-RESOLVED]` | 011 | 活跃 |

### FR-GROUP-6: Plugin 架构与初始化

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-013 | 标准 Claude Code Plugin 发布：plugin.json + skills/ + agents/ + hooks/ + scripts/ + templates/ | 011, 014 | 活跃（014 更新元数据为 spec-driver v3.0.0） |
| FR-014 | 首次使用时自动初始化 .specify/ 目录 | 011 | 活跃 |
| FR-015 | 自包含全部子代理 prompt，检测到已有 speckit skills 时优先使用已有版本 | 011 | 活跃 |

### FR-GROUP-7: 产品规范聚合（sync）

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
| FR-S-009 | 聚合完成输出结构化报告（spec 数、产品数、功能统计） | 012 | 活跃 |
| FR-S-010 | 聚合流程不修改原始 spec 文件（只读） | 012 | 活跃 |
| FR-S-011 | 聚合结果幂等——相同输入产生相同输出 | 012 | 活跃 |

### FR-GROUP-8: 技能拆分架构（013 REFACTOR）

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-SK-001 | `skills/speckit-feature/SKILL.md`：独立的完整 10 阶段编排 + 初始化 + 重试 + 重跑 + 模型选择 | 013 | 活跃 |
| FR-SK-002 | `skills/speckit-resume/SKILL.md`：精简初始化 + 制品扫描 + 恢复执行（不含重跑逻辑和完整模型决策表） | 013 | 活跃 |
| FR-SK-003 | `skills/speckit-sync/SKILL.md`：独立的规范聚合流程（不含编排/恢复逻辑） | 013 | 活跃 |
| FR-SK-004 | 每个 SKILL.md 正确配置 frontmatter：name/description/disable-model-invocation | 013, 014 | 活跃（014 更新 name 为 speckit-* 格式） |
| FR-SK-005 | run 技能含 `--rerun <phase>` 重跑功能，resume 不含 | 013 | 活跃 |
| FR-SK-006 | resume 无可恢复制品时提示用户使用 run | 013 | 活跃 |
| FR-SK-007 | sync 在 specs/ 空或不存在时给出明确提示 | 013 | 活跃 |
| FR-SK-008 | 三个技能完全独立，不依赖共享引用文件 | 013 | 活跃 |
| FR-SK-009 | 技能文件引用路径使用 `plugins/spec-driver/` 前缀 | 013, 014 | 活跃（014 从 speckitdriver 更新） |

### FR-GROUP-9: 命名体系（014 REFACTOR）

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-N-001 | plugin.json name 为 `spec-driver`，version 为 `3.0.0` | 014 | 活跃 |
| FR-N-002 | 5 个 SKILL.md frontmatter name 更新为 speckit-feature/speckit-story/speckit-fix/speckit-resume/speckit-sync | 014 | 活跃 |
| FR-N-003 | 所有命令格式统一为 `/spec-driver:speckit-*` | 014 | 活跃 |
| FR-N-004 | 产品显示名统一为 `Spec Driver`（替代 Speckitdriver / Speckit Driver Pro） | 014 | 活跃 |
| FR-N-005 | 所有 agents/*.md 路径前缀从 `plugins/speckitdriver/` 更新为 `plugins/spec-driver/` | 014 | 活跃 |
| FR-N-006 | postinstall.sh 安装标记从 `.speckitdriver-installed` 更新为 `.spec-driver-installed` | 014 | 活跃 |
| FR-N-007 | settings.json 注册名从 `speckitdriver@cc-plugin-market` 更新为 `spec-driver@cc-plugin-market` | 014 | 活跃 |
| FR-N-008 | README.md 包含 v3.0.0 迁移说明（旧命令→新命令映射表） | 014 | 活跃 |

### FR-GROUP-10: 横切关注点

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-032 | 命令名称统一为 `spec-driver:speckit-*` 格式 | 011, 014 | 活跃（014 完成最终命名） |
| FR-C-001 | 所有生成制品遵循中文正文 + 英文代码标识符规范 | 011 | 活跃 |
| FR-C-002 | sync 子代理始终使用 Opus 模型（聚合分析需要深度推理） | 012 | 活跃 |

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

### 兼容性

- 平台：macOS、Linux、Windows WSL
- Claude Code：支持 Plugin、Skill、Task tool 协议
- 模型：Anthropic Claude Sonnet 和 Opus
- 目标项目语言：12+ 种语言/构建系统

### 可用性

- 阶段级进度提示（`[N/10] 正在执行...`），完成时输出关键产出摘要（011）
- 5 个命令在 `/spec-driver:` 补全菜单中独立可见，各附语义描述（013）
- resume 和 sync 的 disable-model-invocation 设置差异化（sync=false 支持渐进发现，run/resume=true 避免误触发）（013）

---

## 7. 当前技术架构

### 技术栈（v3.0.0 纯声明式架构）

- **Bash 5.x** — 安装脚本（postinstall.sh、init-project.sh）
- **Markdown** — 主编排器 prompt（SKILL.md x5）、子代理 prompt（agents/*.md x12）
- **YAML** — 配置文件（driver-config.yaml、plugin.json）
- **无运行时依赖**：Plugin 完全由 Markdown prompt + Bash 脚本 + YAML 配置构成，运行在 Claude Code 沙箱中

### 项目结构

```text
plugins/spec-driver/                    # Plugin 根目录（014 从 speckitdriver 重命名）
├── .claude-plugin/
│   └── plugin.json                     # Plugin 元数据（name: spec-driver, version: 3.0.0）
├── hooks/
│   └── hooks.json                      # SessionStart hook
├── scripts/
│   ├── postinstall.sh                  # 安装后初始化（标记: .spec-driver-installed）
│   └── init-project.sh                 # 项目级 .specify/ 初始化
├── skills/                             # 5 个独立 Skill（013 拆分）
│   ├── speckit-feature/SKILL.md        # 完整 10 阶段编排（约 350 行）
│   ├── speckit-story/SKILL.md          # story 快速需求（[推断] 约 200 行）
│   ├── speckit-fix/SKILL.md            # fix 快速修复（[推断] 约 180 行）
│   ├── speckit-resume/SKILL.md         # 中断恢复（约 150 行）
│   └── speckit-sync/SKILL.md           # 产品规范聚合（约 120 行）
├── agents/                             # 12 个子代理 prompt
│   ├── constitution.md                 # Phase 0: 宪法检查
│   ├── product-research.md             # Phase 1a: 产品调研
│   ├── tech-research.md                # Phase 1b: 技术调研
│   ├── specify.md                      # Phase 2: 需求规范
│   ├── clarify.md                      # Phase 3: 需求澄清
│   ├── checklist.md                    # Phase 3.5: 质量检查表
│   ├── plan.md                         # Phase 4: 技术规划
│   ├── tasks.md                        # Phase 5: 任务分解
│   ├── analyze.md                      # Phase 5.5: 一致性分析
│   ├── implement.md                    # Phase 6: 代码实现
│   ├── verify.md                       # Phase 7: 多语言验证
│   └── sync.md                         # 产品规范聚合子代理
├── templates/
│   ├── product-research-template.md    # 产品调研报告模板
│   ├── tech-research-template.md       # 技术调研报告模板
│   ├── research-synthesis-template.md  # 产研汇总模板
│   ├── verification-report-template.md # 验证报告模板
│   ├── product-spec-template.md        # 产品活文档模板（14 章节）
│   └── driver-config-template.yaml     # 驱动配置模板
└── README.md                           # Plugin 说明（含 v3.0.0 迁移指引）
```

### 编排流程架构

```text
用户输入需求
  → 主编排器（SKILL.md "研发总监"）
    → Task tool 委派子代理（agents/*.md）
      → 子代理读取模板（templates/*.md）
        → 子代理输出制品到 specs/[feature]/
    → 主编排器检查质量门
      → 通过: 自动推进下一阶段
      → 阻断: 暂停征询用户
    → 循环直至验证闭环完成
```

### 模型配置策略

| 预设 | 重分析任务（调研/规范/规划/分析） | 执行任务（澄清/清单/任务/实现/验证） |
|------|--------------------------------|----------------------------------|
| **balanced**（默认） | Opus | Sonnet |
| **quality-first** | Opus | Opus |
| **cost-efficient** | Sonnet | Sonnet |

### 关键设计决策

| 决策 | 选择 | 被拒绝方案 | 理由 | 来源 |
|------|------|-----------|------|------|
| Plugin 架构 | 纯声明式（Markdown + YAML + Bash） | Node.js 运行时 | 零运行时依赖，完全在 Claude Code 沙箱运行 | 011 |
| 子代理委派 | Claude Code Task tool | 直接 API 调用 | 利用平台内置能力，无需自建通信层 | 011 |
| 调研流程 | 产品→技术串行 | 并行 | 技术调研依赖产品调研结论 | 011 |
| 产研汇总 | 主编排器亲自执行 | 委派子代理 | 交叉分析需要全局视角 | 011 |
| 技能拆分 | 完全独立（方案 A） | 共享模块（_shared/） | 降低耦合，共享归入二期 | 013 |
| 命名体系 | spec-driver + speckit-* | 保留 speckitdriver | 语义清晰，Plugin 名和技能前缀分离 | 014 |
| 旧技能迁移 | Strangler Fig 模式 | Big-bang 替换 | 降低回滚风险 | 013 |
| sync 聚合模型 | 始终 Opus | 按预设配置 | 聚合分析需要深度推理 | 012 |

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
| VI | 双语文档规范 | 适用 | 所有制品遵循中文正文 + 英文标识符 |

### Spec Driver 自有原则

| # | 原则 | 说明 |
|---|------|------|
| I | **自治优先，关键暂停** | 默认自动推进，仅质量门失败时暂停 |
| II | **调研驱动规范** | 规范编写前必须完成产品+技术调研 |
| III | **制品持久化** | 每阶段产出即时持久化，支持中断恢复 |
| IV | **零运行时依赖** | Plugin 纯声明式，运行在 Claude Code 沙箱 |
| V | **模式适配复杂度** | run/story/fix 三种模式匹配不同复杂度需求 |
| VI | **命令可发现性** | 独立技能 + 语义描述，通过 `/` 菜单渐进发现 |

---

## 9. 已知限制与技术债

### 已知限制

| 来源 | 类别 | 描述 | 状态 |
|------|------|------|------|
| 011 | 限制 | 子代理间串行委派，不支持阶段级并行（调研阶段内部模块除外） | 设计约束 |
| 011 | 限制 | 全流程耗时取决于 LLM API 延迟，无法精确预估 | 设计约束 |
| 011 | 限制 | 验证阶段依赖用户已安装的工具链，未安装则跳过 | 设计约束 |
| 012 | 限制 | 每个 spec 属于且仅属于一个产品（不支持跨产品 spec） | 设计约束 |
| 012 | 限制 | 自动归属判定可能对关联性不明显的 FIX 类 spec 误判 | 未解决 |
| 013 | 限制 | 三个技能完全独立拆分，存在少量逻辑重复（如初始化） | 设计决策（共享归入二期） |
| [推断] | 限制 | story/fix 模式的 SKILL.md 行数和具体内容结构未在 spec 中详细定义 | 待补充 |

### 技术债

| 来源 | 描述 | 风险 |
|------|------|------|
| 013 | 共享模块（_shared/）推迟到二期，三个技能间存在冗余的初始化逻辑和配置加载逻辑 | 低 |
| 014 | 旧名称 `.speckitdriver-installed` 标记文件可能残留在已安装用户的环境中 | 低 |
| [推断] | Plugin 无自动版本更新机制，v2.0.0→v3.0.0 需手动重装 | 中 |

---

## 10. 假设与风险

### 关键假设

| 假设 | 来源 | 风险等级 |
|------|------|---------|
| 用户已安装 Claude Code 并拥有 API 访问权限（Sonnet + Opus） | 011 | 低 |
| 项目已初始化 Git 仓库 | 011 | 低 |
| Claude Code Task tool 支持子代理委派和模型指定 | 011 | 中 |
| Web 搜索工具（WebSearch / Perplexity MCP）可用于调研 | 011 | 低 |
| 用户理解 Spec-Driven Development 基本概念 | 011 | 低 |
| 增量 spec 编号反映时间顺序（编号大 = 更新） | 012 | 低 |
| Claude Code Plugin 系统支持 skills/ 自动发现 | 013 | 低 |
| Claude Code `/` 补全菜单展示所有已注册 Skill 的 name 和 description | 013 | 低 |

### 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Claude Code Task tool API 变更 | 低 | 高 | Plugin 纯声明式，适配变更成本低 |
| LLM API 频繁超时/不可用 | 中 | 中 | 自动重试 + 中断恢复机制 |
| 调研阶段 Web 搜索不可用 | 低 | 低 | 降级为本地代码库分析 |
| 用户混淆新旧命令格式 | 低 | 低 | README 迁移说明 + 旧命令完全删除 |
| 技能拆分后逻辑不一致 | 低 | 中 | 完全独立拆分（无共享依赖） |
| Opus 模型成本过高导致用户流失 | 中 | 中 | 三种预设（cost-efficient 可全用 Sonnet） |

---

## 11. 被废弃的功能

| 功能 | 原始描述 | 取代者 | 原因 |
|------|---------|--------|------|
| 单体 `speckitdriver` 技能 | 011 初始设计为单一 SKILL.md（706 行） | 013: 5 个独立技能 | 单体文件上下文预算浪费，命令不可发现 |
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
| `skills/speckit-driver-pro/` 目录 | 011 初始技能目录 | 013: 5 个独立技能目录 | 单体目录被删除，拆分为 5 个 |

---

## 12. 变更历史

| # | Spec ID | 类型 | 日期 | 摘要 |
|---|---------|------|------|------|
| 1 | [011-speckit-driver-pro](../../011-speckit-driver-pro/spec.md) | INITIAL | 2026-02-15 | 核心能力建立：10 阶段自治编排、12 个子代理、4 道质量门、story/fix 快速模式、模型分级、多语言验证 |
| 2 | [012-product-spec-sync](../../012-product-spec-sync/spec.md) | FEATURE | 2026-02-15 | 新增产品规范聚合（--sync）：增量 spec 智能合并、产品归属判定、product-mapping.yaml |
| 3 | [013-split-skill-commands](../../013-split-skill-commands/spec.md) | REFACTOR | 2026-02-15 | 拆分单体技能为 run/resume/sync 三个独立命令，优化上下文预算和命令可发现性 |
| 4 | [014-rename-spec-driver](../../014-rename-spec-driver/spec.md) | REFACTOR | 2026-02-15 | 重命名 speckitdriver → spec-driver v3.0.0，技能统一 speckit-* 前缀，110+ 处引用全量更新 |

---

## 13. 术语表

| 术语 | 定义 |
|------|------|
| **主编排器 (Orchestrator)** | SKILL.md 中定义的"研发总监"角色，负责全局决策、质量把控、人机交互管理，通过 Task tool 委派子代理 |
| **子代理 (Sub-Agent)** | agents/ 目录下的 12 个专门化 Markdown prompt，分别负责 constitution/research/specify/clarify/checklist/plan/tasks/analyze/implement/verify/sync |
| **研发制品 (Artifact)** | 流程中产出的结构化文档：product-research.md、tech-research.md、research-synthesis.md、spec.md、plan.md、tasks.md、verification-report.md 等 |
| **质量门 (Quality Gate)** | 4 道自动化检查点——澄清门（需求完整性）、宪法门（原则合规）、分析门（制品一致性，CRITICAL 阻断）、验证门（代码通过构建/测试） |
| **驱动配置 (Driver Config)** | driver-config.yaml 文件，存储模型预设、自定义命令、验证配置等用户偏好 |
| **产品映射 (Product Mapping)** | product-mapping.yaml 文件，记录每个增量 spec 的产品归属，支持手动覆盖 |
| **产品活文档 (Product Living Spec)** | specs/products/<product>/current-spec.md，通过聚合增量 spec 反映产品完整现状的活文档 |
| **speckit-feature** | 完整 10 阶段研发编排命令（原 run 模式） |
| **speckit-story** | 5 阶段快速需求实现命令（跳过调研） |
| **speckit-fix** | 4 阶段快速修复命令（诊断→修复→验证） |
| **speckit-resume** | 中断恢复命令（扫描制品→恢复执行） |
| **speckit-sync** | 产品规范聚合命令（增量 spec → 活文档） |
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
