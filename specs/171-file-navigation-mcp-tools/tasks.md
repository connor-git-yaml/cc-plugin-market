# Tasks: File Navigation MCP Tools（view_file / search_in_file / list_directory）

**Input**: `specs/171-file-navigation-mcp-tools/{spec.md, plan.md}`
**Tests**: 已在 spec 显式要求（SC-001/005/009），全程 TDD。
**TDD 顺序（M7 强制）**: RED（`test(171): E2E test scaffolding — RED phase`）→ GREEN（`feat(171): implement file navigation tools — GREEN phase`）→ REFACTOR（`refactor(171): extract shared telemetry + constants`）。

## Format: `[ID] [P?] [Story] Description`
- **[P]**: 可并行（不同文件、无依赖）
- 路径均为仓库根相对路径

---

## Phase 1: RED — 测试脚手架（commit `test(171): E2E test scaffolding — RED phase`）

> 先写测试并确认全部 FAIL（模块尚不存在）。e2e 必须用 `.e2e.test.ts` 后缀才进 vitest e2e project。

- [ ] **T001** [P] [US1-4] 新建 `tests/e2e/feature-171-file-navigation.e2e.test.ts`：
  - 用户故事:driver 用 view_file 按 line range 看文件 → sandbox 用 `estimateTokens`/byteLength 代理断言响应 ≤ 全文 Read 50%（SC-002）
  - 用户故事:context 拿 symbol 后 view_file(symbolId) → 切片 startLine/endLine == graph node lineRange + nextStepHint 非空（用预建 graph fixture）
  - 用户故事:driver 传越界路径 `../../../etc/passwd` → isError + code=`path-outside-root`，响应不含目标文件字节（SC-003）
  - 用户故事:3 工具 description 满足 F170c 4 要素（captureTools mock McpServer，长度 [100,500] + Use when ≥3 bullet + Example + chained `→`）（SC-004）
  - HOST_E2E gate：`describe.skipIf(!process.env.HOST_E2E)` 包真实 driver token 对比块（对标 F170d，默认 skip）
- [ ] **T002** [P] 新建 `tests/unit/mcp/file-nav-helpers.test.ts`：
  - `resolveSafePath` 安全矩阵（SC-009，逐项）：`../` 逃逸 / 绝对越界 / 根内 symlink 指向根外 / projectRoot 自身 symlink / 前缀碰撞 `/repo` vs `/repo2` / NUL 字节→invalid-input / `%2e%2e` 字面不解码 / 根内合法 symlink 放行 / **越界且不存在→path-outside-root（非 file-not-found，FR-013 顺序）** / 根本身 rel==''→contained
  - `sliceLines`：区间切片+行号 / 默认前 200 行+truncated / startLine 超 totalLines / 空文件 / CRLF 与 LF 行计数一致
  - `matchInFile`：literal / regex / 非法 regex→invalid-input / ReDoS 启发式拒绝（`(a+)+$` 类）/ maxMatches clamp→matches-truncated / contextLines before/after
  - `buildDirListing`：entries name/type/size / 默认过滤 .git / includeIgnored=true 含 .git / depth 递归 + 截断 / 空目录 / 路径是文件→invalid-input
  - `isBinary`（NUL 探测）/ `estimateUtf8ByteTokens` / `clampInt` 边界（负/0/NaN/超界）
- [ ] **T003** [P] 新建 `tests/unit/mcp/file-nav-tools.test.ts`：mock McpServer 捕获注册；3 handler 编排：
  - 成功 envelope / telemetry `recordAndReturn` 被调用（注入 SPECTRA_MCP_TELEMETRY_PATH 断言写 JSONL）
  - **6 条错误码 redaction 断言（修 Codex CRITICAL-2 / FR-014）**：`path-outside-root`/`file-not-found`/`invalid-input`/`binary-file`/`payload-too-large`/`internal-error` 响应 text **均不含**绝对路径、stack、raw errno/ENOENT path、projectRoot 字符串
  - **payload-too-large（修 CRITICAL-1）**：3 个 handler 在 buildSuccessResponse 后仍超 cap → 返回 `payload-too-large`（mock 一个超大 entries/matches/lines 触发）
  - **binary-file**：`view_file` 与 `search_in_file`（修 WARNING-3）对二进制文件均→`binary-file`
  - **symbol-not-found（修 WARNING-4 / US2）**：`view_file(symbolId)` symbolId 不存在→`symbol-not-found` + hint
  - symbolId 与 path 不一致→invalid-input / symbolId+显式行→warning
