# Tasks: F175 — Batch Incremental Wrapper

**Feature Branch**: `175-batch-incremental-wrapper` | **Date**: 2026-06-06  
**Input**: `specs/175-batch-incremental-wrapper/{spec,plan,data-model}.md` + `contracts/`  
**FR 总数**: 19 条（FR-001 ～ FR-019，含 FR-014/FR-015）  
**SC 总数**: 7 条 | **EC 总数**: 9 条  
**架构约束**: 强制 TDD（M7），Phase 0 → Phase 1 RED → Phase 2 GREEN → Phase 3 REFACTOR  

---

## 格式说明

- `[P]` 可并行（不同文件、无依赖）
- `[USN]` 归属 User Story（US1-US5）
- Phase 0/3 不加 `[USN]`（基础设施 / 整理阶段）
- 每个 task 包含确切文件路径
- **`N_baseline`**（W-3）：各 Phase 开始时 `npx vitest run` 的存量通过数（**动态基线，不写死数字**——新增/删测后固定数字会误判回归）。验收口径统一为"存量零失败 + 新增测试按 RED/GREEN 预期"

---

## Phase 0：[CLEANUP] — 纯函数提取（行为不变，零产物变更）

**目的**: 从 `batch-orchestrator.ts`（LOC>500，本次新增>50 行，触发前置清理规则）提取两个纯函数到独立模块，消除后续 GREEN 阶段的认知负担。**严格禁止**插入调用点或改变任何产物。

**验证点**: `npx vitest run`（N_baseline + 新单测全部通过）、`npm run build` 零错误、同一 fixture 的 graph.json 与 Phase 0 前逐字节一致。

**Git commit 建议**: `chore(175): [CLEANUP] 提取 resolveRegenPlan + normalizeGraphForWrite 纯函数（零产物变更）`

### 新建核心纯函数模块

- [x] T001 新建 `src/batch/regen-plan.ts`：定义 `RegenPlanInput` / `RegenPlan` / `RegenPlanSource` 类型（来自 `data-model.md`），实现 `resolveRegenPlan`（**此阶段默认值实现为 `incremental=false`，保持行为不变**，GREEN 阶段再翻转）
  - 文件: `src/batch/regen-plan.ts`

- [x] T002 在 `src/batch/regen-plan.ts` 实现 `resolveSourceTarget(group, conflictingDirPaths, isRoot): string`（提取自 `batch-orchestrator.ts:713-720` 的 target 口径逻辑，含目录冲突分支），调用方暂**不替换**，保留内联逻辑以维持行为不变
  - 文件: `src/batch/regen-plan.ts`

- [x] T003 [P] 在 `src/panoramic/graph/graph-builder.ts` 新增 `normalizeGraphForWrite(graphJson, options?): void` 函数定义及占位实现（返回不做任何排序），同时新增辅助函数 `stripVolatileFields` 和 `stableStringify`；从 `src/panoramic/graph/index.ts` 导出 `normalizeGraphForWrite`（当前仅导出 3 个函数）。**不在任何写盘序列中调用**
  - 文件: `src/panoramic/graph/graph-builder.ts`, `src/panoramic/graph/index.ts`

### Phase 0 单测（验证提取等价性）

- [x] T004 新建 `tests/unit/batch/regen-plan.test.ts`：覆盖 `resolveRegenPlan` 的三条解析规则（full/force→全量、incremental=false→兼容路径、全 undefined→默认 incremental=false（Phase 0 行为））；覆盖 `resolveSourceTarget` 含目录冲突 + 非冲突的两种场景，断言与原内联逻辑输出一致
  - 文件: `tests/unit/batch/regen-plan.test.ts`

- [x] T005 [P] 新建 `tests/unit/graph/graph-builder-normalize.test.ts`：Phase 0 版本验证 `normalizeGraphForWrite` 占位实现不改变输出（in-place void，调用前后对象引用相同，nodes/links 顺序不变）；预留 GREEN 阶段的 byte-stable 测试用例（先写为 `it.todo` 占位）
  - 文件: `tests/unit/graph/graph-builder-normalize.test.ts`

**Checkpoint — Phase 0 完成标准**:
- [x] T006 运行 `npx vitest run`，确认 N_baseline + T004/T005 新单测全部通过，零失败
- [x] T007 [P] 运行 `npm run build`，确认 TypeScript 零错误

