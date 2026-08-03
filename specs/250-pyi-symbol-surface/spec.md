# Feature Specification: .pyi 类型 stub 纳入 Python 符号采集面

**Feature Branch**: `250-pyi-symbol-surface`
**Created**: 2026-08-03
**Status**: Draft
**Input**: User description: "F250：.pyi 类型 stub 纳入 python 符号采集面 — 产品裁决落地"

## 核心决策记录

### 背景：图的双路 Python 符号生产模型

在重写本 spec 之前必须先钉住一个事实：Spectra 对 Python 符号的图生产**不是单路而是双路**，初版 spec 与 F243 SSoT 注释都只看到了其中一路，这正是本次全篇修正的根源。

1. **extraction 路**（第四路）：`scanPyFiles`（当前仅扫 `.py`）→ `extractSymbolNodes` → 先写入图；产出「module 节点 + **顶层导出** component 节点 + contains 边」；节点 metadata 含 `symbolKind`/`signature`/`sourceFile`/`confidence: 'EXTRACTED'`/`sourceTag: 'extraction'`；module 节点 `label` 经 `path.basename(relPath, '.py')` 剥离扩展名（`mod.py` → `mod`）。
2. **unified-graph 路**（第五路）：`walkPyFiles`（已扫 `.py` + `.pyi`）→ CodeSkeleton → `deriveNodesFromSkeletons` → `buildUnifiedGraph`；产出「module 节点 + **成员级** symbol 节点（含类属性形如 `Cls.attr`）」；module 节点 `label` 为**原始文件名**（如 `mod.pyi`）——这是 unified 路对**所有语言**的既定通例（实测 pinned 资产中 `foo.ts`/`main.go`/`Foo.JAVA`/`bar.js` 的 module label 全是原始文件名），并非 `.pyi` 专属 bug；metadata 不含 signature/symbolKind/confidence。
3. **合并语义**（`graph-builder.ts`，F217 决策 2 增补 4）：extraction 路先写；unified 路对已存在节点**只补缺不覆盖**（补 `unifiedKind`/`sourcePath`/`exportKind`/`memberKind` 等字段），对不存在节点才新建（`sourceTag: 'unified-graph'`）。

**当前 pinned 资产实况**（`expected-graph-only-graph.json`）：`src/py/mod.pyi` 的 module 节点与 `src/py/mod.pyi::mod_fn` symbol 节点 + contains 边**已经存在**（由 unified 路产出），label 为 `mod.pyi`、无 signature；对照 `src/py/mod.py::mod_fn`（extraction 路产出）label 为 `mod_fn`、有 `signature: "def mod_fn()"`。

**因此：`.pyi` 符号今天已经可以被 `context`/`graph_query` 等工具查询到**（因其以 canonical id `relPath::name` 存在于 `graph.nodes`，`findNode` 按节点 id 直接命中；`unifiedKind === 'symbol'` 是 F217 质量门的分母谓词，非查询门槛）。初版 spec 断言的「stub-only 模块不可查询」缺口**不存在**——这一断言及建立在其上的 US1 / SC-007 / 理由链 #4 已在对抗审查中被证伪（详见下方「初版理由链的证伪与修正」）。

### 裁决

**维持「是」——`.pyi` 类型 stub 文件应纳入 extraction 路的符号采集面**（`PYTHON_SYMBOL_SCAN_SURFACE` 从 `['.py']` 扩为 `['.py', '.pyi']`），附两条精度护栏（护栏 A：import 解析目标排除；护栏 B：label 扩展名剥离，范围收窄为 extraction 路专属）。但**裁决的价值主张必须重新定性**——这不是「修复可见性缺口」，因为该缺口本就不存在；真正的价值是：

1. **管线奇偶性（parity）修复**：`.py` 由双路（extraction + unified）共同生产、`.pyi` 长期只由单路（unified）生产，这种割裂是「单路漂移」类缺陷的温床。本次修正过程中就抓到了两个活体标本：
   - 标本一：若 label 修复（护栏 B）只落在 extraction 路（初版 spec 的实现范围假设），`.pyi` 会被静默漏掉——因为它当时被误判为"根本不产 symbol 节点"，不在护栏 B 的可见改动范围内。
   - 标本二：正因双路现实难以被一眼看清，F243 遗留的 SSoT 注释（「`.pyi` 无 symbol 节点」）与本 spec 初版（「stub-only 查询返回 not-found」）先后独立写下了同源的错误事实断言。
   
   将 extraction 路扩集到 `.pyi`，并同步修正两处注释的措辞（见 FR-008），从根上消灭这类因「只看见一路」而产生的认知混淆，而不只是补一个不存在的功能缺口。
2. **stub 符号获得 extraction 级元数据**：`.pyi` 的 symbol 节点将新增 `signature`/`symbolKind`/`confidence: 'EXTRACTED'` 等字段——类型 stub 的全部内容就是函数/类签名，签名元数据对当前只有 unified 路裸节点（无 signature）的现状是真实增量。
3. **label 与 `.py` 对齐**：extraction 路先写入图，使 `.pyi` module 节点 label 从原始文件名（`mod.pyi`）变为剥离扩展名形态（`mod`），与同目录 `.py` 的展示行为保持一致。
4. **SSoT 双常量收敛**：`PYTHON_SYMBOL_SCAN_SURFACE` 与 `PY_WALK_SURFACE` 的扩展名集合从「长期不一致 + 带辩解注释」收敛为一致，消除这条永久性认知负债。
5. **机制成本低，且是 F243 指纹/再生护栏建立以来的第一次真实产品裁决演练**（不变，见 FR-009 与 Dependencies）。

### 初版理由链的证伪与修正

诚实记账：初版 spec 的理由链存在两处经对抗审查证伪的事实性错误，修正后裁决在新的事实底座上重新论证成立。

