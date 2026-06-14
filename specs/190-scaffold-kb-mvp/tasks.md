---
feature_id: 190
name: scaffold-kb MVP — 任务分解（修订版）
status: draft
created: 2026-06-14
revised: 2026-06-14
phase: tasks
---

# Feature 190 — scaffold-kb MVP：任务清单（修订版）

## 修订说明（按 Codex 对抗审查发现）

本版相较初版做以下结构性修正：

### CRITICAL 修正（6 条）

**C-1（T015 缺依赖 T008）**：`buildKb()` 串联流水线中 ChunkSplitter（T008）是必要前置，将 T008 补入 T015 依赖列表。

**C-2（Phase A/B 边界错误）**：原版 T029/T030/T031 recall 验收调用 `kb_search`，但 `kb_search`（T041）到 Phase B 才实现，形成无法在 Phase A 执行的门禁。修法：
- Phase A 新增 `searchKbCore`（纯单库查询核，路径 `src/scaffold-kb/search-core.ts`，包含 normalizeForIndex → FTS5 MATCH → 单库查询 → LIKE 兜底 → 返回排序 chunk 列表，不含双库 merge/MCP envelope/telemetry）
- QuerySanitizer（原 T034/T035）移到 Phase A，因为它是 searchKbCore 的纯逻辑依赖，无 MCP 依赖
- recall 判定脚本（T027）依赖 `searchKbCore`，而非 `kb_search`
- Phase B 的 `kb_search`（T041）改为：包装 `searchKbCore` + 双库 result-merger + evidence envelope + token cap + telemetry + MCP 注册
- result-merger（T036/T037）保持 Phase B（双库逻辑依赖双库上下文）

**C-3（T056 漏依赖）**：Phase A codex 审查依赖由原来的 T031+T020 改为 T029+T030+T031+T020（SC-005/006 阻塞门全覆盖）。

**C-4（门禁/审查时序倒挂）**：实现完成 → T052(E2E)/T054(性能) → T057(Phase B codex 审查) → 处置修复 → T055(全量门禁，最终) → commit。codex 审查在最终门禁之前，使修复纳入门禁。

**C-5（FR-016 双层联查"挂名覆盖"）**：新增 T058：用 CLI 构建小型项目库 fixture（`<tmp>/.spectra/kb`），再 E2E 验证双层联查（vendor+project 双命中，source_kind 正确区分）。此任务同时是 EC-005 的真实验收载体（"两个 SQLite KB 经 kb_search 双呈现"在真实项目库上验证）。

**C-6（T034/T035 QuerySanitizer 消歧）**：明确：`OR`/`NOT`/`AND`/`NEAR` 经 normalizeForIndex 是普通字母 token（不是 FTS5 操作符），一律按字面双引号包裹查询，**不是** INVALID_QUERY；仅**空串/纯空白/normalize 后无任何字母数字 token** 才返回 INVALID_QUERY。测试注释写清两类行为区分。

### WARNING 处置（择要）

- **T005 碰撞率时序**：固定快照只测已知碰撞对；完整碰撞率审计新增为 T005b，移到 ECharts fixture 构建（T024）后执行。
- **T028 null 防漏**：冻结前强制断言 `expected_doc_ids` 无 null、各 category 数量达标。
- **recall 失败重建回路**：显式声明 T006/normalizeForIndex/searchKbCore 变更会 invalidate T023/T024 fixture，recall 不达标须重建 fixture 再评测。
- **T040 防注入加 buildKb 依赖**：T040 新增 T016 前置（确保 buildKb 可运行防注入 fixture 构建）。
- **T021/T022 源文档卫生**：默认只提交 `kb/` + `FIXTURE.md` + 来源 URL/重建说明，不提交 Hono/ECharts 原始 `source-docs/` 全集；若必须提交原文需加大小阈值 + license 审计。
- **CLI/serve 缺前置测试**：T046a 新增 CLI spawn 测试，覆盖 `spectra scaffold-kb serve --vendor-kb ...` 调用链。
- **T053 措辞**：明确"两库均不存在 → KB_NOT_FOUND"，单库缺失是降级语义非硬失败（与 EC-004 区分）。
- **T018 commit scope**：Phase A commit scope 显式包含 `src/cli/index.ts`。

---

## 提交纪律（所有任务执行时必须遵守）

- **禁止 `git add -A`**：每次 commit 使用显式路径（如 `git add src/scaffold-kb/ tests/kb/`）
- **排除自动再生文件**：确认 `specs/*/src.spec.md` 不在暂存区
- **每 Phase commit 前**：必须运行 codex 对抗审查（`codex:codex-rescue`）
- **Phase A commit scope**：`src/scaffold-kb/` + `src/cli/commands/scaffold-kb.ts` + `src/cli/index.ts`（接线 build 分支）+ `tests/kb/（A 侧）` + `plugins/demo-kb-*/（fixture）` + `specs/190-scaffold-kb-mvp/eval/`
- **Phase B commit scope**：`src/kb-mcp/` + `tests/kb/（B 侧）` + `plugins/demo-kb-*/.mcp.json` + `src/cli/commands/scaffold-kb.ts`（补全 serve 分支）
- **recall 失败重建约定**：若 T029/T030/T031 recall 不达标，修 T006/normalizeForIndex 或 searchKbCore 后，**必须重建 T023/T024 fixture（重跑构建），然后重跑 T028 冻结、T029/T030/T031 验收**，不得用旧 KB 重评

---

## Phase Setup：依赖与脚手架（共 2 个任务）

### T001 — 新增 `@sqlite.org/sqlite-wasm` 依赖

**描述**：在 `package.json` 的 `dependencies` 中新增 `"@sqlite.org/sqlite-wasm"`（锁最新稳定，对应 SQLite 3.53.0，FTS5 已实证可用）；确认 `npm install` 后 `npm run build` 零错误。
**涉及文件**：`package.json`、`package-lock.json`
**依赖任务**：无
**FR/SC/EC**：FR-014（SQLite WASM 依赖约束）
**Phase**：Setup
**并行**：可并行

---

### T002 — 新增测试目录结构与类型声明

**描述**：在 `tests/kb/` 下创建 `.gitkeep` 占位（确保目录入库），并在必要时为 `@sqlite.org/sqlite-wasm` 补充 TypeScript 类型声明（如 `/// <reference types="...">` 或 `src/types/sqlite-wasm.d.ts`）。验证 `npx tsc --noEmit` 零错误。
**涉及文件**：`tests/kb/.gitkeep`、`src/types/sqlite-wasm.d.ts`（按需）
**依赖任务**：T001
**FR/SC/EC**：FR-014
**Phase**：Setup
**并行**：可并行（依赖 T001 完成）

---

## Phase A：构建层（共 32 个任务）

### 阶段目标

实现 `scaffold-kb build` 命令的完整构建流水线（DocumentIngester → ChunkSplitter → DocGraphBuilder → TokenizerPreProcessor → SqliteWriter），新增 Phase A 查询核 `searchKbCore`（供 Phase A recall 验收使用），构建 Hono（英文）和 ECharts（中文）demo fixture，冻结 eval manifest，验证 SC-002/SC-002a/SC-005/SC-006/SC-007。QuerySanitizer 因是 searchKbCore 的纯逻辑依赖（无 MCP 依赖），也在 Phase A 实现。

---

### A-1：sqlite-loader — WASM 初始化与字节落盘/加载（测试先行）

#### T003 — 写失败测试：WASM module 初始化 + FTS5 smoke

**描述**：在 `tests/kb/sqlite-loader.test.ts` 中写失败测试：①`sqlite3InitModule()` 成功初始化并返回 DB 接口；②可执行 `CREATE VIRTUAL TABLE t USING fts5(content)`（FTS5 可用）；③内存 DB 写入后 `sqlite3_js_db_export` 导出字节非空；④读字节后重建 DB 可查询。先运行确认全部 FAIL。
**涉及文件**：`tests/kb/sqlite-loader.test.ts`
**依赖任务**：T002
**FR/SC/EC**：FR-014、SC-011（跨平台 FTS5 smoke）
**Phase**：A
**并行**：无

#### T004 — 实现 `src/kb-mcp/lib/sqlite-loader.ts`

**描述**：实现 `initSqliteModule()`（返回 sqlite3 实例，进程内单例缓存）、`loadDbFromBytes(sqlite3, bytes: Uint8Array) → DB`、`exportDbToBytes(sqlite3, db) → Uint8Array`。不在此实现 FTS5 建表（留 T010）。跑 T003 测试全绿。
**涉及文件**：`src/kb-mcp/lib/sqlite-loader.ts`
**依赖任务**：T003
**FR/SC/EC**：FR-014、SC-011
**Phase**：A
**并行**：无

---

### A-2：tokenizer-preprocessor — `normalizeForIndex` 同构快照（测试先行）

#### T005 — 写失败测试：`normalizeForIndex` 规范化行为

**描述**：在 `tests/kb/tokenizer-preprocessor.test.ts` 中写失败测试，覆盖以下场景（快照断言，固定预期值）：
- CJK 段：`"错误码"` → 含 `"错 误 码 错误 误码"` 各 token
- ASCII 符号段（核心三例）：`"sdk.Init()"` → `["sdk","Init","sdkInit"]`；`"X-Api-Key"` → `["X","Api","Key","XApiKey"]`；`"ERR_AUTH_FAILED"` → `["ERR","AUTH","FAILED","ERRAUTHFAILED"]`
- 短错误码：`"E01"` → `["E01"]`；`"404"` → `["404"]`
- 中英混合：`"鉴权失败 ERR_AUTH_FAILED"` → 两段分别处理后空格拼接
- **已知碰撞对快照**（固定 ≥10 个 ECharts 点号符号）：`xAxis.axisLabel.formatter` 类符号，列出已知会产生相同拼接 token 的对，断言当前实现与快照一致（不要求零碰撞，只锁住已知行为）
先运行确认全部 FAIL。

