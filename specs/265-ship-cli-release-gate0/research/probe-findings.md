# F265 编排器实测探针（plan / implement 阶段的地基）

> 由主编排器在 specify 阶段并行实测。每条都附可复跑命令。**这些是实测事实，不是推断。**

## P1 — MCP `serverInfo` 补自定义字段是**死功能**（决定 G0-3 的实现路线）

官方 SDK（`@modelcontextprotocol/sdk`，本仓 zod 3.25.76）的 `InitializeResultSchema.serverInfo` 是
`ImplementationSchema = BaseMetadataSchema.extend(...)`，底座是 **`z.object()`（strip 未知键）**，
而不是顶层 `ResultSchema` 用的 `z.looseObject`。

复跑：

```bash
node --input-type=module -e "
import { ImplementationSchema, InitializeResultSchema } from '@modelcontextprotocol/sdk/types.js';
console.log(JSON.stringify(ImplementationSchema.parse({name:'spectra',version:'4.5.0',commit:'abc1234',dirty:false})));
console.log(JSON.stringify(InitializeResultSchema.parse({protocolVersion:'2025-06-18',capabilities:{},serverInfo:{name:'spectra',version:'4.5.0',commit:'abc1234'},_meta:{'spectra/build':{commit:'abc1234'}},topLevelExtra:1})));
console.log(Object.keys(ImplementationSchema.shape));
"
```

实测输出：

| 放置位置 | 是否穿过客户端 SDK 解析 |
|---|---|
| `serverInfo.commit` / `serverInfo.dirty`（自定义键） | ❌ **被 strip**（`{"name":"spectra","version":"4.5.0"}`） |
| `serverInfo.title` / `serverInfo.description` / `websiteUrl` / `icons` | ✅ 保留（`ImplementationSchema.shape` 官方字段：`name, title, icons, version, websiteUrl, description`） |
| `InitializeResult._meta`（顶层） | ✅ 保留 |
| `InitializeResult` 顶层任意自定义键 | ✅ 保留（`ResultSchema` 是 `z.looseObject`） |

**结论**：直接往 `serverInfo` 塞 `commit` / `dirty` 会重演 P1-E 记录的 `metadata.lineRange` 死功能模式
（生产端写了、消费端永远看不到）。G0-3 的可行路线只有：

- **A** `serverInfo.description`（官方可选字段，必穿）承载一行人可读 build 串 —— 零新工具、纯增量、
  向后兼容；代价：是 prose 字段，机器消费要解析。
- **B** 新增一个**自省 MCP 工具**返回 `{version, commit, dirty}` 结构化 JSON —— 机器可读、doctor 可经
  stdio 直调；代价：工具数 17→18（与 SSoT §0"14/17 零调用"的采用率问题相冲，但这个工具有真实消费方 = doctor）。
- **C** A+B 组合。

plan 阶段须在 A/B/C 中裁决并写明理由，**不得**选"serverInfo 补自定义字段"。

## P2 — "已发布版本对应哪个 commit"有权威事实源：npm registry 的 `gitHead`（决定 G0-2 的判据）

复跑：

```bash
npm view spectra-cli --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.version, j.gitHead)})"
```

实测：`4.4.0  0ae3eb70b1b6b2a318f3ef926594ca8d0784a2f3` —— 与 SSoT §0 记的已发布 build 戳 `0ae3eb7` **完全吻合**。
于是 N 的口径可以是确定的：`git rev-list --count <gitHead>..HEAD -- src/`（本仓当前实测 **18**）。

**git tag 不是可用事实源**：全仓只有 3 个 tag（`spectra-v4.0.1` / `spectra-v4.1.0` / `v4.1.1`），命名前后不一致
且停在 4.1.1，落后已发布版本 3 个 minor。

**降级面（F258 教训：新门禁自己 fail-open 是本仓反复出现的缺陷）**：`npm view` 需要网络，CI/离线会失败。
plan 阶段必须显式定义"取不到已发布事实"时的行为，且该行为必须**可见**（进 `payload.warnings`），
不得静默跳过而让判据变成"永远不报"。另需一个**测试可注入的覆盖入口**（环境变量或参数），否则
卡面硬约束"用变异证明会红"无法在离线单测里构造。

