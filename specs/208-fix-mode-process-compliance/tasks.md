# Tasks: Fix 模式流程依从性结构化保障（防仪式坍塌）

**特性分支**: `208-fix-mode-process-compliance`
**输入**: `specs/208-fix-mode-process-compliance/{plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md}`
**前提**: plan.md（技术方案+MEDIUM 风险验证顺序）、spec.md（15 FRs + C-001~003 + 5 SCs）均已定稿并过 codex 审查

**测试策略**: 本 feature 的 core 判定函数适用 **Tests FIRST**（research.md D7 显式要求）——fixture 先行，单测先红后绿；CLI 契约测试同样先红后绿。

**组织方式**: 按 User Story 分组，遵循 plan.md Impact Assessment 给出的 MEDIUM 风险验证顺序——先纯函数核心 + 单测全绿，再 CLI（`--mode report` 只读），最后才挂载 `hooks.json`（`--mode hook`），挂载后立即验证非 fix 会话零误伤（US5）。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：可并行（不同文件、无依赖）
- **[Story]**：所属 User Story（US1-US5）；Setup/Foundational/Polish 阶段不标注
- 每个任务包含精确文件路径

---

## Phase 1: Setup（共享基础设施）

**目的**：为核心判定逻辑实现做前置事实校准与测试脚手架就绪

- [ ] T001 **[前提实测·复核]** `research.md` 已含"实测校准记录（T001，2026-07-09）"小节（主编排器基于真实 F206 headless 评测 transcript 完成：envelope 结构/展开痕迹/subagent_type 稳定性/体积分布六项结论）。本任务收窄为：实现前**复核**该小节结论仍然成立（抽查 1 份合规 + 1 份坍塌样本），如实现中发现记录未覆盖的字段形态（如 content 字符串形态的边角），在该小节补充；`MAX_TRANSCRIPT_BYTES` 维持 20MB（实测 fix 会话 ≤0.31MB，保守 60 倍余量）。
- [ ] T002 [P] 创建测试 fixture 目录框架 `plugins/spec-driver/tests/fixtures/fix-compliance/`（含 `.gitkeep` 或简要 `README.md` 说明各 fixture 命名约定与用途索引），确认目录结构就绪供 T003/T004 落盘 fixture 文件

**Checkpoint**：目录就绪 + transcript envelope 事实前提已核实，可开始 Foundational 阶段。

---

## Phase 2: Foundational（阻塞性前置依赖）

**目的**：判定核心（纯函数 + I/O 边界）+ 单测全绿，在挂载任何 hook 之前充分验证判定逻辑正确性（plan.md MEDIUM 风险验证顺序第 1 步）

**⚠️ 关键**：本阶段完成前不得开始任何 User Story 的实现任务

