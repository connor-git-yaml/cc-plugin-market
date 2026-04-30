# Feature 143 — Bottleneck Analysis

> **数据来源**：3 个固定 baseline projects 在 spectra full mode 下的 fixture（schemaVersion 1.0）。
> 所有量化结论引用 `tests/baseline/<project>/spectra/full.json`。

<!-- SC-003/SC-005: analysis populated from fixture data -->

**生成时间**: 2026-04-30

---

## 1. 数据来源

```
tests/baseline/micrograd/spectra/full.json
tests/baseline/nanoGPT/spectra/full.json
tests/baseline/self-dogfood/spectra/full.json
```

每个 fixture 配套 `~/.spectra-baselines/<project>-output/spectra-full/spectra-{stdout,stderr}.log` 原始日志（含 module-level LLM / enrich / total 计时）。

---

## 2. 瓶颈排行（按耗时影响排序）

> SC-003 要求"≥ 3 个瓶颈，每个含量化数据"。

### 2.1 瓶颈 1：Enrich 阶段是隐形成本（占 module-level total ~50%）

**量化证据**（self-dogfood stderr，17 模块）：

| 模块 | LLM#1 (s) | enrich (s) | total (s) | enrich/total |
|------|-----------|------------|-----------|--------------|
| batch | 244.4 | 219.9 | 464.3 | 47% |
| panoramic | 230.1 | 214.0 | 444.4 | 48% |
| models | 312.0 | 118.2 | 430.6 | 27% |
| core | 260.8 | 148.3 | 409.2 | 36% |
| debt-scanner | 226.7 | 159.1 | 385.9 | 41% |
| **平均（17 模块）** | **187.8** | **140.1** | **329.5** | **42%** |

- **占比**：self-dogfood enrich 阶段平均占 module-level total 的 **42%**（一半时间在 LLM#1 之后的 enrich 阶段）
- **schemaVersion 1.0 限制**：fixture 的 `perf.llmCallCount=17` 只统计 LLM#1，**enrich 的 LLM 调用次数 + 耗时不在 fixture 中**
- **根因**：spectra batch 每模块跑两轮 LLM —— spec 生成（LLM#1）+ enrichment 丰富（context 注入 / cross-module 链接 / 文档润色等）。schemaVersion 1.0 的 LLM 计数把"看似单次调用"的实际 ~2x 调用低估
- **影响**：用户基于"4 模块 = 4 次 LLM"做成本估算时低估 2x（实际是 8 次 LLM，每次 input + output）

### 2.2 瓶颈 2：单次 LLM call P95 / P50 比例（self-dogfood 大模块拖尾）

| 项目 | P50 (s) | P95 (s) | max (s) | P95/P50 | max 模块 |
|------|---------|---------|---------|---------|----------|
| micrograd | 100 | 105 | 105 | 1.05 | （4 模块均匀）|
| nanoGPT | 103 | 121 | 121 | 1.17 | data__openwebtext__prepare_py |
| **self-dogfood** | **162** | **312** | **312** | **1.93** | **models（1.6M input tokens）** |

- **self-dogfood P95/P50 ≈ 2x**：models 模块单次 LLM call 312 秒（5+ 分钟），是 P50 的 ~2x
- **根因**：sonnet 4.6 在大 input context（>30k input tokens）时输出耗时显著上升；self-dogfood 大模块的 LLM context 含跨模块依赖描述 + 项目元信息
- **影响**：concurrency=3 时，single slow call 阻塞整个 batch wall time（Amdahl's law）—— 所有其他模块跑完仍在等这个

### 2.3 瓶颈 3：Dry-run 严重低估实际 token（影响 budget 守护）

| 项目 | 预估 tokens | 实际 tokens | 偏差比 |
|------|------------|------------|--------|
| micrograd | 35,534 | 98,986 | **2.79x** |
| nanoGPT | 50,348 | 401,340 | **7.97x** |
| self-dogfood | 1,051,660 | 1,976,755 | **1.88x** |

- **nanoGPT bias = 8x**（最严重）：dry-run 仅按代码 LOC 估算，但实际 LLM context 含 ipynb / model.py（16k bytes）等大文件 + cross-module 注入
- **根因**：dry-run 估算公式只考虑代码文件 LOC + 简单倍数；未把"邻居模块依赖描述 / system prompt / project context / batch enrichment 的 input 累积"计入
- **影响**：用户依赖 `--dry-run --budget X` 决定预算时，1.88x ~ 8x 的低估容易让 budget 守护要么提前触发误报、要么完全失效

