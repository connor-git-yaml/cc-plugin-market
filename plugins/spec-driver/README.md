# Spec Driver

> 当前发布版本: v3.10.1

**自治研发编排器** — 支持 8 种模式（feature/implement/story/fix/resume/sync/doc/refactor），一键触发 Spec-Driven Development 全流程。基于 orchestration.yaml 配置驱动，含 6 个质量门禁和 15 个专业子代理。

## 功能概述

Spec Driver 根据场景选择最优流程，将手动 spec-driver 命令统一为一次触发：

| 模式 | 命令 | 阶段数 | 人工介入 | 适用场景 |
|------|------|--------|----------|---------|
| **feature** | `/spec-driver:spec-driver-feature` | 10 | ≤ 4 次 | 全新功能、大型需求（含调研） |
| **implement** | `/spec-driver:spec-driver-implement` | 6 | ≤ 2 次 | spec/plan 已成熟，先做合同检查再聚焦实施 |
| **story** | `/spec-driver:spec-driver-story` | 5 | ≤ 2 次 | 常规需求变更、功能迭代 |
| **fix** | `/spec-driver:spec-driver-fix` | 4 | ≤ 1 次 | Bug 修复、问题定位 |
| **refactor** | `/spec-driver:spec-driver-refactor` | 5 | ≤ 2 次 | 大规模重构（分批执行+残留扫描） |
| **resume** | `/spec-driver:spec-driver-resume` | - | - | 恢复中断的流程 |
| **sync** | `/spec-driver:spec-driver-sync` | 3 | 0 次 | 聚合 spec 为产品活文档 |
| **doc** | `/spec-driver:spec-driver-doc` | 7 | 2-3 次 | 生成开源标准文档（README 等） |

## 安装

```bash
claude plugin install spec-driver
```

### Codex 包装技能（独立入口）

在仓库根目录执行：

```bash
npm run codex:spec-driver:install
npm run codex:spec-driver:install:global
npm run codex:spec-driver:remove
```

等价底层脚本命令（`$PLUGIN_DIR` 由 `.specify/.spec-driver-path` 解析或回退为 `plugins/spec-driver`）：

```bash
bash "$PLUGIN_DIR/scripts/codex-skills.sh" install
bash "$PLUGIN_DIR/scripts/codex-skills.sh" install --global
bash "$PLUGIN_DIR/scripts/codex-skills.sh" remove
bash "$PLUGIN_DIR/scripts/codex-skills.sh" remove --global
```

安装时会同步当前 `spec-driver-*` 源 Skill 的描述与正文，只叠加最小的 Codex 运行时适配说明；升级 Spec Driver 后重新执行 `install` 可刷新已安装的 Codex Skill。

### 包装来源约定

- `plugins/spec-driver/skills/**` 是 `spec-driver-*` Codex wrapper 的 canonical source
- `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` 定义 wrapper / metadata / project override 的 source-of-truth 合同
- `.codex/skills/spec-driver-*/SKILL.md` 是安装脚本生成的包装层，不应直接手改
- `.claude/commands/spec-driver.*.md` 是仓库级项目 override，可按项目需要调整，但它们不是插件 Skill 的 canonical source

仓库维护者可用下面的命令重建并校验包装层：

```bash
npm run codex:spec-driver:install
npm run spec-driver:check:wrappers
```

若本次变更同时涉及共享片段、release contract、产品级 `_generated` 产物或 reverse-spec skill mirrors，优先直接运行：

```bash
npm run repo:sync
npm run repo:check
```

除 7 个主流程 Skill 外，Codex 安装包还会附带一个 bootstrap helper：

```text
$spec-driver-constitution [原则更新说明]
```

用于在项目缺少 `.specify/memory/constitution.md` 时补建或更新项目宪法；Claude 中对应命令为 `/spec-driver.constitution`。

Codex 包装技能会通过共享 resolver 读取项目级上下文文件：

- `.specify/project-context.yaml`：canonical source
- `.specify/project-context.md`：legacy fallback，仅在缺少 YAML 时读取

若两者并存，resolver 只读取 YAML 并返回迁移 warning。运行时只注入 `project-context` 中声明且有效的路径；路径失效时会标注 `[参考路径缺失]` 并在最终报告提示风险。

如果 `spec-driver-sync` 已生成建议文件：

- `.specify/project-context.suggestions.yaml`
- `.specify/project-context.suggestions.md`

则 `feature / implement / sync` 会把其中内容作为 **advisory-only** 上下文建议注入；它们不会覆盖用户显式输入，也不会自动改写 canonical `project-context`。

