# Implementation Notes — 277 Spec Driver 引擎正确性加固

> 本文件**覆盖写**，非追加：恢复方要的是当前状态，不是流水账。

## 当前 Phase

**Phase D 完成 · B + D 对抗修订 · commit ② 前**（Phase 序列 A → C → B → D → E；A、C 已入库 commit ① `4255212c`；B（T034–T062）与 D（T079–T101）全部落盘并由编排器收口全绿：check id 94、vitest 8179 passed）。

## 已完成任务 ID

`T001–T033`（Phase A，commit ①）、`T063–T078`（Phase C，commit ①）、`T079–T086`（Phase D 段 D-a，见 `verification/phaseD-a-summary.md`）、`T087–T097`（Phase D 段 D-b，见 `verification/phaseD-b-summary.md`）、`T079–T101`（Phase D；D-a/D-b 由前台子代理完成，D-c 的 D-3/D-2/K14 由子代理完成后停摆，T100/T101 由编排器亲自核对与收口，见 `verification/phaseD-{a,b,c}-summary.md`）；`T034–T062`（Phase B；T034–T061 由编排器按验收命令逐条核实后勾选，见 tasks.md Phase B 段末留痕；T062 D-1 回放由独立子代理产出 `verification/d1-f270-matrix-replay.md`，428 行，**通过**：捕获 4 ÷ 4、误报 0 ÷ 5、与 `daf03560` 的「13 达成」口径冲突成立；附带发现 F270 §8 事后补登非全集 12 vs 8、FR-029 属实现态回退非未认领、plan Constitution Check 以未认领 FR-031 背书原则 XI）。

## 下一步

**Phase D 段 D-c · T098–T101**（D-3 收敛轨迹回放 + D-2 承诺任务化演示 + FR-034 逐格核对 + 收口全量）。**段 D-a（T079–T086）与段 D-b（T087–T097）均已完成**：块 4 `gate-design-convergence-loop` 已建成并注入 4 份 SKILL；块 1 `## 轻量三纪律` 已填充（FR-030 ~ FR-034）并重注入 4 份 agent，二跑逐字节幂等；`agents/verify.md` 已落 FR-033 / FR-066；`agents/tasks.md` 已落 FR-008 / FR-009 / FR-064；FR-065 三项约束已写入 4 份 SKILL 与 `agents/plan.md`。`repo:check` **94** 项、exit=0，非 pass 仅 `graph-quality:freshness: warn`（既有 stale 图）。

**⚠️ D-c 的 T101 必办（红灯为预期，不是回归）**：`tests/integration/spec-drift-repo-check-regression.test.ts:150` 的 `added` 清单仍是 **13**（该行留有「Phase D 落地后在此追加」注释），块 4 已落地、磁盘侧 check id 已达 **14**，故该断言**当前必红**，须按**裁定 I-1** 更新为 **14**（新项位次在既有 3 个 `shared-section` 之后、`spec-driver-wrappers:*` 之前）后再串行跑 `npm run build` → `npm run test:plugins` → `npx vitest run` → `npm run repo:check`。commit ② = B + D（对抗审查后）。

## 已知偏差

按发现顺序编号；每条都写「偏差事实 / 依据 / 本段的处置」。

### D-B1 · Phase B 两位实现子代理先后停摆（600 s watchdog），零勾选、无 summary

- **事实**：第一位在 T059 前后停摆，13 个文件的编辑已落盘；第二位（续做）在写 D-1 产物前停摆，盘上零增量。
- **依据**：`git status` 与 tasks.md 勾选状态对照；两次 task-notification 均为 `Agent stalled: no progress for 600s`。
- **处置**：编排器按各任务验收命令逐条核实后勾选（证据见 tasks.md Phase B 段末留痕）；D-1 拆为独立小代理、先 Write 骨架；后续 Phase D 派发拆成 ≤ 3 段、每段要求首个动作即落盘。

按发现顺序编号；每条都写「偏差事实 / 依据 / 处置」。**D-1 ~ D-8 为 A1 段登记，原样保留**；**D-9 ~ D-15 为 A2 补录与 A3 新增，原样保留**（其中 D-11 / D-15 已由 Phase C 消账，标注见各条末尾）；**D-16 ~ D-19 为 Phase C 新增**；**D-20 ~ D-23 为第一轮（α）对抗修订新增**；**D-24 ~ D-31 为第二轮（β / δ）对抗修订新增**；**D-32 起为第三轮（delta 复验的 N-1 / N-2 / N-3）新增**。

### D-1 · T001 的验证命令在本仓跑不出被测用例（tasks.md 与仓内测试装置不符）

- **事实**：`npx vitest run plugins/spec-driver/tests/orchestration-resolver.test.mjs plugins/spec-driver/tests/orchestrator.test.mjs` 实跑输出 `No test files found, exiting with code 1`（退出码 1）。
- **依据**：`vitest.config` 的 include 只覆盖 `tests/**` 与 `src/**` 的 `*.test.ts`；`plugins/spec-driver/tests/*.test.mjs` 由 `npm run test:plugins`（`scripts/run-plugin-tests.mjs` → `node --test`）执行。
- **处置**：基线与复验改用 `node --test <两个文件>` + `npm run test:plugins`，两组命令与原始输出均已留痕。**未修改 tasks.md 的命令原文**。

### D-2 · T004 的「`applicable_modes` 仍可覆盖」与实测相反

- **事实**：`gateOverrideSchema` 是 `.strict()`，只声明 `default_behavior / severity / hard_gate_modes`；`applicable_modes` 在本卡改动**之前就已被拒绝**（`unrecognized_keys`），谈不上「仍可覆盖」。spec FR-053 亦明写「`applicable_modes` 根本不在 override schema 的可覆盖字段内」。
- **处置**：正向用例按 T004 的**意图**落地为两条可证伪断言——(a) `findForbiddenGateOverrides` 对它零命中；(b) schema 仍拒绝它、且拒绝理由 `code === 'unrecognized_keys'`（既有 `.strict()`），与本卡新增的禁改集**不得互相冒充**。`severity` 侧则按字面实现为「仍可覆盖」正向用例。

### D-3 · FR-052 落地打红 4 份既有 fixture + 1 份用户样例（K3 已预测，此处是逐份核对结论）

- **事实**：`GATE_DESIGN.default_behavior: auto` 被 4 份 fixture 与 1 份 user-facing 模板用作「gate 字段级合并」的载体；禁改集上线后 5 处全被 `error` 拒，连带 5 个既有用例红（T1-2 / T1-3 / T1-5 / T2-6 / T3-4）。
- **处置**：把**载体字段**由 `default_behavior` 换为 `severity`（明确不在禁改集内），gate 仍是 `GATE_DESIGN`，各用例的被测语义逐条不变。改动 4 份 fixture + 3 处断言字面量 + 1 份样例模板。
- **与 T006「既有用例一条不改」的关系**：该约束是为 `[CLEANUP] C1` **拆分**的零行为验证服务的，T003 已独立满足。此处改动由 T005 的**受控向后不兼容**（宪法 XIII 留痕项）触发，属预期变更。
- **连带**：`orchestration-overrides.example.yaml` 示例一由 `GATE_DESIGN.default_behavior: auto` 改为 `GATE_ANALYSIS.default_behavior: auto`；`orchestration-overrides-contract.yaml` 的 `gates.<GATE_ID>` 条目同步禁改集说明（K3 (iii)）。

### D-4 · 「攻击 override 下 `get-gate-behavior` 须输出 `mounted: false`」不成立

- **事实**：T007 落地后，resolver 在合并后即拒绝该覆盖并**回退 base**，effective 配置重新挂上 `GATE_DESIGN`。攻击 override 下的实跑输出是 `mounted: true / mounted_in_base: true`，同时 diagnostics 多一条 `error` 级 `orchestration-overrides.gate-mounting-lost`。
- **依据**：spec FR-052 明写「断言不成立 ⇒ 发 `error` 级 diagnostic 并回退 base」。回退后 effective == base，`mounted` 按定义为 `true`——这是诚实值，不是 fail-open。该场景下 FR-068 由条件 **(2)**（diagnostics 含 `error`）判 `BLOCKED`。
- **`mounted: false` 仍可达且已实证**：resolver 侧射程只含强制 mode `feature / story / implement`；对 `fix` 整段替换删掉 `GATE_DESIGN` 挂载时 resolver **不拒**，此时 effective 侧 `mounted=false` 而 `mounted_in_base=true` ⇒ FR-068 判 `BLOCKED`。

### D-5 · FR-053 验证点 3 的红灯预期在 T007 之后不可复现

- **事实**：该验证点成文于 resolver 侧拒绝落地之前。现在同一份攻击 overrides 走完整链路时，(i) 因回退 base 转**绿**，改由 (v) `diagnostics:feature` 抓红。
- **处置**：T012 分两层断言，都保留且都实证——(1) 把断言引擎拆为纯函数 `evaluateGateMountingAssertions(...)`，直接喂「feature 失去 GATE_DESIGN 挂载」的 effective 配置，断言**恰有 1 条红且 kind 为 `mounting`**；(2) 端到端 `validateGateMounting({ projectRoot })` 跑真攻击 fixture，断言守护项判 `fail` 且红的断言中含 `kind === 'diagnostics'`。
- **未改 spec.md / plan.md**；本条留待 verify 阶段按 FR-005 口径对账。

### D-6 · FR-037「新增脚本只允许 import `node:` 内置」与 FR-038「不得复刻编排事实源」的张力

- **事实**：`plugins/spec-driver/scripts/validate-gate-mounting.mjs` 除 `node:` 内置外，还 `import` 了**同仓第一方**的 `../contracts/orchestration-schema.mjs`。
- **依据**：若严格按字面只 import `node:` 内置，强制 mode 清单与挂载判定就只能在本文件里**重写一份**，直接撞上 C-2 与 FR-038 的「禁写字面量」（F259 反模式）。
- **处置**：取 FR-037 的可执行内核「**零 npm 依赖**」；事实源全部经 `orchestrator-cli.mjs` 的真实输出面现取。如实登记该读法，交 verify 阶段裁定。

### D-7 · 既有缺口（本卡不修，钉成可见事实）

- `orchestrator-fallback.mjs` 的 `implement` 段不挂载 `GATE_DESIGN`（base 挂载它）。裁定 A-② 第 4 条登记本卡不补齐；T008 新增一条断言把它钉死为**可见事实**。
- `orchestrator-cli.mjs` 的 `get-phases` 输出**不含** `gates_before` / `gates_after`，故「用 `get-phases` 判门是否挂载」恒得空集，**不能作为攻击成立的证据**。本卡不改该输出面。
- `repo:check` 的 `graph-quality:freshness` 为 `warn`（图 sourceCommit `64b1d72f` ≠ HEAD `e01611b2`）——**本卡改动之前即存在**。A3 段收口复跑仍为该值，与本卡无关。

### D-8 · `generate-template` 输出的数字 id 未加引号（既有 bug，不在射程）

- **事实**：`generate-template feature` 输出的 `id: 0.5 / 3.5 / 5.5 / 6.5` 无引号，过不了自家 `phaseSchema`。
- **处置**：构造攻击 fixture 时自行加引号；fixture 头部注释已写明。不修该 bug。

---

### D-9 · A2 段（T014–T024）的留痕由编排器验证补录，两处红灯原始输出缺席

- **事实**：A2 段子代理在覆盖写 implementation-notes **之前**被中断，故 **T016 红灯取证**与 **T020 红灯构造**的原始输出未入本文件。经复核，代码与测试文件中**未留下**这两次红灯的原始输出（无临时日志、无注释内引用）。
- **诚实口径**：**红灯原始输出缺席，不补造**。以下是编排器在 A2 之后**独立实跑**的补录事实（2026-09-07），可作为「代码在盘且行为正确」的证据，但**不等价于**「先证必红」的原始留痕：
  - T014–T024 代码全部在盘：新建 `scripts/lib/agent-tools-core.mjs` / `tests/unit/agent-tools-core.test.ts` / `tests/unit/repo-check-agent-docs-fallback.test.ts`；三份 agent frontmatter 已含 `Edit` + `Bash`；`repo-maintenance-core.mjs` 接线两族 + `validateSharedAgentDocsSafely`；`namespace-consistency-core.mjs` 仅把 `extractFrontmatterTools` 改为具名导出（零行为变化）。
  - 本卡 3 个插件测试文件 `node --test`：**106 ÷ 106 绿**。
  - `npm run repo:check`：check id **88 → 90**，`gate-mounting:effective-config` pass，`agent-tools:required` fail（红在第 8 条文本断言，Phase A 时点结构性必红）。
- **A3 补正一处计数**：编排器补录记「`tests/unit/agent-tools-core.test.ts` 24 条中 23 绿」，A3 收口实跑为 **21 tests | 1 failed**（即 20 绿 / 1 红）。差额来自该文件用参数化用例（`grep -cE '^\s*(it|test)\('` 为 16，展开后 21）。**以 21 为准**，24 是误记。

### D-10 · T025 模板刻意回避「暂停」二字，否则会自造 FR-049 的假阳性

- **事实**：FR-049 的核验命令之一是 `git diff -G'暂停' e01611b2...HEAD -- 'plugins/spec-driver/skills/*/SKILL.md'` **输出为空**（代理判据：无新增暂停点）。而 T025 要求的语义恰恰要谈「不得实现成暂停询问后继续」——按字面写进模板，注入 5 份 SKILL 后该命令必然非空，**一句禁止暂停的话会把禁止暂停的检查判红**。
- **处置**：模板改用等价且不触发代理判据的措辞——「不得提供『批准继续』『忽略并继续』『确认后继续』之类的任何放行选项」「本守卫不是一个可由用户当场放行的检查点」「不得新增任何需要用户拍板的中断点」。语义逐条保留，`暂停` / `AskUserQuestion` 两个字面量零出现。
- **实证**（A3 段实跑，三条均空）：
  ```
  git diff -G'AskUserQuestion' --stat -- 'plugins/spec-driver/skills/*/SKILL.md'   → 空
  git diff -G'暂停'            --stat -- 'plugins/spec-driver/skills/*/SKILL.md'   → 空
  git diff --stat -- plugins/spec-driver/config/orchestration.yaml                 → 空
  ```
- **登记性质**：这是**代理判据的已知副作用**，不是 FR-049 被规避。真实语义（无新增放行点）由模板正文承担并可人工复核。

### D-11 · 原则 IX 核对（T031）实测：**8 条**而非 1 条 agent-tools 断言的散文原文「待 C」

- **事实**：T031 的口径写「其中 agent-tools 第 (iii) 条的原文在 Phase C 才有——写「待 C」不判 VIOLATION」，即只给 **1** 条豁免。A3 段实跑核对发现——`plugins/spec-driver/agents/{specify,plan,tasks}.md` 在本卡内的改动**只有 frontmatter 一行**（`git diff` 逐份确认，新增行数各 1，全部是 `tools:` 行），三份文件正文对 `Edit` / `Bash` / 逐节编辑 / 复跑命令取输出**零散文**（`grep -nE 'Edit|Bash|逐节|实跑|原始输出|命令原文'` 除 frontmatter 外零命中）。故 (i) 的 6 条与 (ii) 的 1 条**同样没有当前可指的散文原文**，合计 **8 条全部「待 C」**。
- **不判 VIOLATION、不回退的依据**（三条，缺一不可）：
  1. **散文落点已物理指定、不是待定**：plan §FR → Phase 覆盖矩阵 `FR-014` 行明写落点为 `templates/agent-output-discipline.md`（单一事实源）→ 经 `sync-agent-docs.mjs` 注入 `agents/{implement,specify,plan,tasks}.md`；FR-030 / FR-034 / FR-018 / FR-019 四行同指该文件。`Edit`（骨架 + 逐节 Edit 协议）与 `Bash`（原样复跑检索命令取实际输出、`git show <sha>:<path>` 引用原文）的散文正是该块的内容。
  2. **(ii) 的短语契约逐字来自该块**：`agent-tools-core.mjs` 的 `PROTOCOL_VERIFY_DISCLOSURE_PHRASES` 含「不得为其新增任何工具项」等 6 条短语，比对对象就是块 1。
  3. **缺口不会进入任何提交**：裁定 I-2 已把 Phase C 提到 B 之前，裁定 I-3 又规定 commit ① = Phase A + C 同批提交。故「断言先于散文存在」的窗口只存在于**同一个未提交的工作树内**，落到 git 历史时二者同时在场。
- **交 verify 阶段的对账义务**：Phase C 收口时须复跑本条，确认 8 条断言逐条能在 `agent-output-discipline.md` 中找到同语义原文；找不到的那几条届时才判 VIOLATION。
- ✅ **Phase C 已消账（本段复跑结论）**：8 条全部找到同语义原文，**零 VIOLATION**。逐条落点见下方「T031 复跑 · A 组 8 条散文原文落点」表。原则 IX 由 `13 ÷ 21 = 61.9%` 升至 **`21 ÷ 21 = 100%`**（单位：断言条）。
- **B / C 两组（13 条）已全部有散文原文，无待办**：见下方「T031 · 21 条断言 ↔ 散文原文对照」。

### D-12 · T030 核对挖出合同真空：`modes.<mode>` 条目未写门挂载禁改（已就地补）

- **事实**：`orchestration-overrides-contract.yaml` 经 A2 段已同步禁改集**甲 / 乙**（`gates.<GATE_ID>` 三字段），但 **丙（挂载）没有任何落点**——`modes.<mode>` 条目的 `notes` 只讲整段替换语义与 `runtime_consumption_caveat`。后果：用户整段替换 `modes.feature` 且删掉挂门 phase 时，会拿到 `error` 级 `gate-mounting-lost` 并被**整份回退 base**，而他照着合同看不到任何一句说明这条约束存在。
- **依据**：T030 的射程明写含「**1 份**合同说明（`orchestration-overrides-contract.yaml`：禁改集须同步）」；丙是 FR-052 禁改集的三分之一，漏写即「同步」未完成。
- **处置**：在 `modes.<mode>` 的 `notes` 补 7 行——约束原文（强制 mode 的 effective 序列不得失去挂载 `GATE_DESIGN` / `GATE_TASKS`）、为什么 `gates` 块的禁改集对它失明、失败动作（`error` + 整份回退 base）、共用实现位置（`findLostGateMountings`）、正确做法。**零行为改动**，纯合同文本。YAML 结构复核：`python3 -c "import yaml; ..."` 解析 OK，`supported_overrides` 仍 3 条，`modes.<mode>` notes 含「门挂载禁改」= True。
- **连带收益**：这同时成为 resolver 侧那 1 条挂载断言在**用户可见合同**中的散文原文（原先只在 T025 模板内有）。

### D-13 · `repo:sync` 会顺带重刷与本卡无关的再生制品，已定向回退

- **事实**：5 份 SKILL 注入 marker 后必须跑 `npm run repo:sync` 再生 Codex wrapper（否则 `spec-driver-wrappers` 族因 body sha256 不匹配报 2 条 error）。但该命令同时重刷了 **19 份**与本卡无关的产物：`specs/products/**` 的 17 份 + `.specify/project-context.suggestions.{md,yaml}` 2 份。
- **归因**（逐份 `git diff` 核对，全部**不是**本卡 SKILL 改动的产物）：(a) 纯时间戳漂移（`Generated` / `generatedAt`）；(b) `spectra/_generated/entity.yaml` 的 `description` 追平到 4.5.0 发布文案（历史欠账）；(c) `adoption-report` 的 `spec-driver-fix` 计数 6 → 11，源自本机 `.specify/runs/`（本地运行态）；(d) `workflow-index` 的 `overrideDir` `null` → `.specify/workflows`（本机目录存在性）。
- **处置**：`git checkout -- specs/products .specify/project-context.suggestions.md .specify/project-context.suggestions.yaml` 定向回退，**只保留 10 份 wrapper**（`.codex/skills/*` 5 + `plugins/spec-driver/skills-codex/*` 5）。回退后 `repo:check` 91 项，无一项因此转红——证明这 19 份不受任何 check 守护，本就属「跑一次就变」的噪声面。
- **依据**：仓规「不要自行添加未要求的优化、功能、清理」+ 记忆项「并行 feature 须排除再生制品」。

