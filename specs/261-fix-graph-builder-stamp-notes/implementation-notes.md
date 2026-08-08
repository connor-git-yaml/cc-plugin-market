# 实施进度快照 — F261

> 覆盖写文件（非流水账）。恢复方以本文件的当前状态为准。

## 当前 Phase

`Phase 8（第五轮：Phase 4c 复审 W-1 收口）/ 共 8` — 六个必填字面量的断言全部由裸子串收紧为
bullet 结构锚，12 组变异（Round A/B 各 6）实证守护力，五项验证全绿。

## 已完成任务 ID

T001-T033（第一轮）；第二轮 F1-F8；第三轮 D1-D5；第四轮 D6 + 复审 A-W1/A-W2/A-W3/A-I1/A-I3/B-C1/B-C2/B-W1/B-W2（见「第四轮」两节）；
第五轮 W-1（见文末「第五轮」一节）。

## 下一步

五项验证已全绿，交由**主编排器**提交（本子代理无 git 写权限）。本轮改动仅
`tests/unit/spec-driver-implement-notes-contract.test.ts`、`plugins/spec-driver/agents/implement.md`
与本文件三个；`src/**` 零改动。

## 待裁决项

**已清零** —— 第三轮遗留的 C1（`community` 把 `unrecognized` 塌成 `unstamped`）已由第四轮裁决 D6
处置完毕；遗留风险 2（plan.md 与实现背离）已按裁决就地批注。第四轮新登记的残余项均为「已知并接受」
性质（见文末「第四轮 · 残余风险（复审后刷新）」）。

**但有两处需主线程知悉**（不阻断，仅需确认口径）：
1. 复审 A-W1 迫使我把保留通道的判据从"可解析"改成"**覆盖无损**"——这**超出 D6 的字面口径**
   （裁决只规定"不可解析时原样不动"），但严格服从 D6 的立论（"旧版本无权抹掉更新版本写入的内容"），
   否则 D6 在**唯一会真实发生**的演进路径上被绕过。代价是**第二轮 A-W1 的磁盘侧要求被反转**
   （外来 `builtAtIso` / 绝对路径现在会留在磁盘上，安全性改由消费侧独立承担）。
2. 复审 B-C2 属**范围外补救**：四个 provenance 调用点的声明字面量此前零护栏（含"伪造 provenance"
   这一立项要抓的形态），而代码注释声称有覆盖。我补了 3 条调用点用例并把注释改为如实表格。

---

# 第二轮处置（对抗复审发现 F1-F8）

## 修复前实证复现（全部用真 dist `0d3e385f` 实跑，非推演）

| 发现 | 构造 | 修复前实际输出 |
|------|------|----------------|
| F1 | `graph.sourceCommit = 123` + 合法 builder | `✗ 错误: 致命错误: sha.slice is not a function`，**exit 2**；删掉 builder 键则 **exit 0** ⇒ 确为本特性引入的回归 |
| F2 | `sourceCommit = null` + `builder.commit === 当前 HEAD` | `[builder] 7f71eb9 (...) — 与 sourceCommit=null 不一致：本图由与源码树不同版本的编译产物写出`（纯假陈述：两者其实同源） |
| F3a | `builder.commit = ESC[2J ESC[H`（恰 7 字符） | `[builder] ^[[2J^[[H ...`（`cat -v` 显形）—— 控制字符原样进 stdout，真终端会清屏 |
| F3b | `commit = "/Users/alice/secret @ 2026-08-08T09:00:00Z"`、`distSha256 = "/abs/path/to/dist"` | 原样被 `parseGraphBuilderStamp` 接受并渲染（`[builder] /Users/ ...`）⇒ 路径 / 时间戳在**值**层面完全敞开 |
| F4 | 磁盘 `builder.commit = deaddead…` → 跑 `spectra community` | builder 被无声改写为 `0d3e385f…`（当前 dist）⇒ provenance 洗白 |

## F4 前置实证（"是否存在载入既有图再回写的重建链路"）

**结论：只有 `community` 一条。** 依据（全部为实查，非推断）：

1. `writeKnowledgeGraph` 的全部调用方共 4 处：`cli/commands/community.ts:99`、`cli/commands/graph.ts:204`、
   `batch/batch-orchestrator.ts:1510`、`batch/stages/graph-assembly.ts:265`。
2. 后 3 处写的都是 `buildKnowledgeGraph(...)` **当场新建**的对象；`buildKnowledgeGraph`
   （`graph-builder.ts:496-512`）的 `graph` 字面量里**没有** `builder` 键 ⇒ `'builder' in graph` 为 `false`
   ⇒ 新建图必被注入，不受"仅缺席才注入"影响。
3. 全仓搜 `src` 内一切读取 graph.json 的位置（`readFileSync` + `resolveGraphJsonPath` 两轮 grep）：
   `graph-query` / `direction-audit` / `graph-quality` / `export` / `readme-graph-section` / `kb ingest` /
   `hook-installer` / `qa` / `mcp/graph-tools` / `cli/query` **全部只读不回写**，唯一"读盘 → 回写"的是
   `community.ts:61 → 99`。
4. batch 增量路径（`regenPlan.incremental` → `DeltaRegenerator`）作用于 **spec 产物**，图侧仍走
   `buildKnowledgeGraph` 全量重建（`batch-orchestrator.ts:1301`）⇒ 不存在"陈旧 builder 被永久冻结"的通道。
   修复后另有真 dist 连跑实证（见下方「修复后对照」）。

## 处置进度

| 发现 | 状态 | 落点 |
|------|------|------|
| F1 | 已修 | `graph-quality.ts:short()` 入参放宽到 `unknown` + 显式类型判定 |
| F2 | 已修 | `describeBuilderStamp` 新增**第三态**「图未记录 sourceCommit，无从比对」；文案里"一致/不一致"两词均不出现 |
| F3 | 已修 | `parseGraphBuilderStamp` 加值域正则 `COMMIT_VALUE_PATTERN` / `DIST_SHA256_VALUE_PATTERN`；文件头把"key 集合宽松"与"值域严格"拆成两条论证 |
| F4 | 已修（**修法在复审后再次收紧**，见 C-2）| `writeKnowledgeGraph` 改为按调用方声明的 `builderProvenance` 处置；`GraphBuilderStamp` 语义措辞订正 |
| F5 | 已修 | `LOAD_TIME_STAMP` 模块加载期常量；残余窗口如实登记 |
| F6 | 已修 | `builder-stamp.test.ts` 改用 `fileURLToPath` |
| F7 | 已修 | flags 文案改 `(build 时: 工作树 dirty=…, build 输入 sourceDirty=…)` |
| F8 | 已登记 | `builder-stamp.ts` 文件头 + 本文件 + fixture README + regen 脚本头 |

### 红先行证据（先证明用例能抓住旧行为，再修）

修改前 5 文件批实跑：`Test Files 5 failed (5)` / `Tests 28 failed | 38 passed (66)`。
28 条红分布：F3 值域 15 条、F1/F2 5 条、F5 3 条（含"事后出现的 meta 不追认"）、F7 1 条、
F4 2 条（`graph-builder.test.ts` + `community-persist.test.ts`）、F3 消费侧 2 条。
修复后同批：`Test Files 5 passed (5)` / `Tests 66 passed (66)`。
CLI 侧 F1 不变量（真子进程）：`tests/integration/graph-quality-cli.test.ts` `40 passed`。

### 修复后对照实跑（真 dist，构造与修复前逐条一一对应）

| 发现 | 修复后实际输出 |
|------|----------------|
| F1 | `Overall Verdict: pass-with-warnings` + 完整报告，**exit 0**（与"无 builder"对照组逐字相同）；无 `sha.slice` |
| F2 | `[builder] 7f71eb9 (build 时: …) — 图未记录 sourceCommit，无从比对`（不再断言不一致） |
| F3a | `[builder] unstamped — 图未记录 builder…`；`cat -v` 全文**零** `^[` 控制字符 |
| F3b | `[builder] unstamped …`；路径与时间戳均不出现在输出中 |
| F4 | community 前后 builder 均为 `deaddead…`（**保留**）；同时 `community 注入活性: 3 个节点`（证明回写确实发生，不是空跑） |

**F4 的"不会永久冻结"另有两条正向实证（都在真 dist 上跑）**：

1. 临时 git 项目跑 `spectra batch --mode graph-only` → builder = 当前 dist；把 builder 篡改为
   `deaddead…` 后**再跑一次全量重建** → builder **被重新盖章**回当前 dist；再连跑一次
   `cmp` 两份产物 → **逐字节相同**（byte-stable 未被本次改动破坏）。
2. 同一项目篡改 builder 后跑 `spectra graph`（另一条重建链路）→ 同样重新盖章；其产物
   `sourceCommit: null` 正是 F2 的真实场景，此时 `graph-quality` 输出
   `[freshness] unknown-provenance` + `[builder] 0d3e385 (…) — 图未记录 sourceCommit，无从比对`，
   两行语义自洽，exit 0。

### F6 实证（为何 `new URL(...).pathname` 是假红来源）

`pathToFileURL('/tmp/a b/…')` → `file:///tmp/a%20b/…`；`new URL(...).pathname` 得到 `/tmp/a%20b/…`
（**未解码**），`fileURLToPath` 得到 `/tmp/a b/…`。含空格的 clone 路径下前者与真实路径不等 ⇒ 假红。
生产代码 `builder-stamp.ts` 用的就是 `fileURLToPath`，测试侧已对齐。

### F8 已知后果登记（被证实、选择接受，不回退字段）

**事实**：同一 commit、同一输入、已 strip 时间戳时，两台机器 / 两个 worktree 因
`dirty` / `sourceDirty` / `distSha256` 不同 ⇒ graph.json **不再 byte-identical**。
F193 SC-002 的"同 commit 跨 worktree byte 一致"口径被收窄为"**同 dist** 跨 worktree byte 一致"。
现有 `tests/unit/graph/cross-worktree-byte.test.ts` 不经 `writeKnowledgeGraph`，**结构性看不到
这条**（所以它不会变红——这不等于没发生）。

**为何接受**：记录"由哪一版编译产物执行"本质上就是环境相关的，一个跨环境恒等的字段无法回答
这个问题；跨 dist 的 A/B diff 出现 builder delta 是**信息而非噪声**（正是 F259「陈旧 dist 建的
基线图虚高 148 节点」要的东西）。真正必须守住的"同一 dist 内写盘确定性"由
`graph-only-pipeline.test.ts` 的 byte-stable 断言守护（第一轮变异 B 已证其有守护力）。

**MUST NOT** 为恢复跨环境 byte 一致而把 builder 纳入 `stripTimestamps` 剥除面——生产 graph-only
链路正是 `stripTimestamps: true`（`graph-assembly.ts:265-267`），剥掉等于生产路径永不写该字段。

**连带登记**：`tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json` 的
`"builder": null` **依赖再生走 tsx/src 路径**；改用 dist CLI 再生会把本机 commit/distSha256 烤进
tracked 文件、在别人机器上永久红。已写进该 fixture 的 README 与
`scripts/regen-collector-fingerprint-fixtures.ts` 文件头。

---

# 第二轮 · 对抗复审回合（两路独立异构对抗，Codex 配额耗尽期档位）

> 审查档位：**内部异构对抗 ×2**（不同切入角：① 绕过面 / 新增静默通道；② 声称证伪 + 变异测试）。
> ⚠️ **Codex 审查暂停，异构档位缺席**——本改动属判定 / 门禁相邻面（`graph-quality` 输出与
> provenance 判据），按 CLAUDE.local.md 纪律显式登记该缺席，配额恢复后可回补。

## 已修（复审新发现，均为**我方独立复现**后才动手）

### C-2（两路各自独立复现）：存量旧图经 `community` 被补写成当前 dist —— F4 修法留下的口子

`!('builder' in graph)` 挡住了"磁盘有值"与"显式 null"两支，却放过了**危害最大的一支**：
F261 上线前的存量图 100% 没有该键，于是走进注入分支。真 dist 实证（修复前）：

```
community 前：[builder] unstamped — 图未记录 builder（旧图产物…）
community 后：[builder] 0d3e385 (…) — 与 sourceCommit=13edf52 不一致：本图由与源码树不同版本的编译产物写出
```

从"诚实的不知道"变成"自信的错误断言"，比被修掉的那支更糟。

**修法（终态）**：控制信号交由**调用方显式传参**——`WriteKnowledgeGraphOptions.builderProvenance`
取 `'stamp-this-build' | 'preserve-recorded'`，省略时取 fail-safe 默认 `preserve-recorded`。
三条建图链路（batch 主链 / graph-only / cli graph）声明前者，`cli community` 声明后者。
与 **F238** 同一条教训：**控制信号一旦由数据形态承担，就一定能被某种形态绕过**；先后两版形态
判据（裸赋值 / 键缺席）都被实证击穿，不再做第三版形态判据。

