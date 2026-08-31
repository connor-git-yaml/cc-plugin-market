# 修复规划 — F275 doctor hook-trust 对齐 Codex 插件主路径

> Mode: fix（精简规划）。基于 `fix-report.md` 的方案 A，聚焦最小变更范围、三个待裁决项收口、
> 回归风险评估与验证方案。不产出 data-model.md / contracts / quickstart.md（fix 模式不适用）。

> **修订记录（第二轮，2026-08-31）**：主编排器亲自完成 Phase 0 实测，结论与第一轮草案的
> 决策树预期**不同**（既非"自然退出可直接拿数据"，也非"长驻不退出"，而是第三种：**会自然
> 退出，但默认写法会退得太早，拿不到数据**）。本轮改动集中在 §1.4（新增，评估一个独立发现）、
> §3.2（重写，io.mjs 改为薄封装）、§3.2b（新增，独立探针 helper 文件）、§4（整体重写）、
> §5（新增风险项）、§7（更新验证设计）、§8（重排阶段）。**§1.1/1.2/1.3 三项裁决不变**——
> 新事实没有与它们冲突，只影响"怎么拿到 RPC 数据"这个机制层面，不影响"拿到数据之后怎么判定"。

## 0. 一句话摘要

给 `hook-trust` 诊断新增一路**运行时优先信息源**（`codex app-server` 的 `hooks/list` RPC，
经一个独立探针子进程 helper 获取），识别我方插件在 F264 原生注册路径下的真实 `trustStatus`；
仅当该信息源探不到我方条目时才回退到现有 `$CODEX_HOME/hooks.json` + `config.toml` 合并器判据
（**完全保留、零改动**）。

---

## 1. 三个待裁决项的结论

### 1.1 `managed` 值域 — 裁决：**不并入 `TRUST_STATUSES`**（不变）

- **结论**：`TRUST_STATUSES` 保持 5 值不变（`trusted/untrusted/modified/indeterminate/not-applicable`）。
  当 RPC 观测到我方条目的原始 `trustStatus === 'managed'`，且没有更严重的 `untrusted`/`modified`
  与之同现时，聚合结果落 `trustStatus: 'indeterminate'`（`status: 'indeterminate'`，
  `remediation: manual-investigate`），并用新增 summaryCode `hook-trust-native-managed` 显式说明
  "原生报告为 managed（企业托管），本诊断无法判定其是否已生效"。
- **依据**：本卡**无 `managed` 的实测**（T062 全程 5 条 owned hook 的 `trustStatus` 只出现过
  `untrusted`/`modified`/`trusted` 三种，从未观测到 `managed`）。§9.7 明令"未经实测确证的形态
  不得猜测解析"。把 `managed` 直接映射为 `ok`（选项 a）是在猜测"企业托管 = 已生效"，一旦某种
  MDM 策略允许托管但仍要求用户侧二次确认，这个猜测就会把一个未生效的 hook 报成 `ok`——方向
  是"过度乐观"，属于本仓最忌讳的错误方向。归入 `trusted`（选项 b）同样是猜测且丢信息。归入
  `indeterminate`（选项 c）不需要猜测任何语义，是唯一不做未经验证断言的选项。

### 1.2 `schemaVersion` bump — 裁决：**不 bump（维持 1）**（不变）

- **结论**：`SCHEMA_VERSION` 保持 `1`。
- **依据（推翻 fix-report 的初步倾向）**：核对本文件内的直接先例——**F265** 在完全相同的
  `codex-runtime-doctor-core.mjs` 里新增了一整个新维度（commit 比对）：新增 `COMMIT_COMPARISONS`
  枚举、`baselineCommit` 枚举、`buildDirty` 布尔键、`mcp-server`/`repo-version`/`global-cli`/
  `plugin-build` 四个 category 的 `DETAILS_SCHEMA` 均新增了键——比本卡的改动面大得多，且**没有
  bump** `SCHEMA_VERSION`（源码里的值至今仍是 `1`）。本卡的改动（新增 1 个 probe id + 5 个
  summaryCode，`DETAILS_SCHEMA['hook-trust']` 本身零改动）明显小于 F265 那次未 bump 的先例。
  另外核实了 `HOOK_TRUST_PROBES` / `SUMMARY_CODES` 在现有测试里**均无**穷举长度或精确集合相等
  的断言（唯一做"常量恰为 N 项"穷举断言的是 `PLUGIN_BUILD_PROBES`，本卡不改它），所以不存在
  会被本卡"新增一个枚举值"打破的既有合同。`codex-runtime-doctor.mjs` 是仓内诊断 CLI，不是发布
  给外部消费者的稳定 API（无 SemVer 承诺），bump 版本号本身不解决任何真实兼容性问题，只会制造
  一次没有对应迁移动作的空文档负担。
- **第二轮补记**：本轮实施机制变为"经独立 helper 子进程获取数据"，`classifyHookTrust` 的输入
  形状（`nativeProbe: {outcome, errorClass, entries}`）与第一轮完全一致，不影响本裁决。

### 1.3 "我方插件条目" 识别判据 — 裁决：**三层判据，`source==='plugin'` 为前置门**（判据不变，实现落点变更见 §3.2b）

```text
isOwnPluginHookEntry(entry):
  若 entry.source !== 'plugin' → false
  否则按序判定（命中任一即 true）：
    1. isOwnedEntry(entry.command)          — 复用 codex-hooks-schema.mjs 已加固的判据
    2. entry.pluginId === 'spec-driver'
       || entry.pluginId?.startsWith('spec-driver@')
    3. entry.sourcePath 匹配
       .../plugins/cache/<任意 marketplace>/spec-driver/<任意版本>/hooks/hooks.json
```

- **实测依据（非推测）**：T062 报告 §分段 0「首次 hooks/list」原始 JSONL 里 5 条 owned hook 的
  真实字段值——`"pluginId":"spec-driver@cc-plugin-market"`、
  `"sourcePath":"/…/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json"`、
  `"command":"bash /…/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh"`
  ——三个字段**同时**验证了以上三层判据在真实环境下全部命中。`command` 字段与
  `codex-hooks-schema.mjs` 的 `OWNED_HOOK_SCRIPT_SUFFIXES` 逐一核对：5 条记录的脚本名
  （`pre-tool-use-guard.sh` / `post-tool-use-format.sh` / `postinstall.sh` / `stop-task-check.sh` /
  `stop-fix-compliance-check.sh`）与该常量表**逐字相同**，`isOwnedEntry` 无需改动即可直接复用。
- **为什么第 1 层优先复用 `isOwnedEntry` 而不是自己重写路径匹配**：它已经过 F264/F262 两轮
  异构对抗加固（拒绝 `..` 穿越、要求后缀精确匹配、要求根分量在后缀之前），本卡自己写一遍必然
  是同一类判据的第三份手写实现（F231/F236/F259 三次教训：每次独立实现都会漏判某种形态）。
- **为什么仍保留第 2/3 层作为 fallback**：`HookMetadata.command` 在协议 schema 里**不是必填
  字段**（fix-report 已确认必填字段清单不含 `command`），不能假设它永远存在；`pluginId`/
  `sourcePath` 由 `source`/`sourcePath` 均为**必填字段**，是更稳的兜底。
