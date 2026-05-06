# Plan — Feature 151: Knowledge Graph 抽象 + UnifiedGraph + Python callSites

**生成日期**：2026-05-06
**对应 spec.md / clarification.md**：Codex 修订版（10 FR + 15 EC + 7 SC + 9 CL 全部已采纳）
**Plan 模式**：实施技术方案（不写实现代码，伪代码 + 模块边界 + 验收策略）

---

## 1. 目标与范围

### 1.1 实施目标

Feature 151 在仓内**新建 `src/knowledge-graph/` 模块**作为 4 语言 Knowledge Graph 能力的共享抽象层（UnifiedGraph schema + 4 阶段 call-resolver），并在 **Python LanguageAdapter** 上完整实现 callSites 抽取（self.method / Class.method / dunder / super / decorator / cross-module）。`panoramic/graph/*` 与 `component-view-builder` 重构为消费 `UnifiedGraph.edges` 的统一数据源；`DependencyGraph` 维持接口、内部 shim 到 UnifiedGraph；6 个 graph MCP tools 通过双层 snapshot 锁定行为（Layer A legacy 1:1 + Layer B calls-enabled 首版基线）；entry point bootstrap 收敛到 `src/runtime-bootstrap.ts`。

### 1.2 明确不做（与 spec.md §"明确不做" 严格一致）

- ts-js / go / java adapter 的 callSites 抽取（Feature 152 / 153 / 154 接力）
- Agent-Context MCP tools（`impact / context / detect_changes`，Feature 155）
- Incremental indexing + sqlite 持久化（Feature 156）
- 跨 repo group mode、SWE-Bench eval、新依赖（neo4j / sqlite 等）
- 修改 `*.ts / *.go / *.java` 的 mapper 或 adapter（仅 Python）

---

## 2. 整体架构图（文字版）

### 2.1 UnifiedGraph 在仓内位置

```
src/
├── knowledge-graph/                         <-- 本 Feature 新增模块（4 语言共享抽象）
│   ├── unified-graph.ts                     <-- UnifiedGraph / UnifiedNode / UnifiedEdge / CallSite zod schema
│   ├── call-resolver.ts                     <-- 4 阶段 resolveCalls(callSites, codeSkeletons): UnifiedEdge[]
│   └── index.ts                             <-- buildUnifiedGraph(input) 顶层入口 + 类型 re-export
│
├── models/
│   ├── code-skeleton.ts                     <-- 新增 CallSite schema + callSites?: CallSite[].optional()
│   └── dependency-graph.ts                  <-- 维持接口；shim 数据源切到 UnifiedGraph (CL-02)
│
├── core/
│   ├── tree-sitter-analyzer.ts              <-- MapperOptions 透传 extractCallSites flag (CL-05)
│   └── query-mappers/python-mapper.ts       <-- 新增 extractCallSites(rootNode, opts) 子流程
│
├── adapters/python-adapter.ts               <-- analyzeFile 透传 extractCallSites
│
├── panoramic/
│   ├── generator-registry.ts                <-- ComponentViewBuilderGenerator DI 注入 unifiedGraphProvider (CL-03)
│   ├── builders/component-view-builder.ts   <-- buildComponentRelationships() 改读 UnifiedGraph.edges
│   ├── batch-project-docs.ts                <-- bootstrap 调用收敛到 runtime-bootstrap (FR-10)
│   ├── pipelines/coverage-auditor.ts        <-- 同上
│   └── graph/                               <-- 重构为消费 UnifiedGraph
│       ├── graph-types.ts                   <-- GraphEdge.relation 加 'calls'，sources 加 'calls'，新增 directional?
│       ├── graph-builder.ts                 <-- 5 路数据源合并（含 callSites）
│       ├── graph-query.ts                   <-- 邻接表按 edge.directional 而非全局 directed
│       └── confidence-mapper.ts             <-- 新增 mapTierToConfidence(high|medium|low) (CL-08)
│
├── mcp/server.ts                            <-- bootstrap 改 import bootstrapRuntime (FR-10)
├── cli/index.ts                             <-- 同上
└── runtime-bootstrap.ts                     <-- 本 Feature 新增（FR-10）
```

### 2.2 数据流（端到端）

```
Python source files (.py)
  │
  ▼ tree-sitter-analyzer.analyze(filePath, 'python', { extractCallSites: true })
  │
  ▼ PythonMapper.map(rootNode, options)
  │   ├─ 既有：exports / imports / parseErrors / moduleDoc
  │   └─ 新增：extractCallSites(rootNode) → CallSite[]
  │
  ▼ CodeSkeleton { ..., callSites: CallSite[] }
  │
  ▼ src/knowledge-graph/index.ts: buildUnifiedGraph({ codeSkeletons, ... })
  │   ├─ 1. 收集所有 CodeSkeleton.callSites → flat CallSite[]
  │   ├─ 2. call-resolver.resolveCalls(callSites, codeSkeletons): 4 阶段 → UnifiedEdge[]
  │   └─ 3. 节点合并 + UnifiedGraph 输出
  │
  ▼ UnifiedGraph { nodes, edges (relation='calls' + 现有 9 种), metadata }
  │
  ├─► graph-builder.buildKnowledgeGraph(): 5 路合并（doc-graph + arch-ir + cross-ref + extraction + UnifiedGraph）
  │     │
  │     ▼ confidence-mapper.mapTierToConfidence(): high → EXTRACTED / medium → INFERRED / low → AMBIGUOUS
  │     │
  │     ▼ GraphJSON.links（含 directional 字段）
  │     │
  │     ▼ specs/_meta/graph.json
  │           │
  │           ▼ GraphQueryEngine（邻接表按 edge.directional）
  │                 │
  │                 ▼ 6 个 graph MCP tools（行为双层锁定）
  │
  ├─► component-view-builder.buildComponentRelationships()
  │     └─ 读 unifiedGraphProvider().edges（relation === 'calls' || 'depends-on'）
  │
  └─► DependencyGraph shim（PythonAdapter.buildDependencyGraph()）
        └─ 内部从 UnifiedGraph 派生 modules / edges / SCC / topologicalOrder / mermaidSource
```

### 2.3 模块职责一句话

| 模块 | 职责 |
|------|------|
| `src/knowledge-graph/unified-graph.ts` | 定义 UnifiedNode / UnifiedEdge / UnifiedGraph / CallSite 4 个核心 zod schema + TypeScript 类型 |
| `src/knowledge-graph/call-resolver.ts` | 语言无关的 4 阶段 call resolution（free / member / cross-module / MRO fallback） |
| `src/knowledge-graph/index.ts` | `buildUnifiedGraph(input)` 顶层入口；统一 export 给下游 panoramic / DependencyGraph shim 复用 |
| `src/runtime-bootstrap.ts` | `bootstrapRuntime()` 单一入口，串联 `bootstrapAdapters / bootstrapGenerators / bootstrapParsers` |
| `src/panoramic/graph/graph-builder.ts` | 5 路数据源合并器：把 UnifiedGraph.edges 转为 GraphJSON.links 并设置 directional |
| `src/panoramic/graph/graph-query.ts` | GraphQueryEngine 内存索引；邻接表构建按 `edge.directional` 决定单/双向 |
| `src/panoramic/graph/confidence-mapper.ts` | 双轨置信度映射：内部 `'high'/'medium'/'low'` → 外部 `EXTRACTED/INFERRED/AMBIGUOUS` |
| `src/panoramic/builders/component-view-builder.ts` | `buildComponentRelationships()` 改读 UnifiedGraph.edges（不再走 storedModules.imports 静态推断） |
| `scripts/lib/python-call-extractor.py` | truth-set 抽取器；本 Feature 新增 `filesWithCalls` 字段（CL-09）作为 SC-001 分母 |

---

## 3. 关键模块设计

### 3.1 `src/knowledge-graph/unified-graph.ts`（FR-1）

#### Zod schema 伪代码

