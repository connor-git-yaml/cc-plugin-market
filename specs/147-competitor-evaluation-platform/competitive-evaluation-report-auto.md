# Spectra & Spec Driver 评估自动报告

> **由 `scripts/eval-report.mjs` 自动生成**。固定格式（spec §2.1.F + SC-011 / F147）。
> **生成时间**: 2026-04-30T18:04:45.820Z
> **Git**: feature/147-competitor-evaluation-platform @ 9d3a1d5
> **Fixture 总数**: 29（Spectra 类 9 + Spec Driver 类 20）

---

## 1. Coverage

- **项目** (3): micrograd / nanoGPT / self-dogfood
- **Spectra 类工具** (3): aider-repomap / graphify / spectra
- **任务** (5): T1-micrograd-add-tanh / T2-nanogpt-cosine-lr / T3-micrograd-fix-bug / T4-micrograd-extract-const / T6-violation-refusal
- **Spec Driver 类工具** (4): control / gstack / spec-driver / superpowers

## 2. Cost Summary（vs SC-008 预算 $120）

- Cumulative cost (fixture-level): **$12.69**
- Budget remaining: $107.31
- Per-version refresh estimate: ~$5-10

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

| 任务 | control | gstack | spec-driver | superpowers |
|------|------|------|------|------|
| T1-micrograd-add-tanh | 6.5 (✓) | 6 (✓) | 6 (✓) | 6 (✓) |
| T2-nanogpt-cosine-lr | 4 (✓) | 5.5 (✓) | 3.5 (✓) | 3 (✓) |
| T3-micrograd-fix-bug | 3.5 (✓) | 4 (✓) | 3 (✓) | 3.5 (✓) |
| T4-micrograd-extract-const | 4.5 (✓) | 5 (✓) | 5 (✓) | 4.5 (✓) |
| T6-violation-refusal | 4.5 (✓) | 3.5 (✓) | 3.5 (✓) | 3.5 (✓) |
| **均分** | **4.6** | **4.8** | **4.2** | **4.1** |

**Oracle pass rate**: 20/20 = 100%

## 5. Differentiation Insights（自动检测，spread ≥ 1）

- **doc quality on micrograd**: spectra (8) vs graphify (4.5), spread=3.5
- **doc quality on nanoGPT**: spectra (7) vs graphify (4), spread=3
- **doc quality on self-dogfood**: spectra (7) vs aider-repomap (4), spread=3
- **task T2-nanogpt-cosine-lr**: gstack (5.5) vs superpowers (3), spread=2.5
- **task T3-micrograd-fix-bug**: gstack (4) vs spec-driver (3), spread=1
- **task T6-violation-refusal**: control (4.5) vs superpowers (3.5), spread=1

## 6. Stale Fixture Warnings（staleAfterDate ≤ 30 天）

（无即将过期的 fixture）

## 7. SC 验收快照（基于当前 fixture）

| SC | 标准 | 状态 |
|----|------|------|
| SC-002 | schema 1.1 fixture | ✅ 9 个 spectra 类 |
| SC-004 | ≥ 3 工具 × ≥ 3 任务 | ✅ 4 工具 × 5 任务 = 20 矩阵 |
| SC-008 | cost ≤ $120 | ✅ $12.69 / $120.00 (剩 $107.31) |

## 8. Sample Outputs（点链接看真实产物）

> 入库的代表性产物，用于直观对比不同工具产物形态 + 用户/reviewer 自验证 judge 评分合理性。完整产物路径在 `~/.spectra-baselines/<project>-output/<tool>-full/`（本地，gitignored）。

### micrograd

- **aider-repomap**: [repomap.md](../../specs/147-competitor-evaluation-platform/sample-outputs/micrograd/aider-repomap/repomap.md) (3.5 KB)
- **graphify**: [GRAPH_REPORT.md](../../specs/147-competitor-evaluation-platform/sample-outputs/micrograd/graphify/GRAPH_REPORT.md) (4.6 KB)
- **spectra**: [engine.spec.md](../../specs/147-competitor-evaluation-platform/sample-outputs/micrograd/spectra/engine.spec.md) (17.6 KB) / [nn.spec.md](../../specs/147-competitor-evaluation-platform/sample-outputs/micrograd/spectra/nn.spec.md) (20.0 KB)

---

*Auto-generated by `scripts/eval-report.mjs` from 29 fixture(s) under `tests/baseline/`. Schema 1.1.*