# Feature Specification: Knowledge Graph 抽象 + UnifiedGraph schema + Python LanguageAdapter callSites

**Feature Branch**: `151-knowledge-graph-python`
**Created**: 2026-05-06
**Status**: Draft
**Input**: User description: 实现 Knowledge Graph 关键路径基建（设计文档"Feature 150a"，本仓库分配 Feature 151）；本 Feature 只做 Python，不动 ts-js / go / java adapter；不引入 sqlite 持久化；不实现新 MCP tools；不做跨 repo group mode。

---

## 目标摘要

Feature 151 是 `docs/design/spectra-mcp-evolution.md` 路线图中 **Knowledge Graph 4 语言能力** 的第一步、也是关键路径基建：

1. 在仓内引入统一的 `UnifiedGraph` schema（nodes + edges + confidence），把当前散落在 `DependencyGraph` 与 `panoramic/graph/*` 两套结构里的图数据合并成单一事实源；
2. 新建 `src/knowledge-graph/` 模块，提供共享的 4 阶段 call resolver（free / member / cross-module / MRO fallback），为 4 种语言 adapter 复用；
3. 在 `CodeSkeleton` schema 上新增 `callSites?: CallSite[]` optional 字段，并在 **Python LanguageAdapter** 上完整实现 call site 抽取（self.method / Class.method / `__add__` dunder / super() / decorator / cross-module）；
4. 重构 `panoramic/graph/*` 与 `component-view-builder` 的数据消费链，让 relationship 直接来自 `UnifiedGraph.edges`；
5. 维持 6 个 graph MCP tools 的查询行为前后一致（snapshot 1:1，score 容忍 ±10%）。

**关键路径约束**：本 Feature 必须 merge 到 `master` 后，才能启动 Feature 152（ts-js callSites）/ 153（Go callSites）/ 154（Java callSites）/ 155（Agent-Context MCP tools）/ 156（incremental + sqlite 持久化）的并发 worktree 开发。

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Python 项目消费方拿到带 call 边的 UnifiedGraph (Priority: P1)

作为 spectra panoramic graph 的下游消费者（component-view-builder、`graph_query` MCP 工具、未来 Agent-Context 工具的开发者），我能在一个纯 Python 的中型项目（如 `karpathy/micrograd` 或 `karpathy/nanoGPT`）上跑完 spectra 流水线，得到的 `_meta/graph.json`（背后由 `UnifiedGraph` 生成）包含 **calls 类型边**，且每条边带置信度（high / medium / low）；我可以基于这些边追踪函数级调用关系。

**Why this priority**: 这是 Feature 151 的核心交付价值。没有 P1，下游 component view、graph MCP tools 拿不到任何函数级 call 信息，整个 Knowledge Graph 路线图（152~157）都失去基础。

**Independent Test**: 在 `~/.spectra-baselines/micrograd` 上跑 `npm run baseline:collect -- --target karpathy/micrograd --mode full`，再跑 `npm run graph:accuracy -- --source <root> --graph specs/_meta/graph.json`，验证 `callPrecision ≥ 70%` 且 `callRecall ≥ 30%`。

**Acceptance Scenarios**:

1. **Given** micrograd 全量 5 个 .py 文件已被 spectra 处理，**When** 调用 `graph_query` MCP 工具查询关键词 `Value.__add__`，**Then** 返回的子图含 `Value.__add__ → Value.__radd__` / `Value.__add__ → Value` 之类 calls 边，confidence 字段为 `high` 或 `medium`
2. **Given** nanoGPT 全量 15 个 .py 已处理，**When** 跑 `node scripts/graph-accuracy.mjs --source <root> --graph specs/_meta/graph.json`（注：仓内尚无对应 npm script，`scripts/graph-accuracy.mjs` 直接 invoke），**Then** 输出 `callPrecision ≥ 0.70` 且 `callRecall ≥ 0.30`
3. **Given** 一个 Python class 调用了 `super().__init__()`，**When** call-resolver 处理该 call site，**Then** UnifiedGraph 中存在一条从 child class 方法指向 parent class `__init__` 的 calls 边（即使 MRO 不完整时落到 fallback，也至少标记 `confidence: low`）

---

### User Story 2 — 后续语言 sub-feature 的开发者直接复用共享抽象 (Priority: P1)

作为 Feature 152（ts-js）/ 153（Go）/ 154（Java）的开发者，我能够 import `src/knowledge-graph/call-resolver.ts` 和 `src/knowledge-graph/unified-graph.ts`，**只需要为我自己的语言写 callSites 抽取逻辑**（即只动 `*-adapter.ts` + `*-mapper.ts`），不再需要重复实现 4 阶段 call 解析或重新设计 graph schema。

**Why this priority**: Feature 151 的关键路径属性来自这条——如果共享抽象不到位，152/153/154 三个 worktree 就要各自重新发明轮子，关键路径变成关键瓶颈。

**Independent Test**: 在 Feature 151 完成后、152 启动前，单测 `tests/unit/knowledge-graph/call-resolver.test.ts` 通过 mock callSite 数组（不依赖任何具体语言的 adapter）即可覆盖 4 阶段 resolution 的全部分支；语言无关测试用例 ≥ 5 条。

