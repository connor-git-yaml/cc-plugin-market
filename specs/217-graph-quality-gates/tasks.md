# Tasks: 图质量门机器化（Graph Quality Gates，F217）

**输入**: `specs/217-graph-quality-gates/plan.md`（482 行，7 决策 + 文件级改动清单 + 测试策略 §5 + 里程碑 §8）、`specs/217-graph-quality-gates/spec.md`（27 FR + 7 CONSTRAINT + 14 SC）、`specs/217-graph-quality-gates/trace.md`

**测试策略**: 本 Feature spec SC-013 明确要求 TDD（先写检测失败用例，再实现使其通过）——**全部任务强制包含测试**，非可选。

**组织方式**: Phase 骨架对齐 plan §8 里程碑（P1 引擎+sourceCommit+collector → Foundational；P2 CLI+repo:check → US1+US2；P3 四语言矩阵 → US3；P4 重生成+全量回归 → Polish）。

**本版修订说明（对 Codex 对抗审查 13 条修订的响应）**：本次修订相对上一版共 54 个任务（原 46 个）。主要变化：① 新增"重建 dist"显式任务并修正下游依赖；② fixture sourceCommit 生成 SOP 固化为仓库外 `mktemp -d` + 断言 `sourceCommit===null`；③ 新增导出 `PY_SKELETON_IGNORE_DIRS`/`TSJS_SKELETON_IGNORE_DIRS` 前置任务；④ `graph-mcp-snapshot.test.ts` 按已裁定事实（F158 起休眠）处理，不新建重建任务；⑤ 修正"五项结构指标 + freshness 装配"的措辞矛盾；⑥ SC-002/007/010/011 覆盖真实化；⑦ TDD 依赖链修复（contains 风险断言前移、repo:check 接线任务拆分）；⑧ 补齐依赖与验收缺口；⑨ Java/Go fixture 增补 ignore 样本；⑩ 语言矩阵/消费文件核对任务按语言/文件粒度拆分。

## 格式：`[ID] [P?] [Story?] 描述`

- **[P]**：可与同批次其他 [P] 任务并行（不同文件、无依赖冲突）
- **[USN]**：所属 User Story（US1/US2/US3）；Setup/Foundational/Polish 不标注
- 每个任务均含确切文件路径、命令与可核验的验收断言

---

## Phase 1: Setup（共享基础设施）

**目的**：本 Feature 无新增外部依赖（plan §0 已确认），Setup 阶段落地被后续所有 Phase 依赖的类型定义、最小基座改动，以及 ignore 常量导出前置项。

- [x] **T001** [P] 新增 `GraphQualityReport` 全套类型定义，文件：`src/panoramic/graph/quality/quality-types.ts`。产出：`CheckStatus`/`DuplicateCanonicalIdGroup`/`DanglingEdgeRecord`/`OrphanExceptionCategory`/`GraphFreshnessVerdict`/`GraphQualityReport`（字段与 plan §2 决策 2 类型草图完全一致）。验收：`npx tsc --noEmit` 零错误；`grep -c "z\.\|zod" src/panoramic/graph/quality/quality-types.ts` 为 0（纯类型模块，不 import `fs`/`child_process`/zod）。
- [x] **T002** [P] 从 `src/utils/file-scanner.ts` 导出内置忽略目录集合常量（供 T011 `ignore-oracle.ts` 复用），扩展测试：`tests/unit/file-scanner.test.ts`。验收：新增具名导出（如 `BUILTIN_IGNORE_DIRS`）；`npx vitest run tests/unit/file-scanner.test.ts` 全绿；`grep -n "export.*BUILTIN_IGNORE_DIRS" src/utils/file-scanner.ts` 命中；不改变既有导出行为（既有测试用例零改动仍通过）。
- [x] **T003** [P] `graph.*` 新增可选字段 `sourceCommit?: string | null`，文件：`src/panoramic/graph/graph-types.ts`。依赖：无。验收：`npm run build` 零错误；确认未触碰 `UnifiedGraph` zod schema（CONSTRAINT-003）；`grep -n sourceCommit src/panoramic/graph/graph-types.ts` 命中且类型为 `string | null | undefined`。
- [x] **T004** [P] 导出 `batch-orchestrator.ts` 内两个模块私有 ignore 常量 `PY_SKELETON_IGNORE_DIRS`/`TSJS_SKELETON_IGNORE_DIRS`（仅加 `export` 关键字，零行为变化），文件：`src/batch/batch-orchestrator.ts`。依赖：无。验收：`grep -n "export const PY_SKELETON_IGNORE_DIRS\|export const TSJS_SKELETON_IGNORE_DIRS" src/batch/batch-orchestrator.ts` 均命中；`npm run build` 零错误；`npx vitest run tests/unit/batch-orchestrator.test.ts` 全绿（零行为回归）。该任务是 T011（ignore-oracle 一致性单测）的硬前置——若不导出，T011 的子集断言无法通过真实 import 完成，只能退化为读源码文本的伪断言，禁止此退化路径。

**Checkpoint**：类型基座、ignore 常量导出就绪，Foundational 五项结构指标与 sourceCommit 模块可开始实现。

---

## Phase 2: Foundational（P1 里程碑：指标引擎 + sourceCommit + generic collector）

**⚠️ 关键**：本 Phase 内涉及"验收判断/结果论证"的任务（测试、聚合器实现、CLI 前置模块等）全部完成前，任何 User Story 均不可启动——US1（CLI）依赖 `quality-engine`，US2（repo:check）依赖 CLI，US3（多语言矩阵）依赖 `generic-language-skeleton-collector.ts`。**例外**：本 Phase 内"依赖：无"的源码 fixture 创建类任务（T025 Java fixture、T026 Go fixture）不受此 barrier 约束，可与 Setup 甚至更早阶段并行开工——barrier 只约束"消费这些 fixture 做出结果论证"的测试/实现任务（如 T027/T028）。

### 五项结构指标检测函数（纯函数，零 I/O）

> **口径澄清**：`quality-engine` 聚合的是**五项纯结构指标**（duplicate-canonical-id / contains-coverage / dangling-edge / legacy-ignored / orphan-ratio）；freshness 是第六个独立判定域，不属于 `quality-engine` 聚合范围，由 CLI 层（T033/T034）读取 sourceCommit 后单独计算并与五项结构指标结果一起组装成完整的六字段 `GraphQualityReport`（对应 plan §2 决策 2 的 `GraphQualityReport` 类型定义）。因此 `quality-engine` 的实现与测试任务不依赖 `source-commit.ts`（T019/T020）。

