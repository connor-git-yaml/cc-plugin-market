---
feature_id: "101"
feature_name: "graph-persistence"
status: draft
created: "2026-04-12"
target_version: "v3.2.0"
depends_on:
  - "099"
  - "100"
required_by:
  - "102"
  - "105"
  - "107"
---

# 技术规划：graph-persistence

## 架构概览

本 Feature 建立 Spectra 的统一知识图谱持久化能力，数据流向如下：

```
三个内存数据源
├── ArchitectureIR          （src/panoramic/models/architecture-ir-model.ts）
│     └── ArchitectureIRElement[] + ArchitectureIRRelationship[]
├── DocGraph                （src/panoramic/builders/doc-graph-builder.ts）
│     └── DocGraphSpecNode[] + DocGraphReference[]
└── CrossReferenceLink[]    （src/panoramic/cross-reference-index.ts）
          │
          ▼
    confidence-mapper.ts
    （统一三级置信度：EXTRACTED / INFERRED / AMBIGUOUS）
          │
          ▼
    graph-builder.ts :: buildKnowledgeGraph()
    （节点 Map 去重 + 边 relation 合并 + 容错 skip）
          │
          ▼
    GraphJSON（NetworkX node-link 格式）
          │
    ┌─────┴──────────────────────┐
    │                            │
    ▼                            ▼
batch-orchestrator.ts       spectra graph CLI
（L574 注入点，自动触发）    （src/cli/commands/graph.ts，独立运行）
    │
    ▼
{outputDir}/_meta/graph.json
（writeAtomicJson 原子写入）
```

整体设计原则：
- **无外部图库**：纯 Node.js 标准库，下游 Feature 102 引入 graphology 时再扩展
- **容错优先**：任意数据源不可用时 graceful skip，不阻断整体构建
- **合同稳定**：`GraphJSON.graph.schemaVersion: '1.0'` 为下游 Feature 102/105/107 的稳定消费合同

---

## 实现分层

### Layer 1：类型与映射基础

**目标文件：**
- `src/panoramic/graph/graph-types.ts` — 所有类型定义
- `src/panoramic/graph/confidence-mapper.ts` — 置信度映射逻辑

**职责：**
- 定义 `ConfidenceLevel`、`GraphNode`、`GraphEdge`、`GraphJSON`、`BuildGraphOptions` 类型
- 实现 `mapDocConfidence()`：`'high'|'medium'|'low'` → `ConfidenceLevel`
- 实现 `mapEvidenceConfidence()`：`evidenceCount: number` → `ConfidenceLevel`
- 导出 `CONFIDENCE_SCORES` 常量表（`EXTRACTED: 0.95`、`INFERRED: 0.65`、`AMBIGUOUS: 0.25`）

**无外部依赖**，可作为整个模块的独立基础层。

---

### Layer 2：Architecture IR 模型扩展

**目标文件：**
- `src/panoramic/models/architecture-ir-model.ts`（修改）

**职责：**
- 为 `ArchitectureIRRelationship` 新增两个**可选**字段：
  - `confidence?: ConfidenceLevel`
  - `confidenceScore?: number`
- 向后兼容：旧数据不含这两个字段时不报错，值为 `undefined`

**前置条件：** Layer 1 `ConfidenceLevel` 类型定义已就绪（需从 `graph-types.ts` import）

---

### Layer 3：图构建核心

**目标文件：**
- `src/panoramic/graph/graph-builder.ts`

**职责：**
- 实现 `buildKnowledgeGraph(options: BuildGraphOptions): GraphJSON`
  - 节点构建：用 `Map<string, GraphNode>` 做 O(1) 去重，last-write-wins 覆盖策略（先 DocGraph 后 IR）
  - 节点合并优先级：`ArchitectureIRElement > DocGraphSpecNode`，`metadata` 做浅合并（`Object.assign`）
  - `ArchitectureIRElement.kind` → `GraphNode.kind` 映射（见 spec §FR-101-02 映射表）
  - 边构建：从三个数据源收集，调用置信度映射器赋值 `confidence` 和 `confidenceScore`
  - 无向图边去重：同一 `(source, target, relation)` 三元组取 `confidenceScore` 更高的一条
  - 强方向性关系（`contains`、`groups`、`deploys`）在无向模式下将原始方向保存至 `metadata.originalDirection`
  - 有向图模式（`directed: true`）：保留所有方向性边，不合并
  - 容错：各数据源用 try/catch 包裹，失败时追加到 `graph.skippedSources`
