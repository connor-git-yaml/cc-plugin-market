# Reverse-Spec Scorecard Report

> **Product**: reverse-spec
> **Ruleset**: 默认持续治理评分 (default-governance)
> **Generated**: 2026-04-05T02:12:33.424Z
> **Status**: PASS
> **Score**: 100/100

## Summary

- Reverse-Spec 当前治理评分为 100/100，整体状态 PASS.
- 没有 fail 级规则。
- 全部规则均已达到 pass 基线。

## Rule Breakdown

| Rule | Status | Score | Weight | Key Evidence |
| --- | --- | --- | --- | --- |
| Current Spec 新鲜度 | PASS | 100 | 20 | laggingSpecs=0, lagDays=0 |
| Verification 新鲜度 | PASS | 100 | 20 | totalFeatures=16, fresh=16, stale=0 |
| 文档覆盖率 | PASS | 100 | 20 | qualityReportPath=specs/products/reverse-spec/quality-report.json, coveredRequiredDocs=3, totalRequiredDocs=3 |
| 文档冲突 | PASS | 100 | 15 | qualityReportPath=specs/products/reverse-spec/quality-report.json, totalConflicts=0, high=0 |
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
- Status: PASS
- Score: 100 / 100
- Weight: 20
- 全部 16 个纳入治理的已实现增量 spec 都有新鲜的 verification 报告。

```json
{
  "totalFeatures": 16,
  "fresh": [
    "042-api-surface-reference",
    "043-runtime-topology-ops",
    "044-doc-graph-cross-reference-index",
    "045-architecture-overview-system-context",
    "046-coverage-audit-missing-doc-report",
    "047-event-surface-documentation",
    "048-troubleshooting-explanation-docs",
    "049-incremental-spec-regeneration",
    "050-pattern-hints-explanation",
    "053-panoramic-batch-doc-suite",
    "055-doc-bundle-publish-orchestration",
    "056-architecture-ir-export",
    "057-component-view-dynamic-scenarios",
    "058-adr-decision-pipeline",
    "059-provenance-quality-gates",
    "060-product-ux-fact-ingestion"
  ],
  "stale": [],
  "missing": [],
  "failed": [],
  "coverageRatio": 1,
  "ignored": {
    "blueprint": [
      "024-multilang-blueprint",
      "054-multi-source-doc-system-blueprint"
    ],
    "nonImplemented": [
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
      "025-multilang-adapter-layer",
      "026-multilang-prompt-parameterize",
      "027-multilang-tree-sitter-backend",
      "028-python-language-adapter",
      "029-go-language-adapter",
      "030-java-language-adapter",
      "031-multilang-mixed-project",
      "033-panoramic-doc-blueprint",
      "034-doc-generator-interfaces",
      "035-project-context-unified",
      "036-generator-registry",
      "037-artifact-parsers",
      "038-data-model-doc",
      "039-config-reference-generator",
      "040-monorepo-workspace-index",
      "041-cross-package-deps",
      "051-semantic-enrichment-multiformat",
      "052-batch-singlelang-graph"
    ]
  }
}
```

### 文档覆盖率

- Evaluator: `docs-coverage`
- Status: PASS
- Score: 100 / 100
- Weight: 20
- Required docs 覆盖 3/3。

```json
{
  "qualityReportPath": "specs/products/reverse-spec/quality-report.json",
  "coveredRequiredDocs": 3,
  "totalRequiredDocs": 3,
  "coverageRatio": 1
}
```

### 文档冲突

- Evaluator: `docs-conflicts`
- Status: PASS
- Score: 100 / 100
- Weight: 15
- quality-report 未检测到显式文档冲突。

```json
{
  "qualityReportPath": "specs/products/reverse-spec/quality-report.json",
  "totalConflicts": 0,
  "high": 0,
  "medium": 0,
  "low": 0
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
