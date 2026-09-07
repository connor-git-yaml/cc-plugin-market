# Phase A 异构对抗审查 — β 角「fail-open / 降级面」

**审查员**：β（第二切入角）
**角度**：检查自身失效时会不会静默放行——每一个 `catch` / 早返回 / `null` 默认值的**方向**
**日期**：2026-09-07
**约束**：不重复 α 角（绕过构造面）已抓到的三条 CRITICAL（挂载判据只看结构存在性）
**纪律**：只读 + 微探针；override 一律落 scratch 根并经 `--project-root` 指向；工作区 `.specify/orchestration-overrides.yaml` 全程未创建；未跑 `repo:check` / `vitest` / `test:plugins` / `repo:sync`

## 审查对象

| 文件 | 审查方式 |
|---|---|
| `plugins/spec-driver/contracts/orchestration-schema.mjs` | 全文 + `git diff HEAD` |
| `plugins/spec-driver/lib/orchestration-resolver.mjs` | 全文 |
| `plugins/spec-driver/lib/orchestrator.mjs` | diff + `buildGateBehaviorMap` / `buildGateMountingMap` 全文 |
| `plugins/spec-driver/scripts/orchestrator-cli.mjs` | diff + `buildOrchestrator` / `cmdGetGateBehavior` / `cmdEffectiveOrchestration` / `fail` |
| `plugins/spec-driver/scripts/validate-gate-mounting.mjs` | 全文 |
| `scripts/lib/agent-tools-core.mjs` | 全文 |
| `scripts/lib/namespace-consistency-core.mjs` | diff + `extractFrontmatterTools` 全文 |
| `scripts/lib/repo-maintenance-core.mjs` / `scripts/sync-agent-docs.mjs` | diff + `aggregateValidation` / `validateSharedAgentDocs` |
| `plugins/spec-driver/templates/orchestrator-gate-mounting-guard.md` | 全文（FR-068 散文） |
| `plugins/spec-driver/templates/agent-output-discipline.md`（块 1） | 断言口径核对 |
| `plugins/spec-driver/lib/orchestrator-fallback.mjs` | 全文（降级目标） |

## 失效路径清单（先列后判）

`→βCn` / `→βWn` / `→β-In` 指向下方对应条目；`❌` = 方向偏严、已确认 fail-loud；`⚠️` = 方向偏松但当前不可达或只影响信号形态。

