---
type: tech-research
feature: 101-graph-persistence
mode: codebase-scan
date: 2026-04-12
---

# 技术调研报告：graph-persistence

## 1. Architecture IR 模型分析

文件：`src/panoramic/models/architecture-ir-model.ts`

### ArchitectureIRRelationship 当前字段

```typescript
export interface ArchitectureIRRelationship {
  id: string;
  sourceId: string;
  destinationId: string;
  kind: ArchitectureIRRelationshipKind;   // 'contains' | 'depends-on' | 'deploys' | 'uses-image' | 'groups'
  description: string;
  technology?: string;
  tags: string[];
  sourceTags: ArchitectureIRSourceTag[];  // 'architecture-overview' | 'runtime-topology' | 'workspace-index' | 'cross-package-deps'
  evidence: ArchitectureIREvidence[];
  metadata: Record<string, unknown>;      // 扩展字段：graph-persistence 可注入序列化数据
}
```

### ArchitectureIRElement 当前字段

```typescript
export interface ArchitectureIRElement {
  id: string;
  name: string;
  kind: ArchitectureIRElementKind;  // 'software-system' | 'container' | 'component' | 'deployment-node' | 'infrastructure-node' | 'external-system' | 'image'
  description?: string;
  technology?: string;
  tags: string[];
  sourceTags: ArchitectureIRSourceTag[];
  evidence: ArchitectureIREvidence[];
  metadata: Record<string, unknown>;  // 扩展字段，可持久化 graph-specific 数据
}
```

### Zod Schema 情况

当前 `architecture-ir-model.ts` 中**没有** Zod Schema，全部为 TypeScript interface 定义。`metadata: Record<string, unknown>` 字段是扩展的天然入口，graph-persistence 若需向 IR 注入数据，可通过 `metadata` 键而无需修改核心接口。

### 关键函数

- `summarizeArchitectureIR(ir: Pick<ArchitectureIR, ...>): ArchitectureIRStats` — 只做统计，无副作用
- `getArchitectureIRView(ir: ArchitectureIR, kind: ArchitectureIRViewKind): ArchitectureIRView | undefined`

---

## 2. Doc Graph Builder 分析

文件：`src/panoramic/builders/doc-graph-builder.ts`

### 核心类型定义

```typescript
export interface DocGraph {
  projectRoot: string;
  generatedAt: string;          // ISO 日期字符串
  specs: DocGraphSpecNode[];
  sourceToSpec: DocGraphSourceToSpec[];
  references: DocGraphReference[];
  missingSpecs: DocGraphMissingSpec[];
  unlinkedSpecs: DocGraphUnlinkedSpec[];
}

export interface DocGraphSpecNode {
  specPath: string;
  sourceTarget: string;
  relatedFiles: string[];
  linked: boolean;
  confidence?: 'high' | 'medium' | 'low';  // 存在，但 DocGraph 层未做额外传播
  currentRun: boolean;
}

export interface DocGraphReference {
  kind: 'same-module' | 'cross-module';
  fromSpecPath: string;
  toSpecPath: string;
  fromSourceTarget: string;
  toSourceTarget: string;
  evidenceCount: number;
  evidenceSamples: DocGraphReferenceSample[];  // 最多 5 条
}
```

### confidence 字段现状

`DocGraphSpecNode.confidence` 为可选字段，来自 `ExistingSpecDocument` / 当前批次 `ModuleSpec.frontmatter.confidence`，但 **DocGraph 持久化时**（Feature 098 已删除 `_doc-graph.json` 输出）confidence 未做持久化。graph-persistence 若要复用 confidence，需在序列化时显式包含。

### 关键函数签名

```typescript
export function buildDocGraph(options: BuildDocGraphOptions): DocGraph
// options: { projectRoot, dependencyGraph: DependencyGraph, moduleSpecs: ModuleSpec[], existingSpecs?: ExistingSpecDocument[] }

export function scanStoredModuleSpecs(specsDir: string, projectRoot: string): StoredModuleSpecSummary[]

export function resolveSpecForSource(sourcePath: string, specs: DocGraphSpecNode[]): DocGraphSpecNode | undefined
```

### 重要背景（Feature 098）

注释 L574 明确：`// 注意：不再生成 _doc-graph.json（Feature 098 — 结构化数据通过内存传递，减少输出冗余）`

这意味着 `DocGraph` 目前**仅在内存中流转**，graph-persistence 的核心任务就是将其写回磁盘。

---

## 3. Cross Reference Index 分析

文件：`src/panoramic/cross-reference-index.ts`

### buildCrossReferenceIndex 签名

