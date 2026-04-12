---
type: tech-research
feature: 100-content-hash-cache
mode: codebase-scan
created: 2026-04-12
---

# 技术调研：content-hash-cache

## 1. batch-orchestrator generator 执行流程

### 整体执行链路

`runBatch()` 是唯一入口（`src/batch/batch-orchestrator.ts` L200），按以下顺序执行：

**阶段一：增量决策（L286-318）**

```
incremental=true && !force
  → new DeltaRegenerator().plan(...)
  → deltaReport.mode = 'incremental' | 'full'
  → regenerateTargets = Set<string>（sourceTarget 集合）
```

关键变量（L316-318）：
- `regenerateTargets: Set<string>` — 需要重生成的 sourceTarget 集合
- `forceFullRegeneration: boolean` — `force || (incremental && mode === 'full')`
- `shouldUseIncrementalPlan: boolean` — `incremental && !force && mode === 'incremental'`

**阶段二：跳过决策（L401-416）**

非 root 模块跳过判断（L408-416）：
```typescript
const shouldGenerate = forceFullRegeneration
  || (shouldUseIncrementalPlan
    ? regenerateTargets.has(moduleSourceTarget)
    : !fs.existsSync(specPath));       // 默认：检查文件是否存在
if (!shouldGenerate) {
  skipped.push(moduleName);
  reporter.complete(moduleName, 'skipped');
  continue;
}
```

root 模块跳过判断（L388-399）：基于 `storedSpecByTarget` + `regenerateTargets` 过滤出 `rootTargetsToGenerate`，为空则跳过（L402-406）。

**阶段三：generator 实际调用（L424-515）**

核心调用发生在 `generateSpec(fullDirPath, genOptions)` / `generateSpec(fullPath, genOptions)`，来自 `single-spec-orchestrator.ts`。这是 Spec 级 LLM 调用的入口，与 panoramic 的 `DocumentGenerator` 接口无关。

**阶段四：panoramic generators 执行（L589-625）**

通过 `generateBatchProjectDocs()` 执行（`src/panoramic/batch-project-docs.ts` L74），内部对每个 generator 调用 `runProjectGenerator()` 链路：
```
generator.extract(context) → generator.generate(input, options) → generator.render(output)
```

### 缓存拦截的最佳注入点

**模块级缓存（Spec 生成）**：在 `shouldGenerate` 布尔判断之前（L408）注入，增加第三条判断分支：
```typescript
const cacheHit = contentHashCache.check(moduleSourceTarget, currentContentHash);
const shouldGenerate = forceFullRegeneration
  || (!cacheHit && shouldUseIncrementalPlan ? ...)
  || (!cacheHit && !fs.existsSync(specPath));
```

**panoramic generator 级缓存**：在 `batch-project-docs.ts` L87-107 的 `for (const generator of applicableGenerators)` 循环内，`runProjectGenerator()` 调用前注入缓存检查。

---

## 2. checkpoint.ts 原子写入模式

文件：`src/batch/checkpoint.ts`

`saveCheckpoint()` 实现了标准的 **write-tmp-then-rename** 原子写入模式（L45-60）：

```typescript
const tmpPath = `${resolvedPath}.tmp`;
const content = JSON.stringify(state, null, 2);
fs.writeFileSync(tmpPath, content, 'utf-8');
fs.renameSync(tmpPath, resolvedPath);   // 原子替换
```

**可复用的通用 writeAtomic 工具**：

可从此模式提取为独立函数，新建 `src/batch/atomic-writer.ts`（或 `src/utils/atomic-write.ts`）：

```typescript
export function writeAtomicJson(filePath: string, data: unknown): void {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const tmpPath = `${resolvedPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, resolvedPath);
}
```

`clearCheckpoint()` 展示了 .tmp 文件的清理模式（L68-80）：同时清理主文件和 `.tmp` 残留文件。

**cache manifest 写入应完整复用此模式**：避免部分写入导致 manifest 损坏。

---

## 3. generator-registry 接口分析

### DocumentGenerator 接口（`src/panoramic/interfaces.ts` L179-225）

四段生命周期方法：
```typescript
interface DocumentGenerator<TInput, TOutput> {
  id: string;        // kebab-case，如 'workspace-index'
  name: string;
  description: string;

