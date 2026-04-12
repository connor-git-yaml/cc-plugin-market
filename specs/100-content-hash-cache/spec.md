---
feature_id: "100"
feature_name: "content-hash-cache"
status: draft
priority: P1
milestone: "M-100 Spectra Evolution"
target_version: "v3.1.0"
created: "2026-04-12"
---

# Feature 100: SHA256 内容哈希缓存

## 1. 概述

在 Spectra 的 panoramic batch 管道中引入文件级 SHA256 内容哈希缓存层，使 `DocumentGenerator` 在检测到输入内容未变化时能够跳过执行并复用上次输出，目标是将二次 batch（少量文件变化）耗时从首次的 100% 降至 20% 以内。缓存状态通过独立的 `_meta/_cache-manifest.json` 持久化，并提供 `spectra cache` CLI 子命令用于管理。

---

## 2. 目标与非目标

### 2.1 目标

- 在 `batch-project-docs.ts` 的 panoramic generator 执行前注入内容哈希缓存检查，命中时跳过 `extract → generate → render` 全链路
- 基于 SHA256 对项目文件内容（含 `projectRoot`、`generator.id`、稳定的 `ProjectContext` 字段）计算 cache key
- 实现原子写入（write-tmp-then-rename）的 manifest 持久化，避免写入中断导致 manifest 损坏
- 提供 `spectra cache clear` 和 `spectra cache stats` CLI 子命令
- manifest 数据结构前向兼容 Feature 101（graph-persistence）的扩展需求
- 缓存命中时输出日志 `[cache-hit] {generatorId}: {N} files unchanged, reusing output`
- 二次 batch（2/100 文件变化）耗时 < 30 秒，缓存命中率 > 90%

### 2.2 非目标

- 不修改 `DeltaRegenerator` 的 AST skeleton hash 机制；两者平行，各自独立负责不同粒度的增量决策
- 不在 batch-orchestrator 的模块级跳过（Spec 生成阶段）引入内容哈希缓存（本 Feature 只覆盖 panoramic generator 维度）
- 不实现分布式缓存或跨机器共享缓存
- 不实现 LRU 淘汰策略；缓存失效策略仅基于文件 mtime 和 hash 比对
- 不修改 `DocumentGenerator` 接口上任何已有的四段生命周期方法签名
- 不实现 `spectra cache manifest` 子命令（输出原始 manifest JSON），留作后续 P2 扩展

---

## 3. 核心设计

### 3.1 内容哈希引擎

使用 Node.js 原生 `crypto.createHash('sha256')`，无外部依赖。

**cache key 构成**：

```
SHA256(
  generator.id
  + "|" + projectRoot
  + "|" + workspaceType
  + "|" + packageManager
  + "|" + detectedLanguages.sort().join(",")
  + "|" + aggregatedFileHash
)
```

其中 `aggregatedFileHash` 为 generator 已声明的依赖文件集合（通过可选 `getDependencies()` 方法）的各文件 `SHA256(filePath + fileContent)` 排序后合并再次 hash 的结果。若 generator 未实现 `getDependencies()`，则 fallback 为 `projectRoot` 下所有 source 文件的聚合 hash（性能稍差但安全）。

**`.md` 文件处理**：对 Markdown 文件只哈希 frontmatter 分隔符（`---`）之后的正文内容，跳过 frontmatter 区域，避免纯元数据变化（如 `updated` 时间戳）触发不必要的缓存失效。

**cache key 排除字段清单**（避免运行时易变数据导致缓存频繁失效）：
- `existingSpecs`：每次运行都会变化
- `configFiles`：`Map<string, string>` 类型，序列化顺序不稳定
- 其他运行时动态字段（如 batch 进度状态等）

**`.md` frontmatter 跳过的边界规则**：
- **无 frontmatter**（首行不是 `---`）：直接哈希全文内容
- **未闭合 frontmatter**（有开头 `---` 但前 50 行内无闭合 `---`）：降级为哈希全文内容
- **正文含 `---`**（Markdown 水平规则）：仅处理文件开头的 frontmatter 区域，从第 2 行开始查找下一个仅含 `---` 的行作为闭合标记，找到后停止扫描