- [x] **T005** [P] `duplicate-id-check` 单测（先红），文件：`src/panoramic/graph/quality/duplicate-id-check.test.ts`。覆盖 FR-001/002：归一化三元组 `(文件路径, symbol名, kind)` 映射多 ID 的 pass/fail 场景，遗留 `#` 与 `::` 分隔符共存场景。依赖：T001。验收：`npx vitest run src/panoramic/graph/quality/duplicate-id-check.test.ts` 运行结果为红（实现文件不存在，用例失败）。
- [x] **T006** `duplicate-id-check` 实现（使 T005 转绿），文件：`src/panoramic/graph/quality/duplicate-id-check.ts`。验收：`npx vitest run src/panoramic/graph/quality/duplicate-id-check.test.ts` 全绿；导出 `checkDuplicateCanonicalIds(graph): GraphQualityReport['duplicateCanonicalId']`。依赖：T005。
- [x] **T007** [P] `contains-coverage-check` 单测（先红），文件：`src/panoramic/graph/quality/contains-coverage-check.test.ts`。覆盖 FR-003/004：`unifiedKind==='symbol'` 分母、100% 覆盖 pass、未覆盖清单、分母为 0 时 `not-applicable`。依赖：T001。验收：`npx vitest run src/panoramic/graph/quality/contains-coverage-check.test.ts` 运行结果为红。
- [x] **T008** `contains-coverage-check` 实现，文件：`src/panoramic/graph/quality/contains-coverage-check.ts`。验收：对应单测全绿；导出 `checkContainsCoverage(graph)`。依赖：T007。
- [x] **T009** [P] `dangling-edge-check` 单测（先红），文件：`src/panoramic/graph/quality/dangling-edge-check.test.ts`。覆盖 FR-006：edge source/target 不存在 node id 的检出与三元组（source/target/relation）精确报告。依赖：T001。验收：运行结果为红。
- [x] **T010** `dangling-edge-check` 实现，文件：`src/panoramic/graph/quality/dangling-edge-check.ts`。验收：对应单测全绿；导出 `checkDanglingEdges(graph)`。依赖：T009。
- [x] **T011** [P] `ignore-oracle` 单测（先红），文件：`src/panoramic/graph/quality/ignore-oracle.test.ts`。覆盖 FR-008 增补：真实 `import { PY_SKELETON_IGNORE_DIRS, TSJS_SKELETON_IGNORE_DIRS } from '../../../batch/batch-orchestrator.js'` 断言两常量 ⊆ 共享内置忽略集合（`BUILTIN_IGNORE_DIRS`）；`isIgnoredPath` 对 `.gitignore` 命中路径与内置忽略目录命中路径均返回 `true`。依赖：T002, T004。验收：运行结果为红（`ignore-oracle.ts` 尚不存在）。
- [x] **T012** `ignore-oracle` 实现，文件：`src/panoramic/graph/quality/ignore-oracle.ts`。验收：组合 `createGitignoreFilter`（`src/utils/file-scanner.ts:199`）+ T002 导出的内置忽略目录集合；导出单一 `isIgnoredPath(relativePath): boolean`；对应单测全绿。依赖：T011, T002, T004。
- [x] **T013** [P] `legacy-ignored-check` 单测（先红），文件：`src/panoramic/graph/quality/legacy-ignored-check.test.ts`。覆盖 FR-007/008：复用 `isLegacySymbolNode`（`graph-query.ts:178`）判定遗留 `#` 节点；注入的 `isIgnored` 回调判定 ignored 路径节点。依赖：T001。验收：运行结果为红。
- [x] **T014** `legacy-ignored-check` 实现，文件：`src/panoramic/graph/quality/legacy-ignored-check.ts`。验收：对应单测全绿；导出 `checkLegacyAndIgnoredNodes(graph, isIgnored)`；不重复实现 `isLegacySymbolNode` 判定逻辑（CONSTRAINT-007）。依赖：T013。
- [x] **T015** [P] `orphan-check` 单测（先红），文件：`src/panoramic/graph/quality/orphan-check.test.ts`。覆盖 FR-005：degree=0（含 contains 边）判定、三类例外分类（entrypoint/pure-type/test-export）各自独立断言、全部例外命中导致"超标分子=0"边界、`allNodeZeroDegreeRatio` 信息展示字段独立断言（不影响 pass/fail）、分母为 0 时 `not-applicable`。依赖：T001。验收：运行结果为红。
- [x] **T016** `orphan-check` 实现，文件：`src/panoramic/graph/quality/orphan-check.ts`。验收：对应单测全绿；导出 `checkOrphanRatio(graph, opts: { getTestPatterns })`；例外分类判定严格按 FR-005 字面枚举（不臆造 Java/Go 专属规则）。依赖：T015。
- [x] **T017** `quality-engine` 单测（先红），文件：`src/panoramic/graph/quality/quality-engine.test.ts`。覆盖：**五项结构指标**聚合正确装配（不含 freshness）、`overallVerdict` 四态映射优先级（`fail-strong-invariant` 优先于 `pass-with-warnings`，`pass-with-warnings` 优先于无修饰 `pass`）。依赖：T006, T008, T010, T014, T016（五项结构指标实现，不依赖 T019/T020 source-commit）。验收：运行结果为红。
- [x] **T018** `quality-engine` 实现，文件：`src/panoramic/graph/quality/quality-engine.ts`。验收：对应单测全绿；导出 `runGraphQualityChecks(graph, opts)`，纯函数装配**五个** check 模块结果（不含 freshness，freshness 组装归 CLI 层 T033/T034）。依赖：T017。

### sourceCommit 与 freshness 判定

- [x] **T019** [P] `source-commit` 单测（先红），文件：`src/panoramic/graph/source-commit.test.ts`。覆盖 FR-009/010：`resolveSourceCommit` 三分支（git 成功/非 git 仓库/命令报错，mock `child_process.execFileSync`）；`evaluateFreshness` 四态（`fresh`/`dirty`/`stale`/`unknown-provenance`，用真实临时 git 仓库 `execFileSync('git',['init',...])` 而非全 mock）；`git status --porcelain=v1 -z --untracked-files=all` 解析覆盖 rename/删除/路径含空格/全新 untracked 目录四类场景。依赖：T001。验收：运行结果为红。
- [x] **T020** `source-commit` 实现，文件：`src/panoramic/graph/source-commit.ts`。验收：对应单测全绿；`resolveSourceCommit` catch 全部异常返回 `null`，detached HEAD 天然返回具体 SHA（无需特判）；导出 `resolveSourceCommit(projectRoot)` 与 `evaluateFreshness(recordedSourceCommit, projectRoot)`。依赖：T019。

### 节点 metadata 透传（orphan 例外分类精度前提）

