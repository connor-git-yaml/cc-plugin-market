---
feature: 240-codex-runtime-closeout
title: Codex Runtime Closeout（M9 轨道 A3 + A4）
status: draft
created: 2026-08-03
revised: 2026-08-03
revision: 3（定向修订：用户决策三 A3③ 改道为"判不了就大声报"、决策四 分批交付；闭合 Codex 对 plan 的审查 C4-plan / C5-plan / W2-plan / W3-plan）
research_basis: specs/240-codex-runtime-closeout/research/tech-research.md
grounding_basis: specs/240-codex-runtime-closeout/_grounding.md
milestone_source: docs/design/milestone-M9-codex-trusted-live-graph.md#A3
---

# Feature 240：Codex Runtime Closeout

## 1. Feature 概述 / 目标

本 feature 落地 M9 里程碑轨道 A 剩余两项（A3 Codex hooks 合同、A4 CODEX_HOME 与四方一致性诊断），完成"轨道 A Codex First-Class"的**实现收口**。

> **措辞边界（闭合 Codex INFO 4）**：本 feature 交付后，轨道 A 的**实现**部分收口；但 **M9 轨道 A 里程碑的最终关闭仍以两项人工验证完成为条件** —— (a) F239 遗留 T039（真实 Codex 桌面客户端下 `.worktreeinclude` / `AGENTS.override.md` 验证，见 §9）；(b) 本 feature 新增的 hook 信任状态迁移人工验证（SC-013）。在这两项完成前，任何文档/commit message **不得**声称"轨道 A 已关闭"，只能声称"轨道 A 实现已收口，剩余两项人工验证挂账中"。

`_grounding.md` §8（本机对 Codex 0.144.6 的隔离 `CODEX_HOME` + 真实 turn 端到端实测，**本 spec 的最高权威事实源**）、`_grounding.md` §9（编排器 GATE_DESIGN 前实读代码的补充发现，**与 §8 同级权威**）与 `research/tech-research.md`（上游 GitHub issue 交叉印证）共同确认：Codex 有一套与 Claude Code 高度同构的 hooks 子系统（事件名、payload 字段、阻断语义均同构），也有独立的 `CODEX_HOME` 环境变量与 `codex doctor` 参照实现；但存在多处与"设想中的合同"不一致的硬事实——Codex 没有 `Edit`/`Write` 工具，文件编辑走 `Bash` 工具（`tool_name="Bash"`，命令字符串里没有结构化路径字段）；hooks 默认不被信任、不执行；事件名大小写错误时静默不报错；Codex 不注入任何 plugin-root 类环境变量；`$CODEX_HOME/hooks.json` 是全局唯一共享文件。本 feature 的目标是：

1. **A3 Codex hooks 合同**：让 `plugins/spec-driver/hooks/hooks.json` 描述的行为在 Codex 下真实、可验证地生效或诚实降级，而不是"配置文件存在但从未真正触发过"。具体包括：事件集合收敛到 Codex 实际支持的子集、四路径（allow/block/failure-degrade/Stop）真实 payload E2E、Stop compliance 判定在无法解析当前 transcript 时**不静默失效而是大声报错**、插件根路径不依赖未注入的环境变量、`hooks.json` 的非破坏性合并写入。
2. **A4 CODEX_HOME 与版本一致性诊断**：所有读取**全局** Codex 路径的代码收敛到同一个 helper 并尊重 `CODEX_HOME`；新增"仓库版本 / 全局 CLI / plugin build / MCP server"四方一致性诊断，**显式暴露漂移或不可判定状态，降低"旧 MCP server 静默服务新 worktree"的静默风险**。

> **目标口径修正（闭合 Codex W3 over-claim）**：本 feature **不能**"杜绝"旧 MCP server 静默服务——FR-008 已正确承认 MCP server 缺版本自省能力时只能落 `indeterminate`。正确表述是：把原本完全不可见的风险转化为**显式可见的 `drift` 或 `indeterminate` 信号**。任何文档、commit message、README 中**禁止**使用"杜绝/彻底解决/完全避免"类措辞描述该能力。

### 1.1 A3 与 A4 的交付关系（用户决策，不可推翻）

- A3 与 A4 **合并在本 feature 内一次立项**，不拆分为两个 feature。依据：用户需求原文即为"A 轨最后两件合一线收口"。
- Codex 对抗审查 W7 建议拆分为两个 feature —— **该建议不采纳**。
- 但**采纳其折中**，并作为本 spec 的硬约束：**A3 与 A4 MUST 拥有各自独立的验收状态与任务批次**。
  - Success Criteria 中 A3 相关 SC 与 A4 相关 SC 分组标注，**禁止**用一侧的完成度代替另一侧；
  - tasks 阶段 MUST 把 A3 批次与 A4 批次分开（可并行，但不得混编为一个批次）；
  - 若交付时一侧未达标，**MUST** 如实标注"A3 达标 / A4 未达标"（或反之），**禁止**以"本 feature 整体完成"笼统结论掩盖单侧缺口。

#### 1.1.1 交付节奏：分批交付（用户决策四，rev3 新增，不可推翻）

本 feature 采用**分批交付**，**不拆分为两个 feature**，但**交付时点与验收状态分离**：

- **第一批：A4 先行**。A4 批次（FR-006 / FR-007 / FR-008 / FR-009 / FR-012 / FR-013 及其 SC）MUST **先完整交付**，并**独立通过全量门禁**（见 SC-023）后即可入 master。
- **第二批：A3 随后追上**。A3 批次（FR-001 ~ FR-005 / FR-011 及其 SC）在**同一分支/同一 feature 目录**下随后交付，**独立验收**、独立跑一次全量门禁。
- **交付报告口径**：第一批交付时，报告 MUST 如实写明"A4 已交付并达标；A3 尚未交付，挂账中"，**禁止**因为二者同属一个 feature 就笼统声称"Feature 240 已完成"。
- 本节不改变 §1.1 的"独立验收状态 + 独立任务批次"约束，只是进一步把**交付时点**也分离开。

## 2. Non-Goals（明确排除项）

- **不碰评测链**：`scripts/eval-*.mjs`、`scripts/pilot-*.sh`、`scripts/baseline-*` 及其注释中出现的 `~/.codex` 引用不在本 feature 改动范围（`tech-research.md` §3.5 已标注"注释，不改"）。
- **不重造 `codex doctor` 已覆盖的 Codex 自身体检**：`codex doctor` 的 18 个 check 覆盖 Codex 自身安装/凭据/config/网络/运行时健康（`_grounding.md` §5.2），本 feature 的四方诊断只管"我方制品之间"的版本漂移，与其零重叠，不新增任何与 `codex doctor` 功能重复的 check。
- **不解析 shell 命令字符串来提取文件路径**：Codex 侧 `PreToolUse`/`PostToolUse` 的 `tool_name` 恒为 `Bash`（`_grounding.md` §8.4），目标路径埋在 `tool_input.command` 里且无结构化字段。本 feature **明令禁止**在 hook 脚本或判定器中解析该命令字符串来提取/校验文件路径——F231（[[project_f231_simple_command_whitelist]]）已实测证伪这条路线：结构白名单等于手写半个 bash 解析器，`X=1 exit`、`'exit'`、`builtin exit`、`readonly`、语法错误命令均可绕过，**不可重蹈**。Codex 下"能拦截具体文件编辑"这一命题不作为本 feature 的交付目标（见 FR-003 的范围收窄）。
- **不自动绕过 hook 信任**：Codex 默认不执行 hooks，需按内容哈希持久化信任（`_grounding.md` §8.3）。本 feature 的安装流程/脚本**不得**写入任何绕过信任的配置、不得调用 `--dangerously-bypass-hook-trust` 作为产品安装路径的一部分（该 flag 官方标注 DANGEROUS，仅允许出现在测试脚本内部）、不得替用户关闭这一安全设计。诊断只能提示，不能替用户执行信任授予。
- **不改 F239 的 graph provenance / 状态文件语义**：`specs/_meta/graph-bootstrap-status.json` 的 schema、`bootstrapSource` 判定规则、freshness 唯一权威合同（F217 `evaluateFreshness`）均不在本 feature 触及范围；A4 的四方诊断与 F239 的 graph freshness 判定是两条独立信号线，不合并、不复用同一状态文件。
- **不解决 MCP server 版本自省能力缺失这一更底层产品缺口**：`tech-research.md` §Q3 已确认 Spectra MCP server 当前不暴露版本自省接口，本 feature 的"MCP server"一方诊断只做"尽力而为"（`ps` 侧面推断 + 明确标注局限性），不新增 MCP server 自省协议，该缺口作为 follow-up 记录（见 §10）。
- **不实现 F238 follow-up FU-1（`DEFAULT_CODEX_MODEL` 惰性读取 `~/.codex/config.toml`）的功能本体**：本 feature 只需让 A4① 的 `CODEX_HOME` helper 接口形状可被 FU-1 后续复用，不在本 feature 内落地 FU-1 本身。
- **不重造改名跟随/复合命令劫持类判定器**：`worktree-lifecycle.sh` 中 `WorktreeCreate`/`WorktreeRemove` 相关代码在 Codex 下保持为 Claude adapter 独有的死代码，不为其设计 Codex 侧等价实现。
- **不推进插件版本 SemVer bump 的正式发布**：版本号变更（若需要）遵循 F238 follow-up FU-4 的既定安排，在发布收口轮统一处理，不在本 feature 内单独 npm publish。
- **不改动仓库内 `.codex/` 目录相关的任何路径拼接逻辑**：仓库内 `.codex/skills/` 是 F238 wrapper 产物目录，与全局 Codex 家目录是**两个语义相反的概念**，本 feature 只收口"以家目录为基"的那一类（见 FR-007 与 `_grounding.md` §9.2）。
- **不为 Stop compliance 判定新增独立于 transcript 的第二事实源**（rev3 新增，用户决策三）：原设想的"以 `.specify/runs/` 记录替代 transcript 作主信号源"已被实测证伪并撤回（理由见 FR-004）。本 feature **不**提供第二事实源，**不**扩展 `record-workflow-run.mjs` 的事件 schema，**不**改动任何 SKILL.md 的 `--run-id` 调用，**不**为 `complianceVerdict` 增设写入方唯一性守卫。

## 3. User Scenarios

### 场景 A：开发者在 Codex CLI 下执行编辑任务，hooks 真实触发

- **Given** 开发者已完成 hooks 信任授予（或使用受控的 CI/自动化路径），Spec Driver 插件的 Codex 侧 hooks 声明已生效
- **When** Codex 通过 `Bash` 工具执行一条改变文件的命令（这是 Codex 当前改文件的唯一真实路径）
- **Then** `PreToolUse`/`PostToolUse` hook 被真实触发，脚本能读到 `tool_input.command` 原始命令字符串与其余标准字段（`cwd`/`session_id`/`turn_id`/`model` 等）；block 场景下 `exit 2` + stderr 的实际效果**以 E2E 实测结论为准**（`_grounding.md` §8.7 明确该路径尚未在真实 turn 中验证，见 FR-003）

### 场景 A'：Codex 运行时下 Stop 判定遇到不认识的 transcript 格式（rev3 新增，用户决策三）

- **Given** 一次 Codex 会话结束，`Stop` hook 被触发，`payload.transcript_path` 指向 Codex 自有 wire format 的 rollout 文件（`{timestamp,type,payload}`，`type ∈ session_meta|event_msg|response_item`，与 Claude transcript 结构完全不同，见 `_grounding.md` §8.5）
- **When** `fix-compliance-judge.mjs` 尝试按 Claude 格式解析该 transcript
- **Then** 判定器**识别出"这不是我能解析的格式"**，并**显式落盘一条 loud 诊断事件**（走既有 `tryAppendFailOpenEvent` 类路径），说明"当前 transcript 格式不可识别，compliance 判定本次未执行"；退出码仍为 `0`（fail-open 语义不变，不新增阻断风险）
- **反例（当前行为，必须被消除）**：判定器经 `runHook` 的 `!result.isFix → return 0`（`fix-compliance-judge.mjs:411`）把该会话**静默判为"非 fix 会话"、零诊断落盘**，导致 Codex 下 compliance 判定长期失效而**无人可知**

### 场景 B：hooks 尚未被信任

- **Given** 一个刚安装插件、从未对 hooks 做过信任授予的 Codex 环境
- **When** 开发者运行 A4③ 的四方一致性诊断
- **Then** 诊断报告中出现一条明确指出"hooks 已声明但未被信任"的 check，附带**经实测验证有效**的 next-step（如何在 Codex 侧完成信任授予），而不是静默地让用户以为 hooks 已生效

### 场景 C：仓库版本、全局 CLI、plugin build、MCP server 四方之一发生漂移

- **Given** 开发者刚升级了仓库依赖，但全局 `spectra` CLI 未同步升级，或某 worktree 里的 Spectra MCP server 仍是旧构建
- **When** 开发者运行四方一致性诊断
- **Then** 诊断输出显式指出哪一方（或多方）与仓库版本不一致，并给出机械可执行的修复建议；任一方读取失败/无法判定时输出 `indeterminate` 而非静默判定为"一致"；输出中**不含任何凭据、原始 config 内容或完整环境变量**

### 场景 D：自定义 `CODEX_HOME`

- **Given** 开发者设置了非默认的 `CODEX_HOME` 环境变量
- **When** auth detector / skill installer（**global 模式**）/ plugin install / plugin uninstall / `codex-skills.sh`（**global 模式**）相关代码路径运行
- **Then** 上述路径均读取该自定义 `CODEX_HOME` 而非硬编码 `~/.codex`；未设置该变量时一致 fallback 到 `~/.codex`
- **同时（负向断言）** skill installer 的 **project 模式**、`codex-skills.sh` 的 **project 模式**、`validate-orchestrator-models.mjs`、`sync-delegation-contract.mjs` 中以仓库根为基的 `.codex/` 路径**行为完全不变**，不受 `CODEX_HOME` 影响

> **场景 D 修订说明（闭合 Codex W5-3）**：原场景 D 列出的"worktree cache"消费者已删除 —— `tech-research.md` §3.5 与 FR-007 均已确认本仓库 worktree cache 机制不拼接全局 `~/.codex` 路径，**当前不存在该代码路径**，把它写成场景消费者属于虚构验收面。该项改为"无需代码改动"的证明项（SC-021）。

## 4. Functional Requirements

> 每条 FR 附必要性标注（YAGNI 检验结果）与来源追溯。修订轮新增/改写的条款额外标注闭合的审查编号（C#/W#/O#；`-plan` 后缀表示来自 Codex 对 plan.md 的审查）。

### A3 — Codex hooks 合同

- **FR-001**（A3①，必须）：`plugins/spec-driver/hooks/hooks.json` 的 Codex 侧声明 MUST 仅使用 Codex 已确证支持的事件子集：`SessionStart` / `PreToolUse` / `PostToolUse` / `Stop`（`_grounding.md` §2、§8.1 已确证 10 事件全集且事件键名须为 **PascalCase**，snake_case 静默失效）。`WorktreeCreate` / `WorktreeRemove` MUST 保留为 Claude adapter 独有，不得作为任何 Codex setup 流程的前提条件。
  - **范围限定（rev3 新增，闭合 C4-plan）**：本约束的作用域是**我方 owned 条目**——即 `command` 中含我方唯一脚本名的那些条目。目标文件 `$CODEX_HOME/hooks.json` 中**第三方条目所使用的事件域不受本约束限制**（用户完全可以有自己的 `PermissionRequest` / `Notification` hook），理由见 FR-011 的非破坏性合并语义。
  - 追溯：milestone A3 point 1；`_grounding.md` §2、§8.2；闭合 **C4-plan**

