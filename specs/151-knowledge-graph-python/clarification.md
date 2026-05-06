# Clarification - Feature 151

**生成日期**：2026-05-06  
**对应 spec.md 版本**：Draft（Codex 对抗审查后，9 个 NEEDS CLARIFICATION 待解决）

---

## CL-01 — CallSite 类型字段精确 schema

**推荐答案**：

```typescript
interface CallSite {
  calleeName: string;           // 必填：仅 symbol 名（不含路径），如 "method" / "__add__"
  calleeKind: 'free' | 'member' | 'cross-module' | 'dunder' | 'super' | 'decorator' | 'unresolved'; // 必填
  line: number;                 // 必填：调用点行号，便于 call-resolver debug 和精度回溯
  column?: number;              // 可选：节省 schema 字节，tree-sitter 可提供但不作强制
  callerContext?: string;       // 可选：所在 function/class 名，多数情况可从 scope 推断；缺失时 call-resolver 降级
  confidence?: never;           // 不在 CallSite 级别存；confidence 在 call-resolver 4 阶段结果后计算并写入 UnifiedEdge
}
```

**理由**：
1. `calleeKind` 必填能让 call-resolver 直接路由到正确阶段（无需重复推断），减少 4 阶段内的重复 AST 分析；python-call-extractor.py 按 `ast.Call / BinOp / UnaryOp` 分类，与此枚举自然映射。
2. `line` 必填：micrograd 5 个文件的 call site 重叠率极高（`__add__` 等 dunder 在多处出现），无行号无法在 precision/recall 回溯时定位错误来源。
3. `column` 可选：tree-sitter `SyntaxNode.startPosition.column` 零成本可得，但 accuracy.mjs 当前不消费，plan 阶段可选实现。
4. `confidence` 不放 CallSite：python-call-extractor.py 输出无 confidence（只记录 callee 名），truth-set 对齐要求 confidence 在 call-resolver 解析后才确定；CallSite 是原始采集记录，不承载推断结论。

**替代方案**：
- A. `calleeName` 改为 `callee: { name, qualifier? }`（含 `self` / 类名限定符）——更精确但 schema 复杂度增加，plan 阶段如需要可升级。
- B. 去掉 `calleeKind`，让 call-resolver 自行从 `calleeName` 形式推断类型——实现简单但 resolver 需重复逻辑，不推荐。
- C. `confidence` 放 CallSite（提取时给初始估计值）——会与 resolver 阶段结果冲突，造成双轨混乱。

**风险等级（如果接受推荐）**：低

---

## CL-02 — DependencyGraph → UnifiedGraph 合并 shim 范围

**推荐答案**：

- **方案**：维持 `DependencyGraph` 接口不变（保留 `SCC / topologicalOrder / mermaidSource` 字段），内部数据源改为从 UnifiedGraph 派生（即 shim 层）。不降级为 derived view（因为 CLI 消费方多，降级需批量迁移）。
- **Python adapter `buildDependencyGraph()`**：保留，但内部改为调用 `buildUnifiedGraph()` 再映射到 `DependencyGraph` schema，作为过渡 shim。Feature 152~154 完成后再统一废弃。
- **DependencyGraph 的直接 CLI 消费者**：根据 tech-research §1.1，`graph-builder.ts` 本身不直接消费 `DependencyGraph`；实际消费方为 mermaid renderer 路径（通过 `mermaidSource` 字段）和 `spectra community` CLI 命令。plan 阶段需 `grep -r "DependencyGraph\|buildDependencyGraph" src/` 精确确认消费点清单后统一加 shim。
- **`SCC / topologicalOrder / mermaidSource` 保留位置**：留在 `DependencyGraph` shim 层，不迁移到 UnifiedGraph metadata（UnifiedGraph metadata 只放 `generatedAt / projectRoot / schemaVersion`）。

**理由**：tech-research §1.1 已确认 `DependencyGraph.mermaidSource` 被 CLI 渲染链消费，改接口风险高（中等）；维持接口换数据源是最小破坏面的 shim 方案，且与 Feature 152~154 的逐语言接力节奏吻合（不需要 Feature 151 一次性全部迁移）。

**替代方案**：
- A. 彻底废弃 `DependencyGraph`，全部消费方迁移到 UnifiedGraph API——Feature 151 scope 过大，风险高，不推荐。
- B. 把 SCC/topologicalOrder 计算移到 UnifiedGraph 的 `metadata.derived` 字段——接口更干净，但需同步改 CLI consumer，plan 阶段可作为 follow-up。

**风险等级（如果接受推荐）**：中（需在 plan 阶段确认完整 consumer 清单，防止遗漏）

---

