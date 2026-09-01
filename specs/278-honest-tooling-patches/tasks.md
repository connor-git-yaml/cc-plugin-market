> 任务分解字段格式统一，中文正文 + 英文技术术语。**本文件是 plan.md 六个设计裁决的执行清单，不重新设计**——每条任务的"做什么"字段直接引用 plan.md 对应小节，implement 阶段禁止偏离 plan 已定稿的文案 / 数据结构 / 分叉表另行发挥。

# Tasks: F278 诚实工具面四小补

**输入**: `specs/278-honest-tooling-patches/plan.md`（主输入）、`specs/278-honest-tooling-patches/spec.md`、`specs/278-honest-tooling-patches/code-context.md`
**分支**: `feature/278-honest-tooling-patches`

---

## 执行纪律（全局，每条任务默认继承）

- 禁 `git stash`、禁 `git checkout <其他分支>`；`git add` 只用显式路径；`specs/src.spec.md` 一律排除在任何 `git add` 之外
- **不写入** plan.md「明确不写入」清单里的任何文件，尤其 **`plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs`**（FR-013 / Out of Scope 硬边界，F276 撞文件风险区）
- 项④实现中若发现必须改 `judge-snapshot-core.mjs` → **立即停止**，把该子项标 **BLOCKED**，回报编排器由用户裁决（SC-006 BLOCKED 条款），**不得**擅自扩大范围
- T004 若实跑判红 → **立即停止**，回报编排器，按 D2.2 分叉表处置；**不得**用 `--init` 或 bump `BEHAVIOR_VERSION` 让它变绿；不得把不等字段加进签名函数忽略列表
- 红先行任务的验收标准逐字是：「实跑该用例并**观察到 FAIL**；若跑出来是绿的，说明用例没测到目标行为，必须先修用例再进实现任务」——不允许用"预期会 fail"代替实跑
- 预存 flaky 清单（满载跑批判红时先隔离重跑再判归属，不当作本卡回归）：`watch-command`、`batch-orchestrator-incremental`、`community-analysis` perf、`cli-e2e --version`
- 本 worktree 的 `.spectra/graph.json` 已 stale（`honesty.freshness.state=stale`），MCP `impact`/`context` 返回的空集不等于零调用方，涉及 caller/consumer 核对时须回退 Grep 复核
- 四项改动互不相交（① `src/mcp/agent-context-tools.ts`；②③ 同落 `scripts/regen-collector-fingerprint-fixtures.ts` 但不同函数/路径，需串行避免同文件并发编辑冲突；④ `plugins/spec-driver/scripts/judge-snapshot-doctor.mjs`），任务顺序按 plan 的强制分阶段 P0→P1→P2→P3→P4→P5 执行，**P0 是所有阶段的硬前置**

---

## 任务清单

### Phase 0：前置清理裁决 + 环境校验

- [x] **T001** [CLEANUP] 确认前置清理裁决无需执行文件拆分
  - **文件**: 无代码改动（决策已在 plan.md「前置清理规则判定」节定稿）
  - **服务**: 支撑 FR-005/FR-006（为②的实现范围定基调）
  - **依赖**: 无
  - **做什么**: 复核 plan.md 的清理裁决——`scripts/regen-collector-fingerprint-fixtures.ts`（728 LOC，本卡新增 ~75 行）触发"前置清理"规则，但 plan 已否决"拆到 `scripts/lib/`"与"内联进 `compareGraphOnlyStructure`"两个方案，裁定"新增 `compareNodeMetadataKeys`/`metadataKeySignature` 两个 module-private 顶层函数，不 export、不拆文件"。implement 阶段（T011）必须原样采纳这个裁决，不得自行改成拆文件方案。
  - **验收**: 无可执行命令；以"T011 的实现是否落在同一文件、新增函数不 export"作为本任务裁决是否被遵守的判定点（在 T011 验收里复核）

- [x] **T002** 分支与环境基线校验
  - **文件**: 无代码改动
  - **服务**: 支撑全部 FR/SC（执行前置条件）
  - **依赖**: 无
  - **做什么**: `git status` 确认工作区干净、当前分支为 `feature/278-honest-tooling-patches`；若晚于 master 有新提交，按仓库约定 `git rebase master`；确认 `node_modules` 可用（`npm ci` 或已装）
  - **验收**: `git status --short` 输出为空 或 仅含预期未跟踪的 scratchpad 文件；`git log -1 --format=%H` 有效

---

### Phase P0：基线采样与实跑前置确认（不改任何实现代码）