- 实现 `writeKnowledgeGraph(graphJson: GraphJSON, outputDir: string): string`
  - 调用 `writeAtomicJson(graphJsonPath, graphJson)`（复用 Feature 100 基础设施）
  - 返回实际写入的绝对路径

**前置条件：** Layer 1 类型定义、Layer 2 IR 模型字段扩展均已就绪

---

### Layer 4：持久化集成与 CLI 命令

#### 4a：batch-orchestrator 注入

**目标文件：**
- `src/batch/batch-orchestrator.ts`（修改）

**注入位置：** 约 L574（Feature 098 注释处 `// 注意：不再生成 _doc-graph.json`），精确位置在 `buildDocGraph()` 调用之后、spec 渲染写盘之前。

**注入代码逻辑：**
```typescript
// Feature 101: 知识图谱持久化（graph-persistence）
const graphJson = buildKnowledgeGraph({ docGraph, architectureIR, crossReferenceLinks });
const graphJsonPath = path.join(outputDir, '_meta', 'graph.json');
writeAtomicJson(graphJsonPath, graphJson);
result.docGraphPath = toProjectPath(graphJsonPath);  // 填充预留字段 L714
```

**注入时机：** 步骤 6b（docs-bundle）完成之后，步骤 6c（quality report）之前。实际行号以代码为准，需先确认当前 L574 上下文后再写入。

**注意：** `writeAtomicJson` 是同步调用，无需 `await`，与周边 `fs.writeFileSync` 风格一致。

#### 4b：CLI graph 命令

**目标文件：**
- `src/cli/commands/graph.ts`（新建）
- `src/cli/index.ts`（修改）

**graph.ts 职责：**
- 定义 `GRAPH_HELP` 帮助文本（中文说明，对齐现有格式）
- 实现 `runGraphCommand(command: CLICommand): Promise<void>`
  - 独立运行数据加载策略（不走完整 batch）：
    - `ArchitectureIR`：从磁盘读取 `{outputDir}/_meta/architecture-ir.json`（若存在）
    - `DocGraph`：调用 `buildDocGraph()` 轻量实时构建
    - `CrossReferenceLinks`：从 spec 文件中提取 crossReferenceIndex 段
  - 任一数据源加载失败时 graceful skip（与 batch 容错策略一致）
  - 调用 `buildKnowledgeGraph()` 构建图，`writeKnowledgeGraph()` 写盘
  - 成功后 `console.log()` 输出写入路径，退出码 0
  - 失败时 `console.error()` 输出错误，退出码 1

**index.ts 修改清单（参照 cache 命令模式）：**
1. `CLICommand.subcommand` 联合类型增加 `'graph'`
2. `CLICommand` 接口增加字段：`graphOperation?: 'build'`、`directed?: boolean`
3. `parseArgs()` 增加 `graph` 分支（参照 `cache` 分支，L130–L171）
4. `switch` 增加 `case 'graph': await runGraphCommand(command); break;`
5. `HELP_TEXT` 增加两行（14 字符对齐）：
   ```
     graph         构建知识图谱并输出 _meta/graph.json
     --directed    输出有向图（仅 graph 命令）
   ```

**前置条件：** Layer 3 `buildKnowledgeGraph`、`writeKnowledgeGraph` 已实现并导出

---

### Layer 5：模块统一导出

**目标文件：**
- `src/panoramic/graph/index.ts`（新建）

**职责：** re-export `graph-types.ts`、`graph-builder.ts`、`confidence-mapper.ts` 的公开接口，供 batch-orchestrator 和 CLI 统一从 `../graph` 导入。

---

### Layer 6：测试