## P3 — 本 worktree 环境状态

- `npm run build` 已在本次会话跑过一次（exit 0），`dist/` 已刷新到当前 HEAD；此前 `dist/.spectra-build-meta.json`
  是 `0d3e385f…` + `dirty: true` 的陈旧产物。**后续任何依赖 dist 的验证前仍需确认 build 是最新的。**
- `npm view spectra-cli version` = **4.4.0**（发布断层已实证）。

## P4 — G0-4 的两条基线**都已有可复用底座**，不得新建平行框架（宪法 III）

### P4-a 图质量复测：`scripts/graph-accuracy.mjs` 已存在（632 行，F147 Sprint 3 Phase B.1）

- 用法：`node scripts/graph-accuracy.mjs --source <root> --graph <graph.json> [--language python|ts|java|go] [--baseline-repo] [--baseline-commit] [--baseline-scope] [--ignore-dirs] [--metric] [--write-fixture]`
- 输出 schema 已含 `truthSet{imports, callTargets}` / `graph{totalEdges, callEdges, ...}` / **`callPrecision`** / **`callRecall`** / `coverageMethod` / `notes`。
- 已支持四语言 truth-set 抽取，且 `--baseline-repo` / `--baseline-commit` 就是**外部语料 + 钉版本**的入口
  —— 正好满足 SSoT §9「图解析类验收必须带外部语料第二口径」。
- 自述 Limitations：`label-only` 匹配（不验证 caller 上下文）、不区分 method 与 function。
  → 冻结口径文档必须**如实转述这两条局限**（宪法 IV），不得把 label-only 的 recall 说成 caller recall 的等价物。

**结论**：G0-4 的图质量交付物 ≈ 一层**薄的冻结口径包装**（钉死语料 / commit / scope / 指标 / 复跑命令），
调用既有 `graph-accuracy.mjs`；**不新建指标框架**。

### P4-b F241 的 M-1/M-2/M-3 口径本质是**人工记账协议**，不可能整体脚本化

读 `specs/241-graph-keepalive-kb-grounding/pilot/measurement-design.md`（冻结口径原文）后确认：

| 指标 | 采集方式 | 可脚本化？ |
|---|---|---|
| M-1 grounding 命中率 | 「逐次**手工记账**到 `pilot/mcp-call-log.md`，记账必须在调用当下写」 | ❌ 人工 |
| M-2 impact coverage | 预测集需 implement **之前**冻结；实际集 = `git diff --name-only` 剔纯新增与 specs/ | ⚠️ 部分（对比与算分可脚本化，冻结预测集是人工） |
| M-3 review 发现率 | 同一 diff 起 A/B 两个审查子代理，**人工逐条判真伪**（判读者非盲） | ❌ 人工 |

原文另有两条不可回退的诚实声明：**N=1，禁止写「提升 X%」这类暗示可外推的表述**；
**口径冻结后取数不得回改定义，只能追加「口径缺陷」一节**。

**结论**：卡面说的「可一键重跑的测量脚本」对 F241 口径**只能覆盖 M-2 的计算部分 + P4-a 的图精度**；
M-1/M-3 只能交付**协议文档 + 记账模板**。spec/plan 必须诚实区分这两类，
**不得**把人工协议包装成"脚本"假装自动化（宪法 IV）。

## P5 — CHANGELOG 补写的版本边界锚点（实测 git 考古结果）

CHANGELOG 现停在 `[4.1.1]`，npm 已发布过 4.1.1 / 4.2.0 / 4.3.0 / 4.4.0（`npm view spectra-cli --json` 的 `time` 键）。
需补 **4.2.0 / 4.3.0 / 4.4.0**（追认已发布）+ **4.5.0**（本卡新发）。

每个版本由哪次 commit 在 `contracts/release-contract.yaml` 里设定（`git log -S'version: "X"'` 实测）：

