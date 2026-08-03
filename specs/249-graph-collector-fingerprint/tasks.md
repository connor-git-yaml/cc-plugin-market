# Tasks: Graph Collector Fingerprint（图产物版本化）

**Input**: `specs/249-graph-collector-fingerprint/{spec.md, plan.md, data-model.md, quickstart.md, contracts/graph-quality-report-schema-delta.md}`
**Prerequisites**: plan.md（已定案，四轮 spec 审查 + 三轮 plan 审查全部收敛）、spec.md（19 FR / 20 SC / 10 EC）

**Tasks 阶段审查回写**：Codex tasks 阶段对抗审查打回 2 CRITICAL + 7 WARNING，编排器逐条裁决后本版本核心修订：① Phase 4 依赖修正——仅 T036–T042（fixture 源码/normalize helper/registry helper/typed loader/纯判据函数及其单测等准备类任务）可与 Phase 3 并行，T043 起的产物生成/护栏运行类任务显式依赖 T035（Phase 3 原子组收口）；② 新增 T032（FR-006 spy 回归测试，锁定 `buildAstGraphOnly` 全程不调用 `buildModuleGraphForProject`），Phase 3 原子组范围调整为 T018–T033（`T034` SC-018 回归 oracle 移出原子组，标注可独立提交）；③ SC-001 端到端断言补入 T021 + T035 验证命令补齐；④ 三张失实的 `[TDD-red-first]` 标签（原 T029/T041/T044）改为 `[regression]`；⑤ 依赖矛盾修正（T025→T018、新 T034→T030）与并行机会描述对齐真实依赖；⑥ 防守映射表重构为 plan.md R4 真实十项原编号 + 落实状态，tasks 阶段新增防守单列；⑦ FR-014/FR-006/FR-018 补齐可执行验收；⑧ 拒绝场景三分 + SC-006 持久化落点；⑨ schema 契约测试改为对照 T030 真实 CLI 输出样本的递归校验器；⑩ 抽查空转断言全部补具体命令。全部任务编号自 T032 起顺延（+1），总任务数由 54 → 55。

**组织方式**：本需求以 **plan.md 的 5 Phase 实施顺序**组织任务（而非按 User Story 拆分并行 Phase）——这是 plan 的 HIGH 风险强制分阶段裁决的直接延续：Phase 3 是不可拆分的原子兼容 Phase，跨越 US1/US2/US3 三个 User Story 的完整语义闭环必须同一提交落地，按 User Story 拆 Phase 会重新引入 Codex plan 审查 C-01 指出的中间断裂态。三个 User Story 与 SC 的对应关系见文末「User Story ↔ SC ↔ Task 映射」。

**Tests**: 本需求 spec/plan 已显式要求测试（FR-005/SC-005/SC-009/SC-010/SC-014/SC-015/SC-016/SC-017/SC-018 等均为可执行断言），新建测试文件任务遵循 TDD：先写断言（预期部分失败/全部失败），再实现使其转绿。**标签使用约定**：`[TDD-red-first]` 仅用于"测试先于对应实现落地、提交后必为 red"的任务；若测试任务的落地时点晚于其依赖的实现（即依赖已存在，断言提交后立即或部分转绿），MUST 标 `[regression]` 而非 `[TDD-red-first]`，避免标签失实。

**Phase 3 原子提交约束**：T018–T033 标注 `[ATOMIC-P3]`，组内任务可并行编码，但验证与提交必须作为单一不可拆分整体（不允许 T018–T033 之间任何子集单独提交）。T034（SC-018 回归 oracle）与 T035（Phase 3 整体验证/收口点）虽仍列于 Phase 3 章节内组织，但 T034 **非原子组成员**（见 T034 任务说明），T035 保留 `[ATOMIC-P3]` 作为整体验证收口点标注。

---

## Phase 1：SSoT 收敛 + dirty 判定语义翻转

**目标**：新建零依赖叶子模块 `src/collector-surface.ts` 作为采集面单一事实源；六处消费方（#1/#2/#4/#5/#6/#7/#8）收敛为对它的引用；`.pyi`/大小写变体漏报修复（决策 2/3/4，FR-002/FR-003/FR-019）。

**独立验证**：`npx vitest run tests/unit/collector-surface.test.ts src/panoramic/graph/source-commit.test.ts src/panoramic/graph/quality/ignore-oracle.test.ts && npm run build` 零失败/零错误。

- [x] **T001** [P] 文档一致性清理：删除/改写 `specs/249-graph-collector-fingerprint/plan.md` 第 6/8/10/26 行与 `specs/249-graph-collector-fingerprint/spec.md` 第 21 行残留的"三元→二元"历史措辞，仅保留 plan.md「Complexity Tracking」中标注 `[已否决方案记录]` 的一条为唯一历史记录；复扫 `plan.md`/`spec.md`/`data-model.md`/`quickstart.md` 四份制品，确认"三元判据"字样仅出现一次
  验收：`grep -n "三元判据" specs/249-graph-collector-fingerprint/{spec,plan,data-model,quickstart}.md` 输出恰好 1 行（Complexity Tracking 那一行）；落位「tasks 阶段新增防守」T4 文档一致性清理
  依赖：无

- [x] **T002** [P] 新建 `src/collector-surface.ts`：定义 `CollectorPipelineSurface`/`ExtensionMatchSemantics` 类型、五个管线常量（`TSJS_SKELETON_WALK_SURFACE`/`PY_WALK_SURFACE`/`JAVA_ADAPTER_SURFACE`/`GO_ADAPTER_SURFACE`/`MODULE_DERIVATION_SCAN_SURFACE`）、`ALL_PRODUCER_SURFACES`、`DIRTY_SOURCE_SURFACES`（公开 seam re-export）、`mergeSurfaces(a, b)` 纯函数（`matchSemantics` 不同时 `throw`，决策 3/I-02）；零依赖（仅类型标注，不 import 任何生产层）
  验收：FR-001/FR-002/FR-019；`npm run build` 通过；文件顶层 import 声明为空或仅 `node:path` 类型引用
  依赖：无

- [x] **T003** [P] 新建 `tests/unit/collector-surface.test.ts`（TDD red 先行）：覆盖 SC-005 (a1) 运行时引用同一性 `===`（#4 `DIRTY_SOURCE_SURFACES` re-export 本身、#7/#3 待后续任务落地后转绿，#3 含 `new JavaLanguageAdapter().extensions === JAVA_ADAPTER_SURFACE.extensions`/`GoLanguageAdapter` 同理）、(a2) AST import 边界 + 无本地字面量重声明 oracle（#1/#2/#5/#6/#4 内部谓词/#8 fallback，待后续任务落地后转绿）、(b) 行为探针（各管线临时目录实跑，**逐管线钉死具体入口函数与输出 oracle**：#1/#2 `walkTsJsFiles`/`walkPyFiles`（`src/batch/stages/source-discovery.ts`）断言返回文件路径集合精确等于临时目录内按扩展名过滤后的预期集合；#5 `createIgnoreOracle`（`src/panoramic/graph/quality/ignore-oracle.ts`）断言其代码扩展子集与 SSoT `ALL_PRODUCER_SURFACES` 并集完全一致；#6 `cache-key-builder.ts` 的 `scanSourceFiles` 断言其扫描到的代码子集不含 SSoT 未声明扩展名；#8 `module-derivation.ts` 的 registry-fallback 分支（空 registry 场景）断言产出的模块扫描扩展名集合与 `MODULE_DERIVATION_SCAN_SURFACE.extensions` 完全一致）、**SC-015**（用 ts-morph 静态解析 `collector-surface.ts` 顶层 `import`/`export...from`/`require()`/动态 `import()`，断言模块说明符集合 ⊆ Node `builtinModules`，含裸名与 `node:` 前缀双形态）；`mergeSurfaces` 的 `matchSemantics` 不一致 throw 断言可立即转绿（依赖 T002）
  验收：SC-005 全部 8 个盘点点位的测试用例已写入（部分标记为依赖后续任务尚为 red，属预期）；SC-015 断言可在 T002 完成后立即转绿；#1/#2/#5/#6/#8 行为探针均断言具体入口函数的输出集合而非仅"不抛错"
  依赖：T002（落位 R4 防守项 1 SC-015 AST oracle + 防守项 3 #4/#5/#6 双面校验）

- [x] **T004** [P] 改造 `src/adapters/java-adapter.ts`：`readonly extensions` 字段引用 `JAVA_ADAPTER_SURFACE.extensions`（决策 2，FR-002 #3）
  验收：T003 中 `new JavaLanguageAdapter().extensions === JAVA_ADAPTER_SURFACE.extensions` 断言转绿
  依赖：T002

- [x] **T005** [P] 改造 `src/adapters/go-adapter.ts`：`readonly extensions` 字段引用 `GO_ADAPTER_SURFACE.extensions`（决策 2，FR-002 #3）
  验收：T003 中 `GoLanguageAdapter` 对应 `===` 断言转绿
  依赖：T002

- [x] **T006** [P] 改造 `src/adapters/ts-js-adapter.ts`：`.extensions` 字段（原 ×8 硬编码）改为引用 `MODULE_DERIVATION_SCAN_SURFACE.extensions`（决策 2，FR-002 #7）
  验收：T003 中 `#7` `===` 引用同一性断言转绿
  依赖：T002

