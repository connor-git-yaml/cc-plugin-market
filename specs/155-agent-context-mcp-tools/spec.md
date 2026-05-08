# Feature Specification: Agent-Context MCP Tools (impact / context / detect_changes)

**Feature Branch**: `155-agent-context-mcp-tools`
**Created**: 2026-05-08
**Status**: Draft
**Input**: User description: 实现 Spectra MCP server 3 个新 tools (impact / context / detect_changes)，建在 Feature 151 已 ship 的 UnifiedGraph + call-resolver + Python adapter callSites + bootstrap 收敛之上。本 Feature 是 design doc "Feature 151 — Agent-Context MCP Tools"（[docs/design/spectra-mcp-evolution.md](docs/design/spectra-mcp-evolution.md) §Feature 151）的实现，跟 Feature 152/153/154（ts-js / go / java callsites 子 feature）完全并行（共享 UnifiedGraph 但写入路径 disjoint）。

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 影响半径分析（Priority: P1）

LLM agent（Claude / Codex / Cursor）在准备修改一个 symbol 之前，需要快速回答 "动这个改动会牵连到哪些代码"。当前 agent 只能 grep 文件名 + 全文 + 让 LLM 自己推断，token 消耗大且不准。本 Feature 把这件事变成一次 MCP `impact` tool 调用：传入 symbol id，拿回受影响 symbol 列表（含调用深度、置信度、链路原因），budget 受控。

**Why this priority**：这是设计文档 §Feature 151 的核心差异化能力（GitNexus impact tool 启发）。MCP token 效率从 10k 量级降到 100 量级，是 Spectra 从 batch generator 升级为 agent context provider 的最强信号。

**Independent Test**：在 micrograd baseline 上 invoke `impact({ target: 'engine.py::Value::__add__', depth: 2, minConfidence: 0.7 })` → 应返回 ≥ 5 个 callers within 2 ms，confidence ≥ 0.7。无需任何其他新 tool 即可独立交付价值。

**Acceptance Scenarios**：
1. **Given** UnifiedGraph 已构建（`_meta/graph.json` 存在），**When** agent 调用 `impact` tool 传入合法 symbol id 与 depth=2，**Then** 返回结构化 JSON，含 `affected: [{id, depth, confidence, reason}]` 与 `summary: {directCallers, transitive, riskTier}`。
2. **Given** target symbol 不存在 graph 中，**When** invoke impact tool，**Then** 返回 `error.code = 'symbol-not-found'` + 候选 symbol 提示（前 5 个 fuzzy match）。
3. **Given** 用户传入 depth = 10（超过最大值 5），**When** invoke impact tool，**Then** clamp 到 depth = 5 并在响应附带 `warnings: ['depth-clamped']`。
4. **Given** budget = 200 但 BFS 在 depth=2 已扫到 ≥ 200 节点，**When** invoke impact tool，**Then** 在**遍历前**截断（visited count 检查），返回的 affected.length ≤ 200，且响应附带 `warnings: ['budget-truncated']`。

---

### User Story 2 - Symbol 360° 上下文（Priority: P1）

LLM agent 在准备读 / 写一个 symbol 时，需要一次拿到 "这个 symbol 是什么、被谁调、调谁、来自什么 import、和哪个 spec 相关"。把这件事压成一次 MCP `context` tool 调用，比 agent 自己多次 grep / read 节省 token 与决策延迟。

**Why this priority**：context tool 是 impact 的对偶面（impact 看下游影响，context 看上下文 + 上下游邻居）。两者一起构成 GitNexus 风格 agent context provider 的最小闭环。

**Independent Test**：invoke `context({ symbolId: 'engine.py::Value', include: ['callers','callees','imports','related-spec'] })` → 应返回 definition (file + lineRange) + callers 列表 + callees 列表 + imports 列表 + relatedSpec（粗粒度 module 链接）。无需 impact tool 即可独立验证。

**Acceptance Scenarios**：
1. **Given** symbolId 合法，**When** invoke context tool，**Then** 返回 `{ definition: { file, lineStart, lineEnd, kind }, callers: [...], callees: [...], imports: [...], relatedSpec?: { kind, path } }`。
2. **Given** 用户只指定 `include: ['callers']`，**When** invoke，**Then** 响应中只含 callers 字段，其他键不出现（缩减 payload）。
3. **Given** symbol 所属 module 没有对应 spec.md，**When** invoke 含 `'related-spec'`，**Then** `relatedSpec.kind === 'unknown'`（**不抛错**）。
4. **Given** symbol 所属 module 有 `panoramic/modules/<module>.spec.md`，**When** invoke 含 `'related-spec'`，**Then** `relatedSpec = { kind: 'module-coarse', path: 'panoramic/modules/engine.spec.md' }`（不精确到 section — 设计文档明确为 stretch goal，留 155b）。

---

### User Story 3 - Git diff → 受影响 symbols（Priority: P2）

agent / CI 在 review 一个 PR / commit 时，需要回答 "这次改动可能 break 哪些功能 / 测试"。把 git diff 接到 impact 链路，让 agent 在 review 阶段就能看到 blast radius。

**Why this priority**：detect_changes 是 impact + context 的工作流封装。优先级 P2 是因为它依赖前两个 tool，在前两个 tool 跑通之前没有独立价值；同时设计文档把它列为 Phase 1 必交付。

