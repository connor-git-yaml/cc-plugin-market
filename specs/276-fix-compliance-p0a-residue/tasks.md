# 任务清单 — F276 卡 C `saveBlockState().ok===false` fail-open 收口

> 模式：fix（精简任务清单）。唯一设计源：`plan.md`（§4/§5/§6/§7/§9）。范围来源：`fix-report.md`
> §「🔴 范围裁决 2 · 拆三卡」。提交顺序硬性 **C1 → C2 → C3**（plan §4 R4-10）。

## 约定

- 每个 Phase 内先「写红测试」→「实现转绿」→「变异实验/收尾」→「异构对抗审查」。
- 测试任务逐条引用 plan §5 编号（U-x / E-x / P-x），不重新命名。
- `[P]` 标记可并行任务（不同文件、无依赖）。
- fixture 备料：
  `/private/tmp/claude-501/-Users-connorlu-Desktop--workspace2-nosync-cc-plugin-market--claude-worktrees-atomic-write-defects-fix-5606c8/9857a8d2-0df1-4998-8f94-8ee3c64035ff/scratchpad/real-stop-hook-feedback-entries.sanitized.jsonl`
  （3 条：命中 1 / `tool_result` 型 user 1 / assistant 1）；第 4 条（真实 skill 展开条目）需从本仓
  `plugins/spec-driver/tests/fixtures/fix-compliance/` 既有 fixture 中取真实展开条目脱敏后加入（R6-4）。
  🔴 **第 4 条的骨架必须取「非 `spec-driver-*` 的真实 skill 展开」**（R7-4，如 `/skills/defuddle`）——
  ⚠️ **主编排器已备料的那一条用的是 `spec-driver-fix` 展开，须换掉**：`SKILL_EXPANSION_REGEX` 只匹配
  `spec-driver-([a-z]+)`，含 `spec-driver-fix` 会推走 `latestFixLineIndex`（窗口自塌 ⟹ **假绿**）、
  含其他 mode 会改 `anchor.mode`（⟹ **假红**）；非 `spec-driver-*` 的展开两个基线都不动，是唯一可写形态。
  该条是**「真实骨架 + 注入正文」**（R7-9）：骨架来自真实录制，正文的 token 与 `Stop hook feedback:` 串
  是人工注入的对抗构造，**重录时不得当噪声删掉**（须写进 README 保留清单，见 T025）。

---

## Phase C1 · core 计数器 + token 常量 + io errno（无任何 errno 谓词）

### 写红测试

- [x] **T001** [P] 在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 写红测试 **U-1 / U-2 / U-3 / U-7**：
  - U-1：真实形状（`type:'user'`、`isMeta:true`、`userType:'external'`、字符串 content）计数正确；`lineIndex <= baseline` 不计
  - U-2：反例集（assistant 侧含 token→0；两文本块→0；首行非前缀但含 token→0；`[FIX-COMPLIANCE] ` 普通阻断反馈无 token→0）
  - U-3：token 不被 `PREFIX_BLOCK/WARN/DEGRADED` 三条渲染文本误匹配（`includes` 均假）；并断言 `startsWith` 条件承重性（构造首块以 `Base directory for this skill:` 起头、正文含 token 的 user 条目 ⟹ 计 0）；注释记录 R6-6 形态稳定性一手实证（324 份 / 44174 行 / 六个 harness 版本 `2.1.219→2.1.247`，29/29 一致）与 R6-14 触发面附记
  - U-7：基线缺席（`null`/`undefined`/非数字）三种入参，即便 10 条命中条目，一律返回 `0`；注释记录与 P-2 的分工（U-7 管非数字，P-2 管数字基线含 -1）
  - 完成判据：`node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs` 中新增用例全部**失败**（函数尚未实现）
  - 依赖：无

