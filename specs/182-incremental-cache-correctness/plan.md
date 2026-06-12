# 修复规划 — Feature 182 增量缓存正确性

v2 — Codex 对抗审查（3 CRITICAL / 3 WARNING）修订版

**分支**: `claude/nice-goldberg-388b0b` | **日期**: 2026-06-12 | **诊断报告**: fix-report.md

## 摘要

本次修复针对 F175 batch 增量再生成链的 4 项正确性缺陷，全部集中在 `src/batch/` + `src/core/` + `src/panoramic/` 3 个相邻模块，不涉及产品对外契约变更。修复原则：**最小必要改动，单点权威，覆盖 5 个修复面**。v2 相对 v1 核心变更：新建模块移至 `src/core/`（消除 batch→core 反向依赖）；hash 公式拆两层（combineSkeletonHashes 纯函数 + computeModuleSkeletonHash wrapper）；写侧复用已有 skeletons 不二次 analyzeFiles；sourceTarget 保持纯路径不变、新增 `sourceTargetKey` 字段做 cache key 持久化；修复 `:518` forceRegenerate 的加载时序；E2E 禁 mock generateSpec（消除假绿结构）。

---

## Codebase Reality Check

| 文件 | LOC | 修改点 | 已知 debt |
|------|-----|--------|----------|
| `src/batch/batch-orchestrator.ts` | 2191 | `:518/:519` 改 `let`；约 `:648` 注入 OR 逻辑；`:904/:950` replace 语义（upsertCompletedModule / recordFailedModule）；`:912` targetPath 继续用纯路径 moduleSourceTarget；新增 moduleCacheKey 查询逻辑；`:925` frontmatter 装饰 sourceTargetKey | 体量最大，改动点分散于多处不相邻位置，改后必须全量回归 |
| `src/batch/delta-regenerator.ts` | 352 | `:259` 删本地 `computeSkeletonHash`，改调 `computeModuleSkeletonHash`（from `src/core/skeleton-hash.js`）；`collectCurrentSnapshots` snapshot.sourceTarget 改存 `buildSpecCacheKey(...)`；`detectDirectChanges` storedByTarget Map 键改用 `stored.sourceTargetKey ?? stored.sourceTarget` | — |
| `src/batch/regen-plan.ts` | 105 | 新增 `buildSpecCacheKey` helper；`resolveSourceTarget` 签名与返回值完全不变（纯路径） | 小文件，改动 self-contained |
| `src/core/single-spec-orchestrator.ts` | 1090 | `GenerateSpecOptions` 加可选 `files?: string[]`（绝对路径）；`prepareContext` 有 files 时跳过 scanFiles；`:678` `skeletonHash` 写值改调 `combineSkeletonHashes`（复用已有 skeletons，不二次 analyzeFiles） | — |
| `src/batch/module-grouper.ts` | — | `ModuleGroup` 加 `languageSplit?: boolean`；多语言拆分分支设置 true，单语言目录不设 | — |
| `src/panoramic/builders/doc-graph-builder.ts` | — | `StoredModuleSpecSummary` 加可选 `sourceTargetKey` 字段；`scanStoredModuleSpecs`（`:133`）解析该字段 | — |
| `src/core/skeleton-hash.ts` | 新建 ~60 行 | 导出 `combineSkeletonHashes`（纯函数）+ `computeModuleSkeletonHash`（wrapper） | — |
| `tests/unit/delta-regenerator-mode.test.ts` | — | `:256` 删 `computeHashFor` 私有复刻，改 import `computeModuleSkeletonHash`（from `src/core/skeleton-hash.js`） | 假绿根因——已确认修复 |
| `tests/integration/batch-incremental-cache.test.ts` | 新建 | 新增场景 A/B E2E，禁 mock generateSpec，仅 mock LLM 边界 | — |

> batch-orchestrator.ts LOC > 500 且新增 < 50 行（均为小改），不触发前置 cleanup 规则。

