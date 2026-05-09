---
feature_id: "156"
plan_version: "1.2"
status: "draft"
created: "2026-05-09"
---

# Feature 156 — Plan：Spectra Incremental Indexing + DependencyGraph T-014 Shim

## Revision Log

| 版本 | 日期 | 内容 |
|------|------|------|
| 1.0 | 2026-05-09 | 初版，基于 spec.md v3 + clarify.md + research/tech-research.md 生成 |
| 1.1 | 2026-05-09 | 吸收 Codex 第一轮 plan review 3 CRITICAL + 4 WARNING：CRITICAL-1 新增 W1.0 import-resolver.ts + 修正 FR-28 接管路径；CRITICAL-2 补充 mergeIncremental 端点→owning file 反查算法；CRITICAL-3 补充 isCircular/importType 语义派生；WARN-1 修正 FileWatcher batch 回调签名；WARN-2 补充边比较 canonical sort；WARN-3 补充 snapshot 原子写入多进程 tradeoff；WARN-4 修正 W1 出口 grep 命令排除注释。 |
| 1.2 | 2026-05-09 | 吸收 Codex 第二轮 review CRIT-3 PARTIAL：§2.5 补充 detectImportType syntax kind → importType 4 类映射规则（基于 ts-morph 节点判断）；§2.6 明确 detectSCCs 直接复用既有 Tarjan 实现（src/graph/topological-sort.ts:32），补充 SCC → isCircular 边反查完整逻辑。 |

---

## 1. 架构总览

### 1.1 模块拓扑（新增 / 修改 / 删除）

```
src/
├── core/
│   └── import-resolver.ts        [new] W1.0：resolveTsJsImport；被 ast-analyzer / tree-sitter-fallback 调用
├── knowledge-graph/
│   ├── unified-graph.ts          [edit] 仅更新注释（trivial）
│   ├── index.ts                  [no-change] buildUnifiedGraph 接口冻结
│   ├── persistence.ts            [new] SnapshotWrapper Zod schema + save/load
│   └── incremental.ts            [new] gitDiff / expandCallers / mergeIncremental
├── cli/commands/
│   └── index.ts                  [new] spectra index 子命令（full / --watch / --incremental）
├── batch/
│   ├── batch-orchestrator.ts     [edit] rewrite：buildGraph → buildUnifiedGraph 派生路径
│   ├── delta-regenerator.ts      [edit] shape-map：DependencyGraph → UnifiedGraph 字段映射
│   └── module-grouper.ts         [edit] shape-map：遍历 UnifiedGraph depends-on 边
├── graph/
│   ├── dependency-graph.ts       [edit → delete] rewrite 后删除
│   ├── directory-graph.ts        [edit] rewrite：改为从 UnifiedGraph depends-on 边派生兼容视图
│   ├── topological-sort.ts       [edit] shape-map：入参改为 UnifiedGraph 子图结构
│   ├── mermaid-renderer.ts       [edit] shape-map：入参改为 UnifiedGraph
│   └── legacy-shim.ts            [new → delete] 私有 helper，atomic switch 后删除
├── adapters/
│   ├── ts-js-adapter.ts          [edit] rewrite：委托 buildUnifiedGraph
│   ├── python-adapter.ts         [edit] rewrite：输出改为 UnifiedGraph 派生
│   ├── language-adapter.ts       [edit] shape-map：接口签名更新
│   └── index.ts                  [edit] trivial：re-export 类型更新
├── panoramic/builders/
│   └── doc-graph-builder.ts      [edit] shape-map：入参改为 UnifiedGraph
├── panoramic/generators/
│   └── cross-package-analyzer.ts [edit] shape-map：包级图改为 UnifiedGraph 子图
├── generator/
│   └── index-generator.ts        [edit] shape-map：inDegree 从 UnifiedGraph 邻接表派生
├── cli/commands/
│   └── graph.ts                  [edit] trivial：清理残余 import
└── models/
    └── dependency-graph.ts       [delete] shim 完成后删除

plugins/spectra/hooks/
└── post-commit.sh                [new] 可选 git hook（MAY）

tests/unit/knowledge-graph/
├── persistence.test.ts           [new] 4 个单测
├── incremental.test.ts           [new] 4 个单测
└── consumer-shim.test.ts         [new] ≥ 3 个单测

scripts/
└── verify-feature-156.mjs        [new] full vs incremental 对比验证脚本

.gitignore                        [edit] 加入 .spectra/
```

### 1.2 数据流：incremental 路径

```
触发源（两种）
  ├─ post-commit hook → git diff --name-only ORIG_HEAD HEAD
  └─ --watch 模式   → FileWatcher FileChangeEvent[].path（批量事件）

                    ↓ changedFiles: Set<string>（绝对路径）

[persistence.ts] load(.spectra/unified-graph.json)
  ├─ safeParse SnapshotWrapperSchema
  ├─ 失败 → 降级为 full re-index（记录原因至 stdout）
  └─ 成功 → SnapshotWrapper（含 graph + fileHashes）

                    ↓ snapshot

[incremental.ts] expandCallers(changedFiles, snapshot, depth=1)
  └─ 从 snapshot.graph.edges（calls + depends-on，directional=true）
     反查所有 source = changedFiles 中文件的 target 边，
     以及所有 target = changedFiles 中文件的 source 节点（reverse lookup）
     → expandedSet: Set<string>（changed + direct callers）

[ts-extractor / python-extractor] 增量 AST 解析
  └─ 仅对 expandedSet 中的文件调用 CodeSkeleton 提取

[buildUnifiedGraph] 局部图构建
  └─ input.codeSkeletons = expandedSet 对应的 CodeSkeleton Map

[incremental.ts] mergeIncremental(oldSnapshot, expandedSet, newPartialGraph)
  ├─ 删除 snapshot.graph.nodes 中 filePath ∈ expandedSet 的节点（节点 id 为 file::symbol 格式）
  ├─ 删除 snapshot.graph.edges 中 owning nodes id 集合涉及的边
  ├─ 合并 newPartialGraph.nodes + newPartialGraph.edges
  └─ updateFileHashes(snapshot, expandedSet)

[persistence.ts] save(mergedSnapshot, projectRoot)
  └─ 原子写入 .spectra/unified-graph.json（临时文件 + rename）
```

### 1.3 数据流：full 路径（spectra index 无 --watch / --incremental）

```
spectra index（全量）

[全量文件扫描] → CodeSkeleton Map（所有文件）

[buildUnifiedGraph] → UnifiedGraph（全量）

[persistence.ts] 构建 SnapshotWrapper
  ├─ schemaVersion: '1.0'
  ├─ generatedAt: ISO 8601
  ├─ graph: UnifiedGraph（完整，含 symbol 节点，不裁剪）
  └─ fileHashes: 所有文件 SHA-256 hex digest

[persistence.ts] save(snapshot, projectRoot)
  └─ 原子写入 .spectra/unified-graph.json

stdout: { changedFiles: N, duration: X ms, mode: 'full' }（AC-4 机器可读 JSON）
exit 0
```

---

## 2. 关键模块设计

### 2.1 SnapshotWrapper schema（`src/knowledge-graph/persistence.ts`）

**Zod schema**（接口签名，非代码）：

```
SnapshotWrapperSchema = z.object({
  schemaVersion: z.literal('1.0'),
  generatedAt: z.string().datetime(),
  graph: UnifiedGraphSchema,                         // 内嵌完整 UnifiedGraph
  fileHashes: z.record(z.string(), z.string()),      // 绝对路径 → SHA-256 hex
})
type SnapshotWrapper = z.infer<typeof SnapshotWrapperSchema>
```

**函数接口**：

