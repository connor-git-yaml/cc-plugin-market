# F-094-04 技术调研：index.ts 导出使用审计

## 调研方法

1. 读取 `src/panoramic/index.ts` 全文，提取全部 export 声明（~120 个符号）
2. 在 `src/` 目录下（排除 `src/panoramic/`）搜索所有对 panoramic 的导入
3. 在 `tests/` 目录下搜索所有对 panoramic 的导入
4. 区分"通过桶文件导入"和"直接导入子模块"

## 关键发现

**核心问题：index.ts 桶文件几乎是"空壳"**

- 外部 `src/` 代码（batch-orchestrator、delta-regenerator、cli/index、mcp/server）全部直接从子模块路径（`../panoramic/xxx.js`）导入，绕过 `index.ts`
- 仅 4 个测试文件通过 `import * as panoramic from 'index.js'` 引用桶文件，且主要用于 barrel export smoke test
- 8 个被外部实际使用的符号甚至不在 `index.ts` 导出中

## 被 src/ 外部代码引用的符号（公共 API 候选）

| 符号名 | 引用文件 | 在 index.ts 中？ |
|--------|----------|-----------------|
| `bootstrapGenerators` | cli/index.ts, mcp/server.ts | 是 |
| `bootstrapParsers` | cli/index.ts, mcp/server.ts | 是 |
| `buildProjectContext` | batch/batch-orchestrator.ts | 是 |
| `CoverageAuditor` | batch/batch-orchestrator.ts | 是 |
| `orchestrateDocsBundle` | batch/batch-orchestrator.ts | 是 |
| `DocsBundleProfileSummary` (type) | batch/batch-orchestrator.ts | 是 |
| `loadTemplate` | batch/delta-regenerator.ts | 是 |
| `buildDocGraph` | batch/batch-orchestrator.ts, delta-regenerator.ts | **否** |
| `scanStoredModuleSpecs` | batch/batch-orchestrator.ts | **否** |
| `StoredModuleSpecSummary` (type) | batch/batch-orchestrator.ts, delta-regenerator.ts | **否** |
| `buildCrossReferenceIndex` | batch/batch-orchestrator.ts | **否** |
| `generateBatchProjectDocs` | batch/batch-orchestrator.ts | **否** |
| `generateDocsQualityReport` | batch/batch-orchestrator.ts | **否** |
| `BatchProjectDocsResult` (type) | batch/batch-orchestrator.ts | **否** |
| `resolveSpecForSource` | batch/delta-regenerator.ts | **否** |

## 统计

| 分类 | 数量 |
|------|------|
| index.ts 总导出符号 | ~120 |
| 被 src/ 外部代码使用（通过桶文件） | 7 |
| 被 src/ 外部使用但不在 index.ts | 8 |
| 仅被测试通过桶文件引用 | ~10 |
| 纯内部 / 不经桶文件消费 | ~100+ |

## 建议

1. 将 index.ts 缩减为真正的公共 API：当前 7 个 + 补充 8 个遗漏 = ~15 个核心导出
2. 创建 internal.ts 供 panoramic 内部模块和测试使用
3. 4 个使用 `import * as panoramic` 的测试需同步更新
