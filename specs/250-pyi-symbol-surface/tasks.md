---

description: "Task list for feature 250-pyi-symbol-surface"
---

# Tasks: `.pyi` 类型 stub 纳入 Python 符号采集面

**Input**: Design documents from `specs/250-pyi-symbol-surface/`
**Prerequisites**: plan.md（必须）、spec.md（必须）、research.md、contracts/collector-surface-extension.md、quickstart.md

**Tests**: 本 feature 的 spec/plan 已明确要求测试（TDD：先写红探针 → 实现 → 转绿），全部测试任务均为必须项（除 FR-011 `@overload` 探针标注为可选）。

**Organization**: 任务按 User Story 分组（US1/US2/US3），并保留一个 Setup 与一个 Foundational phase 承载不专属任何单一 Story 的常量扩集/测试翻转，以及一个 Polish phase 承载注释同步、fixture 再生与最终验证。

**说明（Setup phase 极简的理由）**：本 feature 复杂度评估为 LOW（0 新增组件/接口/依赖），不需要新项目结构、新依赖安装或新 lint 配置；Setup phase 仅保留一项"确认基座就绪"任务。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：可与同 phase 内其他任务并行（不同文件、无依赖）
- **[US1]/[US2]/[US3]**：所属 User Story；Setup/Foundational/Polish 阶段任务不加此标记
- 每条任务均含确切文件路径

---

## Phase 1: Setup

**Purpose**：确认基座依赖就绪，不涉及新增基础设施。

- [x] **T001** 确认当前分支基座为姊妹分支 F243 头 commit `3cdd89f`（`git log --oneline -1` 应显示 `3cdd89f` 为最近祖先；F243 尚未合入 `master`，交付顺序依赖见 spec Dependencies——F243 必须先行交付 master，本 story 才能 rebase 到最新 master 后交付），确认 `src/collector-surface.ts`/`src/panoramic/graph/collector-fingerprint.ts`/`scripts/regen-collector-fingerprint-fixtures.ts` 均已存在，并执行一次 `npx vitest run` 记录改动前基线（全绿或已知 flaky 项与 memory 记录一致）。验收：基线测试结果已记录，作为后续「本次改动是否引入新失败」的对照。

**Checkpoint**：基座确认完毕，可进入 Foundational phase。

---

## Phase 2: Foundational（阻塞性前置依赖）

**Purpose**：核心 SSoT 常量扩集是全部三个 User Story 的共同前提（FR-001）；本 phase 同时按 TDD 要求先落地全部红探针，再做实现，使探针能在实现前后各跑一次形成对照。

**⚠️ CRITICAL**：T004（常量扩集）完成前，US1（stub 元数据）与 US3（label 对齐）均无法达成预期行为；US2（护栏 A）虽不直接依赖常量值，但其探针（T-guard-a-b）与 T004 共享同一测试文件改动窗口，按顺序一并处理。

- [x] **T002** [P] 写红探针（FR-006）：修改 `tests/unit/collector-surface.test.ts` —
  - 翻转 `PY_SCAN_SAMPLES` 中 `mod.pyi` 断言：「MUST NOT 命中」→「MUST 命中」，同步改写行内注释
  - 改写「两面失配」对拍测试为「两面一致」语义（`walkPyFiles` 与符号扫描面在同一目录下采集结果集合相等，均含 `mod.pyi`）
  - 改写 SC-005 (a1) 分组中「声明面确实不同」断言的措辞（扩展名集合一致但仍是两个独立 `Set` 引用，`.not.toBe` 断言保留）
  - **硬性要求**：翻转后的断言必须保留硬编码期望值列表（如 `['mod.py', 'mod.pyi']`），禁止改写为仅由 `PYTHON_SYMBOL_SCAN_SURFACE` 自身反向推导的自证断言
  - 验收：此时常量尚未扩集（T004 未做），运行 `npx vitest run tests/unit/collector-surface.test.ts` 应表现为红（新断言失败），确认探针确实在测目标行为而非已经通过。
  - 对应 FR/SC：FR-006、SC-001

