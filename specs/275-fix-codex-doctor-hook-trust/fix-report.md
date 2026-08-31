# 问题修复报告 — F275 doctor hook-trust 维度对齐 Codex 插件主路径

> 编号说明：卡面预设编号 274 在 `git fetch` 复核时已被上一张卡占用
> （`specs/274-fix-global-setup-cross-worktree-freshness`，commit `e0f41d02`），
> 且基线 commit `d4d73c96` 的 message 本身写明「派生 **F275**」。故本卡取 **275**。
> 卡面所述基线 `0efcf015` 是 `d4d73c96` 的 rebase 前身（同一提交，正文已由「派生 F274」更正为「派生 F275」），基线条件满足。

## 问题描述

T062 人工验证（codex-cli **0.151.0**，隔离 CODEX_HOME）判 **SC-013 FAIL**。Codex 原生三段能力（安装/发现、untrusted→trusted、modified）全部 PASS，
三条缺陷**全部在我方 doctor / spec 侧**：

1. **（主）doctor hook-trust 假阴性**：F264 插件主路径下，原生 `untrusted` / `trusted` / `modified` 三态被 doctor 一律误报 `not-applicable`、`remediation=null`。
2. **remediation 空转**：`grant-hook-trust` 模板文案是「请参考 Codex 官方文档」，无实测可执行步骤；且因误判 not-applicable，运行时根本没返回该模板。
3. **spec 假设被证伪**：FR-009 引 `_grounding.md` §8.3「信任按（脚本）内容哈希绑定，脚本内容变更即失效」——实测 `currentHash` 只覆盖 `hooks.json` 的 hook 声明，**脚本文件改 1 字节仍 trusted**。

SSoT：`specs/240-codex-runtime-closeout/verification-report.md` §T062 + `verification/t062-manual-report-2026-08-31.md`（1890 行一手记录，全部 RPC/doctor 原始输出在案）。

---

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 原生 untrusted 时 doctor 为何报 `not-applicable`？ | `classifyHookTrust` 的第二个分支：`if (!hooksJsonPresent) → not-applicable`（[core.mjs:896](plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs:896)）。而 F264 守卫**正确地**跳过了合并器写入，`$CODEX_HOME/hooks.json` 本就不存在。 |
| Why 2 | 判定为何以 `$CODEX_HOME/hooks.json` 的存在性为前提？ | `buildHookTrustCheck` 只有两个信息源：`$CODEX_HOME/hooks.json` 与 `$CODEX_HOME/config.toml` 的 `[hooks.state]` 段（[io.mjs:1262-1296](plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs:1262)）。二者都是**合并器路径**的产物。 |
| Why 3 | 为何只覆盖合并器路径？ | F240 实施期（doctor 落地）的事实前提是「Codex 不读插件内 hooks，必须由我方合并器写入 `$CODEX_HOME/hooks.json`」。该前提在 **F264** 被 `hooks/list` 探针**实证推翻**（插件内 hooks 被原生注册，5 条→叠装 10 条）。 |
| Why 4 | F264 推翻前提后，为何 doctor 没有跟随？ | F264 的收敛面是**安装侧**（双注册守卫，防止叠装），改的是 `codex-plugin-registration.mjs` / `codex-hooks-installer.mjs`。**诊断侧**的 hook-trust 判据与安装侧无代码耦合，普查未覆盖到——这是本仓反复出现的「按卡面改动面、不做同前提影响面普查」回归模式（F272 已登记同型根因）。 |
| Why 5 | 为何自动化测试没捕获？ | 现有 3 个 doctor 测试文件的 hook-trust 用例**全部以合并器形态构造 fixture**（写 `$CODEX_HOME/hooks.json` + `config.toml`），插件主路径这一形态**在测试语料中根本不存在**。断言与实现共享同一个错误世界模型，全绿证明不了任何事。真正的探测手段（app-server `hooks/list`）在 `_grounding.md` §4.3 早已记录可用，但从未接线——`probeAppServerRpc` 只跑到 `codex debug app-server --help`（[io.mjs:695](plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs:695)），是**可执行性**探测，不取数据。 |

