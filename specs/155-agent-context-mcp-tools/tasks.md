# Tasks Breakdown — Feature 155 Agent-Context MCP Tools

**Feature**: 155
**Branch**: 155-agent-context-mcp-tools
**Created**: 2026-05-08
**Spec**: [spec.md](spec.md)
**Plan**: [plan.md](plan.md)

---

## 任务总览

| Task | 标题 | 依赖 | 估计工时 | 验收 |
|------|------|------|---------|------|
| T-001 | query-helpers 核心模块 | — | 1.5 d | 单测 ≥ 8 case pass |
| T-002 | graph-tools 暴露 GraphData helper | — | 0.5 d | 类型导出 + 单测覆盖 |
| T-003 | agent-context-tools 3 handler | T-001, T-002 | 2 d | 3 handler 独立可调用 |
| T-004 | server.ts 注册集成 | T-003 | 0.25 d | tool list ≥ 3 个新 tool |
| T-005 | capability probe (FR-060) | T-004 | 0.5 d | eval:report 含标记 |
| T-006 | query-helpers 单测 | T-001 | 1 d | ≥ 8 case，零失败 |
| T-007 | agent-context-tools 单测 | T-003 | 1.5 d | ≥ 12 case，零失败 |
| T-008 | 集成测试（真实 graph） | T-007 | 0.5 d | ≥ 2 case，micrograd graph |
| T-009 | Fixtures（synthetic graph + diff） | T-006/T-007 | 0.5 d | fixtures 有效 + 单测引用 |
| T-010 | 重生 micrograd baseline | T-004 | 0.25 d | graph.json 含 calls 边 |
| T-011 | Acceptance（SC-001 ~ SC-008） | T-010 | 1 d | 全 SC PASS |
| T-012 | verification-report.md | T-011 | 0.5 d | 报告完整 |
| T-013 | Codex round-3 final review | T-012 | 0.5 d | critical 全闭 |
| T-014 | deliverable report + push | T-013 | 0.25 d | 用户确认后 push |

**总计**：~12 工作日。可并行片段标记 [P]。

---

## 详细任务

### T-001：query-helpers 核心模块

**类型**：实现
**文件**：`src/knowledge-graph/query-helpers.ts`（新增）
**依赖**：无（纯 TS 模块，无外部依赖增加）
**估计**：1.5 d

**子任务**：
- T-001.1：定义 `BfsTraverseOptions` / `BfsTraverseResult` / `ReverseAdj` 类型
- T-001.2：实现 `getReverseAdjacency(graphData, graphPath, mtime)` — 按 cache key 复用，LRU ≤ 8
- T-001.3：实现 `bfsTraverse` — 严格按 FR-012 伪代码，遍历前 budget 截断，sharedVisited 支持
- T-001.4：实现 `canonicalizeSymbolId` — 路径归一（去 `./`, 去前导 `a/` `b/`, abs↔repo-relative）+ 三段容错（`A::B::C` → `A::B.C`）+ 控制字符 reject
- T-001.5：实现 `findFuzzyMatches` — substring + token 匹配（不强求 levenshtein），limit 默认 5
- T-001.6：实现 `computeRiskTier` — 按 FR-014 阈值（10/50, 3/15）

**验收**：
- 模块导出 6 个公开函数
- 类型定义清晰（无 `any`）
- 不引入新依赖（不加 levenshtein-edit-distance 等库）
- `npm run build` 0 type error

**风险**：
- canonicalize 三段容错算法需要细心，错误会导致 SC-001 fail
- LRU 实现选最简单 Map.delete + set（手写而非引入 lru-cache 库）

---

### T-002：graph-tools 扩展 GraphData helper + engineCache 升级

**类型**：扩展（含一处既有逻辑修改 — engineCache 升级）
**文件**：
- `src/panoramic/graph/graph-query.ts`（**追加** `get rawGraph()` getter，D-1）
- `src/mcp/graph-tools.ts`（engineCache 升级 + 新增 `getCachedGraphData` helper，D-2）
**依赖**：无
**估计**：1 d（含回归测试）