- **初版理由链 #1（「`.d.ts` 侧全仓无任何特判代码」）被证伪**：实测 `src/core/import-resolver.ts:138` 的 `isNonSourceTarget` 明确把 `.d.ts` 判为 external，使其不进入 callSites 图（3 处消费方依赖此判定）；`src/panoramic/generators/data-model-generator.ts:616` 也显式排除 `.d.ts`。TypeScript 侧确实存在特判，只是**特判方向是「声明文件不作为 import 解析目标」**，而非「声明文件不产 symbol 节点」——这恰好与本 story 的护栏 A（`.pyi` 不作为 import 解析目标）同向，构成了正确的先例佐证，而非需要打破的不对称。
- **初版理由链 #4（「stub-only 可见性缺口是真实缺口」）被证伪**：如上文「背景」所述，unified-graph 路早已使 `.pyi` symbol 节点可查询，当前 pinned 资产就是实证。原 US1「agent 查询 stub-only 模块返回 not-found」的场景描述与事实不符，已整体重写（见下方 User Story 1）。

这两处修正不影响裁决的「是」结论，但改变了裁决的论证路径与价值主张定性——由「补功能缺口」改为「消除管线割裂 + 补充元数据精度」。此节留存作为后来者理解本 story 真实动机、以及双路模型存在的认知锚点。

### 被否决的反方案

**反方案：登记「extraction 路对 `.py`-only 保持有意如此，`.pyi` 符号继续只走 unified 单路」为长期设计意图。**

诚实表述该方案的实际效果：`.pyi` 符号继续只由 unified 路产出（成员级节点、无 signature 等 extraction 级元数据、module label 为原始文件名），与 `.py` 的双路富元数据生产维持长期不对称。

否决理由：
- 该方案保留的正是本次修正过程中已经产生过**两个活体错误标本**（label 修复漏改 `.pyi`、SSoT 注释与 spec 初版各自独立写错同一事实）的认知陷阱；只要双路并存且认知负担不解除，同类错误会在未来的改动中再次发生。
- 扣留真实签名元数据（`signature`/`symbolKind`/`confidence`）与产品「完整、可信知识图谱」的核心目标相悖。
- 该方案「零代码改动风险」的优势，在 F243 已建成的护栏（`extensionSurface` 指纹自动失效 + pinned 资产 + 再生脚本拒绝谓词）面前进一步贬值——扩集的实际风险已被这套护栏兜底压得很低，不足以抵消上述认知负债代价。
- 回退成本不高：若本裁决未来被证明有害，只需将 `PYTHON_SYMBOL_SCAN_SURFACE` 改回仅 `['.py']`、恢复探针断言、还原 FR-005 的 label 改动、还原 FR-008 的三处注释、重新执行资产再生脚本即可完全回滚（详见 Dependencies & Compatibility 中的回退成本说明）。

## Clarifications

### Session 2026-08-03

