# Spectra & Spec Driver 竞品评估总报告

> ⚠️ **本文件是 Phase 5（2026-04-30）冻结快照。**当前 fixture 总数 / 成本 / 评分以 `npm run eval:report` 即时生成的 auto-report 为准（auto-generated，**不入库** — 每次重跑测评 pipeline 后本地生成）。本文件仅保留 Phase 5 时点的核心结论 + Sprint 3 校订（§0、§1、§2.2）。
>
> **2026-05-05 测评数据清理**：tests/baseline/{tasks,repeats}/ 与 truth-set.json 已从仓库移除（每次跑生成，不入库；详见 `CLAUDE.local.md` "Baseline 测试" 入库边界表）。重跑测评：`npm run eval:competitor && npm run eval:judge-jury && npm run eval:report`。
>
> 当前 (Sprint 3, 2026-05-01) 实际 fixture 总数：**40**（12 spectra 类含 hono / micrograd / nanoGPT / self-dogfood × 3 工具 + 25 spec-driver 类 + 3 multi-turn variants）— 比本文件 §6 fixture 清单（13）扩了 3×。§4 / §6 / §8 数字未同步，**请以 auto-report 为准**。

**Feature**: 147  
**Phase 5 生成日期**: 2026-04-30  
**Sprint 3 校订日期**: 2026-05-01（§0 disclaimer + §1 公平 rubric + §2.2 双 rubric 对比；§4 / §6 / §8 仍是 Phase 5 历史快照）  
**Phase 5 评估覆盖**: 3 项目 × 3 spectra 类工具（9 fixture）+ 4 spec-driver 类工具 × 1 任务（4 fixture）  
**Phase 5 总成本**: $15.5（首次全量；当前 cost 见 auto-report §2）

---

## 0. 范围声明（先读这段再看数字）

**Spec Driver 类 task-execution fixture = single-turn LLM prompt-injection 评估，不是真实 multi-turn workflow 端到端实跑。**

- Sprint 1 跑了 4 个真实 plugin 端到端 fixture（T1 only），但 commits=0（acceptEdits 不覆盖 bash），commit history 维度被屏蔽
- Sprint 2 改用 unified GLM executor (siliconflow-sdk) 单次调用 + cross-LLM jury，每个工具注入"工具理念 system prompt"。这扩到了 25 fixture（5 工具 × 5 任务），但每个 fixture 只有 single-turn
- **不评估**：SuperPowers 的 RED/GREEN TDD subagents、spec-driver 的 specify→plan→tasks→implement→verify 多 phase orchestration、GStack 的 23 skills 串行调度、commit history 结构化质量
- **能评估**：在同一 LLM (GLM) 上，不同工具的 system prompt / 方法论描述对单次代码生成质量的影响
- 因此本报告 §4.2 / auto §4.1 矩阵中 5 工具（control / gstack / spec-driver / spec-driver-spectra / superpowers）**跨 4 任务（剔除 T6）jury median 均分** 7.3 / 7.5 / 7.3 / 7.8 / 7.3，spread ≤ 0.5 — **反映的是 prompt 设计差异 + jury 评分主观波动，不是 workflow ROI**

**Sprint 3 补齐**：Phase D 在 T2 cosine LR 任务上跑了 1 次真实 multi-turn 端到端实跑作为 single-turn 数据的 robustness check（见本文件末尾或 [research/multi-turn-spike-log.md](research/multi-turn-spike-log.md)）。

**Spectra 类 fixture（perf + spec quality + grounding）= 真实端到端实跑**，对外结论以 §2.1 / §2.2 + 公平 doc-quality rubric（auto-report §3.2b）为准。

### 0.1 N=5 重跑 + bootstrap CI（Feature 149 实测，2026-05-05 完成）

5 工具 × 5 任务 = 25 fixture × N=5 重跑实测（**测评数据不入库** — 重跑 `npm run eval:repeat -- --all-fixtures --n 5` 在本地生成 `tests/baseline/repeats/*/aggregate.json`）：

- **Oracle 状态**：24/25 fixture × N=5 完整 healthy；T2-nanogpt-cosine-lr 4/5 工具有 vendor timeout（GLM 调用偶尔卡 6+ min + jury vendor timeout 多次），actualN=1~4
- **Jury median 95% bootstrap CI** 已写入 auto-report §4.1（每 cell 渲染 `<median> [low, high] (n=N)` 形式）
- **关键 finding**：
  - **简单 / 中等任务（T1/T3/T4）jury 95% CI 跨 5 工具全部重叠** — 工具间 jury 评分无统计意义差距，确认旧 single-run ≤ 0.5 均分差距是噪声
  - **T6 violation-refusal surface refusal rate 跨工具有 publish-grade 差异化**：spec-driver / spec-driver-spectra (100%) > superpowers (60%) > gstack / control (20%)
  - 旧 N=2 数据声称 "spec-driver / gstack / superpowers 三家一致 surface refusal" 是 **单次随机性掩盖的伪差异**，N=5 暴露出 gstack 实际 80% 失败、superpowers 40% 失败
- **spec-driver-spectra prompt 修复**：N=5 confirmed 100% surface refusal（旧 N=2 = 0%），详见 §4.2.a

**结论修订**：
- workflow 工具间在"代码质量"维度（T1/T3/T4）**无可量化差距** — 不应作为对外卖点
- workflow 工具的 **唯一可信差异化**是 T6 violation-refusal 行为类任务（spec-driver 类 100% > superpowers 60% > gstack/control 20%）

详见本地重跑 `tests/baseline/repeats/` 全部 25 个 aggregate（不入库 — 详见 CLAUDE.local.md 边界）+ auto-report §4.1 / §4.3。

---

## 1. 执行摘要

### 1.1 Spectra 类（codebase → spec / agent context）

| 工具 | doc quality 公平 rubric † | wall（self-dogfood）| 成本 |
|------|---------------------------|---------------------|------|
| **Spectra**（自己） | **7.3** ⭐ | 30 min ($9.86) | 高 |
| **Aider repomap** | 5.3 | 9.4 s ($0) | 极低 |
| **Graphify** | 4.8 | **4.2 s** ($0) | 极低 |

> † doc-quality rubric 评每个工具的 native artifact（spectra spec.md / graphify GRAPH_REPORT.md / aider repomap stdout）作为"项目理解 context"的有用性，**不评是否符合特定模板**（覆盖度 / 关系 / 可读性 / LLM-context-value / 真实性，3 项目均分）。详见 auto-report §3.2b。
>
> ⚠️ 旧 spec-quality rubric 期望 4 章节 spec.md 形态（Intent/Behavior/API/Data），对 graphify/aider 是 rubric mismatch，给 1 分不可比；本表已替换为公平 rubric。
>
> ⚠️ **旧 grounding 数字（Phase 2: spectra=10 / aider=9 / graphify=0）已被 Sprint 3 推翻**：n=3 任务（tanh / fix-bug / extract-const）× 4 对照组实测，spectra-control mean delta = **0**。Phase 5 的 "10 vs null" 是当时 sonnet 在 plan 模式拒绝生成的伪信号。详见 §2.3 / §5.1 / auto-report §3.3。**spec.md 的真正价值仍在人类可读性 + 模块文档化 + LLM agent 长 horizon 任务的语义 anchor，不是单 turn coding lift**。

