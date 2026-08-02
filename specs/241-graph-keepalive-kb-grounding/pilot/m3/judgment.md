# M-3 判读 — A/B 对照结果（编排器逐条判真伪）

口径见 [measurement-design.md](../measurement-design.md) M-3 与 [m3-preregistration.md](../m3-preregistration.md)。
**判读者非盲**（编排器同时是被审代码的委派方）——该局限已预先声明，不在此处辩解。

## 执行合规

| 项 | 值 |
|----|-----|
| 被审 diff | `batch2.diff` 1918 行 / 17 文件，SHA-256 `7a888daa1d14b1b37fa04bd9f0d02efcc29bdc60c64348e83019dafda45022c1` |
| 两组 prompt | `prompt-a.md`(15 行) / `prompt-b.md`(30 行)——**除 grounding 包外逐字相同**（diff 仅末尾 15 行 grounding 段）|
| 发起方式 | 同一消息内并行发起，同 agent 类型（codex:codex-rescue），同模型档位 |
| grounding 包 | 4 条查询结果，含 3 条**已知错误**的（按预注册「grounding 的错误也原样给」原则，未人工修正）|
| A 组产出 | 3 CRITICAL / 4 WARNING / 1 INFO（结论 BLOCKED）|
| B 组产出 | 2 CRITICAL / 3 WARNING / 1 INFO（结论 BLOCK）|

## 逐条判真伪与配对

| # | 议题 | A 组 | B 组 | 真伪判定（编排器） |
|---|------|------|------|-----------------|
| 1 | **redaction 先于 NFKC + 大小写敏感**（全角数字被还原、`TOKEN=`/`bearer` 漏遮） | C2 | W2 | ✅ **真**。两组独立给出同一复现（全角 `１２３４５６７８` → 落盘 `12345678`）。这是设计顺序缺陷，非误报 |
| 2 | **FIFO/symlink 让 appendFileSync 阻塞或写到目录外** | C3 | C2 | ✅ **真**。A 组额外给了「延迟注入 300ms → executeKbSearch 同步延迟 301ms」的实测，B 组补了 pruneExpired 用 statSync 跟随链接 + 任意目录误删的加重形态 |
| 3 | **读取失败被误报 no-data** | W4 | W3 | ✅ **真**。两组同源（coverage-gap 的 catch continue 吞掉 EACCES） |
| 4 | **parse-args 接受缺值/未知 flag** | W3 | I1 | ✅ **真**（严重度两组判读不同，取较高的 W） |
| 5 | **单 token 查询整串原文进 terms**（`ProjectFalcon` 逐字落盘） | **C1（A 独有）** | — | ✅ **真**。红线措辞是「整串不落盘」，单 token 时 term == 整串，字面违反。B 组完全没提 |
| 6 | **distinctQueries 可被大小写变体绕过**（`retry alpha` vs `retry Alpha` 两个 hash） | **W1（A 独有）** | — | ✅ **真**。直接削弱最小出现阈值这条隐私防线 |
| 7 | **无可用库源时仍记 coverage gap**（sources_queried 为空却落 no-hit） | **W2（A 独有）** | — | ✅ **真**。语义错误：这是 availability 问题不是文档缺口 |
| 8 | **`tool` 字段无运行时 allowlist，可绕过 redaction 落整串** | — | **C1（B 独有）** | ✅ **真**。`recordNoHit` 是导出边界且合同宣称 total function，`tool` 未校验即序列化；当前三个生产 call-site 都传字面量所以不可外部触发，但边界合同确实没守住 |
| 9 | **dbPath 在 recorder 保护边界外求值**（关闭态也能因 getter 抛错炸主链） | — | **W1（B 独有）** | ✅ **真**。JS 求值顺序问题，实测 `governance-path-boom` 穿透；与 RG-009「关闭态零影响」的结构性保证直接冲突 |
| 10 | hash 可字典枚举、非严格匿名 | I1 | — | ✅ 真但**已知**：C5 裁决已把「k-匿名」改名并声明不提供匿名性保证，属重复登记，不计入差异 |

## 三个对照数（M-3 主指标）

| 指标 | 值 | 明细 |
|------|-----|------|
| **交集真 finding** | **4** | 议题 1/2/3/4（NFKC 顺序、FIFO/symlink、读取失败误报、flag 校验）|
| **A 独有真 finding（no-grounding）** | **3** | 议题 5（单 token 整串）、6（大小写绕阈值）、7（无源仍记录）|
| **B 独有真 finding（grounded）** | **2** | 议题 8（tool 无 allowlist）、9（dbPath 求值顺序）|
| 误报（任一组） | **0** | 两组全部 finding 经复核均成立 |

## 诚实结论

**本次对照未显示 grounding 带来正向增益——方向反而是负的（A 独有 3 > B 独有 2）。**

不做过度解读，但记录三点观察：

1. **A 独有的三条集中在「数据流语义」**（一个 token 时 term 等于原串、hash 归一化口径、无源 vs 无命中的语义区分）——这些靠通读 diff 的数据流推理得出，与调用图无关。
2. **B 独有的两条集中在「边界契约」**（导出函数的入参校验、JS 求值顺序穿透保护边界）——这类恰恰是「谁会调用它、以什么形态调用」的问题，方向上与 grounding 提供的信息类型吻合。但**不能据此声称是 grounding 之功**：B 组自己在报告里写明「仅将 pre-batch 图结果作为方向性提示，没有把它当成新代码事实」，且我给的 4 条 grounding 里 3 条是错的（两个 0-caller 误报、一个部分漏报）。
3. **给了错误的 grounding 是否有害**：B 组没有被 `directCallers: 0` 误导成「这函数没人调、风险低」——它照样审出了 `tool` 边界问题。这是个正面信号（审查者对 grounding 有免疫力），但 N=1，不构成结论。

**样本量 N=1 个 diff、单次采样、判读者非盲。上述差值（3 vs 2）在统计上毫无意义，只能作为方向记录。**
禁止把本节任何数字外推为「grounding 无用」或「grounding 有用」。

## 处置

9 条真 finding 全部进批 2 整改（见 review-dispositions.md「Implement 批 2」节）。
M-3 的价值在本轮实际上**主要不是测出 grounding 效果，而是两组并行审出了 9 个真问题**——这本身是把对抗审查加倍的收益，与 grounding 假设无关。
