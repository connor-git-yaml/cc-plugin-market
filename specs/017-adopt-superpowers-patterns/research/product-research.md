# 产品调研报告: 借鉴 Superpowers 模式与增强人工控制权

**特性分支**: `017-adopt-superpowers-patterns`
**调研日期**: 2026-02-27
**调研模式**: 在线（Perplexity + GitHub API）

## 1. 需求概述

**需求描述**: 调研 obra/superpowers 与 Spec Driver 的差异，吸取 superpowers 的优势点，并评估是否增加更多人工控制权（gates/checkpoints）机制。

**核心功能点**:
- 对比 superpowers vs Spec Driver 的工作流差异，识别 superpowers 优势特性
- 评估 superpowers 的 TDD 强制执行、双阶段代码审查、Git Worktree 隔离等模式
- 研究人工控制权（human-in-the-loop）在 AI 辅助开发中的最佳实践
- 为 Spec Driver 设计更灵活的门禁/检查点机制

**目标用户**: 使用 Claude Code 进行 Spec-Driven Development 的开发者、技术负责人和团队 Lead

## 2. 市场现状

### 市场趋势

AI 辅助开发领域正经历从"自由对话式编程"到"结构化编排驱动开发"的范式转变。2025-2026 年的关键趋势包括：

1. **Spec-Driven Development 成为主流**: 以规范文档为核心驱动开发流程，而非自由对话式 coding。Superpowers（64K+ stars）的快速增长验证了开发者对结构化工作流的强烈需求。

2. **子代理架构兴起**: Claude Code 原生支持子代理（每个拥有独立 200K token 上下文窗口），避免单一代理上下文污染导致的输出质量退化。这催生了"子代理驱动开发"（Subagent-Driven Development）范式。

3. **人工控制权分层化**: 从简单的"全自动/全手动"二选一，进化为三层模型：
   - Human-in-the-Loop (HITL): 关键检查点需人工批准
   - Human-on-the-Loop: 自主执行但人工可随时介入
   - Human-above-the-Loop: 人工设定战略边界，系统自治运行

4. **TDD 与 AI 的融合**: 测试驱动开发在 AI 编码中重新获得重视——TDD 提供了一种"可验证的约束"，使 AI 输出更可靠、可测试、可信任。

### 市场机会

- **控制权粒度化**: 当前多数工具要么全自动（Superpowers 的 subagent-driven-development 模式），要么过度依赖手动检查点。市场缺少**自适应门禁**——根据风险等级自动决定是否需要人工介入。
- **TDD 强制执行缺口**: Spec Driver 当前缺少 TDD 强制执行能力，而 Superpowers 将 RED-GREEN-REFACTOR 作为铁律（Iron Law）。
- **代码审查闭环**: 多数工具停留在"生成代码"阶段，缺少实现后的 Spec 合规审查 + 代码质量审查双阶段闭环。

### 用户痛点

- **AI 自主执行时偏离需求**: 长时间无人监督的 AI 实现容易逐步偏离原始规范，产生"需求漂移"
- **验证不充分就声称完成**: AI 经常在未实际运行验证命令的情况下声称"测试通过""构建成功"
- **上下文污染**: 单一代理长时间运行后，上下文窗口被填满，输出质量退化
- **缺少回滚安全网**: 在 main 分支上直接修改代码，没有 worktree 隔离，出错后难以回退
- **门禁节点不可配置**: 需要更多人工审查时无法灵活增加检查点，需要更少审查时无法跳过

## 3. 竞品分析

### 3.1 核心竞品深度分析：obra/superpowers

**项目概况**:
- GitHub Stars: 64,265+（截至 2026-02-27）
- 语言: Shell/Markdown（纯 Skill 文件，无运行时依赖）
- 创建: 2025-10-09，作者 Jesse Vincent (obra)
- 最新版本: v4.3.1 (2026-02-21)
- 支持平台: Claude Code, Cursor, Codex, OpenCode

**架构特点**:

Superpowers 采用**去中心化技能系统**，而非集中式编排器：

