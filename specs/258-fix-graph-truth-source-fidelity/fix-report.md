# 问题修复报告 — F258 图事实源三处失真收口

> 基线 `19bff52a`（= origin/master）；worktree `funny-driscoll-fc77bb`；分支 `claude/f258-graph-fact-source-fixes-6b4e20`。
> 诊断阶段由编排器亲自执行（SKILL 静态声明的 inline 范围）。

## 问题描述

同批 7 维对抗审查确认的三处图可信度缺陷，共病：**"事实源"在某条路径上被悄悄换成了别的东西，且失败方向都是静默**。

1. `src/utils/file-scanner.ts:208-243` — F255 的 git 忽略清单预取用 `--others` 语义（"盘上存在且未跟踪"），而非"规则是否命中"，导致对不在盘上的路径一律判 not-ignored，与 `git check-ignore` 分叉。
2. `plugins/spec-driver/scripts/graph-consumption-cli.mjs:122-125` — `runGit` 把 git 非零退出吞成空串，base-ref 不可达时静默翻成 skip-impact，且 `baseRefMissing` 仍报 false。
3. `plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs:367` + `graph-consumption-cli.mjs:318-327` — 覆盖面判定只做 `toLowerCase`，丢弃 fingerprint 的 `matchSemantics`，`.PY`/`.PYI` 被误判 in-graph-scope。

---

## 缺陷 1 — gitignore 判定退化（主，行为回退）

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何图质量门 `ignoredPathNodeIds` 维度抓不到残留的 ignored 节点？ | `createIgnoreOracle` 对这些节点路径返回 false |
| Why 2 | 为何返回 false？ | 其内部 `createGitignoreFilter` 走 `createGitIgnoredLookup`，查的是预取清单，清单里没有该路径 |
| Why 3 | 为何清单里没有？ | 清单来自 `git ls-files --others --ignored --exclude-standard --directory`，`--others` 只枚举**当前磁盘上存在**的未跟踪条目；该节点对应文件已不在盘上 |
| Why 4 | 为何选了这个存在性相关的命令？ | F255 要解决的是"嵌套 `.gitignore` + tracked 豁免与 `git status` 同源"，而 walk 场景只查已存在的 dirent——在**采集器**这一个消费方上，存在性前提恰好成立，于是该前提被隐式当成了全局前提 |
| Why 5 | 为何没被现有机制捕获？ | ① F255 的测试全部先在盘上创建文件再断言，存在性前提被测试自身满足，无红用例；② 另一消费方 `ignore-oracle → legacy-ignored-check` 的输入是**图节点路径**（可离盘），该消费方与新前提的冲突无人复核 |

**Root Cause**：把"某个消费方（walk）恰好成立的存在性前提"当成了 oracle 的全局契约——预取清单回答的是"盘上有哪些被忽略的未跟踪条目"，而调用方问的是"规则是否命中这个路径"，两个问题在离盘路径上分叉。

**Root Cause Chain**：图质量门漏报 → oracle 判 not-ignored → 预取清单 MISS → `--others` 只枚举在盘条目 → walk 消费方的存在性前提被泛化为全局契约 → 测试与新消费方均未覆盖离盘形态。

### 实证复现（临时 git 仓）

git 本体口径（`.gitignore` = `legacy/` + `*.gen.ts`，文件均不在盘上）：

```
legacy/old.ts => IGNORED        # git check-ignore -q
foo.gen.ts    => IGNORED
git ls-files --others --ignored --exclude-standard --directory  → 空输出
```

经 `dist/utils/file-scanner.js::createGitignoreFilter` 实跑：

| 路径 | 文件不在盘上 | `touch` 之后 | `git check-ignore` |
|------|-------------|-------------|-------------------|
| `legacy/old.ts` | **false** ❌ | true | IGNORED |
| `foo.gen.ts` | **false** ❌ | true | IGNORED |
| `src/a.ts`（tracked） | false ✅ | false ✅ | 豁免 |

与文件头声称的"以 git 本体为事实源"直接冲突；相对 F255 之前的 `parseGitignore`（纯规则匹配、存在性无关）是**行为回退**。

### 关键实证：修法可行性（决定性实验）

对"bare `git check-ignore` 能否同时满足两个约束"做了直接实验：

| 场景 | `git check-ignore -q` | 要求 |
|------|----------------------|------|
| 未跟踪 + 离盘 + 规则命中（`legacy/ghost.ts`） | **IGNORED** | ✅ 规则匹配语义（存在性无关） |
| tracked + 规则命中（`legacy/tracked.ts`、`keep.gen.ts`） | **豁免** | ✅ tracked 豁免，与 `git status` 同源 |
| tracked + 已从工作树删除 | **豁免**（仍在 index） | ✅ 不因删除而翻转 |

结论：`git check-ignore` **单独**即同时满足 F255 的两个约束。F255 当初不用它的唯一理由是性能（walk 逐路径起子进程不可接受）——不是语义。

### 影响范围扫描

