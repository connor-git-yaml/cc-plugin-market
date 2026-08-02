---
feature: 239-worktree-local-state
title: 批 1（T001-T006）实现留痕 — 内容合同 + grammar 基础设施
status: done
created: 2026-08-02
tasks_basis: specs/239-worktree-local-state/tasks.md
---

# 批 1 实现留痕（T001-T006）

TDD 纪律留痕：每个任务记录「红态确认 → 实现要点 → 转绿确认」。红态输出为实际命令输出摘录，非事后追述。

---

## T001 [红测试] `tests/unit/worktreeinclude-contract.test.ts`

### 红态确认

```
命令: npx vitest run tests/unit/worktreeinclude-contract.test.ts tests/unit/worktreeinclude-golden-matrix.test.ts
输出:
  Error: Cannot find module '../../scripts/lib/worktree-local-state-core.mjs' imported from
    '.../tests/unit/worktreeinclude-contract.test.ts'
   ❯ tests/unit/worktreeinclude-contract.test.ts:20:1
  Test Files  2 failed (2)
       Tests  no tests
```

红因符合任务判据：失败原因是 `worktree-local-state-core.mjs` 模块不存在（`Cannot find module`）导致整文件收集失败，**不是**语法错误。此时 `.worktreeinclude` 亦不存在。

### 实现要点（测试设计）

- 6 类语法拒绝用 `it.each` 参数化：`absolute-path` / `dot-dot-segment` / `glob-char` / `negation-prefix` / `escape-char` / `trailing-slash`
- 2 类存在性拒绝各自用真实 git fixture（`git init` + `.gitignore` 含 `.env*` / `ignored-dir/`）：`not-ignored`（未被忽略的 tracked 路径）、`not-regular-file`（已 ignored 的目录）
- 语法优先级专项用例：`.env.local/` 在**目录真实存在**的前提下仍须判 `trailing-slash` 而非 `not-regular-file`——若实现把存在性检查放到尾斜杠之前，该用例会红
- FR-001(c) 专项用例：先断言 `.env.local` 不存在，再断言校验通过（钉死"不存在不违规"）
- FR-008 三个关键断言：真实 `AGENTS.md` pass；两文件各 20000 bytes（sum 40000 超限）仍 pass（证明按 max 不按 sum）；`AGENTS.override.md` 单独超限判红且错误文案含文件名

### 转绿确认（T004 完成后）

```
命令: npx vitest run tests/unit/worktreeinclude-contract.test.ts
输出: ✓ |unit| tests/unit/worktreeinclude-contract.test.ts (27 tests) 570ms
      Test Files  1 passed (1)
           Tests  27 passed (27)
```

---

## T002 [红测试] `tests/unit/worktreeinclude-golden-matrix.test.ts`

### 红态确认（阶段 1：模块缺失）

与 T001 同一次运行，红因为 `Cannot find module '../../scripts/lib/worktree-local-state-core.mjs'`。

### 红态确认（阶段 2：探针入口缺失 —— 任务判据要求的特异性红）

T004 落地后、T005 之前单独重跑，红因从"模块缺失"转为"bash 探针入口不存在"：

```
命令: npx vitest run tests/unit/worktreeinclude-golden-matrix.test.ts
输出:
  AssertionError: expected 128 to be +0 // Object.is equality
   ❯ tests/unit/worktreeinclude-golden-matrix.test.ts:123:26  (expect(probe.status).toBe(0))
  Test Files  1 failed (1)
       Tests  8 failed (8)
```

exit 128 = 脚本未在探针分支退出、径直落到主流程 `git rev-parse --show-toplevel`，而测试运行在非 git 临时目录。该退出码正是"探针入口尚不存在"的直接证据。

### 实现要点（测试设计）

- 6 种 golden byte fixture 以 `Buffer` 精确构造（BOM 用 `Buffer.from([0xef,0xbb,0xbf])` 拼接，非字符串字面量），覆盖：CRLF 混用 / UTF-8 BOM / 行内 `#` / 无末行换行 / 纯注释文件 / 空文件
- 每个 fixture 同时断言三件事：(a) node 侧条目序列等于**显式期望值**（防"两侧一致地错"）；(b) bash 探针 `status === 0`；(c) 两侧**逐字节**一致——bash 侧 `spawnSync` 不传 `encoding` 取原始 `Buffer`，node 侧转成同构 wire 形态（每条一行）后 `Buffer.equals` 比对
- 沙箱选用非 git 的 `mkdtempSync` 目录：探针若未提前退出必然在 `git rev-parse` 处失败，使"探针不进主流程"成为可观察判据；另加一条用例断言 sandbox 目录内容在探针前后不变（零文件系统副作用）

