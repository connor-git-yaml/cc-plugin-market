# Spectra Scorecard Report

> **Product**: spectra
> **Ruleset**: 默认持续治理评分 (default-governance)
> **Generated**: 2026-09-14T18:54:11.384Z
> **Status**: PASS
> **Score**: 100/100

## Summary

- Spectra 当前治理评分为 100/100，整体状态 PASS.
- 没有 fail 级规则。
- 全部规则均已达到 pass 基线。

## Rule Breakdown

| Rule | Status | Score | Weight | Key Evidence |
| --- | --- | --- | --- | --- |
| Current Spec 新鲜度 | PASS | 100 | 20 | laggingSpecs=0, lagDays=0 |
| Verification 新鲜度 | PASS | 100 | 20 | totalFeatures=19, fresh=19, stale=0 |
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
- current-spec 覆盖了全部 108 个增量 spec。

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
- 全部 19 个纳入治理的已实现增量 spec 都有新鲜的 verification 报告。

```json
{
  "totalFeatures": 19,
  "fresh": [
    "042",
    "043",
    "044",
    "045",
    "046",
    "047",
    "048",
    "049",
    "050",
    "053",
    "055",
    "056",
    "057",
    "058",
    "059",
    "060",
    "079",
    "080",
    "061"
  ],
  "stale": [],
  "missing": [],
  "failed": [],
  "coverageRatio": 1,
  "ignored": {
    "blueprint": [
      "024",
      "054",
      "076"
    ],
    "nonImplemented": [
      "001",
      "002",
      "003",
      "004",
      "005",
      "006",
      "007",
      "008",
      "009",
      "010",
      "025",
      "026",
      "027",
      "028",
      "029",
      "030",
      "031",
      "033",
      "034",
      "035",
      "036",
      "037",
      "038",
      "039",
      "040",
      "041",
      "051",
      "052",
      "095",
      "097",
      "099",
      "100",
      "101",
      "102",
      "103",
      "104",
      "105",
      "106",
      "107",
      "094-01",
      "094-02",
      "094-03",
      "094-04",
      "094-06",
      "094-07",
      "114",
      "125",
      "127",
      "128",
      "130",
      "131",
      "132",
      "140",
      "145",
      "146",
      "151",
      "152",
      "153",
      "154",
      "155",
      "156",
      "157",
      "170c",
      "170d",
      "171",
      "174",
      "175",
      "177",
      "184",
      "189",
      "190",
      "192",
      "193",
      "195",
      "200",
      "202",
      "205",
      "214",
      "217",
      "221",
      "249",
      "250",
      "265",
      "266",
      "271",
      "278"
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
