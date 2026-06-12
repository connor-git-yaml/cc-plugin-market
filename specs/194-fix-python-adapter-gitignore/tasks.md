---
feature: F194
title: "修复三处自写 walk 不遵循 .gitignore"
mode: fix
base_commit: 3925df5
created: 2026-06-13
---

# Tasks: F194 修复 scanPyFiles / walkPyFiles / walkTsJsFiles 不遵循 .gitignore

**输入制品**：
- `specs/194-fix-python-adapter-gitignore/fix-report.md`（诊断、根因、3 处同根因修复点）
- `specs/194-fix-python-adapter-gitignore/plan.md`（具体改法、验证方案）

**核心策略**：`src/utils/file-scanner.ts` 导出 `createGitignoreFilter` 工厂函数作为单一事实源，三处自写 walk 叠加接入（只叠加不替换，文件集单调收紧）。测试与实现在同一任务内完成（同一提交原则）。

---

## Phase 1：基础导出（前置依赖）

**目标**：将现有私有 `parseGitignore` 封装为可导出工厂函数，所有后续任务依赖此函数。

**验收标准**：`createGitignoreFilter` 可从外部 import；`scanFiles` 行为零变化；`tests/unit/file-scanner.test.ts` 全绿。

- [x] T001 在 `src/utils/file-scanner.ts` 中导出 `createGitignoreFilter(projectRoot: string): (relativePath: string) => boolean`，包装现有私有 `parseGitignore`，附中文 JSDoc；同时在 `tests/unit/file-scanner.test.ts` 中补一条冒烟测试（有 `.gitignore` → 命中路径返回 true，无 `.gitignore` → 始终返回 false）

  - 改动文件：`src/utils/file-scanner.ts`（+8 行），`tests/unit/file-scanner.test.ts`（+10 行）
  - 验收命令：`npx vitest run tests/unit/file-scanner.test.ts`

**Checkpoint**：T001 完成后 T002/T003/T004 可并行启动。

---

## Phase 2：三处 walk 接入 + 测试（依赖 T001）

**目标**：三条 walk 路径全部叠加 `.gitignore` 过滤层，消除 gitignored 文件污染 module graph / UnifiedGraph 的缺陷。每条 walk 对应一个任务，测试与实现同任务内完成。

### T002 — python-adapter.ts scanPyFiles 接入

**依赖**：T001

- [x] T002 在 `src/adapters/python-adapter.ts` 的 `scanPyFiles` 方法中接入 `createGitignoreFilter`：在方法入口构建过滤函数；目录递归前对相对路径（基准 `resolvedRoot`）调用过滤函数，命中则 `continue`（剪枝）；文件收集前同样过滤；保留现有 `ignoreNames.has(entry.name)` 与点前缀检查不变。同步在 `tests/adapters/python-adapter.test.ts` 中新增 `describe('scanPyFiles 遵循 .gitignore', ...)` 区块：

  | 用例 | 场景 | 预期（正负断言配对，防空结果假绿） |
  |------|------|------|
  | T-GITIGNORE-01 | `.gitignore` 含目录模式 `generated/` | 结果**含** keep 文件（如 `pkg/core.py`）且**不含** `generated/` 下文件 |
  | T-GITIGNORE-02 | `.gitignore` 含通配模式 `local_*.py` | 结果含 keep 文件且命中文件被跳过 |
  | T-GITIGNORE-03 | negation 最后匹配优先：`.gitignore` 为 `local_*.py` + `!local_important.py` 两行（单独 `!pattern` 是 no-op，参照 tests/unit/file-scanner.test.ts:76-82 写法）；子用例 `generated/` + `!generated/keep.py` | `local_important.py` 被包含、其余 `local_*.py` 被排除；子用例 `keep.py` 仍被剪掉（目录剪枝不放宽） |
  | T-GITIGNORE-04 | 无 `.gitignore` | 行为等同修复前（结果含全部非硬编码忽略文件，无回归） |

  fixture 用 `fs.mkdtempSync` 临时目录，mock `analyzeFile` 返回空 skeleton（避免 TreeSitter 依赖）。

  - 改动文件：`src/adapters/python-adapter.ts`（+12 行），`tests/adapters/python-adapter.test.ts`（+80 行）
  - 验收命令：`npx vitest run tests/adapters/python-adapter.test.ts`

### T003 — batch-orchestrator.ts walkPyFiles 接入

**依赖**：T001（与 T004 改同一组文件，**串行**执行；Codex Phase 2 审查 W4 撤销 [P] 标注）

