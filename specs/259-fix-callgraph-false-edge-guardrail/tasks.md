---
description: "Task list for F259 fix: 调用图确定性假边收口 + collector 指纹护栏 py 侧盲区补齐"
---

# Tasks: F259 调用图确定性假边收口 + collector 指纹护栏 py 侧盲区补齐

**Input**: `specs/259-fix-callgraph-false-edge-guardrail/fix-report.md`（5-Why 根因）、
`specs/259-fix-callgraph-false-edge-guardrail/plan.md`（技术规划）
**模式**: FIX（无 User Story，按「缺陷 1 / 缺陷 2 / 回归护栏 / 记账 / 全量验证」组织）
**审查档位声明**：本清单所有 implement 阶段 commit 须延续 fix-report/plan 顶部声明——
Codex 配额耗尽期按 `CLAUDE.local.md` 暂停节执行「独立子代理异构对抗 ≥2 切入角」，
commit message 显式标注「Codex 审查暂停，异构档位缺席」。

## Format: `[ID] [P?] [D1/D2?] Description`

- **[P]**: 可并行（不同文件、无依赖）
- **[D1]**: 缺陷 1（确定性假边）相关任务
- **[D2]**: 缺陷 2（护栏盲区）相关任务
- 无标记：跨缺陷的回归护栏 / 记账 / 全量验证任务

---

## Phase 1: 缺陷 1 — call-resolver.ts 确定性假边（红用例先行）

**目标**：`require('./dep.js')` 不再用 lastSeg/moduleSpecifier 兜底别名覆写同名静态绑定
（如 `import { js } from './lit.js'`），消除两端皆真实节点的确定性假边；同时不损失
`deriveImportEdges` 产出的 depends-on 边。

**独立验证**：`npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts` 全量绿，
且 F259 新增用例在改动前必须先红。

- [x] T001 [D1] 红用例先行：在 `tests/unit/knowledge-graph/call-resolver.test.ts` 新增
  `F259` 专属 describe 块（或追加到既有 `F242 复审轮 修复 2` 块），构造 skeleton 含
  `import { js } from './lit.js'`（static，`namedImports: ['js']`）+ `require('./dep.js')`
  （`commonjs-require`，无绑定名），断言：
  (a) `buildImportIndex(...).aliasToTarget.get('js')` 等于静态绑定目标（非 require 目标）；
  (b) `resolveCalls` 对 `js()` 调用产出的边 `target` 指向静态绑定文件，**不**产出指向
  require 目标的 `::js` 假边。
  在**未改动 `call-resolver.ts`** 的当前基线上执行
  `npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts -t "F259"`，
  **验收判据**：该用例必须失败（FAIL），并将失败输出（实际 target 值）记入本任务的实现备注，
  证明用例真实复现 fix-report 探针的 bug，而非自证式必然通过。

- [x] T002 [D1] 依赖 T001：在 `src/knowledge-graph/call-resolver.ts` 的
  `buildImportIndex` 第一遍循环（约 L272-274）实施改动点 1——把兜底触发判据从
  `if (!hasBindingNames(imp))` 改为 `if (!hasBindingNames(imp) && imp.importType === undefined)`。
  **验收判据**：`git diff src/knowledge-graph/call-resolver.ts` 仅含该行判据变更；
  重跑 T001 用例的 (a)(b) 断言均转绿。

- [x] T003 [D1] 依赖 T002：在 `src/knowledge-graph/call-resolver.ts` 的
  `registerSpecifierFallback` 函数体内实施改动点 2（双保险防御）——把无条件 `.set()`
  改为 `if (!aliasToTarget.has(lastSeg)) aliasToTarget.set(...)` 与
  `if (!aliasToTarget.has(imp.moduleSpecifier)) aliasToTarget.set(...)` 两行守卫，
  确保该函数任何调用路径都不覆写已存在的 alias（含同循环内更早写入的静态绑定）。
  **验收判据**：新增一条独立单测（可并入 T001 所在 describe 块），直接调用
  `registerSpecifierFallback` 两次、传入相同 `lastSeg` 不同 `target`，断言
  `aliasToTarget` 保留第一次写入的值；用例绿。

  > ⚠️ **已撤回**（implement 阶段内部对抗复审裁定 2，2026-08-06）：本任务描述的"双保险防御"
  > 代码改动**未落地**，`registerSpecifierFallback` 保留原样无条件 `.set()`；对应单测已删除
  > （非"用例绿"，而是不存在）。撤回原因：改动点 1 落地后实际作用面只剩 Python，且该防御会
  > 在 `import pkg.util` + `import util` 场景**新造 Python 假边**（first-write-wins 挡下正确
  > 的后写入绑定）。上方勾选 `[x]` 保留不改（T003 对应的"评估该方案是否可行"这一验证工作
  > 确实做了，结论是否决），完整实证见 `implementation-notes.md` Phase 1「T003 双保险防御
  > （改动点 2）——已撤回」节。

