# F266 对抗审查处置台账（不修项 / 移交项）

两个独立异构对抗代理对 F266 工作树改动做了实跑攻击，结论由主编排器逐条裁决。
**本文件只登记"裁决为不修"的条目**——已修项见 `tasks.md` 的「对抗修复批次」一节与各自的回归测试。

登记的意义：这些条目要么是按设计（不是缺陷），要么是超出本卡边界的真问题。
不写下来的话，下一轮审查会重新发现同一条、重新论证一遍，或者更糟——被当成新缺陷顺手改掉，
碰翻本卡刻意保持的边界。

| 编号 | 来源 | 处置 | 后续归属 |
|---|---|---|---|
| C-1 | 代理 A W-5 | 不修（按设计） | — |
| C-2 | 代理 A W-7 | 不修（按设计） | — |
| C-3 | 代理 A I-1 | 已被 A4 改动自然覆盖 | — |
| C-4 | 代理 A I-2 | 移交 M10 P1 | 「边 stage 标签」卡 |
| C-5 | 代理 A I-4 / 代理 B I-1 | 不修（判据结构性盲区），已注释登记 | M10 P1 |
| C-6 | 代理 B I-2 | 移交 M10 P0-D（本卡禁区） | P0-D atomic-write |
| C-7 | 代理 A C-2 尾注 | 超出本卡范围 | 待立卡 |
| C-8 | 代理 A I-5 / 代理 B I-4、I-5、I-7 | 已核安全 / 无发现 | — |
| C-9 | spec-review WARNING（FR-009 四分→三分） | 用户已裁决方案 B | milestone-next P1 候选 |

---

## C-1（代理 A W-5）module-derivation 的出声不覆盖 graph-only 路径

**结论：按设计，不修。**

FR-002 明文要求 graph-only 零行为变化。更关键的是：graph-only 走 unified graph 全仓扫描，
**不受 `/^src\//` 过滤器影响**——同一个 lib/ 布局工程用 graph-only 建出的是一张正常的图
（实证 7 节点 9 边）。也就是说 graph-only 路径上**根本不存在这个缺陷**，
给一条没有缺陷的路径加告警不是"补齐覆盖"，是造噪声。

回归网：`tests/unit/module-derivation-empty-scope-warning.test.ts` 的
「graph-only 路径不触发本 warn」用例把这条前提固化住了——将来若有人把模块派生塞进 graph-only，
它会立刻红。

## C-2（代理 A W-7）1 个 symbol / 0 边的图仍是 pass-with-warnings（exit 0）

**结论：按设计，不修。**

F217 已定：非强不变量给 warning 不阻断。把"有 symbol 但边稀疏"升格为硬失败，
会越过既有六指标的分级，把 warning 级问题变成 exit 2。

本轮 A6a 已把该家族里**最恶性的那一档**（0 个 symbol 节点 ⇒ 六指标全体失去判定对象 ⇒ 假 pass）
收进 `cannot-assess`。剩下的「有 symbol、边少」是 orphan-ratio / contains-coverage 的正常职责范围，
它们对这种图确实会给出 warning，不是沉默。

## C-3（代理 A I-1）`node === null` 分支对不存在的节点断言"无导出面"

**结论：已在 A4 改动中一并修掉，无需单列。**

`decideResolution` 的 `confirmed-zero` 分支现在按 `node !== null` 分叉：
节点未定位到时 detail 改为「被查 symbol 未在图中定位到节点，故未能核对其导出面」，
`evidenceScope` 相应降为 `graph`。该路径当前结构性不可达
（impact / context 都在更早分支拦掉 not-found，detect_changes 传 `symbolId: null`），
但判据不该依赖"上游一定拦住了"这个外部前提。
回归用例：`tests/unit/mcp-graph-honesty.test.ts`「symbolId 给了但节点未在图中定位到」。

## C-4（代理 A I-2）unified-graph 缺席时不写 `skippedSources` 的不对称

**结论：真问题，但属 producer 侧改动，超出本卡（消费侧）边界。移交 M10 P1「边 stage 标签」卡。**

本卡已在消费侧堵住其后果：A4 之后，一张没有调用点记账的图不再能被判成 `confirmed-zero`，
而是落 `coverage-gap` 并如实说「图内没有任何调用点记账，无法确认测量是否执行过」。
即 producer 漏写 `skippedSources` 不再能让消费侧说出最强的假话——最坏情况是措辞不够具体，
不是方向性错误。

