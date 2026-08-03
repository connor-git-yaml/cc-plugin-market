# F249 代码上下文摘要（story 模式调研替代产物）

> 编排器 2026-08-03 基于 master@264338b（含 F242）实地核查产出。所有行号以该 commit 为准。
> **v2 修订**：Specify 阶段 Codex 对抗审查（R1）证伪本文 3 处事实断言（C-001/C-002/C-003），
> 编排器逐条源码复核确认后修正；同轮新增 C-004（F214 门禁未接线）/C-005（schema 严格校验）/
> C-006（dirty 优先级）三处事实补充。修正处以 **[v2 修正]** 标记。
> **v6 修订（rebase 调和 · 2026-08-03）**：交付窗口内 master 已由 **d27ba75（对方 F243）**
> 落地 `.mjs`/`.cjs` 采集面扩展 —— §2 判定"master 源码不成立"的那个前提**现已成立**，
> 本文预言的"未来扩面"真实发生。同时本 Feature 撞号重编为 **F249**（原 F243 被 d27ba75 抢占）。
> 该扩面由本 Feature 的 SSoT 单点吸收（d27ba75 的四处镜像同步随之消亡）。
> 修正处以 **[v6 修正]** 标记；§2 原文保留不撤回（它对写作当时的 master@264338b 是准确的）。

## 1. 问题陈述（机制缺口）

`evaluateFreshness`（[source-commit.ts:150](../../src/panoramic/graph/source-commit.ts)）只比较
`recordedSourceCommit` vs 当前 HEAD + 未提交源码路径（按扩展名过滤面），**完全不感知
"collector 采集面/行为版本"**。后果：Spectra 升级改变图生产者行为后（采集面扩展、抽取
逻辑变更），旧图在"源码未动 + 工作树干净"时仍被判 `fresh`，graph-quality 六指标全 pass
无任何信号——图系统性缺节点/缺边但被完全信任。

**今天就能复现的实例（非假设）**：F242（264338b）改变了 call-edge 抽取行为（三级归属回退
+ 动态 import 绑定），同一源码在 F242 前后建图产出**不同的 calls 边集**（F242 验证数据：
2287 calls 边）。任何 F242 之前建的图，在源码 commit 未动的仓库上今天仍被判 fresh。

## 2. 用户前提修正（编排器实地核查）

任务陈述称"TSJS 采集面已从 4 扩展变 6 扩展（含 .mjs/.cjs）"——**master 源码不成立**：
`walkTsJsFiles`（[source-discovery.ts:509-514](../../src/batch/stages/source-discovery.ts)）
仍只收 `.ts/.tsx/.js/.jsx` 4 扩展。**[v4 修正]** `.mjs/.cjs` 不在 skeleton walk 采集面内，
但出现在 module 派生扫描（#7/#8，full batch 生产管线）、watcher 触发面与 import 解析层
（见 §4 盘点表逐处定性）——"skeleton walk 未扩"与"module 派生已收 8 扩展"两个事实并存。
但这不削弱需求成立性，反而强化：

- M9 §7.5.4 已登记 `plugins/**/*.mjs` 图谱覆盖缺口，未来扩采集面是既定方向——
  **F249 是安全做该扩展的前置条件**（没有指纹，扩面那天全球所有旧图静默变陈旧）。

  **[v6 修正]** 上述"未来"已在本 Feature 的交付窗口内到来：**d27ba75（对方 F243）**
  把 `.mjs`/`.cjs` 加入 `walkTsJsFiles`，且是在**指纹机制尚未上线**的前提下扩的面。
  因此本节推演的失效已成既成事实——所有 d27ba75 之前建的图从此系统性缺 `.mjs`/`.cjs`
  节点（该仓库量级：197 个 `.mjs` + 3 个 `.cjs`），而 freshness 对此零信号（源码 commit
  未动 + 工作树干净 → 判 `fresh`）。本条从"论证需求成立性的推演"升级为"已发生事故的
  事后归因"，指纹机制是该类静默陈旧的唯一检出手段。
  本轮 rebase 后，6 扩展面已收敛进 `TSJS_SKELETON_WALK_SURFACE` 单点表达（d27ba75 的
  四处手工镜像同步随之消亡），扩面语义完整保留并经其自带回归测试反向验证。
