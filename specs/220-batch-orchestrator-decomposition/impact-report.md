# F220 影响分析报告 — batch-orchestrator.ts 有边界拆分

**Feature**: 220-batch-orchestrator-decomposition
**目标文件**: `src/batch/batch-orchestrator.ts`（2580 行，`runBatch` 416–1918 ≈ 1503 行）
**里程碑**: M9 轨道 D（架构收口）
**基线 commit**: f7bd643（= origin/master，worktree clean）
**成功标准**: 行为不漂移（M9 原文：不以"文件变短"为成功）

---

## 1. 绿基线（拆分前，作为零漂移参照）

| 检查 | 结果 |
|------|------|
| `npm run build`（tsc） | ✅ exit 0 |
| `npx vitest run` | 460 文件通过 / 5396 test 通过 / 4 文件 skip / 18 skip + 21 todo；**1 文件失败** |
| 失败项定性 | `tests/integration/graph-quality-adversarial.test.ts` — `runCLI(['graph-quality'…])` 满载下 stdout 为空 → `JSON.parse` 抛 `SyntaxError: Unexpected end of JSON input`。**隔离重跑 19/19 全绿**，属已知 load-flaky（同 `cli-e2e --version 满载 flaky` 病根），**非回归、非本文件相关** |

**结论**：有效绿基线 = 5397 用例真实通过、0 真实失败。拆分后任何**新增**失败即视为回归。

---

## 2. 导出契约（14 个符号 — 拆分后必须逐字保留，双向差集为空）

`batch-orchestrator.ts` 当前对外导出面（`grep -nE "^export "`）：

| # | 符号 | 类型 | 归属 stage |
|---|------|------|-----------|
| 1 | `BatchOptions` | interface | （公共类型，facade 保留） |
| 2 | `BatchResult` | interface | （公共类型，facade 保留） |
| 3 | `mergeGraphsForTopologicalSort` | function | ② graph-assembly |
| 4 | `detectCrossLanguageRefs` | function | ② graph-assembly |
| 5 | `normalizeConcurrency` | function | ③ generation-scheduling |
| 6 | `generateCrossLanguageHint` | function | ② graph-assembly |
| 7 | `runBatch` | async function | 编排入口（facade 保留） |
| 8 | `buildDesignDocAbsPaths` | function | ① source-discovery |
| 9 | `PY_SKELETON_IGNORE_DIRS` | const Set | ① source-discovery |
| 10 | `collectPythonCodeSkeletons` | async function | ① source-discovery |
| 11 | `TSJS_SKELETON_IGNORE_DIRS` | const Set | ① source-discovery |
| 12 | `collectTsJsCodeSkeletons` | async function | ① source-discovery |
| 13 | `GraphOnlyResult` | interface | ② graph-assembly |
| 14 | `buildAstGraphOnly` | async function | ② graph-assembly（F195 graph-only 入口） |

**内部 helper（9 个，非导出）**：`logger`、`upsertCompletedModule`、`recordFailedModule`、`isInManagedOutputDir`、`buildGraphForLanguageGroup`、`buildFallbackGraph`、`collectMdRecursive`、`walkPyFiles`、`walkTsJsFiles`。

---

## 3. 消费者面（导入 `.../batch-orchestrator.js` 的文件）

> **Codex W3 修正（Phase 2 审查后）**：手写清单不完整。以命令 `grep -rlE "batch-orchestrator(\.js)?['\"]" src tests scripts` 生成的完整清单为准 → **41 个文件**（4 src[含 src 内 test] + 36 tests + 1 scripts），全文见 `consumer-manifest.txt`。下方手写节保留作分类说明；导出面保障以 G3 合同测试 + typecheck:tests 为准，不依赖清单枚举。

**策略含义**：只要 facade（`batch-orchestrator.ts`）继续 re-export 上述 14 符号，所有下列导入路径**零改动**。这是零漂移最稳妥路线。

### 3.1 源码消费者（3 个）
| 文件 | 导入符号 |
|------|---------|
| `src/mcp/server.ts` | `runBatch`, `buildAstGraphOnly` |
| `src/cli/commands/batch.ts` | `runBatch`, `buildAstGraphOnly` |
| `src/cli/commands/watch.ts` | `runBatch` |

