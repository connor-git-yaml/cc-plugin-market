# F240 Grounding — Codex Hooks 与运行时一致性一手事实

> **性质**：本文件是**编排器本机实测采集**的一手事实，供 specify / plan / tasks / implement 各子代理直接引用（这些子代理多数没有 Bash 工具，无法自行探测）。
>
> **采集环境**：macOS (darwin 25.5.0, aarch64)，`codex-cli 0.144.6`（Homebrew Cask，`/opt/homebrew/bin/codex` → `Caskroom/codex/0.144.6/codex-aarch64-apple-darwin`），采集日期 2026-08-03。
>
> **方法**：`codex --help` / `codex <sub> --help` / `codex features list` 实跑，以及对 codex 二进制执行 `strings` 提取其**内嵌的 JSON Schema 与 Rust/TS 类型名**。二进制内嵌 schema 属于强证据（是 Codex 自己用于校验 hook I/O 的 schema 本体），但**不等同于官方文档**——凡本文件标注「⚠️ 待实测确认」的条目，实施阶段必须用真实 E2E 复核，不得直接当作合同。

---

## 1. 结论先行

| 命题 | 结论 | 证据强度 |
|------|------|---------|
| Codex 0.144.6 支持 hooks | **是**，且 `hooks` feature 为 `stable` / 默认 `true` | 强（`codex features list` 实跑输出） |
| Codex 支持 `WorktreeCreate` / `WorktreeRemove` | **否**，10 个事件全集中均无 | 强（内嵌枚举全集） |
| Codex hook payload 与 Claude Code 同构 | **高度同构**，字段名与阻断语义基本一致 | 强（内嵌 JSON Schema） |
| `transcript_path` 在 Codex 下始终可用 | **否**，schema 明确为 nullable | 强（内嵌 JSON Schema） |
| Codex hooks 有信任 / 哈希校验机制 | **是**（`trusted_hash` / `HookTrustStatus` / `hooks.state`） | 中（类型名与日志串，语义待实测） |

**对本 Feature 的直接含义**：A3① 的前提成立且已被证据锁定；A3③ 不再是"防御性设计"而是**Codex 下的硬约束**（`transcript_path` 可为 null，以 transcript 为唯一事实源在 Codex 上必然失效）。

---

## 2. Codex hook event 全集（A3① 的判定依据）

从 codex 二进制中提取到的 `HookEventName` / `HookEventNameWire` / `HookEventsToml` 三处枚举，去重后的**完整事件集合**为 10 个：

| # | Wire 名（PascalCase） | Rust/JSON 名（snake_case） | 我方 `hooks.json` 当前是否使用 |
|---|----------------------|---------------------------|---------------------------|
| 1 | `PreToolUse` | `pre_tool_use` | ✅ 使用（matcher `Edit\|Write`） |
| 2 | `PermissionRequest` | `permission_request` | ❌ 未用 |
| 3 | `PostToolUse` | `post_tool_use` | ✅ 使用（matcher `Edit\|Write`） |
| 4 | `PreCompact` | `pre_compact` | ❌ 未用 |
| 5 | `PostCompact` | `post_compact` | ❌ 未用 |
| 6 | `SessionStart` | `session_start` | ✅ 使用 |
| 7 | `UserPromptSubmit` | `user_prompt_submit` | ❌ 未用 |
| 8 | `SubagentStart` | `subagent_start` | ❌ 未用 |
| 9 | `SubagentStop` | `subagent_stop` | ❌ 未用 |
| 10 | `Stop` | （未见 snake_case 变体） | ✅ 使用（两条 Stop hook） |

**关键否定事实**：全集中**不存在** `WorktreeCreate` / `WorktreeRemove`。我方 `plugins/spec-driver/hooks/hooks.json` 声明的 6 类事件中，4 类（SessionStart / PreToolUse / PostToolUse / Stop）在 Codex 有对应，2 类（WorktreeCreate / WorktreeRemove）为 **Claude adapter 独有**。这与 A3① 的要求完全一致：Codex 侧只声明前 4 类，后 2 类不得作为 Codex 前提。

> ⚠️ 待实测确认：`Stop` 出现在 `HookEventNameWire` 与 `HookEventsToml` 中，但未见到对应的 snake_case 串。`stop.command.input` / `stop.command.output` 两个 schema title **确实存在**，因此 `Stop` 可用性判断为「支持」；但其在配置文件中的确切书写形式需实测。

---

## 3. Hook payload schema（A3② 的合同依据）

Codex 二进制内嵌了 **20 个** JSON Schema，成对覆盖 10 个事件的 input / output：

```
permission-request / post-compact / post-tool-use / pre-compact / pre-tool-use /
session-start / stop / subagent-start / subagent-stop / user-prompt-submit
```
每个都有 `.command.input` 与 `.command.output` 两份（`$schema` 为 draft-07，`additionalProperties: false`）。

### 3.1 `pre-tool-use.command.input`（逐字段）

```jsonc
{
  "properties": {
    "agent_id":        { "type": "string" },
    "agent_type":      { "type": "string" },
    "cwd":             { "type": "string" },
    "hook_event_name": { "const": "PreToolUse", "type": "string" },
    "model":           { "type": "string" },
    "permission_mode": { "enum": ["default","acceptEdits","plan","dontAsk","bypassPermissions"] },
    "session_id":      { "type": "string" },
    "tool_input":      true,           // 任意类型
    "tool_name":       { "type": "string" },
    "tool_use_id":     { "type": "string" },
    "transcript_path": { "type": ["string","null"] },   // ← NullableString
    "turn_id":         { "type": "string",
                         "description": "Codex extension: expose the active turn id to internal turn-scoped hooks." }
  },
  "required": ["cwd","hook_event_name","model","permission_mode","session_id",
               "tool_input","tool_name","tool_use_id","transcript_path","turn_id"]
}
```

`post-tool-use.command.input` 与之相同，另加 `tool_response`（任意类型），且 `hook_event_name` const 为 `"PostToolUse"`。

**注意**：`hook_event_name` 在 payload 里是 **PascalCase**（`"PreToolUse"`），与 Claude Code 一致；snake_case 只出现在配置侧的事件键名上。

**`turn_id` 是 Codex 独有扩展**，Claude Code payload 中没有；反之 Claude 侧字段若被我方脚本依赖，需确认 Codex 是否提供。

### 3.2 `pre-tool-use.command.output`（阻断语义）

