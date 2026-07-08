# Spec Driver — 产品规范活文档

> **产品**: spec-driver
> **发布版本**: v4.3.0
> **版本**: 聚合自 40 个增量 spec / blueprint（011–022, 032, 062–068, 070–082, 084–085, 087, 089–093）
> **最后聚合**: 2026-04-12
> **生成方式**: Spec Driver sync 聚合 + 人工校准
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

Spec Driver 是一个 **自治研发编排器 Plugin**。它把 Spec-Driven Development 的常见研发链路收敛为一套可复用的命令体系，覆盖 feature、implement、story、fix、resume、sync、doc、refactor 八种模式，并以质量门、验证铁律、调研路由、共享 Project Context resolver、Project Context suggestions、wrapper source-of-truth 合同、架构合理性/可读性审查和产品活文档维持流程一致性。

当前产品的核心定位有六层：

- **研发编排层**：将需求从调研、规范、规划、实现推进到验证闭环
- **质量控制层**：通过门禁策略（含 GATE_IMPLEMENT_MID 中期检查）、三层验证体系、验证铁律、双阶段审查与并行汇合点控制风险
- **知识聚合层**：通过 `spec-driver-sync` 将增量 spec 合并为产品级 `current-spec.md`，再为对外文档生成提供上游事实源；sync 合并算法通过 `sync-merge-engine.mjs` 实现确定性化
- **运营反馈层**：通过 Catalog、workflow registry、scorecards、adoption report 与 Project Context suggestions 形成可持续运营的产品事实层
- **发布合同层**：通过 release contract 将 plugin metadata、README release 行、product-mapping 与 current-spec 的发布信息收敛到单链路
- **仓库治理层**：通过 `repo:sync` / `repo:check` 统一入口、runtime boundary contract 与 Harness 原生 Hook 集成固化仓库一致性

**核心价值**：

- 把多次手动技能调用压缩为一套稳定可追溯的流程
- 让 Feature / Story / Fix / Refactor 四类常见研发路径都有明确最小闭环
- 把"验证是否真实执行"提升为硬约束——三层验证体系（工具链 + 行为 + 失败路径）取代单一退出码检查
- 让 `current-spec.md` 成为 README / 使用文档的事实源，而不是事后再拼装
- 让版本 bump、plugin metadata 与产品事实层同步不再依赖多处手工修改
- 编排配置从 SKILL.md 内联提取到 `orchestration.yaml`，支持声明式 Phase / Gate / Context 定义
- GATE_IMPLEMENT_MID 在大型 Feature 的 50% 进度处拦截架构偏移，降低后期修复成本
- `repo:sync` / `repo:check` 让仓库维护者用一条命令确认仓库一致性，而不是记忆多条离散命令

---

## 2. 目标与成功指标

### 产品愿景

让 AI 协作研发从"会生成内容"升级到"会按流程推进、会留下制品、会给出验证证据、会沉淀产品事实层"。

### 产品级 KPI

| 指标 | 目标值 | 来源 |
|------|--------|------|
| 完整流程人工介入次数 | 仅发生在关键门禁与关键澄清点 | 011, 017 |
| story / fix 模式最小闭环 | 各自保持独立的快速路径 | 011 |
| refactor 模式闭环 | 影响分析→分批规划→逐批实现+中间验证→残留扫描→最终验证 | 093 |
| 验证证据覆盖 | 完成声明必须附带新鲜验证证据 | 017 |
| 三层验证体系 | 工具链验证 + 行为验证 + 失败路径验证 | 085 |
| 调研模式灵活性 | 支持 full / tech-only / product-only / codebase-scan / skip / custom | 018 |
| 并行加速 | verify / research / design-prep 三组可并行，失败回退串行 | 019 |
| 产品级聚合 | 生成 14 章节 `current-spec.md`，含对外文档摘要 | 012, 016, 022 |
| sync 确定性 | 同一输入通过 sync-merge-engine.mjs 产出确定性输出 | 091 |
| 模板可定制性 | 项目级 `.specify/templates/` 可覆盖调研模板 | 021 |
| 全局安装可用性 | 新项目中脚本路径发现不依赖仓库源码布局 | 020 |
| 命名一致性 | 对外命令、技能目录、元数据统一使用 `spec-driver-*` | 014, 032 |
| 产品实体目录 | 生成 `entity.yaml` 与 `catalog-index.yaml` 作为机器可读 Catalog | 063 |
| Workflow Library | 八个入口拥有 machine-readable workflow definition 与 golden paths | 064, 072, 093 |
| Mature Spec 实施 | 对成熟 `spec.md + plan.md` 提供独立 implement 入口 | 072 |
| GATE_IMPLEMENT_MID | 大型 Feature（>5 tasks）在 50% 任务后自动检查架构劣化 | 090 |
| Project Context Resolver | `.specify/project-context.yaml` 成为 canonical source | 073 |
| 持续治理 | 生成 `scorecard-report` 与 `scorecard-index` | 065 |
| Adoption / Friction | 生成本地 `adoption-report`，识别 rerun、gate pause 与 verification 热点 | 066 |
| 治理信号对齐 | 生成产品级 `quality-report` 并校准 scorecard 统计范围 | 068 |
| 产物边界清理 | `current-spec.md` 保持人工事实正文，机器生成产物写入 `_generated/` | 071 |
| Context 建议闭环 | 将 quality / scorecard / adoption 信号转为 `.specify/project-context.suggestions.*` | 074 |
| Project Context 初始化收口 | `init-project.sh` 默认创建最小 `.specify/project-context.yaml` | 075 |
| Wrapper Source Contract | `plugins/spec-driver/skills/**` 与 `.codex/skills/` 通过 contract + validator 保持一致 | 077 |
| Script Platform Shared Layer | `plugins/spec-driver/scripts/lib/` 统一 YAML、artifact IO、patcher 与 diagnostics | 078 |
| Release Contract | `contracts/release-contract.yaml` 统一驱动版本、plugin metadata 与 release 文案 | 080 |
| Maintainability Hotspots | 热点入口收敛为 thin orchestrator | 081 |
| repo:sync / repo:check | 统一仓库级同步与校验入口 | 082 |
| Harness 原生集成 | PreToolUse/PostToolUse/Stop/Worktree Hooks + `.claude/rules/` + Agent frontmatter | 084 |
| Trace 日志 | 每次执行输出 `trace.md`，记录 Phase 耗时、Gate 决策、降级事件 | 087 |
| Agent 制品 Schema | 14 个 Agent 有显式 `*.artifact.yaml` 定义输出契约 | 087 |
| orchestration.yaml | SKILL.md 编排逻辑提取为声明式配置 | 089 |
| 配置体验增强 | Schema 校验前移、effective config 展示、跨 Feature 冲突预警 | 092 |

