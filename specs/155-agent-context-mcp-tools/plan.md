# Implementation Plan — Feature 155 Agent-Context MCP Tools

**Feature**: 155
**Branch**: 155-agent-context-mcp-tools
**Created**: 2026-05-08
**Status**: Draft
**Spec**: [spec.md](spec.md)

---

## 1. 总体策略

把 spec 的 FR 分组成 6 个交付层，按依赖顺序串行实施；同层任务可并行。整套实施在 **本仓库 src/ + tests/** 内完成，不动 plugins/spec-driver。

```
Layer 1: 基础数据流（query-helpers + GraphData adapter）
   ↓
Layer 2: Tool 实现（agent-context-tools.ts + 3 个 handler）
   ↓
Layer 3: Server 集成（server.ts 注册）
   ↓
Layer 4: Capability probe（baseline collector / eval report 标记）
   ↓
Layer 5: 单测 + 集成测试
   ↓
Layer 6: Acceptance（micrograd baseline 跑一遍 + verification report）
```

---

## 2. 关键架构决策

### D-1：query-helpers 输入类型 = GraphJSON（不是 UnifiedGraph）

**决策**：query-helpers 直接消费 graph.json 反序列化的 `{nodes, links}` 对象。但 `GraphQueryEngine.graph` 字段是 **private**（[src/panoramic/graph/graph-query.ts](src/panoramic/graph/graph-query.ts) L160），不能直接读取。需要给 GraphQueryEngine 添加一个 **public readonly accessor**：

```ts
// src/panoramic/graph/graph-query.ts（修改：仅追加 getter）
export class GraphQueryEngine {
  private graph: GraphJSON;  // 保持 private
  // 新增：
  get rawGraph(): Readonly<GraphJSON> { return this.graph; }
}
```

graph-query.ts **不在** FR-061 禁动清单（FR-061 列的是 unified-graph / call-resolver / adapter / runtime-bootstrap / confidence-mapper / graph-builder / call-site；graph-query.ts 是公开 query 引擎，可扩展接口）。**追加 getter** 不修改既有方法签名，回归风险接近零。

**为什么不维护并行 cache**：
- 维护并行 raw graph cache 与 engineCache 不同步是 D-2 核心痛点
- single source = engineCache.engine.rawGraph，配合 mtime cache key 可解 stale 问题

**替代被否决**：
- ❌ "复用 setCurrentUnifiedGraph 单例" — 仅在 batch 进程内有效，MCP server 是独立进程
- ❌ "buildUnifiedGraph 在 tool handler 里重新构造" — cold-start 几秒甚至几十秒，违反 SC-001
- ❌ "在 graph-tools.ts 维护独立 raw GraphJSON cache" — 双 cache 容易漂移，且增加代码量

### D-2：双层 cache 联动，key = projectRoot + mtime + size

**决策**：解决 engineCache stale 问题。两个 cache 都加 mtime 一致性检查：

1. **graph-tools.ts engineCache 升级**（**必须**）：
   - 当前 `engineCache: Map<projectRoot, GraphQueryEngine>`，无 mtime 校验，graph.json 重生后 cache 仍返回旧 engine
   - 升级为 `engineCache: Map<projectRoot, { engine: GraphQueryEngine, graphPath: string, mtimeMs: number, sizeBytes: number }>`
   - `getEngine(projectRoot)` 内部：先 stat graph.json，比对 cache 中的 mtimeMs + sizeBytes；不一致 → reload；一致 → 复用
   - `reloadGraph()` 仍可手动调用（强制 evict 所有 entry）
   
2. **query-helpers reverse-adj cache**：
   - cache key = `${graphPath}::${mtimeMs}::${linksLength}`（mtime 变化或 link 数变化都失效）
   - LRU ≤ 8 entries
   - mtime 分辨率秒级 race（修改文件但 mtime 没变） → 用 sizeBytes 兜底；同 mtime + 同 size + 同 linksLength 三者同时巧合的概率极低（graph.json 是 LLM 输出，几乎不会出现）

3. **联动**：query-helpers 在拿到 GraphQueryEngine 后通过 `engine.rawGraph + graphPath + mtimeMs` 构建 reverse-adj cache key；engine 重 load 时新 mtime 自动让 query cache 失效

**为什么 mtime + size 复合 key**：
- 仅 mtime → 1 秒内连续修改可能漏掉
- 仅 size → 替换边但 size 不变（罕见但可能）会漏
- 两者结合 + linksLength（query 端）= 三层校验，足够强
- 不引入 contentHash（避免每次 BFS 都 SHA256 文件，性能不可接受）

### D-3：MCP tool 注册位置 = registerGraphTools 之后

**决策**：在 [src/mcp/server.ts](src/mcp/server.ts) 末尾追加 `registerAgentContextTools(server)` 调用，紧跟 `registerGraphTools` 之后。不修改前序逻辑。

**为什么**：
- Feature 152/153/154（adapter 改动）与 server.ts 物理隔离
- append-only 改动 git diff 干净，rebase 不冲突

### D-4：detect_changes 第一版 file-level，hunk 留 155b

**决策**：FR-031~035 规定按 file-level 把 changedFile 映射到 graph 中所有 `${file}::*` symbol 节点，全部进入 `changedSymbols.symbols`。

**为什么**：
- hunk-level 行号映射需要 graph 节点保存精确 lineRange，Feature 151 schema 中节点 metadata 不强制保存（依语言 adapter）
- file-level 已能让 affectedSymbols 准确（impact 链由 BFS 派生，无效 symbol 在反向邻接表里没有上游 caller）
- 控制本 Feature 复杂度（避免触动 schema）

### D-5：confidence 数值映射 = 复用 `CONFIDENCE_SCORES`

**决策**：query-helpers **不**重定义 high/medium/low → 0.95/0.65/0.25 数字常量；直接读取 graph.json 中已有的 `confidenceScore: number` 字段（serialization 阶段由 graph-builder.ts 已写入）。

**为什么**：
- Single source of truth：[src/panoramic/graph/confidence-mapper.ts](src/panoramic/graph/confidence-mapper.ts) L15-19
- 避免数值漂移；如果未来调整 0.65 → 0.7，自动跟随
- 减少 query-helpers 公开 API 表面

### D-6：context.relatedSpec 路径派生 = 3 候选优先级 + filesystem 探测

**决策**：
1. 取 module 部分 → slug = basename(module, ext)
2. 候选路径优先级（首个存在的胜出）：
   - `<projectRoot>/panoramic/modules/<slug>.spec.md`
   - `<projectRoot>/specs/products/spectra/_generated/modules/<slug>.spec.md`
   - `<projectRoot>/_meta/modules/<slug>.spec.md`
3. 都不存在 → `{kind:'unknown'}`

**为什么**：
- 不需要 manifest（避免依赖 batch-orchestrator 改动）
- panoramic / spectra-product / _meta 三种布局在仓库实际出现过，覆盖 ≥ 90% 真实场景
- 不存在 spec 时 silent fallback 给 unknown，不抛错（agent 可以继续工作）

### D-7：detect_changes baseRef 安全 = whitelist + rev-parse

**决策**：
1. baseRef 输入先按正则 `^[A-Za-z0-9_./~^@-]+$` 白名单过滤
2. spawnSync `git rev-parse --verify ${ref}^{commit}`，校验解析为 commit
3. 用解析后的 SHA（不是用户原始字符串）做后续 `git diff`
4. spawn 强制 `shell: false` + 30s timeout

**为什么**：
- 防止 shell injection、path traversal、ref name 注入
- 把"用户原始字符串"和"git 实际操作的 sha"分离，降低误用 risk

---

## 3. 文件实施清单

### 新增文件（7 个）

| 路径 | 用途 | 估计行数 |
|------|------|---------|
| `src/knowledge-graph/query-helpers.ts` | BFS / canonicalize / fuzzy / reverse-adj | ~280 |
| `src/mcp/agent-context-tools.ts` | 3 tool 注册 + handler 实现 | ~400 |
| `tests/unit/knowledge-graph/query-helpers.test.ts` | ≥ 12 case | ~280 |
| `tests/unit/mcp/agent-context-tools.test.ts` | ≥ 18 case | ~500 |
| `tests/integration/agent-context-real-graph.test.ts` | ≥ 2 case，micrograd graph | ~150 |
| `tests/fixtures/git-diffs/value-add-modify.diff` | 手工构造 unified diff | ~30 |
| `tests/fixtures/graph-fixtures/synthetic-budget.json` | budget 截断 fixture（5 nodes, 4 edges） | ~50 |

### 修改文件（5 个，含一些 append-only）

| 路径 | 修改 | 风险 |
|------|------|------|
| `src/panoramic/graph/graph-query.ts` | **追加** `get rawGraph(): Readonly<GraphJSON>` getter（D-1） | 低（仅追加 getter，不改既有方法） |
| `src/mcp/graph-tools.ts` | engineCache 升级（mtime/size 校验，D-2） + 暴露 `getCachedGraphData` helper | 中（修改 lazy load 内部逻辑，需现有 6 个 tool 单测全 pass 回归保护） |
| `src/mcp/server.ts` | append `registerAgentContextTools(server)` 调用 | 低（diff 仅 1-2 行） |
| `tests/unit/mcp-server.test.ts` | tool name list 从 11 → 14（impact/context/detect_changes） | 低（exact-list 测试需要更新） |
| `scripts/eval-report.mjs` | capability probe（FR-060） | 中（具体行为见 plan §4.4） |

### 严禁修改（FR-061 合同区）

- `src/knowledge-graph/unified-graph.ts`
- `src/knowledge-graph/call-resolver.ts`
- `src/adapter/**/*`
- `src/runtime-bootstrap.ts`
- `src/panoramic/graph/confidence-mapper.ts`
- `src/panoramic/graph/graph-builder.ts`
- `src/models/call-site.ts`

---

## 4. 详细模块设计

### 4.1 src/knowledge-graph/query-helpers.ts

```ts
// 公开 API
export interface BfsTraverseOptions {
  depth: number;                // 1..5
  minConfidence: number;        // default 0.65
  direction: 'upstream' | 'downstream' | 'both';
  budget: number;               // default 200, max 1000
  sharedVisited?: Set<string>;  // detect_changes 多 changedSymbol 共享
  graphPath: string;            // cache key 一部分
  graphMtimeMs: number;         // cache key 一部分（强制传，避免 cache stale）
  graphSizeBytes: number;       // cache key 一部分
  relations?: Array<'calls' | 'depends-on' | 'cross-module'>;  // default ['calls']：BFS 仅走调用边
}

