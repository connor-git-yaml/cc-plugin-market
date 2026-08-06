---
feature: 258-fix-graph-truth-source-fidelity
mode: fix
based_on: fix-report.md「对抗审查修订」节 + 用户裁决（缺陷 1 = 修卡面 + 三态建模 + 登记已知限制；缺陷 2 = base-ref 不可解析显式报错）+ plan-revision-brief.md（Phase 2 对抗审查裁决 D1~D10，权威）
baseline: 19bff52a
branch: claude/f258-graph-fact-source-fixes-6b4e20
status: draft (revised-after-phase2-adversarial-review)
risk_tier: HIGH
---

# 修复计划：图事实源三处失真收口（F258）

> 本计划**只**基于 fix-report 的**修订后**策略。fix-report §修复策略里"缺陷 2 退到 unknown 保守刷图"
> 与"离盘由权威口径回答（二态）"两条已被 R1 / R4 证伪，**不得**按那两条实施。
>
> 本版为 **Phase 2 对抗审查后的修订版**：`plan-revision-brief.md` 的 D1~D10 为已定裁决，逐条落点见 §14。
> brief 与本 plan 冲突时以 brief 为准。

## 0. 范围与不做什么

### 只改（生产代码 8 个文件）

| # | 文件 | 改动性质 |
|---|------|---------|
| 1 | `src/utils/file-scanner.ts` | 新增三态 gitignore oracle（含 §3.1a errno 三分存在性判定）；`createGitignoreFilter` 降为薄壳；降级探针基准修正 |
| 2 | `src/panoramic/graph/quality/ignore-oracle.ts` | `createIgnoreOracle` 改为返回 `{ isIgnored, drainUndeterminable }`；消费三态并定义保守方向 |
| 3 | `src/cli/commands/graph-quality.ts` | 调用点适配 + 不可判计数的有界暴露（走 `nextSteps` + stderr，不动 JSON schema） |
| 4 | `src/batch/generic-language-skeleton-collector.ts` | 调用点适配（一行） |
| 5 | `scripts/lib/graph-quality-core.mjs` | **新增（D4）**：warn 级 check `ignore-undeterminable`，消费 `nextSteps` 中的不可判条目，使诊断出口在 `repo:check` 上真的有人读 |
| 6 | `plugins/spec-driver/scripts/lib/git-change-classifier.mjs` | 新增"输入不可信"显式入口（required 参数，缺省 throw） |
| 7 | `plugins/spec-driver/scripts/graph-consumption-cli.mjs` | `runGit` 结构化返回；base-ref 预检与硬失败出口；逐管线覆盖面判定；`--refresh-deadline-ms` 校验；畸形指纹 stderr warn |
| 8 | `plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs` | 扁平 `GRAPH_SCOPE_EXTENSIONS` → 逐管线 `GRAPH_SCOPE_SURFACES`；新增与 `surfaceMatchesFile` 同解的匹配器 |

**仅改文件头契约注释（不改代码，D6）**：`src/panoramic/graph/quality/quality-engine.ts`、`src/panoramic/graph/quality/legacy-ignored-check.ts`。

外加 canonical skill 文本 1 处：`plugins/spec-driver/skills/spec-driver-feature/SKILL.md`（4b / goal_loop 步骤 2 / 步骤 3b 三处调用点补退出码处置 + 刷新预算口径 + 恢复口径）。
`plugins/spec-driver/skills-codex/**` 与 `.codex/skills/**` 是 `npm run repo:sync` 的再生产物（`repo-maintenance-core.mjs::runSpecDriverCodexInstall`），**禁止手改**，改完 canonical 后跑 `repo:sync` 再生并由 `repo:check` 复核。

### 明确不改

- **决策矩阵 13 行的求值顺序与出口**（`decideGraphConsumption` 本体零改动）。本次不新增 `DEGRADED_REASONS` 取值（保持 12 值）——base-ref 不可解析**不是一种降级出口**，它在矩阵求值之前就终止。
- `finalizeAfterRefresh` / EC-07（刷新后绝不重跑矩阵）/ FR-010 快照校验。
- `legacy-ignored-check.ts` 的 `checkLegacyAndIgnoredNodes` **签名**（`isIgnored` 仍是同步 boolean 谓词，见 §3.6）。
  ⚠️ **但其文件头与 `quality-engine.ts` 文件头的"零 I/O 纯函数"契约描述必须重写**（D6）——注入的回调修复后会 spawn 子进程且带内部可变状态，旧描述会变成假话，见 §3.9。
- `graph-quality-report.schema.json`（顶层 `additionalProperties: false`，新增字段代价过大；不可判计数走已有的 `nextSteps: string[]`，机读契约与其脆弱性见 §3.5）。
- `collector-fingerprint.ts` 的 `formatVersion` 与 `BEHAVIOR_VERSION`（裁决与**可证伪的实证要求**见 §7）。
- 采集面（walk）四个消费方的调用签名与运行时行为（见 §3.2 的"逐字节不变"论证）。
- `source-commit.ts:69`（忽略规则内容不进新鲜度维度）——**defer**，见 §8。

### 明确不做

- 不做批量 `git check-ignore --stdin` pre-warm（理由：fix-report 修订后成立域 #4 已实证"一个坏路径整批截断"且"缺席 = not ignored"不可区分）。
- 不追求 oracle 与 `git check-ignore` 全域一致（用户裁决 1）：嵌套 git 仓 / submodule、symlink 穿越（离盘与**在盘**两种形态）、大小写/未归一化输入三类登记为**已知限制**（KL-1、KL-2、KL-5、KL-6）并用测试钉住实际行为。
- 不把 `changeClass` 引入第四个取值，不新增 outcome。
- 不为 exit 3 引入机械保障（harness 侧强制检查 `$?`）——超出 fix 范围，作为残余风险登记（§4.5 第 5 条）。

---

## 1. Codebase Reality Check

| 文件 | LOC | 导出/公开面 | 已知 debt |
|------|-----|------------|----------|
| `src/utils/file-scanner.ts` | 503 | `scanFiles` / `createGitignoreFilter` / `ScanOptions` / `ScanResult` / `LanguageFileStat` | 0 个 TODO/FIXME；单文件承载**三件事**（忽略规则解析 + git 预取 + 目录扫描/语言统计）；`globToRegex` + `parseGitignore` 是 F255 之后仅剩非 git 上下文使用的遗留近似解析器 |
| `src/panoramic/graph/quality/ignore-oracle.ts` | 193 | `createIgnoreOracle` / `GRAPH_COLLECTOR_IGNORE_DIRS` | 0 个 TODO；注释密度极高（含 F249 的不可达性论证），改动时必须同步更新契约注释，否则注释即变成假话 |
| `src/panoramic/graph/quality/legacy-ignored-check.ts` | 40 | `checkLegacyAndIgnoredNodes` | 文件头 7-8 行声称"本函数保持零 I/O 纯函数"——本次注入回调的性质变化会使该描述失真（D6） |
| `src/panoramic/graph/quality/quality-engine.ts` | 82 | `runStructuralQualityChecks` 族 | 文件头 9-11 行声称"纯函数，零 I/O：所有需要外部信息的判定均通过 opts 注入的回调完成"——同上（D6）。本次**只**改文件头，不触发 CLEANUP 判定 |
| `scripts/lib/graph-quality-core.mjs` | 281 | repo:check 侧 graph-quality 消费者 | 0 个 TODO；逐字段读 7 个报告字段，**全文无 `nextSteps`**（D4 的缺口所在）。本次新增约 15 行，LOC < 500 ⇒ 不触发 CLEANUP |
| `plugins/spec-driver/scripts/graph-consumption-cli.mjs` | 784 | `main` / `resolvePhaseStartRef` / `finalizeRefreshOutcome` / `AUDIT_SCHEMA_VERSION` / `FINGERPRINT_SURFACE_KEYS` / `SUPPORTED_FINGERPRINT_FORMAT_VERSION` | 0 个 TODO；单文件承载参数解析 + 五维采集 + 审计 + 渲染 + 两个子命令；三处 TS 侧常量的手写副本（靠外部合同测试锚定） |
| `plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs` | 433 | 6 个导出 | 0 个 TODO；**零 import 硬约束**（有静态断言测试守护，见 §5.2） |
| `plugins/spec-driver/scripts/lib/git-change-classifier.mjs` | 155 | `classifyChangeSet` | 0 个 TODO |
| `src/collector-surface.ts`（只读参照，不改） | 239 | 采集面 SSoT | — |

### 前置清理触发判定（**两遍法**，D8）

规则：LOC > 500 且**实测**净增 > 50 行。触发判定**不接受"预计"**，必须可他证：

1. **第一遍（草稿）**：先按 §3 / §4 写出完整改动（不 commit），跑 `git diff --stat <file>` 取**实数**净增行数，把该输出原样贴进任务验收记录。
2. **判定**：实数 > 50 行 ⇒ 触发；≤ 50 行 ⇒ 不触发，跳过搬运，不为凑规则做重构。
3. **第二遍（触发时）**：`git checkout -- <file>` 撤销草稿（**注意：本 fix 的规划阶段禁止任何 git 写操作；该步骤只属 implement 阶段**）→ 先落**纯搬运** commit（零行为变化，搬运后先跑全绿）→ 再在搬运后的结构上重放功能改动。这样 review 能干净地区分"搬运 diff"与"行为 diff"。

候选两处：`src/utils/file-scanner.ts`（503 LOC）与 `graph-consumption-cli.mjs`（784 LOC），均在触发线附近。

搬运边界写死，**不得扩大**：

- `file-scanner.ts` → 新建 `src/utils/gitignore-oracle.ts`，只移动 `parseGitignore` / `globToRegex` / `GitIgnoredIndex` / `readGitIgnoredIndex` / `createGitIgnoredLookup` / `createGitignoreFilter`；`file-scanner.ts` 保留 `export { createGitignoreFilter } from './gitignore-oracle.js'` 以保证 4 个既有 import 点零改动。`scanFiles` 本体一行不动。
- `graph-consumption-cli.mjs` → 新建 `scripts/lib/graph-consumption-inputs.mjs`，只移动 `runGit` / `collectChangeSet` / `collectGraphAvailability` / `deriveScopeSurfacesFromFingerprint` / `collectCoverageScope`。新文件会被 `resolveImportClosure(CLI_PATH)` 自动纳入 RG-006 被审集合（相对 import 静态扫描），同时**必须**追加进 `RG006_MINIMUM_AUDITED_FILES` 下限清单。

---

## 2. Impact Assessment

| 维度 | 结论 |
|------|------|
| 直接修改文件 | 生产代码 8 + 仅改注释 2 + canonical SKILL 1 = 11；`repo:sync` 再生 2 处 |
| 间接受影响（测试/合同） | 12 份：`tests/unit/file-scanner.test.ts`、`src/panoramic/graph/quality/ignore-oracle.test.ts`、`src/panoramic/graph/quality/legacy-ignored-check.test.ts`、`tests/unit/collector-surface.test.ts`、`tests/unit/graph-scope-extensions-contract.test.ts`、`tests/unit/graph-quality-core.test.ts`、`tests/integration/gitignore-collector-freshness-consistency.test.ts`、`plugins/spec-driver/tests/{graph-consumption-cli,graph-consumption-decision,git-change-classifier,goal-loop-graph-consumption-integration}.test.mjs` |
| Spectra impact（`createGitignoreFilter`，upstream depth=3） | directCallers=4 / transitive=10 / riskTier=medium；transitive 触及 `runBatch`、`buildAstGraphOnly`、`runBatchCommand` |
| 跨包影响 | 3 个顶层边界：`src/` + `scripts/`（采集 + 质量面 + repo:check）、`plugins/spec-driver/scripts`（消费面）、`plugins/spec-driver/skills`（agent 协议） |
| 数据迁移 | 无图产物格式变更；有**输出契约**版本变更（`AUDIT_SCHEMA_VERSION` 3 → 4） |
| API / 契约变更 | ① `createIgnoreOracle` 返回类型（函数 → 对象）；② `classifyChangeSet` 入参新增 required 字段（缺省 throw）；③ `decide` 新增退出码 3 与新审计事件 kind；④ `decide` 输出新增 3 个字段、`scopeExtensionsSource` 新增取值；⑤ SKILL 调用方合同（必须检查退出码）；⑥ `nextSteps` 新增**文本前缀机读契约**（跨 TS/`.mjs` 两侧，见 §3.5） |
| **风险等级** | **HIGH**（跨包 = 3 > 2；且修改 agent 协议与 CLI 公共出口契约） |