---

## Phase 1：[RED] — 测试先行（所有新测试 RED，存量 N_baseline GREEN）

**目的**: 先写失败的测试，锁定所有验收条件，防止实现"写代码让测试通过"时绕开边界。

**约束**: 此阶段**不实现任何功能**，仅写测试代码。所有新增测试预期失败（RED）。现有 N_baseline 个测试须维持通过（GREEN）。

**Git commit 建议**: `test(175): [RED] E2E + 单测先行（9 场景 RED，N_baseline GREEN）`

### E2E 测试（核心路径，9 个场景）

- [x] T008 新建 `tests/e2e/feature-175-batch-incremental.e2e.test.ts`，沿用 `tests/e2e/batch-pipeline.e2e.test.ts` 范式（`vi.hoisted` + `vi.mock('@anthropic-ai/sdk')` + `mkdtempSync` + **`git init`**），实现以下 9 个测试场景（全部预期 RED）：
  - **场景 1** `[US1]` 改文件→仅受影响模块重生成（FR-018 独立断言：构造 A→B 依赖图改 B，验证 A 和 B 被重生成、未依赖的 C 未被调用；`generateSpec` 调用次数 == deltaReport.regenerateTargets.size，且通过预期 target 集合比对而非仅计数）。**W-1：同时快照未受影响模块（C）的 `*.spec.md` mtime，断言两轮后逐字节 + mtime 完全不变（FR-005，仅看调用次数不足以证明文件未被后续流程改写）**
  - **场景 2** `[US2]` 无改动→零模块级调用（SC-002：第二轮 batch 的 `generateSpec` 调用次数 == 0，`deltaReport.directChanges` 空，`deltaReport.propagatedChanges` 空）。**W-1：断言所有模块级 `specs/**/modules/*.spec.md` 的 mtime 与第一轮后一致（FR-005）**
  - **场景 9** `[US1]` 首次运行（无历史 spec）退化全量（**C6 修订：FR-012 专属可测场景，非"隐含"**）：在**无任何 `*.spec.md`** 的全新临时项目上以默认参数运行 batch，断言：所有模块被生成、`deltaReport.mode === 'full'`、`deltaReport.fallbackReason === 'no-existing-specs'`（实现路径 `delta-regenerator.ts:87-105`），且不报错/不空跑
  - **场景 3** `[US3/US4]` 显式 `--full`→全量调用（SC-005/FR-016：即使存在 checkpoint 或全部 cache 命中，`generateSpec` 调用次数 == 总模块数）
  - **场景 4** `[US1]` mode 切换→cache miss（FR-013：第一轮 full 模式，第二轮切换为 reading 模式，DeltaRegenerator 须对所有模块 cache miss 强制重生成）
  - **场景 5** `[US3]` 孤儿删除文件集收敛（FR-017：删除一个源文件后运行增量 batch，**带 `generatedByMode` 的 batch 产物**孤儿须被删除；且目录内混入**无 `generatedByMode` 的手写 spec**（以及 `spectra generate` 单文件产物，仅有 `generatedBy` 无 `generatedByMode`）不被删除（EC-009 ownership 边界））
  - **场景 6** `[US4]` 含 checkpoint 的 force（FR-016：模拟中途崩溃留有 checkpoint 文件的场景，--full 启动时清空 completedPaths，所有模块重新生成）
  - **场景 7** `[US1]` 目录冲突 target 口径（FR-019：构造目录名与文件名冲突的 fixture，验证 DeltaRegenerator.regenerateTargets 中的 target 与 processOneModule 中的 target 一致）
  - **场景 8** `[US1]` BFS 依赖传播正确性（FR-018：diamond 依赖 A←B,A←C,B←D,C←D，改 D 须传播到 A/B/C；cycle 依赖 X↔Y，改 X BFS 须终止不死循环）
  - 文件: `tests/e2e/feature-175-batch-incremental.e2e.test.ts`

### 单测（补充 RED 断言）