export interface BfsTraverseResult {
  affected: Array<{
    id: string;
    depth: number;
    confidence: number;       // 直接来自 edge.confidenceScore
    reason: string;           // display: "called via X -> Y"
    path: string[];           // ancestor 链（含 self）
  }>;
  warnings: string[];          // budget-truncated / depth-clamped / confidence-filtered-all
}

export function bfsTraverse(
  graphData: GraphData,
  startId: string,
  options: BfsTraverseOptions,
): BfsTraverseResult;

export function canonicalizeSymbolId(
  target: string,
  graphData: GraphData,
  options: { projectRoot?: string },
): { canonicalId: string | null; suggestion?: string };

export function findFuzzyMatches(
  graphData: GraphData,
  queryId: string,
  limit: number,
): string[];

export function computeRiskTier(
  directCallers: number,
  transitive: number,
): 'low' | 'medium' | 'high';

// 反向邻接表 lazy + cache
export function getReverseAdjacency(
  graphData: GraphData,
  graphPath: string,
  mtimeMs: number,
  sizeBytes: number,
  relations?: Array<'calls' | 'depends-on' | 'cross-module'>,  // default ['calls']
): ReverseAdj;

// 私有
type ReverseAdj = Map<string, Array<{ sourceId: string; edge: GraphEdge }>>;
const adjCache = new Map<string, ReverseAdj>();  // LRU 8，key = `${graphPath}::${mtimeMs}::${sizeBytes}::${linksLength}::${relations.join(',')}`
```

### 4.2 src/mcp/agent-context-tools.ts

```ts
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCachedGraphData, resolveGraphJsonPath } from './graph-tools.js';
import * as Q from '../knowledge-graph/query-helpers.js';

