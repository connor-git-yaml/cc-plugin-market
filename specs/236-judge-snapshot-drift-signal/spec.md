# Feature Specification: 判定器快照漂移信号（Judge Snapshot Drift Signal）

**Feature Branch**: `236-judge-snapshot-drift-signal`
**Created**: 2026-07-24
**Status**: Draft
**Input**: User description: "fix 依从性 Stop hook 消费的是已安装插件快照里的判定器，不是仓库源码；F208/F216/F224/F225/F227/F228/F229/F230 八个判定器修复全都没有升版本号，导致'仓库源码已修好'与'正在生效的快照判定器'脱节且不可观测。本次只做状态可见：检测漂移并如实报告，不引导修复、不自动同步。"

**[无调研基础]**：本 feature 走 story 模式（无 research-synthesis.md），需求边界完全来自主编排器传入的背景描述与仓库现状核实，标注为 `[无调研基础]`。

## 背景与问题陈述 *(补充说明，非模板必需段)*

`plugins/spec-driver/hooks/stop-fix-compliance-check.sh` 在会话收口时，通过 `CLAUDE_PLUGIN_ROOT`（缺省时按脚本相对路径推导）定位 `PLUGIN_ROOT`，实际执行的判定器 CLI 是 `$PLUGIN_ROOT/scripts/fix-compliance-judge.mjs`，这个路径落在**已安装插件快照**（`~/.claude/plugins/cache/<market>/<plugin>/<version>/`），**不是**仓库源码 `plugins/spec-driver/scripts/fix-compliance-judge.mjs`。

九个判定器修复（F208/F216/F224/F225/F227/F228/F229/F230/F231）均未触发 contract 版本号升级（fix 类改动不升版，只有正式发版才升；其中 F231（`9a22ce9`）在本 spec 定稿后、交付前落地，恰好又为该模式添了最新实例）。结果是：仓库源码版本号与本机已安装快照版本号可能完全相同（如都标 `4.3.0`），但两者判定器**文件内容不同**——快照侧仍在运行修复之前的旧逻辑。这一状态目前无法被观测，"门禁代码已修好"与"门禁运行中的版本已修好"被混淆为一件事。

**实测核实的关键事实**（供本 spec 的判据设计依据）：

- 本机 `~/.claude/plugins/cache/` 下可能同时存在多个版本快照目录（如 `4.2.1` 与 `4.3.0`），但真正生效的只有一个，由 `~/.claude/plugins/installed_plugins.json` 中 `spec-driver@cc-plugin-market` 的 `installPath` 字段和项目 `.specify/.spec-driver-path` 精确指向；**"取最高版本号"只是碰巧对，不是正确解析法**，其他插件已出现过 cache 内多目录、但 installed metadata 只指向其中一个非最高版本的情况。
- 从 `fix-compliance-judge.mjs` 递归解析相对 import 得到的真实消费闭包是 **6 个文件**：`scripts/fix-compliance-judge.mjs`、`scripts/lib/fix-compliance-core.mjs`、`scripts/lib/fix-compliance-execution-record.mjs`、`scripts/lib/fix-compliance-io.mjs`、`scripts/lib/simple-yaml.mjs`（`fix-compliance-io.mjs` 依赖它解析 enforcement 配置）、`scripts/record-workflow-run.mjs`（judge 依赖它做收口记录）。此前认为的"4 个文件"是事实错误。**后续演进**：F246 起该闭包为 **7 个文件**，新增 `scripts/lib/is-invoked-directly.mjs`（`record-workflow-run.mjs` 的入口守卫收敛到共享 helper）；此处 6 个是 F236 定稿时点的实测事实，FR-002 已按 7 更新。
- 当前某些历史快照（如 4.3.0 安装时点）会**缺少** `fix-compliance-execution-record.mjs`（F218 拆分后新增的模块，安装快照生成时尚不存在）；"文件缺失"本身就是最关键的一种漂移信号，不能被简单地当作"读取失败就跳过"而吞掉。
- raw sha256 比对前提已实测核实成立：仓库 checkout 与已安装快照逐字节相同（无 BOM/CRLF/构建期转换差异），故本 feature 采用的字节级指纹判据有效。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 开发者在仓库内一键查明判定器是否漂移 (Priority: P1)

