---
feature: 090-implement-mid-gate
type: tech-research
date: 2026-04-06
research_mode: tech-only
---

# 技术调研：实现中期门禁（GATE_IMPLEMENT_MID）

## 1. 业界 CI/CD 阶段性质量门实践

### 1.1 GitHub Actions

GitHub Actions 的 matrix strategy 支持在多配置下并行运行 job，但**原生不提供 job 内的中间检查点机制**。现有能力聚焦于 job 级别的流控：

- **Job 依赖（`needs`）**：通过 `needs` 关键字实现 job 间的串行依赖，某个 job 完成后才能触发下游 job。这本质上是一个 stage gate，但粒度在 job 级别而非 step 级别。
- **Environment protection rules**：可为特定 environment 配置 required reviewers、wait timer、deployment branches 等保护规则，实现部署前的审批门禁。
- **Reusable workflows + conditional steps**：通过 `if` 条件和 reusable workflow 可以组合出"前半段完成后检查、再决定是否执行后半段"的模式，但需要开发者手动编排。

GitHub Actions 的 2025-2026 平台更新将 runner 冷启动优化到亚秒级别，每日处理 7100 万 job，但未引入原生的 mid-step checkpoint 功能。

**关键发现**：GitHub Actions 的质量门是 **job/environment 级别**的粗粒度门禁，不支持 step 内的动态中断点。