- [x] **T003** [P] 写红探针（FR-002/FR-003b/FR-004/FR-005/FR-010/FR-011）：在 `tests/adapters/python-adapter.test.ts` 新增 7 个必须 + 1 个可选 `it`（均按 plan.md「测试策略」章节给出的构造与断言点实现）：
  1. `T-guard-a-b`：4 文件目录（`mod.py`/`mod.pyi` 内含自身 import/`helper.py`/`user.py`），断言 `moduleGraph.modules[]` 含全部四者、`user.py→mod` 边 `to==='mod.py'`、无任何边 `to==='mod.pyi'`、`mod.pyi→helper` 边正常存在
  2. `T-guard-a-relative`（终审后补入，闭合 FR-004 字面要求）：构造相对 import 场景（`mod.py`+`mod.pyi` shadow 对同目录，另一文件以相对路径解析 `mod`），断言 `tryResolveAtDir` 的候选路径解析结果恒为 `mod.py`，不产生任何指向 `mod.pyi` 的解析结果——显式补齐 FR-004 第二条（相对 import 场景）的探针覆盖，与 `T-guard-a-b`（绝对 import 场景）互补
  3. `T-label-normal`：`mod.py`+`mod.pyi` 均可正常解析，断言两者 module 节点 `label` 均为 `mod`，`id` 保留各自完整后缀
  4. `T-label-parse-error`：`vi.spyOn(adapter, 'analyzeFile')` 对 `.pyi` 路径 mock 为 `mockRejectedValueOnce`，断言 parseError 降级分支产出的 `label` 同样按真实扩展名剥离
  5. `T-C1-dotfile`：字面量文件名 `.py`/`.pyi`，断言 `label` 分别为 `.py`/`.pyi`（非空串）
  6. `T-FR002`：目录内只放 `.pyi` 文件（不放任何 `.py`），断言 `extractSymbolNodes` 产出对应 module 节点（锁定 `scanPyFiles` 消费 SSoT 而非硬编码字面量判断）
  7. `T-SC005-control`：以 `process.cwd()`（REPO_ROOT）为 project root 调用 `extractSymbolNodes`，断言其结果**不含** `tests/fixtures/collector-fingerprint-guardrail/src/py/mod.pyi`（落在剪枝集内）；另按既有探针同式写死注入形态调用 `walkPyFiles(REPO_ROOT, out, () => false, REPO_ROOT)`，断言其结果**包含完整相对路径** `tests/fixtures/collector-fingerprint-guardrail/src/py/mod.pyi`（而非仅 basename——收紧断言精度，隔离 gitignore 等变量干扰，只测 `scanPyFiles`/`walkPyFiles` 两套硬编码 ignore 集之间的剪枝集差异这一个变量）
  8. **（可选，FR-011）** `T-overload`：`.pyi` 内两个 `@overload` 同名函数，断言写入层收敛后不产生重复节点/边
  - 验收：此时常量尚未扩集（T004 未做）、护栏 A/B 尚未实现，运行 `npx vitest run tests/adapters/python-adapter.test.ts` 中新增用例应表现为红（`T-guard-a-b`/`T-label-normal`/`T-label-parse-error`/`T-C1-dotfile`/`T-FR002` 预期失败——`T-FR002` 场景下目录内只有 `.pyi` 文件，T004 前 `PYTHON_SYMBOL_SCAN_SURFACE` 仅含 `.py`，`scanPyFiles` 对其返回空、`extractSymbolNodes` 产零节点，该探针**必红**，其红→绿翻转正是 FR-002 防回归价值所在；`T-SC005-control` 因不依赖尚未实现的护栏/常量、预期已可通过，属对既有事实的确认性探针，非红绿判据）。**警告**：实现时若发现 `T-FR002` 在 T004 前是红，请勿削弱断言以「调和」文字描述——这是预期红，不允许为了让描述看起来一致而改弱探针。
  - 对应 FR/SC：FR-002、FR-003(b)、FR-004、FR-005、FR-010、FR-011（可选）、SC-004、SC-005