```typescript
import { z } from 'zod';

// ─── ConfidenceTier（内部）───
export const ConfidenceTierSchema = z.enum(['high', 'medium', 'low']);
export type ConfidenceTier = z.infer<typeof ConfidenceTierSchema>;

// ─── CalleeKind（与 CL-01 严格对齐）───
export const CalleeKindSchema = z.enum([
  'free',          // 同模块顶层 free function
  'member',        // self.x / Class.x
  'cross-module',  // import 表查找命中
  'dunder',        // __add__ 等运算符触发
  'super',         // super() 链
  'decorator',     // 带参 decorator (@app.route(...))
  'unresolved',    // 4 阶段未命中兜底
]);
export type CalleeKind = z.infer<typeof CalleeKindSchema>;

// ─── CallSite（采集层；不存 confidence）───
export const CallSiteSchema = z.object({
  calleeName:     z.string().min(1),                  // 仅 symbol 名（不含路径）
  calleeKind:     CalleeKindSchema,
  line:           z.number().int().positive(),         // 必填，便于 precision 回溯
  column:         z.number().int().nonnegative().optional(),
  callerContext:  z.string().optional(),               // 所在 function/class qualified 名
  // confidence: 不在 CallSite 上，由 call-resolver 阶段计算后写入 UnifiedEdge
});
export type CallSite = z.infer<typeof CallSiteSchema>;

// ─── UnifiedNode ───
export const UnifiedNodeSchema = z.object({
  id:        z.string().min(1),
  label:     z.string().min(1),
  kind:      z.enum(['module', 'symbol', 'spec', 'component', 'package', 'service', 'document', 'api', 'api-schema', 'event', 'diagram']),
  language:  z.string().optional(),
  filePath:  z.string().optional(),
  metadata:  z.record(z.unknown()).default({}),
});
export type UnifiedNode = z.infer<typeof UnifiedNodeSchema>;

// ─── UnifiedEdge ───
export const UnifiedEdgeSchema = z.object({
  source:      z.string().min(1),
  target:      z.string().min(1),
  relation:    z.enum([
    'calls',                  // 本 Feature 新增
    'contains', 'cross-module', 'depends-on',
    'documents', 'references',
    'conceptually_related_to', 'rationale_for',
    'groups', 'deploys',
  ]),
  confidence:  ConfidenceTierSchema,
  directional: z.boolean().optional(),     // CL-07：edge 级方向性
  evidence:    z.string().max(200).optional(),
  weight:      z.number().optional(),
});
export type UnifiedEdge = z.infer<typeof UnifiedEdgeSchema>;

// ─── UnifiedGraph ───
export const UnifiedGraphMetadataSchema = z.object({
  generatedAt:   z.string().datetime(),
  projectRoot:   z.string().min(1),
  schemaVersion: z.literal('1.0'),
});

export const UnifiedGraphSchema = z.object({
  nodes:    z.array(UnifiedNodeSchema),
  edges:    z.array(UnifiedEdgeSchema),
  metadata: UnifiedGraphMetadataSchema,
});
export type UnifiedGraph = z.infer<typeof UnifiedGraphSchema>;
```

#### `directional` 字段语义

- `calls / depends-on / cross-module / contains` → 必须 `directional: true`
- 对称关系（`conceptually_related_to / rationale_for / groups`）→ `directional: false` 或不设
- GraphQueryEngine 邻接表构建时按 `edge.directional` 决定是否双向（详见 §3.6）；`GraphJSON.directed` 全局标志保持 `false` 不变（向后兼容）

#### 序列化策略

- in-memory：`UnifiedGraph` 对象直接传给消费者（不强制写盘）
- 序列化：仅在 `graph-builder.buildKnowledgeGraph()` 转 `GraphJSON.links` 时映射；UnifiedGraph 自身不单独写 `_meta/unified-graph.json`（避免双副本）

---

### 3.2 `src/knowledge-graph/call-resolver.ts`（FR-2）

#### 4 阶段算法详细伪代码

```typescript
export function resolveCalls(
  callSites: Array<CallSite & { callerFile: string }>,
  codeSkeletons: Map<string /* filePath */, CodeSkeleton>,
): UnifiedEdge[] {
  const edges: UnifiedEdge[] = [];
  // 预构建索引（1 次性）
  const moduleSymbolIndex = buildModuleSymbolIndex(codeSkeletons);  // file -> Set<exportName>
  const classMemberIndex = buildClassMemberIndex(codeSkeletons);    // file::Class -> Set<methodName>（**Codex C4 修订**：从 CodeSkeleton.exports[].members 派生，验证 callee 真存在）
  const importIndex = buildImportIndex(codeSkeletons);              // file -> { aliasName -> targetFile }
  const classMroIndex = buildClassMroIndex(codeSkeletons);          // file::Class -> ['Parent1', 'Parent2', ...]

  for (const cs of callSites) {
    const edge = resolveOne(cs, codeSkeletons, moduleSymbolIndex, importIndex, classMroIndex);
    if (edge) edges.push(edge);  // dynamic call / 解析失败时返回 null（skip）
  }
  return edges;
}

function resolveOne(
  cs: CallSite & { callerFile: string },
  ...indices,
): UnifiedEdge | null {
  // ─── Stage 1: free function（同模块顶层 callable）───
  // input: cs.calleeKind === 'free' && moduleSymbolIndex.get(cs.callerFile)?.has(cs.calleeName)
  // decision:
  //   - hit → confidence: 'high'，target = `${callerFile}::${calleeName}`
  if (cs.calleeKind === 'free') {
    const localExports = moduleSymbolIndex.get(cs.callerFile);
    if (localExports?.has(cs.calleeName)) {
      return mkEdge(cs, `${cs.callerFile}::${cs.calleeName}`, 'high');
    }
    // 否则 fallthrough 到 Stage 3
  }

  // ─── Stage 2: member（self.x / Class.x）───
  // input: cs.calleeKind === 'member' && cs.callerContext 含类名（如 "Value.__add__"）
  // decision（**Codex C4 修订**：必须验证 callee 是 class member，否则伪造 high）:
  //   - 类可定位（moduleSymbolIndex 含 className） + callee 在 classMemberIndex.get(file::Class) → 'high'
  //   - 类可定位但 callee 不在 class.members（可能继承自父类）→ 'medium'（unresolved 由 Stage 4 补救）
  //   - 类无法定位 → 'medium'（callerContext 缺失或 className 未导出）
  //   - 都不行 → 'low' fallthrough
  if (cs.calleeKind === 'member') {
    const className = extractClassName(cs.callerContext);
    if (className && moduleSymbolIndex.get(cs.callerFile)?.has(className)) {
      const classKey = `${cs.callerFile}::${className}`;
      const memberSet = classMemberIndex.get(classKey);
      if (memberSet?.has(cs.calleeName)) {
        // 类 + 方法都验证过，是 high
        return mkEdge(cs, `${cs.callerFile}::${className}.${cs.calleeName}`, 'high');
      }
      // 类存在但方法不在该类（可能继承自父类）→ 留给 Stage 4 super/MRO 解析；
      // 否则降为 medium 占位
      const mro = classMroIndex.get(classKey) ?? [];
      for (let i = 0; i < Math.min(mro.length, 8); i++) {
        const parentClassKey = resolveParentClassKey(mro[i], importIndex.get(cs.callerFile), classMemberIndex);
        if (parentClassKey && classMemberIndex.get(parentClassKey)?.has(cs.calleeName)) {
          // 继承命中：父类方法存在
          return mkEdge(cs, `${parentClassKey}.${cs.calleeName}`, 'medium');
        }
      }
      return mkEdge(cs, `${classKey}.${cs.calleeName}`, 'medium'); // 类存在但 callee 既不在自身也不在 MRO 父类，记 medium 占位
    }
    return mkEdge(cs, `?::${cs.calleeName}`, 'medium');
  }

  // ─── Stage 3: cross-module（import 表查找）───
  // input: cs.calleeKind === 'cross-module' || (Stage 1 fallthrough 且 importIndex 命中)
  const imports = importIndex.get(cs.callerFile);
  if (imports) {
    const targetFile = lookupImport(imports, cs.calleeName);  // 含 from X import Y / import X as alias
    if (targetFile) {
      // import * 通配 → confidence: 'low'（EC-13）
      const isStarImport = imports.isStarImport?.get(targetFile);
      const tier = isStarImport ? 'low' : 'medium';
      return mkEdge(cs, `${targetFile}::${cs.calleeName}`, tier);
    }
  }

  // ─── Stage 4: super() / MRO / unresolved 兜底 ───
  if (cs.calleeKind === 'super') {
    const className = extractClassName(cs.callerContext);
    if (className) {
      const mro = classMroIndex.get(`${cs.callerFile}::${className}`) ?? [];
      // ≤ 8 层 MRO 兜底（EC-4 死循环防护）
      for (let i = 0; i < Math.min(mro.length, 8); i++) {
        const parent = mro[i];
        const parentFile = resolveParentFile(parent, importIndex.get(cs.callerFile));
        if (parentFile && moduleSymbolIndex.get(parentFile)?.has(`${parent}.${cs.calleeName}`)) {
          return mkEdge(cs, `${parentFile}::${parent}.${cs.calleeName}`, 'low');
        }
      }
    }
  }

  // ─── unresolved 兜底（dunder 类型未知 / EC-3、EC-2 缺失 import 等）───
  if (cs.calleeKind === 'unresolved' || cs.calleeKind === 'dunder' || cs.calleeKind === 'decorator') {
    return mkEdge(cs, `?::${cs.calleeName}`, 'low');
  }

  // dynamic call (EC-12)：抽取层就不应输出此类（mapper 对 getattr/eval 直接 skip）
  // 若意外抵达此处，return null（不输出，不污染 precision）
  return null;
}

function mkEdge(cs, targetId, tier: ConfidenceTier): UnifiedEdge {
  return {
    source: `${cs.callerFile}::${cs.callerContext ?? '<module>'}`,
    target: targetId,
    relation: 'calls',
    confidence: tier,
    directional: true,
  };
}
```

