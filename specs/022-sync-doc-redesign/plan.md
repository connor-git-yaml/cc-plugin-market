# Implementation Plan: sync / doc 文档架构重设计

**Branch**: `022-sync-doc-redesign` | **Date**: 2026-03-07 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/022-sync-doc-redesign/spec.md`

## Summary

本次重设计不合并 `speckit-sync` 和 `speckit-doc`。`sync` 继续负责把增量 spec 聚合为产品级活文档，但增加一个明确的“对外文档摘要”层，作为 `doc` 的权威上游输入；`doc` 则在存在 `current-spec.md` 时优先消费该摘要来生成 README / 使用文档，同时保留现有的项目元信息扫描降级路径。

## Technical Context

**Language/Version**: Markdown Prompt、YAML 配置、Bash 5.x  
**Primary Dependencies**: 无新增运行时依赖；复用现有 `scan-project.sh`  
**Storage**: 文件系统（`plugins/spec-driver/` 与 `specs/022-sync-doc-redesign/`）  
**Testing**: 以静态校验、路径引用校验和手工 prompt 审查为主  
**Target Platform**: Claude Code / Codex 的 Spec Driver Prompt 运行时  
**Project Type**: Plugin（`plugins/spec-driver/` 下的 Skill / agent / template / script）  
**Performance Goals**: 不增加额外运行时调用层；`doc` 仅在发现 `current-spec.md` 时多读一个产品文档  
**Constraints**: 保持零运行时依赖；不破坏现有 `sync` 输出路径；维持双语规范  
**Scale/Scope**: 4-6 个文件改动，集中在 `sync` / `doc` 的 Prompt、模板与契约层

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 适用 | PASS | 所有新增说明与设计文档继续使用中文正文 + 英文标识符 |
| II. Spec-Driven Development | 适用 | PASS | 本次先创建 `spec.md` / `research.md` / `plan.md`，再修改 Prompt |
| III. 诚实标注不确定性 | 适用 | PASS | 对外文档摘要与 README 生成均要求对缺失信息标注 `[待补充]` 或 `[推断]` |
| VIII. Prompt 工程优先 | 适用 | PASS | 核心改动集中在 Skill / agent / template，符合插件约束 |
| IX. 零运行时依赖 | 适用 | PASS | 不引入 Node.js 模块或新脚本框架 |
| XII. 向后兼容 | 适用 | PASS | `sync` 保留原有 `current-spec.md` 路径与聚合语义；`doc` 在无 `current-spec` 时保留现有降级链路 |

## Project Structure

### Documentation (this feature)

```text
specs/022-sync-doc-redesign/
├── spec.md
├── research.md
└── plan.md
```

### Source Code (repository root)

```text
plugins/spec-driver/
├── skills/
│   ├── speckit-sync/SKILL.md
│   └── speckit-doc/SKILL.md
├── agents/
│   └── sync.md
├── templates/
│   └── product-spec-template.md
└── scripts/
    └── scan-project.sh
```

**Structure Decision**: 优先修改 `sync` / `doc` 的 Prompt 与模板层；`scan-project.sh` 仅在需要补充契约注释时调整，不引入新运行时逻辑。

## Design Overview

### 1. `sync` 的新角色

`sync` 继续生成 `current-spec.md`，但其产物将被显式分为三层：

1. **产品/需求层**：产品概述、目标与成功指标、用户画像、范围、功能全集
2. **技术/架构层**：NFR、架构、设计决策、限制、风险、术语
3. **对外文档 handoff 层**：新增一个专供 `doc` 消费的摘要区块，包含 README 电梯陈述、用户价值、核心工作流、对外边界

### 2. `doc` 的新角色

`doc` 仍然负责输出仓库根目录的外部文档套件，但当项目内存在 `specs/products/*/current-spec.md` 时：

- 优先读取 `current-spec.md` 的 handoff 摘要和产品层内容
- 使用 `scan-project.sh` 的结果补齐版本、license、scripts、入口命令、仓库元信息
- 将 `current-spec.md` 视为“事实层”，将 README 视为“面向用户的表达层”

### 3. 不合并命令的原因

- `sync` 输出到 `specs/products/`，是内部产品知识资产
- `doc` 输出到仓库根目录，是外部用户/贡献者资产
- 两者受众、路径、语言和交互方式不同，适合作为上下游，不适合作为同一命令的不同 flag

## File Modification Strategy

### File 1: `plugins/spec-driver/templates/product-spec-template.md`

**目标**:
- 保留现有 14 章节结构
- 新增一个非破坏性的“对外文档摘要”区块，放在附录前或附录后，供 `doc` 消费

**摘要区块建议字段**:
- README 电梯陈述
- 用户价值主张
- 主要用户角色
- 核心工作流（2-4 条）
- 对外不承诺的内部边界

### File 2: `plugins/spec-driver/agents/sync.md`

**目标**:
- 把 `sync` 从“只生成 current-spec 的聚合器”重定义为“产品事实层 + handoff 生产者”
- 明确要求 handoff 摘要必须基于证据，信息不足时标注 `[待补充]`
- 强化“不要把 current-spec 直接写成 README”的边界

### File 3: `plugins/spec-driver/skills/speckit-sync/SKILL.md`

**目标**:
- 更新技能描述与完成报告
- 明确 `sync` 的产物是 `doc` 的上游输入之一
- 不改变命令入口，不改变既有前置检查和聚合路径

### File 4: `plugins/spec-driver/skills/speckit-doc/SKILL.md`

**目标**:
- 在元信息扫描后新增“产品活文档发现”步骤
- 若存在 `current-spec.md`，优先读取 handoff 摘要与相关章节
- 将 README 的项目描述、核心价值、使用场景、功能特性映射到 `current-spec.md`
- 保留当前精简/完整模式、协议选择和冲突处理逻辑

### File 5: `plugins/spec-driver/scripts/scan-project.sh`

**目标**:
- 可选补强：补充或对齐脚本输出契约说明
- 不改变现有 JSON 输出字段，避免破坏现有 `doc` 流程

## Risks

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| `current-spec.md` 的 handoff 摘要与正文冲突 | README 溯源混乱 | 要求 `sync` 先基于正文事实生成摘要，禁止手写独立叙事 |
| `doc` 过度依赖 `current-spec`，导致无 spec 项目不可用 | 破坏向后兼容 | 保持现有 metadata scan 降级路径 |
| 新增区块破坏现有 `current-spec` 阅读体验 | 产品文档变臃肿 | 将 handoff 设计为短摘要区块，避免扩展为第二份 README |
| Prompt 改动过大导致语义漂移 | 输出不稳定 | 本轮只重构职责和输入契约，不同时重写所有章节模板 |

## Recommended Implementation Order

1. 先改 `product-spec-template.md` 和 `sync.md`，把 handoff 摘要定义清楚
2. 再改 `speckit-sync/SKILL.md`，把新职责与完成报告对齐
3. 最后改 `speckit-doc/SKILL.md`，让它读取并消费 `current-spec.md`
4. 如有必要，再补 `scan-project.sh` 的契约说明文件