HIGH ⇒ 强制分阶段，见 §9。

---

## 3. 缺陷 1 设计：分层三态 gitignore oracle

### 3.1 判定顺序与每层的准确契约

判定函数 `verdict(relativePath): 'ignored' | 'not-ignored' | 'undeterminable'`，按下表顺序求值，第一个命中即返回：

| 层 | 条件 | 出口 | **准确契约（不得 over-claim）** |
|---|------|------|------|
| L0 | 预取清单构造失败（非 git 上下文 / git 不可用 / 仓库损坏） | 根 `.gitignore` 近似解析的二态结果 | 与 F255 现状逐字节一致；**永不产出 `undeterminable`**。理由：这是维度收窄的既有 fail-open（根规则仍生效），且非 git 上下文的 freshness 本就在 `resolveSourceCommit` 处短路为 unknown-provenance，不存在错配面。降级 warn 沿用既有一次性 `console.warn`（探针修正见 §6.1） |
| L1 | 存在性探测（§3.1a）判为 **`on-disk`** | 预取清单查表：命中精确条目或落在 `dirPrefixes` 之下 → `ignored`；否则 `not-ignored` | **前提（D9，必须写进代码契约）**：输入路径 MUST 已归一化（`path.relative` 产出形态：无 `./` 前缀、无冗余分隔符、POSIX 分隔符）**且大小写与磁盘一致**。前提不满足时本层查表 MISS 并给 `not-ignored`，与 git（macOS `core.ignorecase=true`）分叉——登记为 **KL-6**。另：嵌套 git 仓 / submodule 内的在盘路径 git 根本不枚举，本层会判 `not-ignored` 而 `check-ignore` 判 IGNORED——登记为 **KL-1**。**不写成无条件的"在盘 ⇒ false"**（R2 + D9） |
| L2 | 存在性探测判为 **`off-disk`** | 记忆化 `git check-ignore -q --  <path>` 的三态结果；预算耗尽时走具名出口（§3.4） | 权威**但非全域**（R4）：路径级 exit 128 是真实第三态，落 `undeterminable` |
| L3 | 存在性探测判为 **`undeterminable`**（非 ENOENT/ENOTDIR 的 errno） | 直接 `undeterminable` | **不得**当离盘、**不得**落 L2（D1）。理由见 §3.1a |

**verdict 的输入契约（补充登记，INFO）**：`generic-language-skeleton-collector.ts:92` 对**目录 dirent** 也调 `isIgnored`，因此 verdict **接受目录相对路径**。L1 对目录条目按预取清单的精确条目/`dirPrefixes` 两种形态命中；L2 的 `check-ignore` 对目录路径同样可答。必须至少有一条目录输入用例钉住该契约（并入 §10.1 的 R1-1 族）。

**存在性依赖是契约的一部分（补充登记，INFO）**：本 oracle 的答案**依赖路径是否在盘**——同一相对路径在盘时走 L1 查表（可能 `not-ignored`），离盘时走 L2 权威查询（可能 `ignored`），**两者可以相反**（KL-1 与 L2 的分歧轴正是"文件在不在"）。这是分层设计的直接后果，属**已声明的契约**，不是 bug；调用方不得假设 verdict 与文件存在性无关。

**为什么 L1 的 `dirPrefixes` 在本顺序下不再踩 R3**：R3 的 over-collapse 要求"该目录下所有未跟踪条目都被忽略"（实测 `generated/notes.ts` 在盘时清单为 `generated/debug.log` 不折叠，删除后才折叠成 `generated/`），且含 tracked 文件的目录也不折叠。因此"被查询路径在盘、且规则未命中"与"其父目录被折叠"**互斥**。离盘路径由于前置的存在性判定直接跳到 L2，**永远不消费 `dirPrefixes`**——这正是 R3 要求的收窄。该论证必须由测试钉住（§10.1 R1-3 复刻 R3 的 `d3` 场景）。

### 3.1a 存在性探测 = errno 三分（D1，硬性）

```ts
type Presence = 'on-disk' | 'off-disk' | 'undeterminable';

function probePresence(absPath: string): Presence {
  try {
    lstatSync(absPath);                     // 成功即在盘（断链 symlink 自身算在盘）
    return 'on-disk';
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'off-disk';
    return 'undeterminable';                // EACCES / ELOOP / ENAMETOOLONG / EPERM / code 缺失 …
  }
}
```

硬性要点：

1. **`lstat` 失败 ≠ 离盘**。只有 `ENOENT` / `ENOTDIR` 才是"确实不在盘"。
2. 其他一切 errno ⇒ **直接 `undeterminable`**（L3 出口），**不得**当离盘、**不得**转 L2。
   - 为什么这条是必须的：EACCES 目录下的文件 walk 能枚举到、`lstat` 却抛错。若把它当离盘 → 落 L2 → 换成**另一个解**的 oracle → **采集面的文件集合可变** → §7 里"`gitignore-interpretation` 责任项未触发、`BEHAVIOR_VERSION` 不 bump"的论证随之失效。
   - 走 L3 出口后，消费方按 `not-ignored` 处理（§3.5）= **与旧行为逐字节一致**，责任项才真的未触发。
3. `undeterminable` 计入 `drainUndeterminable()`（出声、可诊断），不静默。
4. 该分支必须由红用例（R1-7）与变异测试（M9）双向钉住。

### 3.2 walk 热路径逐字节不变的保证

- `createGitignoreFilter(projectRoot, walkBase?)` **保留原签名与 boolean 返回**，实现改为新 oracle 的 `isIgnoredOnDisk`（= L0 分支的近似解析 / L1 分支的纯查表），**不做存在性探测、不起任何子进程**。
- 其 JSDoc 契约改写为显式声明：「输入路径 MUST 来自 walk 的 dirent（恒在盘）且 MUST 已归一化、大小写与磁盘一致；离盘路径 MUST 改用 `createGitignoreOracle().verdict`」。当前注释中"以 git 本体为事实源"的笼统表述与"与 `git status` 同源"一并撤下，改为指名 `git ls-files --others --ignored --directory`（在盘枚举）/ `git check-ignore`（含 index）两个不同 oracle。
- 结论：`scanFiles`、`python-adapter.ts:163`、`source-discovery.ts:267/425` 四个 walk 消费方**零改动、零新增开销**，F255 的嵌套 `.gitignore` 用例天然仍绿。

### 3.3 `git check-ignore` 调用契约（退出码判别，反面先例见 file-scanner.ts:216）

```ts
// 伪代码——implement 阶段按此逐条落地，禁止简化成 catch { return null }
function queryCheckIgnore(walkBase: string, relPath: string): Verdict {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', relPath], {
      cwd: walkBase, stdio: ['ignore', 'ignore', 'ignore'],
    });
    return 'ignored';                       // exit 0
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    if (status === 1) return 'not-ignored'; // 唯一可信的"未命中"信号
    return 'undeterminable';                // 128 / 其他码 / null（signal 终止）/ spawn 失败
  }
}
```

硬性要点：

1. `execFileSync` 对 exit=1 与 exit=128 **都抛异常**，必须读 `error.status`；**仅** `status === 1` 才是 not-ignored。
2. `status` 为 `null`/`undefined`（spawn 失败、信号终止、git 不可执行）→ `undeterminable`，**绝不** fail-open 成 false。
3. `--` 分隔符**必需**：路径以 `-` 开头时否则会被当成选项。
4. **不加** `--no-index`：本 oracle 要的正是 tracked 豁免语义（fix-report 决定性实验：tracked + 规则命中 → 豁免；tracked-but-deleted 仍豁免）。F253 记忆里"tracked 裸 check-ignore 须 `--no-index`"是另一场景的口径，此处**反向适用**，不要照搬。
5. `cwd` 取 `walkBase`（与预取清单的基准同源），保证查询路径的相对基准一致。
6. 每次调用只问**一个**路径（拒绝批量 `--stdin`，理由见 §0）。

### 3.4 性能、记忆化与 L2 预算的**具名出口**（D7）

- 实测 ~5.7–5.85 ms/次（fix-report + 主线程复核，未找到反例）。
- 记忆化：oracle 实例内 `Map<string, Verdict>`，三态全部缓存（含 `undeterminable`，避免对同一坏路径反复起进程）。
- 触发面：只有存在性探测判 `off-disk` 的路径进 L2。健康仓库里离盘节点是**异常项**，正是图质量门要抓的东西。

**下游已经存在一个硬上限（这是撤下"不设硬上限"表述的直接原因）**：`plugins/spec-driver/scripts/graph-bootstrap-status.mjs:41` 的 `DEFAULT_FRESHNESS_DEADLINE_MS = 5000`。按 ~5.85 ms/次算，**约 800 个**不同离盘路径即吃满该 deadline，freshness 会直接翻成 `unknown-provenance`（`graph-bootstrap-status.mjs:457`）。而"离盘节点多"恰恰是图陈旧的典型形态，也就是 freshness 最该说话的时候。原 §3.4 拒绝硬上限的理由（"截断会制造新的静默降级面"）在这条事实面前不成立：**上限已经存在，只是它把自己转化成了一次判定翻转，而不是一条 warn。**

**裁决**：给 L2 一个与下游 5 s deadline 相容的预算，并把"预算耗尽"做成**有名字的显式出口**：

1. oracle 实例持有 L2 累计耗时预算 `l2BudgetMs`，**默认值必须显著小于 5000 ms 并留出余量**（具体默认值与是否允许 opts 注入由 implement 阶段定，见 §12 item 8；**不引入新环境变量**）。
2. 预算耗尽后：**不再发起任何新的 L2 查询**；此后所有 `off-disk` 路径一律返回 `undeterminable`，并计入 `drainUndeterminable()`，同时标记原因为 **`l2-budget-exhausted`**（出口有名字）。
3. `drainUndeterminable()` 的返回形状相应扩为 `{ count, samples, budgetExhausted }`（或等价的具名原因字段）；§3.5 的两条暴露通道（`nextSteps` + stderr）文案必须能**区分**"判不了"与"预算耗尽所以没去判"。
4. 保留既有的"离盘节点异常多"提示：单实例累计 L2 调用数 > 200 时输出一条聚合 warn（"离盘节点异常多（N 个），图可能极度陈旧，建议 `node dist/cli/index.js batch --mode graph-only` 重建"），此后不再重复。这与预算耗尽是**两件事**，文案不得混用。
- 若 implement 阶段实测 generic collector（走 oracle，逐文件多一次 `lstatSync`）出现可测量回归，可加 `verdict(relPath, { knownOnDisk: true })` 提示位跳过探测——**默认不加**（YAGNI），仅在测得回归时启用并附数据。

### 3.5 `undeterminable` 如何暴露给两类消费方 / 各自的保守方向

**统一保守方向：`undeterminable` ⇒ 按 `not-ignored` 处理**，两类消费方**同向**。

| 消费方 | 保守方向 | 为什么 | 可达性（如实，D10-1） |
|---|---|---|---|
| 采集面 walk（`generic-language-skeleton-collector` 经 oracle；TSJS/PY/py-adapter 经 filter） | 采集（不跳过） | 漏采集会**静默**缺节点（图不完整且无人可见）；多采集则会落进图、被质量门看见（可诊断）。失败方向必须是"可见"而不是"消失" | **可达**。原表述"结构上不可达"已撤下——它被 §3.1a 的 EACCES 反例证伪：dirent 恒在盘只保证不走 L2，**不**保证 `lstat` 成功。EACCES/ELOOP 等形态下采集面同样会拿到 `undeterminable`，此时按 not-ignored 处理 = 与旧行为逐字节一致 |
| 图质量门（`legacy-ignored-check` 的 `ignoredPathNodeIds`） | **不计入违规** | 该维度是 fail 判据。把"判不了"当违规，等于让**任何**存在离盘不可判节点的仓库把"环境噪声"变成红门，而门红的正确语义是"采集器忽略规则失效"。且必须与采集面**同向**，否则会出现"采集器合法收了、门却判违规"的自相矛盾 | **可达**（输入是图节点 id 的 filePart，可离盘）。⚠️ 但**本仓当前不可达**：主线程复核实测 `nodes 6092 / distinct fileParts 996 / OFF-DISK 0 / _reference 节点 0`，故本仓 `drainUndeterminable().count` 恒 0。原文用"本仓 `_reference/**` 今日实测 exit 128 会把门永久判红"作立论，**该立论不成立，已删除**；判据的可达性只能在 fixture 仓验证（§10.1 R1-4） |

