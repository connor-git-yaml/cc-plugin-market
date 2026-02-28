# 技术调研报告: 借鉴 Superpowers 模式与增强人工控制权

**特性分支**: `017-adopt-superpowers-patterns`
**调研日期**: 2026-02-27
**调研模式**: 在线（Perplexity + GitHub API + 本地代码分析）
**产品调研基础**: [product-research.md](product-research.md)

## 1. 调研目标

**核心问题**:
- 如何将 Superpowers 的"行为约束框架"理念融入 Spec Driver 的"流程编排器"架构？
- Claude Code 子代理 API（Task tool）对"每任务新鲜子代理"的支持度如何？
- PreToolUse/PostToolUse hooks 实现验证铁律的可行性和成熟度
- EnterWorktree 原生支持与 spec-driver 集成路径
- spec-driver.config.yaml 的 gate_policy 扩展方案设计
- 门禁粒度增强（strict/balanced/autonomous）的技术实现路径

**产品 MVP 范围（来自产品调研）**:
- Must-have 1: 验证铁律机制——完成声明必须有新鲜验证证据
- Must-have 2: 双阶段代码审查——Spec Compliance Review + Code Quality Review
- Must-have 3: 门禁粒度增强——三级策略（strict/balanced/autonomous）+ 每门禁独立配置
- Must-have 4: 设计硬门禁（HARD-GATE）——设计文档未批准前禁止进入 plan 阶段

## 2. 架构方案对比

### 方案 A: 纯 Prompt 工程增强

**概述**: 将 Superpowers 的所有约束理念（验证铁律、双阶段审查、设计硬门禁）完全通过修改子代理 prompt 模板和编排器指令来实现。不引入 Claude Code hooks，不修改运行时架构。

**实现路径**:
1. **验证铁律**: 在 implement.md 和 verify.md 的 prompt 中植入铁律规则段落（类似 Superpowers 的 `verification-before-completion/SKILL.md` 中的约束文本），要求子代理在声称完成前必须展示当前 message 内运行的验证命令输出
2. **双阶段审查**: 将现有 verify.md 拆分为 `spec-review.md`（Spec Compliance Review 子代理）和 `quality-review.md`（Code Quality Review 子代理），编排器在 Phase 7 依次调用两个 Task
3. **门禁策略**: 在编排器 SKILL.md 中增加条件分支逻辑，根据 spec-driver.config.yaml 的 `gate_policy` 字段决定每个质量门是暂停还是自动继续
4. **设计硬门禁**: 在 specify.md 的 prompt 中植入 `<HARD-GATE>` 标记，编排器在 Phase 2 完成后强制暂停等待用户确认

**优势**:
- 零运行时依赖变更，完全在 Markdown prompt 层面操作
- 与现有 spec-driver 的纯 Markdown plugin 架构完全一致
- 实现周期短（预估 2-3 天），可快速验证效果
- 回退成本极低——恢复原 prompt 即可

**劣势**:
- Prompt 遵从性不可强制保证——LLM 在长上下文或复杂任务中可能"忽略"铁律约束
- 没有运行时拦截能力，无法在子代理违规时自动阻断
- 验证铁律的"证据检查"只能依赖 LLM 自我约束，无法程序化验证

### 方案 B: Hooks + Prompt 混合架构（推荐）

**概述**: 以 Prompt 工程增强为基础，叠加 Claude Code 原生 hooks 机制实现关键约束的运行时验证。Prompt 层负责"教化"（引导子代理遵循最佳实践），Hooks 层负责"执法"（拦截违规行为）。

**实现路径**:
1. **Prompt 层**（与方案 A 相同）:
   - 修改 implement.md、verify.md 植入验证铁律
   - 新增 spec-review.md 和 quality-review.md 实现双阶段审查
   - 编排器增加 gate_policy 条件分支
   - specify.md 增加 `<HARD-GATE>` 标记