- [x] **T004** 实现 FR-001：编辑 `src/collector-surface.ts`，将 `PYTHON_SYMBOL_SCAN_SURFACE.extensions` 从 `new Set(['.py'])` 扩为 `new Set(['.py', '.pyi'])`，`matchSemantics` 保持 `case-sensitive` 不变（**本任务仅改常量字面量，不改注释**——注释改写归入 T008）。运行 `npx vitest run tests/unit/collector-surface.test.ts` 确认 T002 探针转绿；同时确认 `T-FR002` 从红转绿。
  - 依赖：T002、T003 已先落地（TDD 顺序）
  - 对应 FR/SC：FR-001、FR-002（探针确认）、SC-001

**Checkpoint**：常量扩集完成，`T-FR002`/`T-SC005-control` 全绿；`T-guard-a-b`/`T-guard-a-relative`/`T-label-*`/`T-C1-dotfile` 仍红（等待 US2/US3 实现）。US1/US2/US3 均可基于此 checkpoint 独立推进。

---

## Phase 3: User Story 2 - 同名 `.py`/`.pyi` 文件的 import 解析仍然准确指向实现文件 (Priority: P1)

**Goal**：防止 `.pyi` 扩集后污染 import 解析目标，绝对/相对 import 恒指向 `.py`。

**Independent Test**：对 shadow 对（`mod.py`+`mod.pyi`）跑 `buildModuleGraph`，断言 import 边指向 `mod.py`、不指向 `mod.pyi`；解析结果等价行为由探针锁定（import 恒指向 `.py`、零 `.pyi` 目标边）——护栏 A（`pyModuleMap` 显式跳过 `.pyi`）本身的存在性在黑盒下不可观测（实现审查证实：移除该 `continue` 分支后 `T-guard-a-b` 仍全绿，因为 `.pyi` 键本就不可达/不影响解析结果），如实登记：该护栏当前价值是阻断未来「label 剥离 helper 被顺手统一用于 `pyModuleMap` 键生成」导致的键塌缩风险，届时探针会由绿转红，属显式登记的防御性设计，非当前可被黑盒断言直接验证的行为。

- [x] **T005** [US2] 实现护栏 A（FR-004）：编辑 `src/adapters/python-adapter.ts` 的 `buildModuleGraph` 方法，在构建 `pyModuleMap` 时对 `.pyi` 文件显式 `continue`（不写入任何键），取代对现状「`.pyi` 键恰好不等于 `topModule`」这一意外安全属性的依赖；`tryResolveAtDir` 候选路径保持恒为字面 `X.py`/`X/__init__.py` 不变（相对 import 场景 FR-004 第二条本就满足，本任务仅需确认不做改动）。运行 `npx vitest run tests/adapters/python-adapter.test.ts -t "T-guard-a-b"` 确认转绿。
  - 依赖：T004（Foundational checkpoint）
  - 对应 FR/SC：FR-004、SC-004

**Checkpoint**：US2 独立可测——import 解析等价行为探针（`T-guard-a-b`/`T-guard-a-relative`）全绿，绝对/相对 import 解析均正确指向 `.py`（护栏 A 存在性本身在黑盒下不可观测，如实登记，不作为可断言项）。

---

## Phase 4: User Story 1 - stub 符号获得与实现符号同级的签名元数据与来源标注 (Priority: P2)

**Goal**：`.pyi` 符号节点新增 `signature`/`symbolKind`/`confidence: 'EXTRACTED'`/`sourceTag: 'extraction'` 元数据，与 unified 路既有字段并集共存。

**Independent Test**：对 `tests/fixtures/collector-fingerprint-guardrail/src/py/mod.pyi` 执行 graph-only 建图，查询 `src/py/mod.pyi::mod_fn` 节点，断言其 metadata 含上述字段且与 unified 路字段并存不丢失。

