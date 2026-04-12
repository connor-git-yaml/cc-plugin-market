---
feature_id: "101"
feature_name: "graph-persistence"
status: draft
created: "2026-04-12"
task_count: 11
---

# 任务分解：graph-persistence

## 任务依赖图

```
T-101-01（graph-types.ts 类型定义）
    └── T-101-02（confidence-mapper.ts 映射函数）
    │       └── T-101-04（confidence-mapper 单元测试）
    └── T-101-03（architecture-ir-model.ts 字段扩展）
    └── T-101-05（graph-builder.ts 核心实现）← 依赖 T-101-01/02/03
            └── T-101-06（graph/index.ts 统一导出）
            │       └── T-101-07（graph-builder 单元测试）
            │       └── T-101-08（batch-orchestrator.ts 注入）
            │       └── T-101-09（cli/commands/graph.ts 新建）
            │               └── T-101-10（cli/index.ts 命令注册）
            └── T-101-11（graph-persistence 端到端测试）← 依赖 T-101-08/10
```

说明：T-101-03 与 T-101-02 并行，均依赖 T-101-01；T-101-07 与 T-101-08/09 并行，均依赖 T-101-06。

## 任务清单

---

### T-101-01: 新建 graph-types.ts — 所有核心类型定义

- **依赖**: 无
- **复杂度**: S
- **验收标准**: AC-101-03（输出字段结构）
- **实现步骤**:
  1. 创建目录 `src/panoramic/graph/`（若不存在）
  2. 新建 `src/panoramic/graph/graph-types.ts`，按照 spec §数据模型 章节顺序定义以下内容：
     - `ConfidenceLevel` 类型：`export type ConfidenceLevel = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';`
     - `GraphNode` 接口：字段 `id`、`kind`（`'module' | 'package' | 'component' | 'spec' | 'document'`）、`label`、`metadata`
     - `GraphEdge` 接口：字段 `source`、`target`、`relation`、`confidence: ConfidenceLevel`、`confidenceScore: number`
     - `GraphJSON` 接口：`directed: boolean`、`multigraph: false`、`graph`（含 `name`、`generatedAt`、`nodeCount`、`edgeCount`、`sources`、`skippedSources?`、`inputHash?`、`schemaVersion: '1.0'`）、`nodes: GraphNode[]`、`links: GraphEdge[]`
     - `BuildGraphOptions` 接口：`architectureIR?`、`docGraph?`、`crossReferenceLinks?`、`directed?: boolean`
  3. 所有接口和类型均加中文 JSDoc 注释
- **测试**: 无独立测试（类型定义层，由下游任务的编译验证覆盖）
- **完成标志**: `tsc --strict --noEmit` 对 `graph-types.ts` 无报错；`ConfidenceLevel`、`GraphNode`、`GraphEdge`、`GraphJSON`、`BuildGraphOptions` 均正确导出

---

### T-101-02: 新建 confidence-mapper.ts — 置信度映射函数

- **依赖**: T-101-01
- **复杂度**: S
- **验收标准**: AC-101-02（置信度映射正确性）
- **实现步骤**:
  1. 新建 `src/panoramic/graph/confidence-mapper.ts`
  2. 从 `./graph-types.js` import `ConfidenceLevel`
  3. 实现 `CONFIDENCE_SCORES` 常量表：`{ EXTRACTED: 0.95, INFERRED: 0.65, AMBIGUOUS: 0.25 }`
  4. 实现 `mapDocConfidence(docConfidence: 'high' | 'medium' | 'low' | undefined): ConfidenceLevel`：
     - `'high'` → `'EXTRACTED'`；`'medium'` → `'INFERRED'`；`'low'` → `'AMBIGUOUS'`；`undefined` → `'INFERRED'`
  5. 实现 `mapEvidenceConfidence(evidenceCount: number): ConfidenceLevel`：
     - `>= 3` → `'EXTRACTED'`；`>= 1` → `'INFERRED'`；`< 1` → `'AMBIGUOUS'`
  6. 为三个导出项加中文 JSDoc 注释，说明各函数用途和 `evidenceCount` 共用原因（DocGraphReference 与 CrossReferenceLink 语义相同）
- **测试**: T-101-04 覆盖（置信度映射单元测试）
- **完成标志**: `mapDocConfidence`、`mapEvidenceConfidence`、`CONFIDENCE_SCORES` 均正确导出；`tsc --strict --noEmit` 无报错

---