作为在 spec-driver 仓库内做 dogfooding 开发的开发者，我完成一次判定器修复（如 F230 之后的下一次 fix-compliance 修复）并提交后，想知道我本机正在实际生效的 Stop hook 判定器，是否已经是修复后的最新内容，而不是等下次插件发版才能确认。

**Why this priority**: 这是本 feature 存在的唯一理由——不解决这一条，其余场景都无从谈起。是 MVP 的全部内容。

**Independent Test**: 在仓库内执行漂移检测入口（doctor 命令），人为制造"仓库侧已改、快照侧未同步"的场景（如手工修改快照侧某判定器文件一个字节，或使用真实的历史快照版本），验证检测结果准确标注 `drift`；再将两侧内容对齐后重新执行，验证标注变为 `in-sync`。全程不依赖发版动作。

**Acceptance Scenarios**:

1. **Given** 仓库内判定器文件集合（7 个文件；F236 定为 6，F246 起 +`scripts/lib/is-invoked-directly.mjs`）与本机已安装快照对应文件内容逐字节一致，**When** 开发者执行 doctor 命令，**Then** 结果报告 `in-sync`（无漂移）。
2. **Given** 仓库内判定器文件集合中至少一个文件与快照侧对应文件内容不一致（例如仓库已修复但快照未更新），**When** 开发者执行 doctor 命令，**Then** 结果报告 `drift`，并如实列出哪些文件不一致（不猜测原因、不给出修复建议）。
3. **Given** 判定器文件集合中某文件只存在于仓库侧、快照侧没有该文件（如快照生成于该文件被拆分出来之前），**When** 开发者执行 doctor 命令，**Then** 结果同样报告 `drift`，并在 `missingInSnapshot` 字段中列出该文件，不得因"读取失败"而静默跳过、误判为 `in-sync` 或 `not-applicable`。
4. **Given** 本机不存在任何该插件的已安装快照目录（如全新 CI 环境、cache 从未生成），**When** 开发者执行 doctor 命令，**Then** 结果报告 `not-applicable`（场景不适用，无快照可比对），不视为失败也不视为漂移。
5. **Given** 本机存在多个已安装快照目录、但无法唯一确定哪一个是当前 active 安装（如 `installed_plugins.json` 缺失或损坏、且无有效的 `CLAUDE_PLUGIN_ROOT` / `.specify/.spec-driver-path` 可用），**When** 开发者执行 doctor 命令，**Then** 结果报告 `indeterminate`（检测器无法完成比较），并说明具体原因，不得回退为"取最高版本号"猜测比对。

---

### User Story 2 - 检测结果不干扰任何现有流程 (Priority: P2)

作为依赖 `repo:check` / Stop hook 做日常质量把关的开发者，我不希望新增的漂移检测在开发期"仓库领先快照"这一正常状态下把整个检查变红、或改变现有 Stop hook 的放行/阻断行为。

**Why this priority**: 保护现有门禁的信任度和向后兼容性（Constitution 原则 XIII）；若新增信号本身制造噪声或误阻断，反而抵消其价值，因此优先级仅次于核心检测能力。

**Independent Test**: 在仓库处于"源码领先快照"的典型开发期状态下（这是常态，几乎每次修复后都成立）运行 doctor 命令，验证退出码/整体状态不因 `drift` 结果而由绿转红；同时验证 Stop hook 自身的 exit code 语义（0 放行 / 2 阻断）与现有 `repo:check` 的 `status` 判定均不受本 feature 影响（因为本 feature 不挂载到 `repo:check`，是独立命令）。

**Acceptance Scenarios**:

1. **Given** 检测结果为 `drift`，**When** 开发者主动执行 doctor 命令，**Then** doctor 命令本身正常退出（退出码 0），仅在输出内容里如实呈现 `drift` 状态与细节，不把"发现漂移"这一诊断信息当作命令执行失败。
2. **Given** doctor 命令已落地，**When** 开发者继续运行现有的 `repo:check` 或触发 Stop hook（会话收口场景），**Then** `repo:check` 的 `status` 判定与 Stop hook 的 exit code 完全不受本 feature 影响——因为本次范围内 doctor 命令与这两者均无挂载关系，是完全独立的旁路诊断入口。

