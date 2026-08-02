# 技术调研报告 — F241 图保活消费接线 + KB 三薄层 + grounding pilot

**调研模式**: codebase-scan（仅扫本仓代码与既有制品，不做 Web 调研）
**基线**: worktree `modest-ellis-e4f0fe`，分支 `claude/f241-keepalive-kb-grounding-54ef99`，commit `2e3a4cd`
**约束**: 本报告只走读代码，未修改任何源码/配置/测试，未运行任何会覆写 `specs/_meta/graph.json` 的命令。

---

## A. B4 现状与接入点

### A1. `graph-bootstrap-status.mjs` 的调用方与依赖约束

`scripts/lib/graph-bootstrap-status.mjs` 导出 `checkFreshness`（`scripts/lib/graph-bootstrap-status.mjs:337`）、`buildStatusPayload`（`scripts/lib/graph-bootstrap-status.mjs:139`）、`attemptLocalGraphBuild`（`scripts/lib/graph-bootstrap-status.mjs:418`）、`main` CLI 入口（`scripts/lib/graph-bootstrap-status.mjs:520`，三个子命令 `write-status`/`check-freshness`/`attempt-build`）。

**当前调用方**（`grep -l graph-bootstrap-status` 全仓命中 13 个文件，剔除测试与 spec/plan/review 文档后生产调用方只有 1 个）：
- `scripts/sync-worktree-local-state.sh` —— F239 的 worktree/local 状态同步脚本，是唯一的生产消费方
- `tests/unit/graph-bootstrap-status.test.ts`、`tests/unit/sync-worktree-local-state.test.ts`、`tests/unit/worktree-lifecycle-hook.test.ts` —— 单测/集成测试
- `docs/spectra-cli-reference.md` —— 文档引用

**结论**：本模块目前是 F239 worktree bootstrap 场景的专用薄 adapter，**尚无任何插件侧（`plugins/spec-driver/`）消费方**——这正是本 Feature「消费接线」要补的缺口。

**零 repo node_modules / 零 dist 依赖的约束含义**（`scripts/lib/graph-bootstrap-status.mjs:17`）：该文件只用 Node 内置模块（`node:child_process`/`node:fs`/`node:path`），且 `checkFreshness` 通过 `spawn` 全局可执行文件 `spectra`（`scripts/lib/graph-bootstrap-status.mjs:347-353`）调用 `spectra graph-quality --json`，而非 import 编译产物。这意味着：
1. 若 B4 要在 `plugins/spec-driver/scripts/lib/`（goal-loop-core 所在目录）复用同一份 freshness adapter，**可以直接 import 这份 `.mjs`**（相对路径 `../../../scripts/lib/graph-bootstrap-status.mjs`），因为它本身零依赖、不会把 `src/` 的 TS 编译产物拉进插件运行时；
2. 但插件包分发时（`.claude-plugin`/`.codex-plugin`）若把 `plugins/spec-driver/` 单独打包，需确认 `scripts/lib/graph-bootstrap-status.mjs` 是否随插件一起打包，否则运行时 import 会找不到文件——**这是需要在 plan 阶段核实的分发面问题**，本报告未找到分发清单里对该文件路径的显式声明（未搜到 `.claude-plugin/plugin.json` 或 marketplace manifest 中列出 `scripts/lib/` 路径，需按 F239/F238 的分发经验核实）。

### A2. goal-loop-core.mjs 现有导出与 CLI 子命令

`plugins/spec-driver/scripts/lib/goal-loop-core.mjs` 导出的纯函数（共 13 个，含 1 个常量）：
- `PRESERVED_CONFIG_PATHSPECS`（常量，`:24`）
- `classifyCommand`（`:33`）
- `evaluateMetric`（`:52`）
- `validateFullCommandKinds`（`:91`）
- `isCleanExcludingPreserved`（`:191`）
- `parsePreservedConfigStates`（`:215`）
- `assessPreservedConfigSafety`（`:309`）
- `detectRegression`（`:331`）
- `computeDelta`（`:362`）
- `decideStop`（`:391`）
- `decideDispatch`（`:551`）
- `selectVerifyMode`（`:573`）
- `planSnapshotCommands`（`:589`）
- `planRollbackCommands`（`:617`）
- `parseReport`（`:670`）
- `interpretImpactResult`（`:739`）
- `formatIterationLogEntry`（`:777`）

