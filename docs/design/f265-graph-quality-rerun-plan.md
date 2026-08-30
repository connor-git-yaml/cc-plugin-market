# F265 — 图质量复测冻结口径

> **本文件是协议，不是可执行脚本。**
>
> 它只做两件事：(1) 把既有 `scripts/graph-accuracy.mjs` 的调用参数**钉死**成一条可复跑的命令；
> (2) 把两个**不可能脚本化**的人工指标（M-1 / M-3）写成协议 + 记账模板。
> 它**不**新建任何指标框架、不新建采集脚本、不新建校验器。
>
> **状态**：口径冻结于 2026-08-30（F265 implement 阶段）。取数后不允许回改本文件的定义，
> 只允许追加「口径缺陷」一节——这条规则原样沿用 F241 pilot 的冻结声明。

---

## 0. 本卡不产出数字（FR-025）

**本卡只交付尺子，不交付读数。** 下述所有指标的实际数值——图 `callPrecision` / `callRecall`、
adoption 调用分布、M-1 命中率、M-3 发现率——**一律由发布后一周的 `milestone-next` 循环回收并落账**，
不在 F265 的交付范围内。

任何人在本卡的 commit / 报告 / PR 描述里看到具体数字，那都不是本卡的验收结论。

---

## 1. 主复用目标：`scripts/graph-accuracy.mjs`

**不新建平行指标框架**（FR-023）。图精度复测完全复用这个已有脚本（632 行，F147 Sprint 3 Phase B.1）。

### 1.1 它已经输出什么

```text
{
  language, truthSet: { imports, callTargets },
  graph: { totalEdges, callEdges, containmentEdges, otherEdges },
  callPrecision,   // graph 中 call edge 命中真实 call 的比例
  callRecall,      // 真实 call 中 graph 覆盖的比例
  coverageMethod,  // 'label-only'
  notes
}
```

### 1.2 冻结的调用参数

| 参数 | 冻结值 | 理由 |
|---|---|---|
| `--source` | 外部语料 clone 的根目录 | 见 §2 |
| `--graph` | 该语料跑 `spectra batch --mode graph-only` 产出的 `graph.json` | 纯 AST、零 LLM、零认证，复跑成本可忽略 |
| `--language` | `go`（GORM）/ `java`（HikariCP） | `SUPPORTED_LANGUAGES = ['python','ts','go','java']`（脚本第 199 行） |
| `--baseline-repo` | 语料仓路径 | 脚本自带的"外部语料"入口 |
| `--baseline-commit` | 见 §2 钉死的 SHA | **必须钉死**，否则 A/B 不可比 |
| `--baseline-scope` | 见 §2 的 scope 列 | ⚠️ **不给它，前两个会被静默丢弃**——见 §1.3 |
| `--ignore-dirs` | GORM 专用，见 §2.1 | 脚本注释原文："Codex Round 1 CRITICAL fix: 支持透传 ignoreDirs 给 Go extractor (FR-016 GORM 顶层包)" |

### 1.3 ⚠️ `--baseline-scope` 是前两个 baseline 参数的**开关**（实测确认）

脚本第 527 / 541 / 555 行三处都是同一形态：

```js
const baseline = args.baselineScope
  ? { ...(args.baselineRepo ? { repo: args.baselineRepo } : {}),
      ...(args.baselineCommit ? { commit: args.baselineCommit } : {}),
      scope: args.baselineScope }
  : undefined;
```

**只传 `--baseline-repo` + `--baseline-commit` 而不传 `--baseline-scope`，整个 `baseline` 对象是
`undefined`，两个参数被静默丢弃**——命令照跑、结果照出、退出码 0，但产物里没有任何语料/commit 溯源，
事后完全分不清这份数字是哪个语料哪个 commit 上量的。这是典型的静默 no-op，复跑时最容易踩。
本文件 §2.2 的命令因此**三个参数一起给**。

另需说明：`baseline` 是**纯溯源元数据**，会被原样拷进输出，**不改变被测量的内容**
（不筛选文件、不改 truth-set 抽取）。真正影响 Go 侧统计范围的是 `--ignore-dirs`。

---

## 2. 外部语料（FR-024：MUST NOT 只用仓内代码）

