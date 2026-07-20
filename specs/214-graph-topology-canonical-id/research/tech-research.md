## 技术调研: Feature 214 — Graph Topology / Canonical Symbol ID

**调研模式**: codebase-scan（纯代码库扫描，无 web 调研）
**产品调研基础**: 无（`research/product-research.md` 不存在）— **[独立模式]** 本次技术调研未参考产品调研结论，直接基于需求描述（M9-B1 Trusted Live Graph 底座）与运行时提供的编排器预扫描锚点执行
**调研日期**: 2026-07-20

---

## 1. 调研目标

**核心问题**：
1. `buildUnifiedGraph` 如何在保持 F193/F183/F182/F195 既有护栏不回归的前提下，补齐 module→symbol `contains` 边与 class member 层级？
2. Python `file.py#symbol` 与 UnifiedGraph `file.py::symbol` 应在哪一个"兼容边界"收敛为单一 canonical ID？
3. src/knowledge-graph（canonical model，UnifiedGraph）/ src/graph（derived view，ModuleGraph 薄包装）/ src/panoramic/graph（persisted+query representation，GraphJSON）三层职责当前有哪些实际偏离，最小合同边界该画在哪？
4. graph-only 与 full batch 的节点/边口径差异中，哪些是"预期的数据源差异"，哪些是本 feature 要修的"非预期重复/不一致"？

**范围约束**（来自需求描述，非产品调研）：Constitution/项目规则要求"不创建平行 registry、graph 或 retrieval kernel"，本调研的所有方案均延续现有三模块划分，不提出新增顶层图抽象层。

---

## 2. 关键锚点验证（抽查结果）

以下 8 处锚点均已重新读取源码核实，结论与编排器预扫描一致，并补充 3 处新发现（标 †）。

