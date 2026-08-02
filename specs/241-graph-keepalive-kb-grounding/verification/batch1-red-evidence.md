# F241 批 1 — 红测试首跑证据

> 每条 `[红测试]` 任务在实现落地**之前**的首跑失败摘要。TDD 硬序的取证，非事后补记。
> 迁移回归测试（T003/T006）按 T-W2 定性为「先绿旧实现」，不在本文件收录红态。

## T008 — `plugins/spec-driver/tests/graph-consumption-decision.test.mjs`

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '.../plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs'
✖ plugins/spec-driver/tests/graph-consumption-decision.test.mjs
ℹ tests 1 / pass 0 / fail 1
```

红因：决策模块尚未存在（模块加载失败）。转绿见 T009。

## T010 — `plugins/spec-driver/tests/git-change-classifier.test.mjs`

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '.../plugins/spec-driver/scripts/lib/git-change-classifier.mjs'
ℹ tests 1 / pass 0 / fail 1
```

红因：解析模块尚未存在。转绿见 T011（21/21）。

## T012 — `plugins/spec-driver/tests/graph-refresh-executor.test.mjs`

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '.../plugins/spec-driver/scripts/lib/graph-refresh-executor.mjs'
ℹ tests 1 / pass 0 / fail 1
```

红因：执行层模块尚未存在。转绿见 T013（14/14，含真实 spectra `graph-only` 重建集成用例）。

## T014 — `plugins/spec-driver/tests/graph-consumption-cli.test.mjs`（Part 1）

```
SyntaxError: The requested module '../scripts/lib/graph-consumption-decision.mjs'
  does not provide an export named 'DEGRADED_REASON_HINTS'
ℹ tests 1 / pass 0 / fail 1
```

红因：CLI 与「12 reason → 固定人读模板」映射表尚未落地。转绿见 T015（Part 1 15/15）。

## T016 — 同文件 Part 2（双事件审计 + SC-005）

首跑 36 tests / pass 35 / **fail 1**：

```
✖ degradedReason=refresh-failed-timeout 落进 kind:"decision" 审计事件 (30262ms)
  AssertionError: degradedReason 期望 'refresh-failed-timeout'，实得 null
```

红因（行为缺失，非模块缺失）：CLI 无 `--refresh-deadline-ms`，`executeRefresh` 也不透传
`deadlineMs`，刷新只能吃 canonical 的 45s 默认值 —— 挂起 30s 的构建根本触发不了 timeout 分支，
`refresh-failed-timeout` 这条枚举在 CLI 端**从未被真正走过**。同一缺口还让 artifact-unusable
用例白等 45s。转绿见 T017。

## T018 — 同文件 Part 3（SC-019 安装态）

首跑 40 tests / pass 39 / **fail 1**：

```
✖ 从仓外临时目录跑 decide --dry-run --format json：exit 0 + 可解析 + 无模块解析错误
  SyntaxError: Unexpected end of JSON input   （退出码 0，但 stdout 完全为空）
```

红因（**真实缺陷，非 tasks.md 预期的"无独立红态"**）：CLI 的自调用守卫按 `path.resolve` 比
`process.argv[1]` 与 `import.meta.url`。`/tmp` 在 macOS 是 `/private/tmp` 的符号链接，Node 给出的
`import.meta.url` 已是 realpath，两者恒不相等 → `main()` 永不执行 → **exit 0 且 stdout 全空的静默
空转**，正是 plan §1.2 描述的那类「看起来成功、实际什么都没做」。转绿见 T018 实现（守卫改比
`fs.realpathSync`），并补一条符号链接调用的专项回归用例（41/41）。

> tasks.md 原文预判 T018「无独立红态可强造」——实测证伪：它抓到了一个真实 bug。

## T019 — 同文件 Part 4（SC-002/003 真实刷新）

无独立红态：Part 4 依赖的 `decide` 主链已在 T015/T017 落地，本段验证的是真实 spectra 行为而非新增
业务逻辑。首跑即绿（SC-002 真实 stale→刷新 1.3s；SC-003 additive-only 图 SHA-256 零变化 0.9s），
如实标注。

## T020 — `plugins/spec-driver/tests/goal-loop-graph-consumption-integration.test.mjs`

```
SyntaxError: The requested module '../scripts/graph-consumption-cli.mjs'
  does not provide an export named 'resolvePhaseStartRef'
