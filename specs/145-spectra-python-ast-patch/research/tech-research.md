# 技术调研报告: Spectra v4.x Python AST 补齐（Feature 145）

**特性分支**: `claude/tender-mayer-644a32`
**调研日期**: 2026-04-29
**调研模式**: 在线（部分 web 搜索）+ 本地代码库摸底
**产品调研基础**: [独立模式] 本次技术调研未参考产品调研结论，直接基于需求描述执行。

---

## 1. 调研目标

### 核心问题

- **P0**：Python 函数级节点如何接入知识图谱（graph.json）？现有 `PythonMapper` 已能提取函数/类符号，但 `graph-builder.ts` 没有把源码级符号转换为 `GraphNode`；
- **P1**：`--hyperedges` 首次运行时 `designDocAbsPaths` 为空，hyperedge/anchor 集成被静默跳过，如何修复？
- **P2**：`README.md` 被 `file-scanner.ts` 的扩展名白名单过滤（仅通过 `LanguageAdapterRegistry` 支持的扩展），导致 `debt-scanner` 的技术债 Open Questions 扫描失效，如何修复？
- **P3**：`--dry-run` 预估值 64.8x 偏差来源于哪里？`estimateModuleCost` 仅计算源文件内容 token，未包含 system prompt、上下文组装（context-assembler）等固定开销；

### 需求上下文摘要

micrograd 项目 `graph.json` 仅 4 个 spec 节点、0 边、0 hyperedge，根本原因是 `.py` 文件在 batch 扫描时虽经过 `PythonLanguageAdapter` 处理并进入 `mergedGraph`，但 `mergedGraph` 里的节点是文件级 `DependencyGraph.modules`（`GraphNode.source = 相对路径`），而非函数符号级节点。知识图谱（`graph-builder.ts`）只把 `DocGraph.specs`（spec 文件节点）和 `ArchitectureIR.elements` 写入 `nodeMap`，没有源码符号节点路径。

---

## 2. 架构方案对比（P0）

### 背景：现有代码现状（基于代码摸底）

- `src/core/query-mappers/python-mapper.ts`：`PythonMapper` 已完整实现顶层函数（`function_definition`）、类（`class_definition`）、方法（`function_definition` in class body）的提取，包括签名、docstring、可见性、装饰器；
- `src/adapters/python-adapter.ts`：`PythonLanguageAdapter.analyzeFile()` 委托 `TreeSitterAnalyzer.analyze(filePath, 'python')`，已使用 `web-tree-sitter` + Python grammar（WASM 方式加载）——**不是 subprocess，也不是 tree-sitter-python npm 包的 Node.js binding**；
- `package.json`：依赖 `web-tree-sitter@^0.24.7`，无 `tree-sitter-python` 条目（Python grammar 通过 `grammars/` 目录下的 `.wasm` 文件加载）；
- `src/panoramic/graph/graph-builder.ts`：`buildKnowledgeGraph()` 处理四路数据源（`DocGraph`、`ArchitectureIR`、`CrossReferenceLinks`、`ExtractionResult[]`），写入 `nodeMap` 的只有 spec 节点和 IR 元素；
- `src/panoramic/builders/doc-graph-builder.ts`：`buildDocGraph()` 只把 `*.spec.md` 文件作为图节点，不含源码级符号。

**结论**：Python AST 提取机制本身完好，缺口在于「如何把 AST 提取的函数/类符号从 `CodeSkeleton` 转化为 `GraphNode` 并写入 `graph.json`」。

### 方案 A：扩展第四路 ExtractionResult（推荐）

在现有 `runExtractionPipeline`（Feature 107，`--include-docs`）的第四路数据源架构内，新增一个 `SymbolExtractionAdapter`，遍历项目中所有 Python 文件，调用 `PythonLanguageAdapter.analyzeFile()` 获取 `CodeSkeleton`，将每个 `ExportSymbol` 转换为 `ExtractionResult` → 进入 `buildKnowledgeGraph()` 的第四路。

