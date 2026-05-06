# Tech Research — Feature 151 Knowledge Graph (codebase-scan)

**特性**: 151 — Knowledge Graph 抽象 + UnifiedGraph schema + Python LanguageAdapter callSites  
**分支**: 151-knowledge-graph-python  
**调研日期**: 2026-05-06  
**调研模式**: codebase-scan（仅仓内代码盘点，不做外部技术调研）  
**产品调研基础**: [独立模式] 本次技术调研未参考产品调研结论，直接基于需求描述和仓内代码执行。

---

## 1. 现有 graph / panoramic 链路盘点

### 1.1 DependencyGraph 现状

**位置**：`src/models/dependency-graph.ts`

**字段结构**（Zod schema）：
- `projectRoot: string`
- `modules: GraphNode[]`（注意：这是 `dependency-graph.ts` 内的 `GraphNode`，字段为 `source / isOrphan / inDegree / outDegree / level / language?`，与 `panoramic/graph/graph-types.ts` 中 `GraphNode` 同名但类型不同）
- `edges: DependencyEdge[]`（字段：`from / to / isCircular / importType`）
- `topologicalOrder: string[]`
- `sccs: SCC[]`
- `totalModules / totalEdges / analyzedAt / mermaidSource`

**当前消费者**：
- `PythonLanguageAdapter.buildDependencyGraph()` 生产此类型
- `GoLanguageAdapter` / `JavaLanguageAdapter` / `TsJsLanguageAdapter`（待确认是否实现 `buildDependencyGraph`，接口为可选 `?`）
- `src/panoramic/graph/graph-types.ts` 中 `BuildGraphOptions` 注释提到 `DependencyGraph`（`src/models/dependency-graph.ts`），但 `graph-builder.ts` 实际未直接消费 `DependencyGraph` 类型，而是通过 `architectureIR / docGraph / crossReferenceLinks / extractionResults` 四路数据源间接消费

**关键问题**：`DependencyGraph.modules` 里的 `GraphNode.source` 是相对路径字符串；`panoramic/graph/graph-types.ts` 中的 `GraphNode.id` 也是路径字符串。两个同名 `GraphNode` 在 Feature 151 合并时需要仔细区分。

### 1.2 panoramic/graph/ 文件清单

| 文件 | 职责 |
|------|------|
| `src/panoramic/graph/graph-types.ts` | `GraphNode / GraphEdge / GraphJSON / BuildGraphOptions / ConfidenceLevel / Hyperedge / SemanticEdgeRelation` 类型定义 |
| `src/panoramic/graph/graph-builder.ts` | `buildKnowledgeGraph()` — 4 路数据源合并（docGraph / architectureIR / crossReference / extractionResults）→ `GraphJSON` |
| `src/panoramic/graph/graph-query.ts` | `GraphQueryEngine` — 从 `_meta/graph.json` 加载，提供 query / getNode / findPath / getCommunity / getGodNodes / getHyperedges |
| `src/panoramic/graph/graph-paths.ts` | `resolveGraphJsonPath()` — 统一路径约定（`specs/_meta/graph.json`） |
| `src/panoramic/graph/confidence-mapper.ts` | `CONFIDENCE_SCORES / mapDocConfidence / mapEvidenceConfidence` |
| `src/panoramic/graph/index.ts` | 模块统一导出（`buildKnowledgeGraph / writeKnowledgeGraph / enrichNodeDegrees / GraphQueryEngine` 等） |

**当前 graph.json 数据来源**（已确认的 4 路）：
1. `docGraph`（DocGraph spec nodes + references）
2. `architectureIR`（ArchitectureIR elements + relationships）
3. `crossReferenceLinks`（跨 spec 引用边）
4. `extractionResults`（Feature 107 多模态提取，Python AST 节点由 `PythonLanguageAdapter.extractSymbolNodes()` 提供）

**当前 edge 种类**（`graph-builder.ts` 里实际处理）：`contains / cross-module / depends-on / groups / deploys / documents / references / conceptually_related_to / rationale_for`。**没有 `calls` 边**，这是 Feature 151 要新增的。

### 1.3 component-view-builder relationship 当前来源