ℹ tests 1 / pass 0 / fail 1
```

红因：注入闸门 `shouldConsumeImpact` 与 `phase_start_ref` last-match-wins 解析（T-W1）都尚未落地。
转绿见 T020 实现（16/16，接线断言补齐后 19/19）。

## T026 — `plugins/spec-driver/tests/ensure-gitignore.test.mjs`

T025 把自举清单从 4 条扩到 5 条后首跑：

```
ℹ tests 19 / pass 8 / fail 11
✖ 用例 1 / 2 / 3 / 4 / 5 / 7 / 8 / 10 / 11 / 13 / 15
  AssertionError: 期望 'created:4'，实得 'created:5'（等 11 处硬编码条目数）
```

红因（行为缺失）：既有测试把条目数 `4` 硬编码在十余处断言里，清单一扩就整片红，且红出来的是
"数字对不上"而非"注入逻辑坏了"。转绿方式不是把 4 改成 5，而是**改为从 `EXPECTED_ENTRIES.length`
派生**（批 2 再加 `.specify/kb-nohit/` 时零改动），并补一组 SC-020 双段 `git check-ignore` 断言
（仓内直查 + 插件拷入全新临时 git repo 跑自举后再查）+ 一条"两处清单一致性"断言。最终 22/22。

---

# 批 1 收尾追加任务的红态证据（T027a / T027b）

> 门禁 T027 通过后，implement 报告的两条发现经编排器裁决为「补做」。同样走 TDD 硬序：
> 先跑出真实红态，再实现转绿。

## T027a — `plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs`（符号链接守卫）

追加 3 条用例后首跑 **11 tests / pass 9 / fail 2**：

```
✖ 仓根薄壳：经符号链接目录调用 write-status 仍真实落盘（守卫必须比 realpath） (76.84ms)
  AssertionError: 状态文件未落盘 = main() 未执行 = exit 0 的静默空转（符号链接击穿了自调用守卫）
  false !== true
✖ canonical 实现：经符号链接目录调用 write-status 仍真实落盘（守卫必须比 realpath） (74.19ms)
  AssertionError: 同上
ℹ tests 11 / pass 9 / fail 2
```

红因（**真实缺陷**，与 T018 抓到的是同一形态）：两个文件的 `invokedDirectly` 都按 `path.resolve`
比对 `process.argv[1]` 与 `import.meta.url`。Node 默认解析符号链接，`import.meta.url` 给的已是
realpath 而 argv[1] 是用户敲进来的字面路径，隔着一层软链（macOS `/tmp` → `/private/tmp`、
软链的插件安装目录、worktree 里软链过来的 `scripts/`）两者恒不相等 → `main()` 永不执行 →
**子进程 exit 0 且状态文件根本没写**。断言刻意只盯落盘副作用而不看退出码——空转恰好也是 0。

> T018 在 `graph-consumption-cli.mjs` 上修掉了这个 bug，但 D8 迁移过来的这两份守卫没跟着改。
> 转绿方式因此不是"再改两处"，而是把判定收敛成 canonical 导出的 `isInvokedDirectly(moduleUrl)`
> 单一实现，薄壳 import 复用——两份各自维护的守卫必然同步漂移，这次就是实证。最终 11/11。

## T027b — `plugins/spec-driver/tests/tasks-path-signal.test.mjs`（D3 目标路径信号）

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '.../plugins/spec-driver/scripts/lib/tasks-path-signal.mjs'
ℹ tests 1 / pass 0 / fail 1
```

红因：信号模块尚未存在（模块加载失败）。转绿后 21/21。

## T027b — `plugins/spec-driver/tests/graph-consumption-cli.test.mjs`（Part 1 追加 `--tasks-file` 段）

追加 7 条用例后首跑 **48 tests / pass 44 / fail 4**：

```
✖ (态 1) 干净工作树 + tasks.md 路径已存在 → changeClass=modifies-existing
✖ (态 2) 干净工作树 + tasks.md 路径全不存在 → additive-only / skip-impact，且措辞仍非权威
✖ 非 advisory 传 --tasks-file → 忽略该信号 + stderr warning（权威判定只认 git diff）
✖ --tasks-file 指向不存在的文件 → 降级为 warning，决策照常输出
ℹ tests 48 / pass 44 / fail 4
```