- [x] **T002** [P] 在 `plugins/spec-driver/tests/fix-compliance-io.test.mjs` 写红测试 **U-4**：
  两级皆败 → `ok:false` 且 `errors` 两项、每项含 `path`/`stage`/`code`；按主线程实跑值断言（目录占位 ⟹
  `stage:'write'`+`code:'EISDIR'`；文件占位 ⟹ `stage:'mkdir'`+`code:'EEXIST'`；`SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP`
  指向文件 ⟹ `stage:'mkdir'`+`code:'ENOTDIR'`）；两级任一成功 → 返回对象**不含** `errors` 键。
  🔴 **`path` 必须断言等于 `err.path`**（R7-7）：`stage:'mkdir'` 那一项的 `path` 指向
  **父目录位置的挡路物**（`dirname(状态文件路径)`），`stage:'write'` 那一项才指向状态文件路径本身；
  两者取值不同正是本条的守护点（取错即让 stderr 指向错误对象，诱导删掉 `.specify/runs`）
  - 完成判据：`node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs` 中新增用例全部失败
  - 依赖：无

### 实现转绿

- [x] **T003** 在 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 新增导出
  `HOOK_FEEDBACK_PREFIX`、`STORAGE_UNAVAILABLE_FEEDBACK_TOKEN`、
  `countStorageUnavailableBlockFeedback(entries, latestFixLineIndex)`（单趟 O(entries)、零正则；
  基线非数字 ⟹ 返回 0，不得照抄 `-1` 全量计数）。**不新增任何 errno 集合常量或谓词**（R4-2 已撤回）。
  - 完成判据：T001 全部用例转绿
  - 依赖：T001

- [x] **T004** 在 `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` 的 `saveBlockState` 内两处
  try/catch 收集 `{path: err.path, stage, code}`（`stage:'mkdir'|'write'`，`err.code` 非串取 `null`），
  两级皆败附加 `errors:[...]`。🔴 **`path` 一律取 `err.path`，不得取传进来的状态文件路径**（R7-7）：
  mkdir 建的是 `dirname(filePath)`，此时挡路的是父目录位置的那个文件，Node 在 mkdir / write 两处
  均填 `err.path`，直接透传。🔴 **`tryWriteState` 签名不变**；成功分支返回对象逐字不变（D7）。
  - 完成判据：T002 全部用例转绿
  - 依赖：T002

- [x] **T005** C1 退出判据核对：`node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs
  plugins/spec-driver/tests/fix-compliance-io.test.mjs` 全绿；`git diff` 中 `fix-compliance-judge.mjs`
  **零改动**；`npm run test:plugins` 全绿（端到端矩阵与 HEAD 逐字相同）
  - 依赖：T003, T004

- [x] **T006** C1 异构对抗审查：派发 2 个独立子代理，切入角分别为「误伤面（正常存储路径是否被 core/io
  改动波及）」与「绕过面（计数器/errors 收集是否引入新的 0 成本路径）」；commit message 标注
  「Codex 审查暂停，异构档位缺席」；循环至零新 CRITICAL
  - 依赖：T005

---

## Phase C2 · judge 方向反转 + 上界 + stderr + schema（依赖 C1）

### 写红测试（端到端，`fix-compliance-judge-cli.test.mjs`，`runCli` 真进程）

- [x] **T007** [P] 写红测试 **E-a**（主验收）：两级不可写 ⟹ 第 1/2 次 Stop exit 2，stderr 首行同时含
  token 起头与「这不是制品问题，模型无法修复」；含两级路径+`stage`+errno（仅断言存在非空，不钉具体值）；
  🔴 **路径行断言含 `@ ` 段**（R7-7）：两级路径行各含 `'@ '` 后跟一个非空路径，证明渲染的是
  `err.path` 而非传进去的状态文件路径；
  含 ①②③ 三条补救口——
  **②** 断言文件名段 `spec-driver.config.yaml` / `.specify/` 回落路径，**且**嵌套段
  🔴 **改用正则**（R7-6）`/fix_compliance:\s*\n\s{2,}enforcement:\s*(warn|off)/`
  （同时钉「两行」与「第二行有缩进」；**不接受**点号式 `fix_compliance.enforcement` 字符串，
  也**不接受**分别 `includes('fix_compliance:')` 与 `includes('enforcement: warn')`——
  那对"无缩进两行 ⟹ YAML 解析成 `fix_compliance: null` + 顶层 `enforcement`"这一失效形态零守护力）；
  **③** 断言 `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP` 与「须重启」；
  **①** 断言至少一条 code 对应处置，且含「勿删 `.specify/runs`」字样（R6-3 / R7-7）；
  每次阻断后按真实形状追加 `type:'user'` 反馈条目；第 3 次
  exit 0 + 终态记录 + 审计事件含 `storage-unavailable-block-budget-exhausted`
  - 依赖：无

