# Spectra MCP-First Evolution — 设计文档

**作者**：Spectra/Spec-Driver 团队  
**日期**：2026-05-05  
**状态**：Draft for review  
**触发**：GitNexus 调研发现 Spectra 当前 batch push 模式落后于 MCP pull 模式（详见 [_reference/GitNexus 调研报告](../../_reference/GitNexus/README.md)）

---

## 0. TL;DR

Spectra 已经有 MCP server（10 tools），但产品形态仍是 **"一次性产 spec.md，让 LLM 整份读"**。GitNexus 证明 LLM-first 时代真正的 leverage 是 **"按需 query graph"**，token 效率高 ~80×。

本文档规划 4 个阶段（Feature 150-153）把 Spectra 从 batch generator 升级为 **agent context provider**，同时复用现有 90% 代码（`LanguageAdapter` / `panoramic` 子系统 / `MCP server` / confidence tier）。**不破坏现有 batch CLI / spec.md 产物**，新增能力作为 query layer 叠加。

---

## 1. 现状分析（Before）

### 1.1 已有能力（不要重新发明）

| 能力 | 文件 | 状态 |
|------|------|------|
| MCP server 框架 | `src/mcp/{index,server,graph-tools}.ts` | ✅ 10 tools 已注册（5 workflow + 5 graph）|
| 语言适配器抽象 | `src/adapters/language-adapter.ts` | ✅ `buildDependencyGraph?` 可选方法，4 语言（ts-js / py / go / java）|
| Confidence tier | panoramic graph.json link 字段 | ✅ EXTRACTED 0.95 / INFERRED 0.65 |
| Panoramic 多产物 pipeline | `src/panoramic/{builders,pipelines,generators}` | ✅ generator-registry / parser-registry 抽象 |
| Symbol-level imports | `CodeSkeleton.imports` (`src/models/code-skeleton.ts:121`) | ✅ AST 已抽出 import 列表 |
| Knowledge graph schema | `src/models/dependency-graph.ts` | ✅ DependencyGraph (modules + edges + SCC + topo) |

### 1.2 现有 graph.json 实际输出

micrograd baseline `~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json`：

```json
{
  "nodes": 13,
  "links": 6,
  "link kinds": ["contains", "cross-module"]
}
```

**只有 2 种 edge 类型**：`contains`（模块包含 symbol）+ `cross-module`（spec ↔ source）。  
**没有**：`calls` / `imports-symbol` / `extends` / `implements`。

### 1.3 现有 MCP graph tools

`src/mcp/graph-tools.ts` 已有 6 个：

```
graph_query        — 关键词子图
graph_node         — 节点详情 + 邻居
graph_path         — 最短路径
graph_community    — 社区节点
graph_god_nodes    — 枢纽节点
graph_hyperedges   — 超边
```

**缺少 GitNexus 验证有效的 3 个核心 tool**：
- `impact`（blast radius，按 depth + confidence 过滤）
- `context`（symbol 360° view：caller + callee + processes）
- `detect_changes`（git diff → 受影响 symbols）

---

## 2. 架构坏味道与重构机会

通读 `src/` 后识别 4 处该清理的：

### 2.1 双 graph 模型不统一 🔴（Codex WARNING #2 修订：明确不丢失语义）

```
src/models/dependency-graph.ts          DependencyGraph (modules + import edges + SCC + topologicalOrder + mermaidSource)
src/panoramic/builders/component-view*  ComponentView (relationships + components)
panoramic graph.json                    nodes + links（直接 dump）
```

3 套 graph 概念，**没有统一的 Knowledge Graph 抽象**。MCP graph_query 用 panoramic，DependencyGraph schema 没人在 MCP 层用上。

**重构方向**：建立 `src/knowledge-graph/`，作为 single source of truth。让 panoramic builders / DependencyGraph 都消费这一份。

**关键约束（Codex WARNING #2 反馈）**：DependencyGraph 现有 `SCC` / `topologicalOrder` / `mermaidSource` 字段有独立用户（cli / generator / panoramic mermaid renderer）。**合并必须保留这些 derived view，作为 UnifiedGraph 的派生计算**：
- `SCC` → 在 UnifiedGraph 上跑 Tarjan algorithm 派生
- `topologicalOrder` → 在 UnifiedGraph + SCC 上派生
- `mermaidSource` → 现有 `src/graph/mermaid-renderer.ts` 接受 UnifiedGraph 作为输入

合并不是"删除 DependencyGraph schema"，是"把它从 source of truth 降级为 derived view"。Feature 150 内交付 migration shim，零外部 caller 行为变化。

