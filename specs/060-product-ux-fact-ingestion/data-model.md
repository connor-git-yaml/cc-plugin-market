# Data Model: 060 产品 / UX 事实接入

## 核心实体

### ProductEvidenceRef

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sourceType` | union | `current-spec / readme / design-doc / issue / pull-request / commit / inference` |
| `label` | string | 证据标签 |
| `path` | string? | 可选路径或 URL |
| `ref` | string? | 可选引用 ID |
| `excerpt` | string | 证据摘录 |
| `confidence` | union | `high / medium / low` |
| `inferred` | boolean | 是否为推断 |

### ProductUserSegment

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 用户角色名称 |
| `description` | string | 角色描述 |
| `primaryScenarios` | string[] | 主要场景列表 |
| `evidence` | `ProductEvidenceRef[]` | 证据链 |
| `confidence` | union | 可信度 |

### ProductScenario

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 场景 ID |
| `title` | string | 场景标题 |
| `summary` | string | 摘要 |
| `actors` | string[] | 参与角色 |
| `evidence` | `ProductEvidenceRef[]` | 证据链 |
| `confidence` | union | 可信度 |
| `inferred` | boolean | 是否推断 |

### ProductOverviewOutput

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 文档标题 |
| `generatedAt` | string | 生成时间 |
| `projectName` | string | 项目名 |
| `summary` | string[] | 产品定位摘要 |
| `targetUsers` | `ProductUserSegment[]` | 目标用户 |
| `coreScenarios` | `ProductScenario[]` | 核心场景 |
| `keyTaskFlows` | string[] | 关键任务流 |
| `warnings` | string[] | warning |
| `confidence` | union | 可信度 |
| `inferred` | boolean | 是否主要依赖推断 |
| `evidence` | `ProductEvidenceRef[]` | 总体证据 |

### UserJourney

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 旅程 ID |
| `title` | string | 旅程标题 |
| `actor` | string | 角色 |
| `goal` | string | 目标 |
| `outcome` | string | 结果 |
| `steps` | array | 步骤列表 |
| `evidence` | `ProductEvidenceRef[]` | 证据链 |
| `confidence` | union | 可信度 |
| `inferred` | boolean | 是否推断 |

### FeatureBrief

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | brief 标识，如 `ISSUE-12` |
| `slug` | string | 标题 slug |
| `fileName` | string | 用于写盘的稳定文件名 |
| `title` | string | 标题 |
| `summary` | string | 摘要 |
| `problem` | string | 问题陈述 |
| `proposedSolution` | string | 方案说明 |
| `audience` | string | 目标受众 |
| `status` | union | `candidate / shipped` |
| `evidence` | `ProductEvidenceRef[]` | 证据链 |
| `confidence` | union | 可信度 |
| `inferred` | boolean | 是否推断 |

### ProductFactCorpus

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `projectName` | string | 项目名 |
| `currentSpecs` | array | 产品级活文档集合 |
| `readmes` | array | README 集合 |
| `designDocs` | array | 本地设计 / roadmap / ux Markdown |
| `issues` | array | GitHub issue 事实 |
| `pullRequests` | array | GitHub PR 事实 |
| `commits` | array | 近期 commit |
| `warnings` | string[] | 数据源缺失 warning |
