---
feature: 239-worktree-local-state
title: 批 3（T014-T028）实现留痕 — graph provenance 重构
status: done
created: 2026-08-02
tasks_basis: specs/239-worktree-local-state/tasks.md
batch2_basis: specs/239-worktree-local-state/implement-log-batch2.md
---

# 批 3 实现留痕（T014-T028）

批 2 已由主编排器复验并提交（5443911）。本批是风险最集中的一批：新增 provenance 状态机模块、
移除 F193 sidecar、发布原语改硬链接排他、shell 主流程接线。

---

## TDD 阶梯（T014 → T015 → T016/T017/T018 → T019）

### 第 1 级：T014 模块缺失整组红

```
命令: npx vitest run tests/unit/graph-bootstrap-status.test.ts
输出: Error: Failed to load url ../../scripts/lib/graph-bootstrap-status.mjs
        (resolved id: ../../scripts/lib/graph-bootstrap-status.mjs) ... Does the file exist?
      Test Files  1 failed (1)
           Tests  no tests
```

红因符合判据：模块不存在导致整文件收集失败（`no tests`），非语法错误。

### 第 2 级：T015 skeleton → 红因由"模块缺失"变为"NotImplemented"

skeleton 导出全部 9 个函数（`attemptLocalGraphBuild` 返回 rejected Promise），函数体一律抛
`NotImplemented: <fnName>`。同一命令的红因发生**可观察变化**：

```
Failed Tests 35
按函数聚合的红因计数：
  11 → NotImplemented: checkFreshness
   6 → NotImplemented: determineBootstrapSource
   4 → NotImplemented: writeBootstrapStatus
   4 → NotImplemented: readEmbeddedSourceCommit
   4 → NotImplemented: attemptLocalGraphBuild
   1 → promise rejected "Error: NotImplemented: attemptLocalGraphBuild" instead of resolving
   3 → NotImplemented: buildStatusPayload
   1 → NotImplemented: resolveWorktreeHead
   1 → NotImplemented: readPreviousStatus
```

### 第 3 级：T016/T017/T018 的特异性红（针对 skeleton 的具体函数）

| 任务 | 特异性红因 | 计数 |
|---|---|---|
| T016 `checkFreshness` adapter | `NotImplemented: checkFreshness` | 11 例（四态透传 4 + exit1 + exit2 + ENOENT + 坏 JSON + freshness 缺失 + argv 数组形态 + 真实 CLI 冒烟） |
| T017 `attemptLocalGraphBuild` | `NotImplemented: attemptLocalGraphBuild` / `promise rejected ... instead of resolving` | 5 例 |
| T018 四事实状态机 | `NotImplemented: determineBootstrapSource`（含经 `buildStatusPayload` 间接触发） | 6 例 |

**留痕诚实说明**：T016/T017/T018 的用例是在创建测试文件时与 T014 用例**一次性写入同一文件**的
（而非分三次追加）。因此三级红态的**证据**齐备（上表按函数聚合的红因可逐一对应），但"分三次
提交测试代码"这一形式未严格照做——这是作者动作粒度的偏差，不影响红态的目标特异性。

### 第 4 级：T019 逐函数实现 → 全绿

```
命令: npx vitest run tests/unit/graph-bootstrap-status.test.ts
输出: Test Files  1 passed (1)
           Tests  36 passed (36)
```

其中"真实全局 spectra CLI 冒烟"用例**实际执行**（本机已装全局 CLI，未被 skip），返回值确实落在
四态之内。

### T019 实现要点

- `checkFreshness`：`spawnSync(spectraBin, ['graph-quality','--json','--graph', graphJsonPath], ...)`
  **参数数组形式**；exit 0/1/2 一律先取 stdout 再 parse；`ENOENT` → `spectra-cli-missing`、
  坏 JSON → `unparseable-output`、`freshness` 字段缺失 → `freshness-missing`，三者状态均为
  `unknown-provenance`；四态**原样透传不折叠**（专门有一个用例断言 argv[0] 精确等于
  `graph-quality` 而非 `graph`，钉死 §M10 空格拆分毁图事故的防线）
- `attemptLocalGraphBuild`：`spawn` + `detached: true`（子进程成为独立进程组组长）+
  deadline `kill(-pid, SIGTERM)` → grace → `kill(-pid, SIGKILL)`；exit 事件里若 `killedByDeadline`
  再补一次组 KILL，收拾"父进程已退出但孙进程仍在"的残留
- `determineBootstrapSource`：四步判定；`snapshotCopiedThisRun` 显式入参但**永不参与判定**
- `writeBootstrapStatus`：`${target}.${pid}.${random}.tmp` + rename；**成功落盘之后**才迁移性
  删除遗留 sidecar（避免"新文件没写成、旧 sidecar 先没了"的中间态）；删除失败只追加 warning
- `main`：`write-status` 全程 try/catch 收敛为退出码，绝不让未捕获异常冒泡（bash 侧 `set -e`
  会因此中断整条 sync）

---

## T020 [红测试] shell 侧 provenance 接线红组

### 红态确认（T024 之前，12 红）