```jsonc
{
  "properties": {
    "continue":       { "type": "boolean", "default": true },
    "decision":       { "$ref": "PreToolUseDecisionWire", "default": null },   // "approve" | "block"
    "hookSpecificOutput": {
      "hookEventName":            { "const": "PreToolUse" },   // required
      "permissionDecision":       { "enum": ["allow","deny","ask"], "default": null },
      "permissionDecisionReason": { "type": "string", "default": null },
      "additionalContext":        { "type": "string", "default": null },
      "updatedInput":             { "default": null }
    },
    "reason":         { "type": "string",  "default": null },
    "stopReason":     { "type": "string",  "default": null },
    "suppressOutput": { "type": "boolean", "default": false },
    "systemMessage":  { "type": "string",  "default": null }
  }
}
```

与 Claude Code 的 hook output 合同**字段级同构**。

### 3.3 exit code 阻断语义（来自二进制内的错误消息串）

```
hook exited without a status code
hook returned invalid post-tool-use JSON output
PostToolUse hook exited with code 2 but did not write feedback to stderr
PostToolUse hook stopped execution
hook returned invalid permission-request JSON output
PermissionRequest hook exited with code 2 but did not write a denial reason to stderr
```

→ **`exit 2` + 写 stderr = 阻断并回传反馈**，与 Claude Code 语义一致。stdout 走 JSON 合同；JSON 非法会被显式报错（非静默忽略）。

### 3.4 `stop` / `subagent-stop` input（A3③ 的依据）

`subagent-stop.command.input` 含：`agent_id` / `agent_type` / `agent_transcript_path`(**nullable**) / `cwd` / `hook_event_name` / `last_assistant_message`(**nullable**) / `model` / `permission_mode` / `session_id` / `stop_hook_active`(boolean) / `transcript_path`(**nullable**) / `turn_id`。

`session-start.command.input` required 为：`cwd` / `hook_event_name` / `model` / `permission_mode` / `session_id` / `source` / `transcript_path`。

**A3③ 的依据（见 §8.5 实测修正）**：`transcript_path` 在所有事件 schema 中均为 `NullableString`，但**实测中它有值**。真正的硬依据是：该路径指向的 rollout 文件采用 **Codex 自有 wire format**（`{timestamp, type, payload}`，`type ∈ session_meta | event_msg | response_item`），与 Claude transcript 格式**完全不同**。我方判定器按 Claude 格式解析 Codex transcript **必然失效**——这比"可能为 null"是更强、更准确的理由。

---

## 4. Hooks 的配置与分发机制

### 4.1 已确证的信号

- 配置文件名为 **`hooks.json`**，二进制中出现 `hooks/hooks.json` 与 `field identifier` 相邻串 → 路径形态为 `<某根>/hooks/hooks.json`，与我方 `plugins/spec-driver/hooks/hooks.json` 结构一致
- config.toml 侧存在 `HookEventsToml` 表（键为 PascalCase 事件名）与 `hook.timeout_sec`
- 存在 `hooks.managed_dir` / `hooks.windows_managed_dir` 配置键，以及企业策略键 `allow_managed_hooks_only`
- 存在 app-server RPC：`hooks/list`（`HooksListParams` / `HooksListResponse` / `HooksListEntry`）
- 单次 hook 运行的可观测字段：`hook.event_name` / `hook.handler_type` / `hook.execution_mode` / `hook.scope` / `hook.source` / `hook.display_order` / `hook.configured_order` / `hook.command_outcome`；另有 `hook_run_id` / `HookRunStatus` / `HookRunSummary` / `HookOutputEntry`
- 事件通知：`HookStarted` / `HookCompleted`（`hook_started` / `hook_completed`）
- 命令执行经 `$SHELL -lc`（串 `SHELL` + `-lc` 与 `codex.hooks.command` 相邻）

### 4.2 hooks 声明的数据结构

从二进制内嵌的 app-server protocol TS 类型清单提取：

```ts
type ConfiguredHookMatcherGroup = { matcher, hooks }
type ConfiguredHookHandler     = { command, commandWindows, timeoutSec, async, statusMessage }
```

→ 事件名 → 若干 `{matcher, hooks[]}` 组 → 每组含若干 handler，**与 Claude Code 的 `hooks.json` 结构同构**。

> ❗ **更正**：本节早前据此推断"Codex handler 无 `type` 字段"——**该推断已被 §8 的实测证伪**。上述 TS 类型是 app-server **协议投影**，不是配置文件 schema；文件侧 `type` 是**必填**字段。以 §8 为准。

### 4.3 信任机制（已确证存在，对分发是硬约束）

```ts
type HookMetadata = { eventName, handlerType, sourcePath, displayOrder, isManaged, currentHash, trustStatus }
```

配套出现：`trusted_hash`、`HookTrustStatus`、`HookTrustUpdate`、`hooks.state`，TUI 日志串 `config/batchWrite failed while updating hook trust in TUI`、`hooks/list failed in TUI`。

→ **Codex 对每个 hook 记录 `currentHash` 与 `trustStatus`，并按 `sourcePath` / `isManaged` 区分来源**。哈希信任管理的**存在性已确证**；新增或内容变更的 hook 需经用户信任才执行这一**行为**尚待实测。

> ⚠️ **待实测确认（最高优先）**：这是 A3 分发路径上最大的未知。若"未信任则不执行"成立，则"装上 plugin 就自动生效 hooks"不成立，spec 必须把「首次信任」写成显式前置步骤或已知边界，E2E 必须覆盖「未信任 → 不执行」路径。**不得假设 hooks 装完即生效**。
>
> 相关探测入口：app-server RPC `hooks/list`（`HooksListParams` / `HooksListResponse` / `HooksListEntry{warnings}`），可经 `codex debug app-server send-message-v2` 发送。

### 4.3 Claude 配置迁移通道

存在 `codex.external_agent_config.detect` / `codex.external_agent_config.import`，相关串邻接 `.claude`、`settings.json`、`hooks.json`、`AGENTS.md`、`CLAUDE.md`、`.agents`，迁移项类型含 `AGENTS_MD` / `CONFIG` / `SKILLS` / `PLUGINS` / `MCP_SERVER_CONFIG` / `SUBAGENTS` / `HOOKS` / `COMMANDS` / `SESSIONS`。

→ Codex 能从 Claude 的 `.claude/settings.json` **迁移**包括 HOOKS 在内的配置。这是一条候选路径，但**迁移 ≠ 原生声明**，二者取舍需在 plan 阶段决策。

