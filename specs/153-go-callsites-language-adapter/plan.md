# Feature 153 — Implementation Plan

**Feature Branch**: `claude/nervous-herschel-832b94`
**Created**: 2026-05-08
**Spec**: [spec.md](spec.md)（440 行；Codex 6 轮对抗审查 GATE_DESIGN PASS）
**Status**: Ready for Tasks

---

## 1. 目标与范围

### 1.1 实施目标

把 Feature 151 已经在 Python 上跑通的 callSites → UnifiedGraph calls 边链路扩展到 Go：

- mapper 端：`GoMapper.extractCallSites` 实现 11 行分类表 + receiver var 栈跟踪 + phantom call 防御
- adapter 端：`GoLanguageAdapter.analyzeFile` 透传 `extractCallSites` flag
- 验证端：`scripts/verify-feature-153.mjs` 端到端验证 GORM 顶层包 callPrecision ≥ 70% / callRecall ≥ 30% / callSites 填充率 ≥ 95%

### 1.2 明确不做（严格对齐 spec §"明确不做"）

- 不动 `unified-graph schema` / `call-resolver` / 其它语言 mapper
- 不实现 sqlite 持久化 / Agent-Context MCP tools / batch-orchestrator 集成
- 不实现 dunder / super / decorator（Go 无对应语义）
- 不动 Python skeleton collector
- 不为 dot import 引入特殊处理（接受 EC-Go-4 降级）
- 不要求 callRecall ≥ 50%
- 不实现 Go module path 解析（`go.mod` / GOPATH / vendor / replace）
- **不构造占位 sentinel target**（cross-module 接受 Stage 4 low fallback）

---

## 2. 整体架构图（文字版）

### 2.1 数据流（端到端）

```
.go 文件
   │
   ▼
GoLanguageAdapter.analyzeFile(filePath, { extractCallSites: true })   ← FR-4
   │
   ▼
TreeSitterAnalyzer.analyze(filePath, 'go', { extractCallSites: true })
   │
   ├─ parser.parse(content)  →  tree
   │
   ▼
GoMapper.extractExports(tree, content)        →  ExportSymbol[]
GoMapper.extractImports(tree, content)        →  ImportReference[]   (resolvedPath: null)
GoMapper.extractParseErrors(tree)             →  ParseError[]
GoMapper.extractCallSites(tree, content)      →  CallSite[]          ← FR-1 新增
   │
   ▼
CodeSkeleton (filePath / language='go' / exports / imports / callSites)
   │
   ▼ (verify 脚本端)
buildUnifiedGraph({ projectRoot, codeSkeletons })   ← Feature 151 不改
   │
   ├─ collectCallSites(codeSkeletons)          →  CallSiteWithFile[]
   ├─ resolveCalls(callSites, skeletons)       →  UnifiedEdge[] (calls)
   └─ deriveImportEdges(skeletons)             →  UnifiedEdge[] (depends-on)
   │
   ▼
UnifiedGraph (nodes + edges + metadata)
   │
   ▼ (verify 脚本对比)
extractGoCallSites({ sourceRoot, ignoreDirs })   ← Feature 150 不改
   │
   ▼
truth-set (TruthCall[])
   │
   ▼ (label-only matching)
verify-feature-153 → callPrecision / callRecall / fillRate / wallMs JSON
```

### 2.2 模块职责一句话

| 模块 | 职责 | 本 Feature 改动 |
|------|------|----------------|
| `src/adapters/go-adapter.ts` | Go LanguageAdapter 实例 | FR-4：透传 `extractCallSites` flag |
| `src/core/query-mappers/go-mapper.ts` | Go AST → CodeSkeleton 映射 | FR-1, 2, 3, 5, 6, 7：新增 `extractCallSites` + 辅助函数 |
| `src/core/tree-sitter-analyzer.ts` | mapper dispatcher | 不改（已支持 `mapper.extractCallSites`） |
| `src/models/call-site.ts` | CallSite Zod schema | 不改（Feature 151 已 ship） |
| `src/knowledge-graph/*` | UnifiedGraph + call-resolver | 不改（Feature 151 已 ship） |
| `scripts/lib/go-call-extractor.mjs` | Truth-set oracle | 不改（Feature 150 已 ship；本 Feature 仅作为 oracle 复用） |
| `scripts/verify-feature-153.mjs` | 端到端验收脚本 | FR-10, 11：新建 |
| `tests/core/query-mappers/go-mapper.test.ts` | mapper 单测 | FR-8：新增 ≥ 5 个 callSites 测试 |