### 2.2 LanguageAdapter `buildDependencyGraph?` 是可选能力 🟡

接口设计是好的（可选 `?`），但 4 个 adapter（ts-js / py / go / java）实现度参差。call edges 抽取需要在每个 adapter 都做一次类似 GitNexus 的 6-stage call resolution（free / member / constructor / receiver type / dispatch / MRO）。

**重构方向**：把 call resolution 抽成 `src/knowledge-graph/call-resolver.ts`，adapter 只负责"提供 raw call site list"，统一 resolver 层做语义解析（confidence tier 注入）。

### 2.3 缺 agent-context query 语义层 🟡（Codex WARNING #1 修订）

**修订**：之前说"graph.json 是静态 dump，无 query 接口"是不准确。`src/panoramic/graph/graph-query.ts` 已实现 `GraphQueryEngine`（query / node / path / community / god / hyperedges 6 个查询方法），MCP graph tools 直接复用。

**真实坏味道**：缺少 **agent-context 语义** query — 没有 `impact(target, depth)` / `context(symbol)` / `detect_changes(diff)` 这种 LLM 友好的高层语义 query。现有 `graph_query("auth")` 是关键词检索，不能回答"修改 X 影响哪些下游"。

**重构方向**：
- 短期：在现有 `GraphQueryEngine` 基础上 + 加高层 query helpers（impact / context 复用 BFS / DFS 实现），不重写底层
- 中期（Feature 152）：sqlite 持久化作 cache，跨 MCP server 启动复用 graph 不重建

### 2.4 panoramic / batch / mcp 各自 bootstrap 注册 🟢

```typescript
// src/mcp/server.ts:38
bootstrapAdapters();
bootstrapGenerators();
bootstrapParsers();
```

3 个 bootstrap 函数都是 idempotent，但每个 entry point（CLI / MCP / batch）都要写一次。

**重构方向**：抽成 `src/runtime-bootstrap.ts` 一个函数，内部 idempotent。**这是最小重构，1 个文件 +20 行**。

---

## 3. 目标架构（After）

### 3.1 Layer 视图

```
┌───────────────────────────────────────────────────────────┐
│  MCP Server (src/mcp/)                                    │
│  ├─ workflow tools (prepare/generate/batch/diff)          │
│  ├─ graph tools (query/node/path/community/god/hyper)     │
│  └─ NEW: agent-context tools (impact/context/detect_changes) │
├───────────────────────────────────────────────────────────┤
│  Knowledge Graph (NEW src/knowledge-graph/)               │
│  ├─ unified-graph.ts          ← single source of truth    │
│  ├─ call-resolver.ts          ← cross-language pipeline   │
│  ├─ query-helpers.ts          ← impact / context 算法     │
│  └─ persistence.ts (Phase 4)  ← sqlite + git hook         │
├───────────────────────────────────────────────────────────┤
│  Existing Pipelines (src/panoramic/)                      │
│  ├─ batch-orchestrator (CLI batch)                        │
│  ├─ generator-registry (spec.md / mermaid / json renderers) │
│  └─ builders (consume Knowledge Graph)                    │
├───────────────────────────────────────────────────────────┤
│  Language Adapters (src/adapters/)                        │
│  ├─ analyzeFile → CodeSkeleton (含 imports + NEW callSites) │
│  └─ buildDependencyGraph (legacy, gradually subsumed)      │
└───────────────────────────────────────────────────────────┘
```

### 3.2 数据流

```
Source code
  │
  ├──→ LanguageAdapter.analyzeFile()    [现有]
  │      └─ CodeSkeleton (含 imports + callSites + extends/implements)
  │
  ├──→ knowledge-graph.build()           [新]
  │      └─ call-resolver: 解析 callSites → CALLS edges + confidence
  │      └─ symbol-resolver: imports → IMPORTS_SYMBOL edges
  │
  ├──→ MCP query layer                   [扩展现有]
  │      ├─ graph_query / graph_node    [现有，复用]
  │      ├─ impact({target, depth})     [新]
  │      ├─ context({symbol})            [新]
  │      └─ detect_changes({diff})       [新]
  │
  └──→ Generators                        [现有]
         └─ spec.md / mermaid / graph.json (含新 edge 类型)
```

### 3.3 关键不变量（精确定义，Codex CRITICAL #1 修订）