- [x] **T007** [P] 改造 `src/knowledge-graph/module-derivation.ts`：registry-fallback 分支的 ×8 硬编码字面量改为引用 `MODULE_DERIVATION_SCAN_SURFACE.extensions`（决策 2，FR-002 #8）
  验收：T003 中 `#8` AST oracle（无本地字面量重声明）断言转绿；`#8` 行为探针（空 registry fallback 场景，具体断言产出扩展名集合与 SSoT 一致）转绿
  依赖：T002

- [x] **T008** [P] 改造 `src/batch/stages/source-discovery.ts`：`walkTsJsFiles`/`walkPyFiles` 的 endsWith 判定条件改为引用 `TSJS_SKELETON_WALK_SURFACE`/`PY_WALK_SURFACE`（决策 2，FR-002 #1/#2）
  验收：T003 中 `#1`/`#2` AST oracle + 行为探针（返回文件路径集合精确匹配）断言转绿
  依赖：T002

- [x] **T009** [P] 改造 `src/panoramic/graph/quality/ignore-oracle.ts`：`TSJS_EXTENSIONS`/`PY_EXTENSIONS` 代码扩展子集改为引用 SSoT（决策 2，FR-002 #5）；核实既有 `ignore-oracle.test.ts` 是否需要同步更新断言
  验收：T003 中 `#5` AST oracle 断言转绿；既有 `ignore-oracle.test.ts` 全绿
  依赖：T002

- [x] **T010** [P] 改造 `src/panoramic/cache/cache-key-builder.ts`：`INCLUDED_EXTENSIONS` 中代码子集改为引用 SSoT（doc/config 扩展子集不动，保留 cache fallback 自有职责，FR-002 明确排除）（决策 2，FR-002 #6）
  验收：T003 中 `#6` AST oracle 断言转绿
  依赖：T002

- [x] **T011** [P] 修改 `src/panoramic/graph/source-commit.test.ts`（TDD red 先行）：`:272` 附近既有 `.TS→fresh` 用例按决策 4 翻转为 `.TS→dirty`（断言理由改为"因 `moduleDerivationScan` 大小写不敏感面命中"）；新增 `.PY→fresh` 反例（证明非全局大小写不敏感化）；新增 SC-008 三类样本（`.pyi`/`Foo.JAVA`/`foo.MJS`）dirty 断言（partial：本 Phase 仅验证 dirty 判定谓词本身，完整端到端 freshness 断言留 Phase 3）；移除依赖 `getDirtySourceExtensions` 的既有防漂移测试
  验收：本任务提交后上述新断言应为 red（`source-commit.ts` 尚未实现新谓词）
  依赖：T002

- [x] **T012** 修改 `src/panoramic/graph/source-commit.ts`：移除 `getDirtySourceExtensions(): ReadonlySet<string>` 导出；新增内部（非公开导出）逐管线谓词函数，消费 `DIRTY_SOURCE_SURFACES`（5 管线：tsjsSkeletonWalk/pyWalk/javaAdapter/goAdapter/moduleDerivationScan），按各自 `matchSemantics` 分别扩展名比较（决策 4，FR-002 #4/FR-003）；移除对 `adapters/` 层的直接 `new JavaLanguageAdapter()`/`new GoLanguageAdapter()` 实例化依赖
  验收：T011 新增断言全部转绿；T003 中 `#4` (a1 `DIRTY_SOURCE_SURFACES` re-export `===`) + (a2 内部谓词 AST oracle) 双重覆盖断言转绿
  依赖：T002, T011

- [x] **T013** Phase 1 独立验证：`npx vitest run tests/unit/collector-surface.test.ts src/panoramic/graph/source-commit.test.ts src/panoramic/graph/quality/ignore-oracle.test.ts && npm run build`
  验收：零失败/零错误；SC 绿名单达成——SC-004（partial：dirty/fresh 现状回归半段，含 C-04 两条用例）/ SC-005（a1/a2/b 中不依赖指纹的部分，即全部 #1-#8）/ SC-008 / SC-015；SC-002 明确不在本 Phase 绿名单（依赖 Phase 2 才新建的模块）
  依赖：T001–T012

---

## Phase 2：指纹计算模块 + barrel re-export

**目标**：新建 `computeCollectorFingerprint()`/`isValidCollectorFingerprint()`/`fingerprintsEqual()`/`BEHAVIOR_VERSION`/`BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES`，公共导出经既有 barrel 暴露（决策 5，FR-001/FR-004/FR-008/FR-017/FR-018）。

**独立验证**：`npx vitest run src/panoramic/graph/collector-fingerprint.test.ts && npm run build`。

- [x] **T014** [P] 新建 `src/panoramic/graph/collector-fingerprint.test.ts`（TDD red 先行）：覆盖 SC-001（bump `BEHAVIOR_VERSION` 前后指纹不同半段）、SC-002（partial：新增测试专用扩展名后 `extensionSurface` 子分量自动变化半段）、SC-013（partial：公共导出可访问性——含从 barrel `index.ts` import 的用例 + 自身产出确定性半段）、SC-014（(a) spawn 两个独立 node 子进程序列化 byte-identical 对比，固定 `cwd`/`env`/入口脚本；(b) 序列化结构断言不含时间戳/绝对路径/平台相关路径分隔符）、SC-016（`BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 覆盖 FR-004 六类条件：ignore dirs 剪枝规则变化/`.gitignore` 规则解释变化/大小写匹配策略变化/symlink 处理策略变化/单文件 1MB size guard 调整/采集失败降级策略变化）；**FR-018 校验器逐类表格测试**（`isValidCollectorFingerprint` 覆盖类型错误/缺子字段/`formatVersion≠1`/空对象 `{}`/嵌套字段类型错误各至少一例，全部断言返回 `false` 且不抛异常）；**W-01 canonical 等价测试**（`fingerprintsEqual`：recorded 对象顶层键序打乱、`extensions` 数组元素乱序时仍判 `equal`；任一字段值实际不同时判 `not-equal`）
  验收：本任务提交后全部断言为 red（实现尚不存在）；FR-018 校验器表格 5 类样本齐备；canonical 等价测试正反例齐备
  依赖：T002

- [x] **T015** 新建 `src/panoramic/graph/collector-fingerprint.ts`：`CollectorFingerprint`/`CollectorExtensionSurface`/`CollectorExtensionSurfaceEntry` 类型；`computeCollectorFingerprint()`（固定字段顺序 `formatVersion→extensionSurface.{tsjsSkeletonWalk,pyWalk,genericAdapters(mergeSurfaces(JAVA,GO))，moduleDerivationScan}→behaviorVersion`，各 `extensions` 数组预排序，决策 6）；`isValidCollectorFingerprint(value: unknown): value is CollectorFingerprint`（逐层结构校验，`try/catch` 包裹属性访问，FR-018）；`fingerprintsEqual(a, b)`（canonical 结构化深比较，非 `JSON.stringify`，W-01）；`BEHAVIOR_VERSION` 常量 + `BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 结构化数组（覆盖 FR-004 六类条件）
  验收：T014 全部断言转绿
  依赖：T002, T014

- [x] **T016** [P] 修改 `src/panoramic/graph/index.ts`（既有 barrel）：新增 `computeCollectorFingerprint`/`isValidCollectorFingerprint`/`fingerprintsEqual`/`BEHAVIOR_VERSION`/`BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES`/`CollectorFingerprint` 类型的 re-export（决策 5/W-06）
  验收：T014 中"从 barrel import 可访问"用例转绿
  依赖：T015

- [x] **T017** Phase 2 独立验证：`npx vitest run src/panoramic/graph/collector-fingerprint.test.ts && npm run build`
  验收：零失败/零错误；SC 绿名单——SC-001（bump 半段）/ SC-002（partial）/ SC-013（partial）/ SC-014 / SC-016
  依赖：T013–T016

---

## Phase 3（原子兼容 Phase，`[ATOMIC-P3]`，T018–T033 不可拆分提交；T034/T035 说明见下）：判定重排 + 三写入点 + 消费方改造 + schema 升级

**目标**：`evaluateFreshness` 五级优先级重排 + `staleReasons`；三处写入点；`graph-quality.ts`/`graph-quality-core.mjs`/`graph-bootstrap-status.mjs` reason-aware 改造；`graph-quality-report.schema.json` 升级。**T018–T033 MUST 同一提交落地**（Codex plan 审查 C-01 裁决：拆分会产生签名已扩展但无写入点/无消费方的 fail-closed 断裂中间态）。**T034（SC-018 回归 oracle）经 Codex tasks 审查裁决移出原子组**——其验证的既有行为（旧 schemaVersion 判 `schema-too-old`）与本 Phase 判定重排逻辑解耦，依赖仅为"确认既有行为未被破坏"，可独立提交；但仍归入本 Phase 章节组织，且 T035（收口验证）的验证命令覆盖同一测试文件，故 T035 仍等待 T034 完成。