2. **Hooks 层**（增量引入）:
   - **PreToolUse hook（验证铁律执法器）**: 在 `.claude/settings.json` 中配置 PreToolUse hook，匹配 `Bash` 工具调用，当检测到 `git commit` 或 `git push` 命令时，检查当前会话中是否已执行过验证命令（build/test/lint）。如未执行，返回 `deny` + 理由 "验证铁律：提交前必须运行验证命令"
   - **PostToolUse hook（验证证据收集器）**: 匹配 `Bash` 工具调用，当命令包含 `npm test`、`npm run build`、`vitest` 等验证命令时，记录执行时间戳和退出码到临时文件（`.claude/verification-evidence.json`），供 PreToolUse hook 和 verify 子代理引用

3. **gate_policy 配置扩展**:
   ```yaml
   # spec-driver.config.yaml 新增字段
   gate_policy: balanced  # strict | balanced | autonomous

   gates:
     GATE_RESEARCH:
       pause: true           # balanced 默认值
       strict_override: true  # strict 模式下强制暂停
       autonomous_override: false  # autonomous 模式下自动继续
     GATE_DESIGN:            # 新增：设计硬门禁
       pause: true
       strict_override: true
       autonomous_override: true  # 即使 autonomous 也暂停（硬门禁）
     GATE_TASKS:
       pause: true
       strict_override: true
       autonomous_override: false
     GATE_VERIFY:
       pause: true
       strict_override: true
       autonomous_override: false
   ```

4. **Worktree 集成**（可选，二期）:
   - 在编排器初始化阶段检查 `gate_policy`，如果为 `strict` 模式，自动通过 `EnterWorktree` 创建隔离工作区
   - 完成后提供 merge/PR/keep/discard 四个选项

**优势**:
- 双层防线：Prompt 引导 + Hooks 执法，显著降低 LLM 忽略约束的风险
- 利用 Claude Code 原生机制，不引入额外运行时依赖
- Hooks 可渐进式引入——先实现 Prompt 层，效果不足再叠加 Hooks
- gate_policy 配置向后兼容——不影响现有 spec-driver.config.yaml 用户

**劣势**:
- Hooks 配置需要用户在 `.claude/settings.json` 中手动启用（或由 init-project.sh 自动注入）
- Hooks 脚本的调试和维护成本高于纯 Prompt 方案
- PreToolUse hooks 所有匹配项并行执行，hook 间不能相互依赖
- Hooks 机制的向后兼容性依赖 Claude Code 的 API 稳定性

### 方案 C: 完整子代理架构重构

**概述**: 参照 Superpowers 的"每任务新鲜子代理"模式，将 implement 阶段从"一个子代理执行全部任务"改为"每个 task 启动一个新鲜子代理"，controller（编排器）预提取完整任务文本注入子代理上下文。

**实现路径**:
1. 编排器在 Phase 6 解析 tasks.md，逐个 task 调用 Task tool
2. 每个 task 子代理接收完整的任务描述、文件路径、代码片段
3. 每个 task 完成后，编排器执行 Spec Compliance 快速检查
4. 每 N 个 task（可配置 batch_size）暂停等待用户反馈

**优势**:
- 完全消除上下文污染问题
- 每个任务的输出质量更高更稳定
- 天然支持任务级检查点和批量执行

**劣势**:
- 架构变动巨大，需要重写编排器核心逻辑
- 子代理启动开销大（每个 Task 调用 ~3-5 秒），N 个任务的总耗时显著增加
- 子代理间状态传递困难——后续任务需要前序任务的代码变更上下文
- 当前 Claude Code Task tool 并行上限约 10 个 [推断]，超出需排队
- 实现周期长（预估 2-3 周），风险高

### 方案对比表