### 3.2 Manifest 管理

**manifest 文件位置**：

```
<outputDir>/_meta/_cache-manifest.json
```

与现有 `_delta-report.md`、`batch-summary-*.md` 同路径（`BATCH_OUTPUT_SUBDIRS.META`），保持输出结构一致。

**原子写入**：复用 `checkpoint.ts` 的 write-tmp-then-rename 模式，通过独立工具函数 `writeAtomicJson()` 实现（建议提取到 `src/utils/atomic-write.ts`）：

```typescript
// 写入流程
const tmpPath = `${manifestPath}.tmp`;
fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');
fs.renameSync(tmpPath, manifestPath);   // 原子替换
```

**版本兼容**：manifest 包含顶层 `version` 字段，加载时做版本校验。版本不匹配时自动清空缓存（打印警告日志），而非抛出错误中断流程。

**向前兼容 Feature 101**：每条 manifest entry 预留 `dependencyGraph` 可选字段（`undefined` 时不写入），供 graph-persistence 扩展使用。

### 3.3 Generator 级增量

**注入点**：`src/panoramic/batch-project-docs.ts`，`generateBatchProjectDocs()` 函数内的 `for (const generator of applicableGenerators)` 循环中，`runProjectGenerator()` 调用前。

**拦截逻辑**：

```
for (const generator of applicableGenerators) {
  1. 计算 cacheKey = buildGeneratorCacheKey(generator, context)
  2. 从 manifest 查找 entry = manifestManager.get(cacheKey)
  3. 若 entry 存在且未 stale（文件 mtime 和 hash 均匹配）：
       → 日志输出 [cache-hit] 信息
       → 复用 entry 中已记录的输出文件路径
       → continue（跳过 runProjectGenerator 调用）
  4. 否则：
       → 执行 runProjectGenerator(generator, context, options.outputDir)
       → **成功时**：调用 CacheManager.record()，outputFiles 取自 generatedDoc.writtenFiles
       → **失败时**：保留旧 entry 不变（不删除、不更新），避免偶发失败破坏历次缓存
}
5. 所有 generator 执行完毕后，调用 manifestManager.flush() 原子写入 manifest
```

**缓存失效策略**：满足任一条件即判定 stale，需重新执行：
- manifest 中记录的源文件不存在（文件已删除）
- 源文件当前 mtime 早于 manifest 记录的 mtime（文件被回滚）
- 源文件当前内容 SHA256 与 manifest 记录不一致

**跳过日志格式**：

```
[cache-hit] workspace-index: 47 files unchanged, reusing output
```

**两套缓存的关系**：

```
[1] DeltaRegenerator.plan()     → 模块级增量计划（AST skeleton hash，Spec 生成维度）
[2] ContentHashCache.check()    → generator 级缓存命中检查（内容 hash，panoramic 维度）
[3] runProjectGenerator()       → 实际调用（缓存未命中时）
[4] ContentHashCache.save()     → 更新 manifest（成功生成后）
```

两者平行、不相互替代。

### 3.4 Cache CLI

**注册路径**（参照现有 CLI 模式）：

- `src/cli/utils/parse-args.ts`：`CLICommand.subcommand` 联合类型追加 `'cache'`
- `src/cli/commands/cache.ts`：新建命令处理函数 `runCacheCommand()`
- `src/cli/index.ts`：import、HELP_TEXT、switch 分支三处变更

**子命令设计**：

```
spectra cache stats                         # 显示 manifest 统计
spectra cache stats --output-dir <dir>      # 指定输出目录
spectra cache clear                         # 清除全部缓存
spectra cache clear --generator <id>        # 清除指定 generator 的缓存条目
spectra cache clear --output-dir <dir>      # 指定输出目录
```

**`outputDir` 来源**：`cache` 子命令接受可选 `--output-dir <dir>` 参数，语义与 `batch` 子命令一致；未传时 fallback 为 `process.cwd()/specs`。`CLICommand` 接口追加 `cacheOperation?: 'stats' | 'clear'` 和 `cacheGeneratorId?: string` 字段，`outputDir` 字段复用现有定义。

