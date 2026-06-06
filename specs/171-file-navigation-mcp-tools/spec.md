# Feature Specification: File Navigation MCP Tools（view_file / search_in_file / list_directory）

**Feature Branch**: `171-file-navigation-mcp-tools`
**Created**: 2026-06-06
**Status**: Draft
**Input**: User description: "为 Spectra MCP server 补齐 3 个对标 SWE-Agent/OpenHands scaffolding 的文件导航工具，让 driver 按 line range / pattern / 目录看文件以节省 token；新建独立模块，不污染 agent-context-tools.ts；路径安全为最高优先级红线。"
**设计来源**: `docs/design/M7-execution-blueprint.md` §2（workflow `wf_00c688f4-3b9` 沉淀，已 review）

---

## 背景与动机

Spectra MCP server 已经提供 graph 查询类工具（`impact` / `context` / `detect_changes` 等），driver 可以拿到 symbol 级别的结构化上下文。但要查看**具体文件内容**，driver 当前只能依赖宿主 agent 的全文 `Read`，这会把整文件灌入上下文，token 成本高。

对标 SWE-Agent / OpenHands 的 scaffolding，本 Feature 补齐 3 个文件导航工具，让 driver 能够：
- 按 **行区间**（或 symbol 定位）查看文件片段，而非全文
- 在单文件内按 **pattern** 搜索并带上下文行
- 列出 **目录** 结构以决定下一步看哪个文件

这条 `context/impact → view_file(symbolId)` 的链路，把"结构定位"与"内容查看"闭环，是节省 driver token 的关键能力。

---

## User Scenarios & Testing *(mandatory)*

> 命名遵循 M7 约定"用户故事:..."；每个故事独立可测，单独实现即构成一个可演示的能力切片。

### User Story 1 — 用户故事:driver 按行区间查看文件节省 token (Priority: P1)

driver 在拿到一个文件路径后，只想看其中某一段（例如某函数所在的行区间），而不是把整文件读进上下文。它调用 `view_file(path, startLine, endLine)`，拿到带行号的切片、文件总行数、以及"是否被截断"的标志。

**Why this priority**: 这是本 Feature 的核心价值——按需查看片段以省 token，是 P1 MVP；其余工具都围绕"看文件"展开。

**Independent Test**: 在 sandbox 中对一个已知文件调 `view_file` 取一个小行区间，断言响应体 byte 长度（estimateTokens 代理）显著小于全文 `Read`（≤ 50%），且切片带行号、含 `totalLines` 与截断标志。

**Acceptance Scenarios**:

1. **Given** 一个 N 行文本文件，**When** 调 `view_file(path, startLine=10, endLine=20)`，**Then** 返回第 10–20 行（含端点）每行带行号前缀，`totalLines=N`，`truncated=false`，且响应 byte 长度 ≤ 全文 `Read` 的 50%。
2. **Given** 同一文件，**When** 不传 `startLine/endLine/symbolId`，**Then** 返回前 200 行（OpenHands 风格默认窗口）+ 当行数 > 200 时 `truncated=true`。
3. **Given** `startLine` 超过文件总行数，**When** 调用，**Then** 返回空切片或最后一行附近的安全响应（不抛错、不越界），并以 warning 标注请求区间超出范围。

---

### User Story 2 — 用户故事:context/impact 拿到 symbol 后 view_file 直接定位定义行段 (Priority: P1)

driver 先用 `context`（或 `impact`）拿到某 symbol 的结构信息（含 graph node 的 `lineRange`），再用 `view_file(path, symbolId)` 直接跳到该 symbol 的定义行段，无需手算行号。响应的 `nextStepHint` 继续引导下一步（例如回到 `context` 看调用方）。

**Why this priority**: 这是"结构定位 → 内容查看"闭环，是本 Feature 相对裸 `Read` 的差异化价值，与 P1 同等重要。

**Independent Test**: 用一个预建 graph fixture，对某 symbol 调 `view_file(path, symbolId)`，断言返回切片的 `startLine/endLine` 等于该 graph node 的 `lineRange`，且 `nextStepHint` 非空。

