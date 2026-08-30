---
description: "Task list for F266 空图/退化图 fail-loud 链 + MCP 返回面诚实化"
---

# Tasks: F266 空图/退化图 fail-loud 链 + MCP 返回面诚实化

**Input**: `specs/266-honest-graph-quality-gate/spec.md`（14 FR / 7 SC）、`specs/266-honest-graph-quality-gate/plan.md`（Q1–Q10 已裁决）
**Branch**: `claude/honest-graph-quality-gate-2e3add`
**风险等级**: HIGH（plan 已裁决）→ 阶段顺序固定为 **P1 门禁面 → P2 建图面 → P3 MCP 诚实返回面**，本文档不按 User Story 优先级重排该顺序（US2 对应 P1、US3+US4 对应 P2、US1+US5 对应 P3），仅在阶段内标注所属 US 便于独立可测性追踪。

**Tests**: 本卡 FR/SC 均要求可验证，测试与实现放在同一任务或紧邻任务内，同一 commit 交付。

**禁改清单（每个可能touch到相邻文件的任务需自查）**：`src/hooks/hook-installer.ts`、`src/utils/atomic-write.ts`（P0-D 专属）、`plugins/spectra/hooks/post-commit.sh`（FR-005，独立 `spectra index --incremental` 路径）、F217 六指标逻辑、F249 指纹逻辑、F193 `graph-format-stale` 错误路径语义。

---

## Phase 0: Setup（R-A 风险处置 + 验证脚本骨架）

**目的**：R-A 是 plan 明确的第一顺位任务——必须先处置共享 fixture helper 的风险，避免后续阶段的空图判定被自己制造的空 fixture 误伤；同时提前搭好最终验证要用的重算器脚本骨架。

- [x] **T001** 修改 `tests/helpers/freshness-stale-scenarios.ts` 的 `baseFreshnessGraph()`：将当前返回 `nodes:[], links:[]` 改为**最小非空图**（1 module + 1 component + 1 `contains` 边，`nodeCount`/`edgeCount` 字段同步更新）。
  **验收**：改动后立即跑 `npx vitest run tests/unit/graph-quality-builder-advisory.test.ts tests/unit/graph-quality-core.test.ts tests/unit/contracts/graph-quality-report-schema.test.ts tests/integration/graph-quality-cli.test.ts`（4 个消费方）全绿，且这 4 个文件本身**不修改**（只改 helper）。
  **依赖**：无（最先执行）。
  **FR/SC**：护栏任务，为 FR-006/007/008 的后续判定通道扫清障碍。

- [x] **T002** [P] 新建 `scripts/verify-feature-266.mjs`（对齐 `verify-feature-151/152/153.mjs` 命名与 CLI 参数惯例）：先搭好子命令骨架 `--mode byte-stable --target <path>`（同一 target 连续两次跑 `spectra batch --mode graph-only`，比较 graph.json sha256，不一致时定位并打印首个差异 JSON path）与 `--target <path> --before <graph.json> --after <graph.json> --symbols <list.json>`（逐符号对比 `impact`/`context`/`detect_changes` 结果集合，唯一允许 diff 为新增 `honesty` 键）两种模式的参数解析与占位实现。
  **验收**：`node scripts/verify-feature-266.mjs --help` 正常输出用法；两种模式各自的核心比对函数留 TODO 标记待 Phase 3 收尾时补全（不阻塞本任务交付，脚本骨架先行落库）。
  **依赖**：无（不同文件，可与 T001 并行）。
  **FR/SC**：SC-003、SC-006、FR-014 的执行载体。

---

## Phase 1: P1 门禁面 fail-loud（US2 — CI/门禁维护者信任 pass 判定）

**目标**：`nodes:[]/links:[]` 空图不再被判 pass，归入既有 `cannot-assess` 通道并继承 exit 2；builder 戳不参与判定（裁决 1）；正常图判定零回归。

**独立测试**：构造空图 fixture 单独跑 `graph-quality`，验证不再 pass 且 exit 2；对既有正常图跑改动前后逐字段 diff 为空。

- [x] **T003** [P] [US2] 核实 `scripts/lib/graph-quality-core.mjs`（约 `:87`、`:187-188`）是否存在按 `cannotAssessReason` 值枚举的白名单逻辑，而非仅按 `overallVerdict === 'cannot-assess'` 分级（R-F 风险，禁止凭假设跳过——F259 已有"判据写成值枚举=每加一个值漏一次"前车之鉴）。
  **验收**：产出明确结论（"无白名单，自动继承"或"存在白名单，需补 `empty-graph`"），写入本任务勾选说明或 commit message，供 T006 消费。
  **依赖**：无（可与 T001/T002 并行）。
  **FR/SC**：FR-006 前置核实。
  **核实结论（T003 → 供 T006 消费）**：**无白名单，自动继承**。`scripts/lib/graph-quality-core.mjs` 全文只有一处 `switch`（`:53` `describeStaleReason`），作用对象是 `staleReasons` 这一**另一维度**且带 `default` 兜底原样回传；`cannotAssessReason` 仅出现在 `:190`（warning 文案，`?? 'unknown'` 兜底）与 `:194`（check evidence 透传）两处，均非判定入口。cannot-assess 的严重度路由完全由 `report.overallVerdict === 'cannot-assess'`（`:187`）决定，与 reason 取值无关；`EXIT_CODE_FOR_VERDICT` 也只按 `overallVerdict` 键控，不涉及 reason。⇒ 新增 `empty-graph` 自动继承 warn 严重度，**无需改 .mjs 代码**；T006 改为补单测把该结论固化为回归网。

- [x] **T004** [US2] 修改 `src/cli/commands/graph-quality.ts`：`cannotAssessReason` 联合类型追加 `'empty-graph'`；在 `runGraphQualityCommand` 中于 shape 校验/schemaVersion 判定**之后**、`buildReport`（六指标）**之前**插入判据 `nodes.length === 0 && links.length === 0` 的空图闸，命中即 `return buildCannotAssessReport(graphPath, 'empty-graph', [...])`（不改 `validateGraphJsonShape`、不改 `exitCodeFor`）；新增 `tests/fixtures/graph-quality-empty-graph.json`（`schemaVersion: "2.0"`，不得用 `"3.0"`）；更新 `tests/unit/graph-quality-shape-validation.test.ts` 与 `tests/integration/graph-quality-cli.test.ts` 断言：空图 → `overallVerdict !== 'pass'` 且 `cannotAssessReason === 'empty-graph'` 且 exit 2；空图/缺图(`graph-missing`)/JSON 解析失败(`json-parse-error`) 三者 reason 互不相同；`nodes` 非空但 `links` 空**不**触发本判据。
  **验收**：`npx vitest run tests/unit/graph-quality-shape-validation.test.ts tests/integration/graph-quality-cli.test.ts` 全绿；代码路径上不读取 builder 戳字段（grep 确认判据函数体内无 `describeBuilderStamp`/`builderStamp` 引用）。
  **依赖**：T001（避免共享 helper 冲突）。
  **FR/SC**：FR-006、FR-007（结构性满足，不翻转退出码）、FR-008（正常图路径零改动）。

