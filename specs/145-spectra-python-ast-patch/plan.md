# 技术规划：Feature 145 — Spectra Python AST 函数级 Graph + Phase 2 Bug 修复

**Feature 分支**: `claude/tender-mayer-644a32`  
**版本目标**: v4.0.x → v4.1.0  
**规划日期**: 2026-04-29  
**状态**: 草稿（已通过 GATE_DESIGN）

---

## 0. 架构决策记录（ADR）

### ADR-001：P0 桥接层内联到 python-adapter.ts

**决策**：新增 `extractSymbolNodes(projectRoot)` 方法内联到现有 `PythonLanguageAdapter`，不另建独立文件。

**理由**：
- 桥接代码 < 150 行，职责内聚于 Python 适配器
- 避免新增文件带来的 import 链改动
- `PythonLanguageAdapter` 已引用 `TreeSitterAnalyzer` / `PythonMapper`，无新依赖

**后果**：
- `python-adapter.ts` 文件长度增加 ~150 行（可接受）
- 任何 Python 符号提取能力变更，只需改此文件

---

### ADR-002：P0 触发机制——默认注入，不依赖 flag

**决策**：在 `batch-orchestrator.ts` 的 `buildKnowledgeGraph()` 调用前，**始终**（不需要 `--include-docs` / `--include-images` flag）通过 `PythonLanguageAdapter.extractSymbolNodes()` 提取 Python 符号并注入 `extractionResults`。

**当前代码路径（batch-orchestrator.ts L1036-1055）**：
```typescript
// 当前：只在 includeDocs || includeImages 时跑
let extractionResults: ... | undefined;
if (options.includeDocs || options.includeImages) {
  extractionResults = await runExtractionPipeline(...)
}
const graphJson = buildKnowledgeGraph({ ..., extractionResults });
```

**修复后**：
```typescript
// 先跑 Python 符号提取（无 flag 门控）
const pythonSymbolResults = await extractPythonSymbols(resolvedRoot);
// 再跑多模态提取（保持原 flag 门控）
let extractionResults: ... | undefined;
if (options.includeDocs || options.includeImages) {
  extractionResults = await runExtractionPipeline(...)
}
const mergedResults = [...pythonSymbolResults, ...(extractionResults ?? [])];
const graphJson = buildKnowledgeGraph({ ..., extractionResults: mergedResults });
```

**理由**：Python 函数级节点是核心 graph 能力，不应依赖用户传 flag；多模态提取（文档/图像）保持原有门控语义。

---

### ADR-003：P1 designDocAbsPaths 改为"磁盘优先"策略

**决策**：合并策略——先用 `generateBatchProjectDocs()` 本轮输出，再 `globSync/readdirSync` 补充 `outputDir/project/` 下已存在的 `.md` 文件，去重后合并。

**理由**：
- 首次运行：本轮 writtenFiles 有值，磁盘补充为空 → 正常
- 首次运行但 generator 部分失败：磁盘补充弥补缺失
- 非首次运行：磁盘上有上轮文档，复用已有文档触发 anchor/hyperedge

---

### ADR-004：P2 债务扫描——先诊断，再确定修复点

**决策**：P2 的真实根因需在 implement 阶段先加诊断日志确认：

已知 `detectOpenQuestions(projectRoot)` → `discoverDesignDocs(projectRoot)` 已独立于 file-scanner，理论上应能找到 README.md。如果 `docsScanned > 0` 但 Open Questions 仍为空，问题在内容匹配（规则/LLM）；如果 `docsScanned = 0`，问题在 projectRoot 传值或目录结构。

**实施策略**：
1. 加诊断日志 → 确认 docsScanned 和 confirmed.length
2. 根据诊断结果选择修复路径（A：检查 projectRoot；B：放宽内容匹配规则）

---

### ADR-005：P3 校准时序——在 P0 完成后实测

**决策**：P3 的常量值（`SYSTEM_PROMPT_TOKEN_OVERHEAD`、`CONTEXT_ASSEMBLY_MULTIPLIER`）在 P0 实现后，通过在 micrograd 上实际运行 batch 测量 system prompt 真实 token，再最终定稿。