> 注：完整碰撞率统计（≤2% 审计）移到 ECharts fixture 构建后（T005b），在真实 ECharts 符号集上跑。

**涉及文件**：`tests/kb/tokenizer-preprocessor.test.ts`
**依赖任务**：T002
**FR/SC/EC**：FR-004、SC-005、SC-006、EC-001、EC-002
**Phase**：A
**并行**：可与 T003 并行

#### T006 — 实现 `src/scaffold-kb/tokenizer-preprocessor.ts`（`normalizeForIndex`）

**描述**：实现 `normalizeForIndex(text: string): string` 函数，按字符类型分段处理：
- CJK 连续段 → unigram + bigram（空格分隔）
- ASCII 符号段（含 `._-<>@()/`）→ 各组件 + 拼接形（无原始字面保留，unicode61 下 `.`/`()` 必被切）
- 短 ASCII 码（无分隔符）→ 原样
- 纯英文词 → 原样
最终空格拼接。跑 T005 测试全绿。
**涉及文件**：`src/scaffold-kb/tokenizer-preprocessor.ts`
**依赖任务**：T005
**FR/SC/EC**：FR-004、SC-005、SC-006、EC-001
**Phase**：A
**并行**：无

---

### A-3：chunk-splitter — Markdown 语义切分（测试先行）

#### T007 — 写失败测试：ChunkSplitter 切分行为

**描述**：在 `tests/kb/chunk-splitter.test.ts` 中写失败测试：
- `##`/`###` 标题边界切分，各标题节为独立候选单元
- 超过 400 token（≈ 1600 字符）的标题节按 `\n\n` 进一步切分为段落
- 超大段落（>400 token）按句子兜底切分，不跨语义单元
- `chunk_id` 格式：`doc_id + '#' + anchor`，同一 anchor 下多个 chunk 追加序号（`#error-codes-2`）
- 最小 chunk：不生成 <20 token（<80 字符）的 chunk，自动合并邻近
- 幂等：相同输入相同 `chunk_id` 集合
先运行确认全部 FAIL。
**涉及文件**：`tests/kb/chunk-splitter.test.ts`
**依赖任务**：T002
**FR/SC/EC**：FR-003、FR-005、SC-002、EC-001
**Phase**：A
**并行**：可与 T005 并行

#### T008 — 实现 `src/scaffold-kb/chunk-splitter.ts`

**描述**：实现 `splitDocument(docId: string, markdownContent: string): Chunk[]`，按 plan §4.2 三级切分策略（标题级 → 段落级 → 句子级兜底），生成含 `chunk_id`/`content`/`anchor` 的 chunk 数组。`token` 计量用"约 4 字符 = 1 token"估算。跑 T007 测试全绿。
**涉及文件**：`src/scaffold-kb/chunk-splitter.ts`
**依赖任务**：T007
**FR/SC/EC**：FR-003、FR-005、SC-002
**Phase**：A
**并行**：可与 T006 并行（无文件依赖）

---

### A-4：doc-graph-builder — doc-graph.json 构建（测试先行）

#### T009 — 写失败测试：DocGraphBuilder 节点与边

**描述**：在 `tests/kb/doc-graph-builder.test.ts` 中写失败测试：
- 每个文档页对应一个节点，`id` 稳定唯一（URL path 或文件相对路径）
- `<a href>` 链接提取为 `edges`，`relation` 默认 `"references"`
- `nodes` 包含 `title`/`lang`/`source_url` 字段（`summary`/`tags` 可选）
- `built_at` 为 ISO 8601 字符串
- `schema_version: "1.0"` 字段存在（EC-009 schema_version 可检测）
- 两次构建去 `built_at` 后内容字节级一致（幂等性）
先运行确认全部 FAIL。
**涉及文件**：`tests/kb/doc-graph-builder.test.ts`
**依赖任务**：T002
**FR/SC/EC**：FR-002、FR-005、SC-002、EC-009
**Phase**：A
**并行**：可与 T007 并行

#### T010 — 实现 `src/scaffold-kb/doc-graph-builder.ts`

**描述**：实现 `buildDocGraph(docs: ParsedDoc[]): DocGraph`，产出满足 spec §3.2 结构契约的 `doc-graph.json` 内容对象（含 `schema_version`/`source`/`built_at`/`nodes`/`edges`）。跑 T009 测试全绿。
**涉及文件**：`src/scaffold-kb/doc-graph-builder.ts`
**依赖任务**：T009
**FR/SC/EC**：FR-002、FR-005、SC-002、EC-009
**Phase**：A
**并行**：可与 T008 并行

---

### A-5：sqlite-writer — FTS5 建表与写入（测试先行）

#### T011 — 写失败测试：SqliteWriter FTS5 建表 + 写入 + 幂等

**描述**：在 `tests/kb/sqlite-writer.test.ts` 中写失败测试：
- FTS5 建表结构（`chunks` 虚拟表含 `chunk_id UNINDEXED`/`doc_id UNINDEXED`/`content_raw UNINDEXED`/`content_tokenized`；`chunk_meta` 普通表含全部字段）
- 写入后可用 `MATCH` 查询命中（FTS5 检索可用）
- 中文 `normalizeForIndex` 预处理后写入，查询 `"错误"` 可命中（字符级匹配）
- 幂等：两次写入相同文档后按 `chunk_id` 排序的 chunk 总数/content_raw/doc_id/anchor 一致（禁止用文件哈希——SQLite 二进制不确定）
先运行确认全部 FAIL。
**涉及文件**：`tests/kb/sqlite-writer.test.ts`
**依赖任务**：T004、T006
**FR/SC/EC**：FR-003、FR-005、SC-002
**Phase**：A
**并行**：无（需 T004 WASM + T006 normalize）

#### T012 — 实现 `src/scaffold-kb/sqlite-writer.ts`

**描述**：实现 `writeChunksToSqlite(sqlite3, chunks: Chunk[], meta: ChunkMeta[], outputPath: string)`。建表（见 plan §4.1.2 FTS5 建表策略）、写入 `chunks` 虚拟表（`content_tokenized` 经 `normalizeForIndex` 处理）和 `chunk_meta` 普通表，最后 `sqlite3_js_db_export` 落盘到 `outputPath`。跑 T011 测试全绿。
**涉及文件**：`src/scaffold-kb/sqlite-writer.ts`
**依赖任务**：T011
**FR/SC/EC**：FR-003、FR-005、SC-002
**Phase**：A
**并行**：无

---

### A-6：ingester — llms.txt 解析 + dir 扫描（测试先行）

#### T013 — 写失败测试：DocumentIngester 双模式输入 + 合并去重

**描述**：在 `tests/kb/ingester.test.ts` 中写失败测试：
- `--dir` 模式：扫描目录下 `*.md` 文件，每个文件解析为 `ParsedDoc`（id/title/content/source_url/lang）
- `--llms-txt` 模式：解析 llms.txt 格式（每行 `URL` 或带注释的 `# ...` 行），每个 URL 对应一个文档条目（SC-002a 用 mock/local fixture，不依赖真实外网）
- 两者同时提供：`--llms-txt` 为主，`--dir` 内容也入库，按 `doc_id` 去重
- 参数校验：两者均未提供 → 抛出带用法提示的错误；不提供 `--llms-txt`/`--dir` 时退出非零
- EC-008：llms.txt URL 不可达 → 抛出明确错误，不留中间态产物（原子性）
先运行确认全部 FAIL。

> 同时覆盖 SC-002a CLI 集成：mock llms.txt 作为 fixture，验证 DocumentIngester 的 CLI 路径（不仅是单元）。
**涉及文件**：`tests/kb/ingester.test.ts`
**依赖任务**：T002
**FR/SC/EC**：FR-001、FR-005、SC-002a、EC-008
**Phase**：A
**并行**：可与 T009 并行

#### T014 — 实现 `src/scaffold-kb/ingester.ts`

**描述**：实现 `ingestDocuments(opts: IngestOptions): Promise<ParsedDoc[]>`，覆盖 `--dir`（复用 `src/utils/file-scanner.ts` 的 `scanFiles()` 扫描 `.md` 文件）和 `--llms-txt`（用 Node.js 内置 `fetch` 抓取，解析 llms.txt 格式）。合并去重以 `doc_id` 为准。参数校验（两者均无 → 错误退出）。llms.txt 解析失败 → 不留中间态。跑 T013 测试全绿。
**涉及文件**：`src/scaffold-kb/ingester.ts`
**依赖任务**：T013
**FR/SC/EC**：FR-001、FR-005、SC-002a、EC-008
**Phase**：A
**并行**：可与 T010 并行

---

### A-7：scaffold-kb/index.ts — `buildKb()` 主流程编排

#### T015 — 写失败测试：`buildKb()` 端到端构建流程

**描述**：在 `tests/kb/build-flow.test.ts` 中写失败测试（小型 fixture）：
- `buildKb({ dirPath: '<测试 fixtures/docs/>' })` 产出 `kb/doc-graph.json`（含正确 `schema_version`/`nodes`）和 `kb/chunks.sqlite`（FTS5 可查询）
- 两次构建：`doc-graph.json` 去 `built_at` 后字节级一致；sqlite 按 `chunk_id` 排序后 chunk 集合一致（幂等）
- 输出目录 `--output` 参数可控，默认 `./kb`
先运行确认全部 FAIL。
**涉及文件**：`tests/kb/build-flow.test.ts`
**依赖任务**：T008、T010、T012、T014
**FR/SC/EC**：FR-001、FR-002、FR-003、FR-005、SC-002、SC-002a
**Phase**：A
**并行**：无（需 T008/T010/T012/T014 全部完成）

