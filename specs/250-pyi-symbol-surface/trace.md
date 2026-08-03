# F250 编排执行 Trace（story 模式）

## 初始化

- 插件路径：`~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.4.0`（`.specify/.spec-driver-path`）
- 环境检查：constitution/config/gate_policy 齐备；`NEEDS_CONSTITUTION=false`
- gate_policy=`balanced`；GATE_DESIGN/GATE_TASKS/GATE_VERIFY base=`always`（GATE_DESIGN 硬门禁仅 feature 模式）
- 在线调研：`required=false` → `[story] 在线调研补充 [已跳过 - 项目未要求在线调研]`
- KB 预查：`knowledge_sources` 未配置 → 跳过注入
- `[自适应] 特性目录全新，无已有制品，全流程执行`

## 编号与基座决策（编排器）

- fetch 后 origin/master 最新为 F248（790b29f，collector-extname）；当前分支先 ff 至 790b29f
- 用户所述「F243 W-002」定位为**姊妹分支** `claude/recursing-margulis-b79caa` 的 feat(F243) `3cdd89f`（collector 指纹 + `src/collector-surface.ts` SSoT），未合 master；其 commit message 登记 follow-up 卡「.pyi 是否入 symbol 图的产品裁决」即本 story
- 本 story 实现落点（SSoT 常量/探针/pinned 资产）仅存在于该分支 → **基座定为 3cdd89f**
- 编号：master 已占 248；姊妹 F243 交付时须重编 249 → 本 story 取 **250**（`250-pyi-symbol-surface`）
- `[SCOPE] mode=story | files≈7 | cross_package=false | level=SMALL | decision=CONTINUE`

## 裁决调查（编排器主线程，Step 7 代码上下文扫描）

关键实证：
1. TS 侧 `.d.ts` 零特判（全仓 grep 无命中）——`endsWith('.ts')` 与 `extname` 两口径天然采集 `.d.ts` 并产 symbol
2. baseline 五 Python 项目 .pyi 覆盖面：micrograd/nanoGPT/astropy/sympy = 0；pytest = 8 个**全部 stub-only**（`__init__.pyi` 包标记，shadow 对零实例）
3. `collector-fingerprint.ts` 自述扩展集增删由 `extensionSurface` 自动反映 → 无需 bump `BEHAVIOR_VERSION`
4. 护栏 fixture 已预埋 `src/py/mod.py`+`mod.pyi` shadow 对；再生脚本/拒绝谓词齐备
5. `pyModuleMap` 的 `basename(f,'.py')` 对 .pyi 不剥后缀 → 键 `mod.pyi` 与 topModule `mod` 永不相等（意外安全，需钉成显式设计）
6. cache-key-builder 仅消费 `TSJS_SKELETON_WALK_SURFACE` → python 扩集无缓存键副作用

**裁决：是——.pyi 产出 symbol 节点进图**，附护栏 A（import 解析目标排除）+ 护栏 B（label 扩展名剥离）。理由链与反方案否决全文见 spec.md「核心决策记录」。

## Phase 1: Constitution 检查 [1/5]

- 内联快速检查命中「修改 src/ 源码」→ 升级完整 Constitution Agent（opus）
- 结论：**PASS（含 3 条 WARNING 前携约束）**——注释改写边界（原则 IV）/ 图质量门预期前置 / 指纹 stale 用户可见影响显式落 spec
- 前携约束已全部注入 specify prompt

## Phase 2: 需求规范 [2/5]

- specify 子代理（sonnet）：spec.md 产出（10 FR / 3 US / 7 SC / 6 Edge Cases / 核心决策记录 / 依赖与兼容性）
- clarify 子代理（sonnet）：2 处 AUTO-RESOLVED（FR-003 两链路产物归属拆分——buildModuleGraph 为无 label 分析视图、写入层按 id 合并；FR-005 锁定 extractSymbolNodes 两处 label 生成点含 parseError 分支）；0 CRITICAL
- 基座健康：`collector-surface.test.ts` + `python-adapter.test.ts` 84/84 绿（本 worktree 实测）

