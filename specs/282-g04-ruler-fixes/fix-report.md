# F282 · G0-4 尺子修复：graph-accuracy `normalizeName` 支持 `Class.method` + adoption census 计数单位显式化

> 模式：spec-driver-fix（主线程实施 + 独立子代理对抗复审 + verify 子代理）。类别：测量脚本（非门禁），一般生产代码档位。

## 1. 问题与证据

- **现象**：2026-09-12 首次按冻结协议（`docs/design/f265-graph-quality-rerun-plan.md` §2.2）取 G0-4 图质量读数：GORM `callPrecision 0.496 / callRecall 0.273`，HikariCP **`0 / 0`**（hits 0 / graphCallees 31 / truth 819）。HikariCP 的 `sampleFalsePositives` 全部是 `HikariDataSource.isClosed`、`PoolStats.update` 这类 `Class.method` 形态；GORM 亦有 `Association.Replace` 被记为假阳性。
- **根因（5-Why 收敛）**：`scripts/graph-accuracy.mjs::normalizeName()` 写于 F147（2026-05），只处理 `()` / 前导 `.` / `::` / `/` / `#` / `.py|.ts` 后缀；F214 canonical ID + F260 实例方法调用边之后，method 节点 label 为 `Class.method`，而 tree-sitter truth-set 提取的是裸方法名 → **同一调用在两侧书写形态不同，尺子把命中记成假阳性**。Java 语料 graph 侧 callee 全为方法形态，故 0 命中是尺子伪影而非图精度。
- **旁证**：scratchpad 副本只加"取最后一个 `.` 段"后 GORM → 0.587/0.307、HikariCP → 1.0/0.034（与本卡修复后的正式读数逐字一致）。
- **census 口径差**：`scripts/adoption-census.mjs` 读数（Spectra 全史 42 次）与 2026-08-23 交界审查的 ad-hoc grep（70 次/月）不可比——census 只数结构化 `tool_use` 块，ad-hoc grep 把文本提及（hook 反馈 / 摘要 / 助手正文）也算进去了。这不是 census 的 bug，是口径未显式化。

## 2. 修复

1. `scripts/graph-accuracy.mjs`：`normalizeName` 在文件后缀剥离**之后**取最后一个 `.` 段（顺序承重：先剥后缀，否则 `engine.py` 会被切成 `py`）；`export` 该函数供单测直接钉住归一化矩阵；空串归一化后返回 `null`。两侧（graph label / truth callee）走同一函数，保持对称。
2. `scripts/adoption-census.mjs`：输出增加 `countingUnit` 字段，显式声明计数单位与排除项。
3. 测试：`tests/unit/graph-accuracy.test.ts` 新增 2 用例（红先行实证：改前 `normalizeName` 未导出、`Class.method` 未归一化 → 2 红；改后绿）——`Class.method` / `File::Class.method` / `path/File.java::Class.method()` 四形态，以及既有形态（后缀 / 前导点 / `#` / `()` / 空串）不回退矩阵。

## 3. 影响范围

- 消费方：`analyzeGraphAccuracy*`（python/ts/go/java 四语言）的 `computeCallAccuracy` 两侧归一化；`tests/unit/graph-accuracy*.test.ts`、`graph-accuracy-dispatch.test.ts` 全绿（44/44）。
- 已知边界（如实登记，对抗复审 I-3 校正）：truth 侧含点名字的实况是 Go 0/1517、Java 0/5885（extractor 早已取 field / `_normalizeJavaTypeName`）、Python 结构上不可能，仅 TS fallback 文本 7/19976（`Handlebars.SafeString`、`Intl.Segmenter` 等外部名）且本仓无同尾段本地目标——"两侧对称"的论证只对 TS fallback 文本实际生效，Go 路径不存在 `pkg.func` 形态。self-dogfood 142 个方法尾段中 16 个对应 >1 个类（`getInstance`×5、`_collectErrors`×4），是 label-only 折叠面的量化。module 文件名含多段点（`foo.test.ts`）作为 call target 的情形现图不产出（4 张图 calls 边目标为 module 节点数均为 0），不作处理。
- 后缀正则与尾段规则的交互（对抗复审 I-2，理论面）：方法名恰为 `ts|js|py|tsx|jsx` 时 `Foo.ts → Foo`，既漏 `ts` 又可与构造调用 `new Foo()→Foo` 撞成假 hit；4 张图中 0 个 calls 目标以代码后缀结尾（self-dogfood 仅属性节点 `TelemetryEntry.ts`），登记不处理。
- 尺子换代口径断裂（对抗复审 W-2）：Py/TS 读数同图同 truth 只换尺子即位移（micrograd 0.75/0.083→1.0/0.111、nanoGPT 0.333/0.040→1.0/0.113、self-dogfood(src) 0.778/0.268→1.0/0.328）；F151 SC-002 阈值与 `tests/baseline/*/graphify/full.json` 的 callPrecision anchor 是旧尺子产物，与 F282 后复跑不可比——已登记进协议文档「口径说明」。
- 回退面实证（对抗复审）：4 条语言路径（GORM / HikariCP / self-dogfood TS / micrograd+nanoGPT）HEAD 版 vs 新版 `normalizeName` 同输入 A/B，pair-level 无一条「原命中→不命中」。
- 不改判据方向、不改冻结协议定义（协议 §0：取数后不回改定义，只追加「口径缺陷」）。