| # | 文件:行 | 分支原文（截断） | 偏严/偏松 | fail-open 候选 |
|---|---|---|---|---|
| 1 | `namespace-consistency-core.mjs:38` | `if (!fmMatch) return [];` | **偏松** | ✅ →βC1 |
| 2 | `namespace-consistency-core.mjs:60-66` | 块序列 `((?:[ \t]+-[ \t]+\S[^\n]*\n?)+)` 遇首个不匹配行**静默截断** | **偏松** | ✅ →βC1 |
| 3 | `namespace-consistency-core.mjs:68` | `return [];`（有 frontmatter 但无 `tools:`） | **偏松** | ✅ →βC1 |
| 4 | `namespace-consistency-core.mjs:42-48` | `toolsKeyCount > 1` → `throw` | 偏严 | ❌（α-W2 已收口） |
| 5 | `namespace-consistency-core.mjs:157-171` | 解析器 throw → 就地记 `fail` + `continue` | 偏严 | ❌ |
| 6 | `agent-tools-core.mjs:95` | `if (err.code === 'ENOENT') return null;` | 偏严（null ⇒ 各断言 fail） | ❌ |
| 7 | `agent-tools-core.mjs:96` | 非 ENOENT `throw err` → 族 catch → `status: 'fail'` | 偏严 | ❌ |
| 8 | `agent-tools-core.mjs:127-133` | `if (!Array.isArray(tools))` → fail | 偏严 | ❌ |
| 9 | `agent-tools-core.mjs:154` | `added = verifyTools.filter(t => !SNAPSHOT.includes(t))` | **偏松**（空集恒无新增） | ✅ →βC1 |
| 10 | `agent-tools-core.mjs:155-156` | `removed` 明示「不判红」 | 偏松（文档化选择） | ⚠️ →βC1 加剧项 |
| 11 | `agent-tools-core.mjs:170-174` | `typeof protocolText !== 'string'` → fail | 偏严 | ❌ |
| 12 | `agent-tools-core.mjs:177-179` | `prose.includes(p)` 全文短语存在性 + `hasSubject` | **偏松** | ✅ →βW1 |
| 13 | `agent-tools-core.mjs:219-234` | 族 catch → `status:'fail'` + `assertions: []` | 偏严（但丢粒度） | ❌（fail-loud，id 稳定；见已确认 4 / 9） |
| 14 | `orchestration-schema.mjs:144-150` | `findForbiddenGateOverrides` 畸形输入 `return []` | 偏松（由 schema 层兜底） | ❌（α-I5 已登记死代码语境） |
| 15 | `orchestration-schema.mjs:211` | `if (!Array.isArray(hardGateModes)) continue;` | 偏松（射程缩小） | ⚠️ →βC2 |
| 16 | `orchestration-schema.mjs:217-221` | `baseModes` 非纯对象 → 原样返回派生集合 | 偏严（注释所述） | ❌ |
| 17 | `orchestration-schema.mjs:222` | `.filter(mode => baseModes[mode] !== undefined)` | **偏松**（base 读得出但 mode 缺席 ⇒ 静默摘掉该 mode 的全部断言） | ✅ →βC2 |
| 18 | `orchestration-schema.mjs:248` | `if (!Array.isArray(phases)) return false;` | 偏严 | ❌ |
| 19 | `orchestration-schema.mjs:272` | `readPhases` 取不到返回 `[]` | 视调用方而定 | ⚠️ →βC2 |
| 20 | `orchestration-schema.mjs:384-391` | `baseAnchors.length === 0` ⇒ `mountedInBase: false` + `violations: []` | **偏松**（蕴含式前件为假 ⇒ 空洞放行） | ✅ →βC2 |
| 21 | `orchestration-schema.mjs:296` | `phase.name` 非字符串 ⇒ `null` ⇒ 下游 `missing-anchor` | 偏严 | ❌ |
| 22 | `orchestration-schema.mjs:399-401` | `anchor.phase === null` ⇒ `candidates = []` ⇒ 违规 | 偏严 | ❌ |
| 23 | `orchestration-schema.mjs:339-341` | successor 在 effective 缺席 ⇒ 计破坏 | 偏严 | ❌ |
| 24 | `orchestration-schema.mjs:472` | `if (!result.mountedInBase) continue;` | **偏松**（同 #20） | ✅ →βC2 |
| 25 | `orchestration-resolver.mjs:188-207` | base 加载抛错 → `error` diagnostic + `generateFallbackConfig()` | 偏严（有 error） | ❌ |
| 26 | `orchestration-resolver.mjs:212-259` | `!zodAvailable` → `warning` + `mergedConfig: rawBase` + 跳过 overrides | 偏严（overrides 不生效） | ❌（α 第 7 组已证） |
| 27 | `orchestration-resolver.mjs:323-326` | overrides 文件不存在 → 静默返 base，无 diagnostic | 偏严 | ❌ |
| 28 | `orchestration-resolver.mjs:335-343` | `_loadOverrides` 抛错 → `warning` loader-error + 回退 base | 偏严 | ❌ |
| 29 | `orchestration-resolver.mjs:349-357` | 文件 IO / YAML 语法错 → `warning` parse-error + 回退 base | 偏严 | ❌（见已确认 6） |
| 30 | `orchestration-resolver.mjs:386-387` | 空 YAML 文件 → **静默**返 base（无 diagnostic） | 偏严 | ❌ |
| 31 | `orchestration-resolver.mjs:394-402` | version 不一致 → `warning` + 回退 base | 偏严 | ❌ |
| 32 | `orchestration-resolver.mjs:435-442` | overrides schema 失败 → `warning` schema-fallback + 回退 base | 偏严 | ❌（见已确认 6） |
| 33 | `orchestration-resolver.mjs:497-516` | merged schema 失败 → `error` + 回退 base | 偏严 | ❌ |
| 34 | `orchestration-resolver.mjs:631-654` | 挂载违规 → `error` gate-mounting-lost + 回退 base | 偏严 | ❌ |
| 35 | `orchestrator.mjs:43` | `this.baseConfig = options.baseConfig \|\| this.config;` | **偏松**（自锚定恒无违规） | ✅ →βC2 / β-I2 |
| 36 | `orchestrator.mjs:179` | `this.baseConfig?.gates \|\| {}` | 偏松（gate 集合可空） | ⚠️ →β-I2 |
| 37 | `orchestrator.mjs:234` | `return this.gateMountingMap[gateId] === true;` | 偏严 | ❌ |
| 38 | `orchestrator.mjs:247-249` | `getGateMountingDetail` 用 `?? 现场算一次` | 偏严 | ❌ |
| 39 | `orchestrator.mjs:221-224` | `getGateBehavior` 未知 gate ⇒ `{behavior:'on_failure', isHardGate:false}` | **偏松** | ⚠️ →β-I5 |
| 40 | `orchestrator.mjs:143` | `behavior = gateDef.default_behavior \|\| 'on_failure'` | 偏松（`\|\|` 吃空串） | ⚠️ →β-I6 |
| 41 | `orchestrator-cli.mjs:37-40` | `fail()` 把 JSON 写 **stderr** 并 `exit(1)`，stdout 空 | 偏严（判据 3 兜住） | ❌ |
| 42 | `orchestrator-cli.mjs:118-142` | `get-gate-behavior` 输出**不含** `is_fallback` / `diagnostics` | **偏松** | ✅ →βW3 |
| 43 | `orchestrator-cli.mjs:68-72` | diagnostics 只写 stderr，不进 stdout JSON | 偏松 | →βW3 加剧项 |
| 44 | `validate-gate-mounting.mjs:95-98` | `configReadable` 为假 ⇒ `resolveGateMountingEnforcedModes(null)` | 偏严（但射程缩水） | ⚠️ →βW4 |
| 45 | `validate-gate-mounting.mjs:107` | `configReadable ? collect… : []` ⇒ mounted=false | 偏严 | ❌ |
| 46 | `validate-gate-mounting.mjs:131` | `?.[…]?.[…]?.is_hard_gate === true` | 偏严 | ❌ |
| 47 | `validate-gate-mounting.mjs:144/156` | `typeof behavior === 'string' && !FORBIDDEN.includes(...)` | 偏严 | ❌ |
| 48 | `validate-gate-mounting.mjs:169-171` | `readable && errorDiags.length === 0` | 偏严 | ❌ |
| 49 | `validate-gate-mounting.mjs:223-238` | 族 catch → `status:'fail'` + `assertions: []` | 偏严（丢粒度） | ❌（见已确认 2） |
| 50 | `repo-maintenance-core.mjs:177-187` | `aggregateValidation` **完全不读 `result.status`** | **偏松**（结构性风险） | ✅ →β-I1 |
| 51 | `repo-maintenance-core.mjs:450` | `status = errors.length > 0 ? 'fail' : …` | 偏松（同 #50） | →β-I1 |
| 52 | `repo-maintenance-core.mjs:227-243` | `validateSharedAgentDocsSafely` catch → 单条 `shared-section-status` fail | 偏严（但吞掉全部 `shared-section:*`） | ⚠️ →βW5 |

## CRITICAL

### **[β-C1]** `extractFrontmatterTools` 的三种「读不全」都返回 `[]` 或截断清单，而 `verify:no-added-tools` 的判据（集合差）对**残缺输入恒真** —— verify 工具面被扩到含 `Write` / `Edit` 时两个守护族同时判绿

**命中位置**
- `scripts/lib/namespace-consistency-core.mjs:38` `if (!fmMatch) return [];`
- `scripts/lib/namespace-consistency-core.mjs:60-66` 块序列正则 `/^tools:\s*\n((?:[ \t]+-[ \t]+\S[^\n]*\n?)+)/m` —— 连续匹配在**首个不匹配行处停止**，其后的条目静默丢弃
- `scripts/lib/namespace-consistency-core.mjs:68` `return [];`
- `scripts/lib/agent-tools-core.mjs:154` `const added = verifyTools.filter((t) => !VERIFY_TOOLS_FROZEN_SNAPSHOT.includes(t));`
- `scripts/lib/agent-tools-core.mjs:158` `added.length === 0` 即 `pass`