### D-14 · 原则 X 复核结论：FR-068 的硬阻断**不**使编排核心在无第三方依赖时退化（含一处反直觉的实测）

- **风险假设**（T032 (a) 要核的那件事）：FR-068 把「`orchestrator-cli.mjs` 调用失败」由软降级升为硬阻断。若该 CLI 在缺 zod 的安装里跑不出 `mounted` / `mounted_in_base`，或其降级 diagnostic 是 `error` 级，则**每一个缺 zod 的安装都会被永久 `BLOCKED`**——那就是原则 X 明禁的「Harness 增强不可用时功能退化」。
- **实测**（把 `plugins/spec-driver` 整份复制到 `node_modules` 不可达的临时目录，实证 `import("zod")` 报 `ERR_MODULE_NOT_FOUND` 后再跑 CLI）：
  - `get-gate-behavior feature GATE_DESIGN` → **exit 0**，输出含 `"mounted": true, "mounted_in_base": true`；`GATE_TASKS` 同样两字段齐全。
  - `effective-orchestration feature --format json` 的 diagnostics = **`level: "warning"`** / `code: orchestration.zod-unavailable`（**不是 `error`**）。
  - ⇒ FR-068 条件 (2)（diagnostics 含 `error`）**不触发**，条件 (1)/(3) 的输入齐全。**结论：不退化**。
- **同批登记的诚实边界（新残余）**：缺 zod 时该降级路径**根本不应用项目级 overrides**（stderr 原文：「项目级 orchestration-overrides 在缺 zod 时不被应用」）。故此时 effective ≡ base，FR-068 的判据恒真——它在这种环境里是**非鉴别性的**。方向上这是 fail-safe（没有任何 override 能生效，也就没有任何 override 能删掉挂载），但**不得口径为「缺 zod 时本守卫仍在保护」**：它此时什么也没挡，只是没有东西需要挡。
- **T032 (b) 原则 XIII 留痕义务 (c)**：`ls -la .specify/orchestration-overrides.yaml` → `No such file or directory`（exit 1）。**本仓自身未覆盖 `GATE_DESIGN` / `GATE_TASKS` 任何字段**，T005 的禁改集落地不把本仓判红。与裁定 A-④ 实测一致。

### D-15 · Phase A 收口全量的预期红集合 = **7 条**（不是 8），且全部同一根因

- **事实**：编排器补录预告 8 条同根因红。A3 收口实跑为 **7 条**——差额 1 条正是 K14 断言，它已由本段按裁定 I-1 更新清单后**转绿**。
- **换算式**：`8（预告）− 1（K14 已转绿）= 7`，单位：失败用例。
- 7 条逐条归因见下方「T033 收口全量」表，**全部**指向同一个事实：`plugins/spec-driver/templates/agent-output-discipline.md`（Phase C 块 1）尚未创建 ⇒ `agent-tools:required` 第 8 条文本断言 fail ⇒ `validateRepository` 整体 `status: 'fail'` ⇒ 依赖「整体 pass/warn」或「exitCode 0」的下游用例连带红。
- **本段未出现**编排器记录过的另两条负载型 flake（F220 charter 快照幽灵键、`sync-worktree-local-state` W-001）——本次清净窗口串行跑未复现。
- ✅ **Phase C 已消账**：7 条**全部转绿**，Phase C 收口全量 `npx vitest run` 为 `Tests 8073 passed | 0 failed`，`npm run repo:check` 退出码 **0**。逐条对照见下方「Phase C 收口全量」表。

### D-16 · Phase C 提前于 Phase B 执行，导致 T054 ~ T056 的三个小节被本 Phase **提前新建**

- **事实**：T071 的原文是「在由 T054 ~ T056 建成的 `### GATE_TASKS 裁剪接受口径` 小节内各加一对 marker；**小节缺席时先回 T054 ~ T056 补建，不得就地新造**」。而裁定 I-2 把 Phase C 提到 Phase B 之前，T054 ~ T056（Phase B）此刻**尚未执行**，三个小节结构性缺席。
- **处置**：按编排器运行时上下文的显式授权，本 Phase 直接新建这三个小节（`spec-driver-{resume,sync,doc}/SKILL.md`），**锚点全部 `grep -n` 现取、未照抄 plan 行号快照**（现取值与快照逐条一致，见下方锚点表）。这与 T071 的禁令**不冲突**：该禁令禁的是「就地另造一个别的位置」，而三处锚点由 plan K11 处置 (b) 已定死，本段用的正是那三个位置。
- **对 Phase B 的连带（执行 T054 ~ T056 时必须先读本条）**：三个小节的**标题与位置已在盘**，Phase B **不得重复新建**，否则会产生同名重复小节并让 marker 落到第二份上。Phase B 在这三处的剩余动作只有一项：决定是否补该 mode 的 `GATE_TASKS` 完整处理流程散文。
- **残余原样保留（K11 连带口径 (iii)）**：`resume` / `sync` / `doc` 三个 mode 的 SKILL 内**仍然没有 `GATE_TASKS` 的完整处理流程散文**，新小节承载的只有裁剪接受口径这一段。凡口径为「三个 mode 的 `GATE_TASKS` 流程已补齐」即 over-claim。

### D-17 · 块 3 的措辞被 FR-049 代理判据反向约束（D-10 在 Phase C 的再现，且面更大）

- **事实**：FR-049 的代理判据之一是 `git diff -G'暂停' … -- 'plugins/spec-driver/skills/*/SKILL.md'` 输出为空。块 3 的**全部正文**都会被注入 7 份 SKILL，而它谈的恰恰是 `GATE_TASKS` 停下来展示裁剪清单这件事——按字面写「暂停」，一句描述既有门行为的话就会把「无新增暂停点」的检查判红。
- **与 D-10 的差别（面更大，不是同一处）**：D-10 只涉及块 2 的一两句；块 3 是**整块**围绕门停下时的交互展开，避让面覆盖全文 83 行。
- **处置**：全块改用等价且不触发代理判据的措辞——「门停下」「该门停下等待用户裁决」「这一次门内交互」「门不停时」「门没停下」。语义逐条保留，`暂停` / `AskUserQuestion` 两个字面量**零出现**（`grep -c` 均为 0）。
- **实证**（Phase C 收口实跑，三条均空）：见下方「其他核对 · FR-049 三条代理判据」。
- **登记性质**：同 D-10，这是**代理判据的已知副作用**，不是 FR-049 被规避。真实语义（不新增门、不增加门停下的次数、逐条接受在同一次交互内多选完成）由块 3 正文承担并可人工复核。

### D-18 · `repo:sync` 顺带重刷 19 份无关再生制品（D-13 完全再现，逐份计数一致）

- **事实**：7 份 SKILL 注入块 3 marker 后必须跑 `npm run repo:sync` 再生 Codex wrapper（否则 `spec-driver-wrappers` 族因 body sha256 不匹配报 **2 条 error**，本段实跑已复现该 2 条）。该命令同时重刷了 **19 份**与本卡无关的产物，与 D-13 的份数**逐份一致**：`specs/products/**` 17 份 + `.specify/project-context.suggestions.{md,yaml}` 2 份。
- **归因（抽样逐份核对，全部不是本卡 SKILL 改动的产物）**：(a) 纯时间戳漂移（`generatedAt: 2026-08-23T18:03:47 → 2026-09-07T03:24:44`）；(b) `adoption-report` 的 `spec-driver-fix` 计数 **6 → 11**，源自本机 `.specify/runs/`（本地运行态，非仓库事实）。
- **处置**：用 `git show HEAD:<path> > <path>` **定向回退 19 份**（**未用 `git checkout`**，避免误伤未跟踪文件），只保留本卡 SKILL 对应的 **16 份 wrapper 再生**（`.codex/skills/*` 8 + `plugins/spec-driver/skills-codex/*` 8）。
- **wrapper 份数由 D-13 的 10 增为 16 的换算式**：Phase A 的块 2 射程 5 份 SKILL ∪ Phase C 的块 3 射程 7 份 SKILL = **8 份**去重 SKILL（`fix` 只在块 2 射程内、`sync`/`doc`/`refactor` 只在块 3 射程内），每份 SKILL 对应 2 条分发链 ⇒ `8 × 2 = 16`（单位：wrapper 文件）。
- **回退后复核**：`repo:check` **93 项**，无一项因此转红——证明这 19 份不受任何 check 守护，本就属「跑一次就变」的噪声面。**结论与 D-13 一致，本条不新增处置，只作再现计数 +1。**

### D-19 · 块 1 的 `## 轻量三纪律` 一节**当前留空**，是 Phase D 的显式承诺而非遗漏

- **事实**：块 1 的 6 个具名节中，`## 轻量三纪律` 只有一行说明「本节内容由 Phase D 填充（FR-030 ~ FR-034）」，正文为空。该空节**已随本 Phase 注入 4 份 agent**，即当前在盘的 4 份 agent 各带一个空节。
- **依据**：T063 明写该节「留空占位并写明『本节内容由 Phase D 填充』」，plan Phase D 落点表第 1 行明写「Phase C 新建，本阶段填『轻量三纪律』一节」，且该跨 Phase 承诺已由 T087 ~ T090 显式任务化（FR-008）。
- **处置**：节标题**必须保留在盘**，它是该承诺的可见锚点；删掉标题即让承诺从产物上消失。Phase D 落地后本条消账。
- **诚实口径**：在 Phase D 完成之前，**不得**把块 1 口径为「输出纪律共享块已完整」——它当前是 5 节有内容、1 节空占位（换算式：5 ÷ 6 = 83.3%，单位：具名节）。

### D-38 · plan 的 `GATE_DESIGN` 锚点命中数快照已陈旧（现取值全部大于快照，`grep -n` 现取纪律实测有效）

- **事实**：plan Phase D 落点表行 6-9 与裁定 D-③ 记的实测快照是 `feature` **2** / `story` **8** / `implement` **1** / `fix` **6**（2026-09-04，单位：命中行）。D-a 段按「锚点以 `grep -n 'GATE_DESIGN'` **现取**」跑出的值为 `feature` **8** / `story` **14** / `implement` **7** / `fix` **12**（同单位）。
- **归因**：差额全部来自 Phase A 的块 2（`orchestrator-gate-mounting-guard`）与其上方的门禁配置加载散文——该块正文多处提到 `GATE_DESIGN`，注入 4 份 SKILL 后每份各增 6 行命中（换算式：`8 − 2 = 6`、`14 − 8 = 6`、`7 − 1 = 6`、`12 − 6 = 6`，四式同值，单位：命中行）。**不是本卡改动引入的偏差，是快照成文于块 2 注入之前**。
- **处置**：按 tasks.md T081 的「**不得照抄该快照**」执行，四处 marker 落点全部按现取结果定位（`feature` 走 `## Gate 决策流程（动态）` 段末、`story` / `fix` 走各自 `### Phase 2.5: 设计门禁 [GATE_DESIGN]` 段末、`implement` 走 `### Phase 2: Plan Review` 段末即 `GATE_DESIGN` 作为 `gates_before` 的那个 phase）。**plan 的快照不回改**（plan 只允许追加式修订记录），本条即其陈旧性的登记。
- **连带的诚实口径**：命中行数**不是**「SKILL 有没有 `GATE_DESIGN` 段」的判据——`feature` 与 `implement` 两份**至今没有**名为「设计门禁」的独立小节，它们的 `GATE_DESIGN` 处理分别由通用的 `## Gate 决策流程（动态）` 与 phase 2 的 `gates_before` 承担。块 4 的落点选的是**该门实际被求值的那一段**，不是名字里带 `GATE_DESIGN` 的任意一行。

### D-39 · `repo:sync` 顺带重刷 19 份无关再生制品（D-13 / D-18 第三次再现，逐份计数仍一致）

- **事实**：4 份 SKILL 注入块 4 marker 后跑 `npm run repo:sync` 再生 Codex wrapper，该命令同时重刷 **19** 份与本卡无关的产物，与 D-13（10 份 wrapper 时）、D-18（16 份 wrapper 时）的份数**逐份一致**：`specs/products/**` **17** 份 + `.specify/project-context.suggestions.{md,yaml}` **2** 份（换算式 `17 + 2 = 19`，单位：文件）。
- **处置**：用 `git show HEAD:<path> > <path>` **定向回退 19 份**（**未用 `git checkout`**，避免误伤未跟踪文件；实跑计数器输出 `定向回退份数 = 19`），只保留本段 SKILL 对应的 **8** 份 wrapper 再生（换算式：本段射程 4 份 SKILL × 2 条分发链 = **8**，单位：wrapper 文件；`.codex/skills/*` 4 + `plugins/spec-driver/skills-codex/*` 4）。
- **回退后复核**：`repo:check` **94** 项、退出码 **0**、非 pass 仅 `graph-quality:freshness: warn`（既有 stale 图，与本段无关）。**结论与 D-13 / D-18 一致，本条不新增处置，只作再现计数 +1**（第 3 次）。
- **wrapper 份数由 D-18 的 16 降为 8 的原因**：D-18 是 Phase A ∪ Phase C 的去重 SKILL 射程 8 份 × 2；本段射程只有块 4 的 4 份 SKILL。**两个数各自独立、不得相减**——commit ② 落盘时 Phase B + D 合并后的 wrapper 面须届时重新按去重射程计。

### D-40 · FR-023 的「必备字段 4 项」与轮次记录「完整字段 7 项」是两个口径，块 4 内已分列

- **事实**：tasks.md T084 给的换算式是 **4** 项（轮次数 1 + 每轮新增 CRITICAL 计数 1 + 承重项清单及其预先声明时点 1 + 是否进入止损 1），而编排器 D-a 简报列的是 **7** 项（另含「与上轮对照」「输入版本指针」「对抗方标识」）。二者**不是同一个量**：4 项是 **FR-023 本体**的必备字段，另 3 项分别由 FR-021（逐条对照）、FR-022（输入版本指针）与编排器 D-a 简报（对抗方标识）产生。
- **处置**：块 4 的「轮次记录字段」节**两个口径分列写出**，各自带换算式与单位（必备字段 4 / 记录字段 7），并显式写「不得相加、不得互相冒充」。**未在 4 与 7 之间择一**——择一必然让另一份来源的要求落空。
- **诚实登记**：「对抗方标识」这一项**没有 FR 出处**，来源是编排器 D-a 简报的显式要求。它服务的是「轮 / 路」计数可核对与同构 / 异构档位可追溯，**不得**被引用为某条 FR 的达成证据。
- **同批登记的一处不实现**：FR-024（每轮 CRITICAL 条目摘要，`SHOULD · [可选]`）已由 plan §裁剪登记判裁剪，块 4 **未写该字段**，本条不重复登记其残余（T084 明令「此处不重复实现、也不重复登记」）。

### D-41 · 推断前提 P-6 的机器注入侧上界**已被 D-a 单段击穿**（手写侧仍在界内），如实登记不回改 plan

- **事实（实测，`git diff --numstat` 现取）**：D-a 段落盘后——
  - **机器注入侧**：块 4 正文 **87** 行 × 4 个目标位 = **348** 注入行（单位：注入行）。plan 推断前提 **P-6** 给的区间是 **160 ~ 240** 注入行，**348 > 240，上界击穿**，超出 **108** 行（换算式 `348 − 240 = 108`，同单位）。
  - **手写侧**：本段手写 **139** 行 = 块 4 新建 87 + 4 份 SKILL 的 marker 引导 `4 × 5 = 20` + `fix` 的 T085 例外 7（含被改写的 1 行）+ `sync-agent-docs.mjs` 第 4 个 entry 25（其中注释 18 行）（单位：手写行）。P-6 的手写区间是 **262 ~ 405**，Phase D 尚有 D-b / D-c 未落，**本段单看不构成越界判定**，须在 Phase D 收口时按全 Phase 合计复判。
- **两处分项估值同时低估的归因（逐项对照，不做事后合理化）**：
  | 分项 | plan 估值 | 实测 | 差因 |
  |---|---|---|---|
  | ★ 块 4 新建 | 40 ~ 60 行 | **87** 行 | 块 4 承载 4 条 MUST（FR-020 ~ FR-023）与 1 条升格后的 MUST 子条款（止损），且 FR-021 / FR-023 各自带「判不出按新增」「预先声明时点」「放行与止损可区分」等**不可压缩的反规避子句**；估值成文时块 4 内容尚未撰写（P-6 出处自注「块 4 的内容尚未撰写」）。 |
  | 4 份 SKILL marker | 2 行 / 份 = 8 | **5** 行 / 份 = **20** | 估值只数了 marker 对本身，未计与既有 3 个注入点同型的「以下区块由 … 注入，请勿手动编辑区块内容」引导行与其上下空行。 |
  | `sync-agent-docs.mjs` 第 4 entry | 6 ~ 8 行 | **25** 行 | 数据本体 11 行在界内；另 **14** 行是 `targets` 为何是 4 份而非 8 份的逐 mode 说明注释（`resume` / `refactor` / `sync` / `doc` 各自的排除依据），与既有 3 个 entry 的注释密度同型。 |
- **处置（三条）**：(1) **不回改 plan**（plan 只允许追加式修订记录），本条即该越界的登记落点；(2) **不为迁就上界压缩块 4 正文**——被删掉的会是反规避子句，那正是 FR-020 ~ FR-023 的承重部分，压缩即把「体量合规」买在「判据可绕过」上；(3) 交 Phase D 收口（T101）时按**两个单位分列**复判 P-6：手写侧按 D-a + D-b + D-c 合计判，注入侧**已可判 FAIL**，须在 verification-report 中如实标注而非合并成一个「大致符合」。
- **诚实边界**：P-6 是 `[推断]` 前提，越界说明**推断不准**，**不说明实现有缺陷**；反之也不得反过来用「实现没问题」去追认那个区间——两件事各判各的。

---

### D-42 · 推断前提 P-6 的机器注入侧越界**在 D-b 后进一步扩大**（手写侧仍在界内），处置同 D-41

- **事实（实测，`git diff --numstat` 现取 + marker 区间外行数对比）**：
  - **机器注入侧（Phase D 累计）**：D-a 的块 4 `87 × 4 = 348` + D-b 的块 1 增量 `72 × 4 = 288` = **636** 注入行（单位：注入行）。P-6 上界 **240**，**超出 396 行**（换算式 `636 − 240 = 396`，同单位）。计数集合口径 = Phase D 内经 `sectionConfigs` 注入的全部目标位（块 4 的 4 份 SKILL + 块 1 的 4 份 agent），不含手写侧。
  - **手写侧（Phase D 累计）**：D-a **139** + D-b **201** = **340** 行（单位：手写行），P-6 区间 **262 ~ 405**，**仍在界内**；D-c 未落，**须在收口时按全 Phase 合计复判**。
  - D-b 手写侧 **201** 的换算式（单位：手写行）：块 1 §轻量三纪律 **72**（写入 73、删占位 1，净 +72）+ `agents/verify.md` **25**（T091 的 11 + T092 的 14）+ `agents/tasks.md` **22**（marker 区间外净增，重编号 2 行为原地改写、净 0）+ 4 份 SKILL 的 FR-065 块 **60**（`15 × 4`）+ `agents/plan.md` 的 FR-065 块 **22** = `72 + 25 + 22 + 60 + 22 = 201`。
- **处置**：与 D-41 完全同向——(1) **不回改 plan**；(2) **不为迁就上界压缩正文**；(3) 收口（T101）时按**两个单位分列**复判，注入侧如实标 FAIL，**不得**与手写侧的 PASS 合并成一个「大致符合」。
- **诚实边界**：P-6 是 `[推断]` 前提，越界只说明**推断不准**，不说明实现有缺陷；反向也不成立。另按 P-6 自带的连带要求复核 **SC-008「手写副本数 0」**：块 1 与块 4 两条注入链上**零手写副本**，该量**不受注入量影响**（注入量大 ≠ 手写量大，二者独立）；但 FR-065 一项**确有 4 份手写副本**，见 D-44——两者是不同的量，不得互相冒充。

---

### D-43 · `repo:sync` 顺带重刷 19 份无关再生制品（D-13 / D-18 / D-39 第 **4** 次再现，逐份计数仍一致）