| # | 锚点 | 核实结论 |
|---|------|---------|
| 1 | `src/knowledge-graph/index.ts:52-74` `buildUnifiedGraph` | 只装配 `calls`（`resolveCalls`）+ `depends-on`（`deriveImportEdges`）两种边（:64-65），文档注释明确写"其他 relation（contains / cross-module / documents 等）由 graph-builder.ts 在 4 路合并阶段注入"（:49-50）。**contains 边确认缺失**。 |
| 2 | `src/knowledge-graph/index.ts:186-224` `deriveNodesFromSkeletons` | module 节点 `id=filePath`；symbol 节点 `id=${filePath}::${exp.name}`（:202）；class member 节点 `id=${symbolId}.${m.name}`（:213）— **无显式边**表达 module→symbol、symbol→member 层级，仅靠 ID 字符串中的 `::` 与 `.` 分隔符隐式编码。 |
| 3 | `src/knowledge-graph/unified-graph.ts:64-77, 101-114` schema | `UnifiedNodeKindSchema` 含 `symbol`（:76）；`UnifiedEdgeRelationSchema` **已含 `contains`**（:107）— schema 层面无需改动即可承载 contains 边，纯粹是 builder 未产出。 |
| 4 | `src/adapters/python-adapter.ts:192-224` `extractSymbolNodes` | Python 独立抽取路径：module 节点 `id=relPath`（:194），symbol 节点 `id=${relPath}#${symbol.name}`（:203，kind=`component`），并显式产出 `relPath -[contains]-> symbolId` 边（:215-221）。**这是当前 GraphJSON 通用 Python symbol/contains 生产路径的唯一 `#` 生产者，但采用 `#` 分隔符且仅覆盖 Python**（另见锚点 11† — api-surface 提取器的 `#` ID 属不同节点语义，不在此列）。 |
| 5 | `src/knowledge-graph/relativize.ts:100-110` `relativizeSymbolId` | 只识别 `::` 分隔符（`id.indexOf('::')`，:101）；若传入 `#` 格式 ID，`sepIdx < 0` 恒成立，整个字符串（含 symbol 名）会被当作**纯路径**送入 `relativizePosix`（:104），破坏 symbol 语义并可能产生错误的相对化结果。**`#` ID 从未被这条 F193 相对化 pass 正确处理过**。 |
| 6 | `src/panoramic/graph/graph-builder.ts:572-576` `scanGraphPortabilityViolations.filePartOf` | 同样只切 `::`（`id.indexOf('::')`），`#` 格式 ID 的"file part"退化为整个 ID 字符串，导致 portable 违例扫描对 `#` 节点**失真**（既可能漏报绝对路径泄漏，也可能误判 symbol 名为路径片段）。 |
| 7 | `src/panoramic/graph/graph-query.ts:159-162` `nodeIdFilePart` + `assertGraphFormatNotStale` | 与 #6 同款 `::`-only 切分逻辑，用于加载期 format-stale 检测（F193 决策 1c）。**`#` 格式节点在 stale 检测中同样失真**——这是三处 `::`-only 与两处双格式兼容（下条）之间的核心不对称，是本 feature 必须修的关键收敛点。 |
| 8 | `src/knowledge-graph/query-helpers.ts:268-281, 708-715` `symbolSeg` / `moduleFileFromId` | **唯二真正双格式兼容**的 helper：同时找 `indexOf('::')` 与 `indexOf('#')`，取更早出现的分隔符切分（:269-279, :709-714）。MCP 消费层（`context`/`impact` 经由 `resolveSymbolFuzzy`）依赖这两个函数，因此模糊匹配层对双格式"容忍"，但 F193 的相对化/portable/stale 三条硬护栏"不容忍"——**这正是当前架构的核心割裂**：产出侧（relativize/portable/stale）假设单一 `::`，消费侧（fuzzy/moduleFileFromId）已在事实上处理双格式的历史包袱。 |
| 9† | `src/batch/batch-orchestrator.ts:1338-1435` 全量 batch 主路径 | **重要修正**：编排器预扫描把双 ID 重复归因于 graph-only（`buildAstGraphOnly`）；实际核实后，**全量 batch 同样无条件执行**：Python 符号提取（`extractSymbolNodes`，:1344，"不依赖 flag，始终执行"注释见 :1338）产出 `#` 节点 → 与 `unifiedGraph`（`::` 节点）一起传入同一次 `buildKnowledgeGraph({ extractionResults: mergedResults, unifiedGraph })`（:1428-1435）。**对含 `.py` 文件的项目，无论 full batch 还是 graph-only，都会产生同一逻辑 symbol 的 `::` 与 `#` 两个节点并存**，不是 graph-only 特有问题。 |
| 10† | `src/panoramic/graph/graph-types.ts:53-63` `GraphNode.kind` | 枚举**不含 `symbol`**（只有 module/package/component/service/spec/document/api/api-schema/event/diagram）。`graph-builder.ts:363-366` 把 UnifiedGraph 的 `symbol` kind 映射为 GraphNode 的 `component`，与 Python 抽取路径产的 `component` kind 语义重合但 ID 格式不同——这是 B→C 转换点上"同 kind 不同 ID 空间"的具体体现。 |
| 11† | `src/panoramic/api-surface/fastapi-extractor.ts:124` + `express-extractor.ts:261` | api-surface 提取器（FastAPI router、Express router/app）同样用 `${filePath}#${localName}` 生成 router 节点 ID——**但这是 api/router 节点，语义与 GraphJSON 通用 symbol 节点不同，与锚点 4 的 Python symbol contains 生产者无关**。因此"`#` 唯一生产者"结论必须限定在"GraphJSON 通用 symbol/contains 语义"范围内，不能全局断言。canonical 收敛与 legacy-id-format 检测（见 §7/R-3）须按节点语义（kind/provenance，如 `sourceTag`/`unifiedKind`/api-surface 专属 kind）限定识别范围，**不可把任意含 `#` 的 ID 一律当作旧版 symbol ID 处理**，否则会误伤 api-surface 节点。 |

---

## 3. Canonical ID 收敛方案空间

候选收敛边界（按需求"转换只允许发生在一个兼容边界"约束评估）：

### 方案 A：在 Python 抽取产出端统一为 `::`（推荐）

把 `python-adapter.ts:extractSymbolNodes`（:203, :215-221）的 ID 生成方式从 `${relPath}#${symbol.name}` 改为 `${relPath}::${symbol.name}`，与 `deriveNodesFromSkeletons` 完全对齐；同时该函数本身即可直接产出 module→symbol `contains` 边（已有，:215-221，只需切换分隔符），天然满足需求 1 的部分诉求。