**Acceptance Scenarios**:

1. **Given** 一个手工构造的 `CallSite[]`（含 free / member / cross-module / 缺 import 兜底 4 类），**When** 调用 `resolveCalls(callSites, codeSkeletons)`，**Then** 返回的 `UnifiedGraph.edges` 中每条 calls 边的 `confidence` 等级与设计文档 §3.1 表格一致
2. **Given** Feature 152 开发者 import `unified-graph.ts`，**When** 其在 ts-js adapter 中产出 `CallSite[]`，**Then** 直接调用 `buildUnifiedGraph()` 即可得到与 Python 同形态的 graph 输出，无需自定义 schema

---

### User Story 3 — 现有 6 个 graph MCP tools 的消费者**legacy 子图无感升级 + calls 子图新增** (Priority: P1)

作为已经在使用 `graph_query` / `graph_node` / `graph_path` / `graph_community` / `graph_god_nodes` / `graph_hyperedges` 6 个 MCP 工具的 Codex / Claude Code 用户，我升级到 Feature 151 后查询行为分两层：

- **Layer A — Legacy 关系子图（必须 1:1）**：对**同一个 query**，过滤掉 calls 类型边后的子图（即只看 contains / cross-module / depends-on / documents / references / etc.），节点 ID 集合 1:1，边 ID 集合 1:1，仅 score 字段允许 ±10% 漂移
- **Layer B — calls 子图（首次引入）**：calls 类型边为新增数据源，无 master baseline 可比对，本 Feature 锁定首版 snapshot 作为后续 Feature 的基线

**Why this priority**: 重构 graph-builder 的数据源是高风险动作（tech-research §1.4 标记"风险等级：高"）。Codex 对抗审查指出：`graph_query` budget 截断按 degree 排序、`graph_god_nodes` 按 adjacency degree 排序——新增 calls 边会改变节点 degree，从而改变 traversal 顺序与 top-N 结果。所以"全集合 1:1"在含 calls 的查询上不可满足；必须按 layer 分层验收。

**Independent Test**:
- Layer A：在 master 上对 self-dogfood baseline 跑 6 工具完整查询，记录 raw response；Feature 151 完成后将 raw response 中的 calls 边过滤掉，diff 仅允许 score ±10% 漂移
- Layer B：Feature 151 完成后录制 calls-enabled 查询 snapshot，作为后续 Feature 152~157 的回归 anchor

**Acceptance Scenarios**:

1. **Given** master 当前 `graph_query keyword=batch-orchestrator` 输出的边集合 E0（按 relation 过滤），**When** Feature 151 合并后**过滤掉 relation=calls 的边后**，节点 / 边 ID 集合 = E0 中相同集合
2. **Given** master 当前 `graph_god_nodes top=5` 输出 O0，**When** Feature 151 合并后`graph_god_nodes top=5` 输出 O1（含 calls 影响 degree 计算），**Then** 不要求 O0=O1；但 O1 必须**新建为 Layer B snapshot**，作为 Feature 152~157 的 baseline anchor
3. **Given** Feature 151 之前生成的 graph.json 中无 calls 边，**When** 用同一 query 在新 GraphQueryEngine 上加载执行，**Then** 等同于 Layer A 行为（不抛错、不缺边）

---

### User Story 4 — drift-orchestrator 解析旧 spec 不抛错 (Priority: P2)

作为已经把 `<!-- baseline-skeleton: {...} -->` 注释嵌入旧 spec.md 的维护者，我升级到 Feature 151 后，旧 spec（CodeSkeleton 中无 `callSites` 字段）继续被 `drift-orchestrator.loadBaselineSkeleton()` 正确解析，不抛 Zod 校验错。

**Why this priority**: 向后兼容是仓内既定约束（`CallSite[]` 用 zod `.optional()`）。P2 因为单测层面非常容易覆盖，但属于必须项。

**Independent Test**: 用一份不含 `callSites` 字段的旧版 baseline-skeleton JSON 喂给 `CodeSkeletonSchema.parse()`，确认成功返回。

**Acceptance Scenarios**:

1. **Given** 一份 Feature 150 时代生成的 spec.md（`callSites` 字段不存在），**When** drift-orchestrator 解析其内嵌的 baseline-skeleton，**Then** 解析成功，`skeleton.callSites === undefined`，drift 检查继续进行不报错

---

### User Story 5 — runtime 启动一致性 (Priority: P3)

作为 spectra 维护者，我希望 MCP server entry point (`src/mcp/server.ts`) 与 CLI entry point (`src/cli/index.ts`) 的 bootstrap 逻辑收敛到单一文件 `src/runtime-bootstrap.ts`，避免未来新增子系统（如本 Feature 的 knowledge-graph）时 bootstrap 调用散落到 N 处。

**Why this priority**: 纯重构，不影响外部行为，P3。

**Independent Test**: `grep -r "bootstrapAdapters\|bootstrapGenerators\|bootstrapParsers" src/` 应只在 `src/runtime-bootstrap.ts` 与 entry point 各 import 一次出现。

**Acceptance Scenarios**:

1. **Given** Feature 151 完成后，**When** 静态扫描 `src/` 目录下 3 个 bootstrap 函数的调用点，**Then** 调用点收敛到 `src/runtime-bootstrap.ts` 一处，entry point 只调用 `bootstrapRuntime()` 一个统一入口

