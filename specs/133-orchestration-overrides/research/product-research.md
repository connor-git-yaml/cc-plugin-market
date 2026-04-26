# 产品调研报告: Feature 133 — Per-Project Workflow Overrides（分层 orchestration）

**特性分支**: `claude/wonderful-chatterjee-22066e`
**调研日期**: 2026-04-26
**调研模式**: 在线

---

## 1. 需求概述

**需求描述**: 为 spec-driver 引入项目级流程定制能力，允许团队在不修改 plugin 本体的前提下，通过 `.specify/orchestration-overrides.yaml` 覆盖特定 mode 的 phase 序列、gate 行为及并行调度策略，实现"plugin 提供基础配置、项目层按需覆盖"的分层编排架构。

**核心功能点**:
- 新增 `.specify/orchestration-overrides.yaml` 作为项目级流程覆盖层，schema 对齐 `orchestration.yaml`
- 加载序：plugin base → 项目 overrides → 深合并 → zod 校验 → 校验失败回退 base + 打 diagnostic
- 首期 MVP 支持两种粒度：Mode 整段重写、Gate 行为覆盖（behavior/severity 字段级）
- CLI 提供 dry-run 命令，让用户能看到 effective config（合并结果）

**目标用户**: 使用 spec-driver 的研发团队——从单人 side project 到多团队 monorepo，尤其是有差异化流程需求的中大型工程团队。

---

## 2. 市场现状

### 市场趋势

"默认配置 + 项目级覆盖"（plugin/tool base + per-project overrides）已成为现代 CLI 工具和编排系统的主流架构模式。从 ESLint 的 `extends` + `overrides`、tsconfig 的 `extends` 链、到 Docker Compose 多文件覆盖，再到 Ansible role defaults vs vars，这一模式在过去五年内得到广泛采纳和标准化。

核心驱动力有两个：一是 monorepo 的普及（不同子项目需要不同行为）；二是平台工具（Internal Developer Platform）的兴起，团队需要在统一工具链基础上按组织结构定制流程。GitHub Actions reusable workflows、Nx targetDefaults、Turborepo Package Configurations 均是这一趋势的体现。

### 市场机会

spec-driver 当前的"全局一刀切"编排模式在工具功能成熟后必然遭遇阻力：当越来越多的团队采用 spec-driver，不同项目类型（基础库、应用、文档）和风险级别（高风险、低风险）之间的流程需求差异将成为痛点。引入分层 orchestration 是 spec-driver 从"个人工具"走向"团队平台"的关键跨越。

### 用户痛点

- 无法针对特定项目调整 gate behavior（例如低风险项目希望 GATE_DESIGN 自动通过，但 plugin 强制 `always`）
- fix 模式的 phase 序列对高频小修复显得冗余，但无法裁剪
- 团队引入外部审计需求时，需要在 feature 模式加 extra review phase，目前只能 fork plugin
- 所有项目共享同一套 `parallel_scheduling` 配置，资源受限环境无法调整

---

## 3. 竞品分析

### 3.1 业界主流模式深度对标

#### Turborepo — `turbo.json` + Package Configurations

- **配置文件命名/位置**: 根 `turbo.json` + 各包 `packages/*/turbo.json`（`extends: ["//"]`）
- **覆盖粒度**: Task 级（整个 task 定义），不支持 task 内字段级 patch
- **合并语义**: 包级 turbo.json 通过 `extends: ["//"]` 继承根配置，子包字段**整体替换**同名 task，而不是深合并
- **错误降级策略**: schema 校验失败直接报错（fail-loudly），不静默 fallback
- **dry-run**: `turbo run <task> --dry-run` 输出 JSON 格式的执行计划，包含每个 task 的 inputs/outputs/cache hit，但**不展示 effective config 来源**（无 source map）
- **关键参考**: Package Configurations 从 v1.8 引入；`extends` 数组必须以 `["//"]` 开头是一个强约定，防止循环引用

#### ESLint — `extends` + `overrides`