### 转绿确认（T005 完成后）

```
命令: npx vitest run tests/unit/worktreeinclude-golden-matrix.test.ts
输出: ✓ |unit| tests/unit/worktreeinclude-golden-matrix.test.ts (8 tests) 60ms
      Test Files  1 passed (1)
           Tests  8 passed (8)
```

---

## T003 [实现] 仓库根 `.worktreeinclude`

### 实现要点

内容恰为一行 `.env.local`（迁移自脚本内硬编码 `COPY_TARGETS`）。

### 验证

```
命令: od -c .worktreeinclude
输出: 0000000    .   e   n   v   .   l   o   c   a   l  \n
      0000013

命令: git check-ignore -v .worktreeinclude
输出: (无输出) exit=1 —— 未被任何忽略规则命中，可作为 tracked 文件入库

命令: git status --short .worktreeinclude
输出: ?? .worktreeinclude
```

---

## T004 [实现] `scripts/lib/worktree-local-state-core.mjs`

### 实现要点

- **零第三方依赖**：只用 `node:child_process` / `node:fs` / `node:path`，保证未 `npm install` 的全新 worktree 也能执行
- `parseWorktreeInclude(content)`：钉死 grammar 五条（首个 BOM 只剥一次 / 每行剥单个尾部 `\r` / 无其他 trim / `#` 仅行首成注释 / 末行无换行被接受——`split('\n')` 天然满足）
- `SYNTAX_RULES` 用**有序数组**表达判定优先级：首字符位置类（`absolute-path`→`negation-prefix`）→ 字符集类（`escape-char`→`glob-char`）→ `trailing-slash` → 路径段类（`dot-dot-segment`）；整组语法规则先于存在性/ignored 类，因此 `.env.local/` 这类"能通过 git check-ignore、且尾斜杠使存在性检查失真"的条目被结构性拒绝
- `isGitIgnored` 把 `git check-ignore` 退出码映射为三态（0=ignored / 1=not-ignored / 其余=无法判定→**不拒绝**），避免 git 自身异常把合法条目判红
- `validateWorktreeIncludeContract`：清单文件缺失**永远** fail（非 git 沙箱不豁免）；单条目 ignored 子检查在非 git 环境记为 `status:'skip'` + `evidence.reason:'not-a-git-repo'`，只进 `checks` 数组，**不**推入 `warnings`/`errors`，因此不影响整体 status
- `validateAgentsByteBudget`：按 max 不按 sum；超限判 **error（fail）而非 warning**——理由写进函数注释：超出 `project_doc_max_bytes` 时 Codex 静默截断，规则后半段无声失效且无任何运行时信号，属必须阻断的功能性破坏；若判 warning，`repo-check.mjs` 只在 `status === 'fail'` 时设 `exitCode = 1`，门禁实际不生效，与 FR-008"不再被动依赖人工偶尔 `wc -c`"的意图相悖。留 `TODO(follow-up): nested AGENTS.md 累计` 扩展点
- `validateWorktreeLocalState`：聚合前两者，返回与既有 13 族一致的三段式形状 `{status, checks, warnings, errors}`（参照 `graph-quality-core.mjs` 先例），供批 4 `aggregateValidation('worktree-local-state', ...)` 直接接入

### 转绿确认

见 T001 转绿段（27 passed）。

---

## T005 [实现] `sync-worktree-local-state.sh` 解析函数 + 探针入口

### 实现要点

