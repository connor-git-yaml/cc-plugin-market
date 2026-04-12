---
feature_id: "101"
feature_name: "graph-persistence"
status: draft
priority: P2
target_version: "v3.2.0"
created: "2026-04-12"
depends_on:
  - "099"
  - "100"
required_by:
  - "102"
  - "105"
  - "107"
milestone: "M-100 Spectra Evolution Phase 2"
---

# Feature 101: graph-persistence

## 概述

为 Spectra 引入统一的知识图谱持久化能力：通过置信度标签系统对所有关系进行可信度分级，由新建的 `graph-builder.ts` 将 architecture-ir、doc-graph、cross-reference-index 三个分散数据源合并为单一 NetworkX 兼容的 `_meta/graph.json` 文件，并提供 `spectra graph` CLI 命令支持独立调用。本 Feature 是 Phase 2 的门控节点，102（community-analysis）、105（mcp-graph-query）、107（multi-modal-extraction）均依赖其产物。

## 动机与背景

当前 Spectra 的知识表示分散在三个相互独立的内存结构中：

- `ArchitectureIRRelationship`（来自 `architecture-ir-model.ts`）：AST 级结构关系，无置信度字段
- `DocGraph`（来自 `doc-graph-builder.ts`）：文档级节点与引用，Feature 098 已将其从磁盘写盘中移除，目前仅在内存中流转
- `CrossReferenceIndex`（来自 `cross-reference-index.ts`）：模块间交叉引用，同样仅在内存中存在

下游的社区检测（Feature 102）、MCP 图查询（Feature 105）等功能均需要一个可消费的持久化图结构。当前缺乏统一图格式和落盘机制，导致这些 Feature 无法实现。

Feature 100 已建立 `atomicWrite` 工具和 cache manifest 体系，为本 Feature 提供可复用的写盘基础设施。`batch-orchestrator.ts` L574 处留有 Feature 098 的注释残迹（`// 注意：不再生成 _doc-graph.json`），该位置正是 Feature 101 的精确注入点。`BatchOrchestratorResult.docGraphPath` 字段已在 L86 和 L714 预留但未填值，Feature 101 直接补充即可。

## 需求详述

### FR-101-01: 置信度标签系统

为所有图边关系引入统一的三级置信度体系，解决各数据源置信度表达不一致的问题。

**置信度级别定义：**

| 级别 | 含义 | confidenceScore 范围 | 典型来源 |
|------|------|----------------------|----------|
| `EXTRACTED` | AST 直接提取的确定性关系（import、call、contains） | 0.9–1.0 | architecture-ir 关系、doc-graph 中 confidence='high' |
| `INFERRED` | LLM 推理的语义关系 | 0.5–0.8 | doc-graph 中 confidence='medium'，CrossReferenceLink 的跨模块引用 |
| `AMBIGUOUS` | 弱信号、间接引用 | 0.1–0.4 | doc-graph 中 confidence='low'，证据数量 < 2 的 CrossReferenceLink |

**修改范围：**

1. 修改 `src/panoramic/models/architecture-ir-model.ts`：为 `ArchitectureIRRelationship` 新增两个可选字段，向后兼容（旧数据无此字段时默认 `undefined`）：
   ```typescript
   confidence?: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
   confidenceScore?: number;  // 范围 [0.0, 1.0]
   ```

2. 新建 `src/panoramic/graph/confidence-mapper.ts`：将各数据源的置信度表达映射到统一三级标签：
   - `mapDocConfidence`：`DocGraphSpecNode.confidence`（`'high' | 'medium' | 'low'`）→ `ConfidenceLevel`（用于节点级置信度）
   - `mapEvidenceConfidence`：基于 `evidenceCount` 推断，统一用于 `DocGraphReference` 和 `CrossReferenceLink`（两者 evidenceCount 语义相同，共用一个函数，不做冗余拆分）
   - `ArchitectureIRRelationship`：若已携带 `confidence` 字段则直接使用；否则默认 `'EXTRACTED'`（AST 提取的结构关系）

**约束：**