**Root Cause**：hook-trust 判据绑定在一个**已被 F264 证伪的世界模型**上（「hooks 只可能来自我方合并器写入的 `$CODEX_HOME/hooks.json`」）。插件原生注册路径下该文件本就不存在，于是「文件不在」这一确定性事实被翻译成了「信任状态不适用」——而它真实的含义只是「合并器路径没启用」。

**Root Cause Chain**：doctor 报 not-applicable → `!hooksJsonPresent` 分支 → 判据只有合并器两源 → F240 前提「Codex 不读插件 hooks」→ F264 已推翻但诊断侧未跟随 → 测试 fixture 与实现共享同一错误前提，全绿无守护力。

### 根因的一个二阶推论（对修法的约束）

「文件不在 ⇒ not-applicable」与「插件路径不存在 ⇒ 不适用」**在观测上同形**。这意味着新探针不能只做加法（「查到插件 hook 就报」），
还必须把**探测本身失败**与**确证没有插件 hook**区分开——否则修完主路径会在无插件环境反向造出误报。这正是 F264 记录的
「判不出 ⇒ 按启用算」词法盲区的镜像面，是本卡最主要的回归风险。

---

## 活体可行性探针（本卡新增证据，2026-08-31）

在隔离 CODEX_HOME 下驱动 `codex app-server`（stdio JSON-RPC）实测，确认三件事：

| 观察 | 结果 |
|---|---|
| 探测通道形态 | `codex app-server`（**无子命令**，stdio）→ 写 `{id:1,method:"initialize",params:{clientInfo:{name,version}}}`，再写 `{id:2,method:"hooks/list",params:{cwds:[<projectRoot>]}}`。`codex debug app-server send-message-v2` **不是**入口（它只发用户消息，`<USER_MESSAGE>` 位置参数）。 |
| 无插件环境 | `hooks/list` 返回 `{"data":[{"cwd":...,"hooks":[],"warnings":[],"errors":[]}]}` —— **空列表，不是报错**。 |
| 无认证环境 | 同上，`auth.json` 缺失**不影响** `hooks/list`。doctor 在未登录机器上仍可探测。 |
| 响应流干扰 | 请求响应之间夹杂无关通知（`configWarning` / `remoteControl/status/changed`）。解析**必须按 `id` 匹配**，不得按行序取第 N 行。 |

### 进程生命周期（Phase 0 追加实测，2026-08-31）

plan 阶段正确地指出 fix-report 首版只确证了**协议内容**、未确证**进程生命周期**。补测三个变体（均无插件、无 `auth.json`）：

| 变体 | 形态 | 结果 |
|---|---|---|
| A | `spawnSync(..., {input: INIT+'\n'+LIST+'\n'})`（立即 EOF） | `status=0`、**43ms 自然退出**；但 stdout 只有 `id:1` + 两条通知，**`id:2` 从未返回** |
| B | 只发 `hooks/list`，不发 `initialize` | `status=0`，stdout **完全为空** → `initialize` 是强制前置 |
| C | 异步 `spawn`，写入两行后**持有 stdin 1000ms / 3000ms 再 `end()`** | 两档均 `status=0`、自然退出，`id:2` **完整返回** |

**结论**：进程确实在 stdin EOF 后自然退出（退出码 0，无需 kill），但 `execFileSync` 的 `input:` 形态会在 `hooks/list` 处理完成前触发关闭——
**不是「不退出」，是「退得太早」**。可用形态必须**持有 stdin 直到 `id:2` 到达或触达 deadline**。1000ms 是观测到成功的最小档，**不是下界**（下界未测）。

这一条直接约束实现形态：`runDoctor` 是同步的，而可用形态需要异步持有 stdin。且现有 redaction 测试有一条结构性守卫——
生产三文件（core/io/cli）全文禁止出现 `.stdout` / `.stderr` 属性读取（`process.stdout` 除外）。二者叠加使实现形态成为本卡的**主要设计裁决点**（见 plan §4）。

### 一条独立发现：`config.toml` 承载信任记录

核对 T062 报告中 doctor 的 `config-toml-hooks-state` 探针在三个时点的 outcome：授信前（报告 L307）`absent`；
UI 授信后（L1340）与恢复 hooks.json 后（L1604）均 `found`。即 **Codex 在用户授信时会把 `[hooks.state...]` 段写进 `$CODEX_HOME/config.toml`**，
现有 `hasHooksStateSection` 已能读到。