| 维度 | 方案 A: 纯 Prompt 工程 | 方案 B: Hooks + Prompt 混合 | 方案 C: 子代理架构重构 |
|------|----------------------|---------------------------|---------------------|
| 概述 | 仅修改 Markdown prompt | Prompt 增强 + Claude Code hooks | 每任务新鲜子代理 + 编排器重构 |
| 性能影响 | 无 | 极低（hooks 脚本 <100ms） | 高（每任务额外 3-5s 启动开销） |
| 可维护性 | 高（纯 Markdown） | 中-高（Markdown + Shell scripts） | 低（复杂编排逻辑） |
| 学习曲线 | 低（仅需理解 prompt 结构） | 中（需理解 hooks 配置） | 高（需理解子代理编排） |
| 社区支持 | 高（prompt 工程成熟） | 中-高（Claude Code hooks 文档完善） | 低（无成熟参考实现） |
| 适用规模 | 小-中型需求 | 所有规模 | 大型复杂需求 |
| 与现有项目兼容性 | 完全兼容 | 向后兼容（增量引入） | 需重构（破坏性变更） |
| 约束执行可靠性 | 中（依赖 LLM 遵从） | 高（Prompt + Hooks 双层） | 高（架构级保证） |
| 实现周期 | 2-3 天 | 5-7 天 | 2-3 周 |
| 回退风险 | 极低 | 低 | 高 |
| MVP 覆盖度 | 4/4（全覆盖） | 4/4（全覆盖） | 4/4（全覆盖但过度实现） |

### 推荐方案

**推荐**: 方案 B — Hooks + Prompt 混合架构

**理由**:
1. **最佳投入产出比**: 在方案 A 的基础上仅增加约 2-4 天工作量，即可获得运行时执法能力，显著提升约束执行可靠性
2. **渐进式引入**: 可先交付方案 A 的 Prompt 增强部分（2-3 天），再叠加 Hooks 层（2-4 天），降低单次变更风险
3. **利用原生能力**: Claude Code 的 hooks 机制已稳定（2025 年 Q4 发布，2026 年 Q1 持续迭代），是平台鼓励的扩展方式
4. **向后兼容**: 不修改现有 spec-driver.config.yaml 结构（仅新增字段），不修改现有子代理的核心逻辑（仅增强 prompt）
5. **为方案 C 铺路**: 方案 B 的 gate_policy 机制和双阶段审查可在未来无缝演进到方案 C 的每任务子代理模式

**不推荐方案 C 的原因**: 虽然方案 C 是 Superpowers 的核心架构模式，但对 Spec Driver 而言属于过度工程。Spec Driver 的价值在于"调研驱动 + 流程编排"，而非 Superpowers 的"行为约束"。方案 B 已能吸收 Superpowers 的核心质量理念，无需复制其架构。

## 3. 依赖库评估

### 评估矩阵

本次特性的核心设计原则是**零新增运行时依赖**。所有能力均通过以下方式实现：

| 技术能力 | 实现方式 | 依赖 | 是否新增 | 评级 |
|---------|---------|------|---------|------|
| 验证铁律 prompt | Markdown 模板修改 | 无 | 否 | N/A |
| 双阶段审查 | 新增 2 个子代理 Markdown | 无 | 否 | N/A |
| 门禁策略配置 | spec-driver.config.yaml 扩展 | YAML 解析（编排器内置） | 否 | N/A |
| PreToolUse hook | Shell 脚本 + jq | jq（系统工具） | 否（macOS/Linux 预装或 Claude Code 环境已含） | N/A |
| PostToolUse hook | Shell 脚本 + jq | jq（系统工具） | 否 | N/A |
| Worktree 集成 | Claude Code EnterWorktree 原生工具 | 无 | 否 | N/A |
| 验证证据存储 | JSON 文件（`.claude/verification-evidence.json`） | Node.js fs（内置） | 否 | N/A |

### 关键技术能力评估

#### Claude Code Hooks API

| 评估维度 | 评估结果 |
|---------|---------|
| API 稳定性 | 稳定。2025 Q4 发布，2026 Q1 持续迭代。`/hooks` CLI 菜单已集成 |
| 配置方式 | `~/.claude/settings.json`（全局）或 `.claude/settings.json`（项目级），支持 `.claude/settings.local.json`（gitignored） |
| 事件类型 | PreToolUse（工具调用前，可 allow/deny/ask）、PostToolUse（工具完成后，可反馈/日志） |
| 匹配器 | 按 tool_name 匹配（支持 `*` 通配符），如 `"Bash"`、`"Edit|Write"` |
| 输入格式 | JSON via stdin：`{"tool_name": "Bash", "tool_input": {"command": "..."}}`  |
| 输出格式 | PreToolUse: exit 2 阻断，或 exit 0 + JSON `{hookSpecificOutput: {permissionDecision: "deny"}}` |
| 并行执行 | 所有匹配 hooks 并行执行，不能互相依赖 |
| 风险点 | hook 脚本需要 `chmod +x`；Windows 兼容性存在已知问题 |

