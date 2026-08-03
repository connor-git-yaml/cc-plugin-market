# F254 代码质量对抗审查报告

审查对象：`plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`、
`plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs`、
`plugins/spec-driver/scripts/graph-consumption-cli.mjs` 及对应四份既有测试 + 新增
`tests/unit/graph-scope-extensions-contract.test.ts`（工作树未提交改动）。

审查方式：全文 Read 三份实现 + plan.md/fix-report.md；对
`deriveScopeExtensionsFromFingerprint` 构造 20+ 种畸形/边界指纹形态，通过真实 CLI 子进程
（`decide`/`annotate-caveat`，用临时 git sandbox）逐一验证判定行为；手工构造 TOCTOU 场景
（decide/annotate 之间图状态变化）；对跨语言合同测试做真实变异测试（临时移除
`GRAPH_SCOPE_EXTENSIONS` 中的 `.pyi` 后跑 `vitest`，再还原）；跑 `npm run test:plugins`
（1320 测试）、`npx vitest run tests/unit/graph-scope-extensions-contract.test.ts
tests/unit/graph-bootstrap-status.test.ts`（73 测试）、`npm run build`、`npm run repo:check`。
全部只读取证，未修改任何源码（临时变异后已用 diff 核对并还原）。

## 攻击面 1：`deriveScopeExtensionsFromFingerprint` 的"全有或全无"核验

构造并实测以下畸形/边界形态（均通过真实 `decide` 子命令观察 `scopeExtensionsSource` /
`coverageScope`）：

| 畸形形态 | 实测结果 |
|---|---|
| 合法五键 fingerprint（含 `.mjs`） | `graph-fingerprint`，`.mjs` 判 in-scope（核心正面回归成立） |
| 合法但精简后不含 `.py` | `graph-fingerprint`，`.py` 判 out-of-scope（**动态面能收窄**，非只会扩大，验证了 C-002 语义） |
| 五键之一整体缺失（`pythonSymbolScan`） | 整体回落 `static-fallback` |
| `extensions` 是字符串而非数组 | 整体回落 `static-fallback` |
| `extensions` 数组含非字符串元素（数字） | 整体回落 `static-fallback` |
| `extensions` 数组含空字符串 | 整体回落 `static-fallback` |
| 某条管线 entry 本身是数组 / `null` | 整体回落 `static-fallback` |
| `extensionSurface` 是数组 | 整体回落 `static-fallback` |
| `fingerprint` 本身是 `null` | 整体回落 `static-fallback` |
| `formatVersion` 为 `2` / `"1"`（字符串） | 整体回落 `static-fallback` |
| 全部五条管线 `extensions` 均为空数组（`union.size===0`） | 整体回落 `static-fallback` |
| 顶层混入 `__proto__` / 未知多余字段 | **不回落**，仍走 `graph-fingerprint`（见下方 INFO-2） |

结论：**未发现任何"部分并集"泄漏路径**——只要五条管线 key 中任一环形状不合法，
函数立即整体返回 `null`，`decide`/`annotate-caveat` 两处消费点随即整体回落到同一份
`static-fallback` 常量，未观察到"部分管线取动态值、部分管线取静态值"的混合面。这一核验与
现有测试用例 (d)（8 种畸形形态）实测结果逐项吻合。

**INFO-1（大小写归一化边界，未验证一致性）**：构造 `extensions: ['.MJS']`（结构合法但未小写化）
时，函数原样接收该字符串进入并集（不做 `toLowerCase()`），而 `collectCoverageScope` /
`annotateImpactCaveat` 比较时统一对文件扩展名做 `.toLowerCase()`。结果是 `'.MJS'` 永远不会
命中任何真实文件路径的比较键，等效于该扩展"静默从动态面里失效"——方向上是**收窄而非误宽**
（不会把范围外文件误判进范围），因此不是安全问题，但与函数 JSDoc 隐含的"已是小写字面量，
与 SSoT 声明一致"的假设不符，且没有显式断言/校验兜底。生产路径上此形态只会在图产物被篡改
或未来某条采集管线声明大小写变体时出现，触发概率低，登记为 INFO。