**为什么必须外部语料**：F263 的教训是"锚点 238 全程不变但两轮有真缺陷 = 本仓语料盲区"——
只拿本仓库做语料，判据能在真有缺陷时全绿。SSoT §9 因此要求图解析类验收必带外部语料第二口径。

复用 F150/F151 已建立的 `~/.spectra-baselines/` 基础设施，**不新增 clone 脚本、不新增语料**（YAGNI）。

### 2.1 钉死的语料与 commit

以下 SHA 于 2026-08-30 由 `git -C ~/.spectra-baselines/<repo> rev-parse HEAD` 现读现填，**未臆造**：

| 语料 | 语言 | 路径 | 冻结 commit | scope / ignore-dirs |
|---|---|---|---|---|
| GORM | Go | `~/.spectra-baselines/gorm` | `688e8ea00a232bd661c08d3d3ba22750c3b3d95e` | `--baseline-scope gorm-toplevel-package`；实际收窄靠 `--ignore-dirs schema,callbacks,clause,migrator,logger,internal,utils,tests` |
| HikariCP | Java | `~/.spectra-baselines/HikariCP` | `ea81bfb5852216dbfcb1f219742f91b5abceb81b` | `--baseline-scope hikaricp-full-repo`；无 ignore-dirs 先例，复测时若需收窄必须在「口径缺陷」一节记录，不得静默改 |

> `~/.spectra-baselines/` 在家目录、跨 worktree 共享、不入库（`CLAUDE.local.md` 的入库边界表）。
> `SPECTRA_BASELINE_HOME` 可覆盖默认位置。

### 2.2 复跑命令（钉死形态）

> `spectra batch` **没有** `--project` 参数（`spectra batch --help` 实测），它对 **cwd** 生效。
> 因此建图这一步必须在语料目录里跑，用子 shell 避免污染当前工作目录。
> 建图产物默认落在语料仓的 `specs/_meta/graph.json`。

```bash
# --- GORM (Go) ---
git -C ~/.spectra-baselines/gorm checkout 688e8ea00a232bd661c08d3d3ba22750c3b3d95e
( cd ~/.spectra-baselines/gorm && spectra batch --mode graph-only )
node scripts/graph-accuracy.mjs \
  --source ~/.spectra-baselines/gorm \
  --graph ~/.spectra-baselines/gorm/specs/_meta/graph.json \
  --language go \
  --baseline-repo ~/.spectra-baselines/gorm \
  --baseline-commit 688e8ea00a232bd661c08d3d3ba22750c3b3d95e \
  --baseline-scope gorm-toplevel-package \
  --ignore-dirs schema,callbacks,clause,migrator,logger,internal,utils,tests

# --- HikariCP (Java) ---
git -C ~/.spectra-baselines/HikariCP checkout ea81bfb5852216dbfcb1f219742f91b5abceb81b
( cd ~/.spectra-baselines/HikariCP && spectra batch --mode graph-only )
node scripts/graph-accuracy.mjs \
  --source ~/.spectra-baselines/HikariCP \
  --graph ~/.spectra-baselines/HikariCP/specs/_meta/graph.json \
  --language java \
  --baseline-repo ~/.spectra-baselines/HikariCP \
  --baseline-commit ea81bfb5852216dbfcb1f219742f91b5abceb81b \
  --baseline-scope hikaricp-full-repo
```

**复跑后第一件事**：确认输出 JSON 里有 `baseline: { repo, commit, scope }` 三个字段。
缺了就是 §1.3 那个静默 no-op 命中了，这次的数字不可溯源、作废重跑。

> **复跑前务必确认跑的是新产物**：F258 踩过"PATH 上的 `spectra` 是旧构建，差分空转"的坑。
> 跑之前先 `spectra --version` 核对 build commit 后缀与当前 HEAD 一致（F186 起 `--version` 带 commit）。

---

## 3. 局限如实转述（FR-024，宪法 IV）

以下三条是 `scripts/graph-accuracy.mjs` 文件头 `Limitations:` 段的**原文**（第 21-24 行）：

```text
Limitations:
- label-only 匹配（不验证 caller 上下文）
- Python only（self-dogfood TS 暂 N/A）
- 不区分 method 与 function
```

