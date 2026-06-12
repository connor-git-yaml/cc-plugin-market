# 修复任务 — F185 spec-driver 委派契约收口

## 注入锚点实测（已核对 5 SKILL）

| SKILL | 流程标题锚点 | 备注 |
|-------|-------------|------|
| fix | `## 工作流定义` (L171) | **已有散文块 L177-185 需先删除**，由 sync 注入 canonical；L343 引用指针保留 |
| story | `## 工作流定义` (L240) | 锚点后插入 |
| feature | `## 工作流执行（动态模式）` (L164) | 锚点后插入 |
| implement | `## 工作流定义` (L254) | 锚点后插入 |
| resume | `## 恢复后执行流程` (L270) | 锚点后插入；frontmatter 同步改 opus |

→ sync 脚本用**显式 per-SKILL 锚点 map**；锚点未找到 → fail-loud（不静默跳过）。

## 任务列表（依赖序）

- [ ] T1. 写 `templates/delegation-contract.md`：canonical 委派硬约束块（marker 包裹），措辞泛化覆盖 5 SKILL（"编排器亲自执行范围"= 诊断/上下文扫描/GATE 决策本身；其余产出阶段必须 Task 委派；唯一降级通道=实际 Task 失败+留证+报告标注 DEGRADED）。
- [ ] T2. 写 `lib/delegation-contract.mjs`：纯函数（marker 常量 / extractCanonicalBlock / wrapWithMarkers / computeExpectedSkillContent(skillText, templateText, anchor)）。镜像 preference-rules.mjs，fail-loud 缺 block-end。
- [ ] T3. 写 `scripts/sync-delegation-contract.mjs`：`--write`/`--check`；per-SKILL 锚点 map；导出 syncDelegationContract / validateDelegationContract。
- [ ] T4. 写 `scripts/validate-orchestrator-models.mjs`：显式 allowlist `[fix,story,feature,implement,resume]`，校验 plugins + .codex 双层 frontmatter model=opus；导出 validateOrchestratorModels。
- [ ] T5. 手动删除 fix SKILL 既有散文块（L177-185），保留 L343 引用指针。
- [ ] T6. resume SKILL frontmatter `sonnet→opus`（加对齐 fix 风格的注释）。
- [ ] T7. repo-maintenance-core 接线：syncRepository 加 `delegation-contract` step（**preference-rules 之后、spec-driver-codex-wrappers 之前**）；validateRepository aggregate validateDelegationContract + validateOrchestratorModels。
- [ ] T8. orchestration.yaml：fix 3→4 阶段（diagnose[agent:null]→plan[GATE_DESIGN]→implement→verify[GATE_VERIFY]）；story 6→5 阶段对齐 SKILL（constitution[agent:null]→specify[GATE_DESIGN]→plan[GATE_TASKS]→implement→verify[GATE_VERIFY]）。**先核对 SKILL 真实 gate 位置**。name 字段同步纠正阶段数。
- [ ] T9. orchestration-overrides-contract.yaml：加 caveat（phase 序列覆盖仅 feature 运行时生效）。
- [ ] T10. 运行 `npm run repo:sync` → 验证 5 SKILL 注入约束块 + .codex 双层再生含 opus+约束块。
- [ ] T11. 测试：lib 纯函数单测 + sync --check 漂移单测 + model 断言篡改单测（改 model→sonnet fail / 删块 fail）。
- [ ] T12. 验收闭环：`npm run repo:check`（49+新增 pass）+ 故意篡改 fail-loud + `npx vitest run`（4237+）+ `npm run build` + `npm run release:check`。

## 验收对照（来自任务卡）

1. resume 双层 opus + 5 SKILL 委派硬约束一致（sync 注入 + check 守护）→ T6/T1-T3/T7/T10
2. orchestration.yaml fix/story 段与 SKILL 一致 + contract caveat 落档 → T8/T9
3. 故意篡改测试：改任一编排器 model / 删任一硬约束块 → repo:check fail → T11/T12
4. Codex 阶段性对抗审查 critical 全修 → 各 phase codex review
