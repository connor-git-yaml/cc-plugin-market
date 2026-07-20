# Feature Specification: F180 — 系统性 stdio E2E 补齐

**Feature Branch**: `180-systematic-stdio-e2e`
**Created**: 2026-06-08
**Status**: Draft
**来源**: M7 Step-Back Revision 2（`docs/design/M7-stepback-revision-2.md` §2，用户 2026-06-07 拍板）
**前置依赖**: F179（graph.json byte-stable）、F181（import-resolver 单一权威收口）均已 ship

---

## 概述

### 背景与动机

现有 9 个 E2E 几乎全在进程内直调 handler（`handleViewFile` / `registerFileNavTools` / `runBatch` / `resolveSymbolFuzzy` 等），**没有经过真实 stdio 子进程 + JSON-RPC**。这意味着以下链路是系统性盲区：

- **schema 序列化漂移**：Zod schema 字段改名后进程内测试零感知，stdio 序列化后 SDK 拿到 undefined
- **错误 envelope 真实成形**：`buildErrorResponse` 在 JSON-RPC 链路下的实际序列化形态未被验证
- **telemetry env 落盘**：F177 核心 AC-2/AC-3 仅有 FakeMcpServer 进程内验证，从未跑真实 JSONL 落盘
- **namespace 前缀路由**：子代理发出带 `mcp__plugin_spectra_spectra__` 前缀的调用是否正确路由未经 stdio 验证
- **跨工具 symbolId 契约**：`detect_changes → impact → context → view_file` 链路中 symbolId 格式是否在子进程边界透传从未端到端测试

**F180 只补测试覆盖，不改任何生产代码。** 被测 MCP 工具均已 ship（F177/F178）；测试全程复用 `tests/integration/mcp-server-stdio.test.ts` 现成 transport（`@modelcontextprotocol/sdk` Client + StdioClientTransport spawn `dist/cli/index.js mcp-server`）+ micrograd baseline gate。

### 实现基座约定

- **transport**：`@modelcontextprotocol/sdk` `Client` + `StdioClientTransport`，spawn `node dist/cli/index.js mcp-server`
- **baseline gate**：micrograd graph（`~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json`）缺失则 `skipIf`，CI 友好（**F215 已修订，见文末 Amendment**）
- **测试文件后缀**：`*.e2e.test.ts`，放置于 `tests/e2e/` 目录
- **测试规范**：vitest；不用 `any`；Mock 标类型；异步用 `async/await`；每用例独立

---

## User Stories（12 条，按优先级排列）

### User Story 1 — graph 6 工具各经 stdio 子进程验证（Priority: P1）

用户故事：作为回归测试套件，当 graph_query/graph_node/graph_path/graph_community/graph_god_nodes/graph_hyperedges 各经 `client.callTool` 子进程调用后，期望 JSON 可解析、关键字段存在、schema 不发生漂移。

**优先级理由**：graph 工具是 Spectra MCP 核心能力，覆盖最高使用频率场景；schema 漂移类 bug 在 in-process 测试下完全不可见，必须通过真实 stdio 链路暴露。

**独立测试方法**：构造 micrograd tempRoot，启动子进程，对 6 个 graph 工具各发出 1 次 `callTool`，检查响应可 JSON 解析 + 关键字段（`nodes`/`edges`/`path`/`communities` 等）存在。

**Acceptance Scenarios**:

1. **Given** micrograd baseline graph.json 存在 + dist 已构建，**When** `client.callTool({ name: 'graph_query', arguments: { question: '...' } })` 经 StdioClientTransport（Codex 核对真实必填入参是 **`question`** 不是 `query`），**Then** 响应 JSON 可解析，`isError` 不为 true，schema 关键字段非 undefined

> **graph 6 工具真实入参名（Codex Plan 阶段核对 graph-tools.ts）**：`graph_query.question`(必) / `graph_node.id`|`keyword` / `graph_path.source`+`target` / `graph_community.communityId` / `graph_god_nodes.limit?` / `graph_hyperedges.label?`|`node_id?`|`limit?`。实现阶段以 `client.listTools()` 暴露的 inputSchema 为准复核。
2. **Given** 同上，**When** 对其余 5 个 graph 工具（graph_node/graph_path/graph_community/graph_god_nodes/graph_hyperedges）各发出合法调用，**Then** 每个工具均返回 JSON 可解析响应，且关键输出字段（工具定义 Zod schema 中 REQUIRED 的字段）存在

---

### User Story 2 — 跨工具 symbolId 链式透传在 stdio 链路成立（Priority: P1）

用户故事：作为回归测试套件，当 micrograd baseline 上执行 `detect_changes → impact → context → view_file` 完整链路时，期望前置工具返回的 symbol 标识可直接传入后续工具，且 `view_file` 返回的行范围与 `context` 返回的 definition 行号一致。

**优先级理由**：跨工具 symbol 标识格式是 agent-context 工具组的核心契约；任何序列化、路径分隔符或 schema 变更都可能悄悄打断这条链路，in-process 测试无法捕获子进程 cwd 差异。

**独立测试方法**：顺序调用 4 个工具。注意真实返回结构（Codex C-1 核对源码）：`detect_changes` 返回 `changedSymbols: Array<{ file, changeKind, symbols: string[] }>`（**无 symbolId 字段**），从中取 `changedSymbols.find(c => c.symbols.length > 0)?.symbols[0]`；`context` 的 `definition` 含 `lineStart/lineEnd`（**非 startLine**）。fixture 固定选用已证明 symbols 非空的 diff（如 micrograd/nn.py），避免 detect_changes 返回空导致链断。

