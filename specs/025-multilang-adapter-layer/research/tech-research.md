# 技术调研报告: LanguageAdapter 抽象层

> Feature: 025-multilang-adapter-layer | 日期: 2026-03-16 | 前序制品: specs/024-multilang-blueprint/blueprint.md

---

## 1. 现有架构深度分析

### 1.1 语言耦合点全景图

通过逐文件深度阅读，梳理出当前代码库中所有与 TS/JS 语言强耦合的位置：

| # | 文件 | 耦合类型 | 具体位置 | 影响范围 |
|---|------|---------|---------|---------|
| 1 | `src/models/code-skeleton.ts:40` | 枚举硬编码 | `LanguageSchema = z.enum(['typescript', 'javascript'])` | 数据模型层，所有消费者 |
| 2 | `src/models/code-skeleton.ts:9-17` | 枚举硬编码 | `ExportKindSchema` 仅含 JS/TS 概念（function, class, interface, type, enum, const, variable） | 缺少 struct, trait, protocol, data_class, module 等 |
| 3 | `src/models/code-skeleton.ts:20-27` | 枚举硬编码 | `MemberKindSchema` 仅含 JS/TS 概念 | 缺少 classmethod, staticmethod, associated_function 等 |
| 4 | `src/models/code-skeleton.ts:95` | 正则硬编码 | `filePath: z.string().regex(/\.(ts\|tsx\|js\|jsx)$/)` | 非 JS/TS 文件的 CodeSkeleton 无法通过 Zod 验证 |
| 5 | `src/core/ast-analyzer.ts:92` | 常量硬编码 | `SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])` | 非 JS/TS 文件被 `isSupportedFile` 拒绝 |
| 6 | `src/core/ast-analyzer.ts:94-99` | 函数硬编码 | `getLanguage()` 仅返回 `'typescript'` 或 `'javascript'` | 语言检测逻辑不可扩展 |
| 7 | `src/core/ast-analyzer.ts:6` | 依赖硬编码 | `import { Project, SourceFile, ... } from 'ts-morph'` | AST 解析 100% 绑定 ts-morph |
| 8 | `src/core/tree-sitter-fallback.ts:25-39` | 正则硬编码 | `exportPatterns` 仅匹配 JS/TS `export` 语法 | 降级模式无法处理其他语言 |
| 9 | `src/core/tree-sitter-fallback.ts:91-93` | 正则硬编码 | `importRe` 仅匹配 JS/TS `import ... from` 语法 | 降级导入提取不可扩展 |
| 10 | `src/core/tree-sitter-fallback.ts:128-133` | 函数硬编码 | `getLanguage()` 重复实现，同样仅支持 TS/JS | 与 ast-analyzer 的 getLanguage 重复 |
| 11 | `src/utils/file-scanner.ts:9` | 常量硬编码 | `SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])` | 非 JS/TS 文件在扫描阶段被丢弃 |
| 12 | `src/utils/file-scanner.ts:12-20` | 常量硬编码 | `DEFAULT_IGNORE_DIRS` 仅含 JS/TS 生态目录（node_modules, .next, .nuxt 等） | 缺少 `__pycache__`, `.venv`, `vendor` 等 |
| 13 | `src/graph/dependency-graph.ts:6` | 依赖硬编码 | `import { cruise } from 'dependency-cruiser'` | dependency-cruiser 仅支持 JS/TS |
| 14 | `src/graph/dependency-graph.ts:66-69` | 模式硬编码 | `excludePatterns` 中的 `\\.(spec\|test)\\.(js\|ts\|tsx\|jsx)$` | 测试文件过滤仅匹配 JS/TS 扩展名 |
| 15 | `src/core/context-assembler.ts:76` | 代码块标记 | `` parts.push('```typescript') `` | 代码块语言标记固定为 typescript |
| 16 | `src/core/context-assembler.ts:120` | 代码块标记 | `` `\`\`\`typescript\n${s}\n\`\`\`` `` | 代码片段语言标记固定为 typescript |
| 17 | `src/core/llm-client.ts:481-571` | Prompt 硬编码 | `buildSystemPrompt` 中多处"导出函数/类/类型"、"TypeScript 代码块"等术语 | LLM 收到不准确的语言上下文 |
| 18 | `src/diff/semantic-diff.ts:27-34` | 代码块标记 | `` ```typescript `` 硬编码 | 语义 diff 传给 LLM 的代码块标记不正确 |
| 19 | `src/diff/noise-filter.ts:42` | 正则硬编码 | import 检测正则仅匹配 JS/TS `import ... from` | 噪声过滤对其他语言无效 |
| 20 | `src/core/secret-redactor.ts:136` | 正则硬编码 | `isTestFile` 仅匹配 `.(test\|spec).(ts\|tsx\|js\|jsx)$` | 非 JS/TS 测试文件不会获得宽松脱敏规则 |
| 21 | `src/core/single-spec-orchestrator.ts:169` | 消息硬编码 | `'目标路径中未找到 TS/JS 文件'` | 错误信息暗示只支持 TS/JS |
| 22 | `src/batch/batch-orchestrator.ts:8` | 依赖链 | 通过 `buildGraph` 间接依赖 dependency-cruiser | 批量编排无法处理非 JS/TS 项目 |

### 1.2 数据流分析

当前流水线的数据流（单模块 Spec 生成）：

```
scanFiles() → filePaths[]
    ↓
