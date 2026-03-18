# Quickstart: Java LanguageAdapter 实现

**Feature**: 030-java-language-adapter
**Date**: 2026-03-17

---

## 前置条件

- Feature 025（LanguageAdapter 接口）已完成
- Feature 027（tree-sitter 多语言后端 + JavaMapper）已完成
- 开发分支：`030-java-language-adapter`

## 快速实现指南

### Step 1: 创建 JavaLanguageAdapter（约 90 行）

创建 `src/adapters/java-adapter.ts`，以 `src/adapters/go-adapter.ts`（73 行）为模板。

关键实现点：
1. `id = 'java'`
2. `languages = ['java']`
3. `extensions = new Set(['.java'])`
4. `defaultIgnoreDirs = new Set(['target', 'build', 'out', '.gradle', '.idea', '.settings', '.mvn'])`
5. `analyzeFile()` 委托 `TreeSitterAnalyzer.getInstance().analyze(filePath, 'java', { includePrivate })`
6. `analyzeFallback()` 委托 `treeSitterFallback(filePath)`
7. `getTerminology()` 返回 Java 术语映射
8. `getTestPatterns()` 返回 `{ filePattern: /^(.*Test|Test.*|.*Tests|.*IT)\.java$/, testDirs: ['src/test/java'] }`

### Step 2: 注册到 bootstrapAdapters()

修改 `src/adapters/index.ts`：
1. 添加 `import { JavaLanguageAdapter } from './java-adapter.js';`
2. 添加 `export { JavaLanguageAdapter } from './java-adapter.js';`
3. 在 `bootstrapAdapters()` 中添加 `registry.register(new JavaLanguageAdapter());`

### Step 3: 新增 Java 正则降级提取

修改 `src/core/tree-sitter-fallback.ts`：
1. 新增 `extractJavaExportsFromText(content)` 函数（参考 `extractGoExportsFromText`）
2. 新增 `extractJavaImportsFromText(content)` 函数（参考 `extractGoImportsFromText`）
3. 在 `regexFallback()` 的 exports/imports 三元链中追加 `language === 'java'` 分支

### Step 4: 编写测试（约 300 行，15+ 用例）

创建 `tests/adapters/java-adapter.test.ts`，以 `tests/adapters/go-adapter.test.ts`（262 行）为模板。

测试分组：
1. **静态属性测试**: id、languages、extensions、defaultIgnoreDirs、接口方法存在性
2. **analyzeFile 测试**: Basic.java（class/interface/enum）、Generics.java（泛型）、Modifiers.java（修饰符）、Record.java（record 类型）、empty.java（空文件）
3. **import 解析测试**: 普通 import、static import（如果 fixture 包含）、通配 import（如果 fixture 包含）
4. **Registry 集成测试**: getAdapter('.java') 路由、无扩展名冲突、getDefaultIgnoreDirs 合集
5. **analyzeFallback 测试**: 对 Java 文件返回有效 CodeSkeleton
6. **getTerminology 测试**: 所有 6 个字段值验证
7. **getTestPatterns 测试**: 匹配 4 种命名约定 + 不匹配非测试文件

### Step 5: 验证

```bash
# 运行全部测试（确认零回归）
npm test

# 运行 lint
npm run lint

# 可选：手动验证
npx tsx src/cli/index.ts generate tests/fixtures/multilang/java/Basic.java
```

## 参考文件

| 文件 | 用途 |
|------|------|
| `src/adapters/go-adapter.ts` | 适配器实现模板（73 行） |
| `src/adapters/python-adapter.ts` | 适配器实现模板（80 行） |
| `tests/adapters/go-adapter.test.ts` | 测试模板（262 行） |
| `src/core/tree-sitter-fallback.ts` | 正则降级扩展位置 |
| `src/adapters/index.ts` | 注册入口（第 48 行注释占位） |
| `tests/fixtures/multilang/java/` | Java 测试 fixture（5 个文件，Feature 027 创建） |
| `src/core/query-mappers/java-mapper.ts` | JavaMapper 已完成实现（482 行，仅阅读参考） |