- [x] **T003** 复核 judge:doctor 改动前基线仍然有效
  - **文件**: 读取编排器已采样文件 `<scratchpad>/judge-doctor-before.txt`（不新建，不移动，仅核对）
  - **服务**: FR-012 / SC-004
  - **依赖**: T002
  - **做什么**: 编排器已在代码改动前采过基线（`<scratchpad>/judge-doctor-before.txt`，sha256 `8b622782c81da9c5a4a175563a339c5f819c058e292778dedaeb90b6ee47068f`，内容 `status: drift / 4 mismatch / 2 match / 4 missingInSnapshot`）。本任务**不重新采样**，只在同机同 cwd 下重新跑一次 `node plugins/spec-driver/scripts/judge-snapshot-doctor.mjs`，用 sha256 比对是否与已存基线一致；若不等，记录环境差异原因（如插件安装态变化）并停下回报，不得覆盖既有基线文件继续往下走
  - **验收（已按实测更正，原判据被证伪）**: 同时刻 A/B —— `git show HEAD:<doctor 路径> > <同目录临时 .mjs>` 后两侧各跑一次，stdout 与 stderr 均逐字节相等。
    ⚠️ **原 sha256 常量判据（`8b622782…`）已被证伪**：doctor 报告含本机绝对路径与安装态（plan D4.5 自己写明"基线必须同环境采"），会话中途 `.specify/.spec-driver-path` 由 `4.4.0` 变为 `4.5.0`，`status` 随之从 `drift` 变为 `in-sync`，该常量就此不可复现——钉死一个绝对值快照与 D4.5 的约定直接冲突。
    编排器已实测 5 组入参（无参 / `--project-root <空目录>` / `--project-root` 缺值 / 未知参数 `--bogus` / `--project-root --bogus`）全部 stdout+stderr 双 BYTE_IDENTICAL 且退出码一致；详见 `verification/orchestrator-verification.md` §5 与附录 A。

- [x] **T004** [P] 活性证明：新 metadata-key 档位对当前 pinned 基线实跑判一致（D2.1/D2.2）
  - **文件**: `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`（临时探针用例，或 `npx tsx` 直跑一段脚本，不要求最终保留在文件里）
  - **服务**: FR-009 / SC-002（US2 的硬性活性证明，非可选）
  - **依赖**: T002
  - **做什么**: 严格按 D2.1——复用护栏测试已有的 `rebuiltGraph`（真实 `buildAstGraphOnly` 产物）与 `pinnedGraphOnly.graph`（typed loader 解包的 pinned 资产），对二者逐 node id 比较 metadata key 签名（本步骤**不依赖新比较器实现**，可写成测试内本地比较逻辑），打印所有不等项，预期输出为空。若实跑判红，按 D2.2 分叉表处置：仅 `<absent>` vs `[]` 一对不等 → 判定"签名函数写反"记录待 T011 修正；涉及 F271 已入库字段（`lineRange`/`signature`）缺失 → **真漂移**，立即停下回报编排器，本项标 BLOCKED，**MUST NOT** 跑 `--init`；pinned 资产独有字段缺失 → **资产陈旧**，同样停下回报，不得擅自 `--init`；差异不可复现 → 连跑 3 次记录为非确定性缺陷并停下回报
  - **验收**: 实跑并记录输出为空数组（活性证明通过）；若非空，必须在任务执行记录里写清落入 D2.2 哪一档、以及"已停下回报"，不得继续往下改代码求绿
  - **执行实况（如实标注，勿读成"有入库证据"）**: D2.1 要求的"不依赖新比较器的**独立**测量"由 implement 子代理用**临时探针**执行，实测输出 `重建节点数=22 pinned 节点数=22 参与求值的 node id 数=22 差异数=0`，连跑 3 次一致（排除非确定性）。**该探针跑完即删除、未入库**——因此本条的证据形态是执行记录而非可复跑的入库制品，读者不应据此认为仓库里存在一份"独立测量"的测试或脚本。仓库里长期可复跑的活性证明是 T013 的那一条（扰动注入组"未注入扰动时 a/b 双轨均判一致"），但它走的是新比较器本身，不构成 D2.1 意义上的独立测量。

- [x] **T005** [P] 实跑确认 git 探针（`rev-parse`/`cat-file`）exit code 与 flag 可用性
  - **文件**: 无产物文件（终端实跑记录），结论写入 T020 实现代码的注释
  - **服务**: FR-014 / FR-015 / SC-004
  - **依赖**: T002
  - **做什么**: 按 D4.2/D4.3 补齐 plan 标了 `[待 implement 实跑确认]` 的具体形态：(1) `git -C <repo> rev-parse --verify --quiet <sha>:<不存在路径>` 对"路径不存在"的确切 exit code（预期 1）；(2) `--quiet` 是否真的抑制 stderr；(3) `git -C <repo> rev-parse --verify --quiet --end-of-options <ref>^{commit}` 在本机 git 版本上 `--end-of-options` 是否可用（若不可用，记录退化方案：在 ref 前加 `--`）；(4) `git -C <projectRoot>` 在 `projectRoot` 为 git 仓库子目录时的行为
  - **验收**: 四项观测结果均有明确记录（exit code 数值 / stderr 是否为空 / flag 可用与否），且在 T020 实现里以注释形式落地引用这次实测结果，不得在代码里写"假设 exit 1"这类未经验证的推测

