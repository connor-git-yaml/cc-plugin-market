## 总体判断

**不可以进入 verify 收口阶段。** 在 `ccb2308..f0d94ef` 中确认了 **5 项 CRITICAL**。其中 Volta CLI 解析、symlink containment、构建成功误判均已用只读实验复现；另外两项可由确定性控制流直接证伪。

## CRITICAL

### C1. Volta 环境中全局 `spectra` 实际不可被 Node 子进程找到

- **问题**：shell 的 `command -v spectra` 成功，但通过 Volta shim 启动 Node 后，Volta 会从子进程 `PATH` 中移除自身 shim 目录。helper 使用裸命令名 `spectra`，因此 freshness 永远降级，`--attempt-build` 永远失败。
- **证据**：[graph-bootstrap-status.mjs:203](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/graph-bootstrap-status.mjs:203)、[graph-bootstrap-status.mjs:250](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/graph-bootstrap-status.mjs:250)、[sync-worktree-local-state.sh:521](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:521)、[sync-worktree-local-state.sh:566](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:566)。
- **已验证复现**：

  ```text
  command -v spectra
  /Users/connorlu/.volta/bin/spectra

  node → spawnSync("spectra")
  error.code = ENOENT

  check-freshness
  {"state":"unknown-provenance","reason":"spectra-cli-missing",...}
  ```

  传入绝对路径 `/Users/connorlu/.volta/bin/spectra` 后，同一图立即返回 `fresh`。
- **测试盲区**：[graph-bootstrap-status.test.ts:291](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/graph-bootstrap-status.test.ts:291) 始终注入绝对 fake CLI；真实 smoke [graph-bootstrap-status.test.ts:363](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/graph-bootstrap-status.test.ts:363) 又把 `unknown-provenance` 当作合法结果，因此在 CLI 根本没启动时仍为绿。
- **修法**：shell 先执行 `SPECTRA_BIN="$(command -v spectra)"`，把绝对路径同时传给 `check-freshness` 和 `attempt-build`。增加一个会移除 Volta shim PATH 的 Node wrapper 测试，并要求真实 smoke 的 `reason` 不得是 `spectra-cli-missing`。

### C2. containment 可被中间 symlink 和 `git check-ignore` 128 绕过

- **问题**：实现只有词法过滤，没有规范化后的物理 containment。`git check-ignore` 的 128 被当作“未拒绝”；shell 的 `-f` 和 Node 的 `lstat` 都会穿过中间 symlink。目标父目录为 symlink 时，`copy_path` 会写到 worktree 外。
- **证据**：[sync-worktree-local-state.sh:395](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:395)、[sync-worktree-local-state.sh:405](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:405)、[sync-worktree-local-state.sh:429](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:429)、[worktree-local-state-core.mjs:92](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/worktree-local-state-core.mjs:92)、[worktree-local-state-core.mjs:117](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/worktree-local-state-core.mjs:117)。
- **已验证复现**：仓库现有 `_reference` 就是指向主工作区的 symlink。对 `_reference/graphify/SECURITY.md`：

  ```text
  [[ -f entry ]]                 → true
  git check-ignore --quiet entry → fatal: beyond a symbolic link, exit 128
  lstat(entry).isFile()           → true
  realpath(entry)                 → 当前 worktree 外
  ```

  将它加入清单后，运行时校验和第 14 族都接受它；`copy_path` 随后经目标父 symlink 写出 worktree。最终条目本身是 symlink 时，shell 也会接受，而 Node validator 会拒绝，形成运行时/门禁漂移。
- **修法**：

  - `check-ignore` 只允许状态 0；除明确非 git 模式外，1 和 128 都应拒绝。
  - 对 manifest、本侧 source、目标路径的每一个已存在路径组件执行 `lstat`，拒绝任意 symlink；或使用 `realpath` 后做带路径分隔符、Darwin 大小写归一化的 containment。
  - 同时校验 `PRIMARY_ROOT` 和 `CURRENT_ROOT`，且必须在任何读写前完成。
  - 增加 final symlink、intermediate symlink、target-parent symlink、git 128、manifest 自身 symlink 的真实测试。

