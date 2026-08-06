---
feature: 258-fix-graph-truth-source-fidelity
mode: fix
based_on: plan.md（权威，§9/§10/§13/§14）+ plan-revision-brief.md（D1~D10 已定裁决）+ fix-report.md（5-Why + 对抗审查修订 R1~R6 + 用户裁决）
baseline: 19bff52a
branch: claude/f258-graph-fact-source-fixes-6b4e20
status: draft (revised-after-phase2-adversarial-review)
---

# 任务分解：图事实源三处失真收口（F258）

**输入制品**：`specs/258-fix-graph-truth-source-fidelity/plan.md`（必读，本文件严格遵循其 §9 分阶段顺序与 §13 任务索引）、`specs/258-fix-graph-truth-source-fidelity/plan-revision-brief.md`（Phase 2 对抗审查已定裁决 D1~D10，**不得推翻**）、`specs/258-fix-graph-truth-source-fidelity/fix-report.md`（5-Why + 对抗审查修订 R1~R6 + 用户裁决）。

**组织方式**：本 feature 为 `fix` 模式，无 `spec.md` / User Story——按 plan.md §9 的三个 Phase（P1 采集/质量面 → P2 消费侧口径 → P3 base-ref 硬失败）组织，每个 Phase 内部按"决策(CLEANUP 触发判定) → 红用例 → 实现 → 复绿 → 已知限制钉桩 → 变异测试 → 阶段验证 → 对抗复审"排列。P1 与 P2 互相独立本可并行，但 P3 因 `AUDIT_SCHEMA_VERSION` bump 会碰 P2 改过的审计断言，**必须**排在 P2 之后（plan §9 末句），故本文件按 P1→P2→P3 严格串行编号。

**TDD 强制**（plan §10.1）：每条缺陷的实现任务前必须先有"写红用例并确认失败"任务，验收标准包含"确认测试失败且失败原因正确"（不是随便一个失败，是失败在预期断言点）。**新测试不得藏在收官核对清单里**——每条新测试都是有先红步骤的独立任务（D8）。

**验证二进制口径（D2，全局硬约束）**：本文件出现的**所有** spectra 调用一律使用本 worktree 的 `node dist/cli/index.js`。**禁止**使用 PATH 上的 `spectra`（主线程复核实证：`which spectra` ⇒ `~/.volta/bin/spectra`；`spectra --version` ⇒ `v4.4.0 (0ae3eb7)`，非本 worktree 基线 `19bff52a`）。

**可证伪性要求（D8，全局硬约束）**：
- 变异测试任务的验收 = **贴出变红用例的完整名称 + 断言失败输出前 5 行**，写入 `specs/258-fix-graph-truth-source-fidelity/verification/mutation-evidence.md`。仅写"已确认变红后撤销"**不接受**。
- 对抗复审 checkpoint 的验收 = 复审记录必须列出**实际检查的切入角**与**各自的具体查证动作**；**零发现时须说明查了什么**，不接受"未发现问题"一句话结论。
- `[CLEANUP]` 触发判定必须基于 `git diff --stat` **实数**，**不接受"预计"**。

## Format: `[ID] [P?] [Phase] Description`

- **[P]**：可并行（不同文件、无依赖）
- **[P0]/[P1]/[P2]/[P3]/[P4]**：所属阶段（fix 模式无 User Story，用 Phase 标记替代）
- 每个任务给出确切文件路径与验收标准

---

## Phase 0: 跨阶段前置确认

**目的**：在动手前把 plan §12「现在不知道」中可以静态核实的项先落定，并把验证口径钉死，避免后续阶段基于臆测或错误二进制展开。

- [x] T001 [P0] 确认工作目录与基线一致：`git log -1 --format=%H` 应为 `19bff52a` 的后继（rebase 后允许），分支为 `claude/f258-graph-fact-source-fixes-6b4e20`；只读确认，不做任何 git 写操作
- [x] T002 [P0] [P] 通读 `plugins/spec-driver/tests/goal-loop-graph-consumption-integration.test.mjs` 全文（对应 plan §12 item 5），逐行核实是否存在依赖"base-ref 坏了也返回 exit 0"的隐式断言（已知 L446/L462 两处 `baseRefMissing` 断言为 not-provided 形态、不受影响）；产出：完整清单（受影响行号 + 断言内容），供 T051/T053 引用
- [x] T003 [P0] [P] 核查本仓 `specs/products/spectra/current-spec.md` 与 `specs/products/spec-driver/current-spec.md` 是否记载了 gitignore 事实源口径或 coverage scope 判据（fix-report §Spec 影响遗留的"待 plan 阶段确认"）；若记载，登记待同步清单供 T076 处理；若未记载，显式记录"无需同步"结论
- [x] T004 [P0] **[D2] 固定验证二进制口径**：实测记录 `which spectra` 与 `spectra --version` 输出，确认 PATH 上的是全局旧编译产物（非本 worktree 基线）；据此逐条核对 plan §9 / §10.4 与本文件所有验证命令均已改为 `node dist/cli/index.js`（或显式 `--spectra-bin` 指向本地 dist）；产出：书面结论 + 命令清单核对表。**验收**：贴出两条命令的原始输出

**Checkpoint**：Phase 0 完成后方可进入 P1（T002/T003 结论仅供后续引用，不阻塞 P1 开工，但阻塞 P3 开工与最终交付；T004 阻塞一切验证类任务）。

---

## Phase 1: P1 — 采集/质量面（缺陷 1 + 附带项 6.1）

**目标**：三态 gitignore oracle（含 §3.1a errno 三分）收敛离盘判定失真；图质量门 `ignoredPathNodeIds` 维度不再对离盘节点静默漏报；L2 预算有具名出口；诊断出口接上自动化消费者；降级探针基准修正。

**独立验证方式**（plan §9 P1 验证点）：`npx vitest run` 零失败 + `npm run build` + **可控 fixture 验收（缺陷 1 的唯一有判别力验收）** + 本仓实跑（零信息量回归护栏）。

### 决策与前置搬运（条件触发，两遍法）

- [x] T005 [P1] **[D8 两遍法]** 判定 `src/utils/file-scanner.ts` 是否触发 `[CLEANUP]`：先按 plan §3 写出完整改动草稿（不 commit）→ 跑 `git diff --stat src/utils/file-scanner.ts` 取**实数**净增行数 → 按 "LOC > 500 且实测净增 > 50 行" 判定。**验收**：把 `git diff --stat` 原始输出贴进任务记录 + 触发/不触发的书面结论；**不接受"预计"字样**
- [x] T006 [P1] `[CLEANUP]`（条件执行，仅 T005 判定触发时执行）**第二遍**：撤销草稿 → 纯搬运：新建 `src/utils/gitignore-oracle.ts`，只移动 `parseGitignore` / `globToRegex` / `GitIgnoredIndex` / `readGitIgnoredIndex` / `createGitIgnoredLookup` / `createGitignoreFilter`；`file-scanner.ts` 保留 `export { createGitignoreFilter } from './gitignore-oracle.js'`；`scanFiles` 本体一行不动；**独立 commit**，搬运后先跑 `npx vitest run` 全绿 → 再在搬运后的结构上重放功能改动（依赖：T005）

### 红用例（先红，确认失败原因正确）

