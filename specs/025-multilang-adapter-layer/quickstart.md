---
feature: 025-multilang-adapter-layer
title: 快速上手指南
created: 2026-03-17
---

# 快速上手指南: 语言适配器抽象层

## 1. 概述

Feature 025 为 reverse-spec 引入了 LanguageAdapter 抽象层。对于**现有用户**，这是一个零感知升级——所有 TS/JS 功能保持不变。对于**适配器开发者**，本指南说明如何注册新语言适配器。

---

## 2. 现有用户：无需任何操作

升级到包含 Feature 025 的版本后，所有命令照常使用：

```bash
# 与以前完全一致
reverse-spec generate src/core
reverse-spec batch
reverse-spec diff specs/foo.spec.md src/foo
reverse-spec prepare src/utils
```

**变化**：
- 当目标目录中包含非 TS/JS 文件时，会在 stderr 输出跳过提示（以前是静默忽略）
- 错误消息中的"TS/JS 文件"改为"支持的源文件"

---

## 3. 适配器开发者：注册新语言

### 3.1 实现 LanguageAdapter 接口

```typescript
// src/adapters/python-adapter.ts（示例）
import type {
  LanguageAdapter,
  AnalyzeFileOptions,
  DependencyGraphOptions,
  LanguageTerminology,
  TestPatterns,
} from './language-adapter.js';
import type { CodeSkeleton } from '../models/code-skeleton.js';
import type { Language } from '../models/code-skeleton.js';

export class PythonLanguageAdapter implements LanguageAdapter {
  readonly id = 'python';
  readonly languages: readonly Language[] = ['python'];
  readonly extensions = new Set(['.py', '.pyi']);
  readonly defaultIgnoreDirs = new Set([
    '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache',
  ]);

  async analyzeFile(
    filePath: string,
    _options?: AnalyzeFileOptions,
  ): Promise<CodeSkeleton> {
    // 实现 Python AST 分析逻辑（如 tree-sitter-python）
    throw new Error('尚未实现');
  }

  async analyzeFallback(filePath: string): Promise<CodeSkeleton> {
    // 实现基于正则的 Python 降级解析
    throw new Error('尚未实现');
  }

  // buildDependencyGraph 可选，初始阶段可不实现

  getTerminology(): LanguageTerminology {
    return {
      codeBlockLanguage: 'python',
      exportConcept: '公开函数/类（public symbols, __all__）',
      importConcept: 'from...import / import 语句',
      typeSystemDescription: '动态类型 + 类型注解(可选, PEP 484)',
      interfaceConcept: 'Protocol / ABC 抽象基类',
      moduleSystem: 'Python packages（__init__.py）',
    };
  }

  getTestPatterns(): TestPatterns {
    return {
      filePattern: /(^test_.*\.py$|.*_test\.py$|^conftest\.py$)/,
      testDirs: ['tests', 'test'],
    };
  }
}
```

### 3.2 注册到 Registry

在 `src/adapters/index.ts` 的 `bootstrapAdapters()` 中添加一行：

```typescript
export function bootstrapAdapters(): void {
  const registry = LanguageAdapterRegistry.getInstance();
  if (registry.getAllAdapters().length > 0) return;

  registry.register(new TsJsLanguageAdapter());
  registry.register(new PythonLanguageAdapter());  // ← 新增一行
}
```

### 3.3 更新 CodeSkeleton filePath 正则（已知限制）

如果新适配器引入了 `filePath` 正则中尚未包含的扩展名，需要同步更新 `src/models/code-skeleton.ts`：

```typescript
// 确认新扩展名已包含在正则中
filePath: z.string().regex(
  /\.(ts|tsx|js|jsx|py|pyi|go|java|kt|kts|rs|cpp|cc|cxx|c|h|hpp|rb|swift)$/,
),
```

> **注意**：这是一个已知限制（research.md §9）。Feature 025 的 `filePath` 正则已预包含所有 Blueprint 规划中的语言扩展名，因此 Feature 028（Python）、029（Go）、030（Java）**无需修改此正则**。

### 3.4 完成！

无需修改：
- `src/utils/file-scanner.ts`（自动从 Registry 获取扩展名）
- `src/core/single-spec-orchestrator.ts`（自动通过 Registry 路由）
- `src/batch/batch-orchestrator.ts`（自动通过 Registry 路由）
- `src/core/context-assembler.ts`（自动从 skeleton.language 获取代码块标记）

---

## 4. 测试适配器

### 4.1 单元测试模板

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { PythonLanguageAdapter } from '../../src/adapters/python-adapter.js';