analyzeFile() / analyzeFiles() → CodeSkeleton[]
    ↓ (降级: analyzeFallback)
mergeSkeletons() → CodeSkeleton
    ↓
assembleContext() → AssembledContext { prompt, tokenCount }
    ↓
callLLM() → LLMResponse { content }
    ↓
parseLLMResponse() → ParsedSpecSections
    ↓
renderSpec() → Markdown
```

批量流水线在此基础上增加：

```
buildGraph() → DependencyGraph
    ↓
groupFilesToModules() → ModuleGroupResult { groups, moduleOrder }
    ↓
for each module in topologicalOrder:
    generateSpec(modulePath) → GenerateSpecResult
```

**关键观察**：TS/JS 专用逻辑集中在流水线前半段（扫描 + AST 分析 + 依赖图），后半段（LLM 调用 + 渲染）相对语言无关，仅需参数化代码块标记和术语。

### 1.3 现有依赖使用状况

| 依赖 | 版本 | 实际使用情况 |
|------|------|------------|
| `ts-morph` | ^24.0.0 | **深度使用**：ast-analyzer.ts 中作为 TS/JS 主解析器，提取导出、导入、成员、JSDoc、签名等 |
| `tree-sitter` | ^0.21.1 | **未使用**：package.json 中声明但源码中从未 `import` 或 `require` |
| `tree-sitter-typescript` | ^0.23.2 | **未使用**：同上，从未在源码中引用 |
| `dependency-cruiser` | ^16.8.0 | **深度使用**：dependency-graph.ts 中作为 JS/TS 依赖图构建器 |
| `zod` | ^3.24.1 | **深度使用**：所有数据模型定义 |
| `handlebars` | ^4.7.8 | **中度使用**：spec-renderer.ts 模板渲染 |
| `@anthropic-ai/sdk` | ^0.39.0 | **深度使用**：LLM 调用 |
| `@modelcontextprotocol/sdk` | ^1.26.0 | **中度使用**：MCP 服务器 |

**重要发现**：`tree-sitter` 和 `tree-sitter-typescript`（原生 Node 绑定版）已在 dependencies 中声明但**从未实际使用**。当前的 "tree-sitter fallback" (`tree-sitter-fallback.ts`) 完全基于正则表达式，与真正的 tree-sitter 无关。

---

## 2. 架构方案选型

### 2.1 方案 A: 策略模式 + Registry（推荐）

#### 架构设计

```
LanguageAdapter (interface)
    │
    ├── TsJsLanguageAdapter      ← 封装现有 ts-morph + dependency-cruiser 逻辑
    ├── PythonLanguageAdapter     ← Future: Feature 028
    ├── GoLanguageAdapter         ← Future: Feature 029
    └── JavaLanguageAdapter       ← Future: Feature 030

LanguageAdapterRegistry (singleton)
    ├── register(adapter: LanguageAdapter): void
    ├── getAdapter(filePath: string): LanguageAdapter | null
    ├── getSupportedExtensions(): Set<string>
    └── getDefaultIgnoreDirs(): Set<string>