> ⚠️ 待实测确认：`.codex-plugin/plugin.json` 是否支持直接声明 hooks。二进制中存在 `PluginHookSummary` 类型，暗示 plugin 可携带 hooks，但未提取到其 schema 字段。**这是实施前必须实测的第一件事**。

---

## 5. A4 相关：CODEX_HOME 与四方一致性

### 5.1 本机现状

- `CODEX_HOME` 环境变量**未设置**；`~/.codex/` 存在
- `~/.codex/` 含：`auth.json`、`config.toml`、`plugins/`、`skills/`、`cache/`、`bin/`、`archived_sessions/`、`.codex-global-state.json` 等
- `config.toml` 顶层含 `model` / `model_reasoning_effort` / `personality` / `approval_policy` / `sandbox_mode` / `service_tier` 与多个 `[mcp_servers.*]` 段
- codex 二进制中多处出现 `~/.codex/config.toml` 作为默认配置路径的说明文本

> ⚠️ 注意：`~/.codex/config.toml` 中含**真实凭据**（MCP server 的 API key）。任何诊断命令的输出、任何入库文档，**均不得回显该文件内容**。`codex doctor --json` 自称 "redacted" 正是为此。我方诊断实现必须同样做脱敏，并在测试中断言脱敏生效。

### 5.2 `codex doctor` —— A4 的先行件（已实测）

```
codex doctor   Diagnose local Codex installation, config, auth, and runtime health
  --json       Emit a redacted machine-readable report
  --summary    Only show grouped check rows and the final count summary
  --all        Expand long lists in detailed human output
```

**实测事实一：`codex doctor` 完全尊重 `CODEX_HOME`。** 在 `CODEX_HOME=<临时目录>` 下运行，报告中所有路径（`config.toml` / `auth.json` / `log` / `app-server-control` / `sqlite home` / state 目录）均指向该临时目录，且 `checks["config.load"].details.CODEX_HOME` 显式回显生效值。→ **A4① 的目标语义有官方参照实现**：`CODEX_HOME` 优先、未设置才 fallback `~/.codex`，我方 helper 只需与之对齐，不需要自创语义。

**实测事实二：报告 schema（A4③ 应采用的同构形态）**

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "...",
  "overallStatus": "ok | warning | fail",
  "codexVersion": "0.144.6",
  "checks": {
    "<check.id>": {
      "id": "...", "category": "...",
      "status": "ok | warning | fail",
      "summary": "...",
      "details": { "<键>": "<值>" },
      "remediation": "<修复指引，或 null>",
      "durationMs": 0
    }
  }
}
```

`remediation` 字段正是本 Feature 验收要求的「漂移时给 next-step」的天然承载位。**建议 A4③ 直接采用该同构 schema**，而非另造一套。

**实测事实三：`codex doctor` 的 18 个 check 与本 Feature 零重叠。** 实跑得到的完整 check 清单：

| category | id | 覆盖内容 |
|---|---|---|
| app-server | `app_server.status` | Codex 自身后台服务是否运行 |
| auth | `auth.credentials` | Codex 凭据 |
| config | `config.load` | Codex config.toml 解析、feature flags |
| git | `git.environment` | git 版本与仓库检测 |
| install | `installation` | **Codex 自身**安装一致性 |
| mcp | `mcp.config` | Codex **配置里**的 MCP server 条目数 |
| network / reachability / websocket | `network.*` | 网络可达性 |
| runtime | `runtime.provenance` / `runtime.search` | Codex 安装来源（brew / macos-aarch64） |
| sandbox / state / threads / system / terminal / title / updates | 其余 | Codex 自身运行时 |

→ **无任何 check 覆盖**：我方仓库版本、我方 plugin build 版本、我方 MCP server 二进制版本，以及它们之间的漂移。`mcp.config` 只看 Codex 配置中声明了几个 server，**不看 server 实际跑的是哪个版本的二进制**——而"旧 MCP server 静默服务新 worktree"恰恰发生在这一层。

**职责边界结论**：`codex doctor` 管 **Codex 自身**健康；本 Feature 的四方诊断管 **我方制品之间**的版本漂移。二者互补、零重叠，**不得重造** Codex 侧体检。

### 5.3 已知 `~/.codex` 硬编码点（初筛，非完整）

| 文件:行 | 当前写法 | 归类 |
|---------|---------|------|
| `plugins/spec-driver/scripts/codex-skills.sh:57` | `TARGET_DIR="$HOME/.codex/skills"` | 全局路径，**需走 helper** |
| `plugins/spec-driver/scripts/codex-skills.sh:23` | 帮助文本 `~/.codex/skills` | 文案，随实现同步 |
| `src/scripts/postinstall.ts:28` | `existsSync(join(homedir(), '.codex'))` | 全局路径，**需走 helper** |
| `src/scripts/preuninstall.ts` | 同上语义 | 全局路径，**需走 helper** |
| `plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs:82` | 字面量文案 `~/.codex/spec-driver-capability.md` | 文案，且受 wrapper sha 门禁保护 |
| `src/cli/index.ts:106` | 帮助文本 | 文案 |
| `tests/unit/skill-installer.test.ts:239` | 断言 `join(homedir(), '.codex', 'skills')` | 测试，需随 helper 更新 |
| `tests/integration/spec-driver-codex-skills.test.ts:358,395` | 隔离 HOME 断言 | 测试 |
| `tests/e2e/feature-213-codex-plugin-install.e2e.test.ts:73` | `join(homedir(), '.codex', 'plugins', 'cache', market)` | 测试 |
| `tests/unit/auth-detector.test.ts:175` | mock `~/.codex/auth.json` | 测试 |
| `scripts/eval-judge-jury.mjs:342` | 注释提及 | 注释，**不改**（评测链不碰） |
| `scripts/pilot-27-batch.sh:8` | 注释提及 | 注释，**不改**（评测链不碰） |

> 该表由 `grep -rn` 初筛得到，**tech-research 子代理产出的完整清单以其调研报告为准**；实施前需重新全量扫描一次并与本表合并（本表可能漏掉非字面量拼接的构造点）。

---

## 6. 已确证 / 未确证 分栏（实施前必读）

### ✅ 已确证（可直接作为 spec 依据）
1. `hooks` feature = stable / 默认开启（`codex features list` 实跑；亦见 `codex doctor` 的 enabled feature flags 含 `hooks`）
2. 10 个 hook event 全集，且**不含** Worktree 系列
3. 全部 20 份 input/output JSON Schema 的存在，与 `pre-tool-use` / `post-tool-use` / `subagent-stop` / `session-start` 的字段构成
4. `transcript_path` 在所有事件中均为 nullable
5. `exit 2` + stderr 的阻断语义
6. `decision: approve|block` 与 `permissionDecision: allow|deny|ask` 的取值域
7. hooks 配置结构与 Claude 同构：`{matcher, hooks[]}` 组 + handler `{command, commandWindows, timeoutSec, async, statusMessage}`
8. hook 信任机制**存在**：`HookMetadata{eventName, handlerType, sourcePath, displayOrder, isManaged, currentHash, trustStatus}`
9. `codex doctor --json` 存在、自称 redacted、**完全尊重 `CODEX_HOME`**，报告 schema 已实测（见 §5.2）
10. `codex doctor` 的 18 个 check **不覆盖**我方仓库 / plugin build / MCP server 版本一致性 → A4③ 与之零重叠
11. 本机 `CODEX_HOME` 未设置、`~/.codex` 为实际生效目录

### ⚠️ 未确证（**必须实测后才能写进合同**）
1. **`.codex-plugin/plugin.json` 是否支持声明 hooks，字段名与形状为何** ← 最高优先。二进制含 `PluginHookSummary` 类型，但未提取到字段
2. **hooks 声明文件的确切位置与格式**。已排除：`$CODEX_HOME/hooks/hooks.json` 放非法内容后 `codex exec` 未报错（要么位置不对，要么静默忽略）。config.toml 对未知键宽容，无法用错误消息反推。`HookEventsToml` 的命名强烈暗示 config.toml 的 `[hooks]` 表，但**未证实**
3. hook 信任机制的实际**行为**（是否阻止首次执行、如何授予、能否非交互授予） ← 影响分发可行性
4. Codex 下 `tool_name` 对文件编辑的实际取值（`apply_patch`？是否也有 `Edit` / `Write`？matcher 该怎么写）
5. `PLUGIN_ROOT` / `CODEX_PLUGIN_ROOT` 是否被注入 hook 进程环境（`${CLAUDE_PLUGIN_ROOT}` 在 Codex 下如何对应）
6. handler 中多余的 `"type": "command"` 字段是否被 Codex 拒绝
7. `HookScope` / `HookSource` / `HookHandlerType` / `HookExecutionMode` 的取值域

### 已排除的探测路径（勿重复尝试，附证据）
| 尝试 | 结果 | 结论 |
|------|------|------|
| `$CODEX_HOME/hooks/hooks.json` 写 `{"__probe_invalid__":1}` 后 `codex exec` | 正常启动 session，仅因无凭据 401 失败，**无 hooks 解析报错** | 该路径非生效位置，或未知键被静默忽略 |
| config.toml 写 `[hooks] __probe__ = 1` / `[[hooks.PreToolUse]] __probe__ = 1` 后 `codex doctor` | `config.load` 均为 `ok / config loaded` | Codex config 解析对未知键宽容，**无法用错误消息反推 schema** |
| `codex debug` 子命令 | 仅 `models` / `app-server send-message-v2` / `prompt-input`，无 hooks dump | 需经 app-server RPC `hooks/list` 才能拿注册视图 |

### 实测建议（供 implement 阶段执行）
```bash
# 前置：必须隔离 CODEX_HOME，绝不可写真实 ~/.codex
export CODEX_HOME=$(mktemp -d)

