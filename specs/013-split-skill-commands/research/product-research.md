# 产品调研报告: 拆分 Speckit Driver Pro 技能命令

**特性分支**: `013-split-skill-commands`
**调研日期**: 2026-02-15
**调研模式**: 在线

## 1. 需求概述

**需求描述**: 将 speckit-driver-pro Plugin 的单一技能 speckit-driver-pro 拆分为三个独立技能：run（主编排流程）、resume（恢复中断流程）、sync（产品规范聚合）。当前 `skills/speckit-driver-pro/SKILL.md` 包含所有功能，需要重构为 `skills/run/SKILL.md`、`skills/resume/SKILL.md`、`skills/sync/SKILL.md` 三个独立技能文件，使命令变为 `/speckit-driver-pro:run`、`/speckit-driver-pro:resume`、`/speckit-driver-pro:sync`。

**核心功能点**:
- 将单一 706 行 SKILL.md 拆分为三个独立技能文件
- 每个技能文件职责单一：run（10 阶段编排）、resume（中断恢复）、sync（规范聚合）
- 利用 Claude Code Plugin 原生的 `plugin-name:skill-name` 命名空间语法

**目标用户**: 使用 Speckit Driver Pro 进行 Spec-Driven Development 的开发者和技术团队

## 2. 市场现状

### 市场趋势

1. **CLI 工具从单体命令走向模块化子命令**：行业主流 CLI 框架（oclif、Commander.js、CLI11）均推荐将大型单体命令拆分为职责单一的子命令。oclif 明确提出使用 Strangler Fig 模式从单体迁移到插件化架构。大型 CLI 工具（Heroku CLI、Salesforce CLI）均已采用模块化插件架构。

2. **AI 编码助手的命令系统走向精细化**：2025-2026 年，主流 AI IDE/CLI 工具（Claude Code、Cursor、GitHub Copilot、Windsurf）均采用细粒度的命令/技能组织方式。Claude Code 原生支持 `plugin-name:skill-name` 命名空间语法，鼓励按职责拆分技能。

3. **Spec-Driven Development 进入主流**：GitHub 推出 Spec Kit 开源工具包，SDD 方法论被 InfoQ 等行业媒体广泛报道。工作流的可恢复性（resume/checkpoint）成为编排器的标配功能。

### 市场机会

1. **Claude Code Plugin 生态仍处于早期**：目前市场上的 Claude Code Plugin 大多结构简单，Speckit Driver Pro 作为复杂编排器，其技能拆分将成为 Plugin 开发的最佳实践示范。

2. **命令可发现性提升**：拆分后的三个独立命令在 Claude Code 的 `/` 菜单中各自显示描述和用途，比单一命令配合 `--flag` 参数更易被用户发现和理解。

3. **渐进式采用路径**：用户可以先只使用 `/speckit-driver-pro:sync` 进行规范聚合，无需理解完整的 10 阶段流程，降低了入门门槛。

### 用户痛点

- **认知负荷过高**：当前单一 SKILL.md 文件 706 行，包含主编排、恢复、聚合三种完全不同的工作流，用户需要阅读大量文档才能理解可用操作
- **参数解析歧义**：`/speckit-driver-pro --resume` 与 `/speckit-driver-pro --sync` 作为同一技能的不同模式，在语义上不如独立命令清晰
- **上下文预算浪费**：Claude Code 加载技能时会将 SKILL.md 内容计入上下文预算（约 2% 窗口），706 行的单体文件在只需要 sync 功能时浪费了大量上下文空间
- **自动触发不精确**：Claude Code 基于 SKILL.md 的 `description` 字段自动判断是否加载技能，单一描述难以精确覆盖三种不同的使用场景

## 3. 竞品分析

### 竞品对比表