```text
superpowers/
  skills/              # 14 个技能（自动触发，非手动调用）
    brainstorming/     # 设计前的苏格拉底式对话
    writing-plans/     # 实现计划生成（2-5 分钟粒度任务）
    executing-plans/   # 批处理执行 + 检查点
    subagent-driven-development/  # 每任务独立子代理 + 双阶段审查
    test-driven-development/      # RED-GREEN-REFACTOR 铁律
    systematic-debugging/         # 4 阶段根因分析
    using-git-worktrees/          # 工作区隔离
    finishing-a-development-branch/  # 分支收尾 4 选项
    dispatching-parallel-agents/  # 并行子代理调度
    requesting-code-review/       # 代码审查
    receiving-code-review/        # 审查响应
    verification-before-completion/  # 完成前验证铁律
    writing-skills/               # 技能创建指南
    using-superpowers/            # 系统导览
  agents/              # 1 个专用代理
    code-reviewer.md   # 高级代码审查员
  commands/            # 3 个命令入口
    brainstorm.md      # 头脑风暴入口
    write-plan.md      # 计划编写入口
    execute-plan.md    # 计划执行入口
  hooks/               # Session 初始化钩子
  lib/                 # skills-core.js（技能发现引擎）
```

**核心工作流（7 阶段）**:

```text
Brainstorming → Git Worktree → Writing Plans → Subagent/Execute → TDD → Code Review → Branch Finish
   (交互式)     (自动隔离)    (计划生成)      (实现执行)     (强制)  (双阶段)    (4选项)
```

**Superpowers 关键优势特性**:

| 特性 | 详细描述 |
|------|---------|
| **TDD 铁律** | "NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST"——如果先写了实现代码再补测试，要求**删除代码从头来过**。不是建议，是强制规则 |
| **双阶段代码审查** | 每个任务完成后先 Spec Compliance Review（是否符合规范），再 Code Quality Review（代码质量），两个独立子代理分别执行 |
| **验证铁律** | "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE"——声称任何完成状态必须有**当前 message 内**运行的验证证据。"should pass"不算 |
| **Git Worktree 隔离** | 强制在隔离的 worktree 中开发，不允许在 main/master 分支直接修改（除非用户明确同意） |
| **设计硬门禁** | `<HARD-GATE>`: 在设计文档未被用户批准前，禁止任何实现行为。"每个项目都需要设计，包括'太简单'的项目" |
| **批量执行检查点** | executing-plans 模式每 3 个任务为一批，批次间暂停等待人工反馈 |
| **子代理上下文隔离** | 每个任务使用新鲜子代理，避免上下文污染。controller 提取完整任务文本，子代理无需读取计划文件 |
| **失败升级协议** | 子代理失败不手动修复（会导致上下文污染），而是 dispatch 新的 fix 子代理 |
| **架构质疑机制** | 连续 3 次修复失败后，不再尝试第 4 次修复，而是质疑架构——可能是架构错误而非代码错误 |
| **计划粒度** | 每个任务 2-5 分钟，包含精确文件路径、完整代码片段、预期验证输出 |
| **自动技能触发** | 技能根据上下文自动激活，开发者无需记忆命令 |

### 3.2 竞品对比矩阵

| 维度 | Superpowers (obra) | Spec Driver (我们) | TaskMaster AI | Roo Code |
|------|-------------------|-------------------|---------------|----------|
| **定位** | 编码代理技能框架 | 自治研发编排器 | AI 任务管理系统 | VS Code AI 代理团队 |
| **架构模式** | 去中心化技能系统（14 skills 自动触发） | 集中式编排器（12 子代理 + 4 质量门） | MCP Server + 任务依赖图 | 多模式切换（Orchestrator/Code/Architect/Debug） |
| **调研阶段** | 无（从 brainstorm 开始） | 有（产品调研 + 技术调研 + 综合分析） | 无 | 无 |
| **规范生成** | 设计文档（brainstorming 交互式） | 结构化 spec.md（子代理自动生成） | PRD 生成 | 无独立规范 |
| **计划粒度** | 2-5 分钟/任务，含完整代码 | User Story 级任务，含文件清单 | 10-20 任务，含依赖 | Orchestrator 分解 |
| **TDD 支持** | 铁律强制：RED-GREEN-REFACTOR，先写测试不可协商 | 无内置 TDD 机制 | 无 | 无 |
| **代码审查** | 双阶段：Spec Compliance + Code Quality，独立子代理审查 | 单层：verify 子代理 Spec-Code 对齐 + 工具链验证 | 无 | 无独立审查 |
| **人工检查点数量** | 3-5 个（设计批准、批次间反馈、分支收尾选择） | 2-4 个（调研确认、任务确认、验证结果，可配置） | 手动逐任务 | Orchestrator 级别 |
| **检查点可配置性** | 固定（技能自带） | 部分可配置（quality_gates.auto_continue_on_warning） | 无 | 无 |
| **Git 隔离** | 强制 Worktree + .gitignore 验证 | 特性分支（无 worktree 隔离） | 无 | 无 |
| **子代理架构** | 每任务新鲜子代理（上下文隔离） | 每阶段 Task 子代理（阶段级隔离） | 无子代理 | 模式切换（非子代理） |
| **验证严格度** | 铁律："NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION" | 建构/Lint/测试三层验证 | 无内置验证 | 无内置验证 |
| **失败处理** | 3 次失败→质疑架构→与用户讨论 | 重试 N 次→暂停→用户选择 | 无 | 无 |
| **恢复/续跑** | 无原生恢复机制 | speckit-resume 自动扫描断点续跑 | 无 | 无 |
| **跨平台** | Claude Code, Cursor, Codex, OpenCode | Claude Code 专属 | Cursor, Claude Code (MCP) | VS Code 专属 |
| **社区规模** | 64K+ stars | 早期阶段 | 中等（Cursor 生态） | 活跃（VS Code 生态） |
| **定价** | 免费开源 (MIT) | 免费开源 (MIT) | 免费开源 | 免费开源 |