**Acceptance Scenarios**:

1. **Given** micrograd baseline 已就位，**When** `detect_changes` 传入 micrograd/nn.py diff 后取 `changedSymbols.find(c => c.symbols.length > 0)?.symbols[0]`，**Then** 该 symbol 名非空，可被 `context` 的 canonicalize 解析（直接传入 `context`/`impact` 不报 symbol-not-found）
2. **Given** 从 detect_changes 拿到的 symbol 名，**When** 传入 `context`，**Then** 响应含 `definition.lineStart`/`definition.lineEnd`（数字），且该行号区间可传入 `view_file` 的 `startLine`/`endLine`
3. **Given** 从 context 拿到的 `definition.lineStart`/`lineEnd`，**When** 传入 `view_file`（startLine/endLine 指向同一文件），**Then** 返回内容包含 context 中 definition 对应的代码片段（行范围一致）

> **链断 fallback**：若所选 diff 的 `changedSymbols` 全为空（symbols 数组皆空），测试 fail 并打印 detect_changes 原始响应（暴露 diff fixture 与 graph 不匹配），不静默跳过。

---

### User Story 3 — symlink 越界在 stdio 子进程 cwd 解析下被正确拦截（Priority: P1）

用户故事：作为回归测试套件，当通过 stdio 子进程调用 `view_file` 并传入越界路径（`../../../etc/passwd`）或在 tempRoot 内创建指向外部的 symlink 后，期望均返回 `path-outside-root` 错误，且子进程 cwd/projectRoot 解析行为与 in-process 行为一致。

**优先级理由**：symlink 安全绕过是已知风险（W-4 曾暴露），子进程 cwd 与 in-process import 时的路径解析行为存在差异，必须在真实 stdio 链路下验证。

**独立测试方法**：在 tempRoot 内建 symlink 指向 `/etc`，通过 StdioClientTransport 调用 view_file，断言响应 code === 'path-outside-root'。

**Acceptance Scenarios**:

1. **Given** stdio 子进程 cwd=tempRoot，**When** `view_file` 传入 `path: '../../../etc/passwd'`（相对越界），**Then** 响应 `isError=true`，JSON 解析后 `code === 'path-outside-root'`
2. **Given** tempRoot 内存在 symlink `./evil → /etc`，**When** `view_file` 传入该 symlink 路径，**Then** 响应 `isError=true`，`code === 'path-outside-root'`，不泄露 `/etc` 的实际内容

---

### User Story 4 — F177 telemetry 在真实 stdio 子进程中落盘验证（Priority: P1）

用户故事：作为回归测试套件，当 stdio 子进程设置 `SPECTRA_MCP_TELEMETRY_PATH` + `SPECTRA_MCP_RUN_ID` 环境变量并调用 MCP 工具后，期望 JSONL 文件恰写 1 行（成功调用），且字段 `toolName/runId/durationMs/requestSize/responseSize` 正确；对能进入 handler 的失败调用（如 graph-not-built），期望 JSONL 额外含 `errorCode`。

**优先级理由**：F177 核心验收标准 AC-2（telemetry 字段完整性）和 AC-3（错误调用含 errorCode）此前仅有 FakeMcpServer 进程内验证，真实 JSONL 落盘链路从未端到端测试。闭合 F177 最重要的盲区。

**独立测试方法**：子进程设 env 变量，调用 server 工具或 graph 工具，调用结束后读取 JSONL 文件，断言行数与字段。

**Acceptance Scenarios**:

1. **Given** 子进程设 `SPECTRA_MCP_TELEMETRY_PATH=<tmp>/test-telemetry.jsonl` + `SPECTRA_MCP_RUN_ID=test-run-001`，**When** `client.callTool` 发出一次合法 graph 工具调用（graph 已建），**Then** JSONL 文件**恰好有 1 行**，JSON 解析后含 `toolName`（与调用工具名一致）、`runId=test-run-001`、`durationMs`（`typeof === 'number' && >= 0`，快路径可能为 0，Codex W-2 核对 telemetry.ts:80-85）、`requestSize`（数字）、`responseSize`（数字）
2. **Given** 同上 telemetry env，**When** 调用一个能进入 handler 但返回失败的调用（如 graph 工具传入不存在的 projectRoot → graph-not-built，或 panoramic-query 传入非 monorepo → invalid-input），**Then** JSONL 行额外含 `errorCode`，值与响应 `code` 一致
3. **Given** 子进程**未设** `SPECTRA_MCP_TELEMETRY_PATH`，**When** 任意 callTool，**Then** 无 JSONL 文件产生（no-op 路径）

---

### User Story 5 — server 5 工具 + graph-query-failed 错误 envelope 经 stdio 验证（Priority: P1）

用户故事：作为回归测试套件，当通过 stdio 子进程对 `prepare/generate/batch/diff/panoramic-query` 传入失败入参，以及对 graph 工具触发 engine 加载成功后查询期异常时，期望返回统一 `{code}` 错误 envelope，`isError=true`，且不泄露绝对路径或 stack trace。

**优先级理由**：F177 迁移了全套 `{code}` 错误 envelope，但 server 5 工具的错误路径从未经 stdio 链路验证；`graph-query-failed` 错误码在 `tests/` 下**零覆盖**（F177 审查 warning #2，此处一并闭合）。

**独立测试方法**：对每个 server 工具传入必然失败的入参（如 prepare 传不存在路径），断言响应结构符合 `{isError: true, content: [{text: '{"code":"...","message":"..."}'}]}`，且 text 中不含绝对路径 `/Users/` 或 `Error:` stack 片段。