**Acceptance Scenarios**:

1. **Given** 已建 graph 且存在 symbol `S`（node `lineRange = [a, b]`），**When** 调 `view_file(path, symbolId=S)`，**Then** 返回切片 `startLine=a`、`endLine=b`，并带 `nextStepHint`（非空、≥ 5 字符）。
2. **Given** `symbolId` 在 graph 中不存在，**When** 调用，**Then** 返回结构化错误（`symbol-not-found`），`hint` 引导 driver 改用 line range 或先调 `context`。
3. **Given** 同时传 `symbolId` 与 `startLine/endLine`，**When** 调用，**Then** 以 `symbolId` 的 `lineRange` 为准并以 warning 标注忽略了显式行区间（消歧规则确定、可测）。

---

### User Story 3 — 用户故事:driver 传越界路径被安全拒绝且不泄露 projectRoot 外内容 (Priority: P1)

driver（或被污染的输入）传入一个指向 `projectRoot` 之外的路径（例如 `../../../etc/passwd`，或一个指向外部的 symlink）。3 个工具都必须拒绝该请求，返回错误码 `path-outside-root`，并且响应内容中**不包含目标文件的任何字节**，也不泄露 `projectRoot` 的绝对路径。

**Why this priority**: 路径安全是 LFI（Local File Inclusion）漏洞红线（对抗审查明确指出的最高风险）。MCP 工具直接读文件系统，一旦越界即构成任意文件读取漏洞，必须 P1。

**Independent Test**: 对每个工具传 `../../../etc/passwd` 与一个逃逸 symlink，断言 `isError=true`、`code='path-outside-root'`，且响应文本不含目标文件内容片段（例如 `/etc/passwd` 的 `root:` 字样）。

**Acceptance Scenarios**:

1. **Given** `projectRoot`，**When** 任一工具收到 `path='../../../etc/passwd'`，**Then** `isError=true`、`code='path-outside-root'`，响应不含目标文件字节。
2. **Given** `projectRoot` 内有一个指向外部目录的 symlink `evil`，**When** 调 `view_file('evil/secret')`，**Then** 经 `realpathSync` 解析后判定越界，返回 `path-outside-root`（仅 `path.resolve + startsWith` 无法防住的逃逸也被拦截）。
3. **Given** 绝对路径 `/etc/passwd`，**When** 调用，**Then** 返回 `path-outside-root`（绝对路径也必须落在 `projectRoot` 内）。

---

### User Story 4 — 用户故事:driver 在单文件内 pattern 搜索带上下文行 (Priority: P2)

driver 想在一个文件里找某个标识符/字符串出现的位置，并看到每个命中的前后几行上下文。它调 `search_in_file(path, pattern, isRegex?, maxMatches?, contextLines?)`，拿到 `{line, text, before[], after[]}` 的命中列表。用户正则非法或可能 ReDoS 时，工具安全降级而非崩溃。

**Why this priority**: 单文件内定位是常见导航动作，但优先级低于"按区间看"与"安全红线"，列 P2。

**Independent Test**: 对一个含已知关键字的文件调 `search_in_file`，断言命中列表的行号正确、每条带 before/after 上下文；对非法正则断言返回结构化错误而非异常。

**Acceptance Scenarios**:

1. **Given** 文件含 3 处 `foo`，**When** 调 `search_in_file(path, 'foo', isRegex=false, contextLines=2)`，**Then** 返回 3 条命中，每条含 `line`、`text`、`before`（≤2 行）、`after`（≤2 行）。
2. **Given** `isRegex=true` 且 `pattern` 为非法正则，**When** 调用，**Then** 返回 `invalid-input`（或等价错误码），不抛未捕获异常。
3. **Given** 文件有 1000 处命中且 `maxMatches=50`，**When** 调用，**Then** 仅返回前 50 条并以 warning 标注 `matches-truncated`（`maxMatches` 被 clamp 到安全上界）。

---

### User Story 5 — 用户故事:driver 列目录决定下一步看哪个文件 (Priority: P2)