默认取"不盖章"而非"盖章"的理由是失效方向不对称：建图链路忘了声明 ⇒ 少一维信息（诚实降级，
且有 3 条 E2E / 管线用例把生产链路钉住）；回写链路忘了声明 ⇒ 伪造 provenance（假陈述）。

修复后真 dist 实证：存量旧图过 community **前后都是 `unstamped`**，且 `community 注入活性: 3 个节点`
（证明回写确实发生）。

### A-W1：保留通道原样透传未校验值 —— 由第二轮 F4 修法引入

`parseGraphBuilderStamp` 原本只守着**展示**与**注入**两处，回写链路上的外来值从不经过它。实证
（修复前）：外来 graph.json 的 builder 里塞 `builtAtIso` 与绝对路径 `distRoot`，经一次 community
回写**全部存活落盘**，`portable-guard` 全程无告警 ⇒ 文件头"值层面靠值域正则守住"对磁盘态是假话。

**修法**：保留 = **投影后保留**。走同一 `parseGraphBuilderStamp` 闸口，合法则写回 5 字段投影，
不合法整体 collapse 成 `null`。修复后实证：`builtAtIso 存活? false | 绝对路径存活? false`。

### W-1：`commit` 上界 40 会把 sha256 仓库的合法 build 判死

第一轮注释把 40 论证成"`git rev-parse HEAD` 的全长"——**只在 sha1 仓库成立**。git 2.x 的 sha256
object-format 仓库返回 64 位，`stampBuild` 照常写出，卡 40 会让整个 stamp 降级 `null` ⇒ 机制在
这类仓库上**静默空转**。已把上界放宽到 64 并订正该注释；防线未削弱（仍是纯小写 hex）。

### A-INFO：`sourceCommit: 123` 被措辞成"未记录"

实为"记录了但不可解析"。文案改为「图未记录 sourceCommit（或记录值不可解析），无从比对」。

## ~~未修复 ·~~ **已由主线程裁决 D1 处置（第三轮）**：C-1 —— builder.commit 与 sourceCommit 跨仓库不可比

> 裁决结论：采纳下表方向 **A**（换比对对象为「当前正在运行的 builder」）。落地与实证见文末「第三轮」。
> 本节以下为第二轮提交裁决时的原始记录，保留不改。

**这是本特性的设计级缺陷，不是本轮任务清单里的项，我未擅自改动。**

事实（我方独立实跑复现，非转述子代理）：`builder.commit` 是 **Spectra 自己 dist 的 build commit**，
`sourceCommit` 是**被分析项目**的 commit。除自举（Spectra 分析 Spectra）外，二者来自两个毫不相干的
仓库，**不等是结构性恒真的**。一个完全健康的外部项目（dist 刚构建、图刚建、freshness `fresh`）：

```
被分析项目 HEAD : 1875b820bef42167e82fbf485218c8c602a866ff
Spectra 仓 HEAD  : 0d3e385f4927bf2b83f5f8d92b5cade0f5326e86

Overall Verdict: pass
[freshness] fresh (recorded=1875b820…, current=1875b820…)
[builder] 0d3e385 (build 时: …) — 与 sourceCommit=1875b82 不一致：本图由与源码树不同版本的编译产物写出
```

最后一句是**假的**：dist 一点也不滞后。每个外部用户每次跑都会看到。且第一轮记在本文件里的
"缺陷① 的目标场景已可见"那段 dogfood 证据，**其实就是这条跨仓恒不等**（已在原处加更正批注）。

判定面不受影响（`Overall Verdict: pass`、exit 0），故不阻断 CI；但特性的招牌能力在**主场景**下
持续给出错误断言。

**为何我不擅自改**：① 本轮任务清单第 F2 条明确规定第三态语义建立在"与 sourceCommit 比对"之上，
擅自换比对对象等于推翻编排器的显式指令；② 修法会改动 plan.md §7.3 / tasks.md 的验收口径，而
spec/plan 对本子代理只读；③ 现有测试已把错误语义固化成断言
（`graph-quality-cli.test.ts` 的 `seedLaggingBuilderGraph` 注释写"落一份 dist 滞后于源码的图"，
实际构造的正是外部项目场景），改语义要连测试一起改。

**三个可选方向（供裁决）**：

| 方向 | 做法 | 代价 |
|------|------|------|
| **A（推荐）** | 把比对对象从 `sourceCommit` 换成**当前运行的 dist**（`getBuilderStamp()`）：`[builder] <记录值> — 与当前运行的编译产物一致/不同`。该比对对任何项目都良定义，且恰好**恢复**了特性的立项目的（"这张图由另一版 dist 写出"），并顺带让 F1/F2 两条失效面结构性消失（不再触碰 sourceCommit） | 改 3 条测试断言 + plan §7.3 文案口径 |
| B | 保留比对，但只在**自举**（被分析根即 Spectra 自身仓库）时才输出结论，其余场景只报身份不下判断 | 需要一个可靠的"是否自举"判据，本身是新的失真面 |
| C | 删掉比对，只报 builder 身份 | 信息量最小，但零假陈述，改动也最小 |

## 第二轮改动文件清单（在第一轮清单之上）

**生产代码**

- 改 `src/panoramic/graph/builder-stamp.ts`（值域正则含 W-1 上界 64 / 加载期常量 / 文件头论证订正）
- 改 `src/panoramic/graph/graph-builder.ts`（新增 `BuilderProvenanceMode` +
  `WriteKnowledgeGraphOptions`；写盘出口按调用方声明处置，保留通道加值域投影）
- 改 `src/panoramic/graph/graph-types.ts`（`builder` 字段语义与写入规则订正）
- 改 `src/cli/commands/graph-quality.ts`（`short()` 收口 / 第三态 / flags 文案）
- 改 `src/cli/commands/community.ts`（声明 `preserve-recorded`）
- 改 `src/cli/commands/graph.ts`（声明 `stamp-this-build`）
- 改 `src/batch/batch-orchestrator.ts`（声明 `stamp-this-build`）
- 改 `src/batch/stages/graph-assembly.ts`（声明 `stamp-this-build`）

**测试**

- 新增 `src/panoramic/graph/builder-stamp-load-time.test.ts`（F5，4 用例，`node:fs` mock 隔离在本文件）
- 改 `src/panoramic/graph/builder-stamp.test.ts`（F3 值域 17 用例 + F6 `fileURLToPath`）
- 改 `src/panoramic/graph/graph-builder.test.ts`（F4 反洗白 4 用例）
- 改 `tests/unit/graph-quality-builder-advisory.test.ts`（F1/F2/F3/F7 共 7 用例；**订正**原第 88 行错误断言）
- 改 `tests/integration/graph-quality-cli.test.ts`（F1 exit code 不变量，真子进程）
- 改 `tests/panoramic/community-persist.test.ts`（F4，与 F249 fingerprint 防线同款）

**文档**

- 改 `tests/fixtures/collector-fingerprint-guardrail/README.md`（F8 连带登记）
- 改 `scripts/regen-collector-fingerprint-fixtures.ts`（文件头 F8 约束）

## 第二轮五项验证实跑输出

（下表为**对抗复审处置后的终态**实跑；退出码均用 `cmd > log 2>&1; echo $?` 单独取，规避 F235 陷阱）

| # | 命令 | 退出码 | 输出摘要 |
|---|------|--------|----------|
| 1 | `npm run build` | **0** | `tsc` 无输出；`[postbuild:stamp] 盖章: commit=0d3e385f (dirty)` |
| 2 | `npx vitest run` | **0** | `Test Files 529 passed \| 4 skipped (533)`；`Tests 7261 passed \| 18 skipped \| 21 todo (7300)` |
| 3 | `npm run test:plugins` | **0** | `tests 1580 / pass 1580 / fail 0` |
| 4 | `npm run repo:check` | **0** | 86 项 `pass`；唯一 `warn` 仍是既有的 `graph-quality:freshness`（在盘图 stale，第一轮已登记的基线现象，非本轮引入） |
| 5 | `npm run release:check` | **0** | `Release contract valid (contracts/release-contract.yaml)` |

### 复审处置轮的红先行证据

C-2 / A-W1 / W-1 六条新用例在修复前实跑 `Tests 6 failed | 47 passed (53)`（三文件批），
修复后同批全绿；终态 15 文件批 `Tests 283 passed (283)`。

## 改动文件清单（确切路径）

**生产代码**

- 新增 `src/panoramic/graph/builder-stamp.ts`
- 改 `src/panoramic/graph/graph-types.ts`（`GraphJSON['graph'].builder?: GraphBuilderStamp | null`）
- 改 `src/panoramic/graph/graph-builder.ts`（`writeKnowledgeGraph` 注入 + import）
- 改 `src/cli/commands/graph-quality.ts`（`describeBuilderStamp` + `formatReportText` 第二入参 + 接线）

**测试**

- 新增 `src/panoramic/graph/builder-stamp.test.ts`（T-R1a-e，13 用例）
- 新增 `src/panoramic/graph/graph-builder.test.ts`（T-R2，4 用例）
- 新增 `tests/unit/graph-quality-builder-advisory.test.ts`（T-R5a，10 用例）
- 新增 `tests/integration/builder-stamp-e2e.test.ts`（T-R3，1 用例，真 dist）
- 新增 `tests/unit/spec-driver-implement-notes-contract.test.ts`（T-R6a/b，20 用例）
- 改 `tests/batch/graph-only-pipeline.test.ts`（追加 T-R4a）
- 改 `tests/integration/graph-quality-cli.test.ts`（追加 T-R5b/c/d 共 5 用例 + 2 处 import/常量）

**pinned 资产（计划外，见"已知偏差 1/2"）**

- 改 `tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json`（+1 行 `"builder": null`）
- 改 `tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap`（9 处插入 `"builder": null,`）

**agent 文档**

- 改 `plugins/spec-driver/agents/implement.md`（第 5 节末尾追加「Phase 级进度落盘（默认约定）」）

**不应随本需求提交的再生噪声（见"已知偏差 4"）**

- `.specify/project-context.suggestions.{md,yaml}`、`specs/products/**/_generated/**` 共 19 个文件

## Phase 4 验证实跑输出

| # | 命令 | 退出码 | 输出摘要 |
|---|---|---|---|
| T027 | `npx vitest run` | **0** | `Test Files 528 passed \| 4 skipped (532)`；`Tests 7218 passed \| 18 skipped \| 21 todo (7257)`（另单独跑 `npx vitest run >/dev/null; echo $?` 实测 `0`，排除 F235 birpc 退出码陷阱） |
| T028 | `npm run build` | **0** | `tsc` 无输出；`[postbuild:stamp] 盖章: commit=0d3e385f (dirty)` |
| T029 | `npm run test:plugins` | **0** | `tests 1580 / suites 267 / pass 1580 / fail 0 / duration_ms 30817` |
| T030 | `npm run repo:check` | **0** | 全部 check `pass`，唯一 `warn` 为既有的 `graph-quality:freshness`（在盘图 stale，属 fix-report 记录的基线现象，非本次引入） |
| T031 | `npm run release:check` | **0** | `Release contract valid (contracts/release-contract.yaml)` |

### T032 手工验证 — 连跑两次 graph-only byte 比对（实跑）

临时 git 项目（2 个 .ts + 1 个 .py），同一份 `dist`（不 rebuild）连续两次
`node dist/cli/index.js batch . --mode graph-only --output-dir specs`：

```
run1 {"formatVersion":1,"commit":"0d3e385f4927bf2b83f5f8d92b5cade0f5326e86","dirty":true,"sourceDirty":true,"distSha256":"4a48457e9827c6726330d724a3c7ea8112c2e32ad5dfcce0cfd1ea05ab122353"}
run2 {"formatVersion":1,"commit":"0d3e385f4927bf2b83f5f8d92b5cade0f5326e86","dirty":true,"sourceDirty":true,"distSha256":"4a48457e9827c6726330d724a3c7ea8112c2e32ad5dfcce0cfd1ea05ab122353"}
dist/.spectra-build-meta.json {"commit":"0d3e385f...","dirty":true,"sourceDirty":true,"distSha256":"4a48457e..."}
cmp run1.json run2.json → exit 0（逐字节相同）
sha256 两份均为 dd1d1bc490618e6ebbb12f974a0b464be36ebc4f79001844f98a260295e3f30c
```

结论：五字段逐字段相等、整份文件逐字节相等、且与 build-meta 同源。

### 缺陷① 的目标场景已可见（**第三轮重写**：基于新语义的真实证据）

> 本节第一轮原文（"`[builder] 0d3e385 … 与 sourceCommit=17e3684 不一致`"）**是错的**：`17e3684` 是
> 临时项目 HEAD、`0d3e385` 是 Spectra 仓 HEAD，两者分属不同仓库，不等是恒真的，那条输出不构成
> 任何检出。原文不再保留，理由与新语义见「第三轮」一节的 D1。