- **FR-002**（A3①附属，必须，**已按 C5 拆为两层门禁；作用域已按 C4-plan 澄清**）：MUST 新增事件名门禁，且门禁 MUST 分为**语义不同的两层**，二者都必须执行：
  - **schema 层（合法性）**：判定**文件中出现的全部事件键名**（含第三方条目所在的事件）是否属于 `_grounding.md` §2 确证的 **10 个** PascalCase 事件名之一。用途：捕获拼写错误、大小写错误（如 `pre_tool_use`、`PreToolUSE`）。**作用域为整份文件**——非法事件名无论出自谁都是错的。
  - **产品层（范围）**：判定**我方 owned 条目**（按 FR-011.4 的 `command` 脚本名归属锚点识别）所覆盖的事件键名是否属于本 feature 允许的 **4 个**事件（`SessionStart` / `PreToolUse` / `PostToolUse` / `Stop`）。用途：执行 FR-001 的范围约束。**作用域严格限于我方条目**，**MUST NOT** 因文件中存在第三方的合法事件（如 `PermissionRequest`）而判失败——那会与 FR-011 的"保留第三方条目"直接冲突（闭合 **C4-plan**）。
  - **两层缺一不可的理由**：若只有 schema 层，`PermissionRequest` / `PreCompact` 等"合法但越界"的**我方**声明会**通过 FR-002 却违反 FR-001**；若只有产品层，无法区分"越界"与"拼错"，也无法覆盖第三方条目的非法事件名，诊断信息会误导。二者判定结果 MUST 可区分（不同的失败 code / 消息）。
  - **校验对象 MUST 覆盖三处**，缺一不可：(a) canonical source（`plugins/spec-driver/hooks/hooks.json` 或其 Codex 侧对应声明源）；(b) 生成结果（构建期产出的 Codex 侧 hooks 内容）；(c) **隔离安装后的最终 `$CODEX_HOME/hooks.json`**（即真正被 Codex 读取的那份，经 FR-011 合并写入之后）。只校验 (a) 无法防止生成/写入环节引入越界事件。
  - MUST 为"**第五个合法但越界的事件**"（如向**我方声明**中注入 `PermissionRequest`）建立**失败测试**：断言产品层门禁判失败、schema 层门禁判通过。同时 MUST 建立**反向用例**：目标文件中存在**第三方**的 `PermissionRequest` 条目时，两层门禁均判通过。
  - 理由：`_grounding.md` §8.2 实测确认 Codex 对未知/错拼事件名**不报错、不警告**，是高危静默失败面，我方必须自建门禁，不能依赖 Codex 报错。
  - 追溯：`_grounding.md` §8.2「高危静默失败面」；闭合 **C5**、**C4-plan**

- **FR-003**（A3②，必须，范围已按用户决策一收窄，**路径划分已按 W1 更正**）：MUST 为 Codex 侧建立真实 payload E2E，覆盖 **allow / block / failure-degrade / Stop 四条路径**（milestone A 轨验收原文要求）。
  - **事实更正（闭合 W1）**：原表述"四条路径均基于 `tool_name="Bash"`"**与事实矛盾** —— `_grounding.md` §8.5 实测的 Stop payload 为 `{hook_event_name, last_assistant_message, stop_hook_active, session_id, turn_id, cwd, transcript_path}`，**根本没有 `tool_name` 字段**。正确划分为：
    - **allow / block / failure-degrade 三条路径**基于 Codex 真实会触发的 **`Bash` 工具的 `PreToolUse` / `PostToolUse` 事件**断言；
    - **Stop 作为第四条独立路径**，基于真实 **`Stop` 事件** payload 单独验收，**不得**对其断言任何 `tool_name` / `tool_input` 字段。
  - 各路径的具体断言对象：
    - **allow 路径**：hook 允许命令继续执行，验证 `PreToolUse`/`PostToolUse` 均能读到标准字段（`hook_event_name`/`tool_name`/`tool_input.command`/`cwd`/`session_id`/`turn_id`/`model`/`transcript_path`），且 `tool_name === "Bash"`
    - **block 路径**：hook 以 `exit 2` + stderr 写反馈。**`_grounding.md` §8.7 明确该路径尚未在真实 turn 中验证**，因此本 FR 的第一项工作是**补齐这次一手实测**，实测结论才是断言依据。在实测完成前，spec / plan / 代码注释 / commit message **均不得**把"Codex 阻断语义与 Claude 已同构"写成既定事实（原 §1 与 FR-003 的此类表述已在本轮修订中撤回）。
    - **failure-degrade 路径**：hook 脚本自身异常退出或超时时的 Codex 侧行为标记为「**待 E2E 确定**」，**不是**"已知降级语义"。MUST 先填写下述**观察矩阵**，再据实测结果写断言：

      | 触发形态 | Codex 侧观察项 | 实测结论 |
      |---|---|---|
      | hook `exit 1` | turn 是否继续 / 是否报错 / stderr 是否回传 | 待实测 |
      | hook `exit 2`（含 stderr） | turn 是否被阻断 / 反馈是否回传模型 | 待实测（同 block 路径） |
      | hook `exit 2`（**不写** stderr） | 是否命中 `_grounding.md` §3.3 的 "exited with code 2 but did not write feedback to stderr" 错误分支 | 待实测 |
      | hook 超时（超过 `timeoutSec`） | turn 是否挂起 / 是否被判失败 / 是否有超时日志 | 待实测 |
      | hook stdout 输出**非法 JSON** | 是否命中 "hook returned invalid ... JSON output" 报错 / 是否阻断 turn | 待实测 |
      | hook 无退出码（被信号杀死） | 是否命中 "hook exited without a status code" | 待实测 |

      唯一可在实测前钉死的断言是否定式的：**不得导致 turn 无限期挂起或产品级崩溃**。
    - **Stop 路径**：验证真实 `Stop` payload 可读（`last_assistant_message` / `stop_hook_active` / `session_id` / `turn_id` / `transcript_path` 等字段），为 FR-004 提供输入
  - **failure-degrade 的"与 Claude 侧对比记录"产出形态（闭合 clarify #6）**：明确为**文档产出**——写入 `plan.md` / `tasks.md` 的设计说明章节，或相关脚本头部注释。**不**设为独立的自动化断言，**不**新建跨运行时行为一致性对比测试基础设施。
  - **明令禁止**：不得在任何 hook 脚本或判定器代码中解析 `tool_input.command` 的 shell 命令字符串来提取/推断目标文件路径（理由见 §2 Non-Goals，F231 已实测证伪）
  - **明令禁止**：不得在 spec/plan/文档/commit message 中出现"Codex 下也能像 Claude 一样拦截文件编辑操作"的 over-claim 表述；对外表述必须明确"Codex 侧 hook 覆盖不到直接改文件的操作，是上游未实现（挂账 openai/codex#16732 / #17794 / #18491 / #20204）"
  - 追溯：milestone A3 point 2、A 轨验收；`_grounding.md` §8.4、§8.5、§8.7；`tech-research.md` §2.1、§2.3；闭合 **W1**、clarify #6

- **FR-004**（A3③，必须，**rev3 已按用户决策三整体改道：从"换主信号源"改为"判不了就大声报"**）：

  **(0) 改道背景 —— 原方案已被实测与对抗审查双重证伪（不得质疑、不得回退）**

  rev2 的 FR-004 要求"以 `.specify/runs/` 的 `workflow-run-summary` 作为主信号源替代 transcript"。该路线**已被证伪**：

  1. **编排器侧写入的正常 `workflow-run-summary` 记录里根本没有任何合规判定信息**。实测其可用字段为 `workflowId / runId / result / startedAt / finishedAt / durationMs / rerun / rerunPhase / completedPhases / phaseDurations / gatePauses / verificationFailures / artifacts / warnings`。其中 `result` 表示"工作流跑成功/失败"，**不等于**"fix 流程合规"。
  2. **唯一带 `complianceVerdict` 的记录，恰是判定器自己降级分支写的**（`fix-compliance-judge.mjs:334-347`，`runId: sessionId`，见 `_grounding.md` §9.1.1）。按原设计把它结构性排除之后，**剩下的记录里没有任何可用于合规判定的信息**。
  3. **`.specify/runs/` 不构成可信安全边界**：它是判定进程自身可读、可写、可删的普通文件。Codex 对抗审查已构造出可主动触发的绕过——破坏 / 撑大 / 改权限该文件 → 主信号维度失效 → 回退 Codex transcript（格式异构必然不可判定）→ `exit 0` 放行。

  据此，rev2 FR-004 中的以下手段与关联合同**全部撤回、不再需要**，且 **MUST NOT** 在 plan/tasks/implement 中重新引入：

  - 以 `.specify/runs/` 作为主信号源替代 transcript
  - `sessionId` / `turnId` / `workflowRunId` 关联键与关联合同（原 FR-004(2)、原 §6.4）
  - C1~C5 候选池、双源选择矩阵、交叉校验条款（原 FR-004(3)）
  - `complianceVerdict` 的结构性排除规则
  - `record-workflow-run.mjs` 的事件 schema 字段扩展
  - 5 处 SKILL.md 的 `--run-id` 调用改动
  - `complianceVerdict` 写入方唯一性守卫测试

  **(1) 保留的原始意图**：**Codex 运行时下 Stop compliance 判定不得静默失效。**

  **(2) 新的规范语义（本 FR 的全部交付内容）**

  - `fix-compliance-judge.mjs` MUST 能**识别出"当前 `payload.transcript_path` 指向的文件不是自己能解析的格式"**。判据基于 Codex rollout 的确证结构特征（`{timestamp, type, payload}`，`type ∈ session_meta | event_msg | response_item`，见 `_grounding.md` §8.5），与 Claude transcript 结构完全不同。识别判据 MUST 是**结构性**的（基于行对象的键集合/`type` 取值域），**MUST NOT** 采用"内容看起来像什么"的启发式（F228 教训：内容启发式必被改写绕过）。
  - 在该情形下，判定器 MUST **显式落盘一条 loud 诊断**（走既有的 `tryAppendFailOpenEvent` 类路径），诊断内容至少包含：不可识别的原因 code、transcript 路径的**存在性与可读性**结论、以及"本次 compliance 判定未执行"这一明确结论。
  - **MUST 消除的现状行为**：当前该情形会经 `runHook` 的 `!result.isFix → return 0`（`fix-compliance-judge.mjs:411`）被**静默判为"非 fix 会话"、零诊断落盘**。改造后，"格式不可识别"与"确实不是 fix 会话"**MUST 在落盘信号上可区分**。
  - **放行语义不变**：仍为 fail-open，退出码仍为 `0`，**不新增任何阻断风险**。本 FR 改变的**只是"是否留下诊断"**。

  **(3) 明确不承诺的边界（禁止 over-claim，MUST 原样保留在对外表述中）**

  - 本 FR **不**提供独立于 transcript 的第二事实源。
  - 本 FR **不**声称提高了合规判定的**强度**——一个能改 transcript 的执行体同样能让判定失效。
  - 本 FR 解决的是**可观测性**问题（失效时能被发现），**不是**安全强度问题。
  - 任何文档 / commit message / 交付报告中 **MUST NOT** 出现"Codex 下 compliance 判定已生效/已加固/已闭环"类表述；正确表述为"Codex 下 compliance 判定失效时**会留下诊断**，不再静默"。

  **(4) 对抗审查要求**：本 FR 触及 F208/F216/F224/F228/F229/F230/F231/F236 反复加固过的判定链（即使本轮改动面已大幅收窄），MUST 走完整对抗审查流程，不得作为"低风险改动"简化处理。审查重点为：格式识别判据是否可被构造绕过、诊断落盘路径本身是否会抛异常影响 `exit 0`、以及是否意外改变了 Claude 侧既有分支的行为。
  - 追溯：milestone A3 point 3；用户决策三；`_grounding.md` §8.5、§9.1、**§9.1.1**、§9.5；`tech-research.md` §1、§3.4、§6.1

- **FR-005**（A3④，必须，语义已按 `_grounding.md` §8.6 修正）：五个 hook 脚本中依赖插件根路径的部分（当前唯一使用点：`stop-fix-compliance-check.sh` 的 `CLAUDE_PLUGIN_ROOT`）MUST 支持读取 `PLUGIN_ROOT` 作为 `CLAUDE_PLUGIN_ROOT` 的等价兼容变量，优先级顺序为 `PLUGIN_ROOT` → `CLAUDE_PLUGIN_ROOT` → 脚本自身相对路径推导（现有 fallback 逻辑保留）。**语义修正**：`_grounding.md` §8.6 实测确认 Codex 不向 hook 进程注入任何 `PLUGIN_ROOT`/`CODEX_PLUGIN_ROOT`/`CLAUDE_PLUGIN_ROOT` 类变量；因此 A3④ 不能理解为"消费 Codex 注入的变量"，而必须理解为：(a) 我方在生成 Codex 侧 hooks.json 内容时，在 `command` 字段里写入绝对路径（构建期展开，而非运行期依赖环境变量插值）；或 (b) 脚本自身从 `$0`/已知的 `CODEX_HOME` 相对结构推导插件根路径。两种实现方式的取舍留给 plan 阶段（clarify #2 已核定该延后恰当），但 spec 层面钉死：Codex 侧 hooks.json 的 `command` 字段 MUST NOT 依赖任何未经证实会被 Codex 注入的环境变量展开。
  - 追溯：milestone A3 point 4；`_grounding.md` §8.6（🔴 高优先级修正）；`tech-research.md` §2.3、§3.1

- **FR-011**（A3 新增，必须，**闭合 `_grounding.md` §9.3 / O1**）：`$CODEX_HOME/hooks.json` 是**全局唯一共享文件**，与现有 Codex skills 安装（每 skill 独立目录、天然隔离）的冲突模型**根本不同**。用户的该文件可能已含其自有 hooks 或其他工具写入的条目。因此本 feature 的 Codex hooks 写入器 MUST 满足以下全部语义：

  1. **合并而非覆写**：写入时 MUST 保留目标文件中所有非我方条目与所有未知字段；解析失败时 **MUST NOT** 以空对象覆写。**包括第三方条目所在的事件域**——即便该事件不在我方 4 事件子集内（如用户自有的 `PermissionRequest` / `Notification` hook），也 MUST 原样保留（与 FR-001/FR-002 的作用域限定一致，闭合 **C4-plan**）。
  2. **幂等**：重复安装 MUST NOT 产生重复条目（已存在我方条目时跳过或原地更新）。
  3. **可精确卸载**：卸载 MUST 只移除我方条目，其他来源的条目原样保留。
  4. **归属标记**：MUST 使用 `command` 字符串中的**唯一脚本名**（如 `stop-fix-compliance-check.sh`）作为归属锚点。**MUST NOT** 使用自定义 JSON 字段做归属标记 —— 理由：`_grounding.md` §8.1 实测确认未知字段当前被静默忽略，但"未来 Codex 版本是否严格拒绝未知字段"属**未确证**风险，我方 hook 的 `command` 本就含唯一脚本名，天然可用作标记，无需承担该风险。
  5. **写入前备份**：MUST 在修改前备份现有 `hooks.json`。
  6. **非法 JSON 的处置**：目标文件已存在且内容为非法 JSON 时，MUST **报错并要求用户手工修复，绝不覆写**。
  7. **类型防御**：目标文件中相关字段被写成非数组/非对象时，MUST 安全降级处理而非抛出未捕获异常。

  **MUST 复用现有实现模式，禁止另起炉灶**：`src/hooks/hook-installer.ts` 已实现"向 Claude 的共享 `settings.json` 合并写入并可精确移除"，即上述全部语义，且有 18 个单测覆盖（`_grounding.md` §9.3.1 已实测全绿）。对应关系：归属识别 `HOOK_COMMAND_MARKER`（`:26`）、幂等（`:119-121`）、备份（`:125`）、深度合并（`:130-137`）、原子写入（`:139`）、精确移除（`:182`）、非法 JSON 抛错不覆写（`:112`、`:171`）、类型防御（`:118`、`:175`）。实现方式 MUST 为"抽取共享 helper"或"对称实现同一套语义"，**禁止**新造一套不同的写入设计。
  - 追溯：`_grounding.md` §9.3、§9.3.1；闭合 **O1**、**C4-plan**

