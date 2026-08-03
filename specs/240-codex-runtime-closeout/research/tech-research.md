# Feature 240 技术调研：Codex Runtime Closeout（A3 hooks 合同 + A4 CODEX_HOME/四方一致性）

## 1. 结论摘要

- **A3（Codex hooks 合同）整体可行，但风险集中在"覆盖面不稳定"而非"完全不存在"**。Codex CLI 确实有一套与 Claude Code 同构的 hooks 系统（`PreToolUse`/`PostToolUse`/`Stop`/`SessionStart` 等事件名一致，`WorktreeCreate`/`WorktreeRemove` 确认不存在——A3 point 1 可直接采纳），但 GitHub 上有多条近期 issue（#16732、#17794、#18491、#20204）显示 `apply_patch`/文件写入类工具的 hook 触发覆盖**长期不稳定、按 handler 逐个补齐**，本机 codex-cli 0.144.6 究竟落在这条演化线的哪个点**未经一手验证**，是本次调研最大的未知项。
- Codex plugin manifest（`.codex-plugin/plugin.json`）**已被 F213 一手实测证实不支持 `hooks` 字段**（本机 codex 0.142.0 对两份真实第三方 manifest 实测均无 hooks 字段）——hooks 只能走独立 `~/.codex/hooks.json` 或 `<repo>/.codex/hooks.json`（或 `config.toml` 内联段），这与 Claude 侧的 `plugins/*/hooks/hooks.json` 是完全不同的接线方式，A3 落地时**不能**照搬 F213 的 manifest 分发思路给 hooks 找位置。
- Stop compliance 判定链（`fix-compliance-judge.mjs`）**当前 100% 依赖 `transcript_path`**，没有任何代码路径读取 `.specify/runs/`；但 `.specify/runs/*.jsonl` 里已经有结构化的 `workflow-run-summary` / `fix-compliance-verdict` 事件在**同一次判定流程中被写入**，具备被读取作为主信号源的现成结构，A3 point 3 的落地方向是清楚的（改判定顺序，不是从零建数据源）。
- `PLUGIN_ROOT` 环境变量目前在仓库任何脚本里**均未出现**，全部 5 个 hook 脚本硬用 `CLAUDE_PLUGIN_ROOT`（`stop-fix-compliance-check.sh` 已有非 env 时的 fallback 推导逻辑可复用）。
- A4 的四方一致性诊断**没有现成聚合入口**：`contracts/codex-plugin-consistency.yaml` 只校验 manifest/skills/MCP 配置的静态一致性，不含版本号跨方对比；`judge-snapshot-doctor.mjs`（F236）已经把"仓库源码 vs 已安装 Claude 插件快照"这一条腿做对了（`resolveActiveSnapshot` 的优先级链 + `installed_plugins.json` 读取），是 A4 应该复用的判定模式，但它是 Claude-only（读 `~/.claude/plugins/installed_plugins.json`），Codex 侧的等价机制未经证实存在同名文件。
- `CODEX_HOME` 目前**零处**被仓库代码读取；所有全局 Codex 路径硬编码为 `homedir() + '.codex'`（或 shell 里的 `$HOME/.codex`），共发现 6 类需要收口的硬编码点（见 §3 表格）。

---

## 2. Q1：Codex hooks 事实（已证实 / 未证实分栏）

### 2.1 已证实（有多来源交叉印证，或有本仓一手实测）

