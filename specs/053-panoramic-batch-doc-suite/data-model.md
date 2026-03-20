# Data Model: 053 Batch 全景项目文档套件与架构叙事输出

## BatchPanoramicDoc

- `generatorId`: 生成器 ID
- `baseName`: 输出基础文件名
- `writtenFiles`: 实际写出的绝对路径列表
- `warnings`: 该文档生成过程中的 warning

## BatchPanoramicDocsResult

- `projectContext`: 本次 batch 使用的 `ProjectContext`
- `generatedDocs`: `BatchPanoramicDoc[]`
- `outputsByGenerator`: `Map<string, unknown>`，缓存结构化输出供后续 narrative 使用

## NarrativeModuleInsight

- `sourceTarget`: 模块 source target
- `displayName`: 展示名称
- `intentSummary`: 模块意图摘要
- `businessSummary`: 业务逻辑摘要
- `dependencySummary`: 依赖摘要
- `keySymbols`: 关键类/类型/函数摘要列表
- `keyMethods`: 关键方法/函数摘要列表
- `inferred`: 是否主要依赖推断

## ArchitectureNarrativeDocument

- `title`
- `generatedAt`
- `projectName`
- `executiveSummary`: 结论要点数组
- `repositoryMap`: 顶层目录/模块分布
- `keyModules`: `NarrativeModuleInsight[]`
- `keySymbols`: 跨模块关键符号摘要
- `keyMethods`: 跨模块关键方法摘要
- `observations`: 架构观察 / 风险 / 约束