此外，项目初始化会预创建最小 `.specify/project-context.yaml` 与 `.specify/runs/`；后者供 `record-workflow-run.mjs` 记录最小运行摘要，这些运行日志默认只保留本地，不需要提交到 Git。

## 使用方法

### 完整研发流程（run）

```bash
/spec-driver:spec-driver-feature 给项目添加用户认证功能，支持 OAuth2 和 JWT
```

10 阶段编排：Constitution → 产品调研 → 技术调研 → 产研汇总 → 规范 → 澄清 → 规划 → 任务 → 实现 → 验证

### 成熟 Spec 聚焦实施（implement）

```bash
/spec-driver:spec-driver-implement 072-spec-driver-implement
```

6 阶段聚焦实施：Intake → Plan Review → Task Refinement → Implementation → Verification → Closure。**要求现成 `spec.md + plan.md`**，不重复开启完整调研链路；若输入不足，会明确提示回退到 feature 或 story。

### 快速需求实现（story）

```bash
/spec-driver:spec-driver-story 给用户列表添加分页功能
```

5 阶段快速通道：Constitution → 规范（基于代码分析）→ 规划+任务 → 实现 → 验证。**跳过调研阶段**，直接分析现有代码和 spec 文档。

### 快速问题修复（fix）

```bash
/spec-driver:spec-driver-fix 登录页面在移动端布局错位
```

4 阶段极速修复：诊断（根因定位）→ 修复规划 → 代码修复 → 验证。自动分析代码和 spec 定位根因，修复后自动同步 spec。

### 恢复中断的流程（resume）

```bash
/spec-driver:spec-driver-resume
```

### 产品规范聚合（sync）

```bash
/spec-driver:spec-driver-sync
```

除刷新 `current-spec`、Catalog、quality / scorecard / adoption 产物外，`sync` 还会生成 `.specify/project-context.suggestions.yaml|md`，把治理与使用反馈转成可 review 的长期上下文建议。

### 开源文档生成（doc）

```bash
/spec-driver:spec-driver-doc
```

交互式生成 README.md、LICENSE、CONTRIBUTING.md 等开源标准文档，支持冲突检测和备份。

### 大规模重构（refactor）

```bash
/spec-driver:spec-driver-refactor --target src/parsers "拆分为 core 和 extensions"
/spec-driver:spec-driver-refactor --target CodeSkeleton --dry-run "重命名为 ASTNode"
```

5 阶段分批重构：影响分析 → 分批规划 → 逐批实现+中间验证 → 全量残留扫描 → 最终验证。

- `--target`：指定重构目标（文件路径、目录、模块名或概念名）
- `--batch-size`：控制每批最大文件数（默认 10）
- `--dry-run`：仅执行影响分析+分批规划，不进入实现
- 每批次完成后自动执行中间验证（类型检查 + 残留扫描）
- 全量残留扫描确保旧名称零残留

### 选择性重跑

```bash
/spec-driver:spec-driver-feature --rerun plan
```

### 临时切换模型预设

```bash
/spec-driver:spec-driver-feature --preset quality-first "添加支付系统"
```

## 模型配置

三种预设模式，通过 `spec-driver.config.yaml` 配置：

| 预设 | 重分析任务 | 执行任务 | 适用场景 |
|------|-----------|---------|---------|
| **balanced**（默认） | Opus | Sonnet | 日常开发 |
| **quality-first** | Opus | Opus | 关键功能 |
| **cost-efficient** | Sonnet | Sonnet | 探索性需求 |

默认建议只配置 `preset`，保持所有子代理按预设自动选模；仅在确有需要时再单独开启 `agents.<agent>.model` 覆盖。

为兼容 Codex 运行时，建议在 `spec-driver.config.yaml` 增加模型兼容映射（保留 `opus/sonnet` 语义）：

```yaml
model_compat:
  runtime: auto  # auto | claude | codex
  aliases:
    codex:
      opus: gpt-5.4
      sonnet: gpt-5.4
      haiku: gpt-5.4
  defaults:
    codex: gpt-5.4

codex:
  service_tier: fast

codex_thinking:
  default_level: xhigh  # low | medium | high | xhigh
  level_map:
    opus: xhigh
    sonnet: high
    haiku: medium
```

说明：在 Codex 执行时，`opus/sonnet/haiku` 语义会先映射到 `gpt-5.4`，再通过 `codex_thinking` 选择思考等级，`codex.service_tier` 用于控制服务层级。

## 子代理列表

