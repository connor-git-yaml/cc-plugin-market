# Verification Report: hooks payload 嵌套取值缺陷修复（Feature 245）

**特性分支**: `245-fix-hook-payload-path`
**验证日期**: 2026-08-03
**验证范围**: Layer 1（Spec-Code 对齐）+ Layer 1.5（W3 处置核实）+ Layer 1.75（行为矩阵抽查）+ Layer 2（原生工具链）

---

## Layer 1: Spec-Code 对齐

### tasks.md 勾选状态核查

| Task | 状态 |
|------|------|
| T001 重写 pre-tool-use-guard.sh | ✅ `- [x]` |
| T002 重写 post-tool-use-format.sh | ✅ `- [x]` |
| T003 新增 pre-tool-use-guard.test.mjs | ✅ `- [x]` |
| T004 新增 post-tool-use-format.test.mjs | ✅ `- [x]` |
| T005 release-contract.yaml 版本 bump + sync | ✅ `- [x]` |
| T006 提交前验证 8 步 | ✅ `- [x]` |

**覆盖率**: 6/6 = 100%（全部已完成，仓库内 `grep -n "^\- \["` 复核确认无残留 `- [ ]`）

### fix-report 行为矩阵覆盖

| 修复项 | 对应 Task | 状态 |
|--------|-----------|------|
| jq/grep 双分支取值改嵌套优先 | T001/T002 | ✅ 已实现（源码核对） |
| grep 降级分支加 tool_name 门槛 | T001/T002 | ✅ 已实现 |
| 活跃判定收窄为当前分支对应目录 | T001 | ✅ 已实现 |
| pre-guard 默认 warn-only，`SPEC_DRIVER_SRC_GUARD=block` 才 exit 2 | T001 | ✅ 已实现 |
| post-format 增加 prettier 配置存在性门槛 | T002 | ✅ 已实现 |
| 版本 4.4.0 → 4.4.1 + release:sync | T005 | ✅ 已实现（release-contract.yaml L23 = `4.4.1`，plugin.json 同步） |

---

## Layer 1.5: W3 处置核实

**结论**：**PASS**，W3（npx 缺 `--` 分隔符）已按处置结论修复，测试断言同步更新；W1/W2/W4 已按处置结论固化为脚本注释声明（best-effort 合同 + 三条已知限制），未改动逻辑，符合编排器给定的处置终态。

### 核实细节

1. **W3 代码修复核实**：`post-tool-use-format.sh:74`
   ```bash
   npx prettier --write -- "$FILE_PATH" >/dev/null 2>&1 || true
   ```
   `--` 分隔符已落地，并附注释说明理由（"FILE_PATH 来自外部 payload，若其值恰好是 flag 形态...没有分隔符时会被 npx/prettier 的参数解析器当作选项而非文件名"）。

2. **测试断言同步核实**：`plugins/spec-driver/tests/post-tool-use-format.test.mjs:159`
   ```js
   const PRETTIER_INVOCATION = 'prettier --write -- src/a.ts';
   ```
   与脚本实际调用形态一致（用例 #1/#3/#8 均引用此常量断言 `npxCalls`）。

3. **W1/W2/W4 注释块核实**：`pre-tool-use-guard.sh:27-33` 与 `post-tool-use-format.sh:23-30` 均含"已知限制（三条，方向均为 fail-open 漏判、不会误伤）"注释块，逐条对应：
   - 取值优先级分歧（grep 降级分支按文本先后取首个 `file_path`，不保证嵌套优先）
   - `\uXXXX` 转义不解码
   - 依赖"键与值同行"文本形态，不保证任意键序 / 换行布局下都能取到值（覆盖字段顺序假设）
   - 均声明为有意取舍（"bash 手写 JSON 解析做不到结构化语义，越修越像解析器就越容易被绕过"），未改变脚本逻辑，与运行时上下文给定的"不改逻辑"处置一致。

---

## Layer 1.75: 行为矩阵抽查（真实脚本手工构造 payload）

在独立临时 fixture（`mktemp -d` + `git init` + 分支名 `245-fix-hook-payload-path` + `specs/245-fix-hook-payload-path/tasks.md` 含 `- [ ]`）中，对 `pre-tool-use-guard.sh` 手工喂入嵌套 payload `{"tool_name":"Edit","tool_input":{"file_path":"src/core/foo.ts"}}`：