`goal-loop-cli.mjs`（`plugins/spec-driver/scripts/goal-loop-cli.mjs:12-31` 注释列出全部子命令）：`parse-report` / `classify-command` / `decide-stop` / `plan-snapshot` / `plan-rollback` / `select-verify-mode` / `decide-dispatch` / `interpret-impact` / `format-iteration-log-entry` / `assess-preserved-config-safety` / `is-clean-excluding-preserved` / `acquire-lock` / `release-lock`。

**`interpretImpactResult` 现状**（`plugins/spec-driver/scripts/lib/goal-loop-core.mjs:739-770`）：只处理三种情形——`mcpResult == null`（跳过注入）、`mcpResult.error` 存在（跳过注入 + 透传 error 文案）、`affected` 为空且无 `summary`（跳过注入）。**全函数体内零 freshness 相关判定**——没有读取、传入或引用任何 `freshness` / `graph-quality` / `stale` 字段。已用 `Grep` 在配套测试 `plugins/spec-driver/tests/goal-loop-core.test.mjs` 中确认 `freshness` 关键词零命中（该文件 `describe('interpretImpactResult (FR-012)')` 块，`:560-589`，四个测试用例只覆盖 空/error/null/连接失败 四态，无 freshness 相关断言）。这印证了 spec 背景描述中「goal_loop 目前不感知 graph freshness」的判断。

### A3. `spectra graph-quality` JSON schema 与四态语义

CLI handler：`src/cli/commands/graph-quality.ts`。核心结构 `GraphQualityReport`（组装于 `buildReport`，`src/cli/commands/graph-quality.ts:251-279`）含字段：`graphPath`/`generatedAt`/`schemaVersion`/`duplicateCanonicalId`/`containsCoverage`/`orphanRatio`/`danglingEdges`/`legacyAndIgnoredNodes`/`freshness`/`overallVerdict`/`nextSteps`。

`freshness` 字段本身是 `GraphFreshnessVerdict`（引用自 `src/panoramic/graph/source-commit.js`，由 `evaluateFreshness` 产出，`src/cli/commands/graph-quality.ts:254`），四态为：
- `fresh` — 记录的 sourceCommit 与当前 HEAD 一致
- `dirty` — 工作树有未提交改动（`src/cli/commands/graph-quality.ts:236-246`，含 `porcelainReadFailed` 保守判定分支）
- `stale` — sourceCommit 与 HEAD 不一致（`src/cli/commands/graph-quality.ts:231-235`）
- `unknown-provenance` — 无法判定（旧图产物缺字段 / 非 git 仓库等）

`overallVerdict` 四态与退出码契约（`computeOverallVerdict` `src/cli/commands/graph-quality.ts:184-194` + `exitCodeFor` `:356-360`）：
- `pass`（exit 0）— 五项结构指标全 pass 且 freshness 非 stale
- `pass-with-warnings`（exit 0）— 结构指标有 warning，或 freshness 为 `stale`（**注意 `stale` 只降级 exit code 到 0，不阻断**；`dirty`/`unknown-provenance` 不参与 `computeOverallVerdict` 的判定分支，只在结构层面被忽略——即 freshness 唯一能把 overallVerdict 拉到 `pass-with-warnings` 的状态是 `stale`）
- `fail-strong-invariant`（exit 1）— 重复 canonical ID / 悬空边等强不变量违反
- `cannot-assess`（exit 2）— 图缺失 / JSON 解析失败 / schemaVersion 不支持

`--status` 轻量模式（`toStatusReport`，`src/cli/commands/graph-quality.ts:281-287`）只输出 `graphExists`/`freshness`/`overallVerdict` 三字段，是 `checkFreshness` adapter 实际消费的形态子集（`checkFreshness` 读取的是完整 `--json` 输出里的 `report.freshness`，见 `scripts/lib/graph-bootstrap-status.mjs:388`）。

### A4. 增量刷图能力现状