- [x] T004 [P] [D1] 回归用例：新增单测断言 `require('./dep.js')` 场景下
  `deriveImportEdges` 产出的 `depends-on` 边（`src/caller.ts → src/dep.ts`）
  不受 T002/T003 改动影响，仍存在。**验收判据**：用例绿；在 T002 改动前后各跑一次，
  两次均绿（证明该边确实与 `aliasToTarget` 无耦合，非被动通过）。

- [x] T005 [P] [D1] 副作用回归用例：新增单测覆盖 TS 静态 side-effect-only import
  （`import './x.css'`，无 named/default/namespace），断言其不再向 `aliasToTarget`
  注册 `x`（lastSeg）类垃圾别名（`importType==='static'` 已定义，同口径关闭）。
  **验收判据**：在 T002 改动前跑该用例为红（旧行为会注册），改动后为绿；两次结果均记入
  实现备注。

- [x] T006 [D1] 依赖 T002-T005：全量重跑
  `npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts`，
  **验收判据**：全部 1785+ 行既有用例（含 F242 两轮修订用例、Python 7 case）逐字保持绿，
  尤其 L1770-1784 回归锚 `(c) 回归锚 — 静态无绑定 import 的 specifier 兜底保持不变
  （Python import X 路径）` 必须绿且断言值不变；新增 T001/T004/T005 三条用例全绿；
  终端输出的 pass 计数需在 commit message / 实现备注中记录。

**Checkpoint**：缺陷 1 修复完成且可独立验证——假边消除、depends-on 边未损、Python
路径行为逐字不变。

---

## Phase 2: 缺陷 2 — collector-fingerprint-guardrail py 侧盲区（红用例先行）

**目标**：护栏对 `#2 pyWalk` 管线（区别于 `#11 pythonSymbolScan`）具备独占可见性，
探针 C（整体剔除 `pythonSkeletons`）必须能让护栏变红。

**独立验证**：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`
全量绿，且新增的隔离对照用例可复现探针 C 的因果链。

- [x] T007 [P] [D2] 新增 fixture 样本
  `tests/fixtures/collector-fingerprint-guardrail/src/py/producer.py`
  （内容：`def make() -> int: return 42`，附中文注释说明「#2 pyWalk 独占覆盖样本」）。
  **验收判据**：文件存在，语法可被 Python parser 正常解析（无缩进/语法错误）。

- [x] T008 [P] [D2] 新增 fixture 样本
  `tests/fixtures/collector-fingerprint-guardrail/src/py/consumer.py`
  （内容：`from .producer import make` + `def use() -> int: return make()`，
  附中文注释说明与 producer.py 构成真实 py→py 依赖）。
  **验收判据**：文件存在；`from .producer import make` 为单点相对 import（level=1），
  与 T007 文件同目录。

- [x] T009 [D2] 依赖 T007、T008：在
  `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 的 a-track 覆盖面用例中
  新增断言（扩展现有"覆盖 #1 六扩展 + #2 两扩展 + #3 大小写变体样本"用例，或新增同级用例）：
  `rebuiltGraph.links` 中存在
  `{ source: 'src/py/consumer.py', target: 'src/py/producer.py', relation: 'depends-on' }`
  与
  `{ source: 'src/py/consumer.py::use', target: 'src/py/producer.py::make', relation: 'calls' }`
  两条**具体端点**边（禁止仅断言"边数非空"）。
  **验收判据**：新增断言写入测试文件，暂不关心此时是否通过（下一任务验证）。