**文件**：`src/panoramic/builders/component-view-builder.ts`

当前 `buildComponentRelationships()` 的数据来源（按优先级）：
1. **`storedModules`**（`StoredModuleSpecRecord[]`）的 `baselineSkeleton.imports`——通过 `resolveImportedModules()` 解析 import 关系生成 `calls` 类型关系（confidence: medium）
2. **`architectureIR.relationships`**（`depends-on` 类型）——通过 `mapIrRelationshipToComponents()` 映射
3. **规则推断**（基于 category 名称匹配）——`queryComponent → transportComponent → parserComponent / sessionComponent`（confidence: high/medium）
4. **`eventSurface.channels`**——publisher → subscriber 关系（confidence: medium）

**关键发现**：relationship **不来自** `graph.json`，而是从 ArchitectureIR + storedModules.imports 静态推断。Feature 151 要求"relationship 改读 UnifiedGraph.edges"，这是一次数据源切换。当前 `ComponentViewBuilderGenerator.generate()` 的 `storedModules` 为空数组（编排级无法注入），意味着当前实现的 relationship 大部分来自规则推断，而非真实 import 数据。

### 1.4 6 个 graph MCP tools

**文件**：`src/mcp/graph-tools.ts`

| 工具名 | 功能 | 当前数据源 |
|--------|------|-----------|
| `graph_query` | 关键词子图查询（BFS/DFS 遍历） | `GraphQueryEngine`（从 `specs/_meta/graph.json` 加载） |
| `graph_node` | 单节点详情 + 邻居 + 语义边 | 同上 |
| `graph_path` | 最短路径查询 | 同上 |
| `graph_community` | 社区节点查询 | 同上 |
| `graph_god_nodes` | 枢纽节点（度数最高） | 同上 |
| `graph_hyperedges` | 超边查询（label/node_id 过滤） | 同上 |

**数据源切换影响**：6 个工具全部通过 `getEngine()` 读 `specs/_meta/graph.json`，切换到 UnifiedGraph 后，只要 `writeKnowledgeGraph()` 写入路径不变、`GraphJSON` 结构向后兼容（保留 `nodes / links`），MCP tools 层**无需修改**。影响面在 `graph-builder.ts`（生产者），不在 `graph-tools.ts`（消费者）。

---

## 2. CodeSkeleton schema 现状

### 2.1 字段清单

**文件**：`src/models/code-skeleton.ts`

`CodeSkeletonSchema`（Zod）当前字段：
- `filePath: string`（regex 校验多语言后缀，含 `.py`）
- `language: Language`（含 `python`）
- `loc: number`
- `exports: ExportSymbol[]`
- `imports: ImportReference[]`
- `parseErrors?: ParseError[]`
- `hash: string`（SHA-256 hex）
- `analyzedAt: string`（ISO datetime）
- `parserUsed: ParserUsed`（`tree-sitter / ts-morph / baseline / reconstructed`）
- `moduleDoc?: string`

**待新增字段**（Feature 151）：`callSites?: CallSite[]`（optional，zod `.optional()`）

**`ExportSymbol`** 包含：`name / kind / signature / jsDoc? / typeParameters? / isDefault / startLine / endLine / members?: MemberInfo[]`

**`MemberInfo`** 包含：`name / kind / signature / jsDoc? / visibility? / isStatic / isAbstract?`

**`ImportReference`** 包含：`moduleSpecifier / isRelative / resolvedPath? / namedImports? / defaultImport? / isTypeOnly`

### 2.2 全仓 import 点

通过设计文档和代码阅读确认的核心消费方：