| 版本 | bump 到该版本的 commit | 该版本区间 | 区间 commit 数 |
|---|---|---|---|
| 4.2.0 | `27ce6fbe` feat(170a) | `v4.1.1..27ce6fbe` | 132 |
| 4.3.0 | `fbb0b88a` fix(186) T1 | `27ce6fbe..fbb0b88a` | 140 |
| 4.4.0 | `0d292e3b` chore(release) 双 4.4.0（收口 judge 快照漂移与 npm 落后） | `fbb0b88a..0d292e3b` | 163 |
| 4.5.0（本卡） | 待写 | `0ae3eb70..HEAD` | 71（其中动 `src/` 的 18 个） |

**已发布 build 锚点**：npm `gitHead` = `0ae3eb70`（`fix(release): prepublishOnly vitest 降并发 --maxWorkers=4`），
在 `0d292e3b` 之后 9 个 commit —— 即 4.4.0 的 tarball 实际打包自 `0ae3eb70`，**不是** bump 版本的那次 commit。
G0-2 的 N 计数必须用 `gitHead`（`0ae3eb70`）而非 bump commit，否则会少算 9 个。

区间都是 100+ commit，**按 F2xx 卡聚合**（卡面硬约束：不逐 commit）。可用的现成聚合素材：
`contracts/release-contract.yaml` 的 `productMappingDescription` 字段里已经写好了 spectra（v4.3.0 / v4.2.0 / v4.1.1）
与 spec-driver（v4.4.2 / v4.4.1 / v4.3.0 / v4.2.2 / v4.2.1 / v4.2.0 / v4.1.0 / v4.0.0）的逐版本摘要
—— 这是**已入库的一手叙述**，据此写 CHANGELOG 不属"事后重构"，无需标 `[推断]`；
超出这些摘要与 commit message 字面信息的归纳才需标（宪法 IV，见预检约束 2）。

## P6 — 现状门禁基线（CI 接入前的对照）

本 worktree 实测：

- `npm run repo:check` → **exit 0**，含 1 条 warning：`[graph-quality] 图产物已 stale（source-commit, collector-fingerprint-unrecorded）`（本地图记录的 sourceCommit 是 `8d25c264`，落后 HEAD）。
- `npm run release:check` → **exit 0**，`Release contract valid`，零 warning。

对 CI 接入的两条硬含义：
1. `repo:check` 含 `graph-quality:*` 判据，**依赖 `specs/_meta/graph.json`**（该路径被 gitignore，干净 checkout 没有）
   → CI 里 `repo:check` 必须排在既有 `Build Knowledge Graph`（`batch --mode graph-only`）步骤**之后**，否则必红。
2. `repo:check` 对 warn 是 exit 0（warn 不阻断）——这与本卡新增的"领先 N 个 src commit" warning 的
   非阻断语义一致，**不要**在 CI 里把 warning 提成失败。

## P7 — CHANGELOG `[Unreleased]` 段的归属已考证清楚（FR-004 无需推断）

CHANGELOG 自 **`b3b15fb7` feat(140) Step 8（2026-04-30 21:33）** 之后再没被改过（`git log -- CHANGELOG.md`），
即行 47-290 那段 `[Unreleased]` 就是那次写入的 F140 内容。

判定：

```bash
git merge-base --is-ancestor b3b15fb7 v4.1.1 && echo "F140 段在 v4.1.1 之前"
git log -1 --format='%ci' v4.1.1   # 2026-05-01 12:34:22 —— 比 b3b15fb7 晚 15 小时
```

`b3b15fb7` **是 `v4.1.1` tag 的祖先**，且早 15 小时。→ 该段内容**实际随 4.1.1 一起发布了**，
只是当时没把标题从 `[Unreleased]` 改成版本号。

**对 FR-004 的含义**：处置口径是「归入 `[4.1.1]`（或标注为已随 4.1.1 发布）」，
这是 **git 可证的事实，不需要标 `[推断]`**。文件里 `[4.1.1]` 标题在第 6 行、F140 段在第 47 行的
顺序倒置，是因为 4.1.1 的条目后来被追加在文件顶部而 F140 段原地未动，与本判定不矛盾。