**暴露通道（有界，不刷屏）**：oracle 不逐条 warn，而是累积 `{ count, samples: 前 5 条去重路径, budgetExhausted }`：

- `createIgnoreOracle(projectRoot)` 返回 `{ isIgnored(relPath): boolean, drainUndeterminable(): { count: number; samples: string[]; budgetExhausted: boolean } }`。
- `graph-quality.ts`：`buildReport` 结束后取一次，若 `count > 0` → ① 追加一条 `nextSteps` 文案（`nextSteps` 已是 `string[]`，**不动 schema**）：「N 个节点路径的忽略判定不可判（symlink 穿越 / submodule / 仓外 / 越界 / 权限受限 / 预算耗尽），已按未忽略处理，未计入 ignoredPathNodeIds；样本：…」；② 同步一条 stderr warn。
- `generic-language-skeleton-collector.ts`：walk 结束后若 `count > 0` 输出一条聚合 warn。

### 3.5a 三个新观测出口各自的消费者（D4，"没人读 = 没修"）

本 fix 一边指责别人静默降级，就不能自己造无人消费的出口。逐条接线：

| 出口 | 消费者（必须存在） | 落点 |
|---|---|---|
| `nextSteps` 里的不可判条目 | **`scripts/lib/graph-quality-core.mjs` 新增 warn 级 check `ignore-undeterminable`**（该文件是 repo:check 侧唯一消费者，现状逐字段读 7 个字段、全文无 `nextSteps`；stderr 仅在 JSON 解析失败分支被采样；`Next steps:` 只在 renderText 路径，而验证命令走的都是 `--json`） | `npm run repo:check` 会显示该 warn；测试落 `tests/unit/graph-quality-core.test.ts` |
| `scopeExtensionsSource: 'static-fallback-malformed-fingerprint'` | **`graph-consumption-cli.mjs` 在畸形指纹时额外 stderr warn 一条**（全仓非测试消费点现状只有人读渲染与写审计；skills 一次都不读） | 见 §5.5；若 implement 阶段判定 stderr warn 不可行，则**必须**在本 plan 如实降级为"事后取数字段"，且**不得计入 R5 的修复交付物** |
| `kind: 'decide-aborted'` 审计事件 | **无需额外消费者**（裁决：可接受）。exit 3 本身就是响亮信号；审计按 RG-006 只写不读，本事件只作补充记账 | §4.3 |

**`nextSteps` 机读契约与其脆弱性（如实登记）**：因 `graph-quality-report.schema.json` 顶层 `additionalProperties: false` 挡住了结构化字段，`graph-quality-core.mjs` 只能对 `nextSteps` 做**文本前缀匹配**。因此：

- graph-quality 追加的那条文案必须以**稳定的机读前缀 token** 开头（字面值 implement 阶段定，见 §12 item 7）；
- 生产者（TS 侧）与消费者（`.mjs` 侧）**必须由一条跨侧测试双向钉住**该 token，否则改文案即静默断链；
- 这是一条**文本契约**，天然比结构化字段脆弱——如实登记为已知风险，不假装它和 schema 字段等价。

### 3.6 `isIgnored` 是同步 boolean 谓词——改不改签名？

**不改。** `checkLegacyAndIgnoredNodes(graph, isIgnored)` 保持同步 boolean 契约，`graph-quality.ts` 传 `oracle.isIgnored`。

不改的理由与"改的话爆炸半径"：若把三态推到该谓词，连锁面为 `runGraphQualityChecks` 的 options 契约 → `quality-types.ts` 的 `GraphQualityReport['legacyAndIgnoredNodes']` 形状 → `graph-quality-report.schema.json`（`additionalProperties: false`，required 三字段）→ `scripts/lib/graph-quality-core.mjs` 的 `--json` 消费与 exit-code 交叉校验 → F217 六指标契约与其快照测试。为一个"消费方一律按 not-ignored 处理"的结论去动 F217 的对外 JSON 契约，收益为负。三态在 oracle 内部收敛，诊断经独立出口取回——这是最小且诚实的切法。

变更的爆炸半径（实际）：`createIgnoreOracle` 的 2 个生产调用点（`graph-quality.ts:295`、`generic-language-skeleton-collector.ts:121`）+ 测试调用点约 20 处（`ignore-oracle.test.ts` 18 处 + `collector-surface.test.ts:597`），全部是 `createIgnoreOracle(x)` → `createIgnoreOracle(x).isIgnored` 的机械替换。该替换经复核安全：`ignore-oracle.test.ts` 的 tmpDir 是非 git 仓 ⇒ 全走 L0 近似分支，行为与今天逐字节一致。

> 为什么不保留一个"返回裸谓词"的便捷重载：那等于给未来的消费方留一个**静默丢弃诊断**的入口，正是本次要修的那类缺陷形态。单一入口，返回诚实的形状。

### 3.7 已知限制登记（写进代码注释 + 用测试钉住实际行为，**不修**）

| ID | 形态 | 实际行为（测试钉死） | 为什么不修 |
|---|---|---|---|
| KL-1 | 嵌套（未注册的）git 仓内的在盘路径 | L1 判 `not-ignored`（git 不枚举进嵌套仓），与 `check-ignore` 的 IGNORED 分叉。**注意分歧轴**：同一路径离盘时走 L2 会得到相反答案——决定因素是"文件在不在"（见 §3.1 契约声明） | 修它要求 walk 热路径对每个 MISS 起子进程（~5.7 ms × 全仓文件数），与 F255 的性能前提冲突；且该分叉**不是本 fix 引入**（现状即如此） |
| KL-2 | **离盘**的正式 submodule 内路径 / symlink 穿越 / 仓外绝对路径 / `..` 越界 / 空串 | 走 L2 得 exit 128 → `undeterminable` → 按 not-ignored 处理 + 计数出声 | 无差别 fail-loud 会对每个此类节点刷 warn；fail-open 又让缺陷 1 原样复活。三态 + 有界聚合出声是唯一不制造新噪声/新静默的解 |
| KL-3 | `--directory` 折叠前缀的 over-collapse | 仅在盘分支消费 `dirPrefixes`；离盘不消费 | §3.1 已论证在盘分支上该形态与查询前提互斥；仍以红用例复刻 R3 的 `d3` 场景钉住 |
| KL-4（R6） | 修复后 `ignoredPathNodeIds` 对**未提交的**忽略规则改动变敏感，而 freshness 三维不记录这一输入 | 同一份图两次运行间该维度结论可翻转，freshness 仍报 fresh | 把"忽略规则内容"纳入新鲜度是 feature 量级的合同演进（见 §8 defer）。属**量的扩大而非质的新增**（在盘路径本来就每次现读预取清单） |
| **KL-5（新，D1）** | **在盘的 symlink 穿越**：`lstat` 对**最后一段**不跟随、对**中间段跟随**。主线程复核实测 `lstat('link_to_ign/f.ts')` ⇒ ON-DISK，而 `git check-ignore link_to_ign/f.ts` ⇒ exit 128（拒答） | 判在盘 → L1 → 查表 MISS → **`not-ignored`，静默、不计数、永远到不了 L2**。测试须同时断言 `verdict === 'not-ignored'` **且** `drainUndeterminable().count === 0`（钉住"它确实是静默的"） | 这是缺陷 1 原病在该形态上的**原样保留**——本 fix 不修，但必须登记（原 plan 全文未登记，KL-2 只覆盖了离盘那半边）。修它需对路径逐段做 symlink 探测或对每个 MISS 起子进程，成本与 KL-1 同级。⚠️ §3.8 有一个成本很低的候选改良，须在 implement 阶段**带证据裁决**是否纳入 |
| **KL-6（新，D9）** | 输入路径未归一化 / 大小写与磁盘不一致（macOS `core.ignorecase=true`）。主线程复核实测：`IGNORED_DIR/f.ts` ⇒ ORACLE=not-ignored / GIT=ignored；`./ignored_dir/f.ts` ⇒ ORACLE=not-ignored / GIT=ignored | 两形态均落**在盘**分支、**静默、不计数**，判 `not-ignored`。测试钉住该实际行为（**平台相关**：仅在 case-insensitive FS 上可复现；其他平台按显式 skip 口径跳过并打印跳过原因，不得静默跳过） | L1 是对 `git ls-files` 输出做大小写敏感字符串查表；做大小写折叠会在 case-sensitive FS 上引入假 ignored。今天 node id 由 `path.relative` 产出所以实际不可达，但 §3.1 的契约**必须写明前提**，不得保留笼统的无条件表述（那正是本 fix 要删掉的那类 over-claim 的同形物） |

上述限制必须同时写进 `file-scanner.ts` / `ignore-oracle.ts` 的契约注释——注释里旧的"唯一被击穿的是图质量门""与 git status 同源"两句 over-claim 必须删除。

### 3.8 候选改良：symlink-to-dir 条目登记为 dirPrefix（**须带证据裁决，不得静默略过**）

**观察（主线程复核）**：预取清单里 `_reference` 是以**无尾斜杠的文件条目**出现的（symlink 被 git 当文件列），因此进不了 `dirPrefixes`，其子路径在 L1 查表恒 MISS。

**候选改良**：对预取清单里的条目，若其在盘为 **symlink 指向目录**，则**同时**登记为 dirPrefix。这能直接修好本仓最大的一棵被忽略子树（KL-5 的一个主要实例）。

**裁决方式（硬性）**：implement 阶段**必须**做一次带证据的判断并写下结论：

- 纳入 ⇒ 需补红用例（在盘 symlink 子路径判 `ignored`）、修订 KL-5 的登记范围、并说明新增的 `lstat`/`readlink` 成本对 walk 热路径的影响（必须实测，不得推演）；
- 不纳入 ⇒ **必须写明理由**（成本 / 风险 / 与 F255 性能前提的冲突等），并保持 KL-5 原样登记。

**本规划阶段不替它拍板**——brief 明确这是"评估纳入（不是强制）"。对应任务见 tasks.md T025。

### 3.9 `quality-engine.ts` / `legacy-ignored-check.ts` 文件头契约重写（D6）

**问题**：`quality-engine.ts:9-11` 声称「纯函数，零 I/O：所有需要外部信息的判定均通过 opts 注入的回调完成」；`legacy-ignored-check.ts:7-8` 声称「本函数保持零 I/O 纯函数」。修复后注入的 `isIgnored` 变成**会起子进程（`git check-ignore`）+ 带内部可变状态（记忆化 Map + undeterminable 累加器 + L2 预算计时）**的闭包——同一份 graph 连跑两次**可能给出不同结果**（预算耗尽、外部文件系统变化、忽略规则变化）。这是本 fix **新引入的性质变化**，文件头不改就是假话。

**裁决**：两个文件头纳入注释重写范围（T022），必须显式写明：

- 本模块自身仍不做 I/O，但**对注入回调不再假设纯粹性**：回调可能 spawn 子进程、可能带内部可变状态、可能对同一输入在不同时刻给出不同答案；
- 因此本模块的输出是**相对于注入回调的**确定性，而非绝对确定性；
- 需要可重现结果的调用方（如快照测试）必须注入自己的确定性回调。

---

## 4. 缺陷 2 设计：base-ref 不可解析 ⇒ 显式报错