- [ ] T003 [P] 创建 fixture 集合 A（坍塌/合规核心场景）于 `plugins/spec-driver/tests/fixtures/fix-compliance/`：`collapsed-zero-delegation.jsonl`（0 委派+无制品+纯文本收口，F206 核心坍塌场景）、`compliant-full.jsonl`（含 implement+verify 委派、fix-report.md、verification-report.md 路径的完整合规）、`compliant-noop.jsonl`（1 次 no-op 核实类委派 + no-op 精简报告的合规样例）、`noop-zero-delegation.jsonl`（no-op 但 0 委派，应判不合规，US2 场景 2）、`malformed-transcript.txt`（损坏/非 JSON 格式，验证 FR-013 fail-open）
- [ ] T004 [P] 创建 fixture 集合 B（规避对抗与边界场景）于 `plugins/spec-driver/tests/fixtures/fix-compliance/`：`placeholder-shell.jsonl`（制品文件存在但仅含未填充 `{...}` 占位符，验证 FR-012a）、`role-mismatch.jsonl`（仅 1 次非 implement/verify 类委派冒充完整收口，验证 FR-012b）、`multi-expansion.jsonl`（session 中途从 feature 切到 fix，或 fix 展开两次，验证 D1 窗口锚定）、`non-fix-session.jsonl`（无展开痕迹或展开痕迹指向 feature，验证 US5）、`fake-anchor-in-tool-result.jsonl`（tool_result 内容块携带伪造"Base directory for this skill"展开痕迹，反伪造对抗样例，验证 D1 反伪造硬化）、`compliant-full-canonical-chinese-no-subagent-type.jsonl`（SKILL canonical 中文 description + 无 subagent_type 的完整合规样例，防假阻断回归）、`role-mismatch-plan-tasks-fix-word.jsonl`（plan/tasks 委派 desc 含"修复"字样但非 implement 类的反例，验证角色窄模式精确切分）
- [ ] T005 **Tests FIRST** 编写 `plugins/spec-driver/tests/fix-compliance-core.test.mjs`（`node --test`，与既有 `goal-loop-core.test.mjs` 同构），覆盖判定函数 `detectFixSkillExpansion` / `extractDelegationsAfter` / `classifyDelegationRole` / `resolveFeatureDirCandidate` / `checkArtifactSection` / `classifyClosureForm` / `judgeCompliance` / `resolveEnforcementFromConfig`，用例基于 T003/T004 fixtures；此时对应实现文件不存在，测试应先失败（红）
- [ ] T006 实现 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 纯函数判定核心（零 I/O，依据 research.md D1/D3/D6 与 T001 实测结论：窗口锚定+反伪造过滤仅信 `type:"text"` 块、委派角色级联匹配 subagent_type→description、修复/no-op 制品章节互斥锚点、按收口形态三支判据），跑通 T005 单测转绿（依赖 T001, T003, T004, T005）
- [ ] T007 [P] `plugins/spec-driver/scripts/lib/config-schema.mjs` 新增 `fix_compliance` zod schema 段（`enforcement: z.enum(['block','warn','off']).default('block')`）+ `BUILTIN_DEFAULTS` 追加 `'fix_compliance.enforcement': 'block'` + **同步接入该文件的完整合同面（codex tasks 审查 W-4 处置）**：`KNOWN_TOP_LEVEL_FIELDS`（或等价的顶层字段白名单）追加 `fix_compliance`、`resolveEffectiveConfig()` 的 nested key 解析覆盖 `fix_compliance.enforcement`；并在 `plugins/spec-driver/tests/config-schema.test.mjs` 补充校验断言（合法三值通过 / 非法值报错 / effective config 缺省得 `block`）（依据 contracts/fix-compliance-config-field.md）
- [ ] T008 **Tests FIRST** 编写 `plugins/spec-driver/tests/fix-compliance-io.test.mjs`，覆盖 `readHookPayload` / `readTranscriptEntries`（体积上限 fail-open + content 字符串/数组双形态）/ `findAndParseConfig`（FR-015 判定顺序三步：配置缺失→block+非降级、配置损坏/非法值→block+config-degraded、`off`→立即短路、合法 block/warn→直接采用）/ `appendAuditEvent` / `checkFeatureDirOnDisk`；**BlockCountState 读写不在本任务范围**（归 T023，避免与 US4 任务边界重叠——codex tasks 审查 C-1 处置）；此时实现文件不存在，测试应先失败（红）
- [ ] T009 实现 `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` I/O 边界——**本任务只实现 payload/transcript/config/audit/featureDir 五组函数**（依据 T001 实测结论 + D3/D6/FR-015 契约：**不 import `config-schema.mjs`**，直接用 `simple-yaml.mjs` `parseYamlDocument()` 做非抛出式配置读取；`readTranscriptEntries` 支持 content 字符串与数组双形态），跑通 T008 单测转绿；`loadBlockState`/`saveBlockState`（含降级路径/清洗/幂等标记）显式**不在本任务**，由 T023 在同一文件追加（依赖 T001, T007, T008）
- [ ] T010 `plugins/spec-driver/scripts/generate-adoption-insights.mjs` 增加已知非 summary 事件类型静默 skip 白名单（含 `fix-compliance-verdict`，采纳 codex plan 审查 W-5 处置，data-model.md §9 消费方兼容性修正），并在既有相关测试文件中补充一条"新事件类型不计入 invalidLineCount"回归断言

