# Tasks: F204 — goal_loop full 轮命令集完整性校验修复

**输入制品**：
- `specs/204-fix-goal-loop-full-command-set/fix-report.md`（诊断 + AC-1~AC-7 验收标准）
- `specs/204-fix-goal-loop-full-command-set/plan.md`（权威实现计划，已含 Codex Phase 2 处置 §11）

**基线**：F203（`9bb2ea3`），goal-loop-core.mjs 729 行版本，vitest 141 pass。

**TDD 原则**：T001 先写**全部红测试 + throwing 桩 + fixture**（确保静态 import 可链接、用例逐个红，Codex W-4/C-4）；T002~T004 逐步实现转绿；T005 零回归门禁；T006~T009 文档/配置/散文；T010 全量门禁。

---

## 不改动边界（显式锁定，implement 阶段禁止越界）

- **禁止**改 `parseReport` 函数签名（接缝已定为 decideStop，不动 parse 层）
- **禁止**改 `goal-loop-cli.mjs` 的 `parse-report`/`decide-stop` 子命令调用点与签名（config 已在 decide-stop payload，无需新接线）
- **禁止**迁移现有无-kind fixture（`report-full-pass.json` 等）——保零回归，默认 `[]` 跳过校验
- **禁止**改 `evaluateMetric` 函数内部逻辑（完整性校验在 decideStop 层插入，不渗入 metric 定义）
- **禁止**改 `evaluateSmokeReadiness` 函数（scope 仅 full 权威门禁）
- **禁止**在 core 硬编码具体命令名（如 `npx vitest run`）——core 只认 kind 枚举；命令名由 config 驱动
- **SKILL.md 改 3 处散文**（step1 读 config / branch e / branch c），但 **不改** parse-report/decide-stop 调用点与 CLI 签名

---

## T001 — TDD 红：fixture + 桩 + 全部测试骨架（Codex C-4/W-4 修正）

- [x] **T001** 写入 fixture、throwing 桩、全部新测试，并确认红态
  - **改动文件**：
    1. 新增 `plugins/spec-driver/tests/fixtures/goal-loop/report-full-pass-with-kinds.json`（**fixture 是 test infra，必须在此创建**，否则 AC-3 用例不可达——Codex C-4）。内容见 plan.md §6.1（build/test/lint/check 四条带 `kind` 全 PASS）
    2. `plugins/spec-driver/scripts/lib/goal-loop-core.mjs`：加 **throwing 桩** `export function validateFullCommandKinds(report, requiredKinds) { throw new Error('NotImplemented'); }`（F201 同款 TDD 约定——否则 goal-loop-core.test.mjs 的静态 named import 会整文件链接失败而非逐用例红，Codex W-4）
    3. `plugins/spec-driver/tests/goal-loop-core.test.mjs`：加 `validateFullCommandKinds` 单元 describe 块（9 用例）+ `decideStop` 集成用例（6 用例）；import 列表加 `validateFullCommandKinds`
    4. `plugins/spec-driver/tests/config-schema.test.mjs`：加 `goal_loop.full_required_kinds` schema describe 块（3 用例）——**schema 用例归此文件，不放 goal-loop-core.test.mjs**（Codex W-3）
  - **红判据**：
    - `node --test plugins/spec-driver/tests/goal-loop-core.test.mjs`：validateFullCommandKinds 9 用例红（桩 throw NotImplemented）；decideStop 集成中"缺 lint kind""echo-ok full"红（decideStop 未接入，仍返回 REACHED_GOAL）
    - `npx vitest run plugins/spec-driver/tests/config-schema.test.mjs`：3 schema 用例红（字段不存在 / 非法值未被拒）
  - **依赖**：无（可立即开始）
  - **AC 覆盖**：AC-1~AC-7 骨架全写入（后续任务转绿）
  - **测试清单**（依 plan.md §7）：
    - `validateFullCommandKinds`（9）：空 requiredKinds / null / 非数组 / 含非字符串元素 / 全覆盖 / 缺 lint / 命令全无 kind / **kind 非字符串(123)不崩** / FAIL 有 kind+PASS 无 kind / 大小写 / 重复 / echo-ok 无 kind
    - `decideStop` 集成（6）：report-full-pass.json+默认[] / with-kinds+全 required / 缺 lint kind / **echo-ok full(AC-5)** / smoke 报告 / []+echo-ok
    - config schema（3，config-schema.test.mjs）：省略→默认[] / 声明合法 / 非法值抛错

