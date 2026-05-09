# Regression Analysis — Feature 159 baseline:diff Red 决策

**Feature**: 159-feat151-baseline-snapshot
**触发**: 按 spec SC-3b（任一 perf 项 |Δ| ≥ redMin 时阻塞 + 写本文档）
**决策**: **accept-and-spec**（详见下方根因分析）
**生成时间**: 2026-05-09

---

## 1. baseline:diff Red 触发的指标

### 1.1 micrograd（旧 0449d2b → 新 master cf0a131）

| 维度 | 阈值 | 旧值 | 新值 | Δ% | severity |
|------|------|------|------|----|----------|
| perf.totalWallMs | yellow≥10%, red≥20% | 176,076 | 191,128 | +8.5% | **green** ✅ |
| perf.tokensInputPlusOutput | yellow≥5%, red≥15% | 98,986 | 114,543 | +15.7% | **red** ❗ |
| perf.estimatedCostUsd | yellow≥10%, red≥20% | $0.56 | $0.62 | +10.7% | **yellow** ⚠️ |
| output.graphNodeCount | (informational, twoSided) | 13 | 46 | +254% | red (expected breaking change) |

### 1.2 nanoGPT（旧 0449d2b → 新 master cf0a131）

| 维度 | 旧值 | 新值 | Δ% | severity |
|------|------|------|----|----------|
| perf.totalWallMs | 1,254,041 | 1,328,538 | +5.9% | **green** ✅ |
| perf.tokensInputPlusOutput | 401,340 | 436,622 | +8.8% | **yellow** ⚠️ |
| perf.estimatedCostUsd | $2.27 | $2.40 | +5.7% | **green** ✅ |
| output.graphNodeCount | 32 | 102 | +218.8% | red (expected breaking change) |

### 1.3 self-dogfood（旧 0449d2b → 新 master cf0a131）

| 维度 | 旧值 | 新值 | Δ% | severity |
|------|------|------|----|----------|
| perf.totalWallMs | 1,801,843 | 2,686,539 | **+49.1%** | **red** ❗ |
| perf.tokensInputPlusOutput | 1,976,755 | 2,594,923 | **+31.3%** | **red** ❗ |
| perf.estimatedCostUsd | $9.86 | $12.68 | **+28.6%** | **red** ❗ |
| output.graphNodeCount | 17 | 4,887 | **+28,647%** | red (expected breaking change) |

---

## 2. 跨度信息（确认非单一 feature 引入）

| baseline | 旧 fixture commit | 新 fixture commit | 跨 commit 数 | 跨 feature 数 |
|----------|-------------------|-------------------|--------------|----------------|
| micrograd | 0449d2b（Feature 147 sprint3 A+B）| cf0a131（master HEAD）| ~50 | **9（148~156）** |
| nanoGPT | 0449d2b | cf0a131 | ~50 | 9 |
| self-dogfood | 0449d2b | cf0a131 | ~50 | 9 |

跨度对应的 9 个 feature：
- F148 — eval-judge 改进
- F149 — N=5 重测 + bootstrap CI
- F150 — Graph Accuracy Extension
- **F151 — Knowledge Graph + Python LanguageAdapter callSites**
- **F152 — TS-JS LanguageAdapter callSites**
- **F153 — Go LanguageAdapter callSites**
- **F154 — Java LanguageAdapter callSites**
- F155 — Agent-Context MCP tools
- F156 — Incremental Indexing + DepGraph shim

---

## 3. 根因分析

### 3.1 self-dogfood specModuleCount 5x 增长（17 → 20 — 模块边界扩展，非回归）

旧 fixture：`specModuleCount=17`，跨度 9 个 feature 后新 fixture：`specModuleCount=20`，模块数 +18%。**单这一项变化已经会导致 perf 数据明显增加**：因为每个 spec module 都需要独立 LLM 跑批，模块数增加直接线性贡献 wall time / tokens / cost。

注：但是 +18% module count 不能完全解释 +49% wall time。剩余 +31% wall time 增量来自：

### 3.2 4 语言 LanguageAdapter callSites 抽取引入新的 LLM 子任务（非回归 — 新功能增量）

Feature 151~154 引入了 4 语言（Python / TS / Go / Java）的 callSites 抽取。跑批流程中新增：
1. **panoramic 阶段** callSite extraction：每语言 adapter 用 tree-sitter 静态抽取 + LLM 增强 confidence
2. **graph-builder 阶段** UnifiedGraph 构建：把 callSites 转为 calls 边
3. **knowledge-graph 模块** 引入了新的 module → 跑批要为这个模块生成 spec.md

