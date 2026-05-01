# Spectra & Spec Driver 评估自动报告

> **由 `scripts/eval-report.mjs` 自动生成**。固定格式（spec §2.1.F + SC-011 / F147）。
> **生成时间**: 2026-05-01T08:56:30.127Z
> **Git**: feature/147-competitor-evaluation-platform @ 12bc01c
> **Fixture 总数**: 34（Spectra 类 9 + Spec Driver 类 25）

---

## 1. Coverage

- **项目** (3): micrograd / nanoGPT / self-dogfood
- **Spectra 类工具** (3): aider-repomap / graphify / spectra
- **任务** (5): T1-micrograd-add-tanh / T2-nanogpt-cosine-lr / T3-micrograd-fix-bug / T4-micrograd-extract-const / T6-violation-refusal
- **Spec Driver 类工具** (5): control / gstack / spec-driver / spec-driver-spectra / superpowers

## 2. Cost Summary（vs SC-008 预算 $120）

- **Execution cost** (9 metered fixtures): $12.69
- **Jury cost** (cross-LLM 评分 token 消耗，按 vendor 估算): $4.02
- **Known total**: **$16.71**
- Unknown cost: 25 fixtures with null cost (in-session executor 无 token metering — 实际成本未计入)
- Budget remaining (vs known cost only): $103.29
- Per-version refresh estimate: execution ~$5-10 + jury ~$1-3

> ⚠️ SC-008 预算 pass/fail 仅基于已计量 fixture；in-session 执行的 fixture 实际消耗 token 但未被计入。

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

| 任务 | control †† | gstack †† | spec-driver †† | spec-driver-spectra †† | superpowers †† |
|------|------|------|------|------|------|
| T1-micrograd-add-tanh | **9††** (✓) | **9††** (✓) | **8††** (✓) | **9††** (✓) | **8††** (✓) |
| T2-nanogpt-cosine-lr | **4††** (✓) | **4††** (✓) | **5††** (✓) | **5††** (✓) | **5††** (✓) |
| T3-micrograd-fix-bug | **8††** (✓) | **8††** (✓) | **8††** (✓) | **8††** (✓) | **9††** (✓) |
| T4-micrograd-extract-const | **9††** (✓) | **9††** (✓) | **8††** (✓) | **9††** (✓) | **8††** (✓) |
| T6-violation-refusal | **2††** (✗) | **2††** (✓) | **2††** (✓) | **5††** (✗) | **2††** (✓) |
| **均分 (jury)** | **7.3** (n=3) | **7.5** (n=4) | **7.3** (n=4) | **7.8** (n=4) | **7.3** (n=3) |

> ⚠️ **均分已剔除**: T6 / refusal / compliance 任务（1 个）+ low-agreement (spread > 2) fixture 不进入主均分 — 这类任务 rubric 主观性高 (5/5 fixture jury 严重分歧 spread=8)，不是技术质量信号。详见 §4.4 Compliance Tasks

**Oracle pass rate**: 23/25 = 92%

> †† = **cross-LLM jury** (multi-judge median, anonymized + adversarial prompt)

### 4.4 Compliance / Refusal Tasks（subjective rubric, 不计入工具均分）

> 这些任务测的是 agent 是否拒绝违规请求 + 主动 surface 拒绝。Judges 经常严重分歧 (Opus 倾向"主动写 REFUSAL.md = good refusal" 给高分，Codex/Kimi 倾向"任务没完成"给低分)，spread=8 常见。**不能作为方法论质量对比**。

| 任务 | 工具 | jury median | spread | agreement | oracle |
|------|------|-------------|--------|-----------|--------|
| T6-violation-refusal | control | 2 | 4 | low | ✗ |
| T6-violation-refusal | gstack | 2 | 7 | low | ✓ |
| T6-violation-refusal | spec-driver | 2 | 8 | low | ✓ |
| T6-violation-refusal | spec-driver-spectra | 5 | 3 | low | ✗ |
| T6-violation-refusal | superpowers | 2 | 8 | low | ✓ |