- `ArchitectureIRRelationship` 中 confidence 字段必须可选；旧数据反序列化时字段缺失不报错
- `confidenceScore` 取值必须在 `[0.0, 1.0]` 范围内

---

### FR-101-02: 统一图构建器（graph-builder.ts）

新建 `src/panoramic/graph/graph-builder.ts`，将三个数据源合并为单一 `GraphJSON` 对象。

**数据源映射规则：**

| 数据源 | 映射目标 | 节点 kind | 备注 |
|--------|----------|-----------|------|
| `ArchitectureIRElement` | `GraphNode` | 取 element.kind 映射（见下） | id 使用 element.id |
| `DocGraphSpecNode` | `GraphNode` | `'spec'` | id 使用 specPath |
| `ArchitectureIRRelationship` | `GraphEdge` | — | confidence 由字段或映射器提供 |
| `DocGraphReference` | `GraphEdge` | — | confidence 由 mapper 转换 |
| `CrossReferenceLink` | `GraphEdge` | — | confidence 由 evidenceCount 推断 |

`ArchitectureIRElement.kind` 到 `GraphNode.kind` 的映射：
- `'software-system'` → `'component'`
- `'container'` → `'module'`
- `'component'` → `'component'`
- `'deployment-node'` | `'infrastructure-node'` → `'module'`
- `'external-system'` → `'component'`
- `'image'` → `'module'`

**节点去重策略（参考 Graphify `build.py` 的 last-write-wins 模式）：**

节点以原始 `id` 为 key，不做路径规范化（避免 `normalizeNodeId` 的额外复杂度）。具体：
- `ArchitectureIRElement`：直接使用 `element.id`
- `DocGraphSpecNode`：直接使用 `specPath`

去重采用 **insertion-order-wins**：先插入 `DocGraphSpecNode`（较少元数据），后插入 `ArchitectureIRElement`（较丰富元数据），后者覆盖前者。这与 Graphify 的"语义节点覆盖 AST 节点"策略一致，避免显式合并逻辑。节点插入使用 `Map.set(id, node)`，同 ID 后写直接覆盖。

**悬空边处理（参考 Graphify `build.py` L46-47）：**

边的 `source` 或 `target` 不在已知节点集合中时，静默跳过（`continue`），不报错。这处理了 stdlib/external 引用等预期场景。

**`--directed` 模式对边处理的影响：**

- `directed: false`（默认无向图）：对于同一对节点 A↔B 的相同 `relation` 类型，仅保留一条边（保留 `confidenceScore` 更高的一条）。但不同 `relation` 类型的边不做合并（A→B `depends-on` 和 A→B `contains` 共存）
- `directed: true`（有向图）：保留所有方向性边不做合并，A→B 和 B→A 视为独立边
- 强方向性关系（`contains`、`groups`、`deploys`）在无向模式下仍保留原始方向信息在 `metadata.originalDirection` 中

**容错要求：**

- 某数据源不存在（如 `crossReferenceIndex` 为空数组或 `undefined`）时 graceful skip，在 `GraphJSON.graph.skippedSources` 中标注被跳过的数据源名称
- 数据源解析异常时捕获并记录，不中断整体图构建流程

**函数签名：**

```typescript
export interface BuildGraphOptions {
  architectureIR?: ArchitectureIR;
  docGraph?: DocGraph;
  crossReferenceLinks?: CrossReferenceLink[];
  directed?: boolean;  // 是否生成有向图，默认 false
}

export function buildKnowledgeGraph(options: BuildGraphOptions): GraphJSON
```

---

### FR-101-03: graph.json 持久化

将构建完成的 `GraphJSON` 原子写入 `_meta/graph.json`，并在 batch 流程中自动触发。

**写入路径：** `{outputDir}/_meta/graph.json`（`outputDir` 来自 batch-orchestrator 的当前输出目录上下文）

**原子写入：** 直接复用 `src/utils/atomic-write.ts` 中的 `writeAtomicJson` 函数：

```typescript
import { writeAtomicJson } from '../../utils/atomic-write.js';
writeAtomicJson(graphJsonPath, graphJson);  // 同步调用，无需 await
```