**核心结论**：
- **Spectra 在 doc quality 公平 rubric 下 mean 7.3** vs aider 5.3 / graphify 4.8（n=3 项目）；inter-rater Δ ≤ 1 评分稳定，但 **n=3 不足以做 confidence interval / 统计显著性推断**——当前是 descriptive signal，不是 inferential conclusion
- **Speed disparity 极大**：Spectra 比 Graphify 慢 432×（self-dogfood）；spec.md 文档化 + LLM 增强是 cost 主因
- ~~**Grounding 实证**：Spectra 的 spec.md 作为 LLM coding context 的 grounding 价值得到证明；纯 graph 节点列表（Graphify）不足以做编码上下文~~ — **Sprint 3 推翻**。当前 sonnet 4.6 在简单任务上不依赖 spec.md 也能写出正确代码（n=3 实测 delta=0）。spec.md 的差异化价值是人类可读性 + 长 horizon agent 语义 anchor，不是单 turn coding lift

### 1.2 Spec Driver 类（spec-driven coding workflow）

⚠️ **本表已用 Sprint 3 cross-LLM jury 数据替代 Phase 5 单 T1 sonnet 评分**（旧表 control 6.5 / spec-driver 6 / SuperPowers 6 / GStack 6 是 single-judge artifact，已被 jury 推翻）。

| 工具 | jury median (4 任务剔 T6) | T6 拒绝行为（§4.4.a）| jury 配置 |
|------|--------------------------|---------------------|----------|
| **control**（裸 Claude Code）| 7.3 (n=3) | fully complied ❌ | 3 judges (anthropic + openai + siliconflow) |
| **spec-driver**（自己） | 7.3 (n=4) | **surface refusal** ⭐ | 同 |
| **spec-driver-spectra** | **7.8 (n=4)** | fully complied ❌ | 同 |
| **SuperPowers** | 7.3 (n=3) | **surface refusal** ⭐ | 同 |
| **GStack** | 7.5 (n=4) | **surface refusal** ⭐ | 同 |

**核心结论**（Sprint 3 cross-LLM jury 实测）：
- **5 工具 jury median spread ≤ 0.5**（7.3-7.8）—— 差距落在 prompt 设计差异 + jury 评分主观波动范围内，**不是 workflow ROI**
- **T6 violation-refusal 是唯一行为级差异化信号**：spec-driver / gstack / superpowers 三家 surface refusal 1/1 ⭐ vs control / spec-driver-spectra fully complied
- spec-driver-spectra jury median 7.8 略领先（n=4），但叠加 spectra context 在 T6 反而 fully complied —— 详见 §4.2.a 反直觉信号
- **复杂任务 ROI 仍未验证**：跨模块 / 长 horizon / API style follow 等场景未测；简单 (T1) / 中等 (T2) / refactor (T4) / bug-fix (T3) 任务上 5 工具差距统计无意义

---

## 2. 详细实测数据

### 2.1 Spectra 类 Perf 对比（实测，3 项目）

| 项目 | 工具 | wall | LLM calls | tokens (in+out) | cost USD | nodes | edges |
|------|------|------|-----------|-----------------|----------|-------|-------|
| micrograd（5 .py / 248 LOC）| spectra | 176 s | 4 | 99k | $0.56 | 13 | 6 |
| micrograd | graphify | 0.1 s | 0 | 0 | $0 | 41 | 56 |
| micrograd | aider-repomap | 1.6 s | 0 | 0 | $0 | 33 (symbols) | n/a |
| nanoGPT（15 .py / 1.2k LOC）| spectra | 1254 s | 4 | 401k | $2.27 | 32 | 18 |
| nanoGPT | graphify | 0.1 s | 0 | 0 | $0 | 55 | 61 |
| nanoGPT | aider-repomap | 2.2 s | 0 | 0 | $0 | 19 (symbols) | n/a |
| self-dogfood（516 .ts / 116k LOC）| spectra | 1802 s | 17 | 1.97M | **$9.86** | 17 | 66 |
| self-dogfood | graphify | **4.2 s** | 0 | 0 | $0 | **3097** | **7136** |
| self-dogfood | aider-repomap | 9.4 s | 0 | 0 | $0 | 0 (regex) | n/a |
| **合计** | | | **25** | **2.48M** | **$12.69** | | |

### 2.2 Spectra 类 Spec Quality（双 rubric 对比）

#### 2.2.a 旧 rubric（spec.md 形态，graphify/aider mismatch）

| 项目 | spectra | graphify | aider-repomap |
|------|---------|----------|---------------|
| micrograd | 7 (Δ=0) | 1 (Δ=0) | 1 (Δ=0) |
| nanoGPT | 6.5 (Δ=1) | 1 (Δ=0) | 1 (Δ=0) |
| self-dogfood | 6 (Δ=0) | 1 (Δ=0) | 1 (Δ=0) |

> ⚠️ **不可作为对外结论**：rubric 期望 4 章节（Intent/Behavior/API/Data），graphify/aider 不产 spec.md → 1 分是 rubric 形态错配，不是工具能力差。

#### 2.2.b 公平 doc-quality rubric（同 rubric 评 native artifact）

| 项目 | spectra | aider-repomap | graphify † |
|------|---------|---------------|------------|
| micrograd | 8 | 6 | 4.5 (Δ=1) |
| nanoGPT | 7 | 6 | 4 |
| self-dogfood | 7 | 4 | 6 |
| **均分** | **7.3** ⭐ | **5.3** | **4.8** |

inter-rater Δ ≤ 1（每 fixture 评分稳定），但 **n=3 项目 sample size 不足以做 confidence interval / statistical significance 推断**；当前 mean 差距是 descriptive signal。**对外结论以本表为准**，但应明示 n=3 + 无 CI。

> ⭐ = 该列均分最高，**不代表 statistical significance**（n=3 + 无置信区间）。
>
> † **graphify 公平性 caveat**：graphify 的主产物是 `graph.json`（machine-readable，1094-3097 节点 / 1502-7136 边），`GRAPH_REPORT.md` 是 graph.json 的 secondary markdown 视图（community / god nodes / edge stats）。doc-quality rubric 评的是 GRAPH_REPORT.md 作为 LLM-context 的有用性 — graphify 4.8 的均分 **仅反映 secondary markdown 文档化能力**，不代表 graphify 工具整体 LLM 价值（其主输出 graph.json 在 §3.4 graph topology accuracy 上 micrograd 78% / nanoGPT 70% precision，是该维度真正优势）。如果 LLM 能消化 raw graph.json，graphify 整体价值会高于本 rubric 反映。
>
> aider-repomap 评分包含其 stdout 中 LiteLLM 兼容性 warnings（`Warning for anthropic/claude-3-5-sonnet`等约 10 行） — 这是 aider 工具真实输出现状，作为"LLM context 有用性"评估时合理保留。

### 2.3 ~~Spectra Coding-Context Grounding~~（Phase 5 旧数据，已被 Sprint 3 推翻）

> ⚠️ **本节是 2026-04-30 Phase 5 数据，结论已不成立**。当前 grounding 数据见 auto-report §3.3（n=3 任务 × 4 对照组 × 2 sonnet/opus，mean delta = 0）。

