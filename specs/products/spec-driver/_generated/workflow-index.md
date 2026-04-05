# Spec Driver Workflow Registry

- Generated At: 2026-04-05T03:18:55.083Z
- Source Dir: plugins/spec-driver/workflows
- Override Dir: .specify/workflows
- Workflows: 6
- Golden Paths: 3

## 如何选择技能

| Workflow | Persona | Use Cases | Claude | Codex |
| --- | --- | --- | --- | --- |
| `spec-driver-doc` | 开源维护者 | README 生成 / 文档套件补齐 / 对外文档整理 | `/spec-driver:spec-driver-doc` | `$spec-driver-doc` |
| `spec-driver-feature` | 功能开发者 | 全新功能 / 大型需求 / 需要完整调研与质量门 | `/spec-driver:spec-driver-feature <需求描述>` | `$spec-driver-feature <需求描述>` |
| `spec-driver-fix` | 修复者 | Bug 修复 / 定位与修复回归问题 | `/spec-driver:spec-driver-fix <问题描述>` | `$spec-driver-fix <问题描述>` |
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
- Artifacts: specs/products/product-mapping.yaml / specs/products/<product>/current-spec.md / specs/products/<product>/_generated/entity.yaml / specs/products/_generated/catalog-index.yaml / specs/products/<product>/_generated/quality-report.md / specs/products/<product>/_generated/quality-report.json / specs/products/_generated/quality-report-index.yaml / specs/products/<product>/_generated/scorecard-report.md / specs/products/<product>/_generated/scorecard-report.json / specs/products/_generated/scorecard-index.yaml / specs/products/spec-driver/_generated/adoption-report.md / specs/products/spec-driver/_generated/adoption-report.json
- Recommended When: 需要刷新产品事实源 / 为 doc/scorecard/adoption 提供上游事实 / 需要刷新持续治理与反馈视图
- Claude Entry: `/spec-driver:spec-driver-sync`
- Codex Entry: `$spec-driver-sync`
