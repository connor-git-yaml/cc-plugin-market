# API 契约: ScanResult 增强

**模块**: `src/utils/file-scanner.ts`
**Feature**: 031-multilang-mixed-project

## 接口定义

### LanguageFileStat

```typescript
export interface LanguageFileStat {
  adapterId: string;
  fileCount: number;
  extensions: string[];
}
```

### ScanResult（扩展）

```typescript
export interface ScanResult {
  files: string[];
  totalScanned: number;
  ignored: number;
  unsupportedExtensions?: Map<string, number>;
  languageStats?: Map<string, LanguageFileStat>;  // 新增
}
```

## 行为契约

### scanFiles()

**前置条件**:
- `LanguageAdapterRegistry` 已初始化（`bootstrapAdapters()` 已调用）
- 目标目录存在且可读

**后置条件**:
- `languageStats` 包含所有在 Registry 中有对应适配器的语言的文件统计
- `languageStats` 的 key 为 adapter.id（如 `'ts-js'`、`'python'`）
- `languageStats` 中每个 `LanguageFileStat.fileCount` 的总和等于 `files.length`
- `unsupportedExtensions` 中不包含已注册适配器声明的扩展名
- 当 `unsupportedExtensions` 非空时，输出包含语言名称的聚合警告到 stderr

**不变量**:
- `files` 返回类型不变（`string[]`）
- `files` 排序规则不变（字母序）
- 纯单语言项目时，`languageStats` 仍会填充（仅一个条目）

### 不支持语言的警告格式

```
⚠ 跳过 12 个 .rs 文件（Rust，不支持）、5 个 .cpp 文件（C++，不支持）
```

**规则**:
- 使用 `KNOWN_LANGUAGE_NAMES` 映射表将扩展名转换为语言名称
- 未在映射表中的扩展名，仅显示扩展名本身
- 警告信息中按文件数降序排列

## 与调用方的兼容性

| 调用方 | 是否使用 `languageStats` | 影响 |
|--------|:---------------------:|------|
| `single-spec-orchestrator.ts` | 否 | 无影响 |
| `batch-orchestrator.ts` | **是** | 新增消费方 |
| MCP `prepare` 工具 | **是** | 提取 `detectedLanguages` |
| MCP `generate` 工具 | 否 | 无影响 |