## 4. 修复后读数（协议 §2.2；语料 SHA 钉死；输出含 baseline 溯源）——对抗复审后改写

对抗复审（C-1 / W-1 / W-3）证伪了首稿「GORM 0.587/0.307 = M10 收官对照组」的引用方式：协议口径 GORM 一行是 **scope 伪影**（图全仓建、truth 只扫顶层：121 个唯一 callee = 顶层源 55/55 命中 + 仅子包源 16/66=0.242≈随机基线 0.239±0.027 的加权平均，图越好读数越低），且 label-only 尺子在口径一致时 precision 结构性 ≈1.0（5/5 语料恰为 1.000）。两组读数都取、都落账：

| 语料 | 口径 | callPrecision | callRecall | hits / graphCallees / truth |
|---|---|---|---|---|
| GORM (Go) @688e8ea0 | 协议口径（truth 顶层 13 文件） | 0.587（伪影） | 0.307 | 71 / 121 / 231 |
| GORM (Go) @688e8ea0 | **口径一致**（去 `--ignore-dirs`） | 1.0 | **0.184** | 121 / 121 / 658 |
| HikariCP (Java) @ea81bfb5 | 协议口径 = 口径一致（全仓） | 1.0 | **0.034**（可达上界 0.085 = 28/329） | 28 / 28 / 819 |

**M10 收官对照组 = 口径一致 recall**（GORM 0.184、HikariCP 0.034）；precision 轴不作对照。builder 溯源：graph.json `builder.distSha256` 与本仓 `dist/.spectra-build-meta.json` 逐字相等（F261 D1：戳只可见不判定）；`builder.commit` 是建图时工作树戳 37b1f814(dirty)，取数时 HEAD 已前移到 00684522 而 dist 未变——首稿写的「builder == HEAD」只在 distSha256 层成立，已改口。

实质信号：Java 调用边 recall 3.4%（truth 819 名中仅 329 个对应图内定义符号 → 可达上界 8.5%；图缺 `private` 方法节点，parity 缺口一部分在符号抽取层）——P1-F 多语言 parity 缺口实锤；GORM recall 受"外部边界"（reflect/内建）结构性压制（顶层口径可达上界 71/129 = 0.550）。协议文档已追加缺陷 2（scope 错位）、缺陷 3（precision 轴无信息量）与口径说明（分母 / 尺子换代）。

## 5. 审查档位

一般生产代码：主线程自审 + 1 独立子代理对抗复审（Codex 审查暂停期，非门禁类不需异构档位标注）。结论：**代码层 0 真 bug**（4 语言路径 A/B 无回退、HikariCP 6 条 hit 边逐条对照源码全为真调用）；**读数可信面 1C + 3W + 5I**，处置见 §7。verify 子代理报告 + 主线程复核附录见 `verification/verification-report.md`。

## 6. 工具使用反馈（Dogfooding）

- Spectra MCP：未用——改动面是两个独立测量脚本，无 caller/影响面问题；graph.json 自身正是被测对象，避免循环取证。
- Spec Driver：本卡由主线程按 fix 骨架推进（fix-report / plan / tasks / verify 子代理），未调用编排器 SKILL（用户要求本 session 内直接执行）。无实质工具反馈，不落账。

## 7. 对抗复审处置（2026-09-12）

| # | 档 | 发现 | 处置 |
|---|---|---|---|
| C-1 | CRITICAL | GORM 0.587 是 scope 伪影（图全仓 / truth 顶层），作收官对照组会随图变好而变差 | 主线程复算一致（55/55 + 16/66，敏感性 0.587→0.486）；协议文档追加缺陷 2；取口径一致读数 1.0/0.184（121/121/658）；M10 收官对照组改为口径一致 recall；§4 / M10 §11 改写 |
| W-1 | WARNING | label-only 尺子 precision 在口径一致时结构性 ≈1.0，不构成边正确性证据 | 协议文档追加缺陷 3；precision 不再作图精度证据引用；symbol 级尺子 + Go 同名 receiver 合并节点移交 M11（M10 §12.4） |
| W-2 | WARNING | Py/TS 读数随尺子位移，口径断裂未登记 | §3 + 协议文档「口径说明」登记；F151 阈值 / graphify anchor 标为旧尺子产物 |
| W-3 | WARNING | HikariCP 分母单位不齐（819 含 JDK/外部；可达 329） | 主线程复算 U=329 → 上界 0.085；GORM 顶层 U=129 → 0.550；§4 / 协议文档改为双分母表述 |
| I-1 | INFO | 「builder == HEAD」措辞只在 distSha256 层成立 | §4 / 协议文档改口为 distSha256 逐字相等 + commit 戳只可见不判定 |
| I-2 | INFO | 方法名恰为代码后缀时的正则交互（理论面，0 命中） | §3 登记不处理 |
| I-3 | INFO | truth 侧含点名字实况与首稿对称性论证不符 | §3 校正 |
| I-4 | INFO | Go 图标签异构 / 同名不同 receiver 合并单节点（图侧缺陷候选） | 移交 M11 债务清单 |
| I-5 | INFO | census `countingUnit` 与实现相符；`extractClaudeToolCalls` 不按 `record.type==='assistant'` 过滤但无实际分歧；Codex 分支本机无语料 | 无需改动，登记 |