## Phase 2 对抗审查环（spec 阶段）

- Codex 探测：codex-rescue 转后台 task（task-msd62yty-bfxlt9）→ 回收时确认 **Codex 周配额耗尽**（恢复 2026-08-08 13:53，与 F243 记录一致）→ `[DEGRADED: codex-quota — spec 审查 — 按 F243 先例降级 Claude opus 内部对抗复审]`
- **opus 对抗审查第一轮：VERDICT 3C/6W/5I** —— 立项级修正：
  - C1（编排器亲自复核**属实**）：python 符号生产是**双路模型**——`.pyi` 符号经 unified-graph 第五路（walkPyFiles→CodeSkeleton）**已在图中**（pinned 资产实证 `src/py/mod.pyi::mod_fn` 存在，`unifiedKind==='symbol'` 可查询）；「stub-only 可见性缺口」不存在，初版 US1/SC-007/理由链#4 证伪
  - C2（复核属实）：`.d.ts` 有特判（`isNonSourceTarget` import-resolver.ts:138 + data-model-generator.ts:616），方向=「声明文件不作解析目标」——恰为护栏 A 同向先例；初版「零特判」为编排器 grep 范围不足（漏 src/core/、src/panoramic/generators/）
  - C3（复核属实）：unified 路 label 是**全语言原始文件名通例**（foo.ts/main.go/Foo.JAVA 实测）；FR-005 收窄为 extraction 两处铸造点
  - W1-W6/I1-I5：FR-007 字段级 delta、SC-002 三层重述、@overload/空 stub 边界、FR-006 反自证断言、FR-008 第三注释点、W6 指纹盲区登记、护栏 A 双重意外安全等——全部吸收
- **裁决重定性（编排器主线程）**：结论维持「是」，价值主张由「可见性缺口修复」改为「管线奇偶性 + stub 签名元数据 + label 对齐 + SSoT 收敛」；修正过程按诚实记账原则全文留存于 spec「初版理由链的证伪与修正」
- specify 子代理重写 spec.md（11 FR 含 1 可选 / US1 降 P2 / SC-007 改元数据口径 / 复杂度评估 LOW）
- 编排器复核重写稿发现：FR-008 文件路径笔误（`src/collector-fingerprint.ts` → 应为 `src/panoramic/graph/collector-fingerprint.ts`，行号 44-46 已核实无误）——待 delta 审查后一并修正
- **opus delta 复审：VERDICT 2C/5W/5I**（原审查员续会）——上轮 14 项处置 12 项干净落地、2 项走样；全部为局部文本修正，裁决/FR 结构/验收边界不动：
  - C1：Clarifications 第 2 条残留已证伪断言（「中间态不落持久化图」）与新「背景」章节自相矛盾 → 追加撤销标注留痕
  - C2：Edge Cases 空 .pyi 条目援引**不存在的「F214 目录两级 contains」**（实测空 .pyi 就是零度节点；F214 两级=file→symbol+symbol→member）→ **该臆造源头是编排器注入 specify 的简报**（把记忆中 F214「两级 contains」误外推到目录层），编排器认领；改为真实理由（orphan/contains 分母只含 unifiedKind==='symbol'，module 不计入）
  - W1：FR-008/复杂度评估两处路径笔误（编排器复核时已独立发现同一处）；W2：可查询机制=findNode 按 id 命中非 unifiedKind（审查员自我更正上轮措辞）；W3：FR-007 module delta 漏 sourceFile/confidence 两键且 sourceTag 是改值非新增；W4：SC-002 (a)/(c) freshness 口径互斥 + **本仓唯一 .pyi 在 tests/ 剪枝集内→真实图行为增量为零，(a) 纯回归守卫、验收全压 (b)**；W5：护栏 A 反向推论（stub-only 永无 import 入边）+ 空 stub-only 完全孤立形态未登记
  - I1-I3：upsertNode/upsertEdge 才是 extraction 写入 helper（nodeMap.set 是 unified 路）、walk/scan 硬编码 ignore 集差异点名、反向差集（build/coverage/out/target）extraction-only 形态登记
  - I5：本轮实证通过清单（全语言 raw-label 通例/合并语义不触碰 label/signature 抽取含返回注解/两套字段共存样板/指纹分量存在/b-track 零 python）——spec 事实底座确认翻新到位