- [x] **T021** [P] `deriveNodesFromSkeletons` metadata 透传单测（先红），新增文件：`tests/unit/knowledge-graph-derive-nodes-metadata.test.ts`。断言 symbol/member 节点 `metadata` 新增 `exportKind: exp.kind`（symbol）/ `memberKind: m.kind`（member）字段。依赖：T001。验收：运行结果为红。
- [x] **T022** `deriveNodesFromSkeletons` 实现，文件：`src/knowledge-graph/index.ts`。验收：对应单测全绿；`metadata` 仅新增 key（`UnifiedNodeSchema.metadata` 本为 `z.record`，不触碰 zod schema，CONSTRAINT-003）；不改变现有字段/排序。依赖：T021。
- [x] **T023** `graph-builder.ts` 合并分支测试扩展（先红），扩展文件：`tests/unit/graph-builder.test.ts`。断言：① 新节点分支透传 `exportKind`/`memberKind`（比照既有 `callSitesCount` 模式）；② **既有节点合并分支**（`existing` 命中）同步补齐 `unifiedKind`/`sourcePath`/`exportKind`/`memberKind`，且**不覆盖** extraction provenance 字段（Python `extractSymbolNodes` 写入的 `sourceTag:'extraction'`/`sourceFile`/`symbolKind`）。依赖：T022。验收：运行结果为红。
- [x] **T024** `graph-builder.ts` 实现，文件：`src/panoramic/graph/graph-builder.ts`。验收：对应单测全绿；修复 Python 顶层 symbol 因 existing-node 合并分支未补 `unifiedKind` 导致的 contains-coverage/orphan 分母缩水问题（决策 2 增补 4）；`npx vitest run tests/unit/graph/` 全绿（byte-stable 相关既有测试不回归）。依赖：T023。

### Java/Go generic collector

- [x] **T025** [P] 创建 Java mini fixture 源码，目录：`tests/fixtures/graph-quality-java/`。内容遵循决策 6 fixture 合同表（≥1 class 含 ≥2 method + ≥1 interface + ≥1 enum 或 record，无自由函数，避开 nested class 边界）+ ≥1 个语法错误 `.java` 文件（供 T027 单文件解析失败测试）+ ≥1 个测试文件（符合 `JavaLanguageAdapter.getTestPatterns()`）+ **≥1 个应被忽略的样本**：一个位于内置忽略目录（如 `build/Generated.java`）的文件 + 一个仅被本 fixture 自带 `.gitignore` 命中（非内置忽略目录）的文件，供 T027 断言二者均不进入 skeleton map。依赖：无。验收：`find tests/fixtures/graph-quality-java -name "*.java" | wc -l` ≥ 5（正常文件 + 语法错误文件 + 测试文件 + 两个忽略样本）。
- [x] **T026** [P] 创建 Go mini fixture 源码，目录：`tests/fixtures/graph-quality-go/`。内容遵循决策 6 合同表（≥1 package 级 func + ≥1 struct 含 ≥1 显式 receiver method + ≥1 interface + ≥1 type alias，避开缺 receiver 降级边界）+ ≥1 个语法错误 `.go` 文件 + ≥1 个测试文件（符合 `GoLanguageAdapter.getTestPatterns()`）+ **≥1 个应被忽略的样本**（同 T025：内置忽略目录命中 1 个 + `.gitignore` 命中 1 个），供 T027 断言二者均不进入 skeleton map。依赖：无。验收：`find tests/fixtures/graph-quality-go -name "*.go" | wc -l` ≥ 5。
- [x] **T027** `generic-language-skeleton-collector` 单测（先红），文件：`src/batch/generic-language-skeleton-collector.test.ts`。用 T025/T026 fixture 真实跑，覆盖：① 文件发现数量精确断言；② 单文件解析失败（语法错误文件）不影响整体产出；③ 直接实例化 adapter 场景下**不**依赖 `bootstrapRuntime()`/`LanguageAdapterRegistry`；④ 忽略样本（内置忽略目录命中 + `.gitignore` 命中）均**不**进入返回的 `CodeSkeleton` Map（断言 Map 不含对应文件路径 key）；⑤ **（contains 双轨风险实证复核，原属实现任务验收，前移至此测试任务）**：用 T018 `runGraphQualityChecks` 对 T025/T026 fixture 真实建图产物实测 `containsCoverage`，断言覆盖率符合预期（不存在 Python 式双轨 contains 缺口），作为决策 1 R2 论证"Java/Go 无 Python 式双轨 contains 风险"的实证断言而非仅注释声明。依赖：T025, T026, T012（ignore-oracle 实现，供 collector 判定忽略样本）, T018（quality-engine 实现，供 R2 复核断言）。验收：运行结果为红（`generic-language-skeleton-collector.ts` 尚不存在）。
- [x] **T028** `generic-language-skeleton-collector` 实现，文件：`src/batch/generic-language-skeleton-collector.ts`。验收：对应 T027 单测全绿（含忽略样本断言与 R2 复核断言）；导出 `collectGenericLanguageCodeSkeletons(projectRoot, adapters=[JavaLanguageAdapter, GoLanguageAdapter])`；单文件失败 `catch` 吞掉（与 Python/TS-JS 采集器 EC-14 兜底一致）；内部复用 T012 `ignore-oracle.ts::isIgnoredPath` 过滤忽略样本。依赖：T027, T012（ignore-oracle 实现）, T018（quality-engine 实现，二者均为显式前置，非仅测试任务间接依赖）。

### batch-orchestrator 与写盘侧注入

- [x] **T029** `batch-orchestrator` 集成测试扩展（先红），扩展文件：`tests/unit/batch-orchestrator.test.ts` + `tests/batch/graph-only-pipeline.test.ts`。断言：① `runBatch` 早期 UnifiedGraph 段与 `buildAstGraphOnly` 均接入 `collectGenericLanguageCodeSkeletons`（Java/Go 节点进入产物）；② 两处写盘前 `graphJson.graph.sourceCommit = resolveSourceCommit(resolvedRoot)` 生效。依赖：T020, T028, T018。验收：运行结果为红。
- [x] **T030** `batch-orchestrator` 实现，文件：`src/batch/batch-orchestrator.ts`。验收：对应单测全绿；三处改动（`runBatch` line ~1285 采集接入、`buildAstGraphOnly` line ~2501 采集接入、两处写盘前 sourceCommit 注入）；`npm run build` 零错误；CONSTRAINT-001（零 LLM 依赖）复核通过。依赖：T029。
- [x] **T031** `graph.ts`/`community.ts` provenance 测试（先红），新增文件：`tests/integration/graph-command-sourcecommit.test.ts`。覆盖决策 3 裁定表后两行：① `spectra graph` 写盘 `graph.sourceCommit` 恒为 `null`（不解析源码，禁止盖当前 HEAD，FR-009）；② `spectra community` 仅 patch `metadata.community` 字段，原图已有 `sourceCommit` 自然透传（未改动时保留 `undefined`/原值，不重算）。依赖：T020。验收：运行结果为红。
- [x] **T032** `graph.ts` 实现（`community.ts` 确认零代码改动，仅测试验证透传行为），文件：`src/cli/commands/graph.ts`。验收：对应单测全绿；写盘前显式赋值 `sourceCommit: null`；确认 `community.ts` 未被本任务触碰（`git diff --stat src/cli/commands/community.ts` 应为空）。依赖：T031。

