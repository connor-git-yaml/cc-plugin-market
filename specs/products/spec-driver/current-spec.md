# Spec Driver — 产品规范活文档

> **产品**: spec-driver
> **版本**: 聚合自 13 个增量 spec（011–022, 032）
> **最后聚合**: 2026-03-22
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

Spec Driver 是一个 **自治研发编排器 Plugin**。它把 Spec-Driven Development 的常见研发链路收敛为一套可复用的命令体系，覆盖 feature、story、fix、resume、sync、doc 六种模式，并以质量门、验证铁律、调研路由和产品活文档维持流程一致性。

当前产品的核心定位有三层：

- **研发编排层**：将需求从调研、规范、规划、实现推进到验证闭环
- **质量控制层**：通过门禁策略、验证铁律、双阶段审查与并行汇合点控制风险
- **知识聚合层**：通过 `spec-driver-sync` 将增量 spec 合并为产品级 `current-spec.md`，再为对外文档生成提供上游事实源

**核心价值**：

- 把多次手动技能调用压缩为一套稳定可追溯的流程
- 让 Feature / Story / Fix 三类常见研发路径都有明确最小闭环
- 把“验证是否真实执行”提升为硬约束，而不是口头承诺
- 让 `current-spec.md` 成为 README / 使用文档的事实源，而不是事后再拼装

---

## 2. 目标与成功指标

### 产品愿景

让 AI 协作研发从“会生成内容”升级到“会按流程推进、会留下制品、会给出验证证据、会沉淀产品事实层”。

### 产品级 KPI

| 指标 | 目标值 | 来源 |
|------|--------|------|
| 完整流程人工介入次数 | 仅发生在关键门禁与关键澄清点 | 011, 017 |
| story / fix 模式最小闭环 | 各自保持独立的快速路径 | 011 |
| 验证证据覆盖 | 完成声明必须附带新鲜验证证据 | 017 |
| 调研模式灵活性 | 支持 full / tech-only / product-only / codebase-scan / skip / custom | 018 |
| 并行加速 | verify / research / design-prep 三组可并行，失败回退串行 | 019 |
| 产品级聚合 | 生成 14 章节 `current-spec.md`，含对外文档摘要 | 012, 016, 022 |
| 模板可定制性 | 项目级 `.specify/templates/` 可覆盖调研模板 | 021 |
| 全局安装可用性 | 新项目中脚本路径发现不依赖仓库源码布局 | 020 |
| 命名一致性 | 对外命令、技能目录、元数据统一使用 `spec-driver-*` | 014, 032 |

---

## 3. 用户画像与场景

### 用户角色

| 角色 | 描述 | 主要使用场景 |
|------|------|------------|
| **功能开发者** | 要从一句需求推进到可验证交付 | `spec-driver-feature` |
| **快速迭代开发者** | 已有清晰范围，不需要完整调研 | `spec-driver-story` |
| **Bug 修复者** | 需要快速定位问题并完成修复闭环 | `spec-driver-fix` |
| **流程恢复者** | 上次流程中断后继续推进 | `spec-driver-resume` |
| **产品/文档负责人** | 需要维护产品事实源和对外文档 | `spec-driver-sync` + `spec-driver-doc` |

### 核心使用场景

1. **完整 Feature 编排**：Constitution → 调研 → 规范 → 澄清/检查 → 规划 → 任务 → 实现 → 审查 → 验证
2. **快速需求交付**：跳过重调研，压缩为 story 模式的快速交付链路
3. **快速修复闭环**：问题诊断、修复规划、修复实现与验证
4. **产品规范聚合**：从多份增量 spec 合并出产品级活文档
5. **文档派生**：让 README / 使用文档优先消费 `current-spec.md` 的事实摘要

---

## 4. 范围与边界

### 范围内

- Feature / Story / Fix / Resume / Sync / Doc 六种技能
- 10 阶段编排、质量门、验证铁律、双阶段审查
- 灵活调研路由、调研模板同步和项目级模板覆盖
- 并行子代理编排与串行回退
- 产品活文档聚合、product mapping 与对外文档摘要
- 项目级 `.specify/` 初始化与脚本路径发现
- 命名规范统一与技能元数据对齐

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

### FR-GROUP-2: 调研路由与门禁策略

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-006 | 6 种调研模式预设与智能推荐 | 018 | 活跃 |
| FR-007 | 设计硬门禁、三级门禁策略与门禁级独立配置 | 017 | 活跃 |
| FR-008 | skip / custom 等模式改变调研制品集合但不弱化后续设计门禁 | 017, 018 | 活跃 |
| FR-009 | 门禁决策输出结构化日志，保持可审计 | 017 | 活跃 |