- [x] **T005** [P] [US2] 修改 `specs/217-graph-quality-gates/contracts/graph-quality-report.schema.json`：`cannotAssessReason` 枚举追加 `empty-graph`（追加式，旧枚举值全保留）；更新 `tests/unit/contracts/graph-quality-report-schema.test.ts` 覆盖新枚举值的 schema 校验通过。
  **验收**：`npx vitest run tests/unit/contracts/graph-quality-report-schema.test.ts` 绿；旧 fixture（含旧 reason 值）仍通过 schema 校验。
  **依赖**：无（与 T004 不同文件，可并行；但需在 T004 定稿 reason 字面量后核对拼写一致，建议合并 commit）。
  **FR/SC**：FR-006（契约层）、FR-013（追加式向后兼容）。

- [x] **T006** [US2] 根据 T003 结论处理 `scripts/lib/graph-quality-core.mjs`：若存在 reason 白名单则补 `empty-graph`；若无白名单（仅按 `overallVerdict` 分级）则不改动代码，但仍需新增一条单测覆盖 `empty-graph` 输入下该脚本的映射行为（warn 严重度），把"无需改动"这一结论固化为回归网而非口头声明。
  **验收**：新增/更新的单测覆盖 `empty-graph` 输入场景并通过；若判定为无需改代码，commit message 中显式记录 T003 的核实结论。
  **依赖**：T003（结论）、T004（`empty-graph` reason 已落地）。
  **FR/SC**：FR-006（下游消费侧一致性）。

- [x] **T007** P1 阶段收尾：`npm run build` → `npx vitest run tests/unit/graph-quality-* tests/integration/graph-quality-* tests/unit/contracts/graph-quality-report-schema.test.ts` → `npm run repo:check`，全部零失败；额外人工确认 `tests/unit/graph-quality-builder-advisory.test.ts` 既有断言（builder 戳不一致不翻转退出码）保持绿色不变。
  **验收**：三项命令零失败；本阶段 checkpoint 达成，可独立回滚（回滚粒度：还原 T004-T006 涉及文件 + 还原 T001 的 helper）。
  **依赖**：T001, T003, T004, T005, T006。
  **FR/SC**：FR-006/007/008 阶段级验收。

---

## Phase 2: P2 建图面 fail-loud（US3 — 非 src 布局告警 / US4 — post-commit hook 真实生效）

**目标**：非 src 布局项目全量 batch 建图时产生可观测提示；post-commit hook 与 `spectra graph` 命令均不再静默把好图覆写为贫图；相关文档文案与真实行为一致。

**独立测试**：US3 用仅含 `lib/` 的临时工程跑全量 batch 验证 warn 出现、graph-only 路径零 warn；US4 用已建好图的临时工程模拟 commit 前后图内容对比 + 文档人工审阅。

- [x] **T008** [P] [US3] 修改 `src/knowledge-graph/module-derivation.ts`（`:359-379` 区域过滤循环）：新增 `scannedCandidateCount`（通过基础过滤、进入 `includeOnlyRe` 判断的候选文件数）与 `includedCount`（通过 `includeOnlyRe` 的数）两计数；仅当 `scannedCandidateCount > 0 && includedCount === 0` 时触发既有 `logger.warn` 通道（不新增 channel、不改返回类型、不抛异常），文案含扫描根、生效的 `includeOnly` 正则字面量、被滤掉的候选数、≤3 条样例路径；由于 R-1 已核实 `includeOnly` **无任何对外 CLI flag / config 键**，文案 MUST 如实写"当前默认只扫描 `src/` 目录，本项目源码不在该目录下"，**不得杜撰不存在的开关**。默认过滤器 `/^src\//` 本身不改。新增 `tests/unit/module-derivation-empty-scope-warning.test.ts` 覆盖三场景：扫到候选但 `includeOnly` 命中 0 → warn 触发且含正则/样例路径；扫到 0 个候选（空工程）→ 不 warn；src 布局命中 >0 → 不 warn；`graph-only` 路径（不经 `selectPrimaryModuleGraph`）→ 注入的 logger 上 warn 调用次数为 0。
  **验收**：`npx vitest run tests/unit/module-derivation-empty-scope-warning.test.ts` 全绿。
  **依赖**：无（可与 T009/T010/T011 并行，不同文件）。
  **FR/SC**：FR-001、FR-002。

- [x] **T009** [P] [US4] 修改 `src/hooks/git-hook-installer.ts` 的 `generatePostCommitSegment()`：命令由（读缓存不解析源码的）`spectra graph` 换成 `spectra batch --mode graph-only`（纯 AST、零 LLM、无需认证）；超时从 30s 提到 180s；kill 分支由完全静默 (`>/dev/null 2>&1`) 改为产物写日志文件 + 超时时向 stderr `echo` 一行简短提示；段落仍用 `# --- spectra begin/end ---` 幂等整段替换（旧安装需重新运行 `spectra install --git` 才会纠正，不追溯改写已安装文件）。更新对应既有单测（hook 生成内容断言）覆盖新命令字面量、新超时值、kill 分支可见化行为；新增一条断言：`plugins/spectra/hooks/post-commit.sh` 文件内容与改动前完全一致（FR-005 显式护栏，读取该文件 hash 前后对比）。
  **验收**：相关单测全绿；`git diff --stat plugins/spectra/hooks/post-commit.sh` 为空。
  **依赖**：无（与 T008 不同文件，可并行）；**禁止触碰** `src/hooks/hook-installer.ts`。
  **FR/SC**：FR-003（换命令部分）、FR-005。

- [x] **T010** [P] [US4] 修改 `src/cli/commands/graph.ts`：写盘前读取既有 graph.json 的 `nodeCount`/`edgeCount`，若新图任一低于旧图 → 拒绝覆写 + 非零退出 + 提示改用 `spectra batch --mode graph-only`；提供 `--force` 显式覆盖逃生口；旧图不存在/无法读取/缺 `nodeCount` 字段 → 放行（不得把"没有基线"误判成"退化"）；判据仅用结构性计数指标，不引入语义化质量评分（避免与 F217 六指标职责重叠），阈值严格不减、不设百分比容忍。新增 `tests/unit/graph-command-degradation-guard.test.ts` 覆盖：新图 node/edge 任一少于旧图 → 拒写 + 非零退出；`--force` 放行；旧图缺失/缺字段 → 放行。
  **验收**：`npx vitest run tests/unit/graph-command-degradation-guard.test.ts` 全绿；**禁止触碰** `src/utils/atomic-write.ts`（依赖其既有 atomic 写入保证，不修改该文件本身）。
  **依赖**：无（与 T008/T009 不同文件，可并行）。
  **FR/SC**：FR-003（`graph` 命令守卫部分）。