**Checkpoint**：核心判定（core+io）与单测全绿，判定逻辑在挂载任何 hook 前已充分验证（MEDIUM 风险验证顺序第 1 步完成）。

---

## Phase 3: User Story 1 - 无改动收口场景被正确拦截并引导补救（Priority: P1）🎯 MVP 核心

**目标**：fix 会话在"0 委派、无制品、直接输出完成陈述"时被结构化机制阻断，并收到具体可执行的补救指引；完整走完标准流程的会话不受任何额外阻断或延迟影响

**独立测试**：构造 0 委派、无制品、纯文本收口的会话（mock transcript 或真实 headless），验证被 CLI `--mode hook` 判定阻断（exit 2）而非静默放行；完整流程会话判定为合规（exit 0 静默）

### Tests for User Story 1

- [ ] T011 [US1] 编写 `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`，覆盖 `--mode report`/`--mode hook` 全部退出码矩阵（contracts/fix-compliance-judge-cli.md 场景表）+ FR-010 `missing[]` 枚举 → action 文案映射表断言（每个枚举值均有对应固定文案，防新增枚举漏配）；此时 CLI 文件不存在，测试应先失败（红）

### Implementation for User Story 1

- [ ] T012 [US1] 实现 `plugins/spec-driver/scripts/fix-compliance-judge.mjs` CLI 编排入口（`--mode hook|report` 参数解析，编排 core+io，顶层 `try/catch` 兜底 FR-013，FR-010 机械拼装反馈文本 + 双路径指引，稳定前缀 `[FIX-COMPLIANCE]`/`[FIX-COMPLIANCE][WARN]`/`[FIX-COMPLIANCE][GATE-DEGRADED]`），跑通 T011（依赖 T006, T009, T011）
- [ ] T013 [US1] 新增 `plugins/spec-driver/hooks/stop-fix-compliance-check.sh`（bash 薄壳：读 stdin 转发给 CLI，按 CLI 退出码原样转发 0/2，任何非 0/2 异常退出码兜底为 0；`set -euo pipefail` + 755 权限），并附一个薄壳退出码转发的直接验证（对 0/2/其他三种 CLI 退出码分别断言转发结果，可用临时 stub CLI 或环境变量注入实现，记录于测试或手工验证小节——codex tasks 审查 I-2 处置）——**本任务暂不修改 `hooks.json`**，挂载延后到 Phase 7 US5（MEDIUM 风险验证顺序第 3 步）（依赖 T012）
- [ ] T014 [US1] 按 quickstart.md 步骤 2/4 手工验证：`--mode report` 只读判定输出正确 `ComplianceVerdict` JSON；构造 payload 直接调用 CLI（不经 hooks.json，故不依赖 T013——codex tasks 审查 I-2 处置）验证 collapsed 场景 exit=2、compliant 场景 exit=0；结果（命令、退出码、关键 stderr 前缀、JSONL 断言）写入 `specs/208-fix-mode-process-compliance/verification/verification-report.md` 的"手工验证记录"小节（依赖 T012）

**Checkpoint**：US1 核心判定与阻断/放行逻辑完整可测（尚未接入真实 `hooks.json`，Acceptance Scenario 1-3 可通过手工构造 payload 验证）。

---

## Phase 4: User Story 2 - "确认无需改动"成为一等公民收口路径（Priority: P1）

**目标**：诚实的"问题已不存在"场景可通过精简判定记录 + 至少 1 次交叉核实委派合规收口，不被 Story 1 的拦截机制误判为坍塌；0 委派的"无需改动"仍应被判定不合规

**独立测试**：构造走 no-op 路径且完成最低限度核实的会话，验证判定为合规不阻断；构造 no-op 但 0 委派的会话，验证仍判定不合规

