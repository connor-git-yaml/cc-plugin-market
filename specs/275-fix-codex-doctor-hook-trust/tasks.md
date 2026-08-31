# 任务分解 — F275 doctor hook-trust 对齐 Codex 插件主路径

> Mode: fix。基于 `plan.md`（582 行，权威方案）§8 实施顺序展开。任务编号连续递增，
> 依赖关系按 §8 Phase 顺序 + 主编排器追加硬约束排列。所有验证命令均在
> `/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/vigorous-mahavira-7de572` 下执行。

## 基线（本卡开工前实测，用于最终归因对比）

- `npx vitest run`：**7957 passed / 0 failed**（544 文件）
- `npm run repo:check`：pass（1 条既存 warning：图 stale）
- `npm run release:check`：valid（1 条既存 warning：publish-gap indeterminate）

---

## Phase 1 — core.mjs 纯函数层（plan §3.1 / §8 Phase 1）

### T001 [core] 新增 `HOOK_TRUST_PROBES` 枚举值 `'app-server-hooks-list'`

- **目标**：在 `HOOK_TRUST_PROBES` 常量数组首位追加 `'app-server-hooks-list'`。
- **落点**：`plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs`（`HOOK_TRUST_PROBES` 定义处，约 L76-80）。
- **完成判据**：
  ```bash
  node -e "const m = await import('./plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs'); if (!m.HOOK_TRUST_PROBES.includes('app-server-hooks-list')) process.exit(1);" --input-type=module
  ```
  退出码 0。
- **依赖**：无。

### T002 [core] 新增 5 条 `SUMMARY_TEMPLATES`

- **目标**：新增 `hook-trust-native-untrusted` / `hook-trust-native-modified` / `hook-trust-native-trusted` / `hook-trust-native-managed` / `hook-trust-native-probe-failed`（后者带 `errorClass` 参数，复用既有 `enum:errorClass` 类型）。文案措辞不得出现"hooks.json 已存在"（plan §3.1 已给出理由：合并器路径前提不成立时不能说出不成立的事实）。
- **落点**：同上文件 `SUMMARY_TEMPLATES` 定义处（约 L619 附近）。
- **完成判据**：
  ```bash
  node -e "
    const m = await import('./plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs');
    const codes = ['hook-trust-native-untrusted','hook-trust-native-modified','hook-trust-native-trusted','hook-trust-native-managed','hook-trust-native-probe-failed'];
    for (const c of codes) { if (!(c in m.SUMMARY_TEMPLATES)) { console.error('missing', c); process.exit(1); } }
    if (!/hooks\.json 已存在/.test(m.SUMMARY_TEMPLATES['hook-trust-native-untrusted'].toString?.() ?? JSON.stringify(m.SUMMARY_TEMPLATES['hook-trust-native-untrusted']))) process.exit(0);
    process.exit(1);
  " --input-type=module
  ```
  退出码 0；人工核对新增 5 条文案均不含字面"hooks.json 已存在"。
- **依赖**：T001（同一常量区域改动，避免并发写冲突）。

### T003 [core] 逐字回填 `grant-hook-trust` 的 `text` 字段

- **目标**：`REMEDIATION_TEMPLATES.grant-hook-trust.text` 替换为下方逐字文本，`command` 保持 `null`：
  ```
  在目标 CODEX_HOME 下启动 Codex，输入 /hooks；选择标记为 untrusted 或 modified 的事件并按 Enter；确认命令与来源后，按界面提示的小写 t 授予当前哈希信任。显示 Trust Trusted 后退出并重跑 doctor。若没有显示 "Press t to trust"，不要猜测按键，按 Esc 返回并人工排查。
  ```
- **落点**：`plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs`（`REMEDIATION_TEMPLATES` 的 `grant-hook-trust` 键，约 L708）。
- **完成判据**（与 T062 一手记录逐字 diff，机械验证）：
  ```bash
  node -e "
    import fs from 'node:fs';
    const m = await import('./plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs');
    const src = fs.readFileSync('specs/240-codex-runtime-closeout/verification/t062-manual-report-2026-08-31.md', 'utf-8');
    const block = src.split('~~~text')[1].split('~~~')[0].trim();
    const actual = (m.REMEDIATION_TEMPLATES['grant-hook-trust'].text ?? '').trim();
    if (actual !== block) { console.error('MISMATCH'); console.error('expected:', JSON.stringify(block)); console.error('actual  :', JSON.stringify(actual)); process.exit(1); }
    if (m.REMEDIATION_TEMPLATES['grant-hook-trust'].command !== null) process.exit(1);
    console.log('MATCH');
  " --input-type=module
  ```
  输出 `MATCH`，退出码 0。
- **依赖**：无（与 T001/T002 可并行，但同文件建议顺序合并避免冲突）。

### T004 [core] 扩展 `classifyHookTrust` 新增 `nativeProbe` 入参与三段优先级判定

- **目标**：`classifyHookTrust` 新增可选入参 `nativeProbe: {outcome, errorClass, entries: string[]} | null`，按 plan §2 三段优先级实现：
  1. `outcome==='found'` 且 `entries.length>0` → 按取严聚合（`untrusted` > `modified` > `managed`→`indeterminate` > 全 `trusted`）；协议漂移防御——任一 entry 不属于 `{managed,untrusted,trusted,modified}` 四值闭集 → 整体判 `error`/`parse-failed`，不进入聚合分支。
  2. `outcome` 为明确失败（`rpc-error`/`parse-failed`/`ETIMEDOUT` 等 errorClass）→ `indeterminate` + `hook-trust-native-probe-failed` + `manual-investigate`，**不回退合并器**。
  3. 其余情形（`absent` / `not-executable` / `not-probed` / `nativeProbe===null`）→ 原有四分支逻辑逐字不变（作为 fallback）。
  返回的 `probes` 数组统一追加 `{id:'app-server-hooks-list', outcome, errorClass}` 作为第 4 条留痕。**原有四分支代码本体不得改动一个字符**（只允许把它从"唯一路径"包进"第 3 优先级分支"的条件判断里）。
