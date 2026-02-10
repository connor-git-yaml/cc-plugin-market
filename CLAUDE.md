# reverse-spec Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-02-10

## Active Technologies

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

- 001-reverse-spec-v2: Added TypeScript 5.x, Node.js LTS (20.x+) + s-morph (AST), tree-sitter + tree-sitter-typescript (容错降级), dependency-cruiser (依赖图), handlebars 或 ejs (模板), zod (验证), Anthropic Claude API Sonnet/Opus (LLM)

<!-- MANUAL ADDITIONS START -->

## Language Convention

- **所有文档、注释、commit message、PR 描述默认使用中文**
- 英文专有名词（如 AST、CodeSkeleton、Handlebars、Zod）保持原文，不翻译
- 代码标识符（变量名、函数名、类型名）使用英文
- 代码注释使用中文
- 生成 spec、plan、tasks 等设计文档时，正文内容使用中文，技术术语保持英文

<!-- MANUAL ADDITIONS END -->
