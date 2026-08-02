# F241 Grounding Pilot — 测量设计（先定口径，后取数）

> **为什么先写这个**：M9 §7 明确要求 pilot「验收看 grounding 是否命中、是否改善 impact coverage
> 和 review 发现率，**不只看 hook 被调用**」。三个指标里有两个极容易退化成「跑了就算过」，
> 因此口径必须在取数**之前**冻结，否则事后必然出现「按结果挑口径」。
>
> 本文件在 implement 开始前冻结；取数后**不允许修改口径**，只允许追加「口径缺陷说明」。

## 载体

pilot 的载体就是 **F241 自身的开发过程**（M9 §7 要求「选一个有界 feature」）。
不跑 SWE-bench 批，不烧评测配额——driver 与 judge 都走订阅或本地。

F241 适合做载体的理由（也是它的局限，一并诚实登记）：
- ✅ 改动横跨 `src/**`（轨道 E，图内可查）与 `plugins/**/*.mjs`（B4，图外不可查）
  → 天然自带「有 grounding」与「无 grounding」两个区块，是**同一 feature 内的自然对照**
- ⚠️ 样本量 = 1 个 feature。**任何结论都是方向信号，不是统计显著性**。
  报告必须写明 N=1，禁止出现「提升 X%」这类暗示可外推的表述。

---

## M-1 grounding 命中率

**定义**：pilot 期间对 Spectra MCP 发起的每次 symbol 级查询（`impact` / `context` / `detect_changes`），
按结果分四类计数：

| 类别 | 判据 |
|------|------|
| `hit` | 直接返回可用结果（非空、target 精确解析）|
| `fuzzy-hit` | 首次 symbol-not-found 但 `fuzzyMatches` 非空，按候选纠正后二次调用成功 |
| `miss-structural` | symbol-not-found 且 `fuzzyMatches` **为空**（= 该文件整体不在图内）|
| `miss-empty` | 精确解析成功但结果为空，且经人工核对**确实**该为空 |

**命中率 = (hit + fuzzy-hit) / 全部调用**。`fuzzy-hit` 单列，因为它虽然最终可用但多花一次往返。

**采集方式**：逐次手工记账到 `pilot/mcp-call-log.md`（每行：序号 / target / 类别 / 备注）。
不依赖 telemetry env（O-4 已证其默认不采集）。**记账必须在调用当下写**，不允许事后凭记忆补。

**已知偏置（必须在报告里写）**：调用是我（编排器）自己发起的，我知道正在被测量
→ 存在「挑好查的 symbol 来查」的自我选择偏置。缓解：M-2 的预测集必须**先于**实现冻结，
且覆盖全部计划改动文件，不允许只挑图内的。

## M-2 impact coverage

**定义**：`coverage = |预测集 ∩ 实际集| / |实际集|`

- **预测集**：implement 开始**之前**，用 `impact` / `context` 对本 feature 的已知改动锚点
  查出的「受影响文件」集合，冻结写入 `pilot/predicted-impact-set.md`（带时间戳与所用 target 列表）
- **实际集**：implement 完成后 `git diff --name-only` 的真实改动文件集合，
  **剔除**纯新增文件（新文件不可能被 impact 预测到，计入分母是不公平的）与 specs/ 文档

**同时报三个数**，缺一不可：
- `coverage`（召回：该预测到的预测到了多少）
- `precision = |预测集 ∩ 实际集| / |预测集|`（预测集里有多少是噪声）
- `missed-list`（漏掉的具体文件 + 逐个归因：图 stale？.mjs 不在图？漏建边？确实无法预测？）

**归因是本指标的主要产出**——单一 coverage 数字对 N=1 没有意义，「漏在哪、为什么漏」才有。

## M-3 review 发现率 — **用真对照组，不用绝对计数**

这是最容易糊弄的一项。「Codex 审查发现了 N 条」不能说明 grounding 有没有用，
因为没有反事实。**因此本 pilot 设一个真正的 A/B**：

对**同一份 diff**，并行启动两个同构的 Codex 对抗审查子代理：

| 组 | 输入 |
|----|------|
| **对照组 A（no-grounding）** | 仅 diff + 需求描述 |
| **实验组 B（grounded）** | 同样的 diff + 需求描述，**外加** Spectra 产出的 grounding 包：改动 symbol 的 `impact` 上游 caller 链 + `context` 360° + 图 freshness 状态 |

两组 prompt 除 grounding 包外**逐字相同**，同模型同档位，同时发起（避免先后顺序带来的差异）。

**判读**：
- 两组各自的 finding 列表 → 人工（我）逐条判真伪 → 得到 `真 finding 数`
- 主指标 = **B 独有的真 finding**（A 没抓到而 B 抓到的）与 **A 独有的真 finding**（反向，检验 grounding 是否反而挤占了注意力）
- 交集只说明两者都能抓，不计入差异

**为什么这个对照是可信的**：唯一变量就是 grounding 包的有无，diff 与 prompt 完全一致。
**它仍然不能证明什么**：N=1 diff、单次采样、我自己判真伪（判读者未盲）。
→ 报告必须写明「判读者非盲、单次采样」。若 B 独有真 finding 为 0，**如实报 0**，
不得改判口径去凑正向结果。

---

## 冻结声明

上述三项口径冻结于 implement 开始之前。取数后若发现口径有缺陷，
在报告中新增「口径缺陷」一节说明，**不回改本文件的定义**。
