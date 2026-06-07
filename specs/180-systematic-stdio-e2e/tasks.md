# F180 — 系统性 stdio E2E 补齐：任务分解

**Feature**: F180  
**模式**: Story  
**状态**: 已完成（实现于 2026-06-08）  
**生成时间**: 2026-06-08

---

## 依赖关系总览

```
T-001（helper）
  └── T-002（build dist 确认）
        ├── T-003（graph-tools + listTools）
        ├── T-004（symbol-chain + fuzzy）
        ├── T-005（symlink-security）
        ├── T-006（telemetry）
        ├── T-007（error-envelope + graph-query-failed）
        ├── T-008（panoramic + namespace）
        ├── T-009（file-nav stdio）
        └── T-010（batch + reproducibility）
              └── T-011（实测复核 + 注释记录）
```

---

## 基础设施任务

### T-001：抽取共享 spawn helper（`tests/e2e/helpers/stdio-client.ts`）

**对应**: FR-016  
**依赖**: 无  
**优先级**: P0（其他所有测试任务的前置）

**内容**：
- 新建目录 `tests/e2e/helpers/`
- 实现 `spawnMcpClient(opts: SpawnMcpClientOpts): Promise<McpClientHandle>`
- `SpawnMcpClientOpts = { cwd: string; env?: Record<string, string> }`
- `McpClientHandle = { client: Client; transport: StdioClientTransport; cleanup: () => Promise<void> }`
- `cleanup` = `client.close()`，tempRoot 清理由调用方负责
- env 默认合并：`{ ...process.env, SPECTRA_DEV_DISABLE: '1', CI: '1', ...opts.env }`
- spawn 命令：`node dist/cli/index.js mcp-server`，`DIST_CLI` 路径从 `resolve('.')` 计算
- 导出常量：`DIST_CLI`、`BASELINE_GRAPH`、`MICROGRAD_SOURCE`、`buildSkipCondition(requireBaseline: boolean)`

**验收点**：
- TypeScript 编译零错误（`npm run build`）
- 不使用 `any` 类型
- 文件 < 80 行（过长说明抽象过度）

---

### T-002：构建 dist 确认（开发环境前置检查）

**对应**: FR-014 的前提条件  
**依赖**: T-001  

**内容**：
- 在实现阶段开始前执行 `npm run build`，确认 `dist/cli/index.js` 存在
- 确认 `~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json` 存在（若不存在，需先跑 baseline 收集）
- 此任务是环境检查，不写代码；但后续所有测试文件均依赖 dist 存在才能非 skip PASS

**验收点**：
- `existsSync(DIST_CLI)` 为 true
- `existsSync(BASELINE_GRAPH)` 为 true

---

## 测试文件任务（按分组）

### T-003：`feature-180-graph-tools.e2e.test.ts`

**对应 FR**: FR-001（graph 6 工具）、FR-009（listTools exact sorted names）  
**对应 Story**: #1、#8  
**依赖**: T-001、T-002  
**需要 baseline**: 是  

**spawn 配置**：一个共享 client（`cwd=tempRoot`，graph=baseline 拷贝），`beforeAll` 启动，`afterAll` 关闭 + 清理 tempRoot。

**用例列表**：

| 用例 ID | 断言内容 |
|--------|---------|
| T-003-1 | `listTools()` 返回名称集合（排序后）与实测真值精确匹配；结论写入注释（不写死数字，写 sorted names 数组） |
| T-003-2 | `impact` 工具 inputSchema：`target` 为 required，`direction` enum 含 `upstream`/`downstream`/`both` |
| T-003-3 | `graph_query` inputSchema 关键字段通过 SDK 序列化后仍存在（schema 不漂移） |
| T-003-4 | `graph_query` 合法调用（**必填 `question`**，非 `query`）：`isError` 不为 true，响应 JSON 可解析 |
| T-003-5 | `graph_node` 合法调用（传 `id` 或 `keyword`）：JSON 可解析，schema 关键字段存在 |
| T-003-6 | `graph_path` 合法调用（传 `source` + `target`）：JSON 可解析 |
| T-003-7 | `graph_community` 合法调用（传 `communityId`）：JSON 可解析 |
| T-003-8 | `graph_god_nodes` 合法调用（`limit?` 可选）：JSON 可解析，响应包含节点列表 |
| T-003-9 | `graph_hyperedges` 合法调用（`label?`/`node_id?`/`limit?` 均可选）：JSON 可解析不抛 |