## CL-03 — ComponentViewBuilderGenerator.generate 签名变更

**推荐答案**：

采用**方案 B（通过 GeneratorRegistry 在 register 时注入 UnifiedGraph 引用）**。

具体做法：在 `GeneratorRegistry.registerGenerator()` 时，为 `ComponentViewBuilderGenerator` 注入 `unifiedGraphProvider: () => UnifiedGraph | null`（懒加载 getter），`generate(input: ArchitectureIR)` 签名不变，内部通过 `this.unifiedGraphProvider?.()` 获取图数据。

**理由**：
1. 方案 A（扩展签名）打破 `DocumentGenerator<TInput, TOutput>` 泛型接口，影响所有调用方（`GeneratorRegistry.generate()` 的统一调用链），破坏面大。
2. 方案 C（升级 `ArchitectureIRWithGraph`）需要改 ArchitectureIR 类型定义和所有产生方，影响面同样大。
3. 方案 B 通过 DI（依赖注入）解耦，`generate` 签名不变，其他 Generator 无需修改；tech-research §1.3 已确认 `ComponentViewBuilderGenerator.generate()` 当前 `storedModules` 也是通过 registry 注入空数组的模式，沿用此模式最一致。

**替代方案**：
- 方案 A：扩展为 `generate(input: ArchitectureIR, unifiedGraph?: UnifiedGraph)`——打破泛型，不推荐。
- 方案 C：将 `ArchitectureIR` 升级为 `ArchitectureIRWithGraph`——改动面更大，不推荐。

**风险等级（如果接受推荐）**：中（需确认 `GeneratorRegistry` 支持按 generatorId 注入额外依赖，plan 阶段验证接口）

---

## CL-04 — decorator 在 Python call site 提取中的语义

**推荐答案**：

与 `python-call-extractor.py` 行为严格对齐（以避免 precision/recall 漂移）：

1. **带参 decorator（如 `@app.route("/x")`）**：callee 记录为 `app.route`（即 `node.func.attr`），**不含参数**。理由：extractor 第 69 行 `callee = node.func.attr`，对 `ast.Call` 类型只取 `.attr`，不含参数串。
2. **bare decorator（如 `@staticmethod` / `@property`）**：**计入 callSite**，callee 为 decorator 名本身（`staticmethod` / `property`）。理由：extractor 对 `ast.Call` 取 `func.id`，bare decorator 在被调用时实际上是 `ast.Call` 节点（Python AST 把 `@staticmethod def f` 表示为 `decorated_definition`，decorator 节点为 `ast.Name`——此时 extractor **不**记录，因为只处理 `ast.Call`）。
3. **精确结论（读完 extractor 源码后）**：extractor 仅处理 `isinstance(node, ast.Call)` 节点，bare decorator（如 `@staticmethod`）对应 AST `ast.Name` 节点，**不是 `ast.Call`，因此 extractor 不记录**；只有 `@app.route("/x")` 这种带调用语法的 decorator 才会被 extractor 记为 call（callee = `route`）。tree-sitter 实现应遵循同一语义。

**理由**：precision/recall 计算依赖 truth set，truth set 由 extractor 生成，实现不一致会人为压低 precision（多报 bare decorator）或 recall（少报带参 decorator）。

**替代方案**：
- 记录所有 decorator（含 bare）作为 callSite——与 extractor 不一致，会拉低 precision，不推荐。
- 完全跳过 decorator——会错过带参 decorator call，拉低 recall，不推荐。

**风险等级（如果接受推荐）**：低

---

## CL-05 — tree-sitter-analyzer.ts 的 callSites 透传选项

**推荐答案**：

在 `MapperOptions` 新增 `extractCallSites?: boolean`（**默认 false**），仅在需要 graph 构建时才开启。

具体：
- `PythonAdapter.analyzeFile(filePath, options?)` 透传 `options.extractCallSites` 给 `TreeSitterAnalyzer.analyze()`，再透传给 `PythonMapper.map()`。
- 在 panoramic 全量流水线（`batch-project-docs.ts`）调用时，自动设 `extractCallSites: true`。
- spec 阶段（`drift-orchestrator` 调用 `analyzeFile` 做 drift 检查）无需传此选项，默认不提取，避免开销。

**理由**：
1. tech-research §6.1 提到 bootstrap 函数现在散落在 2 个 entry point，说明当前 spec 阶段和 batch 阶段共享同一 `analyzeFile` 路径；若默认全开，所有 spec drift check 都会触发额外 AST 遍历（micrograd 5 文件影响小，但 self-dogfood ~250 个 .ts 文件中 Python 文件少，主要影响纯 Python 项目的 drift check）。
2. NFR-1 要求性能回归 ≤ 10%，call site 提取涉及额外 AST 遍历（binary_operator / unary_operator 节点遍历），在 nanoGPT 15 文件上预计增加 5~15% 遍历量；用 flag 规避非必要场景是稳妥做法。
3. 默认 false 对现有 `analyzeFile` 调用方（drift-orchestrator、ts-js/go/java adapter）完全无感，无需改动。