> 注：T008（ChunkSplitter）已加入依赖（Codex C-1 修正）。

#### T016 — 实现 `src/scaffold-kb/index.ts`（`buildKb()` 主流程）

**描述**：实现 `buildKb(opts: BuildKbOptions): Promise<void>`，串联 ingester → chunk-splitter → doc-graph-builder → tokenizer-preprocessor → sqlite-writer，写出 `kb/doc-graph.json` 和 `kb/chunks.sqlite`（原子性：失败时清理中间态）。跑 T015 测试全绿。
**涉及文件**：`src/scaffold-kb/index.ts`
**依赖任务**：T015
**FR/SC/EC**：FR-001~FR-005、FR-016、SC-002、SC-002a
**Phase**：A
**并行**：无

---

### A-8：CLI 接线 — `scaffold-kb build` 子命令

#### T017 — 实现 `src/cli/commands/scaffold-kb.ts`

**描述**：实现 `runScaffoldKb(command: CLICommand)` 函数，解析子子命令 `build` 和 `serve`（`serve` 实现留 Phase B），分发给 `buildKb()`（`build` 子命令）。参数校验：`--llms-txt` 与 `--dir` 至少一个，否则非零 exit + 用法提示；`--output`/`--sdk-version` 可选。此任务只接线 `build` 分支；`serve` 分支留 Phase B（T046）填充。
**涉及文件**：`src/cli/commands/scaffold-kb.ts`
**依赖任务**：T016
**FR/SC/EC**：FR-001、SC-002、SC-002a
**Phase**：A
**并行**：无

#### T018 — 接线 `src/cli/index.ts`（仅 `build` 分支）

**描述**：在 `src/cli/index.ts` 中新增：①import 行（`:12-28` 区）；②`case 'scaffold-kb':` + `await runScaffoldKb(command)` 分发（`:146-198` 区）；③HELP_TEXT 新增一行 `scaffold-kb` 用法说明（`:43` 区，处理 F186 冲突区——先检查当前状态，追加在已有行之后）。运行 `npx tsc --noEmit` 零错误。

> T018 修改 `src/cli/index.ts`，已纳入 Phase A commit scope（见提交纪律）。
**涉及文件**：`src/cli/index.ts`
**依赖任务**：T017
**FR/SC/EC**：FR-001
**Phase**：A
**并行**：无

---

### A-9：query-sanitizer — FTS5 转义与结构化 MATCH 构造（测试先行，Phase A）

> 根据 C-2 修正：QuerySanitizer 是 searchKbCore 的纯逻辑依赖（无 MCP 依赖），提前到 Phase A 实现。

#### T019a — 写失败测试：QuerySanitizer FTS5 转义行为

**描述**：在 `tests/kb/query-sanitizer.test.ts` 中写失败测试，**明确区分两类行为**：

**类型 1 — reserved words 按字面查询（不是 INVALID_QUERY）**：
- `sanitizeQuery("OR NOT AND")` → `OR`/`NOT`/`AND` 经 normalizeForIndex 后是普通字母 token，产出 `["OR","NOT","AND"]`，MATCH 串为 `"OR" OR "NOT" OR "AND"`（双引号包裹每 token，防 FTS5 操作符语义）
- `sanitizeQuery("NEAR/5 error")` → `NEAR`/`error` 各作普通 token，双引号包裹后 OR 连接，不触发 NEAR 操作符语义

**类型 2 — 真正 INVALID_QUERY（无任何字母数字 token）**：
- `sanitizeQuery("")` → `{ isError: true, code: 'INVALID_QUERY' }`（空串）
- `sanitizeQuery("   ")` → `{ isError: true, code: 'INVALID_QUERY' }`（纯空白）
- `sanitizeQuery("@#$%")` → normalize 后无字母数字 token → `{ isError: true, code: 'INVALID_QUERY' }`

**正常符号转义（各生成 token 列表 + MATCH 串）**：
- `sanitizeQuery("sdk.Init()")` → token 列表 `["sdk","Init","sdkInit"]`，MATCH 串为 `"sdk" OR "Init" OR "sdkInit"`
- `sanitizeQuery("X-Api-Key")` → token 列表 + MATCH 串（双引号包裹每 token）
- `sanitizeQuery("ERR_AUTH_FAILED")` → token 列表 + MATCH 串

先运行确认全部 FAIL。
**涉及文件**：`tests/kb/query-sanitizer.test.ts`
**依赖任务**：T006、T002
**FR/SC/EC**：FR-004、SC-006、EC-002、EC-003
**Phase**：A
**并行**：可与 T011 并行（无文件依赖）

#### T019b — 实现 `src/scaffold-kb/query-sanitizer.ts`

**描述**：实现 `sanitizeQuery(query: string): TokenizedQuery | KbError`。流程：①查询词过 `normalizeForIndex` → token 数组；②每个 token 双引号包裹（`"` 转义为 `""`）；③按 OR 连接（MVP 默认）；④token 数组为空（无字母数字字符）→ 返回 `{ isError: true, code: 'INVALID_QUERY', ... }`。

**关键约定**：`OR`/`NOT`/`AND`/`NEAR` 等 FTS5 操作符词经 normalizeForIndex 是普通字母 token，通过双引号包裹消除其操作符语义，一律按字面查询，**绝不**作为 INVALID_QUERY 处理。实现时不维护 reserved-word 黑名单。

注：此模块放 `src/scaffold-kb/query-sanitizer.ts`（Phase A 逻辑），Phase B 的 `src/kb-mcp/lib/query-sanitizer.ts` 改为 re-export 或直接 import 此实现。跑 T019a 测试全绿。
**涉及文件**：`src/scaffold-kb/query-sanitizer.ts`
**依赖任务**：T019a
**FR/SC/EC**：FR-004、SC-006、EC-002、EC-003
**Phase**：A
**并行**：无

---

### A-10：searchKbCore — Phase A 单库查询核（测试先行）

> 新增，对应 C-2 修正。recall 验收（T029/T030/T031）在 Phase A 执行，需要一个不含 MCP 层的单库查询核。

#### T020a — 写失败测试：`searchKbCore` 单库查询行为

**描述**：在 `tests/kb/search-core.test.ts` 中写失败测试：
- `searchKbCore(db, "错误码", 5)` → 对已写入 CJK 内容的 SQLite DB（小型 fixture）返回 chunk 列表，按 BM25 分排序（负分越小越相关，返回降序排列，即最相关在前）
- `searchKbCore(db, "sdk.Init()", 5)` → 符号经 normalizeForIndex token 化后 MATCH 命中
- `searchKbCore(db, "错", 5)`（单字 CJK，FTS5 结果 < 3）→ 触发 LIKE 兜底，合并去重，非零结果
- `searchKbCore(db, "", 5)` → 返回 INVALID_QUERY 错误（委托给 sanitizeQuery）
- LIKE 兜底：CJK 字符数 ≤ 2 的查询在 FTS5 结果 < 3 时触发 LIKE `%token%`，合并去重，按原有 FTS5 结果优先
先运行确认全部 FAIL。
**涉及文件**：`tests/kb/search-core.test.ts`
**依赖任务**：T004、T012、T019b
**FR/SC/EC**：FR-004、FR-007、SC-005、SC-006、EC-001、EC-002、EC-003
**Phase**：A
**并行**：无（需 sqlite-loader + sqlite-writer + query-sanitizer 完成）

#### T020b — 实现 `src/scaffold-kb/search-core.ts`（`searchKbCore`）

**描述**：实现 `searchKbCore(db: DB, query: string, topK: number): SearchCoreResult[] | KbError`。查询核流程：
1. 调用 `sanitizeQuery(query)` → 若返回 KbError 直接传递
2. 用 MATCH 串对传入 `db`（单个 SQLite DB）执行 FTS5 查询（`SELECT chunk_id, doc_id, content_raw, bm25(chunks) AS score FROM chunks WHERE content_tokenized MATCH ?`）
3. LIKE 兜底：当 query 中 CJK 字符 ≤ 2 且 FTS5 结果 < 3 时，额外执行 `content_raw LIKE ?` 查询并合并去重
4. 按 BM25 分降序排序（最相关在前，注意 bm25() 越负越相关，需 ASC 取负或 (0 - bm25()) DESC 统一为"越大越好"后返回）
5. 关联 `chunk_meta` 获取 `doc_id`/`doc_title`/`anchor`/`source_url`/`built_at`
6. 返回 chunk 列表（不含 MCP envelope、不含 token cap 截断、不含 telemetry）

**关键约束**：不接受 `vendorDb`/`projectDb` 双库参数——此函数只处理单个 DB，双库 merge 留 Phase B 的 result-merger（T037）。跑 T020a 测试全绿。
**涉及文件**：`src/scaffold-kb/search-core.ts`
**依赖任务**：T020a
**FR/SC/EC**：FR-004、FR-007、SC-005、SC-006、EC-001、EC-002、EC-003
**Phase**：A
**并行**：无

---

### A-11：KB 产物隔离断言（测试先行）

#### T020c — 写失败测试：KB 产物隔离（SC-013）

**描述**：在 `tests/kb/kb-isolation.test.ts` 中写失败测试（SC-013 三条机械断言）：
- `buildKb()` 执行前后，读取 `_meta/graph.json` 的 SHA-256 哈希不变
- `chunks.sqlite` 产物路径在 `kb/` 内，与现有任何 SQLite 文件路径无重叠
- （Phase B 时补充）KB MCP 工具名集合（`kb_*`）与现有 17 个 Spectra MCP 工具名集合交集为空
先运行确认第 1、2 条 FAIL（第 3 条留 Phase B）。
**涉及文件**：`tests/kb/kb-isolation.test.ts`
**依赖任务**：T016
**FR/SC/EC**：FR-013、SC-013
**Phase**：A
**并行**：可与 T015 并行