- [x] T007 [P1] 在 `tests/unit/file-scanner.test.ts`（或 T006 触发时新建 `tests/unit/gitignore-oracle.test.ts`）写红用例 R1-1（`.gitignore` 含 `legacy/` + `*.gen.ts`，文件不在盘，查 `legacy/old.ts`/`foo.gen.ts` 期望 `ignored`；**并含一条目录路径输入用例**钉住 plan §3.1「verdict 接受目录相对路径」的输入契约，INFO-3）、R1-2（`git add -f keep.gen.ts` 后删除工作树文件，tracked-but-deleted，期望 `not-ignored`）、R1-3（复刻 R3 的 `d3`：仅 `*.log` 规则，`generated/notes.ts` 删除后 `generated/` 被折叠，查 `generated/notes.ts` 期望 `not-ignored`）、R1-6（从子目录扫描 + 畸形 `.git` 期望 warn 恰 1 次）；确认全部先失败且失败原因是"当前实现返回 false / 不 warn"而非其他错误（依赖：T005/T006）
- [x] T008 [P1] [P] 在 `src/panoramic/graph/quality/ignore-oracle.test.ts` 写红用例 R1-4（复刻 R4：仓内 symlink 指向被忽略目录，查其下**离盘**路径，期望 `undeterminable` ⇒ 消费方按 not-ignored + `drainUndeterminable().count === 1`）、R1-5（复刻 R2：仓内嵌套未注册 git 仓 `subrepo/`，根 `.gitignore` 命中 `*.gen.ts`，`subrepo/a.gen.ts` 在盘，期望仍 `not-ignored`——KL-1 钉住）；确认全部先失败（依赖：T005）
- [x] T009 [P1] [P] **[D1 新增]** 红用例 R1-7（errno 三分）：构造至少两种形态——① `EACCES`（父目录 `chmod 000`，walk 能枚举到但 `lstat` 抛错）；② 一种非 ENOENT 的其他 errno（`ELOOP` 自指 symlink 环 或 `ENAMETOOLONG`）——期望 verdict 为 `undeterminable`（走 plan §3.1a 的 L3 出口）⇒ 消费方按 not-ignored + 计入 `drainUndeterminable()`，且**不得**落 L2（可用"未起 `git check-ignore` 子进程"或调用计数断言）。⚠️ **root 身份下 EACCES 不可构造**：必须显式 skip 并**打印跳过原因**，不得静默跳过（依赖：T005）
- [x] T010 [P1] [P] **[D1/KL-5 新增]** 红用例 R1-8（**在盘**的 symlink 穿越）：构造 `link_to_ign -> ignored_dir`，查 `link_to_ign/f.ts`（中间段 symlink 被 `lstat` 跟随 ⇒ 判在盘）；断言 verdict === `not-ignored` **且** `drainUndeterminable().count === 0`（钉住"它静默、不计数、永远到不了 L2"= KL-5 的原病保留形态）。测试名与注释须显式标注"KL-5 已知限制，非 bug"（依赖：T005）
- [x] T011 [P1] [P] **[D9/KL-6 新增]** 红用例 R1-9（大小写 / 归一化前提）：在 `core.ignorecase=true` 的 case-insensitive FS 上构造 `IGNORED_DIR/f.ts` 与 `./ignored_dir/f.ts` 两形态，断言 oracle 判 `not-ignored`（与 `git check-ignore` 的 IGNORED 分叉）、落在盘分支、`drainUndeterminable().count === 0`；并断言经 `path.relative` 归一化 + 大小写一致的输入不受影响。**平台相关**：case-sensitive FS 上显式 skip 并打印跳过原因（依赖：T005）
- [x] T012 [P1] [P] **[D8 新增，从原收官清单拆出]** 红用例 R1-10（git worktree 内 oracle 判定与主仓一致）：在 git worktree 内构造与主仓相同的忽略规则与查询路径，断言两侧 verdict 逐条相同。先跑确认当前状态；**若该用例开箱即绿**（预期如此），须在任务记录里写明"本条为锁定不回退的回归护栏，先红步骤不适用的理由"，不得默默略过 TDD 条款（依赖：T005）

### 实现

- [x] T013 [P1] 实现三态 `verdict(relativePath): 'ignored'|'not-ignored'|'undeterminable'`（`file-scanner.ts` 或 T006 产出的 `gitignore-oracle.ts`），严格按 plan §3.1 / §3.1a / §3.3：
  - **存在性探测 = errno 三分（D1，硬性）**：`lstatSync` 成功 ⇒ `on-disk`；`ENOENT`/`ENOTDIR` ⇒ `off-disk`；**其他一切 errno（EACCES/ELOOP/ENAMETOOLONG/code 缺失…）⇒ 直接 `undeterminable`，不得当离盘、不得转 L2**
  - L0：预取构造失败走既有二态近似（永不产 `undeterminable`）
  - L1：`on-disk` 走预取清单查表（dirPrefix 仅在盘分支消费）
  - L2：`off-disk` 走记忆化 `git check-ignore -q -- <path>`（仅 `status===1` 判 `not-ignored`，其余含 `null`/128 一律 `undeterminable`；`--` 分隔符必需；不加 `--no-index`；`cwd` 取 `walkBase`）
  - `createGitignoreFilter` 保留原签名与 boolean 返回，降为薄壳（= L0/L1 分支，不做存在性探测、不起子进程）
  - （依赖：T007, T008, T009, T010, T011, T012）
- [x] T014 [P1] 实现 6.1 降级探针基准修正：`file-scanner.ts` 的降级 warn 探针改为从 `walkBase` 起向上逐级查找 `.git`（文件或目录，兼容 worktree 形态），到文件系统根为止；不用 `git rev-parse --is-inside-work-tree` 复核（依赖：T013）
- [x] T015 [P1] **[D7 新增]** 实现 L2 预算与**具名出口**：oracle 实例持有 L2 累计耗时预算 `l2BudgetMs`，默认值**必须显著小于**下游 `graph-bootstrap-status.mjs:41` 的 `DEFAULT_FRESHNESS_DEADLINE_MS = 5000` 并留余量（具体值带实测定，见 plan §12 item 8；**不引入新环境变量**）；预算耗尽后不再发起新的 L2 查询，此后所有 `off-disk` 路径返回 `undeterminable` 并计入 `drainUndeterminable()`，标记原因 **`l2-budget-exhausted`**；`drainUndeterminable()` 返回形状扩为 `{ count, samples, budgetExhausted }`；保留既有"累计 L2 调用 > 200 输出一次聚合 warn"（与预算耗尽是两件事，文案不得混用）。**验收**：一条测试构造超预算场景，断言 `budgetExhausted === true` 且后续查询未再起子进程（依赖：T013）
- [x] T016 [P1] 重跑 T007–T012 全部红用例，确认转绿（R1-8/R1-9 按"钉住实际行为"绿、R1-10 按"与主仓一致"绿）（依赖：T013, T014, T015）

### `ignore-oracle.ts` 返回对象化 + 消费点适配 + 诊断出口接消费者