#### Stage 决策表

| Stage | 条件 | output confidence |
|-------|------|------|
| 1 free | calleeKind=free 且 callee 在同模块 export | high |
| 2 member（类 + 方法双重验证）| calleeKind=member 且 className 在 moduleSymbolIndex 且 callee 在 classMemberIndex（**Codex C4 修订**） | high |
| 2 member（类存在但方法在 MRO 父类）| 自身 class members 不含 callee，但 ≤8 层 MRO 父类含 | medium |
| 2 member（类存在但 callee 既不在自身也不在 MRO 父类）| 类可定位但方法 unresolved | medium 占位 |
| 2 member（类无法定位）| callerContext 缺失或 className 未导出 | medium |
| 3 cross-module | import 表命中（非 star） | medium |
| 3 cross-module（import \*） | import * 通配 | low |
| 4 super MRO | super() 且 ≤ 8 层 MRO 命中父类方法 | low |
| 4 unresolved | dunder 类型未知 / decorator / 全部 fallthrough | low |
| dynamic call | getattr / eval / 字符串拼 callee | **null（skip）** |

---

### 3.3 `src/knowledge-graph/index.ts`（FR-3）

#### 入口签名

```typescript
export interface BuildUnifiedGraphInput {
  projectRoot: string;
  codeSkeletons: Map<string /* absoluteFilePath */, CodeSkeleton>;
  // 可选：复用 panoramic 已构建的节点（避免重复枚举）
  preBuiltNodes?: UnifiedNode[];
}

export function buildUnifiedGraph(input: BuildUnifiedGraphInput): UnifiedGraph {
  // 1. 收集所有 CallSite + callerFile
  const allCallSites = collectCallSites(input.codeSkeletons);

  // 2. resolveCalls → UnifiedEdge[]（calls 类型）
  const callEdges = resolveCalls(allCallSites, input.codeSkeletons);

  // 3. 派生 import / depends-on 边（**Codex C3 修订** —
  //    UnifiedGraph 必须包含 import 边，否则 DependencyGraph shim 无数据源；
  //    既有 batch-orchestrator / doc-graph-builder / delta-regenerator
  //    都消费 import 边，shim 不能只基于 calls）
  const importEdges = deriveImportEdges(input.codeSkeletons);
  // → 输入：每个 CodeSkeleton.imports[].resolvedPath
  // → 输出：UnifiedEdge { source: callerFile, target: resolvedPath,
  //                       relation: 'depends-on', confidence: 'high', directional: true }
  // 此函数把现有 PythonLanguageAdapter.buildDependencyGraph() 中
  // src/adapters/python-adapter.ts:240-267 的 import-edge 派生逻辑迁移到这里
  // （DependencyGraph shim 改为派生 view，见 §3.8 / Task 13）

  // 4. 构造 nodes（默认从 codeSkeletons 派生 module + symbol 节点；preBuiltNodes 时复用）
  const nodes = input.preBuiltNodes ?? deriveNodesFromSkeletons(input.codeSkeletons);

  // 5. 装配 UnifiedGraph
  return {
    nodes,
    edges: [...callEdges, ...importEdges],
    //         ^^^^^^^^^^   ^^^^^^^^^^^^
    //         calls 边     depends-on 边（FR-3 + Codex C3 修订）
    //         其他 relation（contains / cross-module / documents / references / etc.）
    //         继续由 graph-builder 在 4 路合并阶段（docGraph / architectureIR /
    //         crossReferenceLinks / UnifiedGraph）注入；UnifiedGraph 取代了
    //         原 extractionResults 数据源（仅 Python AST 节点）
    metadata: {
      generatedAt: new Date().toISOString(),
      projectRoot: input.projectRoot,
      schemaVersion: '1.0',
    },
  };
}
```

#### export 列表

```typescript
export {
  // schema + 类型
  UnifiedGraphSchema, UnifiedGraph,
  UnifiedNodeSchema,  UnifiedNode,
  UnifiedEdgeSchema,  UnifiedEdge,
  CallSiteSchema,     CallSite,
  CalleeKindSchema,   CalleeKind,
  ConfidenceTierSchema, ConfidenceTier,
  // resolver
  resolveCalls,
  // 入口
  buildUnifiedGraph,
};
```

---

### 3.4 `src/models/code-skeleton.ts` 改动（FR-4 + CL-01）

```typescript
// 在文件末尾新增（紧贴现有 ParseError 之后）
import type { CallSite } from '../knowledge-graph/unified-graph.js';
export { CallSiteSchema, type CallSite } from '../knowledge-graph/unified-graph.js';

// CodeSkeletonSchema 内增字段
export const CodeSkeletonSchema = z.object({
  // ... 现有 9 个字段保持不变
  callSites: z.array(CallSiteSchema).optional(),  // <-- 新增
});
```

**向后兼容验证**（NFR-3）：旧 baseline-skeleton JSON（无 `callSites`）调用 `CodeSkeletonSchema.parse()` 返回 `skeleton.callSites === undefined`，无 zod 异常。

> **注**：循环依赖检查 — `code-skeleton.ts` ←→ `knowledge-graph/unified-graph.ts`。建议把 `CallSite` 直接定义在 `code-skeleton.ts` 并由 `knowledge-graph/unified-graph.ts` re-export，避免 model 层依赖更新模块；plan 阶段倾向此方案，tasks 阶段精确定位。

---

### 3.5 `src/core/query-mappers/python-mapper.ts` 改动（FR-5 + CL-04 + CL-05）

#### 新增 `extractCallSites` 子流程

**Codex W-4 修订**：`extractCallSites` flag 必须在三层 options interface 都新增，且明确开启点：

```typescript
// 1. src/adapters/language-adapter.ts —— AnalyzeFileOptions 新增字段
export interface AnalyzeFileOptions {
  includePrivate?: boolean;
  extractCallSites?: boolean;  // 新增（CL-05）默认 false
}

// 2. src/core/tree-sitter-analyzer.ts —— TreeSitterAnalyzeOptions 新增字段
export interface TreeSitterAnalyzeOptions {
  includePrivate?: boolean;
  extractCallSites?: boolean;  // 新增；analyze() 透传到 mapper
}

// 3. src/core/query-mappers/*.ts —— MapperOptions 新增字段
export interface MapperOptions {
  includePrivate?: boolean;
  extractCallSites?: boolean;  // 新增
}

// 4. src/adapters/python-adapter.ts —— PythonAdapter.analyzeFile 透传
async analyzeFile(filePath: string, options?: AnalyzeFileOptions): Promise<CodeSkeleton> {
  return TreeSitterAnalyzer.getInstance().analyze(filePath, 'python', {
    includePrivate: options?.includePrivate,
    extractCallSites: options?.extractCallSites,  // 新增透传
  });
}
```

**开启点（哪些消费者传 true）**：
- `src/panoramic/batch-project-docs.ts` — batch panoramic 流水线，必须传 true（生成 graph.json 含 calls）
- `src/panoramic/pipelines/coverage-auditor.ts` — 同样需要 callSites
- `src/knowledge-graph/index.ts` 内部不直接调 analyzeFile，但其上游（panoramic batch）必须保证传 true
- 单测 `tests/unit/python-mapper-callsite.test.ts` — 显式传 true 测 extraction 行为
- 单测 `tests/unit/knowledge-graph/call-resolver.test.ts` — mock CallSite 数组，**不**调 analyzeFile

