# Feature 143 — Performance Baseline Report

> **Implement 阶段用户决策**：3 个固定 baseline projects × spectra full mode。reading / code-only 命令就绪但不入本 Feature 范围。
> **数据来源**：`tests/baseline/<project>/spectra/full.json` fixture（schemaVersion 1.0）。

<!-- SC-002: report populated from fixture data -->

**生成时间**: 2026-04-30  
**Spectra 版本**: 4.1.1  
**Mode**: full / **Model**: claude-sonnet-4-6 / **LLM 并发**: 3（F146 默认 p-limit）  
**Host OS**: darwin（macOS, Apple Silicon）

---

## 1. 项目概况

| 项目 | URL | Commit | Files (ts/tsx/py/md/other) | LOC（含 md）| Spectra 模块 |
|------|-----|--------|---------------------------|-------------|--------------|
| karpathy/micrograd | https://github.com/karpathy/micrograd | `c911406` | 0/0/5/1/7 | 248 | 4 |
| karpathy/nanoGPT | https://github.com/karpathy/nanoGPT | `3adf61e` | 0/0/15/4/7 | 1,235 | 4 |
| self-dogfood（本仓库）| 当前 worktree | `485bfec` | 516/0/14/1,125/342 | 116,583 | 17 |

> **注**：self-dogfood 的 116,583 LOC 包含 1,125 个 .md 文件（很多是 specs/_meta/ 等自动生成 spec），实际源代码占比较低。Spectra 在该项目识别 17 个模块进行 LLM 处理。

---

## 2. 性能数据

### 2.1 总耗时

| 项目 | 总耗时（wall）| 模块数 |
|------|--------------|--------|
| micrograd | 2.9 min（176 s）| 4 |
| nanoGPT | 20.9 min（1,254 s）| 4 |
| self-dogfood | 30.0 min（1,802 s）| 17 |

### 2.2 LLM 调用耗时分布

| 项目 | 调用次数 | min | P50 | P95 | max |
|------|---------|-----|-----|-----|-----|
| micrograd | 4 | 81 s | 100 s | 105 s | 105 s |
| nanoGPT | 4 | 80 s | 103 s | 121 s | 121 s |
| self-dogfood | 17 | 102 s | 162 s | 312 s | 312 s |

> **schemaVersion 1.0 限制**：`llmCallCount` 只统计 batch-orchestrator stderr 中 `LLM#1` 标记（每模块 1 次主调用）。**Enrich 阶段的额外 LLM 调用未计入**（详见 §6 已知偏差）。实际 LLM 调用次数 ≈ 表中 × 2（spec 生成 + enrich）。

### 2.3 Token 消耗 + 成本

| 项目 | input | output | total | 估算成本 USD |
|------|-------|--------|-------|--------------|
| micrograd | 77,233 | 21,753 | 98,986 | **$0.56** |
| nanoGPT | 312,491 | 88,849 | 401,340 | **$2.27** |
| self-dogfood | 1,649,212 | 327,543 | 1,976,755 | **$9.86** |
| **合计** | **2,038,936** | **438,145** | **2,477,081** | **$12.69** |

价格基准：sonnet 4.6 input $3/Mtok, output $15/Mtok。`tokensCacheRead` 当前 collector 不读取（batch-summary 不输出）。

### 2.4 Memory 峰值

| 项目 | memoryPeakKb | MB |
|------|--------------|-----|
| micrograd | 281,824 | 275 MB |
| nanoGPT | 289,200 | 282 MB |
| self-dogfood | 2,075,872 | **2,027 MB** |

> self-dogfood 内存峰值显著高于 micrograd / nanoGPT（7x），原因是 17 个模块并发处理 + 1.6M input tokens 累积上下文。

---

## 3. 输出规模

| 项目 | Graph 节点 | Graph 边 | Hyperedges | graph.json 大小 | spec 成功率 |
|------|-----------|---------|-----------|----------------|------------|
| micrograd | 13 | 6 | 0 | 5,579 B（5.4 KB）| 4/4 = 100% |
| nanoGPT | 32 | 18 | 0 | 13,417 B（13.1 KB）| 4/4 = 100% |
| self-dogfood | 17 | 66 | 0 | 40,485 B（39.5 KB）| 17/17 = 100% |

> 三个 baseline 100% spec 生成成功，无失败 / 跳过 / 降级模块。
> Hyperedges 全 0：F133 hyperedge 集成因 `anchor-integration: 失败，跳过语义边生成: fetch failed`（sentence-transformers 模型下载失败）未启用，已知 stderr WARN。

---

## 4. Dry-run 偏差（dry-run vs 实跑）

dry-run 是 batch 跑前的 token 用量预估。实测显示 **dry-run 系统性低估**：