- **事实**：D-b 收口跑 `npm run repo:sync` 后，除本段应保留的 wrapper 外，另有 **19** 份与本卡无关的再生制品被重刷——`specs/products/**` **17** + `.specify/project-context.suggestions.{md,yaml}` **2**（换算式 `17 + 2 = 19`，单位：文件；计数集合口径 = `repo:sync` 前后 `git status --porcelain` 的差集中，路径前缀不属本卡落点表的全部条目）。**与 D-13 / D-18 / D-39 逐份计数一致**。
- **处置**：用 `git show HEAD:<path> > <path>` **定向回退 19 份**（**未用 `git checkout`**，遵守硬约束），实跑计数器输出「定向回退份数 = 19」。回退后 `repo:check` **94** 项、exit=0，无一项因此转红。
- **保留的 wrapper（换算式，单位：wrapper 文件）**：D-b 射程 4 份 SKILL（`fix` / `doc` / `refactor` / `sync`）× 2 条分发链（`.codex/skills/**` 与 `plugins/spec-driver/skills-codex/**`）= **8**；其中 `fix` 的 **2** 份与 D-a 重叠（本段是二次更新），故**本段新进入改动集的是 6 份**。两个数各自独立、**不得相减也不得互相冒充**。

---

### D-44 · FR-065 三项约束在 4 份 SKILL 内是**手写副本 × 4**，**无机器守护**（不能走共享块，理由是硬约束冲突）

- **事实**：T097 把同一段 FR-065 三项约束**逐份手写**进 `spec-driver-{fix,doc,refactor,sync}/SKILL.md`（各 **15** 行，含 1 行分隔空行；换算式 `15 × 4 = 60` 行，单位：手写行），另在 `agents/plan.md` 写入一份**plan 侧变体**（**22** 行，含三问的判定命令示例表，与 SKILL 版**不同文**，单位：手写行——两个数不同单位下的同类量，分列不相加）。
- **为什么不走共享块（第 5 个 `sectionConfigs` entry）**：新增一个共享块会把 `repo:check` 的 check id 从 **94** 推到 **95**（每个共享块自动派生 1 个 `agent-docs:shared-section:*` check），与**裁定 I-1** 给 T101 定死的「`added` 清单 13 → **14**、check id **94**」直接冲突；且 plan 落点表行 11-14 明写的形态就是「4 份 SKILL 各写入」。故按落点表执行。
- **残余（如实登记，不得口径为「已覆盖」）**：这 4 份副本**当前逐字节一致**（实测：按块首行定位后取 14 行与源块 `diff`，4 份**全 identical**），但**漂移无任何机械守护**——下一次修订其中一份而漏改其余三份时，`repo:check` 不会转红。这与 FR-036「禁止各 SKILL 手写副本」的方向**相反**，属**由裁定 I-1 的 check id 冻结约束倒逼出的形态**，不是本段的自由选择。**凡把 FR-065 口径为「已有守护」即为 over-claim。**

---

### D-45 · T089 的模板一致性核对：**8 项中 7 项字面一致、1 项靠蕴含成立**，据此判「无需回改模板」

- **事实**：T089 要求核对两份 `plan-template.md`（`.specify/templates/` 与 `plugins/spec-driver/templates/specify-base/`，实测该章节**两份逐字相同**）的「推断前提登记」结构与块 1 纪律三口径**逐条一致**，不一致则**以纪律三为准回改模板**。逐条比对 **8** 项（单位：口径条）：标记复用且禁另造 / 每条附推断理由 / 按命题去重 / 「已核实」须附命令原文与原始输出片段 / 只写命令无输出退回 `[推断]` 并计入分母 / **仅凭静态论证不足以进桶** / 三桶分母口径 / 回填分工。
- **7 项字面一致**；**第 6 项「仅凭静态论证 / 设计推理 / 『按设计应当如此』不足以进桶」在模板中无逐字对应**，模板写的是进桶门槛「只写复核命令而**无原始输出片段**者一律退回」。判定为**一致**的依据是一次**蕴含推理**：静态论证既无命令也无原始输出，必然被该门槛拦下。
- **处置**：判「一致，无需回改模板」，**但该判定依赖蕴含而非字面比对**，如实登记于此。若后续认为蕴含不足以支撑「逐条一致」，正确处置是**回改模板补一句字面条款**（成本 1 行），而不是把本条改写成「已字面一致」。

---

### D-46 · T092 的「三处分母核对」在 `agents/verify.md` 内写成**通用形式**，未钉本卡的条目编号

- **事实**：任务卡对 T092 的表述点名了本卡 spec 的具体条目（`V-1 ~ V-3` 未混入分母、`B-1` / `B-2` 两条能力边界声明均未计入分母、`A-3` 的命令与陈述同一命题）。落地时写成的是**桶级通用形式**——「已核实桶的各条」/「能力边界声明桶的各条」/「计入分母的每一条」。
- **理由**：`agents/verify.md` 是**可复用的子代理 prompt**，对每一个 feature 都生效；钉死本卡的 `V-1` / `B-1` / `A-3` 会在下一个 feature 上**恒假**（那些编号根本不存在），等于把一条判据写成一次性的。且两份 `plan-template.md` 对推断桶用的编号是 `P-n`、本卡 spec 用的是 `A-n`，**两套编号并存**，钉任一套都会与另一套对不上。
- **处置与边界**：本卡的三处具体核对（`V-1~V-3` / `B-1`、`B-2` / `A-3`）**不在本段射程内**，由 Phase D-c 与 Phase E 的验证产物承担；**本段只落通用判据**。凡以「`agents/verify.md` 里没写 V-1」为由判 FR-066 未落地即为误判，反过来凡以「通用判据已写」声称本卡三处已核对，同样是 over-claim。

---

## 验证留痕（命令原文 + 退出码 + 输出摘要）

### A1 / A2 段留痕（保留）

**T001 拆分前基线**

| # | 命令原文 | 退出码 | 输出摘要 |
|---|---|---|---|
| 1 | `npx vitest run plugins/spec-driver/tests/orchestration-resolver.test.mjs plugins/spec-driver/tests/orchestrator.test.mjs` | **1** | `No test files found, exiting with code 1`（见 D-1） |
| 2 | `node --test plugins/spec-driver/tests/orchestration-resolver.test.mjs plugins/spec-driver/tests/orchestrator.test.mjs` | 0 | `tests 76 / pass 76 / fail 0` |
| 3 | `npm run test:plugins` | 0 | `tests 1688 / suites 298 / pass 1686 / fail 0 / skipped 2` |

**T003 拆分后零行为验证**：同两条命令逐位相同；`git diff --stat -- …/orchestration-resolver.test.mjs` **空输出**。

**红 → 绿（每对测试先证必红，再证转绿）**

| 任务对 | 红：命令 / 退出码 / 摘要 | 绿：命令 / 退出码 / 摘要 |
|---|---|---|
| T004 → T005 | `npx vitest run tests/unit/spec-driver-orchestration-schema.test.ts` / **1** / `Failed Tests 13` | 同一命令 / **0** / `Tests 26 passed (26)` |
| T006 → T007 | `node --test …/orchestration-resolver.test.mjs` / **1** / `tests 47 / pass 43 / fail 4` | 同一命令 / **0** / `tests 47 / pass 47 / fail 0` |
| T008 → T009 | `node --test …/orchestrator.test.mjs` / **1** / `tests 42 / pass 35 / fail 7` | 同一命令 / **0** / `tests 42 / pass 42 / fail 0` |
| T010 → T011 | `node --test …/orchestrator.test.mjs` / **1** / `tests 48 / pass 43 / fail 5` | 同一命令 / **0** / `tests 48 / pass 48 / fail 0` |
| T012 → T013 | `node --test …/validate-gate-mounting.test.mjs` / **1** / `ERR_MODULE_NOT_FOUND` | 同一命令 / **0** / `tests 11 / pass 11 / fail 0` |
| **T016 / T020** | **原始输出缺席（见 D-9），不补造** | 编排器补录：本卡 3 个插件测试文件 `node --test` **106 ÷ 106 绿** |

**攻击复现**（A1 段编排器亲自复现，逐步取证）：构造 `generate-template feature` → 数字 id 加引号 → 删 phase `3.5 gate_design` → phase `4` 的 `gates_before` 置 `null`（**完全不碰 `gates:` 块**）；入库为 `…/fixtures/orchestration/attack-feature-drops-gate-design.yaml`。实现后 diagnostics 出现 `error / orchestration-overrides.gate-mounting-lost`，`config.modes.feature.phases` 由 16 回到 17（回退 base）。

---

### A3 段（本段）留痕

#### T029 · FR-068 注入闭环（三项）

| # | 项 | 命令原文 | 结果 |
|---|---|---|---|
| 1 | **幂等** | `npm run docs:sync:agents`（第 2 次） | `Synced shared guidance sections into AGENTS.md and CLAUDE.md (**0 updated**)`；与第 1 次跑完的快照逐字节 `diff` 5 份 SKILL + `AGENTS.md` + `CLAUDE.md`，**汇总退出码 = 0**（全空） |
| 2 | **新 check id** | `npm run repo:check` | `- agent-docs:shared-section:orchestrator-gate-mounting-guard: **pass**`；位次为 `agent-docs` 族**第 11 位（末位）**，与 `sectionConfigs` 追加顺序一致 |
| 3 | **R-1 红灯复跑** | 临时删 `story` 一份的 BEGIN marker → `npm run repo:check` | 见下 |

**第 1 次 sync 的注入量**：5 份 SKILL 各 `diff` 新增 **41** 行（= 模板正文行数），`git diff --numstat` 显示 `feature/story/implement/fix` 各 **50 / 0**、`resume` **52 / 0**（多 2 行 = 新建的 `### 3.5 门禁挂载守卫` 标题 + 空行），**删除行数全为 0**——既有散文一行未动。

**R-1 红灯的原始结论**：

```
agent-docs 族坍塌为单条    - agent-docs:shared-section-status: fail
error 原文                 [agent-docs] shared agent docs 校验内部错误：
                           Missing sync markers for section "orchestrator-gate-mounting-guard"
本次 check id 总数          81      （对照：正常态 91）
```

- **换算式**：`91 − 11（shared-section:* 全族）+ 1（兜底外壳吐出的 shared-section-status）= 81`，单位：check id。**其余 80 条 check 的结论完整保留**，报告未因 `throw` 丢失——这正是 A2 段 `validateSharedAgentDocsSafely`（裁定 A-①）要证的行为，方向为 fail-loud（记 `fail` 不记 `pass`）。
- **对照数更正**：plan Phase A 验证点 4 记「其余 90 个」，**实测为 80**。按 T029「以当次实跑输出为准，不照抄该数」处置。
- **恢复复核**：`diff <红灯构造前快照> <恢复后文件>` **零输出**；`git diff --numstat` 回到 `50  0`；再跑 `docs:sync:agents` 为 `0 updated`。

#### T030 · 禁改集射程逐份核对（11 份）

方法：把每份文件逐一放到干净沙箱的 `.specify/orchestration-overrides.yaml`，跑**真 resolver**
`node …/orchestrator-cli.mjs effective-orchestration feature --format json --project-root <沙箱>`，
读 `diagnostics` 判是否命中 `gate-field-forbidden` / `gate-mounting-lost`。**不靠文本推断**。

| # | 文件 | 触碰禁改集 | diagnostics 实测 |
|---|---|---|---|
| 1 | `invalid-schema-bad-mode.yaml` | 否 | `warning/orchestration-overrides.schema-fallback` |
| 2 | `valid-overrides-goal-loop.yaml` | 否 | `info/orchestration-overrides.mode-overridden` |
| 3 | `goal-loop-version-mismatch.yaml` | 否 | `warning/orchestration-overrides.version-mismatch` |
| 4 | `overrides-with-parallel-groups.yaml` | 否 | `warning/orchestration-overrides.unsupported-field` |
| 5 | `invalid-anchor.yaml` | 否 | `warning/orchestration-overrides.schema-fallback` |
| 6 | `version-mismatch-overrides.yaml` | 否 | `warning/orchestration-overrides.version-mismatch` |
| 7 | `valid-overrides-mode-fix.yaml` | 否 | `info/orchestration-overrides.mode-overridden` |
| 8 | `valid-overrides-gate.yaml` | 否 | **（无 diagnostic）** |
| 9 | `templates/orchestration-overrides.example.yaml`（发给用户抄） | 否 | **（无 diagnostic）** |
| 10 | `templates/goal-loop-override-template.yaml`（发给用户抄） | 否 | `info/orchestration-overrides.mode-overridden` |
| 11 | `contracts/orchestration-overrides-contract.yaml`（合同说明） | — | 见 **D-12**：甲 / 乙已同步，**丙缺失、本段补齐** |

**换算式**：`8（fixture）+ 2（用户样例）+ 1（合同）= 11 份`，单位：文件。

**超出卡面的自查（3 份，同法跑）**：`invalid-yaml-syntax.yaml` 否 / `valid-overrides-parallel-scheduling.yaml` 否 / `attack-feature-drops-gate-design.yaml` **是**（`error/orchestration-overrides.gate-mounting-lost`，本卡刻意构造的攻击 fixture，唯一命中项）。目录实测共 11 份 `.yaml`，卡面点名 8 份，故此处按全量跑以消盲区。

**两条结论**：(a) 10 份合法文件**无一**触碰禁改集，D-3 的载体字段迁移（`default_behavior` → `severity`）**已彻底**，无残留；(b) 两份发给用户照抄的样例走真 resolver **均不被拒**——用户照抄不会被自家门禁挡住。

#### T031 · 21 条断言 ↔ 散文原文对照（原则 IX）

**换算式**：`8（agent-tools-core.mjs）+ 12（validate-gate-mounting.mjs）+ 1（resolver 挂载校验）= 21 条断言`，单位：断言条。

| 组 | 断言 id | 条数 | 散文原文位置 | 结论 |
|---|---|---|---|---|
| A(i) | `tools:{specify,plan,tasks}:{Edit,Bash}` | 6 | `templates/agent-output-discipline.md`（块 1，Phase C 新建；plan 矩阵 FR-014 / FR-027 / FR-028 / FR-030 行指定） | **待 C**（见 D-11） |
| A(ii) | `verify:no-added-tools` | 1 | 同上（短语契约「不得为其新增任何工具项」逐字取自块 1） | **待 C**（见 D-11） |
| A(iii) | `protocol:verify-not-applicable-disclosure` | 1 | 同上 | **待 C**（T031 明许） |
| B(i) | `mounting:{feature,story,implement}:{GATE_DESIGN,GATE_TASKS}` | 6 | `templates/orchestrator-gate-mounting-guard.md:35`——「对每个强制模式 … × 每个 gate … 断言 **effective 侧至少有一个 phase 挂载 `g`**——刻意保持**绝对存在性**形式」 | **PASS** |
| B(ii) | `is-hard-gate:feature:GATE_DESIGN` | 1 | 同上 `:35`「另行断言 `feature` 下 `GATE_DESIGN` 的 `is_hard_gate` 为 `true`」；上位散文 = 宪法 XI「设计硬门禁（GATE_DESIGN）在 feature 模式下不可被任何策略或配置绕过」 | **PASS** |
| B(iii) | `default-behavior:GATE_DESIGN` | 1 | 同上 `:35`「两个 gate 的 `default_behavior` 未被改成放行取值」；用户侧合同 = `orchestration-overrides-contract.yaml:77`「`gates.GATE_DESIGN.default_behavior` … 整体不可覆盖」 | **PASS** |
| B(iv) | `default-behavior:GATE_TASKS` | 1 | 同上；合同 `:77` 起「`gates.GATE_TASKS.default_behavior` 不可覆盖为 auto / skip」 | **PASS** |
| B(v) | `diagnostics:{feature,story,implement}` | 3 | `templates/orchestrator-gate-mounting-guard.md:21`——「diagnostics 数组中不得有 `level === "error"` 的条目」 | **PASS** |
| C | resolver 挂载校验（`findLostGateMountings` → `gate-mounting-lost`） | 1 | `templates/orchestrator-gate-mounting-guard.md:18`「`mounted_in_base === true ⇒ mounted === true`」+ `:19`「只查 `gates:` 块**不足以**发现这类失效」；用户侧合同 `orchestration-overrides-contract.yaml:61`「门挂载禁改（FR-052 丙）」（**D-12 本段补**） | **PASS** |

**小计**：**13 ÷ 21 = 61.9%** 当前已有散文原文（B 组 12 + C 组 1），**8 条待 Phase C**（A 组全部）。**零 VIOLATION 判定**，理由三条见 D-11。

#### T032 · 原则 X 与 XIII

| 项 | 命令原文 | 退出码 | 原始输出 / 结论 |
|---|---|---|---|
| (a) 原则 X · 缺 zod 时可解析性 | `node -e 'import("zod")…'`（复制到无 `node_modules` 的目录内） | 0 | `zod 不可解析: ERR_MODULE_NOT_FOUND`（沙箱条件成立） |
| (a) 原则 X · 两字段是否仍产出 | `node <无 zod 的 CLI> get-gate-behavior feature GATE_DESIGN --project-root <空 root>` | **0** | `"mounted": true, "mounted_in_base": true`；`GATE_TASKS` 同样两字段齐全 |
| (a) 原则 X · 降级 diagnostic 级别 | `node <无 zod 的 CLI> effective-orchestration feature --format json …` | 0 | **`level: "warning"`** / `code: orchestration.zod-unavailable` ⇒ FR-068 条件 (2) **不触发** ⇒ **不退化** |
| (b) 原则 XIII 留痕 (c) | `ls -la .specify/orchestration-overrides.yaml` | **1** | `No such file or directory` ⇒ 本仓自身未覆盖两个 gate 的任何字段，禁改集不把本仓判红 |

新残余（缺 zod 时守卫非鉴别性）见 **D-14**。

#### T033 · Phase A 收口全量（清净窗口 · **串行**）

起跑前：`sysctl -n vm.loadavg` = `{ 1.94 2.16 2.91 }`（1-min **1.94** < 8 阈值）；`pgrep -fl 'vitest|node --test'` = **(无)**，无并发测试进程。`hw.ncpu` = 18。

| # | 命令原文 | 退出码 | 输出摘要 |
|---|---|---|---|
| 1 | `npm run build` | **0** | 类型检查零错误；`[postbuild:stamp] 盖章: commit=e01611b2 (dirty)` |
| 2 | `npm run test:plugins` | **0** | `枚举到 36 个测试文件`；`tests 1718 / suites 305 / pass 1716 / fail 0 / skipped 2` |
| 3 | `npx vitest run` | **1** | `Test Files 4 failed \| 543 passed \| 4 skipped (551)`；`Tests **7 failed** \| 8066 passed \| 15 skipped \| 12 todo (8100)`；起跑 load 2.35 → 结束 23.18（自身占用，非外部争抢） |
| 4 | `npm run repo:check` | **1** | check id 总数 **91**；非 pass 仅 2 条：`agent-tools:required: **fail**`、`graph-quality:freshness: warn` |

**失败清单归类（7 条，逐条归因；单位：失败用例）**

| # | 文件 > 用例 | 失败断言 | 归类 |
|---|---|---|---|
| 1 | `unit/agent-tools-core.test.ts` > 文本 · 协议文本对 verify 标注「不适用」… | `expected 'fail' to be 'pass'`，detail 明写「协议文本事实源缺席：`…/agent-output-discipline.md`（共享块 1，由 Phase C 新建；**Phase A 时点预期红**）」 | **预期红 · 根因源头** |
| 2 | `integration/spec-drift-repo-check-regression.test.ts` > validateRepository 不传 options 时向后兼容 | `expected [ 'pass', 'warn' ] to include 'fail'` | **预期红 · 同根因**（整体 status 被 #1 拉成 fail） |
| 3 | `integration/repo-maintenance-sync-check.test.ts` > repo:sync 会重建受控产物，repo:check 随后通过 | `expected 1 to be +0`（`check.exitCode`） | **预期红 · 同根因** |
| 4 | `integration/repo-maintenance-sync-check.test.ts` > repo:check 输出含 worktree-local-state 第 15 族且为 pass | `expected 1 to be +0`（`check.exitCode`） | **预期红 · 同根因** |
| 5 | `integration/spec-drift-repo-check-modes.test.ts` > 前置：沙箱基线（无 lock）整体 pass | `expected 'fail' to be 'pass'` | **预期红 · 同根因** |
| 6 | `integration/spec-drift-repo-check-modes.test.ts` > AS1：非 fresh 锚 + lock 完好 + 默认模式 → 整体 warn | `expected 'fail' to be 'warn'` | **预期红 · 同根因** |
| 7 | `integration/spec-drift-repo-check-modes.test.ts` > AS4：无锚 / 全 fresh → spec-drift 族贡献 pass | `errors` 数组含 `[agent-tools] protocol:verify-not-applicable-disclosure：…` 一条，`expected [ Array(1) ] to deeply equal []` | **预期红 · 同根因**（失败消息里直接印出根因原文） |