- [x] **T006** P0 → P1 阶段闸门确认
  - **文件**: 无代码改动
  - **服务**: 支撑全部后续 FR（HIGH 风险强制分阶段的独立验证点）
  - **依赖**: T003, T004, T005
  - **做什么**: 确认 T003（基线仍有效）、T004（活性证明通过，未落入 D2.2 任一停下分支）、T005（探针形态已记录）三项全部完成且**无一项处于 BLOCKED/停下回报状态**，方可进入 P1 开始任何代码改动。若 T004 或 T005 未通过，本任务判定为 FAIL，禁止继续执行 T007 及之后任务
  - **验收**: T003/T004/T005 三项均无 BLOCKED 标记；三者结论均已记录在案

---

### Phase P1：项① impact/context 的 symbol-not-found hint 分流

- [x] **T007** 红先行：① `symbol-not-found` hint 分流用例
  - **文件**: `tests/unit/mcp/agent-context-tools.test.ts`
  - **服务**: FR-001 / FR-002 / FR-003 / SC-001
  - **依赖**: T006
  - **做什么**: 严格按 D6 项①红先行表新增 4 条用例，复用文件既有 `setMockGraph()` mock 图（含 module 节点 `fixture/engine.py`、`fixture/nn.py`）：① `handleImpact({target:'fixture/engine.py::zzzBrandNewSymbol'})` 断言 `e.code==='symbol-not-found'` ∧ `e.hint` 含 `'新增或新导出的符号'` ∧ `fuzzyMatches` 为数组；② `handleContext` 同参数同断言，且其 hint 与①逐字相等；③ `handleImpact({target:'fixture/ghost.py::whatever'})` 断言 `e.hint==='请检查 symbol id 格式或参考 fuzzyMatches 候选'`（对照组）；④ `handleContext` 对应对照组断言 `'请检查 id 格式或参考 fuzzyMatches 候选'`。符号名固定用 `zzzBrandNewSymbol`；若意外被 `resolveSymbolFuzzy` auto-resolve（`e.code!=='symbol-not-found'`），换一个编辑距离更远的名字并在用例旁注释说明（R-7）
  - **验收**: 实跑 `npx vitest run tests/unit/mcp/agent-context-tools.test.ts`，新增 4 条用例中用例①②必须 **FAIL**（因为当前 hint 仍是原文案），用例③④必须已经 PASS（对照组，改前即成立）；若①②跑出来是绿的，先检查是不是符号名被 auto-resolve，修正后重跑确认真的红

- [x] **T008** 实现：① `symbolNotFoundHint` helper + 两处调用点接入
  - **文件**: `src/mcp/agent-context-tools.ts`
  - **服务**: FR-001 / FR-002 / FR-003 / FR-004
  - **依赖**: T007
  - **做什么**: 按 D5 逐字实现——新增 module-private 常量 `SYMBOL_NOT_FOUND_STALE_GRAPH_HINT`（D5.5 定稿文案，逐字抄，不得自由发挥）与 module-private 函数 `symbolNotFoundHint(graphData, requestedId, fallbackHint)`（D5.4 签名与实现，用 `findNode(graphData, moduleFileFromId(requestedId)) !== null` 判定，两者均已由文件顶部 import，不新增 import 来源），放在 `loadGraphOrError` 之后。impact（原 `:221-226`）与 context（原 `:372-377`）两处 `symbol-not-found` 分支的 hint 实参改为调用该 helper，`fallbackHint` 分别传各自原文案（impact 传 `'请检查 symbol id 格式或参考 fuzzyMatches 候选'`，context 传 `'请检查 id 格式或参考 fuzzyMatches 候选'`）。**MUST NOT** 改动 `error.code`、`fuzzyMatches` 结构、`resolveSymbolFuzzy`/`canonicalizeSymbolId` 行为、`fuzzy-resolved` 分支、`:385` 防御性分支（FR-003/FR-004）；**MUST NOT** 碰 `src/mcp/file-nav-tools.ts` 任何行（Out of Scope）
  - **验收**: 代码 diff 仅限 `src/mcp/agent-context-tools.ts` 新增 1 常量 + 1 helper + 2 处调用点实参替换；未新增/修改 import 来源

- [x] **T009** 验证：① 红先行用例转绿 + FR-003/FR-004 负向核对
  - **文件**: 无新增文件（跑测试 + 目视 diff 核对）
  - **服务**: FR-001 / FR-002 / FR-003 / FR-004 / SC-001
  - **依赖**: T008
  - **做什么**: 重跑 T007 的 4 条用例确认全部转绿；额外用 `git diff src/mcp/file-nav-tools.ts` 确认零改动（FR-004）；用 `git diff src/mcp/agent-context-tools.ts` 逐行核对 `error.code`/`fuzzyMatches` 相关代码未被触碰（FR-003）
  - **验收**: `npx vitest run tests/unit/mcp/agent-context-tools.test.ts` 全部 PASS；`git diff --stat src/mcp/file-nav-tools.ts` 输出为空

---

### Phase P2：项② `compareGraphOnlyStructure` 新增 metadata-key 比较档位