**子任务**：
- T-002.1：在 [src/panoramic/graph/graph-query.ts](src/panoramic/graph/graph-query.ts) 类 GraphQueryEngine 末尾追加 `get rawGraph(): Readonly<GraphJSON> { return this.graph; }`
- T-002.2：升级 `engineCache` 类型为 `Map<projectRoot, { engine, graphPath, mtimeMs, sizeBytes }>`，`getEngine` 内 stat graph.json 校验 mtime+size 一致性，stale → reload
- T-002.3：实现 `getCachedGraphData(projectRoot): { graphData: GraphJSON, graphPath, mtimeMs, sizeBytes } | null`，graph.json 不存在 / 异常 → null（不抛错）
- T-002.4：保留 `reloadGraph()` 行为（仍然 evict 全部）
- T-002.5：扩展现有 graph-tools 单测：
  - 测试 stale detection（mock fs.statSync 返回不同 mtime → getEngine 重 load）
  - 测试 size 变化触发 reload（同 mtime 但不同 size）
  - 现有 6 个 tool 单测全部回归 pass

**验收**：
- D-1 getter 不破坏既有 GraphQueryEngine 公开 API（既有 query / getNode / shortestPath 等方法签名不变）
- engineCache 升级**仅**在 stale 时改变行为；fresh cache 命中行为与之前一致
- 现有 [tests/unit/graph-tools-v2.test.ts](tests/unit/graph-tools-v2.test.ts) / 类似全 pass
- 新增 ≥ 2 个 stale-detection 单测

**风险**：
- 误改 engineCache 行为 → 影响 graph_query 等 6 个现有 tool。每改一行都要跑现有单测
- D-1 getter 加了之后，未来 GraphQueryEngine 改动可能影响 query-helpers — 留意但低概率

---

### T-003：agent-context-tools 3 handler

**类型**：实现
**文件**：`src/mcp/agent-context-tools.ts`（新增）
**依赖**：T-001, T-002
**估计**：2 d

**子任务**：
- T-003.1：定义 `registerAgentContextTools(server)` 函数 + Zod schema for 3 tools
- T-003.2：实现 `handleImpact(args)` — 含 input 校验、canonicalize、bfsTraverse 调用、riskTier 计算、effective* 字段回传、warnings 收集、错误响应
- T-003.3：实现 `handleContext(args)` — definition 提取（从 graph node metadata）、callers/callees 邻接遍历（depth=1）、imports 从 module 节点 outgoing depends-on/cross-module 边获取、relatedSpec 路径派生
- T-003.4：实现 `handleDetectChanges(args)` — diff/baseRef 互斥处理、parseDiff（unified diff 头解析 + rename/delete/binary 处理）、spawnGitDiff（baseRef 白名单 + rev-parse + spawnSync shell:false + timeout）、changedFile→symbols 映射、跨 changedSymbol 共享 budget BFS、riskSummary 计算、unmappedFiles 聚合
- T-003.5：实现 `buildErrorResponse(code, message, hint?, context?)` — 统一 error envelope
- T-003.6：实现 `enforcePayloadCap(response, capBytes=1MB)` — payload 超限时 truncate + warnings

**验收**：
- 3 handler 独立可 unit test
- 错误 path 覆盖 11 个 error code
- 不打印到 process.stdout / stderr（FR-052）

**风险**：
- parseDiff 在 rename / 引号路径 / binary 等边界场景容易写错 → 必须 fixture 驱动
- spawnSync 跨平台行为差异（Windows 的 git 路径）→ 测试在 macOS / Linux 跑

---

### T-004：server.ts 注册集成

**类型**：集成
**文件**：`src/mcp/server.ts`（修改：append 1-2 行）
**依赖**：T-003
**估计**：0.25 d

**子任务**：
- T-004.1：import `registerAgentContextTools`
- T-004.2：在 `registerGraphTools(server)` 调用之后追加 `registerAgentContextTools(server)`

**验收**：
- diff ≤ 3 行
- 现有 mcp-server.test.ts 全 pass
- 跑 server smoke test，tool list 含 `impact / context / detect_changes`

