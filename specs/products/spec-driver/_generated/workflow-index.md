# Spec Driver Workflow Registry

- Generated At: 2026-05-10T12:28:38.979Z
- Source Dir: plugins/spec-driver/workflows
- Override Dir: .specify/workflows
- Workflows: 7
- Golden Paths: 4

## 如何选择技能

| Workflow | Persona | Use Cases | Claude | Codex |
| --- | --- | --- | --- | --- |
| `spec-driver-doc` | 开源维护者 | README 生成 / 文档套件补齐 / 对外文档整理 | `/spec-driver:spec-driver-doc` | `$spec-driver-doc` |
| `spec-driver-feature` | 功能开发者 | 全新功能 / 大型需求 / 需要完整调研与质量门 | `/spec-driver:spec-driver-feature <需求描述>` | `$spec-driver-feature <需求描述>` |
| `spec-driver-fix` | 修复者 | Bug 修复 / 定位与修复回归问题 | `/spec-driver:spec-driver-fix <问题描述>` | `$spec-driver-fix <问题描述>` |
| `spec-driver-implement` | 实施负责人 | 已具备成熟 spec.md 与 plan.md / 聚焦计划审查、任务细化、代码实施与验证 | `/spec-driver:spec-driver-implement [<feature-dir-or-id>]` | `$spec-driver-implement [<feature-dir-or-id>]` |
| `spec-driver-resume` | 流程恢复者 | 上次 feature/story/fix 流程中断 / 从已有产物断点继续 | `/spec-driver:spec-driver-resume` | `$spec-driver-resume` |
| `spec-driver-story` | 迭代开发者 | 中等规模增量需求 / 已有上下文的功能迭代 | `/spec-driver:spec-driver-story <需求描述>` | `$spec-driver-story <需求描述>` |
| `spec-driver-sync` | 产品文档负责人 | 聚合增量 spec / 更新 current-spec 与产品 Catalog | `/spec-driver:spec-driver-sync` | `$spec-driver-sync` |

## Golden Paths

### 新功能研发

- ID: `new-feature-delivery`
- Persona: 功能开发者
- Workflows: `spec-driver-feature` -> `spec-driver-sync` -> `spec-driver-doc`
- Recommended When:
  - 从需求到实现再到文档闭环
  - 需要完整 spec / product fact / doc 更新链路

### 快速修复

- ID: `rapid-fix-delivery`
- Persona: 修复者
- Workflows: `spec-driver-fix` -> `spec-driver-sync`
- Recommended When:
  - 修复问题后同步产品事实
  - 需要最短闭环但仍保留文档更新

### 产品事实与文档更新

- ID: `product-facts-refresh`
- Persona: 产品文档负责人
- Workflows: `spec-driver-sync` -> `spec-driver-doc`
- Recommended When:
  - 增量 spec 已完成，需要刷新 current-spec 和对外文档
  - 适合 release 前或 onboarding 前的文档收口

### 成熟 Spec 聚焦实施

- ID: `mature-spec-delivery`
- Persona: 实施负责人
- Workflows: `spec-driver-implement` -> `spec-driver-sync` -> `spec-driver-doc`
- Recommended When:
  - spec.md 与 plan.md 已成熟，只需推进实施与验证
  - 架构和需求已冻结，希望快速完成交付并同步产品事实

## Workflow Details

### 开源文档生成

- ID: `spec-driver-doc`
- Persona: 开源维护者
- Template Version: 1.0.0
- Use Cases: README 生成 / 文档套件补齐 / 对外文档整理
- Required Inputs: 项目元信息 / current-spec 或其他产品事实源
- Key Gates: GATE_VERIFY
- Artifacts: README.md / CONTRIBUTING.md / LICENSE / docs/ 或其他开源文档
- Recommended When: 需要对外文档交付 / 准备开源发布或 onboarding
- Claude Entry: `/spec-driver:spec-driver-doc`
- Codex Entry: `$spec-driver-doc`

### 新功能研发

- ID: `spec-driver-feature`
- Persona: 功能开发者
- Template Version: 1.0.0
- Use Cases: 全新功能 / 大型需求 / 需要完整调研与质量门
- Required Inputs: 需求描述 / 项目宪法
- Key Gates: GATE_RESEARCH / GATE_DESIGN / GATE_ANALYSIS / GATE_TASKS / GATE_VERIFY
- Artifacts: specs/<feature>/research/ / specs/<feature>/spec.md / specs/<feature>/plan.md / specs/<feature>/tasks.md / specs/<feature>/verification/verification-report.md
- Recommended When: 需求范围较大 / 需要完整调研、规划和验证闭环
- Claude Entry: `/spec-driver:spec-driver-feature <需求描述>`
- Codex Entry: `$spec-driver-feature <需求描述>`