**但其能力边界必须写清**：它只能区分「有无信任记录」，**区分不了 trusted vs modified**（判 modified 需比对 `currentHash`，
该哈希由 Codex 对 hooks.json 声明按未知归一化算法计算，§9.7 明令不得猜测解析）。因此它**不能替代 RPC**，
只能作为补充信号或降级依据——纳入时必须说清它证明得了什么、证明不了什么，否则它会变成新的伪确定性来源。

### 协议合同

可机械获取（`codex app-server generate-json-schema --out <DIR>`），关键值域：

- `HookTrustStatus` = `managed` / `untrusted` / `trusted` / `modified`（**四**值，含我方 `TRUST_STATUSES` 里没有的 `managed`）
- `HookSource` = `system` / `user` / `project` / `mdm` / `sessionFlags` / `plugin` / `cloudRequirements` / `cloudManagedConfig` / `legacyManagedConfigFile` / `legacyManagedConfigMdm` / `unknown`
- `HookMetadata.required` = `currentHash, displayOrder, enabled, eventName, isManaged, key, source, sourcePath, timeoutSec, trustStatus`（`pluginId` **非必填**）

> 一次性 dump 不入库；重算器 = 上述 `generate-json-schema` 命令 + 探针脚本（见 tasks 阶段落点）。