- **活漂移已存在**：`ts-js-adapter.ts:42` 声明 8 扩展（含 .mjs/.cjs/.mts/.cts），
  `module-derivation.ts:354` 8 扩展，但 skeleton walk 只收 4——"采集面无单一事实源"
  不是理论风险。**[v3 修正]** 注意 8 扩展的 module 派生扫描本身也是建图生产面
  （见 §4 #7/#8），"skeleton walk 4 扩展"与"module 派生 8 扩展"是两条并存的进图管线，
  不能再表述为".mjs/.cjs 只出现在声明/解析层"。

## 3. freshness 判定链路（现状）

| 环节 | 位置 | 行为 |
|------|------|------|
| 写入（batch 主链） | batch-orchestrator.ts:1500 | `graph.graph.sourceCommit = resolveSourceCommit(root)` |
| 写入（graph-only） | stages/graph-assembly.ts:255 | 同上（F195/F217） |
| 写入（`spectra graph`） | F217 决策 | 写 `null`（不解析源码，provenance 诚实降级） |
| 判定 | source-commit.ts::evaluateFreshness | 四态 fresh/dirty/stale/unknown-provenance；dirty 过滤面 = getDirtySourceExtensions() |
| 消费 A | cli/commands/graph-quality.ts（F217 六指标 CLI） | computeOverallVerdict: **stale→pass-with-warnings；dirty/unknown-provenance→不降级（pass）** |
| 消费 B | scripts/lib/graph-quality-core.mjs（repo:check 第 12 族） | **stale→warn；dirty 刻意不告警（FR-026 防提交前噪音）；unknown-provenance→pass** |
| 消费 C | scripts/lib/graph-bootstrap-status.mjs（F239 第 15 族基建） | specs/_meta/graph-bootstrap-status.json 状态快照 |
| 无关机制 | MCP graph-tools mtime/size 缓存 stale；F193 graph-format-stale（绝对路径格式） | 与 producer 版本无关，勿混淆 |

**Schema 版本门（FIX-7 双边界）**：graph-quality.ts:36 `MIN_SUPPORTED_SCHEMA_VERSION='2.0'`
同时是最低+最高支持版本——低判 schema-too-old，高判 schema-newer-than-supported。
**schema bump 方案会触发该双边界的全量连锁**（老工具拒新图 + 新工具拒老图 + 全部入库
fixture 再生）。F217 先例（决策 5）：sourceCommit 作纯可选新增字段，**不 bump schemaVersion**。

## 4. 采集面镜像盘点（单一事实源收敛对象）

