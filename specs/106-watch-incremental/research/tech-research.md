# Feature 106 技术调研报告

> 生成时间: 2026-04-12
> 调研范围: prompt 引用的接口、代码位置、行号准确性

## 验证结果

### 1. ManifestManager

- 状态: ✅ 完全匹配
- 实际位置: `src/panoramic/cache/manifest-manager.ts`
- 接口定义: L37-72，`ManifestManager` interface
- 方法签名:
  - `load(manifestPath: string): Promise<void>` (L43)
  - `get(cacheKey: string): ManifestEntry | undefined` (L49)
  - `set(entry: ManifestEntry): void` (L54)
  - `delete(generatorId?: string): void` (L60)
  - `flush(manifestPath: string): Promise<void>` (L66)
  - `stats(): ManifestStats` (L71)
- `ManifestEntry` 类型: 定义在 `src/panoramic/cache/schemas.ts` L32-50，含 `cacheKey`, `generatorId`, `inputFiles`, `outputFiles`, `createdAt`, `type?`, `dependencyGraph?` 字段
- `ManifestStats` 类型: L19-28，含 `entryCount`, `totalSizeBytes`, `lastUpdatedAt`, `byGenerator`
- 实现类: `ManifestManagerImpl` (L90-199)
- 备注: 接口和方法签名与 prompt 描述完全一致

### 2. ContentHasher

- 状态: ✅ 完全匹配
- 实际位置: `src/panoramic/cache/content-hasher.ts`
- 接口定义: L17-39，`ContentHasher` interface
- 方法签名:
  - `hashFile(filePath: string): Promise<string>` — SHA256，.md 自动跳过 frontmatter (L24)
  - `hashFiles(filePaths: string[]): Promise<string>` — 聚合哈希 (L31)
  - `hashContent(content: string): string` — 字符串哈希 (L38)
- 实现类: `ContentHasherImpl` (L85-135)
- 备注: 使用 `crypto.createHash('sha256')`，与 prompt 描述一致

### 3. CacheManager

- 状态: ✅ 完全匹配
- 实际位置: `src/panoramic/cache/cache-manager.ts`
- 类定义: `CacheManager` class (L20-195)
- 核心方法:
  - `initialize(outputDir: string): Promise<void>` (L37)
  - `check(generator, context): Promise<ManifestEntry | false>` — 三路 stale 校验 (L53)
  - `record(generator, context, outputFiles): Promise<void>` — 记录执行结果 (L116)
  - `flush(): Promise<void>` — 刷盘 (L159)
  - `clear(generatorId?: string): Promise<void>` — 清除缓存 (L167)
  - `stats(): ManifestStats` — 统计委托 (L192)
- 备注: 缓存拦截逻辑完整，组合 ContentHasher + ManifestManager

### 4. BatchOrchestrator

- 状态: ⚠️ 行号轻微偏差（差 1-4 行），逻辑完全匹配
- 实际位置: `src/batch/batch-orchestrator.ts`
- **BatchOptions 定义**:
  - prompt 引用 L55，实际位于 **L51-71**（偏差 -4 行）
  - `incremental?: boolean` 确认存在于 L55
- **DeltaRegenerator 差量分析**:
  - prompt 引用 L288-314，实际位于 **L287-314**（偏差 -1 行起始）
  - 逻辑: incremental 模式下实例化 `DeltaRegenerator` 并调用 `plan()`，force 时生成 full mode deltaReport
- **shouldSkipModule 决策逻辑**:
  - prompt 引用 L402-416，实际位于 **L401-416**（偏差 -1 行起始）
  - 注意: 这不是一个独立的 `shouldSkipModule()` 函数，而是 `runBatch()` 内部的内联逻辑（L401-416 是 non-root module 的 shouldGenerate 判断 + skip 处理）
  - 根模块(root)的跳过逻辑在 L401-406，非根模块在 L408-416
- 备注: 行号偏差极小，可能因版本微调。`shouldSkipModule` 并非独立函数名，而是内联在 for 循环中的条件判断

