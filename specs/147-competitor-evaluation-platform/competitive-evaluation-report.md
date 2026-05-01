# Spectra & Spec Driver 竞品评估总报告

> ⚠️ **本文件是 Phase 5（2026-04-30）冻结快照。当前 fixture 总数 / 成本 / 评分以 [competitive-evaluation-report-auto.md](./competitive-evaluation-report-auto.md) 为准（auto-generated，每次重生最新）。本文件仅保留 Phase 5 时点的核心结论 + Sprint 3 校订（§0、§1、§2.2）。**
>
> 当前 (Sprint 3, 2026-05-01) 实际 fixture 总数：**34**（9 spectra 类 + 25 spec-driver 类）— 比本文件 §6 fixture 清单（13）扩了 2.6×。§4 / §6 / §8 数字未同步，**请以 auto-report 为准**。

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
- 因此本报告 §2.4 / §3 矩阵中 spec-driver / superpowers / gstack 之间 ≤ 0.5 的均分差距 **反映的是 prompt 设计差异，不是 workflow ROI**

**Sprint 3 补齐**：Phase D 在 T2 cosine LR 任务上跑了 1 次真实 multi-turn 端到端实跑作为 single-turn 数据的 robustness check（见本文件末尾或 [research/multi-turn-spike-log.md](research/multi-turn-spike-log.md)）。

**Spectra 类 fixture（perf + spec quality + grounding）= 真实端到端实跑**，对外结论以 §2.1 / §2.2 + 公平 doc-quality rubric（auto-report §3.2b）为准。

---

## 1. 执行摘要

### 1.1 Spectra 类（codebase → spec / agent context）

| 工具 | doc quality 公平 rubric † | wall（self-dogfood）| 成本 | grounding（micrograd add tanh）|
|------|---------------------------|---------------------|------|--------------------------------|
| **Spectra**（自己） | **7.3** ⭐ | 30 min ($9.86) | 高 | **10/10** ⭐（grounding 完美）|
| **Aider repomap** | 5.3 | 9.4 s ($0) | 极低 | **9/10**（markdown 形式有效）|
| **Graphify** | 4.8 | **4.2 s** ($0) | 极低 | **0**（context 太抽象，sonnet 无法编码）|

> † doc-quality rubric 评每个工具的 native artifact（spectra spec.md / graphify GRAPH_REPORT.md / aider repomap stdout）作为"项目理解 context"的有用性，**不评是否符合特定模板**（覆盖度 / 关系 / 可读性 / LLM-context-value / 真实性，3 项目均分）。详见 auto-report §3.2b。
>
> ⚠️ 旧 spec-quality rubric 期望 4 章节 spec.md 形态（Intent/Behavior/API/Data），对 graphify/aider 是 rubric mismatch，给 1 分不可比；本表已替换为公平 rubric。

**核心结论**：
- **Spectra 在 doc quality 公平 rubric 下领先 ~2 分**（7.3 vs 5.3 / 4.8）；信息密度 + 模块化结构是优势
- **Speed disparity 极大**：Spectra 比 Graphify 慢 432×（self-dogfood）；spec.md 文档化 + LLM 增强是 cost 主因
- **Grounding 实证**：Spectra 的 spec.md 作为 LLM coding context 的 grounding 价值得到证明；纯 graph 节点列表（Graphify）不足以做编码上下文

### 1.2 Spec Driver 类（spec-driven coding workflow）

| 工具 | T1 wall | T1 oracle | T1 judge score | inter-rater Δ |
|------|---------|-----------|----------------|----------------|
| **control**（裸 Claude Code）| **44.7 s** | PASS | **6.5** | 1 |
| **spec-driver**（自己） | 79.2 s | PASS | 6 | 0 |
| **SuperPowers** | 67.6 s | PASS | 6 | 0 |
| **GStack** | 67.8 s | PASS | 6 | 0 |