**Acceptance Scenarios**:

1. **Given** stdio 子进程已启动，**When** `batch` 工具传入不存在的 `projectRoot`，**Then** 响应 `isError=true`，content[0].text JSON 解析后含 `code`（值为 `internal-error` 或 `invalid-input`），`message` 不含调用者机器的绝对路径
2. **Given** 同上，**When** 对 `prepare/generate/diff/panoramic-query` 各传入一组必然失败的入参，**Then** 每个工具响应格式符合统一 envelope（`isError=true` + `code` 字段），且均不泄露绝对路径或 stack
3. **Given** 一个**可加载但 malformed 的 graph fixture**（`specs/_meta/graph.json` 满足 `nodes/links` 为数组通过加载校验，但某 node **缺 `label` 字段**——`scoreNodes` 访问 `node.label.toLowerCase()` 会在查询期抛错，Codex W-1 核对 graph-tools.ts:166-170 + graph-query.ts:296-303），**When** `graph_query` 在该 fixture 上发出查询，**Then** 响应 `isError=true`，`code === 'graph-query-failed'`（engine 加载成功后查询期异常分支，补齐 F177 warning #2 的零覆盖；区别于缺图/坏图的 `graph-not-built`）

---

### User Story 6 — panoramic-query 4 种 operation 经 stdio 验证（Priority: P2）

用户故事：作为回归测试套件，当通过 stdio 子进程调用 `panoramic-query` 的 4 种 operation（cross-package/architecture-ir/overview/natural-language）时，期望各操作的成功/失败分支行为在 JSON-RPC 链路下与源码契约一致。

**优先级理由**：`panoramic-query` 是唯一的多态工具（单入口多 operation），当前 E2E 零覆盖；natural-language 的入参校验（缺 question → invalid-input）和非 monorepo 报错路径需在真实 stdio 链路确认。

**独立测试方法**：对 4 种 operation 各构造 1 组用例（成功或预期失败），断言响应结构与 `src/panoramic/query.ts` 返回约定一致。

**Acceptance Scenarios**:

1. **Given** stdio 子进程，**When** `panoramic-query` 传 `operation: 'natural-language'` 但不传 `question`，**Then** 响应 `isError=true`，`code === 'invalid-input'`
2. **Given** tempRoot 不是 monorepo（无 workspace 配置），**When** `panoramic-query` 传 `operation: 'cross-package'`，**Then** 响应 `isError=true`，`code === 'invalid-input'`
3. **Given** 合法 monorepo 环境（或 mock 合法入参），**When** `panoramic-query` 传 `operation: 'overview'`，**Then** 响应 `isError` 不为 true，content[0].text JSON 解析后含 `data` 字段
4. **Given** 合法项目结构，**When** `panoramic-query` 传 `operation: 'architecture-ir'`（Codex W-4 补齐：4 operation 不可漏 architecture-ir，源码 query.ts:90-95），**Then** 响应或返回 `data`（成功分支）或在缺合法结构时返回明确 `{code}`（invalid-input/internal-error）——以实现阶段实测 fixture 能力为准，二选一并在注释记录

---

### User Story 7 — file-nav 3 工具在 stdio JSON-RPC 链路下行为成立（Priority: P2）

用户故事：作为回归测试套件，当通过 stdio 子进程调用 `view_file`（行段切片 + symbolId→lineRange）、`search_in_file`（pattern 匹配）、`list_directory` 时，期望 F171 的所有行为在真实 JSON-RPC 链路成立，包括：行段切片节省 token、`view_file` 的 symbolId 解析到 lineRange、越界拒绝返回正确 error code。

**优先级理由**：F171 的 file-nav 工具全量 in-process 测试，stdio 链路从未验证；`view_file` 行段切片是 token 节省的核心，必须确认序列化后仍正确工作。

> **Codex W-3 核对**：`symbolId→lineRange` 是 **`view_file`** 的行为（file-nav-tools.ts:67-72/167-181）；`search_in_file` 入参只有 `path/pattern/isRegex/maxMatches/contextLines/projectRoot`，**无 symbolId**，只验 pattern happy path。

**独立测试方法**：对 micrograd 源文件分别调用 3 个工具，断言 view_file 行段切片返回正确行数、search_in_file 用 symbolId 能定位到正确行范围、list_directory 返回目录结构。

**Acceptance Scenarios**:

1. **Given** tempRoot 含 micrograd 源文件，**When** `view_file` 传入 `startLine=1, endLine=10`，**Then** 响应内容恰好包含文件前 10 行，不多不少
2. **Given** 同上，**When** `view_file` 传入有效的 `symbolId`（如 `MLP`），**Then** 响应内容对应 symbol 定义的实际行范围（lineRange 正确）
3. **Given** 同上，**When** `view_file` 传入 `endLine` 超过文件总行数的越界参数，**Then** 响应 `isError=true` 或优雅截断（取决于当前实现合约）；传入完全越界路径则 `code === 'path-outside-root'` 或 `file-not-found`
4. **Given** 同上，**When** `search_in_file` 传入有效 `path` + `pattern`（如 micrograd 源文件中存在的字符串），**Then** 响应含匹配结果（行号 + 片段），JSON 可解析（仅 pattern happy path，无 symbolId 入参）
5. **Given** 同上，**When** `list_directory` 传入 tempRoot，**Then** 响应包含目录内文件名列表，JSON 可解析

---

### User Story 8 — listTools 断言实际注册工具数与各工具 inputSchema 契约（Priority: P2）