- [x] T009 [P] 扩展 `tests/unit/batch/regen-plan.test.ts`（**C5 修订：明确替换关系，避免 T004 旧断言在 Phase 2 翻转后永久变红**）：(a) **将 T004 中"全 undefined → incremental=false"的默认断言原地改写为"全 undefined → incremental=true"，并预期此断言在当前（Phase 0 实现 default=false）为 RED**（不要新增第二条互斥断言并存）；(b) 覆盖 force+incremental 同时传入 force 优先（EC-001/FR-011）；(c) 三入口默认值一致矩阵（US-5/SC-004）。注：T004 的 `resolveSourceTarget` 等价性断言保持不变（与默认值无关）
  - 文件: `tests/unit/batch/regen-plan.test.ts`

- [x] T010 [P] 新建 `tests/unit/batch/batch-orchestrator-incremental.test.ts`：默认翻转验证（不传 incremental 时 runBatch 实际走 DeltaRegenerator 路径）+ mode×incremental 正交矩阵（3 种 mode × 2 种 regen 路径 = 6 组合，各验证调用链路正确）；使用 vi.mock 隔离 LLM 调用，断言 DeltaRegenerator 是否被实例化/调用
  - 文件: `tests/unit/batch/batch-orchestrator-incremental.test.ts`

- [x] T011 [P] 扩展 `tests/unit/graph/graph-builder-normalize.test.ts`（在 T005 基础上追加 RED 断言）：byte-stable deepEqual 验证（归一化后 nodes 按 id 字典序、links 按 source+target+relation 字典序）；inputHash 内容敏感性验证（内容改变 → inputHash 改变；仅时间戳 generatedAt 改变 → inputHash 不变，此为 FR-006/FR-007 核心）；时间戳剥除验证（generatedAt 在 stripVolatileFields 后不参与 hash 计算）
  - 文件: `tests/unit/graph/graph-builder-normalize.test.ts`

**Checkpoint — Phase 1 完成标准**:
- [x] T012 运行 `npx vitest run`，确认：(a) T008 ~ T011 新增测试全部 RED（失败原因为功能未实现，非语法错误）；(b) 现有 N_baseline 个测试全部 GREEN

---

## Phase 2：[GREEN] — 按 FR 顺序实现（让 RED 测试变绿）

**目的**: 按 plan.md 定义的 FR 顺序实现功能，每个 FR 实现后验证对应测试变绿。不做多余的清理（留 Phase 3）。

**Git commit 建议**: `feat(175): [GREEN] 默认翻转 + --full + byte-stable + 孤儿删除（FR-001-019 GREEN）`

### Step 2.1：默认翻转 + 三入口接入 resolveRegenPlan（FR-001/FR-002/FR-011）

**目标 User Stories**: US1, US2, US5  
**覆盖 FR**: FR-001, FR-002, FR-011

- [x] T013 `[US1][US2][US5]` 修改 `src/batch/regen-plan.ts`：**仅将规则 (4)（undefined 默认分支）** 的 `incremental` 从 `false` **翻转为 `true`**（FR-001）——规则 (2) 显式 incremental=true 已返回 true、规则 (1) full/force 优先，均不改。同步把 T004 中规则 (4) 的默认断言改为 incremental:true（见 T009）
  - 文件: `src/batch/regen-plan.ts`

- [x] T014 `[US5]` 修改 `src/cli/commands/batch.ts`（现有 config 合并点 `:47`）：在合并 config 后调用 `resolveRegenPlan({ incremental, full, force })`，结果写入传给 `runBatch` 的 options；删除原有的 incremental 默认值硬编码（FR-002）
  - 文件: `src/cli/commands/batch.ts`

- [x] T015 `[US5]` 修改 `src/mcp/server.ts`：在现有 `incremental ?? fileConfig.incremental`、`force ?? fileConfig.force` 合并后，连同新增 `full` 参数传入 `resolveRegenPlan({ incremental, full, force })`；删除原有 incremental 默认值漂移逻辑（FR-002）
  - 文件: `src/mcp/server.ts`

- [x] T016 `[US5]` 修改 `src/batch/batch-orchestrator.ts`：删除 `:388` 行的 `incremental = false` 硬编码，改为接收已解析的 `RegenPlan`（或对直接调用方兜底调用一次 `resolveRegenPlan`）；`runBatch` options 类型新增 `full?: boolean` 字段（FR-002）。**并在 `BatchResult` 接口新增 `deltaReport?: DeltaReport` 字段并在 return（`:1721`）填入**——现状只返回 `deltaReportPath`（文件），E2E（SC-001/002/005、场景9 fallbackReason、FR-013/018）需断言 `deltaReport.{mode,directChanges,propagatedChanges,regenerateTargets,fallbackReason}`，必须把对象暴露在返回值上。RED 测试先断言该字段（undefined→RED），本 task 使其 GREEN
  - 文件: `src/batch/batch-orchestrator.ts`

