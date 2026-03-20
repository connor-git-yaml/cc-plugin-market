# Data Model: 增量差量 Spec 重生成

## 1. StoredModuleSpecSummary

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `specPath` | `string` | 相对项目根的 spec 路径 |
| `sourceTarget` | `string` | spec owner，目录模块为目录路径，root 为单文件路径 |
| `relatedFiles` | `string[]` | frontmatter 中声明的相关源码 |
| `version` | `string` | 既有 spec 版本号 |
| `confidence` | `'high' \| 'medium' \| 'low' \| undefined` | 既有置信度 |
| `skeletonHash` | `string \| undefined` | 上次生成时的骨架哈希 |
| `linked` | `boolean` | 是否已写入 044 的交叉引用块 |
| `intentSummary` | `string` | 从现有 spec 抽取的一行摘要 |
| `outputPath` | `string` | 用于 index / CLI 输出的相对路径 |

## 2. DeltaSourceTargetState

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sourceTarget` | `string` | 当前生成目标 |
| `sourceFiles` | `string[]` | 该目标包含的源码文件 |
| `currentHash` | `string` | 当前源码骨架哈希 |
| `previousHash` | `string \| undefined` | 来自既有 spec 的 skeletonHash |
| `reason` | `'missing-spec' \| 'skeleton-changed' \| 'dependency-propagation' \| 'metadata-missing'` | 触发原因 |

## 3. DeltaRegenerationPlan

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `mode` | `'incremental' \| 'full'` | 实际执行模式 |
| `directChanges` | `DeltaSourceTargetState[]` | 直接命中的 sourceTarget |
| `propagatedChanges` | `DeltaSourceTargetState[]` | 由依赖传播命中的 sourceTarget |
| `unchangedTargets` | `string[]` | 不需重生成的 sourceTarget |
| `fallbackReason` | `string \| undefined` | 回退全量或扩大范围的原因 |

## 4. DeltaReport

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `generatedAt` | `string` | 生成时间 |
| `projectRoot` | `string` | 项目根 |
| `mode` | `'incremental' \| 'full'` | 本次实际模式 |
| `totalTargets` | `number` | 当前 sourceTarget 总数 |
| `regenerateTargets` | `string[]` | 需重生成目标 |
| `directChanges` | `DeltaSourceTargetState[]` | 直接变化 |
| `propagatedChanges` | `DeltaSourceTargetState[]` | 传播变化 |
| `unchangedTargets` | `string[]` | 未变化目标 |
| `fallbackReason` | `string \| undefined` | 保守回退说明 |