**为什么是 fail-open**
护栏 (ii) 的判据是**单向集合差**：`added ⊆ 解析器所见`。解析器每漏读一项，`added` 就少一项；解析器**完全读不出**时 `added = ∅`，判据恒成立。也就是说「解析器失效」与「确实零新增」在这条判据上**是同一个观测值**，而 (ii) 是这次改动里唯一守 verify 写面的断言。同一残缺清单在 `removed` 侧倒是全量可见，但代码明写「不判红」（`:156`）——于是「六项全删」被打印成一句附注，「新增了 Write/Edit」则根本没进入观测。

**失效构造与实测输出**（探针：`scratchpad/p_tools.mjs` / `p_trunc.mjs`，纯函数直调，未改仓内任何文件）

第一类 —— 解析器完全读不出（返回 `[]`）：

```
M1 verify.md 删掉 tools: 键          解析 -> []   (ii) pass  「相对冻结快照零新增」
M2 verify.md 整个 frontmatter 删掉    解析 -> []   (ii) pass  「相对冻结快照零新增」
M3 verify.md tools: []               解析 -> []   (ii) pass
M4 frontmatter 前多一个空行           解析 -> []   (ii) pass   ← 文件实际内容是
                                                              tools: [Read, Write, Edit, Bash, Task]
M4b 文件带 UTF-8 BOM                  解析 -> []   (ii) pass   ← 文件实际内容含 Write / Edit
M5 tools 写成 mapping                 解析 -> []   (ii) pass
```

M4 / M4b 是最直白的一组：文件里逐字写着 `Write` 与 `Edit`，护栏报「相对冻结快照**零新增**」。

第二类 —— 解析器**部分**读出（这一类连既有 `namespace-consistency` 族都拦不住，因为存活项里还有一个正确 namespace 的 `mcp__` 工具）：

```
T1 块序列中间插一个空 item（"-" 后无 \S）
   文件实际:  - Read / - mcp__…impact / - / - Write / - Edit
   解析器所见: ["Read","mcp__plugin_spectra_spectra__impact"]
   (ii) pass 「相对冻结快照零新增；删减（不判红）：[Bash, Grep, Glob, mcp__…detect_changes]」
   namespace 族: mcp__ 项数 = 1 ⇒ 该族 pass

T2 块序列中间插一条 `# 注释`      同上 → (ii) pass，namespace 族 pass
T3 块序列中间插一个空行            同上 → (ii) pass，namespace 族 pass
```

三种写法（空序列项 / 注释行 / 空行）**都是合法 YAML**，符合规范的解析器会读到全部 5 项（含 `Write` / `Edit`），运行时按全部 5 项授权；本仓两个守护族读到的是前 2 项，齐声判绿。

**为什么是静默的**
1. 三个返回点（`:38` / `:68` / 块序列截断）都不产生任何 diagnostic、warning 或 evidence 字段——解析器**没有「我没读全」这个输出通道**；
2. (ii) 的 `detail` 在 T1/T2/T3 下打印的是「相对冻结快照零新增；删减（不判红）：[Bash, Grep, Glob, …]」——读者看到的是一句 **pass**，那句「删减」附注恰恰是解析器失效的唯一痕迹，却被显式声明为不判红；
3. α-W2 的收口（重复 `tools:` 键 → throw）**不覆盖本类**：T1/T2/T3 中 `tools:` 键恰好出现一次，`toolsKeyCount > 1` 不成立。

**与 α-W2 / α「已确认封住第 9 组」的关系（不是重报）**
α 第 9 组测的是 `["Edit ", "edit"]` 这类**内容**变体——那些都产出**非空**数组，故 `added` 非空、判红，方向正确。β 打的是**基数**方向：解析器给出**空集或真子集**时 `added` 恒为空。两者互补，α 的结论「方向 fail-closed」只对非空输入成立。

**最小修补方向**（三选一，或叠加）
1. 解析器把「读不出」与「读出空表」分开：无 frontmatter / 无 `tools:` 键返回 `null`（agent-tools 的 `!Array.isArray(tools)` 分支已经准备好按 fail 处置），`tools: []` 才返回 `[]`；
2. 块序列改为「消费到 frontmatter 内下一个顶层键为止」，凡遇到无法归类的行即 `throw`（与 α-W2 的重复键同一处置：判不出⇒判失败）；
3. (ii) 增一条**基数护栏**：`verifyTools.length < VERIFY_TOOLS_FROZEN_SNAPSHOT.length` 时判 fail（把现在的 `removed` 附注升级为断言）。三者中 (1)+(2) 是治根，(3) 是最小成本兜底。

### **[β-C2]** 「强制 mode 清单」从**被守护的那份配置自身**派生，且用 `!== undefined` 静默过滤 —— 从 base 删掉一个强制 mode，FR-053 事后守护的断言数从 12 悄悄变成 9 并报 `pass`，FR-068 运行时守卫同时空洞放行

**命中位置**
- `plugins/spec-driver/contracts/orchestration-schema.mjs:222`
  `return [...derived].filter(mode => baseModes[mode] !== undefined).sort();`
- `plugins/spec-driver/scripts/validate-gate-mounting.mjs:95-98`（`enforcedModes` 来自 `effectiveConfig`）与 `:105`（`for (const mode of enforcedModes)`）
- `plugins/spec-driver/contracts/orchestration-schema.mjs:384-391` + `:472`
  `if (baseAnchors.length === 0) return { mountedInBase: false, … violations: [] }` / `if (!result.mountedInBase) continue;`

**为什么是 fail-open**
守护项的**射程**（要检查哪几个 mode）与它要检查的**事实**（那几个 mode 挂没挂门）取自同一份文件。删掉 `modes.implement` 这一段，`implement` 就同时从「要检查的清单」和「检查结果」里消失——`for` 循环少转两圈，`errors` 为空，`status` 判 `pass`。少检查的那部分没有任何输出通道：`evidence.total` 从 12 变 9，但没有任何断言、测试或基线钉住「必须是 12」。

**失效构造与实测输出**（scratch 实验室 `scratchpad/lab`：`plugins/spec-driver` 整树副本 + `node_modules` 软链 + 空项目根 `lab/proj`；工作区未改动）

```
### B0 未改动基线
  ⇒ FR-053 守护: status=pass  断言 12/12
  ⇒ FR-068 守卫（feature）: 放行

