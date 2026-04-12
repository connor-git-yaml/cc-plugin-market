---
feature_id: "100"
feature_name: "content-hash-cache"
type: tasks
status: draft
created: "2026-04-12"
total_tasks: 18
---

# 任务清单：content-hash-cache

## 依赖关系

```
T-001 ──► T-003
T-002 ──► T-004 ──► T-005
T-003 ──► T-005 ──► T-006 ──► T-007
T-004 ──► T-006
T-007 ──► T-008 ──► T-009
T-007 ──► T-010 ──► T-011 ──► T-012
T-009 ──► T-013
T-012 ──► T-013
T-001 ──► T-014
T-004 ──► T-015
T-007 ──► T-016
T-013 ──► T-017
T-016 ──► T-017
T-014 ─┐
T-015 ──► T-018（集成验证汇总）
T-016 ─┘
T-017 ──► T-018
```

说明：
- T-001～T-004 为 Phase A 基础设施层（独立并行可启动）
- T-005～T-007 为 Phase B Manifest 管理层
- T-008～T-009 为 Phase C 缓存拦截层（核心实现）
- T-010～T-012 为 Phase C 注入点与接口扩展
- T-013～T-016 为 Phase D CLI 层
- T-017～T-018 为 Phase E 集成验证

---

## Phase A: 基础设施层

### T-001: 新建原子写入工具 `atomic-write.ts`
- **文件**: `src/utils/atomic-write.ts`（新增）
- **描述**: 从 `src/batch/checkpoint.ts` 的 `saveCheckpoint()` 提取通用原子写入逻辑，实现 `writeAtomicJson(filePath: string, data: unknown): void`。核心流程：`path.resolve` 解析绝对路径 → `fs.mkdirSync({ recursive: true })` 创建目录 → 写 `${path}.tmp` → `fs.renameSync` 原子替换。`.tmp` 残留由 renameSync 覆盖，无需预清理。
- **验收**: 导出函数签名正确；写入 JSON 使用 2 空格缩进；目标目录不存在时自动创建；`npm run build` 无类型错误
- **依赖**: none
- **预估**: S

### T-002: 新建 Zod Schema 定义 `schemas.ts`
- **文件**: `src/panoramic/cache/schemas.ts`（新增）
- **描述**: 使用 Zod 定义并导出三层 schema 和对应 TypeScript 类型：`FileHashRecordSchema`（path / hash / mtime / size）、`ManifestEntrySchema`（cacheKey / generatorId / inputFiles / outputFiles / createdAt / type? / dependencyGraph?）、`CacheManifestSchema`（version: z.literal('1') / updatedAt / entries）。`dependencyGraph` 使用 `z.unknown().optional()` 预留供 Feature 101 扩展。
- **验收**: 三个 schema 均可 `safeParse` 合法数据通过；`CacheManifestSchema.parse` 对 `version: "0"` 抛出 ZodError；导出类型完整可供后续模块 import；`tsc --strict` 无错误
- **依赖**: none
- **预估**: S

### T-003: 新建内容哈希引擎 `content-hasher.ts`
- **文件**: `src/panoramic/cache/content-hasher.ts`（新增）
- **描述**: 定义 `ContentHasher` 接口并实现 `ContentHasherImpl` 类。`hashFile(filePath)` 读文件，对 `.md` 扩展名调用内部 `stripFrontmatter()` 提取正文后对 `filePath + content` 计算 SHA256。`hashFiles(filePaths)` 并发 `Promise.all` 计算各文件 hash，按 filePaths 排序后拼接再次 SHA256（保证文件集合相同、顺序不同时结果一致）。`hashContent(content)` 同步计算 SHA256。`stripFrontmatter()` 实现三种边界规则：首行非 `---` 返回全文；找到闭合 `---` 返回其后正文；50 行内未找到闭合降级返回全文。全部使用 `node:crypto`，无外部依赖。
- **验收**: 相同内容 hash 相同；修改 `.md` frontmatter 不影响 hash；修改正文后 hash 变化；无 frontmatter 的 `.md` 哈希全文；未闭合 frontmatter 降级哈希全文；正文含 `---` 水平线不误判；`hashFiles` 对入参顺序不敏感；`tsc --strict` 无错误
- **依赖**: T-001（`writeAtomicJson` 不直接依赖，但先建基础再建实现是推荐顺序）
- **预估**: M