**Checkpoint**：五项结构指标引擎、freshness 判定（source-commit）、Java/Go 采集链路、sourceCommit 三个写盘点均已就绪且单测全绿——US1（CLI）、US2（repo:check）、US3（多语言矩阵）均可并行启动。

---

## Phase 3: User Story 1 - 维护者提交前自查图质量（Priority: P1）🎯 MVP

**目标**：交付独立可用的 `graph-quality` CLI 命令，读取 `specs/_meta/graph.json` 输出五项结构指标 + freshness 共六字段的 pass/fail 与总体 verdict。

**独立测试**：在本仓库执行 `node dist/cli/index.js graph-quality`（或 `--json`/`--status`），验证输出结构与 exit code 符合 FR-011~016。

### Tests for User Story 1（先写，确认失败）

- [x] **T033** [US1] CLI 端到端测试（先红），文件：`tests/integration/graph-quality-cli.test.ts`。覆盖：① exit code 矩阵（0 全 pass / 0 pass-with-warnings / 1 强不变量违反 / 2 graph 缺失·JSON 损坏·schemaVersion 过旧）；② `--json`/`--status`/text 三种输出格式字段完整性（含 CLI 层组装的 freshness 字段，验证五项结构指标+freshness 完整六字段落地在 `--json` 输出中）；③ `dirty` 态验证（SC-014 前半，构造临时 git 仓库 + 未提交改动）；④ **（SC-010 独立复验，区别于 T048 的手工 JSON 篡改路径）**：用真实临时 git 仓库（`mkdtemp` + `git init` + 1 次 commit），对该仓库真实跑一次 `node dist/cli/index.js batch <tmp> --mode graph-only --output-dir <tmp>/specs/_meta` 生成图（此时 `sourceCommit` 记录为该临时仓库的初始 HEAD），随后在该临时仓库**再提交一次**（HEAD 前进，图未重新生成），断言 `graph-quality` 命令报告 `stale`（非静默沿用旧图判定为 `fresh`）——覆盖"HEAD 真实前进"场景，与 T048 的"手工构造 stale-commit.json"场景互补而非重复。依赖：T018, T020, T030, T032（五项结构指标+freshness+采集链路均需就绪以构造真实输入）。验收：运行结果为红（`graph-quality.ts` 尚不存在）；④场景需 `npm run build` 产出 dist（若 dist 已过期需先重建，但本任务本身先写红测试，dist 依赖在 T035 显式落地）。

### Implementation for User Story 1

- [x] **T034** [US1] CLI 命令实现（使 T033 转绿），文件：`src/cli/commands/graph-quality.ts`（新增，~260 行）+ `src/cli/utils/parse-args.ts`（`subcommand` 联合新增 `'graph-quality'` + 5 个新字段）+ `src/cli/index.ts`（import + switch dispatch + HELP_TEXT 追加一行）。验收：对应 T033 全绿；命令形态照抄 `direction-audit.ts` 先例；CLI 层在此任务内组装完整 `GraphQualityReport`（T018 五项结构指标结果 + 本任务内调用 `evaluateFreshness` 得到的 freshness 结果，二者合并为六字段报告）；`--status` 轻量模式（FR-013）三字段裁剪（`graphExists`/`freshness.state`/`overallVerdict`，四态不坍缩为二元）；graph 缺失/JSON 损坏/schemaVersion 过旧三类 `cannot-assess` 分支均给出 next-step 修复建议文本（SC-011）。依赖：T033。
- [x] **T035** [US1] 重建 dist，命令：`npm run build`。验收：`tsc` 零错误退出；`ls -la dist/cli/index.js` 存在且 mtime 晚于 T034 提交时间；`node dist/cli/index.js graph-quality --help` 可执行不报错。依赖：T034。**该任务是后续所有需要真实 spawn dist CLI 的任务的硬前置**：T037（repo:check 真实子进程集成测试）、T043/T044/T045（fixture pinned graph 生成，需调用 `node dist/cli/index.js batch`）、T046（四语言矩阵完整六指标断言）、T048（对抗 fixture 测试）、T052（self-dogfood 自检）均依赖本任务。
- [x] **T036** [US1] `--json` 输出契约完整化，文件：`specs/217-graph-quality-gates/contracts/graph-quality-report.schema.json`（**全新创建**——T001 仅产出 `quality-types.ts` 类型定义，不产出 schema 文件，本任务是该 schema 文件的唯一来源）。验收：依据 T034 实际 `--json` 输出核对字段完整覆盖 `GraphQualityReport` 全部六字段；命令固化：用 `npx ajv-cli validate -s specs/217-graph-quality-gates/contracts/graph-quality-report.schema.json -d <正例样例.json>` 对一份真实 `--json` 输出样例校验通过；额外构造 1 个负例（如手工删除必填字段 `overallVerdict` 或写入非法枚举值）用同一命令校验，断言 ajv 报错退出非零。依赖：T035, T034。

**Checkpoint**：`graph-quality` CLI 命令可独立运行，MVP 交付完成——维护者已可在提交前手动跑该命令自查图质量。

---

## Phase 4: User Story 2 - CI / repo:check 自动拦截强不变量回归（Priority: P1）

**目标**：`repo:check` 自动运行图质量检查，强不变量违反阻断提交，其余四项 warning 不阻断。

**独立测试**：人为构造重复 canonical ID 图产物运行 `npm run repo:check`，观察 error + 非零 exit；orphan 率超标场景观察 warning + exit 0。

### Tests for User Story 2（先写，确认失败）

- [x] **T037** [US2] repo:check 集成单测（先红），文件：`tests/unit/graph-quality-core.test.ts`（仿照 `tests/unit/codex-plugin-consistency-core.test.ts` 结构）。覆盖 SC-012 四态：graph 缺失→skip；JSON 损坏→warning；强不变量违反→error（阻断）；非强不变量问题→warning（不阻断）；`spawnSync` 真实覆盖 exit 1（强不变量违反）与 exit 2（无法评估）两条分支（真实构造触发这两个 exit code 的 `--graph` 输入跑真实 dist CLI 子进程，非纯 mock）；dist CLI 缺失→warning（含"未构建"/"`npm run build`"提示文案）；SC-014 后半（dirty 态 `repo:check` 不产生 warning）。依赖：T035（需要真实可 spawn 的 dist CLI）, T036（`--json` 输出契约需已固化，测试构造的期望结构才有依据）。验收：运行结果为红（`graph-quality-core.mjs` 尚不存在）。

### Implementation for User Story 2