- [x] T017 [P1] `src/panoramic/graph/quality/ignore-oracle.ts`：`createIgnoreOracle` 改为返回 `{ isIgnored(relPath): boolean, drainUndeterminable(): { count, samples, budgetExhausted } }`；`isIgnored` 消费三态并统一按"`undeterminable` ⇒ 按 `not-ignored` 处理"收口（plan §3.5 两类消费方同向）；不开"返回裸谓词"的二次便捷入口。**[D10 措辞同步]** 注释与任务记录中**不得**再写"walk 场景结构上不可达 `undeterminable`"——如实写为"walk 场景**通常**不可达，但 EACCES/ELOOP 等 errno 形态**可达**，此时按 not-ignored 处理 = 与旧行为逐字节一致"（依赖：T013, T015）
- [x] T018 [P1] `src/cli/commands/graph-quality.ts:295` 调用点适配：`buildReport` 结束后取一次 `drainUndeterminable()`，`count > 0` 时 ① 追加一条 `nextSteps` 文案（**必须以稳定的机读前缀 token 开头**，供 T019 消费；文案须能**区分**"判不了"与"预算耗尽所以没去判"）+ ② 同步一条 stderr warn；`checkLegacyAndIgnoredNodes` 传入 `oracle.isIgnored`（同步 boolean 契约不变）。**验收**：token 字面值写入 plan §12 item 7 的落定记录（依赖：T017）
- [x] T019 [P1] **[D4 新增，必做]** `scripts/lib/graph-quality-core.mjs`：新增 warn 级 check `ignore-undeterminable`——解析 `report.nextSteps`，命中 T018 定义的机读前缀 token 时 push 一条 warning + `createCheck('ignore-undeterminable', …, 'warn')`；注意放在**报告解析成功之后**的正确位置，不得被既有早退分支（dist 未构建 / spawn 失败 / JSON 解析失败 / exit code 不一致 / cannot-assess）跳过（plan §12 item 10）。同批在 `tests/unit/graph-quality-core.test.ts` 补两条断言：① 命中 token ⇒ 出现该 warn check；② **早退分支不误报**。⚠️ 该 check 依赖**文本前缀契约**（schema 顶层 `additionalProperties:false` 挡住结构化字段），必须由跨侧测试双向钉住 token（依赖：T018）
- [x] T020 [P1] `src/batch/generic-language-skeleton-collector.ts:121` 调用点适配（一行改为 `oracle.isIgnored`）+ walk 结束后 `count > 0` 时输出聚合 warn。**[D10 措辞同步]** 注释不得写"结构上不可达"，改为"通常不可达（dirent 恒在盘），但 errno 形态可达"（依赖：T017）
- [x] T021 [P1] 机械更新约 20 处测试调用点（`ignore-oracle.test.ts` 约 18 处 + `tests/unit/collector-surface.test.ts:597`）：`createIgnoreOracle(x)` → `createIgnoreOracle(x).isIgnored`（该替换经复核安全：这些 tmpDir 是非 git 仓 ⇒ 全走 L0 分支）（依赖：T017, T018, T020）

### 契约注释重写 + 已知限制钉桩

- [x] T022 [P1] **[D1/D6/D9 合并]** 契约注释重写，范围为 4 个文件：
  - `file-scanner.ts` / `gitignore-oracle.ts`（若 T006 触发） / `ignore-oracle.ts`：撤下"以 git 本体为事实源""与 `git status` 同源""唯一被击穿的是图质量门"三句 over-claim；改为指名 `git ls-files --others --ignored --directory`（在盘枚举）/ `git check-ignore`（含 index，权威但非全域）两个不同 oracle；`createGitignoreFilter` 的 JSDoc 显式声明「输入路径 MUST 来自 walk 的 dirent（恒在盘）且 MUST 已归一化、大小写与磁盘一致；离盘路径 MUST 改用 `createGitignoreOracle().verdict`」（**D9 前提**）；写入 **KL-1..KL-6** 完整已知限制表；写入"存在性依赖是契约的一部分"（同一路径在盘/离盘可得相反答案，INFO-4）与"verdict 接受目录路径"（INFO-3）两条契约声明
  - **[D6]** `src/panoramic/graph/quality/quality-engine.ts:9-11` 与 `src/panoramic/graph/quality/legacy-ignored-check.ts:7-8` 的文件头：本模块自身仍不做 I/O，但**对注入回调不再假设纯粹性**——回调可能 spawn 子进程、带内部可变状态（记忆化 Map / undeterminable 累加器 / L2 预算计时），同一份 graph 连跑两次可能给出不同结果；输出是**相对于注入回调的**确定性；需要可重现结果的调用方必须注入自己的确定性回调。**验收**：两个文件头不再含"零 I/O 纯函数"的无条件表述
  - （依赖：T013, T015, T017）
- [x] T023 [P1] KL-2 补充钉桩测试（在 T008 基础上补齐 plan §3.7 KL-2 完整形态清单，均为**离盘**形态）：正式 submodule 内路径、仓外绝对路径、`..` 越界、空串，各构造一条离盘查询用例，期望均为 `undeterminable` ⇒ 按 not-ignored 处理，不触发无差别 fail-loud（依赖：T013, T017）
- [x] T024 [P1] KL-4（R6）钉桩测试：构造"同一份图两次运行间 `ignoredPathNodeIds` 因未提交 `.gitignore` 改动而翻转、`freshness` 三维仍报 fresh"的场景，确认该行为按设计发生（不修复，只钉住并断言 defer 结论仍成立）；对应写入 `source-commit.ts:69` 附近注释一句指向本 fix 的 KL-4 记账（依赖：T013）
- [x] T025 [P1] **[D1 新增，带证据裁决，不得静默略过]** 评估 plan §3.8 的候选改良——「对预取清单里的条目，若其在盘为 **symlink 指向目录**，则同时登记为 dirPrefix」。必须产出**带证据**的书面裁决：
  - 纳入 ⇒ 补红用例（在盘 symlink 子路径判 `ignored`）+ **实测** walk 热路径新增 `lstat`/`readlink` 的成本（不得推演）+ 相应修订 KL-5 的登记范围与 T010 的断言
  - 不纳入 ⇒ **必须写明理由**（成本 / 风险 / 与 F255 性能前提冲突等），KL-5 保持原样登记
  - **验收**：裁决文本 + 支撑证据（实测数字或明确的风险论证）落进 `specs/258-fix-graph-truth-source-fidelity/verification/`；**"未评估"或空缺不接受**（依赖：T013, T022）

### 回归护栏复跑

- [x] T026 [P1] 复跑 F255 回归族确认零改动全绿：`tests/unit/file-scanner.test.ts` 的 F255 既有族（6 条）+ `tests/integration/gitignore-collector-freshness-consistency.test.ts`（用例 A/B/C）；确认 diff 中这些用例断言文本未被改动（依赖：T016, T021）

### 变异测试（证守护力，**须落证据**）

> 所有变异任务共同要求（D8）：**贴出变红用例的完整名称 + 断言失败输出前 5 行**，写入 `specs/258-fix-graph-truth-source-fidelity/verification/mutation-evidence.md`；确认后撤销变异，不得把变异代码带入最终 diff。

- [x] T027 [P1] [P] 变异 M1：把 `queryCheckIgnore` 的 `status === 1` 改为 `status !== 0` ⇒ 确认 R1-4 变红（依赖：T016）
- [x] T028 [P1] [P] 变异 M2：把 L1/L2 判定顺序对调（先查 dirPrefix 再判存在性）⇒ 确认 R1-3 变红（依赖：T016）
- [x] T029 [P1] [P] 变异 M3：让 oracle 对 `undeterminable` 返回 `true` ⇒ 确认 R1-4 的 `ignoredPathNodeIds` 断言变红（两消费方同向被破坏）（依赖：T016, T018, T020）
- [x] T030 [P1] [P] **[D1 新增]** 变异 M9：把 `probePresence` 的 errno 三分改为"任何 `lstat` 失败都当 `off-disk`" ⇒ 确认 R1-7 变红（依赖：T016）
- [x] T031 [P1] [P] **[D4 新增]** 变异 M10：删除 `graph-quality-core.mjs` 的 `ignore-undeterminable` check（或改成不读 `nextSteps`）⇒ 确认 `tests/unit/graph-quality-core.test.ts` 中该 check 的断言变红（依赖：T019）

### P1 阶段验证

