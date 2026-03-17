# API Contract: JavaLanguageAdapter

**Feature**: 030-java-language-adapter
**Date**: 2026-03-17

---

## 接口契约

### JavaLanguageAdapter 类签名

```typescript
// src/adapters/java-adapter.ts

import type { CodeSkeleton, Language } from '../models/code-skeleton.js';
import type {
  LanguageAdapter,
  AnalyzeFileOptions,
  LanguageTerminology,
  TestPatterns,
} from './language-adapter.js';
import { TreeSitterAnalyzer } from '../core/tree-sitter-analyzer.js';
import { analyzeFallback as treeSitterFallback } from '../core/tree-sitter-fallback.js';

export class JavaLanguageAdapter implements LanguageAdapter {
  readonly id: 'java';
  readonly languages: readonly Language[];     // ['java']
  readonly extensions: ReadonlySet<string>;    // Set(['.java'])
  readonly defaultIgnoreDirs: ReadonlySet<string>;
  // Set(['target', 'build', 'out', '.gradle', '.idea', '.settings', '.mvn'])

  analyzeFile(filePath: string, options?: AnalyzeFileOptions): Promise<CodeSkeleton>;
  analyzeFallback(filePath: string): Promise<CodeSkeleton>;
  getTerminology(): LanguageTerminology;
  getTestPatterns(): TestPatterns;
}
```

---

### 方法契约

#### `analyzeFile(filePath, options?)`

**委托目标**: `TreeSitterAnalyzer.getInstance().analyze(filePath, 'java', { includePrivate: options?.includePrivate })`

**前置条件**:
- `filePath` 为 `.java` 文件的绝对路径
- 文件存在且可读

**后置条件**:
- 返回 `CodeSkeleton`，`language === 'java'`，`parserUsed === 'tree-sitter'`
- `exports` 包含文件中所有符合可见性过滤的顶层类型声明和成员
- `imports` 包含所有 import 声明（普通 import、static import、通配 import）
- 当 `includePrivate === false`（默认）时，排除 private 成员

**异常行为**:
- 文件不存在时抛出 `Error`
- tree-sitter grammar 加载失败时抛出 `Error`（由 TreeSitterAnalyzer 处理）

---

#### `analyzeFallback(filePath)`

**委托目标**: `treeSitterFallback(filePath)` from `src/core/tree-sitter-fallback.ts`

**前置条件**:
- `filePath` 为 `.java` 文件的绝对路径
- 通常在 `analyzeFile()` 失败后调用，但也可独立调用

**后置条件**:
- 返回 `CodeSkeleton`，`language === 'java'`
- 优先尝试 tree-sitter AST 解析；失败则降级到 Java 专用正则提取
- 正则降级至少提取 `public class`、`public interface`、`public enum`、`import` 声明

---

#### `getTerminology()`

**返回值契约**:

```typescript
{
  codeBlockLanguage: 'java',
  exportConcept: 'public 类和成员——通过 public/protected/private/package-private 访问修饰符控制可见性',
  importConcept: 'import 导入（含 static import 和通配 import）',
  typeSystemDescription: '静态强类型系统（泛型 + 类型擦除）',
  interfaceConcept: 'interface（含 default method）和 abstract class',
  moduleSystem: 'package/import 系统 + JPMS（Java Platform Module System）',
}
```

---

#### `getTestPatterns()`

**返回值契约**:

```typescript
{
  filePattern: /^(.*Test|Test.*|.*Tests|.*IT)\.java$/,
  testDirs: ['src/test/java'],
}
```

**匹配行为**:

| 输入 | 期望结果 |
|------|---------|
| `UserServiceTest.java` | 匹配 |
| `TestUserService.java` | 匹配 |
| `UserServiceTests.java` | 匹配 |
| `UserServiceIT.java` | 匹配 |
| `UserService.java` | 不匹配 |
| `Main.java` | 不匹配 |
| `path/to/UserServiceTest.java` | 匹配 |

---

### bootstrapAdapters() 修改契约

```typescript
// src/adapters/index.ts 修改点

// 新增导入
import { JavaLanguageAdapter } from './java-adapter.js';

// 新增导出
export { JavaLanguageAdapter } from './java-adapter.js';

// bootstrapAdapters() 中新增注册
export function bootstrapAdapters(): void {
  const registry = LanguageAdapterRegistry.getInstance();
  if (registry.getAllAdapters().length > 0) return;

  registry.register(new TsJsLanguageAdapter());
  registry.register(new PythonLanguageAdapter());
  registry.register(new GoLanguageAdapter());
  registry.register(new JavaLanguageAdapter()); // 新增
}
```

**注册后行为**:
- `registry.getAdapter('Example.java')` 返回 `JavaLanguageAdapter` 实例
- `registry.getSupportedExtensions()` 包含 `'.java'`
- `registry.getDefaultIgnoreDirs()` 包含 `target`, `build`, `out`, `.gradle`, `.idea`, `.settings`, `.mvn`
- 不与其他适配器的扩展名冲突（`.java` 是 Java 独有扩展名）

---

### tree-sitter-fallback.ts 修改契约

```typescript
// regexFallback() 中的语言分支扩展

// exports 提取 — 新增 Java 分支
const exports = language === 'python'
  ? extractPythonExportsFromText(content)
  : language === 'go'
    ? extractGoExportsFromText(content)
    : language === 'java'
      ? extractJavaExportsFromText(content)  // 新增
      : extractExportsFromText(content);

// imports 提取 — 新增 Java 分支
const imports = language === 'python'
  ? extractPythonImportsFromText(content)
  : language === 'go'
    ? extractGoImportsFromText(content)
    : language === 'java'
      ? extractJavaImportsFromText(content)  // 新增
      : extractImportsFromText(content);
```

#### `extractJavaExportsFromText(content)`

**正则模式**:
- `public class <Name>` / `public abstract class <Name>` / `public final class <Name>`
- `public interface <Name>`
- `public enum <Name>`

**行为**:
- 仅提取 `public` 修饰的顶层类型声明
- 返回 `ExportSymbol[]`，每个元素的 `signature` 前缀为 `[REGEX]`
- 不提取 `record`（CL-001 决策）
- 忽略缩进行（排除内部类）

#### `extractJavaImportsFromText(content)`

**正则模式**:
- `import <path>.<ClassName>;` -> `{ moduleSpecifier: '<path>', namedImports: ['<ClassName>'] }`
- `import static <path>.<ClassName>.<member>;` -> `{ moduleSpecifier: '<path>.<ClassName>', namedImports: ['<member>'] }`
- `import <path>.*;` -> `{ moduleSpecifier: '<path>', namedImports: ['*'] }`

**行为**:
- 所有 Java import 的 `isRelative` 为 `false`
- 所有 Java import 的 `isTypeOnly` 为 `false`
