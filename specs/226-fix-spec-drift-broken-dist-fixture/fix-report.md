# 问题修复报告 — F219 spec-drift 测试红：broken-dist fixture 漏提交

- **特性编号**: 226
- **模式**: fix（快速问题修复）
- **诊断日期**: 2026-07-22
- **基线**: `c483485`（F225 tip）
- **缺陷归属**: F219（Spec Drift 生产发布，`835106d` 及其前序 6 个 commit）

## 问题描述

rebase 到含 F219 系列的 master 后，全量 `npx vitest run` 出现失败。
经隔离复跑区分，**真失败只有 1 条**（另 1 条为冷缓存假象，见下）：

```
FAIL tests/unit/spec-drift-check.test.ts
  > checkAnchors —— report 级 graph-unavailable（FR-011）
  > dist 存在但加载失败 → graph-unavailable（reason 区分 dist-load-failed）

AssertionError: expected 'dist-missing: dist/core/ast-analyzer.…' to match /dist-load-failed/
  - Expected: /dist-load-failed/
  + Received: "dist-missing: dist/core/ast-analyzer.js"
  ❯ tests/unit/spec-drift-check.test.ts:298:27
```

隔离单跑 `tests/unit/spec-drift-check.test.ts` 稳定复现（1 failed | 27 passed），非 flaky。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 断言为何失败？ | 期望 `reason` 含 `dist-load-failed`，实际得到 `dist-missing` |
| Why 2 | 为何是 `dist-missing`？ | `scripts/lib/spec-drift-dist-loader.mjs:22` 先做 `fs.existsSync(path.join(projectRoot, relDistPath))`，文件不存在即短路返回 `dist-missing`，根本走不到 `await import()` 的 catch 分支 |
| Why 3 | 文件为何不存在？ | 用例传入 `distRoot = tests/fixtures/spec-drift/graph-unavailable/broken-dist`，`spec-drift-check.mjs:274` 用相对路径 `dist/core/ast-analyzer.js`，因此需要 `broken-dist/dist/core/ast-analyzer.js`；而该文件与其所在目录**在仓库中完全不存在** |
| Why 4 | 为何缺失？ | 该 fixture 从未被提交。`git ls-files tests/fixtures/spec-drift/graph-unavailable/` 只返回 `.gitkeep`、`README.md`、`no-dist/.gitkeep` 三项。**真因是被 `.gitignore` 吞掉**：顶层第 6 行的 `dist/` 规则在**任意层级**匹配目录名，因此 `broken-dist/dist/` 整棵子树被忽略，`git add` 会静默丢弃 —— 提交者本地测试可能是绿的，入库后必红 |
| Why 5 | 为何未被拦截？ | 该 fixture 的**设计意图有文档但无守护**：`tests/fixtures/spec-drift/graph-unavailable/README.md` 明确写了"`broken-dist/`：`dist/core/ast-analyzer.js` 存在但语法非法，`await import()` 抛错 → `dist-load-failed`"，但没有任何检查校验"README 声明的 fixture 子目录真实存在"。提交时目录为空（git 不跟踪空目录）即被静默丢弃 |

**Root Cause**: `tests/fixtures/spec-drift/graph-unavailable/broken-dist/dist/core/ast-analyzer.js` 这一 fixture 被 `.gitignore` 顶层 `dist/` 规则吞掉而从未入库，导致"dist 存在但加载失败"场景退化为"dist 缺失"，断言必然失败。

**Root Cause Chain**: 断言失配 → loader 返回 `dist-missing` → `existsSync` 短路 → fixture 文件不存在 → `.gitignore` 的 `dist/` 在任意层级匹配、`git add` 静默丢弃 → README 声明的 fixture 无存在性守护。

