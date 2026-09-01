# F278 编排器独立验证记录（Phase 4.5，编排器亲自执行）

> 本文件是编排器自己跑出来的证据，不是子代理自我报告的转录。
>
> ⚠️ **本卡经历了两轮返工**（三路异构对抗复审 → 项④ 3 CRITICAL / 项②③ 1C+7W → 返工 →
> spec-review + quality-review → 收尾批次）。**§1 与 §2 的数据是最终一轮**，
> 附录 A 记录逐轮处置。早期版本的本文件曾停留在返工前那一轮数据（vitest 8042 / doctor.mjs 215 行），
> 该失真由 spec-review 在 Phase 5a 抓出并已修正——这条本身也是一条留痕：
> **"编排器亲跑的证据"若不标注轮次，同样会说假话。**

## 1. 全量门禁（**收尾批次合流后的最终一轮**，2026-09-01；本卡共跑 4 轮全量，用例数 8042→8048→8050，无失败项出现或消失）

第一轮跑用了 bash 的 `$PIPESTATUS`，在 zsh 下取不到退出码（zsh 是 `$pipestatus`），
因此**重跑一次只采退出码** —— 本仓有 F235/F269「测试全过但进程 exit 1」的 birpc 假红先例，
只看输出不看退出码是不够的。

| 命令 | 退出码 | 结果 |
|------|-------|------|
| `npx vitest run` | **0** | `Test Files 545 passed \| 4 skipped (549)`；`Tests 8050 passed \| 15 skipped \| 12 todo (8077)`；0 failed |
| `npm run test:plugins` | **0** | `tests 1717 / pass 1715 / fail 0 / skipped 2` |
| `npm run build` | **0** | `tsc` 通过 |
| `npm run repo:check` | **0** | 22 项检查全 pass，1 warning（见下） |
| `npm run release:check` | **0** | `Release contract valid`，1 info（见下） |

两条非零信号均为**开工前既存、与本卡无关**：

- `[graph-quality] freshness: warn` —— 图产物 stale（图记录 sourceCommit `25992316` vs HEAD `e01611b2`）。
  F272 合入后一直存在，本卡未触碰任何图产物。
- `[publish-gap] 发布断层领先量无法判定（sourceStatus: indeterminate）` —— npm registry 返回体缺
  `gitHead` 字段，与本卡无关。


## 2. 变更面（`git diff --numstat`，最终一轮）

| 新增 | 删除 | 文件 | 归属 |
|---|---|---|---|
| 453 | 5 | `plugins/spec-driver/scripts/judge-snapshot-doctor.mjs` | 项④ |
| 462 | 14 | `plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs` | 项④ |
| 225 | 2 | `scripts/regen-collector-fingerprint-fixtures.ts` | 项②③ |
| 34 | 2 | `src/mcp/agent-context-tools.ts` | 项① |
| 43 | 0 | `tests/fixtures/collector-fingerprint-guardrail/README.md` | 项③ |
| 214 | 0 | `tests/integration/collector-fingerprint-regen-script.test.ts` | 项③ |
| 210 | 1 | `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` | 项② |
| 51 | 0 | `tests/unit/mcp/agent-context-tools.test.ts` | 项① |
| 37 | 1 | `docs/design/dogfooding-feedback-ledger.md` | dogfooding 落账（5 条） |

**「既有用例一字未改」的精确口径**（早期版本这句说过头了，spec-review 要求用 `--numstat` 复核）：

- `tests/integration/collector-fingerprint-regen-script.test.ts`、`tests/unit/mcp/agent-context-tools.test.ts`、
  fixture README —— **零删除**，纯新增。
- `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` —— **1 行删除**，是收尾批次 B5 把一条
  `it` 名改成能反映三维度与 FR 归属的名字（该用例现同时承担 FR-009 活性证明），断言未动。
- `plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs` —— **14 行删除**。首轮是 4 行
  （给两个 helper 加 `fileSet` 默认参数：2 处签名 + 1 处循环 + 1 处调用）；收尾批次 A2 按质量审查 W-6
  把顶部那份与 core 导出**逐条同序完全相同**的硬编码 `JUDGE_FILE_SET` 副本连同该参数一并删除
  （16 行副本 + import 合并），helper 恢复原签名。**既有用例的断言与行为全程一字未改。**