**理由**：P0 改变了 batch 的 token 消耗结构（Python 符号提取增加了 graph 节点数），实测偏差可能与原始 64.8x 不同，避免基于旧偏差校准后 P0 完成再次漂移。

---

## 1. 实施顺序与依赖图

```
P0（python-adapter.ts 桥接 + batch-orchestrator 注入）
  ↓ 共用 batch-orchestrator 改动区域
P1（batch-orchestrator L1094 designDocAbsPaths 扫盘）
  ↓ 同一 commit（P0+P1 打包）

P2（debt-scanner 诊断 → 修复 Open Questions）
  独立 commit（与 P0/P1 无交叉）

P3（budget-gate.ts 常量校准）
  依赖 P0 完成后实测偏差，最后 commit
```

---

## 2. 改动文件清单

### P0：Python AST 函数级 graph

| 文件 | 改动类型 | 具体改动 |
|------|---------|---------|
| `src/adapters/python-adapter.ts` | 扩展 | 新增 `extractSymbolNodes(projectRoot: string): Promise<ExtractionResult[]>` 方法；遍历 .py 文件 → `analyzeFile()` → 转换 CodeSkeleton.exports → ExtractionResult 格式 |
| `src/batch/batch-orchestrator.ts` | 修改（L1036-1055） | 在 `extractionResults` 赋值前，**不依赖 flag** 调用 `pythonAdapter.extractSymbolNodes(resolvedRoot)` 并合并结果 |
| `tests/adapters/python-adapter.test.ts`（新建或已有） | 新增测试 | 验证 `extractSymbolNodes` 输出 ExtractionResult：节点 ID 格式 `{relPath}#{symbolName}`，kind='component'，边 relation='contains' |
| `tests/panoramic/graph/graph-builder.test.ts` | 新增测试 | 针对 micrograd-style fixture（含函数定义 .py），断言 graph.json 节点数 ≥ 8、edges ≥ 5 |

**关键实现细节（python-adapter.ts）**：

```typescript
async extractSymbolNodes(projectRoot: string): Promise<ExtractionResult[]> {
  const results: ExtractionResult[] = [];
  // 1. walkDir 找所有 .py 文件（复用 buildDependencyGraph 的 scan 逻辑）
  // 2. 对每个 .py 文件调用 this.analyzeFile(absPath)
  // 3. 转换 skeleton.exports：
  //    - node.id = `${relPath}#${symbol.name}`
  //    - node.kind = symbol.kind === 'function' || 'class' ? 'component' : 'module'
  //    - node.label = symbol.name
  //    - node.source_file = relPath
  //    - node.confidence = 'high'
  // 4. 构建 containment 边：
  //    - source = fileModuleId（relPath 作为 module 节点 ID）
  //    - target = node.id
  //    - relation = 'contains'
  //    - confidence = 'high'
  // 5. 每个文件产出一个 ExtractionResult，push 到 results
  return results;
}
```

**ExtractionResult / ExtractionNode 接口**（来自 extraction-types.ts）：
```typescript
// ExtractionNode 包含 id, kind, label, source_file, confidence, metadata
// ExtractionEdge 包含 source, target, relation, confidence
// ExtractionResult 包含 nodes: ExtractionNode[], edges: ExtractionEdge[]
```

---

### P1：designDocAbsPaths 首次运行修复

| 文件 | 改动类型 | 具体改动 |
|------|---------|---------|
| `src/batch/batch-orchestrator.ts` | 修改（L1094-1098） | 改 `designDocAbsPaths` 构建：先取 `projectDocs` writtenFiles，再补充扫描 `resolvedOutputDir/project/` 下 `.md` 文件，去重合并 |
| `tests/batch/batch-orchestrator.test.ts` | 新增测试 | 空 outputDir 首次运行时，mock `generateBatchProjectDocs` 返回 `writtenFiles: []`，断言 hyperedge 集成仍被触发（projectDir 下有 .md 文件时） |

**关键实现细节**：
```typescript
// 修改前（L1094-1097）：
const designDocAbsPaths = (projectDocs ?? [])
  .map((rel) => path.isAbsolute(rel) ? rel : path.join(resolvedRoot, rel))
  .filter((abs) => fs.existsSync(abs));