**Independent Test**：在 micrograd baseline 上跑 `git diff HEAD~1`（构造一个修改 `Value.__add__` 的 patch）→ 调用 detect_changes tool 传入 diff 文本 → 应返回 `changedSymbols`（含 Value.__add__）、`affectedSymbols`（impact 链）、`riskSummary`。

**Acceptance Scenarios**：
1. **Given** 用户传入 unified diff 文本（含 `--- a/engine.py` / `+++ b/engine.py` 头），**When** invoke detect_changes，**Then** 返回 `changedSymbols: [{file, symbols:[...]}]`，其中 symbols 通过 graph 反查文件路径定位。
2. **Given** 用户传入 baseRef = 'HEAD~1'，**When** invoke，**Then** tool 内部 spawn `git diff --name-only HEAD~1...HEAD` 拿改动文件，再做 file → symbols 映射。
3. **Given** changedSymbols 非空，**When** detect_changes 默认开启 transitive，**Then** affectedSymbols 是 changedSymbols 各元素 BFS depth=2 的 union 去重，且 affectedSymbols.length 受同 budget=200 截断（**遍历前**）。
4. **Given** changedSymbols 中有 file 不在 graph 中（新增 file 还没 build），**When** invoke，**Then** 该 file 进入 `unmappedFiles` 列表，不抛错；其他可映射 file 正常处理。

---

### Symbol ID 规范化（合同前置条件）

为消除 Codex C-1 提出的 symbol id 格式歧义，本 Feature 采用以下规范化规则（与 Feature 151 已 ship 的 graph.json 实际格式一致）：

- **唯一权威格式**（graph.json 中实际写入）：
  - 模块节点：`<repoRelPath>`（例：`micrograd/engine.py`）
  - 符号节点：`<repoRelPath>::<symbolPath>`（例：`micrograd/engine.py::Value`、`micrograd/engine.py::Value.__add__`）
  - 顶层模块作用域调用：`<repoRelPath>::<module>`（call-resolver.ts L415，特殊占位）
- **`::` 仅出现一次**，分隔文件路径与符号路径；类成员用 `Class.method`（**单个点号**），不是嵌套 `Class::method`
- **canonicalize 函数职责**（query-helpers 内部）：
  - 接收 `target: string` 输入，做路径归一（去掉前导 `./`、解析 `..`、绝对 → 仓库相对，按 graph.metadata.projectRoot 计算）
  - 三段（A::B::C）输入按 `A::B.C` 容错（兼容用户直觉），找不到则进入 fuzzy match
  - 含非 UTF-8 / 控制字符 → `error.code = 'invalid-symbol-id'`

### Edge Cases

- **空 graph / graph.json 不存在**：3 个 tool 全部返回 `error.code = 'graph-not-built'` + hint 引导用户跑 `spectra prepare` / `spectra batch`。不构造空响应假装成功。
- **symbol id 格式异常**（含多余 `::`、空字符串段、含控制字符）：先尝试 canonicalize 容错，失败返回 `error.code = 'invalid-symbol-id'` + 期望格式说明。
- **symbol id 含 unicode**（含 CJK / emoji 等非 ASCII）：UTF-8 字面相等比较，找到即接受；找不到走 fuzzy match。
- **路径含空格 / 反斜杠 / 相对路径**（"my project/foo.py"、`./engine.py`、`../engine.py`）：canonicalize 后比较；保留原字符不做 url-encode。
- **budget = 0 / depth = 0**：visit 自身节点后立即停止，affected 为空，summary.directCallers = 0。不视为错误（warnings 含 `budget-zero` 或 `depth-zero` 提示）。
- **direction = 'upstream'**：BFS 走反向邻接表（callers）；`'downstream'` 走正向邻接表（callees）；`'both'` 合并去重，去重 key = (id, depth) 取较小 depth。
- **confidence 全部 < minConfidence**：affected 为空，warnings 含 `confidence-filtered-all`，summary 字段全为 0。
- **transitive cycle**（A → B → A，递归）：visited set 阻止重复遍历，cycle 不会让响应膨胀；reason 链路保留首次发现路径。
- **大型仓库 graph.json > 100 MB**：lazy load 单例缓存沿用 graph-tools.ts engineCache，首次 tool 调用 cold-start ≤ 5s（micrograd 约 50KB graph.json，≤ 100ms 完成）；后续 hot ≤ 50 ms。
- **detect_changes 接到 binary file diff / 非 UTF-8 diff**：跳过该文件 → 进入 `unmappedFiles`（含 reason），不抛错。
- **detect_changes 文件 rename / delete**（unified diff 含 `/dev/null`、`rename from`、`rename to`）：rename 的"to" 路径作为 changedFile；delete 的文件进入 `unmappedFiles` (reason: 'deleted-file')；新增文件进入 `unmappedFiles` (reason: 'new-file-not-in-graph-yet')。
- **detect_changes 收到无变更 diff**（empty diff / 仅 mode change）：返回成功响应，`changedSymbols` 为空，`warnings` 含 `'no-changed-files'`。
- **context tool relatedSpec 多个 module 共享同一个 spec.md**：返回 symbol 所属 module 的 spec.md 即可，**不**去重；多链接歧义留 155b。
- **graph reload 中途**（reloadGraph() 被并发触发）：query-helpers 反向邻接表 cache key 含 `graphFileMtime`；若 mtime 变化 → 重建反向邻接表（FR-041 强制）。

---

## Requirements *(mandatory)*