# 路线 A（首选）：经 app-server RPC 拿权威注册视图，可直接回答位置/scope/trust 三问
codex debug app-server send-message-v2 --help   # 先看用法
# 发送 hooks/list 请求，观察 HooksListEntry{..., warnings} 与 HookMetadata.trustStatus

# 路线 B：真实 payload E2E（A3② 的正题）
# 1. 在候选位置写最小 hooks 声明 + 一个把 stdin payload 原样落盘的脚本
# 2. 跑一次触发文件编辑的非交互任务，比对落盘 payload 与 §3 的 schema
# 3. 用 exit 2 + stderr 验证阻断路径
```
> **凭据注意**：隔离 `CODEX_HOME` 下无 `auth.json` 会 401。E2E 若需真实 turn，须评估是否复制凭据（消耗 ChatGPT 订阅配额）或改用不需要模型调用的触发方式。**优先选不烧配额的路线 A**。

---

## 7. 与既有 Feature 的边界

- **F213（A1）**：已落地 `.codex-plugin` 分发骨架，但 `plugin.json` 当前**只声明 `skills`，无 hooks 字段** —— 这是本 Feature 要补的缺口
- **F238（A2）**：wrapper 完整性与字面量门禁；本 Feature 若改 SKILL 正文需 `npm run repo:sync` 重生 wrapper sha
- **F239（B）**：worktree/local 状态、`.worktreeinclude`、第 14/15 族门禁；其遗留 T039（Codex 客户端人工验证）**可在本 Feature 的 A3 E2E 中一并闭合，或再次显式挂账**
- **F236**：active plugin 解析必须以元数据 `installPath` 为准，**禁止**"取最高版本号"——A4③ 的 plugin build 一方必须复用该判定方式

---

## 8. 端到端实测结果（本节为最高权威，与前文冲突时以本节为准）

**方法**：隔离 `CODEX_HOME=$(mktemp -d)`，写入 hooks 声明与"把 stdin payload 原样落盘 + dump 环境变量"的探测脚本，在临时 git 仓库中跑 `codex exec` 完成一个真实 turn（让模型创建文件）。实测完成后**已删除**复制到隔离目录的凭据。真实 `~/.codex` 全程未被写入。

### 8.1 hooks 声明文件位置与 schema（已确证）

**位置：`$CODEX_HOME/hooks.json`（顶层文件，不是 `hooks/hooks.json`）**

schema 由 serde 错误消息逐层反推确证：

```jsonc
{
  "description": "string",          // 可选；类型错误会报 invalid type
  "hooks": {
    "<EventName>": [                // PascalCase，见 §8.2
      {
        "matcher": "<regex>",       // 可选
        "hooks": [
          {
            "type": "command",      // 必填！取值域 command | prompt | agent
            "command": "<shell>"    // type=command 时必填
            // 未知字段被静默忽略
          }
        ]
      }
    ]
  }
}
```

反推证据（`codex exec` stderr 原文）：
| 输入 | 错误消息 |
|------|---------|
| `{"__probe_invalid__":1}` | ``unknown field `__probe_invalid__`, expected `description` or `hooks` `` |
| handler `{"__bad__":1}` | ``missing field `type` `` |
| handler `{"type":"__bad__"}` | ``unknown variant `__bad__`, expected one of `command`, `prompt`, `agent` `` |
| handler `{"type":"command"}` | ``missing field `command` `` |
| `{"description":123,...}` | ``invalid type: integer `123`, expected a string`` |

**我方现有 `hooks.json` 的 handler 写法 `{"type":"command","command":"bash ..."}` 与 Codex 完全兼容。**

### 8.2 事件名大小写：PascalCase 生效，snake_case 静默失效 ⚠️

同一份 hooks.json 中**同时**声明 PascalCase 与 snake_case 两套 handler，实测结果：

| 声明 | 是否触发 |
|------|---------|
| `SessionStart` / `PreToolUse` / `PostToolUse` / `Stop` | ✅ 全部触发 |
| `session_start` / `pre_tool_use` | ❌ 均未触发 |

**且未知事件名不产生任何错误或警告**——`{"hooks":{"NotAnEvent":[]}}` 解析通过、静默忽略。

> 🔴 **这是一个高危静默失败面**：事件名写错（大小写错、拼写错）时 Codex **不报错、不警告**，hook 只是永远不执行。本 Feature 必须自建校验（对照事件白名单做门禁），不能依赖 Codex 报错。

### 8.3 hook 信任：默认不执行，需显式绕过或持久化信任 ⚠️

**第一次实测（无 `--dangerously-bypass-hook-trust`）：turn 完整成功执行（创建文件、消耗 16,831 tokens），但四个 hook 全部未触发，日志中零 hook 记录。**

`codex exec --help` 确证了原因：
```
--dangerously-bypass-hook-trust
    Run enabled hooks without requiring persisted hook trust for this invocation.
    DANGEROUS. Intended only for automation that already vets hook sources