- [x] **T006** [US1] 验证 US1 生效（无新增生产代码——FR-003 由 T004 常量扩集自动触发 `extractSymbolNodes`/`buildModuleGraph` 对 `.pyi` 生效）：
  1. 按 `quickstart.md` 步骤 2 执行临时 `.mts` 脚本（staging 隔离建图，勿直接对 `tests/fixtures/collector-fingerprint-guardrail` 建图），确认 `src/py/mod.pyi::mod_fn` 节点 `metadata` 含 `signature`（有值）、`symbolKind: 'function'`、`confidence: 'EXTRACTED'`、`sourceTag: 'extraction'`，且保留 `unifiedKind`/`sourcePath`/`exportKind` 等既有字段；将实测得到的 `signature` 精确字符串记录下来，供 T009 fixture 再生核对时替换契约文档中的 `[待验证]` 占位。
  2. **（SC-002(c) duplicate 语义执行载体）**：staging 建图完成后，对该临时目录产出的图运行 `node dist/cli/index.js graph-quality --graph <tmpdir>/specs/_meta/graph.json`，确认含 shadow 对（`mod.py`+`mod.pyi`）的 fixture 图 duplicate 指标 pass——验证 `.py`/`.pyi` 同名符号因 relPath 前缀不同而不产生假重复（三元组含 filePath 天然区分）。
  - 依赖：T004
  - 对应 FR/SC：FR-003、SC-002(c)、SC-007

**Checkpoint**：US1 独立可测——stub 符号元数据字段齐全，且与 unified 路字段并集共存（非覆盖关系）；duplicate 指标在含 shadow 对的 fixture 图上验证 pass。

---

## Phase 5: User Story 3 - extraction 路产出的 `.pyi` module 节点 label 与 `.py` 对齐 (Priority: P2)

**Goal**：extraction 路覆盖目录内 `.pyi` module 节点 `label` 剥离为纯模块名（如 `mod`），与 `.py` 展示行为一致；extraction 路未覆盖目录内的 `.pyi`（如落在 `tests` 剪枝集内）保持 unified 路原始文件名 label 不受影响（对照组）。

**Independent Test**：对 extraction 路覆盖目录内的 `.pyi` module 节点跑查询，断言 `label` 为剥离扩展名后的纯模块名，`id` 仍为完整 relPath；对未覆盖目录内的 `.pyi` 跑查询，断言 label 保持原始文件名不变。

- [x] **T007** [US3] 实现护栏 B（FR-005/FR-010）：编辑 `src/adapters/python-adapter.ts` 的 `extractSymbolNodes` 方法——
  - 提取局部 helper（如 `stripFileExtension(relPath) => path.basename(relPath, path.extname(relPath))`），替换当前硬编码 `path.basename(relPath, '.py')` 的**两处**调用（正常分支约 `:220` 附近、parseError 降级分支约 `:202` 附近），避免双写漂移
  - `id` 字段保持完整 relPath 不变（不受本次改动影响）
  - 显式接受纯点文件 `.py` 的行为 delta（label 从空串变为 `.py`，见 plan.md Architecture 决策 4 / C1 订正），不作为回归处理
  - 运行 `npx vitest run tests/adapters/python-adapter.test.ts -t "T-label-normal|T-label-parse-error|T-C1-dotfile"` 确认全部转绿；同时确认 `T-SC005-control` 仍绿（对照组不受影响）
  - 依赖：T004
  - 对应 FR/SC：FR-005、FR-010、SC-005

**Checkpoint**：US3 独立可测——extraction 路覆盖目录内 `.pyi` label 剥离正确，未覆盖目录对照组行为不变。

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**：注释同步、fixture 再生、零改动确认与最终全量验证，覆盖不专属任何单一 User Story 的收尾项。

- [x] **T008** [P] 注释三处改写（FR-008）：
  - `src/collector-surface.ts`：`PYTHON_SYMBOL_SCAN_SURFACE` 相关注释从「记账现状/待产品裁决」更新为「已裁决设计意图」，明确标注 `.pyi` 产出的是类型面 stub 符号（函数体恒为 `...`），避免"stub 符号与实现符号语义等价"的误解措辞
  - `src/adapters/python-adapter.ts`：`extensions` 字段与 `scanPyFiles` 文档注释中「声明面与扫描面不一致」的表述同步更新，消除自相矛盾的两份注释
  - `src/panoramic/graph/collector-fingerprint.ts` 约 `:44-46`：`pythonSymbolScan`/`pyWalk` 刻意分列的注释改写为「两者分列是为了保留各自管线身份与指纹 key 的独立稳定性，扩展名集合自 F250 起趋于一致，但仍作为两个独立指纹分量分别追踪」
  - 依赖：T004、T005、T007（确保注释反映实现后的真实行为，不早于实现完成）
  - 对应 FR/SC：FR-008

