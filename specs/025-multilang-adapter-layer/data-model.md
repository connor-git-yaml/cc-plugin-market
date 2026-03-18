---
feature: 025-multilang-adapter-layer
title: 数据模型定义
created: 2026-03-17
---

# 数据模型定义: 语言适配器抽象层

## 1. 核心接口

### 1.1 LanguageAdapter

语言适配器的标准能力契约。每种编程语言支持需实现此接口。

```typescript
/**
 * 语言适配器接口
 * 定义一种编程语言支持所需的全部能力：文件分析、降级分析、
 * 依赖图构建（可选）、术语映射、测试文件模式。
 */
export interface LanguageAdapter {
  /** 适配器唯一标识（如 'ts-js', 'python', 'go'） */
  readonly id: string;

  /** 支持的语言列表（对应 CodeSkeleton.language 值） */
  readonly languages: readonly Language[];

  /**
   * 支持的文件扩展名集合（含前导点，小写）
   * 例：Set(['.ts', '.tsx', '.js', '.jsx'])
   */
  readonly extensions: ReadonlySet<string>;

  /**
   * 默认忽略目录集合（语言生态特有，如 node_modules、__pycache__）
   * 不包含通用忽略目录（如 .git），通用目录由 file-scanner 独立维护。
   */
  readonly defaultIgnoreDirs: ReadonlySet<string>;

  /**
   * AST 分析单个文件，返回结构化的 CodeSkeleton
   *
   * @param filePath - 源文件绝对路径
   * @param options - 分析选项（可选）
   * @returns CodeSkeleton
   * @throws FileNotFoundError 文件不存在时
   */
  analyzeFile(filePath: string, options?: AnalyzeFileOptions): Promise<CodeSkeleton>;

  /**
   * 正则降级分析
   * 当主分析器（如 ts-morph）不可用或解析失败时，提供基于正则的兜底分析。
   *
   * @param filePath - 源文件绝对路径
   * @returns 部分填充的 CodeSkeleton，parserUsed 标记为降级解析器
   */
  analyzeFallback(filePath: string): Promise<CodeSkeleton>;

  /**
   * 构建项目级依赖图（可选能力）
   * 并非所有语言在初始阶段都需要依赖图支持。
   *
   * @param projectRoot - 项目根目录
   * @param options - 构建选项（可选）
   * @returns DependencyGraph
   */
  buildDependencyGraph?(
    projectRoot: string,
    options?: DependencyGraphOptions,
  ): Promise<DependencyGraph>;

  /**
   * 返回该语言的术语映射
   * 用于 LLM prompt 的语言参数化（代码块标记、导出/导入概念等）。
   */
  getTerminology(): LanguageTerminology;

  /**
   * 返回该语言的测试文件匹配模式
   * 用于 secret-redactor 和 noise-filter 识别测试文件。
   */
  getTestPatterns(): TestPatterns;
}
```

### 1.2 AnalyzeFileOptions

文件分析选项。从现有 `ast-analyzer.ts` 的 `AnalyzeOptions` 统一。

```typescript
/**
 * 文件分析选项
 */
export interface AnalyzeFileOptions {
  /** 包含非导出符号（默认 false） */
  includePrivate?: boolean;
  /** 类继承层级最大解析深度（默认 5） */
  maxDepth?: number;
}
```

### 1.3 DependencyGraphOptions

依赖图构建选项。从现有 `dependency-graph.ts` 的 `GraphOptions` 统一。

```typescript
/**
 * 依赖图构建选项
 */
export interface DependencyGraphOptions {
  /** 用于过滤分析文件的 Glob 模式 */
  includeOnly?: string;
  /** 排除模式 */
  excludePatterns?: string[];
  /** 语言特定配置文件路径（如 tsconfig.json） */
  configPath?: string;
}
```

---

## 2. 辅助类型

### 2.1 LanguageTerminology

