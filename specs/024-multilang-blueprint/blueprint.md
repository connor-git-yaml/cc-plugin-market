# Blueprint: reverse-spec 多语言支持

> 编号: 024 | 状态: **active** | 创建: 2026-03-16

## 背景与动机

reverse-spec 当前是纯 TypeScript/JavaScript 专用工具。面对由 Python、Java、Go、Rust、C++ 等多语言组成的混合项目时，所有非 JS/TS 文件会被**静默忽略**，用户无任何提示。

这严重限制了 reverse-spec 的适用范围。技术调研确认：通过 tree-sitter（WASM 版）可实现统一的多语言 AST 解析，业界（GitHub、Sourcegraph）已充分验证。

## 目标

将 reverse-spec 从"JS/TS 专用"升级为"多语言通用"的逆向 Spec 生成工具，优先支持 Python、Go、Java。

## 硬编码瓶颈清单（调研结论）

| # | 文件 | 问题 | 影响 |
|---|------|------|------|
| 1 | `code-skeleton.ts` | `LanguageSchema` 仅 2 值、`filePath` 正则锁死、`ExportKind` 缺少 struct/trait | 数据模型层面阻断 |
| 2 | `ast-analyzer.ts` | 100% 依赖 ts-morph | 无法解析任何非 JS/TS 文件 |
| 3 | `file-scanner.ts` | 扩展名白名单 + JS/TS 忽略目录 | 非 JS/TS 文件被静默跳过 |
| 4 | `dependency-graph.ts` | dependency-cruiser 仅支持 JS/TS | 跨语言依赖图不可用 |
| 5 | `tree-sitter-fallback.ts` | 名为 tree-sitter 实为正则，且仅匹配 JS/TS 语法 | 降级方案也无法处理其他语言 |
| 6 | `context-assembler.ts` | 硬编码 ` ```typescript ` 代码块标记 | LLM 收到错误语言提示 |
| 7 | `llm-client.ts` | prompt 写死 "TypeScript 代码块"、"导出" 等术语 | 非 TS 代码分析质量下降 |

## Feature 分解

本 Blueprint 拆分为以下 Feature，按依赖顺序排列：

---

### Feature 1: 语言适配器抽象层（LanguageAdapter）
- **编号**: 025-multilang-adapter-layer
- **优先级**: P0（基础设施，后续所有 Feature 的前置）
- **预估改动量**: 大

**范围**:
1. 定义 `LanguageAdapter` 接口（`analyzeFile`、`buildDependencyGraph`、`getTerminology`、`getTestPatterns`、`analyzeFallback`）
2. 实现 `LanguageAdapterRegistry`（按文件扩展名路由到对应适配器）
3. 扩展 `CodeSkeleton` 数据模型：
   - `LanguageSchema` 添加 `python`、`go`、`java`、`rust`、`kotlin`、`cpp`、`ruby`、`swift`
   - `ExportKindSchema` 添加 `struct`、`trait`、`protocol`、`data_class`、`module`
   - `MemberKindSchema` 添加 `classmethod`、`staticmethod`、`associated_function`
   - `filePath` 正则放宽为支持所有语言扩展名
4. 将现有 TS/JS 全部逻辑封装为 `TsJsLanguageAdapter`（零行为变更）
5. `file-scanner.ts` 的 `SUPPORTED_EXTENSIONS` 和 `DEFAULT_IGNORE_DIRS` 参数化
6. `single-spec-orchestrator.ts` 和 `batch-orchestrator.ts` 改为通过 Registry 路由

**验收标准**:
- 现有 TS/JS 功能零回归（所有现有测试通过）
- 新增语言适配器时只需实现接口 + 注册，无需修改核心流程
- `scanFiles` 支持传入扩展名参数

**依赖**: 无

---

### Feature 2: LLM Prompt 与上下文语言参数化
- **编号**: 026-multilang-prompt-parameterize
- **优先级**: P0（与 Feature 1 并行）
- **预估改动量**: 中

**范围**:
1. `context-assembler.ts` 中 ` ```typescript ` 改为 `skeleton.language` 动态标记
2. `llm-client.ts` 的 `buildSystemPrompt` 接受 `languageHint` 参数
3. 定义 `LanguageTerminology` 类型（`exportConcept`、`importConcept`、`typeSystemDescription`、`interfaceConcept`、`codeBlockLanguage`）
4. prompt 中所有 "TypeScript 代码块"、"导出函数/类/类型" 等硬编码术语替换为模板变量
5. `semantic-diff.ts` 中代码块语言标记动态化
6. `noise-filter.ts` 和 `secret-redactor.ts` 中的 JS/TS 测试文件检测扩展为多语言