- [x] **T008** [P] 写红测试 **E-b**（伪造反例）：同一 token 写进 assistant text 条目 ×3 ⟹ 不计数，第 3
  次仍 exit 2
  - 依赖：无

- [x] **T009** [P] 写红测试 **E-b′**（M-4 专用守护点）：`type:'user'` 单文本块、首块以
  `Base directory for this skill:` 起头、正文含 token ⟹ 不计数 ⟹ 第 3 次 Stop 仍 exit 2（`role`
  无法先行排除，`startsWith` 是唯一守护点）。
  🔴 **诱饵必须是「非 `spec-driver-*` 的真实 skill 展开」**（R7-4，如 `/skills/defuddle`）：
  `SKILL_EXPANSION_REGEX` 只匹配 `spec-driver-([a-z]+)`——诱饵含 `spec-driver-fix` 会推走
  `latestFixLineIndex` ⟹ 窗口自塌、计数恒 0 ⟹ **删掉 `startsWith` 条件也照绿（假绿，M-4 失守）**；
  含其他 mode 会改 `anchor.mode` ⟹ 走非 fix 路径 ⟹ **假红**。非 `spec-driver-*` 的展开
  `earliest`/`latest` 两个基线均不动，是**唯一可写形态**（与 T021 P-2 ④ 用同一形态）
  - 依赖：无

- [x] **T010** [P] 写红测试 **E-c**（承重对照组）：存储可用时退出码序列 `2,2,0`、stderr 前缀、审计
  `diagnostics` 集合、终态记录条数与改动前**同窗口 A/B 实跑**逐字相同；追加断言三次 stderr 全文均不含 token
  - 依赖：无

- [x] **T011** [P] 写红测试 **E-e**（单级失败）：只占位主路径、tmpdir 可写 ⟹ 走 tmpdir，退出码/审计/
  终态与存储可用完全相同；同样断言 stderr 全文不含 token
  - 依赖：无

- [x] **T012** [P] 写红测试 **E-g**（schema 双向守卫，照 `:2918` 写法）：`storage-unavailable-block-budget-exhausted`
  enum 已登记 ∧ judge 源码含该字面量；**反向**断言 enum **不含** `storage-unavailable-environmental-release`
  - 依赖：无

- [x] **T013** [P] 写红测试 **E-i**（基线锚，守 M-6）：fix 展开之前注入 2 条历史反馈条目 ⟹ 首次 Stop
  仍 exit 2
  - 依赖：无

- [x] **T014** [P] 写红测试 **E-j**（审计/终态与状态同生共死）：`chmod 0o500 .specify/runs` + tmpdir 占位
  ⟹ 退出码序列 `2,2,0` 成立且终态记录条数=0、审计条数=0；带 root skip 守卫（照
  `ledger-writer.test.mjs:251` 写法）+ `finally` 里 `chmod 0o755` 复原
  - 依赖：无

- [x] **T015** [P] 写红测试 **E-m**（窗口基线换向回归钉）：存储坏 ⟹ 2 次 exit 2 ⟹ 第 3 次放行 ⟹ 修好
  存储 + 合规裁决 reset ⟹ 重新展开一次 `/spec-driver-fix` ⟹ 再弄坏 ⟹ 断言重展开后第 1 次 Stop 仍
  exit 2（守 M-11）
  - 依赖：无

- [x] **T016** [P] 写红测试 **E-n**（误伤面：不可写但合规）：两级不可写 + 会话制品齐全合规 ⟹ exit 0、
  stderr 为空、stderr 全文不含 token；带 root skip 守卫（同 T014）
  - 依赖：无