- **词法盲区面（如实登记，不假装已消除）**：
  1. 若 Codex 未来把 `sourcePath` 报告为快照展开后的符号链接目标而非声明文件路径本身，
     第 3 层会失配；`command` 仍可能因为其内部路径同样展开而命中第 1 层，形成部分互补但非
     完全覆盖。
  2. 若插件通过非 `codex plugin add` 的替代分发路径注册（例如未来允许的本地开发路径挂载），
     `sourcePath` 不会落在 `plugins/cache/` 下，三层判据同时失配。
  3. 若 `pluginId` 存在但采用了与 `<name>@<marketplace>` 不同的构造规则，第 2 层字符串匹配
     会漏判。
  4. **判不出的后果统一是"记为 0 own entries → 退回合并器 fallback 判据"，而不是"误判为
     untrusted/trusted"**——这是刻意选择的安全方向：宁可漏检真实原生注册转而依赖 fallback
     给出一个可能过时但不会张冠李戴的结论，也不对未知形态做猜测式解析。
- **【第二轮变更】实现落点**：本判据函数第一轮草案计划放在 `codex-runtime-doctor-io.mjs`，
  第二轮改为放在新增的 `codex-hooks-list-probe.mjs` 独立 helper 文件内（见 §3.2b）——因为
  获取 RPC 原始数据的整个动作现在都被隔离进这个子进程 helper，`io.mjs` 不再直接持有任何一条
  hooks/list 原始记录，判据自然跟着数据搬过去。判据文本本身不变。

### 1.4【第二轮新增】补充发现评估：`config-toml-hooks-state` 在原生路径下同样会被写入 — 裁决：不新增任何逻辑

- **发现**：核对 T062 报告中 doctor 输出的 `config-toml-hooks-state` 探针在三个时间点的
  `outcome`——授信前 `absent`（L307）、UI 授信后 `found`（L1340）、恢复 hooks.json 后仍
  `found`（L1604）。证明 Codex 在用户完成 UI 授信操作时，会把 `[hooks.state…]` 写入**全局**
  `$CODEX_HOME/config.toml`，且这个动作**与走的是原生路径还是合并器路径无关**（该次实测全程
  `$CODEX_HOME/hooks.json` 都不存在，写入的是纯原生路径）。
- **它证明得了什么**：这是一个跨路径共享的、纯文件读的"历史上发生过某次信任授予操作"存在性
  信号。
- **它证明不了什么**（如实划界，避免变成新的伪确定性来源）：
  1. **区分不了 `trusted` vs `modified`**——`hasHooksStateSection` 命中后，`stateSection.kind`
     现状仍是 `'present-unconfirmed'`：T062 只重跑了 doctor 自身既有探针观察 `outcome`，**没有**
     捕获该段的原始 TOML 文本（键名、哈希算法、哈希输入），`classifyHookTrust` 现有注释"段存在
     但形态未经实测确证 → indeterminate，待 T062 确证后由 io 层改喂 `confirmed`"这一挂账条件
     **仍未解除**。
  2. **判断不了新鲜度**——`found` 只说"曾经授过信"，不能区分"这就是当前 hooks 声明对应的那次
     授权"还是"几周前一次早已作废的授权痕迹"（Codex 可能已经把当前声明判成 `modified` 而这个
     文件级信号还停在 `found`，二者不矛盾但语义不同）。
- **裁决：不引入任何使用该信号的新代码路径**。它已经是现有合并器 fallback 分支（§2 第 3 优先级）
  的既有组成部分，本卡零改动即可继续正确工作（`hasHooksStateSection`/`stateSection` 构造逻辑
  逐字不动，见 §3.1）。评估过是否把它接进 §2 第 1 优先级（RPC 分支）做"交叉校验"或者在
  RPC 探测失败时作为比"回退合并器四分支"更进一步的降级依据——两种用法都要求协调两个独立真相源，
  且其中一个语义仍不完整（`present-unconfirmed`），收益是"多一个未必自洽的信号"，代价正是
  编排器提醒的"新的伪确定性来源"，故不采纳。

---

## 2. 判定优先级（终版，不变；获取 `nativeProbe` 的机制见 §4/§3.2b）

```text
1. RPC 探到 ≥1 条我方条目（outcome='found'）
     → 由这些条目的原始 trustStatus 聚合（取严）：
       含 untrusted → untrusted / warning / grant-hook-trust
       否则含 modified → modified / warning / grant-hook-trust
       否则含 managed → indeterminate / indeterminate / manual-investigate  【决议 1.1】
       否则全 trusted → trusted / ok / null
     协议漂移防御：若任一命中条目的原始 trustStatus 不属于
     {managed,untrusted,trusted,modified} 四值闭集 → 整个探针记 error/parse-failed，
     不进入聚合分支（不对未知第五值做猜测）。

2. RPC 明确失败（非二进制缺失：rpc-error / parse-failed / ETIMEDOUT）
     → indeterminate + 新 summaryCode hook-trust-native-probe-failed + manual-investigate。
     不静默回退合并器数据（即使合并器数据恰好给得出一个结论，也不能用它掩盖"主信息源探测
     失败"这件事本身）。

3. RPC 成功但我方条目为 0（outcome='absent'）
     或 codex 二进制缺失（outcome='not-executable'，ENOENT）
     或 RPC 未被注入 exec 走到（outcome='not-probed'，理论分支，生产环境不会出现）
     → 回退现有合并器判据（classifyHookTrust 原有四分支逻辑，逐字不变）。
```

`classifyHookTrust` 消费的 `nativeProbe: {outcome, errorClass, entries: string[]}` 形状不变；
**改变的只是 `nativeProbe` 这个值现在由 `io.mjs` 委托一个独立子进程 helper 计算得出**（§4），
`core.mjs` 对此完全无感。

**对 fix-report 骨架第 3 条的修订（并说明理由，不变）**：fix-report 把"codex 二进制不存在
（ENOENT）"单独列为可以直接落 `not-applicable` 的分支。本规划把它**合并进第 3 条（回退合并器）**
而不是单独短路成 `not-applicable`，理由：`install-codex-hooks.mjs` 写 `$CODEX_HOME/hooks.json`
这个动作**不依赖** `codex` 二进制是否存在于当前子进程的 `PATH`（它是我方脚本的纯文件写入）。
若把"RPC ENOENT ⇒ 直接 not-applicable"做成硬分支，会在"`hooks.json` 确实存在但当前跑 doctor
的 shell 环境恰好没有 `codex` 在 PATH 上"这种边缘但真实可能的场景下，把一个本该报
`untrusted`/`indeterminate` 的状态错误地压成 `not-applicable`，这是**新引入的假阴性**，也会
让现有 T048 全部 4 个固定状态值测试的 fixture（它们统一用不含 `codex` 的 `makeExec({})`）
产生真实行为回归。改为"并入回退分支"后：
- 若 `hooksJson` 也不存在 → `classifyHookTrust` 原有 `!hooksJsonPresent` 分支自然给出
  `not-applicable`，等价达成 fix-report "可落 not-applicable" 的诉求，且不需要新增短路逻辑；
- 若 `hooksJson` 存在（合并器留痕）→ 继续用现有判据给出有意义的结论，而不是被 RPC 层面的
  "问不到" 掩盖掉磁盘上确实存在的证据；
- 这也是 100% 保留 T048 全部既有断言的关键设计点（见 §5 回归风险评估）。

---

## 3. 变更清单