- [x] **T009** fixture 再生与逐字段核对（FR-007/FR-009/SC-002b/SC-003/SC-007）：
  1. 执行 `npm run fixtures:regen:collector-fingerprint`（复用既有 `scripts/regen-collector-fingerprint-fixtures.ts`，脚本本身不改）
  2. `git diff tests/fixtures/collector-fingerprint-guardrail/` 逐字段核对 `contracts/collector-surface-extension.md` 契约 3（`expected-graph-only-graph.json`）：
     - `src/py/mod.pyi` module 节点：`label` `"mod.pyi"→"mod"`；`metadata.sourceTag` `"unified-graph"→"extraction"`；新增 `metadata.sourceFile: "src/py/mod.pyi"`；新增 `metadata.confidence: "EXTRACTED"`；`unifiedKind`/`sourcePath`/`callSitesCount` 不变
     - `src/py/mod.pyi::mod_fn` symbol 节点：新增 `metadata.symbolKind: "function"`；新增 `metadata.signature`（以本次实跑产出为准，替换 T006 记录的实测值，不得照抄契约文档中的 `[待验证]` 占位）；新增 `metadata.sourceFile`/`metadata.confidence: "EXTRACTED"`；`unifiedKind`/`sourcePath`/`exportKind` 不变
     - 顶层 `graph.graph.fingerprint.extensionSurface.pythonSymbolScan.extensions`：`[".py"]→[".py",".pyi"]`
  3. 核对契约 4（`expected-module-graph.json`）：仅 `fingerprint.extensionSurface.pythonSymbolScan.extensions` 变化，`moduleGraph.modules[]` 内容不变（仍零 python 条目）
  4. **核对「不应出现的 delta」负面清单**（若出现以下任一项，视为异常需人工核查，不得直接接受再生结果）：`src/py/mod.pyi` 或其 component 节点 `id` 字段变化；任何 `contains` 边新增/删除；`src/py/mod.py`（`.py` 对照组）任何字段变化；`expected-module-graph.json` 的 `moduleGraph.modules[]` 内容变化
  5. 确认再生脚本的二元拒绝判据未被绕过（内容变化 + 指纹变化 → 接受；若出现内容变化但指纹未变的情况需人工阻断，不得强行提交）
  6. 确认无需人工递增 `BEHAVIOR_VERSION`（FR-009：扩展名集合增删属于该机制既定自动反映范畴）
  7. 将再生后的 pinned 资产变更纳入本次提交（`git add tests/fixtures/collector-fingerprint-guardrail/`）
  - 依赖：T004、T005、T007（fixture 内容反映全部实现后的最终行为）
  - 对应 FR/SC：FR-007、FR-009、SC-002(b)、SC-003、SC-007

- [x] **T010** 零改动确认 checklist（防幽灵改动，SC-002 前置保障）：逐项确认以下文件/逻辑在本次改动中零改动——
  - `scanPyFiles` 方法本体（`python-adapter.ts`，仅消费扩集后的常量值，函数体逻辑不变）
  - `tryResolveAtDir`（候选路径生成逻辑不变，恒为 `X.py`/`X/__init__.py`）
  - unified-graph 路 `deriveNodesFromSkeletons` 的 label 生成逻辑（跨语言原始文件名通例，不做任何修改）
  - `walkPyFiles`（skeleton 采集面遍历逻辑不变）
  - `src/panoramic/graph/quality/ignore-oracle.ts`（本就不消费 `PYTHON_SYMBOL_SCAN_SURFACE`，零改动）
  - `cache-key-builder.ts`（仅消费 `TSJS_SKELETON_WALK_SURFACE`，与本次改动零关联）
  - `scripts/regen-collector-fingerprint-fixtures.ts`（复用既有脚本，不改脚本本身）
  - `tests/fixtures/collector-fingerprint-guardrail/src/` 目录下源文件内容（`mod.pyi` 等既有样本文件内容不变，本次改动不新增任何 fixture 源文件）
  - 依赖：T004、T005、T007、T008（在全部实现改动完成后统一核查，逐项 `git diff` 确认无 diff）
  - 对应 FR/SC：Out of Scope 章节、SC-002 前置保障