### B6：把 base config/orchestration.yaml 里 `  implement:` 整段（行 447~523）删掉
  effective-orchestration feature --format json  exit=0  diagnostics=[]        ← 没有任何 error
  get-gate-behavior implement GATE_DESIGN exit=0 mounted=false mounted_in_base=false viol=0
  ⇒ FR-068 守卫: 放行（蕴含式前件为假 + diagnostics 无 error）
  ⇒ FR-053 守护: status=pass  断言 9/9
     PASS mounting:feature:GATE_DESIGN / mounting:feature:GATE_TASKS
     PASS mounting:story:GATE_DESIGN  / mounting:story:GATE_TASKS
     PASS is-hard-gate:feature:GATE_DESIGN / default-behavior:GATE_DESIGN / default-behavior:GATE_TASKS
     PASS diagnostics:feature / diagnostics:story
     （mounting:implement:GATE_DESIGN / mounting:implement:GATE_TASKS / diagnostics:implement 三条**整条消失**，不是判 fail）

### B7：改删 `  story:` 整段 —— 完全同型
  ⇒ FR-053 守护: status=pass  断言 9/9（story 三条消失，implement 三条在）
```

射程派生函数的直接观测（`scratchpad/p_misc.mjs`）：

```
健康 base            -> ["feature","implement","story"]
base 删掉 implement  -> ["feature","story"]          ← 静默少一个
hard_gate_modes=null -> ["implement","story"]        ← feature 也能这样掉出去
```

`feature` 掉出射程时还有 `is-hard-gate:feature:GATE_DESIGN` 兜住（`is_hard_gate` 随之变 false ⇒ 判 fail）；
**`story` / `implement` 没有任何等价的锚**——它们唯一的入选条件就是「自己还在 `modes` 里」。

**可达的运行时后果**（B8：base 删掉 `story` + scratch 项目根放一份把 `story` 补回来、**零挂门**的 overrides）

```
get-gate-behavior story GATE_DESIGN
  {"success":true, "behavior":"always", "is_hard_gate":false,
   "mounted":false, "mounted_in_base":false, "mounting_violations":[]}
effective-orchestration story --format json
  diagnostics=["info:orchestration-overrides.mode-overridden"]   ← 只有一条 info
  story phases=2   挂门 phase 数=0