driver 想了解某目录下有哪些文件/子目录，以决定下一步导航。它调 `list_directory(path, depth?, includeIgnored?)`，拿到 `entries[{name, type, size}]`。默认仅过滤 `.git`（噪声目录）；dotfiles 默认可见（SWE-Bench scaffolding 需要看到三方/隐藏文件），`includeIgnored=true` 时连 `.git` 也纳入。

**Why this priority**: 目录浏览是导航辅助能力，独立可用但非核心省 token 路径，列 P2。

**Independent Test**: 对一个已知结构的目录调 `list_directory`，断言 entries 含正确的 name/type/size，且默认不含 `.git`。

**Acceptance Scenarios**:

1. **Given** 一个含文件与子目录的目录，**When** 调 `list_directory(path)`，**Then** 返回 `entries`，每条含 `name`、`type`（file/dir/symlink）、`size`（dir 可为 null）。
2. **Given** 目录含 `.git` 子目录，**When** 默认调用，**Then** entries 不含 `.git`；当 `includeIgnored=true` 时才包含。
3. **Given** `depth=2`，**When** 调用，**Then** 递归到 2 层（含截断保护，避免超大目录灌爆 payload）。

---

### Edge Cases

- **二进制文件**：`view_file` / `search_in_file` 遇到二进制文件（如含 NUL 字节）→ 返回 `binary-file` 错误码，不把乱码灌进上下文。
- **超大文件**：文件 byte 超 `PAYLOAD_CAP_BYTES` 上界且无法按区间裁剪到安全大小 → 返回 `payload-too-large`，hint 引导改用更小的 line range。
- **文件不存在 / 路径是目录**：`view_file` 收到不存在路径或目录路径 → 返回 `file-not-found`（或 `invalid-input`），不泄露 `projectRoot` 外信息。
- **空文件**：`view_file` 空文件 → `totalLines=0`、空切片、`truncated=false`，不报错。
- **CRLF / 无尾随换行**：切片行号与 `totalLines` 计数对 `\n` 与 `\r\n` 一致（行计数规则确定可测）。
- **symlink 在 projectRoot 内但指向 projectRoot 内**：允许（realpath 后仍在根内）；指向根外才拒绝。
- **search_in_file 空 pattern**：返回 `invalid-input`。
- **list_directory 路径是文件**：返回 `invalid-input`（不是目录）。
- **enrichment / telemetry 失败**：`nextStepHint` 生成或 telemetry 写入失败**不得**升级为 handler error（沿用 F170c `safeStderrLog` / 静默降级约定，标 `_enrichmentDegraded`）。
- **空目录**：`list_directory` 空目录 → `entries=[]`，不报错。

---

## Requirements *(mandatory)*

### Functional Requirements

#### A. 工具能力（核心）

