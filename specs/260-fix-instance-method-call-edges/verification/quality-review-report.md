# F260 代码质量审查报告（fix mode Phase 4b）

> 范围：`git diff HEAD` 可见的 10 个修改文件 + 2 个新建源文件 + `verification/*.mjs`。
> 只读审查，未改任何源码、未做 git 写操作、未重跑全量测试（4c 职责）。
> 依据：`plan.md` §2.3 LOC 预算 / §5 变更清单、`verification/p3~p5-attribution.md`、
> 仓库 `CLAUDE.md` 代码质量与架构约定。

---

## 1. 六维度评估

| 维度 | 评级 | 关键发现 |
|---|---|---|
| 架构合理性 | GOOD | 新逻辑确实落进两个新文件（纯函数、单向依赖、类型导入避免运行时环）；但 `call-resolver.ts` 仍净增 175 行（729→904），突破 plan §2.3 自订的 ≤40 硬预算 |
| 累积劣化 | WARNING | `call-resolver.ts` 729 → 904（+24%），跨过 800 行线；`typescript-mapper.ts` 1364 → 1404（净增恰好 40，卡在预算上沿） |
| 设计模式合理性 | EXCELLENT | 与门 fail-closed、单一事实源（`buildNamedImportBindings` 一处规则覆盖四条抽取路径）、两张表语义分离、first-write-wins 口径与 `deriveNodesFromSkeletons` 显式对齐；无过度抽象 |
| 安全性 | EXCELLENT | 无外部输入面；verification 脚本无 `eval` / `child_process`；新增正则均为线性单遍，无嵌套量词，无 ReDoS |
| 性能 | GOOD | 每个 TS/JS 文件多一次全 AST 遍历（O(n)，可接受）；`ast-analyzer` 里 `getNamedImports()` 重复调用一次 |
| 可读性 | EXCELLENT | 中文注释约定一致、写 why 不写 what、关键取舍（H5 / A1 / A3 / A6 / R-12）均就地登记；无 `data` / `info` / `temp` 类模糊命名 |
| 可维护性 | GOOD | 无 console.log / 注释代码块 / 未使用导入；`tsc --noEmit` 零错误。扣分项：一处自证死代码仍在源码里且注释误导、一条 plan 条款未实现且未登记 |

---

## 2. 问题清单