- **同根因证据**：`grep -c 'agent-output-discipline' <vitest 日志>` = **5**（#1 / #2 / #7 三处直接印出该路径，另 2 处在 diff 输出中）；#3 / #4 / #5 / #6 均为 `validateRepository` 整体 `status`/`exitCode` 被 #1 拉低所致。
- **新红：0 条**。无需隔离重跑（FR-050 三条件只对**未归因**失败生效；本 7 条已归因到一个刻意的、已登记的 Phase 顺序事实）。
- **`agent-tools:required` 状态**：`fail`，红在**第 8 条文本断言**，其余 7 条断言 pass（`evidence.passed / total` = 7 / 8）。Phase C 块 1 落地即转绿。
- **K14 断言实跑**：`npx vitest run tests/integration/spec-drift-repo-check-regression.test.ts` → 该文件 `2 tests | 1 failed`，其中 **K14 那条（`F217 六指标逐项断言 + 既有 12 族与基线逐项一致 + 第 13/14/15 族追加`）已转绿**，红的是 #2「向后兼容」（预期，不改）。`added` 构成见下。

**`added` 清单更新后的构成（裁定 I-1）**

```
既有 8：spec-driver-wrappers:codex-wrapper-runtime-namespace
        graph-quality:ignore-undeterminable
        spec-drift:anchors-status
        model-literal-gate:model-literal-scan
        worktree-local-state:worktreeinclude-exists
        worktree-local-state:worktreeinclude-entries
        worktree-local-state:worktreeinclude-ignored-verified
        worktree-local-state:agents-byte-budget
本卡 3：agent-docs:shared-section:orchestrator-gate-mounting-guard   ← 块 2 · Phase A（T026），排在全部既有项之前（agent-docs 是第 1 族）
        agent-tools:required                                        ← 第 16 族
        gate-mounting:effective-config                              ← 第 17 族
换算式：8 + 3 = 11（单位：check id）
```

块 1 / 块 3 / 块 4 三行已由数组元素**改为注释**（`// Phase C 落地后在此追加：…`），并在注释块内保留分阶段值表 `10 → 11 → 13 → 14`，`repo-check-baseline.json` **未动**（`[禁改]`）。

#### 其他核对

- **FR-049 三条代理判据**（A3 段实跑，全空）：见 D-10。
- **`mcp__` 字面量**：`git diff -G'mcp__' --stat -- 'plugins/spec-driver/skills/*/SKILL.md'` **空输出**——本段新增行零引入。4 份 SKILL 各有的 1 处既有命中（如 `feature:194` 的工具优先级提示）为改动前即存在。模板本身 `grep -c 'mcp__'` = **0**。
- **锚点现取**（`grep -n`，未照抄 plan 快照，实测与快照一致）：`feature:93` / `story:97` / `implement:107` / `fix:95`（小节起始行）；下一小节 `feature:105` / `story:110` / `implement:119` / `fix:107`；`resume` 插入于 `:60`「### 3. 配置加载」之后、`:67`「### 4. 项目上下文注入（project-context，可选）」之前。`refactor:68` 确有同名小节，**按裁定 A-③ 不纳入**（已在模板残余 1 中登记）。

---

## 本段（A3）新增 / 修改文件清单

**新建（1）**

- `plugins/spec-driver/templates/orchestrator-gate-mounting-guard.md`（共享块 2，41 行；FR-068 单一事实源）

**修改（9，手写）**

- `scripts/sync-agent-docs.mjs`（`sectionConfigs` 追加第 11 个 entry，含排序契约注释）
- `plugins/spec-driver/skills/spec-driver-{feature,story,implement,fix}/SKILL.md`（各 +50 / −0：注入说明行 + `SD_MODE` + 一对 marker + 块正文）
- `plugins/spec-driver/skills/spec-driver-resume/SKILL.md`（+52 / −0：多一个新建的 `### 3.5 门禁挂载守卫` 小节）
- `plugins/spec-driver/contracts/orchestration-overrides-contract.yaml`（`modes.<mode>` 补门挂载禁改说明，见 D-12）
- `tests/integration/spec-drift-repo-check-regression.test.ts`（K14 清单 → 11 项，裁定 I-1）

**再生（10，由 `npm run repo:sync` 产出，非手写）**

- `.codex/skills/spec-driver-{feature,story,implement,fix,resume}/SKILL.md`
- `plugins/spec-driver/skills-codex/spec-driver-{feature,story,implement,fix,resume}/SKILL.md`

**未动**：`spec.md` / `plan.md`（只读参考）；Phase B–E 的任何文件；`plugins/spec-driver/config/orchestration.yaml`；`tests/fixtures/spec-drift/repo-check/repo-check-baseline.json`（`[禁改]`）；任何 `.snap`；`specs/products/**` 与 `.specify/project-context.suggestions.*`（`repo:sync` 顺带刷新后已定向回退，见 D-13）。

---

### Phase C 段（本段）留痕

#### T063 ~ T067 · 块 1（`templates/agent-output-discipline.md`，74 行）

**自演练留痕（本卡对 FR-014 协议的第 1 次自演练）**：T063 一次 `Write` 只落 6 个具名节标题 + 每节一行占位行（27 行），T064 ~ T067 逐节 `Edit` 填充，**全程无第二次整篇 `Write`**。收尾时占位行残留计数 `grep -c '（占位：待填。）'` = **0**。

**块 1 对 6 条短语契约的落点行号**（`agent-tools-core.mjs` 的 `PROTOCOL_VERIFY_DISCLOSURE_PHRASES`，归一化后比对；命令 `grep -n <短语> <文件>`）：

| # | 契约 | 类型 | 落点行 |
|---|---|---|---|
| 0 | `verify.md`（主语锚 `PROTOCOL_SUBJECT_ANCHOR`） | 主语锚 | **15**、19 |
| 1 | `不适用` | 短语 | **13**（节标题）、15、26 |
| 2 | `不得为其新增任何工具项` | 短语 | **15** |
| 3 | `持有 Bash`（原文 `**持有 \`Bash\`**`，归一化后命中） | 短语 | **19** |
| 4 | `写能力未在工具层封闭` | 短语 | **19** |
| 5 | `自律` | 短语 | **19** |
| 6 | `未取得` | 短语 | **19** |

**逐条纯函数实证**（不经文件系统，直接喂文本）：

```
node --input-type=module -e "…evaluateAgentToolsAssertions({protocolText})…"
→ pass | plugins/spec-driver/templates/agent-output-discipline.md 含全部 6 条短语契约
```

**块 1 的 6 个具名节与行号**：`## 适用场景`:5 / `## 不适用场景`:13 / `## 分节写作与逐节 Edit 口径`:28 / `## 中断幸存与按段续写`:41 / `## 委派形态分流`:55 / `## 轻量三纪律`:72（**留空，见 D-19**）。`grep -c 'mcp__'` = **0**。

#### T068 · 块 3（`templates/gate-tasks-scope-cut-acceptance.md`，83 行）

**自演练留痕（第 2 次）**：同样先落 4 节骨架（19 行）再逐节 `Edit`；占位行残留 **0**。四个具名节：`## 何时触发`:5 / `## 展示什么与接受什么`:23 / `## 门不停时的判定`:49 / `## 冻结值字段格式`:61。

**三个禁写字面量的实测计数**：`mcp__` = **0**、`暂停` = **0**（见 D-17）、`AskUserQuestion` = **0**。

#### T069 · 2 个 `sectionConfigs` entry（K14 顺序契约）

`node --input-type=module -e "…import sectionConfigs…"` 实跑输出（entries = **13**，两个新 entry **append 在数组末尾**）：

```
11 orchestrator-gate-mounting-guard -> 5     ← Phase A（T026）
12 agent-output-discipline          -> 4     ← 本段（块 1 在前）
13 gate-tasks-scope-cut-acceptance  -> 7     ← 本段（块 3 在后）
```

换算式：既有 10 + Phase A 1 + 本段 2 = **13**（单位：`sectionConfigs` entry）。**第 3 个 entry `orchestrator-gate-mounting-guard` 未重复签发**（数组内该 key 出现次数 = 1）。

#### T070 ~ T072 · marker 落点（锚点全部 `grep -n` 现取）

**块 1 · 4 份 agent**（marker 插在各自 `## 输入` 小节之前；`agents/verify.md` **不加 marker**）：

| 文件 | marker 插入前的锚点行（`## 输入`） |
|---|---|
| `agents/implement.md` | 32 |
| `agents/specify.md` | 13 |
| `agents/plan.md` | 32 |
| `agents/tasks.md` | 13 |

**块 3 · 7 份 SKILL**（3 份新建小节 + 4 份已有 `GATE_TASKS` 段）：

| SKILL | 现取锚点行 | 形态 | plan 快照对照 |
|---|---|---|---|
| `spec-driver-feature` | 783（`Gate 决策流程（动态）` 代码块闭合行后） | 已有段 | — |
| `spec-driver-story` | 446（`质量门（GATE_TASKS）` 代码块闭合行后） | 已有段 | — |
| `spec-driver-implement` | 421（同上） | 已有段 | — |
| `spec-driver-refactor` | 142（`**质量门（GATE_TASKS）**: 根据 behavior…` 行后） | 已有段 | — |
| `spec-driver-resume` | **354** | **新建** `### GATE_TASKS 裁剪接受口径` | plan `:302` 后 + Phase A 注入 52 行 = 354 ✅ 一致 |
| `spec-driver-sync` | **294** | **新建**同名小节 | plan `:294` 后 ✅ 一致 |
| `spec-driver-doc` | **680** | **新建**同名小节 | plan `:680` 后 ✅ 一致 |

换算式：块 3 目标位 = 新建 3 + 已有 4 = **7 份 SKILL**；SKILL 侧与块 2 的 5 份去重 = **8 份**（`5 ∪ 7 = 8`）；SC-008 分母 = 8 SKILL + 4 agent = **12**（单位：消费方文件）。

#### T073 · 注入闭环与幂等

| # | 项 | 命令原文 | 退出码 | 结果 |
|---|---|---|---|---|
| 1 | 第 1 次注入 | `npm run docs:sync:agents` | 0 | `Synced … (**11 updated**)` |
| 2 | **幂等（逐字节）** | `npm run docs:sync:agents`（第 2 次）+ 对 13 份注入目标与仓根 2 份逐份 `cmp` | 0 | `(**0 updated**)`；`cmp` **汇总退出码 = 0**（15 份逐字节相同）——**未用「`git diff --exit-code` 零输出」作判据**（A3 反馈 (c)） |
| 3 | 3 个新 check | `npm run repo:check` | — | `agent-docs:shared-section:{orchestrator-gate-mounting-guard, agent-output-discipline, gate-tasks-scope-cut-acceptance}` **全 pass** |
| 4 | 既有 20 个注入点零回归 | 同上 | — | `agent-docs:shared-section:*` 既有 **10** 项全 pass（换算式 10 section × 2 targets = **20** 注入点） |

**注入量（`git diff --numstat`）**：4 份 agent 各 +79~80 行；7 份 SKILL 中 `feature`/`story`/`implement` 各 +138、`resume` +142、`doc`/`sync` 各 +90、`refactor` +88（含块 2 与块 3 两次注入的合计）。**删除行数除 Phase A 的 frontmatter 那 1 行外全为 0**——既有散文一行未动。

#### T074 · K16 字节预算（**空载 PASS**）

```
wc -c AGENTS.md CLAUDE.md   → 24316  AGENTS.md
                              23585  CLAUDE.md
换算式：24316 − 24316（K16 基线）= 0 bytes
worktree-local-state:agents-byte-budget: pass
```

**空载 PASS 必须与结论同处写明**：本卡 3 个新 entry 的 `targets` 分别是 4 份 agent、5 份 SKILL、7 份 SKILL，**均不含仓根 `AGENTS.md` / `CLAUDE.md`**，故该预算机制在本卡上**未受检验**。**不得**口径为「已验证 / 已受检」——它此刻什么也没拦，只是没有东西需要拦（同 D-14 对缺 zod 时守卫非鉴别性的处置口径）。

#### T075 · R-1 红灯在扩大后的 marker 面上复跑

构造：临时删掉 `plugins/spec-driver/agents/tasks.md` 的一对 `agent-output-discipline` marker（**只删 marker，不删正文**）。

```
- agent-docs:shared-section-status: fail
  [agent-docs] shared agent docs 校验内部错误：
  Missing sync markers for section "agent-output-discipline"
本次 check id 总数 = 81      （对照：正常态 93）
其余非 pass = graph-quality:freshness: warn（与本卡无关）
```

- **换算式**：`93 − 13（shared-section:* 全族）+ 1（兜底外壳吐出的 shared-section-status）= 81`，单位：check id。**其余 80 条 check 的结论完整保留**，不是未捕获异常栈、不是 `pass`、不是空 checks 数组。
- **对照数更正**：plan Phase C 验证点 4 记「其余 **92** 个」，**实测为 80**。按 T075「以当次实跑输出为准、不照抄该数」处置。
- **未新写守护代码**：兜底外壳由 Phase A 的 T021（`validateSharedAgentDocsSafely`）提供，本条只做红灯复验——代价 (乙)「新增的是 check id 不是守护代码」两个量分列。
- **还原复核**：`cmp <备份> <文件>` = **0**；再跑 `docs:sync:agents` 为 `0 updated`，跑后再 `cmp` 仍 **0**（零残留）。

#### T076 · `agent-tools:required` 8 ÷ 8 转绿（Phase A 埋的红灯消账）

`node --input-type=module -e "…validateAgentTools({projectRoot})…"` 实跑：

```
族 status = pass | passed/total = 8 / 8
  PASS tools:specify:Edit      PASS tools:specify:Bash
  PASS tools:plan:Edit         PASS tools:plan:Bash
  PASS tools:tasks:Edit        PASS tools:tasks:Bash
  PASS verify:no-added-tools
  PASS protocol:verify-not-applicable-disclosure   ← Phase A 时点必红的那一条，本段转绿
errors = []
```

**SC-003 = 8 ÷ 8 = 100%**（单位：断言条）。**判据是文本存在性检查，不是执行者自读自判**——上述输出由 `evaluateAgentToolsAssertions` 对块 1 全文做归一化后逐短语比对产生。

#### T031 复跑 · A 组 8 条散文原文落点（D-11 消账，原则 IX 由 61.9% → 100%）

| 断言 id | 条数 | 同语义原文位置 | 结论 |
|---|---|---|---|
| `tools:{specify,plan,tasks}:Edit` | 3 | `agent-output-discipline.md:11`「这 4 份 agent 的 `tools` 均含 `Edit` 与 `Bash`……`Edit` 撑「逐节填充」」+ `:35`「再逐节 `Edit` 填充。每次 `Edit` 只填**一节或一段**」 | **PASS** |
| `tools:{specify,plan,tasks}:Bash` | 3 | 同 `:11`「`Bash` 撑「原样复跑检索命令取实际输出」与 `git show <sha>:<path>` 取历史原文」+ `:53`「须写下产生该结论的命令原文与其原始输出」 | **PASS** |
| `verify:no-added-tools` | 1 | `:15`「协议对它不适用，且**不得为其新增任何工具项**」 | **PASS** |
| `protocol:verify-not-applicable-disclosure` | 1 | `:15` + `:19`（6 条短语契约逐字落点见上表） | **PASS** |

**小计**：A 组 8 ÷ 8 有散文原文；连同 A3 段已 PASS 的 B 组 12 + C 组 1，**21 ÷ 21 = 100%**（单位：断言条），**零 VIOLATION**。

#### T077 · D-5 (b)(c) 观察窗口

新建 `specs/277-spec-driver-engine-hardening/verification/d5-observations.md`（48 行），含：窗口开启时点（`git rev-parse HEAD` 现取 = `e01611b266bd0bdb0df71757f51e1c8442679921`，并写明该 sha 是块 1 落盘前的最后一个 commit、与编排器 commit ① 的差别须在 Phase E 写明）、三条观察纪律、每条观察的 8 字段记录格式、Phase E 汇总换算式（`3 ÷ 3 = 100%`，出现 1 次一次性长 Write 即判未达成并如实记比例）。

**观察记录当前 0 条，文件内已逐字写明「待编排器填写」**——本条只开窗口、不汇总，**不伪造观察**。

#### 裁定 I-1 · K14 `added` 清单 11 → 13

`tests/integration/spec-drift-repo-check-regression.test.ts`：两个新 id 加在 `orchestrator-gate-mounting-guard` **之后**、`spec-driver-wrappers:*` **之前**；块 4 那行**保持注释**（Phase D）；分阶段值表的「← 当前值」标记由 Phase A 行移到 Phase C 行。

#### T078 · Phase C 收口全量（清净窗口 · **串行**）

起跑前：`sysctl -n vm.loadavg` = `{ 2.50 2.46 2.96 }`（1-min **2.50** < 8 阈值）；`pgrep -fl 'vitest|node --test'` = **(无)**。`hw.ncpu` = 18。

| # | 命令原文 | 退出码 | 输出摘要 |
|---|---|---|---|
| 1 | `npm run build` | **0** | 类型检查零错误；`[postbuild:stamp] 盖章: commit=e01611b2 (dirty)` |
| 2 | `npm run test:plugins` | **0** | `枚举到 36 个测试文件`；`tests 1718 / suites 305 / pass 1716 / fail 0 / skipped 2` |
| 3 | `npx vitest run` | **0** | `Test Files 547 passed \| 4 skipped (551)`；`Tests **8073 passed** \| 15 skipped \| 12 todo (8100)`；**failed = 0** |
| 4 | `npm run repo:check` | **0** | check id 总数 **93**；非 pass 仅 **1** 条：`graph-quality:freshness: warn` |

**失败清单：0 条。** Phase A 收口登记的 **7 条预期红逐条转绿**：

| # | Phase A 的红 | Phase C 状态 |
|---|---|---|
| 1 | `unit/agent-tools-core.test.ts` > 协议文本对 verify 标注「不适用」 | ✅ 绿（块 1 落盘） |
| 2 | `integration/spec-drift-repo-check-regression.test.ts` > 向后兼容 | ✅ 绿 |
| 3 | `integration/repo-maintenance-sync-check.test.ts` > repo:sync 后 repo:check 通过 | ✅ 绿 |
| 4 | `integration/repo-maintenance-sync-check.test.ts` > worktree-local-state 第 15 族 pass | ✅ 绿 |
| 5 | `integration/spec-drift-repo-check-modes.test.ts` > 沙箱基线整体 pass | ✅ 绿 |
| 6 | `integration/spec-drift-repo-check-modes.test.ts` > AS1 整体 warn | ✅ 绿 |
| 7 | `integration/spec-drift-repo-check-modes.test.ts` > AS4 spec-drift 族 pass | ✅ 绿 |

- **沙箱用例无需放宽守护项**：编排器预告的「沙箱可能缺 `agent-output-discipline.md` ⇒ agent-tools 判不出从严 ⇒ 仍红」**未发生**——`spec-drift-repo-check-modes` 三条用例全绿，说明其沙箱确实复制了 `plugins/spec-driver/agents/*.md` 与新建的 `templates/agent-output-discipline.md`。**未对任何守护项放宽**。
- **`graph-quality:freshness: warn` 与本卡无关**：图 `sourceCommit 64b1d72f` ≠ HEAD `e01611b2`，**本卡改动之前即存在**（D-7 第 3 条已登记），Phase A / Phase C 两次收口取值相同。