> ⚠️ **本表的"是否受影响"列已被对抗审查证伪并在下方「对抗审查修订」节更正**——walk 消费方的存在性前提在嵌套 git 仓 / submodule 场景下不成立。此处保留原表以便对照。

`createGitignoreFilter` 直接消费方 4 个 + `createIgnoreOracle` 消费方 2 个（Spectra impact：directCallers=4 / transitive=9 / riskTier=medium）：

| 消费方 | 查询路径来源 | 是否受影响 | 分类 |
|--------|-------------|-----------|------|
| `src/utils/file-scanner.ts::scanFiles`（walkDir） | 已存在的 dirent | 否（存在性前提成立） | 安全 |
| `src/adapters/python-adapter.ts:163` | 自写 walk 的在盘条目 | 否 | 安全 |
| `src/batch/stages/source-discovery.ts:267,425` | 自写 walk 的在盘条目 | 否 | 安全 |
| `src/batch/generic-language-skeleton-collector.ts:121`（经 oracle） | 自写 walk 的在盘条目 | 否 | 安全 |
| **`src/cli/commands/graph-quality.ts:295`（经 oracle → `legacy-ignored-check`）** | **图节点 id 的 filePart（可离盘）** | **是** | **同源** |

即：**唯一**真正被击穿的消费方是图质量门。这也界定了离盘回退路径的调用频次上界——健康仓库里离盘节点是异常项（少数）。

### 同步更新清单

- 调用方：无签名变更（若采用方案 A）；`legacy-ignored-check` 的 `isIgnored` 回调保持同步谓词契约
- 测试：`tests/unit/file-scanner.test.ts`（F255 既有 git 事实源族需保持全绿 + 新增离盘红用例）、`src/panoramic/graph/quality/ignore-oracle.test.ts`
- 文档：`file-scanner.ts` 文件头与 `createGitignoreFilter` 的契约注释需如实重写（当前注释声称"以 git 本体为事实源"，与实现不符）

---

## 缺陷 2 — git 吞错静默降级（次，本仓属常规路径）

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何 base-ref 不可达时会用陈旧图？ | 决策收口成 skip-impact，不触发刷新 |
| Why 2 | 为何收口成 skip-impact？ | `changeClass` 判成 `additive-only`（或由工作树独自决定），未走保守的 `unknown` |
| Why 3 | 为何没判 `unknown`？ | `classifyChangeSet` 收到的 `nameStatusText` 是空串；`parseNameStatus('')` 返回 `{ok:true, entries:[]}`，**不置 `unrecognized`** |
| Why 4 | 为何是空串？ | `runGit` 的 `result.status === 0 ? stdout : ''` 把 exit=128 吞成空串（实测 `git diff --name-status -z <不可解析 ref>..` 退出码 128） |
| Why 5 | 为何未被捕获？ | "命令失败"与"结果为空"在 `runGit` 的返回类型里被压成同一个值——类型层就把两种状态抹平了，下游再也无从区分；且 `baseRefMissing` 只判 `baseRef === null`（参数缺省），不判"给了但解析不了" |

**Root Cause**：`runGit` 的返回契约（`string`）不能表达失败，把"没跑成"和"跑成了但为空"压成同一值；观测字段 `baseRefMissing` 又只覆盖参数缺省一种缺锚形态，于是失败被抹平后还主动声称锚点正常。

**Root Cause Chain**：陈旧图被消费 → skip-impact → changeClass 非 unknown → 空 nameStatus 不置 unrecognized → runGit 吞掉 exit=128 → 返回类型无失败通道 + `baseRefMissing` 语义过窄。

### 实证

- `git diff --name-status -z deadbeef…..` → **exit=128**（临时仓实测）
- `classifyChangeSet({nameStatusText:'', porcelainText:…})`：读码确认 `splitNulFields('') → []` → `parseNameStatus` 返回 `ok:true, entries:[]` → `unrecognized` 保持 false → `changeClass` 完全由 porcelain 决定
- `graph-consumption-cli.mjs:637` `baseRefMissing: baseRef === null` → 传了不可达 sha 时报 **false**

### 触发常规性（非边缘）

本仓 `CLAUDE.md` 强制 `git rebase master` 交付；base-ref 取自 trace.md 的 `phase_start_ref` sha——**rebase 改写历史正会让该 sha 不可达**。属常规路径。

### 同步更新清单

- `runGit` 三处调用点（:122-125 定义，:469 / :637 语义相关）
- `git-change-classifier.mjs`：需要一条"输入不可信"的显式入口（不能靠空串推断）
- 观测字段：`baseRefMissing` 语义需扩展或新增 `baseRefUnresolvable`，如实反映"给了锚点但解析不了"
- 测试：`tests/`（plugins 侧 `.mjs` 测试族，`npm run test:plugins`）

---