⇒ FR-068 守卫: 放行     ⇒ FR-053 守护: status=fail 10/12（story 两条挂载判红）
```

即：一次 `story` 运行的 effective phase 序列**一道门都不挂**，运行时守卫照样放行。
resolver 侧的 FR-052 丙之所以没拦，是因为它的射程来自 **base**（`validateGateMounting(merged, baseConfig)` → `resolveGateMountingEnforcedModes(baseConfig)`），
而 base 已经没有 `story` 了；同时 `mergeOrchestrationConfigs:75-81` 允许 overrides **新增** base 里没有的 mode（`mergedModes[modeKey] = modeDef`），
于是「射程按 base 算、事实按 effective 算」这条缝正好可以钻。

**为什么是静默的**
1. B6 / B7 下 `diagnostics` 是**空数组**——base 少一个 mode 完全过得了 `orchestrationBaseSchema`（`modes: z.record(...)`，键数不限），所以 FR-068 判据 2 没有触发点；
2. FR-053 的返回值里没有任何「本次射程比预期小」的字段，`status: 'pass'`、`errors: []`、`evidence.passed === evidence.total`；
3. 单测只钉住了**加**的方向和**全黑**的方向，没钉**减**的方向：
   - `plugins/spec-driver/tests/validate-gate-mounting.test.mjs:177-188` 往 `hard_gate_modes` 里塞 `refactor`，断言 `assertions.length === 15`，注释写「判据若写成 `[feature,story,implement]` 字面量，此处必漏」；
   - `:191-199` 传 `effectiveConfig: null`，只断言 `assertions.length > 0` 与「全 fail」，**不**断言条数；
   - 没有任何用例构造「配置里少一个强制 mode」并要求判红。

**这是已登记残余的声明范围不够，不是重报**
守卫散文 `templates/orchestrator-gate-mounting-guard.md:45`（残余 2）写：

> 该路径**只**由上述 `repo:check` 侧的事后守护项承担（这正是它的挂载断言坚持绝对形式的原因），且那一条只覆盖到「**锚点被删掉**」与「锚点被加上 `conditional`」两种形态

B6 / B7 正是「锚点被删掉」——把整个 mode 删掉，锚点当然一并没了——而 `repo:check` 侧实测 **`status = pass`**。
故残余 2 声称由事后守护承担的覆盖面，在「删掉的是整个 mode 而不只是 `gates_*` 数组里那一项」时**不成立**。
（α 第 6 组测的是「把 `- GATE_DESIGN` 两行改成 `- GATE_ANALYSIS`」——mode 还在，故 `mounting:feature:GATE_DESIGN` 仍在射程内并判红，与本条不矛盾，是同一残余的两个不同形态。）

**最小修补方向**
1. 射程不能只来自被守护的配置：把强制 mode 清单的**下界**钉死——`GATE_MOUNTING_MANDATORY_TIER_MODES` 里的 mode 无论配置里在不在都必须产出断言，缺席时判 `fail`（detail 写「该强制 mode 在配置中缺席」），即把 `:222` 的 `filter` 从「静默剔除」改成「剔除即记违规」；
2. `evaluateGateMountingAssertions` 增一条**条数断言**：产出的 `mounting` 类断言数必须 `= |强制 mode 下界| × |GATE_MOUNTING_ENFORCED_GATES|`，否则单独判 fail；
3. 补一条「减」方向的单测（删 `modes.implement` ⇒ 必须判红），与既有 `:177-188` 的「加」方向配对。

## WARNING

### **[β-W1]** 块 1 的文本断言是**全文短语存在性**，声明被整段删掉后只要那 6 个词还散落在文件任何角落（含 HTML 注释、代码块、变更历史行）就判 `pass`

**命中位置**：`scripts/lib/agent-tools-core.mjs:176-179`

```js
const prose = normalizeProse(protocolText);
const missing = PROTOCOL_VERIFY_DISCLOSURE_PHRASES.filter((p) => !prose.includes(p));
const hasSubject = prose.includes(PROTOCOL_SUBJECT_ANCHOR);   // 'verify.md'
const ok = hasSubject && missing.length === 0;
```

判据里没有任何**邻近性**、**顺序**、**章节归属**或**否定语气**约束：7 个字符串在**整份文件**里各出现一次即可。

**实测**（`scratchpad/p_text.mjs`，纯函数直调）

```
X1 一句与 verify 无关的胡话把 6 条短语 + verify.md 串起来        status=pass
X2 全部塞进 HTML 注释（正文完全不谈 verify）                     status=pass
X3 全部塞进 fenced code block                                    status=pass
X4 真实声明被删、只留一条「变更历史：已删除原…一段」的记录行      status=pass
REAL agent-output-discipline.md                                  status=pass（对照）
```

X4 最能说明问题：文件里逐字写着「**删除了**原『verify.md 不适用 / …』一段」，断言仍报「含全部 6 条短语契约」。

**为什么是静默的**：`detail` 打印的是「含全部 6 条短语契约」，读者拿到的是一句肯定性的证据陈述，而实际被验证的只是「这 6 个子串在文件里出现过」。真实文件中 4 条短语挤在同一行（行 19），主语锚 `verify.md` 在行 15——即便现状是对的，判据本身也没有把它们绑在一起。

**最小修补方向**：把 6 条短语的匹配限定在**同一段落**内（按空行切段，要求存在一个段落同时含主语锚与全部短语），或改为对该声明段做**规范化 sha256 冻结值**比对（与 `VERIFY_TOOLS_FROZEN_SNAPSHOT` 同型，改哈希 == 主动放宽，须走 spec 修订）。

---

### **[β-W2]** 运行时守卫唯一的 per-file 参数 `SD_MODE` 被刻意放在同步块**之外**，因而落在**所有守护之外**；写错一个值即让守卫对着另一个 mode 判、恒绿

**命中位置**
- `plugins/spec-driver/templates/orchestrator-gate-mounting-guard.md:3`「由本块**之外**紧邻上方声明的一行 `SD_MODE=<mode>` 给出」
- 实际声明点：`skills/spec-driver-feature/SKILL.md:108` / `-story:113` / `-implement:122` / `-fix:110` / `-resume:72`（全部在 `<!-- BEGIN SHARED SECTION -->` 之前一行）

**实测**：全仓检索 `SD_MODE`，`scripts/` / `plugins/spec-driver/scripts/` / `plugins/spec-driver/tests/` / `tests/` 下**零命中**——没有任何守护项、单测或同步链断言这一行的取值。
`docs:sync:agents` 的漂移比对只覆盖 marker **之间**的字节（`sync-agent-docs.mjs:124-136` 的 `syncSection` 按 `indexOf(beginMarker)` / `indexOf(endMarker)` 切片），`SD_MODE=` 那一行结构性地不在比对范围内。
15 份副本（`skills/` 5 + `skills-codex/` 5 + `.codex/skills/` 5）当前取值全部正确（实测逐一核对），但 codex 侧是 wrapper 生成器按 body-sha256 复刻源 SKILL 的产物——**源里写错，三份副本会一起忠实地错**。

**为什么是静默的**：把 `spec-driver-story/SKILL.md` 的那行写成 `SD_MODE=feature`（复制粘贴最常见的一种错），守卫会去查 `feature`——`feature` 永远 `mounted=true`——于是 story 流程带着一个**恒绿**的守卫跑完，输出面上没有任何异常。α-I2 已证 `$SD_MODE` 为空 / 拼错时靠第三条命令 `exit=1` 兜住；但**拼成另一个合法 mode** 时三条命令全部 `exit=0`、字段齐全、判据 1/2/3 全过。

**最小修补方向**：在 `repo:check` 里加一条极窄断言——对 5 份编排器 SKILL 逐份提取 `BEGIN SHARED SECTION: orchestrator-gate-mounting-guard` 之前最近的 `SD_MODE=(\w+)`，要求其值等于该 SKILL 目录名去掉 `spec-driver-` 前缀；缺席或不等即判 fail。成本一条断言，覆盖全部 15 份副本的源。

---

### **[β-W3]** `get-gate-behavior` 的 stdout 里**没有任何降级标记**；base 配置三种损坏形态下它照答 `success:true / mounted:true / behavior:always`，唯一闸门是第三条命令

**命中位置**：`plugins/spec-driver/scripts/orchestrator-cli.mjs:118-142`（输出字段清单里没有 `is_fallback` / `is_base_invalid` / `diagnostics`）与 `:68-72`（diagnostics 只写 **stderr**）。
对照：`cmdValidateConfig`（`:250-271`）**有** `is_fallback` 字段，并在注释里写明「真实降级状态在 `resolverResult` 中……否则降级场景会被错报为『配置有效』」——同一份 `resolverResult` 的降级位在 `get-gate-behavior` 这条路上被丢弃了。

**实测**（scratch 实验室，三种 base 损坏）

```
B1 base orchestration.yaml 缺席
B2 base YAML 语法损坏
B3 base 合法 YAML 但缺 version 键（zod 不过）
  —— 三者输出完全一致：
  get-gate-behavior feature GATE_DESIGN  exit=0  mounted=true mounted_in_base=true viol=0 behavior=always
  get-gate-behavior feature GATE_TASKS   exit=0  mounted=true mounted_in_base=true viol=0 behavior=always
  effective-orchestration feature --format json  exit=0  diagnostics=["error:orchestration.base-invalid"]
  ⇒ FR-068 守卫: BLOCKED —— 只因判据 2（diagnostics 有 error）
  ⇒ FR-053 守护: status=fail 8/12
