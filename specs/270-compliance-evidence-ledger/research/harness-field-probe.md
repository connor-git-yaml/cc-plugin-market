# F270 harness 字段本机实测报告（承重前提，禁止以文档推断替代）

> **纪律来源**：F264 教训——「所有 harness 字段行为类前提须在本机实测，不得引文档推断承重」。
> 本文件所有结论均来自**本机运行时活体探针**或**本机实际运行的二进制**，每条标注取证方式与可信档位。

## 0. 环境事实（与卡面记载有出入，以此为准）

| 项 | 卡面 §8 记载 | 本机实测 | 取证 |
|---|---|---|---|
| Claude Code 版本 | 2.1.215 | **2.1.220** | `claude --version` |
| 实际二进制 | — | `/Users/connorlu/.local/share/claude/versions/2.1.220`（Mach-O arm64 单文件，256MB） | `readlink -f $(which claude)` |
| **并存的另一份安装** | 未记载 | volta 下 `@anthropic-ai/claude-code` **2.1.215**（非 PATH 首位，不生效） | `node -e require(...)/package.json` |
| Codex | 0.144.6 | 0.144.6（一致） | `codex --version` |
| 最新版 | 2.1.241 | 落后 21 版（不变） | 卡面 |

> ⚠️ **F236 同型现象再现**：本机存在两份不同版本的 Claude Code 安装。任何"本机行为"结论必须钉在 `readlink -f $(which claude)` 解析出的那一份上，不能按包管理器目录或版本号大小推断。本报告全部取证于 **2.1.220**。

> ⚠️ `claude --print`（headless）在本机**不可用**：`Failed to authenticate: OAuth session expired and could not be refreshed`。故 F245 式 headless 基线本次无法复跑，改用「当前会话活体探针 + 实际二进制反查」双路取证（见 §1/§2）。恢复 headless 需用户在交互式终端 `claude /login`。

## 1. 活体探针（档位：**直证**，当前会话真实触发）

**方法**：向本 worktree `.claude/settings.local.json`（gitignored，非入库）注入 `PostToolUse` / `Stop` / `SubagentStop` 三个 dump hook，命令为 `cat > <scratchpad>/probe/<event>-<ns>-$$.json`，随后在本会话内正常调用工具与派发子代理，收集真实 payload。

### 1.1 结论 P-1：hooks 配置**热加载**，无需重启会话
注入后**下一次工具调用**即产生 dump 文件。
> 影响：F236「本机门禁跑已安装快照」的教训**只适用于插件 cache 快照**，不适用于 `settings.local.json` 的 hooks 段。二者生效时点不同，spec 与验收须分开表述。

### 1.2 结论 P-2：PostToolUse **对子代理内部工具同样触发**（卡面待证前提，✅ 成立）
8 份 dump 中 6 份来自子代理（`agent_type=Explore`），2 份来自主线程。子代理的 `Read` / `Bash` 均独立触发。

### 1.3 结论 P-3：PostToolUse payload 实测字段全集（2.1.220）

```
session_id        transcript_path   cwd              prompt_id
permission_mode   agent_id*         agent_type*      effort{level}
hook_event_name   tool_name         tool_input{}     tool_response{}
tool_use_id       duration_ms
```

`*` = **仅子代理调用时出现**；主线程调用时该键**整体缺席**（不是 `null`、不是空串）。

| 字段 | 主线程 | 子代理 | 账本用途 |
|---|---|---|---|
| `tool_use_id` | ✅ | ✅ | 账本主键（去重/幂等） |
| `tool_name` / `tool_input` | ✅ | ✅ | 卡面方向所需，可得 |
| `prompt_id` | ✅ | ✅ **与主线程同值** | **圈定"本轮"的权威锚**（无需解析 transcript 尾部） |
| `agent_id` / `agent_type` | ❌ 缺席 | ✅ | 区分主线程 vs 委派证据 |
| `permission_mode` | ✅ | ✅ | 威胁模型输入（bypassPermissions 语境） |
| `duration_ms` | ✅ | ✅ | — |
| **时间戳** | ❌ **无** | ❌ **无** | ⚠️ 见下 |

> 🔴 **修正卡面前提**：§4 P0-A「方向」写的账本条目形状 `{tool_use_id, tool_name, tool_input 摘要, ts}` 中的 **`ts` 并不存在于 payload**。账本若需时间戳，必须由 **hook 进程侧自行打戳**（记录的是 hook 执行时刻，非工具调用时刻，两者存在不可消除的偏差）。此差异须在 spec 中如实登记，不得默认 payload 自带。

> 🟢 **卡面未预见的增益**：`prompt_id` 在主线程与其派出的子代理之间**共享同值**。这为「本轮证据」提供了 harness 原生的分组键，比"最晚一次 *fix* 展开"的文本锚更强——锚点问题（病根 iv）可由此获得结构性解法而非又一次文本判据修补。

## 2. 二进制反查（档位：**实现级证据**，取自本机实际运行的 2.1.220 可执行体）

**方法**：`strings -a` 扫描 2.1.220 二进制，定位 Stop/SubagentStop payload 的**构造代码本体**。这不是文档、不是 changelog，是本机将要执行的那份实现。

### 2.1 结论 B-1：Stop payload 构造代码原文

