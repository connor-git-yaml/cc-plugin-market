# Tasks: Spec Driver 引擎正确性加固

**Feature**: 277-spec-driver-engine-hardening
**Branch**: `claude/spec-driver-engine-hardening-26e319`
**Input**: `specs/277-spec-driver-engine-hardening/plan.md`（1690 行，定稿）、`specs/277-spec-driver-engine-hardening/spec.md`（1029 行，定稿）
**不适用输入**: `data-model.md` / `contracts/` —— plan 已声明本卡无数据模型与 API 契约，二者不存在，按「不适用」处理（非缺席）
**模板**: `.specify/templates/tasks-template.md`（项目副本 251 行）。canonical `plugins/spec-driver/templates/specify-base/tasks-template.md` 为 266 行，两者漂移 15 行已由本卡登记为 `[CLEANUP] C2` 对 2；**本文件按项目副本的结构生成**。

---

## 本文件的组织方式（一处偏离模板的决定，须留痕）

**决定**：本文件的 Phase 划分**不按 User Story 组织，改为逐字沿用 plan 的 Phase A ~ E**。

**理由（三条）**：

1. **多对多，按 US 组织会切碎依赖链**。本卡有 6 个 User Story（US-1 ~ US-6a/6b/6c）与 5 个 Phase，二者是多对多映射：例如 US-3（子代理输出纪律与工具能力对齐）的 FR-015 / FR-017 落 Phase A、FR-014 / FR-018 / FR-019 落 Phase C；US-1 的 FR-005 同时牵动 Phase B 的模板双份与 Phase C 的共享块 3。按 US 建 Phase 会让同一批文件被多个 Phase 反复认领，依赖顺序无法在文件内表达。
2. **plan 的 `## FR → Phase 覆盖矩阵` 已是权威认领表，任务须与它逐条对账**。矩阵的「认领 Phase」列取值域 = { A, B, C, D, E }（plan 明写，FR-003 的交叉校验就打在这个取值域上）。若 tasks 另立一套 US 编号的 Phase，本文件的 `## FR 覆盖映射表` 就无法与 plan 矩阵逐行对齐，FR-003 的交叉校验失去语料。
3. **plan 已裁定 Phase 间为严格线性 `A → B → C → D → E`、无并行**（依赖理由见 plan §分 Phase 实现方案 引言）。这条顺序是执行约束本身，按 US 重排会丢失它。

**保留的模板要素**：任务行格式（`- [ ] TXXX [P?] 描述 + 文件路径`）、`[P]` 并行标记、FR 覆盖映射表、依赖与并行说明、Polish 性质的收尾任务（由 Phase E 承担）均按模板保留。**不使用 `[USN]` 标记**（改为映射表侧的 FR ↔ Task 双向对账，粒度更细且可机械核对）。

**FR 编号与 US 的对应关系不丢失**：plan 矩阵的「需求项 / 跨切」列（逐字抄自 spec §分批与移交 的归属表）已记录每条 FR 的 US 归属；本文件不重复该列，需要时回查 plan 矩阵。

---

## 冻结字段（GATE_TASKS 时点 · FR-005 dogfood）

| 字段 | 值 |
|---|---|
| 冻结对象 | `plan.md` 的 `## FR → Phase 覆盖矩阵` 整节（规范化：CRLF→LF、去行尾空白、折叠连续空行、去首尾空行） |
| 规范化 sha256 | `3c5aa22b941f35327732f3859d4ac38facf2524db0fbb3124b2e63e11cbbf4a8` |
| 表行数 | 81 行（68 行主矩阵 + 13 行约束型判定依据表；单位：以 `\| FR-0` 开头的表行） |
| 冻结时点 | 2026-09-04 GATE_TASKS 用户授权后，由编排器（主线程）计算并写入；同一值由编排器持有并注入 verify 运行时上下文 |
| commit sha | （可选，仅当流程恰好已 commit 时填写；用户裁定不采用冻结 commit）— |
| 冻结后修订 | 矩阵正文禁无痕改写；如需修订，以带时间戳的追加记录置于矩阵章节之外（spec Edge Case 18） |
| 复算命令 | `python3 -c "import re,hashlib;t=open('specs/277-spec-driver-engine-hardening/plan.md',encoding='utf-8').read();s=re.search(r'(?ms)^## FR → Phase 覆盖矩阵\n(.*?)(?=^## )',t).group(1);n='\n'.join(l.rstrip() for l in s.replace('\r\n','\n').split('\n'));n=re.sub(r'\n{3,}','\n\n',n).strip('\n')+'\n';print(hashlib.sha256(n.encode()).hexdigest())"` |

## Phase A：物理前置 + 门守护（代码面）

> plan 中的完整标题为「Phase A — 物理前置 + 门不可绕过（代码面及其唯一运行时消费点）」（plan 对基线标题作了一处扩范围调整，把 FR-068 从散文批移入本 Phase，理由见 plan §分 Phase 实现方案 调整表第 1 行）。

**目标**：(1) 补齐三个子代理的 `Edit` / `Bash` 工具面，解除 FR-014 / FR-027 / FR-028 / FR-030 的物理不可执行；(2) 把「`GATE_DESIGN` 在 `feature` 下不可绕过」从散文约定变为三层机械落点（override schema 禁改 → resolver 挂载校验 → `repo:check` 事后守护 + SKILL 运行时第一道闸）；(3) 在扩大 marker 面之前先补上 `agent-docs` 族的 fail-loud 兜底外壳。

**认领 FR（5 条）**：`FR-015` / `FR-017` / `FR-052` / `FR-053` / `FR-068`
（与 plan §换算式 式 2「Phase A = 5」一致；单位：FR 条）

**前置依赖**：`[CLEANUP] C1`（`orchestration-resolver.mjs` 534 行 / 主函数 333 行，拆为 5 个可独立测试的子函数）必须先行完成；无其他 Phase 依赖。本 Phase 是全链起点。

**验证点（抄自 plan，共 8 条）**：
1. `npm run repo:check` —— `agent-tools:required` 8 条断言全 PASS（SC-003 = 8 ÷ 8）；`gate-mounting:effective-config` 12 条断言全 PASS；既有 `namespace-consistency:agent-frontmatter-*` 5 项与 `preference-rules:agent-block-sync` 不因增列 `Edit` / `Bash` 而红。
2. `npx vitest run` + `npm run test:plugins` 零失败；新增 FR-052 负向断言单测（覆盖被拒时 diagnostic 级别 ≥ `error`）。
3. FR-053 红灯构造：只替换 `modes.feature`、不碰 `gates:` 块的 overrides，断言挂载断言 (i) 必须红、(ii)~(v) 全 PASS。
4. R-1 红灯构造：删一对 marker 后 `npm run repo:check` 输出一条 `agent-docs` 族 `fail` + 其余 90 个 check 结论完整（不是未捕获异常栈）。
5. `npm run build` 类型检查零错误。
6. 宪法原则 IX 逐条核对：3 处新增 `.mjs` 断言各能在对应 prompt / 模板中找到同语义原文。
7. K14 断言清单同步两步验证：(a) 未更新前先跑 `spec-drift-repo-check-regression.test.ts` 断言红且 `added` 长度为 **11**（Phase A 时点：既有 8 + 本 Phase 落地 3 = 11；同时是推断前提 P-9 的证实命令）；(b) 更新为 **14** 项后复跑——本 Phase 预期仍红（11 ≠ 14，不判回归），终态绿在 Phase D 第 4 个 entry 落地后（T078/T085）确认。换算式：终值 8 + 6 = 14；Phase A 中间值 8 + 3 = 11（单位：check id）。
8. `repo-check-baseline.json` `[禁改]`——以「同步基线」为名更新它即为把守护项自身关掉。

### 任务列表

> **本 Phase 与 plan Phase C 落点表的一处重叠（段 2 生成 Phase C 任务时须据此避让）**：FR-068 在 plan §FR → Phase 覆盖矩阵 的「认领 Phase」列取值为 **A**，且 plan §分 Phase 实现方案 调整表第 1 行的理由是「同批交付使 `mounted` 一落地即有消费点」，故 **块 2（`plugins/spec-driver/templates/orchestrator-gate-mounting-guard.md`）+ 它的 `sectionConfigs` entry + 5 份 SKILL 的 marker** 由本 Phase 认领（T025 ~ T029）。plan Phase C 落点表的**第 2 行、第 4 行中 `orchestrator-gate-mounting-guard` 的那个 entry、第 9-13 行**与此为**同一批物理落点，不得重复签发**；Phase C 仍认领块 1、块 3、其余 2 个 entry、4 份 agent 的块 1 marker 与 7 份 SKILL 的块 3 marker（换算式：plan Phase C 落点 16 − 本 Phase 提走 7 = 9，单位：落点行）。

- [x] T001 [CLEANUP] C1 拆分前基线取证：跑 `npx vitest run plugins/spec-driver/tests/orchestration-resolver.test.mjs plugins/spec-driver/tests/orchestrator.test.mjs` 与 `npm run test:plugins`，按 FR-062 留痕命令原文与原始输出；零失败即基线成立，作为 T003 等价性判定的对照组 → `[CLEANUP] C1`
- [x] T002 [CLEANUP] 拆分 `plugins/spec-driver/lib/orchestration-resolver.mjs` 的唯一导出 `resolveOrchestrationConfig`（实测跨 `:187`~`:519` = 333 行 > 200，plan §`[CLEANUP] C1` 触发规则 (ii)）为 5 个可独立测试的子函数：`loadBaseOrFallback()`（步骤 1~2 + zod 缺失短路）/ `loadOverridesOrNull()`（步骤 3~7）/ `mergeAndValidate()`（步骤 8~9）/ `validateGateMounting()`（**本步只落空壳与调用位，逻辑由 T007 填**）/ `assembleResult()`（步骤 10~结尾的 fieldSources 组装）；**不动** `mergeOrchestrationConfigs`（`:68`）与 `buildBaseOnlyFieldSources`（`:520`） → `[CLEANUP] C1` / FR-052
- [x] T003 [CLEANUP] C1 拆分后零行为验证：复跑 T001 同一组命令并断言零失败，且 `git diff --stat -- plugins/spec-driver/tests/orchestration-resolver.test.mjs` 输出为空（既有用例一条不改；改了即说明拆分改变了行为，须回退 T002 重拆） → `[CLEANUP] C1`
- [x] T004 [P] 失败测试 · FR-052 禁改集甲乙：在 `tests/unit/spec-driver-orchestration-schema.test.ts` 新增负向用例——覆盖 `GATE_DESIGN.default_behavior` 或 `GATE_DESIGN.hard_gate_modes`（甲）、`GATE_TASKS.default_behavior ∈ {auto, skip}`（乙）时被拒且 diagnostic 级别 ≥ `error`；同时新增正向用例断言 `severity` 与 `applicable_modes` **仍可覆盖**（二者不进禁改集，防守护过宽） → FR-052
- [x] T005 实现 · FR-052 禁改集甲乙：改 `plugins/spec-driver/contracts/orchestration-schema.mjs` 的 `gateOverrideSchema`（`:193-199`）落禁改集甲乙，被拒时发 ≥ `error` 级 diagnostic；**拒绝消息文本须直接写出被拒的字段路径与「改 spec 而非改覆盖」的正确做法**——该文本是宪法原则 XIII 留痕义务 (b) 的迁移指引落点（plan §Complexity Tracking 一 第 3 条明写「属 Phase A 落点 5 的交付内容」），`GATE_TASKS` 暂停时须一并呈现；验收 = T004 全绿 → FR-052
- [x] T006 失败测试 · FR-052 禁改集丙（resolver 挂载校验）：在 `plugins/spec-driver/tests/orchestration-resolver.test.mjs` 新增负向断言——构造一份**只替换 `modes.feature`、完全不碰 `gates:` 块**的 overrides（删掉 phase `3.5 gate_design`、把 phase `4 plan` 的 `gates_before` 置 `null`），断言 diagnostics 中该条目级别 ≥ `error`（不是 `warning`、不是静默丢弃）且结果回退 base（`isFallback: true`）；**既有用例一条不改** → FR-052
- [x] T007 实现 · FR-052 禁改集丙：在 T002 拆出的 `validateGateMounting(merged, base)` 内实现——步骤 8 合并**之后**、返回 effective **之前**，对 `{GATE_DESIGN, GATE_TASKS}` 断言「effective 的挂载集 ⊇ base 的挂载集」；不成立 ⇒ 发 `error` 级 diagnostic + 回退 base（与 `:454-463` 的 schema-fallback 同路，**级别由 `warning` 提为 `error`**，与 `:475-479` 的 `orchestration.base-invalid` 同级）。**刻意不覆盖三处 fallback 返回路径**（`:201` / `:229` / `:269`，裁定 A-② 第 2 层：base 已损坏时回退无处可回会成循环，其 fail-loud 由既有 `error` diagnostic 承担）；验收 = T006 全绿 → FR-052
- [x] T008 失败测试 · `mounted` 计算：在 `plugins/spec-driver/tests/orchestrator.test.mjs` 新增 `buildGateMountingMap()` 断言（gate ∈ `phase.gates_before ∪ phase.gates_after` ⇒ `mounted: true`，取不到按 `false`），并补一条 **fallback 路径断言**（`generateFallbackConfig()` 返回值上 `mounted` 仍可算出，裁定 A-② 第 1 层）；同时确认 K15 登记的既有断言（该文件对 `get-gate-behavior` / `is_hard_gate` 的 15 处命中，plan §reverse-census K15）**零回归** → FR-052
- [x] T009 实现 · `mounted` 计算：在 `plugins/spec-driver/lib/orchestrator.mjs` 于 `buildGateBehaviorMap`（`:113-148`）之外新增 `buildGateMountingMap()`，遍历 `this.config.modes[this.mode].phases`；验收 = T008 全绿 → FR-052
- [x] T010 失败测试 · `get-gate-behavior` 输出面：在 `plugins/spec-driver/tests/orchestrator.test.mjs` 断言 `cmdGetGateBehavior` 输出新增 **`mounted`**（effective 侧）与 **`mounted_in_base`**（base 侧同一算法，取自 `resolverResult.baseConfig`）两字段，且既有 8 个输出字段（`success`/`mode`/`gate_id`/`behavior`/`source`/`is_hard_gate`/`severity`/`description`）一个不少 → FR-052 / FR-068
- [x] T011 实现 · `get-gate-behavior` 输出面：改 `plugins/spec-driver/scripts/orchestrator-cli.mjs` 的 `cmdGetGateBehavior`（`:112-130`）输出两字段；`mounted_in_base` 是裁定 A-③ 判据的另一半（缺它则按 FR-068 字面口径实现会使 `resume` / `fix` 永久 `BLOCKED`）；验收 = T010 全绿 → FR-052 / FR-068
- [x] T012 [P] 失败测试 · FR-053 守护项：新建 `plugins/spec-driver/tests/validate-gate-mounting.test.mjs`（命名沿用同目录 `fix-compliance-judge-cli.test.mjs` 等插件脚本测试惯例，由 `npm run test:plugins` 收），覆盖 12 条断言（换算式：6 挂载 + `is_hard_gate` 1 + `GATE_DESIGN.default_behavior ≠ skip` 1 + `GATE_TASKS.default_behavior ∉ {auto,skip}` 1 + diagnostics 无 `error` 3 = **12**，单位：断言）；并含**红灯构造**——在 scratch 项目根写一份只替换 `modes.feature`、不碰 `gates:` 块的 overrides，断言挂载断言 (i) **必须红**且 (ii)~(v) 全 PASS（这是该守护项存在的唯一理由） → FR-053
- [x] T013 实现 · FR-053 守护项：新建 `plugins/spec-driver/scripts/validate-gate-mounting.mjs`，导出 `validateGateMounting({ projectRoot })`，12 条断言打在 base + overrides 合并后的 effective 配置上；**强制 mode 清单从 `GATE_DESIGN.hard_gate_modes` 与 mode 分层矩阵派生，禁写字面量**（FR-038 / F259 反模式「判据写成值枚举 ⇒ 每加一个值漏一次」）；`catch` 分支禁止返回空结果或 `pass`（FR-045）；验收 = T012 全绿 → FR-053
- [x] T014 [P] 失败测试 · FR-017 工具面守护：新建 `tests/unit/agent-tools-core.test.ts`（命名沿用 `tests/unit/codex-plugin-consistency-core.test.ts` 等 `scripts/lib/*-core.mjs` 的测试惯例），覆盖 8 条断言（换算式：正向 6 = 3 份 agent × 2 工具（`Edit` / `Bash`）+ 护栏 1 + 文本 1 = **8**，单位：断言；与 SC-003 的分母同源）；文本断言的对象是共享块 1 中「协议对 `verify` 不适用且不得为其新增任何工具项」的诚实口径声明（FR-017 (iii)），本 Phase 先断言其**缺席时红**，Phase C 块 1 落地后转绿 → FR-017
- [x] T015 实现 · FR-017 工具面守护：新建 `scripts/lib/agent-tools-core.mjs` 导出 `validateAgentTools({ projectRoot })`，复用 `scripts/lib/namespace-consistency-core.mjs:22-46` 的 `extractFrontmatterTools` 解析器，但**不做 `:134` 的 `mcp__` 前缀过滤**（该过滤正是 `Edit` / `Bash` 在既有守护项里结构性不可见的根因）；`catch` 分支禁止返回 `pass`（FR-045）；只 `import` `node:` 内置（FR-037） → FR-017
- [x] T016 红灯取证 · FR-015 前置：在**尚未改任何 frontmatter** 时先跑 T014 的测试与 `node -e` 直调 `validateAgentTools`，确认正向 6 条断言**全红**并留痕命令原文与原始输出——未红即说明断言写反或解析器仍在过滤 `Edit` / `Bash`，须回到 T015 核对（F272 登记的「先证必红再证转绿」纪律） → FR-015 / FR-017
- [x] T017 [P] 实现 · `plugins/spec-driver/agents/specify.md` 第 3 行 `tools` 增列 `Edit`、`Bash`（当前实测为 `[Read, Write, Grep, Glob]`，二者皆无） → FR-015
- [x] T018 [P] 实现 · `plugins/spec-driver/agents/plan.md` 第 3 行 `tools` 增列 `Edit`、`Bash`（当前实测为 `[Read, Write, Grep, Glob, mcp×2]`） → FR-015
- [x] T019 [P] 实现 · `plugins/spec-driver/agents/tasks.md` 第 3 行 `tools` 增列 `Edit`、`Bash`（当前实测为 `[Read, Write, Grep, Glob]`） → FR-015
- [x] T020 [P] 失败测试 · R-1 兜底外壳：新建 `tests/unit/repo-check-agent-docs-fallback.test.ts`（形态对照同目录 `spec-drift-repo-check-fallback.test.ts`），构造「`agent-docs` 族校验抛异常」（删一对 marker 或让 `sourcePath` 缺失，触发 `scripts/sync-agent-docs.mjs:66` / `:104` 的 `throw`），断言 `validateRepository` 返回**一条 `agent-docs` 族 `fail` check 且异常消息进 `evidence`**、其余族结论完整，**而不是未捕获异常栈、也不是 `pass` 或空 checks 数组**（FR-045 方向：记 `fail` 不记 `pass`） → FR-017 · R-1
- [x] T021 实现 · R-1 兜底外壳：在 `scripts/lib/repo-maintenance-core.mjs` 新增 `validateSharedAgentDocsSafely({ projectRoot })`，与同文件 `:194` 的 `validateSpecDriftSafely` **同型**，并把 `:260-266` 的 `aggregateValidation('agent-docs', validateSharedAgentDocs(resolvedRoot), …)` 改为调用它；验收 = T020 全绿 → FR-017 · R-1
- [x] T022 实现 · 两族接线：在 `scripts/lib/repo-maintenance-core.mjs` 新增 `aggregateValidation('agent-tools', …)`（FR-017）与 `aggregateValidation('gate-mounting', …)`（FR-053）；**插入顺序须与 T024 的 check id 清单排序一致**（`agent-docs` 是 `:261` 的第 1 族，两个新族的位次由本处的 `aggregateValidation` 调用顺序决定）；随后跑 `npm run repo:check` 确认 `agent-tools:required` 8 条与 `gate-mounting:effective-config` 12 条全 PASS（SC-003 = 8 ÷ 8），且既有 `namespace-consistency:agent-frontmatter-{plan,implement,verify,spec-review,quality-review}` 5 项与 `preference-rules:agent-block-sync` **不因增列 `Edit` / `Bash` 而红** → FR-017 / FR-053
- [x] T023 先证必红 · K14 / P-9：**在未更新断言清单前**跑 `npx vitest run tests/integration/spec-drift-repo-check-regression.test.ts`，断言其**红且失败信息显示 `added` 的长度**，留痕命令原文与原始输出——这同时是推断前提 **P-9** 的证实命令。**长度换算式与本 Phase 的在位增量核对**：终值 **14** = 既有 8 + 本卡新增 **6**（换算式：8 + 6 = **14**，单位：check id；新增 6 = `agent-docs:shared-section:*` **4** + `agent-tools:required` 1 + `gate-mounting:effective-config` 1——`shared-section` 由 3 增为 4 是 plan 裁定 **D-③** 走共享块 4 的连带，见 plan §修订记录），而本 Phase 只落其中 **3** 个（换算式：新族 2 + 块 2 的 shared-section 1 = 3，单位：check id），故本 Phase 实跑若得 11 属预期；**11 ≠ 14 不判 P-9 FAIL，须在 Phase C 另 2 个 entry 与 Phase D 第 4 个 entry（裁定 D-③）落地后复跑确认为 14**，两次输出都要留痕。既红也非 11 / **13**（Phase C 收口的中间值：8 + Phase A 3 + Phase C 2 = 13）/ 14 任一值时才回到 T013 / T015 / T022 核对新守护项实际吐出的 check id 集合 → FR-017 / FR-053 · K14
- [x] T024 实现 · K14 断言清单同步：把 `tests/integration/spec-drift-repo-check-regression.test.ts` 的 `expect(added).toEqual([...])`（实测在 `:115-127`）由 **8 项更新为 14 项**（换算式：8 + 6 = **14**，单位：check id；基线 8 项实测在 `:119-126`；「新增 6」含 plan 裁定 **D-③** 引入的第 4 个 `agent-docs:shared-section:*`，故 `shared-section` 计 **4** 而非 3），排序**按 `validateRepository` 的族追加顺序**（4 个新 `agent-docs:shared-section:*` 排在既有首项 `spec-driver-wrappers:codex-wrapper-runtime-namespace` 之前）；**`tests/fixtures/spec-drift/repo-check/repo-check-baseline.json` `[禁改]`**——以「同步基线」为名更新它即为把守护项自身关掉；本条**是预期变更、不是回归**，须在 commit message 与验收产物中按该口径留痕 → FR-017 / FR-053 · K14
- [x] T025 实现 · FR-068 单一事实源：新建 `plugins/spec-driver/templates/orchestrator-gate-mounting-guard.md`（块 2），写入运行时挂载守卫——判据为 **`mounted_in_base === true ⇒ mounted === true`**（对 `g ∈ {GATE_DESIGN, GATE_TASKS}` 各判一次），**两字段任一取不到 / CLI 调用失败 / `effective-orchestration <mode>` 的 diagnostics 含 `error` ⇒ `BLOCKED`**（判不出从严）；`BLOCKED` = **拒绝启动、无「批准继续」选项**（实现成「暂停询问是否忽略后继续」即判 FR-049 已违反）；块首以 `SD_MODE` 变量参数化；**散文内禁写 `mcp__` 字面量**（plan §SC-006 逐项重判 #4：wrapper 运行时 namespace 守护项会因此由 pass 转 fail）；同时按裁定 A-③ 写入两条残余登记（`refactor` 不纳入、判据对「base 被直接编辑掉挂载」是盲的）。**本条同时为约束型 `FR-049` 的核验提供文本落点**，但 `FR-049` 按 §约束型 FR 核验点 不生成任务、不出现在下方认领标注中 → FR-068
- [x] T026 实现 · FR-068 注入 entry：在 `scripts/sync-agent-docs.mjs` 的 `sectionConfigs`（`:6-57`）新增 **1** 个 entry `{ key: 'orchestrator-gate-mounting-guard', sourcePath: 'plugins/spec-driver/templates/orchestrator-gate-mounting-guard.md', targets: 5 份编排器 SKILL }`；`sourcePath` 放 `plugins/spec-driver/templates/` 而非 `docs/shared/`（裁定 C-①，且这是 SC-007「仓根字节净增量 = 0」成立的前提）。**认领口径**：本 entry 是 `FR-068` 注入形态的物理落点；`FR-036`「同一段话不得抄进多份」这条纪律本身、连同其余 2 个 entry，仍由 Phase C 认领 → FR-068
- [x] T027 [P] 实现 · FR-068 落点（`resume`，需新建小节）：在 `plugins/spec-driver/skills/spec-driver-resume/SKILL.md` 新建 `### 3.5 门禁挂载守卫` 小节承载 marker，并加 1 行 `SD_MODE=resume`（在 marker **之外**）。插入位 = 「### 3. 配置加载」之后、「### 4. 项目上下文注入（project-context，可选）」之前（plan 记录的行号快照为 `:60` 后 / `:67` 前）；**锚点行号须以 `grep -n` 现取，不得照抄快照**（plan §reverse-census K11 连带口径 (i)）。理由：该 SKILL 全文**无 `get-gate-behavior` 调用**，不存在「查询 gate 行为之后」这一位置，取「配置加载完成之后、任何产出阶段之前」的最早可插入点 → FR-068
- [x] T028 [P] 实现 · FR-068 落点（4 份已有小节）：在 `plugins/spec-driver/skills/spec-driver-{feature,story,implement,fix}/SKILL.md` 的「门禁配置加载」小节末各加一对 `<!-- BEGIN/END SHARED SECTION: orchestrator-gate-mounting-guard -->` marker + 1 行 `SD_MODE=<mode>`（marker 之外）；plan 记录的小节行号快照为 `feature:93` / `story:97` / `implement:107` / `fix:95`（`fix` 的小节名为「### 3. 门禁配置加载（通过编排器查询）」），**均须 `grep -n` 现取**。`refactor:68` 虽有同名小节但**不纳入**（裁定 A-③：不在 FR-068 点名的 5 份之列、不在 FR-052 (丙) 强制 mode 集内、`GATE_DESIGN.applicable_modes` 实测不含 `refactor`），其「有门禁配置加载小节却不受本卡守卫覆盖」已由 plan 登记为残余 → FR-068
- [x] T029 验证 · FR-068 注入闭环：跑 `npm run docs:sync:agents` 后 `git diff --exit-code` 零输出（幂等），再跑 `npm run repo:check` 确认新 check id `agent-docs:shared-section:orchestrator-gate-mounting-guard` = pass；并复跑 T020 的 R-1 红灯构造一次（marker 面已由「仓根 2 个必然存在的文件」扩到「5 份 SKILL」之后），断言输出仍是一条 `agent-docs` 族 `fail` + 其余 check 结论完整（plan Phase A 验证点 4 记的对照数为「其余 90 个」，**以当次 `repo:check` 实跑输出为准，不照抄该数**） → FR-068 · R-1
- [x] T030 核对 · K3 禁改集射程逐份核对（plan §reverse-census K3 明写「留 Phase A 任务」，本条即其消账）：逐份核对 **8 份** `plugins/spec-driver/tests/fixtures/orchestration/*.yaml`（`invalid-schema-bad-mode` / `valid-overrides-goal-loop` / `goal-loop-version-mismatch` / `overrides-with-parallel-groups` / `invalid-anchor` / `version-mismatch-overrides` / `valid-overrides-mode-fix` / `valid-overrides-gate`）是否触碰 T005 的禁改集——触碰者其宿主用例会连带红；另核 **2 份**发给用户抄的样例（`plugins/spec-driver/templates/orchestration-overrides.example.yaml`、`templates/goal-loop-override-template.yaml`：样例若自身写了禁改字段，用户照抄即被拒）与 **1 份**合同说明（`plugins/spec-driver/contracts/orchestration-overrides-contract.yaml`：禁改集须同步）。换算式：8 + 2 + 1 = **11 份**（单位：文件；取自 plan K3 (b) 口径的 19 文件中与禁改集直接相关的子集），逐份结论与命令原文按 FR-062 留痕 → FR-052
- [x] T031 核对 · 宪法原则 IX（plan Constitution Check 判 CONDITIONAL PASS，把逐条核对钉在本 Phase 验收）：本 Phase 3 处新增 `.mjs` 断言（`agent-tools-core.mjs` 8 条 / `validate-gate-mounting.mjs` 12 条 / resolver 挂载校验 1 条，换算式 8 + 12 + 1 = **21 条断言**）**每一处**都要能在对应 prompt / 模板中找到同语义原文；找不到即判原则 IX VIOLATION 并回退该处实现（FR-035 的核验落点之一） → FR-052 / FR-053 / FR-017
- [x] T032 核对 · 宪法原则 X 与 XIII（plan Constitution Check 明写「须与原则 XIII 一并在 Phase A 核」）：(a) 原则 X——FR-068 把「`orchestrator-cli.mjs` 调用失败」由软降级升为**硬阻断**，须核该行为变更不使编排核心在 Harness 不可用时功能退化（既有 SKILL 的 `get-gate-behavior` 调用实测已是同一依赖面，故非新增依赖，但阻断语义是新的）；(b) 原则 XIII 留痕义务 (c)——实跑 `ls -la .specify/orchestration-overrides.yaml` 复核本仓自身**未覆盖** `GATE_DESIGN` / `GATE_TASKS` 任何字段（裁定 A-④ 实测为 `No such file or directory`），确认 T005 的禁改集落地不把本仓判红；两项结论附命令原文与原始输出 → FR-052 / FR-068
- [x] T033 验证 · Phase A 收口全量跑：`npm run build`（类型检查零错误）+ `npx vitest run` + `npm run test:plugins`（零失败）+ `npm run repo:check`；失败须按 FR-050 三条件归因（隔离重跑绿 + 与本卡改动面零交集 + 命中或新登记入预存 flaky 清单）后方可不计失败，未归因的一律计失败 → FR-015 / FR-017 / FR-052 / FR-053 / FR-068

