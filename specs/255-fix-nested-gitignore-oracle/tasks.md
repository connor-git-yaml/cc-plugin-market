---
feature: 255-fix-nested-gitignore-oracle
mode: fix
based_on: plan.md（方案 A）+ fix-report.md
status: planned
---

# 任务清单：采集侧 gitignore oracle 与 freshness dirty oracle 统一

**输入制品**：`specs/255-fix-nested-gitignore-oracle/plan.md`（变更清单/回归风险评估/测试规划/验证方案）、`specs/255-fix-nested-gitignore-oracle/fix-report.md`（5-Why、A1-A4 复现链、方案 A 论证）

**执行顺序硬约束**（plan.md「验证方案」节）：实现（file-scanner → BEHAVIOR_VERSION bump）→ 受影响测试子集验证 → 新增测试验证 → `npm run build` → 护栏 pinned 资产再生（`npm run fixtures:regen:collector-fingerprint`，必须在 BEHAVIOR_VERSION 改动之后、全量 vitest 之前）→ 全量 `npx vitest run` → `npm run repo:check` → Codex 对抗审查。**顺序颠倒会先红**：若在 BEHAVIOR_VERSION 改动前跑护栏再生脚本，或在护栏再生前跑全量 vitest，`collector-fingerprint-guardrail.test.ts` 的 `behaviorVersion` 显式断言会失败。

本卡为 fix 模式，无 User Story 拆分；任务按「实现 → 验证 → 收尾」三段组织，每段内部标注可并行任务。

---

## Phase 1: 实现（Implementation）

**目的**：完成方案 A 的核心代码变更（git 事实源忽略清单预计算 + scanFiles 基准修正 + 指纹 bump），此阶段完成前不得跑护栏再生或全量测试。