### C3. `--dry-run --attempt-build` 会真实构建并写图

- **问题**：dry-run 只传给状态写入；构建分支没有检查 `DRY_RUN`。当两侧无图时，dry-run 会真实启动 `spectra batch --mode graph-only`。
- **证据**：[sync-worktree-local-state.sh:562](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:562)、[sync-worktree-local-state.sh:592](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:592)。
- **确定性证伪场景**：准备无 graph 的 worktree，fake `spectra batch` 写 marker，然后执行：

  ```bash
  bash scripts/sync-worktree-local-state.sh --dry-run --attempt-build
  ```

  当前控制流必定调用 fake CLI 并产生 marker。现有 dry-run 测试 [sync-worktree-local-state.test.ts:1013](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/sync-worktree-local-state.test.ts:1013) 没有带 `--attempt-build`。
- **修法**：dry-run 分支只报告拟执行命令，绝不能 spawn。增加 marker/call-count 断言，并验证图、状态、sidecar、后台进程均无变化。

### C4. 子进程 exit 0 被直接认定构建成功，即使没有图或后台 worker 仍在写

- **问题**：构建成功仅等于直接子进程 `code === 0`。没有验证 graph 是否存在、可解析或可查询。若 launcher 启动后台 worker 后立即 exit 0，deadline 被清除，整个进程组不再回收。
- **证据**：[graph-bootstrap-status.mjs:294](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/graph-bootstrap-status.mjs:294)、[graph-bootstrap-status.mjs:100](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/graph-bootstrap-status.mjs:100)。
- **已验证复现**：使用 `/usr/bin/true` 作为 `spectraBin`，且 `/tmp/specs/_meta/graph.json` 不存在，结果为：

  ```json
  {
    "outcome": {"ok": true},
    "graphExists": false,
    "bootstrapSource": "local-build"
  }
  ```

  现有测试甚至明确锁定了这种错误语义：[graph-bootstrap-status.test.ts:446](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/graph-bootstrap-status.test.ts:446)。孙进程测试 [graph-bootstrap-status.test.ts:416](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/graph-bootstrap-status.test.ts:416) 刻意让直接父进程持续存活，没有覆盖“父进程快速成功退出”。
- **修法**：`ok:true` 必须同时要求 graph 为常规文件、JSON 可解析且通过最小可查询性检查。直接子进程退出后若进程组仍存在，应等待构建产物稳定或 deadline，再清理整个组。`bootstrapSource=local-build` 只能在上述条件成立时设置。

### C5. freshness 没有任何 deadline，可无限阻塞整个 sync/hook

- **问题**：`checkFreshness` 使用无 timeout 的 `spawnSync`。全局 wrapper 卡死、CLI 死锁或子进程不退出时，sync 永远不会进入其 `|| true`，直接违反 SC-001 的 60 秒上限。
- **证据**：[graph-bootstrap-status.mjs:203](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/graph-bootstrap-status.mjs:203)、[sync-worktree-local-state.sh:521](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:521)。
- **确定性证伪场景**：fake `spectra` 执行 `while true; do sleep 1; done`，再运行普通 sync。当前实现没有任何能结束它的路径。本次未实际启动该无限进程，以遵守只读审查约束。
- **修法**：freshness 也应使用异步 detached 进程组和独立短 deadline，或至少用能可靠终止整个进程树的有界执行器；超时统一返回 `unknown-provenance` 并显示 warning。

## WARNING

### W1. `publish_exclusive` 把所有 `ln` 错误伪装成“对方已发布”

