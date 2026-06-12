# 问题修复报告 — F185 spec-driver 委派契约收口

## 问题描述

spec-driver 的"编排器必须委派子代理"契约存在 4 处机制缺口（来源：M7 全期架构审查 + F176 实测）：

1. 🔴 **resume 编排器 frontmatter 仍是 `model: sonnet`**（plugins + .codex 双层）。probe2 实证 sonnet 编排器对 MUST 委派指令 0 服从——resume 是所有中断流程的唯一恢复入口，该组合确定性 inline 化 → F170a/d/c 子代理集成链在恢复路径整体失效。且 resume 连 4.2.1 给 fix 加的委派硬约束块都没有（比修复前的 fix 更弱）。
2. **4.2.1 委派硬约束只盖 fix skill**（commit 9398aef）：story/feature/implement 仍是描述性措辞，无禁止 inline 替代的硬约束块（story 定位小需求最易被编排器自判"简单"而 collapse）。
3. **frontmatter model 不在任何 contract/check 管辖**（6281a27 sonnet→opus 漂移多时无人发现的根因未机制化）；委派硬约束/preference-rules 注入段在 5 个 SKILL 复制无 sync 守护（sync-preference-rules.mjs 只盖 agents/*.md）。
4. **orchestration.yaml 与 SKILL.md 双源漂移**：fix 模式 yaml 3 阶段 vs SKILL 4 阶段、story yaml 6 vs SKILL 5；只有 feature skill 运行时消费 get-phases → 用户的 modes.fix/story 覆盖"显示生效实际纹丝不动"（合同失真，spec 133 用户故事 2 明文承诺过 modes.fix 整段重写可用）。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何 resume 路径委派会塌？ | resume 编排器 frontmatter `model: sonnet` + 无委派硬约束块 |
| Why 2 | 为何 model 漂移/缺约束块长期无人发现？ | frontmatter model 与委派约束块不在任何 contract/check 管辖范围 |
| Why 3 | 为何不在管辖范围？ | 委派契约只以散文形式写在各 SKILL 正文，无单一事实源、无 sync 注入、无 check 断言（sync-preference-rules 只盖 agents/*.md，不盖 skills/*/SKILL.md 的 frontmatter 与约束块）|
| Why 4 | 为何只用散文形式？ | 4.2.1 加硬约束块时是"就地补 fix 一处"的局部修复，没把它沉淀为跨 SKILL 的受控片段（preference-rules 已有成熟的 marker 注入先例，但当时未复用该模式）|
| Why 5 | 为何 yaml 与 SKILL 双源漂移无人察觉？ | 只有 feature 模式运行时消费 get-phases，fix/story 的 yaml 实为"死文档"——改了无运行时反馈，合同与现实脱钩且无 check 兜底 |

**Root Cause**: 委派契约（含编排器 model + 硬约束块）缺乏"单一事实源 + sync 注入 + check 断言"的工程化闭环，停留在散文复制态；orchestration.yaml 的 fix/story 段是无运行时消费的失真文档。

**Root Cause Chain**: resume 路径委派塌 → resume model=sonnet 且缺约束块 → model/约束块无 contract 管辖 → 委派契约无单一事实源与 sync/check 闭环（只有 preference-rules 做了该模式，未复用）→ yaml/SKILL 双源因只有 feature 消费而长期失真无兜底。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `plugins/spec-driver/skills/spec-driver-resume/SKILL.md` | frontmatter L6 | `model: sonnet` | 改 opus + 注入委派硬约束块 |
| `.codex/skills/spec-driver-resume/SKILL.md` | frontmatter | `model: sonnet`（源同步产物）| 经 repo:sync 自动再生（codex-skills.sh 逐行复制 frontmatter）|
| `plugins/spec-driver/skills/spec-driver-{fix,story,feature,implement}/SKILL.md` | 正文 | 委派约束散文/缺失 | 注入标记化委派硬约束块（fix 已有→改为标记块；story/feature/implement 新增）|
| `plugins/spec-driver/config/orchestration.yaml` | fix L528、story L373 | yaml 阶段数与 SKILL 不符 | fix 3→4 阶段（diagnose/plan/implement/verify）、story 6→5 阶段对齐 SKILL |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `plugins/spec-driver/skills/spec-driver-{refactor,sync,doc,constitution}/SKILL.md` | frontmatter | 含 Task 委派？ | 待确认是否属"显式编排器清单"；本 feature 只硬性盖 fix/story/feature/implement/resume 5 个；其余按是否委派子代理评估 |
| `lib/preference-rules.mjs` + `sync-preference-rules.mjs` | — | marker 注入 + sync/check | **复用范本**：delegation-contract 镜像同一架构 |