`Grep` 全文搜索 `src/cli/commands/batch.ts` 中 `mode ===` / `'graph-only'` 等模式，只命中一处：`command.batchMode === 'graph-only'`（`src/cli/commands/batch.ts:59`）。该分支直接调用 `buildAstGraphOnly(projectRoot, { outputDir })`（`src/cli/commands/batch.ts:66-68`），**函数签名不接受任何 changed-files / file-filter 参数**（已 `Grep` `src/batch/batch-orchestrator.ts` 搜索 `changedFiles`/`filePaths`/`targetFiles` 零命中）。`command.incremental` 标志（`src/cli/commands/batch.ts:48/98/114`）只作用于**非 graph-only 路径**的 spec-gen `regenPlan`（`resolveRegenPlan`，`src/cli/commands/batch.ts:97-101`），控制的是"是否重新生成 spec 文档"，与图构建的增量无关——`graph-only` 分支在 `resolveRegenPlan` 调用**之前**就已经 `return`（`src/cli/commands/batch.ts:76-77`），完全绕过 incremental 逻辑。

**结论**：仓内目前只有「全量重建图」（`spectra batch --mode graph-only`，纯 AST，零 LLM）一个入口，**没有"只按变更文件集刷新图"的既有能力**。MEMORY 里记录该命令耗时量级为 `self-dogfood`（~250 .ts / 17 module）级别项目 <2min；`spectra-cli-reference.md` 与 CLI `--help` 输出（`src/cli/commands/graph-quality.ts:38-67` 同侧证据）也印证这是当前唯一建图路径的定位。B4 描述的「①改既有代码任务前增量刷图」若要落地，要么（a）新增一个真正按 diff 文件集重建图的增量入口（工作量大，涉及 batch-orchestrator 内部 AST 聚合逻辑），要么（b）retain 现状「只能全量 graph-only 重建」但控制**触发时机**（只在检测到图 stale 时才触发全量重建，而非无条件），把"增量"语义落在"按需触发全量"而非"部分刷新"。**这是需要 spec 阶段明确决策的开放问题**，见文末建议。

### A5. implement/verify phase 编排与 B4 挂载层选择

`plugins/spec-driver/config/orchestration.yaml` 中 feature 模式 Phase 6（`implement`，`:317-327`）与 Phase 7c（`verify`，`:366-376`）均为 `agent_mode: single`，无内建的"phase 前置钩子"字段（`gates_before`/`gates_after` 只关联到声明式 `GATE_*`，不是任意脚本挂载点）。goal_loop 相关的循环编排逻辑不在 `orchestration.yaml` 里，而在 feature SKILL.md 的散文段落（`orchestration.yaml:310-316` 注释明确指出：「循环逻辑在 feature SKILL.md 的『goal_loop 闭环编排』小节（声明性标签 + 散文编排）」）。

三种候选挂载层的可测性差异：
1. **orchestration phase**（新增 `gates_before`/独立 phase）——需要在 `orchestration-schema.mjs` 增加新字段或新 gate 类型，改动面涉及 schema/resolver/CLI 三层（按 CLAUDE.md「orchestration-overrides.yaml 支持字段」约束，MVP 不支持任意新字段），**可测性**：可通过 `orchestrator-cli.mjs effective-orchestration` 单测验证配置合并，但触发逻辑仍要落到散文层执行，orchestration 层本身只是声明。
2. **hook**（类似 F239 的 `worktree-lifecycle-hook`）——`tests/unit/worktree-lifecycle-hook.test.ts` 证明这类 hook 有独立可单测的 core 模块先例（`scripts/lib/graph-bootstrap-status.mjs` 被 hook 消费）。**可测性**：hook 触发时机由 Claude Code 的生命周期事件驱动，不受 spec-driver 编排流程直接控制，与"implement/verify phase 前"这个语义耦合较弱（hook 是会话级不是 phase 级）。
3. **goal-loop-core.mjs 纯函数**（新增类似 `interpretImpactResult` 但吃 freshness 的函数）——**可测性最高**：goal-loop-core 现有 13 个函数全部有对应 `plugins/spec-driver/tests/goal-loop-core.test.mjs` 单测（node:test，纯函数无 I/O），新增一个 `evaluateGraphFreshnessGate(freshnessState, ...)` 之类的纯函数可以完全复用现有测试范式；I/O 边界（实际 spawn `spectra graph-quality`）留给 CLI 层（类似 `graph-bootstrap-status.mjs` 的 `checkFreshness` 与 core 的分层）。