| 文件 | 消费方式 | Feature 151 影响 |
|------|---------|----------------|
| `src/adapters/python-adapter.ts` | 类型注解 + `analyzeFile()` 返回值 | 需改——`analyzeFile` 须填充 `callSites` |
| `src/adapters/language-adapter.ts` | `analyzeFile` 返回类型 `CodeSkeleton` | 需改接口注释（逻辑不动） |
| `src/adapters/ts-js-adapter.ts` | 同上 | 不动（Feature 151 scope 边界：只做 Python） |
| `src/adapters/go-adapter.ts` | 同上 | 不动 |
| `src/adapters/java-adapter.ts` | 同上 | 不动 |
| `src/core/tree-sitter-analyzer.ts` | 生产 `CodeSkeleton`（`analyze()` 返回值） | 需改——Python 分析路径需传出 callSites |
| `src/core/query-mappers/python-mapper.ts` | 生产 `ExportSymbol / ImportReference` | 需改——新增 call site 提取逻辑 |
| `src/diff/drift-orchestrator.ts` | `CodeSkeletonSchema.parse()` — 解析 spec 内嵌 baseline | optional 字段向后兼容，旧 spec 不抛错 |
| `src/panoramic/builders/component-view-builder.ts` | `StoredModuleSpecRecord.baselineSkeleton?.imports` | 间接消费（通过 `storedModules`） |
| `src/panoramic/graph/graph-builder.ts` | 不直接消费 `CodeSkeleton`，通过 `extractionResults` 间接 | 需改——将 `callSites` 转为 `calls` 边注入 |

### 2.3 drift-orchestrator parse 路径

**文件**：`src/diff/drift-orchestrator.ts`

`loadBaselineSkeleton()` 从 spec 文件 HTML 注释 `<!-- baseline-skeleton: {...} -->` 中提取 JSON，用 `CodeSkeletonSchema.parse()` 验证。

由于新增 `callSites` 字段为 `optional`，Zod `.optional()` 确保旧 spec（无此字段）解析不抛错。**向后兼容性确认：无破坏性风险**。

---

## 3. Python adapter 现状

### 3.1 analyzeFile 签名 / 返回类型

```typescript
async analyzeFile(
  filePath: string,
  options?: AnalyzeFileOptions,
): Promise<CodeSkeleton>
```

当前实现：委托给 `TreeSitterAnalyzer.getInstance().analyze(filePath, 'python', options)`。

**调用链**：`PythonAdapter.analyzeFile()` → `TreeSitterAnalyzer.analyze()` → `PythonMapper.map()` → `CodeSkeleton`

### 3.2 当前 PythonMapper 抽取字段

**文件**：`src/core/query-mappers/python-mapper.ts`

当前提取内容：
- `exports`：模块级 `function_definition / class_definition / decorated_definition`（非 `_` 前缀）
- 对每个 class 提取 `members`（方法列表：`method / classmethod / staticmethod / property / getter / setter`）
- `imports`：`import / from...import` 语句
- `parseErrors`：tree-sitter error 节点
- `moduleDoc`：文件顶级 docstring

**当前不提取**：call sites（函数调用位置）。这是 Feature 151 的新增内容。

**支持的 decorator 收集**：`getDecorators()` 提取 `@staticmethod / @classmethod / @property / @abstractmethod` 等——可在 call site 推断（`classmethod → Class.method()` 调用模式）中复用。

### 3.3 LanguageAdapter base class 接口

**文件**：`src/adapters/language-adapter.ts`

当前接口必选方法：`analyzeFile / analyzeFallback / getTerminology / getTestPatterns`

可选方法：`buildDependencyGraph? / extractComments?`

**Feature 151 方案**：在 Python adapter 内，`analyzeFile()` 返回的 `CodeSkeleton` 需含 `callSites`。接口层可选加 `extractCallSites?` 方法，或直接通过 `PythonMapper` 扩展在 `analyzeFile` 内一并产出。设计文档（§3.2 数据流）表明 callSites 作为 `CodeSkeleton` 字段产出，调用方（call-resolver）消费。

### 3.4 tree-sitter Python 分析路径

`TreeSitterAnalyzer` 不使用 `.scm` 查询文件（PythonMapper 注释明确："直接遍历 AST 节点，不使用 .scm 查询文件"），而是用 `Parser.SyntaxNode` API 手动遍历 AST。

Feature 151 的 call site 提取也将沿用此模式（遍历 `call / attribute / binary_operator / unary_operator` 节点）。这与 `scripts/lib/python-call-extractor.py`（stdlib `ast.walk`）的策略一致，但实现语言不同（TS tree-sitter API vs Python ast）。

---

## 4. Truth set 数据结构

### 4.1 现有 truth set 生成机制

