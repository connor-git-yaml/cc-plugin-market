# Delegation Contract — 委派硬约束（单一事实源，M8 F185）

> **本文件是 spec-driver「编排器必须委派子代理」硬约束块的 canonical source。**
>
> 消费方（5 个主编排器 SKILL.md，禁止各自手写漂移）：
> `skills/{spec-driver-fix,spec-driver-story,spec-driver-feature,spec-driver-implement,spec-driver-resume}/SKILL.md`
> ——由 `scripts/sync-delegation-contract.mjs --write` 按各 SKILL 的注入锚点，把下方 `block-start`/`block-end`
> 之间的内容**原样**嵌入 `<!-- BEGIN delegation-contract -->` / `<!-- END delegation-contract -->` 之间。
> `.codex/skills/*` wrapper 由 `repo:sync` 的 `spec-driver-codex-wrappers` 步骤从源 SKILL **逐行复制**
> body 再生，故注入步骤必须排在 wrapper 再生**之前**（见 `scripts/lib/repo-maintenance-core.mjs`）。
>
> **修改流程**：改下方 `block-start`/`block-end` 之间的内容 → 跑 `npm run repo:sync`（注入 5 SKILL
> 并再生 .codex wrapper）→ 跑 `npm run repo:check`（含 `delegation-contract:skill-block-sync` /
> `delegation-contract:codex-wrapper-block-sync` 漂移检测 + `orchestrator-model:orchestrator-model-<m>`
> model=opus 断言 + `orchestrator-model:orchestrator-task-coverage` 漏网守护）。
>
> **背景**：F176 实测 sonnet 编排器对 "MUST 委派" 指令 0 服从（确定性 inline 化）；4.2.1 的硬约束块
> 只盖 fix 一处，story/feature/implement 仍是描述性措辞、resume 连块都没有且 frontmatter 还是 sonnet。
> 本块把契约工程化为单一事实源 + sync 注入 + check 守护，杜绝散文复制态漂移。

<!-- delegation-contract:block-start -->
> **委派硬约束（不可豁免 · 由 `templates/delegation-contract.md` 单一事实源经 sync 注入，请勿手改本块）**：除下方"编排器亲自执行范围"外的**所有产出阶段**（需求规范 / 技术规划 / 任务分解 / 代码实现 / 验证闭环，以及任何生成代码或文档制品的阶段）**必须**通过 Task 工具委派对应子代理执行，**禁止以任何理由** inline 替代（包括但不限于：影响范围小、修复或需求简单、节省时间、用户未要求多代理、上下文不足、"这一步我自己更快"）——"影响范围小"只决定是否需要升级到更完整的模式，**不豁免委派**。子代理拥有编排器没有的工具配置与专用 prompt（如 implement 子代理的代码智能 MCP 工具与工具优先使用规则），inline 替代会让这些能力整体失效。
>
> **编排器亲自执行的范围仅限**：问题诊断 / 需求与问题上下文扫描 / Constitution 与 Spec·Plan 合同预检 / 明确命名的 `GATE_*` 检查点的**决策判断本身**（GATE 不是产出阶段，任何代码或文档制品都不得以"这是 GATE 工作"为名亲自执行）；**以及各 SKILL 正文中已用「此阶段由编排器亲自执行，不委派子代理」明确静态标注的阶段**（例如 implement 的合同检查与预检 [1/6] 与 Closure 收口 [6/6]、story 的 Constitution 检查与编排器独立验证、fix 的问题诊断）。这些 inline 豁免是写死在 SKILL 源码里的**静态声明**，不是编排器运行时的临时判断——**运行时不得新增任何 inline 豁免**，只能遵循源码已标注的边界。
>
> **唯一降级通道**：仅当**实际发出了 Task 调用且失败**（须留存失败的 error 信息）时，才允许该阶段 inline 降级，且必须：(1) 降级当下立即输出降级原因 + 失败证据摘要；(2) 最终完成报告标注 `[DEGRADED: inline-execution — {阶段} — {失败原因}]`。未实际尝试 Task 而直接 inline = 违反本约束，不存在其他豁免。
<!-- delegation-contract:block-end -->