**倾向性判断**（供 spec 参考）：goal-loop-core 纯函数路线在可测性和与现有架构一致性上最优，但**它只覆盖 goal_loop agent_mode**——B4 描述的「implement/verify 前刷图」如果要覆盖 `agent_mode: single`（默认路径，非 goal_loop）的常规 feature 流程，还是得回到 SKILL.md 散文层或 hook 层。这是 spec 阶段必须先定的范围边界：**B4 只做 goal_loop 消费接线，还是覆盖全部 implement/verify 路径**？

### A6. 任务类型分类信号来源

`Grep` 未找到仓内既有的"任务分类为改既有代码 vs 纯新增无 caller"的判定逻辑或字段。可考察的信号来源：
- **tasks.md**：`plugins/spec-driver/agents/tasks.md`（未在本次调研范围内详读，需 plan 阶段核实其模板是否已有"新增/修改"标注字段）
- **git diff**：客观但要在 implement 执行**前**知道会改哪些文件，语义上有鸡生蛋问题（要刷图判断 impact，但 impact 又依赖已知会改的文件）——更适合作为 implement **后**、verify **前**的触发信号（"本轮改了哪些文件 → 若含既有文件则判需要 impact"）
- **spec 的 FR**：太粗粒度，不含文件级信息
- **显式声明**：tasks.md 里让 implement 子代理在执行前自报"这是新增模块还是修改现有代码"，类似 F204 `kind` 自报机制（`plugins/spec-driver/scripts/lib/goal-loop-core.mjs:74-89` `validateFullCommandKinds` 的自报模式先例，但该机制本身也标注了"能挡遗漏不能挡对抗性自我误标"的边界）

**先例**：F204 的 `kind` 字段自报 + `full_required_kinds` 校验（`plugins/spec-driver/scripts/lib/goal-loop-core.mjs:91-115`）是仓内唯一"任务/命令类型分类"的显式先例，但那是校验**验证命令**的类别完整性，不是分类**开发任务**本身。**结论**：仓内没有可直接复用的任务分类先例；最可靠的信号应该是 **git diff（执行后）**——用"本轮 implement 实际改了哪些文件"驱动 verify 前的 impact 消费判定，而非试图在执行前静态分类任务性质。

---

## B. 轨道 E 现状

### B1. no-hit 表达现状

`kb_search`（`src/kb-mcp/tools/kb-search.ts`）：无命中时 `merged` 数组为空，`payload.results = []`、`payload.total_found = 0`（`src/kb-mcp/tools/kb-search.ts:115-121`）——**是隐式空数组，没有显式 `no_hit` / `noHit` 字段**。

`kb_api_lookup`（`src/kb-mcp/tools/kb-api-lookup.ts`）：无匹配实体时**有**显式字段：`{ results: [], total_found: 0, not_found: true, ... }`（`src/kb-mcp/tools/kb-api-lookup.ts:141-149`）——这是唯一一处显式 no-hit 字段，命名为 `not_found` 而非 `no_hit`。

`spectra scaffold-kb query` CLI（非 MCP tool）：`merged.length === 0` 时打印 `console.error('[scaffold-kb query] no-hit')` 并 `return`（exit 0，空 stdout）（`src/cli/commands/scaffold-kb.ts:61-64`）——**这是仓内唯一含字面量 "no-hit" 字符串的位置**，但只是打到 stderr 的人读提示，**没有任何持久化**（不写文件、不落 telemetry）。

**复核初查结论**：初查 `Grep "no-hit|noHit"` 在 `src/` 下确实只命中 1 个文件（`src/cli/commands/scaffold-kb.ts`），而非零命中——比预期多这一处 CLI 侧字面量，但仍然印证「MCP tool 层（kb_search/kb_api_lookup）没有统一、持久化的 no-hit telemetry」的核心判断。