| 维度 | Cursor Commands | GitHub Copilot Agents/Skills | Windsurf Workflows | Aider Commands | 本产品（计划） |
|------|----------------|----------------------------|-------------------|---------------|--------------|
| 命令组织方式 | 独立 .md 文件 per command + Rules (.mdc) 语义匹配 | Agent + Skills 双层结构，skills 独立目录 | 独立 .md 文件 per workflow，目录自动发现 | 平坦命令列表，无子命令嵌套 | Plugin 命名空间 + 独立技能文件 |
| 命名空间 | 目录路径映射（`frontend/component` -> 内部分类） | `.github/agents/` + `.github/skills/` | `.windsurf/workflows/` | 无命名空间 | `plugin-name:skill-name` 冒号语法 |
| 命令粒度 | 每文件一个命令，职责单一 | 每 Skill 一个 SKILL.md，Agent 编排多 Skill | 每文件一个 Workflow | 内置命令，不可扩展 | 拆分后每技能一个 SKILL.md |
| 命令发现性 | `/` 菜单列出所有命令 | `/` 菜单 + 自动加载 | `/` 菜单 + Cascade 自动发现 | `/help` 列出 | `/` 菜单 + description 自动触发 |
| 复杂工作流支持 | Commands 简单，Subagents 处理复杂逻辑（2.4 更新） | Agent 编排 Skills，支持 delegate | Cascade 多步骤，支持 Todo lists、checkpoints | `/architect` 双模型模式 | Task tool 委派子代理，10 阶段编排 |
| 中断恢复 | 无原生支持 | 无文档记录 | Checkpoints 支持 | `/undo` 回退 | `--resume` 扫描制品恢复（计划拆分为独立命令） |
| 上下文管理 | Rules 按 glob/语义选择性加载 | Skills 按相关性选择性加载 | Workflows 12,000 字符限制 | 手动 `/add`、`/drop` 管理 | 拆分后按需加载单个技能文件 |

### 差异化机会

1. **原生命名空间语法**：Claude Code 是目前唯一提供 `plugin-name:skill-name` 冒号语法的 AI 工具平台。Speckit Driver Pro 拆分后将充分利用这一平台原语，形成 `speckit-driver-pro:run/resume/sync` 的清晰命令族，这是竞品无法直接复制的优势。

2. **中断恢复作为独立命令**：市场上的 AI 编排工具普遍缺乏流程恢复能力（Cursor、Aider 无此功能，Windsurf 的 Checkpoints 是 IDE 级而非工作流级）。将 resume 提升为独立命令，突出了这一差异化功能的可见性。

3. **渐进式功能发现**：竞品要么全功能暴露（Cursor 平坦列表），要么隐藏在参数背后。三个独立技能的设计允许用户从最简单的 `sync` 开始，逐步发现 `run` 和 `resume` 的高级能力，形成自然的功能探索路径。

4. **上下文预算优化**：Windsurf 的 12,000 字符限制证明上下文管理是实际问题。拆分后，每个技能文件仅包含相关逻辑，避免加载无关内容，这在 Claude Code 的 2% 上下文预算限制下尤其重要。

## 4. 用户场景验证

### 核心用户角色

**Persona 1: 全栈开发者 Alex**
- 背景: 中级开发者，在小型团队（3-5 人）使用 Claude Code 进行日常开发，已安装 Speckit Driver Pro
- 目标: 快速启动新功能的 Spec-Driven Development 流程，偶尔需要恢复中断的流程
- 痛点: 记不清 `--resume` 和 `--sync` 的参数语法，经常在 `/` 菜单中看到单一命令后犹豫该怎么用

**Persona 2: 技术主管 Morgan**
- 背景: 负责团队代码质量和规范管理，主要使用 sync 功能生成产品活文档供团队参考
- 目标: 定期执行规范聚合，无需触发完整的研发流程
- 痛点: 每次执行 `/speckit-driver-pro --sync` 时，Claude 加载了 706 行的完整编排逻辑，其中 90% 与 sync 无关，浪费上下文且可能引起混淆