### T-101-03: 修改 architecture-ir-model.ts — 新增可选置信度字段

- **依赖**: T-101-01
- **复杂度**: S
- **验收标准**: AC-101-01（向后兼容）
- **实现步骤**:
  1. 读取 `src/panoramic/models/architecture-ir-model.ts` 确认 `ArchitectureIRRelationship` 接口定义的完整位置（tech-research §1 已确认字段清单）
  2. 在 `ArchitectureIRRelationship` 接口的 `metadata: Record<string, unknown>` 字段**之前**插入两个可选字段（保持字段分组语义清晰）：
     ```typescript
     /** 图谱持久化置信度标签（可选，旧数据缺失时为 undefined） */
     confidence?: ConfidenceLevel;
     /** 置信度数值分数，范围 [0.0, 1.0]（可选） */
     confidenceScore?: number;
     ```
  3. 在文件顶部 import 块中追加：`import type { ConfidenceLevel } from '../graph/graph-types.js';`（使用 `import type` 避免运行时循环依赖）
  4. 确认修改后现有序列化/反序列化代码不受影响（字段为 `?:` 可选）
- **测试**: 运行全量单元测试，确认现有测试无回归；针对向后兼容编写断言：反序列化不含 `confidence` 字段的 JSON 时，字段值为 `undefined` 不抛出错误
- **完成标志**: `ArchitectureIRRelationship` 含 `confidence?: ConfidenceLevel` 和 `confidenceScore?: number` 两个可选字段；`tsc --strict --noEmit` 全仓库无报错；现有单元测试全部通过

---

### T-101-04: 新建 confidence-mapper.test.ts — 置信度映射单元测试

- **依赖**: T-101-02
- **复杂度**: S
- **验收标准**: AC-101-02（7 条断言全覆盖）
- **实现步骤**:
  1. 新建 `tests/unit/confidence-mapper.test.ts`
  2. 针对 `mapDocConfidence` 编写 4 个测试用例：
     - `'high'` → `'EXTRACTED'`，`CONFIDENCE_SCORES.EXTRACTED === 0.95`
     - `'medium'` → `'INFERRED'`，`CONFIDENCE_SCORES.INFERRED` 在 `[0.5, 0.8]` 范围内
     - `'low'` → `'AMBIGUOUS'`，`CONFIDENCE_SCORES.AMBIGUOUS <= 0.4`
     - `undefined` → `'INFERRED'`（未标注保守推断）
  3. 针对 `mapEvidenceConfidence` 编写 3 个测试用例（覆盖 AC-101-02 中 CrossReferenceLink 和 DocGraphReference 共用场景）：
     - `evidenceCount >= 3`（如 `3`）→ `'EXTRACTED'`
     - `evidenceCount === 1` → `'INFERRED'`，`CONFIDENCE_SCORES.INFERRED` 在 `[0.5, 0.8]` 范围内
     - `evidenceCount === 0` → `'AMBIGUOUS'`
  4. 测试框架参照仓库现有 `tests/unit/` 下的测试文件
- **测试**: 即本任务本身
- **完成标志**: `npm test tests/unit/confidence-mapper.test.ts` 7 个断言全部通过；无 TypeScript 编译错误

---

### T-101-05: 新建 graph-builder.ts — 统一图构建核心实现