### Step 2.2：`--full` flag + MCP full 参数（FR-003/FR-004）

**目标 User Stories**: US4  
**覆盖 FR**: FR-003, FR-004

- [x] T017 `[US4]` 新增 `--full` flag（**C4 修订：解析与 help 在不同文件，两处都要改**）：(a) `src/cli/utils/parse-args.ts` 新增 `--full` 解析（`argv.includes('--full')`）+ 在 `CLICommand` 接口（`:7-14`，当前无 `full` 字段）新增 `full?: boolean`，`--force` 保留为等义别名；(b) `src/cli/index.ts`（真实 `spectra --help` 输出在 `:37-43` 和 `:87-98`）新增 `--full` 的 help 文案 + usage 行，明确区分 regen 轴与 `--mode` 质量维度（见 contracts/cli-flags-contract.md）
  - 文件: `src/cli/utils/parse-args.ts`, `src/cli/index.ts`

- [x] T018 [P] `[US4]` 修改 `src/mcp/server.ts`：在 batch tool schema 新增 `full: z.boolean().optional()` 参数（向后兼容扩展）；更新 `incremental`、`force`、`full`、`mode` 四个字段的 `.describe()` 文案（见 contracts/mcp-batch-schema.md）
  - 文件: `src/mcp/server.ts`

### Step 2.3：checkpoint × regen 交互修复（FR-016/EC-007）

**目标 User Stories**: US4  
**覆盖 FR**: FR-016

- [x] T019 `[US4]` 修改 `src/batch/batch-orchestrator.ts`（checkpoint 加载阶段 `:612-637`）：`regenPlan.full === true` 时调用 `completedPaths.clear()`，丢弃已加载的 checkpoint completed state，防止 full 路径被残留 checkpoint 绕过（C-3 修订：加载时清空，不在 processOneModule 内"忽略"）
  - 文件: `src/batch/batch-orchestrator.ts`

- [x] T020 `[US4]` 修改 `src/batch/batch-orchestrator.ts` 的 `processOneModule` 函数（`:711` 附近）：将 target 计算（`resolveSourceTarget` 调用）前移到 checkpoint 判定之前；增量 resume 时若 checkpoint 已完成模块在本轮 delta 中命中变更（`regenerateTargets.has(moduleSourceTarget)`），则使 checkpoint 失效并重跑（FR-016 第二部分）
  - 文件: `src/batch/batch-orchestrator.ts`

- [x] T021 `[US4]` 修改 `src/batch/batch-orchestrator.ts`（**W-2 修订：去掉 [P]，与 T019/T020 同文件且共享 regen/checkpoint 上下文，须串行**）：在 full 路径（`regenPlan.full === true`）入口处打一条可观测日志（W-1 取舍：`[regen] full regeneration (source=${regenPlan.source})`），替代原有被合并掉的 `fallbackReason='force-enabled'` 信号
  - 文件: `src/batch/batch-orchestrator.ts`

### Step 2.4：normalizeGraphForWrite 完整实现 + inputHash 稳定化（FR-006/FR-007）

**目标 User Stories**: US3  
**覆盖 FR**: FR-006, FR-007

- [x] T022 `[US3]` 修改 `src/panoramic/graph/graph-builder.ts`：将 T003 的占位实现替换为完整的 `normalizeGraphForWrite` 实现，包含：(a) `options?.stripTimestamps` 时剥除顶层 `generatedAt`；(b) nodes 按 `id` 字典序排序（in-place）；(c) links 按 `source + target + relation` 三元组字典序排序（in-place）；(d) hyperedges（若有）按 `id` 字典序排序（in-place）
  - 文件: `src/panoramic/graph/graph-builder.ts`