---

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件数 | 7（含 1 新建：`src/core/skeleton-hash.ts`）|
| 间接受影响（调用方） | batch-orchestrator 调用 regen-plan / delta-regenerator / single-spec-orchestrator；doc-graph-builder 消费 StoredModuleSpecSummary——均已在直接修改范围内 |
| 跨包影响 | `src/batch/` + `src/core/` + `src/panoramic/`，3 个目录均属同一 `src/` 包，无跨顶层边界（新模块在 core 层，batch→core 依赖方向不变） |
| 数据迁移 | hash 公式变更一次性失效存量缓存（触发一轮全量，非 schema 迁移）；旧 spec 无 sourceTargetKey 字段时混语言目录两组首轮各 miss 一次自愈，单语言目录键完全不变零额外失效 |
| API / 契约变更 | `prepareContext` / `generateSpec` 新增**可选** `files` 参数（向后兼容）；`resolveSourceTarget` 签名与返回值**完全不变**（纯路径）；新导出 `combineSkeletonHashes` / `computeModuleSkeletonHash`（新文件无存量消费方，零破坏）；`buildSpecCacheKey` 为 batch 内部 helper，不对外暴露 |
| **风险等级** | **LOW**（影响文件 7 个，无跨顶层包，无 schema 迁移，可选参数向后兼容）|

---

## Constitution Check

| 原则 | 评估 |
|------|------|
| III. YAGNI / 奥卡姆剃刀 | 合规。`skeleton-hash.ts` 是消除重复实现的最小必要抽象（写侧 + 读侧两处同逻辑）；`buildSpecCacheKey` 是单点 cache key 派生 helper，无过度封装；`sourceTargetToPath` helper 整体废弃（v1 已含，v2 不做），减少不必要引入 |
| V. AST 精确性优先 | 合规。hash 仍基于 AST 分析产物（skeleton hash），写侧复用 prepareContext 已有 skeletons 无二次分析，读侧通过 wrapper 重析——两侧公式由 `combineSkeletonHashes` 单点保证一致 |
| VII. 只读安全性 | 合规。本次修复不引入新写操作，仅修正增量缓存判断逻辑；`sourceTargetKey` 字段仅在 languageSplit 组的既有 frontmatter 装饰点追加，非新写路径 |
| XIII. 向后兼容 | 合规。`files` 参数可选，单文件 CLI `generate` 不传时行为不变；`resolveSourceTarget` 返回值保持纯路径，panoramic 路径前缀匹配 / endsWith 匹配 / spec-store orphan 判定**零改动**；旧 spec 无 sourceTargetKey 自愈迁移 |

---

## 变更清单（5 个修复面）

### 修复面 1 — 新建共享 hash 函数（`src/core/skeleton-hash.ts`）

**目的**：消灭写侧 `mergeSkeletons.hash`（按上游 scanFiles 排序）与读侧 `computeSkeletonHash`（按 localeCompare 重排）之间的公式分叉。新模块放 `src/core/` 中性层位，batch→core 依赖方向不变，消除 v1 的 core 反向 import batch 问题。

**改动**：
- 新建 `src/core/skeleton-hash.ts`，拆两层导出：

  ```ts
  // 层 1：唯一权威 hash 合并公式（纯函数）
  export function combineSkeletonHashes(
    entries: Array<{ sortKey: string; hash: string }>,
  ): string
  ```
  - entries.length === 1 时直接返回该 hash（兼容现行单文件语义）
  - 否则：按 sortKey 做确定性 code-unit 比较（`<`/`>` 逐 char code，**禁 localeCompare**）排序 → join hash → sha256
  - 设计注记：hash 值只依赖 skeleton hash 集合与排序，sortKey 本身不进 hash；同一文件集下任意公共祖先作 relative base 排序结果不变（code-unit 比较公共前缀不影响序），故写侧（cwd-relative）与读侧（projectRoot-relative）顺序一致

  ```ts
  // 层 2：便捷 wrapper（供读侧 delta-regenerator 与测试使用）
  export async function computeModuleSkeletonHash(
    projectRoot: string,
    files: string[],   // 项目相对 POSIX 路径
  ): Promise<string | undefined>
  ```
  - 内部实现：`analyzeFiles` → 构建 entries（sortKey = POSIX 化的项目相对路径）→ 调 `combineSkeletonHashes`

**写侧（single-spec-orchestrator）不调用 wrapper**：复用 `prepareContext` 已有的 skeletons，构建 entries（sortKey = `path.relative(projectRoot ?? cwd, skeleton.filePath)` 的 POSIX 化结果）后直接调 `combineSkeletonHashes`——不二次 `analyzeFiles`，消除 2× AST 性能回归。