**INFO-2（顶层未知 key 宽容 vs TS 侧严格 key 集合）**：TS 侧 `parseCollectorFingerprint`
对顶层/`extensionSurface`/每条管线条目三层都做严格 key 集合比较（多一个 key 即判 invalid），
而 `deriveScopeExtensionsFromFingerprint` 只检查 `formatVersion` 与五条已知管线 key 是否合法，
对顶层/`extensionSurface` 多余的未知 key 保持宽容（实测 `extraField` 被静默忽略，仍走
`graph-fingerprint`）。这是 plan §1.3(b) 明确记录的有界裁剪（"只做够不够安全地取出扩展名列表
的宽松结构核验，不复刻整套版本演进/behaviorVersion 比较"），不是遗漏；但意味着这条"全有或
全无"核验的粒度比 TS 侧宽，若未来该函数职责扩大，需重新评估是否仍够用。登记为 INFO，非本次
修复范围内的缺陷。

## 攻击面 2：annotate 阶段独立重推导的 TOCTOU 窗口

实测构造：`decide` 时图无 fingerprint（`static-fallback`，`.mjs` 落在静态 12 项内 → 判
`consume-impact`）；在 `annotate-caveat` 调用前，把图替换成 **sourceCommit 不变、但新增了
一份"收窄后不含 `.mjs`"的合法 fingerprint**。

结果：
- `snapshotMatches` 因 `sourceCommit` 未变而判 `true`（FR-010 快照校验按其既定合同正确放行）；
- `annotate-caveat` 独立重推导出 `scopeExtensionsSource: 'graph-fingerprint'`，且该动态面不含
  `.mjs`；
- `annotateImpactCaveat` 因 `target` 的扩展名不在（重推导出的）覆盖面内，判定"不注解"；
- 但 `decision.outcome` 仍是 `decide` 阶段基于旧覆盖面算出的 `consume-impact`（`finalizeAfterRefresh`
  等收口逻辑此次未触发，本就不会重跑决策矩阵——这是 EC-07 的既定合同）。

**净效应（WARNING-1）**：consumer 最终看到的是"`consume-impact` + 零 caveat"——比修复前
（该场景 `decide` 阶段就会判 `out-of-graph-scope` → `consume-degraded`）**少了一层信号**，
且没有任何字段提示"注解时点用的覆盖面已经比决策时点更窄、且窄到把当前目标排除在外"。
这是一个真实存在、但触发条件极窄的竞态窗口（要求 `sourceCommit` 不变但 fingerprint 变化，
plan §1.3(f) 与既有测试用例注释都承认"理论上不该发生"）。查过 `graph-consumption-cli.test.mjs`
的用例 (e)：它只覆盖"两侧都判 in-scope、仅来源标签从 graph-fingerprint 变为 static-fallback"
的分支，**未覆盖"注解时点收窄到目标扩展名之外"这一支**，属于测试覆盖缺口。

建议（不要求本次必须修，登记供后续 follow-up）：至少把"注解时点覆盖面收窄导致目标越界"
这一事实写入 `caveat-annotation` 审计事件（如追加一个诊断字段），避免这条信息被完全静默丢弃；
或在测试里补一条覆盖该分支的用例，把当前行为（静默丢弃、无替代信号）显式钉住，让未来任何
"要不要在这里补一个信号"的讨论有一个明确的现状基线可比对。

## 攻击面 3：`verifiedSourceCommitOf` 谓词收敛的字节级一致性

对比收敛前后三处消费点（`readVerifiedSourceCommit`、`collectGraphAvailability`、
`runAnnotateCaveat` 的 `graphSourceCommitAtAnnotation`）的 `git diff`：三处此前各自内联的判据
"`ok:true` 且 `typeof value==='string'` 且非空字符串"逻辑，收敛后逐字节等价（同一段代码只是
被抽成 `verifiedSourceCommitOf(meta)` 复用）。同时验证 `readEmbeddedGraphMeta` 对
`sourceCommit` 字段的提取表达式 `parsed?.graph?.sourceCommit ?? null` 与收敛前
`readEmbeddedSourceCommit` 的原表达式逐字节相同，`readEmbeddedSourceCommit` 薄壳化后对
既有调用方（`buildStatusPayload`）零改动可确认（该函数不做非空字符串过滤，是 F239 时代就有
的宽松三态语义，本次未触碰）。**结论：三处消费点行为与收敛前完全等价，无回归。**