**换算式**：本 Phase 任务 **33** 条 = `[CLEANUP]` 3（T001~T003）+ 测试与红灯取证 9（T004 / T006 / T008 / T010 / T012 / T014 / T016 / T020 / T023）+ 实现 16（T005 / T007 / T009 / T011 / T013 / T015 / T017~T019 / T021 / T022 / T024~T028）+ 核对与验证 5（T029~T033），单位：任务。`[P]` 标记 9 条（T004 / T012 / T014 / T017~T019 / T020 / T027 / T028），单位：任务。

**对抗修订（α-C1~C3）** —— Phase A 异构对抗审查（`verification/adversarial-phaseA-alpha.md`）在 commit ① 前挖出 3 条 CRITICAL：门挂载判据是纯结构存在性，被「幽灵 `conditional`」/「幽灵 `skip_if_exists`」/「挂到序列末尾」三类构造整类绕过，三道防线同时判绿。**本轮已在 Phase A 内收口，未新增任务编号**：判据升为 base 锚定的可达性（`evaluateGateMountingAgainstBase`），新增 4 份攻击 fixture 与 4 个测试文件的用例；α-W2（重复 `tools:` 键的诱饵行）一并收口。逐条留痕见 `implementation-notes.md` 的 D-20 ~ D-23。

**对抗修订第二轮（β-C1/C2、δ-C1）** —— 第二轮异构对抗（`verification/adversarial-phaseA-beta.md` 与 `verification/adversarial-phaseA-alpha-delta.md`）在 commit ① 前再挖出 3 条 CRITICAL，共同根因是「射程由被守护的那份数据自己决定」：β-C1（`extractFrontmatterTools` 的三种「读不全」被消费成确定观测值，单向集合差护栏对残缺输入恒真）、β-C2（强制 mode 清单按被守护配置的 `modes` 键过滤，删一段 ⇒ 断言 12→9 且报 pass）、δ-C1（位序规则只枚举 base 已有的 phase 名，插一个产出型新 phase 即让 `story` / `implement` 两道门零求值）。**本轮同样在 Phase A 内收口，未新增任务编号**：解析器三分返回值 + verify 护栏改逐字相等、强制 mode 清单钉为常量下界 + `mandatory-mode-missing` error、位序规则新增 `foreign-phase-before-gate` 子句；另加 β-W2 的 `SD_MODE` 窄断言与 β-W3 / β-W4 / δ-W1 / δ-W2 / δ-I2 的口径修订。逐条留痕见 `implementation-notes.md` 的 D-24 ~ D-31。

**对抗修订第三轮（δ-C1 判据重写）** —— 第二轮的收口被复验判为「仅措辞变动」（`verification/adversarial-phaseA-round2-delta.md`）：新加的位序子句 `foreign-phase-before-gate` 把「要不要检查这个 phase」换了来源，但换到的仍是**被守护的那份数据里攻击者可写的字段**（`name` / `agent` / `agent_mode`），三个逃逸口（复用 base 名字换 `agent` / `agent: null` 的 inline 产出 / `agent_mode: gate` 但 `agent` 非空）各自都能把 `story` / `implement` 的两道门打到**零求值**而三道防线全绿（编排器亲自复现，见 D-32）。**本轮仍在 Phase A 内收口，未新增任务编号**：废除 `isProducerPhase` / `collectForeignProducers`，判据改为只对照 base 的三条——锚点身份三元组相等（`anchor-tuple-changed`）、锚点前是 base 同段的子序列（`pre-anchor-phase-not-in-base`，可删不可增不可改）、锚点后位序沿用；另收口 N-3（`undecidable` 支的 `mounted` 不再回落到结构存在性）与 N-2 的覆盖面 over-claim。逐条留痕见 `implementation-notes.md` 的 D-32 ~ D-37。

---

## Phase B：矩阵主链（散文 + 模板）

> plan 中的完整标题为「Phase B — 矩阵主链 + 既有判定链收编 + 交付合并律」（plan 对基线标题作了一处扩范围调整，吸收 FR-054~058 与 FR-059~061，理由见 plan §分 Phase 实现方案 调整表第 3 行）。

**目标**：(1) 在 plan 模板**双源**中落成 4 个新具名章节，并把 canonical 与项目副本的漂移收敛；(2) 把 FR-005 的五态 / 三取值、FR-042 的外部判据兼容分支、FR-063 的统一缺席规则写进 `agents/verify.md`；(3) 统一收编 verify 与 spec-review 两条既有判定链的状态词表（射程按实测全扫，不按卡面点名）；(4) 落成交付判定合并律与 MUST 裁剪准入闸门。

**认领 FR（26 条）**：`FR-001` ~ `FR-007`（7）+ `FR-026` ~ `FR-029`（4）+ `FR-042` ~ `FR-044`（3）+ `FR-046` ~ `FR-047`（2）+ `FR-054` ~ `FR-058`（5）+ `FR-059` ~ `FR-061`（3）+ `FR-062` ~ `FR-063`（2）
换算式：7 + 4 + 3 + 2 + 5 + 3 + 2 = **26**（与 plan §换算式 式 2「Phase B = 26」一致；单位：FR 条）

**前置依赖**：Phase A（本阶段要求 plan / tasks 子代理逐节 `Edit` 并跑命令取计数，物理前置由 FR-015 提供）；`[CLEANUP] C2` 必须先行完成（**两对副本**：`plan-template.md` 104 vs 134、`tasks-template.md` 251 vs 266）。

⚠️ **待办（plan 对齐阶段登记、未消账，须在本 Phase 转成显式任务）**：**FR-005 的冻结散文落到哪些 SKILL 尚未定案**。plan 矩阵 FR-005 行写的 SKILL 集是 `{feature, story, implement, fix, resume}`（5 份），而 plan §裁定 B-② 依据 FR-060 实测记录 `GATE_TASKS` 实际挂载 **7 个 mode**（`feature` / `story` / `implement` / `resume` / `sync` / `doc` / `refactor`，**`fix` 零挂载**），Phase B 落点表第 11-17 行也按 7 份列出。两处不一致的实质是：矩阵行把 `fix` 计入而实测 `fix` 无 `GATE_TASKS` 可挂、把 `sync` / `doc` / `refactor` 排除而实测三者有挂载。**本 Phase 须产出一条显式裁定任务**，按实测的 7 份为准并留痕更正矩阵 FR-005 行的 SKILL 集，或给出保留 `fix` 的理由（若保留，须说明在 `fix` 下冻结值写到何处）。**不得静默择一**。

**验证点（抄自 plan，共 6 条）**：
1. **D-1（F270 覆盖矩阵回放）**：阳性 = 点名 4 组未认领项全集（`FR-026` / `FR-012` / `FR-030..032` / `FR-033`），捕获率 4 ÷ 4 = 100%；阴性 = 抽 ≥ 3 条确有 Phase 认领的 FR，误报 0 ÷ 3 = 0%；冲突 = 回放结论与 F270「13 达成」口径矛盾。三者同时成立才算通过，结论须附命令与原始输出（FR-062）。
2. D-3 的判据文本在本阶段只做结构落地（词表与合并律），执行在 Phase D。
3. `npm run repo:check` —— `agent-docs:shared-section:*` 全 pass；`delegation-contract:{skill-block-sync,codex-wrapper-block-sync}` 不因 SKILL 改动而红。
4. `npx vitest run` + `npm run test:plugins` 零失败。
5. 三份 `verification-report-template.md` 交付后 `diff` 两两为空。
6. 状态词表残留全扫：`grep -rnE '部分实现|过度实现|无法验证' plugins/spec-driver .specify` 的命中全部落在旧→新映射表自身，无一处仍以旧值作判定取值；命令与原始输出写入产物。

### 任务列表

> **本 Phase 全部为 `.md` / `.yaml` 散文与模板改动，无 `.mjs` 落点**，故不适用「先写失败测试再实现」的分任务规则（该规则的射程是 `.mjs`）；其等价物是每条任务自带的**文本核对命令**（`grep` / `diff`）与 Phase B 验证点 3~6。
>
> **三处原子组（不是并行机会）**：`plan-template.md` 双份（T037 / T038）、`verification-report-template.md` 三份（T052）、`tasks-template.md` 双份（T058）——两条分发链 `plugins/spec-driver/scripts/init-project.sh:98-118` 与 `src/utils/specify-template-sync.ts:76-90` 均为 **copy-if-absent**，只改一侧的两种失效形态（canonical 永不追平 / 已初始化项目永远拿不到）K13 已实测，故同一组内的副本必须同批改并以 `diff` 收口。

- [ ] T034 [CLEANUP] C2 对 1（`plan-template.md`，104 vs 134）：把项目副本 `.specify/templates/plan-template.md` 追平 canonical `plugins/spec-driver/templates/specify-base/plan-template.md`（补 `## Codebase Reality Check` 与 `## Impact Assessment` 两节，实测项目副本 `^## ` 章节 5 个 / canonical 7 个）；验收 `diff <(grep '^## ' .specify/templates/plan-template.md) <(grep '^## ' plugins/spec-driver/templates/specify-base/plan-template.md)` **零输出** → `[CLEANUP] C2`
- [ ] T035 [CLEANUP] C2 对 1 的散文两项：改 `plugins/spec-driver/agents/plan.md` —— (a) `:38` 的模板读取顺序改写为「canonical = `plugins/spec-driver/templates/specify-base/plan-template.md`；生效读取顺序 = 项目级 `.specify/templates/plan-template.md` 优先、`$PLUGIN_DIR/templates/specify-base/plan-template.md` 回退」（与 `agents/verify.md:39` 的既有两级口径同型）；(c) 写明「读到的模板缺少 `required_sections` 中的任一节时，**按缺席处理并显式报出**，不得静默产出少节的 `plan.md`」。**不加漂移守护项**（`.specify/templates/` 是 copy-if-absent 的用户自持面，硬守护会把所有已初始化项目判红，违反 C-5 / 宪法 XIII），残余由 plan 登记 → `[CLEANUP] C2`
- [ ] T036 [CLEANUP] C2 对 2（`tasks-template.md`，251 vs 266）：跑 `diff .specify/templates/tasks-template.md plugins/spec-driver/templates/specify-base/tasks-template.md` 对 **15** 行差异（换算式 266 − 251 = 15，单位：行）**逐块判定并收敛**——属 canonical 新增的补入项目副本，属项目侧本地定制的**保留并在 `plugins/spec-driver/agents/tasks.md` 留痕**，**不无差别覆盖**；验收 = 收敛后 `diff` 输出只剩已留痕的项目侧定制块 → `[CLEANUP] C2` / FR-005
- [ ] T037 实现 · 4 个新具名章节（原子组：`plan-template.md` 双份同批）：在 canonical `plugins/spec-driver/templates/specify-base/plan-template.md` 与项目副本 `.specify/templates/plan-template.md` 各新增 `## FR → Phase 覆盖矩阵`（含**类别**列）/ `## 裁剪登记` / `## 关键量反向普查` / `## 推断前提登记` 四节的**结构与行格式定义**；矩阵节须写明「认领 Phase 列可多值」（FR-002）与「约束型行填占位符 `—`」；普查节须写明「每行的可复现检索命令原样写入」（FR-027）与**执行环境声明**要求（plan §reverse-census 执行环境声明 明写「此项须随 FR-027 的模板章节一并写入」）；登记节须写明 `[推断]` / `[INFERRED]` 标记契约与「已核实」桶的证据标准（须附命令**与原始输出片段**）。验收 = 两份 `diff <(grep '^## ' A) <(grep '^## ' B)` 零输出。**不把 `## Architecture` 与 `## 分 Phase 实现方案` 写进模板**（前者是 canonical 已有的 optional 节、后者是本 plan 自设，spec FR-067 只强制上述 4 节）。**认领口径**：`## 推断前提登记` 一节的**结构**在本条落地，但该节对应的 `FR-032` 认领 Phase 为 **D**（plan 矩阵取值），故不列入本条认领标注；映射表填充时可把本条并列列入 `FR-032` 的 `Task ID(s)` → FR-001 / FR-002 / FR-004 / FR-026 / FR-027
- [ ] T038 实现 · 两处「不适用」占位口径（同为 `plan-template.md` 双份原子组）：在矩阵节写入「不适用（本次无 FR 列表）」占位口径（FR-007）、在普查节写入「不适用（本次无关键量变更）」占位口径（FR-029），两处均须同时写明**「产出仅有表头、无内容却被标记为已完成的形式主义空表，与漏做同等判为不合格」** → FR-007 / FR-029
- [ ] T039 实现 · `plugins/spec-driver/agents/plan.md` 章节产出口径：(a) 写入 4 个新章节的产出口径与格式定义（与 T037 的模板结构一一对应，模板给结构、agent 给填写口径）；(e) `:96` 的填充章节清单补入这 4 个新章节。**认领口径同 T037**：推断前提登记节对应的 `FR-032` 认领 Phase 为 **D**，不列入本条标注 → FR-001 / FR-004 / FR-026
- [ ] T040 实现 · `plugins/spec-driver/agents/plan.md` 的 FR-003 交叉校验：写入「矩阵『认领 Phase』列的每个取值必须 ∈ 本文件 §分 Phase 实现方案 定义的 Phase 集合」的产出侧判据（约束型行的占位符 `—` 不参与校验），并在 `plugins/spec-driver/agents/verify.md` 侧写入同一判据的**消费侧**口径 → FR-003
- [ ] T041 实现 · `plugins/spec-driver/agents/plan.md` 的 FR-028 一致性校验：写入「reverse-census 每行的**声明条数 == 该行检索命令的实际输出计数**」校验与不一致时的**阻断**口径；并写明该校验的能力边界（判据输入按定义就是执行者自己申报的集合，**覆盖不了「该申报的关键量是否都申报了」**，对应 plan §推断前提登记 的 B-P1，不得被口径为已解决） → FR-028
- [ ] T042 实现 · `agents/verify.md` 判定态定义：把 `:58` 的「✅ 已实现 | ❌ 未实现 | ⚠️ 部分实现」改写为 FR-005 的**五态**（已实现（附证据）/ 已裁剪（附理由）/ 未实现 / 未执行（缺席）/ 未对账）+ **约束型 FR 三取值**（已核验未违反（附核验方式）/ 已违反 / 未核验），写明「未执行（缺席）」与「未对账」不得互相复用、二者均归入不通过侧；同处写入 FR-006 的「未认领且未登记裁剪 ⇒ 自动判『未实现』」与冲突留痕格式 → FR-005 / FR-006 / FR-054
- [ ] T043 实现 · `agents/verify.md` 冻结值三值并列比对：写入「① 编排器注入值 / ② tasks 制品读到的值 / ③ 对当前 `plan.md` 矩阵章节的现算值」三值并列报告 + 两两比对结论的格式；写明**任一不一致即判「未通过」并附强制说明**（改了哪几行、为何改、在哪个阶段改）、**注入值缺席即判「未执行（缺席）」**（不得因另两值一致而判通过）、**三值一律只作参考，判定权在编排器 `GATE_VERIFY` 的亲自重算**；并写入 `resume` 分支的 `<sha>` 取法（= `tasks.md` 冻结字段中与冻结哈希**同处**记录的 commit sha；缺 sha 或 `git cat-file -e <sha>` 失败 ⇒ 判缺席；**禁止**「最近一个含 tasks 制品的 commit」「当前 `HEAD`」这类现推口径） → FR-005
- [ ] T044 实现 · `agents/verify.md` 兼容 / 降级 / 缺席三规则（连锁写在一处）：FR-042 的历史制品兼容分支及其**外部判据**（`plan.md` 首个 commit 时间 / 模板版本戳；**判不出按不成立走 fail-loud**）；FR-063 的统一缺席规则（输入制品缺席 ⇒ 先按 FR-042 外部判据判是否历史制品 ⇒ 属历史判「未对账」不阻断、不属历史则 fail-loud 判「未执行（缺席）」并阻断；**记「缺席」而无后果判定 = 不合格**）；FR-044 的降级留痕（脚本口径不可达 ⇒ **首选降级到 prompt 口径并留痕**，两口径皆不可得才判「未执行（缺席）」，宪法原则 X） → FR-042 / FR-044 / FR-063
- [ ] T045 实现 · `agents/verify.md` 兜底例外逐行（FR-057）：重跑 `grep -nE '不阻断|跳过|继续|优雅降级|不标记为失败' plugins/spec-driver/agents/verify.md` **按当次输出重算**（plan 2026-09-03 / 09-04 两轮基线均为 **11 命中行**），对每一命中行给结论——**8 行兜底型写相邻例外条款**（换算式：11 − 伪阳性 3 = **8**，单位：命中行；3 处伪阳性为 `:27` / `:28` 讲 MCP 调用纪律、`:229` 是 JSON 注释），**3 行非兜底型写明判定为伪阳性的理由**；并**并列写入**人工通读「约束」与「失败处理」两节的结论（两个口径分列，不得只写其一） → FR-057
- [ ] T046 实现 · `agents/verify.md` 合并律与交付口径：FR-059 合并律（任一子检查落在「未实现 / 未通过 / 未执行（缺席）/ 未对账 / 报警未处置 / 已违反 / 未核验」**7 种态**之一 ⇒ 交付整体判**不通过**；**未列举的新状态一律归入不通过侧**；合并结论须与各子检查结论**同处列出**使「是哪一项把交付拉红」可逐项回溯；「未对账」计入不通过侧但**不触发流程阻断**，二者是「结论口径」与「流程阻断」两个量）；FR-061 的 SC-013 双口径消费（M ÷ 8 ≥ 7 ÷ 8 **且** F ÷ 64 ≥ 61 ÷ 64，两式须同时成立）；FR-058 的产出落点（只在 `verification-report` 输出 PASS / FAIL，**不回填** `spec.md` / `plan.md`） → FR-058 / FR-059 / FR-061
- [ ] T047 实现 · `agents/verify.md` 证据留痕与对账半边：FR-062 —— 矩阵对账结论**须附产生它的命令原文与原始输出**，无者按 FR-005 计「未执行（缺席）」；FR-043 —— 本卡只落**矩阵对账半边**的 prompt 层执行口径，并显式写明可达性半边随 FR-010~013 移交 F27x、其在本卡内的缺席**不计未完成** → FR-043 / FR-062
- [ ] T048 实现 · `agents/spec-review.md` 词表统一与映射表：把 `:56-59`（四取值定义）与 `:80`（报告表格取值）统一到 FR-005 的五态 / 三取值，并在正文落成一张**旧值 → 新值显式映射表**逐条覆盖 5 个旧取值（换算式：verify 链 3 个（已实现 / 未实现 / 部分实现）∪ spec-review 链 5 个（已实现 / 部分实现 / 未实现 / 过度实现 / 无法验证）= 并集 **5**，单位：取值；缺任一旧值的映射即判 FR-055 未完成）；「过度实现」须映射为**独立观察项而非判定态**，且不得因该观察项存在而使对应 FR 计入通过 → FR-054 / FR-055
- [ ] T049 实现 · `agents/spec-review.md` 严重级映射与归并方向：`:115-117` 的严重级映射三行随旧取值改写同步（CRITICAL ← 「FR 未实现」、WARNING ← 「FR 部分实现」、INFO ← 「过度实现」三条触发条件全部改到新取值上）；`:123`（保守判定）与 `:130`（源码不可访问 ⇒ 标「无法验证」、**不标记为未实现**）按 FR-054 **重写归并方向**——**仅换取值名而保留原方向判未完成**，使「一切不确定态归入不通过侧」成立（现状 `:130` 与 FR-006 方向相反，是同一条 FR 走两条链得两种结论、交付方可择优引用的根因） → FR-054 / FR-055
- [ ] T050 实现 · `plugins/spec-driver/agents/spec-review.artifact.yaml:9` 连带改写：`required_sections` 中的 `"### 过度实现检测"` 随 T048 的章节改名同步（章节名改而此处不改即 artifact 合同断裂，宪法原则 XIV 第 4 条「涉及删除/重命名时应扫描旧名称残留」）。**这是 R-4 本轮新盘出的第 6 处连带**，不计入 K4 的 36 行 / 49 处两个口径（它是章节名而非判定态取值） → FR-055
- [ ] T051 实现 · `plugins/spec-driver/agents/tasks.md` 硬不变量改写：`:51`（「确保 100% FR 覆盖」）与 `:78`（「**100% FR 覆盖**：每条功能需求至少有一个对应任务」）两处改写为「每条**未被裁剪登记的实现型** FR 至少有一个对应任务；**约束型 FR 一律不要求任务**」；并在 FR 覆盖映射表口径处补两个指针——裁剪登记指针、类别与三取值核验落点指针。**射程只此两处**：`tasks.artifact.yaml:9` 与 `spec-review.md:51` 钉的是章节名（本卡不改该章节名，故不受影响） → FR-056
- [ ] T052 实现 · 三份 `verification-report-template.md` 同步（原子组）：对 `plugins/spec-driver/templates/verification-report-template.md`、`plugins/spec-driver/templates/specify-base/verification-report-template.md`（**canonical**）、`.specify/templates/verification-report-template.md` **同批**落入——状态词表 6 处取值迁移（每份实测 6 取值出现处 / 4 命中行 / 全文 63 行）+ 合并律小节（FR-059 的 7 种不通过态与「新状态默认归入不通过侧」）+ **缺席态字段**（「未执行（缺席）」与「未对账」分列，各带后果判定）。迁移前基线：三份 `diff -q` 两两无输出（逐字节相同）；**交付后须重跑同一组 `diff` 仍为空** → FR-054 / FR-055 / FR-059
- [ ] T053 裁定 · ⚠️ 待办消账：FR-005 冻结散文的 SKILL 集（矩阵写 5 份 `{feature, story, implement, fix, resume}`，而 FR-060 实测 `GATE_TASKS` 挂载 **7 个 mode**——`feature` `:303`/`:323`、`story` `:416`、`implement` `:493`、`resume` `:600`、`sync` `:654`、`doc` `:697`、`refactor` `:742`/`:754`，**`fix` 零挂载**）。**产出 = 一段裁定文本落进 plan §修订记录 + 同步更正 plan §FR → Phase 覆盖矩阵 的 FR-005 行**：按实测 7 份为准并说明矩阵行为何计入 `fix`、或给出保留 `fix` 的理由（若保留，须说明在 `fix` 下没有 `GATE_TASKS` 可挂时冻结值写到何处）。**不得静默择一**；裁定结论同时决定 T054~T057 的射程 → FR-005 / FR-060
- [ ] T054 [P] 实现 · `GATE_TASKS` 接受口径小节定结构（`resume`）：在 `plugins/spec-driver/skills/spec-driver-resume/SKILL.md`（实测 336 行，`grep -c 'GATE_TASKS'` = **0**）新建 `### GATE_TASKS 裁剪接受口径` 具名小节承载 Phase C 块 3 的注入位（**本阶段只定结构、不写内容**）。插入位 = 「恢复模式下同样必须执行 feature 模式定义的 `GATE_RESEARCH` 在线调研硬门禁……」之后、「### 运行事件记录（066）」之前（plan 行号快照 `:302` 后 / `:304` 前，**须 `grep -n` 现取**）。**残余登记**：本条不补该 mode 的 `GATE_TASKS` 完整处理流程散文，新小节只承载裁剪接受口径一段 → FR-060
- [ ] T055 [P] 实现 · `GATE_TASKS` 接受口径小节定结构（`sync`）：在 `plugins/spec-driver/skills/spec-driver-sync/SKILL.md`（实测 300 行，`GATE_TASKS` 命中 **0**）新建同名小节，插入位 = `### 执行步骤` 内「聚合完成报告」代码块闭合行之后、「### Prompt 来源」之前（plan 行号快照 `:294` 后 / `:296` 前，**须 `grep -n` 现取**）；残余登记同 T054 → FR-060
- [ ] T056 [P] 实现 · `GATE_TASKS` 接受口径小节定结构（`doc`）：在 `plugins/spec-driver/skills/spec-driver-doc/SKILL.md`（实测 732 行，`GATE_TASKS` 命中 **0**）新建同名小节，插入位 = `## Step 7: 完成报告` 内「状态图标规则」末行之后、「### 运行事件记录（066）」之前（plan 行号快照 `:680` 后 / `:682` 前，**须 `grep -n` 现取**）；残余登记同 T054 → FR-060
- [ ] T057 实现 · 4 份已有 `GATE_TASKS` 段的注入位登记：对 `plugins/spec-driver/skills/spec-driver-{feature,story,implement,refactor}/SKILL.md` 以 `grep -n 'GATE_TASKS'` 现取并登记 Phase C 块 3 的插入锚点（实测命中数分别为 1 / 4 / 4 / 2），**本阶段只定位不写内容**；换算式：本 Phase 的 `GATE_TASKS` 结构面 = 新建小节 3（T054~T056）+ 已有段登记 4 = **7 份**（单位：SKILL 文件），与裁定 B-② 的 7 个挂载 mode 一致 → FR-060
- [ ] T058 实现 · FR-005 冻结字段位（原子组：`tasks-template.md` 双份同批）：在 canonical `plugins/spec-driver/templates/specify-base/tasks-template.md`（266 行）与项目副本 `.specify/templates/tasks-template.md`（251 行，须先经 T036 收敛）的「FR 覆盖映射表」相关段落，各新增同一个冻结值**字段位**——矩阵规范化内容哈希 + **可选** commit sha（与哈希同处并列）+ 取值时点 —— 并写明**填写口径**（由编排器在 `GATE_TASKS` 时点写入、取不到时记什么）。**只落字段位与指针，不复制格式定义**（格式定义是 Phase C 块 3 `gate-tasks-scope-cut-acceptance.md` 的单一事实源，复制会撞 FR-036）；验收 = 两份的冻结字段段落 `diff` 逐字相同 → FR-005
- [ ] T059 核对 · plan §reverse-census K6 登记的待核项消账：核对裁剪存在后 `plugins/spec-driver/agents/verify.md:60` 与 `:237` 的 `layer1_fr_coverage`（Layer 1 精简版 FR 覆盖率统计）**分母口径是否要连带说明**——它是覆盖率统计而非「100% 覆盖」不变量，不在 FR-056 射程，但裁剪登记落地后分母含义会变；产出结论（需要说明 / 不需要说明 + 理由）落进 plan §修订记录，需要时同批改写这两处 → FR-056
- [ ] T060 核对 · FR-046 / FR-047 的落点在场性（二者的实现落点是 plan §裁剪登记 章节本身，非文件改动）：核对该章节的「8 项需求逐项『必须 / 可选』标注表」**8 行全在**（FR-046）、以及 FR-047 要求的去留论证对照表（第 3 项 / 第 5 项，**2 行**）与 spec §复杂度评估 的论证**逐条对照一致**（FR-047）；换算式 8 + 2 = **10 行**（单位：登记行），命令原文与原始输出按 FR-062 留痕 → FR-046 / FR-047
- [ ] T061 验证 · Phase B 文本护栏收口：(a) **状态词表残留全扫** `grep -rnE '部分实现|过度实现|无法验证' plugins/spec-driver .specify`，命中须**全部落在旧→新映射表自身**（映射表按定义会引用旧值），无一处仍以旧值作判定取值，命令与原始输出写入产物；(b) 三份 `verification-report-template.md` `diff` 两两为空；(c) `npm run repo:check`（`agent-docs:shared-section:*` 全 pass；`delegation-contract:{skill-block-sync,codex-wrapper-block-sync}` 不因 SKILL 改动而红）；(d) `npx vitest run` + `npm run test:plugins` 零失败 → FR-054 / FR-055 / FR-059
- [ ] T062 验证 · D-1（F270 覆盖矩阵回放，本卡首个可执行的对抗验收）：按 T037 定稿的新规则，从 `git show 8617ae3e:specs/270-compliance-evidence-ledger/spec.md` 与 `…:plan.md` 重建覆盖矩阵；**阳性** = 点名 4 组未认领项全集（病根 iii → `FR-026`、病根 v → `FR-012`、PENDING → `FR-030..032`、snapshot-stale → `FR-033`），捕获率 4 ÷ 4 = **100%**；**阴性** = 抽 ≥ 3 条确有 Phase 认领的 FR，误报 0 ÷ 3 = **0%**；**冲突** = 回放结论与 F270「13 达成」口径矛盾须如实记录。**三者同时成立才算通过**，结论须附产生它的命令原文与原始输出（FR-062） → FR-001 / FR-003 / FR-006 / FR-062