- **依赖**: T-101-01、T-101-02、T-101-03
- **复杂度**: L
- **验收标准**: AC-101-03（输出格式）、AC-101-04（节点去重）、AC-101-05（原子写入）、AC-101-07（容错降级）
- **实现步骤**:
  1. 新建 `src/panoramic/graph/graph-builder.ts`
  2. import 声明（按需）：
     - `import { writeAtomicJson } from '../../utils/atomic-write.js';`
     - `import type { ArchitectureIR, ArchitectureIRElement } from '../models/architecture-ir-model.js';`
     - `import type { DocGraph } from '../builders/doc-graph-builder.js';`
     - `import type { CrossReferenceLink } from '../../models/module-spec.js';`（根据实际路径确认）
     - `import { CONFIDENCE_SCORES, mapDocConfidence, mapEvidenceConfidence } from './confidence-mapper.js';`
     - `import type { BuildGraphOptions, ConfidenceLevel, GraphEdge, GraphJSON, GraphNode } from './graph-types.js';`
  3. 实现私有常量 `KIND_MAP`：`ArchitectureIRElementKind` → `GraphNode.kind` 的映射对象（按 spec §FR-101-02 映射表）
  4. 实现 `buildKnowledgeGraph(options: BuildGraphOptions): GraphJSON`（参考 Graphify `build.py` 的 last-write-wins 简洁模式）：
     - 用 `Map<string, GraphNode>` 做节点去重（直接用原始 ID 做 key，不做路径规范化）
     - 用 `Map<string, GraphEdge>` 做无向图边去重（key 为 `"${source}|${target}|${relation}"`）
     - **处理 DocGraph（先插入，优先级低）**（包裹在 try/catch）：
       - 遍历 `docGraph.specs`，以 `specPath` 为 ID 插入 kind=`'spec'` 节点
       - 遍历 `docGraph.references`，调用 `mapEvidenceConfidence(ref.evidenceCount)` 获取置信度，插入边 Map
     - **处理 ArchitectureIR（后插入，覆盖同 ID 节点 — last-write-wins）**（包裹在 try/catch）：
       - 遍历 `architectureIR.elements`，直接用 `element.id` 为 key，映射 kind 后 `Map.set` 覆盖
       - 遍历 `architectureIR.relationships`，取 `confidence`（优先使用字段值，缺失时默认 `'EXTRACTED'`），插入边 Map
     - **处理 CrossReferenceLinks**（包裹在 try/catch）：
       - 遍历 `crossReferenceLinks`，调用 `mapEvidenceConfidence(link.evidenceCount)`，插入边 Map
     - **悬空边跳过**（参考 Graphify `build.py` L46-47）：边的 source/target 不在已知节点集合时，`continue` 静默跳过
     - 无向图模式（`directed: false` 默认）：强方向性关系（`contains`、`groups`、`deploys`）保存 `metadata.originalDirection`
     - 有向图模式（`directed: true`）：直接追加所有边，不做三元组合并
     - 异常时追加 `skippedSources` 记录（`{ source: string, reason: string }`）
     - 计算 `inputHash`：取 `DocGraph.generatedAt` + `ArchitectureIR.generatedAt` 拼接后 SHA-256（使用 Node.js `crypto.createHash`），取前 16 位十六进制
     - 返回完整 `GraphJSON`，含 `graph.nodeCount`、`graph.edgeCount`、`graph.schemaVersion: '1.0'`
  6. 实现 `writeKnowledgeGraph(graphJson: GraphJSON, outputDir: string): string`：
     - 构造 `graphJsonPath = path.join(outputDir, '_meta', 'graph.json')`
     - 调用 `writeAtomicJson(graphJsonPath, graphJson)`（同步，无需 await）
     - 返回 `path.resolve(graphJsonPath)`（绝对路径）
  7. 所有函数加中文 JSDoc 注释
- **测试**: T-101-07 覆盖
- **完成标志**: `buildKnowledgeGraph` 和 `writeKnowledgeGraph` 正确导出；`tsc --strict --noEmit` 无报错；T-101-07 单元测试通过

---

### T-101-06: 新建 graph/index.ts — 统一导出入口

- **依赖**: T-101-05
- **复杂度**: S
- **验收标准**: 无独立 AC（作为下游 T-101-07/08/09 的基础导入路径）
- **实现步骤**:
  1. 新建 `src/panoramic/graph/index.ts`
  2. re-export 三个子模块的所有公开接口：
     ```typescript
     // 类型定义
     export type { ConfidenceLevel, GraphNode, GraphEdge, GraphJSON, BuildGraphOptions } from './graph-types.js';
     // 构建函数
     export { buildKnowledgeGraph, writeKnowledgeGraph } from './graph-builder.js';
     // 映射函数与常量
     export { CONFIDENCE_SCORES, mapDocConfidence, mapEvidenceConfidence } from './confidence-mapper.js';
     ```
  3. 文件顶部加中文注释：`// graph 模块统一导出入口，供 batch-orchestrator 和 CLI 使用`
- **测试**: 无独立测试（编译验证：下游 import 路径 `'../graph'` 可解析）
- **完成标志**: `src/panoramic/graph/index.ts` 存在；`tsc --strict --noEmit` 对 `index.ts` 无报错；下游任务可从 `'../graph'` 正确 import

---

### T-101-07: 新建 graph-builder.test.ts — 图构建器单元测试