#### T020d — 验证 KB 产物隔离（跑 T020c 前两条）

**描述**：跑 `tests/kb/kb-isolation.test.ts` 中的前两条隔离断言（`_meta/graph.json` 哈希不变 + `chunks.sqlite` 路径不重叠），确认绿。第 3 条（工具名交集）在 Phase B T050 补全。
**涉及文件**：无新增文件（跑测试）
**依赖任务**：T020c、T018
**FR/SC/EC**：FR-013、SC-013
**Phase**：A
**并行**：无

---

### A-12：demo fixture 准备（英文 Hono + 中文 ECharts）

#### T021 — 准备 Hono 英文 fixture 文档（≤50 页）

**描述**：下载/准备 Hono 公开文档（MIT 许可证，自带 `llms.txt`），选取 ≤50 页最具代表性的文档（API 参考、路由、中间件、错误处理等）。默认**只提交 `FIXTURE.md` + 来源 URL/重建说明**（不提交原始 `source-docs/` 全集，避免体积/license 问题）；若确认 license 允许再分发且体积可控，可补充提交 `llms.txt` 索引文件。创建 `plugins/demo-kb-en/FIXTURE.md`（来源 URL/license MIT/文档页数/查询集映射占位）。
**涉及文件**：`plugins/demo-kb-en/FIXTURE.md`、`plugins/demo-kb-en/llms.txt`（或 `source-docs/`，按 license 决定）
**依赖任务**：T016
**FR/SC/EC**：FR-012、SC-001、SC-003、SC-004
**Phase**：A
**并行**：可与 T020c 并行

#### T022 — 准备 ECharts 中文 fixture 文档（≤50 页）

**描述**：下载/准备 Apache ECharts 公开中文文档（Apache-2.0 许可证），选取 ≤50 页（API 配置项如 `xAxis`/`yAxis`/`series`、错误码、初始化文档等，覆盖大量 CJK + 点号符号如 `xAxis.axisLabel.formatter`）。同 T021，默认只提交 `FIXTURE.md` + 来源 URL/重建说明。创建 `plugins/demo-kb-zh/FIXTURE.md`。
**涉及文件**：`plugins/demo-kb-zh/FIXTURE.md`、`plugins/demo-kb-zh/llms.txt`（或 `source-docs/`）
**依赖任务**：T016
**FR/SC/EC**：FR-012、SC-001、SC-003、SC-005、SC-006
**Phase**：A
**并行**：可与 T021 并行

#### T023 — 构建英文 demo fixture（`scaffold-kb build` 产出 `plugins/demo-kb-en/kb/`）

**描述**：用已实现的 `buildKb()` 运行 `spectra scaffold-kb build --dir plugins/demo-kb-en/source-docs/ --output plugins/demo-kb-en/kb`（或 `--llms-txt`），产出 `doc-graph.json` + `chunks.sqlite`。验证：节点数与源文档数量一致；FTS5 可查询英文关键词。将 `plugins/demo-kb-en/kb/` 纳入 git 追踪（构建产物入库，≤50 页 demo 通常 <10MB）。
**涉及文件**：`plugins/demo-kb-en/kb/doc-graph.json`、`plugins/demo-kb-en/kb/chunks.sqlite`
**依赖任务**：T021、T018
**FR/SC/EC**：FR-012、SC-002、SC-003
**Phase**：A
**并行**：无

#### T024 — 构建中文 demo fixture（`scaffold-kb build` 产出 `plugins/demo-kb-zh/kb/`）

**描述**：同 T023，对中文 ECharts 文档运行构建，产出 `plugins/demo-kb-zh/kb/doc-graph.json` + `chunks.sqlite`。验证：中文关键词（如"错误"）FTS5 可命中；ECharts 点号符号（`xAxis.axisLabel.formatter`）可查询。将产物纳入 git 追踪。
**涉及文件**：`plugins/demo-kb-zh/kb/doc-graph.json`、`plugins/demo-kb-zh/kb/chunks.sqlite`
**依赖任务**：T022、T018
**FR/SC/EC**：FR-012、SC-002、SC-005、SC-006
**Phase**：A
**并行**：可与 T023 并行（不同输出目录，无文件冲突）

#### T005b — 碰撞率完整审计（ECharts fixture 完成后）

**描述**：ECharts fixture 构建完成（T024）后，用真实 `plugins/demo-kb-zh/kb/` 中的 doc-graph 节点 id 及 chunk_id 集合，统计不同原始符号经 normalizeForIndex 后产生相同拼接 token 的碰撞对数量，计算碰撞率，断言 ≤ 2%（对应 manifest 冻结前的质量门）。如碰撞率超标，需回头调整 normalizeForIndex（A-2 T006），并重建 fixture（T023/T024）。
**涉及文件**：`tests/kb/tokenizer-collision-audit.test.ts`（或集成到 `tokenizer-preprocessor.test.ts`）
**依赖任务**：T024、T006
**FR/SC/EC**：FR-004、SC-005、SC-006
**Phase**：A
**并行**：无（依赖 T024）

---

### A-13：plugin.json 与 plugin 结构（demo plugin 配置）

#### T025 — 创建 demo plugin 目录结构（英文 + 中文）

**描述**：创建两个 demo plugin 的完整目录结构（含 `.claude-plugin/plugin.json`）：
- `plugins/demo-kb-en/.claude-plugin/plugin.json`：`name:"demo-kb-en"`/`version:"0.1.0"`/`_testOnly:true`/`license:"MIT"`
- `plugins/demo-kb-zh/.claude-plugin/plugin.json`：`name:"demo-kb-zh"`/`version:"0.1.0"`/`_testOnly:true`/`license:"Apache-2.0"`
两个 plugin 不进入 `contracts/release-contract.yaml` 和 `.claude-plugin/marketplace.json`（test fixture，不污染发布合同）。
**涉及文件**：`plugins/demo-kb-en/.claude-plugin/plugin.json`、`plugins/demo-kb-zh/.claude-plugin/plugin.json`
**依赖任务**：T021、T022
**FR/SC/EC**：FR-012、SC-001、SC-003、SC-004
**Phase**：A
**并行**：可与 T023/T024 并行

---

### A-14：eval manifest — schema + 判定脚本 + 冻结

#### T026 — 创建 eval manifest schema 与占位文件

**描述**：在 `specs/190-scaffold-kb-mvp/eval/recall-manifest.json` 中创建 manifest schema（`manifest_version:"1.0"`）和**占位条目**（category 各类型至少 1 条占位，`expected_doc_ids` 填 `null` 占位）。条目数满足 SC-005/SC-006/SC-007 最低要求：chinese_word ≥10、mixed ≥5、api_symbol ≥5、error_code ≥5（含≥3字符以下的 `401`/`E01`）、synonym ≥5，共 ≥30 条占位。
**涉及文件**：`specs/190-scaffold-kb-mvp/eval/recall-manifest.json`
**依赖任务**：T002
**FR/SC/EC**：FR-015、SC-005、SC-006、SC-007
**Phase**：A
**并行**：可与 T021/T022 并行

#### T027 — 实现 recall 判定脚本（vitest 用例形式）

**描述**：在 `specs/190-scaffold-kb-mvp/eval/run-recall-eval.ts` 中实现 vitest 测试用例形式的判定脚本：①加载 `recall-manifest.json`；②对每条 entry 调用 **`searchKbCore`**（直接调用，使用已构建的 demo fixture DB，**不是** `kb_search` MCP 工具）；③判定命中（前 k 条结果 `doc_id ∈ expected_doc_ids`）；④按 category 分组计算 recall@5；⑤输出数值 + 阻塞项检测（零命中且文档确认存在 → BLOCKER 报错）。空 `expected_doc_ids` 跳过判定（占位状态）。

> Phase A 使用 searchKbCore 而非 kb_search，是因为 kb_search（T041）在 Phase B 才实现（C-2 修正）。
**涉及文件**：`specs/190-scaffold-kb-mvp/eval/run-recall-eval.ts`
**依赖任务**：T020b、T026
**FR/SC/EC**：FR-015、SC-005、SC-006、SC-007
**Phase**：A
**并行**：可与 T023/T024 并行

#### T028 — 冻结 eval manifest（填充 expected_doc_ids）

**描述**：fixture 构建完成（T023/T024 完成后），从实际 `doc-graph.json` 中提取真实 `doc_id`，填充 `recall-manifest.json` 中所有条目的 `expected_doc_ids`。

**卫生断言（WARNING W-2 处置）**：冻结前强制执行：
- 断言所有条目的 `expected_doc_ids` 均非 null（无遗漏）
- 断言 chinese_word ≥10、mixed ≥5、api_symbol ≥5、error_code ≥5、synonym ≥5（数量达标）
- 防止 recall 评测因空 expected_doc_ids 静默跳过假通过

同时更新 `FIXTURE.md`（两套 fixture 各自的查询集条目 ID 列表与 recall-manifest 交叉引用）。反过拟合检查：确认没有针对具体 query 文本做特例 tokenizer 分支。
**涉及文件**：`specs/190-scaffold-kb-mvp/eval/recall-manifest.json`（更新）、`plugins/demo-kb-en/FIXTURE.md`（更新）、`plugins/demo-kb-zh/FIXTURE.md`（更新）
**依赖任务**：T027、T023、T024
**FR/SC/EC**：FR-015、SC-005、SC-006、SC-007
**Phase**：A
**并行**：无

---

### A-15：recall@k 验收（SC-005/SC-006/SC-007）

#### T029 — 跑 recall 评测并验收 SC-005（中文词 + 中英混合）