**Persona 3: 新成员 Jamie**
- 背景: 刚加入团队，需要了解 Speckit Driver Pro 的功能
- 目标: 快速理解可用命令并开始使用
- 痛点: 面对单一命令 `/speckit-driver-pro` 时，不知道有 resume 和 sync 功能存在；需要阅读完整 SKILL.md 才能发现参数选项

### 关键用户旅程

1. **日常新功能开发（Alex）**:
   - **当前**: 输入 `/speckit-driver-pro 添加用户认证功能` -> Claude 加载 706 行 SKILL.md -> 执行 10 阶段流程
   - **拆分后**: 输入 `/speckit-driver-pro:run 添加用户认证功能` -> Claude 仅加载 run 技能 -> 执行 10 阶段流程
   - **改进**: 语义更清晰（"run" 明确表示执行），上下文更精简

2. **中断后恢复流程（Alex）**:
   - **当前**: 需要记住输入 `/speckit-driver-pro --resume` -> 与主流程共享上下文
   - **拆分后**: 在 `/` 菜单中直接看到 `/speckit-driver-pro:resume` -> 输入命令 -> 仅加载恢复逻辑
   - **改进**: 命令可发现性大幅提升，无需记忆参数

3. **定期规范聚合（Morgan）**:
   - **当前**: 输入 `/speckit-driver-pro --sync` -> 加载包含编排逻辑的完整 SKILL.md -> 只执行 sync 部分
   - **拆分后**: 输入 `/speckit-driver-pro:sync` -> 仅加载聚合逻辑（约 80 行）-> 执行聚合
   - **改进**: 上下文使用量减少约 85%，聚合逻辑独立清晰

4. **新成员探索功能（Jamie）**:
   - **当前**: 输入 `/` 看到一个 `speckit-driver-pro` 命令 -> 不确定有哪些功能
   - **拆分后**: 输入 `/speckit-driver-pro:` 看到 run/resume/sync 三个命令各自带描述 -> 立即理解可用功能
   - **改进**: 零学习成本的功能发现

### 需求假设验证

| 假设 | 验证结果 | 证据 |
|------|---------|------|
| Claude Code 原生支持 plugin-name:skill-name 语法 | 已验证 | Claude Code 官方文档明确说明 Plugin skills 自动使用 `plugin-name:skill-name` 命名空间 |
| 每个 skill 目录需要独立的 SKILL.md | 已验证 | 官方文档：每个技能是一个包含 SKILL.md 的目录，目录名即为技能名 |
| 拆分后三个技能各自在 `/` 菜单中显示 | 已验证 | Claude Code 自动发现 Plugin 下所有 `skills/*/SKILL.md` 并注册为可调用命令 |
| 拆分不影响现有子代理 prompt 文件 | 已验证 | 子代理 prompt 位于 `agents/` 目录，与 `skills/` 目录独立，拆分仅涉及 SKILL.md 文件 |
| 上下文预算受益于拆分 | 已验证 | Claude Code 文档指出技能内容占上下文预算约 2%，更小的 SKILL.md 意味着更少的预算占用 |
| 需要处理向后兼容（旧的单一命令） | 待确认 | [推断] 删除旧的 `skills/speckit-driver-pro/` 目录后，`/speckit-driver-pro` 命令将不再可用；但由于 Plugin 尚未广泛分发，兼容性风险低 |

## 5. MVP 范围建议

### Must-have（MVP 核心）

- **创建 `skills/run/SKILL.md`**：包含主编排器的 10 阶段工作流、初始化逻辑、子代理失败重试、模型选择逻辑、选择性重跑（`--rerun`）
- **创建 `skills/resume/SKILL.md`**：包含中断恢复机制的完整逻辑（制品扫描、恢复点确定、恢复执行）
- **创建 `skills/sync/SKILL.md`**：包含产品规范聚合模式的完整逻辑（扫描、聚合、报告）
- **删除 `skills/speckit-driver-pro/SKILL.md`**：移除旧的单体技能文件
- **每个 SKILL.md 配置正确的 frontmatter**：name、description、disable-model-invocation 等字段

