# reverse-spec / spec-driver — Codex 适配约定

本文件定义在 Codex 中运行本仓库能力时的统一约束，目标是在不牺牲现有功能语义的前提下保持双端兼容（Claude Code + Codex）。

## 1. 入口映射

- `reverse-spec` 能力优先走 CLI：
  - 单模块: `reverse-spec generate <target> --deep`
  - 批量: `reverse-spec batch [--force]`
  - 漂移: `reverse-spec diff <spec-file> <source-target>`
- 技能安装：
  - Claude: `reverse-spec init [--global] --target claude`
  - Codex: `reverse-spec init [--global] --target codex`
  - 双端: `reverse-spec init [--global] --target both`
- Spec Driver Codex 包装技能使用独立入口安装：
  - 推荐: `npm run codex:spec-driver:install` / `npm run codex:spec-driver:install:global`
  - 底层脚本: `bash plugins/spec-driver/scripts/codex-skills.sh install [--global]`

## 2. Spec Driver 兼容执行

`plugins/spec-driver/skills/*/SKILL.md` 的主流程保持不变；当运行环境缺少 Claude 的 `Task tool` 时，执行以下回退：

1. 将每次 `Task(...)` 视为“内联子代理调用”
2. 读取对应 `plugins/spec-driver/agents/<phase>.md`
3. 按 SKILL 中定义的上下文注入块补齐输入
4. 在当前会话完成该阶段，并写入相同产物路径
5. 原定义的并行组若无法并行，回退串行并显式标注 `[回退:串行]`
6. 模型选择按 `--preset -> agents.{agent_id}.model(仅显式配置时生效) -> preset 默认`，并通过 `model_compat` 做运行时映射（Codex 下支持 `opus/sonnet` 自动映射）

## 3. 产物与门禁不变性

- 目录和文件命名规范必须保持原样（`specs/<feature>/...`）
- 质量门（如 `GATE_DESIGN`、`GATE_VERIFY`）语义不得弱化
- 任何写操作仅限流程定义允许的产物路径，不得越界修改

## 3.1 目录结构约定

- `plugins/**` 是插件源码与模板源；优先改这里，不直接手改安装包装目录
- `.codex/`、`.claude/` 是运行时/分发包装层；若内容来自安装脚本，改 source 后重新生成
- `plugins/spec-driver/skills/**` 是 spec-driver Codex wrappers 的 canonical source；`.codex/skills/spec-driver-*/SKILL.md` 只通过安装脚本再生成
- `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` 是 spec-driver 包装层合同；`.claude/commands/spec-driver.*.md` 属于项目 override，不是 plugin source-of-truth
- `plugins/reverse-spec/skills/**` 是 reverse-spec Skill 的 canonical source；`src/skills-global/**` 与 `skills/**` 是兼容镜像，只通过同步脚本再生成
- `.specify/` 是项目级配置与运行态目录：
  - `templates/`、`workflows/`、`scorecards/` 可作为项目覆盖层
  - `runs/` 属于本地运行事件，不作为长期人工事实源
- `specs/<feature>/` 只放 feature / blueprint 制品
- `specs/products/<product>/current-spec.md` 是产品级人工事实正文
- `specs/products/<product>/_generated/` 只放该产品的机器生成产物（如 `entity`、`workflow-index`、`scorecard-report`、`quality-report`、`adoption-report`）
- `specs/products/_generated/` 只放跨产品索引（如 `catalog-index`、`scorecard-index`、`quality-report-index`）
- 若需调整生成产物路径，优先抽共享 helper，不要在多个脚本里重复硬编码

## 3.2 上下文归属约定

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-context-layering.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: context-layering -->
- `AGENTS.md` / `CLAUDE.md` 只放默认会进入上下文、且跨任务稳定的仓库级规则
- `.specify/project-context.yaml` 是 canonical Project Context；`.specify/project-context.md` 仅作为 legacy fallback，二者都只放项目级长期偏好、约束与参考资料，不承载 Spec 级执行策略
- 某条规则若在不使用 Spec Driver Skill 时也必须生效，就不应只写在 `Project Context`
- 成熟 `spec/plan` 的执行裁剪，应进入 `spec-driver-implement` 或具体 feature 制品，而不是写进 `Project Context`
<!-- END SHARED SECTION: context-layering -->

## 3.3 行为与交互约定