- specify 续会执行 9 项文本修正：**完成**（逐条确认清单齐）
- `[GATE] ONLINE_RESEARCH | mode=story | required=false | decision=PASS | points=0`
- `[GATE] GATE_DESIGN | mode=story | policy=balanced | override=无 | decision=AUTO_CONTINUE | reason=两轮对抗审查全处置闭环，零未决 CRITICAL`

## Phase 3: 技术规划 + 任务分解 [3/5]

- plan 子代理（sonnet）：plan.md + research.md + data-model.md + quickstart.md + contracts/collector-surface-extension.md
- **plan 关键发现（编排器独立核实属实）**：基座 scanPyFiles:153 **已消费** `surfaceMatchesFile(PYTHON_SYMBOL_SCAN_SURFACE, ·)`（F243 收敛完成）——常量即行为开关，FR-002 前提过时（编排器早前读的是 master 版 python-adapter.ts，切基座前的旧状态，注入 specify 的事实包含此过时前提，第二次「底座错位」教训）
- plan 裁定：护栏 A=显式跳过 .pyi 不入 pyModuleMap（断路 label-helper 被顺手统一到 map 键的耦合事故路径）；label helper=`basename(relPath, extname(relPath))` 两分支共用；relPySet 保留 .pyi（ModuleGraph 视图含 .pyi、tryResolveAtDir 候选恒 .py 惰性）
- **opus plan 阶段对抗审查：VERDICT 1C/5W/5I**（架构裁定全部站住，问题集中执行层）：
  - C1（编排器 node 实测抽验属实）：stripFileExtension 对**纯点文件 `.py`**不等价（旧 label `""` → 新 `".py"`；该形态在 endsWith 采集面内且已有实跑探针但只断言 id 不断言 label）→ 声明为可接受 delta + 补纯点 label 探针
  - W1：quickstart 的 `npx tsx -e` 实测必败（CJS eval 不支持 import+顶层 await）→ 改临时 .mts；W2：buildAstGraphOnly 会在 fixture 入库目录内生成 specs/_meta/graph.json → 改临时目录 staging；W3：FR-003b（ModuleGraph 含 .pyi 条目）无验证载体 → 补探针；W4：FR-002 防回归探针/FR-006 反自证要求/SC-005 对照组三项在执行清单失踪 → 补全；W5：spec FR-004/Edge Cases 两处「键存在」表述随显式跳过裁定失真 → 同步 spec
  - I1：plan Impact 误列 cache-key-builder 为消费方（实测 TSJS-only）；I2：contracts 把测试局部常量 DISPATCHED_SURFACES 误归属 ignore-oracle.ts；I3：LOC 217；I4：编排器点名的两核对点（.pyi 作 source 读表不受影响 / .py 撞键 last-write-wins 零波及）均验证通过；I5：signature 实测形态 `"def real_fn(x: int) -> str"`（[待验证] 姿态保留）