- [ ] T015 [CLEANUP][US2] 前置整理：复核 `plugins/spec-driver/skills/spec-driver-fix/SKILL.md` Phase 1 现有结构与"运行事件记录"段落的衔接点，确认插入 no-op 判定分支的位置不引入跨阶段编号混乱或重复的"上下文注入块模板"引用（plan.md Codebase Reality Check 判定的前置清理任务，职责收窄为确认插入点，非无依据重排）
- [ ] T016 [US2] 在 `plugins/spec-driver/skills/spec-driver-fix/SKILL.md` Phase 1 内插入 no-op 判定分支与精简模板（依据 contracts/no-op-report-template.md：canonical 标题 `## 判定依据`、canonical 委派文本 `Task(description: "交叉核实无需改动判定", ...)`、制品统一用 Write/Edit 工具写入、`--completed-phases diagnose,no-op-verify`），依赖 T015
- [ ] T017 [US2] 运行 `npm run repo:sync` 同步 SKILL.md 改动到 wrapper 镜像层，并确认 `npm run repo:check` 零告警（依赖 T016）
- [ ] T018 [US2] 两部分（codex tasks 审查 W-5 处置，拆开依赖）：(a) 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 补充 no-op 收口组合断言——canonical 委派文本 + `## 判定依据` 锚点组合命中 no-op 判据集，`compliant-noop.jsonl`/`noop-zero-delegation.jsonl` 判定结果符合预期（fixture 手工构造，仅依赖 T006）；(b) 新增**静态合同断言**（同文件独立 `describe` 块或 `node --test` 内直接 `readFileSync`）：读取 `plugins/spec-driver/skills/spec-driver-fix/SKILL.md` 断言 canonical 字符串逐字存在——`## 判定依据` 模板标题与 `交叉核实无需改动判定` 委派 desc（防 SKILL 后续被无意改写导致判定器锚点失配，依赖 T016）

**Checkpoint**：US1+US2 完整——修复收口与 no-op 收口两条合法路径均可被正确判定，SKILL.md 改动已完成 repo:sync。

---

## Phase 5: User Story 3 - 依从性判据来自结构化状态而非模型自陈（Priority: P2）

**目标**：判定结果与 transcript 客观记录一致，不采信模型输出文本中的自陈声明；伪造展开痕迹等规避形态被识别并拒绝

**独立测试**：构造"自称已完成但 transcript 无委派记录"与"自称未完成但 transcript 记录完整"两个反例，验证判定结果与 transcript 记录一致而非文本表述

- [ ] T019 [US3] 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 补充反伪造/反自陈测试用例：`fake-anchor-in-tool-result.jsonl`（断言 tool_result 中伪造展开痕迹不改变最新展开锚定结果，D1 反伪造硬化）、复用 `collapsed-zero-delegation.jsonl` 构造"最终陈述声称已完成 3 次委派"文本但断言判定忽略该自陈（Story 3 场景 1）、复用 `compliant-full.jsonl` 构造"最终陈述声称未完成"文本但断言判定仍为 compliant（Story 3 场景 2）（依赖 T004, T006；与 T018/T020 共改同一测试文件，**串行执行**，去除 [P]——codex tasks 审查 W-1 处置）
- [ ] T020 [US3] 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 补充角色分类边界测试：`compliant-full-canonical-chinese-no-subagent-type.jsonl` 断言不被误判不合规（防假阻断回归）；`role-mismatch-plan-tasks-fix-word.jsonl` 断言 plan/tasks 委派 desc 含"修复"字样不被误分类为 implement 类（窄模式精确切分验证）（依赖 T004, T006, T019；同文件串行）

**Checkpoint**：判据抗操纵性（反伪造）与假阻断防护（合规样例误伤防护）均有测试覆盖，US3 底层能力验证完成。

---

## Phase 6: User Story 4 - 阻断机制有界化，不产生死循环（Priority: P2）

**目标**：同一会话内不合规阻断次数上限 2 次，第 3 次仍不合规必须放行并留下可追溯降级标注（reason 文本 `[GATE-DEGRADED]` + `record-workflow-run.mjs` 事件字段双写）；并发会话阻断计数隔离

**独立测试**：构造持续触发拦截的会话，验证第 1/2 次阻断、第 3 次自动降级放行并留下可识别标注；验证未达上限时持续阻断