---

## 3. 关键模块设计

### 3.1 `src/core/query-mappers/go-mapper.ts` — `extractCallSites` 方法（FR-1, 2, 3, 5, 6, 7）

#### 入口签名

```typescript
import type { CallSite, CalleeKind } from '../../models/call-site.js';

export class GoMapper implements QueryMapper {
  // ... 现有 extractExports / extractImports / extractParseErrors 不动

  /**
   * Feature 153 新增：抽取 Go 函数调用点。
   *
   * 行为对齐：
   * - scripts/lib/go-call-extractor.mjs 的 _classifyCallExpression / _scanImports / _resolveGoCaller
   * - call-resolver 4-stage 决策表（spec §FR-2 表格）
   *
   * Size guard: source.length > CALLSITES_MAX_FILE_BYTES → 返回 []（与 PythonMapper 一致）
   */
  extractCallSites(tree: Parser.Tree, source: string): CallSite[] {
    if (source.length > CALLSITES_MAX_FILE_BYTES) {
      return [];
    }
    const root = tree.rootNode;
    const importAliases = this._scanImports(root);
    const callSites: CallSite[] = [];
    const ctxStack: string[] = [];
    const recvVarStack: (string | null)[] = [];
    this._walkCallSites(root, ctxStack, recvVarStack, importAliases, callSites);
    return callSites;
  }
}
```

#### 内部辅助函数

```typescript
const CALLSITES_MAX_FILE_BYTES = 1_000_000;

const GO_REFLECTION_RECEIVERS = new Set(['reflect', 'unsafe']);

// FR-5: 扫描 import_declaration 收集 alias 集合
private _scanImports(root: Parser.SyntaxNode): Set<string> { ... }

// FR-7: 从 method_declaration receiver 提取 type 名（值/指针/嵌套指针/泛型/泛型指针）
private _extractReceiverTypeName(methodDecl: Parser.SyntaxNode): string | null { ... }

// FR-7: 从 method_declaration receiver 提取 var name（identifier 子节点）
private _extractReceiverVarName(methodDecl: Parser.SyntaxNode): string | null { ... }

// FR-1, 2: 递归遍历 AST，对 call_expression 产生 CallSite
private _walkCallSites(
  node: Parser.SyntaxNode,
  ctxStack: string[],
  recvVarStack: (string | null)[],
  importAliases: ReadonlySet<string>,
  out: CallSite[],
): void { ... }

// FR-2: 处理单个 call_expression（11 行分类表 short-circuit）
private _handleCall(
  node: Parser.SyntaxNode,
  callerContext: string | undefined,
  receiverVarName: string | null,
  importAliases: ReadonlySet<string>,
  out: CallSite[],
): void { ... }

// FR-2 行 #3, #4: 解开 parenthesized_expression → 内层 callee
private _classifyParenthesized(parenNode: Parser.SyntaxNode): {
  calleeKind: CalleeKind;
  calleeName: string;
  calleeQualifier?: string;
} { ... }

// FR-6: phantom call 检测
private _isPhantomCall(callExpr: Parser.SyntaxNode): boolean { ... }

// FR-1: 构造单个 CallSite 记录
private _mkCallSite(
  calleeName: string,
  calleeKind: CalleeKind,
  line: number,
  column: number,
  callerContext: string | undefined,
  calleeQualifier?: string,
): CallSite { ... }
```

#### `_walkCallSites` 伪代码（FR-7 try/finally 栈协议）