export function registerAgentContextTools(server: McpServer): void {
  server.tool(
    'impact',
    '查询 symbol 改动的 blast radius — 反向 BFS 遍历调用链。',
    {
      target: z.string().describe('symbol id (e.g. "micrograd/engine.py::Value.__add__")'),
      depth: z.number().int().min(0).max(5).optional().describe('BFS 深度 (default 2, max 5)'),
      minConfidence: z.number().min(0).max(1).optional().describe('confidence 阈值 (default 0.65)'),
      direction: z.enum(['upstream', 'downstream', 'both']).optional().describe('default upstream'),
      budget: z.number().int().min(0).max(1000).optional().describe('节点上限 (default 200)'),
      projectRoot: z.string().optional().describe('default cwd'),
    },
    async (args) => handleImpact(args),
  );

  server.tool(
    'context',
    '查询 symbol 360° 上下文 — definition + callers + callees + imports + relatedSpec。',
    {
      symbolId: z.string(),
      include: z.array(z.enum(['callers','callees','imports','related-spec'])).optional(),
      projectRoot: z.string().optional(),
    },
    async (args) => handleContext(args),
  );

  server.tool(
    'detect_changes',
    '从 git diff 派生 changedSymbols + impact 链 + risk 总结。',
    {
      diff: z.string().optional(),
      baseRef: z.string().optional(),
      projectRoot: z.string().optional(),
      depth: z.number().int().min(0).max(5).optional(),
      budget: z.number().int().min(0).max(1000).optional(),
      minConfidence: z.number().min(0).max(1).optional(),
    },
    async (args) => handleDetectChanges(args),
  );
}

