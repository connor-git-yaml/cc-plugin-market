\
# 技术调研报告: Feature 238 — Spec Driver Codex Wrapper 完整性

**特性分支**: `238-codex-wrapper-completeness`
**调研日期**: 2026-08-02
**调研模式**: [独立模式] 未找到 `research/product-research.md`，直接基于用户需求描述执行；同时受工具权限限制，未能实际执行 shell 命令（本环境未提供 Bash 工具），Q1/Q2 改为「本机配置文件只读检查 + WebSearch 公开资料交叉验证」，已在下文逐条标注证据来源。
**产品调研基础**: 无（独立模式）

## 0. 范围澄清

本次调研聚焦 `plugins/spec-driver/scripts/codex-skills.sh` 中 `write_codex_adapter()` 生成的两条静态文案：

```
- 子代理执行：正文中的 `Task(...)` / `Task tool` 在 Codex 中视为当前会话内联子代理执行
- 模型兼容：保持 `--preset -> agents.{agent_id}.model(仅显式配置时生效) -> preset 默认` 优先级；runtime=codex 时先做 `model_compat` 归一化，不可用时标注 `[模型回退]`
```

目标是评估把它们升级为**运行时能力探测（capability adapter）**与 **runtime-neutral quality tier** 的技术可行性。

## 1. 调研目标

**核心问题**:
- Q1: Codex CLI 是否具备等价于 Claude `Task tool` 的子代理 / 并行调度能力？是否有可机械判定的信号？
- Q2: 不显式传 `--model` 时，Codex CLI 用什么决定模型？「把模型选择交还 Codex CLI」是否可行？
- Q3: 仓内散落的具体模型版本字面量现状盘点，区分「必须清理」与「合法保留」
- Q4: 把「不传 --model」设为默认，对现有 API（`resolveCodexExecutionConfig` / `getCanonicalSonnetModelId`）有何破坏性；capability 探测放在哪一层

## 2. Q1 — Codex CLI 子代理 / 并行调度能力

### 实测证据（本机 `~/.codex/config.toml`，只读）

```toml
[features]
multi_agent = true
apps = true
prevent_idle_sleep = true
js_repl = false
```

本机 `~/.codex/config.toml` 第 79-83 行确认存在 `features.multi_agent = true` 开关，与用户主目录下真实存在的 Codex 安装（`~/.codex/` 内有 `plugins/cache/` 等大量运行态产物，`CODEX_CLI_PATH = /Applications/ChatGPT.app/Contents/Resources/codex`）对应。**由于本环境未提供 Bash 工具**，未能实测执行 `codex --version` / `codex --help` / `codex exec --help` / `codex mcp --help` 等命令，无法拿到 CLI 侧的一手 stdout 证据，这是本次调研相对于任务要求的一个**已知缺口**，建议在有 Bash 权限的环境（如 plan/implement 阶段）补跑一次只读命令核验。

### WebSearch 交叉验证 [推断，来源为第三方技术博客，非官方文档一手引用，需二次核实]

- 多篇 2026 年技术博客（Codex Knowledge Base、Morph、Flowdevs 等）一致描述：Codex CLI（较新版本）支持通过 `~/.codex/config.toml` 的 `[features] multi_agent = true` 开启子代理能力，或用 `/experimental` 交互式切换；开启后可配置 `[agents.<role>]` 定义角色专属 model/sandbox/MCP，还有 `max_threads`（默认 6）、`max_depth`（默认 1）、`job_max_runtime_seconds`（默认 1800）等参数控制并行调度深度与超时。
- 这与本机配置文件中真实存在的 `multi_agent = true` 字段**互相印证**：本机实测配置证明该字段确实是 Codex CLI 识别的合法 schema key（否则 CLI 通常会在解析 config.toml 时报警告/拒绝未知字段），公开资料描述的语义与本机观察到的字段命名一致。

### 判定结论

- **可机械判定的能力信号**：`~/.codex/config.toml` 中 `[features].multi_agent` 布尔值，是目前唯一可静态读取、无需触发真实推理调用的信号。
  - `true` → 子代理/并行调度能力**存在且已启用**，此时 wrapper 文案可以从「视为内联执行」升级为「可委派为真实并行 sub-agent（受 `max_threads`/`max_depth` 限制）」。
  - `false` 或字段缺失（旧版本 CLI /未升级用户）→ 应判定为「能力不可用」，wrapper 退回当前「视为当前会话内联子代理执行」的降级文案，不应假设用户已开启实验特性。