| 场景 | 命令/环境 | 期望 | 实测退出码 | 实测 stderr | 判定 |
|------|-----------|------|-----------|-------------|------|
| 1 | 默认（无 `SPEC_DRIVER_SRC_GUARD`） | exit 0 + WARN | 0 | `[PreToolUse WARN] 当前分支 245-fix-hook-payload-path 的 specs/245-fix-hook-payload-path/tasks.md 仍有未完成任务；对 src/core/foo.ts 的直接编辑建议走 spec-driver implement 阶段。` | ✅ PASS |
| 2 | `SPEC_DRIVER_SRC_GUARD=block` | exit 2 + BLOCKED | 2 | 同上 WARN + `[PreToolUse BLOCKED] SPEC_DRIVER_SRC_GUARD=block：活跃 spec-driver 工作流中禁止直接编辑 src/。请通过 spec-driver implement 阶段修改代码。` | ✅ PASS |
| 3（修复前基线对照，本仓库真实环境） | 分支 `245-fix-hook-payload-path`，`specs/245-fix-hook-payload-path/tasks.md` 现已全勾选（0 个 `- [ ]`），同一嵌套 payload，默认档 | exit 0，无任何 stderr 输出 | 0 | （空） | ✅ PASS — 证明活跃判定收窄生效：本分支所有任务已完成后不再误警示，历史场景下曾扫描全仓 65/215 残留 tasks.md 的误伤面已消除 |

三个场景与 fix-report/plan.md 声明的行为矩阵完全一致，判定：**PASS**。

---

## Layer 2: 原生工具链验证

**检测到**: `package.json`（Node.js/TypeScript，npm）+ `plugins/spec-driver/tests/*.mjs`（node:test 独立通道）

| # | 命令 | 退出码 | 状态 | 关键输出摘要 |
|---|------|--------|------|-------------|
| a | `bash -n pre-tool-use-guard.sh` / `bash -n post-tool-use-format.sh` | 0 / 0 | ✅ PASS | 两脚本语法自检零错误 |
| b | `node --test pre-tool-use-guard.test.mjs post-tool-use-format.test.mjs` | 0 | ✅ PASS | tests 20, pass 20, fail 0（pre-guard 12 例 + post-format 8 例全绿，耗时 943ms） |
| c | `npm run test:plugins` | 0 | ✅ PASS | tests 1292, pass 1292, fail 0, suites 230（含新增 20 例，耗时 23.5s） |
| d | `npx vitest run` | 0 | ✅ PASS | Test Files 499 passed \| 4 skipped (503)；Tests 6396 passed \| 18 skipped \| 21 todo (6435)；耗时 57.13s；**本轮未触发已知预存 flaky（watch-command / community-analysis perf / batch-orchestrator-incremental），无需隔离重跑** |
| e | `npm run build` | 0 | ✅ PASS | `tsc` 类型检查零错误；postbuild 盖章 commit=48a54ab6 (dirty，因验证轮次前工作树含已提交待推送改动属正常) |
| f | `npm run lint` | 0 | ✅ PASS | `tsc --noEmit` 零错误 |
| g | `npm run release:check` | 0 | ✅ PASS | `Release contract valid (contracts/release-contract.yaml)`；`contracts/release-contract.yaml` L23 确认 spec-driver 版本 `4.4.1`，`plugins/spec-driver/.claude-plugin/plugin.json` 同步为 `4.4.1` |
| h | `npm run repo:check` | 0 | ✅ PASS（1 处已知 warn） | 82 项 pass，1 项 warn：`graph-quality:freshness` — "图产物记录的 sourceCommit（d27ba75...）与当前 HEAD（48a54ab6...）不一致（commit 级 stale），请重新建图"。此为本 worktree 已知知识图谱新鲜度噪声（未在本次改动范围内重建图），warn 非 fail，符合运行时上下文预先声明的可接受口径 |

**测试合同（config.verification）核对**：`requiredCommands=["npm run lint","npm run build"]` 均 PASS；测试合同 `npx vitest run` + `npm run test:plugins` 均 PASS，零失败。

---

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Spec Coverage | 100%（6/6 Task 完成，fix-report 6 项修复全部落地） |
| W3 处置核实 | ✅ PASS（`--` 分隔符已落地 + 测试断言同步；W1/W2/W4 注释固化，逻辑未改，符合处置终态） |
| 行为矩阵抽查 | ✅ PASS（3/3 场景与预期一致，含修复前基线对照证明历史残留不再误伤） |
| Build Status | ✅ PASS |
| Lint Status | ✅ PASS |
| Test Status | ✅ PASS（node:test 20/20 + test:plugins 1292/1292 + vitest 6396/6396，零失败） |
| Release Contract | ✅ PASS（版本 4.4.1 一致同步） |
| repo:check | ✅ PASS（1 处已知 graph-quality:freshness warn，非 fail，本次改动不涉及知识图谱） |
| **Overall** | **✅ READY FOR REVIEW** |