用户故事：作为回归测试套件，当通过 stdio 子进程调用 `client.listTools()` 后，期望返回的工具数量等于 `src/mcp/server.ts` 实际注册数，且各工具 `inputSchema` 的必填字段、enum 值、默认值经 SDK 暴露后与源码 Zod 定义一致。

**优先级理由**：工具集合是 MCP server 对外契约的核心；schema 序列化漂移（字段名变更、enum 丢失）是 in-process 测试无法捕获的盲区。此 FR 验证的是「schema 在 stdio 序列化后是否保真」这一核心 E2E 目的。

**独立测试方法**：调用 `listTools`，统计工具总数，并对选定的几个工具校验其 inputSchema 中关键字段的类型、required 标注、enum 取值。

**Acceptance Scenarios**:

1. **Given** stdio 子进程已启动，**When** `client.listTools()`，**Then** 返回的**工具名集合（排序后逐一精确断言）**等于 `src/mcp/server.ts` 实际注册集合（Codex W-5：只断言 count 会漏「少一旧工具 + 多一新工具但总数相同」的漂移，必须断言 exact sorted names）。工具总数与具体名单**实现阶段经 `client.listTools()` 实测确认真值**——scope 文档写 18 但源码分析为 5（server）+6（graph）+3（agent-context）+3（file-nav）=17，两者不一致须在实现时核对取真值，**不写死 18**
2. **Given** 同上，**When** 检查 `impact` 工具的 `inputSchema`，**Then** `target` 字段标注为 required，`direction` 字段含合法 enum 值（`upstream/downstream/both`）
3. **Given** 同上，**When** 检查 `graph_query` 工具的 inputSchema，**Then** 关键必填字段通过 SDK 序列化后仍存在（schema 不漂移）

---

### User Story 9 — batch 工具 MCP 路径下 resolveRegenPlan 逻辑经 stdio 验证（Priority: P2）

用户故事：作为回归测试套件，当通过 stdio 子进程向 `batch` 工具传入 incremental/full/force 不同冲突组合时，期望 `resolveRegenPlan` 在 MCP 路径下正确解析（full 逃生口绕 cache），返回 `deltaReport`，config fallback 合并行为与 in-process 一致。

**优先级理由**：F175 的 batch 工具逻辑全量 in-process 直调 runBatch；MCP 路径下入参序列化、plan 解析、deltaReport 序列化均未经 stdio 链路；full 绕 cache 的"逃生口"是关键行为需在真实链路确认。

**独立测试方法**：**Codex C-2 核对** —— batch 有两条正交轴：(a) **regen 轴**用布尔字段 `full`/`force`/`incremental`（控制是否绕 cache）；(b) **质量轴** `mode: 'full'|'reading'|'code-only'`（控制文档层级）。`mode: 'incremental'` 不是合法 enum、会被 SDK/Zod 拒绝。`deltaReport` **仅 incremental 路径生成**，full/force 路径为 `undefined`（batch-orchestrator.ts:500-504）。因此：full 用 `{ full: true }`（或 `{ force: true }`）验证绕 cache；incremental 用 `{ incremental: true }` 验证含 `deltaReport`。

**Acceptance Scenarios**:

1. **Given** stdio 子进程 + tempRoot（含 micrograd source），**When** `batch` 传 `{ incremental: true }`，**Then** 响应 JSON 含 `deltaReport` 字段，`isError` 不为 true
2. **Given** 同上，**When** `batch` 传 `{ full: true }`（regen 逃生口，绕增量 cache），**Then** 响应 `isError` 不为 true、走全量重生成路径（不要求 `deltaReport`，full 路径该字段为 undefined）
3. **Given** 同上，**When** `batch` 传 `{ mode: 'incremental' }`（非法 enum），**Then** 经 SDK schema 校验被拒绝（验证 mode enum 契约边界）

---

### User Story 10 — 子代理 namespace 前缀路由经 stdio 子进程验证（Priority: P2）

用户故事：作为回归测试套件，当通过 stdio 子进程以带 `mcp__plugin_spectra_spectra__` 命名空间前缀的工具名调用 `client.callTool` 时，期望正确路由到底层 handler（或明确记录 SDK/server 不支持前缀剥离的边界）。

**优先级理由**：子代理实际使用带 namespace 前缀的工具名（如 `mcp__plugin_spectra_spectra__impact`），但从未经 stdio 链路验证路由是否正确；若 server 注册名为裸名，则该用例验证的是 namespace 前缀剥离行为或记录为已知边界。

**独立测试方法**：用带前缀工具名调用 callTool，观察响应是否正确路由（成功）或返回"tool not found"类错误（边界记录）。

**Acceptance Scenarios**:

1. **Given** stdio 子进程已启动，**When** `client.callTool({ name: 'mcp__plugin_spectra_spectra__impact', arguments: {...} })`，**Then** 响应正确路由到 impact handler（返回 impact 响应结构）；**若 SDK 不支持前缀剥离**，则响应含可识别的"tool not found"错误，测试记录该边界为 `skipIf` 并附 TODO 注释 [AUTO-RESOLVED: 实现阶段依据 client.listTools() 返回名称格式决定本用例是验证路由成功还是记录已知边界]

---

### User Story 11 — F174 fuzzy symbol 解析经 stdio 子进程边界生效（Priority: P2）

用户故事：作为回归测试套件，当通过 stdio 子进程向 `context`/`impact` 工具传入模糊 symbol（无路径简短名、typo 变体、path-suffix 形式）时，期望 fuzzy resolve 在进程边界后仍生效，响应 warnings 含 `fuzzy-resolved` 标记，`resolvedFrom`/`resolvedTo` 字段透传。