`stats` 示例输出：

```
Cache manifest: <outputDir>/_meta/_cache-manifest.json
Entries:   12
Total size: 4.2 MB
Last updated: 2026-04-12T08:30:00Z
Generators: workspace-index (3), cross-package-analyzer (5), ...
```

---

## 4. 数据结构

### 4.1 ManifestEntry

```typescript
import { z } from 'zod';

// 单个源文件的哈希记录
const FileHashRecordSchema = z.object({
  /** 文件绝对路径 */
  path: z.string(),
  /** SHA256(filePath + fileContent) */
  hash: z.string(),
  /** 文件最后修改时间（Unix ms） */
  mtime: z.number(),
  /** 文件字节大小 */
  size: z.number(),
});

// 单个 generator 的 manifest 条目
const ManifestEntrySchema = z.object({
  /** cache key（SHA256 of generator + context + files） */
  cacheKey: z.string(),
  /** generator.id */
  generatorId: z.string(),
  /** 该 generator 输入的源文件列表 */
  inputFiles: z.array(FileHashRecordSchema),
  /** 生成的输出文件路径列表（相对于 outputDir） */
  outputFiles: z.array(z.string()),
  /** manifest entry 创建/更新时间（Unix ms） */
  createdAt: z.number(),
  /** 输出内容类型（对应 generator 生成的文档类型） */
  type: z.string().optional(),
  /** 预留字段：供 Feature 101（graph-persistence）扩展依赖图 */
  dependencyGraph: z.unknown().optional(),
});

export type FileHashRecord = z.infer<typeof FileHashRecordSchema>;
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;
```

### 4.2 CacheManifest

```typescript
const CacheManifestSchema = z.object({
  /** schema 版本，用于向前兼容校验 */
  version: z.literal('1'),
  /** manifest 最后写入时间（Unix ms） */
  updatedAt: z.number(),
  /** cacheKey → ManifestEntry 的映射 */
  entries: z.record(z.string(), ManifestEntrySchema),
});

export type CacheManifest = z.infer<typeof CacheManifestSchema>;
```

---

## 5. 接口设计

### 5.1 ContentHasher

```typescript
// src/panoramic/cache/content-hasher.ts

export interface ContentHasher {
  /**
   * 计算单个文件的 SHA256 哈希。
   * 对 .md 文件自动跳过 frontmatter 区域，只哈希正文。
   * @param filePath 文件绝对路径
   * @returns SHA256 hex 字符串
   */
  hashFile(filePath: string): Promise<string>;

  /**
   * 计算文件集合的聚合哈希（各文件 hash 排序后合并再次 hash）。
   * @param filePaths 文件绝对路径列表
   * @returns 聚合后的 SHA256 hex 字符串
   */
  hashFiles(filePaths: string[]): Promise<string>;

  /**
   * 计算字符串内容的 SHA256 哈希。
   * @param content 任意字符串
   * @returns SHA256 hex 字符串
   */
  hashContent(content: string): string;
}
```

### 5.2 ManifestManager

```typescript
// src/panoramic/cache/manifest-manager.ts

export interface ManifestManager {
  /**
   * 加载 manifest 文件。版本不兼容时自动清空并打印警告，不抛错。
   * @param manifestPath _cache-manifest.json 的绝对路径
   */
  load(manifestPath: string): Promise<void>;

  /**
   * 根据 cacheKey 查询 manifest entry。
   * @returns entry 对象，不存在时返回 undefined
   */
  get(cacheKey: string): ManifestEntry | undefined;

  /**
   * 更新或插入一条 manifest entry（内存操作，不立即写盘）。
   */
  set(entry: ManifestEntry): void;

  /**
   * 删除指定 generatorId 的所有条目（内存操作）。
   * generatorId 为 undefined 时删除全部条目。
   */
  delete(generatorId?: string): void;

  /**
   * 将当前内存中的 manifest 原子写入磁盘。
   * @param manifestPath 写入目标路径
   */
  flush(manifestPath: string): Promise<void>;

  /**
   * 返回当前 manifest 的统计摘要。
   */
  stats(): ManifestStats;
}

export interface ManifestStats {
  entryCount: number;
  /** 所有 ManifestEntry.inputFiles[*].size 的累加值，即被缓存管理的输入源文件总字节数 */
  totalSizeBytes: number;
  lastUpdatedAt: number | undefined;
  byGenerator: Record<string, number>;   // generatorId → 条目数
}
```