```

此时引擎实际跑的是 `generateFallbackConfig()` 的 6 phase 桩（feature 从 17 phase 降到 6，`research` / `analyze` / `clarify` 等整段不存在），而 `get-gate-behavior` 对这份桩**自锚定**（`mergedConfig === baseConfig === fallbackConfig`），于是 `mounted` 诚实地答 `true`——它答的是「相对这份桩没丢挂载」，不是「相对真正的 base 没丢」。

**为什么值得记**：这条路**封住了**，但只由判据 2 一条闸门承担，而判据 2 依赖第三条命令。α-I2 已就 `$SD_MODE` 拼错一例指出「若将来有人把三条命令精简成两条，这条兜底随之消失」；本条把该风险的覆盖面扩大到**整个 base 损坏类**：删掉 `effective-orchestration` 这一条，base 缺失 / 语法坏 / schema 不过三种形态**全部**变成静默放行，而两条 `get-gate-behavior` 的输出面上看不出任何异样。

**最小修补方向**：`cmdGetGateBehavior` 的 output 里并列一个 `degraded: resolverResult.isFallback` 与 `diagnostics_error_count`，并在守卫散文判据 1 里加一句「`degraded === true` 即 `BLOCKED`」——让两条 `get-gate-behavior` 自身也带闸门，不把整类降级压在第三条命令上。

---

### **[β-W4]** `validate-gate-mounting.mjs:97` 注释宣称「effective 取不到时**不缩小射程**」，实测缩小：12 条变 9 条，`feature` 的三条整条缺席

**命中位置**：`plugins/spec-driver/scripts/validate-gate-mounting.mjs:95-98`

```js
const enforcedModes = configReadable
  ? resolveGateMountingEnforcedModes(effectiveConfig)
  // effective 取不到时不缩小射程：退回 mode 分层矩阵的强制格，逐条判 fail
  : resolveGateMountingEnforcedModes(null);
```

**实测**（`scratchpad/p_misc.mjs`）

```
evaluateGateMountingAssertions({effectiveConfig:null, …})
  断言条数 = 9（健康时 12）
  实际 id 集: mounting:implement:{DESIGN,TASKS}, mounting:story:{DESIGN,TASKS},
              is-hard-gate:feature:GATE_DESIGN, default-behavior:GATE_DESIGN,
              default-behavior:GATE_TASKS, diagnostics:implement, diagnostics:story
  缺席: mounting:feature:GATE_DESIGN / mounting:feature:GATE_TASKS / diagnostics:feature
```

`resolveGateMountingEnforcedModes(null)` 返回 `["implement","story"]`——`feature` 是从 `GATE_DESIGN.hard_gate_modes` 派生的，base 读不出来时它也就派生不出来。
这条**目前不导致放行**（幸存的 9 条全判 fail，整体仍 `status: fail`），但注释所述与实际行为不符，且它与 β-C2 是同一个根因的两个表现面；把「不缩小射程」当成已成立的性质写进验收口径即为 over-claim。

**最小修补方向**：与 β-C2 修补 1 合并——强制 mode 下界写死为 `GATE_MOUNTING_MANDATORY_TIER_MODES ∪ {feature}`，派生只能**扩**不能**缩**。

---

### **[β-W5]** `validateSharedAgentDocs` 一处抛错即抹掉全族 13 个 `shared-section:*` 检查、只剩 1 条 `shared-section-status`；K14 精确数组随之变形，红的形态像「排序回归」而不是「守护项自己坏了」

**命中位置**
- `scripts/sync-agent-docs.mjs:168-196`：`for` 循环里 `readFileSync(sourcePath)` / `readFileSync(targetPath)` / `syncSection` 任一抛错，函数直接抛出，**局部 `checks` 数组整个丢弃**（不是 `continue`）
- `scripts/lib/repo-maintenance-core.mjs:227-243`：`validateSharedAgentDocsSafely` 把它收敛成**单条** `{ id: 'shared-section-status', status: 'fail' }`

**实测**（`scratchpad/p_agg.mjs`）

```
sectionConfigs 条数 = 13（本次 +3：块 2 / 块 1 / 块 3）
validateSharedAgentDocs(<空目录>) 抛错 -> ENOENT: … /AGENTS.md
  Safely 收敛后 checks id = ["shared-section-status"]（原本 13 个 shared-section:* 全部消失）
```

**方向是 fail-loud**（`errors` 非空 ⇒ 顶层 `status: 'fail'`），所以不是放行；问题在**信号形态**：
本次把注入面从「仓根 2 个文件」扩到 **16 个 target**（5 SKILL × 块 2 + 4 agent × 块 1 + 7 SKILL × 块 3），
其中任意一个文件被删、被改名、或 marker 被误删，都会让 `repo:check` 输出里**同时**：
(a) 消失 13 条 `agent-docs:shared-section:*`，(b) 冒出 1 条基线里没有的 `agent-docs:shared-section-status`。
K14 的 `expect(added).toEqual([...])`（`tests/integration/spec-drift-repo-check-regression.test.ts:139-166`）会以「数组内容/顺序不符」的形式红——
而该测试的注释反复强调「插队即让本断言以『顺序不符』形式红，而那是排版问题不是接线问题，会污染本断言的信号」，
恰恰**预告了这个混淆**：真出事时读者拿到的红和「有人往数组中间插了个 entry」长得一模一样。

（对照：两个**新**族在 catch 路径上的 check id 是稳定的——`agent-tools:required`（`agent-tools-core.mjs:226` 与 `:240` 同为 `'required'`）、`gate-mounting:effective-config`（`validate-gate-mounting.mjs:229` 与 `:244` 同为 `'effective-config'`），故它们内部报错不会让 K14 的 `added` 变形。这一点做对了。）

**最小修补方向**：`validateSharedAgentDocs` 的循环改为 per-section try/catch（与 `namespace-consistency-core.mjs:157-171` 刚落地的那处同型：就地记 `shared-section:<key>` 的 fail 并 `continue`），保住其余 12 条的结论与 id 稳定性；`shared-section-status` 只保留给「连 `sectionConfigs` 都读不出来」这一种情形。

---

### **[β-W6]** 块 3 里唯一约束 `fix` 行为的那条规则（「`fix` 下 MUST 裁剪一律记未接受、须走移交卡」），恰恰**没有发给 `fix`**

**命中位置**
- `plugins/spec-driver/templates/gate-tasks-scope-cut-acceptance.md:21` 与 `:57`——两处点名 `fix`，规定 `fix` 下的处置
- `scripts/sync-agent-docs.mjs:110-121`——块 3 的 `targets` 是挂载 `GATE_TASKS` 的 7 个 mode，**`spec-driver-fix` 被显式排除**（entry 注释里写明理由：`fix` 的 `GATE_TASKS` 命中数为 0）

**实测**

```
块 3 marker 在各 SKILL 的存在性：
  feature=1  story=1  implement=1  fix=0  resume=1  sync=1  doc=1  refactor=1