### 修复面 2 — `prepareContext` / `generateSpec` 加 `files` 注入参数（`src/core/single-spec-orchestrator.ts`）

**目的**：batch 路径注入 `group.files`（语言限定子集），替代目录重扫（全部语言），消除文件集来源不同导致的 hash 分叉，同时解决混语言双倍付费问题。

**改动**：
- `GenerateSpecOptions` 加可选 `files?: string[]`（绝对路径）
- `prepareContext`：有 `options.files` 时跳过 `scanFiles`，直接用注入文件列表；否则保持 `scanFiles` 现行路径（向后兼容）
- `:678` `skeletonHash` 写值：由 `mergedSkeleton.hash` 改为复用已有 skeletons 构建 entries 后调 `combineSkeletonHashes`（不调带 analyzeFiles 的 wrapper，不二次 AST 分析）
- batch-orchestrator 非 root 调用 `generateSpec` 时注入 `{ files: group.files.map(absolutePath) }`；root per-file 调用不变

### 修复面 3 — `buildSpecCacheKey` + `languageSplit` 标记 + `sourceTargetKey` 持久化

**目的**：修复同目录多语言组 Map 键碰撞；明确拆分 cache key 与 frontmatter 路径两个语义，零改动 panoramic / spec-store 消费方。

**核心反转**：frontmatter `sourceTarget` **保持纯路径不变**（generateSpec `:674` 由 targetPath 自行派生，天然纯路径）——panoramic（cross-reference-index.ts:207 路径前缀匹配 / component-view-builder.ts:264 endsWith 匹配）、spec-store.ts:127 orphan 判定、所有展示层**零改动**；v1 的 `sourceTargetToPath` helper **整体废弃不做**。

**改动**：

- `module-grouper.ts`：`ModuleGroup` 加 `languageSplit?: boolean`；多语言拆分分支设置 `true`，单语言目录不设——替代 v1 的 `group.name` `--lang` 后缀嗅探，避免目录字面名含 `--python` 误判

- `regen-plan.ts` 新增纯 helper：
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

- `resolveSourceTarget` 签名与返回值**完全不变**（纯路径）

- **cache key 应用点**（key 语义只存在于 `src/batch/` 内，已验证 DeltaReport / regenerateTargets 无 batch 外消费者）：
  - `delta-regenerator collectCurrentSnapshots`：`snapshot.sourceTarget` 字段改存 `buildSpecCacheKey(...)`（root per-file snapshot 维持纯文件路径，不加后缀）
  - `delta-regenerator detectDirectChanges`：storedByTarget Map 键 = `stored.sourceTargetKey ?? stored.sourceTarget`
  - `batch-orchestrator processOneModule`：新增 `moduleCacheKey = buildSpecCacheKey(moduleSourceTarget, group)`；`regenerateTargets.has` / `storedSpecByTarget.get` / `existingVersion` 查询全用 `moduleCacheKey`；`targetPath`（`:912`）与 frontmatter 继续用纯路径 `moduleSourceTarget`
  - `batch-orchestrator storedSpecByTarget` Map 构建：键 = `stored.sourceTargetKey ?? stored.sourceTarget`

- **key 持久化**：batch `:925` 既有 frontmatter 装饰点（isMultiLang 分支，装饰后 `:1176` re-render 落盘——已验证该链路真实写盘）对 `languageSplit` 组追加 `(frontmatter as any).sourceTargetKey = moduleCacheKey`；非 split 组不写该字段

- **解析侧**：`doc-graph-builder.ts:133` 的 `scanStoredModuleSpecs` 给 `StoredModuleSpecSummary` 加可选 `sourceTargetKey?: string` 字段并解析

- **迁移语义**：旧 spec 无 `sourceTargetKey` → 混语言目录两组首轮各 miss 一次重生成（自愈，与 hash 公式失效同批）；单语言目录键完全不变零额外失效

### 修复面 4 — checkpoint replace 语义（`src/batch/batch-orchestrator.ts`）

**目的**：消除 fall-through 重跑路径下 completedModules 双记，以及 completed / failed 交叉污染。

**改动**：抽小型同步 helper，替代裸 filter-then-push：