- [x] T032 [P1] **[D2 新增，缺陷 1 的唯一有判别力验收]** 可控 fixture 验收：在 fixture 仓中 ① 建图 → ② **删除若干源文件制造离盘节点**（一部分命中 `.gitignore` 规则、一部分不命中）→ ③ **不重建** → ④ 直接跑 `node dist/cli/index.js graph-quality --json`；断言这些节点**按 `.gitignore` 规则正确进/不进** `ignoredPathNodeIds`（命中规则的进、未命中的不进、不可判的不进且计数出声）。**验收**：贴出 fixture 构造步骤 + `ignoredPathNodeIds` 实际内容 + 逐条真/假阳性判定。若出现假阳性 ⇒ **停止**并回到 plan §3 设计而非调阈值（依赖：T016, T018, T019, T020, T021）
- [x] T033 [P1] **[D2 降级]** 本仓实跑（**零信息量的回归护栏，不得当作缺陷 1 的验收证据**）：`npm run build && node dist/cli/index.js batch --mode graph-only && node dist/cli/index.js graph-quality --json --graph specs/_meta/graph.json`，确认六指标全 pass。**已测定的前提**（plan §12 item 1/2）：本仓图 `nodes 6092 / distinct fileParts 996 / OFF-DISK 0 / _reference 节点 0` ⇒ 新增 `ignoredPathNodeIds` 预期为 **0**、`drainUndeterminable().count` 预期恒 **0**，故该实跑无论实现好坏都恒绿。**验收**：显式记录"本条为恒绿护栏"；若意外出现新增条目或非零计数，说明有未预期的离盘节点，**必须**逐条判定真/假阳性并回到设计（依赖：T032）
- [x] T034 [P1] `npx vitest run` + `npm run build` 全量确认零失败（P1 收口，含新红用例 R1-1..R1-10 + F255 族 + 约 20 处机械更新点 + `graph-quality-core` 新断言）（依赖：T033）
- [x] T035 [P1] P1 checkpoint：独立子代理异构对抗复审（≥2 个不同切入角，如"fail-open 面"/"绕过构造面"；Codex 配额暂停期，须在复审记录中显式标注「Codex 审查暂停，异构档位缺席」）。**验收（D8）**：复审记录必须列出实际检查的**切入角**与各自的**具体查证动作**；零发现时须说明**查了什么**。处置发现的 critical/warning，若有修复需回跑 T034（依赖：T034）

**Checkpoint**：P1 全绿 + fixture 验收无假阳性 + 本仓护栏恒绿，方可进入 P2。

---

## Phase 2: P2 — 消费侧口径（缺陷 3 + 附带项 6.2）

**目标**：`.mjs` 消费侧覆盖面判定从"扁平扩展名 + toLowerCase"改为逐管线 `{extensions, matchSemantics}` 同解判定，修复 `.PY` 误判 in-graph-scope；畸形指纹取值接上 stderr 消费者；`--refresh-deadline-ms` 类型闸门修正。

**独立验证方式**：`npm run test:plugins` + `npx vitest run` 零失败 + 同解真值表 9 条全绿 + `--refresh-deadline-ms --format json` 形态被判用法错误 + 畸形指纹形态下 stderr 出现 warn。

### 决策与前置搬运（条件触发，两遍法）

- [x] T036 [P2] **[D8 两遍法]** 判定 `plugins/spec-driver/scripts/graph-consumption-cli.mjs` 是否触发 `[CLEANUP]`：先写改动草稿 → `git diff --stat plugins/spec-driver/scripts/graph-consumption-cli.mjs` 取**实数** → 按 "LOC > 500 且实测净增 > 50 行" 判定。**验收**：贴 `git diff --stat` 原始输出 + 书面结论；**不接受"预计"**
- [x] T037 [P2→**改在 P3 执行**，编排器已批准；理由与执行记录见 `verification/p2-decisions.md` 与 `verification/p3-decisions.md`] `[CLEANUP]`（条件执行，仅 T036 判定触发时执行）**第二遍**：撤销草稿 → 纯搬运：新建 `plugins/spec-driver/scripts/lib/graph-consumption-inputs.mjs`，只移动 `runGit` / `collectChangeSet` / `collectGraphAvailability` / `deriveScopeSurfacesFromFingerprint` / `collectCoverageScope`；新文件被 `resolveImportClosure(CLI_PATH)` 自动纳入 RG-006 被审集合，**必须**追加进 `RG006_MINIMUM_AUDITED_FILES` 下限清单；独立 commit，搬运后先跑 `npm run test:plugins` 全绿 → 再重放功能改动（依赖：T036）

### 红用例（先红，确认失败原因正确）

- [x] T038 [P2] 在 `plugins/spec-driver/tests/graph-consumption-cli.test.mjs` 写红用例 R3-1（变更文件 `foo.PY`，图无指纹走静态面，期望 `out-of-graph-scope`，当前误判 `in-graph-scope`）+ 6.2 用例（`--refresh-deadline-ms` 后接 `--format json` / 缺省下一 token，期望被判用法错误 `return 2`，而非 `Number(true)=1` 把预算压成 1 ms）；确认先失败且失败原因正确（依赖：T036/T037）
- [x] T039 [P2] [P] 在 `plugins/spec-driver/tests/graph-consumption-decision.test.mjs` 写红用例 R3-2（`annotate-caveat --target 'foo.PY::bar'`，`directCallers:0`，当前误挂 caveat）、R3-3（指纹 entry 缺 `matchSemantics` 或取值为 `'case-folded'`，期望整体回落 + `scopeExtensionsSource: 'static-fallback-malformed-fingerprint'` **且 stderr 出现一条 warn**——D4 消费者断言，缺 warn 即算红）、R3-4（`Foo.JAVA` case-insensitive 面仍判 in-scope，防修过头的正向用例）；确认先失败（依赖：T036）

### 实现

- [x] T040 [P2] `graph-consumption-decision.mjs`：新增 `GRAPH_SCOPE_SURFACES`（逐管线 `{id, extensions, matchSemantics}`，5 条与 `computeCollectorFingerprint().extensionSurface` 同形，java/go 合并为 `genericAdapters`）；整体删除扁平 `GRAPH_SCOPE_EXTENSIONS`（不留兼容别名）；新增 `surfaceMatchesFileMjs(surface, filePathOrName)`（`case-sensitive` 用 `endsWith`；`case-insensitive` 用 `path.extname().toLowerCase()`；未知语义显式 `return null`，不用 `else` 兜底）；新增 `targetInScope(target, surfaces)`（剥 `::`/`#` 取 filePart 后走 `surfaceMatchesFileMjs`）替代 `extensionOf`；`annotateImpactCaveat` 第 4 参默认值改为 `GRAPH_SCOPE_SURFACES`；零 import 断言由"空数组"收窄为封闭等值 `["import path from 'node:path';"]`（依赖：T038, T039）
- [x] T041 [P2] `graph-consumption-cli.mjs`（或 T037 产出的 `graph-consumption-inputs.mjs`）：`deriveScopeExtensionsFromFingerprint` 更名 `deriveScopeSurfacesFromFingerprint`，新增 entry 级校验（`entry.matchSemantics` 必须存在且 ∈ `{'case-sensitive','case-insensitive'}`，缺失/未知 ⇒ 整体返回 `null` 回落静态面；任一 entry 不合规 ⇒ 全有或全无回落）；`collectCoverageScope` 改为 `files.some((f) => surfaces.some((s) => surfaceMatchesFileMjs(s, f) === true))`；`scopeExtensionsSource` 扩为三值；`coverageUnionApplied` 改为逐管线合并（按 id 配对取 `extensions` 并集；`matchSemantics` 两侧不一致时该 id 按两条独立条目并存，不 throw）（依赖：T040）
- [x] T042 [P2] **[D4 新增，必做]** 畸形指纹的**主动信号**：`graph-consumption-cli.mjs` 在判定 `scopeExtensionsSource === 'static-fallback-malformed-fingerprint'` 时额外输出一条 **stderr warn**，内容含指纹被拒的具体原因（顶层 key 不匹配 / `formatVersion` 不支持 / 某 entry 的 `matchSemantics` 缺失或未知）。⚠️ 若实测发现 stderr warn 与既有输出契约冲突而不可行，**必须**回到 plan §5.5 把该出口如实降级为"事后取数字段"并**从 R5 修复交付物中移除**——不允许留一个"新增了取值但没人会知道"的出口（依赖：T041）
- [x] T043 [P2] `graph-consumption-cli.mjs`：6.2 类型闸门——`flags['refresh-deadline-ms'] !== undefined && typeof flags['refresh-deadline-ms'] !== 'string'` 时打印用法错误并 `return 2`，随后才 `Number(...)` 做既有正数校验；同批同形核查其余取值型 flag（`--base-ref`/`--phase`/`--spectra-bin`/`--target`/`--decision`/`--impact-result`/`--tasks-file`/`--format`/`--project-root`）是否均已用 `typeof … === 'string'` 判定，若发现例外记进 fix-report（不在本任务顺手改）（依赖：T038）
- [x] T044 [P2] 重跑 T038/T039 全部红用例，确认转绿（含 R3-3 的 stderr warn 断言）（依赖：T040, T041, T042, T043）

