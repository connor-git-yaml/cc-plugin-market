# 技术调研报告: Fix 模式流程依从性结构化保障（防仪式坍塌）

**特性分支**: `208-fix-mode-process-compliance`
**调研日期**: 2026-07-06
**调研模式**: 在线（WebFetch + WebSearch 可用）
**产品调研基础**: 无 — **[独立模式] 本次技术调研未参考产品调研结论**，直接基于 F206 证据摘录（`research/evidence-f206-r3.md`）与需求描述执行

## 1. 调研目标

**核心问题**:
- 问题 1：Claude Code plugin hooks 能否提供"不可被模型绕过"的强制点，尤其在 headless 评测场景下是否生效
- 问题 2：现有 `orchestrator-cli.mjs` / `record-workflow-run.mjs` / `goal-loop-core.mjs` 是否已具备可复用的制品/命令集完整性校验能力
- 问题 3：候选方向 a（plugin hooks）/ b（orchestrator-cli 依从性断言命令）/ c（record-workflow-run 强制校验）/ d（无改动收口专用出口）该如何取舍与组合

**需求范围（替代"产品 MVP 范围"，独立模式降级）**:
- 必须解决："问题已修复/无需改动"场景下 fix 模式整体遗弃技能流程（0 委派、无制品、行内 cosplay 收口）
- 硬约束（来自 evidence-f206-r3.md 第 6 节）：不得特判任务 ID；不可改动 `scripts/eval-*.mjs` / `scripts/lib/**`；改动只落 `plugins/spec-driver/**`；本次先 spec 不急 ship

## 2. 架构方案对比

### 方案对比表