**优先级理由**：F174 fuzzy resolve 全量 mock + in-process；进程边界后的 JSON 序列化可能截断 warnings 数组或丢失非标准字段；必须在 stdio 链路验证 fuzzy 元信息透传完整。

**独立测试方法**：传入 micrograd 中存在的 symbol 的简短名（如 `Value.relu` 不带路径），断言响应 warnings 包含 fuzzy-resolved，`resolvedFrom`/`resolvedTo` 字段存在。

**Acceptance Scenarios**:

1. **Given** stdio 子进程 + micrograd baseline，**When** `context` 传入唯一可匹配的简短名 / path-suffix（如 `Value.relu` 无路径前缀），**Then** 响应 warnings 含 `fuzzy-resolved` 条目，且 `resolvedFrom='Value.relu'`、`resolvedTo` 为完整 symbolId（**唯一 partial/path-suffix 命中 → 必须自动 resolve**）
2. **Given** 同上，**When** `impact` 传入 typo 变体（如 `Value.reluu`），**Then** **允许两种合法结局**（Codex W-6 核对 query-helpers.ts:351-404：Levenshtein typo 置信度 ≤0.75 < auto-resolve 阈值 0.9，**不应硬断言一定 fuzzy-resolved**）：(a) 返回 `symbol-not-found` 且响应含 `fuzzyMatches` 候选列表；或 (b) 若实测确实自动 resolve 则 warnings 含 fuzzy-resolved。断言写成「(a) 或 (b)」，不强制单一结局

---

### User Story 12 — full batch 同 commit 两次运行 reproducibility 经 stdio 验证（Priority: P2）

用户故事：作为回归测试套件，当同一 commit 上对同一 micrograd baseline 连续触发两次 full batch 生成时，期望原始 `graph.json` 文件直接 deepEqual（byte-stable，F179 落盘闭合后应成立），归一化后 deepEqual 作兜底断言。

**优先级理由**：F179 修复了 byte-stable 落盘，但尚无 stdio E2E 层面的 reproducibility 守护；graph.json 原始文件 deepEqual 是最强护栏，一旦 byte-stable 回归（如 JSON key 排序变化），本用例能立即捕获。

**独立测试方法**：对同一 tempRoot 跑两次 `batch { full: true, mode: 'full' }`（Codex C-2：full 用 regen 布尔轴 `full: true` 才真正绕 cache 重生成，`mode: 'full'` 只控文档层级），读取两次生成的 graph.json，先直接字节 deepEqual，后经 readNormalizedGraph 归一化再 deepEqual。

**Acceptance Scenarios**:

1. **Given** tempRoot + micrograd source，**When** `batch { full: true, mode: 'full' }` 运行两次（两次间不修改任何文件），**Then** 两次生成的 `graph.json` 文件内容**原始字节 deepEqual**（不经归一化，最强护栏）
2. **Given** 同上，若原始 deepEqual 失败（byte 差异但语义等价），**Then** 经 `readNormalizedGraph` 归一化后 deepEqual 仍然成立（兜底断言），并记录 byte 差异为 WARNING 供人工排查

---

## Edge Cases

### EC-1：telemetry 双源分区与 SDK 校验边界（User Story #4 关键）

`withTelemetry` 装饰器**仅包裹 server 5 + graph 6（共 11 个工具）**；agent-context（impact/context/detect_changes）和 file-nav（view_file/search_in_file/list_directory）的 telemetry 在 handler 内部自采样。这意味着：

- 测试 #4 中「恰写 1 行」的不变量对两个工具分区均成立，但写入路径不同；实现阶段需确认两个分区的 JSONL 写入逻辑一致。
- **SDK schema 校验失败（缺少 required 参数）的调用不进入 withTelemetry**，不写 telemetry——因此 #4「错误调用含 errorCode」的测试用例**必须选用能进入 handler 的失败**（如 graph-not-built、业务 invalid-input），而不是 SDK 层直接拒绝的缺参调用。

### EC-2：symlink 解析的 cwd 差异（User Story #3 关键）

子进程以 `cwd=tempRoot` 启动，但 `view_file` 的 `projectRoot` 参数解析可能以 `process.cwd()` 为基准（W-4 修复历史）。测试必须明确区分：

- 相对路径越界（`../../etc/passwd`）：子进程 cwd 决定解析基准
- symlink 越界：tempRoot 内 symlink 指向外部，需确认 `realpath()` 在子进程中正确展开

### EC-3：脱敏合约验证边界（User Story #5 关键）

`buildErrorResponse` 的脱敏合约要求 `message/hint/context` 不含绝对路径/stack。测试需验证：

- 测试机器路径（如 `/Users/connorlu/...`）不出现在任何 error 响应的 text 字段中
- stack trace 关键词（`Error:` + `at ` + 文件路径）不出现
- **注意**：测试本身需避免把绝对路径写入断言的字面量，应用正则或 startsWith 检查

### EC-4：工具总数真值不确定性（User Story #8 关键）

scope 文档写 18，源码分析为 5（server）+ 6（graph）+ 3（agent-context）+ 3（file-nav）= 17，两者不一致。**spec 不写死具体数字**；实现阶段必须通过 `client.listTools()` 实测确认真值，作为断言硬指标写入测试。

### EC-5：namespace 前缀路由不确定性（User Story #10 关键）

子代理调用模式为 `mcp__plugin_spectra_spectra__impact`，但 MCP SDK `client.callTool` 的 `name` 字段是否支持前缀剥离取决于 SDK 版本与 server 注册方式。