- [x] **T011** [P] 更新文档文案：`README.md`（`:158` 主文案，评估后决定 `:89` 是否同改）与 `docs/spectra-cli-reference.md`（`:156`、`:204` 两处），删除/改写"增量重建"（incrementally rebuilds）等超出实际能力的措辞，改为如实描述 `spectra batch --mode graph-only` 的真实行为（纯 AST 重建，非增量解析）。
  **验收**：人工审阅确认四处文案（README 1-2 处 + CLI reference 2 处）均不再出现与 T009 实际行为不符的措辞；`git diff README.md docs/spectra-cli-reference.md` 逐处可对照本任务描述核对。
  **依赖**：T009（需确认最终命令措辞后再定稿文案）。
  **FR/SC**：FR-004。
  **README `:89` 评估结论**：**不改**。该行文案为 "🔄 **Continuous sync** — `spectra watch` (file watcher) or `spectra install` (post-commit hook)"，只陈述两条同步入口的存在，**不含**任何 "incremental" / 增量重建的能力声称，与改动后的真实行为无冲突。改动落在 `README.md:158` 一处 + `docs/spectra-cli-reference.md` 两处（`:156` 安装说明块、`:204` Keepalive 块）。

- [x] **T012** P2 阶段收尾：`npm run build` → 相关单测子集（T008-T010 涉及文件）→ `npm run repo:check` 全部零失败；实跑验证：(1) 构造仅含 `lib/` 目录的临时工程跑全量 `batch` 建图，人工确认 10 秒内可在日志/命令输出中定位到"模块图为空"的提示（SC-004）；(2) 同一临时工程跑 `batch --mode graph-only`，确认无 warn 产出（FR-002）；(3) 本仓（src 布局）跑一次全量 batch 确认零新增噪声。
  **验收**：三项命令零失败 + 三项实跑观察均符合预期；本阶段可独立回滚（回滚粒度：还原 T008-T011 涉及文件）。
  **依赖**：T008, T009, T010, T011。
  **FR/SC**：FR-001/002/003/004/005 阶段级验收，SC-004。

---

## Phase 3: P3 MCP 诚实返回面（US1 — agent 得到诚实的"零结果" / US5 — detect_changes 口径声明）

**目标**：`impact`/`context`/`detect_changes` 三工具追加 `honesty`（resolution/coverage/freshness/comparisonScope），成因①③互斥、②③合并为 `coverage-gap` 并显式标注 `separable: false`，④图陈旧与①②③正交并行；`nextStepHint` 按实际成因改写；`detect_changes` 声明比较口径；一切为追加式扩展。

**独立测试**：构造四种图状态（+组合态）分别调用三工具，验证返回体可判读对应成因且不产生混淆；外部语料 A/B 证明既有结果集合零变化。

- [x] **T013** 新建 `src/mcp/lib/graph-honesty.ts`：实现 `ResolutionReason`（`confirmed-zero` / `boundary-exposed` / `coverage-gap`，互斥）、`ResolutionVerdict`（含 `evidenceScope`、`detail`）、`CoverageGap`（`callSitesDetected`/`callEdgesLinked`/`unlinkedCallSites`/`linkageRatio`/`separable: false`/`skippedSources`）、`GraphHonesty`（`resolution?`/`coverage?`/`freshness`/`comparisonScope?`）、`GraphFreshnessAdvisory`（内嵌 `evaluateFreshness()` 既有判定结果 + 独立 `builderMismatch`/`builderDetail`，裁决 1：不进 `staleReasons`、不参与判定）、`ComparisonScopeDeclaration`；resolution 判定优先级固定为 symbol 级证据（导出面/external 节点）优先于 graph 级缺口（`unlinkedCallSites > 0` 或 `skippedSources` 非空）优先于 `confirmed-zero`；**不自行 spawn git**，复用 `evaluateFreshness()`；module 级 `Map<projectRoot, {...}>` 缓存，命中条件为 projectRoot 相同 + graph 文件 mtime/size 未变（与 `getCachedGraphData` 同源判据）+ `Date.now() - at < FRESHNESS_TTL_MS`（初值 2000）；导出 `__resetHonestyCache()` 供测试清理；`buildHonestyAnnotation` 接受可选注入 `{ evaluateFreshnessFn, now }` 的 seam。新建 `tests/unit/mcp-graph-honesty.test.ts`：覆盖三个 resolution 值各自的构造用例与优先级唯一性；`coverage-gap` 态显式带 `separable: false`；`coverage` 与 `freshness` 同时呈现（正交性，如"解析缺口 + 图陈旧"组合态）；缓存命中/失效（TTL 窗口内连续 10 次调用注入的 `evaluateFreshnessFn` 仅调用 1 次，graph 文件 mtime 变化后立即触发第 2 次调用）；全部零 git spawn、零真实时钟（用注入 seam）。
  **验收**：`npx vitest run tests/unit/mcp-graph-honesty.test.ts` 全绿，且用例中不存在真实 `child_process`/`git` 调用（grep 确认测试文件无相关 spawn）。
  **依赖**：无（新文件，可在 Phase 1/2 期间提前开工，但收尾验证放在本阶段）。
  **FR/SC**：FR-009、FR-013（字段契约）、Q4 缓存验收。
  **落地说明（T013）**：`buildHonestyAnnotation` 复用 `getCachedGraphData` 已返回的 `mtimeMs/sizeBytes`（不二次 stat，失效判据与之同源）；新增一个 plan 未列的可选字段 `annotationDegraded?: true` —— 标注自身计算失败时置位并写 stderr，避免兜底的 `unknown-provenance` 冒充真实判定（宪法 IV）。`npx vitest run tests/unit/mcp-graph-honesty.test.ts` → 76 passed；`grep child_process|spawnSync|Date.now()` 该文件零命中（零 git spawn、零真实时钟）。

- [x] **T014** [US1] 修改 `src/mcp/lib/response-helpers.ts`：三工具字段接口（约 `:21`/`:28`/`:36`）追加 `honesty?: GraphHonesty`；`generateNextStepHint`（约 `:84+`）改为接受 `GraphHonesty` 入参、按 (resolution × freshness.state) 组合出对应文案，改写既有 `:104`/`:115`/`:125` 三处"确认为零"式确定性措辞（如 context 的"可能为顶层入口"、impact 的"检查 symbol ID 是否正确"、detect_changes 的"暂无上游调用方"）；`generateNextStepHint` 保持零 I/O 纯函数（不新增 git 调用）；`coverage-gap` + `stale` 组合态文案须同时出现"解析未完成/覆盖不足"与"图已过期，建议重建"两层含义；`linkageRatio` 按量级分档给出不同措辞（不设硬阈值分档以外的语义评分）。在 `tests/unit/mcp-graph-honesty.test.ts` 中补充表驱动用例覆盖 `generateNextStepHint` 的全部 (resolution × freshness) 组合。
  **验收**：`npx vitest run tests/unit/mcp-graph-honesty.test.ts` 全绿（含新增表驱动用例）；`generateNextStepHint` 函数签名变更不影响未传 `honesty` 参数时的既有默认行为（向后兼容烟雾测试）。
  **依赖**：T013。
  **FR/SC**：FR-010、FR-011（追加式）、FR-013。
  **落地说明（T014）**：`generateNextStepHint` 第 4 参 `honesty?` 为可选，未传时退化为**中性**文案（不恢复"可能为顶层入口"等旧误导措辞）；既有 `tests/unit/mcp/lib/response-helpers.test.ts` 全绿未改一行。

