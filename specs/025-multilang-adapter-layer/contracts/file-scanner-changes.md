---
feature: 025-multilang-adapter-layer
title: file-scanner 变更契约
created: 2026-03-17
---

# file-scanner 变更契约

## 1. 变更概述

`src/utils/file-scanner.ts` 从硬编码的 TS/JS 支持改为 Registry 驱动的动态语言支持。

## 2. 接口变更

### 2.1 ScanOptions

```typescript
// 变更前
export interface ScanOptions {
  projectRoot?: string;
  extraIgnorePatterns?: string[];
}

// 变更后
export interface ScanOptions {
  projectRoot?: string;
  extraIgnorePatterns?: string[];
  extensions?: Set<string>;  // 新增：覆盖 Registry 默认扩展名
}
```

### 2.2 ScanResult

```typescript
// 变更前
export interface ScanResult {
  files: string[];
  totalScanned: number;
  ignored: number;
}

// 变更后
export interface ScanResult {
  files: string[];
  totalScanned: number;
  ignored: number;
  unsupportedExtensions?: Map<string, number>;  // 新增
}
```

## 3. 行为变更

### 3.1 扩展名获取

```
变更前：
  const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);  // 模块级常量

变更后：
  function getSupportedExtensions(options?: ScanOptions): Set<string> {
    if (options?.extensions) return options.extensions;  // 调用方覆盖
    return LanguageAdapterRegistry.getInstance().getSupportedExtensions();  // Registry 动态
  }
```

### 3.2 忽略目录获取

```
变更前：
  const DEFAULT_IGNORE_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt',
  ]);

变更后：
  // 通用忽略目录（与语言无关，始终忽略）
  const UNIVERSAL_IGNORE_DIRS = new Set(['.git', 'coverage']);

  function getIgnoreDirs(): Set<string> {
    const registryDirs = LanguageAdapterRegistry.getInstance().getDefaultIgnoreDirs();
    return new Set([...UNIVERSAL_IGNORE_DIRS, ...registryDirs]);
  }
```

### 3.3 不支持文件提示

```
变更前：
  静默忽略不支持的文件扩展名

变更后：
  收集不支持的文件扩展名统计 → unsupportedExtensions
  在 scanFiles() 返回前，如果 unsupportedExtensions.size > 0:
    console.warn(`跳过 ${count} 个不支持的文件（${extensions}）`);
```

**输出示例**：
```
⚠ 跳过 3 个 .py 文件, 2 个 .go 文件（不支持的语言）
```

## 4. 等价性验证

当 Registry 仅注册 TsJsLanguageAdapter 时：

| 行为 | 变更前 | 变更后 | 一致性 |
|------|-------|-------|:------:|
| 扫描 .ts 文件 | 包含 | 包含 | PASS |
| 扫描 .tsx 文件 | 包含 | 包含 | PASS |
| 扫描 .js 文件 | 包含 | 包含 | PASS |
| 扫描 .jsx 文件 | 包含 | 包含 | PASS |
| 扫描 .py 文件 | 忽略（静默） | 忽略（+warn） | 输出有差异但文件列表一致 |
| 忽略 node_modules | 忽略 | 忽略 | PASS |
| 忽略 .git | 忽略 | 忽略 | PASS |
| 忽略 dist | 忽略 | 忽略 | PASS |
| 忽略 .next | 忽略 | 忽略 | PASS |
| .gitignore 规则 | 遵循 | 遵循 | PASS |

**唯一差异**：对不支持的文件扩展名新增 warn 日志到 stderr。这不影响 stdout 输出和 ScanResult.files 内容。
