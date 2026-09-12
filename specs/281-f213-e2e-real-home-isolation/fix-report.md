# F281 · F213 e2e 真实家目录隔离 + cwd 独立（`feature-213-codex-plugin-install.e2e.test.ts`）

> 模式：spec-driver-fix（主线程实施 + 独立子代理对抗复审 + verify 子代理）。类别：测试资产（非门禁），一般生产代码档位。

## 1. 问题与证据

- **现象**：`npx vitest run` 全量在主 checkout 稳定 1 红——`feature-213 … CODEX_HOME unset → 默认 ~/.codex` 场景，`expect(spectraServer.transport.command).toBe('spectra')` 实得 `'node'`（F282 门禁记录：39 s 后失败）；同一测试在任何 worktree 全绿（F280 worktree 门禁 8186 passed / 0 failed；主 checkout 同日 F282 门禁 8180 passed / 1 failed，唯一红即本用例）。红绿取决于"在哪个目录跑"。
- **根因（5-Why）**：
  1. 断言失败 ← `codex mcp list --json` 里 spectra 的 command 是 `node` ← 主 checkout 仓根有**未跟踪、机器专属**的项目级 `.codex/config.toml`（`[mcp_servers.spectra] command="node" args=[<repo>/dist/cli/index.js, mcp-server]`）覆盖了插件注册的 `command="spectra"`；
  2. 项目级配置生效 ← 子进程以仓根为 cwd 启动（`spawnSync('codex', …)` 无 `cwd`），且用户真 `~/.codex/config.toml` 把该仓登记为 trusted（Codex 只对 trusted 项目加载项目级配置）；
  3. 真家目录参与 ← unset 场景的"默认 `~/.codex`"就是**用户真实家目录**：测试每跑一次都在真 `~/.codex` 里 add marketplace / add 两个插件 / remove——测试在读写用户状态，只是碰巧一直"清理干净"。
- **实证（探针，本机 codex）**：`HOME=<tmp>` + cwd=仓根 → `No MCP servers configured yet`（项目级配置**不生效**）；真 HOME + cwd=`/tmp` → 列出真家目录登记的 server（verify 复核实得 8 个，首稿写 4 个是数错）；`HOME=<tmp>` 下 codex 自建 `<tmp>/.codex/`。

## 2. 修复（加不改：原断言逐字保留）

`tests/e2e/feature-213-codex-plugin-install.e2e.test.ts`：
1. 每个场景 `mkdtemp` 一个 `isolatedHome`，子进程 `env.HOME = isolatedHome`——默认场景的 `~/.codex` 落到 `<isolatedHome>/.codex`（默认路径派生语义不变），真家目录与其 trusted 登记对 codex 不可见；`effectiveCodexHome = injectedCodexHome ?? join(isolatedHome, '.codex')`。
2. `spawnSync` 固定 `cwd: fixtureRoot`——仓根的项目级 `.codex/config.toml` 不参与。
3. 清理链新增 `rm 临时 HOME`（步数 default 5→6、custom 6→7）；临时目录（fixtureRoot / isolatedHome / 自定义 CODEX_HOME）全部改在 `beforeAll` 创建——`describe.skipIf` 跳过时 describe 体仍求值、afterAll 不跑，收集期 mkdtemp 会让无 codex 的机器每跑一次全量泄漏 5 个空目录（对抗复审 W-1 / verify R1 同时实测）；`spawnSync` 加 30 s timeout（对抗复审 I-8）；W4 的"cache 是否删对目录"守卫改在 `rm plugins/cache/<market>` 之后、删整个临时家目录**之前**取证（`cacheResidueAfterRm`），否则家目录整体删掉后 `existsSync(...)===false` 恒真、守卫空转。
4. `.gitignore` 追加 `.codex/config.toml`（机器专属、含绝对路径的 MCP 覆盖；`.codex/skills/**` 仍跟踪）。

