# Spec Driver — 产品规范活文档

> **产品**: spec-driver
> **发布版本**: v4.6.0
> **版本**: 聚合自 60 个增量 spec / blueprint（011–290；product-mapping 登记 58，含 062/067/070/076 四份 blueprint；200/278 两份跨产品 spec 只并入 spec-driver 部分；34 份按 product-mapping.yaml 头部登记排除）
> **最后聚合**: 2026-09-14
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
- 流程依从性不再只靠 prompt 约束：fix 模式收口有住在模型上下文之外的阻断型机械判定，判据全部取自 harness 客观记录（208, 216, 224, 270, 289, 290）
- 编排配置可被项目级分层覆盖（`.specify/orchestration-overrides.yaml`），无需 fork plugin 本体即可改 gate 行为 / mode 流程 / 并发度（133, 136）
- 设计上下文可被确定性预填：specify 前自动预查知识库、implement 前先判断知识图谱该刷新还是该降级（191, 241）

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
| 项目级编排覆盖 | `.specify/orchestration-overrides.yaml` 分层覆盖；`resolveOrchestrationConfig()` 全链路 < 200ms（overrides ≤ 200 行） | 133, 136 |
| fix 流程依从性 | 静默通过数 = 0（硬性）；仪式坍塌率从 F206 基线 20%–29% 降至 5% 以下；Stop hook 判定 p95 < 100ms 且零新增 LLM 调用 | 208, 216 |
| 门禁证据源 | 委派证据改由 PostToolUse 账本实时写入，在途判定改用 Stop payload 原生三态；账本 ≤ 1MB/会话、Stop 侧读取 < 200ms | 270, 289, 290 |
| Spec 漂移侦测 | `drift link/check/unlink` 以 symbol 级 AST 指纹判 fresh/stale，11 态状态矩阵，零 LLM 调用 | 219 |
| Codex 双运行时分发 | 9/9 canonical skill 有 Codex wrapper；Codex manifest / MCP / skill 数 / marketplace 条目由一致性矩阵门禁守护 | 213, 238, 240 |
| 自治迭代（opt-in） | feature 模式 implement 阶段可声明 `agent_mode: goal_loop`，达标 metric = Layer 2 全 PASS ∧ P1 FR 覆盖 100% ∧ Layer 1.5 COMPLIANT | 201 |
| FR 对账矩阵 | plan 必须产出 FR→Phase 覆盖矩阵，行数 ÷ FR 总条数 = 100%（分母由检索命令现取，不写死字面量） | 277 |

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
| **流程治理者** | 需要确认 fix 流程真的被执行过，而不是被"读了就丢" | 阻断型 Stop hook + `fix_compliance` 三档配置（208, 216, 270, 289） |
| **编排定制者** | 需要按项目调整 gate 行为 / mode 流程 / 并发度，但不改 plugin 本体 | `.specify/orchestration-overrides.yaml` + `effective-orchestration` / `generate-template`（133, 136） |
| **Codex 运行时用户** | 在 Codex CLI 下使用同一套 skill 与 MCP | `codex plugin add`（213, 238, 240） |

### 核心使用场景

1. **完整 Feature 编排**：Constitution → 调研 → 规范 → 澄清/检查 → 规划 → 任务 → 实现（含 GATE_IMPLEMENT_MID） → 审查 → 验证
2. **快速需求交付**：跳过重调研，压缩为 story 模式的快速交付链路
3. **成熟 Spec 聚焦实施**：先对现成 `spec.md + plan.md` 做合同检查，再进入计划审查、任务细化、实现与验证
4. **快速修复闭环**：问题诊断、修复规划、修复实现与验证
5. **大规模重构**：影响分析 → 分批规划 → 逐批实现+中间验证 → 全量残留扫描 → 最终验证
6. **产品规范聚合**：从多份增量 spec 合并出产品级活文档（sync-merge-engine 确定性输出）
7. **文档派生**：让 README / 使用文档优先消费 `current-spec.md` 的事实摘要
8. **仓库治理**：运行 `repo:sync` / `repo:check` 一次性校验 source-of-truth、包装层、shared docs 与 release contract
9. **流程依从性收口**：fix 会话结束时由 Stop hook 按收口形态（修复收口 / no-op 收口）机械判定最低合规要求，不达标阻断且阻断有界
10. **编排行为定制**：项目写一份 overrides 覆盖 gate 行为 / mode 流程 / 并发度，用 `effective-orchestration --annotate` 查看最终生效配置及字段来源
11. **判定器漂移自查**：用 `judge:doctor`（含 `--since <ref>` 增量视图）确认本机生效的门禁判定器代码是否还是修复前的旧版本

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
- 项目级 `.specify/orchestration-overrides.yaml` 分层覆盖（mode 整段替换 / gate 字段级合并 / parallel_scheduling 标量覆盖）
- fix 模式流程依从性门禁链：阻断型 Stop hook、no-op 可执行证据门、会话证据账本、Tier 2 续做合同
- 判定器漂移可观测性（`judge:doctor` 四态 + `--since` 增量视图）与 Codex 运行时四方一致性诊断
- Spec 引用漂移侦测（`drift link/check/unlink` + `.specify/spec-drift.lock.json`）
- 知识库预查注入（`knowledge_sources` 配置 + `kb-prequery.mjs`）与图消费决策（刷新 / 降级 / 跳过）
- Codex 侧分发面：`.codex-plugin/plugin.json`、marketplace catalog、9/9 wrapper 与一致性矩阵
- FR 对账矩阵、裁剪登记、关键量反向普查、推断前提登记四类防过度声明产物

### 范围外

- 直接实现业务代码执行器或独立任务运行时
- 替代项目本身的测试框架与构建系统
- 远程协作看板、任务分配、审批系统
- 自动发布 README 到外部平台
- 完整的在线研究平台实现本身
- 对抗蓄意伪造：删账本 / 主动 sabotage 状态存储可把门禁退回改动前强度，威胁模型为遗弃与偷懒而非主动破坏（208, 270）
- 复现命令与症状的语义相关性核验、纯 repair 形态的零源码改动伪装（216 能力边界声明）
- overrides 的 phase 局部 patch、mode `extends` 派生、`parallel_groups` 成员覆盖与 Prompt 级覆盖（133 MVP 外）
- drift 的 rename-follow、member 粒度建锚与 TS/JS 以外的语言（219 首发外）

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
| FR-064 | `goal_loop` agent_mode：implement↔verify 自主迭代闭环（snapshot → 注入 impact → implement → verify → 按优先级判定），默认关闭，仅经 overrides 对 feature 模式 opt-in | 201 | 活跃 |
| FR-065 | goal_loop 达标 metric 固定为 Layer 2 全 PASS ∧ P1 FR 覆盖 100% ∧ Layer 1.5 COMPLIANT，且只消费独立 verify 子代理产出的结构化 verification-report，不接受 implement 自报达标 | 201 | 活跃 |
| FR-066 | goal_loop 每轮 implement 前建立 snapshot，detectRegression 命中即回滚；停止/处置固定优先级（回滚失败 > regression 回滚 > 达标 > 预算耗尽/无进展） | 201 | 活跃 |
| FR-067 | 图消费决策纯函数 `decideGraphConsumption`：五维输入按 13 条固定顺序规则求值，出口五选一（consume-impact / refresh-then-consume / consume-degraded / skip-impact / unavailable），降级原因为 12 值封闭枚举 | 241 | 活跃 |
| FR-068 | 图刷新 single-flight：一次 CLI 调用最多 spawn 一次全量 `spectra batch --mode graph-only`，跨调用 once-ness 为调用方合同 | 241 | 活跃 |
| FR-069 | 图消费审计双事件模型（`kind:decision` 无条件当场写 / `kind:caveat-annotation`），落盘 `.specify/graph-consumption-audit.jsonl`，decision 事件独立满足"每次决策留证据" | 241 | 活跃 |