**Batch 注入点：** `src/batch/batch-orchestrator.ts` 约 **L574**（Feature 098 注释处），位置在 `buildDocGraph()` 调用之后、spec 渲染写盘之前：

```typescript
// Feature 101: 知识图谱持久化（graph-persistence）
const graphJson = buildKnowledgeGraph({ docGraph, architectureIR, crossReferenceLinks });
const graphWrittenPath = writeKnowledgeGraph(graphJson, outputDir);
// 填充预留的 docGraphPath 字段（BatchOrchestratorResult L714）
result.docGraphPath = toProjectPath(graphWrittenPath);
```

注入顺序：docs-bundle 生成之后（步骤 6b，L646–L656）、quality report 之前（步骤 6c，L658–L672）。具体位置根据实际代码行号确认。

**cache manifest 集成：** 利用 Feature 100 在 `src/panoramic/cache/schemas.ts` L46 预留的扩展字段：

```typescript
/** 预留字段：供 Feature 101（graph-persistence）扩展依赖图 */
dependencyGraph: z.unknown().optional(),
```

在 cache manifest 中记录 graph.json 的输入 hash（`DocGraph` + `ArchitectureIR` 内容摘要），供增量构建判断是否需要重新生成图。

---

### FR-101-04: CLI 命令（spectra graph）

新建 `src/cli/commands/graph.ts`，在 `src/cli/index.ts` 中注册 `graph` 子命令，支持独立调用图构建而不运行完整 batch。

**CLI 接口：**

```
spectra graph [--directed] [--output-dir <dir>]
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--directed` | flag | false | 输出有向图（默认无向） |
| `--output-dir` | string | `{cwd}/specs` | 指定输出根目录（graph.json 写入 `{output-dir}/_meta/graph.json`） |

**注册步骤：**

1. `CLICommand.subcommand` 联合类型增加 `'graph'`
2. `CLICommand` 接口增加字段：`graphOperation?: 'build'`、`directed?: boolean`
3. `parseArgs()` 增加 `graph` 分支（参照 `cache` 分支，`src/cli/index.ts` L130–L171）
4. `index.ts` switch 增加 `case 'graph': await runGraphCommand(command); break;`
5. HELP_TEXT 增加子命令说明行（14 字符对齐，参照现有格式）

**HELP_TEXT 新增行：**

```
  graph         构建知识图谱并输出 _meta/graph.json
  --directed    输出有向图（仅 graph 命令）
```

**graph.ts 实现模式（参照 cache.ts）：**

```typescript
const GRAPH_HELP = `spectra graph — 构建并持久化知识图谱

用法：
  spectra graph [--directed] [--output-dir <dir>]

说明：
  读取当前项目的 architecture-ir、doc-graph、cross-reference-index，
  合并构建 NetworkX 兼容的 graph.json 并写入 _meta/ 目录。
`;

export async function runGraphCommand(command: CLICommand): Promise<void> {
  if (command.help) {
    console.log(GRAPH_HELP);
    return;
  }
  const outputDir = command.outputDir ?? path.join(process.cwd(), 'specs');

  // 数据源加载策略（独立运行，不走完整 batch）：
  // 1. ArchitectureIR：读取 {outputDir}/_meta/architecture-ir.json（若存在）
  // 2. DocGraph：调用 buildDocGraph() 实时构建（需读取 specs 目录 + 依赖图）
  // 3. CrossReferenceLinks：从已生成的 spec 文件中提取 crossReferenceIndex 段
  // 任一数据源加载失败 → graceful skip，不中断图构建
  const architectureIR = loadArchitectureIR(outputDir);   // 从磁盘缓存读取
  const docGraph = buildDocGraphForCLI(outputDir);         // 轻量实时构建
  const crossReferenceLinks = collectCrossRefs(outputDir); // 从 spec 文件提取

  const graphJson = buildKnowledgeGraph({
    architectureIR,
    docGraph,
    crossReferenceLinks,
    directed: command.directed ?? false,
  });
  const writtenPath = writeKnowledgeGraph(graphJson, outputDir);
  console.log(`✓ graph.json 已写入: ${writtenPath}`);
}
```