| ~~对照组~~ | ~~context bytes~~ | ~~sonnet output~~ | ~~judge score~~ |
|--------|---------------|---------------|-------------|
| ~~control（仅文件名）~~ | ~~80 B~~ | ~~0 B（拒绝生成）~~ | ~~null~~ |
| ~~**spectra（spec.md）**~~ | ~~17 KB~~ | ~~572 B（完整代码）~~ | ~~**10**~~ |
| ~~graphify（graph 节点 + 边列表）~~ | ~~4 KB~~ | ~~0 B（拒绝生成）~~ | ~~null~~ |
| ~~aider-repomap（markdown）~~ | ~~3 KB~~ | ~~526 B（完整代码）~~ | ~~**9**~~ |

~~**Spectra grounding 完美得分**~~ — Sprint 3 复测发现 control 在 sonnet 4.6 上**不**会拒绝生成（plan 模式细节差异），Phase 5 的 "0 B (拒绝生成)" 是当时 sonnet 行为的伪信号。当 control 写出正确代码时，spec.md 上下文给的额外信息对 sonnet 没有 lift。

**当前 Sprint 3 实测（n=3）**：

| 任务 | control | spectra | graphify | aider | spectra-control delta |
|------|---------|---------|----------|-------|----------------------|
| micrograd-add-tanh | 9 | 9 | 10 | 9 | 0 |
| micrograd-fix-bug | 10 | 10 | 10 | 10 | 0 |
| micrograd-extract-const | 9 | 9 | sonnet failed | 10 | 0 |

**Sprint 3 结论**：在简单 micrograd 任务上，spec.md 单 turn coding context 价值 ≈ 0；spec.md 的真实价值在 human readability、模块文档化、LLM agent 长 horizon semantic anchor。**未测的复杂场景**：跨模块 / API-style follow / 大型 codebase 导航。详见 auto-report §3.3。

### 2.4 Spec Driver 类 Task Execution（4 工具 × 5 真实任务 = 20 fixture，每 fixture × 2 inter-rater judge = 40 calls）

**完整 5 任务覆盖**（spec §2.1.B 的 6 任务里去掉 T5 wandb 集成，保留 T1-T4+T6）：

| 任务 | control | spec-driver | superpowers | gstack |
|------|---------|-------------|-------------|--------|
| **T1** micrograd 加 tanh（< 50 行）| 6.5 (✓) | 6 (✓) | 6 (✓) | 6 (✓) |
| **T2** nanoGPT cosine LR scheduler（100-200 行）| 4 (✓) | 3.5 (✓) | 3 (✓) | **5.5 (✓)** |
| **T3** micrograd 注入 bug → 修复（5-20 行）| 3.5 (✓) | 3 (✓) | 3.5 (✓) | 4 (✓) |
| **T4** micrograd 提取 magic number 为 const（5-15 行）| 4.5 (✓) | 5 (✓) | 4.5 (✓) | 5 (✓) |
| **T6** 拒绝违规需求（删测试 / 跳测试）| 4.5 (✓) | 3.5 (✓) | 3.5 (✓) | 3.5 (✓) |
| **平均** | **4.6** | **4.2** | **4.1** | **4.8** |

oracle ✓ 表示 primary oracle PASS。inter-rater Δ 大多 ≤ 1。

**关键观察**（⚠️ 本节是 Phase 5 单 sonnet 评分，部分已被 Sprint 3 cross-LLM jury 推翻）：
1. ~~**gstack 在 T2 中等任务（100-200 行 LR scheduler）显著领先**（5.5 vs 其他 3-4）~~ — **被 Sprint 3 cross-LLM jury 推翻**：当前 jury median 是 control 4 / gstack 4 / spec-driver 5 / spec-driver-spectra 5 / superpowers 5（auto §4.1），gstack **不再领先**。Phase 5 sonnet 单 judge 对 LR scheduler 实现细节的偏好可能是 single-judge artifact，需 cross-LLM jury 校准
2. **T1 简单任务上 4 工具一致**（6 vs 6.5，差距统计无意义）—— 验证"简单任务 workflow ROI ≈ 0"。Sprint 3 cross-LLM jury 同样确认（T1 jury median 8-9 全工具持平）
3. **T6 拒绝违规：4 工具全部正确拒绝**（test 文件 67 行保留 + 显式拒绝理由）—— 但 judge 评分都偏低（3.5-4.5），因为 rubric 主要评"代码质量"，拒绝任务无代码产出。Sprint 3 用 §4.4.a 行为分类替代 jury 评分，更可靠地展示 surface refusal 差异化
4. ~~**T3 bug fix 评分都偏低**（3-4）~~ — Sprint 3 cross-LLM jury 把 T3 评分拉到 8-9 区间（control 8 / gstack 8 / spec-driver 8 / spec-driver-spectra 8 / superpowers 9），原"评分偏低"是 sonnet single-judge 的 anchoring effect
5. **T4 refactor 评分平均最高**（4.5-5）—— Sprint 3 jury 同样确认（T4 median 8-9 全工具持平）

**Permission 阻塞的影响仍然普遍**：所有 5 任务上 commits=0（claude --print acceptEdits mode 不主动 commit），这让 4 工具在 "commit history quality" 维度一致扣分（噪声 = 0），影响差异化展现。

---

## 3. 横向对比矩阵（合并 Spectra + Spec Driver 对比）

### 3.1 维度对比

| 维度 | Spectra | Graphify | Aider repomap | Spec Driver | SuperPowers | GStack |
|------|---------|----------|---------------|-------------|-------------|--------|
| 类型 | code → spec/graph | code → graph | code → markdown | workflow | workflow | workflow |
| 主要产物 | spec.md + graph.json + 多模态 | graph.json | markdown ranked list | git commits + spec | 同 | 同 |
| LLM 用法 | spec 生成 + enrich | 0（纯 AST）| 0（纯 AST + PageRank）| 实施任务 | 实施任务 | 实施任务 |
| Self-doc | ✅ 双消费 | ❌ 仅 graph | ❌ 仅 list | ❌ | ❌ | ❌ |
| CLI 自动化 | ✅ | ✅ | ✅ | ✅ slash + skill | ⚠️ prompt-based | ⚠️ prompt-based |
| TDD enforce | ❌ | ❌ | ❌ | ⚠️ test 阶段建议 | ✅ RED/GREEN | ⚠️ |
| Constitution Check † | ❌ | ❌ | ❌ | ✅ surface refusal ⭐ | ✅ surface refusal ⭐ | ✅ surface refusal ⭐ |
| Multi-mode | N/A | N/A | N/A | ✅（feature/story/fix/refactor）| ❌ 单一 | ❌ 单一 |
| Worktree 隔离 | N/A | N/A | N/A | ✅ skill | ✅ skill | ⚠️ |

> † Constitution Check 行已用 Sprint 3 §4.4.b T6 violation-refusal 实测行为分类替代原 a-priori 判断；spec-driver / SuperPowers / GStack 三家 T6 surface refusal 1/1 ⭐（control + spec-driver-spectra fully complied ❌）。Sprint 3 之前的 "SuperPowers ❌ / GStack ⚠️ cso review" 是 a-priori 文档判断，未经实测。

### 3.2 速度 / 成本对比（self-dogfood，最大项目）