### 3.1 `plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs`（不变）

| 符号 | 改动 |
|---|---|
| `HOOK_TRUST_PROBES` | 追加 `'app-server-hooks-list'`（放首位，语义上是新的主信息源）|
| `SUMMARY_TEMPLATES` | 新增 5 条：`hook-trust-native-untrusted`、`hook-trust-native-modified`、`hook-trust-native-trusted`、`hook-trust-native-managed`、`hook-trust-native-probe-failed`（后者带 `errorClass` 参数，复用既有 `enum:errorClass` 类型）|
| `classifyHookTrust` | 新增可选入参 `nativeProbe: {outcome, errorClass, entries: string[]} \| null`；新增 §2 所述三段优先级；**原有四分支逻辑逐字不动**，只是从"唯一路径"降级为"第 3 优先级的 fallback 路径"；返回的 `probes` 数组统一追加 `{id:'app-server-hooks-list', outcome, errorClass}` 作为第 4 条留痕 |
| `hasHooksStateSection` / `deriveHooksStateProbe` | **零改动**（§1.4 裁决：不引入新用法）|

**为什么新 summaryCode 不复用现有的 `hook-trust-untrusted`/`hook-trust-modified`/`hook-trust-trusted`**：
现有三条的文案分别是"**hooks.json 已存在**但未见信任记录…"/"hook 脚本内容已变更导致既有信任
失效…"/"hook 信任记录与当前脚本内容一致"——这些措辞的前提是"合并器路径在管"。F264 主路径下
`$CODEX_HOME/hooks.json` **根本不存在**，若原样复用这三条文案，报告会说出一句不成立的事实
（"hooks.json 已存在"），这正是本卡要修的那类"世界模型绑定错误路径"问题在文案层面的重演。
新增的 5 条 `hook-trust-native-*` 文案改为"Codex 原生已注册本插件的 hook，其信任状态为…"，
不提及 `hooks.json` 存在性，且让用户能从 summary 文案本身分辨"这次判定走的是原生路径还是
合并器路径"（此前完全没有这种可观测性）。

### 3.2【第二轮重写】`plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs` — 降级为薄封装

第一轮草案曾计划让 `io.mjs` 自己 spawn `codex app-server` 并解析 RPC 响应。**Phase 0 实测
（见 §4.1）证明这条路径不可行**：`execFileSync` 的同步 input-then-EOF 写法会在 `hooks/list`
响应到达前就关闭 stdin，导致数据丢失；能拿到数据的写法（持有 stdin 直到 `id:2` 到达再关闭）
是**异步**的，而 `io.mjs` 的既有结构性护栏（§4.2）不允许在这三个生产文件里出现任何
`.stdout`/`.stderr` 字面访问。因此本轮把"真正驱动 RPC、持有 stdin、读取子进程 stdout 流"
的全部逻辑**移出** `io.mjs`，隔离进一个新增的独立探针 helper 文件（§3.2b）。`io.mjs` 侧只做
"调用这个 helper（当作又一个返回文本的子命令）→ 解析其**受限形状**的 JSON 输出 → 二次校验"。

| 符号 | 改动 |
|---|---|
| import | 新增 `import { fileURLToPath } from 'node:url';`（用于定位 helper 文件路径）。**不再**导入 `codex-hooks-schema.mjs`（该导入移进新 helper 文件，见 §3.2b）|
| 新常量 | `HOOKS_LIST_PROBE_HELPER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'codex-hooks-list-probe.mjs')` |
| 新常量 | `APP_SERVER_HOOKS_LIST_TIMEOUT_MS = 8000`（`execFileSync` 调用 helper 的外层超时；推导见 §4.5）|
| 新常量 | `RAW_NATIVE_TRUST_VALUES = Object.freeze(['managed','untrusted','trusted','modified'])`（**防御性二次校验**用；即便 helper 是我方代码，也不盲信子进程输出，镜像 `readIntrospectedSemver` 的"整串先过闸门"手法）|
| 新函数 | `probeAppServerHooksList(exec, projectRoot)` — 改为：`runCommand(exec, process.execPath, [HOOKS_LIST_PROBE_HELPER_PATH, projectRoot], {timeout: APP_SERVER_HOOKS_LIST_TIMEOUT_MS})` → `JSON.parse` 返回文本 → 按 allowlist 只读 `outcome`/`errorClass`/`entries` 三个键，`entries` 内每一项须属于 `RAW_NATIVE_TRUST_VALUES` 闭集，任何形状不符 → 统一归约为 `{outcome:'error', errorClass:'parse-failed', entries:[]}`。**不再包含任何 RPC 请求构造、JSON-RPC 响应解析、own-entry 判据代码**（全部移进 helper）|
| `buildHookTrustCheck` | 签名从 `{codexHome, roots}` 改为 `{codexHome, roots, exec}`；内部新增一次 `probeAppServerHooksList(exec, roots.projectRoot)` 调用，结果作为 `nativeProbe` 传给 `classifyHookTrust`；**读 `hooksJson`/`config.toml` 的既有代码逐字不动**（无论 RPC 结果如何都照常执行，保证 fallback 分支数据始终就绪）|
| `runDoctor` | 调用点改为 `buildHookTrustCheck({ codexHome, roots, exec })`（`exec` 变量已在函数顶部经 `memoizeExec` 包装，直接传即可；`process.execPath` + helper 路径 + `projectRoot` 三者拼出的 args 数组本身即是缓存 key 的一部分，天然按 `projectRoot` 区分缓存，不会与其他调用冲突）|

**为什么这样切分满足 §4.2 的结构性约束**：`io.mjs` 唯一新增的子进程调用是
`runCommand(exec, process.execPath, [...])`，其数据获取路径与现有的
`probeMcpServerBuild`/`probeCodexDoctorChecks` 等**完全同构**——都是"调用一个命令，
把它的**正常返回值**当文本解析"，不出现任何 `.stdout`/`.stderr` 属性访问。`io.mjs` 因此
**不需要**从静态守卫的扫描集里被特殊处理，第一轮 §4.2 的顾虑对 `io.mjs` 已经完全解除；
真正需要触碰原始子进程输出流的复杂度被限定在唯一一个新文件里（§3.2b），该文件才是需要
新增豁免与新增结构性测试的地方。

### 3.2b【第二轮新增】`plugins/spec-driver/scripts/lib/codex-hooks-list-probe.mjs`（新文件）

独立、可作为子进程直接 `node` 执行的探针 helper。职责：驱动一次 `codex app-server` 的
`hooks/list` RPC（持有 stdin 直到拿到 `id:2` 响应或超时），提取我方条目的 `trustStatus`，
把结果压缩成**唯一受限形状**打印到自己的 stdout，然后**总是**以退出码 `0` 结束（失败信息
编码进返回值的 `outcome`/`errorClass`，不用非零退出码表达，因为非零退出会让调用方
`runCommand` 的 catch 分支把这次结果误判为"探测彻底失败"而不是"探测到了一个失败态"）。

