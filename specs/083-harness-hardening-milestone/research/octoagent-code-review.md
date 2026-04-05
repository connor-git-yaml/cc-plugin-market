# cc-plugin-market 代码审查与优化建议

> 审查人：OctoAgent 项目开发经验 + 深度代码分析
> 日期：2026-04-05
> 审查范围：spec-driver 插件架构、编排逻辑、Agent Prompt、配置系统、初始化流程
> 背景：基于 OctoAgent 项目 4 个月实际研发中经历的架构劣化、测试不稳定、重复修复等问题的反思

---

## 0. 总体评价

spec-driver 是一个**设计精良的 Spec-Driven 开发编排器**，14 个子 Agent、6 种执行模式、5 道质量门禁的组合非常完整。以下建议来自我们在 OctoAgent 开发中踩过的坑——很多问题在初期并不明显，但随着项目规模增长会指数级放大。

**核心发现**：spec-driver 当前的主要风险不是功能缺失，而是**编排逻辑集中在超长 SKILL.md 中（单文件 10,000+ 行）**，以及**子 Agent 之间的契约隐式化**——这两个问题在 OctoAgent 中曾导致修一个 Bug 引入两个新 Bug 的恶性循环。

---

## 1. 从 OctoAgent 开发中总结的教训

以下是我们在 OctoAgent 4 个月开发中经历的核心问题，每一条都与 spec-driver 的当前设计有关联：

### 1.1 单文件膨胀是架构劣化的第一信号

**我们的教训**：
- `control_plane.py` 从 2000 行增长到 11,707 行，最终不得不拆成 12 个文件
- `agent_context.py` 达到 4200+ 行，`_build_system_blocks` 方法有 22 个参数
- 每次修改都要在数千行中定位上下文，修错位置的概率随行数线性增长

**对 spec-driver 的警示**：
- `spec-driver-feature/SKILL.md` 已达 10,000+ 行——这是**单个 Prompt 文件**
- 编排逻辑、门禁策略、上下文注入、错误处理、输出格式全部混在一个文件中
- 一旦需要调整某个门禁的行为，必须在万行 Markdown 中精确定位并修改

### 1.2 隐式契约导致级联故障

**我们的教训**：
- Responses API 的 `output_item.done` 覆盖了 `output_item.added` 的 `call_id`——因为两个事件处理器之间的数据契约是隐式的
- 工具结果回填有三条分支（Chat Completions / Responses API / 自然语言 fallback），每条分支对输入格式的假设不同
- MCP 工具不在 `selected_tools` 白名单中——因为白名单构建和工具注册是两个独立流程，没有显式同步点

**对 spec-driver 的关联**：
- Phase 间的制品传递是文件路径约定（`{feature_dir}/research/product-research.md`），没有 Schema 校验
- 并行转串行降级时，tech-research 是否读取 product-research 输出取决于执行模式——这是隐式行为差异
- 子 Agent 返回格式没有显式 Schema（依赖 Prompt 中的自然语言描述）

### 1.3 19 个 System Message 的代价

**我们的教训**：
- 7+ 个来源注入 System Message，总量 15K+ chars
- Qwen 等小模型对长 System Message 不稳定，工具调用成功率只有 60%
- 最终合并为 3 个 System Message，添加 Token 预算控制

**对 spec-driver 的关联**：
- 子 Agent Prompt 本身就是完整的 System Message（最大的 sync.md 有 13,759 bytes）
- 加上运行时上下文注入（feature_dir、前序制品、配置、project_context_block），单次调用的 Prompt 可能非常大
- 不同模型（Opus vs Sonnet vs Haiku）对长 Prompt 的处理能力差异很大

### 1.4 沉默失败是最危险的 Bug

**我们的教训**：
- `except Exception: return []` 让 ToolBroker 的发现错误完全不可见
- `model_validate` 二次校验失败时 tool_calls 被静默丢弃——用户看到 Agent "什么都不做"
- 没有诊断日志就只能靠猜测定位问题

**对 spec-driver 的关联**：
- 并行任务降级到串行时只输出 `[并行回退]` 标记——但不记录降级原因
- 子 Agent 失败后 implement 继续执行（标记 incomplete）——但失败的 root cause 是否传播到最终报告？
- 模板加载失败时 fallback 到内置模板——但用户可能不知道自己的自定义模板没生效

### 1.5 测试稳定性决定迭代速度

**我们的教训**：
- 一次大规模重构后 135 个测试失败，花了 3 轮才清零
- 很多失败不是代码 Bug，而是测试本身依赖了不应依赖的内部状态
- 缺少端到端冒烟测试，无法快速验证"基本功能还能用"