- [x] T023 `[US3]` 修改 `src/panoramic/graph/graph-builder.ts`（`buildKnowledgeGraph` 的 `inputHash` 计算段 `:412-425`）：实现 `stripVolatileFields`（深拷贝并移除 `generatedAt` 等非确定性字段，保留全部语义内容）和 `stableStringify`（key 有序 JSON.stringify）；将原 `hashParts.push(dg.generatedAt)` 替换为 `hashParts.push(\`docGraph:${sha256(stableStringify(stripVolatileFields(dg)))}\`)`（FR-006/C-1 修订：保留内容敏感性，禁用 count 替代）
  - 文件: `src/panoramic/graph/graph-builder.ts`

- [x] T024 `[US3]` 修改 `src/batch/batch-orchestrator.ts`：在社区分析完成后、`writeKnowledgeGraph` 调用前，插入 `normalizeGraphForWrite(graphJson)` 调用（归一化面覆盖全部追加边后的完整 graphJson）（FR-007 要求调用在 batch 追加 semantic edges 之后）
  - 文件: `src/batch/batch-orchestrator.ts`

### Step 2.5：孤儿 spec 删除 + ownership 边界（FR-017/EC-009）

**目标 User Stories**: US3  
**覆盖 FR**: FR-017, EC-009

- [x] T025 `[US3]` 修改 `src/panoramic/builders/doc-graph-builder.ts`（**C1 修订：StoredModuleSpecSummary 定义在 `:32`、scanStoredModuleSpecs 在 `:123`、frontmatter 读取在 `:387-398`/`:485-542`，均在此文件，非 spec-store.ts**）：将 `generatedByMode` 字段纳入 `StoredModuleSpecSummary` 接口（`extractStoredModuleSpecSummary` + `scanStoredModuleSpecs` 读取并传递）；新增 `isBatchGenerated(summary): boolean` 判定函数 = **`summary.generatedByMode != null`**（**C2 修订：不能用 `generatedBy`——`generateFrontmatter`（`src/generator/frontmatter.ts:93-98`）对所有 spectra 生成的 spec 都写 `generatedBy`，会把单文件 generate 产物也误判为 batch 产物；batch 特有标记是 `generatedByMode`，由 runBatch 写入 `batch-orchestrator.ts:792-794`**）。`isBatchGenerated` 可放 doc-graph-builder.ts 或 spec-store.ts，导出供 T026 使用
  - 文件: `src/panoramic/builders/doc-graph-builder.ts`（+ 可选 `src/spec-store/spec-store.ts` 导出 helper）

- [x] T026 `[US3]` 修改 `src/batch/batch-orchestrator.ts`：在所有模块处理完成后、构建 `SpecStore` 处新增孤儿删除逻辑：(a) `const orphans = specStore.orphanSpecs()`；(b) 对每个 orphan，先 `isBatchGenerated(orphan)`（必要条件1：`generatedByMode != null`），再 `isInManagedOutputDir(absPath, modulesDir)`（必要条件2），两者均满足才删除；(c) 删除前打 `logger.info('[orphan-cleanup] 删除孤儿 spec: ...')` 日志；(d) `isInManagedOutputDir` 辅助函数（**C3 修订：用 `path.relative` 防目录穿越，禁用字符串 startsWith——否则 `specs/modules-old/...` sibling 会被误判**）：`const rel = path.relative(modulesDir, path.resolve(absPath)); return !rel.startsWith('..') && !path.isAbsolute(rel) && absPath.endsWith('.spec.md')`，其中 `modulesDir` 取自 `src/panoramic/output-filenames.ts:49-52` 的常量
  - 文件: `src/batch/batch-orchestrator.ts`

### Step 2.6：resolveSourceTarget 接入 DeltaRegenerator（FR-019）

**目标 User Stories**: US1  
**覆盖 FR**: FR-019

- [x] T027 `[US1]` 修改 `src/batch/delta-regenerator.ts`（`collectCurrentSnapshots` 方法 `:217-244`）：将 `group.dirPath` 的内联 target 计算替换为调用 `resolveSourceTarget(group, conflictingDirPaths, isRoot)`（从 `src/batch/regen-plan.ts` 导入），消除与 `processOneModule` 的 target 口径错位（FR-019）
  - 文件: `src/batch/delta-regenerator.ts`

- [x] T028 `[US1]` 修改 `src/batch/batch-orchestrator.ts`（`processOneModule` 函数）：将内联的 target 计算替换为调用 `resolveSourceTarget(group, conflictingDirPaths, isRoot)`（FR-019 共享函数统一口径）；确认此调用已在 T020 中前移到 checkpoint 判定之前
  - 文件: `src/batch/batch-orchestrator.ts`