```typescript
export function buildCrossReferenceIndex(
  moduleSpec: ModuleSpec,
  docGraph: DocGraph,
): ModuleCrossReferenceIndex
```

### 返回值结构

```typescript
// ModuleCrossReferenceIndex（来自 src/models/module-spec.ts）
{
  generatedAt: string;    // 继承自 docGraph.generatedAt
  sameModule: CrossReferenceLink[];
  crossModule: CrossReferenceLink[];
}

// CrossReferenceLink
{
  label: string;
  href: string;             // 相对路径 + #module-spec 锚点
  targetSpecPath: string;
  targetSourceTarget: string;
  kind: 'same-module' | 'cross-module';
  direction: 'internal' | 'outbound' | 'inbound' | 'bidirectional';
  evidenceCount: number;
  summary: string;          // 中文描述：出站N，入站M；示例：...
}
```

### 依赖关系

`buildCrossReferenceIndex` 对 `DocGraph` 为只读消费，结果写入 `moduleSpec.crossReferenceIndex`。graph-persistence 如果持久化 DocGraph，此函数无需修改。

---

## 4. Batch Orchestrator Post-processing

文件：`src/batch/batch-orchestrator.ts`

### 步骤 5：DocGraph 生成与 post-processing 钩子链（L546–L696）

整体结构（顺序执行，每步独立 try/catch）：

```
步骤 5（大 try 块 L557–L625）:
  ├── buildDocGraph(...)                     ← DocGraph 内存构建
  ├── buildCrossReferenceIndex(spec, docGraph)  ← 为每个 spec 注入 crossReferenceIndex
  ├── fs.writeFileSync(spec 渲染输出)         ← spec .md 文件写盘
  ├── [注释] 不再生成 _doc-graph.json        ← Feature 098 已删除
  ├── DeltaRegenerator → _delta-report.md   ← try/catch 独立
  ├── generateBatchProjectDocs(...)          ← projectDocs 生成
  └── CoverageAuditor → _coverage-report.md ← try/catch 独立

步骤 6（L627–L644）:
  └── generateIndex → _index.spec.md        ← try/catch 独立

步骤 6b（L646–L656）:
  └── orchestrateDocsBundle → docs-bundle.yaml  ← try/catch 独立

步骤 6c（L658–L672）:
  └── generateDocsQualityReport              ← try/catch 独立

步骤 7（L674–L679）:
  └── writeSummaryLog → batch-summary-{ts}.md

步骤 8（L681–L696）:
  └── generateBatchReadme → README.md       ← async import，try/catch 独立

步骤 8b（L698–L700）:
  └── clearCheckpoint 成功时清理
```

### graph-persistence 注入点分析

最自然的注入点在步骤 5 大 try 块内，`buildDocGraph()` 调用之后、spec 渲染写盘之前，位置约 **L574**（目前是 Feature 098 注释处）：

```typescript
// Feature 101: 在此处持久化 DocGraph
writeAtomicJson(docGraphPersistPath, docGraph);
docGraphPath = toProjectPath(docGraphPersistPathAbs);
```

`docGraphPath` 变量已在返回值结构中预留（L714），说明早期设计就预留了持久化路径的输出位置。

---

## 5. Cache 系统（atomicWrite）

### atomicWrite 实现位置

文件：`src/utils/atomic-write.ts`

### 函数签名

```typescript
export function writeAtomicJson(filePath: string, data: unknown): void
```

### 实现原理

1. `path.resolve(filePath)` — 解析绝对路径
2. `fs.mkdirSync(dir, { recursive: true })` — 确保目录存在
3. `fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')` — 写 `{filePath}.tmp`
4. `fs.renameSync(tmpPath, resolvedPath)` — 原子替换

**特性**：同步操作，无 async 开销；`.tmp` 残留由 `renameSync` 覆盖，无需预清理。

### 调用方式（cache 系统参考）

```typescript
// manifest-manager.ts L167
import { writeAtomicJson } from '../../utils/atomic-write.js';
writeAtomicJson(manifestPath, this.manifest);  // 直接调用，无 await
```

### 可复用性评估

`writeAtomicJson` 完全通用，graph-persistence 可直接复用，无需任何修改。调用方式与 cache manifest 完全一致：

```typescript
import { writeAtomicJson } from '../../utils/atomic-write.js';
writeAtomicJson(docGraphPath, docGraph);  // DocGraph 是纯 JSON 可序列化对象
```

---

## 6. CLI 注册模式

### 子命令 switch 模式（src/cli/index.ts L116–L144）