- 并行修正派发：specify（spec 三处）+ plan（四制品八项）——**均完成**（逐条确认清单齐；spec 增 Clarifications 第四条留痕）
- tasks 子代理（sonnet）：tasks.md 产出（11 任务 T001-T011；TDD 红探针前置 Foundational、三 Story 并行、Polish 收尾；FR/SC 100% 映射；「不分批交付」论证=fixture 原子再生资产）
- 编排器自查：`fixtures:regen:collector-fingerprint` script 实名确认（package.json:33）
- **opus tasks 阶段对抗审查：VERDICT 1C/5W/5I**（分解质量高于前两阶段，前三轮执行层缺口全部落地有 owner）：
  - C1（编排器点名怀疑被证实）：T-FR002 红绿判据写反——T004 前必红（.pyi-only 目录产零节点），错误判据会诱导实现者削弱探针 → 归入红探针清单 + 加禁削弱警告
  - W1/W3：T011 内部次序颠倒（repo:check 先于图重建会自造 stale 警告；repo:check 自带 graph-quality 族）→ 重排 + freshness 改有信号断言（重建后应 dirty/fresh 非 stale）
  - W2：T011.4 命令未落地 → 写死 dist CLI 形态（严禁 `spectra graph` 毁图坑 + 勿用全局旧编译产物）
  - W4：SC-002(c) duplicate 语义无执行载体 → T006 追加对 staging fixture 图跑 graph-quality（shadow 对实测）
  - W5：T003.6 断言收紧（完整 relPath 非 basename；写死 `() => false` 注入式）
  - I1：可行性三核查全过（REPO_ROOT extraction 实际只 3 个 .py / vitest unit project 不改 cwd / script 名逐字一致）；I2 依赖图无环无缺口；I5：T001 基座措辞（3cdd89f 非 master）
- tasks 修正（6 处文本）：**完成**（逐条确认；任务结构/依赖图/覆盖面未动）
- `[GATE] GATE_TASKS | mode=story | policy=balanced | override=无 | decision=AUTO_CONTINUE | reason=对抗审查（1C/5W/5I）处置闭环；依赖无环、FR/SC 100% 映射`
- `[CONTROL] IMPLEMENT_AUTH | policy=balanced | risk=NORMAL | decision=AUTO_CONTINUE | reason=6 生产/测试文件+2 fixture 再生，无高风险域`

## Phase 4: 代码实现 [4/5]

- implement 子代理（**opus**，按仓库模型策略生产代码升档）：T001-T011 全完成，9 文件 +391/-56
- TDD 红绿对照：T004 前 11 红（含 C1 订正后必红的 T-FR002）→ 实现后全绿；FR-006 反自证落实（对拍两侧各持硬编码期望）
- **implement 发现 3 处 tasks 未列连带断言**（一次 grep 可机械发现，转改进候选）：collector-surface.test.ts:767 翻转、collector-fingerprint.test.ts `.not.toEqual(pyWalk)` 被 F250 证伪→改 `.not.toBe` 引用隔离保「独立追踪」语义、charter 快照 9 处指纹行（先证后改：9 insertions 零 deletions）
- T009 fixture 再生：拒绝谓词三 false 放行；契约 3/4 逐字段全中；负面清单 4 项零命中；signature 实跑 `def mod_fn() -> int`；二跑幂等；BEHAVIOR_VERSION=1 未动
- T010 零改动 checklist 八项全过；T011 六步全绿（图重建 6229 节点/9688 边/Python 符号 16/3.7s；graph-quality overallVerdict pass；freshness=dirty 非 stale ✓）
- 主动偏差：fixture 未 git add（合理——保 verify 阶段 git diff 可见性，提交时统一纳入）

## Phase 4.5: 编排器独立验证（宪法 XII）

- `[增量验证] Level=2 | 变更文件=9 | 全量套件`
- vitest 全量第一跑：1 failed/6400 passed（失败名未捕获）；**第二跑 6401/0 全绿**（498/502 文件）——判满载 flaky 非回归（6394 基线+7 新探针账目吻合）
- `npm run build` exit 0（盖章 3cdd89f dirty）；`npm run repo:check` 全族 pass（含 graph-quality freshness pass——图已在 T011 重建）
- `[编排器验证] build ✅ test ✅ repo:check ✅`

## Phase 5: 验证闭环 [5/5]