---

## 3. 用户画像与场景

### 用户角色

| 角色 | 描述 | 主要使用场景 |
|------|------|------------|
| **功能开发者** | 要从一句需求推进到可验证交付 | `spec-driver-feature` |
| **实施负责人** | 已有成熟 spec/plan，希望聚焦实施与验证 | `spec-driver-implement` |
| **快速迭代开发者** | 已有清晰范围，不需要完整调研 | `spec-driver-story` |
| **Bug 修复者** | 需要快速定位问题并完成修复闭环 | `spec-driver-fix` |
| **大规模重构者** | 需要影响分析、分批执行、残留扫描的重构流程 | `spec-driver-refactor` |
| **流程恢复者** | 上次流程中断后继续推进 | `spec-driver-resume` |
| **产品/文档负责人** | 需要维护产品事实源和对外文档 | `spec-driver-sync` + `spec-driver-doc` |
| **仓库维护者** | 需要确认仓库一致性和受控边界 | `npm run repo:sync` / `npm run repo:check` |

### 核心使用场景

1. **完整 Feature 编排**：Constitution → 调研 → 规范 → 澄清/检查 → 规划 → 任务 → 实现（含 GATE_IMPLEMENT_MID） → 审查 → 验证
2. **快速需求交付**：跳过重调研，压缩为 story 模式的快速交付链路
3. **成熟 Spec 聚焦实施**：先对现成 `spec.md + plan.md` 做合同检查，再进入计划审查、任务细化、实现与验证
4. **快速修复闭环**：问题诊断、修复规划、修复实现与验证
5. **大规模重构**：影响分析 → 分批规划 → 逐批实现+中间验证 → 全量残留扫描 → 最终验证
6. **产品规范聚合**：从多份增量 spec 合并出产品级活文档（sync-merge-engine 确定性输出）
7. **文档派生**：让 README / 使用文档优先消费 `current-spec.md` 的事实摘要
8. **仓库治理**：运行 `repo:sync` / `repo:check` 一次性校验 source-of-truth、包装层、shared docs 与 release contract

---

## 4. 范围与边界

### 范围内

- Feature / Implement / Story / Fix / Refactor / Resume / Sync / Doc 八种技能
- 10 阶段编排、质量门（含 GATE_IMPLEMENT_MID）、三层验证体系、验证铁律、双阶段审查
- orchestration.yaml 声明式 Phase / Gate / Context 配置
- 灵活调研路由、调研模板同步和项目级模板覆盖
- 并行子代理编排与串行回退
- 产品活文档聚合、product mapping 与对外文档摘要
- sync-merge-engine.mjs 确定性合并
- 产品实体目录、workflow registry、scorecards 与 adoption report
- `.specify/project-context.suggestions.yaml|md` 作为 Project Context 的独立建议层
- 项目级 `.specify/` 初始化与脚本路径发现
- Project Context resolver、legacy Markdown 兼容与统一 diagnostics
- 命名规范统一与技能元数据对齐
- repo:sync / repo:check 统一仓库同步与校验入口
- runtime boundary contract: `.codex/`、`.claude/`、`.specify/` 受控边界
- Harness 原生 Hook 集成：PreToolUse / PostToolUse / Stop / Worktree
- `.claude/rules/` 路径规则：tests.md / specs.md / plugins.md
- Agent frontmatter 声明（model / tools / effort）
- Trace 日志与 Agent 制品 Schema
- 跨 Feature 文件冲突预警
- 验证命令超时保护

### 范围外

- 直接实现业务代码执行器或独立任务运行时
- 替代项目本身的测试框架与构建系统
- 远程协作看板、任务分配、审批系统
- 自动发布 README 到外部平台
- 完整的在线研究平台实现本身

---

## 5. 当前功能全集

### FR-GROUP-1: 编排核心

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-001 | feature 模式提供完整 10 阶段编排主流程 | 011 | 活跃 |
| FR-002 | story 模式提供轻量化快速需求路径 | 011 | 活跃 |
| FR-003 | fix 模式提供问题诊断到修复验证的最短闭环 | 011 | 活跃 |
| FR-004 | 产物持久化到 `specs/<feature>/`，支持 resume / rerun | 011 | 活跃 |
| FR-005 | 模型预设与子代理模型选择支持分层配置 | 011 | 活跃 |
| FR-031 | implement 模式面向成熟 `spec.md + plan.md`，先执行合同检查，再聚焦实施与验证 | 072 | 活跃 |
| FR-039 | refactor 模式：影响分析→分批规划→逐批实现+中间验证→残留扫描→最终验证 | 093 | 活跃 |

### FR-GROUP-2: 调研路由与门禁策略

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-006 | 6 种调研模式预设与智能推荐 | 018 | 活跃 |
| FR-007 | 设计硬门禁、三级门禁策略与门禁级独立配置 | 017 | 活跃 |
| FR-008 | skip / custom 等模式改变调研制品集合但不弱化后续设计门禁 | 017, 018 | 活跃 |
| FR-009 | 门禁决策输出结构化日志，保持可审计 | 017 | 活跃 |
| FR-040 | GATE_IMPLEMENT_MID：大型 Feature（>5 tasks）在 50% 任务完成后自动检查架构劣化与前置假设有效性 | 090 | 活跃 |