红因（行为缺失）：`decide` 尚无 `--tasks-file` 参数，干净工作树下 `changeClass` 只能是 `unknown`，
D3 定的 advisory 轮 1 信号（tasks.md 目标路径存在性）在 CLI 端**完全不可达**。

同批 3 条用例（态 3 `unknown` 保持、git 信号优先、SC-004 封闭键集不变）首跑即绿并非漏测，
而是它们断言的正是"新参数**不得**改变的既有行为"，实现前后都该绿——留着是为了转绿后能证明
新分支没有溢出到这三条路径上。转绿后 48/48。

---

# 批 1 Codex 代码对抗审查整改的红态证据（B1-C1..C7 / W1..W6）

> 审查会话 `task-msc6wt4l-emi1m9` 判「门禁不通过」（7 CRITICAL / 7 WARNING）。每条 CRITICAL 先按
> 审查给出的证伪输入补红测试、跑出真实失败，再修绿。下面是**修复前**的实测首跑摘要。
>
> 取证方法说明：`finalizeRefreshOutcome`（C3）与 `buildImpactInjectionBlock`（C7）是新增导出，
> 若直接连同其余修复一起提交，整份测试文件会先死在 `SyntaxError: does not provide an export named ...`，
> 行为级红态会被模块加载失败掩盖。因此先只落这两个**未接线**的纯函数导出，再跑一次取行为红态——
> 记录的是"判据错了"，不是"文件还没写"。

## `graph-consumption-cli.test.mjs` — 68 tests / pass 57 / **fail 11**

```
✖ 缺 graph.sourceCommit 字段 → graphAvailability=corrupt      actual 'present'  expected 'corrupt'
✖ sourceCommit 为空串 → graphAvailability=corrupt              actual 'present'  expected 'corrupt'
✖ sourceCommit 非字符串 → graphAvailability=corrupt            actual 'present'  expected 'corrupt'
✖ 整个 graph 字段缺失 → graphAvailability=corrupt              actual 'present'  expected 'corrupt'
✖ broken symlink 的 graph.json → corrupt                       actual 'missing'  expected 'corrupt'
✖ graph.json 位置是目录 → corrupt                              actual 'missing'  expected 'corrupt'
✖ decide 输出与 decision 审计事件的 graphSourceCommit 都是 G2   actual 'aaaa…'(G1) expected 'eeee…'(G2)
✖ 全链：G1 stale → 刷新 G2 → annotate-caveat 得 completed       actual 'snapshot-mismatch' expected 'completed'
✖ 真实 MCP 形状 `summary.directCallers: 0` + TS target → 注解    actual []  expected ['coverage-gap-known-extraction-limit']
✖ 缺 --target → 拒绝注解                                        （旧实现反而注解了）
✖ B1-W2 tasks.md 声明仓外/绝对路径 → 不得据此判 modifies-existing
```

红因逐条：

- **B1-C1**：`readEmbeddedSourceCommit` 的 `ok:true` 只保证"文件读到了、JSON 解析通过"。
  `{"graph":{}}` 是合法 JSON，于是 `value:null` 也被判 `present`——一份查不出任何 provenance 的图
  被当成"图在手且可消费"。EC-02 要求这类"存在但不可用"归 corrupt。
- **B1-C2**：采集入口用 `statSync`，它**跟随符号链接**。一条指向不存在目标的 `graph.json` symlink
  因此报 ENOENT → 判 `missing` → `allowed` 下走重建分支，而重建会沿着那条 symlink 往仓外写图。
  EC-02 的 lstat 硬合同正是为挡这个。
- **B1-C3（最重）**：刷新动过图之后，输出与 decision 事件仍带着决策时读到的 G1。
  `annotate-caveat` 拿 decision 里的 `graphSourceCommit` 与注解时刻的图内嵌值比对 → 主路径
  （stale → 刷新 → 消费 impact）**必然**判 snapshot-mismatch，FR-006 的 caveat 通道在最常见路径上全丢。
  第 8 条红态就是这条链的端到端复现。
- **B1-C4**：判据只认合成的顶层 `directCallers`，而 Spectra MCP 真实返回把计数放在
  `summary.directCallers` 且**不带** target 字段。于是真实返回一律取不到 0（caveat 从未在生产触发），
  同时 target 缺失时旧实现**跳过**范围判断直接注解——对任意目标都挂上一句无根据的可信度声明。
