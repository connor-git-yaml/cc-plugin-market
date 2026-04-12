---
feature_id: "100"
feature_name: "content-hash-cache"
type: plan
status: draft
created: "2026-04-12"
---

# 实施规划：content-hash-cache

## 1. 实施策略

### 1.1 分阶段交付

本 Feature 分五个阶段交付，每阶段均可独立编译、独立验证，后阶段以前阶段产物为前提。

| 阶段 | 名称 | 核心产物 | 验证方式 |
|------|------|---------|---------|
| Phase A | 基础设施层 | `atomic-write.ts`、`schemas.ts`、`content-hasher.ts` | 单元测试 + `tsc --strict` |
| Phase B | Manifest 管理层 | `manifest-manager.ts` | 单元测试（含 1000 条 entry 性能基准） |
| Phase C | 缓存拦截层 | `cache-key-builder.ts`、`cache-manager.ts`、`batch-project-docs.ts` 注入 | 集成测试（缓存命中/miss/失效三路） |
| Phase D | CLI 层 | `parse-args.ts`、`cache.ts`（命令文件）、`cli/index.ts` | 单元测试 + 手动 smoke test |
| Phase E | 集成验证 | 端到端测试套件 | 覆盖全部 12 条验收标准 |

### 1.2 依赖关系

```
Phase A ──► Phase B ──► Phase C ──► Phase E
                               └──► Phase D ──► Phase E
```

- Phase B 依赖 Phase A 的 `schemas.ts` 和 `writeAtomicJson()`
- Phase C 依赖 Phase A 的 `content-hasher.ts` 和 Phase B 的 `ManifestManager`
- Phase D 依赖 Phase B 的 `ManifestManager` 和 Phase C 的 `CacheManager`
- Phase E 依赖全部前序阶段完成

---

## 2. 阶段详细设计

### Phase A: 基础设施层

**目标**：搭建原子写入工具、Zod schema 定义、ContentHasher 实现，无外部依赖。

**A-1. 新建 `src/utils/atomic-write.ts`**

从 `src/batch/checkpoint.ts` 的 `saveCheckpoint()` 提取通用原子写入逻辑：

```typescript
// 导出函数签名
export function writeAtomicJson(filePath: string, data: unknown): void
```

实现要点：
- `path.resolve(filePath)` 解析绝对路径
- `fs.mkdirSync(dir, { recursive: true })` 确保目录存在
- 写 `${resolvedPath}.tmp` → `fs.renameSync` 原子替换
- `.tmp` 文件若因上次中断残留，不需要预清理（renameSync 会覆盖）

**A-2. 新建 `src/panoramic/cache/schemas.ts`**

完整定义以下 Zod schema 并导出对应 TypeScript 类型：

- `FileHashRecordSchema` / `FileHashRecord`：单文件哈希记录（`path`、`hash`、`mtime`、`size`）
- `ManifestEntrySchema` / `ManifestEntry`：单 generator 缓存条目，含 `dependencyGraph?: unknown` 预留字段
- `CacheManifestSchema` / `CacheManifest`：顶层 manifest，`version: z.literal('1')`

**A-3. 新建 `src/panoramic/cache/content-hasher.ts`**

实现 `ContentHasher` 接口（spec 第 5.1 节定义），使用 `node:crypto` 的 `crypto.createHash('sha256')`：

`hashFile(filePath: string): Promise<string>` 实现细节：
1. `fs.readFileSync(filePath, 'utf-8')` 读取文件内容
2. 若扩展名为 `.md`，调用内部 `stripFrontmatter(content)` 提取正文
3. 对 `filePath + content`（或正文）计算 SHA256，返回 hex 字符串

`stripFrontmatter(content: string): string` 内部函数（frontmatter 边界规则，来自 clarifications Q5）：
- 第一行不是 `---`：返回原文
- 第一行是 `---`：从第 2 行开始线性扫描，找到仅含 `---` 的行即为闭合标记，返回其后的正文
- 扫描超过第 50 行仍未找到闭合：fallback 返回原文（未闭合 frontmatter 降级策略）

`hashFiles(filePaths: string[]): Promise<string>` 实现细节：
1. 并发 `await Promise.all(filePaths.map(p => hashFile(p)))` 得到各文件 hash 数组
2. 按 `filePaths` 排序后的顺序拼接各 hash，再次 SHA256，返回聚合 hash

`hashContent(content: string): string` 实现细节：
- 直接对 `content` 计算 SHA256，同步返回

**A-4. 新建 `src/panoramic/cache/index.ts`**

统一导出 Phase A-D 所有公开接口，供外部（`batch-project-docs.ts`、CLI）导入。

---

### Phase B: Manifest 管理层

**目标**：实现内存态 manifest 管理，含加载、查询、更新、删除、原子刷盘、统计。

**B-1. 新建 `src/panoramic/cache/manifest-manager.ts`**

实现 `ManifestManager` 接口（spec 第 5.2 节定义）。

内部状态：

```typescript
private manifest: CacheManifest = {
  version: '1',
  updatedAt: 0,
  entries: {},
};
private manifestPath: string = '';
```