- [x] **T038** [US2] `graph-quality-core.mjs` 实现（使 T037 转绿），文件：`scripts/lib/graph-quality-core.mjs`。验收：对应 T037 全绿；`spawnSync`（非 `execFileSync`，避免非零 exit 时 stdout 被裹进 error 吞掉）；JSON 解析失败/结构损坏→warning；`overallVerdict==='fail-strong-invariant'`→error；覆盖率/orphan/legacy-ignored 任一 fail→warning；`freshness.state==='stale'`→warning、`'dirty'`→不产生 warning（FR-026）；`result.status` 与 `report.overallVerdict` 交叉校验不一致时降级为 warning（不信任不一致信号）。依赖：T037。
- [x] **T039** [US2] `repo-maintenance-core.mjs` 接入，文件：`scripts/lib/repo-maintenance-core.mjs`（import `validateGraphQuality` + `aggregateValidation('graph-quality', ...)` 注册为第 12 个子检查族）。前置红测试：扩展 T037（`tests/unit/graph-quality-core.test.ts`）新增断言覆盖 `validateRepository` 聚合结果中 `graph-quality` 子检查族已注册（`checks` 数组含对应 namespace 条目）。验收：`npm run repo:check` 在本仓库真实跑一次通过；图质量子检查输出复用 `graph-quality --json` 结构化数据，未重复实现判定逻辑（FR-020）；第 6 节扩展位设计（FR-021）以本次接入方式作为唯一具体范例，未来 M9 轨道 C spec drift 检测可照抄同一函数签名约定（无需本任务额外产出抽象代码）。依赖：T038。
- [x] **T040** [US2] `package.json` `prepublishOnly` 顺序调整，文件：`package.json`。改为 `release:check && npm run build && npm run repo:check && npx vitest run`（`build` 先于 `repo:check`，决策 4 修订，理由：让发布链路里图质量门禁在 dist 就绪后真实生效，而非永远因 dist 未构建被 warning 兜底）。验收：纯配置行改动，无需前置红测试；`grep -A1 '"prepublishOnly"' package.json` 输出顺序为 `build` 在 `repo:check` 之前，`repo:check` 在 `vitest` 之前。依赖：T038（core 实现已存在，确保顺序调整后语义可验证；可与 T039 并行完成，同一 PR 内一并校验一致性）。

**Checkpoint**：US1 + US2 均已独立可用——CLI 手动自查 + repo:check 自动拦截双通道就绪。

---

## Phase 5: User Story 3 - 多语言场景下的图质量一致性验证（Priority: P2）

**目标**：验证图质量检测逻辑在 TS/JS、Python、Java、Go 四语言下正确工作，无跨语言误报/漏报。

**独立测试**：对四语言各自 pinned fixture 分别运行 `graph-quality`，确认结果与预先人工推导的期望值一致。

- [x] **T041** [P] [US3] 创建 TS/JS mini fixture 源码，目录：`tests/fixtures/graph-quality-ts/`。内容遵循决策 6 合同表（≥1 module 级自由函数 + ≥1 class 含 ≥2 member + ≥1 interface + ≥1 type 声明，class 内方法间 ≥1 条可被 AST 解析的调用关系驱动 `calls` 边非空）+ ≥1 个测试文件（符合 TS/JS `LanguageAdapter.getTestPatterns()`）。MUST NOT 复用 `tests/fixtures/multilang-project/`（FR-024）。依赖：无。验收：`find tests/fixtures/graph-quality-ts -type f | wc -l` ≥ 3；`diff -rq tests/fixtures/graph-quality-ts tests/fixtures/multilang-project` 确认零文件路径重叠。

### fixture SOP（适用于 T043/T044/T045，固化 sourceCommit 稳定性）

> **裁定 SOP**（禁止仓内直接建图）：① 用 `mktemp -d` 在**仓库外**创建临时目录；② `cp -r` 将 fixture 源码（T041/T025/T026）拷贝进该临时目录（不含 `.git`，也不 `git init`）；③ 执行 `node dist/cli/index.js batch <tmp-src-dir> --mode graph-only --output-dir <tmp-output-dir>`；④ 断言产出的 `graph.json` 中 `graph.sourceCommit === null`（因该临时目录向上找不到任何 `.git`，属于 CONSTRAINT-002 预期行为）；⑤ 确认无误后将 `<tmp-output-dir>/specs/_meta/graph.json` 冻结拷贝入库到对应的 `tests/fixtures/graph-quality-<lang>-graph/graph.json`。**禁止在仓库内目录直接对 fixture 源码跑建图命令**（会向上找到主仓库 `.git` 把当前 HEAD 写入 fixture，破坏可重生成性与 CONSTRAINT-002）。**禁止使用裸 `spectra` 命令**（依赖全局安装/PATH，跨机器不可复现）——统一用 `node dist/cli/index.js batch ...`，故这三个任务均依赖 T035（dist 已构建）。

- [x] **T042** [P] [US3] 创建 10 个对抗注入 GraphJSON fixture，目录：`tests/fixtures/graph-quality-adversarial/`。文件：`duplicate-canonical-id.json`/`dangling-edge.json`/`ignored-path-node.json`/`legacy-hash-node.json`/`stale-commit.json`/`coverage-gap.json`/`orphan-excess.json`（原 7 个）+ `pure-type-orphan.json`/`test-export-orphan.json`/`entrypoint-orphan.json`（豁免分类专项，新增 3 个）。每个手写最小 JSON 字面量（非真实建图产出），仅含触发对应指标 fail 所需的最小节点/边集合。依赖：无（与 T041 并行，不依赖 Foundational 实现细节，仅依赖 spec/plan 已固化的 GraphJSON 结构合同）。验收：`ls tests/fixtures/graph-quality-adversarial/*.json | wc -l` 等于 10；每个文件用 `node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))"` 校验合法 JSON。
- [x] **T043** [US3] TS/JS pinned graph.json + README 人工推导表，产出：`tests/fixtures/graph-quality-ts-graph/graph.json`（按上方 fixture SOP 对 T041 源码真实建图产出，冻结拷贝入库）+ `README.md`（逐条列出"N 个 symbol 节点、预期 contains 覆盖率、预期 orphan 数"，人工从源码推导，SC-002 强制要求）。依赖：T041, T035（dist 已构建，SOP 硬前置）。验收：`node -e "console.log(JSON.parse(require('fs').readFileSync('tests/fixtures/graph-quality-ts-graph/graph.json')).graph.sourceCommit)"` 输出 `null`；README 中数值与后续 T046 断言一一对应。
- [x] **T044** [US3] Java pinned graph.json + README 人工推导表，产出：`tests/fixtures/graph-quality-java-graph/graph.json`（按上方 fixture SOP 对 T025 源码真实建图产出）+ `README.md`（同上结构）。依赖：T025, T035。验收：同 T043（`sourceCommit === null` + README 数值核对）。
- [x] **T045** [US3] Go pinned graph.json + README 人工推导表，产出：`tests/fixtures/graph-quality-go-graph/graph.json`（按上方 fixture SOP 对 T026 源码真实建图产出）+ `README.md`（同上结构）。依赖：T026, T035。验收：同 T043（`sourceCommit === null` + README 数值核对）。
- [x] **T046** [US3] 四语言矩阵测试，文件：`tests/integration/graph-quality-lang-matrix.test.ts`。覆盖：① Python 复用既有 `MICROGRAD_SOURCE` skip 门槛 + 顶层 function/class 分母精确断言（验证 T024 `graph-builder.ts` existing-node 合并分支修复对 Python 生效，而非仅整体不崩溃）；② TS/Java/Go 恒实跑（不适用 skip 语义），断言值均引用 T043/T044/T045 各 README 手推数值（禁止仅 `deepEqual` 快照弱断言）；③ **完整六指标断言**（SC-002 覆盖真实化，不再局限于结构指标）——四语言 fixture 均跑一次真实 `node dist/cli/index.js graph-quality --json --graph <pinned-graph.json>`，断言五项结构指标 pass/fail 状态 + `freshness.state`（四份 pinned graph 均因 `sourceCommit===null` 而 `unknown-provenance`，非跳过评估）均出现在输出中；④ 仅验证生产链结构指标的正常场景 pass/fail 与 freshness 的诚实降级语义，orphan 豁免分类断言不在此覆盖（见 T048）。依赖：T043, T044, T045, T018, T034, T035。