**对 spec-driver 的关联**：
- 313 个测试用例覆盖了 reverse-spec（AST 分析），但 spec-driver 的编排逻辑似乎没有自动化测试
- SKILL.md 中的编排逻辑是纯 Prompt——Prompt 变更后如何验证行为未退化？
- Verification Iron Law 是好设计，但它的执行依赖 implement Agent 的"自觉"——如果 Prompt 调整导致 Agent 不再输出验证命令呢？

---

## 2. 架构级建议

### 2.1 SKILL.md 拆分：从万行 Prompt 到结构化编排

**问题**：`spec-driver-feature/SKILL.md` 是一个 10,000+ 行的单文件，包含：
- Phase 定义与执行顺序
- 5 道门禁的策略逻辑
- 上下文注入模板
- 错误处理与降级策略
- 输出格式模板
- 并行/串行调度逻辑

**建议**：将编排逻辑从单一 Prompt 拆分为 **Prompt + 结构化配置**：

```yaml
# spec-driver-feature/orchestration.yaml
phases:
  - id: constitution
    agent: constitution
    gate: null
    parallel_group: null

  - id: research
    agents: [product-research, tech-research]
    parallel_group: RESEARCH_GROUP
    gate: GATE_RESEARCH
    gate_position: after
    dependencies: [constitution]

  - id: specify
    agent: specify
    dependencies: [research]
    gate: GATE_DESIGN
    gate_position: after

  # ...

gates:
  GATE_DESIGN:
    hard_gate_in: [feature]  # 不可被 config 覆盖的模式
    default_behavior: always

  GATE_RESEARCH:
    hard_gate_in: []
    default_behavior: auto
    online_research_constraint: true

parallel_groups:
  RESEARCH_GROUP:
    agents: [product-research, tech-research]
    fallback: serial
    dependency_on_serial: tech-research reads product-research

  VERIFY_GROUP:
    agents: [spec-review, quality-review]
    fallback: serial
```

**收益**：
- SKILL.md 缩短到 2000-3000 行（只保留 Prompt 指令和人类可读的流程说明）
- 门禁行为变更只改 YAML，不碰 Prompt
- 新增执行模式（如未来的 `spec-driver-refactor`）可以复用 Phase 定义
- 编排逻辑可以被 schema 校验——类似 OctoAgent 中用 Pydantic Model 替代 22 个关键字参数

### 2.2 子 Agent 制品契约显式化

**问题**：子 Agent 之间通过文件路径传递制品，但制品的格式/结构是 Prompt 中自然语言约定的。

**建议**：为每个子 Agent 的输出定义 **Artifact Schema**：

```yaml
# agents/product-research.artifact.yaml
output:
  path: "{feature_dir}/research/product-research.md"
  required_sections:
    - "## 市场验证"
    - "## 竞品分析"
    - "## 用户画像"
    - "## MVP 推荐"
  optional_sections:
    - "## 在线调研结果"
  validation:
    min_competitors: 3
    must_have_feature_matrix: true

inputs:
  required:
    - feature_dir: string
    - requirement_text: string
  optional:
    - project_context: string
    - online_research_config: object
```

**收益**：
- analyze Agent 可以自动校验前序制品的完整性（而非依赖 LLM 理解力）
- resume 模式的断点检测可以基于 Schema 而非文件存在性
- 新增子 Agent 时，契约即文档——不需要读完整个 SKILL.md 才知道应该输出什么
- OctoAgent 教训：我们的 `ActionRequestEnvelope` / `ActionResultEnvelope` 正是因为有显式 Schema 才避免了编排层的混乱

### 2.3 错误传播链路补全

**问题**：
- 并行降级只标记 `[并行回退]` 但不记录原因
- 子 Agent 失败后 implement 标记 incomplete 但 root cause 可能丢失
- 模板加载 fallback 对用户不可见

**建议**：引入 **Trace 日志** 机制：