**核心脚本**：`scripts/graph-accuracy.mjs` + `scripts/lib/python-call-extractor.py`

**生成方式**：
1. `python-call-extractor.py <source_root>` 遍历所有 `.py` 文件，用 `ast.walk` 提取 import + call 关系
2. 输出 JSON：`{ root, fileCount, imports: ["file.py::module"], calls: ["file.py::funcName"], uniqueImportTargets, uniqueCallTargets, skipped }`
3. `graph-accuracy.mjs` 接受 `--source <python-root> --graph <graph.json>` 对比 truth set vs graph，输出 `callPrecision / callRecall`

**extractor 覆盖的 call 类型**：
- `ast.Call`：`func()` 直接调用（取 `id` 或 attribute `attr`）
- `ast.BinOp`：`BINOP_DUNDER` 映射（`__add__ / __sub__` 等 14 种）
- `ast.UnaryOp`：`UNARYOP_DUNDER` 映射（`__pos__ / __neg__ / __invert__`）

**覆盖的 call 类型（Python-mapper.ts 需支持的）**：
- `self.method()` — `attribute` node，object 为 `self`
- `Class.method()` — `attribute` node，object 为类名
- `super().method()` — `call` node，func 为 `super()` attribute
- `@decorator` — `decorated_definition` 上的 decorator
- dunder（`__add__` 等）— `binary_operator / unary_operator` 节点

### 4.2 truth set 文件位置

根据 `.gitignore` 约定（CLAUDE.local.md），`truth-set.json` 不入库（`.gitignore` 排除）。每次 `graph-accuracy.mjs --write-fixture <path>` 重生成。

**micrograd baseline**（`~/.spectra-baselines/micrograd/`）：5 个 `.py` 文件，248 LOC，含 `engine.py / nn.py / test.py` 等，operator overload 密集（`__add__ / __mul__` 等）——是验收 Python call precision/recall 的主要 benchmark。

**nanoGPT baseline**（`~/.spectra-baselines/nanoGPT/`）：15 个 `.py`，1.5k LOC，更大型 ML 项目——作为补充 benchmark。

### 4.3 precision / recall 计算方式

`graph-accuracy.mjs` 中的 `computeCallAccuracy()`：
- **label-only 匹配**：对 graph 中 call edge 的 target label 和 truth set 中的 call target，都经 `normalizeName()` 归一化（去路径前缀、括号、下划线前缀点等），取交集计算
- `callPrecision = |graph_callees ∩ truth_set| / |graph_callees|`
- `callRecall = |graph_callees ∩ truth_set| / |truth_set|`
- **目标**：precision ≥ 70% / recall ≥ 30%（设计文档 §4 Feature 150 验收）

---

## 5. 现有测试基线

### 5.1 vitest 项目配置

`vitest.config.ts` 定义 5 个测试项目（`unit / integration / golden-master / self-hosting / e2e`），unit 测试覆盖范围：

```
tests/unit/**           主 unit 目录
tests/adapters/**       适配器测试
tests/models/**         schema 测试
tests/panoramic/**      panoramic 功能测试
tests/extraction/**     多模态提取测试
tests/batch/**          批量处理测试
tests/spec-store/**     Spec 存储测试
tests/cli/**            CLI 命令测试
tests/utils/**          工具函数测试
tests/debt-scanner/**   债务扫描器测试
```

### 5.2 单测数量与分布

设计文档（§4 Feature 150 验收）提及"现有 47 单测"——这是 Feature 150 完成时的基线。本次 Feature 151（codebase-scan 模式）未实际运行 vitest 统计当前精确数量，但 Feature 150 Phase 6 已完成（master @ 3b49478），预计单测总数在 47 + Feature 150 新增的 ~30 case ≈ **77 个**左右。[推断]

**与 Feature 151 直接相关的测试目录**（尚不存在，需新建）：
- `tests/unit/knowledge-graph/` — call-resolver / UnifiedGraph schema

### 5.3 snapshot test 约定

`vitest.config.ts` 中未发现 `__snapshots__` 目录配置。设计文档提到"snapshot test：现有 6 graph MCP tools 在合并前后查询结果集合 1:1"，但该 snapshot test 具体文件未在仓内找到（可能为 Feature 150 计划新增，尚未入库）。