### Step 2.7：baseline-collect 脚本显式全量（FR-014/OQ-4）

**覆盖 FR**: FR-014

- [x] T029 修改 `scripts/baseline-collect.mjs`（`runBatchAndCapture` 函数 `:431-448`）：在 args 数组中追加 `'--full'` flag，使"基线永远全量"自文档化，与清理逻辑解耦（OQ-4 决议：防御性加入，防止将来清理逻辑变更导致基线失真）；同步更新 dry-run 校验路径（`:486`）
  - 文件: `scripts/baseline-collect.mjs`

**Checkpoint — Phase 2 完成标准**:
- [x] T030 运行 `npx vitest run`，确认所有 T008 ~ T011 的 RED 测试全部变为 GREEN，N_baseline 个存量测试零失败
- [x] T031 [P] 运行 `npm run build`，确认 TypeScript 零错误（类型契约变更：`runBatch` options 新增 `full?`, CLICommand 新增 `full?`，MCP schema 新增 `full` 参数）

---

## Phase 3：[REFACTOR] — 整理与验收

**目的**: 确认三入口接入完整、消除临时注释、补全帮助文案、评估 eval 脚本影响、全量验收。

**Git commit 建议**: `refactor(175): [REFACTOR] 接入确认 + 帮助文案 + 全量验收（零失败）`

### 接入完整性确认

- [x] T032 审查 `src/batch/batch-orchestrator.ts`：确认 `:388` 原 `incremental = false` 硬编码已完全移除；确认三处入口（CLI/MCP/runBatch 直调）均通过 `resolveRegenPlan` 获得默认值，无遗漏漂移点
  - 文件: `src/batch/batch-orchestrator.ts`

- [x] T033 [P] 审查 `src/batch/delta-regenerator.ts`：确认 `resolveSourceTarget` 被 `DeltaRegenerator.collectCurrentSnapshots` 调用（T027 完成），target 口径与 `processOneModule` 一致（FR-019 最终验证）
  - 文件: `src/batch/delta-regenerator.ts`

### 帮助文案与可观测性

- [x] T034 审查 `src/cli/index.ts`（真实 help 输出处 `:37-43`/`:87-98`）+ `src/cli/utils/parse-args.ts`：确认 `--help` 文案中 `--full`（regen 轴）与 `--mode full`（质量维度）的描述各自独立，无语义重叠（见 contracts/cli-flags-contract.md 的 help 模板）；`--force` 标注为别名；`--mode` 描述明确与 regen 轴正交
  - 文件: `src/cli/index.ts`, `src/cli/utils/parse-args.ts`

- [x] T035 [P] 清理 Phase 0 在 `src/batch/regen-plan.ts` 和 `src/panoramic/graph/graph-builder.ts` 中遗留的临时注释（标注"Phase 0 行为不变"的注释），更新为正式实现说明
  - 文件: `src/batch/regen-plan.ts`, `src/panoramic/graph/graph-builder.ts`

### eval 脚本评估记录

- [x] T036 审查 `scripts/eval-task-runner.mjs`：确认调用方式（`spectra batch --mode code-only`，未传 incremental），翻转后走 DeltaRegenerator，但 eval worktree 为临时目录/新 clone 无历史 spec → DeltaRegenerator 退化全量（EC-006 路径），行为等效。**无需修改**，记录此评估结论为注释或 commit message（OQ-2/OQ-4 决议）
  - 文件: `scripts/eval-task-runner.mjs`（只读审查，不改动）

### 全量验收

- [x] T037 运行 `npx vitest run`（含新 E2E `tests/e2e/feature-175-batch-incremental.e2e.test.ts` 和全部单测），确认：(a) 所有测试零失败；(b) `tests/e2e/batch-pipeline.e2e.test.ts`（存量 E2E）无回归；(c) 新增测试覆盖 FR-018 的 BFS 传播独立断言（非同义反复断言）
  - 验收指令: `npx vitest run`

- [x] T038 [P] 运行 `npm run build`，确认零 TypeScript 编译错误（含新增类型 `RegenPlan`、`RegenPlanInput`、`RegenPlanSource`、`StoredModuleSpecSummary.generatedByMode` 扩展、MCP schema `full` 参数）
  - 验收指令: `npm run build`