**换算式**：本 Phase 任务 **29** 条 = `[CLEANUP]` 3（T034~T036）+ 散文与模板实现 21（T037~T052 共 16、T054~T058 共 5）+ 裁定 1（T053）+ 核对与验证 4（T059~T062），单位：任务。`[P]` 标记 3 条（T054~T056），单位：任务。本 Phase 无 `.mjs` 改动，故测试类任务 0 条。

---

## Phase C：输出纪律共享块 + 注入

> plan 中的完整标题为「Phase C — 输出纪律与共享注入面」。

**目标**：把「先落盘骨架，再逐节 Edit 填充」这条一等输出协议、以及本卡三块跨文件共享散文，全部收敛到 `plugins/spec-driver/templates/` 的**单一事实源**，经**既有通用引擎** `scripts/sync-agent-docs.mjs` 注入，零新建脚本、零新建守护代码。

**认领 FR（4 条）**：`FR-014` / `FR-018` / `FR-019` / `FR-036`
（与 plan §换算式 式 2「Phase C = 4」一致；单位：FR 条。其中 `FR-019` 为 SHOULD `[可选]`，plan §裁剪登记 C-7 已判**实现**）

**前置依赖**：Phase A（R-1 的兜底外壳必须已在位——本阶段正是把 marker 分布面从「仓根 2 个必然存在的文件」扩到「4 份 agent + 12 份 SKILL 目标」的那次改动）；Phase B（章节结构定稿后才知道协议里要写哪些「节」）。

**验证点（抄自 plan，共 4 条）**：
1. `npm run docs:sync:agents` 后 `git diff --exit-code` 零输出（幂等）；随后 `npm run repo:check` 的 3 个新 `agent-docs:shared-section:*` check 全 pass。
2. 既有 20 个注入点零回归（换算式 10 section × 2 targets = 20，单位：注入点）；仓根 `AGENTS.md` / `CLAUDE.md` 的 `wc -c` 净增量 = 0 bytes（SC-007，FR-040 的核验）。
3. `npx vitest run` + `npm run test:plugins` 零失败；`npm run build` 类型检查零错误。
4. R-1 红灯构造在本阶段（marker 面扩大后）复跑一次：删 `agents/tasks.md` 一对 marker，`repo:check` 须输出一条 `agent-docs` 族 `fail` 且其余 92 个 check 结论完整。

### 任务列表

> **本 Phase 实际认领的 plan Phase C 落点（避让后 9 行，逐个列出以便与 Phase A 对账）**：`#1`（块 1 新建）/ `#3`（块 3 新建）/ `#5`~`#8`（4 份 agent 的块 1 marker）/ `#14`~`#16`（7 份 SKILL 的块 3 marker，去重后为 3 个新增文件位）。换算式：plan Phase C 落点 **16** − Phase A 提走 **7**（`#2` 块 2 新建 + `#4` 该行整行 + `#9`~`#13` 5 份 SKILL 的块 2 marker）= **9**（单位：落点行），与 T050 上方避让说明的换算式逐字一致。**`#4` 行虽整行计在 Phase A 名下，其中 `agent-output-discipline` 与 `gate-tasks-scope-cut-acceptance` 两个 entry 仍由本 Phase 的 T069 落地**（Phase A 的 T026 只落 `orchestrator-gate-mounting-guard` 一个 entry），二者不得重复签发。
>
> **本 Phase 有 `.mjs` 落点但不适用「先写失败测试再实现」的分任务规则**：唯一的 `.mjs` 改动 `scripts/sync-agent-docs.mjs`（T069）是**向表驱动数据结构 `sectionConfigs` 追加 2 行数据**，其守护由既有 `validateSharedAgentDocs` 按 `sectionConfigs × targets` 全表比对**自动派生 check id**（裁定 C-② 代价 (乙)：新增的是 check id、不是守护代码，两个量分列）；等价的失败测试即 T073 的 `agent-docs:shared-section:*` 红→绿与 T075 的红灯构造。

- [x] T063 实现 · 块 1 骨架先落盘（本卡对 FR-014 协议的**首次自演练**）：新建 `plugins/spec-driver/templates/agent-output-discipline.md`，**本条只落章节骨架与占位行、不写正文**——6 个具名节：`## 适用场景` / `## 不适用场景` / `## 分节写作与逐节 Edit 口径` / `## 中断幸存与按段续写` / `## 委派形态分流` / `## 轻量三纪律`；其中 `## 轻量三纪律` 一节**留空占位并写明「本节内容由 Phase D 填充（FR-030 ~ FR-034）」**——plan Phase D 落点表第 1 行明写「Phase C 新建，本阶段填『轻量三纪律』一节」，该跨 Phase 承诺已由 T087 ~ T090 显式任务化（FR-008）；**散文内禁写 `mcp__` 字面量**（plan §SC-006 逐项重判 #4：`spec-driver-wrappers:codex-wrapper-runtime-namespace` 会因此由 pass 转 fail，正确处置是不写、而非事后改 `extract-wrapper-body.mjs` 的替换表）；章节标题与散文用中文、`FR` / `Phase` / `GATE_DESIGN` / `frontmatter` / `sync` / `fail-open` 等术语保持英文（FR-039 的核验语料之一）。**骨架落盘后不得在同一次调用内一次性 Write 全文**，正文由 T064 ~ T067 逐节 `Edit` 填充 → FR-014
- [x] T064 实现 · 块 1 §适用场景 / §不适用场景（含 verify 诚实口径）：逐节 `Edit` 填充——适用场景 = 4 份消费方 agent（`implement` / `specify` / `plan` / `tasks`）的长文档产出；**不适用场景须逐字写入对 `agents/verify.md` 的诚实口径**：「协议对 verify 不适用，且不得为其新增任何工具项；verify 的 `tools` 无 `Write` / `Edit` 但**持有 `Bash`**，写能力未在工具层封闭，只读性属**自律而非强制**，独立性一律登记为**未取得**」——plan Phase C 落点表第 1 行明写「缺该声明即判 FR-017 (iii) 的文本断言 FAIL」，该断言由 Phase A 的 T014 埋红、T076 消账；**`agents/verify.md` 本身不加 marker、其 frontmatter `tools` 行一个字都不得改**（FR-016 护栏，由 `agent-tools:required` 的快照断言机器执行） → FR-014
- [x] T065 实现 · 块 1 §分节写作与逐节 Edit 口径：写入「先落盘骨架、再逐节 Edit 填充」的**一等输出协议**正文——须写明骨架的最小构成（具名节标题 + 每节占位行）、每次调用只填一节或一段、**禁止一次性长 Write**，并明确本协议**是产出协议本身、不是委派时的口头叮嘱**（FR-014 原文）；同处写明协议对 4 份 agent 的生效方式 = 由 `scripts/sync-agent-docs.mjs` 注入到各自的 marker 区间内，**各 agent 不得手写副本**（撞 FR-036） → FR-014
- [x] T066 实现 · 块 1 §中断幸存与按段续写：写入 FR-018 口径——已落盘骨架与已完成节必须**完整幸存并可由下一次调用接续**；编排器按「段」重派**未完成节**；**判定「发生了整篇重写」的标志 = 已完成节的字节发生变化**（不是行数、不是内容相似度、不是语义等价）；并写明该标志的取值方式（对已完成节做**字节**比对的命令形态），供 D-5 (c) 的 ≥ 3 次独立观察直接消费 → FR-018
- [x] T067 实现 · 块 1 §委派形态分流（FR-019 · `[可选]` 项，plan §裁剪登记 §一 第 2 行判**实现**不裁剪）：写入按任务时长分流的口径——长文档生成走**分段落盘的委派形态**、短分析 / 审查走正常委派；**必须写明分流的两侧都是委派、不存在「由编排器 inline 完成」这一支**（`plugins/spec-driver/templates/delegation-contract.md:22` 明写产出阶段「禁止以任何理由 inline 替代」，`:26` 规定唯一降级通道是**实际发出了 Task 调用且失败**并留存 error 信息）；同处标注本条判实现的两条理由指针——账本 `docs/design/dogfooding-feedback-ledger.md` 的 `:81` / `:124` 两条的唯一落点在本节（换算式：2 ÷ 10 = **20%**，单位：账本条目），以及边际成本 ≈ 0 且不增实体（新增文件 0 / 注入链 0 / check id 0 / 脚本 0，四个计数单位分列、不得相加） → FR-019
- [x] T068 [P] 实现 · 块 3 新建（单一事实源，内容服务 Phase B 认领的 FR-005 / FR-060）：新建 `plugins/spec-driver/templates/gate-tasks-scope-cut-acceptance.md`，同样**先落骨架再逐节 Edit**（本卡对 FR-014 协议的第 2 次自演练）；内容 = FR-060 的 MUST 裁剪接受口径（**单列成组** / 组规模分档 `K = 3` / 同一次暂停内多选 / 展示 FR **原文** / **门未暂停 ⇒ 记「未接受」**）+ FR-005 的冻结值计算、注入与 `GATE_VERIFY` **亲自重算**的字段格式；与 Phase B 的 **T058** 在两份 `tasks-template.md` 落的**字段位**成对——**字段位在模板、格式定义在本块，二者不得互相复制**（复制即撞 FR-036）；**散文内禁写 `mcp__` 字面量**（同 T063）。**认领口径**：本条是 `FR-036`「共享内容落单一事实源」的物理落点，其内容对应的 `FR-005` / `FR-060` 认领 Phase 为 **B**（plan 矩阵取值），不列入本条认领标注；映射表填充时可把本条并列列入该两条 FR 的 `Task ID(s)` → FR-036
- [x] T069 实现 · 2 个 `sectionConfigs` entry（FR-036 复用代价 **(甲)** 的落地）：在 `scripts/sync-agent-docs.mjs` 的 `sectionConfigs`（`:6-57`，**既有 10 个 entry 一个不动**）新增 **2** 个 entry——`{ key: 'agent-output-discipline', sourcePath: resolve(rootDir, 'plugins/spec-driver/templates/agent-output-discipline.md'), targets: ['plugins/spec-driver/agents/implement.md', 'plugins/spec-driver/agents/specify.md', 'plugins/spec-driver/agents/plan.md', 'plugins/spec-driver/agents/tasks.md'] }` 与 `{ key: 'gate-tasks-scope-cut-acceptance', sourcePath: resolve(rootDir, 'plugins/spec-driver/templates/gate-tasks-scope-cut-acceptance.md'), targets: 7 份 SKILL（`spec-driver-{feature,story,implement,resume,sync,doc,refactor}/SKILL.md`）}`；写法与既有 entry 同型（`sourcePath` 走 `resolve(rootDir, …)`、`targets` 为仓内相对路径，由 `:81` 写入侧与 `:107` 校验侧的 `resolve(resolvedRoot, target)` 解析）。**第 3 个 entry `orchestrator-gate-mounting-guard` 已由 Phase A 的 T026 落地，本条不得重复签发**。**代价 (甲) 的处置口径须随行**：`sourcePath` 放 `plugins/spec-driver/templates/` 而非 `docs/shared/`（裁定 C-① 三条理由：C-1 与 Key Entities 明写、`docs/shared/` 是仓根事实源目录会误导、SC-007「仓根字节净增量 = 0」以不走仓根通道为前提）。换算式：本 Phase 新增 entry **2** + Phase A 已落 **1** = **3**（单位：`sectionConfigs` entry），与 plan Phase C 落点表第 4 行一致 → FR-036
- [x] T070 [P] 实现 · 4 份 agent 的块 1 marker：在 `plugins/spec-driver/agents/{implement,specify,plan,tasks}.md` 各加一对 `<!-- BEGIN SHARED SECTION: agent-output-discipline -->` / `<!-- END SHARED SECTION: agent-output-discipline -->` marker，并在 marker **之外**加一句「本区块由 `npm run docs:sync:agents` 从 `plugins/spec-driver/templates/agent-output-discipline.md` 注入，请勿手动编辑区块内容」（与仓根 `AGENTS.md` / `CLAUDE.md` 既有注入点同型）；`agents/verify.md` **不加 marker**（FR-016，其「不适用」已由 T064 在块 1 内声明）。换算式：4 份 agent × 1 对 marker = **4** 个注入点（单位：注入点）。**注意 plan §Project Structure 把 `agents/specify.md` 只标 `[A]`、未标 `[C]`，而 FR-014 / FR-036 的 `targets` 明列该文件——以 FR 原文与 Phase C 落点表 `#5`~`#8` 为准，本条覆盖 4 份**（该标注差异不改变 35 的文件计数，因 `specify.md` 已在册） → FR-014 / FR-036
- [x] T071 [P] 实现 · 块 3 marker（3 份 Phase B 新建小节）：在 `plugins/spec-driver/skills/spec-driver-{resume,sync,doc}/SKILL.md` 由 T054 ~ T056 建成的 `### GATE_TASKS 裁剪接受口径` 小节内，各加一对 `<!-- BEGIN/END SHARED SECTION: gate-tasks-scope-cut-acceptance -->` marker；**小节缺席时先回 T054 ~ T056 补建，不得就地新造**（K11 处置 (b) 已把三处锚点定死，本条只注 marker）；**残余登记随行**：这三个 mode 的 SKILL 内**仍然没有 `GATE_TASKS` 的完整处理流程散文**（本卡不补），新小节承载的只有裁剪接受口径这一段——凡口径为「三个 mode 的 `GATE_TASKS` 流程已补齐」即 over-claim（K11 连带口径 (iii)） → FR-036
- [x] T072 [P] 实现 · 块 3 marker（4 份已有 `GATE_TASKS` 段）：在 `plugins/spec-driver/skills/spec-driver-{feature,story,implement,refactor}/SKILL.md` 由 T057 登记的插入锚点各加一对同名 marker；锚点**以 `grep -n 'GATE_TASKS'` 现取**（K11 实测命中数 `feature` 1 / `story` 4 / `implement` 4 / `refactor` 2），**不得照抄 T057 的行号快照**。换算式：本 Phase 块 3 目标位 = 3（T071）+ 4（本条）= **7 份 SKILL**（单位：SKILL 文件），与 FR-060 的射程一致；连同 Phase A 的块 2 射程 5 份，SKILL 侧去重为 **8** 份（换算式：5 ∪ 7 = 8），即 SC-008 分母 12 的 SKILL 侧（8 SKILL + 4 agent = 12，单位：消费方文件） → FR-036
- [x] T073 验证 · 注入闭环与幂等（Phase C 验证点 1 + 2 的前半）：跑 `npm run docs:sync:agents` 后 `git diff --exit-code` **零输出**（幂等）；再跑 `npm run repo:check` 确认 **3** 个 `agent-docs:shared-section:{agent-output-discipline, orchestrator-gate-mounting-guard, gate-tasks-scope-cut-acceptance}` 全 pass（其中第 2 个由 Phase A 的 T029 首次转绿，本条复核其**未因 marker 面扩大而回归**）；并验**既有 20 个注入点零回归**——换算式：既有 10 section × 2 targets = **20**（单位：注入点），`agent-docs:shared-section:{branch-sync-policy, mainline-focus, context-layering, release-contract, repo-maintenance, behavior-rules, code-quality, orchestration-overrides, eval-credentials-policy, dogfooding-policy}` **10** 项全 pass（单位：check id）；命令原文与原始输出按 FR-062 留痕 → FR-036
- [x] T074 核对 · K16 字节预算**空载** PASS（SC-007 / FR-040 的核验语料）：在 T073 之后跑 `wc -c AGENTS.md CLAUDE.md`，与 plan §reverse-census K16 记录的基线 `AGENTS.md = 24316 bytes` 比对，断言**净增量 = 0**（换算式：交付后字节 − **24316** = **0**，单位：bytes），并确认 `worktree-local-state:agents-byte-budget` = pass。**空载 PASS 必须与结论同处写明**——本卡 3 个新 entry 的 `targets` 分别是 4 份 agent、5 份 SKILL、7 份 SKILL，**均不含仓根 `AGENTS.md`**，故该预算机制在本卡上**未受检验**，不得口径为「已验证 / 已受检」（K16 处置原文 + 推断前提 A-4 的要求） → FR-036
- [x] T075 验证 · R-1 红灯构造在扩大后的 marker 面上复跑（FR-036 复用代价 **(丙)** 的收口复验，Phase C 验证点 4）：临时删掉 `plugins/spec-driver/agents/tasks.md` 的一对 `agent-output-discipline` marker，跑 `npm run repo:check`，断言输出为**一条 `agent-docs` 族 `fail` + 其余 check 结论完整**（不是未捕获异常栈、不是 `pass`、不是空 checks 数组）；兜底外壳由 Phase A 的 **T021**（`validateSharedAgentDocsSafely`）提供，本条**只做红灯复验、不得新写守护代码**（代价 **(乙)**：新增的是 check id 不是守护代码，两个量分列、不得互相冒充）；plan 验证点 4 记的对照数为「其余 **92** 个」，**以当次实跑输出为准、不照抄该数**；复验后**必须还原 marker** 并重跑 `npm run docs:sync:agents` + `git diff --exit-code` 确认零残留 → FR-036
- [x] T076 验证 · FR-014 协议文本断言转绿（Phase A 埋的红灯消账）：跑 `npm run repo:check` 的 `agent-tools:required`，确认 T014 中「协议文本对 verify 标注**『不适用』**且该处附有 FR-016 (ii) 独立性口径声明」这一条**文本断言由红转绿**（Phase A 落地时该断言因块 1 尚不存在而**必红**，见 T014 尾句；缺声明即 FAIL）；8 条断言全 PASS（SC-003 = **8 ÷ 8** = 100%，单位：断言条），命令原文与其原始输出按 FR-062 留痕。**判据是文本存在性检查，不是执行者自读自判**（R3-β-C4：「没跑」与「跑了且全 PASS」在 prompt 层产物上同形） → FR-014
- [x] T077 登记 · D-5 (b)(c) 观察窗口开启（plan Phase E 演示清单第 4 行明写「**观察窗口自 Phase C 完成 + `repo:sync` 之后开启**，Phase E 汇总」，本条即该跨 Phase 承诺的显式任务化，FR-008）：在 `specs/277-spec-driver-engine-hardening/verification/` 下建立观察记录文件，写入**窗口开启时点**（本 Phase 交付 commit 的 sha，`git rev-parse HEAD` 现取）与三条观察纪律——(i) 委派 prompt 中**不得提及**分节协议 / 骨架 / 逐节 Edit 或任何等价要求（否则测到的只是「被明确要求时能做到」，与本 Story 的命题自相矛盾）；(ii) 须是**不同文档、不同会话**的真实长文档生成，**不得为凑数在 Phase E 集中造 3 次**；(iii) 每次观察须记录骨架与已完成节的**字节**比对结果（判据同 T066）。Phase E 汇总时的换算式：自发分节落盘次数 ÷ 独立观察次数 = **3 ÷ 3 = 100%**（单位：观察次），出现 1 次一次性长 Write 即判 D-5 未达成并**如实记录比例（如 2/3），不得四舍五入为通过**。**本条只开窗口、不汇总**——≥ 3 次独立观察的汇总归 Phase E → FR-018
- [x] T078 验证 · Phase C 收口全量跑（Phase C 验证点 3 + K14 / P-9 的第二次证实）：`npm run build`（类型检查零错误）+ `npx vitest run` + `npm run test:plugins`（零失败）+ `npm run repo:check`；并**复跑 T023 的 K14 断言**——本 Phase 落地另 2 个 `agent-docs:shared-section:*` entry 后，`tests/integration/spec-drift-repo-check-regression.test.ts` 的 `added` 长度须为 **13**（换算式：基线 8 + Phase A 已落 3 + 本 Phase 新增 2 = **13**，单位：check id），这是推断前提 **P-9** 的**第二次证实点**（Phase A 实跑得 11 属预期，**两次输出都要留痕**；13 之外的任何值须回到 T013 / T015 / T022 / T069 核对新守护项与新 entry 实际吐出的 check id 集合）。**13 是中间值不是终值**：K14 断言清单的终值为 **14**（换算式：8 + 6 = **14**，单位：check id；「新增 6」的第 6 项是 plan 裁定 **D-③** 引入的第 4 个 `agent-docs:shared-section:*` entry），该 entry 属 **Phase D** 落点（T080 裁定 D-③ → T081 ~ T085），故 **14 的终态证实点在 Phase D 收口**，本条只证到 13；T024 已把断言清单按终值 14 写死，故本条复跑在第 4 个 entry 落地前**预期为红（实际 13 ≠ 期望 14），属预期、不判回归**，须与命令原文和原始输出一并留痕；失败须按 FR-050 三条件归因（隔离重跑绿 + 与本卡改动面零交集 + 命中或新登记入预存 flaky 清单），未归因的一律计失败 → FR-014 / FR-018 / FR-019 / FR-036