- [x] T010 [D2] 依赖 T009：红用例先行验证——在**当前 master 基线**（pinned 资产
  `expected-graph-only-graph.json`/`expected-module-graph.json` 尚未再生）上执行
  `npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`。
  **验收判据**：T009 新增的两条具体边断言必须失败（pinned 资产里没有这两条边，
  fixture 目录里却已有 producer.py/consumer.py 导致 fixtureInputHash 不匹配或断言查找不到边），
  将失败输出记入实现备注，证明断言确在测真实缺口。

- [x] T011 [D2] 依赖 T010：执行 `npm run fixtures:regen:collector-fingerprint` 再生两份
  pinned 资产。**验收判据**（逐项核对，写入实现备注）：
  (a) `expected-graph-only-graph.json` 新增恰好 2 个 module 节点、2 个 component 节点、
  2 条 contains 边（每文件 1 条）、1 条 depends-on 边、1 条 calls 边；
  (b) `expected-module-graph.json` 的 `moduleGraph` 字段**不变**（python 文件不在
  `MODULE_DERIVATION_SCAN_SURFACE` 扫描面内）——若再生后此资产确有变化，需回退设计
  重新核实，不得强行接受；
  (c) 两份资产的 `fixtureInputHash` 彼此一致。

- [x] T012 [D2] 依赖 T011：重跑
  `npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`。
  **验收判据**：T009 新增的两条具体边断言转绿；既有 a-track/b-track 基础比对用例保持绿。

- [x] T013 [D2] 依赖 T009：新增**永久**隔离对照单测——在测试内直接调用
  `buildUnifiedGraph({ projectRoot, codeSkeletons: <排除 python 后的 tsJs+generic skeletons> })`
  （合法公开 API 用法，不 monkey-patch 生产源码），断言其产物中**不存在**上述
  depends-on/calls 边。**验收判据**：用例绿；用例命名清晰体现"验证 #2 pyWalk 是这两条边的
  唯一生产者"（勿沿用 F249 那条名不副实的旧用例名）。

- [x] T014 [D2] 依赖 T012、T013：变异矩阵验证（临时变异，implement 阶段执行观察，
  **不作为**永久测试代码提交），对 py 侧 5 个 bump 维度逐个验证新护栏可红：
  (1) ignore-dirs-pruning：临时改 `PY_SKELETON_IGNORE_DIRS`（`source-discovery.ts`
  L237-240）剪枝集合，验证护栏因扫描文件集变化而红，验证后还原；
  (2) gitignore-interpretation：临时改 `createGitignoreFilter` 调用方式/`resolvedRoot`
  基准，验证过滤层变化可被捕获，验证后还原；
  (3) symlink-handling：验证护栏对 `walkPyFiles` symlink 穿越行为的敏感性；若当前确无
  差异探测点，如实记录"该维度当前无法被本护栏捕获"，不得编造断言；
  (4) file-size-guard：临时调低 `MAX_FILE_BYTES`（当前 1MB）使 producer.py/consumer.py
  被跳过，验证护栏因文件被排除而红，验证后还原；
  (5) collection-failure-degradation：临时让 `adapter.analyzeFile` 对 producer.py
  抛异常，验证护栏能感知该文件从 codeSkeletons 消失，验证后还原。
  **验收判据**：每个维度的红/绿结果（含"当前无法捕获"的诚实标注）写入
  `fix-report.md` 或 commit message 的"变异矩阵结果"表，且所有临时改动在验证后已
  `git diff` 确认清零（无残留改动）。

- [x] T015 [P] [D2] 修正 `tests/fixtures/collector-fingerprint-guardrail/README.md`：
  (a) `mod.py`/`mod.pyi` 行补脚注说明"仅覆盖节点面（SC-005b），不覆盖边面独占性"；
  (b) 新增一行记录 `producer.py`/`consumer.py` 覆盖"#2 pyWalk 边面独占覆盖"；
  (c) 按既有"rebase 调和补记"体例补一节"探针 C 补记"，链接 `fix-report.md`。
  **验收判据**：README 覆盖表新旧行数一致性可核对（新增 1 行样本记录 + 1 行脚注 +
  1 节补记），不修改既有其他行内容。