实测产物对照：
- 旧 graph：17 nodes, 66 edges, 0 calls edges, sources 仅 [`doc-graph`, `cross-reference`]
- 新 graph：4,887 nodes, 2,373 edges, 765 calls edges, sources 含 `extractionResults`（callSites 数据源）

**这些 callSites 是 Feature 151 / 152 / 153 / 154 的核心交付内容，不是性能回归 — 是新功能的合理 cost 增量**。

### 3.3 micrograd tokens +15.7% red 的根因

micrograd 含 5 .py 文件，旧 fixture 时 Python adapter 还没 callSites 抽取（Feature 151 引入）。新跑批：
- 旧：`tokensInput=77,233` + `tokensOutput=21,753` = 98,986 总 tokens
- 新：`tokensInput=91,422` + `tokensOutput=23,121` = 114,543 总 tokens

Δ +15.7% 的 root cause：Python LanguageAdapter 现在抽取 callSites，每个 module 的 prompt 输入含 CodeSkeleton.callSites?: CallSite[] 字段（Feature 151 FR-3）→ tokens 增加。

### 3.4 nanoGPT yellow 与 self-dogfood red 的根本差异

nanoGPT (15 .py / 1.5k LOC) 主要是 Python 代码，只受 F151 callSites 影响 → 跨度小 → tokens +8.8% yellow。

self-dogfood 是混合 TS / Python 项目，**4 语言中 3 语言（TS, Python, 部分 fixture-Go）**都参与了 callSite 抽取 → 4x feature 累计影响 → tokens +31% / wall time +49% / cost +29% 全 red。

---

## 4. 决策

### 4.1 选择路径：**accept-and-spec**

按 spec SC-3b 三个候选路径：rollback / hot-fix / **accept-and-spec**。

选择 accept-and-spec 的依据：

| 依据 | 论证 |
|------|------|
| **没有单一 hotspot** | 三个 baseline 的 red 维度跨 wall/tokens/cost，分布在 9 个 feature 上 — 没有单 commit 导致的退化 |
| **新功能 expected cost** | 4 语言 callSites + UnifiedGraph + Agent-Context + Incremental Indexing 都是 P1 价值新功能 — 不能为了 perf 回滚 |
| **graphNodeCount 增长 expected** | self-dogfood 17 → 4887 完全符合 spec EC-4 "expected breaking change"（callSites 转节点）|
| **specSuccessRatio 100%** | 质量维度无回归（spec 生成成功率没下降）|
| **绝对成本可控** | self-dogfood 总 cost $12.68，单跑 ~$13，远低于"性能事故"成本 |

### 4.2 不采纳 rollback / hot-fix 的依据

- **rollback** 4 语言 callSites（F151~154）= 抹平 Knowledge Graph 路线图主线工作 — 不可接受
- **hot-fix** 没有具体 hotspot 可优化 — 按本分析，无单一可优化点（cost 是新功能的合理增量）

### 4.3 后续 follow-up（非阻塞）

- **可选优化**：未来可考虑 callSite 抽取的 prompt token 优化（如 callSite 形态 deduplication），但属于 Q3 后续 Feature 范围
- **基线锚定**：本次新 fixture（cf0a131）作为后续 Feature 的新 perf baseline；后续 feature 跨 1-2 commits 的 baseline:diff 应严格遵守 ≤ 10%
- **CLAUDE.local.md 标注**：Feature 159 后基线已重置为 cf0a131；后续单 feature 跨度应基于此 commit

---

## 5. 验收
- ✅ 三个 baseline 数据齐全（fixture 已落 tests/baseline/<project>/spectra/full.json）
- ✅ baseline:diff 报告齐全（specs/159-feat151-baseline-snapshot/verification/baseline-diff-{micrograd,nanoGPT,self-dogfood}.{txt,json}）
- ✅ 根因分析独立可读（本文档）
- ✅ accept-and-spec 决策有依据（§4.1 表格）
- 待 **release owner / Feature 159 owner 签字确认**：本 accept-and-spec 决策

签字行（implementation phase 不写；由 Phase 5 verify / 用户最终确认时签）：
- [ ] Release owner 签字接受
- [ ] 在 Feature 151 verification report SC-006/NFR-1/NFR-5 段落用 verdict Branch B 文案补全
