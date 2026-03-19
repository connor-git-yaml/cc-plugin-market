# reverse-spec Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-02-10

## Active Technologies
- TypeScript 5.x, Node.js LTS (20.x+) + s-morph, tree-sitter, dependency-cruiser, handlebars, zod, @anthropic-ai/sdk（均为现有依赖，无新增运行时依赖） (002-cli-global-distribution)
- 文件系统（specs/、drift-logs/ 目录写入） (002-cli-global-distribution)
- TypeScript 5.7.3, Node.js LTS (≥20.x) + 无新增运行时依赖。仅使用 Node.js 内置模块（`fs`, `path`, `os`, `url`） (003-skill-init)
- 文件系统写入（`.claude/skills/` 项目级, `~/.claude/skills/` 全局级） (003-skill-init)
- TypeScript 5.7.3, Node.js LTS (≥20.x) + @anthropic-ai/sdk（现有）, Node.js child_process（内置，新增使用） (004-claude-sub-auth)
- N/A（无新增存储需求） (004-claude-sub-auth)
- TypeScript 5.7.3, Node.js LTS (≥20.x) + s-morph（AST）、dependency-cruiser（依赖图）、handlebars（模板）、zod（验证）、@anthropic-ai/sdk（LLM）——均为现有依赖，无新增运行时依赖 (005-batch-quality-fixes)
- 文件系统（specs/ 目录写入） (005-batch-quality-fixes)
- TypeScript 5.7.3, Node.js LTS (≥20.x) + @anthropic-ai/sdk（现有）, Node.js child_process（内置）——均为现有依赖，无新增 (007-fix-batch-llm-defaults)
- TypeScript 5.7.3, Node.js LTS (≥20.x) + 无新增依赖，仅使用 Node.js 内置 `path` 模块（已存在） (008-fix-spec-absolute-paths)
- TypeScript 5.7.3, Node.js LTS (≥20.x) + s-morph, dependency-cruiser, handlebars, zod, @anthropic-ai/sdk（现有）+ @modelcontextprotocol/sdk（新增） (009-plugin-marketplace)
- 文件系统（`specs/`、`drift-logs/`、`plugins/` 目录写入） (009-plugin-marketplace)
- 文件系统（`specs/`、`drift-logs/` 目录写入） (010-fix-dotspecs-to-specs)
- Bash 5.x（脚本）、Markdown（prompt 和模板）、YAML（配置） + 无运行时依赖。Plugin 完全由 Markdown prompt、Bash 脚本和 YAML 配置构成，运行在 Claude Code 沙箱中 (011-speckit-driver-pro)
- 文件系统（specs/[feature]/ 目录树，spec-driver.config.yaml 配置文件） (011-speckit-driver-pro)
- Bash 5.x（脚本）、Markdown（Skill prompt 和模板） + 无新增运行时依赖。Skill 完全由 Markdown prompt、Bash 脚本和静态文本文件构成，运行在 Claude Code 沙箱中 (015-speckit-doc-command)
- 文件系统（项目根目录写入 README.md、LICENSE 等；`plugins/spec-driver/` 目录下新增 Skill 文件） (015-speckit-doc-command)

- TypeScript 5.x, Node.js LTS (20.x+) + s-morph (AST), tree-sitter + tree-sitter-typescript (容错降级), dependency-cruiser (依赖图), handlebars 或 ejs (模板), zod (验证), Anthropic Claude API Sonnet/Opus (LLM) (001-reverse-spec-v2)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.x, Node.js LTS (20.x+): Follow standard conventions

## Recent Changes
- 015-speckit-doc-command: Added Bash 5.x（脚本）、Markdown（Skill prompt 和模板） + 无新增运行时依赖。Skill 完全由 Markdown prompt、Bash 脚本和静态文本文件构成，运行在 Claude Code 沙箱中
- 011-speckit-driver-pro: Added Bash 5.x（脚本）、Markdown（prompt 和模板）、YAML（配置） + 无运行时依赖。Plugin 完全由 Markdown prompt、Bash 脚本和 YAML 配置构成，运行在 Claude Code 沙箱中



<!-- MANUAL ADDITIONS START -->

## Language Convention

- **所有文档、注释、commit message、PR 描述默认使用中文**
- 英文专有名词（如 AST、CodeSkeleton、Handlebars、Zod）保持原文，不翻译
- 代码标识符（变量名、函数名、类型名）使用英文
- 代码注释使用中文
- 生成 spec、plan、tasks 等设计文档时，正文内容使用中文，技术术语保持英文
- 使用 spec-driver 的方式执行需求变更和问题修复不允许直接修改源代码。

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

<!-- MANUAL ADDITIONS END -->