```typescript
private _walkCallSites(
  node: Parser.SyntaxNode,
  ctxStack: string[],
  recvVarStack: (string | null)[],
  importAliases: ReadonlySet<string>,
  out: CallSite[],
): void {
  let pushed = false;
  if (node.type === 'method_declaration') {
    const typeName = this._extractReceiverTypeName(node) ?? '<anon-method>';
    const methodName = fieldText(node, 'name') ?? '<anon-method>';
    const recvVar = this._extractReceiverVarName(node);
    ctxStack.push(`${typeName}.${methodName}`);
    recvVarStack.push(recvVar);
    pushed = true;
  } else if (node.type === 'function_declaration') {
    const fnName = fieldText(node, 'name') ?? '<anon-func>';
    ctxStack.push(fnName);
    recvVarStack.push(null);
    pushed = true;
  } else if (node.type === 'func_literal') {
    const line = node.startPosition.row + 1;
    const col = node.startPosition.column;
    ctxStack.push(`<closure:${line}:${col}>`);
    recvVarStack.push(null);
    pushed = true;
  }

  try {
    if (node.type === 'call_expression') {
      const callerCtx = ctxStack.length > 0 ? ctxStack[ctxStack.length - 1] : undefined;
      const recvVar = recvVarStack.length > 0 ? recvVarStack[recvVarStack.length - 1] : null;
      this._handleCall(node, callerCtx, recvVar, importAliases, out);
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) this._walkCallSites(child, ctxStack, recvVarStack, importAliases, out);
    }
  } finally {
    if (pushed) {
      ctxStack.pop();
      recvVarStack.pop();
    }
  }
}
```

#### `_handleCall` 伪代码（FR-2 11 行分类表 short-circuit）

```typescript
private _handleCall(
  node: Parser.SyntaxNode,
  callerContext: string | undefined,
  receiverVarName: string | null,
  importAliases: ReadonlySet<string>,
  out: CallSite[],
): void {
  // FR-6: phantom call 防御
  if (this._isPhantomCall(node)) return;

  const funcNode = node.childForFieldName('function');
  if (!funcNode) return;

  const line = node.startPosition.row + 1;
  const column = node.startPosition.column;

  // 行 #1: identifier callee → free
  if (funcNode.type === 'identifier') {
    out.push(this._mkCallSite(funcNode.text, 'free', line, column, callerContext));
    return;
  }

  // 行 #2: func_literal callee (IIFE) → free + <anon-func>
  if (funcNode.type === 'func_literal') {
    out.push(this._mkCallSite('<anon-func>', 'free', line, column, callerContext));
    return;
  }

  // 行 #3, #4: parenthesized_expression → unwrap inner
  if (funcNode.type === 'parenthesized_expression') {
    const cls = this._classifyParenthesized(funcNode);
    out.push(this._mkCallSite(cls.calleeName, cls.calleeKind, line, column, callerContext, cls.calleeQualifier));
    return;
  }

  // 行 #5, #6, #7, #8, #9: selector_expression
  if (funcNode.type === 'selector_expression') {
    const operandNode = funcNode.childForFieldName('operand');
    const fieldNode = funcNode.childForFieldName('field');
    if (!fieldNode) return;
    const calleeName = fieldNode.text;

    // 行 #5: reflect/unsafe → unresolved
    if (operandNode?.type === 'identifier' && GO_REFLECTION_RECEIVERS.has(operandNode.text)) {
      out.push(this._mkCallSite(calleeName, 'unresolved', line, column, callerContext));
      return;
    }

    // 行 #6: import alias → cross-module
    if (operandNode?.type === 'identifier' && importAliases.has(operandNode.text)) {
      out.push(this._mkCallSite(calleeName, 'cross-module', line, column, callerContext, operandNode.text));
      return;
    }

    // 行 #7: receiver var match → member + qualifier=undefined（让 resolver 用 callerContext）
    if (
      operandNode?.type === 'identifier' &&
      receiverVarName !== null &&
      operandNode.text === receiverVarName
    ) {
      out.push(this._mkCallSite(calleeName, 'member', line, column, callerContext));
      return;
    }

    // 行 #8: 其它 identifier operand（非 alias 非 receiver var）→ free
    if (operandNode?.type === 'identifier') {
      out.push(this._mkCallSite(calleeName, 'free', line, column, callerContext));
      return;
    }

    // 行 #9: 非 identifier operand（嵌套 selector / call / type_assertion 等）→ free
    out.push(this._mkCallSite(calleeName, 'free', line, column, callerContext));
    return;
  }

  // 行 #10: index_expression(operand=identifier X, index=type_arguments) → free + name=X
  // **Codex Round-7 WARNING B 实测注解**: tree-sitter-go grammar 实际把 `MakeMap[T]()` 解析为
  // `call_expression(function=identifier "MakeMap", type_arguments=..., arguments=...)` —
  // function field 直接是 identifier，所以会在行 #1 提前命中 → free + "MakeMap"，**不会进入行 #10**。
  // 但保留行 #10 作为兜底：覆盖未来 grammar 升级 / 罕见形态（如显式 generic instantiation 表达式
  // `M := Foo[T]; M()` 中外层 callee 可能是 index_expression）。
  if (funcNode.type === 'index_expression') {
    const operandNode = funcNode.childForFieldName('operand');
    const indexNode = funcNode.childForFieldName('index');
    if (
      operandNode?.type === 'identifier' &&
      (indexNode?.type === 'type_arguments' ||
        indexNode?.type === 'type_argument_list')
    ) {
      out.push(this._mkCallSite(operandNode.text, 'free', line, column, callerContext));
      return;
    }
    // 内层 operand 非 identifier → 行 #11
  }

  // 行 #11: 其它 / fallback → unresolved + 截断 text
  const rawText = typeof funcNode.text === 'string' ? funcNode.text : '<unknown>';
  const safeName = rawText.length <= 60 ? rawText : '<unknown>';
  out.push(this._mkCallSite(safeName, 'unresolved', line, column, callerContext));
}
```

