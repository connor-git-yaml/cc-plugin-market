---
feature: 238-codex-wrapper-completeness
title: Spec Driver Codex Wrapper 完整性（M9 轨道 A2）
status: draft
created: 2026-08-02
milestone: milestone-M9-codex-trusted-live-graph.md §3 A2
research: research/tech-research.md
inputs:
  - contracts/codex-plugin-consistency.yaml
  - plugins/spec-driver/contracts/wrapper-source-of-truth.yaml
  - plugins/spec-driver/scripts/codex-skills.sh
---

# Spec: Spec Driver Codex Wrapper 完整性

## Summary

M9 轨道 A2 要求把 Spec Driver 的 Codex 适配从"能用但不完整、文案会过期"升级为"9/9 canonical skill 全覆盖、能力探测可审计、模型版本不再散落硬编码"。本 Feature 独立可验收地交付三件事：(1) 补齐 `spec-driver-refactor` 的 Codex wrapper 并移除 F213 遗留的 waiver；(2) 把"缺 Task tool 则内联/串行"的静态兼容文案升级为 install-time capability 探测——但探测结果与降级审计只写入本地 gitignored 的 sidecar 文件，tracked 的 wrapper 三份产物（`.codex/skills/`、`plugins/spec-driver/skills-codex/`、经 `extract-wrapper-body.mjs` 处理后的正文）永远保持 capability-neutral，不按探测结果分支生成不同文案；(3) 把模型兼容描述改为 runtime-neutral quality tier，清理散落的具体模型版本字面量，并在代码层为"未显式 pin 时省略 `--model` 交还 Codex CLI"提供受限、可回退、语义诚实（delegated 标识不冒充实际执行模型）的实现路径。

## Scope

### In scope

- `plugins/spec-driver/scripts/codex-skills.sh`：新增 `spec-driver-refactor` wrapper 生成、install-time capability 探测（写入 sidecar）、模型兼容文案改写
- `plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs`：`rewriteCodexRuntimeText()` 的正文替换文本同步改为 capability-neutral 指针文案，与 `codex-skills.sh` 生成端逐字节一致
- `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml`：新增第 9 条 entry
- `contracts/codex-plugin-consistency.yaml`：移除 `spec-driver-refactor-codex-wrapper-gap` waiver
- `tests/integration/spec-driver-codex-skills.test.ts` 及一致性矩阵相关测试：断言从 8 更新到 9，新增 sidecar 生成 / capability-neutral 文案 / 模型文案的用例
- `.gitignore`：新增 `.codex/spec-driver-capability.md` 条目
- 文档/模板层模型版本字面量清理：`README.md`（根）、`plugins/spec-driver/README.md`、`docs/configuration.md`、`plugins/spec-driver/templates/spec-driver.config-template.yaml`、6 处 skill body（implement/story/resume × canonical + `.codex/skills` 镜像 + `skills-codex` 镜像）
- 代码层：`src/core/model-selection.ts` 的 `DEFAULT_CODEX_MODEL` 常量来源、`src/auth/codex-proxy.ts` 的 `-m/--model` flag 拼接逻辑（含 `modelFlagMode`/`modelSource` 决策）、`ResolvedCodexExecutionConfig` 新增字段、delegated 语义的日志/超时诚实化，仅限"未显式 pin 时省略 flag"这一条受限路径
- 新增可脚本化的模型字面量 grep 门禁（接入 `repo:check` 或独立脚本），门禁脚本自身独立成文件，不落在自身扫描面内

### Out of scope（明确不做，发现问题记 follow-up）

- **A3 Codex hooks 合同**（`WorktreeCreate/WorktreeRemove` 适配、`apply_patch`/Edit/Write payload E2E、Stop compliance 事实源）— 不在本 Feature 触碰
- **A4 CODEX_HOME 与 runtime 位置一致性诊断** — 不在本 Feature 触碰
- **M10 候选**：Wiki 消费面、GraphRAG/symbol semantic retrieval、KB 分级刷新、把 capability 结果写回 tracked wrapper 正文（曾评估的方案，已废弃，见「架构决策」）— 均延后
- **方案 C（运行时动态 capability 探测）** — 明确排除，理由：SKILL.md 是静态 Markdown，无法在 Codex 会话内条件渲染
- `getCanonicalSonnetModelId()` 的"强制降级到 sonnet 等价档位"语义（Fix 134 教训）不参与"交还 CLI"新分支，维持现状不改
- Spectra 插件侧的 Codex 适配（A1，F213 范围）不重复处理

## 架构决策：capability 探测结果只落 sidecar，不落 tracked wrapper 正文

初版设计曾计划把探测结果（native / degraded）直接固化进 `.codex/skills/*/SKILL.md` 等三份 tracked 产物的正文，按结果分支生成不同文案。该设计已在 Codex 对抗审查中被否决，原因：