### FR-GROUP-3: 验证体系与并行化

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-010 | 完成声明必须包含当前上下文的新鲜验证证据 | 017 | 活跃 |
| FR-011 | 验证阶段拆分为 spec-review、quality-review、verify | 017 | 活跃 |
| FR-012 | verify group、research group、design-prep group 可并行调度 | 019 | 活跃 |
| FR-013 | 并行失败自动回退串行，并标注回退状态 | 019 | 活跃 |
| FR-041 | 三层验证体系：Layer 1 工具链、Layer 2 行为验证（端到端）、Layer 3 失败路径验证 | 085 | 活跃 |
| FR-042 | 改动后一致性自检：搜索修改/删除的类型名、函数名、枚举值引用 | 085 | 活跃 |
| FR-043 | 编排器独立验证：各 SKILL.md 在 implement 完成后自行运行 build + lint + test | 085 | 活跃 |
| FR-044 | 架构守护：quality-review 检测文件行数从 <500 增长到 >800 时 CRITICAL 阻断 | 085 | 活跃 |

### FR-GROUP-4: 知识聚合与文档派生

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-014 | `spec-driver-sync` 扫描 `specs/NNN-*` 并生成 `product-mapping.yaml` | 012 | 活跃 |
| FR-015 | `current-spec.md` 扩展到 14 章节模板 | 016 | 活跃 |
| FR-016 | `current-spec.md` 包含供 `spec-driver-doc` 消费的对外文档摘要 | 022 | 活跃 |
| FR-017 | `spec-driver-doc` 优先把 `current-spec.md` 作为产品事实源 | 022 | 活跃 |
| FR-045 | sync-merge-engine.mjs 实现确定性合并：决策与执行分离，支持 --dry-run、--json | 091 | 活跃 |

### FR-GROUP-5: 项目引导与模板同步

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-018 | 初始化 `.specify/` 目录与项目模板 | 011 | 活跃 |
| FR-019 | 全局安装场景下脚本路径发现不依赖本地 `plugins/spec-driver/` | 020 | 活跃 |
| FR-020 | 调研模板同步到 `.specify/templates/` 且不覆盖用户自定义版本 | 021 | 活跃 |
| FR-021 | 子代理优先读取项目级调研模板，其次回退插件内置模板 | 021 | 活跃 |
| FR-035 | `init-project.sh` 自动创建最小 `.specify/project-context.yaml`，并在 `.md` 存量项目中保留迁移提示 | 075 | 活跃 |

### FR-GROUP-6: 命名、包装与编排配置

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-022 | Plugin、Skill、命令名称统一为 `spec-driver-*` 前缀体系 | 014, 032 | 活跃 |
| FR-023 | `skills/spec-driver-*/SKILL.md` 与 `.codex/skills/` 名称保持一致 | 032 | 活跃 |
| FR-024 | `spec-driver` 作为产品显示名与插件注册名 | 014, 032 | 活跃 |
| FR-037 | `plugins/spec-driver/skills/**` 是 Codex wrapper 的 canonical source，`.codex/skills/spec-driver-*/SKILL.md` 通过 `wrapper-source-of-truth.yaml` 与 validator 保持可再生成一致性 | 077 | 活跃 |
| FR-038 | `plugins/spec-driver/scripts/lib/` 提供共享 `simple-yaml`、artifact IO、product patcher 与 diagnostics 合同 | 078 | 活跃 |
| FR-046 | orchestration.yaml 声明式 Phase / Gate / Context 配置，SKILL.md 编排逻辑拆分 | 089 | 活跃 |
| FR-047 | 8 个 SKILL.md frontmatter 声明增强（`allowed-tools` / `model` / `effort`） | 092 | 活跃 |

### FR-GROUP-7: Catalog、治理与反馈闭环

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-025 | `spec-driver-sync` 可生成 `entity.yaml` 与 `catalog-index.yaml` 作为产品实体目录 | 063 | 活跃 |
| FR-026 | 八个入口拥有 workflow definition、workflow-index 与 golden paths | 064, 072, 093 | 活跃 |
| FR-027 | 生成 `scorecard-report.md/.json` 与 `scorecard-index.yaml` | 065 | 活跃 |
| FR-028 | 生成本地 `adoption-report.md/.json`，基于 `.specify/runs/*.jsonl` 聚合 adoption / friction 热点 | 066 | 活跃 |
| FR-029 | 生成产品级 `quality-report.md/.json`，并作为 scorecard 的文档质量输入 | 068 | 活跃 |
| FR-030 | 产品级机器生成产物统一写入 `specs/products/<product>/_generated/` | 071 | 活跃 |
| FR-032 | 生成 `.specify/project-context.suggestions.yaml|md`，把治理与 adoption 信号转换为 advisory-only 项目上下文建议 | 074 | 活跃 |

### FR-GROUP-8: Project Context 与执行上下文治理

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-033 | 所有主 Skill 统一通过共享 resolver 读取 `.specify/project-context.*` | 073 | 活跃 |
| FR-034 | `.specify/project-context.yaml` 是 canonical source，`.md` 仅作为 legacy fallback | 073 | 活跃 |
| FR-036 | Project Context resolver 输出 `projectContextBlock`、`onlineResearch`、`diagnostics` 和引用路径存在性检查结果 | 073, 075 | 活跃 |
| FR-048 | 配置 Schema 校验前移至 init-project.sh 阶段 | 092 | 活跃 |
| FR-049 | effective config 展示（含来源标注） | 092 | 活跃 |
| FR-050 | 跨 Feature 文件冲突检测（analyze Agent Pass G） | 092 | 活跃 |
| FR-051 | 验证命令超时保护（`verification.timeout` 配置） | 092 | 活跃 |