- **次优信号（无法验证但值得记录）**：`codex --help` / `codex exec --help` 的输出中是否出现 `agent` / `subagent` / `delegate` / `parallel` 相关子命令或 flag，需要在有 Bash 权限时用只读 `--help` 输出核实，作为 config 字段之外的第二重证据（三方博客未给出 CLI flag 层面的确凿文本，只提及 config.toml 与斜杠命令）。
- **不可用时最可靠的「不可用」证据**：`multi_agent` 字段不存在 **或** 值为非 `true`（含 `false` / 字符串 / 数字等非法值）。由于该字段是 opt-in 实验特性（第三方资料称需手动开启并重启），**默认全新安装大概率是关闭状态**，因此 wrapper 的保守默认应当是「假设不可用，除非探测到 `true`」。

## 3. Q2 — Codex CLI 默认模型选择行为

### 实测证据（本机 `~/.codex/config.toml`，只读，已脱敏）

```toml
model = "gpt-5.6-sol"
model_reasoning_effort = "xhigh"
...
[notice.model_migrations]
gpt-5 = "gpt-5.3-codex"
```

- 第 1 行 `model = "gpt-5.6-sol"` 说明本机已经**显式 pin** 了模型，与 `CLAUDE.md` §评测凭据策略记录的 driver 型号（`codex:gpt-5.6-sol`，2026-07-19 升级）完全一致，互相印证仓库内记忆条目的准确性。
- `[notice.model_migrations]` 段存在 `gpt-5 = "gpt-5.3-codex"` 的迁移映射，说明 Codex CLI 自身也维护一张「旧模型 ID → 新模型 ID」的内建迁移表，佐证「模型 ID 会随官方发布节奏漂移，客户端程序不应硬编码具体版本」这一设计取向是 Codex CLI 官方自己也在实践的模式。
- 未在本机配置中发现任何进程环境变量/密钥字面量，本节未抄录任何 token（`OPENROUTER_API_KEY` 等敏感字段已跳过，不纳入报告）。

### WebSearch 交叉验证

- 公开资料描述的配置优先级为：命令行 `--model` / `-c` 覆盖 > 项目级 trusted config > 显式 `--profile` > 用户级 `~/.codex/config.toml` 的 `model` 字段 > 系统级 config > CLI 内建默认值。用户级 `model` 字段是"持久化默认模型"的 canonical 位置。
- `/status` 命令可用于查看生效配置（而非靠猜测哪层配置生效）。

### 判定结论

- **技术上成立**：不显式传 `--model` 时，Codex CLI 会读取 `~/.codex/config.toml` 的 `model` 字段作为默认值，若用户也未设置该字段，则退回 CLI 内建默认（具体默认值未在本次调研中一手核实，需要 `codex --help` 或 `/status` 输出佐证，属于本次已知缺口）。
- 这意味着 wrapper「把模型选择交还 Codex CLI」的实现路径是**不传 `-m` / `--model` 参数给 `codex exec` 子进程**，让 CLI 自己按上述优先级解析；这与仓库现有的 `resolveCodexExecutionConfig()` 强制返回一个具体 `model: string` 并透传给 `callLLMviaCodex` 的当前实现方式（见 §5 Q4）是**相反**的设计取向，需要在 plan 阶段做取舍：
  - 对 wrapper 文案场景（`codex-skills.sh` 生成的 SKILL.md 静态说明）：完全可以做到「不写死具体版本号，改写成『遵循 Codex CLI 自身的模型解析优先级』的描述性文案」，零代码风险。
  - 对 `resolveCodexExecutionConfig()` 实际驱动 `codex` 子进程调用的场景（`src/auth/codex-proxy.ts`）：把 model 设为可选、省略 `-m` flag 需要改代码路径，属于更大改动，见 Q4。

## 4. Q3 — 仓内散落模型版本字面量现状盘点

（`grep -rn "gpt-5"` 命中 40+ 处，按类别归纳，未逐行穷举）

### 4.1 必须清理（宣称性文案 / skill body / README / config 模板）