## 3. 红先行 / A/B

- 红：主 checkout 全量门禁（F282，2026-09-12）该场景失败（`'node' !== 'spectra'`，39 s）；绿：改后在 worktree 2/2 通过（约 0.4 s，墙钟随机器波动）且真 `~/.codex/plugins/cache/` 零 `cc-plugin-market-e2e-*` 残留。
- 判别性 A/B（主 checkout = 真家目录 trusted + 项目级 config 在场的环境）：见 verification/（改前红、改后绿在同一环境）。

## 4. 影响范围与边界

- 只改 e2e 测试与 `.gitignore`；不改产品代码、不改 Codex 配置。
- `hasCodexBinary()` 探测与 `describe.skipIf` 不变（CI 无 codex 仍整体 skip）。
- 已知边界：`HOME` 覆盖只对子进程生效（父进程 `homedir()` 仍是真家目录，故测试内不再使用 `homedir()`）；codex 在临时 HOME 下若需要读 auth（plugin 操作实测不需要）会以未登录态运行；Windows `USERPROFILE` 未处理（本 e2e 依赖 `which codex`，仅 POSIX）。

## 5. 审查档位

一般生产代码（测试资产）：主线程自审 + 1 独立子代理对抗复审（Codex 配额暂停期）；verify 子代理独立复核。结论见 §7 与 verification/。

## 6. 工具使用反馈（Dogfooding）

- Spectra MCP：未用——改动面是单个 e2e 测试 + gitignore，根因靠对 `codex` 二进制做环境探针，无代码结构问题。
- Spec Driver：主线程按 fix 骨架推进，未调用编排器 SKILL（用户要求本 session 内直接执行）。无实质工具反馈，不落账。

## 7. 对抗复审 + verify 处置（2026-09-12）

对抗复审（独立子代理，10 个变异副本 + 真家目录前后哈希取证）：**0 CRITICAL / 2 WARNING / 8 INFO**，可合入；verify 子代理：**PASS**（T001–T005 全 PASS）。

| # | 档 | 发现 | 处置 |
|---|---|---|---|
| W-1 / verify R1 | WARNING | `describe.skipIf` 跳过时 describe 体仍求值、afterAll 不跑：无 codex 的机器每跑一次全量泄漏 5 个空临时目录（3 既有 + 本卡 +2） | 修：三处 mkdtemp 全部移入 `beforeAll`（skip 态零落盘），头注释登记 |
| W-2 | WARNING | 反向守卫注释 over-claim：它保证的是「rm 作用于 marketCachePath 且删净」，A/B 分歧实际由安装期正向检查承担（变异 M3 实测） | 修：注释改口，标明两道守卫缺一不可 |
| I-2 | INFO | `cwd: fixtureRoot` 是双保险非必需（HOME 隔离后 trusted 为空，项目级配置本就不加载） | 注释标明双保险，保留 |
| I-8 | INFO | `spawnSync` 无 timeout；codex 对临时目录 HOME 打 "Refusing to create helper binaries" WARNING（exit 0） | 修：加 30 s timeout；WARNING 登记为已知（方向 fail-loud） |
| I-1 / I-3 / I-5 / I-6 / I-7 | INFO | 隔离成立（临时 HOME 下 mcp list 空、login status 未登录、XDG 不读）；Codex 0.153.4 仅对精确登记 trusted 的项目根加载项目级配置；失败路径步数一致；并发双跑零残留；gitignore 只锚仓根、无已跟踪副本 | 登记 |
| verify 数字瑕疵 | INFO | 首稿「4 个 server」实得 8；「8186 passed」是 F280 worktree 门禁而主 checkout 是 8180+1；437 ms 不可复现 | §1/§3 已改口 |
| verify R6 | INFO | M10 文档早期把 command=node 归因到「perplexity 等」与实证不符 | 主线程核对 M10 §11 措辞（见 commit） |