语言特定术语映射，用于 LLM prompt 参数化。

```typescript
/**
 * 语言特定术语映射
 * 每种语言对"导出"、"导入"等概念有不同的表达方式。
 * 此类型允许 LLM prompt 使用与目标语言一致的术语。
 */
export interface LanguageTerminology {
  /**
   * 代码块语言标记
   * 用于 Markdown 代码块的语言标识（如 'typescript', 'python', 'go'）
   */
  codeBlockLanguage: string;

  /**
   * "导出"概念的描述
   * 例：'export 导出的函数/类/类型'（TS/JS）
   * 例：'公开函数/类（public symbols）'（Python）
   * 例：'导出标识符（首字母大写）'（Go）
   */
  exportConcept: string;

  /**
   * "导入"概念的描述
   * 例：'import 导入'（TS/JS）
   * 例：'from...import / import 语句'（Python）
   * 例：'import 包路径'（Go）
   */
  importConcept: string;

  /**
   * 类型系统描述
   * 例：'静态类型系统 + interface/type 别名'（TypeScript）
   * 例：'动态类型 + 类型注解(可选)'（Python）
   * 例：'静态类型 + struct/interface'（Go）
   */
  typeSystemDescription: string;

  /**
   * 接口/协议概念
   * 例：'interface 接口'（TypeScript）
   * 例：'Protocol / ABC 抽象基类'（Python）
   * 例：'interface（隐式实现）'（Go）
   */
  interfaceConcept: string;

  /**
   * 模块系统描述
   * 例：'ES Modules / CommonJS'（TypeScript/JavaScript）
   * 例：'Python packages（__init__.py）'（Python）
   * 例：'Go packages（package 声明 + go.mod）'（Go）
   */
  moduleSystem: string;
}
```

### 2.2 TestPatterns

测试文件匹配模式，用于识别测试文件和测试目录。

```typescript
/**
 * 测试文件匹配模式
 * 用于 secret-redactor（测试文件中的敏感信息可获得宽松脱敏规则）
 * 和 noise-filter（测试文件中的 import 变更可视为低噪声）。
 */
export interface TestPatterns {
  /**
   * 测试文件名正则
   * 例：/\.(test|spec)\.(ts|tsx|js|jsx)$/（TS/JS）
   * 例：/(^test_.*\.py$|.*_test\.py$|^conftest\.py$)/（Python）
   */
  filePattern: RegExp;

  /**
   * 测试目录名集合
   * 例：['__tests__', 'tests', 'test']（TS/JS）
   * 例：['tests', 'test']（Python）
   */
  testDirs: readonly string[];
}
```

---

## 3. Registry

### 3.1 LanguageAdapterRegistry

全局适配器注册中心，维护"文件扩展名 → 适配器实例"的映射。