> **Codex Plan-Warning-1 核对的真实入参名**（实现阶段以 `listTools()` inputSchema 复核）：`graph_query.question`(必) / `graph_node.id`|`keyword` / `graph_path.source`+`target` / `graph_community.communityId` / `graph_god_nodes.limit?` / `graph_hyperedges.label?`|`node_id?`|`limit?`。**各工具响应字段不要假设固定名（nodes/path/communities），实现阶段按真实输出断言**——T-003 的核心是「JSON 可解析 + isError 不为 true + schema 经 SDK 序列化保真」，而非猜字段。

**验收点**：所有用例在有 baseline + dist 时 PASS；无 baseline/dist 时整个 describe.skipIf 跳过并打印 skip reason。

---

### T-004：`feature-180-symbol-chain.e2e.test.ts`

**对应 FR**: FR-002（符号链透传）、FR-012（fuzzy resolve stdio）  
**对应 Story**: #2、#11  
**依赖**: T-001、T-002  
**需要 baseline**: 是  

**spawn 配置**：一个共享 client（`cwd=tempRoot`）。tempRoot 布局（Codex Plan-Critical-1/2）：`micrograd/nn.py` + `micrograd/engine.py`（从 MICROGRAD_SOURCE 拷入，repo-relative）+ `specs/_meta/graph.json`（baseline 拷贝 **+ 对 `micrograd/nn.py#MLP` node patch `metadata.lineRange={start,end}`**，因 Python node 无 lineRange，不 patch 则 view_file symbolId 静默降级前 200 行 = 假绿）。

**用例列表**：

| 用例 ID | 断言内容 |
|--------|---------|
| T-004-1 | `detect_changes` 传 nn.py diff（**header 必须 `a/micrograd/nn.py b/micrograd/nn.py`**，diff parser 剥 a/b 前缀后按 `micrograd/nn.py` 匹配 graph key，Codex Plan-Warning-2）→ `changedSymbols` 为数组；若全空则 fail 并打印原始响应（不静默跳过） |
| T-004-2 | 从 changedSymbols **显式选 component symbol**：`changedSymbols.flatMap(e=>e.symbols).find(id => id === 'micrograd/nn.py#MLP')` → 该 symbol 非空（**不取 `symbols[0]`**，可能是无 lineRange 的模块节点，Codex Plan-Critical-3） |
| T-004-3 | 将 T-004-2 symbol 传入 `context` → 响应 `definition.lineStart`/`definition.lineEnd` 为数字 |
| T-004-4 | 将同一 symbolId 传入 `view_file`（**`path` 传 tempRoot 相对 `micrograd/nn.py`、symbolId 传完整 `micrograd/nn.py#MLP`，绝不传 definition.file 绝对路径**）→ 返回 lineRange 与 context 的 `lineStart`/`lineEnd` 一致 |
| T-004-5 | `context` 传唯一简短名（如 `Value.relu`，无路径前缀）→ warnings 含 `fuzzy-resolved`，`resolvedFrom`/`resolvedTo` 透传 |
| T-004-6 | `impact` 传 typo 变体（如 `Value.reluu`）→ 允许 `symbol-not-found + fuzzyMatches` 或 `warnings fuzzy-resolved`，不强制单一结局（Codex W-6） |

**验收点**：T-004-1 空则 fail（打印响应）；T-004-4 lineRange 一致性（不是「内容包含片段」的模糊断言，而是 view_file 返回的 startLine/endLine 等于 context 的 lineStart/lineEnd）。

---

### T-005：`feature-180-symlink-security.e2e.test.ts`

**对应 FR**: FR-003（symlink 越界拦截）  
**对应 Story**: #3  
**依赖**: T-001、T-002  
**需要 baseline**: 否（仅需 dist）  

**spawn 配置**：独立 spawn（`cwd=tempRoot`，tempRoot 内建 symlink `./evil-link → /etc`，无 baseline graph）。

**用例列表**：

| 用例 ID | 断言内容 |
|--------|---------|
| T-005-1 | `view_file` 传 `path: '../../../etc/passwd'`（相对越界）→ `isError=true`，JSON 解析后 `code === 'path-outside-root'` |
| T-005-2 | `view_file` 传 symlink 路径（`evil-link/passwd`）→ `isError=true`，`code === 'path-outside-root'`，响应不含 `/etc` 内容 |

**特殊构造**：`beforeAll` 内 `symlinkSync('/etc', join(tempRoot, 'evil-link'))`；需确认运行环境有 `/etc`（macOS/Linux 成立）。