---

### Edge Cases

- 本机不存在任何该插件已安装快照目录（`~/.claude/plugins/cache/**/spec-driver/` 下无匹配版本目录）→ 报告 `not-applicable`，不报错、不阻断（对应 FR-006）。
- 本机同时存在多个版本的已安装快照目录（如 `4.2.1` 与 `4.3.0` 并存）→ 检测须按 active-version 解析顺序（`CLAUDE_PLUGIN_ROOT` → `.specify/.spec-driver-path` → `installed_plugins.json` 的 `installPath`）明确定位到 Stop hook 实际会解析到的那一个目录，并在结果中列出 `snapshotPath` 与 `resolutionSource`；无法唯一确定时报告 `indeterminate`，**不得**回退为"取最高版本号"（对应 FR-007）。
- 单侧文件读取失败（如权限问题 EACCES）或已安装元数据文件（`installed_plugins.json`）解析失败（如 JSON 损坏）→ 该项检测降级为 `indeterminate`，doctor 命令本身仍正常退出、如实报告降级原因，不阻断（对应 FR-008）。**不存在**"`node` 不可用导致降级"这一场景，因为 doctor 命令本身就是一个 Node 入口，`node` 不可用时它根本无法启动，此边界不适用。
- 判定器文件集合本身在未来增减文件（如新增第 7 个消费文件）→ 集合以代码内显式数组维护，并配套一个递归解析当前入口静态 import 闭包的守卫测试；新增依赖若未同步更新数组，该守卫测试必须失败（对应 FR-002、FR-002b）。
- 调用方未显式传入 `--project-root` 且当前工作目录不是 spec-driver 仓库本身（即找不到仓库侧参照文件）→ 报告 `not-applicable`，不尝试比对（对应 FR-005）。
- Codex 运行时（无 Claude Code Harness 增强能力）→ doctor 命令是独立的纯 Node CLI，不依赖 Harness 特有能力，行为与 Claude Code 环境一致。

## Requirements *(mandatory)*

### 适用场景边界（先于 FR 的前提说明）

本 feature 检测的"仓库源码 vs 已安装快照"漂移，**仅在开发者本机同时具备仓库侧参照（spec-driver 仓库 checkout）与本机已安装插件快照两者时才成立**：

- **适用场景（本 feature 主战场）**：开发者在 spec-driver 仓库自身内做 dogfooding 开发，本机同时存在仓库源码与该插件的已安装快照。这正是背景陈述所述痛点的发生地。
- **不适用场景（非目标，见下）**：终端用户在自己的项目里使用 spec-driver 插件，该机器上没有 spec-driver 仓库源码，"仓库领先快照"这一概念对其不存在，无从比对，也不应尝试比对。

因此本 feature 是**面向 spec-driver 自身开发者的可观测性工具**，不是面向所有插件用户的通用能力。

### 暴露点选型（决策记录，供 plan 阶段细化实现）

| 候选暴露点 | 适用性判断 | 结论 |
|---|---|---|
| 独立、只读的 doctor CLI 命令（如 `npm run` 脚本包装的一个 `.mjs` 入口，开发者主动调用） | 语义清晰：这是一个诊断信息，不是质量门禁；开发者按需主动查询，不会在"仓库领先快照"这一开发期常态下产生持续噪声 | **采纳为本 feature 的唯一暴露点** |
| `repo:check` 新增一族检查（`scripts/repo-check.mjs` → `repo-maintenance-core.mjs`） | dogfooding 场景下"仓库领先快照"几乎总是成立、`drift` 会长期高频出现，挂到 `repo:check` 会造成持续噪声；且现有 `repo:check` renderer 只打印 `id: status` 摘要，看不到文件级列表，需要额外改造呈现层 | **本次范围排除**，留作后续视 doctor 命令实际使用价值验证后再决定是否挂载 |
| Stop hook 反馈内嵌漂移提示 | 存在**自举悖论**：检测漂移的新逻辑本身也打包在判定器快照里，运行中的旧快照 hook 不会包含这段新逻辑，只有下一次快照更新后才会生效；且 hook 触发时 cwd 未必是仓库本身，仓库侧参照不一定存在 | **列入非目标**（见下），不在本次范围内实现 |

