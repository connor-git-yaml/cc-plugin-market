---
feature: F194
title: "修复 python-adapter scanPyFiles / walkPyFiles / walkTsJsFiles 不遵循 .gitignore"
status: planning
mode: fix
base_commit: 3925df5
created: 2026-06-13
---

# 修复规划 — F194 三处自写 walk 不遵循 .gitignore

## 问题摘要

三处自写 walk 函数在文件发现时绕过了项目 `.gitignore` 规则，导致 gitignored 文件污染 module graph、增量 skeletonHash 口径、UnifiedGraph/graph.json。

| 位置 | 函数 | 影响路径 |
|------|------|----------|
| `src/adapters/python-adapter.ts:111` | `scanPyFiles` | module graph、F175 增量 hash、extractSymbolNodes 节点 |
| `src/batch/batch-orchestrator.ts:2213` | `walkPyFiles` | collectPythonCodeSkeletons → UnifiedGraph callSites/节点 |
| `src/batch/batch-orchestrator.ts:2332` | `walkTsJsFiles` | collectTsJsCodeSkeletons → UnifiedGraph callSites/节点 |

根因：三处均为 F145/F151/F152 引入时的自写轻量 walk，`src/utils/file-scanner.ts` 的 `parseGitignore`/`globToRegex` 私有不可复用，导致未接入 gitignore 管线。

---

## Codebase Reality Check

| 文件 | LOC | 关键方法数 | 本次改动行数（估） | 已知 debt |
|------|-----|------------|------------------|-----------|
| `src/utils/file-scanner.ts` | 393 | `scanFiles`（导出）、`parseGitignore`（私有）、`globToRegex`（私有）、`walkDir`（私有） | +20（新增导出函数 `createGitignoreFilter`） | 无 TODO/FIXME |
| `src/adapters/python-adapter.ts` | ~290 | `scanPyFiles`（私有）、`extractSymbolNodes`（public）、`buildModuleGraph`（public） | +10（scanPyFiles 叠加 gitignore 过滤） | 无 |
| `src/batch/batch-orchestrator.ts` | 2357 | `walkPyFiles`（私有）、`walkTsJsFiles`（私有）、`collectPythonCodeSkeletons`（导出）、`collectTsJsCodeSkeletons`（导出） | +30（两处 walk 各叠加 gitignore 过滤） | 无与本次相关的 TODO/FIXME |
| `tests/adapters/python-adapter.test.ts` | ~380 | extractSymbolNodes 系列（T010-T012） | +80（新增 gitignore fixture 测试） | 无 |
| `tests/unit/batch-orchestrator-*.test.ts` | — | — | +60（walkPyFiles / walkTsJsFiles gitignore 测试） | — |

**前置清理规则评估**：batch-orchestrator.ts LOC 2357 > 500 且新增约 30 行，但 30 行 < 50 行阈值，且无相关 TODO；不触发强制前置 cleanup task。

---

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件 | 3 个源文件 + 2-3 个测试文件 |
| 间接受影响 | `extractSymbolNodes` / `buildModuleGraph` 调用方（无 API 签名变化）、`collectPythonCodeSkeletons` / `collectTsJsCodeSkeletons` 调用方（行为变化：文件集收紧） |
| 跨包影响 | 无（全部在 `src/` 内） |
| 数据迁移 | 无 schema 变更；但 Python 项目含 gitignored 文件时 module graph / skeletonHash / graph.json 口径收紧 → 升级后首轮全量重生成属预期，需 release-note 披露 |
| API/契约变更 | `createGitignoreFilter` 为新增导出（非破坏性）；三处 walk 函数为模块私有，签名不变，行为单调收紧 |
| 风险等级 | **LOW**（影响文件 < 10，无跨包影响；行为变化为单调收紧，不放宽） |

---

## 变更文件清单与具体改法

### 改动 1：`src/utils/file-scanner.ts`

**目标**：将私有 `parseGitignore`（含 `globToRegex`）封装导出为单一事实源工厂函数。