- **batch CLI 输出语义不变**：`spectra batch` 仍产 spec.md + graph.json；旧 reader（仅读 `nodes` / `links`）继续工作。**不保证 byte-equivalent**（新增 `edges` 字段、可能新增 confidence 字段是预期变化）
- **现有 6 个 graph MCP tools 查询语义不变**：`graph_query("auth")` 在相同输入下返回的节点集合一致，**path/score 排序可能微调**（数据源切换到 UnifiedGraph 时不可避免）。Feature 150 末尾用 snapshot test 锁定行为
- **CodeSkeleton schema 向后兼容**：新增 `callSites?: CallSite[]` 为 **optional**（zod `.optional()`），现有 `src/diff/drift-orchestrator.ts` parse 旧 spec 时 `callSites === undefined` 不抛错。新生成的 spec 必填该字段（验收 ≥ 95% 填充率，详见 Feature 150）
- **Node 22+ 运行时要求（Codex CRITICAL #3 修订）**：sqlite 用 Node.js 22.5+ 内置 `node:sqlite`。**当前 package.json `engines.node >= 20` 在 Feature 152 前升级到 `>= 22`**（Spec-Driver 团队 2026-Q3 已计划升 Node 22 LTS，对齐时间线）。如 2026-Q3 前需要发布 Feature 152，fallback 到 JSON snapshot 持久化（不引依赖，性能略差但功能等价）
- **零 src/ 之外的产品代码改动**（plugins/spec-driver / cli wrappers 不动）

---

## 4. 阶段性 Feature 拆分

### Feature 150 — Knowledge Graph 抽象 + CALLS edges（基建，5-6 周，4 语言并行 sub-feature）

**目标**：建立 single source of truth Knowledge Graph，输出 CALLS / IMPORTS_SYMBOL edges，覆盖 4 语言（ts-js / python / go / java）。

**变更**：

| 文件 | 类型 | 改动 |
|------|------|------|
| `src/knowledge-graph/unified-graph.ts` | 新增 | UnifiedGraph schema (nodes + edges + confidence) |
| `src/knowledge-graph/call-resolver.ts` | 新增 | 4 阶段 call resolution（free / member / cross-module / MRO fallback）|
| `src/knowledge-graph/index.ts` | 新增 | Build pipeline + export |
| `src/models/code-skeleton.ts` | 修改 | + `callSites: CallSite[]` 字段 |
| `src/adapters/{ts-js,python,go,java}-adapter.ts` | 修改 | analyzeFile 抽 call sites（tree-sitter query），4 语言全做（详见下方 Adapter 范围）|
| `src/panoramic/graph/*.ts` | 重构 | 改为 consume UnifiedGraph |
| `src/panoramic/builders/component-view-builder.ts` | 重构 | relationship 直接来自 UnifiedGraph.edges |
| `tests/unit/knowledge-graph/*.test.ts` | 新增 | call-resolver 各场景 + UnifiedGraph schema |

**Schema 兼容性**：
- graph.json 旧字段 (`nodes` / `links`) 保留
- 新增 `edges` 字段（含 `kind: 'calls' | 'imports-symbol' | 'contains' | 'cross-module'` + `confidence` + `confidenceScore`）
- 旧 reader 忽略新字段，新 reader 优先用 edges
- `CodeSkeleton.callSites` 为 **optional**（zod `.optional()`），drift-orchestrator parse 旧 spec 不抛错

**验收（Codex WARNING #3 修订：精确指标）**：
- **新生成的 spec.md 中 callSites 字段填充率 ≥ 95%**（4 语言全部）
- **Python baseline call edges precision ≥ 70% / recall ≥ 30%**（micrograd / nanoGPT，复用 `scripts/graph-accuracy.mjs` Python AST truth set）
- **TypeScript baseline call edges precision ≥ 70% / recall ≥ 30%**（self-dogfood / hono，需要扩 graph-accuracy.mjs 加 TypeScript truth set）
- **Go baseline call edges precision ≥ 70% / recall ≥ 30%**（需要选 1 个 Go OSS 项目作为 baseline，例如 hashicorp/go-version 或类似中等规模）
- **Java baseline call edges precision ≥ 70% / recall ≥ 30%**（需要选 1 个 Java OSS 项目作为 baseline）
- 现有 47 单测继续 pass，+25-30 new case for knowledge-graph（4 语言 call resolver 各 5-7 case）

**单测覆盖矩阵（Codex INFO #2 修订）**：

| 语言 | 必测场景 | case 数 |
|------|---------|--------|
| python | free function / self.method() / Class.method() / dunder (`__add__`) / super() / decorators | 7 |
| ts-js | function call / method call / arrow function call / class method / dynamic import().then() | 6 |
| go | regular call / package.Func / receiver.Method / interface method | 5 |
| java | method call / method overloading（静态选择）/ static method / interface default method / lambda invocation | 7 |
| 共享 | call-resolver cross-module 解析 / confidence tier 注入 / unresolved 兜底 | 5 |
| **合计** | | **30** |
- snapshot test：现有 6 graph MCP tools 在合并前后查询结果集合 1:1（顺序 / score 允许 ±10% 漂移）