**telemetry 现状**（`src/mcp/lib/telemetry.ts`）：`withTelemetry` 装饰器（`:119-144`）包裹 `kb_search`/`kb_api_lookup` 两个工具的注册（`src/kb-mcp/tools/kb-search.ts:147`、`src/kb-mcp/tools/kb-api-lookup.ts:256`），但只在 `SPECTRA_MCP_TELEMETRY_PATH` 环境变量设置时才写 JSONL（`src/mcp/lib/telemetry.ts:40-41`，静默 no-op 降级），且写入的 `TelemetryEntry`（`:18-32`）不含任何 no-hit / query 内容字段——只有 `requestSize`/`responseSize`/`durationMs`/`errorCode`/`responseSummary`/`responseSamples`，而 KB 两个工具走 `withTelemetry` 顶层包装（不是 `recordAndReturn` 手动调用路径），**不会填充 `responseSummary`/`responseSamples`**（这两个字段只有 agent-context 工具的 `runAgentContextTool` 手动路径会填，`src/mcp/agent-context-tools.ts` 内部逻辑，本次未详读但 grep 佐证 `recordAndReturn` 调用点集中在该文件）。**结论：coverage-gap 三薄层要做的"聚合 no-hit telemetry"目前完全不存在，需要从零建**。

### B2. query-sanitizer.ts 的脱敏能力

`src/scaffold-kb/query-sanitizer.ts` 的 `sanitizeQuery` 是 **FTS5 查询语法构造器**（token 化 + 双引号包裹防 FTS5 操作符歧义，`:26-57`），**不是内容脱敏/PII 遮蔽层**。已用 `Grep` 在 `src/scaffold-kb/` 下搜索 `redact|Redact|mask|Mask|pii|PII` 零命中。另有 `defangSentinel`（`src/scaffold-kb/evidence-envelope.ts`，被 `kb-api-lookup.ts:21` 引用）是**防 prompt injection 的 sentinel 脱敏**（把内容里可能冒充系统指令的标记字符串"拆解"），语义上是"防止 KB 内容被当指令执行"，也**不是** PII/隐私脱敏。

**结论**：仓内**没有任何面向"查询内容 + 结果做隐私/内容脱敏后再聚合成 telemetry"的现成能力**。spec 里「内容与查询先脱敏再聚合」这条约束需要全新设计——`sanitizeQuery` 和 `defangSentinel` 都不能直接复用，只能作为"仓内已有两种不同语义的脱敏/转换函数命名参考"。

### B3. KB schema 与 meta 表现状

`src/scaffold-kb/sqlite-writer.ts:16-36`：`chunks`（FTS5 虚拟表，含 `chunk_id`/`doc_id`/`content_raw`/`content_tokenized`）+ `chunk_meta`（普通表，含 `chunk_id`/`doc_id`/`doc_title`/`source_url`/`anchor`/`sdk_version`/`built_at`/`ingest_source_type`/`ingest_origin`/`ingested_at`）。**没有独立的库级 meta 表**——`built_at`/`ingested_at`/`sdk_version` 都是**逐 chunk** 冗余字段，没有单一"本库整体 build age / ingest age / source version"的汇总行。

`src/scaffold-kb/schema-compat.ts:19-33`（`hasProvenanceColumns` 探测函数）是**现有的 schema 版本兼容先例**：用 `PRAGMA table_info(chunk_meta)` 探测列是否存在，旧库（F190 时期建的，无 provenance 三列）走兼容分支，新库（F192 起）走完整 SELECT。**这是加新表/新列时应遵循的兼容模式**——三薄层如需在 `chunk_meta` 之外新增 meta 表或列，应参照该探测-兼容模式，而不是假设所有历史库都有新字段。

### B4. version selection：既有解析器与实体版本字段

`src/panoramic/project-context.ts:27-38`（`LOCK_FILE_PRIORITY`）：仓内**已有**依赖管理器**检测**能力——识别项目用了 npm/pnpm/yarn/uv/pipenv/go/maven/gradle 中的哪一个（按 lock 文件优先级），但**只识别"用了哪个包管理器"，不解析 lock 文件内容拿具体依赖版本号**（未搜到任何解析 `package-lock.json`/`go.sum` 内容提取版本的代码）。

`AbstractConfigParser`（`src/panoramic/parsers/abstract-config-parser.ts:18-44`）是 YAML/ENV/TOML 三个配置解析器的共同基类，**语义上不覆盖 lock 文件**（lock 文件是 JSON/自定义格式，不在 YAML/ENV/TOML 范畴）——**结论：AbstractConfigParser 不覆盖版本推断需求，需要新写 lockfile parser**。