**关闭点（默认 false 的消费者）**：
- `src/diff/drift-orchestrator.ts` 调 analyzeFile 验证 baseline 漂移 — 不需要 callSites（节省 AST 遍历成本）
- 任何其他场景（CLI 单文件分析等）默认 false

```typescript
// PythonMapper.map() 内
public map(rootNode: Parser.SyntaxNode, options: MapperOptions): MapperResult {
  const result = this.mapExportsAndImports(rootNode, options);  // 既有逻辑
  if (options.extractCallSites) {                                // CL-05：默认 false
    result.callSites = this.extractCallSites(rootNode);
  }
  return result;
}

// 新增方法
private extractCallSites(rootNode: Parser.SyntaxNode): CallSite[] {
  const out: CallSite[] = [];
  const walk = (node: Parser.SyntaxNode, ctx: string | undefined) => {
    // 维护 callerContext（function_definition / class_definition 嵌套栈）
    const newCtx = updateContextOnEnter(node, ctx);

    switch (node.type) {
      case 'call':                  this.handleCall(node, newCtx, out); break;
      case 'binary_operator':       this.handleBinOp(node, newCtx, out); break;
      case 'unary_operator':        this.handleUnaryOp(node, newCtx, out); break;
      case 'decorated_definition':  this.handleDecorator(node, newCtx, out); break;
      // EC-15：async / generator 函数体内的 call 同样要遍历
      case 'async_function_definition':
      case 'function_definition':
      case 'class_definition':
        // 进入即更新 ctx，children 走默认遍历
        break;
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child, newCtx);
    }
  };
  walk(rootNode, undefined);
  return out;
}
```

#### AST 节点处理表

| node.type | 处理逻辑 | calleeKind |
|-----------|---------|----------|
| `call` (func 为 `identifier`) | callee = func.text，free 函数候选 | `free` |
| `call` (func 为 `attribute` 且 object=`self`) | callee = attr.text，记录 caller class | `member` |
| `call` (func 为 `attribute` 且 object=类名/模块名) | callee = attr.text；类名 → `member`，模块名 → `cross-module` | `member` / `cross-module` |
| `call` (func 为 `call`，且内层是 `super()` 形式) | super() 链解析 | `super` |
| `call` (func 为 `attribute` 且 object 由 `getattr/eval/globals` 派生) | **skip**（EC-12 dynamic call） | - |
| `binary_operator` | dunder 映射表（与 `python-call-extractor.py` BINOP_DUNDER 14 项 1:1）| `dunder` |
| `unary_operator` | UNARYOP_DUNDER 3 项 1:1 | `dunder` |
| `decorated_definition` 上的 decorator 子节点（带参，AST 是 `call`） | callee = func.attr 或 func.id（与 extractor L69 一致；CL-04） | `decorator` |
| `decorated_definition` 上的 bare decorator（AST 是 `attribute`/`identifier`） | **不记录**（CL-04）| - |
| `class_definition` 的 `superclasses` field（field name，而不是节点 type） | tree-sitter Python grammar 实际用 `superclasses: argument_list` 字段（**Codex W-3 修订**：原 plan 误写 `superclass_arguments`，仓内 `python-mapper.ts:90-99` 已通过 `node.childForFieldName('superclasses')` 拿到 argument_list 节点）| - |

#### EC-14 兜底（大文件 / 非 UTF-8 / parse error）

`tree-sitter-analyzer.ts:124-160` 当前用 `readFileSync(..., 'utf-8')` + `parser.parse()` 无 size guard。本 Feature 在 `analyze()` 内增加：

```typescript
// 文件大小阈值：1 MB（spec EC-14）
const MAX_PYTHON_FILE_BYTES = 1 * 1024 * 1024;
const stat = fs.statSync(filePath);
if (stat.size > MAX_PYTHON_FILE_BYTES && language === 'python') {
  return this.skeletonWithParseError(filePath, language, 'file-too-large');
}
// 非 UTF-8：readFileSync 已在 catch 抛出，沿用现有逻辑
// parse error：tree.rootNode.hasError → callSites = []，不阻塞 pipeline
```

#### EC-15 async / generator 覆盖

`async_function_definition` / `function_definition`（含 `yield`）AST 节点上 `call` 子节点遍历方式与普通 `function_definition` 一致；上述 walk 已覆盖。新增单测 ≥ 2 条（async + generator 各 1）。

---

### 3.6 `src/panoramic/graph/*` 重构（FR-6）

#### `graph-types.ts` 改动

```typescript
// 1. ConfidenceLevel 不变（外部 enum）
export type ConfidenceLevel = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

// 2. GraphEdge 新增 optional directional 字段
export interface GraphEdge {
  // ... 现有字段
  /** edge 级方向性（CL-07）；undefined 时按 GraphJSON.directed 兜底 */
  directional?: boolean;
}

// 3. GraphJSON.graph.sources 增加 'calls'
sources: ('architecture-ir' | 'doc-graph' | 'cross-reference' | 'extraction' | 'calls')[];

// 4. relation 现为 string，已合法兼容 'calls'；新增枚举常量供 graph-builder 引用
export const RELATION_CALLS = 'calls' as const;

// 5. 重新 export UnifiedGraph 类型供下游 1 处 import
export type { UnifiedGraph, UnifiedEdge } from '../../knowledge-graph/index.js';
```

#### `graph-builder.ts` 改动（5 路数据源合并）

```typescript
export interface BuildGraphOptions {
  // ... 现有 4 路
  unifiedGraph?: UnifiedGraph;   // <-- 第 5 路（FR-6）
}

export function buildKnowledgeGraph(options: BuildGraphOptions): GraphJSON {
  // ... 步骤 1-4 不变（doc-graph + arch-ir + cross-ref + extraction）

  // 步骤 5：合并 UnifiedGraph.edges（calls + 其他）
  if (options.unifiedGraph) {
    sources.push('calls');
    for (const node of options.unifiedGraph.nodes) {
      if (!nodeMap.has(node.id)) {
        nodeMap.set(node.id, mapUnifiedNodeToGraphNode(node));
      }
    }
    for (const edge of options.unifiedGraph.edges) {
      const key = edge.directional
        ? directedEdgeKey(edge.source, edge.target, edge.relation)
        : undirectedEdgeKey(edge.source, edge.target, edge.relation);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          source: edge.source,
          target: edge.target,
          relation: edge.relation,
          confidence: mapTierToConfidence(edge.confidence),  // CL-08
          confidenceScore: CONFIDENCE_SCORES[mapTierToConfidence(edge.confidence)],
          directional: edge.directional,
        });
      }
    }
  }
  // ...
}
```

**去重策略**：保持现有 `directedEdgeKey / undirectedEdgeKey` 两函数；按新增 `edge.directional` 字段选择 key 函数。`calls / depends-on / cross-module / contains` 走 directed key，其他走 undirected key。

#### `graph-query.ts` 改动（邻接表按 edge.directional）

替换 L185-194 的双向逻辑：

```typescript
for (const edge of graph.links) {
  const srcList = this.adjacency.get(edge.source);
  const tgtList = this.adjacency.get(edge.target);
  const isDirected = edge.directional ?? graph.directed;  // <-- CL-07：edge 优先

  if (srcList !== undefined) {
    srcList.push({ node: edge.target, edge });
  }
  if (!isDirected && tgtList !== undefined) {
    tgtList.push({ node: edge.source, edge });
  }
}
```

**向后兼容**：旧 graph.json 边无 `directional` 字段 → fallback 到 `graph.directed`（false）→ 双向，与现有行为完全一致。SC-004 Layer A 1:1 不破坏。

#### `confidence-mapper.ts` 改动（CL-08）

```typescript
/**
 * 将 UnifiedGraph 内部 ConfidenceTier 映射到 GraphJSON 输出 ConfidenceLevel。
 * CL-08：严格 1:1 映射，不引入 score 加权。
 */
export function mapTierToConfidence(
  tier: 'high' | 'medium' | 'low',
): ConfidenceLevel {
  switch (tier) {
    case 'high':   return 'EXTRACTED';
    case 'medium': return 'INFERRED';
    case 'low':    return 'AMBIGUOUS';
  }
}
```