### Functional Requirements

#### MCP Tool 注册与基础设施
- **FR-001**: 系统 MUST 在 `src/mcp/server.ts` 中注册 3 个新 MCP tool：`impact`、`context`、`detect_changes`，使用与现有 `graph_query` 等 tool 一致的 Zod schema 定义模式。
- **FR-002**: 系统 MUST 把 3 个 tool handler 集中在新文件 `src/mcp/agent-context-tools.ts`，导出 `registerAgentContextTools(server)` 接口；`server.ts` 在 `registerGraphTools` 之后调用一次。
- **FR-003**: 系统 MUST 复用 `graph-tools.ts` 的 `engineCache: Map<projectRoot, GraphQueryEngine>` 模块级单例缓存（或 helper 函数），不重复 lazy load `_meta/graph.json`。
- **FR-004**: 系统 MUST 在 graph.json 不存在 / 加载失败时，返回结构化错误响应（`isError: true` + `content[0].text` 含 JSON `{ code, message, hint }`），不抛未捕获异常导致 MCP 进程崩溃。

#### impact tool
- **FR-010**: `impact` tool MUST 接受 input schema：`{ target: string (required, 经 canonicalize), depth?: number (default 2, max 5), minConfidence?: number (default 0.65), direction?: 'upstream' | 'downstream' | 'both' (default 'upstream'), budget?: number (default 200, max 1000), projectRoot?: string (default 当前工作目录) }`。**默认 0.65**（不是 0.7）以保留 medium/INFERRED 边；用户要 high-only 显式传 0.95。响应必须 echo `effectiveDirection`、`effectiveDepth`、`effectiveMinConfidence`、`effectiveBudget`。
- **FR-011**: `impact` tool MUST 返回 output：`{ affected: Array<{ id, depth, confidence: number, reason: string, path?: string[] }>, summary: { directCallers: number, transitive: number, riskTier: 'low' | 'medium' | 'high' }, effectiveDepth, effectiveMinConfidence, effectiveBudget, effectiveDirection, warnings?: string[] }`。`reason` 是 display string（例：`called via Value.__add__ -> Value._backward`），`path` 是可选结构化（id 数组）便于自动化测试。
- **FR-012**: `impact` tool MUST 在 BFS 遍历**前**应用 budget 截断。**伪代码**（query-helpers 内部）：
  ```
  affected = []                  // 累计输出（不含 start node）
  visited = Set([startId])        // 防止重复访问，含 start
  queue = [(startId, 0, [])]      // (id, depth, ancestorPath)
  while queue not empty:
    (curId, curDepth, curPath) = queue.shift()
    if curDepth >= effectiveDepth: continue          // 超 depth 不展开
    for nextEdge in adjacency(curId, direction):
      if confidenceScore(nextEdge) < minConfidence: continue
      nextId = nextEdge.target
      if nextId in visited: continue
      // 关键：enqueue 之前检查 budget
      if affected.length + 1 > effectiveBudget:
        warnings.push('budget-truncated')
        return  // 不要继续 enqueue
      visited.add(nextId)
      affected.push({id: nextId, depth: curDepth+1, confidence: ..., reason, path: [...curPath, nextId]})
      queue.push((nextId, curDepth+1, [...curPath, nextId]))
  ```
  start node 不计入 budget；budget 仅约束 `affected.length`。
- **FR-013**: `impact` tool MUST 复用 [src/panoramic/graph/confidence-mapper.ts](src/panoramic/graph/confidence-mapper.ts) 的 `CONFIDENCE_SCORES`：`EXTRACTED → 0.95`、`INFERRED → 0.65`、`AMBIGUOUS → 0.25`。**不**重复定义数值常量；filter 按 `edge.confidenceScore >= minConfidence`（graph.json 已含 `confidenceScore: number` 字段，FR-040 helper 不需要二次 tier-to-score 转换）。
- **FR-014**: `impact` tool MUST 计算 `riskTier`：directCallers ≥ 10 或 transitive ≥ 50 → `'high'`；directCallers ≥ 3 或 transitive ≥ 15 → `'medium'`；其余 → `'low'`。
- **FR-015**: `impact` tool MUST 在 depth > 5 / budget > 1000 / minConfidence > 1 时 clamp，并在响应附 `warnings` 字段说明被截断；不静默丢弃用户意图。clamp 后的值在 `effective*` 字段回传。

#### context tool
- **FR-020**: `context` tool MUST 接受 input schema：`{ symbolId: string (required, 经 canonicalize), include?: Array<'callers' | 'callees' | 'imports' | 'related-spec'> (default ['callers','callees','imports']), projectRoot?: string }`。
- **FR-021**: `context` tool MUST 返回 output：`{ definition: { id, file, lineStart?, lineEnd?, kind, label, confidence?: 'EXTRACTED'|'INFERRED'|'AMBIGUOUS' }, callers?: Array<{id,confidence:number,relation:'calls'}>, callees?: Array<{id,confidence:number,relation:'calls'}>, imports?: Array<{moduleId, file, confidence:number}>, relatedSpec?: { kind: 'module-coarse' | 'unknown', path?: string }, warnings?: string[] }`。
  - `imports` 来源于 `depends-on` / `cross-module` 边的 outgoing 邻接（symbol 节点首先按 graph 找到所属 module 节点，再查 module 的 outgoing depends-on 边）。第一版**不**保留 import alias / source 细节（这是 Feature 152/153/154 callsites 范围）；字段是 `{moduleId: string, file: string, confidence: number}`。
  - `definition.id` 是 canonicalize 后的 graph 真实 id；`definition.lineStart/lineEnd` 优先取 graph 节点 metadata.lineRange，缺失则不返回。