#### Claude Code Task Tool（子代理 API）

| 评估维度 | 评估结果 |
|---------|---------|
| 上下文隔离 | 每个 Task 子代理拥有独立的 200K token 上下文窗口，不与主代理共享 |
| 模型选择 | 支持通过 `model` 参数指定 sonnet 或 opus |
| 并行能力 | 支持并发调用，上限约 10 个 [推断]，超出排队 |
| 工具权限 | 子代理可配置独立工具集（如只读 Read/Grep/Glob） |
| 状态传递 | 子代理返回文本结果到主代理，无共享内存 |
| 2026 更新 | Opus 4.6 增强 agent teams 多会话并行、上下文压缩、自适应 effort |

#### Claude Code EnterWorktree

| 评估维度 | 评估结果 |
|---------|---------|
| 触发方式 | CLI `--worktree` flag 或会话内 `EnterWorktree` 工具 |
| 工作区位置 | `.claude/worktrees/{name}/`，自动创建新分支 |
| 清理策略 | 无变更自动删除；有变更提示 keep/remove |
| 子代理支持 | 支持 `isolation: worktree` 配置 [推断] |
| 限制 | 必须在 git 仓库中；非 git 环境需自定义 hooks |
| 成熟度 | 2026 年 2 月已稳定，Desktop 应用原生支持 |

### 推荐依赖集

**核心依赖**: 无新增。全部通过以下现有能力实现：
- **Markdown prompt 文件**: 验证铁律、双阶段审查、设计硬门禁
- **YAML 配置扩展**: gate_policy、gates 配置
- **Shell 脚本 + jq**: hooks 实现
- **Claude Code 原生工具**: Task tool（子代理）、EnterWorktree（worktree 集成）

**可选依赖**: 无

### 与现有项目的兼容性

| 现有依赖 | 兼容性 | 说明 |
|---------|--------|------|
| @anthropic-ai/sdk ^0.39.0 | 兼容 | 不直接使用，编排器通过 Claude Code Task tool 间接调用 |
| ts-morph ^24.0.0 | 兼容 | 本特性不涉及 AST 分析 |
| dependency-cruiser ^16.8.0 | 兼容 | 本特性不涉及依赖图分析 |
| handlebars ^4.7.8 | 兼容 | 本特性不涉及模板渲染 |
| zod ^3.24.1 | 兼容 | 本特性不涉及 schema 验证 |
| TypeScript 5.7.3 | 兼容 | 本特性主要是 Markdown/YAML/Shell 变更，不涉及 TS 代码 |
| Node.js >=20.0.0 | 兼容 | 本特性不涉及 Node.js API 调用 |

## 4. 设计模式推荐

### 推荐模式

#### 1. Strategy Pattern（策略模式）——门禁策略三级切换

**适用场景**: 实现 `gate_policy` 三级策略（strict/balanced/autonomous），每个质量门根据策略决定行为。

**设计思路**:

```text
编排器读取 gate_policy → 实例化对应策略 → 每个质量门调用策略决策

gate_policy: strict
  → StrictGateStrategy: 所有门禁暂停，等待用户确认

gate_policy: balanced（默认）
  → BalancedGateStrategy: 关键门禁暂停（GATE_DESIGN、GATE_TASKS、GATE_VERIFY）
    非关键门禁自动继续（GATE_RESEARCH 仅在有 CRITICAL 时暂停）

gate_policy: autonomous
  → AutonomousGateStrategy: 仅失败时暂停
    GATE_DESIGN 除外（硬门禁始终暂停）
```

**在 Spec Driver 中的实现**: 由于 Spec Driver 的编排器是 Markdown prompt（非 TypeScript 代码），策略模式通过编排器 prompt 中的条件分支逻辑实现：