**预 dependencies (Feature 150 启动前)**：
- `scripts/graph-accuracy.mjs` 扩展支持 TypeScript / Go / Java truth set（当前仅 Python）— 估 1 周
- 选定 Go / Java baseline 项目（小型 OSS，类似 micrograd 量级，便于人工 truth verify）— 估 2-3 天

**预算**：开发 ~3 周（含测试），实测 0 cost（纯 AST 改造，不调 LLM）

**Adapter 范围（用户决定 2026-05-05：4 语言全做，不留 follow-up）**：

Feature 150 实现全部 4 个 LanguageAdapter 的 callSites：ts-js / python / go / java。理由：
- go / java 是常用语言，Spec-Driver 用户群中相当比例
- 4 adapter 共享 90% 抽象（`call-resolver.ts` cross-language pipeline），各自只是 tree-sitter query DSL 不同
- 一次性做完避免 Feature 150b 后续 schema migration 复杂度

工作量估算（v3 修订：HikariCP / GORM 大型 baseline 增加复杂度）：
- python: tree-sitter query for call（含 self.method() / Class.method() / dunder dispatch）— ~3-4 天（**作为 150a 框架先实现**）
- ts-js: tree-sitter query for call_expression / member_expression — ~3 天
- go: tree-sitter query for call_expression / selector_expression（GORM generic types + reflection-heavy）— **~5-7 天**（v3 修订：GORM 复杂度高于小型项目）
- java: tree-sitter query for method_invocation / object_creation（HikariCP method overloading + static dispatch + interface default method + lambda + JMX 反射）— **~8-10 天**（v3 修订：HikariCP 内部 dispatch 复杂）
- call-resolver 抽象 + 单测 — ~5 天（含在 150a）
- panoramic / DependencyGraph 合并到 UnifiedGraph — ~5 天（含在 150a）
- pre-dependencies (graph-accuracy 4 语言 extractor + 单测 ≥ 95% + HikariCP/GORM baseline 入库) — ~2.5-3 周

合计 **~7-8 周**（含 pre-deps；纯实现 ~5-6 周，pre-deps ~2.5-3 周）。各 sub-feature 并行后总体 ~10-11 周。

**并行支持（用户建议 2026-05-05：多 Feature 并行）**：

Feature 150 内部分 4 个 sub-feature 串行 + 并行混合 ship：

- **Week 0 — Pre-dependencies（强制 gate，Codex CRITICAL #1 修订）**:
  - 选定 Go / Java baseline 项目（候选见下方）
  - 扩展 `scripts/graph-accuracy.mjs` 支持 4 语言 truth set（实测 ~1.5-2 周，Codex WARNING #3 修订）
  - 选定 baseline 项目并人工 verify truth set 小样本（~1 周）
  - **Pre-dependencies 不完成不允许启动 150a 实现** — 否则 implementation 先于 oracle

- **150a — 框架 + python**（critical path，Codex WARNING #1 修订）：knowledge-graph 抽象 + python callSites + UnifiedGraph 合并
  - 选 python 而非 ts-js 作为 first language 是因为：python 复杂语义（dunder / `self.method()` / `super()` / class method dispatch）更能 stress test CallSite schema 边界
  - ts-js 走 ts-morph / dependency-cruiser，python 走 TreeSitterAnalyzer，后者覆盖更多 adapter
  - **150a 必须 merge to master 后才启动 150b/c/d**（避免 src/knowledge-graph/ 写冲突，Codex CRITICAL #2 修订）
  - 估时：~2 周