- **落点**：同文件 `classifyHookTrust` 函数（约 L863-958）。
- **完成判据**：
  ```bash
  npx vitest run tests/unit/codex-runtime-doctor.test.ts -t "classifyHookTrust"
  ```
  （若尚无对应 `-t` 过滤命中，用 T005 新增的纯函数用例文件/describe 块名替代）零失败；且：
  ```bash
  git diff --unified=0 plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs | grep -c '^-' 
  ```
  人工核对 diff 中删除行只涉及"包裹条件"而非改写原四分支内部逻辑（无法完全机械化，需人工读 diff 确认）。
- **依赖**：T001, T002, T003。

### T005 [core] 新增 `classifyHookTrust` 纯函数单测（不依赖 io/helper 层）

- **目标**：在 `tests/unit/codex-runtime-doctor.test.ts` 新增独立 describe 块，直接调用 `core.classifyHookTrust(...)`（不经 `io.runDoctor`），覆盖：
  - `nativeProbe=null` → 走原四分支（回归锚，与现有行为逐字一致）
  - `outcome='found', entries=['untrusted',...]` → `untrusted`/`warning`/`grant-hook-trust`
  - `outcome='found', entries` 含 `'modified'` 无 `untrusted` → `modified`/`warning`
  - `outcome='found', entries` 含 `'managed'` 无 `untrusted`/`modified` → `indeterminate`/`hook-trust-native-managed`
  - `outcome='found', entries` 全 `'trusted'` → `trusted`/`ok`/`remediation=null`
  - `outcome='found', entries` 含闭集外的第 5 个值 → 协议漂移防御，`error`/未进入聚合
  - `outcome` 明确失败（如 `rpc-error`）→ `indeterminate`/`hook-trust-native-probe-failed`/`manual-investigate`
- **落点**：`tests/unit/codex-runtime-doctor.test.ts`。
- **完成判据**：
  ```bash
  npx vitest run tests/unit/codex-runtime-doctor.test.ts
  ```
  全绿；且新增 describe 块至少 7 个 `it`（用 `grep -c "it("` 粗核对新增数量 ≥7）。
- **依赖**：T004。

**Phase 1 止点（对应 plan §8 Phase 1）**：`npx vitest run tests/unit/codex-runtime-doctor.test.ts` 全绿，含 T005 新增纯函数用例，既有用例零回归。

---

## Phase 2 — 新增独立探针 helper 文件（plan §3.2b / §8 Phase 2）

### T006 [helper] 定位并确认复用仓内既有 `isInvokedDirectly` 实现

- **目标**：确认 `plugins/spec-driver/scripts/lib/is-invoked-directly.mjs` 导出 `isInvokedDirectly(moduleUrl)`，新 helper 文件必须 `import { isInvokedDirectly } from './is-invoked-directly.mjs';` 复用，**不得**自行用 `fileURLToPath` 手写比较（F246 教训：会丢 query/hash 导致语义回退）。
- **落点**：无代码改动，本任务是前置核实（供 T007 引用）。
- **完成判据**：
  ```bash
  grep -c "export function isInvokedDirectly" plugins/spec-driver/scripts/lib/is-invoked-directly.mjs
  ```
  输出 `1`。
- **依赖**：无。

### T007 [helper] 新增 `codex-hooks-list-probe.mjs`

- **目标**：新增独立、可作为子进程直接 `node` 执行的探针 helper，实现 plan §3.2b 全部符号：
  - `buildHooksListRequest(projectRoot)`：按 plan §4.6 逐字构造两行 NDJSON（`id:1 initialize` + `id:2 hooks/list`），不加 `jsonrpc` 字段、不加 `notifications/initialized`。
  - `isOwnPluginHookEntry(entry)`：§1.3 三层判据（`source==='plugin'` 为前置门；`isOwnedEntry(entry.command)` / `pluginId==='spec-driver'||pluginId?.startsWith('spec-driver@')` / `sourcePath` 匹配 `plugins/cache/<market>/spec-driver/<ver>/hooks/hooks.json`），`import { isOwnedEntry } from './codex-hooks-schema.mjs';`。
  - `readAppServerResponse(spawnFn, projectRoot, deadlineMs)`：默认 `spawnFn = node:child_process.spawn`，可注入；异步 `spawn('codex', ['app-server'], {stdio:['pipe','pipe','ignore']})`；写入请求后**不主动关闭 stdin**；逐行按 `id===2` 匹配响应，跳过无关通知；命中或到达 deadline 后**主动 `child.kill('SIGKILL')`**（不用 `SIGTERM`——F268 教训：SIGTERM 可能被忽略而穿透超时）；返回 `{kind:'ok',response}` / `{kind:'timeout'}` / `{kind:'spawn-error',errorClass}`；**必须挂 `child.on('error', ...)` 监听器**（F269 教训：缺失时 ENOENT 会抛 uncaught 异常且 `'close'` 永不来，导致 helper 挂死）；触碰原始流的代码段用唯一标记注释 `/* RAW-IO-SITE-BEGIN */` … `/* RAW-IO-SITE-END */` 包裹。
  - `deriveResult(response, projectRoot)`：按 `data[].cwd===projectRoot` 找目标条目，过滤 `isOwnPluginHookEntry`，按 `RAW_NATIVE_TRUST_VALUES` 校验每条 `trustStatus`，产出 `{outcome, errorClass, entries}`；只读结构化字段做布尔/枚举判断，从不把 `sourcePath`/`pluginId`/`command`/`key` 写进返回值。
  - `main(argv)`：解析 `argv[2]` 为 `projectRoot`；串起以上函数；`try/catch` 兜底任何未预期异常统一落 `{outcome:'error', errorClass:'unknown', entries:[]}`；`process.stdout.write(JSON.stringify(result))`；`process.exit(0)`（恒为 0，失败信息编码进 `outcome`/`errorClass`，不用非零退出码）。
  - 文件末尾用 T006 复用的 `isInvokedDirectly(import.meta.url)` 门禁包裹 `main()` 调用。