- **Q（措辞精度 / FR-003）**: `extractSymbolNodes` 与 `buildModuleGraph` 两条消费链路各自实际产出什么节点/边？两者是否都产 component 节点？ → **[AUTO-RESOLVED: 修订 FR-003 措辞，精确区分两条链路各自的真实产物，并补充 module 节点合并说明 — 理由：核实源码（`src/adapters/python-adapter.ts` `extractSymbolNodes`/`buildModuleGraph`、`src/knowledge-graph/module-derivation.ts` `deriveModuleGraph`）后确认：`extractSymbolNodes` 单独产出「module 节点 + component 节点 + contains 边」三者全部（`python-adapter.ts:176-255`）；`buildModuleGraph`（经 `buildModuleGraphFromCodeSkeletons` → `deriveModuleGraph`）产出的是另一套独立的 `ModuleGraph.modules`（`{source, inDegree, outDegree, level, isCircular}` 结构，**不含 `label` 字段**）+ `depends-on`（import）边，服务于 SCC/拓扑排序/mermaid 渲染这条分析视图，与 `extractSymbolNodes` 产出的知识图谱持久化节点是两套不同数据结构，仅在最终写入层按节点 id 合并去重。原 FR-003 措辞「两条链路...即...均能产出 module 节点、component 节点、contains 边」容易被读成两条链路各自产出这三者，与源码不符，已修订为精确归属描述]**
- **Q（措辞精度 / FR-005）**: label 扩展名剥离 bug 的实际代码位置在哪条链路？ → **[AUTO-RESOLVED: 保持 FR-005 现有措辞不变，仅确认其准确性 — 理由：核实后确认 label 硬编码 `.py` 剥离的唯一实际生产代码位置是 `python-adapter.ts` 的 `extractSymbolNodes` 内联逻辑（`path.basename(relPath, '.py')`，出现于该函数内两处：parseError 降级分支与正常分支），因为 `buildModuleGraph` 链路的最终输出结构本就不含 `label` 字段（不受此 bug 影响）；`deriveNodesFromSkeletons`（`buildUnifiedGraph` 内部中间态）虽也生成 module 节点 label，但其写法是 `filePath.split(/[/\\]/).pop()`（保留完整文件名不剥离任何扩展名），且该中间态节点不会流入最终持久化的知识图谱（`ModuleGraph.modules` 无 label），故不构成需要修复的 bug 面。FR-005 原文未误指位置（未指名具体文件），无需改写，仅在此记录核实结论供实现阶段参考]** **[第二轮对抗审查证伪：unified 路 module 节点 label 确实落入持久化图（实证见「背景」章节 pinned 资产实况），本条『中间态节点不会流入最终持久化图』与『不构成需要修复的 bug 面』结论作废；实际处置见 FR-005 范围收窄与 US3 范围说明]**
- **Q（第二轮：立项前提证伪 / 全篇）**: 对抗审查（3 CRITICAL / 6 WARNING / 5 INFO，编排器已逐条主线程复核确认）发现初版 spec 未识别图的 python 符号双路生产模型，导致「stub-only 不可查询」「`.d.ts` 零特判」两条核心论据与源码不符，US1/SC-007/理由链需整体重写，FR-005/FR-007/SC-002 需按双路模型收窄或重述范围。 → **[AUTO-RESOLVED: 保留裁决结论（扩集 `.pyi` 到 extraction 路）不变，全篇按修正后事实底座重写理由链、User Story、Requirements、Success Criteria、Dependencies — 理由：编排器已对全部 3 项 CRITICAL、6 项 WARNING、5 项 INFO 逐条实证核实（源码行号、pinned fixture 实际内容、graph-quality 分母定义等），修正后事实不改变「是否应该扩集」的裁决方向，只改变论证路径与实现/验收范围的精确边界，故不视为需要用户重新决策的产品级分歧，按 AUTO-RESOLVED 处理并在 spec 中保留完整证伪记录（见「初版理由链的证伪与修正」）以便追溯]**
- **Q（第三轮：delta 对抗复审 2C/5W/5I / 局部文本修正）**: 第三轮对抗复审发现 Clarifications 中「unified 路中间态节点不流入持久化图」的核实结论本身有误（C1）、Edge Cases 中臆造了不存在的「F214 目录两级 contains」机制解释空 `.pyi` 非零度（C2）、FR-008/复杂度评估中 `collector-fingerprint.ts` 路径笔误缺 `panoramic/graph/` 前缀（W1）、背景章节「可查询」判定条件措辞与 F217 分母谓词概念混淆（W2）、FR-007 module 节点 delta 清单遗漏 `sourceTag` 改值与新增字段（W3）、SC-002 (a)(c) 口径自相矛盾且未点明本仓真实图零行为增量（W4）、护栏 A 缺少「stub-only 孤立度」的显式登记（W5）、写入层去重 helper 命名与忽略集差异表述不精确（I1/I2）、反向差集登记缺失（I3）。 → **[AUTO-RESOLVED: 全部为局部文本修正，不动裁决方向/FR 结构/验收边界，按逐条处置结果就地修订对应章节，保留原文本作证伪痕迹（Clarifications 第二条）或直接订正（Edge Cases/FR-007/FR-008/SC-002/复杂度评估），不新增 Clarification 争议项]**
- **Q（第四轮：plan 阶段对抗审查 1C/5W/5I / FR-002 前提过时 + 护栏 A 实现裁定同步）**: plan 阶段核实发现姊妹分支 F243（commit `3cdd89f`）在 W-002 收敛时已将 `scanPyFiles`（`python-adapter.ts:153`）改为消费 `surfaceMatchesFile(PYTHON_SYMBOL_SCAN_SURFACE, ...)`，FR-002 原文「MUST 改为消费…不得继续硬编码」的前提（现状仍硬编码）已过时；同时 plan research 决策 1 就护栏 A 的具体实现方式裁定为「pyModuleMap 构建时对 `.pyi` 显式跳过（不写入任何键）」，而非继续依赖「`.pyi` 键恰好不等于 topModule」这一现状 quirk。 → **[AUTO-RESOLVED: 不改变 FR 编号、裁决方向或验收边界，仅将 FR-002 改写为「保持已收敛的 SSoT 消费形态不回退 + 补防回归探针」，FR-004 第一条与 Edge Cases 中 shadow 对相关表述同步改写为「pyModuleMap 显式跳过 `.pyi`、不产生任何 `.pyi` 键」的实现裁定，取代此前对「键存在但恰好不等」这一意外安全属性的依赖描述 — 理由：均为随基座代码演进 / plan 阶段实现裁定而更新的事实性前提，不影响本 story 是否应该扩集 `.pyi` 到 extraction 路的裁决方向]**

## User Scenarios & Testing *(mandatory)*

### User Story 1 - stub 符号获得与实现符号同级的签名元数据与来源标注 (Priority: P2)

作为使用 Spectra 知识图谱做代码理解/影响分析的 agent，当我查询一个 `.pyi` 类型 stub 文件中定义的符号时，我希望该符号节点带有 `signature`（函数/类签名）、`symbolKind`、`confidence: 'EXTRACTED'`、`sourceTag: 'extraction'` 等元数据，就像查询对应 `.py` 实现文件中的符号一样，而不是只拿到一个不含签名信息的裸节点。

**Why this priority**: `.pyi` 符号节点本身已可查询（unified-graph 路产出，非本 story 新增能力），本 story 的增量是**元数据精度提升**——签名信息是类型 stub 的核心价值所在，缺失签名会削弱 agent 对 stub-only API 的理解质量，但不影响基础可查询性，故定为 P2（增强而非缺口修复）。

**Independent Test**: 对 `tests/fixtures/collector-fingerprint-guardrail/src/py/mod.pyi` 执行 graph-only 建图后，用 `graph_node` 查询 `src/py/mod.pyi::mod_fn` 节点，断言其 `metadata.signature` 有值、`metadata.confidence === 'EXTRACTED'`、`metadata.sourceTag === 'extraction'`；与建图前（本次改动前）该节点仅由 unified 路产出、无上述字段的状态形成对照。

**Acceptance Scenarios**:

1. **Given** 一个含函数声明的 `.pyi` 文件，**When** 执行 graph-only 建图，**Then** 该函数对应的 symbol 节点 `metadata` 中出现 `signature`（如 `"def mod_fn()"`）、`symbolKind`、`confidence: 'EXTRACTED'`、`sourceTag: 'extraction'`。
2. **Given** 同一符号此前已由 unified 路产出（含 `unifiedKind`/`sourcePath`/`exportKind` 等字段），**When** extraction 路写入生效，**Then** 该节点是「先由 extraction 路建立 + unified 路补缺」的合并结果，两套字段共存于同一节点，互不覆盖丢失。

---

### User Story 2 - 同名 `.py`/`.pyi` 文件的 import 解析仍然准确指向实现文件 (Priority: P1)

作为依赖 Spectra 图谱做 import/依赖分析的 agent，当代码库中同时存在 `mod.py`（实现）与 `mod.pyi`（类型 stub）时，我希望所有 `import mod` 语句被解析到 `mod.py`（真实运行时依赖），而不会被错误解析到 `.pyi` 类型 stub。

