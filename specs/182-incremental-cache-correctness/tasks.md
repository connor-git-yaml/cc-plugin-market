# Tasks: Feature 182 — 增量缓存正确性修复

**模式**: fix（快速问题修复，单人顺序执行为主，独立文件可并行）
**依据**: `specs/182-incremental-cache-correctness/plan.md` v2 + `fix-report.md`
**分支**: `claude/nice-goldberg-388b0b`
**日期**: 2026-06-12

---

## 修复面覆盖索引

| 修复面 | 描述 | 任务 |
|--------|------|------|
| F1 | 新建共享 hash 函数 `src/core/skeleton-hash.ts`（双层导出）+ 单元测试 | T001, T002 |
| F2 | `prepareContext`/`generateSpec` 加可选 `files` 注入参数；写侧复用 skeletons 直调 `combineSkeletonHashes`（不二次 analyzeFiles） | T003 |
| F3a | `ModuleGroup.languageSplit` 标记（module-grouper.ts） | T004 |
| F3b | `buildSpecCacheKey` helper（regen-plan.ts） | T005 |
| F3c | 三处 key 应用点 + `:925` 装饰点持久化 `sourceTargetKey`（delta-regenerator.ts + batch-orchestrator.ts） | T006 |
| F3d | `doc-graph-builder.ts` 解析 `sourceTargetKey` 字段 | T007 |
| F4 | checkpoint replace 语义（`upsertCompletedModule` / `recordFailedModule` 同步 helper，completed/failed 互斥去重） | T008 |
| F5 | `forceRegenerate` full-resume 时序修复（改 `let` + OR 注入点后移至 `:648`）+ info 日志 | T009 |
| 测试清理 | 删除 `delta-regenerator-mode.test.ts` 中 `computeHashFor` 私有复刻，改 import `src/core/skeleton-hash.js` | T010 |
| E2E-A | 新建 `tests/integration/batch-incremental-cache.test.ts`，场景 A：混合大小写第二轮零重生成 | T011 |
| E2E-B | 同文件场景 B：混语言 .py+.ts 首轮 2 份 spec + 第二轮零重生成 | T012 |
| 回归护栏 | 全量 vitest / build / repo:check | T013 |
| 文档 | release note 草案 | T014 |

---

## Phase 1: 基础 — 新建共享 hash 函数（阻塞后续所有修复面）

**目的**: 消灭写侧与读侧 hash 公式分叉的根源。新模块放 `src/core/` 中性层位（v2 关键变更：非 `src/batch/`），batch→core 依赖方向不变，消除 v1 的 core 反向 import batch 问题。建立单一权威实现供 F2/F3/测试清理复用。

**完成标志**: `src/core/skeleton-hash.ts` 存在并导出 `combineSkeletonHashes`（纯函数）与 `computeModuleSkeletonHash`（wrapper）；对应单元测试全绿。

- [x] T001 新建 `src/core/skeleton-hash.ts`，实现双层导出：
  - **层 1（纯函数）**：`export function combineSkeletonHashes(entries: Array<{ sortKey: string; hash: string }>): string`
    - entries.length === 1 时直接返回 `entries[0].hash`（兼容单文件语义，不经 sha256）
    - 否则：按 `sortKey` 做 code-unit 逐字符比较（`<`/`>` charCode，**禁 `localeCompare`**）排序 → `hashes.join('')` → `sha256`
    - sortKey 本身不进 hash（设计注记：任意公共祖先作 relative base，code-unit 排序不变）
  - **层 2（wrapper）**：`export async function computeModuleSkeletonHash(projectRoot: string, files: string[]): Promise<string | undefined>`
    - 内部：`analyzeFiles` → 构建 entries（sortKey = POSIX 化的项目相对路径）→ 调 `combineSkeletonHashes`
  - **文件**: `src/core/skeleton-hash.ts`（新建，~60 行）
  - **验证**: `npm run build` 无类型错误；T002 单元测试通过

