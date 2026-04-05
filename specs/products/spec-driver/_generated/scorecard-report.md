# Spec Driver Scorecard Report

> **Product**: spec-driver
> **Ruleset**: 默认持续治理评分 (default-governance)
> **Generated**: 2026-04-05T14:10:59.657Z
> **Status**: PASS
> **Score**: 100/100

## Summary

- Spec Driver 当前治理评分为 100/100，整体状态 PASS.
- 没有 fail 级规则。
- 全部规则均已达到 pass 基线。

## Rule Breakdown

| Rule | Status | Score | Weight | Key Evidence |
| --- | --- | --- | --- | --- |
| Current Spec 新鲜度 | PASS | 100 | 20 | laggingSpecs=0, lagDays=0 |
| Verification 新鲜度 | PASS | 100 | 20 | totalFeatures=12, fresh=12, stale=0 |
| 文档覆盖率 | PASS | 100 | 20 | qualityReportPath=specs/products/spec-driver/_generated/quality-report.json, coveredRequiredDocs=5, totalRequiredDocs=5 |
| 文档冲突 | PASS | 100 | 15 | qualityReportPath=specs/products/spec-driver/_generated/quality-report.json, totalConflicts=0, high=0 |
| 分支规范卫生 | PASS | 100 | 10 | hasRemote=true, hasDefaultBranch=true, hasPolicyFile=true |
| Workflow 就绪度 | PASS | 100 | 15 | workflowRefs=7, missing=0, goldenPathCount=4 |

## Rule Details

### Current Spec 新鲜度

- Evaluator: `spec-freshness`
- Status: PASS
- Score: 100 / 100
- Weight: 20
- current-spec 覆盖了全部 28 个增量 spec。

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
- 全部 12 个纳入治理的已实现增量 spec 都有新鲜的 verification 报告。

```json
{
  "totalFeatures": 12,
  "fresh": [
    "012-product-spec-sync",
    "063-product-entity-catalog",
    "064-workflow-registry-golden-paths",
    "065-scorecards-continuous-governance",
    "066-adoption-friction-insights",
    "068-scorecard-signal-alignment",
    "071-product-artifact-boundary-cleanup",
    "072-spec-driver-implement",
    "073-project-context-schema-resolver",
    "074-feedback-to-context-suggestions",
    "075-init-template-tests-docs-closure",
    "077-wrapper-source-truth-consolidation"
  ],
  "stale": [],
  "missing": [],
  "failed": [],
  "coverageRatio": 1,
  "ignored": {
    "blueprint": [
      "062-catalog-driven-spec-driver-blueprint",
      "067-governance-remediation-blueprint",
      "070-project-context-implement-skill-blueprint",
      "076-codebase-rationalization-blueprint"
    ],
    "nonImplemented": [
      "011-speckit-driver-pro",
      "013-split-skill-commands",
      "014-rename-spec-driver",
      "015-speckit-doc-command",
      "016-optimize-sync-product-doc",
      "017-adopt-superpowers-patterns",
      "018-flexible-research-routing",
      "019-parallel-subagent-speedup",
      "020-fix-plugin-script-path",
      "021-add-research-templates",
      "022-sync-doc-redesign",
      "032-rename-speckit-to-spec-driver"
    ]
  }
}
```

### 文档覆盖率

- Evaluator: `docs-coverage`
- Status: PASS
- Score: 100 / 100
- Weight: 20
- Required docs 覆盖 5/5。

```json
{
  "qualityReportPath": "specs/products/spec-driver/_generated/quality-report.json",
  "coveredRequiredDocs": 5,
  "totalRequiredDocs": 5,
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
  "qualityReportPath": "specs/products/spec-driver/_generated/quality-report.json",
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
- workflow registry 覆盖了全部 7 个 workflowRefs，并提供 4 条 golden paths。

```json
{
  "workflowRefs": [
    "spec-driver-doc",
    "spec-driver-feature",
    "spec-driver-fix",
    "spec-driver-implement",
    "spec-driver-resume",
    "spec-driver-story",
    "spec-driver-sync"
  ],
  "missing": [],
  "goldenPathCount": 4
}
```