> **注**：CONFIDENCE_SCORES 数值为 `EXTRACTED:0.95 / INFERRED:0.65 / AMBIGUOUS:0.25`（已 grep 核实，clarification.md CL-08 注释中 `1.0/0.7/0.4` 为引述偏差，不影响映射方向）。本函数复用现有 `CONFIDENCE_SCORES`，保持单一数值源。

---

### 3.7 `src/panoramic/builders/component-view-builder.ts` 重构（FR-7 + CL-03）

#### 改动点

```typescript
// 既有签名不变（保 DocumentGenerator<TInput, TOutput> 泛型）
export class ComponentViewBuilderGenerator implements DocumentGenerator<ArchitectureIR, ComponentViewOutput> {
  // 新增构造参数（DI 注入；GeneratorRegistry 在 register 时调用）
  constructor(private unifiedGraphProvider?: () => UnifiedGraph | null) {}

  async generate(input: ArchitectureIR, options: GenerateOptions): Promise<ComponentViewOutput> {
    const unifiedGraph = this.unifiedGraphProvider?.() ?? null;
    return buildComponentView({
      architectureIR: input,
      storedModules: options.storedModules ?? [],
      // 新增：透传 unifiedGraph
      unifiedGraph,
      // ...
    });
  }
}

// buildComponentView 内的 buildComponentRelationships 改造
function buildComponentRelationships(
  rankedComponents,
  storedModules,
  architectureIR,
  eventSurface,
  unifiedGraph: UnifiedGraph | null,   // <-- 新增
): ComponentRelationship[] {
  const relationships: ComponentRelationship[] = [];

  // 优先：从 UnifiedGraph 派生 calls + depends-on 边（取代 storedModules.imports 静态推断）
  if (unifiedGraph) {
    for (const edge of unifiedGraph.edges) {
      if (edge.relation !== 'calls' && edge.relation !== 'depends-on') continue;
      const fromComp = locateComponentByNodeId(rankedComponents, edge.source);
      const toComp   = locateComponentByNodeId(rankedComponents, edge.target);
      if (fromComp && toComp) {
        relationships.push({
          from: fromComp.id,
          to: toComp.id,
          label: edge.relation === 'calls' ? '调用' : '依赖',
          confidence: edge.confidence === 'high' ? 'high' : edge.confidence === 'medium' ? 'medium' : 'low',
          // ...
        });
      }
    }
  }

  // fallback / 互补：保留既有 ArchitectureIR + 规则推断 + eventSurface 路径（向后兼容）
  // ... 既有逻辑
  return dedupe(relationships);
}
```

**relationship 数量预期**（FR-7 验收）：切换后在 self-dogfood baseline 上数量 ≥ 切换前（因新增 calls 边），且旧 import-based 关系**全部能从 UnifiedGraph 重派生**（depends-on 边覆盖了原 imports 路径）。

---

### 3.8 GeneratorRegistry DI 注入设计（CL-03）

#### 既有 GeneratorRegistry 状况

读 `src/panoramic/generator-registry.ts:217-237`：当前 `bootstrapGenerators()` 直接 `registry.register(new ComponentViewBuilderGenerator())`，**无 per-generator 依赖注入机制**。需要最小改动。

#### 最小改动方案

**方案**：把 `ComponentViewBuilderGenerator` 的构造参数从 `()` 改为 `(unifiedGraphProvider?)`，`bootstrapGenerators()` 在 register 时传入 provider 函数。

```typescript
// generator-registry.ts:217 附近改动
import { getCurrentUnifiedGraph } from '../knowledge-graph/runtime-cache.js';  // 新增

// register 调用点（仅 1 处，影响面小）
registry.register(new ComponentViewBuilderGenerator(() => getCurrentUnifiedGraph()));
```

**`getCurrentUnifiedGraph()` 实现位置**：建议在 `src/knowledge-graph/index.ts` 暴露一个进程级单例 cache：

```typescript
let _cachedGraph: UnifiedGraph | null = null;
export function setCurrentUnifiedGraph(g: UnifiedGraph | null): void { _cachedGraph = g; }
export function getCurrentUnifiedGraph(): UnifiedGraph | null { return _cachedGraph; }
```

`batch-project-docs.ts` 在生成 graph.json 之前调用 `setCurrentUnifiedGraph(graph)`。

**Codex W-1 修订 — DI 注入必须覆盖 batch 直接调用路径**：
batch 主路径 `src/panoramic/batch-project-docs.ts:350-356` 直接 `new ComponentViewBuilderGenerator()` 不经过 registry（验证：grep 该文件确认）。如果只在 registry 注入 provider，batch 路径会用一个 provider 永远返回 null 的 generator 实例。必须**两条路径都注入**：

```typescript
// 1. registry 路径（CLI / MCP / coverage-auditor 走 GeneratorRegistry）
registry.register(new ComponentViewBuilderGenerator(() => getCurrentUnifiedGraph()));

// 2. batch 直接路径（batch-project-docs.ts:350-356 改造）
const generator = new ComponentViewBuilderGenerator(() => getCurrentUnifiedGraph());
const componentView = await generator.generate(architectureIR);
```

**影响面**：
- `generator-registry.ts:232` — register 调用点 1 处
- `batch-project-docs.ts:350-356` — 直接 new 调用点 1 处（**Codex W-1 新增**）
- ComponentViewBuilderGenerator 构造签名变更只影响这 2 处 + 测试。其他 19 个 Generator 不受影响。

> **替代**：tasks 阶段确认 `AbstractRegistry` 是否已有 `dependencies` 字段；若有，复用更优。当前 plan 推荐"构造参数 + 单例 cache"方案。

---

### 3.9 `src/runtime-bootstrap.ts`（FR-10）

#### 函数签名

```typescript
// src/runtime-bootstrap.ts （本 Feature 新增）
import { bootstrapAdapters } from './adapters/index.js';
import { bootstrapGenerators } from './panoramic/generator-registry.js';
import { bootstrapParsers } from './panoramic/parser-registry.js';

/**
 * 单一 runtime 初始化入口。所有 entry point（mcp/cli/batch/audit）必须调用此函数。
 * 幂等：内部 3 个 bootstrap 函数本身已幂等（registry 非空跳过）。
 */
export function bootstrapRuntime(outputDir?: string): void {
  bootstrapAdapters();
  bootstrapGenerators(outputDir);
  bootstrapParsers();
}
```

#### 4 个 entry point 改造

| Entry point | 当前调用（已 grep 验证） | 改造后 |
|-------------|-----|------|
| `src/mcp/server.ts:30-36` | 三处独立调用（L32/34/36） | `import { bootstrapRuntime }; bootstrapRuntime();` |
| `src/cli/index.ts` | bootstrap 散落在 `runBatchCommand / runGenerate` 等命令分发函数内 | 在 CLI 入口最早时机统一调用 `bootstrapRuntime(outputDir)` |
| `src/panoramic/batch-project-docs.ts:175` | `bootstrapGenerators()` 单点调用 | `bootstrapRuntime(outputDir)` |
| `src/panoramic/pipelines/coverage-auditor.ts:247` | `bootstrapGenerators()` 单点调用 | `bootstrapRuntime(outputDir)` |

**SC-007 验收 grep 命令**（已记入验收策略表）：

```bash
grep -rE "bootstrap(Adapters|Generators|Parsers)\(" src/ \
  | grep -v "src/runtime-bootstrap.ts"
# 期望：0 行命中
```

---

### 3.10 `scripts/lib/python-call-extractor.py` 扩展（CL-09）

当前 L98-126 输出 JSON 不含 `filesWithCalls`。改动 1 行（在 `print(json.dumps({...}))` 内新增）：

```python
print(json.dumps({
    "root": root,
    "fileCount": file_count,
    "filesWithCalls": len({x.split("::", 1)[0] for x in all_calls}),  # <-- 新增（CL-09）
    "imports": sorted(all_imports),
    "calls": sorted(all_calls),
    "uniqueImportTargets": len({x.split("::", 1)[1] for x in all_imports}),
    "uniqueCallTargets": len({x.split("::", 1)[1] for x in all_calls}),
    "skipped": skipped,
}, indent=2))
```

**backward-compat**：旧 graph-accuracy.mjs 消费方仅读取 `imports / calls`，新增字段被忽略；`filesWithCalls` 仅作为 SC-001 分母在新评估流程中读取。