> 前提复核（R1 已实证，不得回退）：`changeClass = 'unknown'` 走矩阵行 7 `consume-degraded`，**排在 stale 之前短路**，且只有 `refresh-then-consume` 才会 `executeRefresh` ⇒ unknown **不刷图**，还会把 `graph-stale-refresh-declined` / `graph-dirty-uncommitted` 等真实信号永久遮蔽。因此**不走 unknown**。

### 4.1 `runGit` 结构化返回

```js
function runGit(projectRoot, args) {
  const result = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return {
    ok: result.status === 0,
    status: result.status,                       // spawn 失败时为 null
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    spawnError: result.error ? String(result.error.message ?? result.error) : null,
  };
}
```

"没跑成"与"跑成了但为空"从此在类型层可区分（原缺陷的 Why 5）。

### 4.2 锚点预检与三种结局

`collectChangeSet(projectRoot, baseRef)` 改为返回 `{ changeClass, files, baseRefResolution, worktreeStatusReadFailed }`：

| 情形 | 判定方式 | `baseRefResolution` | 结局 |
|---|---|---|---|
| 未传 `--base-ref` / trace 无锚点 | `baseRef === null` | `'not-provided'` | **既有行为不变**（EC-29）：只看工作树，输出 `baseRefMissing: true` |
| 传了且可解析 | `git rev-parse --verify --quiet <ref>^{commit}` exit 0 | `'resolved'` | 正常判定 |
| 传了但不可解析 | 上述预检非零退出（含 `-` 开头被 git 当选项的形态） | `'unresolvable'` | **硬失败**：exit 3 |
| 可解析但 `git diff` 仍失败 | diff 的 `ok === false` | `'diff-failed'` | **硬失败**：exit 3（与 unresolvable 同出口、不同 detail） |
| `git status --porcelain` 失败 | porcelain 的 `ok === false` | 不适用 | **不硬失败**：`changeClass = 'unknown'` + `worktreeStatusReadFailed: true` |

**为什么 porcelain 失败不硬失败、base-ref 失败硬失败**（这条线必须写进代码注释）：base-ref 是**调用方显式声称的锚点**，声称了却不可达是合同违反；而 porcelain 失败是环境能力缺失（非 git 项目 / git 不可用），是 CLI 本就支持的合法运行形态（此时 freshness 也会是 unknown-provenance）。两者的责任方不同，出口就不该相同。

### 4.3 显式报错的具体形态

- **退出码 3**（现状：0 成功 / 2 用法错误 / 1 内部异常。3 未被占用）。语义：**锚点不可信，本次拒绝给出决策**。
- **两种合同一视同仁**：`--advisory` 下同样 exit 3。
  - 理由：advisory 与 authoritative 的区别是"结论的权威度"，不是"事实源可不可以骗人"。给 advisory 开一条软路，等于恢复一条"锚点坏了但照常出结论"的静默通道——正是本缺陷的病灶。
  - 已考虑并否决的替代：advisory 软降级（exit 0 + 仅打字段）。否决理由：调用方按现状写的是 `DECISION=$(...)`，只要不非零退出，"字段如实"在实践中等于"没人看"。
  - 代价（如实登记）：本仓 rebase 是常规路径，goal_loop 轮 1 的 advisory 注入会因此更常缺席。这是**正确的缺席**（锚点确实坏了），**但缺席必须有出路——处置、预算与恢复口径见 §4.5**。
- **stdout 仍输出结构化 JSON**（调用方用 `$( )` 捕获时仍拿得到可解析内容），封闭键集：

```json
{
  "schemaVersion": 4,
  "error": "base-ref-unresolvable",
  "ts": "...",
  "projectRoot": "...",
  "phase": "implement",
  "advisory": false,
  "baseRef": "<原样回显调用方给的值>",
  "baseRefResolution": "unresolvable",
  "gitStatus": 128,
  "gitStderr": "<截断至 512 字符>",
  "hint": "phase 起点锚点不可达（rebase 改写历史会造成该形态）。不得据此判定变更类别；请改用可达的 --base-ref 重跑，或显式重记 phase_start_ref 并在 trace 留痕（见 SKILL 恢复口径）。本次不提供影响面证据。",
  "auditWritten": true
}
```

- ⚠️ **封闭键集里没有 `degradedReason` / `fallbackHint`**。调用方读它们会得 `undefined`（SKILL.md:456 现状恰恰记这两个字段）——§4.7 必须同步改掉，日志不得记成 `undefined`。
- **审计**：追加一条 `kind: 'decide-aborted'` 事件（`schemaVersion` / `ts` / `projectRoot` / `phase` / `advisory` / `error` / `baseRefResolution` / `baseRef` / `gitStatus`）。RG-006「只写不读」不变；"每次决策必留证据"因此在失败路径上同样成立。该事件**无需额外消费者**（§3.5a 裁决）。
- **不新增 `DEGRADED_REASONS` 取值、不新增 outcome**：abort 发生在矩阵求值之前，它没有 outcome。这正是用户裁决要求的"不与『变更类别真判不出来』共用出口与降级码"。

### 4.4 观测字段（成功路径）

`decide` 输出与 `kind: 'decision'` 审计事件各新增 3 个字段：

| 字段 | 取值 | 说明 |
|---|---|---|
| `baseRefMissing` | boolean | **语义不变**（`baseRef === null`，即未提供），保留既有断言 |
| `baseRefResolution` | `'not-provided' \| 'resolved'` | 成功路径只可能这两值；`'unresolvable' \| 'diff-failed'` 只出现在 abort payload |
| `worktreeStatusReadFailed` | boolean | porcelain 读取失败的如实标注（与 `graph-quality` 的 `porcelainReadFailed` 同名同义，刻意复用措辞） |

`AUDIT_SCHEMA_VERSION` 3 → 4（论证与连锁面见 §7）。

### 4.5 abort 的处置：刷新预算、恢复口径与残余风险（D5，**本节是 §4.3 承诺的处置**）

原 plan 在 §4.3 写"处置见 §4.5"，但当时的 §4.5 讲的是 `classifyChangeSet` 的 required 入参，与 abort 处置毫无关系——**承诺的处置在 plan 里根本不存在**。本节补上，并逐条解决 brief 指出的三条后果。

**1）abort 不消耗刷新预算（硬性）**

- 事实：`SKILL.md:450-451` 的刷新预算是**散文记账**——「刷新预算键 = (projectRoot, phase=implement)，整个 implement phase 只有一次 allowed：轮 1 在此消耗，轮 ≥2 与步骤 3b 一律 declined」。
- abort 发生在**矩阵求值之前**，没有 `executeRefresh`、**没有发生任何刷新**。若按散文照算"轮 1 已用掉"，后续轮次恒 `declined` ⇒ **整个 phase 再不重建图**，一次 abort 就把重建机会永久吃掉。
- 裁决：§4.7 的 SKILL 更新必须明写 **`RC == 3` 的轮次不计入刷新预算消耗**，下一轮仍可传 `allowed`。
- 实现侧无状态改动（预算本就是 prompt 级散文记账），因此这条**只能**靠 SKILL 文案保证——归入下方残余风险第 5 条。

**2）恢复口径（必须有；没有恢复口径 = 把常规路径整条关掉，比原缺陷更坏）**

- 事实：本仓 rebase 交付是强制流程，`phase_start_ref` 指向被改写的旧 sha 是**常规形态**，不是异常；而 `resolvePhaseStartRef` 是纯读取、无回退。若只 abort 不给出路，一次 rebase 后该 phase 内三个调用点恒 abort，B4 grounding 整条通道**永久失效**。
- 允许的两条恢复路径：
  - **(a) 显式覆盖**：调用方显式传 `--base-ref <可达 ref>` 覆盖 trace 锚点（CLI 已有该参数）。abort 的 `hint` 必须指名这条路。
  - **(b) 显式重记锚点**：编排器在 abort 后**显式**重记 `phase_start_ref`，并在 trace / iteration log 留一条**可审计**记录，写明「原锚点 `<old>` 不可达（rebase 改写），已于 `<ts>` 重记为 `<new>`；此前的 phase 内变更不在本次影响面证据内」。
- **与 §4.7 红线的关系（必须一起读，否则会读成互相矛盾）**：红线禁止的是「**自行、静默**把 `phase_start_ref` 重记为当前 HEAD」——那会凭空重定义基线且无人知道。(b) 允许的是「**显式 + 留痕 + 声明覆盖面损失**」的重记。**二者的差别是可审计性，不是动作本身。**
- **实现层不做自动重记**：CLI 只 abort + 给 hint；重记由编排器/人显式发起。理由：自动重记就是把红线要防的事做成默认行为。

**3）代价如实登记**

goal_loop 轮 1 的 advisory 注入在 rebase 后会更常缺席。缺席是正确的（锚点确实坏了），但缺席后**必须**走上面的恢复口径，不能一路 abort 到底。

**4）abort payload 字段红线**

RC==3 分支**不得**记 `DECISION.degradedReason` / `DECISION.fallbackHint`（封闭键集里没有，会是 `undefined`）；必须改记 `DECISION.error` / `DECISION.hint`。

**5）残余风险（如实登记，本 fix 不解决）**

全仓 SKILL 现在**一处都没有 `$?` 检查**。exit 3 能否被看见 **100% 取决于 §4.7 的散文更新被真的遵守**，属 prompt 级约束、**无机械保障**。同理，"abort 不消耗预算"也只有散文保证。引入机械保障需要 harness 侧改造，超出本 fix 范围——**登记为残余风险，不假装已解决**。

### 4.6 `git-change-classifier.mjs` 的"输入不可信"显式入口

```js
/**
 * @param {{ nameStatusText: string, nameStatusOk: boolean,
 *           porcelainText: string, porcelainOk: boolean }} input
 * @throws {TypeError} 两个 ok 位非 boolean 时抛错——不接受"缺省即可信"，也不接受
 *   "缺省即不可信"（后者会静默把一切判成 unknown，而 unknown 恰恰不刷图，见 R1）
 */
export function classifyChangeSet(input) { … }
```

- `nameStatusOk === false` 或 `porcelainOk === false` ⇒ 直接置 `unrecognized = true` ⇒ `changeClass = 'unknown'`（空串不再被当成"没有变更"这一事实）。
- **required + throw**（F238 的教训：字符串/缺省承担控制信号必被伪装击穿；终态是 caller 传参 required fail-loud）。测试与调用点同批更新。

### 4.7 调用方（SKILL）合同更新

canonical `plugins/spec-driver/skills/spec-driver-feature/SKILL.md` 三处调用点（4b 前置权威判定、goal_loop 步骤 2 advisory、步骤 3b 权威判定）统一补：

```bash
DECISION=$(node "$PLUGIN_DIR/scripts/graph-consumption-cli.mjs" decide … ) ; RC=$?
# RC==3 → 锚点不可信：MUST NOT 发起 impact、MUST NOT 注入影响面；
#         把 DECISION.error 与 DECISION.hint 原样并入上下文注入块 / iteration log
#         （MUST NOT 记 DECISION.degradedReason / DECISION.fallbackHint —— abort payload
#          的封闭键集里没有这两个键，记了就是一行 undefined）。
#         注入文案必须写明"本轮无影响面证据（phase 起点锚点不可达）"。
#         本轮 **不计入刷新预算消耗**（abort 发生在矩阵求值前，没有发生刷新），
#         下一轮仍可传 --refresh-policy allowed。
#         MUST NOT **自行、静默**把 phase_start_ref 重记为当前 HEAD —— 那会凭空重定义基线。
#         恢复口径（二选一，均须留痕）：
#           (a) 显式传 --base-ref <可达 ref> 重跑；
#           (b) 显式重记 phase_start_ref 并在 trace / iteration log 记一条
#               "原锚点 <old> 不可达，已重记为 <new>，此前变更不在本次影响面证据内"。
# RC==2 → 参数用法错误，属编排层 bug，MUST 停下修调用，不得吞掉继续。
# RC==0 → 按既有 outcome 分支处置。
```

同时在措辞红线一节补一句：**退出码 3 不等于"图不可用"，而是"我们不知道这个 phase 改了什么"**——两者的正确说法不同，不得混用。

---

## 5. 缺陷 3 设计：消费侧改为逐管线 `matchSemantics` 同解

### 5.1 数据结构：扁平数组 → 逐管线结构