- [x] **T010** 红先行 + 变异测试：② metadata-key 差异检测（M1/M2/M3）
  - **文件**: `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`
  - **服务**: FR-005 / FR-006 / FR-007 / FR-010 / SC-002
  - **依赖**: T006, T009（串行于同文件改动组，避免与 P3 并发编辑冲突；不依赖 T009 的逻辑结果，仅顺序占位）
  - **做什么**: 严格按 D6 项②红先行表，在既有"扰动注入组 ①" describe 内新增 3 条变异用例：M1（`deepClone(rebuiltGraph)`，找第一个 `metadata.lineRange !== undefined` 的节点 `delete node.metadata.lineRange`，断言 `mismatch===true` ∧ differences 同时含 `'metadata key 集合不一致'`、该节点 id、`'lineRange'`）；M2（`deepClone` 后给第一个节点 `metadata.__mutantKey=1`，断言 differences 含 `'__mutantKey'`）；M3（`deepClone` 后 `delete node.metadata` 整字段删除制造 `undefined`，断言 differences 含 `'metadata 缺席态不一致'` 且含 `'<absent>'`）
  - **验收**: 实跑 `npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`，M1/M2/M3 三条用例必须 **FAIL**（当前比较器对 metadata 完全失明）；若某条意外为绿，说明变异未生效或断言未测到目标行为，须先修用例

- [x] **T011** 实现：② `compareNodeMetadataKeys` + `metadataKeySignature`
  - **文件**: `scripts/regen-collector-fingerprint-fixtures.ts`
  - **服务**: FR-005 / FR-006 / FR-007 / FR-008 / FR-011
  - **依赖**: T010, T001（遵循 T001 的清理裁决：不拆文件、不 export）
  - **做什么**: 按 D1 逐字实现。`metadataKeySignature(node)`（D1.1 代码块逐字抄，含运行时收窄注释）三档签名：`<absent>` / `<non-object:*>` / key 数组 JSON。`compareNodeMetadataKeys(rebuilt, pinned): string[]` module-private、不 export，按 D1.2 判定流程：只对两侧 node id 计数相等且都 >0 的 id 求值；单节点分支（两侧该 id 各恰好 1 个）算 `missing`/`extra` 用 D1.3 第一/二条文案；缺席态不同（任一侧签名以 `<` 开头且不等）用 D1.3 第二条文案；通用 multiset 分支（任一侧 ≥2 个节点）用 D1.3 第三条文案，逐签名报计数差异不试图配对。三条差异文案逐字照抄 D1.3。`compareGraphOnlyStructure` 只增 2 行（调用 `compareNodeMetadataKeys` + 把返回值 push 进既有 `differences` 数组），既有两个维度（节点 id multiset / 边 multiset）**一行不改**（FR-008）。**MUST NOT** 触碰 `src/panoramic/graph/collector-fingerprint.ts` 的 `BEHAVIOR_VERSION`（FR-011）；边侧 metadata **不纳入**（D1.4，登记 R-3，不在本任务范围）
  - **验收**: `git diff scripts/regen-collector-fingerprint-fixtures.ts` 显示新增两个顶层函数 + `compareGraphOnlyStructure` 内恰好 +2 行；`git diff src/panoramic/graph/collector-fingerprint.ts` 输出为空；T010 三条用例全部转绿