### FR-GROUP-3: 验证铁律与并行化

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-010 | 完成声明必须包含当前上下文的新鲜验证证据 | 017 | 活跃 |
| FR-011 | 验证阶段拆分为 spec-review、quality-review、verify | 017 | 活跃 |
| FR-012 | verify group、research group、design-prep group 可并行调度 | 019 | 活跃 |
| FR-013 | 并行失败自动回退串行，并标注回退状态 | 019 | 活跃 |

### FR-GROUP-4: 知识聚合与文档派生

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-014 | `spec-driver-sync` 扫描 `specs/NNN-*` 并生成 `product-mapping.yaml` | 012 | 活跃 |
| FR-015 | `current-spec.md` 扩展到 14 章节模板 | 016 | 活跃 |
| FR-016 | `current-spec.md` 包含供 `spec-driver-doc` 消费的对外文档摘要 | 022 | 活跃 |
| FR-017 | `spec-driver-doc` 优先把 `current-spec.md` 作为产品事实源 | 022 | 活跃 |

### FR-GROUP-5: 项目引导与模板同步

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-018 | 初始化 `.specify/` 目录与项目模板 | 011 | 活跃 |
| FR-019 | 全局安装场景下脚本路径发现不依赖本地 `plugins/spec-driver/` | 020 | 活跃 |
| FR-020 | 调研模板同步到 `.specify/templates/` 且不覆盖用户自定义版本 | 021 | 活跃 |
| FR-021 | 子代理优先读取项目级调研模板，其次回退插件内置模板 | 021 | 活跃 |

### FR-GROUP-6: 命名与包装规范

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-022 | Plugin、Skill、命令名称统一为 `spec-driver-*` 前缀体系 | 014, 032 | 活跃 |
| FR-023 | `skills/spec-driver-*/SKILL.md` 与 `.codex/skills/` 名称保持一致 | 032 | 活跃 |
| FR-024 | `spec-driver` 作为产品显示名与插件注册名 | 014, 032 | 活跃 |

---

## 6. 非功能需求

### 性能

| 需求 | 目标 | 来源 |
|------|------|------|
| 完整编排的额外脚本开销 | 保持为轻量启动成本，主要耗时来自模型调用 | 011 |
| sync 上下文规模 | 远小于单体技能，保持低上下文占用 | 013, 016 |
| 并行阶段耗时收益 | verify / research / design-prep 明显优于串行 | 019 |
| doc 事实源复用 | 有 `current-spec.md` 时避免重复推断产品定位 | 022 |

### 可靠性

- 子代理失败自动重试，超过阈值再交用户决策
- 并行调度失败自动回退串行，不中断整体流程
- sync 结果保持幂等，相同输入产生稳定输出
- 项目级模板同步不覆盖已有自定义模板

### 兼容性

- 平台：macOS、Linux、Windows WSL
- 运行环境：Claude Code Plugin 体系
- 项目语言：由 verify 阶段自动识别多种构建/测试系统
- 配置升级：新增字段默认向后兼容

### 可用性

- 所有阶段有清晰的进度提示和产出摘要
- 跳过或回退行为必须显式标注
- 命令、技能和目录命名保持统一，降低新成员认知负担
- 文档派生流程优先消费 current-spec，减少 README 与产品文档漂移

---

## 7. 当前技术架构

### 技术栈

- Markdown SKILL / Agent prompts
- Bash 脚本（初始化、安装、扫描）
- YAML / JSON 配置
- `.specify/` 作为项目级持久化目录

### 项目结构

```text
plugins/spec-driver/
├── .claude-plugin/plugin.json
├── hooks/
├── scripts/
│   ├── postinstall.sh
│   └── init-project.sh
├── skills/
│   ├── spec-driver-feature/
│   ├── spec-driver-story/
│   ├── spec-driver-fix/
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
│   └── sync.md
└── templates/
```

### 架构要点

- 主编排器负责阶段推进、上下文注入、门禁决策与用户交互
- agents 目录承载阶段级子代理 prompt
- `sync` 与 `doc` 的契约从“松散关系”提升为“产品事实源 → 对外派生”
- `.specify/templates/` 允许项目级覆盖内置模板

---

## 8. 设计原则与决策记录

| 原则 | 说明 | 来源 |
|------|------|------|
| 流程优先于零散技巧 | 把研发能力固化为阶段，而不是依赖操作者记忆命令 | 011 |
| 证据优先于自述 | 验证通过必须来自实际运行输出 | 017 |
| 门禁显式化 | 让暂停、放行、失败都可追踪，不做隐式决策 | 017 |
| 并行可回退 | 并行是加速手段，不得改变业务语义 | 019 |
| 产品事实源单一化 | README / 使用文档不应再次发明产品语义 | 012, 016, 022 |