### FR-GROUP-9: 仓库治理与 Harness 集成

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-052 | `repo:sync` 统一仓库同步入口（source-of-truth → 包装层 → shared docs → release contract） | 082 | 活跃 |
| FR-053 | `repo:check` 统一仓库校验入口 | 082 | 活跃 |
| FR-054 | runtime boundary contract：`.codex/`、`.claude/`、`.specify/` 受控边界 validator | 082 | 活跃 |
| FR-055 | PreToolUse Hook：活跃工作流期间阻止对 `src/` 的直接编辑 | 084 | 活跃 |
| FR-056 | PostToolUse Hook：对变更文件执行 `npx prettier --write` | 084 | 活跃 |
| FR-057 | Stop Hook：检查 `tasks.md` 是否有未完成任务并提醒 | 084 | 活跃 |
| FR-058 | Worktree Hooks：创建时复制 specs，移除时检查未提交变更 | 084 | 活跃 |
| FR-059 | `.claude/rules/` 路径规则：tests.md / specs.md / plugins.md | 084 | 活跃 |
| FR-060 | 14 个 Agent frontmatter 声明（model / tools / effort） | 084, 087 | 活跃 |
| FR-061 | Trace 日志：`specs/{feature}/trace.md`，记录 Phase 耗时、Gate 决策、降级事件 | 087 | 活跃 |
| FR-062 | Agent 制品 Schema：14 个 `*.artifact.yaml` 定义输出路径、必选/可选章节 | 087 | 活跃 |
| FR-063 | 自适应入口检测：feature/story/implement 初始化扫描已有制品并跳过已完成阶段 | 087 | 活跃 |

---

## 6. 非功能需求

### 性能

| 需求 | 目标 | 来源 |
|------|------|------|
| 完整编排的额外脚本开销 | 保持为轻量启动成本，主要耗时来自模型调用 | 011 |
| sync 上下文规模 | 远小于单体技能，保持低上下文占用 | 013, 016 |
| sync-merge-engine 执行时间 | 脚本合并阶段 < 5 秒 | 091 |
| 并行阶段耗时收益 | verify / research / design-prep 明显优于串行 | 019 |
| doc 事实源复用 | 有 `current-spec.md` 时避免重复推断产品定位 | 022 |
| 验证命令超时 | 单验证命令默认超时保护，避免挂起阻塞流程 | 092 |

### 可靠性

- 子代理失败自动重试，超过阈值再交用户决策
- 并行调度失败自动回退串行，不中断整体流程
- sync 结果保持幂等，相同输入产生稳定输出（sync-merge-engine 确定性保证）
- 项目级模板同步不覆盖已有自定义模板
- 三层验证体系消除 silent failure 风险
- 改动后一致性自检捕获类型名/函数名/枚举值引用遗漏
- GATE_IMPLEMENT_MID 在大型 Feature 中途拦截偏移

### 兼容性

- 平台：macOS、Linux、Windows WSL
- 运行环境：Claude Code Plugin 体系 + Codex（通过 AGENTS.md 同步区块）
- 项目语言：由 verify 阶段自动识别多种构建/测试系统
- 配置升级：新增字段默认向后兼容

### 可用性

- 所有阶段有清晰的进度提示和产出摘要
- 跳过或回退行为必须显式标注
- 命令、技能和目录命名保持统一，降低新成员认知负担
- 文档派生流程优先消费 current-spec，减少 README 与产品文档漂移
- Trace 日志提供执行过程的完整可追溯性
- effective config 展示让用户看到最终生效的配置及其来源

---

## 7. 当前技术架构

### 技术栈

- Markdown SKILL / Agent prompts
- orchestration.yaml（声明式编排配置）
- Bash 脚本（初始化、安装、扫描）
- MJS 脚本（sync-merge-engine、validator、patcher）
- YAML / JSON 配置
- `.specify/` 作为项目级持久化目录
- `specs/products/<product>/current-spec.md` 作为产品级人工事实正文
- `specs/products/<product>/_generated/` 与 `specs/products/_generated/` 作为产品级机器生成事实层

### 项目结构

```text
plugins/spec-driver/
├── .claude-plugin/plugin.json
├── contracts/
│   ├── wrapper-source-of-truth.yaml
│   └── release-contract.yaml
├── config/
│   └── orchestration.yaml          # 声明式 Phase / Gate / Context 配置
├── hooks/
│   ├── hooks.json                   # PreToolUse / PostToolUse / Stop / Worktree
│   └── *.sh
├── scripts/
│   ├── postinstall.sh
│   ├── init-project.sh
│   ├── codex-skills.sh
│   ├── sync-merge-engine.mjs       # 确定性合并脚本
│   ├── validate-wrapper-sources.mjs
│   └── lib/                         # 共享 YAML / artifact IO / patcher / diagnostics
├── skills/
│   ├── spec-driver-feature/
│   ├── spec-driver-implement/
│   ├── spec-driver-story/
│   ├── spec-driver-fix/
│   ├── spec-driver-refactor/        # 大规模重构模式
│   ├── spec-driver-resume/
│   ├── spec-driver-sync/
│   └── spec-driver-doc/
├── agents/
│   ├── constitution.md
│   ├── product-research.md
│   ├── tech-research.md
│   ├── specify.md
│   ├── clarify.md
│   ├── checklist.md
│   ├── plan.md
│   ├── tasks.md
│   ├── analyze.md
│   ├── implement.md
│   ├── spec-review.md
│   ├── quality-review.md
│   ├── verify.md
│   ├── sync.md
│   └── *.artifact.yaml              # 制品 Schema
└── templates/
```

### 架构要点

