# API 契约: batch-orchestrator 多语言编排

**模块**: `src/batch/batch-orchestrator.ts` + `src/batch/language-grouper.ts`（新增）
**Feature**: 031-multilang-mixed-project

## 接口定义

### BatchOptions（扩展）

```typescript
export interface BatchOptions {
  force?: boolean;
  outputDir?: string;
  onProgress?: (completed: number, total: number) => void;
  maxRetries?: number;
  checkpointPath?: string;
  grouping?: GroupingOptions;
  languages?: string[];  // 新增
}
```

### BatchResult（扩展）

```typescript
export interface BatchResult {
  totalModules: number;
  successful: string[];
  failed: FailedModule[];
  skipped: string[];
  degraded: string[];
  duration: number;
  indexGenerated: boolean;
  summaryLogPath: string;
  detectedLanguages?: string[];  // 新增
  languageStats?: Map<string, LanguageFileStat>;  // 新增
}
```

### LanguageGroup（新增）

```typescript
export interface LanguageGroup {
  adapterId: string;
  languageName: string;
  files: string[];
}
```

### groupFilesByLanguage()（新增）

```typescript
export function groupFilesByLanguage(
  files: string[],
  filterLanguages?: string[],
): LanguageGroup[];
```

### buildDirectoryGraph()（新增）

```typescript
export async function buildDirectoryGraph(
  files: string[],
  projectRoot: string,
  skeletons: CodeSkeleton[],
): Promise<DependencyGraph>;
```

## 行为契约

### runBatch() — 多语言编排流程

**前置条件**:
- `LanguageAdapterRegistry` 已初始化
- `projectRoot` 存在且包含源代码文件

**新增流程步骤**:

```
原有流程:
  1. buildGraph → 2. groupFilesToModules → 3. 检查点恢复 → 4. 逐模块生成 → 5. 生成索引

新增流程:
  1. scanFiles → 1.5 groupFilesByLanguage → 1.6 按语言构建依赖图 →
  1.7 合并拓扑排序 → 2. groupFilesToModules(languageAware) →
  3. 检查点恢复 → 4. 逐模块生成(+language 注入) → 5. 生成索引(+languageDistribution)
```

**后置条件**:
- `BatchResult.detectedLanguages` 包含所有检测到的已支持语言
- 使用 `languages` 过滤时，仅过滤后的语言模块被处理
- 架构索引中的 `languageDistribution` 基于完整扫描结果
- 所有生成的 Spec 的 frontmatter 包含 `language` 字段（多语言项目时）
- 检查点文件包含 `languageGroups` 信息

### groupFilesByLanguage()

**前置条件**:
- `files` 为 `scanFiles()` 返回的有效文件列表
- `LanguageAdapterRegistry` 已初始化

**后置条件**:
- 每个文件恰好归入一个 `LanguageGroup`（通过 Registry.getAdapter() 确定）
- 所有 `LanguageGroup.files` 的并集等于输入的 `files`
- 如果 `filterLanguages` 非空，仅返回指定语言的分组

**错误处理**:
- `filterLanguages` 包含项目中不存在的语言 → 不报错，该语言的分组为空
- `filterLanguages` 包含所有语言都不存在 → 返回空数组，`runBatch` 输出友好提示

### buildDirectoryGraph()

**前置条件**:
- `files` 为同一语言的文件路径列表
- `skeletons` 与 `files` 一一对应
- `projectRoot` 为有效的项目根目录

**后置条件**:
- 返回的 `DependencyGraph` 中所有 `GraphNode.language` 设置为对应 adapter.id
- `DependencyEdge` 仅包含可确认的本地依赖（`isRelative: true` 的 import 解析成功）
- 无法解析的 import 路径不产生边（宽容策略）
- `topologicalOrder` 由复用的 `topologicalSort()` 计算
- `sccs` 由复用的 `detectSCCs()` 计算
- `mermaidSource` 由复用的 `renderDependencyGraph()` 生成

## languages 过滤语义

```
输入: files = [a.ts, b.ts, c.py, d.py, e.go]
      languages = ['typescript']

行为:
  1. groupFilesByLanguage(files) → {ts-js: [a.ts, b.ts], python: [c.py, d.py], go: [e.go]}
  2. 应用 languages 过滤 → 仅保留 ts-js 组
  3. 仅对 ts-js 组构建依赖图和 Spec
  4. languageStats 仍基于完整文件列表（全部 5 个文件）
  5. 架构索引展示全部 3 种语言，但 python 和 go 标注 processed: false
```

## 断点恢复兼容性

| 检查点格式 | 行为 |
|-----------|------|
| 旧格式（无 `languageGroups`） | 按单语言模式处理，等效于仅 ts-js 适配器 |
| 新格式（含 `languageGroups`） | 从检查点还原分组信息，跳过重新扫描和分组 |
| 新格式 + `filterLanguages` | 同时还原过滤条件 |

## MCP 工具契约

### prepare — 返回增强

```typescript
// 返回值中新增
{
  ...existingFields,
  detectedLanguages: string[]  // 从 scanFiles().languageStats.keys() 提取
}
```

**注意**: `prepareContext()` 内部已调用 `scanFiles()`。为避免重复调用，需要在 `prepareContext()` 返回值（`PrepareResult`）中透传 `scanResult.languageStats`，或在 MCP `prepare` handler 中独立调用一次 `scanFiles()`（成本极低）。

### batch — 参数增强

```typescript
server.tool('batch', '批量 Spec 生成', {
  projectRoot: z.string().optional(),
  force: z.boolean().default(false),
  languages: z.array(z.string()).optional()  // 新增
    .describe('仅处理指定语言（如 ["typescript", "python"]）'),
}, async ({ projectRoot, force, languages }) => {
  const root = projectRoot ?? process.cwd();
  const result = await runBatch(root, { force, languages });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
```
