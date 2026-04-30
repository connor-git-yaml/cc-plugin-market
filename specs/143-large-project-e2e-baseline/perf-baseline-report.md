# Feature 143 — Performance Baseline Report

> **Phase 0 骨架版本**：本报告章节齐全，所有具体数字以 `<待 Phase 1 回填>` 占位。Phase 1 完成 Wave 1 三个 baseline target 采集后回填，回填同时标 SC-002 PASS。

<!-- SC-002: report skeleton populated, awaiting fixture data -->

**生成时间**: 2026-04-30（骨架）  
**Spectra 版本**: v4.1.0（实际跑时锁定）  
**配置**: `--mode full`, `--model claude-sonnet-4-6`

---

## 1. 项目概况

### Wave 1

| 项目 | URL | Commit | 文件数（按类型）| LOC（估）| 模块数（Spectra）|
|------|-----|--------|----------------|---------|------------------|
| karpathy/micrograd | https://github.com/karpathy/micrograd | `<待回填>` | `<待回填>` | `<待回填>` | `<待回填>` |
| self-dogfood（本仓库）| 当前 worktree | `<待回填>` | `<待回填>` | `<待回填>` | `<待回填>` |
| continuedev/continue | https://github.com/continuedev/continue | `<待回填>` | `<待回填>` | `<待回填>` | `<待回填>` |

### Wave 2（Phase 2 完成后回填）

| 项目 | URL | Commit | 文件数（按类型）| LOC（估）| 模块数（Spectra）|
|------|-----|--------|----------------|---------|------------------|
| khoj-ai/khoj | https://github.com/khoj-ai/khoj | `<待回填>` | `<待回填>` | `<待回填>` | `<待回填>` |

---

## 2. 运行配置

| 项 | 值 |
|----|----|
| Spectra 版本 | `<待回填>`（来自 fixture meta.spectraVersion）|
| Mode | full / reading / code-only（按矩阵执行）|
| Model | claude-sonnet-4-6 |
| LLM 并发 | `<待回填>`（默认 3，可能 F146 已合并）|
| 关键 flags | `<待回填>`（来自 fixture meta.args）|
| Host OS | `<待回填>` |
| Hardware | `<待回填>`（mac M1/M2 / Linux x86 等）|

---

## 3. 性能数据（含项目规模标注）

### 3.1 总耗时

| 项目 / Mode | 总耗时（wall）| 文件规模 | 模块数 | 备注 |
|-----------|--------------|---------|--------|------|
| micrograd / full | `<待回填>` 秒 | 6 文件 / 200 LOC | 1 | M-101 v3.x baseline 是 361s（v4.1 不直接可比）|
| micrograd / reading | `<待回填>` | | | |
| micrograd / code-only | `<待回填>` | | | |
| self-dogfood / full | `<待回填>` | `<待回填>` 文件 | `<待回填>` | |
| self-dogfood / reading | `<待回填>` | | | |
| continue / full | `<待回填>` 分钟 | 800+ 文件 | `<待回填>` | spec.md §1.1 重点目标 |

### 3.2 LLM 调用耗时分布

| 项目 / Mode | 调用次数 | min | P50 | P95 | max |
|-----------|---------|-----|-----|-----|-----|
| `<待回填>` | | | | | |

> **数据来源**：fixture `perf.llmCallDurationsMs`。如 collector `_extractionNote == "stdout-format-unrecognized"`，本节标注"未采集"+ 后续跟进路径。

### 3.3 Token 消耗 + 成本

| 项目 / Mode | input | output | cache_read | 估算成本（USD）|
|-----------|-------|--------|-----------|----------------|
| `<待回填>` | | | | $`<待回填>` |

> **价格基准**：sonnet 4.6 input $3/Mtok, output $15/Mtok。`tokensCacheRead` 字段当前 collector 未读到（batch-summary 不输出）；schemaVersion 1.0 暂留 null。

### 3.4 Memory 峰值

| 项目 / Mode | memoryPeakKb | 数据来源 |
|-----------|--------------|---------|
| `<待回填>` | | `/usr/bin/time` -l/-v stderr 解析 |

> 不可采集时（如 `time` 二进制不存在）写"未采集，原因：..."。

---

## 4. 输出规模

| 项目 / Mode | graph 节点 | graph 边 | hyperedge | graph.json 大小 | spec 成功率 |
|-----------|-----------|---------|----------|----------------|------------|
| `<待回填>` | | | | | `<n>/<m>` = `<%>`% |

---

## 5. dry-run 偏差

| 项目 / Mode | 预估 tokens | 实际 tokens | 偏差比（actual/estimated）|
|-----------|------------|------------|---------------------------|
| `<待回填>` | | | `<x>x` |

> spec §5.1 必含。如某次 dry-run 失败或 collector 未抓到 estimate，标"未采集"+ 原因。

---

## 6. 阶段耗时分解

> **重要**：schemaVersion 1.0 的 collector 不强制 phase 提取（`extractionMethod: "unavailable"`）。本节若所有数据均 null，标注"待 F140 改进 batch-orchestrator 输出 phase 边界 marker 后启用"。

| 项目 / Mode | spec 生成 | graph 构建 | docs 生成 | embedding cache | 其他 |
|-----------|----------|-----------|----------|-----------------|------|
| `<待回填>` | `<秒/%>` | | | | |

---

## 7. Reproducibility 验证（Phase 2）

| 项目 / Mode | 重跑次数 | 同 commit 偏差（wall） | reproducibility-gate |
|-----------|---------|------------------------|---------------------|
| micrograd / full | 2 | `<%>`% | PASS / FAIL |
| self-dogfood / full | 2 | `<%>`% | PASS / FAIL |

> spec §6 要求"再跑一次结果差异 < 5%"。任何 FAIL 阻塞 Phase 2 commit。

---

## 8. 关键观察（Phase 1 回填）

`<待回填：3-5 条人工总结，引用 §3-§6 数据；不允许"约 / 估计"等模糊词，SC-004 grep 校验>`

---

## 9. 已知偏差与未采集字段

| 字段 | 状态 | 原因 / 后续跟进 |
|------|------|----------------|
| `phases.*` | `<待回填>` | extractionMethod=unavailable 时填"待 F140 / batch-orchestrator phase marker"|
| `perf.tokensCacheRead` | 未采集 | batch-summary.md 当前不输出此字段，schemaVersion 1.0 留 null |
| `perf.memoryPeakKb` | `<待回填>` | 仅在 `/usr/bin/time` 可用平台采集 |

---

## 10. 数据来源（fixture 文件清单）

```
tests/baseline/micrograd/full.json
tests/baseline/micrograd/reading.json
tests/baseline/micrograd/code-only.json
tests/baseline/self-dogfood/full.json
tests/baseline/self-dogfood/reading.json
tests/baseline/continue/full.json
tests/baseline/khoj/full.json    # Phase 2 后存在
```

> 直接编辑本报告时，必须同步引用 fixture 数据；不允许凭印象写数字。