- **改动面**：`src/adapters/python-adapter.ts` 一处 ID 生成逻辑 + 该函数的既有单测（symbol id 断言需同步更新）；下游 `buildKnowledgeGraph` 合并逻辑不必改（`extractionResults` 第四路与 `unifiedGraph` 第五路本就走 nodeMap upsert，ID 一致后天然去重，`existing` 分支见 graph-builder.ts:355-361）。
- **风险**：Python 项目存量 graph.json 中的 `#` 节点全部改名 → 触发 F193 SNAPSHOT_WRAPPER_VERSION 语义变化（虽然字面版本号是否 bump 见 §7，但内容一定变）；改动范围须限定在 python-adapter 的 symbol/contains 生产路径——实测**GraphJSON 通用 Python symbol/contains 生产路径的唯一 `#` 生产者是 python-adapter.ts:203**，只有兼容读取（`symbolSeg`/`moduleFileFromId`）依赖该格式。但 api-surface 提取器（fastapi/express，锚点 11†）的 router 节点也用 `#` 分隔符，属不同节点语义（router/app，非 symbol），**方案 A 不应触碰这两处**，否则会混淆节点语义边界。
- **对 F193 stale 链路影响**：修复后 `relativizeSymbolId`/`filePartOf`/`nodeIdFilePart` 三处 `::`-only 逻辑不再需要改动即可正确处理 Python symbol 节点——**方案 A 是唯一能让"`::`-only 三处硬护栏"和"新 canonical ID"自然对齐、不需要再打补丁的方案**。
- **推荐理由**：改动面最小（一个文件的字符串拼接）、消除对称性缺陷的根因（而非在消费端逐个打补丁）、天然复用 python-adapter 已有的 contains 边生产逻辑作为需求 2 的种子实现。

### 方案 B：在 graph-builder 四路合并处统一转换

在 `buildKnowledgeGraph` 消费 `extractionResults`（Python `#` 节点）时，插入一个转换步骤把 `#` → `::` 再 upsert 进 nodeMap，产出端（python-adapter）保持不变。

- **改动面**：`graph-builder.ts` 合并逻辑新增一段 ID 归一化（约 20-30 行），需要覆盖 node.id / edge.source / edge.target 三处。
- **风险**：`extractSymbolNodes` 仍会被其他调用方（如 `buildAstGraphOnly` 中单独用于统计 `pythonSymbolCount`，:2518-2530）直接消费到未转换的 `#` ID，产生"合并后 graph.json 是 `::`，但中间产物/日志仍是 `#`"的双轨语义，调试与测试 fixture 需要格外小心两态混用。
- **对 F193 影响**：`relativizeSymbolId` 等三处 `::`-only 逻辑仍然安全（合并后已是 `::`），但转换本身成为新的"隐藏兼容边界"，与需求"转换只允许发生在**一个**兼容边界"的表述冲突——graph-builder 已经是 5 路合并的复杂交汇点（F151/F107/F143/F133 等历史特性都在此叠加），再加一层 ID 转换会进一步加重该文件的职责，且与既有"src/panoramic/graph 是 persisted+query representation，不应包含 canonical model 语义决策"的三层职责定位冲突。
- **不推荐**：转换点放在早已过载的合并枢纽，且与"canonical model 归 src/knowledge-graph 决定"的三层分工背离。

### 方案 C：在消费端（query-helpers / graph-query）统一 canonicalize，不改产出端

保持双格式共存，扩大 `canonicalizeSymbolId`（query-helpers.ts:139-207）与三处 `::`-only 硬护栏，使其都变成双格式感知。