## 缺陷 3 — 消费侧口径丢失

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何 `.PY` 被判 in-graph-scope？ | `collectCoverageScope` / `extensionOf` 把扩展名 `toLowerCase()` 后与面内扩展名比较，`.PY → .py` 命中 |
| Why 2 | 为何 `.py` 命中就算 in-scope 是错的？ | `PY_WALK_SURFACE` 的 `matchSemantics` 是 `case-sensitive`（`walkPyFiles` 用 `endsWith('.py')`），`foo.PY` **根本不入图** |
| Why 3 | 为何丢了 `matchSemantics`？ | 消费侧把 fingerprint 的 `extensionSurface` 摊平成扁平扩展名数组（`deriveScopeExtensionsFromFingerprint` 只取 `entry.extensions` 并集），逐管线的匹配语义在摊平时被丢弃 |
| Why 4 | 为何摊平？ | 判据函数的入参契约设计成 `string[]`，扁平数组表达不了"逐管线不同语义"——与 F252 在 TS 侧废除 `getDirtySourceExtensions(): Set<string>` 扁平契约时踩的是**同一个坑**，只是这次发生在 `.mjs` 消费侧 |
| Why 5 | 为何未被捕获？ | F252 的 W-004 禁令（"调用方 MUST NOT 各自实现扩展名提取"）写在 TS 侧 `collector-surface.ts:170-177`，`plugins/spec-driver/scripts` 是零 dist 依赖的 `.mjs`、无法 import，禁令对它没有机械约束力，只能靠人读 |

**Root Cause**：跨语言边界（TS SSoT ↔ 零依赖 `.mjs` 消费侧）复制数据时只复制了"扩展名集合"这一维，丢掉了同等重要的"匹配语义"维；扁平 `string[]` 契约从类型上就无法承载它。

**Root Cause Chain**：`.PY` 误判 in-scope → 扁平扩展名数组 + `toLowerCase` 比较 → `matchSemantics` 在摊平时丢弃 → 判据入参契约是扁平数组 → W-004 禁令跨不过 TS/.mjs 边界。

### 实证

- fingerprint schema **确实携带** `matchSemantics`（`src/panoramic/graph/collector-fingerprint.ts:35 / :148 / :163`，且属 `FINGERPRINT_ENTRY_KEYS` 严格 key 集合）→ 消费侧有真实事实源可用，无需 import TS
- `PY_WALK_SURFACE = { extensions: {'.py','.pyi'}, matchSemantics: 'case-sensitive' }`（`src/collector-surface.ts:70-73`）
- `graph-consumption-decision.mjs:367` `extensionOf`、`graph-consumption-cli.mjs:318-327` `collectCoverageScope` 均以 `.toLowerCase()` 收口
- 静态 fallback `GRAPH_SCOPE_EXTENSIONS`（decision.mjs:70）同样是扁平小写数组 → **两条路径（graph-fingerprint / static-fallback）都失真**，修法必须同时覆盖
- 本仓当前 `specs/_meta/graph.json` 无 `fingerprint` 字段（走 static-fallback），故本仓实跑走的正是 fallback 那条失真路径

### 同步更新清单

- `deriveScopeExtensionsFromFingerprint`：返回值需保留逐管线 `matchSemantics`（不能再是 `string[]`）
- `GRAPH_SCOPE_EXTENSIONS` 静态 fallback：同步升级为带语义的结构
- `collectCoverageScope`、`extensionOf`、`annotateImpactCaveat`（第四参默认值）三处消费点
- `FINGERPRINT_SURFACE_KEYS` / `SUPPORTED_FINGERPRINT_FORMAT_VERSION` 手写副本的合同测试 `tests/unit/graph-scope-extensions-contract.test.ts`

---

## 附带项裁决

| 项 | 核实结论 | 裁决 |
|----|---------|------|
| `file-scanner.ts:281` 降级 warn 探针 | **确认真实**。`scanFiles` 里 `projectRoot = options?.projectRoot ?? resolvedDir`；未显式传 `projectRoot` 且扫描子目录时，探针查的是 `<子目录>/.git`，结构性不存在 → git 仓内的降级被静默 | **纳入**（同文件、修缺陷 1 时顺带收口） |
| `graph-consumption-cli.mjs:462-466` `--refresh-deadline-ms` | **确认真实**。`parseFlags`（:67-82）对"下一个 token 以 `--` 开头或缺省"置 `true`；`Number(true)=1`，`Number.isFinite(1) && 1>0` 通过校验 → 重建预算被压成 1ms | **纳入**（info 级小修） |
| `source-commit.ts:69` 忽略规则不在任一新鲜度维度 | **确认真实**。`isDirtyJudgedSourceFile` 只认源码采集面；`.gitignore` 对 case-sensitive 面 `endsWith` 不命中、对 case-insensitive 面 `path.extname('.gitignore')===''` 不命中 → 未提交的 `.gitignore` 改动不翻 dirty，sourceCommit 是 HEAD sha 也不含它 | **登记 defer**（理由见下） |