### Nice-to-have（二期）

- **共享工具模块**：提取三个技能共用的逻辑（如配置加载、项目环境检查）到 `skills/_shared/` 参考文件
- **命令别名支持**：保留 `/speckit-driver-pro`（无冒号）作为 `/speckit-driver-pro:run` 的别名，减少迁移摩擦
- **交叉引用提示**：在 resume 技能中提示用户可以用 `run --rerun <phase>` 选择性重跑，在 sync 完成后提示可用 `run` 启动新功能开发

### Future（远期）

- **技能间编排协议**：定义三个技能之间的数据交换格式，支持从 sync 结果触发 run 流程
- **自定义技能组合**：允许用户创建包含 run+verify 的自定义工作流技能
- **技能依赖声明**：在 SKILL.md frontmatter 中声明技能依赖关系

### 优先级排序理由

Must-have 功能聚焦于**纯文件层面的 Markdown 重构**，不涉及任何代码变更，风险极低。拆分的核心价值在于：
1. 利用 Claude Code 平台原生能力（命名空间语法），这是零成本收益
2. 解决最大的用户痛点（上下文浪费和命令不可发现），这是即时可见的改进
3. 为后续的功能扩展（如新增技能）奠定架构基础

Nice-to-have 功能需要更多设计考量（如共享逻辑的引用方式），可在验证 MVP 效果后再实施。

## 6. 结论与建议

### 总结

产品调研强有力地支持了技能拆分需求。市场趋势、竞品分析和用户场景验证均一致表明：

1. **行业共识**：从 CLI 工具到 AI 编码助手，命令/技能的单一职责原则已是普遍最佳实践
2. **平台支持**：Claude Code 的 Plugin 命名空间语法原生支持这种拆分，无需额外技术开发
3. **用户价值明确**：拆分解决了认知负荷、上下文浪费、命令发现性三个具体痛点
4. **风险极低**：纯 Markdown 文件重构，不涉及代码变更，可快速回滚
5. **差异化增强**：resume 作为独立命令是市场上的独特卖点

竞品对比显示，没有任何竞品在中断恢复方面提供类似的独立命令级支持。Speckit Driver Pro 的 resume 技能将成为差异化优势。

### 对技术调研的建议

- **技术调研应关注 SKILL.md frontmatter 的最佳配置**：特别是 `description` 字段如何影响 Claude Code 的自动触发行为，以及 `disable-model-invocation` 在三个技能上的差异化设置（run 应设为 true 防止意外触发，sync 可考虑允许自动触发）
- **技术调研应关注共享逻辑的引用机制**：三个技能共用的初始化逻辑（环境检查、配置加载）如何在 Markdown 层面复用，是否可以通过 `reference.md` 或文件引用实现
- **技术调研应验证 Claude Code 对 Plugin 技能命名的限制**：确认 run、resume、sync 是否为合法的技能目录名，是否与 Claude Code 内置命令冲突
- **技术调研应评估旧技能目录的删除策略**：确认删除 `skills/speckit-driver-pro/` 不会影响 Plugin 的其他组件（hooks、agents、scripts）

### 风险与不确定性

- **向后兼容风险（低）**：删除旧的 `skills/speckit-driver-pro/` 后，已有用户的 `/speckit-driver-pro` 命令将失效。缓解：Plugin 尚未广泛分发（处于同一代码仓库内），影响范围极小；可在 README 中说明迁移路径。
- **上下文预算实际效果（中）[推断]**：虽然理论上拆分能减少上下文占用，但实际效果取决于 Claude Code 的技能加载策略（是否预加载所有技能描述）。缓解：即使预算节省有限，命令可发现性和语义清晰度的改进仍然成立。
- **共享逻辑重复（低）**：初始化阶段的配置加载和环境检查逻辑在 run 和 resume 中都需要，拆分后可能出现内容重复。缓解：通过 reference 文件引用机制或在 MVP 阶段接受适度重复。