- **改动面**：`relativize.ts`、`graph-builder.ts:filePartOf`、`graph-query.ts:nodeIdFilePart` 三处逻辑各自加 `#` 分支，与 `symbolSeg`/`moduleFileFromId` 的双格式判定逻辑重复一份。
- **风险**：**不消除重复节点问题**（`::` 与 `#` 两个节点仍会同时存在于 graph.json，只是每处消费逻辑都学会"认识"两种格式），治标不治本；需求 4"等价矩阵"里 full batch 的节点计数会永远比 graph-only 少（因为 full batch 额外套 architecture-ir/doc-graph/cross-reference 三路，可能有更多去重合并机会）而 graph-only 会保留更多冗余 `#`/`::` 对——这会污染需求 4 要求的"差异必须是显式数据源差异"结论，把"ID 制度缺陷"误判成"数据源差异"。
- **不推荐**：只解决查询正确性，不解决图本身的数据整洁性（重复节点、重复 contains 边），与需求 2"收敛为单一 canonical ID"的字面要求（要求图中只有一种 ID，而非两种 ID 都能查到）不符。

**推荐**：**方案 A**（Python 产出端改 `::`），辅以对 `symbolSeg`/`moduleFileFromId` 的 `#` 分支做**弃用标注但保留**（向后兼容旧 snapshot/graph.json 及 api-surface router 节点，允许历史存量图仍可被模糊匹配读到，直至用户重新 `spectra batch` 重建）。

---

## 4. Contains 边生成方案

### 4.1 插入点

`buildUnifiedGraph`（src/knowledge-graph/index.ts:52-74）内，`deriveNodesFromSkeletons` 已经拥有 module id、symbol id、member id 三层信息（:190-223），是生成 contains 边最自然的位置——不需要额外一次遍历 codeSkeletons。建议新增 `deriveContainsEdges(codeSkeletons)` 兄弟函数（对齐 `deriveImportEdges` 的现有模式），在 `buildUnifiedGraph` 的 `edges` 数组拼接（:65 `[...callEdges, ...importEdges]` → 追加 `...containsEdges`）。

### 4.2 层级表达方案对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| 两级（module→class + class→member） | module -[contains]-> `file::Class`；`file::Class` -[contains]-> `file::Class.member` | 与现有 ID 结构（`.` 分隔 member）天然对应；`graph_path`/BFS 遍历时层级清晰，符合"class member 层级保持可追溯"的需求原文措辞 | 边数量略多（每个 class 多一层） |
| 扁平（module→all-symbols，含 member） | module -[contains]-> 所有 symbol 节点，无论是否为 member | 实现更简单（一次遍历） | member 与顶层符号在图上不可区分层级，需求"class member 层级保持可追溯"字面上得不到满足 |

**推荐**：两级方案。理由：需求原文明确写"class member 层级保持可追溯"，扁平方案会让 `graph_query`/`graph_path` 无法区分"这是顶层函数"还是"这是某个类的方法"，而两级方案只需在 `deriveNodesFromSkeletons` 已有的 exp/member 双层循环（:201-221）基础上各自产一条边，改动量与扁平方案几乎相同。

### 4.3 与现有 Python contains 生产者的关系

若方案 A（§3）落地，python-adapter.ts:215-221 的 contains 边在 ID 分隔符统一后即与 buildUnifiedGraph 新增的 contains 边**同构**（module→symbol，无 member 层级——Python 抽取路径当前不产 member 级节点/边，只到函数/类粒度，见 :202-222 无 member 循环）。此时二者会通过 `buildKnowledgeGraph` 的 nodeMap/edgeMap upsert 天然去重合并（`upsertEdge` 语义，graph-builder.ts:302-311 一带而过、confidence-max-wins 策略），**不需要额外显式去重代码**，只要 `edgeKey` 派生函数对 `(source, target, relation, directional)` 四元组一致即可命中同一 key。需要核实的收尾项：确认 `edgeKey()`（graph-builder.ts 内部）对 contains 边的三元组排序不受 source/target 顺序影响导致误判为不同边（当前未在本次调研中读到 `edgeKey` 实现细节，标注 **[待核实]**，建议 plan 阶段补充读取 `edgeKey` 定义确认合并语义）。

---

## 5. 三层职责合同

### 5.1 现状偏离点清单