| 子代理 | 阶段 | 职责 |
|--------|------|------|
| constitution | Phase 0 | 宪法原则合规检查 |
| product-research | Phase 1a | 市场需求验证和竞品分析 |
| tech-research | Phase 1b | 架构方案选型和技术评估 |
| specify | Phase 2 | 生成结构化需求规范 |
| clarify | Phase 3 | 检测歧义并自动解决 |
| checklist | Phase 3.5 | 规范质量检查 |
| plan | Phase 4 | 技术规划和架构设计 |
| tasks | Phase 5 | 任务分解和依赖排序 |
| analyze | Phase 5.5 | 跨制品一致性分析 |
| implement | Phase 6 | 按任务清单实现代码 |
| spec-review | Phase 7a | Spec 合规审查 |
| quality-review | Phase 7b | 代码质量审查（含架构合理性与可读性） |
| verify | Phase 7 | 多语言构建/Lint/测试验证 |
| refactor-plan | refactor Phase 1-2 | 影响分析 + 分批规划 |
| sync | 聚合模式 | 产品规范聚合 |

## 验证支持的语言

JS/TS (npm/pnpm/yarn/bun)、Rust (Cargo)、Go、Python (pip/poetry/uv)、Java (Maven/Gradle)、Kotlin、Swift (SPM)、C/C++ (CMake/Make)、C# (.NET)、Elixir (Mix)、Ruby (Bundler)

## 编排架构

### orchestration.yaml（配置驱动编排）

所有 8 种模式的 Phase 序列、Gate 定义和并行组统一配置在 `config/orchestration.yaml` 中。SKILL.md 不再硬编码编排逻辑，而是通过 Orchestrator 查询配置。

```yaml
# 示例：查看 refactor 模式的 Phase 序列
node plugins/spec-driver/scripts/orchestrator-cli.mjs get-phases refactor
```

### 6 个质量门禁

| Gate | 说明 | 默认行为 |
|------|------|---------|
| GATE_RESEARCH | 调研完整性 | auto |
| GATE_DESIGN | 规范质量（feature 模式下为硬门禁） | always |
| GATE_ANALYSIS | 设计一致性 | on_failure |
| GATE_TASKS | 任务分解完整性 | always |
| GATE_IMPLEMENT_MID | 实现中期检查（>5 tasks 时在 50% 处触发） | on_failure |
| GATE_VERIFY | 最终验证综合门禁 | always |

Gate 行为通过 4-tier 优先级解析：`user_config > hard_gate > gate_policy > yaml_default`

### sync-merge-engine（确定性合并）

sync 模式的合并算法已从 Agent Prompt 提取为独立 MJS 脚本，确保合并行为确定性：

```bash
# 预览合并结果
node plugins/spec-driver/scripts/sync-merge-engine.mjs --project-root . --dry-run

# 执行合并
node plugins/spec-driver/scripts/sync-merge-engine.mjs --project-root . --json
```

## 与现有系统的关系

- **独立于 reverse-spec plugin**：Spec Driver 是正向研发工具，reverse-spec 是逆向分析工具，互补关系
- **共享 `.specify/memory/constitution.md`**：复用项目宪法
- **兼容已有 spec-driver skills**：检测到项目已有定制版 spec-driver skills 时优先使用
- **命令覆盖双端兼容**：阶段 prompt 覆盖同时支持 `.claude/commands/spec-driver.{phase}.md` 与 `.codex/commands/spec-driver.{phase}.md`

## 目录结构

```text
plugins/spec-driver/
├── .claude-plugin/plugin.json    # Plugin 元数据
├── hooks/hooks.json              # SessionStart hook
├── skills/
│   ├── spec-driver-feature/SKILL.md     # 完整 10 阶段编排
│   ├── spec-driver-implement/SKILL.md   # 成熟 spec/plan 聚焦实施
│   ├── spec-driver-story/SKILL.md       # 快速 5 阶段需求实现
│   ├── spec-driver-fix/SKILL.md         # 快速 4 阶段问题修复
│   ├── spec-driver-refactor/SKILL.md    # 大规模重构（分批+残留扫描）
│   ├── spec-driver-resume/SKILL.md      # 中断恢复
│   ├── spec-driver-sync/SKILL.md        # 产品规范聚合
│   ├── spec-driver-doc/SKILL.md         # 开源文档生成
│   └── spec-driver-constitution/        # Codex bootstrap helper 源 Skill
├── agents/                          # 15 个子代理 prompt（含 refactor-plan）
├── config/orchestration.yaml        # 8 种模式的 Phase/Gate/并行组配置
├── lib/
│   ├── orchestrator.mjs             # Orchestrator 核心（加载/查询/Gate 优先级）
│   └── orchestrator-fallback.mjs    # 后备配置（8 种模式最小 Phase）
├── templates/                       # initialize / research / config / license 模板
├── scripts/
│   ├── orchestrator-cli.mjs         # 编排配置 CLI 查询接口
│   ├── sync-merge-engine.mjs        # sync 确定性合并引擎
│   └── ...                          # 其他初始化/验证脚本
├── tests/orchestrator.test.mjs      # 编排器烟雾测试（32 用例）
└── README.md
```

