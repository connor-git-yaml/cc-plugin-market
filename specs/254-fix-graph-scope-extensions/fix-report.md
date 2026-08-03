# 问题修复报告

## 问题描述

F249 rebase 调和（2026-08-03）发现 d27ba75（对方 F243 ".mjs/.cjs 扩面四处同步收口"）漏网**第五处**：`plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs` 的 `GRAPH_SCOPE_EXTENSIONS` 仍是 4 扩展（`.ts/.tsx/.js/.jsx`），其注释自称"图 walker 白名单（source-discovery.ts 只收这四类）""全仓唯一定义处"——两个断言均已失真：source-discovery 的 TSJS walker 已收 6 扩展（含 `.mjs/.cjs`），且图内实际有 1040 个 `.mjs` 相关节点。

**后果**：F241 的图消费决策把 `.mjs` 改动判为 `out-of-graph-scope`（矩阵行 2 → `consume-degraded`，提示"退回 Grep/Read"），跳过图刷新与 impact 注入——正是该常量注释警告要避免的"范围内不注解、范围外反而注解"自相矛盾。F249 spec v6 已将其登记为"第七处镜像（跨语言，显式不修）"，建议单独立项（即本 fix）。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `.mjs` 改动为何被判 out-of-graph-scope？ | `graph-consumption-cli.mjs::collectCoverageScope`（L216）与 `decision.mjs::annotateImpactCaveat`（L404）共用 `GRAPH_SCOPE_EXTENSIONS = ['.ts','.tsx','.js','.jsx']`（L53），`.mjs` 不在白名单内 |
| Why 2 | 白名单为何还是 4 扩展？ | F241 立项时如实快照当时 walker 现实（O-5），并以 D6 显式登记".mjs 缺口本 feature 不修"；d27ba75 扩面收口时只同步了 **src 侧**四处镜像（walk 白名单 / source-commit / ignore-oracle / cache-key），plugins 侧这第五处消费点漏网 |
| Why 3 | 跨侧同步为何会漏？ | 跨语言边界：plugins 侧是纯 `.mjs`（Node 直跑，无 build），无法 import src 侧 TS 常量；F243 的巡检面按 src 侧镜像常量名（`TSJS_COLLECTOR_EXTENSIONS` 等）与字面量形态 grep，plugins 侧常量名（`GRAPH_SCOPE_EXTENSIONS`）与注释措辞不同构，搜索不命中 |
| Why 4 | 为何没有跨侧一致性机制？ | F241 的 C-002 只防了 plugins 侧**内部**第二份白名单（decision 与 CLI 共 import 一份）；src↔plugins 的一致性无合同可锚——采集面 SSoT（`src/collector-surface.ts`）到 F249 才建立，F241/F243 时代无处可挂 |
| Why 5 | 为何未被测试/门禁捕获？ | F241 防漂移断言（decision.test.mjs L507）断言"恰为这 4 项"——锁的是**自身快照**而非**与图真实采集面的一致性**，扩面后反而固化失真（"镜像测试镜像残缺面"，与 F243 教训同款）；graph-quality / repo:check 均无 plugins 侧决策白名单 ↔ 图采集面的交叉校验 |

**Root Cause**: 图采集面扩面时，跨语言消费点（plugins 侧 F241 决策白名单）因无 SSoT 锚定、无跨侧同步机制而漏同步；防漂移断言锁快照不锁一致性，结构性无法暴露该类漂移。

**Root Cause Chain**: `.mjs` 判 out-of-scope → 白名单 4 扩展 → d27ba75 扩面只同步 src 侧四镜像 → plugins 侧跨语言无法 import、巡检 grep 不同构 → 无 SSoT 锚定与跨侧合同（F249 前 SSoT 不存在）→ 快照型断言固化失真而非暴露失真