```
// 原子写入：先写 .spectra/unified-graph.{pid}.tmp，成功后 rename
// 多进程并发场景：后写者覆盖前者（最后写者胜），不会损坏 snapshot
// 显式 tradeoff：放弃强一致性（多进程同跑"最后写者胜"），但避免锁文件死锁
save(snapshot: SnapshotWrapper, projectRoot: string): Promise<void>

// 读取并 safeParse；校验失败或文件不存在返回 null（让调用方触发 full rebuild）
load(projectRoot: string): Promise<SnapshotWrapper | null>

// 对比文件当前 SHA-256 与 snapshot 中记录的 hash；返回 stale 文件集合
detectStale(snapshot: SnapshotWrapper, files: string[]): Set<string>

// 为给定文件集合计算当前 SHA-256 hash
computeFileHashes(files: string[]): Promise<Record<string, string>>
```

**多进程原子写入实现**（WARN-3 关闭）：

```typescript
// 使用唯一 tmp 名（含 pid）+ rename 保证原子性
// 多进程同跑时后写者覆盖前者，但 rename 是原子操作不会产生损坏文件
const tmpPath = path.join(spectraDir, `unified-graph.${process.pid}.tmp`);
await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8');
await fs.rename(tmpPath, path.join(spectraDir, 'unified-graph.json'));
// NOTE：并发多进程下放弃强一致性（最后写者胜），可接受，snapshot 损坏风险为零
```

**corruption 降级路径**：
- JSON 解析失败 → `load()` 捕获异常，返回 null，stdout 记录 `{ fallbackReason: 'json-parse-error' }`
- `SnapshotWrapperSchema.safeParse` 失败 → 同上，记录 `{ fallbackReason: 'schema-validation-failed' }`
- `schemaVersion` 不匹配（EC-3）→ schema 校验时 `z.literal('1.0')` 直接失败，触发 null 路径
- 文件不存在 → `load()` 检测，返回 null，触发 full re-index

**写盘格式决议**（OQ-5 / clarify Q1）：**pretty JSON**（`JSON.stringify(snapshot, null, 2)`）。理由：1 MB JSON 在 Node.js 中 parse/stringify < 50 ms，远低于 30 秒门槛；调试和 code review 友好；无需引入 gzip 复杂度。

**symbol 节点裁剪决议**（OQ-1 / clarify Q2）：**不裁剪**。snapshot 保留完整 UnifiedGraph（含 symbol 节点），确保 caller expansion 可精确到 symbol 粒度，AC-3a/3b 中 `calls` 边 diff 验证可正确执行。

### 2.2 incremental.ts（`src/knowledge-graph/incremental.ts`）

**函数接口**：

```typescript
// 从 git 获取变更文件（绝对路径集合）
// hook 上下文：git diff --name-only ORIG_HEAD HEAD
// 失败（shallow clone EC-10）→ 降级返回空集合，由调用方触发全量 hash stale 检测
gitDiff(projectRoot: string, context: 'post-commit' | 'watch'): string[]

// 从 snapshot 边中反查深度 1 的 reverse callers
// 遍历 snapshot.graph.edges：找出 target ∈ changedFiles 的所有 source 节点
// 返回 changed + callers 的并集
expandCallers(
  changedFiles: Set<string>,
  snapshot: SnapshotWrapper,
  depth: number,  // 当前固定为 1，--caller-depth flag 预留接口
): Set<string>

// 将新的局部图合并回完整 snapshot
// 操作：删除 expandedSet 涉及节点和边 → 插入 newPartialGraph 的节点和边 → 更新 fileHashes
mergeIncremental(
  oldSnapshot: SnapshotWrapper,
  expandedSet: Set<string>,
  newPartialGraph: UnifiedGraph,
): SnapshotWrapper

// 对外主入口：协调 load → expand → partial build → merge → save
buildIncremental(
  projectRoot: string,
  options: {
    changedFiles?: string[],   // 不传则从 gitDiff 获取
    callerDepth?: number,      // 默认 1
    timeout?: number,          // 默认 60000 ms（EC-1 超时降级）
  }
): Promise<{ mode: 'incremental' | 'full-fallback', changedFiles: number, duration: number }>
```

**mergeIncremental 核心算法**（CRITICAL-2 关闭）：

UnifiedGraph 的节点 id 格式为 `file::symbol`（symbol 级）或 `file`（module 级），不能直接用文件路径匹配边。必须通过 `node.filePath` 字段反查：

```typescript
// 步骤 1：从 changed files 集合 → 反查 owning nodes（按 node.filePath 字段）
function findOwningNodes(snapshot: SnapshotWrapper, changedFiles: Set<string>) {
  return snapshot.graph.nodes.filter(n => changedFiles.has(n.filePath));
}

// 步骤 2：从 owning nodes id → 反查 edges（含 symbol 级 calls 边）
function findEdgesByFile(snapshot: SnapshotWrapper, changedFiles: Set<string>) {
  const owningNodes = findOwningNodes(snapshot, changedFiles);
  const owningIds = new Set(owningNodes.map(n => n.id));
  return snapshot.graph.edges.filter(
    e => owningIds.has(e.source) || owningIds.has(e.target)
  );
}

// 步骤 3：mergeIncremental 删除旧 nodes + edges，再插入新局部图
function mergeIncremental(
  oldSnapshot: SnapshotWrapper,
  expandedSet: Set<string>,
  newPartialGraph: UnifiedGraph,
): SnapshotWrapper {
  const owningNodes = findOwningNodes(oldSnapshot, expandedSet);
  const owningIds = new Set(owningNodes.map(n => n.id));

  const retainedNodes = oldSnapshot.graph.nodes.filter(
    n => !expandedSet.has(n.filePath)
  );
  const retainedEdges = oldSnapshot.graph.edges.filter(
    e => !owningIds.has(e.source) && !owningIds.has(e.target)
  );

  return {
    ...oldSnapshot,
    graph: {
      ...oldSnapshot.graph,
      nodes: [...retainedNodes, ...newPartialGraph.nodes],
      edges: [...retainedEdges, ...newPartialGraph.edges],
    },
    fileHashes: updateFileHashes(oldSnapshot.fileHashes, expandedSet),
  };
}
```

**EC-2（watch 无 git context）**：`--watch` 模式下 `FileChangeEvent[].path`（绝对路径）直接作为 `changedFiles`，不调用 `gitDiff`。

**EC-10（shallow clone 降级）**：`gitDiff` 失败时，`buildIncremental` 切换为 `detectStale` 全量 hash 比对，stdout 记录 `{ fallbackReason: 'git-diff-failed' }`。

**EC-1（caller 扩展扇出超时）**：`buildIncremental` 接受 `timeout` 参数（默认 60000 ms）；超时后记录警告并降级为 full re-index。

**EC-9（rename / delete）**：`detectStale` 时检测文件是否存在；不存在的路径标记为 `deleted`，在 `mergeIncremental` 中从 `graph.nodes` 和 `graph.edges` 移除，从 `fileHashes` 删除对应 key。

**--caller-depth flag（clarify Q3）**：接口预留 `callerDepth` 参数，当前固定行为为深度 1；CLI 暴露 `--caller-depth N` 参数但默认值 = 1，传递闭包不在本 Feature 范围（YAGNI）。

### 2.3 spectra index 命令（`src/cli/commands/index.ts`）

**子命令设计**：

```
spectra index                  → 全量索引，完成后退出（exit 0）
spectra index --watch          → 持续监听模式，进程不退出（FR-12）
spectra index --incremental    → 一次性增量更新，完成后退出（FR-30）
spectra index --caller-depth N → 预留 flag，默认 1
```

**`--watch` 与 `--incremental` 互斥**：两个 flag 同时传入时打印错误提示，exit 1。

**watch 模式实现**（WARN-1 关闭）：