### 3.3 差异化机会

基于竞品分析，识别以下差异化机会：

1. **调研驱动的差异化壁垒**: Spec Driver 是唯一提供产品调研 + 技术调研 + 综合分析的工具。Superpowers 从 brainstorm 开始（假设开发者已了解市场），TaskMaster 从 PRD 开始。我们的调研阶段是显著差异化优势。

2. **TDD 强制执行机制（来自 Superpowers）**: Superpowers 的 TDD 铁律是其最受认可的特性之一。Spec Driver 当前完全缺少 TDD 支持，这是一个重大能力缺口。

3. **双阶段代码审查（来自 Superpowers）**: 将验证拆分为 Spec Compliance Review + Code Quality Review 两个独立阶段，比我们的单层 verify 更精细、更可靠。

4. **验证铁律（来自 Superpowers）**: "No completion claims without fresh verification evidence" 是一个重要的质量文化理念，当前 Spec Driver 的 verify 子代理未强制此行为。

5. **自适应门禁系统**: Superpowers 门禁固定不可配置；Spec Driver 部分可配置但粒度不够。市场空白在于**风险自适应门禁**——根据变更的 blast radius、代码复杂度、业务关键性动态决定人工介入级别。

6. **Git Worktree 隔离**: Superpowers 强制 worktree 隔离是其"安全开发"哲学的关键环节。Spec Driver 仅使用特性分支，缺少物理隔离。

7. **断点恢复 + 阶段重跑**: Spec Driver 的 speckit-resume 和 `--rerun` 机制是 Superpowers 不具备的能力。这是我们的独有优势。

8. **多平台支持 vs 深度集成**: Superpowers 支持 4 个平台但深度有限，Spec Driver 深度绑定 Claude Code 但可以利用所有 Claude Code 原生能力。

## 4. 用户场景验证

### 核心用户角色

**Persona 1: 技术负责人 Alex（Tech Lead）**
- 背景: 带领 5-8 人团队，使用 Claude Code 加速团队开发
- 目标: 确保 AI 生成代码符合团队标准，关键决策有人工把关
- 痛点: 当前 Spec Driver 的质量门粒度不够——想对高风险模块（支付、认证）增加审查点，对低风险模块（UI 调整）减少审查
- 期望: 可配置的门禁策略，根据变更类型和风险等级自动调整

**Persona 2: 独立开发者 Sam（Solo Dev）**
- 背景: 独立开发者，使用 Claude Code 快速原型和小项目
- 目标: 最大化自动化效率，尽量减少中断
- 痛点: 有时质量门太多导致频繁中断，有时又希望在关键部分加入检查点
- 期望: "快速模式"跳过非关键门禁，但保留关键验证

**Persona 3: 质量工程师 Jordan**
- 背景: 负责团队代码质量和流程合规
- 目标: 确保 AI 生成代码有测试覆盖、通过审查、符合规范
- 痛点: 当前没有 TDD 强制执行，verify 阶段只做 Spec-Code 对齐和工具链检查，缺少代码质量审查
- 期望: TDD 强制执行 + 双阶段审查（Spec 合规 + 代码质量）

### 关键用户旅程：需要更多人工控制权的场景

**场景 1: 高风险模块实现**
```text
用户需求: "为支付系统添加退款功能"

当前 Spec Driver 流程:
  调研 → 规范 → 规划 → [GATE_TASKS: 用户确认] → 实现(全自动) → 验证

期望流程:
  调研 → 规范 → 规划 → [GATE_TASKS: 用户确认]
  → 实现 Task 1 → [GATE_TASK_REVIEW: Spec 合规审查]
  → 实现 Task 2 → [GATE_TASK_REVIEW: Spec 合规审查]
  → [GATE_CODE_QUALITY: 代码质量审查]
  → 验证 → [GATE_VERIFY: 用户确认]
```