| 符号 | 职责 |
|---|---|
| `buildHooksListRequest(projectRoot)` | 构造两行 NDJSON 请求，字面量见 §4.6，逐字沿用第一轮已确认的协议内容（本轮改动的是获取时机，不是协议内容）|
| `isOwnPluginHookEntry(entry)` | §1.3 三层判据，从 `io.mjs` 迁移到此；`import { isOwnedEntry } from './codex-hooks-schema.mjs';`（唯一消费方从 `io.mjs` 换成本文件，`codex-hooks-schema.mjs` 自身零改动）|
| `readAppServerResponse(spawnFn, projectRoot, deadlineMs)`（**注入友好**：`spawnFn` 默认 `node:child_process` 的 `spawn`，可被单测替换为假子进程双工对象）| 唯一允许触碰真实子进程原始输出流的函数。异步 `spawn('codex', ['app-server'], {stdio:['pipe','pipe','ignore']})`；写入请求后**不主动关闭 stdin**（Phase 0 变体 A 已证实"写完就指望自然退出"会让 `hooks/list` 响应来不及产生）；持续监听 stdout 数据，逐行找 `id===2` 的 JSON 对象（复用与 `findRpcResponse` 相同的"按 id 匹配、逐行独立 try/parse、跳过无关通知"策略）；命中或到达 `deadlineMs` 后**主动** `child.kill('SIGKILL')` 并返回一个已归约的结果对象（`{kind:'ok', response}` 或 `{kind:'timeout'}` 或 `{kind:'spawn-error', errorClass}`）；函数体内触碰原始流的那一小段代码用一对唯一的标记注释包裹（`/* RAW-IO-SITE-BEGIN */` … `/* RAW-IO-SITE-END */`），供 §4.4 的守卫扩展精确豁免 |
| `deriveResult(response, projectRoot)` | 从 `readAppServerResponse` 返回的已解析响应对象中，按 `data[].cwd === projectRoot` 找到目标条目，过滤 `isOwnPluginHookEntry`，按 `RAW_NATIVE_TRUST_VALUES` 校验每条 `trustStatus`，产出 `{outcome, errorClass, entries}`（这一步**只读**结构化字段做布尔判断与枚举成员测试，从不把 `sourcePath`/`pluginId`/`command`/`key` 等自由文本字段写进返回值）|
| `main(argv)` | 解析 `argv[2]` 为 `projectRoot`；串起以上函数；`try/catch` 兜底任何未预期异常，统一落 `{outcome:'error', errorClass:'unknown', entries:[]}`；`process.stdout.write(JSON.stringify(result))`；`process.exit(0)`（**恒为 0**，见上）|
| `isInvokedDirectly(import.meta.url)` 门禁 | 与仓内既有脚本一致（F247 模式），保证被 `import` 用于单测时不会自动执行 `main()` |

**为什么新增独立文件而不是让 `io.mjs` 异步化（对编排器提出的选项 (ii) 的评估）**：

`runDoctor` 当前是完全同步函数，`repo-version`/`global-cli`/`plugin-build`/`mcp-server` 四个
既有类目全部走同步 `execFileSync`。若改成异步：
1. `runDoctor` 签名变 `async`，`codex-runtime-doctor.mjs` 的 `main()` 与 `isInvokedDirectly`
   调用点需要跟着改（`process.exitCode = main(...)` → 需要 `await`/`.then()`，改变 CLI 的
   顶层控制流写法）；
2. **三个测试文件里所有调用 `io.runDoctor({...})` 的 `it(...)` 块**（`codex-runtime-doctor.test.ts`
   约 30+ 处、`codex-runtime-doctor-redaction.test.ts` 约 15 处、`codex-runtime-doctor-cli.test.ts`
   间接经 CLI 子进程不受影响）都要从同步块改成 `async () => { ... await io.runDoctor(...) }`，
   属于大范围机械改动，且这类改动的真实风险不是"改不动"，而是**漏改一处会静默通过**：
   忘记 `await` 时 `report` 会是一个 `Promise` 对象，`report.checks['hook-trust']` 是
   `undefined`，多数断言反而会因为访问 `undefined.xxx` 抛错而暴露，但也存在"整段 describe
   被跳过/断言退化成真值判断"这类更隐蔽的假绿风险；
3. 其余四个类目（`repo-version`/`global-cli`/`plugin-build`/`mcp-server`）本无异步需求，
   为了一个类目把整个 `runDoctor` 的执行模型从同步改成异步，属于"没有收益、只有迁移成本"的
   改动，且与本卡"最小化变更范围"的 fix 模式定位相悖。

对比之下，方案 (i)（独立 helper 子进程）让 `runDoctor` **保持 100% 同步**：`io.mjs` 眼中，
"调用 helper 拿 hooks/list 结果"与"调用 `spectra` 拿版本号"是同一种操作（都是"跑一个命令、
解析它的文本返回值"），三个测试文件的现有同步风格**零改动**（新增用例仍是同步 `it(...)`）。
代价是多一个文件、多一层进程边界（Node 冷启动 ~数十毫秒），换来的是**改动面从"贯穿 5 个
类目 + 3 个测试文件的执行模型"收窄为"1 个新文件 + 1 个已有函数的实现细节"**。裁决：采用
方案 (i)。

**helper 文件豁免的正面回答（对编排器"字面合规、精神违规"顾虑的直接答复）**：

`codex-hooks-list-probe.mjs` 会被**加入** `codex-runtime-doctor-redaction.test.ts` 的静态
扫描对象集合（`sources`，见 §4.4），不允许游离在扫描范围之外。但该文件确实有且只有一处
必须触碰真实子进程输出流的代码（读 `codex app-server` 的响应），做法是：
1. 用一对**全文件唯一**的标记注释包裹这一处（`RAW-IO-SITE-BEGIN`/`END`）；
2. 静态守卫对该文件的扫描逻辑先剥离标记之间的文本（与现有 `withoutOwnStdio()` 剥离
   `process.stdout`/`process.stderr` 的手法同构，只是豁免范围从"一个固定字面量"换成
   "一段被显式标记包裹、经测试保证只出现一次的代码块"）；
3. 新增一条测试**断言标记对在文件中出现且仅出现一次**（防止豁免范围被悄悄扩大）；
4. 新增一条**行为性**（而非词法性）测试：用一个可注入的假 `spawnFn`（模拟 `codex app-server`
   在其响应里的 `sourcePath`/`pluginId`/`key` 字段嵌入 canary），断言 helper 打印到**自己
   stdout** 的最终 JSON 字符串里**不包含**任何编码形式的 canary。这条测试直接验证"结果"
   而不是"源码里有没有某个子串"，因此不会被"换个变量名绕开字面扫描"这类手法欺骗，是对
   词法豁免的行为性兜底。

这四点合起来的效果是：**豁免范围被压缩到刚好能完成"读一次子进程输出"这一件事所需的
最小代码面，且该范围内产出的任何值离开这段代码后立刻进入与其余三个生产文件相同的
"结构化提取 → 闭集校验"纪律**（`deriveResult` 只读枚举/布尔字段，`main()` 只打印
`JSON.stringify` 过的受限对象）——这正是 FR-012"值级 typed schema"原则在一个新文件里
的延续，而不是对它的例外。

### 3.3 不改动的文件（更新）

- `plugins/spec-driver/scripts/lib/codex-hooks-schema.mjs`（只读复用 `isOwnedEntry`；
  **消费方从 `io.mjs` 变为新增的 `codex-hooks-list-probe.mjs`**，该文件自身零改动）