### 5.3 CacheManager

```typescript
// src/panoramic/cache/cache-manager.ts

export interface CacheManager {
  /**
   * 初始化：加载 manifest，确定 manifestPath。
   * @param outputDir panoramic 输出目录
   */
  initialize(outputDir: string): Promise<void>;

  /**
   * 检查 generator 是否命中缓存。
   * 内部计算 cacheKey，并对 manifest entry 的所有 inputFiles 做 stale 校验。
   * @returns 命中时返回 ManifestEntry（含 outputFiles 供跳过时复用），未命中或 stale 时返回 false
   */
  check(generator: DocumentGenerator<unknown, unknown>, context: ProjectContext): Promise<ManifestEntry | false>;

  /**
   * 执行完毕后，将 generator 的输入文件信息写入 manifest（内存操作）。
   * @param generator generator 实例
   * @param context   ProjectContext
   * @param outputFiles 本次生成的输出文件路径列表（相对于 outputDir）
   */
  record(
    generator: DocumentGenerator<unknown, unknown>,
    context: ProjectContext,
    outputFiles: string[],
  ): Promise<void>;

  /**
   * 将内存 manifest 原子写盘。
   */
  flush(): Promise<void>;

  /**
   * 清除缓存（删除 manifest 文件，重置内存状态）。
   * @param generatorId 指定 generator 时仅清除该 generator 的条目，否则清除全部
   */
  clear(generatorId?: string): Promise<void>;

  /**
   * 返回统计摘要（委托 ManifestManager.stats()）。
   */
  stats(): ManifestStats;
}
```

**可选扩展接口**（Generator 声明依赖）：

```typescript
// 在 src/panoramic/interfaces.ts 中追加可选方法
interface DocumentGenerator<TInput, TOutput> {
  // ... 现有方法不变 ...

  /**
   * （可选）声明此 generator 依赖的文件路径列表。
   * 用于 ContentHasher 精确计算聚合 hash，提升缓存精度。
   * 未实现时，CacheManager 退回到扫描 projectRoot 下所有源文件的 fallback 策略。
   *
   * 注意：应包含 generator 在 extract() 中直接读取的所有文件路径，
   * 不仅是源代码文件，还包括依赖的配置文件路径（如 tsconfig.json、package.json 等）。
   */
  getDependencies?(context: ProjectContext): string[] | Promise<string[]>;
}
```

---

## 6. 性能要求

| 场景 | 目标 |
|------|------|
| 首次 batch（100 文件） | < 5 分钟 |
| 二次 batch（2/100 文件变化） | < 30 秒 |
| 缓存命中率（稳态） | > 90% |
| manifest 读写（1000 条目） | < 100ms |
| 单文件 SHA256 计算（1MB） | < 10ms |

---

## 7. 与现有系统的关系

### 7.1 DeltaRegenerator

`DeltaRegenerator`（`src/batch/delta-regenerator.ts`）负责 Spec 生成阶段的模块级增量决策，使用 AST skeleton hash，粒度为"该模块是否需要重生成 spec 文件"。

新缓存层在 batch pipeline 中位于 `DeltaRegenerator.plan()` 之后、`runProjectGenerator()` 之前，粒度为"该 panoramic generator 是否需要重新执行"。两者串行、平行、不相互替代，各自维护独立 manifest。

### 7.2 BatchState / checkpoint

`checkpoint.ts`（`src/batch/checkpoint.ts`）的 `saveCheckpoint()` 已实现 write-tmp-then-rename 原子写入模式。新缓存层通过提取 `writeAtomicJson()` 工具函数（`src/utils/atomic-write.ts`）复用该模式，不直接依赖 checkpoint 的业务逻辑。