```markdown
<!-- .specify/features/NNN-xxx/trace.md -->
## Execution Trace

### Phase: research (RESEARCH_GROUP)
- [14:23:01] product-research: STARTED (parallel)
- [14:23:01] tech-research: STARTED (parallel)
- [14:23:15] product-research: COMPLETED (12 sections, 2847 chars)
- [14:23:18] tech-research: COMPLETED (8 sections, 3102 chars)

### Phase: specify
- [14:23:20] specify: STARTED
- [14:23:22] specify: TEMPLATE_FALLBACK (project template missing, using plugin default)
- [14:24:01] specify: COMPLETED (spec.md, 9 sections)

### Gate: GATE_DESIGN
- [14:24:02] GATE_DESIGN: PAUSED (policy=always)
- [14:25:30] GATE_DESIGN: USER_APPROVED (choice=A)

### Phase: implement
- [14:30:00] implement: TASK T-3 FAILED (exit_code=1, npm run build)
- [14:30:01] implement: TASK T-3 RETRY (attempt 2/2)
- [14:30:15] implement: TASK T-3 FAILED (exit_code=1, same error)
- [14:30:16] implement: MARKED_INCOMPLETE (T-3, reason: build failure)
```

**收益**：
- 问题排查从"猜"变成"查"——OctoAgent 加了诊断日志后，排查效率提升 10 倍
- 用户可以看到完整的决策链路（哪些是自动的，哪些是人工的）
- resume 模式可以基于 Trace 精确恢复（不只是"最后一个文件是什么"）

---

## 3. 子 Agent Prompt 级建议

### 3.1 implement.md：Verification Iron Law 的可靠性

**当前设计**（好的部分）：
- 要求每个任务完成后必须附带验证命令输出
- verify 阶段检测 EVIDENCE_MISSING

**风险**：Iron Law 的执行依赖 implement Agent 的 Prompt Following——如果模型不够强（如 Sonnet 处理复杂任务时），可能跳过验证步骤。

**建议**：
1. **在 SKILL.md 编排层强制验证**，而非依赖子 Agent 自觉：
   ```
   Phase 6 完成后，编排器自己运行 `build + lint + test`，
   而不是信任 implement Agent 的自我报告。
   ```
2. **添加验证命令白名单**——implement Agent 只需报告"我修改了哪些文件"，验证由编排器执行
3. OctoAgent 教训：我们的 `SkillRunner` 最初信任 LLM 返回的 tool_calls 格式，结果 Qwen 返回的格式不一致导致调用静默丢弃。**永远不要信任 LLM 的格式合规性**。

### 3.2 sync.md：复杂度过高（13,759 bytes）

**问题**：sync Agent 的 Prompt 包含完整的产品规格聚合算法（5 级推断优先级、14 章合并策略、冲突解决规则）。这实际上是在用自然语言描述一个复杂的**数据处理算法**。

**风险**：
- LLM 对复杂算法的遵循度与 Prompt 长度负相关
- 算法变更需要修改 Prompt 并祈祷 LLM 理解新逻辑
- 不同模型对同一算法描述的执行结果可能不同

**建议**：
- 将合并算法提取为 **TypeScript 工具**（脚本），sync Agent 调用工具而非自己执行算法
- Agent 只负责"理解哪些 spec 应该合并"和"审查合并结果"，具体合并操作由确定性代码完成
- OctoAgent 设计原则：**Agent Autonomy**（LLM 负责决策）+ **Tools are Contracts**（工具负责执行）——决策和执行不应混在一起

### 3.3 quality-review.md：4D 评估的可操作性

**当前**：4 维度评估（设计/安全/性能/可维护性），输出 Markdown 报告。

**建议增强**：
- 每个 Issue 附带 **修复优先级**（P0/P1/P2）和 **预估修复工作量**（小/中/大）
- 输出结构化 JSON（或 YAML front matter）供 verify 阶段自动聚合
- 区分 **阻塞性问题**（必须修复才能通过 GATE_VERIFY）和 **建议性问题**（记录但不阻塞）
- OctoAgent 教训：我们的 System Message 最初只有 WARNING/INFO 两级，后来发现必须有 CRITICAL 级别来阻塞流程

### 3.4 研究 Agent 的离线降级

**当前**：离线时标记 "离线模式：基于知识库分析"。

**建议增强**：
- 离线模式应**自动降低**产品研究的置信度分数
- 在研究报告中显式标注哪些结论来自 LLM 知识库（可能过时），哪些来自实时搜索
- 门禁 GATE_RESEARCH 应能区分"完成了在线研究"和"降级为离线模式"——两者的通过标准应不同
- OctoAgent 教训：我们的 `Degrade Gracefully` 原则——降级可以，但必须让后续流程知道已经降级

---

## 4. 配置系统建议

### 4.1 配置校验前移

**问题**：当前配置只在运行时被读取，语法错误或类型错误在执行到相关代码时才暴露。