```typescript
/**
 * 语言适配器注册中心（单例）
 *
 * 职责：
 * - 维护文件扩展名到 LanguageAdapter 的映射（Map<string, LanguageAdapter>）
 * - 提供按文件路径查找适配器的能力（O(1) 查找）
 * - 聚合所有已注册适配器的元信息（支持的扩展名、忽略目录）
 * - 检测扩展名冲突（同一扩展名不允许被多个适配器注册）
 *
 * 生命周期：进程级单例，CLI 和 MCP 入口各自在启动时完成注册。
 */
export class LanguageAdapterRegistry {
  /** 单例实例 */
  private static instance: LanguageAdapterRegistry | null = null;

  /** 扩展名 → 适配器映射（key 为小写扩展名，如 '.ts'） */
  private extensionMap: Map<string, LanguageAdapter>;

  /** 已注册适配器有序列表 */
  private adapterList: LanguageAdapter[];

  private constructor() {
    this.extensionMap = new Map();
    this.adapterList = [];
  }

  /**
   * 获取或创建 Registry 单例
   */
  static getInstance(): LanguageAdapterRegistry {
    if (!LanguageAdapterRegistry.instance) {
      LanguageAdapterRegistry.instance = new LanguageAdapterRegistry();
    }
    return LanguageAdapterRegistry.instance;
  }

  /**
   * 重置单例（仅限测试使用）
   * 重置后下次 getInstance() 返回新的空白实例。
   */
  static resetInstance(): void {
    LanguageAdapterRegistry.instance = null;
  }

  /**
   * 注册语言适配器
   *
   * 将适配器声明的所有扩展名映射到该实例。
   * 如果某个扩展名已被另一个适配器注册，抛出 Error。
   *
   * @param adapter - LanguageAdapter 实例
   * @throws Error 扩展名冲突时
   */
  register(adapter: LanguageAdapter): void {
    for (const ext of adapter.extensions) {
      const normalizedExt = ext.toLowerCase();
      const existing = this.extensionMap.get(normalizedExt);
      if (existing) {
        throw new Error(
          `扩展名冲突: '${normalizedExt}' 已被适配器 '${existing.id}' 注册，` +
          `无法再注册到 '${adapter.id}'`,
        );
      }
      this.extensionMap.set(normalizedExt, adapter);
    }
    this.adapterList.push(adapter);
  }

  /**
   * 根据文件路径查找对应的语言适配器
   *
   * 提取文件扩展名（path.extname），转为小写后在 Map 中查找。
   *
   * @param filePath - 文件路径（绝对或相对均可）
   * @returns 匹配的适配器实例，无匹配时返回 null
   */
  getAdapter(filePath: string): LanguageAdapter | null {
    const ext = path.extname(filePath).toLowerCase();
    return this.extensionMap.get(ext) ?? null;
  }

  /**
   * 获取当前所有已注册的文件扩展名
   */
  getSupportedExtensions(): Set<string> {
    return new Set(this.extensionMap.keys());
  }

  /**
   * 聚合所有已注册适配器的默认忽略目录
   */
  getDefaultIgnoreDirs(): Set<string> {
    const dirs = new Set<string>();
    for (const adapter of this.adapterList) {
      for (const dir of adapter.defaultIgnoreDirs) {
        dirs.add(dir);
      }
    }
    return dirs;
  }

  /**
   * 获取所有已注册适配器列表（按注册顺序）
   */
  getAllAdapters(): readonly LanguageAdapter[] {
    return [...this.adapterList];
  }
}
```

---

## 4. TsJsLanguageAdapter 定义

### 4.1 类结构

```typescript
/**
 * TypeScript / JavaScript 语言适配器
 *
 * 将当前分散在 ast-analyzer.ts、tree-sitter-fallback.ts、dependency-graph.ts
 * 中的 TS/JS 专用逻辑聚合为一个内聚的适配器实例。
 *
 * 实现策略：委托（delegation）——调用现有函数，不复制代码。
 */
export class TsJsLanguageAdapter implements LanguageAdapter {
  readonly id = 'ts-js';

  readonly languages: readonly Language[] = ['typescript', 'javascript'];

  readonly extensions: ReadonlySet<string> = new Set([
    '.ts', '.tsx', '.js', '.jsx',
  ]);

  readonly defaultIgnoreDirs: ReadonlySet<string> = new Set([
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.next',
    '.nuxt',
  ]);

  /**
   * AST 分析（委托 ast-analyzer.ts 的 analyzeFile）
   */
  async analyzeFile(
    filePath: string,
    options?: AnalyzeFileOptions,
  ): Promise<CodeSkeleton> {
    // 委托到现有 ast-analyzer.analyzeFile()
    return analyzeFileInternal(filePath, options);
  }

  /**
   * 正则降级分析（委托 tree-sitter-fallback.ts 的 analyzeFallback）
   */
  async analyzeFallback(filePath: string): Promise<CodeSkeleton> {
    // 委托到现有 tree-sitter-fallback.analyzeFallback()
    return analyzeFallbackInternal(filePath);
  }

  /**
   * 依赖图构建（委托 dependency-graph.ts 的 buildGraph）
   */
  async buildDependencyGraph(
    projectRoot: string,
    options?: DependencyGraphOptions,
  ): Promise<DependencyGraph> {
    // 委托到现有 dependency-graph.buildGraph()
    return buildGraphInternal(projectRoot, {
      includeOnly: options?.includeOnly,
      excludePatterns: options?.excludePatterns,
      tsConfigPath: options?.configPath,
    });
  }

  /**
   * TS/JS 语言术语映射
   */
  getTerminology(): LanguageTerminology {
    return {
      codeBlockLanguage: 'typescript',
      exportConcept: 'export 导出的函数/类/类型',
      importConcept: 'import 导入',
      typeSystemDescription: '静态类型系统 + interface/type 别名',
      interfaceConcept: 'interface 接口',
      moduleSystem: 'ES Modules / CommonJS',
    };
  }

  /**
   * TS/JS 测试文件匹配模式
   */
  getTestPatterns(): TestPatterns {
    return {
      filePattern: /\.(test|spec)\.(ts|tsx|js|jsx)$/,
      testDirs: ['__tests__', 'tests', 'test', '__mocks__'],
    };
  }
}
```