```js
let l = o ? "SubagentStop" : "Stop", c = i?.getAppState(), u = i?.agentId ?? kt();
if (!v3(l, c, u)) return;
let d = s ? rP(s) : void 0,
    p = d ? Jc(d.message.content, "\n").trim() || void 0 : void 0,
    f = i ? { background_tasks: cip(i.taskRegistry.all()), session_crons: uip() } : void 0,
    m = o
      ? { ...Kf(e,void 0,i), hook_event_name:"SubagentStop", stop_hook_active:n,
          agent_id:o, agent_transcript_path:KA(o), agent_type:a ?? "", last_assistant_message:p, ...f }
      : { ...Kf(e,void 0,i), hook_event_name:"Stop", stop_hook_active:n,
          last_assistant_message:p, ...f };
```

由此逐条确认：

| 卡面假设 | 判定 | 依据 |
|---|---|---|
| Stop payload 含 `background_tasks` | ✅ 成立（**有条件**） | `...f`，`f` 由 `i`(toolUseContext) 决定 |
| Stop payload 含 `session_crons` | ✅ 成立（**同条件**） | 同上，与 `background_tasks` 同生共死 |
| Stop payload 含 `last_assistant_message` | ✅ 成立（**有条件**） | `p` 可为 `undefined` → 键被 JSON 丢弃 |
| `stop_hook_active` 存在（必答③） | ✅ **无条件成立** | 直接字面量，不受 `i`/`s` 影响 |

### 2.2 结论 B-2：🔴 两个文档不会告诉你的**降级面**（spec 必须显式设计）

1. **`f = i ? {...} : void 0`** — 当 `toolUseContext` 缺席时，`background_tasks` **与** `session_crons` **两个键整体消失**（`...void 0` 展开为空对象）。
   → 判在途机制必须能区分「**字段缺席**（无法判定在途）」与「**字段存在且为空数组**（确证无在途）」。二者若混同，前者会被误读成"没有在途任务"从而**恢复成误 block**，这正是要修的病根本身。
2. **`p = ... || void 0`** — 无 assistant 消息时 `last_assistant_message` 键消失。
   → 交叉校验陈旧的逻辑不能假设该字段恒在；缺席时应落 `snapshot-stale` 之外的独立诊断码（"无法交叉校验"），避免把"探测不到"说成"探测到陈旧"。

### 2.3 结论 B-3：`background_tasks` 的精确形状与**在途语义**

```js
function cip(e){ let t=[]; for (let r of Object.values(e)) { if (!Gw(r)) continue;
  let n = { id:r.id, type:F$o[r.type] ?? r.type, status:r.status, description:wQ(r.description, 1000) };
  switch (r.type) {
    case "local_bash":     n.command = wQ(r.command,1000); break;
    case "local_agent":    n.agent_type = r.agentType;     break;
    case "monitor_mcp":    n.server=r.server, n.tool=r.tool; break;
    case "mcp_task":       n.server=r.serverName, n.tool=r.toolName; break;
    case "local_workflow": n.name = r.workflow…
```

**过滤器 `Gw` 原文**：
```js
function Gw(e){
  if (e.status !== "running" && e.status !== "pending") return false;
  if ("isBackgrounded" in e && e.isBackgrounded === false)  return false;
  return true;
}
```

> 🟢 **判在途可直接落地**：`background_tasks` 只收录 `status ∈ {running, pending}` 且未被前台化的条目。因此
> **「数组非空 ⟺ 存在真实在途后台任务」**，这是 harness 权威语义，可**直接取代** `IN_FLIGHT_DEFER_LIMIT` 的次数预算猜测（病根 ii 的结构性解法）。
> 条目自带 `type`（`local_agent` 即委派子代理，携带 `agent_type`）、`status`、`description`，判定器可按类型精确表述"在等什么"。

`session_crons` 形状：`{ id, schedule, recurring, prompt }`（`uip()`，无 Gw 式过滤）。

### 2.4 结论 B-4：SubagentStop 独有字段
`agent_id`、`agent_transcript_path`、`agent_type`（`a ?? ""`，即**可能是空串**而非缺席）。
> 2.1.232 起子代理默认后台 → 每次委派触发一次 Stop（卡面调研②）。本机 2.1.220 实测**子代理已在后台运行**（Agent 工具返回 "working in the background"），故该压力在本机版本上**已经存在**，非 2.1.232 才出现。判定器不能按"升级后才需处理"排期。

## 3. 真实 payload 直证（档位：**直证**，本会话捕获的实际 SubagentStop）

探针捕获到一份真实 `SubagentStop`，逐字段实测取值如下（键序即原始顺序）：

```json
{
  "session_id": "b5b4a9eb-…", "transcript_path": "…", "cwd": "…",
  "prompt_id": "29b262ce-…", "permission_mode": "bypassPermissions",
  "agent_id": "a1200e43ca5dddfe3", "agent_type": "Explore",
  "effort": { "level": "high" },
  "hook_event_name": "SubagentStop",
  "stop_hook_active": false,
  "agent_transcript_path": "…",
  "last_assistant_message": "盘点完成。以下按 1-12 分节…",
  "background_tasks": [
    { "id": "a1200e43ca5dddfe3", "type": "subagent",
      "status": "running", "description": "扫描 fix-compliance 判定器现状",
      "agent_type": "Explore" }
  ],
  "session_crons": []
}
```

**逐条落实**：