```typescript
/**
 * 创建 .gitignore 过滤器（单一事实源）
 * 供 python-adapter 及 batch-orchestrator 的自写 walk 叠加接入。
 *
 * 基准契约（Codex Phase 2 审查 W1）：返回的过滤函数期望输入**相对 projectRoot 的路径**
 * （即 .gitignore 所在根 = 相对路径基准，二者必须一致，由调用方保证）。
 * 注意 scanFiles 现状存在 scanRoot != projectRoot 时基准错位的既有怪癖
 * （gitignore 取自 projectRoot 而 relativePath 相对 resolvedDir，
 * 如 module-derivation.ts:319-325 scanRoot=src 的调用）——该怪癖属 file-scanner
 * 既有行为，本 fix 不修也不放大；三处新接入 walk 的扫描根 = gitignore 根，无错位。
 *
 * @param projectRoot - 项目根目录（用于定位 .gitignore，亦是相对路径基准）
 * @returns 过滤函数：接受相对 projectRoot 的路径，返回 true 表示命中 gitignore 应跳过
 */
export function createGitignoreFilter(projectRoot: string): (relativePath: string) => boolean {
  const gitignorePath = path.join(path.resolve(projectRoot), '.gitignore');
  return parseGitignore(gitignorePath);
}
```

`scanFiles` 内部的 `parseGitignore` 调用保持不变（通过 `createGitignoreFilter` 间接复用或直接调用私有函数均可——工厂仅封装"gitignore 路径构造 + parse"，输入相对路径的基准仍由调用方决定，行为零变化）。

**变更行数估计**：+16 行（函数体 + 含基准契约的 JSDoc）。

---

### 改动 2：`src/adapters/python-adapter.ts`

**目标**：`scanPyFiles` 叠加 gitignore 过滤层（目录命中剪枝 + 文件命中跳过）。

修改 `scanPyFiles` 方法：

1. 在方法入口调用 `createGitignoreFilter(resolvedRoot)` 获取过滤函数。
2. walk 内层：
   - 目录递归前：`path.relative(resolvedRoot, path.join(dir, entry.name))` 计算相对路径，若过滤函数返回 true 则 `continue`（剪枝）。
   - 文件收集前：对 `.py` 文件同样做相对路径检查，过滤命中则跳过。
3. 保留现有 `ignoreNames.has(entry.name)` 和点前缀 `entry.name.startsWith('.')` 检查（只叠加，不替换）。

**相对路径基准**：`resolvedRoot`（与 `file-scanner.ts` 的 `path.relative(baseDir, fullPath)` 口径一致）。

**变更行数估计**：+12 行（import + 过滤器初始化 + 两处检查）。

---

### 改动 3：`src/batch/batch-orchestrator.ts`

**目标**：`walkPyFiles` 与 `walkTsJsFiles` 各自叠加 gitignore 过滤层。

#### walkPyFiles（:2213）

修改签名为 `walkPyFiles(dir: string, out: string[], isGitignored: (rel: string) => boolean, resolvedRoot: string): void`，或在 `collectPythonCodeSkeletons` 调用点传入已构建的过滤函数（推荐后者避免签名链传染）。

更简洁方案：`collectPythonCodeSkeletons` 内，先调用 `createGitignoreFilter(resolvedProjectRoot)` 获取 `isGitignored`，然后在 `walkPyFiles` 入口和递归前通过闭包捕获（修改 `walkPyFiles` 为接受 `isGitignored` 的内部函数或闭包）。

walk 内层新增：

```typescript
// 目录：相对路径命中 gitignore 则剪枝
const relDir = path.relative(resolvedRoot, path.join(dir, entry.name));
if (isGitignored(relDir)) continue;
// 文件：相对路径命中 gitignore 则跳过
const relFile = path.relative(resolvedRoot, path.join(dir, entry.name));
if (isGitignored(relFile)) continue;
```

保留 `entry.name.startsWith('.')` 和 `PY_SKELETON_IGNORE_DIRS.has(entry.name)` 不变。

#### walkTsJsFiles（:2332）

与 `walkPyFiles` 同等模式处理：`collectTsJsCodeSkeletons` 内构建 `isGitignored`，通过闭包传入 walk；walk 内层对目录和文件均做相对路径 gitignore 检查。

保留 `entry.name.startsWith('.')` 和 `TSJS_SKELETON_IGNORE_DIRS.has(entry.name)` 不变。

**变更行数估计**：两处各 +15 行（import + 闭包改造 + 目录/文件各一次过滤）= +30 行。

---

### 改动 4：测试文件（新增）

#### `tests/adapters/python-adapter.test.ts`（新增用例）

新增 `describe('scanPyFiles 遵循 .gitignore', ...)` 区块，覆盖：

**断言原则（Codex Phase 2 审查 W2）**：所有"ignored 文件不在结果中"的负向断言**必须**配对"keep 文件存在于结果中"的正向断言——否则 fixture 整体解析失败导致的空结果会让负向断言假绿。