```

#### 注册流程

```typescript
// 启动时静态注册
const registry = LanguageAdapterRegistry.getInstance();
registry.register(new TsJsLanguageAdapter());
// 未来:
// registry.register(new PythonLanguageAdapter());
// registry.register(new GoLanguageAdapter());
```

#### 核心接口草案

```typescript
interface LanguageAdapter {
  /** 适配器标识 */
  readonly id: string;
  /** 支持的语言 */
  readonly languages: Language[];
  /** 支持的文件扩展名（含前导点） */
  readonly extensions: ReadonlySet<string>;
  /** 默认忽略目录 */
  readonly defaultIgnoreDirs: ReadonlySet<string>;

  /** AST 分析单个文件 → CodeSkeleton */
  analyzeFile(filePath: string, options?: AnalyzeOptions): Promise<CodeSkeleton>;

  /** 正则降级分析 */
  analyzeFallback(filePath: string): Promise<CodeSkeleton>;

  /** 构建依赖图（可选，有些语言可能暂不支持） */
  buildDependencyGraph?(projectRoot: string, options?: GraphOptions): Promise<DependencyGraph>;

  /** 返回该语言的术语映射（用于 LLM prompt 参数化） */
  getTerminology(): LanguageTerminology;

  /** 返回该语言的测试文件匹配模式 */
  getTestPatterns(): TestPatterns;
}
```

#### 优势

- **零行为变更**：TsJsLanguageAdapter 直接包装现有函数，所有现有测试无需修改
- **类型安全**：TypeScript interface 提供编译时检查
- **简单直观**：Registry 是常见的 GoF 模式，团队容易理解
- **可测试性高**：每个适配器可独立单元测试，Registry 可 mock

#### 劣势

- 所有适配器需要在启动时注册（启动时即加载所有适配器模块）
- 新增语言需要修改注册代码（但仅一行 `registry.register(...)`)

### 2.2 方案 B: 插件式架构（动态发现 + 延迟加载）

#### 架构设计

```
LanguagePlugin (interface extends LanguageAdapter)
    │
    ├── metadata: { name, version, languages, extensions }
    └── activate(): Promise<void>   ← 延迟初始化

PluginManager
    ├── discoverPlugins(searchPaths: string[]): PluginMetadata[]
    ├── loadPlugin(name: string): Promise<LanguagePlugin>
    ├── getPluginForFile(filePath: string): Promise<LanguagePlugin | null>
    └── unloadPlugin(name: string): void