**未被写入的关键文件（`git diff` 行数逐条实测 = 0）**：
`plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs`（FR-013，与 F276 的撞文件面）、
`src/panoramic/graph/collector-fingerprint.ts`（`BEHAVIOR_VERSION` 保持 3）、
`src/mcp/file-nav-tools.ts` / `graph-tools.ts` / `server.ts`（FR-004 / Out of Scope）、
`tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json` 与
`expected-module-graph.json`（两份 pinned 资产全程未被重生成）。

## 3. 审计 sidecar 的入库可达性（编排器实测）

```
$ git check-ignore -v tests/fixtures/collector-fingerprint-guardrail/regen-audit.jsonl
（无输出，exit=1 = 未被忽略）
```

`.gitignore` 里唯一的 `*.jsonl` 相关规则是 `.specify/graph-consumption-audit.jsonl`（不同路径）。
→ D3.5「审计记录入库」的前提成立；不会重演 memory 里 `gitignore 的 dist/ 会吞 fixture` 那类坑。

仓库中**没有**预先创建 `regen-audit.jsonl` —— 按 D3.5，它只由将来第一次真实 `--init` 自动创建，
本卡不伪造任何"历史补记"条目。

## 4. `graph-not-built` 恢复提示一致性核对（M10 §5 P1-E 登记项）→ **裁决：登记为已知残留，本卡不改**

用户要求"能顺手对齐就对齐，改不动登记"。实读全仓四处（不是三处）后的事实：

| 位置 | message | hint 首词 |
|---|---|---|
| `agent-context-tools.ts:131`（缺图） | `graph 未构建` | `请先运行` |
| `agent-context-tools.ts:151`（**其他加载失败**） | `graph 未构建` | `请先运行` |
| `file-nav-tools.ts:140` | `graph 未构建` | `请先运行` |
| `graph-tools.ts:183` | `图谱未构建或加载失败` | `优先运行` |

（另有两处 `graph-format-stale` 的 hint 也有 `请运行` vs `优先运行` 的措辞分叉。）

**不做的理由（不是"没空"）**：这四处的差异**不是排版分叉，是一个诚实性判断**。
`agent-context-tools.ts:151` 那处的代码注释自己写着"其他加载失败"，但 message 仍报
`graph 未构建` —— 也就是说**分叉的两边里，读起来更整齐的那一边（`graph 未构建`）恰恰是不够诚实的那一边**，
而 `graph-tools.ts` 的 `图谱未构建或加载失败` 才如实覆盖了两种成因。

"对齐"因此必须先回答"哪一边是对的"，那是 P1-E 产品表面清扫 / F266 诚实返回面的裁决范围，
不是本卡（FR-004 已把这三个文件明确划出范围）能顺手带走的。强行统一到更整齐的那一版，
等于用一次清扫把一处诚实退化固化下来。

**登记**：M10 §5 P1-E 的该条目保持未处理，并补充上述"分叉两边诚实度不对等"的事实，
供 P1-E 立卡时直接使用。测试耦合面很浅（`图谱未构建或加载失败` 全仓仅 1 处即源码本身；
`graph 未构建` 仅 `tests/unit/mcp/agent-context-sanitize.test.ts` 钉住），改动成本不是障碍——障碍是裁决本身。

## 5. SC-004（不带 `--since` 输出逐字节不变）—— 三层同向证据

**判据本身被换过一次，这里如实记录。** spec/plan 原写的判据是「输出 sha256 等于 `8b622782…`」，
该常量在会话中途失效：`.specify/.spec-driver-path` 由 `4.4.0` 变为 `4.5.0`，
doctor 报告含本机绝对路径与安装态，`status` 也由 `drift` 变为 `in-sync`。
返工子代理如实反驳并换用**同时刻 A/B**，编排器复核后确认**反驳成立、我的判据错了**
（plan D4.5 自己就写明"基线必须同环境采"，钉死一个绝对值快照与该约定直接冲突）。

### 第一层：结构性（可读代码看穿）

`formatReport` / `formatFileDetails` / `formatSummary` / `HEADER` 四处**函数体一行未改**
（`git diff -U0` 对这四个名字的命中全部落在**新增**的 `formatSinceSection` 与 `main` 的调用点上）。
`--since` 区块是独立函数的返回值，由 `main` 在 `formatReport` 结果之后拼接；不带 flag 时新代码根本不执行。