**Checkpoint**：四语言回归矩阵与 10 项对抗测试全绿，US1/US2/US3 均已独立可交付。

- [x] **T048** [US3] 对抗 fixture 测试，文件：`tests/integration/graph-quality-adversarial.test.ts`。覆盖：① 原 7 个 fixture 断言 SC-003~SC-009 的 100% 检出率 + 精确定位信息（三元组/edge source-target-relation 字符串完全匹配，非仅数量断言）；② `stale-commit.json` 用 `mkdtemp` + `git init` 构造隔离临时仓库（避免主仓库提交历史变化导致 flaky），固定全 `f` 的 40 位十六进制 SHA 写入，跑真实 CLI 断言 `stale` 成立，**并断言人读文本摘要中同时展示 `recordedSourceCommit`（fixture 写入的全 `f` SHA）与 `currentHead`（临时仓库真实 HEAD）两个值**（SC-007 覆盖真实化，验证"明确展示记录的 commit 与当前 HEAD 的差异"这一要求，而非仅判定状态字符串）；③ 新增 3 个豁免分类专项断言 `orphanRatio.exemptedByCategory` 对应分类计数精确归位；④ **（SC-011 覆盖真实化）**逐一断言 10 个 fixture 中触发 fail 的每一类指标（duplicate-canonical-id / dangling-edge / ignored-path-node / legacy-hash-node / stale-commit / coverage-gap / orphan-excess，六类结构性+freshness 指标）各自对应的 `nextSteps` 数组非空，而非仅在其中一个 fixture 上验证一次 next-step 存在。依赖：T042, T034, T035。

---

## Phase 6: Polish & Cross-Cutting Concerns（P4 里程碑：重生成 + 全量回归）

**目的**：验证 P1 的 metadata 改动对既有 pinned fixture 消费方无破坏性影响，并在本仓库自身产物上完成 SC-001/SC-013 终验。

- [x] **T049** micrograd fixture 按需重生成（含 sourceCommit 断言），目录：`tests/fixtures/micrograd-baseline-graph/`。按 F215 SOP（`rsync` 只读拷贝、排除 `.git`）重新生成，验证 T022/T024 metadata 改动落地正确性。验收：`node -e "console.log(JSON.parse(require('fs').readFileSync('tests/fixtures/micrograd-baseline-graph/graph.json')).graph.sourceCommit)"` 输出 `null`（micrograd SOP 的 rsync 临时拷贝本就无 `.git`，属预期而非异常，与 T043~T045 新建 fixture 的 SOP 结论一致）；`git diff --stat tests/fixtures/micrograd-baseline-graph/` 确认改动范围符合预期（仅 metadata 新增字段，无节点/边数量变化）。依赖：T022, T024, T030, T035。
- [x] **T050** F215 七个消费文件逐一定向核对，涉及文件与核对命令：
  1. `tests/integration/mcp-server-stdio.test.ts` — 先 `grep -n "metadata" tests/integration/mcp-server-stdio.test.ts` 确认断言方式，若含对 `metadata` 的穷举式 `toEqual`/`deepEqual`（而非按需取字段），需更新期望值；再跑 `npx vitest run tests/integration/mcp-server-stdio.test.ts` 确认全绿。
  2. `tests/integration/agent-context-real-graph.test.ts` — 同上核对方式 + `npx vitest run tests/integration/agent-context-real-graph.test.ts`。
  3. `tests/e2e/feature-180-graph-tools.e2e.test.ts` — 同上 + `npx vitest run tests/e2e/feature-180-graph-tools.e2e.test.ts`。
  4. `tests/e2e/feature-180-file-nav-stdio.e2e.test.ts` — 同上 + `npx vitest run tests/e2e/feature-180-file-nav-stdio.e2e.test.ts`。
  5. `tests/e2e/feature-180-symbol-chain.e2e.test.ts` — 同上 + `npx vitest run tests/e2e/feature-180-symbol-chain.e2e.test.ts`。
  6. `tests/e2e/feature-184-view-file-fuzzy.e2e.test.ts` + `tests/e2e/feature-180-telemetry.e2e.test.ts` — 同上核对方式，两文件均需单独跑 `npx vitest run <文件>`。
  7. `tests/integration/graph-mcp-snapshot.test.ts` — **按已裁定事实处理，非重建**：该 fixture（`tests/integration/__fixtures__/self-dogfood-graph.json`）已被 F158（commit `f9edd13`）刻意删除，测试自那以后有意休眠（`describe.skip` 是既定状态，非缺陷）。本任务只需运行 `npx vitest run tests/integration/graph-mcp-snapshot.test.ts` 确认 skip 语义未变（不因本次改动被意外激活或报错），并在 T054 的 verification 报告中记录一句："F158 起该 snapshot 测试休眠，F217 未复活也未破坏；未来若复活，Java/Go fixture 入图会使 `graph_god_nodes` top-5 等排名断言发生变化，需重新录制预期值"。**不新建"重建 fixture + `--update`"任务**。
  验收：7 项逐一确认"是否对 `metadata` 做穷举式深度比较"，仅深度比较型断言需要更新；`git diff` 审查 fixture 变更符合预期（不能只看 pass count）。依赖：T049。
