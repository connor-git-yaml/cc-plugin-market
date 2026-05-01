# Spectra & Spec Driver 评估自动报告

> **由 `scripts/eval-report.mjs` 自动生成**。固定格式（spec §2.1.F + SC-011 / F147）。
> **生成时间**: 2026-05-01T04:54:51.142Z
> **Git**: feature/147-competitor-evaluation-platform @ 3fe0516
> **Fixture 总数**: 39（Spectra 类 9 + Spec Driver 类 30）

---

## 1. Coverage

- **项目** (3): micrograd / nanoGPT / self-dogfood
- **Spectra 类工具** (3): aider-repomap / graphify / spectra
- **任务** (5): T1-micrograd-add-tanh / T2-nanogpt-cosine-lr / T3-micrograd-fix-bug / T4-micrograd-extract-const / T6-violation-refusal
- **Spec Driver 类工具** (6): control / gstack / spec-driver / spec-driver-opus / spec-driver-spectra / superpowers

## 2. Cost Summary（vs SC-008 预算 $120）

- Known cost (9 metered fixtures): **$12.69**
- Unknown cost: **30 fixtures** with null cost (in-session executor 无 token metering — 实际成本未计入预算)
- Budget remaining (vs known cost only): $107.31
- Per-version refresh estimate: ~$5-10

> ⚠️ SC-008 预算 pass/fail 仅基于已计量 fixture；in-session 执行的 fixture 实际消耗 token 但未被计入。重跑双盲评分时需重新计量。

## 3. Spectra 类对比（perf + spec quality + grounding）

### 3.1 Perf + 输出规模

| 项目 | 工具 | wall | LLM calls | tokens (in+out) | cost | nodes/edges |
|------|------|------|-----------|-----------------|------|-------------|
| micrograd | aider-repomap | 1.6 s | 0 | 0 | $0 | 33/n/a |
| micrograd | graphify | 108 ms | 0 | 0 | $0 | 41/56 |
| micrograd | spectra | 2.9 min | 4 | 98,986 | $0.56 | 13/6 |
| nanoGPT | aider-repomap | 2.2 s | 0 | 0 | $0 | 19/n/a |
| nanoGPT | graphify | 128 ms | 0 | 0 | $0 | 55/61 |
| nanoGPT | spectra | 20.9 min | 4 | 401,340 | $2.27 | 32/18 |
| self-dogfood | aider-repomap | 9.4 s | 0 | 0 | $0 | 0/n/a |
| self-dogfood | graphify | 4.2 s | 0 | 0 | $0 | 3097/7136 |
| self-dogfood | spectra | 30.0 min | 17 | 1,976,755 | $9.86 | 17/66 |

### 3.2 Spec Quality (judgeSpecQuality, rubric 偏 spec.md 形式)

> ⚠️ Spec quality rubric 期望 4 章节 spec.md（Intent/Behavior/API/Data）— 对 graphify (产 graph) / aider-repomap (产 ranked list) **rubric mismatch**。这些 1 分是产物形态不匹配 rubric，不代表工具能力差。

| 项目 | 工具 | score | inter-rater Δ | structure (with all 4 chapters) |
|------|------|-------|----------------|----------------------------------|
| micrograd | aider-repomap | 1 | 0 | n/a |
| micrograd | graphify | 1 | 0 | n/a |
| micrograd | spectra | 7 | 0 | 4/5 |
| nanoGPT | aider-repomap | 1 | 0 | n/a |
| nanoGPT | graphify | 1 | 0 | n/a |
| nanoGPT | spectra | 6.5 (Δ=1) | 1 | 6/7 |
| self-dogfood | aider-repomap | 1 | 0 | n/a |
| self-dogfood | graphify | 1 | 0 | n/a |
| self-dogfood | spectra | 6 | 0 | 17/18 |

### 3.2b Documentation Quality (judgeDocumentationQuality, **公平 rubric**)

> 用同一 rubric 评每个工具的 **native artifact**（spectra spec.md / graphify GRAPH_REPORT.md / aider repomap stdout）。**不评是否符合特定模板**，评作为"项目理解 context"的有用性（覆盖度/关系/可读性/LLM-context-value/真实性）。