- **实现成本**：低。`ExtractionResult` 接口已定义（`src/extraction/extraction-types.ts`），只需新增一个适配器类，无需改动 `graph-builder.ts` 主逻辑；
- **兼容性**：`buildKnowledgeGraph()` 内第四路已有合并逻辑，符号节点带 `kind: 'module'`（或可扩展为 `kind: 'component'` 表示函数/类）；
- **关键问题**：需要 `--include-docs` 或新增一个 `--include-symbols` flag 触发，否则默认 batch 不会跑第四路，仍然 0 节点；
- **风险**：`ExtractionResult` 是为文档/图像设计的，强行放符号节点会使 schema 语义模糊，需要在 `graph-builder.ts` 侧对 `kind` 进行区分处理。

### 方案 B：在 DocGraph 层新增 SymbolNode 类型

扩展 `doc-graph-builder.ts` 的 `buildDocGraph()` 函数，在构建 spec 节点的同时，遍历 `dependencyGraph.modules`，调用各语言适配器的 `analyzeFile()` 为每个 `.py` 文件提取符号并写入图。

- **实现成本**：中。`buildDocGraph()` 已接受 `dependencyGraph` 参数，可在其中插入符号节点的构建逻辑；但 `DocGraph` 接口需要扩展（新增 `symbolNodes` 字段）；
- **兼容性**：DocGraph 是强类型契约，修改接口会影响所有消费方（coverage-auditor、cross-reference-index、spec-renderer 等）；
- **优点**：符号节点与 spec 节点在同一数据结构中，边关系（spec → symbol）更容易建立；
- **风险**：接口改动面大，且 DocGraph 本来只是 spec 文档图谱，混入符号节点会打破单一职责。

### 方案 C：新增独立 SymbolGraph 数据源（第五路）

在 `buildKnowledgeGraph()` 的 `BuildGraphOptions` 中新增第五路 `symbolGraph?: SymbolGraph`，由 batch 编排器在 `buildDocGraph()` 之后、`buildKnowledgeGraph()` 之前，调用新的 `buildSymbolGraph()` 函数构建，再作为独立参数传入。

- **实现成本**：高，但架构最清晰。需要新建类型文件、新建 builder、扩展 `BuildGraphOptions`、扩展 `buildKnowledgeGraph()` 内部处理逻辑；
- **优点**：职责边界最清晰，符号图谱独立演化，不污染 DocGraph 和 ExtractionResult；
- **风险**：改动面涉及 graph-types.ts、graph-builder.ts、batch-orchestrator.ts，多文件联动，Codex adversarial review 发现问题的概率较高；

### 方案对比表

| 维度 | 方案 A：扩展 ExtractionResult（第四路） | 方案 B：扩展 DocGraph | 方案 C：新增 SymbolGraph（第五路） |
|------|--------------------------------------|---------------------|----------------------------------|
| 实现成本 | 低（新增适配器，不改主链路接口） | 中（DocGraph 接口变更） | 高（多文件联动） |
| 架构清晰度 | 中（schema 语义略混） | 低（单一职责破坏） | 高 |
| 改动面 | 小（extraction/ 层新增文件） | 大（DocGraph 消费方全部受影响） | 大（graph 层多文件） |
| 对现有 batch 行为的影响 | 需新增 flag 触发或改默认逻辑 | batch 默认即覆盖 | batch 默认即覆盖 |
| Codex review 风险 | 低 | 高 | 中 |
| 实现时间估算 | 1-2 天 | 2-3 天 | 3-4 天 |

### 推荐方案

**推荐：方案 A（扩展 ExtractionResult 第四路）——但需要一个重要调整：**

默认 batch 不需要 `--include-docs`；应在 `runBatch()` 中，在调用 `buildKnowledgeGraph()` 前，**始终**（不需要 flag）通过语言适配器注册表遍历 `.py`（及其他非 TS/JS）文件，用 `analyzeFile()` 提取符号，转换为 `ExtractionResult`，传入第四路。`--include-docs` 仍保持其文档/图像提取的独立语义。

**理由**：
1. 代码量最小——`PythonMapper` 和 `TreeSitterAnalyzer` 已完全实现提取能力，只需桥接转换层；
2. `ExtractionResult` 接口改动不影响 DocGraph/ArchitectureIR 下游消费方；
3. 可通过单元测试验证 `ExtractionResult → GraphNode` 的转换，隔离性好；
4. Python grammar 已通过 `web-tree-sitter` 加载（`grammars/python.wasm`），无需新增依赖。