- [ ] **T004** [P] 新建 `tests/unit/mcp/tool-response.test.ts`（修 COVERAGE-BLINDSPOT）：`buildSuccessResponse` 截断循环多轮收缩 / `progressed=false` break / 加 `payload-truncated` warning / 无法裁剪→由 handler 返回 `payload-too-large`；`buildErrorResponse` 形态 + 3 新 ErrorCode
- [ ] **T005** 运行 `npx vitest run --project unit --project e2e`，确认 T001-T004 **全部 FAIL**（import 不存在），提交 RED commit

---

## Phase 2: GREEN — 共享层抽取（commit 起始 `feat(171): ...`，先解锁 C-4 + 解耦）

- [ ] **T006** 新建 `src/mcp/lib/tool-response.ts`：从 `agent-context-tools.ts` 移出 `ToolResult` / `ErrorCode`（9 码 + 新增 `path-outside-root`/`binary-file`/`file-not-found`）/ `buildErrorResponse` / `buildSuccessResponse`（含内嵌 payload-cap 截断循环）/ `PAYLOAD_CAP_BYTES`，全部 `export`
- [ ] **T007** 新建 `src/mcp/lib/telemetry.ts`：从 `agent-context-tools.ts` 移出 `TelemetryEntry` / `writeTelemetry` / `recordAndReturn` / `extractErrorCode`（`import type { ToolResult } from './tool-response.js'`，无循环）
- [ ] **T008** 改 `src/mcp/agent-context-tools.ts`：删除已移出的本地定义，改为从 `tool-response.js` + `telemetry.js` import；**保留向后兼容 re-export（修 Codex WARNING-1）**：`export { writeTelemetry, recordAndReturn, type TelemetryEntry } from './lib/telemetry.js'`——`tests/unit/mcp/telemetry.test.ts:33` 现从 agent-context-tools.js import 这三者，re-export 保证零测试改动。运行既有 `tests/unit/mcp-server.test.ts` + `tests/unit/mcp/*` + `tests/integration/mcp-server-stdio.test.ts` 确认绿（抽取无回归）

---

## Phase 3: GREEN — 纯函数层 `src/mcp/lib/file-nav-helpers.ts`（让 T002 转绿）

- [ ] **T009** [US3] 实现 `resolveSafePath(projectRoot, userPath)`：按 plan 8 步（NUL→invalid-input / 不解码 / realRoot / **词法 containment 先于 fs / ENOENT→file-not-found / realpath 逃逸→path-outside-root / rel==''→contained**）。返回判别联合 `SafePathResult`。脱敏（FR-014）
> 注：T010-T013 同写 `file-nav-helpers.ts`，**非并行**（同文件，去掉误导性 [P]，顺序实现）。
- [ ] **T010** [US1] 实现 `sliceLines`（行号前缀 + totalLines + truncated + 默认 200 窗口 + 超界安全）/ `estimateUtf8ByteTokens`（byte/4，避开 token-counter.ts 的 estimateTokens 命名碰撞）/ `isBinary`（NUL 探测）
- [ ] **T011** [US4] 实现 `matchInFile`（literal/regex + 非法 regex try/catch→invalid-input + ReDoS 启发式 [pattern 长度上界 + content byte 上界 + 嵌套量词探测] + maxMatches clamp + before/after + totalMatches/returnedMatches）
- [ ] **T012** [US5] 实现 `buildDirListing`（entries{name,type,size} + 默认过滤 .git + includeIgnored + depth 递归+截断 listing-truncated）/ `clampInt`
- [ ] **T013** [US2] 实现 `buildFileNavHint(toolName, responseData)`（FR-040 独立 hint，风格对齐 generateNextStepHint，**不改 response-helpers.ts**）

---

## Phase 4: GREEN — Handler 层 `src/mcp/file-nav-tools.ts` + 接线（让 T001/T003 转绿）

- [ ] **T014** [US1-5] 实现 3 个 Zod input schema + 3 handler。**统一 payload-too-large 合同（修 CRITICAL-1）**：每个 handler 在 `buildSuccessResponse` 后用 `Buffer.byteLength(text)` 复核，仍 > PAYLOAD_CAP_BYTES → 返回 `buildErrorResponse('payload-too-large', ...)`：
  - `view_file`：resolveSafePath → 目录→invalid-input → isBinary→binary-file → (symbolId 解析 graph lineRange / symbolId 不存在→symbol-not-found / 消歧 / 默认 200) → sliceLines → buildSuccessResponse(['lines']) → cap 复核 → buildFileNavHint → recordAndReturn
  - `search_in_file`：resolveSafePath → **isBinary→binary-file（修 WARNING-3）** → matchInFile → buildSuccessResponse(['matches']) → cap 复核 → recordAndReturn
  - `list_directory`：resolveSafePath → stat 确认目录（非目录→invalid-input） → buildDirListing → buildSuccessResponse(['entries']) → cap 复核 → recordAndReturn
  - 全部错误走 `buildErrorResponse`（**脱敏 FR-014**：message 不含绝对路径/stack/errno path）；handler 保持薄编排（OS/错误分支已下沉 helpers，保 95% 可达）