---

### Edge Cases

1. **Python 解析失败的兜底** — 当 `tree-sitter` 返回 parseErrors 非空、`CodeSkeleton.exports` 不完整时，call-resolver 必须降级为只产出 `confidence: low` 的 calls 边或直接跳过该文件，不能抛异常中断整条 build pipeline。
2. **Cross-module callee 但 import 缺失** — 例如代码里调用 `numpy.array()` 但 import 语句被遗漏（动态 import / 缺失文件），call-resolver 进入 stage 4 unresolved 兜底，输出 `confidence: low` 边，calleeName 为原始字符串。
3. **dunder `__add__` 但操作数类型未知** — 当 `a + b` 中 `a` / `b` 类型推断不到（缺少类型注解 + 缺少赋值上下文），仍需产出一条占位 calls 边指向通用 `__add__` 名（与 truth-set 抽取策略一致），confidence 为 `low`。
4. **super() 链 MRO fallback 死循环风险** — 当类继承环或 MRO 解析进入循环时，必须有最大递归深度（设计文档建议 ≤ 8 层）兜底，超出后停止解析并落 `confidence: low` 边。
5. **装饰器嵌套 / 装饰器作为函数调用** — 形如 `@app.route("/x")` 或 `@functools.wraps(fn)` 这类带参数 / 复合 decorator，需明确是把整个 `app.route("/x")` 视为 callee，还是仅记录 `app.route`；spec 阶段需 clarify（见 NEEDS CLARIFICATION 4）。
6. **旧 spec.md 缺 callSites 字段** — 见 User Story 4，drift-orchestrator 必须按 optional 处理。
7. **旧 graph.json 不含 calls 边的消费者降级** — Feature 151 之前生成的 `_meta/graph.json` 被升级后的 `GraphQueryEngine` 加载时，若 schema 字段缺失（无 `confidence` 字段、无 calls 边），engine 必须按缺省值（`confidence: 'medium'`）填充，不抛错。
8. **6 graph MCP tool 查询 layer 切分**（替代旧版"score 漂移"叙述） — 重构 graph-builder 后，**Layer A**（过滤 calls 后的 legacy 子图）必须节点 / 边 ID 集合 1:1、score ±10%；**Layer B**（calls-enabled 查询，含 graph_god_nodes / graph_query budget 截断这类按 degree 排序的查询）允许节点集合变化，但本 Feature 锁定首版 snapshot；不再保证"全查询全集合 1:1"。
9. **buildDependencyGraph 与 UnifiedGraph 双写期** — Feature 151 重构期间 Python adapter 的 `buildDependencyGraph()` 与新 UnifiedGraph 的关系（保留 / 废弃 / shim），见 NEEDS CLARIFICATION 2。
10. **ComponentViewBuilderGenerator 签名变更** — 当前 `generate(input: ArchitectureIR)` 单参数；切换到 UnifiedGraph 数据源后是否需扩展为 `generate(input, unifiedGraph?)`，可能打破 `DocumentGenerator<TInput, TOutput>` 泛型，见 NEEDS CLARIFICATION 3。
11. **Edge 方向性与 GraphJSON.directed 全局开关冲突** — 现有 `GraphJSON.directed` 是全图全局标志（默认 false，去重按无序 key），但 calls / depends-on / cross-module 语义要求保留方向；`GraphQueryEngine` 邻接表构建严格遵循全局 `directed`（`graph-query.ts:185-194`）。Feature 151 必须明确：是把 `GraphJSON.directed` 升为 `true`（影响所有旧边的查询语义），还是引入 edge-level `directional?: boolean`（推荐——见 NEEDS CLARIFICATION 7）。
12. **Dynamic call 静态分析无解** — `getattr(obj, name)()` / `globals()['fn']()` / `eval("foo()")` / 字符串拼接 attribute（`obj.__class__.__name__()`）等动态调用，tree-sitter 静态分析无法定位 callee。call-resolver 必须 skip 这类 call site（不输出 calls 边），不让其污染 precision；与 truth-set extractor 行为对齐（python-call-extractor.py 仅认 `ast.Name / ast.Attribute` 直接 callee）。
13. **`from module import *` 的 cross-module resolution** — 通配符 import 引入未知名字集合，stage 3 cross-module 阶段无法准确定位 callee 模块；call-resolver 需把这类 callee 标 `confidence: low` 或归到 unresolved 兜底，不能假装解析成功。
14. **大文件 / 非 UTF-8 / 解析超时的兜底** — 当前 `TreeSitterAnalyzer.analyze()`（`tree-sitter-analyzer.ts:124-160`）用 `readFileSync(..., 'utf-8')` + `parser.parse()` 无 size / timeout guard。Feature 151 必须明确：单文件超 X MB 跳过（建议 1 MB）、非 UTF-8 跳过、tree-sitter 抛异常时整文件 skip 并记录 `parseErrors`，不让其阻塞 pipeline；callSites 字段缺失视同 `[]`。
15. **类装饰器与异步函数 / 生成器函数的 call 解析** — `@dataclass class Foo` / `async def fetch()` / `def gen(): yield ...` 这三类 Python 特殊形式在 tree-sitter AST 节点类型上与普通 function_definition 不同；提取 callSites 时必须覆盖（`async_function_definition / generator` 等节点）。