- [x] **T017** 写红测试 **E-o**（投喂面守卫，R6-5/R6-11 重写，非「源码级合同」）：
  (a) 注册集核对——解析 `plugins/spec-driver/hooks/hooks.json` 取全部 `hooks[].hooks[].command`
  脚本路径集合，逐个断言源码不含 `STORAGE_UNAVAILABLE_FEEDBACK_TOKEN` 字面量（不得用 `hooks/*.sh` glob）；
  (b) 运行时不变量——以 token 命名一个 `specs/` 子目录（含未完成条目的 `tasks.md`），真跑
  `bash plugins/spec-driver/hooks/stop-task-check.sh`，断言 exit 0。
  🔴 **(b) 必须 `cwd` = 临时 fixture 根，且先断言 stderr 含该目录名**（R7-2）：
  `stop-task-check.sh:8` 用**相对 glob** `specs/*/tasks.md`，在仓根或默认 cwd 下跑 token 目录
  **永不被扫到** ⟹ 断言恒绿（与 R6-11 同型的假绿）。写法固定为——fixture 布局
  `<tmp>/specs/<token-name>/tasks.md`，`spawnSync('bash', [<脚本绝对路径>], { cwd: <tmp> })`；
  **先**断言 stderr **含**该目录名（证明确实被扫到），**再**断言 exit 0。
  🔴 **登记边界，不追加防线（R7-3）**：Stop hook 除 exit 2 外还有 **stdout JSON `decision:"block"`
  + exit 0** 一路阻断形态，(b) 只断退出码抓不到；本仓 Stop hook 当前**未用**该形态，
  故只登记为已知边界，不加 stdout 解析（将来仓内出现 JSON 决策型 Stop hook 时须回来补断言面）
  - 依赖：无

- [x] **T018** 写红测试 **E-p**（errno 白名单撤回回归钉，取代已删 E-l）：断言
  `fix-compliance-judge.mjs`/`fix-compliance-core.mjs`/`fix-compliance-io.mjs` 三文件源码**先剔除注释行**
  （`//` 起头行/`/* … */` 块内行/`*` 起头 JSDoc 续行）后不出现 `ENOSPC`/`EDQUOT`/`EROFS` 任一字面量
  - 依赖：无

- [x] **T019** 改写既有合同钉 `judge-cli.test:463`（「state-storage-unavailable → 降级放行」）：改为
  「首次 exit 2 + token stderr」，保留其审计断言；目录占位实跑得 `stage:'write'`+`EISDIR`，断言里不新增
  任何 errno 值判定
  - 依赖：无

- [x] **T020** 改写既有合同钉 `judge-cli.test:2277`（「存储不可用 → 不推迟」）：保留「未推迟就不得发在途
  诊断码」承重断言，把 `stderr.startsWith('[FIX-COMPLIANCE][GATE-DEGRADED] ')` 改为 token 首行 +
  `status===2`
  - 依赖：无

- [x] **T021** [P] 在 `plugins/spec-driver/tests/f270-real-corpus.test.mjs` 写红测试 **P-2**（CI 恒执行
  形态守卫）：4 条入库 fixture（① 命中项 ② `tool_result` 型 user ③ assistant 含同串 ④ 真实 skill
  展开条目含 token+`Stop hook feedback:`）；断言 `countStorageUnavailableBlockFeedback(entries, -1)`
  命中 1 / 排除 3；调用写死显式基线 `-1`（不得传 `null`）。
  🔴 **④ 的骨架必须取「非 `spec-driver-*` 的真实 skill 展开」**（R7-4，如 `/skills/defuddle`，
  与 T009 E-b′ 同形态）：含 `spec-driver-fix` 会推走 `latestFixLineIndex` ⟹ 假绿，含其他 mode
  会改 `anchor.mode` ⟹ 假红；④ 是 `startsWith` 条件在本探针下的**唯一**守护点（①②③ 都被前置条件
  先行排除），骨架选错即整条 P-2 对该条件零守护力
  - 依赖：无