### T-004: 新建 cache 模块统一导出 `index.ts`
- **文件**: `src/panoramic/cache/index.ts`（新增）
- **描述**: 统一 re-export `schemas.ts`、`content-hasher.ts`，以及 Phase B-C 完成后的 `manifest-manager.ts`、`cache-key-builder.ts`、`cache-manager.ts` 的公开接口。当前阶段只导出 Phase A 的内容，后续阶段逐步补充。文件保持薄壳，不含业务逻辑。
- **验收**: `import { ContentHasherImpl, FileHashRecord, CacheManifest } from './cache/index.js'` 可正常导入；`tsc --strict` 无错误
- **依赖**: T-002、T-003
- **预估**: S

---

## Phase B: Manifest 管理层

### T-005: 新建 `manifest-manager.ts` 核心实现
- **文件**: `src/panoramic/cache/manifest-manager.ts`（新增）
- **描述**: 定义 `ManifestManager` 接口并实现 `ManifestManagerImpl` 类。内部状态维护 `manifest: CacheManifest`（初始为空）和 `manifestPath: string`。`load(manifestPath)` 实现：记录路径；文件不存在则保持空 manifest；读文件后用 `CacheManifestSchema.safeParse()` 验证；`version !== '1'` 或 parse 失败时 `console.warn` 并重置，不抛错。`get(cacheKey)` 返回 entry 或 undefined。`set(entry)` 更新内存条目。`delete(generatorId?)` 无参时清空全部、有参时遍历删除匹配条目。`flush(manifestPath)` 更新 `updatedAt = Date.now()` 后调用 `writeAtomicJson` 原子写盘。`stats()` 遍历 entries 累加 inputFiles size、按 generatorId 分组计数，返回 `ManifestStats`。
- **验收**: `load` 文件不存在时静默；`load` version 不兼容打印 warn 并清空不抛错；`load` JSON 损坏打印 warn 并清空不抛错；`set + flush` 后文件内容正确；`delete(generatorId)` 只删指定条目；`delete()` 清空全部；`stats()` totalSizeBytes 为 inputFiles.size 累加值；1000 条 entry 的 `load + flush` 组合 < 100ms；`tsc --strict` 无错误
- **依赖**: T-002（schemas）、T-001（writeAtomicJson）
- **预估**: M

### T-006: 更新 cache 统一导出 `index.ts`（Phase B）
- **文件**: `src/panoramic/cache/index.ts`（修改）
- **描述**: 在 T-004 基础上追加导出 `ManifestManager`、`ManifestManagerImpl`、`ManifestStats` 接口和类型。
- **验收**: 外部模块可通过 `import { ManifestManagerImpl } from './cache/index.js'` 正常导入；`tsc --strict` 无错误
- **依赖**: T-004、T-005
- **预估**: S

---

## Phase C: 缓存拦截层

### T-007: 新建 cache key 构建器 `cache-key-builder.ts`
- **文件**: `src/panoramic/cache/cache-key-builder.ts`（新增）
- **描述**: 导出核心函数 `buildGeneratorCacheKey(generator, context, hasher): Promise<string>` 和内部辅助函数 `resolveInputFiles(generator, context): Promise<string[]>`、`scanSourceFiles(root): string[]`。`resolveInputFiles` 逻辑：若 generator 实现了可选 `getDependencies(context)`，调用获取文件列表；否则 fallback 调用 `scanSourceFiles`（递归 `fs.readdirSync`，排除 `node_modules / .git / _meta / dist / .cache`，仅收集 `.ts/.tsx/.js/.jsx/.json/.md/.yaml/.yml`，结果排序后返回）。key 材料构成：`generator.id|context.projectRoot|context.workspaceType|context.packageManager|detectedLanguages.sort().join(',')|aggregatedFileHash`，使用 `crypto.createHash('sha256').update(keyMaterial).digest('hex')` 返回。文件头注释明确排除 `existingSpecs`、`configFiles` 的原因；fallback 路径标注性能影响说明。
- **验收**: 相同稳定字段 + 不同 `existingSpecs` 产生相同 cache key；generator 实现 `getDependencies()` 时使用其返回值而非全量扫描；fallback 扫描正确排除噪声目录；`tsc --strict` 无错误
- **依赖**: T-003（ContentHasher 接口）、T-006（index 导出已就绪）
- **预估**: M