**换算式**：本 Phase 任务 **16** 条 = 实现 10（T063 ~ T072）+ 验证与核对 5（T073 ~ T076、T078）+ 登记 1（T077），单位：任务。`[P]` 标记 **4** 条（T068 / T070 / T071 / T072），单位：任务。`[CLEANUP]` **0** 条——两个清理项 C1 / C2 分别是 Phase A / Phase B 的硬前置，C3 已由裁定 C-③ 判「由实现方案本身吸收，不另立清理任务」（其残余「`spec-driver-feature/SKILL.md` 注入后约 870 行 [推断]，仍是文件总 LOC 口径下的首个击穿点」由 plan 登记，本 Phase 不压缩）。

---

## Phase D：收敛循环 + 轻量三纪律 + 承诺任务化

> plan 中的完整标题为「Phase D — 收敛循环 + 轻量三纪律 + 承诺任务化」（与本节标题一致）。

**目标**：(1) 把 `GATE_DESIGN` 的「对抗 → 修订 → 再对抗」收敛循环（含白名单式门禁类分类判据与 `R_max = 3` 止损条款）落成 SKILL 散文；(2) 把引用原文化 / 数量换算式 / 推断前提登记三项轻量纪律写进 Phase C 建成的共享块；(3) 落成候选池式的延期承诺任务化与其入池证据三项。

**认领 FR（14 条）**：`FR-008` ~ `FR-009`（2）+ `FR-020` ~ `FR-023`（4）+ `FR-030` ~ `FR-034`（5）+ `FR-064` ~ `FR-066`（3）
换算式：2 + 4 + 5 + 3 = **14**（与 plan §换算式 式 2「Phase D = 14」一致；单位：FR 条）

**前置依赖**：Phase C（三纪律一节写进块 1，块 1 的文件必须已存在且已接入 `sectionConfigs`；FR-066 的同一命题判据写进 Phase B 建成的「推断前提登记」章节）。

⚠️ **待办（plan 对齐阶段登记、未消账，须在本 Phase 转成显式任务）**：**本 Phase 落点表原标题「共 12 个」按表格行数计，去重文件数曾为 10；经裁定 D-③/D-④/D-⑤ 后终值为「13 个文件 / 15 个改动位」（plan §修订记录第 3 行），T079 仅核对不重裁**。重叠两处：`spec-driver-fix/SKILL.md` 同时出现在行 4-7（`GATE_DESIGN` 段）、行 8（`:382-384` 豁免例外）与行 9-12（FR-065 条件格），同一文件被计 3 次。去重清单（10 个）= `templates/agent-output-discipline.md` / `agents/tasks.md` / `agents/verify.md` / `skills/spec-driver-{feature,story,implement,fix}/SKILL.md`（4）/ `skills/spec-driver-{doc,refactor,sync}/SKILL.md`（3）。**须产出一条显式任务统一计数单位**：落点表标题改为「共 10 个文件 / 12 个改动位」（两个单位分列、不得相加），并在本卡的体量口径处按 10 复核 plan §Project Structure 的「直接修改文件数 35」是否受影响。

**验证点（抄自 plan，共 4 条）**：
1. **D-3（`GATE_DESIGN` 收敛轨迹回放 + 首轮零 CRITICAL 反例）**：语料一 = F270 spec 阶段三轮，语料二 = 本卡自身 R1 → R2 → R3；期望两份均逐轮判「不放行」、末轮达 `R_max = 3` 后转守承重项而非放行；反例 = 一次纯文档类门禁改动首轮即零 CRITICAL ⇒ 直接放行、不强制追加轮次。计数单位须区分「轮」与「路」。
2. **D-2 的承诺任务化子项**（本卡内 D-2 的唯一验收对象；可达性子项随 F27x 移交）：取 F270 `plan.md` 全文入候选池，逐条判定并留痕，输出候选池全表 + 入池步的证据三项；结论处按裁定 D-① 写入强度上限声明。
3. `npx vitest run` + `npm run test:plugins` 零失败；`npm run repo:check` 零失败。
4. mode 分层矩阵第 6 / 7 / 8 行「全强制」的文本核对：块 1 的适用范围声明须与矩阵逐格一致（8 列全「强制」），不一致即判 FR-034 未达成。

### 任务列表

> **本 Phase 全部为 `.md` 散文改动，无 `.mjs` 落点**，故不适用「先写失败测试再实现」的分任务规则（该规则的射程是 `.mjs`）；其等价物是每条任务自带的文本核对命令（`grep` / `sed`）与 Phase D 验证点 1 ~ 4。
>
> **两条裁定任务先行（T079 / T080），不得静默择一**：T079 消 ⚠️ 待办的计数单位，T080 定 `GATE_DESIGN` 收敛循环散文的落点形态——**T080 的结论决定 T081 ~ T085 的动作形态**（4 份手写 vs 第 4 个共享块 + entry），故它必须早于任何 SKILL 改动。
>
> **同文件任务串行、跨文件组间可并行**：块 1（T087 ~ T090）/ `agents/verify.md`（T091 ~ T092）/ `agents/tasks.md`（T093 ~ T096）/ 4 份 `GATE_DESIGN` SKILL（T081 ~ T085）四组的文件集互不相交，组**内**任务改同一文件必须串行，组**间**可并行；T097 因触及 `spec-driver-fix/SKILL.md` 与第四组重叠，须排在 T085 之后。

- [ ] T079 裁定 · ⚠️ 待办消账（落点表的计数单位分列）——**裁定已由 plan §修订记录第 3 行（裁定 D-⑤）落地，本条实施时仅核对、不重新裁定**：plan Phase D 落点表标题早前写「共 12 个」是**按表格行数**计，与去重后的**文件数**混用同一个词；差额全部来自 `skills/spec-driver-fix/SKILL.md` **被计 3 次**（块 4 marker 1 + `:382-384` 豁免例外 1 + FR-065 条件格 1），核对式 `M − N = 2 = 3 − 1`。**终值 = 13 个文件 / 15 个改动位**（**两个单位分列、不得相加**），已写入 plan `:1561` 的落点表标题与其下两条独立换算式：文件式 `1 + 1 + 1 + 1 + 1 + 4 + 3 + 1 = 13`（单位：文件，其中新建 1）；改动位式 `12（基线行数）+ 1（裁定 D-④ 的 agents/plan.md）+ 1（裁定 D-③ 的 ★新建 template）+ 1（裁定 D-③ 的 sync-agent-docs.mjs 第 4 entry）= 15`（单位：改动位）。**与编排器裁定文本所记「11 个文件 / 13 个改动位」的差额须原样呈现、不得静默采信**：11 / 13 是**仅按裁定 D-④ 在基线 10 / 12 上 +1 得到的中间值**，未计入同批裁定 D-③ 引入的两个落点，对账式 = 文件 `11 + 1 + 1 = 13` / 改动位 `13 + 1 + 1 = 15`。**本条的动作只有三个核对，产出为核对结论而非新裁定**：(1) plan 落点表标题、其下双换算式、§修订记录第 3 行三处的 13 / 15 **逐字一致**；(2) plan §Project Structure 的「直接修改文件数 **36**」（裁定 D-③ 后由 35 重算）与本 Phase 的 **13** 是**两个作用域**（全卡按目录枚举 vs 本 Phase 内），须写明关系而非直接比较；(3) 裁定 D-④ 已在 §FR → Phase 覆盖矩阵 `FR-065` 行、Phase D 落点表与 §Project Structure 三处同步（`agents/plan.md` 现为 FR-065 落点，标记须含 `[D]`）。任一处不一致即回到 plan §修订记录对应行更正，**不得在本文件单方面另立新值** → FR-031
- [ ] T080 裁定 · `GATE_DESIGN` 收敛循环散文的落点形态（plan 该定而未定，**不得静默择一**）：plan Phase D 落点表行 4-7 把收敛循环写成**直接改 4 份 SKILL 的 `GATE_DESIGN` 段**（该表明写「共 12 个 · 其中**新建 0**」），而 `FR-036` 明写「禁止各 SKILL / agent 手写副本，**任何要求把同一段话抄进 5 个 SKILL 的实现方案应在 plan 阶段被否决**」——4 份 SKILL 若各写一份同样的收敛循环判据，即为 4 份手写副本，与 Phase C 刚落成的单一事实源纪律正面冲突。**本条须在动手前二选一并留痕**：**(甲) 走 plan 字面口径**，4 份各自手写，须逐份说明四段文本的 **mode 特异部分**与**共享部分**各是什么，并把「共享部分的手写副本数 = 4」如实登记为 FR-036 的残余，同时**重算 SC-008**（手写副本数 0 ÷ 12 = 0% 将不再成立），按 FR-061 判是否构成放宽下界；**(乙) 新建第 4 块共享块 + 第 4 个 `sectionConfigs` entry**（`targets` = 4 份 SKILL），此时**连带重算四个量**（四个计数单位分列、不得相加）：SC-006 分母 26 → **27**（单位：check id）、`repo:check` check id 总数 93 → **94**（同单位）、plan §Project Structure 直接修改文件数 35 → **36**（单位：文件）、SC-008 分母 12 是否变（单位：消费方文件）。裁定结论与其换算式落进 plan §修订记录；**在本条完成前不得开工 T081 ~ T085** → FR-020
- [ ] T081 [P] 实现 · 门禁类白名单分类判据（按 T080 裁定的形态落地）：在 `plugins/spec-driver/skills/spec-driver-{feature,story,implement,fix}/SKILL.md` 的 `GATE_DESIGN` 段写入 FR-020 的**白名单式路径判据**——命中面枚举 `plugins/spec-driver/scripts/**` / `plugins/spec-driver/hooks/**` / `plugins/spec-driver/contracts/**` / `.specify/orchestration-overrides.yaml` / 以及任何「失效即静默放行」的判定器 / 守护 / 安全检查代码，**命中其一即判门禁类**；**判据取不到、或落在白名单边界上判不出时一律按门禁类处理**（判不出 ⇒ 从严，与 FR-065 (iii) 同向）；**分类结论与其依据**（命中了哪一条 / 为何全部未命中）**必须留痕，无留痕的「非门禁类」结论视为未做分类**。锚点以 `grep -n 'GATE_DESIGN'` **现取**（K11 实测命中数 `feature` 2 / `story` 8 / `implement` 1 / `fix` 6，单位：命中行），**不得照抄该快照** → FR-020
- [ ] T082 实现 · 收敛判据与「新增」对照口径：同 4 份 SKILL 的 `GATE_DESIGN` 段写入 FR-021 本体——收敛判据 = 「本轮对抗在**上一轮的修订产物**上没有发现新增 CRITICAL」，**禁止**实现为「累计对抗满 N 轮」的固定轮数；**首轮即零 CRITICAL 时不得强制追加轮次**；「新增」的判定口径 = 每轮**逐条**给出本轮条目与上一轮条目的对照（每条指向「对应上一轮第 N 条」或明确标「无对应」），**判不出对应关系的条目一律按「新增」计**（否则把上一轮的问题重述一遍即可被排除出「新增」，伪造出提前收敛）；并写明**全部轮次必须在单次 `GATE_DESIGN` 暂停之前闭环**——`feature` 下该门是无条件 `AskUserQuestion` 暂停，每轮各停一次即 N 轮 = N 次用户暂停，与 FR-049「不加重 GATE 交互负担」**直接互斥**；暂停时一并展示各轮轮次记录（FR-023） → FR-021
- [ ] T083 实现 · `R_max = 3` 止损条款（**MUST**，已由 spec §修订记录 第 4 行升格，不再是 plan 的自主处置）：同 4 份 SKILL 写入——达上限仍有新 CRITICAL 时**不放行也不无限循环**，转入「**守承重项**」模式：末轮只对**承重项清单**判零新增，清单外的 CRITICAL 全部登记为**残余风险**并进入 plan 裁剪登记或带编号的移交卡，**不得静默放行**；**承重项清单必须在进入该模式之前写入轮次记录**——时点晚于该轮结果者视为**事后圈定**，该次止损**无效**、判不放行（裁定 D-②）；**「放行」与「止损」是两种不同终态，输出中必须可区分**，不得把止损模式的输出写成放行；`R_max` 取 spec 建议值 **3**，**不加严不放宽**。同处写明升格的连带口径：本条款**不再适用** FR-046「可选项默认不实现」，日后要裁必须走 FR-060 的 MUST 裁剪准入闸门（本卡不裁，该闸门在本卡内空载） → FR-021
- [ ] T084 实现 · 每轮输入指针（FR-022）与轮次记录必备字段集（FR-023）：同 4 份 SKILL 写入——(a) **每一轮对抗的输入必须是上一轮修订后的产物**而非原始产物，不得以「首轮问题已修复」为由在本轮尚未执行时提前收口，须落**版本指针字段**（指向该轮输入产物的具体版本）；(b) 轮次记录字段集共 **4** 项（换算式：实际执行的对抗轮次数 1 + 每轮新增 CRITICAL 计数 1 + 承重项清单及其**预先声明时点** 1 + 是否进入止损模式 1 = **4**，单位：必备字段），其中「是否进入止损模式」为布尔取值，**进入时须同时列出被登记为残余风险的 CRITICAL 条目及其去处**（plan 裁剪登记 / 带编号移交卡），该条目集**不得为空集、不得只写「无」而无产生该结论的依据**。**FR-024（每轮 CRITICAL 条目摘要）已由 plan §裁剪登记 第 1 条判裁剪，本条不写该字段**——其残余（跨 Feature 收敛成本统计在本卡后仍无数据源）已在 plan 登记，此处不重复实现、也不重复登记 → FR-022 / FR-023
- [ ] T085 实现 · `fix` 默认豁免的例外条款（FR-025 点名缺口，本卡**显式认领「收紧」而非移交**）：在 `plugins/spec-driver/skills/spec-driver-fix/SKILL.md` 既有「仅当 `gates.GATE_DESIGN.pause` 为 `always` 才暂停，否则自动继续（fix 模式默认豁免）」处（plan 记录的行号快照为 `:382-384`，**须 `grep -n` 现取**）加一条例外——「本次改动按 FR-020 的白名单式路径判据被判为**门禁 / 判定器 / 安全类**时，该默认豁免**不适用**，须执行收敛循环」；**不得补挂新门**（FR-049 红线；mode 分层矩阵第 1 行 `fix` 列已明写「确需在 `fix` 下裁剪 MUST 项的须改走带编号移交卡，**不得补挂新门**」）。验收 = 该例外条款的文本存在性核对（plan 矩阵 FR-020 行的验证点） → FR-020
- [ ] T086 登记 · 收敛循环射程之外的 4 个 mode 逐条留痕（plan 落点表只列 4 份 SKILL，本条把「为何不是 8 份」写成显式结论而非沉默）：**(i) `refactor` / `resume` = 门本身未挂载**（mode 分层矩阵第 3 行的第 (i) 类「不适用」）——`GATE_DESIGN.applicable_modes` 实测**不含** `refactor`（复核命令 `sed -n '39,55p' plugins/spec-driver/config/orchestration.yaml`，原始输出 7 项：`feature / story / implement / fix / resume / sync / doc`），`resume` 的 phase 序列实测只挂 `GATE_TASKS` / `GATE_VERIFY`；二者均属既有编排事实、本卡不改，**登记即消账**。**(ii) `sync` / `doc` = 门有挂载但落点缺席，须显式裁定**——两者在 `applicable_modes` 内、矩阵第 3 行为「条件」格（`doc` 列明写「不因 mode 名而预设为非门禁类，仍按 FR-020 白名单逐次判定，判不出按门禁类处理」），而 plan Phase D 落点表**未给这两份 SKILL 任何 `GATE_DESIGN` 落点**；**FR-065 (ii) 的升格只覆盖矩阵第 1 项与第 4 项、不覆盖第 3 项**，故此处是真缺口：须裁定「补落点」或「说明该条件格由何处承载」并落进 plan §修订记录，**不得静默按已覆盖处理**。命令原文与原始输出按 FR-062 留痕 → FR-020
- [ ] T087 [P] 实现 · 块 1 §轻量三纪律 · 引用原文化（FR-030）：在 Phase C 的 T063 建成的 `plugins/spec-driver/templates/agent-output-discipline.md` 「轻量三纪律」占位节内逐节 `Edit` 填充——verified-facts 类文档（fix-report / verification-report / 设计文档中引用历史结论的段落）引用历史内容时须附 `git show <sha>:<path>` 取得的**原文片段**，禁止只写结论转述；**两种合规形式等效**：**(a)** 引用处直接内联该 `git show` 的原文代码块；**(b)** 引用处写明 `git show <sha>:<path>` 指针 + 指向**同 feature 目录下** `evidence/*.md` 的具名条目（含逐字原文片段与核对结论），形式 (b) 的指针**可由一张文档级具名索引表统一给**，正文只在该史实的**首次引用处**留 `§H-n` 指针；同处写入**全量口径的机械结构检查**要求（被检文档中每一条被引史实必须命中 (a) 或 (b) 之一，**不得只做抽样**——FR-001 对覆盖矩阵明写不允许抽样，对本条只抽样即为双标）与**两种形式计数单位不同、不得相加**的口径（形式 (a) 按**段落**计、形式 (b) 按**史实**计；换算式 0 ÷ N_a = 0%（单位：段落）与 0 ÷ N_b = 0%（单位：史实条），**N_a / N_b 验收时全量扫描现取、不写死**）；并写明能力边界——该结构检查只验「原文片段**在场**」，不验其内容是否与转述相符，内容正确性靠 D-6 的抽样人工核对，**二者互补而非替代** → FR-030
- [ ] T088 实现 · 块 1 §轻量三纪律 · 数量换算式与计数单位（FR-031）：同一节内续写——spec / tasks 中的可观测数量必须**同处**写出换算式与计数单位，**仅给结果数字判为不合格**；**「计数集合口径」必须一并写出**（plan Phase D 落点表第 1 行点名的第三项，D-7 的第三步「集合核对」消费它——本 spec 早前版本正是「在场且算对但**集合错**」）；全量结构检查口径 = 「只有结果数字、同段既无换算式也无计数单位」的条目数 ÷ 可观测数量总数 = **0 ÷ N = 0%**（单位：数量条，**N 验收时现取**）；能力边界 = 只验「换算式与单位**在场**」，不验算式本身是否算对，算术正确性靠 D-7 的人工复算，二者互补而非替代 → FR-031
- [ ] T089 实现 · 块 1 §轻量三纪律 · 推断前提标记契约（FR-032）：同一节内续写——`[推断]` / `[INFERRED]` 标记**复用仓库宪法既定标记，禁止另造标记体系**（C-8）；每条附推断理由；**「已核实」不是自助豁免桶**——进桶必须附**命令与其原始输出片段**（不是命令名、不是结论转述），仅凭静态论证 / 设计推理 / 「按设计应当如此」者**一律退回 `[推断]` 并计入 SC-009 分母**（标为「已核实」即被排除出分母，等于让被测方自行选定分母）。并**核对 Phase B 的 T037** 在两份 `plan-template.md` 落的「推断前提登记」章节结构与本节口径**逐条一致**（T037 已声明该节结构虽在 Phase B 落地、但 `FR-032` 的认领 Phase 为 **D**，其模板结构可并列列入本 FR 的 `Task ID(s)`），不一致时**以本节为准回改模板** → FR-032
- [ ] T090 实现 · 块 1 §轻量三纪律 · 适用范围声明（FR-034，全 mode 不降级）：同一节末写入适用范围声明——FR-030 ~ FR-033 三项纪律在**全部 mode**（含 `fix` / `doc` / `refactor` / `sync`）下强制生效，**不随 mode 降级**；声明须与 spec §mode 分层矩阵第 6 / 7 / 8 行**逐格一致**，换算式：3 行 × 8 个 mode 列（`feature` / `story` / `implement` / `fix` / `doc` / `refactor` / `sync` / `resume`）= **24 格全「强制」**（单位：矩阵格）。**本节是块 1 中唯一被注入 4 份 agent 的 FR-034 落点**——`fix` / `doc` / `refactor` / `sync` 四份 SKILL 内**不另加一句 FR-034 声明**（plan 落点表行 9-12 归 FR-065、不归 FR-034），凡以「SKILL 里没写」为由判 FR-034 未落地即为误判 → FR-034
- [ ] T091 [P] 实现 · `agents/verify.md` 的推断前提逐条实跑口径（FR-033）：在 `plugins/spec-driver/agents/verify.md` 写入——每条登记的推断前提，verify 必须至少给出一条**运行时口径**的验证命令并输出其实跑结论（PASS / FAIL）；**不接受「按设计应当如此」这类静态论证作为实证**；**实跑只能得到「无法判定」的条目视为该条未通过**；记录标准与 FR-032 的「已核实」桶一致——须附**命令与其原始输出片段**，只写 PASS / FAIL 结论而无输出片段者按「无法判定」计。**本条与 Phase B 的 T044（FR-044 降级留痕）同文件，须在其之后落笔并复核两处口径不打架**（脚本口径不可达 ⇒ 首选降级到 prompt 口径并留痕；两口径皆不可得才判「未执行（缺席）」，宪法原则 X） → FR-033
- [ ] T092 实现 · `agents/verify.md` 的同一命题判据（FR-066）：同文件续写——推断前提登记的每一条，其**证实 / 证伪命令必须与该条陈述是同一命题**（命令的 PASS / FAIL 直接对应该陈述的真 / 假），**不得用一条相邻但不同的命题的实跑结果为该陈述背书**；**不可证伪的条目必须归入「能力边界声明」而非推断前提，且不计入 SC-009 分母**（把恒真命题计入实证率会虚高该比率）；条目中仍可测的经验命题部分须**单独拆出**登记并配与其陈述同一命题的命令；命令与陈述不同一而又无法拆分者，按 FR-033 的「无法判定」计未通过。同处写入 **D-8 的三处分母核对口径**：V-1 ~ V-3 未混入分母、B-1 / B-2 两条能力边界声明**均未**计入分母、A-3 的命令与陈述同一命题 → FR-066
- [ ] T093 [P] 实现 · `agents/tasks.md` 候选池式触发面（FR-008）：在 `plugins/spec-driver/agents/tasks.md` 写入——延期承诺的触发面**禁止实现为措辞白名单**（依据是本仓自 F259 提炼的反模式「判据写成值枚举 ⇒ 每加一个值漏一次」，而此处更严重的是**判据的写作者与被约束者是同一人**，换一种说法即恒假、规避成本为零），触发面**翻转为候选池式**、默认由「不匹配即无」改为「**疑似即入池**」：**凡提及未来 Phase 编号、或带未来时态承诺语义的段落一律进入候选池**；池中每一条须显式判定「已任务化」或「非承诺（附排除理由）」并**逐条留痕**，**无留痕的排除视为未处置、与漏做同等判不合格**；转化出的任务须**归属该 Phase、可独立勾选，并能追溯回原承诺的出处位置** → FR-008
- [ ] T094 实现 · `agents/tasks.md` 入池步的证据三项（FR-008 的 R2 A-3 收口）：同文件续写三项一并要求——**(i)** 扫描的**命令原文**（可原样复跑）、**(ii)** 该命令的**原始输出**（或该输出的计数）、**(iii)** **池内条数**；三者须**相互核对**（池内条数应与命令输出计数一致，不一致须附强制说明）；**「候选池为空」这一结论同样须附产生它的命令与其原始输出**——无命令与原始输出的空池**不构成通过**，按 FR-005 计「未执行（缺席）」。同处**如实登记残余缺口**：入池触发面本身仍是措辞驱动的、形态覆盖率未测量；**本次留痕平移只收「入池步无痕」这一面、不收「同人自证」这一面**（写 plan 的人仍是执行扫描的人，命令与输出同样可被选择性构造），任何把本项口径为「延期承诺已不可能逃逸」的表述即为 over-claim → FR-008
- [ ] T095 实现 · `agents/tasks.md` 未任务化承诺的阻断口径（FR-009）：同文件续写——**存在未被任务化的延期承诺时，tasks 阶段不得被判定为完成**，「散文承诺停留在 plan 里」不构成已交付；并写明该口径在 `GATE_TASKS` 的落地位置，与 Phase B 的 T051 改写后的不变量「每条**未被裁剪登记的实现型** FR 至少有一个对应任务」**并列**——两条各判各的量（前者判承诺是否落任务、后者判 FR 是否落任务），**不得互相顶替**，任一不成立即判 tasks 阶段未完成 → FR-009
- [ ] T096 实现 · FR-064 强度上限声明的两处落点（裁定 D-① 已择 **(b)**，本条只落地不重判）：在 `plugins/spec-driver/agents/tasks.md` 的候选池段落**与** T099 的 D-2 演示结论处**两处**原样写入固定口径——「**本演示只证明该检查在 F270 语料上非恒空，不构成对承诺检出率的任何声明**」；并写入**禁止条款**：不得在任何制品中把 `FR-008` 口径为「延期承诺已被覆盖」。**不补漏报率测量**（选 (a) 需在历史语料上人工穷举延期承诺全集作分母，而穷举者与判据写作者是同一人，得到的漏报率不构成独立测量、只会给一个假的精确数）。本条与 spec 背景章节诚实性声明第 1 条**互补且分列**：那条登记**入池触发面**的形态覆盖率未测量，本条登记**验收强度的下界**——现状验收只要求「候选池中确属延期承诺而 `tasks.md` 无对应归属任务的条数 > 0」，即最小命中数 = **1 条**（单位：延期承诺条），一条命中即算通过，无法区分「捕获了全集」与「碰巧捕获了 1 条」 → FR-064
- [ ] T097 实现 · FR-065 条件格三项约束（4 份 SKILL）：在 `plugins/spec-driver/skills/spec-driver-{fix,doc,refactor,sync}/SKILL.md` 各写入——**(i)** 声明「无 FR 列表 / 无关键量 / 无代码改动」时须**同处附得出该结论的命令与其原始输出**（留痕标准同 FR-062），**仅有声明而无依据的关闭视为未做判定**；**(ii)** 本次改动按 FR-020 白名单式路径判据被判为**门禁 / 判定器 / 安全类**时，mode 分层矩阵**第 1 项（覆盖矩阵与裁剪登记）与第 4 项（reverse-census）在全部 mode 下升格为强制**，不接受内容触发式关闭——即触发条件与「本次是否属门禁 / 判定器 / 安全类改动」**解耦**，门禁类改动**不因 mode 名或执行者自述而降级**；**(iii)** 触发条件**判不出时按成立处理**（按「该项被要求」处理），与 FR-020 的「判不出 ⇒ 从严」同向。**射程存疑随 T079 的裁定结论**：plan 矩阵 FR-065 行另列 `agents/plan.md`，而落点表与 §Project Structure 均无该文件，按 T079 结论决定是否连带改写；**本条须排在 T085 之后**（同触 `spec-driver-fix/SKILL.md`） → FR-065
- [ ] T098 验证 · D-3（`GATE_DESIGN` 收敛轨迹回放 + 首轮零 CRITICAL 反例，Phase D 验证点 1）：按 T081 ~ T085 定稿的判据回放两份语料——**语料一** = F270 spec 阶段三轮（3 **路**并行对抗 → delta 复审 → delta-2 微型对抗），**语料二** = 本卡自身 R1 → R2 → R3；期望两份**均逐轮判「不放行」**、末轮达 `R_max = 3` 后**转守承重项而非放行**（史实已按 `evidence/historical-citations.md` §H-3 更正，旧剧本「第三轮零新增 ⇒ 放行」**已作废**）；**反例** = 一次纯文档类门禁改动首轮即零 CRITICAL ⇒ **直接放行、不强制追加轮次**；**计数单位须区分「轮」与「路」**（F270 第一轮是 3 **路**并行审查、不是 3 **轮**）；本卡 R1 → R2 的换算式须原样保留且**禁止相减**——R1 = 事实错误 2 + 判据绕过 5 + 冲突死锁 9 + fail-open 4 = **20**（单位：CRITICAL 条），R2 = 全新面 11（自一致性 7 + 可实施性 4）+ 直接推翻 R1「已堵死」判定 2 + 从 R1 承接且攻击构造仍成立 3 = **16**（同单位），**两个数各自独立、20 → 16 不是「修掉了 4 条」**；结论须附产生它的命令原文与其原始输出（FR-062）。**性质须诚实登记**：本演示是**人工按新判据逐条推演**、不是机械执行，推演者已知期望结论，无法排除向结论倒推 → FR-020 / FR-021 / FR-022 / FR-023
- [ ] T099 验证 · D-2 承诺任务化子项（Phase D 验证点 2；本卡内 D-2 的**唯一**验收对象，可达性子项随 F27x 移交）：取 F270 的 `plan.md` 全文入候选池（取数走 `git show 8617ae3e:specs/270-compliance-evidence-ledger/plan.md`），按 T093 ~ T095 的判据逐条判定并留痕，输出**候选池全表** + **入池步的证据三项**（扫描命令原文 / 其原始输出或计数 / 池内条数，三者相互核对）；结论处**原样写入** T096 的强度上限声明。**其期望输出未经 F270 原文核对**（§H-2 覆盖的恰是被移交的可达性半边），故本演示**不计入「已核对的外部对照」**——本卡内已核对的外部对照 = D-1 + D-3 共 **2** 条（换算式 2 ÷ 8 = **25.0%**，单位：演示条；上界仍为 3 ÷ 8 = **37.5%**，两个量**不得互相冒充**） → FR-008 / FR-009 / FR-064
- [ ] T100 核对 · FR-034 的 mode 分层矩阵逐格核对（Phase D 验证点 4）：把 T090 写入的适用范围声明与 spec §mode 分层矩阵**第 6 / 7 / 8 行逐格**比对，行号以 `grep -n '引用原文化\|数量换算式与计数单位\|推断前提登记与运行时实证' specs/277-spec-driver-engine-hardening/spec.md` **现取**后 `sed -n '<行号>p'` 取原文；断言 **24 格全「强制」**（换算式：3 行 × 8 个 mode 列 = **24**，单位：矩阵格），**任一格不一致即判 FR-034 未达成**（不得以「大部分一致」通过）；命令原文与其原始输出按 FR-062 留痕 → FR-034
- [ ] T101 验证 · Phase D 收口全量跑（Phase D 验证点 3）：`npx vitest run` + `npm run test:plugins` 零失败；`npm run build` 类型检查零错误；`npm run repo:check` ——**本 Phase 改的 4（`GATE_DESIGN` 段）+ 4（FR-065 条件格）份 SKILL 会打到 `delegation-contract:{skill-block-sync,codex-wrapper-block-sync}` 与 `codex-plugin-consistency:*` 的回归面**；其中 `spec-driver-wrappers:{codex-wrapper-markers, codex-plugin-distribution-markers}` 在 `npm run repo:sync` 再生**之前必 `fail`**（文案指向「source 已变更但 wrapper 未重生成」），按 plan §SC-006 重判连带口径 (i) **不得误判为回归**——其转绿的前置是 Phase E 的再生链（FR-048）；`spec-driver-wrappers:codex-wrapper-runtime-namespace` 须为 pass，转 fail 即说明本 Phase 写入的散文含 `mcp__` 字面量（连带口径 (ii)），须回改散文而非改 `extract-wrapper-body.mjs`。失败须按 FR-050 三条件归因（隔离重跑绿 + 与本卡改动面零交集 + 命中或新登记入预存 flaky 清单），未归因的一律计失败 → FR-020 / FR-030 / FR-065