- [x] **T022** [P] 在同文件写红测试 **P-3**（脱敏完整性连带守卫，照 `f270-real-corpus.test.mjs:112-118`
  既有写法）：断言 fixture 不残留真实用户名/真实 session_id/`/Users/` 绝对路径；与 P-2 保留清单相容
  （`[<cmd>]: ` 段结构保留、路径值替换）
  - 依赖：无

- [x] **T023**（实为 **no-op**，见下）删除 **P-1**（本机语料扫描用例，R6-6）：从 `f270-real-corpus.test.mjs` 移除原扫
  `~/.claude/projects/**/*.jsonl` 的用例；一手实证（324 份/六个 harness 版本）已在 T001（U-3 注释）
  承接，不随用例消失；「多 hook 同周期是否合并」调研指针移交 `handoff/README.md`
  - ⚠️ **实际执行结果：no-op**——`f270-real-corpus.test.mjs` 里**从来没有**扫 `~/.claude/projects/**/*.jsonl`
    的用例（P-1 从未落地）。一手实证已按计划记进 T001 的 U-3 注释，不随用例消失。
  - 依赖：T001

### fixture / schema 落库

- [x] **T024** 落库 `plugins/spec-driver/tests/fixtures/fix-compliance/real-stop-hook-feedback-entries.jsonl`：
  取 scratch 备料 3 条（命中 1/`tool_result` 型 user 1/assistant 1）+ 从本仓既有 fixture 取真实 skill
  展开条目脱敏加入第 4 条；脱敏替换 `sessionId`/`uuid`/`parentUuid`/`promptId`/`cwd`/绝对路径/用户名/
  `gitBranch`/时间戳；原样保留 `Stop hook feedback:` 前缀、`[<cmd>]: ` 段结构（替换其中路径值）、
  `Base directory for this skill:` 前缀（④）、content 类型、块数、harness `version` 字段。
  🔴 **④ 的骨架须取非 `spec-driver-*` 的真实 skill 展开**（R7-4）——⚠️ **主编排器备料的那一条用的是
  `spec-driver-fix` 展开，落库前须换掉**（含 `spec-driver-fix` ⟹ 推走 `latestFixLineIndex` ⟹ P-2 假绿；
  含其他 mode ⟹ 改 `anchor.mode` ⟹ 假红）。
  🔴 **④ 是「真实骨架 + 注入正文」**（R7-9）：正文里的 token 与 `Stop hook feedback:` 串是**人工注入**
  的对抗构造，不是录制原文；须在 T025 的 README 保留清单里标明，否则下次重录会被当噪声删掉
  - 完成判据：T021/T022 对该 fixture 的断言可运行（尚可能红，待 T027-T030 转绿）
  - 依赖：T021, T022

- [x] **T025** 在 `plugins/spec-driver/tests/fixtures/fix-compliance/README.md` 补 1 行索引（照既有
  「F270 真实录制语料」三列表格式：fixture/采集事件/用途），并注明本 fixture 的保留字段清单
  （逐项标「保留值」或「保留段结构、替换值」）。
  🔴 清单须另标注 **④ 是「真实骨架 + 注入正文」**（R7-9）：envelope 与 `Base directory for this skill:`
  前缀取自真实录制，正文的 token 与 `Stop hook feedback:` 串是**人工注入的对抗构造**，
  **重录时不得当噪声删掉**；并注明骨架取自**非 `spec-driver-*` 的 skill**（R7-4，换成 `spec-driver-*`
  会让 P-2 假绿或假红）
  - 依赖：T024

- [x] **T026** 在 `specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json`
  的 `diagnostics.items.enum` 新增 `storage-unavailable-block-budget-exhausted`（27→28，用 `node -e`
  读 `properties.diagnostics.items.enum.length` 机械核对）；`blockCount` description 补
  「存储不可用阻断分支亦为 null（预算不可知）」
  - 完成判据：T012（E-g）转绿
  - 依赖：无

### 实现转绿