- [x] T003 在 `src/batch/batch-orchestrator.ts` 的 `collectPythonCodeSkeletons` 函数中，于调用 `walkPyFiles` 前构建 `isGitignored = createGitignoreFilter(resolvedProjectRoot)`，将其通过闭包传入 `walkPyFiles`（修改 `walkPyFiles` 内部接受闭包捕获的 `isGitignored`，避免签名链传染）；walk 内层对目录与 `.py/.pyi` 文件各做一次相对路径过滤（基准 `resolvedRoot`）；保留 `PY_SKELETON_IGNORE_DIRS.has(entry.name)` 与点前缀检查不变。同步在 `tests/unit/batch-orchestrator-gitignore.test.ts`（新建文件）中新增以下测试：

  | 用例 | 场景 | 预期（正负断言配对——collect* 真实解析且单文件失败被吞，keep 正向断言防空 Map 假绿） |
  |------|------|------|
  | T-PY-GITIGNORE-01 | `.gitignore` 含 `generated/` 目录模式 | Map **含** keep 的 `.py`（正向）且不含该目录下 `.py/.pyi`（负向） |
  | T-PY-GITIGNORE-02 | `.gitignore` 含通配 `*.stub.py` | Map 含 keep 文件且命中文件不进 Map |
  | T-PY-GITIGNORE-03 | `generated/` + `!generated/keep.py`（Codex Phase 3 W2 补，锁定目录剪枝分支） | keep.py 仍被剪掉（目录剪枝优先于 negation） |

  fixture 用 `fs.mkdtempSync`，写入**真实可解析**的 `.py` 文件（如 `def f(): pass`），不 mock adapter——正向断言同时验证解析链路真实工作。

  - 改动文件：`src/batch/batch-orchestrator.ts`（+15 行），`tests/unit/batch-orchestrator-gitignore.test.ts`（新建，+60 行含 T003/T004 两组用例）
  - 验收命令：`npx vitest run tests/unit/batch-orchestrator-gitignore.test.ts`（运行 T-PY 组）

### T004 — batch-orchestrator.ts walkTsJsFiles 接入

**依赖**：T001 + T003（同文件追加，串行；可与 T003 合为一次编辑）

- [x] T004 在 `src/batch/batch-orchestrator.ts` 的 `collectTsJsCodeSkeletons` 函数中，于调用 `walkTsJsFiles` 前构建 `isGitignored = createGitignoreFilter(resolvedProjectRoot)`，闭包传入 `walkTsJsFiles`；walk 内层对目录与 `.ts/.tsx/.js/.jsx` 文件各做相对路径过滤；保留 `TSJS_SKELETON_IGNORE_DIRS.has(entry.name)` 与点前缀检查不变。同步在 `tests/unit/batch-orchestrator-gitignore.test.ts`（T003 已新建）中追加：

  | 用例 | 场景 | 预期（正负断言配对） |
  |------|------|------|
  | T-TSJS-GITIGNORE-01 | `.gitignore` 含 `generated/` | Map **含** keep 的 `.ts`（正向）且不含该目录下 `.ts/.tsx/.js`（负向） |
  | T-TSJS-GITIGNORE-02 | 无 `.gitignore` | 行为无回归（全部可解析文件都在 Map 中） |
  | T-TSJS-GITIGNORE-03 | `generated/` + `!generated/keep.ts`（Codex Phase 3 W2 补） | keep.ts 仍被剪掉（目录剪枝优先于 negation） |

  fixture 写入真实可解析的 `.ts` 文件（如 `export const x = 1`）。

  - 改动文件：`src/batch/batch-orchestrator.ts`（+15 行），`tests/unit/batch-orchestrator-gitignore.test.ts`（追加）
  - 验收命令：`npx vitest run tests/unit/batch-orchestrator-gitignore.test.ts`（运行 T-TSJS 组）

> **T003/T004 说明（W4 修订）**：两个任务改同一对文件（src + test），**不可并行**；推荐合为一次 batch-orchestrator.ts 编辑 + 一次测试文件编写。

**Checkpoint**：T002/T003/T004 全部完成后进入 Phase 3 验证。

---

## Phase 3：全量验证 + release-note（依赖 T001-T004）

**目标**：四层验证全部通过，完成用户可见的修复披露。

### T005 — 全量测试 + 构建 + 仓库一致性检查

**依赖**：T001-T004 全部完成