---

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs` | `buildHookTrustCheck` L1262-1311 | 判据只喂合并器两源 | 新增 `hooks/list` 探针作为第一信息源，与合并器源合并 |
| 同上 | `readHooksJson` L1242-1260 | — | **保留**（合并器 fallback 路径仍需） |
| `plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs` | `classifyHookTrust` L863-958 | 纯函数只有两源入参 | 扩入参：新增插件侧 trust 观测；分支优先级重排 |
| 同上 | `HOOK_TRUST_PROBES` L76-80 | 固定探针 id 枚举 | 新增 app-server 探针 id（枚举是闭合集，不加则新探针的 probe 记录违反 SC-012 值级校验） |
| 同上 | `TRUST_STATUSES` L143-149 | 缺 `managed` | **待裁决**：`managed` 是 Codex 侧真实值域成员，我方枚举无对应项 |
| 同上 | `REMEDIATION_TEMPLATES` `grant-hook-trust` L708 | 文案无实测步骤 | 逐字回填 T062 实测文本 |
| 同上 | `hook-trust-modified` summary L619 | — | 复核措辞与实测语义（哈希绑定的是**声明**不是脚本字节） |
| 同上 | hook-trust `details` schema L436-440 | 键 allowlist + 值级类型 | 新增字段须走受限类型构造器（FR-012 不回退） |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `codex-runtime-doctor-io.mjs` | `probeAppServerRpc` L684-700 | 只跑 `--help`，记可执行性 | **安全**（其语义就是可执行性探测，服务于 plugin-build 维度；本卡不改其语义，但可复用其 `runCommand` 基建） |
| `codex-plugin-registration.mjs` | 全文 | 判「是否已被原生注册」，读 config.toml + cache 目录 | **需评估**：与本卡「插件 hook 是否存在」高度同源但**判据不同**（它是词法台账，本卡是运行时实况）。是否统一由 plan 裁决；**倾向不统一**——F264 终版判据是刻意的词法边界，换成 RPC 会改变其安全方向 |
| `codex-hooks-schema.mjs` | L42 注释 | 描述「经 RPC hooks/list 回读恰返回这 10 条」 | **安全**（注释，非判据） |

### 同步更新清单

- **调用方**：`runDoctor` 需把 `exec`（或新的 RPC 能力）与 `projectRoot` 传进 `buildHookTrustCheck`（当前只传 `codexHome, roots`）。
- **测试**：`tests/unit/codex-runtime-doctor.test.ts`（hook-trust 全部用例需补插件形态）、`codex-runtime-doctor-redaction.test.ts`（RPC stdout 是**新的 canary 注入面**，FR-012 五通道八注入点需扩）、`codex-runtime-doctor-cli.test.ts`。
- **文档**：`specs/240-codex-runtime-closeout/verification-report.md` 追加复测节（卡面明确授权）。
- **合同**：doctor 输出 `schemaVersion` 是否 bump —— 见下「待裁决项」。

---

## 修复策略

### 方案 A（推荐）：新增 `hooks/list` 探针作为**优先信息源**，合并器源降为 fallback

判定优先级（三形态互不误伤）：

1. **RPC 探到 ≥1 条我方 `source=plugin` 条目** → 由这些条目的 `trustStatus` 聚合定状态（取严：任一 `untrusted` → untrusted；否则任一 `modified` → modified；否则全 trusted/managed → trusted）。
2. **RPC 成功且我方插件条目为 0** → 插件路径确证未启用 → **退到现有合并器判据**（hooks.json 在不在 / `[hooks.state]` 段）。这一条是「无插件环境不得误报 warning」的承重分支。
3. **RPC 失败/不可解析** → 不得静默退到 fallback 后报 `not-applicable`（那是把「没探到」伪装成「确定没有」）。分两种：
   - `codex` 二进制不存在（ENOENT）→ 有正向证据「无 Codex 运行时 ⇒ 无 Codex hook」，可落 `not-applicable`；
   - 二进制在但 RPC 报错/超时/解析失败 → **`indeterminate`** + 固定 probe id/reason（FR-009 第三情形）。

- 优点：与 FR-009 三情形合同直接对齐；保留合并器路径不回退；新旧两条路径的证据在 `attemptedProbes` 里各自留痕。
- 代价：doctor 需 spawn 一个真实 app-server 进程（需超时 + 强杀 + 不继承 stdout 到报告）。

### 方案 B（备选）：只改 `not-applicable` 的措辞，不接 RPC

把 summary 改成「合并器路径未启用；插件路径未探测」并落 `indeterminate`。

- 优点：改动极小，无进程 spawn。
- 缺点：**不满足 FR-009**（三情形固定状态值一条都给不出），SC-013 第 1/2 段仍无法达成，M9 A4 不闭合。**不采纳**，仅作为 RPC 不可用时的降级形态参考。

### 待裁决项（交 plan 阶段收口，必要时回用户）

1. **`managed` 值域**：Codex 侧 `HookTrustStatus` 含 `managed`（企业托管，用户无法自行授信）。我方 `TRUST_STATUSES` 无此项。选项：(a) 加入枚举并映射为 `status: ok`（托管即生效）；(b) 归入 `trusted`（丢失信息）；(c) 归入 `indeterminate`（保守但对托管用户是噪声）。**倾向 (a)**，但需确认 `managed` 是否蕴含「已生效」——本轮**无实测**，不得凭猜测接线；无实测则按 §9.7 惯例落 `indeterminate` 并记 probe。
2. **`schemaVersion` bump**：新增 `attemptedProbes` 条目 + 可能新增 `details` 键。既有合同里 probe id 是闭合枚举，消费者若按枚举穷举则属破坏性变更。按既有合同评估，倾向 **bump**，由 plan 给出依据。
3. **我方条目的识别判据**：按 `pluginId === 'spec-driver@<marketplace>'` 还是 `source === 'plugin'` 且 `sourcePath` 落在插件 cache 下？`pluginId` 在 schema 中**非必填**——单靠它会漏。这是新探针自身的词法盲区面，须在对抗审查中打。

---

## remediation「逐字一致」的口径裁决（2026-08-31，实施期发现）

验收项要求「remediation 文案与实测记录逐字 diff 一致」。实施中发现**两处 SSoT 自身就不一致**，差异仅在一对引号：

| 来源 | `Press t to trust` 外围引号 | 字节 |
|---|---|---|
| `verification/t062-manual-report-2026-08-31.md` L1825（一手记录） | 弯引号 `“ ”` | `e2 80 9c` / `e2 80 9d` |
| `verification-report.md` L23（聚合报告） | 直引号 `" "` | `22` |

除此之外两行**逐字节相同**。

**裁决：取直引号**，依据两条：

1. 卡面点名的权威来源是 `verification-report.md`（「逐字使用 **verification-report.md** 记录的实测文本」），该文件用直引号。
2. 更根本地，**UI 原文本身不含引号**——一手记录 L1375 的逐字 UI 转录是 `Press t to trust; esc to go back`。
   两份报告里的引号都是作者的**引述装置**，不是被观察到的 UI 文本。因此引号形态不属于 FR-009
   「未经实测的步骤不得写入」所约束的对象，取用直引号不构成对观察范围的超出；直引号还避免了弯引号在
   不同编辑器/终端下的编码歧义。

配套修正：`tasks.md` T003 的机械判据脚本用 `split('~~~text')[1]` 定位围栏，而该文档有 5 处 `~~~text` 围栏，
该写法取到的是 L333 的无关块（Hooks 生命周期说明）而非 L1824-1826。判据脚本需按行号或按内容锚定重取。

---

## 对抗审查后的主线程终版裁决（2026-08-31，四路审查合并收口）

四路审查（spec-review / quality-review / 异构对抗×2：假阴性面、误报面）合计 9 CRITICAL / 11 WARNING。
两路对抗的核心张力：误报面证明 `outcome==='error'` 无条件短路在无插件机器上制造 `indeterminate`+warning 噪声（含只读 CODEX_HOME、
旧版 Codex、EACCES、NODE_OPTIONS 污染四种实证形态）；假阴性面证明 `not-executable` 无条件回退在 F264 主路径（hooksJson 不存在）上
复活原始 bug 形态（装了插件 + PATH 无 codex → 报「不适用」）。二者统一解法是**引入第三个证据维度做 tie-break**：
`$CODEX_HOME/plugins` 目录 / `plugins/cache/*/spec-driver` 的存在性（纯文件读，零新进程）。

### 终版判定矩阵（classifyHookTrust 新合同）

| nativeProbe.outcome | hooksJsonPresent | 我方插件 cache 证据 | 结论 |
|---|---|---|---|
| `found`（≥1 条我方条目） | — | — | 按 entries 聚合取严：untrusted > modified > managed(→indeterminate) > trusted |
| `absent`（RPC 成功、结构完好、确证无我方条目） | 任意 | — | 回退合并器判据（现状） |
| `not-probed`（前置门跳过，见下） | false | false | `not-applicable`（probe 诚实留痕「没探」） |
| `not-executable` / `error` | **true** | — | **回退合并器判据**（合并器结论可判定，RPC 失败仅 probe 留痕；消误报 C-2） |
| `not-executable` / `error` | false | **true** | **`indeterminate`** + manual-investigate（装了插件但原生路径探不成；消假阴性 C4） |
| `not-executable` / `error` | false | false | **`not-applicable`**（无任何插件证据；消误报 C-1 的只读 home 噪声） |

**前置门**（spawn 前，消误报 C-4 写副作用 + 6s 白等）：`$CODEX_HOME/plugins` 目录不存在 **且** hooksJson 不存在 → 跳过 RPC，
probe 记 `not-probed`。门判据刻意用粗粒度（`plugins` 目录而非 `cache/*/spec-driver`），使 Codex 未来改 cache 布局时门仍放行、
细判据只用于 tie-break——门误拦的失败方向是回到 F275 前行为且有 `not-probed` 诚实留痕。

### 逐条裁决表

| 来源 | 发现 | 裁决 |
|---|---|---|
| spec C1 | `hook-trust-native-modified` 文案含被证伪因果「脚本内容变更导致」 | **修**：改为实测支撑的表述（信任绑定的 hook 声明内容已变更）；同根的合并器旧文案 `hook-trust-modified` 同步中性化（fix-report 影响面表本就登记了该同源项；FR-009 对 remediation 字段的措辞约束不涉 summary） |
| 假阴 C1 / 误报 W-4 | `deriveResult` 不读 `warnings[]`/`errors[]`：我方 hooks.json 坏 → hook 全不加载却报「不适用」 | **修**：我方条目为 0 且 warnings/errors 任一条含 `spec-driver` 子串 → `error/rpc-error`（不确定就升 indeterminate 方向，宁噪勿漏） |
| 假阴 C2 | `isOwnedEntry`（command 层）过宽：第三方**插件**条目 command 提及我方路径被认领 → 凭空 `ok/trusted` | **修**：按 source 分层——`source==='plugin'` 只认 pluginId/sourcePath 两层结构化判据（消 C2）；非 plugin 源（user/project，pluginId 恒 null）保留 command 层 `isOwnedEntry`（否则 C3 的合并器/项目级我方条目认不出）。残余：user 源第三方条目 command 提及我方路径仍会被认领，方向是纳入取严聚合（多报 untrusted，不会虚构 trusted），登记接受 |
| 假阴 C3 | `source==='plugin'` 硬门丢弃 user/project 源我方条目；双注册场景（plugin trusted×5 + user untrusted×1）报 `ok` | **修**：去硬门，命中判据即纳入聚合（同上分层后取严 → 双注册报 untrusted） |
| 假阴 C4 / 误报 W-2 W-5 | `not-executable` 回退 + EACCES 归 `unknown` + not-applicable 措辞越界 | **修**：按终版矩阵分流；helper 侧「二进制不可用」errno 类别判定（ENOENT/EACCES/ENOTDIR/ELOOP → not-executable，errorClass 保真）；not-applicable 的 summary 按 nativeProbe outcome 分化措辞 |
| 误报 C-1/C-2 | error 无条件短路摧毁可判定结论、制造无插件机噪声 | **修**：按终版矩阵分流 |
| 误报 C-3 | JSON-RPC error 响应（`-32601`）被混入 `result` 路径 → parse-failed 假归因 | **修**：`readAppServerResponse` 区分 `parsed.error`；`-32601`（方法不存在=旧版 Codex=原生路径不存在）→ `not-executable/rpc-error`；其他 rpc error → `error/rpc-error` |
| 误报 C-4 | 探针向空 CODEX_HOME 写 ~110 文件 + SIGKILL 留脏 WAL | **半修**：前置门消掉空 home 场景；有插件的 home 本就是 Codex 活跃目录，写入属 app-server 固有行为，登记说明 |
| M1 / 质量 W-1 / 假阴 I1 / 误报 C-1 | 无 `close`/`exit` 监听：子进程秒退白等满 6s + 归因 ETIMEDOUT 说谎 | **修**：挂 `close`，early-exit → `error`（exitCode≠0 → `non-zero-exit`；=0 → `rpc-error`） |
| 误报 W-1 | NODE_OPTIONS preload 污染 helper stdout → parse-failed 误报 | **修**：io 解析取最后一个非空行 |
| M2 / 假阴 W1 / 误报 I-1 | `absent` 语义混杂（cwd 不匹配/字段改名/结构漂移都静默成 absent→不适用） | **修**：`data.length===1` 直取（请求恒单 cwd）；多项按 cwd 匹配；匹配不到/`hooks` 非数组 → `error/parse-failed`。`absent` 收窄为「结构完好且确证无我方条目」 |
| 质量变异实证 | 聚合优先级颠倒 109 用例全绿（取严顺序无守护） | **修**：补 `['modified','untrusted']→untrusted` 等区分性用例 |
| 质量 W-2 | 四值闭集三处字面量重复 | **修**：加跨文件一致性测试（把隐性同步契约变成会红的测试） |
| 质量 INFO | stdout buffer 无上界 | **修**：1MB 上限，超限 → `error/parse-failed` |
| 假阴 I2 | `process.exit(0)` 紧跟 write 有管道截断风险 | **修**：`process.stdout.write(json, cb)` 回调内 exit |
| 误报 W-6 | `managed` 恒 warning 对企业车队是噪声 | **不修**：维持 plan §1.1（无实测不猜测语义），登记已知限制，待 managed 实测后另卡处理 |
| 误报 W-3 | remediation 指向 /hooks 但 RPC absent 时列表「可能没条目」 | **不修**：F264 实证合并器写入的 hooks.json 条目同样出现在 /hooks（source=user），文案仍可执行；新文案未经实测不得写入（FR-009）。登记表观矛盾 |
| 质量 C（结构债） | core.mjs 1182 行 / io.mjs 1465 行连续多轮膨胀超阈值 | **不修**：非本次引入，fix 模式不顺手重构；登记为技术债派生候选（按 category 拆分） |
| 假阴 W2 | 判据硬编码 `spec-driver` 字面量，rebrand 即全线失效 | **不修**：改名属发布层决策，发生时必然全仓普查；登记 |
| 假阴 W3 | `enabled:false` 条目不消费（禁用条目仍报 untrusted warning） | **不修**：per-hook 禁用无端到端实测（整插件禁用时 Codex 不返回条目），无实测不猜测；现状方向是取严多报，登记 |
| 假阴 I3 | `bypass_hook_trust` 开启时「不会执行」文案不准 | **不修**：bypass 是 FR-010 明令禁止进产品路径的危险 flag，用户自开时文案偏差可接受；登记 |
| 假阴 I4 | **顺带实证** `[hooks.state."<key>"]` + `trusted_hash` 段形态（非交互授信实跑生效） | **不在本卡消费**：合并器 `present-unconfirmed` 升级为真解析是独立增强（F262 W2 边界扩展面），登记为派生候选；本卡合并器 fallback 保持现状 |
| spec W-2 | fix-report 影响面表「hook-trust-modified 旧文案复核」未落实 | 本轮闭合（见 spec C1 裁决行） |
| spec INFO-4 | `SUMMARYTEMPLATES`/`REMEDIATION_TEMPLATES` export 归属未核实 | 已核实：为本卡 T002/T003 判据所需新增导出，仅测试内省用途，值经模板漏斗产出，不构成脱敏例外；本表即为登记 |

---

## 缺陷 3(a)：spec 假设的带日期更正（不改 shipped spec 原文）

> **更正（2026-08-31，F275 立据；被更正对象：`specs/240-codex-runtime-closeout/spec.md` FR-009 所引 `_grounding.md` §8.3）**
>
> 原表述：「`HookTrustStatus` …… 信任按内容哈希绑定，**脚本内容变更即失效**」。
>
> **该表述在 codex-cli 0.151.0 上被实测证伪。** T062 一手记录（`verification/t062-manual-report-2026-08-31.md` §分段 2）显示：
> 修改 hook **脚本文件**内容 1 字节（`cmp -l` 已证单字节差异）后重新 `hooks/list`，5 条目 `currentHash` 与 `trustStatus`
> **均无变化**（保持 `trusted`）；而修改 `hooks.json` 中的 **hook 声明**（`bash␠` → `bash␠␠`，同样 1 字节）**立即**使该条目转为 `modified`。
>
> 结论：`currentHash` 覆盖的是 **`hooks.json` 中的 hook 声明**（command 串等），**不覆盖被调用脚本的字节内容**。
>
> 处置：不修改已 ship 的 `specs/240` spec 正文（保留历史事实），本更正为 canonical。F275 实现中任何依赖「脚本字节变更会被 Codex 检测到」的推理均不成立。

## 缺陷 3(b)：`hook-script-integrity` advisory check 评估

**结论：本卡内评估、给出裁决依据，实施与否由 plan 阶段按范围决定；倾向「本卡不实施，派生独立卡」。**

- **动机成立**：既然 Codex 不哈希脚本字节，一个已授信的 hook，其脚本可被静默替换而 Codex 侧仍显示 `trusted`。这是 T062 新暴露的观测缺口。
- **仓内先例**：F238 / F186 的 wrapper `body-sha256` 门禁是同型手法（对已分发产物算 sha 与发布内容比对）。
- **范围声明（沿用 F240 FR-004，禁止 over-claim）**：这是**可观测性改进，不是安全强度改进**。它只能让「脚本被改过」这件事在诊断里**可见**，
  不能阻止修改、不构成防篡改，措辞禁止出现「杜绝 / 防篡改 / 彻底解决」。攻击者若能写插件 cache 目录，同样能写我方比对基准。
- **不在本卡实施的理由**：需要一个「插件发布内容」的可信基准来源（cache 目录里的内容既是被测对象又是唯一在盘副本），
  该基准从哪来是独立设计问题（走 release contract？走 npm tarball 校验？），与本卡「判据对齐主路径」是两件事，塞进来会显著放大验证面。

---

## Spec 影响

- **不修改** `specs/240-codex-runtime-closeout/spec.md`（已 ship，更正以本报告为准，F263 R-2 先例）。
- **更新** `specs/240-codex-runtime-closeout/verification-report.md`：SC-013 三段复测节（卡面明确授权，是本卡验收的一部分）。
- 本卡自身产物：`specs/275-fix-codex-doctor-hook-trust/{fix-report,plan,tasks}.md` + `verification/`。

---

## 在线调研

`.specify/project-context.yaml` 未要求在线调研（`online_research.required` 未开启）→ **已跳过**。
本卡的外部事实需求（Codex app-server 协议合同）已由**本机实测 + `generate-json-schema` 机器可读产物**满足，强于检索二手资料。