- [x] T016 [D2] 依赖 T012-T015：回归复核既有 4 类用例组（a-track 基础比对、b-track
  基础比对、b-track fallback、扰动注入组「T047 三件套」）全部保持绿。
  **验收判据**：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`
  终端输出 pass 计数 = 改动前 pass 计数 + 本阶段新增用例数（T009 扩展、T013 新增），
  0 fail；特别核对扰动注入组用例（`perturbed.nodes[0]`/`links[0]` 取值方式）未因
  新增 py 样本改变数组下标语义而失真。

**Checkpoint**：缺陷 2 修复完成——护栏对 `#2 pyWalk` 具备独占可见性，探针 C 场景可复现
为永久回归测试。

---

## Phase 3: 回归护栏核对（本仓自身重建）

**目标**：证明缺陷 1 修复只清除假边、不损失真实覆盖，图质量不回落。

- [x] T017 依赖 T006、T016：对本仓自身执行 graph-only 重建（
  `npm run baseline:collect -- --target self-dogfood --mode full` 或等效
  graph-only 命令，implement 阶段按当时可用 CLI 参数确定），与修复前基线
  （fix-report 记录：节点 7506 / 边 12628 / calls 3813）做**逐边 diff**（非仅计数）。
  **验收判据**：
  (a) 若 calls 边数量下降，需对下降的每一条边核实 caller/callee 是否命中"require
  兜底覆写"模式（修复前该边 target 是被覆写别名指向的错误节点），逐条记录在实现备注；
  (b) calls 边不得出现"预期外"下降（如 Python 路径调用边意外消失），若出现须回退分析
  并在实现备注写明原因；
  (c) depends-on 边数量与修复前持平（本次改动不触碰 `deriveImportEdges`），
  差值须为 0，否则视为回归需排查。

- [x] T018 依赖 T017：核对图质量门六指标（F217：orphan / dangling / duplicate /
  ignored / freshness 等，具体命令视仓库当前 `npm run` 脚本而定）。
  **验收判据**：六指标数值与修复前基线相比不劣化（无新增 orphan/dangling/duplicate，
  ignored/freshness 状态不回落），逐项数值记入实现备注。

---

## Phase 4: 记账修正

- [x] T019 [P] 据实修订 `specs/249-graph-collector-fingerprint/` 中 FR-005(c) 相关验收
  记账（在其 verification-report.md 或等效制品追加补记段），明确记录"a-track 对
  `#2 pyWalk` 管线此前存在零独占覆盖窗口，已由 F259 补齐边面覆盖"，避免未来审计误读为
  "F249 从未有过盲区"。**验收判据**：补记段落存在且引用本次 fix-report.md 路径，
  不修改 F249 原有其他记账内容（只追加不改写）。

---

## Phase 5: 全量验证

**目标**：确认本次修复未引入任何回归，符合交付前置条件。

- [x] T020 依赖 T001-T019 全部完成：执行 `npx vitest run`。
  **验收判据**：终端输出 0 failed，pass 总数 ≥ 改动前基线 + 本次新增用例数
  （T001/T004/T005/T003 附属用例/T009 扩展/T013 新增），退出码 0。

- [x] T021 依赖 T020：执行 `npm run test:plugins`。
  **验收判据**：退出码 0，无失败用例（本次改动未涉及 `plugins/spec-driver/`，
  预期该套件行为不变，仍需实跑确认而非假设）。

- [x] T022 依赖 T020：执行 `npm run build`。
  **验收判据**：TypeScript 编译零错误，退出码 0。

- [x] T023 依赖 T022：执行 `npm run repo:check`。
  **验收判据**：退出码 0，无 drift / sync 告警。

- [x] T024 依赖 T023：执行 `npm run release:check`。
  **验收判据**：退出码 0（本次改动不涉及 release contract 字段，预期通过，仍需实跑确认）。

---

## FR / 缺陷覆盖映射表