`graph-consumption-decision.mjs`：

```js
/** 图覆盖范围判据的静态 fallback —— 逐管线 {extensions, matchSemantics}，与指纹 5 条目同形。 */
export const GRAPH_SCOPE_SURFACES = Object.freeze([
  Object.freeze({ id: 'tsjsSkeletonWalk',     extensions: Object.freeze(['.cjs','.js','.jsx','.mjs','.ts','.tsx']), matchSemantics: 'case-sensitive' }),
  Object.freeze({ id: 'pyWalk',               extensions: Object.freeze(['.py','.pyi']),                            matchSemantics: 'case-sensitive' }),
  Object.freeze({ id: 'genericAdapters',      extensions: Object.freeze(['.go','.java']),                           matchSemantics: 'case-insensitive' }),
  Object.freeze({ id: 'moduleDerivationScan', extensions: Object.freeze(['.cjs','.cts','.js','.jsx','.mjs','.mts','.ts','.tsx']), matchSemantics: 'case-insensitive' }),
  Object.freeze({ id: 'pythonSymbolScan',     extensions: Object.freeze(['.py','.pyi']),                            matchSemantics: 'case-sensitive' }),
]);
```

- 扁平 `GRAPH_SCOPE_EXTENSIONS` **整体删除**（不保留兼容别名）：留着就是留第二份真相，而它从类型上无法承载语义——正是本缺陷的 Why 4。
- 形态与 `computeCollectorFingerprint().extensionSurface` 的 5 个 key 一一对应（java/go 合并为 `genericAdapters`），使静态面与动态面**同形**，两条路径共用同一个匹配器。

### 5.2 匹配器：与 `surfaceMatchesFile` 同解，且**不继承** else-fallthrough

```js
/**
 * @returns {boolean|null} null = 该 surface 的 matchSemantics 不认识（不可判），
 *   由调用方整体回落静态面 —— 绝不默认到 case-insensitive（R5：那正是 .PY bug 原样复活）
 */
function surfaceMatchesFileMjs(surface, filePathOrName) {
  if (surface.matchSemantics === 'case-sensitive') {
    return surface.extensions.some((ext) => filePathOrName.endsWith(ext));
  }
  if (surface.matchSemantics === 'case-insensitive') {
    return surface.extensions.includes(path.extname(filePathOrName).toLowerCase());
  }
  return null;  // 显式第三出口，而不是 else
}
```

**`node:path` 豁免裁决（必须显式记账）**：`graph-consumption-decision.mjs` 现有"零 import"硬约束由 `graph-consumption-decision.test.mjs:590` 的 `assert.deepEqual(importLines, [])` 守护。本次将该约束**收窄式放宽**为「零 I/O + 仅允许 `node:path`」，断言改为**封闭等值**：`assert.deepEqual(importLines, ["import path from 'node:path';"])`（多一条、少一条都红）。

- 理由与 TS 侧 SSoT 逐字同源：`src/collector-surface.ts` 本身是"零依赖叶子模块"，却明确 import `node:path`，理由是「`surfaceMatchesFile` 的大小写不敏感分支必须调用**与生产者同一个** `path.extname`，自造一份等价实现才是真正的风险（Node 对 `..`/`a..`/纯点文件的处理有非直觉分支）」。`.mjs` 侧手写 extname 会精确复现该风险，且合同测试只能锚"两侧同解"、锚不住"两侧同错"。
- `node:path` 是纯函数、零 I/O，不破坏"纯函数"这一实质约束；被守护的实质是"不 spawn、不读文件"，断言改为封闭等值后守护力不降。
- 已考虑并否决：把匹配器放进 `graph-consumption-cli.mjs`（已 import `node:path`）并把函数传进 `annotateImpactCaveat`。否决理由：`annotateImpactCaveat` 需要一个可用的默认判据，否则未传函数的调用方静默丧失 FR-006 通道——又一处静默降级。

### 5.3 两个消费点改造

| 位置 | 现状 | 改为 |
|---|---|---|
| `graph-consumption-cli.mjs:318-327` `collectCoverageScope` | 自行 `lastIndexOf('.')` + `toLowerCase()` 比较扁平数组 | `files.some((f) => surfaces.some((s) => surfaceMatchesFileMjs(s, f) === true))`；`null` 语义在推导阶段已被拦下（§5.4），此处按 `=== true` 收口 |
| `graph-consumption-decision.mjs:367` `extensionOf` + `annotateImpactCaveat` | 取小写扩展名后查扁平数组 | 删除 `extensionOf`；改为 `targetInScope(target, surfaces)`：先剥 `::` / `#` 取 filePart，再走同一个 `surfaceMatchesFileMjs` |

`annotateImpactCaveat` 第 4 参默认值改为 `GRAPH_SCOPE_SURFACES`（同文件常量，零 import 合同不受影响）。

### 5.4 指纹侧推导：严格校验下沉到 entry 内部（R5 第一个静默还原点）

`deriveScopeExtensionsFromFingerprint` → 更名 `deriveScopeSurfacesFromFingerprint`，在既有"顶层 5 key 严格集合 + `formatVersion` 门槛"之外**新增 entry 级校验**：

- `entry.extensions` 必须是非空字符串数组（既有）；
- **`entry.matchSemantics` 必须存在且 ∈ `{'case-sensitive','case-insensitive'}`**（新增）——缺失或未知取值 ⇒ **整体返回 null**，回落静态面；
- 任一 entry 不合规 ⇒ 全有或全无地回落（不产出部分并集，沿用既有纪律）。

### 5.5 `scopeExtensionsSource` 取值扩为三值（R5 要求的"可区分取值"）+ 消费者接线（D4）

| 取值 | 触发 |
|---|---|
| `graph-fingerprint` | 指纹被完整认可，用动态面 |
| `static-fallback` | 图不可用 / 无 `fingerprint` 字段（既有形态，语义不变） |
| `static-fallback-malformed-fingerprint` | **新增**：有 `fingerprint` 但结构 / `formatVersion` / `matchSemantics` 不被认识 |

**消费者（D4，必须接）**：全仓非测试消费点现状只有"人读渲染 + 写审计"，skills 一次都不读。因此新增取值必须至少有一条**主动信号**：`graph-consumption-cli.mjs` 在判定为 `static-fallback-malformed-fingerprint` 时**额外输出一条 stderr warn**（内容含指纹被拒的具体原因：顶层 key 不匹配 / formatVersion 不支持 / 某 entry 的 matchSemantics 缺失或未知）。
若 implement 阶段判定 stderr warn 不可行（例如与既有 stdout/stderr 契约冲突），**必须**回到本 plan 把该出口如实降级为"事后取数字段"，并且**不得计入 R5 的修复交付物**——不允许留一个"新增了取值但没人会知道"的出口。

字段名保持 `scopeExtensionsSource` 不改（改名对修复零收益，只增加审计与测试的无谓 churn；在 JSDoc 里注明"面现已是逐管线结构，字段名保留历史称谓"）。
`coverageUnionApplied` 与 `refreshPolicy` 分支逻辑（F254 W-1）保持不变，只是"并集"改为**逐管线合并**：`allowed` 且动态面可用时，取动态 5 条目与静态 5 条目按 id 配对的 `extensions` 并集；`matchSemantics` 若同 id 两侧不一致 ⇒ 该 id 整体按**两条独立条目**并存（宁可多判一次 in-scope 也不静默选一个语义——与 TS 侧 `mergeSurfaces` 遇语义分歧即 throw 的纪律同向，只是消费侧不 throw、改为保守并存并计入 `scopeExtensionsSource` 不变）。

### 5.6 跨语言合同测试升级

`tests/unit/graph-scope-extensions-contract.test.ts` 由"扁平并集一致"升级为**逐管线逐字段**锚定：

1. `GRAPH_SCOPE_SURFACES` 的 id 集合 === `Object.keys(computeCollectorFingerprint().extensionSurface)`；
2. 每个 id 的 `extensions`（排序后）与 `matchSemantics` 两侧逐字相等；
3. `FINGERPRINT_SURFACE_KEYS` / `SUPPORTED_FINGERPRINT_FORMAT_VERSION` 既有两条断言保留；
4. **新增"同解真值表"**：一组判别性文件名（`foo.PY`、`foo.py`、`.ts`、`src/.go`、`Foo.JAVA`、`a.mjs`、`x.MTS`、`f.go/`、`no-ext`）逐条断言 `surfaceMatchesFileMjs(mjs 侧, name) === surfaceMatchesFile(TS 侧对应 surface, name)`。这条是本缺陷的**真正守护**：它锚的是"两侧同解"，而 §5.2 的 `null` 出口锚的是"两侧不会同错"。

---

## 6. 附带项（纳入本次）

### 6.1 `file-scanner.ts:281` 降级探针基准错位

- 现状：`fs.existsSync(path.join(projectRoot, '.git'))`；而 `scanFiles` 里 `projectRoot = options?.projectRoot ?? resolvedDir`，扫描子目录且未显式传 `projectRoot` 时探针查的是 `<子目录>/.git`，结构性不存在 ⇒ git 仓内的降级被静默。
- 修法：改为从 **`walkBase`** 起**向上逐级**查找 `.git`（文件或目录，兼容 worktree 的 `.git` 文件形态），到文件系统根为止；找到即视为"git 上下文内的降级"→ warn。
- 不用 `git rev-parse --is-inside-work-tree` 复核：走到这条分支时 git 可能正是不可用的那个原因，用它判会二次失败。
- 测试：新增"从子目录扫描 + 畸形 `.git` 导致预取失败 ⇒ 仍 warn 一次"的红用例（现状为 0 次）。

### 6.2 `graph-consumption-cli.mjs:462-466` `--refresh-deadline-ms` 的 `Number(true)=1`

- 现状：`parseFlags` 对"下一个 token 以 `--` 开头或缺省"置 `true`；`Number(true) === 1` 通过 `Number.isFinite(1) && 1 > 0` 校验 ⇒ 重建预算被压成 1 ms。
- 修法：先做类型闸门——`flags['refresh-deadline-ms'] !== undefined && typeof flags['refresh-deadline-ms'] !== 'string'` ⇒ 打印用法错误并 `return 2`；随后才 `Number(...)` 并做既有正数校验。
- 顺带同形核查（implement 阶段必须做，不在本次扩大修法）：`parseFlags` 的其他取值型 flag（`--base-ref` / `--phase` / `--spectra-bin` / `--target` / `--decision` / `--impact-result` / `--tasks-file` / `--format` / `--project-root`）现状均已用 `typeof … === 'string'` 判定，属安全形态——若核查发现例外，记进 fix-report 而不是顺手改。

---

## 7. 合同与版本裁决汇总