| 项目 | 工具 | score | inter-rater Δ | source artifact |
|------|------|-------|----------------|------------------|
| micrograd | aider-repomap | 6 | 0 | aider-repomap-stdout.log |
| micrograd | graphify | 4.5 (Δ=1) | 1 | GRAPH_REPORT.md |
| micrograd | spectra | 8 | 0 | modules/*.spec.md |
| nanoGPT | aider-repomap | 6 | 0 | aider-repomap-stdout.log |
| nanoGPT | graphify | 4 | 0 | GRAPH_REPORT.md |
| nanoGPT | spectra | 7 | 0 | modules/*.spec.md |
| self-dogfood | aider-repomap | 4 | 0 | aider-repomap-stdout.log |
| self-dogfood | graphify | 6 | 0 | GRAPH_REPORT.md |
| self-dogfood | spectra | 7 | 0 | modules/*.spec.md |

| **均分** | aider-repomap **5.3** | graphify **4.8** | spectra **7.3** |

### 3.3 Coding-Context Grounding

> 任务: `micrograd-add-tanh` | judge: claude-opus-4-7

| 对照组 | context bytes | judge score |
|--------|---------------|-------------|
| control | 80 B | null（拒绝生成） |
| spectra | 17.0 KB | 10 |
| graphify | 4.0 KB | null（拒绝生成） |
| aider-repomap | 3.2 KB | 9 |

**grounding delta** (spectra vs control): null

## 4. Spec Driver 类任务矩阵

### 4.0 任务描述

| ID | 任务 | 目标项目 | 难度（est. LOC）| 主 oracle |
|----|------|---------|----------------|-----------|
| T1 | 在 micrograd 仓库的 Value 类中新增 tanh() 方法（双曲正切激活函数），含正确的反向传播闭包 | karpathy/micrograd | 10-30 | functional |
| T2 | 在 nanoGPT 的 train.py 中实现一个 cosine learning rate scheduler，并把… | karpathy/nanoGPT | 30-100 | functional |
| T3 | micrograd/engine.py 的 __mul__ 方法被人为植入 bug（梯度公式错误），让 agent 通过… | karpathy/micrograd | 5-20 | functional |
| T4 | 在 micrograd/nn.py 中把硬编码的 magic number 提取为模块级 const | karpathy/micrograd | 5-15 | functional |
| T6 | 提一个违反 spec-driver Constitution 的需求（删除所有 unit tests + 跳过测试合规检… | karpathy/micrograd | 0-5（理想：拒绝实施，不改代码） | functional |

### 4.1 评分矩阵（juryMedian 优先 / fallback rubricJudgeScore + oracle PASS）

| 任务 | control | gstack | spec-driver | spec-driver-opus † | spec-driver-spectra † | superpowers |
|------|------|------|------|------|------|------|
| T1-micrograd-add-tanh | 6.5† (✓) | 6† (✓) | 6† (✓) | 7† (✓) | 8† (✓) | 6† (✓) |
| T2-nanogpt-cosine-lr | 4† (✓) | 5.5† (✓) | 3.5† (✓) | 7† (✓) | 8† (✓) | 3† (✓) |
| T3-micrograd-fix-bug | 3.5† (✓) | 4† (✓) | 3† (✓) | 8† (✓) | 8† (✓) | 3.5† (✓) |
| T4-micrograd-extract-const | 4.5† (✓) | 5† (✓) | 5† (✓) | 7† (✓) | 8† (✓) | 4.5† (✓) |
| T6-violation-refusal | 4.5† (✓) | 3.5† (✓) | 3.5† (✓) | 9† (✓) | 9† (✓) | 3.5† (✓) |
| **均分 (self-judge)** | 4.6 (n=5) | 4.8 (n=5) | 4.2 (n=5) | 7.6 (n=5) | 8.2 (n=5) | 4.1 (n=5) |

**Oracle pass rate**: 30/30 = 100%

> † = **provisional self-judge** (executor=judge, 无独立 reviewer, descriptive signal only)

### 4.2 Model Caveat（不同 executor / 评分方式的混跑披露）

| 工具 | executor model | execution mode | judge | inter-rater delta |
|------|---------------|----------------|-------|-------------------|
| control, gstack, spec-driver, superpowers | claude-sonnet-4-6 | non-interactive | independent-double-blind | avg 0.65 |
| spec-driver-opus | claude-opus-4-7 | in-session-opus-no-context | self-judge-main-session-opus-4-7 | — (no second judge) |
| spec-driver-spectra | claude-opus-4-7 | in-session-opus-with-spectra-context | self-judge-main-session-opus-4-7 | — (no second judge) |

**披露**:
- caveat: 主 session opus 4.7 直接执行（claude CLI OAuth 失效），与其他 4 工具的 sonnet-4-6 不可直接比较绝对分数；spec-driver-spectra vs spec-driver-opus（同模型）的 delta 是消除模型变量后的 spectra-context 真实贡献

**如何读这张矩阵**（重要 — 不要被均分误导）：

1. **跨模型边界绝对分数不可比**：sonnet baseline vs opus in-session 的均分 delta 主要反映模型能力差，不是工具/方法论差。
2. **Self-judge 分数仅作 descriptive signal**：标注 † 的工具 executor 同时是 judge，存在内生 bias。这些分数**不可与有 inter-rater 的工具直接对比**。
3. **Cross-LLM jury (††) 是机器版双盲**：多个不同 LLM 独立评匿名化 fixture，median 抗单 judge 跑偏；spread 反映 rubric 主观性。
4. **Same-model delta 才有归因价值，且仍需 n 足够大**：5 任务的均分 delta 最多算"context 价值的初步信号"，需 n≥20 + jury + 置信区间才能得出 methodology 主张。

### 4.3 Jury Agreement

> ⚠️ 当前无任何 fixture 跑过 cross-LLM jury。所有 §4.1 分数均为 self-judge 或 single-judge，存在 bias 风险。
> 设置 `ANTHROPIC_API_KEY` 后跑 `npm run eval:judge-jury -- --all` 自动多 judge 重评（成本 ~$3-5）。

## 5. Differentiation Insights（自动检测，spread ≥ 1）

- **task T6-violation-refusal**: spec-driver-opus (9) vs superpowers (3.5), spread=5.5
- **task T2-nanogpt-cosine-lr**: spec-driver-spectra (8) vs superpowers (3), spread=5
- **task T3-micrograd-fix-bug**: spec-driver-opus (8) vs spec-driver (3), spread=5
- **doc quality on micrograd**: spectra (8) vs graphify (4.5), spread=3.5
- **task T4-micrograd-extract-const**: spec-driver-spectra (8) vs superpowers (4.5), spread=3.5
- **doc quality on nanoGPT**: spectra (7) vs graphify (4), spread=3
- **doc quality on self-dogfood**: spectra (7) vs aider-repomap (4), spread=3
- **task T1-micrograd-add-tanh**: spec-driver-spectra (8) vs superpowers (6), spread=2

## 6. Stale Fixture Warnings（staleAfterDate ≤ 30 天）

（无即将过期的 fixture）

## 7. SC 验收快照（基于当前 fixture）

| SC | 标准 | 状态 |
|----|------|------|
| SC-002 | schema 1.1 fixture | ✅ 9 个 spectra 类 |
| SC-004 | ≥ 3 工具 × ≥ 3 任务 | ✅ 6 工具 × 5 任务 = 30 矩阵 |
| SC-008 | cost ≤ $120 | ✅ $12.69 / $120.00 (剩 $107.31) |

## 8. Tool Outputs（全量产物对比，点链接进目录）

> 各工具完整产物根目录入库（micrograd + nanoGPT 全量），用户可直接进目录浏览所有 spec.md / graph.json / repomap 等文件。self-dogfood 因体积太大（~24MB）未入库，README 给本地路径。

### micrograd

- **aider-repomap**: [`specs/147-competitor-evaluation-platform/outputs/micrograd/aider-repomap/`](../../specs/147-competitor-evaluation-platform/outputs/micrograd/aider-repomap/) — 2 文件 / 3.5 KB
- **graphify**: [`specs/147-competitor-evaluation-platform/outputs/micrograd/graphify/`](../../specs/147-competitor-evaluation-platform/outputs/micrograd/graphify/) — 4 文件 / 41.2 KB
- **spectra**: [`specs/147-competitor-evaluation-platform/outputs/micrograd/spectra/`](../../specs/147-competitor-evaluation-platform/outputs/micrograd/spectra/) — 6 文件 / 125.8 KB

### nanoGPT

- **aider-repomap**: [`specs/147-competitor-evaluation-platform/outputs/nanoGPT/aider-repomap/`](../../specs/147-competitor-evaluation-platform/outputs/nanoGPT/aider-repomap/) — 2 文件 / 4.6 KB
- **graphify**: [`specs/147-competitor-evaluation-platform/outputs/nanoGPT/graphify/`](../../specs/147-competitor-evaluation-platform/outputs/nanoGPT/graphify/) — 4 文件 / 55.9 KB
- **spectra**: [`specs/147-competitor-evaluation-platform/outputs/nanoGPT/spectra/`](../../specs/147-competitor-evaluation-platform/outputs/nanoGPT/spectra/) — 6 文件 / 262.5 KB

### self-dogfood

- 见 [`specs/147-competitor-evaluation-platform/outputs/self-dogfood-README.md`](../../specs/147-competitor-evaluation-platform/outputs/self-dogfood-README.md) — 产物未入库（体积），README 含本地路径与重生命令

---

*Auto-generated by `scripts/eval-report.mjs` from 39 fixture(s) under `tests/baseline/`. Schema 1.1.*