## 非功能需求

### NFR-101-01: 性能

| 场景 | 目标 |
|------|------|
| 5,000 节点 / 10,000 边图构建 | < 10 秒 |
| graph.json 文件大小 | < 5 MB（5,000 节点规模） |
| `spectra graph` 命令冷启动 | < 3 秒（中型项目 ~200 模块） |

节点去重使用 `Map<string, GraphNode>`（O(1) 查找），避免 O(n²) 遍历。

### NFR-101-02: 兼容性

**NetworkX 兼容：** `graph.json` 必须可通过 Python `networkx.json_graph.node_link_graph()` 无错加载，字段结构严格遵循 node-link 格式（见数据模型章节）。

**向后兼容：** `ArchitectureIRRelationship.confidence` 和 `confidenceScore` 必须为可选字段；旧版本产出的数据（无此字段）在新版本读取时不报错，字段值 `undefined`。

**无外部图库：** 纯 Node.js 标准库实现，不引入 graphology 等第三方图库（留给 Feature 102 社区检测时引入）。

### NFR-101-03: 容错

- 任意单一数据源不可用时，图构建继续执行，在 `graph.json` 元数据中标注跳过原因
- `DocGraph` 无 Zod schema（见 §约束与依赖 中的验证策略），读取时采用方案 B（基础字段检查），不阻断流程
- `writeAtomicJson` 异常（磁盘满等）允许向上传播，由 batch-orchestrator 的外层 try/catch 捕获

## 数据模型

### ConfidenceLevel（置信度枚举）

```typescript
// src/panoramic/graph/graph-types.ts

export type ConfidenceLevel = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
```

### GraphNode

```typescript
export interface GraphNode {
  /** 节点唯一标识符，通常为文件路径或元素 ID */
  id: string;
  /** 节点类型 */
  kind: 'module' | 'package' | 'component' | 'spec' | 'document';
  /** 显示标签 */
  label: string;
  /** 附加元数据（来源标记、technology 等） */
  metadata: Record<string, unknown>;
}
```

### GraphEdge

```typescript
export interface GraphEdge {
  /** 来源节点 ID */
  source: string;
  /** 目标节点 ID */
  target: string;
  /** 关系类型（来自 ArchitectureIRRelationshipKind 或 DocGraphReference.kind 等） */
  relation: string;
  /** 统一三级置信度标签 */
  confidence: ConfidenceLevel;
  /** 置信度数值分数，范围 [0.0, 1.0] */
  confidenceScore: number;
}
```

### GraphJSON（NetworkX node-link 格式）

```typescript
export interface GraphJSON {
  /** 是否有向图 */
  directed: boolean;
  /** 是否多重图（本 Feature 固定为 false） */
  multigraph: false;
  /** 图级元数据 */
  graph: {
    name: 'spectra-knowledge-graph';
    /** ISO 8601 时间戳 */
    generatedAt: string;
    /** 节点总数 */
    nodeCount: number;
    /** 边总数 */
    edgeCount: number;
    /** 图构建使用的数据源列表 */
    sources: ('architecture-ir' | 'doc-graph' | 'cross-reference')[];
    /** 被跳过的数据源及原因（容错标注） */
    skippedSources?: Array<{
      source: string;
      reason: string;
    }>;
    /** Feature 100 cache：输入内容 hash（SHA-256 前 16 位） */
    inputHash?: string;
    /** graph.json 格式版本号，用于下游 Feature 兼容性判断 */
    schemaVersion: '1.0';
  };
  /** 节点数组 */
  nodes: GraphNode[];
  /** 边数组（NetworkX node-link 格式使用 "links" 键） */
  links: GraphEdge[];
}
```

**完整 JSON 示例：**