---

### T-005：capability probe（FR-060）

**类型**：集成
**文件**：待 grep 决定（候选：`src/baseline/report-generator.mjs` / `src/cli/commands/eval-report.mjs` / `src/baseline/baseline-collector.mjs`）
**依赖**：T-004
**估计**：0.5 d

**子任务**：
- T-005.1：grep 仓库找 `eval:report` 实际跑哪个文件 / 函数
- T-005.2：在 capability 探测段（或新增）invoke MCP server tool list（或检查 server.tool 调用记录），如果 impact/context/detect_changes 都注册 → 写入报告 "Agent-Context tools available"
- T-005.3：编写或扩展现有报告测试，验证标记存在

**验收**：
- `npm run eval:report` 输出含 "Agent-Context tools available"
- 不修改其他报告字段

**风险**：
- 找不到 eval:report 落点 → 退化为在 baseline-collector 内做 capability probe，作为 markdown report 注入

---

### T-006：query-helpers 单测 [P]

**类型**：测试
**文件**：`tests/unit/knowledge-graph/query-helpers.test.ts`（新增）
**依赖**：T-001
**估计**：1 d

**Case 列表（≥ 8）**：
- C-001：bfsTraverse depth=2 直接返回 callers
- C-002：bfsTraverse budget=3 强制截断，warnings 含 'budget-truncated'，affected.length === 3（合成 fixture，4 callers）
- C-003：bfsTraverse depth=0 返回空 affected
- C-004：bfsTraverse minConfidence=0.95 仅留 EXTRACTED 边
- C-005：bfsTraverse direction='downstream' 走正向
- C-006：bfsTraverse cycle 不膨胀（A→B→A）
- C-007：canonicalizeSymbolId 三段输入容错（A::B::C → A::B.C）
- C-008：canonicalizeSymbolId 控制字符 reject
- C-009：findFuzzyMatches limit=5 + substring 命中
- C-010：computeRiskTier 阈值边界（directCallers=10 → high）
- C-011：getReverseAdjacency cache 命中 + mtime 失效重建
- C-012：bfsTraverse sharedVisited 跨调用去重

**验收**：
- ≥ 8 case，目标 12
- 每 case 独立可读，命名 Given/When/Then 风格
- `npx vitest run tests/unit/knowledge-graph/query-helpers.test.ts` 100% pass

---

### T-007：agent-context-tools 单测 [P]

**类型**：测试
**文件**：`tests/unit/mcp/agent-context-tools.test.ts`（新增）
**依赖**：T-003
**估计**：2 d（floor 提升到 ≥ 18 case）

**Mandatory subset**（必须覆盖，非可选）：3 个 tool × 至少 6 case = 18 个，包括：
- impact tool 至少 6：成功路径 / symbol-not-found + fuzzy / depth clamp / budget clamp / minConfidence 全过滤 / direction='both' 合并
- context tool 至少 6：成功 4 字段 / include 子集 / relatedSpec 命中 / relatedSpec unknown / canonicalize 容错 / definition lineRange 缺失
- detect_changes tool 至少 6：diff 文本成功 / baseRef 成功 / 互斥 invalid-input / rename diff / binary diff / baseRef 白名单 reject

加上通用错误（graph-not-built / internal-error / payload-truncated）= 21+ case 实际目标。

**Case 列表（≥ 12）**：

**impact tool**：
- C-101：成功 path（合成 graph，affected ≥ 3）
- C-102：target 不存在 → symbol-not-found + fuzzyMatches 候选
- C-103：depth=10 → clamp 到 5 + warnings 'depth-clamped'
- C-104：budget 超 1000 → clamp + warnings
- C-105：minConfidence=0.95 + 全 INFERRED → affected 空 + warnings 'confidence-filtered-all'

**context tool**：
- C-106：成功 path，include 全 4 字段
- C-107：include=['callers'] 只返 callers，其他字段 absent
- C-108：relatedSpec 命中 panoramic/modules/<slug>.spec.md → kind='module-coarse'
- C-109：relatedSpec 不命中 → kind='unknown'

