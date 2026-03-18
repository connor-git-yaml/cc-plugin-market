---
feature: 025-multilang-adapter-layer
title: 核心 API 变更契约
created: 2026-03-17
---

# API 变更契约: 语言适配器抽象层

本文档定义 Feature 025 引入的 API 变更契约。分为三类：新增 API、修改 API、不变 API。

---

## 1. 新增 API

### 1.1 src/adapters/language-adapter.ts

**新增接口**：

```typescript
export interface LanguageAdapter {
  readonly id: string;
  readonly languages: readonly Language[];
  readonly extensions: ReadonlySet<string>;
  readonly defaultIgnoreDirs: ReadonlySet<string>;
  analyzeFile(filePath: string, options?: AnalyzeFileOptions): Promise<CodeSkeleton>;
  analyzeFallback(filePath: string): Promise<CodeSkeleton>;
  buildDependencyGraph?(projectRoot: string, options?: DependencyGraphOptions): Promise<DependencyGraph>;
  getTerminology(): LanguageTerminology;
  getTestPatterns(): TestPatterns;
}

export interface LanguageTerminology {
  codeBlockLanguage: string;
  exportConcept: string;
  importConcept: string;
  typeSystemDescription: string;
  interfaceConcept: string;
  moduleSystem: string;
}

export interface TestPatterns {
  filePattern: RegExp;
  testDirs: readonly string[];
}

export interface AnalyzeFileOptions {
  includePrivate?: boolean;
  maxDepth?: number;
}

export interface DependencyGraphOptions {
  includeOnly?: string;
  excludePatterns?: string[];
  configPath?: string;
}
```

**稳定性承诺**：`LanguageAdapter` 接口一经发布即为公开契约，后续版本只可扩展（新增可选方法），不可移除或修改已有方法签名。

---

### 1.2 src/adapters/language-adapter-registry.ts

**新增类**：

```typescript
export class LanguageAdapterRegistry {
  static getInstance(): LanguageAdapterRegistry;
  static resetInstance(): void;
  register(adapter: LanguageAdapter): void;
  getAdapter(filePath: string): LanguageAdapter | null;
  getSupportedExtensions(): Set<string>;
  getDefaultIgnoreDirs(): Set<string>;
  getAllAdapters(): readonly LanguageAdapter[];
}
```

**行为契约**：

| 方法 | 前置条件 | 后置条件 | 异常 |
|------|---------|---------|------|
| `getInstance()` | 无 | 返回同一单例引用 | 无 |
| `resetInstance()` | 无 | 下次 `getInstance()` 返回新空白实例 | 无 |
| `register(adapter)` | adapter 实现 LanguageAdapter | 所有 adapter.extensions 映射到该 adapter | 扩展名冲突时抛 Error |
| `getAdapter(filePath)` | 无 | 返回匹配的 adapter 或 null | 无 |
| `getSupportedExtensions()` | 无 | 返回所有已注册扩展名的 Set | 无 |
| `getDefaultIgnoreDirs()` | 无 | 返回所有适配器忽略目录的并集 | 无 |
| `getAllAdapters()` | 无 | 返回按注册顺序的 adapter 列表（只读副本） | 无 |

---

### 1.3 src/adapters/ts-js-adapter.ts

**新增类**：

```typescript
export class TsJsLanguageAdapter implements LanguageAdapter {
  readonly id: 'ts-js';
  readonly languages: readonly ['typescript', 'javascript'];
  readonly extensions: ReadonlySet<string>;  // {'.ts','.tsx','.js','.jsx'}
  readonly defaultIgnoreDirs: ReadonlySet<string>;
  analyzeFile(filePath: string, options?: AnalyzeFileOptions): Promise<CodeSkeleton>;
  analyzeFallback(filePath: string): Promise<CodeSkeleton>;
  buildDependencyGraph(projectRoot: string, options?: DependencyGraphOptions): Promise<DependencyGraph>;
  getTerminology(): LanguageTerminology;
  getTestPatterns(): TestPatterns;
}
```

**行为等价性契约**：

| 方法 | 等价于 | 差异 |
|------|-------|------|
| `analyzeFile(path, opts)` | `ast-analyzer.analyzeFile(path, opts)` | 零差异 |
| `analyzeFallback(path)` | `tree-sitter-fallback.analyzeFallback(path)` | 零差异 |
| `buildDependencyGraph(root, opts)` | `dependency-graph.buildGraph(root, opts)` | 零差异（options 字段名映射） |