---

## 6. runtime-bootstrap 范围确认

### 6.1 "runtime-bootstrap" 对应代码

"runtime-bootstrap"在设计文档（§2.4）定义为：将分散在各 entry point 的 3 个 bootstrap 函数调用集中到一个文件。

**当前状态**（分散在 2 处）：

**`src/mcp/server.ts`（MCP entry point）**：
```typescript
bootstrapAdapters();
bootstrapGenerators();
bootstrapParsers();
```

**`src/cli/index.ts`（CLI entry point）**：
```typescript
import { bootstrapAdapters } from '../adapters/index.js';
import { bootstrapGenerators } from '../panoramic/generator-registry.js';
import { bootstrapParsers } from '../panoramic/parser-registry.js';
```
（在 CLI 命令分发前调用，逻辑散落在 `runBatchCommand / runGenerate` 等各命令函数里）

**重构目标**：新建 `src/runtime-bootstrap.ts`，封装 3 个幂等 bootstrap 调用，各 entry point import 此单一函数。

### 6.2 抽离动机

- 3 个 bootstrap 函数均已幂等（`LanguageAdapterRegistry.getAllAdapters().length > 0` 等判断），重构风险低
- Feature 151 新增 `src/knowledge-graph/` 模块，其 build pipeline 也需在启动时初始化，适合一并放入 `runtime-bootstrap`
- **最小重构量**：约 1 个文件 +20 行（设计文档原文），不影响业务逻辑

---

## 7. 改动影响面汇总

| # | 改动类别 | 文件 | 风险等级 | 备注 |
|---|---------|------|---------|------|
| 1 | 新增 | `src/knowledge-graph/unified-graph.ts` | 低 | 全新 UnifiedGraph schema（TypeScript 类型 + Zod），无现有依赖 |
| 2 | 新增 | `src/knowledge-graph/call-resolver.ts` | 低 | 4 阶段 call resolution（free/member/cross-module/MRO），纯内部逻辑 |
| 3 | 新增 | `src/knowledge-graph/index.ts` | 低 | build pipeline export 入口 |
| 4 | 新增 | `src/runtime-bootstrap.ts` | 低 | 抽离 3 个 bootstrap 调用，幂等，entry point 改 1 行 import |
| 5 | 修改 schema | `src/models/code-skeleton.ts` | 中 | 新增 `callSites?: CallSite[]` optional，向后兼容；`CallSite` 类型需定义 |
| 6 | 修改 | `src/core/query-mappers/python-mapper.ts` | 中 | 新增 call site 提取逻辑（`call / attribute / binary_operator / unary_operator` 节点遍历），当前无 call 提取 |
| 7 | 修改 | `src/core/tree-sitter-analyzer.ts` | 中 | `analyze()` 返回 `CodeSkeleton` 时需透传 `callSites`（PythonMapper 产出） |
| 8 | 修改 | `src/adapters/python-adapter.ts` | 低 | `analyzeFile` 本身无需改（委托链已就绪），但需验证 `callSites` 字段从 mapper 透传 |
| 9 | 重构 | `src/panoramic/graph/graph-builder.ts` | 高 | 4 路数据源合并逻辑需扩展——将 `callSites` 转为 `calls` 边注入 `GraphJSON.links`；同时处理 `DependencyGraph` 合并到 `UnifiedGraph` 的 shim |
| 10 | 重构 | `src/panoramic/graph/graph-types.ts` | 中 | `GraphJSON.graph.sources` 枚举需新增 `'calls'`；`GraphEdge.relation` 新增 `'calls'` 合法值 |
| 11 | 重构 | `src/panoramic/builders/component-view-builder.ts` | 高 | `buildComponentRelationships()` 当前从 `storedModules.baselineSkeleton.imports` 推断；改为读 `UnifiedGraph.edges`（`calls` 类型）。`ComponentViewBuilderGenerator.generate()` 需能注入 UnifiedGraph |
| 12 | 重构 | `src/panoramic/graph/index.ts` | 低 | 重新导出 UnifiedGraph 相关类型 |
| 13 | 新增测试 | `tests/unit/knowledge-graph/*.test.ts` | 低 | call-resolver 各场景（7 个 Python case + shared 5 case）；UnifiedGraph schema roundtrip |
| 14 | 修改测试夹具 | `tests/baseline/micrograd/spectra/full.json` | 低 | 升版后 baseline 重跑（按仓库约定，入库 fixture 需更新） |
| 15 | 修改 | `src/mcp/server.ts` | 低 | 改为 import `src/runtime-bootstrap.ts`（1 行替换） |
| 16 | 修改 | `src/cli/index.ts` | 低 | 同上 |