spec-driver-fix/SKILL.md 中 "未接受" / "移交卡" / "裁剪" 的出现次数：0
```

**为什么是 fail-open**：排除 `fix` 的理由（「按 `applicable_modes` 取 targets 会多注一份永不被求值的散文」）对块 3 的**大部分**内容成立——`fix` 下那道门确实不会停。但块 3 的 `:21` / `:57` 两句正是**为「门不会停」这一情形写的处置**：门结构性不可达 ⇒ 一律记「未接受」⇒ 交付判不通过。这条规则的**唯一执行者**是 `fix` 编排器，而它拿不到这段话。结果是：`fix` 流程里发生 MUST 裁剪时，编排器既不会停门（结构性），也不会看到「一律记未接受」的指令——它的默认行为就是照常继续，且不会在产物里留下任何「未接受」记录。这不是有人绕过，是**规则送错了地址**。

**最小修补方向**：把块 3 拆成两段——通用接受口径（保持现 7 个 targets）+ 一段极短的「本模式 `GATE_TASKS` 零挂载时的处置」，后者的 target 只放 `spec-driver-fix`；或者把 `spec-driver-fix` 加进块 3 的 targets 并在正文首句写明「本块在 `fix` 下只有『门不停时的判定』一节适用」。

## INFO

- **[β-I1]** `aggregateValidation`（`repo-maintenance-core.mjs:177-187`）**完全不读 `result.status`**，顶层 `status` 只由 `errors.length` 派生（`:450`）。实测演示：某族返回 `{status:'fail', checks:[{status:'fail'}], errors:[]}` 时，顶层 `status` = `pass`，而 `checks` 里那条 `fail` 仍在。当前三个新族都做到了 `errors` 与 `fail` 断言 1:1（`agent-tools-core.mjs:250`、`validate-gate-mounting.mjs:254`、两处 catch 各填一条），故**未触发**；但这个「族必须自己把 fail 翻译成 error」的契约没有任何机制强制，属结构性风险，值得在 `aggregateValidation` 里补一句 `if (result.status === 'fail' && (result.errors ?? []).length === 0) errors.push(...)`。

- **[β-I2]** `orchestrator.mjs:43` 的 `this.baseConfig = options.baseConfig || this.config;` 是自锚定回退（自锚定 ⇒ `evaluateGateMountingAgainstBase` 恒无违规）。全仓检索 `new Orchestrator`：生产路径**只有** `orchestrator-cli.mjs:73` 一处，且已正确传 `baseConfig: resolverResult.baseConfig`；其余全在单测里。故当前不可达。但把 `Orchestrator` 当库直接构造的消费方（含将来的新 CLI 子命令）会拿到一个恒绿的 `mounted`，且**没有任何提示**——`||` 在这里承担的是安全语义，建议改为「不传即 `mounted` 全部按 `false`」或显式 `required`（F238 的「前缀承担控制信号必被击穿」同型教训）。

- **[β-I3]** 缺 zod 是**下游安装的常态**，不是异常：`plugins/spec-driver/` 下既无 `package.json` 也无 `node_modules`（实测），而 `package.json` 的 `files` 只发 `["dist/","grammars/","queries/","scripts/lifecycle-runner.cjs","plugins/","templates/","README.md"]`——`scripts/lib/*.mjs` 与 `scripts/repo-check.mjs` **不在发布面内**。由此两条结论：
  (a) 本次两个新族（`agent-tools` / `gate-mounting`）是**仓库本地**守护，下游项目跑不到它们，故「`plugins/spec-driver/agents/` 在消费者仓库缺席会判 8 条全红」这个担心**不成立**——那条路根本不会被执行；
  (b) 反过来，下游**能**执行的是 FR-068 运行时守卫，而它在缺 zod 环境下的实测行为是：`diagnostics=["warning:orchestration.zod-unavailable"]`、`mounted=true`、守卫**放行**、`.specify/orchestration-overrides.yaml` **整份不生效**（`orchestration-resolver.mjs:212-259`）。安全方向正确（用户输入落不了地），但**可用性方向**是：下游项目辛苦写的项目级编排覆盖在常态安装下静默失效，唯一线索是一条写到 stderr 的 warning，而判据 2 按设计只看 `error`。这一点值得在 contract / README 里明说。

- **[β-I4]** 块 3 `:51-53`「门不停时的判定」列的两条已知路径，在当前引擎上**都不可达**：`user_config.pause` 需要非空 `userConfig`（CLI 硬传 `{}`，见 α-W3），`default_behavior` 被 `getDefaultBehaviorForPolicy` 完全遮蔽（见 α-W1），且改它还会被禁改集乙拒掉。方向仍是 fail-closed（「一律记未接受」），但那一节描述的触发条件与实况不符，口径应与 α-W1 / α-W3 的修订同步。

- **[β-I5]** `orchestrator.mjs:221-224` `getGateBehavior` 对未知 gate 返回 `{ behavior:'on_failure', source:'default', severity:'non_critical', isHardGate:false }`——方向偏松（未知 ⇒ 非硬门禁）。当前不可达：`mergeOrchestrationConfigs:91-120` 的 `allGateIds` 取 base ∪ overrides 且只对 base 里存在的 gate 落盘，overrides 删不掉 base 的 gate。记录以备将来合并语义变化。

- **[β-I6]** `orchestrator.mjs:143` 的 `behavior = gateDef.default_behavior || 'on_failure'` 用 `||` 而非 `??`——空串会被吃成 `on_failure`。zod enum 挡住了这条路；缺 zod 时 base 未经校验，理论可达，但 base 是插件自带文件。仅记录。

## 已确认 fail-loud 的路径

逐条点名，均有实测或代码逐字依据。

1. **base 配置缺席 / YAML 语法损坏 / 过不了 zod**（B1 / B2 / B3）——`effective-orchestration --format json` 的 `diagnostics` 带 `error:orchestration.base-invalid`，FR-068 判据 2 触发 ⇒ `BLOCKED`；FR-053 `status=fail` 8/12。**封住**（唯一闸门是判据 2，见 β-W3）。
2. **缺 zod + base 同时损坏**（B5）——`effective-orchestration` `exit=1` 且 stdout 非 JSON ⇒ 判据 3 触发 `BLOCKED`；FR-053 走 `validate-gate-mounting.mjs:223-238` 的 catch，`status=fail`、`errors=["门挂载守护项内部错误（判不出⇒判失败，不放行）：CLI 失败 exit=1"]`。**封住**，catch 分支实测确实不返回 pass。
3. **缺 zod 单独发生**（B4）——`diagnostics=["warning:orchestration.zod-unavailable"]`，`mergedConfig = rawBase`，项目级 overrides 整份不应用，FR-053 12/12 pass。方向安全（无未经校验的用户输入生效），与 α 第 7 组结论一致。
4. **`agent-tools` 族的全部「取不到」分支**——`readTextOrNull` ENOENT ⇒ `null` ⇒ (i) 六条与 (ii) 与 (iii) 全判 fail（`agent-tools-core.mjs:127-133` / `:148-152` / `:170-174`）；非 ENOENT I/O 错误 `throw` ⇒ 族 catch ⇒ `status:'fail'` + 一条 error（`:219-234`）。**方向正确**（唯一例外是 (ii) 对**空数组**的处置，那是 β-C1）。
5. **frontmatter 重复 `tools:` 键**——`namespace-consistency-core.mjs:41-48` `throw`，`:157-171` 就地记 `fail` + `continue`，其余 agent 的结论完整保留、整条 `repo:check` 不吐栈。α-W2 的收口落地正确。
6. **resolver 的全部 overrides 降级路径**——loader-error / parse-error / version-mismatch / schema-fallback / 禁改集命中 / merged-schema 失败 / gate-mounting-lost，七条**全部以回退 base 终止**（`orchestration-resolver.mjs` 的 `returnBase()` 与 `:646-653`），无一条会让未经校验或已被拒的 overrides 生效。方向一致，无例外。
7. **`get-gate-behavior` / `effective-orchestration` 的失败面**——`fail()`（`orchestrator-cli.mjs:37-40`）把 JSON 写 **stderr** 并 `exit(1)`，stdout 为空 ⇒ 守卫判据 3「输出不是可解析 JSON」触发。`$( )` 丢弃退出码这件事因此不构成漏洞（空串同样不可解析）。
8. **FR-068 判据 3 对「JSON 缺字段」的覆盖**——散文 `:26` 明写「`mounted_in_base` 判不出时一律按 `true` 代入，绝不按 `false`：按 `false` 会让蕴含式空洞成立、等价 fail-open」。这正是「装了旧版插件、CLI 不输出这两个字段」这一最可能的现实触发形态的正确处置，**写对了**（残余：该情形没被举为例子，执行者未必想到要查键是否存在）。
9. **两个新族在 catch 路径上的 check id 稳定性**——`agent-tools:required` 与 `gate-mounting:effective-config` 在正常与异常两条路上同名，故族内部报错不会让 K14 的 `added` 数组变形（对照 β-W5 的 `agent-docs` 族）。
10. **K14 的 (b)(c) 两条**（`spec-drift-repo-check-regression.test.ts:81-94`）——基线 id 必须仍在当次输出中 + `duplicated` 必须为空，合起来封死「复用基线 id 让新 check 零新增」。α 第 8 组已证，复核一致。
11. **`validate-gate-mounting` 的 bootstrap 失败面**——`defaultRunCli` 用 `execFileSync` + `JSON.parse`，CLI 非零退出即抛，落到 `:223-238` 的 catch 判 fail。`stdio: ['ignore','pipe','pipe']` 使 stderr 不污染 stdout；`silentLogger`（`orchestrator-cli.mjs:26-31`）把 warn/error 全导向 stderr。**封住**。

## 结论

- **CRITICAL 2 条**：β-C1（frontmatter 解析器的三种「读不全」让 verify 工具面护栏空洞成立）、β-C2（强制 mode 射程从被守护配置自身派生，删一个 mode ⇒ 两道守护同时静默）
- **WARNING 6 条**：β-W1 ~ β-W6
- **INFO 6 条**：β-I1 ~ β-I6
- **已确认 fail-loud 11 条路径**

**最重要的一条发现**：本次两个新守护族在「读不到 ⇒ 判失败」这条纪律上做得很扎实（catch 分支、`null` 分支、`!Array.isArray` 分支逐条实测方向正确），但**它们的射程本身没有下界**——`verify:no-added-tools` 的射程是「解析器**看得见**的那几项工具」，`gate-mounting` 的射程是「配置里**还在**的那几个强制 mode」。两处都把「要检查多少」交给了「被检查的那份数据」去决定，于是数据一残缺，检查量跟着缩到零，而结论仍然是 `pass`。FR-045 只规定了「事实取不到时判 fail」，没有规定「**该检查的条目自己消失**时判 fail」——这是同一条纪律的另一半，本次没有落。

**是否可进入提交（审查员意见）**：**建议 β-C1 与 β-C2 在本 Phase 内收口后再提交**，两条的修补都很小（β-C1：解析器区分「读不出」与「读出空表」+ 遇不可归类行 `throw`；β-C2：强制 mode 清单钉死下界 + 加一条条数断言 + 补「减」方向单测），不涉及架构改动，且都直接落在本卡已经建立的「判不出⇒判失败」框架内——把它留到后续 Phase 会让本卡的验收文本出现「verify 写面已被护栏冻结」「强制 mode 的挂载已被事后守护绝对锚定」两句 over-claim。
β-W2（`SD_MODE` 无守护）建议一并加那一条窄断言，成本一条、覆盖 15 份副本。
β-W1 / β-W5 / β-W6 属可另立卡；β-W3 / β-W4 主要是**口径修订**（守卫散文残余 2 的覆盖面表述、`validate-gate-mounting.mjs:97` 的注释），必须改，因为它们目前把没成立的性质写成了已成立。