**detect_changes tool**：
- C-110：成功 path（diff 文本，1 个 changedFile，affected ≥ 1）
- C-111：rename diff（rename from a.py → b.py），changedFile = b.py
- C-112：binary diff → unmappedFiles 含 reason='binary'
- C-113：diff 与 baseRef 都缺 → invalid-input
- C-114：diff 与 baseRef 都给 → 优先 diff + warnings 'baseRef-ignored'
- C-115：baseRef 含非法字符（"foo;rm -rf"）→ invalid-input reason='baseref-format'
- C-116：baseRef rev-parse fail → git-spawn-failed reason='baseref-invalid'
- C-117：empty diff → success + warnings 'no-changed-files'

**通用 / error**：
- C-118：graph.json 不存在 → graph-not-built（任意 tool）
- C-119：handler throw → internal-error + context.stack 截断
- C-120：payload 超 1MB → truncate + warnings 'payload-truncated'

**验收**：
- ≥ 12 case（目标 20）
- mock `getCachedGraphData` + `spawnSync`
- `npx vitest run tests/unit/mcp/agent-context-tools.test.ts` 100% pass

---

### T-008：集成测试（真实 graph） [P]

**类型**：测试
**文件**：`tests/integration/agent-context-real-graph.test.ts`（新增）
**依赖**：T-007, T-010
**估计**：0.5 d

**Case 列表（≥ 2）**：
- C-201：加载 micrograd 真实 graph.json，调 impact + context + detect_changes，验证 GraphJSON 字段名 `links`、affected 字段类型与契约一致
- C-202：跨工具协同：先 detect_changes 拿到 changedSymbols，再对其中之一 invoke impact 验证返回相同 affectedSymbols 子集

**验收**：
- 不 mock graph，确实读 `~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json`
- 若该路径不存在（CI 没 baseline）→ skip 并标 '环境缺失' 而非 fail（参考现有 baseline 类测试）

---

### T-009：Fixtures [P]

**类型**：fixture
**文件**：
- `tests/fixtures/graph-fixtures/synthetic-budget.json`（新）
- `tests/fixtures/git-diffs/value-add-modify.diff`（新）
**依赖**：T-006, T-007 编写时同步
**估计**：0.5 d

**子任务**：
- T-009.1：synthetic-budget.json — 5 nodes（target + 4 callers），4 条 calls 边，target node 有 4 个 in-edges，用于 SC-002a 验收
- T-009.2：value-add-modify.diff — 手工 unified diff，模拟修改 micrograd/engine.py 的 Value.__add__ 方法（删除若干行 + 添加若干行），diff header 格式正确

**验收**：
- 两个 fixture 被 T-006 / T-007 测试引用
- diff 可被 `git apply --check` 通过（验证格式有效）

---

### T-010-preflight：micrograd baseline preflight（含 calls 边）

**类型**：环境
**命令**：`npm run baseline:collect -- --target karpathy/micrograd --mode full`
**依赖**：无（**应在 T-001 之前跑**，给 T-008 集成测试提供数据）
**估计**：0.25 d（实际跑 ~3 分钟，含 LLM 调用 + verify）

**子任务**：
- T-010p.1：跑 baseline:collect 重生 graph.json
- T-010p.2：jq 验证 `.links[] | select(.relation == "calls") | length > 0`（**必须** ≥ 1 条 calls 边）
- T-010p.3：jq 验证 `.links[] | select(.relation == "calls") | .confidenceScore | type == "number"`

**验收**：graph.json 含 calls 边且 confidenceScore 字段完整。**否则不能进入 T-008**（集成测试会假性通过）。

### T-010-final：acceptance 前刷新

**类型**：环境
**命令**：同上
**依赖**：T-005（capability probe 已实施再跑，确保最新 server 已 registered）
**估计**：0.25 d

**子任务**：
- T-010.1：跑 baseline:collect 重生 graph.json
- T-010.2：验证 `tests/baseline/micrograd/spectra/full.json`（perf anchor）是否需要更新