---

## 3. 依赖库评估

### P0 所需依赖

| 库名 | 用途 | 现状 | 评级 |
|------|------|------|------|
| `web-tree-sitter@^0.24.7` | Python AST 解析 WASM 绑定 | 已在 `dependencies` | 无需变更 |
| `grammars/python.wasm` | Python tree-sitter grammar | 已在 `grammars/` 目录 | 无需变更 |

**结论：P0 不需要引入任何新依赖。** Python AST 提取链路（`web-tree-sitter` + `PythonMapper`）已完整。

### P1/P2/P3 所需依赖

- P1 修复：无需新依赖，仅改 batch-orchestrator.ts 执行顺序；
- P2 修复：无需新依赖，仅改 `file-scanner.ts` 扩展名过滤逻辑（添加 `.md` 支持路径）；
- P3 修复：无需新依赖，在 `estimateModuleCost` 中添加固定 system prompt token 常量。

### 与现有依赖兼容性

| 现有依赖 | 兼容性 | 说明 |
|---------|--------|------|
| `web-tree-sitter@^0.24.7` | ✅ 兼容 | P0 直接复用，无版本变更 |
| `ts-morph@^24.0.0` | ✅ 兼容 | TS/JS 链路不受影响 |
| `@anthropic-ai/sdk@^0.39.0` | ✅ 兼容 | P3 修复不改 LLM 调用层 |

---

## 4. P0 设计模式推荐

### 推荐模式

1. **Adapter（适配器）模式**：新建 `PythonSymbolExtractor`（或在 `PythonLanguageAdapter` 中新增方法 `extractSymbolNodes()`），将 `CodeSkeleton.exports` 转换为 `ExtractionResult` 格式。现有适配器体系（`LanguageAdapter` 接口）已预留扩展点，新增方法不破坏已有合约。

2. **Transform Pipeline 模式**：在 batch-orchestrator 的后处理阶段（`buildKnowledgeGraph()` 调用之前）插入一个 `symbolResults` 转换步骤，保持流水线的线性顺序，不引入新的调度复杂度。

### 节点 kind 映射建议

| `ExportSymbol.kind` | `GraphNode.kind` |
|--------------------|-----------------|
| `'function'` | `'component'` |
| `'class'` | `'component'` |
| `'interface'` | `'component'` |
| 文件级（无符号） | `'module'` |

### 边构建策略

- `function → module`（containment 关系）：通过 `GraphEdge.relation = 'contains'` 表示；
- `module → module`（import 关系）：已由 `DependencyGraph.edges` 覆盖，无需重复；
- `function → function`（call 关系）：Python `PythonMapper` 当前未提取 call graph，MVP 阶段可暂不实现，仅做 containment 边。

---

## 5. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | Python WASM grammar 在 batch 首次加载时有冷启动延迟（`GrammarManager.getGrammar()` 需异步加载 .wasm） | 低 | 低 | `GrammarManager` 已实现单例缓存，batch 首文件加载后后续复用，无需额外处理 |
| 2 | 大型 Python 项目（如 >1000 .py 文件）批量提取符号导致内存压力 | 中 | 中 | 复用 `TreeSitterAnalyzer.dispose()` 机制，batch 结束后释放 parser；提取阶段流式处理，不集中持有全量 skeleton |
| 3 | P1 修复：`designDocAbsPaths` 依赖 `generateBatchProjectDocs` 产出，但 full 模式首次运行时 design docs 尚未写盘就需要路径 | 高（已确认） | 中 | 见 P1 专项分析 |
| 4 | P2 修复：向 `file-scanner.ts` 添加 `.md` 支持后，batch scan 可能把 README 当源文件处理，触发 AST 分析失败 | 中 | 低 | `.md` 文件不通过 `LanguageAdapterRegistry.getAdapter()` 分发，scan 只做文件发现；debt-scanner 单独处理 `.md`，不走 AST 分析 |
| 5 | P3 修复：system prompt 实际大小因 spec 模板版本变化，硬编码常量可能失效 | 中 | 低 | 以常量名 `SYSTEM_PROMPT_TOKEN_OVERHEAD`（推荐值 ~2000 tokens，基于实测）替代魔法数字，并在注释中标明测量时间 |
| 6 | `ExportSymbol` 转 `GraphNode` 时 ID 冲突（不同文件的同名函数） | 中 | 中 | ID = `{相对路径}#{symbolName}`，确保全局唯一 |

