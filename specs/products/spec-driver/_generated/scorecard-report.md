# Spec Driver Scorecard Report

> **Product**: spec-driver
> **Ruleset**: 默认持续治理评分 (default-governance)
> **Generated**: 2026-04-20T10:12:02.546Z
> **Status**: WARN
> **Score**: 90/100

## Summary

- Spec Driver 当前治理评分为 90/100，整体状态 WARN.
- 没有 fail 级规则。
- 另有 1 条 warn 级规则，建议在下一次 sync / release 前收口。

## Rule Breakdown

| Rule | Status | Score | Weight | Key Evidence |
| --- | --- | --- | --- | --- |
| Current Spec 新鲜度 | PASS | 100 | 20 | laggingSpecs=0, lagDays=0 |
| Verification 新鲜度 | WARN | 50 | 20 | totalFeatures=0, ignored=[object Object] |
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
- current-spec 覆盖了全部 40 个增量 spec。

```json
{
  "laggingSpecs": [],
  "lagDays": 0
}
```

### Verification 新鲜度

- Evaluator: `verification-freshness`
- Status: WARN
- Score: 50 / 100
- Weight: 20
- 当前没有纳入治理的已实现增量 spec，verification 新鲜度无法计算。

```json
{
  "totalFeatures": 0,
  "ignored": {
    "blueprint": [],
    "nonImplemented": []
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

## Warnings

- scorecard override 忽略非 metadata 字段: default-governance.yaml.spec-freshness.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.verification-freshness.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.docs-coverage.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.docs-conflicts.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.branch-hygiene.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.workflow-readiness.sourcePath