**Codex W-2 修订 — accuracy.mjs 必须消费 `filesWithCalls`**：
当前 `scripts/graph-accuracy.mjs:200-216` 只读 `fileCount / imports / calls / uniqueCallTargets`，不读 `filesWithCalls`。本 Feature 必须在 accuracy.mjs 增加 SC-001 计算逻辑：

```javascript
// scripts/graph-accuracy.mjs 内新增（约 L216 之后）
function computeFillRate(extractor, graphJson) {
  // 分子：graph.json 中 callSites?.length > 0 的 .py 文件数
  const filesWithCallSites = new Set();
  for (const node of graphJson.nodes) {
    if (node.metadata?.codeSkeleton?.callSites?.length > 0) {
      filesWithCallSites.add(node.metadata.codeSkeleton.filePath);
    }
  }
  // 分母：extractor 输出的 filesWithCalls（含调用语句的 .py 文件总数）
  const denom = extractor.filesWithCalls ?? extractor.fileCount;  // 兼容老格式
  return {
    callsiteFillRate: filesWithCallSites.size / denom,
    filesWithCallSites: filesWithCallSites.size,
    denominator: denom,
  };
}
```

**新 CLI 选项**：`node scripts/graph-accuracy.mjs --source <root> --graph <graph.json> --metric fill-rate` 输出 SC-001 数据；默认行为（不传 --metric）保持向后兼容（仅算 precision/recall）。

---

### 3.11 6 graph MCP tools snapshot 测试（FR-9 + CL-06）

#### 测试文件设计

`tests/integration/graph-mcp-snapshot.test.ts`（本 Feature 新建）

```typescript
// **Codex C1 修订**：原方案"事后 filterOutCallEdges(raw)"无效——
// 因为 graph_query budget 截断（graph-query.ts:331-335）和 graph_god_nodes degree 排序
// （graph-query.ts:741-745）都基于含 calls 边的邻接表运行，结果集合已被污染，
// 事后过滤边无法还原 master 状态。
// 正确方案：构造 Layer A engine 时先把 calls 边从 graph.json 中剔除再 load。

describe('graph MCP tools snapshot', () => {
  let engineLayerA: GraphQueryEngine;  // 仅含 non-calls 边的 engine
  let engineLayerB: GraphQueryEngine;  // 含 calls 边的 engine
  beforeAll(() => {
    const rawJson = JSON.parse(readFileSync(SELF_DOGFOOD_GRAPH_PATH, 'utf-8')) as GraphJSON;
    // Layer A: 构造前过滤 calls 边
    const layerAJson = {
      ...rawJson,
      links: rawJson.links.filter(e => e.relation !== 'calls'),
      // 同时从 graph.sources 中移除 'calls'（保持 schema 一致）
      graph: { ...rawJson.graph, sources: rawJson.graph.sources.filter(s => s !== 'calls') },
    };
    engineLayerA = GraphQueryEngine.fromJSON(layerAJson);
    engineLayerB = GraphQueryEngine.fromJSON(rawJson);
  });

  // ─── Layer A: legacy 子图 1:1（在 calls 边过滤后的 engine 上运行）───
  it.each([
    ['graph_query',     (e) => e.query('batch-orchestrator', { budget: 30 })],
    ['graph_node',      (e) => e.getNode('src/batch/batch-orchestrator.ts')],
    ['graph_path',      (e) => e.findPath('src/cli/index.ts', 'src/mcp/server.ts')],
    ['graph_community', (e) => e.getCommunity('community_0')],
    ['graph_god_nodes', (e) => e.getGodNodes(5)],
    ['graph_hyperedges',(e) => e.getHyperedges()],
  ])('Layer A — %s legacy subgraph stable on calls-filtered engine', (name, fn) => {
    const result = fn(engineLayerA);
    expect(result).toMatchSnapshot(`layer-a-${name}`);
  });

  // ─── Layer B: calls-enabled 首版 snapshot（在含 calls 边的 engine 上运行）───
  it.each([
    ['graph_query',     (e) => e.query('batch-orchestrator', { budget: 30 })],
    ['graph_node',      (e) => e.getNode('src/batch/batch-orchestrator.ts')],
    ['graph_path',      (e) => e.findPath('src/cli/index.ts', 'src/mcp/server.ts')],
    ['graph_community', (e) => e.getCommunity('community_0')],
    ['graph_god_nodes', (e) => e.getGodNodes(5)],
    ['graph_hyperedges',(e) => e.getHyperedges()],
  ])('Layer B — %s calls-enabled baseline (含 calls 影响 degree/budget)', (name, fn) => {
    const result = fn(engineLayerB);
    expect(result).toMatchSnapshot(`layer-b-${name}`);
  });
});
```

**前置改造**：`GraphQueryEngine.loadFromFile()` 现签名读 path（见 `src/panoramic/graph/graph-query.ts`）；本测试需要从 in-memory `GraphJSON` 构造 engine，因此 tasks 阶段需新增 `GraphQueryEngine.fromJSON(json: GraphJSON): GraphQueryEngine` 工厂方法（极小改动，把现有 `loadFromFile` 内 `JSON.parse(readFileSync(...))` 后的逻辑抽出独立函数）。

#### 双层时序（CL-06）—— **Codex C1 修订**

**关键转变**：原方案要求"切到 master commit 录 baseline"，新方案不需要切 commit；Layer A snapshot 测试在含 calls 边的 graph.json 上构造 calls-filtered engine 即可。流程精简：

1. **P0 Task — 录 Layer A baseline**：
   - 在当前 worktree 跑 `npm run baseline:collect -- --target self-dogfood --mode full` 生成 graph.json（**重构后** master 的 graph.json 不含 calls 边——目前 master 还未引入 UnifiedGraph，此步等同于直接 load）
   - 实现 `GraphQueryEngine.fromJSON(json)` 工厂方法（小 task，约 10 行）
   - 写 `tests/integration/graph-mcp-snapshot.test.ts` 内 Layer A 部分（先 filter graph.json calls 边再构造 engine）
   - 跑 `npx vitest run tests/integration/graph-mcp-snapshot.test.ts -t "Layer A" -u` 录 6 份 Layer A snapshot
   - commit Layer A snapshot
2. **重构期间（P1-P2 task）**：UnifiedGraph + graph-builder 4 路合并 + DependencyGraph shim 落地
3. **P3 Task — 录 Layer B baseline + 验收 Layer A**：
   - 重新跑 baseline 生成 graph.json（**含 calls 边**）
   - 跑 `npx vitest run tests/integration/graph-mcp-snapshot.test.ts -t "Layer A"`：通过即证明 calls-filtered engine 输出与 P0 录的 baseline 完全一致（即"legacy 子图 1:1"）
   - 跑 `npx vitest run tests/integration/graph-mcp-snapshot.test.ts -t "Layer B" -u` 录 Layer B snapshot
   - commit Layer B snapshot

#### Score 漂移处理（SC-004 要求 ±10%）

由于 Layer A engine 已经在 calls-filtered 数据上构造，节点 / 边 ID 集合 1:1 是结构性保证；剩下的 score 字段漂移由 vitest snapshot serializer 处理：

```typescript
// vitest.config.ts 或 test setup 中
expect.addSnapshotSerializer({
  test: (val) => typeof val === 'object' && 'score' in val,
  serialize: (val, config, indent, depth, refs, printer) => {
    // 把 score 字段量化到 0.05 精度（≤ 10% 漂移容忍 → 取较高粒度避免过度敏感）
    return printer({ ...val, score: Math.round(val.score * 20) / 20 }, config, indent, depth, refs);
  },
});
```

或者更简单：snapshot 完全忽略 `score` 字段，验证后续 verify phase 单独检查 ±10% 漂移：

```typescript
// 或者把 score 替换为 placeholder 后再 toMatchSnapshot
function stripScore(o: any): any { /* 递归去除 score 字段 */ }
expect(stripScore(result)).toMatchSnapshot(`layer-a-${name}`);
```

---

## 4. 验收策略