- `plugins/spec-driver/scripts/lib/codex-plugin-registration.mjs`（F264 双注册守卫，判据故意与本卡不同源，见 §6 范围外）
- `plugins/spec-driver/scripts/install-codex-hooks.mjs`
- `plugins/spec-driver/scripts/codex-runtime-doctor.mjs`（CLI 编排层，`runDoctor` 保持同步签名，对它透明，无需改）
- `specs/240-codex-runtime-closeout/spec.md`（已 ship，不改；更正走本卡 fix-report 的带日期更正）

### 3.4【第二轮更新】测试文件

- `tests/unit/codex-runtime-doctor.test.ts`：新增 hook-trust 三形态用例（§7.2）。**不再需要**
  第一轮设想的"扩展 `makeExec` 支持按 `(file,args)` 分派"——因为 `io.mjs` 新增的唯一子进程调用
  的 `file` 是 `process.execPath`（一个此前从未被任何调用占用的独立字符串），现有按文件名分派
  的 `makeExec(table)` 直接加一个 `[process.execPath]` 键即可区分，无需改动测试基础设施本身。
- `tests/unit/codex-hooks-list-probe.test.ts`（**新增文件**）：独立测试 helper 的
  `isOwnPluginHookEntry`/`deriveResult`/`readAppServerResponse`/`main` 逻辑，用可注入的假
  `spawnFn`（纯 JS `EventEmitter` 双工对象，不真的 spawn）覆盖三形态、own-entry 三条判据路径、
  协议漂移防御、deadline 超时路径；另加至少一条**真实子进程**冒烟测试（PATH 上放一个 shell
  脚本充当假 `codex`，真跑 `execFileSync(process.execPath, [helperPath, projectRoot])`），
  证明 CLI 参数解析、真实 spawn、JSON 打印、退出码这条完整链路确实接得通，不只是注入测试里
  "看起来通"。
- `tests/unit/codex-runtime-doctor-redaction.test.ts`：`sources` 新增第 4 个扫描对象
  `codex-hooks-list-probe.mjs`（§4.4）；新增两类断言（§7.3）：(a) io.mjs 层面的防御性二次
  校验测试（伪造 helper 返回畸形/夹带多余字段的 JSON，断言不泄漏）；(b) helper 层面的行为性
  canary 测试（§3.2b 第 4 点）。**不修改**现有 12 个注入点。
- `tests/unit/codex-runtime-doctor-cli.test.ts`：预期零改动，实施后跑一遍确认不回归。

### 3.5 文档（不变）

- `specs/240-codex-runtime-closeout/verification-report.md`：追加 SC-013 复测节（人工，implement 阶段之后单独执行，本 plan 不代为完成）。

---

## 4.【第二轮整体重写】Phase 0 实测结果与实现形态设计

### 4.1 实测结果（主编排器亲测，codex-cli 0.151.0，隔离 CODEX_HOME，2026-08-31）

| 变体 | 形态 | 结果 |
|---|---|---|
| A | `spawnSync('codex',['app-server'],{input: INIT+'\n'+LIST+'\n'})`（即第一轮 §4.1 问的 `execFileSync`/`spawnSync`-with-`input` 同步形态）| `status=0 signal=null`，**43ms 自然退出**；stdout 只有 `id:1` + 两条通知，**`id:2` 响应从未返回** |
| B | 只发 `hooks/list`，不发 `initialize` | `status=0`，stdout **完全为空** → `initialize` 是强制前置 |
| C | 异步 `spawn`，写入两行后**持有 stdin 1000ms / 3000ms 再 `end()`** | 两档均 `status=0 signal=null` 自然退出，stdout 含 `id:1 \| configWarning \| remoteControl/status/changed \| id:2`，**`id:2` 完整返回** |

**结论（推翻第一轮 §4.4 决策树的两个预设分支，出现第三种）**：进程**确实**会在 stdin EOF 后
自然退出（退出码 0，不需要主动 kill 也能等到它退出）——第一轮"长驻不退出"分支**未成立**。
但同步的 `input:`（写完立即视为 EOF）形态会在 `hooks/list` **处理完成前**就已经触发关闭，
**拿不到 `id:2` 数据**——不是"退不出"，是"退得太早"。可用形态必须**主动持有 stdin 一段时间
（或直到 `id:2` 到达）后再关闭/结束**，这天然要求异步执行模型。

补充实测事实：
- 响应流中固定夹杂 `configWarning`（项目未 trust 时）与 `remoteControl/status/changed` 通知
  → 解析**必须按 `id` 匹配**，不得假设行序（与既有 `findRpcResponse` 的策略一致，本卡在
  helper 内复刻同款策略而非直接 import `io.mjs` 的私有函数——helper 是独立子进程入口，
  刻意保持轻依赖，不跨文件 import 生产诊断逻辑的私有实现细节）。
- 变体 C 在 1000ms 档即稳定拿到 `id:2`；43ms 就已完成 `initialize`。**1000ms 是观测到成功的
  最小档，不是真实下界**（未测比 1000ms 更小的档位是否也行）；3000ms 同样成功，说明多等一段
  时间不会引入新问题（进程没有因为多等而自行退出或报错）。

### 4.2 为什么必须新增一个独立文件才能合法拿到数据（结构性约束回顾）

`codex-runtime-doctor-redaction.test.ts` 有一条**字面子串**静态守卫（"三层实现全都不读取被
诊断进程的 stdout / stderr 属性"）：对 core/io/cli 三个生产文件做全文扫描，`.stdout` /
`.stderr` 除 `process.stdout`/`process.stderr` 外**零容忍**出现。§4.1 的结论意味着：合法拿到
`hooks/list` 数据**必须**异步持有并读取子进程的 stdout 流——这在语法上必然会写出形如
`child.stdout.on('data', …)` 的代码，而这**恰好**是三个生产文件不允许出现的写法。因此选择
不是"要不要绕过守卫"，而是"这段不可避免要触碰原始流的代码放在哪里、用什么级别的豁免"——
已在 §3.2b 给出答案：放进一个新文件，豁免范围精确到一个被标记包裹、有专属测试保护的函数体，
而不是放宽三个既有生产文件的守卫。

### 4.3 实现形态裁决：方案 (i)（独立 helper 文件）vs 方案 (ii)（`runDoctor` 异步化）

**裁决：方案 (i)**。评估过程与理由已并入 §3.2b（避免与变更清单重复陈述，此处只列结论）：
(i) 把改动面锁定在"新增 1 个文件 + `io.mjs` 一个函数的实现细节"，`runDoctor` 及其五个类目、
三个既有测试文件的同步执行模型零改动；(ii) 需要贯穿 `runDoctor`→CLI `main()`→三个测试文件
数十处调用点的机械改动，且这类改动的失败模式偏隐蔽（漏 `await` 不一定报错，可能悄悄产出假绿）。

### 4.4 redaction 静态守卫的扩展设计

1. `codex-runtime-doctor-redaction.test.ts` 顶部新增
   `PROBE_HELPER_PATH = path.join(repoRoot, 'plugins/spec-driver/scripts/lib/codex-hooks-list-probe.mjs')`，
   `sources` 对象新增第 4 个键 `probeHelper: fs.readFileSync(PROBE_HELPER_PATH, 'utf-8')`，
   使其自动被现有全部"结构性静态守卫"用例（DETAILS_SCHEMA 检查、`err.message`/`err.stack`
   零命中检查、`.stdout`/`.stderr` 零容忍检查、裸 NUL 字节检查、密钥特征正则禁用检查等）覆盖。