- [ ] **T015** [US1-5] 3 个 description（F170c 4 要素，[100,500]，`view_file` chained 段含 `context → view_file(symbolId)`）+ `export function registerFileNavTools(server)`
- [ ] **T016** 改 `src/mcp/server.ts`：`registerAgentContextTools(server)` 后加 `registerFileNavTools(server)`，更新顶部"N 个工具"注释
- [ ] **T017** 改 `tests/unit/mcp-server.test.ts:78` sorted 数组加 `list_directory`/`search_in_file`/`view_file`；改 `tests/integration/mcp-server-stdio.test.ts` tools/list 计数 ≥9→≥12 并断言含 3 新工具

---

## Phase 5: GREEN — 覆盖率门 + 全量验证

- [ ] **T018** 改 `vitest.config.ts` coverage.thresholds 加 glob key：`src/mcp/file-nav-tools.ts` 与 `src/mcp/lib/file-nav-helpers.ts` 各 `{branches/functions/lines/statements: 95}`（SC-005）
- [ ] **T019** 运行 `npx vitest run`（全量）+ `npm run test:coverage` 确认：T001-T004 全绿、file-nav 两文件 per-file ≥95%、全量零失败（SC-007）。提交 GREEN commit
- [ ] **T020** （FR-041 条件护栏）确认实现走默认独立 hint、**未触** `response-helpers.ts`；若曾触及则先补 F170c 空列表分支回 ≥80%（SC-006）。本 Feature 预期不触发

---

## Phase 6: REFACTOR（commit `refactor(171): extract shared telemetry + constants`）

- [ ] **T021** 常量集中（默认 200 窗口 / maxMatches 上界 / pattern 长度上界 / depth 上界等提为命名常量）+ 残余去重 + 命名收敛（telemetry/tool-response 已在 GREEN 抽出，本阶段仅 cleanup）
- [ ] **T022** 运行**完整交付门（修 Codex CRITICAL-3 / SC-007）**：`npx vitest run` + `npm run build` + `npm run repo:check` + `npm run release:check` 全部零失败，提交 REFACTOR commit。（注：本 Feature 仅新增 src/tests，未改 release-contract / plugin metadata，release:check 应天然绿；repo:sync 仅在意外触及 source-of-truth 时才需）

---

## Phase 7: 阶段性 Codex 审查（每 phase commit 前）

- [ ] **T023** 每个 commit（RED/GREEN/REFACTOR）前跑 `codex:codex-rescue` 对抗审查，critical 全修后再 commit（implement 阶段 review 重点：回归/漏洞/边界遗漏，尤其路径安全）

---

## Dependencies & Execution Order

- **RED（T001-T005）** 先行，全 FAIL 后才进 GREEN
- **共享层（T006-T008）** 阻塞 helpers/tools（C-4：buildErrorResponse 等私有符号必须先抽出 export）
- **helpers（T009-T013）** 阻塞 handler（T014 编排依赖 helpers）；T009 阻塞 T014 的 view_file 路径校验
- T010-T013 同写 `file-nav-helpers.ts`，顺序实现（非并行）；T009 的 resolveSafePath 阻塞 T014 view_file 路径校验
- **handler+接线（T014-T017）** → **覆盖门（T018-T020）** → **REFACTOR（T021-T022）**
- T023 贯穿每个 commit

## FR → Task 映射（可追踪）

| FR | Tasks |
|----|-------|
| FR-001/002/003（view_file） | T010, T014, T015 |
| FR-004/005/008（search_in_file + clamp） | T011, T012, T014 |
| FR-006/007（list_directory） | T012, T014 |
| FR-010~014（路径安全红线） | T009, T002（安全矩阵） |
| FR-020/021（响应合约 + cap） | T006, T004, T014 |
| FR-022/023（telemetry + 静默降级） | T007, T003 |
| FR-030~032（description 4 要素） | T015, T001 |
| FR-040/041（hint + 护栏） | T013, T020 |
| FR-050/051/052（模块边界 + 接线） | T006-T008, T014-T016 |

## GATE_TASKS 摘要

- 23 个任务，6 个实现 phase + RED 前置 + 贯穿 Codex 审查
- 关键阻塞链：共享层抽取（C-4）→ helpers → handler；安全 FR 全部前置到 T009 + 安全矩阵 T002
- openQuestion #2（view_file 写入 preference-rules.md）= **本 Feature 不做，列 follow-up**（plan 决策，GATE_TASKS 可复议）