- [x] T039 [P] 运行 `npm run repo:check`，确认仓库级同步检查零错误（release contract、plugin metadata、shared helper 同步链路不受影响）
  - 验收指令: `npm run repo:check`

---

## FR 覆盖映射表

> 19 条 FR 全覆盖（含 FR-015 Out of Scope 记录）

| FR | 描述摘要 | 覆盖 Task | Phase |
|----|---------|----------|-------|
| FR-001 | 默认走增量路径 | T013 | GREEN |
| FR-002 | 三入口默认值归一化 | T013, T014, T015, T016 | GREEN |
| FR-003 | 显式全量逃生口 | T017, T018 | GREEN |
| FR-004 | regen 轴与 BatchMode 参数解析正交 | T017, T034 | GREEN/REFACTOR |
| FR-005 | 增量路径未受影响模块 mtime 不变 | T008-场景1+2（含 mtime 快照断言，W-1）| RED/GREEN |
| FR-006 | graph.json 全部时间戳来源归一化（含 inputHash 嵌套时间戳）| T022, T023 | GREEN |
| FR-007 | 写盘边界 nodes/links 确定性排序（semantic edges 追加后）| T022, T024 | GREEN |
| FR-008 | 无改动时模块级 generateSpec 调用次数 = 0 | T008-场景2 (E2E) | RED/GREEN |
| FR-009 | 新 E2E 测试覆盖增量核心路径（git init + vi.mock 范式）| T008 | RED/GREEN |
| FR-010 | 不引入现有 N_baseline 测试回归 | T006, T012, T030, T037 | 全阶段验收 |
| FR-011 | force 优先级高于 incremental（同时传入时）| T009, T013 | RED/GREEN |
| FR-012 | 首次运行（无历史 spec）时增量退化全量，不报错 | T008-场景9（专属可测，断言 mode=full + fallbackReason=no-existing-specs）| RED/GREEN |
| FR-013 | generatedByMode 缺失或 mode 切换时强制 cache miss | T008-场景4 | RED/GREEN |
| FR-014 | baseline-collect.mjs 支持显式全量 flag | T029 | GREEN |
| FR-015 | task D（F156 snapshot 复用）Out of Scope，不实现 | — | Out of Scope |
| FR-016 | full/force 不被残留 checkpoint 绕过 | T019, T020, T008-场景3,6 | GREEN/RED |
| FR-017 | 增量产物文件集与全量一致（孤儿删除 + ownership 边界）| T025, T026, T008-场景5 | GREEN/RED |
| FR-018 | BFS 依赖传播独立断言（预期 target 集合比对，非同义反复）| T008-场景1,8, T011 | RED/GREEN |
| FR-019 | DeltaRegenerator 与 runBatch 的 target 口径一致 | T002, T004, T027, T028, T008-场景7 | CLEANUP/GREEN/RED |

**EC/SC 覆盖**：

| EC/SC | 覆盖 Task |
|-------|----------|
| EC-001 force+incremental 优先级 | T009, T013 |
| EC-002 旧 spec 无 generatedByMode → cache miss | T008-场景4 |
| EC-003 mode 切换 → cache miss | T008-场景4 |
| EC-007 checkpoint × force 交互 | T008-场景6, T019, T020 |
| EC-008 源文件删除后增量文件集收敛 | T008-场景5 |
| EC-009 孤儿删除 ownership 边界（无元数据手写 spec 不删）| T008-场景5, T025, T026 |
| SC-001 受影响模块 generateSpec 调用数 == regenerateTargets.size | T008-场景1 |
| SC-002 无改动时模块级 generateSpec = 0 | T008-场景2 |
| SC-003 byte-stable deepEqual（去时间戳后）| T011, T022, T023, T024 |
| SC-004 三入口默认 incremental=true | T009, T013, T014, T015, T016 |
| SC-005 显式全量时 checkpoint 不绕过全量语义 | T008-场景3,6, T019 |
| SC-006 N_baseline 测试零失败 + build + repo:check 零错误 | T006, T012, T030, T037-T039 |
| SC-007 E2E 覆盖 9 个场景（含 ownership 边界）| T008 |

---

## 依赖关系与并行说明

### Phase 依赖

```
Phase 0 [CLEANUP] → Phase 1 [RED] → Phase 2 [GREEN] → Phase 3 [REFACTOR]
```

