# Trace — Feature 202 MCP batch graph-only pilot（goal_loop e2e 验证）

模式: feature（完整编排 + goal_loop override 激活态）
研究模式: skip（任务行号已 verify、内部改动、主线程已完成代码侦察）
分支: claude/quirky-swirles-ab3d3b（worktree）

## Step 0（pilot 前置）
- 启用 goal_loop override：cp templates/goal-loop-override-template.yaml → .specify/orchestration-overrides.yaml（**不入 commit**）
- 修复 worktree node_modules 空软链（zod 缺失致 override 不应用）→ 删软链 + npm ci
- 验证：effective-orchestration feature --annotate → implement.agent_mode=goal_loop（source: overrides）✅
- diagnostics: mode-overridden（info）唯一，无 warning/error ✅

## 关键架构发现（主线程侦察）
- `graph-only` 非 BatchMode（runBatch validModes 仅 full|reading|code-only，传 graph-only 会 throw）
- buildAstGraphOnly（batch-orchestrator.ts:2487）是与 runBatch 解耦的姊妹管线 → handler 必须分支
- mode 字段 .describe()（server.ts:211）属 schema，F196 不扫描；F196 只扫工具顶层 description 的 Output 段
- batch 顶层 Output 例 = { successful, skipped, failed, indexGenerated }（= TRUTH['batch']）→ 不动它 F196 保绿
- GraphOnlyResult ≠ BatchResult（graphPath/nodeCount/... 非 BatchResult key）→ 不把 graph-only 字段塞进顶层 Output 例

## Phase 执行链路

### Phase: Specify
- specify 子代理产出 spec.md（12 FR + 6 EC + 载体3/pilot4 SC）
- Codex 对抗审查：CRITICAL×3（C-1 pilot 预设成功结论 / C-2 {code} 契约歧义 / C-3 无需认证 over-claim）+ WARNING×6 + INFO×2
- 处置：C-1/C-2/C-3 + W-1/W-2/W-3/W-4/W-5/W-6 全部修订入 spec；I-1/I-2 记入 commit message
  - C-1 → User Story 2 ACs 改为"记录是否发生"，不预设成功
  - C-2 → FR-005/NFR-004 明确 batch 返回裸 JSON.stringify（无 {code} envelope）
  - C-3 → 软化"无需认证"，oracle = 零 LLM
  - W-2 → FR-003 明确不动 BatchMode
  - W-6 → SC-载体-001 明确读 graphPath 文件断言 schemaVersion/绝对路径计数

### Phase: Clarify + Checklist（DESIGN_PREP_GROUP 并行）
- clarify：0 阻塞歧义（spec 经 Codex 审查后已充分明确），追加 Clarifications 段
- checklist：18 项全过（requirements.md）；关键 CHK-015 红→绿 oracle / CHK-018 三 mode 零回归 / CHK-017 遥测可审计
- 设计阶段产物（纯文档，spec 本体已 Codex 审过）→ 目视审查通过，未单独跑 codex
- GATE_DESIGN（hard gate / always / critical）→ 待用户确认