describe('PythonLanguageAdapter', () => {
  let registry: LanguageAdapterRegistry;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    registry = LanguageAdapterRegistry.getInstance();
    registry.register(new PythonLanguageAdapter());
  });

  afterEach(() => {
    LanguageAdapterRegistry.resetInstance();
  });

  it('应注册 .py 和 .pyi 扩展名', () => {
    expect(registry.getAdapter('foo.py')).not.toBeNull();
    expect(registry.getAdapter('types.pyi')).not.toBeNull();
    expect(registry.getAdapter('foo.ts')).toBeNull(); // 未注册 TS
  });

  it('应返回正确的术语映射', () => {
    const adapter = registry.getAdapter('foo.py')!;
    const terminology = adapter.getTerminology();
    expect(terminology.codeBlockLanguage).toBe('python');
    expect(terminology.moduleSystem).toContain('Python');
  });

  it('应返回正确的测试文件匹配模式', () => {
    const adapter = registry.getAdapter('foo.py')!;
    const patterns = adapter.getTestPatterns();
    expect(patterns.filePattern.test('test_foo.py')).toBe(true);
    expect(patterns.filePattern.test('foo_test.py')).toBe(true);
    expect(patterns.filePattern.test('conftest.py')).toBe(true);
    expect(patterns.filePattern.test('foo.py')).toBe(false);
  });
});
```

### 4.2 Mock 适配器测试（验证 Registry 路由）

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import type { LanguageAdapter } from '../../src/adapters/language-adapter.js';

// 最小化 mock 适配器
const mockAdapter: LanguageAdapter = {
  id: 'mock',
  languages: ['python' as any],
  extensions: new Set(['.mock']),
  defaultIgnoreDirs: new Set(['.mock-cache']),
  async analyzeFile() { throw new Error('mock'); },
  async analyzeFallback() { throw new Error('mock'); },
  getTerminology() {
    return {
      codeBlockLanguage: 'mock',
      exportConcept: 'mock export',
      importConcept: 'mock import',
      typeSystemDescription: 'mock types',
      interfaceConcept: 'mock interface',
      moduleSystem: 'mock modules',
    };
  },
  getTestPatterns() {
    return { filePattern: /\.test\.mock$/, testDirs: ['tests'] };
  },
};

describe('Registry 路由测试', () => {
  beforeEach(() => LanguageAdapterRegistry.resetInstance());
  afterEach(() => LanguageAdapterRegistry.resetInstance());

  it('应通过扩展名路由到 mock 适配器', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    registry.register(mockAdapter);
    expect(registry.getAdapter('example.mock')?.id).toBe('mock');
  });

  it('不支持的扩展名应返回 null', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    registry.register(mockAdapter);
    expect(registry.getAdapter('example.unknown')).toBeNull();
  });
});
```

---

## 5. 架构图速览

```
LanguageAdapter (接口)
    │
    ├── TsJsLanguageAdapter     ← 内置，Feature 025 实现
    ├── PythonLanguageAdapter    ← 未来 Feature 028
    ├── GoLanguageAdapter        ← 未来 Feature 029
    └── JavaLanguageAdapter      ← 未来 Feature 030

LanguageAdapterRegistry (单例)
    ├── register(adapter)            → 注册适配器
    ├── getAdapter(filePath)         → O(1) 扩展名查找
    ├── getSupportedExtensions()     → 聚合所有扩展名
    └── getDefaultIgnoreDirs()       → 聚合所有忽略目录

bootstrapAdapters()                  → CLI/MCP 启动时调用
```

---

## 6. 常见问题

### Q: 升级后 `npm test` 会不会失败？

不会。Feature 025 的核心约束是零行为变更。所有现有 42 个测试文件必须 100% 通过，这是验收条件 SC-001。

### Q: 旧版 baseline JSON 还能用吗？

可以。CodeSkeleton 数据模型变更是纯扩展（只增不减），旧版 JSON 中的值（如 `language: 'typescript'`）仍在新 schema 的合法范围内。

### Q: 为什么 `llm-client.ts` 的 prompt 还没参数化？

这属于 Feature 026（multilang-prompt-parameterize）的范围。Feature 025 仅建立 `LanguageTerminology` 契约，消费端的改造在 Feature 026 中实施。

### Q: 如果 Registry 没有注册任何适配器会怎样？

系统会在 `getAdapter()` 被调用时给出明确的错误信息："LanguageAdapterRegistry 中未注册任何适配器"。这不应在生产环境发生，因为 `bootstrapAdapters()` 在 CLI/MCP 启动时自动调用。

### Q: 新增语言后还需要手动更新哪些文件？

仅需：
1. 实现 `LanguageAdapter` 接口（新文件）
2. 在 `bootstrapAdapters()` 中添加 `registry.register()` 一行
3. 如果引入新扩展名（不在预置列表中），更新 `code-skeleton.ts` 的 `filePath` 正则

不需要修改 file-scanner、编排器或其他核心流水线文件。