```typescript
// FileWatcher 回调签名为批量事件 (events: FileChangeEvent[]) → void
// 不是单个 event.path，必须从 events 数组提取路径集合
watcher.on('change', (events: FileChangeEvent[]) => {
  const changedPaths = new Set(
    events.filter(e => e.category === 'code').map(e => e.path)
  );
  if (changedPaths.size > 0) {
    buildIncremental(projectRoot, { changedFiles: Array.from(changedPaths) });
  }
});
```

**debounce 时间窗口决议**（Q-D1）：选定 **200 ms**。理由：spectra index --watch 仅触发 AST 解析 + graph merge，比 batch 操作轻量得多；200 ms 能有效合并 IDE 连续保存事件，同时保持接近实时的反馈。

**进度输出格式**（FR-14 SHOULD）：每次索引触发时，stdout 输出一行机器可读 JSON：

```json
{ "mode": "incremental", "changedFiles": 3, "expandedFiles": 7, "duration": 1240, "snapshotPath": ".spectra/unified-graph.json" }
```

**AC-4 机器可读 JSON**：无变更时输出 `{ "changedFiles": 0, "skippedReason": "no-diff" }`，满足 `jq .changedFiles` 验证。

### 2.4 git hook（`plugins/spectra/hooks/post-commit.sh`）

```bash
#!/usr/bin/env bash
# Spectra post-commit hook — 触发增量索引（可选安装）
# 安装方式：cp plugins/spectra/hooks/post-commit.sh .git/hooks/post-commit && chmod +x .git/hooks/post-commit

set -euo pipefail

# 检测 .spectra/ 是否存在（未初始化则跳过，不报错）
if [ ! -d ".spectra" ]; then
  exit 0
fi

# 调用一次性增量更新（post-commit 上下文，git diff 使用 ORIG_HEAD HEAD）
npx spectra index --incremental
```

安装策略（clarify Q4）：**只提供脚本文件 + README 说明**，不新增 `--install-hook` CLI 子命令，不做 npm postinstall 自动安装。README 说明手动 copy + chmod 步骤，并说明检测 `.spectra/` 目录跳过逻辑。

### 2.5 import-resolver.ts（`src/core/import-resolver.ts`）—— CRITICAL-1 关闭

**背景**：当前 `src/core/ast-analyzer.ts:376` 的 import 提取把 `resolvedPath` 置为 null（注释："不解析路径（性能优化）"），`src/core/tree-sitter-fallback.ts` 同样不填充 `resolvedPath`。`knowledge-graph/index.ts` 的 `deriveImportEdges` 跳过 `resolvedPath=null` 的 import，导致删除 dependency-cruiser 后 TS/JS `depends-on` 边数为 0。

**新增模块接口**：

```typescript
// src/core/import-resolver.ts（新增，W1.0 天 1）
export interface ResolveTsJsImportOptions {
  extensions?: string[];        // 默认 ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
  indexFiles?: string[];        // 默认 ['index.ts', 'index.js']
  pathAliases?: Record<string, string>;  // tsconfig paths 映射，可选
}

// 核心解析函数：specifier → 绝对路径（无法解析返回 null）
// 覆盖 4 类 import：static import / require() / dynamic import() / import type
export function resolveTsJsImport(
  specifier: string,
  fromFile: string,      // 发起 import 的文件绝对路径
  projectRoot: string,   // 项目根目录（用于 tsconfig paths 解析）
  options?: ResolveTsJsImportOptions,
): string | null

// importType 从 syntax kind 派生（保留原始语法类型，用于 CRITICAL-3 isCircular/importType）
// 返回值字面量：'static' | 'dynamic' | 'require' | 'type-only'（对应 spec FR-28 / AC-11 列出的 4 种 import）
export type ImportType = 'static' | 'dynamic' | 'type-only' | 'commonjs-require'
export function detectImportType(node: ImportDeclaration | CallExpression | Node): ImportType

// detectImportType 判断规则（基于 ts-morph 节点，ast-analyzer.ts 调用路径）：
// 1. 'type-only'：节点为 ts-morph ImportDeclaration 且 node.isTypeOnly() === true
//    （或 namedImports 全部满足 specifier.isTypeOnly() === true）
// 2. 'dynamic'：节点为 CallExpression，callee 为 import 关键字
//    （ts-morph SyntaxKind.ImportKeyword，即 import(...) 动态导入）
// 3. 'require'：节点为 CallExpression，callee 为 Identifier 且文本为 "require"
// 4. 'static'：默认（剩余的标准 ImportDeclaration：named import / default import / namespace import）
//
// tree-sitter-fallback.ts 调用路径（按 query 节点类型映射）：
//   type_import_declaration → 'type-only'
//   call_expression（callee 文本 = "import"）→ 'dynamic'
//   call_expression（callee 文本 = "require"）→ 'require'
//   import_statement → 'static'
//
// 调用位置：
//   ast-analyzer.ts:365 处 getImportDeclarations() 遍历时，对每个 import 节点调用 detectImportType
//   tree-sitter-fallback.ts 对应 import 提取点，按上述 query 节点类型映射
```

**调用点**：
- `src/core/ast-analyzer.ts`：在 import 提取循环（约 L376）调用 `resolveTsJsImport`，将结果写入 `CodeSkeleton.imports[i].resolvedPath`；同时将 `detectImportType` 结果写入 `CodeSkeleton.imports[i].importType`
- `src/core/tree-sitter-fallback.ts`：在对应的 import 提取点调用相同接口

**fixture 验证**（W1.0 完成标志）：`tests/fixtures/ts-import-scenarios/` 下 4 类 import fixture，对每个文件调用 `buildUnifiedGraph` 后，检验 `depends-on` 边数 ≥ 4（4 类各 ≥ 1 条），无一为 null。

### 2.6 isCircular + importType 语义派生（CRITICAL-3 关闭）

DependencyGraph 的 `DependencyEdge` 包含 `isCircular: boolean` 与 `importType: 'static' | 'dynamic' | 'type-only'`，旧 shim 固定值（isCircular=false / importType=static）会让 AC-11 失败。正确实现：

**importType 派生**：
- `import-resolver.ts` 的 `detectImportType` 返回 `ImportType` 写入 `CodeSkeleton.imports[].importType`
- `deriveImportEdges`（`knowledge-graph/index.ts`）读取 `CodeSkeleton.imports[].importType` 并写入 `UnifiedGraphEdge` 的 `evidence` 或 `metadata` 字段（不修改 schema 主字段，通过 evidence bag 携带）
- `legacy-shim.ts` 的 `DependencyEdge` 重建时，从对应 `UnifiedGraphEdge.evidence.importType` 读取

**isCircular 派生**：

直接复用项目既有 Tarjan 算法实现 `detectSCCs`（`src/graph/topological-sort.ts:32`），不重写 SCC 检测逻辑。

```typescript
// legacy-shim.ts 中 isCircular 填充完整逻辑：
//
// 步骤 1：从 derivedDependencyGraph（shim 已派生的 modules + depends-on edges）
//         构造 detectSCCs 入参（UnifiedGraph 子图结构：nodes: string[], edges: {from, to}[]）
//
// 步骤 2：调用既有 detectSCCs（src/graph/topological-sort.ts:32，Tarjan 算法）
//         传入模块级 depends-on 子图；返回 SCC[]，每个 SCC 含 { id, modules: string[] }
//
// 步骤 3：提取环成员集合
//         凡 scc.modules.length > 1 的 SCC，成员 module ids 加入 circularNodeIds
//
// 步骤 4：重建 DependencyEdge 时，对每条边：
//         isCircular = circularNodeIds.has(edge.source) && circularNodeIds.has(edge.target)
//         （即 from/to 同属一个 size > 1 的 SCC，才视为环上的边）
//
// 注：detectSCCs 是项目既有能力，shim 派生时调用一次；不引入新算法，不重写。

const sccs = detectSCCs(unifiedSubgraph);  // 复用 topological-sort.ts:32
const circularNodeIds = new Set<string>();
for (const scc of sccs) {
  if (scc.modules.length > 1) {
    scc.modules.forEach(id => circularNodeIds.add(id));
  }
}
// 重建 DependencyEdge 时
const isCircular = circularNodeIds.has(edge.source) && circularNodeIds.has(edge.target);
```