| 偏离点 | 现状 | 应然定位 |
|--------|------|---------|
| `query-helpers.ts` 物理位置在 `src/knowledge-graph/`（canonical model 层），但其核心函数 `canonicalizeSymbolId`/`resolveSymbolFuzzy` 消费的类型是 `GraphJSON`（`src/panoramic/graph/graph-types.ts`，persisted+query representation），而非 `UnifiedGraph` | 三层之间无隔离，knowledge-graph 层直接 import panoramic 层类型 | 若要收紧三层边界，`query-helpers` 逻辑上更应归属"消费 persisted representation 的查询层"，但当前 MCP 工具（agent-context-tools.ts、graph-tools.ts）两边都在用，物理搬迁成本高，不建议本 feature 内做搬迁，仅在合同文档中显式承认这一耦合点 |
| `relativizeSymbolId`/`scanGraphPortabilityViolations`/`assertGraphFormatNotStale` 三处独立实现"取 ID 的 file part"逻辑，而非共享一个 `parseSymbolId`/`splitSymbolId` 工具函数 | 三份几乎相同的字符串切分代码分散在 `src/knowledge-graph/relativize.ts`、`src/panoramic/graph/graph-builder.ts`、`src/panoramic/graph/graph-query.ts` | 应收敛为单一 `parseCanonicalSymbolId(id): { filePart, symbolPart }` 工具，放在 canonical model 层（`src/knowledge-graph`），三处调用点改为调用该工具——这是本 feature "转换只允许发生在一个兼容边界"要求在代码层面的具体落地对象 |
| B→C 转换（UnifiedGraph → GraphNode）中 `symbol` kind 映射为 `component` kind（graph-builder.ts:366），发生在 graph-builder 内联代码而非独立可测函数 | 转换逻辑与 5 路合并主流程耦合在一个大函数体内 | 建议抽出独立的 `unifiedNodeToGraphNode(node): GraphNode` / `unifiedEdgeToGraphEdge(edge): GraphEdge` 纯函数，便于单独写 round-trip 测试（见 5.2） |

### 5.2 最小合同 schema 与 round-trip 测试锚点

需要覆盖的转换点（按需求 3"转换合同有 schema + round-trip 测试"）：

1. **B→A**（UnifiedGraph → ModuleGraph，`src/graph`，即 canonical model → derived view）：现状是薄包装（`directory-graph`），改动风险低，本 feature 若新增 contains 边，需确认 `deriveModuleGraph` 不会把新的 module→symbol contains 边误当作 module→module 依赖边纳入 SCC/拓扑排序（`deriveModuleGraph` 应只消费 `depends-on` 边，需核实其 relation 过滤条件，**[待核实]**）。
2. **B→C**（UnifiedGraph → GraphNode/GraphEdge，即 canonical model → persisted+query representation，graph-builder.ts:333-410）：已有 nodes/edges upsert 逻辑，建议补充 round-trip 测试：构造一个含 module/class/member 三层节点 + contains 边的 mock UnifiedGraph → 跑 `buildKnowledgeGraph({ unifiedGraph })` → 断言产出的 GraphJSON 节点数/边数/ID 格式符合预期（可仿照 `tests/unit/knowledge-graph/build-unified-graph.test.ts` 的现有 mock 风格）。
3. **extraction→C**（python-adapter → GraphJSON 第四路）：方案 A 落地后，这条转换路径与 B→C 的 ID 空间统一，round-trip 测试可合并覆盖："同一 Python 项目分别跑 full batch 与 graph-only，产出 graph.json 中不应出现同一符号的两个不同 ID 节点"——这条测试同时也是需求 4 等价矩阵的核心断言。

---

## 6. Graph-only 与 Full Batch 等价矩阵

### 6.1 已知合法差异源（预期差异，非 bug）