- **落点**：`plugins/spec-driver/scripts/lib/codex-hooks-list-probe.mjs`（新文件）。
- **完成判据**：
  ```bash
  node -e "const m = await import('./plugins/spec-driver/scripts/lib/codex-hooks-list-probe.mjs'); for (const k of ['buildHooksListRequest','isOwnPluginHookEntry','readAppServerResponse','deriveResult']) if (typeof m[k] !== 'function') process.exit(1); console.log('OK');" --input-type=module
  ```
  输出 `OK`；且：
  ```bash
  grep -c "RAW-IO-SITE-BEGIN" plugins/spec-driver/scripts/lib/codex-hooks-list-probe.mjs
  grep -c "child.on('error'" plugins/spec-driver/scripts/lib/codex-hooks-list-probe.mjs
  grep -c "SIGKILL" plugins/spec-driver/scripts/lib/codex-hooks-list-probe.mjs
  ```
  三条均 ≥1。
- **依赖**：T006。

### T008 [helper] 【硬约束 1】ENOENT 场景下 helper 不挂死 —— `spawn` error 监听器行为验证

- **目标**：单测注入一个必定 ENOENT 的可执行名（假 `spawnFn` 内部真实 `spawn('__definitely_not_exist_f275__', ...)` 或直接构造触发 `'error'` 事件的场景），断言 `readAppServerResponse`（或经由它的 `main()`）在 deadline 内以确定性结果返回 `{outcome:'error', errorClass:'ENOENT'}`（或等价归约），**不挂起、不抛未捕获异常**。
- **落点**：`tests/unit/codex-hooks-list-probe.test.ts`（新文件，本任务先落这一条用例，其余用例见 T009）。
- **完成判据**：
  ```bash
  npx vitest run tests/unit/codex-hooks-list-probe.test.ts -t "ENOENT"
  ```
  零失败，且用例设有显式 timeout（如 `it('...', async () => {...}, 5000)`）防止真挂死时测试无限挂起而非报错。
- **依赖**：T007。

### T009 [helper] 补全 `codex-hooks-list-probe.test.ts` 其余用例（plan §7.2b）

- **目标**：在 T008 基础上补齐：
  - own-entry：仅 `pluginId` 命中 → 计入聚合
  - own-entry：仅 `sourcePath` 命中 → 计入聚合
  - own-entry：仅 `command` 命中（精确匹配 `OWNED_HOOK_SCRIPT_SUFFIXES` 某一项）→ 计入聚合
  - own-entry 误判防御：`source==='user'` 但 `sourcePath`/`command` 字面像我方路径 → **不计入**
  - 协议漂移防御：命中条目 `trustStatus` 为四值之外的第 5 个字符串 → 整体 `outcome:'error'`，不猜测聚合
  - `initialize` 响应缺失/畸形（假子进程 stdout 只回一条无 `id` 字段的通知）→ 视为未拿到 `id:2`，走 deadline 分支
  - deadline 触发：假子进程从不产出 `id:2` → 到达 `HOOKS_LIST_DEADLINE_MS` 后返回超时结果，且**断言假子进程确实收到 kill 信号**（断言 `kill` mock 被以 `'SIGKILL'` 调用，而非仅调用了 `kill`）
- **落点**：`tests/unit/codex-hooks-list-probe.test.ts`。
- **完成判据**：
  ```bash
  npx vitest run tests/unit/codex-hooks-list-probe.test.ts
  ```
  零失败；`grep -c "it(" tests/unit/codex-hooks-list-probe.test.ts` ≥ 8（含 T008 的 1 条）。
- **依赖**：T008。

### T010 [helper] 【硬约束 2】强杀 SIGKILL 生效性验证 —— deadline 到达后进程确实被回收

- **目标**：独立断言（可并入 T009 的 deadline 用例或单列）：deadline 到达后，helper 对假子进程调用的信号确实是 `'SIGKILL'`（而非 `'SIGTERM'`），且 helper 自身在 deadline + 合理余量内完成返回（不挂死）。用一个"忽略 SIGTERM 但会被 SIGKILL 杀死"的假子进程双工对象验证——若 helper 误用 SIGTERM，该用例必须能检测到（假子进程持续存活/deadline 超时未回收）。
- **落点**：`tests/unit/codex-hooks-list-probe.test.ts`。
- **完成判据**：
  ```bash
  npx vitest run tests/unit/codex-hooks-list-probe.test.ts -t "SIGKILL"
  ```
  零失败，且用例内存在显式断言 `expect(killMock).toHaveBeenCalledWith('SIGKILL')`（或等价形式，明确排除 `'SIGTERM'`）。
- **依赖**：T009。

### T011 [helper] 真实子进程冒烟测试（PATH 注入假 `codex` shell stub，不调用真机 codex）