- **依赖**: T-101-06
- **复杂度**: M
- **验收标准**: AC-101-03（字段结构验证）、AC-101-04（节点去重）、AC-101-07（容错降级）、AC-101-09（性能指标）
- **实现步骤**:
  1. 新建 `tests/unit/graph-builder.test.ts`
  2. 准备 mock 数据辅助函数（在测试文件内定义）：
     - `makeMockIRElement(id, kind)` → `ArchitectureIRElement`
     - `makeMockIRRelationship(sourceId, destId, kind)` → `ArchitectureIRRelationship`
     - `makeMockDocGraph(specPaths)` → `DocGraph`
     - `makeMockCrossRefs(links)` → `CrossReferenceLink[]`
  3. 编写以下测试场景：
     - **字段结构完整性**（AC-101-03）：`buildKnowledgeGraph` 返回值包含 `directed`、`multigraph`、`graph`、`nodes`、`links` 字段；`graph.nodeCount === nodes.length`；`graph.edgeCount === links.length`；`graph.schemaVersion === '1.0'`
     - **节点去重**（AC-101-04）：同一 `filePath` 对应的 IR element 和 DocGraph spec 出现时，`nodes` 数组中只有一条记录；合并后 `metadata` 含两侧非空字段（浅合并验证）
     - **无向图边去重**：同一 `(source, target, relation)` 三元组出现两次时（不同 confidenceScore），保留 `confidenceScore` 更高的一条
     - **不同 relation 不合并**：同一节点对 `A→B` 的 `depends-on` 和 `contains` 边共存
     - **有向图模式**（`directed: true`）：`A→B` 和 `B→A` 同类 relation 边均保留
     - **容错降级**（AC-101-07）：`architectureIR` 为 `undefined` 时 `buildKnowledgeGraph` 不抛出；返回的 `graph.skippedSources` 数组包含被跳过源的记录
     - **性能测试**（AC-101-09）：生成 5,000 个 mock 节点 + 10,000 条 mock 边，`buildKnowledgeGraph` 执行耗时 < 10,000ms（使用 `performance.now()` 计时）
- **测试**: 即本任务本身
- **完成标志**: `npm test tests/unit/graph-builder.test.ts` 全部通过；无 TypeScript 编译错误；性能测试 < 10 秒

---

### T-101-08: 修改 batch-orchestrator.ts — 注入图构建与持久化

- **依赖**: T-101-06
- **复杂度**: M
- **验收标准**: AC-101-05（原子写入）、AC-101-06（batch 集成）
- **实现步骤**:
  1. 读取 `src/batch/batch-orchestrator.ts` 全文，定位 Feature 098 注释行（搜索 `// 注意：不再生成 _doc-graph.json`），确认实际行号（tech-research 确认约 L574）
  2. 在文件顶部 import 块中追加：
     ```typescript
     import { buildKnowledgeGraph, writeKnowledgeGraph } from '../panoramic/graph/index.js';
     ```
  3. 在 Feature 098 注释行**下方**（注释行本身保留，便于理解历史）插入图构建与持久化代码：
     ```typescript
     // Feature 101: 知识图谱持久化（graph-persistence）
     try {
       const graphJson = buildKnowledgeGraph({
         docGraph,
         architectureIR,
         crossReferenceLinks,
       });
       const graphWrittenPath = writeKnowledgeGraph(graphJson, outputDir);
       result.docGraphPath = toProjectPath(graphWrittenPath);
     } catch (graphErr) {
       // 图构建失败不中断整体流程，日志记录后继续
       logger.warn('graph-persistence: 图构建失败，跳过 graph.json 生成', { error: graphErr });
     }
     ```
  4. 确认注入位置处 `docGraph`、`architectureIR`、`crossReferenceLinks` 变量在该作用域内均可访问（tech-research §4 已确认注入点位于步骤 5 大 try 块内，这三个变量均已定义）
  5. 确认 `result.docGraphPath` 字段在 `BatchOrchestratorResult` 类型中已预留（tech-research §7.1 确认 L86 和 L714）；无需修改类型定义
  6. **cache manifest 集成**：在图构建 try 块内，将 `graphJson.graph.inputHash` 写入 cache manifest 的 `dependencyGraph` 预留字段（`schemas.ts` L46）。具体方式：在 batch-orchestrator 的 post-processing 中，若 `cacheManager` 实例可用，调用 `cacheManager.updateManifestField('dependencyGraph', { graphInputHash: graphJson.graph.inputHash, generatedAt: graphJson.graph.generatedAt })` 或等效方式更新 manifest entry
  7. 运行 `tsc --strict --noEmit` 确认编译通过