### A4 — CODEX_HOME 与版本一致性诊断

- **FR-006**（A4①，必须，**接口自相矛盾已按 W4 消解**）：MUST 新增一个纯函数 `resolveCodexHome(deps)`（Node 侧）及其 shell 侧对称实现（可 `source` 的公共片段），语义为：`CODEX_HOME` 环境变量存在且非空时使用其值；否则 fallback 到 `path.join(homedir(), '.codex')`。该语义 MUST 与官方 `codex doctor` 的已实测行为对齐（`_grounding.md` §5.2：`codex doctor` 完全尊重 `CODEX_HOME`，报告显式回显生效值），不得自创不一致的 fallback 规则。
  - **依赖注入合同（消解 §5.3 的 `opts?` 矛盾）**：`deps` 参数 **MUST 为必填**（`{ env, homedir }` 两个字段均必填），调用方不传即 fail-loud，函数体内 **MUST NOT** 隐式读取 `process.env` / `os.homedir()`。生产环境的默认值来源由一个**独立的薄封装** `resolveCodexHomeFromProcess()` 承担，该封装是全仓库唯一显式传入 `process.env` 与 `os.homedir` 的位置。理由：F238 已实测证明"可选参数 + 内部默认值"会让 caller 的遗漏静默降级为默认行为，掩盖下游缺陷；caller 传参恒 required fail-loud 是本仓库既定教训。
  - **边界矩阵（MUST 全部覆盖，见 §7 Edge Cases 表）**：`unset` / 空串 / 相对路径 / 绝对路径 / 尾部斜杠 / 含空格 / symlink / 不存在 / 无权限。
  - 追溯：milestone A4 point 1；`_grounding.md` §5.2；`tech-research.md` §3.5；闭合 **W4**

- **FR-007**（A4②，必须，**判定规则已按 `_grounding.md` §9.2 / W5 重写**）：

  **(1) 判定规则（🔴 最关键，闭合 `_grounding.md` §9.2）**

  仓库内存在两类形如 `.codex` 的路径拼接，**语义完全相反**，MUST 严格区分：

  > **判定规则：只有以 `homedir()` / `$HOME` 为基的拼接才走 helper；以仓库根 / `process.cwd()` 为基的一律不动。**

  - **MUST 改为消费 FR-006 helper（以家目录为基）**：
    - `src/auth/auth-detector.ts`（auth detector）
    - `src/installer/skill-installer.ts` 的 **`mode === 'global'` 分支**（`resolveTargetDir:165-173` 中的 `join(homedir(), rootDir, 'skills')`），以及 `formatSummary`/`formatDisplayPath`/`formatDisplayDir` 中对应的家目录展示路径
    - `src/scripts/postinstall.ts`
    - `src/scripts/preuninstall.ts`
    - `plugins/spec-driver/scripts/codex-skills.sh` 的 **global 模式**（`TARGET_DIR="$HOME/.codex/skills"`，通过 source 公共片段）
  - **MUST NOT 改动（以仓库根 / cwd 为基）**：
    - `src/installer/skill-installer.ts` 的 **`mode === 'project'` 分支**（`join(process.cwd(), rootDir, 'skills')`）
    - `plugins/spec-driver/scripts/validate-orchestrator-models.mjs:84`（`path.join(root, '.codex/skills', ...)`）
    - `plugins/spec-driver/scripts/sync-delegation-contract.mjs:60`（同形）
    - `plugins/spec-driver/scripts/codex-skills.sh:66`（project 模式 `TARGET_DIR="$PROJECT_ROOT/.codex/skills"`）

  **危险点提示**：`resolveTargetDir` 中 **同一个函数、同一个 `rootDir` 变量，两个分支语义完全相反**。盲目把 `.codex` 全量替换为 helper 会让 project 模式指向 `CODEX_HOME`，破坏项目级安装。本仓库 `.codex/skills/` 是**真实存在的 F238 wrapper 产物目录**（含 9 个 `spec-driver-*/SKILL.md`），受 wrapper body-sha256 门禁保护，误改会**同时打断 `repo:check` 与 F238 门禁链路**。上述"MUST NOT 改动"清单 MUST 作为回归断言落地（见 §7 Edge Cases 与 SC-020）。

  **(2) 用户文案同步（闭合 W5-1）**

  `plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs:82` 的 `~/.codex/spec-driver-capability.md` 文案，在自定义 `CODEX_HOME` 下会**误导用户**（说的路径与实际路径不一致）。MUST 改为不误导的表述，例如"`~/.codex/spec-driver-capability.md`（默认路径，实际以 `CODEX_HOME` 为准）"或等价动态描述。**注意**：该文件受 F238 wrapper body-sha256 门禁保护，改动后 MUST 运行 `npm run repo:sync` 重生 sha 并确认 `npm run repo:check` 零失败。

  **(3) 现有测试的迁移面（闭合 W5-2）**

  以下测试当前断言 `homedir() + '.codex'`：`tests/unit/skill-installer.test.ts:239`、`tests/integration/spec-driver-codex-skills.test.ts:358,395`、`tests/e2e/feature-213-codex-plugin-install.e2e.test.ts:73`、`tests/unit/auth-detector.test.ts:175`。迁移要求：

  - **MUST 保留** `CODEX_HOME` unset 时的默认行为回归断言（即"未设置时仍解析到 `~/.codex`"这一断言必须继续存在）；
  - **MUST 新增**自定义 `CODEX_HOME` 环境下的用例；
  - **MUST NOT** 为了迁移 helper 而机械改写掉原有的默认行为断言 —— 删掉默认行为断言等于失去"helper 是否破坏了默认路径"的检测能力。

  **(4) worktree cache 一项的处置（闭合 W5-3 与 checklist 项 3）**

  `tech-research.md` §3.5 已确认 F239 的 worktree cache 机制不直接拼接 `~/.codex` 路径（走 `.worktreeinclude`/项目内路径）。原 spec 写的"helper 接口形状 MUST 保留可扩展性"缺少可判定的验收标准，属于无法机械验证的条款。**本轮修订处置**：删除该"可扩展性"要求，改为**可证明的否定项** —— MUST 提供一次全仓扫描证明"当前不存在 worktree cache 相关的全局 `~/.codex` 路径拼接点"（SC-021），并在结果中如实记录扫描命令与命中数。若未来出现该类路径，属新 feature 范围。
  - 追溯：milestone A4 point 2；`tech-research.md` §3.5；`_grounding.md` §5.3、**§9.2**；闭合 **W5-1/2/3/4**、checklist 项 3

- **FR-008**（A4③，必须，**比较域/状态机/schema 强制性已按 W2 补齐**）：MUST 新增一个独立诊断 CLI（不接入 `hooks.json`、不做 `repo:check` 硬阻断，定位与 `judge-snapshot-doctor.mjs` 一致——"诊断不阻断"），产出"仓库版本 / 全局 CLI / plugin build / MCP server"四方一致性判别式联合结果。

  **(1) 比较矩阵（按产品分组，闭合 W2）**

  `contracts/release-contract.yaml` **同时存在多个 version 字段**（实测：`marketplace.metadata.version`、`products.spectra.version`、`products.spec-driver.version`，后两者当前均为 `4.4.0`）。原 spec 的占位式 `products.<product>.version` 没说清比较谁。MUST 按下表明确比较域：

  | 产品分组 | 仓库版本来源 | 全局 CLI | plugin build | MCP server |
  |---|---|---|---|---|
  | **spectra** | `products.spectra.version` | `spectra --version` | Codex/Claude 侧 active spectra plugin 的 `plugin.json.version` | live Spectra MCP server（尽力而为） |
  | **spec-driver** | `products.spec-driver.version` | 无独立全局 CLI → `not-applicable` | Codex/Claude 侧 active spec-driver plugin 的 `plugin.json.version` | `not-applicable` |

  `marketplace.metadata.version` **不参与**四方比较（它是 marketplace 自身版本，非产品版本），MUST 在实现中显式排除以免误比。

  **(2) 版本字符串归一化规则**

  `spectra --version` 的输出带 build commit 后缀（F186，形如 `spectra v4.4.0 (0ae3eb7)`）。MUST 定义归一化规则：提取语义版本三元组（`MAJOR.MINOR.PATCH`）用于**相等性比较**，commit 后缀与 `v` 前缀保留在 `details` 中用于展示与排障，**不参与**相等性判定。无法从输出中提取出合法语义版本时 → 该维度 `indeterminate`（`reason: version-parse-failed`），**MUST NOT** 用原始字符串做直接相等比较后判 `fail`。

  > **与 FR-012 的交叉约束（rev3，闭合 C5-plan）**：commit 后缀与 `v` 前缀"保留在 `details` 中"**不等于**可以原样回填子进程输出。`details` 中承载的 MUST 是经受限类型校验后的产物（见 FR-012(2)）；**MUST NOT** 保存 `spectra --version` 的原始 stdout/stderr 字符串。

  **(3) 状态机与 `overallStatus` 真值表（闭合 W2 + clarify #5）**

  | 各 check 状态组合 | `overallStatus` |
  |---|---|
  | 全部 `ok`（允许含 `not-applicable`） | `ok` |
  | 无 `fail`、无 `indeterminate`，有 `warning` | `warning` |
  | 有 `indeterminate`、无 `fail` | **`warning`** |
  | 有 `fail`（无论其他） | `fail` |

  - **版本漂移（drift）对应 `fail`**（这是确定性的不一致结论）。
  - **`indeterminate` 对应 `warning`**（`fail` 语义保留给"明确判定为不一致"，`indeterminate` 本质是"我们不知道"；混入 `fail` 会削弱 `indeterminate` 态存在的意义，且与"诊断不阻断"的产品定位不符）。
  - **任一方 `indeterminate` 时整体 MUST NOT 为 `ok`**（复用 F236"不允许整体短路"教训）。

  **(4) CLI 退出码真值表**

  | `overallStatus` | 退出码 |
  |---|---|
  | `ok` | `0` |
  | `warning` | `0`（诊断不阻断；信息在报告体内，不靠退出码传递） |
  | `fail` | `0`（默认，诊断不阻断）；仅当显式传入 `--strict` 时为 `1` |
  | CLI 自身异常（参数非法 / 内部未捕获错误） | `2` |

  `--strict` 是为未来可能的 CI 接入预留的显式开关，默认关闭，**MUST NOT** 在本 feature 内接入 `repo:check`。

  **(5) 各方的读取与降级**

  - **仓库版本**：读取 `contracts/release-contract.yaml` 的对应 `products.<product>.version`；文件缺失/解析失败 → `indeterminate`
  - **全局 CLI**：`spectra --version` 子进程调用，仿照 `detect-codex-capability.mjs` 的错误分类模式（ENOENT/超时/非零退出分别归类，不抛异常）
  - **plugin build**：Codex 侧若能找到等价于 `~/.claude/plugins/installed_plugins.json` 的 active 标记文件，MUST 复用 F236 `resolveActiveSnapshot` 的判定模式（**禁止**"取最高版本号"）；若"确认不存在等价机制"则标记 `indeterminate`（`reason: codex-active-marker-unknown`），不得回退为"猜最高版本号"
  - **"确认不存在"的举证标准（闭合 clarify #3）**：MUST 操作化为一份**可枚举、可复用的排查点清单**，至少含：(a) `.codex-plugin/plugin.json` 的字段集；(b) `codex --help` / `codex plugin --help` 的输出；(c) `codex doctor --json` 的 checks 集合；(d) `$CODEX_HOME/` 下已知路径探测（`plugins/`、`plugins/cache/<market>/<plugin>/<version>/`、`.codex-global-state.json`）；(e) app-server RPC 能力列表。**清单全部走完仍无结果**才落 `indeterminate`；报告 `details` MUST 记录"已排查了哪些信号源"（以固定 probe id 与 outcome 枚举形式，见 FR-012(2)），便于未来复审判断该结论是否需因上游变化而更新。**禁止**"随手 try 一个路径没找到就判 indeterminate"。
  - **MCP server**：本 feature 范围内只做"尽力而为"诊断（见 §2 Non-Goals），找不到显式版本查询接口时标记 `indeterminate` 并明确注明"MCP server 当前不暴露版本自省能力，此诊断为已知产品缺口"
  - **`remediation` 的结构化要求**：`remediation` MUST 为结构化形态 `{ code, command | null, text }`，其中 `code` 取自固定枚举（如 `upgrade-global-cli` / `reinstall-plugin` / `reload-mcp-client` / `grant-hook-trust` / `manual-investigate`），`command` 为可直接复制执行的命令模板或 `null`。**禁止**只给自由文本导致下游无法机械消费。

  **(6) 报告 schema 的强制性（闭合 W2）**：§6.2 的报告 schema 从"**建议**采用"升级为 **MUST 采用**（与 `codex doctor --json` 同构，`_grounding.md` §5.2 已实测该 schema）。
  - 追溯：milestone A4 point 3、A 轨验收；`_grounding.md` §5.2、§5.3；`tech-research.md` §Q3、§6.2；闭合 **W2**、clarify #3、clarify #5