- [x] **T015** [US1][US5] 修改 `src/mcp/agent-context-tools.ts`：`impact`（约 `:253-292`）、`context`（约 `:402-421`）、`detect_changes`（约 `:653`）各自装配 `const honesty = buildHonestyAnnotation(...)` 并挂载到返回体，每处装配代码 ≤10 行（硬约束，超出说明模块边界切错，需回头调整 `graph-honesty.ts` 边界而非在本文件堆逻辑）；`detect_changes` 的三点记法处（约 `:854`）产出 `comparisonScope`（`notation: 'three-dot'`、`gitRange` 字面量、`includesUncommitted: false` 恒定、`uncommittedChangesPresent` 取自 `freshness.verdict.state === 'dirty'` 不额外 spawn git）。
  **验收**：`git diff --stat src/mcp/agent-context-tools.ts` 显示改动集中在三处装配点，每处新增行数 ≤10；`wc -l src/mcp/agent-context-tools.ts` 相比改动前新增总行数 ≤45（plan 硬约束）。
  **依赖**：T014。
  **FR/SC**：FR-009/010/011（装配落地）、FR-012（`comparisonScope`）。
  **落地说明（T015）**：三处装配各 7-8 行（≤10 硬约束满足）；文件 977 → 1012 行，**净增 35 行 ≤ 45**（plan 硬约束）。`runGitDiffNameStatus` 的 ok 分支追加 `gitRange` 字段回传 `${sha}...HEAD` 字面量（2 行），避免在装配点二次拼装 range。

- [x] **T016** [US1][US5] 新增/更新 `tests/integration/` 下的 MCP envelope 集成测试：构造四种图状态（新鲜完整解析出零结果 / 外部边界 / coverage-gap / 图陈旧）与至少一种组合态（coverage-gap + stale）分别调用 `impact`/`context`/`detect_changes`，断言返回体可判读对应成因、`honesty` 字段追加不改变工具成功/失败状态、`builderMismatch` 不进 `staleReasons`；`detect_changes` 走 `baseRef` 比较模式时断言 `comparisonScope.includesUncommitted === false` 且 `gitRange` 字面量正确；补一条既有消费方兼容性用例：不读取 `honesty` 字段的调用方式（旧式断言）行为不变。
  **验收**：新增/更新的集成测试全绿；四状态+组合态两两之间返回结果可区分（人工/断言双重确认不产生混淆）。
  **依赖**：T015。
  **FR/SC**：FR-009、FR-011、FR-012、FR-013（对应 SC-001）。
  **落地说明（T016）**：新增 `tests/integration/mcp-honesty-envelope.test.ts`（14 用例全绿）——真实 graph.json 落盘走 `getCachedGraphData` 全链，仅 stub `evaluateFreshness`（git 探测）；`detect_changes` 的 `baseRef` 用例用**真实临时 git 仓库**跑，断言 `gitRange === \`${sha}...HEAD\``。含"五种形态两两可区分"（(reason, freshnessState) 组合基数 === 5）。

- [x] **T017** P3 阶段收尾：`npm run build` → `npx vitest run tests/unit/mcp-graph-honesty.test.ts tests/integration/**mcp**`（及本阶段涉及的其余用例）→ 补全 `scripts/verify-feature-266.mjs` 的核心比对逻辑（T002 骨架 TODO）并跑 SC-003 双语料 A/B：self-dogfood（本仓）跑改动前后 `spectra batch --mode graph-only`，确认 graph.json sha256 相等 + 固定 ≥20 symbol 清单跑三工具确认 `affected`/`callers`/`callees`/`topImpacted` 集合逐元素相等（唯一允许 diff 为新增 `honesty` 键）；`~/.spectra-baselines/karpathy/nanoGPT` 语料复核 FR-001/SC-004 的非 src 布局告警已在真实语料上触发。
  **验收**：全部命令零失败；A/B 对比脚本输出确认"零变化"结论；一次性 dump 落 `/tmp`（不入库），仅 `scripts/verify-feature-266.mjs` 入库；本阶段可独立回滚（回滚粒度：摘掉 `honesty` 单键 + 还原 T013-T016 涉及文件，对既有 MCP 消费方零影响）。
  **依赖**：T002, T013, T014, T015, T016。
  **FR/SC**：FR-009/010/011/012/013 阶段级验收，SC-001、SC-003。
  **落地说明（T017）**：`npm run build` 零错误；本阶段 24 个测试文件 / 548 用例全绿；`npm run repo:check` 零失败。`scripts/verify-feature-266.mjs` 两模式核心逻辑已补全并**双变异体验证判别力**（去掉 honesty 白名单 → 50 处报错；伪造一个必需键 → 24 处报错）。实跑结果：
  - **byte-stable（SC-006/FR-014）**：self-dogfood 连续两跑 `batch --mode graph-only`，`stableSha256` 与 `rawSha256` **均相等**（graph-only 写盘走 `stripTimestamps`，`generatedAt` 固定为 epoch，故裸文件 sha 也稳定）；图确已重建（mtime/size 变化，7664 节点 / 13029 边）。
  - **mcp-ab（SC-003）**：24 symbol（高入度/零入度/导出/非导出各若干）× impact/context + detect_changes ×2 = 50 次比对，结果集逐元素相等、`honesty` 50/50 在场、既有顶层键契约零缺失零越界。**能力边界如实登记**：脚本不执行改动前的二进制（需 checkout，超出验收脚本权限），"既有消费方零影响"由冻结的 F155/F170c 键集合契约 + 结果集逐元素比对承重。
  - **nanoGPT 复核纠正了 plan Q8 的一处事实错误**：nanoGPT 是**纯 Python 语料（0 个 TS/JS 文件）**，而 FR-001 的判据只对 TS/JS 候选生效 ⇒ 它命中的是 `scannedCandidateCount === 0` 的**不报警**分支（实测 0 modules / 0 warn），**不能**用作 FR-001 告警面的真实语料。改用真实 TS 语料复核，结论：hono 原始 src 布局 → 306 modules / **0 warn**（真实语料零噪声）；把 hono 的 `src/` 原样改名为 `lib/`（284 个真实 .ts）→ 0 modules / **恰 1 条 warn**，文案含 306 个候选数、`/^src\//` 正则字面量、3 条样例路径与"该过滤器没有对外开关"的诚实说明。

---

## Phase 4: Polish & Cross-Cutting Concerns（全量收尾）

**目的**：跨阶段的最终整体验证与 byte-stable 回归护栏，确认三阶段合起来零回归、零非确定性输出。

- [ ] **T018** 全量 `npm run build`，确认类型检查零错误（本 worktree 无 dist，必须在跑全量 vitest 前执行）。
  **依赖**：T007, T012, T017（三阶段均已交付）。
  **FR/SC**：交付前置条件（宪法/仓库约定）。