`load(manifestPath: string): Promise<void>` 实现：
1. 记录 `this.manifestPath = manifestPath`
2. 若文件不存在，保持默认空 manifest，直接返回
3. 读取文件内容，用 `CacheManifestSchema.safeParse()` 验证
4. 若 `version !== '1'`：`console.warn('[cache] manifest version 不兼容，自动清空缓存')` 并重置为空 manifest
5. 若 parse 失败（JSON 损坏）：`console.warn(...)` 并重置为空 manifest

`get(cacheKey: string): ManifestEntry | undefined`：
- 返回 `this.manifest.entries[cacheKey]`

`set(entry: ManifestEntry): void`：
- `this.manifest.entries[entry.cacheKey] = entry`

`delete(generatorId?: string): void`：
- `generatorId` 为 `undefined`：`this.manifest.entries = {}`
- `generatorId` 有值：遍历 `entries` 删除 `generatorId` 匹配的条目

`flush(manifestPath: string): Promise<void>`：
1. `this.manifest.updatedAt = Date.now()`
2. 调用 `writeAtomicJson(manifestPath, this.manifest)`

`stats(): ManifestStats`：
- 遍历所有 `entries`，累加各 entry 的 `inputFiles[*].size`
- 按 `generatorId` 分组计数
- 返回 `{ entryCount, totalSizeBytes, lastUpdatedAt, byGenerator }`

---

### Phase C: 缓存拦截层

**目标**：实现 cache key 构建、CacheManager 组合逻辑、以及向 `batch-project-docs.ts` 注入缓存拦截。

**C-1. 新建 `src/panoramic/cache/cache-key-builder.ts`**

导出函数 `buildGeneratorCacheKey(generator, context, aggregatedFileHash)`：

```typescript
export async function buildGeneratorCacheKey(
  generator: DocumentGenerator<unknown, unknown>,
  context: ProjectContext,
  hasher: ContentHasher,
): Promise<string>
```

实现细节：
1. 若 `generator` 实现了可选 `getDependencies?(context)` 方法，调用获取文件列表；否则 fallback 扫描 `context.projectRoot` 下所有源文件（`.ts`、`.js`、`.json`、`.md` 等，使用 `fs.readdirSync` 递归，排除 `node_modules`、`.git`、`_meta` 目录）
2. 调用 `hasher.hashFiles(filePaths)` 计算 `aggregatedFileHash`
3. 构建 key 原料字符串：
   ```
   `${generator.id}|${context.projectRoot}|${context.workspaceType}|${context.packageManager}|${context.detectedLanguages.sort().join(',')}|${aggregatedFileHash}`
   ```
4. 返回 `crypto.createHash('sha256').update(keyMaterial).digest('hex')`

**C-2. 新建 `src/panoramic/cache/cache-manager.ts`**

实现 `CacheManager` 接口（spec 第 5.3 节定义），组合 `ContentHasher` 和 `ManifestManager`。

内部状态：

```typescript
private hasher: ContentHasher;
private manifestManager: ManifestManager;
private manifestPath: string = '';
private outputDir: string = '';
```

`initialize(outputDir: string): Promise<void>`：
1. `this.outputDir = outputDir`
2. 构建 `manifestPath = path.join(outputDir, '_meta', '_cache-manifest.json')`
3. 调用 `this.manifestManager.load(manifestPath)`

`check(generator, context): Promise<boolean>` 实现细节：
1. 调用 `buildGeneratorCacheKey(generator, context, this.hasher)` 得到 `cacheKey`
2. 调用 `this.manifestManager.get(cacheKey)` 查询 entry
3. entry 不存在：返回 `false`
4. entry 存在：对每个 `entry.inputFiles` 做 stale 校验（三条任一满足即判定 stale）：
   - 文件不存在（`!fs.existsSync(record.path)`）
   - 文件 mtime < 记录的 mtime（文件被回滚：`fs.statSync(record.path).mtimeMs < record.mtime`）
   - 文件内容 SHA256 与记录不一致
5. 全部文件 stale 校验通过：打印 `[cache-hit] ${generator.id}: ${entry.inputFiles.length} files unchanged, reusing output`，返回 `true`
6. 任一文件 stale：返回 `false`

`record(generator, context, outputFiles): Promise<void>`（仅由成功路径调用）：
1. 调用 `buildGeneratorCacheKey(generator, context, this.hasher)` 得到 `cacheKey`
2. 获取 generator 实际输入文件列表（同 check 内部逻辑，避免重复调用可做私有方法缓存）
3. 为每个输入文件构建 `FileHashRecord`（`path`、`hash`、`mtime`、`size`）
4. 构建并写入 `ManifestEntry` 到 `manifestManager.set(entry)`

`flush(): Promise<void>`：
- 调用 `this.manifestManager.flush(this.manifestPath)`

`clear(generatorId?: string): Promise<void>`：
1. `this.manifestManager.delete(generatorId)`
2. 若清除全部（`generatorId` 为 undefined）：删除 manifest 文件及 `.tmp` 残留（若存在）
3. 若仅清除指定 generator：调用 `flush()` 将删减后的 manifest 写回磁盘