`clearCheckpoint()` 展示的 `.tmp` 残留文件清理模式，在 `ManifestManager.flush()` 实现时同样应处理 `.tmp` 残留。`writeAtomicJson()` 统一放置在 `src/utils/atomic-write.ts`（通用工具，不限于 batch 场景）。

### 7.3 GeneratorRegistry

`GeneratorRegistry`（`src/panoramic/generator-registry.ts`）负责 generator 的注册与上下文过滤（`filterByContext()`），不负责 generator 执行。新缓存层不修改 Registry，也不在 Registry 中注入缓存逻辑，而是在 `batch-project-docs.ts` 的执行循环中侧挂。

**注意**：Registry 没有 `execute()` 方法，实际 generator 执行链路为 `extract → generate → render`，均在 `runProjectGenerator()`（`src/panoramic/batch-project-docs.ts`）中完成。

---

## 8. 目录结构

```
src/
  panoramic/
    cache/
      index.ts                   # 统一导出
      content-hasher.ts          # ContentHasher 实现
      manifest-manager.ts        # ManifestManager 实现
      cache-manager.ts           # CacheManager 实现（组合前两者）
      cache-key-builder.ts       # buildGeneratorCacheKey() 工具函数
      schemas.ts                 # Zod schemas（ManifestEntry、CacheManifest）
  utils/
    atomic-write.ts              # writeAtomicJson()（从 checkpoint.ts 提取）
  cli/
    commands/
      cache.ts                   # runCacheCommand()
    utils/
      parse-args.ts              # 追加 'cache' 到 subcommand 联合类型

specs/
  100-content-hash-cache/
    spec.md                      # 本文件
    research/
      tech-research.md
```

**运行时输出**（不纳入版本控制，已在 `.gitignore` 中通过 `_meta/` 规则覆盖）：

```
<outputDir>/
  _meta/
    _cache-manifest.json         # 缓存 manifest
    _cache-manifest.json.tmp     # 写入中间文件（正常情况下不存在）
```

---

## 9. 验收标准

1. **缓存命中跳过**：batch 首次执行 100 个文件后，不改变任何文件，再次执行 batch，日志中出现 `[cache-hit]` 条目，且所有 generator 均跳过 `extract/generate/render`，二次耗时 < 30 秒。

2. **部分变更命中率**：100 个文件中修改 2 个后执行 batch，只有涉及这 2 个文件的 generator 重新执行，其余 generator 输出 `[cache-hit]` 日志。假设有 N 个 applicableGenerators，期望其中 ≥ N×90% 个输出 `[cache-hit]`（例如 10 个 generator 中有 ≥ 9 个命中）。

3. **manifest 原子性**：在 `flush()` 过程中强制中断进程，重新启动后 manifest 文件仍可正常解析（不存在部分写入的损坏文件），或 `.tmp` 残留不影响下次加载。

4. **manifest 读写性能**：构造 1000 条 entry 的 manifest，`load()` + `flush()` 组合耗时 < 100ms（Node.js 基准测试可验证）。

5. **缓存失效 - 文件删除**：删除 generator 依赖的某个源文件后执行 batch，该 generator 不命中缓存，重新执行并更新 manifest。

6. **缓存失效 - 内容变化**：修改 generator 依赖文件的内容（mtime 不变，通过 `--preserve-timestamps` 模拟），cache-manager 依然检测到 hash 变化，判定 stale，重新执行 generator。

7. **版本兼容**：手动将 `_cache-manifest.json` 的 `version` 字段改为 `"0"` 后执行 batch，系统打印版本不兼容警告并自动清空缓存，继续正常执行，不抛错。

8. **CLI - stats**：`spectra cache stats` 输出条目数、总 size、最新更新时间、按 generator 分组的条目数，且数值与 manifest 文件内容一致。

9. **CLI - clear 全量**：`spectra cache clear` 执行后，`_cache-manifest.json` 文件被删除，再次执行 batch 时重建 manifest。