- [ ] **T019** 全量 `npx vitest run`，确认零失败（覆盖本卡新增/修改的全部测试文件与既有回归测试）。
  **依赖**：T018。
  **FR/SC**：SC-007。

- [ ] **T020** 全量 `npm run repo:check`，确认零失败（含 schema 契约同步校验、`graph-quality-core.mjs` 消费侧链路）。
  **依赖**：T019。
  **FR/SC**：SC-007。

- [ ] **T021** 跑 `node scripts/verify-feature-266.mjs --mode byte-stable --target <self-dogfood-path>`：同一 target 连续两次跑 `spectra batch --mode graph-only`，比较 graph.json sha256 一致；若不一致，脚本须能定位并打印首个差异的 JSON path。
  **验收**：两次 sha256 相等（本卡不改 producer，预期恒等，但必须实跑验证"预期不改"与"实际没改"是两回事）。
  **依赖**：T017（脚本核心逻辑已补全）、T020。
  **FR/SC**：FR-014、SC-006。

- [x] **T022** 补充 dogfooding 反馈记录：本次需求实现过程中使用 Spectra MCP 工具（`impact`/`context`/`graph_query` 等）与 Spec Driver 流程的体验反馈；有实质发现须 append 到 `docs/design/dogfooding-feedback-ledger.md`（状态：待处理），无实质发现则在交付报告中显式写"无"。
  **依赖**：T021（全部技术工作完成后再回顾整体流程体验）。
  **FR/SC**：仓库级约定（非 FR/SC 编号项）。
  **完成记录**：已落账 4 条（1 再现 + 3 新）。

---

## FR 覆盖映射表

| FR | 描述摘要 | 覆盖任务 |
|----|---------|---------|
| FR-001 | 非 src 布局 batch 建图产生可观测提示 | T008, T012 |
| FR-002 | graph-only 路径不受 FR-001 影响 | T008, T012 |
| FR-003 | post-commit hook + `graph` 命令不得覆写为贫图 | T009, T010, T012 |
| FR-004 | 文档文案与真实行为一致 | T011, T012 |
| FR-005 | `plugins/spectra/hooks/post-commit.sh` 不受影响 | T009（断言）, T012 |
| FR-006 | 空图不得判 pass，归入 `cannot-assess` 通道 | T003, T004, T005, T006, T007 |
| FR-007 | builder 戳不参与判定（裁决 1） | T004, T007 |
| FR-008 | 正常图判定零回归 | T004, T007 |
| FR-009 | 四分类成因可区分（①③互斥 + ②③合并 + ④正交） | T013, T016 |
| FR-010 | `nextStepHint` 按实际成因改写 | T013, T014, T016 |
| FR-011 | freshness 追加式 advisory、不改变成功状态 | T013, T014, T015, T016, T017 |
| FR-012 | `detect_changes` 声明比较口径 | T015, T016 |
| FR-013 | 全部返回体变更为追加式扩展 | T005, T013, T014, T015, T016, T017 |
| FR-014 | graph.json 产物 byte-stable | T021 |

## SC 覆盖映射表

| SC | 描述摘要 | 覆盖任务 |
|----|---------|---------|
| SC-001 | 四态+组合态可判读且互不混淆 | T016 |
| SC-002 | 空图非 pass + 正常图零回归 | T004, T007 |
| SC-003 | 外部语料 A/B 证明结果集零变化 | T002, T017 |
| SC-004 | 非 src 布局 10 秒内可定位空模块图事实 | T008, T012 |
| SC-005 | post-commit hook 图信息量不降级 + 文档一致 | T009, T011, T012 |
| SC-006 | graph.json 连续两次生成哈希一致 | T002, T021 |
| SC-007 | build + vitest + repo:check 零失败 | T018, T019, T020 |

---

## Dependencies & Execution Order

### Phase 依赖关系

- **Phase 0（Setup）**：无前置依赖，最先执行；T001 是 plan 明确的 R-A 第一顺位任务，**必须**在 Phase 1 任何空图判定代码落地前完成并验证 4 个消费方绿。
- **Phase 1（P1 门禁面）**：依赖 Phase 0 的 T001；完成并通过 T007 checkpoint 后才进入 Phase 2。
- **Phase 2（P2 建图面）**：依赖 Phase 1 完成（plan 明确：三阶段代码互不相交，但顺序不可换——P1 先行是因为它改了共享 fixture helper，需最早暴露连带影响）。
- **Phase 3（P3 MCP 面）**：依赖 Phase 2 完成；T013（`graph-honesty.ts` 新模块）本身与 Phase 1/2 无代码依赖，允许提前开工，但阶段收尾验证（T017）必须在 Phase 2 的 T012 完成后进行。
- **Phase 4（全量收尾）**：依赖 Phase 1/2/3 全部完成（T007, T012, T017）。

### User Story 依赖关系

- **US2（P1 阶段）**：无对其余 US 的依赖，可独立验证（构造空图 fixture 单跑 `graph-quality`）。
- **US3、US4（P2 阶段）**：彼此独立（不同文件、不同判据），可并行开工；US3（T008）与 US4（T009/T010/T011）互不阻塞。
- **US1、US5（P3 阶段）**：US5（`comparisonScope`）依赖 US1 建立的 `graph-honesty.ts` 基础设施（T013），两者共享同一模块但可在同一任务链（T013→T014→T015→T016）内顺序交付，不需要拆成独立可回滚单元。

### Story 内部并行机会

- Phase 0：T001、T002 可并行（不同文件）。
- Phase 1：T003、T005 可与其余任务并行；T004 依赖 T001。
- Phase 2：T008、T009、T010 三者互为不同文件、无依赖，可完全并行；T011 依赖 T009 定稿命令措辞。
- Phase 3：T013 可提前于 Phase 1/2 开工（新文件、无代码依赖），但 T014→T015→T016→T017 为严格顺序链。

---

## Parallel Example: Phase 2（P2 建图面）

```bash
# 三个文件互不相交，可同时派发：
Task: "T008 module-derivation.ts 两计数判据 + logger.warn + 新增单测"
Task: "T009 git-hook-installer.ts hook 段落改造 + FR-005 断言"
Task: "T010 graph.ts 信息量守卫 + --force + 新增单测"

# T009 完成后再派发文档任务：
Task: "T011 README.md + docs/spectra-cli-reference.md 文案纠偏"
```

---

## Implementation Strategy

### 分阶段交付（本卡因 HIGH 风险强制此顺序，非 MVP-first 增量交付）

1. 完成 Phase 0（Setup）→ R-A 风险清零 + 验证脚本骨架就绪
2. 完成 Phase 1（P1 门禁面）→ **STOP and VALIDATE**：空图 fixture 单跑验证非 pass；可独立回滚
3. 完成 Phase 2（P2 建图面）→ **STOP and VALIDATE**：非 src 布局实跑验证 warn 出现；可独立回滚
4. 完成 Phase 3（P3 MCP 面）→ **STOP and VALIDATE**：四态+组合态 MCP 返回体人工判读；外部语料 A/B 零变化；可独立回滚（仅摘 `honesty` 单键）
5. 完成 Phase 4（全量收尾）→ 交付前最终验证