- 主编排器负责阶段推进、上下文注入、门禁决策与用户交互
- orchestration.yaml 将编排逻辑从 SKILL.md 内联文本提取为声明式配置
- agents 目录承载阶段级子代理 prompt，每个 Agent 有对应的 `.artifact.yaml` 制品 Schema
- `sync` 与 `doc` 的契约从"松散关系"提升为"产品事实源 → 对外派生"
- `.specify/templates/` 允许项目级覆盖内置模板
- `entity.yaml`、workflow registry、quality report、scorecards 和 adoption report 构成最小的 Catalog-driven 运营层
- `resolve-project-context.mjs` 将 Project Context 规则从 Skill 文本约定收敛为共享解析机制
- `wrapper-source-of-truth.yaml` 将包装链路收敛为显式合同
- `scripts/lib/` 将 YAML 解析/序列化、artifact IO、catalog patch 与 warnings 渲染下沉为共享层
- `sync-merge-engine.mjs` 实现 sync 合并的确定性化，Agent 仅保留语义决策层
- Harness Hooks + `.claude/rules/` 将软 Prompt 约束升级为硬门禁编排
- Trace 日志为每次执行提供完整的可审计记录

---

## 8. 设计原则与决策记录

| 原则 | 说明 | 来源 |
|------|------|------|
| 流程优先于零散技巧 | 把研发能力固化为阶段，而不是依赖操作者记忆命令 | 011 |
| 证据优先于自述 | 验证通过必须来自实际运行输出 | 017, 085 |
| 门禁显式化 | 让暂停、放行、失败都可追踪，不做隐式决策 | 017, 090 |
| 并行可回退 | 并行是加速手段，不得改变业务语义 | 019 |
| 产品事实源单一化 | README / 使用文档不应再次发明产品语义 | 012, 016, 022 |
| Catalog 只做机器可读壳层 | `current-spec.md` 仍是正文事实层，`entity.yaml` / workflow / quality / scorecards / adoption 只做索引与治理 | 062–071 |
| 确定性合并 | 确定性操作由脚本负责，LLM 只处理语义决策 | 091 |
| 声明式编排 | Phase / Gate / Context 配置由 orchestration.yaml 声明，SKILL.md 只引用不内联 | 089 |
| 三层验证 | 工具链 + 行为 + 失败路径，确保验证不是"证明它能跑" | 085 |
| Harness 优先 | 能用 Hook 硬约束的不用 Prompt 软约束 | 084 |

---

## 9. 已知限制与技术债

### 已知限制

| 来源 | 类别 | 描述 | 状态 |
|------|------|------|------|
| 011, 017 | 运行形态 | 产品本质是 prompt 编排器，执行质量依赖运行时与模型能力 | 设计约束 |
| 018 | 调研质量 | 调研模式越轻，产出的上下文完备性越弱 | 设计约束 |
| 022 | 文档聚合 | current-spec 质量取决于上游增量 spec 的质量 | 设计约束 |
| 020 | 路径发现 | 全局安装可用性已修复，但仍依赖插件缓存和脚本可执行权限 | 中风险 |
| 066 | adoption 数据 | adoption 目前仅基于本地 `.specify/runs/*.jsonl`，尚不具备团队级聚合能力 | 设计约束 |
| 084 | Harness 覆盖 | 目前覆盖 5/28 Hook，其余 Hook 留待后续迭代 | 设计约束 |
| 090 | 中期门禁 | GATE_IMPLEMENT_MID 对小型 Feature（<=5 tasks）自动跳过，可能遗漏少量场景 | 设计约束 |

### 技术债

| 来源 | 描述 | 风险 |
|------|------|------|
| 021 | 项目级模板同步面继续扩大时，需要更明确的模板版本兼容策略 | 中 |
| 022 | sync / doc 的事实层契约已确立，但自动验证其一致性的门禁仍偏轻量 | 中 |
| 032 | 仓库外部历史材料可能仍残留 `speckit-*` 旧命名 | 低 |
| 070 | `Project Context` 基础闭环已完成；后续演进重点转向更强的执行路由与策略自动化 | 中 |
| 072 | implement skill 已建立，但 resolver 与 suggestions 目前主要用于前置约束和建议注入 | 中 |
| 078 | 六条核心脚本链路已收敛到共享层；后续仍需继续把剩余边缘脚本迁入同一 contract | 中 |
| 089 | SKILL.md 编排拆分正在推进，orchestration.yaml 需要完整测试 7+1 种模式行为不变性 | 高 |
| 087 | Trace 日志和 Agent 制品 Schema 的治理脚本需评估是否纳入 repo:sync 主链路 | 中 |

---

## 10. 假设与风险

### 关键假设

| 假设 | 来源 | 风险等级 |
|------|------|---------|
| 用户项目允许写入 `.specify/` 与 `specs/` 目录 | 011, 012 | 低 |
| 目标项目具备可调用的构建 / 测试 / lint 工具链 | 011, 017, 085 | 中 |
| 主编排器能从需求文本中得到足够清晰的调研模式推荐信号 | 018 | 中 |
| 用户接受 current-spec 作为对外文档的上游事实层 | 022 | 中 |
| orchestration.yaml 配置足以覆盖所有 8 种模式的编排需求 | 089 | 中 |

### 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 验证命令本身配置错误导致假失败 | 中 | 中 | 提供自定义命令和诊断输出 + 超时保护 |
| 过度并行导致上下文不一致 | 低 | 中 | 并行仅用于已验证的并行组，失败立即串行回退 |
| 上游增量 spec 质量不稳导致 current-spec 偏差 | 中 | 中 | sync 中保留 `[推断]` / `[待补充]` 并鼓励 spec 收口 |
| 全局安装脚本路径再次漂移 | 低 | 中 | 统一路径发现机制并保留项目级回退 |
| orchestration.yaml 配置错误导致编排行为变异 | 中 | 高 | 完整的模式行为不变性测试 + Schema 校验 |
| 跨 Feature 文件冲突在大型团队中频繁触发 | 中 | 中 | analyze Agent Pass G 提前预警 + Git 合并策略配合 |

---

## 11. 被废弃的功能