**场景 2: 快速迭代低风险变更**
```text
用户需求: "给设置页面添加暗色模式切换"

当前 Spec Driver (story 模式):
  上下文分析 → 规范 → 规划 → [GATE_TASKS] → 实现 → 验证

期望流程:
  上下文分析 → 规范 → 规划 → 实现 → 验证（跳过所有手动门禁）
```

**场景 3: 实现过程中发现问题需要人工介入**
```text
实现 Task 3 时发现数据模型与 plan.md 不一致

当前行为: 实现子代理尝试自行解决或静默跳过
期望行为: 自动暂停，展示不一致点，请求用户决策
```

### 需求假设验证

| 假设 | 验证结果 | 证据 |
|------|---------|------|
| 开发者需要 TDD 支持 | ✅ 已验证 | Superpowers 64K+ stars，TDD 是其核心卖点之一；社区反馈 TDD 降低了 AI 代码的错误率 |
| 双阶段审查比单层验证更有效 | ✅ 已验证 | Superpowers 的 subagent-driven-development 实证显示双阶段审查（Spec + Quality）可在早期捕获需求偏差和代码质量问题 |
| 用户需要可配置的门禁粒度 | ✅ 已验证 | 市场调研显示三层人工控制模型（HITL/HOTL/HATL）是 2025-2026 的共识趋势；固定门禁导致"prompt fatigue" |
| Git Worktree 隔离有实际价值 | ⚠️ 待确认 | Superpowers 强制使用 worktree，但对于 Claude Code 用户习惯是否匹配需进一步验证 |
| 验证铁律能显著提升输出质量 | ✅ 已验证 | Superpowers 的 verification-before-completion 直接源自 24 次失败记忆——用户曾多次因未验证而浪费时间 |
| 自适应门禁优于固定门禁 | ⚠️ 待确认 [推断] | 理论上成立（confidence-adaptive gates），但无直接竞品实现案例可参考 |

## 5. MVP 范围建议

### 从 Superpowers 借鉴的特性优先级排序

#### Must-have（MVP 核心）

1. **验证铁律机制**
   - 在 implement 和 verify 子代理中植入"完成声明必须有新鲜验证证据"的硬规则
   - 禁止使用 "should pass"、"looks correct" 等未验证表述
   - 预估工作量: 低（prompt 工程为主）

2. **双阶段代码审查**
   - 将 verify 子代理拆分为 Spec Compliance Review + Code Quality Review 两个独立阶段
   - Spec Compliance: 逐条 FR 检查是否实现、是否过度实现
   - Code Quality: 设计模式、安全性、性能、可维护性
   - 预估工作量: 中（新增子代理 prompt + 编排逻辑调整）

3. **门禁粒度增强（风险分级）**
   - 在 spec-driver.config.yaml 中新增 `gate_policy` 配置
   - 支持三个级别: `strict`（所有门禁暂停）、`balanced`（默认，关键门禁暂停）、`autonomous`（仅失败时暂停）
   - 每个质量门可独立配置 `auto_continue: true/false`
   - 预估工作量: 中（配置扩展 + 编排逻辑条件化）

4. **设计硬门禁（HARD-GATE）**
   - 在 brainstorm/specify 阶段增加硬门禁：设计文档未被用户明确批准前，禁止进入 plan 阶段
   - 借鉴 Superpowers 的 `<HARD-GATE>` 模式
   - 预估工作量: 低（prompt 工程 + 编排逻辑）

#### Nice-to-have（二期）

5. **TDD 强制执行模式**
   - 在 implement 子代理中增加可选的 TDD 模式（`tdd_mode: enforced | recommended | off`）
   - Enforced: 必须先写测试再写实现，否则拒绝继续
   - Recommended: 提醒但不阻断
   - 需要增加 TDD 相关的 skill/prompt
   - 预估工作量: 中-高（新增 TDD skill + implement 子代理重构）

6. **任务级检查点（Batch Execution）**
   - 实现类似 Superpowers 的"每 N 个任务暂停等待反馈"机制
   - 可配置 batch_size（默认 3）
   - 批次间展示完成摘要 + 等待用户反馈
   - 预估工作量: 中（implement 子代理拆分为批处理模式）

7. **Git Worktree 隔离**
   - 在 speckit-feature 初始化阶段自动创建 worktree
   - 完成后提供 merge/PR/keep/discard 四个选项
   - 预估工作量: 中（集成 Claude Code 原生 worktree 支持）