### T-008: 新建缓存管理器 `cache-manager.ts`
- **文件**: `src/panoramic/cache/cache-manager.ts`（新增）
- **描述**: 实现 `CacheManager` 类，组合 `ContentHasher` 和 `ManifestManager`。构造函数接收两者实例。`initialize(outputDir)` 计算 `manifestPath = path.join(outputDir, '_meta', '_cache-manifest.json')` 并调用 `manifestManager.load(manifestPath)`。`check(generator, context): Promise<ManifestEntry | false>`（采用方案二，返回 entry 或 false）：调用 `buildGeneratorCacheKey` 得到 cacheKey；manifest 无 entry 返回 false；entry 存在则对每个 inputFile 执行三路 stale 校验（文件不存在/mtime 回滚/hash 不一致），全部通过时打印 `[cache-hit] ${generatorId}: ${N} files unchanged, reusing output` 并返回 entry，任一 stale 返回 false。`record(generator, context, outputFiles)` 仅由成功路径调用：复用私有 `resolveInputFiles` 方法取输入文件列表，为每个文件构建 `FileHashRecord`，写入 `manifestManager.set(entry)`。`flush()` 委托 `manifestManager.flush(manifestPath)`。`clear(generatorId?)` 调用 `manifestManager.delete(generatorId)`；清全部时删除 manifest 文件及 `.tmp` 残留；清指定 generator 时调用 `flush()` 写回。`stats()` 委托 `manifestManager.stats()`。文件头注释说明并发约束。
- **验收**: 无 entry 时 `check()` 返回 false；命中时返回 entry 并打印 `[cache-hit]` 日志；文件删除/mtime 回滚/内容变化三路均判定 stale；`record()` 后再次 `check()` 命中；`flush()` 产生原子写入文件；`clear()` 无参删除 manifest 文件；`clear(generatorId)` 只删指定条目；`tsc --strict` 无错误
- **依赖**: T-005（ManifestManager）、T-007（cache-key-builder）
- **预估**: L

### T-009: 修改 `interfaces.ts` 追加可选 `getDependencies()` 方法
- **文件**: `src/panoramic/interfaces.ts`（修改）
- **描述**: 在 `DocumentGenerator<TInput, TOutput>` 接口的 `render` 方法之后追加可选方法声明：`getDependencies?(context: ProjectContext): string[] | Promise<string[]>`。JSDoc 注释说明：此方法可选；用于 ContentHasher 精确计算聚合 hash；应包含 extract() 中直接读取的所有文件路径，包括配置文件（tsconfig.json、package.json 等）；未实现时 CacheManager 退回全量源文件扫描。不修改接口上任何现有方法签名。
- **验收**: 现有实现 `DocumentGenerator` 的类无需改动也可通过编译；`getDependencies` 为真正 optional（`?`）；JSDoc 包含配置文件约束说明；`npm run build` 无类型错误
- **依赖**: T-007（cache-key-builder 中已引用该接口）
- **预估**: S