**独立验证（整体，非逐任务）**：`npx vitest run src/panoramic/graph/source-commit.test.ts tests/unit/graph-quality-core.test.ts tests/unit/graph-bootstrap-status.test.ts tests/integration/graph-quality-cli.test.ts tests/unit/contracts/graph-quality-report-schema.test.ts tests/unit/batch-orchestrator.test.ts tests/batch/graph-only-pipeline.test.ts tests/integration/graph-command-sourcecommit.test.ts src/panoramic/graph/collector-fingerprint.test.ts && npm run build`。**如实声明**：本 Phase 结束后本仓自身 `specs/_meta/graph.json` 仍无 `fingerprint`（未重建），`npm run repo:check` 出现 freshness warn（`source-commit` + `collector-fingerprint-unrecorded` 双原因）——这是预期过渡态，由 Phase 5 Closure 消解，MUST NOT 声称与改动前一致。

- [x] **T018** [ATOMIC-P3] [P] 修改 `src/panoramic/graph/graph-types.ts`：`GraphJSON.graph` 新增可选字段 `fingerprint?: CollectorFingerprint | null`
  验收：`npm run build` 类型检查通过；下游写入点（T022/T023/T024）可赋值
  依赖：T015

- [x] **T019** [ATOMIC-P3] [P] 修改 `src/panoramic/graph/quality/quality-types.ts`：新增 `FreshnessStaleReason` 类型（`'source-commit' | 'collector-fingerprint' | 'collector-fingerprint-unrecorded' | 'collector-fingerprint-invalid'`）；`GraphFreshnessVerdict` 新增可选字段 `staleReasons?: FreshnessStaleReason[]`
  验收：`npm run build` 类型检查通过；`state` 枚举本身不新增值
  依赖：无（可与 T018 并行）

- [x] **T020** [ATOMIC-P3] 修改 `src/panoramic/graph/source-commit.ts`：`evaluateFreshness` 签名扩展第三参数 `recordedFingerprint?: unknown`；五级优先级重排（(1) `recordedSourceCommit==null→unknown-provenance`；(2) `currentHead==null→unknown-provenance`；(3) 聚合 `staleReasons` 构造——`source-commit mismatch`→push、`recordedFingerprint==null`→push `collector-fingerprint-unrecorded`（FR-010）、否则 `!isValidCollectorFingerprint`→push `collector-fingerprint-invalid`（FR-018）、否则 `!fingerprintsEqual(...)`→push `collector-fingerprint`；`staleReasons.length>0→stale`；(4) dirty 判定沿用 T012 谓词；(5) `fresh`）
  验收：判定顺序与 SC-017（防守项 2）严格一致——固定非空 `recordedSourceCommit='abc123'` + `resolveSourceCommit` mock 返回 `null` 场景，指纹分别为合法/`undefined`/畸形三种输入，结果均为 `unknown-provenance`
  依赖：T012, T015, T019

- [x] **T021** [ATOMIC-P3] [P] 修改 `src/panoramic/graph/source-commit.test.ts`：补齐 SC-002（完整段：用扩展前指纹对扩展后版本运行 freshness 判定，结果非 `fresh`）/ SC-003（`recordedSourceCommit`/`currentHead` 均非空 + fingerprint=`undefined` → 100% stale + `collector-fingerprint-unrecorded`）/ SC-003b（`recordedSourceCommit` 缺失 → 100% `unknown-provenance`，不受 fingerprint 状态影响）/ SC-003c（fingerprint=`null` + `recordedSourceCommit` 非 null → `collector-fingerprint-unrecorded`，非 fresh、不抛异常）/ SC-004（完整段：fingerprint+sourceCommit 均一致 → 100% fresh）/ SC-007（commit 一致+fingerprint mismatch+工作树脏 → stale 非 dirty；多次运行 `staleReasons` 顺序一致）/ **SC-017（防守项 2 落地断言）**/ **SC-001 端到端断言（Codex tasks 审查补入，C-02）**：固定非空且与 `currentHead` 一致的 commit、工作树干净、`recordedFingerprint` 仅 `behaviorVersion` 为旧值（其余字段与当前一致）→ 断言 `state==='stale'` 且 `staleReasons` 恰为 `['collector-fingerprint']`
  验收：全部新增断言在 T020 完成后转绿；SC-001 端到端场景与 bump 半段（T014）共同构成 SC-001 完整覆盖
  依赖：T020

- [x] **T022** [ATOMIC-P3] [P] 修改 `src/batch/batch-orchestrator.ts`：紧邻既有 `sourceCommit` 赋值处插入 `fingerprint: computeCollectorFingerprint()` 写入（<5 行新增，FR-006）
  验收：`npx vitest run tests/unit/batch-orchestrator.test.ts` 本任务完成后不引入新失败（该文件对 `fingerprint` 字段值的完整断言由 T031 补齐，属预期顺序，非本任务遗漏）；SC-011 半段（batch 主链产出图含合法 fingerprint，`isValidCollectorFingerprint(graph.graph.fingerprint) === true`）
  依赖：T015, T018

- [x] **T023** [ATOMIC-P3] [P] 修改 `src/batch/stages/graph-assembly.ts`：`buildAstGraphOnly` 写入路径新增 `fingerprint: computeCollectorFingerprint()`（FR-006，与 batch 主链共用同一全局组合指纹，不按 `--mode` 区分）
  验收：`npx vitest run tests/batch/graph-only-pipeline.test.ts` 本任务完成后不引入新失败（完整断言由 T031 补齐）；SC-011 半段（graph-only 产出图含合法 fingerprint）
  依赖：T015, T018

- [x] **T024** [ATOMIC-P3] [P] 修改 `src/cli/commands/graph.ts`（`spectra graph` 命令）：`fingerprint` 字段写 `null`（对齐 F217 `sourceCommit` 诚实降级先例，FR-007）
  验收：`npx vitest run tests/integration/graph-command-sourcecommit.test.ts`（T033 补齐后）断言 `graph.graph.fingerprint === null`；SC-012
  依赖：T018

- [x] **T025** [ATOMIC-P3] [P] 修改 `src/cli/commands/graph-quality.ts`：`buildReport` 内 `evaluateFreshness` 调用新增第三参数传入 `graph.graph.fingerprint`；`buildNextSteps` 新增按 `staleReasons` 分支文案（区分 `source-commit`/`collector-fingerprint`/`collector-fingerprint-unrecorded`/`collector-fingerprint-invalid`）；`formatReportText` 的 `[freshness]` 行追加 `staleReasons` 展示；`computeOverallVerdict` 不变
  验收：`npx vitest run tests/integration/graph-quality-cli.test.ts`（T030 补齐后）逐场景断言 `buildNextSteps` 输出含对应 `staleReasons` 关键字（如 `collector-fingerprint-unrecorded` 场景输出文案含该字面量）；FR-011/FR-013；SC-009 CLI 文本/`--json` 消费面半段
  依赖：T018（`graph.graph.fingerprint` 字段须已存在才能读取），T020

- [x] **T026** [ATOMIC-P3] [P] 修改 `scripts/lib/graph-quality-core.mjs`：`freshness` check 段落 warning 文案改为按 `report.freshness.staleReasons` 拼接具体原因描述；`createCheck('freshness', ...)` 的 `evidence` 对象**同步**新增 `staleReasons: report.freshness.staleReasons ?? []` 字段透传（C-05：文案与 evidence 两处均须透传，缺一不可）
  验收：FR-012/FR-013；SC-009 repo:check 消费面半段（文案 + evidence 均覆盖）
  依赖：T020

- [x] **T027** [ATOMIC-P3] [P] 修改 `scripts/lib/graph-bootstrap-status.mjs`：`checkFreshness` 返回对象新增 `staleReasons: freshness.staleReasons ?? []` 透传字段；`FRESHNESS_STATES`/`ACCEPTED_FRESHNESS_EXIT_CODES` 不变
  验收：FR-013；SC-009 bootstrap-status 消费面半段
  依赖：T020

- [x] **T028** [ATOMIC-P3] [P] 修改 `specs/217-graph-quality-gates/contracts/graph-quality-report.schema.json`：`$defs.GraphFreshnessVerdict.properties` 新增 `staleReasons`（`type: array, items: {type: string, enum: [source-commit, collector-fingerprint, collector-fingerprint-unrecorded, collector-fingerprint-invalid]}`），`required` 不变（可选字段），`additionalProperties: false` 沿用不变
  验收：`node -e "const s=require('./specs/217-graph-quality-gates/contracts/graph-quality-report.schema.json'); if(s.$defs.GraphFreshnessVerdict.properties.staleReasons.items.enum.length!==4) throw new Error('enum count mismatch')"` 退出码 0；FR-009；见 `contracts/graph-quality-report-schema-delta.md`
  依赖：T019