- [x] **T011** 最终全量验证（步骤按依赖次序重排——**必须先重建图再跑 repo:check/graph-quality**，否则指纹变化会被判定为预期外 stale）：
  1. `npx vitest run` 零失败（对照 T001 记录的基线，确认无新增失败；已知 flaky 项按 memory 记录处理不计入新增失败）
  2. `npm run build` 零类型错误
  3. **图重建**：`npm run build && node dist/cli/index.js batch --mode graph-only`（若仓内 CLI 入口路径与此不同，以实际 `dist/` 产物路径为准，执行前先核实；**严禁**误用 `spectra graph`——该命令会静默毁图，是仓库既有踩坑记录；也不要依赖全局 `spectra` 命令——全局安装是旧编译产物，非本分支代码）
  4. `npm run repo:check` 通过（该命令自身已含 graph-quality 族校验，注册于 `scripts/lib/repo-maintenance-core.mjs`；若在步骤 3 图重建**之前**跑，会因本次改动导致的指纹变化报出预期内的 stale 警告——故必须先完成步骤 3 再跑本步骤）
  5. 本仓真实图重建后运行体检：`node dist/cli/index.js graph-quality --graph specs/_meta/graph.json --json`，确认除 freshness 外的质量指标（duplicate/orphan/dangling/ignored）全部 pass；freshness 断言按有信号口径评估——重建后 freshness 预期为 `dirty`（工作树含未提交改动）或 `fresh`（提交后重跑），**不应为 `stale`**（若仍为 `stale` 说明图重建未生效，需排查步骤 3 是否成功落盘）；该文件位于 `scanPyFiles` 剪枝集内，本仓行为增量为零，此步骤是纯回归守卫（SC-002(a)）
  6. 执行 `quickstart.md` 全部 6 个步骤逐一复核，确认与文档描述一致
  - 依赖：T002-T010 全部完成
  - 对应 FR/SC：SC-002(a)、SC-002(c)、SC-006

**Checkpoint**：全部 User Story 与护栏均已实现、fixture 已再生入库、零改动确认通过、全量验证零失败——feature 可交付。

---

## FR/SC 覆盖映射表

| Requirement | Task ID |
|---|---|
| FR-001（常量扩集） | T004 |
| FR-002（SSoT 消费防回归） | T003（T-FR002）、T004 |
| FR-003（extraction/buildModuleGraph 双产物） | T004、T003（T-guard-a-b）、T006 |
| FR-004（护栏 A：import 解析目标排除） | T003（T-guard-a-b/T-guard-a-relative）、T005 |
| FR-005（护栏 B：label 剥离） | T003（T-label-normal/T-label-parse-error/T-C1-dotfile）、T007 |
| FR-006（探针翻转+反自证要求） | T002 |
| FR-007（fixture 再生 delta） | T009 |
| FR-008（三处注释改写） | T008 |
| FR-009（指纹自动 stale，无需 BEHAVIOR_VERSION） | T009 |
| FR-010（parseError 降级分支同步修正） | T003（T-label-parse-error）、T007 |
| FR-011（可选，`@overload` 收敛探针） | T003（T-overload，可选） |
| SC-001 | T002、T004 |
| SC-002(a) 回归口径 | T011 |
| SC-002(b) fixture 口径 | T009 |
| SC-002(c) 指标语义澄清 | T006、T009、T011 |
| SC-003 | T009 |
| SC-004 | T003（T-guard-a-b/T-guard-a-relative）、T005 |
| SC-005 | T003（T-label-*/T-SC005-control）、T007 |
| SC-006 | T011 |
| SC-007 | T006、T009 |