- [并行] 5a spec-review（sonnet）+ 5b quality-review（sonnet）+ opus 实现对抗审查——三路完成：
  - **5b quality-review：EXCELLENT（0C/0W/3I）**——plan 四决策严格落地、叶子性质未破坏、探针独立性/反自证验证落实；报告已落盘 verification/quality-review-report.md
  - **5a spec-review：PASS_WITH_NOTES（0C/1W/3I）**——11/11 FR 实现；W=FR-004 相对 import 场景缺专门 shadow 对探针（字面「两处均配探针」缺口）；3 处连带改动核实为必然机械结果非超范围；报告由编排器代写落盘（子代理无 Write 权限）
  - **opus 实现对抗审查：VERDICT 0C/5W/5I**（四轮里质量最高交付；生产代码逐行攻击未证伪）：
    - W1：collector-fingerprint.test.ts `.not.toBe` 为真空断言（toSurfaceEntry 恒新建对象），误接线三断言全过，注释宣称的「独立感知」不存在 → 删真空断言+注释如实降级
    - W2：护栏 A 黑盒行为不可观测（`.pyi` 键因 topModule 恒无点而不可达；删 continue 后 T-guard-a-b 仍全绿）——tasks「map 无 .pyi 键」声称无断言支撑 → 测试/tasks/spec 三处如实标注（YAGNI 否决白盒重构）
    - W3：T-overload 前置 `>=1` 测不到「解析层去重」前提失效 → 改 `toBe(2)`
    - **W4：首跑 1 failed 复现并定位**——graph-quality-core.test.ts:268 dirty 态用例；机制=该文件 beforeAll `npm run build` 重写共享 dist/ 与 ≥10 个 spawn dist CLI 的测试文件写竞争（隔离必绿）；与 F250 无关但有特异放大项（源/dist 指纹窗口）→ 已立独立改进卡 task_9294e9bd
    - W5：plan 预测 7 制品实际 9（指纹消费面扫描遗漏：collector-fingerprint.test.ts + charter 快照）——实现已正确兜住，全仓核对嵌指纹的非 TS 产物 3 份全更新零遗漏 → 记 commit message + 改进候选
    - I1 逐项账目核对全过（fixture 15/3 行全可归因、快照 9+/0- 零夹带、signature 与 stub 一致、测试账 10-3=+7、tsc 0 错）；I5 纯点文件空串键为既有边界（`if (!topModule)` 兜住）
- 编排器处置：三组修正并行派发（implement：W3+W1+FR-004 相对探针+W2/I2 标注；specify：spec FR-004 口径如实化；tasks：T005 两句声称如实化+T-guard-a-relative 补记）；W4 立卡（task_9294e9bd）；W5 记入最终报告改进候选
- 三组修正全部返回确认：代码侧含 **T-guard-a-relative 变异验证**（tryResolveAtDir 候选改坏→探针红→字节级还原零残留）；测试数 6401→**6402**（+T-guard-a-relative）；三文件定向 164/164 绿
- 5c verify（sonnet）独立实跑：vitest **6402/0 一次通过** · build 0 · repo:check ~85 项全 pass · graph-quality overallVerdict=pass（freshness=dirty，dirtyFiles 恰为本次 6 个改动文件）→ **READY FOR REVIEW**；verification-report.md 落盘
- `[GATE] GATE_VERIFY | mode=story | policy=balanced | override=无 | decision=AUTO_CONTINUE | reason=5a(0C/1W→T-guard-a-relative 闭合)/5b(0C/0W EXCELLENT)/5c(PASS)/实现终审(0C/5W 全处置)——零 CRITICAL`

## 交付态与依赖链（编排器）

- 提交前复查：origin/master 前进至 4fcb2f0（F240 hook-trust R1 系列）；**姊妹分支已 rebase 至 4fcb2f0 并重编 F243→F249**（68eb7e5，`specs/249-graph-collector-fingerprint`）——本 story 预留 249、取 250 的编号判断得到证实
- 本分支基座仍是姊妹旧快照 3cdd89f → 交付路径：`git rebase --onto <F249 落地后的 master> 3cdd89f 250-pyi-symbol-surface`（丢弃栈内旧 F243 副本，仅重放本 story commit）；预演 rebase 对齐至 68eb7e5 见后续记录
- push origin master 前置条件：(1) F249 先行落地 master；(2) 本分支 rebase + 全量重验；(3) 用户明确「确认 push」（CLAUDE.local 约定）
- Codex 交叉验证欠账：本 story 全部对抗审查由 Claude opus 替代执行（Codex 周配额耗尽，恢复 2026-08-08 13:53）——按 F243/F249 同等先例，建议配额恢复后补跑 Codex 交叉验证

