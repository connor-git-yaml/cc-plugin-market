# Data Model: 058 ADR 决策流水线

## 核心实体

### AdrEvidenceRef

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sourceType` | union | `architecture-narrative / pattern-hints / current-spec / spec / blueprint / commit / source-path / architecture-overview` |
| `label` | string | 证据标签 |
| `path` | string? | 可选路径 |
| `excerpt` | string | 摘录文本 |

### AdrDraft

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `decisionId` | string | 如 `ADR-0001` |
| `slug` | string | 文件名 slug |
| `title` | string | ADR 标题 |
| `status` | `proposed` | 候选状态 |
| `category` | union | `runtime / protocol / extensibility / quality / product-facts / deployment / modularity / storage` |
| `confidence` | union | `high / medium` |
| `inferred` | boolean | 是否为推断性候选 |
| `sourceTypes` | string[] | 证据来源类型集合 |
| `summary` | string | 草稿摘要 |
| `decision` | string | 决策陈述 |
| `context` | string[] | 背景列表 |
| `consequences` | string[] | 后果列表 |
| `alternatives` | string[] | 替代方案列表 |
| `evidence` | `AdrEvidenceRef[]` | 证据清单 |

### AdrIndexOutput

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 索引标题 |
| `generatedAt` | string | 生成时间 |
| `projectName` | string | 项目名 |
| `summary` | string[] | 索引摘要 |
| `draftCount` | number | 草稿数 |
| `warnings` | string[] | warning |
| `drafts` | `AdrDraft[]` | ADR 草稿列表 |

### AdrCorpus

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `projectName` | string | 项目名 |
| `projectRoot` | string | 项目根目录 |
| `architectureNarrative` | object | 架构叙事结构化输出 |
| `architectureOverview` | object? | 架构概览结构化输出 |
| `patternHints` | object? | 模式提示结构化输出 |
| `commits` | array | 最近提交记录 |
| `entries` | array | 统一化后的证据条目 |