### 3.2 测试消费者（27 个，按导入符号）
- `runBatch`：`batch-orchestrator-retry` / 多个 `tests/integration/batch-*`（product-ux-docs, doc-bundle-orchestration, incremental-cache, interface-surface, doc-graph, paths, singlelang, panoramic-doc-suite, coverage-report, incremental）/ e2e
- `buildAstGraphOnly`：`tests/batch/graph-only-pipeline`, `graph-only-cli`
- `collectTsJsCodeSkeletons`：`batch-orchestrator-tsjs-resolve`, `181-import-resolver-consolidation`
- `collectPythonCodeSkeletons`：`batch-orchestrator-python-resolve`（经 `batch-orchestrator.test`/`gitignore` 聚合导入）
- `PY_SKELETON_IGNORE_DIRS` / `TSJS_SKELETON_IGNORE_DIRS`：`ignore-oracle.test`
- `buildDesignDocAbsPaths`：`design-doc-paths.test`
- `mergeGraphsForTopologicalSort`：`multilang-batch`
- `normalizeConcurrency`：`concurrency-normalization`
- `BatchResult` / `BatchOptions`（type）：`description-output-drift`, `batch-orchestrator-incremental`, `feature-175-batch-incremental.e2e`
- 聚合导入 `{ … }`：`batch-orchestrator.test`, `batch-orchestrator-gitignore.test`, `graph-equivalence-matrix`

---

## 4. Spectra dogfooding 证据（依赖面验证）

### 4.1 god-nodes（确认拆分优先级）
| 节点 | degree | callSites |
|------|--------|-----------|
| `batch-orchestrator.ts`（模块） | 64 | 638 — **全仓最高模块枢纽** |
| `runBatch`（符号） | 49 | — |
| `batch-project-docs.ts`（模块） | 35 | 155 — **#2 模块枢纽** |

（任务书记录 degree 48/634；图重建后为 64/638，量级一致。）

### 4.2 `impact(buildAstGraphOnly, downstream, depth=1)` — 五段切分的关键接缝验证

`buildAstGraphOnly`（Stage ② graph-assembly）的直接被调：
- `collectPythonCodeSkeletons`（**同文件 → Stage ①**）
- `collectTsJsCodeSkeletons`（**同文件 → Stage ①**）
- `collectGenericLanguageCodeSkeletons`（已在 `generic-language-skeleton-collector.ts`）
- `buildUnifiedGraph`（`knowledge-graph/index.ts`）
- `resolveSourceCommit`（`panoramic/graph/source-commit.ts`）

**关键结论**：Stage ② → Stage ① 是天然有向边（graph-assembly 依赖 source-discovery 的 skeleton 采集器），且 skeleton 采集器被 `buildAstGraphOnly`（Stage ②）与 `runBatch`（Stage ①）共用 → 采集器落 Stage ①、Stage ② import Stage ①，**单向无环**。这正是任务要求"拆前用 impact 验证五段切分依赖面"的证据。

---

## 5. 五段职责边界（M9 doc §6）与 runBatch 内部步骤映射

`runBatch` 内部以 `步骤 1..8` 组织，映射到五段：

| Stage | 职责 | 归属符号 | runBatch 区段（步骤） |
|-------|------|---------|---------------------|
| ① source-discovery | 文件/语言采集、skeleton、design-doc 路径 | `collectPythonCodeSkeletons`+`walkPyFiles`+`PY_SKELETON_IGNORE_DIRS`、`collectTsJsCodeSkeletons`+`walkTsJsFiles`+`TSJS_SKELETON_IGNORE_DIRS`、`buildDesignDocAbsPaths`+`collectMdRecursive` | 步骤1 扫描(462)、步骤1.5 语言分组(469) |
| ② graph-assembly | 依赖图构建/合并、graph-only | `mergeGraphsForTopologicalSort`、`detectCrossLanguageRefs`、`generateCrossLanguageHint`、`buildGraphForLanguageGroup`、`buildFallbackGraph`、`buildAstGraphOnly`+`GraphOnlyResult` | 步骤1.6 选主图(488)、步骤1.7 合并拓扑(496) |
| ③ generation-scheduling | 并发调度、模块级生成循环 | `normalizeConcurrency` | 步骤4 处理(716)、步骤4 p-limit 调度(1105) |
| ④ checkpoint / incremental-state | 检查点、completed/failed 状态机、孤儿判定 | `upsertCompletedModule`、`recordFailedModule`、`isInManagedOutputDir` | 步骤3 检查点(660)、步骤8 清理(1889) |
| ⑤ artifact-writing / reporting | 索引、summary log、README、graph 写盘、html | （runBatch 内联，暂无独立符号） | 步骤5 索引(1150)、步骤6 索引/摘要(1721/1853)、步骤7 README(1862) |