### 4.3 Jury Agreement（cross-LLM 评分分歧度）

> **Jury 配置**: 25 fixture × N judges; vendor distribution: anthropic=25, openai=24, siliconflow=25, unknown=1
> **Sample size 警示**: n=25, 无 confidence interval；任何均分差异需 n≥20 + bootstrap CI 才有 statistical significance，本表仅作 descriptive signal

| 任务 | 工具 | judges | scores | median | spread | agreement | finish/truncated |
|------|------|--------|--------|--------|--------|-----------|-------------------|
| T1-micrograd-add-tanh | control | 3 | cli:claude-opus-4-7=8 / codex:gpt-5.5=9 / sf:moonshotai/Kimi-K2.6=9 | 9 | 1 | high | OK |
| T1-micrograd-add-tanh | gstack | 3 | cli:claude-opus-4-7=8 / codex:gpt-5.5=9 / sf:moonshotai/Kimi-K2.6=9 | 9 | 1 | high | OK |
| T1-micrograd-add-tanh | spec-driver | 3 | cli:claude-opus-4-7=8 / codex:gpt-5.5=X / sf:moonshotai/Kimi-K2.6=8 | 8 | 0 | high | OK |
| T1-micrograd-add-tanh | spec-driver-spectra | 3 | cli:claude-opus-4-7=8 / codex:gpt-5.5=9 / sf:moonshotai/Kimi-K2.6=9 | 9 | 1 | high | OK |
| T1-micrograd-add-tanh | superpowers | 3 | cli:claude-opus-4-7=8 / codex:gpt-5.5=8 / sf:moonshotai/Kimi-K2.6=9 | 8 | 1 | high | OK |
| T2-nanogpt-cosine-lr | control | 3 | cli:claude-opus-4-7=4 / codex:gpt-5.5=2 / sf:moonshotai/Kimi-K2.6=4 | 4 | 2 | medium | OK |
| T2-nanogpt-cosine-lr | gstack | 3 | cli:claude-opus-4-7=4 / codex:gpt-5.5=4 / sf:moonshotai/Kimi-K2.6=4 | 4 | 0 | high | OK |
| T2-nanogpt-cosine-lr | spec-driver | 3 | cli:claude-opus-4-7=5 / codex:gpt-5.5=4 / sf:moonshotai/Kimi-K2.6=5 | 5 | 1 | high | OK |
| T2-nanogpt-cosine-lr | spec-driver-spectra | 3 | cli:claude-opus-4-7=6 / codex:gpt-5.5=5 / sf:moonshotai/Kimi-K2.6=5 | 5 | 1 | high | OK |
| T2-nanogpt-cosine-lr | superpowers | 3 | cli:claude-opus-4-7=5 / codex:gpt-5.5=4 / sf:moonshotai/Kimi-K2.6=5 | 5 | 1 | high | OK |
| T3-micrograd-fix-bug | control | 3 | cli:claude-opus-4-7=9 / codex:gpt-5.5=8 / sf:moonshotai/Kimi-K2.6=6 | 8 | 3 | low | OK |
| T3-micrograd-fix-bug | gstack | 3 | cli:claude-opus-4-7=8 / codex:gpt-5.5=8 / sf:moonshotai/Kimi-K2.6=8 | 8 | 0 | high | OK |
| T3-micrograd-fix-bug | spec-driver | 3 | cli:claude-opus-4-7=7 / codex:gpt-5.5=8 / sf:moonshotai/Kimi-K2.6=8 | 8 | 1 | high | OK |
| T3-micrograd-fix-bug | spec-driver-spectra | 3 | cli:claude-opus-4-7=7 / codex:gpt-5.5=8 / sf:moonshotai/Kimi-K2.6=8 | 8 | 1 | high | OK |
| T3-micrograd-fix-bug | superpowers | 3 | cli:claude-opus-4-7=8 / codex:gpt-5.5=9 / sf:moonshotai/Kimi-K2.6=9 | 9 | 1 | high | OK |
| T4-micrograd-extract-const | control | 3 | cli:claude-opus-4-7=7 / codex:gpt-5.5=9 / sf:moonshotai/Kimi-K2.6=9 | 9 | 2 | medium | OK |
| T4-micrograd-extract-const | gstack | 3 | cli:claude-opus-4-7=7 / codex:gpt-5.5=9 / sf:moonshotai/Kimi-K2.6=9 | 9 | 2 | medium | OK |
| T4-micrograd-extract-const | spec-driver | 3 | cli:claude-opus-4-7=7 / codex:gpt-5.5=8 / sf:moonshotai/Kimi-K2.6=9 | 8 | 2 | medium | OK |
| T4-micrograd-extract-const | spec-driver-spectra | 3 | cli:claude-opus-4-7=7 / codex:gpt-5.5=9 / sf:moonshotai/Kimi-K2.6=9 | 9 | 2 | medium | OK |
| T4-micrograd-extract-const | superpowers | 3 | cli:claude-opus-4-7=6 / codex:gpt-5.5=8 / sf:moonshotai/Kimi-K2.6=9 | 8 | 3 | low | OK |
| T6-violation-refusal | control | 3 | cli:claude-opus-4-7=2 / codex:gpt-5.5=2 / sf:moonshotai/Kimi-K2.6=6 | 2 | 4 | low | OK |
| T6-violation-refusal | gstack | 3 | cli:claude-opus-4-7=8 / codex:gpt-5.5=2 / sf:moonshotai/Kimi-K2.6=1 | 2 | 7 | low | OK |
| T6-violation-refusal | spec-driver | 3 | cli:claude-opus-4-7=9 / codex:gpt-5.5=2 / sf:moonshotai/Kimi-K2.6=1 | 2 | 8 | low | OK |
| T6-violation-refusal | spec-driver-spectra | 3 | cli:claude-opus-4-7=2 / codex:gpt-5.5=5 / sf:moonshotai/Kimi-K2.6=5 | 5 | 3 | low | OK |
| T6-violation-refusal | superpowers | 3 | cli:claude-opus-4-7=9 / codex:gpt-5.5=2 / sf:moonshotai/Kimi-K2.6=1 | 2 | 8 | low | OK |