```markdown
## 质量门决策逻辑

读取 spec-driver.config.yaml 的 gate_policy 值。

对于每个质量门 {GATE_NAME}:
  1. 检查 gates.{GATE_NAME}.pause 配置
  2. 根据 gate_policy 应用覆盖:
     - strict: 使用 strict_override（通常为 true）
     - balanced: 使用默认 pause 值
     - autonomous: 使用 autonomous_override（通常为 false）
  3. 如果最终决策为 pause=true → 暂停展示结果，等待用户选择
  4. 如果最终决策为 pause=false → 自动继续（仅在日志中记录）
```

**应用案例**: LangGraph 的 interrupt/human-in-the-loop 机制、Microsoft AutoGen 的 nested chat with human proxy、Superpowers 的 `<HARD-GATE>` 模式均采用类似策略选择逻辑。

#### 2. Chain of Responsibility（责任链模式）——验证铁律链

**适用场景**: 实现验证铁律的多层检查——Prompt 约束 → Hooks 拦截 → verify 子代理二次验证。

**设计思路**:

```text
Layer 1: Prompt 约束（implement/verify 子代理内置铁律文本）
  ↓ 如果 LLM 忽略约束
Layer 2: Hooks 拦截（PreToolUse hook 检测未验证的 git commit）
  ↓ 如果 hooks 未配置或被绕过
Layer 3: verify 子代理二次验证（检查验证证据文件）
  ↓ 如果仍然缺少证据
Layer 4: GATE_VERIFY 暂停（编排器强制暂停，要求人工确认）
```

**在 Spec Driver 中的实现**:
- Layer 1: 在 implement.md 中增加铁律规则段落
- Layer 2: 在 `.claude/settings.json` 中配置 PreToolUse hook
- Layer 3: 在 verify.md 中增加"验证证据检查"步骤
- Layer 4: 编排器现有的 GATE_VERIFY 机制

**应用案例**: Superpowers 的 verification-before-completion 使用单层 prompt 约束（Layer 1）；方案 B 增加了 3 层冗余，显著提升可靠性。

#### 3. Observer Pattern（观察者模式）——门禁事件通知

**适用场景**: 门禁触发时通知多个关注方（日志、进度输出、可选的外部 webhook）。

**设计思路**:

```text
质量门触发 → GateEvent(gate_name, decision, reason, timestamp)
  → Observer 1: 进度输出（show_stage_progress）
  → Observer 2: 门禁日志（写入 verification-evidence.json）
  → Observer 3: [Future] 外部通知（webhook/Slack）
```

**在 Spec Driver 中的实现**: 当前编排器已有 `progress.show_stage_progress` 和 `progress.show_stage_summary` 配置。门禁事件通知可作为其自然扩展——在每个质量门决策点输出格式化的事件信息：

```text
[GATE] GATE_TASKS | policy=balanced | decision=PAUSE | 等待用户确认任务分解...
[GATE] GATE_VERIFY | policy=autonomous | decision=AUTO_CONTINUE | 构建和测试通过
```

**应用案例**: GitHub Actions 的 check runs 通知模型、Kubernetes admission controller 的审计日志模式。

### 适用性与风险评估

| 模式 | 适用性 | 实现复杂度 | 风险 |
|------|--------|-----------|------|
| Strategy Pattern | 高——门禁策略是核心需求 | 低（Markdown 条件分支） | 低——逻辑简单明确 |
| Chain of Responsibility | 高——验证铁律需要多层保障 | 中（涉及 Prompt + Hooks + Config） | 中——多层之间的协调需要仔细设计 |
| Observer Pattern | 中——MVP 阶段可简化为直接日志 | 低 | 低——不影响核心流程 |