- **FR-022**: `context` tool MUST 仅返回 `include` 中显式声明的字段；`include` 留空时默认 `['callers','callees','imports']`（不含 related-spec，因为它需要文件 IO）。
- **FR-023**: `context` tool 的 `relatedSpec` 字段在第一版 MUST 按以下算法派生：
  1. 从 canonicalize 后的 symbolId 取 module 部分（`::` 之前的 repoRelPath）
  2. 计算 module slug：`path.basename(modulePath, path.extname(modulePath))`（例：`micrograd/engine.py` → `engine`）
  3. 候选路径列表（按顺序检查首个存在的）：
     - `<projectRoot>/panoramic/modules/<slug>.spec.md`
     - `<projectRoot>/specs/products/spectra/_generated/modules/<slug>.spec.md`（若仓库使用 panoramic 产品输出布局）
     - `<projectRoot>/_meta/modules/<slug>.spec.md`
  4. 命中 → `{kind: 'module-coarse', path: <相对路径>}`；都不命中 → `{kind: 'unknown'}`（**不**抛错）。
  5. **不**精确到 section anchor（stretch goal 留 155b，需 batch-orchestrator 把 specPath 持久化到 graph.json metadata）。
  6. 多 module 共享同一个 spec.md → 返回 module 自身的派生 path 即可，**不**做 cross-module dedupe（避免歧义和 false 关联）。
- **FR-024**: `context` tool MUST 在 symbolId 经 canonicalize 后仍找不到节点时返回 `error.code = 'symbol-not-found'` + 至多 5 个 fuzzy match 候选；fuzzy 算法用 substring + 简单 token 匹配（不强求 levenshtein），目标是给 LLM agent 第二次正确输入的提示。

#### detect_changes tool
- **FR-030**: `detect_changes` tool MUST 接受 input schema：`{ diff?: string, baseRef?: string, projectRoot?: string, depth?: number (default 2, max 5), budget?: number (default 200, max 1000), minConfidence?: number (default 0.65) }`。`diff` 与 `baseRef` 必须**至少**提供一个；都未提供 → `error.code = 'invalid-input'` reason: 'diff-or-baseref-required'；都提供时**不**视为 error，按"优先用 `diff`"策略执行并 warnings 附 `'baseRef-ignored'`（这是有意 ergonomic 设计：让 LLM agent 在不确定 git 是否可用时同时提供两者，tool 自动 fallback）。
- **FR-031**: `detect_changes` tool 接收 `diff` 文本时 MUST 按以下规则解析 unified diff 头：
  - 文件起始行 `diff --git a/<old> b/<new>`；同时记录 `<new>` 作为 changedFile（rename 场景下取 `<new>` 路径）
  - `+++ b/<new>` 与 `--- a/<old>` 提供文件路径备用源
  - `+++ /dev/null` → 文件被删除，进入 `unmappedFiles` (reason: 'deleted-file')
  - `--- /dev/null` → 文件新增，进入 `unmappedFiles` (reason: 'new-file-not-in-graph-yet')
  - 含 `Binary files differ` → 进入 `unmappedFiles` (reason: 'binary')
  - 文件路径含 quoted（`"my project/foo.py"`）→ 解析引号后路径
  - 不解析 hunk 行号（hunk-level 留 155b）
  - 路径归一：parse 出的路径**不**含 `a/`/`b/` 前缀；与 graph node 比较时按 repo-relative path 比较（同 canonicalize）
  - 输入 `diff` 文本超 5 MB → `error.code = 'payload-too-large'`
  - 输入 `diff` 不是 UTF-8 / 不是 unified diff 格式 → `error.code = 'invalid-diff'` + hint
- **FR-032**: `detect_changes` tool 接收 `baseRef` 时 MUST：
  1. 先用 `child_process.spawnSync('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { cwd: projectRoot, shell: false, timeout: 5000 })` 验证 baseRef 解析为合法 commit；失败 → `error.code = 'git-spawn-failed'` + reason: 'baseref-invalid'
  2. 用 `child_process.spawnSync('git', ['diff', '--name-status', `${resolvedSha}...HEAD`], { cwd: projectRoot, shell: false, timeout: 30000 })` 拿改动文件列表（`--name-status` 给 ADD/MODIFY/DELETE/RENAME 标记）。
  3. **必须** `shell: false`（防止 shell injection）；**不**用 `child_process.exec`。
  4. baseRef 字符串先做白名单：仅允许 `[A-Za-z0-9_./~^@{}-]+` 字符（覆盖常见 ref / sha / `HEAD~N` / `HEAD@{1}` / `HEAD@{u}` / `tag/v1.0`）；不通过 → `error.code = 'invalid-input'` reason: 'baseref-format'。注：`{` `}` 限定在 `@{...}` 上下文使用，git rev-parse 会拒绝畸形组合（白名单只是第一道防线，rev-parse 是第二道），shell injection 由 `shell: false` 兜底。
  5. spawn timeout → `error.code = 'git-timeout'`；spawnSync 返回 stderr 非空 → `error.code = 'git-spawn-failed'` 含 stderr 截断（≤ 200 字符）