| 事实 | 实测值 | 对 §2 推断的检验 |
|---|---|---|
| `stop_hook_active` 类型 | **布尔 `false`**（非字符串） | ✅ 印证 B-1，重入防护可直接用（必答③） |
| `background_tasks` | 存在，**非空数组**，条目形状与 B-3 完全一致 | ✅ 判在途可落地 |
| `session_crons` | 存在，**空数组 `[]`** | ✅ **C-2 的"存在且为空"态可观测**，与"键缺席"确属两态 |
| `last_assistant_message` | 存在，为子代理最终正文 | ✅ 印证 B-1 |
| 任何时间戳字段 | **NONE**（键名 `/time|ts|date|stamp/i` 零命中） | ✅ 确证 C-1，`ts` 必须 hook 侧自打 |

### 3.1 🔴 新增陷阱 T-1：`background_tasks[].type` 是**展示别名**，不可承重

二进制中的映射表原文：
```js
{ local_agent:"subagent", local_workflow:"workflow", local_bash:"shell",
  monitor_mcp:"monitor", monitor_ws:"monitor", mcp_task:"MCP task",
  in_process_teammate:"teammate", dream:"dream", auto_mode_scan:… }
```
对外暴露的是**人类可读文案**（注意 `"MCP task"` **含空格**），内部枚举名（`local_agent` 等）不出现在 payload 里。
> **约束**：判定器**不得**把这些字符串当作承重判据（它们是 UI 文案，随时可能改）。承重判据只用**结构性事实**——数组是否存在、是否非空。`type` 仅可用于**人类可读的诊断输出**（"在等 1 个 subagent"），且必须容忍未知值。

### 3.2 🔴 新增陷阱 T-2：SubagentStop 时，触发它的子代理**把自己算作在途**

实测条目 `id` = `a1200e43ca5dddfe3` = 本次 payload 的 `agent_id`，`status:"running"`。
> 即在 `SubagentStop` 语境下 `background_tasks` **包含自身**。本判定器挂在 **Stop**（非 SubagentStop）上，主线程 Stop 时自身不属后台任务，故当前不受影响；但若未来把判定器挂到 SubagentStop，必须先按 `agent_id` 剔除自身，否则恒判"有在途"→ 恒推迟 → 门禁静默失效。**此条须写入 spec 的已知边界，防止后人扩展时踩中。**

### 3.4 结论 P-4：PostToolUse hook 失败**不阻断工具**，但**污染 agent 上下文**（档位：直证）

**方法**：临时挂一个 `matcher: "ListAgents"` 的 PostToolUse hook，命令为 `echo "…" >&2; exit 2`，随后真实调用该工具。

**实测结果**：
- 工具**正常执行且结果完整返回**（PostToolUse 发生在工具执行之后，无法回滚）；
- harness 额外向 agent 上下文注入一条：
  `PostToolUse:ListAgents hook blocking error from command: "…": LEDGER_WRITE_FAILED_SIMULATION`

> 🔴 **对账本的硬约束 C-10**：账本写入 hook **必须自身 fail-silent（恒 `exit 0`）**。
> 若账本 hook 在失败时返回非零，则**每一次工具调用**都会给 agent 注入一条错误反馈——一个坏掉的账本会把整个会话的上下文淹没，且这是**被判方可观测、可被诱导触发**的噪声通道。失败必须**静默降级**（记录到独立的 hook 自诊断文件 / stderr 丢弃），由 Stop 侧在读账本时以「账本缺失/残缺」诊断码体现，而不是在采集侧喊。
>
> 🔵 **对威胁模型（必答①）的输入**：hook 的 stderr **会进入被判方的上下文**。这意味着账本采集器**不是对被判方不可见的**——被判方能观察到采集器的存在与失败行为。任何"隐蔽性"假设都不成立，威胁模型只能建立在「独立进程写入 + 结构/序列校验 + harness 字段交叉」上，不能建立在「被判方不知道有账本」上。

### 3.5 结论 P-5：hook 是**独立进程**，主线程与子代理的 PostToolUse **确实并发交错**（档位：直证）

**采样**：本会话累计 65 条 PostToolUse dump（39 主线程 / 26 子代理），每条由文件名携带 `$$`（hook 进程 PID）与纳秒时间戳。

| 观测 | 数值 |
|---|---|
| 每个 hook 的 PID | **两两各异**（84204 / 84221 / 84288 …）→ 每次触发都是一个**独立进程** |
| MAIN ↔ SUB 交错切换次数 | **13 次** |
| 跨 MAIN/SUB 的最小相邻间隔 | **554 ms** |
| 同一条消息内的 3 个并行 Bash | hook 触发**严格串行**，间隔 1531ms / 1047ms，与三者工作量比 4:3:2 吻合 → **主线程内部工具是串行执行的** |

**由此得到的两层并发模型**：
1. **主线程内部**：工具串行执行 → 主线程自身的账本写入之间无竞态。
2. **主线程 ↔ 子代理、子代理 ↔ 子代理**：**天然并发**，且各自是独立 OS 进程 → 账本追加写**必然**面临多进程并发。