```

**加上该 flag 后重跑，四个 hook 全部触发。**

配套事实：
- `HookTrustStatus` 取值域含 `managed` / `untrusted` / `trusted` / `modified`
- `HookMetadata` 含 `currentHash`，信任按内容哈希绑定 → **hook 脚本内容一变更，信任即失效**
- 授予信任的交互路径在 TUI（`config/batchWrite failed while updating hook trust in TUI`）
- 隔离 `CODEX_HOME` 的 `config.toml` 中未出现 `hooks.state` 段，信任记录的持久化位置**未确证**

> 🔴 **对 A3 的决定性影响**：「装上 plugin 就自动生效 hooks」在 Codex 下**不成立**。E2E 必须显式使用 `--dangerously-bypass-hook-trust`，且 spec 必须把「首次信任」写成明确的用户前置步骤或已知边界。非交互 CI 场景只能靠该 flag。

### 8.4 `tool_name` 实测值为 `Bash` —— 现有 matcher 在 Codex 下永不匹配 🔴

让模型创建文件，实测捕获的 PreToolUse / PostToolUse payload：

```jsonc
{
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",                                    // ← 不是 apply_patch，不是 Edit/Write
  "tool_input": { "command": "truncate -s 5 probe2.txt && od -An -tx1 probe2.txt" },
  "tool_use_id": "exec-b89ebc5a-...",
  "cwd": "/private/tmp/claude-501/f240probe-ws",
  "session_id": "019fc370-...", "turn_id": "019fc370-...",
  "model": "gpt-5.6-sol", "permission_mode": "bypassPermissions",
  "transcript_path": "$CODEX_HOME/sessions/2026/08/03/rollout-<ts>-<uuid>.jsonl"
}
```
PostToolUse 额外含 `tool_response`（本例为命令的 stdout 文本）。

> 🔴 **我方 `hooks.json` 现有的 `"matcher": "Edit|Write"` 在 Codex 下永远不会匹配**：Codex 走 shell 工具改文件，`tool_name` 为 `Bash`，目标路径埋在 `tool_input.command` 的命令字符串里，**没有结构化的 file_path 字段**。
>
> 这直接冲击 A3② 的目标"Pre/Post hook 能拿到目标路径"。可选方向（留待 plan 决策，本节不预设结论）：
> 1. matcher 改为匹配 `Bash`，并从 `tool_input.command` 解析路径 —— 但**这正是 F231 已实测证伪的路线**（记忆：结构白名单等于手写半个 bash 解析器，`X=1 exit` / `'exit'` / `builtin exit` 等全绕过）。**不可重蹈**
> 2. 缩小 A3② 的承诺范围：Codex 侧只保证"hook 被触发且能拿到原始 `tool_input`"，**不承诺**结构化目标路径
> 3. 探测 Codex 是否有独立的 `apply_patch` 工具路径（本次实测模型选择了 shell，未观察到 `apply_patch` 工具调用；⚠️ 未证伪其存在）

### 8.5 Stop payload 与 transcript wire format（A3③ 的硬依据）

实测 Stop payload：
```jsonc
{
  "hook_event_name": "Stop",
  "last_assistant_message": "Done.",
  "stop_hook_active": false,
  "session_id": "...", "turn_id": "...", "cwd": "...",
  "transcript_path": "$CODEX_HOME/sessions/2026/08/03/rollout-<ts>-<uuid>.jsonl"
}
```

`transcript_path` **实测有值**（schema 虽为 nullable）。但该 rollout 文件的格式为：

```jsonc
{"timestamp":"...","type":"session_meta","payload":{...}}
{"timestamp":"...","type":"event_msg","payload":{...}}
{"timestamp":"...","type":"response_item","payload":{...}}
```

→ **Codex 自有 wire format，与 Claude transcript 结构完全不同**。我方 Stop compliance 判定器按 Claude 格式解析必然失败。**A3③ 成立，且理由应表述为「wire format 异构且不稳定」，而非「路径可能为 null」。**

### 8.6 hook 进程环境变量：有 `CODEX_HOME`，无 `PLUGIN_ROOT` 🔴

实测 hook 进程可见的相关环境变量：

| 变量 | 是否由 Codex 注入 | 值 |
|------|------------------|-----|
| `CODEX_HOME` | ✅ **是** | 指向生效的 CODEX_HOME（本次为隔离临时目录） |
| `PLUGIN_ROOT` | ❌ **否** | 不存在 |
| `CODEX_PLUGIN_ROOT` | ❌ **否** | 不存在 |
| `CLAUDE_PLUGIN_ROOT` | ❌ **否** | 不存在 |

> ⚠️ **测量污染声明**：hook 进程中确实出现了一批 `CLAUDE_*` 变量（`CLAUDECODE` / `CLAUDE_CODE_SESSION_ID` / `CLAUDE_PLUGIN_DATA` 等）。这些是**从执行本次实测的 Claude Code 会话环境继承**下来的，**不是 Codex 注入的**。判据：其中**没有** `CLAUDE_PLUGIN_ROOT`（Codex 若做兼容注入必然包含它），且 `CLAUDE_CODE_SESSION_ID` 等于当前 Claude 会话 id。**不得**据此认为 Codex 提供了任何 `CLAUDE_*` 兼容变量。

> 🔴 **对 A3④ 的影响**：Codex **不提供**任何 plugin root 环境变量。我方 hooks.json 里的 `${CLAUDE_PLUGIN_ROOT}/hooks/xxx.sh` 在 Codex 下会展开为空串 → 命令变成 `bash /hooks/xxx.sh` → 必然失败。A3④ 的 `PLUGIN_ROOT` 支持**不能靠消费 Codex 注入的变量实现**，必须由我方在生成 Codex 侧 hooks.json 时**写入绝对路径**，或由脚本自身从 `$0` / `CODEX_HOME` 推导。

### 8.7 实测尚未覆盖（诚实挂账）

- **`exit 2` 阻断路径未在真实 turn 中验证**：blocker 脚本已就绪但未跑（需再消耗一次配额）。二进制错误消息强烈支持该语义，但**未经端到端确证**。A3② 的 block 路径 E2E 是 implement 阶段的必做项
- `prompt` / `agent` 两种 handler type 的行为未测
- `matcher` 的正则语义（是否锚定、是否大小写敏感）未测
- 信任记录的持久化位置未确证
- 是否存在 `apply_patch` 工具路径未证伪（见 §8.4）
- `PermissionRequest` / `SubagentStart` / `SubagentStop` / `PreCompact` / `PostCompact` 五个事件未触发验证

### 8.8 对 A3 / A4 的净结论

| 需求项 | 实测后判定 |
|--------|-----------|
| A3① 只用 Codex 支持的事件 | ✅ 可做，事件全集已确证；Worktree 系列确认不存在 |
| A3② apply_patch/Edit/Write 真实 payload E2E | ⚠️ **前提被动摇**：Codex 无 Edit/Write 工具，`tool_name=Bash`，无结构化路径。**需在 spec/plan 阶段重新定义这一项的可达目标** |
| A3③ Stop 不以 transcript 为唯一事实源 | ✅ 且**必须做**：wire format 异构，理由比原设想更强 |
| A3④ 支持 PLUGIN_ROOT | ⚠️ 语义需修正：Codex 不注入任何 plugin root 变量，须改为"生成期写绝对路径 / 脚本自推导" |
| A4① CODEX_HOME 尊重 | ✅ 可做，官方 `codex doctor` 提供参照语义；hook 进程亦可见 `CODEX_HOME` |
| A4② 统一 helper | ✅ 纯我方重构，无外部阻碍 |
| A4③ 四方一致性诊断 | ✅ 可做，与 `codex doctor` 零重叠，建议采用其同构报告 schema |

**最重要的一条**：A3② 的原始表述（"为 apply_patch/Edit/Write 建真实 payload E2E，Pre/Post hook 能拿到目标路径"）与 Codex 实际工具模型**不匹配**。这不是实现难度问题，是**需求前提与事实冲突**，必须在 GATE_DESIGN 前由用户拍板重新定义，不能由实施方自行降级后默默交付。

> ✅ **已拍板（2026-08-03，用户决策）**：A3② 缩范围——E2E 四路径全部基于真实 `Bash` 事件；覆盖不到文件编辑属上游缺口，诚实挂账 issue；**禁止**解析 shell 命令字符串提路径（F231 已证伪）。hook 信任——写进文档 + 诊断给 next-step；安装流程**禁止**自动绕过。

---

## 9. 编排器代码核对补充发现（spec 修订输入）

以下三项由编排器在 GATE_DESIGN 前实读代码核对得出，**均为 spec 首版遗漏、且会导致实施出错的关键约束**。

### 9.1 🔴 FR-004 存在循环输入风险：`fix-compliance-verdict` 是判定器自身的输出

`.specify/runs/*.jsonl` 实际含两类事件，**来源完全不同**：

| eventType | 写入方 | 相对判定器的独立性 | 可否作 FR-004 主信号 |
|-----------|--------|-------------------|---------------------|
| `workflow-run-summary` | `plugins/spec-driver/scripts/record-workflow-run.mjs:160`（**编排器侧**）| ✅ 独立 | ✅ **可以** |
| `fix-compliance-verdict` | 判定器链路自身（`fix-compliance-judge.mjs:44` 已 `import ... from './lib/fix-compliance-io.mjs'`）| ❌ 是判定器自己写的 | 🔴 **不可以** |

字段实测：
- `workflow-run-summary`：`{schemaVersion, eventType, recordedAt, workflowId, runId, result, startedAt, finishedAt, durationMs, rerun, rerunPhase, completedPhases, phaseDurations, gatePauses, verificationFailures, artifacts, warnings, complianceVerdict}`
- `fix-compliance-verdict`：`{schemaVersion, eventType, recordedAt, sessionId, enforcement, closureForm, compliant, missing, blockCount, degraded, diagnostics}`

> **问题**：spec 的 FR-004 把两者**并列**写成主信号源（"`workflow-run-summary` / `fix-compliance-verdict`"）。若判定器读取自己上一轮写入的 `fix-compliance-verdict` 作为本轮判定输入，就构成**自我印证闭环**：上一轮判 compliant 会让本轮直接沿用该结论，从而**掩盖本轮新出现的不合规**。这与 F224「门禁 fail-open 必须按维度收窄」、F230「fail-open bug 会系统性掩盖下游缺陷」的历史教训同类。
>
> **修法（已被下方 §9.1.1 修正，勿直接采用）**：FR-004 主信号源 MUST 收窄为 `workflow-run-summary`（编排器侧独立写入）。`fix-compliance-verdict` **只可**用于审计/可观测性，**不得**参与本轮判定输入。

#### 9.1.1 ❗ 上述二分法**不成立** —— plan 阶段实读代码后的更正

**本节推翻 §9.1 的核心论断「`workflow-run-summary` = 编排器侧独立写入」。**

实读发现：`plugins/spec-driver/scripts/fix-compliance-judge.mjs:334-347` 的 `releaseDegraded()` 降级分支**自己也写出一条 `eventType: 'workflow-run-summary'`**：

```js
recordWorkflowRun({ workflowId: 'spec-driver-fix', runId: sessionId, result: 'failed',
                    complianceVerdict: { ... } })
```

且其 `runId` **恰等于** hook payload 的 `session_id`；而编排器侧的真实调用传的是 `--run-id "{branch_name}"`（`spec-driver-implement/SKILL.md:629-637` 等 5 处）。

> 🔴 **后果**：若按 §9.1 的结论「主信号收窄为 `workflow-run-summary`，按 `sessionId` 匹配」直接实现，则在现有数据下**唯一可能匹配上的，恰恰是判定器自己上一轮写的降级记录** —— §9.1 想要防的自我印证闭环，换了个 `eventType` 外衣**原样重现**。
>
> **正确修法**（见 `plan.md` §5.3(2)）：用**结构性 provenance 排除**而非按 eventType 二分 —— `complianceVerdict` 键存在即排除该条。依据是既有白纸黑字合同 `specs/208-.../contracts/record-workflow-run-fields.md:62`：「`complianceVerdict` 的唯一生产写入路径是 `fix-compliance-judge.mjs` 降级分支」。并加守卫测试锁死「该字段写入方数量恒为 1」，防止未来新增写入方悄悄失效该排除。

**另一项同批发现**：`record-workflow-run.mjs` 全文 grep `sessionId|session_id|turnId|turn_id` **零命中** —— FR-004 要求的关联键**在现有事件里一个都不存在**。因此 FR-004 **不是**「改判定顺序去读已有数据」，而是必须先让编排器**写出**可关联的数据（涉及扩展事件 schema，受逐字节兼容合同约束）。plan 已将「会话标识是否可得」列为 Phase 0 前置实测项，并预置两条分支：可得则生产生效；不可得则逻辑照常交付 + fixture 全覆盖，但**交付报告必须如实标注「生产未激活」**，禁止 over-claim。

> **方法论教训（值得记入项目记忆）**：§9.1 的错误在于——我核对了「谁写 `fix-compliance-verdict`」，却**默认** `workflow-run-summary` 只有编排器一个写入方，没有对它同样做一次全仓写入方枚举。**判定"某数据源是否独立于判定器"，必须对每一个候选 eventType 分别枚举其全部写入方，不能因为它"看起来像编排器的事件"就免检。**

### 9.5 M5 前置实测（plan §5.3(3) 的阻塞项）—— Claude 侧结论：**倾向分支 α**

plan 把「编排器执行 Bash 步骤时能否拿到会话/轮次标识」列为 Phase 0 阻塞实测（M5）。编排器已完成 Claude 侧的零成本部分：

**(1) agent Bash 进程中会话标识可得**（实测 `env`）：

| 变量 | 状态 |
|------|------|
| `CLAUDE_CODE_SESSION_ID` | ✅ 有值，UUID 形态 |
| `CLAUDE_CODE_HOST_SESSION_ID` | ✅ 有值（`local_` 前缀，非 UUID，**不是**同一个东西） |
| `CLAUDE_SESSION_ID` | ❌ unset（不要用这个名字） |

**(2) 现有 `.specify/runs/*.jsonl` 实际数据印证了 §9.1.1 的推翻结论**：

| eventType | 该字段实际取值形态 | 来源 |
|---|---|---|
| `workflow-run-summary` | `runId` = **分支名**，如 `claude/agitated-grothendieck-9631c5` | 编排器侧（SKILL 传 `--run-id "{branch_name}"`） |
| `workflow-run-summary` | `runId` = **UUID** | 判定器降级分支（传 `runId: sessionId`） |
| `fix-compliance-verdict` | `sessionId` = **UUID**（另有一条为字面量 `unknown`，降级情形） | 判定器 |

→ **数据层面完整印证**：按 hook payload 的 `session_id`（UUID）去匹配 `workflow-run-summary`，在现有数据下**只可能命中判定器自己写的那条**（编排器那条的 runId 是分支名，形态都对不上）。§9.1.1 的结论与 plan §3.1.1 成立，非理论推演。

**(3) 分支判定**：`CLAUDE_CODE_SESSION_ID` 与 hook payload 的 `session_id` **同为 UUID 形态**，且本会话的 `CLAUDE_CODE_SESSION_ID` 与 Claude Code 分配给本会话的 scratchpad 目录名一致（`.../13bdb929-a641-454b-a6a6-3dffec9ad049/scratchpad`），说明它是该会话的规范 id。

> ⚠️ **但"形态相同 + 疑似同源" ≠ 已证实值相等。** M5 的最终确证仍需在 implement 阶段做一次真实 hook 触发，同时捕获 `payload.session_id` 与 `$CLAUDE_CODE_SESSION_ID` 并断言相等。**在该断言通过之前，不得按分支 α 声称 FR-004 生产生效。**
>
> **Codex 侧仍未测**：hook 进程可见 `CODEX_HOME`（§8.6），但 **agent 的 Bash 工具进程**是否暴露 session/turn 标识**未知**，需单独实测（可能需消耗一次真实 turn）。Codex 侧未测通之前，Codex 运行时按分支 β 处理。

---

### 9.4 🔴 现存缺陷（**范围外**，本 feature 不修，须挂账）：`pre-tool-use-guard.sh` 一直空转

**实测**（编排器直接喂 payload 给脚本，非推断）：

```bash
# A. 真实形状的 Claude PreToolUse payload —— file_path 嵌套在 tool_input 下
echo '{"session_id":"s1","hook_event_name":"PreToolUse","tool_name":"Edit",
       "tool_input":{"file_path":"src/core/foo.ts","old_string":"a","new_string":"b"}}' \
  | bash plugins/spec-driver/hooks/pre-tool-use-guard.sh
→ 退出码 0（放行）          ← 应当阻断却放行

# B. 扁平 payload —— file_path 在顶层（对照组）
echo '{"session_id":"s1","hook_event_name":"PreToolUse","tool_name":"Edit",
       "file_path":"src/core/foo.ts"}' \
  | bash plugins/spec-driver/hooks/pre-tool-use-guard.sh
→ [PreToolUse BLOCKED] ... 退出码 2（阻断）   ← 只有这种形状才生效
```

**根因**：`pre-tool-use-guard.sh:13` 读的是**顶层** `.file_path`（`jq -r '.file_path // empty'`），而 Claude Code 与 Codex 的 PreToolUse payload 都把它放在 **`tool_input`** 之下（Codex 侧见 §8.4 实测 payload；Claude 侧同为嵌套结构）。顶层取值恒为空 → `[ -z "$FILE_PATH" ] && exit 0` → **恒放行**。

**为何长期未被发现**：该脚本**零测试覆盖**（全仓无任何测试文件引用 `pre-tool-use-guard`，编排器已 grep 确认）。

**影响与处置**：
1. 「CLAUDE.md 规定不允许直接修改源代码、须走 spec-driver 流程」这条约束，其**自动化守卫实际未生效**——一直靠 agent 自觉遵守
2. 对本 feature 的直接含义：回归护栏「Claude 侧 hooks 行为零变化」中，该 hook 的**"当前行为"就是恒放行**。**若在本轮顺手修好它，反而构成行为变化**（从不阻断变为阻断），可能打断当前正在进行的各类流程
3. **本 feature 明确不修**（spec §2 Non-Goals 已锁定不扩围）。plan 中提到的"给 `pre-tool-use-guard.sh` 加 `tool_name` 结构性早退"是**放宽方向**的防御（防 Codex 下 grep 误抓），与本缺陷是两回事，**不得**借此顺手把取值路径一起改掉
4. 已作为独立 follow-up 挂账，交付报告须如实上报

> ⚠️ 给实施者的硬约束：**禁止**在本 feature 内修正 `.file_path` → `.tool_input.file_path`。该修正会让一个沉默多时的门禁突然生效，属于高影响面变更，必须独立评估与灰度。

### 9.2 🔴 "全局 Codex 家目录"与"仓库内 `.codex/` 目录"必须严格区分，误改会击穿 F238 门禁

`src/installer/skill-installer.ts:165-173` 的 `resolveTargetDir`：

```ts
const rootDir = platform === 'codex' ? '.codex' : '.claude';
if (mode === 'global') {
  return join(homedir(), rootDir, 'skills');   // ← 全局：MUST 走 CODEX_HOME helper
}
return join(process.cwd(), rootDir, 'skills'); // ← 项目内：MUST NOT 走 helper
```

**同一个函数、同一个 `rootDir` 变量，两个分支语义完全相反。** 盲目把 `.codex` 全量替换为 helper 会让 project 模式也指向 `CODEX_HOME`，破坏项目级安装。

同类"仓库内路径，**不得**改动"的点（`root` 为仓库根，非家目录）：
- `plugins/spec-driver/scripts/validate-orchestrator-models.mjs:84` — `path.join(root, '.codex/skills', ...)`
- `plugins/spec-driver/scripts/sync-delegation-contract.mjs:60` — 同形
- `plugins/spec-driver/scripts/codex-skills.sh:66` — project 模式 `TARGET_DIR="$PROJECT_ROOT/.codex/skills"`

**风险等级**：本仓库 `.codex/skills/` 是**真实存在的 F238 wrapper 产物目录**（含 9 个 `spec-driver-*/SKILL.md`），受 wrapper body-sha256 门禁保护。误改这些点会同时打断 `repo:check` 与 F238 门禁链路。

> **修法**：FR-007 MUST 显式区分两类点并给出判定规则——**只有以 `homedir()` / `$HOME` 为基的拼接才走 helper；以仓库根 / `process.cwd()` 为基的一律不动**。spec 应把上述"不得改动"清单写进 Edge Cases，并要求实施阶段以此为回归断言。

### 9.3 🔴 `$CODEX_HOME/hooks.json` 是全局单文件，直接写入会摧毁用户既有 hooks

冲突模型与现有 skills 安装**根本不同**：

| 制品 | 目标形态 | 冲突风险 |
|------|---------|---------|
| Codex skills（现状） | `$CODEX_HOME/skills/<skill-name>/SKILL.md`，**每 skill 独立目录** | 低，天然隔离 |
| Codex hooks（本 feature 新增） | `$CODEX_HOME/hooks.json`，**全局唯一共享文件** | 🔴 高，所有来源共用一个文件 |

用户的 `hooks.json` 可能已含其自有 hooks 或其他工具写入的条目。若安装流程直接覆写该文件，属于**静默数据丢失**。

> **修法**：spec 需新增 FR（或扩充 FR-005）明确写入语义。**但不要新造设计——本仓库已有一个经测试验证的同类实现可直接复用**：

#### 9.3.1 ✅ 现成可复用模式：`src/hooks/hook-installer.ts`

该模块已实现"向 Claude 的**共享** `settings.json` 合并写入 hook 并可精确移除"，即本节所需的全部语义，且有 18 个单测覆盖（实测全绿）：

| 语义 | 现有实现 | 位置 |
|------|---------|------|
| 归属识别 | `HOOK_COMMAND_MARKER = 'spectra-context.sh'`，靠 **`command` 字符串包含该标记**判定归属 | `hook-installer.ts:26` |
| 幂等 | `existingHooks.some(h => h.command.includes(HOOK_COMMAND_MARKER))` → 已装则跳过 | `:119-121` |
| 备份 | 写入前备份现有 `settings.json` | `:125` |
| 深度合并 | 保留所有已有字段，仅追加自己的条目 | `:130-137` |
| 原子写入 | — | `:139` |
| 精确移除 | 过滤掉含标记的条目，**保留其他条目** | `:182` |
| 非法 JSON 的处置 | **抛错要求用户手工修复，绝不覆写** | `:112`、`:171` |
| 类型防御 | `Array.isArray(rawHooks) ? rawHooks : []`，防字段被写成非数组 | `:118`、`:175` |

**关键设计优点（应当照搬）**：用 **`command` 字符串中的脚本名**做归属锚点，而不是往 JSON 里塞自定义字段。这规避了"自定义字段是否会被未来 Codex 版本严格拒绝"的未确证风险——我方 hook 的 `command` 本来就含 `stop-fix-compliance-check.sh` 等唯一脚本名，天然可用作标记。

> ✅ **结论**：§9.3 的 1~5 条要求**全部**已在 `hook-installer.ts` 中有可复用范式。spec 应要求 Codex hooks.json 的写入器**复用该模式**（抽共享 helper 或对称实现），并**明确禁止**：解析失败时以空对象覆写、无差别整体覆写、用自定义 JSON 字段做归属标记。Edge Cases 需覆盖"目标文件已存在且为非法 JSON"→ 报错不覆写。
