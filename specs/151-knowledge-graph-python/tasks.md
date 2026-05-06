# Tasks — Feature 151: Knowledge Graph 抽象 + UnifiedGraph + Python callSites

**生成日期**：2026-05-06
**对应 plan.md 版本**：Codex 修订版（4 CRITICAL + 5 WARNING + 4 INFO 全部修复）
**Task 总数**：28 个主 task / 39 个子任务（**Codex 修订后**：spec→plan→tasks 演进 17 → 18 → 28 主 task；增加 T-008c batch 集成、T-009d 生产路径开启、T-014/T-015b 修订）
**关键路径预估工时**：~9-12 天（含单测 + codex review）

---

## 关键路径概览

```
P0（并行准备）→ P1（共享抽象，部分并行）→ P2（重构，高度串行）→ P3（验收与锁定）
    ↓                   ↓                        ↓                    ↓
 T-001 ~ T-006      T-007 ~ T-010            T-011 ~ T-015        T-016 ~ T-018
 约 2 天            约 3 天                  约 3 天              约 2 天
```

**关键串行链**（不可并行，**Codex W-2 修订** — 重排为实际存在的 task ID）：
`T-001c → T-008b → T-009d → T-013a → T-013b → T-015b → T-016a → T-016b → T-017 → T-018c`

**Codex C-1 修订**：在 P1 阶段新增 **T-009d**（生产路径开启 callSites）和 **T-008c**（batch-orchestrator 集成 buildUnifiedGraph + setCurrentUnifiedGraph + 传 unifiedGraph 给 buildKnowledgeGraph），否则单测过但生产路径完全没产 calls 边。

---

## 阶段一：P0 — 准备与基础设施

> 目标：在任何 graph-builder 重构之前，锁定 Layer A baseline snapshot；同时铺好 UnifiedGraph schema、CodeSkeleton 字段、runtime-bootstrap、extractor 扩展 5 块独立基础。

### T-001 录制 Layer A baseline snapshot（前置）

**分解为 3 个子任务**

---

**T-001a** — 实现 `GraphQueryEngine.fromJSON()` 工厂方法

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-9, SC-004（Layer A 验收前置） |
| **优先级** | P0 |
| **依赖** | 无 |
| **工时** | 0.5h |
| **验收标准** | `npx vitest run` 通过；新增单测：构造含 calls + non-calls 边的 mock GraphJSON，`GraphQueryEngine.fromJSON(json).query(...)` 正常返回，不抛错 |
| **关联文件** | `src/panoramic/graph/graph-query.ts`（新增 `fromJSON` 静态方法，约 10 行；把现有 `loadFromFile` 内 JSON.parse 后的逻辑抽出） |

---

**T-001b** — 新建 `graph-mcp-snapshot.test.ts` Layer A 骨架 + normalizer（**Codex W-1 修订**：Layer B 暂 skip）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-9, SC-004（CL-06）|
| **优先级** | P0 |
| **依赖** | T-001a |
| **工时** | 1h |
| **验收标准** | `tests/integration/graph-mcp-snapshot.test.ts` 文件存在；**Layer A** `it.each` 完整可运行；**Layer B** `it.each` 用 `it.skip.each` 占位标 `// TODO(T-016b): 录制 calls-enabled 首版 baseline`（避免 T-004d 全量 vitest run 时把 Layer B 计为 fail）；包含 `filterCallsEdges()` normalizer 函数；normalizer 单测通过（构造含 calls 边 fixture → 过滤后只剩 non-calls 边）|
| **关联文件** | `tests/integration/graph-mcp-snapshot.test.ts`（新建），`tests/unit/integration/graph-mcp-normalizer.test.ts`（normalizer 单测） |

---

**T-001c** — 跑 baseline 生成 graph.json + 录制 Layer A snapshot（`-u`）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | SC-004 |
| **优先级** | P0 |
| **依赖** | T-001b |
| **工时** | 0.5h |
| **验收标准** | 执行 `npm run baseline:collect -- --target self-dogfood --mode full` 生成 graph.json；再执行 `npx vitest run tests/integration/graph-mcp-snapshot.test.ts -t "Layer A" -u` 录制 6 份 Layer A snapshot；commit 包含 `__snapshots__/graph-mcp-snapshot.test.ts.snap`（含 6 个 layer-a-* 条目）|
| **关联文件** | `tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap`（新建） |

---

### T-002 UnifiedGraph schema 定义（FR-1 + CL-01 + CL-07）

**分解为 2 个子任务**

---

**T-002a** — `src/knowledge-graph/unified-graph.ts` Zod schema 实现

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-1, FR-4（CallSite 定义先于 CodeSkeleton 字段） |
| **优先级** | P0 |
| **依赖** | 无（可与 T-001a 并行） |
| **工时** | 1h |
| **验收标准** | `npx tsc --noEmit` 零错误；文件包含 `ConfidenceTierSchema / CalleeKindSchema / CallSiteSchema / UnifiedNodeSchema / UnifiedEdgeSchema / UnifiedGraphSchema` 6 个 zod schema + 对应 TypeScript 类型；`calls / depends-on / cross-module / contains` 边在 `directional: true` 验证通过 |
| **关联文件** | `src/knowledge-graph/unified-graph.ts`（新建） |

---

**T-002b** — `unified-graph.ts` roundtrip 单测（≥ 3 case）+ directional 边验证

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-1, SC-003（新增 ≥ 3 单测计入 12 个总要求） |
| **优先级** | P0 |
| **依赖** | T-002a |
| **工时** | 0.5h |
| **验收标准** | `npx vitest run tests/unit/knowledge-graph/unified-graph.test.ts` 通过；覆盖：(1) schema roundtrip serialize → deserialize 字段无损；(2) confidence 三档合法 / 第四档非法；(3) directional=true 的 calls 边 parse 成功；≥ 3 test case |
| **关联文件** | `tests/unit/knowledge-graph/unified-graph.test.ts`（新建） |

---

### T-003 CodeSkeleton 新增 `callSites?` optional 字段（FR-4）

**分解为 2 个子任务**

---

**T-003a** — `src/models/code-skeleton.ts` 加 `callSites?` 字段

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-4, SC-005（旧 spec.md 兼容） |
| **优先级** | P0 |
| **依赖** | T-002a（CallSite 定义必须先存在） |
| **工时** | 0.5h |
| **验收标准** | `npx tsc --noEmit` 零错误；`CodeSkeletonSchema` 包含 `callSites: z.array(CallSiteSchema).optional()`；**注**：`CallSite` 定义放 `code-skeleton.ts`（避免循环依赖），由 `unified-graph.ts` re-export |
| **关联文件** | `src/models/code-skeleton.ts` |