- [ ] T021 [US4] `plugins/spec-driver/scripts/record-workflow-run.mjs` FR-014 升级：新增可选 `--compliance-closure-form`/`--compliance-compliant`/`--compliance-missing`/`--compliance-degraded`/`--compliance-block-count` CLI flag 与 `options.complianceVerdict` 编程参数（依据 contracts/record-workflow-run-fields.md，仅显式传参时事件对象出现 `complianceVerdict` 键，+40~70 行）
- [ ] T022 [US4] record-workflow-run.mjs 向后兼容回归测试：新建或扩展 `plugins/spec-driver/tests/record-workflow-run.test.mjs`，断言未传新参时事件 JSON **不含** `complianceVerdict` 键（字节级不变，非值为 null）+ 现有 5 个 SKILL 调用方（fix/story/implement/doc/resume）参数组合行为逐字不变（FR-014 硬性回归断言，依赖 T021）
- [ ] T023 [US4] 在 `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` **追加** `loadBlockState`/`saveBlockState`（T009 显式排除的边界，本任务为唯一实现者——codex tasks 审查 C-1 处置）：`.specify/runs/.fix-compliance-state/<session_id>.json` 主路径 + `os.tmpdir()/spec-driver-fix-compliance/<session_id>.json` 降级路径 + `session_id` 白名单清洗（仅保留 `[A-Za-z0-9._-]`，清洗后为空用 `unknown-session`）+ `degradedRecorded` 幂等标记（默认 false、历史文件缺字段按 false）；同步在 `fix-compliance-io.test.mjs` 追加 state 读写/降级/清洗/幂等单测（依据 research.md D2/D4 修订 + data-model.md §8，依赖 T009）
- [ ] T024 [US4] 在 `plugins/spec-driver/scripts/fix-compliance-judge.mjs` 接入阻断计数路由：`blockCount<2` → exit 2 + 计数递增 + 写 `fix-compliance-verdict` 审计事件；`blockCount>=2` → 降级放行 + 编程调用 `recordWorkflowRun`（`result:'failed'`, `complianceVerdict.degraded:true`）+ `degradedRecorded` 幂等跳过重复终态写入（依赖 T012, T021, T023）
- [ ] T025 [US4] 单测覆盖阻断有界化（`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 或新增 `fix-compliance-state.test.mjs`）：连续 3 次不合规触发同一 `session_id`，断言第 1/2 次 exit=2、第 3 次 exit=0 且 stderr 含 `[GATE-DEGRADED]`；**FR-006 双写集成断言（codex tasks 审查 C-2 处置）**——第 3 次后读取沙箱 `.specify/runs/YYYY-MM.jsonl`，断言存在 `workflow-run-summary` 事件且 `complianceVerdict.degraded===true`、`blockCount===2`、`missing[]` 非空，同时存在对应 `fix-compliance-verdict` 审计事件；**第 4 次同 `session_id` 再触发**，断言不再新增第二条 `workflow-run-summary` 终态事件（`degradedRecorded` 幂等生效）；断言并发不同 `session_id` 计数互不干扰；断言 `state-storage-unavailable`（存储不可写模拟）触发等同已达上限的降级放行路径且事件 `diagnostics` 含该标签（依赖 T024）

**Checkpoint**：阻断计数、降级放行、`record-workflow-run.mjs` 集成全部闭环，US4 全部验收场景可通过。

---

## Phase 7: User Story 5 - 非 fix 会话不受影响（Priority: P2）

**目标**：同一套插件机制挂载到所有会话后，新增拦截逻辑仅对 fix 会话生效，feature/story 模式与普通交互式会话零触发

**独立测试**：在 feature 模式、story 模式、普通问答会话中触发结束流程，验证均不产生 fix 依从性相关拦截或提示

- [ ] T026 [US5] `plugins/spec-driver/hooks/hooks.json` 追加第 2 个 `Stop` 数组条目，指向 `stop-fix-compliance-check.sh`（与既有 `stop-task-check.sh` 独立并存不改动）——**MEDIUM 风险验证顺序第 3 步，本次改动中风险最高的挂载动作**，依赖 T013、T024 全部完成（依赖 T013, T024）
- [ ] T027 [US5] 挂载后立即执行 quickstart.md 步骤 4-6（阻断/降级/配置强制程度场景）人工复验一遍，并额外验证：`non-fix-session.jsonl` fixture 零触发、`multi-expansion.jsonl`（feature 展开后未展开 fix）零触发、真实 feature/story 模式会话结束零触发（US5 Acceptance Scenario 1-2）；**双 Stop hook 并存验证（codex tasks 审查 W-3 处置，Edge Case"与既有非阻断型 Stop hook 并存"落点）**——构造同时触发两个 hook 的场景（存在未完成任务的 specs 目录 + fix 不合规收口），断言既有 `stop-task-check.sh` 的 `[提醒]` 输出行为不变、与 `[FIX-COMPLIANCE]` 前缀在输出中可区分不混淆。全部结果（命令、退出码、关键 stderr、断言结论）写入 verification-report.md"手工验证记录"小节（依赖 T026）
- [ ] T028 [US5] 新增手工 headless E2E spike 脚本 `plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs`（复刻 harness-verification.md 插件副本手法：拷贝 `plugins/spec-driver` 到 scratchpad → 挂载新 hook → `claude --print --plugin-dir <副本>` 跑坍塌/合规两场景 → 打印 hook-trace 时间线；不计入 `npm test`）（依赖 T026）
- [ ] T029 [US5] 手工运行 T028 脚本两个场景（`--scenario collapsed` / `--scenario compliant`），核对 exit code 与 `[FIX-COMPLIANCE]` 前缀符合预期，成本控制在 haiku + 极简任务（<$0.05/次），结果（完整命令、hook-trace 时间线、exit code、stderr 摘录）写入 verification-report.md"E2E spike 记录"小节（依赖 T028）

**Checkpoint**：全部 5 个 User Story 均已实现并验证，机制默认生效（`enforcement=block`）且非 fix 会话零误伤，可进入 GATE_VERIFY 收口。

---

## Phase 8: Polish & Cross-Cutting Concerns

**目的**：性能达标验证、静态安全审查、全量回归确认、发布合同评估

- [ ] T030 [P] 性能基准（C-003 p95 < 100ms）：用真实规模 fix 会话 transcript 样本（T001 采集样本或等量构造）跑 N=20 次 `--mode report` 计时，记录 p50/p95，写入 `specs/208-fix-mode-process-compliance/verification/verification-report.md`（quickstart.md 步骤 8）；若超标回头调整 `MAX_TRANSCRIPT_BYTES` 或单遍扫描算法（不引入运行时熔断，见 research.md D6）
- [ ] T031 [P] 静态安全审查：核查 `fix-compliance-core.mjs`/`fix-compliance-io.mjs`/`fix-compliance-judge.mjs` 三文件及其 import 链不含 `Task(`/模型 API 调用字符串（C-003 零 LLM/零委派）；核查 C-002 口径（**codex tasks 审查 C-3 处置**）——**手写源码改动**必须全部落在 `plugins/spec-driver/**`，`npm run repo:sync` 管道派生的受控镜像产物（`.codex/skills/**`、共享 agent docs 区块等 sync 输出）属允许的生成产物、单独列出核对其确为 sync 再生而非手改；未触碰 `scripts/eval-*.mjs`/`scripts/lib/**`（仓库根，C-001）；核查判定逻辑不读取任务 ID/描述文本作为判据（FR-011）；审查结论记录于 verification-report.md
- [ ] T032 [P] 全量回归：`npx vitest run` + `node --test "plugins/spec-driver/tests/**/*.test.mjs"` 零失败（SC-005），结果记录于 verification-report.md
- [ ] T033 版本合同评估：评估 `contracts/release-contract.yaml` 是否需 minor 版本 bump（新增用户可见 `fix_compliance` 配置项 + 新增默认生效的阻断型 Stop hook，属功能级改动）；若确认需要，运行 `npm run release:sync`——**具体版号数值待主编排器确认后再执行，本任务不擅自决定版号**
- [ ] T034 quickstart.md 全流程复跑确认（步骤 1-9 全部通过，含步骤 9 配置示例文档核对），产出/收口 `specs/208-fix-mode-process-compliance/verification/verification-report.md`
- [ ] T035 [P] 用户文档更新（codex tasks 审查 W-6 处置，FR-015 用户可见配置面）：`plugins/spec-driver/README.md`（及 `plugins/spec-driver/docs/` 下配置说明文档如存在）新增 `fix_compliance` 配置节——`block/warn/off` 三档语义、默认 `block`、"确认无需改动"合法收口路径说明、`[FIX-COMPLIANCE]`/`[GATE-DEGRADED]` 前缀含义与降级放行语义；文档改动后确认 repo:check 零告警

---

## FR / 约束覆盖映射表

| 需求 | 对应 Task ID |
|------|-------------|
| FR-001（住在模型上下文之外的强制拦截点） | T012, T013, T026 |
| FR-002（按收口形态三支判据） | T006, T003, T004, T005 |
| FR-003（"确认无需改动"显式收口路径） | T016 |
| FR-004（no-op 路径最低委派门槛不为零） | T006, T018, T020 |
| FR-005（判据来自 harness 客观记录，不采信模型自陈） | T006, T019 |
| FR-006（阻断次数上限 2 次 + 双写降级标注 + 会话级隔离） | T023, T024, T025 |
| FR-007（fix 会话区分 + 最新展开窗口锚定） | T006, T004(multi-expansion), T020 |
| FR-008（交互式+headless 双场景生效，不依赖模型主动标记） | T012, T013, T026, T028, T029 |
| FR-009（深度语义级规避识别，可选范畴） | 不在本期任务范围（contracts/no-op-report-template.md 已记录残余风险，无需任务） |
| FR-010（具体可执行反馈 + 稳定前缀） | T011, T012 |
| FR-011（不以任务 ID/描述文本为判据） | T006, T031 |
| FR-012（机械可判实质性底线：非空+必填章节+角色匹配） | T006, T003, T004 |
| FR-013（异常捕获 + fail-open + degraded 诊断落盘） | T008, T009 |
| FR-014（record-workflow-run.mjs 向后兼容升级） | T021, T022 |
| FR-015（项目级 block/warn/off 配置 + 类型化判定顺序） | T007, T008, T009, T035（用户文档） |
| C-001（不修改评测 harness 脚本） | T031 |
| C-002（改动范围限 plugins/spec-driver/**） | T031（全任务文件路径均已限定在此范围内） |
| C-003（零 LLM/零委派 + p95 < 100ms） | T030, T031 |

---

## 依赖关系图

### Phase 依赖

- **Setup（Phase 1）**：无依赖，可立即开始
- **Foundational（Phase 2）**：依赖 Setup 完成（T001 实测结论是 T006/T009 的输入）——**阻塞全部 User Story**
- **US1（Phase 3）**：依赖 Foundational 完成
- **US2（Phase 4）**：依赖 Foundational 完成；SKILL.md 改动（T016）与 US1 的 CLI/hook 实现相互独立，可并行于 US1 展开，但 T018 的端到端断言需要 T006（Foundational）与 T016（US2 自身）均就绪
- **US3（Phase 5）**：依赖 Foundational 完成（core 判定逻辑），不依赖 US1/US2 的 CLI/SKILL 改动，可与 US1/US2 并行
- **US4（Phase 6）**：依赖 Foundational 完成 + US1 的 T012（CLI 编排入口存在，才能接入阻断计数路由）
- **US5（Phase 7）**：依赖 US1（T013 bash 入口）+ US4（T024 阻断路由完整）全部完成，是本特性风险最高的挂载动作，必须最后执行
- **Polish（Phase 8）**：依赖全部 User Story 完成

### User Story 依赖

- **US1（P1）**：Foundational 完成后可开始，无其他 Story 依赖
- **US2（P1）**：Foundational 完成后可开始，与 US1 相互独立（不同文件：SKILL.md vs CLI/hook 脚本），可并行
- **US3（P2）**：Foundational 完成后可开始，纯测试补充性质，可与 US1/US2 并行
- **US4（P2）**：依赖 US1 的 T012（CLI 入口）已存在
- **US5（P2）**：依赖 US1 + US4 全部完成（挂载动作是全机制的最终集成点）

### 并行机会

- Phase 1：T002 可与 T001 并行（不同性质，T001 纯调研无产出文件冲突）
- Phase 2：T003/T004（fixture 文件）可并行；T007（config-schema.mjs）与 T005/T006（core 判定）可并行（不同文件）
- Phase 3-5：US1（T011-T014）、US2（T015-T018）、US3（T019-T020）三条 Story 线在 Foundational 完成后**可并行推进**（不同文件：judge.mjs/hook 脚本 vs SKILL.md vs core 测试补充）
- Phase 6：US4 必须等 US1 的 T012 完成后才能开始（阻断路由依赖 CLI 编排入口）
- Phase 8：T030/T031/T032 三个验证任务互不依赖同一产出文件，可并行执行

---

## Parallel Example: Foundational 阶段

```bash
# Fixture 文件可完全并行创建：
Task: "创建 fixture 集合 A 于 plugins/spec-driver/tests/fixtures/fix-compliance/"
Task: "创建 fixture 集合 B 于 plugins/spec-driver/tests/fixtures/fix-compliance/"

# config-schema.mjs 改动与 core 判定实现互不冲突：
Task: "config-schema.mjs 新增 fix_compliance schema 段"
Task: "编写 fix-compliance-core.test.mjs 并实现 fix-compliance-core.mjs"
```

---

## 实施策略

### MVP First（User Story 1 + User Story 2）

1. 完成 Phase 1: Setup
2. 完成 Phase 2: Foundational（**关键路径**，阻塞全部 Story）
3. 完成 Phase 3: US1（核心拦截判定与阻断/放行逻辑）
4. 完成 Phase 4: US2（no-op 一等公民出口，与 US1 同为 P1，共同构成 MVP 的两面）
5. **STOP 并验证**：此时 US1+US2 已可独立测试（CLI 层面，尚未挂载 hooks.json），是本特性的最小可行交付
6. 如需真实生效验证，继续 US4（阻断有界化，US5 挂载的前置依赖）+ US5（挂载生效）

### 增量交付

1. Setup + Foundational → 判定核心就绪（未挂载任何 hook）
2. + US1 → 核心拦截逻辑可测（MVP 之一）
3. + US2 → no-op 出口可测（MVP 之二，US1+US2 = P1 完整 MVP）
4. + US3 → 判据抗操纵性验证补强（支撑性，不改变外部行为）
5. + US4 → 阻断有界化闭环（US5 挂载前必需）
6. + US5 → 挂载 `hooks.json`，机制真正生效，非 fix 会话零误伤验证
7. + Polish → 性能/安全/回归/发布合同全部收口

### 建议 MVP 范围

**US1（无改动收口场景被正确拦截）+ US2（"确认无需改动"一等公民出口）**——二者是 spec.md 明确裁定的同一枚硬币两面（互为前提），共同构成 P1 优先级，是本特性能否成立的核心判定逻辑与最小合法出口。US3/US4/US5 是支撑性/防御性能力（P2），在 US1+US2 判定核心验证通过后按 MEDIUM 风险顺序依次补齐，最终由 US5 完成挂载与全量生效验证。

---

## 备注

- [P] 任务 = 不同文件、无依赖
- [Story] 标签用于任务到 User Story 的可追溯映射
- Tests FIRST 任务（T005/T008/T011）必须先跑到红（对应实现文件不存在或逻辑未完成），再实现使其转绿
- [CLEANUP] 任务（T015）是 plan.md Codebase Reality Check 判定的前置整理任务，职责收窄，不做无依据重排
- `hooks.json` 挂载（T026）是全特性风险最高的动作，严格排在判定核心（Foundational）与 CLI 编排（US1）与阻断路由（US4）全部验证通过之后
- 每完成一个 Phase 提交前，按 CLAUDE.local.md 约定跑 Codex 对抗审查（本任务清单外的执行期约定，不在此列任务项）