### T-010: 修改 `batch-project-docs.ts` 注入缓存拦截
- **文件**: `src/panoramic/batch-project-docs.ts`（修改）
- **描述**: 最小化改动 `generateBatchProjectDocs()` 函数，其余函数保持完全不变。具体四处改动：1）文件顶部 import 区块追加 `CacheManager`、`ContentHasherImpl`、`ManifestManagerImpl` 的 import；2）`bootstrapGenerators()` 调用后、`for...of` 循环前插入 CacheManager 初始化（`new CacheManager(new ContentHasherImpl(), new ManifestManagerImpl())` + `await cacheManager.initialize(options.outputDir)`）；3）循环体开头插入 `const cacheHit = await cacheManager.check(generator, projectContext)`，命中（`!== false`）时 push 已记录输出路径、`structuredOutputs.set(generator.id, undefined)` 并 continue，失败保留旧 entry 不变（catch 块不调用 record）；4）for 循环结束后插入 `await cacheManager.flush()`。注入点注释说明两层缓存的执行顺序和独立性。
- **验收**: 二次 batch 不改动文件时 `[cache-hit]` 日志出现；生成失败时旧 entry 不被覆盖；`structuredOutputs` 缓存命中 generator 对应值为 undefined（下游安全）；`npm run lint && npm run build` 无错误
- **依赖**: T-008（CacheManager）、T-009（interfaces 扩展）
- **预估**: M

### T-011: 更新 cache 统一导出 `index.ts`（Phase C）
- **文件**: `src/panoramic/cache/index.ts`（修改）
- **描述**: 追加导出 `CacheManager`、`buildGeneratorCacheKey` 以及从 `cache-manager.ts` 导出的 `ManifestStats` 类型（若 Phase B 未导出）。
- **验收**: 外部模块通过 `cache/index.js` 可正常 import CacheManager；`tsc --strict` 无错误
- **依赖**: T-006、T-008
- **预估**: S

---

## Phase D: CLI 层

### T-012: 修改 `parse-args.ts` 注册 cache 子命令
- **文件**: `src/cli/utils/parse-args.ts`（修改）
- **描述**: 五处改动：1）`CLICommand` 接口追加 `cacheOperation?: 'stats' | 'clear'` 和 `cacheGeneratorId?: string` 字段（紧接 `panoramicOperation` 字段之后）；2）`subcommand` 联合类型追加 `'cache'`；3）`parseArgs()` 函数中在 `panoramic` 分支之后插入 `cache` 分支：解析第二位参数为 op（stats/clear），无 op 或有 --help 时返回 `help: true`，非法 op 返回 `ok: false` 错误，正常解析 `--output-dir`、`--generator` 参数；4）`extractPositionalArgs()` 中追加 `--generator` 到参数跳过列表；5）确认子命令有效性守卫中包含 `'cache'`。
- **验收**: `['cache', 'stats']` 解析 `cacheOperation: 'stats'`；`['cache', 'stats', '--output-dir', '/tmp']` 解析 `outputDir`；`['cache', 'clear']` 解析 `cacheOperation: 'clear'`；`['cache', 'clear', '--generator', 'workspace-index']` 解析 `cacheGeneratorId`；`['cache']` 返回 `help: true`；`['cache', 'unknown']` 返回 `ok: false`；`tsc --strict` 无错误
- **依赖**: T-011（依赖 CacheManager 稳定后再开 CLI 层）
- **预估**: M

### T-013: 新建 CLI 命令文件 `cache.ts`
- **文件**: `src/cli/commands/cache.ts`（新增）
- **描述**: 参照 `src/cli/commands/panoramic.ts` 结构实现 `runCacheCommand(command: CLICommand): Promise<void>`。包含 `CACHE_HELP` 文本（usage、子操作说明、选项说明）。`stats` 分支：实例化 CacheManager + initialize + 调用 `stats()`，格式化输出 manifest 路径、条目数、总 size（MB）、最后更新时间（ISO 格式或"无记录"）、各 generator 分组条目数。`clear` 分支：调用 `cacheManager.clear(command.cacheGeneratorId)` 并输出操作结果日志。`outputDir` fallback 为 `path.join(process.cwd(), 'specs')`。文件头注释说明并发约束（不应与 batch 并发执行）。
- **验收**: `stats` 输出格式包含 manifest 路径、Entries、Total size、Last updated、Generators 字段；数值与 manifest 文件内容一致；`clear` 无参删除 manifest 文件；`clear --generator` 后指定 generator 条目消失、其余保留；`help: true` 时输出 CACHE_HELP；`tsc --strict` 无错误
- **依赖**: T-012（parse-args 稳定后再实现命令文件）
- **预估**: M