```
命令: npx vitest run tests/unit/sync-worktree-local-state.test.ts
输出: Tests  12 failed | 75 passed (87)
```

红项：poison-sidecar 正向 / 遗留 sidecar 清理 / rerun 继承 / none 态状态文件 / 四态映射
（stale + unknown-provenance）/ `--attempt-build` / 默认不构建 / PATH 剥离 node / 既有 copy 用例
迁移后的状态文件断言 / publish 原语 2 例。

### 三处 fixture 迁移（T020(c) 及连带）

1. `source-commit ≠ worktree HEAD 时 rerun 给出 stale 提示` → graph fixture 改为
   `{"graph":{"sourceCommit":"<primary HEAD>"},...}`
2. `首次 bootstrap 时 worktree HEAD 已 ≠ 主仓 HEAD` → 同上
3. `worktree 缺图时从主仓 copy ...` → 原本断言 **sidecar 存在且等于主仓 HEAD**，与"sidecar 彻底
   移除"直接冲突，改为断言状态文件 `schemaVersion=1` / `bootstrapSource=primary-copy` 且
   **sidecar 不存在**（用例名同步更新）

### 测试替身基础设施

新增沙盒内假 `spectra`（三种 spec：`auto` 按图内嵌 sourceCommit 与 HEAD 比对给 fresh/stale、
`fixed` 固定四态、`build` 写出含已知 sourceCommit 的 graph.json），由 `setupRepo` 默认注入
`tempDir/stub-bin` 并经 `runSync*` 放到 PATH 最前。这样所有 shell 用例的 freshness 判定都可控且
与本机是否装了全局 CLI 无关（真实 CLI 冒烟改由模块级测试单独覆盖）。

---

## T021 → T022 → T023 三步（发布原语，严格按序）

### T021 [实现-重构] 提取 `publish_exclusive`（纯重构）

提取边界**只含最终发布指令本身**（此刻仍是无条件 `run mv`）；调用方
`copy_if_absent_atomic` 的 `-e` 二次预检查与"期间目标已被其他进程生成，保留对方版本（清理
tmp）"日志分支**原样留在调用方**。定义位置前置到探针区（原语不依赖 `CURRENT_ROOT`/`PRIMARY_ROOT`），
使测试能在不触发主流程的前提下经 `PUBLISH_EXCLUSIVE_PROBE="<tmp>|<target>"` 直调它。

纯重构验证：重构后失败数由 12 降为 11（仅"target 不存在时赢得发布"这一例因探针可用而转绿），
既有 F193 用例与批 1/批 2 用例无任何行为变化。

### T022 [红测试] 直调原语 → **真红**

```
命令: npx vitest run tests/unit/sync-worktree-local-state.test.ts -t "直调原语"
输出: × 直调原语：target 已存在时不覆盖对方版本，且 tmp 被清理
        → expected 'MINE' to be 'THEIRS' // Object.is equality
      ✓ 直调原语：target 不存在时本进程赢得发布，内容为本次 tmp
      Tests  1 failed | 1 passed
```

红因正是终审精修要的那一个：无条件 `mv` 把预置的 `THEIRS` 覆写成了 `MINE`。测试**绕开**调用方
`-e` 预检查（直调原语），因此排除了"命中既有预检查分支从而两条断言在旧语义下同样全过"的假红路径。

### T023 [实现] 改为硬链接排他发布 → 转绿

`ln "$tmp" "$target_path" 2>/dev/null` 成功即赢得发布并清理 tmp（return 0）；失败（EEXIST 等）
保留对方版本并清理 tmp（return 1），调用方据返回码决定是否置 `COPY_RESULT="copied"`。
dry-run 走单独早返回分支（tmp 在 dry-run 下本就没被创建）。

T022 转绿；`copy_if_absent_atomic` 的 F193 既有回归用例（含调用方预检查路径）保持绿。

---

## T024 [实现] 主流程接线

- 删除 `SOURCE_COMMIT_REL` 常量与 `bootstrap_graph()` 内 sidecar 写入分支
- `check_graph_source_stale()` → `check_graph_freshness()`：包在 `node_available` 分支内调用
  `check-freshness` 子命令，四态映射 **stale/unknown-provenance → warn，fresh/dirty → 静默**
- `bootstrap_graph()` 独立追踪四事实并**无论走到哪条分支都调用 `write-status`**——"图不存在"
  本身也是必须记录的 provenance 事实（`none` + `assessable:false`），否则下游无从区分"没图"
  与"没记录"
- 新增 `--attempt-build` flag（含 help 文案）：仅在图既没 copy 到、自身也不存在时触发
- **每一处** `node ...` 调用都在 `command -v node` 条件分支内；缺失时分别输出
  「状态文件写入跳过：node 不可用」/「freshness 检查跳过：node 不可用」/「本地构建跳过：node 不可用」，
  其余步骤照常完成、`exit 0`

### 转绿确认

```
命令: npx vitest run tests/unit/sync-worktree-local-state.test.ts
输出: Test Files  1 passed (1)
           Tests  87 passed (87)
```

T025（`--attempt-build` 三字段断言）、T026（四态映射）随之转绿。