`stats(): ManifestStats`：
- 委托 `this.manifestManager.stats()`

**C-3. 修改 `src/panoramic/interfaces.ts`**

在 `DocumentGenerator<TInput, TOutput>` 接口末尾（`render` 方法之后）追加可选方法声明：

```typescript
/**
 * （可选）声明此 generator 依赖的文件路径列表。
 * 用于 ContentHasher 精确计算聚合 hash，提升缓存精度。
 * 未实现时，CacheManager 退回到扫描 projectRoot 下所有源文件的 fallback 策略。
 *
 * 注意：应包含 generator 在 extract() 中直接读取的所有文件路径，
 * 不仅是源代码文件，还包括依赖的配置文件路径（如 tsconfig.json、package.json 等）。
 */
getDependencies?(context: ProjectContext): string[] | Promise<string[]>;
```

**C-4. 修改 `src/panoramic/batch-project-docs.ts`**

注入缓存拦截，最小化改动原则：仅修改 `generateBatchProjectDocs()` 函数，其余函数（`runProjectGenerator`、`extractWarnings` 等）保持不变。

具体改动：

**1. 在文件顶部 import 区块追加**（紧接现有 import 列表）：

```typescript
import { CacheManager } from './cache/cache-manager.js';
import { ContentHasherImpl } from './cache/content-hasher.js';
import { ManifestManagerImpl } from './cache/manifest-manager.js';
```

**2. 在 `generateBatchProjectDocs()` 函数体内，`bootstrapGenerators()` 调用之后、`for...of` 循环之前**，插入 CacheManager 初始化：

```typescript
// 初始化内容哈希缓存
const cacheManager = new CacheManager(
  new ContentHasherImpl(),
  new ManifestManagerImpl(),
);
await cacheManager.initialize(options.outputDir);
```

**3. 将 `for (const generator of applicableGenerators)` 循环体内的 try/catch 块改写**（原 L88-106）：

改写前（伪代码）：
```typescript
for (const generator of applicableGenerators) {
  try {
    const generatedDoc = await runProjectGenerator(...)
    generatedDocs.push(...)
    structuredOutputs.set(...)
  } catch (error) {
    generatedDocs.push({ ... warnings: ['生成失败'] })
  }
}
```

改写后：
```typescript
for (const generator of applicableGenerators) {
  // [缓存检查] 命中时跳过 extract → generate → render 全链路
  const cacheHit = await cacheManager.check(generator, projectContext);
  if (cacheHit) {
    // 从 manifest 取出已记录的输出文件路径，补充到 generatedDocs
    const entry = cacheManager.getEntry(generator, projectContext); // 内部 get
    generatedDocs.push({
      generatorId: generator.id,
      writtenFiles: entry?.outputFiles ?? [],
      warnings: [],
    });
    continue;
  }

  try {
    const generatedDoc = await runProjectGenerator(
      generator,
      projectContext,
      options.outputDir,
    );
    generatedDocs.push({
      generatorId: generatedDoc.generatorId,
      writtenFiles: generatedDoc.writtenFiles,
      warnings: generatedDoc.warnings,
    });
    structuredOutputs.set(generator.id, generatedDoc.structuredData);
    // [缓存记录] 仅在成功时调用，禁止在 catch 块中调用
    await cacheManager.record(generator, projectContext, generatedDoc.writtenFiles);
  } catch (error) {
    // 失败时保留旧 entry 不变，不调用 record()（来自 clarifications Q1）
    generatedDocs.push({
      generatorId: generator.id,
      writtenFiles: [],
      warnings: [`生成失败: ${String(error)}`],
    });
  }
}

// [缓存刷盘] 所有 generator 执行完毕后原子写入 manifest
await cacheManager.flush();
```

**注意**：`CacheManager` 需额外提供 `getEntry(generator, context)` 内部方法（或让 `check()` 返回 `entry | false`），用于缓存命中后获取 `outputFiles`。具体设计选项：
- 方案一（推荐）：`CacheManager` 内部用私有字段 `lastCheckedEntry` 缓存最近一次 `check()` 命中的 entry，由 `getLastHitEntry()` 方法获取——避免二次 `get()` 开销
- 方案二：修改 `check()` 返回 `ManifestEntry | false` 代替 `boolean`（需调整接口定义）

使用方案二更简洁，可在 `CacheManager.check()` 返回类型改为 `Promise<ManifestEntry | false>`，`batch-project-docs.ts` 注入处相应改为 `if (cacheHit !== false)`。

---

### Phase D: CLI 层

**目标**：注册 `cache` 子命令，实现 `stats` 和 `clear` 子操作。

**D-1. 修改 `src/cli/utils/parse-args.ts`**

**第一处：`CLICommand` 接口追加字段**（在现有 `panoramicOperation` 字段之后）：

```typescript
/** cache 子操作（仅 cache 子命令） */
cacheOperation?: 'stats' | 'clear';
/** --generator 参数（仅 cache clear --generator <id>） */
cacheGeneratorId?: string;
```