- **目标**：在临时目录放一个 shell 脚本充当假 `codex`（读 stdin、按固定短延迟回两行 NDJSON 模拟 `id:1`/`id:2` 响应），把该临时目录**注入到子进程的 `PATH` 环境变量最前面**（不修改真实全局 PATH），真跑 `execFileSync(process.execPath, [helperPath, projectRoot], {env: {...process.env, PATH: tmpDir + ':' + process.env.PATH}})`。断言：打印的 stdout 可被 `JSON.parse`、`outcome` 符合预期、退出码为 0。证明 argv 解析、真实 spawn、JSON 打印、`process.exit(0)` 整条链路接得通。**该用例全程不得调用真机上安装的 `codex` 二进制**（若本机 PATH 已有 codex，测试构造的临时 PATH 必须优先于它且用例需断言假 stub 确实被命中，例如让 stub 输出一个仅它才会产出的可辨识 canary 字段并断言解析结果反映了该 canary，或断言 stub 脚本的调用计数/日志文件被写入）。
- **落点**：`tests/unit/codex-hooks-list-probe.test.ts`。
- **完成判据**：
  ```bash
  npx vitest run tests/unit/codex-hooks-list-probe.test.ts -t "真实子进程"
  ```
  零失败；且额外验证「无 codex 环境下仍绿」（见 T012）覆盖到本用例。
- **依赖**：T009。

### T012 [硬约束 3] PATH 无 codex 环境下全套单测仍绿

- **目标**：显式验证 `tests/unit/codex-hooks-list-probe.test.ts`（以及后续 Phase 3 的 `codex-runtime-doctor.test.ts`）在**PATH 完全不含真实 `codex` 二进制**的受控环境下全绿——所有 io 层用例走 `exec` 注入缝喂造响应，helper 层用例用注入的假 `spawnFn`，T011 的冒烟测试用注入 PATH 的 shell stub。
- **落点**：无代码改动，独立验证任务。
- **完成判据**：
  ```bash
  npx vitest run tests/unit/codex-hooks-list-probe.test.ts --env PATH="$(dirname "$(command -v node)")"
  ```
  （即构造一个只含 node 所在目录、不含任何真实 `codex` 的最小 PATH 后运行）零失败。若 vitest CLI 不支持 `--env` 直接覆盖进程 PATH，改用：
  ```bash
  PATH="$(dirname "$(command -v node)")" npx vitest run tests/unit/codex-hooks-list-probe.test.ts
  ```
  零失败，且退出码 0。
- **依赖**：T011。

**Phase 2 止点（对应 plan §8 Phase 2）**：`npx vitest run tests/unit/codex-hooks-list-probe.test.ts` 独立全绿（不依赖 io.mjs 改动），含 T008/T010/T011/T012 全部通过。

---

## Phase 3 — io.mjs 薄封装改动（plan §3.2 / §8 Phase 3）

### T013 [io] `codex-runtime-doctor-io.mjs` 新增薄封装调用链

- **目标**：按 plan §3.2 实现：
  - 新增 `import { fileURLToPath } from 'node:url';`；**不再**导入 `codex-hooks-schema.mjs`（该导入已移进 helper）。
  - 新增常量 `HOOKS_LIST_PROBE_HELPER_PATH`、`APP_SERVER_HOOKS_LIST_TIMEOUT_MS = 8000`、`RAW_NATIVE_TRUST_VALUES`。
  - 新增函数 `probeAppServerHooksList(exec, projectRoot)`：`runCommand(exec, process.execPath, [HOOKS_LIST_PROBE_HELPER_PATH, projectRoot], {timeout: APP_SERVER_HOOKS_LIST_TIMEOUT_MS})` → `JSON.parse` → allowlist 只读 `outcome`/`errorClass`/`entries` 三键，`entries` 每项须属于 `RAW_NATIVE_TRUST_VALUES` 闭集，任何形状不符 → 统一归约为 `{outcome:'error', errorClass:'parse-failed', entries:[]}`。**不得**包含任何 RPC 请求构造 / JSON-RPC 响应解析 / own-entry 判据代码。
  - `buildHookTrustCheck` 签名改为 `{codexHome, roots, exec}`，内部新增一次 `probeAppServerHooksList` 调用，结果作为 `nativeProbe` 传给 `classifyHookTrust`；**读 `hooksJson`/`config.toml` 的既有代码逐字不动**（无论 RPC 结果如何都照常执行）。
  - `runDoctor` 调用点改为 `buildHookTrustCheck({ codexHome, roots, exec })`。
  - **结构性约束**：本文件新增代码不得出现任何 `.stdout`/`.stderr` 字面属性访问（`process.stdout`/`process.stderr` 除外）——与既有 `probeMcpServerBuild`/`probeCodexDoctorChecks` 同构，只解析命令的正常返回值文本。
- **落点**：`plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs`（`buildHookTrustCheck` 约 L1262-1311，`readHooksJson` L1242-1260 保留不动）。
- **完成判据**：
  ```bash
  grep -n "\.stdout\|\.stderr" plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs | grep -v "process\.stdout\|process\.stderr"
  ```
  输出为空（退出码非 0 表示 grep 未命中即通过；若用 `| wc -l` 需为 `0`）；且：
  ```bash
  grep -c "import.*codex-hooks-schema" plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs
  ```
  输出 `0`。
- **依赖**：T007（helper 文件必须先存在，`HOOKS_LIST_PROBE_HELPER_PATH` 才有意义）。

### T014 [io] `codex-runtime-doctor.test.ts` 测试基础设施小改 —— `makeExec` 加 `process.execPath` 键