### 第二层：同时刻 A/B（编排器亲自跑，覆盖 `parseArgs` 全部出口）

`git show HEAD:…/judge-snapshot-doctor.mjs` 写到同目录临时 `.mjs`，与当前实现在同一时刻各跑一次：

| 入参 | 退出码(旧/新) | stdout | stderr |
|---|---|---|---|
| 无参数（`status: in-sync` 态） | 0 / 0 | IDENTICAL | IDENTICAL |
| `--project-root <空目录>`（`not-applicable` 态） | 0 / 0 | IDENTICAL | IDENTICAL |
| `--project-root` 缺值 | 1 / 1 | IDENTICAL | IDENTICAL |
| 未知参数 `--bogus`（**该路径因新增 `--since` 分支而被改动**） | 1 / 1 | IDENTICAL | IDENTICAL |
| `--project-root --bogus` | 1 / 1 | IDENTICAL | IDENTICAL |

### 第三层：既有用例

`S5 对照组`断言不带 `--since` 时输出不含增量区块；`judge-snapshot-doctor.test.mjs` 17 条既有用例零回退。

### 诚实的覆盖面声明

`formatReport` 四态中，**drift/in-sync 与 not-applicable 两态已做逐字节 A/B**；
**两个 `indeterminate` 态未做 A/B**（构造它们需要 env 与安装态外科手术，CLI 入参无法直达），
由第一层结构性论证与既有片段级用例兜底。
**因此正确表述是「零参数与四组异常入参已 BYTE_IDENTICAL；两个 indeterminate 态未做 A/B」，
不是「逐字节一致已全面验证」。**

## 6. 编排器独立复跑的插件测试（返工后）

```
node --test plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs → tests 39 / pass 39 / fail 0
node --test plugins/spec-driver/tests/judge-snapshot-doctor.test.mjs     → tests 17 / pass 17 / fail 0
```

---

# 附录 A：异构对抗复审与返工（编排器裁决）

按 CLAUDE.local.md 暂停期档位，本卡跑了 **3 路独立子代理异构对抗复审**（项④ 一路 + 项②③ 两路不同切入角）。
**Codex 审查暂停，异构档位缺席。**

## A.1 项④ 首轮被判「不能上线」（3 CRITICAL），已返工

| 编号 | 问题 | 状态 |
|---|---|---|
| C-1 | `rev-parse --verify --quiet <sha>:<path>` 对「路径不存在」与「对象库不可读」返回**完全相同**的信号（exit 1 + stderr 0 字节），两步探针的结构性论证是假的。端到端复现：删掉 baseline 子树对象后，一条**本次引入**的漂移被判 `pre-existing`，另 7 个文件凭空判 `resolved`，exit 0、stderr 空。触发面还包括离线 partial clone 与 git 被 SIGKILL（`status:null` 未被穷尽） | **已修**：预检期 `git ls-tree -r -z --full-tree` 一次性枚举基线子树，「缺席」只从清单判定；新增 `classifyGitResult` 把 `error`/`signal`/`status` 非数字/`status!==0` 四态全部归入 fatal |
| C-1b | 代码注释把 fail-open 的**方向写反了**（说会「谎报成本次新引入」）。实际 `deriveDelta` 要求 `baselineStatus==='match'` 才可能出 `introduced`，被强转成 missing 的基线**永远出不了 introduced**，只会出 `pre-existing`/`resolved` —— 真实方向是**替本次改动开脱**，而防线正是照着想错的方向搭的 | **已修**（注释改正） |
| C-2 | fail-open 方向零测试守护：4 个 fail-open 向变异体全部 0 红（含「把 `introduced` 一律改判 `unchanged`」）。根因是 S3/S4 两条 E2E 都以 `当前 match` 收尾，**从没有用例产出过 `introduced` 行** | **已修**：补基线不可读 / 真实 introduced / spawn 失败三类用例；16 变异体杀 15 |
| C-3 | FR-015(b) 未实现：「该 ref 下新增的文件」判成 `pre-existing`，旁注 `absentAtRef` **被汇总行整个吞掉**。复现用的正是本仓最常见场景（往 `JUDGE_FILE_SET` 加文件，F246/F270 近期 4 次） | **已修**：新增 `added-since` 进入词表与汇总行；派生表重画并逐格单测 |
| W-1 | `git -C` **不覆盖 `$GIT_DIR`**：非 git 目录 + 注入 `GIT_DIR` → exit 0 + 完整报告，基线取自另一个仓库。git hook 恒导出 `GIT_DIR` | **已修**：`runGit` 逐个 delete 六个 git env 键 |
| W-2 | 40 位 hex 守卫在 `--object-format=sha256` 仓上误拒（64 位），且该「承重」守卫零测试 | **已修**：放宽为 40 或 64 位，补空串/畸形单测 |
| W-5 | 快照侧被读两遍的 TOCTOU 窗口 | **已修**（结构性：只读一次）。子代理**诚实登记**该修复无测试守护——TOCTOU 需排程依赖的 flaky 构造才能复现，没有为了凑绿编假并发用例 |