> 🔴 **对账本的硬约束 C-13**：账本必须按**多进程并发追加**设计。
> 这意味着：单条记录须**一次 `write(2)` 写完**且以 `O_APPEND` 打开（POSIX 保证 `≤ PIPE_BUF` 的 append 原子），或采用**每条记录一个文件**的无竞争布局；**绝不可**用「读全量 → 改 → 整体覆写」（这正是现有 `tryWriteState` 的 `writeFileSync` 模式，也正是病根 v 要修的东西——若账本重蹈该模式，等于把旧缺陷换个文件重演一遍）。
>
> 🔵 **对病根 v 的重估**：卡面把 block/defer 状态竞态归因于「Codex 双注册下同一 Stop 并发两次判定」。实测表明**更普遍的并发源在单个 Claude 会话内部**（主线程 + 多子代理），与 Codex 是否双注册无关。spec 的竞态处置不应写成"Codex 特有场景"。

### 3.6 结论 P-6：🔴 账本**结构性无法**取代 transcript 的锚点职责（档位：直证，本会话 transcript 实读）

**方法**：读取本会话真实 transcript（`~/.claude/projects/…/b5b4a9eb-….jsonl`，321 行 / 952KB），检查 isFix 锚点正则所匹配的 `Base directory for this skill:` 出现在什么形态的条目里。

**实测结果**（4 处命中）：

| 行号 | `type` | `role` | content 形态 | 备注 |
|---|---|---|---|---|
| 6 | `user` | `user` | `text` | **`isMeta: true`** — 这就是判定器锚点所依赖的那条 |
| 151 | `queue-operation` | — | — | 现有解析器未必认识的条目类型 |
| 159 | `attachment` | — | — | 同上 |
| 160 | `queue-operation` | — | — | 同上 |

> 🔴 **方案边界的根本澄清（C-14）**：skill 展开锚点是**注入到 user 消息里的文本**，**不是工具调用**。
> 因此 **PostToolUse 账本永远采集不到它** —— 账本**不可能**完全取代 transcript。
> 正确的方案表述不是"换掉 transcript"，而是**职责切分**：
>
> | 证据类别 | 唯一/主要来源 | 理由 |
> |---|---|---|
> | **isFix 锚点**（会话属于哪个 spec-driver mode） | **transcript（不可替代）** | 是 user 文本注入，无对应工具调用 |
> | **收口证据**（委派、制品 Write/Edit 见证、F216 Bash 执行记录） | **账本（取代 transcript）** | 全部是工具调用，账本可实时捕获 |
> | **在途判定** | **`background_tasks`（取代次数预算）** | harness 权威字段 |
>
> 🟢 **而这个切分恰好与滞后特性互补**：transcript 的异步滞后影响的是**尾部（当前轮）**，而锚点位于**会话早期**（本例 line 6 / 共 321 行）——锚点通常早已落盘。真正受滞后伤害的是尾部收口证据，**那正是账本要接管的部分**。所以方案不是"绕开一个不可靠的源"，而是"让每类证据用其可靠的那一段"。
>
> ⚠️ **推论**：`transcript-unavailable` / `transcript-path-absent` 等诊断码**不能**因为账本上线就废除——锚点仍依赖 transcript，transcript 彻底不可读时仍须 fail-loud（保持现有 `indeterminate` 语义）。

> 📌 **附带观察 → 已核实并撤回（留痕）**：初看 line 151/159/160 的 `queue-operation` / `attachment` 条目**也含**锚点文本，怀疑会造成假锚点或污染 F257 闸门三的 assistant 计数。**核实结论：虚惊，现有实现已正确处理，无需改动。**
> - `normalizeTranscriptEntry`（`fix-compliance-core.mjs:427-470`）把顶层 `raw.type` 存为 `role`，仅从 `raw.message.content` 抽块；这类元数据 envelope 无 `message.content` → `textBlocks` 为空 → **锚点正则扫不到**，不会产生假锚点。
> - 闸门三只数 `role === 'assistant'`（`core:1096-1104`），这些条目 role 不是 assistant → **不进计量**。
> - 更关键：`core:479-482` 的注释显示该取值域**已由本机全量实扫 2676 份 `.jsonl` 取证**并明确列出了 `attachment` / `queue-operation` 等，且刻意声明"不作承重判据、只用于正向认领"。即这一面**先于本需求就已被证据驱动地处理过**。
>
> 记此留痕是为了防止下游把一个已解决的问题当作新缺口重开工（本仓多次出现"照任务卡动手却发现前提已变"的教训）。



### 3.7 结论 P-7：Node `appendFileSync` 多进程并发**原子**，无需加锁（档位：直证，本机压测）

**方法**：8 个独立 Node 进程并发对同一文件循环 `appendFileSync(JSON.stringify(rec) + '\n')`，事后按行 `JSON.parse` 校验撕裂。

| 单条记录大小 | 进程数 × 条数 | 实得行数 | 可解析 | 损坏 | 结论 |
|---|---|---|---|---|---|
| ≈ 250 B | 8 × 300 = 2400 | 2400 | 2400 | **0** | ✅ 原子 |
| ≈ 2 KB | 8 × 150 = 1200 | 1200 | 1200 | **0** | ✅ 原子 |
| ≈ 8 KB | 8 × 150 = 1200 | 1200 | 1200 | **0** | ✅ 原子 |
| ≈ 60 KB | 8 × 150 = 1200 | 1200 | 1200 | **0** | ✅ 原子 |

每个写手的条数也**逐一对得上**（各 300 / 150 条，无丢失、无重复）。