**第二处：`subcommand` 联合类型追加 `'cache'`**（`parse-args.ts` L8）：

```typescript
subcommand: 'generate' | 'batch' | 'diff' | 'init' | 'prepare' | 'auth-status' | 'mcp-server' | 'panoramic' | 'cache';
```

**第三处：`parseArgs()` 函数中，在 `panoramic` 分支之后、`init` 分支之前**插入 `cache` 分支：

```typescript
if (sub === 'cache') {
  const op = argv[1];
  if (!op || argv.includes('--help') || argv.includes('-h')) {
    return { ok: true, command: { subcommand: 'cache', deep: false, force: false,
      version: false, help: true, global: false, remove: false, skillTarget: defaultSkillTarget() } };
  }
  if (op !== 'stats' && op !== 'clear') {
    return { ok: false, error: { type: 'invalid_subcommand',
      message: `未知 cache 子操作: ${op}（可选: stats | clear）` } };
  }
  const outputDirIdx = argv.indexOf('--output-dir');
  const outputDir = outputDirIdx !== -1 ? argv[outputDirIdx + 1] : undefined;
  const generatorIdx = argv.indexOf('--generator');
  const cacheGeneratorId = generatorIdx !== -1 ? argv[generatorIdx + 1] : undefined;
  return { ok: true, command: { subcommand: 'cache', cacheOperation: op,
    cacheGeneratorId, outputDir, deep: false, force: false, version: false,
    help: false, global: false, remove: false, skillTarget: defaultSkillTarget() } };
}
```

**第四处：`extractPositionalArgs()` 函数中**，在 `--project-root` 的跳过逻辑旁追加 `--generator`：

```typescript
if (args[i] === '--output-dir' || args[i] === '--target' || args[i] === '--languages' || args[i] === '--project-root' || args[i] === '--generator') {
  i++;
}
```

**第五处：`parseArgs()` 末尾的子命令有效性守卫**（L247），追加 `'cache'` 到不报错的有效子命令列表，或在新增 `cache` 分支后确保 fallthrough 路径正确。

**D-2. 新建 `src/cli/commands/cache.ts`**

参照 `src/cli/commands/panoramic.ts` 结构：

```typescript
// src/cli/commands/cache.ts

import type { CLICommand } from '../utils/parse-args.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { CacheManager } from '../../panoramic/cache/cache-manager.js';
import { ContentHasherImpl } from '../../panoramic/cache/content-hasher.js';
import { ManifestManagerImpl } from '../../panoramic/cache/manifest-manager.js';

const CACHE_HELP = `spectra cache — 内容哈希缓存管理

用法:
  spectra cache stats [--output-dir <dir>]
  spectra cache clear [--generator <id>] [--output-dir <dir>]

子操作:
  stats    显示 manifest 统计信息（条目数、总大小、最近更新时间、各 generator 条目数）
  clear    清除缓存（默认清除全部；--generator <id> 仅清除指定 generator 的条目）

选项:
  --output-dir    指定输出目录（默认为 process.cwd()/specs）
  --generator     仅清除指定 generator 的条目（仅 clear 子操作）`;

export async function runCacheCommand(command: CLICommand): Promise<void> {
  if (command.help || !command.cacheOperation) {
    console.log(CACHE_HELP);
    return;
  }

  const outputDir = command.outputDir ?? path.join(process.cwd(), 'specs');
  const cacheManager = new CacheManager(new ContentHasherImpl(), new ManifestManagerImpl());
  await cacheManager.initialize(outputDir);

  if (command.cacheOperation === 'stats') {
    const s = cacheManager.stats();
    const manifestPath = path.join(outputDir, '_meta', '_cache-manifest.json');
    const lastUpdated = s.lastUpdatedAt
      ? new Date(s.lastUpdatedAt).toISOString()
      : '（无记录）';
    const totalMb = (s.totalSizeBytes / 1024 / 1024).toFixed(1);
    const byGen = Object.entries(s.byGenerator)
      .map(([id, count]) => `${id} (${count})`)
      .join(', ') || '（无）';

    console.log(`Cache manifest: ${manifestPath}`);
    console.log(`Entries:   ${s.entryCount}`);
    console.log(`Total size: ${totalMb} MB`);
    console.log(`Last updated: ${lastUpdated}`);
    console.log(`Generators: ${byGen}`);
    return;
  }

  if (command.cacheOperation === 'clear') {
    await cacheManager.clear(command.cacheGeneratorId);
    if (command.cacheGeneratorId) {
      console.log(`[cache] 已清除 generator "${command.cacheGeneratorId}" 的缓存条目`);
    } else {
      console.log('[cache] 已清除全部缓存');
    }
  }
}
```

**D-3. 修改 `src/cli/index.ts`**

**第一处：import 区块**（紧接 `runPanoramicCommand` import 之后）：

```typescript
import { runCacheCommand } from './commands/cache.js';
```

**第二处：HELP_TEXT 中 `spectra` 用法行**追加：