### T-014: 修改 `cli/index.ts` 注册 cache 命令
- **文件**: `src/cli/index.ts`（修改）
- **描述**: 五处改动：1）import 区块追加 `import { runCacheCommand } from './commands/cache.js'`（紧接 runPanoramicCommand import 之后）；2）HELP_TEXT 用法行追加 `spectra cache <stats|clear> [--generator <id>] [--output-dir <dir>]`；3）HELP_TEXT 子命令说明追加 `cache  管理内容哈希缓存（stats / clear）`；4）HELP_TEXT 选项说明追加 `--generator  指定 generator ID（仅 cache clear）`；5）`switch (command.subcommand)` 末尾追加 `case 'cache': await runCacheCommand(command); break;`。
- **验收**: `spectra cache stats` 可正常路由到 `runCacheCommand`；`spectra --help` 输出包含 cache 子命令说明；`npm run build` 无类型错误
- **依赖**: T-013（命令文件就绪后再注册路由）
- **预估**: S

---

## Phase E: 集成验证

### T-015: 编写 Phase A 单元测试
- **文件**: `src/utils/__tests__/atomic-write.test.ts`（新增）、`src/panoramic/cache/__tests__/content-hasher.test.ts`（新增）
- **描述**: 两个测试文件。`atomic-write.test.ts` 测试用例：正常写入后内容正确；目录不存在时自动创建；JSON 2 空格缩进；`.tmp` 残留场景（模拟 renameSync 前中断后重试可覆盖）。`content-hasher.test.ts` 测试用例：相同内容 hash 相同；`.md` frontmatter 修改不影响 hash（正文相同）；`.md` 正文变化后 hash 变化；无 frontmatter `.md` 哈希全文；未闭合 frontmatter 降级哈希全文；正文含 `---` 水平线不误判为 frontmatter 闭合；`hashFiles` 对入参顺序不敏感（同集合不同顺序结果相同）。
- **验收**: 所有测试用例通过；覆盖 AC-3（atomic-write）、AC-6（hash 精度）、AC-11（frontmatter 边界）
- **依赖**: T-001、T-003
- **预估**: M

### T-016: 编写 Phase B-C 单元测试
- **文件**: `src/panoramic/cache/__tests__/manifest-manager.test.ts`（新增）、`src/panoramic/cache/__tests__/cache-manager.test.ts`（新增）
- **描述**: 两个测试文件。`manifest-manager.test.ts` 测试用例：`load` 有效 manifest 后 `get` 返回正确 entry；`load` 文件不存在时空 manifest；`load` version 不兼容打印 warn 并清空不抛错（AC-7）；`load` JSON 损坏打印 warn 并清空不抛错；`set + flush` 后文件内容正确；`delete(generatorId)` 只删指定条目（AC-10）；`delete()` 清空全部（AC-9）；`stats()` totalSizeBytes 正确；`stats()` byGenerator 分组正确（AC-8）；性能基准：1000 条 entry `load + flush` < 100ms（AC-4）。`cache-manager.test.ts` 测试用例：无 entry 时 `check()` 返回 false（AC-1）；entry 存在未 stale 时返回 ManifestEntry 并打印 `[cache-hit]`（AC-1/2）；源文件删除判定 stale（AC-5）；mtime 回滚判定 stale（AC-6）；mtime 不变但 hash 变化判定 stale（AC-6）；`record()` 后再次 `check()` 命中（AC-1）；`flush()` 原子写入（AC-3）；`clear()` 无参删除 manifest 文件（AC-9）；`clear(generatorId)` 只删指定条目（AC-10）。
- **验收**: 所有测试用例通过；覆盖 AC-1/2/3/4/5/6/7/8/9/10
- **依赖**: T-005、T-008
- **预估**: L