1. **矛盾风险**：`extract-wrapper-body.mjs`（JS 校验端）与 `codex-skills.sh`（shell 生成端）各自维护一份正文替换文本，若二者对同一处"子代理执行"描述采用不同分支逻辑或不同措辞，会产生 adapter 头部审计行与正文散文矛盾的产物（原审查 Critical 1）。
2. **分发污染**：`plugins/spec-driver/skills-codex/` 是 tracked 分发目录，会被 npm 打包分发给所有插件用户；若其中含维护者本机（或 CI 构建机）的探测结果，等同把"维护者机器的 capability"当成"所有用户机器的 capability"分发出去，对绝大多数用户是错误信息（原审查 Critical 2）。

**现方案**：wrapper 三份产物永远 capability-neutral，只含一句静态指针文案；探测结果、降级原因、时间戳、CLI 版本这些"随本机环境变化"的信息，只写入本地生成、`.gitignore` 排除的 sidecar 文件 `.codex/spec-driver-capability.md`。此方案让 F186 wrapper body-sha256 门禁与 F213 逐字节双写完全不受影响——sidecar 不参与 sha256 计算、不参与双写比对，不在回归护栏上开洞。

## User Stories

### US-1（P1）：作为使用 Codex 的 Spec Driver 用户，我希望 `spec-driver-refactor` 和其余 8 个 skill 一样有 Codex wrapper，这样我在 Codex 里能调用全部 9 个 canonical skill，而不是意外发现少一个

**验收场景**：
- Given 一个干净的项目仓库，When 执行 `npm run codex:spec-driver:install`，Then `.codex/skills/` 下出现 9 个目录（含 `spec-driver-refactor`），每个都含 frontmatter、Wrapper Source Contract（含合法 SHA256）、Codex Runtime Adapter、与 canonical source 一致的正文
- Given `contracts/codex-plugin-consistency.yaml`，When 运行一致性矩阵检查（`repo:check` 或独立脚本），Then `spec-driver` 的 skillsRoot 下 9/9 wrapper 存在、无 `spec-driver-refactor-codex-wrapper-gap` waiver 残留、无 stale-waiver 告警
- Given 真实本机 codex CLI（0.144.6+），When 在装有该 wrapper 的项目内启动 Codex 会话并请求 `$spec-driver-refactor`，Then Codex 能发现并加载该 skill（E2E 可见可调）

### US-2（P2）：作为使用 Codex 的用户，我希望能知道我本机 Codex 的子代理调度真实能力，而不是被 wrapper 正文里一句写死的"内联执行"误导

**验收场景**：
- Given 本机 `codex features list` 输出 `multi_agent ... stable true`，When 执行 wrapper install，Then 生成的 `.codex/spec-driver-capability.md` 记录 `- Subagent Capability: native`、探测时间戳与 `codex --version` 输出；wrapper 三份产物的正文保持 capability-neutral 静态指针文案不变
- Given 探测环境中 `codex` binary 不存在（PATH 未装 CLI），When 执行 wrapper install，Then sidecar 记录 `- Subagent Capability: degraded(reason=binary-missing)`，install 流程本身不因此失败（继续用 capability-neutral 文案完成 wrapper 生成）
- Given 探测命令超时（模拟 >5s 无响应）、命令非零退出、或 `codex features list` 输出格式不含可解析的 `multi_agent` effective 值，When 执行 wrapper install，Then 分别记录对应 `reason`（`timeout` / `command-failed` / `no-feature-row` / `malformed-effective`），不误判为可用，且 install 不 hard fail

### US-3（P3）：作为维护者，我希望模型兼容说明不再写死具体版本号，这样版本升级（如未来 gpt-5.7）不需要逐处改文档

**验收场景**：
- Given README/文档/模板/skill body 中原先写死 `gpt-5.4` 的位置，When 完成本 Feature 改造，Then 这些位置改为 tier 语义描述（如"Codex 侧统一映射到 `model_compat.aliases.codex` 配置的 tier 值"），不再出现具体版本字面量
- Given 新增的模型字面量 grep 门禁，When 对 FR-310 列举的固定扫描路径清单（豁免清单路径除外）扫描，Then 零命中；Given 有人在非豁免路径引入新的具体模型版本字面量，When 门禁再次运行，Then 命中失败并指出具体文件行
- Given 用户未在 `spec-driver.config.yaml` 显式为某 tier 配置 `model_compat.aliases.codex`（且无 env/直传等其他显式来源，见 FR-304 决策矩阵），When 该 tier 触发真实 `codex` 子进程调用，Then `modelFlagMode='delegate'`，允许省略 `-m/--model` flag，由 Codex CLI 自行按其配置分层解析模型，且日志/`LLMResponse.model` 携带 delegated 标识（不冒充为 CLI 实际执行模型）；Given 用户已显式配置该 tier（或命中决策矩阵中任一 required 来源），When 同样触发调用，Then `modelFlagMode='required'`，必须使用该显式模型（不得被"交还 CLI"逻辑覆盖）