- [x] **T029** [ATOMIC-P3] [P] [regression]（原 `[TDD-red-first]` 标签失实——本任务依赖 T028 已落地的 schema 结构与 T030 的真实场景输出，提交时机晚于其依赖，Codex tasks 审查裁决改标）新建 `tests/unit/contracts/graph-quality-report-schema.test.ts`（无 `ajv` 依赖，**手写递归结构校验器**，覆盖 `type`/`required`/`additionalProperties`/`items`/`enum` 五要素）：解析 schema.json；**校验对象改为 T030 场景产出的真实 CLI `--json` 输出样本**（而非手工构造 key 集合——直接复用 T030 中构造的 SC-009 五类样本，经真实 `graph-quality --json` 输出或等价内部函数调用产出后传入递归校验器）；断言每个真实样本经递归校验器判定符合 schema（`additionalProperties: false`/`required`/`items.enum` 均逐层校验，非仅浅层 key 集合子集判断）；`staleReasons` 数组元素逐一断言 ∈ schema `enum` 集合
  验收：`npx vitest run tests/unit/contracts/graph-quality-report-schema.test.ts` 在 T028+T030 完成后全部转绿；递归校验器本身有独立单测覆盖五要素各一条正反例
  依赖：T028, T030（校验对象需为 T030 场景产出的真实输出样本，非本任务自行构造）

- [x] **T030** [ATOMIC-P3] 更新 `tests/integration/graph-quality-cli.test.ts` + `tests/unit/graph-quality-core.test.ts` + `tests/unit/graph-bootstrap-status.test.ts`：既有 `:112`/`:125` 等期待 `fresh`/`pass` 的用例改为传入合法当前 `fingerprint`（否则因 FR-010 归入 `collector-fingerprint-unrecorded` 而不再是 `fresh`）；新增 SC-009 五类样本在四个消费面（CLI 文本/`--json`/repo:check warning+evidence/bootstrap-status）输出准确诊断文案的断言，顺序稳定性重复运行断言；SC-006（人工审查项）在本任务的 verification 记录中标注结论而非编造自动化断言
  验收：SC-009；SC-006 标注完成；本任务产出的 SC-009 五类样本 `--json` 输出对象供 T029 复用
  依赖：T025, T026, T027

- [x] **T031** [ATOMIC-P3] 更新 `tests/unit/batch-orchestrator.test.ts` + `tests/batch/graph-only-pipeline.test.ts`：断言 batch 主链与 graph-only 写入路径产出图 100% 含合法 fingerprint；与 `collector-fingerprint.test.ts` 交叉断言 byte-identical（SC-013 完整段）
  验收：SC-011（完整）/ SC-013（完整）
  依赖：T022, T023, T015

- [x] **T032** [ATOMIC-P3] **（Codex tasks 审查新增，FR-006 补卡）** 在 `tests/batch/graph-only-pipeline.test.ts` 新增 spy 回归测试：`vi.spyOn` module-derivation 模块导出的 `buildModuleGraphForProject`，运行 `buildAstGraphOnly(...)` 全流程后断言该 spy **全程未被调用**——锁定"`moduleDerivationScan` 管线仅 full batch 主链消费，graph-only 链路不触达"这一 FR-006 前提（该前提是 SC-002/SC-005 的护栏盲区判定基础，若被静默破坏而无专属断言，其余 SC 无法感知）
  验收：`npx vitest run tests/batch/graph-only-pipeline.test.ts -t "buildModuleGraphForProject"` 断言零调用次数；FR-006
  依赖：T031（同文件顺序编辑，避免并行冲突）

- [x] **T033** [ATOMIC-P3] [P] 更新/新建 `tests/integration/graph-command-sourcecommit.test.ts`：断言 `spectra graph` 命令产出图 `fingerprint` 字段为 `null`
  验收：SC-012
  依赖：T024

- [x] **T034**（**非原子组成员**，可独立提交——Codex tasks 审查裁决移出 `[ATOMIC-P3]`：本任务验证的既有行为（旧 schemaVersion 判 `schema-too-old`）与本 Phase 判定重排逻辑无耦合，仅需在同一测试文件内与本 Phase 其他改动共存验证）新增 SC-018 回归 oracle 断言（`tests/integration/graph-quality-cli.test.ts` 既有 `:200` 附近 schemaVersion=1.0 用例基础上核实/补充）：构造 schemaVersion=`1.0` 旧图 fixture（无论是否含 fingerprint 字段），验证 `graph-quality` CLI 100% 判定 `schema-too-old`，判定链路不进入 freshness/指纹比较分支
  验收：SC-018；确认既有 `MIN_SUPPORTED_SCHEMA_VERSION` 双边界行为未被本需求改变
  依赖：T030（同一测试文件，避免与 T030 的编辑产生冲突/覆盖彼此断言）

- [x] **T035** [ATOMIC-P3] Phase 3 整体验证（收口点；T018–T033 为不可拆分整体，T034 虽非原子成员但因验证命令覆盖同一测试文件而在此一并等待）：`npx vitest run src/panoramic/graph/source-commit.test.ts tests/unit/graph-quality-core.test.ts tests/unit/graph-bootstrap-status.test.ts tests/integration/graph-quality-cli.test.ts tests/unit/contracts/graph-quality-report-schema.test.ts tests/unit/batch-orchestrator.test.ts tests/batch/graph-only-pipeline.test.ts tests/integration/graph-command-sourcecommit.test.ts src/panoramic/graph/collector-fingerprint.test.ts && npm run build`
  验收：零失败/零错误；SC 绿名单——SC-001（完整）/ SC-002（完整）/ SC-003 / SC-003b / SC-003c / SC-004（完整）/ SC-006（人工）/ SC-007 / SC-009 / SC-011 / SC-012 / SC-013（完整）/ SC-017 / SC-018；如实记录本仓自身图仍无 fingerprint 的过渡态 warn；命令覆盖面已核实无漏（I-02 结论保留）
  依赖：T018–T034（全部）

---

## Phase 4：护栏资产 + 扰动注入测试组

**目标**：hermetic fixture + 两份 pinned 资产 + 双轨 vitest 护栏测试 + 扰动注入测试组（SC-010 三件套）+ 再生脚本（二元拒绝判据 + 备份/回滚写盘）。

**依赖边界（Codex tasks 审查裁决，C-01）**：本 Phase 拆为两类任务——**准备类**（T036–T042：fixture 源码、README、normalize helper、registry helper、typed loader、纯判据函数及其单测）不依赖 Phase 3 产物，可与 Phase 3 并行推进；**产物生成/护栏运行类**（T043 起：种子资产生成、再生脚本、双轨护栏测试、扰动注入、脚本级集成测试、npm script、耗时预算、Phase 4 收口）MUST 等待 **T035**（Phase 3 原子组收口）完成——理由：T043 生成的 pinned 种子资产依赖 `buildAstGraphOnly` 已写入 `fingerprint` 字段（T023，Phase 3 原子组内）且字段类型定义（T018，Phase 3 原子组内）已生效，Phase 3 未整体收口前这些写入点不保证处于最终形态，提前生成种子会在 Phase 3 收口后失效重生成。

