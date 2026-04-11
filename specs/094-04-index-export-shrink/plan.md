---
feature: F-094-04
title: index.ts 导出收口与 API 分层
plan_version: "1.0"
created: 2026-04-11
status: Draft
---

# Implementation Plan: F-094-04

**复杂度**: LOW | **影响文件**: 2 源码 + 7 测试 | **风险**: LOW

## 概要

将 `src/panoramic/index.ts` 从约 120 个导出符号缩减为 15 个公共 API 符号（≤60 行），新建 `src/panoramic/internal.ts` 承接内部符号。

## 15 个公共 API 符号

| 符号 | 类型 | 源模块 |
|------|------|--------|
| `bootstrapGenerators` | function | `./generator-registry.js` |
| `bootstrapParsers` | function | `./parser-registry.js` |
| `buildProjectContext` | function | `./project-context.js` |
| `CoverageAuditor` | class | `./coverage-auditor.js` |
| `orchestrateDocsBundle` | function | `./docs-bundle-orchestrator.js` |
| `DocsBundleProfileSummary` | type | `./docs-bundle-types.js` |
| `loadTemplate` | function | `./utils/template-loader.js` |
| `buildDocGraph` | function | `./doc-graph-builder.js` |
| `scanStoredModuleSpecs` | function | `./doc-graph-builder.js` |
| `StoredModuleSpecSummary` | type | `./doc-graph-builder.js` |
| `resolveSpecForSource` | function | `./doc-graph-builder.js` |
| `buildCrossReferenceIndex` | function | `./cross-reference-index.js` |
| `generateBatchProjectDocs` | function | `./batch-project-docs.js` |
| `generateDocsQualityReport` | function | `./batch-project-docs.js` |
| `BatchProjectDocsResult` | type | `./batch-project-docs.js` |

## 实现步骤

1. **创建 internal.ts**：从 index.ts 迁移全部非公共符号 + @internal JSDoc
2. **重写 index.ts**：仅保留 15 个公共 API 符号
3. **更新 7 个测试文件**：导入路径从 index.js 改为 internal.js
4. **验证**：build + test + 行数检查

## 受影响的测试文件（7 个）

- 3 个静态 `import * as panoramic`：architecture-ir-generator、architecture-overview-generator、pattern-hints-generator
- 1 个命名导入内部符号：architecture-ir-builder
- 3 个动态 `await import()` smoke test：event-surface-generator、runtime-topology-generator、troubleshooting-generator

## 验证策略

```bash
npm run build              # SC-003
npx vitest run             # SC-004
wc -l src/panoramic/index.ts  # SC-001 ≤60
grep "@internal" src/panoramic/internal.ts  # SC-002
```