- **FR-001** `[必须]`: 系统 MUST 提供 `view_file(path, startLine?, endLine?, symbolId?)` 工具，返回带行号前缀的文件切片、`totalLines`、以及 `truncated` 截断标志。（US1, US2）
- **FR-002** `[必须]`: `view_file` 在不传任何定位参数（`startLine/endLine/symbolId` 全缺）时 MUST 默认返回前 200 行，并在文件超 200 行时置 `truncated=true`（对标 OpenHands 默认窗口）。（US1）
- **FR-003** `[必须]`: `view_file` 收到 `symbolId` 时 MUST 经 graph 解析出该 symbol 的 `lineRange` 并以其为切片区间；消歧规则 MUST 确定且可测：(a) `symbolId` 与显式 `startLine/endLine` 同时存在 → 以 `symbolId` 为准并追加 warning `symbolId-overrides-lines`；(b) `symbolId` 解析出的文件与显式 `path` 不一致 → 返回 `invalid-input`（不静默以某一方为准），hint 说明二者矛盾。（US2, W-2）
- **FR-004** `[必须]`: 系统 MUST 提供 `search_in_file(path, pattern, isRegex?, maxMatches?, contextLines?)` 工具，返回 `{line, text, before[], after[]}` 命中列表。（US4）
- **FR-005** `[必须]`: `search_in_file` MUST 对非法正则做 `try/catch` 返回 `invalid-input`；并 MUST 用**可实现的 ReDoS 缓解合同**（不依赖 try/catch——JS catastrophic backtracking 不抛异常而是同步卡死进程）：限制 `pattern` 长度上界 + 限制被搜索内容 byte 上界 + 拒绝已知高危结构（如嵌套量词 `(a+)+`、`(.+)*`）的启发式。spec 明示这是"启发式拒绝 + 输入界限"而非完整 ReDoS 证明（受 0 新依赖约束）。（US4, C-3）
- **FR-006** `[必须]`: 系统 MUST 提供 `list_directory(path, depth?, includeIgnored?)` 工具，返回 `entries[{name, type, size}]`。（US5）
- **FR-007** `[必须]`: `list_directory` MUST 默认仅过滤 `.git`（不默认过滤 `node_modules/dist`，以兼容 SWE-Bench scaffolding 看三方代码场景）；dotfiles 默认可见；`includeIgnored=true` 时纳入 `.git`。`depth` 递归 MUST 带截断保护。（US5, W-1, openQuestion）
- **FR-008** `[必须]`: 数值参数 MUST 有确定的 `[min, max, default]` clamp 合同，非法值（负数 / 0 / NaN / 超上界）一律 clamp 到合法区间并在 `warnings` 标注被 clamp 的字段：`maxMatches`（默认/上界确定，clamp→`matches-truncated`）、`contextLines`（≥0、有上界）、`depth`（≥1、有上界，超大目录截断标 `listing-truncated`）。（US4, US5, W-3）

#### B. 路径安全（🔴 最高优先级红线）

- **FR-010** `[必须]`: 所有 3 个工具的 `path` 参数 MUST 经统一 `resolveSafePath(projectRoot, userPath)`，containment 判定 MUST 满足以下全部约束（C-1，**判定顺序见 FR-013**）：
  - (a) 先对 `projectRoot` 本身求 `realpathSync`（记 `realRoot`），再对候选路径 `path.resolve(realRoot, userPath)` 后求 `realpathSync`（记 `realCandidate`）——`projectRoot` 自身是 symlink 时也不可被绕过；
  - (b) containment 用 `rel = path.relative(realRoot, realX)` 判定不以 `..` 开头且 `!path.isAbsolute(rel)`——**禁止**用裸 `startsWith(realRoot)`（避免 `/repo` 误判 `/repo2` 前缀碰撞）。`rel === ''`（候选即根本身）视为 **contained**（合法），由工具层据 `stat` 决定 file/dir 语义（`view_file` 对目录返回 `invalid-input`，`list_directory` 对根合法）；
  - (c) 入参含 NUL（`\0`）字节 MUST 直接返回 `invalid-input`；
  - (d) **不** URL-decode 用户路径（明示语义：`%2e%2e` 等编码变体按字面处理，不解码逃逸）；
  - (e) **目标平台仅 posix（darwin/linux）**；Windows 大小写/分隔符归一化为 **YAGNI 不实现**（本仓库不跑 Windows），containment 的可移植内核是 `path.relative` 判定，已足够。（US3）
