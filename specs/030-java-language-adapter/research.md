# Technical Research: Java LanguageAdapter 实现

**Feature**: 030-java-language-adapter
**Date**: 2026-03-17
**Research Mode**: codebase-scan

---

## 决策 R-001: 适配器实现模式

**Decision**: 采用与 GoLanguageAdapter / PythonLanguageAdapter 完全同构的委托模式。

**Rationale**:
- GoLanguageAdapter（73 行）和 PythonLanguageAdapter（80 行）已验证此模式的可行性和简洁性
- `analyzeFile()` 委托 `TreeSitterAnalyzer.getInstance().analyze(filePath, 'java', { includePrivate })`
- `analyzeFallback()` 委托 `analyzeFallback(filePath)` from `tree-sitter-fallback.ts`
- JavaMapper（482 行）已在 Feature 027 中完整实现并注册到 TreeSitterAnalyzer
- 无需新增任何抽象层或中间组件

**Alternatives**:
1. **直接在 JavaMapper 上增加适配器方法** -- 拒绝：违反单一职责原则，Mapper 负责 AST 映射，Adapter 负责聚合和路由
2. **通过配置驱动而非代码** -- 拒绝：当前架构基于类实例注册，配置驱动需要重构 Registry，收益不足

---

## 决策 R-002: Java 正则降级提取策略

**Decision**: 在 `tree-sitter-fallback.ts` 中新增 `extractJavaExportsFromText()` 和 `extractJavaImportsFromText()` 两个函数，遵循 Python/Go 正则降级的同构模式。

**Rationale**:
- 当前 Java 文件在正则降级时错误地使用 TS/JS 正则（`extractExportsFromText`），因为 `regexFallback()` 中没有 `language === 'java'` 分支
- Java 的导出概念与 TS/JS 完全不同：Java 使用 `public class/interface/enum` 而非 `export`
- Java 的导入语法也不同：`import java.util.List;` 而非 `import { List } from 'java/util'`
- 降级提取仅覆盖最常见模式（FR-018 MUST）：`public class <Name>`、`public interface <Name>`、`public enum <Name>`、`import <path>;`
- 不覆盖 `record`（CL-001 决策：降级模式以最小可用为原则）

**Alternatives**:
1. **不实现 Java 正则降级** -- 拒绝：违反 FR-017/FR-018 MUST 级别要求
2. **使用通用正则覆盖所有语言** -- 拒绝：各语言语法差异太大，通用正则无法有效提取

---

## 决策 R-003: `defaultIgnoreDirs` 目录集合

**Decision**: 包含 7 个目录：`target`、`build`、`out`、`.gradle`（MUST）+ `.idea`、`.settings`、`.mvn`（SHOULD）。

**Rationale**:
- `target`: Maven 构建输出目录，包含 `.class` 文件和打包产物
- `build`: Gradle 构建输出目录
- `out`: IntelliJ IDEA 编译输出目录
- `.gradle`: Gradle 缓存和包装器目录
- `.idea`: IntelliJ IDEA 项目配置（非源码）
- `.settings`: Eclipse 项目配置（非源码）
- `.mvn`: Maven Wrapper 目录（含 jar 文件）
- 注意 `build` 同时出现在 TsJsLanguageAdapter 中（作为前端构建输出），但由于 `getDefaultIgnoreDirs()` 返回的是合集（Set），不会产生重复

**Alternatives**:
1. **仅含 MUST 级别 4 个目录** -- 可行但不推荐：额外 3 个目录的成本为零，收益为减少用户手动配置
2. **包含 `gradle/` 目录** -- 不包含：`gradle/` 是 Gradle Wrapper 脚本目录，通常包含 `gradlew`、`gradlew.bat`，虽非源码但也非构建产物，排除可能引起意外

---

## 决策 R-004: 测试文件模式正则设计

**Decision**: `filePattern` 使用 `/^(.*Test|Test.*|.*Tests|.*IT)\.java$/`。

**Rationale**:
- 覆盖 Java 社区四种标准测试命名约定：
  - `*Test.java`（JUnit 默认约定，最常见）
  - `Test*.java`（部分团队偏好）
  - `*Tests.java`（Spring Boot 测试约定）
  - `*IT.java`（集成测试约定，Maven Failsafe Plugin 默认）
- `^.*` 前缀确保兼容含路径的输入（CL-002 决策），与 Go 适配器 `^.*_test\.go$` 一致
- `testDirs` 设为 `['src/test/java']`——Maven/Gradle 标准测试源码目录

**Alternatives**:
1. **仅匹配 `*Test.java`** -- 拒绝：遗漏 `Test*`、`*Tests`、`*IT` 三种常见约定
2. **添加 `*Spec.java`（Spock 测试约定）** -- 暂不包含：Spock 是 Groovy 框架，`.java` 文件中不常见，未来可增量添加
3. **添加 `*TestCase.java`** -- 暂不包含：JUnit 3 遗留约定，现代 Java 项目中极少使用

---

## 决策 R-005: 术语映射内容

**Decision**: 使用 Java 社区标准术语，覆盖 FR-019 全部 6 个字段。

**Rationale**:
- `exportConcept`: Java 没有 `export` 关键字，使用"public 类和成员——通过 public/protected/private/package-private 访问修饰符控制可见性"
- `importConcept`: "import 导入（含 static import 和通配 import）"
- `typeSystemDescription`: "静态强类型系统（泛型 + 类型擦除）"
- `interfaceConcept`: "interface（含 default method）和 abstract class"
- `moduleSystem`: "package/import 系统 + JPMS（Java Platform Module System）"
- 这些术语映射用于 LLM prompt 参数化，使生成的 spec 文档符合 Java 开发者习惯

**Alternatives**:
1. **直接复用 TS/JS 术语** -- 拒绝：Java 的模块系统和可见性体系与 TS/JS 完全不同，生成的文档会对 Java 开发者产生误导

---

## 决策 R-006: `regexFallback()` 中的语言分支扩展方式

**Decision**: 在现有 `regexFallback()` 函数的 `exports` 和 `imports` 三元表达式链中追加 `language === 'java'` 分支。

**Rationale**:
- 当前代码结构为链式三元表达式：
  ```typescript
  const exports = language === 'python'
    ? extractPythonExportsFromText(content)
    : language === 'go'
      ? extractGoExportsFromText(content)
      : extractExportsFromText(content); // TS/JS 默认
  ```
- 在 `language === 'go'` 分支后追加 `language === 'java'` 分支，默认 fallback 仍为 TS/JS
- 保持与 Python/Go 完全一致的扩展模式
- `imports` 部分同理

**Alternatives**:
1. **使用 Map/Record 查表模式** -- 重构现有代码结构，超出本 Feature 范围，属于优化改进可在后续 Feature 处理
2. **在 `analyzeFallback()` 入口而非 `regexFallback()` 内部分支** -- 拒绝：Java 的 `analyzeFallback()` 应先尝试 tree-sitter 再降级正则，入口函数不应直接走正则