```

#### 发现机制

```
node_modules/reverse-spec-lang-*/   ← npm 包约定
~/.reverse-spec/plugins/            ← 用户自定义插件目录
```

每个插件包导出 `PluginManifest`:

```typescript
// reverse-spec-lang-python/index.ts
export const manifest: PluginManifest = {
  name: 'reverse-spec-lang-python',
  version: '1.0.0',
  languages: ['python'],
  extensions: ['.py', '.pyi'],
  entrypoint: './adapter.js',
};
```

#### 优势

- **完全解耦**：核心代码不需要知道任何具体语言适配器
- **社区扩展**：第三方可以发布 npm 插件包
- **延迟加载**：按需加载语言支持，减少启动时间和内存占用

#### 劣势

- **复杂度高**：需要实现插件发现、版本兼容性检查、加载/卸载生命周期
- **调试困难**：动态加载的代码难以追踪和调试
- **安全风险**：执行未知第三方代码
- **过度设计**：当前仅 reverse-spec 团队维护语言支持，社区插件场景不存在
- **与 Constitution VII 原则摩擦**：纯 Node.js 生态约束下，动态 require 和 import() 的跨平台兼容性问题

### 2.3 对比矩阵

| 维度 | 方案 A: 策略模式 + Registry | 方案 B: 插件式架构 |
|------|---------------------------|------------------|
| **实现复杂度** | 低（~200 行核心代码） | 高（~600 行 + 插件约定） |
| **运行时性能** | 优（同步注册，O(1) 查找） | 良（首次访问有 import() 延迟） |
| **可维护性** | 高（所有代码在同一仓库） | 中（分散到多个 npm 包） |
| **扩展成本** | 低（实现接口 + 1 行注册） | 中（创建独立 npm 包 + 发布） |
| **类型安全** | 编译时检查 | 运行时检查 |
| **测试便利性** | 高（直接 import + mock） | 中（需要模拟插件加载） |
| **社区扩展** | 需要 PR 合入主仓库 | 独立发布 npm 包 |
| **首个版本交付速度** | 快（1-2 周） | 慢（3-4 周） |

### 2.4 选型结论

**推荐方案 A（策略模式 + Registry）**。

理由：
1. reverse-spec 当前为单团队维护项目，无社区插件需求
2. Blueprint 规划中仅 4 种新语言（Python、Go、Java + 混合），均为内部实现
3. 方案 A 不排斥未来演化为方案 B — Registry 可以在后续版本添加动态加载能力
4. 最小化复杂度符合 Constitution 原则

---

## 3. 依赖库评估

### 3.1 tree-sitter 原生 vs web-tree-sitter（WASM）

| 维度 | tree-sitter（原生） | web-tree-sitter（WASM） |
|------|-------------------|----------------------|
| npm 包 | `tree-sitter` ^0.21.1 | `web-tree-sitter` ^0.24.x |
| 编译方式 | 需要 node-gyp + C 编译器 | 纯 WASM，无需原生编译 |
| 跨平台 | macOS/Linux 需要 Xcode/gcc，Windows 问题多 | 所有 Node.js 环境开箱即用 |
| 性能 | 原生速度（~2x WASM） | WASM 开销（但对代码分析场景足够） |
| grammar 加载 | 原生 .node 绑定 | .wasm 文件（按需加载） |
| ABI 兼容性 | tree-sitter 与 grammar 需要严格匹配 ABI 版本 | WASM 二进制向前兼容性好 |
| 维护活跃度 | 活跃（tree-sitter 核心库） | 活跃（v0.24.6，2025 年有发布） |
| npm 安装成功率 | 中（原生编译常见失败） | 高（纯 JS + WASM） |

**当前状态**：`package.json` 中已声明 `tree-sitter` ^0.21.1 和 `tree-sitter-typescript` ^0.23.2，但**源码中从未使用**。这两个原生依赖是死代码。

**建议**：
1. Feature 025 **不**引入任何新 tree-sitter 依赖（不在本 Feature 范围内）
2. Feature 027（tree-sitter 后端）中引入 `web-tree-sitter`（WASM 版），移除未使用的原生 `tree-sitter` + `tree-sitter-typescript`
3. 本 Feature 仅需确保 `LanguageAdapter` 接口能支持未来 tree-sitter 集成

### 3.2 Feature 025 新增依赖评估

| 依赖 | 是否需要 | 理由 |
|------|---------|------|
| 新增运行时依赖 | **否** | 策略模式 + Registry 仅使用 TypeScript 原生能力 |
| web-tree-sitter | **否** | 归属 Feature 027，非本 Feature 范围 |
| 移除 tree-sitter | **否** | 建议延迟到 Feature 027，避免本 Feature 的变更范围过大 |

**结论：Feature 025 零新增依赖、零移除依赖。**

---

## 4. 设计模式调研

### 4.1 策略模式（Strategy Pattern）

**适用性：高**

策略模式将算法族封装为可互换的策略对象。在本场景中：

- **上下文（Context）**：`single-spec-orchestrator.ts` / `batch-orchestrator.ts`
- **策略接口（Strategy）**：`LanguageAdapter`
- **具体策略（Concrete Strategy）**：`TsJsLanguageAdapter`、未来的 `PythonLanguageAdapter` 等

**在本 Feature 中的应用**：
- `analyzeFile(filePath)` 根据文件扩展名选择对应的 `LanguageAdapter`
- 每个 adapter 封装完整的语言特定逻辑（AST 解析、降级、依赖图、术语）
- 编排器通过统一的 `LanguageAdapter` 接口与语言特定代码交互

**实现要点**：
```typescript
// 编排器中的使用方式
const adapter = registry.getAdapter(filePath);
if (!adapter) throw new UnsupportedFileError(filePath);
const skeleton = await adapter.analyzeFile(filePath, options);
```

### 4.2 适配器模式（Adapter Pattern）

**适用性：中**

适配器模式将不兼容接口转换为目标接口。在本场景中：

- `TsJsLanguageAdapter` 将 ts-morph API（`Project.addSourceFileAtPath`、`SourceFile.getExportedDeclarations` 等）适配为统一的 `LanguageAdapter.analyzeFile()` 接口
- 未来 `PythonLanguageAdapter` 将 tree-sitter 的 `Parser.parse()` + query API 适配为同一接口

**与策略模式的关系**：适配器模式是策略模式的实现细节。每个具体的 `LanguageAdapter` 本质上是一个适配器，将不同的解析库（ts-morph、tree-sitter、正则）适配为统一接口。

### 4.3 注册表模式（Registry Pattern）

**适用性：高**

注册表模式提供全局/区域性的对象查找服务。

#### 实现方式

```typescript
class LanguageAdapterRegistry {
  private static instance: LanguageAdapterRegistry | null = null;
  private adapters: Map<string, LanguageAdapter> = new Map(); // extension → adapter
  private adapterList: LanguageAdapter[] = [];