---

### 1.4 src/adapters/index.ts

**新增函数**：

```typescript
export function bootstrapAdapters(): void;
```

**行为契约**：
- 幂等：多次调用不重复注册
- 注册 TsJsLanguageAdapter 到 LanguageAdapterRegistry
- 无返回值，无副作用（除 Registry 状态变更）

---

## 2. 修改 API

### 2.1 src/models/code-skeleton.ts

**LanguageSchema 扩展**：

| 变更类型 | 内容 |
|---------|------|
| 扩展枚举值 | 新增 `'python'`, `'go'`, `'java'`, `'rust'`, `'kotlin'`, `'cpp'`, `'ruby'`, `'swift'` |
| 向后兼容 | 所有现有值不变 |

**ExportKindSchema 扩展**：

| 变更类型 | 内容 |
|---------|------|
| 扩展枚举值 | 新增 `'struct'`, `'trait'`, `'protocol'`, `'data_class'`, `'module'` |
| 向后兼容 | 所有现有值不变 |

**MemberKindSchema 扩展**：

| 变更类型 | 内容 |
|---------|------|
| 扩展枚举值 | 新增 `'classmethod'`, `'staticmethod'`, `'associated_function'` |
| 向后兼容 | 所有现有值不变 |

**CodeSkeletonSchema.filePath 放宽**：

| 变更类型 | 内容 |
|---------|------|
| 正则扩展 | 从 `\.(ts\|tsx\|js\|jsx)$` 扩展为 20 种扩展名 |
| 向后兼容 | 原有 4 种扩展名仍匹配 |

---

### 2.2 src/utils/file-scanner.ts

**ScanOptions 扩展**：

```typescript
// 新增可选字段
export interface ScanOptions {
  projectRoot?: string;           // 不变
  extraIgnorePatterns?: string[];  // 不变
  extensions?: Set<string>;        // 新增：显式指定支持的扩展名，覆盖 Registry 默认值
}
```

**ScanResult 扩展**：

```typescript
// 新增可选字段
export interface ScanResult {
  files: string[];                                // 不变
  totalScanned: number;                           // 不变
  ignored: number;                                // 不变
  unsupportedExtensions?: Map<string, number>;     // 新增：不支持的扩展名统计
}
```

**行为变更**：

| 方面 | 变更前 | 变更后 | TS/JS 影响 |
|------|-------|-------|:----------:|
| 支持的扩展名 | 硬编码 `{.ts,.tsx,.js,.jsx}` | 从 Registry 动态获取 | 无（Registry 注册的扩展名完全一致） |
| 默认忽略目录 | 硬编码 7 个目录 | Registry 聚合 + 通用目录 | 无（集合内容一致） |
| 不支持文件提示 | 静默忽略 | 按扩展名聚合后 warn 到 stderr | 新增提示（仅有非 TS/JS 文件时触发） |

---

### 2.3 src/core/ast-analyzer.ts

**公共 API 不变**：

```typescript
// 签名不变
export async function analyzeFile(filePath: string, options?: AnalyzeOptions): Promise<CodeSkeleton>;
export async function analyzeFiles(filePaths: string[], options?: BatchAnalyzeOptions): Promise<CodeSkeleton[]>;
```

**内部行为变更**：

| 方面 | 变更前 | 变更后 | 对外影响 |
|------|-------|-------|:--------:|
| 文件类型检查 | 内部 `isSupportedFile()` | 通过 Registry `getAdapter()` | 无（TS/JS 文件路由到 TsJsLanguageAdapter） |
| 语言检测 | 内部 `getLanguage()` | 由 adapter 内部处理 | 无 |

---

### 2.4 src/core/single-spec-orchestrator.ts

**公共 API 不变**：

```typescript
// 签名不变
export async function prepareContext(targetPath: string, options?: GenerateSpecOptions): Promise<PrepareResult>;
export async function generateSpec(targetPath: string, options?: GenerateSpecOptions): Promise<GenerateSpecResult>;
```

**错误消息变更**：

| 原消息 | 新消息 |
|-------|-------|
| `目标路径中未找到 TS/JS 文件: ${targetPath}` | `目标路径中未找到支持的源文件: ${targetPath}` |

---

### 2.5 src/core/context-assembler.ts