- **B1-W2**：`Node.js` / `spectra.batch` 这类裸词满足"基名 + 字母扩展名"被误收；
  `/etc/hosts.txt`、`../../escape.ts` 这类仓外/绝对路径被原样送去做存在性探测。

## `graph-consumption-decision.test.mjs` — 37 tests / pass 35 / **fail 2**

```
✖ 目标不是 TS/JS 源 → 不注解        actual ['coverage-gap-known-extraction-limit'] expected []
✖ B1-C4 真实 MCP 形状：summary.directCallers 被识别   actual [] expected ['coverage-gap-…']
```

同 B1-C4。第一条尤其能说明问题：把 target 从返回体里挪成显式入参后，旧实现"返回体没有 target
就不做范围判断"的分支立刻暴露成误注解。

## `goal-loop-graph-consumption-integration.test.mjs` — 27 tests / pass 23 / **fail 4**

```
✖ B1-C7 caveat 必须在注入块里可见，且措辞不得声称影响面完整
✖ B1-C5 goal_loop 步骤 2 的 advisory 命令逐字含 --tasks-file（完整参数串断言）
✖ B1-C5 两个生成 wrapper 与 canonical 同步
✖ B1-W1 预算键钉死 + goal_loop 已跑过时外层 verify 4b 恒 declined
```

- **B1-C5**：SKILL 散文的 advisory 命令缺 `--tasks-file`（T027b 后补的功能没回灌散文），
  D3 定的 advisory 轮 1 信号在真实编排里**完全拿不到**。旧接线测试只查 `'--base-ref-from-trace'`
  这类单 token 存在，挡不住参数漏传——所以新断言改为整段参数串逐字比对。
  第 3 条同时证明两个生成 wrapper 未同步（改 SKILL 忘 `repo:sync` 会红）。
- **B1-W1**：`{本 phase 内首次调用传 allowed，否则 declined}` 在 goal_loop 下有歧义——步骤 2
  与步骤 3b 都在 implement phase 跑过 decide，外层 verify 4b 算第几次没有定义。
- **B1-C7**（第 1 条）：这是我自己首版注入块措辞踩线的红——文案里出现了「已穿尽」类字样被
  D7 措辞断言拦下，随即改写为「可能缺失的 caller 需另行 Grep / Read 复核」。

## `tasks-path-signal.test.mjs` — 25 tests / pass 22 / **fail 3**

```
✖ B1-W2 裸词（无 `/`）不得被当成路径   actual ['Node.js','20.x','README.md','spectra.batch','v2.md']
✖ B1-W2 绝对路径 / Windows 盘符路径拒收 actual ['/etc/passwd.txt','/Users/someone/secret.ts','C:/Windows/system.ini']
✖ B1-W2 含 `..` 段的路径拒收           actual 含 '../../outside/evil.ts','src/../../escape.ts'
```

## 无红态的两条（如实标注，不伪造红）

- **B1-W3**：`graph-bootstrap-status-shim.test.mjs` 改造后 **12 tests / 12 pass，零红**。
  审查的结论本就是「实现本身安全，只是测试没进 catch」——旧用例走 `-e` 形态，
  `process.argv[1]` 是 `undefined`，守卫在 `if (entry === undefined) return false` 就提前返回了，
  `realpathSync` 的 catch 分支一次都没执行过。新用例显式把 `process.argv[1]` 改写成不存在的路径
  强制进 catch，实现照旧正确。**这是覆盖缺口的修补，不是缺陷修复**，因此没有红态可取。
- **B1-C6**：门禁自身的缺陷，不是产品代码缺陷，故无产品红态。其红态形态是
  「旧的 4 项固定清单 ⊉ CLI 入口的真实 import 闭包」——`git-change-classifier.mjs` 在闭包里却从未
  被三段扫描扫过。改为闭包解析后，固定清单退化为「闭包 ⊇ 清单」的下限断言，
  并新增「闭包必须递归到 canonical」的断言（防"闭包化"只是换了个名字）。
- **B1-W6**：纯措辞（`4 条` → `固定条目 / N 条`），无行为变化，无红态。
- **B1-W5**：按裁决**不修**（Git pattern 固有残余，写入 spec 残余声明由 verify 复核）。