> 🟢 **对 C-13 的落实**：`appendFileSync` 内部以 `O_APPEND` 打开并单次 `write(2)`；**`PIPE_BUF` 的原子性上限只约束管道，不约束常规文件**——常规文件上 `O_APPEND` 写的"定位到末尾 + 写入"由内核保证不可分割。因此账本采用**一行一条 JSONL + 单次 appendFileSync** 即可满足并发安全，**不需要引入文件锁**（避免为不存在的问题做过度设计，也避免锁本身成为新的失败面）。
>
> ⚠️ **边界（须写入 spec 的已知限制）**：该保证依赖**本地文件系统**（本次实测为 macOS APFS）。若 `.specify/runs/` 落在 **NFS / 某些网络或 FUSE 文件系统**上，`O_APPEND` 原子性**不被保证**。账本设计须容忍"极少数残缺行"——即**读取侧按行独立解析、坏行跳过并计数**，而不是"一行坏则整份账本判废"。这与 C-10 的 fail-silent 合流。
>
> 📌 另：限制单条记录长度仍然值得做，但理由是**防账本膨胀**（长 `tool_input` 如大段代码），**不是**为了原子性。

### 3.8 结论 P-8：payload 是**单行 JSON**，但单条可达 **104 KB** —— 决定采集器形态（档位：直证，111 份样本全量统计）

| 观测 | 结果 |
|---|---|
| payload 是否单行 JSON | ✅ **是**（`wc -l` 全部为 1，即仅尾部换行；内部字符串里的换行是转义 `\n`，非裸换行——`JSON.parse` → `JSON.stringify` 后仍为单行） |
| 样本条数 | 111 |
| **单条最大字节** | **104,383 B（≈102 KB）** |
| 111 条合计 | ≈ 1.3 MB |

**对采集器形态的推论**：

1. 🟢 **单行性成立** ⟹ 账本可用 **JSONL** 布局，配合 P-7 的 `O_APPEND` 原子性，写入路径极简。
2. 🔴 **但不能原样追加**：体积由 `tool_response` 主导（大命令输出、长文件内容）。一次中等会话 111 条已 1.3 MB，长会话可达数十 MB —— 直接违反九轮史 §5 第 4 条「**可用性即安全属性**」（判定器跑在**同步 Stop hook** 上，账本越大读取越慢，慢到挂死即门禁不可用 ⟹ 可能异常 fail-open）。
   → 账本条目**必须裁剪**：判定所需的是 `tool_name` / `tool_input` 摘要 / `tool_use_id` / `prompt_id` / `agent_id`，**`tool_response` 全文不是判定输入**（唯一例外是 F216 的执行记录配对需要成功/失败信号，那只需布尔或极短摘要，不需全文）。这正是 FR-002 写「`tool_input` **摘要**」而非全量的原因。
3. ⚠️ **裁剪需要 JSON 解析**，而 bash 无可靠内置 JSON 解析（现有 `post-tool-use-format.sh` 的做法是「有 `jq` 用 `jq`，否则退化到 `grep`」——`jq` **不保证存在**，且 grep 降级在本仓已有前科：F245 实测该脚本因取值缺陷**自 F084 起从未生效**）。
   → 形态选择留 plan，但**候选与代价必须写清**：
   - **(a) bash 薄壳 + node 脚本**（与现有 `stop-fix-compliance-check.sh` 同构）：解析可靠、零外部依赖（原则 X 满足），代价是**每次工具调用启动一次 node 进程**（~50 ms 量级）。
   - **(b) 纯 bash + `jq`**：快，但 `jq` 非保证依赖，且 grep 降级路径有 F245 前科，**不推荐**。
   - **(c) 零解析原样追加**：最快最健壮，但因上面第 2 点的体积问题**不可行**。

### 3.9 结论 P-9：PostToolUse hook **阻塞**后续工具调用，但 node 启动开销仅 **18 ms**（档位：直证，受控实验）

**实验一 · 阻塞性**：临时把 PostToolUse（matcher `Bash`）的 handler 换成一个约 4 秒的 busy loop，随后连续调用三个 Bash 工具，各自用 `date +%s%N` 记录时刻，hook 内也记录起止。

| 观测 | 数值 |
|---|---|
| 单次 hook 实际耗时 | 3841 / 3919 / 4146 / 4213 / 4081 / 3916 ms |
| 工具 A→B 间隔 | **3941 ms** |
| 工具 B→C 间隔 | **4229 ms** |
| 判定 | A 之后的 hook 在 3931 ms 结束，B 在 3941 ms 开始（**晚 10 ms**） → **【阻塞】** |

> 🔴 **结论**：hook 的执行时间**1:1 叠加**到工具调用之间的延迟上。采集器每多花 100 ms，用户每次工具调用就多等 100 ms。这使九轮史 §5 第 4 条「**可用性即安全属性**」从 Stop 侧延伸到**采集侧**。

**实验二 · 量化候选方案的代价**（同机连续测量）：

| 操作 | 实测 | 折算 |
|---|---|---|
| `node -e ''` 冷启动 × 10 | 186 ms | **≈ 18 ms / 次** |
| bash `echo >> file` × 100 | 5 ms | ≈ 0.05 ms / 次 |

