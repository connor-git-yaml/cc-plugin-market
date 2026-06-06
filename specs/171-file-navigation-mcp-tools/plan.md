# Implementation Plan: File Navigation MCP Tools（view_file / search_in_file / list_directory）

**Branch**: `171-file-navigation-mcp-tools` | **Date**: 2026-06-06 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/171-file-navigation-mcp-tools/spec.md`
**设计来源**: `docs/design/M7-execution-blueprint.md` §2

## Summary

为 Spectra MCP server 新增 3 个文件导航工具（`view_file` / `search_in_file` / `list_directory`），让 driver 按行区间/symbol/pattern/目录查看文件以省 token。技术路径：新建 handler 模块 `src/mcp/file-nav-tools.ts` + 纯函数模块 `src/mcp/lib/file-nav-helpers.ts`；为消除 Codex C-4 私有符号冲突，把响应原语抽到共享模块 `src/mcp/lib/tool-response.ts`，agent-context-tools 与 file-nav 双向复用。路径安全（realpath + path.relative containment）是最高优先级红线。

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 20.x+（ESM，`node:fs`/`node:path` 内置）
**Primary Dependencies**: `@modelcontextprotocol/sdk`（McpServer）、`zod`（input schema）；**0 个新外部依赖**
**Storage**: 只读文件系统（受 `resolveSafePath` 约束在 projectRoot 内）+ 复用现有 graph 数据（`getCachedGraphData`）
**Testing**: vitest 3.x；unit (`tests/unit/mcp/`) + e2e (`tests/e2e/*.e2e.test.ts`)
**Target Platform**: 本仓库主跑 darwin；resolveSafePath 合同声明跨平台归一化
**Project Type**: single（src/ + tests/）
**Performance Goals**: view_file 响应 byte ≤ 全文 50%（SC-002 代理断言）
**Constraints**: 路径安全零泄露；payload ≤ `PAYLOAD_CAP_BYTES`；enrichment/telemetry 失败静默降级
**Scale/Scope**: 2 新模块 + 1 共享模块抽取 + server.ts 1 行接线 + agent-context-tools 去重重构

## openQuestions 决策（plan 阶段拍板）

| # | 问题 | 决策 | 理由 |
|---|------|------|------|
| 1 | `list_directory` 默认是否过滤 `node_modules/dist`？ | **仅过滤 `.git`**，dotfiles 默认可见，`includeIgnored=true` 才纳入 `.git` | 对标 SWE-Bench scaffolding 需看三方/隐藏代码（blueprint 推荐）；node_modules 噪声由 driver 自行用 depth/path 规避 |
| 2 | `view_file` 是否写进 F170d `preference-rules.md`（R5 行）？ | **本 Feature 不写，列为 follow-up** | 触碰 `plugins/spec-driver` 需 repo:sync + namespace guard，扩大验证面；preference shaping 效力未证（F170d 50-80%）；F171 deliverable 是"工具存在且正确"，driver 采纳引导是独立关注点。**遵循"不自行添加未要求功能"**。在 plan 显式标注，GATE_TASKS 可复议 |
| 3 | `view_file` 无定位参数默认行为 | **前 200 行 + `truncated` 标志** | 对标 OpenHands 默认窗口（FR-002 已定） |
| 4 | C-4 共享模块 `tool-response.ts` 边界 | 见下方"模块架构"——抽 `ToolResult`/`ErrorCode`/`buildErrorResponse`/`buildSuccessResponse`（cap 内嵌）/`PAYLOAD_CAP_BYTES`；telemetry 在 **GREEN** 抽 `telemetry.ts`（修 TELEMETRY-COUPLING） | 最小必要抽取，打破私有封锁；无独立 capPayload 符号 |

## 模块架构

### 新增 / 改动文件清单

```text
src/mcp/lib/tool-response.ts      [新增, GREEN]  共享响应原语（C-4 解锁）
src/mcp/lib/telemetry.ts          [新增, GREEN]  从 agent-context-tools 抽 TelemetryEntry/writeTelemetry/
                                                recordAndReturn/extractErrorCode（提前到 GREEN：修 Codex TELEMETRY-COUPLING，
                                                避免 file-nav import agent-context-tools 拉入 graph 重依赖图）
src/mcp/lib/file-nav-helpers.ts   [新增, GREEN]  纯函数：resolveSafePath / sliceLines / matchInFile /
                                                buildDirListing / estimateUtf8ByteTokens / isBinary /
                                                clamp helpers / buildFileNavHint
src/mcp/file-nav-tools.ts         [新增, GREEN]  registerFileNavTools + 3 handler + Zod schema + description
src/mcp/agent-context-tools.ts    [改动, GREEN] 改为 import 共享原语（去重，非污染）
src/mcp/server.ts                 [改动, GREEN]  registerAgentContextTools 后加 registerFileNavTools + 更新计数注释
vitest.config.ts                  [改动, GREEN]  per-file 95% 阈值 glob key（file-nav-tools / file-nav-helpers）

tests/e2e/feature-171-file-navigation.e2e.test.ts   [新增, RED]
tests/unit/mcp/file-nav-tools.test.ts               [新增, RED]
tests/unit/mcp/file-nav-helpers.test.ts             [新增, RED]
tests/unit/mcp/tool-response.test.ts                [新增, RED] 直测截断循环/payload-too-large（修 COVERAGE-BLINDSPOT）
tests/unit/mcp-server.test.ts                       [改动, GREEN] :78 sorted 数组加 list_directory/search_in_file/view_file
tests/integration/mcp-server-stdio.test.ts          [改动, GREEN] tools/list 计数 ≥9 → ≥12（断言含 3 新工具）
```

**注（修 Codex SHARED-API-FICTION）**：源码实际只有 `recordAndReturn`/`writeTelemetry` 是 export；`ToolResult`/`ErrorCode`/`buildErrorResponse`/`buildSuccessResponse`/`extractErrorCode`/`PAYLOAD_CAP_BYTES` 均私有。**payload cap 逻辑内嵌在 `buildSuccessResponse`（无独立 `capPayload` 函数）**——file-nav 直接复用 `buildSuccessResponse(data, truncatableKeys)` 即得截断+`payload-truncated` warning。tool-response.ts 是"把现有私有符号移到共享模块 + 新增 3 个 ErrorCode"，非凭空造 API。

### 分层职责

- **tool-response.ts（共享原语）**: `ToolResult` interface、`ErrorCode` union（既有 9 码 **+** `path-outside-root`/`binary-file`/`file-not-found`）、`buildErrorResponse`、`buildSuccessResponse`（**payload cap 截断循环内嵌于此函数**，file-nav 复用即得截断+warning）、`extractErrorCode`、`PAYLOAD_CAP_BYTES`。`agent-context-tools.ts` 删除本地定义改 import；`file-nav-tools.ts` import 同源 → 解决 C-4。**无独立 capPayload 符号**（修 Codex SHARED-API-FICTION）。
- **file-nav-helpers.ts（纯函数，目标 ≥95% 覆盖）**: 全部无 LLM、无网络；fs 调用集中且可注入/可 mock。导出：
  - `resolveSafePath(projectRoot, userPath): { ok: true, realPath } | { ok: false, code }`（见安全设计）
  - `sliceLines(content, startLine, endLine, defaultWindow): { lines（带行号前缀）, startLine, endLine, totalLines, truncated }`
  - `matchInFile(content, pattern, { isRegex, maxMatches, contextLines }): { matches, totalMatches, returnedMatches, warnings }`
  - `buildDirListing(absDir, { depth, includeIgnored }): { entries, warnings }`
  - `estimateUtf8ByteTokens(text): number`（byte/4 代理；**改名避开** `src/core/token-counter.ts` 已有的 `estimateTokens`(chars/3.5) 命名碰撞，W-5）。SC-002 主断言优先直接用 `Buffer.byteLength` ratio
  - `isBinary(buffer): boolean`（NUL 字节探测）
  - `clampInt(value, min, max, default): { value, clamped }`
  - `buildFileNavHint(toolName, responseData): string`（FR-040 独立 hint，风格对齐 generateNextStepHint，不改 response-helpers.ts）
- **file-nav-tools.ts（handler + 接线）**: 3 个 Zod schema、3 个 handler（编排 helpers + 错误码 + telemetry `recordAndReturn` + description）、`registerFileNavTools(server)`。handler 只做编排，不含可独立测试的纯逻辑（逻辑都在 helpers）。

## 数据模型

```ts
interface FileSlice { lines: string[]; startLine: number; endLine: number; totalLines: number; truncated: boolean; }
interface SearchMatch { line: number; text: string; before: string[]; after: string[]; }
interface DirEntry { name: string; type: 'file' | 'dir' | 'symlink'; size: number | null; }
type SafePathResult = { ok: true; realPath: string } | { ok: false; code: 'path-outside-root' | 'invalid-input' | 'file-not-found' };
```

## 🔴 路径安全设计（FR-010~013，最高优先级）

`resolveSafePath(projectRoot, userPath)` 算法（对应 Codex C-1/C-2）：

```text
1. if userPath 含 '\0'  → { ok:false, code:'invalid-input' }            # NUL 拒绝
2. 不做任何 URL-decode（%2e%2e 按字面）                                    # 不解码逃逸
3. realRoot = realpathSync.native(projectRoot)                            # projectRoot 自身 symlink 也解析
4. candidate = path.resolve(realRoot, userPath)
5. # 修 Codex PATH-CLASSIFICATION：词法 containment 先于任何 fs 调用
   relLex = path.relative(realRoot, candidate)
   if relLex.startsWith('..') || path.isAbsolute(relLex)
        → { ok:false, code:'path-outside-root' }                         # 越界(含不存在)优先于 file-not-found，且不触 fs
6. # 仅词法在根内才穿透 symlink
   try realCandidate = realpathSync.native(candidate)
   catch ENOENT/other → { ok:false, code:'file-not-found' }（脱敏）
7. relReal = path.relative(realRoot, realCandidate)
   if relReal.startsWith('..') || path.isAbsolute(relReal)
        → { ok:false, code:'path-outside-root' }                         # symlink 逃逸；path.relative 杜绝 /repo vs /repo2 前缀碰撞
   # relReal === '' 视为 contained（候选即根本身），合法，工具层据 stat 决定 file/dir
8. return { ok:true, realPath: realCandidate }                            # 后续 fs 操作只用 realPath（缩小 TOCTOU）
# posix-only：Windows 归一化 YAGNI 不做（FR-010e）
```

**脱敏不变量（FR-013）**：所有 file-nav 错误响应 message **不含**绝对路径 / stack / errno path；`internal-error` message redacted（区别于 agent-context-tools 现有回传 `err.message` 的模式）。

**安全测试矩阵（SC-009，RED 阶段必写）**：`../` 逃逸 / 绝对路径越界 / 根内 symlink 指向根外 / projectRoot 自身为 symlink / 前缀碰撞 `/repo` vs `/repo2` / NUL 字节 / `%2e%2e` 字面 / 根内合法 symlink 放行。

## ReDoS 缓解设计（FR-005，C-3）

`try/catch` 只兜非法正则语法（→ `invalid-input`）。catastrophic backtracking **不抛异常**，故附加可实现合同：
- `pattern.length` 上界（如 ≤ 200）→ 超限 `invalid-input`
- 被搜索 content byte 上界（复用 payload 思路）
- 启发式拒绝已知高危结构正则（嵌套量词 `(x+)+` / `(x+)*` / `(.*)*` 模式探测）→ `invalid-input`，hint 说明
- spec 明示：这是"启发式 + 输入界限"，非完整 ReDoS 证明（0 新依赖约束）

## Description 设计（F170c 4 要素，FR-030~032）

3 个 description 均含：lead-in（中文一句）/ `Use this tool when:`（≥3 bullet）/ `Example:`（Input/Output）/ `Typical chained usage:`（含 `→`）。长度 `[100,500]`。`view_file` 的 chained 段体现 `context → view_file(symbolId)` 闭环。静态断言复用 F170c captureTools 模式（mock McpServer 捕获 `tool(name, description, schema, handler)`）。

## 测试策略（TDD：RED → GREEN → REFACTOR）

- **RED**（`test(171)`）：
  - `tests/e2e/feature-171-file-navigation.e2e.test.ts`（`.e2e.test.ts` 后缀，进 e2e project）：4 用户故事 + description 4 要素（captureTools）+ HOST_E2E gate（`describe.skipIf(!process.env.HOST_E2E)` 包真实 driver token 对比，默认 skip，对标 F170d）；sandbox 用 estimateTokens/byteLength 代理断言 SC-002。
  - `tests/unit/mcp/file-nav-helpers.test.ts`：纯函数全分支（含安全矩阵 SC-009、clamp 边界、二进制/空/CRLF、ReDoS 启发式）。
  - `tests/unit/mcp/file-nav-tools.test.ts`：handler 编排 + 错误码 + telemetry 注入（mock server）。
- **GREEN**（`feat(171)`）：抽 tool-response.ts + telemetry.ts（telemetry 提前到 GREEN 避免重依赖耦合）→ agent-context-tools 改 import → 实现 helpers → 实现 tools → server 接线 → 更新 mcp-server 单测/集成 tools-list 断言 → 加 vitest 95% 阈值。file-nav 的 recordAndReturn 从 **telemetry.ts** import（不碰 agent-context-tools 重依赖图）。
- **REFACTOR**（`refactor(171)`）：常量集中 + 残余去重 + 命名收敛（telemetry/tool-response 已在 GREEN 抽出，本阶段只做 cleanup，不引新回归面）。

### 覆盖率阈值（vitest.config.ts）

新增 glob key（SC-005）：
```ts
'src/mcp/file-nav-tools.ts':       { branches:95, functions:95, lines:95, statements:95 },
'src/mcp/lib/file-nav-helpers.ts': { branches:95, functions:95, lines:95, statements:95 },
```
`tool-response.ts` / `telemetry.ts` 为既有已测代码抽取，保持全局 80%（不强加 95%，避免抽取分支未全覆盖误 fail）。**修 Codex COVERAGE-BLINDSPOT**：既有 `agent-context-tools.test.ts` 对 `payload-truncated` 截断循环仅注释未断言，故新增 `tests/unit/mcp/tool-response.test.ts` 直测截断循环（多轮收缩 / `progressed=false` break / `payload-too-large`），保证抽取后该分支有真实护栏。**handler 95% 可达性（修 95%-TOOLS）**：所有 OS / 错误分支下沉到 `file-nav-helpers.ts`（可注入、可 mock），`file-nav-tools.ts` 只保留薄编排，确保 95% 结构上可达。**回归护栏（FR-041/SC-006）**：默认 hint 走独立 `buildFileNavHint`，不触 `response-helpers.ts`；若实现改道触及它，则同 PR 先补 F170c 空列表分支（detect_changes 115-116 / context 125-126 / maxItems<=0）回 ≥80%。

## Constitution Check

- ✅ 简洁之道：handler 薄、逻辑入纯函数；0 新依赖；消除 C-4 重复
- ✅ 类型优先：SafePathResult 判别联合表达安全不变量
- ✅ 零基思维：不在 agent-context-tools 上叠 file-nav，先抽共享层修正抽象
- ✅ 提交前验证：vitest run + build + repo:check + release:check 零失败（交付门）
- ✅ 模型策略：implement 用 Opus（生产代码），review 用 Sonnet

## Complexity Tracking

| 项 | 说明 | 是否需 justify |
|----|------|---------------|
| 抽 tool-response.ts 触及 agent-context-tools | C-4 私有符号冲突的唯一干净解；去重非新增 | 否（降复杂度） |
| 跨平台路径归一化合同 | 安全红线要求；本仓库主跑 darwin 但合同需声明 | 否 |

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 抽 tool-response.ts 破坏 agent-context-tools 现有测试 | GREEN 先抽 + 立即跑既有 mcp 单测；import 路径变更不改行为 |
| realpathSync 对不存在路径抛 ENOENT | 捕获映射 `file-not-found`（脱敏），安全矩阵覆盖 |
| HOST_E2E 真实 driver 不稳定 | 默认 skip，仅 host 手动跑；sandbox 代理断言为 CI 主门 |
| file-nav import 拉入 graph 重依赖 | GREEN 即抽 telemetry.ts，file-nav 只依赖 tool-response.ts + telemetry.ts，不 import agent-context-tools |
| 新增 3 工具破坏 server tools-list 精确断言 | GREEN 同步更新 `mcp-server.test.ts:78` sorted 数组 + `mcp-server-stdio.test.ts` 计数（已列入文件清单） |