| 文件 | 行号 | 内容摘要 | 问题 |
|------|------|---------|------|
| `plugins/spec-driver/scripts/codex-skills.sh` | 127 | wrapper adapter 固定文案「先做 `model_compat` 归一化」——虽未直接写死版本号，但未来升级为 tier 描述时需同步改 | 本次改造目标本身 |
| `plugins/spec-driver/README.md` | 196-200, 213 | `opus/sonnet/haiku` 映射到 `gpt-5.4`，示例配置 + 正文说明 | `gpt-5.4` 已过期（本机实际 pin 到 `gpt-5.6-sol`），属对外宣称性文案，会误导用户认为固定用 5.4 |
| `README.md`（根） | 182 | `Multi-runtime model compat — ... Codex (gpt-5.4 + thinking levels)` | 同上，面向用户的营销/说明文案 |
| `docs/configuration.md` | 34-43, 87 | 配置示例 + 正文「Codex 默认统一映射到 gpt-5.4」 | 面向用户的文档，需要改成 tier 语义描述而非具体版本 |
| `plugins/spec-driver/templates/spec-driver.config-template.yaml` | 8, 36, 87, 94-105 | 模板注释与默认值示例，写死 `gpt-5.4` | 用户 scaffold 出来的项目会直接沿用过期版本 |
| `.codex/skills/*/SKILL.md`、`plugins/spec-driver/skills/*/SKILL.md`、`plugins/spec-driver/skills-codex/*/SKILL.md`（implement/story/resume 三个 skill，共 6 处） | 各自 330-693 行附近 | 「Codex 下默认将 opus/sonnet/haiku 映射到 `gpt-5.4`」 | 与 `src/core/model-selection.ts` 的 `DEFAULT_CODEX_MODEL` 常量同源但已漂移，这些正文说明需要随 Q4 改造同步更新（或改写为不含具体版本号的 tier 描述） |
| `src/core/model-selection.ts` | 11 | `const DEFAULT_CODEX_MODEL = 'gpt-5.4';` | **这是本次调研发现的关键漂移实锤**：代码内建默认值仍是 `gpt-5.4`，而仓库自己的评测凭据策略（`CLAUDE.md`/`AGENTS.md`）已经在用 `gpt-5.6-sol` 作为 driver 型号，本机 Codex CLI 也已 pin 到 `gpt-5.6-sol`。**代码常量落后于实际实践至少两个版本**，是「静态文案会腐坏」这一问题在生产代码里的直接证据，为本次改造提供了最有说服力的动因。 |

### 4.2 合法保留（tier 映射表本身 / 测试 fixture / 历史记录 / 评测凭据表）

| 文件 | 说明 |
|------|------|
| `src/core/model-selection.ts` 的 `LOGICAL_CODEX_MODEL_MAP` / `DEFAULT_CODEX_ALIASES` / `DEFAULT_CLAUDE_ALIASES` | 这些**就是** tier→具体模型的映射表本身，保留具体模型字面量是其职责所在，不应清除，只需保证常量值不再漂移（或改造为「不写死则透传给 CLI」） |
| `spec-driver.config.yaml`（仓库自身运行时配置） | 用户为自己项目显式配置的 `model_compat.aliases.codex` 段，写 `gpt-5.6-sol` 是正常的项目级覆盖用法，不属于需要清理的宣称性文案 |
| `tests/unit/model-selection.test.ts` / `llm-client.test.ts` / `llm-client-token-extraction.test.ts` / `codex-proxy.test.ts` | 测试 fixture 断言具体模型字符串是测试稳定性所需，合法保留（但若 Q4 方案改为「省略 model 时不传 flag」，这些测试需要新增对应用例，而非删除现有用例） |
| `CHANGELOG.md`、`specs/133-*/`、`specs/162-*/`、`specs/212-*/`、`specs/237-*/` 等历史 spec/plan/report | 历史记录性质，记录当时决策所用的具体模型，不应回改 |
| `CLAUDE.md` / `AGENTS.md` / `docs/shared/agent-eval-credentials-policy.md` 的评测凭据表 | 这是**当前**评测轨道的 canonical 记录（`codex:gpt-5.6-sol`），属于需要人工维护的活文档，不在本 Feature 清理范围内，且本身与 model-selection.ts 里的 `DEFAULT_CODEX_MODEL` 是两条不同轨道（评测 driver 选型 vs. skill 执行期模型兼容），不要混淆合并 |