| 功能 | 原始描述 | 取代者 | 原因 |
|------|---------|--------|------|
| 单体 `speckitdriver` 技能 | 011 初始设计为大一统单技能 | 013: 多技能拆分 | 降低上下文体积，提升发现性 |
| `--resume` / `--sync` 作为 run 参数 | 011/012 初始设计 | 013: 独立 resume / sync 命令 | 不常用能力也需要明确入口 |
| `Speckit Driver Pro` 命名 | 011 初始显示名 | 014, 032: `Spec Driver` | 名称过重且残留不一致 |
| `speckit-*` 技能与命令前缀 | 历史命名体系 | 014, 032: `spec-driver-*` | 降低双命名并存造成的维护成本 |
| SKILL.md 内联编排逻辑 | 089 之前所有编排逻辑内嵌在 SKILL.md 中 | 089: orchestration.yaml 声明式配置 | 解耦编排配置与 prompt 内容 |

---

## 12. 变更历史

| # | Spec ID | 类型 | 日期 | 摘要 |
|---|---------|------|------|------|
| 1 | [011-speckit-driver-pro](../../011-speckit-driver-pro/spec.md) | INITIAL | 2026-02-15 | 建立自治研发编排器主流程、质量门、story/fix 快速模式 |
| 2 | [012-product-spec-sync](../../012-product-spec-sync/spec.md) | FEATURE | 2026-02-15 | 增加产品规范聚合与 product mapping |
| 3 | [013-split-skill-commands](../../013-split-skill-commands/spec.md) | REFACTOR | 2026-02-15 | 拆分单体技能为独立命令 |
| 4 | [014-rename-spec-driver](../../014-rename-spec-driver/spec.md) | REFACTOR | 2026-02-15 | speckitdriver → spec-driver 首轮重命名 |
| 5 | [015-speckit-doc-command](../../015-speckit-doc-command/spec.md) | FEATURE | 2026-02-15 | 增加开源文档生成命令 |
| 6 | [016-optimize-sync-product-doc](../../016-optimize-sync-product-doc/spec.md) | ENHANCEMENT | 2026-02-15 | sync 文档扩展为 14 章节模板 |
| 7 | [017-adopt-superpowers-patterns](../../017-adopt-superpowers-patterns/spec.md) | ENHANCEMENT | 2026-02-27 | 引入验证铁律、三级门禁与双阶段审查 |
| 8 | [018-flexible-research-routing](../../018-flexible-research-routing/spec.md) | ENHANCEMENT | 2026-02-27 | 引入灵活调研路由 |
| 9 | [019-parallel-subagent-speedup](../../019-parallel-subagent-speedup/spec.md) | ENHANCEMENT | 2026-02-27 | 引入并行子代理与串行回退 |
| 10 | [020-fix-plugin-script-path](../../020-fix-plugin-script-path/spec.md) | FIX | 2026-03-02 | 修复全局安装场景下脚本路径发现 |
| 11 | [021-add-research-templates](../../021-add-research-templates/spec.md) | FEATURE | 2026-03-02 | 将调研模板纳入项目级模板同步体系 |
| 12 | [022-sync-doc-redesign](../../022-sync-doc-redesign/spec.md) | ENHANCEMENT | 2026-03-07 | 明确 sync / doc 的事实源契约与文档架构 |
| 13 | [032-rename-speckit-to-spec-driver](../../032-rename-speckit-to-spec-driver/spec.md) | REFACTOR | 2026-03-18 | 清理残留 speckit 命名并统一到 spec-driver 前缀 |
| 14 | [062-catalog-driven-spec-driver-blueprint](../../062-catalog-driven-spec-driver-blueprint/blueprint.md) | ENHANCEMENT | 2026-04-04 | 定义 Catalog、Workflow、Scorecards 与 Adoption 四层里程碑蓝图 |
| 15 | [063-product-entity-catalog](../../063-product-entity-catalog/spec.md) | FEATURE | 2026-04-04 | 生成产品实体目录与 `catalog-index.yaml` |
| 16 | [064-workflow-registry-golden-paths](../../064-workflow-registry-golden-paths/spec.md) | FEATURE | 2026-04-04 | 建立 workflow registry 与 3 条 golden paths |
| 17 | [065-scorecards-continuous-governance](../../065-scorecards-continuous-governance/spec.md) | FEATURE | 2026-04-04 | 生成持续治理 scorecards 与 scorecard 索引 |
| 18 | [066-adoption-friction-insights](../../066-adoption-friction-insights/spec.md) | FEATURE | 2026-04-05 | 生成本地 adoption / friction 报告与 run events 合同 |
| 19 | [067-governance-remediation-blueprint](../../067-governance-remediation-blueprint/blueprint.md) | ENHANCEMENT | 2026-04-05 | 定义治理收敛路线 |
| 20 | [068-scorecard-signal-alignment](../../068-scorecard-signal-alignment/spec.md) | FEATURE | 2026-04-05 | 生成产品级 quality-report 与 scorecard 口径校准 |
| 21 | [070-project-context-implement-skill-blueprint](../../070-project-context-implement-skill-blueprint/blueprint.md) | ENHANCEMENT | 2026-04-05 | 定义 Project Context 与 Implement Skill 解耦路线 |
| 22 | [071-product-artifact-boundary-cleanup](../../071-product-artifact-boundary-cleanup/spec.md) | FEATURE | 2026-04-05 | 清理产品事实源与生成产物目录边界 |
| 23 | [072-spec-driver-implement](../../072-spec-driver-implement/spec.md) | FEATURE | 2026-04-05 | 新增成熟 spec/plan 的聚焦实施入口 |
| 24 | [073-project-context-schema-resolver](../../073-project-context-schema-resolver/spec.md) | FEATURE | 2026-04-05 | 引入共享 Project Context resolver |
| 25 | [074-feedback-to-context-suggestions](../../074-feedback-to-context-suggestions/spec.md) | FEATURE | 2026-04-05 | 生成 Project Context suggestions |
| 26 | [075-init-template-tests-docs-closure](../../075-init-template-tests-docs-closure/spec.md) | FEATURE | 2026-04-05 | 补齐 canonical project-context 初始化模板 |
| 27 | [076-codebase-rationalization-blueprint](../../076-codebase-rationalization-blueprint/blueprint.md) | ENHANCEMENT | 2026-04-05 | 定义代码库结构与可维护性收敛路线 |
| 28 | [077-wrapper-source-truth-consolidation](../../077-wrapper-source-truth-consolidation/spec.md) | FEATURE | 2026-04-05 | 建立 wrapper source-of-truth contract |
| 29 | [078-script-platform-shared-layer](../../078-script-platform-shared-layer/spec.md) | FEATURE | 2026-04-05 | 收敛脚本平台共享层 |
| 30 | [080-doc-version-release-contract-unification](../../080-doc-version-release-contract-unification/spec.md) | FEATURE | 2026-04-05 | 统一 release contract 与产品事实层同步链路 |
| 31 | [081-maintainability-hotspot-refactors](../../081-maintainability-hotspot-refactors/spec.md) | REFACTOR | 2026-04-05 | 热点入口收敛为 thin orchestrator |
| 32 | [082-repo-sync-runtime-boundary-hardening](../../082-repo-sync-runtime-boundary-hardening/spec.md) | FEATURE | 2026-04-06 | repo:sync / repo:check 统一入口与 runtime boundary 硬化 |
| 33 | [084-harness-native-integration](../../084-harness-native-integration/spec.md) | FEATURE | 2026-04-06 | Harness 原生能力集成：Hooks / rules / frontmatter / CI |
| 34 | [085-implement-verify-hardening](../../085-implement-verify-hardening/spec.md) | FEATURE | 2026-04-06 | implement/verify 可靠性硬化：三层验证 + 一致性自检 |
| 35 | [087-orchestration-upgrade-governance-trim](../../087-orchestration-upgrade-governance-trim/spec.md) | ENHANCEMENT | 2026-04-06 | 编排架构升级：Trace / Schema / 自适应入口 / 治理精简 |
| 36 | [089-skill-orchestration-split](../../089-skill-orchestration-split/spec.md) | FEATURE | 2026-04-06 | SKILL.md 编排拆分与 orchestration.yaml 提取 |
| 37 | [090-implement-mid-gate](../../090-implement-mid-gate/spec.md) | FEATURE | 2026-04-06 | GATE_IMPLEMENT_MID 中期门禁 |
| 38 | [091-sync-deterministic-merge](../../091-sync-deterministic-merge/spec.md) | FEATURE | 2026-04-06 | sync 合并算法确定性化 |
| 39 | [092-config-ux-and-cross-feature-guard](../../092-config-ux-and-cross-feature-guard/spec.md) | FEATURE | 2026-04-06 | 配置体验增强 + 跨 Feature 守护 |
| 40 | [093-refactor-mode](../../093-refactor-mode/spec.md) | FEATURE | 2026-04-06 | 新增 spec-driver-refactor 大规模重构模式 |