| 数据源 | full batch | graph-only（`buildAstGraphOnly`） | 差异原因 |
|--------|-----------|-----------------------------------|---------|
| `architectureIR`（workspace/package 级 contains、group 关系） | 有（batch-orchestrator.ts:1428-1429 `projectDocsResult?.architectureIR`） | 无（依赖 spec-gen 阶段产物，:2532 注释已言明） | 合法：graph-only 定位是"零 LLM 快速建图"，不跑 spec 生成流程 |
| `docGraph`（.md 文档节点 + documents 边） | 有 | 无 | 同上 |
| `crossReferenceLinks`（模块间语义交叉引用） | 有 | 无 | 同上 |
| `unifiedGraph`（calls + depends-on 边，Python+TS/JS） | 有 | 有（步骤 2，:2512-2516，**采集器与 full batch 完全同款**） | 无差异，两路口径应一致 |
| Python `extractionResults`（module→symbol contains，`#`/未来 `::`） | 有（Feature 145 P0 强制执行） | 有（步骤 3，:2518-2530） | 无差异，两路口径应一致 |
| docs/images 多模态提取（document 节点 + documents 边，`--include-docs`/`--include-images`） | 有条件（batch-orchestrator.ts:1375，仅当 `options.includeDocs`/`options.includeImages` 显式开启） | 无（`buildAstGraphOnly` 未接入 `runExtractionPipeline`） | 合法：属可选 opt-in 数据源，graph-only 定位不跑该管线 |
| anchor semantic edges（`references`/`conceptually_related_to`，LLM embedding 驱动） | 有条件（batch-orchestrator.ts:1437 起 `runAnchorIntegration`，仅 `effectiveMode === 'full'` 且未触发 budget-skip） | 无 | 合法：graph-only 是"零 LLM"路径，anchor 集成依赖 embedding provider，与 graph-only 定位互斥 |
| 可选 hyperedges（跨模块协作超边） | 有条件（batch-orchestrator.ts:1513 起，需 `designDocAbsPaths`+`codeNodes` 均非空，且需显式 `--hyperedges`/`SPECTRA_HYPEREDGES_ENABLED` opt-in） | 无 | 合法：依赖 design doc + LLM 富化，graph-only 不具备该数据源 |

### 6.2 已知非预期重复（需本 feature 修复，非"数据源差异"）

- **重复节点**（§2 锚点 9†）：full batch 与 graph-only 都会为同一 Python 符号产出 `::` 与 `#` 两个节点 + 两条几乎等价的 contains 边（一条来自即将新增的 buildUnifiedGraph contains，一条来自 python-adapter 现有 contains）——这不是"数据源差异"，是同一份 AST 事实被两条流水线各自建模成不同 ID 的**冗余**，必须靠 §3 方案 A 消除，而非在等价矩阵里"归因"为合法差异。
- **验证建议**：等价矩阵测试应显式断言"TS/JS-only 项目（无 .py 文件）两路节点/边计数在扣除 architecture-ir/doc-graph/cross-reference/多模态提取/anchor/hyperedge 等 full-only 数据源贡献后应完全相等"，以及"含 Python 文件的项目在方案 A 落地后同样相等"——用两组 fixture（纯 TS 项目 + 混合 Python 项目）分别验证，避免只用 TS-only 项目掩盖 Python 路径的真实差异。

---

## 7. 版本与迁移

| 版本字段 | 位置 | 是否需要 bump | 理由 |
|---------|------|--------------|------|
| `UNIFIED_GRAPH_SCHEMA_VERSION`（当前 `'1.0'`） | `src/knowledge-graph/unified-graph.ts:210` | **建议 bump**（如 `'1.1'`） | `UnifiedEdgeRelationSchema` 已含 `contains`（无需改 schema 字面值），但 `buildUnifiedGraph` 的**语义**产出发生变化（新增边类型 + Python ID 格式变更），下游任何缓存/快照按 schemaVersion 做兼容性判断的地方应能感知这是"新语义版本"，即便 zod schema 本身字面不变 |
| `SNAPSHOT_WRAPPER_VERSION`（当前 `'2.0'`） | `src/knowledge-graph/persistence.ts:38` | **需要 bump** | 旧 snapshot 中 Python 符号是 `#` 格式，方案 A 落地后新建图会产出 `::` 格式；若不 bump，`loadSnapshotDetailed` 的版本嗅探（persistence.ts:214-228）不会触发 format-stale，旧 snapshot 会被当作"当前格式"误加载，导致同一项目新旧两次运行产出 ID 不一致但都被判定为"新鲜" |
| `GraphJSON.schemaVersion`（`'1.0'｜'2.0'`） | `src/panoramic/graph/graph-types.ts:178`，产出赋值在 `graph-builder.ts:471`（当前写死 `'2.0'`） | **可不 bump**（结构未变，只是 ID 内容变化） | GraphJSON 的 schema v2.0 是指 hyperedge/evidenceText 等结构性扩展；ID 分隔符变更不改变 JSON 结构本身，故此字段可维持 `'2.0'` 不动，但需要确认 `assertGraphFormatNotStale`（依赖 `nodeIdFilePart` 的 `::`-only 逻辑）**在方案 A 落地后天然生效**——因为方案 A 消除了 Python symbol 的 `#` 分隔符，加载期 stale 检测不需要额外改动即可正确识别旧图（旧图中若残留 `#` 节点，`nodeIdFilePart` 会把整个 `id` 当 file part，多数情况下不会命中"绝对路径"判定，因此**旧 `#` 格式图不会被 F193 stale 检测拦截**——这是一个需要显式测试覆盖的迁移缺口，见风险清单 R-3。该检测须按节点语义限定，避免误判 api-surface 的 `#` router 节点——见锚点 11†） |
| `graph.html` / `panoramic-query` 消费面 | 未在本次调研中逐一读取，**[待核实]** | — | 建议 plan 阶段单独确认 `graph.html` 前端渲染是否硬编码解析 `#` 分隔符（如面包屑/分组显示逻辑），避免方案 A 落地后前端展示层出现视觉回归 |