- **FR-011** `[必须]`: 路径越界（含 `../` 逃逸、绝对路径越界、symlink 逃逸、前缀碰撞）MUST 返回新错误码 `path-outside-root`，且响应内容 MUST NOT 包含 `projectRoot` 外任何文件字节，MUST NOT 泄露 `projectRoot` 绝对路径。（US3）
- **FR-012** `[必须]`: 仅 `path.resolve + startsWith` 不构成合规实现——MUST 通过 `realpathSync`（含对 `realRoot` 的解析）+ `path.relative` 防住 symlink 逃逸与前缀碰撞（对抗审查指出的具体绕过路径）。（US3）
- **FR-013** `[必须]`: **判定顺序（修 Codex PATH-CLASSIFICATION）**：MUST 先做**词法层** containment——对 `path.resolve(realRoot, userPath)` 求 `rel = path.relative(realRoot, ...)`，若词法上已逃逸（`..` 开头 / 绝对越界）→ 立即返回 `path-outside-root`（**先于** 任何 `realpathSync`，确保越界且不存在的路径不会被误判为 `file-not-found`、也不触碰 fs）。仅当词法在根内时，再 `realpathSync` 穿透 symlink：ENOENT → `file-not-found`；穿透后 realpath 仍逃逸（symlink 逃逸）→ `path-outside-root`。（US3, C-1/C-2）
- **FR-015** `[必须]`（implement 阶段 Codex CRITICAL 加固）: 安全边界 `projectRoot` **MUST NOT** 暴露为 MCP 客户端可传参数（不进 3 个工具 input schema），固定为 server 启动 cwd；否则客户端可传 `projectRoot='/'` 把 LFI 边界放大到全盘。内部/测试经 handler 函数签名注入。`path` 长度 MUST ≤ `MAX_PATH_LENGTH`（4096）；用户正则作用内容 MUST ≤ `MAX_REGEX_CONTENT_BYTES`（2MB，ReDoS 缓解）。（US3, C-1/W1）
- **FR-014** `[必须]`: **所有** file-nav ErrorCode 路径（不只 `path-outside-root`）MUST 脱敏：MUST NOT 返回绝对路径、stack trace、raw errno path、或 `projectRoot` 外任何字节。`internal-error` 的 message MUST redacted（不回传 `err.message`/stack 原文，区别于 agent-context-tools.ts 现有 `internal-error` 模式）。文件读取 MUST 以已验证的 realpath 为操作路径（缩小 TOCTOU 窗口；残余 TOCTOU 风险在 spec 明示为接受边界）。（US3, C-2）

#### C. 响应合约（复刻 agent-context-tools.ts 约定）

- **FR-020** `[必须]`: 3 个工具 MUST 复用既有 `ToolResult` envelope `{ content: [{type:'text', text: JSON}], isError? }` 与 `buildErrorResponse(code, message, hint?, context?)` 形态。**现状冲突解决（C-4）**：`ToolResult` / `ErrorCode` / `buildErrorResponse` / `buildSuccessResponse` / `PAYLOAD_CAP_BYTES` 当前是 `agent-context-tools.ts` 私有符号（仅 `recordAndReturn` 已 export），与"复用"+"不污染"矛盾。解决方案 MUST 是：把这些共享原语抽到新共享模块（建议 `src/mcp/lib/tool-response.ts`），`agent-context-tools.ts` 与 `file-nav-tools.ts` 都从该共享模块导入（这是抽取共享层而非把 file-nav 业务逻辑塞进 agent-context-tools，符合"不污染"语义）。具体模块边界由 plan 阶段拍板。
- **FR-021** `[必须]`: 响应 payload 超 `PAYLOAD_CAP_BYTES` 时 MUST 截断可截断数组并追加 `warnings` 含 `payload-truncated`（复刻既有 cap 行为）；无法裁剪到安全大小返回 `payload-too-large`。`search_in_file` 截断 MUST 明确策略：先按 `maxMatches` 限条数，仍超 cap 再按字节裁剪命中列表，响应 MUST 含 `totalMatches`（命中总数）与 `returnedMatches`（实返条数）以让 driver 知晓被截断。（W-4）
- **FR-022** `[必须]`: 3 个工具 MUST 接入 Feature 158 telemetry（经 `recordAndReturn` 记录 toolName / requestSize / responseSize / durationMs / runId / errorCode）。`recordAndReturn` 若需跨模块复用 MUST 以导出方式复用而非复制实现（避免 F170c 同类漂移）。
- **FR-023** `[必须]`: telemetry 写入与 enrichment 计算失败 MUST 静默降级，不升级为 handler error（沿用 `safeStderrLog` 约定）。

#### D. Description 合约（F170c 4 要素）