```
  spectra cache <stats|clear> [--generator <id>] [--output-dir <dir>]
```

**第三处：HELP_TEXT 子命令说明**追加：

```
  cache         管理内容哈希缓存（stats / clear）
```

**第四处：HELP_TEXT 选项说明**追加：

```
  --generator    指定 generator ID（仅 cache clear）
```

**第五处：`switch (command.subcommand)` 末尾**追加：

```typescript
case 'cache':
  await runCacheCommand(command);
  break;
```

---

### Phase E: 集成验证

**目标**：补充单元测试和集成测试，覆盖全部 12 条验收标准。

测试文件结构：

```
src/panoramic/cache/__tests__/
  content-hasher.test.ts    # AC-6、AC-11（frontmatter 边界）
  manifest-manager.test.ts  # AC-3、AC-4、AC-7
  cache-manager.test.ts     # AC-1、AC-2、AC-5、AC-6
src/utils/__tests__/
  atomic-write.test.ts      # AC-3（原子性）
src/cli/__tests__/
  parse-args-cache.test.ts  # AC-8、AC-9、AC-10（CLI 参数解析）
  cache-command.test.ts     # AC-8、AC-9、AC-10（命令逻辑）
```

---

## 3. 文件变更清单

### 新增文件

| 文件路径 | 变更类型 | 内容摘要 |
|---------|---------|---------|
| `src/utils/atomic-write.ts` | 新增 | `writeAtomicJson()` 通用原子写入工具函数 |
| `src/panoramic/cache/schemas.ts` | 新增 | `FileHashRecordSchema`、`ManifestEntrySchema`、`CacheManifestSchema` 及对应类型 |
| `src/panoramic/cache/content-hasher.ts` | 新增 | `ContentHasher` 接口 + `ContentHasherImpl` 实现（含 frontmatter 跳过逻辑） |
| `src/panoramic/cache/manifest-manager.ts` | 新增 | `ManifestManager` 接口 + `ManifestManagerImpl` 实现 |
| `src/panoramic/cache/cache-key-builder.ts` | 新增 | `buildGeneratorCacheKey()` 函数（SHA256 + 文件聚合 hash） |
| `src/panoramic/cache/cache-manager.ts` | 新增 | `CacheManager` 实现（组合 hasher + manifestManager） |
| `src/panoramic/cache/index.ts` | 新增 | 统一导出所有 cache 模块公开接口 |
| `src/cli/commands/cache.ts` | 新增 | `runCacheCommand()` 实现 `stats` 和 `clear` 子操作 |
| `src/panoramic/cache/__tests__/content-hasher.test.ts` | 新增 | ContentHasher 单元测试 |
| `src/panoramic/cache/__tests__/manifest-manager.test.ts` | 新增 | ManifestManager 单元测试（含性能基准） |
| `src/panoramic/cache/__tests__/cache-manager.test.ts` | 新增 | CacheManager 集成测试 |
| `src/utils/__tests__/atomic-write.test.ts` | 新增 | 原子写入单元测试 |
| `src/cli/__tests__/parse-args-cache.test.ts` | 新增 | cache 子命令参数解析测试 |

### 修改文件

| 文件路径 | 变更类型 | 变更摘要 |
|---------|---------|---------|
| `src/panoramic/interfaces.ts` | 修改 | 在 `DocumentGenerator` 接口末尾追加可选 `getDependencies?()` 方法 |
| `src/panoramic/batch-project-docs.ts` | 修改 | `generateBatchProjectDocs()` 内注入 CacheManager 初始化、缓存检查、缓存记录、flush 四处，import 区块追加 3 个 cache 模块 import |
| `src/cli/utils/parse-args.ts` | 修改 | `CLICommand` 接口追加 `cacheOperation`、`cacheGeneratorId`；`subcommand` 联合类型追加 `'cache'`；`parseArgs()` 追加 `cache` 分支；`extractPositionalArgs()` 追加 `--generator` 跳过 |
| `src/cli/index.ts` | 修改 | 追加 `runCacheCommand` import、HELP_TEXT 三处更新、`switch` 追加 `'cache'` case |

---

## 4. 关键实现细节

### 4.1 frontmatter 跳过实现

```typescript
function stripFrontmatter(content: string): string {
  const lines = content.split('\n');
  // 规则 1：首行不是 '---'，视为无 frontmatter，哈希全文
  if (lines[0]?.trim() !== '---') {
    return content;
  }
  // 从第 2 行（index 1）开始扫描，找闭合 '---'
  const MAX_SCAN_LINES = 50;
  for (let i = 1; i < Math.min(lines.length, MAX_SCAN_LINES + 1); i++) {
    if (lines[i]?.trim() === '---') {
      // 闭合找到，返回其后的正文（index i+1 起）
      return lines.slice(i + 1).join('\n');
    }
  }
  // 规则 2：超过 50 行仍未找到闭合，降级哈希全文
  return content;
}
```