#### `_classifyParenthesized` 伪代码（FR-2 行 #3, #4）

```typescript
private _classifyParenthesized(parenNode: Parser.SyntaxNode): {
  calleeKind: CalleeKind;
  calleeName: string;
  calleeQualifier?: string;
} {
  // 解开 parenthesized_expression
  let cursor: Parser.SyntaxNode | null = parenNode;
  while (cursor && cursor.type === 'parenthesized_expression') {
    cursor = cursor.namedChild(0);
  }
  if (!cursor) return { calleeKind: 'unresolved', calleeName: '<paren-callee>' };

  // 解开 unary_expression(*X)
  let target = cursor;
  if (cursor.type === 'unary_expression') {
    const operand = cursor.namedChild(0);
    if (operand) target = operand;
  }

  // identifier T → free
  if (target.type === 'identifier') {
    return { calleeKind: 'free', calleeName: target.text };
  }

  // selector_expression(pkg, T) → cross-module + qualifier=pkg
  if (target.type === 'selector_expression') {
    const operandNode = target.childForFieldName('operand');
    const fieldNode = target.childForFieldName('field');
    if (operandNode?.type === 'identifier' && fieldNode) {
      return {
        calleeKind: 'cross-module',
        calleeName: fieldNode.text,
        calleeQualifier: operandNode.text,
      };
    }
  }

  // 其它形态（pointer_type / qualified_type / generic_type 等罕见类型位置）→ unresolved
  return { calleeKind: 'unresolved', calleeName: '<paren-callee>' };
}
```

#### `_isPhantomCall` 伪代码（FR-6）

```typescript
private _isPhantomCall(callExpr: Parser.SyntaxNode): boolean {
  const fn = callExpr.childForFieldName('function');
  if (!fn) return true;
  if (fn.hasError === true) return true;

  // sibling ERROR 检查
  const parent = callExpr.parent;
  if (parent) {
    for (let i = 0; i < parent.namedChildCount; i++) {
      const sib = parent.namedChild(i);
      if (sib === callExpr || !sib) continue;
      if (sib.type === 'ERROR' || sib.type === 'MISSING') return true;
    }
  }
  return false;
}
```