| SC | 测量工具 | 数据源 | 通过门槛 | 重测策略 |
|----|---------|--------|---------|---------|
| **SC-001** callSites 填充率 | `python-call-extractor.py` 扩展后 `filesWithCalls` + `_meta/graph.json` 中 `CodeSkeleton.callSites?.length > 0` 计数 | micrograd（5 文件）+ nanoGPT（15 文件） | **≥ 95%**（分子 / `filesWithCalls`） | N=3 取均值 |
| **SC-002** call precision / recall | `node scripts/graph-accuracy.mjs --source <root> --graph specs/_meta/graph.json` | micrograd + nanoGPT 算术均值 | precision **≥ 70%** & recall **≥ 30%** | N=3 取中位数 |
| **SC-003** 单测全 pass | `npx vitest run` | 全仓 | 现有全 pass + 新增 ≥ 12 case 全 pass（≥ 7 Python + ≥ 5 共享抽象） | 单次 |
| **SC-004** 双层 snapshot | `npx vitest run tests/integration/graph-mcp-snapshot.test.ts` | self-dogfood | Layer A：过滤 calls 后节点/边 ID 集合 1:1，score ±10%；Layer B：首版锁定 | 单次（本 Feature 锁基线） |
| **SC-005** drift-orchestrator 旧 spec 兼容 | 单测 `tests/unit/diff/drift-orchestrator-old-spec.test.ts`（fixture：≥ 5 个 master 时代 spec.md） | `tests/fixtures/old-specs/` | 0 zod 异常 | 单次 |
| **SC-006** UnifiedGraph 性能回归 | `npm run baseline:diff -- old/full.json new/full.json` | nanoGPT 上 `perf.totalWallMs` | 相对 master 回归 **≤ 10%** | N=5 取中位数 |
| **SC-007** bootstrap 收敛 | `grep -rE 'bootstrap(Adapters\|Generators\|Parsers)\(' src/ \| grep -v 'src/runtime-bootstrap.ts'`（**Codex C2 修订**：单引号避免 bash 转义；扩展 regex `\|` 在 `()` 中无需 backslash） | `src/` | 命中 0 行；4 个 entry point 文件（mcp/server.ts、cli/index.ts、batch-project-docs.ts、coverage-auditor.ts）仅 import + 调用 `bootstrapRuntime()` | 单次 |

---

## 5. 实施顺序（关键路径排序）

**Codex W-5 修订**：在 task 列表里明确"运行时编译依赖"，避免 task 14 / 13 出现"编译 OK 但运行时语义错"。新增 task 6.5（DependencyGraph consumer grep 清单），并把 task 13/14 依赖前置：

| 序 | Task | 优先级 | 依赖 | 备注 |
|---|------|--------|------|------|
| 1 | 录 master snapshot Layer A baseline（FR-9 前置） | **P0** | — | 必须在 graph-builder 重构前；CL-06；**Codex C1 修订**：先 filter graph.json 再构造 engine |
| 2 | UnifiedGraph schema 定义（FR-1 + CL-01 + CL-07） | **P0** | — | 含 CallSite / UnifiedNode / UnifiedEdge / `directional` 字段 |
| 3 | CodeSkeleton 新增 `callSites?` optional（FR-4） | **P0** | (2) | 验证旧 spec.md zod 兼容 |
| 4 | `runtime-bootstrap.ts` + 4 entry point 改造（FR-10） | **P0** | — | 独立可平行；SC-007 验收 |
| 5 | `python-call-extractor.py` 扩展 `filesWithCalls` + accuracy.mjs 消费（CL-09 + **Codex W-2**） | **P0** | — | 1 行 Python + accuracy.mjs `--metric fill-rate` 选项；SC-001 分母 |
| 6 | DependencyGraph consumer 清单 grep + import edge 派生设计验证（**Codex C3 修订**） | **P0** | — | 验证 batch-orchestrator / doc-graph-builder / delta-regenerator 实际消费 import 边的字段；为 task 7 / 13 准备 deriveImportEdges 实现 |
| 7 | call-resolver 4 阶段（FR-2 + CL-04） + classMemberIndex（**Codex C4**）| P1 | (2)(3) | 含 super MRO ≤8 层兜底；Stage 2 必须验证 callee ∈ class.members 才 high |
| 8 | `knowledge-graph/index.ts` build pipeline（FR-3） — 同时产 calls + import 边（**Codex C3 修订**）| P1 | (6)(7) | `buildUnifiedGraph()` + setCurrentUnifiedGraph cache + `deriveImportEdges()` |
| 9 | Python mapper extractCallSites（FR-5 + CL-05 + **Codex W-3 / W-4**）| P1 | (3) | 三层 options 加字段；用 `superclasses` field（不是 `superclass_arguments` 节点）；含 EC-14 / EC-15 |
| 10 | `confidence-mapper.ts` 新增 `mapTierToConfidence`（CL-08） | P1 | (2) | 1:1 严格映射 |
| 11 | `graph-types.ts` 增 `'calls'` relation + `directional?` 字段（FR-6） | P2 | (2) | sources 加 'calls' |
| 12 | `graph-builder.ts` 4 路合并改造（FR-6）— UnifiedGraph 取代原 extractionResults 数据源 | P2 | (8)(10)(11) | 注意 UnifiedGraph 已含 calls + import 边，graph-builder 不再独立产 import 边 |
| 13 | `graph-query.ts` 邻接表按 `edge.directional`（CL-07） | P2 | (11) | L185-194 改造；同时新增 `GraphQueryEngine.fromJSON(json)` 工厂方法供 Layer A snapshot 测试用 |
| 14 | DependencyGraph shim 数据源切换（FR-8 + CL-02 + **Codex C3**）| P2 | (8) | 维持 `DependencyGraph` 接口；内部从 `getCurrentUnifiedGraph()` filter `relation === 'depends-on'` 派生 SCC / topologicalOrder / mermaidSource |
| 15 | `component-view-builder` 改读 UnifiedGraph + DI 注入（FR-7 + CL-03 + **Codex W-1**）| P2 | (8)(12) | GeneratorRegistry register 改 1 处 + batch-project-docs.ts:350-356 直接 new 路径改 1 处 |
| 16 | 录 Layer B snapshot + 验收 Layer A（FR-9 后半） | P3 | (12)(13)(15) | SC-004 |
| 17 | 重跑 micrograd / nanoGPT / self-dogfood baseline fixture（NFR-5） | P3 | (16) | 入库 `tests/baseline/<project>/spectra/full.json` |
| 18 | 跑 SC-001 / SC-002 / SC-006 验收 + codex review | P3 | (16)(17) | verify phase |

**关键编译 / 运行时依赖说明**：
- task 8 必须先于 task 12 / 14 / 15：UnifiedGraph 必须先有 `deriveImportEdges()` 实现，graph-builder / DependencyGraph shim / component-view-builder 才有 import 边可消费
- task 7 必须先于 task 8：buildUnifiedGraph 内部调用 resolveCalls
- task 13 必须先于 task 16：Layer A snapshot 测试用 `GraphQueryEngine.fromJSON(filteredJson)` 构造 engine
- task 6 是 task 8 的 spec 输入：buildUnifiedGraph 的 `deriveImportEdges` 实现需先确认 import edge 在哪些下游消费方被读到何字段

---

## 6. 风险与缓解

继承 spec.md 风险表，并基于 plan 阶段新发现增补：