- 若 server 以裸名（`impact`）注册，带前缀的 callTool 可能返回"tool not found"
- 实现阶段需通过实测确定：若 SDK 不支持，则该用例改为记录已知边界（`skipIf` + TODO），不强制测试路由成功

### EC-6：reproducibility 两级断言（User Story #12 关键）

- **第一级（最强）**：原始 graph.json 文件 `Buffer` 直接 deepEqual，不经任何归一化——F179 byte-stable 落盘闭合后应成立
- **第二级（兜底）**：经 `readNormalizedGraph` 归一化后 deepEqual——覆盖 JSON key 排序等语义等价但 byte 不等的情形
- 两级独立断言，第一级失败时第二级仍运行，两者失败级别不同（第一级 WARN，第二级 FAIL）

### EC-7：micrograd baseline 缺失时的 CI 行为

所有需要 micrograd graph.json 的用例使用 `describe.skipIf(SHOULD_SKIP)` 包裹，条件为 `!existsSync(BASELINE_GRAPH) || !existsSync(DIST_CLI)`。skip 时打印明确的 skip reason 消息，不静默跳过。**（F215 已修订，见文末 Amendment）**

---

## Functional Requirements

### 测试覆盖要求

- **FR-001** [必须]：测试套件 MUST 对 graph_query/graph_node/graph_path/graph_community/graph_god_nodes/graph_hyperedges 各验证至少 1 条真实 `client.callTool` stdio 子进程用例，断言响应 JSON 可解析、`isError` 不为 true、schema 关键字段非 undefined。（对应 Story #1）

- **FR-002** [必须]：测试套件 MUST 验证 micrograd baseline 上 `detect_changes → impact → context → view_file` 完整链式调用：从 `detect_changes` 的 `changedSymbols.find(c => c.symbols.length>0)?.symbols[0]` 取 symbol 名（真实结构无 symbolId 字段，Codex C-1）、可被 context/impact canonicalize、`context.definition` 含 `lineStart/lineEnd`、最终 view_file 行范围与之一致。所选 diff fixture 须保证 changedSymbols 非空，否则 fail 并打印原始响应。（对应 Story #2）

- **FR-003** [必须]：测试套件 MUST 验证 `view_file` 经 stdio 子进程对路径越界（`../../../etc/passwd`）返回 `code === 'path-outside-root'`，以及 tempRoot 内指向外部的 symlink 同样被拦截。（对应 Story #3）

- **FR-004** [必须]：测试套件 MUST 验证子进程设置 `SPECTRA_MCP_TELEMETRY_PATH` + `SPECTRA_MCP_RUN_ID` 后，成功调用恰写 1 行 JSONL，字段 `toolName/runId/durationMs/requestSize/responseSize` 正确；能进入 handler 的失败调用额外含 `errorCode`；未设 env 时无 JSONL 产生。（对应 Story #4；测试用例必须选用能进入 handler 的失败，排除 SDK 校验拒绝的缺参调用）

- **FR-005** [必须]：测试套件 MUST 验证 `prepare/generate/batch/diff/panoramic-query` 对失败入参均返回 `isError=true` + `{code}` envelope，且响应 text 不含调用者机器绝对路径或 stack trace 关键词。（对应 Story #5）

- **FR-006** [必须]：测试套件 MUST 用**可加载但 malformed 的 graph fixture**（node 缺 `label` 字段 → `scoreNodes` 查询期抛错，Codex W-1）触发 graph 工具查询期异常，断言返回 `code === 'graph-query-failed'`（engine 加载成功后分支，区别于 `graph-not-built`），闭合 F177 warning #2 的零覆盖。（对应 Story #5）

- **FR-007** [可选]：测试套件 SHOULD 对 `panoramic-query` 的 4 种 operation 各验证至少 1 条 stdio 用例，覆盖 natural-language 缺 question、非 monorepo cross-package 这两个已知失败分支，以及至少 1 个成功分支。（对应 Story #6）

- **FR-008** [必须]：测试套件 MUST 对 `view_file` 行段切片、`view_file` 的 symbolId→lineRange、越界拒绝经 stdio JSON-RPC 链路各验证 1 条用例；对 `search_in_file`（**仅 pattern happy path，无 symbolId 入参**，Codex W-3）/`list_directory` 各验证基本 happy path 1 条。（对应 Story #7）

- **FR-009** [必须]：测试套件 MUST 调用 `client.listTools()`，断言**工具名集合（排序后逐一精确）**等于实测真值（**实现阶段经实测确认，不写死 18**，Codex W-5），且选定工具的 inputSchema 关键字段（required 标注、enum 取值）通过 SDK 序列化后与 Zod 源码定义一致。（对应 Story #8）

- **FR-010** [可选]：测试套件 SHOULD 验证 `batch` 工具 MCP 路径：`{ incremental: true }` 响应含 `deltaReport` 字段；`{ full: true }`（regen 布尔轴，非 `mode`）走全量绕 cache（不要求 deltaReport）；`{ mode: 'incremental' }` 非法 enum 被 SDK 拒绝。（对应 Story #9，Codex C-2）

- **FR-011** [可选]：测试套件 SHOULD 验证带 namespace 前缀的工具名（`mcp__plugin_spectra_spectra__impact`）经 `client.callTool` 的路由行为；若 SDK 不支持前缀剥离，则改为记录已知边界（`skipIf` + TODO 注释），**不要强制失败**。（对应 Story #10；实现阶段需实测确认 SDK 支持情况）