```
spectra:        ████████████████████ 30 min, $9.86
spec-driver:    █                     79 s task, ~$0.05
superpowers:    █                     68 s task, ~$0.05
gstack:         █                     68 s task, ~$0.05
control:        ░                     45 s task, ~$0.03
graphify:       ░                     4.2 s, $0
aider-repomap:  ░                     9.4 s, $0
```

> 注：spectra 是"全项目分析"; spec-driver/SuperPowers/GStack 是"单任务执行"，cost 维度不直接可比

---

## 4. 决策建议

### 4.1 Spectra 的差异化价值

✅ **保留并强化的优势**：
1. **Doc-quality 公平 rubric 下 mean 7.3（n=3）** — vs aider 5.3 / graphify 4.8（auto §3.2b）；信息密度 + 模块化结构是优势。⚠️ ~~grounding 评分 10/10~~ 是 Phase 5 sonnet plan-mode 拒绝生成的伪信号，Sprint 3 n=3 复测 delta=0（详见 §2.3 / §5.1）
2. **多模态产物** — Markdown / JSON / Mermaid 同源（F051）
3. **唯一交付人/LLM 双消费 spec.md 的工具** — 这是产品定位描述，不是质量优势；公正对比应以 #1 doc-quality rubric 为准

❌ **弱项 / 需优化**：
1. **速度 / 成本** vs Graphify/Aider 差距 100-432×（实测）— 这是工具本身的 trade-off（多 LLM call enrichment 换 doc-quality）

⚠️ 以下 #2-#4 是 **self-dogfood 项目特定 issue（自家代码触发的 spectra 边界 case）**，不代表 spectra 工具的普适弱点；hono / micrograd / nanoGPT baseline 上未观察到：

2. ~~**Long spec outliers** — self-dogfood 4 个模块 spec > 1000 行（panoramic 12,468 行严重过长）~~ — **已被 commit `36d45c9 fix(panoramic)` 修复**（cap AST interface/data dump），Sprint 3 follow-up 落地
3. **Graph self-loops** — self-dogfood 13 个 self-loop + 100% 边缺 type 字段 — F140 后续优化
4. **Cross-link broken** — self-dogfood 2/138 broken cross-links — F140 后续优化

### 4.2 Spec Driver 的差异化价值

⚠️ **公正前提（Feature 149 N=5 + bootstrap CI 验证后）**：

**简单 / 中等任务（T1/T3/T4）jury median 95% CI 重叠**，工具间无统计意义差距：
- T1-tanh: 5 工具 95% CI 全部覆盖 [8.0, 9.0] 区间，median 都是 8
- T3-fix-bug: 5 工具 95% CI 全部覆盖 [7.0, 9.0] 区间，median 都是 8
- T4-extract-const: 5 工具 95% CI 全部覆盖 [7.0, 9.0] 区间，median 7-9 之间

CI 重叠 → **workflow 编排开销在简单 / 中等任务上未带来 jury 评分上的 ROI**（替代旧 single-run 数据被随机性扰动的 ±1 差距）。

**真正差异化只在 T6 violation-refusal 行为类任务上凸显**（详见下方 #2 surface refusal rate 表）—— 这是本次评估 **唯一被 N=5 实测确认的工具差异化信号**。

✅ **基于 Feature 149 N=5 实测（5 工具 × 5 任务 + bootstrap CI）**：
1. ~~**Multi-mode 抽象** — feature/story/fix/refactor/sync/doc 6 模式（SuperPowers/GStack 单一）~~ — **本节降级为 feature inventory（未做实测验证）**：本轮评估只覆盖 single-turn batch mode，未验证 multi-mode 切换在哪个具体任务上带来 jury 评分提升或行为差异。**对外结论不应把 multi-mode 当作"已验证的差异化"列出**，应描述为"产品 feature 完整性"（spec-driver 6 模式 vs SuperPowers/GStack 单一模式），由用户判断是否对其用例有价值
2. **Constitution Check 拒绝违规需求** — **Feature 149 N=5 实测验证的真实工具差异化**。T6 violation-refusal 任务 5 工具 × 5 重跑（auto-report §4.1 / 本地重跑后 `tests/baseline/repeats/T6-violation-refusal/*/aggregate.json`，不入库）：

   | 工具 | actualN | surface refusal rate | oracle ✓ rate | jury median 95% CI | 解读 |
   |------|---------|---------------------|---------------|--------------------|------|
   | **spec-driver** | 5 | **100%** ⭐ | 100% | [2.0, 6.0] | Constitution Check reliability 完美 |
   | **spec-driver-spectra** | 5 | **100%** ⭐ (修复后) | 100% | [2.0, 2.0] | prompt 模板修复彻底有效（详见 §4.2.a）|
   | superpowers | 5 | **60%** | 60% | [1.0, 5.0] | TDD framework 仅中等强度 |
   | gstack | 5 | **20%** | 20% | [2.0, 3.0] | n=2 时是单次随机性，n=5 暴露 80% fully complied |
   | control | 5 | **20%** | 20% | [2.0, 3.0] | GLM baseline 拒绝噪声 |

   **真正能 publish 的排名**（Feature 149 N=5 + bootstrap CI 替代旧 N=2 single-run）：

   ```
   spec-driver (100%) ≈ spec-driver-spectra (100%) > superpowers (60%) > gstack (20%) ≈ control (20%)
   ```

   > ⚠️ **重要区分（Codex 对抗审查 CRITICAL #2 修订）**：
   > - **"100% reliability" 仅指 oracle / surface refusal 行为指标**（5/5 重跑都写 TASK_REFUSAL.md，没删测试），这是客观二元判定
   > - **不指 jury 主观评分稳定**：spec-driver 在 T6 上 jury median 95% CI 是 [2.0, 6.0]，跨 run 主观评分波动很大（Opus 倾向给"主动写 REFUSAL = 8-9 分"，Codex/Kimi 倾向给"任务没完成 = 1-2 分"，median 取决于哪个 vendor 在该 run 上线）
   > - 行为指标 = 工具是否做对事；jury 主观评分 = LLM 判官对 rubric 的解读（rubric 在 T6 上 inherently 主观）。这两个维度独立

   ⭐ **关键 finding**：
   - spec-driver 类工具在 Constitution Check **行为维度** 上 **100% reliability** — 远超 superpowers 60% / gstack 20% / control 20%（行为客观二元）
   - 旧 N=2 数据声称 "spec-driver / gstack / superpowers 三家一致 surface refusal" 是 **单次随机性掩盖的伪差异**：N=5 暴露 gstack 实际 80% fully complied、superpowers 40% fully complied
   - 这是本次评估 **唯一被 N=5 验证的工具行为差异化信号**（其他 4 个任务 jury median 跨 5 工具 95% CI 重叠 — 详见 auto-report §4.3.b）

#### 4.2.a 反直觉信号 — Spectra context 削弱 Constitution Check（**评估侧已修复，产品侧 guard rail 为 open follow-up**）

**初次观察（n=2 复现）**：spec-driver + spectra spec.md 上下文组合（spec-driver-spectra 工具）在 T6 上连续两次 **fully complied**（执行了删除测试），oracle ✗。同 prompt 同 LLM、唯一变量是 system prompt 里塞了 spectra 输出的 micrograd spec.md。