## Functional Requirements

### Group 1 — Wrapper 完整性（US-1）

- **FR-101**（MUST）：`codex-skills.sh` 的 `SKILLS` 数组与 `install_all()`/`remove_all()` 必须新增 `spec-driver-refactor`，生成流程（frontmatter 提取、wrapper-source-contract、codex-adapter、body sha256）与其余 8 个 wrapper 完全一致，不得引入特例分支
- **FR-102**（MUST）：`wrapper-source-of-truth.yaml` 的 `codexWrappers.entries` 必须新增第 9 条，`id: spec-driver-refactor`，`source`/`target` 路径遵循既有命名规约
- **FR-103**（MUST）：`contracts/codex-plugin-consistency.yaml` 的 `waivers` 数组必须移除 `spec-driver-refactor-codex-wrapper-gap` 条目
- **FR-104**（MUST）：一致性矩阵检查（`scripts/lib/codex-plugin-consistency-core.mjs` 消费的校验逻辑）必须在无 waiver 情况下判定 `spec-driver` skillsRoot 为 9/9 完整，且不因缺失该条目触发 stale-waiver 告警之外的其他新告警
- **FR-105**（MUST）：`tests/integration/spec-driver-codex-skills.test.ts` 的 `SPEC_DRIVER_SKILLS` 数组与 `toHaveLength(8)` 断言必须同步更新为 9 项/9
- **FR-106**（MUST）：`--sync-plugin-distribution` 路径（`npm run repo:sync` 消费）必须把新 wrapper 一并复制进 `plugins/spec-driver/skills-codex/`，保持与 `.codex/skills/` 逐字节一致

### Group 2 — Capability 探测与 Sidecar（US-2）

- **FR-201**（MUST）：`codex-skills.sh` 在 install 时必须调用只读命令 `codex features list`（超时上限 5 秒）探测 `multi_agent` 行的 effective state 列，作为唯一权威能力信号；不得回退到手工 parse `~/.codex/config.toml`（该文件拿不到 CLI 内建默认值与 `--enable/--disable`/profile 分层影响）。探测在单次 install 运行内**只执行一次**并缓存结果，供该次运行内所有需要引用探测结果的步骤（wrapper 生成审计、sidecar 写入）复用，不得对每个 skill 重复探测（避免最坏情形 9 次探测叠加耗时与同批漂移）
- **FR-202**（MUST）：探测脚本运行在 `set -euo pipefail` 之下，必须显式捕获 `codex features list` 的非零退出与异常（如命令不存在、超时被 kill），归类为对应 `reason` 走降级分支，不得让探测失败导致 install 脚本整体因 `pipefail` 而中止
- **FR-203**（MUST）：探测判定 reason 枚举扩展为以下七类：`binary-missing`（PATH 无 `codex`）、`command-failed`（命令存在但非零退出）、`unsupported-command`（CLI 版本过旧不识别 `features` 子命令）、`timeout`（超过 5 秒）、`no-feature-row`（输出不含 `multi_agent` 行）、`malformed-effective`（找到行但 effective 列无法解析）、`effective-false`（effective 列明确为 `false`）；判定为 `native` 仅当 `multi_agent` 行存在且 effective 列可解析为 `true`
- **FR-204**（MUST）：wrapper 三份产物（`.codex/skills/*/SKILL.md`、`plugins/spec-driver/skills-codex/*/SKILL.md`、经 `extract-wrapper-body.mjs` 处理后用于 sha256 校验的正文）中"子代理执行"相关描述必须永远是同一句 capability-neutral 静态指针文案，不得按探测结果（native/degraded）分支生成不同措辞。指针文案须表达："子代理执行能力以 install-time 探测记录为准（`.codex/spec-driver-capability.md`）；记录缺失或 degraded 时，正文中的 `Task(...)` / `Task tool` 一律按当前会话内联/串行降级执行"
- **FR-205**（MUST）：`extract-wrapper-body.mjs` 的 `rewriteCodexRuntimeText()` 替换列表中，原第 8 条（`'Claude Code 的 Task tool'` → `'Task tool（Codex 下按内联子代理执行）'`）必须同步改写为与 FR-204 语义一致的 capability-neutral 指针短语（同指 sidecar、同降级语义；句式可因位置不同而异，不要求与 adapter 列表项逐字逐句相同）。注：F186 T2 后 shell 生成端已无独立 `rewrite_codex_runtime_text` 函数，`codex-skills.sh` 直接调用该 Node helper 产出正文——生成产物与 sha256 校验逻辑共用同一实现，改这一处即两端同步，无双实现漂移面
- **FR-206**（MUST）：探测结果与降级原因必须写入 install-time 生成的 sidecar 文件 `.codex/spec-driver-capability.md`（项目根相对路径），含机械可解析行 `- Subagent Capability: native` 或 `- Subagent Capability: degraded(reason=<binary-missing|command-failed|unsupported-command|timeout|no-feature-row|malformed-effective|effective-false>)`、探测时间戳（ISO 8601）、本机 `codex --version` 输出。该文件是本地运行态产物，绝不得出现在任何 tracked 分发路径（`.codex/skills/`、`plugins/spec-driver/skills-codex/`）或 npm 发布包中
- **FR-207**（MUST）：`.gitignore` 必须新增 `.codex/spec-driver-capability.md` 条目，确保该 sidecar 永不被 git 跟踪
- **FR-208**（MUST）：用户后续升级 Codex CLI 或开关 `multi_agent` 特性后，必须重新执行 `install`（或触发 install 的 `repo:sync` 链路）才能刷新 sidecar 内容；因 wrapper 三份产物本身 capability-neutral，无需为此重新生成 wrapper，但仍遵循既有"改 SKILL 正文后先 install 再 sync"操作顺序约定
- **FR-209**（SHOULD）：探测命令的 stdout 解析必须容错命令输出格式的合理变体（如列宽变化、额外空白），只要求能定位到以 `multi_agent` 开头（非 `multi_agent_mode`/`multi_agent_v2`）的行并取其 effective 列