**defer 理由（诚实记账）**：把"忽略规则内容"纳入新鲜度需要在 `collector-fingerprint` 增加一个新维度 → 必须 bump `formatVersion` → 触发 `plugins/spec-driver/scripts` 侧第三处手写副本 `SUPPORTED_FINGERPRINT_FORMAT_VERSION` 与严格 key 集合的连锁修改，并需重新校准 F249 指纹 / F193 加载期 stale / F217 六指标三方判据的一致性（本 fix 的回归护栏明确要求"不得一个说 fresh 一个说 stale"）。这是 feature 量级的合同演进，塞进本 fix 会把三处收口的验证面放大到不可控。**本轮不改，登记为独立候选**。

---

## 修复策略

### 缺陷 1

**方案 A（推荐）— 分层 oracle：在盘走预取（不变），离盘走权威 `git check-ignore`**

判定顺序：① 预取清单命中 → true；② 路径在盘 → false（预取对在盘路径是完备的：不在清单里意味着要么 tracked 豁免、要么规则未命中，两者都该是 false）；③ 离盘 → 记忆化的 `git check-ignore -q --` 权威查询。

- 完整保留 F255 语义与性能：walk 热路径（唯一高频消费方）**一次子进程都不多付**，行为逐字节不变 → F255 的嵌套 `.gitignore` 用例天然仍绿
- 离盘路径由实验证明的权威口径回答，同时拿到规则匹配语义与 tracked 豁免（含 tracked-but-deleted）
- 子进程开销只落在唯一会问离盘路径的消费方（图质量门），且离盘节点本就是该门要抓的异常项
- 风险：极端陈旧的图可能有大量离盘节点 → 需要记忆化，必要时补一个批量 pre-warm（`git check-ignore -z --stdin` 一次问完）作为有界兜底

**方案 B（备选）— 全面改用批量 `check-ignore --stdin`**

把 `isIgnored` 从同步谓词改为"先批量解析、再查表"。语义最干净，但要求所有消费方在 walk 之前就知道全部候选路径——与四个自写 walk 的增量发现形态冲突，需改动全部调用方签名。**不推荐**：改动面远超缺陷本身。

**fail-loud 约束（两方案共用）**：`git check-ignore` 自身执行失败（git 不可用 / 仓库损坏）时**不得**静默返回 false；需按 F255 已有的降级出声约定显式 warn，并把非 git 上下文 / git 不可用 / worktree 三种场景的行为显式定义并测试。

### 缺陷 2

`runGit` 返回结构化结果（`{ok, stdout, status}`），失败不再伪装成空串。base-ref 解析失败时：`classifyChangeSet` 走 `unrecognized` → `unknown` → 保守刷图（FR-003 矩阵行 7 的既有安全方向），并让观测字段如实反映"锚点给了但不可达"。**取"退到 unknown 保守刷图"而非"显式报错"**：前者是既有矩阵已定义的安全方向，不新增失败模式，且符合"降级要保守"的护栏。

### 缺陷 3

消费侧改为承载 `{extensions, matchSemantics}` 的逐管线结构，并在 `.mjs` 侧实现与 `surfaceMatchesFile` **同解**的判定（零 dist 依赖硬约束下无法直接 import TS，需以合同测试锚定两侧同解，与既有 `FINGERPRINT_SURFACE_KEYS` 手写副本的守护方式一致）。static fallback 一并升级为带语义结构。

---

## Spec 影响

需要更新的 spec：**待 plan 阶段确认**。初判 `specs/products/spectra/current-spec.md` 与 `specs/products/spec-driver/current-spec.md` 若记载了 gitignore 事实源口径或 coverage scope 判据，需同步；`src.spec.md` 按工程约定排除、不提交。

---

## 对抗审查修订（Phase 1，异构档位：2 个独立子代理 × 2 切入角；Codex 审查暂停）

两个切入角（"静默降级面" / "与 git 本体分叉的构造"）各自打穿了本报告的结论。**以下四条均已由编排器亲自重跑复核**，不是照单全收子代理结论。

### R1【CRITICAL】缺陷 2 的修复策略是错的 — `unknown` **不**保守刷图

原策略写"`unrecognized` → `unknown` → 保守刷图（FR-003 矩阵行 7）"。**假**。

主线程复核 `graph-consumption-decision.mjs:235-241`：`changeClass === 'unknown'` 分支返回 `outcome: 'consume-degraded'`，且**排在 `freshness === 'stale'`（行 8）之前**短路。而 `graph-consumption-cli.mjs:547` 只在 `refresh-then-consume` 时才 `executeRefresh`。

后果比原缺陷更坏：本仓 rebase 是常规路径 → 每个 phase 稳定收口到行 7 → impact 永不注入，且 `graph-stale-refresh-declined` / `graph-dirty-uncommitted` 等真实信号被行 7 抢先短路、**从此永远观测不到**。这是修复**引入**的静默降级。

**修订**：任务卡验收给的两个选项里，"退到 unknown 保守刷图"经实证**不可用**（unknown 根本不刷图）。故取第二个选项——**base-ref 不可解析时显式报错**（权威合同下非零退出），不与"变更类别真判不出来"共用出口/降级码；观测字段 `baseRefMissing` 之外另加如实反映"给了锚点但不可达"的字段。

### R2【CRITICAL】方案 A 层 ②「在盘 ⇒ false」不成立 — 嵌套 git 仓 / submodule