**目标文件：**
- `tests/unit/confidence-mapper.test.ts`（新建）
- `tests/unit/graph-builder.test.ts`（新建）
- `tests/panoramic/graph-persistence.test.ts`（新建）

**单元测试覆盖范围：**
- `confidence-mapper.test.ts`：三级映射规则全覆盖（AC-101-02 中 7 条断言）
- `graph-builder.test.ts`：
  - 节点去重（同一 filePath 只出现一条记录，metadata 浅合并正确）
  - 容错降级（`architectureIR` 为 `undefined` 时不抛出，`skippedSources` 有记录）
  - 无向图边去重（同一三元组取高置信度边）
  - 有向图模式（`directed: true` 时保留所有方向边）
  - 输出字段结构完整性验证（AC-101-03）
  - 性能 benchmark（5,000 节点 / 10,000 边 < 10 秒）

**端到端测试覆盖范围：**
- `graph-persistence.test.ts`：
  - `spectra batch` → `_meta/graph.json` 自动生成
  - graph.json 可通过基础字段检查（`nodes`、`links`、`graph.generatedAt`、`graph.schemaVersion` 存在）
  - `BatchOrchestratorResult.docGraphPath` 字段值为 graph.json 相对路径
  - NetworkX 兼容性验证（Python 脚本断言）

---

## 实现顺序

按依赖关系排列，底层先行：

| 步骤 | 文件 | 输入 | 输出 | 前置条件 |
|------|------|------|------|----------|
| 1 | `graph-types.ts` | 无 | `ConfidenceLevel`、`GraphNode`、`GraphEdge`、`GraphJSON`、`BuildGraphOptions` 类型定义 | 无 |
| 2 | `confidence-mapper.ts` | `graph-types.ts` 中的 `ConfidenceLevel` | `mapDocConfidence`、`mapEvidenceConfidence`、`CONFIDENCE_SCORES` | 步骤 1 |
| 3 | `architecture-ir-model.ts`（修改） | `ConfidenceLevel` 类型 | `ArchitectureIRRelationship` 增加两个可选字段 | 步骤 1 |
| 4 | `confidence-mapper.test.ts` | 步骤 2 产物 | 置信度映射单元测试通过 | 步骤 2 |
| 5 | `graph-builder.ts` | 步骤 1/2/3 产物，`writeAtomicJson` | `buildKnowledgeGraph`、`writeKnowledgeGraph` 实现 | 步骤 1–3 |
| 6 | `panoramic/graph/index.ts` | 步骤 1/2/5 产物 | 统一 re-export | 步骤 5 |
| 7 | `graph-builder.test.ts` | 步骤 5 产物 | 图构建单元测试通过 | 步骤 5 |
| 8 | `batch-orchestrator.ts`（修改） | 步骤 6 产物，`writeAtomicJson` | L574 注入图构建调用，`result.docGraphPath` 填值 | 步骤 6 |
| 9 | `cli/commands/graph.ts`（新建） | 步骤 6 产物，`CLICommand` 类型 | `runGraphCommand` 实现 | 步骤 6 |
| 10 | `cli/index.ts`（修改） | 步骤 9 产物 | `graph` 子命令注册完成 | 步骤 9 |
| 11 | `graph-persistence.test.ts` | 步骤 8/10 产物 | 端到端测试通过 | 步骤 8/10 |

---

## 关键技术决策

### TD-01：置信度映射合并为两个函数

**决策：** `confidence-mapper.ts` 只提供 `mapDocConfidence` 和 `mapEvidenceConfidence` 两个函数。`DocGraphReference` 和 `CrossReferenceLink` 的 `evidenceCount` 字段语义相同（引用证据条数），共用 `mapEvidenceConfidence`，不做冗余拆分。

**Rationale：** 避免接口爆炸。两个数据源在证据计数上语义等价，强行区分会增加维护负担，也会使调用者困惑。未来若语义分化再做拆分，成本低于过早设计的认知复杂度。

---

### TD-02：节点去重策略（last-write-wins，参考 Graphify build.py）