2. 在"`.stdout`/`.stderr` 零容忍"这一条用例里，新增一个与既有 `withoutOwnStdio()` 同构的
   剥离函数 `withoutDeclaredRawIoSite(text)`：用正则一次性去掉
   `/\/\* RAW-IO-SITE-BEGIN \*\/[\s\S]*?\/\* RAW-IO-SITE-END \*\//` 匹配到的区块，再对剥离后
   的文本做 `.includes('.stdout')`/`.includes('.stderr')` 检查（**仅对 `probeHelper` 这一个
   来源应用该剥离**，`core`/`io`/`cli` 三个来源继续保持零豁免）。
3. 新增一条独立断言：`(text.match(/RAW-IO-SITE-BEGIN/g) ?? []).length === 1` 且
   `BEGIN`/`END` 严格配对——防止未来有人把豁免范围偷偷扩大成第二处、第三处。
4. 新增一条**行为性**测试（§3.2b 第 4 点、§7.3(b)）：不依赖词法扫描，直接跑 helper 的
   `deriveResult`（或经由可注入 `spawnFn` 跑通 `readAppServerResponse` → `deriveResult` 全链路），
   验证 canary 不出现在最终打印的 JSON 里。这是防止"文本层面躲开了但语义上仍然泄漏"的兜底，
   比纯词法扫描更强，也是回应编排器"新增结构性测试证明没有任何原始字节绕过闸门直达报告"的
   具体落实。

### 4.5 超时常量推导（按 §4.1 实测数值，写入实现文件注释）

- **helper 内部等待 `id:2` 的 deadline**：`HOOKS_LIST_DEADLINE_MS = 6000`。推导：已确认成功的
  两个held-open 档位分别是 1000ms（最小观测成功值，非下界）与 3000ms；取 3000ms 的 2 倍
  （而不是 1000ms 的 6 倍，理由是 3000ms 是"更晚一次仍确认成功"的档位，以它为基准留 2 倍余量
  比单纯放大最小观测值更稳）作为默认 deadline，代价是**最坏情况下**（codex 恰好协议异常、
  永不返回 `id:2`）每次 hook-trust 诊断会多等 6 秒才降级——已通过 §5 新增风险项显式登记这个
  代价，不是没有意识到。
- **`io.mjs` 调用 helper 的外层超时**：`APP_SERVER_HOOKS_LIST_TIMEOUT_MS = 8000`。推导：
  `HOOKS_LIST_DEADLINE_MS`（6000）+ 安全余量 2000（覆盖 helper 自身 Node 冷启动、`spawn` 系统
  调用开销、`kill` 信号送达与子进程实际终止之间的间隙、`execFileSync` 收尾开销）。若未来
  实测发现该余量不够（外层超时先于 helper 内部 deadline 触发，导致 helper 来不及打印结果
  就被外层杀掉），需要按新实测数据上调，本卡不假设这个余量绝对够用，留作实现阶段跑通整个
  链路后的一次真实验证点（见 §8 Phase 5 止点）。

### 4.6 请求字面量（不变，按第一轮已确认的实证结果）

```js
function buildHooksListRequest(projectRoot) {
  return [
    JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'codex-runtime-doctor', version: '1' } } }),
    JSON.stringify({ id: 2, method: 'hooks/list', params: { cwds: [projectRoot] } }),
    '',
  ].join('\n');
}
```

不加 `jsonrpc: '2.0'` 字段、不加 `notifications/initialized` 通知行——按运行时上下文与本轮
Phase 0 实测均未反证这一点，继续原样实现，不比照 MCP SDK 协议的形状去"补全"。

---

## 5. 回归风险评估（更新，新增 3 项）

| 护栏 / 既有行为 | 是否回退 | 说明 |
|---|---|---|
| F240 FR-012 脱敏（值级 typed schema + allowlist）| 否 | `details` 新键为零（`DETAILS_SCHEMA['hook-trust']` 未改）；`entries: string[]` 只是四值闭集枚举，经 `RAW_NATIVE_TRUST_VALUES` 摄入闸门（helper 内一次、`io.mjs` 防御性再校验一次）后才参与聚合，从不进入报告 |
| F262 W2 词法扫描边界（`hasHooksStateSection`）| 否 | 零改动，`configProbe`/`stateSection` 构造逻辑不动（§1.4 已评估不新增用法）|
| F265 doctor commit 比对 | 否 | 不同 category，零交集 |
| F264 双注册守卫（`codex-plugin-registration.mjs`）| 否 | 只读复用 `codex-hooks-schema.mjs` 的判据（消费方换成新 helper 文件）；不改该文件、不改 `install-codex-hooks.mjs` 的守卫触发条件 |
| T048 四情形固定状态值测试 | 否 | 全部 fixture 使用 `exec: makeExec({})`（`codex`/`process.execPath` 均不在表中 → helper 调用本身走 `runCommand` 的 ENOENT 分支 → `outcome:'not-executable'`）→ 走 §2 第 3 优先级回退分支 → `classifyHookTrust` 走的仍是原有四分支代码路径，输出逐字不变 |
| `.stdout`/`.stderr` 零容忍静态守卫（对 core/io/cli 三文件）| 否 | `io.mjs` 新增调用复用 `runCommand`/`execFileSync` 返回值路径，未新增任何 `.stdout`/`.stderr` 属性访问；三文件的守卫范围/强度不变 |
| "判不出 ⇒ 按启用算" 镜像面 | 否 | §1.3 已显式设计为"判不出 own entries ⇒ 归 0 ⇒ 回退合并器"，从不把"判不出"升级为"确认 untrusted/trusted" |

**新引入的风险面（诚实登记，含本轮新增 3 项）**：

1. `probeAppServerHooksList` 会真实 spawn 一个 `node` 子进程（跑 helper），helper 内部再
   spawn 一个 `codex` 子进程——若本机没有 Codex，`spawn('codex', …)` 走 ENOENT，helper 几乎
   立即打印 `{outcome:'not-executable'}` 并退出，代价很小；若 `codex` 存在但版本过旧/协议
   不兼容，helper 会吃满 `HOOKS_LIST_DEADLINE_MS`（6s）才降级。已复用 `memoizeExec` 保证同一次
   诊断内只跑一次；跨类目无重复调用（`hook-trust` 是唯一消费者）。
2. §2 第 2 条"RPC 明确失败即 indeterminate、不回退合并器"意味着：一台环境即使合并器数据
   完好，只要这次探测偶发超时/报错，本次诊断就会报 `indeterminate` 而不是给出一个可能仍然
   正确的合并器结论。已通过"仅在明确报错时才短路，ENOENT/absent 都回退"把代价限制在较窄场景。