  isApplicable(context: ProjectContext): boolean | Promise<boolean>;
  extract(context: ProjectContext): Promise<TInput>;        // 从项目提取原始数据
  generate(input: TInput, options?: GenerateOptions): Promise<TOutput>;  // 转换为结构化输出
  render(output: TOutput): string | Promise<string>;        // 渲染为 Markdown
}
```

### ProjectContext 结构（`src/panoramic/interfaces.ts` L90-117）

```typescript
interface ProjectContext {
  projectRoot: string;            // 项目根目录绝对路径
  configFiles: Map<string, string>; // 配置文件名 -> 绝对路径
  packageManager: PackageManager; // 'npm' | 'yarn' | 'pnpm' | ...
  workspaceType: WorkspaceType;   // 'single' | 'monorepo'
  detectedLanguages: string[];    // 语言适配器 ID 列表
  existingSpecs: string[];        // 已有 spec 文件绝对路径列表
}
```

### generator 的 extract 输入构成

`extract(context)` 以 `ProjectContext` 为唯一入参，内部自行读取文件系统（`projectRoot` 下的配置文件、源码文件等）。因此 **generator 的缓存 key 应基于**：
- `generator.id`（generator 标识）
- `projectRoot`（项目根路径）
- `ProjectContext` 中影响此 generator 输出的关键字段（如 `workspaceType`、`packageManager`）
- generator 实际读取的源文件内容哈希

### GeneratorRegistry 核心方法

- `filterByContext(context)` — 并发执行所有 `isApplicable()` 检查，返回适用 generator 列表（`src/panoramic/generator-registry.ts` L146-190）
- `register(item)` — 两阶段验证（格式 + 冲突），注册到 `items`、`enabledState`、`itemOrder` 三个数据结构
- `setEnabled(id, enabled)` — 切换启用/禁用状态，独立于 generator 实例

**注意**：Registry 没有名为 `execute()` 的方法；实际 generator 执行在 `batch-project-docs.ts` 的 `runProjectGenerator()` 中完成。

---

## 4. CLI 子命令注册模式

### 注册模式分析（`src/cli/index.ts`）

注册一个新子命令需要三步：

**Step 1**：在 `src/cli/utils/parse-args.ts` 的 `CLICommand.subcommand` 联合类型中追加新值（L8）：
```typescript
subcommand: 'generate' | 'batch' | 'diff' | 'init' | 'prepare' | 'auth-status' | 'mcp-server' | 'panoramic' | 'cache';
```

**Step 2**：在 `parseArgs()` 中添加 switch 分支解析逻辑（仿照 `panoramic`，L93-128）。

**Step 3**：在 `src/cli/index.ts` 中：
- `import { runCacheCommand } from './commands/cache.js';`（L18-21 区域）
- 在 HELP_TEXT 添加子命令说明（L31-73 区域）
- 在 `switch (command.subcommand)` 中添加 `case 'cache':` 分支（L112-137）

### 新建命令文件模式

参考 `src/cli/commands/panoramic.ts`（最简洁的示例）：

```typescript
// src/cli/commands/cache.ts
export async function runCacheCommand(command: CLICommand): Promise<void> {
  // 解析 command.cacheOperation（如 'status' | 'clear' | 'manifest'）
  // 调用 cache 相关核心逻辑
}
```

### cache 子命令规划操作

建议支持三个子操作（参照 panoramic 的 `panoramicOperation` 字段模式）：
- `status` — 显示 manifest 统计（条目数、总 size、最新更新时间）
- `clear` — 清除缓存（支持 `--generator <id>` 过滤）
- `manifest` — 输出 manifest JSON 内容（配合 `--json` 选项）

---

## 5. delta-regenerator 交互界面

### DeltaRegenerator 当前能力

文件：`src/batch/delta-regenerator.ts`

`DeltaRegenerator.plan()` 产出 `DeltaReport`（L34-45）：
```typescript
interface DeltaReport {
  mode: 'incremental' | 'full';
  regenerateTargets: string[];   // sourceTarget 列表
  directChanges: DeltaTargetState[];     // skeleton hash 变化的模块
  propagatedChanges: DeltaTargetState[]; // 依赖传播影响的模块
  unchangedTargets: string[];
}
```

**当前哈希机制**：`computeSkeletonHash()` 使用 **AST skeleton hash**（通过 `analyzeFiles()` 提取 CodeSkeleton，然后对 `.hash` 字段做 SHA256 组合），而非原始文件内容哈希（L235-262）。

### 与新 content-hash-cache 的先后关系

在 batch pipeline 的执行顺序中：

```
[1] DeltaRegenerator.plan()       →  产出 DeltaReport（模块级增量计划）
[2] ContentHashCache.check()       →  generator 级缓存命中检查（新增）
[3] runProjectGenerator()          →  实际调用 generator（缓存未命中时执行）
[4] ContentHashCache.save()        →  更新 manifest（成功生成后）
```

**DeltaRegenerator 负责 Spec 生成的增量决策（模块/文件维度）**；新缓存层负责 panoramic generator 执行结果的增量决策（generator 维度）。两者平行而非替代关系。

**关键区别**：
- `DeltaRegenerator` 使用 AST skeleton hash，粒度为"模块是否需要重生成 spec"
- 新缓存层使用 SHA256 内容哈希，粒度为"generator 是否需要重新执行"
- `DeltaRegenerator` 已有 manifest（以 `skeletonHash` 字段存储在 spec frontmatter 中）；新缓存层需要独立的 `cache-manifest.json`

### storedSpecs 中已有的哈希存储

`StoredModuleSpecSummary.skeletonHash` 是现有的哈希存储字段（`src/panoramic/builders/doc-graph-builder.ts`），但这是 AST 层面的 skeleton hash，不是源文件内容哈希。新的 content-hash-cache 应维护独立 manifest，不复用 `skeletonHash` 字段。

---

## 6. 缓存注入点建议

### 注入点 A：panoramic generator 执行前（推荐，影响最大）

**位置**：`src/panoramic/batch-project-docs.ts` L87，`runProjectGenerator()` 调用前

```typescript
for (const generator of applicableGenerators) {
  // [新增] 缓存命中检查
  const cacheKey = buildGeneratorCacheKey(generator.id, projectContext);
  const cached = await contentHashCache.tryLoad(cacheKey, options.outputDir);
  if (cached) {
    generatedDocs.push(cached.summary);
    structuredOutputs.set(generator.id, cached.structuredData);
    continue;  // 跳过实际执行
  }
  // 原有逻辑
  const generatedDoc = await runProjectGenerator(generator, projectContext, options.outputDir);
  // [新增] 写入缓存
  await contentHashCache.save(cacheKey, generatedDoc, options.outputDir);
  ...
}
```

**缓存 key 构成建议**：
```
SHA256(generatorId + projectRoot + contentHash(generator 读取的源文件集合))
```

### 注入点 B：batch-orchestrator 的模块级跳过（已有机制，优化空间有限）

**位置**：`src/batch/batch-orchestrator.ts` L408，`shouldGenerate` 判断处

当前默认模式（非 incremental、非 force）已有基于文件存在性的跳过，对应的优化是用内容哈希替换"文件存在则跳过"的逻辑，实现更精准的跳过决策。

### 注入点优先级建议

| 优先级 | 注入点 | 目标耗时占比 | 实现复杂度 |
|-------|-------|------------|---------|
| P0 | panoramic generator 执行（注入点 A） | ~60-70% | 中 |
| P1 | Spec 生成模块内容哈希替换文件存在检查（注入点 B 优化版） | ~20-30% | 中 |
| P2 | DeltaRegenerator AST hash 缓存持久化 | ~5-10% | 低 |

### cache manifest 文件位置建议

```
<outputDir>/_meta/_cache-manifest.json
```

与现有 `_delta-report.md`、`batch-summary-*.md` 同路径（`BATCH_OUTPUT_SUBDIRS.META`），保持输出结构一致。

---

## 7. 风险和注意事项

### 7.1 哈希粒度不匹配风险

`DeltaRegenerator` 使用 AST skeleton hash（不含注释、空格），新缓存若使用原始文件内容哈希（含注释），则可能出现 delta 认为"未变化"但缓存认为"已变化"的不一致情况。

**建议**：新缓存与 delta 使用相同的 skeleton hash 机制（复用 `computeSkeletonHash()`），或明确文档化两者的差异。

### 7.2 ProjectContext 变化检测

`extract(context)` 接收 `ProjectContext`，但 `ProjectContext` 中某些字段（如 `existingSpecs`）会随每次运行变化。缓存 key 若包含整个 `ProjectContext`，可能导致误判缓存失效。

**建议**：缓存 key 只包含影响 generator 输出的稳定字段（`projectRoot`、`workspaceType`、`packageManager`、`detectedLanguages`），而非序列化整个 context。

### 7.3 generator 读取外部文件但未声明依赖

各 generator 在 `extract()` 中自行读取文件系统，但没有声明"读了哪些文件"的接口。缓存 key 中的内容哈希只能覆盖已知文件，无法感知 generator 内部读取的其他文件变化。

**建议**：短期内在 `DocumentGenerator` 接口中增加可选的 `getDependencies(context): string[]` 方法，用于声明 generator 依赖的文件列表；或使用 projectRoot 下所有源文件的聚合哈希作为 fallback（性能稍差但安全）。

### 7.4 并发写入 manifest 风险

`generateBatchProjectDocs()` 中 generator 串行执行（for...of），但 `runBatch()` 可能在未来被并发化。manifest 写入必须使用原子写入（参照 checkpoint.ts 的 tmp+rename 模式）。

### 7.5 旧版 manifest 兼容性

cache manifest 的 schema 变化时，旧 manifest 可能无法解析。需要在 manifest 中包含 `version` 字段，加载时做版本校验，不兼容时自动清空缓存（而非抛错中断）。

### 7.6 cache CLI 与 batch 的状态一致性

`spectra cache clear` 执行后，若 batch 正在运行（虽然目前无并发场景），可能导致 manifest 状态不一致。需要在文档中明确"cache 操作不应与 batch 并发执行"的约束。

### 7.7 panoramic 管道与 batch Spec 管道的缓存独立性

当前 `runBatch()` 中 panoramic 阶段（步骤 5）与 Spec 生成阶段（步骤 4）串行，但两者的缓存粒度和 key 不同，应维护两套独立 manifest，避免相互污染。