---

## T002 — schema 字段 + effective-config 同步（AC-7 绿，Codex W-2）

- [x] **T002** [P] `config-schema.mjs` 新增 `full_required_kinds` 字段并同步 effective-config 机制
  - **改动文件**：`plugins/spec-driver/scripts/lib/config-schema.mjs`，**三处**：
    1. `goalLoopSchema`（L106 附近，`max_tool_invocations` 之后）：
       ```js
       full_required_kinds: z.array(z.enum(['build', 'test', 'lint', 'check'])).default([]),
       ```
    2. `BUILTIN_DEFAULTS`（L174）：加 `'goal_loop.full_required_kinds': [],`
    3. `resolveEffectiveConfig` 的 `nestedKeys`（L457）：加 `'goal_loop.full_required_kinds',`
  - **数组值实测**：跑 `--show-effective`（或对应测试）确认数组默认值 `[]` 渲染不崩；若渲染对数组不友好，退路见 plan.md §4.1（不纳入 nestedKeys + 文档注明），但 zod 字段与 BUILTIN_DEFAULTS 仍必须加
  - **红→绿**：T001 的 3 个 config schema 用例转绿
  - **依赖**：T001（骨架已写入）
  - **AC 覆盖**：AC-7（省略→默认[] / 合法枚举通过 / 非法值抛 Zod 错误）

---

## T003 — 纯函数实现（含类型守卫，AC-2/3/4 绿，Codex C-3）

- [x] **T003** 用 plan.md §2.4 的**类型守卫版**实现替换 `validateFullCommandKinds` 桩
  - **改动文件**：`plugins/spec-driver/scripts/lib/goal-loop-core.mjs`
  - **改动内容**：按 plan.md §2.4 参考实现（**含 `Array.isArray(requiredKinds)` + `typeof k==='string'` + `typeof cmd.kind==='string'` 守卫，Codex C-3**），放在 `evaluateMetric` 附近，复用既有 `classifyCommand`
  - **红→绿**：T001 的 9 个 validateFullCommandKinds 单元用例转绿（含 kind:123 不崩、非数组 requiredKinds 等边界）
  - **依赖**：T001（桩 + 测试）；与 T002 可并行（函数本身不依赖 schema）
  - **AC 覆盖**：AC-2（缺必需 kind→complete:false）/ AC-3（全覆盖→true）/ AC-4（空→跳过）/ AC-5 基础

---

## T004 — decideStop 接入（AC-2/5/6 集成绿）

- [x] **T004** 在 `decideStop` full 分支接入 `validateFullCommandKinds`
  - **改动文件**：`plugins/spec-driver/scripts/lib/goal-loop-core.mjs`
  - **改动位置**：`decideStop` 优先级 3「达标」分支，`report.verify_mode === 'full'` 块内，**`evaluateMetric(report)` 为 true 之后、`return REACHED_GOAL` 之前**（plan.md §3.3；**注意是"之后"不是"之前"——W-1**）
  - **改动内容**：按 plan.md §3.3 插入；缺必需 kind → `{ stop:true, exit_reason:'INCOMPLETE_FULL_VERIFY', action:'goto_gate_verify' }`；读 `(config && config.full_required_kinds) || []`
  - **红→绿**：T001 集成用例中"缺 lint kind""echo-ok full"由 REACHED_GOAL 转 `INCOMPLETE_FULL_VERIFY`；smoke 用例不受影响（走 smoke 分支）；优先级 1（rollback）/2（regression）仍在前
  - **依赖**：T003（函数必须已实现，非桩）
  - **AC 覆盖**：AC-2 / **AC-5（echo-ok full + 配置要求 kinds → 不 REACHED_GOAL，CRITICAL-8 直证）** / AC-6（smoke 不受影响）

---

## T005 — 零回归验证门禁（AC-1 绿）