**迁移行为建议**：bump `SNAPSHOT_WRAPPER_VERSION` 后，旧快照会走已有的 format-stale 全量重建路径（F193 既定行为），不需要新增迁移代码；`spectra batch`/`spectra index` 重跑即可产出新格式图。

---

## 8. 风险清单（按既有护栏逐条评估）

| # | 关联护栏 | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|---------|------|------|---------|
| R-1 | F193（相对化 + stale 检测） | `relativizeSymbolId`/`nodeIdFilePart`/`filePartOf` 三处 `::`-only 逻辑若方案 A 未同步落地（例如只做了 §4 的 contains 边而未做 §3 的 ID 统一），Python `#` 节点会继续被这三处护栏错误处理，产生"相对化后 ID 结构损坏"或"portable 违例误报/漏报" | 中（若 plan 阶段拆分任务导致 contains 与 ID 统一未同批交付） | 高（graph.json 结构性损坏，下游 MCP 查询失效） | plan 阶段把 §3 方案 A 与 §4 contains 边生成列为同一原子交付单元，不允许中间态只做一半；增补单测覆盖 Python 节点过 `relativizeGraph` 后的 ID 结构断言 |
| R-2 | F183（normalizeGraphForWrite 三写盘出口） | 新增 contains 边后节点/边排序（`nodes.sort by id`、`links.sort by source+target+relation`）字典序可能改变已有 fixture 的 byte-stable 基线（`tests/baseline/*/spectra/full.json`） | 高（确定会变，非"可能"） | 中（预期内变化，但需要重新采集 baseline fixture 并 diff 确认无非预期回归） | 按 CLAUDE.local.md 既定流程：改完代码 → `npm run build` → 重跑 3 个 baseline → `baseline:diff` 对比 → 确认差异仅来自 contains 边新增，无其他非预期变化，再 commit 新 fixture |
| R-3 | F193 format-stale 检测 | 旧 `#` 格式图（升版前生成）在方案 A 落地后**不会**被 `assertGraphFormatNotStale` 拦截（见 §7 表格末行分析），因为 `nodeIdFilePart` 对 `#` 格式返回整个 id 字符串，大概率不满足"绝对路径"判定，会被当作"新鲜"图静默加载，导致查询返回旧 ID 空间的结果且无警告 | 中 | 中（用户体验为"静默返回错误/找不到"而非"明确报错重建"，排查成本高） | 建议在 `assertGraphFormatNotStale` 或加载期新增一条独立检测："节点 id 含 `#` 分隔符**且节点语义属 symbol/component（sourceTag/unifiedKind 等标记）** → 视为 legacy-id-format-stale"，与现有绝对路径判定并列；检测逻辑必须按节点语义限定，不可对 api-surface router 节点（锚点 11†）误报 |
| R-4 | F182（增量三护栏） | 未在本次调研中逐一读取增量构建代码路径确认 contains 边是否被增量 diff 逻辑正确识别为"新增边类型"（而非被现有 diff 逻辑忽略或误判为噪声） | 低-中（**[待核实]**，未读取增量护栏具体实现） | 中 | plan 阶段补充读取 F182 增量三护栏实现（关键词搜索 `incremental` + `contains`），确认新边类型接入增量路径无需改动或需要显式适配 |
| R-5 | F195（graph-only 零 LLM 2.8s 量级） | `buildUnifiedGraph` 新增 contains 边计算（遍历 exports+members）理论上增加的是 O(symbols) 级别开销，量级远小于现有 O(callSites) 的 calls 边解析，性能回归风险低；但若方案 A 同时改动 `extractSymbolNodes`（Python 独立抽取路径）产出格式，需确认该函数本身的耗时未被新逻辑拖慢 | 低 | 低 | graph-only 2.8s 基线在 baseline 重跑（R-2 缓解动作）时一并验证墙钟耗时无显著上升（阈值参考 F195 spec 原定验收标准） |
| R-6 | F196（MCP description 防漂移 + fuzzy resolve 一致性） | `symbolSeg`/`moduleFileFromId` 的 `#` 兼容分支若保留（为兼容存量旧图及 api-surface router 节点），需确认 F196 的 MCP tool description 与 fuzzy resolve 行为一致性测试（`feature-174-symbol-fuzzy-match.e2e`）在方案 A 落地后：(a) 新图全 `::` 场景下行为不变；(b) 旧图残留 `#` 场景下 fuzzy 兼容分支仍生效，不会被本 feature 误删 | 中 | 中（若误删 `#` 兼容分支，旧图会在 fuzzy 层也失效，叠加 R-3 造成用户完全无法定位符号） | 明确决策：`#` 兼容分支保留但不再是"正式支持格式"，只作为存量旧图降级容错；新增单测显式覆盖"新格式图 100% 走 `::` 路径，旧格式图仍可被 fuzzy 兜底找到"两种场景 |