### 4.2 术语值说明

| 字段 | 值 | 说明 |
|------|------|------|
| `codeBlockLanguage` | `'typescript'` | 与当前 context-assembler.ts 中硬编码的 `'typescript'` 一致 |
| `exportConcept` | `'export 导出的函数/类/类型'` | 与当前 llm-client.ts 中的术语风格一致 |
| `importConcept` | `'import 导入'` | 简洁中文描述 |
| `typeSystemDescription` | `'静态类型系统 + interface/type 别名'` | TypeScript 类型系统特征描述 |
| `interfaceConcept` | `'interface 接口'` | TypeScript 接口概念 |
| `moduleSystem` | `'ES Modules / CommonJS'` | JS/TS 同时支持两种模块系统 |

### 4.3 测试模式值说明

| 字段 | 值 | 说明 |
|------|------|------|
| `filePattern` | `/\.(test\|spec)\.(ts\|tsx\|js\|jsx)$/` | 与当前 secret-redactor.ts 的 `isTestFile` 正则一致 |
| `testDirs` | `['__tests__', 'tests', 'test', '__mocks__']` | 与当前 dependency-graph.ts 的 excludePatterns 一致 |

---

## 5. CodeSkeleton 数据模型扩展

### 5.1 LanguageSchema 扩展

```typescript
// 变更前（2 值）
export const LanguageSchema = z.enum(['typescript', 'javascript']);

// 变更后（10 值）
export const LanguageSchema = z.enum([
  // 现有值（不变）
  'typescript',
  'javascript',
  // 新增值（P0: 核心目标语言）
  'python',
  'go',
  'java',
  // 新增值（P1: 次优先级语言）
  'rust',
  'kotlin',
  'cpp',
  // 新增值（P2: 远期语言）
  'ruby',
  'swift',
]);

export type Language = z.infer<typeof LanguageSchema>;
```

### 5.2 ExportKindSchema 扩展

```typescript
// 变更前（7 值）
export const ExportKindSchema = z.enum([
  'function', 'class', 'interface', 'type', 'enum', 'const', 'variable',
]);

// 变更后（12 值）
export const ExportKindSchema = z.enum([
  // 现有值（不变）
  'function', 'class', 'interface', 'type', 'enum', 'const', 'variable',
  // 新增值
  'struct',       // Go struct, Rust struct, C/C++ struct
  'trait',        // Rust trait
  'protocol',     // Swift protocol, Python Protocol
  'data_class',   // Kotlin data class, Python dataclass
  'module',       // Python module, Ruby module
]);

export type ExportKind = z.infer<typeof ExportKindSchema>;
```

