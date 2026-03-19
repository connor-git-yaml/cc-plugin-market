# Feature 034 技术调研报告

**调研模式**: tech-only
**日期**: 2026-03-19

---

## 1. 现有接口模式分析

### LanguageAdapter 接口（Strategy 模式）

**文件**: `src/adapters/language-adapter.ts:75-137`

```typescript
interface LanguageAdapter {
  readonly id: string
  readonly languages: readonly Language[]
  readonly extensions: ReadonlySet<string>
  readonly defaultIgnoreDirs: ReadonlySet<string>
  analyzeFile(filePath, options?): Promise<CodeSkeleton>
  analyzeFallback(filePath): Promise<CodeSkeleton>
  buildDependencyGraph?(projectRoot, options?): Promise<DependencyGraph>
  getTerminology(): LanguageTerminology
  getTestPatterns(): TestPatterns
}
```

**设计要点**: Strategy 模式，4 个具体适配器（TsJs/Python/Go/Java），每个委托现有语言专用函数。

### LanguageAdapterRegistry（单例 + 工厂）

**文件**: `src/adapters/language-adapter-registry.ts:15-125`

- `register(adapter)` — 注册适配器（扩展名冲突检测）
- `getAdapter(filePath)` — O(1) 扩展名查找
- `getAllAdapters()` — 全量列出
- 全局单例 `getInstance()`

### 核心数据类型

| 类型 | 文件:行 | 职责 |
|------|---------|------|
| `CodeSkeleton` | `models/code-skeleton.ts:116-127` | AST 中间表示（exports/imports/hash） |
| `ModuleSpec` | `models/module-spec.ts:82-90` | 完整 spec（frontmatter + 9 章节 + Mermaid） |
| `AssembledContext` | `models/module-spec.ts:25-41` | LLM 输入上下文 + token 预算 |
| `DependencyGraph` | `models/dependency-graph.ts:45-56` | 模块依赖（modules/edges/topo/sccs） |
| `BatchState` | `models/module-spec.ts:183-199` | 断点恢复状态 |

---

## 2. 完整生成流程

```
scanFiles → analyzeFiles(AST) → mergeSkeletons → assembleContext
  → callLLM → parseLLMResponse → generateFrontmatter → renderSpec(HBS)
```

**入口**: `src/core/single-spec-orchestrator.ts:241-386`
**Batch**: `src/batch/batch-orchestrator.ts:163-399`

### Batch 中的项目上下文获取

```typescript
// 语言检测
scanResult.languageStats: Map<adapterId, LanguageFileStat>
isMultiLang = detectedLanguages.length >= 2

// Workspace 检测
groupFilesByLanguage() → LanguageGroup[]
mergeGraphsForTopologicalSort() → 全局拓扑序
```

---

## 3. 模板与渲染机制

**文件**: `src/generator/spec-renderer.ts:6-131`

- 3 个 Handlebars 模板（module-spec / index / drift-report）
- `initRenderer()` 一次性编译 + `registerHelpers()`
- 自定义 helpers: `formatSignature`, `hasContent`, `specLink`, `mermaidClass`
- `renderSpec(moduleSpec)` → Markdown + 基线骨架 HTML 注释

---

## 4. MCP 工具注册

**文件**: `src/mcp/server.ts:25-196`

```typescript
server.tool('prepare', schema, handler)
server.tool('generate', schema, handler)
server.tool('batch', schema, handler)
server.tool('diff', schema, handler)
```

参数 Zod schema 定义，返回 `{ content: [{ type: 'text', text }] }`

---

## 5. 对 Feature 034 接口设计的关键洞察

### 5.1 应复用的模式

| 模式 | 来源 | 在 034 中的应用 |
|------|------|----------------|
| Strategy 模式 | LanguageAdapter | DocumentGenerator 各实现类 |
| 单例 Registry | LanguageAdapterRegistry | GeneratorRegistry |
| Zod Schema 验证 | MCP server 参数 | Generator 输入/输出 schema |
| Handlebars 模板渲染 | spec-renderer | Generator.render() |
| 降级机制 | analyzeFile → analyzeFallback | extract AST-only → LLM 增强 |

### 5.2 需新增的抽象

| 抽象 | 职责 | 与现有系统的关系 |
|------|------|----------------|
| `DocumentGenerator<TInput, TOutput>` | 文档生成策略接口 | 与 LanguageAdapter 正交——Adapter 处理代码，Generator 处理文档 |
| `ArtifactParser<T>` | 非代码制品解析 | 与 LanguageAdapter 正交——Adapter 处理代码文件，Parser 处理非代码制品 |
| `ProjectContext` | 统一项目元信息 | 替代 batch-orchestrator 中散落的 projectRoot/languageStats |
| `GeneratorRegistry` | Generator 注册中心 | 参考 LanguageAdapterRegistry 设计 |

### 5.3 接口生命周期对比

```
LanguageAdapter:    analyzeFile() → CodeSkeleton
DocumentGenerator:  isApplicable() → extract() → generate() → render()
ArtifactParser:     filePatterns → parse() → parseAll()
```

### 5.4 代码插入点

- 新建 `src/panoramic/` 目录
- `src/panoramic/interfaces.ts` — 核心接口定义
- `src/panoramic/generator-registry.ts` — Registry 实现
- `src/panoramic/project-context.ts` — ProjectContext（Feature 035）
- 模板放 `templates/panoramic/` 子目录
- MCP 扩展在 `src/mcp/server.ts` 新增 tool 注册

---

## 6. 技术建议

1. **泛型设计**: `DocumentGenerator<TInput, TOutput>` 参考 Docusaurus Plugin 的 `loadContent → contentLoaded → postBuild`
2. **接口 Beta 阶段**: Phase 0 完成前接口为 Beta 状态，允许 Breaking Change；Phase 1 完成后锁定
3. **Zod Schema**: 为 `TInput` 和 `TOutput` 定义 Zod schema，用于运行时验证和 MCP 参数描述
4. **降级友好**: `extract()` 不依赖 LLM，`generate()` 在 LLM 不可用时降级为 AST-only
5. **与 batch-orchestrator 集成点**: batch 流程中可选地调用 `GeneratorRegistry.filterByContext()` 获取适用 Generator，在 spec 生成后追加 panoramic 文档