- `upsertCompletedModule(state, entry)`：同步段内先剔 `completedModules` + `failedModules` 中同名旧条目，再 push 到 `completedModules`
- `recordFailedModule(state, entry)`：先剔 `failedModules` + `completedModules` 中同名旧条目，再 push 到 `failedModules`
- 注明：JS 单线程下同步段不被 pLimit 并发交错，helper 防未来插入 `await` 后语义退化

### 修复面 5 — forceRegenerate full-resume 时序（`src/batch/batch-orchestrator.ts`）

**目的**：resume 时读取 checkpoint 的 `forceRegenerate` 字段，恢复中断 full 的意图，消除静默降级。同时修复 v1 的 `:518` 提前读 state 时序问题（state 在 checkpoint 加载后才赋值）。

**改动**：
- `:518/:519` 的 `forceFullRegeneration` / `shouldUseIncrementalPlan` 改 `let`（从 `const`）
- OR 注入点移到 checkpoint 加载 + full 清空块之后（约 `:648` `const isResume = state !== null;` 处）：
  ```ts
  if (isResume && state.forceRegenerate && !forceFullRegeneration) {
    forceFullRegeneration = true;
    shouldUseIncrementalPlan = false;
    logger.info('[resume] 检测到中断的 full run，剩余模块继续全量');
  }
  ```
- 已验证两变量消费点全在 `processOneModule` 内（`:760/:773/:774/:787/:788`，均在加载后）→ 时序安全
- `regenPlan.full` 的清空逻辑（`:634-:646`）不受影响（其条件用 `regenPlan.full` 而非 `forceFullRegeneration`，故 full-resume 不清 completed——这正是 resume 语义）

---

## 回归护栏

### 新增 E2E（`tests/integration/batch-incremental-cache.test.ts`）

**测试必须走真实写侧产物 vs 读侧判定对账，禁止 mock `single-spec-orchestrator` / `generateSpec`**（现有 batch-incremental.test.ts:15 的 `vi.mock` 模式会让写侧公式不被执行，复现假绿结构）。**只在 LLM 边界 mock**（callLLM / llm client 模块层），让真实 `prepareContext → combineSkeletonHashes → frontmatter → 写盘` 链路跑通。

**场景 A — 混合大小写文件名 + 单语言**：
```
用户故事: 含 PascalCase 组件文件的目录增量第二轮零重生成
```
- 目录含 `src/components/Button.ts` + `src/components/input.ts`（大小写混排）
- 第一轮 runBatch 完成，记录写侧落盘 skeletonHash（从 spec frontmatter 读取，不是自算）
- 文件内容不改，第二轮 runBatch 增量
- 断言：LLM mock 调用次数第二轮 = 0（零重生成）+ spec 文件内容不变

**场景 B — 混语言目录（.py + .ts 同目录）增量第二轮零重生成**：
```
用户故事: 同目录 Python + TypeScript 混语言增量第二轮各语言组各零重生成
```
- 目录含 `src/utils/helper.ts` + `src/utils/helper.py`
- **首轮断言**：language-split 产出 2 份 spec 且各自仅分析本语言文件（files 注入生效）
- 两组（languageSplit=true）各自完成第一轮
- 内容不改，第二轮增量
- 断言：两组均 skip（LLM mock 第二轮调用次数 = 0）+ spec 文件内容不变

### 删除假绿测试 helper

`tests/unit/delta-regenerator-mode.test.ts:256` 的 `computeHashFor` 函数（私有复刻了读侧 `localeCompare` 公式）：
- 删除该函数定义
- 改 `import { computeModuleSkeletonHash } from '../../src/core/skeleton-hash.js'`
- 所有引用点替换为 `computeModuleSkeletonHash`
- 现有 8 个测试场景维持不变（函数签名兼容）

### graph.json byte-stable gate 零回归

现有 F179/F180 的 byte-stable 测试覆盖 graph.json 输出不变性。本次修复不触碰 graph 生成路径，预期零回归，须在 `npx vitest run` 全量通过验证。

---

## 验证方案

