# F241 Pilot — 三指标原始计算（批 3 末快照）

> 全部按 [measurement-design.md](measurement-design.md) 冻结口径计算，命令可复算。
> 数字**不好看**，如实记录，不做任何有利于结论的口径调整。

## M-1 grounding 命中率（源：`ledger.jsonl`，27 行中 20 行计入）

```
四分类：hit 8 / fuzzy-hit 1 / miss-empty 7 / miss-structural 4
名义命中率 = (8+1)/20 = 45.0%
```

**但四分类口径本身有缺陷**（`mcp-call-log.md` 分段 1 已在取数当下自证）：它假设「解析成功 = 结果可用」，
而实测存在第五种状态——**解析成功、返回非错误、但内容经 grep 交叉核对被证伪**。

```
全部经交叉核对证实结果错误的调用 = 10 / 20
  其中被四分类计为 hit / fuzzy-hit 的 = 4
未能确认（该为空还是漏报，人工无法判定）= 1

修正后「可信命中」= (9 - 4)/20 = 5/20 = 25.0%
```

**结论口径**：报 **名义 45% / 修正后 25%** 两个数，且必须同时给出「10/20 的调用返回了错误结果」这一条。
只报 45% 是误导；只报 25% 则隐藏了「有 4 次是先给了看似正常的结果才被证伪」这层危害。

## M-2 impact coverage（预测集冻结于 implement 前，见 `predicted-impact-set.md`）

分母按冻结口径**剔除纯新增文件**（26 个）与 `specs/**` 文档。

> **⚠️ v2 更正（Codex 批 3 审查 W4 抓到我的算术错误）**：初版把 `governance-constants.ts`
> 同时计入「新增」与「修改」（它是批 2 新增、批 3 修改），导致分母误为 22；归因表还把
> `kb-contract.test.ts` 在两类里重复计数、`plugins/**` 行写 4 实际列了 5。下表为按
> 「相对 batch1-base `6950b08`、同文件 A 优先于 M」去重后的复算结果。**这是取数纪律的真实失误，
> 不隐去。**

```
|预测集| = 10
|实际集（既有文件修改，去重后）| = 21
|交集| = 2   → src/kb-mcp/tools/kb-search.ts、src/kb-mcp/tools/kb-api-lookup.ts

coverage（召回）= 2/21 = 9.5%
precision      = 2/10 = 20.0%
```

### missed 逐条归因（19 个漏预测，每文件恰归一类）

| 归因类别 | 文件数 | 文件 | 是否 grounding 的锅 |
|---|---|---|---|
| **`plugins/**` 不在图内**（O-5 结构性） | 5 | SKILL.md ×3（canonical + 两 wrapper）、`ensure-gitignore.sh`、`ensure-gitignore.test.mjs` | ✅ 是——图覆盖缺口 |
| **仓根 `scripts/` 不在图内** | 1 | `scripts/lib/graph-bootstrap-status.mjs` | ✅ 是——同 O-5 范围问题 |
| **非代码文件** | 1 | `.gitignore` | ❌ 否——impact 本就不覆盖 |
| **测试文件**（图内，但预测锚点未指向） | 6 | `tests/kb/` ×5（cli-scaffold-kb、kb-api-lookup-tool、kb-contract、kb-search-tool、scaffold-kb-query）、`tests/unit/worktree-lifecycle-hook.test.ts` | ⚠️ 部分——测试是 caller，理论上 impact 该报 |
| **设计中途新增的改动面**（预测时不存在） | 6 | `src/cli/` ×3（commands/scaffold-kb、index、utils/parse-args）、`kb-locator.ts`、`project-context.ts`、`tokenizer.ts` | ❌ 否——需求演进（P-W5 补 CLI 可达性、B2-1 抽 NFKC、B2-9 加 dbPath thunk）产生 |

合计 5+1+1+6+6 = **19** ✅

**扣掉「非 grounding 之过」的 7 个（非代码 1 + 需求演进 6）后**：
`coverage' = 2/14 = 14.3%`——仍然很低，主因是 `plugins/**` 与 `scripts/**` 整体不在图内。

### precision 噪声逐条（8 个预测了但没改）

> **v3 更正（批 4 复算抓到，同类失误第三次）**：v2 此处写「全部来自 withTelemetry 链（`src/mcp/**` 5 个 + kb-doc-lookup + kb-server）」——
> 列举项相加只有 7、`src/mcp/**` 实为 4 个，且末 2 条根本不属该链。逐文件枚举如下（`comm -23 预测集 实际集` 可复算）。

| # | 文件 | 来源锚点 |
|---|------|---------|
| 1 | `src/mcp/graph-tools.ts` | `withTelemetry` upstream |
| 2 | `src/mcp/index.ts` | `withTelemetry` upstream |
| 3 | `src/mcp/lib/telemetry.ts` | `withTelemetry` 自身 |
| 4 | `src/mcp/server.ts` | `withTelemetry` upstream |
| 5 | `src/kb-mcp/server.ts` | `withTelemetry` upstream |
| 6 | `src/kb-mcp/tools/kb-doc-lookup.ts` | `withTelemetry` upstream |
| 7 | `src/scaffold-kb/schema-compat.ts` | **`hasProvenanceColumns` 锚点**（非 withTelemetry 链）|
| 8 | `src/scaffold-kb/search-core.ts` | **`hasProvenanceColumns` 锚点**（非 withTelemetry 链）|

withTelemetry 链 6 条 + hasProvenanceColumns 链 2 条 = 8 ✅

**归因**：1-6 是预测时以为要改 telemetry 装饰层，实际 B2 裁决把挂点放进 `executeXxx` 内部，整条 upstream 链未动；
7-8 是 plan §4 判定「直接复用 `hasProvenanceColumns` 不新增探测函数」后该文件无需改。
两者都是**预测方法的问题（锚点选错），不是图的问题**。

> **失误模式登记**：三次算术/分类错误（v2 的分母双计、v2 的归因重复计数、v3 的这处）**全部落在人工手写的分类小计上**；
> 机器可重算的 headline 四数（2/21、2/10、19、2/14）三轮复算一次没错。
> → 教训：pilot 这类「数字即结论」的产物，凡人手汇总的中间分类都应有机器复算兜底，否则错的是叙事而非数据。

## M-3 review 发现率（见 `m3/judgment.md`）

```
交集真 finding = 4
A 独有（no-grounding）= 3
B 独有（grounded）   = 2
误报 = 0
```

方向：**未显示 grounding 正向增益，A 独有反而多 1 条**。N=1、单次采样、判读者非盲——不可外推。

## 复算命令

```bash
# M-1
node -e "见 pilot/ledger-verify.mjs"
# M-2 实际集
{ git diff --name-status <batch1-base> HEAD; git diff --name-status HEAD; \
  git status --porcelain -uall | grep '^??' | sed 's/^?? /A\t/'; } \
  | grep -v 'specs/241' | sort -u
```