### 编排器对三处「超出返工清单」改动的裁决

1. **仓库根守卫（新增）—— 采纳**。`<sha>:plugins/spec-driver/…` 相对**仓库根**解析，而当前侧读
   `<projectRoot>/plugins/spec-driver/…`；`--project-root` 指向子目录时两侧读的是**不同目录**，
   与 W-1 同型的 fail-open，原实现无守卫。代价是从子目录跑 `--since` 由「产出报告」变成 fail-loud，
   而 `npm run judge:doctor` 的 cwd 恒为包根，无实际回归。报错文案会直接给出仓库根路径。
2. **gitlink（`type !== 'blob'`）分支补测 —— 采纳**。纯测试新增，把原本零测试的 fatal 路径钉住。
3. **plan.md D4.2 顶部加「已被证伪、实现未采用」提示 —— 采纳**。原授权只允许改 D4.1/D4.6，
   但 D4.2 的「exit code 层面的结构性区分」正是被证伪的那个假前提，留着会让下一个人照它继续加固。

### 编排器对子代理反驳的复核：**反驳成立，我的判据错了**

我给返工任务钉的 SC-004 判据是「输出 sha256 必须等于 `8b622782…`」。子代理指出该常量已不可复现，
因为 **会话中途 `.specify/.spec-driver-path` 从 `4.4.0` 变成了 `4.5.0`**（快照目标改变，`status` 也从
`drift` 变成 `in-sync`）。plan D4.5 自己写明「报告含本机绝对路径、`resolutionSource` 依赖本机安装态，
基线必须同环境采」——钉死一个 sha256 常量与该约定直接冲突。

**编排器独立复验（同时刻 A/B，比钉常量更强）**：
```
git show HEAD:…/judge-snapshot-doctor.mjs > …/.f278-baseline-doctor.mjs   # 改动前实现
node .f278-baseline-doctor.mjs           > /tmp/f278-ab-old.txt   exit=0
node judge-snapshot-doctor.mjs           > /tmp/f278-ab-new.txt   exit=0
diff → BYTE_IDENTICAL(stdout) + BYTE_IDENTICAL(stderr)
```
→ **SC-004 达成**。

### 编排器独立复跑（不转录子代理自报）

```
node --test plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs → tests 39 / pass 39 / fail 0
node --test plugins/spec-driver/tests/judge-snapshot-doctor.test.mjs     → tests 17 / pass 17 / fail 0
```

## A.2 项②③ 两路异构对抗复审（切入角：绕过构造面 / 假绿 fail-open 面）——1 CRITICAL + 7 WARNING

两路各自做了**实跑变异测试**（不是心智推演）。角一 11 个变异体杀 4 存活 7；角二在真资产上做单点变异。
代码注释里出现的 `A1/A2/A3/A6/A7/B1/B2/B3` 编号即下表左列。