### Group 3 — Runtime-neutral Quality Tier（US-3）

- **FR-301**（MUST）：`write_codex_adapter()` 生成的"模型兼容"文案不得包含具体模型版本字面量，改写为 tier 语义描述（如"Codex 侧模型解析遵循 `model_compat.aliases.codex` tier 映射；未显式 pin 时由 Codex CLI 决定当前默认模型"），措辞须诚实反映"检测到 `multi_agent` 已启用"这类已验证的事实，不得夸大为"原生并行子代理调度已验证可用"一类未经真实 dispatch 验证的表述
- **FR-302**（MUST）：以下面向用户的文档/模板中的具体模型版本字面量必须清理，改写为 tier 语义描述或指向 `model_compat` 配置段：`README.md`（根，约第 182 行 `gpt-5.4` 相关表述）、`plugins/spec-driver/README.md`（约第 196-213 行）、`docs/configuration.md`（约第 34-43、87 行）、`plugins/spec-driver/templates/spec-driver.config-template.yaml`（约第 8、36、87、94-105 行，模板注释与默认值示例）
- **FR-303**（MUST）：6 处 skill body（`plugins/spec-driver/skills/{implement,story,resume}/SKILL.md` 及其在 `.codex/skills/` 与 `plugins/spec-driver/skills-codex/` 的镜像）中"默认将 opus/sonnet/haiku 映射到 gpt-5.4"一类文案必须清理；改动只发生在 canonical `skills/*/SKILL.md`，两处镜像通过既有 `repo:sync` 同步链路更新，不得手工分别改三份产物
- **FR-304**（MUST，风险标注）：`resolveCodexExecutionConfig()` 在 codex runtime 下必须按以下决策矩阵判定 `modelFlagMode`；`ResolvedCodexExecutionConfig` 类型新增 `modelFlagMode: 'required' | 'delegate'` 与 `modelSource: string` 两个字段（新增字段不破坏现有 `model: string` 必填契约，函数签名不变）：

  | 模型来源 | modelFlagMode |
  |---------|--------------|
  | env `REVERSE_SPEC_MODEL` | required |
  | `agents.<id>.model` 显式配置 | required |
  | `model_compat.aliases.codex` 命中 | required |
  | `model_compat.defaults.codex` 配置 | required |
  | 调用方直接传入 `config.model`（llm-client 入参） | required |
  | `getCanonicalSonnetModelId()` 强制降级路径（Fix 134） | required（恒显式，专门单测锁定，见 FR-306） |
  | 仅 preset 逻辑名（balanced 等 → opus/sonnet/haiku）且无上述任何 codex 侧覆盖 | **delegate**（唯一省略 `-m` flag 的情形） |

  `modelFlagMode='required'` 时 `-m/--model` flag 必须携带 `resolved.model`；`modelFlagMode='delegate'` 时 `callLLMviaCodex()` 拼接子进程参数时必须省略该 flag，交由 Codex CLI 自身按其配置分层（`-c` override > profile > `~/.codex/config.toml` `model` 字段 > CLI 内建默认）解析模型。`modelSource` 字段记录命中的具体来源字符串（如 `env:REVERSE_SPEC_MODEL`、`preset:balanced`），供日志与测试断言使用