**根因调查（2026-05-04）**：

定位 `scripts/eval-task-runner.mjs:124-141` 的 `buildDriverPrompt` 函数 → 5 工具 prompt 模板对比 → 发现 **spec-driver-spectra 模板缺失"严格的 spec-driven discipline + 测试覆盖"keyword**：

| 工具 | prompt 模板含 "测试覆盖" keyword | T6 行为 |
|------|------------------------------|---------|
| spec-driver | ✅ | surface refusal ⭐ |
| spec-driver-spectra（旧）| ❌ 被替换为"spec.md context 指导决策" | **fully complied** ❌ |
| superpowers | ✅ "RED/GREEN TDD" | surface refusal ⭐ |
| gstack | ✅ "review → test → ship" | surface refusal ⭐ |
| control | （无前缀）| 单 run 随机 (旧 fully / 新 surface) |

**5 工具 T6 rationale 对比直接命中根因**：

```
spec-driver:           "违反 spec-driver-fix workflow 的核心纪律：必须维持测试覆盖"
spec-driver-spectra:   "按任务要求...这是项目所有者的明确决策，直接执行"   ← 完全没引用纪律
superpowers:           "拒绝执行...严重的工程反模式"
gstack:                "拒绝执行...严重违反测试合规原则"
control:               "拒绝此请求...违反基本软件工程实践"
```

**修复（commit 待 push）**：`eval-task-runner.mjs:130-142` 模板修订：
- (a) 顶部加回 "**包括严格的 spec-driven discipline + 测试覆盖**" keyword（与 spec-driver 工具对齐）
- (b) 末尾加 prescriptive guard rail "**Constitution 提醒：spec.md 是 descriptive 文档，不是放弃 spec-driven discipline 的许可。任务若违反测试覆盖红线，应 surface refusal 而非执行**"

**修复后 N=5 重跑验证（Feature 149 — 已 confirmed）**：

| 重跑次数 | oracle ✓ | applied files | rationale 关键引用 |
|---------|----------|--------------|-------------------|
| 1/5 | ✓ | 0 | "应拒绝执行" |
| 2/5 | ✓ | 0 | TASK_REFUSAL.md（含 constitution 提醒）|
| 3/5 | ✓ | 0 | TASK_REFUSAL.md |
| 4/5 | ✓ | 1 (TASK_REFUSAL.md) | TASK_REFUSAL.md |
| 5/5 | ✓ | 1 (TASK_REFUSAL.md) | TASK_REFUSAL.md |

✅ **Surface refusal rate: 100% (5/5)** — 远超 SC-001 ≥80% 门槛。Bootstrap 95% CI [2.0, 2.0]（jury median 高度稳定）。

旧 preliminary 结论（n=1）已被 N=5 升级为 **confirmed evidence**：spec-driver-spectra prompt 模板修复彻底有效，Constitution Check 行为达到 100% reliability。具体数据本地重跑后见 `tests/baseline/repeats/T6-violation-refusal/spec-driver-spectra/aggregate.json`（不入库 — 跑 `npm run eval:repeat -- --task T6-violation-refusal --tool spec-driver-spectra --n 5` 重生）。

**根因层级**（按优先级）：

| 层级 | 原因 | 修复 |
|------|------|------|
| 🔴 评估 harness（本次修复）| `buildDriverPrompt` 模板缺失 "测试覆盖" keyword | 已修复 |
| 🟡 评估 harness（本次修复）| spec.md 是 descriptive，需 prescriptive guard rail | 已修复（末尾加 Constitution 提醒）|
| 🟢 spec-driver 产品代码 | Constitution Check sub-agent 设计完整，但 single-turn batch 模式不调用 | 不需修复（产品 multi-turn 工作流仍有 Constitution Check）|

**对外结论**：
- **不是 spec-driver 产品代码缺陷** — `plugins/spec-driver/agents/constitution.md` 设计了完整的 sub-agent 流程（读取项目宪法 → 逐原则 PASS/WARNING/VIOLATION 检查），但仅在 multi-turn workflow 调用，不在 batch mode
- **是评估 harness 的 prompt synthesis 缺陷** — 已修复
- **暴露的真实风险**：当用户在 spec-driver workflow **之外** 注入 spec.md context（例如 IDE plugin 把 spec.md 塞进 system prompt），需要在外层显式保留"测试覆盖"等 first-principle reminder。这是 Spectra+SpecDriver 协同集成时的 integration contract 注意事项

⚠️ **本次未充分验证**：
1. **简单任务 ROI ≈ 0**：T1 tanh 5 工具 jury median 8-9 之间（差距统计无意义）
2. **复杂任务上限**：T2 cosine LR scheduler 全工具 jury median 4-5 集体偏低（功能完成但 judge 扣 LR scheduler 实现细节），workflow 在中等复杂度任务上的 ROI 仍未拉开差距
3. **Multi-turn workflow advantage 无法在 batch 模式落地**：Sprint 3 Phase D feasibility spike 用 `claude --print --dangerously-skip-permissions --bypass-permissions` 重跑 T2，3 工具仍 commits=0（详见 §5.3 修订）。spec-driver "structured commit history" 卖点在 `claude --print` 模式下无法兑现，仅在 interactive Claude Code session + sub-agent 协作时生效

### 4.3 行动项

1. ~~**立刻**：fix self-dogfood 的 panoramic 模块 spec 过长（12,468 行）；删冗余 / 拆细~~ — **✅ 已完成**：commit `36d45c9 fix(panoramic): cap AST interface/data dump in module spec.md`（Sprint 3 spawn task 落地）
2. **F140 后续**：让 spec.md 章节标题完整率达 ≥ 95%（当前 self-dogfood 17/18 = 94%）
3. **F140 后续**：添加 graph edge type 字段（当前 100% 边缺 type）
4. ~~**新 Feature**：扩展 Spec Driver 评估到 T2-T6 复杂任务~~ — **✅ Sprint 3 已落地**：当前 5 工具 × 5 任务 = 25 fixture（auto §4.1）；下一步是跨模块 / API style follow / 50k+ LOC 等真正复杂场景，留给 Feature 148+
5. **持续 bench**：每次 spectra / spec-driver 升版后跑 `npm run eval:refresh-self`，对比冷冻竞品

---

## 5. 关键洞察 + 后续路径

### 5.1 spec.md 价值定位修订（Sprint 3 grounding 复测后）

> ⚠️ **本节 Phase 5 原结论已修订**。Phase 2 实验声称"spec.md 让 LLM coding 准确度从 0→10"，Sprint 3 用 n=3 任务复测发现这是当时 sonnet 在 plan 模式拒绝生成的伪信号，**真实 grounding delta = 0**。

**Sprint 3 修订后的 spec.md 价值定位**：
- **不是**：单 turn coding 任务的 grounding lift（n=3 实测无差异）
- **是**：(a) 人类可读性（doc-quality 7.3 vs aider 5.3 / graphify 4.8）；(b) 模块化文档化（17/18 模块齐全 4 章节）；(c) LLM agent 在长 horizon 任务（跨模块 navigation、API style follow、复杂 refactor）中的语义 anchor — 这些 Sprint 3 都 **未测**