**难点定性**：Stage ①②④的 leaf helper 已是独立函数（纯 re-home，零行为漂移风险最低）；Stage ③⑤ 深织于 `runBatch` 巨函数体、共享大量局部状态，提取需谨慎（见 refactor-plan 的分批策略与 byte-stable 门）。

---

## 6. 回归护栏（六代守护逐一点名）

| 护栏 | 不变量 | 拆分时的守法 |
|------|--------|-------------|
| **零漂移（唯一成功标准）** | full/incremental/graph-only 三 mode 输出合同、byte-stable（连跑两次逐字节相等）、checkpoint 恢复 | 每批后跑三 mode E2E + byte-stable diff |
| **F182** 增量三护栏 | delta-regenerator / regen-plan / batch-orchestrator 状态机行为逐字不变 | `upsertCompletedModule`/`recordFailedModule` 提取为 checkpoint-state 模块，签名与语义逐字保留；纯同步不引入 await |
| **F183** | `normalizeGraphForWrite` 写盘出口 | 写盘链在 Stage ⑤，保持调用序不变 |
| **F193** | portable 守卫 + id 相对化 | graph write 出口不动 |
| **F195** | `buildAstGraphOnly` 零 LLM 路径 + 全部测试 | 该函数整体搬入 graph-assembly，import 采集器，行为逐字不变 |
| **F214** | 三层合同 + graph assembly 接缝 | Stage ② 边界与 canonical id 逻辑不动 |
| **F217** | 六指标图质量门 | 拆分后 `graph-quality` 全绿（graph-only 链重建后跑） |

**registry 复用**：优先 `ProjectContext`/`GeneratorRegistry`/`ParserRegistry`/`AbstractRegistry`/`AbstractConfigParser`，不建平行 registry；walker/scanner 复用既有 `createGitignoreFilter`/`scanFiles` shared helper。

---

## 7. batch-project-docs.ts（#2 枢纽）处置决策

图自析 #2 枢纽 `src/panoramic/batch-project-docs.ts`（805 行 / degree 35 / 155 callSites）不在原 M9 §6 五段 scope 内。

**决策：本 Feature 显式 defer，不同拆。** 理由：
1. **scope 纪律**：M9 §6 明确五段边界针对 `batch-orchestrator.ts`；batch-project-docs 属 panoramic 文档生成子系统，职责域不同，同拆会把两个独立枢纽的验证面叠加（违反"大范围改动不塞当前 Milestone"）。
2. **风险隔离**：本 Feature 的零漂移门（三 mode byte-stable）已覆盖 batch-orchestrator；再叠 batch-project-docs 会显著扩大 byte-stable 回归面，降低单批可验证性。
3. **无阻塞**：batch-project-docs 拆分不是 batch-orchestrator 拆分的前置；两者解耦。

→ 建议作为 **M9/M10 follow-up Feature** 独立立项（记入本报告，plan 阶段复述）。

---

## 8. 交付边界

- 与 **F219 并行 disjoint**：不碰 `scripts/spec-drift` / `repo:check` 检查族定义。
- `specs/src.spec.md` 排除出 commit（自动再生产物）。
- baseline:diff reproducibility：graph-only 链零 LLM 免费跑（micrograd/nanoGPT）；full 链涉 LLM 成本，plan 阶段定抽验策略。