### 3.1 这两条局限对结论的硬约束

- **`callRecall` 不等价于"经上下文校验的 caller recall"。** 脚本只比对 graph 的 callee label
  与源码里的 callee 名是否**同名**（脚本 notes 原文："label-only matching: 比较 graph callee
  label 与源码 callee 名是否相同"）。它**不验证**这条边的 caller 一侧是否正确。
  也就是说：一条 caller 完全错、callee 名恰好对上的**假边**，在这个指标里会被算成命中。
  → 报告里 **MUST NOT** 把 `callRecall` 写成"caller 召回率"或任何暗示上下文已校验的表述。
- **不区分 method 与 function。** F260 提升的是 **method 类**调用边覆盖（29.5% → 45.6%），
  而本指标把 method 与 function 混在一个池子里。因此本指标对 F260/F263 的改进**只有钝的方向信号**，
  分辨率不足以单独证明 method 侧的收益。要判 method 侧必须另用 F260 交付的覆盖率重算器。

### 3.2 第三条局限（"Python only"）与代码事实不符 — 诚实登记

脚本头注释写"Python only（self-dogfood TS 暂 N/A）"，但代码第 199 行是
`SUPPORTED_LANGUAGES = Object.freeze(['python', 'ts', 'go', 'java'])`，且第 525/539/553 行分别有
ts / java / go 三条独立分支。**注释是陈旧的，代码是四语言。**

- 本文件按**代码事实**选 go / java 语料（§2）。
- 但这条不一致本身是个未处置的缺陷：注释与实现漂移，会误导下一个读者。
  → 登记为后续清扫候选，**本卡不顺手改**（不在 F265 的认领范围，避免范围外扩）。
- 相应地，`--metric fill-rate` 确实仍是 python only（脚本第 580 行有显式报错），这条没有漂移。

---

## 4. 次级 / 交叉参照：F241 pilot 资产

以下资产**仅作历史口径对齐的交叉参照**，不作为本次复测的主实现，也**不重写、不平行建框架**：

| 资产 | 用途 |
|---|---|
| `specs/241-graph-keepalive-kb-grounding/pilot/measurement-design.md` | M-1 / M-2 / M-3 的口径原文（本文件 §5 §6 直接引用它） |
| `specs/241-graph-keepalive-kb-grounding/pilot/ledger.jsonl` | M-2 的历史记账样本 |
| `specs/241-graph-keepalive-kb-grounding/pilot/ledger-verify.mjs`、`ledger-schema-check.mjs` | 记账校验器，M-2 计算部分可复用 |
| `specs/241-graph-keepalive-kb-grounding/pilot/mcp-call-log.md` | M-1 记账表的列结构来源（本文件 §5.2 的模板照抄它） |

**F241 的三条不可回退声明原样转载**（`measurement-design.md` 原文）：

> 本文件在 implement 开始前冻结；取数后**不允许修改口径**，只允许追加「口径缺陷说明」。

> **记账必须在调用当下写**，不允许事后凭记忆补。

> 报告必须写明 N=1，禁止出现「提升 X%」这类暗示可外推的表述。

> **它仍然不能证明什么**：N=1 diff、单次采样、我自己判真伪（判读者未盲）。
> → 报告必须写明「判读者非盲、单次采样」。

---

## 5. M-1 grounding 命中率 — **人工协议，不可脚本化**

> ⚠️ **这一节是协议，不是脚本。** 不存在也不会存在一个"跑一下就出 M-1"的命令。
> 任何把这节包装成自动化的做法都违反 FR-020 与宪法 IV。

### 5.1 为什么不能脚本化

`scripts/adoption-census.mjs`（F265 同批交付）能事后从 transcript 里数出**调用了多少次**，
但它数不出**每次调用是不是命中**——`hit` / `fuzzy-hit` / `miss-structural` / `miss-empty` 的分类
需要在调用当下结合"我当时想查什么、返回体够不够用"来判，事后从 JSON 里恢复不出这个上下文。
F241 原文因此规定「记账必须在调用当下写，不允许事后凭记忆补」。

census 脚本与 M-1 是**互补**关系，不是替代关系：census 给分母（总调用次数），M-1 给分子（命中数）。