### 4.3 `model-selection.ts` 当前解析链路（源码阅读结论）

- `resolveReverseSpecModel()` 优先级：`env REVERSE_SPEC_MODEL` > `spec-driver.config.yaml` 里 `agents.{agentId}.model` > `preset` 默认（`PRESET_MODEL_MAP`）> 内建 `DEFAULT_CODEX_MODEL` / `DEFAULT_CLAUDE_MODEL`。这与 wrapper 文案里描述的 `--preset -> agents.{agent_id}.model -> preset 默认` 优先级基本一致（注意 wrapper 文案顺序与实际代码顺序不完全对应：代码是 env > agent > preset，wrapper 文案里未提 env 这一层，属于文案本身的信息缺口）。
- `DEFAULT_CODEX_MODEL`（`gpt-5.4`）在整条链路里承担三重角色：(1) `LOGICAL_CODEX_MODEL_MAP` 里 opus/sonnet/haiku 三个 tier 全部指向它（Codex 侧目前没有真正的 tier 区分，全部塌缩成一个模型 + `codex_thinking` 思考等级）；(2) `DEFAULT_CODEX_ALIASES` 里作为多个历史 Claude 模型 ID 的兜底映射目标；(3) `resolveReverseSpecModel()` 无 config 文件时的最终 fallback。三处引用同一个常量，一旦改造成「不写死」，三处都要联动设计。

## 5. Q4 — 可行性风险

### 5.1 破坏性影响面（`grep` 结果，源码内 3 个真实调用点）

| 调用点 | 用途 | 若 `model` 允许为 `undefined`/省略的影响 |
|--------|------|----------------------------------------|
| `src/auth/codex-proxy.ts:58` `getDefaultCodexCLIProxyConfig()` | 读 `resolved.model` 塞进 `CodexCLIProxyConfig.model`，随后（同文件 `callLLMviaCodex`）大概率作为 `-m <model>` 传给真实 `codex` 子进程命令行（需在有 Bash 权限时核实具体 spawn 参数拼接逻辑，本次未展开读取 `callLLMviaCodex` 全文） | **这是唯一真正调用 Codex CLI 子进程的路径**，如果要实现「省略则不传 `-m`，让 CLI 自行决定」，必须在这里改造成「`model` 为 `undefined` 时不拼接 `-m` flag」，而不是简单把类型改成 `string \| undefined` 就完事——调用方（`callLLMviaCodex`）的 flag 拼接逻辑需要联动修改 |
| `src/core/llm-client.ts:263` | runtime 判定为 codex 时调 `resolveCodexExecutionConfig()` 取模型，供上层 LLM 调用统一接口使用 | 同上风险，且 `llm-client.ts` 是更上层的抽象，可能有额外的 model 相关业务逻辑（如按模型选择 prompt 模板/超时策略），改造前需要通读该文件确认 |
| `src/batch/batch-orchestrator.ts:631` | 调 `getCanonicalSonnetModelId(detectedRuntime)` 取「sonnet 等价」的真实模型 ID，用于强制降级到 sonnet 等价档位（小模块/预算控制场景，见函数注释里提到的 Fix 134 教训） | 这个函数的设计初衷就是**必须返回一个具体可用的模型 ID**（不能是 undefined），因为它服务于"强制降级"语义——如果 Codex 侧改造成"不指定模型交给 CLI 决定"，这里就无法再表达"强制用性价比更低的档位"这个意图，除非 Codex CLI 本身提供等价的 tier/profile 机制（存在 `[agents.<role>]` 角色配置的可能性，但未验证） |

**结论**：`resolveCodexExecutionConfig(): ResolvedCodexExecutionConfig`（`model: string` 必填）与 `getCanonicalSonnetModelId(): string`（必填返回）这两个函数签名如果改成允许省略/`undefined`，是**破坏性 API 变更**，至少 3 个调用点、其中 `codex-proxy.ts` 直接决定了真实 CLI 子进程的调用方式，风险不小。更稳妥的路径是**不改变这两个函数的返回类型契约**，而是新增一层「wrapper 文案 capability 描述」与「实际驱动 CLI 调用的 model 解析逻辑」解耦：
- wrapper 静态文案层：可以放心地把"归一化到具体版本号"的描述改写为 tier 语义 + 能力探测结果描述，不涉及运行时行为，零 API 风险。
- `resolveCodexExecutionConfig()` 内部实现：`DEFAULT_CODEX_MODEL` 常量本身可以从"硬编码具体版本"改为"运行时惰性探测 `~/.codex/config.toml` 的 `model` 字段作为 fallback"，但函数签名维持 `model: string` 不变（有值就有值，实在探测不到才退回一个兜底常量），这样能吸收"版本漂移"问题而不引入破坏性变更。