**K14 / P-9 的第二次证实（`added` 长度 = 13）**

```
node --input-type=module -e "…比对 repo-check-baseline.json 与 repo:check 实跑 id 集…"
added 长度 = 13
   1 agent-docs:shared-section:orchestrator-gate-mounting-guard   ← Phase A（T026）
   2 agent-docs:shared-section:agent-output-discipline            ← Phase C（T069 · 块 1）
   3 agent-docs:shared-section:gate-tasks-scope-cut-acceptance    ← Phase C（T069 · 块 3）
   4 spec-driver-wrappers:codex-wrapper-runtime-namespace
   5 graph-quality:ignore-undeterminable
   6 spec-drift:anchors-status
   7 model-literal-gate:model-literal-scan
   8 worktree-local-state:worktreeinclude-exists
   9 worktree-local-state:worktreeinclude-entries
  10 worktree-local-state:worktreeinclude-ignored-verified
  11 worktree-local-state:agents-byte-budget
  12 agent-tools:required
  13 gate-mounting:effective-config
换算式：既有 8 + Phase A 3 + Phase C 2 = 13（单位：check id）
repo-check-baseline.json diff：(空 = 未动，[禁改] 遵守)
```

**两次输出均已留痕**：Phase A 实跑 **11**（A3 段「T033 收口全量」表）→ Phase C 实跑 **13**（本表）。**13 是中间值不是终值**，终值 **14** 的证实点在 Phase D 第 4 个 entry（裁定 D-③）落地后。

**与 T078 原文预期的一处不同（须原样呈现）**：T078 写「T024 已把断言清单按终值 14 写死，故本条复跑在第 4 个 entry 落地前**预期为红（13 ≠ 14）**」。**实测为绿**——因为裁定 I-1 已把清单口径由「终值」改为「当次已落地集合」，A3 段已按该口径写成 11，本段按同一口径更新为 13。故此处的绿是**裁定 I-1 生效的结果**，不是 T078 预期落空，也不是把断言放宽（守护力不变：仍是精确数组相等，新族接入照样被拦下并显式落账）。

#### 其他核对

- **FR-049 三条代理判据**（Phase C 收口实跑，全空）：
  ```
  git diff -G'暂停'            --stat -- 'plugins/spec-driver/skills/*/SKILL.md'   → 0 行
  git diff -G'AskUserQuestion' --stat -- 'plugins/spec-driver/skills/*/SKILL.md'   → 0 行
  git diff --stat -- plugins/spec-driver/config/orchestration.yaml                 → 0 行
  ```
- **`mcp__` 字面量**：`git diff -G'mcp__' --stat -- 'plugins/spec-driver/skills/*/SKILL.md'` → **0 行**；两份新模板 `grep -c 'mcp__'` 均为 **0**。
- **`repo:sync` 与定向回退**：见 **D-18**（19 份定向回退、16 份 wrapper 保留）。

---

## 本段（Phase C）新增 / 修改文件清单

**新建（3）**

- `plugins/spec-driver/templates/agent-output-discipline.md`（共享块 1，74 行；FR-014 / FR-016 / FR-018 / FR-019 的单一事实源；`## 轻量三纪律` 留空待 Phase D，见 D-19）
- `plugins/spec-driver/templates/gate-tasks-scope-cut-acceptance.md`（共享块 3，83 行；FR-005 / FR-060 的单一事实源）
- `specs/277-spec-driver-engine-hardening/verification/d5-observations.md`（D-5 观察窗口账本，48 行；观察 0 条）

**修改（13，手写）**

- `scripts/sync-agent-docs.mjs`（`sectionConfigs` **append** 第 12 / 13 个 entry，各带落 targets 的理由注释）
- `plugins/spec-driver/agents/{implement,specify,plan,tasks}.md`（各 1 对块 1 marker + 1 行注入说明；**`agents/verify.md` 未动**）
- `plugins/spec-driver/skills/spec-driver-{feature,story,implement,refactor}/SKILL.md`（各 1 对块 3 marker + 注入说明行，插在已有 `GATE_TASKS` 段后）
- `plugins/spec-driver/skills/spec-driver-{resume,sync,doc}/SKILL.md`（各新建 `### GATE_TASKS 裁剪接受口径` 小节 + 1 对块 3 marker，见 D-16）
- `tests/integration/spec-drift-repo-check-regression.test.ts`（K14 清单 11 → 13，裁定 I-1）

**再生（16，由 `npm run repo:sync` 产出，非手写）**

- `.codex/skills/spec-driver-{feature,story,implement,fix,resume,sync,doc,refactor}/SKILL.md`（8）
- `plugins/spec-driver/skills-codex/spec-driver-{同上 8 个}/SKILL.md`（8）

**未动**：`spec.md` / `plan.md`（只读参考）；Phase B / D / E 的任何文件；`plugins/spec-driver/agents/verify.md`；`plugins/spec-driver/config/orchestration.yaml`；`tests/fixtures/spec-drift/repo-check/repo-check-baseline.json`（`[禁改]`）；任何 `.snap`；`specs/products/**` 与 `.specify/project-context.suggestions.*`（`repo:sync` 顺带刷新后已定向回退 19 份，见 D-18）。

---

## 对抗修订段（Phase A · commit ① 前）留痕

### D-20 · α-C1/C2/C3 同根：挂载判据的抽象层次选错了（本轮已收口）

- **事实**：`orchestration-schema.mjs` 的 `isGateMountedInMode` 是纯结构存在性判据——只问「某个 phase 的 `gates_before ∪ gates_after` 里有没有这个字符串」，不问那个 phase 会不会被执行、也不问它站在序列的哪个位置。而同一份配置里就有两个 phase 级抑制开关（`conditional` / `skip_if_exists`，见 `shouldExecutePhase`）。
- **修订前实测（三道防线同时失明，编排器亲自复现，命令与输出见下方「红 → 绿」表）**：三份攻击 override 下 `get-gate-behavior feature GATE_DESIGN` 答 `mounted: true / mounted_in_base: true`，`effective-orchestration feature` 的 diagnostics 只有 `info:mode-overridden`，`validate-gate-mounting` `status = pass`（12 条断言全绿）。
- **处置**：新增 `evaluateGateMountingAgainstBase(effective, base, mode, gateId)` —— **base 锚定的可达性**。锚点 = base 中每个挂载该 gate 的 `(phase.name, side)` 对；对每个锚点判三条：`missing-anchor`（同名同侧仍挂）/ `suppressor-added`（`conditional`、`skip_if_exists` 与 base **逐字相等**）/ `order-broken`（base 中位于该锚点之后的每个 phase 名，在 effective 中索引更大；缺席也计破坏）。同名同侧多候选时，取「存在一个同时满足后两条的候选」即通过——该候选是一处真实、可达且位序正确的挂载，用它作见证不构成绕过面。
- **`mounted` 的两支定义（与编排器给的公式的**一处微调**，此处留痕）**：编排器原式为 `mounted = mountedInBase && violations.length === 0`。实现取 `mountedInBase ? violations.length === 0 : isGateMountedInMode(effective, …)`——差别只在 `mountedInBase === false` 且 effective 自己加了挂载这一支：按原式会答 `false`（一句假话），按实现答 `true`（诚实）。**不开洞**：FR-068 的判据是 `mounted_in_base ⇒ mounted`，前件为假时蕴含式空洞成立，两种取值对判据结果无差别。既有用例 `resume/GATE_DESIGN`、`fix/GATE_TASKS`、`feature/GATE_IMPLEMENT_MID` 三条在两式下同为 `false`。
- **`isGateMountedInMode` 的现状**：**保留但降级为内部辅助**，全仓唯一调用点是上述那一支。resolver、Orchestrator / CLI、`repo:check` 三处防线**没有任何一处**再把它当判据（`command grep -rn isGateMountedInMode` 实测：`orchestration-schema.mjs` 定义 1 处 + 该支调用 1 处 + 测试文件引用若干，`orchestrator.mjs` / `orchestrator-cli.mjs` / `validate-gate-mounting.mjs` 三份**零命中**）。

### D-21 · FR-053 事后守护刻意**不**改为 base 锚定形式（与编排器指示的一处出入，理由两条）

- **编排器指示**：「`scripts/validate-gate-mounting.mjs` 的挂载断言改为调用同一谓词」。
- **不照做的理由 1（会让守护项恒真）**：resolver 已在合并阶段拒绝强制 mode 的挂载违规并**整份回退 base**，故本守护项经 CLI 读到的 effective 对强制 mode **恒等于 base**，base 锚定的相对判据在这个运行位面上**永远无法为假**。一个不可能为假的闸门给出的 `pass` 不是证据——这正是 F270 已登记的「闸门判据被自家路径恒满足」反模式。
- **不照做的理由 2（会丢掉本守护项唯一承担的路径）**：相对形式对「base 被直接编辑掉挂载」失明（`mounted_in_base` 同步变假、蕴含式空洞成立），而那是 FR-068 明写「第一道闸看不见、交由事后守护」的那条路径。
- **实际处置（绝对形式，但收紧）**：(i) 由「存在挂载锚点」收紧为「**存在一个 `conditional` 为 `null` 的挂载锚点**」，共用同一个锚点解析器 `collectGateMountAnchors`。**断言条数不变，仍是 12**，FR-053 口径无需修订。
- **为什么只收紧到 `conditional`、不一并要求 `skip_if_exists === null`（实测前提，不是推测）**：base 自身的 `story.specify.gates_after` / `story.plan.gates_before` / `story.plan.gates_after` / `implement.plan.gates_before` 四处 `GATE_DESIGN` / `GATE_TASKS` 锚点**全部**带 `skip_if_exists`（实测清单见下表）。一并要求会把**未经改动的仓库**判红——变异体 M2 已实证：把判据改成 `conditional === null && skipIfExists === null` 后，`本仓根：12 条全 PASS` 用例直接红。
- **残余（已写进守卫散文的残余 4，不得口径为「已覆盖」）**：「base 里的锚点被直接加上 `skip_if_exists`」这条路径**两道守护都不覆盖**，只由 base 配置文件进入人工复核承担。

**base 的挂载锚点实测清单**（`python3` 解析 `config/orchestration.yaml`，含抑制开关）：

| mode | phase | side | conditional | skip_if_exists |
|---|---|---|---|---|
| feature | `3.5 gate_design` | gates_after | null | null |
| feature | `4 plan` | gates_before | null | `plan.md` |
| feature | `5.5 analyze` | gates_after | null | null |
| feature | `6 implement` | gates_before | null | null |
| story | `2 specify` | gates_after | null | `spec.md` |
| story | `3 plan` | gates_before / gates_after | null | `plan.md` |
| implement | `2 plan` | gates_before | null | `plan.md` |
| implement | `4 analyze` | gates_after | null | null |

⇒ `story` 的 GATE_DESIGN / GATE_TASKS 与 `implement` 的 GATE_DESIGN 共 **3 组 (mode, gate)** 在 base 里就**没有任何无 `skip_if_exists` 的锚点**；`conditional` 侧则 8 处全为 null，故按 `conditional` 收紧对干净仓库零影响。

### D-22 · α-W2 一并收口：`extractFrontmatterTools` 对重复 `tools:` 键改为 fail-loud

- **事实**：取值规则是「行内优先、其次块状、各取第一个」，与任何符合规范的 YAML 语义都不同（后者要么报错、要么末键胜出），实测连文档顺序都不看。于是「先放一份与冻结快照同集的行内数组当诱饵、再用块状序列把工具面扩到含 `Write` / `Edit`」能让本卡自己的 `verify:no-added-tools` 护栏判绿。
- **本轮修的理由**：被绕过的护栏正是本卡的交付物（FR-016 / FR-017）。把「刚上线的门禁带着已知绕过入库」留到后续卡，是本仓多次被罚过的模式。
- **处置**：frontmatter 内 `^tools:` 出现 > 1 次即 `throw`（不猜「哪一份才算数」——运行时解析器取哪一份不在本仓可观测范围内）。两个消费方各自 fail-closed：`agent-tools-core.validateAgentTools` 的既有 catch 已把异常映射为 `fail`；`namespace-consistency-core` 的循环内**新增 try/catch**，就地记 `fail` 并 `continue`，**check id 集合与基线一致**（不因 throw 丢结论，同 A2 段 `validateSharedAgentDocsSafely` 的方向）。
- **变异测试**：把 `if (toolsKeyCount > 1)` 改成 `if (false && …)` 后，新增的 3 条用例红（verify 诱饵 / 正向 agent 诱饵 / namespace 族），还原后全绿。
- **诚实边界**：绕过成立的另一半——Claude Code / Codex 侧 agent frontmatter 解析器**实际取哪一份**——本轮仍**未取到证据**（本仓 `node_modules` 无 `js-yaml` / `yaml`，运行时解析器不在本仓）。已确证的只是「守护项的读法必然与任一符合规范的解析器不一致」，故它对这类文档给出的 `pass` 不构成证据。现在它一律判红，方向 fail-closed。

### D-23 · α-W1 / α-W3 / α-I1~I5 的处置（本轮**登记不修**的逐条理由）

| 项 | 结论 | 理由 / 已做的处置 |
|---|---|---|
| **α-W1** 禁改集甲/乙与 FR-053 (iii)(iv) 共 4 项守护打在**引擎不读**的 `default_behavior` 上 | **登记不修**，**移交编排器做 SC 口径修订** | 该报告的穷举证明本轮已复核成立：`getDefaultBehaviorForPolicy` 对 `GATE_DESIGN` / `GATE_TASKS` 在三种 policy 形态下**恒返回非 null**，`yaml_default` 分支永不进入。改判定对象（换成 `get-gate-behavior` 输出的 `behavior`）或改 `getDefaultBehaviorForPolicy` 的遮蔽语义，**两条都要改 spec**，不在本轮授权内（本轮明禁改 `spec.md` / `plan.md`）。**验收文本不得保留「禁改集已封住 GATE_TASKS 被改成不暂停」这一表述**——被封住的是一条本来就不通的路。 |
| **α-W3** FR-068 判据完全不看 `behavior`；`spec-driver.config.yaml` 侧关门路径无守护 | **本轮不加第 4 条判据**（那是 FR-068 的口径变更 = 改 spec），但**已在守卫散文补登记为残余 3** | 机械路径当前不通（`orchestrator-cli.mjs` 向 Orchestrator 硬传 `{}`），但那是 M10 P1「orchestrator-cli userConfig 恒空」这个**待修缺陷的副产物**。残余 3 逐字写明：`behavior` 为放行取值而 `mounted` 为 `true` 时判据 1 会通过，**不得据此得出「门在场且会停」的结论**。⚠️ **交编排器的排期约束**：FR-068 增设 `behavior !== 'skip'` 判据**必须与修 userConfig 接线同批或先于它**，晚了就是开口子。 |
| **α-I1** 禁改集命中即整份 overrides 作废 | **登记不修**，方向安全 | 属可用性锐边（连带丢弃同文件里全部合法的 `modes.*` 覆盖）。本轮**顺带**在合同 `modes.<mode>` 的 notes 里保留了「**整份 overrides 回退 base**（不是只丢弃该 mode）」这句原文，用户可见。 |
| **α-I2** 守卫对 `$SD_MODE` 无校验，靠第三条命令的副作用兜底 | **登记不修** | 报告结论是「封住了，但靠副作用」。本轮未精简那三条命令，兜底仍在。若将来有人删掉 `effective-orchestration` 那条，这条兜底随之消失——已由本条留痕。 |
| **α-I3** `generateFallbackConfig()` 的 `implement` 不挂 GATE_DESIGN | **登记不修**（D-7 早已登记，且 `orchestrator.test.mjs` 有断言把它钉成可见事实） | 方向上让 base 损坏时 FR-053 (i) 必红，是正确的 fail-loud。 |
| **α-I4** `repo:check` 侧传 `--project-root`、守卫散文三条命令不传 | **登记不修** | 从子目录发起的运行与 `repo:check` 可能读两份不同的 overrides。报告同时实测 `.specify/orchestration-overrides.yaml` **不在 `.gitignore` 内**（会进 review），威胁面已减轻。改散文加 `--project-root` 需定义「项目根怎么求」，超出本轮射程。 |
| **α-I5** `gates` record 上的 `superRefine` 在 resolver 路径上是死代码 | **登记不修**，但**口径已受约束** | 步骤 6.5 先返回，永远走不到步骤 7。它只对直接调用该 schema 的单测有效。**验收口径不得写「schema 层也拦了一道」**——生产路径上不成立。 |

---

### 修订前后实测对照（红 → 绿，命令原文 + 原始输出）

**红（修订前，编排器亲自复现；生成器 `scratchpad/mkover.mjs`，mutator `conditionalFalse` / `skipIfExists` / `mountAtEnd`）**

```
########## conditionalFalse / skipIfExists / mountAtEnd 三份，输出逐份相同 ##########
  GATE_DESIGN: mounted=True mounted_in_base=True
  GATE_TASKS : mounted=True mounted_in_base=True
  diagnostics= ['info:orchestration-overrides.mode-overridden']
  phases= 18 / 18 / 17          ← 覆盖生效（未回退）
  FR-053 status = pass | errors = 0 | total = 12
```

**绿（修订后，同三份 fixture 入库为 `tests/fixtures/orchestration/attack-feature-*.yaml`）**

```
  mounted=True mounted_in_base=True mounting_violations=[]     ← 覆盖被拒 + 整份回退 base ⇒ effective ≡ base（诚实值，同 D-4）
  diagnostics= ['error:orchestration-overrides.gate-mounting-lost']
  phases= 17 / 17 / 17          ← base 值，已回退
  FR-053 status = fail | failed = ['diagnostics:feature','diagnostics:implement','diagnostics:story']
```

`error` diagnostic 的 detail 原文（`attack-feature-ghost-conditional.yaml`，节选）：

```
mode "feature" 的 GATE_DESIGN 挂载已不可达：
  [missing-anchor] effective 中没有名为 "gate_design" 且 gates_after 仍含 GATE_DESIGN 的 phase /
  [missing-anchor] effective 中没有名为 "plan" 且 gates_before 仍含 GATE_DESIGN 的 phase；
mode "feature" 的 GATE_TASKS 挂载已不可达：…
```

**`mounted: false` 的可观测路径（非强制 mode）**：强制 mode 上的攻击会被 resolver 拒绝并回退，`mounted` 重新变回 `true`；要在 CLI 输出面上直接看到 `mounted: false`，需打在**不在 FR-052 丙射程内**的 mode 上。`attack-fix-ghost-conditional.yaml`（第 4 份 fixture）实测：

```
"behavior": "always", "source": "gate_policy", "is_hard_gate": false,
"mounted": false, "mounted_in_base": true,
"mounting_violations": [{ "kind": "missing-anchor", "phase": "plan", "side": "gates_after",
  "detail": "effective 中没有名为 \"plan\" 且 gates_after 仍含 GATE_DESIGN 的 phase" }]
diagnostics = ['info:orchestration-overrides.mode-overridden']     ← fix 不在射程，resolver 不拒，幽灵 phase 真的落进了 effective
```

它同时是**「CLI 是否真把 `baseConfig` 传给了 Orchestrator」的鉴别用例**：若 CLI 漏传、让 effective 自锚定，本 fixture 下 `mounted` 会错答 `true`。

### 变异测试（证明新增用例承重，不是摆设）

| 变异体 | 改法 | 结果 |
|---|---|---|
| **M0** 判据退回纯结构存在性 | `evaluateGateMountingAgainstBase` 顶部 early-return `isGateMountedInMode` 的答案 | vitest schema：**8 failed / 30 passed**；`node --test` 三份插件测试：**6 failed / 100 passed** |
| **M1** (i) 不看 `conditional` | `liveAnchors = anchors` | `validate-gate-mounting.test.mjs`：**1 failed**（`挂载 phase 全部带 conditional → (i) 判红`） |
| **M2** (i) 过宽收紧 | `liveAnchors = anchors.filter(a => a.conditional === null && a.skipIfExists === null)` | **3 failed**——含 `本仓根：12 条全 PASS`，实证 D-21 的「会把干净仓库判红」不是推测 |
| **W2** 去掉重复 `tools:` 键 fail-loud | `if (false && toolsKeyCount > 1)` | **3 failed**（verify 诱饵 / 正向 agent 诱饵 / namespace 族） |

