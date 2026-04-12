# 修复任务清单

## Task 1: 修正 cache-key-builder.ts — scanSourceFiles 扩展 + outputDir 排除

**文件**: `src/panoramic/cache/cache-key-builder.ts`

### 1.1 `INCLUDED_EXTENSIONS` 补充
```ts
const INCLUDED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx',
  '.json', '.md', '.yaml', '.yml',
  '.toml', '.lock',
]);
```

### 1.2 新增 `INCLUDED_FILENAME_PREFIXES` 常量
```ts
/** fallback 扫描时：无扩展名但需要包含的文件名前缀 */
const INCLUDED_FILENAME_PREFIXES = ['Dockerfile', '.env'];
```

### 1.3 `scanSourceFiles` 添加 `excludePaths` 参数
```ts
export function scanSourceFiles(root: string, excludePaths: string[] = []): string[]
```
实现：在 walk 函数的目录遍历中，检查 `fullPath` 是否以任一 `excludePaths` 中的路径为前缀，若是则跳过。
文件名匹配新增：检查 `INCLUDED_FILENAME_PREFIXES.some(prefix => entry.name.startsWith(prefix))`。

### 1.4 `resolveInputFiles` 添加 `outputDir` 参数
```ts
export async function resolveInputFiles(
  generator: DocumentGenerator<unknown, unknown>,
  context: ProjectContext,
  outputDir?: string,
): Promise<string[]>
```
fallback 路径：`scanSourceFiles(context.projectRoot, outputDir ? [outputDir] : [])`

### 1.5 `buildGeneratorCacheKey` 添加 `outputDir` 参数
```ts
export async function buildGeneratorCacheKey(
  generator: DocumentGenerator<unknown, unknown>,
  context: ProjectContext,
  hasher: ContentHasher,
  outputDir?: string,
): Promise<string>
```
内部调用 `resolveInputFiles(generator, context, outputDir)`。

---

## Task 2: 修正 cache-manager.ts — 存储并透传 outputDir

**文件**: `src/panoramic/cache/cache-manager.ts`

### 2.1 `check()` 和 `record()` 透传 outputDir

在调用 `buildGeneratorCacheKey(generator, context, this.hasher)` 处，改为：
```ts
buildGeneratorCacheKey(generator, context, this.hasher, this.outputDir)
```

在调用 `resolveInputFiles(generator, context)` 处，改为：
```ts
resolveInputFiles(generator, context, this.outputDir)
```

注意：`this.outputDir` 已经在 `initialize(outputDir)` 中赋值，无需新增字段。

---

## Task 3: 修正 batch-project-docs.ts — upstream generators 跳过缓存

**文件**: `src/panoramic/batch-project-docs.ts`

### 3.1 新增常量（文件顶部 import 之后）
```ts
/**
 * 这些 generator 的 structuredData 会被后续 pipeline 阶段（architectureNarrative、
 * component-view、dynamic-scenarios、ADR 等）在内存中直接消费。
 * 缓存命中时无法恢复 structuredData，因此跳过缓存，始终全量运行。
 */
const CACHE_SKIP_GENERATOR_IDS = new Set([
  'architecture-overview',
  'pattern-hints',
  'architecture-ir',
  'event-surface',
  'runtime-topology',
]);
```

### 3.2 在 cache check 之前添加短路逻辑
在 `for (const generator of applicableGenerators)` 循环中，`cacheManager.check()` 调用之前：
```ts
// upstream generators 跳过缓存，保证 structuredData 可用于后续 pipeline
if (CACHE_SKIP_GENERATOR_IDS.has(generator.id)) {
  const generatedDoc = await runProjectGenerator(generator, projectContext, options.outputDir);
  generatedDocs.push({ generatorId: generatedDoc.generatorId, writtenFiles: generatedDoc.writtenFiles, warnings: generatedDoc.warnings });
  structuredOutputs.set(generator.id, generatedDoc.structuredData);
  await cacheManager.record(generator, projectContext, generatedDoc.writtenFiles);
  continue;
}
```

### 3.3 移除错误的 `structuredOutputs.set(generator.id, undefined)` 行
原有 cache hit 路径中的 `structuredOutputs.set(generator.id, undefined)` 行应删除。
（因为 upstream generators 已经在 3.2 的短路路径中处理，进入 cache hit 路径的 generator 均为 leaf generators，不需要在 structuredOutputs 中设置值。）

---

## Task 4: 修正 cache.ts CLI — 默认路径对齐

**文件**: `src/cli/commands/cache.ts`

### 4.1 引入 `BATCH_OUTPUT_SUBDIRS`
```ts
import { BATCH_OUTPUT_SUBDIRS } from '../../panoramic/output-filenames.js';
```

### 4.2 修正默认 outputDir
```ts
// 修改前
const outputDir = command.outputDir ?? path.join(process.cwd(), 'specs');
// 修改后
const outputDir = command.outputDir ?? path.join(process.cwd(), 'specs', BATCH_OUTPUT_SUBDIRS.PROJECT);
```

### 4.3 更新 CACHE_HELP 中的说明
`--output-dir` 选项说明改为：
```
--output-dir   指定 batch project 输出目录（默认为 <cwd>/specs/project）
```

---

## Task 5: 更新 spec.md（同步文档）

**文件**: `specs/100-content-hash-cache/spec.md`

更新以下内容：
1. CLI `--output-dir` 默认值说明（改为 `<cwd>/specs/project`）
2. 新增约束：upstream generators（`architecture-overview`、`pattern-hints`、`architecture-ir`、`event-surface`、`runtime-topology`）不参与缓存，始终全量运行
3. fallback cache key 扫描规则：排除 outputDir、新增 `.toml`/`.lock`/`Dockerfile*`/`.env*` 输入