## 5. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | **Prompt 遵从性不可靠**: LLM 在复杂上下文中可能忽略验证铁律约束，尤其在长时间运行的 implement 阶段 | 中 | 高 | 方案 B 的多层防线（Prompt + Hooks + verify 子代理）；铁律文本使用大写强调和明确的禁止/允许列表；参考 Superpowers 的 "excuse vs reality" 对照表格式 |
| 2 | **Hooks 机制向后兼容性**: Claude Code hooks API 尚处于迭代期（2025 Q4 发布），未来版本可能变更配置格式或行为 | 低 | 中 | Hooks 作为增强层而非核心依赖——即使 hooks 失效，Prompt 层仍能提供基本保障；hooks 脚本保持简单、无状态，降低维护成本 |
| 3 | **配置复杂度膨胀**: gate_policy + gates 独立配置 + verification commands 叠加，spec-driver.config.yaml 变得难以理解 | 中 | 中 | 提供合理的默认值（balanced + 内置门禁策略），用户只需修改 gate_policy 一个字段即可切换；init-project.sh 提供交互式配置引导；gate 配置使用约定优于配置原则 |
| 4 | **双阶段审查延长流程时间**: 新增 Spec Compliance Review 子代理约增加 1-2 分钟，整体流程拉长 | 中 | 低 | autonomous 模式下可选跳过 Spec Compliance Review（仅保留 Code Quality Review）；balanced 模式下两个 Review 可并行执行（使用并行 Task 调用） |
| 5 | **Worktree 集成的非 git 降级**: 在非 git 仓库或 CI/CD 环境中 EnterWorktree 不可用 | 低 | 低 | Worktree 定位为"增强"而非"必须"，二期实现；非 git 环境使用普通特性分支回退 |
| 6 | **hooks 脚本跨平台兼容性**: Shell 脚本在 Windows（非 WSL）环境下无法执行；jq 在部分环境未预装 | 低 | 中 | hooks 脚本标注系统要求（macOS/Linux）；提供 PowerShell 替代脚本 [推断]；jq 缺失时 hooks 优雅降级（输出警告而非阻断） |
| 7 | **gate_policy 配置与 Superpowers 共存冲突**: 用户同时安装 Superpowers 和 Spec Driver 时，两者的约束可能重复或矛盾 | 低 | 低 | 在文档中明确 Spec Driver 的门禁机制独立于 Superpowers；[推断] 未来可增加 `superpowers_compat: true` 选项自动检测并避免冲突 |
| 8 | **验证证据文件竞态**: 多个并行 hooks 同时读写 `.claude/verification-evidence.json` 可能导致数据损坏 | 低 | 低 | 使用原子写入（写临时文件后 rename）；每次验证使用唯一时间戳键；PostToolUse hook 仅追加不覆盖 |

## 6. 产品-技术对齐度

### 覆盖评估

| MVP 功能 | 技术方案覆盖 | 实现层 | 说明 |
|---------|-------------|--------|------|
| Must-have 1: 验证铁律机制 | 完全覆盖 | Prompt 层: implement.md/verify.md 铁律文本 + Hooks 层: PreToolUse 拦截 + verify 子代理证据检查 | 三层防线，可靠性高。Prompt 层借鉴 Superpowers verification-before-completion 的 "excuse vs reality" 对照表 |
| Must-have 2: 双阶段代码审查 | 完全覆盖 | 新增 spec-review.md + quality-review.md 两个子代理 Markdown；编排器 Phase 7 拆分为 7a（Spec Review）和 7b（Quality Review） | 参考 Superpowers 的 subagent-driven-development 双审查模式。两个审查可并行执行以缩短时间 |
| Must-have 3: 门禁粒度增强 | 完全覆盖 | spec-driver.config.yaml 新增 gate_policy + gates 配置；编排器 prompt 增加条件分支逻辑（Strategy Pattern） | 三级策略 strict/balanced/autonomous + 每门禁独立配置。balanced 为默认值，保持向后兼容 |
| Must-have 4: 设计硬门禁 | 完全覆盖 | 编排器在 Phase 2（需求规范）完成后新增 GATE_DESIGN 暂停点；specify.md 增加 `<HARD-GATE>` 标记 | 硬门禁在所有模式（含 autonomous）下均暂停，不可跳过 |

### 扩展性评估