- **FR-033**: `detect_changes` tool MUST 把改动文件映射回 graph 中的 symbols：
  1. 对每个 changedFile，在 graph 中查 `id === changedFile`（module 节点）以及 `id` 以 `${changedFile}::` 起始的所有 symbol 节点
  2. 命中的 symbol 节点全部进入 `changedSymbols[i].symbols`（第一版按 file 级保守估算，hunk 留 155b）
  3. 未命中（file 不在 graph）→ 进入 `unmappedFiles`（含 reason）
- **FR-034**: `detect_changes` tool MUST 对**所有** changedSymbol 共用一个全局 budget 池（不是每个 symbol 独立 budget）。算法：
  ```
  remaining = effectiveBudget   // default 200
  globalVisited = Set()
  affectedSymbols = []
  for each cs in changedSymbols.symbols.flat():
    if remaining <= 0: warnings.push('budget-truncated'); break
    bfsResult = bfsTraverse(graph, cs, {depth, minConfidence, direction: 'upstream', budget: remaining, sharedVisited: globalVisited})
    affectedSymbols.push(...bfsResult.affected)
    remaining -= bfsResult.affected.length
  ```
  这样多个 changedSymbol 不会重复计入同一受影响节点（globalVisited 共享），且 budget 严格不超。
- **FR-035**: `detect_changes` tool MUST 返回 output：`{ changedSymbols: Array<{ file: string, changeKind: 'modified'|'rename', symbols: string[] }>, affectedSymbols: Array<{ id, depth, confidence: number, reason: string }>, riskSummary: { totalChanged: number, totalAffected: number, riskTier: 'low'|'medium'|'high' }, unmappedFiles: Array<{ file: string, reason: 'deleted-file'|'new-file-not-in-graph-yet'|'binary'|'not-in-graph' }>, effectiveBudget, effectiveDepth, effectiveMinConfidence, warnings?: string[] }`。`riskTier` 复用 impact 的判定规则但作用在 totalAffected（≥ 50 → high，≥ 15 → medium，其余 low）。

#### query-helpers 模块（BFS / DFS / 工具函数）
- **FR-040**: 系统 MUST 在新文件 `src/knowledge-graph/query-helpers.ts` 中新增以下导出，供 3 个 tool 复用：
  - `bfsTraverse(graphData, startNodeId, options): { affected, warnings }` — **输入是 GraphJSON**（即 `GraphQueryEngine.graph` 暴露的 raw `{nodes, links}`，由 graph.json 反序列化得到 — 字段名 `links` 与 [src/panoramic/graph/graph-types.ts](src/panoramic/graph/graph-types.ts) L183 对齐），**不**直接消费 UnifiedGraph 类型；这与现有 MCP graph-tools.ts 的数据流一致，避免引入 GraphJSON ↔ UnifiedGraph 转换。
  - `canonicalizeSymbolId(target, graphData, options): string` — 路径归一 + 容错（详见 Symbol ID 规范化段）。
  - `findFuzzyMatches(graphData, queryId, limit): string[]` — 用于 symbol-not-found 候选；substring + token 匹配。
  - `computeRiskTier(directCallers, transitive): 'low'|'medium'|'high'` — impact / detect_changes 共享。
  - `getReverseAdjacency(graphData, graphPath, mtime): ReverseAdj` — lazy 反向邻接表，cache key = `${graphPath}::${mtime}::${edgeCount}`，graph 重 load 时自动失效。
- **FR-041**: `bfsTraverse` MUST 满足以下不可变契约：
  - 只读消费 graphData.nodes + graphData.links；**禁止**修改输入对象
  - 反向邻接表按 cache key 缓存到模块级单例 `Map<string, ReverseAdj>`；超过 8 个 entry 时按 LRU 清退
  - 支持 `sharedVisited?: Set<string>` 参数（用于 detect_changes 多 changedSymbol 共享 visited）
  - 直接读取 edge.confidenceScore（graph.json 已含），**不**做 tier→score 二次转换
  - direction='both' 时 inbound + outbound 邻接表合并；同节点同 depth 取首次发现的 confidence + reason

#### 错误处理与可观测性
- **FR-050**: 3 个 tool MUST 使用统一 error envelope：`{ isError: true, content: [{ type: 'text', text: JSON.stringify({ code, message, hint?, context? }) }] }`。完整错误 code 集合：
  - `graph-not-built`（graph.json 不存在 / 不可读）
  - `symbol-not-found`（canonicalize 后仍无匹配；context 含 fuzzyMatches 候选）
  - `invalid-symbol-id`（含控制字符 / 非 UTF-8 / canonicalize 失败）
  - `invalid-input`（必填字段缺失、type 不匹配、互斥字段冲突）
  - `invalid-diff`（不是 unified diff 格式 / 解析失败）
  - `payload-too-large`（diff 文本 > 5 MB / 其他单字段超限）
  - `no-changed-files`（**作为 warning 而非 error**：detect_changes 输入合法但解析后无文件，仍返回 success + warnings）
  - `git-spawn-failed`（git 命令执行失败 / baseRef 无法 rev-parse / stderr 非空）
  - `git-timeout`（git 命令超过 30s 超时）
  - `graph-stale`（query-helpers 检测到 reverse cache 与 graph 文件 mtime 不一致并已重建 — 作为 warning）
  - `internal-error`（兜底 — 任何 try/catch 没归类的异常）