**决策：** 不做 ID 规范化（删除 `normalizeNodeId`），直接使用各数据源的原始 ID。去重采用插入顺序覆盖：
1. 先插入 DocGraphSpecNode（`specPath` 为 key，较少元数据）
2. 后插入 ArchitectureIRElement（`element.id` 为 key，较丰富元数据）— 同 ID 直接覆盖

边的 source/target 不在已知节点集合中时，静默跳过（`continue`）。

**Rationale：** Graphify 的 `build.py` 用 NetworkX `G.add_node()` 幂等特性做去重，同 ID 后写覆盖。我们用 `Map.set()` 达到相同效果。不做路径规范化避免了"不同语义节点被误合并"的风险（Graphify 核心函数只有 20 行，无规范化逻辑，实践证明足够可靠）。悬空边跳过参考 Graphify L46-47。

---

### TD-03：无向图边去重策略

**决策：**
- 同一 `(source, target, relation)` 三元组：在 `Map<string, GraphEdge>` 中，以三元组的序列化字符串为 key；重复时取 `confidenceScore` 更高的一条
- 不同 `relation` 类型的边不合并（`A→B depends-on` 和 `A→B contains` 共存）
- 强方向性关系（`contains`、`groups`、`deploys`）在无向模式下仍保留原始方向信息至 `metadata.originalDirection`

**Rationale：** 无向图中同方向和反方向的同类关系在语义上等价，取置信度高的保留信息质量。不同 relation 类型代表不同语义，不应合并。强方向性关系的 `originalDirection` 为下游 Feature 102 社区检测提供必要的方向信息，避免语义丢失。

---

### TD-04：CLI 独立运行数据加载策略

**决策：** `spectra graph` 独立运行时采用混合加载策略：
- `ArchitectureIR`：从磁盘读取 `{outputDir}/_meta/architecture-ir.json`（缓存文件，若存在）
- `DocGraph`：调用 `buildDocGraph()` 轻量实时构建（读取 specs 目录 + 依赖图）
- `CrossReferenceLinks`：从已生成的 spec 文件中提取 `crossReferenceIndex` 段

任一加载失败时 graceful skip，不中断图构建。

**Rationale：** CLI 独立运行的场景是用户在 batch 跑完之后手动重建图（如调试或更改 `--directed` 模式），不需要重跑完整 batch。ArchitectureIR 从磁盘读取是因为其构建链（WorkspaceIndexGenerator + CrossPackageAnalyzer）成本较高；DocGraph 实时构建是因为其依赖 spec 文件状态，磁盘缓存可能已过期。

---

### TD-05：DocGraph / ArchitectureIR 验证策略选择方案 B

**决策：** MVP 阶段对 `DocGraph`、`ArchitectureIR`、`graph.json` 的读取均采用方案 B（基础字段检查），不新建 Zod Schema。

**Rationale：** 两者均为纯 TypeScript interface，无现有 Zod Schema。新建完整 Schema 的工作量与本 Feature 核心目标不成比例（spec 中明确声明为 Future Work）。方案 B 在 TypeScript strict 模式写入时已有类型保证，MVP 阶段读取时检查顶层字段存在性即可满足容错要求。

---

### TD-06：cache manifest 集成策略

**决策：** 利用 `src/panoramic/cache/schemas.ts` L46 预留的 `dependencyGraph: z.unknown().optional()` 字段，在 cache manifest 中记录 graph.json 的输入 hash（`DocGraph` + `ArchitectureIR` 内容摘要，SHA-256 前 16 位），供增量构建判断是否需要重新生成图。