| 用例 | 场景 | 预期 |
|------|------|------|
| T-GITIGNORE-01 | `.gitignore` 含目录模式 `generated/`，目录下有 `.py` | 结果**含** `pkg/core.py`（正向）且**不含** `generated/` 下文件（负向） |
| T-GITIGNORE-02 | `.gitignore` 含通配模式 `local_*.py` | 结果含 keep 文件且命中文件被跳过 |
| T-GITIGNORE-03 | negation 最后匹配优先（Codex W3 修正写法）：`.gitignore` 为 `local_*.py` + `!local_important.py` 两行 | `local_important.py` 被包含（negation 生效）、其余 `local_*.py` 被排除；子用例：`generated/` + `!generated/keep.py` → `keep.py` 仍被剪掉（目录剪枝不放宽，与 file-scanner walkDir 一致） |
| T-GITIGNORE-04 | 无 `.gitignore` | 行为等同修复前（无回归，结果含全部非硬编码忽略文件） |

fixture 创建方式：`fs.mkdtempSync` 临时目录，写入 `.gitignore` + `.py` 文件，调用 `adapter.extractSymbolNodes(tmpDir)`（无需真实 TreeSitter 解析，mock `analyzeFile` 返回空 skeleton 即可）。negation 有效写法参照 `tests/unit/file-scanner.test.ts:76-82`（`*.ts` + `!important.ts`，单独 `!pattern` 是 no-op）。

#### `tests/unit/batch-orchestrator-gitignore.test.ts`（新建文件）

覆盖 `collectPythonCodeSkeletons` 与 `collectTsJsCodeSkeletons` 的 gitignore 行为（同样遵循正负断言配对原则——collect* 会真实调用 adapter 解析且单文件失败被吞，keep 文件正向断言是防假绿的关键）：

| 用例 | 场景 | 预期 |
|------|------|------|
| T-PY-GITIGNORE-01 | `.gitignore` 含 `generated/` 目录模式 | Map **含** keep 的 `.py`（正向）且不含该目录下 `.py/.pyi`（负向） |
| T-PY-GITIGNORE-02 | `.gitignore` 含通配 `*.stub.py` | Map 含 keep 文件且命中文件不进 Map |
| T-TSJS-GITIGNORE-01 | `.gitignore` 含 `generated/` | Map 含 keep 的 `.ts` 且不含该目录下 `.ts/.tsx/.js` |
| T-TSJS-GITIGNORE-02 | 无 `.gitignore` | 行为无回归（全部可解析文件都在 Map 中） |

使用 `fs.mkdtempSync` 临时目录 fixture，写入**真实可解析的简单源文件**（如 `def f(): pass` / `export const x = 1`），不 mock adapter——keep 文件正向断言同时验证解析链路真实工作。

---

## 回归风险评估

| 风险点 | 等级 | 说明 |
|--------|------|------|
| 行为变化范围扩散 | LOW | 三处 walk 均为模块私有，仅通过 `collectPythonCodeSkeletons` / `collectTsJsCodeSkeletons` / `extractSymbolNodes` / `buildModuleGraph` 导出语义；API 签名不变 |
| 单调收紧原则 | 已保证 | 只叠加 `.gitignore` 层，不删除硬编码集；文件集只减不增 |
| negation 边界（`!pattern`） | LOW | 目录已剪枝时其下文件不可达——与 `file-scanner.walkDir` 现有行为及 git 语义一致，非新增偏差 |
| micrograd/nanoGPT baseline | LOW | fix-report 评估：两项目 gitignore 命中零（micrograd 仅 `.ipynb_checkpoints`/`.aider*`；nanoGPT 的 `__pycache__/env/venv` 在硬编码集且 working tree 无实例）；预期 before/after 零 diff |
| self-dogfood TS/JS 路径 | LOW | 本仓 `.gitignore` 主要排除 `dist/` `specs/` `node_modules/`；这些已在 `TSJS_SKELETON_IGNORE_DIRS` 硬编码集中，新增过滤后文件集变化预期极小甚至为零 diff |
| 增量 hash 口径变化 | MEDIUM | Python 项目首轮升级后 skeletonHash 变化 → 全量重生成；这是正确行为，需 release-note 说明；无数据丢失风险 |

---

## 验证方案

### 验证层 1：单元测试（必须全绿）

```bash
npx vitest run tests/adapters/python-adapter.test.ts
npx vitest run tests/unit/batch-orchestrator-gitignore.test.ts
npx vitest run tests/unit/file-scanner.test.ts
```

新增 T-GITIGNORE-01~04 / T-PY-GITIGNORE-01~02 / T-TSJS-GITIGNORE-01~02 全部通过。