// 私有 handler 实现 + buildErrorResponse + parseDiff + spawnGitDiff
```

### 4.3 src/mcp/graph-tools.ts 扩展（升级 engineCache + 暴露 helper）

**两步改动**（D-2 必须落地）：

```ts
// 第一步：engineCache 升级为 entry-based（含 mtime / size 校验）
interface CachedEngine {
  engine: GraphQueryEngine;
  graphPath: string;
  mtimeMs: number;
  sizeBytes: number;
}
const engineCache = new Map<string, CachedEngine>();

function getEngine(projectRoot?: string): GraphQueryEngine {
  const root = projectRoot ?? process.cwd();
  const graphPath = resolveGraphJsonPath(root);
  const stat = fs.statSync(graphPath);  // 同步即可，反正 lazy load 是首次访问
  const cached = engineCache.get(root);
  if (cached
      && cached.graphPath === graphPath
      && cached.mtimeMs === stat.mtimeMs
      && cached.sizeBytes === stat.size) {
    return cached.engine;  // hot path 复用
  }
  // miss / stale → reload
  const engine = GraphQueryEngine.loadFromFile(graphPath);
  engineCache.set(root, { engine, graphPath, mtimeMs: stat.mtimeMs, sizeBytes: stat.size });
  return engine;
}