| # | 位置 | 当前定义 | 用途 | 性质 |
|---|------|---------|------|------|
| 1 | source-discovery.ts:509-514 `walkTsJsFiles` | endsWith ×4（.ts/.tsx/.js/.jsx，大小写敏感） | TSJS skeleton 采集 walk（**生产者本体**） | 事实源 |
| 2 | source-discovery.ts:371 `walkPyFiles` | **[v2 修正] `.py` + `.pyi`**（endsWith，大小写敏感） | PY skeleton 采集 | 事实源。**与 #4 已存在活漂移**：#4 的 PY 分量只有 `.py`，未提交的 `.pyi` 改动今天不触发 dirty（source-commit.ts:38 注释自述该差异） |
| 3 | batch/generic-language-skeleton-collector.ts:47 | Java/Go adapter `.extensions`，**[v2 修正] `path.extname().toLowerCase()` 大小写不敏感匹配**（`Foo.JAVA` 会被采集） | 泛语言采集 | 事实源（adapter 驱动）。**与 #4 匹配语义漂移**：#4 用大小写敏感 extname，`.JAVA` 未提交改动不触发 dirty |
| 4 | source-commit.ts:36 `TSJS_COLLECTOR_EXTENSIONS` | Set ×4 + `.py`（缺 `.pyi`）+ Java/Go adapters → `getDirtySourceExtensions()`，全局大小写敏感（FIX-4） | freshness dirty 判定过滤面 | **手工镜像，且已被证实两处失真**（见 #2/#3 备注）——"FIX-4 全局大小写敏感与生产者对齐"的断言只对 TSJS/PY 成立 |
| 5 | quality/ignore-oracle.ts:112 `TSJS_EXTENSIONS` | Set ×4 | orphan 检查按扩展选 ignore-dirs | **手工镜像** |
| 6 | cache/cache-key-builder.ts:34 `INCLUDED_EXTENSIONS` | ×4 + .json/.md/.yaml/.yml/.toml/.lock（toLowerCase） | cache fallback 扫描 | **超集镜像**（代码子集应收敛，doc/config 扩展是其自有职责；其 toLowerCase 匹配语义属自身职责） |
| 7 | adapters/ts-js-adapter.ts:42 `extensions` | ×8（+.mjs/.cjs/.mts/.cts） | **[v2 修正] 生产面**：ts-js-adapter.ts:120 `buildModuleGraph` → `buildModuleGraphForProject`，且 module-derivation 经 registry 优先读取本集合 | **参与建图的采集面**（此前误判为纯声明层） |
| 8 | knowledge-graph/module-derivation.ts:354 | ×8（registry 有 ts-js adapter 时用 #7，否则硬编码 fallback ×8——#7↔#8 自成镜像对）。**[v3 修正] 匹配语义大小写不敏感**：扩展集传入 `scanFiles`，其 walkDir 用 `path.extname().toLowerCase()`（file-scanner.ts:298）——`.MJS/.CTS` 等大小写变体会被采集 | **[v3 修正] 生产面（仅 full batch 主链）**：`buildModuleGraphForProject` 由 graph-assembly.ts `selectPrimaryModuleGraph`（:312/:317）调用，该函数注释自证"graph-only 路径不执行本函数"；`buildAstGraphOnly`（:199）只走 skeleton 采集 + buildUnifiedGraph。module 节点经 full batch 主链进图 | **参与建图的采集面**（此前误判为纯声明层）。TSJS 实际存在**双采集面**：skeleton walk ×4（大小写敏感）与 module 派生扫描 ×8（大小写不敏感、仅 full batch）是两条并存的进图管线 |
| 9 | watcher/file-watcher.ts:40 | ×6（+.mjs/.cjs） | watch 触发面 | 非建图链路（触发器），可排除但需显式声明 |
| 10 | core/import-resolver.ts:91 | ×6 | import specifier 解析 | 解析层（"如何解析已采集文件内的引用"而非"采集哪些文件"），可排除但需显式声明 |
| 11 | python-adapter.ts `scanPyFiles` | 硬编码 `['.py']`（符号扫描管线） | Python 符号扫描（建图生产面之一） | **事实源，且已存在与 #2 并存的活漂移**：adapter 声明面与 `walkPyFiles`（#2，`.py`+`.pyi`）实际扫描面存在失配——已由 `CollectorExtensionSurface` 新增 `pythonSymbolScan` SSoT 双常量 + 行为探针钉死现状 [v5 补充] |

防漂移现状：source-commit.test.ts 用真实 adapter 实例对比 getDirtySourceExtensions（仅覆盖 #4 与 Java/Go adapter 的一致性，不覆盖 #1/#2 生产者本体——且 #2 的 `.pyi`、#3 的大小写语义、#7/#8 的生产角色均未被该测试看住，v2 修正即其后果实证）。

## 5. 候选方向（Codex 建议 + 编排器核查后的事实约束）

1. **collector fingerprint 写入图 metadata + freshness 判定比较**（机制性方案）：
   - 覆盖两类失效：采集面扩展（未来 .mjs）+ 行为变更（今天的 F242）
   - 可选字段先例充分（F217 sourceCommit），不 bump schema，旧图 undefined → 诚实降级
   - 难点：指纹的"行为版本"分量无法从代码自动推导，需显式常量 + bump 纪律护栏；
     "采集面"分量可从单一事实源自动推导
   - **[v2 修正] "已有 F214 门禁可借力"的断言被证伪（C-004）**：`scripts/graph-semantic-diff.mjs`
     是独立 CLI，package.json 的 test/repo:check/prepublish 链路**均未接线**；既有测试只消费
     静态 pinned graph，从不用当前 producer 重建对比；micrograd 再生依赖仓外
     `~/.spectra-baselines/`（非 hermetic）。**行为变更 + 忘 bump 时现有链路可全绿**——
     "重建-对比"护栏必须由 F249 自建（入库 hermetic 多语言源码 fixture + vitest 接线），
     不能引用为既有资产