**建议**：
- 在 `init-project.sh` 阶段添加 YAML Schema 校验（使用 JSON Schema for YAML）
- 提供 `spec-driver config validate` 命令
- 对常见错误提供具体修复建议（如 `gate_policy: strict` 拼写为 `gate_policy: strick`）

### 4.2 配置继承与覆盖的文档化

**当前优先级链**（6 层）是正确的，但用户很难理解最终生效的是什么。

**建议**：
- 添加 `spec-driver config show --effective` 命令，显示合并后的最终配置
- 每个配置项标注来源（`[preset]`、`[config file]`、`[cli flag]`、`[default]`）
- OctoAgent 教训：我们的 Behavior System 有 4 层作用域（system_shared / agent_private / project_shared / project_agent），用户总是搞不清哪个文件生效了——最后加了诊断日志才解决

### 4.3 preset 扩展机制

**当前**：3 个内置 preset（balanced / quality-first / cost-efficient）。

**建议**：支持用户自定义 preset：
```yaml
# spec-driver.config.yaml
preset: custom
custom_preset:
  research_agents: opus
  specify_agents: opus
  implement_agents: sonnet
  verify_agents: haiku
```

这比逐个 Agent 覆盖更直观，也比只有 3 个选项更灵活。

---

## 5. 初始化与项目生命周期建议

### 5.1 Constitution 的渐进式创建

**当前**：缺少 constitution 时阻塞整个流程，要求用户先运行 `/spec-driver.constitution`。

**建议**：
- 第一次运行时提供 **最小 Constitution 模板**（3 条基本原则），用户可以后续增补
- 区分 "严格模式"（有 Constitution 才能运行）和 "快速启动模式"（用默认 Constitution，后续补全）
- OctoAgent 教训：我们的 Bootstrap 流程最初也是强制完成所有配置才能使用——用户反馈"我只是想快速试一下"

### 5.2 多 Feature 并行管理

**当前**：每个 Feature 在 `specs/NNN-xxx/` 目录下独立管理，但没有跨 Feature 的状态视图。

**建议**：
- 添加 `spec-driver status` 命令，显示所有 Feature 的当前阶段
- 支持跨 Feature 依赖声明（Feature B 依赖 Feature A 的某个接口）
- 当多个 Feature 修改同一文件时，在 tasks 阶段发出冲突预警

### 5.3 版本化制品

**当前**：制品（spec.md / plan.md / tasks.md）是 Markdown 文件，修改时直接覆盖。

**建议**：
- 每次门禁通过时自动 snapshot（如 `spec.v1.md`、`spec.v2.md`）
- 或者利用 Git 的能力——在每个门禁通过点自动 commit
- OctoAgent 教训：我们的 Event Sourcing 设计（append-only events + projection）就是为了解决"不知道什么时候改坏了"的问题

---

## 6. Verification 层建议

### 6.1 verify Agent 的 Monorepo 检测增强

**当前**：检测 `package.json workspaces`、`Cargo.toml [workspace]` 等。

**缺失**：
- uv workspace（Python，`pyproject.toml` 的 `[tool.uv.workspace]`）
- Nx/Turborepo workspace（`nx.json`、`turbo.json`）
- OctoAgent 本身就是 uv workspace（12 个 packages），如果用 spec-driver 开发就会漏检

### 6.2 验证命令的超时保护

**当前**：没有看到验证命令的超时配置。

**风险**：某些测试套件可能运行 10+ 分钟，导致 verify 阶段卡住。

**建议**：
```yaml
verification:
  commands:
    test:
      command: "npm test"
      timeout: 300  # 秒
    build:
      command: "npm run build"
      timeout: 120
```

### 6.3 增量验证

**当前**：每次 verify 都运行完整的 build + lint + test。

**建议**：
- implement 阶段记录修改的文件列表
- verify 阶段优先运行受影响的测试（如 `npm test -- --related {changed_files}`）
- 完整验证作为 GATE_VERIFY 的可选行为（`full_verification: true`）
- OctoAgent 教训：我们有 2350 个测试，全量运行需要 3+ 分钟——增量验证大幅加速迭代

---

## 7. 面向 OctoAgent 集成的建议

OctoAgent 后续开发将使用 spec-driver 的 feature/story/fix/implement 流程。以下是从集成角度的建议：

### 7.1 Python 项目支持完善

**当前**：verify Agent 对 Python 的支持是 `ruff check .` + `pytest`。

**需要增加**：
- `mypy --strict`（OctoAgent 强制类型注解）
- `uv run pytest`（uv 环境隔离）
- `uv build`（包构建验证）
- Python monorepo 检测（`uv workspace` 或 `pyproject.toml` 的 `packages` 字段）