### 2.7 DependencyGraph shim 改造路径（17 consumer）

**改造顺序**（按依赖图逆推，阻断方先行）：

#### 阶段一：legacy-shim.ts helper 实现（W1.1）

新建 `src/graph/legacy-shim.ts`（私有，非 public export）：

```
// 从 UnifiedGraph 派生 DependencyGraph 兼容视图
// 调用方：batch-orchestrator、topological-sort、mermaid-renderer shim 层
deriveLegacyDependencyGraph(
  unified: UnifiedGraph,
  projectRoot: string,
): DependencyGraph

// 实现细节：
// 1. 过滤 kind === 'module' 节点 → modules: GraphNode[]
//    - inDegree = 此节点作为 target 的 depends-on 边数量
//    - outDegree = 此节点作为 source 的 depends-on 边数量
//    - level = topological level（调用 topologicalSort 后取 levels.get(node) ?? 0）
//    - isOrphan = inDegree === 0 && outDegree === 0
// 2. 过滤 relation === 'depends-on' 边 → edges: DependencyEdge[]
//    - from = edge.source
//    - to = edge.target
//    - isCircular：从 SCC 反查（detectSCCs → SCC.size > 1 的成员间边标 true）
//    - importType：从 edge.evidence.importType 读取（import-resolver 写入）
// 3. 调用 detectSCCs 和 topologicalSort（传入已过滤的模块图结构）
//    填充 topologicalOrder / sccs
// 4. 调用 renderDependencyGraph 填充 mermaidSource
// 注：此 helper 仅在 W1 的 shim 阶段使用，atomic switch 完成后删除
```

**FR-31 约束**：`deriveLegacyDependencyGraph` 必须从**传入的 UnifiedGraph 参数**派生，禁止调用 `getCurrentUnifiedGraph()` 全局 cache。

#### 阶段二：rewrite 6 个（W1.2）

按下列顺序改造（底层先行，顶层后）：

| 文件 | 改造内容 |
|------|---------|
| `src/graph/dependency-graph.ts` | 删除 dependency-cruiser 调用；`buildGraph()` 改为调用 `buildUnifiedGraph` + `deriveLegacyDependencyGraph`（过渡）；W1.3 末删除本文件 |
| `src/graph/directory-graph.ts` | `buildDirectoryGraph()` 改为：调用 `buildUnifiedGraph(input)` + 从 `depends-on` 边派生兼容视图返回 |
| `src/adapters/ts-js-adapter.ts` | `buildDependencyGraph()` 改为委托 `buildUnifiedGraph` + `deriveLegacyDependencyGraph`；不再依赖 dependency-cruiser |
| `src/adapters/python-adapter.ts` | `buildDependencyGraph()` 改为：现有 CodeSkeleton 逻辑保留，输出通过 `buildUnifiedGraph` + `deriveLegacyDependencyGraph` 派生；不解决 import resolution 精确度（EC-6，留后续 Feature） |
| `src/adapters/language-adapter.ts` | `buildDependencyGraph?()` 接口签名更新为返回 `DependencyGraph`（过渡期保留签名，W1.3 后改为 `buildUnifiedGraph?()` 或移除） |
| `src/batch/batch-orchestrator.ts` | `buildGraphForLanguageGroup` 改为内部调用 `buildUnifiedGraph`；通过 `deriveLegacyDependencyGraph` 产出临时 `mergedGraph: DependencyGraph`，让下游 shape-map consumer 在 W1.2 期间不受影响；W1.3 完成后切换下游消费 UnifiedGraph |

#### 阶段三：shape-map 8 个（W1.2-W1.3）

| 文件 | 改造内容 | 改造类型 |
|------|---------|---------|
| `src/graph/topological-sort.ts` | `detectSCCs` 和 `topologicalSort` 新增重载，接受 `{ nodes: string[], edges: Array<{from: string, to: string}> }` 的标准化子图结构（从 UnifiedGraph 过滤后传入）；保留对 `DependencyGraph` 的支持直到 W1.3 删除 | shape-map |
| `src/graph/mermaid-renderer.ts` | 新增 `renderUnifiedGraph(unified: UnifiedGraph, options?)` 函数；遍历 `depends-on` 边；原 `renderDependencyGraph` 保留直到 W1.3 | shape-map |
| `src/panoramic/builders/doc-graph-builder.ts` | `BuildDocGraphOptions.dependencyGraph` 改为 `unifiedGraph: UnifiedGraph`；内部字段映射 `from/to` → `source/target` | shape-map |
| `src/panoramic/generators/cross-package-analyzer.ts` | 入参改为 UnifiedGraph；包级图直接从 `depends-on` 边过滤，不再调用 `detectSCCs(dependencyGraph)` | shape-map |
| `src/generator/index-generator.ts` | `identifyCrossCuttingConcerns` 入参改为 UnifiedGraph；`inDegree` 从 UnifiedGraph 邻接表动态计算（target 为该节点的 `depends-on` 边数量） | shape-map |
| `src/batch/delta-regenerator.ts` | `DeltaRegeneratorOptions.dependencyGraph` 改为 `unifiedGraph: UnifiedGraph`；内部 `edges[].from/to` → `edges[].source/target` | shape-map |
| `src/batch/module-grouper.ts` | `groupFilesToModules` 入参改为 UnifiedGraph；遍历 `depends-on` 边替代 `graph.modules/edges` | shape-map |
| `src/adapters/language-adapter.ts` | 接口方法从 `buildDependencyGraph` 改为 `buildUnifiedGraph`（W1.3 时随 public export 清零一起完成） | shape-map |

#### 阶段四：trivial 3 个（W1.3）

| 文件 | 改造内容 |
|------|---------|
| `src/adapters/index.ts` | 删除 `DependencyGraphOptions` re-export，改为 re-export UnifiedGraph 相关类型 |
| `src/cli/commands/graph.ts` | 检查并清理残余 DependencyGraph import |
| `src/knowledge-graph/unified-graph.ts` | 更新注释：删除 DependencyGraph shim 方向说明 |

#### 阶段五：atomic switch + 删除（W1.3 末）

**clarify Q5 决议**：允许"改造 commit + 删 helper commit"**两步提交**（同一 PR 内）：

- **Commit 1（改造 commit）**：所有 consumer 切换完成，`legacy-shim.ts` 仍存在（私有，非 public export），`npm run build` + `npx vitest run` 零失败
- **Commit 2（删除 helper commit）**：删除 `src/graph/legacy-shim.ts`、`src/models/dependency-graph.ts`、`src/graph/dependency-graph.ts`；移除 `dependency-cruiser` 依赖；`npm run build` + `npx vitest run` 零失败

PR merge 后 master 上 DependencyGraph 引用清零（FR-23 AC-5 验证通过）。

---

## 3. PARTIAL 项处理（spec checklist B2 / B3 / F2）

### B2：FR → AC trace 表

以下补充 FR-7 和 FR-8 的验收入口（并入 AC-3a/3b 说明）：