- [x] T002 新建 `tests/unit/skeleton-hash.test.ts`，覆盖以下场景：
  - (a) 单文件直接返回原始 hash（不经 sha256 二次处理）
  - (b) code-unit 顺序 vs localeCompare 顺序差异用例：`['Button.ts', 'input.ts']`——code-unit 下 `B`(66) < `i`(105) 故 Button 排前，localeCompare 下 `b` > `i` 顺序相反；两公式 hash 值不同，`combineSkeletonHashes` 使用 code-unit 结果
  - (c) 混合大小写确定性：相同文件集不同传入顺序产生相同 hash（排序幂等性）
  - (d) 单文件特例：`computeModuleSkeletonHash` wrapper 层单文件返回与分析产物一致
  - **文件**: `tests/unit/skeleton-hash.test.ts`（新建）
  - **验证**: `npx vitest run tests/unit/skeleton-hash.test.ts` 全绿

---

## Phase 2: 修复面 F2 — `prepareContext`/`generateSpec` 注入 `files` 参数

**依赖**: T001（`combineSkeletonHashes` 已导出）

**目的**: batch 路径注入 `group.files` 语言限定子集，替代目录重扫；写侧 `skeletonHash` 落盘复用已有 skeletons 直接调 `combineSkeletonHashes`（不调 wrapper，不二次 `analyzeFiles`，消除 2× AST 性能回归）。

**完成标志**: `GenerateSpecOptions` 含可选 `files?` 字段；batch-orchestrator 调用时注入；现有 CLI 单文件 `generate` 不传时行为不变（向后兼容）。

- [x] T003 修改 `src/core/single-spec-orchestrator.ts` 与 `src/batch/batch-orchestrator.ts`：
  - `GenerateSpecOptions`（或等价接口）新增可选字段 `files?: string[]`（绝对路径列表）
  - `prepareContext` 附近：`if (options.files)` → 跳过 `scanFiles`，直接用注入文件列表；否则维持 `scanFiles` 现行路径
  - `:678` `skeletonHash` 写值：由 `mergedSkeleton.hash` 改为**复用已有 skeletons**，构建 entries（`sortKey = path.posix.relative(projectRoot ?? cwd, skeleton.filePath)` 的 POSIX 化结果）后直接调 `combineSkeletonHashes`——**不调** `computeModuleSkeletonHash` wrapper，不二次 `analyzeFiles`
  - `batch-orchestrator.ts` 调用 `generateSpec` 的非 root 路径注入 `{ files: group.files.map(f => absolutePath(f)) }`；root per-file 调用不变
  - **文件**: `src/core/single-spec-orchestrator.ts`，`src/batch/batch-orchestrator.ts`
  - **验证**: `npm run build` 无类型错误；现有 single-spec 相关 vitest 通过

---

## Phase 3: 修复面 F3 — `languageSplit` 标记 + `buildSpecCacheKey` + key 应用与持久化

**依赖**: T004、T005 为独立文件，可与 T003 并行；T006 依赖 T004+T005 完成且 batch-orchestrator.ts 须在 T003 后串行；T007 完全独立

**目的**: 修复同目录多语言组 Map 键碰撞；分离 cache key（含语言后缀）与 frontmatter 路径（纯路径）两个语义；`resolveSourceTarget` 签名与返回值**完全不变**（纯路径）；`sourceTarget` frontmatter 保持纯路径不变；panoramic / spec-store **零改动**（v1 的 `sourceTargetToPath` helper 整体废弃不做）。

**完成标志**: 同目录 .ts + .py 两组 cache key 不碰撞；`sourceTargetKey` 字段持久化到 languageSplit 组 spec frontmatter；`scanStoredModuleSpecs` 解析该字段。

- [x] T004 [P] 修改 `src/batch/module-grouper.ts`：
  - `ModuleGroup` 类型加 `languageSplit?: boolean`
  - 多语言拆分分支（生成多个 group 的路径）设置 `languageSplit: true`；单语言目录不设该字段（替代 v1 的 `group.name` `--lang` 后缀嗅探，避免目录字面名含 `--python` 误判）
  - **文件**: `src/batch/module-grouper.ts`
  - **验证**: `npm run build` 无类型错误；现有 module-grouper 相关测试通过