主线程复核（临时仓 `d4`：仓内含未注册的嵌套 git 仓 `subrepo/`，根 `.gitignore` 有 `*.gen.ts`）：

```
prefetch list                       → （空，git 不枚举进嵌套仓）
git check-ignore -q subrepo/a.gen.ts → IGNORED
文件在盘                             → yes
当前 createGitignoreFilter           → false   ❌ 与 git 分叉
```

即"不在预取清单里"的第三种可能是 **git 根本不枚举它**，不止"tracked 豁免"与"规则未命中"两种。正式 submodule 更严重：`check-ignore` 直接 exit 128 拒答。

**修订**：① 层 ② 的契约不得写成"在盘 ⇒ false"；② 采集面**此刻**就在漏（自写 walk 会下钻嵌套仓收走 git 认为 ignored 的文件）——这不是本 fix 引入的，但**不得**在文档里声称"唯一被击穿的是图质量门"。

### R3【CRITICAL】层 ① 的 `dirPrefixes` 过度近似 — 恰好打在离盘形态上

主线程复核（临时仓 `d3`：`.gitignore` 仅 `*.log`，`generated/` 本身无任何规则命中）：

```
t0（generated/notes.ts 在盘）→ 清单: generated/debug.log
t1（notes.ts 被删除）        → 清单: generated/  ← 折叠成 dirPrefix
git check-ignore generated/notes.ts → NOT-IGNORED
分层 oracle（离盘先过层 ①，命中即 return true）→ true   ❌ 反向分叉
```

`--directory` 会把"无规则命中、只是未跟踪内容恰好全被忽略"的目录折叠成 `dir/`。离盘路径先过层 ①、命中即返回，**永远到不了层 ③**，于是把不该忽略的节点判成 ignored → 从质量门视野里静默剔除。方向与缺陷 1 相反，但同属事实源失真。

（收窄记账：含 tracked 文件的目录不会被折叠；本仓当前 5 个折叠目录 over-collapse 数为 0——是数据依赖的定时炸弹，非当前活缺陷。）

**修订**：层 ① 的 dirPrefix 只能用于**有规则命中**的目录；离盘查询不得无条件信任折叠前缀。

### R4【CRITICAL】层 ③ 的 `git check-ignore` **不是全域权威** — 存在真实第三态

主线程在**本仓**复核（`_reference` 是指向主仓的 symlink，被 `.gitignore` 命中）：

```
git check-ignore -q -- _reference/ghost.ts
  致命错误：路径规格 '_reference/ghost.ts' 位于符号链接之后
  exit=128
createIgnoreOracle(cwd)('_reference/ghost.ts')      → false   ❌ 今天就判错
createIgnoreOracle(cwd)('node_modules/zod/index.js') → true    （靠硬编码目录集合兜住，与 git 无关）
```

路径级 exit 128 至少 5 个来源：symlink 穿越、submodule 内、仓外绝对路径、`..` 越界、空串。两条路都坏——fail-open 则缺陷 1 原样复活；无差别 fail-loud 则本仓每个 `_reference/**` 节点刷一条 warn。

**修订**：oracle 内部必须建模成**三态**（ignored / not-ignored / **undeterminable**），由消费方决定保守方向，不得压成 boolean。原报告"离盘由实验证明的权威口径回答"这句 over-claim 必须撤下。

### R5【WARNING】缺陷 3 的两个静默还原点

- `deriveScopeExtensionsFromFingerprint` 的严格 key 校验只作用于 `extensionSurface` 顶层 5 个管线 key，**不校 entry 内部**；指纹 entry 缺 `matchSemantics` 或取值不在枚举内时行为未定义。
- TS 侧 `surfaceMatchesFile` 是 `if (case-sensitive) … else` 的 else-fallthrough。`.mjs` 若"同解照镜"会继承该兜底 → 畸形/未来第三种语义**静默按 case-insensitive 处理**，正是本次要修的 `.PY` bug 原样复活。合同测试能锚"两侧同解"，锚不住"两侧同错"。

**修订**：`.mjs` 侧对未知/缺失语义 `return null` 整体落回 static-fallback，并让 `scopeExtensionsSource` 出现可区分取值。

### R6【WARNING】defer 裁决仍成立，但记账不完整

缺陷 1 修完后，离盘路径的答案变成实时忽略规则的函数 → `graph-quality` 的 `ignoredPathNodeIds` 维度对"未提交的忽略规则改动"变敏感，而 freshness 三维都不记录这一输入 → 同一份图 freshness 报 fresh、gate 结论却可在两次运行间翻转。属**量的扩大而非质的新增**（在盘路径本来就每次现读预取清单），故 defer 的技术理由仍成立，但必须补记这一笔并写进已知限制。

### 经复核**站得住**的部分