**描述**：运行判定脚本（T027，调用 searchKbCore），计算 `chinese_word`（≥10 条）和 `mixed`（≥5 条）的 recall@5。
- 质量目标：recall@5 ≥ 0.80（绿）
- 非阻塞区：0.50-0.80（可交付，记录 Phase 3 向量 rerank 信号）
- BLOCKER：recall@5 < 0.50 或任一查询零命中且文档确认存在 → 修 tokenizer 重测

**重建约定**：若 BLOCKER，修 T006 normalizeForIndex 后，必须重建 T023/T024 fixture，重跑 T028 冻结，再重跑本任务评测。不得用旧 KB 评测新 tokenizer。

验收通过后在此任务记录实际数值（confirm 后写入 verify 报告）。
**涉及文件**：无新增文件（跑判定脚本）
**依赖任务**：T028
**FR/SC/EC**：FR-004、SC-005、EC-001
**Phase**：A
**并行**：无

#### T030 — 跑 recall 评测并验收 SC-006（短错误码 + API 符号 + reserved-token 负向集）

**描述**：运行判定脚本，计算 `error_code`（≥5 条，含 `401`/`E01` 等 ≤3 字符）和 `api_symbol`（≥5 条，含 `.`/`-`/`_`）的 recall@5。同时运行 EC-002 reserved-token 负向测试集（`OR`/`NOT`/`AND`/`NEAR/5 error` 等按字面命中；`""` 空串返回 `INVALID_QUERY`），断言 100% 按预期（安全报错或字面命中，不崩溃、不被当操作符）。
- BLOCKER（无非阻塞区）：recall@5 < 0.80 或 reserved-token 负向集不达标 → Phase 1 阻塞

**重建约定**：同 T029，修分词器后必须重建 fixture。
**涉及文件**：无新增文件
**依赖任务**：T028
**FR/SC/EC**：FR-004、SC-006、EC-002
**Phase**：A
**并行**：可与 T029 并行

#### T031 — 跑 recall 评测并验收 SC-007（同义改写查询）

**描述**：运行判定脚本，计算 `synonym`（≥5 条）的 recall@5。
- 门槛：recall@5 ≥ 0.60（绿）；< 0.60 不阻塞 Phase 1，但记录为 Phase 2/3 向量 rerank 升级候选信号。
**涉及文件**：无新增文件
**依赖任务**：T028
**FR/SC/EC**：SC-007
**Phase**：A
**并行**：可与 T029/T030 并行

---

### A-16：Phase A Codex 对抗审查

#### T032 — Codex 对抗审查 Phase A（提交前）

**描述**：Phase A 实现完毕后（T029 + T030 + T031 recall 评测通过 + T020d 隔离验证通过），通过 Agent tool 启动 `codex:codex-rescue` 子代理，对 Phase A 全部改动做对抗审查。重点：`normalizeForIndex` 碰撞率逻辑、searchKbCore 单库查询正确性（BM25 排序方向）、chunk 切分幂等性、sqlite-writer FTS5 写入路径、eval manifest 反过拟合规则、QuerySanitizer reserved words 消歧正确性。处置 critical/warning 后方可执行 Phase A commit。
**涉及文件**：无新增（审查流程）
**依赖任务**：T029、T030、T031、T020d
**FR/SC/EC**：全 Phase A
**Phase**：A（Polish）
**并行**：无

---

## Phase B：MCP 层（共 26 个任务）

### 阶段目标

实现 KB MCP server（`createKbMcpServer()` + `kb_search` + `kb_doc_lookup`）、`scaffold-kb serve` 子命令、demo plugin `.mcp.json` 接线，构建小型项目库 fixture 并验证 FR-016 双层联查（EC-005 真实验收），验证 SC-001/SC-003/SC-004/SC-008/SC-009/SC-010/SC-011/SC-012/SC-013。

---

### B-1：kb-error — KB 专属错误构造（测试先行）

#### T033 — 写失败测试：`buildKbError` 顶层 code 结构

**描述**：在 `tests/kb/kb-error.test.ts` 中写失败测试：
- `buildKbError('INVALID_QUERY', '...')` 产出 `{ isError: true, content: [{ type:'text', text: '...' }] }`
- `JSON.parse(result.content[0].text).code === 'INVALID_QUERY'`（顶层 code 机械断言）
- 所有 KbErrorCode 枚举值：`INVALID_QUERY`/`INVALID_TOP_K`/`INVALID_SOURCE_FILTER`/`INVALID_LOOKUP_ARG`/`KB_NOT_FOUND`/`KB_CORRUPT`
- 可选 `hint` 字段存在时出现在 JSON
先运行确认 FAIL。
**涉及文件**：`tests/kb/kb-error.test.ts`
**依赖任务**：T002
**FR/SC/EC**：FR-006、SC-009、SC-012、EC-010
**Phase**：B
**并行**：可与其他 B 系列测试先行任务并行

#### T034 — 实现 `src/kb-mcp/lib/kb-error.ts`

**描述**：实现 `KbErrorCode` 类型 union + `buildKbError(code: KbErrorCode, message: string, hint?: string)` 函数，产出与 `ToolResult` 同 shape 的 envelope，但 `code` 为 KB 自有码（顶层 JSON 字段，不从 message 解析）。内部异常仍用共享 `buildErrorResponse('internal-error', …)` 脱敏。跑 T033 测试全绿。

> 注：query-sanitizer 在 Phase A 已实现（T019a/T019b），Phase B 的 `src/kb-mcp/lib/query-sanitizer.ts` 改为 re-export `src/scaffold-kb/query-sanitizer.ts` 以复用（或直接 import），不重复实现。
**涉及文件**：`src/kb-mcp/lib/kb-error.ts`、`src/kb-mcp/lib/query-sanitizer.ts`（re-export wrapper）
**依赖任务**：T033
**FR/SC/EC**：FR-006、SC-009、SC-012、EC-010
**Phase**：B
**并行**：无

---

### B-2：result-merger — BM25 归一化 + 双库合并（测试先行）

#### T035 — 写失败测试：ResultMerger BM25 归一化 + 排序方向 + 双呈现

**描述**：在 `tests/kb/result-merger.test.ts` 中写失败测试：
- **BM25 排序方向**（核心断言）：构造已知相关度顺序 fixture（FTS5 `bm25()` 越负越相关），断言 `score_norm = (max - score) / (max - min + ε)` 归一后最相关 chunk 排在结果第 1 位（防方向回归）
- **min-max 归一化**：厂商库 3 候选 + 项目库 2 候选，归一后合并排序，结果降序（`score_norm` 越大越相关越前）
- **每库 ≥1 条保障**：`top_k=5` 且两库均有命中 → 结果含每库各 ≥1 条最高分结果
- **`top_k=1` 合法降级**：`top_k=1` → 返回全局最高 1 条，不触发双呈现保障
- **冲突双呈现 fixture**（EC-005）：厂商库含"API X 返回 string"，项目库含"API X 返回 object"，`top_k=5` 下两条均出现，`source_kind` 各不同
- 项目库候选为空时：跳过归一化，`sources_queried` 只含 `["vendor"]`
先运行确认 FAIL。
**涉及文件**：`tests/kb/result-merger.test.ts`
**依赖任务**：T004、T033
**FR/SC/EC**：FR-009、SC-005、EC-004、EC-005
**Phase**：B
**并行**：可与 T033 并行（不同文件）

#### T036 — 实现 `src/kb-mcp/lib/result-merger.ts`

**描述**：实现 `mergeResults(vendorCandidates, projectCandidates, topK): MergedResult`。按 plan §4.6.1 流程：①两库各取 `topK*2` 候选；②对每库 min-max 归一（`score_norm = (max - score) / (max - min + ε)`）；③统一区间合并降序；④每库 ≥1 条保障（`topK ≥ 2` 且两库有命中）；⑤`topK=1` 合法降级；⑥取前 `topK` 条。记录 `sources_queried`。跑 T035 测试全绿。
**涉及文件**：`src/kb-mcp/lib/result-merger.ts`
**依赖任务**：T035
**FR/SC/EC**：FR-009、SC-005、EC-004、EC-005
**Phase**：B
**并行**：无

---

### B-3：kb-locator — 厂商库/项目库定位 + DB 单例缓存

#### T037 — 写失败测试：KbLocator 路径定位 + 降级行为

**描述**：在 `tests/kb/kb-locator.test.ts` 中写失败测试：
- `locateKbs({ vendorKbPath, projectKbPath })` 返回实际可用库信息 + `sources_queried`
- 厂商库路径存在且 `chunks.sqlite` 可读 → 加载并缓存 DB 单例
- 项目库路径不存在 → 降级为仅厂商库，`sources_queried: ["vendor"]`
- 仅项目库存在（EC-004）→ `sources_queried: ["project"]`，**非错误**
- **两库均不存在 → `code: 'KB_NOT_FOUND'`（isError: true）**（注：单库缺失是降级而非错误，与 EC-004 区分）
- `chunks.sqlite` 存在但损坏（写入非法字节的 mock）→ `code: 'KB_CORRUPT'`
先运行确认 FAIL。
**涉及文件**：`tests/kb/kb-locator.test.ts`
**依赖任务**：T004、T033
**FR/SC/EC**：FR-010、SC-009、EC-004、EC-007
**Phase**：B
**并行**：可与 T035 并行

#### T038 — 实现 `src/kb-mcp/lib/kb-locator.ts`

**描述**：实现 `locateAndLoadKbs(sqlite3, opts)` → `{ vendorDb?, projectDb?, sourcesQueried, error? }`。启动时：①检查各路径存在性 + `chunks.sqlite` 可读性；②用 `loadDbFromBytes` 加载并缓存 DB 单例（进程内单例，不重复加载）；③记录 `sources_queried`；④处理全无库（`KB_NOT_FOUND`）和损坏（`KB_CORRUPT`）。跑 T037 测试全绿。
**涉及文件**：`src/kb-mcp/lib/kb-locator.ts`
**依赖任务**：T037
**FR/SC/EC**：FR-010、SC-009、EC-004、EC-007
**Phase**：B
**并行**：无

