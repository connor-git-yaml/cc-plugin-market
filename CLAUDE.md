# reverse-spec Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-02-10

## Active Technologies
- TypeScript 5.x, Node.js LTS (20.x+) + s-morph, tree-sitter, dependency-cruiser, handlebars, zod, @anthropic-ai/sdk（均为现有依赖，无新增运行时依赖） (002-cli-global-distribution)
- 文件系统（specs/、drift-logs/ 目录写入） (002-cli-global-distribution)
- TypeScript 5.7.3, Node.js LTS (≥20.x) + 无新增运行时依赖。仅使用 Node.js 内置模块（`fs`, `path`, `os`, `url`） (003-skill-init)
- 文件系统写入（`.claude/skills/` 项目级, `~/.claude/skills/` 全局级） (003-skill-init)

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
- 003-skill-init: Added TypeScript 5.7.3, Node.js LTS (≥20.x) + 无新增运行时依赖。仅使用 Node.js 内置模块（`fs`, `path`, `os`, `url`）
- 002-cli-global-distribution: Added TypeScript 5.x, Node.js LTS (20.x+) + s-morph, tree-sitter, dependency-cruiser, handlebars, zod, @anthropic-ai/sdk（均为现有依赖，无新增运行时依赖）

- 001-reverse-spec-v2: Added TypeScript 5.x, Node.js LTS (20.x+) + s-morph (AST), tree-sitter + tree-sitter-typescript (容错降级), dependency-cruiser (依赖图), handlebars 或 ejs (模板), zod (验证), Anthropic Claude API Sonnet/Opus (LLM)

<!-- MANUAL ADDITIONS START -->

## Language Convention

- **所有文档、注释、commit message、PR 描述默认使用中文**
- 英文专有名词（如 AST、CodeSkeleton、Handlebars、Zod）保持原文，不翻译
- 代码标识符（变量名、函数名、类型名）使用英文
- 代码注释使用中文
- 生成 spec、plan、tasks 等设计文档时，正文内容使用中文，技术术语保持英文

<!-- MANUAL ADDITIONS END -->