- [x] T005 [P] 修改 `src/batch/regen-plan.ts`，新增纯 helper：
  ```ts
  export function buildSpecCacheKey(
    sourceTarget: string,
    group: Pick<ModuleGroup, 'language' | 'languageSplit'>,
  ): string {
    return group.languageSplit && group.language
      ? `${sourceTarget}::${group.language}`
      : sourceTarget;
  }
  ```
  - `resolveSourceTarget` 签名与返回值**完全不变**（纯路径，不加任何后缀）
  - **文件**: `src/batch/regen-plan.ts`
  - **验证**: `npm run build` 无错误

- [x] T006 修改 `src/batch/delta-regenerator.ts` 与 `src/batch/batch-orchestrator.ts`，应用 `buildSpecCacheKey` 三处 + 一处持久化：
  - **`delta-regenerator.ts`**：
    - `:259` 删本地 `computeSkeletonHash` 私有复刻，改调 `computeModuleSkeletonHash`（from `../../core/skeleton-hash.js`）
    - `collectCurrentSnapshots`：`snapshot.sourceTarget` 字段改存 `buildSpecCacheKey(resolveSourceTarget(...), group)`（root per-file snapshot 维持纯文件路径，不加后缀）
    - `detectDirectChanges`：`storedByTarget` Map 键 = `stored.sourceTargetKey ?? stored.sourceTarget`
  - **`batch-orchestrator.ts`**：
    - `processOneModule` 新增 `const moduleCacheKey = buildSpecCacheKey(moduleSourceTarget, group)`
    - `regenerateTargets.has` / `storedSpecByTarget.get` / `existingVersion` 查询全用 `moduleCacheKey`
    - `:912` `targetPath` 与 frontmatter 继续用纯路径 `moduleSourceTarget`（不变）
    - `storedSpecByTarget` Map 构建：键 = `stored.sourceTargetKey ?? stored.sourceTarget`
    - `:925` 既有 frontmatter 装饰点（isMultiLang 分支）对 `languageSplit` 组追加 `(frontmatter as any).sourceTargetKey = moduleCacheKey`；非 split 组不写该字段
  - **文件**: `src/batch/delta-regenerator.ts`，`src/batch/batch-orchestrator.ts`
  - **依赖**: T004（`languageSplit` 字段存在）、T005（`buildSpecCacheKey` 导出存在）、T003（batch-orchestrator.ts 修改先后顺序）
  - **验证**: `npm run build` 无错误；delta-regenerator 相关 vitest 通过

- [x] T007 [P] 修改 `src/panoramic/builders/doc-graph-builder.ts`：
  - `StoredModuleSpecSummary` 类型加可选 `sourceTargetKey?: string` 字段
  - `scanStoredModuleSpecs`（`:133` 附近）解析 frontmatter 中该字段并赋值
  - **文件**: `src/panoramic/builders/doc-graph-builder.ts`
  - **依赖**: 无（独立字段扩展，可与 T004/T005 并行）
  - **验证**: `npm run build` 无类型错误；doc-graph-builder 相关测试通过

---

## Phase 4: 修复面 F4 — checkpoint replace 语义

**依赖**: T003、T006 先完成（同一文件 `batch-orchestrator.ts`，避免合并冲突）

**目的**: 消除 fall-through 重跑路径下 `completedModules` 双记及 completed/failed 交叉污染。

**完成标志**: 同一 module 在 checkpoint 中最多出现一次；completed 与 failed 集合互斥。

- [x] T008 修改 `src/batch/batch-orchestrator.ts`，抽两个同步 helper（替代裸 filter-then-push）：
  - `upsertCompletedModule(state, entry)`：先剔 `state.completedModules` + `state.failedModules` 中同名旧条目，再 push 到 `completedModules`
  - `recordFailedModule(state, entry)`：先剔 `state.failedModules` + `state.completedModules` 中同名旧条目，再 push 到 `failedModules`
  - `:904`（根模块成功）、`:950`（非根成功）改用 `upsertCompletedModule`；失败 catch 路径改用 `recordFailedModule`
  - 注：JS 单线程下同步段不被 pLimit 并发交错，helper 同时防未来插入 `await` 后语义退化
  - **文件**: `src/batch/batch-orchestrator.ts`
  - **验证**: `npx vitest run` 相关 batch checkpoint 测试通过