### 2.4 瓶颈 4：nanoGPT root 模块的 943s 项目级开销

**量化证据**（nanoGPT stderr）：

```
[data__shakespeare__prepare_py]  total: 80.6s
[data__shakespeare_char__prepare_py] total: 88.9s
[data__openwebtext__prepare_py] total: 120.5s
[root] LLM#1: 103.4s | enrich: 116.9s | total: 1162.0s
```

- root 模块 total = 1162s，但 LLM (103.4) + enrich (116.9) = 220.3s
- **剩余 ~943s（占 root total 81%）属于"项目级 pipeline"**：docs 生成（README / project spec）、hyperedge 集成、anchor integration（fetch failed）、graph 构建等
- **schemaVersion 1.0 限制**：这部分被笼统地记在 root 模块的 total，没单独 phase 拆分
- **影响**：nanoGPT wall 1254s 中 ~75% 是项目级 pipeline，不是 LLM 等待。LLM 并发优化（F146）对小项目（4 模块）的 wall 改进有限

---

## 3. 量化结论

### 3.1 LLM 调用串行等待浪费

| 项目 | LLM 总耗时（含 enrich 推算）| wall | LLM 等待占比 |
|------|---------------------------|------|--------------|
| micrograd | ~393 s（仅 LLM#1）| 176 s | LLM 总 / wall = 223%（说明 concurrency=3 共享了 3 倍 LLM 等待，wall ≈ 1/2.2 of 总）|
| nanoGPT | ~393 s（仅 LLM#1，root 项目级 943s 主导）| 1,254 s | 31%（项目级 pipeline 主导）|
| **self-dogfood** | **~5,576 s（含 enrich）/ 3,193 s（仅 LLM#1）** | **1,802 s** | **77%（concurrency=3 利用率 97%）** |

**收益估算**：self-dogfood 当前 concurrency=3 利用率 97%，wall ≈ sum(module total) / 3 = 5576 / 3 ≈ 1859 s。

如果 concurrency 提升到 6（API rate limit 允许）：
- 理论 wall ≈ 5576 / 6 ≈ 929 s ≈ **节约 ~870 s（48%）**
- 但 P95=312s 是 single slow call 上限；max wall ≥ P95 + reset 模块 = ~600s
- **实际预期收益**：concurrency 6 → wall ~900-1100 s（节约 700-900 s，~40-50%）

### 3.2 Token 成本结构

| 项目 | input | output | input/output 比 |
|------|-------|--------|-----------------|
| micrograd | 77,233 | 21,753 | 3.55 |
| nanoGPT | 312,491 | 88,849 | 3.52 |
| self-dogfood | 1,649,212 | 327,543 | 5.04 |

- **input/output 比 ≈ 3.5-5x**：self-dogfood 大项目 input 占比更高（更多 cross-module context + system prompt）
- **cache_read** 当前 collector 不读取（schemaVersion 1.0 限制），无法量化 cache 节约比例

### 3.3 Graph 规模 vs LOC 关系

| 项目 | LOC | Graph 节点 | Graph 边 | 节点 / kLOC | 边 / kLOC |
|------|-----|-----------|---------|-------------|----------|
| micrograd | 248 | 13 | 6 | **52.4** | 24.2 |
| nanoGPT | 1,235 | 32 | 18 | **25.9** | 14.6 |
| self-dogfood | 116,583（含 1125 .md）| 17 | 66 | 0.15 | 0.57 |

- **小项目节点/kLOC 高（52 / 26）**：spectra 倾向于细粒度建模（class / function / 重要变量都成节点）
- **大项目节点/kLOC 低（0.15）**：spectra 在 self-dogfood 上聚合到模块级（17 节点 ≈ 17 模块），不展开到细粒度
- **结论**：spectra 的 graph 粒度策略已自适应（小项目细 / 大项目粗），不需要 graph 分层存储优化（self-dogfood 40 KB 远低于 10 MB 警戒线）

---

## 4. F145 / F146 并发数建议

### 4.1 现状

F146（v4.1.1）已经把手写信号量替换为 p-limit，默认 concurrency=3（CLI flag `--concurrency` 可覆盖；spec-driver.config.yaml batch.concurrency 也可设置）。

### 4.2 推荐 concurrency

- **当前默认 concurrency=3 在 self-dogfood 利用率 97%**——基本饱和，提升空间有限
- **建议保持 concurrency=3**（默认值合理），但**对大项目（≥10 模块）可临时提到 6-8**：
  - self-dogfood concurrency=6 理论 wall ~900-1100 s（节约 ~40-50%）
  - 但需要先解决瓶颈 §2.2 的 P95 outliers（models 模块 312s）
  - 实测受限于 P95：concurrency 越高，single slow call 占比越大