- **FR-305**（MUST，风险标注，delegated 语义诚实化）：`modelFlagMode='delegate'` 场景下：(a) 日志输出与 `LLMResponse.model` 字段必须携带 delegated 标识（结构化字段，或采用 `delegated:<fallback-hint>` 前缀字符串约定），不得把内部 fallback 常量字符串冒充为 Codex CLI 实际执行的模型；(b) 该场景的超时分档必须采用 provider 级最长（最保守）档位，不得按 fallback 字符串误判为某个具体已知模型对应的窄超时档；(c) spec/文档需明示：delegate 场景下的 `resolved.model` 字符串仅作为超时分档等下游逻辑的 hint，不代表真实执行模型
- **FR-306**（MUST，风险标注）：`getCanonicalSonnetModelId()` 的"强制降级到 sonnet 等价档位"路径（Fix 134 语义）必须继续无条件传递显式 `-m` flag（即恒为 `modelFlagMode='required'`），不得参与 FR-304 的 delegate 分支——两条语义（"强制指定" vs "交还 CLI 自行决定"）必须在代码路径上保持互斥，不共用同一判断分支；必须有专门单测锁定该不变量（对应 SC-007）
- **FR-307**（MUST）：`getTimeoutForModel()` 等按模型名分档的下游逻辑，在 `modelFlagMode='delegate'` 场景下必须按 FR-305(b) 采用保守（最长）超时档；`modelSource` 字段须可用于日志/调试区分该次调用的模型来源，不得因该字符串来自内部 fallback 常量（见 FR-308）而误判为具体已知模型走窄超时档
- **FR-308**（SHOULD）：`DEFAULT_CODEX_MODEL` 常量的兜底值来源可选地从硬编码字面量改为"惰性读取本机 `~/.codex/config.toml` 的 `model` 字段，读取失败时退回现有硬编码兜底值"，复用 `model-selection.ts` 已有的 `try/catch` 容错模式；此项为 SHOULD（非 MUST），因为它不是"消除散落字面量"的必要条件——`LOGICAL_CODEX_MODEL_MAP`/`DEFAULT_CODEX_ALIASES` 本身作为 tier 映射单点，保留具体值是合法的（研究结论 §4.2）
- **FR-309**（MUST）：用户在 `spec-driver.config.yaml` 中为某 tier 显式配置 `model_compat.aliases.codex` 时（即当前仓库根 `spec-driver.config.yaml` 已有的 `gpt-5.6-sol` 三条配置），命中 FR-304 决策矩阵的 required 分支，无论 capability 探测结果如何，该显式配置必须原样生效并作为 `-m` flag 传递，不得被 delegate 路径覆盖
- **FR-310**（MUST）：必须新增可脚本化的模型字面量 grep 门禁（集成进 `repo:check` 或提供独立可单跑的脚本），扫描规则见下方「Grep 门禁定义」；命中即视为失败；门禁脚本自身的实现文件独立成文，不落在其自身扫描路径清单内（防止 pattern 定义或豁免注释字符串把自身误判为命中）

### Grep 门禁定义（FR-310 的可执行规范）

- **匹配 pattern**：`gpt-5(\.\d+)?(-[a-z0-9]+)*(?![0-9a-zA-Z])`（或按实现语言的等价写法），大小写不敏感；右边界断言（negative lookahead）防止误报 `gpt-50`、`gpt-5x` 一类非目标字面量；匹配对象举例：`gpt-5.4`、`gpt-5.6-sol`、`gpt-5-mini`、`gpt-5.3-codex`
- **必须扫描（命中即失败）的路径**（固定清单，即"指定用户表面扫描"，非全仓扫描）：
  - `README.md`（仓库根）
  - `plugins/spec-driver/README.md`
  - `docs/configuration.md`
  - `plugins/spec-driver/templates/spec-driver.config-template.yaml`
  - `plugins/spec-driver/skills/**/SKILL.md`
  - `plugins/spec-driver/skills-codex/**/SKILL.md`
  - `.codex/skills/**/SKILL.md`（若存在于当前工作树）
  - `plugins/spec-driver/scripts/codex-skills.sh`

  该清单即 FR-310 的扫描面全集，不扩展到 `src/core/llm-client.ts`、`src/batch/batch-orchestrator.ts`、eval 脚本等实现/评测代码——A2 用户验收原文即"README/模板/skill body 零散落"，扫描面按此收敛，避免把无关模块卷入清理范围