### 跨语言合同测试升级

- [x] T045 [P2] `tests/unit/graph-scope-extensions-contract.test.ts` 由"扁平并集一致"升级为逐管线逐字段锚定：① `GRAPH_SCOPE_SURFACES` 的 id 集合 === `Object.keys(computeCollectorFingerprint().extensionSurface)`；② 每个 id 的 `extensions`（排序后）与 `matchSemantics` 两侧逐字相等；③ `FINGERPRINT_SURFACE_KEYS`/`SUPPORTED_FINGERPRINT_FORMAT_VERSION` 既有两条断言保留；④ 新增同解真值表：`foo.PY`、`foo.py`、`.ts`、`src/.go`、`Foo.JAVA`、`a.mjs`、`x.MTS`、`f.go/`、`no-ext` 共 9 条，逐条断言 `surfaceMatchesFileMjs(mjs 侧, name) === surfaceMatchesFile(TS 侧对应 surface, name)`（依赖：T040, T041）

### 变异测试（证守护力，**须落证据**）

- [x] T046 [P2] [P] 变异 M6：把 `surfaceMatchesFileMjs` 的第三出口（`return null`）改回 `else` 兜底到 `case-insensitive` ⇒ 确认 R3-3 变红（依赖：T044）
- [x] T047 [P2] [P] 变异 M7：把 `GRAPH_SCOPE_SURFACES` 某条的 `matchSemantics` 改成另一值 ⇒ 确认 §5.6 逐管线合同断言 + 同解真值表变红（依赖：T045）
- [x] T048 [P2] [P] 变异 M8：删除 T043 的类型闸门 ⇒ 确认 6.2 用例变红（依赖：T044）

### P2 阶段验证

- [x] T049 [P2] `npm run test:plugins` + `npx vitest run` 全量确认零失败（含同解真值表 9 条全绿）（依赖：T045, T046, T047, T048）
  - **部分完成**：`npm run test:plugins` 已跑 ⇒ `tests 1501 / pass 1501 / fail 0`；同解真值表 9 条全绿（`npx vitest run tests/unit/graph-scope-extensions-contract.test.ts` ⇒ 9 passed）。`npx vitest run` **全量**按编排器指令推迟到 P1/P2 并行结束后由主编排器统一跑（P1 正在并行改 `src/`，此刻跑全量分不清归属）。
- [x] T050 [P2] P2 checkpoint：独立子代理异构对抗复审（≥2 个不同切入角；须标注「Codex 审查暂停，异构档位缺席」）。**验收（D8）**：复审记录列出切入角 + 具体查证动作，零发现须说明查了什么。处置 critical/warning，若有修复需回跑 T049（依赖：T049）

**Checkpoint**：P2 全绿方可进入 P3（P3 因 `AUDIT_SCHEMA_VERSION` bump 会碰 P2 改过的审计断言，硬性排在 P2 之后）。

---

## Phase 3: P3 — base-ref 硬失败（缺陷 2）+ 契约收口

**前置条件**：P1、P2 均已收口（T035、T050 完成）。

**目标**：base-ref 不可解析时显式报错（exit 3），不与"变更类别真判不出来"共用出口/降级码；**abort 的处置、预算与恢复口径同批落地**（D5）；`classifyChangeSet` 新增"输入不可信"required 显式入口；canonical SKILL 三处调用点同批更新。

**独立验证方式**：`npm run test:plugins` + `npx vitest run` + `npm run build` + `npm run repo:check` + `npm run release:check` 全零失败。

### 前置通读与红用例

- [x] T051 [P3] 复核 T002（Phase 0）产出的 `goal-loop-graph-consumption-integration.test.mjs` 通读结论，确认本 Phase 改动不会踩中隐式假设；若 T002 发现新依赖点，先在此登记处置方案（依赖：T002, T050）
- [x] T052 [P3] 在 `plugins/spec-driver/tests/git-change-classifier.test.mjs` 写红用例 R2-4：`classifyChangeSet({nameStatusText:'', porcelainText:'…'})`（缺 ok 位），确认当前静默返回 `{ok:true, entries:[]}`（先红——期望改为 throw）（依赖：T051）
- [x] T053 [P3] 在 `plugins/spec-driver/tests/graph-consumption-cli.test.mjs` 写红用例 R2-1（`--base-ref deadbeef…` 不可解析，当前 exit 0 + `skip-impact` + `baseRefMissing:false`，期望 exit 3 + `error:'base-ref-unresolvable'` + 审计含 `decide-aborted` 事件）、R2-2（同上 + `--advisory`，当前 exit 0，期望同样 exit 3）、R2-3（`--base-ref-from-trace` 指向无锚点文件，期望 `baseRefMissing:true` / exit 0 **不变**——EC-29 回归护栏，此条应已绿，用于锁定不回退）；确认 R2-1/R2-2 先红、R2-3 先绿（依赖：T051）
- [x] T054 [P3] 补充 rev-parse 退出码谱红用例（plan §12 item 4）：至少 3 种异常形态（`-` 开头的 ref、含空格/特殊字符的 ref、指向已被 rebase 丢弃的悬空 sha），实测并记录 `git rev-parse --verify --quiet <ref>^{commit}` 的确切退出码；实现按"非 0 即 unresolvable"收口（保守方向）。**验收**：贴出三种形态的实测退出码（依赖：T051）
- [x] T055 [P3] **[D5 新增]** 红用例 R2-5（abort 的**处置面**，三条断言）：
  - ① abort 路径**不产生任何刷新**：断言无 `executeRefresh` 调用痕迹 / 无刷新类审计事件——这是"abort 不消耗刷新预算"这条散文口径的机器侧支撑
  - ② **恢复口径可用**：同一仓在 abort 之后，显式传一个可达的 `--base-ref` 重跑 ⇒ 正常 exit 0 并给出决策（证明 abort 不是死路）
  - ③ abort payload **不含** `degradedReason` / `fallbackHint`（封闭键集断言，钉住 §4.7 的"不得记 undefined"红线）
  - 确认三条先红（abort 出口尚不存在）（依赖：T051）

