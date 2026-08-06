# Plan 修订指令（Phase 2 对抗审查后，编排器主线程裁决）

两个独立子代理从「静默降级面」/「护栏冲突与分叉构造」两个切入角对 `plan.md` + `tasks.md` 做了对抗审查。**下列每条的关键事实均已由编排器亲自重跑复核**，不是照单全收。以下裁决为**已定**，修订时不得推翻，只需落进 plan/tasks。

---

## 复核实证（主线程亲跑，作为修订依据）

```
# 1) 本仓图零离盘节点 —— P1 验收无判别力
nodes 6092  distinct fileParts 996  OFF-DISK 0  _reference nodes 0

# 2) lstat 跟随中间段 symlink —— §3.5 立论案例在自己的分层下走不到 L2
lstat('link_to_ign/f.ts')          => ON-DISK（中间段 symlink 被跟随）
git check-ignore link_to_ign/f.ts  => exit=128（拒答）

# 3) PATH 上的 spectra 是全局旧编译产物 —— T058 差分空转
which spectra    => /Users/connorlu/.volta/bin/spectra
spectra --version=> spectra v4.4.0 (0ae3eb7)     ← 非本 worktree 基线 19bff52a
```

---

## D1【必改】L1「在盘」判定改为 **errno 三分**，并新增 KL-5

**问题**：`lstatSync` 失败 ≠ 离盘。EACCES 目录下的文件 walk 枚举得到、`lstat` 却抛错，会被判离盘 → 落 L2 → 换成不同解的 oracle → **采集面文件集合可变**，`BEHAVIOR_VERSION` 不 bump 的论证随之失效。

**裁决**：
- `lstat` 成功 ⇒ 在盘
- `ENOENT` / `ENOTDIR` ⇒ 离盘，走 L2
- **其他一切 errno（EACCES / ELOOP / ENAMETOOLONG …）⇒ 直接 `undeterminable`**，**不得**当离盘

这样采集面在这些形态上保持「按 not-ignored 处理 = 旧行为」，`gitignore-interpretation` 责任项才真的未触发。

**同时新增 KL-5：在盘的 symlink 穿越**。`lstat` 对最后一段不跟随、对**中间段跟随**，所以 `link_to_ign/f.ts` 判在盘 → L1 → `not-ignored`，**静默、不计数**，永远到不了 L2。这是缺陷 1 原病的原样保留，plan 全文未登记（§3.7 的 KL-2 只写了「离盘时 L2 得 exit 128」，只覆盖半边）。

**连带**：§3.5 现在用「本仓 `_reference/**` 今日实测 exit 128，会把门永久判红」作为计数机制的立论——**该立论在新分层下不成立**（本仓图 0 个 `_reference` 节点、0 个离盘 filePart，`drainUndeterminable().count` 恒 0）。必须删除或改写这句，不得保留一个拿不出实证的论证。

**评估纳入（不是强制）**：预取清单里 `_reference` 是以**无尾斜杠的文件条目**出现的（symlink 被当文件列），所以进不了 `dirPrefixes`。一个成本很低的改良是：对预取清单里的条目，若其在盘为 **symlink 指向目录**，则同时登记为 dirPrefix。这能直接修好本仓最大的一棵被忽略子树。**要求 implement 阶段带证据判断纳入与否，不得静默略过**；不纳入须写明理由。

---

## D2【必改】P1 验收换成**可控 fixture**，禁用全局 `spectra`

**问题**：本仓图 996 个 filePart 全部在盘、零离盘，而离盘是缺陷 1 的**唯一**触发条件。`ignoredPathNodeIds` 实测为 0。因此「graph-only 重建后逐条判定新增 ignoredPathNodeIds 真/假阳性」这条验收**无论实现好坏都恒绿**，与实现质量无关。

**裁决**：
1. P1 的缺陷 1 验收改为可控 fixture：**建图 → 删除若干源文件（制造离盘节点）→ 不重建 → 直接跑 `graph-quality --json`**，断言这些节点按 `.gitignore` 规则正确进/不进 `ignoredPathNodeIds`。
2. 本仓实跑可以保留，但**必须标注为「零信息量的回归护栏」**，不得当作缺陷 1 的验收证据。
3. 所有验证命令里的 `spectra` 一律换成**本 worktree 的 `node dist/cli/index.js`**（或显式 `--spectra-bin` 指向本地 dist）。PATH 上的是 commit `0ae3eb7` 的全局旧产物。
4. plan §12 的 item 1/2 从「未知」改为**已测定**（数字见上方复核实证），并据此重写依赖它们的结论。

---

## D3【必改】`BEHAVIOR_VERSION` 差分实证必须能证伪自己

**问题**：T058 用单仓差分证一条全称命题——本仓不存在 EACCES 目录、不存在离盘节点，差分必然全等 → 标绿 → 版本号保持 → 所有既有图继续报 fresh。且忘记 bump 没有任何运行时守护会抓到。