| 风险 | 等级 | 缓解 |
|------|------|------|
| graph-builder 5 路合并破坏现有 score 算子 | 高 | snapshot 双层锁定（Layer A 1:1 / Layer B 首版基线）；超出 ±10% 时回到 plan 调整算子 |
| Edge directionality 与 `GraphJSON.directed` 全局开关冲突 | 高 | CL-07 已决议引入 `edge.directional`；graph-query.ts L185-194 改造点已识别 |
| UnifiedGraph 必须同时产出 calls + import 边，否则 DependencyGraph shim 无数据源（**Codex C3**）| 高 | task 8 实现 `deriveImportEdges`；task 6 先 grep DependencyGraph consumer 清单确认 |
| Stage 2 member 不验证 callee 是否在 class.members 会伪造 high confidence（**Codex C4**）| 高 | call-resolver 加 `classMemberIndex` 双重验证；Stage 2 必须方法存在才 high |
| Layer A snapshot 事后过滤 calls 边无效（**Codex C1**）| 高 | 改为构造 engine 前 filter graph.json；新增 `GraphQueryEngine.fromJSON()` 工厂 |
| GraphJSON 输出 confidence 必须保留 EXTRACTED/INFERRED/AMBIGUOUS enum + score（**Codex I-4 / 设计文档对齐**）| 中 | `mapTierToConfidence` 严格 1:1；GraphJSON 序列化层把 internal tier 转为 enum + score（设计文档 §3.1 / §4） |
| ComponentViewBuilderGenerator DI 注入需调整 1 处 register 调用 | 中 | CL-03 决议方案 B（registry register 时注入 provider）；影响面 1 处 |
| DependencyGraph shim consumer 清单（plan 阶段任务） | 中 | tasks 阶段加一个 task：`grep -r "DependencyGraph\|buildDependencyGraph" src/` 完整清单；如需扩展 shim 范围则 follow-up Feature |
| Python tree-sitter dunder 14+3 映射与 extractor 不一致 | 中 | 单测 `tests/unit/python-mapper-callsite.test.ts` 1:1 对齐 BINOP_DUNDER / UNARYOP_DUNDER 表 |
| Dynamic call (getattr/eval) 污染 precision | 中 | mapper 直接 skip（与 extractor 行为对齐）；EC-12 |
| 大文件 / 非 UTF-8 兜底（EC-14） | 中 | 1 MB 阈值（plan 决定）+ tree-sitter 抛错时 callSites=[]；plan §3.5 已伪代码化 |
| 性能回归 > 10%（多遍 AST 遍历） | 中 | extractCallSites flag 默认 false（CL-05），spec drift check 不跑；NFR-1 验收 N=5 重测 |
| micrograd / nanoGPT 体量小，N=3 仍可能不稳定 | 中 | 双 baseline 算术均值 + N=3 中位数；如观察到方差 > 5% 升至 N=5 |
| Layer A snapshot normalizer 漏过滤某条 calls 边导致假阳 | 中（**plan 新发现**） | normalizer 实现单测：构造含 calls + non-calls 边的 fixture，验证过滤后只剩 non-calls；CI 强制此单测先跑过再 verify Layer A |
| `code-skeleton.ts ↔ knowledge-graph/unified-graph.ts` 循环依赖 | 低（**plan 新发现**） | 把 CallSite 定义放 `code-skeleton.ts`，由 `unified-graph.ts` re-export；tasks 阶段精确放置 |

---

## 7. 工作量分解（粒度估算，非 task 级）

| 阶段 | 估计工作量 | 关键产物 |
|------|-----------|---------|
| Plan（本阶段） | 1-1.5 天 | plan.md（本文件） |
| Tasks | 0.5 天 | tasks.md（按 P0 → P3 拆 ~24 个 task） |
| Implement P0（5 个 task） | 1.5 天 | snapshot baseline + UnifiedGraph schema + CodeSkeleton 字段 + runtime-bootstrap + extractor 扩展 |
| Implement P1（4 个 task） | 2-3 天 | call-resolver + buildUnifiedGraph + Python mapper + confidence-mapper |
| Implement P2（5 个 task） | 2-3 天 | graph-types + graph-builder 5 路 + graph-query directional + DependencyGraph shim + component-view-builder |
| Implement P3（3 个 task） | 1-2 天 | Layer B snapshot 录 + baseline fixture 重跑 + SC 验收 |
| Codex review × 5（每 phase 后） | 累计 1.5 天 | 5 次 review，critical 当场修复 |
| **合计** | **~9-12 天**（spec → verify） | — |

---

## 8. 待 tasks 阶段细化的 TODO

1. **CallSite zod schema 精确字段**：plan 阶段已定 calleeName/calleeKind/line/column/callerContext 5 字段；tasks 阶段需 1:1 对齐 `code-skeleton.ts` 文件中其他 z.object 的 field 风格（min/optional/default）
2. **DependencyGraph consumer 清单 grep**：tasks 阶段第一个 P2 task 需先跑 `grep -rn "DependencyGraph\|buildDependencyGraph" src/` 输出完整清单，决定 shim 是否需扩展 follow-up
3. **GeneratorRegistry register 调用点确认**：tasks 阶段确认 `AbstractRegistry` 是否已有 `dependencies` 字段；若有则复用，否则按 plan §3.8 加构造参数 + 单例 cache
4. **EC-14 tree-sitter timeout guard**：plan 阶段决定 size 阈值 = 1 MB；tasks 阶段需决定是否再加 wall-clock timeout（建议 5 秒；超时整文件 skip）
5. **Layer A normalizer 实现细节**：tasks 阶段确认 `graph_god_nodes` / `graph_query` budget 截断的 score 字段在过滤 calls 边后是否需重算 degree（plan 阶段倾向"不重算，只 filter 边数组"，但需在 P3 验证时确认）
6. **`tests/fixtures/old-specs/` 5 个旧 spec.md 选取**：tasks 阶段需具体列出 5 个 master 时代 spec.md 文件（如 Feature 040/041/051/100/107 的 spec.md）作为 SC-005 fixture
7. **DI 注入 cache 是否引入新文件 `src/knowledge-graph/runtime-cache.ts`**：plan 倾向"在 `index.ts` 导出 setter/getter"避免新增小文件；tasks 阶段最终拍板

---

## 附 — Grep / Read 验证清单

本 plan 在编写时已直接 Read / 验证以下仓内文件存在性与关键行号：

| 文件 | 关键行/特征 | 验证状态 |
|------|----------|---------|
| `src/panoramic/graph/graph-types.ts` | GraphEdge/GraphJSON/ConfidenceLevel/SemanticEdgeRelation 类型定义；BuildGraphOptions 4 路输入 | 已读 ✅ |
| `src/panoramic/graph/graph-query.ts` | L185-194 邻接表双向逻辑（按 `graph.directed`） | 已读 ✅ |
| `src/panoramic/graph/confidence-mapper.ts` | CONFIDENCE_SCORES = {EXTRACTED:0.95/INFERRED:0.65/AMBIGUOUS:0.25} | 已读 ✅ |
| `src/panoramic/graph/graph-builder.ts` | directedEdgeKey/undirectedEdgeKey 函数；4 路数据源合并步骤 | 已读 ✅ |
| `src/panoramic/builders/component-view-builder.ts` | buildComponentRelationships() 当前路径 | 已读 ✅ |
| `src/panoramic/generator-registry.ts` | bootstrapGenerators L205；ComponentViewBuilderGenerator register L232 | 已读 ✅ |
| `src/models/code-skeleton.ts` | CodeSkeletonSchema 字段清单 | 已读 ✅ |
| `src/models/dependency-graph.ts` | DependencyGraph schema（含 mermaidSource/SCC/topologicalOrder） | 已读 ✅ |
| `src/core/query-mappers/python-mapper.ts` | 当前不提取 callSites；getDecorators / unwrapDecorated 既有方法 | 已读 ✅ |
| `src/core/tree-sitter-analyzer.ts` | analyze() L115-160；当前无 size guard | 已读 ✅ |
| `src/adapters/python-adapter.ts` | analyzeFile L46-54 委托 TreeSitterAnalyzer | 已读 ✅ |
| `src/mcp/server.ts` | L32/34/36 三处 bootstrap 调用 | 已读 ✅ |
| `scripts/lib/python-call-extractor.py` | BINOP_DUNDER 14 项 + UNARYOP_DUNDER 3 项；L118-126 当前输出无 filesWithCalls | 已读 ✅ |

---

*本 plan 由 plan 子代理基于 spec.md（codex 修订版）+ clarification.md（9 CL 全部已采纳）+ tech-research.md + 仓内 13 个关键文件 Read 验证生成。首版 plan 经 codex:codex-rescue 对抗审查（2026-05-06）发现 4 CRITICAL + 5 WARNING + 4 INFO，全部修复：*

- *C1 — Layer A snapshot 构造方式从"事后过滤 raw response"改为"构造 engine 前 filter graph.json"*
- *C2 — SC-007 grep 命令修正引号转义；entry point 4 文件清单确认*
- *C3 — buildUnifiedGraph 必须同时产出 calls 和 import/depends-on 边（新增 deriveImportEdges）；DependencyGraph shim 才有数据源*
- *C4 — call-resolver Stage 2 必须验证 callee 在 class.members（新增 classMemberIndex），否则伪造 high-confidence*
- *W1 — DI 注入覆盖 batch-project-docs.ts:350-356 直接 new 路径（非仅 registry 路径）*
- *W2 — accuracy.mjs 必须消费 filesWithCalls 字段（新增 --metric fill-rate 选项）*
- *W3 — Python tree-sitter 用 superclasses field（不是 superclass_arguments 节点）*
- *W4 — extractCallSites flag 在三层 options interface 都新增，开启点列清*
- *W5 — task 顺序新增 task 6（DependencyGraph consumer grep）+ 重排 task 12-15 依赖*

*下一步：codex 对抗审查（验证修订）+ tasks 阶段。*