---

## Requirements *(mandatory)*

### Functional Requirements

#### FR-1 — UnifiedGraph schema 定义 *(必须)*

- **行为**：在 `src/knowledge-graph/unified-graph.ts` 新建 `UnifiedGraph` Zod schema，至少包含 `nodes: UnifiedNode[]`、`edges: UnifiedEdge[]`、`metadata: { generatedAt, projectRoot, schemaVersion }` 三个顶层字段；每条 edge 必须带：
  - `confidence: 'high' | 'medium' | 'low'`
  - `relation` 枚举（含新增 `calls`，以及现有 `contains / cross-module / depends-on / documents / references / conceptually_related_to / rationale_for / groups / deploys`）
  - `source / target`（节点 ID）
  - `directional?: boolean` — **edge 级方向性标志**，用于覆盖 `GraphJSON.directed` 全局开关；`calls / depends-on / cross-module / contains` 必须 `directional=true`，其它默认 `false`（与现有去重逻辑兼容）
  - `evidence?` / `weight?`（可选）
- **验收**：
  - 单测 ≥ 3 条覆盖 schema roundtrip（serialize → deserialize 字段无损）
  - 单测覆盖 `confidence` 三档值合法、其他值非法
  - 单测覆盖 `directional=true` 的 calls 边在 GraphQueryEngine 邻接表里只出现 `source → target` 一向，不双向
  - `schemaVersion` 字段存在，便于后续 Feature 156 持久化时迁移
- **关联文件**：`src/knowledge-graph/unified-graph.ts`（新增）, `src/panoramic/graph/graph-query.ts`（邻接表构建需读 `directional`）
- **依赖**：无

#### FR-2 — 共享 4 阶段 call resolver *(必须)*

- **行为**：在 `src/knowledge-graph/call-resolver.ts` 实现一个语言无关的 `resolveCalls(callSites, codeSkeletons): UnifiedEdge[]` 函数，按 4 阶段处理：(1) free function（同模块顶层）→ confidence `high`；(2) member（self.x / Class.x）→ confidence `high` 当类型可定位、否则 `medium`；(3) cross-module（依赖 import 表）→ confidence `medium`；(4) MRO / fallback / unresolved → confidence `low`。
- **验收**：
  - 共享抽象单测 ≥ 5 条覆盖 4 阶段 + unresolved 兜底分支
  - 4 阶段判定逻辑必须语言无关（不在此函数硬编码 Python 关键字）
- **关联文件**：`src/knowledge-graph/call-resolver.ts`（新增）
- **依赖**：FR-1

#### FR-3 — knowledge-graph 模块 build pipeline *(必须)*

- **行为**：在 `src/knowledge-graph/index.ts` 提供 `buildUnifiedGraph(input): UnifiedGraph` 顶层入口，串联 callSites 收集 → call-resolver → edge 合并到 nodes 流程；同时统一 export `UnifiedGraph / UnifiedNode / UnifiedEdge / CallSite / resolveCalls`。
- **验收**：
  - 端到端单测：mock 一组 CodeSkeleton（含 callSites）输入，输出 UnifiedGraph 各字段符合 FR-1 schema
  - export 列表完备，下游 panoramic/graph 可单点 import
- **关联文件**：`src/knowledge-graph/index.ts`（新增）
- **依赖**：FR-1, FR-2

#### FR-4 — CodeSkeleton 新增 callSites optional 字段 *(必须)*

- **行为**：在 `src/models/code-skeleton.ts` 的 `CodeSkeletonSchema` 上新增 `callSites?: CallSite[]`（zod `.optional()`）；定义并 export `CallSite` 类型（具体字段见 NEEDS CLARIFICATION 1）。
- **验收**：
  - 单测：旧 JSON（无 `callSites`）解析成功且 `callSites === undefined`
  - 单测：新 JSON 含 `callSites` 时解析成功，字段类型与 schema 一致
  - drift-orchestrator 用旧 spec.md 跑 `loadBaselineSkeleton()` 不抛错
- **关联文件**：`src/models/code-skeleton.ts`
- **依赖**：FR-1（CallSite 类型定义需先于 schema 落地）

#### FR-5 — Python LanguageAdapter 抽取 callSites *(必须)*

- **行为**：在 `src/core/query-mappers/python-mapper.ts` 与 `src/core/tree-sitter-analyzer.ts` 的 Python 分析路径上，遍历 tree-sitter AST 的 `call / attribute / binary_operator / unary_operator / decorated_definition / superclass_arguments` 等节点，产出 `CallSite[]`；最终通过 `PythonLanguageAdapter.analyzeFile()` 的返回值 `CodeSkeleton.callSites` 暴露。
- **验收**：
  - 单测 ≥ 7 条覆盖：(1) free function `foo()`；(2) `self.method()`；(3) `Class.method()`；(4) dunder `__add__` 通过 `a + b`；(5) `super().__init__()`；(6) `@decorator`；(7) cross-module `module.func()`
  - 集成验收：在 micrograd / nanoGPT 上 callSites 字段填充率 ≥ 95%（"填充率"定义：含至少一次 callable 调用的 .py 文件中，`callSites.length > 0` 的比例）