---

## 9. 已知限制与技术债

### 已知限制

| 来源 | 类别 | 描述 | 状态 |
|------|------|------|------|
| 011, 017 | 运行形态 | 产品本质是 prompt 编排器，执行质量依赖运行时与模型能力 | 设计约束 |
| 018 | 调研质量 | 调研模式越轻，产出的上下文完备性越弱 | 设计约束 |
| 022 | 文档聚合 | current-spec 质量取决于上游增量 spec 的质量 | 设计约束 |
| 020 | 路径发现 | 全局安装可用性已修复，但仍依赖插件缓存和脚本可执行权限 | 中风险 |

### 技术债

| 来源 | 描述 | 风险 |
|------|------|------|
| 021 | 项目级模板同步面继续扩大时，需要更明确的模板版本兼容策略 | 中 |
| 022 | sync / doc 的事实层契约已确立，但自动验证其一致性的门禁仍偏轻量 | 中 |
| 032 | 仓库外部历史材料可能仍残留 `speckit-*` 旧命名 | 低 |

---

## 10. 假设与风险

### 关键假设

| 假设 | 来源 | 风险等级 |
|------|------|---------|
| 用户项目允许写入 `.specify/` 与 `specs/` 目录 | 011, 012 | 低 |
| 目标项目具备可调用的构建 / 测试 / lint 工具链 | 011, 017 | 中 |
| 主编排器能从需求文本中得到足够清晰的调研模式推荐信号 | 018 | 中 |
| 用户接受 current-spec 作为对外文档的上游事实层 | 022 | 中 |

### 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 验证命令本身配置错误导致假失败 | 中 | 中 | 提供自定义命令和诊断输出 |
| 过度并行导致上下文不一致 | 低 | 中 | 并行仅用于已验证的并行组，失败立即串行回退 |
| 上游增量 spec 质量不稳导致 current-spec 偏差 | 中 | 中 | sync 中保留 `[推断]` / `[待补充]` 并鼓励 spec 收口 |
| 全局安装脚本路径再次漂移 | 低 | 中 | 统一路径发现机制并保留项目级回退 |

---

## 11. 被废弃的功能

| 功能 | 原始描述 | 取代者 | 原因 |
|------|---------|--------|------|
| 单体 `speckitdriver` 技能 | 011 初始设计为大一统单技能 | 013: 多技能拆分 | 降低上下文体积，提升发现性 |
| `--resume` / `--sync` 作为 run 参数 | 011/012 初始设计 | 013: 独立 resume / sync 命令 | 不常用能力也需要明确入口 |
| `Speckit Driver Pro` 命名 | 011 初始显示名 | 014, 032: `Spec Driver` | 名称过重且残留不一致 |
| `speckit-*` 技能与命令前缀 | 历史命名体系 | 014, 032: `spec-driver-*` | 降低双命名并存造成的维护成本 |

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

---

## 13. 术语表

| 术语 | 定义 |
|------|------|
| **主编排器** | 承担阶段推进、门禁决策与用户交互的主流程 |
| **子代理** | `agents/*.md` 中承载某个阶段职责的专用 prompt |
| **验证铁律** | 完成声明必须包含新鲜验证证据的约束 |
| **质量门** | 编排流程中的暂停 / 放行检查点 |
| **门禁策略** | strict / balanced / autonomous 三档全局门禁策略 |
| **调研模式** | full / tech-only / product-only / codebase-scan / skip / custom |
| **并行组** | 可同时执行并在 join point 汇合的一组子代理 |
| **产品映射** | `product-mapping.yaml` 中定义的 spec → product 归属关系 |
| **产品活文档** | `specs/products/<product>/current-spec.md`，用于沉淀产品事实 |
| **对外文档摘要** | current-spec 中供 doc 命令复用的 README / 使用文档摘要层 |

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

---

## 对外文档摘要（供 spec-driver-doc 使用）

Spec Driver 是一个把 Spec-Driven Development 流程编排成可执行命令的插件。它覆盖 feature、story、fix、resume、sync、doc 六类典型研发场景，并通过门禁、验证铁律和产品活文档保持流程一致性。

**主要价值主张**：

- 让需求到交付形成有阶段、有制品、有验证证据的闭环
- 把 `current-spec.md` 建成产品事实源，减少 README 与内部规范漂移
- 让重型编排、快速实现、快速修复和文档聚合各有清晰入口