### 为何不按 User Story 优先级顺序交付

标准 spec-driven 流程按 P1→P2→P3 User Story 优先级增量交付，但本卡 plan 已裁决为 **HIGH 风险改动**，三个技术阶段（门禁面/建图面/MCP 面）**跨越多个 User Story 且互不相交**，plan 明确要求按"最早暴露连带影响"的技术阶段顺序交付（P1 门禁面最先，因其改动了被 4 个测试文件共享的 fixture helper）。User Story 标签（US1-US5）保留用于可独立测试性追踪，但不作为跨阶段的交付排序依据。

---

## Notes

- [P] = 不同文件、无依赖，可并行执行。
- [USN] 标签仅标注在有明确 User Story 归属的实现/测试任务上；Setup、阶段收尾（checkpoint）、全量收尾任务不带该标签。
- 每个实现任务的测试在同一任务描述内一并列出，要求同一 commit 交付（对齐仓库"新增功能或修复 bug 时对应单元测试必须在同一提交中包含"的约定）。
- 提交前验证链：`npm run build` → `npx vitest run` → `npm run repo:check`；本卡另加 `scripts/verify-feature-266.mjs` 双语料 A/B + byte-stable 双跑（T021）。
- 本卡为门禁/判定器类改动（Phase 1 涉及 `graph-quality` 判定逻辑），按当前生效的暂停期约定，对抗审查改用**独立子代理异构对抗**（≥2 个不同切入角），并在 commit message 中显式标注「Codex 审查暂停，异构档位缺席」。

---

## 对抗修复批次（Implement 后异构对抗审查回收）

两个独立异构对抗代理对工作树改动实跑攻击，主编排器逐条裁决后执行本批次。
处置台账（含裁决为"不修"的 9 条）：`verification/adversarial-review-disposition.md`。

### A 档（CRITICAL，全部已修）

| ID | 缺陷 | 落点 | 回归网 |
|---|---|---|---|
| A1 | `context` 的 `include` 不含 `callers` 时，"没查"被当"查了为空"，对图中有 5+ caller 的 symbol 输出「在图中无调用方」 | `graph-honesty.ts` 新增必填入参 `callerOriented`；`agent-context-tools.ts` 三处装配显式表态；`response-helpers.ts` 区分 callers 键缺席与空数组 | `mcp-honesty-envelope.test.ts`「A1 context include:[callees]」+ 对照用例；`mcp-graph-honesty.test.ts` describe `F266-A1/A5` |
| A2 | `comparisonScope` 在 stale 图上把"没测量"渲染成 `false`（stale 在 dirty 检测前短路，porcelain 从未执行） | `graph-honesty.ts` `describeWorkingTreeState` 三态化；porcelainReadFailed 亦归 null | `mcp-graph-honesty.test.ts` describe `F266-A2`（5 用例） |
| A3 | hint 层按 `linkageRatio` 分档，最严档在所有健康仓库上永久拉响「解析未完成 / 不可采信」（单方面归因 + 零信息量） | `response-helpers.ts` 废除分档，改报绝对数 + 显式声明不可区分；`graph-honesty.ts` detail 同步去归因 | `mcp-graph-honesty.test.ts`「高低两端产出同形文案」；envelope 断言不含「解析未完成」 |
| A4 | `confirmed-zero` 建立在零证据上：无记账 / 记账不自洽都被编码成同一个 `null` 并被 `Math.max(0,…)` 洗白 | `graph-honesty.ts` 新增四态 `CoverageAssessment`（unaccounted / inconsistent / gap / measured-zero），confirmed-zero 需三项正向证据 | `mcp-graph-honesty.test.ts` describe `F266-A4`（S1/S2/S4 + 对照，6 用例） |
| A5 | `impact(direction:'downstream')` 零结果用 caller 侧证据解释 | 同 A1 的 `callerOriented`（downstream 不产出 resolution） | envelope「A5 impact direction=downstream」+ upstream/both 对照 |
| A6a | 空图闸只判 (0,0)，1 module / 0 边的退化图六指标分母全为 0 → 假 pass（旧注释称 orphan/contains 能接住，已被证伪） | `graph-quality.ts` 新增 `hasNoSymbolNodes` + reason `no-symbol-nodes`；`quality-types.ts` / schema.json 枚举追加 | `graph-quality-cli.test.ts` describe `F266-A6a`（5 用例）；core.mjs 映射用例；schema 契约用例；三个 adversarial fixture 补 `unifiedKind: 'symbol'` |
| A6b | `spectra graph` 守卫被「计数上升、calls 归零」绕过；且信任图自报计数 | `graph.ts` 改为现数 `nodes`/`links`/calls 边三计数 | `graph-command-degradation-guard.test.ts` describe「calls 边独立判据」+「自报计数虚高但数组为空」 |
| A6c | empty-graph 分支硬写 `unknown-provenance`/`null`，而该分支读到了合法图（下游 sync 死循环建议）；nextSteps 的 src/ 归因已被证伪 | `graph-quality.ts` `buildCannotAssessReport` 增可选 freshness 参；抽 `evaluateGraphFreshness` 与正常分支同源；文案改「未发现受支持语言的源文件」 | `graph-quality-cli.test.ts` describe `F266-A6c`（5 用例，含 graph-missing 仍报 null 的对照） |

### B 档（WARNING，全部已修）

| ID | 缺陷 | 落点 | 回归网 |
|---|---|---|---|
| B1 | post-commit 段落丢了外层 `> /dev/null 2>&1`，继承 git 的 fd 阻塞捕获 commit 输出的消费方（实测 7s，上限 180s）；失败路径全静默 | `git-hook-installer.ts`：恢复外层重定向；超时/失败一律 append 到日志；`wait` 取退出码 | `git-hook-installer.test.ts` 两条（日志 append + 外层重定向必存在且不得出现 `>&2`）；实跑验证见下 |
| B2 | `scannedCandidateCount>0 && includedCount===0` 在任何带一个根级 JS 配置的 py/go 工程上每次全量 batch 都误报，且文案断言为假 | `module-derivation.ts`：结构判据分档（有嵌套被滤候选 → warn；全顶层 → info）；文案去事实断言；「无对外开关」只在默认过滤器时输出 | `module-derivation-empty-scope-warning.test.ts` describe「出声档位按结构分」（5 用例） |
| B3 | TTL 2s 打不中 agent 节奏（每次调用同步 spawn git）；时钟回拨冻结缓存；返回体膨胀 | `graph-honesty.ts`：TTL→15s、`delta >= 0 && delta < TTL`、dirtyFiles 截断至 5 + 计数元数据、coverage 与 resolution 同条件附加 | `mcp-graph-honesty.test.ts` describe `F266-B3`（5 用例）；envelope「B3c coverage 只在零结果时随行」 |
| B4 | 文档的两步流程 `batch` → `graph` 现在必然 exit 1；`--force` 与守卫零提及；hook 迁移细节缺失 | `docs/spectra-cli-reference.md`：删两步流程、补守卫与 `--force`、补 hook 诊断去向与迁移命令 | 目视 + `npm run repo:check`（README 无同款流程，已查） |
| B5 | `annotationDegraded` 时 `comparisonScope` 整体消失 = FR-012 fail-open | `graph-honesty.ts` catch 分支照常构造 comparisonScope（工作树状态 null） | `mcp-graph-honesty.test.ts` describe `F266-B5` |
| B6 | (a) comparisonScope 未声明 merge-base 语义；(b) `as unknown as Record` 缺 why 注释 | `graph-honesty.ts` 两处 | `F266-A2`「B6a：detail 声明 merge-base」 |

