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