## C-5（代理 A I-4 / 代理 B I-1）src/ 存在但源码在别处的混合布局：判据结构性失明

**结论：不修（判据的固有不可见面），如实登记在代码注释里。移交 M10 P1。**

`scanRoot` 一旦锁定 `src/`，根级与 `lib/` 下的文件根本不进扫描结果，
因此 `scannedCandidateCount > 0 && includedCount === 0` 这个判据**永远不会**在混合布局上触发
（代理 B 已实证）。要覆盖它必须改扫描根选取策略，那是另一件事，不是给告警加条件。

同时登记 B2 引入的第二个已知边界：全部源码平铺在扫描根顶层的 TS 工程会落 info 档——
结构上它与"只有根级构建配置的 py 工程"不可分（两者的被滤候选都是清一色顶层文件）。
两条边界都写进了 `src/knowledge-graph/module-derivation.ts` 的注释，
不靠这份文档单独承载。

## C-6（代理 B I-2）post-commit 并发 + 固定 `.tmp` 名的写图竞态

**结论：真问题，但 `src/utils/atomic-write.ts` 是 M10 P0-D 的禁区文件，本卡不动。移交 P0-D。**

**给 P0-D 的耦合提醒（这是本条登记的主要价值）**：本卡把后台重建的时间窗口从 30s 放大到了 180s
（`spectra graph` → `spectra batch --mode graph-only`，后者要真解析全仓源码）。
窗口变长直接放大了「两次快速提交 ⇒ 两个 spectra 进程 ⇒ 抢同一个固定 `.tmp` 文件名」的命中概率。
P0-D 做随机 tmp 名时请把这条耦合算进去——它不是理论风险，本卡刚刚把它的触发面扩大了 6 倍。

## C-7（代理 A C-2 尾注）`unknown-provenance` 不降级 verdict

**结论：超出本卡范围，登记移交。**

`unknown-provenance → pass`（不降级）是 F217/F249 既有的 verdict 映射语义。
动它等于修改既有指标的判定行为，会影响所有历史图产物的门禁结论，
不能夹带在一张"返回面诚实化"的卡里做。需要单独立卡、单独跑 A/B。

## C-8（代理 A I-5 / 代理 B I-4、I-5、I-7）已核安全 / 无发现项

逐条复核后确认无需改动，登记留痕以免下轮重复论证。
其中代理 B I-5 提到的两点（comparisonScope 的 merge-base 语义未声明、
`graph-honesty.ts` 里 `as unknown as Record<string, unknown>` 缺 why 注释）
按 B6 已经补上，不在"不修"之列。

## C-9（spec-review WARNING）FR-009 的四分被实现成三分

**结论：用户已裁决方案 B（保持三分 + `separable: false` 显式声明），本卡不改。**

根因是能力边界而非实现偷懒：`graph.json` 里唯一可得的缺口量
`Σ callSitesCount − calls 边数` 天然混合了「解析/链接失败」与「合法的图外调用」，
二者的判别证据只存在于抽取期、**未被持久化**。在没有这份证据的前提下把差值拆成两类，
拆出来的每一个数字都是编的。

**提示 milestone-next**：把「producer 侧 call-site 归因持久化」列入 P1 候选——
那是让四分成为可能的唯一前置，做完之后本卡的 `separable: false` 才有资格改成 `true`。
在此之前，本轮 A3 已经确保 hint 层不再拿这个混合量做单方面归因。

---

# delta 轮（第一轮修复后的再审）

第一轮修复本身被再次异构对抗，抓出 1 CRITICAL + 5 WARNING。
CRITICAL 是**第一轮修复自己引入的**：A6a 的前置闸把与 symbol 无关的强不变量一起吞掉了——
再次印证「审查轮新代码必须再审」（F244 教训）。

| 编号 | 档位 | 缺陷一句话 | 处置 |
|---|---|---|---|
| D1 | CRITICAL | `no-symbol-nodes` 前置短路把真 `exit 1` 洗成 warn | 已修（后置降级） |
| D2 | WARNING | `measured-zero` 用一个合法节点代表全图；全零记账语义歧义 | 已修（三条件收紧） |
| D3 | WARNING | `assessCoverage` 裸索引 / 原型链 / 小数计数 | 已修 |
| D4 | WARNING | detect_changes 对**未执行**的上游查询下 resolution | 已修（`resolutionOmitted`） |
| D5 | WARNING | resolution 缺席时 hint 比不传 honesty 还裸 | 已修（缺席声明） |
| D6 | WARNING | hook 日志连发截空 + 180s 窗口内并发重建 | 已修（append + 轮转 + mkdir 锁） |
| I5 | INFO | `confirmed-zero` 在现产图上不可达 | 不修（见下） |
| I6 | INFO | bootstrap-status 只读 `freshness.state` 的可见性缺口 | 移交 P0-A/B |
| W2 | INFO | 并发窗口 × 固定 tmp 名 | 保留 C-6 的 P0-D 耦合提醒 |