// 修改后：
const fromProjectDocs = (projectDocs ?? [])
  .map((rel) => path.isAbsolute(rel) ? rel : path.join(resolvedRoot, rel))
  .filter((abs) => fs.existsSync(abs));
// 补充扫描磁盘
const projectDir = path.join(resolvedOutputDir, 'project');
// 架构假设：outputDir/project/ 为扁平结构（无子目录），readdirSync 非递归覆盖全部产物 .md
// 若未来引入子目录结构，需升级为 globSync 递归扫描
const fromDisk = fs.existsSync(projectDir)
  ? fs.readdirSync(projectDir).filter(f => f.endsWith('.md'))
      .map(f => path.join(projectDir, f))
  : [];
const designDocAbsPaths = [...new Set([...fromProjectDocs, ...fromDisk])];
// 诊断日志
logger.info(`hyperedge: designDocAbsPaths.length=${designDocAbsPaths.length} (fromDocs=${fromProjectDocs.length}, fromDisk=${fromDisk.length})`);
```

---

### P2：debt-scanner Open Questions 修复

| 文件 | 改动类型 | 具体改动 |
|------|---------|---------|
| `src/panoramic/pipelines/debt-intelligence-pipeline.ts` | 修改 | 在 `scanProjectDebt` 调用后，从 `report.diagnostics` 提取 `docsScanned`，加 verbose 日志输出 |
| `src/debt-scanner/design-docs/doc-discoverer.ts` | 视诊断结果而定 | 若 docsScanned=0：检查 projectRoot 传值；若 docsScanned>0 但 confirmed=0：考虑放宽规则（见 ADR-004） |
| `tests/debt-scanner/design-docs/doc-discoverer.test.ts` | 新增测试 | 验证含 README.md 的 fixture dir → `discoverDesignDocs()` 返回非空路径列表 |

**诊断日志添加位置**（debt-intelligence-pipeline.ts L75-85）：
```typescript
diagnostics.push(
  `扫描 ${report.diagnostics.filesScanned} 个源文件，跳过 ${report.diagnostics.filesSkipped} 个，` +
    `扫描 ${report.diagnostics.docsScanned} 个 design-doc，` +
    `发现 ${report.openQuestions.length} 个 open question（confirmed=${report.diagnostics.confirmedCount ?? 0}），` +
    `LLM 调用 ${report.diagnostics.llmCalls} 次`,
);
```

---

### P3：dry-run 预估校准

| 文件 | 改动类型 | 具体改动 |
|------|---------|---------|
| `src/batch/budget-gate.ts` | 修改（L102-127） | 在 `estimateModuleCost` 内加入 `SYSTEM_PROMPT_TOKEN_OVERHEAD` 和 `CONTEXT_ASSEMBLY_MULTIPLIER` 常量；更新 `ESTIMATION_ASSUMPTION` 说明 |
| `tests/batch/budget-gate.test.ts` | 新增/修改 | 验证 `estimateModuleCost` 返回的 `estimatedInput` 包含 overhead（> rawContentTokens） |

**关键实现细节**：
```typescript
// 在 OUTPUT_RATIO 附近添加：
/** system prompt（spec 生成指令）实测约 2000 tokens（测量日期：2026-04，P0 实现后重新校准） */
const SYSTEM_PROMPT_TOKEN_OVERHEAD = 2000;

/** context-assembler 结构化开销（skeleton JSON 序列化 + import/export 列表），约 +35% */
const CONTEXT_ASSEMBLY_MULTIPLIER = 1.35;