> 🟢 **担忧被量化后消解，可以选可靠方案**：18 ms 的分摊开销对单次工具调用几乎无感；即便一个会话有 300 次工具调用，累计也只有约 5.4 秒。作为对照，**现有** `post-tool-use-format.sh` 在 `Edit|Write` 上已经会跑 `npx prettier`（量级远高于 18 ms），即本仓早已接受了远大于此的 hook 开销。
>
> **因此裁决倾向明确**：采集器采用 **(a) bash 薄壳 + node 脚本**（与 `stop-fix-compliance-check.sh` 同构）。理由不是"性能够用"，而是**在 18 ms 这个价位上买到了可靠的 JSON 解析**，从而避开候选 (b) 的 `jq`/`grep` 降级路径——那条路径在本仓有 **F245 前科**（`post-tool-use-format.sh` 因取值缺陷自 F084 起从未生效、零测试覆盖）。用 18 ms 换掉一类已发生过的静默失效，是划算的。
> ⚠️ 注意 18 ms 是 `node -e ''` 的**纯启动**；真实脚本还需 require + 解析 + 写入，预计落在 25–35 ms。plan 应在实现后**实测真实脚本耗时**并记录，作为性能回归锚点（九轮史 §5 第 4 条要求「给出最坏复杂度证明与性能回归锚点」）。

### 3.10 结论 P-10：`tool_use_id` 唯一性成立；`prompt_id` 的粒度是**一次用户消息**（档位：直证，110 份样本全量）

| 检验项 | 结果 |
|---|---|
| `tool_use_id` 缺席条数 | **0 / 110** |
| 唯一 `tool_use_id` 数 | **110 / 110**（零重复） |
| 形状 | `toolu_01Qyrp7CBjDWvHWoXCAkBLfD`（`toolu_` 前缀 + 24 位 base58 样式） |
| 唯一 `prompt_id` 数 | **1**（整个会话） |
| 唯一 `session_id` 数 | 1 |

**推论 1（主键假设成立）**：`tool_use_id` 可作账本主键用于去重/幂等（FR-002 / Key Entities 的假设**得到实证支持**）。
> ⚠️ 但仍须保留唯一性**校验**而非假定：九轮史已证伪路线 **#25** 记载过 `tool_use.id` **可被复用**的场景（先失败、后用无关工具复用同 id 拿成功回执）。本次 110 份样本未观测到复用，**不等于**复用不可能——账本读取侧应在检测到重复 id 时落诊断，而不是静默取其一。

**推论 2（`prompt_id` 的真实粒度）**：本会话用户只发过 **1 条消息**（那条 `/spec-driver:spec-driver-story` 命令），而全部 110 次工具调用（含所有子代理的）**共享同一个 `prompt_id`**。
> 因此 `prompt_id` 标识的是「**一次用户消息**（user turn）」，**不是**「一次 Stop 回合」。一次用户消息之内可以发生**多次** Stop（例如 GATE 暂停后 agent 继续、或多次收口尝试）。
> **对 FR-021 的澄清**：把 `prompt_id` 用作「本轮证据」分组键**成立**，但 spec/plan 必须把"轮"的粒度写清为**用户消息级**，否则实现者会误以为它能区分同一用户消息内的多次 Stop。

**推论 3（🟢 给 A-4 指纹去重方案的增强）**：既然 `prompt_id` 只在**用户发新消息**时改变，那么
> **`prompt_id` 未变 ⟺ 用户尚未介入**（自上次判定以来没有新的用户输入）。
这是一个 **harness 原生、被判方不可伪造**的信号（它由 harness 写入 payload，不在被判方生成域内）。
→ 建议把 spec 附录 A-4 的证据状态指纹从「缺失集合 + 账本条目数 + 锚点位置」**扩充为**含 `prompt_id`：
> **指纹 = (`prompt_id`, 缺失集合, 账本条目数, 锚点位置)**
> 语义随之更精确：「**同一次用户消息之内**，证据状态毫无进展的重复 Stop，不重复计入 `blockCount`」。这正是 GATE 暂停等待用户期间发生的事，且**无需识别 GATE 这个场景**。
> 一旦用户真的介入（回答了 GATE 提问），`prompt_id` 改变 → 指纹改变 → 计数恢复正常，不会被永久豁免。

> ⚠️ **[推断，未直证]** 本次只观测到 **1 个** `prompt_id`（用户只发了一条消息），故「用户发新消息时 `prompt_id` 改变」是从字段语义与观测一致性得出的**高置信推断**，**尚未直证**。plan 阶段须在一次含多轮用户输入的会话上验证后再承重；未验证前不得把推论 3 写成既成事实。

### 3.11 结论 P-11：🔴 `Agent`（委派）工具**确实触发** PostToolUse —— 承重前提已补证（档位：直证）

**背景**：对抗审查（fail-closed 路）正确指出，P-2 只证明了「子代理**内部**的工具触发 PostToolUse」，**不等于**「派发子代理的那次 `Agent` 调用本身触发」；而委派证据（`delegation:implement` / `delegation:verify`）是合规合同的核心。此前实测覆盖为 `Bash/Read/Edit/ListAgents`，**恰好不含 `Agent`** —— 这是本报告的一处真实缺口，现补测。

**全量样本的工具名分布**（221 份 PostToolUse dump）：

| tool_name | 条数 |
|---|---|
| Bash | 127 |
| Read | 51 |
| Edit | 18 |
| Write | 8 |
| **Agent** | **6** |
| Grep | 5 |
| ListAgents | 4 |
| Glob | 2 |