### 5.2 capability 探测放在哪一层最合适

| 方案 | 描述 | 可测试性 | 优劣 |
|------|------|---------|------|
| A. wrapper 静态文案层（`codex-skills.sh` 生成时嵌入固定描述） | 现状。生成时不做任何运行时探测，纯文本描述 | 高（纯字符串比对） | 简单但会像 `DEFAULT_CODEX_MODEL` 一样随版本漂移而腐坏，正是本次要解决的问题 |
| B. CLI 脚本层（`codex-skills.sh` install 时读取本机 `~/.codex/config.toml`，把探测结果**固化**进生成的 SKILL.md 文案） | install 时一次性探测，写死到生成产物里 | 中（需要 bash 单测覆盖 config.toml 有/无 `multi_agent` 字段两种 fixture） | 优点是运行期零开销（wrapper 文案已经是探测结果）；缺点是**用户后续开关 `multi_agent` 或升级 CLI 后，wrapper 文案不会自动更新**，除非重新执行 install/`repo:sync`——这与当前项目"install 时同步一次"的既有模式一致（`sync-delegation-contract.mjs` 已经是类似模式），可接受 |
| C. 运行时 lib 层（新增 `src/core/codex-capability.ts`，在 skill 执行期动态探测并输出到日志/上下文，而非固化进静态 Markdown） | 每次执行 skill 时动态判定 | 低（涉及子进程/文件 IO，单测需要 mock 文件系统，且"探测时机"与"实际 Task 调用时机"可能不一致） | 更贴近"运行时能力探测"字面含义，但复杂度和不确定性显著更高，且 SKILL.md 是静态 Markdown 文本，无法在 Codex 会话内动态改写自身内容——只能在文案里加一句"执行前请自行确认 `~/.codex/config.toml` 的 `features.multi_agent`"这类引导性文字，而不能做到真正的运行时条件分支 |

**建议**：方案 B（install-time 探测 + 固化文案）在"可测试性"与"解决实际问题（版本漂移）"之间性价比最高，且延续了 `codex-skills.sh` 现有的"生成时同步"设计惯例；方案 C 留作 M10+ 的可选增强（如果未来 Codex 提供了运行时自省 API）。方案 A（维持现状）不解决问题。

## 6. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | 本次调研未能实际执行 `codex --help` 等命令核实 CLI flag 层面的子代理能力信号，仅凭本机 config.toml 字段 + 三方博客交叉验证 | 中 | 中 | plan/implement 阶段在有 Bash 权限的环境下补跑只读 `--help`/`--version` 命令，作为二次验证；不应仅凭本次报告的间接证据就固化判定逻辑 |
| 2 | `multi_agent` 是 opt-in 实验特性，绝大多数用户环境可能未开启，探测出来的"能力存在"覆盖面可能很窄，文案改造收益有限 | 中 | 低 | wrapper 文案应以"未开启/未探测到 → 降级为内联执行"为默认分支，保证向后兼容；不要假设该特性已普及 |
| 3 | `DEFAULT_CODEX_MODEL` 常量改造若涉及运行时读取 `~/.codex/config.toml`，需要处理文件不存在/解析失败/字段类型非法等边界，否则会把"静态但稳定"的现状换成"动态但脆弱"的新问题 | 中 | 高 | 复用 `model-selection.ts` 里已有的 `loadDriverConfig`/`parseSimpleYaml` 容错模式（`try/catch` 返回 `null`），新逻辑必须同样优雅降级到现有硬编码兜底值，不能让读取失败导致 CLI 调用崩溃 |
| 4 | 6 处 skill body（implement/story/resume × plugin 源 + `.codex/skills` 镜像 + `skills-codex` 镜像）目前是从 canonical `skills/*/SKILL.md` 生成/同步的，若只改一处会导致三份产物不一致，触发 `repo:check` 报警 | 高 | 中 | 严格遵循仓库既有的 canonical → wrapper 同步链路（`npm run repo:sync`），不要手工分别改三份产物 |
| 5 | `getCanonicalSonnetModelId()` 语义（强制降级到"sonnet 等价"档位）与"把模型选择交还 CLI"的设计目标存在张力，若不细化就直接合并两个概念，可能破坏 Fix 134 修复的"小模块强制 sonnet"意图 | 中 | 高 | Q4 已给出结论：不改函数签名契约，只改内部 fallback 常量的来源；"强制降级"场景应继续走显式 alias 映射，不参与"省略则交给 CLI"的新分支 |