---

**T-003b** — drift-orchestrator 兼容单测（≥ 5 个旧 spec fixture）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | SC-005, NFR-3 |
| **优先级** | P0 |
| **依赖** | T-003a |
| **工时** | 0.5h |
| **验收标准** | `npx vitest run tests/unit/diff/drift-orchestrator-old-spec.test.ts` 通过；fixtures 为 Feature 040/041/051/100/107 的 spec.md 各取 baseline-skeleton JSON；5 个旧 JSON 全部 `CodeSkeletonSchema.parse()` 成功，`skeleton.callSites === undefined`，0 个 Zod 异常 |
| **关联文件** | `tests/unit/diff/drift-orchestrator-old-spec.test.ts`（新建），`tests/fixtures/old-specs/`（新建 5 个旧 spec fixture JSON） |

---

### T-004 runtime-bootstrap.ts + 4 entry point 改造（FR-10）

**分解为 4 个子任务**

---

**T-004a** — 新建 `src/runtime-bootstrap.ts`

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-10, SC-007 |
| **优先级** | P0 |
| **依赖** | 无（可与 T-001/T-002 并行） |
| **工时** | 0.5h |
| **验收标准** | `npx tsc --noEmit` 零错误；文件包含 `bootstrapRuntime(outputDir?: string): void` 函数，调用 `bootstrapAdapters / bootstrapGenerators / bootstrapParsers`；函数幂等（内部 3 个 bootstrap 本身幂等） |
| **关联文件** | `src/runtime-bootstrap.ts`（新建） |

---

**T-004b** — 改造 `src/mcp/server.ts` + `src/cli/index.ts`

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-10, SC-007 |
| **优先级** | P0 |
| **依赖** | T-004a |
| **工时** | 0.5h |
| **验收标准** | `src/mcp/server.ts` L32/34/36 原三处独立 bootstrap 调用替换为单一 `bootstrapRuntime()` import + 调用；`src/cli/index.ts` 在 CLI 入口最早时机统一调用 `bootstrapRuntime(outputDir)`；`npx tsc --noEmit` 零错误 |
| **关联文件** | `src/mcp/server.ts`，`src/cli/index.ts` |

---

**T-004c** — 改造 `src/panoramic/batch-project-docs.ts` + `coverage-auditor.ts`

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-10, SC-007 |
| **优先级** | P0 |
| **依赖** | T-004a |
| **工时** | 0.5h |
| **验收标准** | `src/panoramic/batch-project-docs.ts:175` 原 `bootstrapGenerators()` 调用替换为 `bootstrapRuntime(outputDir)`；`src/panoramic/pipelines/coverage-auditor.ts:247` 同上；`npx tsc --noEmit` 零错误 |
| **关联文件** | `src/panoramic/batch-project-docs.ts`，`src/panoramic/pipelines/coverage-auditor.ts` |

---

**T-004d** — SC-007 grep 验收

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | SC-007 |
| **优先级** | P0 |
| **依赖** | T-004b，T-004c |
| **工时** | 0.5h |
| **验收标准** | 执行 `grep -rE "bootstrap(Adapters\|Generators\|Parsers)\(" src/ \| grep -v "src/runtime-bootstrap.ts"` 输出 0 行；`npx vitest run` 全量单测通过（现有 ≥ 47 个零新增失败） |
| **关联文件** | 无新建文件（验收命令） |

---

### T-005 python-call-extractor.py 扩展 + accuracy.mjs 消费（CL-09 + Codex W-2）

**分解为 2 个子任务**

---

**T-005a** — `scripts/lib/python-call-extractor.py` 新增 `filesWithCalls` 字段

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | SC-001（分母来源） |
| **优先级** | P0 |
| **依赖** | 无 |
| **工时** | 0.5h |
| **验收标准** | `python3 scripts/lib/python-call-extractor.py ~/.spectra-baselines/karpathy-micrograd` 输出 JSON 含 `filesWithCalls` 整数字段；值为含至少 1 次 call 的 .py 文件数（≤ fileCount）；旧字段（fileCount/calls/uniqueCallTargets）不变 |
| **关联文件** | `scripts/lib/python-call-extractor.py`（修改约 1 行） |

---

**T-005b** — `scripts/graph-accuracy.mjs` 新增 `--metric fill-rate` 选项 + SC-001 计算逻辑（**Codex C-4 修订**：依赖 T-012a 的 callSitesCount metadata）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | SC-001（分子计算），SC-002（现有逻辑不变） |
| **优先级** | P0（CLI 选项可先加，测试逻辑可在 T-012a 完成后跑通） |
| **依赖** | T-005a |
| **工时** | 1h |
| **验收标准** | `node scripts/graph-accuracy.mjs --source <root> --graph <graph.json> --metric fill-rate` 输出 `callsiteFillRate / filesWithCallSites / denominator` 3 个字段；分子计算从 graph.json node.metadata.callSitesCount 字段读（**Codex C-4**：T-012a 必须先完成才能在生产 graph.json 上跑出有意义结果）；默认不传 `--metric` 时输出行为与改前完全一致（向后兼容）；`node --check scripts/graph-accuracy.mjs` 通过；用 mock graph.json fixture（手工注入 metadata.callSitesCount）验证计算正确 |
| **关联文件** | `scripts/graph-accuracy.mjs`（新增 `computeFillRate` 函数 + `--metric` CLI 参数解析），`tests/unit/graph-accuracy/fill-rate.test.mjs`（新建，用 mock graph.json fixture）|

---

### T-006 DependencyGraph consumer 清单 grep + import edge 派生设计验证（Codex C3）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-8（shim 前置），Codex C3（import edge 必须在 UnifiedGraph 产出） |
| **优先级** | P0 |
| **依赖** | 无 |
| **工时** | 0.5h |
| **验收标准** | 执行 `grep -rn "DependencyGraph\|buildDependencyGraph" src/` 并逐条审查：记录所有消费方（文件 + 行号）到 plan.md §8 注释；确认 `batch-orchestrator / doc-graph-builder / delta-regenerator` 实际消费 import 边的字段名（`edges[].source/.target` 或 `modules[]`）；输出消费清单文档注释到 `src/models/dependency-graph.ts` 文件头，作为 shim 改造的输入依据 |
| **关联文件** | `src/models/dependency-graph.ts`（加注释），无新建文件 |