| 维度 | 方案 a: Plugin Hooks（Stop/PreToolUse） | 方案 b: orchestrator-cli 依从性断言命令 | 方案 c: record-workflow-run 强制校验制品清单 | 方案 d: 无改动收口专用 skill 出口 |
|------|------|------|------|------|
| 概述 | Harness 层拦截，在会话 Stop 前检查制品/委派计数，不达标则阻断收口并反馈原因给模型 | SKILL.md 文本中新增"收口前必须调用"的 CLI 命令，命令输出断言结果写入 transcript，供事后审计与（若配合 a/c）实时判定 | 现有 `record-workflow-run.mjs` 目前**只做记录不做校验**（读代码证实：无制品存在性检查、`result` 只是调用方传入的自陈值，无法拒绝任何输入）；升级为主动校验 completedPhases/artifacts 是否满足 workflow 定义，不达标则拒绝写 `success` | 新增一条"确认无需改动"的显式 skill 分支：产出简化版 fix-report（含判定依据+委派最少 1 次核实）作为合法终点，而非让模型在无路径可选时自行遗弃流程 |
| 强制力 | 高——Harness 级，独立于 Prompt 是否被模型"读了但选择不服从"（F206 证据正是"读了 prompt 但遗弃流程"，故只有走出 Prompt 层的机制才可能堵住） | 低——命令是否被调用仍取决于 Prompt 文本要求，模型可以像遗弃 fix-report.md 一样遗弃调用；但断言结果一旦真被调用，其输出可被 a/c 消费 | 中——`record-workflow-run` 当前在 SKILL.md 中是"输出最终报告后"才调用的收口动作，处于遗弃流程的下游（若模型 0 委派、无制品，大概率这行调用也被一并跳过）；需与 a 结合才能保证"不调用也无法真正 success 收口" | 中——治标于诱因（"没有合法路径处理"简单场景），不直接堵死"有合法路径但仍遗弃"的行为；需与 c 的强制清单配合防止被滥用为万能借口 |
| 覆盖面 | 交互式会话：Stop hook 可靠触发；headless（`claude -p`）：WebFetch/WebSearch 证实**除 `PermissionRequest` 外的 hooks（含 Stop）在 `-p` 模式默认生效**，除非显式加 `--bare`（跳过 hooks/plugins 自动发现）——已勘察本仓库现有 dispatcher（`scripts/lib/llm-backend-dispatcher.mjs:464-466`）调用 `claude --print --model ... --permission-mode plan`，**未使用 `--bare`**，故理论上 Stop hook 在该调用路径生效 [推断：未逐行核实 F206 评测实际驱动 fix 模式全流程的 harness 脚本是否为此文件，需在 tasks/plan 阶段针对具体评测入口二次核实] | headless 场景不依赖 harness 拦截，只要 SKILL 文本被读取即可执行（但 F206 证据表明"读了不代表执行"，故覆盖面高不等于强制力高） | 与调用点绑定，覆盖面等同于 record-workflow-run 是否被调用——同 a 的 headless 覆盖结论 | 覆盖"用户真报了已修复问题"这一类场景，不覆盖"模型误判/偷懒 no-op"场景（那类需要 c 的强制清单堵） |
| 误伤面 | 需要 hook 自判"这是 fix 流程会话"，否则会拦截所有其他插件/用户会话的 Stop——**关键风险**（第 5 节风险清单详述） | 低，命令是可选调用，不阻断任何未涉及 fix 流程的场景 | 中，若强制清单过严会误伤"确实无需任何代码改动"的合法场景（需配合方案 d） | 低，新增出口不影响现有路径 |
| 实现落点 | `plugins/spec-driver/hooks/hooks.json` 新增/改造 Stop hook 脚本；具体文件如 `plugins/spec-driver/hooks/stop-fix-compliance-check.sh`（新建，现有 `stop-task-check.sh` 是非阻断先例，需要新脚本而非改造它，避免混淆两种语义） | `plugins/spec-driver/scripts/orchestrator-cli.mjs` 新增子命令（如 `assert-fix-compliance`）+ `skills/spec-driver-fix/SKILL.md` 收口段落引用该命令 | `plugins/spec-driver/scripts/record-workflow-run.mjs` 增加 `--required-artifacts` / `--min-delegations` 校验逻辑（可复用 F204 goal-loop-core.mjs 中 `layer2_commands` 完整性校验的"⊇ requiredKinds、空集合直接判不达标、FAIL/SKIPPED 不计入"设计模式） | `plugins/spec-driver/skills/spec-driver-fix/SKILL.md` 新增 Phase（如 "Phase 0.5: 判断是否无改动收口" 分支）+ 对应轻量制品模板 |
| 与硬约束兼容性 | 兼容（只改 plugins/spec-driver/**，不动 eval 脚本；不特判任务 ID——hook 靠制品/委派计数判断，非任务 ID） | 兼容 | 兼容 | 兼容 |
| 预估开销 | 低（Stop hook 是本地 shell 脚本，读文件+计数，毫秒级；无 token 开销） | 低-中（一次 CLI 调用，若输出需要模型解析则有少量 token，但远小于一次子代理 Task 调用） | 低（同 record-workflow-run 现状，纯文件系统操作） | 中（新增一个可选分支的执行路径，但只在"无需改动"场景触发，产品定位就是替代原本会被跳过的完整 4 阶段，净开销为负——即比坍塌前的"完整走一遍"更省，比坍塌后的"0 委派"更贵，但 F206 证据认为坍塌不可接受，故这是必要开销） |

### 推荐方案

**推荐：a + c + d 三方向组合，b 视 a/c 实现细节按需并入（不单列为独立交付物）**

**理由**：
1. F206 证据的核心结论是"文本规则住在会被遗弃的流程里是死信"——三轮 prompt 级守卫（R2/R3-v1/R3-v2/v3）均被绕过，证明**任何单纯依赖模型主动执行的机制（纯 Prompt 文本、纯 CLI 命令调用约定）都不构成强制**。方案 b 单独存在时与已证伪的 R3-v2/v3 守卫同构（"要求模型在收口前调用命令"，模型可以像遗弃 fix-report.md 一样遗弃这次调用），故不能单独作为解决方案，只能作为 a/c 的实现细节（例如 Stop hook 内部逻辑可以吸收 b 设想的断言检查项，但不需要单独暴露成一个"提示模型调用"的命令）
2. 方案 a（Stop hook）是唯一被证实在 Harness 层（模型上下文之外）生效的强制点，能够在模型已经"决定遗弃流程"之后依然拦截收口——这是解决"读了但不服从"问题的唯一结构性手段
3. 方案 c（record-workflow-run 主动校验）补强 a 的判据来源：Stop hook 需要一个"本次 fix 会话是否达标"的可判定信号，最自然的信号源就是 record-workflow-run 落盘的 workflow-run-summary 事件（`completedPhases` / `artifacts` 字段），因此 a 与 c 不是相互替代而是同一机制的两端（c 产出结构化状态，a 消费该状态并决定是否阻断）
4. 方案 d 是必要的"合法出口"：没有它，c 的强制清单会把"用户真的报了个已修复的 bug"这一诚实场景也判定为不合规，逼迫模型要么硬编造制品要么被反复拒绝收口（见风险清单 Stop hook 死循环风险）；有了 d，"确认无需改动"变成受清单认可的一等公民路径而非唯一靠遗弃换取的捷径

## 3. 依赖库评估

**无新依赖** — Constitution 原则 X（零运行时依赖）与 spec-driver 技术栈约束明确：spec-driver 插件不依赖任何 npm 包或外部运行时；编排核心为 Markdown Prompt + YAML 配置，Harness 增强（hooks.json）依赖 Claude Code 平台内置能力。

本次涉及的 Node 内置能力：
- `node:fs`（读 `.specify/runs/*.jsonl`、`specs/<feature>/fix-report.md` 等制品存在性检查）— 已在 `record-workflow-run.mjs` / `goal-loop-core.mjs` 中有先例
- `node:path` / `node:process` — 同上，现有脚本已使用，无新增

hook 脚本本身沿用仓库现有 Bash 5.x 约定（`set -euo pipefail`，755 权限），与 `plugins/spec-driver/hooks/stop-task-check.sh`、`pre-tool-use-guard.sh` 等现有实现风格一致，**不引入新技术栈**。

## 4. 设计模式推荐

### 推荐模式

1. **Fail-loud 完整性校验（借鉴 F204 goal-loop-core.mjs 的 `layer2_commands` 完整性判定）**：`plugins/spec-driver/scripts/lib/goal-loop-core.mjs` 中已有的设计——空集合直接判不达标（而非"优雅降级为达标"）、FAIL/SKIPPED 命令不计入完整性（防止用失败结果"代缴"合规）、`requiredKinds` 为空时优雅降级到现状——这套模式可直接迁移到 c 方向的制品清单校验：`completedPhases`/`artifacts` 为空 → 直接判不合规，不允许"没有产出=默认合规"的静默通过
2. **Harness/Prompt 双层门禁（Constitution 原则 IX/XI 已定义此模式）**：Constitution 已明确"Prompt 层（GATE_*）+ Harness 层（Hooks）互补"，本次方案完全落在既有架构原则内，不是新发明——a 方向本质是把 Constitution XI 中"Harness 层通过 PreToolUse Hook 强制不可绕过的约束"的适用范围从"禁止直接改 src/"扩展到"禁止无制品收口"
3. **状态外置于 LLM 上下文（业界实践，见第 5 节 WebSearch 结果）**：将"本次会话是否已委派、是否已产出制品"这类判据保存为文件系统上的结构化状态（`.specify/runs/*.jsonl`），而非依赖模型在自己的输出文本中"承诺已完成"，与 CommBank Technology Blog 描述的"Keep policy-related data as structured and strongly typed state... outside of LLM chat history"策略一致——本仓库通过 `record-workflow-run.mjs` 写盘的 JSONL 事件已经是这一模式的雏形，只是当前该雏形只写不查

### 应用案例

- F204（`plugins/spec-driver/scripts/lib/goal-loop-core.mjs` 中 `assessCommandSetCompleteness` 一类函数，行 74-139 一带）：`/goal` 流程在"metric 满足后、REACHED_GOAL 之前"插入命令集完整性校验，缺必需 kind 时 fail-loud 交人工 GATE_VERIFY，而非静默放行——这是仓库内已经跑通并被 codex 多轮加固过的"结构化强制"先例，F208 应直接复用其设计惯性（同一仓库、同一作者群体、已验证有效），而非另起炉灶
- 业界实践（WebSearch，轻量）：workflow-enforcement 类 agent skill 的核心主张是"agent cannot skip or reorder these steps"，通过把关键状态保持在强类型结构（而非模型可自由生成的对话文本）中、并在每次工具调用前检查合规规则来实现（[信息来源见文末 Sources]）；本仓库场景的特殊性在于"工具调用前检查"对应 PreToolUse，但本需求的关键堵点是"收口前检查"，更贴近 Stop hook 而非 PreToolUse——这是与通用业界模式的一个具体差异点，需在 plan 阶段显式说明选型理由

## 5. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | headless 评测场景 hooks 不生效，方案 a 对 F206 类评测彻底失效 | 低（已查证：`claude -p` 除 `PermissionRequest` 外 hooks 默认生效；本仓库 `llm-backend-dispatcher.mjs` 未加 `--bare`）| 高（若真不生效则 a 方向失去评测可验证性）| **务必在 plan/tasks 阶段针对 F206 实际使用的评测 harness 入口脚本做只读核实**（不可修改，只读确认其 spawn `claude` 命令是否含 `--bare`/`--no-hooks`/自定义 `--settings` 排除 plugin hooks 目录）；若发现评测入口与本次勘察的 dispatcher 不同一份文件，需重新核实该文件的 spawn 参数 |
| 2 | Stop hook 是 session 级全局钩子，若不能准确识别"这是 fix 流程会话"，会误伤所有其他会话（包括非 spec-driver 用户会话、feature/story 模式会话） | 中 | 高（用户体感极差：任何会话收口都被拦） | Stop hook 内部自判信号候选：(1) 检查 `specs/*/fix-report.md` 是否存在**且**其 mtime 在本会话生命周期内（需要会话开始时间基准，可从 `transcript_path` 对应文件的起始时间戳推断）；(2) 检查是否存在本次会话新建的 `specs/NNN-fix-*/` 目录（fix 模式特有命名规范，`SKILL.md` 已明确"specs/NNN-fix-<short-name>/"格式）；(3) 更可靠的方案是让 SKILL 在流程启动时落一个会话级标记文件（如 `.specify/runs/.active-fix-session`），Stop hook 检查标记文件存在且未被显式清除时才介入校验，会话正常收口后由编排器自身删除标记——**该标记文件方案需要 SKILL.md 在 Phase 1 前新增一步"写入活跃标记"，属于本次实现范围**，需在 plan 阶段设计标记的生命周期（写入时机、清除时机、异常退出时的孤儿标记清理策略） |
| 3 | 全局插件缓存旧版（4.2.1）与本仓库源码版并存：新增的 hooks.json 改造/新脚本落在源码版，但用户/评测实际加载的是哪一份不确定 | 中 | 高（若评测加载旧版插件，本次改动对评测不可见，验收将失败） | 已勘察 evidence-f206-r3.md 第 6 节已将此列为红线（"全局插件缓存是旧版，改动只落 plugins/spec-driver/\*\*"），说明团队已知晓这一事实但尚未验证评测加载路径；**建议 plan 阶段增加一步"只读确认 F206 评测 harness 实际引用的 plugin root 路径"**（例如检查评测脚本是否设置 `CLAUDE_PLUGIN_ROOT` 环境变量指向 worktree 内的 `plugins/spec-driver` 而非 `~/.claude/plugins/` 缓存目录），这是本次实现能否被验证的前提性事实，而非仅仅"改完就完事" |
| 4 | Stop hook 阻断造成模型反复被拒收口的死循环 | 中 | 中 | 必须有界化：(1) Stop hook 只应在**明确判定不合规**（如标记文件存在但对应 fix-report.md 缺失）时返回 `decision: block`，并在 `reason` 中给出**具体、可执行**的修复指引（如"请调用 Task 委派 plan 子代理生成 plan.md"），避免模糊拒绝；(2) 引入拒绝次数上限（例如同一会话内 Stop hook 最多阻断 2 次，第 3 次即使不合规也放行但标注 `[GATE-DEGRADED]` 并写入 warnings，避免真死循环阻塞用户）；(3) 方案 d 的"无改动收口"合法路径必须与 Stop hook 的判定逻辑对齐（hook 检查的清单应包含"或者存在一份被 d 路径认可的轻量 no-op 报告"这一分支），否则用户真报了个已修复的 bug 时会被 hook 无限拒绝 |
| 5 | c 方向的强制清单误伤"确实无需任何代码改动"的诚实场景，逼迫模型编造虚假委派或制品来通过校验（reward hacking） | 中 | 高（比现状更糟：现状是坦诚 0 委派但被识别出来，reward hacking 后的坍塌会被清单误判为"合规"，反而更难发现）| 与风险 4 缓解策略 (3) 同源：d 方向的轻量出口本身也应包含**最低限度的委派验证**（如至少 1 次委派用于交叉核实"真的无需改动"这一判断，呼应 evidence 中"反例锚点 V010 历史 4/4 run 全部 6 委派高依从"的观察——高依从 run 即使任务简单也至少有委派）；清单校验规则应写成"完整路径 N 次委派 或 no-op 路径 ≥1 次委派 + 特定制品"，而非"任何委派次数都算数"，防止 0 委派路径被 d 出口豁免为无需任何验证 |
| 6 | 轻量验证路径（4b50109 已并入的 4a/4b→4c 合并路径）与本次新增的依从性校验叠加，进一步推高小修复的流程税，与 F206 已证实"c3 输在流程税"的结论相悖 | 中 | 中 | 新增的 Stop hook 校验应为**纯本地文件系统检查**（读 `fix-report.md`/plan.md/tasks.md 是否存在 + record-workflow-run jsonl 是否有对应 completedPhases 记录），不引入额外 LLM 调用或子代理委派，墙钟开销应控制在毫秒级，不计入"流程税"讨论范围；c 方向的 record-workflow-run 校验同理为纯文件操作，无新增 token 开销 |

## 6. 需求-技术对齐度

### 覆盖评估

| 需求范围 | 技术方案覆盖 | 说明 |
|---------|-------------|------|
| 堵住"0 委派 + 无制品 + 行内 cosplay 收口"的仪式坍塌 | ✅ 完全覆盖（a+c 组合） | Stop hook（a）在收口时机拦截，判据来自 record-workflow-run 强制校验（c）产出的结构化状态；两者共同构成"模型无论是否主动配合，收口都必须留下可验证证据"的闭环 |
| 不误伤"用户真报告已修复问题"的诚实场景 | ⚠️ 部分覆盖，依赖 d 方向落地质量 | d 方向的具体制品模板与最低委派要求需要在 plan 阶段进一步设计，本报告只给出方向性建议（风险清单 #5），未给出最终判定规则的完整伪代码 |
| 覆盖 fix 模式的轻量路径与完整路径两种 | ✅ 完全覆盖 | Stop hook 检查的核心制品（fix-report.md、record-workflow-run 落盘记录）在两条路径下都必须产出，SKILL.md 现有文本已确认"轻量路径不构成 inline 豁免——验证闭环仍全程经 Task 委派"，故校验逻辑对两路径可复用同一套清单，只是完整路径多校验 4a/4b 报告存在性 |
| headless 评测场景下机制依然生效 | ⚠️ 部分覆盖，标注不确定性 | 已查证 `claude -p` 默认加载 hooks，但**未能百分百确认 F206 实际使用的评测 harness 入口脚本**（本次只读到 `scripts/lib/llm-backend-dispatcher.mjs` 中一处 `claude --print` 调用，未逐一核对所有可能驱动 fix 模式全流程的脚本），需 plan 阶段针对性核实 |

### 扩展性评估

方案 a（Stop hook）与 c（record-workflow-run 校验）均为通用机制，未来可复用于 story/feature 模式的类似依从性保障需求（如 feature 模式下是否也存在"跳过某阶段但假装完成"的坍塌风险，可作为后续 Feature 候选而非本次范围）。方案 d 的"轻量合法出口"模式也可推广到其他"看似不需要完整流程"的场景判断，但本次不应在 F208 范围内提前泛化实现，遵循 Constitution 原则 III（YAGNI）。

### Constitution 约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| 原则 IX：Prompt 编排 + Harness 强制 | ✅ 兼容 | 本次方案正是该原则的具体落地——"不可绕过的硬约束通过 Harness 机制（Hooks）强制执行"，与既定架构原则完全对齐，非新增架构层 |
| 原则 X：零运行时依赖 | ✅ 兼容 | 无新增 npm 依赖，Bash/Node 内置能力已足够 |
| 原则 XI：质量门控不可绕过 | ✅ 兼容 | 本次是对"Harness 层通过 PreToolUse Hook 强制不可绕过的约束"适用范围的扩展（Stop hook 场景），未违反该原则，反而是其具体实现 |
| 原则 XIII：向后兼容 | ⚠️ 需在 plan 阶段设计降级路径 | 新增 Stop hook 若判定逻辑有误报风险，需确保"未触发新校验路径的既有场景"行为不变；`hooks.json` 中现有 `stop-task-check.sh` 是非阻断型，新脚本应作为独立 hook 条目新增而非改造现有脚本，避免混淆两种不同语义（提醒 vs 阻断） |
| 原则 III：YAGNI | ⚠️ 需在 plan 阶段克制 | b 方向（orchestrator-cli 显式断言命令）若单独实现为一个用户可见子命令，是纯增量复杂度（模型可以不调用），建议按第 2 节推荐仅作为 a/c 内部实现细节，不单独暴露 CLI 子命令，除非未来有独立于 hook 的调用场景 |
| 红线：不得特判任务 ID | ✅ 兼容 | 所有方案的判据均基于制品存在性/委派计数，非任务 ID 或任务描述文本 |
| 红线：不可动 `scripts/eval-*.mjs` / `scripts/lib/**` | ✅ 兼容 | 本次勘察仅**只读**引用了 `scripts/lib/llm-backend-dispatcher.mjs` 作为证据来源，未提出任何对该文件的修改建议 |

## 7. 结论与建议

### 总结

F206 证据表明三轮纯 Prompt 层守卫（症状锚定→期望行为合同 v1-v3）全部被模型绕过，坍塌 run 本质是"读了 SKILL 但选择遗弃流程"的裸 LLM freestyle，测量学意义上污染了 c3 的评测结果。技术调研确认：

1. Claude Code plugin hooks 中的 Stop hook 具备**阻断会话收口并向模型反馈原因**的能力（`decision: "block"` + `reason` 字段），且已查证 headless（`claude -p`）场景下默认生效（`PermissionRequest` 除外），这是唯一能在"模型主动决定不服从"之后依然拦截的机制。
2. 本仓库现有 `record-workflow-run.mjs` 当前**只记录不校验**，`goal-loop-core.mjs` 的命令集完整性判定（F204）提供了可直接复用的 fail-loud 校验模式（空集合判不达标、FAIL/SKIPPED 不计入完整性）。
3. 推荐方向：**a（Stop hook 阻断）+ c（record-workflow-run 升级为主动校验，产出 a 消费的结构化判据）+ d（无改动收口合法出口，避免强制清单误伤诚实场景）**；b（显式 CLI 断言命令）不单独作为交付物，因其与已证伪的纯 Prompt 层守卫同构，只能作为 a/c 内部实现细节。
4. 两个关键不确定性需要在 plan 阶段针对性核实（当前报告已标注 `[推断]`/`⚠️`，不作为确定性结论呈现）：(a) F206 实际驱动 fix 模式全流程的评测 harness 入口脚本的具体 spawn 参数是否禁用 hooks；(b) 评测/用户实际加载的 plugin 是全局缓存（4.2.1）还是本仓库源码版，这直接决定本次改动对评测的可见性。

### 对产研汇总的建议

- 交叉分析应重点核实上述两个不确定性，它们是"方案 a 是否对目标评测场景真实有效"的前提性事实，而非锦上添花的细节
- Stop hook 的"会话自判"逻辑（风险清单 #2）与"死循环有界化"策略（风险清单 #4）应作为 plan 阶段的核心设计难点提前分配足够设计篇幅，这两处设计质量直接决定方案 a 是"精准拦截仪式坍塌"还是"误伤所有会话/无限阻塞用户"
- 建议 plan 阶段明确 c 方向的强制清单判定规则伪代码（复用 F204 `goal-loop-core.mjs` 完整性判定模式），并与 d 方向的轻量出口制品模板同步设计，避免两者规则不一致导致互相打架

Sources:
- [Automate actions with hooks - Claude Code Docs](https://code.claude.com/docs/en/hooks)
- [Get started with Claude Code hooks - Claude Code Docs](https://code.claude.com/docs/en/hooks-guide)
- [Run Claude Code programmatically - Claude Code Docs](https://code.claude.com/docs/en/headless)
- [Enforcing Compliance While Retaining Agency: A Rule-Based Policy Engine Approach for ReAct Agents](https://medium.com/commbank-technology/enforcing-compliance-while-retaining-agency-a-rule-based-policy-engine-approach-for-react-agents-a9a8a1b4a88c)