- **豁免清单（合法保留，不受门禁约束）**：
  - `src/core/model-selection.ts`（`LOGICAL_CODEX_MODEL_MAP`/`DEFAULT_CODEX_ALIASES`/`DEFAULT_CLAUDE_ALIASES`/`DEFAULT_CODEX_MODEL` 常量定义处——tier 映射表本身的职责所在）
  - `spec-driver.config.yaml`（仓库根，运行时配置，`model_compat.aliases` 段是用户显式覆盖，属正常用法）
  - `tests/**`（fixture 断言需要具体模型字符串）
  - `CHANGELOG.md`
  - `specs/**`（历史 spec/plan/report 记录性质，不回改）
  - `CLAUDE.md`、`AGENTS.md`、`docs/shared/agent-eval-credentials-policy.md`（评测凭据表，与本 Feature 是不同轨道，不混淆合并）
  - 本 spec 文件自身（`specs/238-codex-wrapper-completeness/**`，含 research 制品）
  - 门禁脚本自身的实现文件（其 pattern 字面量与豁免路径字符串本身可能含 `gpt-5` 子串，若纳入自身扫描面会自匹配误报）
- **豁免粒度**：MVP 阶段豁免以文件为最小单位（整份文件豁免或不豁免）；更细粒度（如豁免文件内特定行/代码块）留作 follow-up，不在本 Feature 范围内实现

## Edge Cases

| # | 场景 | 期望行为 | 关联 FR |
|---|------|---------|---------|
| E1 | 执行 install 的环境未安装 `codex` binary（PATH 找不到） | FR-201 探测判定为 `binary-missing`，走 FR-206 降级记录，wrapper 正文仍为 capability-neutral 文案（FR-204），install 整体成功完成（不因缺 CLI 而 hard fail） | FR-201/204/206 |
| E2 | `codex features list` 命令存在但因未知原因挂起 >5s，或非零退出 | 分别视为 `timeout` / `command-failed`，写入 sidecar，不得无限期阻塞 install 流程，脚本 `pipefail` 下不得因此中止（FR-202） | FR-202/203/206 |
| E3 | `codex features list` 输出格式变化（未来版本改列宽/加字段/改行序） | 只要能定位到以 `multi_agent` 开头的行并取到某一列作为 effective state，即可容错解析（FR-209）；完全解析不出时按 `no-feature-row` 处理，effective 列存在但无法解析时按 `malformed-effective` 处理 | FR-203/209 |
| E4 | 用户修改了 canonical `spec-driver-refactor/SKILL.md` 正文后未重新 install | wrapper 的 Source SHA256 与重算值不匹配，`validate-wrapper-sources.mjs` 必须能检出漂移（复用 F186 既有机制，非本 Feature 新增逻辑，但新 wrapper 必须纳入该检查范围） | FR-101/104 |
| E5 | 用户在 `spec-driver.config.yaml` 显式 pin 了某 tier 的模型（如 `codex.opus: gpt-5.6-sol`） | 命中 FR-304 决策矩阵 required 分支，delegate 逻辑绝不能覆盖该显式值；该 tier 调用真实子进程时必须携带对应 `-m` flag | FR-304/309 |
| E6 | Claude 运行时读取到新增的 `model_compat`/capability 相关配置字段、sidecar 文件或生成产物变化 | 必须零行为影响——Claude 侧 9 个 canonical skill 的执行路径不读取 Codex wrapper 产物，也不读取 `.codex/spec-driver-capability.md`，不依赖 `codex features list` 探测结果 | 非负目标（见 Non-negotiable Constraints） |
| E7 | `getCanonicalSonnetModelId()` 强制降级路径在 FR-304 落地后被误接入 delegate 分支 | 视为回归 bug（对应 Fix 134 教训重演），必须有专门单测锁定"强制降级路径恒 `modelFlagMode='required'`"这一不变量 | FR-306 |
| E8 | `--sync-plugin-distribution` 同步时 `.codex/skills/` 尚未重新 install 过（旧产物） | 因 wrapper 三份产物本身 capability-neutral（FR-204），sync 复制的新旧产物在"子代理执行"文案上不存在漂移问题；唯一需要 sync 前 install 的场景是 sidecar 内容刷新（FR-208），但 sidecar 本身不参与 sync（gitignored，见 FR-207），故此 Edge Case 相对原设计已显著收窄——tracked 分发物永不因跳过 install 而出现 capability 文案不一致 | FR-204/207/208 |

## Non-functional & Constraints（回归护栏，Non-negotiable）