| 缺陷/条目 | 对应 Task ID |
|-----------|-------------|
| 缺陷 1（确定性假边）红用例 | T001 |
| 缺陷 1 修复实现（判据 + 双保险防御） | T002, T003 |
| 缺陷 1 回归（depends-on 不受损、副作用口径统一） | T004, T005 |
| 缺陷 1 全量回归确认 | T006 |
| 缺陷 2（护栏盲区）fixture 增样 | T007, T008 |
| 缺陷 2 断言升级 | T009 |
| 缺陷 2 红用例先行验证 | T010 |
| 缺陷 2 pinned 资产再生 | T011 |
| 缺陷 2 绿转换确认 | T012 |
| 缺陷 2 探针 C 永久回归（隔离对照用例） | T013 |
| 缺陷 2 变异矩阵（5 维度） | T014 |
| 缺陷 2 README 记账修正 | T015 |
| 缺陷 2 既有用例组回归复核 | T016 |
| 本仓 graph-only 重建 + 逐边 diff | T017 |
| 图质量门六指标核对 | T018 |
| F249 FR-005(c) 记账修订 | T019 |
| 全量验证（vitest / test:plugins / build / repo:check / release:check） | T020-T024 |

**覆盖率**：fix-report.md 列出的 2 处缺陷 + plan.md 要求的全部验证步骤（红用例先行、
变异矩阵、逐边 diff 回归、图质量门、记账修正、全量五件套）均有对应 Task，覆盖 100%。

---

## Dependencies & Execution Order

### Phase 依赖关系

- **Phase 1（缺陷 1）** 与 **Phase 2（缺陷 2）** 相互独立，可并行开工（不同文件，
  fix-report/plan 已明确两处缺陷根因不相关）。
- **Phase 3（回归护栏核对）** 依赖 Phase 1（T006）与 Phase 2（T016）均完成——
  逐边 diff 需要缺陷 1 的修复生效才能对比"假边被清除"，且需要缺陷 2 的护栏改动
  不干扰本仓自身重建结果。
- **Phase 4（记账修正）** 可在 Phase 2 完成后随时进行，不阻塞其他 Phase。
- **Phase 5（全量验证）** 依赖 Phase 1-4 全部完成，是最终交付前置门禁，必须最后执行。

### Story 内部依赖

- Phase 1 内部：T001（红）→ T002 → T003 → T006（全量回归）；T004、T005 可与
  T002/T003 并行编写（不同断言但同文件，建议同一 PR 内顺序提交避免文件冲突）。
- Phase 2 内部：T007/T008（并行）→ T009 → T010（红）→ T011（再生）→ T012（绿）；
  T013 可在 T009 完成后即开始（不依赖 T010-T012 的红绿转换，是独立测试路径）；
  T014（变异矩阵）依赖 T012 与 T013 均已建立护栏新基线；T015 可与 T007-T014 全程并行
  （不同文件）；T016 是 Phase 2 收尾，依赖 T012-T015 全部完成。

### 并行机会

- T004、T005（缺陷 1 回归用例）与 T007、T008（缺陷 2 fixture 新文件）四者互不冲突，
  可完全并行执行。
- T015（README 修正）可与 T009-T014 的任意子任务并行进行。
- T019（F249 记账修正）可与 Phase 3（T017/T018）并行进行。

### 不可并行的关键路径

- T001 → T002 → T003 → T006（缺陷 1 主线，红用例必须先于实现）
- T009 → T010 → T011 → T012（缺陷 2 主线，红用例必须先于 pinned 资产再生）
- T017 → T018（回归护栏必须先重建图才能核对质量门）
- T020 → T021/T022 → T023 → T024（全量验证顺序，repo:check 依赖 build 产物、
  release:check 依赖 repo:check 通过）

---

## Implementation Strategy

**推荐执行顺序（非强制并行团队，单人/单 agent 顺序执行时）**：

1. Phase 1（缺陷 1）：红用例先行 → 两处代码改动 → 全量回归，独立可交付的最小修复单元。
2. Phase 2（缺陷 2）：fixture 增样 → 红用例验证缺口存在 → pinned 再生 → 断言绿 →
   探针 C 永久用例 → 变异矩阵 → 记账，独立可交付的护栏加固单元。
3. Phase 3（回归护栏核对）：本仓自身逐边 diff + 图质量门，验证两处修复叠加后无副作用。
4. Phase 4（记账修正）：F249 据实补记，闭环审计链路。
5. Phase 5（全量验证）：五件套零失败，交付前最终门禁。

两处缺陷验证方式不同（单测断言 vs 端到端 fixture 回归），按 plan.md「Impact Assessment」
的判断，此顺序是可读性与可回滚性的自然选择，非风险等级强制要求。