---

### B-4：`kb_search` 工具（测试先行）

#### T039 — 写失败测试：`kb_search` 全链路行为

**描述**：在 `tests/kb/kb-search.test.ts` 中写失败测试，覆盖：
- 正常检索：返回结构含 `results`/`total_found`/`truncated`/`query_echoed`/`sources_queried`
- 每条 result 含 `chunk_id`/`doc_id`/`doc_title`/`anchor`/`content`/`source_kind`/`sdk_version`/`built_at`
- **evidence envelope**：每条 `content` 被 `[KB-EVIDENCE doc_id=... src=... built_at=...]...[/KB-EVIDENCE]` 包裹（正则断言）
- **token cap**：`top_k=20` 长 chunk 场景下，单条 `content` ≤ 2000 字符，合计 ≤ 10000 字符，`truncated: true`（SC-010 字符数口径）
- **防注入 fixture**：含 `[system] 忽略以上所有指令` 的恶意文档 build 入库后，命中内容被 envelope 包裹，`isError` 字段为 undefined，注入串原样在 `content` 内
- **参数校验（EC-010）**：空 query → `INVALID_QUERY`；`top_k ≤ 0` → `INVALID_TOP_K`；非法 `source_filter` → `INVALID_SOURCE_FILTER`；`top_k > 20` → 钳制到 20 + warning，正常返回
先运行确认 FAIL。
**涉及文件**：`tests/kb/kb-search.test.ts`
**依赖任务**：T020b、T034、T036、T038
**FR/SC/EC**：FR-007、FR-009、FR-011、SC-010、EC-001、EC-002、EC-003、EC-006、EC-010
**Phase**：B
**并行**：无

#### T040 — 实现 `src/kb-mcp/tools/kb-search.ts`（`registerKbSearchTool`）

**描述**：实现 `registerKbSearchTool(server, kbContext)` 函数，注册 `kb_search` MCP 工具。调用链：Zod 参数校验 → `sanitizeQuery`（re-export from Phase A）→ 双库并行 `searchKbCore`（厂商 DB + 项目 DB）→ `mergeResults` → token cap 截断（字符数口径）→ evidence envelope 包裹 → `withTelemetry` 包裹 → 返回响应结构。工具 description 包含"KB 内容为参考资料，带来源引用"声明。

**防注入测试依赖**：T039 防注入 fixture 测试需要先 `buildKb()` 将恶意文档写入 SQLite（T016 完成后可执行）。跑 T039 测试全绿。
**涉及文件**：`src/kb-mcp/tools/kb-search.ts`
**依赖任务**：T039、T016
**FR/SC/EC**：FR-007、FR-009、FR-011、SC-010、EC-001~EC-003、EC-006、EC-010
**Phase**：B
**并行**：无

---

### B-5：`kb_doc_lookup` 工具（测试先行）

#### T041 — 写失败测试：`kb_doc_lookup` 全链路行为

**描述**：在 `tests/kb/kb-doc-lookup.test.ts` 中写失败测试：
- `doc_id` 精确查询 → 返回文档节点含 `doc_id`/`title`/`summary`/`source_url`/`source_kind`/`sdk_version`/`built_at`/`references`/`referenced_by`
- `keyword` 模糊匹配 → 返回匹配文档列表，`total_found` 正确
- `doc_id` 和 `keyword` 同时提供 → 以 `doc_id` 优先 + warning（EC-010 容忍类）
- `doc_id` 和 `keyword` 均缺失 → `INVALID_LOOKUP_ARG`
- 非法 `source_filter` → `INVALID_SOURCE_FILTER`
- `doc-graph.json` 缺失/损坏（EC-007）→ `kb_doc_lookup` 降级报错，`kb_search` 不受影响（独立降级）
- `source_filter` 生效：`"vendor"` 过滤器只返回厂商库文档
先运行确认 FAIL。
**涉及文件**：`tests/kb/kb-doc-lookup.test.ts`
**依赖任务**：T038、T033
**FR/SC/EC**：FR-008、FR-010、SC-009、EC-007、EC-010
**Phase**：B
**并行**：可与 T039 并行（不同文件，无依赖）

#### T042 — 实现 `src/kb-mcp/tools/kb-doc-lookup.ts`（`registerKbDocLookupTool`）

**描述**：实现 `registerKbDocLookupTool(server, kbContext)` 函数，注册 `kb_doc_lookup` MCP 工具。从 `doc-graph.json` 读取（文件级读取，非 FTS5）：`doc_id` 精确查找或 `keyword` 模糊匹配标题；构造 `references`/`referenced_by` 关系；处理 doc-graph 缺失/损坏降级；`withTelemetry` 包裹。跑 T041 测试全绿。
**涉及文件**：`src/kb-mcp/tools/kb-doc-lookup.ts`
**依赖任务**：T041
**FR/SC/EC**：FR-008、FR-010、SC-009、EC-007、EC-010
**Phase**：B
**并行**：无

---

### B-6：KB MCP server + `scaffold-kb serve` 接线

#### T043 — 实现 `src/kb-mcp/server.ts`（`createKbMcpServer`）

**描述**：实现 `createKbMcpServer(opts: KbServerOpts)` 函数，接收 `vendorKbPath` + `projectKbPath`，调用 `locateAndLoadKbs` 初始化 KB 上下文，注册 `registerKbSearchTool` + `registerKbDocLookupTool`，返回 MCP server 实例。不依赖/修改 `src/mcp/server.ts`（零回归保证）。
**涉及文件**：`src/kb-mcp/server.ts`
**依赖任务**：T040、T042
**FR/SC/EC**：FR-006、SC-008、SC-013
**Phase**：B
**并行**：无

#### T044 — 实现 `src/kb-mcp/index.ts`（`startKbMcpServer` stdio 入口）

**描述**：实现 `startKbMcpServer(opts)` 函数，调用 `createKbMcpServer` 并以 stdio 模式启动。此为 `scaffold-kb serve` 子命令的实际入口，由 demo plugin `.mcp.json` 的 `command:"spectra" args:["scaffold-kb","serve","--vendor-kb","${CLAUDE_PLUGIN_ROOT}/kb"]` 触发。
**涉及文件**：`src/kb-mcp/index.ts`
**依赖任务**：T043
**FR/SC/EC**：FR-006、SC-001、SC-003、SC-004
**Phase**：B
**并行**：无

#### T045 — 补全 `src/cli/commands/scaffold-kb.ts` 的 `serve` 分支

**描述**：在 T017 已有的 `scaffold-kb.ts` 中补全 `serve` 子命令分支：解析 `--vendor-kb`（必需）和 `--project-kb`（可选，缺省 `process.cwd()/.spectra/kb`）；调用 `startKbMcpServer`。不在 `.mcp.json` env 中注入 `${workspaceFolder}`（项目库路径由运行时 `process.cwd()` 推导）。
**涉及文件**：`src/cli/commands/scaffold-kb.ts`（更新）
**依赖任务**：T044、T017
**FR/SC/EC**：FR-006、SC-001、SC-003、SC-004
**Phase**：B
**并行**：无

#### T045a — CLI spawn 测试：`scaffold-kb serve` 完整调用链

**描述**：在 `tests/kb/cli-serve.test.ts` 中写并跑测试（WARNING 处置）：
- spawn `spectra scaffold-kb serve --vendor-kb <path>` 进程，断言进程启动不崩溃（exit code 0 或等待信号）
- spawn `spectra scaffold-kb build --dir <fixture-dir>` 进程，断言产出 `kb/doc-graph.json` + `kb/chunks.sqlite`（集成级 CLI 测试，补充 SC-002a CLI 路径）
- `spectra scaffold-kb` 无子命令 → 非零 exit + 用法提示输出
**涉及文件**：`tests/kb/cli-serve.test.ts`
**依赖任务**：T045
**FR/SC/EC**：FR-001、FR-006、SC-002a、SC-001
**Phase**：B
**并行**：可与 T043 并行（不同文件）

---

### B-7：demo plugin `.mcp.json` 接线

#### T046 — 创建 demo plugin `.mcp.json`（英文 + 中文）

**描述**：创建两个 demo plugin 的 `.mcp.json`：
```json
// plugins/demo-kb-en/.mcp.json
{
  "mcpServers": {
    "kb-en": {
      "command": "spectra",
      "args": ["scaffold-kb", "serve", "--vendor-kb", "${CLAUDE_PLUGIN_ROOT}/kb"]
    }
  }
}
// plugins/demo-kb-zh/.mcp.json
{
  "mcpServers": {
    "kb-zh": {
      "command": "spectra",
      "args": ["scaffold-kb", "serve", "--vendor-kb", "${CLAUDE_PLUGIN_ROOT}/kb"]
    }
  }
}
```
不用绝对路径/node 入口（安装态会失效），复用已装的 `spectra` bin。
**涉及文件**：`plugins/demo-kb-en/.mcp.json`、`plugins/demo-kb-zh/.mcp.json`
**依赖任务**：T045
**FR/SC/EC**：FR-012、SC-001、SC-003、SC-004
**Phase**：B
**并行**：无

---

### B-8：KB 工具 contract snapshot + telemetry（SC-012）

#### T047 — 写失败测试：KB 工具 contract snapshot + telemetry 结构