**换算式**：本 Phase 任务 **23** 条 = 裁定 2（T079 / T080）+ 实现 16（`GATE_DESIGN` 段 5：T081 ~ T085；块 1 三纪律 4：T087 ~ T090；`agents/verify.md` 2：T091 ~ T092；`agents/tasks.md` 4：T093 ~ T096；FR-065 条件格 1：T097）+ 登记 1（T086）+ 验证与核对 4（T098 ~ T101），单位：任务。`[P]` 标记 **4** 条（T081 / T087 / T091 / T093，四组文件集互不相交的组首任务），单位：任务。本 Phase 无 `.mjs` 改动，故测试类任务 **0** 条；`[CLEANUP]` **0** 条。

---

## Phase E：回归护栏 + 再生 + 验收演示

> plan 中的完整标题为「Phase E — 回归护栏 + 再生 + 验收演示」（与本节标题一致）。

**目标**：跑通再生链与五条回归护栏，按固定顺序执行 D-1 ~ D-8 全量演示，并按 Edge Case 18 的「追加而非改写」处置回跑发现的违规。

**认领 FR（1 条）**：`FR-048`
（与 plan §换算式 式 2「Phase E = 1」一致；单位：FR 条）

**前置依赖**：Phase A ~ D 全部完成。本 Phase 不新增落点文件，产出为 `specs/277-spec-driver-engine-hardening/verification/` 下的验收制品 + wrapper 机器再生产物。

⚠️ **待办（plan 对齐阶段登记、未消账，须在本 Phase 转成显式任务）**：**再生产物计数不同源，实数应为 16 而非 8 或 10**。三处口径：spec 写「再生 8」、plan 早前版本写 10、plan Phase E 落点段写「`.codex/skills/**` 5 份 + `plugins/spec-driver/skills-codex/**` 5 份 = 10」。而 `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` 有 **9 个 entry**、两个分发目录各持 9 份副本。本卡**实际改动 8 份 SKILL 源**（`spec-driver-{feature,story,implement,fix,resume,sync,doc,refactor}`，换算式：FR-068 射程 5 ∪ FR-060 射程 7 = 8，plan §SC-006 重判段已按 8 计），故受影响的再生产物 = **8 × 2 = 16 份**（`.codex/skills/**` 8 + `skills-codex/**` 8），单位：wrapper 文件。**须产出一条显式任务**（= 下方 **T102**）：以合同 entry 与实际改动的 SKILL 集为准**现取**并统一三处口径，且验证点 6 的 `git status` 核对清单须由「5 + 5」改为按实测的受影响集合逐份列出；**不得沿用 8 / 10 任一旧值**。**与 T080 裁定的连带关系（不得硬编码）**：T080 已裁定 `GATE_DESIGN` 收敛循环走**共享块**路线（第 4 个 `sectionConfigs` entry），其 `targets` 是 4 份 SKILL（`feature` / `story` / `implement` / `fix`），**四者已在上述 8 份之内**，故按当前裁定受影响集仍为 **8**；但 sync / doc 两份的收敛循环 marker 是否落地由 plan §修订记录 的裁定为准（口径为「SKILL 有 `GATE_DESIGN` 段则加 marker，无则登记不适用」），**本 Phase 的任务一律不硬编码该结论**。**受影响集的上界 = 合同全集 9**（`wrapper-source-of-truth.yaml` 的 9 个 entry，唯一可能不受影响的是 `spec-driver-constitution`），故再生产物数 ∈ [16, 18] 份（换算式：受影响 SKILL 数 × 2 个分发目录；下界 8 × 2 = 16、上界 9 × 2 = 18，单位：wrapper 文件）——**T102 必须现取该集合，不得从本段的任何数字倒推**。

**验证点（抄自 plan，共 8 条）**：
1. `npx vitest run` 零失败或已按 FR-050 三条件归因为满载假红（隔离重跑绿 + 与本卡改动面零交集 + 命中或新登记入预存 flaky 清单），归因记录须附两次跑批各自的命令行与输出片段；未完成归因的失败一律计失败。
2. `npm run test:plugins` 同上。
3. `npm run build` 类型检查零错误。
4. `npm run repo:check` 零失败；check id 总数 = 88 + 6 = **94**（须与实跑输出核对）；与本卡直接相关的 **27** 项全 pass。**本条的两个数已按 T080 裁定（收敛循环走共享块 = 第 4 个 `sectionConfigs` entry）由 plan 旧值上修**：新增 check id 由 5 增为 **6**（换算式：`agent-docs:shared-section:*` 由 3 增为 **4** + `agent-tools:required` 1 + `gate-mounting:effective-config` 1 = 6，单位：check id），故总数 88 + 6 = **94**、SC-006 分母由 26 增为 **27**（换算式：既有相关 21 + 新增 6 = 27，同单位）；**plan 侧的 93 / 26 是裁定前的旧值，以本条为准**（plan §修订记录 的回写由 T080 与编排器落账）。**顺序约束**：`spec-driver-wrappers:{codex-wrapper-markers, codex-plugin-distribution-markers, codex-wrapper-runtime-namespace}` 3 项必须排在验证点 6 的再生链**之后**。
5. `npm run release:check` 零失败。
6. **再生链**：`npm run repo:sync` 后 `git status` 中受影响的 wrapper 均为机器再生、无手改残留（份数以上方 ⚠️ 待办重算结果为准）；`delegation-contract:codex-wrapper-block-sync` 与 `codex-plugin-consistency:*` 全 pass。
7. **FR-051 的 disjoint 判定**：先证明 oracle 取得成功（`git diff --name-only $(git merge-base master claude/f276-compliance-handoff-fixes-9a9fe1)..claude/f276-compliance-handoff-fixes-9a9fe1` 退出码 0 且 ref 可解析），再判 `|A ∩ B| = 0`；取不到即判「未执行（缺席）」，不得记 PASS。已知接触点 3 个。与 FR-048 冲突时 **FR-051 优先**。
8. **13 条约束型 FR 的三取值逐条在场**：verify 报告中每条约束型 FR 必须出现「已核验未违反（附核验方式）/ 已违反 / 未核验」之一，缺一即计「未核验」并按 FR-059 归入不通过侧。

### 任务列表

> **本 Phase 的尾标认领集只有 `FR-048` 一条**（plan §换算式 式 2「Phase E = 1」）。四条护栏型约束 `FR-049` / `FR-050` / `FR-051` 与 `FR-016` 等其余 12 条**均为约束型 FR，按 FR-005 贯穿口径 (4) 不生成任务、不进尾标**；它们的核验义务写在各任务描述内，核验结论落 §约束型 FR 核验点。本 Phase 除 T104 外的任务尾标一律指向 **Phase E 验证点编号**或**演示编号**，不指向 FR——这不是漏标，是防止「造一条『核验没做某事』的任务」使 `tasks.md` 与矩阵对同一条 FR 给出相反账面（FR-056 已明确否掉该写法）。
>
> **本 Phase 无新增落点文件、无 `.mjs` 改动**，故不适用「先写失败测试再实现」的分任务规则；其等价物是每条任务自带的命令原文 + 原始输出留痕（FR-062）。
>
> **三处强制顺序（违反即结论无效）**：(i) **T102 ≺ T104**——受影响 SKILL 集未现取时 `git status` 核对没有分母；(ii) **T104 ≺ T110**——`spec-driver-wrappers:{codex-wrapper-markers, codex-plugin-distribution-markers, codex-wrapper-runtime-namespace}` 3 项在再生前必 `fail`（文案指向「source 已变更但 wrapper 未重生成」），此时跑 `repo:check` 得到的红**不是回归**（plan §SC-006 重判连带口径 (i)），把它当回归修即为误判；(iii) **T103 ≺ T104 ≺ T105**——FR-051 的 disjoint 判定须在再生**前**取一次（避免把冲突文件先改脏）、再生**后**再取一次（再生产物本身可能落进 F276 的认领集）。
>
> **D-1 / D-2 / D-3 的执行体不在本 Phase**：D-1 已由 **T062**（Phase B 收口）执行、D-3 已由 **T098**、D-2 承诺任务化子项已由 **T099**（均在 Phase D 收口）执行。本 Phase 对这三条**只做汇总归档与通过条件逐条复核，不重复执行**——重复执行会产生两份可择优引用的结论，正是本卡要收口的形态。plan Phase E 的执行顺序表把它们列为序 1 ~ 3，指的是**它们在 Phase E 汇总时的排序**，不是要求在 Phase E 重跑。

