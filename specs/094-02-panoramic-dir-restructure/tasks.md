# Task Breakdown: F-094-02 Panoramic 目录结构分层重组

**Feature**: F-094-02 | **Date**: 2026-04-06 | **Plan**: [plan.md](plan.md)

---

## 任务总览

| Task ID | 标题 | 依赖 | 状态 |
|---------|------|------|------|
| T-01 | 创建 5 个目标子目录 | — | done |
| T-02 | [批次 1] 迁移 models/ 文件（9 个） | T-01 | done |
| T-03 | [批次 2] 迁移 builders/ 文件（5 个） | T-02 | done |
| T-04 | [批次 3] 迁移 generators/ 文件（12 个） | T-03 | done |
| T-05 | [批次 4] 迁移 pipelines/ 文件（8 个） | T-04 | done |
| T-06 | [批次 5] 迁移 exporters/ 文件（1 个） | T-02 | done |
| T-07 | 更新 index.ts 桶文件路径 | T-06 | done |
| T-08 | 更新外部调用方路径（4 处） | T-07 | done |
| T-09 | 更新测试文件路径 | T-07 | done |
| T-10 | 全量验证 | T-08, T-09 | done |

---

## T-01: 创建 5 个目标子目录

mkdir -p src/panoramic/{generators,pipelines,models,builders,exporters}

## T-02: 迁移 models/ (9 个文件)

architecture-ir-model.ts, architecture-overview-model.ts, component-view-model.ts,
docs-quality-model.ts, pattern-hints-model.ts, runtime-topology-model.ts,
docs-bundle-types.ts, docs-bundle-profiles.ts, pattern-knowledge-base.ts

→ 更新内部 import（`./` → `../` 引用根目录保留文件）

## T-03: 迁移 builders/ (5 个文件)

architecture-ir-builder.ts, component-view-builder.ts, dynamic-scenarios-builder.ts,
doc-graph-builder.ts, architecture-ir-mermaid-adapter.ts

→ 更新内部 import（models 引用改为 `../models/`）

## T-04: 迁移 generators/ (12 个文件)

architecture-ir-generator.ts, architecture-overview-generator.ts, config-reference-generator.ts,
cross-package-analyzer.ts, data-model-generator.ts, event-surface-generator.ts,
interface-surface-generator.ts, mock-readme-generator.ts, pattern-hints-generator.ts,
runtime-topology-generator.ts, troubleshooting-generator.ts, workspace-index-generator.ts

→ 更新内部 import（models → `../models/`, builders → `../builders/`, 根保留 → `../`）

## T-05: 迁移 pipelines/ (8 个文件)

adr-decision-pipeline.ts, architecture-narrative.ts, docs-quality-evaluator.ts,
narrative-provenance-adapter.ts, product-ux-docs.ts, coverage-auditor.ts,
docs-bundle-manifest-reader.ts, docs-bundle-orchestrator.ts

→ 更新内部 import

## T-06: 迁移 exporters/ (1 个文件)

architecture-ir-exporters.ts → 更新内部 import

## T-07: 更新 index.ts 桶文件

所有 35 处 `from './xxx.js'` → `from './subdir/xxx.js'`

## T-08: 更新外部调用方路径

- batch-orchestrator.ts: doc-graph-builder → builders/, coverage-auditor → pipelines/, docs-bundle-orchestrator → pipelines/, docs-bundle-types → models/
- delta-regenerator.ts: doc-graph-builder → builders/

## T-09: 更新测试文件路径

~28 个测试文件的 import 路径同步更新

## T-10: 全量验证

- SC-001: 根目录 .ts 文件数 ≤ 10
- SC-002: npm run build 零错误
- SC-003: npm test 全部通过
- SC-005: 无循环依赖
- SC-006: 5 个待分类文件已迁移