**100% FR 覆盖确认**：FR-001 至 FR-011（含可选 FR-011）均至少有一个对应 Task ID；SC-001 至 SC-007 均有对应验证任务。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：无依赖，立即开始
- **Foundational（Phase 2）**：依赖 Setup 完成；T002/T003（写红探针）可并行，T004（常量扩集）依赖 T002、T003 已落地（TDD 顺序），且 **阻塞 US1（Phase 4）与 US3（Phase 5）**——两者的预期行为均建立在常量已扩集之上
- **US2（Phase 3）**：依赖 Foundational checkpoint（T004）完成后即可开始；不依赖 US1/US3
- **US1（Phase 4）**：依赖 Foundational checkpoint（T004）完成后即可开始；不依赖 US2/US3（T006 是验证性任务）
- **US3（Phase 5）**：依赖 Foundational checkpoint（T004）完成后即可开始；不依赖 US1/US2
- **Polish（Phase 6）**：依赖 US1/US2/US3 全部完成（T005、T006、T007）——注释需反映最终实现行为，fixture 再生需捕获全部改动的合并结果，零改动确认与最终验证需在全部代码改动完成后进行

### User Story Dependencies

- **US2（P1）**：可在 Foundational 完成后立即开始，与 US1/US3 互不阻塞
- **US1（P2）**：可在 Foundational 完成后立即开始，与 US2/US3 互不阻塞（T006 为验证性任务）
- **US3（P2）**：可在 Foundational 完成后立即开始，与 US1/US2 互不阻塞

### Within Each User Story

- 探针（T002/T003）已在 Foundational phase 统一先行写好并确认红，各 Story 实现任务（T005/T007）只需针对各自负责的探针子集跑绿
- US1（T006）无新增生产代码，仅验证 T004 的自动生效结果

### Parallel Opportunities

- T002、T003 可并行（不同测试文件）
- Foundational checkpoint（T004）完成后，T005（US2）、T006（US1）、T007（US3）三者可完全并行（不同代码路径：`buildModuleGraph` vs 无新代码 vs `extractSymbolNodes` label helper）
- T008（注释改写）涉及三个不同文件，内部三处编辑可并行处理，但整体任务需等待 T005/T007 实现完成

---

## Parallel Example: Foundational Phase

```bash
# T002 与 T003 可并行派发（不同测试文件，互不阻塞）：
Task: "写红探针：tests/unit/collector-surface.test.ts 翻转断言（FR-006）"
Task: "写红探针：tests/adapters/python-adapter.test.ts 新增 7+1 个 it（FR-002/003b/004/005/010/011）"
```

## Parallel Example: 三个 User Story 同步推进

```bash
# T004（Foundational checkpoint）完成后，三个 Story 可并行派发：
Task: "US2 护栏 A：src/adapters/python-adapter.ts buildModuleGraph pyModuleMap 显式跳过 .pyi"
Task: "US1 验证：quickstart.md 步骤 2 执行 staging 建图确认 signature/symbolKind/confidence/sourceTag"
Task: "US3 护栏 B：src/adapters/python-adapter.ts extractSymbolNodes label helper 提取与两处应用"
```

---

## Implementation Strategy

### 推荐执行顺序（非严格 MVP 分层——三个 Story 均为同一常量扩集的不同验收面，建议一次性推进而非分批交付）

1. 完成 Phase 1 Setup（T001）
2. 完成 Phase 2 Foundational（T002 → T003 → T004），得到 checkpoint：常量已扩集，US2/US1/US3 的护栏类探针红、非护栏类探针（T-FR002/T-SC005-control）绿
3. 并行推进 Phase 3（US2/T005）、Phase 4（US1/T006）、Phase 5（US3/T007）——三者互不阻塞，可分给不同开发者或依次串行完成，均不影响独立可测性
4. 完成 Phase 6 Polish（T008 注释 → T009 fixture 再生核对 → T010 零改动确认 → T011 最终验证）
5. **STOP and VALIDATE**：确认 T011 全部通过后方可提交

### 为何不建议分批交付（与模板默认「MVP First / Incremental」策略的差异说明）

本 feature 复杂度 LOW、三个 User Story 共享同一常量扩集前提且改动量极小（生产代码 4 处文件、每处改动 < 20 行），分批交付（如先只做 US2 就发布）反而会造成「`.pyi` 已扩集但 label 未剥离/元数据未验证」的中间态，不符合 fixture 是原子性再生资产的实际情况（一次 `regen` 命令产出的 diff 天然覆盖全部三个 Story 的合并结果）。故推荐一次性完成全部 Phase 后再提交，而非按 Story 增量发布。