**验收点**：两用例均断言 `code === 'path-outside-root'`，不泄露外部内容。

---

### T-006：`feature-180-telemetry.e2e.test.ts`

**对应 FR**: FR-004（telemetry 落盘）、FR-017（afterEach 清理）  
**对应 Story**: #4  
**依赖**: T-001、T-002  
**需要 baseline**: 是（需要 graph 工具进入 handler）  

**spawn 配置**：**只能每 describe 块独立 spawn**，通过 `env` 注入不同 `SPECTRA_MCP_TELEMETRY_PATH`。Codex Plan-Warning-4 核对：telemetry 每次写入读子进程 `process.env.SPECTRA_MCP_TELEMETRY_PATH`，**运行中子进程无法由父进程改 env**——「callTool 前重置路径」方案不可行，已删除。3 个 describe（设 env 成功 / 设 env 失败 / 不设 env）各自 `beforeAll/afterAll` spawn；`afterEach` 删 JSONL。

> 备选（若不想 3 次 spawn）：固定同一 JSONL，断言「本次调用相对上次**新增恰 1 行**」而非「全文件恰 1 行」。实现阶段二选一，优先每 describe 独立 spawn（语义最清晰）。

**用例列表**：

| 用例 ID | 断言内容 |
|--------|---------|
| T-006-1 | 设 `SPECTRA_MCP_TELEMETRY_PATH + SPECTRA_MCP_RUN_ID=test-run-001`，调用 graph 工具成功 → JSONL 恰 1 行，JSON 含 `toolName`/`runId='test-run-001'`/`durationMs >= 0`/`requestSize`/`responseSize` |
| T-006-2 | 设同上 telemetry env，调用能进入 handler 的失败（如 `graph_query` 传不存在 `projectRoot` → graph-not-built）→ JSONL 行含 `errorCode`，值与响应 `code` 一致 |
| T-006-3 | **不设** `SPECTRA_MCP_TELEMETRY_PATH`，任意 callTool → 无 JSONL 文件产生 |

**注意**：T-006-2 的失败调用必须能进入 handler（不能是 SDK schema 校验拒绝的缺参调用），参见 EC-1。`graph_query` 传 `question: 'any'` 但 `projectRoot` 指向无 graph 的空目录，可触发 `graph-not-built`（进入 handler 后失败）。

**验收点**：「恰 1 行」断言 + `afterEach` 清理无跨用例污染。

---

### T-007：`feature-180-error-envelope.e2e.test.ts`

**对应 FR**: FR-005（server 5 工具错误 envelope）、FR-006（graph-query-failed 零覆盖闭合）  
**对应 Story**: #5  
**依赖**: T-001、T-002  
**需要 baseline**: 否（错误路径用失败入参 + malformed fixture，均无需真实 baseline）  

**spawn 配置**：两个独立 describe 块：
- 块 A：标准 spawn（`cwd=emptyDir`，无 graph），对 server 5 工具传失败入参
- 块 B：malformed graph spawn（`cwd=malformedRoot`，graph 缺 label），触发 graph-query-failed

**malformed graph fixture 规格**：`beforeAll` 内 `writeFileSync` 写入 JSON（`nodes[0]` 有 `id`/`kind`/`metadata` 但无 `label`，通过加载校验，查询期 `node.label.toLowerCase()` 抛错）。

**用例列表**：

| 用例 ID | 断言内容 |
|--------|---------|
| T-007-1 | `batch` 传不存在 `projectRoot` → `isError=true`，`code` 为 `internal-error` 或 `invalid-input`，响应 text 不含机器绝对路径（`/Users/` 或 `/home/`）及 `Error:` + `at ` stack 片段 |
| T-007-2 | `prepare` 传不存在路径 → 同上格式断言 |
| T-007-3 | `generate` 传不存在路径 → 同上格式断言 |
| T-007-4 | `diff` 传不存在 `specPath`/`sourcePath` → 同上格式断言 |
| T-007-5 | `panoramic-query` 传 `operation: 'cross-package'`，`projectRoot` 为非 monorepo 空目录 → `isError=true`，`code === 'invalid-input'` |
| T-007-6 | malformed graph spawn：`graph_query` 传合法 `question` → `isError=true`，`code === 'graph-query-failed'`（闭合 F177 warning #2） |

**脱敏验证正则**（T-007-1 到 T-007-5 共用）：

```typescript
expect(text).not.toMatch(/\/Users\/[a-z]+\//);
expect(text).not.toMatch(/\/home\/[a-z]+\//);
expect(text).not.toContain('Error:\n    at ');
```