---

## 13. 术语表

| 术语 | 定义 |
|------|------|
| **主编排器** | 承担阶段推进、门禁决策与用户交互的主流程 |
| **子代理** | `agents/*.md` 中承载某个阶段职责的专用 prompt |
| **验证铁律** | 完成声明必须包含新鲜验证证据的约束 |
| **三层验证** | Layer 1 工具链 + Layer 2 行为验证 + Layer 3 失败路径验证 |
| **质量门** | 编排流程中的暂停 / 放行检查点 |
| **GATE_IMPLEMENT_MID** | 在 implement 完成 50% 任务后触发的中期检查点 |
| **门禁策略** | strict / balanced / autonomous 三档全局门禁策略 |
| **调研模式** | full / tech-only / product-only / codebase-scan / skip / custom |
| **并行组** | 可同时执行并在 join point 汇合的一组子代理 |
| **产品映射** | `product-mapping.yaml` 中定义的 spec → product 归属关系 |
| **产品活文档** | `specs/products/<product>/current-spec.md`，用于沉淀产品事实 |
| **对外文档摘要** | current-spec 中供 doc 命令复用的 README / 使用文档摘要层 |
| **orchestration.yaml** | 声明式编排配置，定义 Phase / Gate / Context 规则 |
| **Trace 日志** | `specs/{feature}/trace.md`，记录执行过程的完整时间线 |
| **制品 Schema** | `*.artifact.yaml`，定义每个 Agent 的输出路径与必选/可选章节 |
| **sync-merge-engine** | 确定性合并脚本，实现 spec 排序、匹配、骨架生成的 100% 可复现 |

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
| 10 | 020-fix-plugin-script-path | FIX | [specs/020-fix-plugin-script-path/spec.md](../../020-fix-plugin-script-path/spec.md) |
| 11 | 021-add-research-templates | FEATURE | [specs/021-add-research-templates/spec.md](../../021-add-research-templates/spec.md) |
| 12 | 022-sync-doc-redesign | ENHANCEMENT | [specs/022-sync-doc-redesign/spec.md](../../022-sync-doc-redesign/spec.md) |
| 13 | 032-rename-speckit-to-spec-driver | REFACTOR | [specs/032-rename-speckit-to-spec-driver/spec.md](../../032-rename-speckit-to-spec-driver/spec.md) |
| 14 | 062-catalog-driven-spec-driver-blueprint | ENHANCEMENT | [specs/062-catalog-driven-spec-driver-blueprint/blueprint.md](../../062-catalog-driven-spec-driver-blueprint/blueprint.md) |
| 15 | 063-product-entity-catalog | FEATURE | [specs/063-product-entity-catalog/spec.md](../../063-product-entity-catalog/spec.md) |
| 16 | 064-workflow-registry-golden-paths | FEATURE | [specs/064-workflow-registry-golden-paths/spec.md](../../064-workflow-registry-golden-paths/spec.md) |
| 17 | 065-scorecards-continuous-governance | FEATURE | [specs/065-scorecards-continuous-governance/spec.md](../../065-scorecards-continuous-governance/spec.md) |
| 18 | 066-adoption-friction-insights | FEATURE | [specs/066-adoption-friction-insights/spec.md](../../066-adoption-friction-insights/spec.md) |
| 19 | 067-governance-remediation-blueprint | ENHANCEMENT | [specs/067-governance-remediation-blueprint/blueprint.md](../../067-governance-remediation-blueprint/blueprint.md) |
| 20 | 068-scorecard-signal-alignment | FEATURE | [specs/068-scorecard-signal-alignment/spec.md](../../068-scorecard-signal-alignment/spec.md) |
| 21 | 070-project-context-implement-skill-blueprint | ENHANCEMENT | [specs/070-project-context-implement-skill-blueprint/blueprint.md](../../070-project-context-implement-skill-blueprint/blueprint.md) |
| 22 | 071-product-artifact-boundary-cleanup | FEATURE | [specs/071-product-artifact-boundary-cleanup/spec.md](../../071-product-artifact-boundary-cleanup/spec.md) |
| 23 | 072-spec-driver-implement | FEATURE | [specs/072-spec-driver-implement/spec.md](../../072-spec-driver-implement/spec.md) |
| 24 | 073-project-context-schema-resolver | FEATURE | [specs/073-project-context-schema-resolver/spec.md](../../073-project-context-schema-resolver/spec.md) |
| 25 | 074-feedback-to-context-suggestions | FEATURE | [specs/074-feedback-to-context-suggestions/spec.md](../../074-feedback-to-context-suggestions/spec.md) |
| 26 | 075-init-template-tests-docs-closure | FEATURE | [specs/075-init-template-tests-docs-closure/spec.md](../../075-init-template-tests-docs-closure/spec.md) |
| 27 | 076-codebase-rationalization-blueprint | ENHANCEMENT | [specs/076-codebase-rationalization-blueprint/blueprint.md](../../076-codebase-rationalization-blueprint/blueprint.md) |
| 28 | 077-wrapper-source-truth-consolidation | FEATURE | [specs/077-wrapper-source-truth-consolidation/spec.md](../../077-wrapper-source-truth-consolidation/spec.md) |
| 29 | 078-script-platform-shared-layer | FEATURE | [specs/078-script-platform-shared-layer/spec.md](../../078-script-platform-shared-layer/spec.md) |
| 30 | 080-doc-version-release-contract-unification | FEATURE | [specs/080-doc-version-release-contract-unification/spec.md](../../080-doc-version-release-contract-unification/spec.md) |
| 31 | 081-maintainability-hotspot-refactors | REFACTOR | [specs/081-maintainability-hotspot-refactors/spec.md](../../081-maintainability-hotspot-refactors/spec.md) |
| 32 | 082-repo-sync-runtime-boundary-hardening | FEATURE | [specs/082-repo-sync-runtime-boundary-hardening/spec.md](../../082-repo-sync-runtime-boundary-hardening/spec.md) |
| 33 | 084-harness-native-integration | FEATURE | [specs/084-harness-native-integration/spec.md](../../084-harness-native-integration/spec.md) |
| 34 | 085-implement-verify-hardening | FEATURE | [specs/085-implement-verify-hardening/spec.md](../../085-implement-verify-hardening/spec.md) |
| 35 | 087-orchestration-upgrade-governance-trim | ENHANCEMENT | [specs/087-orchestration-upgrade-governance-trim/spec.md](../../087-orchestration-upgrade-governance-trim/spec.md) |
| 36 | 089-skill-orchestration-split | FEATURE | [specs/089-skill-orchestration-split/spec.md](../../089-skill-orchestration-split/spec.md) |
| 37 | 090-implement-mid-gate | FEATURE | [specs/090-implement-mid-gate/spec.md](../../090-implement-mid-gate/spec.md) |
| 38 | 091-sync-deterministic-merge | FEATURE | [specs/091-sync-deterministic-merge/spec.md](../../091-sync-deterministic-merge/spec.md) |
| 39 | 092-config-ux-and-cross-feature-guard | FEATURE | [specs/092-config-ux-and-cross-feature-guard/spec.md](../../092-config-ux-and-cross-feature-guard/spec.md) |
| 40 | 093-refactor-mode | FEATURE | [specs/093-refactor-mode/spec.md](../../093-refactor-mode/spec.md) |