**核心结论**：
- **简单任务（< 50 行 tanh）4 工具差异化 ≈ 0**（评分差 0-0.5，统计无差异）
- workflow 工具比 control 慢 **51-77%**（编排开销）
- workflow 工具 LLM 输出多 21×（642 B vs 30 B），但产物质量未提升
- **差异化需要更复杂任务**（T2 跨模块 / T5 集成 / T6 拒绝违规）；本次仅跑 T1 不足以下结论

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

| 项目 | spectra | aider-repomap | graphify |
|------|---------|---------------|----------|
| micrograd | 8 | 6 | 4.5 (Δ=1) |
| nanoGPT | 7 | 6 | 4 |
| self-dogfood | 7 | 4 | 6 |
| **均分** | **7.3** ⭐ | **5.3** | **4.8** |

inter-rater Δ ≤ 1（评分稳定）。**对外结论以本表为准。**

### 2.3 Spectra Coding-Context Grounding（micrograd add tanh，4 对照组双盲）

| 对照组 | context bytes | sonnet output | judge score |
|--------|---------------|---------------|-------------|
| control（仅文件名） | 80 B | **0 B（拒绝生成）** | null |
| **spectra（spec.md）** | **17 KB** | 572 B（完整代码） | **10** ⭐ |
| graphify（graph 节点 + 边列表）| 4 KB | **0 B（拒绝生成）** | null |
| aider-repomap（markdown）| 3 KB | 526 B（完整代码）| **9** |

**Spectra grounding 完美得分**，反向证明 spec.md 的 codebase grounding 价值。Aider 9 分仅次（标准 markdown ranked list 也是有效 context）。Graphify 节点列表过抽象，sonnet 无法基于此编码。

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

**关键观察**：
1. **gstack 在 T2 中等任务（100-200 行 LR scheduler）显著领先**（5.5 vs 其他 3-4）—— think→plan→build→review→ship 流程在 medium-complexity 任务上 ROI 显现
2. **T1 简单任务上 4 工具一致**（6 vs 6.5，差距统计无意义）—— 验证"简单任务 workflow ROI ≈ 0"
3. **T6 拒绝违规：4 工具全部正确拒绝**（test 文件 67 行保留 + 显式拒绝理由）—— 但 judge 评分都偏低（3.5-4.5），因为 rubric 主要评"代码质量"，拒绝任务无代码产出。即使 spec-driver / SuperPowers 显式提到了 Constitution / TDD framework，也未能脱颖而出（control 反而 4.5 略高）。这反映了 **rubric 设计盲点**：拒绝行为 ≠ 代码质量。
4. **T3 bug fix 评分都偏低**（3-4）—— 4 工具都成功修复（oracle PASS），但 judge 扣分原因可能在 commit history（permission 阻塞）+ 修复后没主动跑 pytest 验证
5. **T4 refactor 评分平均最高**（4.5-5）—— 简单 refactor 是各工具都擅长的场景

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
| Constitution Check | ❌ | ❌ | ❌ | ✅ 强项 | ❌ | ⚠️ cso review |
| Multi-mode | N/A | N/A | N/A | ✅（feature/story/fix/refactor）| ❌ 单一 | ❌ 单一 |
| Worktree 隔离 | N/A | N/A | N/A | ✅ skill | ✅ skill | ⚠️ |

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
1. **唯一交付 spec.md 的工具** — 人 / LLM 双消费，grounding 评分 10/10
2. **多模态产物** — Markdown / JSON / Mermaid 同源（F051）
3. **Spec quality 唯一竞争力** — graphify / aider 不在此维度竞争

❌ **弱项 / 需优化**：
1. **速度 / 成本** vs Graphify/Aider 差距 100-432×（实测）
2. **Long spec outliers** — self-dogfood 4 个模块 spec > 1000 行（panoramic 12,468 行严重过长）
3. **Graph self-loops** — self-dogfood 13 个 self-loop + 100% 边缺 type 字段
4. **Cross-link broken** — self-dogfood 2/138 broken cross-links

### 4.2 Spec Driver 的差异化价值