- **关联文件**：`src/core/query-mappers/python-mapper.ts`, `src/core/tree-sitter-analyzer.ts`, `src/adapters/python-adapter.ts`
- **依赖**：FR-4

#### FR-6 — panoramic/graph/* 重构为消费 UnifiedGraph *(必须)*

- **行为**：重构 `src/panoramic/graph/graph-builder.ts`，使其将 `UnifiedGraph.edges`（包括 calls 类型）作为 `GraphJSON.links` 的数据来源之一；`src/panoramic/graph/graph-types.ts` 的 `GraphEdge.relation` 枚举增加 `'calls'`，`GraphJSON.graph.sources` 增加 `'calls'`；`src/panoramic/graph/index.ts` 重新 export UnifiedGraph 相关类型。
- **验收**：
  - `_meta/graph.json` 输出 schema 含 calls 边
  - 6 graph MCP tools 在 self-dogfood baseline 上的查询输出与 master 1:1（节点 / 边集合相同），仅新增 calls 边可接受
  - score 字段相对差 ≤ 10%
- **关联文件**：`src/panoramic/graph/graph-builder.ts`, `src/panoramic/graph/graph-types.ts`, `src/panoramic/graph/index.ts`
- **依赖**：FR-3, FR-5

#### FR-7 — component-view-builder relationship 改读 UnifiedGraph.edges *(必须)*

- **行为**：在 `src/panoramic/builders/component-view-builder.ts` 的 `buildComponentRelationships()` 中，将当前从 `storedModules.baselineSkeleton.imports` 静态推断的逻辑改为读 `UnifiedGraph.edges`（`relation === 'calls' || relation === 'depends-on'`）。
- **验收**：
  - 切换后 component view 的 relationship 数量在 self-dogfood baseline 上 ≥ 切换前数量（因 UnifiedGraph 含 calls 边，应增多）
  - 无 import 推断不到的 relationship 因切换而丢失（旧 import-based 关系全部应能从 UnifiedGraph 重新派生）
- **关联文件**：`src/panoramic/builders/component-view-builder.ts`
- **依赖**：FR-6
- **风险标注**：见 NEEDS CLARIFICATION 3（generate 签名）

#### FR-8 — DependencyGraph + panoramic graph 合并 shim *(必须)*

- **行为**：将 `src/models/dependency-graph.ts` 的 `DependencyGraph` 降级为 UnifiedGraph 的 derived view（保留 `SCC / topologicalOrder / mermaidSource` 派生字段），或维持 `DependencyGraph` 接口但内部数据源改为 UnifiedGraph；具体方案见 NEEDS CLARIFICATION 2。
- **验收**：
  - 现有 CLI 命令（`spectra community` 等）在 self-dogfood baseline 上输出与 master 1:1
  - mermaid renderer 输出无 diff（或 diff 仅在新增 calls 边）
- **关联文件**：`src/models/dependency-graph.ts`, `src/adapters/python-adapter.ts`（`buildDependencyGraph()`）
- **依赖**：FR-6

#### FR-9 — 6 个 graph MCP tools 数据源切换 + 双层 snapshot *(必须)*

- **行为**：根据 tech-research §1.4 结论，6 个 MCP tools 通过 `GraphQueryEngine` 读 `_meta/graph.json`，只要 FR-6 后 graph.json 的 schema 向后兼容（保留 `nodes / links`），tools 层无需代码改动；本 FR 的工作内容是**双层 snapshot 验证锁定**。
- **验收**（分两层，**Codex 对抗审查后修订口径**）：
  - **Layer A — Legacy 关系子图回归（必须 1:1）**：在 master 上对 self-dogfood baseline 录制 6 工具完整查询的 raw response；Feature 151 完成后过滤掉 `relation === 'calls'` 的边后，节点 / 边 ID 集合 1:1，score 字段相对差 ≤ 10%
  - **Layer B — calls-enabled 查询基线（首次锁定）**：本 Feature 新建 calls-enabled snapshot（不要求与 master 1:1，因为 graph_god_nodes / graph_query 含按 degree 排序的 budget 截断，新增 calls 边必然改变 degree → top-N 集合）；本 snapshot 作为后续 Feature 152~157 的回归 anchor
  - **明确不要求**：Layer B 与 master 全集合 1:1（Codex C-2 指出此口径不可满足）
- **关联文件**：`src/mcp/graph-tools.ts`（验证不动），`tests/integration/graph-mcp-snapshot.test.ts`（**本 Feature 必须新建**，先 P0 task 录 master snapshot 再做 graph-builder 重构，见 NEEDS CLARIFICATION 6）
- **依赖**：FR-6

#### FR-10 — runtime-bootstrap 抽离 *(必须)*

- **行为**：新建 `src/runtime-bootstrap.ts`，封装 `bootstrapAdapters / bootstrapGenerators / bootstrapParsers` 三个幂等调用为单一 `bootstrapRuntime()`；**所有 4 个 entry point 改为 import 此函数**——Codex 对抗审查指出原版 spec 漏列 2 个调用点：
  1. `src/mcp/server.ts:32-36`（MCP entry）
  2. `src/cli/index.ts`（CLI entry）
  3. `src/panoramic/batch-project-docs.ts:175`（batch entry）— **新增覆盖**
  4. `src/panoramic/pipelines/coverage-auditor.ts:247`（audit pipeline）— **新增覆盖**