---

## 8. 待 spec 阶段决议的开放问题

### 问题 1：CallSite 类型定义的精确 schema

需要 spec 阶段明确 `CallSite` 的字段：
- `calleeName: string`（仅 symbol 名，还是含 `self.method` 形式？）
- `calleeKind?: 'free' | 'member' | 'cross-module' | 'dunder' | 'super'`（分类够用？）
- `callerContext?: string`（所在函数名，用于 cross-module resolution）
- `line?: number`（位置信息是否必须？）
- `confidence: ConfidenceLevel`（是否随 CallSite 一起存储，还是在 call-resolver 阶段计算？）

若 `CallSite` 过于简化，call-resolver 的 cross-module resolution（4-stage pipeline）可能信息不足。

### 问题 2：DependencyGraph → UnifiedGraph 合并 shim 的范围

设计文档 §2.1 说明合并时 `DependencyGraph` 降级为 derived view（保留 `SCC / topologicalOrder / mermaidSource`），但：
- 哪些 CLI 命令直接用 `DependencyGraph` schema？（`spectra community` 命令、mermaid renderer 需排查）
- Feature 151 的重构 shim 是"DependencyGraph consumers 改为从 UnifiedGraph 派生"还是"维持 DependencyGraph 接口，内部数据源换为 UnifiedGraph"？
- Python adapter 的 `buildDependencyGraph()` 是保留还是废弃？

### 问题 3：component-view-builder relationship 切换的 storedModules 注入问题

当前 `ComponentViewBuilderGenerator.generate()` 因编排层无法注入 `storedModules` 而使用空数组，导致 relationship 主要来自规则推断而非真实 import。若 Feature 151 要求"relationship 改读 UnifiedGraph.edges"，需明确：
- UnifiedGraph 在 `ComponentViewBuilderGenerator.generate()` 调用时是否已构建完毕？
- `generate(input: ArchitectureIR)` 签名是否需要扩展为接受 `UnifiedGraph` 作为额外参数？
- 这是否会打破 `DocumentGenerator<TInput, TOutput>` 泛型接口的类型签名？

### 问题 4：Python call site 提取覆盖 decorator 的语义

`python-call-extractor.py`（scripts/lib）以 `@decorator` 名本身记录为 call（如 `@staticmethod` → `staticmethod` 为 callee）。Feature 151 的 Python tree-sitter 实现是否同样处理？还是只记录函数体内的显式 `Call` 节点？答案影响与 truth set 的 precision/recall 计算结果。

### 问题 5：tree-sitter-analyzer.ts 的 callSites 透传接口

`TreeSitterAnalyzer.analyze()` 当前签名返回 `Promise<CodeSkeleton>`，内部调用 `PythonMapper.map()`。若 `PythonMapper` 新增 call site 提取，需确认：
- `MapperOptions` 是否需要新增 `extractCallSites?: boolean` 标志？
- 还是 call site 提取默认全开，无需选项？
- `CallSite[]` 在 mapper 结果中如何传回（`CodeSkeleton.callSites`）？

### 问题 6：snapshot test 的实现时机

设计文档要求"Feature 150 末尾用 snapshot test 锁定 6 个 graph MCP tools 行为"——但仓内未找到此 snapshot test 文件。Feature 151 重构 `graph-builder.ts` 数据源后，若 snapshot test 不存在，验收"查询结果集合 1:1"的可操作方式需在 spec 阶段确认。

---

*报告生成时间：2026-05-06*  
*调研范围：仓内代码盘点（codebase-scan 模式），未做外部 web 搜索*