### 3.2 `src/adapters/go-adapter.ts` — 透传 flag（FR-4）

**仅 1 行改动**：

```typescript
// Before
async analyzeFile(filePath: string, options?: AnalyzeFileOptions): Promise<CodeSkeleton> {
  const analyzer = TreeSitterAnalyzer.getInstance();
  return analyzer.analyze(filePath, 'go', {
    includePrivate: options?.includePrivate,
  });
}

// After
async analyzeFile(filePath: string, options?: AnalyzeFileOptions): Promise<CodeSkeleton> {
  const analyzer = TreeSitterAnalyzer.getInstance();
  return analyzer.analyze(filePath, 'go', {
    includePrivate: options?.includePrivate,
    extractCallSites: options?.extractCallSites,   // ← Feature 153 新增
  });
}
```

### 3.3 `tests/core/query-mappers/go-mapper.test.ts` — 单测（FR-8）

**新建文件**（参考 `tests/core/query-mappers/python-mapper.test.ts` 结构，如有；或参考 `tests/unit/lib/go-call-extractor.test.ts`）。

#### 必须覆盖的 5 个测试场景（与 spec FR-8 对齐）

```typescript
describe('GoMapper.extractCallSites', () => {
  it('1. regular function call → free + 同模块 callerContext', () => { ... });
  it('2. package-qualified call (fmt.Println) → cross-module + qualifier="fmt"', () => { ... });
  it('3. receiver method call ((s *Server) Start { s.GetAddr() }) → member + qualifier=undefined + callerContext="Server.Start"', () => { ... });
  it('4. interface method call (free function 上下文 w.Write(buf)) → free + qualifier=undefined', () => { ... });
  it('5. generic call (MakeMap[string, int]()) → free + name="MakeMap"', () => { ... });

  // 边界用例（推荐补充）
  it('6. reflect.ValueOf(x).Call(args) → unresolved', () => { ... });
  it('7. nested selector (s.listener.Accept()) → free + qualifier=undefined', () => { ... });
  it('8. parenthesized type conversion ((*Server)(nil) / (*pkg.T)(nil)) → free or cross-module', () => { ... });
  it('9. 大文件 size guard (> 1MB source) → 返回 []', () => { ... });
  it('10. extractCallSites=undefined / false 时不抽 callSites（向后兼容）', () => { ... });
});
```

#### 测试 fixture 策略

- **inline source fixture**：用 string literal 作为 Go source，直接调 `parser.parse()` + `mapper.extractCallSites()`，避免新增磁盘 fixture 文件
- **跨测试隔离**：每个 it 独立创建 GoMapper 实例（栈状态不共享）
- **不依赖 GORM**：单测只用最小 Go 片段，确保跑得快、可复现；GORM 端到端验证由 verify-feature-153.mjs 单独跑

### 3.4 `scripts/verify-feature-153.mjs` — 端到端验收（FR-10, 11）

#### 入口签名

```bash
node scripts/verify-feature-153.mjs \
  [--target ~/.spectra-baselines/gorm] \
  [--ignore-dirs callbacks,clause,internal,logger,migrator,schema,tests,utils] \
  [--repeats 3] \
  [--out summary.json]
```

#### 执行流程伪代码