### 迁移说明（v2.0.0）

Plugin 名称从 `speckit-driver-pro` 更名为 `speckitdriver`，新增 story 和 fix 快速模式：

| 旧命令 | 新命令 |
| ------ | ------ |
| `/speckit-driver-pro:run <需求>` | `/speckitdriver:run <需求>` |
| `/speckit-driver-pro:resume` | `/speckitdriver:resume` |
| `/speckit-driver-pro:sync` | `/speckitdriver:sync` |
| （新增） | `/speckitdriver:story <需求>` |
| （新增） | `/speckitdriver:fix <问题>` |

### 迁移说明（v3.0.0）

Plugin 名称从 `speckitdriver` 更名为 `spec-driver`，技能名统一为 `speckit-*` 前缀：

| 旧命令 (v2.0.0) | 新命令 (v3.0.0) |
| ------ | ------ |
| `/speckitdriver:run <需求>` | `/spec-driver:speckit-feature <需求>` |
| `/speckitdriver:story <需求>` | `/spec-driver:speckit-story <需求>` |
| `/speckitdriver:fix <问题>` | `/spec-driver:speckit-fix <问题>` |
| `/speckitdriver:resume` | `/spec-driver:speckit-resume` |
| `/speckitdriver:sync` | `/spec-driver:speckit-sync` |

### 迁移说明（v3.4.0）

技能名和命令文件前缀从 `speckit-*` 统一为 `spec-driver-*`，命令文件从 `speckit.*` 统一为 `spec-driver.*`：

| 旧命令 (v3.0.0-v3.3.x) | 新命令 (v3.4.0+) |
| ------ | ------ |
| `/spec-driver:speckit-feature <需求>` | `/spec-driver:spec-driver-feature <需求>` |
| `/spec-driver:speckit-story <需求>` | `/spec-driver:spec-driver-story <需求>` |
| `/spec-driver:speckit-fix <问题>` | `/spec-driver:spec-driver-fix <问题>` |
| `/spec-driver:speckit-resume` | `/spec-driver:spec-driver-resume` |
| `/spec-driver:speckit-sync` | `/spec-driver:spec-driver-sync` |
| `/spec-driver:speckit-doc` | `/spec-driver:spec-driver-doc` |
| `/speckit.specify` | `/spec-driver.specify` |
| `/speckit.plan` | `/spec-driver.plan` |
| `/speckit.tasks` | `/spec-driver.tasks` |
| `/speckit.implement` | `/spec-driver.implement` |
| `/speckit.analyze` | `/spec-driver.analyze` |
| `/speckit.checklist` | `/spec-driver.checklist` |
| `/speckit.clarify` | `/spec-driver.clarify` |
| `/speckit.constitution` | `/spec-driver.constitution` |
| `/speckit.taskstoissues` | `/spec-driver.taskstoissues` |

如果您在 `.claude/commands/` 或 `.codex/commands/` 中有自定义的 `speckit.*.md` 命令文件，请手动重命名为 `spec-driver.*.md` 以确保编排器正确发现。

### 迁移说明（v3.7.0）

`init-project.sh` 现在会在首次初始化时创建最小 `.specify/project-context.yaml`，并把 `.specify/project-context.md` 明确降级为 legacy fallback：

- 新项目：默认创建 `.specify/project-context.yaml`
- 存量仅有 `.specify/project-context.md` 的项目：继续兼容，但会在 resolver / suggestions 中收到迁移提示
- 同时存在 `.yaml` 与 `.md`：系统固定只读取 YAML，并提示清理 legacy Markdown

`Project Context suggestions` 仍然只生成到 `.specify/project-context.suggestions.yaml|md`，不会自动覆盖 canonical `project-context.yaml`。

### 当前结构状态

`spec-driver` 现在明确区分了三类资产：

- `plugins/spec-driver/skills/**`：插件 Skill 源
- `.codex/skills/spec-driver-*/SKILL.md`：由安装脚本生成的 Codex 包装层
- `.claude/commands/spec-driver.*.md`：仓库级项目 override

所有 Codex wrapper 都会写入 `Wrapper Source Contract` 头部，并通过 `validate-wrapper-sources.mjs` 校验是否仍与 canonical source 一致。

## 许可证

MIT