Phase 之间严格串行（TDD M7 强制顺序）：
- Phase 1 依赖 Phase 0（T003 的 `normalizeGraphForWrite` 占位导出为 T011 E2E mock 奠基）
- Phase 2 依赖 Phase 1（RED 测试必须先存在，GREEN 才有目标）
- Phase 3 依赖 Phase 2（所有功能完成后才整理）

### Phase 0 内部并行

| 可并行组 | Tasks |
|---------|-------|
| 组 A（核心模块新建）| T001, T002（同文件，实际串行）|
| 组 B（graph 归一化占位）| T003（独立于 A，可并行）|
| 组 C（单测）| T004, T005（可并行，各自独立文件）|
| 组 D（验收）| T006, T007（可并行）|

### Phase 1 内部并行

| 可并行组 | Tasks |
|---------|-------|
| 组 A（E2E 主体）| T008（单一大文件，内部 9 场景顺序编写）|
| 组 B（单测补充）| T009, T010, T011（各自独立文件，可并行）|
| 组 C（验收）| T012 |

### Phase 2 内部顺序

Step 2.1（T013-T016）→ Step 2.2（T017-T018）→ Step 2.3（T019-T021）→ Step 2.4（T022-T024）→ Step 2.5（T025-T026）→ Step 2.6（T027-T028）→ Step 2.7（T029）

**Step 内部可并行**:
- T017 和 T018（parse-args.ts 与 server.ts，不同文件）
- T014 和 T015（batch.ts 与 server.ts 的 resolveRegenPlan 接入，不同文件）
- T019、T020、T021（均在 batch-orchestrator.ts，**全部串行**，无并行）
- T022 和 T023（同文件 graph-builder.ts，实际串行）
- T025 和 T026（doc-graph-builder.ts 与 batch-orchestrator.ts，不同文件，可并行）
- T027 和 T028（delta-regenerator.ts 与 batch-orchestrator.ts，不同文件，可并行）

### Phase 3 内部并行

| 可并行组 | Tasks |
|---------|-------|
| 组 A（审查）| T032, T033, T034（各自不同文件）|
| 组 B（清理）| T035（独立）|
| 组 C（评估记录）| T036（只读，可与任意组并行）|
| 组 D（验收）| T037, T038, T039（可并行启动，须全部通过）|

---

## Git Commit 规范（按 Phase）

| Phase | Commit 模板 | 包含 Tasks |
|-------|-----------|----------|
| Phase 0 | `chore(175): [CLEANUP] 提取 resolveRegenPlan + normalizeGraphForWrite 纯函数（零产物变更）` | T001-T007 |
| Phase 1 | `test(175): [RED] E2E + 单测先行（9 场景 RED，N_baseline GREEN）` | T008-T012 |
| Phase 2 | `feat(175): [GREEN] 默认翻转 + --full + byte-stable + 孤儿删除（FR-001-019 GREEN）` | T013-T031 |
| Phase 3 | `refactor(175): [REFACTOR] 接入确认 + 帮助文案 + 全量验收（零失败）` | T032-T039 |

---

## 实施建议

### MVP First（最小可验证增量）

1. 完成 Phase 0（T001-T007）→ 确认 N_baseline 测试 + 新单测通过，graph.json 逐字节不变
2. 完成 Phase 1（T008-T012）→ 确认 RED 测试存在，存量 GREEN
3. 完成 Phase 2 Step 2.1（T013-T016）→ 默认翻转接入，US1/US2/US5 核心路径变绿
4. **STOP and VALIDATE**：运行 T030/T031 中间检查点，US1/US2 场景应已变绿
5. 继续完成 Phase 2 剩余步骤（Step 2.2-2.7）
6. 完成 Phase 3（T032-T039）→ 全量验收

### 高风险模块（优先手动审查）

- `src/batch/batch-orchestrator.ts`（LOC 2095，4 处改动：T016/T019/T020/T021/T024/T026/T028）：建议实现前整体读取一次，确认 `:388`、`:612-637`、`:711`、`:1365-1367` 的现有代码结构
- `src/panoramic/graph/graph-builder.ts`（T022/T023）：`inputHash` 计算逻辑改动影响 cache 失效判断，须保证 C-1 修订要求（保留内容敏感性，禁止用 count 替代）