```javascript
async function main() {
  const args = parseArgs(process.argv);
  const targetRoot = path.resolve(args.target ?? `${os.homedir()}/.spectra-baselines/gorm`);
  const ignoreDirs = args.ignoreDirs ?? [
    'callbacks', 'clause', 'internal', 'logger', 'migrator', 'schema', 'tests', 'utils',
  ];

  // 1. dist/.js dynamic import
  const { buildUnifiedGraph } = await import(`${projectRoot}/dist/knowledge-graph/index.js`);
  const { GoLanguageAdapter } = await import(`${projectRoot}/dist/adapters/go-adapter.js`);
  const { bootstrapRuntime } = await import(`${projectRoot}/dist/runtime-bootstrap.js`);
  bootstrapRuntime();

  // 2. 收集 .go 文件（用同 ignoreDirs 与 oracle 一致）
  const goFiles = collectGoFiles(targetRoot, ignoreDirs);

  // 3. analyzeFile + extractCallSites: true
  const adapter = new GoLanguageAdapter();
  const skeletons = new Map();
  const wallStart = performance.now();
  for (const filePath of goFiles) {
    const sk = await adapter.analyzeFile(filePath, { extractCallSites: true });
    skeletons.set(filePath, sk);
  }
  const wallMapperMs = performance.now() - wallStart;

  // 4. buildUnifiedGraph
  const ug = buildUnifiedGraph({ projectRoot: targetRoot, codeSkeletons: skeletons });

  // 5. fillRate 计算
  let filesWithCallSites = 0;
  let totalCallSites = 0;
  for (const sk of skeletons.values()) {
    if (sk.callSites && sk.callSites.length > 0) {
      filesWithCallSites++;
      totalCallSites += sk.callSites.length;
    }
  }
  const fillRate = goFiles.length > 0 ? filesWithCallSites / goFiles.length : 0;

  // 6. precision/recall N=3 重测
  const { extractGoCallSites } = await import(`${projectRoot}/scripts/lib/go-call-extractor.mjs`);
  const precisionRuns = [];
  const recallRuns = [];
  for (let run = 1; run <= (args.repeats ?? 3); run++) {
    const truth = await extractGoCallSites({ sourceRoot: targetRoot, ignoreDirs });
    const { precision, recall } = labelOnlyMatch(ug.edges, truth.truthCalls);
    precisionRuns.push(precision);
    recallRuns.push(recall);
  }

  // 7. 输出 summary（schema 严格对齐 verify-feature-151.mjs，避免合约漂移）
  const summary = {
    target: targetRoot,
    ignoreDirs,
    goFileCount: goFiles.length,
    skeletonsCount: skeletons.size,
    unifiedGraphNodes: ug.nodes.length,
    unifiedGraphCallsEdges: ug.edges.filter(e => e.relation === 'calls').length,
    callSitesTotal: totalCallSites,
    filesWithCallSites,
    truthFilesWithCalls: ...,         // 与 verify-151 同
    fillRate,
    fillRatePercent: (fillRate * 100).toFixed(1),
    wallMapperMs: wallMapperMs.toFixed(0),
    precisionRuns: precisionRuns.map(p => p.toFixed(3)),
    recallRuns: recallRuns.map(r => r.toFixed(3)),
    precisionMedian: median(precisionRuns).toFixed(3),
    recallMedian: median(recallRuns).toFixed(3),
    precisionMedianPercent: (median(precisionRuns) * 100).toFixed(1),
    recallMedianPercent: (median(recallRuns) * 100).toFixed(1),
    sampleHits: lastSampleHits,        // 与 verify-151 一致：最后一次 run 的 sample matched pairs
  };
  // FR-11 验收门槛通过 exit code 表达，不污染公共 summary schema（Codex Round-7 J 修订）
  const sc1Pass = fillRate >= 0.95;
  const sc2Pass = median(precisionRuns) >= 0.70 && median(recallRuns) >= 0.30;
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  // exit 0 = SC-1 + SC-2 都通过；exit 1 = 任一未通过（CI / 后续 Feature 用 exit code 判定）
  process.exit(sc1Pass && sc2Pass ? 0 : 1);
}
```

#### `labelOnlyMatch` 伪代码

```javascript
function labelOnlyMatch(graphEdges, truthCalls) {
  const callsEdges = graphEdges.filter(e => e.relation === 'calls');
  // graph caller / callee 提取
  const graphPairs = new Set(
    callsEdges.map(e => `${e.source}::${extractCalleeName(e.target)}`),
  );
  // truth 同形 (caller / callee)
  const truthPairs = new Set(
    truthCalls.map(t => `${t.caller}::${t.callee}`),
  );

  // 注：graph caller (file::Type.method) vs truth caller (rel/path.go:Type.method)
  // 需要一层归一化（plan 层不细化，tasks 阶段确定）
  const normalize = (graphCaller) => ...;

  const intersect = new Set(
    [...graphPairs].filter(p => truthPairs.has(normalize(p))),
  );

  const precision = graphPairs.size > 0 ? intersect.size / graphPairs.size : 0;
  const recall = truthPairs.size > 0 ? intersect.size / truthPairs.size : 0;
  return { precision, recall };
}
```