**独立验证**：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts tests/unit/collector-fingerprint-regen-predicate.test.ts tests/integration/collector-fingerprint-regen-script.test.ts tests/unit/pinned-asset-swap.test.ts`；quickstart 两个演示作辅助直觉验证（非验收证据本体）。

**Phase 4 实施回写（实现期偏离与实测发现，逐条记账）**：

1. **T043 种子生成改经 T044 脚本的 `--init` 冷启动路径**（编排器 runtime context 明确授权"脚本应有首次生成路径或用 `--init` 语义"）。原卡设想"一次性手工调用生产函数"，但那会产出第二份与再生脚本平行的重建/归一化/写盘实现——正是 plan 决策 7 反复警告的镜像实现风险。`--init` 只跳过"前置一致性校验 + 拒绝判据"（此二者在无 pinned 资产时无参照物），重建与写盘走的仍是常规路径同一份代码；T039 registry bootstrap helper 的调用因此天然落在脚本内部可核实处（`rebuildTracks`），实现顺序变为 T044 → T043。
2. **T044 验收的 `git diff --exit-code` 判据改为 sha256 前后比对**：两份 pinned 资产在本 Phase 属**新增未跟踪**文件，`git diff` 对未跟踪文件恒无输出，用它验"字节不变"是空转断言。改用 `shasum -a 256` 前后对比（实测两次运行 digest 完全一致，脚本报"无需更新（未写盘）"、exit 0）。
3. **T046 fallback 用例断言按实测行为修正**：原卡设想 fallback 用例直接断言"产出的模块扫描扩展名集合 == SSoT"。实测发现两点——(a) guardrail fixture 只含 `.mjs` 一个 module 专属扩展，用它只能证明"⊆ SSoT"，要证明**相等**必须每个 SSoT 扩展各一样本，而 fixture 内容是 pinned 的、不能为此扩充（扩充等同基线变更）；故该断言改由专门的探针临时目录承载（8 个 SSoT 扩展各一样本 + `.py`/`.go` 负控），仍是端到端真实调用链路。(b) **空 registry fallback 产出的 `modules[].language` 缺席**（该字段由命中的 adapter 赋值，无 adapter 可归属），与 #7 路径的 `'ts-js'` 存在真实差异。原设想的"fallback 投影与 pinned 完全相等"断言若照写会红，若靠归一化剥掉 `language` 则是给护栏开盲区；最终改为**显式钉死该差异面**（fallback 全部 `undefined` / pinned 全部 `'ts-js'`）+ 剥离 `language` 后其余字段逐字段深度相等，未来任一侧行为反转都会变红。
4. **两轨比较器落位在再生脚本并由护栏测试 import**（`compareGraphOnlyStructure` / `compareModuleGraphSnapshot`）：沿用 plan Q5 对 `swapPinnedAssets` 的同类先例（"不新增独立 lib 文件，方便测试直接 import"）。理由与共用 normalize/registry/loader 一致——若"生成 pinned 时怎么比"与"护栏怎么比"分叉，护栏会静默退化为永久绿。未新增第四个 `tests/helpers/` 文件，plan Project Structure 的文件清单不变。
5. **T041 验收命令的 `require()` 改为动态 `import()`**：本仓 `package.json` 为 `"type": "module"`，`require()` 一个 `.mjs` 在 Node 20 会 `ERR_REQUIRE_ESM`（编排器 runtime context 亦明确要求 .mjs 一律 ESM 加载）。真值表四格实跑通过。
6. **T048 覆盖面在三分拒绝场景之外额外补三类**（均为脚本级子进程实跑）：(d) fixture 基线变更未 bump → 命中 `inputHashChanged` 那条诊断文案（原卡只要求"按 `fixtureInputHash` 状态区分两种文案"，但三分场景全部落在 `inputHashUnchanged` 一支，另一支若无用例即为零执行）；前置一致性校验两例（`fixtureInputHash` 彼此不一致 / 指纹畸形）；`--init` 冷启动两例（含"缺 pinned 但未加 `--init` 时必须非零退出而非静默重建基线"）。

- [x] **T036** [P] 新建 `tests/fixtures/collector-fingerprint-guardrail/src/{ts,py,java,go,module-only}/...`：`ts/foo.ts,foo.tsx,bar.js,bar.jsx`（#1 四扩展）、`py/mod.py,mod.pyi`（#2 两扩展）、`java/Foo.JAVA`（#3 大小写变体样本）、`go/main.go`（#3）、`module-only/entry.mjs`（#7/#8 专属扩展，内容钉死为 `import { foo } from '../ts/foo.ts'; export { foo };`，P10）
  验收：`src/` 子目录结构存在（`buildModuleGraphForProject` 优先扫描惯例）；`entry.mjs` 内容与 plan.md「护栏双轨设计」逐字一致
  依赖：无

- [x] **T037** [P] 新建 `tests/fixtures/collector-fingerprint-guardrail/README.md`：记录 fixture 用途 + **追加禁止事项（P17）**：同目录下禁止新增与既有大小写变体样本（如 `Foo.JAVA`）仅大小写不同的文件（如 `foo.java`），说明 macOS/Windows 大小写不敏感文件系统会静默覆盖导致跨平台不一致风险
  验收：README 含该禁止事项段落
  依赖：T036

- [x] **T038** [P] 新建 `tests/helpers/module-graph-snapshot-normalize.ts`：`normalizeModuleGraphSnapshot(graph): NormalizedModuleGraphSnapshot` 纯函数，将 `projectRoot` 替换为固定占位符 `<PROJECT_ROOT>`、`analyzedAt` 替换为固定 epoch 常量，保留 `modules[].language` 等其余字段（决策 7）
  验收：供 T046 b-track 护栏测试与 T044 再生脚本共同 import，非两份镜像实现
  依赖：无

- [x] **T039** [P] 新建 `tests/helpers/bootstrap-guardrail-registry.ts`（**落位 R4 防守项 5：registry 生命周期**）：导出 bootstrap helper，主用例场景（`beforeEach` `LanguageAdapterRegistry.resetInstance()` 后注册 ts-js adapter 覆盖 #7）与 fallback 用例场景（`resetInstance()` 后不注册覆盖 #8）；两类用例 `afterEach` 均调用 `resetInstance()` reset-to-empty（对齐 `tests/unit/batch-orchestrator.test.ts:71` 既有惯例，不做"重新标准 bootstrap"，决策 8/Q7）
  验收：供 T046 护栏测试与 T044 再生脚本（`try/finally` 包裹 + `finally` 同样 `resetInstance()`）共用同一份实现
  依赖：无

- [x] **T040** [P] 新建 `tests/helpers/pinned-asset-loader.ts`（**落位 R4 防守项 3：typed pinned loader**）：`loadPinnedGraphOnlyAsset(path): {fixtureInputHash, graph}` 与 `loadPinnedModuleGraphAsset(path): {fixtureInputHash, fingerprint, moduleGraph}`，内部各自校验顶层结构含 `fixtureInputHash: string` 字段（及各自的 `graph`/`fingerprint`+`moduleGraph`），缺失即抛错而非静默返回 `undefined`，作为读取两份 pinned 资产的唯一入口（决策 9/Q9）
  验收：T046/T047/T042/T044/T048 全部经此 loader 解包，禁止裸 `JSON.parse` 手写字段访问
  依赖：无

- [x] **T041** [P] 新建 `scripts/lib/collector-fingerprint-regen-predicate.mjs`：`shouldRejectRegen({ contentMismatch, fingerprintUnchanged }): boolean` 纯函数（二元判据：`contentMismatch ∧ fingerprintUnchanged → true`；`!contentMismatch → false`；`!fingerprintUnchanged → false`），Q1 处置，不保留三元判据残留
  验收：`node -e "const {shouldRejectRegen}=require('./scripts/lib/collector-fingerprint-regen-predicate.mjs'); const t=shouldRejectRegen({contentMismatch:true,fingerprintUnchanged:true})===true; const f1=shouldRejectRegen({contentMismatch:false,fingerprintUnchanged:true})===false; const f2=shouldRejectRegen({contentMismatch:true,fingerprintUnchanged:false})===false; const f3=shouldRejectRegen({contentMismatch:false,fingerprintUnchanged:false})===false; if(!(t&&f1&&f2&&f3)) throw new Error('truth table mismatch')"` 退出码 0；FR-005(e)
  依赖：无

- [x] **T042** [P] [regression]（原 `[TDD-red-first]` 标签失实——本任务依赖 T041 已存在的纯函数实现，真值表断言提交后立即转绿，Codex tasks 审查裁决改标）新建 `tests/unit/collector-fingerprint-regen-predicate.test.ts`：`shouldRejectRegen` 2×2=4 组合真值表全覆盖；`fixtureInputHash` 诊断文案分流（`inputHashUnchanged`/`inputHashChanged`）独立用例（不计入判定真值表单独测）
  验收：SC-010(b) 二元判据真值表部分；本任务提交后（T041 已存在）真值表断言立即转绿，诊断分流断言依赖 T044 才能完整转绿（先写 red，符合该分支的真实先行关系）
  依赖：T041

- [x] **T043** [P] 生成两份 pinned 期望资产初版种子数据 `tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json`（`{fixtureInputHash, graph}`，`graph` 为对 T036 fixture 跑 `buildAstGraphOnly` 的产物，`graph.graph.fingerprint` 记录当前 `computeCollectorFingerprint()`）与 `expected-module-graph.json`（`{fixtureInputHash, fingerprint, moduleGraph}`，`moduleGraph` 为对同一 fixture 跑 `buildModuleGraphForProject` 经 `normalizeModuleGraphSnapshot` 规范化后落盘）——通过一次性手工调用生产函数产出（非经 T044 脚本，脚本本身依赖已有 pinned 资产做前置一致性校验，此为冷启动种子）；**种子生成过程 MUST 使用 T039 的 registry bootstrap helper**（而非临时手写 registry 状态）以确保 #7/#8 两条路径的 registry 前置状态与后续护栏测试/再生脚本完全一致
  验收：两份资产均含合法 `fingerprint`/`fixtureInputHash`；`expected-module-graph.json` 含 `modules.length>0`/`edges.length>0` 且存在 `entry.mjs`→`foo.ts` 对应端点的边；生成脚本/临时代码中可核实到调用了 T039 导出的 bootstrap helper
  依赖：T036, T015, T038, **T035**（Phase 3 原子组收口——`buildAstGraphOnly` 的 `fingerprint` 写入路径与字段类型须已在最终形态）

- [x] **T044** 新建 `scripts/regen-collector-fingerprint-fixtures.ts`：① 计算 fixture `src/` 当前 `fixtureInputHash`（逐文件 `sha256(内容)`→按路径排序的 `[{path,contentSha256}]` canonical JSON→整体 `sha256`，Q1 修复版）；② 前置一致性校验（P11，经 T040 loader 解包，指纹结构合法+彼此相等+`fixtureInputHash`彼此相等，任一不满足报错退出）；③ 分别在临时目录重建 a-track/b-track 产物；④ 调用 T041 的 `shouldRejectRegen` 逐轨独立求值，任一轨拒绝则两份资产均不落盘，按 `fixtureInputHash` 状态分流打印诊断文案（诊断文案分流逻辑提取为可测纯函数 `selectRegenDiagnostic(inputHashChanged: boolean): string` 并导出，供 T042 直接单测该 seam，Codex tasks 审查裁决 W-01 补卡）；⑤ 放行时**备份+回滚写盘**（`swapPinnedAssets(pairs, fsImpl=fs)` 可注入 `fs` 的独立导出函数：备份 `.bak`→写临时文件+`rename`覆盖→清理 `.bak`；任一步失败逆序回滚，Q5）；registry bootstrap 包裹 `try/finally`，`finally` 调用 T039 的 `resetInstance()`；支持 `--fixture-root <path>` 参数覆盖入库路径
  验收：`npx tsx scripts/regen-collector-fingerprint-fixtures.ts --fixture-root tests/fixtures/collector-fingerprint-guardrail` 在无变更场景下 exit code 0 且两份 pinned 资产字节不变（`git diff --exit-code tests/fixtures/collector-fingerprint-guardrail/expected-*.json` 退出码 0）；FR-005(a)-(e)；T042 诊断分流断言转绿
  依赖：T038, T039, T040, T041, T043

- [x] **T045** [regression]（原 `[TDD-red-first]` 标签失实——本任务依赖 T044 已导出的 `swapPinnedAssets`，断言提交后针对已存在函数验证，Codex tasks 审查裁决改标）新建 `tests/unit/pinned-asset-swap.test.ts`（**落位 R4 防守项 6：swap 失败注入测试**）：注入"第二次 `rename` 失败"的 mock `fsImpl`，断言 (a) 已完成的第一份 rename 被回滚（内容还原为调用前原始字节）；(b) 两份正式 pinned 资产最终字节内容与调用前完全一致；(c) 不残留 `.tmp-*` 文件
  验收：`swapPinnedAssets` 导出函数存在后（T044）全部断言转绿
  依赖：T044

- [x] **T046** 新建 `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`（双轨基础比对用例）：**a-track**——`beforeAll` `fs.mkdtempSync` 复制 fixture `src/` 到临时目录→`buildAstGraphOnly(tmpDir)`→与经 T040 loader 解包的 `expected-graph-only-graph.json.graph` 做严格结构相等比较（节点 id 集合+边 multiset）+ `behaviorVersion` 相等断言；**b-track**——`buildModuleGraphForProject(tmpDir)`→`normalizeModuleGraphSnapshot`→与解包的 `expected-module-graph.json.moduleGraph` 深度相等比较，精确到 `modules.length>0`/`edges.length>0`+指定端点边（P10）+ `behaviorVersion` 相等断言；两 track 各自用 T039 helper 做独立临时目录 registry 隔离；**b-track fallback 场景（R4 防守项 5 完整覆盖）**——新增独立用例：使用 T039 fallback 场景 helper（`resetInstance()` 后不注册任何 adapter），断言此时 `buildModuleGraphForProject` 走 `module-derivation.ts` 的空 registry fallback 路径产出的模块扫描扩展名集合与 SSoT `MODULE_DERIVATION_SCAN_SURFACE.extensions` 一致（与 T007/T003 的静态 oracle 断言互补，此处验证端到端真实调用链路而非仅结构引用）
  验收：与 T043 种子资产比对全绿；fallback 用例断言产出集合与 SSoT 完全一致
  依赖：T038, T039, T040, T043, **T035**

- [x] **T047** [P] 在 `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 追加**扰动注入测试组**（落地 SC-010(a) 三件套，Q4）：①**比较器灵敏度证明**——对 a-track 真实重建产物注入语义扰动（删一条边/篡改节点 id），断言严格比较器必然报不一致；对 b-track 真实重建产物注入扰动（删一个 module/篡改一条边端点），断言深度比较必然报不一致；②**真实重建绿路径证明**——交叉引用 T046 既有基础用例（不重复实现），证明链路活性；③**拒绝纯函数真值表**——交叉引用 T042
  验收：SC-010(a) 三件套自动化证明齐备
  依赖：T046, T042