**描述**：在 `tests/kb/kb-contract-snapshot.test.ts` 中写失败测试（SC-012）：
- **成功响应 shape**：`kb_search` 成功响应的 JSON 结构做快照断言（锁定 `results` 数组结构、`total_found`/`truncated`/`query_echoed`/`sources_queried` 字段存在）
- **失败响应 shape**：`kb_search`/`kb_doc_lookup` 的错误响应 `isError: true` + `content[0].text` 的 JSON 含顶层 `code` 字段，与现有工具同款形态
- **内部异常脱敏**：模拟内部异常，确认绝对路径不回传（F177 同款）
- **telemetry**：`withTelemetry` 包裹验证：每次工具调用产出 `toolName`/耗时/成功or失败 telemetry 记录，结构与现有 17 工具一致
先运行确认 FAIL。
**涉及文件**：`tests/kb/kb-contract-snapshot.test.ts`
**依赖任务**：T040、T042
**FR/SC/EC**：FR-006、SC-012
**Phase**：B
**并行**：可与 T043 并行

#### T048 — 验证 KB 工具 contract snapshot（跑 T047）

**描述**：跑 `tests/kb/kb-contract-snapshot.test.ts`，确认快照测试全绿。如有 shape 不一致则修对应工具实现。
**涉及文件**：无新增
**依赖任务**：T047、T043
**FR/SC/EC**：FR-006、SC-012
**Phase**：B
**并行**：无

---

### B-9：SC-013 隔离验收（补全第 3 条）

#### T049 — 补全 KB 产物隔离第 3 条断言（工具名交集为空）

**描述**：在 `tests/kb/kb-isolation.test.ts`（T020c 已创建）中补全第 3 条断言：读取 `src/mcp/server.ts` 注册的 17 个工具名集合（`listSpectraTools()`），读取 KB MCP server 注册的工具名集合（`kb_search`/`kb_doc_lookup`），断言交集为空。运行全部 3 条断言全绿。
**涉及文件**：`tests/kb/kb-isolation.test.ts`（更新）
**依赖任务**：T043、T020c
**FR/SC/EC**：FR-013、SC-013
**Phase**：B
**并行**：可与 T047 并行

---

### B-10：SC-008 零回归验证

#### T050 — 验证现有 17 工具测试全绿（SC-008）

**描述**：运行现有 Spectra MCP 工具的全量集成测试套件，确认引入 KB MCP server 后 17/17 工具测试全绿，无任何测试失败或行为变更。需确认：①`src/mcp/server.ts` 零行改动（git diff 验证）；②`kb_*` 命名空间不干扰现有工具注册；③现有测试文件路径均通过。
**涉及文件**：无新增（跑现有测试）
**依赖任务**：T043
**FR/SC/EC**：FR-006、FR-013、SC-008
**Phase**：B
**并行**：可与 T048 并行

---

### B-11：FR-016 双层联查真实验收（EC-005 真实载体）

#### T051 — 构建小型项目库 fixture + 双层联查 E2E 验证（FR-016/EC-005）

**描述**：新增任务（C-5 修正，FR-016 双层联查"挂名覆盖"处置）：

**步骤 1 — 构建项目库 fixture**：
用 `spectra scaffold-kb build --dir tests/kb/fixtures/project-docs/ --output tests/kb/fixtures/project-kb/` 构建小型项目库（≥2 篇文档，包含"API X 返回 object"类项目适配说明——与 demo-kb-en 厂商库中"API X 返回 string"形成冲突对）。fixture 文档放 `tests/kb/fixtures/project-docs/`（git 追踪，≤5 篇小文件）。

**步骤 2 — 双层联查 E2E 断言**：
在 `tests/kb/fr016-dual-kb.test.ts` 中写并跑测试：
- 以 `demo-kb-en/kb/` 为厂商库、`tests/kb/fixtures/project-kb/` 为项目库，调用 `kb_search("API X", 5)`
- 断言：results 中同时含 `source_kind: "vendor"` 和 `source_kind: "project"` 各至少 1 条（双呈现）
- 断言：厂商库结果和项目库结果的 `built_at`/`doc_id` 各不相同（来源区分清晰）
- 断言：`sources_queried` 包含 `["vendor", "project"]`（双库均被查询）

这是 FR-016 项目库写入路径的真实 E2E 验收，也是 EC-005 "两个 SQLite KB 经 kb_search 双呈现"的真实验收载体（不再是 result-merger 单元测试 fixture 挂名）。
**涉及文件**：`tests/kb/fixtures/project-docs/`（小型 fixture 文档）、`tests/kb/fixtures/project-kb/`（构建产物，git 追踪）、`tests/kb/fr016-dual-kb.test.ts`
**依赖任务**：T040、T016
**FR/SC/EC**：FR-016、EC-005、SC-009
**Phase**：B
**并行**：可与 T049 并行

---

### B-12：SC-001 E2E 集成路径验证

#### T052 — E2E 集成路径验证（中英 demo plugin 安装 + 查询）

**描述**：验证 SC-001 E2E 集成路径：
1. 模拟 marketplace 安装 demo 英文 plugin（`plugins/demo-kb-en/`），启动 `scaffold-kb serve --vendor-kb plugins/demo-kb-en/kb`
2. `kb_search` 查询 Hono API 相关问题，命中 ≥1 条相关 chunk，结果含 `source_kind`/`doc_id`/`built_at` 标注
3. 重复中文 demo plugin（`plugins/demo-kb-zh/`），`kb_search` 中文查询命中 ≥1 条相关 chunk
4. 两个 E2E 路径均通过，记录响应结构（含 evidence envelope 格式）

可通过 vitest 测试用例形式执行（不需要真实 Claude Code 工作流，直接调用 `kb_search` 函数）。
**涉及文件**：`tests/kb/e2e-integration.test.ts`
**依赖任务**：T046、T040
**FR/SC/EC**：FR-006、FR-007、SC-001、SC-003、SC-004
**Phase**：B
**并行**：无

---

### B-13：SC-009 降级 + 参数校验矩阵（专项测试）

#### T053 — 验证 SC-009 全部降级路径 + 参数校验矩阵

**描述**：补充/汇总 `tests/kb/kb-degradation.test.ts`，覆盖 SC-009 全部场景（逐条机械断言不崩溃）：

| 场景 | 期望 |
|------|------|
| 厂商库 `kb/` 不存在（未装 plugin）且项目库也不存在 | 两工具均 `isError:true` + `KB_NOT_FOUND` |
| 项目库不存在，厂商库存在 | 仅查厂商库，`sources_queried=["vendor"]`，非错误 |
| 仅项目库存在（EC-004）| 仅查项目库，`sources_queried=["project"]`，非错误 |
| `chunks.sqlite` 损坏 | `kb_search` `isError:true` + `KB_CORRUPT` + 提示重建 |
| `doc-graph.json` 缺失/损坏（EC-007）| `kb_doc_lookup` 降级报错，`kb_search` 仍正常 |
| EC-010 全部报错类非法参数 | 返回对应 `code`，不执行检索 |

零崩溃断言。

> 注：单库缺失（厂商库或项目库缺一）是降级语义非硬失败；仅"两库均不存在"才 KB_NOT_FOUND（与 EC-004 明确区分）。
**涉及文件**：`tests/kb/kb-degradation.test.ts`
**依赖任务**：T040、T042、T038
**FR/SC/EC**：FR-010、SC-009、EC-004、EC-007、EC-010
**Phase**：B
**并行**：可与 T052 并行

---

## Phase Polish：全量门禁与性能验收（共 5 个任务）

### 执行顺序（C-4 修正）

实现完成 → T054(E2E+性能) → T057(Phase B codex 审查) → 处置修复 → T055(全量门禁，最终) → Phase B commit。

codex 审查（T057）必须在全量门禁（T055）之前，使审查修复纳入门禁结果，不产生"门禁通过后又修改"的时序倒挂。

---

### T054 — cold/warm P95 性能实测（SC-011 第 2 部分）

**描述**：用 demo fixture（英文 Hono，中文 ECharts）在本地 macOS arm64 实测 `scaffold-kb serve` 的性能：
- **cold**：进程首次加载 `chunks.sqlite`（含 WASM module init + DB import），记录实际耗时
- **warm**：缓存命中后的纯 FTS5 查询，P95 MUST ≤ 200ms（`kb_search` 10 次采样取 P95）
超标则评估懒加载/分库（按 plan §4.9）。在 verify 报告中如实标注实际验证平台（macOS arm64），不 over-claim 全平台；linux 侧由 CI 或 WASM 纯 JS 无平台分支保证，据实记录。
**涉及文件**：`tests/kb/performance.test.ts`
**依赖任务**：T052
**FR/SC/EC**：FR-014、SC-011、SC-003、SC-004
**Phase**：Polish
**并行**：可与 T050 并行

### T055 — 全量门禁：vitest + build + repo:check + release:check（最终，SC-011 第 1 部分）

**描述**：运行完整门禁（**在 Phase B codex 审查 T057 之后执行**，确保审查修复已纳入）：
1. `npx vitest run`（所有 `tests/` 下测试，含 `tests/kb/*`）→ 零失败
2. `npm run build`（TypeScript 编译零错误）
3. `npm run repo:check`（仓库级同步检查）
4. `npm run release:check`（发布合同检查，demo-kb 不在合同内应自动通过）
全部 4 项零失败为 Phase B commit 前置条件。
**涉及文件**：无新增
**依赖任务**：T057、T053、T050、T049、T048
**FR/SC/EC**：SC-008、SC-011、SC-013
**Phase**：Polish
**并行**：无（串行最后一步）

### T056 — Codex 对抗审查 Phase A（提交前）

见 A-16 T032（已移入 Phase A 末尾）。本编号保留为向后兼容别名，指向 T032。

---

### T057 — Codex 对抗审查 Phase B（提交前，在全量门禁之前）