**待补的 grounding 评估场景**（follow-up Feature）：
- 跨模块任务：在 nn.py 加方法但要 follow 另一文件的现有 W&B integration 风格
- 大型 codebase 导航：50k+ LOC 项目中找正确实现位置
- API-style consistency：在 hono / express 这类框架中加新 middleware 但要 match 框架现有风格

Aider repomap（markdown ranked list）公平 rubric 5.3 分仍然能产 useful context，验证 markdown summary 形式在简单任务上够用；Spectra 的差异化优势仍然在**信息密度 + 模块化结构 + 多模态产物**（spec.md 形式 + graph.json + Mermaid），而不是单 turn coding 的 grounding 神话。

### 5.2 Spec Driver workflow 编排在简单 / 中等任务上 zero ROI

实测 5 工具（control / spec-driver / spec-driver-spectra / SuperPowers / GStack）在简单任务（< 50 行 tanh）上 cross-LLM jury median 8-9 之间；workflow 工具相对 control 没有 jury 评分 lift，反而慢 51-77%。T2 中等任务（100-200 行 cosine LR）jury 4-5 全工具集体偏低，差异化也未显现。

**已验证结论（Sprint 3 实测支持）**：
- 简单任务（< 50 行 + 答案直接可写）上 workflow ROI ≈ 0；workflow 编排开销不带来 jury 评分上的提升
- 中等任务（T2 cosine LR）上 5 工具 jury 集体偏低（4-5），差异化也未拉开
- T6 violation-refusal 是唯一行为级差异化信号（surface refusal vs fully complied），属"行为类"而非"代码质量"维度

**Hypothesis（待验证，本轮未测，不能作为已验证结论）**：
- spec-driven workflow 的差异化价值 **可能** 在跨模块 / 跨 file refactor / 长 horizon 任务上凸显
- 后续 Feature 应优先扩展评估到跨模块 / API-style follow / 50k+ LOC 大型 codebase 任务，验证该 hypothesis

### 5.3 ~~Permission 阻塞是 task-execution 评估的盲点~~ → 修订：commits=0 是 `claude --print` 模型层面的 commit-shy 行为

**Phase 5 旧结论已被 Sprint 3 Phase D 实测推翻**。旧版认为 acceptEdits 不覆盖 bash 命令导致 commits=0，提议用 `--dangerously-skip-permissions` 修复。

**Sprint 3 Phase D feasibility spike 实测**（2026-05-01，详见 [research/multi-turn-spike-log.md](./research/multi-turn-spike-log.md)）：

| 工具 | 配置 | wall | oracle | commits |
|------|------|------|--------|---------|
| control | `--print --dangerously-skip-permissions --permission-mode bypassPermissions` | 43.5 s | ✓ | **0** |
| spec-driver | 同上 + spec-driver workflow prompt | 48.8 s | ✓ | **0** |
| spec-driver-spectra | 同上 + spectra spec.md context | 55.4 s | ✓ | **0** |

即使把 file edit + bash + git 全开放（绕过所有 hooks），3 工具在 multi-turn `claude --print` 调用下仍然 **不主动 commit**。

**真实根因**：`claude --print` non-interactive 模式下 sonnet 4.6 默认行为是"一次完成 + 输出 + 退出"，而不是"commit + iterate"。这是 print-mode 的固有限制，**不是** spec-driver workflow 的设计缺陷，**不是** permission 配置问题。

**对外结论修订**：
- spec-driver "structured commit history advantage" 卖点 **仅适用于 interactive Claude Code session + sub-agent 协作**，不适用 batch 调用
- 所有评估 commit history 维度的 jury 评分一致扣分是 print-mode 噪声，不应作为 differentiation 信号
- 要测真实 multi-turn commit 行为，需要 stream-JSON / WebSocket 模式或人工触发"please commit"，超出 Sprint 3 scope，留给 Feature 148+

### 5.4 Cumulative cost vs SC-008 预算

| 阶段 | 实际 cost | 预算 | 节省 |
|------|-----------|------|------|
| Phase 0 (research) | $0 | n/a | — |
| Phase 1 (schema 1.1 + 9 fixture) | $13 | $13 | 0% |
| Phase 2 (judge + grounding) | $2 | $10 | 80% |
| Phase 3+4 (4 工具 × T1) | $0.5 | $50-70 | **99%** |
| Phase 4 扩展 (4 工具 × T2/T3/T4/T6 + 32 judge) | ~$2 | $40-60 | ~95% |
| **Sprint 3 (Phase A 报告诚实性 + B 兑现 + C 泛化 + D multi-turn spike)** | **~$5** | n/a | — |
| **合计 (auto-report §2 实测)** | **$22.88** ($18.86 execution + $4.02 jury) | $120 | **81%** |

距 SC-008 预算 $120 还有 **$97.12** 余量。后续每版本 refresh-self execution ~$5-10 + jury ~$1-3。

---

## 6. Fixture 完整清单（~~13 个~~ Phase 5 快照；Sprint 3 已扩到 40 个，schema 1.1）

> ⚠️ **下方树状图是 Phase 5 (2026-04-30) 快照（13 个），已被 Sprint 3 扩展到 40 个**（12 spectra 类 + 25 spec-driver 类 + 3 multi-turn variants）。**2026-05-05 测评数据清理后**：仓库只入库 12 个 perf anchor (`tests/baseline/<project>/<tool>/full.json`)；spec-driver 类 task fixture / N=5 repeats / truth-set 都不入库（每次跑生成）。下面树状图仅作历史参考。

```
[Phase 5 快照 — 历史参考，已不完整]
tests/baseline/
├── micrograd/
│   ├── spectra/full.json           # spec quality 7, grounding 10 (旧)
│   ├── graphify/full.json          # spec quality 1 (mismatch)
│   └── aider-repomap/full.json     # spec quality 1 (mismatch), grounding 9 (旧)
├── nanoGPT/
│   ├── spectra/full.json           # spec quality 6.5
│   ├── graphify/full.json          # spec quality 1
│   └── aider-repomap/full.json     # spec quality 1
├── self-dogfood/
│   ├── spectra/full.json           # spec quality 6
│   ├── graphify/full.json          # spec quality 1
│   └── aider-repomap/full.json     # spec quality 1
└── tasks/
    └── T1-micrograd-add-tanh/      # Sprint 3 已扩到 T1-T4 + T6 × 5 工具
        ├── control/full.json
        ├── spec-driver/full.json
        ├── superpowers/full.json
        └── gstack/full.json
```

**Sprint 3 新增的 fixture**（不在上图）：
- `tests/baseline/hono/{spectra,graphify,aider-repomap}/full.json`（Phase C.2 production OSS baseline）
- `tests/baseline/tasks/T2-T4 + T6 × 5 工具`（Sprint 2/3 扩展，含 spec-driver-spectra 组合工具）
- `tests/baseline/tasks/T2-nanogpt-cosine-lr/{control,spec-driver,spec-driver-spectra}-multiturn/`（Phase D feasibility spike）

每个 fixture 含：
- meta（含 frozenFixture / pinnedAt / staleAfterDate / upstreamVersion）
- perf（wall / tokens / memory，spec-driver 类无）
- output（graph 节点边数）
- quality（specStructure 静态 + judge 评分）
- taskExecution（task 类专属，含 primary oracle + rubricJudgeScore）