### T-017: 编写 Phase D 单元测试
- **文件**: `src/cli/__tests__/parse-args-cache.test.ts`（新增）、`src/cli/__tests__/cache-command.test.ts`（新增）
- **描述**: 两个测试文件。`parse-args-cache.test.ts` 测试用例（对应 T-012 验收）：`['cache', 'stats']` 解析结果；`['cache', 'stats', '--output-dir', '/tmp/out']` outputDir 解析；`['cache', 'clear']` 解析；`['cache', 'clear', '--generator', 'workspace-index']` cacheGeneratorId 解析；`['cache']` 返回 help: true；`['cache', 'unknown-op']` 返回 ok: false。`cache-command.test.ts` 测试用例：`stats` 输出包含预期字段（mock CacheManager.stats() 返回固定数据）；`clear` 无参调用 `cacheManager.clear(undefined)` 并输出日志（AC-9）；`clear --generator` 调用 `cacheManager.clear('workspace-index')` 并输出日志（AC-10）；`help: true` 时输出 CACHE_HELP 文本（AC-8）。
- **验收**: 所有测试用例通过；覆盖 AC-8/9/10
- **依赖**: T-012、T-013、T-014
- **预估**: M

### T-018: 编写集成测试套件与 TypeScript 编译验证
- **文件**: `src/panoramic/cache/__tests__/integration.test.ts`（新增）
- **描述**: 端到端集成测试，使用临时目录模拟 panoramic batch 执行环境。五个场景：1）全量命中：首次 `record()` 写入 manifest，二次 `check()` 全部命中 `[cache-hit]`（AC-1）；2）部分变更：修改部分文件内容后，只有对应 generator miss，其余命中（AC-2）；3）manifest 原子性：mock `writeAtomicJson` 在 `renameSync` 前抛出，验证主文件不损坏或 `.tmp` 不影响下次 `load`（AC-3）；4）版本不兼容：手写 `version: "0"` 的 manifest 文件，`initialize()` 后 manifest 被清空继续执行不抛错（AC-7）；5）frontmatter-only 变更：修改 `.md` frontmatter 但正文不变，`check()` 仍命中（AC-11）。集成验证结束后，在 CI 中运行 `tsc --strict`（AC-12）。
- **验收**: 五个场景全部通过（AC-1/2/3/7/11）；`npm test` 整体通过；`npm run lint && npm run build`（tsc --strict）无错误（AC-12）
- **依赖**: T-015、T-016、T-017（所有实现和测试完成后执行）
- **预估**: L

---

## 执行摘要

| Phase | 任务数 | 预估工作量 | 关键路径 |
|-------|--------|-----------|---------|
| A（基础设施层） | 4（T-001～T-004） | S+S+M+S = ~1.5 天 | T-002（schemas）→ T-003（content-hasher）→ T-004（index） |
| B（Manifest 管理层） | 2（T-005～T-006） | M+S = ~1 天 | T-005（manifest-manager 含性能基准） |
| C（缓存拦截层） | 4（T-007～T-011） | M+L+S+M+S = ~2.5 天 | T-007（key-builder）→ T-008（cache-manager）→ T-010（注入 batch-project-docs） |
| D（CLI 层） | 3（T-012～T-014） | M+M+S = ~1.5 天 | T-012（parse-args）→ T-013（cache.ts）→ T-014（index.ts） |
| E（集成验证） | 4（T-015～T-018） | M+L+M+L = ~2.5 天 | T-016（B-C 单测）→ T-018（集成测试） |
| **合计** | **18** | **~9 天** | A→B→C→E（主链路） |

**关键路径**：T-002 → T-005 → T-007 → T-008 → T-010 → T-016 → T-018

**并行机会**：
- T-001 和 T-002 可同时启动（无互相依赖）
- Phase D（T-012～T-014）在 T-011 完成后可与 T-015 并行推进
- T-015 可在 T-001/T-003 完成后立即开始，无需等待 Phase B-C