**Why this priority**: 这是精度护栏，防止扩集后引入假的 import 解析结果，属于 P1 因为一旦解析错误会污染下游所有依赖分析场景。

**Independent Test**: 对 `tests/fixtures/collector-fingerprint-guardrail/src/py/mod.py` + `mod.pyi` shadow 对跑 module graph 构建，断言其被其他模块 `import` 时解析到的目标始终是 `mod.py` 对应的 module 节点。

**Acceptance Scenarios**:

1. **Given** `mod.py` 与 `mod.pyi` 同目录并存，**When** 另一文件执行绝对 import `import mod`，**Then** import 边指向 `mod.py` 的 module 节点，不指向 `mod.pyi`。
2. **Given** 同一 shadow 对，**When** 另一文件执行相对 import（`from . import mod` 等价路径解析），**Then** 候选路径解析恒为 `mod.py` 字面路径，`.pyi` 不参与候选生成。

---

### User Story 3 - extraction 路产出的 `.pyi` module 节点 label 与 `.py` 对齐 (Priority: P2)

作为浏览图谱结构（如 `graph_query`/`graph_node`）的 agent 或开发者，当我看到 `.pyi` 文件经 extraction 路产出的 module 节点时，我希望其展示 `label` 是干净的模块名（如 `mod`），而不是带扩展名的 `mod.pyi`，与同目录 `.py` 文件的展示行为一致。

**Why this priority**: 属于可读性/一致性修正，不影响功能正确性，故为 P2；但若不修复会导致图谱展示层出现明显的命名不一致，损害体验。

**范围说明（较初版收窄）**: 本承诺**仅覆盖 extraction 路覆盖到的目录**（即本次扩集后 `scanPyFiles` 会遍历到的 `.pyi` 文件）。extraction 路与 unified 路使用两套硬编码 ignore 集，存在固定差异：`scanPyFiles` 剪枝 `test`/`tests`/`.mypy_cache`/`.pytest_cache`/`.eggs`，而 `walkPyFiles` 的 `PY_SKELETON_IGNORE_DIRS` 不剪这些目录。对于落在这一差集内的 `.pyi` 文件，其产出的 module 节点仍走 unified 路单路生产，label 保持原始文件名——这是 unified 路对**所有语言**的既定通例（非 `.pyi` 专属现象），不在本次修复范围内。

**Independent Test**: 对 extraction 路覆盖目录内的 `.pyi` 文件产出的 module 节点跑 `graph_node` 查询，断言其 `label` 字段等于剥离 `.pyi` 后缀的纯模块名，其 node id 仍保留完整 relPath。

**Acceptance Scenarios**:

1. **Given** extraction 路覆盖目录内的 `mod.pyi` 产出一个 module 节点，**When** 查询该节点，**Then** `label` 字段为 `mod`（不含扩展名），`id` 字段为完整 relPath（含 `.pyi` 后缀，与 `mod.py` 的节点 id 天然区分）。
2. **Given** extraction 路未覆盖目录内的 `.pyi` 文件（仍走 unified 单路，如落在 `test`/`tests` 差集内），**When** 查询其 module 节点，**Then** `label` 保持原始文件名（如 `mod.pyi`），此为既定通例，不视为缺陷。

---

### Edge Cases