## 攻击面 4：性能与资源

- `readEmbeddedGraphMeta` 对同一份 `graph.json` 做"先 `statSync` 判尺寸、超限即拒绝、否则一次
  `readFileSync` + 一次 `JSON.parse`"，`sourceCommit` 与 `fingerprint` 取自同一次 `parsed` 对象，
  **确认没有引入双读**（此前 `collectGraphAvailability` 需要 sourceCommit、现在额外需要
  fingerprint，若走 B1 方案会导致两次独立文件 I/O，本实现走 B2 避免了这一点，与 plan §2 的裁决
  一致）。
- `MAX_JSON_BYTES`（256MB）门槛前置于 `readFileSync`/`JSON.parse` 之前，超限文件不会被读入内存，
  阈值本身未改动，行为与改动前一致。
- `deriveScopeExtensionsFromFingerprint` 的时间复杂度是常数级（五条管线、每条扩展名个位数），
  未发现 O(n²) 或其他放大风险。

无 CRITICAL/WARNING 级发现。

## 攻击面 5：测试覆盖诚实度

- 逐一核对新增 `graph-consumption-cli.test.mjs` "Part 2b" 用例 (a)-(f)：均使用真实 CLI 子进程 +
  临时 git sandbox 驱动，不是对实现逻辑的镜像抄写（如 (b) 用例专门验证"动态面能收窄"，而非
  只验证"能扩大"这一更容易与实现逻辑同构的方向；(d) 用例枚举 8 种畸形形态，与本报告攻击面 1
  独立构造的形态高度重合但并非互相抄袭——两者各自独立到达同一组"全有或全无"证据）。
- 对 `tests/unit/graph-scope-extensions-contract.test.ts` 做了真实变异测试：临时从
  `GRAPH_SCOPE_EXTENSIONS` 移除 `.pyi`（模拟"某侧扩面遗漏同步"这一 fix-report 描述的真实历史
  故障形态）后跑 `vitest`，结果 **4 项断言中确有 2 项变红**（"并集覆盖六条管线各自的全部扩展名"
  与本应通过的第一条整体一致性断言），另外 2 项（"fallback 不含 SSoT 之外的扩展名"、"形态约束"）
  仍绿——与审查任务描述里提到的"变异测试报告声称 4 项中 2 项变红"的说法**定性吻合**。但本次审查
  在 `specs/254-fix-graph-scope-extensions/` 目录下**未找到任何变异测试产物或报告文件**，无法
  独立溯源该说法的出处（登记为 INFO-3，非本次代码本身的缺陷，建议若要在交付材料中引用该数字，
  应附带可复现的报告或脚本）。
- `graph-consumption-decision.test.mjs` 中所有原引用 `.mjs` 作为"范围外"反例的用例（L457-464、
  L1223 附近）均已按 plan 要求替换为真正落在并集之外的扩展名（`.md`/`README.txt`/
  `no-extension-at-all`），未发现遗留的失真断言。

结论：新增/修改测试具备真实守护力，非 tautology。

## 攻击面 6：常规质量门

- 命名与周边一致性：`FINGERPRINT_SURFACE_KEYS`（cli.mjs）与 TS 侧
  `collector-fingerprint.ts::EXTENSION_SURFACE_KEYS` 字面量顺序、取值逐一核对**完全一致**
  （`tsjsSkeletonWalk/pyWalk/genericAdapters/moduleDerivationScan/pythonSymbolScan`）。
- 死代码 / 调试残留：`grep` 未发现 `console.log`/`debugger`/`TODO`/`FIXME` 残留。
- 注入/路径逃逸：`deriveScopeExtensionsFromFingerprint` 只读取内嵌 JSON 字段做结构判定，不涉及
  路径拼接或子进程调用，无新增攻击面；`readEmbeddedGraphMeta` 的路径入参延续既有调用方传入的
  `graphJsonPath`，未新增外部可控输入。
