# Feature 087 — 任务分解

## 执行顺序：M1 → M2 → M3 → M4

---

## M1: 制品 Schema + Trace

- [ ] T-001 [P0] 创建 14 个 Agent artifact.yaml
  - 为每个 `plugins/spec-driver/agents/*.md` 创建对应 `*.artifact.yaml`
  - 格式：output_path、required_sections、optional_sections
  - **验证**：`ls plugins/spec-driver/agents/*.artifact.yaml | wc -l`（= 14）

- [ ] T-002 [P0] 在 feature SKILL.md 追加 Trace 写入逻辑
  - 在每个 Phase 开始/结束处追加 trace.md 写入指令
  - 格式：`[HH:MM:SS] phase: EVENT | detail`
  - 包含降级事件和 Gate 决策记录
  - **验证**：`grep -c "trace.md" plugins/spec-driver/skills/spec-driver-feature/SKILL.md`（>= 3）

- [ ] T-003 [P1] 追加错误传播链路到 SKILL.md
  - 并行降级时记录原因到 trace.md
  - Agent 失败 root cause 传播到 verification-report
  - 模板 fallback 时输出通知
  - **验证**：`grep "降级原因\|root.cause\|fallback.*通知" plugins/spec-driver/skills/spec-driver-feature/SKILL.md`

---

## M2: SKILL.md 性能优化

- [ ] T-004 [P0] 追加自适应入口检测到 feature/story/implement SKILL.md
  - 初始化阶段扫描 feature 目录：spec.md/plan.md/tasks.md 存在性
  - 已有制品 → 跳过对应阶段 + 输出日志
  - 3 个 SKILL.md 均需追加
  - **验证**：`grep "自适应" plugins/spec-driver/skills/spec-driver-feature/SKILL.md`

- [ ] T-005 [P1] 追加 Constitution 内联检查到所有 SKILL.md
  - 替代独立 agent 调用：主线程读取 constitution.md + 关键词匹配
  - 仅 VIOLATION 时启动完整 agent
  - **验证**：`grep "内联检查\|inline.*check" plugins/spec-driver/skills/spec-driver-feature/SKILL.md`

- [ ] T-006 [P1] 追加 Plan+Tasks 合并调用到 story SKILL.md
  - story Phase 3 改为一次 agent 调用生成两个制品
  - **验证**：`grep "合并调用\|同时.*生成.*plan.*tasks" plugins/spec-driver/skills/spec-driver-story/SKILL.md`

- [ ] T-007 [P1] 追加增量验证策略到 feature/story SKILL.md
  - 编排器验证阶段根据 git diff 选择 Level 0/1/2
  - **验证**：`grep "Level 0\|增量验证\|git diff" plugins/spec-driver/skills/spec-driver-feature/SKILL.md`

---

## M3: 治理精简

- [ ] T-008 [P1] 脚本目录重组：实验性脚本分离
  - 创建 `plugins/spec-driver/scripts/experimental/`
  - 移动：generate-product-scorecards.mjs、generate-adoption-insights.mjs、generate-workflow-registry.mjs
  - 更新 package.json 中引用这些脚本的命令（如有）
  - **原子性**：移动 + 引用更新在同一任务
  - **验证**：`ls plugins/spec-driver/scripts/experimental/*.mjs | wc -l`（>= 3）；`npm run repo:check`

- [ ] T-009 [P1] 追加文档健康度检查到 sync.md
  - 膨胀检测：current-spec.md >1000 行 → 建议拆分
  - 陈旧检测：近 3 个 Feature 未触及的章节
  - **验证**：`grep "健康度\|膨胀\|陈旧" plugins/spec-driver/agents/sync.md`

- [ ] T-010 [P1] 追加可量化约束到 constitution.md
  - Measurable Guardrails：文件行数上限、循环依赖、silent failure
  - **验证**：`grep "Measurable\|行数上限\|循环依赖" plugins/spec-driver/agents/constitution.md`

---

## M4: contributor-guide

- [ ] T-011 [P2] 创建 docs/contributor-guide.md
  - 涵盖：改 agent prompt / 改 SKILL.md / 改 contract / 改 shared docs / 版本 bump 各场景
  - >30 行
  - **验证**：`wc -l docs/contributor-guide.md`（>= 30）

---

## 最终验收

- [ ] T-012 [P0] 全量验收
  - spec.md 10 条验收标准逐项核查
  - `npm run repo:check` 全部 pass

---

## Architecture Guard

- [ ] AG-001 不引入 TypeScript 运行时代码
- [ ] AG-002 artifact.yaml 为辅助文档，不引入运行时解析依赖
- [ ] AG-003 SKILL.md 变更为追加型，不删除现有逻辑
