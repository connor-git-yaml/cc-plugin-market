# Spectra Scorecard Report

> **Product**: spectra
> **Ruleset**: 默认持续治理评分 (default-governance)
> **Generated**: 2026-05-01T03:16:17.743Z
> **Status**: WARN
> **Score**: 90/100

## Summary

- Spectra 当前治理评分为 90/100，整体状态 WARN.
- 没有 fail 级规则。
- 另有 1 条 warn 级规则，建议在下一次 sync / release 前收口。

## Rule Breakdown

| Rule | Status | Score | Weight | Key Evidence |
| --- | --- | --- | --- | --- |
| Current Spec 新鲜度 | PASS | 100 | 20 | laggingSpecs=0, lagDays=0 |
| Verification 新鲜度 | WARN | 50 | 20 | totalFeatures=0, ignored=[object Object] |
| 文档覆盖率 | PASS | 100 | 20 | qualityReportPath=specs/products/spectra/_generated/quality-report.json, coveredRequiredDocs=3, totalRequiredDocs=3 |
| 文档冲突 | PASS | 100 | 15 | qualityReportPath=specs/products/spectra/_generated/quality-report.json, totalConflicts=0, high=0 |
| 分支规范卫生 | PASS | 100 | 10 | hasRemote=true, hasDefaultBranch=true, hasPolicyFile=true |
| Workflow 就绪度 | PASS | 100 | 15 | workflowRefs=6, currentSpecAvailable=true |

## Rule Details

### Current Spec 新鲜度

- Evaluator: `spec-freshness`
- Status: PASS
- Score: 100 / 100
- Weight: 20
- current-spec 覆盖了全部 60 个增量 spec。

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
- Required docs 覆盖 3/3。

```json
{
  "qualityReportPath": "specs/products/spectra/_generated/quality-report.json",
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
  "qualityReportPath": "specs/products/spectra/_generated/quality-report.json",
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
    "spectra.init",
    "spectra.generate",
    "spectra.batch",
    "spectra.diff",
    "spectra.mcp-server",
    "spectra.auth-status"
  ],
  "currentSpecAvailable": true
}
```

## Warnings

- scorecard override 忽略非 metadata 字段: default-governance.yaml.spec-freshness.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.verification-freshness.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.docs-coverage.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.docs-conflicts.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.branch-hygiene.sourcePath
- scorecard override 忽略非 metadata 字段: default-governance.yaml.workflow-readiness.sourcePath