**caller 归一化合约**（Codex Round-7 WARNING F 锁定）：

- **graph 边 source 格式**（`call-resolver.mkEdge`）: `<absoluteFilePath>::<callerContext>`
  - 例: `/Users/foo/.spectra-baselines/gorm/finisher_api.go::DB.First`
  - callerContext 来源 mapper `_walkCallSites` 栈顶
- **truth-set caller 格式**（`go-call-extractor._resolveGoCaller`）: `<relPath>:<callerContext>`
  - 例: `finisher_api.go:DB.First`
  - relPath 是 POSIX-normalized `path.relative(sourceRoot, absPath)`
- **归一化规则**: `normalize(graphSource) = posixNormalize(path.relative(sourceRoot, absPath)) + ':' + callerContext`
  - 实施时 split graph source 由 `::` 分隔，用 sourceRoot 把 absPath → relPath
  - sourceRoot 在 verify 脚本主流程已知（`args.target`），传入 normalize 函数
- **配对算法**: `(caller, callee)` 二元组集合的 IoU
  - graph pair: `normalize(edge.source) → caller`，从 `edge.target` extract callee（split `::` 取 last segment）
  - truth pair: `truth.caller, truth.callee`
  - precision = `|graph ∩ truth| / |graph|`，recall = `|graph ∩ truth| / |truth|`
- **预期 mismatch 形式**: graph 端 `<absPath>::<closure:line:col>` 映射到 `<relPath>:<closure:line:col>`；truth 端格式 `<relPath>:<closure:line:col>` 已对齐
- **失败样例**（必须能识别）:
  - graph source 不含 `::` → 视为 module-level call（caller=`<top-level>`，与 extractor 默认 `<top-level>` 一致）
  - graph target callee 含 `?::Method`（resolver Stage 4 占位）→ extract 取 Method
  - truth callee 是 `<unknown>` / `<anon-func>` / `<paren-callee>` → 配对时按字面串匹配（mapper 与 extractor 都用同一占位字符串）

实施细节（伪代码 + 边界 fixture 测试）由 tasks T-015 完成。

---

## 4. 与 Feature 151 的依赖映射

| Feature 151 已 ship 的部件 | Feature 153 如何复用 |
|--------------------------|---------------------|
| `src/models/call-site.ts` (CallSite schema) | mapper.extractCallSites 输出符合此 schema |
| `src/knowledge-graph/unified-graph.ts` | 不动，verify 脚本用 buildUnifiedGraph |
| `src/knowledge-graph/call-resolver.ts` | 不动，resolver Stage 1-4 直接处理 Go callSites |
| `src/knowledge-graph/index.ts` (buildUnifiedGraph) | verify 脚本调用 |
| `src/runtime-bootstrap.ts` | verify 脚本调用 bootstrapRuntime |
| `src/core/tree-sitter-analyzer.ts` | 不动（已支持 mapper.extractCallSites） |
| `src/core/query-mappers/base-mapper.ts` (QueryMapper interface) | GoMapper 实现可选成员 |
| `scripts/verify-feature-151.mjs` | 作为 verify-feature-153.mjs 的 template 参考 |

| Feature 150 已 ship 的部件 | Feature 153 如何复用 |
|--------------------------|---------------------|
| `scripts/lib/go-call-extractor.mjs` | verify 脚本调用 `extractGoCallSites` 重生成 truth-set |
| `scripts/lib/extractor-helpers.mjs` (`walkSourceFiles` / `loadTreeSitterGrammar`) | extractor 内部已用 |
| `~/.spectra-baselines/gorm` | verify 默认 `--target` |

---

## 5. 性能与边界考虑

### 5.1 性能（NFR-1）