- **问题**：EEXIST、EXDEV、EACCES、EROFS、EMLINK 等全部进入同一成功降级文案。正常调用的 tmp 与 target 位于同一目录，因此通常不会 EXDEV；但原语和测试 probe 接受任意路径，合同描述仍然不成立。并发把 target 替换为 symlink-to-directory 时，BSD/GNU `ln` 还可能跟随目录 symlink，在外部目录创建硬链接。
- **证据**：[sync-worktree-local-state.sh:190](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:190)、[sync-worktree-local-state.sh:202](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:202)、[sync-worktree-local-state.sh:207](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:207)。
- **假设性复现**：probe 传入不同挂载点的 tmp/target，`ln` 得到 EXDEV，但输出“目标已被其他进程发布”并删除 tmp。symlink race 因只读限制未实际执行。
- **修法**：改用 Node `fs.link` 并检查 errno；只有 `EEXIST` 才代表竞争者发布。发布前后 `lstat` target，使用 no-dereference 语义；tmp 用安全的独占创建并在 `finally` 清理。

### W2. freshness 接受 exit 3、信号退出和任意 `state`，shell 又静默吞掉未知情况

- **问题**：只要 stdout 是可解析 JSON 且含字符串 `freshness.state`，即使退出码 3、被信号杀死或 state 为任意未来/恶意值，也原样返回。shell 的默认分支把这些值和 helper 崩溃产生的空值全部静默处理。
- **证据**：[graph-bootstrap-status.mjs:219](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/graph-bootstrap-status.mjs:219)、[graph-bootstrap-status.mjs:228](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/graph-bootstrap-status.mjs:228)、[sync-worktree-local-state.sh:521](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:521)、[sync-worktree-local-state.sh:524](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:524)。
- **复现**：fake CLI 输出 `{"freshness":{"state":"definitely-ready"}}` 后 `exit 3`；当前 sync 无 warning。
- **修法**：只接受退出码 0/1/2、无 signal、四态枚举内的 state；其余全部转换为带具体 reason 的 `unknown-provenance`。shell 默认分支必须可见告警。

### W3. 状态 rename 失败会残留 temp；broken-symlink sidecar 不会被清理

- **问题**：状态写入没有 `finally`；`renameSync` 失败会留下随机 tmp。`existsSync` 对 broken symlink 返回 false，因此遗留 sidecar symlink 会继续存在。
- **证据**：[graph-bootstrap-status.mjs:172](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/graph-bootstrap-status.mjs:172)、[graph-bootstrap-status.mjs:178](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/graph-bootstrap-status.mjs:178)。
- **复现**：让 status target 为不可替换目录/只读目标，或 seeded legacy sidecar 为 broken symlink。
- **修法**：`try/finally` 清理 tmp；sidecar 用 `lstat` 判断路径对象是否存在，再 `unlink`。

### W4. dry-run 输出的拟状态与真实执行结果不等价

- **问题**：dry-run 的 `publish_exclusive` 返回成功，于是 `graphCopiedThisRun=true`；但图并未真正复制。helper 随后读取真实文件系统中的“无图”状态，可能输出 `bootstrapSource=primary-copy`、`embeddedSourceCommit=null`、`assessable=false`，这不是实际运行会产生的 payload。
- **证据**：[sync-worktree-local-state.sh:194](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:194)、[sync-worktree-local-state.sh:499](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:499)、[graph-bootstrap-status.mjs:123](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/graph-bootstrap-status.mjs:123)。
- **复现**：主仓有合法 graph、worktree 无 graph，运行 dry-run 并检查打印 payload。
- **修法**：dry-run 构造 projected filesystem facts，或明确只报告操作计划，不声称打印最终状态对象。

### W5. 本地图和历史状态采用无界整文件读取/JSON.parse

- **问题**：graph 和 previous status 都整体读入内存；64 MiB 限额只适用于 CLI stdout。超大或恶意 graph 可造成长时间阻塞或 OOM。
- **证据**：[graph-bootstrap-status.mjs:42](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/graph-bootstrap-status.mjs:42)、[graph-bootstrap-status.mjs:75](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/graph-bootstrap-status.mjs:75)。
- **假设性复现**：预置数百 MiB 的 graph JSON 后运行 sync。本次未创建大文件。
- **修法**：先 `stat` 并设置合理上限，超限记 `assessable:false`；或流式提取 `graph.sourceCommit`。