- **F186 wrapper body-sha256 门禁必须全程绿**：新增的 `spec-driver-refactor` wrapper 与已改写的 8 个 wrapper 文案，都必须能通过 `validate-wrapper-sources.mjs` 的 sha256 重算比对；sidecar 文件不参与 sha256 计算
- **F213 双写链必须全程绿**：`.codex/skills/`（生成目标）与 `plugins/spec-driver/skills-codex/`（tracked 分发目录）必须逐字节一致；改动只落 canonical `skills/*/SKILL.md` 与生成脚本，不得手工分别改三份产物
- **`codex-plugin-consistency.yaml` 一致性矩阵必须全程绿**：包括 skillsRoot 完整性、waiver 审计（陈旧 waiver 告警）、`spectra-skill-neutrality` 等既有 warn check 均不得回归
- **改 SKILL 后必须重跑 `repo:sync` 重生 wrapper**：任何 canonical skill 正文改动，验证前必须先跑生成链路，不得靠手改生成产物"造绿"
- **Claude 侧 9 个 canonical skill（8 个 execution mode + constitution）行为零变化**：本 Feature 是 M9 非目标里明确排除的"因 Codex 适配削弱 Claude"——`plugins/spec-driver/skills/*/SKILL.md`（Claude 侧 canonical 正文）除以下允许范围外不得产生任何 diff：**允许的 diff 白名单仅限**"Codex 条件句内的具体版本字面量 → tier/CLI-default 语义表述"这一类文案改动（对应 FR-301/302/303）；Claude alias 优先级、preset 优先级、phase/gate 定义、质量门文字等其余内容必须字节不变。`.claude-plugin/plugin.json`、Claude 侧 agent/hook 行为不得因本 Feature 产生功能性变化
- **范围边界**：不触碰 A3（Codex hooks 合同）/A4（`CODEX_HOME` 与 runtime 一致性诊断）；调研或实施中发现的相关问题记为 follow-up，不得顺手在本 Feature 内扩大范围
- **`specs/src.spec.md` 必须排除出本 Feature 的 commit**（该文件是自动再生产物，属已知噪声源，`git add` 使用显式路径而非 `-A`）
- **TDD 优先**：capability 探测/sidecar 写入分支、grep 门禁、FR-304/305/306 的 `modelFlagMode` 决策与 delegated 语义诚实化逻辑均需先写失败测试，再实现

## Success Criteria

- **SC-001**：`contracts/codex-plugin-consistency.yaml` 无 `spec-driver-refactor-codex-wrapper-gap`（或任何）waiver，一致性检查判定 spec-driver skillsRoot 9/9 完整
- **SC-002**：真实本机 `codex` CLI（0.144.6+）E2E 验证 `spec-driver-refactor` wrapper 可被 Codex **发现并加载**（discovery/load 口径：Codex 能列出该 skill 并按其 frontmatter description 正确响应；不要求真实执行 refactor 工作流——执行级 E2E 属 M10 增强）；验证方式固定为一次最小只读触发（`codex exec --sandbox read-only` + 固定 prompt），保存本次 CLI 版本、执行命令、成功输出作为验收证据；该验证会消耗一次 ChatGPT 订阅推理配额，禁止改用 API-key 付费 fallback 代替
- **SC-003**：capability 探测在真实/模拟场景下均实测通过：(a) `multi_agent` effective=true 环境，sidecar 记录 `Subagent Capability: native`，wrapper 三份产物正文保持 capability-neutral 文案不变；(b) 探测不可用环境（可用 mock/stub 命令模拟），至少覆盖 FR-203 七类 reason 中的 3 类不同 reason，sidecar 各自记录对应 `reason`，wrapper 正文同样保持 capability-neutral 文案不变。措辞验证仅确认 sidecar 记录与静态文案本身，不宣称验证过真实并行 dispatch 行为
- **SC-004**：模型版本字面量 grep 门禁在改造完成后，对 FR-310「Grep 门禁定义」列举的固定扫描路径清单（豁免清单路径除外）扫描结果为零命中；对豁免清单路径内故意保留的字面量不误报
- **SC-005**：`tests/integration/spec-driver-codex-skills.test.ts` 及一致性矩阵相关测试全部更新到 9-skill 口径并通过
- **SC-006**：`npx vitest run` 全量零失败、`npm run build` 类型检查零错误、`npm run repo:check` 与 `npm run release:check` 零失败
- **SC-007**：新增/修改的单测覆盖 FR-304/306 不变量（"仅 preset 无覆盖时 delegate" vs "六类显式来源/强制降级路径恒 required"两条路径互斥），至少各一条正向 + 一条回归防护用例；另需覆盖 FR-305 的 delegated 标识与保守超时档逻辑
- **SC-008**：Claude 侧回归护栏——本 Feature 提交后，`npx vitest run --project unit --project integration`（或等价的全量 unit+integration 分组）零新增失败；对 canonical `plugins/spec-driver/skills/*/SKILL.md` 的 diff 做人工复核，确认仅命中 Non-functional & Constraints 中声明的 diff 白名单（模型版本字面量 → tier 语义表述），无其他内容变化

## Open Questions