8. **子代理上下文隔离增强**
   - 将 implement 子代理从"一次性执行全部任务"改为"每任务新鲜子代理"
   - controller 预提取完整任务文本，子代理无需自行读取 tasks.md
   - 预估工作量: 高（编排架构调整）

#### Future（远期）

9. **自适应门禁引擎**
   - 根据变更 blast radius（影响文件数、修改行数）、代码区域敏感度（auth/payment vs UI）、历史错误率动态调整门禁级别
   - 需要构建风险评估模型
   - 预估工作量: 高

10. **并行子代理调度**
    - 借鉴 Superpowers 的 dispatching-parallel-agents，对独立任务并行执行
    - 当前 Spec Driver 的 [P] 标记任务在概念上支持并行，但实际串行执行
    - 预估工作量: 高（依赖 Claude Code 的并行 Task 能力）

11. **架构质疑机制**
    - 连续 N 次修复失败后，自动触发"是否应该质疑当前架构"的讨论
    - 预估工作量: 低-中（prompt 工程 + 失败计数逻辑）

12. **技能自动触发机制**
    - 类似 Superpowers 的技能自动发现和触发，而非显式命令调用
    - 预估工作量: 高（需要 SessionStart hook + 技能匹配引擎）

### 优先级排序理由

Must-have 的 4 个特性选择基于以下原则：

1. **投入产出比最高**: 验证铁律和设计硬门禁主要是 prompt 工程，改动小但质量提升显著
2. **最直接的竞品差距**: 双阶段审查是 Superpowers 最受认可的质量机制，我们缺失它是明显短板
3. **用户反馈最强烈**: 门禁粒度不足是三个 Persona 共同的痛点
4. **与现有架构兼容**: 这 4 个特性不需要大规模重构编排器，可以增量引入

## 6. 结论与建议

### 总结

通过对 Superpowers 的深度分析和 4 个竞品的横向对比，核心发现如下：

**Superpowers 的哲学差异**: Superpowers 是**行为约束框架**——通过铁律（Iron Laws）、硬门禁（Hard Gates）、强制流程来约束 AI 行为。它不编排，而是"教化"。Spec Driver 是**流程编排器**——通过阶段化的子代理委派和质量门来自动化开发流程。两者的核心差异不在工具，而在设计哲学。

**互补而非替代**: Superpowers 的优势（TDD 强制、验证铁律、双阶段审查、上下文隔离）可以作为"质量约束层"嫁接到 Spec Driver 的"流程编排层"之上。我们的优势（调研阶段、结构化规范、断点恢复、阶段重跑）是 Superpowers 不具备的。

**人工控制权的最佳实践**: 不是"更多门禁"或"更少门禁"，而是**正确的门禁在正确的位置**。建议实现三级门禁策略（strict/balanced/autonomous）+ 每门禁可独立配置。

### 对技术调研的建议

- **调研 Claude Code 子代理 API**: 评估当前 Task tool 是否支持"每任务新鲜子代理"模式，以及并行 Task 调用的稳定性
- **调研 Claude Code Hooks 机制**: 评估 PreToolUse/PostToolUse hooks 是否可用于实现验证铁律（拦截未验证的完成声明）
- **调研 Claude Code Worktree 原生支持**: 评估 EnterWorktree 工具的成熟度和 spec-driver 集成路径
- **调研 spec-driver.config.yaml 扩展方案**: 设计 gate_policy 配置结构，确保向后兼容
- **评估 prompt 注入的 TDD 模式**: 在不增加新运行时依赖的前提下，仅通过 prompt 工程实现 TDD 强制执行

### 风险与不确定性

- **Prompt 工程的可靠性风险**: 验证铁律和 TDD 强制执行依赖 prompt 遵从性，LLM 可能在特定情况下忽略约束。缓解: 多层冗余——prompt 约束 + hooks 拦截 + verify 子代理二次验证
- **编排复杂度膨胀**: 增加双阶段审查和门禁配置会显著增加编排逻辑的复杂度。缓解: 增量引入，先实现 prompt 层面的改进，再逐步增加编排层的支持
- **用户体验退化**: 过多的门禁和检查点可能导致用户体验碎片化。缓解: 默认 `balanced` 模式，只在关键门禁暂停；提供 `autonomous` 模式给追求效率的用户
- **与 Superpowers 生态的兼容性**: [推断] 如果用户同时安装了 Superpowers 和 Spec Driver，两者的行为约束可能冲突。缓解: 后续评估共存策略