| 编号 | 问题（附实跑证据） | 状态 |
|---|---|---|
| **C-1** | `<non-object:*>` 折叠进 `<absent>` → **42 用例全绿，且护栏对一个真退化返回 `mismatch=false`**（pinned 侧 metadata 缺席 vs 重建侧 `metadata=null`）。本轮唯一的**静默放行** survivor | **已修** → 补用例 **A2**（`null` vs 缺席，断到 `<non-object:null>` 完整子串） |
| **W-1（角一）** | FR-007 的**语义**无守护：M3 守的只是 `<absent>` 字面量。反方向变异（把 `{}` 也塌缩成 `<absent>`）→ M1/M2/M3 全绿存活，FR-007 判别力被彻底毁掉而无人察觉 | **已修** → 补用例 **A1**（`{}` vs 缺席，两态在文案上直接可辨） |
| **W-4（角二 V5）** | `missing`/`extra` 算反 → **全绿**。M1 断的是 `toContain('lineRange')`，而对调后 `lineRange` **只是换了个格子**，断言无感 —— 对护栏来说方向就是全部信息量 | **已修** → **A3**：M1/M2 断言收紧到含格子的完整子串（`重建缺失 [lineRange]` / `重建新增 [__mutantKey]`） |
| **W-5（角二 V4）** | 删 `Object.keys().sort()` → **全绿**；而删了之后护栏不是变松是变成**假红发生器**（22 个节点全部误报），文案还退化成 `[] vs []` 空壳 | **已修** → 补用例 **A4**（逐节点重排 metadata key 插入顺序 → 断言判一致） |
| **W-1（角二 V7）** | 去掉 `appendRegenAudit` 的 `try/catch` → **16 用例全绿**，实际会造出注释里写明要避免的「脚本报失败但资产已是新内容 → 重跑被 C-002 拒绝 → 卡死」 | **已修** → 补用例 **A5**（把审计路径占成目录制造 EISDIR → 断言 exit 0 + 资产已更新 + stderr 有 warning） |
| **W-3（角二 V8）** | 删 `if (init)` 守卫 → **全绿**，常规再生会写出 `trigger:"--init"` 的**字面撒谎**记录（FR-021 零守护） | **已修** → **A6**：在既有「指纹已 bump → 放行重写」用例末尾断言审计文件不存在 |
| **W-2（角二 V6）** | 审计调用挪到 swap **之前** → A1/A2 全绿，实际会给一次**零产物**的失败运行留下完整假留痕 | **已修** → **A8**：不碰生产代码签名，改用 `chmod 555` fixture 根目录构造 swap 失败（POSIX 下新建条目需目录写位、向已存在文件 append 不需要 → 这就是鉴别力来源），并对 `getuid()===0` 显式跳过避免假绿 |
| **I-2（角二）** | metadata 维度缺**端到端**（脚本层）覆盖：三条既有拒绝用例扰动的都是节点/边 | **已修** → **A7**（metadata-only 漂移走常规再生拒绝路径的端到端用例） |
| **W-2（角一）** | **over-claim，本卡引入**：审计账本在第一次常规再生后就说假话（`--init` 记 `8e00f288` / 常规再生把资产换成 `a80c0610` 而账本无过期标记），而 README 承诺的恰是"磁盘上这份基线是哪一次生成的" | **已修（诚实化，不扩范围）** → **B1**：README + JSDoc 改成"记的是**冷启动建基线事件**，不代表磁盘现状"，并给出可判定用法（账本末行 `fixtureInputHash` 与资产比对：相符 ⇒ 就是那次建的；不符 ⇒ 其后发生过常规再生）。该字段因此从"可能撒谎的断言"变成"可自检的锚" |
| **W-3（角一）** | **本卡引入的陷阱**：新维度会拒绝一类权威清单判定为「不该 bump」的改动（F271 的 lineRange 即是），而拒绝文案指向"先 bump"→ 维护者只剩"做一次按清单为错的 bump"或"`rm + --init` 全绕过"两条路 | **已缓解（文案层）** → **B2**：不动被 6 处测试钉住的 `selectRegenDiagnostic` 签名与文案，改为在拒绝分支按 `startsWith('metadata ')` 追加维度专属指引，README 同步写死三步处置路径 |
| **I-3（角二）** | 富诊断分支从 `JSON.parse(signature)` 反解 key 数组，使 `.sort()` 从"锦上添花"变成 `missing/extra` 语义的**前置条件** | **已修** → **B3**：分组时一并保留 keys，诊断分支直接持有两侧 key 数组 |
| **C-1（角一）** | 比较器只读 `nodes[].id` / `links[]` / `metadata` key，**`node.kind` 与 `node.label` 零检测力**。`specs/250-pyi-symbol-surface/trace.md:133` 实证：F250 改了 `label mod.pyi→mod` 而 a-track 报 `contentMismatch=false`，**该 false 还被当成「节点结构零变化」的阳性证据引用过** | **登记，另立卡**（**既有盲区，非本 diff 引入**；本卡范围是 FR-005 划定的"metadata 顶层 key 集合"）。登记词条须带 F250 实证——它是**已发生的假阴性被当阳性用**，优先级不同于其余三族 |
| **W-5（角一）** | 只比 key 不比值的盲区比 FR-008 论据说的宽：8/8 全部静默，其中 `lineRange` **内层改名** `{start,end}→{from,to}` 与 F271 原始病**同构、只是下沉一层** | **登记，同上卡**（递归 key 路径签名；仍属"只比 key 名不比 value"，不违反 FR-008 意图） |
| **I-1/I-4（角二/角一）** | 计数不等的 id 自身的 metadata 漂移会被吞（整体仍判红，非 fail-open，方向是"更红"）；比较器完全不看 `graph.graph`（清空整个 `graph.graph` → diffs=0） | **登记，同上卡**（`graph.graph` 那族须钉住「`builder` 字段必须继续排除」——见 fixture README 的 `"builder": null` 一节） |