> **诊断期修正**：本报告初稿在 Why 4 断言"`git check-ignore` 确认未被 gitignore 排除"，该结论**错误**。
> 原因是核验时用的路径漏了一层 `dist/`（写成 `broken-dist/core/ast-analyzer.js` 而非
> `broken-dist/dist/core/ast-analyzer.js`），恰好绕开了 `dist/` 规则。
> 实施阶段对**完整目标路径**复跑 `git check-ignore -v` 才暴露真因：
> `.gitignore:6:dist/	tests/fixtures/spec-drift/graph-unavailable/broken-dist/dist/core/ast-analyzer.js`。
> **教训**：对"文件缺失类"根因，`git check-ignore` 必须对完整目标路径执行，不能只查父目录 ——
> 否则会把"被忽略"误判为"忘了建"，修复也会因 `git add` 静默丢弃而原样复发。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 问题 | 修复动作 |
|------|------|----------|
| `tests/fixtures/spec-drift/graph-unavailable/broken-dist/dist/core/ast-analyzer.js` | 缺失 | 新建，内容为**语法非法**的 JS，使 `await import()` 抛 SyntaxError |

fixture 内容口径参照同仓既有做法 `tests/unit/spec-drift-dist-loader.test.ts:24`
（`export const = ;;;` 制造语法错误），保持一致。

### 类似模式（需评估）

| 对象 | 评估结果 |
|------|----------|
| `graph-unavailable/no-dist/` | **安全**：有 `.gitkeep` 占位已入库，且其语义就是"不含 dist"，无需额外文件 |
| 其余 F219 fixture 目录（`fresh-*`、`fingerprint-version-mismatch`、`e2e` 等） | **安全**：`git ls-files` 显示均有实体文件入库，对应用例在隔离复跑中全绿 |

### 非缺陷项（诊断中排除）

`tests/unit/spec-drift-core-validate.test.ts:107`（"全部锚 fresh → 默认 pass，且 --strict 仍 pass"）
初次观察为 5182ms 超时且隔离单跑 3/3 复现，一度判为第二个真红。**后续证伪**：

- `--testTimeout=60000` 下该用例仅耗时 **700ms**
- 恢复默认 timeout 连跑 3 次全部通过（8/8）

成因是冷缓存 —— 诊断期间执行过 `npm run build` 重写 `dist/`，使随后几次运行的首次
`await import('dist/core/ast-analyzer.js')`（及其依赖图）走冷文件缓存而超过 5s 线，缓存转热后恢复正常。

**结论**：非逻辑缺陷，但确属脆弱性——任何人在 `npm run build` 之后立即跑该文件都会遇到一次假红。
处置见修复策略「可选项」。

## 修复策略

### 方案 A（推荐）：补齐缺失 fixture

新建 `tests/fixtures/spec-drift/graph-unavailable/broken-dist/dist/core/ast-analyzer.js`，
内容为语法非法的 ES module，使 `await import()` 抛 SyntaxError → loader 命中 catch → 返回 `dist-load-failed`。
不改任何生产代码，不改任何测试断言 —— 缺什么补什么，让 README 已声明的设计意图真实成立。

**必须同时改 `.gitignore`**：顶层 `dist/` 规则会在任意层级吞掉该 fixture 子树，只建文件而不显式放行，
`git add` 仍会静默丢弃、缺陷原样复发（本地绿、入库红）。需加
`!tests/fixtures/spec-drift/graph-unavailable/broken-dist/dist/` 放行**目录本身**——
git 不允许在被忽略的父目录内单独重新包含文件，只放行文件路径无效。

**可选项（同批处理，降低复发）**：给 `spec-drift-core-validate.test.ts` 中依赖 `writeFreshLock()`
（内部真实加载 dist 并跑 AST 分析）的用例设置显式 timeout，消除"build 后首跑必假红"的脆弱性。
该项不改变任何断言语义，仅放宽时间上限。

### 方案 B（否决）：改断言以适配现状

把 `expect(report.reason).toMatch(/dist-load-failed/)` 改为接受 `dist-missing`。

**否决理由**：会让该用例与同目录 `no-dist` 用例语义重复，彻底丧失对 `dist-load-failed`
这条独立分支的覆盖 —— 用改断言掩盖缺失覆盖，是典型的以测试迁就缺陷。

## Spec 影响

- 需要更新的 spec：**无需更新**。本次仅补齐 F219 spec 与 fixture README 已明确声明、但实际漏入库的测试资产，
  不改变任何产品行为面、公共 API 或判定语义。