四个变异体均已**逐一还原**，还原后 `command grep -c MUTANT` 对三份源文件均为 **0**。

### 零误伤证据（既有 fixture 与合法覆盖结论不变）

| 对象 | 判据 | 结果 |
|---|---|---|
| 干净仓根 `validate-gate-mounting` | 12 条断言 | **12 / 12 PASS**（`status = pass`） |
| `attack-feature-drops-gate-design.yaml`（既有攻击 fixture） | T5-1 / T5-2 结论 | **不变**：`error:gate-mounting-lost` + 回退 base；`violations` 仍**恰好** `['feature.GATE_DESIGN']`（GATE_TASKS 不被误报） |
| `valid-overrides-goal-loop.yaml`（`modes.feature` 整段替换，逐字段等价） | 无 `gate-mounting-lost` + `isFallback === false` + `goal_loop` 覆盖仍生效 | **PASS**（T6-6） |
| base 的 `feature.plan` phase（自带 `skip_if_exists: "plan.md"` 且 `gates_before` 挂 GATE_DESIGN） | 原样保留不得判红 | **PASS**（T6-7 + schema 单测两条，前提值在用例内 `assert` 核实，不是假设） |
| `valid-overrides-*` / `invalid-*` / `overrides-with-parallel-groups` 等 8 份既有 fixture | resolver 全量用例 | **56 / 56 PASS**（`orchestration-resolver.test.mjs`） |
| 既有 `mounted` / `mounted_in_base` 6 条用例（`resume`、`fix`、fallback 路径、未知 gate id、boolean 类型） | 逐条 | **全部不变、无一放宽** |

### 本段收口全量（清净窗口 · **串行**）

起跑前：`sysctl -n vm.loadavg` = `{ 1.04 1.31 1.88 }`（1-min **1.04** < 8 阈值）；`pgrep -fl 'vitest|node --test'` = **(无)**。`hw.ncpu` = 18。

| # | 命令原文 | 退出码 | 输出摘要 |
|---|---|---|---|
| 1 | `npm run build` | **0** | 类型检查零错误；`[postbuild:stamp] 盖章: commit=e01611b2 (dirty)` |
| 2 | `npm run test:plugins` | **0** | `枚举到 36 个测试文件`；`tests 1739 / suites 308 / pass 1737 / fail 0 / skipped 2` |
| 3 | `npx vitest run` | **0** | `Test Files 547 passed \| 4 skipped (551)`；`Tests **8089 passed** \| 15 skipped \| 12 todo (8116)`；**failed = 0** |
| 4 | `npm run repo:check` | **0** | check id 总数 **93**；非 pass 仅 **1** 条：`graph-quality:freshness: warn`（D-7 已登记，本卡改动前即存在） |

**用例增量换算式**：`test:plugins` `1718 → 1739`（+21：resolver T6 9 条 + orchestrator 7 条 + validate-gate-mounting 5 条）；`vitest` `8073 → 8089`（+16：schema 12 条 + agent-tools 3 条 + namespace 1 条）。单位：测试用例。`repo:check` **93 项不变**（本轮**未新增 check id**，只收紧既有判据）。

### 注入闭环与 `repo:sync`

| # | 项 | 命令原文 | 结果 |
|---|---|---|---|
| 1 | 注入 | `npm run docs:sync:agents` | `(**5 updated**)` —— 块 2 的 5 份 SKILL |
| 2 | **幂等（逐字节）** | 第 2 次 `npm run docs:sync:agents` + 对 5 份 SKILL 与仓根 `AGENTS.md` / `CLAUDE.md` 逐份 `cmp` | `(**0 updated**)`；`cmp` **汇总退出码 = 0**（7 份逐字节相同）——未用「`git diff` 零输出」作判据 |
| 3 | 字节预算 | `git diff --numstat -- AGENTS.md CLAUDE.md` | **空**（块 2 的 targets 不含仓根两份，K16 预算不受影响；同 T074 的空载口径） |
| 4 | wrapper 再生 | `npm run repo:sync` | 保留 **16 份** wrapper（`.codex/skills/*` 8 + `plugins/spec-driver/skills-codex/*` 8）；`spec-driver-wrappers` 族 6 项全 pass |
| 5 | **定向回退（D-13 / D-18 第 3 次再现，份数逐份一致）** | `git show HEAD:<path> > <path>` × **19** | `specs/products/**` 17 + `.specify/project-context.suggestions.{md,yaml}` 2；回退后 `git diff --stat` 对这 19 份为**空**；`repo:check` 仍 93 项、无一项因此转红 |

### 本段新增 / 修改文件清单

**新建（4，全部是攻击 fixture）**

- `plugins/spec-driver/tests/fixtures/orchestration/attack-feature-ghost-conditional.yaml`（α-C1）
- `plugins/spec-driver/tests/fixtures/orchestration/attack-feature-ghost-skip-if-exists.yaml`（α-C2）
- `plugins/spec-driver/tests/fixtures/orchestration/attack-feature-mount-at-end.yaml`（α-C3）
- `plugins/spec-driver/tests/fixtures/orchestration/attack-fix-ghost-conditional.yaml`（α-C1 的非强制 mode 变体；`mounted: false` 的唯一可观测路径 + CLI `baseConfig` 接线的鉴别用例）

**修改（10，手写）**

- `plugins/spec-driver/contracts/orchestration-schema.mjs`（新增 `collectGateMountAnchors` / `evaluateGateMountingAgainstBase` + 4 个内部辅助；`findLostGateMountings` 改为调用新谓词；`isGateMountedInMode` 降级并加警示注释）
- `plugins/spec-driver/lib/orchestration-resolver.mjs`（`validateGateMounting` 文档口径 + diagnostic detail 带逐锚点 `kind`）
- `plugins/spec-driver/lib/orchestrator.mjs`（`options.baseConfig` + `gateMountingDetailMap` + `getGateMountingDetail`）
- `plugins/spec-driver/scripts/orchestrator-cli.mjs`（`buildOrchestrator` 传 `baseConfig`；`get-gate-behavior` 新增 `mounting_violations` 字段；删掉已不用的 `isGateMountedInMode` import）
- `plugins/spec-driver/scripts/validate-gate-mounting.mjs`（(i) 收紧为「存在无条件锚点」+ 文件头两条理由）
- `plugins/spec-driver/templates/orchestrator-gate-mounting-guard.md`（`mounted` 语义一句 + `mounting_violations` + 残余 2 → 4；`mcp__` / `暂停` / `AskUserQuestion` 三个字面量实测均为 **0**）
- `plugins/spec-driver/contracts/orchestration-overrides-contract.yaml`（丙条改为可达性口径，三条判据逐条写出；`python3 -c "import yaml"` 解析 OK，`supported_overrides` 仍 3 条）
- `scripts/lib/namespace-consistency-core.mjs`（重复 `tools:` 键 fail-loud + 调用点 try/catch 就地记 fail）
- `specs/277-spec-driver-engine-hardening/tasks.md`（Phase A 段末追加「对抗修订（α-C1~C3）」一行，**不新增任务编号**）
- `specs/277-spec-driver-engine-hardening/implementation-notes.md`（本文件）

**修改（6，测试；新增用例合计 37 条）**

| 文件 | 新增用例 | 跑法 |
|---|---|---|
| `plugins/spec-driver/tests/orchestration-resolver.test.mjs` | 9（T6 段） | `node --test` |
| `plugins/spec-driver/tests/orchestrator.test.mjs` | 7 | `node --test` |
| `plugins/spec-driver/tests/validate-gate-mounting.test.mjs` | 5 | `node --test` |
| `tests/unit/spec-driver-orchestration-schema.test.ts` | 12 | `vitest` |
| `tests/unit/agent-tools-core.test.ts` | 3 | `vitest` |
| `tests/unit/repo-check-namespace-guard.test.ts` | 1 | `vitest` |

**换算式**：`9 + 7 + 5 = 21`（`test:plugins`，与 `1718 → 1739` 一致）+ `12 + 3 + 1 = 16`（`vitest`，与 `8073 → 8089` 一致）= **37**，单位：测试用例。

**再生（16，由 `npm run repo:sync` 产出，非手写）**：`.codex/skills/spec-driver-*` 8 + `plugins/spec-driver/skills-codex/spec-driver-*` 8。

**未动**：`spec.md` / `plan.md`（只读参考）；Phase B / D / E 的任何文件；`plugins/spec-driver/config/orchestration.yaml`（`git diff --stat` 空）；`tests/fixtures/spec-drift/repo-check/repo-check-baseline.json`（`[禁改]`）；任何 `.snap`；`specs/products/**` 与 `.specify/project-context.suggestions.*`（已定向回退 19 份）。

---

## 对抗修订第二轮（Phase A · commit ① 前 · β / δ）留痕

**共同根因（三条 CRITICAL 一句话）**：第一轮把「判不出⇒判失败」这条纪律落到了**事实取不到**这一半，没落到**该检查的条目自己消失**那一半。`verify:no-added-tools` 的射程是「解析器**看得见**的那几项工具」，`gate-mounting` 的射程是「配置里**还在**的那几个强制 mode」，位序规则的枚举域是「base **已有**的那几个 phase 名」——三处都把「要检查多少」交给了「被检查的那份数据」。数据一残缺，检查量跟着缩到零，而结论仍然是 `pass`。

### D-24 · β-C1 收口：解析器返回值三分 + verify 护栏改逐字相等

- **事实（修前实测，探针 `scratchpad/p_bc1.mjs`，旧解析器按 `git show HEAD:scripts/lib/namespace-consistency-core.mjs` 逐字复刻）**：12 组构造在**旧解析器 + 旧护栏**下**全部 pass**，其中 M4 / M4b / T1~T3 / b1 / b2 的文件里逐字写着 `Write` 与 `Edit`。

```
构造                                 | 旧解析器所见            | 旧护栏 | 新解析器 | 新护栏
M1 删掉 tools: 键                    | []                     | pass  | null    | fail
M2 整个 frontmatter 删掉              | []                     | pass  | null    | fail
M3 tools: []                        | []                     | pass  | []      | fail
M4 frontmatter 前多一个空行           | []                     | pass  | null    | fail
M4b 文件带 UTF-8 BOM                 | []                     | pass  | null    | fail
M5 tools 写成 mapping                | []                     | pass  | THROW   | fail(族 catch)
T1 块序列中间插空序列项                | ["Read","mcp__…detect"] | pass  | THROW   | fail(族 catch)
T2 块序列中间插注释行                  | ["Read","mcp__…detect"] | pass  | THROW   | fail(族 catch)
T3 块序列中间插空行                    | ["Read","mcp__…detect"] | pass  | THROW   | fail(族 catch)
b1 tools :（冒号前空格）               | [快照 6 项]             | pass  | THROW   | fail(族 catch)
b2 "tools":（引号键）                 | [快照 6 项]             | pass  | THROW   | fail(族 catch)
b3 tools: 后接行内注释                 | []                     | pass  | THROW   | fail(族 catch)
REAL 行内规范写法（对照）              | [快照 6 项]             | pass  | [6 项]  | pass
REAL 块序列规范写法（对照）            | [快照 6 项]             | pass  | [6 项]  | pass
```

- **处置（两处，缺一不可）**：
  1. `scripts/lib/namespace-consistency-core.mjs` 的 `extractFrontmatterTools` 返回值**三分**——`null`（无 frontmatter / frontmatter 内无 `tools` 键）/ **抛错**（有 `tools` 键但写法不受支持）/ **完整数组**。「读不全就返回真子集」这条路径**已删除**。检测正则由 `/^tools:/` 放宽为 `/^[ \t]*(["']?)tools\1[ \t]*:/`（覆盖 δ 的 `tools :` / `"tools":` / 缩进嵌套三类），取值仍只认两种规范写法，其余一律 `throw`。
  2. `scripts/lib/agent-tools-core.mjs` 的护栏 (ii) 由**单向集合差**改为与 `VERIFY_TOOLS_FROZEN_SNAPSHOT` **逐字相等（含顺序）**；断言 id 随语义改名 `verify:no-added-tools` → **`verify:tools-frozen`**（旧名比实现窄，留着即是新的口径不符）。两个消费方各自 fail-closed：`agent-tools` 走既有族 catch，`namespace-consistency` 的 `null` 支与 throw 支各就地记 `fail` + `continue`，check id 集合不变形。
- **一条修前没看见的东西（变异测试逼出来的）**：最初只写了 12 组构造，`M-βC1c'`（忠实复刻旧「静默截断」）**全绿通过**——因为逐字相等护栏对「截断后是真子集」同样判红，12 组里没有一组能区分「解析器 fail-loud」与「护栏兜底」。补了 **T4~T7**：`tools:` 块序列的**前 6 项逐字就是冻结快照**、`Write` / `Edit` 落在 gap 之后。截断读到的正是快照本身 ⇒ 逐字相等**成立** ⇒ 旧实现判 pass。补上后 `M-βC1c'` 转红（T4 / T5 各一条）。**结论**：解析器 fail-loud 与护栏逐字相等是两道独立承重的闸，不能互相顶替；若当时只跑「12 组全红」就收工，会把一条真实的绕过面当成已覆盖。
- **诚实边界（δ-W2 的口径修订，已写进函数 doc）**：本文件是**手写词法**，不是 YAML 解析器。检测面只有那条行首正则，**不覆盖** YAML 显式键语法（`? tools` / `: [...]`）、多文档流、锚点与别名。这些形态下返回 `null`（消费侧判 fail，方向安全），但那是「看不见 ⇒ 当作没写」的巧合，**不是判据覆盖**。故 D-22 与函数 doc 早前那句「歧义文档一律判红」按本条收窄，不得再按旧口径引用。根治要引 YAML 依赖，与 FR-037 零依赖纪律冲突，须走 spec 修订。

### D-25 · β-C2 收口：强制 mode 清单钉为常量下界 + base 缺段发 error

- **事实（β 报告实测）**：`resolveGateMountingEnforcedModes` 末尾的 `.filter(mode => baseModes[mode] !== undefined)` 让射程与事实取自同一份文件。删掉 base 的 `modes.implement` 整段 ⇒ `for` 循环少转两圈、`errors` 为空、FR-053 `status = pass` 且 `evidence.total` 由 **12** 变 **9**（三条断言**整条消失**，不是判 fail）；`effectiveConfig` 取不到时同样掉到 9（β-W4：缺的正是 `feature` 的三条，而 `validate-gate-mounting.mjs:97` 的注释宣称「不缩小射程」）。
- **处置（三处）**：
  1. 新增导出常量 `GATE_MOUNTING_MANDATORY_MODES = Object.freeze(['feature','story','implement'])`（与 spec FR-053「强制 mode 取 feature / story / implement 三者」逐字同源），`resolveGateMountingEnforcedModes` 以它为**下界**、并上 `hard_gate_modes` 派生增量，**删掉按 `modes` 键的过滤**——派生只能扩不能缩（F259 的「写死字面量则每加一个值漏一次」仍被覆盖，因为增量侧仍是派生的）。原 `GATE_MOUNTING_MANDATORY_TIER_MODES`（`['story','implement']`）**删除**，它的存在前提「`feature` 由 base 派生」正是这条洞的入口。
  2. `evaluateGateMountingAgainstBase` 的 `baseAnchors.length === 0` 支**一分为二**：base 的该 mode 段**可读但没挂这道门** ⇒ 仍答 `mountedInBase: false` + 零违规（`resume` / `fix` / `feature`×`GATE_RESEARCH` 不受影响）；base 的该 mode 段**整个读不出** 且是强制 mode × 强制 gate ⇒ 这是**判不出**，按 FR-068 (3) 代入 `mountedInBase: true`，此时 `mounted` 必须为 `true`，否则记 `mandatory-mode-missing`。
  3. resolver 新增**步骤 1.5**：`findMissingMandatoryModes(baseConfig)` 非空即发 `error:orchestration.mandatory-mode-missing`。**位置承重**——放在步骤 9.5（门挂载校验处）会被 overrides 侧若干「回退 base 并提前 return」的分支整类绕过（YAML 语法错 / version 不一致 / schema 不过），已配用例「缺 mode + overrides 同时写坏 ⇒ 该 error 仍在」钉死。
- **`validate-gate-mounting.mjs` 的连带（不做会把缺陷换个形式重演）**：CLI 对「mode 在配置里不存在」是 `exit 1`，`execFileSync` 抛错会被族入口的 catch 收敛成**一条** check——12 条断言又一次消失。故取事实改为逐条 `tryRunCli`，失败只把错误原文归档进 `factErrors` 并让对应断言判 fail。
- **红灯条数分两个平面，不得混引（第三轮 I-1 更正，原文把纯函数平面的数字写成了「实测」改文件的结果）**：
  - **纯函数平面**（`evaluateGateMountingAssertions` 直接吃合成输入，diagnostics 按 mode 分别注入）：删 `implement` ⇒ **12 条，3 条红**（`mounting:implement:{GATE_DESIGN,GATE_TASKS}` + `diagnostics:implement`）；三段全删 ⇒ **12 条，9 条红**（6 挂载 + 3 diagnostics，字段类三条仍绿）；`effectiveConfig: null` ⇒ **12 条全红**（β-W4 的注释自此为真）。三者各有用例钉死（`validate-gate-mounting.test.mjs` 的「减」方向 5 条）。
  - **端到端平面**（真删 base 文件里的 mode 段 + 真 resolver + 真 CLI，第三轮亲测）：删 `implement` ⇒ **12 条，5 条红** —— 多出 `diagnostics:feature` 与 `diagnostics:story`，因为 resolver 步骤 1.5 的 `mandatory-mode-missing` 是**每次 resolve 都发、不分 mode**，三条 `diagnostics:*` 必然一起红；三段全删 ⇒ **12 条，11 条红**，唯一仍绿的是 `is-hard-gate:feature:GATE_DESIGN`（它读的是 base `gates` 块里仍在的 `hard_gate_modes`），两条 `default-behavior:*` 的 detail 为「实际取值: undefined」。
  - 两个平面都是真实观测，方向均偏严；**引用时必须带平面标注**，否则后来者会把纯函数平面的 3 / 9 当成端到端基线。

### D-26 · δ-C1 收口：位序规则扩到 base 未定义名字的新 phase

- **事实（修前，编排器亲自复现；变异体 `MUTANT-δC1` = 去掉新子句）**：两份 fixture 下三道防线**全绿**且覆盖**真的生效了**——

```
########## attack-story-prepend-producers (story) ##########
  GATE_DESIGN mounted= True in_base= True viol= []
  GATE_TASKS  mounted= True in_base= True viol= []
  diagnostics= ['info:orchestration-overrides.mode-overridden']
  phases= 7 ['spec_early', 'plan_early', 'constitution', 'specify']    ← 覆盖已落地
  FR-053 status = pass | passed 12 / 12
########## attack-implement-prepend-plan-early (implement) ##########
  （逐位同型；phases= 7 ['plan_early', 'clarify', 'plan', 'tasks']）
```

- **修后（同两份 fixture，同三条命令）**：

```
########## attack-story-prepend-producers (story) ##########
  GATE_DESIGN mounted= True in_base= True viol= []      ← 回退 base 后的诚实值（同 D-4 口径）
  diagnostics= ['error:orchestration-overrides.gate-mounting-lost']
  phases= 5 ['constitution', 'specify', 'plan', 'implement']   ← 已整份回退 base
  FR-053 status = fail | passed 9 / 12
  FR-053 failed = ["diagnostics:feature","diagnostics:implement","diagnostics:story"]
########## attack-implement-prepend-plan-early (implement) ##########
  diagnostics= ['error:orchestration-overrides.gate-mounting-lost']   phases= 6
  FR-053 status = fail | passed 9 / 12
```

