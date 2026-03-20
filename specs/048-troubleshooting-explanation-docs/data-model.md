# Data Model: 故障排查 / 原理说明文档

## 1. TroubleshootingLocation

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sourceFile` | `string` | 相对项目根路径 |
| `line` | `number` | 1-based 行号 |
| `symbolName` | `string` | 最近的函数 / 方法 / 类上下文 |
| `excerpt` | `string` | 原始证据行摘要 |

## 2. TroubleshootingEntry

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 稳定条目标识 |
| `kind` | `'config-constraint' \| 'error-pattern'` | 条目来源 |
| `title` | `string` | 条目标题 |
| `symptom` | `string` | 故障现象 |
| `possibleCauses` | `string[]` | 可能原因 |
| `recoverySteps` | `string[]` | 处理步骤 |
| `relatedLocations` | `TroubleshootingLocation[]` | 相关代码 / 配置位置 |
| `configKeys` | `string[]` | 相关配置键 |
| `evidence` | `string[]` | 证据摘要 |
| `confidence` | `'high' \| 'medium'` | 置信度 |

## 3. TroubleshootingExplanation

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | explanation 标题 |
| `summary` | `string` | 基于证据的背景说明 |
| `evidence` | `string[]` | 支撑该说明的证据 |

## 4. TroubleshootingOutput

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | 文档标题 |
| `generatedAt` | `string` | 生成时间 |
| `projectName` | `string` | 项目名 |
| `entries` | `TroubleshootingEntry[]` | troubleshooting 条目 |
| `explanations` | `TroubleshootingExplanation[]` | explanation 段落 |
| `totalEntries` | `number` | 条目数 |
| `warnings` | `string[]` | 证据不足或退化说明 |