## 7. 产品/需求-技术对齐度

### 覆盖评估

| 需求点 | 技术方案覆盖 | 说明 |
|--------|-------------|------|
| 子代理执行文案升级为运行时能力探测 | ⚠️ 部分覆盖 | config.toml `features.multi_agent` 字段是可行信号源，但 CLI flag 层面证据缺失（风险 1），且探测时机建议放在 install-time（方案 B）而非真运行时 |
| 模型兼容文案升级为 runtime-neutral quality tier | ✅ 完全覆盖（文案层） / ⚠️ 部分覆盖（代码层） | wrapper 静态文案可以零风险改写为 tier 语义描述；但如果需求也期望 `model-selection.ts` 代码层同步"不写死版本"，则涉及破坏性 API 评估（§5.1），需要 plan 阶段明确这次改造的边界是"仅文案"还是"文案+代码" |

### Constitution 约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| 尊重仓库现有 `ProjectContext`/`GeneratorRegistry` 等既有抽象，不新建平行体系 | ✅ 兼容 | 本次调研未发现需要新建平行注册表/解析器的必要性，方案 B（复用 `codex-skills.sh` 的 install-time 同步模式）与现有架构一致 |
| `.specify/orchestration-overrides.yaml` 承载流程结构覆盖，不应把能力探测逻辑错放进 `spec-driver.config.yaml` | ✅ 兼容 | capability 探测属于"运行时环境事实"而非"流程结构覆盖"，理应放在 CLI 脚本/lib 层，不应写入 orchestration-overrides.yaml |

## 8. 结论与建议

### 总结

1. **Q1 子代理能力**：本机实测证据（`~/.codex/config.toml` 的 `features.multi_agent = true`）+ 公开资料交叉验证，确认该字段是当前唯一可机械判定的信号；但该字段是 opt-in 实验特性，探测逻辑必须以"未探测到 → 降级为内联执行"为安全默认。CLI flag 层面的补充证据本次未能核实，留待 plan/implement 阶段用 Bash 权限补测。
2. **Q2 默认模型行为**：技术上成立——不传 `-m`/`--model` 时 Codex CLI 会走 `~/.codex/config.toml` 的 `model` 字段 → CLI 内建默认的解析链路。本机实测 `model = "gpt-5.6-sol"` 与仓库评测凭据记忆条目一致，互相印证。
3. **Q3 现状盘点**：发现关键漂移实锤——`src/core/model-selection.ts:11` 的 `DEFAULT_CODEX_MODEL = 'gpt-5.4'` 已落后于仓库实际实践（评测轨道用 `gpt-5.6-sol`，本机 CLI 也 pin 到该版本），加上 6+ 处 skill body / README / 配置模板同样写死 `gpt-5.4`，这正是"静态文案会腐坏"问题的第一手证据。
4. **Q4 可行性**：`resolveCodexExecutionConfig()` / `getCanonicalSonnetModelId()` 的函数签名不宜改为允许省略返回值——3 个调用点中 `codex-proxy.ts` 直接决定真实 CLI 子进程调用参数，破坏性风险集中在这里。建议保持 API 契约不变，只把内部"兜底常量来源"从硬编码改为"惰性读取本机 config.toml + 硬编码作最终兜底"。capability 探测建议放在 `codex-skills.sh` 的 install-time（方案 B），复用现有"生成时同步"惯例，而非放进运行时 lib 做动态探测（方案 C 复杂度/不确定性显著更高）。

### 对 spec/plan 的建议