**裁决**：T058 拆成两条，**两条都跑完且都无分歧才算实证成立**：
- (a) 本仓差分（确认向，用本地 dist 两侧各跑一次）
- (b) **构造反例仓差分**：至少覆盖 D1 列出的 errno 形态与嵌套 git 仓形态
- 任一条出现分歧 ⇒ **必须 bump `BEHAVIOR_VERSION`** 并重新校准 F249 / F193 / F217 三方判据。**不得为保持不 bump 而弱化实证口径。**

---

## D4【必改】三个新观测出口必须各自接上消费者

plan 对别人的静默降级审得很狠，自己新造的三个出口却一个消费者都没接。逐条裁决：

| 出口 | 现状（已核实） | 裁决 |
|------|---------------|------|
| `nextSteps`（承载 undeterminable 诊断） | `scripts/lib/graph-quality-core.mjs:115-215` 是 repo:check 侧唯一消费者，逐字段读 7 个字段，**全文无 `nextSteps`**；stderr 仅在 JSON 解析失败分支被采样；`Next steps:` 只在 renderText 路径，而验证命令走的都是 `--json` | **必须接上自动化消费者**：在 `graph-quality-core.mjs` 增一条 warn 级 check（如 `ignore-undeterminable`）。否则缺陷 1 在本仓最真实的形态上「修完等于没修」 |
| `scopeExtensionsSource` 新增 `static-fallback-malformed-fingerprint` | 全仓非测试消费点只有人读渲染与写审计；skills 一次都不读；审计只写不读 | 至少在畸形指纹时 **stderr 出一条 warn**；否则须在 plan 里如实降级为「事后取数字段」，**不得计入 R5 的修复交付物** |
| `decide-aborted` 审计事件 | 审计按 RG-006 只写不读 | **可接受**——exit 3 本身就是响亮信号，审计事件只作补充记账。无需额外消费者 |

---

## D5【必改】exit 3 的断链处置 + 预算 + 恢复口径

**问题**：§4.3 承认代价后写「处置见 §4.5」，但 §4.5（plan.md:258-271）讲的是 `classifyChangeSet` 的 required 入参，**与 abort 处置毫无关系**——承诺的处置在 plan 里根本不存在。叠加三条后果：
1. `SKILL.md:440-452` 的刷新预算是散文记账（轮 1 allowed / 轮 ≥2 declined）。abort 发生在矩阵求值之前、**没有刷新**，但按散文已算「用掉」→ 后续轮次恒 declined → 整个 phase 再不重建图。
2. §4.6 写死「MUST NOT 自行把 `phase_start_ref` 重记为当前 HEAD」，而 `resolvePhaseStartRef` 是纯读取无回退 → 一次 rebase 后该 phase 内三个调用点恒 abort，B4 grounding 整条通道永久失效。
3. base-ref 不可解析在本仓是**常规路径**（rebase 交付强制）。

**裁决**：
- 修好 §4.3 的断链引用，**补一节真正的 abort 处置**
- 明写 **abort 不消耗刷新预算**
- **给出恢复口径**：允许显式 `--base-ref` 覆盖 trace 锚点，或允许编排器在 abort 后显式重记锚点并在 trace 留痕作为**新的、可审计的**基线。没有恢复口径就等于把常规路径整条关掉，那是比原缺陷更坏的交付。
- §4.6 的 SKILL 更新文案须一并说明：abort payload 的封闭键集里**没有** `degradedReason` / `fallbackHint`，调用方读它们会得 `undefined`，日志不得记成 `undefined`

---

## D6【必改】零 I/O 纯函数契约的文件头纳入重写范围

**问题**：`src/panoramic/graph/quality/quality-engine.ts:9-11` 文件头声称「纯函数，零 I/O：所有需要外部信息的判定均通过 opts 注入的回调完成」，`legacy-ignored-check.ts:7-8` 同调。修复后注入的 `isIgnored` 变成**会起子进程 + 有内部可变状态（memo + undeterminable 累加器）**的闭包——同一份 graph 连跑两次可能给出不同结果。这是**新引入的性质变化**，而 T015 的注释重写范围不含这两个文件。

**裁决**：把 `quality-engine.ts` / `legacy-ignored-check.ts` 的文件头纳入注释重写范围，并对「注入回调现在会 spawn 且有状态」给出显式契约描述。不得让文件头留成假话。

---

## D7【必改】L2 预算要有**有名字的出口**

**问题（已核实）**：`graph-bootstrap-status.mjs:41` 的 `DEFAULT_FRESHNESS_DEADLINE_MS = 5000`；`check-ignore` 实测 ~5.85ms/次 ⇒ 约 **800 个**不同离盘路径即吃满 5s，freshness 直接翻成 `unknown-provenance`（`:457`）。而「离盘节点多」正是图陈旧时的典型形态，也就是 freshness 最该说话的时候。

§3.4 拒绝硬上限的理由是「截断会制造新的静默降级面」，但上限**已经存在于下游**，且转化成的是**判定翻转**而不是一条 warn。

**裁决**：给 L2 定一个与下游 5s deadline 相容的预算策略，并把「预算耗尽」做成一个**有名字的显式出口**（计入 undeterminable 并出声），而不是留给下游超时成 `unknown-provenance`。

---

## D8【必改】tasks 的可证伪性

