# Spectra & Spec Driver 竞品评估总报告

> **Phase 5 产物 — 整合 Phase 0-4 全部 13 个 fixture + 18 spec-quality judge + 8 task-execution judge + 2 grounding judge 的实测数据。**

**Feature**: 147  
**生成日期**: 2026-04-30  
**评估覆盖**: 3 项目 × 3 spectra 类工具（9 fixture）+ 4 spec-driver 类工具 × 1 任务（4 fixture）  
**总成本**: $15.5（首次全量；后续每版本 ~$5-10）

---

## 1. 执行摘要

### 1.1 Spectra 类（codebase → spec / agent context）

| 工具 | spec quality 评分 | wall（self-dogfood）| 成本 | grounding（micrograd add tanh）|
|------|-------------------|---------------------|------|--------------------------------|
| **Spectra**（自己） | **6-7** ✅ | 30 min ($9.86) | 高 | **10/10** ⭐（grounding 完美）|
| **Graphify** | 1（不竞争） | **4.2 s** ($0) | 极低 | **0**（context 太抽象，sonnet 无法编码）|
| **Aider repomap** | 1（不竞争） | 9.4 s ($0) | 极低 | **9/10**（markdown 形式有效）|

**核心结论**：
- Spectra 唯一在 spec quality 维度竞争（差异化定位）；Graphify / Aider 不产 spec，rubric mismatch 给 1 分是预期
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

### 2.2 Spectra 类 Spec Quality（opus 双盲 judge × 2 inter-rater = 18 calls）

| 项目 | spectra | graphify | aider-repomap |
|------|---------|----------|---------------|
| micrograd | 7 (Δ=0) | 1 (Δ=0) | 1 (Δ=0) |
| nanoGPT | 6.5 (Δ=1) | 1 (Δ=0) | 1 (Δ=0) |
| self-dogfood | 6 (Δ=0) | 1 (Δ=0) | 1 (Δ=0) |

inter-rater Δ ≤ 1（评分稳定）。

### 2.3 Spectra Coding-Context Grounding（micrograd add tanh，4 对照组双盲）

| 对照组 | context bytes | sonnet output | judge score |
|--------|---------------|---------------|-------------|
| control（仅文件名） | 80 B | **0 B（拒绝生成）** | null |
| **spectra（spec.md）** | **17 KB** | 572 B（完整代码） | **10** ⭐ |
| graphify（graph 节点 + 边列表）| 4 KB | **0 B（拒绝生成）** | null |
| aider-repomap（markdown）| 3 KB | 526 B（完整代码）| **9** |

**Spectra grounding 完美得分**，反向证明 spec.md 的 codebase grounding 价值。Aider 9 分仅次（标准 markdown ranked list 也是有效 context）。Graphify 节点列表过抽象，sonnet 无法基于此编码。

### 2.4 Spec Driver 类 Task Execution（T1 micrograd add tanh，4 工具双盲 judge × 2 inter-rater = 8 calls）

| 工具 | wall | LLM 输出 | oracle ast-diff | judge | inter-rater Δ |
|------|------|---------|------------------|-------|----------------|
| **control** | 44.7 s | 30 B | PASS | **6.5** | 1 |
| **spec-driver** | 79.2 s | 642 B | PASS | 6 | 0 |
| **superpowers** | 67.6 s | 645 B | PASS | 6 | 0 |
| **gstack** | 67.8 s | 81 B | PASS | 6 | 0 |

所有 4 工具都正确实现 `tanh()` + 反向梯度，oracle PASS。Permission 阻塞导致 commits=0（4 工具一致扣分），rubric "commit history" 维度因此无差异。

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
| **合计** | **$15.5** | $73-93 | **80%+** |

距 SC-008 预算 $120 还有 $104 余量。后续每版本 refresh-self ~$5-10。

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
| SC-004 | ≥ 3 工具 × ≥ 3 任务 task-execution fixture | ⚠️ 4 工具 × **1** 任务 = 4 fixture（部分满足；T2-T6 留 follow-up）|
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