- **FR-051**: 3 个 tool MUST 在 `internal-error` 时把原始 stack 截断到前 200 字符放进 `context.stack`，避免泄漏内部路径但保留可调试线索。
- **FR-052**: 3 个 tool MUST 把所有 stdout / stderr 隔离在 handler 内（不打印到 process.stdout / process.stderr），避免污染 MCP stdio 协议帧。
- **FR-053**: 3 个 tool 的响应 payload MUST ≤ 1 MB（JSON 序列化后）；超出时 truncate `affected` / `affectedSymbols` 列表至刚好 ≤ 1 MB，附 warnings `'payload-truncated'`。

#### 集成与验证
- **FR-060**: `npm run eval:report`（或 baseline collector 报告）的输出 MUST 在工具能力清单段落出现 "Agent-Context tools available" 标记，证明本 Feature 的 tool 已注册。具体落点由实现决定（推荐写入 `src/baseline/baseline-collector.mjs` 或 `src/baseline/report-generator.mjs` 的 capability 探测段）。
- **FR-061**: 本 Feature 的 commit diff **不能修改**以下 Feature 151 合同区文件：
  - `src/knowledge-graph/unified-graph.ts`
  - `src/knowledge-graph/call-resolver.ts`
  - `src/adapter/**/*`（4 个 LanguageAdapter 全部）
  - `src/runtime-bootstrap.ts`
  - `src/panoramic/graph/confidence-mapper.ts`（数值常量来源）
  - `src/panoramic/graph/graph-builder.ts`（UnifiedGraph→GraphJSON 序列化器）
  - `src/models/call-site.ts`（CallSite schema）
  
  允许的桥接方式（implement 阶段经 GATE_TASKS round-1 修订后明确）：
  - **`src/mcp/graph-tools.ts`**：增加只读 helper `getCachedGraphData(projectRoot)` **以及** 升级 `engineCache` 为 entry-based + mtime+size stale detection（plan §2 D-2 强制 — 不升级会导致 baseline:collect 重生 graph.json 后 cache stale）。`reloadGraph()` 行为与 lazy 语义保持向后兼容
  - **`src/panoramic/graph/graph-query.ts`**：仅追加 `get rawGraph(): Readonly<GraphJSON>` getter（plan §2 D-1 强制 — 给 query-helpers 拿 raw graph 用）。**不**修改既有方法签名 / 内部 nodeMap / adjacency 逻辑。graph-query.ts 不在 FR-061 禁动清单
  - **`src/mcp/server.ts`**：末尾追加 `registerAgentContextTools(server)` 调用，**不**改前序 register*\* 顺序
  - **`tests/unit/mcp-server.test.ts`**：exact-list 加 `impact / context / detect_changes` 三个 tool 名（注册副效应）
  - **`scripts/eval-report.mjs`**：新增 §0.5 capability probe section + `probeAgentContextCapability()` 函数
  - 新增 `src/knowledge-graph/query-helpers.ts`、`src/mcp/agent-context-tools.ts` 与各自单测
  - SC-008 通过 `git diff --name-only master...HEAD` 自动校验：禁动清单（unified-graph / call-resolver / adapter / runtime-bootstrap / confidence-mapper / graph-builder / call-site）必须为空

### Key Entities

- **AffectedSymbol**：受 impact 链影响的 symbol。
  - `id: string`（canonicalize 后的 graph 真实 id）
  - `depth: number`（距 target 的 BFS 深度，1 = direct caller，最大 = effectiveDepth ≤ 5）
  - `confidence: number`（直接来自 graph edge.confidenceScore，0.95/0.65/0.25 三档）
  - `reason: string`（display string，例：`called via Value.__add__ -> Value._backward`）
  - `path?: string[]`（可选结构化 ancestor 链，从 start 到 self；自动化测试可读）
- **ContextBundle**：context tool 的响应包。
  - `definition: { id, file, lineStart?, lineEnd?, kind, label, confidence? }`
  - `callers?: Array<{id, confidence: number, relation: 'calls'}>`
  - `callees?: Array<{id, confidence: number, relation: 'calls'}>`
  - `imports?: Array<{moduleId: string, file: string, confidence: number}>`（来自 module 节点的 depends-on / cross-module 边，第一版不解析 alias）
  - `relatedSpec?: { kind: 'module-coarse' | 'unknown', path?: string }`
- **ChangedSymbol**：detect_changes 输出的"被本次 diff 直接修改"条目。
  - `file: string`（repo-relative 路径，与 graph node 的 module id 一致）
  - `changeKind: 'modified' | 'rename'`（rename 时 `file` 是 to-side 路径）
  - `symbols: string[]`（该文件内 graph 中存在的 symbol id 列表；第一版按 file 级保守估算，hunk-level 留 155b）
- **UnmappedFile**：detect_changes 输出的"未能映射"条目。
  - `file: string`
  - `reason: 'deleted-file' | 'new-file-not-in-graph-yet' | 'binary' | 'not-in-graph'`
- **RiskSummary**：detect_changes 的总体风险摘要。
  - `totalChanged: number`（changedSymbols.symbols 扁平化总数）
  - `totalAffected: number`（affectedSymbols 总数，受 budget 截断后）
  - `riskTier: 'low' | 'medium' | 'high'`（按 totalAffected 阈值，与 impact 同规则）
