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

### Phase: Plan
- plan 子代理产出 plan.md（4 步实现 + 测试策略 + 风险 + 复杂度自检）
- Codex 对抗审查：CRITICAL×3 + WARNING×3 + INFO×2（INFO 均为假阳性排除，确认 plan 正确点）
- 处置（全部修订入 plan）：
  - C1 spec↔plan 测试 gap 真实 → 新增集成测试 mcp-batch-graph-only.test.ts（不 mock，真跑小 fixture 读 graphPath 验 schemaVersion=2.0 + 0 绝对路径节点）坐实 SC-载体-001
  - C2 用例 B 断言 bug（callArgs[1] undefined）→ 改 toHaveLength(1)
  - C3 跨文件 mock export → server.ts 加 import 后全量 vitest 实证，缺则补 vi.fn()
  - W1 红态判据澄清（FakeMcpServer 不跑 Zod 校验）+ 新增 A2 schema safeParse 枚举断言
  - W2 新增用例 D：三旧 mode 参数化回归（runBatch 透传 mode / buildAstGraphOnly 不调）
  - W3 新增用例 E：graph-only + languages warn 不透传
- 关键风险点：goal_loop 红态识别——red 不是"Zod 拒绝"而是"runBatch 被非法 mode 调 / buildAstGraphOnly 未调"

### Phase: Tasks + Analyze
- tasks 子代理产出 tasks.md（23 任务，6 phase，12/12 FR 覆盖）
- analyze（一致性 PASS）：0 critical/high，2 medium（F-001 override 缺失边界—本 pilot override 已 present 故 moot / F-002 mcpLogger.info→console.error 路由—已 verify server.ts:226 正确）+ 1 low
- Codex 对抗审查（tasks phase）：CRITICAL×1 + WARNING×5 + INFO×2，全部修订：
  - C-001 T020 改"仅验证 override，绝不修改/commit"（堵 pilot 验证态误入 commit）
  - W-001 依赖图补 T010：T008+T010→T011（两个红态都要先建立）
  - W-002 T010 红态判据澄清（FakeMcpServer 不跑 Zod，红=未产 portable graph）
  - W-003 T009/T016 补零 LLM oracle（无凭据跑通 + runBatch 未调双向证据）
  - W-004 T017 移到 T015+T016 之后
  - W-005 T021 指定 verify 报告入库路径 + 7 字段 grep 验收
  - I-002 同文件测试任务并行措辞改"逻辑独立但建议顺序写"
- GATE_ANALYSIS / GATE_TASKS（always）→ 待用户确认