| Nice-to-have 功能（二期） | 技术方案支撑 | 扩展路径 |
|--------------------------|------------|---------|
| TDD 强制执行模式 | 支持 | 新增 `tdd_mode` 配置 + implement.md 增加 TDD 流程段落 + PreToolUse hook 可扩展为 TDD 守卫 |
| 任务级检查点（Batch Execution） | 支持 | gate_policy 的 gates 配置可扩展为 `GATE_TASK_BATCH`；编排器在 implement 阶段增加批次逻辑 |
| Git Worktree 隔离 | 支持 | 编排器初始化阶段已预留 EnterWorktree 集成点；strict 模式可自动启用 |
| 子代理上下文隔离增强 | 部分支持 | 方案 B 的编排器框架可渐进演进到方案 C；gate_policy 和双阶段审查机制无需修改 |
| 并行子代理调度 | 部分支持 | 当前 Task tool 支持并行调用；编排器 tasks.md 的 [P] 标记可扩展为实际并行执行 |
| 架构质疑机制 | 支持 | 在编排器重试策略中增加 "连续 N 次失败 → 质疑架构" 分支（prompt 工程） |

### Constitution 约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| npm 生态依赖合规性 | 兼容 | 零新增运行时依赖，完全满足 |
| 宪法治理合规性 | 兼容 | 新增 GATE_DESIGN 硬门禁进一步强化宪法治理——规范未批准不可进入实现 |
| 不修改源代码约束（spec-driver 通过设计文档驱动变更） | 兼容 | 本特性的变更范围限于 Markdown prompt、YAML config、Shell scripts，不涉及 TypeScript 源代码 |
| 双语规范（中文散文 + 英文技术术语） | 兼容 | 新增子代理 prompt 和配置遵循双语规范 |

## 7. 结论与建议

### 总结

通过对 Superpowers 技术实现的深度分析、Claude Code 平台能力的全面评估、以及本项目现有架构的兼容性检查，核心技术结论如下：

**架构选择**: 推荐方案 B（Hooks + Prompt 混合架构）。此方案以 Prompt 工程增强为基础，叠加 Claude Code 原生 hooks 机制实现运行时执法，在投入产出比、可靠性、可维护性三个维度达到最优平衡。方案 B 可分为两个交付批次——先交付 Prompt 层（2-3 天），再交付 Hooks 层（2-4 天），降低风险。

**零依赖变更**: 本特性的全部能力通过 Markdown prompt、YAML 配置扩展、Shell 脚本和 Claude Code 原生工具实现，不引入任何新的运行时依赖。这完全符合 Spec Driver 的"纯 Markdown plugin"架构哲学和 Constitution 的 npm 生态合规约束。

**渐进式借鉴**: 从 Superpowers 借鉴的是**质量理念**（验证铁律、双阶段审查、设计硬门禁），而非**架构模式**（每任务新鲜子代理）。Spec Driver 的核心竞争力在于"调研驱动 + 流程编排"，不应为了模仿 Superpowers 的去中心化技能系统而放弃集中式编排的优势。方案 C 的子代理架构重构可作为远期演进方向保留。

**门禁设计哲学**: 采用"约定优于配置"原则——默认 `balanced` 模式提供合理的开箱体验，`strict` 和 `autonomous` 模式满足极端场景需求。每个门禁可独立配置但不强制，大多数用户只需修改一个字段（`gate_policy`）。

### 对产研汇总的建议

- **交叉分析重点 1**: 方案 B 的渐进式交付（Prompt 先行，Hooks 后补）需要产品侧确认分批交付是否可接受——第一批（纯 Prompt）能否独立发布？
- **交叉分析重点 2**: 验证铁律的"证据检查"依赖 LLM 遵从性 + Hooks 双层保障，但仍非 100% 可靠。产品侧需确认对可靠性的预期——是"尽力而为"还是"必须保证"？如果是后者，可能需要评估方案 C。
- **交叉分析重点 3**: 设计硬门禁（GATE_DESIGN）将改变 Story 模式的快速流程——Story 模式当前跳过调研直接生成规范，如果增加设计硬门禁，Story 模式的 Phase 2 也将暂停。产品侧需确认 Story 模式是否也需要设计硬门禁，或仅在 Feature 模式中启用。
- **风险评估重点**: 配置复杂度膨胀是本特性最显著的产品风险——gate_policy、gates 配置、tdd_mode（二期）叠加后，spec-driver.config.yaml 的认知负担可能影响新用户上手。建议产品侧考虑 "零配置默认值 + 高级用户自定义" 的两级体验设计。