- **stub-only 模块**（无同名 `.py` 兄弟）：extraction 路扩集后，应正常产出「module 节点 + component 节点 + contains 边」，因为不存在 shadow 对，护栏 A/B 的行为退化为「按 `.pyi` 单文件正常处理」，无需特殊分支。
- **stub-only 模块的孤立度（护栏 A 反向推论 + 组合形态登记，新增，W5；plan 实现裁定同步）**：有意结果——stub-only `.pyi` 模块永不会有 import 入边（`pyModuleMap` 构建时显式跳过 `.pyi`，不产生任何 `.pyi` 键；候选路径恒为 `.py`/`__init__.py`，不会有其他模块的 import 解析指向它）。与「空 `.pyi`」形态叠加时，空的 stub-only `.pyi`（如空 `__init__.pyi` 包标记，pytest 实测中的主流形态）在图中会是一个完全孤立的零度 module 节点——这是功能无害的组合结果（module 节点不进任何 F217 质量门分母），属设计结果而非回归，不需要额外处理。
- **shadow 对**（`mod.py` + `mod.pyi` 同目录并存）：两者各自产出独立 symbol/module 节点（node id 因 relPath 不同而不冲突）；但 import 解析（护栏 A）恒指向 `mod.py`，不产生指向 `.pyi` 的 import 边；fuzzy 查询若命中两个候选，须将两者都显式回传供 agent 判断，不得静默择一。
- **大小写变体 `.PYI`**：沿用既有 `PY_WALK_SURFACE`/`PYTHON_SYMBOL_SCAN_SURFACE` 的 `case-sensitive` 匹配语义（与 `.py`/`.PY` 现状一致），`.PYI` 不被采集，行为与现状对 `.PY` 的处理保持一致，不新增大小写特判。
- **`.pyi` 文件解析失败**（如语法错误的 stub）：沿用现有 `analyzeFile` 的 `parseError` 降级分支——记录 metadata 中的 parseError 信息，不产出该文件的 symbol 节点，不静默吞掉错误，也不中断整体批处理；FR-005 的 label 剥离修正须同时应用于该降级分支，不能只修正正常分支。
- **`@overload` 同名多签名**（新增，W3 沿用/I1 措辞精修）：`@overload` 装饰的同名函数在同一 `.pyi` 内会在 skeleton `exports` 层面产生多个同名条目，但 extraction 路写入层 `upsertNode`（last-write-wins + metadata 合并）/`upsertEdge`（按 `(source, target, relation, directed)` 键去重）按 id 收敛（`nodeMap.set` 是 unified 路的写法，非本条涉及的写入路径），最终图中**不产生重复节点/边**（已实证）。建议补一条单测探针钉住该收敛行为（见 FR-011），防止未来写入逻辑变更后悄然产生重复节点，但该探针不是本次核心裁决的可行性前提。
- **空 `.pyi` / 仅含注释的 `.pyi`**（新增，W4 沿用/C2 订正）：`skeleton.exports` 为空，产出零 component 节点，仅有 module 节点，且该节点为零度（已实证）；因 F217 orphan / contains-coverage 等质量指标的分母均为 `metadata.unifiedKind === 'symbol'` 的符号节点，module 节点不计入分母，故零度 module 节点不触发任何质量门失败，不视为异常。**修正对既有证据的过度外推**：实测中 pytest 的 8 个 `.pyi` 文件多为 `__init__.pyi` 包标记文件，但这不代表所有 stub-only 场景都是包标记——空/仅注释形态与「有实质类型声明的 `__init__.pyi`」是两类不同的实例，均需被正确处理，不应把观测样本的构成比例当成场景的全部可能形态。
- **`__init__.pyi` 包标记文件**：作为普通 `.pyi` 文件处理，无特殊逻辑；若含实质符号声明，其产出的 module 节点 label 经护栏 B 剥离为 `__init__`（与 `__init__.py` 的既有 label 语义一致）；若为空/仅注释形态，见上一条。
- **`if TYPE_CHECKING:` 块内的 import**（新增，I3 沿用）：缩进在该块内的 import 语句不被现有 Python 解析采集，这是 `.py` 与 `.pyi` 共有的既有解析行为（非本次改动引入），不在本次回归修复范围内，仅作为已知边界登记。
- **`.pyi` 文件内符号的 callSites 抽取**：stub 函数体恒为 `...`（无实现），天然产生零 callSites，不需要新增特判逻辑，属于现有解析行为的自然结果。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `src/collector-surface.ts` 中的 `PYTHON_SYMBOL_SCAN_SURFACE` SSoT 常量 MUST 将 `extensions` 集合从 `['.py']` 扩展为 `['.py', '.pyi']`，与既有 `PY_WALK_SURFACE`（skeleton 采集面）保持一致；`matchSemantics` 保持 `case-sensitive` 不变。`[必须]`
- **FR-002（前提已随基座演进更新）**: `scanPyFiles` 已由姊妹分支 F243（W-002 收敛）改为消费 `surfaceMatchesFile(PYTHON_SYMBOL_SCAN_SURFACE, ...)`（`python-adapter.ts:153`），与原硬编码 `entry.name.endsWith('.py')` 逐字等价，不再是待改事项。本次 MUST 保持该 SSoT 消费形态不回退——扩集行为完全由 FR-001 的常量值变化自动生效，`scanPyFiles` 本体零改动；并 MUST 补一条防回归探针锁定该消费点，防止未来被改回硬编码字面量判断。`[必须]`
- **FR-003**: `extractSymbolNodes` 与 `buildModuleGraph` 两条消费链路 MUST 在扩集后同步生效，各自的真实产物范围如下（本 FR 只涉及 extraction 路与 `ModuleGraph` 分析视图，不涉及独立于本次改动的 unified-graph 路——unified 路对 `.pyi` 的成员级符号产出是既有能力，见「背景」章节）：
  - `extractSymbolNodes`（单一函数）MUST 对 `.pyi` 文件同时产出「文件级 module 节点」「`relPath::name` 形式的 component 节点」「module → component 的 contains 边」三者全部（与其对 `.py` 文件的既有行为一致）。
  - `buildModuleGraph`（经 `buildModuleGraphFromCodeSkeletons` → `deriveModuleGraph`）MUST 对 `.pyi` 文件产出对应的 `ModuleGraph.modules` 条目（`source`/`inDegree`/`outDegree`/`level`/`isCircular`，不含 `label` 字段）与 import（`depends-on`）边，用于 SCC/拓扑排序/mermaid 分析视图。
  - 两条链路各自产出的「module 节点」是两套独立数据结构（前者是持久化知识图谱节点含 `label`，后者是 `ModuleGraph` 分析视图节点不含 `label`），仅在知识图谱写入层按节点 id 合并去重，不视为重复节点。`[必须]`
- **FR-004（护栏 A：import 解析目标排除，显式跳过实现，探针口径按实现审查如实登记）**: Python import 解析 MUST 永不将 `.pyi` 文件作为绝对 import 或相对 import 的解析目标：
  - 绝对 import 场景：`pyModuleMap` 构建时 MUST 显式跳过 `.pyi`（不写入其条目），`.py` 的键生成与遍历顺序保持一字不动——取代对现状「`.pyi` 产生 `mod.pyi` 键、恰与 `topModule` 不相等」这一双重意外安全的依赖；显式跳过同时断路了「label 剥离 helper 未来被顺手统一到 map 键生成、使 `mod.pyi` 键塌缩为 `mod` 与同目录 `mod.py` 撞键」的耦合事故路径（plan research 决策 1）。**探针口径如实登记（实现审查证实）**：防回归探针 MUST 锁定的是**解析结果等价行为**——shadow 对场景下 import 恒解析到 `.py`、零 `.pyi` 目标边；护栏 A（显式跳过）本身在黑盒下**不可观测**——`.pyi` 键即使被写入，也会因 `topModule = spec.split('.')[0]` 恒不含点而不可达，故不存在能证明「`pyModuleMap` 无 `.pyi` 键」的黑盒断言，本条 MUST NOT 虚设该断言，仅如实登记此不可观测性；护栏 A 显式跳过的价值体现在阻断上述「label helper 未来被统一到键生成后发生键塌缩」的事故——届时该解析结果等价探针将变红，即是该护栏发挥作用的可观测信号。
  - 相对 import 场景：`tryResolveAtDir` 的候选路径 MUST 恒为字面 `X.py` / `X/__init__.py`，不得将 `.pyi` 加入候选集合（零改动确认项）；MUST 配备显式 shadow 对防回归探针（`from . import mod` 解析到 `mod.py`、零 `.pyi` 目标边），本轮已由 `T-guard-a-relative` 落地。
  - 参考先例：TypeScript 侧 `src/core/import-resolver.ts:138` 的 `isNonSourceTarget` 与 `src/panoramic/generators/data-model-generator.ts:616` 对 `.d.ts` 的处理是同方向的既成设计（声明文件不作为解析目标，但仍可产出 symbol 节点），本 FR 是该模式在 Python 侧的对应实现。`[必须]`