- **FR-012** [可选]：测试套件 SHOULD 区分两类模糊 symbol（Codex W-6）：**唯一简短名/path-suffix** 经 stdio 调用 `context`/`impact` 时 warnings 含 `fuzzy-resolved` + `resolvedFrom`/`resolvedTo` 透传（必须自动 resolve）；**typo 变体**允许 `symbol-not-found` + `fuzzyMatches` 候选，不硬断言自动 resolve。（对应 Story #11）

- **FR-013** [必须]：测试套件 MUST 验证同一 commit + 同一 micrograd baseline 上连续两次 `batch { full: true, mode: 'full' }`（regen 布尔轴绕 cache，Codex C-2）生成的 graph.json 原始 Buffer deepEqual（byte-stable，最强护栏），归一化后 deepEqual 作兜底独立断言。（对应 Story #12）

### 基础设施要求

- **FR-014** [必须]：所有需要 micrograd baseline graph.json 的测试 MUST 使用 `describe.skipIf(!existsSync(BASELINE_GRAPH) || !existsSync(DIST_CLI))` 包裹，skip 时打印明确 reason。**（F215 已修订，见文末 Amendment）**

- **FR-015** [必须]：测试文件后缀 MUST 为 `*.e2e.test.ts`，放置于 `tests/e2e/` 目录。

- **FR-016** [必须]：所有测试 MUST 复用 `tests/integration/mcp-server-stdio.test.ts` 中的 transport 构造模式（`StdioClientTransport` spawn `dist/cli/index.js mcp-server`），**不重复发明 transport 逻辑**。

- **FR-017** [必须]：telemetry 相关测试（FR-004）MUST 在 `afterEach`/`afterAll` 中清理临时 JSONL 文件，避免跨测试污染。

- **FR-018** [必须]：不修改任何生产代码（`src/` 目录下的任何文件）；所有改动限于 `tests/e2e/` 新增测试文件。

---

## Success Criteria

- **SC-001**：现有全量 vitest 测试（`npx vitest run`）在 F180 合入后**零回归**（已有 passing 用例数不减少，无新增 failing 用例）。

- **SC-002**：`npm run build` 类型检查零错误（新测试文件无 TypeScript 编译错误，不使用 `any` 类型）。

- **SC-003**：`npm run repo:check` 零失败（仓库级同步校验通过）。

- **SC-004**：FR-001 到 FR-006、FR-008、FR-009、FR-013、FR-014 到 FR-018（标 [必须] 的 FR）所有对应用例在有 micrograd baseline + dist 构建的环境下全部 PASS。

- **SC-005**：`client.listTools()` 断言通过，返回工具数等于实测真值（实现阶段确认），且断言结果被记录在 `tests/e2e/` 测试文件的注释中，供后续工具数变化时参考。

- **SC-006**：telemetry JSONL 落盘用例（FR-004）在有 baseline 的环境中 PASS，明确验证「恰写 1 行」不变量与「能进入 handler 的失败含 errorCode」两个场景。

- **SC-007**：reproducibility 用例（FR-013）通过 byte-stable 原始 deepEqual 断言（第一级），确认 F179 byte-stable 修复在 stdio E2E 层面守住。**注**：因真实 stdio batch 依赖 LLM 可用（runBatch 始终调 callLLM，Codex Plan-W3），该用例 gate 在 `HAS_LLM_E2E` skipIf 之后——在 LLM 可用环境（dev-machine）跑并 PASS 为达成；keyless CI 自动 skip 不算 fail。byte-stable 的进程内深测仍由 F179 既有测试覆盖。

- **SC-008**：所有「实现阶段需实测确认」的点（工具真值、namespace 前缀支持性）在实现 PR 中必须有明确注释记录实测结论，不允许留白。

---

## Out of Scope（本 Feature 不覆盖）

- **F170d driver preference 沙盒（#13）**：low 优先级，不在 F180 scope，不生成用例。
- **超大 payload 截断**：`PAYLOAD_CAP_BYTES` + `payload-truncated/too-large` 错误码在 JSON-RPC 链路下的行为 → defer M8。
- **graph.json stale 自动失效**：外部覆盖 graph.json 后 re-callTool 拿新图的 invalidation 机制 → defer M8。
- **生产代码修改**：F180 不修改 `src/` 任何文件，包括不修复 F177 warning #1（withTelemetry 泛型推断）——该债记录在 F177 audit 中，下次动 `telemetry.ts` 时顺带处理。
- **竞品对比评测**：graph 工具质量与竞品对比 → F176 scope。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 数值 |
|------|------|
| **组件总数** | 0（纯测试，不新增生产组件） |
| **接口数量** | 0（不新增或修改接口契约） |
| **依赖新引入数** | 0（复用已有 `@modelcontextprotocol/sdk`） |
| **跨模块耦合** | 无（测试只读，不修改生产模块接口） |
| **复杂度信号** | 无递归结构、无状态机、无并发控制、无数据迁移 |
| **总体复杂度** | **LOW** |

> 注：测试逻辑本身涉及子进程生命周期管理（beforeAll spawn / afterAll close），但这是 transport 模式的标准用法，不构成额外架构复杂度。

---

## 关键设计取舍说明

**取舍 1（不写死工具数）**：FR-009 / SC-005 明确不将工具总数（17 or 18）写死为 spec 硬指标，而是要求实现阶段实测后记录真值。原因：这正是 stdio E2E 要捕获的「schema 漂移类盲区」——写死错误数字会让断言永远 fail 且掩盖真实注册状态。

**取舍 2（telemetry 错误用例选型约束）**：FR-004 明确要求测试用例必须选用「能进入 handler 的失败」而非「SDK 校验拒绝的缺参调用」。原因：SDK 校验失败不触发 withTelemetry，JSONL 不会写入，若用缺参测试则「含 errorCode」断言永远拿到空文件，误报正常。此约束对实现者是非显而易见的，必须在 spec 层明确。