> 参考：[Advanced Usage of GitHub Actions Matrix Strategy](https://devopsdirective.com/posts/2025/08/advanced-github-actions-matrix/)、[GitHub Actions Matrix Strategy Best Practices](https://codefresh.io/learn/github-actions/github-actions-matrix/)

### 1.2 GitLab Pipeline

GitLab CI/CD 提供了业界最成熟的**阶段性审批门禁**体系，分为两层：

- **Manual Jobs（`when: manual`）**：将某个 job 标记为手动触发。配合 `allow_failure: false` 设置为 blocking 状态时，Pipeline 会暂停在该 job 处，直到授权用户点击"Play"按钮继续。这是最接近 GATE_IMPLEMENT_MID 概念的 CI/CD 原生机制。
- **Deployment Approvals（Protected Environments）**：支持为受保护环境配置多人审批规则，部署 job 会在所有 required approvals 通过后才执行。默认情况下，触发 Pipeline 的用户不能同时审批自己触发的部署 job（分离关注点）。
- **Stage Gate 模式**：GitLab Pipeline 以 stage 为单位自然形成 gate——前一个 stage 的所有 job 必须成功，后一个 stage 才会启动。结合 `when: manual` 可以在任意 stage 之间插入人工检查点。

**关键发现**：GitLab 的 `when: manual` + `allow_failure: false` 组合是经典的**阻塞式中间门禁模式**，与本项目 GATE_IMPLEMENT_MID 的"暂停等待确认"语义高度吻合。

> 参考：[GitLab Deployment Approvals](https://docs.gitlab.com/ci/environments/deployment_approvals/)、[Manual Gates and Safe Deployments](https://sivabuilds.medium.com/gitlab-zero-to-hero-day-12-d01b38979a1e)

### 1.3 Jenkins Pipeline

Jenkins 通过 Plugin 生态提供了最细粒度的流程控制：

- **Input Step Plugin**：在 Pipeline 执行过程中暂停，等待用户交互输入后再继续。支持展示信息给用户、收集用户输入参数。点击"Proceed"继续，点击"Abort"中止。这是 **step 级别的同步门禁**，粒度最细。
- **Milestone Step Plugin**：强制构建按顺序通过检查点——如果一个较新的构建已经通过某个 milestone，则较旧的构建会被自动取消。主要用于 Continuous Delivery 场景下确保交付顺序。
- **Lock + Milestone 组合模式**：Lock 限制并发、Milestone 确保顺序，两者配合实现安全的中间质量门。三个并发构建到达 input step 后，若用户允许其中一个通过 milestone，其余较旧的构建会自动取消。
- **SonarQube Quality Gate + Input Step**：典型集成模式是在 SonarQube 分析完成后用 input step 展示质量门结果，人工确认后再继续部署。

**关键发现**：Jenkins 的 input step 是**业界最接近"执行中途暂停、展示检查结果、等待人工确认"**的成熟模式，其语义与 GATE_IMPLEMENT_MID 几乎完全一致。

> 参考：[Jenkins Pipeline Input Step](https://www.jenkins.io/doc/pipeline/steps/pipeline-input-step/)、[Pipeline Milestone Step](https://plugins.jenkins.io/pipeline-milestone-step/)、[Stage Lock and Milestone](https://www.jenkins.io/blog/2016/10/16/stage-lock-milestone/)

### 1.4 SonarQube Quality Gate

SonarQube 的 Quality Gate 是业界应用最广泛的**基于阈值的自动化质量门**：

- **Clean as You Code（CaYC）**原则：默认 Sonar Way 质量门聚焦于新增/修改代码的质量，要求 Reliability、Security、Maintainability 评级均达到 A 级，代码覆盖率阈值默认 80%。
- **可配置阈值**：每个质量门由一组 condition + threshold 组成，支持按项目类型定义不同标准。
- **Pipeline 集成**：通过 `sonar.qualitygate.wait=true` 让扫描器等待质量门结果，超时默认 300 秒。质量门失败时 Pipeline 自动中断。
- **增量分析**：聚焦于"新增代码质量"而非"存量代码质量"，避免存量技术债务阻塞交付。

**关键发现**：SonarQube 的"增量分析 + 阈值判定 + 自动阻断"模式与 GATE_IMPLEMENT_MID 的"检查已完成任务的代码质量"思路一致。但 SonarQube 是全量扫描后一次性判定，不支持"完成 50% 时中间检查"。

> 参考：[SonarQube Quality Gates](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates)、[Integrating Quality Gates into CI/CD](https://www.sonarsource.com/resources/library/integrating-quality-gates-ci-cd-pipeline/)

### 1.5 业界共性模式总结

从上述四个平台的实践中提炼出以下共性模式：

| 模式 | 核心机制 | 粒度 | 代表平台 |
|------|---------|------|---------|
| **Stage Gate** | Stage 间自然隔离 | 粗（Stage 级） | GitLab、GitHub Actions |
| **Manual Approval** | 阻塞式人工审批 | 中（Job 级） | GitLab `when:manual`、Jenkins `input` |
| **Threshold Gate** | 基于指标阈值自动判定 | 细（指标级） | SonarQube |
| **Milestone Ordering** | 确保执行顺序，取消过时构建 | 中（Build 级） | Jenkins Milestone |

**对 GATE_IMPLEMENT_MID 的启示**：

1. **阻塞式暂停是成熟模式**：GitLab 和 Jenkins 都证明了"执行中途暂停等待人工确认"是安全可靠的模式
2. **轻量检查优于全量扫描**：SonarQube 的 CaYC 理念（聚焦增量变更）应被 GATE_IMPLEMENT_MID 采纳
3. **配置化策略**：所有平台都支持按项目/环境自定义门禁行为（strict/balanced/autonomous 的映射）
4. **自动跳过机制**：小变更不应触发重量级门禁（对应 <=5 tasks 自动跳过的设计）

> 参考：[The Importance of Pipeline Quality Gates](https://www.infoq.com/articles/pipeline-quality-gates/)、[Quality Gates: Automated Quality Enforcement](https://testkube.io/glossary/quality-gates)、[CI/CD Automating Quality Gates](https://www.dhirajdas.dev/blog/ci-cd-automating-quality-gates)

---

## 2. AI 编码工具的中途回检机制

### 2.1 Cursor

Cursor 在 2025-2026 年迭代中引入了与检查点相关的多项能力：

- **Agent Hooks（Checkpoint）**：Cursor 支持在 Agent Loop 的关键节点通过 hooks 添加 commit checkpoint，允许开发者在自动化编码过程中创建代码快照。这是一种**被动式检查点**——记录状态以便回滚，但不主动评估代码质量。
- **Agent Mode 配置**：在 Agent Mode 中可配置 rules、tools 和 checkpoints，用于 production-safe automation。暗示 Cursor 已将 checkpoint 视为 Agent 自治工作流的一等公民概念。
- **实时 RL 循环**：Cursor 内部使用 CursorBench 评估套件对每次 model checkpoint 进行回归测试，确保发布到生产的模型版本不会显著退化。这是平台级的质量门，非用户侧的中途回检。
- **Automations（2026）**：2026 年发布的 Automations、Cloud Agents with Computer Use、Bugbot Autofix 等能力进一步增强了自动化工作流，但未公开暴露"实现中途质量评估"的用户可见功能。

**关键发现**：Cursor 的 checkpoint 机制偏向**状态快照与回滚**，而非本项目需要的"中途主动质量评估"。但其 Agent Hooks 架构为在关键点注入自定义检查提供了扩展性。

> 参考：[Cursor AI Review 2026](https://prismic.io/blog/cursor-ai)、[Cursor Beta Features 2026](https://markaicode.com/cursor-beta-features-2026/)

### 2.2 GitHub Copilot Workspace

Copilot Workspace（Technical Preview，2025 年 5 月结束）实现了业界最清晰的 **Plan-Implement-Review 循环**：

- **结构化工作流**：Intent Capture → Plan → Implement → Validate。Plan Agent 捕获用户意图，生成结构化计划，然后按计划实施代码变更。
- **Auto-Validation 实验功能**：通过 `Experiments > Start verify loop after implement` 启用。在 implement 阶段完成后**自动触发验证循环**，发现问题则迭代修复。这是最接近 GATE_IMPLEMENT_MID 的 AI 工具原生能力——但它是在**全部实施完成后**触发，不是在中途。
- **即时可编辑性**：Workspace 中的所有产物（Plan、Implementation）都可以随时被用户编辑、重新生成或撤销。开发者可以在查看 file-specific plan items 的同时编辑代码。
- **版本化上下文**：自动记录变更历史和上下文，支持一键创建 PR。

**关键发现**：Copilot Workspace 的 auto-validation 是**后置式全量验证**，不是中途检查点。但其"plan-implement-review 循环"的思路验证了"实施不是一个不可中断的黑盒"这一理念的价值。

> 参考：[GitHub Next - Copilot Workspace](https://githubnext.com/projects/copilot-workspace)、[Copilot Workspace Auto-validation](https://github.blog/changelog/2025-01-31-copilot-workspace-auto-validation-go-to-definition-and-more/)

### 2.3 Devin

Devin（Cognition Labs）作为首个商业化 AI 软件工程师，其自纠正机制有独特设计：

- **多轮规划与中断**：用户可以在任务执行**中途打断** Devin，澄清指令或调整方向，Devin 会重新规划并继续执行。但这是**用户主动中断**，不是系统自动触发的质量门。
- **显式 Checkpoint 模式**：Devin 官方文档推荐的最佳实践是为多部分任务设定明确检查点：`Plan → Implement chunk → Test → Fix → Checkpoint review → Next chunk`。关键在于让 Devin 在每个显著阶段后暂停，等待人工确认后再继续。
- **Sub-task 定义成功标准**：为每个 sub-task 定义成功标准（What does success look like?）并可选设置 checkpoint，帮助 Devin 保持聚焦、减少错误。
- **已知限制**：Devin 对前期范围定义清晰的任务表现较好，但对中途需求变更的适应性较弱——中途不断追加指令会导致性能下降。

**关键发现**：Devin 的 checkpoint 模式是**被动推荐的最佳实践**（需用户在 prompt 中显式请求），而非平台强制的质量门。但其 chunk-based 实施 + checkpoint 的模式与 GATE_IMPLEMENT_MID 的"完成一半后检查"高度同构。

> 参考：[Devin Agents 101](https://devin.ai/agents101)、[Instructing Devin Effectively](https://docs.devin.ai/essential-guidelines/instructing-devin-effectively)、[Devin 2025 Performance Review](https://cognition.ai/blog/devin-annual-performance-review-2025)

### 2.4 Claude Code

Claude Code 在检查点和门禁方面有以下相关机制：

- **File Checkpointing（Agent SDK）**：SDK 层面的文件检查点系统，在每次文件修改前自动创建备份，支持通过 `client.rewind_files(checkpoint_id)` 程序化回滚到任意历史状态。核心目标是**安全网**而非质量评估。
- **Rewind 机制**：用户可通过 `Esc+Esc` 或 `/rewind` 命令打开回滚菜单，选择恢复代码状态和/或对话上下文。这是**事后补救**而非**事中预防**。
- **Specification-Grounded Review（学术研究）**：2025-2026 年的研究表明，将 review 锚定在人编写的 specification 上可将开发者采纳率提升 90.9%。这直接支持 GATE_IMPLEMENT_MID 使用 spec.md / tasks.md 作为检查基准的设计。
- **已识别需求**：开发者社区已提出在 headless Claude Code 中暴露 checkpoint restore/rewind API 的 Feature Request，表明业界认可在 Agent 自治执行过程中嵌入检查点的价值。

**关键发现**：Claude Code 当前的检查点机制面向**回滚安全**而非**中途质量评估**。但学术研究验证了"基于 spec 的中途检查"能显著提升代码质量和开发者信任度。

> 参考：[Claude Code Checkpointing](https://code.claude.com/docs/en/checkpointing)、[Agent SDK File Checkpointing](https://platform.claude.com/docs/en/agent-sdk/file-checkpointing)、[Specification as Quality Gate](https://arxiv.org/html/2603.25773)

### 2.5 AI Agent 自纠正模式总结

| 工具 | 中途检查方式 | 触发机制 | 评估基准 | 成熟度 |
|------|-------------|---------|---------|--------|
| Cursor | Agent Hook checkpoint | 被动（记录快照） | 无自动评估 | 初级 |
| Copilot Workspace | Auto-validation loop | 自动（实施后触发） | Plan 对比 | 中等（已关闭） |
| Devin | Chunk + Checkpoint review | 被动（需 prompt 请求） | Sub-task 成功标准 | 中等 |
| Claude Code | File checkpoint + Rewind | 被动（自动快照） | 无自动评估 | 初级 |
| **GATE_IMPLEMENT_MID（本项目）** | **50% 任务门禁** | **自动（条件触发）** | **spec.md + tasks.md** | **待实现** |

**关键共性**：

1. **没有任何主流 AI 编码工具实现了"实现中途自动触发质量评估"**——这是一个差异化能力
2. 现有检查点机制偏向"状态快照 + 回滚"，不做主动质量判定
3. Devin 的 chunk-based checkpoint 和 Copilot Workspace 的 auto-validation 验证了"中途检查"的产品价值
4. 基于 specification 的 review（而非通用代码分析）是提升检查有效性的关键

---

## 3. 检查点触发粒度评估

### 3.1 方案对比表

| 方案 | 实现复杂度 | 误触发率 | 漏检率 | YAGNI 契合度 | 推荐度 |
|------|-----------|---------|--------|-------------|--------|
| **A: 固定 50%** | 低（计算 checkbox 完成比即可） | 中（小型变更可能不需要门禁，但已通过 <=5 tasks 跳过缓解） | 中（50% 不一定是架构风险出现的时机） | **高**（规则简单、无额外依赖） | **推荐** |
| B: 文件变更量 | 中（需实时追踪 git diff 或文件修改计数器） | 低（大变更确实需要检查） | 高（少量文件的高风险变更可能被跳过） | 中（需额外 git 集成逻辑） | 可选 |
| C: 风险等级 | 高（需定义模块风险矩阵、解析 tasks.md 中的文件路径和标记） | 低（精准触发） | 低（按风险触发最准确） | **低**（需引入风险评估框架，违反"如无必要勿增实体"） | 不推荐 |
| D: 混合策略 | 高（A+C 的组合，两套逻辑都要实现） | 低 | 低 | **低**（组合增加复杂度） | 不推荐 |

### 3.2 各方案详细分析

#### 方案 A：固定 50% 任务完成时触发

- **实现**：在 implement 子代理完成每个 task 后检查 tasks.md 中 `[x]` 的比例，达到 >= 50% 时触发门禁
- **优势**：规则确定性高、零额外依赖、编排器只需读取 tasks.md 的 checkbox 状态
- **劣势**：无法感知"前 50% 的任务可能全是低风险的基础设施搭建"
- **缓解**：<=5 tasks 自动跳过已覆盖最常见的"小变更无需门禁"场景
- **YAGNI 评估**：完全符合——不引入新的抽象概念、配置项或依赖

#### 方案 B：按文件变更量动态触发

- **实现**：在实施过程中累计变更文件数，超过阈值（如 20 文件）时触发
- **优势**：与变更规模直接相关，大规模重构时能及时拦截
- **劣势**：需要在编排器层维护变更文件计数器（或调用 `git diff --stat`）；阈值选择困难（20 文件对 monorepo 可能太低，对小项目可能太高）
- **YAGNI 评估**：引入了文件计数机制和阈值配置，中等复杂度

#### 方案 C：按风险等级动态触发

- **实现**：为 tasks.md 中的每个 task 定义风险标记（如 `[HIGH_RISK]`），或通过文件路径模式匹配（如 `src/core/` 下的修改为高风险）
- **优势**：精准度最高，低风险任务不会被无谓打断
- **劣势**：需要定义风险矩阵、解析 tasks.md 的文件路径、维护高风险路径配置，过早引入复杂的风险评估框架
- **YAGNI 评估**：明确违反——引入了当前没有使用场景的风险评估框架

#### 方案 D：混合策略（50% + 风险感知）

- **实现**：默认 50% 触发 + 遇到高风险标记的 task 时提前触发
- **优势**：兼顾确定性和精准度
- **劣势**：两套触发逻辑增加维护成本和测试面，规则交互可能产生意外行为
- **YAGNI 评估**：不符合——在方案 A 的价值未被验证前就叠加方案 C 的能力

### 3.3 推荐方案及理由

**推荐方案 A（固定 50%），理由如下**：

1. **YAGNI 原则**：宪法原则 III 明确要求"不为假设性未来需求增加抽象层"。方案 A 是最小可用方案，在其价值被实际使用验证后，再考虑向 B/C/D 演进
2. **已有缓解机制**：<=5 tasks 的自动跳过规则已经覆盖了"小任务不需要门禁"的场景
3. **与现有 gate 机制一致**：项目中的 GATE_TASKS、GATE_VERIFY 等门禁都是基于确定性条件（Phase 完成/制品存在）触发，不做动态风险评估
4. **可测试性**：固定阈值的判定逻辑可以用纯逻辑测试覆盖，不依赖外部状态
5. **演进路径清晰**：若实际使用中发现 50% 触发点不理想，可以在不改变架构的前提下调整为可配置阈值

---

## 4. 架构方案选型

### 4.1 方案 1：编排器层注入（在 spec-driver-implement SKILL.md 追加门禁）

**描述**：在 `spec-driver-implement/SKILL.md` 的 Phase 4（Implementation）中，将现有的单次子代理调用拆分为两段式执行：

```text
Phase 4a: 前半段实施
  → 调用 implement 子代理，附加指令"执行 tasks.md 中前 50% 的任务后返回"
  → 子代理完成后，返回中间进度报告

GATE_IMPLEMENT_MID: 中期门禁（编排器亲自执行）
  → 检查已完成任务的代码质量信号
  → 验证 tasks.md 前置假设是否仍成立
  → 暂停 / 自动继续

Phase 4b: 后半段实施
  → 调用 implement 子代理，继续剩余任务
```

**优势**：
- 与现有 gate 模式（GATE_TASKS、GATE_VERIFY）完全一致——都是编排器层的阶段间门禁
- 编排器拥有完整上下文（spec.md、plan.md、tasks.md），可以做全局性的一致性检查
- 门禁配置复用现有 `gate_policy` 和 `gates` 字段，只需增加 `GATE_IMPLEMENT_MID` 条目
- 不修改 `implement.md` 子代理的职责边界

**劣势**：
- 需要拆分 Phase 4 为 4a/4b，或将 GATE_IMPLEMENT_MID 作为 Phase 4 内的 sub-phase
- implement 子代理需要理解"只执行前 N% 的任务然后返回"的指令，当前 `implement.md` 的执行流程是"逐 Phase 执行所有任务"
- 子代理返回后的上下文连续性问题：第二次调用的子代理需要理解第一次的产出

### 4.2 方案 2：子代理层注入（在 implement.md 追加自检逻辑）

**描述**：在 `implement.md` 子代理的执行流程中，在完成 50% 任务后插入一个自检步骤：

```text
implement.md 内部：
  1. 加载任务清单
  2. 逐 Phase 实现
     → 每完成一个 task，检查总完成率
     → 若 >= 50% 且 total_tasks > 5：
       执行内联自检：
       a. 已变更文件是否引入架构劣化信号
       b. tasks.md 前置假设是否仍成立
       c. 输出自检报告
       d. 若发现 CRITICAL 问题 → 返回编排器并附上报告
       e. 若仅 WARNING 或 PASS → 继续执行
  3. 继续剩余任务
```

**优势**：
- 不拆分 Phase 4，实施阶段保持一次调用的连续性
- 子代理内部的自检更贴近代码上下文（已 Read 过的文件、已建立的理解）
- 避免子代理二次调用的上下文丢失问题

**劣势**：
- **违反现有架构原则**：当前项目中，门禁决策（暂停/继续）由编排器控制（见 SKILL.md 中的 GATE_TASKS、GATE_VERIFY 模式），子代理不负责流程控制
- 子代理自检的质量取决于 LLM 的自我审查能力——correlated errors 问题（同一个 LLM 编写和审查代码，可能放大而非纠正同类错误）
- 门禁配置（`gate_policy`、`gates`）在编排器层管理，子代理无法感知这些配置
- 无法实现"暂停等待用户确认"的交互模式（子代理无 UI 交互能力）

### 4.3 推荐方案及理由

**推荐方案 1（编排器层注入），理由如下**：

1. **架构一致性**：所有现有门禁（GATE_RESEARCH、GATE_DESIGN、GATE_ANALYSIS、GATE_TASKS、GATE_VERIFY）都在编排器层实现，GATE_IMPLEMENT_MID 应遵循同一模式。如 SKILL.md 所述："此阶段由编排器亲自执行，不委派子代理"是门禁阶段的标准做法。

2. **关注点分离**：`implement.md` 子代理的职责是"按 tasks.md 逐步实现代码"，不应承担流程控制和质量门判定。编排器负责编排和门禁，子代理负责执行——这是项目宪法中明确的分工。

3. **门禁配置复用**：方案 1 可以直接复用 `gate_policy` / `gates.GATE_IMPLEMENT_MID.pause` 配置体系，无需引入新的配置路径。

4. **correlated errors 规避**：2025-2026 年的研究表明"同质 LLM Pipeline 中的关联错误会放大而非取消"。编排器层的检查可以使用不同的 review 视角（对比 spec/plan vs 已完成代码的偏差），而非依赖 implement 子代理自我审查。

5. **用户交互能力**：编排器可以暂停 Pipeline 并展示检查结果给用户（与 GATE_TASKS 的交互模式一致），子代理无此能力。

**实现建议**：

- 在 SKILL.md 的 Phase 4 中增加 Phase 4a / GATE_IMPLEMENT_MID / Phase 4b 三段结构
- implement 子代理的 prompt 中增加"执行到第 N 个任务后返回中间报告"的指令
- 门禁检查内容保持轻量：(1) 已变更文件列表 + 架构劣化信号扫描 (2) tasks.md 前置假设验证
- <=5 tasks 时跳过门禁，直接执行完整 Phase 4

---

## 5. 技术风险清单

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|---------|
| **子代理二次调用的上下文丢失**：Phase 4b 的 implement 子代理可能丢失 4a 建立的文件理解和代码上下文 | 高 | 中 | 4b 的 prompt 中注入 4a 的执行摘要（变更文件列表、已完成 task ID）；复用 tasks.md 的 `[x]` 标记作为进度状态 |
| **50% 触发点不精准**：前 50% 的任务可能全是低风险的基础设施搭建，真正的架构风险在后 50% | 中 | 低 | Phase 5（Verification）仍会执行完整的 spec-review + quality-review + verify 三层检查，GATE_IMPLEMENT_MID 是额外的早期预警，不是唯一防线 |
| **门禁检查内容过重导致延迟**：若检查内容过于复杂（如全量 AST 分析），会显著增加实施周期 | 中 | 中 | 检查内容严格限制为轻量级信号扫描（文件列表 + 假设验证），不做全量代码分析。宪法原则 III 约束检查范围 |
| **用户体验退化**：频繁暂停打断实施流程，降低开发者信任和效率 | 中 | 高 | <=5 tasks 自动跳过；`autonomous` gate_policy 下 GATE_IMPLEMENT_MID 默认 `on_failure`（仅发现问题时暂停）；`balanced` 下默认 `auto`（仅记录日志） |
| **correlated errors**：编排器使用同一个 LLM 做门禁检查，可能无法发现 implement 子代理引入的系统性偏差 | 低 | 中 | 门禁检查聚焦于"结构性信号"（文件路径对比 plan、假设条件验证）而非"代码正确性判断"，降低对 LLM 判断力的依赖 |
| **tasks.md 解析复杂度**：tasks.md 格式多样（Phase 分组、子任务嵌套、标记符号），解析 50% 完成点可能不稳定 | 低 | 低 | 使用简单的 `[x]` / `[ ]` 正则匹配计算完成比，不做复杂的语法解析。若匹配失败则跳过门禁并记录 warning |

---

## 6. 关键结论

1. **业界验证了"执行中途暂停检查"的成熟性**：Jenkins input step、GitLab manual gate 都是生产级的中间门禁模式，证明 GATE_IMPLEMENT_MID 的设计思路有坚实的工程基础。

2. **AI 编码工具尚无"自动中途质量评估"的先例**：现有工具（Cursor、Copilot Workspace、Devin、Claude Code）的检查点机制偏向状态快照和回滚，GATE_IMPLEMENT_MID 作为主动式中途质量门是差异化能力。

3. **推荐固定 50% 触发 + 编排器层注入**：方案 A（固定 50%）的实现复杂度最低、与 YAGNI 原则最契合；编排器层注入与现有 GATE_TASKS / GATE_VERIFY 的架构模式一致，不引入新的抽象层。

4. **检查内容必须保持轻量**：聚焦两个信号——(1) 已完成任务的代码是否引入架构劣化信号 (2) tasks.md 前置假设是否仍成立。不做全量代码分析、不做性能评估、不做安全扫描——这些是 Phase 5 Verification 的职责。

5. **<=5 tasks 自动跳过是关键的 YAGNI 守护**：避免对小型变更施加不必要的流程负担，确保门禁只在有价值的场景下生效。`balanced` 策略下 GATE_IMPLEMENT_MID 应默认 `auto`（仅记录），`strict` 下 `always`（强制暂停），`autonomous` 下 `on_failure`（仅异常暂停）。