- **目标**：确认现有按文件名分派的 `makeExec(table)` 直接加 `[process.execPath]` 键即可区分新调用（无需扩展支持按 `(file,args)` 分派——plan §7.1 已确认不需要）。
- **落点**：`tests/unit/codex-runtime-doctor.test.ts`（测试 helper 区域，若已支持则本任务只需核实并在描述中注明"无需改动"）。
- **完成判据**：
  ```bash
  grep -n "makeExec" tests/unit/codex-runtime-doctor.test.ts | head -5
  ```
  人工核对新增 `[process.execPath]` 分支的写法与既有 `'codex'`/`'spectra'`/`'git'`/`'bash'` 键同构；不引入新的分派参数结构。
- **依赖**：T013。

### T015 [io] 新增三形态 + 边界集成用例（plan §7.2）

- **目标**：在 `tests/unit/codex-runtime-doctor.test.ts` 新增以下用例，全部通过伪造 `makeExec({[process.execPath]: {stdout: JSON.stringify({...})}})` 驱动（不模拟真实 RPC 响应，那是 helper 层职责）：
  - 无插件环境：`{outcome:'absent', errorClass:null, entries:[]}` → 回退合并器，逐字复用现有 T048 断言作为对照锚
  - 仅合并器环境：helper 调用 ENOENT（`process.execPath` 不在表中）→ **【硬约束 5】现有全部 4 个固定状态值断言逐字保持不变，且本用例须显式命名标注"无插件环境不得误报 warning"** —— 断言 `status` 不为 `warning`
  - 原生环境 all untrusted → `status=warning trustStatus=untrusted remediation.code=grant-hook-trust`，`summaryCode=hook-trust-native-untrusted`
  - 含 modified → `status=warning trustStatus=modified`
  - 含 managed（无 untrusted/modified）→ `status=indeterminate trustStatus=indeterminate summaryCode=hook-trust-native-managed`
  - 全 trusted → `status=ok trustStatus=trusted remediation=null`
  - RPC 明确失败（`{outcome:'error', errorClass:'rpc-error', entries:[]}`）**且**合并器侧同时构造成"其实是 trusted" → `status=indeterminate summaryCode=hook-trust-native-probe-failed`；**必须**断言没有采用合并器侧的 trusted 结论（证明优先级真正生效）
  - helper 输出畸形（`entries` 含非闭集值 / 非法 JSON / `outcome` 不在四值内）→ io 层防御性二次校验兜底为 `{outcome:'error', errorClass:'parse-failed'}`
- **落点**：`tests/unit/codex-runtime-doctor.test.ts`。
- **完成判据**：
  ```bash
  npx vitest run tests/unit/codex-runtime-doctor.test.ts
  ```
  全量绿；且专门核对"无插件环境"用例存在且断言 `status !== 'warning'`：
  ```bash
  grep -n "无插件环境\|not.*misreport.*warning\|不得误报" tests/unit/codex-runtime-doctor.test.ts
  ```
  至少命中 1 处。
- **依赖**：T013, T014.

**Phase 3 止点（对应 plan §8 Phase 3）**：
```bash
npx vitest run tests/unit/codex-runtime-doctor.test.ts
```
全量绿，既有断言逐字未改。

---

## Phase 4 — redaction 守卫扩展（plan §3.2b 第 4 点 / §4.4 / §7.3 / §8 Phase 4）

### T016 [redaction] 【硬约束 6a】`sources` 新增第 4 个扫描对象 `probeHelper`

- **目标**：在 `codex-runtime-doctor-redaction.test.ts` 顶部 `sources` 对象新增第 4 个键 `probeHelper: fs.readFileSync(PROBE_HELPER_PATH, 'utf-8')`，`PROBE_HELPER_PATH = path.join(repoRoot, 'plugins/spec-driver/scripts/lib/codex-hooks-list-probe.mjs')`，使其自动被现有全部结构性静态守卫用例（DETAILS_SCHEMA 检查、`err.message`/`err.stack` 零命中检查、`.stdout`/`.stderr` 零容忍检查、裸 NUL 字节检查、密钥特征正则禁用检查等）覆盖。**现有 12 个注入点不得修改**。
- **落点**：`tests/unit/codex-runtime-doctor-redaction.test.ts`（`sources` 定义处，约 L566）。
- **完成判据**：
  ```bash
  grep -n "probeHelper" tests/unit/codex-runtime-doctor-redaction.test.ts | head -3
  ```
  至少命中 `sources` 定义处 1 条；且：
  ```bash
  npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts
  ```
  （此时预期会因新文件含 `.stdout`/`.stderr` 相关代码而失败，属预期中间态，留给 T017 收口）。
- **依赖**：T007（新文件已存在）。

### T017 [redaction] 【硬约束 6b】新增 `withoutDeclaredRawIoSite()` 剥离函数 + 标记对唯一性断言

- **目标**：
  1. 新增 `withoutDeclaredRawIoSite(text)`：用正则 `/\/\* RAW-IO-SITE-BEGIN \*\/[\s\S]*?\/\* RAW-IO-SITE-END \*\//` 一次性去掉标记区块，与既有 `withoutOwnStdio()` 剥离 `process.stdout`/`process.stderr` 手法同构。
  2. 在"`.stdout`/`.stderr` 零容忍"用例中，**仅对 `sources.probeHelper` 应用该剥离**后再做 `.includes('.stdout')`/`.includes('.stderr')` 检查；`core`/`io`/`cli` 三个来源继续保持零豁免（不使用该剥离函数）。
  3. 新增独立断言：`(sources.probeHelper.match(/RAW-IO-SITE-BEGIN/g) ?? []).length === 1`，且 `BEGIN`/`END` 数量严格相等（各恰好 1 次）。