## D1（CRITICAL）前置闸吞掉强不变量 —— 修法与一处刻意的判定变化

第一轮把 `hasNoSymbolNodes` 插在 `buildReport` **之前**，命中即返回一份六指标全是 `pass` 占位的
`cannot-assess` 报告。但 `duplicate-canonical-id` / `dangling-edge` / `legacy-ignored` 三项检查
**遍历全部节点与边、判据里一个字都没读 `unifiedKind`** —— 第一轮那句「无 symbol 图上没有违规样本
可报」的注释是假的，delta 轮用实证反例推翻：`spectra graph` 由 arch-IR 建出的图不写 `unifiedKind`，
却能同时放进 `src/a.ts::Foo` 与 `src/a.ts#Foo`。那是一条真重复 canonical ID，旧判定面 exit 1 /
repo:check FAIL，被前置闸洗成 `cannot-assess` + `duplicateCanonicalId: pass`。

修法：改为**后置降级**（`downgradeForNoSymbolNodes`）——先跑完 `buildReport`，
`fail-strong-invariant` 原样保留（exit 1），其余改判 `cannot-assess/no-symbol-nodes`
但**报告体保留真实指标**（不再用占位值覆盖）。`isEmptyGraph`（0,0）的前置短路保留：
空图上六指标可**证明**无违规样本（无节点无边），前置零信息损失，理由已写进该函数注释。

**一处对裁决的偏离（如实登记）**：裁决第 6 条要求三个 adversarial fixture 回滚后「既有断言重新变绿」。
`duplicate-canonical-id.json` / `dangling-edge.json` 确实原样变绿（都是强不变量，exit 1 保留）；
`ignored-path-node.json` 不能——它触发的 `legacy-ignored` 是 **warning 级**，按裁决第 2/3 条
（只有 `fail-strong-invariant` 保留）应改判 `cannot-assess`（exit 0 → 2）。
两种可能的收敛方向各自的代价：

- **按裁决字面（已采纳）**：规则收敛为「无 symbol ⇒ 绝不宣称 pass」。代价是该 fixture 的
  `exitCode` / `overallVerdict` 两行断言要改（`ignored 路径节点 100% 检出` 的承重断言逐条不变，
  因为报告体保留了真实指标）。
- **放宽为「有任何真发现就保留原 verdict」**：能让三个 fixture 全部原样变绿，但会让门禁的诚实度
  取决于一个巧合——一张 symbol 层整体缺失的图，**恰好**带一个 `node_modules/` 节点时报
  `pass-with-warnings`（exit 0），不带时报 `cannot-assess`（exit 2）。这正是 A6a 要消灭的那类
  fail-open，只是触发条件更隐蔽。

故采纳前者，并把这条判定变化写进 `graph-quality-adversarial.test.ts` 的注释与
`downgradeForNoSymbolNodes` 的 JSDoc。

## D2 附带的一条能力边界（新增，需随 P1 一起还）

`measured-zero` 现在要求 `Σ callSitesCount > 0`。根因在生产端：
`src/knowledge-graph/index.ts` 写的是 `sk.callSites?.length ?? 0`，
tree-sitter 解析失败（EC-1 降级）产出的 `undefined` 与「真的一个调用点都没有」
在磁盘上折叠成同一个 `0`。在 producer 区分二者（显式 `null` 或 stage 标签）之前，
消费侧只能 hedge。移交线索已写进 `assessCoverage` 的 JSDoc，归属 M10 P1「边 stage 标签」卡
（与 C-4 同一张卡）。

## I5（不修）`confirmed-zero` 在现产图上实际不可达

**结论：不修。这是保守方向上的死枚举，宁可过度 hedge 也不说谎。**

本仓真实 `graph.json` 的 `skippedSources` 恒非空（`doc-graph` / `architecture-ir` /
`cross-reference` 三个数据源在 graph-only 模式下必然缺席），而 `decideResolution` 的优先级里
「有缺席数据源 ⇒ coverage-gap」排在 `confirmed-zero` 之前。因此在当前生产图上
`confirmed-zero` 永远不会出现——它只在合成图 / 完整建图（补齐三个数据源）上可达。