- [x] **T012** 验证：② 既有 5 条扰动用例判定不回退
  - **文件**: `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`（只读跑测，不改动既有 5 条用例一个字符）
  - **服务**: FR-010 / SC-002
  - **依赖**: T011
  - **做什么**: 按 D6 要求，跑全量护栏测试并逐条核对判定结果与改动前相同：删边→红 / 改 id→红 / 重复节点→红 / 乱序→绿 / 重复边→红。特别关注"乱序判一致"这条——新维度按 id 分组天然顺序无关，若实现误用下标配对会把它误判红，这条用例是探针
  - **验收**: `npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 全部 PASS；"乱序" 用例判定仍为一致（绿）

- [x] **T013** 复核：② 活性证明对新比较器实现重跑（D2.1 复核）
  - **文件**: `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`（或等效实跑脚本）
  - **服务**: FR-009 / SC-002
  - **依赖**: T011, T012
  - **做什么**: T004 是"不依赖新比较器实现"的独立测量（活性证明第一次）；本任务是用 T011 落地的**真实** `compareNodeMetadataKeys`/`compareGraphOnlyStructure` 对当前 pinned 基线（`tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json`）重新产出图后跑比较，验证判定一致（D2.1 提到"T013 在实现之后复核"）。若判红，同样走 D2.2 分叉表处置，**不得** `--init` 或 bump 版本号求绿
  - **验收**: 实跑输出 `mismatch === false`（对当前 pinned 基线判一致）；判红则本任务判 FAIL 并停下回报，不得继续

- [x] **T014** P2 → P3 阶段闸门确认
  - **文件**: 无代码改动
  - **服务**: 支撑 FR-018~021
  - **依赖**: T011, T012, T013
  - **做什么**: 确认 P2 三项验证（T012 既有用例不回退、T013 活性证明复核通过）均为绿，且未出现 R-4 描述的"当前 pinned 基线判红"情形，方可进入 P3。P2/P3 落在同一文件（`scripts/regen-collector-fingerprint-fixtures.ts`），必须串行，本任务是串行边界的显式确认点
  - **验收**: T012/T013 均 PASS，无 BLOCKED 标记

---

### Phase P3：项③ `--init` 冷启动再生审计留痕

- [x] **T015** 红先行：③ 审计记录写出 + C-002 拒绝路径不写
  - **文件**: `tests/integration/collector-fingerprint-regen-script.test.ts`
  - **服务**: FR-018 / FR-019 / FR-020 / SC-003
  - **依赖**: T014
  - **做什么**: 按 D6 项③红先行表，在既有 `--init 冷启动路径` describe 内新增 2 条用例。A1：临时副本删掉两份 pinned 资产后跑 `--init`，断言 `regen-audit.jsonl` 存在；最后一行 `JSON.parse` 后 `trigger==='--init'`、`timestamp` 可被 `Date.parse` 解析且在运行时间窗内、`fixtureInputHash` 为 64 hex 且与落盘资产的 `fixtureInputHash` 相等、`assets` 含两个资产文件名。A2：**先在临时副本里预置**一份 `regen-audit.jsonl`（写一行占位记录）并记录行数，再跑触发 C-002 拒绝的 `--init`（资产已存在），断言退出码非 0 且该文件行数与运行前相同（避免"文件不存在→断言不存在"这种恒真空断言，见 D6 A2 构造要点）
  - **验收**: 实跑 `npx vitest run tests/integration/collector-fingerprint-regen-script.test.ts`，A1/A2 两条用例必须 **FAIL**（当前完全不写审计文件，A1 断言文件存在会失败；A2 因文件本就不存在导致"行数相同"断言在未预置时无意义，须按预置构造后确认为红）

- [x] **T016** 实现：③ `appendRegenAudit` + `--init` 成功路径接入
  - **文件**: `scripts/regen-collector-fingerprint-fixtures.ts`
  - **服务**: FR-018 / FR-019 / FR-020 / FR-021
  - **依赖**: T015
  - **做什么**: 按 D3 逐字实现。落点 `tests/fixtures/collector-fingerprint-guardrail/regen-audit.jsonl`（fixture **根目录**，与 README.md 同级，**MUST NOT** 落 `<fixtureRoot>/src/`，D3 已核实 `computeFixtureInputHash` 只扫 `src/` 子目录）。格式 append-only JSONL，字段按 D3.3 定稿：`timestamp`（`new Date().toISOString()`）、`trigger`（固定字面量 `'--init'`）、`fixtureInputHash`（本次落盘用的 `currentInputHash`）、`behaviorVersion`（`currentFingerprint.behaviorVersion`）、`assets`（两个资产文件名数组）。写入时机**必须**在 `swapPinnedAssets` 成功之后（越过其"提交点"注释所定义的不可回滚边界）。写盘失败按 D3.6：`console.warn('[regen] warning: ...')` 后**仍 exit 0**，**MUST NOT** 触发回滚或让整体退出码非零；审计写失败不参与任何放行/拒绝判定。C-002 守卫拒绝路径（两份资产任一存在）**MUST NOT** 走到本函数（FR-020）。常规（非 `--init`）再生路径**不改动**（FR-021）
  - **验收**: `git diff scripts/regen-collector-fingerprint-fixtures.ts` 显示新增 1 个写审计函数 + `runRegen` 的 `--init` 成功路径新增 1 次调用；T015 两条用例转绿

- [x] **T017** 收尾：③ README 禁止事项条目 + 复核 + repo:check 影响面确认
  - **文件**: `tests/fixtures/collector-fingerprint-guardrail/README.md`（人工撰写，一次性说明性改动）
  - **服务**: FR-019 / SC-003 / R-5
  - **依赖**: T016
  - **做什么**: 在「禁止事项」节人工新增一条：`regen-audit.jsonl` 由再生脚本维护，禁止手工编辑/删除历史条目。本卡**不预先创建**该文件、**不**手工造"历史补记"条目（D3.5，那等于伪造未发生的再生）。补充实跑确认 R-5：`npm run repo:check` 对新增 fixture 文件的影响面
  - **验收**: `npx vitest run tests/integration/collector-fingerprint-regen-script.test.ts` 全部 PASS；`npm run repo:check` 通过（若失败需记录具体报错，判断是否与本项相关）

---

### Phase P4：项④ `judge:doctor --since <ref>` 增量漂移视图

- [x] **T018** 红先行：④ `--since` 五场景 CLI 用例
  - **文件**: `plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs`
  - **服务**: FR-012 / FR-013 / FR-014 / FR-015 / FR-016 / SC-004
  - **依赖**: T006
  - **做什么**: 按 D6 项④红先行表新增 helper（临时目录 `git init` + 两个前后内容不同的 commit）与 5 条用例。S1：非 git 目录 + `--since HEAD~1`，断言 `status===1` ∧ stderr 含 `'git 仓库'` 字样（区分于"未知参数"误判）∧ `stdout===''`。S2：合法 git 仓 + 不存在的 ref，断言 `status===1` ∧ stderr 含 `'无效的 git ref'` ∧ `stdout===''`。S3：合法 git 仓 + 首个 commit 为基线，某文件在两 commit 间被改过、snapshot 与当前 repo 一致，断言 `status===0` ∧ stdout 含 `'增量视图'` ∧ 含 `[resolved]`/`[introduced]`（按构造）。S4：某文件在首个 commit 下不存在，断言 `status===0` ∧ 该文件行含 `'该 ref 下不存在'`。S5：不带 `--since`（对照组），断言 stdout 与既有断言完全一致 ∧ `assertNoRemediation(stdout)` 通过。新增用例 **MUST** 从 `../scripts/lib/judge-snapshot-core.mjs` import `JUDGE_FILE_SET`，不得再抄一份硬编码数组（R-1；既有硬编码副本不动）
  - **验收**: 实跑 `npm run test:plugins`，S1~S4 必须 **FAIL**（`--since` 当前是未知参数，行为与断言不符）；S5 必须已经 PASS（对照组）

- [x] **T019** 修正 plan.md D4.6 样例区块与 D4.1 矩阵的矛盾
  - **文件**: `specs/278-honest-tooling-patches/plan.md`（仅此一处样例文本）
  - **服务**: FR-015 / SC-004（防止实现照抄错误样例产出错误 delta）
  - **依赖**: T018
  - **做什么**: D4.1 的 6×6 派生矩阵定义 `baseline=missingInRepo(R) × current=mismatch(X) → pre-existing`（自洽：`baseline ≠ match ⇒ pre-existing`），但 D4.6 的样例输出把同一组合印成 `[introduced] scripts/lib/in-flight-verdict.mjs (基线 missingInRepo → 当前 mismatch, 该 ref 下不存在)`。**矩阵是对的，样例写错了**。把 D4.6 样例区块该行的 `[introduced]` 改为 `[pre-existing]`，**只改这一处**，不改矩阵、不改其余样例行、不改 D4 其余任何文字
  - **验收**: `git diff specs/278-honest-tooling-patches/plan.md` 仅显示 D4.6 样例区块单行 `introduced`→`pre-existing` 的替换，无其他行变更
  - **执行实况（本任务被后续返工取代，如实标注）**: 本任务的**意图**（样例必须与派生表自洽）已达成，但**不是**按字面的 `introduced`→`pre-existing` 完成的。返工 C-3 把 `absentAtRef` 从"不进词表的正交标记"改为进入词表的第六值 `added-since`（原做法会把"该 ref 下新增的文件"答成 `pre-existing`，且旁注被汇总行吞掉），D4.1 派生表随之重画。该样例行终版为 `[added-since] scripts/lib/in-flight-verdict.mjs (基线 missingBoth → 当前 missingInSnapshot, 该 ref 下不存在)`（plan.md `:451`），与重画后的派生表一致。因此本条 `git diff` 验收的字面口径已失效，实际改动面大于"单行替换"。

- [x] **T020** 实现：④ git 探针函数（`preflightGitBaseline` + `digestAtRef`）
  - **文件**: `plugins/spec-driver/scripts/judge-snapshot-doctor.mjs`
  - **服务**: FR-014 / FR-015 / FR-017
  - **依赖**: T019, T005（引用 T005 实测的 exit code/flag 结论）
  - **做什么**: 按 D4.2/D4.3 逐字实现。`sha256OfBuffer(buf)`（D4.2 代码块逐字抄，含"MUST NOT 先转 utf-8 字符串"注释）。两步探测：(1) 存在性探针 `git -C <projectRoot> rev-parse --verify --quiet <resolvedSha>:<relPath>`，exit 0→路径存在拿 blob sha1，exit 非 0→`{status:'missing',sha256:null}`；(2) 内容读取 `git -C <projectRoot> cat-file blob <blobSha1>`（`encoding:'buffer'`），exit 0→`{status:'ok',sha256:sha256OfBuffer(stdout)}`，exit 非 0→fatal。`relPath` 用 `path.posix.join`（POSIX 形式，恒用 `/`）。`maxBuffer` 显式设 32MB，`ERR_CHILD_PROCESS_STDIO_MAXBUFFER` 按 fatal 处理。预检阶段（`preflightGitBaseline`）按 D4.3 表判三种 fail-loud 情形：(c) `git` 不可执行/spawn 失败 → stderr `--since 无法执行：git 不可用（<code>）`；(a-1) 当前目录不是 git 仓库 → stderr `--since 无法执行：<projectRoot> 不在 git 仓库内`；(a-2) `<ref>` 无效（用 `--end-of-options` 防注入，若本机不可用按 T005 观测结果退化为 `--`）→ stderr `--since 无法执行：无效的 git ref「<ref>」`；三者均 exit 1 + stdout 完全为空。ref 有效性只在预检判**一次**并解析成 40 位 commit sha，后续 per-file 只用这个 sha（结构性隔离，(a) 与 (b) 不可能落进同一分支）。只用 `node:child_process` + `node:crypto`，零新增依赖（FR-017）
  - **验收**: `git diff plugins/spec-driver/scripts/judge-snapshot-doctor.mjs` 显示新增 `sha256OfBuffer`/`preflightGitBaseline`/`digestAtRef` 三个函数；`grep -c "^import\|require(" plugins/spec-driver/scripts/judge-snapshot-doctor.mjs` 无新增第三方包引用

- [x] **T021** 实现：④ `deriveDelta` + `formatSinceSection` + `--since` CLI 接入
  - **文件**: `plugins/spec-driver/scripts/judge-snapshot-doctor.mjs`
  - **服务**: FR-012 / FR-013 / FR-014 / FR-016 / SC-004 / SC-006
  - **依赖**: T020
  - **做什么**: `parseArgs` 新增 `--since <ref>` 可选参数（缺值时走既有 `{ok:false}` 分支，与 `--project-root` 缺值同构）。`deriveDelta(baselineStatus, currentStatus)` 严格按 D4.1 的 6×6 派生矩阵（T019 修正后的矩阵为准）返回 5 值词表之一（`unchanged`/`introduced`/`resolved`/`pre-existing`/`indeterminate`），**MUST** 复用已导出的 `compareFile`（把 git ref 侧 `DigestResult` 与当前 repo 侧 `DigestResult` 分别传入 `compareFile(digest, snapshotDigest)` 得到两个 status，再按矩阵派生 delta），**MUST NOT** 修改 `judge-snapshot-core.mjs` 一行（FR-013；若发现绕不开，立即停止标 BLOCKED 回报，不擅自扩大范围）。正交标记 `absentAtRef`：当 ref 侧 `status==='missing'` 时置 true，不进词表（D4.1 被否方案说明）。`formatSinceSection(deltaFiles, ref, resolvedSha)` 是**独立函数**，按 D4.6 定稿格式产出（含 `增量视图（相对 <ref> → <resolvedSha 前 12 位>）：` 表头、每行 `[delta]   <path>   (基线 <baselineStatus> → 当前 <currentStatus>[, 该 ref 下不存在])`、`增量汇总: N unchanged / M introduced / ...`；`result.files` 为空时打印诚实说明行而非静默省略）；新增一条单测把 T019 修正的组合（`baseline=missingInRepo` × `current=mismatch`）钉死为 `pre-existing`，防止实现再度照抄错误样例。`main` 里按 D4.5 拼接：`formatReport` 结果**一行不改**，`parsed.since===undefined` 时原样输出，否则在其后拼接 `formatSinceSection` 返回值。exit code 按 D4.4：正常产出（含大量 `introduced`）恒 `exitCode 0`（诊断非门禁，FR-016）；仅预检 fail-loud (a)(c) 与 per-file fatal (d) 走 exit 1。新增文案逐词对照既有黑名单（`建议/重新安装/重装/请运行/修复/reinstall/同步快照/覆盖快照`），不得出现
  - **验收**: `git diff plugins/spec-driver/scripts/judge-snapshot-doctor.mjs` 显示 `parseArgs` +1 分支、新增 `deriveDelta`/`formatSinceSection` 两个函数、`main` 内一处三元拼接；新增单测断言 `deriveDelta('missingInRepo','mismatch')==='pre-existing'`
  - **执行实况（如实标注）**: 词表按返工 C-3 由 5 值扩为 6 值（新增 `added-since`），`deriveDelta` 签名随之变为三参（`baselineStatus, currentStatus, absentAtRef`），故本条"5 值词表"的字面口径已失效。指定的那格断言以**更强形态**落地：`judge-snapshot-doctor-cli.test.mjs` 的 `deriveDelta 派生矩阵（返工后 6×6×2）` 用两张字面量矩阵逐格钉死全部 72 个组合，其中 `baseline=missingInRepo × current=mismatch × absentAtRef=false` 即为 `pre-existing`。

- [x] **T022** 验证：④ T018 五场景转绿 + SC-004 逐字节不变复核
  - **文件**: 无新增文件（跑测试 + diff 核对）
  - **服务**: FR-012 / FR-013 / FR-014 / FR-015 / FR-016 / SC-004 / SC-006
  - **依赖**: T021
  - **做什么**: 重跑 T018 的 S1~S5，S1~S4 应转绿，S5 应保持绿。用编排器已采基线复核 D4.5 第二道保障：`node plugins/spec-driver/scripts/judge-snapshot-doctor.mjs`（不带 `--since`，同机同 cwd 同 env）输出与 `<scratchpad>/judge-doctor-before.txt` 逐字节 diff 为空。核对 FR-013：未修改 `judge-snapshot-core.mjs`；若本任务发现无法绕开必须改 core，立即停止，本子项标 BLOCKED 回报（SC-006）
  - **验收**: `npm run test:plugins` 全部 PASS；`diff <(node plugins/spec-driver/scripts/judge-snapshot-doctor.mjs) <(tail -n +1 <scratchpad>/judge-doctor-before.txt)` 输出为空；`git diff --stat plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs` 输出为空

---

### Phase P5：收尾全量门禁

- [x] **T023** 全量门禁验证
  - **文件**: 无新增文件（跑五条命令）
  - **服务**: SC-005（全部 FR 的最终交付验证）
  - **依赖**: T009, T012, T013, T017, T022
  - **做什么**: 依次跑 `npx vitest run`、`npm run test:plugins`、`npm run build`、`npm run repo:check`、`npm run release:check`，五条全部零失败。遇到预存 flaky（`watch-command`/`batch-orchestrator-incremental`/`community-analysis` perf/`cli-e2e --version`）先隔离重跑该文件确认非本卡回归后再判定整体通过。同时复核 R-5（`regen-audit.jsonl` 对 `repo:check` 无影响，已在 T017 初核，此处做最终全量确认）
  - **验收**: 五条命令依次执行，全部退出码为 0；若遇预存 flaky，隔离重跑后该测试文件单独绿，并在任务记录里注明"与预存 flaky 清单匹配，非本卡回归"
  - **执行实况（编排器于全部收尾批次合流后跑，2026-09-01）**: 五条命令依次执行，**退出码全部为 0**——`npx vitest run` → `Test Files 545 passed | 4 skipped (549)`、`Tests 8050 passed | 15 skipped | 12 todo (8077)`；`npm run test:plugins` → `tests 1717 / pass 1715 / fail 0 / skipped 2`；`npm run build` → tsc 通过；`npm run repo:check` → 22 项检查全 pass；`npm run release:check` → `Release contract valid`。**未遇任何预存 flaky**（清单四项本轮均未触发，无需隔离重跑）。两条非零信号为开工前既存、与本卡无关：`graph-quality:freshness: warn`（图产物 stale，sourceCommit `25992316` vs HEAD `e01611b2`）与 `[publish-gap] sourceStatus: indeterminate`（npm registry 返回体缺 `gitHead`）。**R-5 最终确认**：`repo:check` 全 pass，`regen-audit.jsonl` 对其无影响（且该文件按 D3.5 未入库，本轮 `repo:check` 面对的新增 fixture 文件只有 README 的改动）。本轮为收尾批次合流后的第 4 次全量跑，与前 3 次的差异仅为用例数增长（8042 → 8048 → 8050），无失败项出现或消失。

---

## FR 覆盖映射表

| FR | 任务 |
|----|------|
| FR-001 | T007, T008, T009 |
| FR-002 | T007, T008, T009 |
| FR-003 | T007, T008, T009 |
| FR-004 | T008, T009 |
| FR-005 | T010, T011 |
| FR-006 | T010, T011 |
| FR-007 | T010, T011 |
| FR-008 | T011 |
| FR-009 | T004, T013 |
| FR-010 | T010, T012 |
| FR-011 | T011 |
| FR-012 | T018, T021, T022 |
| FR-013 | T019, T021, T022 |
| FR-014 | T005, T018, T020, T021 |
| FR-015 | T005, T018, T019, T020, T021 |
| FR-016 | T021, T022 |
| FR-017 | T020 |
| FR-018 | T015, T016 |
| FR-019 | T015, T016, T017 |
| FR-020 | T015, T016 |
| FR-021 | T016, T017 |

## SC 覆盖映射表

| SC | 任务 |
|----|------|
| SC-001 | T007, T008, T009 |
| SC-002 | T004, T010, T011, T012, T013 |
| SC-003 | T015, T016, T017 |
| SC-004 | T003, T018, T020, T021, T022 |
| SC-005 | T023 |
| SC-006 | T019, T021, T022 |

---

## 依赖与并行说明

### Phase 依赖关系

P0（T003-T006）是所有 Phase 的硬前置，必须先完成且无 BLOCKED 才能进入任何代码改动。P1（①，T007-T009）、P2+P3（②③ 同文件串行，T010-T017）、P4（④，T018-T022）三组**文件级互不相交**（分别落在 `agent-context-tools.ts`、`regen-collector-fingerprint-fixtures.ts`、`judge-snapshot-doctor.mjs`），理论上可由不同实现者并行推进；P2 与 P3 因落在同一文件的不同区块，**必须串行**（先 T010-T013 完成 ②，再 T014 闸门确认，再 T015-T017 完成 ③）。P5（T023）是唯一收尾点，依赖 P1/P2+P3/P4 全部完成。

### Story 内部并行机会

- T004 与 T005（P0 内部）文件/关注点均不同（一个是 vitest 探针、一个是 git CLI 实跑），可并行执行，标 `[P]`
- P1/P4 两个 Story 内部任务链均为"红先行→实现→验证"三段式，段内严格串行（后一步依赖前一步 FAIL/PASS 状态），不可并行
- P2 内部 T010→T011→T012/T013 也是严格串行（T012 与 T013 都依赖 T011 落地，彼此互不依赖，理论可并行，但因验证对象均是同一次 `npx vitest run` 输出，实践中一次跑批即可覆盖，不单独标注 `[P]`）

### 推荐实现策略

**Incremental（增量）**：按 P0→P1→P2+P3→P4→P5 顺序单线程推进是最低风险路径——四项改动虽互不相交，但共享同一套收尾门禁（T023），拆给多个并行实现者会在 T023 汇总时产生"谁的改动导致门禁失败"的归因成本，对这种"分布式 HIGH 而非耦合式 HIGH"的四小补场景，串行推进的调试成本低于并行的协调成本。若确需并行（如时间紧迫），P1 与 P4 是最安全的并行候选（文件距离最远、无共享测试基础设施），P2+P3 因内部已串行不建议再拆给第二个实现者。