### 实现

- [x] T056 [P3] `git-change-classifier.mjs`：`classifyChangeSet` 入参改为 `{ nameStatusText, nameStatusOk, porcelainText, porcelainOk }`，两个 `ok` 位非 boolean 时 `throw TypeError`（required + fail-loud）；`nameStatusOk===false` 或 `porcelainOk===false` ⇒ 直接置 `unrecognized=true` ⇒ `changeClass='unknown'`；同批更新既有调用点与既有测试（依赖：T052）
- [x] T057 [P3] `graph-consumption-cli.mjs`：`runGit` 改为结构化返回 `{ ok, status, stdout, stderr, spawnError }`（`spawnSync` 失败时 `status` 为 `null`）（依赖：T053）
- [x] T058 [P3] `graph-consumption-cli.mjs`：`collectChangeSet(projectRoot, baseRef)` 改为返回 `{ changeClass, files, baseRefResolution, worktreeStatusReadFailed }`；实现 plan §4.2 五种情形判定表（未传 → `not-provided` 不硬失败；可解析 → `resolved`；`rev-parse` 非零 → `unresolvable` 硬失败；diff 失败 → `diff-failed` 硬失败；porcelain 失败 → 不硬失败 + `worktreeStatusReadFailed:true`）；把"base-ref 硬失败 / porcelain 不硬失败"的责任方差异写进代码注释（依赖：T054, T057）
- [x] T059 [P3] `graph-consumption-cli.mjs`：实现 abort 出口——退出码 3；`--advisory` 下同样 exit 3；stdout 输出**封闭键集** JSON（`schemaVersion`/`error`/`ts`/`projectRoot`/`phase`/`advisory`/`baseRef`/`baseRefResolution`/`gitStatus`/`gitStderr`（截断 512 字符）/`hint`/`auditWritten`；**明确不含** `degradedReason`/`fallbackHint`）；`hint` 文案须指名两条恢复路径（显式 `--base-ref` 覆盖 / 显式重记锚点并留痕）；追加 `kind:'decide-aborted'` 审计事件（该事件按 plan §3.5a 裁决**无需**额外消费者）（依赖：T055, T058）
- [x] T060 [P3] `graph-consumption-cli.mjs`：成功路径新增 3 个观测字段——`baseRefMissing`（语义不变）、`baseRefResolution`（`'not-provided'|'resolved'`）、`worktreeStatusReadFailed`——接入 `decide` 输出与 `kind:'decision'` 审计事件（依赖：T058）
- [x] T061 [P3] `AUDIT_SCHEMA_VERSION` 3 → 4；`DECIDE_OUTPUT_KEYS`（或等价输出字段清单常量）同步更新。**[INFO-1 连锁面]** 除 `decision` 事件（`graph-consumption-cli.mjs:589`）与 `decide` payload（`:608`）外，**还有 `caveat-annotation` 事件（`:723`）**必须一并核对；测试侧只有 2 处钉死 3（`graph-consumption-cli.test.mjs:1024 / :1079`），且**无入库 audit fixture** ⇒ 漏改不会被 fixture 抓到，必须人工逐处核对并在任务记录列出核对清单。同批逐一核对 P2 阶段（T040–T045）已改过的审计断言，冲突处同批修订（依赖：T059, T060；显式依赖 P2 完成）
- [x] T062 [P3] 重跑 T052/T053/T054/T055 全部红用例，确认转绿；同批确认 R2-3（EC-29）仍绿（依赖：T056, T057, T058, T059, T060, T061）

### 变异测试（证守护力，**须落证据**）

- [x] T063 [P3] [P] 变异 M4：把 abort 分支改为 `return 0` ⇒ 确认 R2-1/R2-2 的退出码断言变红（依赖：T062）
- [x] T064 [P3] [P] 变异 M5：把 `classifyChangeSet` 的 `ok` 位默认改为 `true` ⇒ 确认 R2-4 变红（依赖：T062）

### canonical SKILL 更新 + repo:sync 再生

- [x] T065 [P3] **[D5 合并]** `plugins/spec-driver/skills/spec-driver-feature/SKILL.md` 三处调用点（4b 前置权威判定、goal_loop 步骤 2 advisory、步骤 3b 权威判定）统一补：
  - `RC==3` → MUST NOT 发起 impact / 注入影响面；把 `DECISION.error`/`DECISION.hint` 原样并入上下文注入块 / iteration log
  - **MUST NOT 记 `DECISION.degradedReason` / `DECISION.fallbackHint`**（abort 封闭键集里没有，记了就是一行 `undefined`）——**注意 `SKILL.md:456` 现状恰恰记这两个字段，必须改掉**
  - **`RC==3` 的轮次不计入刷新预算消耗**（abort 发生在矩阵求值前、没有发生刷新），下一轮仍可传 `--refresh-policy allowed`——须改写 `SKILL.md:450-451` 的散文预算记账
  - **恢复口径（二选一，均须留痕）**：(a) 显式传 `--base-ref <可达 ref>` 重跑；(b) 显式重记 `phase_start_ref` 并在 trace / iteration log 记一条"原锚点 `<old>` 不可达，已重记为 `<new>`，此前变更不在本次影响面证据内"
  - 保留并澄清红线：禁止的是**自行、静默**把 `phase_start_ref` 重记为当前 HEAD；(b) 的显式 + 留痕重记是允许的（差别是可审计性，不是动作本身）
  - `RC==2` → 编排层 bug，MUST 停下修调用；`RC==0` → 按既有 outcome 分支处置
  - 措辞红线一节补充"退出码 3 不等于图不可用，而是我们不知道这个 phase 改了什么"
  - **验收**：三处调用点逐处 diff 核对，且 `SKILL.md:450-451` / `:456` 两处旧文案确已改写（依赖：T062）
- [x] T066 [P3] 运行 `npm run repo:sync` 再生 `plugins/spec-driver/skills-codex/**` 与 `.codex/skills/**` 镜像；运行 `npm run repo:check` 复核一致性（依赖：T065）

### P3 阶段验证

- [x] T067 [P3] `npm run test:plugins` + `npx vitest run` + `npm run build` 全量确认零失败（P3 收口）（依赖：T063, T064, T066）
- [x] T068 [P3] P3 checkpoint：独立子代理异构对抗复审（≥2 个不同切入角；须标注「Codex 审查暂停，异构档位缺席」）。**验收（D8）**：复审记录列出切入角 + 具体查证动作，零发现须说明查了什么。处置 critical/warning，若有修复需回跑 T067（依赖：T067）

**Checkpoint**：P3 全绿，进入最终收官验证。

---

## Phase 4: 全量验证收官（Polish & Cross-Cutting）