- **落点**：`tests/unit/codex-runtime-doctor-redaction.test.ts`。
- **完成判据**：
  ```bash
  npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts -t "stdout"
  npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts -t "RAW-IO-SITE"
  ```
  零失败；且人工核对 `core`/`io`/`cli` 三个来源的 `.stdout`/`.stderr` 检查代码路径未新增豁免分支（`git diff` 中这三处判断逻辑零改动）。
- **依赖**：T016.

### T018 [redaction] 【硬约束 6c】io 层防御性二次校验测试

- **目标**：伪造 `process.execPath` 调用返回一个"看起来合法但夹带额外字段"的 JSON（例如混入一个 `sourcePath` 键，或 `entries` 数组里塞一个对象而非字符串），跑与 §7.2 同款五通道断言（`.details` 键 allowlist、summary 参数、序列化输出等），确认这些多余字段不会被 `probeAppServerHooksList` 的 allowlist 放行、不出现在最终 `check.details`/序列化报告中。
- **落点**：`tests/unit/codex-runtime-doctor-redaction.test.ts`。
- **完成判据**：
  ```bash
  npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts -t "helper"
  ```
  零失败；用例断言最终报告序列化字符串不含注入的额外字段名（如 `sourcePath`）。
- **依赖**：T013（io 层改动已就绪）, T017.

### T019 [redaction] 【硬约束 6d】helper 层行为性 canary 测试

- **目标**：假 `spawnFn` 返回的 `hooks/list` 响应中，一条能被 `command` 判定为"我方"的条目，其 `sourcePath`/`pluginId`/`key` 三个字段均嵌入现有 `CANARY`/`HEX_CANARY`/`HEX40_CANARY` 三个常量（复用文件既有四种编码 `encodedForms`），断言 helper（`deriveResult` 或经 `readAppServerResponse` → `deriveResult` 全链路，或经由 `main()` 打印到 stdout 的最终 JSON）字符串里**不包含**任何编码形式的 canary。这是行为性测试，不依赖词法扫描，用于防"换个变量名绕开字面扫描"的手法。
- **落点**：`tests/unit/codex-runtime-doctor-redaction.test.ts`（新增测试块，复用文件顶部已定义的 `CANARY`/`HEX_CANARY`/`HEX40_CANARY`/`encodedForms`）。
- **完成判据**：
  ```bash
  npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts -t "canary"
  ```
  零失败；用例内对全部编码形式（`FORMS`/`HEX_FORMS`/`HEX40_FORMS`）逐一 `expect(...).not.toContain(...)`。
- **依赖**：T007, T017.

### T020 [redaction] 全量回归 + 现有 12 个注入点零回归确认

- **目标**：确认 T016-T019 改动后，`codex-runtime-doctor-redaction.test.ts` 现有 12 个注入点用例（既有的 `it(...)` 覆盖 mcp-server/global-cli/plugin-build/repo-version 各类目的 canary 注入）无一处被修改或删除。
- **落点**：无代码改动，验证任务。
- **完成判据**：
  ```bash
  git diff tests/unit/codex-runtime-doctor-redaction.test.ts | grep '^-' | grep -v '^---' | grep -c "CANARY\|HEX_CANARY\|HEX40_CANARY"
  ```
  人工核对该计数对应的删除行均为"新增代码周边格式调整"而非"删除既有注入点断言"（不能仅靠数字判定，需人工读 diff）；并跑：
  ```bash
  npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts
  ```
  零失败。
- **依赖**：T019.

**Phase 4 止点（对应 plan §8 Phase 4）**：`npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts` 全量绿，含既有 12 个注入点零回归，标记对唯一性断言通过。

---

## Phase 5 — CLI 确认 + 全仓门禁 + 墙钟实测（plan §8 Phase 5）

### T021 [cli] `codex-runtime-doctor-cli.test.ts` 确认跑通（预期零改动）

- **目标**：确认该文件无需改动——其 fixture 本就在 PATH 上不放 `codex`，helper 调用 `codex` 时同样 ENOENT，走 §2 第 3 优先级回退分支，行为与实施前一致。
- **落点**：无代码改动。
- **完成判据**：
  ```bash
  git diff --stat tests/unit/codex-runtime-doctor-cli.test.ts
  ```
  输出为空（零改动）；且：
  ```bash
  npx vitest run tests/unit/codex-runtime-doctor-cli.test.ts
  ```
  零失败。
- **依赖**：T013, T015.

### T022 [回归护栏] F240 FR-012 脱敏零回退确认

- **目标**：确认 `DETAILS_SCHEMA['hook-trust']` 未新增键、值级 typed schema / allowlist 纪律未被削弱。
- **落点**：无代码改动，验证任务。
- **完成判据**：
  ```bash
  npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts -t "DETAILS_SCHEMA"
  ```
  零失败；且：
  ```bash
  git diff plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs | grep -A5 "DETAILS_SCHEMA\['hook-trust'\]"
  ```
  人工核对该键无新增字段。
- **依赖**：T004, T013.

### T023 [回归护栏] F262 W2 词法扫描边界（`hasHooksStateSection`）零回退确认

- **目标**：确认 `hasHooksStateSection`/`deriveHooksStateProbe` 零改动（§1.4 裁决：不引入新用法）。
- **落点**：无代码改动，验证任务。
- **完成判据**：
  ```bash
  git diff plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs | grep -c "hasHooksStateSection\|deriveHooksStateProbe"
  ```
  输出 `0`（即该函数定义未出现在 diff 中）；且相关既有测试：
  ```bash
  npx vitest run tests/unit/codex-runtime-doctor.test.ts -t "hooks.state"
  ```
  零失败（若无匹配 `-t` 名称，改为跑全量该文件确认相关 describe 块存在且通过）。