**Rationale：** Feature 100 已预留该扩展字段，直接注入避免修改 Zod Schema。`inputHash` 作为 graph.json 的 `graph.inputHash` 字段同步写出，下游 Feature 可通过比对 hash 判断缓存是否有效，为 Feature 106（watch-incremental）提供基础。

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| batch-orchestrator L574 实际行号与文档不符，注入位置偏移 | 中 | 中 | 实现前先读取 batch-orchestrator.ts 确认 Feature 098 注释的实际行号，以注释内容（`不再生成 _doc-graph.json`）定位，而非硬编码行号 |
| `buildDocGraph()` 在 CLI 独立运行时依赖的 `DependencyGraph` 无法从磁盘恢复 | 中 | 中 | CLI 加载层加 try/catch；若 `DependencyGraph` 缺失则跳过 DocGraph 数据源，在 `skippedSources` 中标注；用户手册提示先运行 `spectra batch` 初始化缓存 |
| 不同数据源的同 ID 节点被错误覆盖 | 低 | 中 | 采用 last-write-wins（IR 覆盖 DocGraph），不做路径规范化避免误合并；单元测试覆盖多数据源 ID 冲突场景 |
| 5,000 节点 / 10,000 边场景下 JSON.stringify 成为性能瓶颈 | 低 | 中 | 使用 `Map` 做节点去重（O(1) 查找），避免 O(n²)；JSON.stringify 为 V8 native 实现，5,000 节点规模预计 < 100ms；若超出 < 10s 目标需在性能测试中发现后 profile |
| `ArchitectureIRRelationship` 新增可选字段导致现有序列化/反序列化测试失败 | 低 | 低 | 字段为可选（`?:`），TypeScript strict 模式不要求现有代码处理；现有 JSON 数据反序列化时字段缺失值为 `undefined`，不破坏现有逻辑；修改后运行全量单元测试验证 |
| graph.json 写入 `_meta/` 时目录不存在 | 低 | 低 | `writeAtomicJson` 内部调用 `fs.mkdirSync(dir, { recursive: true })`，自动创建目录，无需预处理 |
| NetworkX 兼容性格式与 Python 实际 `node_link_graph()` 要求存在细节偏差 | 低 | 高 | spec 中已定义完整 JSON 示例；`links` 键（而非 `edges`）是 NetworkX node-link 格式的关键；端到端测试中执行 Python 脚本验证无异常 |

---

## 文件变更清单

按实现顺序排列：

### 新建文件

| 顺序 | 文件路径 | 说明 |
|------|----------|------|
| 1 | `src/panoramic/graph/graph-types.ts` | `ConfidenceLevel`、`GraphNode`、`GraphEdge`、`GraphJSON`、`BuildGraphOptions` 类型定义 |
| 2 | `src/panoramic/graph/confidence-mapper.ts` | `mapDocConfidence`、`mapEvidenceConfidence`、`CONFIDENCE_SCORES` |
| 3 | `src/panoramic/graph/graph-builder.ts` | `buildKnowledgeGraph`、`writeKnowledgeGraph` 实现 |
| 4 | `src/panoramic/graph/index.ts` | 统一 re-export：graph-types、graph-builder、confidence-mapper |
| 5 | `src/cli/commands/graph.ts` | `runGraphCommand`、`GRAPH_HELP`、CLI 数据加载辅助函数 |
| 6 | `tests/unit/confidence-mapper.test.ts` | 置信度映射单元测试（AC-101-02 全覆盖） |
| 7 | `tests/unit/graph-builder.test.ts` | 图构建单元测试（节点去重、边合并、容错、性能） |
| 8 | `tests/panoramic/graph-persistence.test.ts` | 端到端测试（batch 集成、NetworkX 兼容性） |

### 修改文件

| 顺序 | 文件路径 | 修改内容 |
|------|----------|----------|
| 3a | `src/panoramic/models/architecture-ir-model.ts` | `ArchitectureIRRelationship` 增加 `confidence?: ConfidenceLevel`、`confidenceScore?: number`（import 来自 `graph-types.ts`） |
| 8a | `src/batch/batch-orchestrator.ts` | L574 注入 `buildKnowledgeGraph` + `writeAtomicJson` 调用；L714 填充 `result.docGraphPath` |
| 10a | `src/cli/index.ts` | `CLICommand.subcommand` 增加 `'graph'`；`CLICommand` 增加 `graphOperation`、`directed` 字段；`parseArgs` 增加 graph 分支；`switch` 增加 `case 'graph'`；`HELP_TEXT` 增加子命令说明 |