**验收**：
- `~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json` 含 ≥ 1 条 `relation: 'calls'` 边（jq 验证）
- 旧的 perf anchor 在合理范围（不超 +20% 时间退化）

**风险**：
- LLM cost ~$0.55 / run；如果失败需要重跑
- baseline 跑过程中其他 worktree 改动文件可能影响输出

---

### T-011：Acceptance（SC-001 ~ SC-008）

**类型**：验收
**文件**：`specs/155-agent-context-mcp-tools/verification/acceptance-runner.md` + 实际 invoke
**依赖**：T-010
**估计**：1 d

**子任务**：按 spec.md SC-001 ~ SC-008 逐条验证：
- T-011.1：SC-001 micrograd impact tool 返回 ≥ 1 caller + ≤ 50 ms hot-path（实测调整后阈值，详见 verification-report）
- T-011.2：SC-002a 合成 fixture budget=3 强截断
- T-011.3：SC-002b（可选）micrograd budget=3 强截断
- T-011.4：SC-003 context tool definition + 字段
- T-011.5：SC-004 detect_changes 在 fixture diff 上正确
- T-011.6：SC-005 单测覆盖率 ≥ 12 + ≥ 8 + ≥ 2 集成
- T-011.7：SC-006 build/lint/repo:check 0 失败
- T-011.8：SC-007 eval:report 含标记
- T-011.9：SC-008 git diff 不含合同区文件

**验收**：每条 SC 留可追溯的 evidence（命令 + 输出 + commit hash）

---

### T-012：verification-report.md

**类型**：报告
**文件**：`specs/155-agent-context-mcp-tools/verification/verification-report.md`（新）
**依赖**：T-011
**估计**：0.5 d

**章节**：
- 总体结论（READY-FOR-MERGE / NEEDS-FIX）
- SC-001 ~ SC-008 逐条 ✅/❌ + evidence
- Codex 对抗审查 round 1/2/3 结论汇总
- 工具链验证（vitest count / build / lint / repo:check）
- 已知 limitation（如 SC-002b 因 baseline 状态不达预期跳过）

**模板**：参考 `specs/151-knowledge-graph-python/verification/verification-report.md` 的格式

---

### T-013：Codex round-3 final review

**类型**：审查
**触发**：通过 Agent tool → `codex:codex-rescue`
**依赖**：T-012
**估计**：0.5 d

**审查目标**：
- 实现代码（src/knowledge-graph/query-helpers.ts + src/mcp/agent-context-tools.ts）
- 测试代码完整性（mock 不要漏关键 path）
- verification-report.md 是否真实达成所有 SC

**通过标准**：
- 0 critical
- ≤ 3 warning（且每条都有书面回应）

---

### T-014：deliverable report + push

**类型**：交付
**依赖**：T-013
**估计**：0.25 d

**子任务**：
- T-014.1：在 chat 列 deliverable report（按 CLAUDE.local.md "PUSH Origin Master 前列 Report" 模板）
- T-014.2：等待用户"确认 push"
- T-014.3：rebase master + ff-only merge + push origin master + 删 feature 分支

---

## 并行调度建议

| 阶段 | 并行组 |
|------|--------|
| Layer 1+2 | T-001（query-helpers）+ T-002（graph-tools helper） |
| Layer 5 | T-006（query-helpers test）+ T-009（fixtures） |
| Layer 5 | T-007（tools test）+ T-008（integration test） |
| Layer 6 | T-011 子条目可独立跑 |

---

## 任务依赖图（DAG）

```
T-001 ─┬─ T-003 ─┬─ T-004 ─ T-005 ─ T-010 ─ T-011 ─ T-012 ─ T-013 ─ T-014
T-002 ─┘         │
                 │
T-009 ─ T-006 ───┼─ T-007 ─ T-008 ────────────┘
                 │
                 └─ (T-008 also depends on T-010)
```

完成 T-014 即视为 Feature 155 ship。

---

## SC ↔ Task 映射（GATE_TASKS round-1 修订补充）