- **FR-012**（A4 新增，必须，**闭合 C3；rev3 已按 C5-plan 从"键 allowlist"强化为"值级 typed schema + 全通道漏斗"**）：`_grounding.md` §5.1 明确 `~/.codex/config.toml` 含**真实凭据**（MCP server 的 API key）；官方 `codex doctor --json` 自称输出 redacted。四方诊断（FR-008/FR-009）的**全部输出通道** MUST 满足以下脱敏合同：

  **(1) 键级 allowlist（rev2 已有，保留）**

  - 报告中每个 `details` 键 MUST 来自一份**显式允许清单**；不在清单内的任何键值一律不输出。**禁止**采用"过滤掉看起来像密钥的字符串"这类黑名单/启发式方案（本仓库 F228 已实测：内容启发式必被改写绕过，必须用结构性边界）。

  **(2) 值级 typed schema（rev3 新增，🔴 闭合 C5-plan —— 仅控键不控值仍会泄漏）**

  仅 allowlist 键**不足以**防泄漏：rev2 设计允许 `rawVersion` / `activeInstallPath` / `probedSources` / `attemptedProbes` 等键的**值原样输出**——一个损坏或恶意的 `spectra --version` 输出即可经 `rawVersion` 直接把凭据带出。因此：

  - **所有报告字段的值 MUST 是受约束类型**，由构造器产出并经校验，具体至少包括：
    - 枚举型（`status` / `category` / `product` / `reason` / `remediation.code` / probe `outcome`）：值域为**闭合枚举**，非枚举值即构造失败；
    - 版本型（如 `rawVersion` 的替代字段）：MUST 为**受限 semver 形态**（正则受限的 `MAJOR.MINOR.PATCH[+build-commit]`），不匹配即落 `indeterminate`，**MUST NOT** 原样透传；
    - probe 标识型（`probedSources` / `attemptedProbes`）：MUST 为**固定 probe id 枚举 + 固定 outcome 枚举**的组合，**MUST NOT** 承载自由文本原因；
    - 路径型（如 `activeInstallPath`）：MUST 为**经约束处理的相对路径**（相对于 `CODEX_HOME` 或仓库根的相对形态），**MUST NOT** 输出未经处理的绝对路径或含用户名的家目录路径。
  - **明令禁止保存/输出任何原始文本**：子进程 `stdout` / `stderr`、RPC error message、文件读取失败的原始 `error.message`、异常堆栈，**一律 MUST NOT** 进入报告任何字段。需要表达"为什么失败"时，MUST 映射为**固定 reason 枚举**。

  **(3) 全通道单一漏斗（rev3 新增，闭合 C5-plan）**

  - `summary`、`remediation.text`、`remediation.command`、以及 **CLI 顶层错误消息**（含未捕获异常的用户可见输出）**MUST 同样经由同一套构造器产出**，不得绕过漏斗直接拼接字符串。
  - 覆盖通道 MUST 为五类，缺一不可：**JSON 输出 / 文本输出 / 错误分支输出 / `indeterminate` 分支输出 / CLI 顶层错误输出**。

  **(4) 明令禁止输出**：原始 config 文件内容（含 `config.toml` 任何片段）、完整环境变量集合、完整 argv、任何凭据值（API key / token / OAuth 凭据 / auth.json 内容）、任何未经映射的原始 stdout/stderr/error message。

  **(5) 测试要求（canary 注入点已按 C5-plan 扩面）**

  - MUST 使用 **canary API key**（一个可唯一识别的假密钥字符串），对上述五类通道分别断言：canary 的**明文形式**与**常见编码形式**（至少含 base64、URL-encoded、JSON 转义）**均不出现**在输出中。
  - **canary 注入点 MUST 覆盖每一个输入 adapter**，不只是 config / auth / env 三类。至少包括：
    1. `config.toml` 读取路径
    2. `auth.json` 读取路径
    3. 环境变量读取路径
    4. **子进程 stdout**（构造一个输出中含 canary 的伪 `spectra --version`）
    5. **子进程 stderr**（同上，canary 写 stderr）
    6. **RPC 错误路径**（app-server RPC 返回的 error message 含 canary）
    7. **文件读取失败路径**（error message 含 canary 的文件名/内容）
    8. **嵌套 probe 失败原因**（FR-008(5) 排查点清单中任一 probe 的失败原因含 canary）
  - 每个注入点 MUST 有独立断言用例，**禁止**用一个注入点代表全部。

  **(6) 对齐标准**：我方脱敏标准 MUST 不低于 `codex doctor --json` 自称的 redacted 标准。
  - 追溯：`_grounding.md` §5.1、§5.2；闭合 **C3**、**C5-plan**

- **FR-013**（A4 新增，必须，**闭合 C6 —— inventory 机械验收**）：milestone A 轨验收原文（`tech-research.md` §5，引 `docs/design/milestone-M9-codex-trusted-live-graph.md` §93-98）要求：`codex mcp list` / plugin inventory 能**机械确认 Spectra 已启用**。本 feature MUST 在收口验收中显式覆盖该项：

  - **inventory 命令**：`codex mcp list`（Codex 侧 MCP 清单）与 plugin inventory（Codex 侧已安装 plugin 清单，命令形态以实测确认为准）。
  - **预期条目**：清单中 MUST 出现 Spectra MCP server 条目，且其**启用状态**为已启用（非 disabled / failed）。
  - **失败退出码**：inventory 检查脚本在"条目缺失"或"条目存在但未启用"时 MUST 以**非零退出码**失败，并在输出中区分这两种情形。
  - **复用而非重造**：若该检查能力已由 F213 / F239 提供，MUST **直接复用**其现成命令；但**仍 MUST 在本 feature 的收口 SC 中显式列出并实际执行一次**（SC-022），**不得**只靠"历史上做过"这一隐含理由跳过。
  - 追溯：`tech-research.md` §5（milestone A 轨验收原文）；闭合 **C6**

### A3/A4 交叉 — hook 信任诊断与文档（用户决策二）

- **FR-009**（必须，**人工流程已按 C4 升级为硬验收**）：FR-008 的四方诊断 MUST 增加一项独立 check：探测 Codex 侧 hooks 的信任状态（`_grounding.md` §8.3：`HookTrustStatus` 取值域含 `managed`/`untrusted`/`trusted`/`modified`；信任按内容哈希绑定，脚本内容变更即失效）。

  - **探测手段**留给 plan/实施阶段选择（如经 app-server RPC `hooks/list` 读取 `HookMetadata.trustStatus`，`_grounding.md` §4.3 已确认该 RPC 入口存在），但 spec 层面钉死下列合同：
  - **三种情形分别返回固定状态值**（不得合并、不得笼统）：

    | 情形 | check `status` | 必须携带的信息 |
    |---|---|---|
    | 探测到 `untrusted` | `warning` | `remediation.code = grant-hook-trust`，附**经实测验证有效**的授予步骤 |
    | 探测到 `modified`（内容哈希变更导致信任失效） | `warning` | `remediation` 明确说明"hook 脚本内容已变更，需重新授予信任" |
    | 探测失败 / 不可判定 | `indeterminate` | `details` 记录已尝试的探测手段与失败原因（以固定 probe id + reason 枚举形式，见 FR-012(2)） |

  - **MUST NOT** 在探测失败时静默假设"已信任"。
  - **remediation 的实测约束（🔴 闭合 C4）**：`remediation` 中给出的任何步骤，**MUST 事先经过实测验证确实能达成目标状态**；**未经实测的步骤不得写入**。理由：填一个"看似合理实则无效"的步骤，比不给步骤更有害——用户会照做、失败、且不知道为何失败。
  - **人工验收硬 SC（见 SC-013）**：本 FR 的有效性 MUST 通过一次真实人工验证证明，具体要求见 Success Criteria SC-013，**不得**降级为"建议人工验证"。
  - 追溯：milestone A3/A4 交叉；用户决策二；`_grounding.md` §8.3；闭合 **C4**

- **FR-010**（必须，**rev3 已按 W2-plan 补齐实施落点与断言方式**）：Codex 侧 hooks 安装/使用说明文档 MUST 明确写出"首次使用需要完成 hooks 信任授予"这一前置步骤，且安装脚本/流程本身 MUST NOT 自动写入任何绕过信任的配置项，MUST NOT 调用 `--dangerously-bypass-hook-trust`（该 flag 仅允许出现在本 feature 新增的 E2E 测试脚本内部，作为测试场景专用，不得出现在任何面向用户的安装/使用路径）。

  **(1) 文档事实源与生成链（rev3 新增，闭合 W2-plan）**

  - **事实源文件**：`plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs` 中承载 Codex 全局说明文本的那段常量（即当前产出 `~/.codex/spec-driver-capability.md` 说明的同一处，`:82` 附近）。该处是"首次信任"提示的**唯一 canonical 来源**，**MUST NOT** 在其他文件里另写一份平行文案。
  - **生成链**：事实源 → `npm run repo:sync`（wrapper 生成与 body-sha256 重算）→ 全局说明文本产物（`$CODEX_HOME/spec-driver-capability.md`）。该链路受 F238 wrapper body-sha256 门禁保护，改动后 MUST 跑 `npm run repo:sync` + `npm run repo:check` 零失败。
  - **路径文案**：文档中提及的路径 MUST 遵守 FR-007(2) 的文案规则（标注"默认路径，实际以 `CODEX_HOME` 为准"）。

  **(2) 断言方式（至少满足以下三条，验收见 SC-026）**

  1. 生成后的全局说明文本中**含"首次信任"语义的表述**（可机械 grep 的关键词，如"首次"+"信任"）；
  2. 该文本中提及 hooks 路径处**含 `CODEX_HOME` 限定说明**（不得只写死 `~/.codex` 而无限定）；
  3. **产品目录中 `--dangerously-bypass-hook-trust` 零命中** —— 扫描范围为 `src/`、`plugins/spec-driver/scripts/`、`plugins/spec-driver/hooks/`、`.codex-plugin/`（即排除 `tests/` 之后的全部产品路径），命中数 MUST 为 `0`。
  - 追溯：用户决策二；`_grounding.md` §8.3；闭合 **W2-plan**

## 5. Success Criteria

> **闭合 C1**：原 spec 全文无 `SC-*` 编号，无法机械判定"完成"。本节为集中的顶层判定式清单，每条给出**一条命令 + 明确的退出码/字段断言**。
>
> - **分组标注**（落实 §1.1）：`[A3]` / `[A4]` / `[共通]`，**禁止**用一侧完成度代替另一侧。
> - **脚本路径约定**：标注 `（本 feature 新增）` 的命令/文件为本 feature 需产出的制品，plan 阶段可调整具体命名，但**不得删除对应的验收语义**。
> - **`[MANUAL]`** 标注的为必须的人工验证项，不可用自动化替代，也不可降级为"建议"。
> - **编号稳定性约定（rev3）**：已废止的 SC **保留原编号并标注废止理由**，**不重排**，以免打断下游 `tasks.md` 的映射。新增 SC 从当前最大编号后续接。
> - **全量门禁命令口径（rev3，闭合 W3-plan）**：本仓库真正的完整测试入口是 **`npm test`**（`package.json:23` = `vitest` + `test:plugins`）。**只跑 `npx vitest run` 会漏掉 `.mjs` 插件测试**。凡"全量门禁"语义处 MUST 用 `npm test`（或显式并列 `npx vitest run` + `npm run test:plugins`）。SC 中针对**单个测试文件**的定向命令仍可用 `npx vitest run <file>`。

### A3 组

- **SC-001 `[A3]` 最终生成的 Codex `hooks.json` 内容正确（作用域 = 我方 owned 条目，rev3 按 C4-plan 修订）**
  命令：`node plugins/spec-driver/scripts/validate-codex-hooks.mjs --target "$CODEX_HOME/hooks.json" --format json`（本 feature 新增）
  断言：退出码 `0`；
  - **产品层（我方归属）**：输出中**我方 owned 条目**（`command` 含唯一归属脚本名者）所覆盖的 `events` 集合**恰等于** `["SessionStart","PreToolUse","PostToolUse","Stop"]`（无多、无少）；
  - **schema 层（全文件）**：最终文件中**出现的全部事件名**（含第三方条目）**均属于** `_grounding.md` §2 确证的 10 个合法 Codex 事件之一；**MUST NOT** 断言全文件事件集合恰等于四项 —— 该写法与 FR-011 的"保留第三方条目"直接冲突（用户若已有合法的 `PermissionRequest` / `Notification` hook，合并后事件必然多于四项），实现将被迫在"删第三方数据"与"校验失败"之间二选一；
  - **其余（对我方条目）**：每个 handler 的 `type === "command"`；每个 `command` 字段中的脚本路径为**绝对路径**（以 `/` 开头）且 `existsSync` 为真；每个 `command` 字段**不含** `${` 字符（证明无运行期环境变量插值）；每个我方条目的 `command` 含唯一归属脚本名。
  - **反向用例**：目标文件中预置一条第三方 `PermissionRequest` 条目后重跑本命令，退出码仍为 `0`，且该第三方条目在文件中原样存在。
  追溯：FR-001 / FR-002 / FR-005 / FR-011；闭合 C1 / **C4-plan**

- **SC-002 `[A3]` 事件白名单两层门禁生效（含越界失败测试与第三方放行测试）**
  命令：`npx vitest run tests/unit/codex-hooks-event-gate.test.ts`（本 feature 新增）
  断言：退出码 `0`；用例集 MUST 含且断言通过——(a) 4 个允许事件（我方条目）：schema 层 pass + 产品层 pass；(b) `pre_tool_use` / `PreToolUSE` / `NotAnEvent`：schema 层 **fail**；(c) **`PermissionRequest` 出现在我方条目中（合法但越界）：schema 层 pass + 产品层 fail**，且两层失败 code 可区分；(d) **`PermissionRequest` 出现在第三方条目中：两层均 pass**（闭合 C4-plan）；(e) 三处校验对象（canonical source / 生成结果 / 隔离安装后的 `$CODEX_HOME/hooks.json`）各有独立用例。
  追溯：FR-002；闭合 C1 / C5 / **C4-plan**

- **SC-003 `[A3]` 四路径真实 E2E —— allow 路径（Bash 事件）**
  命令：`bash tests/e2e/codex-hooks/run-e2e.sh --path allow`（本 feature 新增，内部使用隔离 `CODEX_HOME=$(mktemp -d)` + `--dangerously-bypass-hook-trust`）
  断言：退出码 `0`；落盘的 `PreToolUse` 与 `PostToolUse` payload 中 `hook_event_name` 分别为 `PreToolUse`/`PostToolUse`、`tool_name === "Bash"`、`tool_input.command` 为非空字符串、`cwd`/`session_id`/`turn_id`/`model`/`transcript_path` 均存在；`PostToolUse` 额外含 `tool_response`。
  追溯：FR-003；闭合 C1 / W1

- **SC-004 `[A3]` 四路径真实 E2E —— block 路径（Bash 事件，含前置一手实测）**
  命令：`bash tests/e2e/codex-hooks/run-e2e.sh --path block`（本 feature 新增）
  断言：退出码 `0`；**前置**：`_grounding.md` §8.7 标注该路径尚未在真实 turn 中验证，本 SC 的**第一步是完成该一手实测并把结论写入 plan.md 的观察记录**；断言内容以实测结论为准，至少包含"hook `exit 2` + stderr 后，被拦截的命令未被执行"这一可观察事实（如探针文件未被创建）。**若实测证明 Codex 阻断语义与预期不符，MUST 如实记录并调整断言，禁止把不符事实包装成通过**。
  追溯：FR-003；闭合 C1 / W1

- **SC-005 `[A3]` 四路径真实 E2E —— failure-degrade 路径（观察矩阵填写完毕）**
  命令：`bash tests/e2e/codex-hooks/run-e2e.sh --path failure-degrade`（本 feature 新增）
  断言：退出码 `0`；FR-003 的**观察矩阵 6 行全部由实测结论填写完毕**（无"待实测"残留）并写入 plan.md；自动化断言部分至少覆盖否定式判据——每种触发形态下，`codex exec` 进程在有界超时内退出（不挂起），且无产品级崩溃。
  追溯：FR-003；闭合 C1 / W1

- **SC-006 `[A3]` 四路径真实 E2E —— Stop 路径（独立 Stop 事件，不断言 tool_name）**
  命令：`bash tests/e2e/codex-hooks/run-e2e.sh --path stop`（本 feature 新增）
  断言：退出码 `0`；落盘的 Stop payload 含 `hook_event_name === "Stop"`、`last_assistant_message`、`stop_hook_active`、`session_id`、`turn_id`、`cwd`、`transcript_path`；测试代码中**不存在**对 Stop payload 的 `tool_name` / `tool_input` 断言（可用 grep 反向验证）。
  追溯：FR-003；闭合 C1 / W1

- **SC-007 `[A3]` ~~Stop 双源选择矩阵（含关联合同与全部负向样本）~~ —— 🔴 已废止（决策三）**

  **废止理由**：本 SC 的全部 12 行矩阵均建立在"以 `.specify/runs/` 的 `workflow-run-summary` 作为主信号源 + `sessionId`/`turnId` 关联合同"这一设计之上。该设计已被实测与对抗审查双重证伪（详见 FR-004(0)）：(a) 编排器侧写入的正常 `workflow-run-summary` 记录中**不含任何合规判定信息**；(b) 唯一带 `complianceVerdict` 的记录恰是判定器自己降级分支写的（`_grounding.md` §9.1.1）；(c) `.specify/runs/` 是判定进程自身可读可写可删的普通文件，**不构成可信安全边界**，存在可主动触发的绕过。

  **处置**：编号 **SC-007 保留但不再作为验收项**，`tasks.md` 中映射到 SC-007 的任务 MUST 一并作废。FR-004 的新验收项为 **SC-025**。
  追溯：用户决策三；`_grounding.md` §9.1.1、§9.5