**描述**：Phase B 实现完毕后（T051 双层联查验证 + T052 E2E 通过 + T054 性能实测完成），通过 Agent tool 启动 `codex:codex-rescue` 子代理，对 Phase B 全部改动做对抗审查。重点：BM25 排序方向（max-score 正确性，防方向写反）、evidence envelope 防注入有效性、参数校验边界、KB_NOT_FOUND/KB_CORRUPT 降级路径、telemetry 脱敏、FR-016 双层联查语义正确性。处置 critical/warning 后执行全量门禁（T055），再 commit。
**涉及文件**：无新增（审查流程）
**依赖任务**：T051、T052、T054
**FR/SC/EC**：全 Phase B
**Phase**：Polish（B）
**并行**：无

### T058 — （见 T051）FR-016/EC-005 双层联查真实验收

FR-016 和 EC-005 的真实验收任务已合并为 T051（B-11 节），此处不重复列条目。T051 是这两项需求的真实验收载体。

---

## 任务总览

| Phase | 任务数 | 关键任务（新增/变更）|
|-------|--------|---------|
| Setup | 2（T001-T002）| WASM 依赖安装 |
| Phase A | 32（T003-T032，含 T005b/T019a/T019b/T020a-T020d）| normalizeForIndex、searchKbCore（新增）、QuerySanitizer（移入 A）、buildKb、fixture 构建、recall 评测 |
| Phase B | 26（T033-T057，含 T045a/T051）| kb-search、kb-doc-lookup、MCP server、E2E 路径、FR-016 双层联查真实验收（T051 新增） |
| Polish | 5（T054/T055/T057 + T032 别名/T051 已含在 B）| 性能实测、全量门禁（顺序修正：codex 审查在门禁之前）|
| **合计** | **约 65 个任务** | |

> 注：T056 作为 T032 别名不独立计数；T058 指向 T051 不独立计数。实际独立任务约 63 条。

Phase A 完成后可独立交付（离线验证 SC-002/002a/005/006/007）。
Phase B 在 Phase A 产物基础上构建（MCP 层依赖构建产物 + searchKbCore）。

---

## FR/SC/EC 覆盖矩阵

### 功能需求（FR）覆盖

| FR | 描述（简）| 覆盖任务 |
|----|---------|---------|
| FR-001 | `scaffold-kb build` 输入（`--llms-txt`/`--dir`）| T013、T014、T015、T016、T017、T018、T045a |
| FR-002 | 产出 `doc-graph.json`（§3.2 契约）| T009、T010、T015、T016 |
| FR-003 | 产出 `chunks.sqlite`（FTS5 表结构）| T011、T012、T015、T016 |
| FR-004 | CJK 检索行为契约（不系统性零召回）| T005、T006、T019b、T020a、T020b、T029、T030 |
| FR-005 | 幂等性（去 `built_at` 后一致）| T007、T009、T011、T015 |
| FR-006 | KB MCP server 骨架复用（`{code}` 错误契约 + telemetry）| T033、T034、T043、T044、T047、T048、T050 |
| FR-007 | `kb_search` 工具（参数/输出/token cap/envelope/防注入）| T039、T040 |
| FR-008 | `kb_doc_lookup` 工具（doc_id/keyword 导航）| T041、T042 |
| FR-009 | 双层库联查语义（归一化 + 每库下限 + 冲突双呈现）| T035、T036 |
| FR-010 | 知识库缺失降级行为（不崩溃）| T037、T038、T041、T042、T053 |
| FR-011 | untrusted-evidence 信任边界（token cap + 来源标注）| T039、T040 |
| FR-012 | demo 厂商 plugin（中英 fixture + FIXTURE.md）| T021、T022、T023、T024、T025、T026、T028、T046 |
| FR-013 | KB 产物隔离约束（不污染 Spectra 产物）| T020c、T020d、T049 |
| FR-014 | 新 SQLite 运行时依赖（WASM，FTS5，P95 ≤ 200ms）| T001、T002、T003、T004、T054 |
| FR-015 | recall@k 冻结评测清单（manifest + 判定脚本）| T026、T027、T028、T029、T030、T031 |
| FR-016 | 项目库写入路径（同 CLI `--output` 指向项目路径）+ 双层联查真实验收 | T016、T017、**T051**（真实 E2E 验收）|

**FR 覆盖率：16/16（100%）**

---

### 成功标准（SC）覆盖

| SC | 描述（简）| 覆盖任务 |
|----|---------|---------|
| SC-001 | E2E 集成路径（中英 plugin 安装 + 查询 + 来源标注）| T052 |
| SC-002 | 构建产物完整性（幂等，去 `built_at` 字节级一致）| T011、T015、T023、T024 |
| SC-002a | llms.txt 输入成功构建 | T013、T014、T015、T045a（CLI 集成） |
| SC-003 | 中文 fixture KB 分发验证 | T024、T025、T046、T052 |
| SC-004 | 英文 fixture KB 分发验证 | T023、T025、T046、T052 |
| SC-005 | recall@k 中文词 + 中英混合（≥0.80 / ≥0.50 非阻塞 / <0.50 BLOCKER）| T028、T029 |
| SC-006 | recall@k 短错误码 + API 符号 + reserved-token 负向集（≥0.80 阻塞）| T028、T030 |
| SC-007 | recall@k 同义改写（≥0.60 非阻塞）| T028、T031 |
| SC-008 | 17 工具零回归 | T043、T050 |
| SC-009 | KB 缺失/损坏降级 + 参数校验矩阵 | T037、T038、T051、T053 |
| SC-010 | token cap + 防注入信任边界（字符数口径 + envelope 机械验证）| T039、T040 |
| SC-011 | 全量门禁 + 跨平台 FTS5 smoke | T003、T004、T054、T055 |
| SC-012 | KB 工具 contract snapshot + telemetry | T047、T048 |
| SC-013 | KB 产物隔离机械验收（graph 哈希 + sqlite 路径 + 工具名交集）| T020c、T020d、T049 |

**SC 覆盖率：14/14（100%）**

---

### 边缘情况（EC）覆盖

| EC | 描述（简）| 覆盖任务 |
|----|---------|---------|
| EC-001 | CJK 分词边界（<3 字符，LIKE 兜底）| T005、T006、T020a、T020b、T039、T040 |
| EC-002 | API 符号特殊字符转义（FTS5 reserved token）| T019a、T019b、T030 |
| EC-003 | 空查询 / 超短查询（`INVALID_QUERY`）| T019a、T039 |
| EC-004 | 厂商库缺失，仅有项目库（正常降级）| T037、T038、T053 |
| EC-005 | 两库内容冲突双呈现（`top_k=5` 两条均出现）| T035（单元）、**T051**（真实 E2E 验收） |
| EC-006 | 单次检索超 token cap（截断 content，元数据不截）| T039、T040 |
| EC-007 | `doc-graph.json` 损坏但 `chunks.sqlite` 完好（独立降级）| T037、T041、T042、T053 |
| EC-008 | llms.txt 解析失败（原子性，不留中间态）| T013、T014 |
| EC-009 | plugin KB 版本更新后 `schema_version` 可检测 | T009、T010 |
| EC-010 | MCP 工具参数校验边界矩阵（报错类 + 容忍类）| T033、T039、T041、T053 |

**EC 覆盖率：10/10（100%）**

---

## 依赖关系与并行机会

### Phase 间依赖

```
Setup (T001-T002)
  └── Phase A (T003-T032)
        └── Phase B (T033-T057)
              └── Polish (T054-T057，其中 T057 codex 审查在 T055 门禁之前)
```

### Phase A 内部关键依赖链

```
T002
  ├── T003 → T004（sqlite-loader）
  ├── T005 → T006（normalizeForIndex）
  │     └── T011（sqlite-writer 测试，需 T004+T006）→ T012
  ├── T007 → T008（chunk-splitter）
  ├── T009 → T010（doc-graph-builder）
  ├── T013 → T014（ingester）
  │
  ├── T008 + T010 + T012 + T014 → T015 → T016（buildKb）
  │     └── T017 → T018（CLI 接线）
  │
  ├── T006 + T002 → T019a → T019b（query-sanitizer，Phase A）
  │
  └── T004 + T012 + T019b → T020a → T020b（searchKbCore）
        └── T020b + T027 + T028 → T029/T030/T031（recall 验收）
```

### Phase A 内部并行机会

| 并行组 | 任务 |
|-------|------|
| 测试先行组（T002 后即可全部并行）| T003、T005、T007、T009、T013、T026 |
| 实现组（各自前置测试完成后）| T006 可与 T008、T010 并行；T014 可与 T010 并行 |
| QuerySanitizer（T006 完成后）| T019a 可与 T011 并行 |
| fixture 构建（T018 后）| T021 与 T022 并行；T023 与 T024 并行 |
| recall 验收（T028 后）| T029/T030/T031 可同时运行 |

### Phase B 内部并行机会

| 并行组 | 任务 |
|-------|------|
| 测试先行组（Phase A 完成后）| T033、T035、T037 可全部并行开写 |
| 工具实现（各前置测试完成后）| T039（kb-search）与 T041（kb-doc-lookup）可并行 |
| 验证任务 | T050（SC-008 零回归）可与 T048（contract snapshot）并行 |
| 项目库 fixture | T051（双层联查）可与 T049（隔离第 3 条）并行 |

### 奠基任务（最优先）

1. **T003 + T005**（sqlite-loader 测试 + tokenizer-preprocessor 测试）——技术地基：T003 实证 WASM FTS5 可用性（最高风险点），T005 锁定 `normalizeForIndex` 行为（CJK 召回是 Phase 1 阻塞项）。

2. **T019a + T020a**（query-sanitizer 测试 + searchKbCore 测试）——Phase A 查询核：searchKbCore 是 Phase A recall 验收的直接依赖，必须在 fixture 构建完成后尽快实现，使 T029/T030/T031 可在 Phase A 执行（C-2 修正核心）。

3. **T035**（result-merger BM25 排序方向测试）——BM25 方向写反是已知 CRITICAL，越负越相关，归一要用 `max - score`，先写断言锁住方向。