- 缺陷 1 的 5-Why、实证复现表、以及"`git check-ignore` 单独即同时满足 F255 两约束（规则匹配语义 + tracked 豁免含 tracked-but-deleted）"的决定性实验——两个审查者独立重跑，结果逐字一致。
- 缺陷 1 的消费方清单完整无遗漏（错的是"是否受影响"列，不是清单）。
- 缺陷 2 的 `exit=128` 与 `classifyChangeSet` 空串不置 `unrecognized`——重跑一致。
- 缺陷 3 的三条事实（fingerprint 携带 `matchSemantics`、两处 `toLowerCase`、本仓图无 fingerprint 走 fallback）——核对为真。
- 两条附带项（`Number(true)=1`、降级探针基准错位）——独立复核为真。
- 未找到反例的方向（均实跑）：否定模式、嵌套 `.gitignore`（**F255 原病未回退**）、`.git/info/exclude`、全局 excludesFile、git worktree、`assume-unchanged`/`skip-worktree`、路径特殊字符、`core.ignorecase`、`walkBase=子目录`。`check-ignore` 性能 ~5.7ms/次，记忆化足够。

### 修订后的成立域（写进实现契约，不得再 over-claim）

分层 oracle **方向成立**，但必须显式收窄：
1. 层 ① dirPrefix 仅对**有规则命中**的目录有效
2. 层 ② 只对"在盘 **且 git 确实枚举得到**"的路径成立，否则落权威查询
3. 层 ③ 存在 `undeterminable` 第三态（symlink 穿越 / submodule / 仓外 / 越界 / 空串），必须显式建模
4. 批量 pre-warm（`check-ignore -z --stdin`）**一个坏路径即整批截断**且"缺席 = not ignored"不可区分 → 若采用必须逐路径校验或按 exit≠0 整批作废；否则不采用
5. 文档须指名 oracle 为 `check-ignore`（含 index），撤掉"与 `git status` 同源"的笼统表述（离盘路径上两者系统性不同解）

### 用户裁决（Phase 1 收口，2026-08-06）

| 决策点 | 裁决 |
|--------|------|
| 缺陷 1 修法范围 | **修卡面 + 三态建模 + 登记已知限制**——修好离盘判定；oracle 内部建模 `ignored / not-ignored / undeterminable` 三态并显式定义每种分叉形态的保守方向、用测试钉住实际行为；嵌套 git 仓 / symlink 指向的被忽略目录两类写进已知限制，**不追求与 git 全域一致** |
| 缺陷 2 收口方式 | **base-ref 不可解析时显式报错**（权威合同下非零退出），不与"变更类别真判不出来"共用出口与降级码；另加如实观测字段 |

## 范围检测

受影响源文件 6 个（`file-scanner.ts`、`ignore-oracle.ts`、`graph-consumption-cli.mjs`、`graph-consumption-decision.mjs`、`git-change-classifier.mjs`、`source-commit.ts` 仅 defer 记账）+ 测试若干，跨 2 个模块（`src/` 采集/质量面、`plugins/spec-driver/scripts` 消费面）。**未触发范围过大阈值**（>10 文件或 >3 模块），继续 fix 模式。

---

## 验证结果

> 本节由**审查修复轮**补记（M-8 / T074 / T075 / T077）。fix 模式下 fix-report 是交付事实源，
> 此前它缺一整节"到底验没验、结果是什么"——那正是审查抓到的制品缺口。

### 五道门禁（审查修复轮收口后的最终数字）

| 命令 | 结果 |
|---|---|
| `npm run build` | exit 0（tsc 零错误） |
| `npx vitest run` | `Test Files 523 passed \| 4 skipped (527)` / `Tests 7154 passed \| 18 skipped \| 21 todo (7193)` |
| `npm run test:plugins` | `ℹ tests 1528 / ℹ pass 1528 / ℹ fail 0` |
| `npm run repo:check` | exit 0，87 项 pass（含 `graph-quality:ignore-undeterminable`） |
| `npm run release:check` | exit 0（`Release contract valid (contracts/release-contract.yaml)`） |

相对基线 `19bff52a` 净增用例：vitest **+16**（7138 → 7154）、plugins **+1**（1527 → 1528）。

### 本仓实证复跑（T070，零信息量回归护栏，**不是**缺陷 1 的验收证据）

```
$ node dist/cli/index.js batch --mode graph-only
  节点: 7539 | 边: 12683 (calls 3829, depends-on 2608) | Python 符号: 16 | 耗时: 5.1s   → exit 0

$ node dist/cli/index.js graph-quality
  Overall Verdict: pass
  [duplicate-canonical-id] pass
  [contains-coverage]      pass (6246/6246, 100.0%)
  [orphan-ratio]           pass (超标 0/6246, 0.0%; 全节点 zero-degree 率 1.5%)
  [dangling-edge]          pass
  [legacy-ignored]         pass
  [freshness]              dirty（工作树有未提交改动，属预期）
  Next steps: 图可能未反映未提交改动…                                                  → exit 0
```

`nextSteps` **无** `[ignore-undeterminable]` 条目 ⇒ 本仓既无不可判路径、三态 oracle 也未降级，
与 plan §12 item 1/2 的测定（本仓 0 离盘 filePart、0 `_reference` 节点）一致。