- 不要自行添加任何未明确要求的优化、重构、兜底逻辑或附加功能；原因：本仓库大量流程受 spec、gate 和生成合同约束，额外改动会无端扩大验证面。
- 不要在缺信息时猜测需求、实现、上下文或用户意图；原因：猜测会污染 spec、generated artifacts 和 review 结论。遇到盲区先查文件，仍无依据就明确说“不知道”。
- 不要在未完整读取目标文件前直接修改代码；原因：本仓库存在 source-of-truth、模板同步和包装层生成链路，凭记忆盲改很容易破坏合同。
- 不要把“能跑”当作审查结论；原因：做 review、验证和回归时，首要任务是主动找漏洞、异常分支、回归风险和合同漂移。
- 不要把核心判断外包给子代理或脚本；原因：执行可以分发，但架构判断、冲突取舍和最终结论必须在主线程收口。
- 不要把一次性授权外推成长期授权；原因：脚本执行、rebase、push、发布等都只对当次任务有效，后续操作需要重新判断。
- 不要一次性倾倒全部工具说明、系统背景或跨场景规则；原因：信息只按当前任务节点供给，避免噪声和上下文污染。
- 不要把 feature、fix、review、doc 等场景规则混成一个大池；原因：不同 skill / phase 的门禁、产物和验证面不同，规则应由对应场景文档承接。
- 不要擅自“规范化”输出格式、字段名、标题层级或标点；原因：仓库中的 Markdown 模板、YAML/JSON 合同和脚本解析经常依赖精确字面格式。
- 不要把 prompt、规范或执行说明写成无层级大段文本；原因：目标、约束、验证和示例应模块化组织，降低执行歧义。
- 不要泛滥调用通用工具；原因：优先使用仓内专用脚本、contract、skill 和 shared helper，只有缺少领域入口时再退回通用命令行。

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-release-contract.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: release-contract -->
## 发布合同约定

- 版本、plugin metadata、marketplace entry、产品级 release 文案的 canonical source 在 `contracts/release-contract.yaml`
- 需要更新这些字段时，优先改 contract，再运行 `npm run release:sync`
- 不要手工分别修改 `plugin.json`、`marketplace.json`、`package-lock.json`、README 里的受控 release 行
- 提交前运行 `npm run release:check`；仓库级 `check-plugin-sync.sh` 也会复核 release contract
<!-- END SHARED SECTION: release-contract -->

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-repo-maintenance.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: repo-maintenance -->
## 仓库级同步约定

- 触及 source-of-truth、包装层、共享片段、产品生成产物后，优先运行 `npm run repo:sync`
- 提交前运行 `npm run repo:check`；仓库级 `check-plugin-sync.sh` 已退化为对该校验链路的薄壳调用
- `.specify/runs/`、`.specify/.spec-driver-path`、`.claude/settings.local.json` 属于本地运行态，保持忽略，不要当作长期人工事实源
- `.claude/commands/**`、`.specify/project-context.yaml`、`.specify/templates/**` 属于受控项目层，修改前先确认不是某个 contract/sync 入口的生成产物
<!-- END SHARED SECTION: repo-maintenance -->

## 4. 版本号规范

插件版本号采用语义化版本（SemVer），每次变更时按以下规则 bump：

- **x.x.+1**（patch）：bug fix、配置修复等
- **x.+1.0**（minor）：新功能、功能增强
- **+1.0.0**（major）：不兼容的重大版本升级

适用于 reverse-spec、spec-driver 等所有插件的 `plugin.json` 版本字段。

## 5. 优先级规则

1. 优先遵循 `plugins/spec-driver/skills/*/SKILL.md` 的阶段定义
2. 需要实现细节时读取对应 `agents/*.md` 和 `templates/*`
3. 平台差异仅体现在“调度方式”，不改变业务流程语义

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-branch-sync-policy.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: branch-sync-policy -->
## 分支同步约定

- `feature/*`、`fix/*` 等开发分支在提交前，必须先同步最新 `master`
- 同步方式统一使用 `git rebase master`，不要把 `master` 直接 merge 回开发分支
- 推荐流程：`git checkout master` → `git pull --ff-only` → `git checkout <feature-or-fix-branch>` → `git rebase master`
- rebase 后先解决冲突并完成必要验证，再执行 commit / push
- 如果分支已经推送到远端，rebase 改写历史后使用 `git push --force-with-lease`
<!-- END SHARED SECTION: branch-sync-policy -->

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-mainline-focus.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: mainline-focus -->
## 当前主线焦点

- 当前 `master` 的活跃研发重心已经转到 `src/panoramic/` 蓝图文档链路，而不只是早期的 `reverse-spec` / `spec-driver` 通用能力维护
- Phase 1 已落地的关键能力包括：`WorkspaceIndexGenerator`（Feature 040）、`CrossPackageAnalyzer`（Feature 041）、LLM 语义增强 + 多格式输出（Feature 051）
- 处理 panoramic 相关任务时，优先沿用现有抽象：`ProjectContext`、`GeneratorRegistry`、`ParserRegistry`、`AbstractRegistry`、`AbstractConfigParser`
- 当前输出合同已覆盖 Markdown + JSON + Mermaid `.mmd`；涉及 LLM 增强时要保留 AST-only 的静默降级路径
<!-- END SHARED SECTION: mainline-focus -->

## Active Technologies
- TypeScript 5.7.3, Node.js >= 20 + 现有 panoramic generators、`handlebars`、`zod`、Node.js built-ins (045-architecture-overview-system-context)
- 文件系统（`specs/` 文档、`templates/`、`tests/`） (045-architecture-overview-system-context)
- TypeScript 5.7.3, Node.js >= 20 + 现有 panoramic generators、`handlebars`、`zod`、Node.js built-ins、现有 optional LLM auth/proxy helpers (050-pattern-hints-explanation)

## Recent Changes
- 045-architecture-overview-system-context: Added TypeScript 5.7.3, Node.js >= 20 + 现有 panoramic generators、`handlebars`、`zod`、Node.js built-ins