为什么不修：这个枚举值的不可达方向是**保守**的（该说"确认为零"的时候说了"可能有缺口"），
与 A3 那种「在所有健康仓库上永久拉响」的误报方向相反——后者是噪声，前者只是不够锋利。
真要让它复活，前提是 producer 侧补齐数据源覆盖或给 `skippedSources` 分级，
那是 P1「边 stage 标签」卡的范围。单测已用合成图钉住它的可达路径
（`F266-A4` / `D2：全模块记账 + 总量 > 0 + 全部成边`），不会退化成永远跑不到的死代码。

## I6（移交）`graph-bootstrap-status` 只读 `freshness.state`

**结论：既有行为，非本卡引入。移交 M10 P0-A / P0-B 语境。**

该消费方只取 `freshness.state`，因此 D1 之后 `cannot-assess` 携带的真实指标、
以及本卡新增的 `cannotAssessReason` 细分，它都看不见。这在本卡之前就是如此
（`overallVerdict` / `cannotAssessReason` 一直没进它的读取面），本卡没有让它变坏。
P0-A 正在把门禁证据源换成 hook 侧实时账本，届时这条读取面本来就要重写，
在这里先改一遍等于改两次。

## W2（保留）并发窗口 × 固定 tmp 名

C-6 已登记的 P0-D 耦合提醒**继续有效**，且需要更新一句：D6 加了 `mkdir` 锁之后，
由 post-commit hook 触发的并发重建已被闸住（锁落在 `git rev-parse --git-dir` 下，
主仓与各 linked worktree 各有各的锁与各自的 `graph.json`，互不干扰）。
但锁只覆盖 hook 这一条路径——用户手动跑 `spectra batch` 与 hook 后台重建撞车时，
仍是两个进程同时写同一份图。固定 `.tmp` 名的随机化在 P0-D 仍然要做，不因本卡的锁而降级。

---

# 第三轮（delta 第二轮修复后的再审）

第二轮修复被第三次异构对抗，抓出 **1 CRITICAL + 4 WARNING + 若干 INFO**。
CRITICAL 又一次是**上一轮修复自己引入的**（D6 的 `mkdir` 锁带来了僵尸锁回收路径），
第三次印证「审查轮新代码必须再审」。

| 编号 | 档位 | 缺陷一句话 | 处置 |
|---|---|---|---|
| E1 | CRITICAL | 僵尸锁回收 `find → rmdir → mkdir` 三步可交错，B 的 `rmdir` 能删掉 A 刚建好的活锁 → 双持锁并发重建 | 已修（`mv` 原子认领）——**但实测未关死，见下** |
| E2 | WARNING | 多 commit 序列 first-writer-wins，图定格在序列首 commit 的树态 | 已修（重建请求标记 + 最多补跑 1 轮） |
| E3 | WARNING | gate 消费面在 `cannot-assess` 上整体塌陷，真发现 / stale / oracle 诊断全丢 | 已修（结构标记 `metricsPopulated` 分档） |
| E4 | WARNING | `budget`/`depth` 归零的查询没跑却照产 resolution | 已修（新 omission reason `query-constrained-to-zero`） |
| E5 | WARNING+INFO | `default:` 分支静默漏渲染 / `annotationDegraded` 时 hint 比兜底更裸 / 节点读取面两处口径不齐 | 已修（穷尽 switch + 降级声明 + 两处防御） |
| INFO-3 | INFO | 超时 `kill` 后未 `wait`，锁可能在被 TERM 的进程收尾前易主 | 已修（`kill` 后补 `wait`） |
| INFO-5 | INFO | `resolveHookPath` 在 worktree 下把 hook 装到 linked worktree 的私有 gitdir | 不修（非本卡引入，移交登记，见下） |
| — | — | `minConfidence: 1` 的零结果 | 不修（BFS 真跑过，hedge 方向安全，见下） |

## E1 修法自身的缺陷（如实登记：CRITICAL **未关死**）

裁决的修法是把回收改成 `mv` 原子认领：判 stale 后先 `mv "$lock" "$lock.stale.$$"`，
只有 rename 成功者有权清理，`rmdir` 只落在改名后的私有路径上、永不落在锁路径本身。
实现已照此落地（`git-hook-installer.ts::generatePostCommitSegment`），并把「认领 → 重新 `mkdir`」
之间的窗口压到一条命令。