- [x] **T005** 确认 AC-1 零回归：`report-full-pass.json` + 默认 `full_required_kinds:[]` → REACHED_GOAL 不变
  - **改动文件**：无（只跑测试）
  - **验证**：`node --test plugins/spec-driver/tests/goal-loop-core.test.mjs`
  - **绿判据**：AC-1 用例（report-full-pass.json+默认[]）绿；原有 11+ 引用该 fixture 的用例全绿；141+ pass / 0 fail。若红 → T004 接入逻辑误伤空[]短路，必须回修 T004 再继续
  - **依赖**：T004（接入完成）；T002（schema default 保住 `[]`）
  - **AC 覆盖**：**AC-1（零回归核心验收，141 pass baseline 守住）**

---

## T006 — 文档更新 verify.md

- [x] **T006** 更新 `plugins/spec-driver/agents/verify.md`：layer2_commands schema 加 kind + full mandate 标注 + CRITICAL-8 段改写
  - **改动文件**：`plugins/spec-driver/agents/verify.md`，三处（plan.md §4.2~§4.4）：
    - L225-234 schema JSON：每条命令加 `"kind": "test"` + 注释（枚举 build|test|lint|check）
    - L261-266 full mandate：每条命令标注 kind（build/test/lint/check）
    - L284 CRITICAL-8 段：从"有意不在 core 校验/follow-up"改为"F204 已实现"，**保留诚实残留风险说明**（kind 自报、对抗误标由人工 GATE_VERIFY 兜底）
  - **绿判据**：人工 review 三处格式正确（文档无代码测试）
  - **依赖**：T004（实现完成后文档与代码一致）
  - **AC 覆盖**：AC-2/AC-5 文档与代码一致

---

## T007 — dogfood opt-in（spec-driver.config.yaml）

- [x] **T007** [P] 更新 `spec-driver.config.yaml`：取消注释 goal_loop 段 + 设 full_required_kinds
  - **改动文件**：`spec-driver.config.yaml`（plan.md §5.1）
  - **改动内容**：goal_loop 段取消注释，设 `full_required_kinds: ['build', 'test', 'lint', 'check']`（dogfood opt-in，闭合实际敞口）+ 注释说明行
  - **注意**：取消注释后 `validateConfig` 实际解析该段；goal_loop 有 `.default({})` 兜底，显式声明只是补覆盖，不应破坏现有 config 测试——T010 全量验证确认
  - **绿判据**：`npx vitest run` 无 config 相关失败
  - **依赖**：T002（schema 字段已加）
  - **AC 覆盖**：AC-7（本仓库显式 opt-in 生效）

---

## T008 — 模板 opt-in 兜底（goal-loop-override-template.yaml）

- [x] **T008** [P] 更新 `plugins/spec-driver/templates/goal-loop-override-template.yaml`：补 full_required_kinds 示例
  - **改动文件**：`plugins/spec-driver/templates/goal-loop-override-template.yaml`（plan.md §5.2）
  - **改动内容**：goal_loop 说明段后补 `full_required_kinds` 示例注释块 + 注意事项（verify 子代理必须标注 kind，否则视为缺失）
  - **绿判据**：人工 review 示例格式正确
  - **依赖**：T002（schema 字段确认）
  - **AC 覆盖**：opt-in 入口兜底（推荐配置默认带保护，解"默认[]不致空转"）

---

## T009 — SKILL.md 3 处修正 + repo:sync（Codex C-1/C-2，编排器修正）

- [x] **T009** 修正 `plugins/spec-driver/skills/spec-driver-feature/SKILL.md`（3 处 + 1 一致性）并同步镜像
  - **改动文件**：`plugins/spec-driver/skills/spec-driver-feature/SKILL.md`（plan.md §3.6）
  - **编辑 1（C-1 最紧要）**：前置 step1（L296-298）读取键加 `full_required_kinds`（缺省 `[]`）——否则不进 decide-stop payload、漏洞空转
  - **编辑 2（branch e，L490）**：exit_reason 集合加 `INCOMPLETE_FULL_VERIFY` + 一行语义注释
  - **编辑 3（C-2，branch c，L477）**：forced-full 重 decide 分派补一条 `INCOMPLETE_FULL_VERIFY → 走 branch e、MUST NOT 再 escalate`
  - **一致性（I-1）**：L314 prevReports 枚举加 `INCOMPLETE_FULL_VERIFY`（catch-all 已功能覆盖，纯可读性）
  - **重要**：改后立即 `npm run repo:sync`（同步 `.codex/skills/spec-driver-feature/SKILL.md` 镜像，Codex W-6）+ `npm run repo:check`（零漂移）
  - **绿判据**：repo:sync 成功、repo:check 零漂移；3 处 dispatch 对 INCOMPLETE_FULL_VERIFY 均覆盖（含 escalate 二次路由）；`.codex` 镜像随 commit
  - **依赖**：T004（exit_reason 已在 core 产出）；T006（verify.md 可并行）
  - **AC 覆盖**：C-1 闭合实际生效（漏洞真堵）；C-2 闭合 escalate 路径

