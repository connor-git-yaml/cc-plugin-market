# Spec Driver Scorecard Report

> **Product**: spec-driver
> **Ruleset**: 默认持续治理评分 (default-governance)
> **Generated**: 2026-09-14T18:54:11.384Z
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
| Verification 新鲜度 | PASS | 100 | 20 | totalFeatures=14, fresh=14, stale=0 |
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
- current-spec 覆盖了全部 58 个增量 spec。

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
- 全部 14 个纳入治理的已实现增量 spec 都有新鲜的 verification 报告。

```json
{
  "totalFeatures": 14,
  "fresh": [
    "012",
    "063",
    "064",
    "065",
    "066",
    "068",
    "071",
    "072",
    "073",
    "074",
    "075",
    "077",
    "080",
    "082"
  ],
  "stale": [],
  "missing": [],
  "failed": [],
  "coverageRatio": 1,
  "ignored": {
    "blueprint": [
      "062",
      "067",
      "070",
      "076"
    ],
    "nonImplemented": [
      "011",
      "013",
      "014",
      "015",
      "016",
      "017",
      "018",
      "019",
      "020",
      "021",
      "022",
      "032",
      "078",
      "081",
      "084",
      "085",
      "087",
      "089",
      "090",
      "091",
      "092",
      "093",
      "136",
      "191",
      "208",
      "213",
      "216",
      "219",
      "224",
      "236",
      "238",
      "239",
      "240",
      "241",
      "270",
      "277",
      "289",
      "290"
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

## Warnings

- scorecard override 忽略非 metadata 字段: default-governance.yaml.spec-freshness.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.verification-freshness.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.docs-coverage.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.docs-conflicts.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.branch-hygiene.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.workflow-readiness.sourcePath