- [x] T001 改造 `src/utils/file-scanner.ts::createGitignoreFilter`：签名扩展为 `createGitignoreFilter(projectRoot, walkBase = projectRoot)`；新增 git 模式分支——`git -C <walkBase> ls-files --others --ignored --exclude-standard --directory -z` 预取忽略清单，构建 {精确文件集合 + 目录前缀表}，返回纯查找函数；`<projectRoot>/.git` 存在但命令执行失败时 `console.warn` 一次并回退。**验收判据**：函数导出签名新增可选第二参，4 处既有单参调用点（`source-discovery.ts` ×2、`python-adapter.ts`、`ignore-oracle.ts`）无需改动即可通过 `npm run build` 类型检查（依赖 T004 类型检查阶段确认，本任务先完成实现）。
- [x] T002 [P] 在 `createGitignoreFilter` 中实现非 git / git 失败回退路径：检测无 `.git` 目录或 git 命令失败且 `<projectRoot>/.git` 不存在时，完全复用现有 `parseGitignore` 根解析逻辑（含 `globToRegex` 近似 glob 语义），逐字节不变。**验收判据**：本任务与 T001 同文件不同代码路径，标记 [P] 仅表示逻辑上可独立设计验证，落地时与 T001 合并在同一次编辑中完成；判据为 Phase 2 中 `tests/unit/file-scanner.test.ts` 既有用例组零改动全绿。
- [x] T003 [US-内部依赖 T001] 修正 `src/utils/file-scanner.ts::scanFiles`：将内部对 `parseGitignore(gitignorePath)` 的直接调用改为经由 `createGitignoreFilter(projectRoot, resolvedDir)`（两参数），对齐 walk 基准与 git 输出基准，修复 L191-194 已注记的 `scanRoot ≠ projectRoot` 基准错位怪癖。**验收判据**：`scanFiles(PROJECT_SRC)` 不传 `projectRoot` 时（`tests/self-hosting/self-host.test.ts` 场景），`projectRoot` 缺省 = `resolvedDir` = `src/`，git 模式下根 `.gitignore` 语义首次真正生效且无 MISS。
- [x] T004 `src/panoramic/graph/collector-fingerprint.ts`：`BEHAVIOR_VERSION` 由 `1` 改为 `2`。**验收判据**：改动后 `BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 清单本身不变；`collector-fingerprint.test.ts`/`source-commit.test.ts` 无硬编码字面量 `1` 断言（已在 plan.md 核实），无需同步改动这两个测试文件本身。**此任务必须在 T001-T003 之后、Phase 4 护栏再生之前完成，不可提前也不可拖后**。
- [x] T005 [P] 注释矫正（无行为变化）：`src/utils/file-scanner.ts` 头部「基准契约」段、`src/panoramic/graph/quality/ignore-oracle.ts` 头部"读 .gitignore 文件"措辞、`src/adapters/python-adapter.ts` L142 附近、`src/batch/stages/source-discovery.ts` L265 附近 F194 注释中"只读根"相关表述，全部改为与新实现（git 事实源 + 非 git 回退）对齐的描述。**验收判据**：`grep` 全仓无残留"只读根 .gitignore"类表述；不改变任何可执行代码行。

**Checkpoint**：Phase 1 完成后，`src/` 内代码变更全部落地，尚未跑任何测试/build/护栏再生。

---

## Phase 2: 受影响测试子集验证（零回归优先确认）

**目的**：在改动新增测试之前，先确认 Phase 1 的实现对既有测试零回归（含非 git 回退路径的字节级不变性 + 仓库内既有调用点行为）。此阶段依赖 Phase 1 全部任务完成。

- [x] T006 [依赖 T001-T003] 运行 `npx vitest run tests/unit/file-scanner.test.ts tests/adapters/python-adapter.test.ts tests/unit/batch-orchestrator-gitignore.test.ts src/panoramic/graph/quality/ignore-oracle.test.ts src/batch/generic-language-skeleton-collector.test.ts tests/self-hosting/self-host.test.ts`。**验收判据**：全部既有断言零改动全绿；若任一断言需要改动才能通过，说明非 git 回退路径未做到逐字节不变或 git 模式行为偏离预期，须回头修正 Phase 1 实现（不允许改测试断言掩盖）。
- [x] T007 [P][依赖 T006] 单独复核 `npx vitest run tests/self-hosting/self-host.test.ts`（最高风险点，plan.md 回归风险评估第 2 节）。**验收判据**：`files.length >= 10` 等既有断言不变，确认根 `.gitignore` 首次在此调用路径生效后无假失败。

**Checkpoint**：既有测试面零回归确认完毕，方可继续新增测试。

---

## Phase 3: 新增测试（覆盖 fix-report A1-A4 复现链）

**目的**：固化本次修复消除的分叉行为，覆盖 plan.md「测试规划」全部用例。此阶段依赖 Phase 1 完成（需要真实实现可测），可与 Phase 2 并行执行（不同测试文件）。

### `tests/unit/file-scanner.test.ts` 新增用例组

- [x] T008 [P] 新增用例「嵌套 `.gitignore` 生效」：临时目录初始化为真实 git 仓库（`git init` + 内联 `-c user.email`/`-c user.name`），根 `.gitignore` 为空，子目录 `sub/.gitignore` 含 `*.go`，断言 `createGitignoreFilter` 对 `sub/foo.go` 返回 `true`（ignored）。**验收判据**：复现 fix-report A1-A2；实现前手动验证该用例在未修复代码上会失败（返回 `false`），修复后转绿。
- [x] T009 [P] 新增用例「tracked 豁免」：同上真实 git 仓库，对匹配 `.gitignore` 模式的文件执行 `git add -f` 后，断言 `createGitignoreFilter` 返回 `false`（不判 ignored），与 fix-report B1 一致，同向于 `git status` 会报告其改动。
- [x] T010 [P] 新增用例「非 git 回退等价」：复用既有 `tmpDir`（非 git，无 `.git` 目录），对比引入 git 分支前后同一组断言（复用现有嵌套忽略/否定模式用例输入），确认无 `.git` 时仍走根解析且结果与修复前逐字节一致。**验收判据**：固化"维度收窄的 fail-open"设计判据。
- [x] T011 [P] 新增用例「`walkBase` 参数生效」：真实 git 仓库，`projectRoot` 为仓库根、`walkBase` 为子目录，验证相对子目录基准的忽略判定正确、无 MISS，覆盖 T003 `scanFiles(projectRoot, resolvedDir)` 传参场景。
- [x] T012 [P] 新增用例「git 命令失败诊断分支」：构造 `<projectRoot>/.git` 存在但 git 命令必然失败的场景（mock/spy 子进程调用抛错），断言 `console.warn` 被调用恰好一次且返回值等价根解析结果。

### `tests/integration/` 新增跨侧一致性回归测试

- [x] T013 [依赖 T008-T012 完成后统一新建] 新建 `tests/integration/gitignore-collector-freshness-consistency.test.ts`，包含以下三个用例：
  - 用例 A「嵌套 `.gitignore` 覆盖的文件不应出现在采集结果中」：真实 git 仓库 + 嵌套 `.gitignore`，断言 `collectGenericLanguageCodeSkeletons`/`scanFiles` 等采集入口返回结果不含该文件（对照 fix-report A1，方向反转：过去入图现在应排除）
  - 用例 B「采集面与 `getDirtySourceFiles` 观测面同向」：同一真实 git 仓库场景，分别调用采集侧过滤逻辑与 `getDirtySourceFiles`，断言两者对同一文件集合的"是否计入观测面"判定一致
  - 用例 C「tracked 对照组 dirty 判定不受影响」：修改 tracked 的 `main.go`（fix-report A4 对照组）后仍正确判 dirty
  **验收判据**：三个用例均使用真实 `git init` 构造的临时仓库（禁止 mock 模拟 git 输出）；实现前须在未修复状态手动验证会失败/命中修复前行为（可复用 fix-report 的 `repro-nested-gitignore.mts` 复现脚本逻辑作为参照），修复后转绿。

**Checkpoint**：T008-T013 全部新增测试单独跑一次全绿，确认覆盖 fix-report A1-A4 复现链。

---

## Phase 4: Build + 护栏 pinned 资产再生（顺序关键）

**目的**：类型检查通过后，在全量 vitest 之前完成护栏 fixture 再生，避免 `collector-fingerprint-guardrail.test.ts` 的显式断言先红。**此阶段任务顺序不可颠倒，T014 → T015 严格串行**。

- [x] T014 [依赖 Phase 1-3 全部完成] 运行 `npm run build`。**验收判据**：`createGitignoreFilter` 签名扩展、`scanFiles` 内部改动、`BEHAVIOR_VERSION` 常量改动零类型错误；4 处既有单参调用点无需修改仍类型兼容。
- [x] T015 [依赖 T014，且必须先于 Phase 5] 运行 `npm run fixtures:regen:collector-fingerprint`，再生 `tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json`、`expected-module-graph.json` 两份 pinned 资产。**验收判据**：脚本输出为"放行"分支（`fingerprintUnchanged=false`），两份资产被更新（`behaviorVersion` 字段从 `1` 变为 `2`，图内容 multiset 不变，因护栏 fixture 落 `os.tmpdir()` 非 git 目录走回退路径）；非 `--init` 模式（两份资产已存在，无需冷启动）。**若此步骤在 T004（BEHAVIOR_VERSION bump）之前执行，再生结果仍为旧版本号，会导致 Phase 5 全量测试先红——必须确认 T004 已完成再执行本任务。**

**Checkpoint**：pinned 资产与代码新指纹一致，方可进入全量测试。

---

## Phase 5: 全量验证与收尾

**目的**：确认零回归、零类型错误、仓库级校验通过，完成提交前对抗审查。

- [x] T016 [依赖 T015] 运行全量 `npx vitest run`。（第一轮 9 失败：charter e2e 快照 9 处 `behaviorVersion: 1` 冻结字面量未随 bump 联动——按 F223/F232 先例外科式替换后重跑，517 files / 6973 tests 零失败；详见 verification/verification-report.md）**验收判据**：零失败；重点复核 `collector-fingerprint-guardrail.test.ts`/`collector-fingerprint-regen-script.test.ts`/`collector-fingerprint.test.ts`/`source-commit.test.ts` 全绿。
- [x] T017 [P][依赖 T016] 运行 `npm run repo:check`。**验收判据**：零失败。（exit 0 全规则 pass；graph-only 重建后 `graph-quality:freshness` 亦转 pass，新图指纹 behaviorVersion=2 端到端落盘）
- [ ] T018 [依赖 T016-T017] 提交前 Codex 对抗审查（依 CLAUDE.local.md 约定，通过 `codex:codex-rescue` 子代理）：聚焦 git 子进程调用的错误处理边界（无 git 二进制、非仓库、命令超时、`walkBase` 与 `projectRoot` 不一致时的路径基准正确性）。**验收判据**：critical/warning 项逐条处置（真实 bug/边界遗漏立即修复重测；风格偏好记录在 commit message），处置完成后重新跑 T016（全量 vitest）确认零失败。

---

## FR / 变更清单覆盖映射表

| plan.md 变更清单编号 | 内容 | 对应任务 |
|---|---|---|
| #1 | `createGitignoreFilter` 新增 `walkBase` 参数 + git 模式分支 + 非 git 回退 | T001, T002 |
| #2 | `scanFiles` 内部改传 `(projectRoot, resolvedDir)` | T003 |
| #3 | `BEHAVIOR_VERSION` 1→2 | T004 |
| #4 | pinned 资产再生 | T015 |
| #5 | 注释矫正 | T005 |
| 回归风险评估 §1 非 git 回退字节级不变性 | T002, T006, T010 |
| 回归风险评估 §2 真实仓库调用点行为 | T006, T007 |
| 回归风险评估 §3 性能预算 | 不新增性能测试（plan.md 已裁定不强制），随 T016 全量跑批间接观察 |
| 回归风险评估 §4 TS 契约兼容性 | T014 |
| 测试规划：嵌套 `.gitignore` | T008 |
| 测试规划：tracked 豁免 | T009 |
| 测试规划：非 git 回退等价 | T010 |
| 测试规划：`walkBase` 参数生效 | T011 |
| 测试规划：git 失败诊断分支 | T012 |
| 测试规划：跨侧一致性回归（A1-A4） | T013 |
| 验证方案 步骤 1-7 | T006/T007（步骤1）→ T008-T013（步骤2）→ T014（步骤3）→ T015（步骤4）→ T016（步骤5）→ T017（步骤6）→ T018（步骤7）|

---

## Dependencies & Execution Order

### 阶段依赖

- Phase 1（实现）：无前置依赖，T001 → T003 存在内部顺序（T003 依赖 T001 已定义新签名），T004 依赖 T001-T003 完成后再改（避免 bump 时机与实现改动交织产生中间态）；T002、T005 可与主线并行设计但落地时机随 T001/T004 合并提交
- Phase 2（受影响测试）：依赖 Phase 1 全部完成
- Phase 3（新增测试）：依赖 Phase 1 全部完成；可与 Phase 2 并行执行（不同测试文件，无写冲突）
- Phase 4（build + 护栏再生）：依赖 Phase 1-3 全部完成；T014 → T015 严格串行，T015 必须晚于 T004
- Phase 5（全量验证）：依赖 Phase 4 全部完成；T016 → T017 可并行，T018 依赖两者

### 关键顺序约束（重申 plan.md 硬约束）

```
T001,T002 → T003 → T004 → [T005 可随时插入]
                              ↓
                    T006,T007（Phase2）与 T008-T013（Phase3）可并行
                              ↓
                            T014
                              ↓
                    T015（必须晚于 T004，早于 T016）
                              ↓
                    T016,T017 → T018