`src/scaffold-kb/types.ts` 里 `ApiEntity` 含 `sinceVersion?: string | null`（`:78`）——**实体级**已有版本字段（表示该 API 从哪个 SDK 版本开始存在），但这是"文档描述的 API 起始版本"，不是"用户项目实际安装的依赖版本"。文件级 `sdkVersion: string | null`（`types.ts:54/110/139/154`）是**库级**字段，来自 ingest 时的手工/元数据输入，不是自动从 lockfile 推断。

### B5. `spectra scaffold-kb` CLI 现有子命令

`src/cli/commands/scaffold-kb.ts:134/160/165/170`（`op === 'build'|'query'|'ingest'|'serve'`）——四个子命令：`build`（文档→KB）、`query`（一次性预查，供 goal-loop 等外部脚本调用，`src/cli/commands/scaffold-kb.ts:21-73`）、`ingest`（三方源导入，`:76-`）、`serve`（启动 KB MCP server）。

**加子命令 vs 加 MCP tool 的架构一致性判断**：`query` 子命令是 F191 为"预查注入"场景设计的**非 MCP 消费路径**（供 SKILL.md 散文或 hook 直接 spawn CLI 用，输出 markdown/json 到 stdout），这是仓内已有的"CLI 子命令服务于编排层，MCP tool 服务于 agent 运行时对话"分工先例。三薄层里：
- **coverage-gap**（聚合分析，非实时对话场景）→ 更像 `query` 一类的**CLI 子命令**（如 `spectra scaffold-kb coverage-gap`），供 repo:check 或独立报告生成器调用
- **version selection**（一次性推断，构建态）→ 也偏 **CLI 子命令**（build/ingest 时机自然嵌入，或独立子命令）
- **freshness status**（暴露状态，可能被 agent 实时查询"这个 KB 新不新"）→ 更适合做成 **MCP tool 字段**（附加在 `kb_search`/`kb_api_lookup` 现有响应里，类似已有的 `built_at`/`sdk_version` 字段扩展），而非独立工具（避免 MCP tool 数量膨胀）

---

## C. 回归护栏面

### C1. goal_loop 现有测试资产

`plugins/spec-driver/tests/goal-loop-core.test.mjs`（唯一核心单测文件，node:test）+ `plugins/spec-driver/tests/goal-loop-snapshot-rollback-integration.test.mjs`（集成测试）。核心测试覆盖（按 `describe` 块枚举，节选）：`classifyCommand (FR-009)`、`evaluateMetric (FR-008)`、`parseReport (FR-010)`（含 C3 vacuous-truth 防护、WARNING-1 verify_mode 校验等冻结型断言）、`computeDelta (FR-006)`、`detectRegression (FR-013)`、`interpretImpactResult (FR-012)`（`:560-589`，四态：有效数据/error/null/连接失败）。

**改动 goal-loop-core 会碰到的冻结型断言**：若在 `interpretImpactResult` 或 `decideStop` 中插入 freshness 判定逻辑，**必须**保持现有四个 `interpretImpactResult` 测试用例不变（它们不含 freshness 字段输入，新逻辑必须对"无 freshness 字段"的旧调用形态优雅降级，否则会破坏这四条 `plugins/spec-driver/tests/goal-loop-core.test.mjs:560-589` 断言）。`decideStop` 的测试更庞大且含大量 Codex 修复注释标记的不变量断言（`:391-477` 源码注释密度极高，暗示该函数历史上被多轮对抗审查加固），新增 freshness gate 若挂在 `decideStop` 而非独立函数，回归风险显著更高——**倾向新增独立纯函数而非改造 `decideStop`/`interpretImpactResult` 本体**。

### C2. KB 现有测试资产