### 实跑行为验证（不止工具链绿）

| 项 | 验证方式 | 结果 |
|---|---|---|
| B1 阻塞 | 临时 git 仓 + 假 `spectra`（sleep 4 后 exit 3），`OUT=$(git commit)` 计时 | 捕获耗时 **47ms**（修前同构造为秒级阻塞）；日志末尾出现 `[spectra] graph rebuild failed (exit 3)` |
| A1/A5 | 本仓真实 graph.json，`context` 三种 include × `impact downstream` | `include:['callees']` → callers 键缺席、resolution 缺席、hint 改为「本次未查询…」；downstream 零结果无 resolution，freshness 照常 |
| A6b | 本仓真实图（7671/13038/4020 calls）复制到临时目录跑 `spectra graph` | 拒写 exit 1，文案含 `calls 边 4020 → 0`，磁盘旧图逐字未动 |
| A6a/A6c | 同一真实图剥掉全部 symbol 节点后跑 `spectra graph-quality --json` | exit 2、`no-symbol-nodes`、freshness 报出图内真实 `recordedSourceCommit`（非 null） |

### 收尾验证

- `npm run build`：零错误
- `npx vitest run`：**7673 passed / 0 failed**（534 文件）
- `npm run repo:check`：`status=pass`
- `scripts/verify-feature-266.mjs --mode byte-stable`：passed，两跑 stableSha256 一致
- `scripts/verify-feature-266.mjs --mode mcp-ab`：passed，26 次比对 problems 为空、honesty 恒在

---

## delta 第二轮（第一轮修复后的再审对抗）

第一轮修复被再次异构对抗，抓出 **1 CRITICAL + 5 WARNING**。CRITICAL 是第一轮修复**自己引入的**
（A6a 的前置闸吞掉了与 symbol 无关的强不变量），再次印证「审查轮新代码必须再审」。
不修项裁决见 `verification/adversarial-review-disposition.md` 的「delta 轮」一节。

| ID | 档位 | 缺陷 | 落点 | 回归网 |
|---|---|---|---|---|
| D1 | CRITICAL | `no-symbol-nodes` 前置短路把 duplicate-id / dangling-edge / legacy-ignored 三项（遍历全部节点与边、与 symbol 无关）一并吞掉，真 exit 1 被洗成 `cannot-assess` + `pass` 占位；repo:check 由 FAIL 变 PASS | `graph-quality.ts`：撤前置闸，改后置 `downgradeForNoSymbolNodes`（强不变量原样保留，其余改判但**保留真实指标**）；`isEmptyGraph` 前置保留并注释区别；三个 adversarial fixture 的 `unifiedKind` 补丁回滚 | `graph-quality-cli.test.ts` describe `F266-D1`（5 用例：无 symbol × duplicate / dangling / 无违规 / warning 级 / 渲染与 schema）；`graph-quality-adversarial.test.ts` 三 fixture 在原始（无 symbol）形态下的既有断言 |
| D2 | WARNING | `measured-zero` 的记账在场性是全图 OR（1 个合法节点代表 500 个模块）；且生产端 `?? 0` 把「没抽取」与「抽到 0」折叠成同一磁盘值，全零图被判 `confirmed-zero` | `graph-honesty.ts`：三条件收紧（全模块记账 + 自洽 + Σ>0），`unaccounted` 细分 `no-accounting` / `partial-accounting` / `all-zero` 并带 `accountedModules/totalModules` | `mcp-graph-honesty.test.ts`「D2：全零记账」「D2：1 合法 + 499 缺失」「D2：正向证据齐备仍可达」 |
| D3 | WARNING | `assessCoverage` 裸索引 `n.metadata[...]` / `l.relation`（缺 metadata、null link 直接 throw → 整个 honesty 信封降级）；`Number.isFinite` 放行小数 | `graph-honesty.ts`：`readOwnMetadata`（object 判定 + `hasOwnProperty`）/ `readCallSitesCount`（`Number.isInteger`）/ `isModuleNode`；`decideResolution` 的 external / exportKind 读取同口径 | `mcp-graph-honesty.test.ts` describe `F266-D3`（5 用例：缺 metadata / null link / 原型链 / 小数 / decideResolution 不击穿） |
| D4 | WARNING | detect_changes 在改动文件全部未落图（BFS 一次没跑）时仍按图级证据产出 resolution | `graph-honesty.ts`：入参 `callerOriented: boolean` → `resolutionBasis: true \| ResolutionOmissionReason`，新增返回字段 `resolutionOmitted`；A1/A5 两个既有缺席场景一并迁移；`agent-context-tools.ts` 三处装配显式表态 | `mcp-graph-honesty.test.ts` describe `F266-D4`；`mcp-honesty-envelope.test.ts` 四条（全 unmapped diff / 落图对照 / A1 / A5） |
| D5 | WARNING | resolution 缺席时 hint 的零结果段是空串，「受影响范围为空」不带任何 hedge——比完全不传 honesty 的兜底文案还裸 | `response-helpers.ts`：`describeOmissionForHint` 三成因各一句缺席声明 | `mcp-graph-honesty.test.ts` describe `F266-D5`（含「不弱于兜底文案」对照） |
| D6 | WARNING | hook 日志 `>` 覆写：间隔 1s 的两次 commit 会把前一次的失败标记截没；180s 窗口内并发重建 last-writer-wins | `git-hook-installer.ts`：日志改 append + 每次运行写 UTC run header + 200KB 轮转到 `.old`；`mkdir` 抢锁 + 抢不到只记一行退出 + 4 分钟僵尸锁回收 + 结束 `rmdir`；`docs/spectra-cli-reference.md` 同步 | `git-hook-installer.test.ts`：段落断言 2 条（append/轮转、锁/回收阈值）+ **实跑**两连发 commit（断言第二次日志是第一次的严格前缀扩展） |

### delta 轮实跑行为验证

| 项 | 验证方式 | 结果 |
|---|---|---|
| D1 攻击构造 | 回滚 `unifiedKind` 补丁后跑三个 fixture | duplicate / dangling → `fail-strong-invariant` exit 1（真实 groups / edges 精确）；ignored-path → `cannot-assess` exit 2 且 `legacyAndIgnoredNodes.status=fail` 未被占位覆盖 |
| D6 append | 临时 git 仓 + PATH 剔除 `spectra`，连发 4 次 commit | 日志保留 3 条 run header + 3 条 `rebuild failed`（修前只会剩最后 1 条） |
| D6 并发闸 | 假 `spectra`（sleep 5）+ 1s 后再 commit | 第二次写下 `skipped: another rebuild in progress`，锁在第一次结束后释放 |
| D6 僵尸锁 | 手工造 10 分钟前的锁目录后 commit | 回收成功、正常跑完并释放 |
| D6 轮转 | 预置 300KB 日志后 commit | `.old` 300000 字节、新日志 145 字节 |