- **SC-008 `[A3]` `hooks.json` 合并写入语义（非破坏性 / 幂等 / 可精确卸载 / 非法 JSON 不覆写）**
  命令：`npx vitest run tests/unit/codex-hooks-installer.test.ts`（本 feature 新增）
  断言：退出码 `0`；用例 MUST 覆盖——(a) 目标文件已含第三方条目时安装，第三方条目**原样保留**（**含第三方条目位于我方 4 事件子集之外的事件域**，如 `PermissionRequest`，闭合 C4-plan）；(b) 连续安装两次，我方条目数量恒为 1（幂等）；(c) 卸载后我方条目消失、第三方条目仍在；(d) 归属判定基于 `command` 字符串中的脚本名，且报告/实现中**不存在**自定义 JSON 归属字段（grep 反向验证）；(e) 写入前生成备份文件；(f) 目标文件为非法 JSON 时**抛错且文件字节内容不变**（前后 sha256 相等）；(g) 目标字段被写成非数组时安全降级不抛未捕获异常。
  追溯：FR-011；闭合 C1 / O1 / **C4-plan**

- **SC-025 `[A3]` Codex 格式 transcript → 必须落盘 loud 诊断且退出码为 0（rev3 新增，替代已废止的 SC-007）**
  命令：`npx vitest run tests/unit/fix-compliance-unknown-transcript.test.ts`（本 feature 新增）
  断言：退出码 `0`；用例集 MUST 覆盖下表每一行且断言通过（全部可用 **fixture 直接单测**，**不需要**真实 turn）：

  | # | 输入 fixture | 期望 |
  |---|---|---|
  | 1 | `transcript_path` 指向 **Codex rollout 格式** fixture（每行 `{timestamp,type,payload}`，`type ∈ session_meta\|event_msg\|response_item`） | 判定器**落盘一条 loud 诊断**（`tryAppendFailOpenEvent` 类路径），诊断含"格式不可识别"的原因 code；**进程退出码为 `0`** |
  | 2 | 同第 1 行 | 落盘诊断与"确实不是 fix 会话"的信号**可区分**（原因 code 不同），**不得**复用 `!result.isFix → return 0` 的静默出口 |
  | 3 | `transcript_path` 指向 **Claude 格式** fixture | 行为与改造前**完全一致**（既有 Claude 侧断言全绿，零回归） |
  | 4 | `transcript_path` 指向**不存在**的文件 | 既有行为不变；若已有诊断则保持，不因本次改造产生新的静默出口 |
  | 5 | `transcript_path` 为 `null` / 缺失 | 既有行为不变 |
  | 6 | 诊断落盘路径自身失败（目标目录不可写） | **退出码仍为 `0`**，不得因诊断写入失败而抛异常或改变放行语义 |

  额外断言（over-claim 防护，静态检查）：实现与测试注释中**不出现**"第二事实源""判定已加固""compliance 已闭环"类表述；实现中**不存在**对 `.specify/runs/` 的判定输入读取（grep 反向验证）。
  追溯：FR-004；用户决策三

### A4 组

- **SC-009 `[A4]` `CODEX_HOME` 边界矩阵全覆盖**
  命令：`npx vitest run tests/unit/codex-home.test.ts`（本 feature 新增）
  断言：退出码 `0`；用例 MUST 逐行覆盖下表并断言：

  | 输入 | 期望 |
  |---|---|
  | `CODEX_HOME` unset | `join(homedir(), '.codex')` |
  | 空串 `""` | 视同未设置 → `join(homedir(), '.codex')` |
  | 绝对路径 `/tmp/x` | 原样返回 `/tmp/x` |
  | 相对路径 `./x` | 原样返回，**不隐式 resolve 为绝对路径**（`[待实测]` 若实测证明 Codex 自身会 normalize，则以实测为准并同步修订本行） |
  | 尾部斜杠 `/tmp/x/` | 原样返回；下游拼接 MUST 用 `path.join` 保证不产生 `//` |
  | 含空格 `/tmp/a b` | 原样返回；shell 侧引用 MUST 加双引号，`bash -n` + 实跑不因空格断词 |
  | symlink 路径 | **preserve symlink**，不做 `realpath` 解引用 |
  | 不存在的路径 | 原样返回，helper **不做存在性校验**（`[待实测]` `_grounding.md` §5.2 只实测了**有效**临时目录，未证明官方对不存在路径的行为；本条目在实测前记为**我方自定义语义**，不得声称"与 doctor 对齐"） |
  | 无读写权限的目录 | 原样返回；下游文件操作失败时输出明确错误，不静默吞异常、不误判为"未设置" |

  额外断言：`resolveCodexHome` 的 `deps` 参数**必填**——不传参调用时抛错（fail-loud），且函数体内**不出现** `process.env` / `os.homedir()`（静态 grep 验证）；`resolveCodexHomeFromProcess()` 是全仓唯一显式传入两者的位置。
  追溯：FR-006；闭合 C1 / W4

- **SC-010 `[A4]` helper 消费点收口正确（正向）**
  命令：`npx vitest run tests/unit/skill-installer.test.ts tests/unit/auth-detector.test.ts tests/integration/spec-driver-codex-skills.test.ts`
  断言：退出码 `0`；用例 MUST 同时包含——(a) **保留**的 unset 默认行为断言（解析到 `~/.codex`）；(b) **新增**的自定义 `CODEX_HOME` 用例（解析到自定义值）。用 git diff 复核：原有默认行为断言**未被删除或改写**。
  追溯：FR-007(3)；闭合 C1 / W5-2

- **SC-011 `[A4]` 仓库内 `.codex/` 路径未被误改（负向回归，🔴 最高风险项）**
  命令：`npx vitest run tests/unit/codex-home-scope-boundary.test.ts`（本 feature 新增）+ `npm run repo:check`
  断言：退出码均为 `0`；边界用例 MUST 断言在**设置了自定义 `CODEX_HOME` 的环境下**，下列路径解析结果**仍以仓库根/cwd 为基、完全不变**：`skill-installer.ts` 的 `mode==='project'` 分支、`validate-orchestrator-models.mjs:84`、`sync-delegation-contract.mjs:60`、`codex-skills.sh:66`（project 模式）。同时 `repo:check` 的 `spec-driver-wrappers` 检查 status 为 `ok`（证明 `.codex/skills/` 的 9 个 wrapper 未被打断）。
  追溯：FR-007(1)；闭合 C1 / `_grounding.md` §9.2

- **SC-012 `[A4]` 四方诊断 schema / 状态机 / 退出码 / 值级类型约束**
  命令：`node plugins/spec-driver/scripts/codex-runtime-doctor.mjs --format json`（本 feature 新增）+ `npx vitest run tests/unit/codex-runtime-doctor.test.ts`（本 feature 新增）
  断言：退出码 `0`；JSON 输出通过 schema 校验（`schemaVersion` / `generatedAt` / `overallStatus` / `checks{id,category,status,summary,details,remediation}`）；`checks` 覆盖 `repo-version` / `global-cli` / `plugin-build` / `mcp-server` / `hook-trust` 五个 category；每个 `remediation` 为 `null` 或结构化 `{code, command, text}` 且 `code` 属固定枚举。单测 MUST 覆盖 FR-008(3) 真值表全部 4 行、FR-008(4) 退出码真值表全部 4 行（含 `--strict` 下 `fail → 1`）、以及按产品分组的比较矩阵（含 `marketplace.metadata.version` 被显式排除的断言、版本后缀归一化断言 `spectra v4.4.0 (0ae3eb7)` → `4.4.0`、无法解析时落 `indeterminate` 而非 `fail`）。
  **rev3 追加（闭合 C5-plan）**：MUST 断言所有报告字段的值通过 FR-012(2) 的受限类型校验——枚举字段非法值即构造失败；版本字段不匹配受限 semver 时落 `indeterminate` 而非透传；probe 字段为固定 id + outcome 枚举组合；路径字段为经约束的相对形态。
  追溯：FR-008 / FR-012(2)；闭合 C1 / W2 / clarify #5 / **C5-plan**

- **SC-013 `[A4]` `[MANUAL]` hook 信任状态迁移人工验证（🔴 硬门禁，不可降级）**
  命令：人工在真实 Codex 客户端执行，步骤与观察结果 MUST 逐条记录进 `verification-report.md`
  断言（三段全部达成才算通过）：
  1. **`untrusted → trusted` 真实迁移**：在干净 `CODEX_HOME` 下安装我方 hooks，先观察诊断报告 `hook-trust` check 为 `untrusted`；按 `remediation` 给出的步骤完成授予后，再次观察为 `trusted`；随后**不带** `--dangerously-bypass-hook-trust` 触发一次真实事件，确认 hook **确实执行**（探针文件落盘）。
  2. **`modified` 状态**：修改 hook 脚本内容（哪怕一个字节）后再次探测，确认状态变为 `modified`（验证信任按内容哈希绑定，`_grounding.md` §8.3）。
  3. **`remediation` 有效性**：本次人工验证中**实际执行过**的授予步骤，才允许写入 `remediation`；未实测通过的步骤 MUST 从实现中移除。
  另需断言：诊断对 `untrusted` / `modified` / 探测失败三种情况返回 FR-009 表中规定的**固定状态值**。
  追溯：FR-009；闭合 C1 / **C4**

- **SC-014 `[A4]` 诊断输出强制脱敏（canary × 五通道 × 八注入点）**
  命令：`npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts`（本 feature 新增）
  断言：退出码 `0`；测试注入 canary API key 后，对 **JSON 输出 / 文本输出 / 错误分支输出 / `indeterminate` 分支输出 / CLI 顶层错误输出**五个通道分别断言：canary 的**明文**、**base64**、**URL-encoded**、**JSON 转义**四种形式均**不出现**；同时断言输出中不含原始 config 文件片段、不含完整环境变量集合、不含完整 argv、**不含任何原始 stdout / stderr / error message**。
  **rev3 追加（闭合 C5-plan）**：canary 注入点 MUST **逐一独立覆盖 FR-012(5) 列出的 8 个 adapter**（config.toml / auth.json / 环境变量 / 子进程 stdout / 子进程 stderr / RPC 错误 / 文件读取失败 / 嵌套 probe 失败原因），每个注入点有独立用例，**禁止**用一个注入点代表全部。
  额外静态断言：`details` 的键来自显式 allowlist（实现中存在该 allowlist 常量且被强制应用）；**值**经受限类型构造器产出（存在该构造器且 `summary` / `remediation` / 顶层错误消息均经其产出）；**不存在**基于内容特征的黑名单过滤。
  追溯：FR-012；闭合 C1 / **C3** / **C5-plan**

- **SC-015 `[A4]` `--strict` 下的漂移可被机械捕获**
  命令：`node plugins/spec-driver/scripts/codex-runtime-doctor.mjs --strict --format json`（在构造的漂移 fixture 环境下）
  断言：存在真实版本漂移时退出码 `1` 且 `overallStatus === "fail"`；只有 `indeterminate` 无 `fail` 时退出码 `0` 且 `overallStatus === "warning"`。
  追溯：FR-008(3)(4)；闭合 C1 / W2

- **SC-026 `[A4]` 首次信任提示的文档落点可断言（rev3 新增，闭合 W2-plan）**
  命令：`npm run repo:sync && npm run repo:check` + `npx vitest run tests/unit/codex-hook-trust-doc.test.ts`（本 feature 新增）
  断言：退出码均为 `0`；
  1. 生成后的 Codex 全局说明文本（`$CODEX_HOME/spec-driver-capability.md` 或其构建期产物）中**含"首次"与"信任"两个关键词**（可机械 grep）；
  2. 该文本提及 hooks 路径处**含 `CODEX_HOME` 限定说明**（不得只写死 `~/.codex` 而无限定）；
  3. `rg -n -- "--dangerously-bypass-hook-trust" src plugins/spec-driver/scripts plugins/spec-driver/hooks .codex-plugin` 命中数为 **0**（产品目录零命中；测试目录不在扫描范围内）；
  4. 该文案的 canonical 来源唯一 —— 全仓"首次信任"提示文案的写入点数量恒为 1（grep 计数断言），防止未来出现平行文案。
  追溯：FR-010；闭合 **W2-plan**

### 共通组（回归护栏 / 收口）

- **SC-016 `[共通]` Claude 侧 hooks 行为零回归 + 双运行时 provenance 可区分**
  命令：`npx vitest run tests/unit/hook-installer.test.ts` + `bash tests/e2e/codex-hooks/run-e2e.sh --path allow` + Claude 侧既有 hook 回归用例
  断言：退出码均为 `0`；**provenance 判据（闭合 W6）**：两个运行时的测试 MUST 使用**不同的入口/配置**，并**分别断言其独有 payload 特征与安装路径**——Claude 侧断言 `tool_name ∈ {Edit, Write}` 且 payload 含 `file_path`、安装目标为 `settings.json`；Codex 侧断言 `tool_name === "Bash"` 且 payload 含 `tool_input.command`、**无** `file_path`、安装目标为 `$CODEX_HOME/hooks.json`。**禁止**两侧共用同一 fixture 只切换 runtime 标签跑两遍（可用"两侧断言集合互不为子集"作为复核判据）。
  追溯：§8 护栏 1；闭合 C1 / **W6**

- **SC-017 `[共通]` F239 第 14/15 族门禁全绿**
  命令：`npx vitest run tests/unit/spec-drift-check.test.ts tests/unit/spec-drift-cli.test.ts tests/unit/spec-drift-state-matrix.test.ts tests/integration/spec-drift-repo-check-regression.test.ts tests/integration/spec-drift-repo-check-modes.test.ts tests/unit/sync-worktree-local-state.test.ts`
  断言：退出码 `0`；且 `npm run repo:check` 输出中 checks 列表里 `spec-drift`（第 14 族）与 `worktree-local-state`（第 15 族）的 status 均为 `ok`。
  追溯：§8 护栏 2；闭合 C1 / **W6**

- **SC-018 `[共通]` F238 wrapper sha + model literal gate 全绿**
  命令：`npx vitest run tests/unit/spec-driver/wrapper-sha256.test.ts tests/integration/spec-driver-wrapper-source-truth.test.ts` + `npm run repo:check`
  断言：退出码均为 `0`；`repo:check` 输出中 `spec-driver-wrappers` 与 `model-literal-gate` 的 status 均为 `ok`。若本 feature 改动了 SKILL 正文或 `extract-wrapper-body.mjs`（FR-007(2) 与 FR-010(1) 均会触发），MUST 先执行 `npm run repo:sync` 再复跑本 SC。
  追溯：§8 护栏 3、护栏 5；闭合 C1 / **W6**

- **SC-019 `[共通]` 评测链未被触碰**
  命令：`git diff --name-only master...HEAD -- 'scripts/eval-*' 'scripts/pilot-*' 'scripts/baseline-*'`
  断言：输出为**空**（零文件改动）。
  追溯：§8 护栏 4；闭合 C1