- **处置**：判据 3（位序）由一条变两条子句——**3a** 保持原样（base 中位于锚点之后的 phase 在 effective 中仍在其后）；**3b** 新增：effective 中任何 **base 未定义名字**的 phase，若 `agent != null` 且 `agent_mode !== 'gate'`（产出型），其索引不得小于见证候选锚点的索引，否则记 `foreign-phase-before-gate`。`agent === null`（inline）与 `agent_mode: gate`（门位本身）不计——它们不产出制品，插在锚点前不改变任何 `skip_if_exists` 的真值。name 不是字符串的产出型 phase 一律计入（判不出⇒从严）。
- **为什么不走「判据 2 升级为 skip_if_exists 不可被前驱满足」那条**：那要一张 `agent → 制品` 的映射表，而该表在 base 里只能从各 phase 自己的 `skip_if_exists` 值反推——用被攻击的那份数据推导判据的射程，正是本轮三条 CRITICAL 的同一个反模式。3b 不需要任何映射表。
- **「同名重复取首个」已由用例钉死**（δ-I3）：`buildFirstIndexByName` 取最小索引是**判据**不是实现细节——重名时只要任意一份同名 phase 跑到锚点前面，那段产出就可能提前发生。已配用例「base 后继 `tasks` 的同名副本前移到序列最前 ⇒ `order-broken`」，注释写明它与 `candidates` 取全集（从宽找见证）方向相反且两者都是刻意的。
- **零误伤**：`valid-overrides-goal-loop.yaml`（`modes.feature` 整段替换、phase 名全部来自 base）仍 `isFallback === false` 且 `goal_loop` 覆盖生效；`valid-overrides-gate` / `valid-overrides-mode-fix` / `valid-overrides-parallel-scheduling` / `overrides-with-parallel-groups` 四份 diagnostics 与修前逐位一致；干净仓根 FR-053 仍 **12 / 12**。

### D-27 · β-W2 收口：`SD_MODE` 窄断言（并进既有 check id，**不新增 check id**）

- **事实**：块 2 唯一的 per-file 参数是 marker **之外**紧邻上方的 `SD_MODE=<mode>`，而 `syncSection` 的漂移比对按 `indexOf(beginMarker)` / `indexOf(endMarker)` 切片，只覆盖 marker **之间**的字节——那一行结构性不在比对范围内，全仓对 `SD_MODE` 此前**零守护**。写成另一个**合法** mode 时三条命令全部 `exit=0`、字段齐全、判据 1/2/3 全过（`feature` 永远 `mounted=true`），α-I2 记的那条「靠第三条命令 exit=1 兜底」只对空值 / 非法值成立。
- **处置**：`scripts/sync-agent-docs.mjs` 的 section 配置新增可选 `preludeGuard`，块 2 挂上 `checkSdModeDeclaration`——判据只有一条：BEGIN marker 之前**最近**的 `SD_MODE=` 取值必须等于该 SKILL 目录名去掉 `spec-driver-` 前缀。结论并进块 2 **既有的** `agent-docs:shared-section:orchestrator-gate-mounting-guard`。
- **为什么不新增 check id**：新增会连带改 SC-006 的分母（94 → 95）与 K14 的精确数组，且 FR-017 / FR-053 各自把断言数钉死为 8 / 12，塞进那两族会破坏 spec 的换算式。并进既有 id 后，5 份源被守住即覆盖 15 份副本——`skills-codex/` 与 `.codex/skills/` 两批是 wrapper 生成器按 body-sha256 复刻源 SKILL 的产物，已由 `spec-driver-wrappers` 族比对。
- **变异体**：`checkSdModeDeclaration` 恒返回 `null` ⇒ `tests/unit/agent-docs-sd-mode-guard.test.ts` **5 / 9 红**；还原后 9 / 9 绿。

### D-28 · 本轮的口径修订清单（把没成立的性质写成已成立的地方，逐处改文本）

| 处 | 原口径 | 改后 | 触发项 |
|---|---|---|---|
| `validate-gate-mounting.mjs` 文件头 | 「强制 mode 清单从 `hard_gate_modes` 与 mode 分层矩阵**派生**，不写字面量」 | 改为「以常量下界 + 派生增量，只扩不缩」，并写明旧实现的 12→9 实测 | β-C2 / β-W4 |
| `validate-gate-mounting.mjs:97` 注释 | 「effective 取不到时**不缩小射程**」（实测缩到 9） | 该性质现在**真的成立**（12 条），注释按新事实重写 | β-W4 |
| 守卫散文 `orchestrator-gate-mounting-guard.md` 判据 1 | 「`mounted` = 与 base 锚定且可达」（只描述了 `mounted_in_base === true` 那一支） | 改为**分两支**表述，明写 `mounted_in_base === false` 支是**纯结构存在性**、其 `true` 不构成「门在场」的证据 | δ-W1 |
| 同上 · 残余 2 | 「事后守护只覆盖『锚点被删掉』与『锚点被加 conditional』两种形态」（而「整段删 mode」实测 pass） | 补写「整段删 mode 这一形态已由两处接住」（resolver error + 常量射程），并保留原残余 | β-C2 |
| 同上 · 残余 4 | 只写「base 锚点被直接加 `skip_if_exists`」 | 补写射程说明：同类失效的另一半（插队产出型 phase）**已闭合**，残余 4 只剩「直接编辑 base 锚点」；两者 review 强度不同，不得互推 | δ-I2 |
| 同上 · 新增残余 5 | 无 | 写明 `get-gate-behavior` 输出面**不带降级标记**，base 损坏类只由判据 2 一条闸门承担，故**三条命令不得精简为两条** | β-W3 |
| `orchestrator-cli.mjs` 的 `mounted` 字段注释 | 同守卫散文旧口径 | 同上分两支表述 | δ-W1 |
| 合同 `orchestration-overrides-contract.yaml` 丙条 | 位序只有一条子句；未写射程下界 | 补 3a / 3b 两子句 + 强制 mode 常量下界 + `mandatory-mode-missing` | δ-C1 / β-C2 |
| `namespace-consistency-core.mjs` 函数 doc | 「歧义文档一律判红」 | 补**诚实边界**段：手写词法覆盖不到显式键 / 多文档流 / 锚点别名，那几类返回 `null` 是巧合不是覆盖 | δ-W2 |

### D-29 · β / δ 的 WARNING / INFO 逐条处置

| 项 | 结论 | 理由 |
|---|---|---|
| **β-W1** 块 1 文本断言是**全文短语存在性**（6 个词散落在注释 / 代码块 / 变更历史行里也判 pass） | **登记不修**（另立卡） | 审查员本人定为「可另立卡」。修法是把 6 条短语限定在同一段落内、或对该段做规范化 sha256 冻结——后者会新增一个与 `VERIFY_TOOLS_FROZEN_SNAPSHOT` 同型的冻结值，属 FR-017 (iii) 的判据变更（改 spec）。方向上它当前**不是** fail-open 的唯一守门人：块 1 的正文本身由 `agent-docs` 漂移守护逐字锁住，改坏正文会先被那族抓到。 |
| **β-W2** `SD_MODE` 无守护 | **本轮已修** | 见 D-27 |
| **β-W3** `get-gate-behavior` stdout 无降级标记 | **口径已改，判据不动** | 加 `degraded` 字段并写进判据 1 = FR-068 的判据变更（改 spec，本轮明禁）。已在守卫散文新增残余 5，写明「三条命令不得精简为两条」——这正是该风险的可执行约束。 |
| **β-W4** `:97` 注释与实际相反 | **本轮已修（改的是行为，不是注释）** | 见 D-25：射程有了常量下界之后，该注释所述的性质**真的成立**。修行为比改注释强，因为注释所述本就是应有语义。 |
| **β-W5** `validateSharedAgentDocs` 一处抛错抹掉全族 13 个 `shared-section:*` | **登记不修**（另立卡） | 审查员定为「可另立卡」；方向是 fail-loud（`errors` 非空 ⇒ 顶层 fail），问题在信号形态与 K14 的红灯混淆。修法（per-section try/catch）会改变失败态的 check id 集合，属守护项行为变更，本轮射程内没有它的验收位。 |
| **β-W6** 块 3 里唯一约束 `fix` 的规则没发给 `fix` | **登记不修**（另立卡） | 审查员定为「可另立卡」。它是**块 3 的 targets 设计**问题（Phase C 的落点），改动会动 `sectionConfigs` 的 targets 与 SC-008 分母；本轮是 Phase A 收口，不动 Phase C 的射程。 |
| **β-I1** `aggregateValidation` 不读 `result.status` | **登记不修** | 当前三个新族都做到 `errors` 与 `fail` 断言 1:1，未触发；属结构性风险，且改它会影响全部 17 族的聚合语义。 |
| **β-I2** `orchestrator.mjs:43` 的 `baseConfig \|\| this.config` 自锚定 | **登记不修** | 生产路径只有 `orchestrator-cli.mjs:73` 一处且已正确传参（已有用例钉死）；改为 required 会打断 `Orchestrator` 的向后兼容构造，属独立改动。 |
| **β-I3** 缺 zod 时项目级 overrides 整份静默失效 | **登记不修** | 安全方向正确（未经校验的用户输入落不了地）；可用性问题属发布面文档项，不在本轮射程。 |
| **β-I4** 块 3 「门不停时的判定」列的两条路径当前不可达 | **登记不修** | 与 α-W1 / α-W3 同一根（`getDefaultBehaviorForPolicy` 遮蔽 + userConfig 恒空），已由 D-23 登记并移交编排器做 SC 口径修订。 |
| **β-I5 / β-I6** `getGateBehavior` 未知 gate 偏松 / `\|\|` 吃空串 | **登记不修** | 两条当前均不可达（`mergeOrchestrationConfigs` 的 `allGateIds` 只对 base 里存在的 gate 落盘；zod enum 挡住空串），已在报告内留痕。 |
| **δ-W1** `mounted` 两支语义、注释只描述第一支 | **口径已改** | 见 D-28。字段改名或该支返回 `null` 都是输出面的**破坏性变更**（守卫散文判据 1 直接读 `mounted`，FR-068 明写「取不到 ⇒ BLOCKED」，返回 `null` 会让 `resume` / `fix` 永久 BLOCKED——正是 spec 修订记录第 1 行推翻过的那条）。 |
| **δ-W2** 「歧义文档一律判红」是 over-claim | **本轮既扩检测面又改口径** | 检测面已扩到 `tools :` / `"tools":` / 行内注释三类（δ 的 b1/b2/b3 现均 throw），仍覆盖不到的形态已在函数 doc 写成诚实边界（D-24 末段）。 |
| **δ-I1** 判据 2 逐字相等把「放宽抑制条件」也判红、且 detail 文案与事实相反 | **登记不修**，但**文案不改也留痕** | 方向 fail-closed。改为偏序（`null` 弱于任意非 null）会引入「什么叫更弱」的新判据面，且 `conditional` 表达式之间无法定序；本轮不做。文案「抑制条件强于 base」在放宽方向上确实与事实相反，属排障体验，随 δ-I1 一并登记。 |
| **δ-I2** 残余 4 声明范围窄于实际洞 | **本轮已改** | 见 D-28（插队那半边已由 δ-C1 闭合，残余 4 收窄为「直接编辑 base 锚点」）。 |
| **δ-I3** 重名时 `buildFirstIndexByName` 取首、`candidates` 取全集，两处口径不同 | **本轮已加 doc + 用例** | 见 D-26 末段。两处方向相反是刻意的，现在函数 doc 写明了它与 witness 语义的关系，并配一条钉死「取首个」的用例。 |

### D-30 · 变异测试（每处修复至少一个变异体红）

| 变异体 | 改法 | 结果 |
|---|---|---|
| **M-βC1a** 解析器「读不出」重新返回 `[]` | `if (!fmMatch) return []` + `keyLineIndexes.length === 0 ⇒ []` | `agent-tools-core.test.ts` **1 failed / 38 passed**（三分返回值用例）；`repo-check-namespace-guard.test.ts` **14 passed**——**如实登记**：namespace 族对 `null` 与 `[]` 判同一结论（都 fail），该分支的独立承重面只在解析器契约用例上 |
| **M-βC1b** 护栏退回单向集合差 | `equal = added.length === 0` | `agent-tools-core.test.ts` **3 failed / 36 passed** |
| **M-βC1c'** 块序列恢复「静默截断」 | 遇 gap / 空项 / 注释项即 `break`（忠实复刻旧正则语义） | 补 T4~T7 之**前**：**43 passed（全绿，未抓到）**；补之**后**：**2 failed**（T4 gap 是空行 / T5 gap 是注释行）。见 D-24 末段 |
| **M-βC1d** 键行检测正则收窄回 `/^tools:/` | 同左 | `agent-tools-core.test.ts` **2 failed / 37 passed**（b1 / b2） |
| **M-βC2a** 射程恢复按被守护配置过滤 | 末尾加回 `.filter(m => baseModes[m] !== undefined)` | `validate-gate-mounting.test.mjs` **4 failed / 19 passed**；`spec-driver-orchestration-schema.test.ts` **5 failed / 48 passed** |
| **M-βC2b** 删掉「base 缺强制 mode ⇒ `mountedInBase` 按 true」支 | `const undecidable = false` | `spec-driver-orchestration-schema.test.ts` **2 failed / 51 passed** |
| **M-βC2c** 删掉 resolver 的 `mandatory-mode-missing` | `missingMandatoryModes = []` | `orchestration-resolver.test.mjs` **6 failed / 60 passed** |
| **M-βW2** `SD_MODE` 守卫恒返回 `null` | 函数首行 `return null` | `agent-docs-sd-mode-guard.test.ts` **5 failed / 4 passed** |
| **M-δC1** 去掉位序 3b 子句 | witness 判据删掉 `firstForeignProducerBefore` | `spec-driver-orchestration-schema.test.ts` **2 failed / 51 passed**；`orchestration-resolver.test.mjs` + `validate-gate-mounting.test.mjs` 合跑 **4 failed / 85 passed**；三道防线探针复现修前全绿（见 D-26） |

九个变异体均已**逐一还原**，还原后 `command grep -rn MUTANT`（排除 `node_modules` / `.git` / `dist` / scratchpad / 本文件）**零输出**。

### D-31 · 本轮收口全量（清净窗口 · **串行**）

起跑前 `sysctl -n vm.loadavg` 1-min = **1.11**（< 8，无需等待）。

| 命令 | 退出码 | 输出摘要 |
|---|---|---|
| `npm run build` | **0** | `[postbuild:stamp] 盖章: commit=e01611b2 (dirty)`，类型检查零错误 |
| `npm run test:plugins` | **0** | `tests 1756 / pass 1754 / fail 0 / skipped 2`（对抗修订第一轮收口时为 1739 / 1737） |
| `npx vitest run` | **0** | `Test Files 548 passed \| 4 skipped (552)`；`Tests 8132 passed \| 15 skipped \| 12 todo (8159)` |
| `npm run repo:check` | **0** | `status=warn`，**93** 项，非 pass 仅 `graph-quality:freshness: warn`（图产物 sourceCommit 与 HEAD 不一致，与本卡改动面零交集）；`agent-tools:required` = pass、`gate-mounting:effective-config` = pass、3 个本卡 `agent-docs:shared-section:*` 全 pass |

**FR-049 代理判据**（对 24 份 SKILL 的 diff）：`git diff -G'暂停'` / `-G'AskUserQuestion'` / `-G'mcp__'` 三条**均为 0 个文件**。

**`docs:sync:agents` 幂等**：一跑 `5 updated` → 快照 → 二跑 `0 updated` → 对全部含块 2 marker 的文件逐字节 `cmp`，**diff 数 = 0**。

**`repo:sync` 后的定向回退（19 份）**：`.specify/project-context.suggestions.{md,yaml}` 2 份 + `specs/products/_generated/*.yaml` 3 份 + `specs/products/spec-driver/_generated/*` 9 份 + `specs/products/spectra/_generated/*` 5 份，逐份 `git show HEAD:<path> > <path>`，回退后 `git diff --quiet` 逐份为真。**保留**的是本卡 SKILL 触发的 10 份 wrapper：`.codex/skills/spec-driver-{feature,fix,implement,resume,story}/SKILL.md` + `plugins/spec-driver/skills-codex/` 同名 5 份。

### 本轮新增 / 修改文件清单

**新增（3）**

- `plugins/spec-driver/tests/fixtures/orchestration/attack-story-prepend-producers.yaml`（δ-C1：`modes.story` 整段替换，锚点逐字保持 base，只在最前插 `spec_early` / `plan_early`）
- `plugins/spec-driver/tests/fixtures/orchestration/attack-implement-prepend-plan-early.yaml`（δ-C1：同型，`implement` 只需一个 `plan_early`）
- `tests/unit/agent-docs-sd-mode-guard.test.ts`（β-W2 的 9 条用例）

**修改（源码 6）**

- `scripts/lib/namespace-consistency-core.mjs`（解析器三分返回值 + 检测正则放宽 + 块序列遇不可归类行即 throw + 诚实边界 doc；消费侧 `null` 支就地记 fail）
- `scripts/lib/agent-tools-core.mjs`（护栏改逐字相等 + `diffAgainstFrozenSnapshot` + 断言 id 改名 `verify:tools-frozen`）
- `plugins/spec-driver/contracts/orchestration-schema.mjs`（`GATE_MOUNTING_MANDATORY_MODES` / `isModeReadable` / `findMissingMandatoryModes` 三个新导出；删 `GATE_MOUNTING_MANDATORY_TIER_MODES`；`resolveGateMountingEnforcedModes` 去过滤；`evaluateGateMountingAgainstBase` 的缺席支一分为二 + 位序 3b 子句；新增 `isProducerPhase` / `collectForeignProducers` / `firstForeignProducerBefore` 三个内部辅助）
- `plugins/spec-driver/lib/orchestration-resolver.mjs`（步骤 1.5 的 `mandatory-mode-missing` error）
- `plugins/spec-driver/scripts/validate-gate-mounting.mjs`（射程口径重写 + `isModeReadable` 分支 detail + `factErrors` 取数不上抛）
- `scripts/sync-agent-docs.mjs`（`checkSdModeDeclaration` + `preludeGuard` 接线）

**修改（散文 / 合同 3）**

- `plugins/spec-driver/templates/orchestrator-gate-mounting-guard.md`（判据 1 两支语义 + 位序 3b + 射程下界 + 残余 2/4 补写 + 新增残余 5；三个字面量实测仍为 0）
- `plugins/spec-driver/contracts/orchestration-overrides-contract.yaml`（丙条补 3a/3b 与射程下界）
- `plugins/spec-driver/scripts/orchestrator-cli.mjs`（`mounted` 字段注释分两支）

**修改（测试 4）+ 新建（测试 1）；新增用例合计 60 条（17 + 43，两套 runner 分列）**

| 文件 | 新增用例 | 跑法 |
|---|---|---|
| `tests/unit/agent-tools-core.test.ts` | 19（16 组构造 + 规范写法对照 1 + 解析器三分契约 1 + 顺序变异 1；另有 1 条既有用例语义翻转、1 条断言正则改口径，两者不计入新增） | `vitest`（24 → 43） |
| `tests/unit/spec-driver-orchestration-schema.test.ts` | 15（β-C2 段 9 + δ-C1 段 6） | `vitest`（38 → 53） |
| `tests/unit/agent-docs-sd-mode-guard.test.ts` | 9（新建文件，全部为新增） | `vitest`（0 → 9） |
| `plugins/spec-driver/tests/validate-gate-mounting.test.mjs` | 7（「减」方向 5 + δ-C1 端到端 2） | `node --test`（16 → 23） |
| `plugins/spec-driver/tests/orchestration-resolver.test.mjs` | 10（β-C2 段 7 + δ-C1 段 3） | `node --test`（56 → 66） |

**换算式（两套 runner 分列，不得相加成一个数）**：
- `test:plugins`：`7 + 10 = 17`，与实跑 `1739 → 1756`（`1756 − 1739 = 17`）一致，单位：测试用例。
- `vitest`：`19 + 15 + 9 = 43`，与实跑 `8089 → 8132`（`8132 − 8089 = 43`）一致，单位：测试用例。

**再生（10，由 `npm run repo:sync` 产出，非手写）**：`.codex/skills/spec-driver-{feature,fix,implement,resume,story}/SKILL.md` 5 + `plugins/spec-driver/skills-codex/` 同名 5。