1. **明确本次改造边界**：是"仅升级 wrapper 静态文案的表述方式"（零 API 风险，工作量小），还是"连带修复 `DEFAULT_CODEX_MODEL` 硬编码漂移问题"（涉及运行时读取 config.toml，需要容错设计）。建议 spec 阶段把这两件事拆成可以独立验收的 FR，不要合并成一条模糊的"升级为动态探测"。
2. **子代理能力信号的判定逻辑优先用「install-time 静态探测 + 固化文案」（方案 B）**，不要做成运行时动态探测（方案 C）；后者在"SKILL.md 是静态 Markdown、无法运行时条件渲染"的约束下技术上不成立。
3. **`getCanonicalSonnetModelId()` 的"强制降级"语义与"模型选择交还 CLI"的新语义要在 spec 里明确分开**，不要用同一套 tier 概念覆盖两种不同意图（强制指定 vs. 交给运行时自行决定），否则会重蹈 Fix 134 描述的"sonnetModelId 实际是 opus"式 bug。
4. **Q1 的 CLI flag 层面证据缺口需要在 plan/implement 阶段用 Bash 权限补测**（`codex --help` / `codex exec --help` / `codex mcp --help`），本次 tech-research 的判定基于 config.toml 字段 + 第三方资料，建议标注为"待实测复核"而非直接采信为定论。
5. **`gpt-5.4` 字面量清理属于独立的小范围文档/模板修复**，可以作为本 Feature 的一个子任务（更新 README/docs/config-template/skill body 六处），但**不要**把它和"能力探测/quality tier"的核心改造混在同一个 commit 里，便于分别回滚与审查。

---

## 附：工具使用反馈（Dogfooding，按项目约定必附）

- 本次任务未使用 Spectra MCP 工具（探索的是仓外的 Codex CLI 配置文件与第三方公开资料，非本仓库代码结构，Spectra 的 impact/context/graph_query 工具不适用于此类"外部工具能力调研"场景）。
- 本次任务发现子代理工具集缺少 Bash 权限（仅有 Read/Write/WebSearch/WebFetch/Grep/Glob），导致 Q1/Q2 要求的"实际执行 codex --help 等只读命令"无法完成，只能退化为读本机配置文件 + WebSearch 交叉验证。如果 tech-research 子代理未来需要常态化承担"探测本机 CLI 能力"类调研任务，建议补上 Bash 工具权限（哪怕是只读白名单）。

---

## 附 2：编排器补测（一手 CLI 证据，2026-08-02，Bash 只读）

（注：本节由主编排器在 research 子代理完成后追加；首次追加因子代理终稿覆盖丢失，此为重放。）

### 补测 1 — `codex --version` / 子命令面
- `codex-cli 0.144.6`（homebrew，`/opt/homebrew/bin/codex`）
- 顶层子命令含 `features`（"Inspect feature flags"）——官方能力自省入口

### 补测 2 — `codex features list`（关键修正）
```
multi_agent                          stable             true
multi_agent_mode                     removed            false
multi_agent_v2                       under development  false
enable_fanout                        under development  false
```
- 输出三列：feature 名 / stage / **effective state**（CLI 解析 config.toml + 内建默认后的生效值）
- **修正上文 Q1 判定**：`multi_agent` 在 0.144.6 已是 **stable**（非 opt-in 实验特性）；本机 effective `true`
- capability 探测的权威信号应是 `codex features list` 的 effective state 列，而非手工 parse `~/.codex/config.toml`
- 探测「不可用」的可靠证据：(a) `codex` binary 不存在；(b) 输出无 `multi_agent` 行；(c) 该行 effective 非 `true`；(d) 命令非零退出/超时
- **诚实边界**：`multi_agent effective=true` 证明 feature flag 开启，不等于已验证 native dispatch 真实发生——文案措辞应为「检测到 multi_agent 已启用」而非「原生并行已验证可用」

### 补测 3 — `codex exec --help`（Q2 一手确认）
- `-m, --model <MODEL>` 为**可选**参数；不传时按 config 分层解析（`-c` override > profile > `~/.codex/config.toml` `model` > 内建默认）
- 本机 `~/.codex/config.toml:1` = `model = "gpt-5.6-sol"`
- 结论：「未显式 pin 时省略 `--model`、交还 Codex CLI」技术路径一手确认成立

### 实测性能
`codex features list` 为纯本地只读操作（不触发推理、不耗配额），实测 <1s 返回。