- **150b — ts-js / 150c — go / 150d — java**（150a merge 后并行启动，Codex CRITICAL #2 修订）：
  - 各自独立 worktree + branch，写入路径 disjoint：`src/adapters/{lang}-adapter.ts` + tree-sitter query 文件，**不共享改 knowledge-graph/**
  - 每个 sub-feature 走 spec-driver-story（4-5 阶段，轻量），各自 ship + merge
  - **150d java 估时修订** ~6-8 天（Codex WARNING #2：method overloading + static dispatch + interface default method + lambda 调用复杂度高）
  - 150b ts-js / 150c go 估 2-3 天

**Baseline 项目（用户决定 2026-05-05）**：

| 语言 | 项目 | 规模 | 选择理由 |
|------|------|------|---------|
| Python | karpathy/micrograd + karpathy/nanoGPT | 248 / 1.2k LOC | 已 baseline，无需重选 |
| TypeScript | hono + self-dogfood | 116k LOC | 已 baseline，需扩 graph-accuracy 加 TS truth extractor |
| **Go** | **go-gorm/gorm**（core package）| ~10k LOC（core；全包 ~50k）| ORM 实战，generic types + reflection + interface dispatch 充分 stress test |
| **Java** | **brettwooldridge/HikariCP**（src/main） | ~3-5k LOC | JDBC connection pool，zero-dependency（无 Spring/Guava），thread pool + JMX interface dispatch 复杂度高 |

**Truth verification 策略（修订：放弃"100% 人工 verify"）**：

| 项目规模 | Verify 策略 |
|---------|-----------|
| ≤ 500 LOC（micrograd / Go-Tomorrow 候选）| 100% AST extractor 生成 truth + 100% 人工 spot-check |
| 500-5k LOC（micrograd-java port / HikariCP core）| AST extractor 全量 truth + 5-10% sample 人工 spot-check |
| **5k-50k LOC（GORM 全包 / hono 核心）** | **AST extractor 全量 truth + extractor 正确性单测**（不再 100% 人工 verify）+ 1% 随机 sample spot-check |
| > 50k LOC（self-dogfood）| 同上，spot-check 降到 0.5% sample |

**这意味着 graph-accuracy.mjs 扩展的 AST extractor 本身需要单测覆盖 ≥ 95%**，否则 truth set 不可信，验收无意义。Pre-dependencies 工作量调整：

- graph-accuracy.mjs 4 语言 AST extractor 扩展 + 单测 ≥ 95% 覆盖：~2.5-3 周（vs 原 1.5-2 周）
- HikariCP / GORM clone + baseline fixture 入库：~3 天

Go / Java baseline 必须在 Week 0 完成入库 `tests/baseline/HikariCP/` 和 `tests/baseline/gorm/`，否则 150c / 150d 无 oracle。

### Feature 151 — Agent-Context MCP Tools（核心差异化，3-4 周）

**目标**：基于 Feature 150 的 Knowledge Graph，新增 3 个 MCP tools。

**新 tools**：

```typescript
// 1. impact — blast radius
mcp.tool('impact', {
  target: string,         // symbol id 或 "module/path/file.py:Class.method"
  depth?: number,         // 默认 2，最大 5
  minConfidence?: number, // 默认 0.7
  direction?: 'upstream' | 'downstream' | 'both'
}) → {
  affected: Array<{ id, depth, confidence, reason }>,
  summary: { directCallers: N, transitive: M, riskTier: 'low'|'medium'|'high' }
}

// 2. context — symbol 360° view
mcp.tool('context', {
  symbol: string,    // symbol id
  include?: ('callers' | 'callees' | 'imports' | 'related-spec')[]
}) → {
  definition: { file, line, kind: 'function'|'class'|... },
  callers: Array<{ id, file, line, confidence }>,
  callees: Array<...>,
  imports: Array<...>,
  relatedSpec: { module, sectionPath, anchor }  // pull spec.md 相关章节
}

// 3. detect_changes — git diff → 受影响
mcp.tool('detect_changes', {
  diff?: string,        // 直接传 git diff 文本
  baseRef?: string,     // 或传 commit ref，server 跑 git diff
  scope?: 'symbols' | 'modules'
}) → {
  changedSymbols: Array<{ id, changeKind: 'added'|'modified'|'deleted' }>,
  affectedSymbols: Array<...>,    // impact 链
  riskSummary: '...'
}
```

**变更**：

| 文件 | 改动 |
|------|------|
| `src/mcp/agent-context-tools.ts` | 新增（impact / context / detect_changes 注册）|
| `src/mcp/server.ts` | + 调用 `registerAgentContextTools()` |
| `src/knowledge-graph/query-helpers.ts` | 新增 BFS / DFS 算法（reuse `src/graph/topological-sort.ts`）|
| `tests/unit/mcp/agent-context-tools.test.ts` | 新增 12+ case |

**验收（Codex WARNING #4 修订：anchor 能力前置依赖）**：
- impact tool 在 micrograd 上 query `Value.__add__` 返回 ≥ 5 callers within 2 ms，confidence ≥ 0.7
- impact tool 默认 budget enforcement: depth ≤ 5，max 200 nodes（**遍历前**截断而非遍历后裁剪，Codex WARNING #6 修订）
- context tool 返回 symbol 定义位置（file + line）+ callers / callees 列表
  - **spec.md anchor 链接是 stretch goal**：依赖 `src/batch/batch-orchestrator.ts` 的 specPath enrichment 持久化为 graph.json 字段。Feature 151 内若该字段未持久化，先返回 "module: engine.spec.md" 粗粒度链接；anchor 精确到 section 留 Feature 151b
- detect_changes 接受 `git diff HEAD~1` 输出 → 列出受影响 symbols
- npm run eval:report 自动生成的报告含 "Agent-Context tools available" 标记

**预算**：~3 周

### Feature 152 — Incremental Indexing + Persistence（用户体验，2-3 周）

**目标**：从 30 min full re-index → ≤ 30 sec incremental。

**变更**：

| 文件 | 改动 |
|------|------|
| `src/knowledge-graph/persistence.ts` | 新增（sqlite via `node:sqlite`，schema 镜像 UnifiedGraph）|
| `src/knowledge-graph/incremental.ts` | 新增（git diff → 重新索引 changed files + 直接 caller）|
| `src/cli/commands/index.ts` | + `spectra index --watch` 子命令 |
| `plugins/spectra/hooks/post-commit.sh` | 新增 git hook（可选安装）|

**Trade-off**：
- sqlite 复杂度 vs in-memory：sqlite 持久化让跨 run 复用，但增加 db migration 负担
- 缓解：sqlite schema 由 zod schema 自动生成，不手写 migration

**验收**：
- 改 1 个文件后 incremental update < 30 sec（micrograd / nanoGPT 实测）
- Full vs incremental graph 一致（diff 对比零差异）
- 新增 ≥ 8 单测

**预算**：~2-3 周

### Feature 153 — SWE-Bench 风格 Eval 验证 ROI（验证差异化，2 周）

**目标**：抄 GitNexus 的 eval/ 架构，跑 baseline vs spectra-mcp-augmented 对比，验证 grounding lift。

**变更**：

| 文件 | 改动 |
|------|------|
| `scripts/eval-mcp-augmented.mjs` | 新增（task agent 自动调 spectra MCP tools）|
| `tests/baseline/swe-bench-lite/` | 新增 task fixture（5-10 个真实 GitHub bug）|
| `specs/.../competitive-evaluation-report.md` | + §6 SWE-Bench 对比章节 |

**关键 hypothesis**：
- baseline (Claude Code 裸): X% task pass
- baseline + spec.md as system prompt: X% (Sprint 3 Phase 5 实测 grounding lift = 0)
- baseline + Spectra MCP impact/context tools: **Y% (Y > X，验证 MCP pull 比 push 有效)**

**预算**：~2 周开发 + ~$50 实测

---

## 5. 跟现有架构的融合点（务实清单）

### 5.1 复用现有组件

| 组件 | 复用方式 |
|------|---------|
| `LanguageAdapter.analyzeFile` | 加 callSites 字段，不改 contract |
| `CodeSkeleton.imports` | 直接消费做 IMPORTS_SYMBOL edges |
| panoramic generator-registry | 注册新 generator 输出 UnifiedGraph schema |
| MCP server 注册机制 (server.tool) | 直接复用，新 tools 走相同路径 |
| Confidence tier (EXTRACTED/INFERRED) | 直接沿用，扩展到 calls edges |
| `src/graph/topological-sort.ts` | impact tool 的 BFS / DFS 复用 |
| Project context resolver | MCP detect_changes tool 用同一份 git 路径解析 |

### 5.2 不重新发明的（YAGNI）

- ❌ 不自研 graph DB（用 in-memory + 后期 sqlite，**绝对不用 LadybugDB / Neo4j 等**）
- ❌ 不引 Cypher（用结构化 JSON query，BFS/DFS 足够）
- ❌ 不做 process-grouped clustering / Leiden community（Spectra 17 模块规模没必要）
- ❌ 不做跨 repo group mode（先做单 repo，多 repo 留给 follow-up）

### 5.3 一次性重构（trunk-based，不留过渡态）

为了避免坏味道，3 个一次性重构：

1. **runtime-bootstrap 抽离**（最小，1 文件）— 在 Feature 150 顺手做
2. **DependencyGraph + panoramic graph 合并到 UnifiedGraph**（中等）— Feature 150 必做
3. **MCP graph_query 等 6 tool 数据源切换为 UnifiedGraph**（小，1 文件）— Feature 150 末尾做

不引入 "old graph + new graph 并存" 的过渡态。schema 向后兼容意味着 reader 兼容旧 graph.json，**内部一律用 UnifiedGraph**。

---

## 6. 风险与权衡

### 6.1 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 4 个 LanguageAdapter 加 callSites 工作量大 | Feature 150 延期 | **(用户决定 2026-05-05)** 4 语言一起做但拆 sub-feature 并行（150a 框架 + 150b/c/d 各语言），3 人并行 sub-feature 可压缩到 4-5 周 |
| sqlite 持久化引入 cross-version migration 负担 | Feature 152 复杂度 | schema 由 zod 生成，drop-and-rebuild 优于复杂 migration（local cache 而非 source of truth）|
| MCP impact tool 在大型 repo 上 BFS 慢 | 用户体验 | 默认 depth=2，confidence 阈值默认 0.7，max nodes 截断 |
| Feature 153 eval 显示 lift = 0 | 战略风险 | 即使 lift = 0，MCP token 效率还在（10k → 120 tokens 是硬指标），仍值得做 |

### 6.2 显式 trade-off

| 决策 | 选择 | 放弃 |
|------|------|------|
| 持久化 | sqlite (Phase 152) | 自研 graph DB（GitNexus LadybugDB） |
| Query language | 结构化 JSON tools | Raw Cypher（GitNexus 有 cypher tool） |
| Multi-repo | 单 repo 优先 | Cross-repo group mode（GitNexus 有） |
| Call resolution 精度 | 4 stage（含 import scope） | 6 stage MRO（GitNexus 有，TypeScript 还没） |
| Eval 框架 | SWE-Bench Lite | 自定义 eval（已有 Feature 147 评估平台） |

---

## 7. 时间线（参考，含并行执行）

**串行 baseline**（单人 dev）：
```
Week 1-6   Feature 150  Knowledge Graph + 4 语言 CALLS edges
Week 7-9   Feature 151  Agent-Context MCP Tools
Week 10-12 Feature 152  Incremental Indexing + JSON snapshot
Week 13-14 Feature 153  SWE-Bench eval
合计：~14 周（3.5 个月）
```

**并行执行**（多人 / 多 worktree，推荐，Codex CRITICAL #1+#2 修订）：
```
Week 0-1.5 Pre-dependencies                          [必须先完成，gate]
            - graph-accuracy.mjs 扩 TS/Go/Java truth extractor
            - 选定 Go / Java baseline 项目 + 小样本人工 verify
            - 不完成不允许启动 150a

Week 2-3   Feature 150a (框架 + python)             [critical path, 1 人]
            - python 是 first language（dunder/self/super 压测 schema）
            - 必须 merge to master 后才启动 150b/c/d

Week 4-5   Feature 150b (ts-js)   ┐
            Feature 150c (go)       ├ 3 人并行 sub-feature
            Feature 150d (java)     ┘  (java 6-8 天，可能略超时)

Week 5-7   Feature 151  Agent-Context MCP Tools     [独立人，依赖 150a UnifiedGraph 已 merge]
Week 6-8   Feature 152  Incremental Indexing        [独立人，依赖 150a]
Week 8-10  Feature 153  SWE-Bench eval              [eval 团队，依赖 151 ship]
合计：~10 周（2.5 个月，并行节省 ~4 周）

⚠️ 关键 gate：
- Week 0-1.5 Pre-deps 不完成 → 150a 不启动（避免 implementation 先于 oracle）
- 150a 不 merge → 150b/c/d 不启动（避免 src/knowledge-graph/ 写冲突）
```

**Feature 间依赖图**：
```
                         150a (框架 + ts-js)
                         ╱      │      ╲
                        ╱       │       ╲
                  150b/c/d   150b/c/d   150b/c/d
                  (python)    (go)       (java)
                         ╲      │      ╱
                          ╲     │     ╱
                           Feature 150 ship
                          ╱           ╲
                       151             152
                    (Agent-Context)  (Incremental)
                          ╲           ╱
                           ╲         ╱
                          Feature 153
                       (SWE-Bench eval)
```

**关键里程碑**：
- M1 (Week 2): 150a ship，UnifiedGraph 框架就绪，并行 sub-feature 可启动
- M2 (Week 4): 150b/c/d 全部 ship，4 语言 CALLS edges 完整覆盖
- M3 (Week 7): 151 ship，Spectra MCP server 13 tools，可被 Claude Code 调用
- M4 (Week 8): 152 ship，30 min full → 30 sec incremental
- M5 (Week 10): 153 ship，SWE-Bench eval 数据确认 MCP pull > spec.md push

---

## 8. 决策点（用户已拍板，2026-05-05）

| 决策 | 选项 | 用户选择 |
|------|------|---------|
| 1. Feature 切分 | 4 阶段 / 合并 150+151 | ✅ **4 阶段**（保持 ship 节奏） |
| 2. Feature 152 持久化 | sqlite / JSON snapshot | ✅ **JSON snapshot**（避免 Node 22 升级路径依赖） |
| 3. call edges 范围 | ts-js + python 优先 / 全 4 语言 | ✅ **全 4 语言一起做**，但拆 sub-feature 并行 ship |
| 4. Feature 153 eval | 独立 feature / 并入 151 | ✅ **独立**（eval 跟 dev 解耦） |
| 5. 并行执行 | 单人串行 / 多人并行 | ✅ **多 sub-feature 并行**，150a 框架先 ship 后 150b/c/d 并行 |

## 8.1 Codex 对抗审查反馈（已 inline 修订）

### v1 审查（2026-05-05 第一轮）

| Codex finding | 等级 | 修订位置 |
|---------------|------|---------|
| §3.3 vs §5.3 不变量矛盾 | 🔴 CRITICAL | §3.3 重写，明确语义不变 / 实现可变 / 接受 ±10% score 漂移 |
| LanguageAdapter contract 实质破坏 | 🔴 CRITICAL | §3.3 + Feature 150 schema 兼容明确 callSites optional |
| node:sqlite 版本依赖（Node 22.5+）| 🔴 CRITICAL | §3.3 + Feature 152 fallback 到 JSON snapshot |
| §2.3 "无 query 接口"前提失实 | 🟡 WARNING | §2.3 重写，重构理由换为"缺 agent-context 语义层" |
| §2.1 三图合并丢失 SCC/topo/mermaid | 🟡 WARNING | §2.1 加约束："derived view 不丢失，migration shim" |
| Feature 150 验收 "≥50% accuracy" 不可测 | 🟡 WARNING | Feature 150 验收改为 callSites 填充率 ≥ 95% + 4 语言 precision/recall 精确指标 |
| Feature 151 spec anchor 是 implementation detail | 🟡 WARNING | Feature 151 anchor 降级为 stretch goal |
| §4 vs §6.1 adapter 范围不一致 | 🟡 WARNING | Feature 150 明确 4 语言全做（用户决定）|
| BFS 上限设计不足 | 🟡 WARNING | impact tool 加遍历前截断（max 200 nodes）|

### v2 审查（2026-05-05 第二轮，4 语言并行修订后）

| Codex finding | 等级 | 修订位置 |
|---------------|------|---------|
| Pre-dependencies 排到 Week 3-5 → implementation 先于 oracle | 🔴 CRITICAL | Pre-deps 改为 Week 0 强制 gate，未完成不启动 150a |
| 4 sub-feature 共享 src/knowledge-graph/ 必然 merge 冲突 | 🔴 CRITICAL | 改 sub-feature 顺序：150a merge to master 后才启动 150b/c/d；各 sub-feature 写入路径 disjoint |
| 150a 选 ts-js 不能充分压测框架 | 🟡 WARNING | first language 改为 python（dunder/self/super 压测 schema），ts-js 移到 150b |
| Java 4-5 天估时偏乐观 | 🟡 WARNING | Java 估时 4-5 天 → 6-8 天（可拆 Java MVP）|
| graph-accuracy.mjs 扩 4 语言 1 周不足 | 🟡 WARNING | 扩展估时 1 周 → 1.5-2 周 |
| Go/Java baseline 项目未指定 | 🟢 INFO | 加 baseline 候选列表（Go: hashicorp/go-version；Java: 自建 micrograd-java port）|
| 单测覆盖矩阵未列出 | 🟢 INFO | 加单测覆盖矩阵（4 语言 × 调用类型 = 30 case）|

---

## 9. 不在范围（Out of Scope）

- spec-driver 产品改动（本设计聚焦 Spectra）
- LLM-based call inference（GitNexus 也是纯 AST，LLM 增强留给后期）
- Web UI（GitNexus 有 gitnexus-web，Spectra 当前 CLI-only 已够）
- 多 repo group mode（单 repo 先做好）
- 跨语言 unified type system（4 adapter 各自 maintain 即可）

---

## 10. 引用

- GitNexus 调研报告：内部 chat（Feature 149 commit `fcb2771` 后做的调研）
- Spectra 当前 MCP server 实现：`src/mcp/{index,server,graph-tools}.ts`
- LanguageAdapter contract：`src/adapters/language-adapter.ts:78-130`
- Knowledge Graph schema 起点：`src/models/dependency-graph.ts`
- Confidence tier 现状：`~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json`

---

*本文档为 Draft，需 Codex 对抗审查 + 团队 review 后启动 Feature 150。*