- **依赖**：T013.

### T024 [回归护栏] F265 doctor commit 比对零回退确认

- **目标**：确认本卡改动与 F265 的 `COMMIT_COMPARISONS`/`baselineCommit`/`buildDirty` 及 `mcp-server`/`repo-version`/`global-cli`/`plugin-build` 四类目零交集。
- **落点**：无代码改动，验证任务。
- **完成判据**：
  ```bash
  npx vitest run tests/unit/codex-runtime-doctor.test.ts -t "commit"
  ```
  零失败（若 `-t` 无匹配，改跑全量该文件并人工确认相关 describe 块通过）。
- **依赖**：T013.

### T025 [回归护栏] F264 双注册守卫（`codex-plugin-registration.mjs`）零回退确认

- **目标**：确认 `codex-plugin-registration.mjs`、`install-codex-hooks.mjs` 零改动；`codex-hooks-schema.mjs` 零改动（消费方从 `io.mjs` 变为 `codex-hooks-list-probe.mjs`，该文件自身零改动）。
- **落点**：无代码改动，验证任务。
- **完成判据**：
  ```bash
  git diff --stat plugins/spec-driver/scripts/lib/codex-plugin-registration.mjs plugins/spec-driver/scripts/install-codex-hooks.mjs plugins/spec-driver/scripts/lib/codex-hooks-schema.mjs
  ```
  输出为空（三文件均零改动）；且：
  ```bash
  npx vitest run tests/unit/codex-plugin-registration.test.ts tests/unit/codex-hooks-schema.test.ts
  ```
  （文件名以仓内实际测试文件名为准，若命名不同用 `find tests/unit -iname "*plugin-registration*" -o -iname "*hooks-schema*"` 定位后跑）零失败。
- **依赖**：T007, T013.

### T026 [全仓门禁] `npx vitest run` 全仓零失败

- **目标**：全仓单测零失败，且相对基线（7957 passed / 0 failed / 544 文件）核对新增测试数量与文件数变化。
- **落点**：无代码改动。
- **完成判据**：
  ```bash
  npx vitest run
  ```
  退出码 0，输出摘要中 failed 数为 0；记录新的 passed 总数与文件数，与基线对比只应增不应减。
- **依赖**：T001-T025 全部完成。

### T027 [全仓门禁] `npm run test:plugins` 零失败

- **目标**：插件专属测试套件（覆盖 `.mjs` 源文件本身，含新增 helper）零失败。
- **落点**：无代码改动。
- **完成判据**：
  ```bash
  npm run test:plugins
  ```
  退出码 0。
- **依赖**：T026.

### T028 [全仓门禁] `npm run build` 零错误

- **目标**：类型检查/构建零错误。
- **落点**：无代码改动。
- **完成判据**：
  ```bash
  npm run build
  ```
  退出码 0。
- **依赖**：T026.

### T029 [全仓门禁] `npm run repo:check` 零新增 warning/error

- **目标**：确认相对基线（1 条既存 warning：图 stale）不新增额外 warning 或 error。
- **落点**：无代码改动。
- **完成判据**：
  ```bash
  npm run repo:check
  ```
  退出码 0，输出的 warning 数量与内容和基线一致（除既存"图 stale"外无新增）。
- **依赖**：T028.

### T030 [全仓门禁] `npm run release:check` 零新增 warning/error

- **目标**：确认相对基线（1 条既存 warning：publish-gap indeterminate）不新增额外 warning 或 error。
- **落点**：无代码改动。
- **完成判据**：
  ```bash
  npm run release:check
  ```
  退出码 0（或 valid 状态），warning 内容与基线一致。
- **依赖**：T029.

### T031 [实测] 典型墙钟耗时实测（对照 §4.5 超时常量假设）

- **目标**：在正常环境（本机已安装 `codex`）下实测一次 `npm run codex:doctor`（或等价 CLI 调用）端到端耗时，核对 §5 风险项 3 的"预期数百毫秒~1-2 秒"假设是否成立；若显著偏离（远超 2 秒或触发 8000ms 外层超时），记录实测数值供后续调整 §4.5 常量（本卡不强制回头改常量，但必须如实记录，不得省略此步）。
- **落点**：无代码改动，产出实测记录（写入本任务的执行日志或 verification 目录，不要求单独文件，但需在交付报告中体现具体数值）。
- **完成判据**：
  ```bash
  time npm run codex:doctor
  ```
  （或仓内实际暴露的等价命令）记录 `real` 耗时数值；若命令不存在，改用直接跑 CLI 脚本：
  ```bash
  time node plugins/spec-driver/scripts/codex-runtime-doctor.mjs
  ```
  产出的耗时数值必须被记录在最终交付报告中，不得省略。
- **依赖**：T013, T007.

**Phase 5 止点（对应 plan §8 Phase 5）**：T021-T031 全部通过，`npx vitest run`/`npm run build`/`npm run repo:check` 零失败，墙钟实测数值已记录。

---

## Phase 6 — SC-013 人工复测（plan §8 Phase 6 / §7.5，implement 完成后单独执行）

### T032 [人工] SC-013 三段人工复测