**公共 API 不变**：

```typescript
// 签名不变
export async function assembleContext(skeleton: CodeSkeleton, options?: AssemblyOptions): Promise<AssembledContext>;
```

**内部变更**：

| 位置 | 变更前 | 变更后 | TS/JS 输出 |
|------|-------|-------|:----------:|
| `formatSkeleton()` 代码块 | `` ```typescript `` | `` ```${skeleton.language} `` | 不变（skeleton.language 为 `'typescript'`） |
| `formatSnippets()` 代码块 | `` ```typescript `` | `` ```${skeleton.language} `` | 不变 |

注意：`formatSnippets()` 当前不接受 skeleton 参数。需要在改造时传入 language 信息，可通过闭包或新增参数实现。具体方案在实现时确定，但不改变 `assembleContext()` 的公共签名。

---

### 2.6 src/core/secret-redactor.ts

**公共 API 不变**：

```typescript
// 签名不变
export function redact(content: string, filePath?: string): RedactionResult;
```

**内部变更**：

| 位置 | 变更前 | 变更后 | TS/JS 输出 |
|------|-------|-------|:----------:|
| `isTestFile()` | 硬编码正则 `/\.(test\|spec)\.(ts\|tsx\|js\|jsx)$/` | 从 Registry 获取所有 TestPatterns 后合并匹配 | 不变（TsJsLanguageAdapter 的 TestPatterns 正则与原硬编码一致） |

---

## 3. 不变 API（零修改承诺）

以下公共 API 在本 Feature 中**不做任何修改**：

| 文件 | 公共 API | 不变理由 |
|------|---------|---------|
| `src/core/llm-client.ts` | `callLLM()`, `parseLLMResponse()` | 推迟到 Feature 026 |
| `src/generator/spec-renderer.ts` | `renderSpec()`, `initRenderer()` | 语言无关 |
| `src/generator/frontmatter.ts` | `generateFrontmatter()` | 语言无关 |
| `src/generator/mermaid-class-diagram.ts` | `generateClassDiagram()` | 语言无关（消费 CodeSkeleton） |
| `src/generator/index-generator.ts` | `generateIndex()` | 语言无关 |
| `src/graph/topological-sort.ts` | `topologicalSort()`, `detectSCCs()` | 纯图算法 |
| `src/batch/checkpoint.ts` | `loadCheckpoint()`, `saveCheckpoint()` | 语言无关 |
| `src/batch/progress-reporter.ts` | `createReporter()` | 语言无关 |
| `src/batch/module-grouper.ts` | `groupFilesToModules()` | 语言无关 |

---

## 4. 版本兼容性矩阵

| 消费者 | 产出的 CodeSkeleton | 新版 schema | 结果 |
|--------|-------------------|:----------:|:----:|
| 旧版 reverse-spec | `language: 'typescript'` | 新版 parse | PASS |
| 旧版 reverse-spec | `kind: 'function'` | 新版 parse | PASS |
| 新版 reverse-spec (Feature 025) | `language: 'typescript'` | 新版 parse | PASS |
| 未来 Feature 028 | `language: 'python'` | 新版 parse | PASS |
| 未来 Feature 028 | `kind: 'module'` | 新版 parse | PASS |
| 任何版本 | `language: 'unknown'` | 新版 parse | FAIL (ZodError) |

---

## 5. 错误类型契约

### 5.1 现有错误类型（不变）

```typescript
// src/core/ast-analyzer.ts
export class FileNotFoundError extends Error { name: 'FileNotFoundError' }
export class UnsupportedFileError extends Error { name: 'UnsupportedFileError' }

// src/graph/dependency-graph.ts
export class ProjectNotFoundError extends Error { name: 'ProjectNotFoundError' }
export class NoDependencyCruiserError extends Error { name: 'NoDependencyCruiserError' }
```

### 5.2 新增错误场景

| 场景 | 错误类型 | 消息 |
|------|---------|------|
| Registry 无适配器时被查询 | `Error` | `LanguageAdapterRegistry 中未注册任何适配器。请确保在启动时调用 bootstrapAdapters()` |
| 扩展名冲突 | `Error` | `扩展名冲突: '${ext}' 已被适配器 '${existingId}' 注册，无法再注册到 '${newId}'` |
| 不支持的文件类型 | `UnsupportedFileError`（复用） | `不支持的文件类型: ${filePath}` |