**替代方案**：
- 默认全开——实现简单，但会触发 NFR-1 回归风险（特别是在 spec drift check 的轻量场景）。
- 通过全局 feature flag（config yaml）控制——过度工程化，flag 管理成本高。

**风险等级（如果接受推荐）**：低

---

## CL-06 — 6 graph MCP tool snapshot 实现时机

**推荐答案**：

tech-research §5.3 已明确确认"仓内未找到 graph-mcp-snapshot.test.ts"。本 Feature 必须按以下顺序执行：

1. **P0 Task（tasks.md 第一优先级）**：在 master baseline（Feature 151 重构之前）上，新建 `tests/integration/graph-mcp-snapshot.test.ts`，录制 6 个 MCP tools 对 self-dogfood 的完整查询 raw response 作为 Layer A baseline（**不含 calls 边**，因为此时 graph.json 无 calls）。
2. **graph-builder 重构之后**：再跑同一套 test，录制 Layer B snapshot（calls-enabled，含 calls 边影响 degree 的完整结果）。
3. **snapshot 格式**：使用 vitest `toMatchSnapshot()`（自动管理 `__snapshots__/` 目录），不用手工 JSON fixture——原因是 vitest snapshot 有 diff 输出友好、--update-snapshots flag 方便更新的优势。

**理由**：spec.md §FR-9 明确要求"本 Feature 必须新建 tests/integration/graph-mcp-snapshot.test.ts"，且 Codex C-2 指出 Layer B 与 master 不可能 1:1（degree 变化）；P0 录制 baseline 是安全重构的前提，不能在重构后再补。

**替代方案**：
- 手工 JSON fixture（`tests/integration/fixtures/graph-mcp-baseline.json`）——diff 可读性差，更新流程繁琐。
- 推迟到 verify 阶段录制——重构已发生，Layer A 基线无法还原，不可接受。

**风险等级（如果接受推荐）**：低（只要 P0 task 排在所有 graph-builder 重构任务之前）

---

## CL-07 — Edge directionality 方案（Codex C-1）

**推荐答案**：

采用**方案 A（edge-level `directional?: boolean`）**：
- `calls / depends-on / cross-module / contains` 边：`directional: true`
- 其他对称关系（`conceptually_related_to / rationale_for / groups` 等）：`directional: false` 或不设（默认 false）
- `GraphQueryEngine` 邻接表构建（`graph-query.ts:185-194`）改为**按 edge.directional 而非全局 `GraphJSON.directed`** 判断是否双向建边。
- `GraphJSON.directed` 保持 `false` 不变（全局默认值，向后兼容）。

**理由**：
1. 方案 B（升 `GraphJSON.directed = true`）会把所有旧对称边（如 `conceptually_related_to`）改为单向边，破坏现有邻接表逻辑，影响 SC-004 Layer A 1:1 验证（旧查询结果会变）。
2. 方案 C（保留全局 false，query 层特判 `relation === 'calls'`）会在 GraphQueryEngine 中引入 hardcoded relation 名称，随着 relation 种类增多需要持续维护。
3. 方案 A 对现有旧边零破坏：旧边无 `directional` 字段，默认按全局 false（双向）处理，与当前行为完全一致；新增 calls 边设 `directional: true` 只影响新边。spec.md §FR-1 和 §Key Entities 已明确此方案为设计决策。

**替代方案**：
- 方案 B：`GraphJSON.directed = true` 全局——破坏 Layer A 1:1，不推荐。
- 方案 C：query 层 hardcode `relation === 'calls'` 特判——耦合高，不推荐。

**风险等级（如果接受推荐）**：低（`graphJSON.directed` 字段不变，GraphQueryEngine 改动最小化）

---

## CL-08 — Confidence 双轨 enum 映射规则（Codex W-1）

**推荐答案**：

严格 1:1 映射，不引入 score 加权差异：

| 内部 UnifiedGraph | 输出 GraphJSON（现有 ConfidenceLevel） |
|---|---|
| `'high'` | `EXTRACTED` |
| `'medium'` | `INFERRED` |
| `'low'` | `AMBIGUOUS` |