### delta 轮收尾验证

- `npm run build`：零错误
- `npx vitest run`：**7698 passed / 0 failed**（534 文件 / 18 skipped / 21 todo）
- `npm run repo:check`：`status=pass`（含 `graph-quality:*` 七项全 pass）
- `scripts/verify-feature-266.mjs --mode byte-stable`：passed，两跑 `stableSha256` 一致
- `scripts/verify-feature-266.mjs --mode mcp-ab`：passed，24 symbol / 50 次比对，`problems: []`、`honestyPresent: 50/50`

---

## delta 第三轮（第二轮修复后的再审对抗）

第二轮修复被第三次异构对抗，抓出 **1 CRITICAL + 4 WARNING + INFO 若干**。CRITICAL 又一次是
上一轮修复**自己引入的**（D6 的 `mkdir` 锁带来了僵尸锁回收路径）。不修项与 E1 的
「修法未关死」实测数据见 `verification/adversarial-review-disposition.md` 的「第三轮」一节。

| ID | 档位 | 缺陷 | 落点 | 回归网 |
|---|---|---|---|---|
| E1 | CRITICAL | 僵尸锁回收 `find(判 stale) → rmdir → mkdir` 三步可交错：racer B 的 `rmdir` 删掉 racer A 刚建好的**活锁** → 双持锁并发重建 | `git-hook-installer.ts`：改 `mv "$lock" "$lock.stale.$$"` 原子认领，`rmdir` 只落私有路径；认领后立刻 `mkdir` 抢锁 | `git-hook-installer.test.ts`「E1：僵尸锁回收走 mv 原子认领」（含 `rmdir "$_spectra_lock"` 出现次数恰为 1 的承重断言）；**实跑 A/B 见下（结论：收窄但未关死，已登记）** |
| E2 | WARNING | 多 commit 序列 first-writer-wins：5 连 commit 只有第一个触发重建，图恒定格在序列首 commit 的树态 | `git-hook-installer.ts`：让位者 `touch $git_dir/spectra-rebuild-requested`；持锁者收尾后检查标记 → 删标记并补跑一轮（上限 2 轮） | `git-hook-installer.test.ts` 段落断言 1 条 + **实跑**（重建窗口内第二次 commit → 2 轮、第二轮输入 == 最新 HEAD；变异测试：删掉 `touch` 后该用例报「重建只跑了 1 次」） |
| E3 | WARNING | gate 消费面对 `cannot-assess` 一律早退：D1 之后 `no-symbol-nodes` 报告携带真实指标，legacy-ignored 真发现 / freshness stale / F258 `[ignore-undeterminable]` 探测全部塌陷 | `quality-types.ts` 加 `metricsPopulated?: true`；`graph-quality.ts::downgradeForNoSymbolNodes` 置位；schema 追加可选字段（`enum:[true]`，**不用 `const`**——本仓校验器只实现 `enum`）；`graph-quality-core.mjs` 按结构标记分档，真实指标报告继续走逐维度发射并改写错误归因文案 | `graph-quality-core.test.ts` describe `F266-E3`（3 用例：三条 warn 全恢复 / 文案不再误归因 / 占位报告逐字维持早退）；`graph-quality-report-schema.test.ts` 4 条（字段契约 + 真实输出 + 占位路径不置位 + 灵敏度） |
| E4 | WARNING | `impact(budget:0)` / `impact(depth:0)` / `detect_changes(budget:0)` 的遍历根本没执行，却照产 `boundary-exposed` 并用图覆盖面解释 | `graph-honesty.ts`：`ResolutionOmissionReason` 追加 `query-constrained-to-zero`；`agent-context-tools.ts` 两处装配点按归零判据优先表态（impact 与 detect_changes **同形**判 `budget===0 || depth===0`——初版 detect_changes 只判 budget 的不对称口径已按主编排器裁决对齐）；`response-helpers.ts` 渲染「与图内容无关，请放宽约束重试」 | `mcp-honesty-envelope.test.ts` 5 条（四种归零形态 + 正常参数对照；detect_changes(depth:0) 用例刻意让改动文件确实落图，以排除 `no-symbols-in-graph` 顺带命中） |
| E5 | WARNING+INFO | ① `describeOmissionForHint` 的 `default:` 让将来新增成因静默渲染成空串；② `annotationDegraded` 时 hint 比完全不传 honesty 还裸；③ `findNodeById` 裸读 `n.id`；④ `node.metadata`/`node.kind` 外层读取与内层键口径不齐 | `response-helpers.ts` 穷尽 switch（`never` 兜底）+ 降级缺席声明；`graph-honesty.ts` 三处防御 | `mcp-graph-honesty.test.ts` describe `F266-E5`（hint 3 条 + 节点读取面 2 条，后者已用变异测试证明承重） |
| INFO-3 | INFO | 超时 `kill` 后未 `wait`，被 TERM 的进程可能仍在写临时文件时锁已易主 | `git-hook-installer.ts`：`kill` 后补 `wait` 再释放锁 | `git-hook-installer.test.ts`「INFO-3：超时 kill 之后必须先 wait 收尸」（正则约束 kill 与 wait 之间只允许注释） |

### 第三轮实跑行为验证

| 项 | 验证方式 | 结果 |
|---|---|---|
| E1 双 racer | 同一僵尸锁上并发 N 个 racer（脚本与生成段落逐字同形，已断言核对），各 20 轮 | N=2：旧 0/20、新 0/20；N=5：旧 **2/20**、新 **0/20**；N=20：旧 15/20（最多 5 个同时持锁）、新 13/20（**最多 2 个**）。**结论：hook 真实并发量级那一档收住，20 路同发仍可复现 → CRITICAL 未关死，已登记并给出换原语的移交建议** |
| E2 两连发 | 临时仓 + 假 `spectra`（打印 HEAD 后 sleep 3），重建窗口内第二次 commit | 2 轮重建；pass1 输入 = commit A、pass2 输入 = commit B；日志含 `skipped ... (rebuild requested)` 与 `(pass 2)`；锁与标记均已清理 |
| E2 五连发 | 同上，5 次 commit 间隔 1s，假 spectra sleep 8 | 2 轮重建；pass1 输入 = c1、pass2 输入 = **c5（末 commit）**；4 条 skipped；修前此形态只跑 1 轮、定格在 c1 |
| E2 变异测试 | 删掉 `touch "$_spectra_requested"` 后重跑实跑用例 | 报「重建只跑了 1 次；修复前这里恒为 1」→ 该用例确实承重 |
| E5-3/E5-4 变异测试 | 删掉 `findNodeById` 的 null 守卫 + 两处 `hasOwnProperty` 后重跑 | 2 条用例同时变红 → 承重 |