| 合同 | 裁决 | 论证 |
|---|---|---|
| `AUDIT_SCHEMA_VERSION` 3 → **4** | **bump** | 形状确实变了：新增 `baseRefResolution` / `worktreeStatusReadFailed` 两个输出与审计字段、新增 `kind: 'decide-aborted'` 事件、`scopeExtensionsSource` 新增取值。沿用 F254 的裁决口径：审计只写不读、bump 成本为零，而"该 bump 没 bump"会让这个字段逐步失去指示意义。**连锁面（补充登记，INFO）**：除 `decision` 事件(`graph-consumption-cli.mjs:589`) 与 `decide` payload(`:608`) 外，还有 **`caveat-annotation` 事件(`:723`)**；测试侧只有 2 处钉死 3（`graph-consumption-cli.test.mjs:1024 / :1079`），**无入库 audit fixture**（即：bump 漏改某处不会被 fixture 抓到，只能靠这 2 处断言 + 人工核对） |
| `DEGRADED_REASONS`（12 值） | **不动** | abort 不是降级出口；用户裁决明确要求不与 `classification-unknown` 共用降级码 |
| 决策矩阵 13 行 | **不动** | 本次只改矩阵**入参的计算方式**与"是否有资格进入矩阵"，不改矩阵本体 |
| `collector-fingerprint.formatVersion`（=1） | **不动** | 指纹结构零变化；只有消费侧的解读变严 |
| `BEHAVIOR_VERSION`（=2） | **不 bump**（裁决制品化，沿用 F252 先例）——⚠️ **但实证必须能证伪自己（D3）** | 判据是"被采集的文件集合是否变化"：walk 侧（`createGitignoreFilter` 的 L0/L1 分支）**逐字节不变**；generic collector 走 oracle，其查询路径恒在盘 ⇒ 走 L1；`lstat` 非 ENOENT 失败走 **L3 → `undeterminable` → 按 not-ignored** = 旧行为（§3.1a 的直接目的就是保住这条）；L2 只对 `off-disk` 路径生效，而离盘路径按定义不会被采集。故 `gitignore-interpretation` 责任项**未触发**。**实证要求（硬性）**：见 §10.5，(a) 本仓差分 + (b) 构造反例仓差分**两条都跑完且都无分歧**才算成立；任一条出现分歧 ⇒ **必须 bump** 并重新校准 F249/F193/F217 三方判据，**不得为保持不 bump 而弱化实证口径**。**残余风险（如实登记）**：忘记 bump 没有任何运行时守护会抓到 |
| `graph-quality-report.schema.json` | **不动** | 不可判计数走已有的 `nextSteps: string[]`；顶层 `additionalProperties: false` 决定了新增字段代价过高。代价是诊断只能走**文本前缀机读契约**（§3.5，脆弱性已登记） |
| `graph-consumption-decision.mjs` 零 import | **收窄式放宽为「零 I/O + 仅 `node:path`」** | 见 §5.2；断言改为封闭等值，守护力不降 |
| `classifyChangeSet` 入参 | **新增 2 个 required 布尔位，缺省 throw** | 见 §4.6 |
| `createIgnoreOracle` 返回类型 | **函数 → 对象**（`{ isIgnored, drainUndeterminable }`，drain 结果含 `budgetExhausted`） | 见 §3.6 / §3.4 |
| `quality-engine.ts` / `legacy-ignored-check.ts` 的"零 I/O 纯函数"文件头 | **重写描述**（代码不动） | 见 §3.9（D6） |

---

## 8. Defer 登记（不改，只记账）

**`src/panoramic/graph/source-commit.ts:69` —— 忽略规则内容不进任何新鲜度维度。**

- 事实：`isDirtyJudgedSourceFile` 只认源码采集面；`.gitignore` 对 case-sensitive 面 `endsWith` 不命中、对 case-insensitive 面 `path.extname('.gitignore') === ''` 不命中 ⇒ 未提交的 `.gitignore` 改动不翻 dirty，`sourceCommit` 是 HEAD sha 也不含它。
- defer 理由：纳入新鲜度需在 `collector-fingerprint` 增一个新维度 ⇒ 必须 bump `formatVersion` ⇒ 触发 `plugins/spec-driver/scripts` 侧第三处手写副本（`SUPPORTED_FINGERPRINT_FORMAT_VERSION` + 严格 key 集合）连锁修改，并需重新校准 F249 指纹 / F193 加载期 stale / F217 六指标三方判据的一致性。这是 feature 量级的合同演进。
- R6 补记（本 fix 放大了它）：缺陷 1 修复后，离盘路径的答案成为**实时**忽略规则的函数，`ignoredPathNodeIds` 对未提交的忽略规则改动更敏感 ⇒ 同一份图可在两次运行间翻转 gate 结论而 freshness 仍报 fresh。属量的扩大而非质的新增（在盘路径本来就每次现读预取清单），故 defer 结论不变，但必须写进 KL-4 与后续候选卡。

---

## 9. 分阶段实施（HIGH 风险强制）

每个 Phase 自成可独立验证的闭环，**Phase 内全绿方可进入下一 Phase**；每个 Phase 结束跑一次独立子代理异构对抗复审（≥2 切入角；Codex 配额暂停期档位，门禁类改动须在 commit message 标注「Codex 审查暂停，异构档位缺席」）。复审记录必须列出**实际检查的切入角与各自的具体查证动作**；**零发现时须说明查了什么**（D8）。

> **验证命令口径（D2，硬性）**：PATH 上的 `spectra` 是全局旧编译产物（主线程复核：`which spectra` ⇒ `~/.volta/bin/spectra`；`spectra --version` ⇒ `v4.4.0 (0ae3eb7)`，**不是**本 worktree 基线 `19bff52a`）。本 fix 的**所有**验证命令一律用**本 worktree 的 `node dist/cli/index.js`**（或显式 `--spectra-bin` 指向本地 dist），**禁止**使用 PATH 上的 `spectra`。

| Phase | 内容 | 验证点（必须全绿才推进） |
|---|---|---|
| **P1 采集/质量面（缺陷 1 + 6.1）** | `file-scanner.ts` 三态 oracle（含 errno 三分、L2 预算具名出口）+ 探针修正；`ignore-oracle.ts` 三态收敛与诊断出口；`graph-quality.ts` / `generic-language-skeleton-collector.ts` 调用点；`graph-quality-core.mjs` 消费者；契约注释重写（含 D6 两个文件头）；对应测试 | ① `npx vitest run` 零失败（含 F255 既有 git 事实源族 + 新红用例 R1-1..R1-10）；② `npm run build`；③ **可控 fixture 验收（缺陷 1 的唯一有判别力的验收，D2）**：建图 → 删除若干源文件制造离盘节点 → **不重建** → 直接跑 `node dist/cli/index.js graph-quality --json`，断言这些节点按 `.gitignore` 规则**正确**进/不进 `ignoredPathNodeIds`；④ 本仓实跑（`node dist/cli/index.js batch --mode graph-only` 后再跑 graph-quality）**仅作零信息量的回归护栏**——本仓 0 个离盘 filePart，该实跑无论实现好坏都恒绿，**不得**当作缺陷 1 的验收证据 |
| **P2 消费侧口径（缺陷 3 + 6.2）** | `graph-consumption-decision.mjs` 结构化 + 匹配器；`graph-consumption-cli.mjs` 两个消费点、指纹推导与畸形指纹 warn；跨语言合同测试升级 | `npm run test:plugins` + `npx vitest run` 零失败；同解真值表 9 条全绿；`--refresh-deadline-ms --format json` 形态被判用法错误；畸形指纹形态下 stderr 出现 warn |
| **P3 base-ref 硬失败（缺陷 2）+ 契约收口** | `git-change-classifier.mjs` required 入口；`runGit` 结构化；abort 出口与审计事件；`AUDIT_SCHEMA_VERSION` bump（含 `caveat-annotation` 事件连锁）；canonical SKILL 三处调用点（含预算与恢复口径）；`repo:sync` 再生 | `npm run test:plugins` + `npx vitest run` + `npm run build` + `npm run repo:check`（含 graph-quality 族）+ `npm run release:check` 全零失败 |

Phase 间依赖：P1 与 P2 相互独立，可并行；P3 的 `AUDIT_SCHEMA_VERSION` bump 会碰 P2 改过的审计断言，故 **P3 必须排在 P2 之后**。

---

## 10. 验证方案

### 10.1 先红用例（每条缺陷至少一条，必须先看到红）

| ID | 缺陷 | 用例（真实 git 仓，不 mock 子进程） | 修复前 | 修复后 |
|---|---|---|---|---|
| R1-1 | 1 | `.gitignore` 含 `legacy/` + `*.gen.ts`，文件**不在盘**，查 `legacy/old.ts` / `foo.gen.ts`；**并含一条目录路径输入**（钉住 §3.1 的输入契约） | `false` ❌ | `ignored` / 经 oracle 为 `true` |
| R1-2 | 1 | 同上仓，`git add -f keep.gen.ts` 后删除工作树文件（tracked-but-deleted） | — | `not-ignored`（tracked 豁免，与 `check-ignore` 同答案） |
| R1-3 | 1 | 复刻 R3 的 `d3`：`.gitignore` 仅 `*.log`，`generated/notes.ts` 被删除使 `generated/` 被折叠，查 `generated/notes.ts` | 分层实现若先过 dirPrefix 会误判 `ignored` | `not-ignored`（离盘不消费 dirPrefix） |
| R1-4 | 1 | 复刻 R4：仓内 symlink 指向被忽略目录，查其下**离盘**路径 | `false`（静默） | `undeterminable` ⇒ 消费方按 not-ignored + `drainUndeterminable().count === 1` |
| R1-5 | 1 | 复刻 R2：仓内嵌套未注册 git 仓 `subrepo/`，根 `.gitignore` 有 `*.gen.ts`，`subrepo/a.gen.ts` **在盘** | `false` | 仍 `not-ignored`（**KL-1 钉住实际行为**，注释与测试名显式标注"已知限制，非 bug"） |
| R1-6 | 1 | 非 git 目录 / 畸形 `.git` 从**子目录**扫描 | warn 0 次 | warn 恰 1 次（6.1） |
| **R1-7（新，D1）** | 1 | **errno 三分**：至少覆盖 `EACCES`（父目录 `chmod 000`，walk 能枚举但 `lstat` 抛错）与一种非 ENOENT 的其他形态（`ELOOP` 自指 symlink 环 / `ENAMETOOLONG`） | 分层实现若把 lstat 失败当离盘 ⇒ 落 L2，答案可能与旧行为不同 | `undeterminable`（L3 出口）⇒ 按 not-ignored + 计数；**不得**落 L2。⚠️ root 身份下 EACCES 不可构造：必须**显式 skip 并打印跳过原因**，不得静默跳过 |
| **R1-8（新，KL-5）** | 1 | **在盘的 symlink 穿越**：`link_to_ign -> ignored_dir`，查 `link_to_ign/f.ts`（中间段 symlink 被 `lstat` 跟随 ⇒ 判在盘） | 同修复后（原病保留） | `not-ignored` **且** `drainUndeterminable().count === 0`（钉住"它静默、不计数、到不了 L2"） |
| **R1-9（新，KL-6）** | 1 | **大小写/归一化前提**：`IGNORED_DIR/f.ts` 与 `./ignored_dir/f.ts`（macOS `core.ignorecase=true`） | 同修复后（原病保留） | `not-ignored`（与 `git check-ignore` 的 IGNORED 分叉），落在盘分支、不计数。**平台相关**：仅 case-insensitive FS 可复现，其他平台显式 skip 并打印原因 |
| **R1-10（新，D8）** | 1 | **git worktree 内 oracle 判定与主仓一致**（原藏在收官核对清单里的一条新测试，按 TDD 强制条款拆成独立任务，须有先红步骤） | 待实测（预期已绿；若已绿须在任务记录里写明"该条为锁定不回退的护栏，先红步骤不适用的理由"） | 与主仓同答案 |
| R2-1 | 2 | `--base-ref deadbeef…`（不可解析） | exit 0 + `skip-impact` + `baseRefMissing:false` | exit **3** + `error:'base-ref-unresolvable'` + 审计有 `decide-aborted` 事件 |
| R2-2 | 2 | 同上 + `--advisory` | exit 0 | exit **3**（两种合同一视同仁） |
| R2-3 | 2 | `--base-ref-from-trace` 指向无锚点文件 | `baseRefMissing:true`, exit 0 | **不变**（EC-29 回归护栏） |
| R2-4 | 2 | `classifyChangeSet({nameStatusText:'', porcelainText:'…'})`（缺 ok 位） | 静默 `ok:true, entries:[]` | **throw** |
| **R2-5（新，D5）** | 2 | **abort 的处置面**：① abort 路径**不产生任何刷新**（断言无 `executeRefresh` 痕迹 / 无刷新审计事件），据此支撑"不消耗预算"的散文口径；② **恢复口径可用**：同一仓在 abort 后显式传可达 `--base-ref` 重跑 ⇒ 正常 exit 0 出决策；③ abort payload **不含** `degradedReason` / `fallbackHint`（封闭键集断言） | 不适用（abort 出口尚不存在） | 三条全绿 |
| R3-1 | 3 | 变更文件 `foo.PY`，图无指纹（走静态面） | `in-graph-scope` ❌ | `out-of-graph-scope` |
| R3-2 | 3 | `annotate-caveat --target 'foo.PY::bar'`，`directCallers:0` | 挂 caveat ❌ | 不挂 caveat |
| R3-3 | 3 | 指纹 entry 缺 `matchSemantics` / 取值为 `'case-folded'` | 行为未定义（按扩展名并集算） | 整体回落 + `scopeExtensionsSource: 'static-fallback-malformed-fingerprint'` **且 stderr 有 warn**（D4） |
| R3-4 | 3 | `Foo.JAVA`（case-insensitive 面）仍判 in-scope | — | `in-graph-scope`（防修过头） |