- [x] **T027** 在 `plugins/spec-driver/scripts/fix-compliance-judge.mjs` 的 `evaluate` 中（judge:302 同处）
  新增 `storageUnavailableFeedbackCount = countStorageUnavailableBlockFeedback(entries,
  expansion.latestFixLineIndex)`（🔴 用 `latestFixLineIndex` 不是 `earliestFixLineIndex`）；并入主
  return（judge:574-578）；4 处 `verdict:null` 早退点（`:235`/`:245`/`:290`/`:563`）**一律不加**；
  `assistantEntriesSinceEarliestFix` 既有透传与用法一律不动
  - 依赖：T003, T026

- [x] **T028** `runHook` 把 `storageUnavailableFeedbackCount` 以具名对象第 5 参传给 `routeBlock`（F238
  纪律：无默认值）
  - 依赖：T027

- [x] **T029** `routeBlock` 的 `!saved.ok` 分支改走新私有函数
  `routeStorageUnavailable(…, { feedbackCount, errors, extraDiagnostics })`，双闸门：
  - 闸门 1（唯一上界）：`feedbackCount >= BLOCK_LIMIT` ⟹ `releaseDegraded(...,{storageUnavailable:true})`
    （既有终态形态不改），`extraDiagnostics` push `storage-unavailable-block-budget-exhausted`
  - 闸门 2（否则一律 fail-closed）：`appendAuditEvent`（`blockCount:null`、`degraded:false`、
    `extraDiagnostics` 含 `state-storage-unavailable`，try 包裹）+ stderr + return 2
  - `saved.errors` 的 errno 在此不产生任何分支；`diagnostics` 合并须保留上游
    `[...new Set([...extraDiagnostics, '<本次码>'])]`
  - 依赖：T004, T028

- [x] **T030** stderr 形状实现（照 plan §4 C2 第 4 条的模板逐行落实）：首行 token 起头 +
  「这不是制品问题，模型无法修复」同一行；两级路径行渲染 🔴 **`<stage> <code> @ <err.path>`**（R7-7）；
  补救口按生效即时性排序：
  - **①** 修好路径 + code 对应处置映射（纯渲染零判定）。🔴 **静态映射只保留两条**（R7-1）：
    `EEXIST|ENOTDIR` ⟹ 删除上行 `@` 后**那一个**文件（**并明写「勿删 `.specify/runs` 目录」**，R7-7——
    审计与终态同在该目录下，升格成 `rm -rf` 即毁证据）、`EACCES` ⟹ `chmod u+w` 父目录；
    **其余 code 一律「请向用户报告该错误码」**。🔴 **模板严禁出现 `ENOSPC` 明文**——它与 T018（E-p）
    的源码守卫**互斥**，写了必红 ⟹ 逼实现期削弱 E-p ⟹ M-8' 失守；`code` 只能是运行时打印的 `err.code`。
    （`EEXIST` / `ENOTDIR` / `EACCES` 可留：E-p 只禁 `ENOSPC` / `EDQUOT` / `EROFS` 三个环境性码。）
  - **②** 文件名 + 嵌套：`spec-driver.config.yaml` / `.specify/` 回落路径，正文渲染
    🔴 **两行字面量**（R7-6）——第一行 `fix_compliance:`，第二行**缩进两空格**的 `enforcement: warn`；
    不得转写成「写入 `fix_compliance:` 段，其下一行 `enforcement: warn`」（丢缩进 ⟹ 模型写出无缩进两行
    ⟹ YAML 解析成 `fix_compliance: null` + 顶层 `enforcement` ⟹ 回到 `undefined ⟹ block` 且零诊断）。
    🔴 **措辞取「用户动作」式**（R7-5）：「**由用户决定是否**降级门禁：…写入下面两行」，
    不写成对模型的操作指令——⚠️ 这只降低诱导性、**不构成防线**（配置面 1 次往返已登记 plan §8 ⑫、移交卡 B）。
  - **③** `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP=<dir> claude` + 「须重启」；`buildFeedbackText` 放最后
  - 完成判据：T007（E-a）转绿
  - 依赖：T029