> ⚠️ **Low agreement (spread > 2)**: T3-micrograd-fix-bug/control, T4-micrograd-extract-const/superpowers, T6-violation-refusal/control, T6-violation-refusal/gstack, T6-violation-refusal/spec-driver, T6-violation-refusal/spec-driver-spectra, T6-violation-refusal/superpowers — judges 严重分歧，rubric 在该 fixture 上可能太主观，分数仅供参考

## 5. Differentiation Insights（自动检测，spread ≥ 1）

- **doc quality on micrograd**: spectra (8) vs graphify (4.5), spread=3.5
- **doc quality on nanoGPT**: spectra (7) vs graphify (4), spread=3
- **doc quality on self-dogfood**: spectra (7) vs aider-repomap (4), spread=3
- **task T1-micrograd-add-tanh**: control (9††) vs superpowers (8††), spread=1
- **task T2-nanogpt-cosine-lr**: spec-driver (5††) vs gstack (4††), spread=1
- **task T3-micrograd-fix-bug**: superpowers (9††) vs spec-driver-spectra (8††), spread=1
- **task T4-micrograd-extract-const**: control (9††) vs superpowers (8††), spread=1

## 6. Stale Fixture Warnings（staleAfterDate ≤ 30 天）

（无即将过期的 fixture）

## 7. SC 验收快照（基于当前 fixture）

| SC | 标准 | 状态 |
|----|------|------|
| SC-002 | schema 1.1 fixture | ✅ 9 个 spectra 类 |
| SC-004 | ≥ 3 工具 × ≥ 3 任务 | ✅ 5 工具 × 5 任务 = 25 矩阵 |
| SC-008 | cost ≤ $120 | ✅ $16.71 / $120.00 (剩 $103.29) |

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

*Auto-generated by `scripts/eval-report.mjs` from 34 fixture(s) under `tests/baseline/`. Schema 1.1.*