### 10.2 变异测试（证守护力，逐条必须让某条测试变红）

**证据要求（D8，硬性）**：每条变异任务的验收 = **贴出变红用例的完整名称 + 断言失败输出前 5 行**，落进 `specs/258-fix-graph-truth-source-fidelity/verification/mutation-evidence.md`。仅写"已确认变红后撤销"**不接受**——撤销后 diff 里什么都不剩，事后无从复核是否真跑过。

| # | 注入的变异 | 期望变红的测试 |
|---|---|---|
| M1 | `queryCheckIgnore` 的 `status === 1` 改为 `status !== 0` | R1-4（`undeterminable` 被吞成 not-ignored） |
| M2 | L1/L2 顺序对调（先查 dirPrefix 再判存在性） | R1-3 |
| M3 | oracle 对 `undeterminable` 返回 `true` | R1-4 的 `ignoredPathNodeIds` 断言（两消费方同向被破坏） |
| M4 | abort 分支改为 `return 0` | R2-1 / R2-2 的退出码断言 |
| M5 | `classifyChangeSet` 的 ok 位改为默认 `true` | R2-4 |
| M6 | `surfaceMatchesFileMjs` 的第三出口改回 `else` 兜底到 case-insensitive | R3-3 |
| M7 | `GRAPH_SCOPE_SURFACES` 某条的 `matchSemantics` 改成另一值 | §5.6 的逐管线合同断言 + 同解真值表 |
| M8 | `--refresh-deadline-ms` 的类型闸门删除 | 6.2 用例 |
| **M9（新，D1）** | `probePresence` 的 errno 三分改为"任何 `lstat` 失败都当 `off-disk`" | R1-7 |
| **M10（新，D4）** | 删除 `graph-quality-core.mjs` 的 `ignore-undeterminable` check（或改成不读 `nextSteps`） | `tests/unit/graph-quality-core.test.ts` 中该 check 的断言 |

### 10.3 回归护栏逐条对照

| 护栏 | 怎么守住 |
|---|---|
| **F255 原病不回退**（嵌套 `.gitignore` 覆盖的文件不再入图永判 fresh） | ① `createGitignoreFilter` 的 L0/L1 逻辑逐字保留 ⇒ `tests/unit/file-scanner.test.ts` 的 F255 族（6 条）与 `tests/integration/gitignore-collector-freshness-consistency.test.ts`（用例 A/B/C）**不改一行**且必须全绿；② 修法同时满足"规则匹配语义"（L2 用 `check-ignore`）与"tracked 豁免与 git 同源"（不加 `--no-index`，R1-2 钉住） |
| **F217 六指标质量门** | **可控 fixture**（§9 P1 验证点 ③）上逐条判定离盘节点进/不进 `ignoredPathNodeIds` 的真/假阳性；本仓 graph-only 重建后六指标全 pass 仅作**零信息量回归护栏**（本仓 0 离盘 filePart） |
| **F193 加载期 stale 检测 / F249 collector 指纹 / F254 图自述面优先** | 三者的判据输入（`sourceCommit`、`fingerprint`、`formatVersion`、`BEHAVIOR_VERSION`）本次全部不变（§7）⇒ **本 fix 不引入新的判据输入分歧**。⚠️ **但推不出"结构上不可能出现一个说 fresh 一个说 stale"**（原表述已撤下，D10-2）：(a) freshness 仍可能因 graph-quality 超时翻成 `unknown-provenance`（§3.4 的 5 s deadline），(b) KL-4 本身就是"gate 结论翻转而 freshness 仍报 fresh"的既有案例。如实表述为：**判据输入不变 ⇒ 不新增分歧来源；既有分歧来源（超时、KL-4）不受本 fix 影响，仍然存在** |
| **降级路径 fail-loud** | L0 降级 warn（探针修正后真正可达）；L2 不可判有界聚合出声 + 预算耗尽具名出口；诊断出口各自接上消费者（§3.5a）；base-ref 失败 exit 3 + 审计事件；porcelain 失败 `worktreeStatusReadFailed:true`。**全链路无新增静默出口**——由 §10.2 的 M1/M3/M4/M9/M10 五个变异共同守 |
| **非 git 仓 / git 不可用 / worktree 场景显式定义并测试** | 非 git：L0 二态近似，无 warn（既有用例）；git 不可用（畸形 `.git`）：L0 + warn 1 次（R1-6）；git worktree：**R1-10 独立测试任务**（不再挂在收官核对清单里） |
| **每条缺陷先有红用例 + 变异测试证守护力** | §10.1 / §10.2（含 D8 的证据落盘要求） |

### 10.4 验证命令（全部零失败）

```bash
npx vitest run                 # TS 侧全量（含新增红用例与升级后的合同测试）
npm run test:plugins           # plugins 侧 .mjs 测试族
npm run build                  # tsc 零错误（注意：先 build 再跑 e2e 相关 project）
npm run repo:check             # 含 graph-quality 族（新 ignore-undeterminable check 在此可见）与 codex 分发一致性
npm run release:check
# 本仓实证（零信息量回归护栏，不是缺陷 1 的验收证据）——一律走本地 dist，禁用 PATH 上的全局 spectra：
node dist/cli/index.js batch --mode graph-only \
  && node dist/cli/index.js graph-quality --json --graph specs/_meta/graph.json
```

> 已知环境坑（沿用既有记账）：rebase 后大面积红先 `rm -rf dist && npm run build` 再判归属；vitest 全过但 exit 1 属 F235 birpc 已知项；`watch-command` / `batch-orchestrator-incremental` / `community-analysis perf` / `cli-e2e --version` 属预存 flaky，隔离重跑确认，不当回归挖。

### 10.5 `BEHAVIOR_VERSION` 不 bump 的**可证伪**实证（D3，硬性）

原方案用"单仓差分全等"证一条全称命题，而本仓不存在 EACCES 目录、不存在离盘节点 ⇒ 差分必然全等 ⇒ 标绿 ⇒ 版本号保持。**这样的实证证不伪自己，不算实证。** 拆成两条，**两条都跑完且都无分歧才算成立**：

| 条 | 内容 | 口径 |
|---|---|---|
| **(a) 本仓差分（确认向）** | 用**本地 dist** 在修复前/后各跑一次采集，逐字节对比被采集的文件集合 | 两侧都必须用本 worktree 的 `node dist/cli/index.js`，不得混用 PATH 上的旧全局产物 |
| **(b) 构造反例仓差分（证伪向，不可省）** | 构造覆盖以下形态的 fixture 仓并同样做前/后差分：① §3.1a 列出的 errno 形态（至少 EACCES 目录 + 一种非 ENOENT 其他形态）；② 嵌套 git 仓形态（KL-1）；③（有条件时）在盘 symlink 穿越（KL-5） | 目的就是**试图制造分歧**。若制造不出分歧，须写明"已尝试的形态清单"，而不是只报"无分歧" |

**处置**：任一条出现分歧 ⇒ **必须 bump `BEHAVIOR_VERSION`** 并重新校准 F249 / F193 / F217 三方判据。**不得为保持不 bump 而弱化实证口径**（例如缩小 fixture 形态、只跑 (a)）。

---

## 11. Constitution Check

| 原则 | 适用 | 评估 | 说明 |
|---|---|---|---|
| I 双语文档 | 是 | PASS | 中文散文 + 英文标识符 |
| II Spec-Driven | 是 | PASS | 走 fix 模式全链路，不直接改源码 |
| III YAGNI | 是 | PASS（有 2 处需自证） | ① 三态是**实证存在**的第三种事实（R4 exit 128、EACCES errno），非假想扩展；② 拒绝了"批量 pre-warm"、"二次便捷入口"、"改 quality schema"三个更重的方案；③ `[CLEANUP]` 为条件触发且用实测行数两遍法判定，不为凑规则重构 |
| IV 诚实标注不确定性 | 是 | PASS | KL-1..KL-6 显式登记；§12 列出"现在不知道"的项；§3.5 / §10.3 的 over-claim 已按 D10 改成弱表述；残余风险（无 `$?` 机械保障、忘记 bump 无守护、`nextSteps` 文本契约脆弱）均如实登记 |
| V AST 精确性 | 否 | N/A | 不涉及结构化数据抽取 |
| VI 混合分析流水线 | 否 | N/A | — |
| VII 只读安全性 | 是 | PASS | 新增的只有 `git check-ignore` / `git rev-parse` 只读命令；写操作仍限 `specs/` 与审计文件 |
| VIII 纯 Node.js 生态 | 是 | PASS | 零新依赖 |
| IX Prompt 编排 + Harness | 是 | PASS | SKILL 只改散文合同，不把编排决策塞进脚本；abort 的恢复动作由编排器显式发起，CLI 不自动重记锚点 |
| X 零运行时依赖 | 是 | PASS | `.mjs` 侧仅新增 `node:path`（Node 内建），零 npm 包；零 dist 依赖边界不变 |
| XI 质量门不可绕过 | 是 | PASS | 本次是**加强**门禁（消灭三条静默通道 + 给三个新出口各自接上消费者），不放宽任何 gate |
| XII 验证铁律 | 是 | PASS | §10.4 由编排器独立实跑；缺陷 1 的验收改为**有判别力的 fixture**（D2），本仓实跑降级为零信息量护栏 |
| XIII 向后兼容 | 是 | **需论证（见下）** | 有 3 处行为破坏 |
| XIV 可观测性与架构守护 | 是 | PASS | 新增 `baseRefResolution` / `worktreeStatusReadFailed` / 不可判计数（含 `budgetExhausted`）/ abort 审计事件，且**每个新出口都有指定消费者或明确的"无需消费者"裁决**（§3.5a） |

**原则 XIII 的破坏性变更论证（3 处，均为"消除谎报"而非"改变承诺"）**：

1. `decide` 新增退出码 3：旧调用方若不检查退出码，会拿到 stdout 的 abort JSON 且没有 `outcome` 字段 ⇒ 分支自然落空、不会误注入 impact，失败方向安全；canonical SKILL 同批更新。⚠️ 但全仓 SKILL 现无 `$?` 检查，可见性依赖散文被遵守（§4.5 残余风险）。
2. `createIgnoreOracle` 返回类型变更：仅本仓内部 API，2 个生产调用点同批更新，无外部消费方。
3. `classifyChangeSet` 入参 required 化并 throw：仅本仓内部 API；选择 throw 而非"缺省即不可信"，正是因为后者会静默落进 `unknown`——而 R1 已证 `unknown` 不刷图且会遮蔽 freshness 信号。

以上三处均属"未配置新字段时行为不变"无法适用的情形（旧行为本身即缺陷），按 Constitution 治理规则记入本节而非豁免。

---

## 12. 现在不知道 / 待 implement 阶段确认

按"查不到就明确说不知道"的规则如实登记，**禁止在 tasks/implement 阶段把这些当成已知事实**：