- [x] **T051** 收尾归因记录，操作：汇总 T049/T050 的核对结果与 R1/R3 风险归因，写入本次 verification 报告（不新增制品文件，随 T054 的验证报告一并交付）。内容至少含：① micrograd fixture 与 7 个消费文件的实际改动范围是否符合"仅 metadata 新增字段"预期；② `graph-mcp-snapshot.test.ts` 的休眠状态记录（同 T050 第 7 项）；③ 若发现任何非预期改动（如节点计数变化、排序变化），需明确写出具体原因，不得笼统归为"预期内"。依赖：T050。
- [x] **T052** 自身仓库 SC-001 + R3 风险复核，命令：重建本仓库 `node dist/cli/index.js batch . --mode graph-only` 图 → 运行 `node dist/cli/index.js graph-quality`。验收：五项结构指标 + freshness 全部 pass 或按已知例外正确归类为 `not-applicable`（SC-001）；显式核查 Generic collector 启用后新纳入图的既有测试样本文件（`tests/fixtures/multilang/{java,go}/*`、`multilang-project/go-services/*.go` 等含 `syntax-error.go`/`empty.go` 边界样本）是否引入意外 orphan（风险清单 R3），若有指标劣化需具体分析归因（新增合法测试导出例外 vs. 真实遗漏），不得为让指标好看而伪造豁免规则。依赖：T030, T034, T035。
- [x] **T053** `impact` 复核 R1 风险，操作：① 用 Spectra MCP `impact` 工具（`direction=downstream`, `depth=3`）分别复核 `deriveNodesFromSkeletons`（`src/knowledge-graph/index.ts`）与 `graph-builder.ts` UnifiedGraph→GraphNode 合并段的实际调用方数量；② 交叉核对命令：`grep -rn "writeKnowledgeGraph(" src/`，对照 plan §3 决策 3 四个 `writeKnowledgeGraph` 调用点裁定表（`buildAstGraphOnly`/`runBatch`/`graph.ts`/`community.ts`）逐一勾验，确认 grep 命中数与该表行数一致（4 处），无遗漏调用方。验收：①②结果一致，确认改动前评估的"仅新增 metadata key、不改变现有字段/排序/控制流"结论未遗漏隐藏调用方；若发现遗漏调用方，需追加对应回归测试。依赖：T022, T024。
- [x] **T054** 全量回归验证，验收顺序固化为：① `npm run build`（零错误）→ ② `npx vitest run`（零失败，含 T005~T048 全部新增/扩展测试）→ ③ `npm run repo:check`（零失败，含图质量子检查真实触发）→ ④ `npm run release:check`（涉及 `package.json` `prepublishOnly` 改动，需复核 release contract 一致性）。验收：SC-013 全部满足，且必须按上述①→②→③→④固定顺序执行（`build` 必须先于 `repo:check`，呼应 T040 的顺序调整动机）；`batch-orchestrator-incremental.test.ts` 已知偶发并行 flaky 需隔离重跑复核（非本次改动引入）。依赖：T001~T053 全部完成。

**Checkpoint**：全部 27 FR + 14 SC 覆盖完成，可提交 Codex 对抗审查（implement phase）。

---

## Dependencies & Execution Order

### Phase 依赖关系

- **Setup（Phase 1）**：无前置依赖，T001/T002/T003/T004 可完全并行
- **Foundational（Phase 2）**：依赖 Setup 完成；阻塞全部 3 个 User Story（"依赖：无"的源码 fixture 创建任务 T025/T026 例外，可提前并行，见 Phase 2 顶部说明）；内部子链：
  - 五项结构指标 check 函数（T005~T016）各自独立，可并行推进（[P] 标记的测试任务之间无冲突）
  - `quality-engine`（T017/T018）依赖全部五项结构指标 check 函数完成，**不依赖** `source-commit`（freshness 独立组装于 CLI 层）
  - `source-commit`（T019/T020）独立于五项结构指标链，可与之并行
  - metadata 透传链（T021~T024）需按 `deriveNodesFromSkeletons`（T021/T022）→ `graph-builder.ts`（T023/T024）顺序
  - generic collector（T025~T028）依赖 fixture 源码（T025/T026）先行，且实现任务（T028）显式依赖 `ignore-oracle` 实现（T012）与 `quality-engine` 实现（T018）
  - `batch-orchestrator`（T029/T030）依赖 `source-commit`（T020）+ `generic-collector`（T028）+ `quality-engine`（T018）
  - `graph.ts`/`community.ts`（T031/T032）依赖 `source-commit`（T020）
- **User Stories（Phase 3+）**：均依赖 Foundational（Phase 2）完成
  - US1（CLI，T033~T036）：Foundational 完成后即可开始，是其余两个 Story 的前置（US2 需要 T035 产出的可 spawn dist CLI；US3 的 pinned graph 生成与对抗测试均需 dist CLI）
  - US2（repo:check，T037~T040）：依赖 US1 的 T035（dist 构建）+ T036（`--json` 契约固化）
  - US3（多语言矩阵，T041~T048）：`T041/T042`（fixture 创建）可与 Foundational/US1/US2 并行；`T043/T044/T045`（pinned graph 生成）依赖 T035（dist）+ 对应源码 fixture；`T046`（矩阵测试）依赖 T043~T045 + Foundational 的 `quality-engine`（T018）+ US1 的 CLI（T034）+ dist（T035）；`T048`（对抗测试）依赖 US1 的 CLI（T034）+ dist（T035）
- **Polish（Phase 6）**：依赖全部 User Story 完成

### User Story 依赖

- **US1（P1）**：可在 Foundational 完成后立即开始，不依赖其他 Story
- **US2（P1）**：依赖 US1 产出的 dist CLI（T035）与 `--json` 契约（T036），不可先于 US1 独立完成
- **US3（P2）**：fixture 创建部分（T041/T042）不依赖 US1/US2，可提前并行；pinned graph 生成与矩阵/对抗测试执行部分依赖 US1 的 dist CLI（T035）与命令实现（T034）

### 并行机会

- Setup 全部 4 个任务 [P] 并行
- Foundational 内五项结构指标 check 函数的测试任务（T005/T007/T009/T011/T013/T015/T019/T021）可并行编写
- Foundational 内 Java/Go fixture 源码创建（T025/T026）可并行，且不受 Foundational barrier 约束，可提前开工
- US3 的 TS/JS fixture 创建（T041）与对抗 fixture 创建（T042）可与 US1/US2 全程并行（不同文件、无依赖）
- 不同开发者可并行认领：Developer A 五项结构指标引擎（T005~T018）；Developer B sourceCommit + metadata 透传（T019~T024）；Developer C generic collector + fixture（T025~T028, T041, T042）

---

## FR / CONSTRAINT / SC 覆盖映射表