  static getInstance(): LanguageAdapterRegistry {
    if (!this.instance) {
      this.instance = new LanguageAdapterRegistry();
    }
    return this.instance;
  }

  /** 测试用：重置单例 */
  static resetInstance(): void {
    this.instance = null;
  }

  register(adapter: LanguageAdapter): void {
    for (const ext of adapter.extensions) {
      if (this.adapters.has(ext)) {
        throw new Error(`扩展名 ${ext} 已被 ${this.adapters.get(ext)!.id} 注册`);
      }
      this.adapters.set(ext, adapter);
    }
    this.adapterList.push(adapter);
  }

  getAdapter(filePath: string): LanguageAdapter | null {
    const ext = path.extname(filePath);
    return this.adapters.get(ext) ?? null;
  }

  getSupportedExtensions(): Set<string> {
    return new Set(this.adapters.keys());
  }

  getDefaultIgnoreDirs(): Set<string> {
    const dirs = new Set<string>();
    for (const adapter of this.adapterList) {
      for (const dir of adapter.defaultIgnoreDirs) {
        dirs.add(dir);
      }
    }
    return dirs;
  }

  getAllAdapters(): LanguageAdapter[] {
    return [...this.adapterList];
  }
}
```

**关键设计决策**：

1. **单例 vs 依赖注入**：选择单例模式（与现有 `sharedProject` 单例风格一致），但提供 `resetInstance()` 支持测试。编排器可以通过参数接受 registry 实例（可选的依赖注入后门）。

2. **扩展名冲突检测**：`register()` 时对重复扩展名抛错，防止多个适配器争抢同一文件类型。

3. **延迟初始化 vs 启动初始化**：选择启动时初始化（CLI 入口 / MCP 服务器启动时注册所有适配器），简化运行时行为。

### 4.4 模式组合

最终架构组合三种模式：

```
Registry Pattern (查找)
    → Strategy Pattern (选择)
        → Adapter Pattern (适配)
```

即：通过 Registry 查找文件对应的 LanguageAdapter（策略），该 Adapter 内部将具体的解析库（ts-morph / tree-sitter / 正则）适配为统一的 CodeSkeleton 输出。

---

## 5. CodeSkeleton 模型变更方案

### 5.1 变更清单

#### 5.1.1 LanguageSchema 扩展

```typescript
// 当前
export const LanguageSchema = z.enum(['typescript', 'javascript']);

// 变更后
export const LanguageSchema = z.enum([
  'typescript', 'javascript',    // 现有
  'python', 'go', 'java',       // P0 新增
  'rust', 'kotlin', 'cpp',      // P1 新增
  'ruby', 'swift',              // P2 新增
]);
```

#### 5.1.2 ExportKindSchema 扩展

```typescript
// 当前
export const ExportKindSchema = z.enum([
  'function', 'class', 'interface', 'type', 'enum', 'const', 'variable',
]);

// 变更后
export const ExportKindSchema = z.enum([
  'function', 'class', 'interface', 'type', 'enum', 'const', 'variable',  // 现有
  'struct', 'trait', 'protocol', 'data_class', 'module',                   // 新增
]);
```

#### 5.1.3 MemberKindSchema 扩展

```typescript
// 当前
export const MemberKindSchema = z.enum([
  'method', 'property', 'getter', 'setter', 'constructor',
]);

// 变更后
export const MemberKindSchema = z.enum([
  'method', 'property', 'getter', 'setter', 'constructor',        // 现有
  'classmethod', 'staticmethod', 'associated_function',            // 新增
]);
```

#### 5.1.4 filePath 正则放宽

```typescript
// 当前
filePath: z.string().regex(/\.(ts|tsx|js|jsx)$/),