> ✅ **`Agent` 触发 PostToolUse，前提成立**。账本能采集到委派事件，FR-008 让账本承担委派证据的前提**不再悬空**。

**`Agent` 条目的实际形状**：

```
tool_input  : { description, prompt, subagent_type, model }
              subagent_type = "spec-driver:specify"（正是委派判定所需）
tool_response: { isAsync: true, status: "async_launched",
                 agentId: "ae708fe7b03bf0730", description,
                 resolvedModel: "claude-opus-5", prompt: "…" }
```

> 🔴 **同时暴露一条新事实（供 plan 消费）**：`tool_response` 是**派发回执**（`async_launched`），**不是完成回执**。即账本能证明「派发过 implement 子代理」，但**不能**证明「该子代理跑完了」。
> - 这与现行 transcript 路径**等价**（transcript 里 `Agent` 的 `tool_result` 同样是派发回执），故**不构成相对现状的退化**；
> - 但任何试图用账本判断「委派**已完成**」的设计都是无据的。完成信号只能来自 `SubagentStop` 或 Stop 侧的 `background_tasks`（该任务从数组中消失）。
> - ⚠️ `tool_response.prompt` 会把**完整的子代理 prompt 原文**带进 payload——这是 P-8 观测到单条 payload 可达 102 KB 的主因之一，也意味着账本若原样收录 `tool_response`，会把大段 prompt 写进磁盘。裁剪策略必须显式处理该字段。

### 3.12 ⚠️ 原始 payload 样本已丢失（scratchpad 易失性，2026-08-31 记）

本报告 P-8/P-10/P-11 所依据的 **111 份原始 payload dump 已丢失**——session scratchpad（`/private/tmp/claude-501/…`）在宿主机休眠/重启后被整体清空。影响评估：

- **承重结论不受影响**：全部统计与字段形状在丢失前已转录入本文件（含逐字段取值），且每条标注了取证方法，**可按同样方法重新采集复核**。
- **必答④ 的 fixture 原料需重新录制**：本就计划在 implement 阶段配合脱敏流程正式录制，损失的只是一份未脱敏的中间材料。探针 hooks（settings.local.json，gitignored）仍在位、dump 目录已重建，新样本从当前会话继续积累。
- **教训（供 implement 阶段的录制任务）**：fixture 录制的中间产物**不得只存 scratchpad**——采集后应立即脱敏并落入仓内 `tests/fixtures/`，或至少落入用户 home 下的持久目录。本仓 memory 中「宿主休眠杀长时子代理」（F271）与本次同源：**跨天任务的一切状态都要按"宿主随时休眠"设防**。

### 3.13 结论 P-12：✅ **PENDING-1 已回填** —— 真实主线程 Stop payload 直证（档位：直证，2026-08-31 捕获）

回合结束时探针捕获到首份真实 **Stop**（非 SubagentStop）payload，逐字段核对：

```json
{
  "session_id": "b5b4a9eb-…", "transcript_path": "…", "cwd": "…",
  "prompt_id": "ac6ec233-…", "permission_mode": "bypassPermissions",
  "effort": { "level": "high" },
  "hook_event_name": "Stop",
  "stop_hook_active": false,
  "last_assistant_message": "修订代理正在按 22 项清单修订 spec…（长度 571）",
  "background_tasks": [
    { "id": "a3a56c2f…", "type": "subagent", "status": "running",
      "description": "按裁决修订 F270 spec", "agent_type": "spec-driver:specify" }
  ],
  "session_crons": []
}
```

| 核对项 | 实测 | 对既有结论的检验 |
|---|---|---|
| `stop_hook_active` | **布尔 `false`** | ✅ B-1 外推成立，必答③判据可承重（PENDING-1 解除） |
| `background_tasks` | 存在，**非空**，条目=当时在跑的修订子代理 | ✅ 主线程 Stop 时在途委派**确实**出现在该字段——判在途机制的正向真实样本 |
| `session_crons` | **存在且空数组** | ✅ C-2「存在且为空」态在真实 Stop 上直证 |
| `last_assistant_message` | 存在，为主线程最后正文 | ✅ B-1 外推成立 |
| `agent_id` / `agent_type` | **键缺席** | ✅ 主线程 Stop 无 agent 字段（与 SubagentStop 的差异符合 §2.1 构造代码） |
| 时间戳类键 | **NONE** | ✅ C-1 再证 |
| `prompt_id` | **`ac6ec233`**，与前一用户轮的 `29b262ce` **不同** | 🟢 **P-10 推论 3 由推断升为直证**：用户发新消息后 `prompt_id` 确实改变。「`prompt_id` 未变 ⟺ 用户尚未介入」的指纹增强（spec A-4）**可以承重了** |

> 📌 **附带一条时序观察**：该 Stop 捕获时 `background_tasks` 里的修订代理 `status:"running"`，而它**随后**死于 API 连接错误。即 `background_tasks` 反映的是 Stop 时刻的注册表快照，**不预知任务最终结局**——判在途的语义是「此刻在跑」，不是「会跑完」（与 P-11 的派发回执结论一致，互为佐证）。

### 3.14 结论 P-13：✅ `AskUserQuestion` **确实触发** PostToolUse（档位：直证，2026-09-01，T000a 回填）

探针捕获 `tool_name: "AskUserQuestion"` 的完整 PostToolUse payload（含 `tool_use_id` 与 `tool_response`）。