### A.2.1 两角对 FR-007 的结论**看似矛盾，实为两个方向**（值得留痕）

角二报 `V2（<absent> → '[]'）` 被 M3 杀死、判「FR-007 有守护」；角一报「`{}` 塌缩成 `<absent>`」全绿存活、
判「FR-007 无守护」。二者都对：M3 的断言是 `toContain('<absent>')`，
对**保留** `<absent>` 输出的那个方向没有鉴别力，而没有任何用例把 `{}` 与 `undefined` **直接对上**。
返工同时补了 A1（`{}` 侧）与 A2（`null` 侧）两条，两个方向才都被钉住。
**教训**：单角复审得出的「有守护」结论可能只覆盖了变异空间的一半。

## A.3 Phase 5 审查（spec-review + quality-review）

- **quality-review**：0 CRITICAL / 6 WARNING / 6 INFO。采纳其中 8 项进收尾批次（文件头「6 个」腐烂数字、
  测试硬编码 `JUDGE_FILE_SET` 副本与只为保住它而存在的 `fileSet` 参数、20 行 stderr 指引提函数、
  JSDoc 与 README 逐字重复、对已删注释的引用、可消的类型断言、`sameDirectory` 位置、对齐魔数）。
  **不采纳其"补 `/* v8 ignore */` 标记"的建议**——它自己核实了 `scripts/` 不在 `vitest.config.ts` 的
  coverage include 内，标记在那里是纯装饰且会误导为"覆盖率政策豁免"而非"逻辑上不可达"。
- **spec-review**（首次派发因该子代理 frontmatter 无 Bash 工具而无法取证，改用**编排器预跑注入**证据包）：
  抓出本卡最严重的诚实性问题——**本文件 §1/§2 停留在返工前那一轮数据却自称"编排器亲跑的证据"**，已按其
  意见重写并加轮次标注；另抓出一处实质验收缺口 **FR-006 的「重复 node id」multiset 分支全仓零测试引用**
  （spec US2 AS-2 点名的场景，把该段换成 `continue` 不会有任何用例变红），已进收尾批次补测。

### A.3.1 对两条"登记而非修"的理由收紧（按 spec-review 意见）

- **`collector-fingerprint.ts` 的 F271「故不 bump」留痕未覆盖新拒绝路径**：不再标为"范围外"——
  Out of Scope 划出去的是 **bump 本身**，不是整个文件，补一句注释在本卡权限内、成本一行。
  正确表述是：**「本卡新行为造成的口径缺口，风险已由再生脚本的维度专属指引 + fixture README 双重闭合；
  SSoT 侧一行注释补记延后至下一卡，理由是不愿在 verify 之后再动一个采集面 SSoT 文件」**。
- **`--since` 的 git 基线读取层外提到 `scripts/lib/` 新文件**（FR-013 只禁**改** core、不禁**新建**）：
  本轮不做的理由是"重构后的版本将失去三路对抗覆盖"（本仓教训：审查轮引入的新代码必须再审，F244 delta 轮又抓 1C）。
  但该理由**只对本轮有效**，否则会变成一张无限期免检牌。登记为**带条件的欠账**：
  **下一次触碰 `judge-snapshot-doctor.mjs` 的卡必须一并完成外提，且外提后重跑对抗审查。**