### FR-GROUP-2: 调研路由与门禁策略

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-006 | 6 种调研模式预设与智能推荐 | 018 | 活跃 |
| FR-007 | 设计硬门禁、三级门禁策略与门禁级独立配置 | 017 | 活跃 |
| FR-008 | skip / custom 等模式改变调研制品集合但不弱化后续设计门禁 | 017, 018 | 活跃 |
| FR-009 | 门禁决策输出结构化日志，保持可审计 | 017 | 活跃 |
| FR-040 | GATE_IMPLEMENT_MID：大型 Feature（>5 tasks）在 50% 任务完成后自动检查架构劣化与前置假设有效性 | 090 | 活跃 |
| FR-070 | specify 阶段前确定性预查知识库：`kb-prequery.mjs` 读 `knowledge_sources` 配置 → bin 发现探测 → shell out `spectra scaffold-kb query` → 输出注入块，无需子代理主动调用工具 | 191 | 活跃 |
| FR-071 | KB 注入的 untrusted-evidence 边界：`[KB-EVIDENCE]` envelope + 非指令硬约束前导句模板 + 字符级 cap（`max_inject_chars`）防注入 | 191 | 活跃 |
| FR-072 | KB 预查静默降级：未配置 / 禁用 / 路径不存在 / 查询非零退出 / 零命中五类场景一律 exit 0，不阻断 spec-driver 流程 | 191 | 活跃 |
| FR-073 | 门禁 / 判定器 / 安全检查类改动的 GATE_DESIGN 内建「对抗→修订→再对抗」收敛循环，判据为上一轮修订产物零新增 CRITICAL，单轮对抗结果不足以放行 | 277 | 活跃 |
| FR-074 | GATE_DESIGN 的 `default_behavior` 与 `hard_gate_modes` 为项目级禁改字段，overrides 试图覆盖时被 schema 显式 diagnostic 拒绝 | 277 | 活跃 |

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
| FR-075 | plan 阶段必须产出「FR→Phase 覆盖矩阵」具名章节：spec 有 N 条 FR 矩阵就必须有 N 行，不允许抽样或省略未认领行 | 277 | 活跃 |
| FR-076 | 类别为「实现型」且未被任何 Phase 认领、又未登记裁剪的 FR，verify 必须自动判为「未实现」；MUST 项裁剪须经 GATE_TASKS 单列成组显式接受 | 277 | 活跃 |
| FR-077 | plan 阶段必须产出「关键量反向普查」具名章节：列出每个关键量在全仓的全部消费点（文件路径 + 行号），声明条数须与检索命令实际输出计数一致 | 277 | 活跃 |
| FR-078 | 交付判定必须有显式合并律：任一子检查落入未实现 / 未通过 / 未执行缺席等七态之一即整体判不通过，未列举的新状态默认归入不通过侧 | 277 | 活跃 |
| FR-079 | 推断前提登记：spec / plan 中 `[推断]` 标记的关键前提须逐条列清，每条配一条同命题的运行时验证命令 | 277 | 活跃 |
| FR-080 | verify 判定链（3 取值）与 spec-review 判定链（5 取值：已实现 / 部分实现 / 未实现 / 过度实现 / 无法验证）收编为统一取值集与归并方向 | 277 | 活跃 |

### FR-GROUP-4: 知识聚合与文档派生

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-014 | `spec-driver-sync` 扫描 `specs/NNN-*` 并生成 `product-mapping.yaml` | 012 | 活跃 |
| FR-015 | `current-spec.md` 扩展到 14 章节模板 | 016 | 活跃 |
| FR-016 | `current-spec.md` 包含供 `spec-driver-doc` 消费的对外文档摘要 | 022 | 活跃 |
| FR-017 | `spec-driver-doc` 优先把 `current-spec.md` 作为产品事实源 | 022 | 活跃 |
| FR-045 | sync-merge-engine.mjs 实现确定性合并：决策与执行分离，支持 --dry-run、--json | 091 | 活跃 |
| FR-081 | `docs/spec-driver-modes.md` 如实登记委派硬约束的覆盖范围：机器强制集为 5 个编排 skill（含 resume），refactor 未纳入并显式说明而非扩大范围修复 | 200 | 活跃 |
| FR-082 | `docs/configuration.md` 登记 orchestration phase 覆盖「仅 feature 模式运行时生效」的 caveat | 200 | 活跃 |

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
| FR-083 | 项目级 `.specify/orchestration-overrides.yaml`：存在时与 plugin base `orchestration.yaml` 合并，不存在则静默用 base；不允许经 overrides 反向修改插件内文件 | 133 | 活跃 |
| FR-084 | 覆盖合并语义按字段类型区分：mode 整段替换 / gate 字段级合并 / `parallel_scheduling` 标量覆盖；`parallel_groups` 与按 phase id 局部 patch 暂不支持 | 133 | 活跃 |
| FR-085 | overrides 精确降级策略表：多种错误情形分别映射独立 diagnostic level/code（parse-error / loader-error / schema-fallback / version-mismatch / unsupported-field / gate-mounting-lost / base-invalid 等），降级一律整份回退 base 并留 `isFallback` 标记 | 133, 136 | 活跃 |
| FR-086 | 编排配置校验改用 Zod schema 三件套（base / overrides / merged）共用同一类型定义，`modes` key 以 enum 仅接受 8 个 base reserved mode 名；并接入 `repo:check` | 133 | 活跃 |
| FR-087 | `effective-orchestration <mode>` CLI 子命令（`--annotate` / `--diff` / `--format yaml\|json` / `--project-root`），以 `fieldSources` 精确到 gate 字段级标注每个字段来自 base 还是 overrides | 133 | 活跃 |
| FR-088 | `generate-template <mode>` CLI 子命令输出可直接保存为合法 overrides 的模板（version + `modes.<mode>` 完整结构 + 全部 phase 字段），roundtrip 后无 schema-fallback diagnostic | 136 | 活跃 |
| FR-089 | `schema-fallback` 命中 `modes.*.phases.*` 字段缺失时在 diagnostic message 末尾追加修复 hint（其他 schema 错误不附）；`_loadOverrides` 注入函数抛错独立归类为 `loader-error`，不再误标 YAML 解析失败 | 136 | 活跃 |
| FR-090 | Codex wrapper 覆盖全部 9 个 canonical skill（补齐 `spec-driver-refactor`），与 `wrapper-source-of-truth.yaml` entries 数量/身份一致，移除 `spec-driver-refactor-codex-wrapper-gap` waiver | 238 | 活跃 |
| FR-091 | 子代理能力探测（`codex features list`，单次运行内只探测一次并缓存）结果只落本地 gitignored sidecar `.codex/spec-driver-capability.md`，wrapper 正文永远是 capability-neutral 静态指针文案，不按探测结果分支生成 | 238 | 活跃 |
| FR-092 | 「模型兼容」文案禁含具体模型版本字面量（改写为 tier 语义描述），并由可脚本化的模型字面量 grep 门禁按固定扫描路径清单把守，命中即失败 | 238 | 活跃 |
| FR-093 | `resolveCodexExecutionConfig()` 按七类来源决策矩阵判定 `modelFlagMode`（`required` / `delegate`），delegate 场景在判定阶段即烘焙 `delegated:` 前缀，不冒充实际执行模型 | 238 | 活跃 |
| FR-094 | 「先落盘骨架，再逐节 Edit 填充」写入 implement / specify / plan / tasks 四份 agent，作为一等输出协议文本而非委派时口头叮嘱 | 277 | 活跃 |

### FR-GROUP-7: Catalog、治理与反馈闭环

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-025 | `spec-driver-sync` 可生成 `entity.yaml` 与 `catalog-index.yaml` 作为产品实体目录 | 063 | 活跃 |
| FR-026 | 八个入口拥有 workflow definition、workflow-index 与 golden paths | 064, 072, 093 | 活跃 |
| FR-027 | 生成 `scorecard-report.md/.json` 与 `scorecard-index.yaml` | 065 | 活跃 |
| FR-028 | 生成本地 `adoption-report.md/.json`，基于 `.specify/runs/*.jsonl` 聚合 adoption / friction 热点 | 066 | 活跃 |
| FR-029 | 生成产品级 `quality-report.md/.json`，并作为 scorecard 的文档质量输入 | 068 | 活跃 |
| FR-030 | 产品级机器生成产物统一写入 `specs/products/<product>/_generated/` | 071 | 活跃 |
| FR-032 | 生成 `.specify/project-context.suggestions.yaml\|md`，把治理与 adoption 信号转换为 advisory-only 项目上下文建议 | 074 | 活跃 |

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
| FR-095 | Project Context schema 扩展 `knowledge_sources`（`enabled` / `vendor_kb` / `project_kb` / `top_k` / `max_inject_chars`），resolver 全 4 条读取路径均填默认值以保证既有 9 个顶层字段零回归 | 191 | 活跃 |