| # | 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---|---|---|---|---|---|
| Q1 | WARNING | 架构 / 累积劣化 | `src/knowledge-graph/call-resolver.ts`（整体 +199 / −24，净 +175） | plan §2.3 写死「`call-resolver.ts` 净增量 ≤ 40 行，超预算即视为设计偏离，不得就地膨胀」。实测净增 175（其中注释 92 行、空行 5 行、代码 102 行），超 §5 逐项合计（+69）也超 §2.3（+40）。`p4-attribution.md` L551 已就「该预算是否硬上限」请示编排器，**但制品里查不到落账裁决** | 二选一并落账：(a) 编排器裁决把 §2.3 对本文件的预算修订为实际值并记明理由；(b) 把 P5 的三个纯字符串助手（`extractTsExtendsClause` / `indexOfTopLevelKeyword` / `stripGenericParams` / `bracketAwareSplit`，约 70 行含注释）抽到 `src/knowledge-graph/class-heritage-parsing.ts`，与 plan「新逻辑落新文件」的原则一致，可把净增压回 ~100 行 |
| Q2 | WARNING | 可维护性 | `src/core/query-mappers/typescript-receiver-env.ts:281-282` | `if (node.type === 'property_identifier') return;` 是**团队自己实证过的死代码**（`p5-attribution.md` §2.2 + `typescript-mapper-callsite.test.ts:1879-1884`：「`property_identifier` 是叶子，删掉后通用递归照样采不到它…子审查实测：删除后全绿」）。但源码侧注释仍写「property_identifier 是属性名，不是绑定名」，读起来像承重判据——**源码注释与测试注释相互矛盾**，后续维护者会据源码误判它承重 | 按仓库「删除死代码」约定删掉这两行；若要保留作意图声明，注释必须改成「冗余保留：叶子节点，`out.push` 白名单已独立挡住；真正承重的是白名单」——不能维持当前措辞 |
| Q3 | WARNING | 可维护性 / 工具 | `verification/edge-diff.mjs:46`、`verification/callsites-fingerprint.mjs:64` | `const SEP = '<裸 0x00 字节>';` 用的是**字面 NUL 字节**而非 `'\x00'` 转义。实测两文件被 `grep -I` 判为 binary（另外三个 `.mjs` 均为 text），后续审计无法 grep 复现器，且任何经 sed / patch / 复制粘贴的文本处理都可能静默吞掉该字节导致 SEP 变空串（比较键从「分段」退化成「字符串拼接」，会掩盖键冲突） | 改为 `const SEP = '\x00';`（运行时逐字等价，文件恢复 text 属性）。属低成本高收益改动，建议本次一并处理 |
| Q4 | WARNING | 设计偏离（未落账） | `src/knowledge-graph/receiver-type-resolution.ts:118,144` | plan §4 D2b 条件 ⑤ 原文为「方法名存在于条件 ④ 那一个 export 条目自己的 `members`**（或 P5 之后的 ≤8 层 MRO 父类）**」。P5 已在库（`buildClassMroIndex` TS 分支已落地），但新分支**没有**接 MRO 回退，代码注释写的是「P5 之前无 MRO 回退」。全仓制品中检索不到撤回该括号条款的裁决 | 方向本身是安全的（只损 recall、不造假边），但属未落账的 plan 偏离。建议在 fix-report / plan 补一条显式登记：「D2b ⑤ 的 MRO 回退**不实现**，理由 X，recall 缺口量级 Y」，并同步把 `receiver-type-resolution.ts:118` 的注释从「P5 之前」改成「本次不做，见 R-xx」 |
| Q5 | INFO | 性能 | `src/core/ast-analyzer.ts:472,476` | `decl.getNamedImports()` 在同一函数体内被调用两次（一次求 `namedImports`、一次求 bindings） | 提一个 `const specs = decl.getNamedImports();` 复用；顺带消除两次调用结果漂移的理论可能 |
| Q6 | INFO | 设计 | `src/knowledge-graph/call-resolver.ts` `forEachNamedBinding` 的 `imported === '*'` 分支 | 该分支在 `namedImportBindings` 存在的路径上当前不可达：四条产出路径都来自 TS/JS 具名说明符，`'*'` 只出现在不产出该字段的语言（Python `from x import *`）。属防御性对称写法 | 可保留，但建议补一句注释说明「与旧路径保持形态对称，当前产出侧不可达」，避免读者误以为存在该输入 |
| Q7 | INFO | 测试 | `tests/unit/typescript-mapper-callsite.test.ts:1222-1252` `hostBucketKeys` | 探针在调用期间替换 `globalThis.Map`（全局可变状态，与 `.claude/rules/tests.md`「避免测试间共享可变状态」有张力） | 判定为**可接受**：替换窗口内只有同步的 `buildReceiverTypeEnv`，无 await，JS 单线程下无交叉；`finally` 必定复原；实现换容器会以「键集合为空」明红而非静默放行——这三点用例注释已如实登记。无需改动 |
| Q8 | INFO | 制品一致性 | `plan.md` §2.3 vs §5 | §2.3 说 `call-resolver.ts` 净增 ≤40，§5 变更清单给同一文件分配 +2/+30/+12/+25 = +69。**plan 自身内部不一致**，实现侧因此按「逐项预算」而非「文件预算」执行 | 随 Q1 的裁决一并订正 plan，让两处口径统一 |

---

## 3. 逐项回应审查要点

### 3.1 改动最小且聚焦 / LOC 预算