**边界验证**：
- 无 frontmatter：首行非 `---` → 直接哈希全文 ✓
- 未闭合：扫描 50 行无闭合 → 哈希全文 ✓
- 正文含 `---` 水平线：`i` 在找到第一个闭合后停止，不继续扫描 ✓

### 4.2 cache key 构建

cache key 构建分两步：

**步骤 1：获取输入文件列表**

```typescript
async function resolveInputFiles(
  generator: DocumentGenerator<unknown, unknown>,
  context: ProjectContext,
): Promise<string[]> {
  if (typeof generator.getDependencies === 'function') {
    return await Promise.resolve(generator.getDependencies(context));
  }
  // fallback：扫描 projectRoot 下所有源文件（排除噪声目录）
  return scanSourceFiles(context.projectRoot);
}

function scanSourceFiles(root: string): string[] {
  // 递归 fs.readdirSync，排除 node_modules、.git、_meta、dist、.cache
  // 仅收集 .ts、.tsx、.js、.jsx、.json、.md、.yaml、.yml 扩展名
  // 结果排序后返回
}
```

**步骤 2：构建 SHA256 key**

```typescript
const stableContextParts = [
  generator.id,
  context.projectRoot,
  context.workspaceType,
  context.packageManager,
  context.detectedLanguages.slice().sort().join(','),
].join('|');

const aggregatedFileHash = await hasher.hashFiles(inputFiles);
const keyMaterial = `${stableContextParts}|${aggregatedFileHash}`;
return crypto.createHash('sha256').update(keyMaterial).digest('hex');
```

**排除字段说明**（来自 clarifications Q2）：
- `existingSpecs`：每次运行都会变化，排除
- `configFiles`：`Map<string, string>` 序列化顺序不稳定，排除；但需在 `getDependencies()` JSDoc 中要求实现者将配置文件路径纳入返回集合

### 4.3 stale 检测算法

对 manifest entry 的每个 `FileHashRecord` 执行以下三路检查，任一命中即判定 stale：

```typescript
async function isEntryStale(entry: ManifestEntry, hasher: ContentHasher): Promise<boolean> {
  for (const record of entry.inputFiles) {
    // 检查 1：文件已删除
    if (!fs.existsSync(record.path)) {
      return true;
    }
    const stat = fs.statSync(record.path);
    // 检查 2：文件被回滚（当前 mtime 早于记录的 mtime）
    if (stat.mtimeMs < record.mtime) {
      return true;
    }
    // 检查 3：内容哈希不一致（mtime 不变但内容变化的场景，来自 AC-6）
    const currentHash = await hasher.hashFile(record.path);
    if (currentHash !== record.hash) {
      return true;
    }
  }
  return false;
}
```

**性能考量**：mtime 检查先于内容 hash 检查（mtime 相同时才计算 hash），可在大多数未变化文件上避免磁盘 I/O。

### 4.4 batch-project-docs.ts 注入方式

注入遵循最小化修改原则：

**改动范围仅限 `generateBatchProjectDocs()` 函数**：
- `runProjectGenerator()` 函数保持完全不变
- `extractWarnings()`、`extractMermaidSource()` 等辅助函数保持完全不变
- 文件顶部新增 3 个 import，其余 import 保持不变

**注入点精确位置**：
1. `bootstrapGenerators()` 调用之后（L78）→ 插入 CacheManager 初始化
2. `for (const generator of applicableGenerators)` 循环体开头（L87-88 之间）→ 插入缓存检查 + `continue`
3. `structuredOutputs.set(generator.id, generatedDoc.structuredData)` 之后（L99 之后）→ 插入 `cacheManager.record()`
4. `for` 循环结束后（L107 之后）→ 插入 `await cacheManager.flush()`

**`CacheManager.check()` 返回值设计**（采用方案二）：

将接口的 `check()` 返回 `Promise<ManifestEntry | false>`，在 `batch-project-docs.ts` 中：

```typescript
const cacheHit = await cacheManager.check(generator, projectContext);
if (cacheHit !== false) {
  // 利用 cacheHit（即 ManifestEntry）获取 outputFiles
  generatedDocs.push({
    generatorId: generator.id,
    writtenFiles: cacheHit.outputFiles,
    warnings: [],
  });
  structuredOutputs.set(generator.id, undefined); // 结构化数据不可复用，置 undefined
  continue;
}
```

**注意**：`structuredOutputs` 中缓存命中的 generator 对应值为 `undefined`，这对下游逻辑（`architectureOverview`、`patternHints` 等读取 `structuredOutputs.get('xxx')`）是安全的——它们本来就会在 `structuredOutputs` 中不存在对应条目时 fallback 处理。

---

## 5. 测试策略

### 5.1 单元测试

**`src/utils/__tests__/atomic-write.test.ts`**

| 测试用例 | 对应验收标准 |
|---------|------------|
| 正常写入后文件内容正确 | AC-3 |
| 目标目录不存在时自动创建 | - |
| 写入 JSON 格式正确（2 空格缩进） | - |
| 模拟 `.tmp` 文件残留场景（重命名覆盖） | AC-3 |

**`src/panoramic/cache/__tests__/content-hasher.test.ts`**