### 快速问题修复

- ID: `spec-driver-fix`
- Persona: 修复者
- Template Version: 1.0.0
- Use Cases: Bug 修复 / 定位与修复回归问题
- Required Inputs: 问题描述
- Key Gates: GATE_VERIFY
- Artifacts: specs/<feature>/spec.md / specs/<feature>/tasks.md / specs/<feature>/verification/verification-report.md
- Recommended When: 问题范围明确 / 需要最短修复闭环
- Claude Entry: `/spec-driver:spec-driver-fix <问题描述>`
- Codex Entry: `$spec-driver-fix <问题描述>`

### 成熟 Spec 实施

- ID: `spec-driver-implement`
- Persona: 实施负责人
- Template Version: 1.0.0
- Use Cases: 已具备成熟 spec.md 与 plan.md / 聚焦计划审查、任务细化、代码实施与验证
- Required Inputs: specs/<feature>/spec.md / specs/<feature>/plan.md
- Key Gates: GATE_TASKS / GATE_VERIFY
- Artifacts: specs/<feature>/plan.md / specs/<feature>/tasks.md / specs/<feature>/verification/verification-report.md
- Recommended When: 需求与设计已成熟，只需聚焦实施和验证 / 希望避免重复调研与重写 spec/plan
- Claude Entry: `/spec-driver:spec-driver-implement [<feature-dir-or-id>]`
- Codex Entry: `$spec-driver-implement [<feature-dir-or-id>]`

### 恢复中断流程

- ID: `spec-driver-resume`
- Persona: 流程恢复者
- Template Version: 1.0.0
- Use Cases: 上次 feature/story/fix 流程中断 / 从已有产物断点继续
- Required Inputs: 已存在的 specs/<feature>/ 制品
- Key Gates: GATE_VERIFY
- Artifacts: 复用既有特性目录 / 补齐缺失阶段制品
- Recommended When: 不想重跑完整流程 / 需要在已有产物上继续推进
- Claude Entry: `/spec-driver:spec-driver-resume`
- Codex Entry: `$spec-driver-resume`

### 快速需求实现

- ID: `spec-driver-story`
- Persona: 迭代开发者
- Template Version: 1.0.0
- Use Cases: 中等规模增量需求 / 已有上下文的功能迭代
- Required Inputs: 需求描述 / 现有代码上下文
- Key Gates: GATE_DESIGN / GATE_VERIFY
- Artifacts: specs/<feature>/spec.md / specs/<feature>/plan.md / specs/<feature>/tasks.md / specs/<feature>/verification/verification-report.md
- Recommended When: 不需要完整市场或技术调研 / 目标是快速交付增量能力
- Claude Entry: `/spec-driver:spec-driver-story <需求描述>`
- Codex Entry: `$spec-driver-story <需求描述>`

### 产品事实聚合

- ID: `spec-driver-sync`
- Persona: 产品文档负责人
- Template Version: 1.0.0
- Use Cases: 聚合增量 spec / 更新 current-spec 与产品 Catalog
- Required Inputs: specs/NNN-xxx/spec.md / 产品映射或可推断产品归属
- Key Gates: GATE_RESEARCH
- Artifacts: specs/products/product-mapping.yaml / specs/products/<product>/current-spec.md / specs/products/<product>/_generated/entity.yaml / specs/products/_generated/catalog-index.yaml / specs/products/<product>/_generated/quality-report.md / specs/products/<product>/_generated/quality-report.json / specs/products/_generated/quality-report-index.yaml / specs/products/<product>/_generated/scorecard-report.md / specs/products/<product>/_generated/scorecard-report.json / specs/products/_generated/scorecard-index.yaml / specs/products/spec-driver/_generated/adoption-report.md / specs/products/spec-driver/_generated/adoption-report.json / .specify/project-context.suggestions.yaml / .specify/project-context.suggestions.md
- Recommended When: 需要刷新产品事实源 / 为 doc/scorecard/adoption 提供上游事实 / 需要刷新持续治理与反馈视图
- Claude Entry: `/spec-driver:spec-driver-sync`
- Codex Entry: `$spec-driver-sync`
