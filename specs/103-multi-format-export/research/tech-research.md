# 技术调研报告：Feature 103 multi-format-export

**模式**: codebase-scan
**日期**: 2026-04-12
**扫描范围**: Feature 101/102 接口 + Graphify 模式 + CLI 注册 + 测试规范 + 项目约束

---

## 1. Feature 101 graph.json 接口

### 核心类型（`src/panoramic/graph/graph-types.ts`）

```typescript
export type ConfidenceLevel = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

export interface GraphNode {
  id: string;
  kind: 'module' | 'package' | 'component' | 'spec' | 'document';
  label: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  confidence: ConfidenceLevel;
  confidenceScore: number;  // [0.0, 1.0]
}

export interface GraphJSON {
  directed: boolean;
  multigraph: false;
  graph: {
    name: 'spectra-knowledge-graph';
    generatedAt: string;
    nodeCount: number;
    edgeCount: number;
    sources: ('architecture-ir' | 'doc-graph' | 'cross-reference')[];
    skippedSources?: Array<{ source: string; reason: string }>;
    inputHash?: string;
    schemaVersion: '1.0';
  };
  nodes: GraphNode[];
  links: GraphEdge[];  // 注意：键名是 links 不是 edges
}
```

### 构建与写盘

```typescript
export function buildKnowledgeGraph(options: BuildGraphOptions): GraphJSON
export function writeKnowledgeGraph(graphJson: GraphJSON, outputDir: string): string
```

---

## 2. Feature 102 community-analysis 接口

### 核心类型

```typescript
export interface CommunityInfo {
  id: number;
  nodes: string[];
  coreNodes: string[];  // Top 3 节点 ID
  cohesion: number;
}

export interface CommunityResult {
  communities: CommunityInfo[];
  nodeCommunityMap: Map<string, number>;
}

export interface GodNode {
  id: string;
  label: string;
  degree: number;
  primaryRelation: string;
  communityId: number;
}

export interface SurprisingEdge {
  source: string;
  target: string;
  relation: string;
  confidence: string;
  crossCommunity: boolean;
  score: number;
}
```

### 分析管道入口

```typescript
export function runCommunityAnalysis(
  graphJson: GraphJSON,
  outputDir: string,
  options?: CommunityAnalysisOptions
): string
```

**注意**: `nodeCommunityMap` 不持久化，export 命令需调用 `detectCommunities()` 重建。

---

## 3. Graphify 架构设计模式

### 3.1 纯函数管道模式
Feature 102 完全复现 Graphify 的纯函数数据流。Feature 103 应遵循同样模式：
- `generateObsidianVault(graphJson, communityResult, godNodes, outputDir): ExportResult`
- `generateHtml(graphJson, communityResult, godNodes): string`

### 3.2 悬空边静默跳过
数据完整性采用 graceful skip 而非 throw 策略。

### 3.3 God Node 过滤策略
度数 > 均值 + 2σ，排除 `kind: 'package'` 和纯 `contains` 关系节点。

### 3.4 内聚度公式
`cohesion = Math.round((internalEdges / maxPossible) * 1000) / 1000`

### 3.5 Markdown 渲染模式
字符串数组 + `join('\n')` 拼接，中文散文 + 英文节点名混排。

---

## 4. CLI 命令注册模式

### 改动点

1. **`src/cli/utils/parse-args.ts`**: 新增 `exportFormat` 字段（避免与现有 `format` 冲突）
2. **`src/cli/index.ts`**: HELP_TEXT + switch case 新增 `export`
3. **新建 `src/cli/commands/export.ts`**: 遵循 graph.ts / community.ts 模式

### CLI 风格建议
现有命令统一使用 `--output-dir`，建议 Feature 103 也统一为 `--output-dir`（prompt 写的是 `--output`）。

---

## 5. 可复用模块清单

| 模块 | 路径 | 用途 |
|------|------|------|
| GraphJSON 类型 | `src/panoramic/graph/graph-types.ts` | 直接 import |
| CommunityInfo / GodNode 类型 | `src/panoramic/community/index.ts` | 直接 import |
| loadGraph + detectCommunities | `src/panoramic/community/community-detector.ts` | 重建社区数据 |
| findGodNodes | `src/panoramic/community/god-node-analyzer.ts` | 获取 God Node |
| writeAtomicJson | `src/utils/atomic-write.ts` | 文件写入 |
| generateReport 模式 | `src/panoramic/community/graph-report-generator.ts` | Markdown 渲染参考 |

---

## 6. 技术约束

- TypeScript strict + `noUncheckedIndexedAccess: true`
- `module: "NodeNext"` — import 带 `.js` 后缀
- d3-force 内联字符串嵌入，不作为 npm 运行时依赖
- Obsidian 文件名不含 `/ \ : * ? " < > |`，长度 < 200
- 双向链接格式 `[[filename]]`，不含路径前缀
- 现有 Feature 101/102 未使用 Zod，可延续轻量验证模式

---

## 7. 技术风险

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|---------|
| d3 内联字符串维护成本高 | 中 | 低 | html-template.ts 顶部注释 d3 版本号 |
| 大图 HTML 渲染卡顿 | 中 | 中 | >5000 节点跳过仿真用网格布局 |
| 节点 ID 含路径分隔符 | 高 | 中 | sanitizeFilename() 替换所有 `/` |
| nodeCommunityMap 不持久化 | 低 | 低 | export 内重建 |
| sourceTarget 仅 spec 节点有 | 低 | 低 | 条件判断 |