`tests/kb/` 目录（`Glob` 命中）：`kb-api-lookup-tool.test.ts`、`kb-contract.test.ts`、`kb-degradation.test.ts`、`kb-doc-lookup-tool.test.ts`、`kb-error.test.ts`、`kb-isolation.test.ts`、`kb-search-tool.test.ts`，另有 `tests/kb/url-fetcher.test.ts`、`tests/kb/office-parser.test.ts`、`tests/kb/arbitration.test.ts`（F192 ingest 链路的 SSRF/office-parser/仲裁守护测试，按 MEMORY F192 记录，这些正是"SSRF IP-literal 绕过/office streaming zip bomb/ingest fail-closed" 等 codex 红队修复对应的测试文件）。`kb-isolation.test.ts` 大概率是 vendor/project 双库隔离守护（未详读，需 plan 阶段核实）。三薄层若要改 `chunk_meta` schema 或响应字段，**必须**先跑通 `kb-contract.test.ts`（大概率是响应结构契约测试，字段增删需同步更新）与 `kb-degradation.test.ts`（降级路径测试）。

### C3/C4. `npm run repo:check` 现有 family 数量与状态

`package.json:34`：`"repo:check": "node scripts/repo-check.mjs"`。`scripts/repo-check.mjs` 委托给 `scripts/lib/repo-maintenance-core.mjs` 的 `validateRepository`。该核心模块顶部 import 了 16 个校验/生成函数（`scripts/lib/repo-maintenance-core.mjs:4-25`），含 `validateGraphQuality`（`:22`，对应 graph-quality family，F217 落地）与 `validateWorktreeLocalState`（`:25`，对应 worktree-local-state family，F239 落地，MEMORY 记为"第 15 族"）。**未能在本次预算内完整数出精确的 family 总数**（`validateRepository` 主体逻辑较长，只读了前 120 行含 import 与 `validateMarketplaceAndSettings` 一个内联 family，未逐一走读全部 `checks.push` 调用点）——按 MEMORY 记录口径，worktree-local-state 是第 15 族，可作为当前总数的下界参考，**精确总数需 plan 阶段完整读 `repo-maintenance-core.mjs` 全文确认**。

**新增能力是否需要进 repo:check**：若 B4/E 三薄层新增结构化状态文件（类似 `graph-bootstrap-status.json`）或新 schema 版本，参照 F217/F239 先例，应新增一个 `validate*` 函数 + `namespaceCheck` 注册（`scripts/lib/repo-maintenance-core.mjs:31-36` 的 `namespaceCheck` 是标准接入模式）。

**是否全绿**：**未运行 `npm run repo:check`**——该脚本的 import 列表里含多个 `generate*` 函数（`generateAdoptionInsights`/`generateProductEntityCatalog`/`generateProductQualityReports`/`generateProductScorecards`/`generateProjectContextSuggestions`/`generateWorkflowRegistry`，`scripts/lib/repo-maintenance-core.mjs:7-16`），命名暗示可能有文件写入副作用，与本任务「不修改任何文件」的硬约束冲突，**为遵守约束主动跳过实跑**，如实标注此项未验证。

---

## 对 spec 的输入建议（开放问题清单）

### 1. B4 挂载层选择——**推荐纯函数路线 + 明确范围边界**

**开放问题**：freshness gate 逻辑挂在 (a) `orchestration.yaml`/overrides schema 新字段、(b) hook、(c) `goal-loop-core.mjs` 新纯函数？

**推荐**：(c)，理由见 A5——现有 13 个 goal-loop-core 函数全部有配套 node:test 单测，新增同构函数（如 `evaluateGraphFreshnessGate`）可完全复用测试范式，且不触碰 orchestration schema（避免 CLAUDE.md 「MVP 不支持任意新字段」约束）。**但必须在 spec 里显式声明范围**：这条路线只覆盖 `agent_mode: goal_loop` 场景，**不覆盖默认 `agent_mode: single` 的常规 feature/implement 流程**。如果 spec 意图是覆盖全部 implement/verify（不只 goal_loop），需要额外在 SKILL.md 散文层加对应段落，且需要一份新的回归测试策略（散文层目前没有自动化测试覆盖先例，只能靠 E2E/人工审查）。

### 2. 任务分类信号来源——**推荐 git diff（执行后），拒绝执行前静态分类**

见 A6：仓内无可复用先例，静态分类在语义上有鸡生蛋问题。**推荐**：以 implement 阶段实际产出的 `git diff` 文件集作为 verify 前 impact 消费的判定输入——"改了哪些已存在文件" vs "只新增了哪些文件"可以从 diff 类型（M/A porcelain 状态码，`goal-loop-core.mjs` 里 `parsePreservedConfigStates` 已有 porcelain 解析先例可复用同一套解析器）机械判定，无需依赖 agent 自报（自报有 F204 记录的"对抗性自我误标"风险）。