- [ ] T102 裁定 · ⚠️ 待办消账（再生产物计数现取）：跑 `grep -n 'source:' plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` 取合同 entry 全集（实测 **9** 个，单位：entry），再跑 `git diff --name-only e01611b2...HEAD -- 'plugins/spec-driver/skills/*/SKILL.md'` 取**本卡实际改动的 SKILL 源集合**，二者取交集得受影响集 S。**产出 = 一段裁定文本落进 plan §修订记录**：写明 `|S|`、再生产物数换算式 `|S| × 2 个分发目录`（`.codex/skills/**` 与 `plugins/spec-driver/skills-codex/**` 各一份）、单位（wrapper 文件），并**同批统一三处旧口径**（spec 的「再生 8」、plan 早前的 10、plan Phase E 落点段的「5 + 5 = 10」）。**判据纪律**：`|S|` 由上述命令现取，**不得从 FR-068 射程 5 ∪ FR-060 射程 7 = 8 这一纸面并集倒推**（该并集是 plan 阶段的预期值，实际改动集可能因 T080 / T053 / T079 三条裁定而移动）；**若 `|S| ≠ 8` 须在同一段裁定文本中写明差异来源与受影响的下游数（验证点 6 的核对清单、SC-006 分母、`repo:check` check id 总数）**。命令原文与其原始输出按 FR-062 留痕 → Phase E 验证点 6
- [ ] T103 验证 · FR-051 前置 oracle 取证（**必须在 T104 再生之前**）：先 `git fetch origin` 使 F276 分支 ref 可解析（**本机实测该分支当前不在本地**，`git branch -a --list '*f276*'` 输出为空），再跑 `git diff --name-only $(git merge-base master claude/f276-compliance-handoff-fixes-9a9fe1)..claude/f276-compliance-handoff-fixes-9a9fe1` 取 F276 认领文件集 **A**；**先证明 oracle 取得成功**（退出码为 0 **且** ref 可解析 **且** 输出可读）再进入判定。**取不到（fetch 失败 / ref 不可解析 / 非零退出码）时该项判「未执行（缺席）」，按存在冲突处理，不得因「没查到交集」而默认放行**（FR-051 (i) 字面口径）。同时跑 `git diff --name-only e01611b2...HEAD` 取本卡改动集 **B** 的当前值，判 `|A ∩ B|`；**≠ 0 时立即停止改动并回报编排器裁决，不做乐观合并、不自行 rebase 对方改动**。已知接触点 **3** 个（单位：文件）：`scripts/lib/repo-maintenance-core.mjs` / `scripts/sync-agent-docs.mjs` / 新建 `scripts/lib/agent-tools-core.mjs`。命令原文与其**原始输出（含「空输出」这一事实本身）**一并写入产物 → Phase E 验证点 7
- [ ] T104 实现 · `npm run repo:sync` 再生并连带提交（**FR-048 的唯一落点**）：改动 `plugins/spec-driver/**` 下的 SKILL / agents 后跑 `npm run repo:sync`，随后 `git status --porcelain .codex/skills plugins/spec-driver/skills-codex` 核对——**两个分发目录的再生 diff 只含 T102 现取的受影响集 S 中的 SKILL**，出现 S 之外的文件即说明再生链把无关 wrapper 一并刷了，须查明原因而非直接提交；再生产物**必须连带提交**（该链路为**单向再生，手改 `.codex/skills/**` 无效**，不得依赖执行者记性）。**与 FR-051 的仲裁规则（冲突时 FR-051 优先）**：若再生产物与 T103 取得的 A 有交集，**不提交交集部分**、回报编排器，并在产物中记录「因文件集冲突未执行的 `repo:sync` 落点清单」交编排器裁决先后；**不得**为满足本条单方面覆写 F276 的文件，**也不得**为满足 FR-051 而跳过 `repo:sync` 却不回报（跳过而不回报等同于把冲突藏进交付） → FR-048
- [ ] T105 验证 · FR-051 disjoint 终判（**再生之后重取一次**）：以 T104 提交后的改动集重跑 T103 的两条命令，判 `|A ∩ B| = 0`；**先证 oracle 取得成功再判交集**，取不到即判「未执行（缺席）」、**不得记 PASS**。终判结论须与 T103 的前置结论**并列列出**（两次取值、两次时点），二者不一致时以本条为准并写明差异来源（通常是再生产物新增的文件） → Phase E 验证点 7
- [ ] T106 验证 · 转「相关」的 3 项 wrapper 守护项复跑（plan §SC-006 既有相关侧逐项重判 #2 / #3 / #4）：跑 `npm run repo:check` 并逐项确认 `spec-driver-wrappers:codex-wrapper-markers`（`.codex/skills/<id>/SKILL.md` 的 `- Source SHA256:` 行与 canonical source 重算值比对）、`spec-driver-wrappers:codex-plugin-distribution-markers`（同一判据、第二处分发目录 `plugins/spec-driver/skills-codex/<id>/SKILL.md`）、`spec-driver-wrappers:codex-wrapper-runtime-namespace`（逐行扫两处 wrapper 内容，命中 `/mcp__/` 即 `fail`）**三项全 pass**，并确认 `codex-plugin-consistency:*` 12 项全 pass。**三项的通过路径已变**（连带口径 (i)）：它们从「本卡碰不到」变为「**必须先跑 T104 的再生才能 pass**」，故本条**必须排在 T104 之后**；**第 3 项转 `fail` 时的正确处置是回改本卡写入的散文**（块 1/2/3 与第 4 块中禁写 `mcp__` 字面量，连带口径 (ii)），**不得改 `extract-wrapper-body.mjs` 的替换表** → Phase E 验证点 6
- [ ] T107 验证 · 回归护栏 1 / 5 `npx vitest run`：零失败，或**已按 FR-050 三条件完成满载假红归因**——(a) **隔离重跑绿**（低负载窗口单独重跑该用例通过）、(b) **与本卡改动面零交集**（失败项与 T103 取得的 B 无交集）、(c) **命中预存 flaky 清单或按该协议新登记入清单**，三条**同时成立**才可判假红。归因记录**必须附两次跑批各自的命令行与输出片段**；**无归因记录者一律计失败**（把未归因的失败判成绿，正是本卡要收口的 fail-open 形态，且会发生在本卡自己的护栏上）。**满载是设计安排而非异常**：FR-051 要求本卡与 F276 并行（同机、共享 `node_modules`），本仓实测满载下本命令曾达 **828s**（对照干净 **64.62s**，约 **13×** 拖慢）并伴随 `Timeout calling "onTaskUpdate"` 的 birpc 假红签名；**禁止为规避满载而放弃与 F276 并行** → Phase E 验证点 1
- [ ] T108 验证 · 回归护栏 2 / 5 `npm run test:plugins`：判据与归因口径**逐字同 T107**（零失败或已按 FR-050 三条件归因，归因记录附两次跑批的命令行与输出片段，未归因一律计失败） → Phase E 验证点 2
- [ ] T109 验证 · 回归护栏 3 / 5 `npm run build`：**类型检查零错误**。本条**不适用满载假红归因**——`tsc` 的类型错误与机器负载无关，任何非零退出一律计失败；归因口径的适用面仅限 (1)(2)(4)(5) 四条跑批型命令，**不得把编译错误按「满载」放行** → Phase E 验证点 3
- [ ] T110 验证 · 回归护栏 4 / 5 `npm run repo:check`（**必须排在 T104 再生之后**）：零失败；**check id 总数 = 88 + 6 = 94**（须与实跑输出逐字核对，换算式：既有基线 88 + 本卡新增 6；新增 6 = `agent-docs:shared-section:*` **4** 个（`agent-output-discipline` / `orchestrator-gate-mounting-guard` / `gate-tasks-scope-cut-acceptance` / T080 裁定新增的第 4 块）+ `agent-tools:required` 1 + `gate-mounting:effective-config` 1，单位：check id）；**与本卡直接相关的 27 项全 pass**（换算式：既有相关 21 + 新增 6 = 27，同单位；既有相关 21 的逐项判定见 plan §SC-006 既有相关侧的逐项重判）。**实跑值 ≠ 94 时禁止调整判据凑数**：少一条通常意味着某个 `sectionConfigs` 的 `key` 取错（key 直接派生 check id，取错时 `repo:check` **不报错、只少一条 check**），须回到 T026 / T069 与 T080 的 entry 定义核对 key 字面值。失败按 FR-050 三条件归因，未归因计失败 → Phase E 验证点 4
- [ ] T111 验证 · 回归护栏 5 / 5 `npm run release:check`：零失败。**本卡不改 `contracts/release-contract.yaml`、`plugin.json`、`marketplace.json`**，故本条预期为「不受影响的恒绿项」；**若转红须先判是否由 T104 的再生产物触发**（wrapper 侧文件进入 release contract 的受控清单），再按 FR-050 三条件归因，未归因计失败 → Phase E 验证点 5
- [ ] T112 核对 · SC-011 汇总与归因记录归档：把 T107 ~ T111 五条的结论汇总为 SC-011 的达成判定——**换算式：（零失败命令数 + 已归因假红命令数）÷ 命令总数 = 5 ÷ 5 = 100%**，单位：命令条；分母 5 = `npx vitest run` 1 + `npm run test:plugins` 1 + `npm run build` 1 + `npm run repo:check` 1 + `npm run release:check` 1。**分子的「已归因假红」须严格按 FR-050 三条件判定并附归因记录（命令 + 原始输出）；未完成归因的失败一律计失败、不计入分子**。归因记录是本条的**必附产物**，无记录即视为未归因、该命令按失败计；五条的命令原文与原始输出片段一并归档到 `specs/277-spec-driver-engine-hardening/verification/` 下的具名文件 → Phase E 验证点 1 ~ 5
- [ ] T113 [P] 验证 · **D-1** 汇总归档（执行体 = T062，本条不重复执行）：把 T062 的回放产物归档，并对 spec 的通过条件**逐条**复核——「（a）阳性——上述 **4 组**全部被点名且判为「未实现」（换算式：捕获组数 ÷ 未认领全集组数 = 4 ÷ 4 = 100%，单位：未认领项组）；（b）阴性对照——抽取该 plan 中确有 Phase 认领的 FR ≥ 3 条，无一被误报为未认领；（c）回放结论与 F270 当时的实际交付口径（P6 自查与 commit 报的「13 达成」）产生冲突。三者同时成立才算通过。」**输入语料**：F270 的真实 `spec.md` 与 `plan.md`（`git show 8617ae3e:specs/270-compliance-evidence-ledger/{spec,plan}.md`，取原文不用转述）。**性质须诚实登记**：F270 语料属外部对照，但执行方式是**人工按新判据逐条推演**、非机械执行，推演者已知期望结论，**无法排除向结论倒推**；矩阵对账结论必须附产生它的命令原文与其原始输出，**无命令与原始输出者该项按 FR-005 计「未执行（缺席）」，不得计通过** → D-1
- [ ] T114 [P] 验证 · **D-2** 汇总归档（**本卡内只验承诺任务化子项**，执行体 = T099）：把 T099 的候选池全表与入池步证据三项归档。**可达性变异测试子项随 FR-010 ~ FR-013 与 SC-005 一并移交 F27x，本卡不执行、不测量**，其阳性（`routeNonBlock` 命中 1 ÷ 1 = 100%）与阴性（≥ 3 个确有生产引用的符号误报 0 ÷ 3 = 0%，单位：导出符号个）两项在本卡内的缺席**不计未完成**。承诺任务化子项的通过条件按 spec 逐字复核——「**承诺任务化部分的判定条件按 FR-064 改写，不再是「缺失条数 > 0」**……按 FR-064 二选一，plan 阶段择一并留痕……**两者皆不做即判本演示的承诺任务化部分未达成**（可达性部分的双向判定不受影响）」；**plan 裁定 D-① 已择 (b)**，故本条的通过条件 = 结论处**原样写入** T096 的强度上限声明「**本演示只证明该检查在 F270 语料上非恒空，不构成对承诺检出率的任何声明**」，且**禁止**在任何制品中把 `FR-008` 口径为「延期承诺已被覆盖」。**外部对照口径**：本演示**不计入「已核对的外部对照」**（`evidence/historical-citations.md` §H-2 覆盖的恰是被移交的可达性半边），本卡内已核对的外部对照 = D-1 + D-3 共 **2** 条（换算式 2 ÷ 8 = **25.0%**，单位：演示条；上界仍为 3 ÷ 8 = **37.5%**，**两个量不得互相冒充**） → D-2
- [ ] T115 [P] 验证 · **D-3** 汇总归档（执行体 = T098，本条不重复执行）：归档两份语料的逐轮判定与反例样本结论，按 spec 通过条件**逐条**复核——「（a）两份语料的回放结论与各自真实轨迹**逐轮一致**（含末轮转守承重项、承重项清单在进入该模式**之前**写入轮次记录）；（b）反例样本**不被强制追加轮次**——这是防止把「收敛」误实现成「固定轮数」的关键反例，缺失则本演示不通过（FR-021）。**计数单位须区分「轮」与「路」**：F270 第一轮是 3 **路**并行审查，不是 3 **轮**。」**史实口径**：期望输出为 §H-3 更正后的版本，旧剧本「第三轮零新增 ⇒ 放行」**已作废**（F270 三轮全部有新发现）；本卡自身轨迹的 R1 = **20** / R2 = **16**（单位：CRITICAL 条）两个数**各自独立、禁止相减**。**性质同 D-1**：外部对照但人工推演，无法排除向结论倒推 → D-3
- [ ] T116 验证 · **D-4** reverse-census 缺口注入演示（**implement 后回跑**，受时序悖论影响）：**输入语料** = 本卡自身被修改的关键量（`agents/*.md` frontmatter 的 `tools` 键、`sync-delegation-contract.mjs` 的 SKILL 注入锚点名、`scripts/sync-agent-docs.mjs` 的 `sectionConfigs` 三字段 `key` / `sourcePath` / `targets` 与由 `key` 派生的 marker 块名）。**执行步骤**：对每个关键量跑一次真实普查产出「检索命令 + 消费点清单 + 声明条数」→ 核对声明条数 == 命令实际输出计数 → **从清单中故意删去一个真实消费点**后重跑 T041 落成的一致性校验。**期望输出**：初始校验通过；删去一个消费点后报出「清单条数与命令计数不符」并**阻止进入实现阶段**。**通过条件（逐字）**：「**注入缺口后必须被发现**。若删掉一行也发现不了，说明该产物只是摆设，本演示判不通过（FR-028）。同时须显式记录该演示**测不到**的部分：它验不了「该申报的关键量是否都申报了」（见能力边界声明 B-1；其可测的经验命题部分见 A-3）。」**另须核对 FR-028 登记的两个未盘点消费方**：`templates/preference-rules.md:6` 的过滤渲染（**已由 V-1 证伪影响**）与 **F170d harness 的 `--append-system-prompt` 注入（仍未盘点）**——补全时须以推断前提 A-5 的证实 / 证伪命令核对两个脚本的**实际过滤逻辑**，**不得照抄自述条数充数**；未补进即判本演示未达成。**自证循环声明**：被检对象是本卡自身改动的关键量，**通过不构成该检查在他人产物上同样有效的证据** → D-4
- [ ] T117 验证 · **D-5** 中断幸存与按段续写演练（三段汇总）：**(a) 8 条 frontmatter / 协议文本断言**——**由 `repo:check` 的 `agent-tools:required` 守护项机器执行，本条只跑该命令并把命令原文与其原始输出写入产物，不由演示执行者自读自判**（该守护项同样产出于 implement，故 (a) 亦落入时序悖论）：`agents/{specify,plan,tasks}.md` 的 `tools` 各断言「含 `Edit`」与「含 `Bash`」（3 × 2 = **6** 条正向）+ `agents/verify.md` 的 `tools` **与钉入守护项源码的落地时快照逐字相等**（**1** 条护栏）+ 协议文本对 verify 标注「不适用」**且**该处附有 FR-016 (ii) 独立性口径声明（**1** 条文本断言，缺声明即 FAIL）= **8**（单位：断言条）；**不得再使用「断言 `verify` 的 `tools` 不含 `Write` / `Edit`」作为独立性证据**（该断言在现状下恒真且测的是与独立性无关的量，verify 实测持有 `Bash`）。**(b)(c)** 汇总 **T077** 在 Phase C 开启的观察窗口所积累的 **≥ 3 次独立观察**（不同文档、不同会话的真实长文档生成；**委派 prompt 中不得提及分节协议、骨架、逐节 Edit 或任何等价要求**；**不得为凑数在 Phase E 集中造 3 次**）。**通过条件（逐字）**：「三段全部成立，**且（b）(c) 的 ≥ 3 次独立观察全部自发分节落盘**。换算式：自发分节落盘次数 ÷ 独立观察次数 = 3 ÷ 3 = 100%，单位：观察次；出现 1 次一次性长 Write 即判本演示未达成并**如实记录比例（如 2/3），不得四舍五入为通过**——N=1 区分不了「协议生效」与「这次子代理碰巧这么写」。（a）中任一断言 FAIL 时交付整体判不通过（FR-017；执行者为 `repo:check`，阻断经 FR-050 与 FR-059 合并律，不依赖 verify 自判）；（c）中已完成节字节发生变化即判定为「发生了整篇重写」，本演示不通过（FR-018）。」 → D-5
- [ ] T118 [P] 验证 · **D-6** 引用原文化抽查（**implement 后回跑**，受时序悖论影响）：**输入语料** = 本 spec 自身 + 最近一份 fix-report。**两步互补、缺一不可**——**(1) 全量结构扫描**：形式 (a) 侧统计「有历史引用而无内联 `git show` 代码块」的**段落数**（单位：段落），形式 (b) 侧统计「被引史实未被文档级索引表收录，或其首次引用处无 §H-n 指针」的**史实数**（单位：史实条），两侧扫描命令与其原始输出一并写入产物，**两个计数单位不得相加**；**(2) 抽样内容核对**：随机抽 3 条历史引用，对其中 1 条实跑该 `git show` 命令比对片段与原文（本 spec 采用形式 (b)，抽样时先由引用处的 §H-n 指针取到 `evidence/historical-citations.md` 的对应条目，再核其逐字片段）。**期望输出**：(1) 两侧违规数均 = 0（换算式：形式 (a) 违规段落数 ÷ 采用形式 (a) 的历史引用段落总数 = 0 ÷ N₁ₐ = 0%；形式 (b) 违规史实数 ÷ 索引表收录史实总数 = 0 ÷ N₁ᵦ = 0%；**两个分母均由扫描现取、不写死**——N₁ᵦ 于 2026-09-02 实测为 **13**）；(2) 抽样 3 条全部带原文片段且实跑比对一致。**通过条件（逐字）**：「**两步都成立**。只做抽样即为双标——FR-001 对覆盖矩阵明写「不允许抽样」，同一份 spec 内对本项只做抽样核验不成立（FR-030 / SC-014a）。任一条缺片段即失败；实跑比对不一致即失败……**能力边界**：结构扫描只验「原文片段在场」，不验其内容是否与转述相符；内容正确性靠抽样人工核对，二者互补而非替代。**本演示的被检对象含本 spec 自身（自证循环）**。」 → D-6
- [ ] T119 [P] 验证 · **D-7** 数量换算式抽查（**implement 后回跑**，受时序悖论影响）：**输入语料** = 本 spec 的 Success Criteria 全节与 Edge Case 7 / FR-040。**两步互补**——**(1) 全量结构扫描**：扫遍全部可观测数量，统计「只有结果数字、同段既无换算式也无计数单位」的条目数，扫描命令与原始输出写入产物；**(2) 抽样算术复算 + 计数集合核对**：对字节预算条实跑 `wc -c AGENTS.md` 复核换算式两侧数值，**并核对其计数集合与守护项源码一致**（`grep -n AGENTS_CANDIDATES scripts/lib/worktree-local-state-core.mjs`），再逐条复算其余含算式条目。**期望输出**：(1) 违规条目数 = 0（换算式：违规条目数 ÷ 可观测数量总数 = 0 ÷ N₂ = 0%，单位：数量条；**N₂ 由扫描现取、不写死**）；(2) 字节预算换算式 `32768 − 24316 = 8452 bytes` 与实测一致，且**计数集合口径注明为 `['AGENTS.md', 'AGENTS.override.md']`（不含 `CLAUDE.md`，后者本仓不存在故为单元素 max）**并与 `worktree-local-state-core.mjs:17` 源码一致。**通过条件（逐字）**：「**两步都成立**。出现任何「只写结果数字、无换算式或无单位」的条目即失败（FR-031 / SC-014b）；实测值与换算式不符即失败。**能力边界**：结构扫描只验「换算式与单位在场」，不验算式本身是否算对、**更不验其计数集合是否取对**；算术正确性靠人工复算，集合正确性靠与源码对照（步骤 (2) 第二半），三者互补而非替代……」**另须注意**：SC-002 与 SC-014 的分母均为「验收时现取」而非字面量，复算时**须重跑其取数命令而不是照抄本文记录值** → D-7
- [ ] T120 验证 · **D-8** 推断前提运行时实证（**implement 后回跑**，受时序悖论影响）：**输入语料** = 本 spec 的「推断前提登记」章节（三类共 **10** 条：`[推断]` A-1 ~ A-5 **5** 条 + 能力边界声明 B-1 / B-2 **2** 条 + 已核实 V-1 ~ V-3 **3** 条；换算式 5 + 2 + 3 = **10**，单位：前提条）。**执行步骤**：对 **5** 条 `[推断]` 逐条实跑其证实 / 证伪命令，记录命令原文、原始输出片段与结论；**逐条先核「命令与陈述是否同一命题」（FR-066）**——命令的 PASS / FAIL 必须直接对应该陈述的真 / 假，**不得用相邻但不同的命题的实跑结果为该陈述背书**。**期望输出**：5 条各得到明确的 PASS 或 FAIL 且各附原始输出片段。**通过条件（逐字）**：「**5 条**全部得到明确结论。**若某条只能得到「无法判定」，说明其验证命令不是运行时口径，该条判不通过**（FR-033）——「按设计应当如此」这类静态论证不构成实证；**命令与陈述不是同一命题的条目按「无法判定」计**（FR-066）。另需核对三处分母口径：**(i)** 标注为「已核实」的 V-1 / V-2 / V-3 未被混入 `[推断]` 分母；**(ii)** V-1 ~ V-3 是否已按 FR-032 补齐**命令与其原始输出片段**——未补齐者退回 `[推断]` 并计入分母（分母由 5 增至最多 8，SC-009 换算式须按实际重算）；**(iii)** 能力边界声明 **B-1 / B-2 两条均未被计入**分母……且 A-3 是从原 A-3 拆出的**可测经验命题**、其命令与陈述同一命题。」**自证循环声明**：被检对象是本 spec 自身，**通过不构成该检查在他人产物上同样有效的证据** → D-8
- [ ] T121 实现 · 时序悖论回跑违规的「追加而非改写」处置（Edge Case 18 (ii)）：**触发面 = 5 条**（换算式：D-4 + D-5 + D-6 + D-7 + D-8 = **5**，5 ÷ 8 = **62.5%**，单位：演示条；D-5 因其步骤 (a) 已改为跑 `agent-tools:required` 守护项、该守护项同样产出于 implement 而计入）。**处置口径**：T116 ~ T120 回跑扫出的 spec / plan 违规，一律**在矩阵章节之外追加带时间戳的「冻结后修订记录」**，须写明**发现时点 / 发现者 / 原条目取值 / 新取值**；**禁止无痕改写冻结时点的矩阵正文**——FR-005 的冻结哈希只覆盖冻结时点的**正文**，追加记录与冻结哈希**互不覆盖、二者不冲突**。**触及 spec 正文的违规同样走追加**（spec 已定稿且 `GATE_DESIGN` 已批准），落 `specs/277-spec-driver-engine-hardening/verification/` 内的具名文件，**不改 spec 冻结正文**。**另须登记机械执行数下界 = 0**（单位：演示条）：在 implement 之前这 5 项**只能人工推演**；**凡在演示产物中声称某项「已机械执行」而未同处给出该次执行的命令与原始输出，即为 over-claim** → Phase E 验证点 8
- [ ] T122 核对 · **[编排器亲自执行]** `GATE_VERIFY` 矩阵哈希重算（FR-005 的第三方比对位）：**本条不是可委派任务，是提醒点**——编排器必须在 `GATE_VERIFY` 决策时**亲自重算** `plan.md` 覆盖矩阵章节规范化内容的哈希，与**编排器自己持有的** `GATE_TASKS` 注入值比对，并把「**重算值 / 持有值 / 比对结论**」三项写入 `[GATE] GATE_VERIFY` 日志行。**判定权归属**：verify 自报的三值（① 编排器注入值 / ② tasks 制品读到的值 / ③ 对当前 `plan.md` 矩阵章节的现算值）**一律只作参考**；**编排器重算与其持有值不一致 ⇒ 该项判「未通过」，无论 verify 自报如何**（verify 报「三值一致」不构成反证，只增加一条「verify 自报与编排器重算相左」的留痕）；**编排器重算缺席（日志行无该三项）⇒ 该项判「未执行（缺席）」**，不得因 verify 自报三值一致而判通过。**不可委派的理由**：`GATE_VERIFY` 的 gate 决策判断按委派合同就属编排器亲自执行的部分，重算一个哈希是该决策的输入，**把它委派给 verify 等于让被检者提供判定输入**。**`resume` 分支**：注入值只认 `GATE_TASKS` 之后的 commit 对象，由 `resume` 会话的编排器按 `tasks.md` 冻结字段中与冻结哈希**同处**记录的 `<sha>` 执行 `git show <sha>:<tasks 制品路径>` 取值；**缺 sha 或 `git cat-file -e <sha>` 失败 ⇒ 判「未执行（缺席）」**，**禁止**用「最近一个含 tasks 制品的 commit」「当前 `HEAD`」这类现推口径 → Phase E 验证点 8
- [ ] T123 核对 · 13 条约束型 FR 的三取值逐条在场（Phase E 验证点 8）：对 §约束型 FR 核验点 表内 **13** 行（单位：FR 条）逐行确认 verify 报告中出现「已核验未违反（附核验方式）/ 已违反 / 未核验」**三取值之一**，**缺该三取值之一即计「未核验」并按 FR-059 归入不通过侧**，不得因「约束型不用做事」而整类略过；核验方式须附产生该结论的**命令原文与其原始输出**（FR-062 同标准，无命令与输出者计「未核验」）。**本条不是任何单条约束型 FR 的认领任务**（约束型 FR 按 FR-005 贯穿口径 (4) 一律不要求任务），而是对「三取值是否逐条在场」这一**整体属性**的一次性核对，故**不带 FR 尾标**；把它拆成 13 条「核验没做某事」的任务会使 `tasks.md` 记「有任务」而矩阵记「非实现量」，正是 FR-056 否掉的写法 → Phase E 验证点 8
- [ ] T124 登记 · dogfooding 反馈落账（`docs/design/dogfooding-feedback-ledger.md`，随本卡一并 commit，状态「待处理」）：本卡收集到的 **5** 条（单位：反馈条）——(1) `orchestrator-cli.mjs generate-template` **不能 round-trip 自家 schema**（生成的模板回灌后被 resolver 判不合法）；(2) `spec-driver` 的 **specify / plan / tasks 三份 agent 缺 `Edit` 与 `Bash`**，长文档分段落盘与取计数在物理上不可执行（本卡 FR-015 已修，反馈记录其暴露过程）；(3) **Spectra 图 stale 与 reverse-census 主证源不匹配**（`graph-quality:freshness` 实测 warn，`sourceCommit` 落后 HEAD，普查只能退回 `grep` 主证）；(4) **`grep` 在本机是 ugrep 的 shell function**，影响「命令原文可复现」这一 FR-027 前提（同一条命令在他人机器上行为不同）；(5) **四次长任务子代理被 API 中断**，长 transcript 恢复成功率低。**落账纪律**：按账本既有条目格式 append，**不去重**——重复报告记「再现：F277」；**「无」不落账**，本卡有实质反馈故必须落 → Phase E 验证点 8
- [ ] T125 交付 · commit（**须标注审查档位**）：`git add` 本卡显式路径（**禁止 `git add -A`**，避免卷入并行 feature 的再生制品），commit message 须含 (a) 中文正文按仓库 Language Convention、(b) **「Codex 审查暂停，异构档位缺席」**的显式标注（本卡含门禁 / 判定器类改动：`orchestration-schema.mjs` 禁改集、`validate-gate-mounting.mjs`、`agent-tools-core.mjs`、`repo-maintenance-core.mjs` 兜底外壳，按 CLAUDE.local.md 顶部档位表属「失效即静默放行」类，须走异构对抗且如实登记 Codex 档位缺席）、(c) T024 的 K14 断言清单变更按「**预期变更、不是回归**」口径留痕、(d) `Co-Authored-By` 行。**提交前置**：T107 ~ T111 五条护栏已按 T112 汇总为 SC-011 达成或已完成 FR-050 归因 → Phase E 验证点 1 ~ 5
- [ ] T126 交付 · push 前 report 等用户明确确认（CLAUDE.local.md 七字段，**master 专属约束**）：在 chat 中列出 (1) commit hash + 一句话 summary、(2) 改动统计（new / modified 文件数 + `+X / -Y` 行数）、(3) 关键 finding / signal 总结、(4) **审查档位 + 结论**（如「内部异构对抗复审 ×2：NC/NW（已修）；Codex 暂停」——本卡为门禁类，须写明档位缺席）、(5) verify 结果（`npx vitest run` pass count / `npm run build` / `npm run repo:check`（check id 总数 **94**）/ `npm run release:check`）、(6) rebase + 冲突解决状态（已 rebase 到最新 `master`、无 / 有冲突已解）、(7) 下一步建议。**交付方式**：本仓统一 **Rebase + ff push**——`git fetch origin master:master` → `git rebase master` → 本地重跑全量护栏零失败 → `git push origin HEAD:master`；**push 前必须再 `fetch` 复核 `behind == 0`**，前移则重新 rebase 并**重跑验证**，**绝不 force push master**。用户回复「确认 push」等价表达才执行；**任何其他回复一律视为未确认** → Phase E 验证点 1 ~ 5

**换算式**：本 Phase 任务 **25** 条（T102 ~ T126）= 裁定 1（T102）+ 再生链与文件集护栏 4（T103 ~ T106）+ 回归护栏 5（T107 ~ T111）+ 护栏汇总 1（T112）+ 验收演示 8（T113 ~ T120）+ 时序悖论处置 1（T121）+ 编排器亲自执行核对 1（T122）+ 约束型三取值在场核对 1（T123）+ 交付收尾 3（T124 ~ T126），单位：任务。`[P]` 标记 **5** 条（T113 / T114 / T115 三条纯归档各写各的产物文件、T118 / T119 两条只读全量扫描对象互不相交），单位：任务。`[CLEANUP]` **0** 条；测试类任务 **0** 条（本 Phase 无 `.mjs` 改动）。**验收演示 8 条中执行体在本 Phase 的为 5 条**（换算式：8 − 在 Phase B / D 已执行的 D-1 / D-2 / D-3 共 3 条 = **5**，单位：演示条），其余 3 条为汇总归档，**两个量分列、不得互相冒充**。

---

## 约束型 FR 核验点

**口径**（plan / spec FR-056）：13 条约束型 FR 的「认领 Phase」列一律为占位符 `—`，**不生成任务**——它们规定的是「不得发生某事」或「整体保持某种性质」，没有任何 Phase 会「认领实现」它们，也不可能裁剪它们。改写后的 `agents/tasks.md` 硬不变量口径为「每条**未被裁剪登记的实现型** FR 至少有一个对应任务；**约束型 FR 一律不要求任务**」。

**但「不生成任务」≠「不核验」**：每条须在 verify 阶段出现三取值之一（「已核验未违反（附核验方式）/ 已违反 / 未核验」，Phase E 验证点 8），核验方式须附产生该结论的命令原文与其原始输出（FR-062 同标准）。