- 构建阻断：`npm run build`（tsc 零错误）、`npm run test:plugins`（1320/1320 通过）、
  `npx vitest run` 针对性跑新增/关联测试（73/73 通过）、`npm run repo:check` 全绿（唯一 warning
  是仓库图产物本身 stale，需重建 `spectra batch --mode graph-only`，与本次代码改动无关）。

**WARNING-2（残余同形态漂移风险，方向安全）**：`FINGERPRINT_SURFACE_KEYS`
（`plugins/spec-driver/scripts/graph-consumption-cli.mjs`）是对 TS 侧
`collector-fingerprint.ts::EXTENSION_SURFACE_KEYS` 的**手写字面量复制**，且新增的跨语言合同
测试 `graph-scope-extensions-contract.test.ts` 只覆盖了 `GRAPH_SCOPE_EXTENSIONS`（静态
fallback 值）与 SSoT 的一致性，**未覆盖这份 key 列表本身与 TS 侧的一致性**。若未来 TS 侧
`EXTENSION_SURFACE_KEYS` 重命名或调整任一管线 key，`deriveScopeExtensionsFromFingerprint`
会因"缺失该 key"而永久静默回落 `static-fallback`——**方向是安全的**（不会导致覆盖面被错误
扩大，只是永久失去"图自述优先"这一本次修复的核心能力，且没有任何告警），但这正是与本 Fix
标题相同形态的"跨语言镜像遗漏"风险，只是本次尚未发生、且失败方向比原 bug 更安全。建议后续
补一条断言（可以是简单的 `Object.keys` 比较，从 `collector-fingerprint.ts` 动态 import 后
与 `FINGERPRINT_SURFACE_KEYS` 字面量比对），把这份复制也钉死在 SSoT 上，避免"这次修好的
镜像"未来又长出下一个同形态镜像盲区。

**WARNING-3（字段命名可读性）**：`annotate-caveat` 的完整 JSON 输出里，顶层事件对象与
嵌套的 `decision` 对象各自携带一个同名字段 `scopeExtensionsSource`，语义分属两个不同的
时间窗口（注解时点 vs 决策时点，实测两者可以不同，见攻击面 2 的探针）。下游若直接
`grep scopeExtensionsSource` 或做浅层字段提取，容易读到错误时点的值。建议对嵌套值加区分性
前缀（参照既有 `graphSourceCommitAtAnnotation` 的命名先例，如改为
`decision.scopeExtensionsSourceAtDecide`），或在文档/JSDoc 中显式提示这一命名陷阱。

## 已知在途项（不重复报告）

`DEGRADED_REASON_HINTS` 的"根因 O-5"文案修订、implement 代理收尾相关的新旧形态差异——按任务
说明已裁决/在途，本次不作为发现。

## 总结论

**PASS_WITH_WARNINGS**

- CRITICAL：0
- WARNING：3（TOCTOU 窗口下 caveat 静默丢失且无替代信号 / `FINGERPRINT_SURFACE_KEYS` 缺跨语言
  一致性守护，与本 Fix 修复的漂移同形态但失败方向安全 / 双层同名字段命名易读错时点）
- INFO：3（fingerprint 扩展名未做大小写归一化校验 / 顶层未知 key 宽容度低于 TS 侧但为有意裁剪 /
  "变异测试 4 项中 2 项变红"的说法无可溯源产物，本次审查独立复现定性吻合但不能代其背书）

方案 A 的核心不变量（"全有或全无"结构核验、C-002 两处判据同一份面、FR-010 快照校验与覆盖面
独立重推导的并列关系、B2 单次读取避免重复 I/O）在对抗构造下均成立，未发现 CRITICAL 级回归、
安全漏洞或构建阻断。三条 WARNING 均为方向安全的残余风险或可读性问题，不建议阻断本次交付，
但建议登记为 follow-up 待办（尤其 WARNING-2，与本 Fix 的根因属同一形态，值得在下一次触碰
这段代码时优先处理）。