---

## Phase 5: 修复面 F5 — `forceRegenerate` full-resume 时序修复

**依赖**: T008 完成（同文件 `batch-orchestrator.ts`，避免冲突）

**目的**: 修复 `:518` 提前读 state 的时序问题（v1 遗留：state 在 checkpoint 加载后才赋值，`const` 声明导致无法后续修正）；resume 时从 checkpoint 恢复 `forceRegenerate` 意图，消除中断 full run 静默降级为增量。

**完成标志**: 中断的 `--full` 重新 resume 时剩余模块走全量；info 日志可见。

- [x] T009 修改 `src/batch/batch-orchestrator.ts`：
  - `:518/:519` 的 `forceFullRegeneration` / `shouldUseIncrementalPlan` 声明由 `const` 改为 `let`
  - OR 注入点移到 checkpoint 加载 + full 清空块之后（约 `:648`，`const isResume = state !== null;` 所在区块）：
    ```ts
    if (isResume && state.forceRegenerate && !forceFullRegeneration) {
      forceFullRegeneration = true;
      shouldUseIncrementalPlan = false;
      logger.info('[resume] 检测到中断的 full run，剩余模块继续全量');
    }
    ```
  - 确认两变量消费点全在 `processOneModule` 内（`:760/:773/:774/:787/:788`，均在加载后），时序安全
  - `regenPlan.full` 清空逻辑（`:634-:646`）不受影响（其条件用 `regenPlan.full` 而非 `forceFullRegeneration`，full-resume 不清 completed——正是 resume 语义）
  - **文件**: `src/batch/batch-orchestrator.ts`
  - **验证**: `npm run build` 无错误；字段 `:660` 写入逻辑保持不变（字段不再是 dead field）

---

## Phase 6: 测试清理 — 删除假绿 `computeHashFor` 私有复刻

**依赖**: T001 完成（`computeModuleSkeletonHash` 在 `src/core/skeleton-hash.ts` 已可 import）

**目的**: 消除测试中复刻读侧 `localeCompare` 公式的假绿根源，统一测试与生产使用同一实现。

**完成标志**: `delta-regenerator-mode.test.ts` 中无 `computeHashFor` 定义；所有引用点改用 `computeModuleSkeletonHash`；原有 8 个测试场景维持通过。

- [x] T010 修改 `tests/unit/delta-regenerator-mode.test.ts`：
  - 删除 `:256` 处 `computeHashFor` 函数定义（约 15 行，复刻了 localeCompare 公式）
  - 文件顶部加 `import { computeModuleSkeletonHash } from '../../src/core/skeleton-hash.js'`（v2 路径 `src/core/`，非 v1 的 `src/batch/`）
  - 将文件内所有 `computeHashFor(...)` 调用替换为 `computeModuleSkeletonHash(...)`（签名兼容：均为 `(projectRoot, files)`）
  - **文件**: `tests/unit/delta-regenerator-mode.test.ts`
  - **验证**: `npx vitest run tests/unit/delta-regenerator-mode.test.ts` 8 个场景全绿

---

## Phase 7: E2E 回归护栏 — 混合大小写 + 混语言增量第二轮零重生成

**依赖**: T001–T010 全部完成（E2E 覆盖所有修复面联合效果）

**目的**: 用真实写侧产物对账读侧判定。**新建独立文件**（非追加到现有 `batch-incremental.test.ts`，现有文件用 `vi.mock generateSpec` 会让写侧公式不被执行，制造假绿）。**仅 mock LLM 边界**（callLLM / llm client 模块层），不 mock `generateSpec` / `single-spec-orchestrator`。

**完成标志**: 场景 A、B 均通过（第二轮 LLM mock 调用次数 = 0）。