- **验收**：
  - 静态扫描：3 个 bootstrap 函数（`bootstrapAdapters / bootstrapGenerators / bootstrapParsers`）仅在 `src/runtime-bootstrap.ts` 内被调用，4 个 entry point 仅 import + 调用 `bootstrapRuntime()`
  - 现有所有单测仍 pass，MCP server / CLI / batch / audit 启动行为无变化
- **关联文件**：`src/runtime-bootstrap.ts`（新增）, `src/mcp/server.ts`, `src/cli/index.ts`, `src/panoramic/batch-project-docs.ts`, `src/panoramic/pipelines/coverage-auditor.ts`
- **依赖**：无（可独立交付，但 SC-007 依赖此 FR 完成）
- **Why required（不再可选）**：与 SC-007 强制达标项绑定（Codex W-5 指出原版"FR-10 可选 vs SC-007 必达"内部矛盾），且为本 Feature 新增的 `src/knowledge-graph/` 模块预留统一 init 时机

### Key Entities

- **UnifiedNode**：`{ id, label, kind: 'module' | 'symbol' | 'spec' | 'component' | ..., language?, filePath?, metadata? }`
- **UnifiedEdge**：`{ source, target, relation: 'calls' | 'contains' | 'depends-on' | 'cross-module' | 'documents' | 'references' | ..., confidence: 'high' | 'medium' | 'low', directional?: boolean, evidence?, weight? }`
  - **`directional`** 字段 — calls / depends-on / cross-module / contains 必须 `true`；旧的对称关系（如 conceptually_related_to）保持 `false` 兼容现有去重逻辑（**Codex C-1 修订**）
- **CallSite**：函数调用点的原始记录，字段精确定义见 NEEDS CLARIFICATION 1
- **UnifiedGraph**：`{ nodes, edges, metadata: { generatedAt, projectRoot, schemaVersion } }`
- **ConfidenceTier 双轨映射**（**Codex W-1 修订**）：内部 UnifiedGraph 用 `'high' | 'medium' | 'low'`；输出到 GraphJSON 时映射到现有 `EXTRACTED / INFERRED / AMBIGUOUS` enum（具体映射规则见 NEEDS CLARIFICATION 7）

---

## Quality Requirements (NFR)

- **NFR-1 性能**：UnifiedGraph 构建 wall-clock 相对 master 同 baseline 不应回归超过 **10%**（以 `npm run baseline:collect -- --target karpathy/nanoGPT --mode full` 的 `perf.totalWallMs` 字段为锚）
- **NFR-2 内存**：中型项目（~5000 nodes，对应 self-dogfood ~250 个 .ts module）in-memory 构建过程 peak RSS < **500 MB**
- **NFR-3 schema 向后兼容**：旧 `_meta/graph.json`（无 calls 边）被新 `GraphQueryEngine` 加载不抛错；旧 spec.md baseline-skeleton（无 callSites）被新 `CodeSkeletonSchema.parse()` 解析不抛错
- **NFR-4 测试基线**：现有单测全部继续 pass（数量按 Feature 151 启动时实际为准，不少于 47 + Feature 150 新增量）；新增单测 ≥ 12（Python call resolver 7 + 共享抽象 5）
- **NFR-5 baseline 锚点 fixture**：`tests/baseline/<project>/spectra/full.json` 12 个 perf anchor 重跑后入库（覆盖旧版本），diff 由 `npm run baseline:diff` 验证无 critical regression

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Python callSites 字段填充率 ≥ **95%**（**Codex W-2 修订口径**）
  - 分子：`CodeSkeleton.callSites?.length > 0` 的 .py 文件数
  - 分母：`filesWithCalls`（由 `scripts/lib/python-call-extractor.py` 输出，**本 Feature 必须新增此字段**——extractor 当前不输出，详见 plan 阶段任务）
  - 数据集：micrograd 5 文件 + nanoGPT 15 文件，N=3 重测取均值（参考 Feature 149 N-run 实践，避免小样本噪声）
- **SC-002**: Python baseline call edges precision ≥ **70%**、recall ≥ **30%**（**Codex W-2 修订口径**）
  - 计算工具：`node scripts/graph-accuracy.mjs --source <root> --graph specs/_meta/graph.json`（仓内尚无对应 npm script）
  - normalize 规则：复用 extractor + accuracy.mjs 现有 `normalizeName()` 函数（去路径前缀、括号、下划线前缀点等）；本 Feature **不允许引入额外 normalize 步骤**
  - 数据集：micrograd + nanoGPT 算术均值，N=3 重测取中位数