| FR | 核验落点 | 核验命令或断言（可执行） | 对应 Task ID |
|---|---|---|---|
| FR-016 | **二者并列** | `npm run repo:check` 的 `agent-tools:required` 中的**护栏 1 条**——`agents/verify.md` 的 `tools` **与钉入守护项源码的落地时快照逐字相等**（不以 verify 自取的交付前基线为比对源）——加**文本断言 1 条**：协议文本对 verify 标注「不适用」**且**该处附有 FR-016 (ii) 的独立性口径声明（写明「verify 持有 `Bash`、写能力未在工具层封闭、只读性属自律而非强制」）。**禁止**以「`tools` 不含 `Write` / `Edit`」为独立性证据（该断言在现状下恒真、测的是与独立性无关的量）。**结论口径**：即便本条全 PASS，verify 的整体独立性仍登记为「未取得」，凡口径为「已取得」即 over-claim | T014 / T015 / T076 / T117 |
| FR-025 | **二者并列** | `node plugins/spec-driver/scripts/validate-gate-mounting.mjs` 的 **12** 条断言（换算式：挂载 6 + `is_hard_gate` 1 + `GATE_DESIGN.default_behavior ≠ skip` 1 + `GATE_TASKS.default_behavior ∉ {auto,skip}` 1 + diagnostics 无 `error` 3 = 12，单位：断言）在 base + overrides 合并后的 effective 配置上全 PASS，**且红灯构造**（只替换 `modes.feature`、不碰 `gates:` 块）下断言 (i) **必须红**。另核 `fix` mode 的 `GATE_DESIGN` **默认豁免**缺口已由 T097 显式认领或落裁剪登记——**两者皆无即判 FR-020 未达成**，且**不得**把本卡口径为「已覆盖全部门禁类改动」 | T012 / T013 / T022 / T097 |
| FR-035 | **二者并列** | T031 的宪法原则 IX 逐条核对：本卡 3 处新增 `.mjs` 断言（换算式：`agent-tools-core.mjs` 8 + `validate-gate-mounting.mjs` 12 + resolver 挂载校验 1 = **21** 条断言）**每一处**都要能在对应 prompt / 模板中找到同语义原文；找不到即判原则 IX VIOLATION 并**回退该处实现**（不是补写 prompt 了事——补写会把「脚本先行」固化成惯例） | T031 |
| FR-037 | **二者并列** | 列出两份新脚本的全部 import 行并逐行确认前缀为 `node:`：`grep -nE "^\s*import\b" scripts/lib/agent-tools-core.mjs plugins/spec-driver/scripts/validate-gate-mounting.mjs`，命中任一非 `node:` 前缀即判**已违反**。**分母须现取**（新脚本数以 T103 的改动集 B 为准，不写死 2） | T013 / T015 |
| FR-038 | **二者并列** | 对 `validate-gate-mounting.mjs` 断言「强制 mode 清单**从 `GATE_DESIGN.hard_gate_modes` 与 mode 分层矩阵派生**、禁写字面量」：`grep -n -e "'feature'" -e "'story'" -e "'implement'" -e "'fix'" -e "'resume'" -e "'sync'" -e "'doc'" -e "'refactor'" plugins/spec-driver/scripts/validate-gate-mounting.mjs` 输出**为空**（**刻意用重复 `-e` 而非 `grep -E` 的 `|` 交替**：本行落在 Markdown 表格单元格内，`|` 必须转义成 `\|`，而 `\|` 在 ERE 下是**字面竖线不是交替**——照抄出去的命令会静默变成另一条查询，正是 FR-027 要防的不可复现形态）；同法核 `agent-tools-core.mjs` 不内嵌 phase 序列 / gate 策略 / prompt 模板文本。**判据是存在性判定不是值枚举**（F259 反模式：判据写成值枚举 ⇒ 每加一个值漏一次） | T013 |
| FR-039 | **二者并列** | 对本卡新增的共享块与 4 个新具名章节做结构核查：章节标题与散文为中文，`FR` / `Phase` / `reverse-census` / `GATE_DESIGN` / `frontmatter` / `sync` / `fail-open` 等技术术语保持英文。核验命令 = 对新增文件跑 `grep -nE '^#{2,4} '` 取全部标题逐条判读（**该判读无机械判据、只能人工逐条给结论**，须如实登记为人工核验而非机械执行） | verify 阶段 |
| FR-040 | **二者并列** | `wc -c AGENTS.md`（上限 32768 bytes，实测基线 24316 bytes，余量换算式 32768 − 24316 = **8452 bytes**）+ `grep -n AGENTS_CANDIDATES scripts/lib/worktree-local-state-core.mjs`（计数集合须为 `['AGENTS.md', 'AGENTS.override.md']`，**不含 `CLAUDE.md`**）+ `npm run repo:check` 的 `worktree-local-state:agents-byte-budget` = pass。**本卡对该预算的影响预期为 0**（新增 `sectionConfigs` entry 的 `targets` 是 `plugins/spec-driver/agents/*.md` 与 `plugins/spec-driver/skills/*/SKILL.md`，**不注入仓根**），故辅助断言 `git diff --stat e01611b2...HEAD -- AGENTS.md` **输出为空**；非空即须回到本条重算余量 | T119 |
| FR-041 | **二者并列** | `grep -rnE 'plan §[0-9]' specs/277-spec-driver-engine-hardening/` 输出**为空**（出现「plan §N」式编号引用即视为悬空引用、判**已违反**）；并确认本卡新增的 4 个章节（`## FR → Phase 覆盖矩阵` / `## 裁剪登记` / `## 关键量反向普查` / `## 推断前提登记`）在两份 `plan-template.md` 中**均以具名章节落地**并按名称引用 | verify 阶段 |
| FR-045 | **二者并列** | 逐个 `catch` 分支确认上抛显式失败或显式缺席状态：`grep -n -A6 'catch' scripts/lib/agent-tools-core.mjs plugins/spec-driver/scripts/validate-gate-mounting.mjs`，**返回空结果或 `pass` 即判已违反**；R-1 兜底外壳 `validateSharedAgentDocsSafely` 的**方向**断言由 T020 覆盖（**记 `fail` 不记 `pass`**——方向搭反的防线比没有防线更危险，它会以「有守护」的名义放行） | T013 / T015 / T020 / T021 |
| FR-049 | **二者并列** | 两条 diff 断言 + 一条语义断言：(1) `git diff e01611b2...HEAD -- plugins/spec-driver/config/orchestration.yaml` **输出为空**（本卡不新增门、不改 gate 定义、不改 `gate_policy` 到 `behavior` 的映射）；(2) `git diff -G'AskUserQuestion' e01611b2...HEAD -- 'plugins/spec-driver/skills/*/SKILL.md'` 与 `git diff -G'暂停' e01611b2...HEAD -- 'plugins/spec-driver/skills/*/SKILL.md'` **两条输出均为空**（用 `git diff -G<regex>` 而非管道进 `grep`：表格单元格内的 `|` 须转义，转义后照抄出去的命令语义会变）——即**无新增暂停点**（收敛循环的全部轮次须在**单次** `GATE_DESIGN` 暂停之前闭环，每轮各停一次即 N 轮 = N 次用户暂停、与本条直接互斥）；(3) T025 写入的 `BLOCKED` 必须是**拒绝启动、无「批准继续」选项**——实现成「暂停询问是否忽略挂载缺失后继续」即判**已违反**且同时违反 C-6 红线 | T025 / T082 |
| FR-050 | **二者并列** | SC-011 的五条命令实跑记录（**命令原文 + 原始输出**）：`npx vitest run` / `npm run test:plugins` / `npm run build` / `npm run repo:check` / `npm run release:check`；换算式 **（零失败命令数 + 已归因假红命令数）÷ 命令总数 = 5 ÷ 5 = 100%**（单位：命令条）。**归因记录是必附产物**，三条件须同时成立才可判假红：(a) 隔离重跑绿、(b) 与本卡改动面零交集、(c) 命中或新登记入预存 flaky 清单；**未完成归因的失败一律计失败、不计入分子**（无记录即视为未归因） | T107 ~ T112 |
| FR-051 | **二者并列** | `git fetch origin` 后取 F276 认领集 **A** = `git diff --name-only $(git merge-base master claude/f276-compliance-handoff-fixes-9a9fe1)..claude/f276-compliance-handoff-fixes-9a9fe1`、本卡改动集 **B** = `git diff --name-only e01611b2...HEAD`，判 `A ∩ B = ∅`（集合记号，避免在表格单元格内转义竖线）。**顺序不可颠倒**：先证明 oracle 取得成功（**退出码为 0 且 ref 可解析**）再判交集；**取不到即判「未执行（缺席）」，按存在冲突处理，不得记 PASS、不得因「没查到交集」而默认放行**。已知接触点 **3** 个（单位：文件）：`scripts/lib/repo-maintenance-core.mjs` / `scripts/sync-agent-docs.mjs` / 新建 `scripts/lib/agent-tools-core.mjs`。**与 FR-048 冲突时本条优先** | T103 / T105 |
| FR-067 | **二者并列** | `grep -rn -e 'FR → Phase 覆盖矩阵' -e '裁剪登记' -e '关键量反向普查' -e '推断前提登记' plugins/spec-driver/agents/*.artifact.yaml` 输出**为空**（同 FR-038 行的理由用重复 `-e` 而非交替）（4 个新章节不落入 `required_sections`，用户 Q3 已裁定降为登记）；并核两条残余登记**在场**：(i) 新增章节在机械层**无强制点**，只剩 prompt 自觉；(ii) `required_sections` 本身当前是**无消费方**的声明性文档（全仓对该键的引用只存在于 14 份 `.artifact.yaml` 自身，无 `.mjs` 消费方 / 无 SKILL 引用 / 无测试断言）——**凡把「已写入 artifact 制品合同」当作机械保障即为 over-claim** | verify 阶段 |

> **核验落点列为何 13 行取值一致**：FR-005 已钉死核验者与核验时点——三取值一律由 **verify 在 Layer 1（Spec-Code 对齐验证，`plugins/spec-driver/agents/verify.md:49`）逐条给出并附核验方式**，再由**编排器在 `GATE_VERIFY` 决策时复核其是否逐条在场**。故 13 行的落点全部是「二者并列」，这**不是**填表时偷懒取同一值，而是本条 FR 的唯一合法取值；任一行落成单侧（只有 verify 自判、或只有编排器判而 verify 未给核验方式）即偏离 FR-005。
>
> **「对应 Task ID」列填 `verify 阶段` 的 3 行（FR-039 / FR-041 / FR-067）**：这 3 条的核验不依赖任何 Phase 任务的产物，可在 verify 阶段独立跑完；填 `verify 阶段` 是**核验执行者的声明**，**不是**为这 3 条 FR 生成了任务（约束型 FR 按 FR-005 贯穿口径 (4) 一律不要求任务）。引用了 Task ID 的 10 行同理——引用的是**已存在的实现 / 验证任务顺带产出的证据**，不构成对该约束型 FR 的「认领」。
>
> **三取值缺席的后果**：任一行在 verify 报告中缺「已核验未违反（附核验方式）/ 已违反 / 未核验」三取值之一 ⇒ 该条计**「未核验」**并按 FR-059 归入不通过侧；核验方式无命令原文与其原始输出者，同样计「未核验」（FR-062 同标准）。整类略过即判交付不通过。
>
> **计数核对**：13 行 = plan §换算式 式 1 的 `N₂ = 13`（单位：FR 条）；逐行列举 = FR-016 / FR-025 / FR-035 / FR-037 / FR-038 / FR-039 / FR-040 / FR-041 / FR-045 / FR-049 / FR-050 / FR-051 / FR-067，换算式 = 1 × 13 = **13**，与 §FR 覆盖映射表 中「类别 = 约束型」的行数一致。

---

## 移交 F27x

**FR-010 / FR-011 / FR-012 / FR-013** 共 4 条（plan 矩阵「认领 Phase」列取值 `移交 F27x`）。

- **不生成任务**：本卡不落任何实现落点。
- **移交是未完成态、不是裁剪**（spec §分批与移交 · 用户 Q6 硬约束）：这 4 条**不入本卡的裁剪登记**，也不计入 plan §换算式 式 2 的「认领 50 + 裁剪 1」两侧；它们由式 1 的 `N₃ = 4` 单独承载。
- **在本卡内的诚实口径**：需求项 2（承诺任务化与生产可达性检查 / US-2）因此**只部分实现**——承诺任务化半边留本卡（FR-008 / FR-009，Phase D），生产可达性半边随卡移交。plan §换算式 式 3 已据此把需求项 2 排除在 SC-013 口径 (a) 的分子 M 之外（M = 7）。
- **后续卡的验收输入清单（4 项，单位：输入件；派发时原样带过去，不重新转述）**：
  1. **spec `FR-010` ~ `FR-013` 原文**（`specs/277-spec-driver-engine-hardening/spec.md`，按 `git show <本卡定稿 sha>:specs/277-spec-driver-engine-hardening/spec.md` 取原文，**不用本卡任何制品对它们的转述**——本仓已有「结论转述失真」的实证，见 §H-6）；
  2. **D-2 的可达性变异测试子项**（spec §可复现验收演示清单 D-2 的可达性半边：阳性 = `routeNonBlock` 被报警且列出其全部引用点，换算式 1 ÷ 1 = 100%；阴性对照 = 抽同一次改动中确有生产路径引用的新增导出符号 **≥ 3** 个，误报 **0 ÷ 3 = 0%**，单位：导出符号个。**只有阳性命中而阴性对照失败，说明该检查是恒报警的噪声源，判不通过**）；
  3. **`evidence/historical-citations.md` §H-2**（该锚覆盖的**恰是**被移交的可达性半边，是这半边唯一经 F270 原文核对过的期望输出，**留在本卡的承诺任务化半边反而没有这个锚**——两者不得互相冒充）；
  4. **SC-005**（已标「随 F27x 移交，本卡不测量」，其阴性对照 0 ÷ 3 一并随卡移交）。
- **一条依赖已就位**：FR-013 的「有意的预留 ⇒ 强制派生延期承诺任务」依赖 FR-008，而 FR-008 留本卡（Phase D 的 T093 ~ T095），故 F27x 落地时该实体已存在，后续卡**不需要重建**它。
- **编号 `F27x` 是占位符，派发前必须 `git fetch` 复核**：本仓多 worktree 并行，Feature 编号历史上撞过号（如 F251 → F254 的三度重编）；派发前跑 `git fetch origin` 后以 `ls specs/` 与远端最新编号取当前可用号，**确定后再写进新卡的目录名与制品**，不得沿用本节的 `F27x` 字面量。

---

## FR 覆盖映射表

> **全 68 行，不抽样、不省略未认领行**（FR-001 / SC-002）。分母 N 由重算命令现取：`grep -c '^- \*\*FR-0' specs/277-spec-driver-engine-hardening/spec.md`，plan 侧 2026-09-04 实跑输出 **68**（单位：FR 条），与本表行数一致。
>
> 「类别」与「认领 Phase」两列**逐字抄自 plan §FR → Phase 覆盖矩阵**，tasks 不自行重新判定。`Task ID(s)` 与 `验证点` 两列由本段填充完毕，**全表零「待填」**。
>
> **`Task ID(s)` 列的取值域（四类，不得混用）**：具体 Task ID（实现型且留本卡）/ `核验点`（约束型，指向 §约束型 FR 核验点 同名行）/ `F27x`（移交，指向 §移交 F27x）/ `裁剪`（FR-024，指向 plan §裁剪登记 第 1 条）。**Task ID 由 T001 ~ T126 各任务行尾的 `→ FR-xxx` 标注反查得到**，是机械派生而非人工分派；某条 FR 的 Task ID 集合发生变化时，正确做法是改任务行的尾标再重新反查，**不得只改本表**（只改本表会使两张表对同一条 FR 给出相反账面）。
>
> **`验证点` 列的记号约定**：`PhA-n` / `PhB-n` / `PhC-n` / `PhD-n` / `PhE-n` = 对应 Phase 节内「验证点（抄自 plan）」的第 n 条；`D-n` = spec §可复现验收演示清单 的第 n 个演示（**注意区分**：`PhD-4` 是 Phase D 的第 4 条验证点，`D-4` 是第 4 个演示，二者不是同一个量）。

| FR | 类别 | 认领 Phase | Task ID(s) | 验证点 |
|---|---|---|---|---|
| FR-001 | 实现型 | **B** | T037 / T039 / T062 | PhB-1；演示 D-1 |
| FR-002 | 实现型 | **B** | T037 | PhB-1；演示 D-1 |
| FR-003 | 实现型 | **B** | T040 / T062 | PhB-1；演示 D-1 |
| FR-004 | 实现型 | **B** | T037 / T039 | PhB-1；演示 D-1 |
| FR-005 | 实现型 | **B** | T036 / T042 / T043 / T053 / T058 | PhB-3；PhE-8；**T122**（编排器 `GATE_VERIFY` 亲自重算，不可委派） |
| FR-006 | 实现型 | **B** | T042 / T062 | PhB-1；演示 D-1 |
| FR-007 | 实现型 | **B** | T038 | PhB-1 |
| FR-008 | 实现型 | **D** | T093 / T094 / T099 | PhD-2；演示 D-2（承诺任务化子项） |
| FR-009 | 实现型 | **D** | T095 / T099 | PhD-2；演示 D-2（承诺任务化子项） |
| FR-010 | 实现型 | **移交 F27x** | F27x | 随 F27x 移交（本卡不测量；验收输入见 §移交 F27x 的 4 项清单） |
| FR-011 | 实现型 | **移交 F27x** | F27x | 随 F27x 移交（同上） |
| FR-012 | 实现型 | **移交 F27x** | F27x | 随 F27x 移交（同上） |
| FR-013 | 实现型 | **移交 F27x** | F27x | 随 F27x 移交（同上；其依赖 FR-008 留本卡、已就位） |
| FR-014 | 实现型 | **C** | T063 / T064 / T065 / T070 / T076 / T078 | PhA-1（文本断言先红）→ PhC-1（转绿）；演示 D-5 (a) |
| FR-015 | 实现型 | **A** | T016 / T017 / T018 / T019 / T033 | PhA-1；PhA-5；演示 D-5 (a) |
| FR-016 | **约束型** | — | **核验点** | PhE-8；演示 D-5 (a)（护栏 1 条 + 文本断言 1 条） |
| FR-017 | 实现型 | **A** | T014 / T015 / T016 / T020 / T021 / T022 / T023 / T024 / T031 / T033 | PhA-1（SC-003 = 8 ÷ 8）；PhA-4（R-1 红灯）；PhA-7（K14 两步）；演示 D-5 (a) |
| FR-018 | 实现型 | **C** | T066 / T077 / T078 | PhC-1；演示 D-5 (b)(c)（观察窗口由 T077 开启、T117 汇总） |
| FR-019 | 实现型 · SHOULD `[可选]` | **C** | T067 / T078 | PhC-1；PhC-3（plan §裁剪登记 C-7 已判**实现**，不进裁剪） |
| FR-020 | 实现型 | **D** | T080 / T081 / T085 / T086 / T098 / T101 | PhD-1；演示 D-3 |
| FR-021 | 实现型 | **D** | T082 / T083 / T098 | PhD-1；演示 D-3（含首轮零 CRITICAL 反例，缺失则演示不通过） |
| FR-022 | 实现型 | **D** | T084 / T098 | PhD-1；演示 D-3（末轮达 `R_max = 3` 后转守承重项而非放行） |
| FR-023 | 实现型 | **D** | T084 / T098 | PhD-1；演示 D-3（承重项清单须在进入该模式**之前**写入轮次记录） |
| FR-024 | 实现型 · SHOULD `[可选]` | **（未认领 ⇒ 裁剪）** | **裁剪** | plan §裁剪登记 第 1 条（本卡唯一裁剪项，**不占** FR-060 的 K = 3 MUST 预算） |
| FR-025 | **约束型** | — | **核验点** | PhA-3（红灯构造：断言 (i) 必须红）；PhE-8 |
| FR-026 | 实现型 | **B** | T037 / T039 | PhB-1；PhB-3 |
| FR-027 | 实现型 | **B** | T037 | PhB-3；演示 D-4（含执行环境声明，FR-027 可复现性的前置） |
| FR-028 | 实现型 | **B** | T041 | PhB-3；演示 D-4（**注入缺口后必须被发现**） |
| FR-029 | 实现型 | **B** | T038 | PhB-3 |
| FR-030 | 实现型 | **D** | T087 / T101 | PhD-3；演示 D-6（两步互补，只做抽样即为双标） |
| FR-031 | 实现型 | **D** | T079 / T088 | PhD-3；演示 D-7（全量结构扫描 + 算术复算 + **计数集合核对**三步） |
| FR-032 | 实现型 | **D** | T089（+ T037 / T039 落该章节的模板结构与产出口径，**认领 Phase 仍为 D**） | PhD-3；演示 D-8（V-1 ~ V-3 未补齐命令与原始输出片段者退回 `[推断]` 并计入分母） |
| FR-033 | 实现型 | **D** | T091 | PhD-3；演示 D-8（「无法判定」即该条不通过） |
| FR-034 | 实现型 | **D** | T090 / T100 | PhD-4（24 格全「强制」，换算式 3 行 × 8 个 mode 列 = 24，单位：矩阵格） |
| FR-035 | **约束型** | — | **核验点** | PhA-6（宪法原则 IX 逐条核对，21 条断言各能在 prompt / 模板中找到同语义原文）；PhE-8 |
| FR-036 | 实现型 | **C** | T068 / T069 / T070 / T071 / T072 / T073 / T074 / T075 / T078 | PhC-1；PhC-2（既有 20 个注入点零回归）；PhC-4（R-1 红灯在扩大后的 marker 面复跑） |
| FR-037 | **约束型** | — | **核验点** | PhE-8（新脚本 import 行逐行确认前缀为 `node:`） |
| FR-038 | **约束型** | — | **核验点** | PhA-1；PhE-8（强制 mode 清单须**派生**、禁写字面量） |
| FR-039 | **约束型** | — | **核验点** | PhE-8（人工逐条判读，须如实登记为人工核验而非机械执行） |
| FR-040 | **约束型** | — | **核验点** | PhC-2（SC-007：仓根 `AGENTS.md` / `CLAUDE.md` 净增量 = 0 bytes）；演示 D-7 步骤 (2)（换算式 32768 − 24316 = 8452 bytes + 计数集合与源码对照） |
| FR-041 | **约束型** | — | **核验点** | PhE-8（`grep -rnE 'plan §[0-9]'` 须为空） |
| FR-042 | 实现型 | **B** | T044 | PhB-3；PhB-4（外部判据判不出时按不成立走 fail-loud） |
| FR-043 | 实现型 | **B** | T047 | PhB-1（本卡只落矩阵对账半边；可达性半边随 F27x 移交，其缺席**不计未完成**） |
| FR-044 | 实现型 | **B** | T044 | PhB-3；PhB-4（首选降级到 prompt 口径并留痕，两口径皆不可得才判「未执行（缺席）」） |
| FR-045 | **约束型** | — | **核验点** | PhA-2；PhA-4（R-1 方向断言：记 `fail` 不记 `pass`）；PhE-8 |
| FR-046 | 实现型 | **B** | T060 | PhB-3 |
| FR-047 | 实现型 | **B** | T060 | PhB-3 |
| FR-048 | 实现型 | **E** | **T104** | PhE-6（再生链：两个分发目录的 diff 只含 T102 现取的受影响集 S）；**与 FR-051 冲突时 FR-051 优先** |
| FR-049 | **约束型** | — | **核验点** | PhE-8（`orchestration.yaml` diff 为空 + SKILL 无新增暂停点 + `BLOCKED` 无「批准继续」选项） |
| FR-050 | **约束型** | — | **核验点** | PhE-1 ~ PhE-5（SC-011 换算式 5 ÷ 5 = 100%，归因记录为必附产物） |
| FR-051 | **约束型** | — | **核验点** | PhE-7（先证 oracle 取得成功再判 `A ∩ B = ∅`；取不到判「未执行（缺席）」） |
| FR-052 | 实现型 | **A** | T002 / T004 / T005 / T006 / T007 / T008 / T009 / T010 / T011 / T030 / T031 / T032 / T033 | PhA-1（`gate-mounting:effective-config` 12 条）；PhA-2（负向断言单测，被拒时 diagnostic 级别 ≥ `error`） |
| FR-053 | 实现型 | **A** | T012 / T013 / T022 / T023 / T024 / T031 / T033 | PhA-1；PhA-3（红灯构造是该守护项存在的唯一理由） |
| FR-054 | 实现型 | **B** | T042 / T048 / T049 / T052 / T061 | PhB-5（三份模板 `diff` 两两为空）；PhB-6（状态词表残留全扫） |
| FR-055 | 实现型 | **B** | T048 / T049 / T050 / T052 / T061 | PhB-5；PhB-6（旧 → 新映射表须逐条覆盖 5 个旧取值，缺任一即判未完成） |
| FR-056 | 实现型 | **B** | T051 / T059 | PhB-3 |
| FR-057 | 实现型 | **B** | T045 | PhB-6（按当次 `grep` 输出重算命中行，不照抄基线 11） |
| FR-058 | 实现型 | **B** | T046 | PhB-5（只在 `verification-report` 输出 PASS / FAIL，**不回填** `spec.md` / `plan.md`） |
| FR-059 | 实现型 | **B** | T046 / T052 / T061 | PhB-5；PhE-8（7 种不通过态 + 未列举的新状态一律归入不通过侧） |
| FR-060 | 实现型 | **B** | T053 / T054 / T055 / T056 / T057 | PhB-3（射程以 T053 裁定为准：实测 `GATE_TASKS` 挂载 7 个 mode、`fix` 零挂载） |
| FR-061 | 实现型 | **B** | T046 | PhB-5（SC-013 双口径：M ÷ 8 ≥ 7 ÷ 8 **且** F ÷ 64 ≥ 61 ÷ 64，两式须同时成立） |
| FR-062 | 实现型 | **B** | T047 / T062 | PhB-1；演示 D-1（无命令与原始输出者按 FR-005 计「未执行（缺席）」） |
| FR-063 | 实现型 | **B** | T044 | PhB-3（记「缺席」而无后果判定 = 不合格） |
| FR-064 | 实现型 | **D** | T096 / T099 | PhD-2；演示 D-2（裁定 D-① 已择 (b)：不补漏报率测量，诚实登记强度上限） |
| FR-065 | 实现型 | **D** | T097 / T101 | PhD-3（射程含 `agents/plan.md`，去重文件数由 10 改为 **11**，见 T079 裁定） |
| FR-066 | 实现型 | **D** | T092 | PhD-3；演示 D-8（命令与陈述不是同一命题的条目按「无法判定」计） |
| FR-067 | **约束型** | — | **核验点** | PhE-8（4 个新章节不入 `required_sections`；两条残余登记须在场） |
| FR-068 | 实现型 | **A** | T010 / T011 / T025 / T026 / T027 / T028 / T029 / T032 / T033 | PhA-1（新 check id `agent-docs:shared-section:orchestrator-gate-mounting-guard`）；PhA-4（R-1 红灯在扩大后的 marker 面复跑） |