- **FR-030** `[必须]`: 3 个工具的 description MUST 满足 F170c 4 要素：① 一句 lead-in 概述；② `Use this tool when:` 段含 ≥ 3 条 bullet；③ `Example:` 段（Input/Output 示例）；④ `Typical chained usage:` 段且含 `→` 链路。
- **FR-031** `[必须]`: 3 个工具的 description 字符长度 MUST 落在 `[100, 500]` 区间。
- **FR-032** `[必须]`: `view_file` 的 chained usage MUST 体现 `impact/context → view_file(symbolId)` 闭环，与 `nextStepHint` 引导风格一致。

#### E. nextStepHint 引导

- **FR-040** `[应该]`: `view_file`（至少）SHOULD 返回 `nextStepHint`，**复用 `generateNextStepHint` 的引导风格**（lead-in + 下一步建议）。为避免破坏 `generateNextStepHint` 现有 typed union（`'impact'|'detect_changes'|'context'`，response-helpers.ts:84）并触发 breaking change，本 Feature 默认在 `file-nav-helpers.ts` 实现**独立的、风格一致的** hint 函数，不修改 `response-helpers.ts`。（W-5）
- **FR-041** `[必须]`: 仅当实现选择直接扩展 `generateNextStepHint` / 触及 `response-helpers.ts` 时，MUST 先补齐 F170c 的 empty-list hint 分支盲点（`detect_changes` 空 `topImpacted`、`context` 空 `callers`、`maxItems<=0`），使 `response-helpers.ts` branch 覆盖回到 ≥ 80% 门槛，否则改 hint 无回归护栏。按 FR-040 默认路径（独立 hint）则不触发本条；plan 阶段明确选哪条路径。（回归护栏, W-5）

#### F. 模块边界与接线

- **FR-050** `[必须]`: 工具 handler MUST 落在新建独立模块 `src/mcp/file-nav-tools.ts`（导出 `registerFileNavTools`）。"不污染 `agent-context-tools.ts`" 的精确语义：MUST NOT 把 file-nav 的业务逻辑（handler / schema / description）写进 `agent-context-tools.ts`；但**允许**为消除 C-4 私有符号冲突而把共享响应原语（`ToolResult`/`buildErrorResponse`/`PAYLOAD_CAP_BYTES` 等）从 `agent-context-tools.ts` 抽到共享 lib 并双向复用（这是去重而非污染）。
- **FR-051** `[必须]`: 纯计算逻辑（`sliceLines`+行号 / `matchInFile` / `buildDirListing` / `resolveSafePath` / `estimateTokens`）MUST 抽到 `src/mcp/lib/file-nav-helpers.ts`（对标 `response-helpers.ts`，便于 ≥95% 单测）。
- **FR-052** `[必须]`: `src/mcp/server.ts` MUST 在 `registerAgentContextTools(server)` 之后调用 `registerFileNavTools(server)`，并更新工具计数注释。

#### G. YAGNI 标注说明

- 上述 FR 中标 `[必须]` 者去掉即破坏核心需求（省 token 导航 / 安全红线 / 响应合约一致性）。
- `[应该]`（FR-040）：去掉 `nextStepHint` 仍可用，但损失链路引导价值，保留为 SHOULD。
- `[YAGNI-移除]`：本迭代**不做** 跨文件搜索（`search_in_file` 仅单文件，对标 blueprint）、不做文件写入/编辑工具、不做 `list_directory` 的 glob 过滤——超出 MVP，移除以控复杂度。

---

### Key Entities

