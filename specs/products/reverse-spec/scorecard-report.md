# Reverse-Spec Scorecard Report

> **Product**: reverse-spec
> **Ruleset**: 默认持续治理评分 (default-governance)
> **Generated**: 2026-04-04T17:14:30.165Z
> **Status**: FAIL
> **Score**: 65/100

## Summary

- Reverse-Spec 当前治理评分为 65/100，整体状态 FAIL.
- 存在 1 条 fail 级规则，需要优先处理。
- 另有 2 条 warn 级规则，建议在下一次 sync / release 前收口。

## Rule Breakdown

| Rule | Status | Score | Weight | Key Evidence |
| --- | --- | --- | --- | --- |
| Current Spec 新鲜度 | PASS | 100 | 20 | laggingSpecs=0, lagDays=0 |
| Verification 新鲜度 | FAIL | 11 | 20 | totalFeatures=46, fresh=13, stale=11 |
| 文档覆盖率 | WARN | 50 | 20 | [无] |
| 文档冲突 | WARN | 50 | 15 | [无] |
| 分支规范卫生 | PASS | 100 | 10 | hasRemote=true, hasDefaultBranch=true, hasPolicyFile=true |
| Workflow 就绪度 | PASS | 100 | 15 | workflowRefs=6, currentSpecAvailable=true |

## Rule Details

### Current Spec 新鲜度

- Evaluator: `spec-freshness`
- Status: PASS
- Score: 100 / 100
- Weight: 20
- current-spec 覆盖了全部 46 个增量 spec。

```json
{
  "laggingSpecs": [],
  "lagDays": 0
}
```

### Verification 新鲜度

- Evaluator: `verification-freshness`
- Status: FAIL
- Score: 11 / 100
- Weight: 20
- verification 覆盖率仅 28%，缺失 22 个、过期 11 个、失败 0 个。

```json
{
  "totalFeatures": 46,
  "fresh": [
    "031-multilang-mixed-project",
    "033-panoramic-doc-blueprint",
    "042-api-surface-reference",
    "043-runtime-topology-ops",
    "044-doc-graph-cross-reference-index",
    "046-coverage-audit-missing-doc-report",
    "047-event-surface-documentation",
    "048-troubleshooting-explanation-docs",
    "049-incremental-spec-regeneration",
    "051-semantic-enrichment-multiformat",
    "053-panoramic-batch-doc-suite",
    "058-adr-decision-pipeline",
    "060-product-ux-fact-ingestion"
  ],
  "stale": [
    "034-doc-generator-interfaces",
    "035-project-context-unified",
    "036-generator-registry",
    "037-artifact-parsers",
    "040-monorepo-workspace-index",
    "041-cross-package-deps",
    "045-architecture-overview-system-context",
    "050-pattern-hints-explanation",
    "055-doc-bundle-publish-orchestration",
    "057-component-view-dynamic-scenarios",
    "059-provenance-quality-gates"
  ],
  "missing": [
    "001-reverse-spec-v2",
    "002-cli-global-distribution",
    "003-skill-init",
    "004-claude-sub-auth",
    "005-batch-quality-fixes",
    "006-batch-progress-timeout",
    "007-fix-batch-llm-defaults",
    "008-fix-spec-absolute-paths",
    "009-plugin-marketplace",
    "010-fix-dotspecs-to-specs",
    "024-multilang-blueprint",
    "025-multilang-adapter-layer",
    "026-multilang-prompt-parameterize",
    "027-multilang-tree-sitter-backend",
    "028-python-language-adapter",
    "029-go-language-adapter",
    "030-java-language-adapter",
    "038-data-model-doc",
    "039-config-reference-generator",
    "052-batch-singlelang-graph",
    "054-multi-source-doc-system-blueprint",
    "056-architecture-ir-export"
  ],
  "failed": [],
  "coverageRatio": 0.2826086956521739
}
```

### 文档覆盖率

- Evaluator: `docs-coverage`
- Status: WARN
- Score: 50 / 100
- Weight: 20
- 缺少 quality-report.json，暂时无法复用文档质量门的 required docs 统计。

```json
{
  "qualityReportPath": null
}
```

### 文档冲突

- Evaluator: `docs-conflicts`
- Status: WARN
- Score: 50 / 100
- Weight: 15
- 缺少 quality-report.json，冲突治理暂时只能降级为人工检查。

```json
{
  "qualityReportPath": null
}
```

### 分支规范卫生

- Evaluator: `branch-hygiene`
- Status: PASS
- Score: 100 / 100
- Weight: 10
- 默认分支、远端和分支同步约定都已显式声明。

```json
{
  "hasRemote": true,
  "hasDefaultBranch": true,
  "hasPolicyFile": true,
  "agentsDocumented": true,
  "claudeDocumented": true
}
```

### Workflow 就绪度

- Evaluator: `workflow-readiness`
- Status: PASS
- Score: 100 / 100
- Weight: 15
- 产品公开了 6 个入口引用，且 current-spec 可作为消费入口。

```json
{
  "workflowRefs": [
    "reverse-spec.init",
    "reverse-spec.generate",
    "reverse-spec.batch",
    "reverse-spec.diff",
    "reverse-spec.mcp-server",
    "reverse-spec.auth-status"
  ],
  "currentSpecAvailable": true
}
```