### 5.2 记账表模板（列结构照抄 `pilot/mcp-call-log.md`）

复制到复测周期的记账文件里，**调用当下逐行填**：

```markdown
# F265 复测 — Spectra MCP 调用逐次记账（M-1 原始数据）

口径见 docs/design/f265-graph-quality-rerun-plan.md §5。**调用当下即记，不事后补。**
类别：`hit` / `fuzzy-hit` / `miss-structural` / `miss-empty`

## 分段 0：口径冻结前的探索性调用（诚实标注，**不计入** M-1 分母）

| # | target | 工具 | 类别 | 备注 |
|---|--------|------|------|------|
| 0-1 | | | | |

## 分段 1：正式样本（口径冻结后）

| # | target | 工具 | 类别 | 备注 |
|---|--------|------|------|------|
| 1-1 | | | | |
```

**命中率 = (hit + fuzzy-hit) / 全部调用**；`fuzzy-hit` 必须单列，因为它虽然最终可用但多花一次往返。

### 5.3 必须在报告里写明的已知偏置（F241 原文）

调用由记账者本人发起、且记账者知道正在被测量 → 存在「挑好查的 symbol 来查」的自我选择偏置。
缓解手段是 M-2 的预测集必须**先于**实现冻结且覆盖全部计划改动文件，不允许只挑图内的。

---

## 6. M-3 review 发现率 — **人工判真伪，不可脚本化**

> ⚠️ **这一节是协议，不是脚本。**

### 6.1 协议步骤

1. 取同一份 diff，起 A / B 两个审查子代理，**唯一变量是 grounding 包的有无**，prompt 完全一致。
2. 主指标 = **B 独有的真 finding**（A 没抓到而 B 抓到的）与 **A 独有的真 finding**
   （反向，检验 grounding 是否反而挤占了注意力）。交集只说明两者都能抓，**不计入差异**。
3. 逐条**人工**判真伪。这一步无法自动化：判"是不是真 finding"需要读代码下结论，
   不是字符串比对。
4. 若 B 独有真 finding 为 0，**如实报 0**，不得改判口径去凑正向结果（F241 原文）。

### 6.2 记账表模板

```markdown
# F265 复测 — M-3 A/B 审查发现对照

变量：grounding 包有无。diff 与 prompt 一致。判读者：<姓名>（**非盲**）。样本：N=1。

| # | finding 描述 | A 抓到 | B 抓到 | 人工判真伪 | 归属 |
|---|---|---|---|---|---|
| 1 | | ☐ | ☐ | 真 / 伪 | A 独有 / B 独有 / 交集 |

结论必须写明：判读者非盲、单次采样、N=1，禁止「提升 X%」类表述。
```

---

## 7. M-2 impact coverage — 部分可脚本化

三个指标里只有这个有可复用的计算器（`pilot/ledger-verify.mjs`）。但**冻结预测集这一步仍是人工**：

- 预测集必须在 implement **之前**冻结（否则就是按结果挑口径）。
- 实际集 = `git diff --name-only` 剔掉纯新增与 `specs/`。
- `coverage` = 该预测到的预测到了多少；`precision = |预测集 ∩ 实际集| / |预测集|`。
- **`missed-list` 的逐个归因才是主要产出**——F241 原文：「单一 coverage 数字对 N=1 没有意义，
  『漏在哪、为什么漏』才有」。

---

## 8. 复测触发时机与收口

| 时点 | 动作 | 责任方 |
|---|---|---|
| 用户在 host shell 执行 `npm publish` 之后 | 记录发布时间戳，作为观察窗起点 | 用户 |
| 发布后一周 | 跑 §2.2 两条命令 + 跑 `node scripts/adoption-census.mjs` | `milestone-next` 循环 |
| 同上 | 按 §5 / §6 协议人工记账（若该周期内有可用载体 feature） | `milestone-next` 循环 |
| 同上 | 数字落账；若发现口径缺陷，在**报告**里追加「口径缺陷」一节，**不回改本文件** | `milestone-next` 循环 |

**F265 本卡的验收终点是：本文件存在、参数钉死、局限如实、模板可用。数字不是本卡的验收项。**