3.【第二轮新增】**doctor 单次运行的墙钟成本显著上升**：修复前 `hook-trust` 类目是纯文件读
   （亚毫秒级）；修复后**每次**（包括环境正常、Codex 版本正常的情况）都会真实拉起
   `node`（helper）+ `codex app-server` 两层进程，并**主动等待至少一次 held-open 周期**
   （即使拿到 `id:2` 也已经过了 initialize + hooks/list 往返，按 §4.1 实测量级是"1 秒档位内
   可以拿到"，但那是"持有 1000ms 后关闭"这个刻意设计的等待时长，不是"响应一到就立刻返回"的
   延迟——除非把 `readAppServerResponse` 设计成"命中 `id:2` 就立即 `kill()`+返回"（本卡§3.2b
   已如此设计：命中即返回，deadline 只是兜底上限，不是固定等待时长），实际墙钟更接近"响应
   到达的真实延迟"而非固定 6s。仍需在实现阶段用真实机器测一次典型墙钟（预期数十~数百毫秒级，
   类比 MCP 自省的 ~0.2s 量级，但 `codex app-server` 启动更重，需要实测而非假设）。
   **对 doctor 整体可用性的影响**：`codex-runtime-doctor.mjs` 定位是"开发者随手跑的诊断工具"
   （非 CI 门禁强制路径），偶尔多花几百毫秒到 1~2 秒可接受；但若把它接进任何自动化/批量场景
   （本卡范围内没有这个计划，§6 已声明范围外），需要重新评估。**CI 影响**：本卡未把 doctor
   接入任何 CI 判定器（§6 已声明范围外），故本条风险目前只影响"人工跑 `npm run codex:doctor`
   时体感变慢"，不影响任何自动化门禁的墙钟预算。
4.【第二轮新增】**探测失败不得让 doctor 整体不可用**的兜底核对：`probeAppServerHooksList`
   的两条失败路径（helper 进程本身起不来 / helper 跑起来了但内部各种失败）都统一归约到
   `runCommand` 的 `{kind:'error', errorClass}` 或者一个能被 `JSON.parse` 的受限结果对象——
   **没有任何路径会让 `buildHookTrustCheck` 抛出未捕获异常**（helper 自身 `main()` 有
   `try/catch` 兜底且恒 `exit(0)`；`io.mjs` 侧 `runCommand` 本身就是"only try/catch, 从不
   向上抛"的既有设计）。`hook-trust` 探测失败的最坏后果是这一个类目变成 `indeterimate`，
   `runDoctor` 的其余四个类目与整体 CLI 退出码流程不受影响（`--strict` 下 `indeterminate`
   仍映射为 `warning` 而非阻断退出码，见 `aggregateOverallStatus` 既有真值表，本卡未改）。
5.【第二轮新增】新文件 `codex-hooks-list-probe.mjs` 被纳入 redaction 静态守卫扫描集后，
   该守卫套件的**运行时间**会略微增加（多扫一个文件的全部既有断言，含 canary 编码遍历），
   量级是"多一个文件大小的字符串操作"，预期不会造成可感知的测试套件变慢。

---

## 6. 范围外声明（不变，末尾新增一条第二轮确认项）

- `hook-script-integrity` advisory check（脚本字节完整性可观测性）——fix-report 已给出裁决
  倾向（本卡不实施，派生独立卡），本 plan 维持该裁决。
- `managed` 值域的完整语义确认（是否等价于"已生效"）——留待有真实 `managed` 环境时补测，
  当前统一落 `indeterminate`（§1.1）。
- `--force-hooks` 覆盖后原生 + 合并器**双路径并存**（同一 hook 被注册两次执行）的联合诊断——
  本卡的 hook-trust 聚合以"原生优先"单一治理视角呈现，不诊断"双重执行"本身；那是 F264
  安装时刻（`install-codex-hooks.mjs` 的双注册守卫）的既有职责，本卡不重复建设。
- `codex-plugin-registration.mjs` 的判据统一改造——fix-report 影响面扫描已评估"倾向不统一"
  （它是词法台账判据，本卡是运行时实况判据，两者故意不同源），本 plan 维持该结论。
- CI `--strict` 下把 hook-trust 的 `warning`/`indeterminate` 当阻断信号接入门禁——doctor 定位
  仍是"诊断不阻断"，本卡不改 CI 判定器。
- 在 `details` 中暴露原生 `sourcePath`（用于诊断"具体哪个 hooks.json 在生效"）——评估后主动
  降级为范围外：`toScopedRelPath` 对纯十六进制子串会原样放行，暴露 `sourcePath` 会引入新的
  canary 泄漏分析面；5 个新 summaryCode 已足够让用户分辨判定来源，收益不足以覆盖新增验证负担。
- 【第二轮确认】把 `config-toml-hooks-state` 的存在性信号接入 §2 第 1/2 优先级分支做交叉
  校验或降级依据——§1.4 已评估并明确不采纳，避免制造新的伪确定性来源。

---

## 7.【第二轮更新】验证方案

### 7.1 测试基础设施（`codex-runtime-doctor.test.ts`）

第一轮设想的"扩展 `makeExec` 支持按 `(file, args)` 分派"**不再需要**：`io.mjs` 新增的唯一
子进程调用的 `file` 是 `process.execPath`，与既有的 `'codex'`/`'spectra'`/`'git'`/`'bash'`
均不冲突，现有按文件名分派的 `makeExec(table)` 直接加 `[process.execPath]` 键即可。

### 7.2 `codex-runtime-doctor.test.ts` 新增用例（三形态 + 边界，通过伪造 helper 输出驱动）

以下用例全部通过 `exec: makeExec({ [process.execPath]: { stdout: JSON.stringify({...}) } })`
（或等价的自定义 exec 函数）伪造 helper 的**受限输出**来驱动 `io.mjs` 侧逻辑，**不**在这一层
模拟真实 `codex app-server` 的原始 RPC 响应（那是 `codex-hooks-list-probe.test.ts` 的职责，
见 §7.2b）——这是本轮架构调整带来的测试分层收益：io 层测试只需要关心"给定一个合法/畸形的
helper 输出，`classifyHookTrust` 的判定与优先级是否正确"，不需要再关心 JSON-RPC 协议细节。

| 场景 | Fixture（helper 侧伪造输出）| 断言 |
|---|---|---|
| 无插件环境 | `{outcome:'absent', errorClass:null, entries:[]}` | 结果与"helper 不存在"（`process.execPath` 不在表中）完全一致，回退合并器，逐字复用现有 T048 断言作为对照锚 |
| 仅合并器环境 | helper 调用 ENOENT（`process.execPath` 不在表中）| 现有全部 4 个固定状态值断言逐字保持不变（回归锚）|
| 原生环境 —— all untrusted | `{outcome:'found', errorClass:null, entries:['untrusted','untrusted','untrusted','untrusted','untrusted']}` | `status=warning` `trustStatus=untrusted` `remediation.code=grant-hook-trust`，summary 使用 `hook-trust-native-untrusted` |
| 同上 —— 含 modified | `entries` 含 1 个 `'modified'`，其余 `'trusted'` | `status=warning` `trustStatus=modified` |
| 同上 —— 含 managed（无 untrusted/modified）| `entries` 含 1 个 `'managed'`，其余 `'trusted'` | `status=indeterminate` `trustStatus=indeterminate`，summary=`hook-trust-native-managed` |
| 同上 —— 全 trusted | `entries` 全 `'trusted'` | `status=ok` `trustStatus=trusted` `remediation=null` |
| RPC 明确失败 | `{outcome:'error', errorClass:'rpc-error', entries:[]}` **且** `hooksJson`/`configToml` 构造成"合并器侧其实是 trusted" | `status=indeterminate`，summary=`hook-trust-native-probe-failed`；**必须**断言没有采用合并器侧的 trusted 结论（证明优先级真正生效，不是侥幸凑对）|
| helper 输出畸形（协议漂移的下游后果之一）| helper 返回 `entries` 含非闭集值、或整体不是合法 JSON、或 `outcome` 不在四值内 | `io.mjs` 防御性二次校验兜底为 `{outcome:'error', errorClass:'parse-failed'}`，走 §2 第 2 条 |