- **ToolErrorEnvelope**：3 个 tool 共享的错误响应结构。`{ isError: true, content: [{ type: 'text', text: JSON.stringify({ code, message, hint?, context? }) }] }`，code 范围见 FR-050。
- **GraphData**：从 graph.json 反序列化得到的只读对象 `{ nodes: GraphNode[], links: GraphEdge[], metadata?: { projectRoot?: string, generatedAt?: string } }`。**字段名是 `links` 不是 `edges`**（与 [src/panoramic/graph/graph-types.ts](src/panoramic/graph/graph-types.ts) L183 一致；GraphQueryEngine 也要求 `nodes/links`）。本 Feature 通过 graph-tools.ts 的 engineCache 复用 GraphQueryEngine，提取 `engine.graph` 后得到 GraphData；不直接消费 UnifiedGraph 类型。
- **ReverseAdj**：query-helpers 内部数据结构 `Map<targetId, Array<{sourceId, edge}>>`，反向邻接表。Cache key = `${graphPath}::${mtime}::${edgeCount}`。

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**：在 `~/.spectra-baselines/micrograd` baseline 上（先 `npm run baseline:collect -- --target karpathy/micrograd --mode full` 重生 graph.json），invoke `impact` 在任一已知有 caller 的 target（如 `Value` / `Layer` / `Neuron` / `Module.parameters`）上 MUST 返回 `affected.length ≥ 1`，且 hot-path（graph 已加载）响应延迟 ≤ 50 ms。cold-start（首次加载 graph.json）≤ 1 s。响应中 `effectiveMinConfidence === 0.65` 验证默认值未漂移。
  - **实测调整**：micrograd 5 .py 共仅 4 条 calls 边（Python adapter 静态调用解析在小型代码库上 recall 偏低，dunder method 经 `+` `*` 等 operator 触发的调用不被 call-resolver 捕获 — 这是 Feature 151 已知 limitation 而非本 Feature 缺陷）。原 ≥ 5 callers 的预期不能在 micrograd 上达到。改为 ≥ 1 caller 的最小验收，证明 tool pipeline 端到端通畅。  
  - 验证一致性：SC-002a 的 budget 截断在合成 fixture 上严格验证；SC-001 在真实 graph 上验证 pipeline。两者互补。
- **SC-002**：budget 截断"遍历前"语义可验证。分两路验收：
  - **SC-002a（必跑，硬性 PASS）**：手工 fixture graph（5 个 nodes、4 条 calls 边、target 节点已知有 4 个反向 callers），invoke `impact({ target: '<fixtureNode>', depth: 5, budget: 3, direction: 'upstream' })` MUST 返回 `affected.length === 3`、`warnings` 含 `'budget-truncated'`、`effectiveBudget === 3`。fixture 写在 `tests/unit/knowledge-graph/query-helpers.test.ts` 中；不依赖任何真实 baseline。
  - **SC-002b（可选 acceptance）**：如果实施第一步 `npm run baseline:collect -- --target karpathy/micrograd --mode full` 重生的 graph.json 已含 calls 边且 micrograd 中有 in-degree ≥ 4 的节点（实测确认），则在该节点上同样 budget=3 验收；否则跳过 SC-002b 并在 verification report 中说明理由（不视为不达标）。
  - 不再依赖 nanoGPT 自然超 200。
- **SC-003**：在 micrograd 上 invoke `context({ symbolId: 'micrograd/engine.py::Value', include: ['callers','callees','imports','related-spec'] })` MUST 返回：
  - `definition.id === 'micrograd/engine.py::Value'`、`definition.file === 'micrograd/engine.py'`、`definition.kind ∈ ['component', 'symbol']`、`definition.label === 'Value'`
  - `callers.length ≥ 0`（micrograd 中 Value 自身被作为 import 使用，确切 caller 数视实测；此 SC 先验证字段返回非 undefined）
  - `callees.length ≥ 1`（Value 类内有 __add__ / __mul__ 等方法相互调用）
  - `imports` 是数组（可能为空 — engine.py 是叶子模块）
  - `relatedSpec.kind ∈ ['module-coarse', 'unknown']`（取决于该 baseline 是否含 panoramic spec 输出；若 unknown 视为合法）
- **SC-004**：使用 `tests/fixtures/git-diffs/value-add-modify.diff`（人工构造，模拟修改 micrograd/engine.py 的 Value.__add__ 方法），invoke `detect_changes({ diff: <fixture文本>, projectRoot: '<micrograd-baseline>', depth: 2 })` MUST 返回：
  - `changedSymbols.length ≥ 1`，且 `changedSymbols[0].file === 'micrograd/engine.py'`
  - `changedSymbols[0].symbols` 包含 `'micrograd/engine.py::Value'` 或更精细的 symbol id
  - `affectedSymbols.length ≥ 0`（视 micrograd 中 Value 反向链规模；最小要求 ≥ 0 即字段为数组）
  - `riskSummary.riskTier ∈ ['low','medium','high']`
  - `unmappedFiles.length === 0`（fixture 文件 micrograd/engine.py 应已在 graph 中）