- [x] **T048** 新建 `tests/integration/collector-fingerprint-regen-script.test.ts`：脚本级子进程实跑（`--fixture-root` 参数隔离到临时副本），覆盖放行场景与**拒绝场景三分**（Codex tasks 审查裁决细化，W-05）——分别构造三种独立场景：**(a) a-track-only mismatch**（graph-only 重建产物与 pinned 不一致，b-track 一致）、**(b) b-track-only mismatch**（module producer 重建产物与 pinned 不一致，a-track 一致）、**(c) 双轨 mismatch**（两轨均不一致）；三场景均断言非零退出码 + stderr 含对应原因文案（按 `fixtureInputHash` 状态区分两种文案）+ 两份 pinned 资产文件字节内容不变
  验收：SC-010(b) 脚本级验收；三场景均有独立断言，非合并为单一"任意不一致即拒绝"的粗粒度断言
  依赖：T044, **T035**

- [x] **T049** [P] 修改 `package.json`：新增 npm script `"fixtures:regen:collector-fingerprint": "tsx scripts/regen-collector-fingerprint-fixtures.ts"`（P12）
  验收：`npm run fixtures:regen:collector-fingerprint` 可执行
  依赖：T044

- [x] **T050** 护栏耗时预算实测：实测 T046/T047 双轨（a-track/b-track 各自）在本 fixture 规模下的墙钟重建耗时——**基准口径（Codex tasks 审查裁决补齐，I-04）**：每轨各跑 3 次（N=3）取中位数，分别报告 a-track 与 b-track 各自的中位数毫秒数（不合并为单一数字），将实测数字回写 `plan.md` Performance Goals 一节（替换"以 tasks 阶段实测值为准"的占位表述）；同时核实 `computeCollectorFingerprint()` 本身 <10ms 预算是否达成（同样 N=3 取中位数）
  验收：`plan.md` Performance Goals 含 a/b 轨各自的具体实测中位数毫秒数（非占位文本，非合并单一数字），且不复用 self-dogfood ~3s 数据
  依赖：T046, T047