- **测试**: T-101-11 端到端测试覆盖（batch 集成场景）
- **完成标志**: `batch-orchestrator.ts` 在 Feature 098 注释位置成功注入图构建代码；`result.docGraphPath` 有值；`tsc --strict --noEmit` 无报错；完整 batch 运行后 `_meta/graph.json` 存在

---

### T-101-09: 新建 cli/commands/graph.ts — graph 命令 handler

- **依赖**: T-101-06
- **复杂度**: M
- **验收标准**: AC-101-08（CLI 命令）
- **实现步骤**:
  1. 读取 `src/cli/commands/cache.ts` 确认 handler 文件的完整结构和 import 模式
  2. 新建 `src/cli/commands/graph.ts`，参照 cache.ts 模式实现：
  3. 定义 `GRAPH_HELP` 模板字符串（spec §FR-101-04 已给出完整文本）：包含用法、参数说明、输出路径
  4. 实现三个数据加载辅助函数（TD-04 定义的独立运行策略）：
     - `loadArchitectureIR(outputDir: string): ArchitectureIR | undefined`：读取 `{outputDir}/_meta/architecture-ir.json`，用 try/catch 包裹，失败时返回 `undefined`；读取后仅检查顶层 `elements`、`relationships` 字段存在性（方案 B）
     - `buildDocGraphForCLI(outputDir: string): DocGraph | undefined`：调用 `buildDocGraph()` 轻量构建；需读取 `specs` 目录下的 spec 文件（使用 `scanStoredModuleSpecs`），因 CLI 独立运行无 `DependencyGraph` 时 graceful skip 并返回 `undefined`；用 try/catch 包裹
     - `collectCrossRefs(outputDir: string): CrossReferenceLink[]`：从 spec 文件中的 `crossReferenceIndex` 字段提取，用 try/catch 包裹，失败时返回空数组
  5. 实现 `export async function runGraphCommand(command: CLICommand): Promise<void>`：
     - `command.help` 为 true 时输出 `GRAPH_HELP` 并 return
     - 取 `outputDir = command.outputDir ?? path.join(process.cwd(), 'specs')`
     - 调用三个辅助函数加载数据（任一失败 graceful skip）
     - 调用 `buildKnowledgeGraph({ architectureIR, docGraph, crossReferenceLinks, directed: command.directed ?? false })`
     - 调用 `writeKnowledgeGraph(graphJson, outputDir)` 写盘
     - 成功：`console.log('✓ graph.json 已写入: ' + writtenPath)`；失败：`console.error(...)` 后 `process.exit(1)`
  6. 所有函数加中文 JSDoc 注释
- **测试**: T-101-11 端到端测试覆盖（CLI 独立运行场景）
- **完成标志**: `src/cli/commands/graph.ts` 存在，`runGraphCommand` 正确导出；`tsc --strict --noEmit` 无报错

---

### T-101-10: 修改 cli/index.ts — 注册 graph 子命令

- **依赖**: T-101-09
- **复杂度**: S
- **验收标准**: AC-101-08（CLI 命令注册）
- **实现步骤**:
  1. 读取 `src/cli/index.ts` 全文，确认以下位置（tech-research §6 已给出参考行号）：
     - `CLICommand.subcommand` 联合类型定义位置
     - `CLICommand` 接口中 cache 相关字段位置（`cacheOperation` 等）
     - `parseArgs()` 函数中 `cache` 分支（L130–L171）
     - `switch (command.subcommand)` 位置（L116–L144）
     - `HELP_TEXT` 字符串中 `cache` 相关行（L32–L77）
  2. 在 `CLICommand.subcommand` 联合类型末尾追加 `| 'graph'`
  3. 在 `CLICommand` 接口中，在 `cacheOperation` 字段附近追加：
     ```typescript
     /** graph 命令操作类型 */
     graphOperation?: 'build';
     /** 是否生成有向图（仅 graph 命令） */
     directed?: boolean;
     ```
  4. 在文件顶部 import 块追加：`import { runGraphCommand } from './commands/graph.js';`
  5. 在 `parseArgs()` 函数中，在 `cache` 分支之后追加 `graph` 分支（参照 cache 分支结构）：
     - 识别 `args[0] === 'graph'`，设置 `command.subcommand = 'graph'`、`command.graphOperation = 'build'`
     - 解析 `--directed` flag：存在时设 `command.directed = true`
     - 解析 `--output-dir <dir>` 选项（与 cache 命令共用 `command.outputDir`）
  6. 在 `switch (command.subcommand)` 中，在 `case 'cache'` 之后追加：
     ```typescript
     case 'graph': await runGraphCommand(command); break;
     ```
  7. 在 `HELP_TEXT` 中 `cache` 子命令说明行之后追加（14 字符对齐）：
     ```
       graph         构建知识图谱并输出 _meta/graph.json
       --directed    输出有向图（仅 graph 命令）
     ```
  8. 运行 `tsc --strict --noEmit` 确认编译通过