1. `npx vitest run` — 全量零失败（含 8 个 mode-aware 场景 + 新增 E2E 场景 A/B）
2. `npm run build` — TypeScript 零错误（重点：`files` 可选参数类型；`combineSkeletonHashes` 导出；`buildSpecCacheKey` 类型；`languageSplit` 字段；`sourceTargetKey` 可选字段）
3. `npm run repo:check` — 同步链路零报警
4. 手动验证（smoke test）：在 micrograd baseline 跑一轮增量（第二轮 skip 率 100% 且无 full 降级）

---

## 不做清单

| 排除项 | 理由 |
|--------|------|
| 存量 spec 迁移脚本 | hash / sourceTargetKey 格式变更属一次性失效（触发全量重生成），无需迁移旧数据（R8：仅靠 release note + 既有 delta full-fallback 日志说明） |
| `resolveSourceTarget` 签名 / 返回值变更 | 保持纯路径，签名 `(group, conflictingDirPaths, isRoot)` 不变，panoramic / spec-store 调用方零改动 |
| `sourceTargetToPath` helper | 整体废弃不做——frontmatter 保持纯路径天然无需剥后缀 |
| checkpoint 格式 schema 版本升 | `sourceTargetKey` 字段为可选，旧 checkpoint 向后兼容，无 schema 不兼容 |
| panoramic / spec-store.ts 改动 | sourceTarget 保持纯路径，两者零改动 |
| F186 npm 重发 | 属独立 Feature，本修复完成 + verify 通过后 F186 可无阻解封 |
| batch-orchestrator 大规模重构 | 本次仅外科手术式改动，不追求 fix 模式以外的重构 |

---

## release note 草案（一句话）

> `v4.3.x`：修复增量缓存 4 项正确性缺陷（hash 公式分叉 / 混语言碰撞 / checkpoint 重复条目 / full 静默降级）；升级后存量 `skeletonHash` 与 `sourceTargetKey` 一次性失效，首次 batch 增量将触发全量重生成，属预期行为，无需迁移脚本。

---

## Phase 3 审查修订（v2.1）

Codex 对抗审查 + 主编排器复核后，在 Phase 3 实现之上追加 3 项修复与 2 项「不修」确认：

- **修复 1（目录级 languageSplit spec 文件名碰撞，W4 升级，M8-SC-001 必需）**：generateSpec 的 outputPath 原由 `basename(targetPath)` 派生 → 同目录 ts 组与 py 组（sourceTarget 均为 dirPath）写同一 `<dir>.spec.md` 互相覆盖，存量只保住一组 sourceTargetKey，另一组每轮增量 miss。新增 `GenerateSpecOptions.outputFileName`，batch 非 root 调用点仅在 `group.languageSplit` 时传 `${moduleName}.spec.md`（如 utils--ts-js.spec.md），落盘名与 batch 的 `${moduleName}.spec.md` specPath 期望对齐；root per-file 调用与非拆分组不传，命名零变化。
- **修复 2（sourceTargetKey 改为首写入盘，W3）**：原 :975 post-mutation 依赖 doc-graph re-render 落盘，晚于 checkpoint save → 崩溃窗口内下轮多余重生。新增 `GenerateSpecOptions.sourceTargetKey` + `FrontmatterInput.sourceTargetKey`，generateFrontmatter 首写即落字段；删除 post-mutation 块，in-memory frontmatter 由返回值自然带上。
- **修复 3（E2E 补目录级真实碰撞，W4 测试缺口）**：场景 B 断言改 split 组路径为 `utils--ts-js.spec.md` / `utils--python.spec.md`（sourceTargetKey 值不变）；新增场景 C「同目录多文件混语言（目录级分组）」—— `src/utils/` 下 service.ts + extra.ts（ts 组 2 文件 → 目录级）+ worker.py（py 组单文件但非 conflictingDirPaths → 同样目录级），两组共享纯路径 `src/utils`，仅靠 cache key `::ts-js` / `::python` 消歧，验证两 spec 共存 + 第二轮零 LLM 调用 + 逐字节不变。

**审查确认的 2 个不修项**：

- (a) `scanPyFiles` 不解析 `.gitignore` 属 python-adapter 既有缺陷（F175 起 module graph 与读侧 hash 即含这些文件）；若在注入处过滤会重新引入读写文件集分叉，单点修 scanPyFiles 留独立 fix。
- (b) delta propagation fallback（`resolveSpecForSource` 返回纯路径键）仅在文件不属任何当前 module group 时触发，正常 batch 不可达，留观察。