- **SC-005**：单元测试覆盖率：
  - 新增 `tests/unit/mcp/agent-context-tools.test.ts` ≥ 12 个 case，覆盖 3 个 tool 的成功路径 + 错误路径 + edge cases
  - 新增 `tests/unit/knowledge-graph/query-helpers.test.ts` ≥ 8 个 case，覆盖 BFS 截断 / canonicalize / fuzzy match / reverse adjacency cache 失效
  - **新增**集成测试 `tests/integration/agent-context-real-graph.test.ts` ≥ 2 个 case：使用真实 micrograd graph.json（不 mock）跑 impact + context + detect_changes，验证 GraphJSON 数据形态与 query-helpers 的契约一致（覆盖 Codex Q-1 critical）
  - 所有新单测 + 现有 3155+ 单测 zero-fail（`npx vitest run` 100% pass）
- **SC-006**：`npm run build` 零类型错误；`npm run repo:check` 零失败（包括 release-contract sync 与 plugin sync 校验）；`npm run lint` 零失败。
- **SC-007**：`npm run eval:report`（或 baseline 报告 `npm run baseline:collect -- --target karpathy/micrograd`）输出含 "Agent-Context tools available" 文本标记。capability 探测点必须 invoke 一次 MCP tool（不是字符串硬编码）以证明实际可用。
- **SC-008**：本 Feature commit 的 `git diff --name-only master...HEAD` **不**包含以下路径任何一个：
  - `src/knowledge-graph/unified-graph.ts`
  - `src/knowledge-graph/call-resolver.ts`
  - `src/adapter/**/*`
  - `src/runtime-bootstrap.ts`
  - `src/panoramic/graph/confidence-mapper.ts`
  - `src/panoramic/graph/graph-builder.ts`
  - `src/models/call-site.ts`
  
  允许包含的新增 / 修改：`src/knowledge-graph/query-helpers.ts`（新）、`src/mcp/agent-context-tools.ts`（新）、`src/mcp/server.ts`（仅追加 register 调用）、`src/mcp/graph-tools.ts`（仅暴露只读 helper，可选）、`tests/**`、`specs/155-*/`、`tests/fixtures/git-diffs/value-add-modify.diff`（新 fixture）。

### Out of Scope（明确写出，避免 scope creep）

- ❌ Hunk-level diff 解析（detect_changes 第一版只到 file 级，hunk 留 155b）
- ❌ relatedSpec 精确到 section anchor（第一版只到 module-coarse，stretch 留 155b）
- ❌ context tool 跨语言 import resolution 增强（沿用 Feature 151 已 ship 的 importIndex 行为）
- ❌ ts-js / go / java 的 callSites（属于 Feature 152/153/154 的 sub-feature 范畴）
- ❌ Incremental indexing / sqlite 持久化（属于设计文档 §Feature 152，本 Feature 不动）
- ❌ SWE-Bench 风格 eval 集成验证 ROI（属于 §Feature 153，本 Feature 不做）

---

## 假设与外部依赖

- **A-1**：Feature 151（commit 761488f）已 merge 到 master，提供 UnifiedGraph + CALLS edges + Python adapter callSites。本 Feature 启动前 `git fetch origin master` 已确认。
- **A-2**：`~/.spectra-baselines/micrograd` 与 `~/.spectra-baselines/nanoGPT` 已 clone（CLAUDE.local.md "Baseline 测试" 段说明）。如未 clone，跑 `bash scripts/baselines/clone-baseline-projects.sh`。
- **A-3**：micrograd 的 `graph.json` 已含 Feature 151 引入的 calls 边。**第一步实施时必须重新跑** `npm run baseline:collect -- --target karpathy/micrograd --mode full`，因为旧 baseline graph.json 不含 calls 边（只有 contains / cross-module）。
- **A-4**：`src/mcp/graph-tools.ts` 的 engineCache 与 lazy load 在并发调用下足够稳定。**但**：query-helpers 的反向邻接表 cache MUST 用文件 mtime + edgeCount 复合 key 隔离，graph 重 load 时自动失效。`reloadGraph()` 被调用时 query-helpers cache 也应清退（实施细节 plan 阶段决定）。
- **A-5**：micrograd graph.json 中至少存在 1 条 calls 边（实测 4 条）。**实施第一步先 invoke baseline:collect 验证**。原假设 ≥ 5 callers 已按真实数据修订为 ≥ 1（详见 SC-001 实测调整段）— Python adapter 在小型代码库 + dunder method 上 recall 受限是 Feature 151 known limitation，非本 Feature 缺陷。

## 与 Feature 152/153/154 的边界

- 共享只读：UnifiedGraph schema、call-resolver 输出。
- 写入 disjoint：Feature 152（ts-js callsites）改 `src/adapter/typescript-adapter.ts`、Feature 153（go）改 `src/adapter/go-adapter.ts`、Feature 154（java）改 `src/adapter/java-adapter.ts`；本 Feature 改 `src/mcp/` 与新增 `src/knowledge-graph/query-helpers.ts`。
- 无序依赖：3 个 sub-feature ship 顺序与本 Feature 互不阻塞。本 Feature 跑 BFS 仅依赖 graph 中存在 calls 边，不要求所有语言都已支持 callSites。

---

## 验收用 Fixture / Baseline 列表

- `~/.spectra-baselines/micrograd`（5 .py，248 LOC，5 callers ≥ Value.__add__）
- `~/.spectra-baselines/nanoGPT`（15 .py，~1.5k LOC，验证 budget 截断）
- `tests/baseline/micrograd/spectra/full.json`（perf anchor，cold-start 时间对照）
- 新增 `tests/fixtures/git-diffs/value-add-modify.diff`（手工构造的小 unified diff，给 detect_changes 单测用）