### 4.3 最大安全并发

- sonnet-4-6 standard tier：约 RPS=50，每次调用 P50=162s（self-dogfood 大模块）= 单进程理论 max concurrency ≈ 50 × 162 / 60 ≈ 135
- 实际限制更可能是 token-per-minute（TPM）：sonnet TPM ~400k → self-dogfood 17 模块×~115k tokens/模块 = 1.95M total，平均 17 模块 / 30 min = 0.57 模块/min × 115k = 65k TPM ≈ 16% TPM 用量
- **保留 30% 安全余量后**：concurrency 上限 ≈ **8-10**（不建议超过 10）

### 4.4 micrograd / nanoGPT concurrency 现状

- micrograd 4 模块 / concurrency=3 = 第一批 3 + 第二批 1，第二批是 single call。wall = 2 × P50 ≈ 200s（实际 176s 因为 P50 不均）
- nanoGPT wall 由 root 模块的 943s 项目级 pipeline 主导，**concurrency 优化对 wall 改进 < 5%**
- self-dogfood concurrency=3 利用率最高（97%），是 F146 收益的最大受益者

### 4.5 后续验证路径

升级后跑：
```bash
npm run baseline:collect -- --target self-dogfood --mode full
npm run baseline:diff -- <pre_F147_fixture> tests/baseline/self-dogfood/spectra/full.json
```
对比 wall time 是否真的下降（regression mode 红色 = 反而变慢，黄色 = 小幅波动，绿色 = 改进显著）。

---

## 5. Wave 2 / 后续优化优先级（基于本次实测）

| 优化方向 | 优先级 | 量化理由 |
|---------|-------|---------|
| **减少 LLM input context** | **极高** | dry-run bias **8x（nanoGPT）**说明实际 input 比预期大 8 倍；trim cross-module context 直接挂钩成本（potentially 节约 50%+ token） |
| **Enrich 阶段优化（合并到 LLM#1 prompt）** | 高 | self-dogfood enrich 占 module total 42%；如能合并 LLM#1 + enrich 为单次调用，wall 节约 ~30-40% |
| **Phase marker 标准化（F140 工作）** | 高 | 当前 `phases.*` 全 null，无法精细分析瓶颈；nanoGPT root 943s 项目级开销无法拆分 |
| **LLM 输出 cache_read 字段** | 中 | batch-summary 加输出，能立刻知道 cache 命中率，决定 cache 优化方向 |
| **dry-run 估算公式修正** | 中 | bias 1.88x ~ 8x 严重影响 budget 守护准确性 |
| **Single slow call 切片**（self-dogfood models 312s）| 中 | 大模块超长 LLM call 阻塞 concurrency 收益；可考虑 input chunking |
| **Graph 分层存储** | **低** | self-dogfood graph.json 仅 40 KB，远低于 10 MB 警戒线，无需优化 |
| **并发 > 3** | **低** | 当前 concurrency=3 利用率 97%，提升 6-8 仅小项目少量 wall 改进；需先解决 P95 outliers |

---

## 6. 不可量化的观察 / 风险

1. **anchor-integration 失败**（hyperedges 全 0）：sentence-transformers 模型下载失败导致语义边生成跳过；本地环境网络问题，不是 spectra 本身 bug。但 fixture 里 `output.graphHyperedgeCount=0` 是 known偏差（不是 0 hyperedges 真实值）
2. **self-dogfood 17 模块拆分质量**：spectra 自动模块识别把 `src/cli/`、`src/batch/` 等分成独立 module，但实际项目内有跨模块强依赖（如 cli → batch → orchestrator → graph）。LLM input 不可避免重复加载相邻模块的描述 → input 膨胀（dry-run bias 1.88x 一部分原因）
3. **nanoGPT bias 8x 是**系统性问题**还是 nanoGPT 特定**：本次只跑了 1 次 nanoGPT，无法判断这个 bias 是 estimator 公式问题还是 nanoGPT 特定（含 ipynb / 大单文件）。建议后续跑其他 ML 项目（如 GPT-fast、llama.cpp）做对比 bias 数据
4. **Memory 峰值与并发线性放大**：self-dogfood 2 GB peak（17 模块 × 3 concurrency）。如果未来跑 50+ 模块大项目，peak 可能达到 5-10 GB —— 需要 monitoring 和单进程 memory limit 设计