### Functional Requirements

- **FR-001**: 系统 MUST 提供一个可在 spec-driver 仓库内主动触发的独立 doctor 命令，比对"仓库侧判定器文件集合"与"本机已安装该插件快照对应文件集合"的内容一致性，并返回四态结果之一：`in-sync`（一致）、`drift`（不一致，含内容不一致或任一侧缺文件，且不猜测/不引导修复）、`not-applicable`（无仓库侧参照或无任何已安装快照可比对）、`indeterminate`（存在仓库侧与快照侧参照但检测器因歧义或读取失败而无法完成比较）。`[必须]`
- **FR-002**: 判定器文件集合 MUST 精确覆盖 Stop hook 实际消费链上的 7 个文件（F236 定为 6，F246 起 +`scripts/lib/is-invoked-directly.mjs`——`record-workflow-run.mjs` 的入口守卫改用共享 helper 后，该 helper 进入 import 闭包）：`scripts/fix-compliance-judge.mjs`、`scripts/lib/fix-compliance-core.mjs`、`scripts/lib/fix-compliance-execution-record.mjs`、`scripts/lib/fix-compliance-io.mjs`、`scripts/lib/is-invoked-directly.mjs`、`scripts/lib/simple-yaml.mjs`、`scripts/record-workflow-run.mjs`。该集合允许以代码内显式维护的路径数组作为定义方式（它本质上是一种清单，但随代码同步提交、且受 FR-002b 守卫测试约束，不属于游离于代码之外的独立人工事实源）。`[必须]`
- **FR-002b**: 系统 MUST 附带一个守卫测试：递归解析当前仓库入口 `scripts/fix-compliance-judge.mjs` 的本地静态 import 闭包（含其间接依赖），断言解析得到的文件集合与 FR-002 定义的显式数组完全相等；未来新增/移除消费文件而忘记同步数组时，该测试必须失败。本次不采用"运行期动态推导闭包并据此比对"的方案——其复杂度超出本 feature 的 LOW 复杂度定位，静态数组 + 守卫测试已足够防止清单腐化。`[必须]`
- **FR-003**: 系统 MUST 对判定器文件集合（FR-002）中的每个文件，分别在仓库侧路径（`plugins/spec-driver/scripts/...`）与快照侧路径（`<snapshot>/scripts/...`）现算内容指纹（sha256），两侧现算、现比对，不持久化"预期指纹"作为事实源。该比对是**字节级（byte-level）**判据，非语义判据：CRLF/BOM/纯格式差异会被有意判定为 `drift`（见"已知约束"）。`[必须]`
- **FR-004**: 系统 MUST 仅使用 Node 内置 `node:crypto` 计算指纹，不得引入任何新的 npm 运行时依赖（Constitution 原则 X）。`[必须]`
- **FR-005**: doctor 命令的核心判定合同 MUST 以调用方显式解析后的 `projectRoot` 为准（支持 `--project-root <path>` 参数），而非直接读取进程当前工作目录 `cwd`；`cwd` 仅作为 CLI 未传参时的默认值来源，不进入核心判定函数的合同。当解析得到的 `projectRoot` 下不具备仓库侧参照（即找不到 `scripts/fix-compliance-judge.mjs`）时，系统 MUST 返回 `not-applicable`，不尝试比对、不报错。`[必须]`
- **FR-006**: 当本机不存在任何该插件已安装快照目录时，系统 MUST 返回 `not-applicable`，不视为错误、不阻断任何调用方流程。`[必须]`
- **FR-007**: 当需要确定本机"当前生效"的已安装快照版本目录时，系统 MUST 按以下 active-version 解析顺序依次尝试，且**禁止**以"版本号排序取最高"作为兜底策略：
  1. 若进程环境中存在 `CLAUDE_PLUGIN_ROOT` 且该路径验证有效（目录存在、含预期 manifest），直接采用；
  2. 否则读取项目 `.specify/.spec-driver-path`，验证其指向目录存在且 manifest 中的插件名匹配；
  3. 否则读取 `~/.claude/plugins/installed_plugins.json` 中 `spec-driver@cc-plugin-market` 的 `installPath` 字段；
  4. 若以上均无法唯一确定（如多个来源冲突、或均缺失/损坏），系统 MUST 返回 `indeterminate`，不得猜测选取任一候选目录。
  检测结果 MUST 包含 `snapshotPath`（实际比对的快照目录路径）与 `resolutionSource`（命中了上述哪一条规则），如实呈现、不静默省略。`[必须]`
