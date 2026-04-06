# Feature 085 — 任务分解

## 执行顺序：M1 → M2 → M3 → M4 → M5

---

## M1: implement.md 增强

- [ ] T-001 [P0] 追加三层验证体系到 implement.md
  - 在现有"验证铁律"章节后追加 Layer 2（行为验证）和 Layer 3（失败路径验证）
  - Layer 2：每个 FR 的 happy path 需端到端可观测步骤，无法执行标注 `[E2E_DEFERRED]`
  - Layer 3：外部依赖模块至少验证 1 个失败场景；禁止 bare except 返回空
  - **验证**：grep "Layer 2" implement.md && grep "E2E_DEFERRED" implement.md

- [ ] T-002 [P0] 追加改动后一致性自检到 implement.md
  - 在任务执行循环的"跑测试"之前插入自检步骤
  - 内容：搜索修改/删除的类型名/枚举值全部引用、import 路径检查、模型字段一致性
  - **验证**：grep "一致性自检" implement.md

---

## M2: tasks-template.md 增强

- [ ] T-003 [P1] 追加 Architecture Guard 节和原子性约束
  - 在 tasks-template.md 末尾追加 `## Architecture Guard` 占位节（由 plan agent 填充）
  - 在模板头部追加原子性约束说明（每个 task 完成后系统可编译、跨层改动不拆分）
  - **验证**：grep "Architecture Guard" tasks-template.md && grep "原子性" tasks-template.md

---

## M3: verify.md 增强

- [ ] T-004 [P0] 追加深度检查步骤到 verify.md
  - Layer 1.5：调用链完整性（入口→底层追踪）、数据持久化验证（commit/flush）、配置贯穿验证
  - **验证**：grep "调用链" verify.md && grep "持久化" verify.md

- [ ] T-005 [P1] 追加残留扫描和文档一致性检查到 verify.md
  - 残留扫描：删除/重命名时 grep 旧名称确认零残留
  - 文档一致性：架构文档引用被删除概念时报警
  - **验证**：grep "残留扫描" verify.md && grep "文档一致性" verify.md

---

## M4: quality-review.md 增强

- [ ] T-006 [P1] 追加 STRUCTURAL_DEBT 维度和跨模块一致性检查
  - STRUCTURAL_DEBT：<300→>500 WARNING、<500→>800 CRITICAL、连续 3 Feature 增长 CRITICAL
  - 跨模块一致性：import 路径、共享常量/类型、未引用已删除符号
  - **验证**：grep "STRUCTURAL_DEBT" quality-review.md && grep "跨模块" quality-review.md

---

## M5: SKILL.md 编排器验证

- [ ] T-007 [P1] 在 feature/story/implement SKILL.md 追加编排器独立验证逻辑
  - implement 阶段完成后，编排器自行运行 build+lint+test（不信任 Agent 报告）
  - 仅在 spec-driver-feature、spec-driver-story、spec-driver-implement 三个 SKILL.md 中追加
  - 不修改 spec-driver-fix/spec-driver-resume（086 负责域）
  - **验证**：grep "编排器.*验证\|编排器.*build" plugins/spec-driver/skills/spec-driver-feature/SKILL.md

---

## 最终验收

- [ ] T-008 [P0] 全量验收
  - spec.md 7 条验收标准逐项核查
  - `npm run repo:check` 全部 pass
  - 确认未修改 plan.md / specify.md 等 086 负责文件

---

## Architecture Guard

- [ ] AG-001 不引入 TypeScript 运行时代码 — 全部变更限于 Markdown Prompt 文件
- [ ] AG-002 不触碰 086 负责文件 — plan.md / specify.md / fix SKILL / story SKILL(086部分) / resume SKILL 不可修改
- [ ] AG-003 追加型修改 — 现有 Prompt 逻辑不删除不改写，仅在适当位置追加新步骤/维度