own-entry 三条判据路径（`command`/`pluginId`/`sourcePath` 各自命中）与协议漂移防御，
因判据代码已迁移进 helper，改在 §7.2b 覆盖（更贴近数据来源，不需要 io 层重复覆盖）。

### 7.2b `tests/unit/codex-hooks-list-probe.test.ts`（新增文件）

| 场景 | 假 `spawnFn` 行为 | 断言 |
|---|---|---|
| own-entry：仅 `pluginId` 命中 | 返回条目 `command` 给假路径、`sourcePath` 给不含 `plugins/cache/` 的假路径、`pluginId='spec-driver@x'` | `deriveResult` 计入聚合 |
| own-entry：仅 `sourcePath` 命中 | `pluginId` 缺失、`command` 给假路径、`sourcePath` 符合 cache 路径形态 | 计入聚合 |
| own-entry：仅 `command` 命中 | `pluginId`/`sourcePath` 都缺失或不匹配，`command` 精确匹配某条 `OWNED_HOOK_SCRIPT_SUFFIXES` | 计入聚合 |
| own-entry 误判防御 | `source==='user'`，但 `sourcePath`/`command` 字面上"看起来像"我方路径 | **不计入** |
| 协议漂移防御 | 命中条目的 `trustStatus` 为四值之外的第 5 个字符串 | 整体 `outcome:'error'`，不猜测聚合 |
| `initialize` 响应缺失/畸形 | 假子进程 stdout 只回一条无 `id` 字段的通知 | 视为未拿到 `id:2`，走 deadline 分支 |
| deadline 触发 | 假子进程从不产出 `id:2` | 到达 `HOOKS_LIST_DEADLINE_MS` 后返回超时结果，且**确实调用了 `kill`**（断言假子进程收到 kill 信号）|
| **真实子进程冒烟测试** | PATH 上放一个 shell 脚本充当假 `codex`（读 stdin、按固定延迟回两行 NDJSON），真跑 `execFileSync(process.execPath, [helperPath, projectRoot])` | 打印的 JSON 可被解析、`outcome` 符合预期；证明 argv 解析、真实 spawn、`process.exit(0)` 整条链路接得通 |

### 7.3 `codex-runtime-doctor-redaction.test.ts` 更新

- (a) **io 层防御性二次校验测试**：伪造 `process.execPath` 调用返回一个"看起来合法但夹带
  额外字段"的 JSON（例如混入一个 `sourcePath` 键，或 `entries` 数组里塞一个对象而非字符串），
  跑 §7.2 同款五通道断言，确认这些多余字段不会被 `probeAppServerHooksList` 的 allowlist 放行。
- (b) **helper 层行为性 canary 测试**：假 `spawnFn` 返回的 `hooks/list` 响应里，一条能被
  `command` 命中判定为"我方"的条目，其 `sourcePath`/`pluginId`/`key` 三个字段均嵌入
  `CANARY`/`HEX_CANARY`/`HEX40_CANARY`（复用文件既有三个 canary 常量与四种编码），断言
  helper 打印的最终 JSON 字符串里不包含任何编码形式的 canary。
- (c) `sources` 新增 `probeHelper` 键，`withoutDeclaredRawIoSite()` 剥离函数与"标记对唯一
  出现一次"断言（§4.4）。
- **不修改**现有 12 个注入点。

### 7.4 `codex-runtime-doctor-cli.test.ts`（不变）

预期零改动。该文件的 fixture 本就"刻意"在 PATH 上不放 `codex`，helper 调用 `codex` 时同样
ENOENT，走 §2 第 3 优先级回退分支，行为与实施前一致。实施后完整跑一遍作为确认。

### 7.5 SC-013 复测（人工，implement 完成后单独执行，不变）

按 T062 报告已记录的隔离环境搭建步骤重跑三段：`untrusted→trusted` 真实迁移、`modified` 观测、
`remediation` 有效性。结果追加进 `specs/240-codex-runtime-closeout/verification-report.md` 的
SC-013 复测节，并在本卡自身 `specs/275-fix-codex-doctor-hook-trust/verification/` 下留痕。

---

## 8.【第二轮重排】实施顺序

1. **Phase 0（已完成）**：主编排器实测确认 `codex app-server` 的 stdin-EOF 行为（§4.1），
   结论已固化进本 plan，无需重跑。
2. **Phase 1**：`codex-runtime-doctor-core.mjs` 改动（§3.1）+ 对应纯函数单测（`classifyHookTrust`
   新分支的独立单测，不依赖 io/helper 层）。止点：`npx vitest run tests/unit/codex-runtime-doctor.test.ts`
   中新增的纯函数用例全绿，既有用例零回归。
3. **Phase 2**：新增 `codex-hooks-list-probe.mjs`（§3.2b）+ 新增 `codex-hooks-list-probe.test.ts`
   （§7.2b），含至少一条真实子进程冒烟测试。止点：该测试文件独立全绿（不依赖 io.mjs 改动）。
4. **Phase 3**：`codex-runtime-doctor-io.mjs` 改动（§3.2，薄封装）+ §7.2 全部集成用例。
   止点：`tests/unit/codex-runtime-doctor.test.ts` 全量绿，既有断言逐字未改。
5. **Phase 4**：redaction 守卫扩展（§4.4）+ §7.3 全部用例。止点：
   `tests/unit/codex-runtime-doctor-redaction.test.ts` 全量绿，含既有 12 个注入点零回归，
   标记对唯一性断言通过。
6. **Phase 5**：`codex-runtime-doctor-cli.test.ts` 确认跑通（§7.4）+ 全仓 `npx vitest run` +
   `npm run build` + `npm run repo:check` 零失败 + **实测一次典型墙钟**（正常环境下
   `npm run codex:doctor` 的端到端耗时，核对 §5 风险项 3 的"预期数百毫秒~1-2 秒"是否成立，
   不成立则回头调整 §4.5 的超时常量）。
7. **Phase 6**：SC-013 人工复测（§7.5）+ `verification-report.md` 追加。

---

## 9. Codex 对抗审查安排（本地约定，不变）

本卡不属于门禁/判定器类改动（`codex-runtime-doctor.mjs` 是诊断不阻断的旁路工具，非 fix-compliance
门禁链路），按 `CLAUDE.local.md` 暂停期档位表，走**一般生产代码**档位：主线程自审 +
1 个独立子代理对抗复审（`general-purpose`，"假设有问题、尝试证伪"）。**新增的 `codex-hooks-list-probe.mjs`
及其 redaction 守卫扩展（§3.2b、§4.4）触碰的是防泄漏结构性防线本身，升级为门禁/判定器类档位**
（异构对抗、commit message 显式标注「Codex 审查暂停，异构档位缺席」），审查重点应放在：
(a) `RAW-IO-SITE` 豁免范围是否真的只覆盖必要的一行/一段，(b) `deriveResult` 是否存在遗漏路径
让原始字段（尤其 `sourcePath`/`command`/`key`）逃逸出函数体，(c) helper 的 `main()` 是否存在
任何会把未捕获异常的 `.message`/`.stack` 打到 stdout 的分支。