---

## T027 [实现] 文档更新

`docs/spectra-cli-reference.md` 原 `.graph-source-commit` 段落替换为
`specs/_meta/graph-bootstrap-status.json` 合同说明（四态 `bootstrapSource`、freshness **现算**
不缓存 stale 布尔值、`--attempt-build` 说明），并保留一段显式标注 **Superseded (Feature 239)**
的历史说明解释为什么废弃。

```
命令: grep -n "graph-source-commit\|graph-bootstrap-status" docs/spectra-cli-reference.md
输出: 172: `specs/_meta/graph-bootstrap-status.json` state file records how the graph got there
      183: > Superseded (Feature 239): the former `specs/_meta/.graph-source-commit` sidecar is gone
```

---

## T028 [回归验证] 批 3 checkpoint

```
命令: npx vitest run tests/unit/graph-bootstrap-status.test.ts tests/unit/sync-worktree-local-state.test.ts
输出: Test Files  2 passed (2)
           Tests  123 passed (123)
退出码: 0

命令: npx vitest run tests/unit/worktreeinclude-contract.test.ts tests/unit/worktreeinclude-golden-matrix.test.ts
输出: Tests  35 passed (35)   —— 批 1 零回归

命令: bash -n / /bin/bash -n scripts/sync-worktree-local-state.sh
输出: 均语法 OK（bash 5.3 与 3.2 双版本）
```

真实 worktree `--dry-run` 端到端冒烟（不落盘）：

```
[dry-run] 将写入: {"schemaVersion":1,"bootstrapSource":"unknown",
  "embeddedSourceCommitAtBootstrap":"aa8f32657e97038d190623a9492e8697ca48416a",
  "worktreeHeadAtBootstrap":"54439116ab6489fe1f77289d8c1fd18bdcaa916f",
  "generatedAt":"...","assessable":true}
[dry-run] 将删除遗留 sidecar: <worktree>/specs/_meta/.graph-source-commit
[worktree-sync] 警告: graph 可能 stale：图内嵌的 sourceCommit 与当前 worktree HEAD 不一致。...
退出码: 0
```

三点值得注意：(1) 本 worktree 真实存在一个 F193 遗留 sidecar，dry-run 正确地**只报告不删除**；
(2) `bootstrapSource=unknown` 正是 C4 规则 (d)（图已存在但无历史状态记录）；(3) stale 警告来自
**真实全局 `spectra graph-quality`**（本 worktree HEAD 已领先图的 sourceCommit），端到端链路成立。

---

## 意外与处置

| 现象 | 判定 | 处置 |
|---|---|---|
| **T017 的"总墙钟 < 50000ms"判据若照字面用默认预算跑，需要一次约 47 秒的真实等待** | 判据意图是"deadline 逃逸不得突破 SC-001 的 60s 预算"，但把 47s wall-clock 用例塞进共享 runner 正是 F233/F235 flaky 的成因 | **判据实现方式偏差（需你确认）**：拆成两条——(a) 用 `deadlineMs=1000/graceMs=500` 跑真实的 TERM-忽略 与 孙进程 stub，确定性验证 TERM→grace→KILL 逃逸收口（断言 elapsed ≥ deadline 且 < 50000）；(b) 单独一条用例把默认预算钉死为 `DEFAULT_DEADLINE_MS=45000` / `DEFAULT_GRACE_MS=2000` 且两者之和 < 50000。行为与预算都被锁住，但不引入长时墙钟用例 |
| poison-sidecar **反向**用例在 T024 之前就是绿的 | 不是缺陷：旧实现在"本次 copy 了图"时会用主仓 HEAD **覆写** sidecar，把我预置的毒 sidecar 冲掉了，因此反向不红 | tasks 判据只要求"两个方向中至少一个给出错误结果"，正向（内嵌 stale + sidecar 写成 current → 必须 warn）是真红且已捕获；反向用例保留为回归防线 |
| 既有用例 `worktree 缺图时从主仓 copy ... + 写 source-commit sidecar` 与"sidecar 彻底移除"直接冲突 | 必须改造，不属于"弱化既有断言" | 断言由"sidecar 存在且等于主仓 HEAD"改为"状态文件 schemaVersion/bootstrapSource 正确 **且 sidecar 不存在**"——断言强度不降反升（多了一条"不得再生成"的约束），用例名同步更新 |
| 若测试不注入假 CLI，shell 侧 freshness 会 spawn **真实全局 spectra** | 会让用例结果依赖本机是否装了 CLI（CI 上无 → unknown-provenance → 警告），且每次 sync 多一次真实 CLI 启动 | `setupRepo` 默认注入沙盒 stub 到 PATH 最前；真实 CLI 冒烟保留在模块级测试里单独覆盖（且本次实测确实执行了） |
| `publish_exclusive` 定义位置放在文件前部探针区，与 `copy_if_absent_atomic` 相隔较远 | 权衡取舍：探针必须早于任何 git 命令，而原语被探针调用就必须先定义 | 已在原语与调用点两处加交叉引用注释说明"定义前置是为了让测试直调原语而不触发主流程" |