- **FR-005（护栏 B：label 扩展名剥离修正，范围收窄为 extraction 路）**: `.pyi` 文件经 **extraction 路**（`extractSymbolNodes`）产出的 module 节点 `label` MUST 按文件真实扩展名剥离（`.py` → 剥离 `.py`，`.pyi` → 剥离 `.pyi`），不得对 `.pyi` 文件套用仅剥离 `.py` 后缀的逻辑（会导致 label 残留为 `mod.pyi`）；node `id` 字段 MUST 保持完整 relPath 不变，确保 `.py`/`.pyi` 两节点 id 天然区分。本条 MUST 应用于 `python-adapter.ts` 中 `extractSymbolNodes` 内当前硬编码 `path.basename(relPath, '.py')` 的**两处**label 生成逻辑（正常分支与 parseError 降级分支，两处都要修）。**明确排除范围**：`buildModuleGraph` 链路的输出结构不含 `label` 字段，不受本条约束；**unified-graph 路**（`deriveNodesFromSkeletons`）产出的 module 节点 label 采用原始文件名（对所有语言的既定通例，非 bug），不在本条修复范围内，也不因 extraction 路先写入而改变其自身生成逻辑——`.pyi` 节点最终展示的 label 之所以变为剥离后形态，是因为 extraction 路先写入图、unified 路对已存在节点「只补缺不覆盖」（不含 label 覆盖）的合并语义所致，而非 unified 路自身被修改。`[必须]`
- **FR-006**: `tests/unit/collector-surface.test.ts` 中 `PY_SCAN_SAMPLES` 里对 `mod.pyi` 「MUST NOT 命中」的既存断言 MUST 翻转为「MUST 命中」，且原「两面失配如实存在」的对拍测试断言 MUST 改写为「两面（walk 与 symbol scan）扩展名集合一致」语义；`legacy.PY`（大小写变体）MUST NOT 命中的断言与 `notes.md`（面外文件）相关断言保持不变。翻转后的探针 MUST 保留**硬编码的期望值列表**（如 `['mod.py', 'mod.pyi']`），禁止改写为仅由被测常量自身反向推导出期望值的自证断言（self-referential assertion）——后者会使探针对「常量被误改」这类回归失去检测能力。`[必须]`
- **FR-007**: `tests/fixtures/collector-fingerprint-guardrail/` 下两份 pinned 资产 MUST 通过 `scripts/regen-collector-fingerprint-fixtures.ts` 再生，具体 delta 范围如下（较初版收窄/精确化——`.pyi` 对应节点并非本次新增，而是既存节点的字段级变化）：
  - `expected-graph-only-graph.json`：`src/py/mod.pyi` 的 module 节点与 `src/py/mod.pyi::mod_fn` symbol 节点**已存在**（unified 路产出），本次 delta 是这两个既存节点的**字段级变化**：
    - module 节点：`label` 从 `mod.pyi` 变为 `mod`；`sourceTag` 从既存值 `'unified-graph'` **改值**为 `'extraction'`（该键已存在，非新增键）；**新增** `sourceFile: 'src/py/mod.pyi'` 与 `confidence: 'EXTRACTED'` 两键（graph-builder extraction 路对每个节点无条件写入 `sourceTag`/`sourceFile`/`confidence` 三键，样板参照同资产 `src/py/mod.py` module 节点的既有写法）。
    - symbol 节点（`src/py/mod.pyi::mod_fn`）：新增 `signature`/`symbolKind`/`sourceFile`/`confidence: 'EXTRACTED'` 等字段，同时保留 unified 路合并补缺的既有字段（`unifiedKind`/`sourcePath`/`exportKind` 等）不丢失；此清单不变。
    - 另加上 `fingerprint.extensionSurface.pythonSymbolScan` 指纹分量变化。
  - `expected-module-graph.json`：该资产的 `moduleGraph.modules` 本就零 python 条目（仅 ts-js），本次 delta **仅限于**内嵌 `fingerprint.extensionSurface.pythonSymbolScan` 从 `['.py']` 变为 `['.py', '.pyi']`，不涉及 `modules[]` 内容变化。
  - 再生脚本的二元拒绝判据（内容变化但指纹未变则拒绝）MUST 保持不被绕过。`[必须]`