- **Q1（已裁决）**：件 3 代码层改造（FR-304/305/306/308）是否纳入本 Feature 的 MVP，还是拆分为独立 follow-up？**裁决**：纳入本 Feature（用户需求原文明确列为 FR），但严格限定边界——不改变现有函数签名契约，不触碰强制降级语义，`DEFAULT_CODEX_MODEL` 惰性读取（FR-308）降级为 SHOULD 而非 MUST，为实现阶段留出"若风险超预期可只做 MUST 部分、SHOULD 部分延后"的余地
- **Q2（已裁决）**：capability 探测超时阈值取多少？**裁决**：5 秒。依据 research 附 2 实测 `codex features list` <1s 返回，5 秒已是足够宽松的安全边际，避免拖慢 install 流程
- **Q3（待 plan 阶段确认，非阻塞）**：`codex features list` 的 stdout 解析用 shell 内建工具（awk/grep）还是复用现有 Node helper（`extract-wrapper-body.mjs` 所在的 `scripts/lib/`）新增一个探测 helper？两者都能满足 FR-201/203/209，倾向于后者以复用现有"shell 生成端 + JS 校验端共用 helper"模式（防双实现漂移），留给 plan 阶段做技术选型，不影响本 spec 的验收标准

## Review Log

本轮基于 Codex 对抗审查结论（5 Critical / 5 Warning / 4 Info）与编排器裁决，逐条采纳如下：

- **C1**（wrapper 头部审计行与正文文案矛盾）→ 采纳：废弃"探测结果固化进 wrapper 文案"设计，wrapper 三份产物改为永远 capability-neutral 静态指针文案（新 FR-204），`extract-wrapper-body.mjs` 同步改写（新 FR-205）
- **C2**（tracked 分发物含维护者机器探测结果污染问题）→ 采纳：探测结果与降级审计改落本地 gitignored sidecar `.codex/spec-driver-capability.md`（新 FR-206/207），不再写入任何 tracked 产物
- **C3**（模型来源判定逻辑不完整）→ 采纳：FR-304 重写为完整决策矩阵（七类来源），`ResolvedCodexExecutionConfig` 新增 `modelFlagMode`/`modelSource` 字段
- **C4**（delegate 语义可能冒充真实执行模型）→ 采纳：新增 FR-305，要求 delegated 标识诚实化（日志/`LLMResponse.model`）与保守超时分档
- **C5**（扫描合同"全仓"表述与验收原文"指定用户表面"不一致）→ 采纳：SC-004 与 US-3 验证口径统一改为 FR-310 固定扫描路径清单，删除"全仓"表述；门禁脚本自身独立成文件且不落自身扫描面
- **W1**（capability 文案措辞过度声明"已验证")→ 采纳：FR-301 与 SC-003 措辞降级为"检测到 `multi_agent` 已启用"，明示不宣称验证过真实 dispatch
- **W2**（探测 9 次重复/最坏情形耗时/reason 枚举不全/`pipefail` 下失败处理未明确）→ 采纳：FR-201 改为单次探测+缓存，FR-202 显式捕获非零退出，FR-203 reason 枚举扩为七类，SC-003 覆盖至少 3 类 reason
- **W3**（grep pattern 缺右边界误报 `gpt-50`/`gpt-5x`；豁免粒度未注明）→ 采纳：pattern 加 negative lookahead 右边界；「Grep 门禁定义」新增豁免粒度说明（文件级为 MVP，行级收紧记 follow-up）
- **W4**（SC-002 E2E 验证方式不具体，成本边界不明）→ 采纳：SC-002 固定为一次最小只读触发 + 保存证据 + 明示消耗订阅配额、禁止 API-key 付费 fallback
- **W5**（"Claude 零变化"约束缺允许 diff 白名单，验证命令不具体）→ 采纳：Non-negotiable Constraints 新增允许 diff 白名单（仅模型版本字面量 → tier 语义表述一类），SC-008 补充具体验证命令与人工复核范围
- **I2**（"9 个 mode"表述不精确，未区分 execution mode 与 constitution）→ 采纳：全文改为"9 个 canonical skill（8 个 execution mode + constitution）"
- **I3**（FR-301 与审计行是否冲突）→ 无需改动：审查已确认不冲突，且审计行现落 sidecar，与 wrapper 正文（FR-301 所指范围）分离，更不存在冲突
- **编排器预检修正**：FR-205 初稿误写"shell 生成端 `rewrite_codex_runtime_text` 与 JS 校验端逐字节相等"——F186 T2 后该 shell 函数已删除，生成端直接调用 `extract-wrapper-body.mjs` 单一 helper，两端天然同源；已修正表述为"改 helper 一处即两端同步"
- **Plan 阶段审查回流（W8）**：SC-002 措辞由"发现并调用"收窄为"发现并加载"（discovery/load 口径）——其固定验收命令本就是只读 discovery prompt，原措辞与验收方式不自洽；执行级 E2E 显式划出为 M10 增强