### 三份审查的结论与处置（审查修复轮）

档位：**Codex 审查暂停（配额耗尽），异构档位缺席**——三份独立审查 = Spec 合规 ① + 代码质量 ②
+ 异构对抗子代理 ×2 ③。本批含门禁 / 判定器类改动，commit message 须显式标注档位缺席。

| 必修项 | 一句话 | 处置 |
|---|---|---|
| **M-1**（CRITICAL） | `git ls-files` 一失败 ⇒ oracle 退成二态 ⇒ `undeterminable` 结构性不产出 ⇒ `count>0` 判据不成立 ⇒ `ignore-undeterminable` check 反而报 **pass**。**打坏 git 就能让门变绿** | 已修：`UndeterminableSummary` 增 `degraded`；两个消费方判据改为 `count>0 \|\| degraded \|\| budgetExhausted`；新增 `[oracle-degraded]` 子 token，core 侧写进结构化 evidence 并报 warn |
| **M-2** | `budgetExhausted` 在 `count===0` 时被两个消费方一起丢弃，具名出口 `l2-budget-exhausted` 完全静默 | 已修：并入 M-1 新判据；budget-only 单独文案；导出两个纯函数直测三形态 |
| **M-3** | L3 消费 `dirPrefixes` 破坏 KL-3，且给出比 `undeterminable` **更错**的 `ignored`（与 git 权威答案反向、静默） | 已修：新增只查 `files` 的 `createGitIgnoredFileLookup`，L3 改用它；KL-3 与"换序安全性"论证同步改写 |
| **M-4** | 在盘的绝对路径 / `..` 越界静默判 not-ignored，与 KL-2 白纸黑字的承诺**相反** | 已修：入口守卫 `isOutsideWalkBase`，判据只看输入契约不看盘。**未**走"改写 KL-2"的备选分支——修法无副作用，能兑现承诺就不该改承诺 |
| **M-5** | `porcelainOk:false` 会把 changeClass 打成 `unknown` ⇒ 行 7 短路不刷图，与 JSDoc 的"只是如实标注"矛盾 | 选 **(a) 改文档保留行为**（理由见下）；两处 JSDoc 改为如实说明后果，并新增用例把后果钉成机器断言 |
| **M-6** | fingerprint 顶层严格、**entry 内未知 key 静默照单全收**（同一失真下沉一层，方向不安全） | 已修：entry 也做 key 集合精确等值；新增 `FINGERPRINT_ENTRY_KEYS` 与第四处跨语言合同锚 |
| **M-7** | `file-scanner.ts:3` 的 over-claim（"以 git 本体为事实源"）未撤，与新文件自述互相打脸 | 已修：file-scanner + `python-adapter.ts` + `source-discovery.ts`（两处）+ **额外一处** `collector-fingerprint.ts` 的 bump 记录 |
| **M-8** | 制品未回填 | 已修：本节 + `tasks.md` 勾选态 + `verification/review-round-decisions.md` + `mutation-evidence.md` 的「审查修复轮」段 |

**M-5 选 (a) 的理由**：`porcelainOk:false` 意味着工作树变更集**真的拿不到**，判 `unknown` 是对
事实的正确读法；选 (b)（把 porcelain 排除出 `unrecognized`）会让残缺变更集冒充完整的——
`git diff` 那一路只看得见已提交部分，工作树里的修改型改动被抹掉后整体判 `additive-only` ⇒
**跳过 impact**，那才是不安全方向。逐条决策见 `verification/review-round-decisions.md`。

### 变异测试证据

- P1/P2/P3 十条（M1–M10）+ 审查修复轮六条（MR-1..MR-6），全部逐条记录变红用例、断言输出与
  逐字节撤销复核，见 `verification/mutation-evidence.md`（T073 核对：M1–M10 十条齐全）。
- 未做变异的两条必修项已如实登记原因：**M-5** 是纯文档裁决（无行为变异可注入，改由正向用例钉住）、
  **M-7** 是纯注释改动（无行为面）。

### plan §12「现在不知道」十项落定（T074）