- **FileSlice**: `view_file` 的核心返回——`{ lines: string[]（带行号前缀）, startLine, endLine, totalLines, truncated }`。
- **SearchMatch**: `search_in_file` 命中项——`{ line, text, before: string[], after: string[] }`。
- **DirEntry**: `list_directory` 条目——`{ name, type: 'file'|'dir'|'symlink', size: number|null }`。
- **SafePathResult**: `resolveSafePath` 输出——解析后的绝对路径（在根内）或越界信号。

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 4 个 E2E 用户故事（US1 token 节省 / US2 symbolId 定位 / US3 路径越界拒绝 / US4-或-description 合约）全部 pass。
- **SC-002**: `view_file` 按 line range 的**响应 UTF-8 bytes / `estimateTokens` 代理值** ≤ 同文件全文 `Read` 的 50%（sandbox 无真实 LLM，仅声明代理断言，**不声称真实 LLM token**；真实 token 对比由 `HOST_E2E` gate 控制，默认 skip）。（I-1）
- **SC-003**: 越界路径（`../../../etc/passwd` / 逃逸 symlink / 绝对路径越界 / 前缀碰撞 `/repo2`）100% 返回 `path-outside-root` 且响应不含目标文件字节。
- **SC-004**: 3 个工具 description 全部满足 F170c 4 要素且长度落在 `[100, 500]`（captureTools 静态断言）。
- **SC-005**: 新增模块 `file-nav-tools.ts` 与 `file-nav-helpers.ts` 的单测 per-file 覆盖率 ≥ 95%。
- **SC-006**: 若触及 `response-helpers.ts`，其 branch 覆盖回到 ≥ 80%。
- **SC-007**: 现有全量 vitest **零失败**（当前基线 ~3859 pass，数字仅参考、以零失败为准）+ `npm run build` + `npm run repo:check` + `npm run release:check` 零回归。（I-3）
- **SC-008**: Codex 阶段性对抗审查 critical 全部修复。
- **SC-009**: `resolveSafePath` 安全矩阵逐项 pass——至少覆盖：`../` 逃逸 / 绝对路径越界 / projectRoot 内 symlink 指向根外 / projectRoot 自身为 symlink / 前缀碰撞 `/repo` vs `/repo2` / NUL 字节 / `%2e%2e` 字面不解码 / 根内合法 symlink 放行。（I-2）

---

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**: 2 个新增模块（`file-nav-tools.ts` handler 层 + `file-nav-helpers.ts` 纯函数层）+ 对 `server.ts` 1 行接线。→ 3
- **接口数量**: 3 个 MCP 工具对外接口 + ~5 个 helper 纯函数（`sliceLines` / `matchInFile` / `buildDirListing` / `resolveSafePath` / `estimateTokens`）+ 1 个新错误码 `path-outside-root`。
- **依赖新引入数**: 0（仅用 Node 内置 `fs`/`path`；复用现有 graph 数据与 telemetry）。
- **跨模块耦合**: 复用（导出）`agent-context-tools.ts` 的 `recordAndReturn`/`buildErrorResponse` 形态 + `response-helpers.ts` 的 `generateNextStepHint`；触及现有模块接口 ≥ 1（需把 telemetry helper 提为可复用导出）。
- **复杂度信号**: 无递归状态机 / 无并发控制 / 无数据迁移；唯一非平凡点是**路径安全**（安全敏感但逻辑确定）+ `depth` 目录递归（有界）。
- **总体复杂度**: **MEDIUM**（组件 3 / 接口 ~9 / 1 个安全敏感点）。安全红线要求 GATE_DESIGN 人工确认路径安全 FR（FR-010~012）措辞无遗漏。

---

## 与现有架构的一致性约束

- 错误码体系扩展自 `agent-context-tools.ts` 既有 `ErrorCode` union（新增 `path-outside-root`、`binary-file`、`file-not-found`；复用 `payload-too-large`/`invalid-input`/`internal-error`）。
- telemetry 走 Feature 158 `TelemetryEntry` schema + `recordAndReturn` 包装。
- description 走 F170c 4 要素；`nextStepHint` 走 `response-helpers.ts` 风格。
- 模块分层对标 `response-helpers.ts`（纯函数）/ `agent-context-tools.ts`（handler），便于高覆盖单测。

## 未决问题（plan 阶段拍板）

1. **list_directory 默认过滤**：建议默认仅过滤 `.git` + `includeIgnored` 开关（兼容 SWE-Bench 看三方代码）。【blueprint 推荐】
2. **view_file 是否写进 F170d `preference-rules.md`（R5 行）**：触碰 `plugins/spec-driver` 需 `repo:sync`，plan 决定是否纳入本 Feature 范围。
3. **view_file 无定位参数默认行为**：建议前 200 行 + `truncated` 标志（对标 OpenHands）。【已在 FR-002 暂定，plan 复核】