---

### T-008 `knowledge-graph/index.ts` build pipeline（FR-3 + Codex C3）

> 注：T-007 / T-009 / T-010 属于 P1 阶段，见下节；T-008 列在 P1 末尾（依赖 T-007）

---

## 阶段二：P1 — 共享抽象层

> 目标：交付语言无关的 4 阶段 call-resolver + buildUnifiedGraph 入口 + Python mapper callSites 提取 + confidence-mapper 映射。T-009 与 T-007 可并行（各自独立文件）。

---

### T-007 call-resolver 4 阶段实现（FR-2 + CL-04 + Codex C4）

**分解为 4 个子任务**

---

**T-007a** — 4 个索引构建函数（moduleSymbolIndex / classMemberIndex / importIndex / classMroIndex）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-2（4 阶段 resolver 前置） |
| **优先级** | P1 |
| **依赖** | T-002a，T-003a |
| **工时** | 1h |
| **验收标准** | `npx tsc --noEmit` 零错误；4 个函数各有对应单测（mock CodeSkeleton Map 输入，验证 index Map 内容正确）；classMemberIndex key 格式为 `"filePath::ClassName"`，value 为 `Set<methodName>` |
| **关联文件** | `src/knowledge-graph/call-resolver.ts`（新建，第一步只写 index 函数） |

---

**T-007b** — Stage 1（free）+ Stage 2（member + classMemberIndex 双重验证，Codex C4）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-2，SC-002（precision 关键：Stage 2 必须验证 callee ∈ class.members 才 high，否则伪造 high-confidence） |
| **优先级** | P1 |
| **依赖** | T-007a |
| **工时** | 1.5h |
| **验收标准** | `npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts` 通过；覆盖 Stage 1 free function high confidence + Stage 2 member 两种 high（类+方法双命中）/ medium（类存在但方法仅在 MRO 父类）/ medium 占位（类存在但方法 unresolved）/ medium（类无法定位）；≥ 3 test case |
| **关联文件** | `src/knowledge-graph/call-resolver.ts`（Stage 1 + 2 实现），`tests/unit/knowledge-graph/call-resolver.test.ts`（新建） |

---

**T-007c** — Stage 3（cross-module，含 import * → low）+ Stage 4（super MRO ≤8 层 + unresolved 兜底）+ dynamic call skip

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-2，EC-2（缺 import），EC-3（dunder 类型未知），EC-4（MRO 死循环防护），EC-12（dynamic call skip），EC-13（import *） |
| **优先级** | P1 |
| **依赖** | T-007b |
| **工时** | 1.5h |
| **验收标准** | 覆盖 Stage 3 cross-module medium + import * low + Stage 4 super MRO low + unresolved low + dynamic call null（skip）；MRO 兜底验证：构造 ≤ 8 层深继承链，不陷入死循环；`npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts` ≥ 7 个 test case 通过 |
| **关联文件** | `src/knowledge-graph/call-resolver.ts`（Stage 3 + 4 实现），`tests/unit/knowledge-graph/call-resolver.test.ts`（扩充） |

---

**T-007d** — 共享抽象 end-to-end 单测（≥ 5 条，语言无关 mock）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | SC-003（共享抽象 ≥ 5 条要求），US-2（后续语言开发者复用） |
| **优先级** | P1 |
| **依赖** | T-007c |
| **工时** | 0.5h |
| **验收标准** | `npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts` 通过（**Codex W-4 修订**：补具体命令）；新增 ≥ 5 条语言无关测试（仅 mock CallSite[] + CodeSkeleton Map，不涉及任何 Python 语法）；完整 4 阶段 + unresolved 兜底全部有对应 case；confidence 等级与 plan §3.2 stage 决策表一致 |
| **关联文件** | `tests/unit/knowledge-graph/call-resolver.test.ts`（扩充） |

---

### T-008 `knowledge-graph/index.ts` build pipeline + deriveImportEdges（FR-3 + Codex C3）

**分解为 2 个子任务**

---

**T-008a** — `deriveImportEdges()` 实现（把 python-adapter.ts:240-267 import-edge 派生逻辑迁移）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-3，Codex C3（UnifiedGraph 必须含 depends-on 边，DependencyGraph shim 才有数据源） |
| **优先级** | P1 |
| **依赖** | T-006（consumer 清单确认），T-007a |
| **工时** | 1h |
| **验收标准** | `npx tsc --noEmit` 零错误；`deriveImportEdges(codeSkeletons)` 为每个 `CodeSkeleton.imports[].resolvedPath` 产出 `UnifiedEdge { relation: 'depends-on', confidence: 'high', directional: true }`；单测：3 个文件互相 import 的 mock skeleton，验证 depends-on 边数量和方向正确 |
| **关联文件** | `src/knowledge-graph/index.ts`（新建，第一步只写 deriveImportEdges），`tests/unit/knowledge-graph/build-unified-graph.test.ts`（新建） |

---

**T-008b** — `buildUnifiedGraph()` 入口 + `setCurrentUnifiedGraph / getCurrentUnifiedGraph` 单例 cache + export 列表

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-3，FR-7（DI provider），FR-8（shim 数据源） |
| **优先级** | P1 |
| **依赖** | T-007d，T-008a |
| **工时** | 1h |
| **验收标准** | `buildUnifiedGraph({ projectRoot, codeSkeletons })` 返回含 calls + depends-on 边的 `UnifiedGraph`；`schemaVersion: '1.0'` 存在；export 列表完备（含 `resolveCalls / buildUnifiedGraph / setCurrentUnifiedGraph / getCurrentUnifiedGraph` 等）；单测：mock CodeSkeleton（含 callSites）输入，输出 UnifiedGraph schema 符合 FR-1 |
| **关联文件** | `src/knowledge-graph/index.ts`（完成），`tests/unit/knowledge-graph/build-unified-graph.test.ts`（扩充） |

---