- [x] T005 执行以下验证步骤，记录每步结果，任意失败立即停止并回溯修复：

  **步骤 1 — 单元测试（针对性）**：
  ```bash
  npx vitest run tests/unit/file-scanner.test.ts
  npx vitest run tests/adapters/python-adapter.test.ts
  npx vitest run tests/unit/batch-orchestrator-gitignore.test.ts
  ```
  验收：T-GITIGNORE-01~04 / T-PY-GITIGNORE-01~02 / T-TSJS-GITIGNORE-01~02 全部 pass。

  **步骤 2 — 全量测试 + 构建**：
  ```bash
  npx vitest run
  npm run build
  npm run repo:check
  ```
  验收：零失败、零类型错误、仓库同步检查通过。

  **步骤 2.5 — 自动再生产物污染检查（Codex Phase 2 审查 I1）**：
  全量 vitest / E2E 会再生 `specs/src.spec.md` 等 self-dogfood 产物（参照 specs/175 verification-report 既有结论）。验证后执行 `git status`，对非本 fix 改动的自动再生文件执行 `git checkout --` 恢复；commit 时使用**显式路径** `git add`（禁止 `git add -A`）。

  **步骤 3 — before/after 文件集 diff（回归验证）**：
  ```bash
  node specs/194-fix-python-adapter-gitignore/verification/capture-py-graph.mjs micrograd
  node specs/194-fix-python-adapter-gitignore/verification/capture-py-graph.mjs nanoGPT
  node specs/194-fix-python-adapter-gitignore/verification/capture-collect-paths.mjs self-dogfood
  ```
  对比 `verification/before-*.json` 与 after 捕获结果：
  - micrograd / nanoGPT：预期零差异（fix-report 已评估 gitignore 命中零）；若有 diff 逐项解释
  - self-dogfood collectXxx 路径：若有 diff，逐项确认均为 `.gitignore` 中有明确规则的文件；若出现无法解释的 diff，升级为 blocker 回溯排查

  **步骤 4 — 合成项目复现转正**：
  ```bash
  # 重建 /tmp/f193-repro 并用 fix 后代码验证
  # 预期：moduleCount 3 → 1（只含 pkg/core.py，generated/auto_stub.py 与 local_scratch.py 被过滤）
  ```
  验收：`moduleSources` 仅含 `pkg/core.py`，目录模式与通配模式均生效。

  - 改动文件：无（纯验证步骤）
  - 产出：验证结果记录（inline 在 commit message 或临时笔记中）

### T006 — 撰写 release-note.md

**依赖**：T005 全部通过

- [x] T006 在 `specs/194-fix-python-adapter-gitignore/release-note.md` 中撰写修复披露，必须覆盖：

  1. **修复内容摘要**：三处自写 walk（`scanPyFiles` / `walkPyFiles` / `walkTsJsFiles`）叠加接入 `.gitignore` 规则，消除 gitignored 文件污染 module graph、增量 skeletonHash 口径与 UnifiedGraph 节点的缺陷
  2. **影响范围**：含 gitignored `.py` / `.pyi` / `.ts` / `.tsx` / `.js` / `.jsx` 文件的项目；纯硬编码集覆盖（如 `__pycache__` / `node_modules`）的项目不受影响
  3. **升级后预期行为**：含 gitignored 源文件的 Python 项目首轮触发全量重生成（module graph / skeletonHash 口径收紧），属预期行为，无数据丢失；UnifiedGraph（graph.json）口径同步收紧（`graph_query` / `impact` 结果变化）
  4. **baseline 验证结论**：micrograd / nanoGPT before/after 零差异（已实测），升级后无需重采集 baseline fixture
  5. **不在本 fix 范围**：`scanTestFiles` 安全不扩面；根目录同名异语言文件命名碰撞留待 F182 合入后另议

  - 新建文件：`specs/194-fix-python-adapter-gitignore/release-note.md`

---

## 依赖关系总览

```
T001（file-scanner 导出）
  ├→ T002（python-adapter 接入，可与 T003/T004 并行——不同文件）
  └→ T003 → T004（batch-orchestrator 两处接入，同文件**串行**，推荐合为一次编辑）
       ↓
  T002 + T003 + T004 全部完成
       ↓
     T005（全量验证）
       ↓
     T006（release-note）
```

**并行说明（W4 修订）**：仅 T002 与 T003/T004 之间可并行（改动文件不相交）；T003/T004 改同一对文件（batch-orchestrator.ts + 同一测试文件），不可并行。

**执行建议**：单人串行推荐顺序 T001 → T002 → T003+T004（合并为一次编辑）→ T005 → T006。

---

## 需求覆盖映射

| 修复点（fix-report） | 对应任务 |
|---------------------|---------|
| `scanPyFiles` 叠加 `.gitignore`（路径 1） | T002（含 T-GITIGNORE-01~04） |
| `walkPyFiles` 叠加 `.gitignore`（路径 2） | T003（含 T-PY-GITIGNORE-01~02） |
| `walkTsJsFiles` 叠加 `.gitignore`（路径 3） | T004（含 T-TSJS-GITIGNORE-01~02） |
| `createGitignoreFilter` 单一事实源导出 | T001 |
| 全量测试 + 构建 + 仓库检查 | T005 步骤 1/2 |
| before/after 文件集 diff 回归验证 | T005 步骤 3 |
| 合成项目复现转正（moduleCount 3→1） | T005 步骤 4 |
| release-note 披露 | T006 |

覆盖率：fix-report 中 3 处修复点 + 4 层验证要求全部覆盖（100%）。