### 同步更新清单

- 新增单一事实源：`plugins/spec-driver/templates/delegation-contract.md`
- 新增 lib + script：`plugins/spec-driver/lib/delegation-contract.mjs` + `scripts/sync-delegation-contract.mjs`（镜像 preference-rules）
- 接线：`scripts/lib/repo-maintenance-core.mjs` 的 `syncRepository`（加 delegation-contract step，置于 spec-driver-codex-wrappers 再生**之前**）+ `validateRepository`（加 delegation-contract 一致性校验 + 编排器 model=opus 断言）
- contract caveat：`plugins/spec-driver/contracts/orchestration-overrides-contract.yaml` 标注"phase 序列覆盖当前仅 feature 模式运行时生效"
- 测试：delegation-contract lib 纯函数单测 + sync/check 漂移单测 + 故意篡改（改 model / 删约束块 → repo:check fail）

## 修复策略

### 方案 A（推荐）— 镜像 preference-rules 的成熟 marker 注入架构

1. **resume 双层 opus + 移植委派硬约束块**：编辑源 SKILL frontmatter `sonnet→opus`；委派硬约束块经下方 sync 注入；repo:sync 再生 .codex wrapper（双层一致）。
2. **委派契约抽共享片段**：`templates/delegation-contract.md` 作单一事实源，含 `<!-- BEGIN/END delegation-contract -->` marker 块；`lib/delegation-contract.mjs` 纯函数渲染；`sync-delegation-contract.mjs` 提供 `--write`/`--check`，按 marker 注入 fix/story/feature/implement/resume 5 个 SKILL 正文。
3. **repo:check 新增两断言**：(a) 5 个显式编排器 SKILL（plugins + .codex 双层）frontmatter `model` 必须 `opus`；(b) 5 个 SKILL 的 delegation-contract 注入块与模板一致（drift 检测）。故意改 model 为 sonnet 或删约束块 → fail-loud。
4. **orchestration.yaml 短期对齐**：fix 段 3→4 阶段（diagnose[agent:null]/plan/implement/verify，gates 对齐 SKILL：plan 后 GATE_DESIGN、verify 后 GATE_VERIFY）；story 段 6→5 阶段对齐 SKILL（constitution/specify/plan+tasks/implement/verify）；name 字段同步纠正阶段数。
5. **contract caveat 落档**：orchestration-overrides-contract.yaml 明文标注 phase 序列覆盖当前仅 feature 模式运行时生效。

### 方案 B（备选，不采纳）

把 model + 约束块直接硬编码进 repo-check.mjs 断言，不抽共享模板。**否决理由**：约束块仍散文复制态，无单一事实源，下次改约束文案 5 处手改易漂移——正是本 feature 要根治的根因。

## 边界与回归护栏

- 5 个 SKILL 既有 phase 语义零变化（只加约束块/改 model/对齐 yaml，不动流程逻辑）。
- 注入点选择：约束块插入需幂等（marker 之间替换，锚点不移动），与 preference-rules 同策略。
- repo:sync 步骤顺序：delegation-contract 注入必须在 spec-driver-codex-wrappers 再生之前（wrapper 逐行复制源 body，须先注入后复制）。
- 既有 49 check 全 pass + 新增断言生效；4237 vitest pass + build 全绿；.codex wrapper 再生后 spec-driver-wrappers:* 全绿。

## Spec 影响

- 无需新增/修改产品 spec（本 feature 是 spec-driver 自身工具链改造）。
- 需更新：orchestration-overrides-contract.yaml（caveat）；本 feature 的 plan.md / tasks.md。