// 第二步：暴露 raw graph + 元数据，供 query-helpers 用
export function getCachedGraphData(projectRoot: string): {
  graphData: GraphJSON;       // 来自 engine.rawGraph getter（D-1 新增）
  graphPath: string;
  mtimeMs: number;
  sizeBytes: number;
} | null {
  try {
    const root = projectRoot ?? process.cwd();
    const graphPath = resolveGraphJsonPath(root);
    if (!fs.existsSync(graphPath)) return null;
    const stat = fs.statSync(graphPath);
    const engine = getEngine(root);  // 自动 stale check
    return { graphData: engine.rawGraph, graphPath, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
  } catch {
    return null;
  }
}

// reloadGraph() 不变（仍可手动 evict 全部）
```

**回归测试**：现有 graph_query / graph_path 等 6 tool 单测必须全 pass（验证 engineCache 升级不破坏既有行为）。新增 stale-detection 单测：模拟 mtime 变化 → getEngine 返回新 engine。

### 4.4 capability probe（FR-060 落点）

**已锁定**：[scripts/eval-report.mjs](scripts/eval-report.mjs)（package.json L`eval:report` → `node scripts/eval-report.mjs`）。

**实现策略**：
- 在 eval-report.mjs 输出报告前，spawn 一个 MCP server 子进程（或读取 server 的 tool registry export），列出已注册的 tool name；如果含 `impact / context / detect_changes` 三者 → 在报告 capability section 输出 "Agent-Context tools available"
- 备选轻量方案：直接 import `src/mcp/server.ts` 的 `createServer()` factory（如果已暴露 tool list 接口），不 spawn 子进程
- 单测扩展：[tests/unit/eval-report.test.ts](tests/unit/eval-report.test.ts)（如已存在）添加 case 验证标记字符串

---

## 5. 风险登记

| ID | 风险 | 概率 | 影响 | 缓解 |
|----|------|------|------|------|
| R-1 | micrograd graph.json 当前不含 calls 边（baseline 旧） | 高 | SC-001/002b/004 跑不通 | 实施第一步先 `npm run baseline:collect -- --target karpathy/micrograd --mode full` 重生 |
| R-2 | confidenceScore 字段在某些 cross-module 边可能缺失 | 中 | BFS 过滤错误 | query-helpers 处理 undefined：先尝试 `edge.confidence` 通过 [src/panoramic/graph/confidence-mapper.ts](src/panoramic/graph/confidence-mapper.ts) 的 `CONFIDENCE_SCORES` 映射；映射也失败 → 该边视为 minConfidence 不足而**跳过**（不静默通过），warnings 含 `'missing-confidence-score'` 列出条数 |
| R-3 | LLM agent 传入 symbol id 含变体大小写 | 中 | symbol-not-found 误报 | canonicalize 比较时 file 部分大小写敏感（与 graph 一致），symbol 部分按字面相等 |
| R-4 | `engineCache` 与 query-helpers cache 不同步（reloadGraph 后） | 低 | stale data | 用 mtime + edgeCount 复合 key 自动检测；测试覆盖 reload 场景 |
| R-5 | git spawn 在 Windows 下行为不一致 | 低 | tool 失败 | spawnSync + shell:false 在跨平台行为一致；测试在 macOS / Linux 双跑 |
| R-6 | payload-truncated 1MB 上限误伤大型仓库正常请求 | 低 | UX 折损 | warning 提示用户降 budget 或限制 include；不强制错误 |

---

## 6. 实施顺序与里程碑

### 里程碑 M1（Layer 1+2）：核心实现 ~ 5 天
- [x] D-1 ~ D-7 决策定稿（已在本 plan 完成）
- [ ] T-001 query-helpers 类型 + bfsTraverse + canonicalizeSymbolId + getReverseAdjacency + fuzzyMatches + computeRiskTier
- [ ] T-002 graph-tools.ts 扩展 getCachedGraphData
- [ ] T-003 agent-context-tools.ts 完整实现（3 handler + buildErrorResponse + parseDiff + spawnGitDiff）

### 里程碑 M2（Layer 3+4）：集成 ~ 1 天
- [ ] T-004 server.ts 注册调用
- [ ] T-005 capability probe（FR-060 落点）

### 里程碑 M3（Layer 5）：测试 ~ 4 天
- [ ] T-006 query-helpers.test.ts ≥ 8 case
- [ ] T-007 agent-context-tools.test.ts ≥ 12 case
- [ ] T-008 agent-context-real-graph.test.ts ≥ 2 case
- [ ] T-009 fixtures：synthetic-budget.json + value-add-modify.diff

### 里程碑 M4（Layer 6）：Acceptance ~ 2 天
- [ ] T-010 重生 micrograd graph.json（含 calls 边）
- [ ] T-011 跑 SC-001 ~ SC-008 全部验收
- [ ] T-012 verification-report.md
- [ ] T-013 Codex round-3 review on implementation
- [ ] T-014 deliverable report → 用户确认 push

总估计：~12 工作日（用户预估 3-4 周，本 plan 预估更紧凑因为 spec 已成熟、合同区清晰）。

---

## 7. 验证策略

### 7.1 单测（mock-driven，CI 友好）

- `query-helpers.test.ts`：合成 fixture graph，覆盖 budget 截断 / depth clamp / canonicalize 容错 / fuzzy / reverse-adj cache 失效 / direction 三态
- `agent-context-tools.test.ts`：mock `getCachedGraphData`、`spawnSync`，覆盖 3 tool 成功路径 + 全部 error code（11 个） + edge cases

### 7.2 集成测试（真实 graph）

- `agent-context-real-graph.test.ts`：
  - case 1: 加载 `~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json`（重生后），调 impact + context，验证 GraphJSON 字段名（links 不是 edges）与契约一致
  - case 2: 用 fixture diff 调 detect_changes，验证 changedSymbols + affectedSymbols 非空

### 7.3 Acceptance（spec SC-001 ~ SC-008）

完整 invoke 真实 MCP server（spawn `npm run mcp:start` 或类似入口），通过 stdio 协议发送 tool call，断言响应。可放在 `tests/integration/mcp-stdio-end-to-end.test.ts` 或单独 `verification/acceptance-runner.mjs` 脚本。

### 7.4 工具链验证

- `npx vitest run` 100% pass
- `npm run build` 0 type error
- `npm run lint` 0 fail
- `npm run repo:check` 0 fail
- `npm run release:check`（如果改动 package metadata，本 Feature 不改）
- SC-008：`git diff --name-only master...HEAD | grep -E '<合同区清单>'` 返回空

---

## 8. 与 spec.md 字段映射

| spec FR | plan 任务 | 验证 |
|---------|---------|------|
| FR-001 ~ FR-004 | T-003 + T-004 | T-007 mcp-server registration test |
| FR-010 ~ FR-015 | T-001 (BFS) + T-003 (handler) | T-006 BFS unit + T-007 handler unit + SC-001/002a |
| FR-020 ~ FR-024 | T-001 (canonicalize) + T-003 (handler) | T-006 + T-007 + SC-003 |
| FR-030 ~ FR-035 | T-001 (parser helpers) + T-003 (handler) | T-006 + T-007 + SC-004 |
| FR-040 ~ FR-041 | T-001 完整 | T-006 全覆盖 |
| FR-050 ~ FR-053 | T-003 buildErrorResponse | T-007 各 error code 单测 |
| FR-060 ~ FR-061 | T-005 + SC-008 自动校验 | verification-report 含 capability probe + diff 校验 |

---

## 9. 提交策略

按里程碑切分 commit，每个 commit 完成后跑 `npx vitest run` + `npm run build` + Codex 审查：

1. `feat(155): T-001 query-helpers 核心实现 + 单测`
2. `feat(155): T-002 graph-tools.ts 暴露 getCachedGraphData helper`
3. `feat(155): T-003 agent-context-tools 3 handler 实现`
4. `feat(155): T-004+T-005 server 注册 + capability probe`
5. `feat(155): T-006~T-009 完整测试套件 + fixtures`
6. `chore(155): T-010 重生 micrograd baseline graph.json`
7. `feat(155): T-011~T-012 acceptance + verification report`

每个 commit 之前按 CLAUDE.local.md 跑 codex 对抗审查；最终 push 前列 deliverable report 等用户确认。