- `read_worktreeinclude_entries()` 与 node 侧 grammar 逐条对齐；循环形态严格用 `while IFS= read -r line || [[ -n "$line" ]]`（`IFS=` 保留首尾空格、`-r` 保留反斜杠、`|| [[ -n ]]` 接受无末行换行）
- BOM 仅对首行剥一次（`is_first_line` 标志 + `${line#$'\xEF\xBB\xBF'}`）；`\r` 用 `${line%$'\r'}` 剥单个
- 空行/行首 `#` 用**显式 `if` 块**跳过，不用 `[[ ... ]] && continue` 形态——后者在 `set -e` 下作为循环体末尾语句有返回 1 触发退出的风险
- 探针分支 `if [[ -n "${WORKTREEINCLUDE_PROBE_FILE:-}" ]]` 插入位置在 `CURRENT_ROOT="$(git rev-parse --show-toplevel)"` **之前**（脚本原第 123 行），确保不触发任何 git 命令与文件系统副作用；`:-` 默认值形态兼容脚本头部的 `set -u`
- 本任务**只**新增解析函数 + 探针分支，未接入下游 `copy_path` 动态绑定（属批 2 / T012 范围）

### 验证

```
命令: bash -n scripts/sync-worktree-local-state.sh
输出: syntax OK（退出码 0）

命令: git diff --numstat scripts/sync-worktree-local-state.sh
输出: 44	0	scripts/sync-worktree-local-state.sh   —— 44 行纯插入、0 行删除/修改
```

跨 bash 版本可移植性实测（生产可能经 `/bin/bash` 调用，macOS 系统 bash 为 3.2）：

```
fixture: \xEF\xBB\xBF bom.env\r\n # c\n "  # indented"\n last.env（末行无换行）
/bin/bash 3.2.57  → b o m . e n v \n [空格][空格] # [空格] i n d e n t e d \n l a s t . e n v \n   exit=0
bash 5.3.9        → 同一字节序列（golden-matrix 测试即以此为准）
```

### 转绿确认

见 T002 转绿段（8 passed）。

---

## T006 [回归验证] 批 1 checkpoint

```
命令: npx vitest run tests/unit/worktreeinclude-contract.test.ts tests/unit/worktreeinclude-golden-matrix.test.ts tests/unit/sync-worktree-local-state.test.ts
输出:
  ✓ |unit| tests/unit/worktreeinclude-golden-matrix.test.ts (8 tests) 62ms
  ✓ |unit| tests/unit/worktreeinclude-contract.test.ts (27 tests) 618ms
  ✓ |unit| tests/unit/sync-worktree-local-state.test.ts (21 tests) 2306ms
  Test Files  3 passed (3)
       Tests  56 passed (56)
退出码: 0
```

「不带 `WORKTREEINCLUDE_PROBE_FILE` 时行为与改动前逐字节一致」的双重证据：

1. `sync-worktree-local-state.test.ts` 既有 21 个用例（F193 graph bootstrap、`.agents` 旧软链迁移三场景、主工作区 no-op、幂等性等）全绿，零回归
2. 脚本改动为 **44 插入 / 0 删除**的纯增量，未触碰任何既有行；探针未激活时新增代码的运行时效果仅为"定义一个从未被调用的函数 + 求值一个恒假的 `if`"

---

## 意外与处置

| 现象 | 判定 | 处置 |
|---|---|---|
| 首次跑新测试报 `Transform failed: Unexpected "/"`（两个测试文件末尾出现 `</content>` / `</invoke>` 字面行） | 我写文件时混入的工具标记残留，非测试逻辑问题 | 删除两文件末尾的残留行后重跑，红态转为预期的 `Cannot find module`（即真正的 T001/T002 红态证据） |
| `AGENTS.md` 超预算应判 warning 还是 error，plan/spec 未明确 | 需要实现侧定夺 | 选 **error**：`repo-check.mjs` 仅在 `status === 'fail'` 时置非零退出码，判 warning 会让门禁事实上不生效；理由已写入函数注释与本日志，若主编排器倾向 warning 只需改 `validateAgentsByteBudget` 一处 + 对应两个断言 |
| 探针实现依赖 `$'\xEF\xBB\xBF'` 与 `${line:0:1}` 等 bash 特性，存在 3.2 兼容性疑虑 | 生产可能经 `/bin/bash`（macOS 3.2）调用，需实证 | 用同一 fixture 在 `/bin/bash` 3.2.57 与 `bash` 5.3.9 各跑一次探针，输出字节完全一致，无需降级写法 |