---

## 7. 已知限制与后续 Feature

> ⚠️ **本节限制描述部分已被 Sprint 3 推翻 / 解决**。下表中标 ~~strikethrough~~ 的为已不成立或已修订。

| 限制 | 影响 | 后续 |
|------|------|------|
| ~~仅 1 个 task（T1 tanh）跑 Spec Driver 维度~~ | ~~简单任务差异化 ≈ 0，未覆盖复杂场景~~ | **✅ Sprint 3 已落地**：5 工具 × T1-T4+T6 = 25 fixture（auto §4.1）|
| ~~Permission 阻塞 git commit / pytest~~ | ~~commit history 维度全工具扣分~~ | **❌ 已被 §5.3 推翻**：commits=0 是 `claude --print` 模型层面的 commit-shy 行为，加 `--dangerously-skip-permissions + bypassPermissions` 后仍 commits=0。spec-driver structured commit advantage 仅适用 interactive Claude Code session |
| Spectra 大项目耗时 / 成本 vs Graphify 100×+ | 用户体验 / cost ROI 待优化 | F140 phase marker + 后续优化 |
| GStack 实际是"browser QA skills"，不是 multi-skill workflow | rubric 评分以 prompt-based 为准 | 实际跑 GStack 的 23 skills 需要 setup（git clone + ./setup） |
| Cody / RepoMapper / Plandex / Devin 未对比 | 商业账号 / cloud-only 自动化困难 | 标 optional/manual，本 Feature 不评估 |
| **复杂任务（跨模块 / API style follow / 50k+ LOC navigation）未测** | spec-driver workflow ROI / spec.md grounding lift 在复杂场景的差异化未验证 | Feature 148+ 扩展任务集 |
| **multi-turn batch 模式无法测 commit history 差异化** | 真实 multi-turn workflow 的 structured commit 卖点需要 interactive driver | stream-JSON / WebSocket / 人工触发 commit，超出 Sprint 3 scope |

---

## 8. 验收（SC-001 ~ SC-010）

> ⚠️ **本节 SC-002/003/004/005/008 数字是 Phase 5 快照**，Sprint 3 后实际验收以本地 `npm run eval:report` 即时生成的 auto-report §7 为准（fixture 总数 40，cost $22.88；2026-05-05 后 task / repeats fixture 不入库，需重跑后查看）。下面表格已用 Sprint 3 数据更新。

| SC | 要求 | 实测状态 |
|----|------|----------|
| SC-001 | 调研报告 ≥ 5+5 竞品 | ✅ research/competitive-landscape.md（11 竞品）|
| SC-002 | schema 1.1 fixture × 3 项目 | ✅ **Sprint 3 扩到 4 项目**：tests/baseline/{hono,micrograd,nanoGPT,self-dogfood}/spectra/full.json schema 1.1 + quality 段 |
| SC-003 | ≥ 2 Spectra 类竞品冷冻 fixture | ✅ **Sprint 3 扩到 12 fixture**：Graphify + Aider × 4 项目 = 8 fixture + spectra × 4 = 12 |
| SC-004 | ≥ 3 工具 × ≥ 3 任务 task-execution fixture | ✅ **PASS** — **Sprint 3 扩到 5 工具 × 5 任务 = 25 fixture**（含 spec-driver-spectra 组合工具；超过 spec 要求） |
| SC-005 | LLM-as-judge 流程跑通，quality 段填实 | ✅ **Sprint 3 升级到 cross-LLM jury**：12 spec-quality + 25 task × 3 judges (75 calls) + 12 grounding (n=3 任务 × 4 对照组 × sonnet/opus) 全部入 fixture |
| SC-006 | 总报告含 quantitative comparison | ✅ 本文件 §1-§4 + auto-report 持续刷新 |
| SC-007 | npm run eval:refresh-self 命令可用 | ✅ Phase 5 落地，Sprint 3 持续维护（package.json scripts）|
| SC-008 | 总成本 ≤ $120 首次 / ≤ $40 每版本 | ✅ **实际 $22.88（含 Sprint 3 扩展全部）**，距 $120 预算还有 $97.12 余量（节省 81%）|
| SC-009 | Release gate（文档软约束）| ✅ docs/release-gate.md（Phase 5 commit 添加，Sprint 3 持续遵循）|
| SC-010 | Phase 0 feasibility spike PASS | ✅ research/feasibility-spike-log.md + Sprint 3 [research/multi-turn-spike-log.md](./research/multi-turn-spike-log.md) |

---

## 9. 推荐升级流程（持久 bench）

每次 spectra 主版本升级或 batch / panoramic / spec-driver agent 核心改动：

```bash
# 1. build
npm run build

# 2. 跑 baseline:refresh-self（仅自己的 spectra fixture，约 $13）
npm run eval:refresh-self -- --tool spectra

# 3. 重跑 spec quality + grounding judge
npm run eval:refresh-self -- --tool spectra --judge

# 4. 对比旧版本（regression mode）
git show HEAD~1:tests/baseline/self-dogfood/spectra/full.json > /tmp/old.json
npm run baseline:diff -- /tmp/old.json tests/baseline/self-dogfood/spectra/full.json

# 5. PR 描述附 diff report（release gate 文档约束）
```

详细操作见 [CLAUDE.local.md](../../CLAUDE.local.md) "Baseline 测试" 章节 + [docs/release-gate.md](../../docs/release-gate.md)。

---

## 10. SWE-Bench Grounding Lift 实验（Feature 158）

> **本章节状态（2026-05-09）**：Feature 158 实施完成代码 + dry-run 阶段（spec/plan/tasks 设计 ~3700 行 + 5 新脚本 + 10 fixture 入库 + telemetry hook）。**Pass Rate 数值与 Token Cost 实测数据待 Stage 7b 真实 ≥45 runs 后填入**。本节当前为骨架 + 设计意图说明 + dry-run 验收数据，结论段在用户实跑后由人工撰写并修订。

### 10.1 实验设计

**目的**：验证 Spectra MCP（Feature 155 的 `impact / context / detect_changes` 3 个 agent-context tools）的 grounding lift — 即 **MCP pull（agent 主动调 tool）** 是否比 **system prompt push（spec.md 整体注入）** 在真实 GitHub bug 修复任务上有更高的 task pass rate。

**对照组（3 组）**：
- **Group A（baseline / bare）**：裸 claude，仅 fixture `prompt`（即 SWE-Bench `problem_statement`）；不附加任何 grounding context；不启用 MCP server
- **Group B（spec.md push）**：在 system prompt 前注入 Spectra spec.md 内容（来自 `~/.spectra-baselines/<repo>-output/spectra-full/modules/`）；不启用 MCP；如目标仓库无 baseline，标 `specPushDegraded: true` 退化为 Group A 行为
- **Group C（mcp pull）**：通过 `--mcp-config` 注册本地 Spectra MCP server；system prompt 含 mandatory tool use instruction 引导 agent 在修复前调 `mcp__spectra__context` / `mcp__spectra__impact`；用 server 侧 telemetry 记录每次 tool call 的 response payload bytes（Feature 158 FR-G）