- [x] T011 新建 `tests/integration/batch-incremental-cache.test.ts`，实现场景 A：
  ```
  用户故事: 含 PascalCase 组件文件的目录增量第二轮零重生成
  ```
  - 目录含 `src/components/Button.ts` + `src/components/input.ts`（大小写混排，code-unit 序 `B`(66)<`i`(105) vs localeCompare `b`>`i` 结果不同）
  - 仅 mock LLM 边界，不 mock `generateSpec`
  - 第一轮 `runBatch` 完成，从落盘 spec frontmatter 读取 `skeletonHash`（不自算，验证写侧真实落盘）
  - 文件内容不改，第二轮 `runBatch` 增量
  - 断言：第二轮 LLM mock 调用次数 = 0（零重生成）+ spec 文件内容不变
  - **文件**: `tests/integration/batch-incremental-cache.test.ts`（新建）
  - **验证**: `npx vitest run tests/integration/batch-incremental-cache.test.ts` 场景 A 通过

- [x] T012 在 `tests/integration/batch-incremental-cache.test.ts` 追加场景 B（同文件顺序写入）：
  ```
  用户故事: 同目录 Python + TypeScript 混语言增量第二轮各语言组各零重生成
  ```
  - 目录含 `src/utils/helper.ts` + `src/utils/helper.py`（同目录双语言，language-split 两组，`languageSplit: true`）
  - 仅 mock LLM 边界，不 mock `generateSpec`
  - **首轮断言**：language-split 产出 2 份 spec 且各自仅分析本语言文件（files 注入生效，.ts 组不含 .py 文件）
  - 内容不改，第二轮增量
  - 断言：两组均 skip（LLM mock 第二轮调用次数 = 0）+ spec 文件内容不变
  - **文件**: `tests/integration/batch-incremental-cache.test.ts`（追加，与 T011 同文件）
  - **验证**: `npx vitest run tests/integration/batch-incremental-cache.test.ts` 场景 B 通过

---

## Phase 8: 全量回归 + release note 草案

**依赖**: T001–T012 全部完成

- [x] T013 执行全量回归验证：
  - `npx vitest run` — 全量零失败（含原有 8 个 mode-aware 场景 + 新增场景 A/B + T002 单元测试）
  - `npm run build` — TypeScript 零错误（重点：`files` 可选参数；双层导出 `combineSkeletonHashes`/`computeModuleSkeletonHash`；`buildSpecCacheKey` 类型；`languageSplit` 字段；`sourceTargetKey` 可选字段）
  - `npm run repo:check` — 同步链路零报警
  - 确认 F179/F180 graph byte-stable 相关测试零回归（本次不触碰 graph 生成路径）
  - **文件**: 无（验证命令）
  - **验证**: 三条命令均零失败/零报警

- [x] T014 [P] 新建 `specs/182-incremental-cache-correctness/release-note.md`（1-2 行）：
  > `v4.3.x`：修复增量缓存 4 项正确性缺陷（hash 公式分叉 / 混语言碰撞 / checkpoint 重复条目 / full 静默降级）；升级后存量 `skeletonHash` 与 `sourceTargetKey` 一次性失效，首次 batch 增量将触发全量重生成，属预期行为，无需迁移脚本。
  - **文件**: `specs/182-incremental-cache-correctness/release-note.md`（新建）
  - **验证**: 文件存在，内容与 plan.md v2 末尾"release note 草案"一致

---

## 依赖关系与执行顺序

### Phase 依赖链

```
T001 (src/core/skeleton-hash.ts) ──┬──> T002 (单元测试，可立即跑)
                                    ├──> T003 (写侧 combineSkeletonHashes，依赖导出)
                                    ├──> T006 (delta-regenerator 改 import core/skeleton-hash.js)
                                    └──> T010 (改 import 路径 src/core/skeleton-hash.js)

T004 (languageSplit 标记) ──┐
T005 (buildSpecCacheKey) ───┴──> T006 (三处 key 应用 + 持久化)
T007 (doc-graph-builder)          独立（可与 T004/T005/T003 并行）

T003 ─┐
T006 ─┘──> T008 (replace 语义，batch-orchestrator.ts 串行)
T008 ──> T009 (forceRegenerate 时序，batch-orchestrator.ts 串行)

T001–T010 全部完成 ──> T011 (场景 A)
T011 完成 ──> T012 (场景 B，同文件顺序追加)
T011 + T012 ──> T013 (全量回归)
T013 完成后 ──> commit
T014 可任意时刻并行完成
```