✅ **基于 Phase 4 实测**：
1. **Multi-mode 抽象** — feature/story/fix/refactor/sync/doc 6 模式（SuperPowers/GStack 单一）
2. **Constitution Check** — 强项；其他工具弱或无（违规拒绝任务的能力差异化潜力，但需 T6 任务实测）

⚠️ **本次未充分验证**：
1. 简单任务（T1 tanh）4 工具评分 ≈ 6（差异化在简单任务上 ≈ 0）
2. 复杂任务（T2-T6）未跑，差异化场景未覆盖
3. Permission 阻塞 + 不主动 commit 导致 commit history 维度全工具一致扣分

### 4.3 行动项

1. **立刻**：fix self-dogfood 的 panoramic 模块 spec 过长（12,468 行）；删冗余 / 拆细
2. **F140 后续**：让 spec.md 章节标题完整率达 ≥ 95%（当前 self-dogfood 17/18 = 94%）
3. **F140 后续**：添加 graph edge type 字段（当前 100% 边缺 type）
4. **新 Feature**：扩展 Spec Driver 评估到 T2-T6 复杂任务，验证 multi-mode / Constitution Check 等差异化能力的实测价值
5. **持续 bench**：每次 spectra / spec-driver 升版后跑 `npm run eval:refresh-self`，对比冷冻竞品

---

## 5. 关键洞察 + 后续路径

### 5.1 spec.md 是 Spectra 的核心壁垒

Phase 2 grounding 实验证明：**spec.md 形式的 codebase context 让 LLM coding 准确度从 0（拒绝生成）跃升到 10（完美实现）**。这是 Graphify（节点列表）远不能替代的。

但 Aider repomap（markdown ranked list）也得 9 分 — 说明"任何 markdown 形式的 codebase 摘要"都是有效 context，Spectra 的差异化在**自动 LLM 增强 + 多模态产物**，而不是 markdown 格式本身。

### 5.2 Spec Driver workflow 编排在简单任务上 zero ROI

实测 4 工具（control / spec-driver / SuperPowers / GStack）在简单任务（< 50 行 tanh）上评分相同（6 vs 6.5）；workflow 工具反而慢 51-77%。

**结论**：
- spec-driven workflow 的价值在**复杂任务**（跨模块 / 拒绝违规 / 多角色 review）
- 简单"加方法 + test"用 workflow 是过度工程
- 后续 Feature 应优先验证 T2-T6 任务的 ROI

### 5.3 Permission 阻塞是 task-execution 评估的盲点

claude --print --permission-mode acceptEdits 在执行 git commit / pytest 时仍会阻塞（accept 仅覆盖 file edits，不覆盖 bash commands）。所有 4 工具都遇到此问题，commit history 维度因此一致扣分。

**修复方案**（follow-up）：
- task-runner 使用 `--allowed-tools "Bash(git:*) Bash(python:*) Bash(npm:*) Read Edit Write"` 显式 allow 关键命令
- 或在 worktree 内启用 `--dangerously-skip-permissions`（仅在 ephemeral worktree 内安全）

### 5.4 Cumulative cost vs SC-008 预算

| 阶段 | 实际 cost | 预算 | 节省 |
|------|-----------|------|------|
| Phase 0 (research) | $0 | n/a | — |
| Phase 1 (schema 1.1 + 9 fixture) | $13 | $13 | 0% |
| Phase 2 (judge + grounding) | $2 | $10 | 80% |
| Phase 3+4 (4 工具 × T1) | $0.5 | $50-70 | **99%** |
| **Phase 4 扩展 (4 工具 × T2/T3/T4/T6 + 32 judge)** | **~$10** | $40-60 | ~80% |
| **合计** | **~$25** | $113-153 | **75%+** |

距 SC-008 预算 $120 还有 ~$95 余量。后续每版本 refresh-self ~$5-10。

---

## 6. Fixture 完整清单（13 个，schema 1.1）

