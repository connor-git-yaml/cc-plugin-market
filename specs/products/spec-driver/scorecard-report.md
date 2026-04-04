# Spec Driver Scorecard Report

> **Product**: spec-driver
> **Ruleset**: 默认持续治理评分 (default-governance)
> **Generated**: 2026-04-04T17:14:30.165Z
> **Status**: FAIL
> **Score**: 68/100

## Summary

- Spec Driver 当前治理评分为 68/100，整体状态 FAIL.
- 存在 1 条 fail 级规则，需要优先处理。
- 另有 2 条 warn 级规则，建议在下一次 sync / release 前收口。

## Rule Breakdown

| Rule | Status | Score | Weight | Key Evidence |
| --- | --- | --- | --- | --- |
| Current Spec 新鲜度 | PASS | 100 | 20 | laggingSpecs=0, lagDays=0 |
| Verification 新鲜度 | FAIL | 29 | 20 | totalFeatures=18, fresh=13, stale=0 |
| 文档覆盖率 | WARN | 50 | 20 | [无] |
| 文档冲突 | WARN | 50 | 15 | [无] |
| 分支规范卫生 | PASS | 100 | 10 | hasRemote=true, hasDefaultBranch=true, hasPolicyFile=true |
| Workflow 就绪度 | PASS | 100 | 15 | workflowRefs=6, missing=0, goldenPathCount=3 |

## Rule Details

### Current Spec 新鲜度

- Evaluator: `spec-freshness`
- Status: PASS
- Score: 100 / 100
- Weight: 20
- current-spec 覆盖了全部 18 个增量 spec。

```json
{
  "laggingSpecs": [],
  "lagDays": 0
}
```

### Verification 新鲜度

- Evaluator: `verification-freshness`
- Status: FAIL
- Score: 29 / 100
- Weight: 20
- verification 覆盖率仅 72%，缺失 5 个、过期 0 个、失败 0 个。

```json
{
  "totalFeatures": 18,
  "fresh": [
    "013-split-skill-commands",
    "014-rename-spec-driver",
    "015-speckit-doc-command",
    "016-optimize-sync-product-doc",
    "017-adopt-superpowers-patterns",
    "018-flexible-research-routing",
    "019-parallel-subagent-speedup",
    "020-fix-plugin-script-path",
    "021-add-research-templates",
    "063-product-entity-catalog",
    "064-workflow-registry-golden-paths",
    "065-scorecards-continuous-governance",
    "066-adoption-friction-insights"
  ],
  "stale": [],
  "missing": [
    "011-speckit-driver-pro",
    "012-product-spec-sync",
    "022-sync-doc-redesign",
    "032-rename-speckit-to-spec-driver",
    "062-catalog-driven-spec-driver-blueprint"
  ],
  "failed": [],
  "coverageRatio": 0.7222222222222222
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
- workflow registry 覆盖了全部 6 个 workflowRefs，并提供 3 条 golden paths。

```json
{
  "workflowRefs": [
    "spec-driver-doc",
    "spec-driver-feature",
    "spec-driver-fix",
    "spec-driver-resume",
    "spec-driver-story",
    "spec-driver-sync"
  ],
  "missing": [],
  "goldenPathCount": 3
}
```