**但它并没有消灭双持锁**。残余通路：B 的 stale 判定发生在 A 认领之前，而 B 的 `mv` 落在
A 重新 `mkdir` **之后** —— B 把 A 的新锁移走，两边各自持锁。实测（同一僵尸锁上并发 N 个
racer、各 20 轮，判据 = 同轮内成功持锁的进程数 > 1；racer 脚本与生成段落逐字同形，已用
断言核对）：

| racers | 旧（find→rmdir→mkdir） | 新（mv 认领） | 加强档（mv + 持有者令牌复核） |
|---|---|---|---|
| 2 | 0/20 | 0/20 | 0/20 |
| 5 | 2/20（最多 2 个同时持锁） | **0/20** | 0/20 |
| 20 | 15/20（最多 5 个） | 13/20（**最多 2 个**） | 3/20（最多 2 个） |

读法：post-commit hook 的真实并发量级是「同一时刻两三个子 shell」，那一档已经收住
（N=5 由 2/20 变 0/20），单轮并发持锁数上限从 5 降到 2；20 路同发仍能复现。
根因是 POSIX sh 下「判 stale → 认领 → 重新抢锁」无法做成一次原子操作——
连加强档（锁内写持有者令牌 + 开工前复核归属）也只是收窄到 3/20，不是关死。

**移交建议**：要真正关死，必须换原语——`flock`/`O_EXCL` 的小 helper，或把锁的生命周期
交给 `spectra` 进程自己（它已经在写 graph.json 的临时文件，锁与写入同源才是正解）。
这与 M10 P0-D 的「固定 `.tmp` 名随机化」天然是同一张卡的两面，建议合并处理。

## E2 的残余竞态（登记，不修）

让位者的 `touch` 若发生在持锁者最后一次检查之后、`rmdir` 释放锁之前，该请求本轮不会被看见。
后果有界：标记会留到下一次持锁者跑完第一轮时被消费（届时它已由更新的树态重建过一次，
只是多跑一轮，不丢改动）；真正落空的只有「序列最后一次 commit 的重建」这一单点，
由 MCP 侧 freshness advisory（dirty / stale）对外声明，不会静默。
补跑轮数上限取 2：提交风暴下不能把 hook 变成常驻重建器；超限只记一行日志。

## E4 的口径对称性（初版不对称，已按主编排器裁决对齐）

初版按裁决字面只对 `detect_changes` 的 `budget === 0` 判 `query-constrained-to-zero`，
`depth === 0` 不在判据内。实现后如实回报了这处不对称：那条路上 BFS 虽被调用、
同样一层都不展开，零结果同样由入参而非图内容决定——与 `impact` 的 `depth === 0` 同形，
留着就等于在同一张卡里既修了一处"替没跑的查询作证"、又留了一处。

**主编排器裁决：对齐。** `agent-context-tools.ts` 的 detect_changes 装配点判据已改为
`effectiveBudget === 0 || effectiveDepth === 0`，与 impact 逐字同形；
回归网见 `mcp-honesty-envelope.test.ts`「E4 detect_changes(depth:0)」——
该用例刻意让改动文件**确实落图**（`changedSymbols` 非空），以保证命中来自 depth 判据本身，
而不是 `no-symbols-in-graph` 的顺带命中。

另一处相关取舍**保留不回退**（同一裁决）：`impact` 归零时 `query-constrained-to-zero`
优先于 `non-caller-oriented-query`——对一个没跑过的遍历，先说"它没跑"比先说
"本工具没有 callee 侧证据"更贴事实。

## `minConfidence: 1`（不修）

BFS 确实执行了，只是阈值把所有边滤掉。此时的零结果是「查过、按这个阈值为空」，
与 budget/depth 归零的「没查」在性质上不同；照常产出 resolution 的 hedge 方向是安全的
（不会把"没查"说成"查了没有"）。登记为已知边界。

## INFO-5 `resolveHookPath` 在 worktree 下的落点（移交，非本卡引入）

`resolveHookPath` 解析 `.git` 文件里的 `gitdir:` 后直接 `join(gitDir, 'hooks')`，
在 linked worktree 上指向 `.git/worktrees/<name>/hooks`，而 git 默认从 `core.hooksPath`
或**主仓** `.git/hooks` 找 hook。该行为在本卡之前就是如此（F266 未触碰该函数），
本卡没有让它变坏，故只登记不修，移交后续 hook 分发卡（与 P0-B 的 hooks 分发口径同族）。