**验收点**：T-007-6 的 `code === 'graph-query-failed'` 是 F177 warning #2 的直接闭合。

---

### T-008：`feature-180-panoramic-ns.e2e.test.ts`

**对应 FR**: FR-007（panoramic-query 4 operation）、FR-011（namespace 前缀路由）  
**对应 Story**: #6、#10  
**依赖**: T-001、T-002  
**需要 baseline**: 否（panoramic 失败路径 + namespace 测试均无需 baseline graph）  

**spawn 配置**：单一 spawn（`cwd=tempDir`，无 baseline graph）。

**用例列表**：

| 用例 ID | 断言内容 |
|--------|---------|
| T-008-1 | `panoramic-query` 传 `operation: 'natural-language'` 不传 `question` → `isError=true`，`code === 'invalid-input'` |
| T-008-2 | `panoramic-query` 传 `operation: 'cross-package'`，tempRoot 无 monorepo 配置 → `isError=true`，`code === 'invalid-input'` |
| T-008-3 | `panoramic-query` 传 `operation: 'overview'`，tempRoot 作 projectRoot → 响应结构可解析（成功或已知失败路径均记录结论） |
| T-008-4 | `panoramic-query` 传 `operation: 'architecture-ir'` → 实测结果（成功或 `invalid-input`）写入注释（Codex W-4：4 operation 不可漏） |
| T-008-5 | `client.callTool({ name: 'mcp__plugin_spectra_spectra__impact', arguments: {...} })` → 实测路由结果；若路由成功则断言响应结构；若 SDK 不支持则用 `skipIf + TODO` 记录已知边界（不强制 FAIL） |

**验收点**：T-008-5 的实测结论必须在注释中明确记录（SC-008）。

---

### T-009：`feature-180-file-nav-stdio.e2e.test.ts`

**对应 FR**: FR-008（file-nav stdio JSON-RPC 链路）  
**对应 Story**: #7  
**依赖**: T-001、T-002  
**需要 baseline**: 是（需要 micrograd 源文件 + graph，用于 symbolId→lineRange）  

**spawn 配置**：单一 spawn（`cwd=tempRoot`）。tempRoot 布局同 T-004（`micrograd/*.py` 相对拷入 + `specs/_meta/graph.json` baseline 拷贝 + 对目标 node patch lineRange）。

**用例列表**：

| 用例 ID | 断言内容 |
|--------|---------|
| T-009-1 | `view_file` 传 `path:'micrograd/nn.py', startLine=1, endLine=10`（相对路径）→ 响应行内容恰前 10 行，不多不少 |
| T-009-2 | `view_file` 传完整 `symbolId:'micrograd/nn.py#MLP'`（patch 过 lineRange 的 node）→ 响应 startLine/endLine 等于 patch 的 lineRange（**绝不传裸 `MLP`**，会因无 lineRange 静默降级前 200 行假绿，Codex Plan-Critical-1） |
| T-009-3 | `view_file` 传 `endLine` 超过总行数 → 当前实现是 **clamp 到 [1, totalLines] 优雅截断**（非 error，Codex Info-2 核对 sliceLines），断言截断后行数 ≤ 文件总行数 |
| T-009-4 | `view_file` 传完全越界相对路径 → `code === 'path-outside-root'` 或 `file-not-found` |
| T-009-5 | `search_in_file` 传有效 `path` + `pattern`（micrograd 文件中存在的字符串）→ 响应含匹配结果（行号 + 片段），JSON 可解析（**无 symbolId 入参**，Codex W-3） |
| T-009-6 | `list_directory` 传 tempRoot → 响应包含目录内文件名列表，JSON 可解析 |

**验收点**：T-009-1 行数精确断言；T-009-2 lineRange 精确（patch 值）；T-009-3 clamp 而非 error。

---

### T-010：`feature-180-batch-repro.e2e.test.ts`

**对应 FR**: FR-010（batch MCP 路径）、FR-013（reproducibility byte-stable）  
**对应 Story**: #9、#12  
**依赖**: T-001、T-002  
**需要 baseline**: 是（需要 micrograd source 拷贝到可写 tempRoot）  

**spawn 配置**：独立 spawn（`cwd=tempRoot`，将 micrograd source 完整拷贝到 tempRoot，server 可向 tempRoot 写 spec 产物）。