- **SC-020 `[共通]` 全仓 `~/.codex` 硬编码点收口完整性**
  命令：`rg -n "\.codex" --glob '!node_modules' --glob '!specs/**' --glob '!tests/**' src plugins scripts`
  断言：人工逐条复核输出，每一条命中 MUST 归入以下三类之一并在 `verification-report.md` 中标注归类：(a) 已改为消费 helper（家目录基）；(b) 明确保留不改（仓库根/cwd 基，属 FR-007(1) 的"MUST NOT 改动"清单）；(c) 文案/注释类且已按 FR-007(2) 处理或明确豁免（评测链）。**不允许**存在未归类的命中。
  追溯：FR-007；闭合 C1

- **SC-021 `[共通]` worktree cache 无全局 `~/.codex` 拼接点（否定项证明）**
  命令：`rg -n "\.codex" scripts/sync-worktree-local-state.sh plugins/spec-driver/hooks/worktree-lifecycle.sh scripts/lib/worktree-local-state-core.mjs`
  断言：命中数为 **0**；扫描命令与命中数如实记录进 `verification-report.md`。
  追溯：FR-007(4)；闭合 C1 / W5-3 / checklist 项 3

- **SC-022 `[共通]` inventory 机械确认 Spectra 已启用**
  命令：`codex mcp list`（+ Codex plugin inventory 命令，具体形态以实测确认为准；若复用 F213/F239 现成脚本则直接调用之）
  断言：输出中存在 Spectra MCP server 条目且状态为已启用；本 SC 的检查脚本在"条目缺失"与"条目存在但未启用"两种情形下**分别**以非零退出码失败且失败信息可区分。**本 SC 必须在本 feature 收口时实际执行一次并记录输出**，不得以"F213/F239 历史上做过"为由跳过。
  追溯：FR-013；闭合 C1 / **C6**

- **SC-023 `[共通]` 全量验证零失败（rev3 已按 W3-plan 更正测试入口）**
  命令：`npm test` && `npm run build` && `npm run repo:check` && `npm run release:check`
  断言：四条命令退出码均为 `0`。
  **入口口径（闭合 W3-plan）**：`npm test`（`package.json:23`）= `vitest` + `test:plugins`，是本仓库唯一的完整测试入口。**只跑 `npx vitest run` 会漏掉 `.mjs` 插件测试**（F232 教训：新增的 mjs gate 从落地起零执行）。若因环境限制无法直接跑 `npm test`，MUST 显式并列执行 `npx vitest run` **与** `npm run test:plugins` 两条，缺一不可。
  **分批交付口径（决策四）**：本 SC 在**每一批**交付前**各执行一次** —— A4 批次交付前跑一次全绿，A3 批次交付前再跑一次全绿；**不得**以第一批的结果代替第二批。
  追溯：仓库既定提交前门禁；闭合 C1 / **W3-plan**

- **SC-024 `[共通]` `[MANUAL]` F239 T039 挂账状态如实呈现**
  断言：交付报告与 `specs/239-worktree-local-state/tasks.md:261` 的 T039 状态一致——若未在本轮人工验证 session 中完成，MUST 保持 `- [ ]` 且在交付报告中显式列为未闭合项；**禁止**以本 feature 的 hooks 实测为由标记其完成（理由见 §9）。
  追溯：§9；闭合 C1

### A3 / A4 独立验收判定（落实 §1.1 与 §1.1.1）

- **A3 达标条件**：SC-001 ~ SC-006、SC-008、**SC-025** 全部通过（**SC-007 已废止，不计入**）。
- **A4 达标条件**：SC-009 ~ SC-015、**SC-026** 全部通过。
- **本 feature 整体达标条件**：A3 达标 **且** A4 达标 **且** SC-016 ~ SC-024 全部通过。
- **分批交付下的判定（决策四）**：
  - **第一批（A4 先行）达标条件**：A4 达标 **且** SC-016 ~ SC-024 中与 A4 相关的项通过（至少 SC-017 / SC-018 / SC-019 / SC-020 / SC-021 / SC-023），SC-013 / SC-022 / SC-024 的 `[MANUAL]` 项如未完成 MUST 显式挂账。
  - **第二批（A3 追上）达标条件**：A3 达标 **且** SC-016 / SC-023 重跑全绿。
  - 每一批交付报告 MUST 独立标注该批达标状态，**禁止**用整体 feature 名义模糊单批状态。
- 任一侧未达标时，交付报告 MUST 分侧如实标注，**禁止**用另一侧的完成度代替。

## 6. Key Entities / 合同

### 6.1 Codex 侧 `hooks.json`（新增/校验对象）

位置：`$CODEX_HOME/hooks.json`（顶层文件，非 `hooks/hooks.json`，`_grounding.md` §8.1 已实测反推确证）。**全局唯一共享文件**，写入语义受 FR-011 约束。

```jsonc
{
  "description": "string（可选）",
  "hooks": {
    "<EventName>": [                // PascalCase：SessionStart | PreToolUse | PostToolUse | Stop（本 feature 我方条目使用的子集）
      {
        "matcher": "<regex，可选>",
        "hooks": [
          { "type": "command", "command": "<绝对路径展开后的 shell 命令>" }
          // type 取值域：command | prompt | agent（本 feature 仅使用 command）
        ]
      }
    ]
    // 注：文件中可能同时存在第三方条目及其事件域（如 PermissionRequest / Notification），
    //     MUST 原样保留（FR-011.1），不受我方 4 事件子集约束（FR-001 作用域限定）
  }
}
```

- `type` 字段为**必填**（`_grounding.md` §8.1 更正了早期"无 type 字段"的错误推断）
- 事件键名区分大小写，仅 PascalCase 生效（FR-001/FR-002）
- `command` MUST 为构建期已展开的绝对路径或脚本自推导路径，不依赖运行期 `CLAUDE_PLUGIN_ROOT`/`PLUGIN_ROOT` 环境变量插值（FR-005）
- 归属标记 MUST 为 `command` 中的唯一脚本名，**不得**新增自定义 JSON 字段（FR-011.4）
- **事件集合约束的作用域**：产品层"恰四事件"只约束**我方 owned 条目**；schema 层"合法事件名"约束**全文件**（FR-002，闭合 C4-plan）

### 6.2 四方一致性诊断报告 schema（新增，A4③，**MUST 采用**）

与 `codex doctor --json` 同构（`_grounding.md` §5.2）。**本 schema 为 MUST，非"建议"**（闭合 W2）：

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "ISO 8601",
  "overallStatus": "ok | warning | fail",
  "checks": {
    "<check.id>": {
      "id": "string",
      "category": "repo-version | global-cli | plugin-build | mcp-server | hook-trust",
      "product": "spectra | spec-driver | null",
      "status": "ok | warning | fail | indeterminate | not-applicable",
      "summary": "string（MUST 由受限构造器产出，见 FR-012(3)）",
      "details": { "...": "（键来自 allowlist、值为受限类型，见 FR-012(1)(2)）" },
      "remediation": { "code": "string（固定枚举）", "command": "string | null（模板，非原始输出）", "text": "string（MUST 由受限构造器产出）" }
    }
  }
}
```

- `status` 相比 `codex doctor` 原 schema 新增 `indeterminate` 与 `not-applicable` 两态，与 F236 判别式联合结果的四态精神一致
- `product` 字段用于承载 FR-008(1) 的按产品分组比较矩阵
- `overallStatus` 真值表见 FR-008(3)：drift → `fail`；`indeterminate`（无 fail）→ `warning`；任一非 ok 时不得为 `ok`
- **`details` 的键与值均受 FR-012 强制约束**：键来自 allowlist；值为枚举 / 受限 semver / 固定 probe id 与 outcome / 经约束的相对路径。**任何字段 MUST NOT 承载原始 stdout / stderr / error message**（rev3，闭合 C5-plan）
- `summary` / `remediation.text` / `remediation.command` 以及 **CLI 顶层错误消息**同样 MUST 经同一构造器漏斗产出（rev3，闭合 C5-plan）

### 6.3 `resolveCodexHome` helper 接口（新增，A4①/②）

```ts
// deps 必填，缺参即 fail-loud；函数体内不得读 process.env / os.homedir()
function resolveCodexHome(deps: { env: NodeJS.ProcessEnv; homedir: () => string }): string;

// 全仓库唯一显式传入 process.env / os.homedir 的位置
function resolveCodexHomeFromProcess(): string;
```

- Node 侧位置建议：`src/core/codex-home.ts`（对齐 `tech-research.md` §6.2 建议）
- Shell 侧位置建议：`plugins/spec-driver/scripts/lib/codex-home.sh`（供 `codex-skills.sh` 等 `source`）
- **显式注入合同**（消解原 §5.3 的 `opts?` 自相矛盾，闭合 W4）：`deps` 必填而非可选。原写法 `opts?: {...}` 与"不隐式读全局 `process.env`/`os.homedir()`"逻辑冲突——可选参数必然要求内部有默认值来源。本轮取"强制显式注入"一侧，生产默认值集中在 `resolveCodexHomeFromProcess()` 一处。理由见 FR-006。
- **shell 侧对称要求**：路径变量引用 MUST 加双引号（应对含空格路径），拼接 MUST 避免产生 `//`

### 6.4 ~~FR-004 关联合同键（A3③）~~ —— 🔴 已废止（决策三，rev3）

本节原定义 `{sessionId, turnId|workflowRunId, eventType, recordedAt|seq}` 关联合同键，服务于"以 `.specify/runs/` 为主信号源"的设计。该设计已整体撤回（理由见 FR-004(0)），**本合同不再需要，也 MUST NOT 被实现**。

FR-004 改道后**不引入任何新的跨制品合同** —— 其全部交付面限于 `fix-compliance-judge.mjs` 内部的"transcript 格式识别 + loud 诊断落盘"，复用既有的 `tryAppendFailOpenEvent` 类诊断路径，不新增事件 schema、不新增关联键、不改动 `record-workflow-run.mjs`、不改动任何 SKILL.md。

### 6.5 Codex rollout transcript 的识别特征（rev3 新增，A3③）

FR-004(2) 的格式识别判据依据（`_grounding.md` §8.5 实测）：

```jsonc
// Codex rollout（JSONL，每行）
{ "timestamp": "...", "type": "session_meta | event_msg | response_item", "payload": { /* ... */ } }
```

- 识别 MUST 基于**结构特征**：行对象的键集合为 `{timestamp, type, payload}` 且 `type` 落在上述闭合取值域内。
- **MUST NOT** 基于内容启发式（如"看起来像 Codex 的字符串"）——F228 已实测：内容启发式必被改写绕过，必须用结构性边界。
- 识别成功后的处置见 FR-004(2)：落盘 loud 诊断 + `exit 0`，**不**尝试解析其语义、**不**据此做任何合规判定。

## 7. Edge Cases