### 需要修复的问题

无。本轮 8 步命令清单全部零失败，20 个新增用例全部通过，W3 处置与行为矩阵均实测核实一致。

### 未验证项（工具未安装）

无（`jq`、`npx`、`git`、`node`、`bash` 等本轮依赖工具均已安装并实际调用）。

### 已知非阻断噪声（不计入判定）

- `npm run repo:check` 的 `graph-quality:freshness` warn：本 worktree 知识图谱 sourceCommit 落后于当前 HEAD 若干个 commit，是长期已知的图谱新鲜度噪声（本次改动为 hooks 脚本，不涉及代码结构变更，未触发重建图必要性）。

---

## 第二轮增量复核（Codex 对抗审查后）

**触发原因**：本轮初次验证（上一节全部内容）提交后，发生第二轮 Codex 对抗审查（0 CRITICAL / 5 WARNING），implement 子代理已完成对应修复批，代码终态发生变化，需在新终态上重新验证。

### 第二轮改动摘要

| 项 | 内容 |
|----|------|
| W1（唯一逻辑改动） | 两脚本 `INPUT=$(cat 2>/dev/null \|\| true)` 兜底防 `cat` 缺失时 `set -e` 把命令替换失败放大为 exit 127；pre-guard 两处 `echo ... >&2` 追加 `\|\| true` 防 stderr 不可写时提前非预期退出 |
| W2/W3 | 纯注释与合同文字校准：脚本头部 fail-open 表述细化（区分"jq 解析失败放行"与"grep 分支畸形但可匹配文本仍按值判定"）、grep 降级分支已知限制条目扩写、post-format prettier 判据改为"宽信号"（`.prettierrc*`/`prettier.config.*`/package.json 含 `"prettier"` token，含 dependencies/devDependencies）；`fix-report.md` 两处同步文字 |
| W4 | pre 测试 fixture `git checkout -b` → `git checkout -B`（幂等，防宿主 `init.defaultBranch` 撞名导致测试初始化失败） |
| W5 | 测试用例 20 → 26 例：pre-guard +3（#13 无 `cat` / #14 畸形但可匹配文本固化 / #15 分支名含斜杠）；post-format +3（#9 npx 非零退出仍 exit 0 / #10 无独立配置但 devDependencies 含 prettier 判定为有配置 / #11 file_path 含空格作为单参数完整传递） |

### 8 项工具链命令重跑结果

| # | 命令 | 退出码 | 状态 | 关键输出摘要 |
|---|------|--------|------|-------------|
| a | `bash -n pre-tool-use-guard.sh` / `bash -n post-tool-use-format.sh` | 0 / 0 | ✅ PASS | 两脚本语法自检零错误（终态代码含 `cat` 兜底与 `echo \|\| true`，语法仍合法） |
| b | `node --test pre-tool-use-guard.test.mjs post-tool-use-format.test.mjs` | 0 | ✅ PASS | tests 26, pass 26, fail 0（pre-guard 12→15 例 + post-format 8→11 例，符合预期 20→26；耗时 1671ms） |
| c | `npm run test:plugins` | 0 | ✅ PASS | tests 1298, pass 1298, fail 0, suites 230（1292 + 新增 6 例 = 1298，符合预期；耗时 25.6s） |
| d | `npx vitest run` | 0 | ✅ PASS | Test Files 499 passed \| 4 skipped (503)；Tests 6396 passed \| 18 skipped \| 21 todo (6435)；耗时 58.09s；本轮同样未触发已知预存 flaky（watch-command / community-analysis perf / batch-orchestrator-incremental），无需隔离重跑 |
| e | `npm run build` | 0 | ✅ PASS | `tsc` 类型检查零错误；postbuild 盖章 commit=48a54ab6 (dirty) |
| f | `npm run lint` | 0 | ✅ PASS | `tsc --noEmit` 零错误 |
| g | `npm run release:check` | 0 | ✅ PASS | `Release contract valid`；版本仍为 `4.4.1`（W2/W3 为纯文字改动，未触发版本 bump，符合预期——第二轮未新增 T00x 版本变更任务） |
| h | `npm run repo:check` | 0 | ✅ PASS（1 处已知 warn，与上轮一致） | 82 项 pass，`graph-quality:freshness` warn 内容与上轮完全一致（sourceCommit 仍为 d27ba75...，HEAD 仍为 48a54ab6...，本次改动未涉及知识图谱，warn 非 fail） |