| FR 编号 | FR 内容摘要 | 验收入口 |
|---------|-----------|---------|
| FR-7 | caller expansion 深度 1 | AC-3a / AC-3b（full vs incremental 边 diff = 0）；consumer-shim.test.ts（expandCallers 单测）|
| FR-8 | 合并后 hash 更新完整性 | incremental.test.ts TC-4（未变更文件节点不被修改）；AC-4（第二次运行 changedFiles = 0）|
| FR-14 | 进度输出格式（SHOULD） | 人工验证：运行 `spectra index` 后检查 stdout JSON 格式（无 AC，SHOULD 级别可接受）|
| FR-30 | --incremental flag 语义 | AC-9（exit 0 + snapshot 通过 Zod 校验）；post-commit hook 安装后手动验证 |

### B3：< 30 秒 AC baseline 注释

**AC-1、AC-2a、AC-2b、FR-9、FR-10、FR-29 的 baseline 约定**：

> 性能基准环境：**macOS M 系列（M1/M2/M3） + 16 GB RAM**（CLAUDE.local.md baseline project 的采集机型）。CI 环境（GitHub Actions Ubuntu 2 vCPU）下 < 30 秒无保证；AC-1/2a/2b 验收以本地 M 系列机型实测为准，CI 版本可放宽至 60 秒。`verify-feature-156.mjs` 脚本中通过 `--timeout` 参数支持两种阈值配置。

### F2：[AUTO-RESOLVED] 替换为 [INFERRED]

以下是 spec.md 中 `[AUTO-RESOLVED]` 标注的列表，plan 阶段确认为 [INFERRED]，理由保留原文：

| 位置 | 原标注 | 决议类型 | 简要理由 |
|------|--------|---------|---------|
| FR-7 末尾 | [AUTO-RESOLVED] | [INFERRED] | 深度 1 是最小安全边界，tech-research 风险 C 指出 caller 扩展必要，深度 > 1 无测试验证 |
| EC-7 末尾 | [AUTO-RESOLVED] | [INFERRED] | 本 spec 不预设裁剪策略，交由 plan 决议（plan 2.1 节已决议：不裁剪） |

> 注：spec.md v3.1 已将 FR-7 标注改为 [INFERRED]；EC-7 同步更新（已在 spec.md 修订）。

---

## 4. Codebase Reality Check

| 文件 | LOC（估算） | 公开方法数 | 已知 debt |
|------|-----------|-----------|---------|
| `src/batch/batch-orchestrator.ts` | ~900 | 2（`runBatch`, `buildGraphForLanguageGroup`） | 核心 rewrite 风险 A；合并 DependencyGraph 路径嵌套深 |
| `src/graph/topological-sort.ts` | 211 | 2（`detectSCCs`, `topologicalSort`） | `graph.modules.map(m => m.source)` + `graph.edges` 耦合 DependencyGraph 结构 |
| `src/graph/mermaid-renderer.ts` | ~120 | 1（`renderDependencyGraph`） | 遍历 `graph.modules` + `graph.sccs` 需全量重写为 UnifiedGraph 路径 |
| `src/graph/dependency-graph.ts` | ~150 | 1（`buildGraph`） | 依赖 dependency-cruiser，目标删除文件 |
| `src/models/dependency-graph.ts` | 87 | 0（纯 schema） | 目标删除文件；7 个 consumer 直接 import |
| `src/adapters/ts-js-adapter.ts` | ~80 | 1（`buildDependencyGraph`） | 委托 dependency-cruiser，需改为 buildUnifiedGraph |
| `src/adapters/python-adapter.ts` | ~280 | 1（`buildDependencyGraph`） | basename map 精度问题（EC-6，留后续），输出 schema 改造 |
| `src/batch/delta-regenerator.ts` | ~250 | 1（`DeltaRegenerator` 类） | `edges[].from/to` 字段映射，shape-map 改造 |
| `src/batch/module-grouper.ts` | ~200 | 1（`groupFilesToModules`） | `graph.modules` 遍历需改为 UnifiedGraph `depends-on` 边 |
| `src/panoramic/builders/doc-graph-builder.ts` | ~350 | 3 | `dependencyGraph` 参数贯穿多个函数，shape-map 影响面较大 |
| `src/panoramic/generators/cross-package-analyzer.ts` | ~300 | 1（`CrossPackageAnalyzer`） | 包级 DependencyGraph 调用 detectSCCs，需重构为 UnifiedGraph 子图 |
| `src/generator/index-generator.ts` | ~180 | 1（`generateIndex`） | `graph.modules.inDegree` 字段直接访问，改为邻接表计算 |
| `src/core/ast-analyzer.ts` | ~600 | 3+ | L376 import 提取点 `resolvedPath` 固定为 null（需接入 import-resolver.ts）|
| `src/core/tree-sitter-fallback.ts` | ~400 | 2 | import 提取点同样不填充 `resolvedPath`（需接入 import-resolver.ts）|

**前置清理规则评估**：`batch-orchestrator.ts`（~900 LOC + 将新增 50+ 行 rewrite）满足"LOC > 500 且新增 > 50 行"条件，但实际操作是**删减 dependency-cruiser 调用 + 改写派生路径**，净变化量不大；无需增加前置 cleanup task，但实现时应在 rewrite 内顺带清理 `#region` 内嵌套注释（CLAUDE.md 代码质量要求）。

`ast-analyzer.ts`（~600 LOC）同样满足"LOC > 500 且将新增 > 50 行"，需增加前置 cleanup task：[CLEANUP] 梳理 ast-analyzer.ts L376 import 提取循环，确认需要修改的调用点数量（预期 ~8 处），确保接入 import-resolver.ts 前无隐藏的 resolvedPath 消费逻辑。

---

## 5. Impact Assessment

| 维度 | 数值 / 描述 |
|------|-----------|
| **直接修改文件数** | 19 个（edit，含 ast-analyzer / tree-sitter-fallback）+ 3 个（delete）+ 8 个（new，含 import-resolver.ts）= 30 个 |
| **间接受影响** | 所有调用 `batch-orchestrator.ts` 的集成测试路径（spectra batch、spectra watch）|
| **跨包影响** | 是：跨 `src/batch/`、`src/graph/`、`src/adapters/`、`src/panoramic/`、`src/generator/`、`src/knowledge-graph/`、`src/cli/`、`src/core/`（8 个顶层目录），不跨 `plugins/` 边界 |
| **数据迁移** | 是：DependencyGraph 类型替换（schema 层面）；新增 `.spectra/unified-graph.json` snapshot 文件格式 |
| **API / 契约变更** | 是：`groupFilesToModules`、`DeltaRegeneratorOptions`、`doc-graph-builder` 等公共接口的入参类型从 `DependencyGraph` → `UnifiedGraph` |
| **风险等级** | **HIGH** |

**风险等级判定**：影响文件 30 个（> 20）+ 跨包影响 8 个目录（> 2）+ 涉及 API 契约变更，三条 HIGH 触发条件均满足。

**HIGH 风险强制分阶段**：实现拆分为 2 个可独立验证的阶段：

- **Phase A：DependencyGraph Shim**（Week 1）—— W1.0 import-resolver + W1.1 legacy-shim + W1.2 17 consumer 改造 + W1.3 删除 dependency-graph / cruiser，所有 3155 单测 pass。验证点：`grep -rn "DependencyGraph" src/ --include="*.ts" | grep -v "^[^:]*:[ \t]*//" | grep -v "^[^:]*:[ \t]*\*" | wc -l` = 0
- **Phase B：Incremental Indexing**（Week 2-4）—— persistence.ts + incremental.ts + spectra index 命令 + 单测。验证点：AC-1/2a/2b/3a/3b 通过，AC-8 ≥ 11 个测试 pass

---

## 6. Open Questions 决议（plan 阶段）