**T-008c** — batch-orchestrator 集成 buildUnifiedGraph + setCurrentUnifiedGraph（**Codex C-1 修订新增**）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-3, FR-6, FR-7（生产路径必须实际产 UnifiedGraph，否则 calls 边永远不会出现在 graph.json） |
| **优先级** | P1 |
| **依赖** | T-008b, T-009d |
| **工时** | 2h |
| **验收标准** | `src/panoramic/batch-project-docs.ts` 与 `src/panoramic/batch-orchestrator.ts` 在生成 graph.json 之前：(1) 收集所有语言的 CodeSkeleton Map（已有 batch-orchestrator extractionResults 路径）；(2) 调 `buildUnifiedGraph({ projectRoot, codeSkeletons })`；(3) 调 `setCurrentUnifiedGraph(graph)`；(4) 把 unifiedGraph 作为新增参数传给 `buildKnowledgeGraph()`（让 graph-builder 能消费 UnifiedGraph.edges）；端到端验证：跑 `npm run baseline:collect -- --target karpathy/micrograd --mode full`，输出 graph.json 中应含 `relation === 'calls'` 的 link |
| **关联文件** | `src/panoramic/batch-project-docs.ts`，`src/panoramic/batch-orchestrator.ts`，`src/panoramic/graph/graph-builder.ts`（接受 unifiedGraph 参数；T-012a 已开此口） |

---

### T-009 Python mapper extractCallSites（FR-5 + CL-04 + CL-05 + Codex W-3/W-4）

**分解为 3 个子任务（可与 T-007 并行）**

---

**T-009a** — 三层 options interface 新增 `extractCallSites?: boolean` 字段（CL-05，Codex W-4）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-5，NFR-1（flag 默认 false 避免 spec drift check 性能回归） |
| **优先级** | P1 |
| **依赖** | T-003a |
| **工时** | 0.5h |
| **验收标准** | `npx tsc --noEmit` 零错误；3 个 interface（`AnalyzeFileOptions / TreeSitterAnalyzeOptions / MapperOptions`）各含 `extractCallSites?: boolean`；`PythonAdapter.analyzeFile` 透传此字段到 `TreeSitterAnalyzer.analyze()`；所有既有调用方（drift-orchestrator 等）不传此字段，默认 false，行为不变 |
| **关联文件** | `src/adapters/language-adapter.ts`，`src/core/tree-sitter-analyzer.ts`，`src/core/query-mappers/python-mapper.ts`（interface 新增字段），`src/adapters/python-adapter.ts`（透传） |

---

**T-009b** — `PythonMapper.extractCallSites()` 主逻辑实现（含 7 种 AST 节点 + EC-14 兜底）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-5，EC-12（dynamic call skip），EC-14（大文件 1 MB 阈值 + parse error 兜底），EC-15（async/generator 覆盖）|
| **优先级** | P1 |
| **依赖** | T-009a |
| **工时** | 2h |
| **验收标准** | `npx vitest run tests/unit/python-mapper-callsite.test.ts` 通过；覆盖 7 种 case：(1) free function `foo()`；(2) `self.method()`；(3) `Class.method()`；(4) dunder `__add__` 通过 `a + b`；(5) `super().__init__()`；(6) 带参 `@decorator` → callee = attr；(7) cross-module `module.func()`；EC-14：1 MB+ 文件 skip 返回 `callSites: []`；EC-15：async 函数体内 call 正常抽取 |
| **关联文件** | `src/core/query-mappers/python-mapper.ts`（新增 `extractCallSites` private 方法），`src/core/tree-sitter-analyzer.ts`（EC-14：size guard），`tests/unit/python-mapper-callsite.test.ts`（新建，≥ 7 case） |

---

**T-009c** — EC-14/15 完整兜底 + 集成级 callSites 填充率验证准备

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | SC-001（填充率 ≥ 95%），EC-14，EC-15 |
| **优先级** | P1 |
| **依赖** | T-009b |
| **工时** | 0.5h |
| **验收标准** | EC-14 单测新增：非 UTF-8 文件路径 → `callSites === []`；tree-sitter `hasError === true` → `callSites === []`；EC-15 单测：generator function 体内的 `yield` 后 call → 正常抽取；bare decorator（AST `ast.Name`）→ 不记录（CL-04 对齐 extractor）；`npx vitest run tests/unit/python-mapper-callsite.test.ts` ≥ 10 case 通过 |
| **关联文件** | `tests/unit/python-mapper-callsite.test.ts`（扩充 ≥ 3 case） |

---

**T-009d** — 生产路径开启 callSites 抽取（**Codex C-1 修订新增**）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-5，SC-001（生产路径必须传 extractCallSites:true，否则 graph.json 永远没 callSites） |
| **优先级** | P1 |
| **依赖** | T-009c |
| **工时** | 1h |
| **验收标准** | (1) `src/adapters/python-adapter.ts` 在 panoramic 流水线被调用的路径上传 `{ extractCallSites: true }`；(2) `src/panoramic/batch-orchestrator.ts` 调 `analyzeFile(absPath, { extractCallSites: true })`；(3) `src/panoramic/batch-project-docs.ts` 同步；(4) drift-orchestrator 调用路径**保持** false（NFR-1 性能）；端到端：跑 `npm run baseline:collect -- --target karpathy/micrograd` 后查看 baselineSkeleton 应含 `callSites` 字段；单测：`tests/unit/python-adapter-extract-call-sites.test.ts` 验证 extractCallSites:true / false 两种 path |
| **关联文件** | `src/adapters/python-adapter.ts`，`src/panoramic/batch-orchestrator.ts`，`src/panoramic/batch-project-docs.ts`（凡是 panoramic 流水线调 `analyzeFile` 的地方），`tests/unit/python-adapter-extract-call-sites.test.ts`（新建） |

---

### T-010 `confidence-mapper.ts` 新增 `mapTierToConfidence`（CL-08）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-6（graph-builder 消费），CL-08 |
| **优先级** | P1 |
| **依赖** | T-002a |
| **工时** | 0.5h |
| **验收标准** | `src/panoramic/graph/confidence-mapper.ts` 新增 `mapTierToConfidence(tier: 'high' \| 'medium' \| 'low'): ConfidenceLevel` 函数；严格 1:1 映射（high→EXTRACTED，medium→INFERRED，low→AMBIGUOUS）；不动现有 `mapDocConfidence / mapEvidenceConfidence` 函数；单测 3 条（每档 1 条）；`npx tsc --noEmit` 零错误 |
| **关联文件** | `src/panoramic/graph/confidence-mapper.ts`，`tests/unit/panoramic/graph/confidence-mapper.test.ts`（新增 3 case） |

---

## 阶段三：P2 — 重构（高度串行）