---

## 9. 结论与建议

1. **Canonical ID 收敛**：推荐方案 A（Python 产出端 `#`→`::`），因为它是唯一能让 `relativizeSymbolId`/`filePartOf`/`nodeIdFilePart` 三处既有 `::`-only 硬护栏"自然生效、无需追加逻辑"的方案，改动面最小且直接消除根因（而非在多个消费点打补丁）。改动范围须严格限定在 python-adapter 的 symbol/contains 生产路径，不触碰 api-surface 提取器的 `#` router ID（不同节点语义）。
2. **Contains 边**：在 `buildUnifiedGraph` 内新增两级 module→class→member contains，与 python-adapter 现有 contains 生产者在 ID 统一后天然通过 nodeMap/edgeMap upsert 去重，无需额外去重代码，但需核实 `edgeKey()` 对 contains 边三元组的合并语义（标注待核实项）。
3. **三层合同**：canonical model 归属 src/knowledge-graph（UnifiedGraph），derived view 归属 src/graph（ModuleGraph），persisted+query representation 归属 src/panoramic/graph（GraphJSON）；不建议本 feature 做物理代码搬迁（`query-helpers.ts` 位置等），但应把"取 ID file part"的三份重复逻辑收敛为单一共享工具函数，作为"转换只允许发生在一个兼容边界"的具体落地。
4. **版本迁移**：`SNAPSHOT_WRAPPER_VERSION` 需要 bump；`UNIFIED_GRAPH_SCHEMA_VERSION` 建议 bump；`GraphJSON.schemaVersion` 可不动，但需为旧 `#` 格式 symbol 图补一条独立的、按节点语义限定的 legacy-id-format-stale 检测（R-3），不能依赖现有绝对路径判定兜底，也不能对 api-surface router 节点误报。
5. **对后续 plan 阶段的建议**：把"ID 统一（方案 A）"与"contains 边生成"列为同一原子任务，避免中间态半成品触发 R-1；baseline fixture 重采集（R-2）与旧图迁移检测（R-3）应作为独立可验收的 acceptance criteria，而非隐含在"实现完成"里。
6. **待核实清单**（建议 plan 阶段补充确认，本次未能完整读取）：`edgeKey()` 具体实现、F182 增量护栏对新边类型的处理、`graph.html`/panoramic-query 前端是否硬编码 `#` 分隔符解析、`deriveModuleGraph`（B→A）对 relation 的过滤条件。