### FR-GROUP-9: 仓库治理与 Harness 集成

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-052 | `repo:sync` 统一仓库同步入口（source-of-truth → 包装层 → shared docs → release contract） | 082 | 活跃 |
| FR-053 | `repo:check` 统一仓库校验入口；检查族持续扩展（Codex 一致性矩阵、orchestration-overrides 校验、第 13 族 `spec-drift`、第 14 族 `.worktreeinclude` 合同、`agent-tools:required` 与 `gate-mounting:effective-config` 守护项），新增项一律沿用既有 `aggregateValidation` 模式接入 | 082, 133, 213, 219, 239, 277 | 活跃 |
| FR-054 | runtime boundary contract：`.codex/`、`.claude/`、`.specify/` 受控边界 validator | 082 | 活跃 |
| FR-055 | PreToolUse Hook：活跃工作流期间阻止对 `src/` 的直接编辑 | 084 | 活跃 |
| FR-056 | PostToolUse Hook：对变更文件执行 `npx prettier --write` | 084 | 活跃 |
| FR-057 | Stop Hook：检查 `tasks.md` 是否有未完成任务并提醒 | 084 | 活跃 |
| FR-058 | Worktree Hooks：创建时复制 specs，移除时检查未提交变更；F239 扩展为消费 `.worktreeinclude` 本地文件清单、为 Codex-managed worktree 提供显式 bootstrap 入口（`--attempt-build`），且 hook 失败可见但不阻断 worktree 创建 | 084, 239 | 活跃 |
| FR-059 | `.claude/rules/` 路径规则：tests.md / specs.md / plugins.md | 084 | 活跃 |
| FR-060 | 14 个 Agent frontmatter 声明（model / tools / effort） | 084, 087 | 活跃 |
| FR-061 | Trace 日志：`specs/{feature}/trace.md`，记录 Phase 耗时、Gate 决策、降级事件 | 087 | 活跃 |
| FR-062 | Agent 制品 Schema：14 个 `*.artifact.yaml` 定义输出路径、必选/可选章节 | 087 | 活跃 |
| FR-063 | 自适应入口检测：feature/story/implement 初始化扫描已有制品并跳过已完成阶段 | 087 | 活跃 |
| FR-096 | 阻断型 Stop hook（`stop-fix-compliance-check.sh` → `fix-compliance-judge.mjs`）在 fix 会话收口时机械判定合规性，判据全部取自 harness 客观记录（技能展开痕迹 / 委派计数 / 磁盘制品），不采信模型自陈文本；与既有非阻断型 `stop-task-check.sh`（FR-057）独立并存 | 208 | 活跃 |
| FR-097 | 收口形态三支判据：修复收口（fix-report + verification-report + 委派 ≥2 且 implement/verify 各 ≥1）/ no-op 收口（判定依据章节 + ≥1 次核实委派）/ 零委派零制品一律不合规；含制品非空与模板必填章节的实质性校验 | 208 | 活跃 |
| FR-098 | 阻断有界：同一会话至多阻断 2 次，第 3 次仍不达标则放行并以 `[GATE-DEGRADED]` 标注降级原因 | 208 | 活跃 |
| FR-099 | 项目级 `fix_compliance.enforcement` 三档配置（block 默认 / warn / off），配置缺失或非法一律回落 block，判定异常 fail-open-but-loud；判定路径零 LLM 零委派 | 208 | 活跃 |
| FR-100 | no-op 出口可执行证据门：结论前编排器须亲自经 Bash 执行复现命令，`ExecutionRecord`（`tool_use.id` ↔ `tool_result.tool_use_id` 配对 + 命令保守规范化比对）须与主 transcript 配对核验，仅有文本字样无执行痕迹判不合规 | 216 | 活跃 |
| FR-101 | no-op 证据缺失以 6 键互斥穷尽的 missing keys 呈现，各配固定 next-step 反馈文案；PASS 判定用 sentinel 整行末行精确匹配，不用退出码符号判读，非零退出/超时/字段缺失一律判 INCONCLUSIVE | 216 | 活跃 |
| FR-102 | 判定器跟随特性目录改名（光杆 `git mv`/`mv`）与原地编辑写入（`sed -i`/`perl -i`），多次叠加取最终态且 `ambiguous` 为可恢复状态；仍无法确定候选时走 fail-open 但**按维度收窄**——只让 featureDir 一个判据转入不确定，不赦免委派证据等其余判据，降级一律落盘结构化诊断 | 224 | 活跃 |
| FR-103 | 委派证据源换为 PostToolUse hook 实时追加的会话证据账本（`.specify/runs/.fix-compliance-ledger/<sessionId>.jsonl`）；采集器任何失败路径均 exit 0，账本空或缺失时判定器等价回退变更前 transcript 证据路径 | 270 | 活跃 |
| FR-104 | 「在途」判定改用 Stop payload 的 `background_tasks` 原生字段，实现 in-flight（数组非空）/ no-in-flight（空数组）/ undetermined（键缺席）三态互不坍缩，取代次数预算式猜测 | 270 | 活跃 |
| FR-105 | 锚点三分：`anchorLineIndex`（最晚任意技能展开）与 `isFix` 判据（最晚一次 `spec-driver-fix` 展开）解耦；`agent_id` 键缺席按结构性判据解释为主线程，`prompt_id` 不作为证据过滤键 | 270 | 活跃 |
| FR-106 | Tier 2 续做合同：`isFix===false` 时凭三条二级证据源绑定判定——resume 提名 / `Write`·`Edit` × `fix-report.md` 写入见证 / SubagentStop sidechain 标记；判定复用 `judgeCompliance` 但剔除 implement 委派豁免，verify 委派须 ≥1；Tier 1 逐字不变 | 289 | 活跃 |
| FR-107 | SubagentStop 检测 hook（薄壳 + 纯函数库）在子代理 transcript 检出 fix 展开（`isMeta===true`）时写会话内标记，标记只读不删（fail-closed）；登记为 Claude 独有，不分发到 Codex | 289 | 活跃 |
| FR-108 | 有效锚点（effective anchor）：Tier 1 取 fix 基线、Tier 2 取绑定锚点，一处统一供佐证 / 指纹 / 闸门三窗口计量，不给各消费点分别加分支 | 289 | 活跃 |
| FR-109 | `judge:doctor` 四态漂移检测（in-sync / drift / not-applicable / indeterminate）：两侧现算 sha256 字节级比对、不持久化"预期指纹"；active-version 按四级优先顺序解析（`CLAUDE_PLUGIN_ROOT` → `.specify/.spec-driver-path` → `installed_plugins.json` → indeterminate），禁「取最高版本号」兜底；drift 时仍退出码 0，只呈现状态不输出修复建议 | 236 | 活跃 |
| FR-110 | 判定器文件集合有守卫测试递归解析真实 import 闭包并断言与显式数组完全相等；doctor 比对集扩为 `DOCTOR_FILE_SET = JUDGE_FILE_SET ∪ SIDECHAIN_FILE_SET`，纳入此前不被判定器 import 的 SubagentStop 检测侧 CLI | 236, 290 | 活跃 |
| FR-111 | `judge:doctor` 新增 `--since <ref>` 增量漂移视图，区分「该 ref 之后引入」与「开工前已存在」；ref 无效须 fail-loud、ref 下文件不存在判为新增；不传 `--since` 时 stdout 与改动前逐字节一致 | 278 | 活跃 |
| FR-112 | 诊断码 enum 反向守卫：每个码须在 `scripts/` 下有产出点（三种已枚举形态）或在显式 allowlist 内，allowlist 陈旧亦判红 | 290 | 活跃 |
| FR-113 | Tier 2 阻断在 block / nonblock / uncorroborated 三个 arm 生成绑定原因文案（源标签 + 目录 + 续做合同说明），fail-open 早退审计事件新增 `tier` 字段，不新增诊断码 | 290 | 活跃 |
| FR-114 | `spec-driver-resume` 恢复点表新增 fix 目录分支（已完成 / Phase 4 / Phase 3 / Phase 2 / Phase 1 五级判定） | 290 | 活跃 |
| FR-115 | Codex 侧分发面：两个插件各有 `.codex-plugin/plugin.json`（metadata 来自 `contracts/release-contract.yaml`，不得手工独立维护）+ tracked `.agents/plugins/marketplace.json`，Codex 用户一次 `plugin add` 即获得 MCP + 全部 skills；spec-driver manifest 的 skills 指向 Codex 适配 wrapper 目录而非 canonical skills/ | 213 | 活跃 |
| FR-116 | 一致性矩阵（Codex manifest ↔ MCP 配置 ↔ skill 数量 ↔ marketplace 条目 ↔ canonical source）接入 `repo:check`，manifest 版本字段纳入 `release:check` 既有累加器；已知缺口以 `contracts/codex-plugin-consistency.yaml` 的显式 waiver 登记 | 213 | 活跃 |
| FR-117 | `hooks.json` 的 Codex 侧我方 owned 条目仅用 4 个已确证事件（SessionStart / PreToolUse / PostToolUse / Stop），第三方条目事件域不受限；两层事件门禁（schema 层全文件合法性 + 产品层仅约束我方条目）覆盖 canonical / 生成结果 / 最终安装文件三处校验对象 | 240 | 活跃 |
| FR-118 | `resolveCodexHome(deps)` 纯函数与 shell 对称实现（依赖注入必填、fail-loud，对齐 `codex doctor` 语义）；仅以家目录为基的路径改为消费该 helper，以仓库根/cwd 为基的路径明令不动 | 240 | 活跃 |
| FR-119 | `codex-runtime-doctor` 四方一致性诊断 CLI（仓库版本 / 全局 CLI / plugin build / MCP server）：判别式状态机 + 结构化 remediation + 结构性 typed value 脱敏，诊断不阻断 | 240 | 活跃 |
| FR-120 | Codex `hooks.json` 非破坏性合并写入器（保留第三方条目、幂等、可精确卸载、非法 JSON 拒绝覆写，对称复用 `hook-installer.ts` 七语义）；判定器遇不可解析的 Codex 格式 transcript 时落 loud 诊断而非静默判「非 fix 会话」，放行语义不变 | 240 | 活跃 |
| FR-121 | `drift link/check/unlink` CLI（经 `scripts/spec-drift-cli.mjs`，注册 `drift:link/check/unlink` 三个 npm script）：引用清单以 file-qualified `ref` 建锚，lock 持久化为 `.specify/spec-drift.lock.json` 只存绑定与预期指纹、不存运行时 status | 219 | 活跃 |
| FR-122 | drift 判据：C3 normalized symbol AST 指纹（注释 / JSDoc / 纯格式化不计入，AST 结构变化判 stale），`drift check` 仅按 lock 中已持久化的 canonical symbolId 精确匹配、不重新模糊解析；11 态状态矩阵各有独立 machineCode，ambiguous / unresolved 单独出现时 exitCode 必为 2；零 LLM 调用、指纹只存 lock 层不挂图节点 | 219 | 活跃 |
| FR-123 | `.worktreeinclude` 内容合同：仅允许 repo-relative 字面路径（禁 glob / 否定前缀 / 转义 / 目录条目）且必须是当前 worktree 下的 git ignored 路径；containment 校验拒绝绝对路径与 `..` 穿越，失败条目 skip + warning 不中断 sync，零仓库外读写；`SYMLINK_TARGETS` 固定 allowlist + 文件名 pattern 黑名单双防线 | 239 | 活跃 |
| FR-124 | `AGENTS.override.md` 承载本地私有指令（须被 git ignored，官方「同层二选一」前提），与 `AGENTS.md` 各自独立校验字节数 ≤ 32768（按 max 不按 sum） | 239 | 活跃 |
| FR-125 | `graph-bootstrap-status.json` 为唯一权威 graph freshness 合同：不缓存 stale 布尔值、现算复用四态（fresh / dirty / stale / unknown-provenance），并记录 `bootstrapSource` 四态；消除三套 provenance 并存导致的"图陈旧却被当 ready 用"静默降级 | 239 | 活跃 |
| FR-126 | `repo:check` 新增 `agent-tools:required`（8 条 frontmatter 结构断言）与 `gate-mounting:effective-config` 守护项；`get-gate-behavior` 输出新增 `mounted`（effective 侧挂载）/ `mounted_in_base`（base 侧挂载）字段与 `mounting_violations` | 277 | 活跃 |

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
| Stop hook 判定开销 | 单次判定 p95 < 100ms，零新增 LLM 调用与子代理委派 | 208 |
| overrides 解析耗时 | `resolveOrchestrationConfig()` 全链路 200ms 内完成（overrides 文件 ≤ 200 行） | 133 |
| 证据账本开销 | 账本体积 ≤ 1MB/会话、Stop 侧满账本读取 < 200ms、采集器单次 < 50ms | 270 |
| SubagentStop 单趟预算 | N=624 全量真实 sidechain 语料 in-process p99 = 4.19ms（冷启动 max ≈ 6.6–6.8ms，预算 10ms） | 289 |
| graph bootstrap 时限 | 成功腿 ≤ 60 秒（实测 4745ms / 失败腿 115ms） | 239 |