- **SC-003**: 现有单测全数 pass（零新增失败）；新增 ≥ 12 个单测（≥ 7 Python case + ≥ 5 共享抽象 case）全部 pass
- **SC-004**: 6 个 graph MCP tools 在 self-dogfood baseline 上的 **双层 snapshot 验收**（**Codex C-2 修订口径**）：
  - **Layer A**（legacy 子图，过滤掉 calls 边后）：节点 / 边 ID 集合 1:1，score 字段 ±10%
  - **Layer B**（calls-enabled 全查询）：本 Feature 锁定首版 snapshot 作为后续基线，**不要求与 master 1:1**（因 graph_god_nodes / graph_query budget 截断按 degree 排序，新增 calls 边必然改变 degree → top-N）
- **SC-005**: drift-orchestrator 用 master 时代生成的旧 spec.md（≥ 5 个样本）解析全数成功，零 Zod 校验异常
- **SC-006**: UnifiedGraph 构建性能 (wall-clock) 相对 master baseline 回归 ≤ 10%（在 nanoGPT 上对比，N=5 重测取中位数，沿用仓内 baseline:diff 流程）
- **SC-007**: `grep -rE "bootstrap(Adapters|Generators|Parsers)\(" src/` 调用点收敛到 `src/runtime-bootstrap.ts` 一处；4 个 entry point（mcp/server.ts、cli/index.ts、panoramic/batch-project-docs.ts、panoramic/pipelines/coverage-auditor.ts）仅 import + 调用 `bootstrapRuntime()`

---

## 明确不做（Out of Scope）

- ts-js / go / java adapter 的 callSites 抽取（Feature 152 / 153 / 154 接力）
- Agent-Context 类 MCP tools：`impact / context / detect_changes`（Feature 155）
- Incremental indexing + sqlite 持久化（Feature 156）
- 跨 repo group mode（不在路线图当前阶段）
- SWE-Bench eval（Feature 157）
- 引入新依赖（如 graph DB / sqlite / neo4j）
- 修改 `*.ts` / `*.go` / `*.java` 的 mapper 或 adapter（仅 Python）

---

## 开放问题（NEEDS CLARIFICATION，留给 clarify 阶段）

1. **CallSite 类型字段精确 schema** — `[NEEDS CLARIFICATION: CallSite 是否需要 calleeKind 枚举？是否需要 line/column？callerContext 是否必填？confidence 是在 CallSite 级别存还是 call-resolver 阶段计算？]`（对应 tech-research 开放问题 1）
2. **DependencyGraph → UnifiedGraph 合并 shim 范围** — `[NEEDS CLARIFICATION: DependencyGraph 是降级为 derived view 还是维持接口换数据源？Python adapter buildDependencyGraph() 保留还是废弃？哪些 CLI 命令直接消费 DependencyGraph？]`（对应开放问题 2）
3. **component-view-builder 的 generate 签名变更** — `[NEEDS CLARIFICATION: ComponentViewBuilderGenerator.generate(input: ArchitectureIR) 是扩展为 generate(input, unifiedGraph?) 还是通过 generator-registry 注入？是否打破 DocumentGenerator<TInput, TOutput> 泛型？]`（对应开放问题 3）
4. **decorator 在 Python call site 提取中的语义** — `[NEEDS CLARIFICATION: @app.route("/x") 这类带参 decorator 的 callee 是 app.route 还是 app.route("/x")？是否与 truth-set extractor 保持一致以避免 precision 漂移？bare decorator @staticmethod / @property 是否计入 callSite？]`（对应开放问题 4）
5. **tree-sitter-analyzer.ts 的 callSites 透传选项** — `[NEEDS CLARIFICATION: MapperOptions 新增 extractCallSites?: boolean 标志，还是默认全开？默认全开是否会拖慢 spec 阶段不需要 graph 的轻量场景？]`（对应开放问题 5）
6. **6 graph MCP tool snapshot 实现时机** — `[NEEDS CLARIFICATION: Feature 150 是否已留 graph-mcp-snapshot.test.ts？若未留（tech-research §5.3 已确认仓内未找到），本 Feature 必须在 P0 task 中先补 master baseline snapshot，再做 graph-builder 重构]`（对应开放问题 6）
7. **Edge directionality 与 GraphJSON.directed 全局开关的协调**（**Codex C-1 修订新增**）— `[NEEDS CLARIFICATION: 推荐方案是引入 edge-level directional?: boolean（calls / depends-on / cross-module / contains 设 true，其余 false），让 GraphQueryEngine 邻接表构建按 edge.directional 而非全局 graph.directed 判定。但替代方案是把 GraphJSON.directed 升为 true（影响所有旧边）。两案哪个对 SC-004 Layer A 1:1 的破坏更小？]`（对应 Codex CRITICAL C-1）
8. **Confidence 双轨 enum 的精确映射规则**（**Codex W-1 修订新增**）— `[NEEDS CLARIFICATION: 内部 UnifiedGraph 用 high/medium/low；输出 GraphJSON 时映射到现有 EXTRACTED/INFERRED/AMBIGUOUS。映射推荐：high→EXTRACTED, medium→INFERRED, low→AMBIGUOUS。是否完全 1:1 还是有 score 加权差异？现有 confidence-mapper.ts 是否需要重构？]`（对应 Codex WARNING W-1）
9. **python-call-extractor.py 是否在本 Feature 扩展输出 filesWithCalls 字段**（**Codex W-2 修订新增**）— `[NEEDS CLARIFICATION: SC-001 填充率分母依赖 filesWithCalls，但当前 extractor 只输出 fileCount/calls/uniqueCallTargets。本 Feature 是否在 plan 阶段加一个 P0 task 扩展 extractor？还是 SC-001 改用 fileCount 作为分母（更宽松、低估填充率）？]`（对应 Codex WARNING W-2）