- [x] T069 [P4] 依次跑齐 plan §10.4 全部命令并确认零失败：`npx vitest run`、`npm run test:plugins`、`npm run build`、`npm run repo:check`（新 `ignore-undeterminable` check 在此可见）、`npm run release:check`；已知环境坑按既有记账处理（rebase 后大面积红先 `rm -rf dist && npm run build`；vitest 全过但 exit 1 属 F235 birpc 已知项；`watch-command`/`batch-orchestrator-incremental`/`community-analysis perf`/`cli-e2e --version` 属预存 flaky，隔离重跑确认不当回归挖）（依赖：T035, T050, T068）
- [x] T070 [P4] 本仓实证复跑（**本地 dist，零信息量护栏**）：`node dist/cli/index.js batch --mode graph-only && node dist/cli/index.js graph-quality --json --graph specs/_meta/graph.json`，确认六指标全 pass，复核 T033 结论在 P2/P3 改动落地后仍成立（依赖：T069）
- [x] T071 [P4] **[D3 (a) 确认向]** `BEHAVIOR_VERSION` 本仓差分实证：用**本 worktree 的 dist**（两侧都用，禁止混用 PATH 上的旧全局产物）在修复前/后各跑一次采集，逐字节对比被采集的文件集合。**验收**：贴出两侧文件集合的 diff 结果（依赖：T070）
- [x] T072 [P4] **[D3 (b) 证伪向，不可省]** `BEHAVIOR_VERSION` **构造反例仓**差分实证：构造并逐个跑覆盖以下形态的 fixture 仓前/后差分——① plan §3.1a 的 errno 形态（至少 EACCES 目录 + 一种非 ENOENT 其他形态）；② 嵌套 git 仓形态（KL-1）；③（有条件时）在盘 symlink 穿越（KL-5）。目的就是**试图制造分歧**；若制造不出，须写明"已尝试的形态清单"而非只报"无分歧"。**处置**：T071/T072 任一出现分歧 ⇒ **必须 bump `BEHAVIOR_VERSION`** 并重新校准 F249/F193/F217 三方判据，**不得为保持不 bump 而弱化实证口径**（缩小 fixture 形态、只跑 T071 均不接受）（依赖：T071）
- [x] T073 [P4] **[D8]** 变异证据汇总核对：确认 `specs/258-fix-graph-truth-source-fidelity/verification/mutation-evidence.md` 中 **M1–M10 共 10 条**逐条齐全，每条含"变红用例完整名称 + 断言失败输出前 5 行"；缺任一条 ⇒ 回补对应变异任务（依赖：T027–T031, T046–T048, T063, T064）
- [x] T074 [P4] 汇总 plan §12「现在不知道」全部 10 项的落定结论，写成一节清单：item1/2（**已由主线程复核测定**，此处只需确认 T032/T033 实测与之一致）、item3（T005/T036 的两遍法实数结论）、item4（T054 的 rev-parse 退出码谱）、item5（T002/T051 通读结论）、item6（缺陷 3 红用例均在 fixture 仓构造，不依赖本仓存量 `.PY`/`.PYI`）、item7（T018 的 `nextSteps` 机读 token 字面值）、item8（T015 的 L2 预算默认值与依据）、item9（T025 的 symlink→dirPrefix 带证据裁决）、item10（T019 的早退分支核对结论）（依赖：T032, T033, T005, T036, T054, T002, T051, T018, T015, T025, T019）
- [x] T075 [P4] 逐条复核 plan §10.3 回归护栏对照表（**本任务只复核既有结论，不新增测试**）：F255 原病不回退（T026 结论）、F217 六指标（T032 fixture 结论 + T070 恒绿护栏）、F193/F249/F254 判据输入不变（结构性核对 `sourceCommit`/`fingerprint`/`formatVersion`/`BEHAVIOR_VERSION` 确无改动，除非 T071/T072 触发 bump；**注意表述已按 D10 改为弱表述——只能说"不新增分歧来源"，不得复述"结构上不可能矛盾"**）、降级路径 fail-loud（M1/M3/M4/M9/M10 五个变异共守，复核 T027/T029/T063/T030/T031 均已过）、非 git 仓/git 不可用/worktree 场景（R1-6 由 T007 覆盖、**worktree 一致性由 T012 的独立任务 R1-10 覆盖**）（依赖：T069, T070, T072, T073）
- [x] T076 [P4] 处置 T003 关于 `current-spec.md` 的确认结论：若登记了待同步清单，同步更新对应 `specs/products/spectra/current-spec.md` / `specs/products/spec-driver/current-spec.md`；若结论是"无需同步"，仅在交付记录中复核确认，不产生代码改动（依赖：T003）
- [x] T077 [P4] 更新 `specs/258-fix-graph-truth-source-fidelity/fix-report.md` 追加「验证结果」节：记录 T069–T076 的全部实测结论（含 fixture 验收的 `ignoredPathNodeIds` 真/假阳性判定、本仓恒绿护栏说明、`BEHAVIOR_VERSION` 双向差分实证结果与处置、变异证据 10 条齐全性、§12 十项落定清单、T025 的 symlink→dirPrefix 裁决）（依赖：T074, T075, T076）

---

## Phase 5: 审查修复轮（三份独立审查后的必修项）

**来源**：Spec 合规审查 ① + 代码质量审查 ② + 异构对抗子代理 ×2 ③，经编排器分流裁决后的必修清单 M-1..M-8。
**审查档位**：Codex 审查暂停（配额耗尽），**异构档位缺席**——commit message 须显式标注。
逐条决策见 `verification/review-round-decisions.md`；变异证据见 `verification/mutation-evidence.md` 的「审查修复轮」段。

- [x] T078 [P5] **[M-1 CRITICAL]** 堵住"打坏 git 就能让门变绿"：`UndeterminableSummary` 增 `degraded`（= `prefetchLookup === null && hasGitDirUpward`，粘性）；两个消费方判据改为 `count > 0 || degraded || budgetExhausted`；新增 `[oracle-degraded]` 子 token，`graph-quality-core.mjs` 据此写结构化 `evidence.degraded` 并报 warn。**先红后修**（三层各一条红用例）；变异 MR-1 / MR-2 / MR-6 各杀一段链路
- [x] T079 [P5] **[M-2]** `budgetExhausted` 与 `count` 解耦：并入 T078 的新判据，budget-only 情形给独立文案；导出 `shouldVoiceUndeterminable` / `describeUndeterminable` 两个纯函数直测三形态 + 优先级（该出口在 E2E 里要真把 L2 预算跑穿，成本过高正是它此前无断言的原因）
- [x] T080 [P5] **[M-3]** L3 只查 `files`、不查 `dirPrefixes`：新增 `createGitIgnoredFileLookup`；KL-3 与"为什么换序是安全的"两处文字改写为与实现一致；双向钉住（M-3 不查前缀 / M-3b 仍查精确条目，保住 P1 差分实证的 EACCES 反例）。变异 MR-3
- [x] T081 [P5] **[M-4]** 兑现 KL-2 的承诺：`computeVerdict` 入口加越界守卫 `isOutsideWalkBase`（绝对路径 / `..` 越界 ⇒ 直接 `undeterminable`，与在盘与否无关）；KL-2 与 L 层表同步更新。**未**走"改写 KL-2 + 新增 KL-7"的备选分支（修法无副作用）。变异 MR-4
- [x] T082 [P5] **[M-5]** 二选一裁决：选 **(a) 改文档保留行为**——`porcelainOk:false ⇒ unknown ⇒ consume-degraded ⇒ 不刷图`是对事实的正确读法，选 (b) 会让残缺变更集冒充完整的（⇒ `additive-only` ⇒ 跳过 impact，不安全方向）。两处 JSDoc 改为如实说明后果，并新增用例把后果钉成机器断言
- [x] T083 [P5] **[M-6]** fingerprint entry 级严格性补齐：entry key 集合精确等值（`extensions` + `matchSemantics`），与顶层同口径、与 TS 侧 `parseSurfaceEntry::keySetEquals` 同口径；新增导出 `FINGERPRINT_ENTRY_KEYS` 与第四处跨语言合同锚。变异 MR-5
- [x] T084 [P5] **[M-7]** 撤 over-claim：`file-scanner.ts` 文件头改为指名两个 oracle 并指向 `gitignore-oracle.ts`；同批收口 `python-adapter.ts`、`source-discovery.ts`（两处）与**额外一处** `collector-fingerprint.ts::BEHAVIOR_VERSION` 的 bump 记录。**验收**：全仓 `grep "以 git 本体为事实源"` 仅剩反面引用
- [x] T085 [P5] **[M-8 + defer 登记]** 制品回填：`tasks.md` 勾选态与本段；`fix-report.md` 追加「验证结果」节（五道门禁数字 + 三份审查结论 + 本轮修复清单 + 已知限制/defer 登记）；`verification/review-round-decisions.md` 新建（P1/P2 对抗复审补记）；`verification/mutation-evidence.md` 追加「审查修复轮」段。同批把 **D-1 的两处 over-claim** 改写为如实表述（`graph-consumption-decision.mjs` 的「C-002 依然成立」、`graph-consumption-cli.mjs` 的「不会反向」）