1. ~~本仓当前图在修复后会新增多少 `ignoredPathNodeIds`~~ → **已测定（D2）**：主线程复核实测本仓图 `nodes 6092 / distinct fileParts 996 / OFF-DISK 0`，离盘是缺陷 1 的**唯一**触发条件 ⇒ 本仓修复后新增 `ignoredPathNodeIds` **预期为 0**。据此：本仓实跑**无判别力**，缺陷 1 的验收必须走 §9 P1 验证点 ③ 的可控 fixture。若本仓实跑意外出现新增条目，说明有未预期的离盘节点出现，**必须**逐条判定真/假阳性并回到设计而不是调阈值。
2. ~~`_reference/**` 类节点在本仓当前图中是否存在~~ → **已测定（D2）**：本仓图 **0 个 `_reference` 节点**、0 个离盘 filePart ⇒ `drainUndeterminable().count` 在本仓恒 0。据此：R1-4 / R1-7 **只能**在临时 fixture 仓复现；且 §3.5 里以 `_reference/**` 为据的立论已删除。
3. **`[CLEANUP]` 是否触发**：取决于实际净增行数，implement 阶段按 §1 的**两遍法**执行（必须贴 `git diff --stat` 实数，不接受"预计"）。
4. **`git rev-parse --verify --quiet <ref>^{commit}` 在本仓 git 版本上的确切退出码谱**：预期 0/1，但 `-` 开头输入等异常形态的实际码未逐一实测；实现按"非 0 即 unresolvable"收口（保守方向），P3 用红用例覆盖至少 3 种形态。
5. **`goal-loop-graph-consumption-integration.test.mjs` 中是否还有依赖"base-ref 坏了也返回 exit 0"的隐式断言**：只核到 L446/L462 两处 `baseRefMissing` 断言（均为 not-provided 形态，不受影响），全文未逐行核。P3 开工前先通读该文件。
6. **`.PY`/`.PYI` 类文件在本仓是否存在**：未核。缺陷 3 的红用例一律在 fixture 仓构造，不依赖本仓存量。
7. **`nextSteps` 机读前缀 token 的确切字面值**（§3.5）：未定。implement 阶段确定，必须由跨侧测试双向钉住；本规划阶段**不知道**它长什么样，不得在别处假设。
8. **L2 预算的默认值与可配置形态**（§3.4）：未定。硬约束只有两条——默认值必须显著小于下游 `DEFAULT_FRESHNESS_DEADLINE_MS = 5000` 且留余量；不引入新环境变量。具体数值 implement 阶段带实测定。
9. **§3.8 的 symlink-to-dir → dirPrefix 改良是否纳入**：未定，**必须带证据裁决**（纳入需补红用例 + 实测 walk 成本；不纳入须写明理由）。本规划阶段**不替它拍板**。
10. **`graph-quality-core.mjs` 的新 check 是否会与既有 `repo:check` 早退分支冲突**（该文件在多处 `return { status: 'warn' … }` 早退）：未逐行核。implement 阶段须确认新 check 放在报告解析成功之后的正确位置，并有测试覆盖"早退分支不误报"。

---

## 13. 任务拆分索引（细化见 tasks.md）

| 任务组 | 内容 | Phase |
|---|---|---|
| T001–T004 | 跨阶段前置确认（基线、integration test 通读、current-spec 核查、**验证二进制口径固定为本地 dist**） | P0 |
| T005–T006 | `file-scanner.ts` 的 `[CLEANUP]` 两遍法判定与条件搬运 | P1 |
| T007–T012 | 红用例 R1-1..R1-10（含 errno 三分 / KL-5 / KL-6 / worktree 一致性） | P1 |
| T013–T016 | 三态 verdict（errno 三分）+ 6.1 探针 + L2 预算具名出口 + 转绿 | P1 |
| T017–T021 | `createIgnoreOracle` 对象化 + `graph-quality.ts` 诊断出口 + **`graph-quality-core.mjs` 消费者** + generic collector + 20 处测试机械更新 | P1 |
| T022–T025 | 契约注释重写（含 D6 两个文件头、KL-1..KL-6）+ KL-2/KL-4 钉桩 + **§3.8 带证据裁决** | P1 |
| T026 | F255 回归族零改动复跑 | P1 |
| T027–T031 | 变异 M1/M2/M3/M9/M10（含证据落盘） | P1 |
| T032–T035 | fixture 验收 + 本仓零信息量护栏实跑 + vitest 全量 + 对抗复审 | P1 |
| T036–T037 | `graph-consumption-cli.mjs` 的 `[CLEANUP]` 两遍法判定与条件搬运 | P2 |
| T038–T044 | 红用例 R3-1..R3-4 + 6.2 + 逐管线结构/匹配器/推导校验/三值 + 畸形指纹 warn + 转绿 | P2 |
| T045–T050 | 合同测试升级 + 变异 M6/M7/M8 + 全量 + 对抗复审 | P2 |
| T051–T055 | P3 前置通读 + 红用例 R2-1..R2-5（含 abort 处置面） | P3 |
| T056–T062 | classifier required + `runGit` + `collectChangeSet` + abort 出口 + 观测字段 + `AUDIT_SCHEMA_VERSION` bump + 转绿 | P3 |
| T063–T068 | 变异 M4/M5 + SKILL 更新（含预算与恢复口径）+ `repo:sync` + 全量 + 对抗复审 | P3 |
| T069–T077 | 收官：全量命令 + 本仓实证 + **BEHAVIOR_VERSION 双向差分实证** + 变异证据汇总 + §12 落定 + 护栏复核 + current-spec 处置 + fix-report 补记 | P4 |

---

## 14. Phase 2 对抗审查修订记录（D1~D10 落点）

> 依据：`specs/258-fix-graph-truth-source-fidelity/plan-revision-brief.md`（编排器主线程逐条复核后的**已定裁决**）。

| 裁决 | 一句话内容 | plan 落点 | tasks 落点 |
|---|---|---|---|
| **D1** | L1 在盘判定改 **errno 三分**（非 ENOENT/ENOTDIR ⇒ 直接 `undeterminable`）；新增 **KL-5**（在盘 symlink 穿越）；删除 §3.5 里以本仓 `_reference/**` 为据的立论；symlink→dirPrefix 改良**带证据裁决** | §3.1（L1/L3 行）、**§3.1a（新）**、§3.5（消费方表 + 立论删除）、§3.7 KL-5、**§3.8（新）**、§7 BEHAVIOR_VERSION 论证、§12 item 2/9 | T009（R1-7 红用例）、T010（R1-8/KL-5）、T013（实现）、T022（注释登记）、T025（带证据裁决）、T030（M9） |
| **D2** | P1 验收换成**可控 fixture**；本仓实跑降级为零信息量护栏；验证命令一律用本地 `node dist/cli/index.js`；§12 item 1/2 改为已测定 | §9 验证命令口径 + P1 验证点 ③④、§10.3 F217 行、§10.4、§12 item 1/2 | T004（口径固定）、T032（fixture 验收）、T033（本仓护栏实跑，显式标注零信息量） |
| **D3** | `BEHAVIOR_VERSION` 差分实证必须能证伪自己：(a) 本仓 + (b) 构造反例仓，两条都无分歧才成立；任一分歧必须 bump | §7 BEHAVIOR_VERSION 行、**§10.5（新）** | T071（(a) 本仓差分）、T072（(b) 反例仓差分 + 分歧处置） |
| **D4** | 三个新观测出口各自接消费者：`nextSteps` → `graph-quality-core.mjs` 新 warn check；畸形指纹 → stderr warn；`decide-aborted` → 无需消费者（可接受） | **§3.5a（新）**、§0 只改文件表第 5 行、§1 新增 `graph-quality-core.mjs` 行、§5.5 消费者段、§10.1 R3-3、§10.2 M10、§12 item 10 | T019（core 消费者 + 测试）、T031（M10）、T042（畸形指纹 warn）、T039（R3-3 断言含 stderr warn） |
| **D5** | 修好 §4.3 断链；补 abort 处置节；abort **不消耗刷新预算**；给出**恢复口径**；payload 无 `degradedReason`/`fallbackHint` | §4.3（引用改为 §4.5 + payload 红线）、**§4.5（新，原 §4.5/§4.6 顺延为 §4.6/§4.7）**、§4.7 SKILL 文案 | T055（R2-5 三条断言）、T059（payload）、T065（SKILL：预算 + 恢复口径 + 字段红线） |
| **D6** | `quality-engine.ts` / `legacy-ignored-check.ts` 文件头的"零 I/O 纯函数"契约纳入重写范围 | §0 明确不改（加注）、§1 两行 debt、**§3.9（新）**、§7 末行 | T022（注释重写范围含这两个文件头） |
| **D7** | L2 预算要有**有名字的出口**，与下游 5 s deadline 相容；"不设硬上限"表述撤下 | §3.4（整节重写，含 `l2-budget-exhausted` 具名出口与 `budgetExhausted` 字段）、§3.5 暴露通道、§7 `createIgnoreOracle` 行、§12 item 8 | T015（预算与具名出口实现）、T018（文案区分"判不了"与"预算耗尽"） |
| **D8** | tasks 可证伪性：变异测试须落证据文件；对抗复审 checkpoint 须列切入角与查证动作；`[CLEANUP]` 改两遍法实测；worktree 用例拆成独立任务 | §1 前置清理两遍法、§9 复审记录要求、§10.1 R1-10、§10.2 证据要求、§10.3 worktree 行 | T005/T036（两遍法）、T012（R1-10 独立任务）、T027–T031 / T046–T048 / T063–T064（变异证据）、T035/T050/T068（复审记录）、T073（证据汇总核对） |
| **D9** | §3.1 的 L1 契约写明前提（已归一化 + 大小写与磁盘一致）；前提失效形态登记 **KL-6** | §3.1（L1 行契约栏）、§3.2 JSDoc、§3.7 KL-6 | T011（R1-9 红用例）、T022（注释写入前提与 KL-6） |
| **D10** | 撤下两处 over-claim：① §3.5 表第一行"结构上不可达"；② §10.3 的"结构上不可能一个说 fresh 一个说 stale" | §3.5 可达性栏（改为"可达"+ 反例说明）、§10.3 F193/F249/F254 行（改为弱表述）。**说明**：§11 全文经核查不含同形表述，故只改 §10.3 一处；tasks.md 中 T011/T013 沿用旧措辞的两处也一并改为"通常不可达但 EACCES 等形态可达" | T017/T020（任务描述措辞同步） |

### 补充登记（INFO，不改设计，已记进 plan）

| # | 内容 | 落点 |
|---|---|---|
| INFO-1 | `AUDIT_SCHEMA_VERSION` bump 连锁面多一处：除 `decision` 事件(589)、`decide` payload(608) 外还有 `caveat-annotation` 事件(723)；测试侧仅 2 处钉死 3（`graph-consumption-cli.test.mjs:1024/:1079`），**无入库 audit fixture** | §7 `AUDIT_SCHEMA_VERSION` 行；tasks T061 |
| INFO-2 | 全仓 SKILL 现**无任何 `$?` 检查**，exit 3 可见性 100% 依赖散文被遵守，属 prompt 级约束、无机械保障 | §4.5 第 5 条残余风险；§11 原则 XIII 论证 1 |
| INFO-3 | oracle 会对**目录路径**发问（`generic-language-skeleton-collector.ts:92` 对目录 dirent 也调 `isIgnored`），verdict 的输入契约须明确接受目录路径 | §3.1「verdict 的输入契约」段；红用例 R1-1 含一条目录输入 |
| INFO-4 | KL-1 与 L2 对**同一路径**给相反答案，决定因素是"文件在不在"——该分歧轴须作为契约的一部分说明 | §3.1「存在性依赖是契约的一部分」段 + §3.7 KL-1 备注 |

### 经复核站得住、本次修订**未动**的部分

- 缺陷 2 的 `runGit` 结构化返回与责任方区分（§4.1/§4.2）；`classifyChangeSet` required + throw（现 §4.6）
- 缺陷 3 的逐管线 `matchSemantics` 结构、`null` 第三出口、`node:path` 收窄式放宽与封闭等值断言（§5.1/§5.2/§5.4）
- R1 复核为真（`unknown` 走 `consume-degraded` 且抢在 freshness 之前短路）⇒ 拒绝走 unknown 的裁决
- §3.3 的退出码判别表（git 2.53.0 下只观测到 0/1/128；`--` 守卫有效；不加 `--no-index` 实证正确）
- §3.1 的换序论证（在盘且规则未命中 ⇄ 父目录被折叠 互斥）；F255 在盘用例族天然仍绿
- KL-1..KL-4 的登记纪律；§10.2 变异测试这个方法论选择本身
- `nextSteps` 通道本身可用（schema 为 `array of string`，无 `maxItems`/`pattern`，全仓无文案断言）
- 约 20 处 `createIgnoreOracle` 测试调用点的机械替换安全（`ignore-oracle.test.ts` 的 tmpDir 是非 git 仓 ⇒ 全走 L0）