**验收标准**:
- TS/JS 项目的 prompt 输出与修改前完全一致
- 传入 `python` 时 prompt 正确使用 "公开函数/类"、"import/from...import" 等术语
- 代码块标记与文件实际语言一致

**依赖**: Feature 1（`LanguageTerminology` 类型定义）

---

### Feature 3: 引入 tree-sitter 作为多语言解析后端
- **编号**: 027-multilang-tree-sitter-backend
- **优先级**: P0
- **预估改动量**: 大

**范围**:
1. 引入 `web-tree-sitter`（WASM 版）作为依赖
2. 移除未使用的 `tree-sitter` + `tree-sitter-typescript` 原生依赖
3. 重写 `tree-sitter-fallback.ts` 为真正的 tree-sitter 解析器（`TreeSitterAnalyzer`）
4. 为每种目标语言编写 `.scm` 查询文件（提取函数签名、类定义、import、类型定义）
5. 实现 grammar WASM 文件管理（按需加载、版本锁定）
6. 建立 tree-sitter 查询 → `CodeSkeleton` 的映射层

**验收标准**:
- `TreeSitterAnalyzer` 可解析 Python、Go、Java 文件并生成有效 `CodeSkeleton`
- TS/JS 仍优先使用 ts-morph，tree-sitter 仅作降级
- grammar WASM 文件随 npm 包分发，无需用户额外安装

**依赖**: Feature 1（`LanguageAdapter` 接口 + `CodeSkeleton` 扩展模型）

---

### Feature 4: Python 语言适配器
- **编号**: 028-multilang-python-adapter
- **优先级**: P0（第一种新语言，验证架构）
- **预估改动量**: 中

**范围**:
1. 实现 `PythonLanguageAdapter`：
   - `analyzeFile`: 基于 tree-sitter-python 提取类、函数、装饰器、`__all__`、类型注解
   - `buildDependencyGraph`: 解析 `import`/`from...import` 语句 + 相对导入路径解析
   - `getTerminology`: Python 特有术语（"公开符号"、"类型注解(可选)"、"Protocol/ABC"）
   - `getTestPatterns`: `test_*.py`、`*_test.py`、`conftest.py`
   - `analyzeFallback`: Python import/def/class 正则降级
2. `.scm` 查询文件：`queries/python.scm`
3. 处理 Python 特有概念：
   - `__init__.py` 的包结构和隐式 re-export
   - 装饰器（`@property`、`@staticmethod`、`@classmethod`）
   - 动态类型下的类型注解提取
4. 默认忽略目录：`__pycache__`、`.venv`、`venv`、`.tox`、`.mypy_cache`

**验收标准**:
- 对标准 Python 项目（如 Flask/Django 模块）能生成完整 spec
- import 依赖图准确度 ≥ 80%（不含动态 import）
- `__init__.py` re-export 正确处理

**依赖**: Feature 1 + Feature 3

---

### Feature 5: Go 语言适配器
- **编号**: 029-multilang-go-adapter
- **优先级**: P1
- **预估改动量**: 中

**范围**:
1. 实现 `GoLanguageAdapter`：
   - `analyzeFile`: 基于 tree-sitter-go 提取 func、struct、interface、type、const
   - `buildDependencyGraph`: 调用 `go list -json ./...`（原生完美支持）+ 降级为 import 语句解析
   - `getTerminology`: Go 特有术语（"导出标识符(首字母大写)"、"接口 interface"）
   - `getTestPatterns`: `*_test.go`
   - `analyzeFallback`: Go func/type/import 正则降级
2. `.scm` 查询文件：`queries/go.scm`
3. 处理 Go 特有概念：
   - 首字母大小写 = 公开/私有
   - struct + method receiver = "类"
   - interface 隐式实现
   - 多返回值签名

**验收标准**:
- 对标准 Go 项目能生成完整 spec
- `go list` 可用时依赖图 100% 准确；不可用时 import 解析降级

**依赖**: Feature 1 + Feature 3

---

### Feature 6: Java 语言适配器
- **编号**: 030-multilang-java-adapter
- **优先级**: P1
- **预估改动量**: 中