第三轮用**两版真 dist** 构造事故本体（同 commit、仅 dist 不同——即未提交分支上的**主形态**）：

```
buildA distSha256 = 3ad589fb902d2775ee9b1a29d8d5e6e1ca70644435a21fdb9bb88c55dda2050d
buildB distSha256 = 7f1b57098a4c8db97111c01629538cd1244969732c2e50cc1fdf33bf5dace670   ← 当前运行

# 用 buildA 建的图，在 buildB 下检查：
[freshness] fresh (recorded=eceb9569…, current=eceb9569…)
[builder] 图记录 commit 0d3e385 / dist 3ad589fb902d (build 时: 工作树 dirty=true, build 输入 sourceDirty=true)；
          当前运行 commit 0d3e385 / dist 7f1b57098a4c (build 时: …) — 不是同一个 build：
          同一 commit 下 dist 内容不同（源码改了但未重新提交，两次 build 之间 dist 变过）；
          注意至少一侧 build 出自脏工作树，commit 不构成可复现身份

# 用 buildB 重建同一项目的图，再自查：
[builder] commit 0d3e385 / dist 7f1b57098a4c (build 时: …) — 由当前运行的 build 写出；注意该 build 出自脏工作树…
```

freshness 两维**全部判 fresh**（静默放行），而 `[builder]` 行当场指出这张图由**另一版编译产物**建出
——正是 fix-report 里"陈旧 dist 建基线图、虚高 148 节点"那起事故的可见化。第二行同时证明**零误报**：
真由当前 build 建的图不会被误判。

## Phase 1 红输出摘要（归档）

- 4 文件批：`Test Files 4 failed (4)` / `Tests 9 failed | 15 passed (24)` —— T001-T005 `Cannot find module
  './builder-stamp.js'`；T006 `'builder' in parsed.graph` 为 false；T007 `describeBuilderStamp is not a
  function`；T013 7 fail；T014 13 项全绿（回归基线）
- 2 文件批：`Tests 2 failed | 17 passed (19)` —— T008 / T012 均在 `'builder' in ...` 处红
- `graph-quality-cli.test.ts -t "F261"`：`Tests 2 failed | 3 passed | 34 skipped` —— T009 两条 `[builder]`
  断言红；T010 / T011 基线绿（判别力在实现后才生效）

## Phase 2 转绿（T020）

`Test Files 6 passed (6)` / `Tests 85 passed (85)`。

## T021 变异测试结论（三段实跑，已撤回）

> **tasks.md 规定的字面变异确实被护栏杀死，但杀死它的不是 byte-stable 那条断言。**

### 变异 A（字面形态：`builtAtIso` 从 build-meta 透传进 stamp）

`Test Files 2 failed | 1 passed (3)` / `Tests 3 failed | 29 passed (32)`

- **红**：T-R1a（`Object.keys` 精确 5 项）、T-R1b（`'builtAtIso' in r === false`）、T-R3（真 dist e2e 精确 key 集合）
- **绿（未捕获）**：`graph-only-pipeline.test.ts` 的「连跑两次逐字节相等」与新增的 T-R4a
- **为何 byte-stable 抓不到**：`builtAtIso` 是 `stampBuild` 在 **build 那一刻**写死到磁盘的常量。连跑两次之间
  没有 rebuild ⇒ 两次读同一份文件的同一个值 ⇒ 文件仍逐字节相等。该形态并不产生**运行期**非确定性，
  其危害是"跨 build 的图 diff 出现无意义抖动"，那一维由 key 集合断言守护。

### 变异 B（真实非确定性形态：写盘时刻墙钟进 stamp）

`tests/batch/graph-only-pipeline.test.ts` → `Tests 2 failed | 16 passed (18)`

- **红**：既有「同一 fixture 连跑两次 graph.json 逐字节相等」
- **红**：新增 T-R4a（失败信息直接指向 builder 对象，达成定位目的）
- 结论：byte-stable 护栏对本字段**确有守护力、非空转**；它守的是"每次写盘取值可能不同"这一维。

### 撤回与恢复

从 scratchpad 备份原样还原 → `npm run build` 成功 → `grep -c MUTATION` 为 `0` → 5 文件重跑
`Test Files 5 passed (5)` / `Tests 46 passed (46)`。

### 未能参与变异测试的一项

`tests/e2e/feature-180-batch-repro.e2e.test.ts` 的 T-010-4 由 `HAS_LLM_E2E=1` 门控（真实 LLM full batch），
本环境实跑输出 `Test Files 1 skipped (1)` / `Tests 5 skipped (5)`。plan.md §9 T-R4b 里"feature-180 T-010-4
必须变红"这一条**无法在本次执行中取得证据**；其等价守护由变异 B 已证有效的 `graph-only-pipeline.test.ts`
byte-stable 断言承担。

## 已知偏差