| 问题 | 决议 | 理由 |
|------|------|------|
| Q-D1：debounce 时间窗口 | **200 ms** | 纯 graph 更新比 batch 轻量，200 ms 可合并 IDE 连续保存 |
| Q-D2：大文件流式写入 | **不引入流式写入** | pretty JSON 1 MB stringify < 50 ms，无需 createWriteStream |
| Q-D3：AC-11 fixture 位置 | `tests/fixtures/ts-import-scenarios/` 目录，**入库**（与项目代码相关，非外部代码 AST 结果）| CLAUDE.local.md "truth-set fixture 不入库"针对外部代码（HikariCP/GORM）；本 fixture 是我们自己编写的测试场景 |
| Q-D4：stale 检测并发度 | **串行** hash 计算（`for...of` 循环）| self-dogfood ~250 文件串行 hash < 500 ms，引入并发复杂度无必要 |
| Q-D5：verify 脚本纳入 npm scripts | **是，加入 `npm run verify:f156`**（可选，不影响 CI 主流程）| 便于本地快速验证，scripts 名不影响 CI gate |

---

## 7. Constitution Check

| 宪法原则 | 适用性 | 评估 | 说明 |
|---------|--------|------|------|
| 不引入未要求的优化、功能、清理或重构 | 适用 | PASS | 仅实现 spec.md 定义的 31 FR，不添加 sqlite / 跨 repo 等 Non-goal 功能 |
| 不猜测需求、实现或上下文 | 适用 | PASS | plan 中 OQ 决议均有 clarify.md 或 research 依据 |
| 不在没完整看过目标文件前直接动代码 | 适用 | PASS | 已读取所有目标文件（topological-sort / mermaid-renderer / batch-orchestrator / ast-analyzer 等） |
| 不改字段名、层级或标点格式 | 适用 | PASS | DependencyGraph 字段改造均有 spec 明确指引（from/to → source/target）；不主动改其他字段 |
| 不引入新外部依赖 | 适用 | PASS | 零新依赖；删除 dependency-cruiser；git diff 用 execSync（Node 内置） |
| UnifiedGraph schema 冻结，不修改 | 适用 | PASS | unified-graph.ts 仅更新注释，schema 字段不变；importType/isCircular 通过 evidence bag 或 CodeSkeleton 层传递，不修改 UnifiedGraphEdge 主字段 |
| call-resolver 冻结 | 适用 | PASS | call-resolver/ 整个目录不触碰 |
| 提交前 Codex 对抗审查 | 适用 | 已知需执行 | 每个 phase commit 前启动 codex:codex-rescue 子代理 |
| 测试强制（vitest run 零失败 + build 零错误） | 适用 | PASS | 每步改造均要求 vitest + build 零失败才进入下一步 |

无 VIOLATION 项。

---

## 8. 测试策略

### 8.1 单测（vitest，≥ 11 条）

**`tests/unit/knowledge-graph/persistence.test.ts`（4 条）**：

| TC | 场景 | 验收方式 |
|----|------|---------|
| P-1 | save(snapshot) 后 load() 返回等价对象 | 深比较关键字段（schemaVersion / fileHashes / graph.nodes.length）|
| P-2 | schema roundtrip：`SnapshotWrapperSchema.parse(JSON.parse(JSON.stringify(snapshot)))` 不抛异常 | schema 验证不报错 |
| P-3 | stale 检测：修改文件内容后 `detectStale` 返回该文件 | 写一个临时文件，修改后检测 |
| P-4 | stale 检测：未变更文件 `detectStale` 不返回 | 不修改文件，检测结果为空 |

**`tests/unit/knowledge-graph/incremental.test.ts`（4 条）**：

| TC | 场景 | 验收方式 |
|----|------|---------|
| I-1 | gitDiff 在 mock execSync 返回两行时正确解析为两个绝对路径 | mock execSync，验证输出 Set 大小 = 2 |
| I-2 | expandCallers：changed file 有一个直接 caller 时返回 changed + caller 共 2 个文件 | 构造 mock snapshot，验证 Set 大小 |
| I-3 | mergeIncremental：变更文件的旧边被替换为新 partial graph 的边（通过 node.filePath 反查，非文件路径直接匹配 edge.source/target）| 对比 merged.graph.edges，确认旧边消失、新边存在 |
| I-4 | mergeIncremental：未变更文件的节点和边保持不变 | 对比 merged.graph.nodes，确认非变更节点 id 相同 |

**`tests/unit/knowledge-graph/consumer-shim.test.ts`（≥ 3 条）**：

| TC | 场景 | 验收方式 |
|----|------|---------|
| S-1 | `deriveLegacyDependencyGraph(unifiedGraph)` 产出的 `modules[].inDegree` 与手动计算的 depends-on 边入度一致 | fixture：3 个模块 + 2 条 depends-on 边 |
| S-2 | `topologicalSort` 接受 UnifiedGraph 子图后，输出 order 与原 DependencyGraph 路径结果一致 | 对比两条路径的 `order` 数组 |
| S-3 | `renderUnifiedGraph` 产出 Mermaid 文本包含所有 depends-on 边的 source → target 方向 | 检查 Mermaid 文本中 `-->` 箭头数量 = depends-on 边数量 |

**vitest 写法参照**：`tests/unit/knowledge-graph/build-unified-graph.test.ts`（`afterEach` 清理单例 cache，fixture 用 `mkSk()` 工厂函数）。

### 8.2 端到端验证（`scripts/verify-feature-156.mjs`）

```
验证步骤：
1. 在 micrograd 上执行 full index → snapshot A
2. 修改 1 个 .py 文件
3. 执行 incremental index → snapshot B
4. 对比 snapshot_A.graph.edges 和 snapshot_B.graph.edges：
   - 边比较前执行 canonical sort（WARN-2 关闭）：
     edges.sort((a, b) =>
       a.relation.localeCompare(b.relation) ||
       a.source.localeCompare(b.source) ||
       a.target.localeCompare(b.target)
     );
   - 属于变更文件的 depends-on + calls + cross-module 边 diff = 0
5. 耗时验证：snapshot B 生成时间 < 30 秒（M 系列 baseline）
6. 在 nanoGPT 重复步骤 1-5
7. 在 self-dogfood 修改 1 个 .ts 文件重复步骤 1-5（AC-2b / AC-3b）

退出码：所有验证通过 → 0；任意失败 → 1（附失败原因 JSON）
```

**Q-D3 决议**：AC-11 baseline fixture 放在 `tests/fixtures/ts-import-scenarios/`，入库（我们自己编写的 4 类 import 场景代码，非外部项目代码）。

### 8.3 baseline 重测

- DependencyGraph shim 完成后（W1 末），在 3 个 baseline projects 上重跑 `npm run baseline:collect`，确认 spectra full.json 无 perf regression
- 不增加新 baseline 对比文件；shim 后 grep 验证（AC-5）+ 全测 pass（AC-7）即可作为质量门

### 8.4 AC-11 详细验收流程

1. **准备 fixture**：`tests/fixtures/ts-import-scenarios/` 下包含 4 个文件：`static-import.ts`、`dynamic-import.ts`、`type-only-import.ts`、`circular-a.ts` + `circular-b.ts`
2. **baseline 采集**（shim 先行阶段中点，删除 dependency-cruiser 前）：对 fixture 执行 dependency-cruiser，记录各类 depends-on 边数至 `tests/baseline/_temp/dep-cruiser-baseline.json`（不入库）
3. **删除后验证**：对同一 fixture 执行 `buildUnifiedGraph`（经由 import-resolver.ts 填充 resolvedPath），产出的 depends-on 边数每类 ≥ baseline；同时验证 `importType` 字段能区分 `static` / `dynamic` / `type-only`；`isCircular` 通过 SCC 反查正确标记 circular-a / circular-b 之间的边
4. **incremental 路径等价**：改动 1 个 fixture 文件，执行 incremental 索引，depends-on 边数与全量一致（差值 = 0）

---

## 9. Milestone 周计划细化

### Week 1：DependencyGraph Shim 先行