---

## 6. 各 Bug 专项分析（P1/P2/P3）

### P1：`designDocAbsPaths` 首次运行为空

**根因（基于代码摸底）**：

在 `batch-orchestrator.ts` 第 1093–1096 行（`else` 分支，即 `semanticIntegrationAllowed` 为 true 时）：

```typescript
const designDocAbsPaths = (projectDocs ?? [])
  .map((rel) => path.isAbsolute(rel) ? rel : path.join(resolvedRoot, rel))
  .filter((abs) => fs.existsSync(abs));
```

`projectDocs` 来自 `generateBatchProjectDocs()` 的返回值 `projectDocsResult.generatedDocs`，其中 `.writtenFiles` 过滤 `.md` 后赋值。**首次运行时，所有 generator 都是新的，`generatedDocs` 包含本轮刚写盘的文件路径**，`projectDocs` 不应该为空——除非 `effectiveMode !== 'full'`，`modeSkipIds` 过滤掉了所有 architecture-narrative / architecture-overview 等产出 `.md` 文件的 generator，导致 `projectDocs` 为空。

**验证路径**：`mode=full` 首次运行但无任何已生成的 doc generator 输出时（空项目），`projectDocsResult.generatedDocs` 中 `writtenFiles` 应该有值；如果所有 generator 抛异常，则 `writtenFiles = []`，`projectDocs` 为空。

**建议修法**：
1. 在 `hyperedge/anchor` 集成块加 diagnostic log，打印 `designDocAbsPaths.length`，确认是否真的为空；
2. 把 `designDocAbsPaths` 的构建从 `generateBatchProjectDocs()` 输出 **改为** 主动扫描 `outputDir/project/` 目录下所有 `.md` 文件（`projectDir` 变量在第 969 行已定义），这样即使本轮 generator 失败，上轮写盘的文档也能被复用；
3. 确保 anchor 调用发生在 `generateBatchProjectDocs()` 写盘完成之后（当前顺序已经是这样）。

### P2：README.md 被 batch scan 跳过

**根因（精确文件 + 逻辑）**：

`src/utils/file-scanner.ts` 第 280–281 行：

```typescript
const ext = path.extname(entry.name).toLowerCase();
if (supportedExtensions.has(ext)) {
```

`supportedExtensions` 由 `LanguageAdapterRegistry.getInstance().getSupportedExtensions()` 返回，仅包含注册适配器支持的扩展名（`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.pyi`, `.go`, `.java` 等），**`.md` 不在其中**。因此 `README.md` 在 `walkDir` 中进入 `unsupported` 统计而非 `results` 列表，debt-scanner 消费的 `files` 数组中没有 README。

**建议修法**：在 `ScanOptions` 新增 `includeDocs?: boolean`，当 `includeDocs=true` 时，同时扫描 `.md`（和可选的 `.txt`）文件；batch-orchestrator 中 debt-scanner pipeline 调用 `scanFiles` 时传入 `includeDocs: true`。注意不要让 `.md` 进入 AST 分析链路（`analyzeFiles()`），debt-scanner 有自己的读取方式。

另一个更轻量的修法：直接在 debt-scanner pipeline 内不依赖 `scanFiles`，而是独立遍历目录查找 `.md` 文件（与 `file-scanner.ts` 的 code 扫描逻辑解耦）。

### P3：`--dry-run` 预估 64.8x 偏差

**根因（基于代码摸底）**：

`src/batch/budget-gate.ts` 第 102–127 行，`estimateModuleCost()` 的估算逻辑：

```typescript
input += estimateFast(content);  // 只计算源文件内容
// estimatedOutput = Math.round(input * OUTPUT_RATIO)  // output = 0.3 × input
```

