# reverse-spec / spec-driver — Claude Code 运行时规则

TypeScript 5.x + Node.js 20.x+ 项目，详见 package.json。跨任务稳定的仓库级执行规则以 [AGENTS.md](AGENTS.md) 为准。

## Language Convention

- **所有文档、注释、commit message、PR 描述默认使用中文**
- 英文专有名词（如 AST、CodeSkeleton、Handlebars、Zod）保持原文，不翻译
- 代码标识符（变量名、函数名、类型名）使用英文
- 代码注释使用中文
- 生成 spec、plan、tasks 等设计文档时，正文内容使用中文，技术术语保持英文
- 使用 spec-driver 的方式执行需求变更和问题修复不允许直接修改源代码

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-behavior-rules.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: behavior-rules -->
## 行为与交互约定

- 不要自行添加未要求的优化、功能、清理或重构；原因：spec、gate 和生成合同会放大任何额外改动的验证面
- 不要猜测需求、实现或上下文；原因：猜测会污染事实源。查不到就明确说"不知道"
- 不要在没完整看过目标文件前直接动代码；原因：本仓库存在 source-of-truth 和包装层同步链路，盲改风险高
- 不要把审查理解成"证明它能跑"；原因：review 和验证默认先找漏洞、异常分支、回归和合同漂移
- 不要把核心判断交给子代理；原因：执行可分发，但关键取舍和最终结论必须在主线程收口
- 不要把一次授权当成长期授权；原因：执行脚本、rebase、push 等都只对当次任务生效
- 不要一次性抛出全部背景和工具说明；原因：上下文按需供给，避免噪声
- 不要混用不同场景规则；原因：feature、fix、review、doc 的门禁和产物不同，按对应 skill / phase 加载
- 不要擅自改字段名、层级或标点格式；原因：Markdown/YAML/JSON 合同和脚本解析依赖精确字面值
- 不要把 prompt 或规范写成无结构长段；原因：目标、约束、验证要模块化
- 不要优先用通用工具；原因：先用仓内脚本、skill、contract 和 shared helper，再退回 shell
<!-- END SHARED SECTION: behavior-rules -->

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-context-layering.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: context-layering -->
- `AGENTS.md` / `CLAUDE.md` 只放默认会进入上下文、且跨任务稳定的仓库级规则
- `.specify/project-context.yaml` 是 canonical Project Context；`.specify/project-context.md` 仅作为 legacy fallback，二者都只放项目级长期偏好、约束与参考资料，不承载 Spec 级执行策略
- 某条规则若在不使用 Spec Driver Skill 时也必须生效，就不应只写在 `Project Context`
- 成熟 `spec/plan` 的执行裁剪，应进入 `spec-driver-implement` 或具体 feature 制品，而不是写进 `Project Context`
<!-- END SHARED SECTION: context-layering -->

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