- [x] **T031** C2 收尾：变异清单 10 条逐条实跑并**记录实际变红的用例名**（不接受"应该会红"推演）：

  | 变异 | 必须变红 |
  |---|---|
  | M-1 `!saved.ok` 改回直接 `releaseDegraded` | E-a |
  | M-2 计数器去掉 `role==='user'` 条件 | E-b |
  | M-3 `>= BLOCK_LIMIT` 改 `> BLOCK_LIMIT` | E-a |
  | M-4 删 `startsWith(HOOK_FEEDBACK_PREFIX)` 条件 | E-b′ + P-2④ + U-3（🔴 R7-4：两者诱饵须为**非 `spec-driver-*` 的真实 skill 展开**，否则本行守护点全部失效——`spec-driver-fix` ⟹ 假绿、其他 mode ⟹ 假红） |
  | M-6 计数器去掉 `lineIndex > baseline` | E-i |
  | M-7 stderr 首行去掉 token | E-a |
  | M-8' errno 白名单前置放行分支还原 | E-p（E-a 抓不到（原钉 E-l 已随 R5-13 删除），登记不覆盖变体） |
  | M-10 上界命中后不 push 该诊断码 | E-a（第 3 次审计事件缺该码）；E-g 兜底 |
  | M-11 窗口基线改回 `earliestFixLineIndex` | E-m |
  | M-12 基线缺席 `return 0` 改回 `-1` | U-7 |

  - 依赖：T007-T023, T027-T030

- [x] **T032** C2 退出判据：`npm run test:plugins` 全绿；端到端 E-a/E-b/E-b′/E-c/E-e/E-g/E-h（延后到
  C3，见下）/E-i/E-j/E-m/E-n/E-o/E-p 及 P-2/P-3 全绿
  - 依赖：T031

- [x] **T033**（已执行：两路 0C，产物 `verification/implementation-adversarial-c1c2.md`） C2 异构对抗审查：2 个独立子代理，切入角「误伤面（诚实存储故障用户是否被 brick / 合规用户
  是否渗漏 token）」与「绕过面（errno 分流复活 / 伪造反馈条目 / 窗口基线方向）」；commit 标注
  「Codex 审查暂停，异构档位缺席」；循环至零新 CRITICAL
  - 依赖：T032

---

## Phase C3 · 删死代码（本卡最后一个独立提交）

- [x] **T034** 在 `plugins/spec-driver/scripts/fix-compliance-judge.mjs` 删 `routeNonBlock`
  （judge:735-823）、`NON_BLOCK_LIMIT`（:82）、`NON_BLOCK_ENTRY_LIMIT`（:100）及其 JSDoc
  - 依赖：T033

- [x] **T035** 删测试：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 中
  `routeNonBlock 单元（零接线期合同）` describe（4 条）+ `delta-2 定时雷：NON_BLOCK_LIMIT ≥ BLOCK_LIMIT`
  （1 条）
  - 依赖：T034

- [x] **T036** 改写 **E-h**（`p3-carry`，`F270 P3 · saveBlockState 带回合同`）：改用
  `saveBlockState(tmp,'p3-carry',{blockCount:0, degradedRecorded:false, inFlightDeferCount:0,
  nonBlockStopCount:1})` 直接造数（新增 io import，删对 `routeNonBlock` 的 import）；用例目的
  （`routeBlock` 整体覆写不得抹平 `nonBlockStopCount`）不变
  - 依赖：T034

- [x] **T037** 删除 `judge-cli.test:3161` 处旧 describe 及其失实注释（「tmpdir 不可注入」已被
  `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP` 自证不成立，随 T019/T020 改写一并消失）
  - ⚠️ **实际执行结果：被 T035 吸收，无独立 diff**——该注释所在的用例
    （`主路径被占位 → tmpdir 二级降级仍计数成功（不误触 storage-unavailable）`）本就位于
    `routeNonBlock 单元（零接线期合同）` describe 内部，随 T035 整块删除一并消失。
  - 依赖：T019, T020

- [x] **T038** 注释指针同步（零行为改动）：`judge.mjs:962` 历史叙述去掉对已删函数的引用；
  `io.mjs:373-375` 与 `normalizeState:311-313` 按 R5-10 改写为「`nonBlockStopCount` 当前只有原样带回方、
  没有递增方；带回逻辑属不可删面；该字段不可单独作为任何放行预算，除非卡 B 同时定义其不可伪造性」；
  schema 的 3 个 `nonblock-*` 码保留不删
  - 依赖：T034