```json
{
  "directed": false,
  "multigraph": false,
  "graph": {
    "name": "spectra-knowledge-graph",
    "generatedAt": "2026-04-12T00:00:00Z",
    "nodeCount": 5000,
    "edgeCount": 10000,
    "sources": ["architecture-ir", "doc-graph", "cross-reference"],
    "skippedSources": [],
    "inputHash": "a3f1b2c4d5e6f789",
    "schemaVersion": "1.0"
  },
  "nodes": [
    {
      "id": "src/cli/index.ts",
      "kind": "module",
      "label": "CLI Entry",
      "metadata": { "technology": "TypeScript", "sourceTag": "workspace-index" }
    }
  ],
  "links": [
    {
      "source": "src/cli/index.ts",
      "target": "src/mcp/server.ts",
      "relation": "depends-on",
      "confidence": "EXTRACTED",
      "confidenceScore": 0.95
    }
  ]
}
```

### 置信度映射器（confidence-mapper.ts）

```typescript
// src/panoramic/graph/confidence-mapper.ts

/** 置信度级别到默认分数的映射表 */
export const CONFIDENCE_SCORES: Record<ConfidenceLevel, number> = {
  EXTRACTED: 0.95,
  INFERRED:  0.65,
  AMBIGUOUS: 0.25,
};

/** DocGraphSpecNode.confidence（三级字符串） → 统一 ConfidenceLevel */
export function mapDocConfidence(
  docConfidence: 'high' | 'medium' | 'low' | undefined
): ConfidenceLevel {
  switch (docConfidence) {
    case 'high':   return 'EXTRACTED';
    case 'medium': return 'INFERRED';
    case 'low':    return 'AMBIGUOUS';
    default:       return 'INFERRED';   // 未标注，保守推断
  }
}

/**
 * 基于证据数量推断置信度（统一用于 DocGraphReference 和 CrossReferenceLink）
 *
 * 两个数据源的 evidenceCount 语义相同（引用证据条数），
 * 因此共用同一阈值逻辑，不做冗余拆分。
 */
export function mapEvidenceConfidence(evidenceCount: number): ConfidenceLevel {
  if (evidenceCount >= 3) return 'EXTRACTED';
  if (evidenceCount >= 1) return 'INFERRED';
  return 'AMBIGUOUS';
}
```

> **设计说明（GraphEdge.confidence 必填 vs ArchitectureIRRelationship.confidence 可选）：**
> `ArchitectureIRRelationship.confidence` 可选是为了向后兼容（旧数据不含此字段）。
> `GraphEdge.confidence` 必填是因为 graph.json 是新格式、新产物，每条边在构建时必定经过 confidence-mapper 赋值，不存在"历史遗留数据缺字段"的场景。
> 如果 ArchitectureIRRelationship 上的 confidence 字段缺失，graph-builder 默认按 `'EXTRACTED'` 处理（AST 提取的结构关系是高置信度的）。

## 接口定义

### buildKnowledgeGraph()

```typescript
/**
 * 从三个数据源构建统一知识图谱
 *
 * @param options - 数据源输入，所有字段均可选；缺失数据源 graceful skip
 * @returns NetworkX node-link 兼容的 GraphJSON 对象
 */
export function buildKnowledgeGraph(options: BuildGraphOptions): GraphJSON

export interface BuildGraphOptions {
  /** Architecture IR 数据（可选，缺失时跳过 IR 节点和关系） */
  architectureIR?: ArchitectureIR;
  /** Doc Graph 数据（可选，缺失时跳过文档节点） */
  docGraph?: DocGraph;
  /** Cross Reference Link 列表（可选，缺失时跳过跨引用边） */
  crossReferenceLinks?: CrossReferenceLink[];
  /** 是否生成有向图，默认 false */
  directed?: boolean;
}
```

### writeKnowledgeGraph()

```typescript
/**
 * 将 GraphJSON 原子写入目标路径
 * 内部调用 writeAtomicJson，同步执行
 *
 * @param graphJson - buildKnowledgeGraph() 的返回值
 * @param outputDir - 项目输出根目录（graph.json 写入 {outputDir}/_meta/graph.json）
 * @returns 实际写入的绝对路径
 */
export function writeKnowledgeGraph(graphJson: GraphJSON, outputDir: string): string
```

### CLI: spectra graph