- **目标**：按 T062 报告已记录的隔离环境搭建步骤重跑三段：`untrusted→trusted` 真实迁移、`modified` 观测、`remediation` 有效性（本卡回填的逐字文案是否可真实指导操作）。
- **落点**：`specs/240-codex-runtime-closeout/verification-report.md`（追加 SC-013 复测节）+ `specs/275-fix-codex-doctor-hook-trust/verification/`（本卡自身留痕）。
- **完成判据**：人工验证，非机械可判；产出物为两份文档更新，需记录 codex-cli 版本号、隔离 CODEX_HOME 路径、三段各自 PASS/FAIL 结论。
- **依赖**：T001-T031 全部完成（implement 阶段代码已定型）。**此任务不属于本次 implement 范围，留待环境恢复后单独执行**（与主编排器运行时上下文一致：M9 遗留 T062/T063 同类"人工验证待办"模式）。

---

## 范围外（明确不生成实施任务）

- `hook-script-integrity` advisory check（脚本字节完整性可观测性）——fix-report 缺陷 3(b) 已裁决"本卡不实施，派生独立卡"，**tasks 中不出现其实施任务**。
- `managed` 值域的完整语义确认、`--force-hooks` 双路径并存联合诊断、`codex-plugin-registration.mjs` 判据统一改造、CI `--strict` 接入 hook-trust 阻断信号、暴露原生 `sourcePath`、`config-toml-hooks-state` 接入 §2 第 1/2 优先级——均按 plan §6 维持"范围外"裁决，不生成任务。

---

## FR 覆盖映射表

| plan 章节 / 硬约束来源 | 对应任务 |
|---|---|
| plan §3.1 `HOOK_TRUST_PROBES` 追加 | T001 |
| plan §3.1 `SUMMARY_TEMPLATES` 新增 5 条 | T002 |
| plan §3.1 `grant-hook-trust` 文案（硬约束 7） | T003 |
| plan §3.1 `classifyHookTrust` 三段优先级 | T004, T005 |
| plan §3.2b helper 全部符号 | T006, T007 |
| 硬约束 1（spawn error 监听器 / ENOENT 不挂死） | T008 |
| plan §7.2b 全部用例 | T009 |
| 硬约束 2（SIGKILL 强杀） | T010 |
| plan §7.2b 真实子进程冒烟测试 | T011 |
| 硬约束 3（无 codex 环境全套单测仍绿） | T012 |
| plan §3.2 io.mjs 薄封装 | T013 |
| plan §7.1 测试基础设施（`makeExec` 加键） | T014 |
| plan §7.2 三形态 + 边界用例（含硬约束 5：无插件环境不误报 warning） | T015 |
| plan §4.4 / §7.4(c) `sources` 新增第 4 个扫描对象（硬约束 6a） | T016 |
| plan §4.4 `withoutDeclaredRawIoSite` + 标记对唯一性（硬约束 6b） | T017 |
| plan §7.3(a) io 层防御性二次校验（硬约束 6c） | T018 |
| plan §7.3(b) helper 层行为性 canary（硬约束 6d） | T019 |
| 12 个既有注入点零回归 | T020 |
| plan §7.4 CLI 测试确认 | T021 |
| 硬约束 8：F240 FR-012 零回退 | T022 |
| 硬约束 8：F262 W2 零回退 | T023 |
| 硬约束 8：F265 commit 比对零回退 | T024 |
| 硬约束 8：F264 双注册守卫零回退 | T025 |
| 硬约束 9：`npx vitest run` 全仓 | T026 |
| 硬约束 9：`npm run test:plugins` | T027 |
| 硬约束 9：`npm run build` | T028 |
| 硬约束 9：`npm run repo:check` | T029 |
| 硬约束 9：`npm run release:check` | T030 |
| plan §4.5 / §8 Phase 5 墙钟实测 | T031 |
| plan §7.5 SC-013 人工复测 | T032 |
| 硬约束 4（复用既有 `isInvokedDirectly`） | T006（前置核实），T007（消费） |
| 硬约束 10（`hook-script-integrity` 范围外） | 显式列入"范围外"章节，无实施任务 |

---

## 依赖关系总览

```
T001 → T002 → T003 → T004 → T005                         [Phase 1]
T006 → T007 → T008 → T009 → T010                          [Phase 2]
                    → T011 → T012
T007 → T013（依赖 T007 提供 helper 路径）→ T014 → T015     [Phase 3]
T007,T013 → T016 → T017 → T018
                        → T019 → T020                       [Phase 4]
T013,T015 → T021
T004,T013 → T022
T013 → T023, T024
T007,T013 → T025
T001..T025(全部) → T026 → T027 → T028 → T029 → T030        [Phase 5 门禁]
T013,T007 → T031
T001..T031(全部) → T032（人工，implement 范围外）           [Phase 6]
```

## 并行机会

- Phase 1（T001-T005）与 Phase 2（T006-T012）互不依赖同一文件，**可并行**（core.mjs 改动 vs 新 helper 文件）。
- Phase 4 的 T022-T025（回归护栏确认）互相独立，**可并行**。
- Phase 5 的 T027/T028 在 T026 通过后**可并行**（build 与 test:plugins 互不阻塞），T029/T030 需顺序（repo:check 可能依赖 build 产物新鲜度）。

## 推荐实施策略

顺序推进 Phase 1 → 2 → 3 → 4 → 5，Phase 1/2 内部任务链较短可由同一执行者连续完成；Phase 4 的护栏扩展（T016-T020）涉及防泄漏结构性防线，按 plan §9 升级为门禁/判定器类审查档位（异构对抗，commit message 显式标注"Codex 审查暂停，异构档位缺席"），审查重点：(a) RAW-IO-SITE 豁免范围是否只覆盖必要代码，(b) `deriveResult` 是否存在字段逃逸路径，(c) helper `main()` 是否有分支把未捕获异常的 `.message`/`.stack` 打到 stdout。Phase 6（T032）为人工任务，明确排除在本次自动化 implement 范围之外。