实际 LLM 调用时，`callLLM()` 的 input token 包含：
1. **system prompt**（Spectra spec 生成指令，约 1500-3000 tokens，依 template 版本而定）；
2. **context-assembler 产出的结构化上下文**（skeleton JSON、imports、exports 序列化，约增加 20-40%）；
3. **源文件内容**（estimateFast 估算的部分）；

**建议修法**：在 `estimateModuleCost()` 中加入固定 overhead 常量：

```typescript
const SYSTEM_PROMPT_TOKEN_OVERHEAD = 2000;  // 实测 system prompt + context boilerplate，约 2k tokens（2026-04）
const CONTEXT_ASSEMBLY_MULTIPLIER = 1.35;    // context-assembler 增加约 35%

export function estimateModuleCost(...): ModuleEstimate {
  // ... 现有逻辑 ...
  const estimatedInput = Math.round(input * CONTEXT_ASSEMBLY_MULTIPLIER) + SYSTEM_PROMPT_TOKEN_OVERHEAD;
  // ...
}
```

同时在 `ESTIMATION_ASSUMPTION` 常量中更新说明。需要通过实际运行 batch 测量 system prompt 真实 token 数后校准常量值。

---

## 7. 需求-技术对齐度评估

| 待修复问题 | 技术方案覆盖 | 说明 |
|-----------|-------------|------|
| P0：Python AST 函数级 graph 接入 | ✅ 完全覆盖（方案 A） | 现有 `PythonMapper` 已完整实现，只需桥接转换层 |
| P1：hyperedges 首次运行空路径 | ✅ 覆盖（需验证根因） | 改为扫描 `projectDir/` 已存在文件而非依赖本轮 generator 输出 |
| P2：README.md 被跳过 | ✅ 覆盖 | debt-scanner 独立扫描 `.md`，不依赖 file-scanner；或为 ScanOptions 增加 `includeDocs` |
| P3：dry-run 估算偏差 | ⚠️ 部分覆盖 | 需实测 system prompt 大小后校准常量；首版用固定常量，精度仍有 ±30% 误差 |

### Constitution 约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| TypeScript 5.x + Node.js 20.x+ | ✅ 兼容 | 所有修改都在 TypeScript 层，无运行时环境变更 |
| web-tree-sitter（已有依赖） | ✅ 兼容 | P0 直接复用，无版本变更 |
| 零新增外部依赖原则 | ✅ 兼容 | 四个问题均无需新增 npm 依赖 |
| spec 文件不直接修改源码（CLAUDE.md） | ✅ 遵守 | 本技术调研不包含代码变更 |

---

## 8. 结论与建议

### 总结

四个 bug 的技术栈无需变动，均在现有代码能力范围内修复：

1. **P0（最高价值）**：Python AST 提取已完整，缺少的是「从 `CodeSkeleton.exports` 到 `GraphNode`」的桥接转换层（约 100-150 行代码）。推荐方案 A，在 ExtractionResult 第四路内扩展，改动面最小，无需改动 graph-builder 核心逻辑；

2. **P1**：`designDocAbsPaths` 改为扫描磁盘上已存在的 projectDir 目录，而不依赖本轮 generator 的 writtenFiles，根本解决「鸡和蛋」问题；

3. **P2**：debt-scanner 的 README 扫描应独立于 `file-scanner.ts` 的代码文件发现路径，两条链路职责分离；

4. **P3**：在 `estimateModuleCost` 中加入 system prompt overhead 常量，校准后精度可从 64.8x 压缩到 ±30% 以内。

### 对技术规划的建议

- P0 和 P1 建议打包为同一个 implement 任务（均与知识图谱写盘流程相关，同一改动周期降低上下文切换成本）；
- P2 独立为一个小 fix（debt-scanner 链路，改动面与 P0/P1 无交叉）；
- P3 在 P0 实现后实测新的 token 偏差，再校准常量（先做 P0，再修 P3，避免二次校准）；
- 所有改动提交前须通过 `npx vitest run` 零失败，重点关注 `budget-gate.test.ts`、`batch-orchestrator.test.ts`、`graph-builder.test.ts` 三个测试文件。