**实际约束（Codex Plan-Warning-3 实测确认）**：`runBatch` 始终调 `generateSpec → callLLM`，仅在 `LLMUnavailableError` 时 AST-only 降级；`mode:'code-only'` 只跳 enrichment 不跳首轮 LLM。故：
- T-010-1/-2（batch MCP 路径 smoke）：用 `languages:['python']` 缩到 micrograd 5 文件、timeout 放宽（如 120s），断言响应结构（isError 合理 + JSON 可解析 + `{mode:'incremental'}` 非法 enum 被拒）；**不深验 deltaReport 内容语义**。这组本身也建议 gate 在 `HAS_LLM_E2E` 之后（无 key 会走 LLMUnavailableError 降级或报错，行为不稳定）。
- T-010-4/-5（reproducibility byte-equal）：**gate 在 `process.env.HAS_LLM_E2E === '1'` skipIf 之后**（缺省 skip，keyless CI 不跑）。graph.json 是 AST 派生（F179 byte-stable，与 LLM 随机性无关），跑两次 full batch 需 LLM 可用才能完成落盘。byte-stable 进程内深测仍由 F179 既有测试覆盖；本 stdio 用例是环境允许时的叠加最强护栏。
- **实现阶段先实测**：本机 spawn 跑一次 micrograd python-only batch，确认能否完成 + 耗时，据此定 timeout 与是否启用 HAS_LLM_E2E。

**用例列表**：

| 用例 ID | 断言内容 | gate |
|--------|---------|------|
| T-010-1 | `batch { incremental: true, languages:['python'] }` → 响应 JSON 可解析、`isError` 合理（含 deltaReport 字段则更佳，不强求语义深验） | HAS_LLM_E2E |
| T-010-2 | `batch { full: true, languages:['python'] }`（regen 逃生口）→ 响应 `isError` 不为 true、走全量路径 | HAS_LLM_E2E |
| T-010-3 | `batch { mode: 'incremental' }`（非法 enum）→ 被 SDK schema 校验拒绝（**此用例无需 LLM，可不 gate**，纯校验 enum 契约边界） | 仅 dist |
| T-010-4 | 连续两次 `batch { full: true, mode: 'full', languages:['python'] }` → 两次 `specs/_meta/graph.json` 原始 Buffer `deepEqual`（byte-stable 最强护栏，F179 守卫） | HAS_LLM_E2E |
| T-010-5 | 若 T-010-4 原始 deepEqual 失败 → 经 `readNormalizedGraph` 归一化后 `deepEqual` 仍成立（兜底，独立 it） | HAS_LLM_E2E |

**验收点**：T-010-3 无 LLM 依赖必跑；T-010-4 是 F179 byte-stable 的 E2E 守护（环境允许时）；T-010-5 独立 it，T-010-4 失败时仍运行。

---

## 实测复核任务

### T-011：实测复核 + 注释记录（与 T-003 至 T-010 并行进行，非阻塞）

**对应**: SC-005、SC-008  
**依赖**: T-002  

**内容**：在实现过程中，对以下 4 个不确定点进行实测，并将结论写入对应测试文件的注释：

| 复核点 | 实测方式 | 记录位置 |
|--------|---------|---------|
| 工具注册真值（17 vs 18？） | `client.listTools()` 打印 sorted names | T-003-1 注释 |
| namespace 前缀路由支持性 | `client.callTool({ name: 'mcp__plugin_spectra_spectra__impact', ... })` | T-008-5 注释 |
| panoramic architecture-ir fixture 能力 | 传 tempRoot（无 monorepo）的响应 | T-008-4 注释 |
| batch LLM timeout 实测 | 计时，若 > 30s 则缩小 scope | T-010 describe 块注释 |

**验收点**：SC-008 要求所有注释在 PR 中明确记录，不留白。

---

## 任务执行顺序建议

```
阶段 1（基础设施）：
  T-001 → T-002

阶段 2（并行实现，各测试文件相互独立）：
  T-003、T-004、T-005、T-006、T-007、T-008、T-009、T-010
  （配合 T-011 实测复核，随实现进行）

阶段 3（验收）：
  npm run build（零错误）
  npx vitest run（零回归，有 baseline 环境下 FR-001 到 FR-018 [必须] 项全 PASS）
  npm run repo:check（零失败）
```

---

## 任务总计

| 类型 | 数量 |
|------|------|
| 基础设施任务 | 2（T-001、T-002） |
| 测试文件任务 | 8（T-003 至 T-010） |
| 实测复核任务 | 1（T-011） |
| **合计** | **11** |
| 新增文件数 | 9（1 helper + 8 测试） |
| 修改文件数 | 0（FR-018） |