| 测试用例 | 对应验收标准 |
|---------|------------|
| 对普通文本文件计算 SHA256（内容相同 hash 相同） | AC-6 |
| 对 `.md` 文件跳过 frontmatter，正文相同 hash 相同 | AC-11 |
| 修改 `.md` frontmatter 不影响 hash（frontmatter 不同，正文相同） | AC-11 |
| 修改 `.md` 正文后 hash 变化 | AC-11（反向） |
| 无 frontmatter 的 `.md` 文件哈希全文 | AC-11（边界） |
| 未闭合 frontmatter 的 `.md` 文件降级哈希全文 | clarifications Q5 |
| 正文含 `---` 水平线时不误判 frontmatter 未闭合 | clarifications Q5 |
| `hashFiles()` 对文件列表顺序不敏感（相同集合不同顺序返回相同 hash） | - |

**`src/panoramic/cache/__tests__/manifest-manager.test.ts`**

| 测试用例 | 对应验收标准 |
|---------|------------|
| `load()` 加载有效 manifest 后 `get()` 返回正确 entry | - |
| `load()` 文件不存在时返回空 manifest | - |
| `load()` version 不匹配时打印警告并清空（不抛错） | AC-7 |
| `load()` JSON 损坏时打印警告并清空（不抛错） | AC-3（损坏场景） |
| `set()` + `flush()` 后文件内容正确 | - |
| `delete(generatorId)` 只删除指定条目 | AC-10 |
| `delete()` 无参数时清空全部 | AC-9 |
| `stats()` `totalSizeBytes` 为 inputFiles size 累加值（来自 clarifications Q3） | AC-8 |
| `stats()` `byGenerator` 分组正确 | AC-8 |
| 性能基准：1000 条 entry 的 `load()` + `flush()` 组合 < 100ms | AC-4 |

**`src/panoramic/cache/__tests__/cache-manager.test.ts`**

| 测试用例 | 对应验收标准 |
|---------|------------|
| `check()` manifest 无 entry 时返回 `false` | AC-1 |
| `check()` entry 存在且未 stale 时返回 `ManifestEntry`，打印 `[cache-hit]` 日志 | AC-1、AC-2 |
| `check()` 源文件已删除时判定 stale，返回 `false` | AC-5 |
| `check()` 源文件 mtime 回滚时判定 stale | AC-6（mtime 路径） |
| `check()` mtime 不变但内容变化时通过 hash 判定 stale | AC-6（hash 路径） |
| `record()` 成功记录后再次 `check()` 命中 | AC-1 |
| `flush()` 后 manifest 文件原子写入 | AC-3 |
| `clear()` 无参数后 manifest 文件删除 | AC-9 |
| `clear(generatorId)` 后指定 generator 条目不存在，其余保留 | AC-10 |

**`src/cli/__tests__/parse-args-cache.test.ts`**

| 测试用例 | 对应验收标准 |
|---------|------------|
| `['cache', 'stats']` 解析 `cacheOperation: 'stats'` | AC-8 |
| `['cache', 'stats', '--output-dir', '/tmp/out']` 解析 `outputDir` | AC-8 |
| `['cache', 'clear']` 解析 `cacheOperation: 'clear'` | AC-9 |
| `['cache', 'clear', '--generator', 'workspace-index']` 解析 `cacheGeneratorId` | AC-10 |
| `['cache']`（无子操作）解析 `help: true` | - |
| `['cache', 'unknown-op']` 返回 `ok: false` 错误 | - |

### 5.2 集成测试

**`src/panoramic/cache/__tests__/integration.test.ts`**（端到端场景）

| 测试场景 | 对应验收标准 |
|---------|------------|
| **全量命中场景**：首次执行记录 manifest，二次执行全部命中 `[cache-hit]` | AC-1 |
| **部分变更场景**：修改部分文件后，只有涉及文件的 generator miss，其余命中 | AC-2 |
| **manifest 原子性**：`flush()` 中模拟进程中断（`writeAtomicJson` 在 rename 前 throw），验证主文件不损坏或 `.tmp` 残留不影响下次加载 | AC-3 |
| **版本不兼容**：手写 `version: "0"` 的 manifest 文件，`initialize()` 后 manifest 被清空 | AC-7 |
| **frontmatter-only 变更**：修改 `.md` frontmatter 但正文不变，generator 仍命中缓存 | AC-11 |

---

## 6. 风险缓解执行计划

### 风险 1：哈希粒度不一致（DeltaRegenerator AST hash vs ContentHashCache 内容 hash）

**缓解动作**：
- 在 `src/panoramic/cache/cache-manager.ts` 文件头注释中明确声明两层的职责边界和差异
- 在 `src/panoramic/batch-project-docs.ts` 注入点注释中说明两层的执行顺序和独立性
- 不引入跨层耦合

### 风险 2：generator 读取未声明依赖