### 7.2 大型代码库的上下文管理

**OctoAgent 现状**：
- 12 个 packages，总代码量 ~50K 行
- `agent_context.py` 单文件 4200+ 行
- 修改 A 模块经常需要同步修改 B/C 模块

**建议**：
- implement Agent 应支持 **依赖分析**——修改某个模块时，自动识别受影响的模块
- tasks 阶段应包含 **跨包影响评估**
- 对于大文件（>1000 行），implement Agent 应使用 Edit 工具而非 Write 重写

### 7.3 Blueprint 同步集成

**OctoAgent 规范**：任何影响架构的代码改动完成后，必须同步更新 `docs/blueprint.md`。

**建议**：
- 在 verify 阶段添加 **Blueprint 一致性检查**——如果代码变更涉及架构级修改（新增/删除模块、权限模型变更等），检查 Blueprint 是否同步更新
- 或者在 tasks 模板中内置 "Update Blueprint" 任务，确保不遗漏

---

## 8. 优先级排序

| 优先级 | 建议 | 预估工作量 | 预期收益 |
|--------|------|-----------|---------|
| **P0** | SKILL.md 编排逻辑拆分为 Prompt + YAML 配置 | 3-5 天 | 可维护性大幅提升，新增模式成本降低 80% |
| **P0** | 子 Agent 制品 Schema 显式化 | 2-3 天 | 消除隐式契约风险，resume 准确性提升 |
| **P0** | Trace 日志机制 | 1-2 天 | 问题排查效率提升 10x |
| **P1** | sync.md 复杂算法提取为工具 | 2 天 | 合并结果可靠性提升 |
| **P1** | 配置校验前移 + effective config 命令 | 1 天 | 用户体验改善 |
| **P1** | implement 验证由编排器执行（非 Agent 自报告） | 2 天 | 验证可靠性从"依赖 Prompt Following"提升到"确定性执行" |
| **P2** | Constitution 渐进式创建 | 1 天 | 降低首次使用门槛 |
| **P2** | verify 增量验证 + 超时保护 | 1-2 天 | 大型项目验证速度提升 |
| **P2** | Python/uv workspace 支持完善 | 1 天 | 覆盖更多项目类型 |
| **P3** | 多 Feature 并行管理 + 冲突预警 | 3 天 | 复杂项目场景支持 |
| **P3** | 制品版本化 | 1 天 | 可审计、可回滚 |

---

## 9. 代码质量补充观察

### 9.1 LLM Client 重复代码

`src/core/llm-client.ts` 中有 3 个近乎相同的 LLM 调用实现（SDK / CLI Proxy / Codex Proxy），重试逻辑重复率约 95%。

**建议**：提取通用重试 wrapper，3 个实现只保留 auth/transport 差异部分。

### 9.2 scripts/ 的健壮性

`init-project.sh`（306 行）和 `scan-project.sh`（200+ 行）是 Bash 脚本，包含复杂的 JSON 输出构建。

**风险**：
- Bash JSON 构建容易因特殊字符（引号、换行）崩溃
- 跨平台兼容性（macOS vs Linux 的 `sed`/`date` 差异）

**建议**：考虑用 Node.js 脚本替代复杂的 Bash 脚本，或至少使用 `jq` 构建 JSON。

### 9.3 模型超时上限

硬编码的 900 秒超时上限可能不够——对于非常大的 spec（如 OctoAgent 的 blueprint.md 有 4000+ 行），Opus 可能需要更长时间。建议通过配置开放：

```yaml
model_compat:
  timeout:
    default: 300
    max: 1800  # 可配置上限
    context_scale_factor: 1.5
```

---

## 10. 总结

spec-driver 的核心设计理念（质量门禁、Evidence-Based 验证、多模式编排）是正确的。以上建议的核心思路是：

1. **结构化替代自然语言**——编排逻辑用 YAML，制品契约用 Schema，算法用代码
2. **可观测性优先**——Trace 日志、effective config 展示、降级通知
3. **信任边界清晰**——验证由编排器执行，不信任 Agent 自我报告
4. **渐进式体验**——Constitution 快速启动、增量验证、配置继承

这些改进将使 spec-driver 在 OctoAgent 这样的大型项目（12 packages、50K+ 行代码、4200 行单文件）中更加可靠地运行。

---

*本文档基于 OctoAgent 项目 4 个月研发经验和 cc-plugin-market 代码深度分析撰写。*