// 变更后 — 支持所有目标语言扩展名
filePath: z.string().regex(/\.(ts|tsx|js|jsx|py|pyi|go|java|kt|kts|rs|cpp|cc|cxx|c|h|hpp|rb|swift)$/),
```

#### 5.1.5 ImportReference 扩展（可选字段）

```typescript
// 当前的 ImportReferenceSchema 中：
isTypeOnly: z.boolean(),

// 考虑新增可选字段以支持其他语言的导入概念：
isTypeOnly: z.boolean(),                          // 现有
importStyle: z.enum(['named', 'default', 'star', 'side-effect', 'package']).optional(),  // 新增，可选
```

### 5.2 向后兼容性分析

| 变更项 | 兼容性影响 | 缓解措施 |
|--------|-----------|---------|
| LanguageSchema 扩展枚举值 | **前向兼容**：新增枚举值不破坏已有值的消费者 | 已有代码使用 `'typescript'` 或 `'javascript'` 字面量，不受影响 |
| ExportKindSchema 扩展枚举值 | **前向兼容** | 类图生成器 `generateClassDiagram` 仅筛选 `class`/`interface`，新值被忽略 |
| MemberKindSchema 扩展枚举值 | **前向兼容** | 现有 member 渲染逻辑有 `else` 分支兜底 |
| filePath 正则放宽 | **前向兼容**：原有的 `.ts/.tsx/.js/.jsx` 仍匹配新正则 | 无需缓解 |
| 已序列化的 CodeSkeleton（baseline） | **风险点**：如果旧版 baseline JSON 被新版 Zod schema 重新解析 | 旧 baseline 中 `language: 'typescript'` 和 `filePath: '*.ts'` 仍然通过新 schema 验证 |

**结论：所有模型变更均为纯扩展（只增不减），对现有 TS/JS 功能零破坏。**

### 5.3 边界场景风险

1. **switch/case 遗漏**：如果代码中有 `switch (skeleton.language)` 且无 `default` 分支，新语言会导致运行时遗漏。
   - **缓解**：通过全局 grep 搜索所有 `switch.*language` 和 `=== 'typescript'` / `=== 'javascript'` 出现位置，确保都有兜底。

2. **Zod `.parse()` 严格模式**：如果有代码对 CodeSkeleton 执行 `.parse()` 而非 `.safeParse()`，且传入了旧 schema 不支持的值，会抛出 ZodError。
   - **缓解**：在 Feature 025 中，TsJsLanguageAdapter 仅产出 `'typescript'` 或 `'javascript'`，不会触发新枚举值。新枚举值只在后续 Feature（028/029/030）实现新适配器时才被使用。

3. **golden-master 测试**：`tests/golden-master/` 中可能有快照依赖于当前 schema 的精确形状。
   - **缓解**：枚举扩展不影响已有快照的匹配，因为快照中的值仍在新枚举范围内。

---

## 6. 关键改造点逐文件设计

### 6.1 `src/models/code-skeleton.ts`

**改动**：扩展 LanguageSchema、ExportKindSchema、MemberKindSchema 枚举值；放宽 filePath 正则。

**影响面**：所有使用 `CodeSkeleton` 类型的文件。但因为是纯扩展，无需修改消费者代码。

### 6.2 `src/core/ast-analyzer.ts`

**改动**：
1. 提取 `getLanguage()`、`isSupportedFile()` 为 TsJsLanguageAdapter 方法
2. `analyzeFile()` / `analyzeFiles()` 改为先通过 Registry 路由，TS/JS 文件路由到 TsJsLanguageAdapter
3. 保留 `analyzeFile()` 作为公共 API 入口（内部委托 Registry）

**策略**：分两步重构
- 步骤 1：将 TS/JS 特定逻辑提取到 `src/adapters/ts-js-adapter.ts`
- 步骤 2：`ast-analyzer.ts` 改为 Registry 路由的薄包装层（保持 API 兼容）

### 6.3 `src/core/tree-sitter-fallback.ts`

**改动**：
1. 将现有正则提取逻辑封装为 `TsJsLanguageAdapter.analyzeFallback()` 的实现
2. `getLanguage()` 删除（已在 adapter 层处理）

### 6.4 `src/utils/file-scanner.ts`

**改动**：
1. `SUPPORTED_EXTENSIONS` 改为从 Registry 动态获取（`registry.getSupportedExtensions()`）
2. `DEFAULT_IGNORE_DIRS` 改为从 Registry 聚合（`registry.getDefaultIgnoreDirs()`），并合并通用的 `.git` 等
3. `ScanOptions` 新增 `extensions?: Set<string>` 可选参数，支持调用方显式指定

### 6.5 `src/graph/dependency-graph.ts`

**改动**：
1. `buildGraph()` 改为先检查 Registry 中是否有适配器提供 `buildDependencyGraph`
2. 当前 dependency-cruiser 逻辑移入 `TsJsLanguageAdapter.buildDependencyGraph()`
3. 对于无依赖图支持的语言，返回空图或仅基于 import 语句的简易图

### 6.6 `src/core/single-spec-orchestrator.ts`

**改动**：
1. `prepareContext()` 中的文件扫描改用参数化的 `scanFiles()`
2. AST 分析改为通过 Registry 路由
3. 错误消息从"TS/JS 文件"改为"支持的源文件"

### 6.7 `src/batch/batch-orchestrator.ts`

**改动**：
1. `buildGraph()` 调用改为通过 Registry 路由到语言特定的依赖图构建器
2. 如果多种语言共存，分语言构建各自的依赖图后合并

### 6.8 新增文件

| 文件 | 职责 |
|------|------|
| `src/adapters/language-adapter.ts` | LanguageAdapter 接口定义 + LanguageTerminology 类型 |
| `src/adapters/language-adapter-registry.ts` | Registry 实现 |
| `src/adapters/ts-js-adapter.ts` | TsJsLanguageAdapter 实现 |
| `src/adapters/index.ts` | 导出 + 默认注册 |

---

## 7. 技术风险清单

| # | 风险 | 概率 | 影响 | 缓解措施 |
|---|------|------|------|---------|
| R1 | CodeSkeleton schema 变更导致已有 baseline JSON 反序列化失败 | 低 | 高 | 枚举扩展为前向兼容，旧值仍合法；增加集成测试验证旧 baseline 可被新 schema 解析 |
| R2 | 提取 TsJsLanguageAdapter 时引入隐式行为变更 | 中 | 高 | 全量运行现有测试套件（42 个测试文件），golden-master + self-hosting 测试确保零回归 |
| R3 | Registry 单例在测试中的状态泄露 | 中 | 中 | 提供 `resetInstance()` 方法；每个测试用例前后重置 Registry |
| R4 | file-scanner 参数化后破坏 .gitignore 交互 | 低 | 中 | `DEFAULT_IGNORE_DIRS` 改为 Registry 聚合后仍包含通用目录（`.git`、`node_modules`），并通过现有 `file-scanner.test.ts` 验证 |
| R5 | dependency-graph 重构引入 circular import | 低 | 中 | adapter 层不引入对 `dependency-graph.ts` 的直接依赖；通过接口方法 + 延迟调用避免循环 |
| R6 | 多语言 filePath 正则过于宽松，匹配到非源代码文件 | 低 | 低 | 正则仅扩展到已知的编程语言扩展名，不使用通配 |
| R7 | 重构改动量大导致多个 PR 冲突 | 中 | 中 | 建议按"新增接口 → 封装 adapter → 接入 registry → 参数化"的增量步骤提交，每步独立可测试 |

---

## 8. LanguageTerminology 类型设计

```typescript
/** 语言特定术语映射，用于 LLM prompt 参数化 */
interface LanguageTerminology {
  /** 代码块语言标记（如 'typescript', 'python', 'go'） */
  codeBlockLanguage: string;
  /** "导出"概念的描述（如 "export 导出"、"public 公开函数"、"首字母大写的导出标识符"） */
  exportConcept: string;
  /** "导入"概念的描述（如 "import 导入"、"from...import"、"import 包路径"） */
  importConcept: string;
  /** 类型系统描述（如 "静态类型 + 接口"、"动态类型 + 类型注解(可选)"、"静态类型 + struct"） */
  typeSystemDescription: string;
  /** 接口/协议概念（如 "interface"、"Protocol/ABC"、"interface(隐式)"） */
  interfaceConcept: string;
  /** 模块系统描述（如 "ES Modules"、"Python packages"、"Go packages"） */
  moduleSystem: string;
}
```

TS/JS 的默认术语：

```typescript
const tsJsTerminology: LanguageTerminology = {
  codeBlockLanguage: 'typescript',
  exportConcept: 'export 导出的函数/类/类型',
  importConcept: 'import 导入',
  typeSystemDescription: '静态类型系统 + interface/type 别名',
  interfaceConcept: 'interface 接口',
  moduleSystem: 'ES Modules / CommonJS',
};
```

### TestPatterns 类型设计

```typescript
/** 测试文件匹配模式 */
interface TestPatterns {
  /** 测试文件名正则（如 /\.(test|spec)\.(ts|tsx|js|jsx)$/） */
  filePattern: RegExp;
  /** 测试目录名集合（如 ['__tests__', 'tests', 'test']） */
  testDirs: string[];
}
```

---

## 9. 实施建议

### 9.1 推荐实施顺序（增量步骤）

```
Step 1: 新增接口层（纯新增，零改动现有代码）
  └── 创建 src/adapters/ 目录
  └── 定义 LanguageAdapter, LanguageTerminology, TestPatterns 接口
  └── 实现 LanguageAdapterRegistry