- [x] **T039** C3 退出判据：全仓 `rg -n 'routeNonBlock|NON_BLOCK_LIMIT|NON_BLOCK_ENTRY_LIMIT' plugins/
  scripts/ src/` 零命中（`specs/`与`docs/`历史记录不算）；`npm run test:plugins` 全绿
  - 依赖：T035, T036, T037, T038

- [ ] **T040** C3 异构对抗审查：2 个独立子代理，切入角「误伤面（`nonBlockStopCount` 带回逻辑/
  `p3-carry` 合同是否被误删）」与「绕过面（删死代码是否意外改变 `routeBlock` 行为面）」；commit 标注
  「Codex 审查暂停，异构档位缺席」；循环至零新 CRITICAL
  - 依赖：T039

---

## Phase Final · 不变量核对与全量验证

- [ ] **T041** 不变量核对（逐条勾选，机械可验证）：
  - [ ] 存储可用路径退出码/审计/终态**逐字节不变**（对照 `research/baseline-reproduction.md` B-1/B-3，
    T010 E-c A/B 对拍通过）
  - [ ] io 状态字段集不变，`nonBlockStopCount` 原样带回逻辑不动（T036 E-h 通过）
  - [ ] warn 档不经 `routeBlock`（既有 warn 用例含 `:2264` 仍绿）
  - [ ] `resetBlockState` 不受影响（既有 reset 用例仍绿）
  - [ ] 不引入任何 errno 判定分支（T018 E-p 全绿）
  - [ ] 不消费 `assistantEntriesSinceEarliestFix`/`EARLIEST_FIX_ENTRY_DEFER_LIMIT`（`git diff` 核对
    T027 未改动该逻辑）
  - [ ] 不用 `stop_hook_active`（`rg -n 'stop_hook_active'` 核对本卡改动文件零新增消费点）
  - 依赖：T033, T040

- [ ] **T042** 全量验证（按序执行，任一步失败即停止修复后重跑）：
  1. `npm run test:plugins`（基线 1688/1686 pass/0 fail/2 skip，本卡改动后核对新增用例计数）
  2. `npx vitest run` 零失败
  3. `npm run build` 类型检查零错误
  4. `npm run repo:check` 通过
  5. `npm run release:check` 通过
  - 依赖：T041

- [ ] **T043** `npm run judge:doctor` 只记录生效时点（本机快照 4.4.0 须等发版才生效，不阻断本卡交付；
  按 plan §10 生效时点声明，所有验收已走 worktree 源码直调，不依赖本机 hook 表现）
  - 依赖：T042

---

## FR / 护栏覆盖矩阵

| 项 | 内容 | 落点任务 |
|---|---|---|
| FR-046 第 5 点 | save 失败必须 fail-closed | T029, T030, T007 |
| R-11 护栏 | `!saved.ok` 分支建立总上界（唯一上界＝反馈计数） | T029, T007(E-a), T015(E-m) |
| R-12 护栏 | 诊断码闭集 enum ⊆ 产出（双向登记） | T026, T012(E-g) |
| R-6（F208） | Stop hook 不可 brick 会话 | T007(E-a), T016(E-n), T018(E-p) |
| R-7（F211） | `resetBlockState` 清零语义不受影响 | T041 |
| 附带处置 | 删 `routeNonBlock` 死代码 | T034-T039 |
| FR-046 其余 4 点 / FR-012 / FR-026..033 | 锁/幂等/GATE 指纹/PENDING/snapshot-stale | ⛔ **移交卡 A / 卡 B**（不在本卡任务范围） |
| 既有相邻向量（预置状态文件 0 往返） | R5-2 | ⛔ **移交卡 B**（T038 注释登记，不修复） |

**说明**：本卡（fix 模式）无 User Story 划分，全部任务按 plan §4 的 C1→C2→C3 单一时序执行；
FR 覆盖以 plan §2 矩阵为准，未认领项全部显式移交，不在本清单产出新任务。