| 需求 | 覆盖任务 |
|---|---|
| FR-001/002 | T005, T006, T048（duplicate-canonical-id.json） |
| FR-003/004 | T007, T008, T023, T024（existing-node 修复）, T046（四语言矩阵）, T048（coverage-gap.json） |
| FR-005 | T015, T016, T048（orphan-excess/pure-type-orphan/test-export-orphan/entrypoint-orphan.json）, T046（正常路径） |
| FR-006 | T009, T010, T048（dangling-edge.json） |
| FR-007/008 | T002, T004, T011, T012, T013, T014, T048（legacy-hash-node.json / ignored-path-node.json） |
| FR-009 | T019, T020, T030, T031, T032 |
| FR-010 | T019, T020, T048（stale-commit.json）, T033（dirty 态 + SC-010 HEAD-forward 场景） |
| FR-011/012 | T033, T034 |
| FR-013 | T034（`--status` 分支） |
| FR-014 | T033, T034（exit code 矩阵） |
| FR-015 | T033, T034（graph 缺失分支） |
| FR-016 | T033, T034（schemaVersion 过旧分支） |
| FR-017/018/019/026/027 | T037, T038, T039 |
| FR-020 | T038（spawnSync 复用架构） |
| FR-021 | T039（唯一具体范例） |
| FR-022 | T041, T043, T046 |
| FR-023 | T025, T044, T046（正常路径）, T042, T048（异常路径，独立） |
| FR-024 | T041, T025, T026, T043, T044, T045, T046（不复用 multilang-project） |
| FR-025 | T043, T044, T045, T046（SOP 一致性） |
| CONSTRAINT-001 | T028, T030（零 LLM 复核） |
| CONSTRAINT-002 | T043, T044, T045, T049（fixture 均 `.git` 排除，`sourceCommit` 恒 `null`） |
| CONSTRAINT-003 | T001, T003, T022, T024（仅 metadata record 新增 key，不改 zod schema） |
| CONSTRAINT-004 | 全篇不触碰 `plugins/spec-driver/`，无任务涉及该目录 |
| CONSTRAINT-005 | T034（仅 CLI + repo:check，无新增 MCP 工具） |
| CONSTRAINT-006 | T020（`evaluateFreshness` 与 `graph-query.ts::assertGraphFormatNotStale` 职责边界不重叠） |
| CONSTRAINT-007 | T006, T014（canonical ID 三层合同不回归）, T048（legacy-hash-node.json 验证） |
| SC-001 | T052 |
| SC-002 | T043, T044, T045, T046 |
| SC-003~SC-009 | T042, T048 |
| SC-010 | T048（stale-commit.json，手工构造路径）, T033（HEAD 真实前进的 CLI 端到端路径，独立复验） |
| SC-011 | T034（next-step 文本生成）, T048（六类指标各自 next-step 非空逐项断言） |
| SC-012 | T037 |
| SC-013 | T054 |
| SC-014 | T033（前半 dirty CLI）, T037（后半 repo:check 不告警） |

---

## Implementation Strategy

### MVP First（US1 优先）

1. 完成 Phase 1: Setup
2. 完成 Phase 2: Foundational（**关键阻塞**——不可跳过）
3. 完成 Phase 3: User Story 1（CLI 命令，T033~T036）
4. **停止并验证**：独立运行 `node dist/cli/index.js graph-quality` 确认五项结构指标 + freshness 输出正确
5. 此时已具备核心防回归价值——维护者可手动自查

### 增量交付

1. Setup + Foundational → 基座就绪
2. + US1（CLI，T033~T036，含显式"重建 dist"任务 T035） → 独立测试 → 可演示（MVP！）
3. + US2（repo:check 集成，T037~T040） → 独立测试 → 自动化拦截生效
4. + US3（多语言矩阵，T041~T048） → 独立测试 → 回归护栏完整
5. + Polish（重生成 + 全量回归，T049~T054） → 交付前终验

### 并行团队策略

Foundational 完成后：
- Developer A：US1（CLI，T033~T036）
- Developer B：US3 fixture 创建部分（T041, T042，可与 A 全程并行，不依赖 CLI）
- US2（T037~T040）需等待 US1 的 T035（dist 构建）+ T036（`--json` 契约）完成后再启动

---

## Notes

- [P] 任务 = 不同文件、无依赖冲突
- [USN] 标签用于将任务映射到具体 User Story，支持独立追踪
- TDD 硬约束：全部实现任务均有前置测试任务，测试任务必须先跑红（`npx vitest run <test-file>` 失败）再开始对应实现任务；`generic-language-skeleton-collector` 的 contains 双轨风险实证复核（原挂在实现任务验收上）已前移至其测试任务 T027，确保该论证也遵循"先红后绿"而非事后补充的实现内验收
- 任务总数 54（较上一版 46 略有增加，主因：显式拆出"重建 dist"任务、ignore 常量导出前置任务、repo-maintenance 接线与 package.json 顺序调整分离为两个独立任务、三语言 pinned graph 生成按语言拆分为三个任务、七消费文件核对拆分为逐文件命令级任务）——规模变化源于依赖关系与验收标准显式化，不改变原有 27 FR + 4 语言矩阵 + 10 项对抗 fixture + 严格 TDD 的覆盖范围
- 每个 Phase 完成后建议提交一次 commit（对应 CLAUDE.local.md 阶段性 Codex 对抗审查约定：implement phase 提交前需跑一次 codex-rescue 对抗审查）
- 提交前必须按固定顺序执行 T054 全量回归：`npm run build` → `npx vitest run` → `npm run repo:check` → `npm run release:check`，零失败

## 已知边界（Codex 对抗审查后裁定：记录不修）

以下 3 项为 Codex 二次对抗审查（implement 阶段）发现、经主编排器裁定"记录不修"的边界情况，均不影响本 Feature 六指标 + freshness 的核心正确性：① submodule 边界——`git status --porcelain` 只报 submodule 根路径（无源码扩展名，被 dirty 判定的扩展名过滤面天然剔除），且 walker 不识别嵌套 `.git`，因此含 submodule 的仓库场景下 freshness 可能漏判某些 submodule 内部改动为 dirty；此为罕见场景，留待未来 Feature 按需处理。② `spectra graph-quality --help` 子命令帮助不可达——`parse-args.ts` 的全局参数解析在遇到 `--help`/`-h` 时会被更上层的全局逻辑截获，这是**全部 CLI 子命令的既有共性行为**（非本 Feature 引入的回归），不在 F217 范围内单独修复。③ spec FR-025 措辞需澄清（后续以一句话方式回改 `spec.md`）——"Python 载体的 skip 语义"仅适用于"从外部源重建 fixture"的路径（如 F215 `tests/fixtures/micrograd-baseline-graph/` 的 e2e 消费者重新生成场景），并不适用于直接读取 in-repo pinned fixture 的矩阵测试（`graph-quality-lang-matrix.test.ts` 恒实跑，不设 skip 条件）；当前实现在这一点上是正确的，仅 spec 文字表述需要更明确，不涉及代码改动。
