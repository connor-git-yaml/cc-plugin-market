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
- 010-fix-dotspecs-to-specs: Added TypeScript 5.7.3, Node.js LTS (≥20.x) + 无新增依赖
- 009-plugin-marketplace: Added TypeScript 5.7.3, Node.js LTS (≥20.x) + s-morph, dependency-cruiser, handlebars, zod, @anthropic-ai/sdk（现有）+ @modelcontextprotocol/sdk（新增）
- 008-fix-spec-absolute-paths: Added TypeScript 5.7.3, Node.js LTS (≥20.x) + 无新增依赖，仅使用 Node.js 内置 `path` 模块（已存在）



<!-- MANUAL ADDITIONS START -->

## Language Convention

- **所有文档、注释、commit message、PR 描述默认使用中文**
- 英文专有名词（如 AST、CodeSkeleton、Handlebars、Zod）保持原文，不翻译
- 代码标识符（变量名、函数名、类型名）使用英文
- 代码注释使用中文
- 生成 spec、plan、tasks 等设计文档时，正文内容使用中文，技术术语保持英文
- 使用 Speckit 的方式执行需求变更和问题修复不允许直接修改源代码。

<!-- MANUAL ADDITIONS END -->
