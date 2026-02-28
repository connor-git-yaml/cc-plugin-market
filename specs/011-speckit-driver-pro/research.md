# Research: Speckit Driver Pro

**Branch**: `011-speckit-driver-pro` | **Date**: 2026-02-15 | **Plan**: [plan.md](plan.md)

## 决策 1: 子代理委派机制——Task tool 参数传递方式

### Decision

通过 Claude Code Task tool 的 `prompt` 参数传递子代理 prompt（读取 agents/*.md 文件内容），结合 `subagent_type` 参数选择代理类型，`model` 参数控制模型选择。

### Rationale

- Claude Code 的 Task tool 支持 `prompt`、`subagent_type`、`model`、`description` 等参数
- 现有项目使用 `handoffs` YAML frontmatter 实现命令间跳转，但 Driver Pro 需要更灵活的运行时委派（传递上下文、控制模型）
- Task tool 的 `prompt` 参数可以动态注入：子代理 prompt 模板 + 当前阶段的上下文信息（如产品调研结论）
- `model` 参数直接对应 spec-driver.config.yaml 中的模型配置，无需额外适配层

### Alternatives Considered

1. **直接使用 handoffs 链**: 简单但不支持运行时模型切换和动态上下文注入
2. **MCP Server 封装**: 过度工程化，Plugin 不需要 MCP 协议来编排 prompt-only 的工作流
3. **Bash 脚本编排**: 无法利用 Claude Code 的 LLM 能力进行质量判断

---

## 决策 2: 子代理 prompt 来源——自包含 vs 引用项目已有 speckit skills

### Decision

采用"自包含 + 兼容"策略：Plugin 的 agents/ 目录内置全部子代理 prompt，初始化时检测项目是否已有 `.claude/commands/speckit.*.md`，若存在则优先使用项目已有版本。

### Rationale

- 自包含确保开箱即用，用户无需预装 speckit skills
- 兼容模式尊重用户已有的定制（如修改过的 speckit.specify.md）
- 检测逻辑在主编排器 SKILL.md 中实现，每个阶段开始前动态选择 prompt 来源
- 来源选择逻辑：`if exists .claude/commands/speckit.{phase}.md → use it; else → use agents/{phase}.md`

### Alternatives Considered

1. **强依赖项目 speckit skills**: 安装门槛高，新用户体验差
2. **完全自包含，忽略项目已有 skills**: 不尊重用户定制，可能导致行为不一致
3. **合并策略（merge 两个 prompt）**: 实现复杂度高，prompt 合并可能产生冲突

---

## 决策 3: 配置文件格式——spec-driver.config.yaml 的结构设计

### Decision

采用 YAML 格式，三级配置结构：preset（预设）→ agents（子代理级覆盖）→ verification（验证配置）。首次使用时交互式引导用户选择预设并生成配置文件。

### Rationale

- YAML 格式人类可读、易于手动编辑，与 Spec Kit 的 Markdown 生态互补
- 三级结构覆盖所有配置需求：全局预设 → 子代理粒度 → 验证工具粒度
- 交互式初始化降低配置门槛（用户只需选 balanced/quality-first/cost-efficient）
- 配置文件存放在项目根目录或 .specify/ 目录下，版本控制友好

### Alternatives Considered

1. **JSON 格式**: 不支持注释，用户体验差
2. **TOML 格式**: 在 Node.js/Bash 生态中工具支持较弱
3. **环境变量**: 不适合复杂的嵌套配置
4. **无配置文件（硬编码预设）**: 不满足 FR-012 的自定义需求

### Configuration Schema

```yaml
# spec-driver.config.yaml 完整结构
preset: balanced  # balanced | quality-first | cost-efficient

agents:
  product-research:
    model: opus    # 覆盖预设
  tech-research:
    model: opus
  specify:
    model: opus
  clarify:
    model: sonnet
  checklist:
    model: sonnet
  plan:
    model: opus
  tasks:
    model: sonnet
  analyze:
    model: opus
  implement:
    model: sonnet
  verify:
    model: sonnet

verification:
  commands:
    typescript:
      build: "npm run build"
      lint: "npm run lint"
      test: "npm test"
    # 用户可添加其他语言的自定义命令

quality_gates:
  auto_continue_on_warning: true  # WARNING 级别自动继续
  pause_on_critical: true          # CRITICAL 级别暂停

retry:
  max_attempts: 2                  # 子代理失败最大重试次数
```

---

## 决策 4: 多语言验证——特征文件检测 vs 用户声明

### Decision

采用特征文件自动检测为主、spec-driver.config.yaml 声明为辅的混合策略。verify 子代理扫描项目根目录和子目录的特征文件（package.json、Cargo.toml、go.mod 等），自动识别语言和构建系统。用户可在 spec-driver.config.yaml 中覆盖自动检测结果。

### Rationale

- 特征文件检测是业界标准做法（GitHub Linguist、Dependabot 等均使用类似策略）
- 自动检测覆盖 90%+ 的常见项目结构，减少配置负担
- spec-driver.config.yaml 覆盖机制处理非标准项目结构
- Monorepo 检测：扫描子目录的特征文件，每个子项目独立验证

### Alternatives Considered

1. **纯用户声明**: 增加配置负担，不适合快速上手
2. **纯自动检测**: 无法处理非标准项目结构（如自定义构建系统）
3. **语言服务器协议（LSP）集成**: 过度工程化，超出 Plugin 的能力范围

### Detection Algorithm

```text
1. 扫描项目根目录的特征文件
2. 对每个匹配的特征文件：
   a. 识别语言/构建系统
   b. 检查对应的构建/Lint/测试命令是否可用（which/command -v）
   c. 不可用时标记为 "工具未安装"
3. 如果检测到 workspace/workspaces 配置（package.json workspaces、Cargo workspace）：
   a. 标记为 Monorepo
   b. 递归扫描每个子项目
4. 合并 spec-driver.config.yaml 中的覆盖配置
5. 输出验证计划（待执行的命令列表）
```

---

## 决策 5: 产研汇总——主编排器亲自执行 vs 委派子代理

### Decision

产研汇总（Phase 1c）由主编排器亲自执行，不委派给子代理。主编排器读取 product-research.md 和 tech-research.md，生成 research-synthesis.md。

### Rationale

- 产研汇总需要跨域综合判断（产品 × 技术交叉分析），这是主编排器"研发总监"角色的核心职责
- 汇总内容直接影响后续所有阶段的方向，应由最高层级的智能体负责
- 避免引入第三个 research 子代理增加架构复杂度
- 主编排器已持有两个调研报告的完整上下文，无需额外的 context 传递开销

### Alternatives Considered

1. **委派给专门的 synthesis 子代理**: 增加一个子代理仅为单次使用，不值得
2. **让 tech-research 子代理顺带做汇总**: 违反单一职责，且 tech-research 不了解产品调研全貌

---

## 决策 6: 进度反馈——阶段级 vs 步骤级

### Decision

采用阶段级进度反馈。主编排器在每个阶段开始时输出 `[N/10] 正在执行 {阶段名}...`，阶段完成时输出关键产出摘要。

### Rationale

- 阶段级反馈粒度适中（10 个阶段 = 10 次更新），不会信息过载
- 步骤级反馈（每个子代理内部的步骤）由子代理自身控制，不由编排器追踪
- 关键产出摘要帮助用户快速了解每个阶段的成果，便于决定是否需要调整
- 实现简单：编排器在 Task tool 调用前后各输出一行文本

### Alternatives Considered

1. **步骤级反馈**: 信息过载，子代理内部步骤数不固定
2. **仅完成通知**: 用户在长时间等待中缺乏进展感知
3. **进度条**: Claude Code 的文本输出不支持动态进度条

---

## 决策 7: Speckit Skill 兼容检测——何时检测、如何选择

### Decision

在主编排器初始化阶段（Phase 0 之前）一次性检测，将检测结果缓存在工作流状态中，后续阶段直接使用缓存的 prompt 路径。

### Rationale

- 一次检测避免每个阶段重复扫描文件系统
- 检测结果在整个工作流生命周期内稳定（用户不太可能在流程运行中修改 speckit skills）
- 缓存方式：编排器在内存中维护 `phase → prompt_path` 的映射

### Detection Logic

```text
对于每个阶段 phase ∈ [specify, clarify, checklist, plan, tasks, analyze, implement]:
  if 文件存在 .claude/commands/speckit.{phase}.md:
    prompt_source[phase] = .claude/commands/speckit.{phase}.md
    标记为 "使用项目已有版本"
  else:
    prompt_source[phase] = plugins/speckit-driver-pro/agents/{phase}.md
    标记为 "使用 Plugin 内置版本"

# constitution、product-research、tech-research、verify 始终使用 Plugin 内置版本
# （这些是 Driver Pro 特有的阶段，项目 speckit skills 中不存在对应命令）
```

---

## 决策 8: 初始化脚本——postinstall.sh 职责划分

### Decision

将初始化拆为两个脚本：`postinstall.sh`（Plugin 安装时执行，轻量级）和 `init-project.sh`（首次触发 Driver Pro 时执行，项目级初始化）。

### Rationale

- 安装时（postinstall.sh）只做最小化操作：验证 Claude Code 版本、输出安装成功信息
- 项目初始化（init-project.sh）需要检查 .specify/ 目录、constitution 是否存在、spec-driver.config.yaml 是否存在
- 分离的好处：安装不依赖项目上下文，初始化可根据项目状态自适应

### Script Responsibilities

```text
postinstall.sh（安装时）:
  1. 检查 Claude Code 版本兼容性
  2. 输出安装成功消息和使用提示

init-project.sh（首次触发时）:
  1. 检查 .specify/ 目录是否存在
     - 不存在 → 创建目录结构 + 复制模板
     - 存在 → 跳过
  2. 检查 constitution.md 是否存在
     - 不存在 → 提示用户创建（暂停）
     - 存在 → 继续
  3. 检查 spec-driver.config.yaml 是否存在
     - 不存在 → 交互式引导创建（选择预设）
     - 存在 → 读取配置
  4. 检测项目已有 speckit skills（prompt 来源映射）
  5. 输出初始化摘要
```