**取舍 3（namespace 路由用例设计为可降级）**：FR-011 设计为「路由成功 OR 记录边界」二选一，而非强制 PASS。原因：SDK 是否支持前缀剥离存在真实不确定性，强制 FAIL 会让 CI 红灯但无法区分「路由失败」和「SDK 不支持」；降级为 skipIf + TODO 更诚实也更可操作。

---

## 需要主编排器在实现阶段拍板的不确定点

1. **工具真实注册数（17 vs 18）**：须通过 `client.listTools()` 实测确认，结论直接影响 FR-009 断言的硬指标写法。若实测为 17，需同步更新 `docs/design/M7-stepback-revision-2.md` 中的「18」描述。

2. **namespace 前缀路由支持性**：须实测 `client.callTool({ name: 'mcp__plugin_spectra_spectra__impact', ... })` 是否返回正确响应，决定 FR-011 用例是走「验证路由成功」还是「记录已知边界 + skipIf」路径。

3. **graph-query-failed 触发方式**：✅ **已由 Codex W-1 解决** —— 用可加载但 malformed 的 graph fixture（`nodes/links` 为数组通过加载校验，但某 node 缺 `label` → `scoreNodes` 访问 `node.label.toLowerCase()` 查询期抛错）即可稳定从外部 callTool 触发，无需改生产代码。实现阶段直接构造该 fixture。

---

### Codex 对抗审查处置记录（Specify 阶段）

| 编号 | 档位 | 结论 | 处置 |
|------|------|------|------|
| C-1 | CRITICAL | detect_changes 返回 `{file,changeKind,symbols[]}` 无 symbolId；context.definition 用 lineStart/lineEnd | ✅ 已修 FR-002 / Story #2 |
| C-2 | CRITICAL | batch `mode`(full/reading/code-only) 与 regen 轴(full/force/incremental 布尔)正交；deltaReport 仅 incremental | ✅ 已修 FR-010/FR-013 / Story #9/#12 |
| W-1 | WARNING | graph-query-failed 可经 malformed-but-loadable graph 触发 | ✅ 已修 FR-006 / Story #5 |
| W-2 | WARNING | durationMs 快路径可能为 0 | ✅ 已改 `>= 0` |
| W-3 | WARNING | search_in_file 无 symbolId，那是 view_file | ✅ 已修 Story #7 / FR-008 |
| W-4 | WARNING | Story #6 漏 architecture-ir operation | ✅ 已补场景 4 |
| W-5 | WARNING | 只断言 count 不够，应 exact sorted names | ✅ 已修 FR-009 / Story #8 |
| W-6 | WARNING | typo 置信度 ≤0.75 < 阈值 0.9，不应硬断言 fuzzy-resolved | ✅ 已修 FR-012 / Story #11 |
| I-1 | INFO | telemetry「恰写 1 行」+ SDK 校验失败不写 有源码支撑 | 保留，不改 |
| I-2 | INFO | namespace 前缀可降级处理诚实 | 保留，不改 |

---

## Amendment — F215（2026-07-20）

**背景**：F215（`specs/215-fix-e2e-baseline-decouple`）修复了 4 个 E2E 测试文件（经共享 helper）+ 2 个集成测试文件把跨 worktree 共享可变的 `~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json` 当稳定 fixture 直读的问题（无 pin、无版本、无形状校验，导致并行 baseline 重采集会打穿本 feature 的测试套件）。原文 FR-014 / EC-7 / 背景段"实现基座约定"中把 `BASELINE_GRAPH` 字面定义为该共享 home 路径，此处不改写原文语义（保持可考古），仅记录以下变更：

1. **`BASELINE_GRAPH` repoint**：自 F215 起，`tests/e2e/helpers/stdio-client.ts`、`tests/integration/mcp-server-stdio.test.ts`、`tests/integration/agent-context-real-graph.test.ts` 中的 `BASELINE_GRAPH` 常量已从 `~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json` repoint 到 **in-repo pinned fixture** `tests/fixtures/micrograd-baseline-graph/graph.json`（随 git 提交，跨 worktree/CI 一致可达，不受任何并行 baseline 采集影响）。
2. **skip 条件语义收窄**：`buildSkipCondition`/`buildSkipReason`（及 2 个集成测试的本地复制逻辑）判断依据从"`BASELINE_GRAPH` 存在"改为"`MICROGRAD_SOURCE`（micrograd 源 clone，`~/.spectra-baselines/micrograd`）存在"。原因：in-repo fixture 恒存在（随仓库提交），真正的外部依赖收窄为源 clone（部分测试需要拷贝其 `.py` 源文件）。
3. **原 home 路径不再是测试输入**：`~/.spectra-baselines/micrograd-output/**` 自 F215 起不再被本 feature 任何测试读取或写入；FR-014 / EC-7 原文描述的路径与判断条件已是历史实现细节，当前实现以本节为准。
4. **交接**：F214（`graph-topology-canonical-id`）落地 canonical `::` symbol id 统一时，需用其新 dist 重新生成 `tests/fixtures/micrograd-baseline-graph/graph.json` 并同步翻转相关 E2E 断言（详见 `tests/fixtures/micrograd-baseline-graph/README.md` 的 F214 交接注记）。

详见 `specs/215-fix-e2e-baseline-decouple/fix-report.md`（5-Why 根因）与 `specs/215-fix-e2e-baseline-decouple/plan.md`（变更清单）。