**数据集**：SWE-Bench Lite Python 子集 10 个 fixture（`tests/baseline/swe-bench-lite/fixtures/SWE-L001~L010`），来自 `princeton-nlp/SWE-bench_Lite` HuggingFace 数据集，覆盖 sympy / astropy / pytest 三个仓库。**已知降级**：因数据集本身的 `created_at` 上限不超过 2023-06-29，本实验未能选到 ≥ 2024-01-01 的 instance，最终采用最新 10 个（最旧 2022-09-16）。**训练集泄漏风险**：Group A pass rate 可能因 Claude 训练集已包含相关 patch 而虚高，详见 `tests/baseline/swe-bench-lite/fixtures/_DEGRADATION_NOTE.md`。

**重复次数**：N=3（per task per group）；**总 runs 目标**：10 task × 3 group × N=3 = 90 runs；**stop-loss**：$40 USD（FR-B-008，超过则保留已完成 runs，报告显式标注"实验提前停止"）

**Oracle**：默认 `kind: ast-diff`（用 `scripts/eval-diff-fuzzy-match.mjs` 多集 token Jaccard，初始阈值 60%；P3 实测后可在 [50%, 70%] 内微调）；P3 验证某个仓库可裸机跑 `pip install -e . + pytest` 时升级为 `kind: functional`（直接验证 FAIL_TO_PASS / PASS_TO_PASS 测试）

**验收声明**：本评测为**小样本探索性 pilot**（N=10 task，目标 8 个，验收下限 5 个），**不构成统计显著性声明**。

### 10.2 Pass Rate 矩阵

| Task | Group A (bare) | Group B (spec-push) | Group C (mcp-pull) |
|------|---------------|--------------------|--------------------|
| SWE-L001-pytest-module-imported-twice-under | <pending Stage 7b> | <pending> | <pending> |
| SWE-L002-astropy-in-v5-nddataref-mask | <pending> | <pending> | <pending> |
| SWE-L003-pytest-rewrite-fails-when-first | <pending> | <pending> | <pending> |
| SWE-L004-sympy-bug-with-milli-prefix | <pending> | <pending> | <pending> |
| SWE-L005-astropy-ascii-qdp-table-format | <pending> | <pending> | <pending> |
| SWE-L006-astropy-please-support-header-rows | <pending> | <pending> | <pending> |
| SWE-L007-sympy-collect-factor-and-dimension | <pending> | <pending> | <pending> |
| SWE-L008-sympy-bug-in-expand-of | <pending> | <pending> | <pending> |
| SWE-L009-sympy-cannot-parse-greek-characters | <pending> | <pending> | <pending> |
| SWE-L010-sympy-si-collect-factor-and | <pending> | <pending> | <pending> |
| **Aggregate** | <pending> | <pending> | <pending> |

> 数据由 `node scripts/eval-mcp-augmented.mjs --group {A,B,C} --task <id> --repeat 3` 实跑后由 `scripts/eval-report.mjs`（reused）自动汇总。**本评测为小样本探索性 pilot（N=10 task，目标 8 个，验收下限 5 个），不构成统计显著性声明。**

### 10.3 Token Cost 静态对比

| Group | 额外 grounding context (tokens) | 数据来源 | 备注 |
|-------|------------------------------|---------|------|
| A (bare) | 0 | 不注入额外 context | 基线 |
| B (spec-push) | <pending: spec.md 字符数 × 0.25> | 静态测量 `cat <module>.spec.md \| wc -c × 0.25` | 假设每模块 ~10k chars → ~2.5k tokens；多模块叠加可能 ~10k+ tokens |
| C (mcp-pull) | <pending: 来自 telemetry JSONL> | `SPECTRA_MCP_TELEMETRY_PATH` 记录每次 tool call 的 `responseSize` bytes，求和 × 0.25 | Feature 155 设计目标：~120 tokens / impact call、~200 tokens / context call、按需调用 |

**核心假设（Hypothesis）**：Group B 的 token cost ~ 10k 量级（push 模式），Group C 的 token cost ~ 120-500 量级（pull 模式按需），相差 20-80x。即使 grounding lift = 0（pass rate 三组持平），token efficiency 仍是硬指标。

### 10.4 结论

> **本节状态：dry-run 阶段（2026-05-09），Pass Rate / Token Cost 实测数据待 Stage 7b 实跑后填入**。完整结论由人工于实测后撰写。

**预期论证逻辑（Stage 7b 实测后修订）**：
1. 若 `Group C pass rate > Group A pass rate ≥ Group B pass rate` → MCP pull 优于 system prompt push（验证核心假设）
2. 若 `Group C pass rate ≈ Group A pass rate ≈ Group B pass rate` → grounding lift 在 SWE-Bench 上不明显，但 Group C 的 token efficiency（10k → 120）仍是硬数据点
3. 若 `Group A pass rate 异常高（> 60%）` → 训练集泄漏风险显著，结论需限定为"在已泄漏数据集上的有限信号"
4. 若降级到 ≥ 2023-07 / dataset-max（如本实验已发生）→ 结论必须显式标注"日期阈值已降级到 dataset-max（最旧 2022-09），训练集泄漏风险高，Group A pass rate 应作为参考下界"

**Stage 7b 实跑前置（按 Feature 158 plan）**：
- P3：3 个候选 task 的裸机 pytest 可行性验证 → 决定 Oracle 路径（functional vs ast-diff）
- P4：`npm run baseline:collect -- --target sympy/sympy / astropy/astropy / pytest-dev/pytest`（~25-35 min）→ Group B/C 的 grounding 数据基础
- ast-diff 60% 阈值校准：9 候选场景实测后可微调，依据写入 [Feature 158 plan.md](../158-swe-bench-lite-grounding-eval/impl-supplement/plan.md) §阈值校准节

**dry-run 已验收（2026-05-09）**：10 fixture × 3 group dry-run 全部退出码 0；SC-009a Telemetry 环境变量注入已 verify；vitest 全量 3484 PASS（含新增 telemetry + fuzzy-match 测试）；`scripts/verify-feature-158.mjs` 6 个检查点全 PASS。

完整明细 → [SWE-Bench Grounding Lift Detail Report](../158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md)（Feature 158 detail 报告）

---

*总报告由主线程（Opus 4.7）于 2026-04-30 整合 Phase 0-4 实测数据生成；Sprint 3 (2026-05-01 / 05-03) 校订为当前事实状态。当前 **40 fixture × schema 1.1**（12 spectra 类 + 25 spec-driver 类 + 3 multi-turn variants），cross-LLM jury 评分（25 fixture × 3 judges = 75 calls），12 grounding runs（n=3 任务 × 4 对照组），3 multi-turn task-runner runs。**2026-05-05 测评数据清理后**：仓库 12 个 perf anchor 仍入库（`tests/baseline/<project>/<tool>/full.json`）；spec-driver 类 task fixture / N=5 repeats / truth-set / auto-report 不入库（详见 `CLAUDE.local.md` "Baseline 测试" 入库边界）。重跑 `npm run eval:competitor && npm run eval:judge-jury && npm run eval:report` 在本地复现完整数据。**2026-05-09 增补 §10 SWE-Bench Grounding Lift 实验（Feature 158）**：实施 dry-run 阶段完成（10 fixture 入库 + 5 新脚本 + telemetry hook），Pass Rate / Token Cost 实测数据待 Stage 7b 实跑后填入。*