**出口条件**：
```bash
grep -rn "DependencyGraph" src/ --include="*.ts" \
  | grep -v "^[^:]*:[ \t]*//" \
  | grep -v "^[^:]*:[ \t]*\*" \
  | wc -l
```
结果 = 0（WARN-4 关闭：排除 `//` 单行注释和 `*` 多行注释行）；`npx vitest run` ≥ 3155 通过零失败；`npm run build` 零 type error

| 子任务 | 天次 | 内容 | 完成标志 |
|--------|------|------|---------|
| [CLEANUP] W1.0 前置 | 天 1（上午）| 梳理 ast-analyzer.ts L376 import 提取循环，确认 ~8 处 resolvedPath 赋值点；确认 tree-sitter-fallback.ts 对应点；无隐藏消费逻辑 | 调用点清单文档化在 PR description |
| W1.0 | 天 1 | 新增 `src/core/import-resolver.ts`：`resolveTsJsImport` + `detectImportType` 接口；在 ast-analyzer.ts / tree-sitter-fallback.ts 各 import 提取点调用；fixture 4 类 import 验证 resolvedPath 非 null | fixture 验证通过，depends-on 边 ≥ 4 |
| W1.1 | 天 2 | `src/graph/legacy-shim.ts` 实现 `deriveLegacyDependencyGraph`（含 isCircular SCC 反查 + importType evidence 读取）；单测 3 条（consumer-shim.test.ts S-1/S-2/S-3） | vitest 单测 3 条 pass |
| W1.2a | 天 3 | rewrite 6 个（ts-js-adapter / python-adapter / directory-graph / dependency-graph / language-adapter / batch-orchestrator）；使用 legacy-shim 过渡 | build 零 type error |
| W1.2b | 天 4 | shape-map 8 个（topological-sort / mermaid-renderer / doc-graph-builder / cross-package-analyzer / index-generator / delta-regenerator / module-grouper / language-adapter 签名）| vitest 全量 pass |
| W1.3 | 天 5 | trivial 3 个（adapters/index.ts / graph.ts / unified-graph.ts）；Commit 1（改造 commit）；删除 legacy-shim.ts + src/models/dependency-graph.ts + src/graph/dependency-graph.ts + 移除 dependency-cruiser；Commit 2（删除 commit）；AC-11 baseline 采集；`spectra batch micrograd` 冒烟验证 | AC-5 / AC-6 通过 |

**W1 里程碑顺序**：W1.0 import-resolver → W1.1 legacy-shim → W1.2 17 consumer 改造（rewrite 6 + shape-map 8）→ W1.3 trivial 3 + 删除 src/models/dependency-graph.ts → **W1.4（W1.3 末）删除 dependency-cruiser 依赖（前提：import-resolver fixture 验证 ≥ baseline）**

**风险 A 缓解（batch-orchestrator rewrite 具体操作）**：

- W1.2a 当天，首先在 `batch-orchestrator.ts` 内部新增 `buildUnifiedGraph` 调用路径，通过 `deriveLegacyDependencyGraph` 保持 `mergedGraph` 类型不变，让下游 consumer 不感知
- 单独为 `buildGraphForLanguageGroup` 新增单测（1 条，确认输出等价）
- **回滚预案**：若 W1.2a 当天 batch-orchestrator rewrite 超时或出现未知 type error，回退到"仅改 adapter 层"（python/ts-js adapter 先改），orchestrator rewrite 推到天 4

### Week 2：persistence + spectra index 骨架

**出口条件**：AC-9 通过；persistence 单测 4 条 pass；`spectra index` 命令可执行

| 子任务 | 天次 | 内容 | 完成标志 |
|--------|------|------|---------|
| W2.1 | 天 1-2 | `src/knowledge-graph/persistence.ts` 实现（save / load / detectStale / computeFileHashes，含多进程原子写入）；persistence.test.ts 4 条单测 | P-1/2/3/4 pass |
| W2.2 | 天 3 | `src/cli/commands/index.ts` 骨架（spectra index 全量路径）；`.gitignore` 加 `.spectra/` | `spectra index` 执行后产出 .spectra/unified-graph.json |
| W2.3 | 天 4-5 | AC-9 验证（Zod safeParse 通过）；EC-8 corruption 降级路径测试；snapshot schema 大小评估（self-dogfood 实测）| AC-9 通过；文件大小 < 2 MB |

### Week 3：incremental + watch

**出口条件**：AC-2b / AC-3b 通过；incremental.test.ts 4 条 pass；`spectra index --watch` 可用

| 子任务 | 天次 | 内容 | 完成标志 |
|--------|------|------|---------|
| W3.1 | 天 1-2 | `src/knowledge-graph/incremental.ts` 实现（gitDiff / expandCallers / mergeIncremental / buildIncremental，含 node.filePath 反查算法）；incremental.test.ts 4 条单测 | I-1/2/3/4 pass |
| W3.2 | 天 3 | `src/cli/commands/index.ts` 补全 `--watch` 路径（复用 FileWatcher，batch callback 签名，debounce=200ms）；`--incremental` flag（一次性增量） | 本地 watch 模式可触发 incremental |
| W3.3 | 天 4 | EC-2（无 git context）/ EC-9（rename/delete）/ EC-10（shallow clone）降级路径实现 | 各降级路径单测 pass |
| W3.4 | 天 5 | self-dogfood 改 1 个 .ts 文件 incremental 路径实测 < 30 秒；AC-2b / AC-3b 运行 | AC-2b/3b pass |

### Week 4：hook + verify-script + buffer + 全量验收

**出口条件**：AC-1 / AC-2a / AC-7 / AC-8 全通过；scripts/verify-feature-156.mjs 可执行

| 子任务 | 天次 | 内容 | 完成标志 |
|--------|------|------|---------|
| W4.1 | 天 1 | `plugins/spectra/hooks/post-commit.sh` 实现；README 安装说明 | 手动安装后 post-commit 触发 spectra index --incremental |
| W4.2 | 天 2-3 | `scripts/verify-feature-156.mjs` 实现（full vs incremental 对比 + 耗时验证 + canonical sort）；npm run verify:f156 脚本 | 脚本在 micrograd / nanoGPT / self-dogfood 三个 baseline 全 pass |
| W4.3 | 天 4 | 全量验收：AC-1 / AC-2a / AC-7 / AC-8 / AC-11 全部过关；baseline:collect 重测 3 个项目 | 所有 AC 通过 |
| W4.4 | 天 5（buffer）| 修复遗留问题；代码 review；Codex 对抗审查（实施前 verify phase 前必跑）| 无 CRITICAL issue |

**拆分触发条件**：若 Week 1 末 17 consumer 切换仍未完成（`grep DependencyGraph src/ | wc -l` > 0）→ 暂停 incremental 工作（FR-6 至 FR-16），将 incremental indexing 拆为 Feature 153，本 Feature 仅交付 DependencyGraph shim（FR-17 至 FR-32）。

---

## 10. 风险缓解细化

### 风险 A：batch-orchestrator rewrite（HIGH）

**具体 PR 范围**：W1.2a-W1.3 包含在同一 branch 的两个 commit（clarify Q5 决议）。

**单测覆盖**：

- `batch-orchestrator` 内部 `buildGraphForLanguageGroup` 新增 1 条单测：输入 LanguageGroup，输出 UnifiedGraph（而非 DependencyGraph）
- `delta-regenerator` shape-map 1 条单测：`DeltaRegeneratorOptions` 入参 UnifiedGraph 后，`edges[].source/target` 正确映射

**回滚预案**：

1. 若 W1.3 Commit 2（删除 commit）后 `spectra batch` 在 micrograd 上报 type error → `git revert` Commit 2，保留 legacy-shim.ts 继续诊断
2. 若 W1.2a batch-orchestrator rewrite 超时 → 退回到仅 adapter 层改造，orchestrator 推至 W1.3 前半段

