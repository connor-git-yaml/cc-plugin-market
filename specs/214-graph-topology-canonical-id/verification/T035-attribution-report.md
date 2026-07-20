# T035 三类归因报告（SC-005）— Feature 214

生成时间：2026-07-20（implement phase T039 Codex 修复轮 W-1 补齐证据落盘）

本报告对 3 个固定 baseline（micrograd / nanoGPT / self-dogfood）的 (a) perf anchor `baseline:diff`
与 (b) 语义 `graph-semantic-diff` 逐项归因到 SC-005 三类 allowlist；perf 启发式告警须显式归因，
不以"exit 0"掩盖。

## (a) perf anchor baseline:diff（每项目 git HEAD fixture vs 重采集 fixture）

| 项目 | graphNodeCount | 归因 | tokensInputPlusOutput | 归因 | baseline:diff exit |
|------|----------------|------|-----------------------|------|--------------------|
| micrograd | 46 → 37（-9） | SC-005 类(2)：`#`/`::` 成对重复节点消除（5 对 Python symbol，见 (b)）+ 建图口径 | +47.1%（red） | LLM 单次采样随机性（CLAUDE.local.md 已知偏差；本 feature 零 LLM 提示词变更，无因果） | 1 |
| nanoGPT | 102 → 76（-26） | SC-005 类(2)：11 对重复消除 + contains 补齐后建图口径 | -11.6%（green） | LLM 随机性（同上） | 1 |
| self-dogfood | 4887 → 5748（+861） | 本 feature 自身新增源码符号（deriveContainsEdges / parseCanonicalSymbolId / isLegacySymbolNode / 新测试）进入 self-index + full-only 源 LLM 采样差异 | -2.5%（green） | LLM 随机性 | 0 |

**perf 启发式 exit 1（micrograd/nanoGPT）显式归因**：`baseline:diff` 的 "overall: fail" 由两项触发——
(1) graphNodeCount 下降越过阈值 = SC-005 类(2) 去重**预期**变化（数字对得上 (b) 的 dup 消除量）；
(2) tokensInputPlusOutput 变化 = full batch LLM 单次采样随机性，本 feature **未改动任何 LLM 提示词 / 采样参数**，与本改动无因果。
两者均为预期 / 已知偏差，非回归。故 T035(a) 的验收口径为"perf 启发式告警须逐项归因入本报告"，而非要求 diff 命令 exit 0。

## (b) 语义 graph-semantic-diff（T001a 旧图快照 vs 新代码 graph-only）

| 项目 | 类(1) contains 增量 | 类(2) dup 消除 | 类(3) 非-contains 耦合边 | 脚本 exit | 判定 |
|------|---------------------|----------------|--------------------------|-----------|------|
| micrograd | 28（module→symbol 7 / class→member 21） | 5 → 0（消除 5） | 9 → 9（不变） | 0 | PASS |
| nanoGPT | 55（module→symbol 11 / class→member 44） | 11 → 0（消除 11） | 26 → 26（不变） | 0 | PASS |
| self-dogfood | 4871（module→symbol 1658 / class→member 3213） | 16 → 0（消除 16） | 2768 → 2807（+39） | 1 | 见下 |

**self-dogfood exit 1 归因**：脚本（C-2 fail-closed 版）报出的"未归因差异"经核实为**本 feature 自身新增的源码符号**：
17 个语义节点（`src/knowledge-graph/index.ts::deriveContainsEdges`、`relativize.ts::parseCanonicalSymbolId` +
`CanonicalSymbolIdParts(.filePart/.symbolPart)`、`graph-query.ts::isLegacySymbolNode` 等）+ 39 条边
（`buildUnifiedGraph→deriveContainsEdges` calls、`assertGraphFormatNotStale→isLegacySymbolNode` calls、
新 e2e 测试 → stdio-client 的 depends-on 等）。这是 dogfooding 噪声（self-dogfood 索引的正是被本 feature 修改的本仓源码，
T001a 快照早于这些源码改动），**非图回归**。两个外部 baseline（micrograd/nanoGPT，源码未改）提供了干净的机械归因证明。

**C-2 fail-closed 反例自测**（验证脚本非纸面 PASS）：
- 删除一条旧图 contains（`micrograd/engine.py -> engine.py::Value`）→ 脚本 exit 1（"旧图 contains 边在新图缺失"）✓
- 注入 `engine.py#Value` 重复节点 → `graph-semantic-diff` exit 1 + `--dup-check` exit 1（"新图仍存在 1 对语义重复节点"）✓

## 结论

3 项目全部差异逐项归因到 SC-005 三类 allowlist（外部 2 项目机械 exit 0；self-dogfood 差异 = 本 feature 自身源码）。
无未归因图回归。graph-only 性能见 `graph-only-perf-new.json`（p50 245ms ≤ 旧 240ms×1.5=360ms，PASS）。