| 场景 | 预期行为 | 关联 FR |
|---|---|---|
| Codex 侧 hooks.json 事件名拼写/大小写错误（如 `pre_tool_use`、`PreToolUSE`） | Codex 自身静默不报错、不触发；**schema 层**门禁在构建期/CI 期捕获（作用域为全文件），不依赖 Codex 报错 | FR-002 |
| **我方条目**中出现**合法但越界**的事件（如 `PermissionRequest`） | **schema 层通过、产品层失败**，两层失败原因可区分；整体判定为失败 | FR-001/FR-002 |
| **第三方条目**中出现我方 4 事件子集之外的**合法**事件（如 `PermissionRequest` / `Notification`） | **两层门禁均通过**；该条目在合并写入后**原样保留**。**MUST NOT** 因"最终文件事件数多于四项"而判失败——那会与 FR-011 直接冲突 | FR-001/FR-002/FR-011（C4-plan） |
| 同一份 Codex hooks.json 内同时出现 PascalCase 与 snake_case 两套同事件声明 | PascalCase 生效，snake_case 静默失效——这是已确证的 Codex 行为（非 bug），本 feature 的生成逻辑 MUST 只产出 PascalCase，且校验应能检出误写的 snake_case 变体 | FR-001/FR-002 |
| `$CODEX_HOME/hooks.json` 已存在且含第三方条目 | **合并写入**，第三方条目原样保留；重复安装幂等；卸载只移除我方条目 | FR-011 |
| `$CODEX_HOME/hooks.json` 已存在且内容为**非法 JSON** | **报错并要求用户手工修复，绝不覆写**（文件字节内容前后不变）；MUST NOT 以空对象覆写 | FR-011.1/.6 |
| `$CODEX_HOME/hooks.json` 中相关字段被写成非数组/非对象 | 安全降级处理（视为空集），不抛未捕获异常 | FR-011.7 |
| `CODEX_HOME` unset 或为空串 | 视同未设置 → fallback `join(homedir(), '.codex')` | FR-006 |
| `CODEX_HOME` 为相对路径（如 `./x`） | 原样返回，**不隐式 resolve**；`[待实测]` 若实测证明 Codex 自身 normalize，以实测为准并同步修订 | FR-006 |
| `CODEX_HOME` 带尾部斜杠 | 原样返回；下游拼接用 `path.join`，不得产生 `//` | FR-006/FR-007 |
| `CODEX_HOME` 含空格 | 原样返回；**shell 侧所有引用 MUST 加双引号**，不因空格断词 | FR-006/FR-007 |
| `CODEX_HOME` 为 symlink | **preserve symlink**，不做 `realpath` 解引用 | FR-006 |
| `CODEX_HOME` 指向不存在的路径 | `resolveCodexHome` 原样返回（不做存在性校验）；下游自行处理"路径不存在"分支，不得静默 fallback 回 `~/.codex`。**`[待实测]`：`_grounding.md` §5.2 只实测了有效临时目录，未证明官方 `codex doctor` 对不存在路径的行为——在实测前本条属我方自定义语义，MUST NOT 声称"与 doctor 对齐"** | FR-006 |
| `CODEX_HOME` 指向无读写权限的目录 | 下游文件操作失败时输出明确错误，不得静默吞掉异常或误判为"未设置" | FR-006/FR-007 |
| 🔴 **仓库内 `.codex/` 路径（project 模式 / 仓库根为基）** | **行为完全不变，不受 `CODEX_HOME` 影响**。清单：`skill-installer.ts` 的 `mode==='project'` 分支、`validate-orchestrator-models.mjs:84`、`sync-delegation-contract.mjs:60`、`codex-skills.sh:66`。误改会同时打断 `repo:check` 与 F238 wrapper body-sha256 门禁（`.codex/skills/` 含 9 个真实 wrapper 产物） | FR-007(1) |
| **Stop 判定拿到 Codex rollout 格式 transcript**（`{timestamp,type,payload}`） | **结构性识别为"不可解析格式"** → **落盘 loud 诊断**（原因 code 明确）→ **退出码 `0`**（fail-open 不变）。**MUST NOT** 经 `!result.isFix → return 0` 静默判为"非 fix 会话"、零诊断落盘 | FR-004(2) |
| Stop 判定拿到 Claude 格式 transcript | 行为与改造前完全一致（零回归） | FR-004(2) |
| Stop 判定的**诊断落盘本身失败**（目录不可写等） | 退出码仍为 `0`；不得因诊断写入失败抛异常或改变放行语义 | FR-004(2) |
| ~~`.specify/runs/` 中只有 `fix-compliance-verdict`、无 `workflow-run-summary`~~ | **已废止（决策三）**：FR-004 不再读取 `.specify/runs/` 作为判定输入 | ~~FR-004(1)~~ |
| ~~`.specify/runs/` 记录重复 / 陈旧 / 未来时间戳 / 畸形 / 半写入 / 跨 session~~ | **已废止（决策三）**：关联合同已撤回 | ~~FR-004(2)~~ |
| ~~`workflow-run-summary` 与 transcript 交叉校验不一致~~ | **已废止（决策三）**：交叉校验设计已撤回 | ~~FR-004(3)~~ |
| 四方诊断中某一方（如 MCP server）读取失败 | 该维度标记 `indeterminate`，整体 `overallStatus` 落 `warning`（不得为 `ok`），不得因单方失败中断其余三方的判定；失败原因 MUST 映射为固定 reason 枚举，**不得**回填原始 error message | FR-008 / FR-012(2) |
| `spectra --version` 输出带 commit 后缀（`spectra v4.4.0 (0ae3eb7)`） | 归一化提取 `4.4.0` 参与相等性比较；后缀经受限 semver 校验后保留在 `details`（**不得**原样透传 stdout）；无法提取合法语义版本 → `indeterminate`，不得直接字符串比较后判 `fail` | FR-008(2) / FR-012(2) |
| **`spectra --version` 输出被污染**（损坏或恶意，含凭据字符串） | 不匹配受限 semver → 落 `indeterminate`（`reason: version-parse-failed`）；**原始输出 MUST NOT 出现在任何报告字段中**（canary 注入点 4/5 覆盖） | FR-012(2)(5) |
| **子进程 stderr / RPC error / 文件读取失败原因中含凭据** | 一律映射为固定 reason 枚举后输出；原始文本 **MUST NOT** 进入报告任何字段、任何通道（含 CLI 顶层错误输出） | FR-012(2)(3)(5) |
| `contracts/release-contract.yaml` 中的 `marketplace.metadata.version` | **显式排除**，不参与四方比较（它是 marketplace 自身版本） | FR-008(1) |
| hooks 已声明但未被用户信任 / 内容变更导致 `modified` | 诊断报告命中对应 check（`untrusted` / `modified` 各自固定状态值），`remediation` 给出**经实测验证有效**的 next-step；不自动绕过、不自动执行信任授予 | FR-009/FR-010 |
| 信任状态探测失败 | 标记 `indeterminate` 并在 `details` 记录已尝试的探测手段与失败原因（固定 probe id + reason 枚举）；**MUST NOT** 静默假设"已信任" | FR-009 / FR-012(2) |
| 诊断读取到含凭据的配置源 | 键 allowlist + 值级 typed schema 双重过滤后输出；canary 测试断言五类通道（JSON/文本/**错误分支**/**indeterminate 分支**/**CLI 顶层错误**）× 八个注入点均无明文与常见编码形式泄漏 | FR-012 |
| Spectra MCP server 本身无版本自省能力 | 该维度诊断标记 `indeterminate` 并注明"已知产品缺口"，不阻断诊断流程，不承诺解决 | FR-008（Non-Goals） |
| plugin-build 一方找不到 Codex active 标记文件 | 必须先走完 FR-008(5) 的**排查点清单**，全部无结果才落 `indeterminate` + `reason: codex-active-marker-unknown`，且 `details` 以固定 probe id + outcome 枚举记录已排查的信号源；**禁止**"随手 try 一个路径没找到就判 indeterminate"，**禁止**回退为"取最高版本号" | FR-008(5) / FR-012(2) |
| hook 脚本自身异常退出 / 超时 / 输出非法 JSON | 走 failure-degrade 路径：具体 Codex 行为**待 E2E 观察矩阵实测填写**；实测前唯一可断言的是否定式判据"不得导致 turn 无限期挂起或产品级崩溃"；与 Claude 侧 fail-open 语义的对比以**文档形式**记录 | FR-003 |

## 8. 回归护栏（Regression Guards）

1. **Claude 侧 hooks 行为零变化**：F208/F216 建立的 Stop compliance 判定链、`pre-tool-use-guard.sh`/`post-tool-use-format.sh` 在 Claude Code 运行时下的行为（matcher `Edit|Write` 继续对 Claude 的 `Edit`/`Write` 工具生效）不得因新增 Codex 分支而回归。本 feature 完成后 MUST 提供双运行时（Claude + Codex）E2E 证明二者互不干扰。
   - **provenance 判据（闭合 W6）**：两侧测试 MUST 使用**不同入口/配置**，并**分别断言其独有 payload 特征与安装路径**——Claude：`tool_name ∈ {Edit, Write}` + `file_path` 字段 + `settings.json` 安装目标；Codex：`tool_name === "Bash"` + `tool_input.command` + **无** `file_path` + `$CODEX_HOME/hooks.json` 安装目标。**禁止**共用同一 fixture 只切换 runtime 标签跑两遍。验收见 SC-016。
   - **rev3 补充**：FR-004 改道后其改动面进一步收窄为"transcript 格式识别 + 诊断落盘"，Claude 格式 transcript 的既有判定路径 MUST 逐字节行为不变（SC-025 第 3 行）。
2. **F239 的 graph provenance / 状态文件不回归**：`specs/_meta/graph-bootstrap-status.json`、`bootstrapSource` 判定规则、F217 `evaluateFreshness` 复用路径均不受本 feature 改动影响；第 14 族 `spec-drift`、第 15 族 `worktree-local-state` 保持全绿。**具体命令与测试文件见 SC-017**（不再以"保持全绿"笼统表述）。
3. **F238 wrapper/字面量门禁全绿**：`model-literal-gate-core.mjs`（grep 门禁）与 wrapper body-sha256 完整性校验不受影响；A4③ 诊断输出中涉及模型信息的字段 MUST 遵守 runtime-neutral quality tier 惯例，不得硬编码具体模型版本号（如 `gpt-5.6-sol`），只允许出现 tier 名或引用配置项。**具体命令与测试文件见 SC-018**。
4. **不碰评测链**：`scripts/eval-*.mjs`、`scripts/pilot-*.sh`、`scripts/baseline-*` 中的 `~/.codex` 引用保持不变。**验收见 SC-019**（`git diff --name-only` 为空）。
5. **改 SKILL 后必须 `npm run repo:sync` 重生 wrapper sha**：FR-007(2) 与 FR-010(1) 必然触及 `extract-wrapper-body.mjs`（受 wrapper sha 门禁保护），提交前 MUST 跑 `npm run repo:sync` 并确认 `npm run repo:check` 零失败。
6. **编排器侧零改动（rev3 新增）**：FR-004 改道后，`record-workflow-run.mjs`、`.specify/runs/` 事件 schema、以及 5 处 SKILL.md 的 `--run-id` 调用**全部不改动**。交付前 MUST 用 `git diff --name-only` 确认这些文件零改动。

## 9. F239 遗留 T039 的处置

**结论：T039 不因本 feature 的实测而闭合，须继续显式挂账，并新增一条与其同类的手工验证项。**

理由：T039（`specs/239-worktree-local-state/tasks.md:261`）要求验证的是 **Codex 桌面应用创建 managed worktree 时的官方文件同步机制**——`.worktreeinclude` 的 copy-if-absent 语义、`AGENTS.override.md` 的同层取代语义。而本 feature `_grounding.md` §8 的一手实测是**在隔离 `CODEX_HOME` 下用 `codex exec` CLI 触发一次真实 turn，验证 hooks 子系统的触发行为**——这是完全不同的 Codex 能力域（hooks 触发 vs. 桌面应用 worktree 文件同步），二者不存在互相印证或互相替代的关系。`_grounding.md` 的实测**没有**使用 Codex 桌面应用、**没有**创建 managed worktree，因此不能作为 T039 的证据。

据此明确结论：
- T039 保持 `- [ ]` 未完成状态，继续按 F239 tasks.md 原有描述在真实 Codex 桌面应用中人工验证（验收见 SC-024）。
- 本 feature 自身也产生了新的、同属"需要真实 Codex 客户端交互式环境才能验证"的缺口 —— 即 **SC-013 的 hook 信任状态迁移人工验证**（已升级为硬 SC，不再是"建议"）。建议按 `tech-research.md` §7.6 的建议，与 T039 安排在**同一次人工验证 session** 中一并完成，避免分两次占用人工验证成本。
- 本 feature 的自动化 E2E（FR-003）用的是非交互 `codex exec` + 显式 `--dangerously-bypass-hook-trust`（仅测试场景），**不能**替代 SC-013 的真实交互式信任授予验证——这是本 feature 相对 T039 新增的一条独立挂账项，而非对 T039 的补充证据。
- **里程碑口径**：这两项人工验证完成前，M9 轨道 A 只能声称"实现收口"，不得声称"关闭"（见 §1）。

## 10. 未决问题 / 待实测项

以下事项如实转录自 `_grounding.md` **§6（未确证分栏）与 §8.7（实测尚未覆盖）**（修正原引导句的章节号错误——第 5 条实际出自 §6 而非 §8.7；闭合 checklist 项 2）。实施阶段（plan/tasks/implement）MUST 先补齐一手实测，不得将其当作既定事实写入实现或测试断言：

1. **`exit 2` 阻断路径未在真实 turn 中验证**（出自 §8.7）：blocker 探测脚本已就绪但未跑通完整 turn（需消耗一次订阅配额）。二进制错误消息强烈支持该语义，但未经端到端确证——这是 FR-003 block 路径（SC-004）的必做前置实测项。
2. **`prompt` / `agent` 两种 handler type 的行为未测**（出自 §8.7）：本 feature 仅使用 `type: "command"`，`prompt`/`agent` 类型不在本 feature 范围内实现或断言。
3. **`matcher` 的正则语义（是否锚定、是否大小写敏感）未测**（出自 §8.7）：FR-001/FR-002 的实现若依赖 matcher 精确匹配行为，需先实测确认。
4. **信任记录的持久化位置未确证**（出自 §8.7）：FR-009 的诊断实现依赖能读取到信任状态，具体读取路径（`config.toml`、独立状态文件、或必须经 app-server RPC）需在 plan/implement 阶段先实测确认，本 spec 不预设具体读取路径。
5. **`.codex-plugin/plugin.json` 是否支持声明 hooks 字段的确切形状未证实**（出自 **§6** 未确证分栏第 1 条）：`_grounding.md` §4.1 提到的 `PluginHookSummary` 类型暗示 plugin 可能携带 hooks 摘要，但未提取到字段细节；F213 已实测证伪 manifest 支持 hooks 作为一等字段（两份真实第三方 manifest 均无 hooks），本 feature 默认采用独立 `hooks.json` 分发路径（非 manifest 内联），若实施阶段有新证据支持 manifest 方案需先经用户确认再改变路线。
6. **`PermissionRequest` / `SubagentStart` / `SubagentStop` / `PreCompact` / `PostCompact` 五个事件未触发验证**（出自 §8.7）：不在本 feature FR-001 使用的 4 事件子集内；FR-002 的 schema 层仍认其为合法事件名，产品层拒绝**我方条目**越界使用（第三方条目使用它们是合法的，见 C4-plan 修订）。未来若要扩展需先补一手实测。
7. **是否存在独立 `apply_patch` 工具路径未被证伪**（出自 §8.7）：本次实测模型选择了 shell 完成文件编辑，未观察到 `apply_patch` 工具调用，但不能排除模型在其他 prompt/场景下选择该工具路径的可能性。
   - **范围锁定（闭合 W8）**：本条**仅作为上游监测项**。**本 feature 的实现与验收不得因此扩围**；A3② 的范围收窄（用户已拍板，见 `_grounding.md` §8.8 决策记录）**不因该项的任何后续发现而自动重开**。任何重开 MUST 新开 feature 并**由用户重新决策**。原表述"若未来证实存在，FR-003 的范围收窄结论需要重新评估"已撤回——该措辞重新打开了已锁定的范围。
8. **`CODEX_HOME` 为不存在路径 / 相对路径时官方 `codex doctor` 的行为未实测**（W4 轮新增）：`_grounding.md` §5.2 只实测了**有效**临时目录。在补测前，FR-006 对这两种输入的语义属**我方自定义**，文档与代码注释中 MUST NOT 声称"与 `codex doctor` 对齐"。
9. **Codex agent 的 Bash 工具进程是否暴露 session/turn 标识未测**（rev3 新增，出自 `_grounding.md` §9.5）：该问题原本是 rev2 FR-004 关联合同的前置阻塞项。**决策三改道后，FR-004 已不依赖该结论**，本条降级为**纯监测项**，**不构成本 feature 任何 SC 的前置条件**，也**不得**据此重开 FR-004 的第二事实源路线（重开须新开 feature + 用户重新决策）。

## 11. 复杂度评估（供 GATE_DESIGN 审查）

> rev3 更新：FR-004 改道后移除"关联合同解析器"组件与"runs 关联合同查询"接口；FR-012 强化为值级 typed schema（复杂度在既有"脱敏 allowlist 模块"组件内消化，升级为"脱敏/类型约束构造器模块"，不新增组件数）。

- **组件总数**：**5**（`resolveCodexHome` helper（Node+shell 双份计 1）、Codex hooks 事件门禁、Codex hooks.json 合并写入器、`codex-runtime-doctor` 诊断 CLI、脱敏 + 值级类型约束构造器模块）
  - 已移除：~~FR-004 关联合同解析器~~（决策三）
  - FR-004 的改造已收窄为 `fix-compliance-judge.mjs` 内部的局部改动（格式识别判据 + 复用既有诊断落盘路径），**不构成独立组件**
- **接口数量**：**6**（`resolveCodexHome` / `resolveCodexHomeFromProcess` / hooks 门禁 CLI / hooks 写入-卸载 API / doctor CLI（含 `--format`/`--strict`） / inventory 检查脚本）
  - 已移除：~~runs 关联合同查询~~（决策三）
- **依赖新引入数**：**0**（全部复用仓库既有依赖与既有模式）
- **跨模块耦合**：**是** —— 需修改 2+ 个现有模块的行为：`fix-compliance-judge.mjs` 判定链（**改动面已大幅收窄**，但仍属 F208~F236 反复加固区域）、`skill-installer.ts`/`auth-detector.ts`/`postinstall.ts`/`preuninstall.ts`/`codex-skills.sh` 的路径解析、`extract-wrapper-body.mjs`（受 sha 门禁保护）
  - **已解除的耦合（决策三）**：`record-workflow-run.mjs` 事件 schema、5 处 SKILL.md 的 `--run-id` 调用
- **复杂度信号**：
  - 递归结构：无
  - 状态机：**有**（诊断五态 `ok/warning/fail/indeterminate/not-applicable` + `overallStatus` 真值表；hook 信任四态 `managed/untrusted/trusted/modified`）
  - 并发控制：无
  - 数据迁移：**有**（`$CODEX_HOME/hooks.json` 的合并写入/回滚/备份，属对既有用户数据的原地改写）
- **总体复杂度**：**HIGH**（组件 5、接口 6 均未越线，但**存在 2 个复杂度信号**（状态机 + 数据迁移），按判定规则 ≥2 信号即 HIGH；且仍触及 `fix-compliance-judge` 判定链与受 sha 门禁保护的 wrapper 链路）
- **GATE_DESIGN 建议**：因复杂度 HIGH 且涉及 fail-open 判定链改造 + 用户数据原地改写，建议保留人工审查，并要求 plan 阶段对 FR-004（格式识别不可被构造绕过、诊断落盘不影响 `exit 0`）与 FR-011（合并写入不破坏第三方数据）分别给出独立的对抗审查计划。

## 12. 修订记录

### revision 3（本轮，定向修订）

本轮为**定向修订**，只改必要处；rev2 中未被本轮决策影响的内容（A3①②④、A4①②③、Non-Goals、Edge Cases、回归护栏、T039 处置等）全部保留。

#### 用户新拍板决策（硬约束）

| 决策 | 内容 | 落点 |
|---|---|---|
| **决策三** | **A3③（FR-004）改道**：从"换主信号源"改为"判不了就大声报" | **FR-004 整体改写**（新增 (0) 改道背景与撤回清单、(1) 保留意图、(2) 新规范语义、(3) 不承诺边界、(4) 对抗审查要求）；**§2 Non-Goals** 新增"不为 Stop compliance 判定新增第二事实源"；**场景 A'** 新增；**§6.4 废止**；**§6.5** 新增 Codex rollout 识别特征；**§7** 三行 runs 相关 Edge Case 标废止、新增三行 transcript 格式识别 Edge Case；**SC-007 废止（保留编号）**；**SC-025 新增**；**§8 护栏 6** 新增编排器侧零改动；**§10 第 9 条**降级为纯监测项；**§11** 组件 6→5、接口 7→6 |
| **决策四** | **分批交付**：A4 先行完整交付并过全量门禁，A3 随后在同一分支交付、独立验收 | **§1.1.1** 新增交付节奏条款；**§5 A3/A4 独立验收判定**新增分批达标条件；**SC-023** 新增"每批各跑一次"口径 |

**决策三的证伪依据（已确证，不得质疑）**：
1. 编排器侧写入的正常 `workflow-run-summary` 记录**不含任何合规判定信息**（可用字段实测清单见 FR-004(0)）；`result` 是"工作流跑成功/失败"，不等于"fix 流程合规"。
2. 唯一带 `complianceVerdict` 的记录恰是判定器自己降级分支写的（`fix-compliance-judge.mjs:334-347`，`runId: sessionId`；`_grounding.md` §9.1.1）；按原设计排除它后**无任何可用信息剩余**。
3. `.specify/runs/` 是判定进程自身可读可写可删的普通文件，**不构成可信安全边界**；Codex 审查已构造出可主动触发的绕过（破坏/撑大/改权限 → 主信号失效 → 回退 Codex transcript 必然不可判定 → `exit 0` 放行）。

#### Codex 对 plan.md 的审查（影响 spec 的部分）

| 编号 | 问题 | 闭合位置 |
|---|---|---|
| **C4-plan** | SC-001「最终文件恰四事件」与 FR-011「非破坏性合并保留第三方条目」**自相矛盾** —— 用户若已有合法的 `PermissionRequest` / `Notification` hook，合并后事件必然多于四项，实现被迫在"删第三方数据（违反 FR-011）"与"校验失败（SC-001 红）"之间二选一 | **SC-001 改为**「**我方 owned 条目**所覆盖的事件集合恰等于四项」；schema 层改为校验**全文件事件名均属 10 个合法 Codex 事件之一**，**产品层只校验我方归属条目**、不限制第三方事件域；**FR-001** 新增范围限定；**FR-002** 两层门禁作用域分别澄清并新增第三方放行反向用例；**FR-011.1** 明确"含第三方条目所在事件域"；**§6.1 / §7 / SC-002 / SC-008** 同步 |
| **C5-plan** | 脱敏（FR-012）**只 allowlist 了键，未控制值与其他输出通道** —— `rawVersion` / `activeInstallPath` / `probedSources` / `attemptedProbes` 等值可原样输出，`summary` / `remediation` / 顶层错误消息不经同一漏斗；子进程 stdout/stderr、RPC error、嵌套 probe 失败原因均可携带凭据，一个损坏或恶意的 `spectra --version` 输出即可经 `rawVersion` 直接泄漏 | **FR-012 重构为五段**：(1) 键级 allowlist（保留）；**(2) 值级 typed schema**（枚举 / 受限 semver / 固定 probe id 与 outcome / 经约束的相对路径；**禁止保存原始 stdout/stderr/error message**，失败原因一律映射固定 reason 枚举）；**(3) 全通道单一漏斗**（`summary`/`remediation`/**CLI 顶层错误**均经构造器产出，覆盖五类通道）；(4) 禁止输出清单扩充；**(5) canary 注入点扩至 8 个 adapter**（含子进程 stdout/stderr、RPC 错误、文件读取失败、嵌套 probe 失败原因），每点独立用例。**§6.2 / §7 / FR-008(2)(5) / FR-009 / SC-012 / SC-014** 同步 |
| **W2-plan** | **FR-010 缺实施落点** —— "首次需授予 hook 信任"这句话的文档事实源、生成链、断言方式均未指明 | **FR-010 拆为两段**：(1) 事实源 = `extract-wrapper-body.mjs` 中承载 Codex 全局说明文本的常量（唯一 canonical 来源，禁止平行文案），生成链 = 事实源 → `npm run repo:sync` → `$CODEX_HOME/spec-driver-capability.md`；(2) 三条可机械断言（含"首次"+"信任"关键词、`CODEX_HOME` 路径限定、产品目录 `--dangerously-bypass-hook-trust` 零命中）。新增 **SC-026** 验收；**§8 护栏 5 / SC-018** 同步 |
| **W3-plan** | **全量测试入口写法有误** —— 仓库真正的完整入口是 `npm test`（`package.json:23` = `vitest` + `test:plugins`），只跑 `npx vitest run` 会**漏掉 `.mjs` 插件测试** | **SC-023 命令改为 `npm test`**，并写明"若环境限制则显式并列 `npx vitest run` + `npm run test:plugins`，缺一不可"；**§5 引导块**新增全量门禁命令口径约定（定向单文件测试仍可用 `npx vitest run <file>`） |

#### 编号处置说明

- **SC-007 保留编号、标注废止**（不重排），避免打断 `tasks.md` 的既有映射；`tasks.md` 中映射到 SC-007 的任务 MUST 一并作废。
- 新增 SC 从 **SC-025**（A3，替代 SC-007）与 **SC-026**（A4，FR-010 落点）续接。
- **§6.4 保留章节号、标注废止**，同理。

---

### revision 2（闭合三方审查）

本轮（revision 2）为**修订**而非重写；原 spec 中经三方审查确认正确的内容（两次事实更正的吸收、两条用户硬约束的落地、MCP 诚实降级、T039 判断、Non-Goals 九条、FR-001/FR-005 语义）均保留。逐项闭合情况：

#### Codex 对抗审查 CRITICAL（6/6 全闭合）

| 编号 | 问题 | 闭合位置 |
|---|---|---|
| **C1** | 全文缺 `SC-*`，无法机械判定完成 | 新增 **§5 Success Criteria**（SC-001 ~ SC-024，每条含命令 + 退出码/字段断言，并按 A3/A4/共通分组） |
| **C2** | FR-004 缺防陈旧/防串线关联合同 | rev2 在 **FR-004(2)** 新增关联合同键与 7 类异常样本判定表；**§6.4** 定义合同结构；**SC-007** 要求 12 行负向测试。**⚠️ rev3 说明：该闭合方案随 FR-004 整体改道而撤回**（决策三）——C2 所指的"陈旧/串线"风险在新方案下不复存在，因为 FR-004 不再读取 `.specify/runs/`。 |
| **C3** | 四方诊断遗漏强制脱敏 | 新增 **FR-012**（allowlist 而非黑名单、四类禁止输出、四通道覆盖、canary 多编码断言、对齐 doctor redacted）；**SC-014** 机械验收。**rev3 已按 C5-plan 进一步强化为值级 typed schema + 五通道 + 八注入点。** |
| **C4** | 信任路径只"建议人工验证"不足 | **FR-009** 升级为三情形固定状态值 + `remediation` 实测约束；**SC-013** 升级为 `[MANUAL]` 硬门禁（untrusted→trusted 真实迁移且不带 bypass flag 验证生效、修改脚本观察 `modified`、未实测步骤不得写入 remediation） |
| **C5** | FR-002 白名单无法执行 FR-001 范围约束 | **FR-002** 拆为 **schema 层（10 事件）+ 产品层（4 事件）两层门禁**，失败 code 可区分；校验对象扩至三处（canonical source / 生成结果 / 隔离安装后的 `$CODEX_HOME/hooks.json`）；要求"第五个合法但越界事件"失败测试；**SC-002** 验收。**rev3 已按 C4-plan 澄清两层作用域（schema 层全文件 / 产品层仅我方条目）。** |
| **C6** | 漏掉 A 轨已知的机械 inventory 验收 | 新增 **FR-013**（inventory 命令、预期条目、启用状态、失败退出码、复用 F213/F239 但**仍须本轮实跑**）；**SC-022** 验收 |

#### Codex 对抗审查 WARNING（7 修 / 1 裁定不采纳）

| 编号 | 问题 | 闭合位置 |
|---|---|---|
| **W1** | FR-003 事实矛盾（Stop payload 无 `tool_name`）+ 阻断语义 over-claim | **FR-003** 改为"allow/block/failure-degrade 基于 Bash 事件 + Stop 独立第四路径"；撤回 §1 与 FR-003 中"已同构""已知降级语义"表述，改标「**待 E2E 确定**」并新增 6 行**观察矩阵**；SC-003 ~ SC-006 分路径验收，SC-006 反向断言测试中不出现 Stop 的 `tool_name` |
| **W2** | 诊断比较域与状态机不完整 | **FR-008(1)** 按产品分组比较矩阵（显式排除 `marketplace.metadata.version`）；**(2)** 版本归一化规则；**(3)** `overallStatus` 完整真值表（drift→fail、indeterminate→warning）；**(4)** CLI 退出码真值表（含 `--strict`）；**(5)** `remediation` 结构化 `{code,command,text}`；**(6)** §6.2 schema 由"建议"升级为 **MUST** |
| **W3** | §1 对 MCP 风险 over-claim（"杜绝"） | **§1** 目标改为「显式暴露漂移或不可判定状态，降低静默风险」，并明令禁止"杜绝/彻底解决/完全避免"类措辞 |
| **W4** | `CODEX_HOME` 边界矩阵不全 + §5.3 接口自相矛盾 | **FR-006** 补齐 9 项边界矩阵并落进 §7 Edge Cases + SC-009；"不存在路径与 doctor 对齐"改标 `[待实测]` 并明确在补测前属**我方自定义语义**（另记入 §10 第 8 条）；**§6.3** 取"强制显式注入"一侧（`deps` 必填 fail-loud + `resolveCodexHomeFromProcess()` 为唯一生产默认值来源），消解 `opts?` 矛盾 |
| **W5** | FR-007 漏用户文案与测试迁移面 | **FR-007(2)** 纳入 `extract-wrapper-body.mjs:82` 文案（并提示 sha 门禁需 `repo:sync`）；**(3)** 要求保留 unset 默认行为断言 + 新增自定义 env 用例、禁止机械改写原断言；**(4)** 删除虚构的 worktree cache 消费者，改为可证明的否定项（SC-021）；场景 D 同步修订 |
| **W6** | 回归护栏可能"两边跑同一路径"的自欺 | **§8 护栏 1** 新增 provenance 判据（两侧 payload 特征与安装路径分别断言、禁止共用 fixture 切标签）；**SC-016** 验收；护栏 2/3/4 由"保持全绿"改为 **SC-017/SC-018/SC-019 的具体命令与测试文件路径**（第 14 族 `spec-drift`、第 15 族 `worktree-local-state`、`spec-driver-wrappers`、`model-literal-gate`） |
| **W8** | §9.7 重新打开已锁定的 A3② 范围 | **§10 第 7 条**改为「仅作为上游监测项；本 feature 实现与验收不得因此扩围；任何重开必须新开 feature 并由用户重新决策」，原"需要重新评估"表述已撤回 |
| **W7** | 建议拆分 A3/A4 为两个 feature | **不采纳**（用户需求原文为"A 轨最后两件合一线收口"）。**采纳其折中**：**§1.1** 明确 A3/A4 各自独立的验收状态与任务批次；§5 SC 分组标注并给出 A3/A4 各自达标条件，禁止一侧代替另一侧。**rev3 决策四进一步把交付时点也分离（分批交付），但仍不拆 feature。** |

#### 编排器补充发现（`_grounding.md` §9，3/3 全闭合）

| 编号 | 问题 | 闭合位置 |
|---|---|---|
| **§9.1** | FR-004 循环输入（`fix-compliance-verdict` 是判定器自身输出） | rev2 在 **FR-004(1)** 把主信号源收窄为 `workflow-run-summary`。**⚠️ rev3 说明：`_grounding.md` §9.1.1 已推翻 §9.1 的前提**（`workflow-run-summary` 也有判定器写入方），且实测确认正常记录中无合规信息、`.specify/runs/` 非可信边界 —— 该闭合方案**整体撤回**，FR-004 改道为"格式不可识别时 loud 诊断"（决策三）。 |
| **§9.2** | 全局家目录 vs 仓库内 `.codex/` 必须严格区分 | **FR-007(1)** 给出判定规则「只有以 `homedir()`/`$HOME` 为基的拼接才走 helper；以仓库根/`process.cwd()` 为基的一律不动」，并分列"MUST 改"与"MUST NOT 改"两份清单（含 `resolveTargetDir` 双分支语义相反的危险点、F238 wrapper 产物目录风险）；**§7 Edge Cases** 收录该清单；**SC-011** 作为负向回归断言 |
| **§9.3 / O1** | `$CODEX_HOME/hooks.json` 全局单文件，直接写入摧毁用户既有 hooks | 新增 **FR-011**（合并不覆写、幂等、可精确卸载、`command` 脚本名归属标记且禁用自定义 JSON 字段、写入前备份、非法 JSON 报错不覆写、类型防御）；**MUST 复用 `src/hooks/hook-installer.ts` 模式**（逐条映射其行号），**禁止**另起炉灶；§7 Edge Cases 覆盖非法 JSON 与非数组字段；**SC-008** 验收 |

#### checklist / clarification 遗留项（6/6 全闭合）

| 来源 | 问题 | 闭合位置 |
|---|---|---|
| checklist 项 1 | 缺独立 Success Criteria 章节 | 同 C1（§5） |
| checklist 项 2 | §9 引导句章节号错误（第 5 条出自 §6 非 §8.7） | **§10** 引导句改为「§6 与 §8.7」，并逐条标注各自出处 |
| checklist 项 3 | FR-007 "worktree cache 保留可扩展性"缺量化验收 | **FR-007(4)** 删除该不可验证条款，改为可证明的否定项 + **SC-021** |
| clarify #1 | FR-004 交叉校验失败是否有否决权 | rev2 在 **FR-004(3)** 写明「仅记录不否决」。**⚠️ rev3：交叉校验设计随 FR-004 改道整体撤回**（决策三），该 clarify 已不适用。 |
| clarify #3 | FR-008 "确认不存在等价机制"未操作化 | **FR-008(5)** 给出 5 类可枚举排查点清单（复用 `_grounding.md` §4.1/§8 已排查信号源），走完仍无结果才落 `indeterminate`，`details` 记录已排查信号源；§7 Edge Cases 同步 |
| clarify #5 | `overallStatus` 真值表缺 `indeterminate` 映射 | **FR-008(3)** 补全 4 行真值表，`indeterminate`（无 fail）→ `warning`；§6.2 同步；SC-012 验收 |
| clarify #6 | FR-003 failure-degrade "对比记录"产出形态 | **FR-003** 明确为**文档产出**（plan.md/tasks.md 设计说明或脚本头注释），**不**设为独立自动化断言 |
| Codex INFO 4 | §1 "轨道 A 收尾"措辞 | **§1** 声明为"**实现收口**"，里程碑最终关闭以 T039（SC-024）与信任人工验证（SC-013）完成为条件；§9 同步 |

#### 未修改说明

- clarify #2（FR-005 (a)/(b) 取舍延后）、clarify #4（FR-009 兜底）经核查为恰当延后/已有兜底，rev2 维持原状并在正文加注核定结论。
- 原 spec 的 Non-Goals 九条、FR-001、FR-005、§9 T039 处置结论、§10 未决项 1~6 的事实内容均保留原样（仅补充出处标注与范围锁定措辞）。