### 并行机会

| 并行组 | 条件 |
|--------|------|
| T002 可与 T003–T010 并行 | 测试独立文件，不依赖其他修复完成 |
| T004、T005、T007 可互相并行 | 各改不同文件（module-grouper.ts / regen-plan.ts / doc-graph-builder.ts） |
| T004+T005+T007 可与 T003 并行 | 与 single-spec-orchestrator.ts 改动无交叉 |
| T012 可紧接 T011 顺序写入 | 同文件不同场景，建议顺序写入避免冲突 |
| T014 可任意并行 | 纯文档，不影响代码 |

### 串行要求（同文件 `batch-orchestrator.ts` 改动顺序）

```
T003 → T006 → T008 → T009
```

1. T003：`generateSpec` 调用处注入 `files` 参数
2. T006：`moduleCacheKey` 计算 / `storedSpecByTarget` 键 / `:925` 装饰点 `sourceTargetKey`
3. T008：`:904`/`:950` upsertCompletedModule / recordFailedModule helper
4. T009：`:518` 改 `let` + `:648` OR 注入 + info 日志

---

## v1 → v2 关键差异说明（任务执行时需注意）

| 变更点 | v1（已废弃） | v2（当前权威） |
|--------|-------------|---------------|
| skeleton-hash 模块位置 | `src/batch/skeleton-hash.ts` | `src/core/skeleton-hash.ts`（消除 core 反向 import batch） |
| 导出结构 | 单函数 `computeModuleSkeletonHash` | 双层：`combineSkeletonHashes`（纯函数）+ `computeModuleSkeletonHash`（wrapper） |
| 写侧 hash 计算 | 调 `computeModuleSkeletonHash` wrapper（含 analyzeFiles） | 复用已有 skeletons 直调 `combineSkeletonHashes`（不二次 analyzeFiles） |
| 语言拆分标记方式 | `group.name` `--lang` 后缀嗅探 | `ModuleGroup.languageSplit` 显式字段 |
| cache key helper | 无（v1 改 `resolveSourceTarget` 返回值加后缀） | `buildSpecCacheKey` 独立 helper；`resolveSourceTarget` 签名与返回值完全不变 |
| sourceTarget frontmatter | v1 方案含糊 | **保持纯路径不变**；新增 `sourceTargetKey` 字段仅用于 cache key 持久化 |
| `sourceTargetToPath` helper | v1 需要（剥后缀） | **整体废弃不做**（frontmatter 纯路径天然无需剥后缀，panoramic/spec-store 零改动） |
| E2E 测试文件 | 追加到 `batch-incremental.test.ts`（有 vi.mock generateSpec 假绿风险） | **新建** `batch-incremental-cache.test.ts`（禁 mock generateSpec，仅 mock LLM 边界） |
| delta-regenerator-mode.test.ts import 路径 | `../../src/batch/skeleton-hash.js` | `../../src/core/skeleton-hash.js` |

---

## 任务统计

| 类别 | 任务数 | 文件 |
|------|--------|------|
| 新建源文件 | 1 | `src/core/skeleton-hash.ts` |
| 修改源文件 | 5 | `src/core/single-spec-orchestrator.ts`、`src/batch/batch-orchestrator.ts`、`src/batch/regen-plan.ts`、`src/batch/delta-regenerator.ts`、`src/batch/module-grouper.ts` |
| 修改 panoramic | 1 | `src/panoramic/builders/doc-graph-builder.ts` |
| 新建测试 | 2 | `tests/unit/skeleton-hash.test.ts`、`tests/integration/batch-incremental-cache.test.ts` |
| 修改测试 | 1 | `tests/unit/delta-regenerator-mode.test.ts` |
| 补充文档 | 1 | `specs/182-incremental-cache-correctness/release-note.md` |
| 验证任务 | 1 | —（命令行，无文件产物） |
| **总计** | **14 个任务** | 5 个修复面 + 测试清理 + E2E 场景 A/B + 回归护栏 + release note |

可并行比例：T002/T004/T005/T007/T014 共 5 个任务无前置依赖可立即并行；T011/T012 可在前序完成后并行写入（约 43%）。
