# Feature 087: 编排架构升级 + 治理精简

## 概述

提升 spec-driver 编排架构的可观测性、制品合同覆盖和执行效率，同时精简过度工程化的治理脚本。核心交付：Trace 日志、14 个 Agent 制品 Schema、SKILL.md 自适应入口检测和性能优化、生成脚本分层、Constitution 可量化约束、contributor-guide.md。

**注**：SKILL.md 万行拆分（orchestration.yaml 提取）工作量最大且风险最高（需完整测试 7 种模式行为不变性），标记为 Phase 2 后续迭代，本次不执行。

## User Stories

1. **作为编排流程使用者**，我希望每次 Feature 执行后有完整的 Trace 日志，可以看到每个 Phase 的耗时、Gate 决策和降级事件。
2. **作为 Agent Prompt 维护者**，我希望每个 Agent 的输出有显式 Schema（路径、必选章节、校验规则），新增 Agent 时契约即文档。
3. **作为 Story 模式用户**，我希望如果 feature 目录中已有 spec.md/plan.md，编排器自动跳过对应阶段，而非重新生成。
4. **作为新贡献者**，我希望有一份 contributor-guide.md 说明"改 X 文件需要做什么"。
5. **作为项目治理者**，我希望实验性脚本（scorecards/adoption/workflow-registry）不在 repo:sync 主链路执行。

## Functional Requirements

### FR-1: Trace 日志机制
- 各 SKILL.md 编排器在执行过程中写入 `specs/{feature}/trace.md`
- 记录内容：Phase 启停时间、产物统计（行数/字数）、降级事件、Gate 决策（策略+结果+原因）、失败重试
- trace.md 格式为时间线 Markdown（`[HH:MM:SS] phase: EVENT`）

### FR-2: 子 Agent 制品 Schema
- 为 14 个 `plugins/spec-driver/agents/*.md` 创建对应的 `*.artifact.yaml`
- 每个 Schema 定义：输出路径模板、必选章节（required_sections）、可选章节（optional_sections）
- analyze Agent 可基于 Schema 校验前序制品完整性

### FR-3: 自适应入口检测
- 各 SKILL.md（feature/story/implement）初始化阶段扫描 feature 目录已有制品
- spec.md 存在 → 跳过 specify，直接进 GATE_DESIGN
- plan.md 存在 → 跳过 plan
- tasks.md 存在 → 跳过 tasks，直接进 GATE_TASKS
- 跳过时输出：`[自适应] 检测到已有 {artifact}，跳过 {phase} 阶段`
- 本质是 resume 的泛化

### FR-4: Constitution 内联检查
- 将 Constitution 检查从独立 agent 调用改为主线程内联执行
- 读取 constitution.md，对比需求描述中的关键词与宪法原则
- 仅在检测到潜在 VIOLATION 时才启动完整 agent 分析
- 无违反时直接输出 `[Constitution] PASS（内联检查）`

### FR-5: Plan + Tasks 合并调用
- story 模式下将 plan 和 tasks 合并为一次 agent 调用
- 在 prompt 中同时要求生成 plan.md 和 tasks.md 两个文件

### FR-6: 增量验证策略
- 编排器根据 `git diff --name-only` 判定变更类型：
  - Level 0（仅 Markdown/YAML/JSON/Bash）→ `repo:check` + lint
  - Level 1（涉及 src/）→ build + lint + 受影响测试
  - Level 2（涉及核心模块/测试基础设施）→ 全量 build + lint + test

### FR-7: 错误传播链路补全
- 并行降级时记录降级原因到 trace.md
- Agent 失败的 root cause 传播到最终 verification-report
- 模板加载 fallback 时通知用户（非静默）

### FR-8: 生成脚本矩阵分层
- 核心脚本保留在 `plugins/spec-driver/scripts/`：entity-catalog、quality-reports、project-context 相关
- 实验性脚本移到 `plugins/spec-driver/scripts/experimental/`：scorecards、adoption-insights、workflow-registry
- `repo:sync` 主链路只执行核心脚本

### FR-9: sync 文档健康度检查
- sync.md 在生成产品活文档时增加健康度指标
- 膨胀检测：current-spec.md >1000 行 → 建议拆分
- 陈旧检测：近 3 个 Feature 未触及的章节 → 标注"可能过时"

### FR-10: Constitution 可量化约束
- 在 constitution.md Agent 检查流程中增加 Measurable Guardrails：
  - 单文件行数上限（默认 800 行）
  - 循环依赖零容忍
  - silent failure 零容忍（bare except 检测）

### FR-11: contributor-guide.md
- 在 `docs/contributor-guide.md` 中说明改动→同步→校验流程
- 涵盖：改 agent prompt / 改 SKILL.md / 改 contract / 改 shared docs / 版本 bump 各场景

## 非功能需求

- **NFR-1**：所有 SKILL.md 变更为追加型，不删除现有逻辑
- **NFR-2**：脚本目录重组后 `npm run repo:check` 仍然 pass
- **NFR-3**：artifact.yaml 为辅助文档，不引入运行时解析依赖

## 验收标准

1. 至少一个 SKILL.md 包含 Trace 写入逻辑
2. 14 个 `agents/*.artifact.yaml` 文件存在且格式合法
3. 至少一个 SKILL.md 包含自适应入口检测逻辑
4. story SKILL.md 包含 Plan+Tasks 合并调用逻辑
5. 至少一个 SKILL.md 包含增量验证策略
6. `plugins/spec-driver/scripts/experimental/` 目录存在且含实验性脚本
7. `docs/contributor-guide.md` 存在且 >30 行
8. constitution.md 包含 Measurable Guardrails
9. sync.md 包含文档健康度检查
10. `npm run repo:check` 全部 pass