---

## T010 — 全量门禁（最终验收）

- [x] **T010** 全量门禁：core 单测 + vitest + build + repo:check
  - **改动文件**：无（只跑命令）
  - **验证序列**：
    1. `node --test plugins/spec-driver/tests/goal-loop-core.test.mjs`（core 快速反馈）
    2. `npx vitest run`（141+ pass / 0 fail；零回归 + 新用例）
    3. `npm run build`（TypeScript 类型零错误）
    4. `npm run repo:check`（同步零漂移，复核 SKILL.md `.codex` 镜像 sync 状态）
  - **绿判据**：全部零失败；vitest pass ≥ 141（新用例使总数增加）；build 零类型错；repo:check 零漂移
  - **依赖**：T001~T009 全部完成
  - **AC 覆盖**：**AC-1（零回归）** + 最终交付门禁

---

## AC 覆盖映射表

| AC | 场景 | 对应任务 | 测试位置 |
|----|------|----------|----------|
| AC-1 | report-full-pass.json + 默认 `[]` → REACHED_GOAL 不变（141 baseline） | T001 / T005 / T010 | goal-loop-core.test.mjs |
| AC-2 | full 缺必需 kind → complete=false；decideStop 不 REACHED_GOAL | T001 / T003 / T004 | goal-loop-core.test.mjs |
| AC-3 | full 含全部必需 kind → REACHED_GOAL | T001（fixture）/ T003 / T004 | goal-loop-core.test.mjs |
| AC-4 | full_required_kinds=[] → 跳过，行为同现状 | T001 / T003（短路）/ T005 | goal-loop-core.test.mjs |
| AC-5 | echo-ok full + 配置要求 kinds → **不** REACHED_GOAL（CRITICAL-8 直证） | T001 / T003 / T004 | goal-loop-core.test.mjs |
| AC-6 | smoke 报告 + 任意 kind 配置 → 不受影响 | T001 / T004 | goal-loop-core.test.mjs |
| AC-7 | config schema：省略/声明/非法 full_required_kinds | T001 / T002 | **config-schema.test.mjs**（W-3） |

**100% AC 覆盖**；AC-5（漏洞直证）+ C-1（SKILL 接入实际生效）+ C-3（类型守卫不崩）均有对应任务。

---

## 依赖链与执行顺序

```
T001（fixture + 桩 + 全部红测试·确认红态）
  ↓
T002（schema + effective-config 同步）·T003（纯函数含守卫）  [可并行]
        ↓                                    ↓
              T004（decideStop 接入，依赖 T003）
                    ↓
              T005（零回归门禁，依赖 T002+T004）
                    ↓
  T006（verify.md）·T007（config opt-in）·T008（模板）·T009（SKILL.md 3处+sync）  [可并行]
                    ↓
              T010（全量门禁，依赖 T001~T009）
```

**关键串行链**：T001 → T003 → T004 → T005（零回归）→ T009（SKILL 接入闭合 C-1）→ T010

**可并行**：T002∥T003；T006/T007/T008/T009 在 T005 后可并行（不同文件）

---

## Codex Phase 2 处置溯源

本 tasks.md 已并入 Codex Phase 2 审查全部 4C+6W+2I（详见 plan.md §11）：
- **C-1**（SKILL config 接入）→ T009 编辑 1
- **C-2**（escalate 二次路由）→ T009 编辑 3
- **C-3**（kind 类型守卫）→ T003 + plan §2.4
- **C-4**（fixture 依赖不可达）→ T001 创建 fixture（不再单列 T006）
- **W-1**（接入点措辞）→ T004"之后不是之前"
- **W-2**（effective-config 同步）→ T002 三处
- **W-3**（schema 用例归属）→ T001 写入 config-schema.test.mjs
- **W-4**（桩 export 防链接失败）→ T001 加 throwing 桩
- **W-6**（.codex 镜像）→ T009 repo:sync + T010 repo:check