| # | 项 | 落定结论 |
|---|---|---|
| 1 | 本仓修复后新增多少 `ignoredPathNodeIds` | **0**。已由主线程测定（本仓 0 离盘 filePart），T070 实跑复核一致 ⇒ 本仓实跑无判别力，缺陷 1 验收走可控 fixture（T032） |
| 2 | `_reference/**` 类节点是否存在 | **0 个**；`drainUndeterminable().count` 在本仓恒 0（T070 复核一致） |
| 3 | `[CLEANUP]` 是否触发 | **触发**（P1 与 P2 各按两遍法判定，实数见 `p1-decisions.md` / `p2-decisions.md`），产出 `src/utils/gitignore-oracle.ts` 与 `lib/graph-consumption-inputs.mjs` |
| 4 | ref 解析命令的退出码谱 | 未用 plan 预设的那条命令：改用 `git cat-file -e <ref>^{commit}`（RG-006 被禁 token 规避），退出码收口为"非 0 即不可解析"；三种异常形态由 T054 覆盖。已知差异（tree-ish 判拒，方向 fail-closed）登记在代码注释 |
| 5 | `goal-loop-graph-consumption-integration.test.mjs` 的隐式断言 | 已通读（T002）；除 L446/L462 两处 not-provided 形态外无依赖，P3 全量绿复核一致 |
| 6 | `.PY`/`.PYI` 在本仓是否存在 | 未依赖本仓存量：缺陷 3 全部红用例在 fixture 仓构造 |
| 7 | `nextSteps` 机读 token 字面值 | **`[ignore-undeterminable]`**；审查修复轮追加子 token **`[oracle-degraded]`**。两者均由跨侧断言双向钉住 |
| 8 | L2 预算默认值 | **1500 ms**（实测 `git check-ignore` ~5.09 ms/次 ⇒ 约 295 次），显著小于下游 `DEFAULT_FRESHNESS_DEADLINE_MS = 5000` 并留 3.5 s 余量；不引入新环境变量，仅经 `opts` 注入 |
| 9 | §3.8 symlink-to-dir → dirPrefix 改良 | **不纳入**，带证据裁决见 `p1-decisions.md::T025` |
| 10 | 新 check 与 `repo:check` 早退分支是否冲突 | **不冲突**：check 位置定在报告解析成功 + 过了 exit-code 一致性与 cannot-assess 两道早退之后；由"早退分支不误报"用例覆盖 |

### plan §10.3 回归护栏逐条复核（T075，只复核既有结论、不新增测试）

| 护栏 | 复核结论 |
|---|---|
| F255 原病不回退 | ✅ `tests/unit/file-scanner.test.ts` 的 F255 族与 `gitignore-collector-freshness-consistency.test.ts` **未改一行**且全绿（T026） |
| F217 六指标质量门 | ✅ 可控 fixture 逐条判定真/假阳性（T032）；本仓 graph-only 重建后六指标全 pass（T070，零信息量护栏） |
| F193 / F249 / F254 判据输入不变 | ✅ `sourceCommit` / `fingerprint` / `formatVersion` / `BEHAVIOR_VERSION` 本次全部不变（T071/T072 双向差分实证）⇒ 不新增分歧来源。既有分歧来源（graph-quality 超时、KL-4）不受影响，仍然存在（如实表述，未 over-claim） |
| 降级路径 fail-loud | ✅ 且**在审查修复轮被加强**：审查证伪了"全链路无新增静默出口"——L0 整体降级（M-1）与 budget-only（M-2）两条当时确实是静默的，现已各自接上出声通道并由 MR-1/MR-2/MR-6 三条变异守住 |
| 非 git / git 不可用 / worktree | ✅ 三形态各有独立用例（R1-6b / R1-6 / R1-10）；审查修复轮新增"git 仓内预取失败 ⇒ degraded"一态（M-1/M-1b/M-1c 三条互为对照） |
| 每条缺陷先红用例 + 变异证守护力 | ✅ 见 `verification/mutation-evidence.md`（M1–M10 + MR-1..MR-6） |

### 已知限制 / defer 登记

| ID | 内容 | 为什么 defer |
|---|---|---|
| **D-1** | `coverageUnionApplied` 在 `freshness=fresh` × `allowed` 下把 union（重建可达面）当真相面用 ⇒ 图自述面不覆盖的改动拿到全信 `consume-impact`；且 decide / annotate 两侧用不同面 ⇒ caveat 同时静默（P2 对抗 C-1 + W-1） | **不是 F258 引入**（union 分支来自 F254 W-1），收敛它要动决策矩阵语义 ⇒ 独立 fix 卡。⚠️ 本轮**已做**的一件事：把 `graph-consumption-decision.mjs` 的「C-002 依然成立」与 `graph-consumption-cli.mjs` 的「残留风险不会反向」两处 over-claim 改写为如实表述（实证存在第三个方向：该降级却全信） |
| **D-2** | 诊断走 `nextSteps` 文本前缀契约，而非 schema 可选字段（4b W-4） | 设计取舍。本轮新增的 `[oracle-degraded]` **加深**了对文本契约的依赖，如实登记；两个 token 均有跨侧双向断言，但这条链天然比 schema 字段脆弱 |
| **D-3** | 三份审查的 I 级问题 | 全部 defer；本轮只处理编排器分流后的必修清单 |
| **KL-1..KL-6** | 三态 oracle 的六条已知限制 | 逐条登记在 `src/utils/gitignore-oracle.ts` 文件头并各有钉桩测试；KL-2 / KL-3 两条在审查修复轮按实现改写（M-3 / M-4） |
| **RG-006 绕过面** | 门禁扫描 ② 可被同义 git 命令绕过（P3 复审 B-W3） | 门禁自身设计面，非本 fix 造成；已部分缓解（`runGit` 改回模块私有），判据结构化改造建议开独立卡 |
| **`$?` 机械保障缺失** | 全仓 SKILL 无退出码检查，exit 3 的可见性依赖散文被遵守 | plan §4.5 已登记；本轮未扩大范围 |