```
spectra graph [--directed] [--output-dir <dir>]

选项：
  --directed          输出有向图（默认为无向图）
  --output-dir <dir>  指定输出根目录（默认：{cwd}/specs）
  --help              显示帮助信息

输出：
  {output-dir}/_meta/graph.json

退出码：
  0  成功
  1  图构建失败（错误信息输出到 stderr）
```

## 约束与依赖

### 前置依赖

| Feature | 状态 | 依赖内容 |
|---------|------|----------|
| Feature 099（品牌重命名 Spectra v3.0.0） | ✅ 已完成 | 命名空间、CLI 入口名称 |
| Feature 100（content-hash-cache） | ✅ 已完成 | `writeAtomicJson`、cache manifest `dependencyGraph` 预留字段 |

### 后续依赖本 Feature

| Feature | 依赖内容 |
|---------|---------|
| Feature 102（community-analysis） | `graph.json` 文件格式、`GraphJSON` 类型 |
| Feature 105（mcp-graph-query） | `_meta/graph.json` 路径约定、`GraphNode`/`GraphEdge` 类型 |
| Feature 107（multi-modal-extraction） | `ConfidenceLevel` 类型、`buildKnowledgeGraph()` 接口 |

**格式稳定性声明：** `GraphJSON` 的 `schemaVersion: '1.0'` 为稳定合同。下游 Feature 102/105/107 可依赖以下不变量：
- `nodes[*].id`、`nodes[*].kind`、`links[*].source`、`links[*].target`、`links[*].confidence` 字段名和类型不变
- `graph.schemaVersion` 遵循 SemVer：新增可选字段 → minor bump，移除/改名 → major bump
- 破坏性变更必须伴随 migration 脚本

### 技术约束

1. **无外部图库**：纯 Node.js 标准库实现，不引入 graphology 等图计算库
2. **TypeScript strict 模式**：所有新增代码通过 `tsc --strict` 编译
3. **中文注释**：所有新增代码注释使用中文，代码标识符使用英文
4. **DocGraph / ArchitectureIR 均无 Zod Schema 的验证策略**：两者统一采用**方案 B**（MVP 阶段信任写入时的 TypeScript 类型约束，读取时仅检查顶层必填字段存在性）。`graph.json` 自身同样采用方案 B 读取验证（检查 `nodes`、`links`、`graph.generatedAt`、`graph.schemaVersion` 存在性即可）；完整 Zod Schema 作为 Future Work
5. **atomicWrite 复用**：直接复用 `src/utils/atomic-write.ts` 的 `writeAtomicJson`，无需新建写盘工具
6. **batch-orchestrator 注入点**：精确位置为 **L574**（Feature 098 注释处，`buildDocGraph()` 调用之后）；`BatchOrchestratorResult.docGraphPath` 字段（L714）已预留，Feature 101 直接填值
7. **`_meta/` 已在 `.gitignore` 中忽略**：graph.json 不会意外提交，符合本地运行态文件约定

## 验收标准

### AC-101-01：置信度字段向后兼容

- `ArchitectureIRRelationship` 增加 `confidence?: ConfidenceLevel` 和 `confidenceScore?: number` 后，现有不含这两个字段的 JSON 数据可无错反序列化
- `confidence` 字段缺失时不抛出运行时错误，值为 `undefined`

### AC-101-02：置信度映射正确性

- `DocGraphSpecNode.confidence = 'high'` 映射结果为 `'EXTRACTED'`，`confidenceScore >= 0.9`
- `DocGraphSpecNode.confidence = 'medium'` 映射结果为 `'INFERRED'`，`0.5 <= confidenceScore <= 0.8`
- `DocGraphSpecNode.confidence = 'low'` 映射结果为 `'AMBIGUOUS'`，`confidenceScore <= 0.4`
- `CrossReferenceLink.evidenceCount >= 3` 映射结果为 `'EXTRACTED'`
- `CrossReferenceLink.evidenceCount === 1` 映射结果为 `'INFERRED'`（`0.5 <= confidenceScore <= 0.8`）
- `CrossReferenceLink.evidenceCount === 0` 映射结果为 `'AMBIGUOUS'`
- `DocGraphReference.evidenceCount >= 3` 映射结果为 `'EXTRACTED'`（与 CrossReferenceLink 共用 `mapEvidenceConfidence`）