## 对齐 rebase 记录

- **基座迁移**：`3cdd89f`（姊妹旧快照 F243）→ **`68eb7e5`**（姊妹 rebase 后头部 F249，已含 origin/master `4fcb2f0`）。命令：`git rebase --onto 68eb7e5 3cdd89f 250-pyi-symbol-surface`；备份引用 `250-pre-align-backup`（= 旧 commit `d7dfb55`）。重放后仍为**单 commit** 形态（`5839a3d`）。
- **两基座漂移面**（本 story 触碰文件上 104+/21-）：① 姊妹自身重编号 F243→F249（注释级）；② 过继 master `d27ba75`（master 侧另一个 F243，`.mjs`/`.cjs` 四处扩展名脱节收口）——`TSJS_SKELETON_WALK_SURFACE` 扩集为 6 项 + 配套测试/ignore 分派/cache-key 调和。**两者与本 story 的 `PYTHON_SYMBOL_SCAN_SURFACE` 语义正交**，无语义冲突。
- **冲突清单（仅 1 处，纯文本冲突）**：`src/adapters/python-adapter.ts` 的 `scanPyFiles` 文档注释——他们侧是 F249 重编号后的旧表述（含「`.pyi` 依旧不产出符号节点」，已被本 story 证伪），我方是 F250 改写版。处置：**取我方语义改写**，并把其中 `F243 W-002` 就地重编号为 `F249 W-002`（我方 delta 中唯一一处需跟随重编号的引用）。其余 8 个文件全部自动合并成功（我方 4 处编辑点与他们 4 处编辑点零重叠）。
- **fixture 再生（新基座）**：`tests/fixtures/collector-fingerprint-guardrail/expected-*.json` + `README.md` 先 `git checkout 68eb7e5 --` 取他们版本，rebase 完成后重跑 `npm run fixtures:regen:collector-fingerprint`（`放行：contentMismatch=false、fingerprintUnchanged=false、inputHashChanged=false`，未用 `--init`）。**对新基线（68eb7e5 fixture）的 delta 与契约 3/4 逐字段仍完全成立**：`label mod.pyi→mod`、`sourceTag unified-graph→extraction`、新增 `sourceFile`/`confidence: EXTRACTED`、`mod_fn` 新增 `symbolKind: function` + `signature: "def mod_fn() -> int"`、`pythonSymbolScan [".py"]→[".py",".pyi"]`；`unifiedKind`/`sourcePath`/`exportKind`/`callSitesCount` 不变。**负面清单四项零命中**（节点 id 未变 / `contains` 边零增删 / `mod.py` 对照组零变化 / `modules[].` 内容零变化）；a-track 节点·边 multiset 比较器 `contentMismatch=false` 独立佐证后两项。新基座已有的 `tsjsSkeletonWalk` `.mjs`/`.cjs` 分量为继承内容，不在我方 delta 内。
- **charter 快照重插**：先 `git checkout 68eb7e5 --` 取他们版本（其已含 `.mjs`/`.cjs` 增量），跑 e2e 取失败输出「先证后改」——9 个失败块的 received 行去重为 `9 × + ".pyi",`、expected 删除行 **0**；随后用锚定 `"pythonSymbolScan"` 块首的确定性插入（**未用 `-u`**），`git diff` 实测 **9 insertions(+) / 0 deletions**，e2e 12/12 绿。
- **结论**：对齐后我方语义 delta 完整保留、无降级、无夹带；F249 以 `68eb7e5` 形态落地 master 后，本分支可直接 fast-forward 交付。
