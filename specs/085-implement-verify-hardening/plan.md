# Feature 085 — 技术规划

## 方案总览

全部变更限于 4 个 Markdown 文件的 Prompt 增强 + SKILL.md 编排逻辑微调。不涉及 TypeScript 源码。

## 实施模块

### M1: implement.md 增强（FR-1 ~ FR-3）
- 在现有"验证铁律"章节后追加 Layer 2（行为验证）和 Layer 3（失败路径验证）描述
- 在"任务执行循环"中插入"改动后一致性自检"步骤（位于测试前）
- 不改变现有 Layer 1 逻辑

### M2: tasks-template.md 增强（FR-4 ~ FR-5）
- 在模板末尾追加 `## Architecture Guard` 节（由 plan agent 填充）
- 在模板头部追加"原子性约束"说明段
- 不改变现有任务格式

### M3: verify.md 增强（FR-6 ~ FR-7 ~ FR-9）
- 在现有 Layer 1（Spec-Code 对齐）后追加 Layer 1.5（深度检查）
- 追加"残留扫描"步骤
- 追加"文档一致性检查"步骤

### M4: quality-review.md 增强（FR-8 ~ FR-10）
- 追加 STRUCTURAL_DEBT 维度（行数阈值 → WARNING/CRITICAL）
- 追加"跨模块一致性"检查维度

### M5: SKILL.md 编排器验证（FR-3）
- 在 feature/story/fix/implement SKILL.md 的 implement 完成后追加编排器独立验证逻辑
- 仅追加验证调用，不改动编排流程

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 影响文件数 | 4 个 Markdown + 4 个 SKILL.md = 8 文件 |
| 跨包影响 | 无（仅 plugins/spec-driver/ 内） |
| 数据迁移 | 无 |
| 风险等级 | LOW（纯 Prompt 追加，不改变现有行为） |

## 依赖顺序

M1 → M2 → M3 → M4 → M5（串行，每步独立可验证）