Step 2: 封装 TsJsLanguageAdapter（提取现有逻辑，零行为变更）
  └── 从 ast-analyzer.ts 提取 TS/JS 特定逻辑
  └── 从 tree-sitter-fallback.ts 提取降级逻辑
  └── 从 dependency-graph.ts 提取 dependency-cruiser 逻辑
  └── 全量回归测试

Step 3: 扩展 CodeSkeleton 数据模型（纯扩展，前向兼容）
  └── 扩展 LanguageSchema, ExportKindSchema, MemberKindSchema
  └── 放宽 filePath 正则
  └── 运行全量测试验证兼容性

Step 4: 接入 Registry 路由（编排器层改造）
  └── ast-analyzer.ts → Registry 路由
  └── file-scanner.ts → 参数化
  └── single-spec-orchestrator.ts → 通过 Registry 获取语言信息
  └── batch-orchestrator.ts → 通过 Registry 路由依赖图构建

Step 5: 端到端验证
  └── golden-master 测试通过
  └── self-hosting 测试通过
  └── 所有现有单元测试通过
```

### 9.2 测试策略

| 测试类型 | 覆盖目标 | 数量估算 |
|---------|---------|---------|
| 单元测试 - LanguageAdapterRegistry | 注册、查找、冲突检测、重置 | ~8 个 |
| 单元测试 - TsJsLanguageAdapter | analyzeFile、analyzeFallback、getTerminology | ~12 个（大部分从现有 ast-analyzer.test.ts 迁移） |
| 单元测试 - CodeSkeleton 扩展 | 新枚举值验证、旧值兼容性 | ~6 个 |
| 集成测试 - Registry 路由 | 端到端流水线通过 Registry 路由 | ~4 个 |
| 回归测试 | 全量现有测试套件 | 现有 42 个测试文件全部通过 |

---

## 10. Constitution 约束验证

| 原则 | 合规性 | 说明 |
|------|-------|------|
| I. 信息完全来自 AST | 合规 | LanguageAdapter.analyzeFile 仍从 AST 提取 |
| II. 不确定性标记 | 合规 | 不影响 LLM 标记机制 |
| III. 机密脱敏 | 合规 | secret-redactor 逻辑不变 |
| IV. 100k token 预算 | 合规 | context-assembler 逻辑不变 |
| V. 指数退避 | 合规 | llm-client 重试逻辑不变 |
| VI. 基线骨架 | 合规 | CodeSkeleton 结构保持一致 |
| VII. 纯 Node.js 生态 | **合规** | 零新增依赖，全部使用 TypeScript 内置能力实现 |

---

## 11. 总结

Feature 025 的核心技术路径清晰：

1. **采用策略模式 + Registry** 作为 LanguageAdapter 抽象层的架构方案（方案 A）
2. **CodeSkeleton 模型采用纯扩展**策略，仅增不减，确保向后兼容
3. **零新增运行时依赖**，完全基于 TypeScript 内置能力实现
4. **TsJsLanguageAdapter 为零行为变更的封装重构**，所有现有测试必须通过
5. **file-scanner 和编排器参数化**通过 Registry 动态获取语言信息

主要风险集中在重构提取时的隐式行为变更（R2），通过全量回归测试和 golden-master 快照比对可有效缓解。