1. **计划外资产改动 A：`tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json`**。
   plan.md §9.2 判定该 fixture "无需再生"，依据是 `compareGraphOnlyStructure` 只比 node/edge multiset、
   不读 `graph.graph`。该依据**成立但不完整**：`collector-fingerprint-regen-script.test.ts` 的「已 bump
   场景 → 放行再生」用例会让脚本**重写**这份资产，然后与原始 pinned 文件做 **byte digest** 比对。
   重建产物新增 `builder` 字段 ⇒ digest 不等 ⇒ 该用例红。
   处置：**用权威路径产生最小变更**——把 fixture 复制到临时目录、降级两份资产的 `behaviorVersion`、
   实跑 `tsx scripts/regen-collector-fingerprint-fixtures.ts --fixture-root <tmp>`，再 diff 回入库资产，
   确认唯一差异就是末尾 `"builder": null` 一行（`expected-module-graph.json` 零差异），才复制回仓库。
   未手工编辑、未夹带其它漂移。
   **BEHAVIOR_VERSION 仍不 bump**：fixture 的**源码输入一个字节未动**，`compareGraphOnlyStructure`
   判定的 `contentMismatch` 仍为 `false`（正常 regen 走「无需更新」不重写），本次不属于
   `BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 六类中的任何一类，也不同于 F259 那次「fixture 基线扩充」。
2. **计划外资产改动 B：`tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap`**（9 处）。
   F220 charter 快照冻结了 `graph.graph` 的完整形态，新增字段必然使 9 个快照失配。
   处置：按既有纪律**外科替换**（禁 `vitest -u`，避免刷新快照里的冻结时钟/日期面）——用脚本在 9 处
   `    "graph": {` 且下一行为 `"edgeCount"` 的位置精确插入 `      "builder": null,`，共 `9 insertions(+)`、
   `0 deletions`。随后 `npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts` → `12 passed`。
3. **其余 pinned 图资产确认无需改动**：全仓搜 `"schemaVersion": "2.0"` 的入库资产共 20+ 份，除上述
   两份外全部为**只读消费**（micrograd-baseline-graph / graph-quality-{ts,java,go} / graph-quality-adversarial
   等），它们缺 `builder` ⇒ 走 `unstamped` 分支，不改任何指标与 verdict；全量 `npx vitest run` 零失败佐证。
4. **`npm run repo:sync` 产出 19 个与本需求无关的再生噪声**：`.specify/project-context.suggestions.{md,yaml}`
   与 `specs/products/**/_generated/**`。实证其成因与 implement.md 改动无关——
   `git diff <这些文件> | grep -c "implementation-notes\|进度落盘"` 输出 **0**；实质差异只有三类：
   (a) `generatedAt` 时间戳；(b) 读取 `.specify/runs/` **本地运行态**（CLAUDE.md 明确"保持忽略、不作为
   长期人工事实源"）得出的 adoption 统计（totalRuns 4→5 等）；(c) 早已提交的 release-contract 版本描述
   （v4.3.0→v4.4.2）回填。按"并行 feature 须排除再生制品、用显式路径勿 `git add -A`"约定，
   **建议主编排器不要把这 19 个文件纳入本次提交**。
5. **repo:sync 未产出任何 `plugins/spec-driver/skills-codex/` 或 `.codex/skills/` 侧改动**（实跑
   `git status --porcelain` 前后 diff 佐证）。故 F186 wrapper body-sha256 门禁与 F238 model-literal 门禁的
   判据面未被触及；`repo:check` 的 `delegation-contract:codex-wrapper-block-sync` 与
   `model-literal-gate:model-literal-scan` 均 `pass` 予以交叉确认。
6. **T025 的 `git add` 未执行**：编排器运行时上下文明令禁止任何 git 写操作，提交由主编排器统一负责。
   T025 的复核部分（见偏差 5）已完成。
7. **T018 barrel 未新增导出**：核实结论写在 `builder-stamp.ts` 文件头——同类模块 `source-commit.ts`
   同样未经 `./index.ts` 暴露（其外部消费方 `graph-quality.ts` 直接深链 import），本模块消费面完全一致，
   故沿用该口径，不为一个 advisory 字段扩大 barrel 公共面。
8. **plan.md §6 决策 4 第 2 条的因果链需修正**（见 T021 结论）：`builtAtIso` 透传由 **key 集合断言**守护，
   byte-stable 守护的是**写盘期非确定性**。已补做变异 B 取得后者证据。
9. **plan.md §12「明确不做的事」逐条核对**：未把 builder 纳入 `evaluateFreshness`（✔）；未新增 repo:check
   check（✔，`spec-drift-repo-check-regression.test.ts` 全绿）；未改 `graph-quality-report.schema.json` 及其
   契约测试（✔，`graph-quality-report-schema.test.ts` 全绿）；未 bump `schemaVersion` / `BEHAVIOR_VERSION`
   （✔）；未改 `src/cli/version-meta.ts`（✔）；未逐调用方接线（✔，四条写盘链路一行未改）；
   **"不再生任何 pinned fixture" 一条已破例**，理由与最小化处置见偏差 1/2。
10. `[E2E_DEFERRED]`：**无**。真 dist 端到端路径已由 `tests/integration/builder-stamp-e2e.test.ts` 与
    T032/dogfood 手工实跑双重覆盖。

---

# 第三轮（主线程裁决 D1-D5 落地 + 消费面收口）

> 本轮**不重新论证**裁决本身，只落地并取证。plan.md / tasks.md 对本子代理只读，其中被本轮
> 推翻的口径（§7.3 的三态文案样例、§7.4 的 B-2 判据）以本节为准，见「与 plan 的偏差」。

## D1 —— advisory 的比对对象换成「当前正在运行的 builder」

**落点**：`src/cli/commands/graph-quality.ts` 的 `describeBuilderStamp`（新增第二入参
`currentBuilder = getBuilderStamp()`，**仅为可测性**；生产调用点不传）。

**六态**（记录侧三态 × 比对侧三态收敛）：

| 情形 | 输出要点 |
|------|----------|
| `builder` 键缺失 | `unrecorded` — 旧图产物（本字段上线前写出） |
| `builder` 显式 `null` | `unstamped` — 由未盖章 build / 源码直跑写出 |
| 存在但解析失败（含值域不合规） | `unrecognized` — 更新版本写出、或已被篡改（**未塌进 unstamped**） |
| 当前为源码直跑（`getBuilderStamp()` 为 null） | 无法比对 |
| 全字段相等 | 由当前运行的 build 写出 |
| 二者都合法但不等 | 点名 commit / dist 哪一维不同，两侧短值都给出 |

比对是**整份 stamp 的字段级比较**（commit + distSha256 + dirty + sourceDirty），理由见 D2。

**修复前后对照实跑（真 dist，同一构造）**

| | 修复前（build A 自查自己建的图） | 修复后 |
|---|---|---|
| 输出 | `[builder] 0d3e385 (…) — 与 sourceCommit=eceb956 不一致：本图由与源码树不同版本的编译产物写出` | `[builder] commit 0d3e385 / dist 7f1b57098a4c (…) — 由当前运行的 build 写出` |
| 评价 | **假陈述**（这张图就是这一版 dist 刚建的） | 与事实相符 |

**修复前的结构性失明（同一批 4 个构造，逐字比对）**：`same`（= 正在运行的 build）/ `distB` /
`distC`（仅 distSha256 不同）三者输出**逐字相同**；`otherbuild`（commit 与 dist 都不同）也只是换了
7 位 sha，**结论词一模一样**。即：旧判据对"是不是同一个 build"这个问题的四种答案给出同一句话。

修复后同批：三份仅 dist 不同的构造渲染出 **3 条互不相同**的文案（`sort -u | wc -l` = 3）。

**顺带面**：第二轮 F1（`short()` 崩溃）与 F2（`sourceCommit=null` 假断言）的失效路径随之
**结构性消失**（本函数不再读 `sourceCommit`）。按裁决，F1 的类型守卫**保留**为防御纵深；并新增
入口收口——`graph.graph` 非对象形态（null / 数组 / 字符串）先折叠成 `{}` 再用 `in`，否则
`'builder' in null` 会抛，一次抛出就是 exit 2（advisory 反当门禁）。

## D2 —— advisory 必须渲染 `distSha256`（前 12 位）

`stampIdentity()` 统一渲染 `commit <7位> / dist <12位> (build 时: 工作树 dirty=…, build 输入 sourceDirty=…)`。

**为什么是主形态**：本仓当前就处在"未 commit 的 feature 分支"状态——`builder.commit` 恒等于 HEAD
（`0d3e385f`），无论 dist 落后 src 多少次编辑。本轮的 A/B 两版真 dist 正是
`commit 相同 / distSha256 不同`（`3ad589fb…` vs `7f1b5709…`），只比 commit 对它完全失明。

`sourceDirty === true` 时**禁止**"一致"二字：实现中一律不使用该词，并追加
`；注意该 build 出自脏工作树，commit 不构成可复现身份`。

## D3 —— `scripts/graph-semantic-diff.mjs` 的 provenance banner

事故当时的真实工作流是"**两张图对比、看到 148 节点差**"，而该工作流里三维 provenance 此前
**一个字都不出现**（修复前实跑：全文 `grep -ci "builder\|sourceCommit\|fingerprint\|provenance"` = **0**）。

**修复后**（两张图由真实两版 dist 建出，nodes/links 完全相同）：

```
[provenance] ⚠ 两图 provenance 不同，节点/边差异可能来自工具版本而非源码：
[provenance]   builder: old commit 0d3e385 / dist 3ad589fb902d → new commit 0d3e385 / dist 7f1b57098a4c
[provenance] 排查建议：先用同一版 dist 重建两侧图再比对，再判断差异是否为真实源码变化。
…
[PASS] 全部差异归因到三类 allowlist（无未归因节点/边/ID/度数差异）     ← exit 仍为 0
```

约束落实：**纯输出增量**——不改 exit code（PASS/FAIL 两个方向各有断言）、不新增 repo:check check
（`spec-drift-repo-check-regression.test.ts` 的 7 项钉死未动）、不改任何 JSON 契约。
provenance 完全相同时**零输出**（对照实跑：banner 行数 = 0）。
外部值（commit / distSha256 / sourceCommit）过与 `builder-stamp.ts` 同款的十六进制值域闸口，
不合规折叠为 `unrecognized`——否则 `ESC[2J ESC[H` 这类值会原样进终端（F3 已实证的形态）。

## D4 —— 口径如实化：事故检测器 ≠ 篡改检测器

写进 `src/panoramic/graph/builder-stamp.ts` 文件头（并在 `graph-types.ts` 字段注释里点一句）：

- `distSha256` 在**图这条链路上只是一段自称的字符串**：`verifyBuildStamp`
  （`scripts/lib/spectra-version-gate.mjs:164-177`）会重算比对，但 `builder-stamp.ts` **从不调用它**。
- 非恶意变体同样成立：`npx tsc` / IDE build task / `npm run build --ignore-scripts` 都会改 dist 的
  `.js` 而**不触发** `scripts/postbuild-stamp.mjs` ⇒ meta 停在旧身份。
- **交接注记补第二条**：若升为门禁判据，除收紧 key 集合外**还必须同时做 hash 复算**——只收紧 key
  集合，判据仍建立在"meta 自称什么就是什么"之上。

## D5 —— 补齐「非 null 且 byte-stable」的测试覆盖

缺口来源：入库守护资产恒为 `builder: null`（再生走 tsx，见 F8 登记）；唯一走真 dist 的 e2e 只跑一次、
不比对两次产物 ⇒ **有值**情况下的写盘确定性从未被断言（第一轮 T032 只有手工记录，回归时不会变红）。

新增 `tests/integration/builder-stamp-e2e.test.ts` 的 D5 用例：真 dist 连跑两次 `batch --mode graph-only`
（两个独立 output-dir），断言 ① `builder` 非 null（`assertDistBuilt()` 已保证 meta 存在，故为硬断言而非
条件跳过）；② 两次产物 `builder` 逐字段相等且与磁盘 build-meta 同源；③ 两份 graph.json **逐字节相同**。

## 变异测试（守护力验证；全部在 `/private/tmp/.../mut` 的仓库副本上做，worktree 一字未改）

| 变异 | 内容 | 结果 |
|------|------|------|
| M1 | `sameBuild` 只比 `commit`（丢掉 dist 维度） | **被杀** — D1-2 / D1-5 两条红 |
| M2 | `stampIdentity` 丢掉 `dist`（= 第二轮实测的失效形态） | **被杀** — 4 条红（含 D2 两条） |
| M3 | banner 丢掉 builder 维度 | **被杀** — 4 条红 |
| M4 | banner 顺手把 provenance 不同改成 `exit 1` | **被杀** — 5 条红（含"不改 exit code"两条） |

副本上 `grep -c MUTATION` 复原后为 0；worktree 全程未参与变异。

## 红先行证据

| 文件 | 实现前 | 实现后 |
|------|--------|--------|
| `tests/unit/graph-quality-builder-advisory.test.ts`（重写） | `Tests 16 failed \| 7 passed (23)` | `27 passed (27)`（含后补的畸形形态守卫与对抗复审 W1/W3/W4 三例） |
| `tests/unit/graph-semantic-diff-provenance-banner.test.ts`（新增） | `Tests 6 failed \| 2 passed (8)` | `13 passed (13)`（含对抗复审后补的键序 / 未展示字段 4 例） |

## 第三轮改动文件清单（确切路径）

**生产代码**

- 改 `src/cli/commands/graph-quality.ts`（`describeBuilderStamp` 重写为六态 + `stampIdentity` /
  `describeStampDelta` 两个新纯函数 + `short()` 支持自定义截断长度 + 入口非对象形态收口 + import `getBuilderStamp`）
- 改 `scripts/graph-semantic-diff.mjs`（`loadGraph` 返回 `meta`；新增 `printProvenanceBanner` /
  `hexOrNull` / `describeBuilderRecord` / `describeSourceCommit` / `describeFingerprint`；在三类归因之前打印）
- 改 `src/panoramic/graph/builder-stamp.ts`（**仅文件头注释**：D4 口径 + D1 消费侧语义；代码零改动）
- 改 `src/panoramic/graph/graph-types.ts`（**仅 `builder` 字段注释**：消费口径 + 事故检测器定性）
- 改 `src/panoramic/graph/graph-builder.ts`（**仅两处注释**：`unstamped` → 按新六态措辞订正）

**测试**

- 重写 `tests/unit/graph-quality-builder-advisory.test.ts`（24 用例：六态 / D2 / 值域 / sourceCommit 无关性 / 字面量禁令）
- 新增 `tests/unit/graph-semantic-diff-provenance-banner.test.ts`（13 用例，真子进程跑脚本）
- 改 `tests/integration/graph-quality-cli.test.ts`（F261 describe 块重写：真 dist stamp 对照 + D2 端到端 + 三态分列）
- 改 `tests/integration/builder-stamp-e2e.test.ts`（新增 D5 用例）
- 改 `tests/panoramic/community-persist.test.ts`（**仅注释**：旧措辞订正）
- 改 `src/panoramic/graph/graph-builder.test.ts`（**仅注释**）

**文档**

- 改 `specs/261-fix-graph-builder-stamp-notes/implementation-notes.md`（本节 + 重写"缺陷① 目标场景"段 + C-1 结案批注）

## 第三轮五项验证实跑输出

（退出码均用 `cmd > log 2>&1; echo $?` 单独取，规避 F235 birpc 陷阱）

| # | 命令 | 退出码 | 输出摘要 |
|---|------|--------|----------|
| 1 | `npm run build` | **0** | `tsc` 无输出；`[postbuild:stamp] 盖章: commit=0d3e385f (dirty)` |
| 2 | `npx vitest run` | **0** | `Test Files 530 passed \| 4 skipped (534)`；`Tests 7289 passed \| 18 skipped \| 21 todo (7328)` |
| 3 | `npm run test:plugins` | **0** | `pass 1580 / fail 0` |
| 4 | `npm run repo:check` | **0** | 86 项 `pass`；唯一 `warn` 仍是既有的 `graph-quality:freshness`（在盘图记录的 sourceCommit 为 `8d25c264`，第一/二轮已登记的基线现象，非本轮引入） |
| 5 | `npm run release:check` | **0** | `Release contract valid (contracts/release-contract.yaml)` |

## 与 plan.md 的偏差（plan 只读，此处登记）

1. **plan §7.3 的三态文案样例已失效**（`— 与 sourceCommit 一致 / 不一致 / unstamped`）。新文案见 D1 表。
   §7.3 真正的**硬约束**（四个方括号字面量禁令）**仍然遵守**，并由本轮 24 用例中的一组遍历断言守住。
2. **plan §7.4 的 (B-2) 退回判据被裁决豁免**。(B-2) 写的是"advisory 需要读取 graph.json 以外的新信息源
   ⇒ 退回方案 B"。D1 恰恰要求读 `getBuilderStamp()`（进程加载期常量，来自 `dist/.spectra-build-meta.json`）。
   主线程已裁决：该信息源正是本特性成立的前提，(B-2) 的立论（"说明它其实不是纯渲染"）在此不适用。
   实际改动面仍限于 text 报告一行，`--json` / `--status` / schema / exit code 全未动。
3. **plan §12「明确不做的事」逐条复核仍成立**：未进 freshness / 未加 `--json` 顶层字段 / 未新增
   repo:check check / 未 bump schemaVersion 与 BEHAVIOR_VERSION / 未回退 F8 口径 / 未把 builder 纳入
   `stripTimestamps` 剥除面。本轮**未再生任何 pinned fixture**（`builder` 字段形态与取值一字未变）。

## 第三轮 `[E2E_DEFERRED]`

**无**。D1 / D2 / D3 / D5 均有真 dist（或真子进程）端到端实跑证据。

> 本节之后另有「第三轮 · 对抗复审回合」，其处置改动了 `describeBuilderStamp` 的**结论判据**
> （由 `distSha256` 主导）与 banner 的证据行渲染，上文 D1 表格的"全字段相等/不等"两行按该节更新。

---

# 第三轮 · 对抗复审回合（两路独立异构对抗）

> 审查档位：**内部异构对抗 ×2**（角 A = 语义正确性 / 假陈述；角 B = 回归面 / 合同漂移）。
> ⚠️ **Codex 审查暂停，异构档位缺席**——本改动属判定相邻面（`graph-quality` 人读判定输出 +
> fail-closed 脚本的输出面），按 CLAUDE.local.md 纪律显式登记该缺席，配额恢复后可回补。
> 两路均**禁止 git 写 / 禁止改 worktree / 禁止 rebuild**，变异实验在 `/private/tmp` 副本上做。

## 已修（复审新发现，均有实跑复现证据）

### W1（角 A）：short-sha 记账 → **同一行内两个渲染值逐字相同、结论却说"commit 不同"**

`COMMIT_VALUE_PATTERN` 的 7 位下界是**刻意**为 short-sha 记账开的，但比对是裸 `!==`。实跑（修复前）：

```
[builder] 图记录 commit 0d3e385 / dist 7f1b57098a4c …；当前运行 commit 0d3e385 / dist 7f1b57098a4c … — 不是同一个 build：commit 不同（dist 内容恰好相同）
```

与前两轮栽的是**同一种病**：一句读者能当场证伪的话。且"恰好相同"把 sha256 相等这条强证据说成巧合。

**修法**：新增 `commitNotationCompatible`（一方是另一方前缀即相容），并把结论判据改为
**`distSha256` 单独决定**"是不是同一份编译产物"。修复后实跑：

```
[builder] commit 0d3e385 / dist 7f1b57098a4c … — 由当前运行的这一份编译产物写出（dist 按 sha256 相同）；
仅盖章元数据有出入：commit 记法长度不同（图 7 位 / 当前 40 位，前缀相同）
```

前缀相容**不构成**同一性证据（7 位会碰撞），故它只用来避免自相矛盾的断言，不用来判等。

### W4（角 A）：`dirty` 单独翻转就以"不是同一个 build"领读 —— 高频误报

`stampBuild` 的 `dirty` 取**整树** `git status --porcelain`，与 dist 内容毫无关系：碰任何一个无关文件
（再生 specs、临时脚本）后重建，`distSha256` 不变而 `dirty` 翻转 ⇒ 此前建的所有图一律被标"不是同一个
build"，正是本机制设计时要避免的"天天红 → 被当噪声"。

**修法**：结论位由 `distSha256` 主导；commit 记法与脏标志差异降级为同一行内的括注，且**两侧取值都列出**
（"降级为括注 ≠ 抹掉信息"）。修复后实跑：

```
[builder] commit 0d3e385 / dist 7f1b57098a4c … — 由当前运行的这一份编译产物写出（dist 按 sha256 相同）；
仅盖章元数据有出入：盖章时记录的工作树状态不同（图 dirty=false/sourceDirty=true，当前 dirty=true/sourceDirty=true）
```

> 与裁决 D1「至少 `commit` + `distSha256`」的关系：**渲染**仍是整份 stamp（四个字段全可见），
> 变的只是**结论由哪一维决定**。D1 给的理由是"只比 commit 对 dist 落后完全失明"，本修法把 dist
> 提为唯一判据，完全服从该理由，且不弱化目标场景检出（陈旧 dist ⇒ distSha256 必不同）。

### W3（角 A）：**测试自欺** —— "点名哪一维不同"这条要求完全没被守护

角 A 把相关函数逐字抄进独立 harness（先证明与 dist CLI 在 17 个 fixture 上输出逐字相同），再把
所有相关断言转写过去做变异：把 delta 描述函数换成**常量**、甚至换成**空串**，`ALL ASSERTIONS PASS`。
根因是断言锚在 `'dist'` / `'不是同一个 build'` 这类**所有分支共有**的子串上。

**修法**：引入 `DISCRIMINATORS` 判别文案表 + `expectOnly()`——每个分支断言其**独有**子串，并交叉断言
其余分支的独有子串 `not.toContain`。我方复验（副本变异，worktree 未动）：

| 变异 | 修法前 | 修法后 |
|------|--------|--------|
| M5：delta 描述恒返回常量 | 存活（全绿） | **被杀**（1 红） |
| M6：元数据差异恒返回空 | 存活（全绿） | **被杀**（3 红） |

### W2（角 A）：`无法比对` 把成因写死成"源码直跑"

`currentBuilder === null` 在**真编译 dist** 上同样触发——`npx tsc` / IDE build task /
`npm run build --ignore-scripts` 都不跑 `postbuild-stamp.mjs`，首次这样构建的树上 build-meta 从未存在
（文件头此前只讨论了 meta *陈旧*，没讨论 meta *从未写出*）。角 A 实跑：复制真 dist 后只删 build-meta，
输出即断言"当前为源码直跑"。**修法**：改为"当前进程未找到 build 盖章（源码直跑，或 dist 缺
`.spectra-build-meta.json`）"。
（角 A 顺带证伪了一条相反猜想：`npm pack --dry-run` 显示 `dist/.spectra-build-meta.json` **确实进
npm tarball**，故全局安装 / npx 用户不命中这条。）

### I2（角 A）：`graph.graph` 畸形时说"旧图产物（本字段上线前写出）"是假陈述

经 CLI 不可达（`validateGraphJsonShape` 拦住），但导出函数直调可达，且**单测把这句假陈述当成了期望值**。
**修法**：措辞改为"图未记录 builder（本字段上线前的旧图产物，**或元数据结构异常**）"。

### W1（角 B）：banner 会打出"两侧渲染值完全相同"的证据行 —— 同一种自相矛盾

判据比对**整个对象**，渲染却只暴露一两个字段。角 B 实跑：

```
[provenance]   fingerprint: old behaviorVersion=7 → new behaviorVersion=7
[provenance]   builder: old commit aaaaaaa / dist 111111111111 → new commit aaaaaaa / dist 111111111111
```

**且这不是边角形态**：`CollectorFingerprint = { formatVersion, extensionSurface, behaviorVersion }`，
而 F249 的设计口径就是「`extensionSurface` 变化自动改指纹、无需 bump `behaviorVersion`」
（F243 `.mjs/.cjs`、F250 `.pyi` 都走这条）⇒ "跨版本两图 fingerprint 不同"的**最常见形态**恰好
渲染成两侧相同。读者最可能的反应是判定工具有 bug 并忽略整条提示，**比不打 banner 更糟**。

**修法**：新增 `diffTopLevelKeys`，两侧渲染值相同时追加"（差异在未展示字段：`<字段名>`）"。字段名来自
外部 JSON，与值一样过消毒（只放行 `[A-Za-z0-9_.-]{1,40}`，其余折叠为 `<非常规字段名>`，最多列 5 项）。

### I4 残余（角 B）：D5 的两次跑把 run1 产物落在**被扫描项目树内**

角 B 实证当前"恰好安全"（graph-only 产物只有 `_meta/graph.json`，非源码扩展名不入扫描），但那是巧合
不是结构——产物一旦新增 `.ts/.md` 或扫描口径改成计文件数，D5 会为一个与 builder 无关的原因变红。
**修法**：输出目录改为项目树**之外**的独立 `mkdtemp`，用完即清。

## 未修 · 需主线程裁决：C1（角 A，CRITICAL）—— `community` 把 `unrecognized` 塌成 `unstamped`

**这是第二轮 A-W1 修法（"保留 = 投影后保留"）的连带后果，改它等于推翻第二轮的显式裁决，故不擅动。**

角 A 实跑复现：一张由**更新版本 spectra**（`formatVersion: 2` + 未来字段）盖章的图，被**旧版**
`spectra community` 跑一次后：

```
--- before: {"formatVersion":2,"commit":"cccc…","distSha256":"dddd…","newFieldFromFuture":"x"}
--- after : null
--- advisory: [builder] unstamped …
```

原始 stamp **不可恢复**，`unrecognized`（"更新版本写出、或已被篡改"，排查动作不同）这一态被一次纯
metadata 回写抹掉。版本偏斜在本仓库是常态（全局 MCP 用旧 dist、repo 用新 dist），可达性不低。

**本轮已做的有限缓解**（不触碰写盘语义）：`unstamped` 文案不再断言成因，改为
「图记录 builder 为 null（未盖章 build / 源码直跑写出，**或曾被回写链路降级**）」——从"自信的错误
断言"退回"只陈述现状"。**但磁盘上的信息损失依然发生。**

**给裁决的建议**（按推荐度）：

1. `preserve-recorded` 在**不可解析**时**不改动该键**（原样保留）。注意第二轮 A-W1 的实际威胁面
   （`builtAtIso` / 绝对路径**与 5 个合法字段并存**）其实由 `parseGraphBuilderStamp` 的**投影**挡住，
   不依赖"整体 collapse 成 null"这一支；真正只被 collapse 挡住的是"本就不可解析、又恰好带路径/时间戳"
   的窄形态。配套把 `scanGraphPortabilityViolations` 扩到扫 `graph.graph`，才是那条不变量的正解。
2. 保留 collapse，但改写成**可区分的哨兵**（如 `{ formatVersion: 0 }`），让消费侧仍渲染 `unrecognized`。
3. 保留现状，但 `community` 丢弃不可解析 stamp 时**打 warn**，把静默销毁变成可见事件。

## 角 B 复核通过项（附验法，非目视）

| 项 | 验法 |
|---|---|
| banner 是**纯输出增量** | 用 `git show HEAD:scripts/graph-semantic-diff.mjs`（旧版）与新版在 4 组真图上并排跑：exit 逐组相同（1/1、0/0、0/0、1/1）；banner 触发场景剥掉 `[provenance]` 行后 stdout 与旧版仅差一个空行，stderr 逐字节相同 |
| `--dup-check` 未受 `loadGraph` 返回值变化影响 | 6092 节点自举图上新旧 stdout 逐字节相同；`runDupCheck` 是解构取 `nodes`，新增键不可达 |
| stdout **无任何机读消费方** | 全仓 grep：命中全部是 specs 人读验收命令 / 注释 / usage 串；逐条核过 `package.json` 全部 scripts 与 `.github/`，零接线（与 F249 `codebase-context.md` §5.1 C-004 既有登记一致） |
| 未新增 repo:check check / 未改 JSON 契约 | 该脚本无 `--json` 模式；`spec-drift-repo-check-regression.test.ts` 的 7 项钉死全绿 |
| D4 文档三条断言属实 | ⚠️ **(a)/(b) 两条在第四轮被推翻，见「第四轮 · 对抗复审」B-C1**（原文保留）：`verifyBuildStamp` **在全仓不存在**，“3 处命中全是注释”这条本身就是该函数不存在的证据，却被反向读成“确认无调用点”。(c) 实跑 npm 11.9.0 对照：`npm run build` → pre/build/post 三段全跑，`--ignore-scripts` → **只跑 build**（这条仍成立）|

## 角 B 登记的结构性盲区（未修，仅记账）

两图**都由源码直跑**（tsx/vitest）建出时 `builder` 两侧都是 `null`，若又同处一个 HEAD、只是工作树未提交
内容不同，则三维全等 ⇒ **不打 banner**，而两图确实由不同工具状态建出。文件头未把 banner 说成充要条件，
不算 over-claim；但"没有 banner"**不等于**"同一版工具"，将来若有人依赖它做判断需注意。

## 复审处置后的终态验证（五项全绿）

| # | 命令 | 退出码 | 输出摘要 |
|---|------|--------|----------|
| 1 | `npm run build` | **0** | `tsc` 无输出；`[postbuild:stamp] 盖章: commit=0d3e385f (dirty)` |
| 2 | `npx vitest run` | **0** | `Test Files 530 passed \| 4 skipped (534)`；`Tests 7289 passed \| 18 skipped \| 21 todo (7328)` |
| 3 | `npm run test:plugins` | **0** | `tests 1580 / pass 1580 / fail 0` |
| 4 | `npm run repo:check` | **0** | 86 项 `pass`；唯一 `warn` 为既有 `graph-quality:freshness`（在盘图 sourceCommit=`8d25c264`，一/二轮已登记的基线现象） |
| 5 | `npm run release:check` | **0** | `Release contract valid (contracts/release-contract.yaml)` |

---

# 第四轮（主线程裁决 D6 落地 —— 第三轮 C1 结案）

> 本轮**不重新论证**裁决本身，只落地并取证。范围严格限定在「保留通道 + 相应文案」，
> 未做任何其它改动。

## D6 —— `preserve-recorded` 遇不可解析原值时**原样不动该键**

**裁决口径**：不解析、不投影、不覆盖、不置 `null`。理由是标准前向兼容规则——**旧版本无权抹掉
更新版本写入的内容**；把"不可识别"抹成"未盖章"是把未知伪装成已知，与本特性全部设计意图相反。

**落点**：`src/panoramic/graph/graph-builder.ts` 的 `writeKnowledgeGraph`，保留分支拆成两支：

| 原值 | 处置 | 挡的是什么 |
|------|------|-----------|
| 可解析 | 写回 `parseGraphBuilderStamp` 的 5 字段投影 | 「外来键与合法字段并存」（`builtAtIso` / 绝对路径搭在合法 stamp 上），即第二轮 A-W1 的真实威胁面 |
| 不可解析 | **原样不动** | 「旧版一次纯 metadata 回写就永久销毁更新版本的 provenance」 |

### 红先行证据（先证明用例能抓住旧行为，再修）

三文件批修改前实跑：`Tests 4 failed | 46 passed (50)`，4 条红全部是新增的 D6 用例：

- `graph-builder.test.ts`：`D6：保留时遇不可解析的 builder …→ 原样保留` — `expected null to deeply equal { formatVersion: 2, …(5) }`
- `graph-builder.test.ts`：`D6：值域不合规（路径 / 时间戳）同样原样保留` — `expected null to deeply equal { …commit: "/Users/alice/secret @ …" }`
- `graph-builder.test.ts`：`D6：非对象形态（字符串 / 数组 / 数字）也原样保留` — `expected null to deeply equal 'future-opaque-token'`
- `community-persist.test.ts`：`D6：更新版本写入的不可识别 stamp 经旧版 community 写回后，原值一字不变`

修复后五文件批：`Test Files 5 passed (5)` / `Tests 98 passed (98)`。

### 修复前后对照实跑（**真 dist A/B**，同一构造逐条对应）

构造：`/private/tmp/.../d6` 下放两份真 dist 副本——`dist-after` = 本轮产物；`dist-before` = 同一份
产物**只把编译后的保留分支外科替换回旧的 collapse 写法**（单点差异，其余逐字节相同）。
被测项目是临时 git 仓（2 个 .ts，`batch --mode graph-only` 建出 4 节点真图），磁盘 graph.json 的
`builder` 被替换为一份"更新版本盖章"的 stamp（`formatVersion: 2` + `newFieldFromFuture`），
然后各跑一次 `spectra community`：

| | `dist-before`（旧 collapse） | `dist-after`（D6） |
|---|---|---|
| community 前磁盘值 | `{"formatVersion":2,…,"newFieldFromFuture":"x"}` | 同左 |
| community 后磁盘值 | **`null`（原值不可恢复）** | `{"formatVersion":2,…,"newFieldFromFuture":"x"}`（**一字未变**） |
| `graph-quality` advisory | `[builder] unstamped — 图记录 builder 为 null（未盖章 build / 源码直跑写出）…` ← **假陈述** | `[builder] unrecognized — builder 记录存在但不可识别（更新版本写出、或已被篡改）` ← 与事实相符 |
| 注入活性 | 4 个节点带 community | 4 个节点带 community（两侧都证明回写确实发生，不是空跑） |

**同一 dist 上另两条真 dist 实证**：

1. **让渡的那条防线由消费侧兜住**：植入 `commit = ESC[2J ESC[H`、`distSha256 = /Users/alice/secret/dist`、
   `builtAtIso = 2026-08-08T09:00:00Z` 的不可解析 stamp → community 后磁盘上**确实原样留存**
   （`/Users/alice/secret/dist`），而 `graph-quality` 输出为 `[builder] unrecognized …`，
   **逐字节扫描全文：控制字节 0、ESC(0x1b) 0、`/Users/alice` 0 次**。
   （过程中一度以为 `2026-08-08` 与 `^[` 命中是外泄——实为报告自己的 `Generated:` 行与 BSD grep 把
   `\^\[` 当成行首锚点的假阳性；已用 node 逐字节复核推翻，**同批对照组 clean 图命中数相同**。）
2. **合法 stamp 仍走投影**：给合法 stamp 搭上 `builtAtIso` + `distRoot: /Users/alice/dist` → community 后
   磁盘 keys 恰为 `formatVersion,commit,dirty,sourceDirty,distSha256`（外来键被剥掉），A-W1 的原始
   威胁面未被本轮削弱。

### 配套不变量：`unrecognized` 渲染面 MUST NOT 回显原始记录内容

D6 之后磁盘上会**长期存在**读不懂的 builder 值，因此"控制字符 / 绝对路径 / 时间戳不进终端"这条
不变量**完全落到消费侧**，写盘侧不再充当第二道保险。核查与加固两处：

- `describeBuilderStamp`（`graph-quality.ts`）：实读确认原本就是常量串、无回显。原有用例只钉了两组
  具体值（"举例式"守护，改成回显**其它**字段仍可存活），本轮补**恒定性**断言：8 组敌意输入
  （未来字段 / 控制字符值 / 控制字符**键名** / 嵌套路径 / 字符串 / 数组 / 数字 / 布尔）输出必须
  **完全相同**，且零控制字节、零 `/Users/alice`、零 `C:\Users`、零时间戳。
- `scripts/graph-semantic-diff.mjs`：`describeBuilderRecord` 的十六进制闸口原本就在，但 D6 让这条路径
  从"防御性冗余"升为**唯一防线**，故补一条真子进程用例。真跑实证（两图 builder 均不可解析、
  含控制字符键名）：
  ```
  [provenance]   builder: old unrecognized（记录值不可识别） → new unrecognized（记录值不可识别）
                 （差异在未展示字段：<非常规字段名>, <非常规字段名>, builtAtIso, commit, distSha256）
  ```
  ESC 字节 0，`/Users/alice` `/Users/bob` `/etc/passwd` `2026-08-08` `evilKey` 全部零外泄——
  **只有消毒后的键名**出现（`[A-Za-z0-9_.-]{1,40}`、最多 5 项），值一个字符都没进输出。

### 文案连带订正（D6 使旧措辞变成不可达假设）

`unstamped` 分支上一版挂着「**或曾被回写链路降级**」的兜底措辞——那是第三轮对 C1 的**有限缓解**。
D6 从写盘侧根除该通道后，这条成因不再可达，留着就是一句无法发生的假设，故收窄回
「未盖章 build / 源码直跑写出」。（第三轮 C1 一节的原文按惯例保留不改，以本节为准。）

### 明确不做（裁决点名）

**不**扩 `scanGraphPortabilityViolations` 去扫 `graph.graph`。职责边界：写入侧的值域校验管"我们
自己写什么"，保留通道管"别人写的我们看不懂的东西别动"；混起来会新增一片误报面（保留态的外来值
**本就预期**不合我们的值域，扫一次报一次）。

## 变异测试（守护力验证；全部在 `/private/tmp/.../mut` 的仓库副本上做，worktree 一字未改）

| 变异 | 内容 | 结果 |
|------|------|------|
| M-D6-1 | 保留分支回退成 D6 前的 `collapse to null` | **被杀** — 4 条红 |
| M-D6-2 | `unrecognized` 分支"顺手回显 recorded 帮助排查"（追加 `JSON.stringify(rawRecorded)`） | **被杀** — 2 条红 |
| M-D6-3 | banner 的 `diffTopLevelKeys` 去掉键名消毒 | **被杀** — 2 条红 |

副本上复原后 `grep -c MUTATION` 三文件均为 `0`，复原批 `Tests 64 passed (64)`；worktree 全程未参与变异。

## 第四轮改动文件清单（确切路径）

**生产代码**

- 改 `src/panoramic/graph/graph-builder.ts`（保留分支拆成"可解析→投影 / 不可解析→原样不动" +
  `BuilderProvenanceMode` 文档订正）
- 改 `src/cli/commands/graph-quality.ts`（`unstamped` 措辞收窄 + `unrecognized` 分支补"输出 MUST 与
  记录内容无关"的不变量注释 + 七态表订正；**判据与渲染逻辑零改动**）
- 改 `src/panoramic/graph/builder-stamp.ts`（**仅文件头注释**：把"零时间戳 / 零路径"硬约束的作用域
  如实化为「本版本 producer 写出的值」，并说明防线为何可以让渡给消费侧）
- 改 `src/panoramic/graph/graph-types.ts`（**仅 `builder` 字段注释**：本类型不是磁盘取值全集，
  消费方 MUST 经 `parseGraphBuilderStamp` 防御性解析）

**测试**

- 改 `src/panoramic/graph/graph-builder.test.ts`（原 A-W1 collapse 用例改写为 D6 保留用例，另增 3 例：
  非对象形态 / 值域不合规 / 保留态连写两次逐字节相同）
- 改 `tests/panoramic/community-persist.test.ts`（新增 D6 第三支：更新版本 stamp 经 community 原值一字不变）
- 改 `tests/unit/graph-quality-builder-advisory.test.ts`（新增 `unrecognized` 输出恒定性用例，8 组敌意输入）
- 改 `tests/unit/graph-semantic-diff-provenance-banner.test.ts`（新增 D6 零外泄用例，真子进程）

**规划制品（裁决允许的就地批注，原文一律保留）**

- 改 `specs/261-fix-graph-builder-stamp-notes/plan.md`（§2 第 38 行 / §7.3 文案样例 / §7.4 (B-2) 三处
  追加「已被裁决取代 / 豁免 / 证伪」批注 + 新口径一句话；**未重写任何原文**）
- 改 `specs/261-fix-graph-builder-stamp-notes/implementation-notes.md`（本节）

## 第四轮五项验证实跑输出

（退出码均用 `cmd > log 2>&1; echo $?` 单独取，规避 F235 birpc 陷阱）

| # | 命令 | 退出码 | 输出摘要 |
|---|------|--------|----------|
| 1 | `npm run build` | **0** | `tsc` 无输出；`[postbuild:stamp] 盖章: commit=0d3e385f (dirty)` |
| 2 | `npx vitest run` | **0** | `Test Files 530 passed \| 4 skipped (534)`；`Tests 7304 passed \| 18 skipped \| 21 todo (7343)` |
| 3 | `npm run test:plugins` | **0** | `tests 1580 / suites 267 / pass 1580 / fail 0` |
| 4 | `npm run repo:check` | **0** | 86 项 `pass`；唯一 `warn` 仍是既有 `graph-quality:freshness`（在盘图 sourceCommit=`8d25c264`，一/二/三轮已登记的基线现象，非本轮引入） |
| 5 | `npm run release:check` | **0** | `Release contract valid (contracts/release-contract.yaml)` |

## 第四轮 `[E2E_DEFERRED]`

**无**。D6 的写盘侧与两条消费侧均有真 dist / 真子进程端到端实跑证据（见上文 A/B 表）。

## 第四轮 · 残余风险（**已被文末「第四轮 · 对抗复审」的同名小节取代**，原文保留）

1. **磁盘上会长期存在读不懂的 builder 值** —— 这是 D6 的**设计意图**而非缺陷，但需登记其代价：
   `graph.graph.builder` 的 TypeScript 类型不再是磁盘取值的全集。当前三个消费点
   （`writeKnowledgeGraph` / `describeBuilderStamp` / `graph-semantic-diff.mjs`）**全部**防御性解析，
   已实查无第四个消费点（全仓 `graph.graph` grep 命中只剩注释与 `sourceCommit` / `fingerprint` /
   `schemaVersion` 三个既有字段）。**将来新增消费方必须经 `parseGraphBuilderStamp`**，已写进
   `graph-types.ts` 字段注释。
2. **`{ builder: undefined }`（键在、值为 undefined）的行为有一处静默变化**：D6 前会被 collapse 成
   `null` 写盘（消费侧 `unstamped`），D6 后键被 `JSON.stringify` 省略（消费侧 `unrecorded`）。
   该形态**不可能来自 JSON.parse**（JSON 无 undefined），只能由进程内调用方构造；且新行为与
   `describeBuilderStamp` 对 `rawRecorded === undefined` 的既有归类（`unrecorded`）一致，属**收敛**
   而非漂移，故不加代码特判，仅此登记。
3. **`scanGraphPortabilityViolations` 仍不扫 `graph.graph`**（裁决点名不做）。后果：保留态的外来
   绝对路径不会触发 portable 告警。危害路径已在**输出侧**封死（两处 `unrecognized` 均零回显，有用例），
   但"图文件本身不再保证零绝对路径字面量"这条需在将来讨论图可移植性时想起来。
4. **第三轮遗留的结构性盲区仍在**（未变）：两图都由源码直跑建出时 builder 两侧均 `null`，
   provenance 三维全等 ⇒ 不打 banner，而两图确实可能由不同工具状态建出。
5. **F8 的跨环境 byte 一致收窄**（未变，一/二轮已登记并选择接受）。

---

# 第四轮 · 对抗复审回合（两路独立异构对抗）

> 审查档位：**内部异构对抗 ×2**（角 A = 前向兼容语义 + 数据完整性；角 B = 回归面 + 合同漂移）。
> ⚠️ **Codex 审查暂停，异构档位缺席**——本改动属 provenance 事实源与判定相邻面，按 CLAUDE.local.md
> 纪律显式登记该缺席，配额恢复后可回补。两路均禁止 git 写 / 禁止改 worktree，变异实验在
> `/private/tmp/claude-501/` 副本上做。**下列每条都经我方独立实跑复现后才动手**，未直接采信转述。

## 已修（复审新发现）

### A-W1（CRITICAL 级实质）：「可解析」≠「覆盖无损」—— D6 在**唯一现实的冲突点**上被绕过

`parseGraphBuilderStamp` 解构固定 5 键后重建对象，额外键一律丢弃；而本模块的演进口径**恰恰是
"加字段不必 bump `formatVersion`"**（`builder-stamp.ts` 文件头的显式论证：builder 不参与判定，
所以没有 F249 那种"必须 bump"的收益）。两者相乘：

| 原值 | 分流 | D6 前 | D6 第一版 | 第四轮终态 |
|---|---|---|---|---|
| `formatVersion: 2` + 未来字段 | 不可解析 | collapse → null | **原样保留** ✅ | 原样保留 ✅ |
| `formatVersion: 1` + 未来字段（**现实演进路径**） | **可解析** | 投影 → 削字段 | **投影 → 削字段** ❌ | **原样保留** ✅ |

即 D6 第一版的三条用例（全部用 `formatVersion: 2` 或非对象形态构造）**系统性绕开了唯一会真实
发生的那一支**。真 CLI 复现（修复前）：`{…5 字段, nodeVersion, FUTURE_CANARY}` 过一次 community
→ 两个字段静默消失、`community` 报成功。

**修法**：保留通道的判据从"能不能解析"改成"**覆盖会不会丢信息**"——新增
`isStampProjectionLossless()`（键集合 ⊆ 已知 5 项才算无损），只有无损时才用投影覆盖。
修复后真 dist 实证：community 前后 keys 均为 7 项，一字未丢。

**连带：第二轮 A-W1 的磁盘侧口径被本轮反转并如实登记。** 第二轮要求"保留 = 投影后保留"以阻止外来
`builtAtIso` / 绝对路径落盘；它与前向兼容在同一分支上不可兼得。第四轮取舍是**写盘侧不承担销毁证据
的职责**，安全性由消费侧独立承担（该形态可解析 ⇒ advisory 走正常 stamp 文案，额外键根本不参与渲染，
有用例断言）。原用例反转为「带外来键的合法 stamp 原样保留 + 外来键不进任何渲染面」，注释保留脉络。

### A-W2（角 A）：`'builder' in graph.graph` 给写盘出口引入新抛出面 —— `spectra community` **半途失败**

`cli community` 的入口校验只查 `nodes` / `links` 是数组、**不查 `graph`**；F261 之前
`writeKnowledgeGraph` 对 `graph.graph = null` 不抛（守卫与归一化都不碰它，除非 stripTimestamps）。
真 CLI 复现（修复前）：

```
✓ GRAPH_REPORT.md 已生成: …/_meta/GRAPH_REPORT.md
[community] 社区分析失败: Cannot use 'in' operator to search for 'builder' in null   ← exit 1
nodes[0].metadata = {'sourcePath': 'a.ts'}    ← community id 未落盘
```

危害是**半成功**：一个产物已重写、另一个没有，两者就此不一致。讽刺的是同一改动的
`describeBuilderStamp` 为**完全相同的形态**加了显式收口（注释还写着"一次抛出就是 exit 2"），
**防御只加在了读侧，写侧照抄了那行裸 `in`**。

**修法**：`graph.graph` 非对象形态一律**跳过 builder 处置**（诚实降级，不中断写盘、不造假）。
修复后真 dist：`graph.graph = null` 时 community **exit 0**、零报错、4 个节点 community id 正常落盘。

### B-C1（角 B）：`verifyBuildStamp` **这个函数在全仓不存在**，却被带精确行号引用了两次

其中一处是**留给下一任的行动指令**（"若升为门禁必须接上 hash 复算（`verifyBuildStamp` 或等价物）"）。
实查：`scripts/lib/spectra-version-gate.mjs` 的导出只有 `hashDistTree` / `stampBuild` /
`verifySpectraVersion`；被引用的 164-177 行确实在重算 dist hash，但那是 `verifySpectraVersion`
（起于 128 行）的**函数体内部片段**，不是可被"接上"的独立 API。

**更严重的是这条曾被登记为"已核实"**：第三轮验收表写的 "(b) 全仓 `verifyBuildStamp` 3 处命中
**全是注释**，零调用点" —— 那句话本身就是**该函数不存在的证据**，却被反向解读成"确认无调用点"。
与 F257 登记的"演绎证明与穷举互相背书出假结论"同型。已订正代码注释（改指
`verifySpectraVersion` 的内联片段并**去掉写死行号**，行号会随文件编辑漂移，漂移了的精确行号比
没有行号更误导），并在第三轮验收表原处加了推翻批注。

### B-C2（角 B）：四个调用点的 provenance 声明字面量**零护栏**，且注释声称"有 E2E 用例钉住"

F261 把控制信号从"对象形态反推"改成"caller 传参"，消除了绕过面，**但把正确性完全押在四个调用点的
字面量上**。角 B 变异实测（整树副本，A/B 归属控制排除了副本缺 `.git` 造成的 8 条既有红）：

- `cli/commands/graph.ts` 的 `stamp-this-build` → `preserve-recorded`（建图链路静默不盖章）
- `cli/commands/community.ts` 的 `preserve-recorded` → `stamp-this-build`（**= 本特性立项要抓的
  伪造 provenance 形态本身**）

**全量 7000+ 用例无一变红。** 而 `WriteKnowledgeGraphOptions` 的 JSDoc 当时写着"有 E2E 用例把三条
生产链路钉住"——假的。`community-persist.test.ts` 那几条也**不算**：它们手写
`{ builderProvenance: 'preserve-recorded' }` 复刻 community 的步骤，**把被测的那个开关当成了输入常量**，
守的是 `writeKnowledgeGraph` 的内部分支。

**修法**：在 `tests/integration/graph-command-sourcecommit.test.ts`（本仓唯一真正调用
`runGraphCommand` / `runCommunityCommand` 的用例文件）补 3 条调用点护栏，并把 JSDoc 的覆盖声明改成
**逐调用点的如实表格**（含"batch 主链只被 charter 快照间接约束、是较弱一环"的登记）。

### B-W1（角 B）：`describeBuilderStamp` 的"任何输入都不得抛异常"是假的

上一版只折叠了**内层** `graph.graph`，而函数第一条语句 `graph.graph` 在 `graph` 自身为 `null` /
`undefined` 时就已经抛了（角 B 17 组敌意输入里正是这 2 组穿透）。该不变量被 JSDoc 与 `short()`
注释双双声明为**不依赖调用方**的纵深防御，只挡内层等于按其自身口径没成立。
**修法**：两层都收口。同时把 JSDoc 的作用域写准为"任何由 `JSON.parse` 能产出的输入"，并**明确
登记不用 try/catch 兜底**的理由（catch-all 会吞掉真 bug；宁可把不变量写准也不用包住一切的 catch
去凑一句更漂亮的绝对句）。

### A-W3（角 A）：「消费侧不回显任何原始记录内容」这句 D6 承重论据**是绝对句、且为假**

`graph-semantic-diff` 在两侧渲染值相同时会列出差异落点的**键名**，键名来自外来 JSON：

```
[provenance]   builder: old unrecognized（记录值不可识别） → new unrecognized（记录值不可识别）
               （差异在未展示字段：<非常规字段名>, LEAKED-SECRET-CANARY, builtAtIso, formatVersion, <非常规字段名>）
```

**这不是注入洞**（消毒正则确实把 ESC 序列键与超长键折成了 `<非常规字段名>`，值一个字都没出来，
我方独立复验），但那句话被写成绝对陈述并当作"写入侧可以不销毁证据"的前提——正是前三轮栽过三次的
同一种病。**修法**：改成如实表述「**值不回显；少量经字符集消毒（`[A-Za-z0-9_.-]{1,40}`、最多 5 个）
的外来键名会回显**」，并把"键名也算内容"这条代价显式登记为已知并接受。

### A-I3（两路都提到的原型链面）：`in` 走原型链

`Object.prototype.builder` 一旦被污染，一张**本无该键**的存量图会被判成"有记录"，写盘侧走进保留分支
并把它写成**自有属性**（= C-2 用例要防的补写），读侧则会把污染值当成图自己的 provenance 渲染。
两处均改用 `Object.prototype.hasOwnProperty.call`，各配一条污染 `Object.prototype` 的用例。

### A-I1（措辞精度）：`preserve-recorded` 不是「逐字原样」

整条链路是 `JSON.parse` → `JSON.stringify`，其固有归一化（`1e999 → null`、`-0 → 0`、超 f64 精度整数
被舍入）对**整份 graph.json**（含 `fingerprint`、节点 metadata）同样成立、且早于本特性存在。
已把文件头的"逐字原样"改成"不做任何字段级改写"并附上该精度边界。"同一输入连写两次逐字节相同"
这条**严格成立**且有专门用例（我方复验通过）。

## 变异测试（本轮新增护栏的守护力；全部在 `/private/tmp/.../mut2` 副本上做）

| 变异 | 内容 | 结果 |
|------|------|------|
| M4 | `community.ts` 声明翻成 `stamp-this-build`（伪造 provenance） | **被杀** — 2 条红（复审前此变异全绿存活） |
| M5 | `graph.ts` 声明翻成 `preserve-recorded`（建图链路静默不盖章） | **被杀** — 1 条红（同上，复审前存活） |
| M6 | 保留通道去掉无损判据，退回"只看可解析" | **被杀** — 2 条红 |
| M7 | 去掉 `graph.graph` 非对象收口（退回裸 `in`） | **被杀** — 先被**类型系统**杀（`TS18047: 'meta' is possibly 'null'`，连带 build 失败）；另做一版把类型断言掉的变体以隔离运行期守护力 → A-W2 用例红 |
| M8 | `hasOwnProperty` 退回裸 `in` | **被杀** — 1 条红 |
| M9 | `describeBuilderStamp` 去掉外层收口 | **被杀** — 1 条红 |

副本上四个生产文件复原后 `grep -c MUTATION` 全为 `0`，复原批 `Tests 65 passed (65)`；
worktree 全程未参与变异。

## 复审处置后的第四轮改动文件清单（在本轮上文清单之上）

- 改 `src/panoramic/graph/builder-stamp.ts`（新增 `isStampProjectionLossless` + `STAMP_KEYS`；
  文件头三处订正：B-C1 符号名 / A-W3 如实表述 / A-I1 精度边界）
- 改 `src/panoramic/graph/graph-builder.ts`（A-W2 入口收口 + A-I3 `hasOwnProperty` +
  A-W1 无损判据 + B-C2 覆盖声明改为如实表格）
- 改 `src/cli/commands/graph-quality.ts`（B-W1 外层收口 + A-I3 `hasOwnProperty` + JSDoc 作用域写准）
- 改 `src/panoramic/graph/graph-builder.test.ts`（A-W1 原用例反转 + 新增 A-W1/A-W2/I-3 共 4 条）
- 改 `tests/unit/graph-quality-builder-advisory.test.ts`（新增 B-W1 / I-3 两条）
- 改 `tests/integration/graph-command-sourcecommit.test.ts`（**新增 3 条调用点护栏**，B-C2）
- 改 `specs/261-fix-graph-builder-stamp-notes/plan.md`（B-W2：补标 §4 memoize 语义 / §9 T-R2 /
  §2 第 40 行三处漏标；§7.3 的 `487-492` 行号改为不写死的描述性引用）
- 改 `specs/261-fix-graph-builder-stamp-notes/implementation-notes.md`（本节 + 第三轮 D4 验收表订正）

## 复审处置后的终态验证（五项全绿）

| # | 命令 | 退出码 | 输出摘要 |
|---|------|--------|----------|
| 1 | `npm run build` | **0** | `tsc` 无输出；`[postbuild:stamp] 盖章: commit=0d3e385f (dirty)` |
| 2 | `npx vitest run` | **0** | `Test Files 530 passed \| 4 skipped (534)`；`Tests 7304 passed \| 18 skipped \| 21 todo (7343)`（日志里唯一的 `FAIL` 字样是某 fixture 文本 `[jury] … rate limit`，非用例失败） |
| 3 | `npm run test:plugins` | **0** | `tests 1580 / pass 1580 / fail 0` |
| 4 | `npm run repo:check` | **0** | 86 项 `pass`；唯一 `warn` 仍是既有 `graph-quality:freshness`（一/二/三轮已登记的基线现象） |
| 5 | `npm run release:check` | **0** | `Release contract valid (contracts/release-contract.yaml)` |

## 角 B 复核通过、结论为真的既有断言（附验法，非目视）

`stampBuild` 行号 68-90 精确 / 两个 dirty flag 确取自 build 时刻 / `graph-assembly.ts:265-267`
`stripTimestamps:true` / `scanGraphPortabilityViolations` 确实不扫 `graph.graph` / 本模块与
`source-commit.ts` 同样未进 barrel / `MAX_ASCENT=2` 的三形态结论 / `dist/.spectra-build-meta.json`
确实进 npm tarball（`npm pack --dry-run --json` 实证）/ `graph-quality-report.schema.json` 顶层
`additionalProperties:false` 且 `--json` 无 builder / `writeKnowledgeGraph` 是 graph.json 唯一写盘出口 /
batch 主链的 graphJson 确由本进程 `buildKnowledgeGraph` 现建 / 入库 pinned 资产该变的都变了且
f220 快照是纯增行 / `graph-semantic-diff.mjs` 无任何自动化消费方 —— 共 14 条，全部为真。

## 本轮**未修 · 仅登记**（超出「保留通道 + 相应文案」范围，留给主线程分流）

| ID | 内容 | 为何不在本轮修 |
|---|---|---|
| B-W3 | `implement.md` 新增的 `implementation-notes.md` 约定**读取侧没有接线**：`spec-driver-resume` 的断点判定只认 `spec.md` / `tasks.md` / 代码变更，不读该文件；`workflows/spec-driver-resume.yaml` 的 `artifacts` 段也没有它。文案里"恢复方唯一能从磁盘无损读到的进度事实源"是**断言未来**而非描述现状 | 属 spec-driver 编排面改动，与本 fix 的图 provenance 面正交；改 resume 判定是独立需求 |
| B-I5 | `WriteKnowledgeGraphOptions` / `BuilderProvenanceMode` 未进 `panoramic/graph/index.ts` barrel，而 `writeKnowledgeGraph` / `NormalizeGraphOptions` 在里面。`builder-stamp.ts` 里"不扩 barrel"的论证覆盖的是 stamp 模块本身，**没覆盖这两个已经出现在导出函数签名上的类型** | 不影响编译（对象字面量可推断）；扩 barrel 属公共面决策，不该由一个 fix 顺手做 |
| B-I4 | `builder-stamp.ts` 在**模块加载期**做同步 I/O（≤3 次 `existsSync` + 1 次 `readFileSync`） | 是 F5 裁决的**刻意结果**（惰性抓取会给旧代码建的图盖新章），量级可忽略，已在文件头登记 |
| A-I4 | `canonicalJson` / `diffTopLevelKeys` 递归无深度上限 | 未复现为可用攻击：`JSON.parse` 在同等深度先抛 `RangeError`，`loadGraph` 先死 |
| A-I2 | `graph-only-pipeline.test.ts` 的 T-R4a 在 vitest 下 stamp 恒为 `null`，断言实为 `null === null` | 覆盖不缺：真正有守护力的是走真 dist 的 `builder-stamp-e2e.test.ts` D5 用例；仅注释高估了它的定位价值 |
| B-I2 | `graph-types.ts`（undefined 与 null "同等处理"）/ `graph-quality.ts`（三态"MUST NOT 合并"）/ `graph-semantic-diff.mjs`（`?? null` 主动归一）三处口径各有理由但互不点明 | 三处**判定上确实等价**、只在人读措辞与触发条件上分列，不构成矛盾；统一交叉引用属文档整备 |

## 第四轮 · 残余风险（复审后刷新，替代上文同名小节）

1. **磁盘上会长期存在读不懂 / 带外来键的 builder 值** —— D6 的设计意图。三个消费点全部防御性解析，
   已实查无第四个（`plugins/` / `contracts/` 侧对 `graph.graph` 的读取只有 `sourceCommit`）。
   将来新增消费方 MUST 经 `parseGraphBuilderStamp`，已写进 `graph-types.ts` 字段注释。
2. **外来 `builtAtIso` / 绝对路径现在会留在磁盘上**（第二轮 A-W1 磁盘口径被本轮反转的直接代价）。
   危害路径在**输出侧**封死；`scanGraphPortabilityViolations` 按裁决仍不扫 `graph.graph`，
   故"图文件本身零绝对路径字面量"这条不再是全称命题——讨论图可移植性时需想起。
3. **banner 会回显少量经消毒的外来键名**（值不会）。已在文件头如实表述，非绝对句。
4. **batch 主链的 `stamp-this-build` 声明仍是四个调用点里最弱的一环**（只被 f220 charter 快照的
   `"builder": null` 间接约束键存在性）。已在 JSDoc 表格里显式标注，未额外造用例——该链路跑真 LLM
   batch，成本与收益不匹配。
5. **`{ builder: undefined }` 的行为静默变化**（D6 前 collapse 成 `null` ⇒ `unstamped`；D6 后键被
   `JSON.stringify` 省略 ⇒ `unrecorded`）。该形态不可能来自 `JSON.parse`，且新行为与
   `describeBuilderStamp` 对 `undefined` 的既有归类一致，属收敛而非漂移。已实跑核实。
6. **第三轮登记的结构性盲区仍在**（两图都源码直跑时 provenance 三维全等 ⇒ 不打 banner）。
7. **F8 的跨环境 byte 一致收窄**（一/二轮已登记并选择接受）。

---

# 第五轮（Phase 4c 复审 W-1 收口 —— 裸子串断言的守护力缺口）

> 本轮**只动测试断言**，外加对 `implement.md` 的一处结构化微调（使必填项可被结构锚定）。
> `src/` 生产代码一字未改（`git diff --stat src/` 与第四轮终态逐字相同）。

## W-1 的修复前实证（不是推演，是在副本上跑出来的）

删掉 `plugins/spec-driver/agents/implement.md` 里「**已知偏差**」那条必填 bullet（第 94-95 行两行），
`tests/unit/spec-driver-implement-notes-contract.test.ts` 实跑：

```
 ✓ tests/unit/spec-driver-implement-notes-contract.test.ts (20 tests) 2ms
 Test Files  1 passed (1)
      Tests  20 passed (20)
```

**20 条全绿存活**。根因：断言是**裸子串**（`toContain('已知偏差')`），而同一节的散文里恰好写着
"不回答"下一步动哪个文件、有哪些**已知偏差**"" —— 连 section-scoped 那条也被这句散文满足。
六个必填字面量中 `下一步` / `已知偏差` / `覆盖` 各有 2 处命中，**三者均可被同样绕过**；
`implementation-notes.md` / `当前 Phase` / `已完成任务 ID` 当时各只 1 处，靠"恰好没重名"侥幸有守护，
判据本身同样不成立。属"粗粒度有守护（整段删除仍红 7 条）、细粒度有缺口"。

## 修法：把断言从"该节任意位置出现过"锚到 **bullet 结构**

### 1. `implement.md` 的结构化微调（additive，零删除）

原文里两项必填内容以**散文**承载，结构上不可锚：落盘目标路径写在段落中间、
"覆盖而非追加"写在列表之后的收尾段。改为两条独立字段行，**语义一字未减**：

```
   - **落盘文件**：`{feature_dir}/implementation-notes.md`；该文件属于 feature 制品，随需求一并提交
   - **写入方式**：**覆盖**写入，而非追加（恢复方要的是当前状态，不是流水账）
```

`git diff plugins/spec-driver/agents/implement.md` 相对 master **零 `-` 行**（整块是本特性新增的），
既有委派硬约束 / F208 依从性判定 / goal_loop frontmatter / 三层验证体系四段一个字节未动。
`repo:check` 的同步类门禁交叉确认：`preference-rules:agent-block-sync`、
`delegation-contract:codex-wrapper-block-sync`、`spec-driver-wrappers:*`（5 项）、
`namespace-consistency:agent-frontmatter-implement`、`worktree-local-state:agents-byte-budget`
**全部 pass** ⇒ 生成块与 wrapper sha 面未被触及，**无需 `npm run repo:sync`**（也就没有再造那 19 个再生噪声）。

### 2. 测试改为结构锚（六项逐一收紧，不只修 `已知偏差`）

| 必填字面量 | 结构锚 |
|---|---|
| `implementation-notes.md` | `- **落盘文件**：` bullet，且**同一行**内含代码跨度 `` `{feature_dir}/implementation-notes.md` `` |
| `当前 Phase` | `- **当前 Phase**：` bullet |
| `已完成任务 ID` | `- **已完成任务 ID**：` bullet |
| `下一步` | `- **下一步**：` bullet |
| `已知偏差` | `- **已知偏差**：` bullet |
| `覆盖` | `- **写入方式**：` bullet，且**同一行**内含 `覆盖` |

锚正则统一由 `fieldBulletAnchor` / `fieldBulletAnchorWithValue` 生成
（`^[ \t]*[-*][ \t]+\*\*<label>\*\*[ \t]*[：:]`，`m` 标志），**散文里的同名提及不再算数**。
所有锚仍在第 5 节切片内匹配（section-scoping 未削弱，反而并入每条用例）。
另加一条 `四项快照字段同属「MUST 包含以下四项」那一条列表，且顺序不变`——防止有人把 bullet
挪出列表或打乱顺序仍算通过。用例数 20 → 21。

## 六组变异实证（Round A：单独删掉该 bullet）

副本位置 `/private/tmp/claude-501/.../scratchpad/mut`（`node_modules` 软链回 worktree，
自带 `vitest.mut.config.ts`）；worktree 的 `implement.md` 全程未参与变异。

| 变异 | 删除内容 | 新用例结果 | 撤回后 |
|---|---|---|---|
| M1 | `- **落盘文件**：…`（1 行） | **红 1 条**（`…：implementation-notes.md`）→ `Tests 1 failed \| 20 passed (21)` | `21 passed (21)` |
| M2 | `- **写入方式**：…`（1 行） | **红 1 条**（`…：覆盖`）→ `1 failed \| 20 passed (21)` | `21 passed (21)` |
| M3 | `- **当前 Phase**：…`（1 行） | **红 2 条**（锚 + 四项列表）→ `2 failed \| 19 passed (21)` | `21 passed (21)` |
| M4 | `- **已完成任务 ID**：…`（2 行） | **红 2 条** → `2 failed \| 19 passed (21)` | `21 passed (21)` |
| M5 | `- **下一步**：…`（1 行） | **红 2 条**，首条报 `to match /^[ \t]*[-*][ \t]+\*\*下一步\*\*…/m` | `21 passed (21)` |
| M6 | `- **已知偏差**：…`（2 行） | **红 2 条**，首条报 `to match /^[ \t]*[-*][ \t]+\*\*已知偏差\*\*…/m` | `21 passed (21)` |

M5 / M6 的失败信息值得单独看：删 bullet 后散文里的 `下一步` / `已知偏差` **仍在**，
所以前置的弱条件 `toContain` 照样过，是**结构锚**把它判红的——正是 W-1 那条缺口的直接对偶证据。

## 六组变异实证（Round B：删 bullet + 注入散文顶包 —— 决定性对照）

Round A 里 M1-M4 是因为删完就没有任何同名子串才红的，这只能证明"没被削弱"，不能证明"锚生效"。
故追加 Round B：删掉 bullet 的同时，在同一节注入一句含该字面量的**散文**（如
`落盘目标仍然是 implementation-notes.md 这个文件。`）。副本里同时跑两套断言——
`legacy-naked-substring.test.ts` 是修复前逻辑的原样复刻（5 条裸子串 + 1 条 section-scoped + 1 条 `覆盖`，共 7 条）。

| 变异 | 注入的散文 | LEGACY（修复前逻辑） | 新断言 |
|---|---|---|---|
| B1 | `落盘目标仍然是 implementation-notes.md 这个文件。` | **7/7 绿（漏检）** | **红 1** |
| B2 | `顺带一提，写入是覆盖而不是追加。` | **7/7 绿（漏检）** | **红 1** |
| B3 | `顺带一提，快照里要说清当前 Phase。` | **7/7 绿（漏检）** | **红 2** |
| B4 | `顺带一提，快照里要列出已完成任务 ID。` | **7/7 绿（漏检）** | **红 2** |
| B5 | `顺带一提，快照里要写下一步。` | **7/7 绿（漏检）** | **红 2** |
| B6 | `顺带一提，快照里要写已知偏差。` | **7/7 绿（漏检）** | **红 2** |

（LEGACY 全绿由每轮 `Tests N failed | M passed (28)` 中失败项**全部来自新 describe** 读出：
B1/B2 为 `1 failed | 27 passed (28)`，B3-B6 为 `2 failed | 26 passed (28)`。）

六组变异全部撤回后复跑 `Test Files 2 passed (2)` / `Tests 28 passed (28)`，
`diff -q` 确认副本 `implement.md` 与 pristine 逐字节相同。

## 第五轮改动文件清单（确切路径）

- 改 `tests/unit/spec-driver-implement-notes-contract.test.ts`（T-R6a 的六条断言全部改为结构锚 +
  新增四项列表分组/顺序用例；T-R6b 回归防线一字未动）
- 改 `plugins/spec-driver/agents/implement.md`（第 5 节落盘约定：两项散文改为 `- **落盘文件**` /
  `- **写入方式**` 两条字段行；additive，零删除）
- 改 `specs/261-fix-graph-builder-stamp-notes/implementation-notes.md`（本节）

**生产代码零改动**（`src/**` 未出现在本轮清单中）。

## 第五轮五项验证实跑输出

（退出码均用 `cmd > log 2>&1; echo $?` 单独取，规避 F235 birpc 陷阱）

| # | 命令 | 退出码 | 输出摘要 |
|---|------|--------|----------|
| 1 | `npx vitest run` | **0** | `Test Files 530 passed \| 4 skipped (534)`；`Tests 7305 passed \| 18 skipped \| 21 todo (7344)` |
| 2 | `npm run build` | **0** | `tsc` 无输出；`[postbuild:stamp] 盖章: commit=0d3e385f (dirty)` |
| 3 | `npm run test:plugins` | **0** | `tests 1580 / suites 267 / pass 1580 / fail 0 / duration_ms 30025` |
| 4 | `npm run repo:check` | **0** | 86 项 `pass`；唯一 `warn` 仍是既有的 `graph-quality:freshness`（在盘图 sourceCommit=`8d25c264`，前四轮已登记的基线现象，非本轮引入） |
| 5 | `npm run release:check` | **0** | `Release contract valid (contracts/release-contract.yaml)` |

用例数由第四轮的 7344 项口径变化：`+1`（新增四项列表分组/顺序用例），与上表 `21 passed` 一致。

## 第五轮 `[E2E_DEFERRED]`

**无**。本轮改动面就是文本契约本身，守护力已由 12 组变异（Round A ×6 + Round B ×6）实证。

## 第五轮残余风险

1. **锚定的是 Markdown bullet 的字面形态**（`- **<label>**：`）。若将来有人把该节整体换成表格
   或定义列表来表达同样契约，用例会红——这是**有意的**：契约的机器可定位性正建立在这个形态上，
   要换形态就该同步换判据，而不是让判据宽到什么都能过。
2. **`T-R6b` 回归防线（11 条 `PRESERVED_LITERALS`）仍是裸子串**。本轮按任务边界只收紧了 T-R6a 的
   六项。这批字面量守的是"既有硬约束别被误删"，散文顶包风险显著更低（它们是小节标题/整句祈使），
   但**同一类缺口在原理上仍在**，如需一并收紧应作为独立改动评估。