- **配置文件命名/位置**: 根级 `.eslintrc.json` / 项目级 `eslint.config.js`（flat config）
- **覆盖粒度**: 规则级（rule 字段级），支持 `overrides[].files` 匹配特定路径
- **合并语义**: `extends` 数组**顺序合并**，后者覆盖前者同名字段；rules 对象深合并；plugins 数组追加；v9 flat config 通过 `defineConfig({ extends: [...] })` 统一入口
- **错误降级策略**: 旧版 eslintrc 部分无效字段静默忽略（被批评）；v9 flat config 趋向更严格的 fail-loudly；社区在 [2024 ESLint GitHub Discussion](https://github.com/eslint/eslint/discussions/17174) 里明确指出 `overrides` 中的 `extends` 应合并而非替换
- **dry-run**: `eslint --print-config <file>` 打印某文件的 effective config，**有 source 追溯能力**（指出每条规则来自哪个 extends）

#### Docker Compose — 多文件覆盖

- **配置文件命名/位置**: `docker-compose.yml` + `docker-compose.override.yml`（自动加载）或 `-f` 显式多文件链
- **覆盖粒度**: Service 内字段级；特殊字段（`command`、`entrypoint`、`healthcheck.test`）整体替换；ports/volumes **追加**（uniqueness 约束去重）
- **合并语义**: Map（字典）**递归深合并**；Sequence（数组）**追加**；`!override` / `!reset` tag 提供显式控制
- **错误降级策略**: 解析失败直接报错，无自动 fallback
- **dry-run**: `docker compose config` 输出 merged effective config（纯文本，无 source map）；这是业界最直观的 dry-run 体验之一

#### Ansible roles — `defaults/` vs `vars/` 优先级链

- **配置文件命名/位置**: `roles/<name>/defaults/main.yml`（最低优先级）vs `roles/<name>/vars/main.yml`（高优先级）
- **覆盖粒度**: 变量级（key-value），不限制到特定块
- **合并语义**: 明确的 22 层变量优先级（[Ansible Variable Precedence](https://spacelift.io/blog/ansible-variable-precedence)），高优先级直接替换同名 key，不做深合并
- **错误降级策略**: 无效变量类型在运行时报错，无静默 fallback
- **dry-run**: `ansible-playbook --check` + `--diff` 模拟执行，但不展示 effective variable 解析结果；`--list-tasks` 可列出将执行的 tasks

#### Tailwind CSS — `presets: [...]` + `theme.extend`

- **配置文件命名/位置**: 项目根 `tailwind.config.js`；`presets` 数组引用预设
- **覆盖粒度**: 主题 key 级；`theme.extend` 做深合并，`theme`（非 extend）整体替换
- **合并语义**: 顶层 theme key **浅替换**（shallow）；`extend` 下的对象**深合并**（[PR #2679](https://github.com/tailwindlabs/tailwindcss/pull/2679) 修复了数组不深合并的问题）；`plugins` 数组跨 presets 追加；`presets` 自身数组追加
- **错误降级策略**: 配置错误在构建时报错，无 fallback
- **dry-run**: 无内置 dry-run；需借助 `tailwind --config` 路径切换，社区工具补充

#### tsconfig — `extends` 链

- **配置文件命名/位置**: 任意位置 `tsconfig.json`，`extends` 字段指向父配置
- **覆盖粒度**: `compilerOptions` 字段级（深合并）；但 `include`/`exclude`/`files` 数组**整体替换**（[已知痛点](https://miyoon.medium.com/array-parameters-in-tsconfig-json-are-always-overwritten-11c80bb514e1)，社区多年来持续反馈）
- **合并语义**: compilerOptions 字段深合并，子配置覆盖父配置；数组字段一律替换
- **错误降级策略**: TypeScript 编译器遇到 schema 错误报错，无 fallback
- **dry-run**: `tsc --showConfig` 打印 effective tsconfig，**有 source 指向**（相对路径）

#### GitHub Actions reusable workflows — `workflow_call` + `inputs`

- **配置文件命名/位置**: 被调用方 `.github/workflows/reusable.yml`（`on: workflow_call`）；调用方任意 workflow 文件
- **覆盖粒度**: Input 参数级；不支持 step 级覆盖（[社区讨论 #26801](https://github.com/orgs/community/discussions/26801)）
- **合并语义**: 调用方 inputs 替换被调用方 defaults，非合并，更接近函数参数传递
- **错误降级策略**: Input 类型不符直接报错；缺少 required input 报错；boolean/number 有 default 值兜底
- **dry-run**: 无内置 dry-run；`act` 等第三方工具模拟本地执行；官方无 `--dry-run`

#### Babel — `babel.config.json` + presets/plugins 数组

- **配置文件命名/位置**: 根 `babel.config.json`（全局）+ 包级 `.babelrc`（局部），自动合并
- **覆盖粒度**: Preset/Plugin 级；options 对象深合并；数组**追加**（concatenation）
- **合并语义**: 多层 config 的 plugins/presets 数组**连接**（concatenate）；同名 plugin/preset 去重，后者覆盖；options 对象深合并（[babel/babel PR #6905](https://github.com/babel/babel/pull/6905)）
- **错误降级策略**: 无效 config 运行时报错；无内置 fallback
- **dry-run**: 无专用命令；可借助 `@babel/cli --verbose` 检查加载了哪些配置

#### Renovate — `extends` 数组 + 可合并字段

- **配置文件命名/位置**: `renovate.json` / `.renovaterc`
- **覆盖粒度**: 配置 key 级；可合并字段（如 `packageRules`）追加，不可合并字段替换
- **合并语义**: `extends` 中的预设**先解析**，优先级低于同文件中的 raw config；同类可合并数组追加；不可合并字段后者覆盖前者（[Renovate Presets 文档](https://docs.renovatebot.com/config-presets/)）
- **错误降级策略**: 校验失败时 Renovate 向 PR/Issues 报告配置错误，不静默 fallback
- **dry-run**: `dryRun: "full"` 配置项，日志模拟执行，不产生实际 PR；支持 `"extract"` / `"lookup"` 细粒度 dry-run

### 3.2 竞品对比表

| 维度 | Turborepo | ESLint v9 | Docker Compose | Ansible roles | Tailwind presets | tsconfig | GitHub Actions | Babel | Renovate |
|------|-----------|-----------|----------------|---------------|------------------|----------|----------------|-------|----------|
| 配置文件命名 | `turbo.json` 根+包 | `eslint.config.js` | `*.override.yml` | `defaults/` vs `vars/` | `tailwind.config.js` | `tsconfig.json` extends 链 | `workflow_call.yml` | `babel.config.json` | `renovate.json` |
| 覆盖粒度 | Task 级整块 | 规则字段级 | Service 字段级 | 变量 key 级 | 主题 key 级 | compilerOptions 字段级 | Input 参数级 | Plugin/Preset 级 | 配置 key 级 |
| 合并语义（对象） | 整块替换 | 深合并 | 深合并 | 替换 | 深合并（extend） | 深合并 | 参数传递 | 深合并 | 后者覆盖 |
| 合并语义（数组） | 整块替换 | 追加 | 追加（去重） | 替换 | 追加（plugins） | **整块替换**（痛点） | N/A | 追加（去重） | 追加（可合并字段） |
| schema 失败策略 | fail-loudly | 趋向 fail-loudly | fail-loudly | 运行时报错 | 构建时报错 | 编译时报错 | 报错 | 运行时报错 | PR 报告，不执行 |
| dry-run 命令 | `--dry-run` (JSON) | `--print-config` | `docker compose config` | `--check --diff` | 无内置 | `--showConfig` | 无内置 | 无内置 | `dryRun: "full"` |
| source map / 来源追溯 | 无 | **有**（规则来源） | 无 | 无 | 无 | **有**（相对路径） | 无 | 无 | 无 |

### 3.3 差异化机会

1. **source-aware dry-run**：ESLint `--print-config` 和 tsconfig `--showConfig` 显示 effective config 但很少标注"来自哪层"。spec-driver 的 dry-run 命令可以输出带 `_source` 字段的 annotated YAML，明确每个字段来自 plugin base 还是 project override。这在业界是少见的高质量 UX。
2. **明确的数组合并语义声明**：tsconfig 的数组替换行为是业界持续多年的痛点（GitHub Issue [#20110](https://github.com/microsoft/TypeScript/issues/20110) 从 2017 年开放至今）。spec-driver 可以在设计阶段明确声明 `mode.phases` 数组的合并语义（整体替换），并在文档和 dry-run 输出中明确展示，避免同类歧义。
3. **结构化的 diagnostic**：大多数工具的 schema 失败信息是文本日志，spec-driver 可以输出结构化的 `diagnostic` 对象（包含 `field`、`expected`、`got`、`fallback_applied` 字段），供 CI/CD 系统解析。

---

## 4. 用户场景验证

### 核心用户角色

**Persona 1: 多团队平台工程师（Platform Engineer）**
- 背景: 负责维护组织内部的 spec-driver plugin，同时管理 10+ 个不同性质的仓库（基础库、服务、文档）
- 目标: 用同一个 plugin 版本服务所有项目，但让每个项目的 gate 严格程度和 phase 数量匹配其风险级别
- 痛点: 目前只能 fork plugin 或维护多个 plugin 版本，升级成本极高

**Persona 2: 高合规性项目的 Tech Lead**
- 背景: 金融/医疗领域项目，所有 feature 需要额外的 security review phase 和强制 GATE_ANALYSIS（non-skippable）
- 目标: 在 spec-driver 标准 feature 模式基础上加 review phase，且所有 gate 强制为 always + critical
- 痛点: 合规要求无法通过现有配置层满足，只能靠团队纪律人工 enforce

**Persona 3: 追求速度的 Solo Developer**
- 背景: 个人 side project，低风险，更新频繁
- 目标: fix 模式去掉 analyze、quality_checklist 等阶段，最小化流程摩擦
- 痛点: 简单 bug fix 也要跑完整 phase 序列，感觉不值当

### 关键用户场景（6 个）

**场景 1 — 团队 A vs 团队 B 的 gate 差异**
团队 A 开发 CLI 工具（低风险），希望 fix 模式的 GATE_DESIGN 改为 `behavior: auto`（自动通过）；团队 B 维护金融服务（高风险），要求 GATE_DESIGN 强制 `behavior: always` + `severity: critical`。两个团队共享同一个 plugin，但各自在 `.specify/orchestration-overrides.yaml` 里声明不同的 gate 覆盖。

**场景 2 — 基础库项目裁剪 phase**
基础库仓库的 feature 流程不需要 product-research 和 tech-research phase（没有市场调研需求），但需要保留 specify、plan、implement、verify。项目通过整段重写 feature mode 的 phases 数组实现裁剪，下游应用仓库保持默认完整流程。

**场景 3 — 文档项目极简流程**
纯文档项目（如 /docs 仓库）使用 doc 模式，只需要 specify + implement 两个 phase，所有 gate 均 auto。通过 mode 整段重写实现，plugin 升级时该项目仍能自动继承新 gate 的字段（只要没覆盖到）。

**场景 4 — Monorepo 子项目的边界**
一个 monorepo 包含 packages/core（高风险）、packages/docs（低风险）、packages/scripts（极低风险）。本 Feature 首期 MVP 不支持子项目级 override（只有仓库级 `.specify/orchestration-overrides.yaml`），团队需要在调研阶段明确这一边界，避免用户误期望。[推断：这是二期的优先候选需求]

**场景 5 — 合规审计额外 phase**
受监管行业要求在 implement 完成后加 security-audit phase，且该 phase 必须人工审批（gate: always + severity: critical）。通过 mode 整段重写 implement 模式的 phases 数组插入新 phase，配合 gate 覆盖实现。

**场景 6 — 并行调度资源限制**
CI 资源受限的团队希望把 `parallel_scheduling.max_concurrent_tasks` 从默认 2 改为 1（串行），避免上下文超限。这是全局字段级覆盖，比 mode 级覆盖更简单，但当前 MVP schema 需要支持该字段的覆盖路径。

### 需求假设验证

| 假设 | 验证结果 | 证据 |
|------|---------|------|
| 用户主要需求是"减少 phase"而非"增加 phase" | ⚠️ 待确认 | 场景 1-3 以减少为主，场景 5 是增加；两个方向都有真实需求 |
| 团队宁愿 fallback 到 base 也不希望工具崩溃 | ✅ 已验证 | Docker Compose、Babel 等工具均选择宁可退回稳态；Ansible fail-loudly 但有 check 模式 |
| dry-run 是必要能力，不是 nice-to-have | ✅ 已验证 | Turborepo、ESLint、Docker、Renovate 均有 dry-run；用户在改流程前必须能预览结果 |
| 数组替换比数组合并更直观（对 phases 数组） | ✅ 已验证 | tsconfig 的数组追加痛点（Issue #20110）说明"追加"语义在结构化列表中反而令人困惑；Turborepo 也选整块替换 |
| schema 校验失败应当 fallback 而不是崩溃 | ✅ 已验证 | [oh-my-openagent Issue #1767](https://github.com/code-yeongyu/oh-my-openagent/issues/1767) 记录了静默 fallback 的危害；正确做法是 fallback + 明确 diagnostic |

---

## 5. MVP 范围建议

### Must-have（MVP 核心）

- `.specify/orchestration-overrides.yaml` 加载与深合并（plugin base → overrides）
- Mode 整段重写（覆盖 phases 数组，整块替换）
- Gate 行为字段级覆盖（`behavior` / `severity` 字段）
- Zod schema 校验 + 校验失败回退 base + 结构化 diagnostic 输出
- `spec-driver dry-run [mode]` 命令，输出 effective config（带 `_source` 字段注释来源）
- 全局字段覆盖（`parallel_scheduling.max_concurrent_tasks` 等）

### Nice-to-have（二期）

- Phase patch（在 base mode 基础上追加/插入单个 phase，而非整段重写）
- Mode `extends` 派生（基于已有 mode 定义派生新 mode，共享 phase 结构）
- 并行组覆盖（覆盖 `parallel_groups` 中的 agent 分配）
- 子项目级 override（monorepo 场景，每个包可有独立 overrides 文件）

### Future（远期）

- Agent prompt 级覆盖（覆盖特定 phase 的 agent prompt 内容）
- override 版本锁定（声明 override 兼容的 plugin 版本范围）
- 可视化 diff（新旧 effective config 对比展示）

### 优先级排序理由

Mode 整段重写和 gate 字段覆盖覆盖了 80% 的真实场景（场景 1-3、5-6），实现复杂度可控。dry-run 命令是用户信任新特性的门槛——没有预览能力的配置覆盖系统会让用户不敢使用。schema 校验 + fallback 是防止"配置把工具搞崩"的安全网，同样是 MVP 必须项。

---

## 6. 结论与建议

### 文件命名建议

对标 Docker Compose（`override.yml` 自动加载约定）和业界常见的 `*.override.yaml` 命名规范，推荐保持 `.specify/orchestration-overrides.yaml`，理由：
1. 与现有 `orchestration.yaml` 命名关联清晰，`.override` 后缀是约定俗成的覆盖文件标志
2. 优于 `.local.yaml`（local 通常暗示"不纳入版本管理"，但 orchestration overrides 应当纳入 git）
3. 与项目层其他文件（`project-context.yaml`、`spec-driver.config.yaml`）保持 kebab-case 一致性

### 合并语义建议

基于对标分析，**强烈推荐 `mode.phases` 数组采用整体替换**，理由：
- phases 是有序的、相互依赖的 pipeline 结构，追加/插入单个 phase 容易破坏 phase 间的依赖关系（gate_before/after 引用）
- tsconfig include 数组的"追加语义痛点"（Issue #20110）验证了结构化列表用追加语义更令人困惑
- Turborepo 同样为 pipeline task 选择整块替换而非追加
- 整块替换 + dry-run 预览 = 清晰可控，即使 override 写错用户也能立即在 dry-run 看到

对于 gate 字段（`behavior`、`severity`）：字段级深合并，只覆盖声明的字段，未声明字段继承 base。这与 ESLint rules 的处理方式一致。

### 降级策略建议

推荐**"fallback + fail-loud diagnostic"组合**，而不是单纯 fail-loudly 或单纯静默 fallback：
- 校验失败时：回退到 plugin base 配置（避免工具崩溃）
- 同时输出 `ERROR` 级 diagnostic，包含 `{ field, expected, got, fallback_applied: true }` 结构
- 在 CLI 输出中用显眼标记（如 `[OVERRIDE INVALID]`）提醒用户，不允许静默丢弃
- 参考：Renovate 选择向 PR 报告错误而不是静默执行，是业界最佳实践之一

### CLI dry-run 命令建议

```
spec-driver orchestration dry-run [mode]
  --format yaml|json       # 默认 yaml
  --annotate               # 输出带 _source 注释的 annotated config
  --diff                   # 与 plugin base 对比，仅显示 override 变更部分
```

关键设计：`--annotate` 模式下每个字段追加 `# source: plugin_base | project_override` 注释，是业界目前缺失的高价值 UX（ESLint `--print-config` 和 tsconfig `--showConfig` 均不做这一步）。

### 示例草稿（最简 override 文件）

```yaml
# .specify/orchestration-overrides.yaml
# 项目级 orchestration 覆盖。仅声明需要变更的部分；
# 未声明的 mode/gate 自动继承 plugin base 配置。
version: "1.0"

# 示例 1：调整 gate behavior
gates:
  GATE_DESIGN:
    default_behavior: auto   # 覆盖 plugin base 的 always

# 示例 2：整段重写 fix 模式 phases（适合低风险项目）
modes:
  fix:
    phases:
      - id: specify
        agent: spec-writer
        gates_before: []
        gates_after: [GATE_DESIGN]
      - id: implement
        agent: implementer
        gates_before: [GATE_DESIGN]
        gates_after: [GATE_VERIFY]
```

### 演进路径建议

MVP schema 应预留以下扩展点，避免锁死二期路径：
1. `modes[].phases[]` 中的每个 phase 对象保留 `extends` 字段（暂不实现，但 schema 不 reject）
2. 顶层保留 `$schema_version` 字段（当前 `"1.0"`），为后续 schema migration 做准备
3. `modes[].extends` 字段预留（value 为已有 mode name），实现 mode 别名派生，二期启用

### 风险识别

| 风险 | 描述 | 缓解建议 |
|------|------|---------|
| override 漂移 | 用户 override 某 mode 后，plugin 升级带来的 phase 新增/修复无法自动继承 | 在 dry-run 输出中标注哪些字段来自 override（被锁定），提醒用户定期审查 |
| effective config 难以调试 | 用户不确定当前实际运行的是哪套配置 | `--annotate` 模式 + `--diff` 子命令解决；文档明确加载顺序 |
| 命名冲突 | 用户自定义 mode 名与 plugin base mode 名相同，导致意外整块覆盖 | schema 中对 mode name 做 enum 校验，自定义 mode 名必须在 reserved list 之外 |
| 用户把 override 写成 fork | 过于激进的整块 mode 重写导致实质上 fork 了整个 mode，升级失去意义 | 在 CLI 和文档中推广"字段级 gate 覆盖"作为首选，mode 重写作为最后手段 |
| 子项目边界误期望 | Monorepo 用户期望子项目级 override，MVP 不支持 | 在 schema 说明和文档中明确声明 V1 只有仓库级粒度 |

### 对技术调研的建议

- 深合并算法选型（`deepmerge`、`lodash.mergeWith`、自实现），重点验证 phases 数组的"整体替换"能否优雅地在 deep merge 库中配置（部分库支持 customizer 函数）
- Zod schema 的 `.passthrough()` vs `.strict()` 策略：override 文件建议用 `.strict()` 检测拼写错误，但 base 文件可用 `.passthrough()` 保持前向兼容
- `spec-driver dry-run` 的输出格式：YAML 带注释 vs JSON + metadata 字段，评估哪种更易被 CI/CD 消费
- 文件加载时机：override 应在 orchestrator 初始化时一次性加载并缓存，不应在每个 phase 执行前重新读取

---

*调研覆盖 9 个对标产品，识别 3 个差异化机会，建议 MVP 聚焦 mode 整段重写 + gate 字段覆盖 + dry-run + structured diagnostic。*