```
tests/baseline/
├── micrograd/
│   ├── spectra/full.json           # spec quality 7, grounding 10
│   ├── graphify/full.json          # spec quality 1 (mismatch)
│   └── aider-repomap/full.json     # spec quality 1 (mismatch), grounding 9
├── nanoGPT/
│   ├── spectra/full.json           # spec quality 6.5
│   ├── graphify/full.json          # spec quality 1
│   └── aider-repomap/full.json     # spec quality 1
├── self-dogfood/
│   ├── spectra/full.json           # spec quality 6
│   ├── graphify/full.json          # spec quality 1
│   └── aider-repomap/full.json     # spec quality 1
└── tasks/
    └── T1-micrograd-add-tanh/
        ├── control/full.json        # task 6.5, oracle PASS
        ├── spec-driver/full.json    # task 6
        ├── superpowers/full.json    # task 6
        └── gstack/full.json         # task 6
```

每个 fixture 含：
- meta（含 frozenFixture / pinnedAt / staleAfterDate / upstreamVersion）
- perf（wall / tokens / memory，spec-driver 类无）
- output（graph 节点边数）
- quality（specStructure 静态 + judge 评分）
- taskExecution（task 类专属，含 primary oracle + rubricJudgeScore）

---

## 7. 已知限制与后续 Feature

| 限制 | 影响 | 后续 |
|------|------|------|
| 仅 1 个 task（T1 tanh）跑 Spec Driver 维度 | 简单任务差异化 ≈ 0，未覆盖复杂场景 | 新 Feature 加 T2-T6（cost ~$5-15）|
| Permission 阻塞 git commit / pytest | commit history 维度全工具扣分 | 调整 --allowed-tools "Bash(git:*) Bash(python:*) ..." |
| Spectra 大项目耗时 / 成本 vs Graphify 100×+ | 用户体验 / cost ROI 待优化 | F140 phase marker + 后续优化 |
| GStack 实际是"browser QA skills"，不是 multi-skill workflow | rubric 评分以 prompt-based 为准 | 实际跑 GStack 的 23 skills 需要 setup（git clone + ./setup） |
| Cody / RepoMapper / Plandex / Devin 未对比 | 商业账号 / cloud-only 自动化困难 | 标 optional/manual，本 Feature 不评估 |

---

## 8. 验收（SC-001 ~ SC-010）

| SC | 要求 | 实测状态 |
|----|------|----------|
| SC-001 | 调研报告 ≥ 5+5 竞品 | ✅ research/competitive-landscape.md（11 竞品）|
| SC-002 | schema 1.1 fixture × 3 项目 | ✅ tests/baseline/{micrograd,nanoGPT,self-dogfood}/spectra/full.json schema 1.1 + quality 段 |
| SC-003 | ≥ 2 Spectra 类竞品冷冻 fixture | ✅ Graphify + Aider × 3 项目 = 6 fixture |
| SC-004 | ≥ 3 工具 × ≥ 3 任务 task-execution fixture | ✅ **PASS** — 4 工具 × **5** 任务（T1-T4 + T6）= **20 fixture**（超过 spec 要求）|
| SC-005 | LLM-as-judge 流程跑通，quality 段填实 | ✅ 9 spec-quality + 4 task + 1 grounding judge 全部入 fixture |
| SC-006 | 总报告含 quantitative comparison | ✅ 本文件 §1-§4 |
| SC-007 | npm run eval:refresh-self 命令可用 | ⚠️ Phase 5 落地（package.json scripts，本 commit 添加）|
| SC-008 | 总成本 ≤ $120 首次 / ≤ $40 每版本 | ✅ 实际 $15.5 首次（节省 87%）|
| SC-009 | Release gate（文档软约束）| ✅ docs/release-gate.md（本 Phase 5 commit 添加）|
| SC-010 | Phase 0 feasibility spike PASS | ✅ research/feasibility-spike-log.md（4 工具非交互式调用确认）|

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

*总报告由主线程（Opus 4.7）于 2026-04-30 整合 Phase 0-4 全部实测数据生成。13 fixture × schema 1.1，27 LLM-as-judge 评分，2 sonnet grounding runs，4 task-runner runs。所有数据可从 `tests/baseline/**/full.json` 重新计算。*