| SC | 验证任务 | Evidence |
|----|---------|----------|
| SC-001 | T-010-final + T-011.1 | micrograd impact ≥ 1 caller + ≤ 50 ms hot（修订阈值）|
| SC-002a | T-006 (C-002 case) + T-009 (synthetic-budget.json) + T-011.2 | 合成 fixture 强截断 |
| SC-002b | T-010-final + T-011.3（可选） | 真实 micrograd 实测 |
| SC-003 | T-007 (context tool 6 case) + T-011.4 | context 字段 + relatedSpec |
| SC-004 | T-007 + T-009 (value-add-modify.diff) + T-011.5 | detect_changes fixture diff |
| SC-005 | T-006 + T-007 + T-008 vitest count | ≥ 12 + ≥ 18 + ≥ 2 |
| SC-006 | T-011.7 | build / lint / repo:check |
| SC-007 | T-005 + T-011.8 | eval-report.mjs 标记 |
| SC-008 | T-011.9 + 自动 grep | git diff master...HEAD 不含合同区 |

---

## GATE_TASKS round-1 Codex 审查应对汇总（2026-05-08）

Codex 给出 3 CRITICAL + 15 WARNING + 7 INFO，本节追溯每条的处置：

### CRITICAL（全部已闭合）

- **D-1（GraphQueryEngine.graph private）**：plan §2 D-1 + §4.3 + §4.1 全部更新；T-002 子任务 1 明确加 `get rawGraph()` getter；FR-061 不含 graph-query.ts 故合规。
- **D-2（engineCache stale）**：plan §2 D-2 + §4.3 全部重写为"双层 cache 联动 + mtime + size 校验"；T-002 子任务 2-5 落地。
- **4.1（BfsTraverseOptions 缺字段）**：plan §4.1 加 `graphMtimeMs` `graphSizeBytes` `relations`（默认 `['calls']`）。

### WARNING（关键已闭合，少量留 implement 阶段决策）

- D-7 baseRef 白名单：spec FR-032 已加 `{}` 字符（覆盖 `HEAD@{1}`），并说明 rev-parse 是第二道防线
- B-1 文件清单数量：plan §3 已修正"新增 7 个" "修改 5 个"
- B-2 严禁修改清单：plan §3 已显式列 `src/knowledge-graph/index.ts` "不 re-export"约束（隐含在不动 unified-graph.ts 中）
- 4.2 import 路径：implement 阶段 import 自 `../panoramic/graph/graph-paths.js`（resolveGraphJsonPath 出处） — tasks T-003 子任务说明
- D-5 confidenceScore fallback：plan §5 R-2 改为"先尝试 edge.confidence 通过 CONFIDENCE_SCORES 映射，失败则跳过"，**不**用 0.5 魔数
- T-005 落点：plan §4.4 已锁 `scripts/eval-report.mjs`
- T-007 floor：tasks T-007 提升至 ≥ 18 + mandatory subset
- T-010 拆分：tasks 拆为 T-010-preflight（先跑）+ T-010-final（acceptance 前）
- M1/M3 重排：plan §6 里程碑 + tasks 并行调度建议表已支持 T-001+T-006 / T-003+T-007 配对
- D-4 false-positive：detect_changes 响应可加 `mappingGranularity: 'file'` 字段（implement 阶段在 FR-035 输出添加，已隐含在 spec output schema "warnings" 中）
- commit 策略：plan §9 每个 feat commit 含对应单测（implement 阶段强制）

### INFO（不修，记录）

- D-3 server.ts 注册顺序：mcp-server.test.ts exact-list 测试更新已纳入 plan §3 修改文件清单
- D-6 relatedSpec 多候选：T-007 加多候选同时存在测试
- T-009 fixture topology：T-009 子任务说明 4 callers + budget=3
- T-013 mid-implementation review：implement 第一阶段（T-003 完成）会触发一次 codex review（按 CLAUDE.local.md commit 前对抗审查约定，自然落地）
- 工时 12d → 15-18d：tasks 总工时表保留 12d 为 floor，遇到工时膨胀按 contingency 处理