### 验证层 2：构建与静态检查

```bash
npm run build           # TypeScript 类型检查零错误
npm run repo:check      # 仓库同步检查
npx vitest run          # 全量单元测试零失败
```

### 验证层 3：before/after 文件集 diff（回归验证）

使用已存档的 before-*.json baseline 与 fix 后的捕获脚本比对：

```bash
# micrograd Python module graph
node specs/194-fix-python-adapter-gitignore/verification/capture-py-graph.mjs micrograd
# 期望与 before-micrograd.json 零差异

# nanoGPT Python module graph
node specs/194-fix-python-adapter-gitignore/verification/capture-py-graph.mjs nanoGPT
# 期望与 before-nanoGPT.json 零差异

# self-dogfood collectXxx 文件集
node specs/194-fix-python-adapter-gitignore/verification/capture-collect-paths.mjs self-dogfood
# 对比 before-collect-self-dogfood.json，显式列出 diff（预期空或仅含已知 gitignored 文件）
```

**zero-diff 定义**：micrograd/nanoGPT 必须无 diff（已评估 gitignore 命中零）；self-dogfood 若有 diff，需逐项确认为 gitignored 文件（在 `.gitignore` 中有明确规则）。

### 验证层 4：合成项目复现测试（end-to-end 验证根因已修）

```bash
# 创建复现项目（fix-report §缺陷实证复现）并在 fix 后重跑
# 预期：moduleCount 3 → 1（只含 pkg/core.py）
```

---

## 任务拆解建议（供 tasks 阶段细化）

### Task 1：file-scanner 导出 createGitignoreFilter

- 文件：`src/utils/file-scanner.ts`
- 新增 `export function createGitignoreFilter(projectRoot: string)` 包装现有私有 `parseGitignore`
- 测试：确认 `tests/unit/file-scanner.test.ts` 无需修改（`scanFiles` 行为零变化）；可增加一条 `createGitignoreFilter` 直接调用的冒烟测试

### Task 2：python-adapter.ts 叠加 gitignore

- 文件：`src/adapters/python-adapter.ts`
- `scanPyFiles` 方法中引入 `createGitignoreFilter`，叠加目录/文件两层过滤
- 测试：新增 `tests/adapters/python-adapter.test.ts` 中 T-GITIGNORE-01~04

### Task 3：batch-orchestrator walkPyFiles 叠加 gitignore

- 文件：`src/batch/batch-orchestrator.ts`
- `walkPyFiles` 通过闭包接入 `createGitignoreFilter`（由 `collectPythonCodeSkeletons` 构建并传入）
- 测试：`tests/unit/batch-orchestrator-gitignore.test.ts` 中 T-PY-GITIGNORE-01~02

### Task 4：batch-orchestrator walkTsJsFiles 叠加 gitignore

- 文件：`src/batch/batch-orchestrator.ts`
- `walkTsJsFiles` 同等模式（由 `collectTsJsCodeSkeletons` 构建并传入）
- 测试：`tests/unit/batch-orchestrator-gitignore.test.ts` 中 T-TSJS-GITIGNORE-01~02

### Task 5：验证 + release-note

- 跑验证层 1-3（全量测试 + before/after diff）
- 写入 `specs/194-fix-python-adapter-gitignore/release-note.md`，说明：hash/graph 口径变化、首轮全量重生成属预期、受影响项目类型（含 gitignored .py/.pyi/.ts/.tsx/.js/.jsx 的项目）

---

## 执行约束与注意事项

1. **不引入新依赖**：`createGitignoreFilter` 全部依赖 `node:fs`/`node:path`（已在 file-scanner.ts 中使用）。
2. **不统一扩展名/硬编码集**：三处 walk 保留各自现有 `ignoreNames`/`PY_SKELETON_IGNORE_DIRS`/`TSJS_SKELETON_IGNORE_DIRS`，本 fix 只叠加 `.gitignore` 层。
3. **scanTestFiles 不扩面**：`src/core/single-spec-orchestrator.ts:1054 scanTestFiles` 评估为安全（不进 graph/hash），不在本 fix 范围。
4. **F182 的命名碰撞问题不扩面**：根目录同名异语言文件的 per-file spec 碰撞依赖 F182 的 `outputFileName` 机制，留待 F182 合入 master 后另议。
5. **TypeScript 严格类型**：`createGitignoreFilter` 返回类型为 `(relativePath: string) => boolean`，无 `any`。
6. **注释中文**：所有新增代码注释使用中文，代码标识符使用英文。