```

**若违反此顺序**（例如 T015 早于 T004，或 T016 早于 T015）：`collector-fingerprint-guardrail.test.ts` 的 `behaviorVersion` 显式断言会先红，需回退重来。

### 并行机会

- Phase 1：T002（回退路径设计）、T005（注释矫正）可与 T001/T003 并行构思，但落地建议合并在同一批编辑中完成，降低中间态风险
- Phase 2/Phase 3：两个 Phase 整体可并行执行（不同测试文件，Phase 2 验证既有面，Phase 3 新增测试面）
- Phase 3 内部：T008-T012（5 个 `file-scanner.test.ts` 新增用例）互相独立，可并行编写；T013（集成测试）建议在前 5 个稳定后再写，复用其中的 git 仓库构造 helper
- Phase 5：T016（全量 vitest）与 T017（repo:check）可并行运行

## 实施策略建议

1. **不拆分 MVP**：本卡是单一 bug 修复，无法增量交付子集（采集面与 dirty 面必须同源升级，中间态会引入新的不一致）
2. **严格线性执行**：Phase 1 → Phase 2/3（可并行）→ Phase 4（严格串行）→ Phase 5，不建议跳过任何一步或调整跨 Phase 顺序
3. **T004（BEHAVIOR_VERSION bump）是全局时序锚点**：必须晚于代码逻辑改动完成，早于护栏再生（T015），这是整个任务序列中最容易出错的顺序陷阱，执行时需显式确认