// 更新 estimateModuleCost：
export function estimateModuleCost(...): ModuleEstimate {
  let rawInput = 0;
  // ... 现有 estimateFast 循环 ...
  const estimatedInput = Math.round(rawInput * CONTEXT_ASSEMBLY_MULTIPLIER) + SYSTEM_PROMPT_TOKEN_OVERHEAD;
  const estimatedOutput = Math.round(estimatedInput * OUTPUT_RATIO);
  return { moduleName, files: [...files], loc, estimatedInput, estimatedOutput };
}

// 更新 ESTIMATION_ASSUMPTION：
export const ESTIMATION_ASSUMPTION =
  'input ≈ estimateFast(源文件拼接文本) × 1.35（context-assembler 开销） + 2000（system prompt）；' +
  'output ≈ 0.3 × estimatedInput。常量测量日期：2026-04，P0 实现后重新校准。';
```

---

## 3. 新增测试计划

| 测试文件 | 测试场景 | 验证点 |
|---------|---------|-------|
| `tests/adapters/python-adapter.test.ts` | `extractSymbolNodes` 在 fixture .py 上输出正确节点 | ID = `{relPath}#{name}`，kind='component'，边 relation='contains' |
| `tests/adapters/python-adapter.test.ts` | 无 exports 的 .py 文件 | 不报错，产出 module 节点，无 containment 边 |
| `tests/adapters/python-adapter.test.ts` | 同名函数在不同文件 | ID 全局唯一（不冲突） |
| `tests/panoramic/graph/graph-builder.test.ts` | Python fixture（3个 .py 含函数定义）注入 ExtractionResult | graph.json 中 kind='component' 节点 ≥ 3，containment 边 ≥ 3 |
| `tests/batch/batch-orchestrator.test.ts` | P1：首次运行 writtenFiles=[] 但 outputDir/project/ 有 .md | hyperedge 集成被触发（不跳过） |
| `tests/debt-scanner/design-docs/doc-discoverer.test.ts` | 含 README.md 的目录 | `discoverDesignDocs()` 返回 README.md 路径 |
| `tests/batch/budget-gate.test.ts` | `estimateModuleCost` 调用 | `estimatedInput > rawEstimate`（确认 overhead 生效） |

---

## 4. 版本与发布

- `contracts/release-contract.yaml`：version 从 v4.0.2 → v4.1.0
- 运行 `npm run release:sync` 同步到 package.json / marketplace.json 等受控位置
- CHANGELOG.md 追加 v4.1.0 条目（4 个修复点）
- specs/M-101-phase2-reading-platform/postmortem.md 追加"Python 集成测试盲区"教训

---

## 5. 风险与对应 verify 步骤

| 风险 | 概率 | verify 步骤 |
|------|------|------------|
| Python WASM 冷启动首次慢（首文件加载延迟） | 低 | micrograd batch 耗时 < 120s |
| 大型项目内存压力 | 中 | 确认 dispose() 在每批次后调用 |
| P1 fix：outputDir/project/ 目录不存在时抛异常 | 中 | 单测 mock 不存在目录，确认返回 [] 不报错 |
| P2 fix：docsScanned=0（projectRoot 传错） | 中 | 加诊断日志后实测确认 docsScanned |
| P3 常量：首版精度 ±30% | 中 | 实测偏差 < 1.3x |
| ExportSymbol → GraphNode ID 冲突 | 中 | 单测同名函数跨文件不冲突 |

---

## 6. 提交计划

| Commit | 包含内容 | 测试要求 |
|--------|---------|---------|
| C1：P0+P1 | python-adapter.ts 扩展 + batch-orchestrator 注入 + designDocAbsPaths 扫盘 | python-adapter 单测 + graph-builder 单测 + batch-orchestrator P1 单测全通过 |
| C2：P2 | debt-scanner 诊断日志 + 修复（依诊断结果） | doc-discoverer 单测通过 |
| C3：P3 | budget-gate.ts 常量校准 | budget-gate.test.ts 通过；micrograd dry-run 偏差 < 1.3x |
| C4：docs + release | CHANGELOG + postmortem 追加 + release-contract 升版 + release:sync | `npm run release:check` 通过 |