| 文件 | HEAD | 现状 | 净增 | 预算 | 结论 |
|---|---|---|---|---|---|
| `typescript-mapper.ts` | 1364 | 1404 | **+40** | ≤40（§2.3 / §5 #9） | ✅ 恰好卡线 |
| `call-resolver.ts` | 729 | 904 | **+175** | ≤40（§2.3）/ +69（§5 合计） | ❌ 见 Q1 |
| `ast-analyzer.ts` | — | — | +25 | +20（§5 #3） | 轻微超，可接受 |
| `tree-sitter-fallback.ts` | — | — | +7 | +10（§5 #5） | ✅ |
| `call-site.ts` | — | — | +23 | +28（§5 #7） | ✅ |
| `code-skeleton.ts` | — | — | +45 | +12（§5 #2） | 超，但多出的是 `buildNamedImportBindings` 单一事实源函数 + 字段文档，属合理落点 |
| 新建 `typescript-receiver-env.ts` | — | 648 | — | +260（§5 #8） | 2.5× 于估算，但职责单一（见下） |
| 新建 `receiver-type-resolution.ts` | — | 175 | — | +110（§5 #10） | 1.6×，同上 |

**新文件职责边界评估：合格。**
- `typescript-receiver-env.ts`：只做「`Parser.Tree` → 两张表 + 调用点查询」，无 I/O、无 resolver 概念、不 import 任何 knowledge-graph 模块；导出面只有 3 个符号（2 个 type + 2 个函数）。648 行里有 ~230 行是文档注释与判据表，实际逻辑密度不高，可读。
- `receiver-type-resolution.ts`：纯函数 + 一个索引构造器；用结构子集类型 `ReceiverImportView` 而不是导出整个 `ImportInfo`，依赖面在签名上一眼可见——这是好设计。对 `call-resolver.ts` 的反向依赖只有 `import type { CallSiteWithFile }`（编译期擦除，已注释说明不构成运行时环）。

### 3.2 命名 / 风格一致性

未发现 `data` / `info` / `temp` / 单字母（除循环下标 `i/j/k` 与短生命周期 `n/m/s`）类模糊命名。命名承载语义准确：`soleImportBinding`（正向许可）、`renamedImportAliases`（记 local 不记 imported，并在字段注释里论证了为什么）、`ASSIGNMENT_BINDING_TARGET_TYPES`（白名单语义显式）。中文注释约定、`F260 xx 裁决` 溯源标记、`⚠️` 反例登记的风格与周边 F242 / F259 注释完全一致。

### 3.3 遗留调试 / 死代码

- `console.log` / `debugger` / `TODO` / `FIXME` / 注释掉的代码块：两个新文件 **0 命中**。
- 未使用导入：`tsc --noEmit` 零输出（`noUnusedLocals` 若开启则同时覆盖）。
- `it.only` / `describe.only` / `.skip`：4 个测试文件 **0 命中**。
- **唯一死代码 = Q2**（`property_identifier` 的 return），且是团队自己实证并写进 attribution 报告的，属「已知未清」而非「未发现」。

### 3.4 测试质量抽查

抽查 3 条 attribution 结论 vs 测试现状，**三条全部对得上**：

| 抽查项 | 报告结论 | 现状核对 |
|---|---|---|
| `p5-attribution` §1.6：U16 守护力回归 → 补 N43b | N43b 承接 `collectPatternNames` 白名单通路 | ✅ `typescript-mapper-callsite.test.ts:1902` 存在；输入 `({ slot: rec.slot } = src)` 确实经 object_pattern 白名单一路递归到 `member_expression`，判别力真实 |
| `p5-attribution` §2.2：N44 从端到端断言改为**键集合**断言 | 表 2 宿主分桶键须逐字等于 `['anon#conn']` | ✅ L1922-1949 已改写，`hostBucketKeys` 探针到位；这次口径变更把 `V07b`~`V07g` 五个原「存活」变异体全部转杀，是本轮最有价值的守护力提升 |
| `p5-attribution` §2.2：N43 因果订正为「白名单承重、return 是死代码」 | 用例注释须改写 | ✅ L1879-1887 注释已改写并注明 P5b-3 之后本用例输入已走不到 `collectPatternNames`——**自曝守护力削弱**而非粉饰，诚实度合格 |
| 基线用例数 | mapper 侧 122→123、resolver 侧 109→111 | ✅ 实测 `it(` 计数：mapper 123 / resolver 111，与报告逐字一致 |