```typescript
switch (command.subcommand) {
  case 'generate':   await runGenerate(command, version); break;
  case 'batch':      await runBatchCommand(command, version); break;
  case 'diff':       await runDiff(command, version); break;
  case 'init':       runInit(command); break;
  case 'prepare':    await runPrepare(command, version); break;
  case 'auth-status': await runAuthStatus(command); break;
  case 'panoramic':  await runPanoramicCommand(command); break;
  case 'cache':      await runCacheCommand(command); break;
  case 'mcp-server': await runMcpServer(); break;
}
```

添加 `graph` 子命令需要：
1. `CLICommand.subcommand` 联合类型增加 `'graph'`
2. `parseArgs` 中增加 `graph` 分支（参照 `cache` 分支结构）
3. `src/cli/commands/graph.ts` 新建 handler
4. `index.ts` switch 增加 `case 'graph'`
5. HELP_TEXT 增加子命令说明行

### HELP_TEXT 格式（src/cli/index.ts L32–L77）

HELP_TEXT 是模板字符串，包含：
- 用法行：`spectra cache <stats|clear> [--option <value>]`
- 子命令描述：对齐左侧 14 字符（如 `  cache         管理内容哈希缓存（stats / clear）`）
- 选项说明：`  --option       描述（仅 subcommand）`

graph 子命令建议格式：
```
  spectra graph <stats|export|show> [--output-dir <dir>]
  ...
  graph         管理 DocGraph 持久化（stats / export / show）
  ...
  --graph-format  导出格式: json | dot（仅 graph export）
```

### commands/cache.ts 参考模式（src/cli/commands/cache.ts）

```typescript
const CACHE_HELP = `spectra cache — ...`;

export async function runCacheCommand(command: CLICommand): Promise<void> {
  if (command.help || !command.cacheOperation) {
    console.log(CACHE_HELP);
    return;
  }

  // 初始化依赖
  const outputDir = command.outputDir ?? path.join(process.cwd(), 'specs');
  const cacheManager = new CacheManager(...);
  await cacheManager.initialize(outputDir);

  // 子操作 dispatch
  if (command.cacheOperation === 'stats') { ... return; }
  if (command.cacheOperation === 'clear') { ... return; }
}
```

graph 命令可完全照此模式实现：
- 子操作：`stats` | `export` | `show`
- CLICommand 新增：`graphOperation?: 'stats' | 'export' | 'show'`、`graphFormat?: 'json' | 'dot'`

---

## 7. 关键发现与风险

### 7.1 docGraphPath 已预留但未使用

`batch-orchestrator.ts` L86 和 L714 已在 `BatchOrchestratorResult` 中声明 `docGraphPath?: string` 字段，但 Feature 098 删除了写盘逻辑。graph-persistence 直接补充写盘代码即可，无需改动返回值类型。

### 7.2 ManifestEntry.dependencyGraph 预留扩展字段

`src/panoramic/cache/schemas.ts` L46 明确标注：
```typescript
/** 预留字段：供 Feature 101（graph-persistence）扩展依赖图 */
dependencyGraph: z.unknown().optional(),
```
Zod schema 已预留，Feature 101 可直接向 `ManifestEntry` 注入序列化的 `DocGraph` 或其精简版，无需修改 schema。

### 7.3 DocGraph 无 Zod Schema，持久化读回需手动验证

`DocGraph` 是纯 TypeScript interface，无 Zod schema。持久化后读取时若需验证，有两个选项：
- 方案 A：新建 `DocGraphSchema`（Zod）用于反序列化验证——结构复杂，工作量较大
- 方案 B：信任写入时的类型约束，读取时仅做基础字段检查——适合 MVP 阶段

### 7.4 ArchitectureIR 无 Zod Schema

同 DocGraph，`ArchitectureIR` 也是纯 interface。若 graph-persistence 需持久化 IR，同样面临无 Zod schema 的验证空白。建议先对 DocGraph 建立 schema，IR 按需扩展。

### 7.5 Feature 098 注释是最佳注入点标记

L574 的注释 `// 注意：不再生成 _doc-graph.json` 实际上是 Feature 098 的残留标记，也是 Feature 101 的精确注入位置。逻辑上就是将注释替换为实际的持久化调用。

### 7.6 atomicWrite 为同步调用，无需 async

`writeAtomicJson` 是同步函数，batch-orchestrator 的步骤 5 大 try 块可直接调用，无需 await，与周边 `fs.writeFileSync` 调用风格一致。

### 7.7 CLI 扩展点清晰，无兼容性风险

`CLICommand.subcommand` 是字面量联合类型，添加 `'graph'` 只影响编译期类型检查，不影响现有命令路径。`parseArgs` 中 `cache` 分支逻辑（L130–L171）结构简单，可直接复制并改名用于 `graph`。