---

## 缺陷与已知限制覆盖映射

| 缺陷/限制 | 红用例 | 实现任务 | 变异测试 | 已知限制钉桩 | 验证任务 |
|---|---|---|---|---|---|
| 缺陷 1（gitignore 三态） | T007, T008 (R1-1..R1-6) | T013, T014 | T027 (M1), T028 (M2), T029 (M3) | T008, T023 (KL-1/KL-2), T007 (KL-3) | T032, T033, T034, T035 |
| **errno 三分（D1）** | T009 (R1-7) | T013 | T030 (M9) | — | T032, T034 |
| **KL-5 在盘 symlink 穿越（D1）** | T010 (R1-8) | 不修，仅钉桩 | — | T010, T022 | T025（改良带证据裁决） |
| **KL-6 归一化/大小写前提（D9）** | T011 (R1-9) | 不修，仅钉桩 | — | T011, T022 | T034 |
| **L2 预算具名出口（D7）** | T015 内含断言 | T015 | — | — | T034 |
| **诊断出口消费者（D4）** | T039 (R3-3 的 stderr 断言) | T018, T019, T042 | T031 (M10) | — | T069（repo:check 可见） |
| 附带项 6.1（探针基准） | T007 (R1-6) | T014 | — | — | T026, T034 |
| KL-4 / R6（freshness 不敏感 defer） | — | 不修，仅钉桩 | — | T024 | T074 |
| 缺陷 2（base-ref 硬失败） | T052, T053, T054 (R2-1..R2-4) | T056–T061 | T063 (M4), T064 (M5) | — | T062, T067, T068 |
| **abort 处置/预算/恢复口径（D5）** | T055 (R2-5) | T059, T065 | — | §4.5 残余风险（无 `$?` 机械保障） | T067, T069 |
| 缺陷 3（消费侧 matchSemantics） | T038, T039 (R3-1..R3-4) | T040, T041 | T046 (M6), T047 (M7) | — | T044, T045, T049, T050 |
| 附带项 6.2（refresh-deadline-ms） | T038 | T043 | T048 (M8) | — | T049 |
| **文件头零 I/O 契约（D6）** | — | T022 | — | — | T034 |
| [CLEANUP] 前置搬运（两遍法 D8） | — | T006（条件, P1）, T037（条件, P2） | — | — | T005, T036 |
| canonical SKILL 合同 | — | T065, T066 | — | — | T067, T068 |
| **BEHAVIOR_VERSION 可证伪实证（D3）** | — | — | — | — | T071 (a), T072 (b) |
| **worktree 一致性（D8 拆出）** | T012 (R1-10) | — | — | — | T075 |
| §12 现在不知道（10 项） | — | — | — | — | T074（汇总）+ 各分项任务 |

---

## Dependencies & Execution Order

### Phase 依赖

- **Phase 0**：无前置依赖，可立即开始；T004 阻塞一切验证类任务（验证二进制口径）
- **Phase 1 (P1)** / **Phase 2 (P2)**：均依赖 Phase 0 完成，彼此独立，可并行执行
- **Phase 3 (P3)**：硬性依赖 Phase 1 与 Phase 2 均已收口（T035、T050），因 `AUDIT_SCHEMA_VERSION` bump 会碰 P2 改过的审计断言
- **Phase 4（全量验证收官）**：依赖 Phase 1/2/3 全部 checkpoint 完成

### Phase 内部顺序（强制）

- 红用例任务先于对应实现任务，且必须在实现前确认"已看到红且失败原因正确"；**新测试一律是独立任务，不得挂在收官核对清单里**（D8）
- `[CLEANUP]` 两遍法判定任务先于该文件的任何实现任务；判定必须基于 `git diff --stat` 实数
- 实现任务完成后立即重跑对应红用例确认转绿，再进入变异测试
- 变异测试任务必须在功能实现全部转绿之后执行（否则无法区分"变异导致的红"与"未完成实现的红"），且每条必须落证据到 `verification/mutation-evidence.md`
- 阶段验证任务（全量测试命令）先于该 Phase 的对抗复审 checkpoint

### 并行机会

- P1 内：T008–T012 五条红用例可并行（不同文件/不同 fixture）；T027–T031 五个变异可并行调度，但**不得同时叠加多个变异**（各自验证并撤销后再执行下一个）
- P2 内：T046/T047/T048 同上
- P3 内：T063/T064 同上
- P1 与 P2 两个 Phase 之间可并行（不同文件、无依赖）
- Phase 0 的 T002/T003 可并行

### 推荐实施策略

1. Phase 0（跨阶段前置确认，含验证二进制口径固定）
2. Phase 1（P1）与 Phase 2（P2）：有容量则并行，否则按 P1 → P2 顺序（P1 是 fix-report 判定的"主"缺陷，风险与验证成本更高，建议优先）
3. **STOP 并复核**：P1、P2 各自 checkpoint 通过后再开 Phase 3
4. Phase 3（P3）：必须在 P1、P2 都收口后开始
5. Phase 4：全量收官验证 + 双向差分实证 + fix-report 补记

---

## Notes

- 本 fix 无新依赖、无数据库/API 契约（非典型 feature 结构），故省略"Setup"与"Foundational"独立 Phase，改为 Phase 0 的最小前置确认
- 三处对抗复审 checkpoint（T035/T050/T068）均使用独立子代理异构对抗（Codex 配额暂停期），复审记录须显式标注「Codex 审查暂停，异构档位缺席」并列出切入角与具体查证动作，配额恢复后可回补
- 所有变异测试执行后必须撤销变异，不得把变异代码带入最终 diff；但**证据必须落盘**（撤销后 diff 里什么都不剩，不落盘就等于没跑过）
- `[CLEANUP]` 两处（T006、T037）均为条件触发，判定必须基于 `git diff --stat` 实数而非"预计"；不触发则跳过，不为凑规则重构
- KL-1..KL-6 是已知限制，任务表里对应的是"登记 + 用测试钉住实际行为"而非修复——**不要在 P1 阶段试图修 KL-1/KL-2/KL-3/KL-5/KL-6**，plan 已裁决不做；唯一的例外是 T025 对 KL-5 的候选改良，且它要求**带证据裁决**而非直接实现
- 本仓实跑（T033/T070）**恒绿且零信息量**（本仓 0 离盘 filePart），缺陷 1 的真正验收在 T032 的可控 fixture；不得把本仓全绿当作缺陷 1 修好了的证据
- 残余风险（plan §4.5 第 5 条 / §7）：全仓 SKILL 无 `$?` 检查 ⇒ exit 3 可见性依赖散文被遵守；忘记 bump `BEHAVIOR_VERSION` 无运行时守护；`nextSteps` 是文本前缀契约 ⇒ 改文案即断链。三者本 fix 不解决，只登记