- **FR-008**: 当读取任一侧文件失败（如权限问题 EACCES）、或已安装元数据（`installed_plugins.json`）解析失败时，系统 MUST 将受影响的检测项优雅降级为 `indeterminate`，doctor 命令本身仍正常退出，不阻断调用方的其余检查或流程。`[必须]`
- **FR-009**: 系统 MUST 提供一个独立的、只读的、由开发者主动调用的 doctor 命令（如 `npm run` 脚本包装的一个 `.mjs` CLI），用于查看判定器快照漂移状态；本次范围 MUST NOT 将该检测挂载为 `repo:check` 的新增检查项。doctor 命令 MUST 在检测到 `drift` 时仍以退出码 0 正常结束（它是诊断信息，不是质量门禁），并在输出中如实呈现四态状态；仅在命令自身发生非预期异常（如参数错误）时才以非零退出码结束。`repo:check` 挂载留作后续视本命令实际使用价值验证后再决定，非本次范围。`[必须]`
- **FR-010**: 本次改动 MUST NOT 修改 `stop-fix-compliance-check.sh` 现有的 exit code 语义（0 放行 / 2 阻断 / 其余兜底为 0），即未触发本 feature 相关调用路径时，Stop hook 行为字节级不变（Constitution 原则 XIII）。`[必须]`
- **FR-011**: 检测结果的呈现 MUST 只描述"状态"（漂移与否、涉及哪些文件、缺失于哪一侧、比对的快照目录、版本解析来源），MUST NOT 输出重装/同步/修复建议或命令（Constitution 原则 III YAGNI，用户已拍板范围收窄为"只做状态可见"）。`[必须]`
- **FR-012**: 系统 SHOULD 在 `drift` 结果中标注不一致的具体文件名列表，并区分"内容不一致"与"仅存在于一侧"（`missingInSnapshot` / `missingInRepo`），以便开发者快速判断影响范围；此为体验增强而非核心判据，去掉后核心的"能否判漂移"仍成立。`[可选]`
- **FR-013**：~~在 Stop hook 反馈中内嵌漂移提示~~ — `[YAGNI-移除]`：存在自举悖论（新检测逻辑本身也在待检测的快照包内，旧快照运行时不具备该逻辑）且 hook 触发时的 cwd 未必具备仓库侧参照，当前迭代实现价值存疑、复杂度不低，移除出本次范围，留待后续视 doctor 命令落地效果决定是否值得做。

### 已知约束

- 本 feature 的漂移判据是**字节级（byte-level）**，不是语义级（semantic-level）。这是刻意取舍：格式化差异（CRLF/LF、BOM 有无、纯空白变化）即使不改变代码语义，也会被判定为 `drift`。若未来目标演进为"语义等价即视为一致"，当前的 raw sha256 判据将不再满足，需要另行设计（如 normalized-AST hash），本次不实现该能力。

### Key Entities

- **判定器文件集合（Judge File Set）**：Stop hook 消费链上固定的 6 个 `.mjs` 文件路径集合（1 个 CLI 入口 + 4 个 lib/辅助模块 + 1 个收口记录模块），是本 feature 比对操作的对象范围，以代码内显式数组维护，并受 FR-002b 守卫测试约束与消费关系保持同源。
- **漂移检测结果（Drift Check Result）**：一次检测的输出，包含四态状态（`in-sync` / `drift` / `not-applicable` / `indeterminate`）、`snapshotPath`（比对的快照目录路径）、`resolutionSource`（版本解析命中的规则）、（当 `drift` 时）不一致的文件名列表及 `missingInSnapshot` / `missingInRepo` 字段。不包含修复建议字段。