- **FR-008**: `src/collector-surface.ts` 中 `PYTHON_SYMBOL_SCAN_SURFACE` 相关注释 MUST 从「记账现状 / 待产品裁决」更新为「已裁决设计意图」，并明确标注 `.pyi` 产出的符号是**类型面 stub 符号**（函数体恒为 `...`，非实现符号），不得使用可能造成"stub 符号与实现符号语义等价"误解的措辞；`src/adapters/python-adapter.ts` 中 `extensions` 字段与 `scanPyFiles` 文档注释里「声明面与扫描面不一致」的相关表述 MUST 同步更新，避免同一代码库中出现自相矛盾的两份注释；`src/panoramic/graph/collector-fingerprint.ts` 约 :44-46 处「`pythonSymbolScan` 与 `pyWalk` 刻意分列（因为采集面确实不同）」的注释措辞，MUST 同步改写为「两者分列是为了保留各自管线身份与指纹 key 的独立稳定性，其扩展名集合自本次 F250 起趋于一致，但仍作为两个独立指纹分量分别追踪，以便未来任一管线单独变化时能被独立感知」。`[必须]`
- **FR-009**: `extensionSurface` 指纹机制 MUST 因 `PYTHON_SYMBOL_SCAN_SURFACE` 扩展名集合变化而自动产生不同的指纹值，使存量图在下次 freshness 检查时被判定为 stale 并触发重建；本次改动 MUST NOT 需要人工递增 `BEHAVIOR_VERSION`（扩展名集合增删属于该机制的既定自动反映范畴，不在 `BEHAVIOR_VERSION` bump 责任清单内）。`[必须]`
- **FR-010**: `.pyi` 文件解析失败时 MUST 沿用既有 `analyzeFile` 的 `parseError` 降级分支处理，记录于 metadata，不产出该文件符号节点，不静默丢弃错误，不中断整体批处理流程。`[必须]`
- **FR-011（回归探针，非核心裁决前提）**: 建议新增一条单测断言 `@overload` 装饰的同名多签名函数在 extraction 路写入后不产生重复节点/边（见 Edge Cases「`@overload` 同名多签名」）——收敛机制是 extraction 路写入层的 `upsertNode`（last-write-wins + metadata 合并）/`upsertEdge`（按 `(source, target, relation, directed)` 键去重），而非 `nodeMap.set`（后者是 unified 路的写法）。`[可选]`——去掉该探针不影响本次核心裁决可行性，图的收敛行为已由写入层保证且已实证正确；缺少探针只是失去一条显式的未来回归防线，故标注为可选而非必须。

### Key Entities *(include if feature involves data)*

- **PYTHON_SYMBOL_SCAN_SURFACE**：`src/collector-surface.ts` 中定义的 SSoT 采集面二元组 `{extensions, matchSemantics}`，本次扩展 `extensions` 为 `['.py', '.pyi']`，是本 story extraction 路改动的核心对象。
- **extraction 路 module 节点（知识图谱持久化节点）**：由 `extractSymbolNodes` 对 Python 文件（`.py` 或 `.pyi`）派生出的图节点，`id` 为完整 relPath，`label` 为剥离真实扩展名后的模块名，`sourceTag: 'extraction'`；`.pyi` 派生的 module 节点是本次新增覆盖面。
- **extraction 路 component 节点（顶层符号节点）**：`relPath::name` 形式的符号节点，代表**顶层导出**的函数/类等声明，metadata 含 `symbolKind`/`signature`/`sourceFile`/`confidence: 'EXTRACTED'`；`.pyi` 产出的 component 节点均为类型 stub 符号（函数体恒为 `...`）。
- **unified-graph 路 symbol 节点（成员级节点，既有能力，非本次新增）**：由 `deriveNodesFromSkeletons` → `buildUnifiedGraph` 产出，覆盖**成员级**符号（含类属性形如 `Cls.attr`），metadata 含 `unifiedKind`/`sourcePath`/`exportKind`/`memberKind`，不含 signature/symbolKind/confidence；`.pyi` 文件当前即由此路产出可查询的 symbol 节点。
- **节点合并语义**：extraction 路先写入图；unified 路对已存在节点只补缺不覆盖（补充 unifiedKind 等字段），对不存在节点才新建；两路产出在同一节点上共存，互不冲突。
- **ModuleGraph（分析视图）**：由 `buildModuleGraph`（经 `deriveModuleGraph`）产出的独立数据结构，含 `modules[]`（`source`/`inDegree`/`outDegree`/`level`/`isCircular`，不含 `label`）与 `depends-on` 边，服务于 SCC/拓扑排序/mermaid 渲染；与知识图谱持久化 module 节点是不同结构，仅按 id 合并去重。
- **extensionSurface（collector-fingerprint）**：图 metadata 中记录采集面配置的指纹分量，随 SSoT 集合变化自动更新，驱动 freshness/stale 判定。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `tests/unit/collector-surface.test.ts` 中翻转后的探针断言（`.pyi` MUST 命中 symbol scan surface、walk 与 symbol scan 两面一致、断言保留硬编码期望值列表）全部通过。
- **SC-002**: 对护栏 fixture（`tests/fixtures/collector-fingerprint-guardrail/`）与本仓真实图分别验证以下三层，全部通过：
  - **(a) 回归口径**：本仓真实图重建（graph-only）后，`graph-quality` CLI 中除 freshness 外的质量指标（duplicate / orphan / dangling / ignored 等，可用 `--graph` 显式指定路径）全部保持 pass，freshness 按 (c) 口径单独评估。
  - **(b) fixture 口径**：护栏 pinned 资产（`expected-graph-only-graph.json`/`expected-module-graph.json`）再生后与预期逐字段相等（见 FR-007 的 delta 定义）。
  - **(c) 指标语义澄清**：duplicate 指标验证 `.py`/`.pyi` 同名符号因 relPath 前缀不同而不产生假重复（三元组含 filePath 天然区分）；orphan 指标验证 `.pyi` 的 symbol 节点（分母为 `metadata.unifiedKind === 'symbol'` 的节点，module 节点不计入分母）经 contains 边保证非孤立；freshness 指标在 fixture staging 目录（非 git 仓库）下判定为 `unknown-provenance` 属预期行为，不计入本次验收的 pass/fail 判定（该取值本身即非 pass/fail 二元结果，而是 `fresh|dirty|stale|unknown-provenance` 四态之一）。
  - **补充说明**：本仓唯一的 `.pyi` 文件（`tests/fixtures/collector-fingerprint-guardrail/src/py/mod.pyi`）位于 `scanPyFiles` 的剪枝集内（落在 `tests` 目录下），故本仓真实图重建后本 feature 的行为增量为零，(a) 是纯回归守卫（确认扩集不引入意外破坏），并非本 feature 生效的验收载体。本 feature 真正的生效验收全部由 (b) fixture 口径承载。该同一份 `.pyi` 文件同时可作为 US3 Acceptance Scenario 2 / SC-005 的 walk-only 对照组使用，无需为此新造 fixture。