### 风险 B：topological-sort + detectSCCs 语义等价（MEDIUM）

**inDegree / outDegree / level 重算复杂度**：

```
inDegree(node) = count(edges where target === node && relation === 'depends-on')
outDegree(node) = count(edges where source === node && relation === 'depends-on')
level(node) = topologicalSort 后 levels.get(node) ?? 0
isOrphan(node) = inDegree === 0 && outDegree === 0
```

以上计算为 O(E) 线性扫描，self-dogfood 2000+ 节点 / 5000+ 边场景下 < 5 ms，无性能风险。

**边界 fixture**（consumer-shim.test.ts 覆盖）：

| 场景 | 期望行为 |
|------|---------|
| 空图（0 节点 0 边）| topologicalSort 返回 `{ order: [], levels: new Map(), hasCycles: false }` |
| 单节点无边 | isOrphan = true，inDegree = outDegree = 0 |
| 循环依赖（A → B → A）| detectSCCs 返回 `[{ id: 0, modules: ['A', 'B'] }]`，hasCycles = true |

### 风险 C：caller expansion 边界（MEDIUM）

**深度固定 1 的已知局限**：A → B → C，C 改了 → 只重索引 C 和直接调用 C 的 B，A 不包含在内（A 的 calls 边可能失效）。

**缓解**：

- `verify-feature-156.mjs` 的 AC-3a/3b 通过 full vs incremental 边 diff = 0 来检测此类遗漏
- 若 diff ≠ 0，脚本打印具体缺失边，提示用户降级为 full re-index
- 后续 Feature 可通过 `--caller-depth 2` 扩展（接口已预留）

### 风险 D：snapshot 大小（LOW）

**监控机制**：

```typescript
// persistence.ts 中 save() 后检测文件大小
const sizeMB = (await fs.stat(snapshotPath)).size / 1024 / 1024;
if (sizeMB > 5) {
  console.warn(`[WARN] Snapshot size ${sizeMB.toFixed(1)} MB > 5 MB threshold`);
}
```

**W2.3 实测**：在 self-dogfood 上执行 full index，记录 `unified-graph.json` 实际大小；若 > 2 MB 则评估是否需要 minified JSON（当前决议为 pretty JSON，可在 W2 末调整）。

---

## 11. 部署与回滚

### 版本号建议

本 Feature 新增 `spectra index` 子命令（用户可见 CLI 变更）+ DependencyGraph 完全删除（内部架构变更），建议 **minor bump**（如 `x.Y.0` → `x.(Y+1).0`）。依据：CLAUDE.local.md SemVer 约定——功能新增 → minor。

版本号更新通过 `contracts/release-contract.yaml` → `npm run release:sync` 同步，不手动改 package.json。

### 回滚预案

- **W1 末 shim 未完成**：按 §9 拆分触发条件，本 Feature 仅交付 DependencyGraph shim，incremental indexing 拆 Feature 153
- **W3 末 < 30 秒 AC 未达成**：检查 self-dogfood（~250 文件）caller expansion 扇出；若 expandedSet 过大，临时降低 `--caller-depth` 为 0（仅索引变更文件本身，不扩展），记为已知限制
- **baseline:collect 回归**：对比 old fixture vs new，若 graph 边数差异 > 5%，停止 push，诊断 shim 映射是否有边丢失

---

## 12. Open Decisions for Tasks 阶段

| 决策项 | 建议 |
|--------|------|
| consumer-shim 回归测试 fixture 粒度 | 一个 fixture（`tests/fixtures/dependency-graph-compat/`）覆盖所有 3 个核心 consumer；不为每个 consumer 单独建 fixture |
| task 拆分粒度 | 按改造类型批 task（rewrite 6 / shape-map 8 / trivial 3 / 新增模块）；不为每个 consumer 单独一个 task，减少 tasks.md 条目数 |
| verify 脚本 CI 集成 | `npm run verify:f156` 加入，但不作为 CI gate（仅 `npx vitest run` 是 gate）；verify 脚本依赖外部 baseline projects（`~/.spectra-baselines/`）不适合 CI 环境 |
| batch-orchestrator 改造顺序 | 建议优先改 `buildGraphForLanguageGroup` 内部路径，再逐步替换 `mergedGraph` 消费方，减少大型函数单次改动量 |
| post-commit hook 测试 | 手动验证（install + commit + 检查 .spectra/ 更新），不写自动化单测 |

---

## 附录：FR → AC 完整 trace 表

| FR 编号 | 描述摘要 | 验收入口 |
|---------|---------|---------|
| FR-1 | .spectra/unified-graph.json 通过 Zod 校验 | AC-9 |
| FR-2 | fileHashes 在 SnapshotWrapper 层 | AC-9（Zod 校验 fileHashes 字段）|
| FR-3 | 未变更文件直接复用节点 | AC-4（changedFiles = 0）+ I-4 单测 |
| FR-4 | .spectra/ 入 .gitignore | 代码 review 检查 .gitignore |
| FR-5 | 原子写入（tmp + rename） | P-1 单测（write 中断后读取不损坏）|
| FR-6 | git diff + watch 两种来源 | I-1 单测（gitDiff 解析）+ AC-10（watch 模式）|
| FR-7 | caller expansion 深度 1 | I-2 单测 + AC-3a / AC-3b |
| FR-8 | 合并后 hash 更新 | I-3 / I-4 单测 + AC-4 |
| FR-9 | micrograd < 30 秒 | AC-1 / AC-2a |
| FR-10 | nanoGPT < 30 秒 | verify-feature-156.mjs |
| FR-11 | spectra index 全量 exit 0 | AC-9 |
| FR-12 | spectra index --watch 持续监听 | AC-10 |
| FR-13 | --watch 与 spectra watch 独立 | AC-10（手动验证 spectra watch 行为不变）|
| FR-14 | 进度输出（SHOULD）| 人工验证 stdout JSON |
| FR-15 | post-commit hook 触发 | 手动验证（安装后 commit）|
| FR-16 | hook 可选安装、不覆盖已有 | 代码 review（脚本 `[ ! -d ".spectra" ]` 检测）|
| FR-17 | batch-orchestrator 改为 buildUnifiedGraph | AC-7（全测 pass）+ 批处理冒烟 |
| FR-18 | topological-sort 接受 UnifiedGraph 子图 | S-2 单测 |
| FR-19 | mermaid-renderer 接受 UnifiedGraph | S-3 单测 |
| FR-20 | ts-js / python / directory-graph 改为 UnifiedGraph | AC-5（grep = 0）+ AC-7 |
| FR-21 | doc-graph-builder 等 6 个 shape-map consumer | AC-7 |
| FR-22 | 删除 dependency-graph.ts + dependency-cruiser | AC-5 / AC-6 |
| FR-23 | grep DependencyGraph = 0 | AC-5 |
| FR-24 | persistence.test.ts 4 条 | AC-8（≥ 11 总计）|
| FR-25 | incremental.test.ts 4 条 | AC-8 |
| FR-26 | 3155 单测继续 pass | AC-7 |
| FR-27 | atomic switch（同 PR 内）| PR review + Commit 2 后 AC-5 验证 |
| FR-28 | TS/JS import 由 src/core/import-resolver.ts 接管，填充 resolvedPath | AC-11 删除后验证步骤 2/3 |
| FR-29 | self-dogfood < 30 秒 | AC-2b |
| FR-30 | --incremental flag 语义 | AC-9 + 手动 post-commit hook 验证 |
| FR-31 | helper 禁止读 getCurrentUnifiedGraph cache | 代码 review（legacy-shim.ts 实现审查）|
| FR-32 | consumer-shim.test.ts ≥ 3 条 | AC-8 |