---

## 依赖与风险

### 关键路径依赖

- 本 Feature 必须 merge 到 `master` 后，才能启动 Feature 152 / 153 / 154 / 155 / 156 的并发 worktree（5 个并发 sub-feature 都依赖共享抽象 + UnifiedGraph schema 落地）
- 每个 phase（spec / plan / tasks / implement / verify）完成 commit 之前，必须跑 `codex:codex-rescue` 对抗审查（见 `CLAUDE.local.md`）
- push 到 `origin master` 之前，按 `CLAUDE.local.md` 约定列 deliverable report 等待用户明确确认

### 已识别风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| `graph-builder.ts` 4 路数据源合并扩展为 5 路（含 calls）破坏现有 score 算子 | 高 | snapshot 双层锁定（Layer A 1:1 + Layer B 首版基线）；超出 ±10% 在 plan 阶段固定算子 |
| Edge directionality 与 GraphJSON.directed 全局开关冲突（**Codex C-1**） | 高 | 引入 edge-level `directional` 字段；NEEDS CLARIFICATION 7 在 clarify 阶段决议 |
| `DependencyGraph` 合并 shim 范围未定，可能影响多个 CLI 命令 | 中 | 通过 NEEDS CLARIFICATION 2 在 clarify 阶段确认；plan 阶段先列 consumers 清单 |
| `ComponentViewBuilderGenerator.generate` 签名修改打破 DocumentGenerator 泛型 | 中 | 通过 NEEDS CLARIFICATION 3 在 clarify 阶段决议；可通过 registry 侧 inject 避免改签名 |
| Python tree-sitter call 提取的 dunder 覆盖与 truth-set extractor 不一致 → recall 低于 30% | 中 | 单测对齐 truth-set extractor 的 14 种 BinOp + 3 种 UnaryOp 映射；NEEDS CLARIFICATION 4 |
| Dynamic call (`getattr` / `import *` / 字符串拼接) 静态分析无解但污染 precision（**Codex W-3**） | 中 | 与 truth-set extractor 行为对齐，统一 skip dynamic call；EC-12, EC-13 |
| 大文件 / 非 UTF-8 / tree-sitter 解析超时无 guard（**Codex W-4**） | 中 | EC-14 明确 size / encoding / timeout 兜底；plan 阶段决定 size 阈值 |
| 性能回归超 10%（多遍 AST 遍历） | 中 | 在 plan 阶段决定是否合并 mapper 遍历；NFR-1 验收前 baseline:diff 量化 |
| micrograd / nanoGPT 体量小，precision/recall 数字不稳定 | 中 | 双 baseline 取算术均值 + N=3 重测取中位数（**Codex W-2 修订**） |
| Confidence enum 双轨映射歧义（**Codex W-1**） | 低 | NEEDS CLARIFICATION 8 在 clarify 阶段定 mapping 规则 |
| python-call-extractor.py 缺 filesWithCalls 字段（**Codex W-2**） | 低 | clarify 阶段决议是否扩展 extractor，否则改 SC-001 分母 |
| 多 worktree 并行（152~156）下分支同步成本（5 sub-feature 各跟 master） | 中 | 沿用仓库 rebase 流程；本 Feature merge 后立即让 152~156 各自从最新 master rebase |

---

## 工作量估计

**总计：~2-3 周**（含每 phase codex 对抗审查）

| Phase | 估计耗时 | 关键产物 |
|-------|---------|---------|
| Specify（本阶段） | 0.5 天 | spec.md（本文件） |
| Clarify | 0.5 天 | 解决 9 个 NEEDS CLARIFICATION（**Codex 审查后扩展自 6 → 9**） |
| Plan | 1-1.5 天 | plan.md（含 CallSite schema、call-resolver 算法、合并 shim 方案、generate 签名决策、edge directionality 方案、confidence 双轨映射、extractor 扩展决议） |
| Tasks | 0.5 天 | tasks.md（按 FR 拆 ~22-28 个 task，含 P0 master snapshot 录制 + extractor filesWithCalls 扩展） |
| Implement | 7-10 天 | 18+ 个改动文件落地（4 entry point bootstrap import 替换 + extractor 扩展 + 16 项原有改动）+ 12+ 单测 + baseline fixture 重跑 |
| Verify | 1-2 天 | accuracy / 双层 snapshot / perf 全部达标 |
| Codex review（每 phase 后） | 累计 1.5-2 天 | 5 次 review，critical 项当场修复（本次 spec 阶段已修复 2 critical + 5 warning + 1 info） |

---

*本 spec 由 specify 子代理基于 tech-research codebase-scan 报告 + 用户需求描述生成；首版后经 codex:codex-rescue 对抗审查（2026-05-06）发现 2 CRITICAL + 5 WARNING + 1 INFO 全部修复，扩展 NEEDS CLARIFICATION 6 → 9、EC 10 → 15。待 clarify 阶段解决 9 个 NEEDS CLARIFICATION 后进入 plan 阶段。*