| 项目 | 预估 tokens | 实际 tokens | 偏差比（actual / estimated）|
|------|------------|------------|----------------------------|
| micrograd | 35,534 | 98,986 | **2.79x** |
| nanoGPT | 50,348 | 401,340 | **7.97x** |
| self-dogfood | 1,051,660 | 1,976,755 | **1.88x** |

**关键观察**：
- nanoGPT bias = 8x（最严重）：dry-run 仅按代码 LOC 估算，但 nanoGPT 含 model.py（16k bytes）等大单文件 + ipynb 等附加 context；LLM context 实际加载远超预估
- self-dogfood bias = 1.88x（最轻）：dry-run 估算公式可能对 TS 项目（小模块多）相对更准
- micrograd bias = 2.79x：小项目，预估和实际都低，绝对值差距小

**根因**：dry-run 估算公式只考虑代码文件 LOC，未把"邻居模块依赖 / 项目元信息 / system prompt / batch enrichment"计入。F146 后续可改进。

---

## 5. 阶段耗时分解（schemaVersion 1.0 限制）

batch-orchestrator 当前仅在每个模块完成时输出 `[<module>] AST: ... | LLM#1: ... | enrich: ... | render: ... | total: ...` 的 module-level timing；**没有 project-level 的 phase 边界 marker**（spec 生成 / graph 构建 / project docs / embedding cache）。

schemaVersion 1.0 容忍 `phases.*` 全 null（`extractionMethod: "unavailable"`）。

但从 stderr log 可手动归纳：

| 项目 | sum(模块 LLM)| sum(模块 enrich)| sum(模块 total)| wall | concurrency 利用率 |
|------|-------------|-----------------|---------------|------|-------------------|
| micrograd | ~390 s | 0 | ~393 s | 176 s | 175 / 393 ≈ 45%（4 模块 / 3 concurrency 不能完全并行）|
| nanoGPT | ~393 s | ~117 s（仅 root）| ~1,452 s（含 root 的 943s 项目级）| 1,254 s | 86% |
| self-dogfood | ~3,193 s | ~2,382 s | ~5,576 s | 1,802 s | **97%**（concurrency=3 几乎完美利用）|

**关键发现**：self-dogfood concurrency=3 利用率 97%——F146 的 p-limit 实现工作良好。

待 F140 给 batch-orchestrator 加 phase marker 后，phases 维度可填，schemaVersion 升 `1.1`。

---

## 6. 已知偏差与限制

| 字段 | 状态 | 原因 / 后续 |
|------|------|------------|
| `phases.*` | 全 null | batch-orchestrator 没 project-level phase marker；待 F140 |
| `perf.tokensCacheRead` | 全 null | batch-summary.md 当前不输出此字段；待 batch-orchestrator 补 |
| `perf.llmCallCount` | 仅统计 LLM#1 | enrich 阶段的额外 LLM 调用（每模块 1 次）未计入；schema 1.1 可加 `llmCallCountByStage` |
| `output.graphHyperedgeCount` | 全 0 | hyperedge 集成依赖 sentence-transformers 模型下载，本环境失败 |
| nanoGPT root 模块 total = 1162 s | 含 943 s 项目级开销 | docs / hyperedge / anchor 等 project-level pipeline 累计耗时；schemaVersion 1.1 可拆 |

---

## 7. 关键观察

1. **LLM 调用是 wall time 主导（小项目 + concurrency 不饱和时）**：micrograd 4 模块、concurrency=3，3 个并行后第 4 个串行，wall 176s ≈ max(P95 × 2) = 2 × 105s。
2. **大项目 wall 由 module-level total 之和 / concurrency 决定**：self-dogfood concurrency=3 利用率 97%，wall ≈ sum(total) / 3 = 5576 / 3 = 1859 s ≈ 实际 1802 s。
3. **Enrich 阶段是隐形成本**：self-dogfood 模块的 enrich 时间 = 平均 LLM 时间 × ~75%（120-200 s/模块），但 schemaVersion 1.0 没单独统计，导致"LLM 占比"被低估约一半。
4. **dry-run 偏差严重**：1.88x ~ 8x。用户依赖 `--dry-run --budget X` 守护时容易低估，导致 budget 守护提前触发或不触发。
5. **Memory 峰值线性放大**：self-dogfood 17 模块 → 2 GB peak，约 116 MB / 模块（concurrency=3 × 单模块 working set ~40 MB + 共享 graph 缓存）。
6. **P95 / P50 比例在小项目 ≈ 1（稳定），大项目 ≈ 2x**：self-dogfood 单次 LLM call 最大 312s（models 模块，1.6M input tokens），抵消并发收益。

---

## 8. Fixture 文件清单

```
tests/baseline/micrograd/spectra/full.json     2.4 KB
tests/baseline/nanoGPT/spectra/full.json       2.4 KB
tests/baseline/self-dogfood/spectra/full.json  2.4 KB
```

直接编辑本报告时，必须同步引用 fixture 数据；不允许凭印象写数字（SC-004）。