**未动**：`spec.md` / `plan.md`（只读参考；本轮的口径变化交编排器写修订记录）；Phase B / D / E 的任何文件；`plugins/spec-driver/config/orchestration.yaml`；`tests/fixtures/spec-drift/repo-check/repo-check-baseline.json`（`[禁改]`）；任何 `.snap`；`specs/products/**` 与 `.specify/project-context.suggestions.*`（已定向回退 19 份）。

---

## 对抗修订第三轮（Phase A · commit ① 前 · delta 复验的 N-1 / N-2 / N-3）留痕

> 输入：`verification/adversarial-phaseA-round2-delta.md`（δ-C1 判「仅措辞变动」+ N-1 CRITICAL / N-2 · N-3 WARNING / I-1 ~ I-7 INFO）。
> 本轮**不新增任务编号**，全部在 Phase A 内收口。

### D-32 · N-1 / δ-C1 收口：废除「产出型」谓词，判据改为**只对照 base**

- **事实（修前实测，五组构造在同一探针下逐条跑过）**：第二轮的子句 3b 用 `isProducerPhase`（读 `phase.agent` / `phase.agent_mode`）+ `collectForeignProducers`（读 `phase.name` 是否在 base 名字集合里）决定「要不要检查这个 phase」。三个字段全部由**被守护的那份 overrides** 提供，于是有三个逃逸口。五组构造在修前**全部**满足「resolver 只发 info / `mounted=true` 且 `viol=[]` / FR-053 12 12 / `isFallback=false`（覆盖真的生效，不是被拒后回退）」：

  | 构造（fixture） | mode | 修前 diag / isFallback | 修前 FR-053 | 修前 GATE_DESIGN 求值点 | 修前 GATE_TASKS 求值点 |
  |---|---|---|---|---|---|
  | `attack-story-duplicate-base-name.yaml`（S2：两个同名 `constitution` 分别跑 specify / plan，四个锚点逐字照抄 base） | story | `info:mode-overridden` / `false` | pass 12/12 | `[]` | `[]` |
  | `attack-implement-rebind-base-name.yaml`（S3：base 名 `clarify` 的 `agent` 改成 `plan`，其余逐字照抄） | implement | `info:mode-overridden` / `false` | pass 12/12 | `[]` | `["analyze.gates_after"]` |
  | `attack-story-inline-producer.yaml`（F1：新名字 + `agent: null` + `agent_mode: inline` + `skip_if_exists` 自述产出） | story | `info:mode-overridden` / `false` | pass 12/12 | `[]` | `[]` |
  | `attack-story-gate-mode-producer.yaml`（F2：新名字 + `agent` 非空 + `agent_mode: gate`） | story | `info:mode-overridden` / `false` | pass 12/12 | `[]` | `[]` |
  | `attack-feature-anchor-agent-swap.yaml`（第五组：锚点 `gate_design` 自身的 `agent: null` → `plan`） | feature | `info:mode-overridden` / `false` | pass 12/12 | `["gate_design.gates_after"]`（门仍求值，但已退化为对新跑的 plan 的**事后追认**） | `["analyze.gates_after","implement.gates_before"]` |

- **判据所依赖的事实前提之一是假的**：3b 写「`agent === null`（inline 步骤）……不产出制品」，而 base 自己的 `feature.research_synthesis`(idx 4) 与 `feature.online_research`(idx 5) 都是 `agent: null, agent_mode: inline` 且各自带 `skip_if_exists: research/*.md`——base 正是用 `skip_if_exists` 声明「这个 inline phase 会写出这个文件」。

- **处置（废除分类，改为只对照 base）**：删掉 `isProducerPhase` / `collectForeignProducers` / `firstForeignProducerBefore` 三个内部辅助，新增 `phaseIdentityKey` / `describePhaseIdentity` / `countPhaseIdentities` / `findPreAnchorIntruder`，并把锚点采集 `collectGateMountAnchors` 的返回项扩到带 `(agent, agentMode)`。判据由三条变四条（编号沿用函数 doc）：
  1. `missing-anchor`（沿用）；
  2. `suppressor-added`（沿用：`conditional` / `skip_if_exists` 与 base 逐字相等）；
  3. **`anchor-tuple-changed`（新）**：锚点自身的 `agent` 与 base 逐字相等；`gates_after` 侧的锚点连 `agent_mode` 一并相等；
  4. 位序两条子句：4a `order-broken`（沿用）+ **4b `pre-anchor-phase-not-in-base`（新，取代 3b）**：effective 中排在锚点候选之前的那段，必须是 base 中排在该锚点之前那段的**子序列**——按 `(name, agent, agent_mode)` 三元组的**多重集**比对，重数不得超过 base 同段。语义是「门被求值之前跑过的东西**只可删、不可增、不可改**」，**完全不问某个 phase 会不会产出制品**。

- **为什么 4b 能一次盖住四个逃逸口**：它不做任何语义分类，只问「这个 phase 在 base 的同一段里有没有对应物」。S2 的同名副本越重数上界；S3 / F1 / F2 的三元组在 base 同段里根本不存在。**修后五组逐条实测**（同一探针，同一天）：

  | 构造 | 修后 diag | isFallback | 修后 FR-053 | 修后 violation kind | 修后求值点恢复 |
  |---|---|---|---|---|---|
  | S2 duplicate-base-name | `error:orchestration-overrides.gate-mounting-lost` | `true` | fail 9/12（红的是三条 `diagnostics:*`） | `pre-anchor-phase-not-in-base` ×3 | `GATE_DESIGN=["specify.gates_after","plan.gates_before"]`、`GATE_TASKS=["plan.gates_after"]` |
  | S3 rebind-base-name | 同上 | `true` | fail 9/12 | `pre-anchor-phase-not-in-base` ×2 | `GATE_DESIGN=["plan.gates_before"]`、`GATE_TASKS=["analyze.gates_after"]` |
  | F1 inline-producer | 同上 | `true` | fail 9/12 | `pre-anchor-phase-not-in-base` ×3 | 同 S2 |
  | F2 gate-mode-producer | 同上 | `true` | fail 9/12 | `pre-anchor-phase-not-in-base` ×3 | 同 S2 |
  | 第五组 anchor-agent-swap | 同上 | `true` | fail 9/12 | `anchor-tuple-changed@gate_design.gates_after` + `pre-anchor-phase-not-in-base` ×3 | `GATE_DESIGN=["gate_design.gates_after","plan.gates_before"]`、`GATE_TASKS=["analyze.gates_after","implement.gates_before"]` |

  「FR-053 fail 9/12 且红的是三条 `diagnostics:*`」是**正确形态**：resolver 已整份回退 base，故 effective 对强制 mode 恒等于 base、六条挂载断言必然绿；判红只能经 (v)（每个强制 mode 的 diagnostics 无 error 级条目）。这与 `validate-gate-mounting.mjs` 头部注释「相对形式在本守护项的运行位面上恒真」是同一个事实的两面。

- **正向用例「可删不可增」**（新 fixture `valid-overrides-story-drop-preanchor.yaml`：删掉锚点前唯一的 base phase `constitution`，其余逐字照抄）：修后仍 `info:mode-overridden` / `isFallback=false` / FR-053 **12 12** / 两道门求值点与 base 相同。零误伤同批复核的还有 `valid-overrides-goal-loop.yaml`（`feature.implement` 的 `agent_mode` 改 `goal_loop`）：**12 12、`isFallback=false`**——它改的是 `gates_before` 锚点的 `agent_mode`，正是判据 3 刻意留出的侧向不对称。

- **判据 3 的侧向不对称是刻意的，不是疏漏**：`gates_after` 锚点的 phase 体在门求值**之前**执行，换掉它的 `agent` 等于「门之前先跑一遍新的产出」，故 `(agent, agent_mode)` 两个分量都钉死；`gates_before` 锚点的 phase 体在该门求值**之后**才执行，改 `agent_mode` 移不动任何产出到门之前，而 `agent_mode` 正是 F201 goal_loop 唯一的合法激活位——一并钉死会把一条已发布的产品能力误判为攻击。`agent` 在两侧都钉死（从严且零代价）。落在别的门的 4b 段里的 `gates_before` 锚点，其 `agent_mode` 仍由那条 4b 钉住；base 的三个强制 mode 里只有 `feature.implement` 一个锚点不落进任何 4b 段。

- **本轮拒绝的一条写法**：不采用「4b 只对最早锚点做一次」。实现按**每个锚点各做一次**——对最早锚点它与「只做一次」等价，对靠后的锚点是额外约束（base 同段更长、allowance 更大，不构成放宽）。任一锚点越界即记违规，故整体不弱于简化版。

### D-33 · N-3 收口：`undecidable` 支的 `mounted` 不再回落到纯结构存在性

- **事实**：`evaluateGateMountingAgainstBase` 的 `baseAnchors.length === 0` 分支里，`undecidable`（强制 mode × 强制 gate 且 base 该 mode 段整个读不出）为真时返回 `mountedInBase: true`（FR-068 (3) 的从严代入，正确），而 `mounted` 取的是 `isGateMountedInMode(effectiveConfig, ...)`——**纯结构存在性**，即该文件自己用 ⚠️ 标注「不得再被任何一道防线单独当判据用」的那个函数。「base 段读不出 + overrides 把该 mode 补回来、门挂在一个 `conditional` 恒假的幽灵 phase 上」这一组合下，判据 1 的蕴含式成立、`violations` 为空。
- **处置**：该支 `mounted` 恒为 `false`，并记 `mandatory-mode-missing`（原本只在 `mountedInEffective === false` 时记，现推广到该支全部）。理由写进函数 doc：锚点无从取得时，「effective 相对 base 有没有失去挂载」这个**相对量**判不出；而结构存在性回答的是**另一个量**（「`gates_*` 数组里有没有这个字符串」），用后者充当前者会给出一句站不住的肯定性结论。
- **为什么仍要修（尽管另有闸门兜住）**：resolver 步骤 1.5 的 `mandatory-mode-missing` 确实让该形态可达不了绕过，但那是「一整类失效只由一条闸门承担」（与 β-W3 同型）。判据 1 在该支上输出的是**肯定性结论**，守卫散文判据 1 直接读 `mounted`——读者拿到的是「门在场且可达」，而事实是「判不出」。
- **用例**：`spec-driver-orchestration-schema.test.ts` 的「N-3 · base 段读不出时 mounted 恒 false —— 不得回落到纯结构存在性」。

### D-34 · N-2 处置：只改口径，不扩 targets

- **事实（复验实测）**：`spec-driver-wrappers` 族比对的是「**源** SKILL 的 body sha256」与「wrapper 文本里内嵌的那个 sha 字符串」——它回答「源改了而 wrapper 没重生成吗」，**不**回答「wrapper 自身的字节被人改过吗」。改副本正文而不动内嵌 sha，比对恒过。`codex-plugin-consistency` 族只比对 id 集合 / 数量 / manifest 引用。故 `skills-codex/` 5 份与 `.codex/skills/` 5 份的 `SD_MODE` 行当前**零守护**，而 `.codex/skills/` 正是 Codex 侧实际加载的那一份。
- **处置**：**(b) 口径改诚实**，写进 `scripts/sync-agent-docs.mjs` 的 `checkSdModeDeclaration` 函数 doc（「本守卫只覆盖 `targets` 里这 5 份 `skills/` 源；两批副本当前无守护」+ 实测证据 + 后果）。
- **为什么不选 (a) 扩 targets 到 15 份**：`skills-codex/` 与 `.codex/skills/` 是 `repo:sync` 的**再生产物**，给再生产物加一道独立校验会形成双写方（生成链与校验链各自认定「正确内容」），一致性只在两者同步更新时成立；这是一次守护项**行为变更**，需要自己的验收位与用例面，属另立一卡。本轮只把「已覆盖」这句没成立的话删掉。
- **登记残余**：codex 两批副本的 per-file 参数（当前唯一的就是 `SD_MODE`）无守护。

### D-35 · N-2 / N-3 之外的 INFO 逐条处置

| 项 | 结论 | 依据 |
|---|---|---|
| **I-1** D-25 的红灯条数记错（写「删 `implement` ⇒ 12 条恰好 3 条红」，实测 5 条红） | **本轮已改文本** | 亲测复核：端到端平面删 `implement` ⇒ **12 条 5 条红**（多出 `diagnostics:feature` / `diagnostics:story`，因为步骤 1.5 的 `mandatory-mode-missing` 每次 resolve 都发、不分 mode）；三段全删 ⇒ **12 条 11 条红**（唯一绿的是 `is-hard-gate:feature:GATE_DESIGN`）。原数字来自**纯函数平面**（合成输入、diagnostics 按 mode 注入），两个平面都真实，故 D-25 改为**并列两个平面并要求引用时带标注**，不删任何一侧 |
| **I-2** 解析器对 CRLF 行尾一律 `throw` | **登记不修** | 方向 fail-closed（不是放行）。入口加 `content.replace(/\r\n/g,'\n')` 会改变 `extractFrontmatterTools` 的输入归一化口径，连带影响 `namespace-consistency` 与 `agent-tools` 两族的解析面，属独立改动；本仓无 `core.autocrlf` 环境，当前不可达 |
| **I-3** `SD_MODE="story"`（带引号）被判红 | **登记不修** | 偏严的假红，方向安全。剥一层配对引号会引入「哪些引号算配对」的新判据面，而该行是本项目自己写的模板行、写法固定 |
| **I-4** 逐字相等护栏对 YAML 语义等价的排版差异正确判 pass | **无需处置（复验确认口径正确）** | 审查员自己判定「不是洞」；判据的对象是解析后的工具项列表，`agent-tools-core.mjs` 的措辞与此一致 |
| **I-5** 冻结快照常量本身有守护 | **无需处置（正向确认）** | `agent-tools-core.test.ts` 用字面量 `toEqual` 钉死 6 项 + `Object.isFrozen` |
| **I-6** `_runCli` 只在测试可达 | **无需处置（正向确认）** | 生产调用点 `repo-maintenance-core.mjs` 不传该参数 |
| **I-7** overrides 里的 YAML 行内数组不被 `simple-yaml` 支持、错误文案误导 | **登记不修** | 方向 fail-closed（整份覆盖被拒）。改文案要动 `simple-yaml` 的类型错误分支，属解析器输出面改动；已在本表登记 |

**本轮自查新发现（编排器亲测，一并登记不修，避免下一轮当成新洞重挖）**：

- **R-1 · 判据 2 的 `kind` 名与 detail 文案在「放宽抑制条件」方向上与事实相反**：实现是 `conditional` / `skip_if_exists` 与 base **逐字相等**，故把 `skip_if_exists: spec.md` 删成 `null`（放宽、让锚点**更**可达）也记 `suppressor-added` 且 detail 说「抑制条件强于 base」。方向 fail-closed（假红，不是放行）。**与第二轮 δ-I1 是同一条**，D-29 已登记「文案不改也留痕」，本轮复核结论不变：`conditional` 是自由文本表达式，两条表达式之间**无法定序**，改判据会引入「什么叫更弱」这个新判据面。
- **R-2 · 身份三元组不含 `conditional`**：把 base 某个**非锚点的**前驱 phase 的 `conditional` 抹成 `null`（强制它跑）不被 4b 记违规。**当前不可达**：三个强制 mode 里带 `conditional` 的前驱只有 `feature` 的 `product_research` / `tech_research` / `research_synthesis` / `online_research` 四个，它们的 `skip_if_exists` 全部指向 `research/*.md`，而 `GATE_DESIGN` / `GATE_TASKS` 的四个锚点的 `skip_if_exists` 只有 `plan.md`（`gate_design` / `analyze` / `implement` 三个锚点的 `skip_if_exists` 为 `null`）——没有任何一条 `conditional` 前驱能产出锚点所依赖的那个文件。若 base 将来新增「带 `conditional` 且产出锚点 skip 文件」的前驱，这条即变为可达，届时需把 `conditional` 并入身份键。
- **R-3 · 三元组之外的 phase 字段不引入新的产出通道（本轮核对结论）**：phase schema 共 10 个字段，身份键占 3（`name` / `agent` / `agent_mode`），其余 7 个中 `conditional` / `skip_if_exists` 只**抑制**执行（方向安全，除 R-2 的边界）、`gates_before` / `gates_after` 只增删门挂载（不产出）、`is_critical` 只影响失败处置、`id` 与 `display_name` 全仓仅用于日志与展示（`orchestrator.mjs` 对 `display_name` 的唯一引用是 `Skip ${phase.id} (${phase.display_name})` 这一行日志）。故「(name, agent, agent_mode) 即产出相关身份」这条前提在**当前 schema 下**成立；schema 加字段时须重做本核对。

### D-36 · 变异测试（每处修复至少一个用例红）

在工作区原地打补丁、跑目标测试、逐一还原（`schema.orig.mjs` 为改前快照，还原后与工作区文件 `cmp` 逐字节相同）。

| 变异体 | 改法 | `spec-driver-orchestration-schema.test.ts`（vitest） | `validate-gate-mounting.test.mjs`（node --test） | `orchestration-resolver.test.mjs`（node --test） |
|---|---|---|---|---|
| **M1 去掉规则 1**（判据 3 锚点身份） | `tupleMatches = suppressorMatches`（不再过滤） | **3 failed / 58 passed** | 30 pass / 0 fail | **1 failed / 72 passed**（`attack-feature-anchor-agent-swap`） |
| **M2 去掉规则 2**（判据 4b 锚点前子序列） | witness 判据删掉 `findPreAnchorIntruder` | **6 failed / 55 passed** | **6 failed / 24 passed** | **6 failed / 67 passed** |
| **M3 三元组去掉 `agent` 分量** | 身份键只留 `(name, agent_mode)` | **1 failed / 60 passed**（S3） | **1 failed / 29 passed** | **1 failed / 72 passed** |
| **M4 去掉重数限制**（多重集退化为集合） | `if (!allowance.has(key)) …` | **1 failed / 60 passed**（S2） | 30 pass / 0 fail | 73 pass / 0 fail |

- **M4 只被 vitest 侧的 S2 用例杀死**，如实登记：fixture 侧的 `attack-story-duplicate-base-name.yaml` 里两份 `constitution` 的 `agent` 已相对 base 改过（`specify` / `plan`），集合语义下同样越界，故它对「重数」这一分量**不承重**；承重的是 `spec-driver-orchestration-schema.test.ts` 里那条把 base 的 `specify` **原样复制一份**（身份三元组与 base 完全相同）的用例。
- 四个变异体逐一还原后，`command grep -rn MUTANT`（排除 `node_modules` / `.git` / `dist` / scratchpad）在源码面**零输出**（仅 `implementation-notes.md` / `fix-round3-brief.md` 的散文提及）。

### D-37 · 本轮收口全量（清净窗口 · **串行**）

见下方「第三轮收口 · 命令与退出码」表。

### D-B2 · delta 复验收尾小修（编排器 inline · 2026-09-07 · commit ② 前）

- **输入**：`verification/adversarial-phaseBD-delta-a.md`（ε-C1 / ε-C2 / γ-C3）与 `delta-b.md`（γ-C1 / γ-C2）——5 ÷ 5 判「实质已修」，另给 N-1 / N-2 / R-1 / R-2 与 6 条白名单缺口。
- **落地**：56 处旧子串替换（33 + 1 + 21 + 1；每处 `str.count(old) == 预期` 断言，任一不符整体不落盘），涉及 `agents/{verify,plan,spec-review}.md`、plan-template 两副本、块 4 模板、8 份 SKILL 中的 7 份（feature 无显式装配行）。
- **再生**：`npm run docs:sync:agents` + `npm run repo:sync` 两轮；无关再生产物（`specs/products/**/_generated/**`、`.specify/project-context.suggestions.*`）每轮 19 文件以 `git show HEAD:` 定向回退；二跑 `docs:sync:agents` 0 updated；三侧（模板 / SKILL / 两侧 wrapper）块 4 计数一致。
- **登记位置**：spec 修订记录 31–35；plan「B + D 对抗修订登记」(6)–(9)；tasks Phase B / D 段末留痕。
- **偏差**：编排器 inline 执行小修（`[DEGRADED: inline-execution]`），非委派——子代理本阶段五次停摆 / 中断，且落点已由 delta 逐行给定，委派的收益低于其失败面。