### W6. 并发与 HOME 测试证据不足

- **问题**：“两个 writer”测试实际是串行调用，固定 `${path}.tmp` 的实现也能通过；多数 sync/hook 测试继承真实 HOME，只有 escape matrix 隔离了 HOME，存在读取或链接真实 `~/.claude/projects` 的非密封副作用。
- **证据**：[graph-bootstrap-status.test.ts:199](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/graph-bootstrap-status.test.ts:199)、[sync-worktree-local-state.test.ts:159](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/sync-worktree-local-state.test.ts:159)、[worktree-lifecycle-hook.test.ts:26](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/worktree-lifecycle-hook.test.ts:26)、生产 HOME 访问位于 [sync-worktree-local-state.sh:611](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:611)。
- **复现**：把唯一 tmp 改回固定名，现有串行测试仍绿；在真实 HOME 预置与 fixture slug 碰撞的 memory 目录，普通测试可能建立真实 HOME 下的链接。
- **修法**：使用带 barrier 的独立 writer 进程测试；所有 shell/hook fixture 默认设置临时 HOME，而不是只在 containment 套件设置。

### W7. 第 14 族对异常 manifest 不是结构化失败

- **问题**：只用 `existsSync` 判断 manifest；若 `.worktreeinclude` 是目录或不可读对象，随后 `readFileSync` 直接抛异常，不能返回本族的 `fail/checks/errors`。
- **证据**：[worktree-local-state-core.mjs:150](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/worktree-local-state-core.mjs:150)、[worktree-local-state-core.mjs:168](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/worktree-local-state-core.mjs:168)、接入点 [repo-maintenance-core.mjs:367](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/lib/repo-maintenance-core.mjs:367)。
- **复现**：在隔离仓库把 `.worktreeinclude` 建为目录，运行 `repo:check`。
- **修法**：先 `lstat` 并要求 regular non-symlink file；读取异常转换为该族的结构化 fail。

## INFO / 已验证未发现回归

- CRLF/BOM/末行无换行的 Node 与 Bash parser 逻辑一致；golden matrix 单独读取 `stdout`，stderr 不会混入比较：[worktreeinclude-golden-matrix.test.ts:74](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/worktreeinclude-golden-matrix.test.ts:74)。
- 三个新增 Node 调用点均有 `node_available` 保护；Bash 3.2 所需语法未发现不兼容，两个 shell 文件 `bash -n` 通过。
- `.env.local` 二次覆盖、snapshot 独立补齐、已有 graph 不覆盖、主工作区 no-op 均保留；hook `remove` 分支未被累计 diff 改动：[worktree-lifecycle.sh:32](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/plugins/spec-driver/hooks/worktree-lifecycle.sh:32)。
- 非 git 环境的 ignored 检查降级符合当前合同；把子目录误传为 `projectRoot` 会因根 manifest 缺失而失败，符合参数的 repo-root 语义；CRLF manifest 不会误报。
- `git diff --check ccb2308..f0d94ef`、两个 shell 的 `bash -n`、两个 helper 的 `node --check`、只读 `npm run repo:check -- --json` 均通过。完整 Vitest/build 会写缓存或产物，因此在本次“只读、禁止仓库写入”约束下未运行。
- 审查期间分支被外部推进到 `17aa9bf`；`f0d94ef..HEAD` 未改动本次核心文件，以上结论仍严格基于指定的四个实现 commit。

结论仍为：**先修复 C1–C5，并补齐对应真实边界测试，之后才适合进入 verify。**

工具使用反馈：本会话未暴露可调用的 Spectra MCP，因此结构和影响面审查使用仓库合同、累计 diff 与只读 shell 完成；全局 Spectra CLI 的实际调用反而直接暴露了 C1。Spec Driver 未启动，因为本次是严格只读 review。

Codex session ID: 019fc2c1-861a-7ad2-8b97-32a5492a2ca7
Resume in Codex: codex resume 019fc2c1-861a-7ad2-8b97-32a5492a2ca7
