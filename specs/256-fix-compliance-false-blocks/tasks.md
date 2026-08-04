# Tasks: fix 依从性判定器两处误报盲区修复

**输入**：`specs/256-fix-compliance-false-blocks/fix-report.md`（5-Why 根因，定稿）、
`specs/256-fix-compliance-false-blocks/plan.md`（方案 A 设计已定稿到函数签名与代码级，任务分解不改设计）
**模式**：fix（无 spec.md / 无 User Story；交付单元按 plan.md 的两处正交盲区拆分：
**BLK1（盲区 1，磁盘侧重锚定）** 与 **BLK2（盲区 2，在途第三态）**，硬约束 BLK1 先于 BLK2 交付验证）

## 设计疑点

无。plan.md §1/§9 已明确排除方案 B 及全部"类似模式"放宽项，任务分解未发现需要主编排器裁决的设计缺陷。

---

## Phase 1: Setup

无需新增基础设施——三个目标文件（`fix-compliance-core.mjs`/`fix-compliance-io.mjs`/`fix-compliance-judge.mjs`）
均已存在且结构齐备（plan.md §2 Codebase Reality Check 已确认），三个测试文件已存在待追加用例。跳过本阶段。

---

## Phase 2: Foundational

无阻塞性前置依赖——BLK1、BLK2 分别落在 `fix-compliance-io.mjs`（新文件级导出）与
`fix-compliance-core.mjs`（新文件级导出）的不同分组，互不依赖对方产出。跳过本阶段。

---

## Phase 3: BLK1 — 盲区 1 磁盘侧重锚定（优先交付，隔离性最强）

**目标**：特性目录因复合命令重编号（如 `cd ... && git mv specs/251-fix-foo specs/254-fix-foo && ...`）
后，判定器不再对已从磁盘消失的旧路径误报"未建立特性目录"，而是按 short-name 在 `specs/` 下重新
锚定到磁盘上真实存在、制品齐全的同名目录。

**独立验证方式**：`node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs` +
`plugins/spec-driver/tests/fix-compliance-core.test.mjs`（仅 `extractFixShortName` 相关用例）+
`fix-compliance-judge-cli.test.mjs` 中的盲区 1 端到端用例三者独立可绿，不依赖 BLK2 任何改动。

### 测试先行（BLK1）

- [x] T001 [P] [BLK1] 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 新增
  `extractFixShortName` 用例组：
  - 阳性：`extractFixShortName('specs/256-fix-compliance-false-blocks')` 返回
    `'compliance-false-blocks'`；含末尾斜杠形态同样正确提取
  - 阴性：非法输入返回 `null` —— 缺 `fix-` 段（`'specs/256-other-thing'`）、含大写
    （`'specs/256-Fix-Foo'`）、纯数字目录名（`'specs/256'`）、非字符串（`null`/`undefined`/`123`）、
    不以 `specs/` 开头的路径
  文件改动：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`
  验收判据：新增 `describe`/`it` 块运行时因 `extractFixShortName` 尚未导出而失败（红），
  记录失败输出作为"先失败"证据
  依赖：无

- [x] T002 [P] [BLK1] 在 `plugins/spec-driver/tests/fix-compliance-io.test.mjs` 新增
  `listFeatureDirCandidatesByShortName` 用例组：
  - 命中单个候选、命中多个候选且按编号升序返回（用于判据"取编号最大者"的前置排序正确性）
  - `specs/` 目录不存在时返回 `[]`（非抛出）
  - 子串误配边界（回归钉子）：`shortName='x'` 不误配 `999-fix-decoy-x`（后缀比对应正确切分
    `-fix-x` 前缀数字段）、不误配 `1-fix-xx`（后缀字面量不匹配 `-fix-x`）
  - 非法 `shortName`（空字符串/非字符串）返回 `[]`
  文件改动：`plugins/spec-driver/tests/fix-compliance-io.test.mjs`
  验收判据：新增用例因函数未导出而失败（红）
  依赖：无

### 实现（BLK1）

- [x] T003 [BLK1] 在 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 新增导出函数
  `extractFixShortName(dirPath)`，紧邻 `FIX_DIR_NAME_REGEX` 常量定义之后，实现与 JSDoc
  完全按 plan.md §4.1 代码块落地（正则 `^specs\/\d+-fix-([a-z0-9-]+)\/?$`，非法输入返回 `null`，
  零 I/O 纯函数）
  文件改动：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`
  验收判据：T001 新增用例转绿；`node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs`
  零失败
  依赖：T001（先失败用例存在）