- mapper.extractCallSites 是独立 AST walk（不复用 extractExports 遍历）
- 单文件耗时 ≈ extractExports 同等数量级（同样 DFS + field 访问）
- GORM 顶层包 ≈ 25 文件，verify 总耗时（含 dist load + buildUnifiedGraph + extractor 重生成 truth-set + N=3 重跑）≤ 30 秒

### 5.2 内存（NFR-2）

- mapper 完成后 `ctxStack` / `recvVarStack` 自然释放（局部变量）
- 不引入全局 cache

### 5.3 兼容性（NFR-4）

- 不传 `extractCallSites` flag 时，`mapper.extractCallSites` 不被调用（tree-sitter-analyzer.ts:188-192 已守门）
- 传 flag 但 source > 1MB 时，mapper 返回 []（与 Python 一致）
- skeleton.callSites 字段始终是 `CallSite[] | undefined`，符合 `CodeSkeletonSchema.callSites: z.array(CallSiteSchema).optional()`

### 5.4 异常路径

| 场景 | 行为 |
|------|------|
| tree-sitter parse 失败 | rootNode.hasError=true；mapper 仍走 walk（FR-6），节点级 phantom 检测 skip 异常子树 |
| call_expression callee 缺失（ERROR 节点） | `_isPhantomCall` 返回 true，skip 抽取，children 仍 walk |
| receiver 无 var name | `_extractReceiverVarName` 返回 null，receiverVarStack 压 null，selector.operand != null 恒为 false → 落 #8 free |
| 嵌套 method（method 内嵌 closure 内嵌 method 不可能；但 closure 内嵌 closure 可能） | ctxStack / recvVarStack 同步 push/pop，try/finally 保证 |
| TS 严格模式 type 不通过 | `Set<string>` / `string | null` / `(string | null)[]` 全部声明显式类型 |

---

## 6. 测试策略

### 6.1 单元测试（FR-8）

- 至少 5 个核心场景 + 5 个边界场景 = ~10 个 it
- inline source string fixture（无磁盘文件）
- 每个 it 独立 mapper 实例

### 6.2 集成测试（端到端验证）

- `scripts/verify-feature-153.mjs` 在 `~/.spectra-baselines/gorm` 跑
- N=3 重测取中位数
- 输出 summary JSON 写入 `specs/153-go-callsites-language-adapter/verification/`

### 6.3 回归测试（FR-9）

- `npx vitest run` 全量必须 PASS（在 git rebase master 之后跑，以最新 master 基线为准）
- 现有 `tests/adapters/go-adapter.test.ts` / `tests/golden-master/golden-master.test.ts` 既有用例不修改、不破坏；允许 `tests/adapters/go-adapter.test.ts` 末尾**新增** 1 个 callSites 透传回归 describe block（FR-9 NFR-4 守门，详见 tasks T-013）

### 6.4 build 验证

- `npm run build` 无 TS 错误
- `npm run lint`（如配置）无错误

---

## 7. 风险与缓解（与 spec.md 风险表对齐）

见 [spec.md §依赖与风险](spec.md)。本 plan 不重复列出。

---

## 8. 实施顺序原则

1. **先做最小骨架**：`extractCallSites` 入口 + `_walkCallSites` 空壳（不抽 callSites，但栈协议跑通）
2. **再做行 #1, #2**：identifier / func_literal callee（最简单的 free 路径）
3. **加入 import alias 扫描 + 行 #6**：cross-module
4. **加入 receiver 提取 + 行 #7, #8**：member 与 free 区分
5. **加入嵌套 / 行 #3, #4, #9, #10, #11**：parenthesized / 嵌套 selector / generic / fallback
6. **加入 phantom call 防御 + 行 #5 reflect**：FR-6, FR-2 行 #5
7. **adapter 透传 flag**：FR-4
8. **写单测**（与 mapper 实现并行）
9. **写 verify-feature-153.mjs**：dist 链路 + truth-set 对比
10. **跑 verify 验证 SC-1/SC-2**

每步小步快跑：写完一行 → 写测试 → 跑 vitest → 通过 → 进入下一行。