- [x] **T051** Phase 4 独立验证：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts tests/unit/collector-fingerprint-regen-predicate.test.ts tests/integration/collector-fingerprint-regen-script.test.ts tests/unit/pinned-asset-swap.test.ts`；手动跑 `quickstart.md` 拒绝/放行两个演示作辅助直觉验证（非验收证据本体，Q10）
  验收：SC 绿名单——SC-005（b 完整）/ SC-010（三件套自动化证明 + 二元判据真值表达成）
  依赖：T036–T050, T035

---

## Phase 5：Closure

**目标**：本仓自身图重建落 fingerprint，`repo:check` freshness 从 Phase 3 声明的过渡态 warn 恢复 `pass`。

- [x] **T052** 确认前置条件：Phase 1–4（T001–T051）全部任务已完成、对应测试全绿——汇总核对清单，非代码改动
  验收：核对四个 Phase 的独立验证任务（T013/T017/T035/T051）均已通过
  依赖：T013, T017, T035, T051

- [x] **T053** `npm run build`
  验收：零类型错误
  依赖：T052

- [x] **T054** `node dist/cli/index.js batch . --mode graph-only`（重建本仓图，落 `fingerprint` 到 `specs/_meta/graph.json`）
  验收：`specs/_meta/graph.json` 的 `graph.graph.fingerprint` 含当前 `computeCollectorFingerprint()` 结果
  依赖：T053

- [x] **T055** 全量最终验证（**落位「tasks 阶段新增防守」Phase 5 Closure 时序**）：`npx vitest run && npm run build && npm run repo:check`
  验收：全部零失败/零错误；`repo:check` 的 freshness check 从 Phase 3 声明的过渡态 unrecorded/stale warn 恢复 `pass`；显式确认"commit 后 HEAD 前进、本地图再转 stale"是本仓既有稳态非缺陷（不在本任务内额外补循环）；**FR-014 越权改动检查（Codex tasks 审查裁决补齐）**：`git diff --name-only <base>..HEAD` 输出**不含** `src/watch/file-watcher.ts`（#9 watch 触发面）与 `src/core/import-resolver.ts`（#10 import 解析层）——确认实现期未触碰 spec 已显式声明 out-of-scope 的两处收敛点；**SC-006 持久化落点**：在 `verification/verification-report.md` 固定小节"SC-006 人工审查记录"中写入 T030 阶段人工核对 `buildNextSteps`/`graph-quality-core.mjs` warning 文案严重度措辞的结论（不低于 sourceCommit 型 stale）；最终 commit 由编排器执行（本任务止于验证，不涵盖 commit 动作）。**执行者/证据回写（验证闭环子代理，2026-08-03）**：T052 编排器历史累积核对（全量 vitest 6394/0）；T053/T054 编排器历史执行（build 零错误 + 图五 key 指纹落 `specs/_meta/graph.json`）；T055 本轮验证闭环子代理独立执行（`npx vitest run` 6394 passed 0 failed / `npm run build` 零错误 / `npm run repo:check` 86/86 pass）；FR-014 越权检查已用正确路径 `src/watcher/file-watcher.ts`（非任务卡 typo 路径 `src/watch/`）+ `src/core/import-resolver.ts` 重验零命中；SC-006 落点已写入 `verification/verification-report.md`「c. SC-006 人工审查记录固定小节」。详见 `verification/verification-report.md`。
  依赖：T054

---

## Phase 6：Codex 提交前对抗审查修复轮（2026-08-03，3 CRITICAL + 7 WARNING 逐条裁决后执行）

**目标**：闭合提交前 Codex 对抗审查的 3C+7W，全部改动不 commit（等编排器裁决后统一提交）。
**注**：本 Phase 由 Codex 审查驱动、编排器逐条裁决，不属于原 55 任务分解；编号续接以保持单一任务台账。

- [x] **T056** [C-001] `isValidCollectorFingerprint` 严格 key 集合校验：`extensionSurface` 的 own key 集合 MUST 精确等于全部已知管线 key（与 T060 联动后为 5 个）；同因扩展至顶层与管线条目层（如实登记为超出裁决字面的收窄，见 verification 报告）
  验收：`src/panoramic/graph/collector-fingerprint.test.ts` 新增「key 集合不等」畸形类（`extensionSurface.shadow` / 顶层多字段 / 条目多字段）全判 invalid；`source-commit.test.ts` 端到端断言 shadow 管线指纹 → `stale` + `collector-fingerprint-invalid`（不再可能 fresh）；代码注释改写为"未知 key 是忘 bump formatVersion 时静默假 fresh 的通道"
  依赖：无（推翻 Phase 2 偏离 3 的"未知 key 宽容"裁决）

- [x] **T057** [C-002] 再生脚本 `--init` 收紧：仅当两份 pinned 资产**均不存在**时允许；任一存在即拒绝并非零退出；常规失败文案按"双缺席 / 格式演进 / 疑似篡改"三分，仅双缺席场景提示 `--init`
  验收：`tests/integration/collector-fingerprint-regen-script.test.ts` 新增 3 条 C-002 反例（双资产存在 + `--init` → 拒绝且字节不变；仅缺一份 + `--init` → 拒绝；仅缺一份且未加 `--init` → 文案含"MUST NOT 用 --init"）
  依赖：无

- [x] **T058** [C-003] `swapPinnedAssets` 提交点语义：两份正式文件 rename 全部成功 = 逻辑提交点，之后 `.bak` 清理失败**不回滚**（回传 warning、退出码 0）；提交点前失败逐项 best-effort 回滚，回滚自身失败时错误显式标注 `incomplete` 且不吞首因
  验收：`tests/unit/pinned-asset-swap.test.ts` 新增 4 条（提交点后 `.bak` rm 失败 ×2、回滚 rename 失败 → incomplete、备份缺失回滚 → incomplete）；成功路径断言 `warnings` 为空数组
  依赖：无

- [x] **T059** [W-001] bootstrap shell 文案 reason-aware：`graph-bootstrap-status.mjs` 新增导出 `buildFreshnessDiagnostic()` 并在 `checkFreshness` 回传 `freshnessDiagnostic` 完整诊断串；`sync-worktree-local-state.sh` 的 `stale)` 分支原样打印该字段（shell 不再自行拼装原因，字段缺席时回落到通用告警）
  验收：`tests/unit/graph-bootstrap-status.test.ts` 新增四类单原因 + 多原因 + 空原因 + 未知原因 + shell 危险字符 8 条单测；`tests/unit/sync-worktree-local-state.test.ts` 新增 5 条 shell E2E（指纹型 stale 文案不含 `sourceCommit`）
  依赖：无

- [x] **T060** [W-002] 第六条生产管线纳入 SSoT（如实记账现状，不改行为）：新增 `PYTHON_SYMBOL_SCAN_SURFACE`（`['.py']` / case-sensitive endsWith，按 `scanPyFiles` 现状）、进 `ALL_PRODUCER_SURFACES` 与 `extensionSurface` 第五 key `pythonSymbolScan`；python adapter 声明面改引用 `PY_WALK_SURFACE.extensions`（**不**收窄——收窄会改 registry 对 `.pyi` 的分派行为），声明面/扫描面失配在注释与测试中显式记账；`scanPyFiles` 行为不变
  验收：`tests/unit/collector-surface.test.ts` 新增 a1 引用同一性 + 两面差异断言 + 行为探针（`mod.py` 命中 / `mod.pyi` 不命中 + 同目录 `walkPyFiles` 确实收 `.pyi`）；四 key 字面量同步为五 key（指纹单测 / charter 快照 ×9 / pinned 双资产 / 本仓图）
  依赖：T056（严格 key 集合以本任务的 5 key 为准）

- [x] **T061** [W-004] matcher 语义保真分派：SSoT 新增 `surfaceMatchesFile()`，endsWith 族用 `name.endsWith(ext)`、extname 族用 `path.extname().toLowerCase()`（SSoT 因此 import `node:path`，FR-019 允许 Node 内建）；dirty 谓词改用该入口，`surfaceHasExtension` 保留给只有扩展名的分派型消费方（ignore-oracle）并标注适用边界
  验收：`tests/unit/collector-surface.test.ts` 新增纯点文件命中矩阵（`.ts`/`.go`/`.java`/`.mjs`/`.py` × 五条真实 producer 逐一对拍 + 活性对照）+ `surfaceMatchesFile` 真值表 + `path.extname` 口径对拍；`source-commit.test.ts` 新增 3 条 dirty 端到端（`.go` 不触发、`.ts`/`.py` 触发）
  依赖：T060

- [x] **T062** [W-005] 单次 snapshot 化防 stateful getter：新增 `parseCollectorFingerprint(value): CollectorFingerprint | null`（单个 try/catch 内一次性解析为 plain snapshot，accessor 形态一律归 invalid），`isValidCollectorFingerprint` 退化为其布尔投影；`evaluateFreshness`/再生脚本前置校验改为消费 snapshot，不再二次访问原对象
  验收：新增对抗 getter 测试（首次合法二次抛错 → invalid、getter 调用次数 0、`evaluateFreshness` 不抛）+ snapshot 物理独立性 4 条；barrel 同步 re-export
  依赖：T056

- [x] **T063** [W-006] `json-schema-subset-validator.ts` own-property 化：`key in properties` / `key in value` 全部改 `Object.prototype.hasOwnProperty.call`
  验收：`tests/unit/contracts/graph-quality-report-schema.test.ts` 新增 `constructor`/`toString`/`valueOf`/`hasOwnProperty`/`__proto__` 注入反例（`additionalProperties:false` 必拒）+ required 侧 2 条 + 活性反面 1 条
  依赖：无

- [x] **T064** [W-007] a-track 节点侧改 multiset 计数比较（原 Set 会把重复节点折叠成"一致"）
  验收：`tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 新增"重复一个节点 → 报节点计数不一致"+"仅顺序不同 → 仍判一致"两条
  依赖：无

- [x] **T065** [I-001/I-003] 小项：community 写回出口保留 `fingerprint` 的显式回归测试（`tests/panoramic/community-persist.test.ts`，真实跑 `writeKnowledgeGraph`）；`graph-quality` `--help` 的 freshness 描述改为 commit + collector fingerprint 双维
  验收：回归测试断言写回后 `graph.fingerprint` 深相等且仍合法、`sourceCommit` 存活、community 注入确实发生
  依赖：无

- [x] **T066** 修复轮连锁与全量重验：pinned 双资产重生（指纹形状变化 → 旧资产按当前格式不可解析，按脚本新增的"格式演进"指引删除双资产后 `--init` 重建，随后常规再生判"无需更新"以证自洽）+ 本仓图重建（五 key 指纹）+ charter 快照 ×9 定向更新（差异经 before/after diff 核验为纯 `pythonSymbolScan` 增量、无其他漂移）
  验收：`npm run fixtures:regen:collector-fingerprint`（无需更新）、`npm run build`（零错误）、`node dist/cli/index.js batch . --mode graph-only --output-dir specs`（6229 节点 / 9682 边）、`npx vitest run`（6394 passed / 0 failed / 502 文件）、`npm run repo:check`（status=pass，86 项全 pass）
  依赖：T056–T065

**独立验证（整体）**：见 T066 验收数字。放行路径另补脚本级证据（`tests/integration/collector-fingerprint-regen-script.test.ts` 新增"pinned 指纹合法但与当前不等 → exit 0 + 重写为当前指纹"），使"指纹已变即放行"不再只靠一次人工观察。

---

## FR 覆盖映射表

| FR | 覆盖任务 |
|----|---------|
| FR-001（三分量结构） | T014, T015 |
| FR-002（extensionSurface 按管线记录 + #4/#5/#6 引用收敛） | T002, T004–T010, T014, T015 |
| FR-003（dirty 判定按管线谓词） | T011, T012 |
| FR-004（behaviorVersion 常量 + 结构化 bump 责任清单） | T014, T015（SC-016） |
| FR-005（双轨重建-对比护栏 a-e） | T036–T051 |
| FR-006（两条路径写入指纹 + moduleDerivationScan 仅 full 消费声明） | T022, T023, **T032**（spy 回归锁定该前提，Codex tasks 审查补卡） |
| FR-007（`spectra graph` 写 null） | T024 |
| FR-008（公共导出） | T015, T016 |
| FR-009（五级优先级 + staleReasons + schema 升级） | T018, T019, T020, T028, T029 |
| FR-010（fingerprint 缺失 → stale unrecorded） | T020, T021 |
| FR-011（CLI 告警级别不低于 sourceCommit） | T025, T030（SC-006 人工审查） |
| FR-012（repo:check warn） | T026 |
| FR-013（reason-aware 四消费面） | T025, T026, T027, T030 |
| FR-014（#9/#10 显式排除范围） | T001（复扫无越权改动）+ **T055**（git diff 路径检查，实现期未触碰 `file-watcher.ts`/`import-resolver.ts`，Codex tasks 审查补齐可执行验收） |
| FR-015（YAGNI 移除：自动重建） | N/A——按 YAGNI 移除，不生成任务 |
| FR-016（YAGNI 移除：多版本兼容解析） | N/A——按 YAGNI 移除，不生成任务 |
| FR-017（确定性序列化） | T015（SC-014） |
| FR-018（畸形指纹 invalid） | T014（校验器逐类表格测试，Codex tasks 审查补齐）, T015, T020, T021 |
| FR-019（零依赖叶子模块） | T002, T003（SC-015） |