- [x] T004 [BLK1] 在 `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` 新增导出函数
  `listFeatureDirCandidatesByShortName(projectRoot, shortName)`，按 plan.md §4.2 代码块落地
  （`fs.readdirSync` 一层枚举 + `endsWith` 字面量后缀比对 + 数字前缀校验 + 按编号升序排序，
  `specs/` 不可读时 `catch` 返回 `[]`）
  文件改动：`plugins/spec-driver/scripts/lib/fix-compliance-io.mjs`
  验收判据：T002 新增用例转绿；`node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs`
  零失败
  依赖：T002（先失败用例存在）

- [x] T005 [BLK1] 在 `plugins/spec-driver/scripts/fix-compliance-judge.mjs` 的 `evaluate()` 中，
  紧接既有 F227 候选历史兜底循环之后，串接 plan.md §4.3 代码块：仅当
  `candidate.ambiguous === false && !usable(resolvedPath)` 且历史兜底仍未命中、且
  `candidate.path !== null` 时，取 `extractFixShortName(candidate.path)`，调用
  `listFeatureDirCandidatesByShortName` 枚举磁盘同名目录并按 `usable` 过滤，命中则取编号最大者
  赋给 `resolvedPath`；需 `import { extractFixShortName } from './lib/fix-compliance-core.mjs'` 与
  `import { listFeatureDirCandidatesByShortName } from './lib/fix-compliance-io.mjs'`（若尚未导入）
  文件改动：`plugins/spec-driver/scripts/fix-compliance-judge.mjs`
  验收判据：
  1. 手工核对新增代码块整体嵌套在既有 `if (candidate.ambiguous === false ...)` 内，未改动该
     `if` 判断条件本身、未改动循环体
  2. `node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 中既有全部用例
     （F208/216/224/227/230/231/240 各 `runCli` 用例）零回归
  依赖：T003, T004

### 端到端复现测试（BLK1）

- [x] T006 [BLK1] 在 `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 新增盲区 1
  端到端复现用例：构造 transcript，其中委派/提名序列使 `resolveFeatureDirCandidate` 落定
  `specs/251-fix-foo`（改名跟随判据不认复合命令 `cd ... && git mv specs/251-fix-foo
  specs/254-fix-foo && ...`，候选停留旧路径——用真实复合命令文本构造，不用光杆 `mv`），
  在测试临时 fixture 根目录下仅创建磁盘目录 `specs/254-fix-foo/fix-report.md`（制品齐全）
  文件改动：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`
  验收判据：
  1. `runCli()` 返回 exit code `0`
  2. 断言未产生阻断类审计事件（`.specify/runs/*.jsonl` 中无 `PREFIX_BLOCK` 对应 verdict 或
     阻断计数状态文件未创建/未递增）
  3. 该用例在 T005 完成前跑必须先失败（exit 非 0 或缺目录报错），完成后转绿——在任务执行时
     实际跑一次红一次绿留痕
  依赖：T005

- [x] T007 [BLK1] 若本机存在 fix-report.md 引用的真实 F254 transcript
  （`~/.claude/projects/-Users-...-serene-taussig-2c33c3/f3f2fe3b-5458-4dbe-8dab-cb9fb6e3966a.jsonl`），
  在 `fix-compliance-judge-cli.test.mjs` 中沿用既有 `F227_REAL_TRANSCRIPT` 的
  `t.existsSync` + `t.skip` 先例新增一条实证用例：用 `--mode report` 对该 transcript 的三个
  盲区 1 签名 stop 时间戳（03:03:46 / 03:05:02 / 03:07:22，fix-report.md「检测判据」表）做截断
  回放，断言经 BLK1 兜底后不再复现 `missing: ["feature-dir","fix-report.md"]`
  文件改动：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`
  验收判据：本机若文件不存在则用例经 `t.skip` 跳过（不计入失败）；若存在则三条截断回放均不再
  命中签名 A 的 `missing` 组合
  依赖：T005（可选任务，若本机无该文件则标记为跳过并如实说明，不阻塞 BLK1 交付）

**BLK1 Checkpoint**：`node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs`
`plugins/spec-driver/tests/fix-compliance-io.test.mjs`
`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 三者零失败，且 T006 的红→绿留痕
已记录，方可进入 BLK2。

---

## Phase 4: BLK2 — 盲区 2 在途第三态（后于 BLK1 交付，风险相对更高）

**目标**：verify/review 子代理经 `SendMessage` 恢复后台执行、尚未回收 `<task-notification>`
完成信号时，Stop hook 不再把该次 stop 判定为"零 verify 委派的烂尾"，而是识别为"判定时机未到"，
推迟裁决（exit 0 + warn 级诊断 + 不消耗阻断预算），待下次 stop 证据齐备后重新裁决。

**独立验证方式**：`node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs`（仅
`extractInFlightDelegationsAfter` 相关用例）+ `fix-compliance-judge-cli.test.mjs` 中的盲区 2
端到端用例，且 BLK1 已交付基础上叠加，不需回退 BLK1 改动。

### 测试先行（BLK2）

- [x] T008 [P] [BLK2] 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 新增
  `extractInFlightDelegationsAfter` 用例组（plan.md §5.1/§8.1 逐条落地）：
  - **规则 1 阳性**：`entries` 数组以 `assistant` 角色、锚点之后、含裸 `Agent`/`Task`
    tool_use（非 `run_in_background`）**收尾**且无同条目配对 `tool_result` → 命中 `kind:'sync'`
  - **规则 1 阴性（安全边界回归钉子，必须存在）**：同样构造未配对的 `Agent`/`Task` tool_use，
    但其后追加任意一条后续 `entries` 条目（哪怕是空白 assistant 文本）→ **不得**命中——
    这条钉子守护 plan.md §5.1 的收窄边界，防止未来放宽为"扫描任意位置的未配对调用"重开
    F231 已实测证伪的大规模 fail-open
  - 规则 2 阳性/阴性：`run_in_background:true` 的委派，分别构造"有匹配 `<tool-use-id>` 完成通知"
    与"无匹配通知"两种，断言仅后者命中 `kind:'background'`
  - 规则 3 阳性/阴性：`SendMessage(to:A)` 派发晚于/早于 A 的 `<task-id>` 通知，断言仅前者命中
    `kind:'send-message'`；gaming 边界钉子——`SendMessage` 派发缺少非错误 `tool_result` 回执
    （无回执 或 `isError:true`）时**不得**计入 `lastDispatchByAgent`，即不命中在途
  - 性能/无回溯用例：构造大量噪声 `<task-notification>` 文本块，断言函数为线性时间（遵循仓库
    既有 F227/F231 perf 回归锚点惯例，如断言 O(N) 量级耗时上界而非精确常数）
  文件改动：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`
  验收判据：新增用例因函数未导出而全部先失败（红）
  依赖：无（可与 T001/T002 并行，不与 BLK1 实现任务冲突文件）

### 实现（BLK2）

- [x] T009 [BLK2] 在 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 新增：
  常量 `SEND_MESSAGE_TOOL_NAME`、`TASK_NOTIFICATION_PAIR_REGEX`；内部函数
  `findTrailingUnresolvedSyncDelegation`、`findPendingBackgroundDelegations`、
  `findPendingSendMessageResumptions`；导出函数 `extractInFlightDelegationsAfter(entries,
  anchorLineIndex)`。全部按 plan.md §5.3 代码块逐字落地（含 JSDoc 中的安全边界说明），放置于
  紧接 `extractDelegationsAfter` 之后、独立分节标题"在途委派判定（F256 盲区 2）"
  文件改动：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`
  验收判据：T008 新增用例全部转绿；`node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs`
  零失败；人工核对 `findTrailingUnresolvedSyncDelegation` 仅检查 `entries` 最后一条条目
  （未扫描任意位置），与安全边界回归钉子（T008 规则 1 阴性）逐字一致
  依赖：T008

- [x] T010 [BLK2] 在 `plugins/spec-driver/scripts/fix-compliance-judge.mjs` 的 `evaluate()`
  末尾，复用已解析的 `entries`/`anchor.anchorLineIndex` 调用
  `extractInFlightDelegationsAfter`，返回对象新增 `inFlightDelegations` 字段（plan.md §5.4
  第一段代码块）；需在文件顶部 import 中加入
  `extractInFlightDelegationsAfter`（来自 `./lib/fix-compliance-core.mjs`）
  文件改动：`plugins/spec-driver/scripts/fix-compliance-judge.mjs`
  验收判据：`node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 中既有
  用例零回归（新字段为纯加法，不改变既有断言字段）
  依赖：T009

- [x] T011 [BLK2] 在 `plugins/spec-driver/scripts/fix-compliance-judge.mjs` 的 `runHook()` 中，
  在 `result.verdict.compliant` 早退分支**之后**、`result.enforcement === 'warn'` 分支**之前**
  插入 plan.md §5.4 第二段代码块：`result.inFlightDelegations` 非空时，落审计事件（附诊断码
  `delegation-in-flight`）、stderr 写 `PREFIX_WARN` 级反馈文本、`return 0`，且**不**调用
  `routeBlock`、**不**递增阻断计数状态
  文件改动：`plugins/spec-driver/scripts/fix-compliance-judge.mjs`
  验收判据：
  1. 人工核对插入点确实在 `compliant` 早退分支之后、`warn` 分支之前（对 `block`/`warn` 两档
     一视同仁生效，逐字对照 plan.md §5.4 顺序）
  2. `node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 中既有 block/warn
     两档全部用例零回归（因既有 fixture 均不含在途信号，`result.inFlightDelegations` 恒为空
     数组，新分支不介入）
  依赖：T010

- [x] T012 [BLK2] 在 `plugins/spec-driver/scripts/fix-compliance-judge.mjs` 的 `runReport()`
  输出 JSON 中追加 `inFlightDelegations: result.inFlightDelegations || []` 字段（plan.md §5.4
  末段）
  文件改动：`plugins/spec-driver/scripts/fix-compliance-judge.mjs`
  验收判据：`--mode report` 端到端用例（T014）能读到该字段
  依赖：T010

### 端到端复现测试（BLK2）

- [x] T013 [BLK2] 在 `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 新增盲区 2
  端到端复现用例：构造 transcript——`Agent` 委派获得含 `agentId` 的 `tool_result`
  → 后续 `SendMessage(to: agentId)` 获得非错误 `tool_result` ack → 之后**无**任何
  `<task-notification>` 完成信号 → 使既有判据本应判"零 verify 委派"不合规
  文件改动：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`
  验收判据：
  1. `runCli()` 返回 exit code `0`
  2. stderr 输出含 `[FIX-COMPLIANCE][WARN]` 前缀与诊断文案 `delegation-in-flight`
  3. 审计事件（`.specify/runs/*.jsonl`）新增一条 `diagnostics` 含 `delegation-in-flight` 的记录
  4. 阻断计数状态文件未被创建/未递增（阻断预算未消耗）——需与"未插入本分支时同一 fixture
     会 exit 2 且递增阻断计数"的对照跑一次，证明确实是本分支生效而非其他分支恰好放行
  依赖：T011

- [x] T014 [BLK2] 若本机存在 fix-report.md 引用的真实 F254 transcript（同 T007 路径），在
  `fix-compliance-judge-cli.test.mjs` 中沿用 `t.existsSync` + `t.skip` 先例新增实证用例：用
  `--mode report` 对签名 B 的三个 stop 时间戳（16:32:26 / 16:33:41 / 16:48:49，各自在途数
  1/1/2）做截断回放，断言每处 `inFlightDelegations.length` 与 fix-report.md「检测判据」表格
  逐行一致，且不再复现 `missing` 含 `verification-report.md`/`delegation:verify` 的阻断判定
  文件改动：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`
  验收判据：本机若文件不存在则 `t.skip` 跳过；若存在则三处截断回放的在途数与表格逐行一致
  依赖：T011（可选任务，若本机无该文件则标记为跳过并如实说明，不阻塞 BLK2 交付）

**BLK2 Checkpoint**：`node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs`
`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 全绿，T013 的对照跑（本分支介入
前 exit 2、介入后 exit 0）留痕已记录。

---

## Phase 5: 合同同步（跨 BLK1/BLK2，须在两处均落地后统一执行）

- [x] T015 在 `specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json`
  的 `diagnostics.items.enum` 数组中，在现有末项 `"dialect:codex-rollout"` 之后追加一项
  `"delegation-in-flight"`
  文件改动：`specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json`
  验收判据：JSON 合法（`node -e "JSON.parse(require('fs').readFileSync('...','utf8'))"` 不报错）；
  枚举数组仅新增一项，其余项逐字不变
  依赖：T011（诊断码需已在代码中实际产出后再登记合同，避免合同先于实现漂移）

- [x] T016 在 `specs/208-fix-mode-process-compliance/contracts/fix-compliance-judge-cli.md` 的
  退出码场景表追加一行（plan.md §6.2 表格行：在途委派场景，退出码 0，stdout 空，
  stderr `[FIX-COMPLIANCE][WARN] {反馈文本 + 诊断: delegation-in-flight}`），并在"特性目录"
  相关说明处追加 F256 脚注（盲区 1 不产生独立退出码分支，是既有"合规收口"行的前置解析扩展，
  按 plan.md §6.2 脚注原文落地）
  文件改动：`specs/208-fix-mode-process-compliance/contracts/fix-compliance-judge-cli.md`
  验收判据：新增表格行格式与既有表格列对齐；脚注内容与 plan.md §6.2 引用文字一致
  依赖：T005, T011

- [x] T017 [P] 在 `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 既有"合同同步：
  方言诊断码从 FOREIGN_DIALECT_DIAGNOSTICS 派生..."用例旁，追加一条独立合同同步守卫断言：
  读取 `fix-compliance-verdict-event.schema.json`，断言 `diagnostics.items.enum` 数组
  `.includes('delegation-in-flight')` 为真
  文件改动：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`
  验收判据：该用例在 T015 完成前跑失败（红），T015 完成后转绿；不改动既有
  `FOREIGN_DIALECT_DIAGNOSTICS` 遍历逻辑本身
  依赖：T015

**合同同步 Checkpoint**：T017 断言绿，schema 与判定器实际产出的诊断码字面量一致。

---

## Phase 6: Polish & 全量门禁（提交前必跑）

- [x] T018 跑单元测试门禁三件套，逐一确认零失败：
  ```bash
  node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs
  node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs
  node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs
  ```
  验收判据：三条命令均以 `# fail 0` / 对应零失败摘要收尾
  依赖：T006, T007, T013, T014, T017（全部实现+测试任务完成后）

- [x] T019 跑仓库级全量验证四件套，逐一确认零失败/零错误：
  ```bash
  npx vitest run
  npm run build
  npm run repo:check
  ```
  验收判据：三条命令均以退出码 0 收尾；`repo:check` 无 CRITICAL/ERROR 级输出
  依赖：T018

- [ ] T020 Codex 对抗审查（按 CLAUDE.local.md 约定，implement 阶段提交前必跑）：通过
  `codex:codex-rescue` 子代理对本次全部改动做对抗性审查，重点复核 plan.md §5.1 规则 1
  收窄边界是否真的零回归、§5.5 SendMessage gaming 边界是否有遗漏的逃逸构造；对 critical/warning
  发现逐条判断是否需修复，真实缺陷须修复后重跑 T018/T019
  验收判据：审查结论（critical/warning/info 计数）已记录，critical 项全部处理完毕
  依赖：T019

- [x] T021 若本次判定确认改动落地（非仅设计文档变更），按 SemVer patch 级更新
  `contracts/release-contract.yaml`，跑 `npm run release:sync` 后确认 `npm run release:check`
  零失败
  文件改动：`contracts/release-contract.yaml`（及 `release:sync` 生成的受控文件）
  验收判据：`npm run release:check` 退出码 0
  依赖：T020

---

## FR 覆盖映射表

本 Feature 无 spec.md / 无编号 FR（fix 模式，判定链路归属既有 FR-004/FR-006/FR-007，
fix-report.md「Spec 影响」一节已明确"不新增 FR，两处均为既有判定链路的误报收窄"）。改按
fix-report.md 两处根因 → 任务映射：

| 根因签名 | 对应任务 |
|---------|---------|
| 盲区 1（签名 A：重编号后按旧路径误报 feature-dir + fix-report.md 缺失） | T001–T007 |
| 盲区 2（签名 B：在途委派被判零 verify 委派烂尾） | T008–T014 |
| 合同同步（schema enum + judge-cli.md 场景表） | T015–T017 |
| 全量门禁 + 对抗审查 + 版本同步 | T018–T021 |

---

## 依赖与并行说明

### Phase 依赖关系

- Phase 3（BLK1）与 Phase 4（BLK2）互不阻塞，理论上可并行开工（改动文件除 `fix-compliance-core.mjs`
  的新增分节外基本不重叠）；但**运行时上下文硬约束**要求 BLK1 先于 BLK2 完成独立验证与交付，
  以便任一环节出问题时可独立回退（plan.md §3 执行层面加注）——因此建议顺序执行 Phase 3 → Phase 4，
  不建议并行分工
- Phase 5（合同同步）依赖 T005（BLK1 实现）与 T011（BLK2 实现）均完成
- Phase 6（全量门禁）依赖前述全部 Phase 完成

### Story 内部并行机会

- T001（core 测试）与 T002（io 测试）文件不同，可并行
- T001/T002 与 T008（core 测试，同文件不同 `describe` 块）建议顺序追加避免同文件编辑冲突，
  但逻辑上无依赖关系
- T015（schema）与 T017（合同同步守卫测试）需顺序（T017 依赖 T015 已落地枚举值）；
  T016（judge-cli.md 场景表）与 T015/T017 文件不同，可并行

### 推荐实现策略

**顺序交付（非并行团队）**：Phase 3（BLK1）完整交付并跑通 Checkpoint → Phase 4（BLK2）完整交付
并跑通 Checkpoint → Phase 5（合同同步）→ Phase 6（全量门禁 + Codex 审查 + 版本同步）。
此顺序直接对应运行时上下文的硬约束（盲区 1 隔离性最强，须先行；盲区 2 涉及新判定路径 + 运行时
路由变更，风险相对更高，须在盲区 1 独立验证通过后再叠加），也是 plan.md §3 执行层面加注的
原始建议。