### 可靠性

- 子代理失败自动重试，超过阈值再交用户决策
- 并行调度失败自动回退串行，不中断整体流程
- sync 结果保持幂等，相同输入产生稳定输出（sync-merge-engine 确定性保证）
- 项目级模板同步不覆盖已有自定义模板
- 三层验证体系消除 silent failure 风险
- 改动后一致性自检捕获类型名/函数名/枚举值引用遗漏
- GATE_IMPLEMENT_MID 在大型 Feature 中途拦截偏移
- overrides 解析失败一律整份回退 base 配置并留 diagnostic，不半生效（133）
- KB 预查与证据账本采集器在任何失败路径下都 exit 0，不把可选能力变成阻断面（191, 270）
- 判定器 fail-open 按维度收窄，整体短路被显式禁止（否则等于送一条可主动触发的绕过；224）
- 解锁计时器双写（可擦快路径 + transcript 派生的不可擦 backstop），防清空状态文件导致会话卡死在 exit-2 循环（270）
- 账本缺席时判定结果与变更前证据路径等价，不因账本空/缺失而阻断（270）

### 兼容性

- 平台：macOS、Linux、Windows WSL
- 运行环境：Claude Code Plugin 体系 + Codex（通过 AGENTS.md 同步区块）
- Codex 运行时：`.codex-plugin/plugin.json` + marketplace catalog 分发，`CODEX_HOME` 由纯函数 helper 解析，hook 条目仅用 4 个已确证事件（213, 238, 240）
- Codex 项目指令字节预算：`AGENTS.md` / `AGENTS.override.md` 各自 ≤ 32768 bytes（239）
- Claude 独有 hook（SubagentStop）不分发到 Codex——Codex 无 `agent_transcript_path` 语义，分发过去只会静默空转（289）
- 项目语言：由 verify 阶段自动识别多种构建/测试系统
- 配置升级：新增字段默认向后兼容

### 可用性

- 所有阶段有清晰的进度提示和产出摘要
- 跳过或回退行为必须显式标注
- 命令、技能和目录命名保持统一，降低新成员认知负担
- 文档派生流程优先消费 current-spec，减少 README 与产品文档漂移
- Trace 日志提供执行过程的完整可追溯性
- effective config 展示让用户看到最终生效的配置及其来源
- overrides 报错自带修复引导：`schema-fallback` 命中 phase 字段时追加 hint，`generate-template` 一键给出完整合法模板（133, 136）
- 门禁不达标时输出结构化 missing keys 与 next-step 引导，而不是只报"不合规"（208, 216）
- 门禁降级与阻断一律可追溯：诊断落盘 + `tier` / `tier2Source` 字段 + 绑定原因文案（224, 289, 290）
- `judge:doctor` 只呈现状态不给修复指令，避免把"可见性工具"变成自动改机器的工具（236）

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
- Zod schema（编排配置 base / overrides / merged 三件套，共用同一类型定义）
- JSONL append-only 记录（证据账本、图消费审计、KB no-hit、regen 审计）
- `node:crypto` sha256（判定器快照字节级漂移判据，零新增 npm 依赖）
- ts-morph `Project`（drift 的 symbol 级 AST 指纹计算，只读复用不改 `ast-analyzer.ts`）
- `.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json`（Codex 侧分发 manifest 与安装入口）

### 项目结构

