# Feature 085: implement/verify 可靠性硬化

## 概述

强化 spec-driver 的 implement → verify 流水线可靠性，解决 OctoAgent 实战暴露的核心痛点：implement 阶段的 silent failure（6 层异常吞掉链）、God Class 膨胀（单文件 5112 行）、verify 阶段只检查"代码是否存在"而非"是否正确运行"。通过三层验证体系、改动后一致性自检、编排器独立验证、架构守护条目等手段，将验证从"Prompt Following 依赖型"升级为"确定性检查型"。

**文件隔离约束**：本 Feature 与 086 并行开发，仅修改 implement.md / verify.md / quality-review.md / tasks-template.md 和各 SKILL.md 的编排器验证逻辑。不触碰 plan.md / specify.md 等 086 负责的文件。

## User Stories

1. **作为项目开发者**，我希望 implement 阶段不仅检查"退出码 0"，还要验证端到端行为和失败路径，避免 silent failure 通过验证。
2. **作为代码维护者**，我希望大规模重构后自动扫描所有被修改/删除的类型名和枚举值的引用，确认无遗漏。
3. **作为质量守护者**，我希望 verify 能追踪关键调用链的完整性，而非仅检查函数是否存在。
4. **作为架构师**，我希望 quality-review 在检测到文件行数从 <500 增长到 >800 时自动 CRITICAL 阻断，防止 God Class 持续膨胀。
5. **作为编排流程使用者**，我希望验证由编排器独立执行（build+lint+test），不依赖 implement Agent 的自我报告。

## Functional Requirements

### FR-1: implement.md — 三层验证体系
- **Layer 1（现有）**：工具链验证（build + lint + test 退出码 0）
- **Layer 2（新增）**：行为验证 — 每个 FR 的 happy path 需一个端到端可观测验证步骤；无法执行标注 `[E2E_DEFERRED]` 及原因
- **Layer 3（新增）**：失败路径验证 — 涉及外部依赖的模块至少验证 1 个失败场景；禁止 bare except / catch-all 返回空

### FR-2: implement.md — 改动后一致性自检
- 实现完毕→测试前插入自检步骤：搜索所有被修改/删除的类型名、函数名、枚举值在整个代码库中的引用
- 检查新增 import 路径正确性（特别是文件迁移后）
- Pydantic/Zod 模型字段名 + 枚举值一致性检查

### FR-3: SKILL.md — 编排器独立验证
- 各 SKILL.md（feature/story/fix/implement）在 implement 完成后，编排器自行运行 `build + lint + test`
- 不信任 Agent 自我报告的验证结果
- Agent 只需报告修改了哪些文件

### FR-4: tasks-template.md — 架构守护条目
- plan 自动生成 `## Architecture Guard` 节：
  - T-GUARD: 最大文件行数不超过阈值（默认 800 行）
  - T-GUARD: 不引入循环依赖
  - T-GUARD: 不引入 bare except / catch-all-return-empty 模式

### FR-5: tasks-template.md — 原子性约束
- 每个 task 完成后系统必须可通过基础验证（编译/lint）
- 跨层级改动（模型+Store+Service+API）不拆分到不同 task
- 每个 task 附简要验证命令

### FR-6: verify.md — 深度检查
- 关键路径完整性：追踪 FR 的完整调用链（入口→底层），检查参数断链/异常吞掉
- 数据持久化验证：涉及 DB 写入的 FR 检查 commit/flush 存在性
- 配置贯穿验证：配置值从 env→config→constructor→使用点的完整传递

### FR-7: verify.md — 残留扫描
- 涉及删除/重命名时 grep 旧名称，确认代码和文档零残留

### FR-8: quality-review.md — 累积劣化检测
- 新增 STRUCTURAL_DEBT 维度：
  - 单文件 <300→>500：WARNING
  - 单文件 <500→>800：CRITICAL（阻断 implement，要求先拆分）
  - 同一文件在连续 3 个 Feature 中行数持续增长：CRITICAL

### FR-9: verify.md — 文档一致性检查
- 架构文档（Blueprint/README/ADR）引用了被删除/重命名概念时报警

### FR-10: quality-review.md — 跨模块一致性
- 并行子任务完成后全局扫描：import 路径一致性、共享常量/类型定义匹配、未引用已删除符号

## 非功能需求

- **NFR-1 向后兼容**：新增检查步骤为追加型，不修改现有验证逻辑的语义
- **NFR-2 文件隔离**：不修改 plan.md / specify.md / fix SKILL / story SKILL / resume SKILL 中 086 负责的内容

## 验收标准

1. implement.md 包含 Layer 1/2/3 三层验证体系描述和 `[E2E_DEFERRED]` 标注规范
2. implement.md 包含"改动后一致性自检"步骤（在测试前）
3. 至少一个 SKILL.md 包含编排器独立运行 build+lint+test 的逻辑
4. tasks-template.md 包含 `## Architecture Guard` 节和原子性约束说明
5. verify.md 包含深度检查（调用链/持久化/配置贯穿）和残留扫描步骤
6. quality-review.md 包含 STRUCTURAL_DEBT 维度和跨模块一致性检查
7. `npm run repo:check` 全部 pass