## 非目标（YAGNI）

- 不自动重装、同步或覆盖已安装快照；不输出任何重装/更新指令。
- 不引导开发者如何修复漂移（只报状态，不做处方）。
- 不构建"任意插件、任意文件"的通用漂移检测框架；本次范围严格限定在 fix-compliance 判定器这一具体文件集合。
- 不改变现有 Stop hook 的 exit code 语义或阻断行为。
- 不采用版本号比对作为判据（已证实无效：九个修复均未升版本号，纯版本号比对无法区分"已修复"与"未修复"）。
- 不在 Stop hook 内嵌漂移提示（自举悖论 + cwd 不确定性，参见 FR-013 说明），本次仅落地独立 doctor 命令，`repo:check` 挂载留待后续视价值验证。
- 不面向终端用户场景（无 spec-driver 仓库源码的机器上，本能力天然不适用，也不强行适配）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在人为制造"仓库侧已修复、快照侧未同步"的场景下，开发者在仓库内执行 doctor 命令后，能在输出中看到明确的 `drift` 状态与不一致文件列表，无需等待下一次插件发版即可确认。
- **SC-002**: 在仓库源码与已安装快照判定器文件内容完全一致的场景下，doctor 命令报告 `in-sync`，且不产生任何 false positive 噪声。
- **SC-003**: 在本机无该插件已安装快照（或 `projectRoot` 不在仓库内）的场景下，doctor 命令明确报告 `not-applicable`。
- **SC-004**: 在开发期"仓库领先快照"的典型常态下（`drift` 结果频繁出现），doctor 命令始终以退出码 0 正常结束（漂移是诊断信息、不是执行失败），且现有 `repo:check` 整体 `status` 与 Stop hook 的放行/阻断判定完全不受影响（因二者未挂载本检测）。
- **SC-005**: Stop hook 在本 feature 落地前后的行为（exit code 分布、放行/阻断判定）对同一组既有测试用例保持完全一致，验证向后兼容零回归。

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**：预计新增 3 个：(1) 独立 doctor CLI 入口（`.mjs`）；(2) active-version 解析模块（FR-007 的四步解析逻辑，因涉及多来源读取与优先级判断，从主流程中拆出便于测试）；(3) 判定器文件集合定义 + 守卫测试（FR-002/FR-002b）。均为新增，不扩展 `repo-maintenance-core.mjs`。
- **接口数量**：预计新增 4 个内部函数接口：`checkJudgeSnapshotDrift(projectRoot)`（核心比对）、`resolveActiveSnapshot()`（FR-007 解析）、`getJudgeFileSet()`（FR-002 数组访问）、CLI 入口本身（doctor 命令的参数解析与输出格式化）。不新增外部契约文件，不修改现有 `repo:check` 契约。
- **依赖新引入数**：0（仅使用 Node 内置 `node:crypto` 与 `node:fs`，FR-004 明确约束零新增 npm 依赖）。
- **跨模块耦合**：0（不修改任何现有模块的接口；不改 `stop-fix-compliance-check.sh`，不改 `repo-maintenance-core.mjs`，全部为新增独立文件）。
- **复杂度信号**：无递归结构、无状态机、无并发控制、无数据迁移。存在一个多来源、多优先级的解析逻辑（FR-007 的 active-version resolution，4 级 fallback 链），属于轻量条件分支而非独立复杂度信号，但比初版单纯的"取最高版本号"复杂度略高。
- **总体复杂度**：**LOW-MEDIUM**（组件数 3、接口数 4，恰好触及 MEDIUM 判定规则的下限阈值；但无任何递归/状态机/并发/迁移类复杂度信号，且各组件职责单一、可独立测试，实质复杂度仍贴近 LOW。如实标注为 LOW-MEDIUM 而非压低为 LOW，供 GATE_DESIGN 审查时参考）。