**[ROOT CAUSE REACHED at Why 5]**

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs` | L48-53 | 常量定义 + 两条失真注释 | 值更新为图真实采集面 fallback + 注释按新语义改写 |
| 同上 | L404 | `annotateImpactCaveat` caveat 判据闭包引用 | 参数化 `scopeExtensions`（默认 fallback，CLI 注入动态面） |
| `plugins/spec-driver/scripts/graph-consumption-cli.mjs` | L48, L216-226 | `collectCoverageScope` 闭包引用同一常量 | 参数化 + 决策前读图自述面（`graph.fingerprint.extensionSurface` 并集），读不到 fallback 静态面 |
| `plugins/spec-driver/tests/graph-consumption-decision.test.mjs` | L507-511 | 快照型防漂移断言（恰为 4 项） | 按新语义重写：fallback 面断言 + 唯一定义处断言保留 + 参数注入行为用例 |
| `plugins/spec-driver/tests/graph-consumption-cli.test.mjs` | L1223 | 范围外扩展名拒绝注解用例 | 按动态面/静态 fallback 双通道更新，补 fingerprint 图用例 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| 图多语言采集面（`.py/.pyi/.java/.go`，`walkPyFiles`/generic adapters） | source-discovery.ts 等 | F241 白名单从立项起只覆盖 TSJS 面，多语言扩展同样被判 out-of-scope | **需修复（同根因第二层）**：`.py` 早于 F241 已在图内（walkPyFiles 系 F220 前搬迁产物），白名单对其失真自 F241 起即存在，仅因无人对这些扩展跑 decide 未暴露。动态面并集天然闭合此层 |
| src 侧四处镜像常量 | walk/source-commit/ignore-oracle/cache-key | d27ba75 的镜像同步形态 | **安全**：F249 已将四处收敛为 `TSJS_SKELETON_WALK_SURFACE` SSoT 引用，镜像常量已消亡 |
| `MODULE_DERIVATION_SCAN_SURFACE` 的 `.mts/.cts` | collector-surface.ts | 声明面比 skeleton 采集面宽（如实记账） | **纳入并集**：`.mts/.cts` 改动会反映在 module 层节点，判 in-scope 方向正确；skeleton 无 symbol 导致 directCallers=0 时挂保守 caveat 亦为正确方向 |

### 同步更新清单

- 调用方: `spec-driver-feature` SKILL.md 两份（skills/ + skills-codex/）经 CLI 调用 decide/annotate-caveat——CLI 参数形态不变，**零改动**；输出新增 `scopeExtensionsSource` 可观测字段为 additive
- 测试: 上表两份既有测试更新；**新增跨语言合同测试**（vitest，TS 侧）：`collector-surface.ts` SSoT 推导并集 ↔ 动态 import `decision.mjs` 的 fallback 常量，断言逐项一致（把"第七处镜像"永久钉死在 SSoT 上，堵 Why 4/5）
- 文档: F241/F249 已 ship 的 spec 为历史文档不回改，本 fix spec 声明语义修订与闭合关系；`docs/design/milestone-M9-*.md` 属历史叙述不动；产品级 current-spec.md 无旧白名单引用（已 grep 核实）

## 修复策略

### 方案 A（推荐）：图自述面优先 + SSoT 锚定 fallback + 跨语言合同测试

1. **决策模块**（保持纯函数、零 import 硬合同不变）：
   - `GRAPH_SCOPE_EXTENSIONS` 更新为图生产管线采集面**全并集 12 扩展**（`.ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts/.py/.pyi/.java/.go`），语义降格为**静态 fallback**（图产物无自述面时使用）；注释改写为声明 fallback 语义 + SSoT 锚点（`src/collector-surface.ts::ALL_PRODUCER_SURFACES`）+ 一致性由合同测试守护
   - `annotateImpactCaveat` 增第 4 可选参 `scopeExtensions`（默认 fallback 常量），保持 C-002"两处判据同一份面"
2. **CLI**：五维采集时读一次 `graph.fingerprint.extensionSurface`（复用 `graph-bootstrap-status.mjs` 的 W5 尺寸保护读取机制，MAX_JSON_BYTES=256MB），全管线并集为动态面；missing/corrupt/too-large/旧图无指纹/结构畸形 → fallback 静态面。决策与 caveat 全程用同一份面；输出与审计事件加 `scopeExtensionsSource: 'graph-fingerprint'|'static-fallback'`
   - 读取落点二选一交实现裁量：B1 独立新函数二次读文件（改动最小）；B2 泛化出 `readEmbeddedGraphMeta` 一次读取 sourceCommit+fingerprint、`readEmbeddedSourceCommit` 薄壳化（避免 4.5MB 图读两次，架构更净，推荐）
3. **合同测试**：新增 vitest 用例 import SSoT 推导并集 ↔ 动态 import decision.mjs fallback 常量逐项断言
4. **既有测试**按新语义更新（见影响范围表）

**为什么动态优先**：coverageScope 语义 = "改动能否反映在**手里这份图**里"，而 F249 的 `DIRTY_SOURCE_SURFACES = ALL_PRODUCER_SURFACES` 已把"哪些文件改动影响图"定义为 SSoT 并写入图自述指纹——决策白名单消费同一个面即语义闭环；未来扩面时图自述面自动跟随，**零同步成本**，fallback 合同测试只是二道防线。

### 方案 B（备选）：仅静态修正 + 合同测试

白名单静态改 12 扩展 + 跨语言合同测试，不做动态读取。改动更小，但图产物与白名单的时点漂移仍在（旧图配新面会把图里没有的扩展判 in-scope），且下次扩面仍需人肉同步（合同测试红灯兜底）。不推荐：放弃了 F249 指纹机制送到手边的架构闭环。

## Spec 影响

- 需要更新的 spec: 无需回改已 ship 的 F241/F249 spec（历史文档）；本 fix 的 `spec.md` 不单独产出（fix 模式以 fix-report + plan 为准），F241 的 FR-006(d)/C-002 字面白名单语义以本 fix 为准的声明记入本报告与 commit message
- 产品级活文档: 无引用，无需更新

## 审查处置与残留登记（Phase 4 补记）

Phase 4a spec-review：**PASS**（0 CRITICAL / 0 WARNING / 1 INFO——审查方式边界，工具链验证由 4c 承担）。
Phase 4b quality-review：**PASS_WITH_WARNINGS**（0 CRITICAL / 3 WARNING / 3 INFO），编排器逐条裁决如下：

| 项 | 内容 | 裁决与处置 |
|----|------|-----------|
| W-1 | TOCTOU 极窄缺口：decide 时 static-fallback 判 in-scope → annotate 时同 sourceCommit 图带收窄指纹 → FR-010 过、`consume-impact` + 零 caveat（比修复前少一层信号且无替代提示） | **不改行为**（触发条件=同 commit 下并发升级 collector 且重建图，理论上不该发生；失败方向为"少一层提示"而非误导声明，与 D7 红线同向）。**补 1 条现状钉住用例**把静默行为显式固化为已知基线（4b 定性为测试覆盖缺口）；"审计事件追加诊断字段"登记为 follow-up 候选，不在本 fix 做 |
| W-2 | `FINGERPRINT_SURFACE_KEYS`（cli.mjs）是 TS 侧 `EXTENSION_SURFACE_KEYS` 的手写副本，合同测试未覆盖 key 列表一致性——与本 fix 根因同形态（失败方向安全：漂移→严格核验失败→静默回落 static-fallback） | **已修**：export 该常量（合同测试锚点，注释写明用途与静默风险）+ 合同测试新增 key 集合一致性断言（SSoT 锚点取 `computeCollectorFingerprint().extensionSurface` 的 keys，未动 SSoT 导出面）。变异验证：改坏一个 key → 仅新断言红（其余 4 项绿，实证"静默"特性：1320 项 plugins 测试对该变异全绿）→ 还原复绿 |
| W-3 | annotate-caveat 输出顶层与嵌套 `decision` 同名字段 `scopeExtensionsSource` 属两个时间窗口，易读错 | **保持**："顶层=本进程时点"是 decide/annotate 两个子命令的对称设计；改名会造成同语义字段跨命令不同名，更差。记录为设计权衡 |

### 内部对抗复审轮（commit 前终态 diff，独立第二视角，opus）

结论 **PASS_WITH_WARNINGS（0 CRITICAL / 3 WARNING / 5 INFO）**，其中抓到一处真实设计缺陷，全部裁决如下：

| 项 | 内容 | 裁决与处置 |
|----|------|-----------|
| 复审 W-1 | **矩阵行 2 位置前提失效（自锁缺陷）**：行 2（out-of-scope 早退）先于刷新分支的唯一论证"范围外重建也进不了图"只对编译期常量面成立；面改为图自述后，面窄恰因图旧、重建正好能纳入目标。实测：窄指纹旧图 + 面外改动 + stale × allowed → rule 2 降级、刷新永不发生——下次采集面扩容时把本 fix 的核心承诺静默作废（与 Why5 同构）。今天不可达（F249 起所有带指纹图声明全 12 扩展） | **已修**：CLI 五维采集处 coverage 判据面按 refreshPolicy 分支——declined 用 `derived ?? static`（当下图实际面，不重建则判 out-of-scope 正确）、allowed 用 `union(derived, static)`（重建可达面，目标入刷新链后新图自然含之）。矩阵 13 行与 decision.mjs 零改动、EC-07 不触碰。新增输出/审计布尔 `coverageUnionApplied`（decide 侧；annotate 侧无重建语义刻意不加）。行为用例 (h)/(i)/(j) 三条 + 变异验证（分支强制关闭 → h/j 双红 i 绿） |
| 复审 W-2 | `deriveScopeExtensionsFromFingerprint` 对多出的未知管线 key 静默忽略——产出注释明令禁止的"部分并集"（TS 侧是严格 key 集合相等） | **已修**：加 key 数量核验（五 key 齐 + 无多余，任一不满足整体回落 null）；(d) 畸形表补第 9 例（多余 rustAdapters key） |
| 复审 W-3 | `formatVersion !== 1` 是第三处未锚定跨语言手写副本（TS 一 bump，plugins 永久回落零报错），与 4b W-2 处置不一致 | **已修**：提为导出常量 `SUPPORTED_FINGERPRINT_FORMAT_VERSION` + 合同测试锚定断言（取 `computeCollectorFingerprint().formatVersion`，不动 TS 侧导出面） |
| INFO-2/3/4 | 用例 (d) 注释失实 / text 格式不渲染新字段 / JSDoc `value?:` 过松 | **已顺手修**（注释改准确、renderDecisionText 补两字段、JSDoc 收紧） |
| INFO-1 | 新增合同测试文件不被任何 tsconfig/门禁类型检查，`@ts-expect-error` 既不误报也不提供保护；plan §5.3"build 会类型检查该文件"声称不实 | **记账**（vitest esbuild 只剥类型；该 directive 服务 IDE 体验保留）；不改 tsconfig（范围外） |
| INFO-5 | `caveat-annotation` 审计事件缺封闭键集断言（decision 事件有），预存不对称 | **登记 follow-up**，非本次引入不扩范围 |

处置后经 delta 复审与 4c 增量复核确认（结果见 verification-report.md）。`AUDIT_SCHEMA_VERSION` 维持 3（同一次未发布变更内不重复 bump）。

### delta 复审轮（第 5 轮增量，同复审代理）

结论 **PASS_WITH_WARNINGS（0 CRITICAL / 2 WARNING / 2 INFO）**：W-1 分支四象限实测与裁决语义逐字吻合（derived=null 时 allowed 分支严格退化为修复前行为）、"数量相等但成分不同"的组合 key 形态确认不漏网。裁决与处置：

| 项 | 内容 | 裁决与处置 |
|----|------|-----------|
| delta W-1 | 新 26 行注释里"静态面==重建后新图自述面、论证恒真"是无锚定过度断言——重建由分开安装的 spectra 二进制执行，合同测试锚不到运行时 collector 的面；plugin/spectra 版本 skew 时并集仍可能窄于重建后真实面（与本 fix 根治的注释失真同物种） | **已修**：措辞收敛为条件式（同版本前提下恒真；skew 残留风险与修复前同向） |
| delta W-2 | 并集的 derived 半边零变异守护：把 allowed 分支改为"只用 static"后 (h)(i)(j) 全部存活——存活变异恰是 W-1 自锁的镜像方向（图自述面比 plugin 静态面宽的 skew） | **已修**：补用例 (k)（图声明 `.rs` 超集面 + `.rs` 改动 + allowed → in-scope + rule 8），变异自证红→绿 |
| delta INFO-1 | 刷新成功后 `scopeExtensionsSource`/`coverageUnionApplied`（决策时点）与重读的 `graphSourceCommit`（刷新后新图）并列同 payload，误读面大 | **已修**：payload 注释补"与 inputs 同属决策时点，刷新后不重算" |
| delta INFO-2 | 合同测试把 formatVersion 锚为"恒等于当前 producer 版本"——版本一 bump 所有存量图立即回落静态面，plugin 无法同时认多版本 | **记账**（与 TS 侧单版本口径一致，本迭代有意不做多版本兼容） |

其他登记：
- **Codex 对抗审查**：CLI 探活确认配额未恢复（2026-08-08 13:53 恢复），按 F249 先例走**内部对抗复审**路线：4b 高强度对抗审查（20+ 畸形指纹形态实测、TOCTOU 场景构造、独立变异复现）+ commit 前对终态 diff 的独立第二视角复审（即上表）+ delta 复审 + 编排器主线收口
- **F235 flaky 甄别**（全量 vitest 偶发 `Timeout calling "onTaskUpdate"` Errors 行）：判非回归依据三条——错误数随负载漂移（2→3）、报错栈全在 vitest rpc 层不含本仓文件、机器空闲后单跑 exit 0 且 Errors 消失；与已登记 F235（birpc 60s 超时，maxWorkers=CPU/2 后余量 1.2×）签名一致