## 防守落位映射（plan.md R4 十项原编号 + 落实状态）

> Codex tasks 审查裁决：原"8 项防守"编号为 tasks 阶段自创、与 plan.md R4 真实十项不对应，已废弃该编号，改为逐项映射 plan.md「风险与回滚」章节的 R4 十项原编号；四项此前判定"部分落实"的条目（#3/#5/#9/#10）已在下方任务描述中补齐。

| R4 # | 防守项（plan.md 原文） | 落位任务 | 状态 |
|------|------------------------|----------|------|
| 1 | SC-015 静态依赖 oracle 语法覆盖 | T003 | 完整落实 |
| 2 | SC-017 前置条件 | T020, T021 | 完整落实 |
| 3 | #4/#5/#6 双面校验（结构引用 `===` + 实跑各管线真实函数） | T003 | **本轮补齐**：T003 已钉死 #1/#2/#5/#6/#8 各自的具体入口函数（`walkTsJsFiles`/`walkPyFiles`/`createIgnoreOracle`/`scanSourceFiles`/`module-derivation.ts` fallback）与精确输出 oracle（不再是"不抛错"级别断言） |
| 4 | b-track ModuleGraph 规范化投影 + fixture 断言精确化 | T038（normalize helper）, T046（guardrail 测试端点精确断言） | 完整落实 |
| 5 | registry 状态隔离（reset-to-empty，主/fallback 用例分离） | T039（helper）, T044（regen 脚本 `try/finally`）, T046 | **本轮补齐**：T046 新增显式"空 registry fallback 用例"（`resetInstance()` 后不 bootstrap），断言 fallback 路径产出集合与 SSoT 一致 |
| 6 | 再生脚本双资产写盘（备份+回滚） | T044（`swapPinnedAssets`）, T045（失败注入单测） | 完整落实 |
| 7 | staleReasons 全消费面同步 | T025, T026, T027, T028, T029, T030 | 完整落实 |
| 8 | 确定性测试环境钉死（固定 cwd/env/入口脚本） | T014（SC-014a） | 完整落实 |
| 9 | 再生脚本拒绝判据可测性 | T041（判据纯函数）, T042（真值表单测）, T048（脚本级集成测试） | **本轮补齐**：T048 拒绝场景由单一粗粒度断言细化为 a-track-only / b-track-only / 双轨 mismatch 三分场景，各自独立断言退出码/文案/资产字节不变；SC-006 落点同步固化到 T055（`verification-report.md` 固定小节） |
| 10 | 指纹比较 canonical 化 | T014（canonical 等价测试）, T015（`fingerprintsEqual` 实现） | **本轮补齐**：T014 新增键序/数组顺序打乱仍判 equal、字段值差异判 not-equal 的正反例测试 |

## tasks 阶段新增防守（不属于 plan.md R4 十项，为 tasks 分解阶段新引入的落地纪律）

| 防守项 | 落位任务 |
|--------|----------|
| typed pinned loader（`tests/helpers/pinned-asset-loader.ts`，Q9） | T040 |
| Phase 3 原子性（T018–T033 不可拆分，T034 移出原子组独立可提交，T035 收口） | T018–T035（详见 Phase 3 章节头部说明） |
| Closure 时序（重建图→全量验证→FR-014 越权检查→SC-006 落点） | T052–T055 |
| T4 文档一致性清理（plan.md 6/8/10/26 行 + spec.md 21 行"三元→二元"残留） | T001 |

## User Story ↔ SC ↔ Task 映射（组织参考，非并行 Phase 拆分依据）

| User Story | 优先级 | 核心 SC | 完整达成所在 Phase |
|-----------|--------|---------|-------------------|
| US1（旧图升级后必须获得"需重建"信号） | P1 | SC-001, SC-004, SC-011, SC-012, SC-013, SC-014, SC-017 | Phase 3（T035）完整；Phase 1/2 落 partial |
| US2（维护者扩展采集面/变更行为时有结构化落点） | P1 | SC-002, SC-005, SC-008, SC-010, SC-015, SC-016 | Phase 4（T051）完整；Phase 1/2/3 落 partial |
| US3（存量旧图诚实降级） | P1 | SC-003, SC-003b, SC-003c, SC-009 | Phase 3（T035）完整 |

---

## Dependencies & Execution Order

### Phase 依赖关系

- Phase 1（T001–T013）：无外部依赖，可立即开始；T001 文档清理与 T002 SSoT 新建互不依赖，可并行
- Phase 2（T014–T017）：依赖 Phase 1 的 T002（`collector-surface.ts` 必须存在）；不依赖 Phase 1 其余任务
- Phase 3（T018–T035）：依赖 Phase 2 全部完成（`collector-fingerprint.ts` 公共导出）+ Phase 1 的 T012（dirty 谓词）；**T018–T033 MUST 同一提交，不可拆分**；T034 可独立提交；T035 是收口验证点
- Phase 4：**依赖边界一分为二（Codex tasks 审查裁决，替换此前"整体可与 Phase 3 并行"的错误描述）**——准备类任务 T036–T042（fixture 源码/README/normalize helper/registry helper/typed loader/纯判据函数及其单测）依赖 Phase 2 的 T015 与 Phase 1 的 T002（部分任务无外部依赖），**不依赖 Phase 3**，可与 Phase 3 并行推进；产物生成/护栏运行类任务 T043 起（种子资产生成、再生脚本、双轨护栏测试、扰动注入、脚本级集成测试、耗时预算、Phase 4 收口）**依赖 T035**（Phase 3 原子组收口——`buildAstGraphOnly` 的 `fingerprint` 写入路径 T023 与字段类型定义 T018 均在 Phase 3 原子组内，未收口前不保证最终形态）
- Phase 5（T052–T055）：依赖 Phase 1–4 全部完成

### 并行机会

- Phase 1：T001, T002, T003（T002 之后）, T004–T010（T002 之后）, T011（T002 之后）均可并行；T012 依赖 T011
- Phase 2：T014 依赖 T002（不与 T002 并行，但可在 T002 完成后立即开始，与 Phase 1 其余任务并行推进）；T015 依赖 T014；T016 依赖 T015
- Phase 3：T018/T019/T021/T022/T023/T024/T025/T026/T027/T028 之间大量可并行（不同文件）；T029 依赖 T028+T030（跨阶段，非本组内并行）；T030 依赖 T025/T026/T027；T031 依赖 T022/T023/T015；T032 依赖 T031（同文件顺序编辑）；T033 依赖 T024；T034（非原子组）依赖 T030；整体验证与提交必须等待 T018–T033 全部完成（原子约束），T035 额外等待 T034
- Phase 4：**T036/T037/T038/T039/T040/T041/T042 之间**——T036 无依赖；T037 依赖 T036；T038/T039/T040/T041 互不依赖、可与 T036/T037 并行；T042 依赖 T041（真值表可立即绿，诊断分流断言待 T044 才能完整转绿，但本任务本身不依赖 Phase 3）；此七项（T036–T042）均可与 Phase 3 并行推进（准备类，不触达 Phase 3 产物）。**T043 起依赖 T035**：T043 依赖 T036+T015+T038+T035；T044 依赖 T038/T039/T040/T041/T043；T045/T049 依赖 T044；T046 依赖 T038/T039/T040/T043/T035；T047 依赖 T046/T042；T048 依赖 T044/T035；T050 依赖 T046/T047

**统计**：55 个任务，标注 `[P]` 的任务 35 个（约 64%）。

## Implementation Strategy

### 分阶段推进（对齐 plan.md HIGH 风险强制分阶段要求）

1. 完成 Phase 1 → 独立验证（T013）→ 可独立提交
2. 完成 Phase 2 → 独立验证（T017）→ 可独立提交
3. 完成 Phase 3（T018–T033 原子提交，不可拆分；T034 可独立提交；T035 整体验证收口）→ 单次提交（T018–T033）
4. 完成 Phase 4 准备类任务（T036–T042，可与 Phase 3 并行）；T043 起的产物生成/护栏运行类任务等待 T035 完成后开始 → 独立验证（T051）→ 可独立提交
5. 完成 Phase 5（Closure）→ 全量验证（T055）→ 最终 commit（编排器执行）

### MVP 边界

若需要更早交付最小可用信号（不追求护栏机制完整性），MVP 范围可界定为 **Phase 1 + Phase 2 + Phase 3**（US1 + US3 完整达成，US2 的结构化落点存在但护栏软提示机制尚未接线）——但 spec.md 已明确 US1/US2/US3 均为 P1 优先级、缺一不可（"这与 P1 同等关键，缺一不可"），因此不建议实际按此 MVP 边界单独发布，仅作为紧急场景下的降级参考。