### 3. E 三薄层落地形态——**建议分层：coverage-gap/version-selection 走 CLI 子命令，freshness-status 走 MCP 响应字段扩展**

见 B5 分析。**不建议**为三薄层都新增独立 MCP tool——当前 KB MCP 只有 `kb_search`/`kb_api_lookup`/`kb_doc_lookup`（`kb-doc-lookup-tool.test.ts` 佐证第三个工具存在，本次未详读）几个工具，MCP tool 数量膨胀会增加 agent 侧工具选择负担；CLI 子命令更贴合"运维/编排层消费，非实时对话"的语义，且有 `query` 子命令的既有分工先例（B5）。

### 4. no-hit telemetry 的脱敏层——**必须新写，不能复用现成模块**

见 B1/B2：`sanitizeQuery` 是 FTS5 语法构造，`defangSentinel` 是防注入 sentinel 拆解，两者都不是"聚合前对查询词/内容做隐私脱敏"。这条能力目前是**空白**，spec 需要明确脱敏范围（只脱敏查询词？还是连带聚合后的文档片段摘录也脱敏？）——本报告不做推荐，因为这直接涉及产品对"什么算敏感信息"的定义，超出代码走读能回答的范围。

### 5. version selection 的实现路径——**需要新写 lockfile parser，非 AbstractConfigParser 覆盖范围**

见 B4：`LOCK_FILE_PRIORITY` 只做管理器检测，不解析版本；`AbstractConfigParser` 语义上只覆盖 YAML/ENV/TOML。若要做"从 lockfile 推断依赖版本"，需要新增至少一个 lockfile parser（建议先做 `package-lock.json`/`pnpm-lock.yaml` JSON/YAML 结构相对简单，`go.sum`/`pom.xml` 格式差异更大，可分批实现或明确本轮只做 npm 生态）。

### 6. pilot 三指标的对照数据——**当前无对照组，需 spec 阶段决定是否新建**

调研范围内**未发现**任何"启用 Spectra→Spec Driver context-grounding 前 vs 后"的对照实验设施或历史数据（本报告未搜索 `specs/147-*`/`specs/187-*` 评测基础设施是否可直接复用于本 pilot 的对照场景，这是遗留的信息缺口，**如实标注未查**）。grounding 命中率 / impact coverage / review 发现率三个指标要有意义，通常需要 A/B（同一批任务开关 grounding 各跑一次）或历史基线（现有 baseline projects，见 CLAUDE.local.md 的三个固定 baseline：`micrograd`/`nanoGPT`/`self-dogfood`）两种对照路径之一。**没有对照就只能做绝对数值报告（"本次 pilot 命中率 X%"），无法证明"有没有用"**——建议 spec 阶段明确：是否要预算做小规模 A/B（哪怕只跑 self-dogfood 一个项目、5-10 个真实 F2xx 任务，开关对比），还是接受本轮 pilot 只做描述性统计、不做因果声明。

---

## 未找到 / 信息缺口清单（如实标注，不猜测）

- `plugins/spec-driver/agents/tasks.md` 模板是否已有"新增/修改"任务分类字段——未详读，需 plan 阶段核实
- `scripts/lib/repo-maintenance-core.mjs` 完整 family 总数——只读了前 120 行 + import 列表，未逐一枚举全部 `checks.push` 调用点
- `npm run repo:check` 当前是否全绿——遵守"不修改任何文件"约束主动未实跑（该脚本 import 了多个 `generate*` 函数，疑似有写入副作用）
- KB MCP 是否存在第三个工具 `kb_doc_lookup`（`tests/kb/kb-doc-lookup-tool.test.ts` 文件名佐证存在，但源码未读）
- `.claude-plugin`/`.codex-plugin` 分发清单是否包含 `scripts/lib/graph-bootstrap-status.mjs` 路径——未核实，直接影响 A1 提出的插件侧复用可行性
- `specs/147-*`/`specs/187-*` 评测基础设施是否可直接复用于 grounding pilot 的对照实验——未搜索确认