### 5. CLI 入口

- 状态: ✅ 完全匹配
- 实际位置: `src/cli/index.ts`
- HELP_TEXT: L32-77，字符串常量定义
- switch 分支结构: L116-144，switch(command.subcommand) 覆盖所有子命令
- 现有子命令: generate, batch, diff, init, prepare, auth-status, panoramic, cache, mcp-server
- 备注: 新增 `watch` 子命令需要在 switch 中添加 case、HELP_TEXT 中添加用法说明、import 对应 handler

### 6. 参数解析

- 状态: ✅ 完全匹配
- 实际位置: `src/cli/utils/parse-args.ts`
- `CLICommand` interface: L7-39，联合类型 subcommand
- `parseArgs(argv: string[]): ParseResult` 函数: L60-394
- 解析模式: 独立的 if/else 分支处理每个子命令（panoramic L97-132、cache L135-171、init L174-214 等）
- 备注: 新增 `watch` 子命令需要:
  1. CLICommand.subcommand 联合类型添加 `'watch'`
  2. 新增 `watchOperation?` 等字段
  3. parseArgs 中添加 `watch` 解析分支（参考 cache/panoramic 模式）

### 7. CLI 命令参考 (cache.ts)

- 状态: ✅ 完全匹配
- 实际位置: `src/cli/commands/cache.ts`
- 模式: 导出 `runCacheCommand(command: CLICommand)` async 函数
- 内部结构:
  1. CACHE_HELP 常量 (L15-27)
  2. help/无操作时打印帮助 (L33-36)
  3. 初始化 CacheManager (L38-43)
  4. 按 cacheOperation 分发处理 (L45-72)
- 备注: watch 命令可完全参考此模式，创建 `src/cli/commands/watch.ts`

### 8. package.json (chokidar 依赖)

- 状态: ✅ 确认无 chokidar 依赖
- 验证方式: grep 搜索 package.json，无匹配
- 备注: Feature 106 需要新增 `chokidar` 依赖（`npm install chokidar`）

## 发现的偏差

1. **BatchOrchestrator 行号偏差**: prompt 引用的行号与实际代码偏差 1-4 行，属于版本迭代导致的正常漂移，不影响实现
2. **shouldSkipModule 命名**: prompt 称 L402-416 为 "shouldSkipModule 决策逻辑"，但代码中没有同名函数，实际是 `runBatch()` 内 for 循环中的内联条件判断（变量名 `shouldGenerate`）。watch 模块复用此逻辑时，建议提取为独立函数
3. **ManifestEntry.dependencyGraph**: schemas.ts 中已预留 `dependencyGraph: z.unknown().optional()` 字段，标注为 Feature 101 扩展点。Feature 106 如需持久化图数据可直接使用

## 对实现的建议

1. **CLI 扩展清单**: 新增 watch 子命令需改动 3 个文件:
   - `src/cli/utils/parse-args.ts` — CLICommand 类型 + 解析分支
   - `src/cli/index.ts` — import + switch case + HELP_TEXT
   - `src/cli/commands/watch.ts` — 新建 handler（参考 cache.ts 模式）

2. **复用 CacheManager 的 check() 方法**: watch 的文件变更检测可复用 `CacheManager.check()` 的三路 stale 校验逻辑（文件存在性、mtime、SHA256），而不是重新实现

3. **BatchOrchestrator 内联跳过逻辑提取**: 建议将 L401-416 的 shouldGenerate 判断提取为独立函数 `shouldSkipModule()`，同时供 batch 和 watch 复用

4. **chokidar 版本**: 建议使用 chokidar@4.x（ESM 原生支持，与项目 TypeScript ESM 配置一致）

5. **ManifestManager 并发安全**: `cache-manager.ts` L5-6 已标注 "不应与 batch 并发执行"。watch 模式下如果触发增量重生成，需要确保不与正在运行的 batch 进程冲突（建议使用 lock file）