| 事实 | 证据 |
|---|---|
| Codex 有独立的 hooks 子系统，事件名与 Claude Code 高度同构：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`PermissionRequest`、`Stop`、`PreCompact`/`PostCompact`、`SubagentStart`/`SubagentStop` | DeepWiki 对 `openai/codex` 源码的分析（引用具体源文件 `codex-rs/hooks/src/schema.rs:98-120`），[DeepWiki: Hooks System](https://deepwiki.com/openai/codex/3.11-hooks-system)；该来源基于对仓库源码的 RAG 索引而非泛化知识，可信度高于普通网页总结 |
| **不存在** `WorktreeCreate`/`WorktreeRemove` 事件 | 上表未出现该事件名；且本机 `codex --help` 顶层子命令、`codex plugin` 子命令均无 worktree 相关 hook 挂载点（见任务输入的已采集事实）。A3 point 1 的"保留为 Claude adapter 独有"可直接采纳 |
| `apply_patch` 工具的 hook 触发覆盖**历史上不稳定、按 handler 逐步补齐**，且截至近期（issue 编号显示为较新版本）仍有"多数工具从不触发 hook 事件"的报告 | [openai/codex#16732](https://github.com/openai/codex/issues/16732)（"ApplyPatchHandler doesn't emit PreToolUse/PostToolUse hook event. Hooks only fire for Bash tool."）、[#17794](https://github.com/openai/codex/issues/17794)（"File write operations do not fire PreToolUse/PostToolUse hooks"）、[#18491](https://github.com/openai/codex/issues/18491)（"Extend PreToolUse hooks beyond Bash"）、[#20204](https://github.com/openai/codex/issues/20204)（"Inconsistent PreToolUse hook coverage across tool handlers (most tools never emit hook events)"） |
| Codex plugin manifest（`.codex-plugin/plugin.json`）**不支持 `hooks` 字段**作为一等字段 | 本仓 F213 一手实测：`specs/213-codex-plugin-distribution/spec.md:141`——"本机 codex 0.142.0 对两份真实第三方 manifest（openai github v0.1.6、superpowers 5.1.3）的实测均未发现 hooks 字段"。这是**本仓库自己做过的实证**，优先级高于任何网页描述 |
| hooks 可以通过独立 `hooks.json` 文件或 `config.toml` 内联段配置（而非只能是 plugin manifest） | 与上一条互相印证：manifest 不支持 hooks，但生态确实存在能工作的 hooks（多篇 GitHub issue 在讨论 hooks 行为本身，说明功能可用只是接线方式不同）；[openai/codex#18893](https://github.com/openai/codex/pull/18893)（"codex: support hooks in config.toml and requirements.toml"）显示 hooks 原生位置是独立 schema，`config.toml` 内联支持是后加的 PR |
| Codex hooks 配置存在版本敏感的 bug 历史（如某版本 hook 为 map 而非 sequence 时启动失败、桌面版更新后 hooks 停止运行） | [openai/codex#19199](https://github.com/openai/codex/issues/19199)、[openai/codex#21639](https://github.com/openai/codex/issues/21639)。说明 hooks 子系统本身**变更频繁**，A3 的 E2E 不能只跑一次就假定长期稳定，需要在 CI/repo:check 里留一条"hook 是否真的触发了"的机械信号，而不是只信配置文件存在 |

### 2.2 未证实（多来源冲突或缺乏一手依据，本次调研不采信为事实）

| 待证实点 | 冲突/缺口说明 | 建议的本机实测命令 |
|---|---|---|
| **hook payload 中如何表达"目标文件路径"**（`apply_patch` 的 diff 里包含路径，但是否有独立 `file_path` 字段，还是要调用方自行解析 unified diff 文本） | DeepWiki 提到 "Command stdin is serialized into a stable JSON shape (e.g., `PreToolUseCommandInput`)"，但明确说明 "文档未详述这些工具如何在 hook payload 中表达目标文件路径"；另一次 WebFetch（`learn.chatgpt.com/docs/hooks`）给出了 `tool_input.command` 字段说法，但该来源**用词与 Claude Code 官方 hooks 文档几乎逐字重合**（`"Bash"`/`matcher` 字段/`hookSpecificOutput.permissionDecision` 等），高度怀疑是模型在处理该 URL 时把 Claude Code 已知知识"填补"进了摘要，**本次调研不采信这条 WebFetch 结果作为独立证据** | 手动创建 `~/.codex/hooks.json`（或 `<repo>/.codex/hooks.json`），注册一个只做 `cat > /tmp/codex-hook-payload-$$.json` 的 `PreToolUse` hook（matcher 覆盖 `apply_patch`/`Edit`/`Write`），跑 `codex exec "在 /tmp/scratch.txt 里加一行文字"` 之类的真实编辑 prompt，直接读落盘的 payload JSON 原文，不做任何解析假设 |
| **Codex hooks 是否需要显式 feature flag（如 `codex_hooks = true`）才能生效** | 一条第三方博客（agenticcontrolplane.com）称需要 `codex_hooks` feature flag；DeepWiki 对源码的分析未提及任何 feature flag，只提到"trusted hook"信任机制（`bypass_hook_trust`） | `codex features list` 里查是否存在名为 `hooks`/`codex_hooks` 的行（复用仓库已有的 `detect-codex-capability.mjs` 探测手法，`plugins/spec-driver/scripts/lib/detect-codex-capability.mjs` 已经是一个可直接扩展的探测器）；若存在则记录其 effective 值 |
| **hook 进程收到的环境变量集合，尤其是否已有类似 `PLUGIN_ROOT` 的官方注入变量** | DeepWiki 明确说"文档未提及任何环境变量"；`learn.chatgpt.com` 来源声称有 `PLUGIN_ROOT`/`PLUGIN_DATA`/`CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA`，但同理不采信（见上条理由）；且 hooks 目前既不挂在 plugin manifest 上（F213 实测），"plugin 相关环境变量"是否对独立 `hooks.json` 里的 hook 生效存疑 | 让上面同一个探测 hook 脚本额外 `env > /tmp/codex-hook-env-$$.txt`，实测比对是否存在 `PLUGIN_ROOT`/`CODEX_PLUGIN_ROOT`/`CODEX_HOME` 等变量 |
| **hook 阻断的确切退出码/JSON 语义（是否与 Claude Code 的 exit 2 + stderr / `{"decision":"block"}` 完全一致）** | DeepWiki 只确认"If a hook blocks, the tool is not run"和存在 `output_parser` 模块，未给出具体 exit code 数值；本机 codex 0.144.6 无法通过 `--help` 直接确认 | 同一探测 hook 分别测试 `exit 0`、`exit 2`、`exit 1`、stdout 输出 `{"decision":"block","reason":"test"}` 四种组合，观察 `codex exec` 是否真的阻断了后续 apply_patch |
| **本机 codex-cli 0.144.6（Homebrew Cask）落在 GitHub issue 演化线的哪个点**（即 apply_patch hook 覆盖是否已修复到"可用"程度） | 版本号 0.144.6 远高于已知修复 PR 引用的版本区间，但 issue 号本身不含版本对应表，且 GitHub 页面本次未能直接 fetch（`WebFetch` 报 "Unable to verify domain" 网络限制），无法核对 milestone/fixed-in 版本 | 直接执行"2.2 第一条"的实测；如果 payload 能正确拿到，覆盖问题已解决，如果拿不到，需要在 spec 里把 apply_patch E2E 降级为"已知覆盖缺口"并记录 issue 链接 |

### 2.3 Q1 对 A3 三个子目标的直接影响

1. **子目标 1（只用 Codex 实际支持的事件）**：可行，`WorktreeCreate`/`WorktreeRemove` 排除已证实。
2. **子目标 2（apply_patch/Edit/Write 真实 payload E2E）**：**方向可行但落地前必须先跑 2.2 第一条实测**，否则 E2E 可能在写测试时对着一个从未真实发生过的 payload 形状断言，重蹈本仓库"猜测污染事实源"的历史教训。
3. **子目标 4（`PLUGIN_ROOT` 支持）**：Claude 侧新增 `PLUGIN_ROOT` 作为 `CLAUDE_PLUGIN_ROOT` 的通用别名是我们自己脚本层面的事（不依赖 Codex 官方是否注入同名变量），**这一条与 Codex 官方行为无关，可以独立推进**，不受 2.2 未证实项阻塞。

---

## 3. Q2：本仓库现状

### 3.1 hooks.json 与脚本

- `plugins/spec-driver/hooks/hooks.json`：声明 `SessionStart`（postinstall）、`PreToolUse`（`Edit|Write` matcher → `pre-tool-use-guard.sh`）、`PostToolUse`（`Edit|Write` matcher → `post-tool-use-format.sh`）、`Stop`（两个并列 hook：`stop-task-check.sh` + `stop-fix-compliance-check.sh`）、`WorktreeCreate`/`WorktreeRemove`（均指向 `worktree-lifecycle.sh`）。
- `plugins/spectra/hooks/hooks.json`：只有 `SessionStart`（postinstall），无 PreToolUse/PostToolUse/Stop/Worktree。
- 五个脚本消费的环境变量与 stdin 字段：

| 脚本 | 消费的 env | 消费的 stdin 字段 | 备注 |
|---|---|---|---|
| `pre-tool-use-guard.sh` | 无（仅靠 `$(pwd)` 相对 `specs/*/tasks.md`） | `.file_path`（jq，降级 grep/sed） | matcher 已限定 Edit\|Write，未处理 `apply_patch` |
| `post-tool-use-format.sh` | 无 | `.file_path` | 同上 |
| `stop-task-check.sh` | 无 | 无（直接扫 `specs/*/tasks.md`） | 非阻断，恒 exit 0 |
| `stop-fix-compliance-check.sh` | `CLAUDE_PLUGIN_ROOT`（有 fallback：脚本自身相对路径推导 `hooks/..`）、`FIX_COMPLIANCE_CLI`（覆盖用） | 整个 stdin 原样转发给 Node CLI（Node CLI 内部再解析 `.transcript_path`/`.session_id`） | 薄壳，判定逻辑全在 `fix-compliance-judge.mjs` |
| `worktree-lifecycle.sh` | 无直接消费（`scripts/sync-worktree-local-state.sh` 内部可能消费） | `.action`（create/remove）、`.worktree_path`（remove 时） | Codex 无对应事件，A3 落地后此脚本对 Codex 是死代码 |

- `CLAUDE_PLUGIN_ROOT` 唯一使用点：`stop-fix-compliance-check.sh:11`（`plugins/spec-driver/hooks/stop-fix-compliance-check.sh:11`）。其余四个脚本完全不依赖插件根路径（用相对 `$(pwd)` 或直接调用系统命令），**只有这一处需要新增 `PLUGIN_ROOT` 兼容分支**。
- transcript 解析点：全部集中在 `plugins/spec-driver/scripts/fix-compliance-judge.mjs`（`readTranscriptEntries(transcriptPath)`，`transcriptPath` 来自 hook stdin 的 `payload.transcript_path`），无其他脚本读 transcript。

### 3.2 `.codex-plugin/plugin.json` 是否声明 hooks

- `plugins/spec-driver/.codex-plugin/plugin.json`（读取全文，见上）：字段仅 `name/author/license/keywords/skills/version/description`，**无 `hooks` 字段**。
- `plugins/spectra/.codex-plugin/plugin.json`：同上，**无 `hooks` 字段**。
- 与 F213 spec.md:141 的实测结论一致（"Codex plugin manifest schema 当前不支持 hooks 作为一等字段"），FR-006 已把 A1 对 hooks 的交付范围收窄为"包内 ship 脚本文件"，Codex runtime 下的真实触发行为显式划给 A3（`specs/213-codex-plugin-distribution/spec.md:39`）。

### 3.3 `contracts/codex-plugin-consistency.yaml` 现有校验范围

`contracts/codex-plugin-consistency.yaml` 当前只覆盖：
- 两个产品的 `codexManifestPath`/`mcpConfigPath`/`mcpServerName`/`skillsReference`/`skillsRoot`/`skillSourceContract`/`wrapperSourceContract`（静态文件存在性 + 字段值匹配）
- `marketplace.expectedPlugins` 名单
- `waivers`（当前为空）

**它不做任何版本号跨方对比**（不比较仓库版本 vs 全局 CLI vs plugin build vs MCP server），也不涉及 hooks 事件声明校验。A4 的四方一致性诊断应该**新建独立判定器**（类似 `judge-snapshot-doctor.mjs` 的独立 CLI 模式：不接入 `hooks.json`、不接入 `repo:check` 硬阻断，先做诊断工具），而不是往 `codex-plugin-consistency-core.mjs` 里加字段——后者是"静态制品一致性"合同，四方版本诊断是"运行时环境一致性"诊断，职责边界不同（`scripts/lib/codex-plugin-consistency-core.mjs` 消费 `contracts/codex-plugin-consistency.yaml`，两者是强绑定的 schema 合同，混入运行时探测会破坏其"纯静态文件校验"的可测试性）。

### 3.4 Stop compliance 链路现状

- 判定入口：`plugins/spec-driver/hooks/stop-fix-compliance-check.sh` → `plugins/spec-driver/scripts/fix-compliance-judge.mjs --mode hook`。
- 判定器**目前唯一的事实源是 `payload.transcript_path`**（`fix-compliance-judge.mjs:109` `readTranscriptEntries(transcriptPath)`），若 transcript 不可用/超限 → `transcriptDiagnostics` 非空 → FR-013 fail-open 放行（`fix-compliance-judge.mjs:110-114`）。
- **`.specify/runs/` 当前完全不被这条判定链读取**（`grep '\.specify/runs'` 在 `fix-compliance-judge.mjs` 内零命中），但同一次判定流程的**输出**会被写入 `.specify/runs/<YYYY-MM>.jsonl`（`eventType: "fix-compliance-verdict"` / `"workflow-run-summary"`，见 `.specify/runs/2026-07.jsonl` 实际样本，含 `sessionId`/`compliant`/`missing`/`closureForm`/`degraded` 等结构化字段）。这意味着：**A3 point 3 要读的"显式状态"结构已经存在，只是当前只写不读**——如果同一个 `sessionId` 在 `.specify/runs/` 里已经有本次 fix 流程的最新 verdict，判定器理论上可以直接读它作为主信号源，transcript 降级为交叉校验/补充信号，而不是唯一事实源。
- 该判定链的累积历史（F208/F216/F224/F228/F229/F230/F231/F236）反复证明：**判定器的每一次收窄都暴露新的绕过面**（伪造 mv、不成对花括号、复合命令劫持等），A3 改造判定顺序时必须走完整的对抗审查流程，不能只做"读取源切换"当作低风险改动。

### 3.5 `~/.codex` 硬编码点完整清单

| 文件:行 | 当前写法 | 归类 |
|---|---|---|
| `src/auth/auth-detector.ts:126` | `existsSync(join(home, '.codex', 'auth.json'))`（`home` 来自 `getHomeDir()` = `process.env['HOME'] \|\| process.env['USERPROFILE'] \|\| ''`） | 全局路径解析——auth detector，需走 CODEX_HOME helper |
| `src/scripts/postinstall.ts:28` | `existsSync(join(homedir(), '.codex'))` | 全局路径解析——判断是否装了 Codex 决定 skill target，需走 helper |
| `src/scripts/preuninstall.ts:56`（`rootDir = platform === 'codex' ? '.codex' : '.claude'`，与 `homedir()` 联用于卸载路径） | 同 skill-installer 模式 | 全局路径解析——需走 helper |
| `src/installer/skill-installer.ts:167,169,260,272,274`（`resolveTargetDir`/`formatSummary`/`formatDisplayPath`/`formatDisplayDir`） | `rootDir = platform === 'codex' ? '.codex' : '.claude'`；`join(homedir(), rootDir, 'skills')` | 全局路径解析——skill installer 核心，是 CODEX_HOME helper 最主要的落点 |
| `plugins/spec-driver/scripts/codex-skills.sh:57` | `TARGET_DIR="$HOME/.codex/skills"`（global 模式） | 全局路径解析——shell 侧，需要 shell 版 helper（或 source 一个公共 `.sh` 片段） |
| `plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs:82` | 字符串替换文本里硬编码 `~/.codex/spec-driver-capability.md` 的**提示文案**（面向 Codex 用户展示的说明文字，非实际路径解析代码） | 文案性质，不是路径解析逻辑——**不需要**接入 CODEX_HOME helper 本体，但如果 A4 helper 落地后 CODEX_HOME 可被自定义，这条提示文案会产生"说的路径和实际路径不一致"的误导，需要同步改为动态描述或明确加注"默认路径，实际以 CODEX_HOME 为准" |
| `plugins/spec-driver/scripts/lib/detect-codex-capability.mjs`（全文） | 不直接拼 `~/.codex` 路径，只探测 `codex features list`/`codex --version`（子进程调用），sidecar 落盘路径由调用方 `codex-skills.sh` 决定 | 不属于路径硬编码点，但其调用方 `codex-skills.sh` 的 `TARGET_DIR` 才是硬编码源 |
| `src/core/model-selection.ts`（FU-1 记录，`~/.codex/config.toml` 的**未来**惰性读取，当前尚未实现） | 尚未落地代码，仅是 F238 follow-up 决策记录 | **计划中**的硬编码点——F238 follow-up 已明确建议"归属 A4，复用统一 helper"（`specs/238-codex-wrapper-completeness/follow-ups.md:9`），本 Feature 若不实现该 FU-1 本体，至少应该让 helper 的接口形状容纳它 |
| （worktree cache，F239）—— 未发现直接 `~/.codex` 硬编码 | 经 grep 未在 `sync-worktree-local-state.sh`/`worktree-lifecycle.sh` 等 F239 相关文件中发现 `~/.codex` 路径拼接 | F239 的 worktree cache 机制走的是 `.worktreeinclude`/项目内路径，不涉及全局 Codex home；A4 提到的"worktree cache 使用同一 helper"需要向 F239 作者/`specs/239-worktree-local-state/` 二次确认其"cache"具体指代哪个组件（本次未在源码里找到明确对应点，可能指 `~/.codex/plugins/cache/`——见下条） |
| （Codex 自身的 plugin cache 目录）`~/.codex/plugins/cache/<market>/<plugin>/<version>/` | 仅在测试清理代码里出现：`tests/e2e/feature-213-codex-plugin-install.e2e.test.ts:73` | 这是 **Codex CLI 自己管理的缓存目录结构**（非我们代码写入路径），我们只能读取/清理它，不能改变其命名规则；A4 的"plugin build"一方信号应该从这里读版本，但目录 schema 本身不是"待收口的硬编码"，而是需要被动适配的外部合同 |

**helper 现状**：仓库里**没有**任何现成的"CODEX_HOME 解析" helper。相邻可参考的对称结构是 `getHomeDir()`（`src/auth/auth-detector.ts:81`，只处理 `HOME`/`USERPROFILE`，不处理任何 `_HOME` 类应用专属变量）——`CLAUDE_CONFIG_DIR` 之类的变量在本仓库搜索**零命中**，即 Claude 侧也没有先例可抄，A4 需要从零设计这个 helper 的接口形状（建议：`resolveCodexHome({ env = process.env, homedir = os.homedir } = {})` 纯函数，`CODEX_HOME` 优先，未设置时 fallback `path.join(homedir(), '.codex')`，Node 侧一份 + shell 侧一份 `source` 片段）。

---

## 4. Q3：四方一致性诊断的可行判定信号

| 一方 | 可读信号 | 读取方式 | 读不到时的降级 | 漂移时能给出的 next-step |
|---|---|---|---|---|
| **仓库版本** | `contracts/release-contract.yaml` 的 `products.spec-driver.version`/`products.spectra.version`（当前均为 `4.4.0`），或 `package.json` 的 `version` 字段 | 纯文件读取 + YAML/JSON 解析，无子进程 | 文件缺失/解析失败 → `indeterminate`（不可判定），不得当作"一致" | 提示"这是唯一事实源，若与其余三方不符，以此为准调整其余三方" |
| **全局 CLI** | `spectra --version` 的 stdout（F186 已让其带 build commit 后缀，`project_f186_distribution_reliability_shipped` 记忆确认） | `execFileSync('spectra', ['--version'], { timeout })`，仿照 `detect-codex-capability.mjs` 的子进程错误分类模式（ENOENT/超时/非零退出分别归类，不抛异常） | 二进制不存在/未装 → 明确"未安装"而非当作"一致"；PATH 里有旧版 volta 包装脚本时可能直接报错（`project_spectra_cli_volta_blocker` 记忆）——需要能区分"命令失败"与"命令输出但版本不匹配" | 提示"运行 `npm install -g spectra@<repo版本>` 或对应 Codex 端安装命令" |
| **plugin build** | plugin cache 目录下 `plugin.json` 的 `version` 字段 + **installPath**（F236 教训：**不能取"最高版本号"，必须找元数据里标记的 active installPath**） | Claude 侧已有现成模式可复用：`judge-snapshot-doctor.mjs` 的 `resolveActiveSnapshot()`（`plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs:52`）读取 `~/.claude/plugins/installed_plugins.json` 找 active installPath，再读该路径下 `plugin.json`。Codex 侧**未证实**是否存在同名"active 标记文件"（本次调研只确认了 `~/.codex/plugins/cache/<market>/<plugin>/<version>/` 的缓存目录结构，未确认哪个是"当前生效"版本的机制） | Codex 侧若找不到等价的 active 标记文件 → 该维度标记为 `indeterminate`（reason: `codex-active-marker-unknown`），**不允许**回退到"取 cache 目录下最高版本号"（F236 已证伪这种做法的正确性——同一目录可能残留多个已废弃版本） | 提示"运行 `codex plugin list` 人工核对，或补充实测确认 active 标记文件位置后升级此诊断" |
| **MCP server** | 当前 live 服务的 Spectra MCP server 是哪个二进制/版本 | 无直接文件读取手段；`project_live_mcp_server_is_global_stale_build` 记忆已确认"worktree 里 live Spectra MCP 常是全局旧编译产物"——这是一个**已知的运行时黑箱问题**，最可靠信号是 MCP server 自身若暴露版本查询能力（例如某个 tool 或 server info 返回版本号），否则只能通过"进程命令行参数/cwd"侧面推断（如 `ps` 找到 server 进程后看其 `--config`/加载路径指向哪个 `.mcp.json`） | 找不到显式版本查询接口 → `indeterminate`，明确写"MCP server 本身当前不暴露版本自省能力，此诊断为已知缺口" | 提示"重启/reload MCP client 使其指向最新构建"，并**记录为一个可能需要额外 Feature 补齐"MCP server 版本自省"的产品缺口**（不在本次 A4 范围内解决，只诊断和标注） |

**综合建议**：四方诊断应该产出一个**判别式联合结果**（仿照 `judge-snapshot-drift-result.md` 的 `not-applicable`/`indeterminate`/`in-sync`/`drift` 四态设计），每一方独立可 `indeterminate`，总体结论取"最悲观"的那一方，且**明确禁止**在任一方 `indeterminate` 时静默把整体判为 `in-sync`（这正是 F236 反复强调的"不允许整体短路"教训）。

---

## 5. Q4：既有约束与教训

- **F213（A1，`specs/213-codex-plugin-distribution/`）**：已交付 `.codex-plugin/plugin.json` 一体分发 + 一致性矩阵门禁（`contracts/codex-plugin-consistency.yaml`）。**显式排除**了 hooks 在 Codex runtime 下的真实触发验证（"该验证属 A3"，spec.md:39），且已一手实测确认 manifest 不支持 hooks 字段（spec.md:141）——A3/A4 不应该也不能通过扩展 F213 的 manifest 校验来实现 hooks 合同。
- **F236（`specs/236-judge-snapshot-drift-signal/`）**：贡献了 A4 应直接复用的判定模式——(1) 三元组显式注入合同（`{ projectRoot, env, claudeHome }`，不隐式读 `cwd`/全局 env）；(2) `resolutionSource` 优先级链 + 判别式联合结果，`indeterminate` 按 `indeterminateKind` 细分呈现（`resolution` vs `comparison`），不得用"整体 reason"笼统掩盖已确认的部分明细；(3) **"active 快照解析禁止取最高版本号，必须用元数据里的 installPath"**——这是 A4 在处理"plugin build"一方时必须原样继承的硬约束，Codex 侧若无法确认同等机制，宁可标 `indeterminate` 也不能类比推断。
- **F238（`specs/238-codex-wrapper-completeness/`）**：follow-ups.md 明确把 `DEFAULT_CODEX_MODEL` 的 `~/.codex/config.toml` 读取（FU-1）划归 A4 范围（"A4 本就要统一 CODEX_HOME 路径 helper，`~/.codex/config.toml` 读取应复用该 helper 而非本 Feature 单独造轮子"，follow-ups.md:9）。**本 Feature 若不落地 FU-1 本体，至少需要让 helper 接口形状能被 FU-1 后续复用**（不重复设计一遍）。另外 F238 also明确"插件版本 SemVer bump 延后到 F239+F240 合流后的发布收口轮做一次"（follow-ups.md:26），说明本 Feature（240）交付时**大概率需要连带处理一次 version bump**（4.4.0 → 4.5.0），这是发布流程约定，不是纯技术调研范畴，但会影响 A4 的"仓库版本"这一方读到的具体值。
- **F239（`specs/239-worktree-local-state/`）**：核心是 `.worktreeinclude` 官方机制 + 安全子集选择，**worktree cache 相关代码未直接触碰 `~/.codex` 路径**（本次 grep 未命中）。遗留 **T039**（`specs/239-worktree-local-state/tasks.md:261-269`，当前状态 `- [ ]` 未完成）是"在真实 Codex 桌面客户端里人工验证 `.worktreeinclude` 的 copy-if-absent 语义 + `AGENTS.override.md` 生效顺序"，与本 Feature 的 A3/A4 范围**不直接重叠**（T039 关注 worktree 文件同步行为，本 Feature 关注 hooks/CODEX_HOME），但**同属"需要真实 Codex 客户端手工验证"**这一类未闭合缺口，建议在本 Feature 的验收清单里与 T039 并列记录、避免重复排期或遗漏。
- **milestone-M9 §3 A3/A4 原文**（`docs/design/milestone-M9-codex-trusted-live-graph.md:80-91`）与本次任务输入的需求描述逐字一致，§93-98 的"A 轨验收"额外要求：`codex mcp list`/plugin inventory 可机械确认 Spectra 已启用；Codex hook E2E 覆盖 **allow / block / failure-degrade / Stop 四路径**（比任务输入描述的"能拿到路径并执行或阻断"更细，四路径里的 `failure-degrade` 对应 hook 脚本自身异常时的降级行为，需要在测试设计里显式覆盖，不能只测 allow/block 两态）。milestone §12（M9-SC-002）要求"自定义 `CODEX_HOME`、Codex-managed worktree、手工 Git worktree 三路径 E2E 全绿"——本 Feature 的 A4 至少要覆盖"自定义 CODEX_HOME"这一路径。
- milestone frontmatter 把 `https://learn.chatgpt.com/docs/hooks` 列为 sources 之一，但本次调研对该域名的 WebFetch 结果**高度疑似模型用 Claude Code 已知知识填补**（见 §2.2），建议后续若要引用该来源作为权威依据，必须先人工确认该 URL 真实可访问且内容与 Claude Code 文档存在实质差异，否则不应作为 A3 设计依据。

---

## 6. 技术选型建议

### 6.1 A3 hooks 合同

- **推荐**：新增 `plugins/spec-driver/hooks/hooks.codex.json`（独立文件，不复用 Claude 侧 `hooks.json`），仅声明 Codex 已证实支持的事件子集（`SessionStart`/`PreToolUse`/`PostToolUse`/`Stop`），排除 `WorktreeCreate`/`WorktreeRemove`；由 `codex-skills.sh` 或类似安装脚本在 Codex 安装路径下落地为 `~/.codex/hooks.json` 或 `<repo>/.codex/hooks.json`（**不**塞进 `.codex-plugin/plugin.json`，F213 已证实该字段不被支持）。
  - **被否决方案**：往 `.codex-plugin/plugin.json` 加 `hooks` 字段——F213 一手实测已证伪 schema 支持，继续尝试是重复造已知不通的轮子。
- **推荐**：`stop-fix-compliance-check.sh`/`fix-compliance-judge.mjs` 的判定顺序改为"先查 `.specify/runs/` 是否已有本次 session 的最新结构化 verdict → 有则以此为主信号，transcript 仅做交叉校验（存在性/时间戳合理性）→ 都没有才走当前 fail-open"。
  - **被否决方案**：完全弃用 transcript、只信 `.specify/runs/`——`.specify/runs/` 目前的写入本身依赖同一次判定流程执行完成，如果判定流程尚未来得及写 runs 记录就被 Stop 拦截，会出现"无数据可读"的新盲区，不能简单替换，只能是"优先级调整+双源校验"。
- **落地前置条件**：§2.2 的实测清单必须先跑完，否则 apply_patch E2E 的断言基于未验证假设，重演本仓库历史上"猜测污染事实源"的教训（F229/F224 等）。

### 6.2 A4 CODEX_HOME 与四方诊断

- **推荐**：新增 `src/core/codex-home.ts`（或 `scripts/lib/resolve-codex-home.mjs`，与现有 `src/`/`scripts/lib/` 双轨结构对齐）导出 `resolveCodexHome({ env, homedir })` 纯函数；shell 侧对称提供一个可 `source` 的片段（如 `plugins/spec-driver/scripts/lib/codex-home.sh`），供 `codex-skills.sh` 等 `.sh` 脚本复用，避免 Node/shell 各写一份走样。
  - **被否决方案**：只在 Node 侧实现、shell 脚本继续硬编码 `$HOME/.codex`——需求明确要求"auth detector / skill installer / plugin install / worktree cache 统一使用同一个 helper"，`codex-skills.sh` 是纯 shell 脚本，不接入 helper 会留下一个明知的不一致点。
- **推荐**：四方一致性诊断做成独立 CLI（如 `plugins/spec-driver/scripts/codex-runtime-doctor.mjs`），不接入 `hooks.json`、不做硬阻断门禁（对齐 `judge-snapshot-doctor.mjs` 的"诊断不阻断"定位），输出判别式联合结果，四方任一方 `indeterminate` 时整体不得判 `in-sync`。
  - **被否决方案**：把版本对比塞进 `codex-plugin-consistency-core.mjs`——该 core 是静态制品 schema 合同（YAML 驱动），混入运行时子进程探测/文件系统探测会破坏其"纯函数、无副作用"的可测试边界，且会让 `repo:check` 的静态检查链路意外变成依赖本机是否装了 Codex CLI 的动态检查，影响 CI 可重复性。
- **`MCP server` 一方**：本次调研未找到可靠的"当前生效 MCP server 版本自省"手段，**建议本 Feature 范围内只做"尽力而为"的诊断（如 `ps` 侧面推断 + 明确标注局限性），不承诺解决"MCP server 版本自省"这一更底层的产品缺口**，避免范围蔓延。若需要彻底解决，应该是独立的后续 Feature（给 MCP server 自身加一个 `server/info` 之类的自省能力）。

---

## 7. 风险与未知

1. **【最高优先级未知】** Codex hooks 对 `apply_patch`/`Edit`/`Write` 的真实 payload 形状（尤其"目标文件路径"字段名）**未经一手验证**，本次调研的所有相关 WebFetch 交叉结果存在冲突且部分疑似模型填补而非真实站点内容。**必须先跑 §2.2 的本机实测清单，再动手写 A3 的 E2E 测试**。
2. Codex hooks 是否需要显式 feature flag 开启，本次未证实；若确实需要 flag 且默认关闭，A3 的"真实 payload E2E"会在默认环境下测不出任何事件，需要在测试前置条件里显式开启该 flag（如果存在）。
3. hook 阻断的确切 exit code / stdout JSON 语义未经一手验证，`stop-fix-compliance-check.sh` 现有的 "exit 0/2 转发" 模式是否能直接套用到 Codex 侧未知。
4. Codex 侧是否存在与 `~/.claude/plugins/installed_plugins.json` 等价的"active plugin 元数据文件"（决定 A4 能否照抄 F236 的 `resolveActiveSnapshot` 模式）——本次调研未找到，只确认了 `~/.codex/plugins/cache/<market>/<plugin>/<version>/` 缓存目录结构本身，缺少"哪个版本当前生效"的机械信号来源。
5. Spectra MCP server 版本自省能力缺失是一个独立于本 Feature 的产品缺口，本次调研建议明确排除在 A4 交付范围之外，但应作为 follow-up 记录。
6. F239 T039（Codex 桌面客户端人工验证）与本 Feature 的手工验证需求同属"依赖真实 Codex 客户端"这一类，建议交付计划里统一考虑一次性安排（同一台机器/同一次人工验证 session 覆盖两组验证项），避免分两次占用人工验证成本。
7. `docs/design/milestone-M9-codex-trusted-live-graph.md` frontmatter 引用的 `https://learn.chatgpt.com/docs/hooks` 来源真实性存疑（见 §5 最后一条），若后续 plan/spec 阶段需要引用该文档作为设计依据，应先由人工确认可访问性与内容准确性。