### W1 抽查核实

1. **代码落地核实**（Read 两脚本终态）：
   - `pre-tool-use-guard.sh:22`：`INPUT=$(cat 2>/dev/null || true)`，注释说明"PATH 里没有 cat 时，命令替换失败会在 set -e 下把退出码放大成 127...兜底后 INPUT 为空 → FILE_PATH 为空 → 正常走 exit 0 放行"
   - `pre-tool-use-guard.sh:74`：`echo "[PreToolUse WARN] ..." >&2 || true`
   - `pre-tool-use-guard.sh:76`：`echo "[PreToolUse BLOCKED] ..." >&2 || true`
   - `post-tool-use-format.sh:18`：`INPUT=$(cat 2>/dev/null || true)`，注释"PostToolUse hook 的合同是恒 0"
   - 四处兜底均已落地，与 Codex 处置结论一致。

2. **手工构造验证**（受控 PATH 仅含 `bash/grep/sed/head/git/jq/printf` 软链，刻意不放 `cat`）：

   | 场景 | 命令 | 期望 | 实测退出码 | 判定 |
   |------|------|------|-----------|------|
   | 无 cat + 嵌套 src payload → PreToolUse | 见上方 fixture | exit 0（合同：仅 0/2，无 cat 时 fail-open 为 0） | 0 | ✅ PASS |
   | 无 cat + 嵌套 src payload → PostToolUse | 同上 | exit 0（合同：恒 0） | 0 | ✅ PASS |

   两次调用均未观察到 exit 127 或脚本崩溃，`cat` 缺失被兜底吸收，`INPUT` 空 → `FILE_PATH` 空 → 双双 fail-open exit 0，与 hook harness 合同（PreToolUse 仅 0/2、PostToolUse 恒 0）完全一致。

### 行为矩阵回归抽查（临时 fixture，独立于单测）

在新建临时 fixture（`git init` + 分支 `245-fix-hook-payload-path` + `specs/245-fix-hook-payload-path/tasks.md` 含 `- [ ]`）中，对嵌套 payload `{"tool_name":"Edit","tool_input":{"file_path":"src/core/foo.ts"}}` 重新验证：

| 场景 | 环境 | 期望 | 实测退出码 | 实测 stderr | 判定 |
|------|------|------|-----------|-------------|------|
| 默认档 | 无 `SPEC_DRIVER_SRC_GUARD` | exit 0 + WARN | 0 | `[PreToolUse WARN] 当前分支 245-fix-hook-payload-path 的 specs/245-fix-hook-payload-path/tasks.md 仍有未完成任务；对 src/core/foo.ts 的直接编辑建议走 spec-driver implement 阶段。` | ✅ PASS |
| block 档 | `SPEC_DRIVER_SRC_GUARD=block` | exit 2 + BLOCKED | 2 | 同上 WARN + `[PreToolUse BLOCKED] SPEC_DRIVER_SRC_GUARD=block：活跃 spec-driver 工作流中禁止直接编辑 src/。请通过 spec-driver implement 阶段修改代码。` | ✅ PASS |

两个场景行为与第一轮验证完全一致，第二轮改动（cat 兜底 + echo 兜底 + 注释校准）未引入任何回归。

### tasks.md 复核

`grep -n "^\- \["` 复核确认 T001-T006 仍全部 `- [x]`（第二轮 Codex 修复批未涉及新增/变更 Task 编号，属于同一批任务的迭代收敛）。

### 最终总判定

**✅ READY FOR REVIEW（无变化，第二轮增量复核确认无回归）**

- 8 项工具链命令全部退出码 0，零失败（node:test 26/26、test:plugins 1298/1298、vitest 6396/6396）
- W1（唯一逻辑改动：cat/echo 兜底）代码落地核实通过 + 手工构造"无 cat PATH"场景双 hook 均 exit 0，符合 harness 合同
- 行为矩阵默认档 WARN+exit 0、block 档 exit 2 两场景与第一轮结果完全一致，无回归
- `graph-quality:freshness` warn 与第一轮完全相同（本次改动未涉及知识图谱代码），非阻断
- 无需修复项，无未验证项