### 5.3 MemberKindSchema 扩展

```typescript
// 变更前（5 值）
export const MemberKindSchema = z.enum([
  'method', 'property', 'getter', 'setter', 'constructor',
]);

// 变更后（8 值）
export const MemberKindSchema = z.enum([
  // 现有值（不变）
  'method', 'property', 'getter', 'setter', 'constructor',
  // 新增值
  'classmethod',          // Python @classmethod
  'staticmethod',         // Python @staticmethod
  'associated_function',  // Rust impl 中无 &self 的函数
]);

export type MemberKind = z.infer<typeof MemberKindSchema>;
```

### 5.4 filePath 正则扩展

```typescript
// 变更前
filePath: z.string().regex(/\.(ts|tsx|js|jsx)$/),

// 变更后
filePath: z.string().regex(
  /\.(ts|tsx|js|jsx|py|pyi|go|java|kt|kts|rs|cpp|cc|cxx|c|h|hpp|rb|swift)$/,
),
```

**支持的扩展名对照表**：

| 语言 | 扩展名 |
|------|--------|
| TypeScript | `.ts`, `.tsx` |
| JavaScript | `.js`, `.jsx` |
| Python | `.py`, `.pyi` |
| Go | `.go` |
| Java | `.java` |
| Kotlin | `.kt`, `.kts` |
| Rust | `.rs` |
| C/C++ | `.cpp`, `.cc`, `.cxx`, `.c`, `.h`, `.hpp` |
| Ruby | `.rb` |
| Swift | `.swift` |

### 5.5 向后兼容性约束

所有变更均为**纯扩展（只增不减）**：

- 现有枚举值 `'typescript'`、`'javascript'` 等不变
- 现有枚举值 `'function'`、`'class'`、`'method'` 等不变
- 旧 filePath 正则匹配的扩展名（`.ts`/`.tsx`/`.js`/`.jsx`）仍匹配新正则
- 旧版 CodeSkeleton baseline JSON 可被新版 schema 成功 `parse()`

---

## 6. bootstrapAdapters() 注册入口

```typescript
/**
 * 启动适配器注册
 * 在 CLI/MCP 入口最早时机调用，完成所有内置适配器的注册。
 * 幂等：如果已有适配器注册则跳过。
 */
export function bootstrapAdapters(): void {
  const registry = LanguageAdapterRegistry.getInstance();

  // 幂等检查：防止重复注册
  if (registry.getAllAdapters().length > 0) {
    return;
  }

  registry.register(new TsJsLanguageAdapter());

  // 未来扩展点：
  // registry.register(new PythonLanguageAdapter());
  // registry.register(new GoLanguageAdapter());
  // registry.register(new JavaLanguageAdapter());
}
```

---

## 7. ScanResult 扩展

```typescript
export interface ScanResult {
  /** 发现的文件路径列表（相对于扫描目录，排序后） */
  files: string[];
  /** 扫描的总文件数（含被忽略的） */
  totalScanned: number;
  /** 被忽略的文件数 */
  ignored: number;
  /** 不支持的文件扩展名统计（新增） */
  unsupportedExtensions?: Map<string, number>;
}
```

---

## 8. 类型导出汇总

`src/adapters/index.ts` 的导出清单：

```typescript
// 接口与类型
export type { LanguageAdapter } from './language-adapter.js';
export type { LanguageTerminology } from './language-adapter.js';
export type { TestPatterns } from './language-adapter.js';
export type { AnalyzeFileOptions } from './language-adapter.js';
export type { DependencyGraphOptions } from './language-adapter.js';

// Registry
export { LanguageAdapterRegistry } from './language-adapter-registry.js';

// 具体适配器
export { TsJsLanguageAdapter } from './ts-js-adapter.js';

// 启动注册
export { bootstrapAdapters } from './bootstrap.js';
```