---

## 对外文档摘要（供 spec-driver-doc 使用）

Spec Driver 是一个把 Spec-Driven Development 流程编排成可执行命令的插件。它覆盖 feature、implement、story、fix、refactor、resume、sync、doc 八类典型研发场景，并通过门禁（含 GATE_IMPLEMENT_MID 中期检查）、三层验证体系、确定性合并、产品活文档和 Project Context suggestions 保持流程一致性。

**主要价值主张**：

- 让需求到交付形成有阶段、有制品、有验证证据的闭环
- 让成熟 `spec.md + plan.md` 可以直接进入实施，而不重复开启完整调研
- 提供大规模重构专属流程：影响分析、分批执行、中间验证、残留扫描
- 把 `current-spec.md` 建成产品事实源，减少 README 与内部规范漂移
- 让重型编排、快速实现、快速修复、大规模重构和文档聚合各有清晰入口
- 把治理与 adoption 信号转成可 review 的 Project Context 建议，而不是静默覆盖项目配置
- 让 Codex 包装技能通过显式 contract 与 validator 维持可再生成的一致性
- 让产品运营脚本共享同一套 YAML / artifact IO / diagnostics 基础层
- 通过 Harness Hooks 将软 Prompt 约束升级为硬门禁编排
- 通过 repo:sync / repo:check 让仓库维护者用一条命令确认仓库一致性