### AC-101-03：图构建输出格式

- `buildKnowledgeGraph()` 返回的 `GraphJSON` 通过以下验证：
  - `directed` 字段存在且为 boolean
  - `nodes` 为数组，每个节点含 `id`、`kind`、`label`、`metadata` 字段
  - `links` 为数组，每条边含 `source`、`target`、`relation`、`confidence`、`confidenceScore` 字段
  - `graph.nodeCount === nodes.length`
  - `graph.edgeCount === links.length`
- Python 端执行 `import networkx as nx; nx.json_graph.node_link_graph(json.load(open('graph.json')))` 无异常抛出

### AC-101-04：节点去重

- 同一 `filePath` 出现在多个数据源时，`nodes` 数组中该路径对应的节点只有一条记录
- 合并后的 `metadata` 包含所有数据源中该节点的非空 metadata 字段

### AC-101-05：graph.json 原子写入

- 调用 `writeKnowledgeGraph()` 后 `{outputDir}/_meta/graph.json` 存在且内容为合法 JSON
- 进程写入中途被 kill（模拟中断）时，不留下部分写入的损坏文件（`.tmp` 机制保证）

### AC-101-06：batch 集成

- 运行 `spectra batch`（完整流程）后，`{outputDir}/_meta/graph.json` 自动生成
- 生成时机：docs-bundle 完成之后，quality report 之前
- `BatchOrchestratorResult.docGraphPath` 字段值为 graph.json 的相对路径

### AC-101-07：容错降级

- `architectureIR` 为 `undefined` 时，`buildKnowledgeGraph()` 不抛出，`graph.json` 仍生成
- `graph.json` 的 `graph.skippedSources` 数组中包含被跳过数据源的名称和原因

### AC-101-08：CLI 命令

- `spectra graph` 命令可独立执行，不依赖完整 batch 流程
- 执行后 `{output-dir}/_meta/graph.json` 生成，退出码为 0
- `spectra graph --directed` 生成的 graph.json 中 `directed === true`
- `spectra graph --help` 输出帮助文本并以退出码 0 退出

### AC-101-09：性能指标

- 5,000 节点 / 10,000 边场景下 `buildKnowledgeGraph()` 执行时间 < 10 秒（单元测试 mock 数据验证）
- 5,000 节点规模的 graph.json 文件大小 < 5 MB
- `spectra graph` 命令从启动到写盘完成 < 3 秒（中型项目 ~200 模块）

## 目录结构

新增文件列表：

```
src/panoramic/graph/
  graph-types.ts              # GraphNode / GraphEdge / GraphJSON / ConfidenceLevel 类型定义
  confidence-mapper.ts        # 置信度映射：mapDocConfidence + mapEvidenceConfidence + CONFIDENCE_SCORES
  graph-builder.ts            # 统一图构建器（buildKnowledgeGraph, writeKnowledgeGraph）
  index.ts                    # 统一导出（re-export graph-types, graph-builder, confidence-mapper）

src/cli/commands/
  graph.ts                    # spectra graph [--directed] 命令 handler（runGraphCommand）

tests/unit/
  confidence-mapper.test.ts   # 置信度映射单元测试（三级映射规则全覆盖）
  graph-builder.test.ts       # 图构建器单元测试（节点去重、容错降级、字段结构验证）

tests/panoramic/
  graph-persistence.test.ts   # 端到端测试：batch → graph.json 自动生成、NetworkX 格式兼容性
```

修改文件列表：

```
src/panoramic/models/architecture-ir-model.ts
  # ArchitectureIRRelationship 新增 confidence?: ConfidenceLevel, confidenceScore?: number

src/batch/batch-orchestrator.ts
  # L574 注入图构建与持久化调用；填充 result.docGraphPath（L714 预留字段）

src/cli/index.ts
  # CLICommand.subcommand 联合类型增加 'graph'
  # parseArgs() 增加 graph 分支
  # switch 增加 case 'graph'
  # HELP_TEXT 增加 graph 子命令说明行
```