> 🟢 **spec 附录 A-4「可选增强」的承重前提成立**：编排器在 GATE 暂停时改用 `AskUserQuestion` 提问，该调用会进入账本，可作**权威**的"正在等用户"信号——且其独有性质不变：伪造它的代价是**真的停下来等人**，与绕过目的自相矛盾。P4 接入时可采纳该增强（仍属可选，主方案指纹去重不依赖它）。
> ⚠️ 范围提醒：让 GATE 暂停走 `AskUserQuestion` 需要改 spec-driver SKILL 文本，属跨卡面改动——是否本卡做仍按 A-4 原判（评估范围后定）。

## 3.3 仍未取到的证据（诚实缺席，不得在 spec 中当作已知）

| 项 | 状态 | 原因 / 补齐路径 |
|---|---|---|
| ~~真实 **Stop**（非 SubagentStop）payload 落盘样本~~ | ✅ **已回填**（P-12，2026-08-31） | 保留原 PENDING 行痕迹：原风险评估（B-1 外推风险低）被证实 |
| ~~`AskUserQuestion` 是否触发 PostToolUse~~ | ✅ **已回填**（P-13，2026-09-01） | T000a 直证 |
| `toolUseContext` 缺席（→ 两字段整体消失）的真实触发条件 | ⏳ PENDING | 本会话未观测到该降级态。设计须按"可能发生"处理（C-2 三态） |
| 真实 **多轮** `prompt_id` 序列下的指纹去重端到端行为 | ⏳ PENDING | P-12 已直证 `prompt_id` 随用户消息改变（两个值），但完整的「GATE 暂停 → 用户拍板 → 计数恢复」端到端时序须在 implement 阶段用真实 fix 会话验证 |
| Codex 侧对应字段 | ❌ 不适用 | Codex 无 PostToolUse/Stop 同构 payload；方言保持 `indeterminate` 语义（卡面方向） |

> 上述 PENDING 项的处置遵循**必答⑤**将要成文的 in-flight/PENDING 惯例：报告先落盘、真实验收节标 PENDING、完成后回填。**在回填前，任何依赖这些取值的设计判断必须标注为待证**，不得写成既成事实。

## 4. 对 spec 的直接约束（供 specify 阶段逐条消费）

- **C-1**：账本条目时间戳由 hook 进程侧生成，spec 须声明其语义为"hook 执行时刻"并接受与工具实际调用时刻的偏差。
- **C-2**：判在途必须实现**三态**：`in-flight`（数组非空）/ `no-in-flight`（数组存在且为空）/ `undetermined`（键缺席）。第三态不得坍缩进前两者。
- **C-3**：`last_assistant_message` 缺席与陈旧是两件事，须分配不同诊断码；`snapshot-stale` 专码只用于"取到了且判定为陈旧"。
- **C-4**：`prompt_id` 作为"本轮"分组键优先于文本锚；`agent_id` 缺席即主线程，是**结构性**判据而非启发式。
- **C-5**：`stop_hook_active` 无条件可用，重入防护可稳定建立在它上面。
- **C-6**：本机 2.1.220 子代理已默认后台，委派压力当下即存在。
- **C-7**：两份并存安装 + 插件 cache 快照 = **两个不同的生效时点**，验收须分别说明（F236）。
- **C-8**（源 T-1）：在途判定的承重判据只用结构性事实（键是否存在 / 数组是否非空）；`type`/`description`/`agent_type` 等文案字段只进人类可读诊断，且须容忍未知值与含空格值。
- **C-9**（源 T-2）：判定器挂载点若从 Stop 变更为 SubagentStop（或增挂），必须按 `agent_id` 剔除自身，否则恒判在途→门禁静默失效。此条作为已知边界写入 spec。
- **C-10**（源 P-4）：账本采集 hook 恒 `exit 0`，失败静默降级；缺失/残缺由 Stop 侧诊断码体现，不在采集侧向 agent 喊。
- **C-11**（源 F264 合同，非本次实测但属硬耦合）：新增 owned hook 脚本必须**同时**登记到 `scripts/lib/codex-hooks-schema.mjs` 的 `OWNED_HOOK_SCRIPT_SUFFIXES`（`:100-106`）与 `OWNED_HOOK_EXPECTED_EVENT`（`:120-126`）两处，否则 `validate-codex-hooks` 判 `product-handler-misplaced`。F264 的「恒 5 条」验收口径会因此变为 6 条，相关文档与断言须一并更新。
- **C-12**（源 F264 实测事实）：Codex 原生发现并注册插件 `hooks/hooks.json`。新增的 PostToolUse handler **也会在 Codex 侧注册**，但 Codex 的 PostToolUse payload 形状与 Claude 不同 → 采集脚本必须对未知形状容错并静默跳过（与 C-10 合流），且 Codex 会话的 Stop 仍走方言 `indeterminate` 语义。
- **C-13**（源 P-5）：账本按**多进程并发追加**设计——单条一次写完 + `O_APPEND`，或每条一文件；禁用「读全量→改→整体覆写」。竞态主因是单会话内主线程+子代理并发，非 Codex 特有。
- **C-14**（源 P-6）：账本**不取代** transcript，而是**职责切分**——锚点留 transcript（不可替代），收口证据迁账本，在途判定用 `background_tasks`。transcript 相关诊断码不得因账本上线而废除。