> **本表的四类「不生成任务」行，理由分列（不得混为一谈）**：
> - **约束型 13 条**（认领 Phase = `—`）：见 §约束型 FR 核验点，核验而不实现。
> - **移交 4 条**（FR-010 ~ FR-013）：见 §移交 F27x，未完成态、非裁剪。
> - **裁剪 1 条**（FR-024，`[可选]`）：见 plan §裁剪登记 第 1 条，本卡唯一裁剪项，不占 FR-060 的 K = 3 MUST 预算。
> - 其余 **50 条**实现型且留本卡的 FR，每条至少一个 Task ID（`Task ID(s)` 列不得留 `待填` 进入验收）。

**本表换算式（三式，两个计数单位分列，不得相加）**

- **式 A · 有 Task ID 的实现型行数（单位：FR 条）**
  各 Phase 认领和 = A **5**（FR-015 / FR-017 / FR-052 / FR-053 / FR-068）+ B **26**（FR-001 ~ 007 共 7 + FR-026 ~ 029 共 4 + FR-042 ~ 044 共 3 + FR-046 ~ 047 共 2 + FR-054 ~ 058 共 5 + FR-059 ~ 061 共 3 + FR-062 ~ 063 共 2）+ C **4**（FR-014 / FR-018 / FR-019 / FR-036）+ D **14**（FR-008 ~ 009 共 2 + FR-020 ~ 023 共 4 + FR-030 ~ 034 共 5 + FR-064 ~ 066 共 3）+ E **1**（FR-048）= **50**
  与 plan §换算式 式 2 的各 Phase 认领和**逐字一致**；本表实际填出 Task ID 的行数须实测为 50，可用 `grep -cE '^\| FR-[0-9]{3} \| 实现型' specs/277-spec-driver-engine-hardening/tasks.md` 与减去移交 4 行后核对。
- **式 B · 实现型 FR 的去向核对（单位：FR 条）**
  认领 **50** + 裁剪 **1**（FR-024）= **51** = `N₁`（plan §换算式 式 1 的实现型且留本卡的 FR 总数）。**移交 4 条不进本式两侧**——移交是**未完成态、不是裁剪**（spec §分批与移交 · 用户 Q6 硬约束），它们由式 1 的 `N₃ = 4` 单独承载。
- **式 C · 全表分母核对（单位：FR 条）**
  `N₁` **51** + `N₂` **13**（约束型）+ `N₃` **4**（移交）= **68** = SC-002 的 `N` 实跑值（重算命令 `grep -c '^- \*\*FR-0' specs/277-spec-driver-engine-hardening/spec.md`，plan 侧 2026-09-04 实跑输出 68）。**验收时须重跑该命令而非照抄 68**——SC-002 的分母口径明写「验收时现取」。

> **一处口径提醒（不得混为一谈）**：式 A 的 50 是**「有 Task ID 的 FR 行数」**（单位：FR 条），不是**「认领这些 FR 的任务条数」**（单位：任务）——后者见 §换算式 式 1 的 `T_total = 126`。同一条 FR 可被多条任务认领（如 FR-052 有 13 条、FR-017 有 10 条），同一条任务也可认领多条 FR（如 T033 尾标 5 条），二者是多对多映射，**两个量不得互相冒充、也不得相加**。

---

## 依赖与并行说明

### 一、Phase 间依赖：严格线性 `A → B → C → D → E`，**无 Phase 级并行**

plan §分 Phase 实现方案 引言已裁定该顺序，**这条顺序是执行约束本身、不是排版顺序**。逐条依赖理由（抄自 plan，不自行重述）：

| 依赖对 | 理由 |
|---|---|
| **`[CLEANUP] C1` ≺ A** | `orchestration-resolver.mjs` 实测 534 行 / 主函数 `resolveOrchestrationConfig` 跨 `:187` ~ `:519` = **333 行** > 200，触发 plan `[CLEANUP] C1` 规则 (ii)。FR-052 (丙) 的挂载校验要插进该主函数的步骤 8 与返回之间，**在 333 行的函数里加校验无法独立测试** |
| **A ≺ B** | Phase B 要求 plan / tasks 子代理**逐节 `Edit`** 并跑命令取计数，其物理前置由 FR-015（三份 agent 增列 `Edit` / `Bash`）提供。**A 不落地时 B 的做法在物理上不可执行**，不是「慢一点」而是「做不到」 |
| **`[CLEANUP] C2` ≺ B** | `plan-template.md`（104 vs 134）与 `tasks-template.md`（251 vs 266）两对副本漂移未收敛时，Phase B 的 4 个新章节会落进**已经分叉的两份文件**，收敛动作与新增动作混在一次 diff 里无法分辨 |
| **B ≺ C** | Phase C 的输出协议要写「先落盘骨架、再逐节 `Edit` 填充**哪些节**」——章节结构在 Phase B 定稿后才知道 |
| **A ≺ C** | R-1 的兜底外壳（`validateSharedAgentDocsSafely`）必须先在位：Phase C 正是把 marker 分布面从「仓根 2 个必然存在的文件」扩到「4 份 agent + 多份 SKILL 目标」的那次改动，**外壳缺席时任一 marker 缺失会以未捕获异常栈的形态吞掉整轮 `repo:check` 结论** |
| **C ≺ D** | Phase D 的三纪律散文写进 Phase C 建成的**块 1**，该文件必须已存在且已接入 `sectionConfigs` |
| **B ≺ D** | FR-066 的「命令与陈述同一命题」判据写进 Phase B 建成的「推断前提登记」章节 |
| **A ~ D ≺ E** | Phase E 是回归护栏 + 再生 + 验收演示，**不新增落点**；其再生链的输入是前四个 Phase 改过的 SKILL 源 |

**关于「哪些可交叉」的诚实口径**：在**任务粒度**上确有若干跨 Phase 文件集不相交的对（例如 Phase C 的块 1 新建 T068 与 Phase B 的模板收敛 T034 / T036 分别改 `plugins/spec-driver/templates/agent-output-discipline.md` 与两份 `plan-template.md` / `tasks-template.md`，无写冲突也无读后写依赖）。**但当前裁定下这些交叉点一律不启用**——Phase 线性是 plan 已落定的执行约束，任务粒度的「理论上可并行」不构成放宽它的依据；本段登记它们只是为了让「为什么不并行」有据可查，**不是给执行者的许可**。若编排器后续另行裁定放宽 Phase 线性，须先重跑 A ≺ B 与 A ≺ C 两条**物理前置**依赖的判定（这两条不是排期偏好，放宽即等于让后续 Phase 在物理上做不到）。

### 二、两个 `[CLEANUP]` 硬前置与「先拆后加校验」的零行为验证顺序

- **`[CLEANUP] C1` ≺ Phase A 的全部实现任务**，执行顺序**不可颠倒**：**T001（拆分前基线取证）→ T002（拆分）→ T003（拆分后零行为验证）→ T007（在拆出的 `validateGateMounting()` 里填逻辑）**。T002 只落**空壳与调用位**、逻辑留给 T007，就是为了让 T003 的等价性判定有一个「只动结构、不动行为」的干净对照面。**T003 的判据是 `git diff --stat -- plugins/spec-driver/tests/orchestration-resolver.test.mjs` 输出为空**——既有用例改了一条即说明拆分改变了行为，须**回退 T002 重拆**，不得改测试迁就拆法。
- **`[CLEANUP] C2` ≺ Phase B 的全部模板任务**：T034（对 1 追平）/ T035（对 1 的散文两项）/ T036（对 2 逐块判定收敛）三条必须先于 T037（4 个新章节落入两份 `plan-template.md`）与 T058。**T036 的纪律是「逐块判定、不无差别覆盖」**：属 canonical 新增的补入项目副本，属项目侧本地定制的保留并在 `agents/tasks.md` 留痕。

### 三、Phase 内并行机会：`[P]` 的判定口径与全清单

**`[P]` 判定三条件（须同时成立）**：(i) 与同批其他 `[P]` 任务的**文件集不相交**；(ii) 无**写冲突**（不同时写同一文件的同一区域）；(iii) 无**读后写依赖**（不读取同批另一条任务尚未产出的内容）。**不满足任一条即不标 `[P]`**——本卡已有「并发双 vitest 写坏快照」的实证，把不满足条件的任务标成并行的代价是产出被静默污染而不是报错。

| Phase | `[P]` 条数 | 清单 | 并行理由 |
|---|---|---|---|
| **A** | **9** | T004 / T012 / T014 / T017 / T018 / T019 / T020 / T027 / T028 | 三组互不相交：三份新建测试文件（T004 / T012 / T014 / T020）各写各的；三份 agent frontmatter（T017 ~ T019）改三个不同文件的第 3 行；两组 SKILL marker（T027 新建小节 / T028 已有小节）改的 5 份 SKILL 互不重叠 |
| **B** | **3** | T054 / T055 / T056 | 三份 SKILL（`resume` / `sync` / `doc`）各新建一个同名小节，文件集不相交 |
| **C** | **4** | T068 / T070 / T071 / T072 | 块 1 新建与三组 marker 注入分别落在不同文件 |
| **D** | **4** | T081 / T087 / T091 / T093 | 四组文件集互不相交的**组首**任务（`GATE_DESIGN` SKILL 组 / 块 1 组 / `agents/verify.md` 组 / `agents/tasks.md` 组）；**组内**任务改同一文件必须串行 |
| **E** | **5** | T113 / T114 / T115 / T118 / T119 | 三条纯归档（D-1 / D-2 / D-3）各写各的产物文件；两条只读全量扫描（D-6 / D-7）扫描对象互不相交 |

**换算式：`[P]` 总数 = 9 + 3 + 4 + 4 + 5 = 25**（单位：任务）；可并行比例 = 25 ÷ 126 = **19.8%**（单位：任务）。

### 四、四处强制串行点（违反即结论无效）

1. **K14 断言清单的「先证必红、再证同步正确」两步**：**T023（未更新前跑，断言其红且显示 `added` 长度）→ T024（更新为 13 项）→ T078（Phase C 落地另 2 个 entry 后复跑，终值须为 13）**。Phase A 实跑得 **11** 属预期（换算式：Phase A 只落 3 个 check id，8 + 3 = 11），**11 ≠ 13 不判 P-9 FAIL**；**两次输出都要留痕**。`tests/fixtures/spec-drift/repo-check/repo-check-baseline.json` **`[禁改]`**——以「同步基线」为名更新它即为把守护项自身关掉。
2. **R-1 红灯构造在 Phase A / Phase C 各跑一次，不可只跑一次**：T020 / T029（Phase A，marker 面 = 仓根 2 个文件 + 5 份 SKILL）与 T075（Phase C，marker 面扩大后）。**两次的 marker 分布面不同，前一次通过不蕴含后一次通过**；两次的「其余 N 个 check 结论完整」中的 N **一律以当次实跑输出为准**，plan 记的 90 / 92 两个对照数**不得照抄**。T075 复验后**必须还原 marker** 并重跑 `npm run docs:sync:agents` + `git diff --exit-code` 确认零残留。
3. **Phase E 验证点 4（`repo:check`）必须排在验证点 6（`repo:sync` 再生）之后**：即 **T104 ≺ T106 ≺ T110**。`spec-driver-wrappers:{codex-wrapper-markers, codex-plugin-distribution-markers, codex-wrapper-runtime-namespace}` 3 项在再生前**必 `fail`**（文案指向「source 已变更但 wrapper 未重生成」），此时得到的红**不是回归**——把它当回归修会去改 wrapper 侧的机器再生产物，而该链路是**单向再生、手改无效**。
4. **FR-051 的 disjoint 判定须在再生前后各取一次**：**T103 ≺ T104 ≺ T105**。前置取证避免把 F276 已认领的文件先改脏（FR-051 要求「一旦发现需要修改对方文件必须**立即停止**」，事后发现时改动已经发生）；终判覆盖再生产物本身可能新落进对方认领集的情形。**两次都必须先证 oracle 取得成功再判交集**。

### 五、三处原子组（**不是并行机会**）

两条模板分发链 `plugins/spec-driver/scripts/init-project.sh:98-118` 与 `src/utils/specify-template-sync.ts:76-90` 均为 **copy-if-absent**（K13 已实测），只改一侧会落进两种失效形态之一——**canonical 永不追平**（只改项目副本）或**已初始化项目永远拿不到**（只改 canonical）。故以下三组的副本必须**同批修改并以 `diff` 收口**，组内**不得标 `[P]`**：

| 组 | 份数 | 落点 | 收口判据 |
|---|---|---|---|
| `plan-template.md` | **2** | canonical `plugins/spec-driver/templates/specify-base/plan-template.md` + 项目副本 `.specify/templates/plan-template.md` | T034 / T037：`diff <(grep '^## ' A) <(grep '^## ' B)` **零输出** |
| `tasks-template.md` | **2** | 同上目录的 `tasks-template.md` 两份 | T036 / T058：收敛后 `diff` 只剩**已留痕**的项目侧定制块 |
| `verification-report-template.md` | **3** | `plugins/spec-driver/templates/` + `plugins/spec-driver/templates/specify-base/`（**canonical**）+ `.specify/templates/` | T052：迁移前三份 `diff -q` 两两无输出（逐字节相同），**交付后须重跑同一组 `diff` 仍为空** |

换算式：原子组落点文件数 = 2 + 2 + 3 = **7**（单位：模板文件）；**三份 `verification-report-template.md` 都在生效路径上，一份都不能漏**。

### 六、推荐实现策略：**Incremental 逐 Phase 交付**

- **不适用 MVP First**：Phase A 是**全链物理前置**（FR-015 不落地则 B ~ E 的做法在物理上不可执行），切不出可独立交付的 MVP；把 A 之外的任何 Phase 单独交付都会得到一个「写了但没人能按它执行」的产物。
- **不适用 Parallel Team**：Phase 间严格线性（见本节一），且本卡与 F276 已在**卡级**并行（FR-051 强制），再叠一层卡内并行只会放大满载假红面而不缩短关键路径。
- **采用 Incremental**：按 A → B → C → D → E 逐 Phase 交付，**每个 Phase 以其收口全量跑任务结束**（T033 / T061 ~ T062 / T078 / T101 / T112），收口失败按 FR-050 三条件归因，未归因一律计失败再进下一 Phase。

---

## 换算式

> **本节纪律**：逐式标注计数单位；**不同单位的量不得相加**；每个结果数字都必须同处给出产生它的换算式（FR-031）。**式 1 的形式已按实际结构更正一处**——占位骨架写的是 `T_total = T_A + … + T_E + T_cleanup`，但 6 条 `[CLEANUP]` 任务（T001 ~ T003 / T034 ~ T036）**本就分别计在 `T_A` 与 `T_B` 之内**，再加 `T_cleanup` 会重复计数；式 1 因此取五项和，`[CLEANUP]` 单独由式 4 给出、**不进式 1 的加法**。

**式 1 · 任务总数（单位：任务）**

```
T_total = T_A + T_B + T_C + T_D + T_E
        = 33   + 29   + 16   + 23   + 25
        = 126                    （任务编号连续区间 T001 ~ T126，无空号、无重号）
```

`[CLEANUP]` **不作为第六个加项**：其 6 条已含在 `T_A = 33`（3 条：T001 / T002 / T003）与 `T_B = 29`（3 条：T034 / T035 / T036）之内。核对命令：`grep -cE '^- \[ \] T[0-9]{3} ' specs/277-spec-driver-engine-hardening/tasks.md` 应输出 **126**。

**式 2 · 各 Phase 任务数（单位：任务）**

| Phase | 任务数 | 区间 | 内部换算式 |
|---|---|---|---|
| **A** | **33** | T001 ~ T033 | `[CLEANUP]` 3 + 测试与红灯取证 9 + 实现 16 + 核对与验证 5 = 33 |
| **B** | **29** | T034 ~ T062 | `[CLEANUP]` 3 + 散文与模板实现 21 + 裁定 1 + 核对与验证 4 = 29 |
| **C** | **16** | T063 ~ T078 | 实现 10 + 验证与核对 5 + 登记 1 = 16 |
| **D** | **23** | T079 ~ T101 | 裁定 2 + 实现 16 + 登记 1 + 验证与核对 4 = 23 |
| **E** | **25** | T102 ~ T126 | 裁定 1 + 再生链与文件集护栏 4 + 回归护栏 5 + 护栏汇总 1 + 验收演示 8 + 时序悖论处置 1 + 编排器亲自执行核对 1 + 约束型三取值在场核对 1 + 交付收尾 3 = 25 |
| **合计** | **126** | T001 ~ T126 | 33 + 29 + 16 + 23 + 25 = 126 |

**式 3 · 可并行比例（单位：任务）**

```
[P] 标记数 ÷ T_total = (A 9 + B 3 + C 4 + D 4 + E 5) ÷ 126
                     = 25 ÷ 126
                     = 19.8%
```

分子的 25 条逐条列举见 §依赖与并行说明 三；**该比例是「被判定为可并行的任务占比」，不是「实际并行执行的任务占比」**——Phase 间严格线性使跨 Phase 的 `[P]` 永不同时在跑，两个量不得互相冒充。

**式 4 · `[CLEANUP]` 任务数（单位：任务）**

```
C1（orchestration-resolver.mjs 拆分：534 行 / 主函数 333 行 → 5 个可独立测试的子函数）  3 条（T001 / T002 / T003）
C2（两对模板副本收敛：plan-template 104 vs 134、tasks-template 251 vs 266）           3 条（T034 / T035 / T036）
合计 = 3 + 3 = 6
```

**C3 不计入本式**：plan 裁定 C-③ 已判「由实现方案本身吸收，不另立清理任务」——Phase C 的 template + `sync-agent-docs.mjs` 注入正是 C3 原本要做的抽取；其残余（`spec-driver-feature/SKILL.md` 注入后约 870 行 `[推断]`，仍是文件总 LOC 口径下的首个击穿点）由 plan 登记，本卡不压缩。**另一个计数单位分列**：C2 涉及的**落点文件**为 2 对 × 2 副本 = **4**（单位：模板文件），与本式的 3 条任务**不是同一个量**。

**式 5 · 裁定任务数（单位：任务）**

```
T053（FR-005 冻结散文的 SKILL 集，5 vs 7 之争）
T079（Phase D 落点表计数单位分列 12 行 vs 10 文件，连带 FR-065 是否含 agents/plan.md）
T080（GATE_DESIGN 收敛循环散文的落点形态：4 份手写 vs 第 4 个共享块）
T102（再生产物计数现取，统一 8 / 10 / 16 三处口径）
合计 = 4
```

四条的共同纪律是**不得静默择一**：产出必须是一段裁定文本落进 plan §修订记录，并同步更正被推翻的那一处。**T080 已由编排器裁定走共享块路线**，其连带四个量（SC-006 分母 26 → **27**、`repo:check` check id 总数 93 → **94**、plan §Project Structure 直接修改文件数 35 → **36**、SC-008 手写副本分母不变——marker 块不计手写）已按裁定值写入 Phase E 验证点 4 与 T110。

**式 6 · 实现型 FR 覆盖核对（单位：FR 条，与 plan §换算式 式 2 同源，须逐字一致）**

```
各 Phase 认领和 = A 5 + B 26 + C 4 + D 14 + E 1 = 50
裁剪           = 1（FR-024，[可选]，plan §裁剪登记 第 1 条）
核对式：认领 50 + 裁剪 1 = 51 = N₁  ✅
```

**移交 4 条（FR-010 ~ FR-013）不进本式两侧**——移交是**未完成态、不是裁剪**（spec §分批与移交 · 用户 Q6 硬约束）。

**式 7 · 全表分母核对（单位：FR 条）**

```
N₁ 51（实现型且留本卡）+ N₂ 13（约束型）+ N₃ 4（移交）= 68 = SC-002 的 N 实跑值  ✅
```

重算命令 `grep -c '^- \*\*FR-0' specs/277-spec-driver-engine-hardening/spec.md`，plan 侧 2026-09-04 实跑输出 **68**；**验收时须重跑该命令而非照抄 68**（SC-002 的分母口径明写「验收时现取」）。

**式 8 · 验收演示的两个量分列（单位：演示条）**

```
演示总数                                    = 8（D-1 ~ D-8）
其中执行体在 Phase E 的                     = 5（D-4 ~ D-8；D-1 / D-2 / D-3 分别由 T062 / T099 / T098 执行，Phase E 只汇总归档）
受时序悖论影响、只能在 implement 后回跑的  = 5（D-4 / D-5 / D-6 / D-7 / D-8），5 ÷ 8 = 62.5%
本卡内「期望输出已经 F270 原文核对」的外部对照 = 2（D-1 + D-3），2 ÷ 8 = 25.0%；上界仍为 3 ÷ 8 = 37.5%
机械执行数下界                              = 0
```

**四个量互不冒充**：「执行体在 Phase E 的 5 条」与「受时序悖论影响的 5 条」数值相同但集合不同（前者 = D-4 ~ D-8，后者 = D-4 / D-5 / D-6 / D-7 / D-8——本卡中二者恰好重合，**但重合是巧合不是恒等**，D-1 / D-2 / D-3 若被推迟执行前者会变而后者不变）；「已核对的外部对照 2」与「上界 3」不得互相冒充；**机械执行数下界 = 0** 意味着「8 个演示全部为人工推演」是一个**可能且合规的终态**，凡声称某项「已机械执行」而未同处给出该次执行的命令与原始输出，即为 over-claim。

**式 9 · 单位对照表（防止跨单位相加）**

| 单位 | 本文件中出现的量 |
|---|---|
| **任务** | T_total 126；各 Phase 33 / 29 / 16 / 23 / 25；`[P]` 25；`[CLEANUP]` 6；裁定 4 |
| **FR 条** | N 68；N₁ 51（认领 50 + 裁剪 1）；N₂ 13；N₃ 4；各 Phase 认领 5 / 26 / 4 / 14 / 1 |
| **check id** | 交付后 `repo:check` 总数 94（= 88 + 6）；SC-006 分母 27（= 既有相关 21 + 新增 6）；K14 断言清单终值 14（= 8 + 6，已含裁定 D-③ 的第 4 个 shared-section；Phase A 中间值 11、Phase C 中间值 13，三值分属三时点） |
| **断言** | `agent-tools:required` 8；`gate-mounting:effective-config` 12；resolver 挂载校验 1；宪法原则 IX 核对面 21（= 8 + 12 + 1） |
| **演示条** | 8 / 5 / 2 / 3 / 0（见式 8） |
| **模板文件** | 原子组落点 7（= 2 + 2 + 3）；`[CLEANUP] C2` 落点 4 |
| **wrapper 文件** | 再生产物 ∈ [16, 18]（= 受影响 SKILL 数 × 2 个分发目录，由 T102 现取） |
| **观察次** | D-5 (b)(c) 的 ≥ 3 次独立观察，达成判据 3 ÷ 3 = 100% |
| **矩阵格** | FR-034 的 24（= 3 行 × 8 个 mode 列） |
| **命令条** | SC-011 的 5（五条回归护栏） |
| **反馈条** | dogfooding 落账 5（T124） |

> ✅ **一处跨式提醒 —— 已同步（2026-09-04，`GATE_TASKS` 冻结前的卫生修正，留痕）**：**K14 断言清单的终值早前写 13，与 `repo:check` 总数的 94 不同源**。旧换算式是「既有 8 + 本卡新增 5 = 13」，其中「新增 5」是 T080 裁定**之前**的口径（3 个 `agent-docs:shared-section:*` + `agent-tools:required` + `gate-mounting:effective-config`）；plan 裁定 **D-③** 走共享块 4 后 `agent-docs:shared-section:*` 由 3 增为 **4**，新增 check id 由 5 增为 **6**，故终值 = **8 + 6 = 14**（单位：check id），与 94（= 88 + 6）同源。
>
> **已完成的处置**：**T023 / T024 / T078 三处写死的 13 已原地改为 14 并各自补上换算式与单位**——本次改写发生在 `GATE_TASKS` **冻结之前**，按 spec §修订记录 修改规则 1「冻结前允许原地修改 + 记录并存」执行，Edge Case 18 (ii) 的「只允许追加」自冻结哈希落定后才生效，二者不冲突。**分段取值口径（三个值分属三个时点，不得互相冒充）**：Phase A 实跑 **11**（8 + 3）、Phase C 收口 **13**（8 + 3 + 2）、Phase D 第 4 个 entry 落地后终值 **14**（8 + 6）；**得 13 而非 14 只说明第 4 个 `sectionConfigs` entry 未落地**，须回到 T080 的 entry 定义核对，不判回归。
>
> ⚠️ **本条残余 2 处（本轮按「只改点名三处」的指令未动，须在 implement 期一并消账；单位：出现处）**：**(i)** 上方 **式 9 单位对照表** 的 `check id` 行仍按旧口径写「K14 断言清单 13（= 8 + 5）」，消账时改为 **14（= 8 + 6）** 并删去其「该式不含 T080 裁定新增的第 4 个 shared-section」的例外注；**(ii)** **§Phase A 验证点 第 7 条**（`:45`）写「(a) 断言红且 `added` 长度为 **13**；(b) 更新为 **13** 项后复跑断言绿。换算式：8 + 5 = 13」——**两个数都错且错法不同**：(a) 处 Phase A 的实跑值是 **11**（8 + 3），(b) 处的清单终值是 **14**（8 + 6），消账时须按上一段的分段取值口径分别改为 11 与 14，**不得把两处填成同一个数**。