```text
plugins/spec-driver/
├── .claude-plugin/plugin.json
├── .codex-plugin/plugin.json        # Codex 侧对偶 manifest（metadata 源自 release contract）
├── contracts/
│   ├── wrapper-source-of-truth.yaml
│   ├── codex-plugin-consistency.yaml  # 一致性矩阵 + 已知缺口 waiver
│   ├── orchestration-schema.mjs       # Zod schema 三件套
│   └── release-contract.yaml
├── config/
│   └── orchestration.yaml          # 声明式 Phase / Gate / Context 配置
├── hooks/
│   ├── hooks.json                   # PreToolUse / PostToolUse / Stop / SubagentStop / Worktree
│   ├── stop-fix-compliance-check.sh   # 阻断型 Stop hook 薄壳
│   ├── post-tool-use-ledger.sh        # 证据账本采集器
│   ├── subagent-stop-fix-marker.sh    # sidechain 标记检测（Claude 独有）
│   └── *.sh
├── scripts/
│   ├── postinstall.sh
│   ├── init-project.sh
│   ├── codex-skills.sh
│   ├── sync-merge-engine.mjs       # 确定性合并脚本
│   ├── orchestrator-cli.mjs        # effective-orchestration / generate-template / get-gate-behavior
│   ├── fix-compliance-judge.mjs    # 门禁判定器（core / io 分层）
│   ├── judge-snapshot-doctor.mjs   # 判定器快照漂移四态（--since 增量视图）
│   ├── codex-runtime-doctor.mjs    # Codex 四方一致性诊断
│   ├── kb-prequery.mjs             # KB 确定性预查编排
│   ├── goal-loop-core.mjs          # goal_loop 12 个纯函数决策核心
│   ├── validate-wrapper-sources.mjs
│   └── lib/                         # 共享 YAML / artifact IO / patcher / diagnostics
│                                    # + ledger-writer / ledger-reader / in-flight-verdict
│                                    # + fix-compliance-sidechain-marker
├── skills-codex/                    # Codex 适配 wrapper（9/9，由 repo:sync 生成到 tracked 目录）
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
- 编排配置分层为 base（plugin 内） + overrides（项目 `.specify/`），合并结果附 `fieldSources` 与 `isFallback`，覆盖单向且不得反向改插件内文件
- 门禁判定器统一「纯函数 core + I/O 边界」两层（`fix-compliance-core` / `fix-compliance-io`），判定逻辑与文件系统 / transcript 读取解耦，可纯函数单测
- 门禁证据源分层：PostToolUse 账本优先、transcript 回退；在途判定取 Stop payload 原生字段；Tier 1（有展开）与 Tier 2（续做绑定）两级互斥
- doctor 类工具（`judge:doctor` / `codex-runtime-doctor`）共用同一形态：只读、显式 `projectRoot` 合同、判别式联合结果、诊断不阻断
- goal_loop 拆为「可单测确定性 core（停止判定 / 五维 delta / metric 分类 / 回滚命令规划）+ SKILL 散文编排层」，散文层只负责委派与执行
- 图消费从"盲目信任"改为先决策（`decideGraphConsumption`）：刷新走既有全量 graph-only，不新建增量建图引擎

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
| 客观记录优先于模型自陈 | 判据只取 harness 层客观记录（委派调用记录 / 磁盘制品 / tool_use↔tool_result 配对），模型自述文本零采信 | 208, 216, 270 |
| fail-open 按维度收窄 | 不确定时只让对应那一个判据转入不确定，整体短路等于送一条可主动触发的绕过 | 224, 289 |
| 对抗收敛而非单轮放行 | 门禁 / 判定器 / 安全类改动须「对抗→修订→再对抗」直到上一轮修订产物零新增 CRITICAL | 277, 289, 290 |
| 诚实登记优于纸面达成 | 未实现 / 移交 / 残余绕过面逐条登记，缺席的验证不写成通过 | 270, 277, 289 |
| 只做状态可见 | doctor 类工具不自动重装 / 同步 / 覆盖，也不输出修复指令 | 236, 278 |
| 分层覆盖单向 | 项目级 overrides 只能覆盖编排行为，不得反向修改 plugin 内文件；解析失败整份回退 base | 133 |
| 可选能力永不阻断 | KB 预查、账本采集、图消费决策等增强路径的任何失败都以 exit 0 收场 | 191, 241, 270 |

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
| 133 | overrides 能力边界 | phase 局部 patch、mode `extends` 派生、`parallel_groups` 成员覆盖、Prompt 级覆盖均不支持（MVP 外） | 设计约束 |
| 208 | 威胁模型 | 主动 sabotage 状态存储（chmod + tmpdir 占位）可诱导降级放行；威胁模型为遗弃 / 偷懒而非主动破坏 | 设计约束 |
| 216 | 证据门语义边界 | 不核验复现命令语义是否真对应症状（可执行一个约定必 PASS 但与症状无关的命令制造合规痕迹）；判定材料不可用（transcript 缺失 / 超大 / 损坏）时沿用 fail-open，构成残余绕过窗口 | 中风险 |
| 236 | 漂移判据 | 字节级 sha256，CRLF / BOM / 纯格式差异也判 drift；适用场景窄，仅面向同时具备仓库侧参照与本机已安装快照的 spec-driver 自身开发者 | 设计约束 |
| 270 | 病根未清 | GATE 暂停识别（FR-026~029）实测原样存活；状态竞态（FR-012）、PENDING 判定、snapshot-stale 分家、活性自检均未实现，移交后续卡 | 高风险 |
| 277 | 交付定性 | 68 条 FR 中已实现 50 / 已核验未违反 10 / 已裁剪 1 / 移交 4 / 未执行缺席 1 / 已违反 2；总体判定 NEEDS FIX（严格口径），定性为部分交付 | 高风险 |
| 289 | 阻断预算粒度 | 跨目标阻断预算仍为 per-session（非 per-target）：同会话 Fix-A 付满 2 次阻断后，全新 Fix-B 可复用该预算 0 往返降级放行（根治方案移交 M11 独立立卡） | 中风险 |
| 289 | 门禁覆盖上限 | sidechain 无提名不绑定（子代理展开 fix 但主 transcript 与标记都无处定位目录）；写入见证只认 `Write`/`Edit` × `fix-report.md`，heredoc / cp / `sed -i` 不绑定（刻意不扩以防复活 F257 绕过） | 设计约束 |
| 290 | 反向守卫假阴性 | verify 独立发现 2 处未收敛缺口：`stripComments` 不剥行尾注释；形态③「别名引用 ≥2 次」不要求任一引用是真实产出调用（已实测确认，建议后续小卡处理） | 中风险 |
| 219 | drift 能力边界 | 首发仅 TS/JS，不做 rename-follow（重命名后旧锚统一标 orphaned），不支持 member 粒度建锚；最小 graph 方案下跨文件模糊兜底不可用，误拼写一律落 unresolved；lock 中 orphaned 僵尸锚无自动清理 | 设计约束 |
| 240 | Codex 判定强度 | Codex 侧只解决可观测性（失效时留 loud 诊断），不提供独立于 transcript 的第二事实源，compliance 判定的安全强度未变 | 设计约束 |
| 241 | 图覆盖封顶 | `.mjs` 文件不进知识图谱，B4 接线代码自身落在 `.mjs`，该部分 grounding 命中率结构性封顶为 0；调用抽取器不下钻 inline arrow callback 实参，fresh 不等于 impact 覆盖完整 | 设计约束 |
| 191 | 确定性边界 | 可确定性测试的单元只是 `kb-prequery.mjs` 脚本本身，SKILL 接线是 markdown 编排指令、非 hook 级强制，不能保证 100% 不被跳过 | 设计约束 |
| 201 | goal_loop 残留风险 | reward hacking / 测试过拟合 / 长程局部最优仅靠人工 GATE_VERIFY + Layer 1.5 兜底，不消除；git 不追踪空目录，回滚后启动前已存在的空 untracked 目录不重建 | 中风险 |
| 213 | Codex hooks 运行时 | 未建立 Codex 侧 hooks 深度执行合同与端到端 payload 校验；原「Codex 不读插件包内 hooks」推断前提已被后续实测推翻（详见章 11） | 设计约束 |

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
| 133 | orchestrator CLI 文件膨胀待拆分；schema `.passthrough()` 应改 `.strip()`；`--diff` 重复调用 resolver 两次 | 中 |
| 219 | dist 陈旧（存在但落后 `src/`）未缓解，drift 可能静默用旧编译逻辑计算指纹，产出与当前源码不符的判定 | 中 |
| 238 | 模型字面量 grep 门禁的豁免粒度以文件为最小单位（整份文件豁免），行级留 follow-up；`DEFAULT_CODEX_MODEL` 惰性读取 `~/.codex/config.toml` 降级为 SHOULD | 低 |
| 239 | T038（全新干净 worktree 下 SC-001 双腿手工计时留痕）尚未补做，当前采信等价沙盒实测 | 中 |
| 241 | redaction 只覆盖结构上可判别的敏感形态，中文姓名 / 内部代号 / 自然语言口令等无结构特征内容无法遮蔽（已知且接受的残余） | 中 |
| 270 | 开工前 `judge:doctor` 已处于 drift 状态（4 处 mismatch），验收判据只能是相对基线的增量；账本读取器只产出委派类证据，见证 / 执行记录两条链维持现状 | 中 |
| 277 | 生产可达性检查（FR-010~013）整组移交后续卡；矩阵「类别」列由 plan 自判、无机器校验分类正确性；verify 子代理持有 Bash，只读性属自律而非工具层强制 | 中 |
| 290 | `DOCTOR_FILE_SET` 三种产出形态是对现状的枚举，新增第四种形态会误报零产出（误报方向为 fail-loud，可接受） | 低 |

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
| Stop hook 的 exit 2 阻断 + stderr 回注语义依赖当前 Claude Code CLI 行为（留 E2E spike 脚本作升级回归护栏） | 208, 216 | 中 |
| Stop payload 的 `background_tasks` 字段可作为"在途"权威信号，`agent_id` 键缺席可解释为主线程 | 270 | 中 |
| 证据账本不被蓄意删除（删账本可把门禁退回改动前强度，已声明为接受的边界） | 270 | 中 |
| Codex hooks 走目录约定（`<pluginRoot>/hooks/hooks.json`）而非 manifest 字段声明 | 213, 240 | 中 |
| 判定器的漂移只需"状态可见"即可被开发者自行消解，无需自动同步快照 | 236 | 低 |

### 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 验证命令本身配置错误导致假失败 | 中 | 中 | 提供自定义命令和诊断输出 + 超时保护 |
| 过度并行导致上下文不一致 | 低 | 中 | 并行仅用于已验证的并行组，失败立即串行回退 |
| 上游增量 spec 质量不稳导致 current-spec 偏差 | 中 | 中 | sync 中保留 `[推断]` / `[待补充]` 并鼓励 spec 收口 |
| 全局安装脚本路径再次漂移 | 低 | 中 | 统一路径发现机制并保留项目级回退 |
| orchestration.yaml 配置错误导致编排行为变异 | 中 | 高 | 完整的模式行为不变性测试 + Schema 校验 |
| 跨 Feature 文件冲突在大型团队中频繁触发 | 中 | 中 | analyze Agent Pass G 提前预警 + Git 合并策略配合 |
| 本机生效的门禁判定器仍是修复前的旧快照，修好的判据实际没跑 | 中 | 高 | `judge:doctor` 四态 + `--since <ref>` 增量视图，比对集含 SubagentStop 检测侧闭包（236, 278, 290） |
| 判定器 fail-open 面被主动构造绕过 | 中 | 高 | fail-open 按维度收窄 + 证据指纹路由 + GATE_DESIGN 对抗收敛循环 + 常设异构对抗档位（224, 277, 289） |
| goal_loop 自动迭代产出 reward hacking / 过拟合测试 | 中 | 高 | 人工 GATE_VERIFY 强护栏 + Layer 1.5 + 只消费独立 verify 子代理报告（201） |
| 阻断预算耗尽导致门禁行为翻转（误阻断或恒放行） | 中 | 高 | 在途改用 harness 原生三态 + 账本实时证据 + 有界降级 + 不可擦 backstop（270, 289） |
| KB 检索内容携带注入指令污染设计上下文 | 低 | 高 | `[KB-EVIDENCE]` envelope + 非指令硬约束前导句 + 字符级 cap（191） |
| spec 引用与代码漂移在合并后才被发现 | 中 | 中 | `drift check` 接入 `repo:check` 第 13 检查族，`--strict` 透传（219） |

---

## 11. 被废弃的功能

| 功能 | 原始描述 | 取代者 | 原因 |
|------|---------|--------|------|
| 单体 `speckitdriver` 技能 | 011 初始设计为大一统单技能 | 013: 多技能拆分 | 降低上下文体积，提升发现性 |
| `--resume` / `--sync` 作为 run 参数 | 011/012 初始设计 | 013: 独立 resume / sync 命令 | 不常用能力也需要明确入口 |
| `Speckit Driver Pro` 命名 | 011 初始显示名 | 014, 032: `Spec Driver` | 名称过重且残留不一致 |
| `speckit-*` 技能与命令前缀 | 历史命名体系 | 014, 032: `spec-driver-*` | 降低双命名并存造成的维护成本 |
| SKILL.md 内联编排逻辑 | 089 之前所有编排逻辑内嵌在 SKILL.md 中 | 089: orchestration.yaml 声明式配置 | 解耦编排配置与 prompt 内容 |
| 手写 `validateOrchestrationYaml()` | `orchestrator.mjs` 内手写的编排配置校验函数 | 133: `orchestrationBaseSchema`（Zod schema 三件套） | 校验规则与类型定义同源，base 校验迁移完成 |
| F189 drift prototype 三模块 | `specs/189-*/prototype/` 的 point-anchor / fingerprint / resolve 原型 | 219: 生产 CLI `drift link/check/unlink` | check 侧重构为「精确匹配、不重新 fuzzy 解析」，修正 ambiguous/unresolved 曾可能被误读为 exitCode 0 的隐患 |
| F193 graph provenance sidecar | `specs/_meta/.graph-source-commit` | 239: `graph-bootstrap-status.json` | 三套 provenance 并存会造成"图陈旧却被当 ready 用"；选完全移除而非同步更新，遗留文件在新状态落盘后清理 |
| `spec-driver-refactor-codex-wrapper-gap` waiver | 213 登记的 9 canonical 对 8 Codex wrapper 缺口 | 238: 补齐第 9 个 wrapper（9/9 全覆盖） | 缺口已实际关闭，waiver 不再需要 |
| 「探测结果固化进 wrapper 正文」初版设计 | 238 初版拟按本机 capability 探测结果分支生成 wrapper 文案 | 238 终版: capability-neutral 静态文案 + 本地 sidecar | 两处生成端各自维护文案会矛盾；tracked 分发目录含维护者机器探测结果会误导所有用户 |
| 「Codex 不读插件包内 hooks」推断前提 | 213 FR-006 的推断前提 | 264 实测: Codex hooks 走目录约定 `<pluginRoot>/hooks/hooks.json` | 该更正只修正前提，不改变 213 已交付的正文结论 |
| 以 `.specify/runs/` workflow-run-summary 作 compliance 主信号源 | 240 FR-004 原设计（替代 transcript 的第二事实源） | 240 自身撤回，SC-007 正式废止、由 SC-025 取代 | 已被实测与对抗审查双重证伪 |
| 门禁委派证据对 transcript 的单一依赖 | 208 起判定器只从 transcript 反推委派证据 | 270: PostToolUse 会话证据账本优先、账本缺席回退 transcript | 账本是 harness 实时记录，不受 transcript 形态变化影响（部分取代，非整体废弃） |
| 次数预算式「在途」猜测 | 以 `IN_FLIGHT_DEFER_LIMIT` 计数推测子代理是否仍在执行 | 270: Stop payload `background_tasks` 原生三态 | 预算式猜测会在连续派发时耗尽并翻转门禁行为（预算本身多数未动） |
| verify / spec-review 两套判定词表 | verify 3 取值与 spec-review 5 取值各自独立使用 | 277 FR-054/055: 统一取值集与归并方向 | 两套词表并存导致同一事实在不同阶段结论不可比 |
| 「手工在 README 补记」再生事实 | fixture 冷启动再生靠人工在 README 追记 | 278: `regen-audit.jsonl`（append-only sidecar） | 避免机器条目与人工论证混杂 |

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
| 41 | [133-orchestration-overrides](../../133-orchestration-overrides/spec.md) | FEATURE | 2026-04-26 | 项目可用一份 overrides 文件覆盖 gate 行为 / mode 流程 / 并发度，不用改 plugin 本体 |
| 42 | [136-orchestrator-template-hint](../../136-orchestrator-template-hint/spec.md) | FEATURE | [待补充] | `generate-template` 一键产出 mode override 完整模板，写错字段时报错附修复 hint |
| 43 | [191-scaffold-kb-research-injection](../../191-scaffold-kb-research-injection/spec.md) | FEATURE | 2026-06-14 | specify 阶段前自动用需求关键词查 KB，以带防注入约束的证据块注入设计上下文 |
| 44 | [200-m8-doc-closeout](../../200-m8-doc-closeout/spec.md) | STORY | [待补充] | （spec-driver 部分）modes 文档登记委派硬约束覆盖范围，configuration 文档补 phase 覆盖 caveat |
| 45 | [201-goal-loop-agent-mode](../../201-goal-loop-agent-mode/spec.md) | FEATURE | 2026-06-19 | feature 模式 implement 阶段可选启用 goal_loop 自主迭代闭环，人工在 GATE_VERIFY 收口 |
| 46 | [208-fix-mode-process-compliance](../../208-fix-mode-process-compliance/spec.md) | FEATURE | 2026-07-06 | 为 fix 模式增加住在模型上下文之外的阻断型机械收口检查，防仪式坍塌 |
| 47 | [213-codex-plugin-distribution](../../213-codex-plugin-distribution/spec.md) | FEATURE | 2026-07-20 | Codex 侧 manifest + marketplace catalog 一次安装即得 MCP + skills，一致性矩阵门禁守护分发面 |
| 48 | [216-fix-noop-evidence-gate](../../216-fix-noop-evidence-gate/spec.md) | FIX | 2026-07-20 | 给 fix 的「无需改动」出口加可执行证据门，堵住零执行痕迹的假 no-op |
| 49 | [219-spec-drift-production](../../219-spec-drift-production/spec.md) | FEATURE | 2026-07-21 | 新增 `drift link/check/unlink` 与 repo:check 第 13 检查族，用 symbol 级 AST 指纹侦测漂移 |
| 50 | [224-fix-compliance-judge-dir-resolution](../../224-fix-compliance-judge-dir-resolution/spec.md) | FIX | 2026-07-22 | 修复判定器无法跟随目录改名与原地编辑的两处解析盲区，fail-open 按维度收窄 |
| 51 | [236-judge-snapshot-drift-signal](../../236-judge-snapshot-drift-signal/spec.md) | STORY | 2026-07-24 | 一条 doctor 命令查明本机生效的门禁判定器代码是否还是修复前的旧版本 |
| 52 | [238-codex-wrapper-completeness](../../238-codex-wrapper-completeness/spec.md) | FEATURE | 2026-08-02 | 补齐 9/9 Codex wrapper，能力探测结果隔离到本地 sidecar，清理写死的模型版本号 |
| 53 | [239-worktree-local-state](../../239-worktree-local-state/spec.md) | FEATURE | 2026-08-02 | `.worktreeinclude` + `AGENTS.override.md` 承载 worktree 本地态，graph bootstrap 状态文件成唯一 freshness 合同 |
| 54 | [240-codex-runtime-closeout](../../240-codex-runtime-closeout/spec.md) | FEATURE | 2026-08-03 | 让 hooks 合约与 compliance 判定链在 Codex CLI 下真实生效或诚实降级，新增 CODEX_HOME 解析与四方一致性诊断 |
| 55 | [241-graph-keepalive-kb-grounding](../../241-graph-keepalive-kb-grounding/spec.md) | FEATURE | 2026-08-03 | impact/context 消费前先判定图该刷新 / 该降级 / 该跳过，而非盲目信任 |
| 56 | [270-compliance-evidence-ledger](../../270-compliance-evidence-ledger/spec.md) | FEATURE | 2026-08-31 | 门禁委派证据源换成 PostToolUse 实时账本，在途判定改用 harness 原生三态 |
| 57 | [277-spec-driver-engine-hardening](../../277-spec-driver-engine-hardening/spec.md) | FEATURE | 2026-09-01 | 为编排引擎加装 FR 对账矩阵与 GATE_DESIGN 收敛循环，防止流程走完但结论失实（部分交付） |
| 58 | [278-honest-tooling-patches](../../278-honest-tooling-patches/spec.md) | FEATURE | 2026-09-01 | （spec-driver 部分）`judge:doctor` 新增 `--since <ref>` 相对基线的增量漂移视图 |
| 59 | [289-fix-compliance-continuation-binding](../../289-fix-compliance-continuation-binding/spec.md) | FIX | [待补充] | 为 resume 续做 / 跨会话裸续做 / 子代理 sidechain 三类入口补上 Tier 2 续做合同判定 |
| 60 | [290-batch3-residuals-safe](../../290-batch3-residuals-safe/spec.md) | FIX | [待补充] | 收口批次 3 遗留的 5 项安全/可加性残余：doctor 闭包、锁竞态用例、enum 反向守卫、Tier 2 可观测性、resume fix 恢复 |

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
| **orchestration-overrides.yaml** | 项目级 `.specify/` 下的编排流程覆盖文件 |
| **effective config** | base 与 overrides 合并后最终生效的编排配置 |
| **fieldSources** | 记录 merged config 每个字段来源（base / overrides）的数据结构，精确到 gate 字段级 |
| **isFallback** | 标记本次是否因错误降级为纯 base 配置的布尔字段 |
| **goal_loop** | agent_mode 取值之一：implement↔verify 自主迭代直到 metric 达标 / 预算耗尽 / 无进展 |
| **五维 delta** | 判定"无进展"的五维 metric 变化向量（Layer 2 PASS 数 / P1 FR 覆盖率 / Layer 1.5 证据状态 / 回归数 / 改动量） |
| **轮次 snapshot（S_i）** | goal_loop 每轮 implement 前建立的可还原工作区锚点 |
| **decideGraphConsumption** | 图消费决策核心纯函数，五维输入 → 五种出口（consume / refresh / degraded / skip / unavailable） |
| **pre-implement advisory / pre-verify authoritative** | 图消费决策的双合同调用时点（非权威 vs 权威） |
| **仪式坍塌（ritual collapse）** | fix 会话读了 SKILL 但整体遗弃流程（0 委派 / 无制品）直接 cosplay 完成收口的现象 |
| **收口（closure）** | fix 会话结束时的最终状态判定动作；分「修复收口」与「no-op 收口」两种合法形态 |
| **ComplianceVerdict** | 判定结果结构，含 `compliant` / `closureForm` / `missing` / `enforcement` 等字段 |
| **[GATE-DEGRADED]** | 阻断达到上限（2 次）后降级放行时写入 reason 的标记 |
| **ExecutionRecord** | Bash `tool_use` / `tool_result` 配对后得到的复现执行记录数据合同 |
| **INCONCLUSIVE** | 受控断言模型中"命令确被执行但无法判定 PASS/FAIL"的中间态 |
| **missing keys** | 6 个互斥穷尽的证据缺失分类枚举，各自对应固定 next-step 反馈文案 |
| **候选特性目录** | 判定器从 transcript 反推的本次 fix 收口对应的 `specs/NNN-fix-<name>/` 路径 |
| **按维度收窄的 fail-open** | 只让 featureDir 判据维度转入不确定状态，不赦免委派证据等其余判据 |
| **会话证据账本（Compliance Evidence Ledger）** | PostToolUse hook 侧实时追加写入的结构化 JSONL 记录，作为委派证据的来源 |
| **在途三态** | `in-flight`（数组非空）/ `no-in-flight`（空数组）/ `undetermined`（键缺席），取代次数预算式猜测 |
| **锚点三分** | `anchorLineIndex`（最晚任意展开）与 `isFix` 判据（最晚一次 fix 展开）分离，修复展开覆盖误伤 |
| **不可擦 backstop** | 基于 transcript 派生单调量的解锁计时器兜底，防状态文件被删导致会话卡死 |
| **Tier 2 续做合同** | 无 fix 技能展开痕迹时，凭 resume 提名 / 裸写见证 / sidechain 标记三条二级证据源绑定判定的合规检查合同 |
| **有效锚点（effective anchor）** | Tier 1 取 fix 基线、Tier 2 取绑定锚点，统一喂给判定各消费点的窗口起点 |
| **sidechain 标记** | SubagentStop hook 在子代理 transcript 检出 fix 展开（`isMeta===true`）后写入的会话内标记文件 |
| **提名事件** | "合法候选 ∨ ambiguous ∨ 候选历史非空"这一存在性判据，区别于 `candidate.path !== null` |
| **四态结果（judge:doctor）** | in-sync / drift / not-applicable（无参照可比对）/ indeterminate（有参照但无法唯一确定） |
| **Judge File Set / DOCTOR_FILE_SET** | 判定器消费链上的文件路径集合；后者 = `JUDGE_FILE_SET ∪ SIDECHAIN_FILE_SET`，是 doctor 比对的事实源 |
| **byte-level 判据** | 逐字节 sha256 比对而非语义等价比对的漂移判据取舍 |
| **introduced vs pre-existing** | `--since <ref>` 视图对漂移的分类，区分"该 ref 之后新增"还是"开工前已存在" |
| **锚（Anchor）** | 持久化在 `spec-drift.lock.json` 的绑定记录，含 symbolId + fingerprint，不含运行时 status |
| **normalized symbol AST fingerprint** | 按 canonical token 规则对 symbol AST 子树序列化后计算的哈希（注释 / 格式不计入） |
| **状态矩阵（drift）** | 11 种 drift 状态的唯一权威定义源（fresh / stale / orphaned / ambiguous / unresolved / graph-stale 等） |
| **Codex Plugin Manifest** | `.codex-plugin/plugin.json`，Codex 侧对偶于 `.claude-plugin/plugin.json` 的 canonical manifest |
| **一致性矩阵（Consistency Matrix）** | 比对 Codex manifest ↔ MCP 配置 ↔ skill 数量 ↔ marketplace 条目 ↔ canonical source 的校验单元 |
| **已知缺口 Waiver** | 登记在 `contracts/codex-plugin-consistency.yaml` 中"当前允许存在但已追踪"的漂移项 |
| **capability-neutral** | wrapper 产物正文永远保持的、不因本机探测结果分支变化的静态指针文案 |
| **sidecar** | 本地生成并被 gitignore 排除的运行态产物文件（如 `.codex/spec-driver-capability.md`） |
| **modelFlagMode** | `required` / `delegate`，决定调用 codex 子进程时是否携带 `-m`/`--model` flag |
| **两层事件门禁** | schema 层（全文件事件名合法性）+ 产品层（仅约束我方 owned 条目范围）的独立判定，缺一不可 |
| **loud 诊断** | 判定器识别到不可解析的 transcript 格式时显式落盘的诊断事件，区别于静默失效 |
| **FR 覆盖矩阵** | 把 spec 每条 FR 映射到认领 Phase 的逐行对账表，含类别（实现型 / 约束型）与判定态 |
| **裁剪登记** | 矩阵中「未认领」FR 的显式声明不做记录，MUST 项裁剪须经 GATE_TASKS 单列成组显式接受 |
| **reverse-census（关键量反向普查）** | 对改动涉及的每个关键量列出全仓消费点清单，声明条数须与检索命令实际输出计数一致 |
| **推断前提登记** | spec / plan 中 `[推断]` 标记的关键前提清单，每条须配一条同命题的运行时验证命令 |
| **对抗收敛轮次记录** | GATE_DESIGN 收敛循环执行留痕，判据为「上一轮修订产物零新增 CRITICAL」而非固定轮数 |
| **knowledge_sources** | `project-context.yaml` 新增配置块，定义 KB 预查的厂商库 / 项目库路径与开关 |
| **`[KB-EVIDENCE]` envelope** | 包裹 KB 检索结果的证据信封格式，含 defang sentinel、来源标注与非指令硬约束前导句 |
| **.worktreeinclude** | 承载"copy 类"本地文件清单（含 secret）的官方机制文件，仅适用于 Codex 桌面应用管理的 worktree |
| **AGENTS.override.md** | 官方"同层二选一"语义文件，取代同层 `AGENTS.md`，承载本地私有指令 |
| **graph-bootstrap-status.json** | 唯一权威的 graph bootstrap 结构化状态文件（`specs/_meta/` 下，不入库） |
| **freshness 四态** | fresh / dirty / stale / unknown-provenance |

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
| 41 | 133-orchestration-overrides | FEATURE | [specs/133-orchestration-overrides/spec.md](../../133-orchestration-overrides/spec.md) |
| 42 | 136-orchestrator-template-hint | FEATURE | [specs/136-orchestrator-template-hint/spec.md](../../136-orchestrator-template-hint/spec.md) |
| 43 | 191-scaffold-kb-research-injection | FEATURE | [specs/191-scaffold-kb-research-injection/spec.md](../../191-scaffold-kb-research-injection/spec.md) |
| 44 | 200-m8-doc-closeout（跨产品，仅合并 spec-driver 部分） | STORY | [specs/200-m8-doc-closeout/spec.md](../../200-m8-doc-closeout/spec.md) |
| 45 | 201-goal-loop-agent-mode | FEATURE | [specs/201-goal-loop-agent-mode/spec.md](../../201-goal-loop-agent-mode/spec.md) |
| 46 | 208-fix-mode-process-compliance | FEATURE | [specs/208-fix-mode-process-compliance/spec.md](../../208-fix-mode-process-compliance/spec.md) |
| 47 | 213-codex-plugin-distribution | FEATURE | [specs/213-codex-plugin-distribution/spec.md](../../213-codex-plugin-distribution/spec.md) |
| 48 | 216-fix-noop-evidence-gate | FIX | [specs/216-fix-noop-evidence-gate/spec.md](../../216-fix-noop-evidence-gate/spec.md) |
| 49 | 219-spec-drift-production | FEATURE | [specs/219-spec-drift-production/spec.md](../../219-spec-drift-production/spec.md) |
| 50 | 224-fix-compliance-judge-dir-resolution | FIX | [specs/224-fix-compliance-judge-dir-resolution/spec.md](../../224-fix-compliance-judge-dir-resolution/spec.md) |
| 51 | 236-judge-snapshot-drift-signal | STORY | [specs/236-judge-snapshot-drift-signal/spec.md](../../236-judge-snapshot-drift-signal/spec.md) |
| 52 | 238-codex-wrapper-completeness | FEATURE | [specs/238-codex-wrapper-completeness/spec.md](../../238-codex-wrapper-completeness/spec.md) |
| 53 | 239-worktree-local-state | FEATURE | [specs/239-worktree-local-state/spec.md](../../239-worktree-local-state/spec.md) |
| 54 | 240-codex-runtime-closeout | FEATURE | [specs/240-codex-runtime-closeout/spec.md](../../240-codex-runtime-closeout/spec.md) |
| 55 | 241-graph-keepalive-kb-grounding | FEATURE | [specs/241-graph-keepalive-kb-grounding/spec.md](../../241-graph-keepalive-kb-grounding/spec.md) |
| 56 | 270-compliance-evidence-ledger | FEATURE | [specs/270-compliance-evidence-ledger/spec.md](../../270-compliance-evidence-ledger/spec.md) |
| 57 | 277-spec-driver-engine-hardening | FEATURE | [specs/277-spec-driver-engine-hardening/spec.md](../../277-spec-driver-engine-hardening/spec.md) |
| 58 | 278-honest-tooling-patches（跨产品，仅合并 spec-driver 部分） | FEATURE | [specs/278-honest-tooling-patches/spec.md](../../278-honest-tooling-patches/spec.md) |
| 59 | 289-fix-compliance-continuation-binding | FIX | [specs/289-fix-compliance-continuation-binding/spec.md](../../289-fix-compliance-continuation-binding/spec.md) |
| 60 | 290-batch3-residuals-safe | FIX | [specs/290-batch3-residuals-safe/spec.md](../../290-batch3-residuals-safe/spec.md) |

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
- 让项目按自己的流程需要覆盖编排行为，而不必 fork plugin 本体
- 让 fix 流程"是否真的被执行过"变成可机械判定、可阻断、可追溯的事实
- 让 Codex CLI 用户用同一套 skill 与 MCP，且分发面由门禁守护不漂移

**新增命令与产物（已落地）**：

| 面 | 内容 | 来源 |
|----|------|------|
| CLI 子命令 | `orchestrator-cli.mjs effective-orchestration <mode>`（`--annotate` / `--diff` / `--format yaml\|json` / `--project-root`）、`generate-template <mode>`、`get-gate-behavior`（输出含 `mounted` / `mounted_in_base`） | 133, 136, 277 |
| CLI 命令 | `npm run judge:doctor`（四态输出，支持 `--project-root` 与 `--since <ref>`） | 236, 278 |
| CLI 命令 | `codex-runtime-doctor.mjs`（Codex 四方一致性诊断，支持 `--format` / `--strict`） | 240 |
| CLI 命令 | `npm run drift:link` / `drift:check` / `drift:unlink`（支持 `--refresh`、`--help`、`--format json`） | 219 |
| CLI 子命令 | `goal-loop-cli.mjs`（`decide-stop` / `classify-report` / `plan-snapshot` / `plan-rollback` 等）、图消费 `decide` / `annotate-caveat` | 201, 241 |
| 配置文件 | `.specify/orchestration-overrides.yaml`（含 `orchestration-overrides.example.yaml` 示例模板） | 133 |
| 配置项 | `spec-driver.config.yaml` 新增 `fix_compliance`（block 默认 / warn / off）与 `goal_loop` 段（`max_iterations` / `no_progress_max_rounds` / `max_verify_seconds` / `max_tool_invocations`） | 208, 201 |
| 配置项 | `project-context.yaml` 新增 `knowledge_sources`（`enabled` / `vendor_kb` / `project_kb` / `top_k` / `max_inject_chars`） | 191 |
| Hook | 阻断型 Stop hook（`stop-fix-compliance-check.sh`）、PostToolUse 账本采集（`post-tool-use-ledger.sh`）、SubagentStop sidechain 标记（`subagent-stop-fix-marker.sh`，仅 Claude 侧） | 208, 270, 289 |
| Skill 行为 | `spec-driver-fix` 新增「确认无需改动」专用出口（轻量制品模板）+ Phase 1 强制亲自经 Bash 执行复现命令；fix-report「判定依据」章节改为逐声明对账行结构 | 208, 216 |
| Skill 行为 | `spec-driver-resume` 恢复点表新增 fix 目录的五级判定 | 290 |
| Skill 行为 | feature / story SKILL 在 specify 阶段前自动预查注入 KB 参考资料，无需子代理主动调用工具 | 191 |
| 模板产物 | plan / specify 模板新增具名章节：FR 覆盖矩阵、裁剪登记、关键量反向普查、推断前提登记 | 277 |
| 校验入口 | `repo:check` 新增 orchestration-overrides 校验、Codex 一致性矩阵、第 13 族 `spec-drift`（`--strict`）、第 14 族 `.worktreeinclude` 合同、`agent-tools:required`、`gate-mounting:effective-config`、模型字面量 grep 门禁；`release:check` 纳入 Codex manifest 版本字段 | 133, 213, 219, 238, 239, 277 |
| 落盘产物 | `.specify/spec-drift.lock.json`、`.specify/runs/.fix-compliance-ledger/<sessionId>.jsonl`、`.specify/graph-consumption-audit.jsonl`、`.specify/kb-nohit/`、`specs/_meta/graph-bootstrap-status.json`、`.codex/spec-driver-capability.md`（gitignored） | 219, 270, 241, 239, 238 |
| 分发面 | `plugins/spec-driver/.codex-plugin/plugin.json` + tracked `.agents/plugins/marketplace.json`；Codex 用户可 `codex plugin marketplace add` + `codex plugin add <plugin>@<market>` 一次获得 MCP + 9/9 skills | 213, 238 |
| 仓库根文件 | `.worktreeinclude`（受限安全子集）、`AGENTS.override.md`（gitignored） | 239 |
| 文档 | `docs/spec-driver-modes.md` 登记委派硬约束覆盖范围；`docs/configuration.md` 补 orchestration phase 覆盖「仅 feature 模式运行时生效」caveat | 200 |