测试组织：按 `M1/M5/P5b-1..3` 分 describe、用例名带编号与一句话判据、每条注释写明「旧用例为什么杀不掉」，判别力设计是可复核的（R23–R31 九条尤其典型：全部靠构造判别性输入翻案，无一条靠重跑）。

### 3.5 安全 / 健壮性

- `indexOfTopLevelKeyword`：单遍 O(n·k) 字符扫描，无回溯；`/[\w$]/.test(c)` 作用于单字符；深度有 `Math.max(0, …)` 下界钳制（R26 钉住）。**无 ReDoS**。
- `bracketAwareSplit` / `stripGenericParams`：纯 `indexOf` / 单遍扫描。**无 ReDoS**。
- 既有 `SUPERCLASS_RE`（`/class\s+\w+\s*\(\s*([^)]+)\s*\)/`）本次未改；`\s*` 与 `[^)]+` 存在轻微重叠但无嵌套量词，且输入是短 signature 串，非风险项。
- `hasExtendsClause` 的 `/\bextends\b/` fallback 线性。
- verification `.mjs`：无 `eval` / `child_process` / `execSync`。
- 分隔符问题见 **Q3**（值得改，理由是可审计性与文本处理鲁棒性，不是安全漏洞）。

### 3.6 跨模块一致性（`CallSite` 新字段的 fail-closed 表述）

两侧表述**一致且互相呼应**：
- 产出侧 `src/models/call-site.ts:92-97`：「**`undefined` 按 `false` 处理**（fail-closed）：字段缺席只可能来自旧 baseline 或非 TS/JS mapper，此时 import 表的可信度无从判断，必须拦住。与 `receiverType` 由同一处产出，不存在『类型有、判据无』的半开组合。」
- 消费侧 `src/knowledge-graph/receiver-type-resolution.ts:170-171`：「A1：`undefined` 按 `false` 处理 —— 字段缺席意味着 import 表的可信度无从判断」，代码为 `if (cs.receiverTypeSoleImportBinding !== true) return null;`（严格等于 `true` 才放行，而非 `!== false`）。
- 结构保证：`_mkCallSite` 中两个字段在同一个 `if (receiver !== undefined)` 块内同时赋值，半开组合在类型层面不可构造；M14 用例做了遍历断言。

同样核对了 `renamedImportAliases`「记 local 不记 imported」这一非直觉决策在三处消费点（Stage 2 / Stage 3 / `lookupInMro`）的注释是否一致——三处均指回 `ImportInfo` 字段注释，无各自表述漂移。

---

## 4. 总体质量评级

**PASS（GOOD）**

- CRITICAL: **0**
- WARNING: **4**（Q1 预算超标未落账 / Q2 死代码+注释矛盾 / Q3 裸 NUL 分隔符 / Q4 D2b ⑤ MRO 条款未实现且未登记）
- INFO: **4**（Q5–Q8）

评级依据：零 CRITICAL 且 WARNING ≤ 5 ⇒ GOOD。四条 WARNING 均**不阻断交付**——没有一条指向假边风险、回归风险或运行时缺陷；其中 Q1 / Q4 是**制品落账缺口**（需要编排器一句裁决，不需要改实现），Q2 / Q3 是低成本清理项。

**建议处置顺序**：Q3（改 `'\x00'`，2 行）→ Q2（删死代码或改注释，2 行）→ Q1/Q4（编排器落账裁决，若选 Q1(b) 抽文件则须重跑 4c 门禁）→ Q5–Q8 可并入后续 feature。
