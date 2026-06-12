# 修复规划 — F185 spec-driver 委派契约收口

## 架构决策：镜像 preference-rules 的 marker 注入闭环

复用仓内已成熟的「单一事实源 → lib 纯函数渲染 → sync 脚本 marker 注入 → repo:sync 接线 → repo:check 漂移断言」架构（`templates/preference-rules.md` + `lib/preference-rules.mjs` + `sync-preference-rules.mjs` 是范本）。delegation-contract 完全同构，降低新增抽象的认知与验证成本。

## 变更清单

### C1. 单一事实源模板
`plugins/spec-driver/templates/delegation-contract.md`
- 含 `<!-- BEGIN delegation-contract (generated...; do not edit) -->` / `<!-- END delegation-contract -->` marker 包裹的 canonical 委派硬约束块。
- 内容基于 fix SKILL 现有块（L177-185）泛化：措辞从 "Phase 2/3/4" 抽象为"除编排器亲自执行范围外的所有产出阶段"，使其可复用于 5 个 SKILL（各 SKILL 阶段编号不同，约束语义一致）。

### C2. lib 纯函数
`plugins/spec-driver/lib/delegation-contract.mjs`
- 导出 `BEGIN_MARKER` / `END_MARKER` / `extractCanonicalBlock` / `wrapWithMarkers` / `computeExpectedSkillContent`（镜像 preference-rules.mjs，但 SKILL 是 body 注入而非 agent 块；注入锚点策略见 C3）。
- 纯函数、自包含、无 root 依赖（plugin 发布后不依赖仓库 root scripts/）。

### C3. sync 脚本
`plugins/spec-driver/scripts/sync-delegation-contract.mjs`
- `--write`（默认）/ `--check`（漂移检测，退出码 0/1）。
- 目标 5 SKILL：`fix/story/feature/implement/resume`。
- 注入锚点：若已有 marker → marker 间替换；首次 → 在各 SKILL 「## 工作流定义」或等价的"阶段流程"标题之前插入（首次锚点对每个 SKILL 需稳定可定位；锚点策略：首个 `## 工作流` / `## 4 阶段` / `## 5 阶段` 等"流程"标题前，若无则首个 `### Phase` 前）。
- 导出 `syncDelegationContract({projectRoot})` / `validateDelegationContract({projectRoot})` 供 repo-maintenance-core 复用。

### C4. repo-maintenance-core 接线
`scripts/lib/repo-maintenance-core.mjs`
- `syncRepository`：在 `preference-rules` step 之后、`spec-driver-codex-wrappers` step **之前**插入 `delegation-contract` step（wrapper 逐行复制源 body，须先注入后复制，保证 .codex 双层同步）。
- `validateRepository`：aggregate `validateDelegationContract`（注入漂移）+ 新增 `validateOrchestratorModels`（5 SKILL plugins+.codex 双层 frontmatter model 必须 opus）。

### C5. 编排器 model 断言
`plugins/spec-driver/scripts/validate-orchestrator-models.mjs`（或并入 sync-delegation-contract）
- 显式 allowlist：`['fix','story','feature','implement','resume']`。
- 校验 `plugins/spec-driver/skills/<m>/SKILL.md` 与 `.codex/skills/spec-driver-<m>/SKILL.md` 双层 frontmatter `model: opus`。
- **故意 allowlist 而非"任何含 Task 的 SKILL"**：sync/doc 也委派但设计上保持 sonnet（轻编排器），全量断言会误伤。

### C6. resume 修复
`plugins/spec-driver/skills/spec-driver-resume/SKILL.md`
- frontmatter `model: sonnet` → `model: opus`（加注释说明，对齐 fix SKILL 注释风格）。
- 委派硬约束块经 C3 sync 注入（与其余 4 SKILL 同源）。
- `.codex` wrapper 经 repo:sync 自动再生。

### C7. orchestration.yaml 对齐
`plugins/spec-driver/config/orchestration.yaml`
- **fix** 3→4 阶段：`diagnose`(agent:null, orchestrator-inline) → `plan`(gates_after GATE_DESIGN) → `implement` → `verify`(gates_after GATE_VERIFY)。name 改"4 阶段诊断-规划-修复-验证流程"。
- **story** 6→5 阶段对齐 SKILL：`constitution`(agent:null) → `specify`(gates_after GATE_DESIGN) → `plan`(plan+tasks 合并阶段，gates_after GATE_TASKS) → `implement` → `verify`(gates_after GATE_VERIFY)。name 改"5 阶段"。
- ⚠️ 实施前先核对 SKILL 真实 gate 位置，逐一对齐；不臆造 gate。

### C8. contract caveat
`plugins/spec-driver/contracts/orchestration-overrides-contract.yaml`
- 明文标注：phase 序列覆盖（`modes.<mode>` 整段替换）当前仅 feature 模式运行时消费 get-phases 生效；fix/story/refactor 等的 yaml phase 序列为文档性描述，运行时由各 SKILL 正文固定编排——单源化视成本拆后续（M8 已标注）。

### C9. 测试
`plugins/spec-driver/tests/`（或就近 *.test.mjs/ts）
- delegation-contract lib 纯函数单测（marker 提取/包裹/幂等）。
- sync `--check` 漂移单测：删/改注入块 → check 报漂移。
- 编排器 model 断言单测：改任一 model 为 sonnet → fail；删约束块 → fail。

## 回归风险评估

| 风险 | 缓解 |
|------|------|
| sync 注入锚点在某 SKILL 不稳定 → 注入位置错乱 | 锚点逐 SKILL 验证；注入后 diff 人工核对 5 个文件 |
| repo:sync step 顺序错 → .codex 未含约束块 | delegation-contract 严格置于 codex-wrappers 之前；验收检查 .codex wrapper 含块 |
| orchestration.yaml gate 位置臆造 → schema/运行时校验失败 | 对照 SKILL 实际 gate；跑 effective-orchestration 验证 |
| 全量"含 Task = opus"断言误伤 sync/doc | 用显式 5-allowlist |

## 验证方案

1. `npm run repo:sync` → 5 SKILL 注入约束块 + .codex 再生含 opus+约束块。
2. `npm run repo:check` → 既有 49 + 新增断言全 pass。
3. 故意篡改：改 resume model→sonnet / 删任一 SKILL 约束块 → repo:check fail（fail-loud 验证）。
4. `npx vitest run` 4237+ pass；`npm run build` 全绿；`npm run release:check` 全绿。
5. codex 阶段性对抗审查 critical 全修。