**缓解动作（短期）**：
- Phase A 实现 fallback 策略（扫描 `projectRoot` 全部源文件），确保安全底网在 Phase C 上线前即可用
- `getDependencies()` 可选接口在 Phase C-3 中加入 `interfaces.ts`，附带详细 JSDoc（包含"应纳入配置文件路径"的约束，来自 clarifications Q2）
- 在 `cache-key-builder.ts` 的 fallback 路径注释中标注性能影响：`// 未实现 getDependencies()，降级扫描全量源文件（安全但性能稍差）`

### 风险 3：ProjectContext 易变字段误判失效

**缓解动作**：
- `buildGeneratorCacheKey()` 中的 key 构建逻辑明确注释排除的字段：`existingSpecs`（每次运行变化）、`configFiles`（Map 序列化不稳定）
- 排除字段清单写入 `cache-key-builder.ts` 的文件头注释
- 单元测试验证：相同稳定字段 + 不同 `existingSpecs` 产生相同 cache key

### 风险 4：并发写入 manifest（当前低风险）

**缓解动作**：
- 在 `cache-manager.ts` 和 `cache.ts`（CLI 命令）文件头注释中明确约束："cache 操作不应与 batch 并发执行，当前串行架构下无此问题，并发化时需引入写锁"
- `writeAtomicJson()` 的 `rename` 保证最终一致性，即使未来并发也有安全底网

### 风险 5：旧版 manifest 兼容性

**缓解动作**：
- `ManifestManager.load()` 中版本校验逻辑（不兼容时 `console.warn` + 清空 + 不抛错）在 Phase B 实现
- `CacheManifestSchema` 的 `version: z.literal('1')` 确保类型安全
- 针对 AC-7 的测试用例验证：写入 `version: "0"` 后 batch 正常执行不报错

### 风险 6：cache CLI 与 batch 并发

**缓解动作**：
- `CACHE_HELP` 文本和 `cache.ts` 文件头注释中明确说明不应与 batch 并发执行的约束
- 不实现文件锁（当前单进程 CLI 无实际并发场景）

---

## 7. 验收检查点

### Phase A 完成标准

- [ ] `src/utils/atomic-write.ts` 新增，`writeAtomicJson()` 通过 unit test
- [ ] `src/panoramic/cache/schemas.ts` 新增，Zod schema 全部可 parse
- [ ] `src/panoramic/cache/content-hasher.ts` 新增，frontmatter 三种边界情况全部通过测试
- [ ] `npm run build` 无类型错误

### Phase B 完成标准

- [ ] `src/panoramic/cache/manifest-manager.ts` 新增
- [ ] `load()` 版本校验测试通过（对应 AC-7）
- [ ] 1000 条 entry 的 load + flush < 100ms（对应 AC-4）
- [ ] `npm run build` 无类型错误

### Phase C 完成标准

- [ ] `src/panoramic/cache/cache-key-builder.ts` 和 `cache-manager.ts` 新增
- [ ] `src/panoramic/interfaces.ts` 追加 `getDependencies?()` 声明
- [ ] `batch-project-docs.ts` 注入完成，smoke test（实际项目目录）缓存命中日志正常输出
- [ ] 缓存失效三路（文件删除/mtime 回滚/内容变化）测试通过（对应 AC-5、AC-6）
- [ ] `npm run lint && npm run build` 无错误

### Phase D 完成标准

- [ ] `src/cli/commands/cache.ts` 新增
- [ ] `parse-args.ts` 和 `index.ts` 修改完成
- [ ] `spectra cache stats` 和 `spectra cache clear [--generator <id>]` 参数解析测试通过
- [ ] CLI smoke test（手动）输出格式正确
- [ ] `npm run build` 无类型错误

### Phase E 完成标准（所有 12 条 AC 覆盖）

| AC | 测试覆盖位置 | 验证方式 |
|----|-----------|---------|
| AC-1 | `cache-manager.test.ts` integration | 自动化 |
| AC-2 | `cache-manager.test.ts` integration（部分变更场景） | 自动化 |
| AC-3 | `atomic-write.test.ts` + `manifest-manager.test.ts`（JSON 损坏） | 自动化 |
| AC-4 | `manifest-manager.test.ts`（性能基准，vitest bench） | 自动化 |
| AC-5 | `cache-manager.test.ts`（文件删除） | 自动化 |
| AC-6 | `cache-manager.test.ts`（mtime 不变但 hash 变化） | 自动化 |
| AC-7 | `manifest-manager.test.ts`（version `"0"` → 清空不抛错） | 自动化 |
| AC-8 | `parse-args-cache.test.ts` + `cache-command.test.ts`（stats 输出格式） | 自动化 |
| AC-9 | `cache-manager.test.ts` + `cache-command.test.ts`（clear 全量） | 自动化 |
| AC-10 | `cache-manager.test.ts` + `cache-command.test.ts`（clear --generator） | 自动化 |
| AC-11 | `content-hasher.test.ts`（frontmatter 修改不影响 hash） | 自动化 |
| AC-12 | `npm run build`（tsc --strict 编译无错误） | CI 构建 |

- [ ] 全部测试 `npm test` 通过
- [ ] `npm run lint && npm run build` 无错误