**问题**：62 个任务里约 22 个验收标准是纯散文自证；变异测试 M1-M8 要求「确认变红后撤销」但**不要求登记证据**，撤销后 diff 里什么都不剩，事后无从复核是否真跑过；三个对抗复审 checkpoint（T024/T038/T055）无失败条件，零发现时恒成立。

**裁决**：
- 每条变异任务验收改为：**贴出变红用例的完整名称 + 断言失败输出前 5 行**，落进 `specs/258-fix-graph-truth-source-fidelity/verification/mutation-evidence.md`
- 三个对抗复审 checkpoint 补：复审记录必须列出实际检查的切入角与各自的具体查证动作，**零发现时须说明查了什么**
- `[CLEANUP]` 触发判定（T004/T025）改为**可他证的两遍法**：先写草稿测净增（附 `git diff --stat` 实数，不接受「预计」）→ 超阈值则 revert 草稿、先落搬运 commit、再重放改动。当前 tasks.md:46 写的「实测本次**预计**新增行数」自相矛盾且天然偏向不触发
- T060 末句「补一条 worktree 内 oracle 判定与主仓一致的用例」是一条**新测试**却藏在收官核对清单里——按 tasks 自己的 TDD 强制条款，须拆成有先红步骤的独立任务

---

## D9【必改】L1 契约的前提要写明（W4）

L1 是对 `git ls-files` 输出做**大小写敏感的字符串**查表，而 macOS 上 `core.ignorecase=true`。实测分歧（均落在**在盘**分支、静默、不计数）：

```
IGNORED_DIR/f.ts    ORACLE=not-ignored   GIT=ignored
./ignored_dir/f.ts  ORACLE=not-ignored   GIT=ignored
```

今天 node id 由 `path.relative` 产出所以不可达，但 §3.1 那一栏写的是**无条件**的「否则 `not-ignored`」。

**裁决**：§3.1 的 L1 契约必须写明前提——「要求输入路径已归一化、且大小写与磁盘一致」；并把该前提失效的形态登记进 KL 表（KL-6）。不得保留笼统的无条件表述（那正是本 fix 要删掉的那类 over-claim 的同形物）。

---

## D10【必改】撤下两处 over-claim

1. §3.5 表第一行「结构上不可达」——被 D1 的 EACCES 反例证伪
2. §10.3 / §11 里「F193/F249/F254 判据输入不变 ⇒ **结构上不可能**一个说 fresh 一个说 stale」——判据输入确实没变，但推不出「不可能矛盾」：(a) freshness 会因 graph-quality 超时翻成 `unknown-provenance`（D7），(b) KL-4 自己就是 fresh/翻转并存的案例。改成如实的弱表述。

---

## 经复核**站得住**、修订时不要动的部分

- 缺陷 2 的 `runGit` 结构化返回与责任方区分（§4.1/§4.2）；`classifyChangeSet` required + throw（§4.5）
- 缺陷 3 的逐管线 `matchSemantics` 结构、`null` 第三出口、`node:path` 收窄式放宽与封闭等值断言（§5.1/§5.2/§5.4）
- R1 复核为真（`unknown` 走 `consume-degraded` 且抢在 freshness 之前短路）→ 拒绝走 unknown 的裁决成立
- §3.3 的退出码判别表**完整**：git 2.53.0 下只观测到 0 / 1 / 128 三种；`--` 守卫有效；不加 `--no-index` 的裁决实证正确（tracked + 规则命中 → exit 1 豁免）
- §3.1 的换序论证（在盘且规则未命中 ⇄ 父目录被折叠 互斥）在所有构造形态里未被证伪；**F255 在盘用例族天然仍绿**
- KL-1..KL-4 的登记纪律；§10.2 变异测试这个方法论选择本身
- `nextSteps` 通道本身可用（schema 是 `array of string`，无 `maxItems`/`pattern`，全仓无文案断言）
- T014「约 20 处机械替换」安全（`ignore-oracle.test.ts` 的 tmpDir 是非 git 仓 ⇒ 全走 L0 近似分支，行为与今天逐字节一致）

## 补充登记（INFO，不必改设计，但要记进 plan）

- `AUDIT_SCHEMA_VERSION` bump 的连锁面比 plan 写的多一处：除 `decision` 事件(589) 与 `decide` payload(608) 外，还有 **`caveat-annotation` 事件(723)**。测试侧只有 2 处钉死 3（`graph-consumption-cli.test.mjs:1024 / :1079`），无入库 audit fixture
- 全仓 SKILL 现在**一处都没有 `$?` 检查**；exit 3 能否被看见 100% 取决于 §4.6 的散文更新被真的遵守，属 prompt 级约束、无机械保障——须在 plan 的风险节如实登记
- oracle 会对**目录路径**发问（`generic-language-skeleton-collector.ts:92` 对目录 dirent 也调 `isIgnored`）；§3.1 的表应补一行明确 verdict 的输入契约是否接受目录路径
- KL-1 与 L2 对**同一路径**给相反答案，决定因素是「文件在不在」——这个分歧轴 plan 从头到尾没作为契约的一部分说明，须补
