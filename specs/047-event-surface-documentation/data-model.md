# Data Model: 事件面文档

## 1. EventEvidence

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `role` | `'publisher' \| 'subscriber'` | 证据角色 |
| `sourceFile` | `string` | 相对项目根路径 |
| `symbolName` | `string` | 最近的函数 / 方法 / 类上下文 |
| `methodName` | `string` | 调用方法名，如 `emit` / `publish` |
| `payloadSummary` | `string \| undefined` | payload 表达式摘要 |
| `payloadFields` | `string[]` | 对象字面量字段名 |

## 2. EventChannel

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `channelName` | `string` | 事件名 / topic / queue 名 |
| `kind` | `'event' \| 'topic' \| 'queue' \| 'webhook' \| 'unknown'` | 通道类型 |
| `publishers` | `EventEvidence[]` | 发布证据 |
| `subscribers` | `EventEvidence[]` | 订阅证据 |
| `messageFields` | `string[]` | 聚合后的 payload 字段 |
| `payloadSamples` | `string[]` | payload 摘要样本 |

## 3. EventSurfaceOutput

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | 文档标题 |
| `generatedAt` | `string` | 生成时间 |
| `projectName` | `string` | 项目名 |
| `channels` | `EventChannel[]` | 事件通道集合 |
| `totalChannels` | `number` | channel 数 |
| `totalPublishers` | `number` | publisher 数 |
| `totalSubscribers` | `number` | subscriber 数 |
| `warnings` | `string[]` | 保守回退或忽略说明 |
| `eventFlowMermaid` | `string \| undefined` | channel flow 图 |
| `stateAppendixMermaid` | `string \| undefined` | 低置信状态附录 |
| `stateAppendixConfidence` | `'low' \| undefined` | 附录置信度 |