> 目标：把 panoramic/graph/* 和 component-view-builder 重构为消费 UnifiedGraph；DependencyGraph shim 数据源切换。所有 P2 task 必须在 P1 全部完成后启动。

---

### T-011 `graph-types.ts` 增 `'calls'` relation + `directional?` 字段（FR-6）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-6，CL-07 |
| **优先级** | P2 |
| **依赖** | T-002a |
| **工时** | 0.5h |
| **验收标准** | `src/panoramic/graph/graph-types.ts` 中 `GraphEdge` 新增 `directional?: boolean` 字段；`GraphJSON.graph.sources` 类型增加 `'calls'`；新增常量 `export const RELATION_CALLS = 'calls' as const`；re-export `UnifiedGraph / UnifiedEdge` 类型；`npx tsc --noEmit` 零错误 |
| **关联文件** | `src/panoramic/graph/graph-types.ts` |

---

### T-012 `graph-builder.ts` 5 路数据源合并改造（FR-6 + Codex C1 说明）

**分解为 2 个子任务**

---

**T-012a** — `BuildGraphOptions` 新增 `unifiedGraph?` + 现有 extractionResults 路径改为消费 UnifiedGraph + per-file callSitesCount metadata（**Codex C-4 修订**）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-6，SC-004（graph-builder 重构后 Layer A 验收），**Codex C-4 修订**：SC-001 fill-rate 需要 graph.json 节点上有 callSitesCount 字段作为分子来源 |
| **优先级** | P2 |
| **依赖** | T-008b，T-010，T-011 |
| **工时** | 2.5h |
| **验收标准** | (1) `BuildGraphOptions` 含 `unifiedGraph?: UnifiedGraph`；(2) `buildKnowledgeGraph()` 步骤 5 遍历 `unifiedGraph.edges`，调用 `mapTierToConfidence` 转换 confidence；(3) **Codex C-4 修订**：在 module / symbol 节点的 `metadata` 字段新增 `callSitesCount: number`（从对应 CodeSkeleton.callSites?.length 派生；无 callSites 字段则 0）；(4) `npx tsc --noEmit` 零错误；(5) 现有单测全数通过；(6) 端到端：跑 `npm run baseline:collect -- --target karpathy/micrograd` 后 graph.json 中至少一个 module 节点 metadata.callSitesCount > 0 |
| **关联文件** | `src/panoramic/graph/graph-builder.ts`，`src/panoramic/graph/graph-types.ts`（GraphNode metadata schema 加 callSitesCount） |

---

**T-012b** — directional edge 去重路径（`directedEdgeKey / undirectedEdgeKey` 按 `edge.directional` 选择）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-6，CL-07（edge-level directionality），SC-004 Layer A 1:1 |
| **优先级** | P2 |
| **依赖** | T-012a |
| **工时** | 1h |
| **验收标准** | `graph-builder.ts` 内 edge 合并逻辑：`calls / depends-on / cross-module / contains` 边（`directional: true`）用 `directedEdgeKey`，其余用 `undirectedEdgeKey`；单测：mock UnifiedGraph（含 calls + conceptually_related_to 边），验证 calls 边仅出现 `source→target` 方向，conceptually_related_to 边仍双向；`npx vitest run` 通过 |
| **关联文件** | `src/panoramic/graph/graph-builder.ts`，`tests/unit/panoramic/graph/graph-builder.test.ts`（新增 2 case） |

---

### T-013 `graph-query.ts` 邻接表按 `edge.directional` 改造 + fromJSON 锁定（FR-6 + CL-07）

**分解为 2 个子任务**

---

**T-013a** — 邻接表构建逻辑按 `edge.directional ?? graph.directed` 判断（L185-194 改造）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-6，CL-07，SC-004 Layer A（向后兼容：旧边无 directional → fallback graph.directed=false → 双向，与现有一致） |
| **优先级** | P2 |
| **依赖** | T-011 |
| **工时** | 1h |
| **验收标准** | `src/panoramic/graph/graph-query.ts` L185-194 替换为 `const isDirected = edge.directional ?? graph.directed`；calls 边单向（source→target），旧对称边双向；`npx tsc --noEmit` 零错误；现有单测（graph-query 相关）全数通过 |
| **关联文件** | `src/panoramic/graph/graph-query.ts` |

---

**T-013b** — `GraphQueryEngine.fromJSON()` 工厂方法在 P1 阶段已实现（T-001a），此处锁定形态

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | SC-004（Layer B 录制需要 fromJSON） |
| **优先级** | P2 |
| **依赖** | T-001a（已实现），T-013a |
| **工时** | 0.5h |
| **验收标准** | 确认 `fromJSON` 与 T-013a 修改后的邻接表逻辑兼容（calls 边传入 fromJSON 后单向）；运行 Layer A snapshot 测试 `npx vitest run tests/integration/graph-mcp-snapshot.test.ts -t "Layer A"` 全数通过（验证 P0 录制的 snapshot 与当前实现一致） |
| **关联文件** | `src/panoramic/graph/graph-query.ts`（确认兼容），`tests/integration/graph-mcp-snapshot.test.ts`（Layer A 跑通） |

---

### T-014 DependencyGraph shim 数据源切换（FR-8 + CL-02 + Codex C3 + **Codex C-2 修订**）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-8，CL-02（维持接口，换数据源） |
| **优先级** | P2 |
| **依赖** | T-008b（UnifiedGraph 需含 depends-on 边），T-006（consumer 清单确认） |
| **工时** | 4h（**Codex W-3 修订**：原 2h 偏低；rg 命中 batch-orchestrator / doc-graph-builder / delta-regenerator / module-grouper / topological-sort 等多个 consumer，需逐一验证 edges[].from/to / SCC / topologicalOrder 字段不变） |
| **验收标准** | `DependencyGraph` 接口不变（保留 `SCC / topologicalOrder / mermaidSource / modules / edges` 字段）；**Codex C-2 修订**：`PythonAdapter.buildDependencyGraph()` 不再依赖 `getCurrentUnifiedGraph()` 全局 cache（cache 在 batch pipeline 早期为空），改为**用同样的 codeSkeleton 输入本地构建 UnifiedGraph 子图**（仅 depends-on 边路径，复用 `deriveImportEdges` 函数），从中派生 SCC/topologicalOrder。`spectra community` CLI 命令在 self-dogfood 输出与 master 1:1；`npx vitest run` 现有单测全数通过；新增单测验证 buildDependencyGraph 在 cache 为 null 状态下仍正确产 edges |
| **关联文件** | `src/models/dependency-graph.ts`（接口不变），`src/adapters/python-adapter.ts`（buildDependencyGraph 改为本地构建 import 子图），`src/knowledge-graph/index.ts`（确保 deriveImportEdges 可独立 import 不依赖 buildUnifiedGraph 全流程） |
| **Codex W-3 影响面提示** | 必须验证以下 consumer 仍正常工作：`src/panoramic/batch-orchestrator.ts`（消费 dependencyGraph）、`src/panoramic/doc-graph-builder.ts:250-309`、`src/panoramic/delta-regenerator.ts:48-51`（消费 edges[].from/to）、`src/panoramic/module-grouper.ts`、`src/panoramic/topological-sort.ts` |

---

### T-015 `component-view-builder` 改读 UnifiedGraph + DI 注入（FR-7 + CL-03 + Codex W-1）

**分解为 2 个子任务**

---

**T-015a** — `ComponentViewBuilderGenerator` 构造参数 + `buildComponentRelationships` 改造

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-7，CL-03（方案 B：DI 注入 provider） |
| **优先级** | P2 |
| **依赖** | T-008b |
| **工时** | 1.5h |
| **验收标准** | `ComponentViewBuilderGenerator` 构造函数签名改为 `(unifiedGraphProvider?: () => UnifiedGraph \| null)`；`generate(input: ArchitectureIR)` 签名不变（保 DocumentGenerator 泛型）；`buildComponentRelationships()` 优先从 `unifiedGraph.edges` 读 calls + depends-on 边，fallback 保留旧 import 推断路径；`npx tsc --noEmit` 零错误 |
| **关联文件** | `src/panoramic/builders/component-view-builder.ts` |

---

**T-015b** — 两条调用路径都注入 UnifiedGraph provider（registry 路径 + batch 直接路径，Codex W-1 + **Codex C-3 修订**）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | FR-7，Codex W-1（batch 直接路径必须覆盖），**Codex C-3** （正确定位 batch 调用点是 `buildComponentView({...})` 纯函数，不是 `new ComponentViewBuilderGenerator()`）|
| **优先级** | P2 |
| **依赖** | T-015a，T-012b |
| **工时** | 1.5h |
| **验收标准** | (1) **registry 路径**：`src/panoramic/generator-registry.ts:232` 改为 `registry.register(new ComponentViewBuilderGenerator(() => getCurrentUnifiedGraph()))`；(2) **batch 直接路径（Codex C-3 修订）**：`src/panoramic/batch-project-docs.ts:350-356` 实际是调用 `buildComponentView({...})` **纯函数**，正确改造方式是给 `BuildComponentViewOptions` 接口（在 `src/panoramic/builders/component-view-builder.ts:847-878` 范围）新增 `unifiedGraph?: UnifiedGraph \| null` 字段，batch 调用 `buildComponentView({ ..., unifiedGraph: getCurrentUnifiedGraph() })`；不要改成 `new ComponentViewBuilderGenerator()`，那会丢失现有 storedModules 等参数；自我 dogfood baseline 上 component view relationship 数量 ≥ 改前数量；`npx vitest run` 通过；`npx tsc --noEmit` 零错误 |
| **关联文件** | `src/panoramic/generator-registry.ts`，`src/panoramic/batch-project-docs.ts`，`src/panoramic/builders/component-view-builder.ts`（BuildComponentViewOptions 加字段 + buildComponentView 纯函数透传） |

---

## 阶段四：P3 — 验收与基线锁定

> 目标：录制 Layer B snapshot（calls-enabled）、验收 Layer A（1:1 结构性保证）、重跑 baseline fixture、跑全量 SC 验收。

---

### T-016 录制 Layer B snapshot + 验收 Layer A（FR-9 后半，SC-004）

**分解为 2 个子任务**

---

**T-016a** — 先跑 Layer A 验收（必须先过）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | SC-004 Layer A |
| **优先级** | P3 |
| **依赖** | T-008c（生产 graph.json 含 calls 边的前提，**Codex 修订 + analyze F-02**），T-012b，T-013b，T-015b |
| **工时** | 0.5h |
| **验收标准** | 重跑 `npm run baseline:collect -- --target self-dogfood --mode full` 生成含 calls 边的新 graph.json；执行 `npx vitest run tests/integration/graph-mcp-snapshot.test.ts -t "Layer A"`：Layer A 6 个 snapshot 全部通过（calls-filtered engine 节点/边 ID 集合 = P0 录制时的 baseline，score 字段经 serializer 量化后在 ±10% 内）；如有 snapshot 失败，回归分析原因（不允许强制 `-u` 覆盖 Layer A snapshot） |
| **关联文件** | `tests/integration/graph-mcp-snapshot.test.ts`（Layer A 部分跑通） |

---

**T-016b** — 录制 Layer B snapshot（calls-enabled 首版基线）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | SC-004 Layer B |
| **优先级** | P3 |
| **依赖** | T-016a |
| **工时** | 0.5h |
| **验收标准** | 执行 `npx vitest run tests/integration/graph-mcp-snapshot.test.ts -t "Layer B" -u` 录制 6 份 Layer B snapshot；commit 包含更新后的 `__snapshots__/graph-mcp-snapshot.test.ts.snap`（含 6 个 layer-b-* 条目）；Layer B 不要求与 master 1:1（因 degree 变化影响 budget 截断） |
| **关联文件** | `tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap`（更新） |

---

### T-017 重跑 micrograd / nanoGPT / self-dogfood baseline fixture（NFR-5）

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | SC-006，NFR-5 |
| **优先级** | P3 |
| **依赖** | T-016b |
| **工时** | 1h |
| **验收标准** | 执行 `npm run baseline:collect -- --targets self-dogfood,karpathy/micrograd,karpathy/nanoGPT --mode full`；3 个项目新 `tests/baseline/<project>/spectra/full.json` 存在且 schema 完整；`npm run baseline:diff` 对比旧版本 fixture 输出无 critical regression（perf.totalWallMs 相对 master 回归 ≤ 10%，N=5 中位数）；新 fixture 入库（覆盖旧版） |
| **关联文件** | `tests/baseline/karpathy-micrograd/spectra/full.json`，`tests/baseline/karpathy-nanoGPT/spectra/full.json`，`tests/baseline/self-dogfood/spectra/full.json`（各更新） |

---

### T-018 SC 验收全量跑 + 写 verification-report.md

**分解为 3 个子任务**

---

**T-018a** — 跑 SC-001 / SC-002 / SC-006

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | SC-001，SC-002，SC-006 |
| **优先级** | P3 |
| **依赖** | T-017 |
| **工时** | 1h |
| **验收标准** | SC-001：`node scripts/graph-accuracy.mjs --source ~/.spectra-baselines/karpathy-micrograd --graph <graph.json> --metric fill-rate` 输出 `callsiteFillRate ≥ 0.95`（micrograd + nanoGPT N=3 均值）；SC-002：`callPrecision ≥ 0.70` && `callRecall ≥ 0.30`（micrograd + nanoGPT 算术均值，N=3 中位数）；SC-006：`npm run baseline:diff` 显示 nanoGPT perf.totalWallMs 回归 ≤ 10%（N=5 中位数） |
| **关联文件** | 无新建文件（验收命令输出） |

---

**T-018b** — 跑 SC-003 / SC-004 / SC-005 / SC-007

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | SC-003，SC-004，SC-005，SC-007 |
| **优先级** | P3 |
| **依赖** | T-016b，T-003b |
| **工时** | 0.5h |
| **验收标准** | SC-003：`npx vitest run` 全量通过，新增单测 ≥ 12 条（≥ 7 Python case + ≥ 5 共享抽象 case）全部 pass；SC-004：Layer A + Layer B snapshot 各 6 条全部 pass（见 T-016）；SC-005：drift-orchestrator 5 个旧 spec fixture 零 Zod 异常（见 T-003b）；SC-007：`grep -rE "bootstrap(Adapters\|Generators\|Parsers)\(" src/ \| grep -v "src/runtime-bootstrap.ts"` 命中 0 行 |
| **关联文件** | 无新建文件（验收命令输出） |

---

**T-018c** — 写 `specs/151-knowledge-graph-python/verification-report.md`

| 字段 | 内容 |
|------|------|
| **FR/SC 关联** | 全 SC |
| **优先级** | P3 |
| **依赖** | T-018a，T-018b |
| **工时** | 0.5h |
| **验收标准** | `specs/151-knowledge-graph-python/verification-report.md` 文件存在；包含 SC-001 ~ SC-007 各项实测数据（数值 + 命令输出摘录）；标注每项 PASS / FAIL / N/A；如有 FAIL 标注根因和处理方案 |
| **关联文件** | `specs/151-knowledge-graph-python/verification-report.md`（新建） |

---

## 任务总表

| ID | 标题 | 优先级 | 依赖 | 工时 | 关联 FR/SC |
|----|------|--------|------|------|-----------|
| T-001a | GraphQueryEngine.fromJSON 工厂方法 | P0 | — | 0.5h | FR-9, SC-004 |
| T-001b | graph-mcp-snapshot.test.ts 骨架 + normalizer | P0 | T-001a | 1h | FR-9, SC-004 |
| T-001c | 跑 baseline + 录 Layer A snapshot（-u） | P0 | T-001b | 0.5h | SC-004 |
| T-002a | unified-graph.ts Zod schema | P0 | — | 1h | FR-1 |
| T-002b | unified-graph.ts roundtrip 单测 ≥ 3 | P0 | T-002a | 0.5h | FR-1, SC-003 |
| T-003a | code-skeleton.ts 加 callSites? | P0 | T-002a | 0.5h | FR-4, NFR-3 |
| T-003b | drift-orchestrator 兼容单测 ≥ 5 fixture | P0 | T-003a | 0.5h | SC-005 |
| T-004a | 新建 runtime-bootstrap.ts | P0 | — | 0.5h | FR-10, SC-007 |
| T-004b | 改造 mcp/server.ts + cli/index.ts | P0 | T-004a | 0.5h | FR-10, SC-007 |
| T-004c | 改造 batch-project-docs.ts + coverage-auditor.ts | P0 | T-004a | 0.5h | FR-10, SC-007 |
| T-004d | SC-007 grep 验收 | P0 | T-004b, T-004c | 0.5h | SC-007 |
| T-005a | python-call-extractor.py 加 filesWithCalls | P0 | — | 0.5h | SC-001 |
| T-005b | graph-accuracy.mjs 加 --metric fill-rate | P0 | T-005a | 1h | SC-001, SC-002 |
| T-006 | DependencyGraph consumer 清单 grep | P0 | — | 0.5h | FR-8, Codex C3 |
| T-007a | call-resolver 4 个索引构建函数 | P1 | T-002a, T-003a | 1h | FR-2 |
| T-007b | Stage 1 free + Stage 2 member（classMemberIndex 双重验证）| P1 | T-007a | 1.5h | FR-2, SC-002 |
| T-007c | Stage 3 cross-module + Stage 4 super/unresolved + dynamic skip | P1 | T-007b | 1.5h | FR-2, EC-2/3/4/12/13 |
| T-007d | 共享抽象语言无关单测 ≥ 5 条 | P1 | T-007c | 0.5h | SC-003, US-2 |
| T-008a | deriveImportEdges() 实现 | P1 | T-006, T-007a | 1h | FR-3, Codex C3 |
| T-008b | buildUnifiedGraph() 入口 + 单例 cache + export | P1 | T-007d, T-008a | 1h | FR-3, FR-7, FR-8 |
| **T-008c** | **batch-orchestrator 集成 buildUnifiedGraph + setCurrentUnifiedGraph + 传 unifiedGraph 给 buildKnowledgeGraph（Codex C-1 新增）** | **P1** | **T-008b, T-009d** | **2h** | **FR-3, FR-6, FR-7, SC-001 链路前提** |
| T-009a | 三层 options 加 extractCallSites 字段 | P1 | T-003a | 0.5h | FR-5, NFR-1 |
| T-009b | PythonMapper.extractCallSites() 主逻辑（7 种节点 + EC-14）| P1 | T-009a | 2h | FR-5, EC-12/14/15 |
| T-009c | EC-14/15 完整兜底 + 单测扩充 | P1 | T-009b | 0.5h | SC-001, EC-14/15 |
| **T-009d** | **生产路径开启 callSites（python-adapter / batch-orchestrator / batch-project-docs 显式传 extractCallSites:true）（Codex C-1 新增）** | **P1** | **T-009c** | **1h** | **FR-5, SC-001 生产路径前提** |
| T-010 | confidence-mapper.ts 加 mapTierToConfidence | P1 | T-002a | 0.5h | FR-6, CL-08 |
| T-011 | graph-types.ts 增 calls + directional | P2 | T-002a | 0.5h | FR-6, CL-07 |
| T-012a | graph-builder.ts 加 unifiedGraph? 5 路合并 + per-file callSitesCount metadata（Codex C-4） | P2 | T-008b, T-010, T-011 | 2.5h | FR-6, SC-001（分子）, SC-004 |
| T-012b | graph-builder.ts directional edge 去重路径 | P2 | T-012a | 1h | FR-6, CL-07 |
| T-013a | graph-query.ts 邻接表按 edge.directional 改造 | P2 | T-011 | 1h | FR-6, CL-07 |
| T-013b | fromJSON + Layer A snapshot 跑通确认 | P2 | T-001a, T-013a | 0.5h | SC-004 |
| T-014 | DependencyGraph shim 数据源切换（FR-8 + Codex C-2 修订：本地构建不依赖 cache + Codex W-3：consumer 全清单）| P2 | T-008b, T-006 | 4h | FR-8, CL-02 |
| T-015a | ComponentViewBuilderGenerator DI 构造 + buildComponentRelationships 改造 | P2 | T-008b | 1.5h | FR-7, CL-03 |
| T-015b | BuildComponentViewOptions 加 unifiedGraph 字段 + 两条路径注入（Codex C-3 修订：纯函数 buildComponentView）| P2 | T-015a, T-012b | 1.5h | FR-7, Codex W-1 + C-3 |
| T-016a | Layer A 验收（必须先过才能继续）| P3 | T-012b, T-013b, T-015b, T-008c | 0.5h | SC-004 Layer A |
| T-016b | 录制 Layer B snapshot（calls-enabled 首版基线）| P3 | T-016a | 0.5h | SC-004 Layer B |
| T-017 | 重跑 3 个 baseline fixture + perf diff（NFR-5）| P3 | T-016b | 1h | SC-006, NFR-5 |
| T-018a | 跑 SC-001 / SC-002 / SC-006 实测 | P3 | T-017 | 1h | SC-001/002/006 |
| T-018b | 跑 SC-003 / SC-004 / SC-005 / SC-007 | P3 | T-016b, T-003b | 0.5h | SC-003~007 |
| T-018c | 写 verification-report.md | P3 | T-018a, T-018b | 0.5h | 全 SC |

**合计：39 个子任务（展开后）/ 28 个主任务 ID（Codex 修订后从 37 / 27 → 39 / 28）**

---

## FR 覆盖映射

| FR | 覆盖 Task |
|----|----------|
| FR-1 UnifiedGraph schema | T-002a, T-002b |
| FR-2 4 阶段 call-resolver | T-007a, T-007b, T-007c, T-007d |
| FR-3 buildUnifiedGraph 入口 + 生产链路集成 | T-008a, T-008b, T-008c |
| FR-4 CodeSkeleton callSites? | T-003a, T-003b |
| FR-5 Python mapper extractCallSites + 生产链路开启 | T-009a, T-009b, T-009c, T-009d |
| FR-6 panoramic/graph/* 重构 | T-010, T-011, T-012a, T-012b, T-013a, T-013b |
| FR-7 component-view-builder UnifiedGraph | T-015a, T-015b |
| FR-8 DependencyGraph shim | T-006, T-014 |
| FR-9 6 MCP tools 双层 snapshot | T-001a, T-001b, T-001c, T-016a, T-016b |
| FR-10 runtime-bootstrap | T-004a, T-004b, T-004c, T-004d |

**FR 覆盖率：10/10（100%）**

---

## 并行调度建议

### P0 阶段（可并行的 3 条独立链）

```
链 A（基线录制）: T-001a → T-001b → T-001c
链 B（schema）:   T-002a → T-002b
                  T-002a → T-003a → T-003b
链 C（bootstrap）: T-004a → T-004b → T-004c → T-004d
链 D（extractor）: T-005a → T-005b
链 E（grep）:      T-006（独立）
```

**注**：T-002a 与 T-001a、T-004a、T-005a、T-006 可完全并行，P0 阶段存在 5 条并行启动点。

### P1 阶段（部分并行）

```
call-resolver 链: T-007a → T-007b → T-007c → T-007d → T-008a → T-008b
Python mapper 链: T-009a → T-009b → T-009c（与 T-007 完全并行）
独立: T-010（仅依赖 T-002a，可与 T-007/T-009 并行）
```

**T-007 与 T-009 可双线并行**（不同文件，无互相依赖）

### P2 阶段（高度串行）

```
T-011 → T-012a → T-012b → T-015b
       ↘
         T-013a → T-013b
T-006 → T-014（可与 T-011-T-013 并行）
T-015a → T-015b（依赖 T-012b）
```

**T-014 与 T-011→T-013 链可并行**（不同文件）；T-015b 是最后汇合点。

### P3 阶段（严格串行）

```
T-016a → T-016b → T-017 → T-018a
                        → T-018b → T-018c
```

---

## 推荐实施策略

**MVP 策略**（最小可交付 + 向后兼容）：

1. **先完成 P0 + P1**：锁定 Layer A baseline → 建好共享抽象 → Python mapper callSites 抽取（US-1 + US-2 核心路径）
2. **P2 按串行顺序**：graph-types → graph-builder → graph-query → DependencyGraph shim → component-view-builder（每步 vitest run 验证零新增失败）
3. **P3 严格顺序**：Layer A 必须 1:1 才能继续录 Layer B；baseline fixture 重跑才能跑性能验收

**并行团队分工**（如果 2 人并行）：

- 人员 A：T-001 链 + T-004 链（P0 基础设施）
- 人员 B：T-002 + T-003 + T-006（P0 schema + grep）
- P1 阶段：人员 A 跑 T-007 链，人员 B 跑 T-009 + T-010

---

*本 tasks.md 由 tasks 子代理基于 plan.md（Codex 4 CRITICAL + 5 WARNING + 4 INFO 修订版）+ spec.md + clarification.md（9 CL 全部采纳）生成。首版 27 主 task / 37 子任务后经 codex:codex-rescue 对抗审查（2026-05-06）发现 4 CRITICAL + 4 WARNING + 4 INFO 全部修复，扩展为 28 主 task / 39 子任务（新增 T-008c batch-orchestrator 集成 + T-009d 生产路径开启）。覆盖 10/10 FR，P0/P1/P2/P3 分布为 8/8/7/6。*