**范围**:
1. 实现 `JavaLanguageAdapter`：
   - `analyzeFile`: 基于 tree-sitter-java 提取 class、interface、enum、record、annotation
   - `buildDependencyGraph`: 解析 `import` 语句 + 可选调用 `jdeps`
   - `getTerminology`: Java 特有术语（"public/protected/private 访问修饰符"、"接口 interface"、"注解 @"）
   - `getTestPatterns`: `*Test.java`、`*Tests.java`、`*Spec.java`
   - `analyzeFallback`: Java import/class/interface 正则降级
2. `.scm` 查询文件：`queries/java.scm`
3. 处理 Java 特有概念：
   - 包路径 → 文件路径映射
   - 注解（`@Override`、`@Deprecated`、Spring 注解等）
   - 泛型签名
   - record 类型（Java 16+）

**验收标准**:
- 对标准 Java 项目（Maven/Gradle 结构）能生成完整 spec
- 包级 import 依赖图准确

**依赖**: Feature 1 + Feature 3

---

### Feature 7: 多语言混合项目支持
- **编号**: 031-multilang-mixed-project
- **优先级**: P1
- **预估改动量**: 中

**范围**:
1. `batch-orchestrator.ts` 支持多语言混合扫描：
   - 自动检测项目中存在的语言（按文件扩展名统计）
   - 按语言分组构建各自的依赖图
   - 跨语言模块的 spec 中标注语言边界
2. 架构索引（`index.spec.md`）增加语言分布信息
3. 多语言项目的 MCP 工具增强：
   - `prepare` 返回时标注检测到的语言列表
   - `batch` 支持 `--languages` 过滤参数
4. `scanFiles` 输出被忽略文件的警告（包含跳过了哪些不支持的语言）

**验收标准**:
- 对包含 TS + Python + Go 的混合项目，能分别生成各语言模块的 spec
- 架构索引正确展示多语言模块关系
- 不支持的语言文件会输出友好警告

**依赖**: Feature 4 + Feature 5（至少两种语言可用）

---

## 实施路线图

```
Phase 0 — 基础设施（可并行）
  ├── Feature 1: LanguageAdapter 抽象层  ← 核心前置
  └── Feature 2: Prompt 参数化           ← 可并行

Phase 1 — 解析后端
  └── Feature 3: tree-sitter 后端        ← 依赖 Feature 1

Phase 2 — 语言适配器（可并行）
  ├── Feature 4: Python 适配器           ← 依赖 Feature 1+3
  ├── Feature 5: Go 适配器              ← 依赖 Feature 1+3
  └── Feature 6: Java 适配器            ← 依赖 Feature 1+3

Phase 3 — 集成
  └── Feature 7: 混合项目支持            ← 依赖 Feature 4+5
```

## 版本规划

| 版本 | 包含 Feature | 里程碑 |
|------|-------------|--------|
| 3.0.0 | Feature 1 + 2 + 3 | 多语言基础设施就绪（breaking: CodeSkeleton 模型变更） |
| 3.1.0 | Feature 4 | Python 支持 |
| 3.2.0 | Feature 5 | Go 支持 |
| 3.3.0 | Feature 6 | Java 支持 |
| 3.4.0 | Feature 7 | 混合项目支持 |

## 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| tree-sitter 版本 | `web-tree-sitter`（WASM） | 跨平台分发、维护活跃（v0.26.6）、性能足够 |
| TS/JS 解析器 | 保留 ts-morph 为首选 | 提供完整类型信息，tree-sitter 无法替代 |
| 依赖图策略 | 各语言独立实现 | 不可能统一，Go 有 `go list`，Python 靠 import 解析 |
| CodeSkeleton 扩展 | 扩展枚举值而非结构重构 | 最小化 breaking change |

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| web-tree-sitter 与 grammar WASM 的 ABI 兼容性 | grammar 加载失败 | 锁定版本对，CI 测试验证 |
| C++ 模板/宏复杂度过高 | C++ spec 质量低 | C++ 降为 P2，先做 Python/Go/Java |
| CodeSkeleton 模型变更导致 TS/JS 回归 | 现有功能中断 | Feature 1 要求零回归，完整回归测试 |
| 各语言 `.scm` 查询维护成本 | 新语法支持滞后 | 每种语言提供正则降级兜底 |