- **测试**: 手动验证 `spectra graph --help` 输出帮助文本；T-101-11 端到端测试覆盖
- **完成标志**: `spectra graph --help` 输出帮助文本且退出码 0；`spectra graph --directed` 执行后 `graph.directed === true`；`tsc --strict --noEmit` 无报错

---

### T-101-11: 新建 graph-persistence.test.ts — 端到端集成测试

- **依赖**: T-101-08、T-101-10
- **复杂度**: M
- **验收标准**: AC-101-03（格式验证）、AC-101-05（原子写入）、AC-101-06（batch 集成）、AC-101-08（CLI 命令）、AC-101-09（文件大小）
- **实现步骤**:
  1. 新建 `tests/panoramic/graph-persistence.test.ts`
  2. 参照 `tests/panoramic/` 目录下现有端到端测试文件的基础设施（临时目录创建、batch 触发方式等）
  3. 编写以下测试场景：
     - **batch 自动生成**（AC-101-06）：在临时目录准备最小 spec fixture，调用 batch orchestrator，验证 `{outputDir}/_meta/graph.json` 存在且内容为合法 JSON；验证 `BatchOrchestratorResult.docGraphPath` 字段非空且指向 graph.json
     - **graph.json 基础字段检查**（AC-101-03 + 方案 B 验证策略）：读取生成的 `graph.json`，断言 `nodes`、`links`、`graph.generatedAt`、`graph.schemaVersion` 字段存在；`graph.schemaVersion === '1.0'`；`graph.nodeCount === nodes.length`；`graph.edgeCount === links.length`
     - **原子写入安全性**（AC-101-05）：验证 `_meta/` 目录下不存在 `graph.json.tmp` 残留文件（`writeAtomicJson` 使用 renameSync 机制）
     - **CLI 独立运行**（AC-101-08）：通过 Node.js `child_process.execSync` 执行 `spectra graph --output-dir {tempDir}`，验证退出码 0 且 `graph.json` 生成
     - **有向图模式**（AC-101-08）：执行 `spectra graph --directed`，验证 `graph.json` 中 `directed === true`
     - **容错降级**（AC-101-07）：构造仅含 DocGraph（无 ArchitectureIR）的输入，验证 graph.json 仍生成且 `graph.skippedSources` 中包含跳过记录
     - **NetworkX 兼容性**（AC-101-03 + NFR-101-02）：若测试环境有 Python 3 + networkx，执行 `python3 -c "import networkx as nx, json; nx.json_graph.node_link_graph(json.load(open('{path}')))"` 断言无异常；若 Python 不可用则跳过该断言（`test.skip`）
     - **文件大小**（AC-101-09 部分）：生成 500 节点规模的 mock 数据（按比例缩小），验证文件大小 < 5 MB 参考基准
- **测试**: 即本任务本身
- **完成标志**: `npm test tests/panoramic/graph-persistence.test.ts` 全部通过（NetworkX 测试若 Python 不可用允许 skip）；无 TypeScript 编译错误

---

## 实现顺序总结

| 阶段 | 任务 | 并行关系 |
|------|------|----------|
| 阶段 1（基础层） | T-101-01 | 无依赖，首先执行 |
| 阶段 2（并行） | T-101-02、T-101-03 | 均依赖 T-101-01，可并行 |
| 阶段 3（映射测试） | T-101-04 | 依赖 T-101-02 |
| 阶段 4（核心实现） | T-101-05 | 依赖 T-101-01/02/03 |
| 阶段 5（导出层） | T-101-06 | 依赖 T-101-05 |
| 阶段 6（并行） | T-101-07、T-101-08、T-101-09 | 均依赖 T-101-06，可并行 |
| 阶段 7（CLI 注册） | T-101-10 | 依赖 T-101-09 |
| 阶段 8（端到端） | T-101-11 | 依赖 T-101-08/10 |