10. **CLI - clear 指定 generator**：`spectra cache clear --generator workspace-index` 执行后，manifest 中仅删除 `generatorId === 'workspace-index'` 的条目，其他 generator 条目保留。

11. **Markdown frontmatter 跳过**：修改某 `.md` 文件的 frontmatter 字段（如 `updated: 2026-04-12`）但不修改正文，对应 generator 命中缓存，不重新执行。

12. **TypeScript strict 编译**：新增所有文件通过 `tsc --strict` 编译，无类型错误。

---

## 10. 约束与风险

### 10.1 技术约束

- 纯 Node.js 标准库（`crypto`、`fs`、`path`）；不引入外部依赖
- TypeScript strict 模式；所有 schema 使用 Zod 定义
- 中文代码注释，标识符使用英文
- `_meta/` 已被 `.gitignore` 忽略，manifest 文件不纳入版本控制
- Cache 操作不应与 batch 并发执行（当前串行架构下无此问题，需在文档中明确约束）
- manifest 数据结构须预留 `dependencyGraph` 可选字段，供 Feature 101 扩展

### 10.2 已知风险及缓解

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| **哈希粒度不一致**：DeltaRegenerator 使用 AST skeleton hash，新缓存使用原始内容 hash，可能导致两层判断不一致 | 中 | 明确文档化两层差异；新缓存 key 刻意与 DeltaReport 解耦，各自独立 |
| **generator 读取未声明依赖**：`extract()` 中自行读文件但不声明依赖列表，缓存 key 无法感知这些文件变化 | 高 | 短期：在 `DocumentGenerator` 接口增加可选 `getDependencies()` 方法；未实现时 fallback 扫描 `projectRoot` 全部源文件（安全但性能稍差）；长期：各 generator 逐步实现 `getDependencies()` |
| **ProjectContext 易变字段误判失效**：`existingSpecs` 每次运行都变化，若纳入 cache key 会导致每次缓存失效 | 高 | cache key 只包含稳定字段：`projectRoot`、`workspaceType`、`packageManager`、`detectedLanguages`，明确排除 `existingSpecs`、`configFiles`（Map 序列化不稳定） |
| **并发写入 manifest**：未来 batch 并发化后，多 generator 同时写 manifest 会产生竞争 | 低（当前串行） | 原子写入（tmp+rename）保证最终一致；当前串行架构下无此问题，并发化时需引入写锁 |
| **旧版 manifest 兼容性**：schema 变化导致旧 manifest 无法解析 | 中 | manifest 包含顶层 `version` 字段，加载时做版本校验，不兼容时自动清空并打印警告，不抛错中断 |
| **cache CLI 与 batch 并发**：`spectra cache clear` 与正在运行的 batch 并发时可能导致 manifest 状态不一致 | 低 | 文档明确约束；当前 CLI 单进程，无实际并发场景 |

---

## 11. 未来扩展

### Feature 101（graph-persistence）兼容性

每条 `ManifestEntry` 预留 `dependencyGraph?: unknown` 可选字段。Feature 101 可将此字段定义为结构化的依赖图（如 `Record<string, string[]>`），描述 generator 输出节点之间的依赖关系，供增量图更新使用。

manifest 的顶层 `version` 字段在 Feature 101 引入 `dependencyGraph` 时从 `'1'` 升级为 `'2'`，并在 `ManifestManager.load()` 中添加迁移逻辑（`v1 → v2` 补填 `dependencyGraph: undefined`），保证向前兼容。

### Feature 102（spectra-config-migration）

如 Feature 102 引入配置文件路径变更，`CacheManager.initialize()` 中的 `outputDir` 来源需随之更新。cache layer 本身无硬编码路径，兼容性由调用方保证。

### 批注入点 B（模块级 Spec 生成缓存）

本 Feature 仅覆盖注入点 A（panoramic generator 维度）。注入点 B（`batch-orchestrator.ts` L408 处，基于内容 hash 替换文件存在性检查）留作后续独立 Feature 实现，估算可再降低 20-30% 耗时。