- 映射逻辑统一放在 `src/panoramic/graph/confidence-mapper.ts`（现有文件），新增 `mapUnifiedConfidence(c: 'high' | 'medium' | 'low'): ConfidenceLevel` 函数。
- **不重构现有 `mapDocConfidence / mapEvidenceConfidence`**，只新增函数，保持现有调用路径不变。
- 内部 UnifiedGraph 始终用 `'high' | 'medium' | 'low'` 字面量，不引入 `EXTRACTED/INFERRED/AMBIGUOUS` enum，避免两套 enum 在内部模块间混用。

**理由**：
1. tech-research §1.2 确认 `confidence-mapper.ts` 已有 `CONFIDENCE_SCORES`（**仓内实际值** `EXTRACTED: 0.95 / INFERRED: 0.65 / AMBIGUOUS: 0.25`，**analyze F-03 修订**：早先文档误写 1.0/0.7/0.4，验证依据：`src/panoramic/graph/confidence-mapper.ts:14-18`）；1:1 映射语义最清晰，后续调试 precision/recall 时能直接从 score 反推 confidence 阶段。
2. 不在内部统一为 `EXTRACTED/INFERRED/AMBIGUOUS` 的原因：这三个 enum 值含义偏向"证据质量"，而 `high/medium/low` 偏向"解析确定度"，两者语义不完全对等；强制内部统一会污染 call-resolver 的意图表达。

**替代方案**：
- 在内部全部用 `EXTRACTED/INFERRED/AMBIGUOUS`，省去映射——语义偏差会导致 resolver 代码难读。
- 引入 score 加权（high → 0.9 而非 1.0）——增加不必要的参数化，当前目标是 precision ≥ 70%，无需微调 score。

**风险等级（如果接受推荐）**：低

---

## CL-09 — python-call-extractor.py 是否扩展 filesWithCalls 字段

**推荐答案**：

**扩展 extractor，新增 `filesWithCalls` 字段**（推荐方案），作为 SC-001 填充率分母。

扩展内容：在 `main()` 函数的统计逻辑中，新增 per-file call 收集（当前是 `all_calls` 全局 set，导致 caller 文件信息被 merge 掉）。改为：

```python
files_with_calls = len({x.split("::")[0] for x in all_calls})
```

输出 JSON 新增字段：
```json
{
  "filesWithCalls": 4,   // 含至少一次 call 的 .py 文件数
  ...
}
```

plan 阶段新增一个 P0 task 覆盖此改动（约 5 行代码）。

**理由**：
1. 当前 `all_calls` 是全局 set，形如 `"engine.py::__add__"`，实际上已经含文件路径前缀，可直接派生 `filesWithCalls`，**改动量极小（1 行代码）**。
2. 用 `fileCount` 作为替代分母更宽松（包含了无 call 的文件，如空 `__init__.py`），会系统性低估填充率（micrograd 中 `__init__.py` 和 `test.py` 可能无 call），导致 SC-001 ≥ 95% 更难达到。
3. extractor 扩展不影响现有 `graph-accuracy.mjs` 的 precision/recall 计算（只新增字段，不改现有字段）。

**替代方案**：
- 用 `fileCount` 作为 SC-001 分母——更宽松但系统性低估，不推荐。
- 在 TypeScript 侧（graph-accuracy.mjs）独立统计 `filesWithCalls`——需要二次读取源码，且与 extractor 的静态分析结果可能不一致。

**风险等级（如果接受推荐）**：低（约 1 行 Python 改动，零兼容性风险）

---

## 摘要

| # | 问题 | 推荐选择 | 风险等级 |
|---|------|---------|---------|
| CL-01 | CallSite schema | calleeKind 必填 + line 必填 + column 可选 + confidence 不存在 CallSite 层 | 低 |
| CL-02 | DependencyGraph shim | 维持接口，换数据源（shim 方案），`buildDependencyGraph()` 保留 | 中 |
| CL-03 | generate 签名 | 方案 B（GeneratorRegistry DI 注入 UnifiedGraph） | 中 |
| CL-04 | decorator 语义 | 与 extractor 对齐：带参 decorator 记录 callee attr，bare decorator 不记录 | 低 |
| CL-05 | extractCallSites flag | `MapperOptions.extractCallSites?: boolean` 默认 false | 低 |
| CL-06 | snapshot 时机 | P0 task 先录 Layer A baseline，重构后录 Layer B；vitest snapshot 格式 | 低 |
| CL-07 | Edge directionality | 方案 A：edge-level `directional?: boolean`，全局 directed 不变 | 低 |
| CL-08 | Confidence 双轨映射 | 严格 1:1：high→EXTRACTED / medium→INFERRED / low→AMBIGUOUS | 低 |
| CL-09 | filesWithCalls 字段 | 扩展 extractor（约 1 行 Python），plan P0 task 覆盖 | 低 |