2. **schema bump**（2.0→2.1）：被 FIX-7 双边界连锁放大（见 §3），且强制全量重建不区分
   "producer 真变了"vs"仅发版"；fixture 全再生。代价大、精度差。
3. **expected-module-set 校验**（磁盘存在采集面内文件但图内零对应 module → dirty）：
   只抓"采集面扩展"类失效，**抓不到 F242 这类行为变更**（module 集合不变、边集变）；
   需镜像 gitignore/ignore-dirs 剪枝逻辑（第 11 处镜像，与收敛方向背道而驰）；误报面大。

## 6. 判定语义现状（新状态设计的约束）

- `GraphFreshnessVerdict.state` 是闭合联合类型，消费方含 graph-quality-report.schema.json
  （--json 契约）、repo:check 第 12 族、bootstrap-status——**新增枚举值 = 跨消费方契约变更**；
  可选替代：复用 `stale` + 新增可选 `staleReason` 判别字段（additive）
- **[v2 补充] "additive 字段零契约影响"不成立（C-005）**：
  specs/217-graph-quality-gates/contracts/graph-quality-report.schema.json 的
  `GraphFreshnessVerdict` 定义为 `additionalProperties: false`——任何新增字段都会被严格
  校验拒绝，**schema 文件必须同步升级**（含消费该 schema 的契约测试）
- **[v2 补充] dirty 优先级陷阱（C-006）**：现有判定顺序 unknown-provenance 短路 → stale →
  dirty → fresh；repo:check 对 dirty 刻意不告警（FR-026）。若指纹比较插在 dirty 之后或
  仅"正交"并列，**提交前的脏工作树（最常见运行态）会把指纹 mismatch 静默吞成 dirty**——
  指纹判定必须排在 dirty 之前，且多原因并存时需结构化保留（如 staleReasons 数组）
- **[v2 补充] 消费方文案硬编码（W-006）**：CLI nextSteps 与 repo:check warning 文案当前
  硬编码"sourceCommit 不一致"措辞；bootstrap-status 只透传 state/sourceCommit。指纹型
  stale 若不做 reason-aware 传播，用户会收到事实错误的诊断文本
- repo:check FR-026：dirty 不告警（防提交前噪音）——指纹 mismatch 的告警级别需对齐这套
  噪音哲学：mismatch 是"必须重建"信号，应比 dirty 强、与 stale 同级或更强
- **[v4 修正]** 旧图 fingerprint undefined 的处理与 sourceCommit undefined **哲学对齐但
  状态不同**：sourceCommit 缺失 → unknown-provenance（无从确证，F217 语义不变，且该状态
  在两个消费方今天都是静默 pass）；fingerprint 缺失且 sourceCommit 判定链未短路 →
  **stale + collector-fingerprint-unrecorded**（保守 fail-closed，复用 stale→warn 消费链
  产生非静默信号）。**若把 fingerprint 缺失也映射到 unknown-provenance，会因该状态的
  静默 pass 语义让 F249 上线前的所有存量图恰好绕过本机制**——此边界是本需求的核心
  验收点之一（spec FR-010 已按此定案）

## 7. 相关先例与约束

- F217（specs/217-*）：sourceCommit 可选字段 + 四态判定 + repo:check 第 12 族——本需求
  是其直接延伸，遵循其 provenance 诚实降级哲学（constitution IV）
- **[v3 修正]** F214 pinned fixture 与 graph-semantic-diff：**存在资产但未接线**（见 §5.1
  C-004 证伪记录）——不是"既有 CI 检出面"，重建-对比护栏须 F249 自建
- F195：graph-only 纯 AST 建图 2.8-3.7s（重建成本低）；LLM full 模式 ~$6/10min（self-dogfood）
  ——误报重建的代价不对称，指纹精度优先于激进失效
- constitution：III YAGNI / IV 诚实标注不确定性 / X 零运行时依赖（node:crypto 内建可用）/
  XIII 向后兼容 / XI 质量门控不可绕过
- 入库 fixture：tests/fixtures/micrograd-baseline-graph/graph.json（pinned，改 producer 需
  按 README 约定再生）；tests/baseline/<project>/<tool>/full.json 12 个 perf anchor 入库