- **SC-003**: `scripts/regen-collector-fingerprint-fixtures.ts` 对新增字段的内容变化正确接受再生（内容变化 + 指纹变化 → 接受），且再生后的 pinned 资产被 git 提交纳入护栏。
- **SC-004**: 针对 shadow 对（`mod.py` + `mod.pyi`）的 import 解析防回归探针（护栏 A）100% 通过，验证所有 import 解析结果指向 `.py` 而非 `.pyi`。
- **SC-005**: 针对 extraction 路 `.pyi` module 节点 label 剥离的防回归探针（护栏 B）100% 通过，验证 label 不含扩展名残留；同时验证 extraction 路未覆盖目录内 `.pyi` 节点的 unified 路原始文件名 label 不受影响（对照组，防止误改跨语言通例）。
- **SC-006**: 全量 `npx vitest run` 与 `npm run build` 零失败。
- **SC-007**: 对 `.pyi` symbol 节点跑 `graph_node`/`context` 查询，验证其 metadata 含 `signature`/`symbolKind`/`confidence: 'EXTRACTED'`/`sourceTag: 'extraction'`（本次改动前该节点已可查询但缺失这些字段，本次改动后新增这些字段）。此前该场景是「节点已存在但元数据不含签名信息」，而非初版所述「symbol-not-found」；SC-007 验证的是元数据精度提升而非可见性从无到有。

## Dependencies & Compatibility

- **上游依赖**：本分支基于姊妹分支 F243（commit `3cdd89f`，`specs/243-graph-collector-fingerprint/`）尚未合并 master 的产物（`src/collector-surface.ts`、`collector-fingerprint.ts`、护栏 fixture 与再生脚本）。**F243 必须先行交付 master**，本 story 才能 rebase 到最新 master 后交付；交付顺序不可颠倒。
- **兼容性影响（指纹 stale 触发重建）**：本次改动会导致 `extensionSurface.pythonSymbolScan` 分量变化，任何现存已构建图（含存量 baseline fixture 之外的用户实际图谱）在下次访问时会被 freshness 检查判定为 stale 并触发重建（graph-only 模式约 3.5s 量级，取决于代码库规模）。这是 F243 指纹机制的既定设计意图（「扩展名集合增删自动反映到指纹并驱动重建」），非本 story 引入的意外行为，此处显式记录以避免被误判为回归。
- **已知盲区（W6，登记不修复）**：本次改动同时触发了 `extensionSurface` 分量变化（因为扩展名集合本身变了），因此「label 生成口径变化」这件事**顺带**被指纹重建覆盖到。但若未来出现「仅改变 label 生成逻辑、不改变扩展名集合」这类改动，该类改动**不会**反映到 `extensionSurface` 指纹分量，也不在 `BEHAVIOR_VERSION` bump 的六类责任清单内——届时可能出现「产品行为变了但指纹未变、旧图不会被判 stale」的静默覆盖盲区。本次不为此新增任何指纹维度或机制（YAGNI：当前唯一触发该问题的改动本身已被现有机制覆盖），仅在此显式登记，供未来纯 label/展示层改动的实现者参考。
- **不影响范围**：`walkPyFiles`（skeleton 采集面）与 dirty/freshness 判定逻辑本次不变（已在 F243 中处理 `.pyi` 的 skeleton 采集与 dirty 触发）；`.mts`/`.cts` 扩展名残留问题（F243 已登记）不在本次范围；TypeScript 侧 `.d.ts` 语义（含其 import 解析目标排除）不做复审改动，仅作为护栏 A 的先例引用；Python callSites 抽取逻辑无需特判改动（stub 天然产生零 callSites）；unified-graph 路的 label 生成逻辑（跨语言原始文件名通例）不做任何修改。反向差集（`build`/`coverage`/`out`/`target` 等目录被 `walkPyFiles` 剪枝但不被 `scanPyFiles` 剪枝）下的 `.pyi` 将成为 extraction-only 节点（无 `unifiedKind`，不进 F217 分母）——`.py` 在这些目录早已是同样形态（非本次引入），本次只是 `.pyi` 加入该面，如实登记不处理。

## Out of Scope

- `walkPyFiles`/skeleton 采集面的行为改动（本次保持不变）。
- `.mts`/`.cts` 扩展名覆盖面问题（F243 已登记的独立残留项，另行处理）。
- TypeScript 侧 `.d.ts` 语义复审（既成产品行为，不在本次改动范围，仅作为护栏 A 的同向先例引用）。
- shadow 对场景下 stub 与实现符号的语义合并/去重（若未来出现真实需求再单独立项）。
- Python callSites 抽取能力的改动（stub 无函数体，天然零 callSites，无需特判）。
- unified-graph 路 module 节点的 label 生成口径（对所有语言均采用原始文件名的既定通例）不在本次改动范围，仅 extraction 路覆盖目录内的 `.pyi` label 受本次修复影响（见 US3 范围说明）。

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**：0 新增。本次改动均落在既有模块内部：`src/collector-surface.ts`（常量扩展 + 注释）、`src/adapters/python-adapter.ts`（label 生成两处分支 + pyModuleMap 构建跳过 `.pyi` 逻辑）、`src/panoramic/graph/collector-fingerprint.ts`（注释同步）、`tests/unit/collector-surface.test.ts`（探针翻转）、`tests/fixtures/collector-fingerprint-guardrail/`（pinned 资产再生）。
- **接口数量**：0 新增/修改契约。仅扩展既有 SSoT 常量的取值（`extensions` 数组增加一项），不改变任何函数签名、导出接口或数据结构 schema。
- **依赖新引入数**：0。
- **跨模块耦合**：涉及 4 个既有模块（collector-surface / python-adapter / collector-fingerprint / 测试与 fixture），但均为字面量常量值或注释级改动，无接口签名变化，模块间调用关系不变。
- **复杂度信号**：无递归结构、无状态机、无并发控制、无生产环境数据迁移（fixture 再生是测试资产更新，非线上数据迁移）。
- **总体复杂度**：**LOW**（组件 < 3 且接口 < 4 且无复杂度信号）。
