# Feature 143 — Bottleneck Analysis

> **Phase 0 骨架版本**：本分析章节齐全，所有具体数字以 `<待 Phase 1 回填>` 占位。Phase 1 完成 Wave 1 baseline 采集后回填，回填同时标 SC-003 / SC-005 PASS。

<!-- SC-003/SC-005: analysis skeleton populated, awaiting fixture data -->

**生成时间**: 2026-04-30（骨架）

---

## 1. 数据来源

本分析的所有量化结论均来源于：
- `specs/143-large-project-e2e-baseline/perf-baseline-report.md` §3-§6
- `tests/baseline/<project>/<mode>.json` 原始 fixture
- `<output>/spectra-stdout.log` / `spectra-stderr.log`（collector 持久化的原始 log）

---

## 2. 瓶颈排行（按耗时影响排序，至少 3 条）

> SC-003 要求"≥ 3 个瓶颈，每个含量化数据"。

### 2.1 瓶颈 1：`<待回填：例如 LLM 串行调用等待>`

- 耗时占比：`<%>`%（基于 `<项目 / mode>` 的 fixture）
- 量化证据：`phases.specGenerationMs / perf.totalWallMs = <X>%`，且 `perf.llmCallCount = <N>`、平均 `<P50>` ms / 次
- 根因：`<待回填>`（如：concurrency=1 默认；或 RPC 延迟主导）
- 影响范围：`<哪些 mode 受影响>`

### 2.2 瓶颈 2：`<待回填>`

- 耗时占比：`<%>`%
- 量化证据：`<待回填>`
- 根因：`<待回填>`

### 2.3 瓶颈 3：`<待回填>`

- 耗时占比：`<%>`%
- 量化证据：`<待回填>`
- 根因：`<待回填>`

> 如果 fixture 数据揭示更多瓶颈（如 graph 序列化、embedding cache miss），按相同格式扩展。

---

## 3. 量化结论

### 3.1 LLM 调用串行等待浪费

- LLM 总耗时：`<待回填>` 秒
- 总 wall time：`<待回填>` 秒
- LLM 等待占比 = LLM 总耗时 / wall time = `<%>`%
- 如果 concurrency=N，理论节约时间 = LLM 总耗时 × (1 - 1/N)；按 N=3 估算 = `<秒>` 秒（≈ 总耗时的 `<%>`%）

### 3.2 Token 成本结构

- input vs output 比 = `<a:b>`（来自 fixture `perf.tokensInput / tokensOutput`）
- cache_read 占比 = `<%>`%（如可采集；当前 schemaVersion 1.0 留 null）
- 单模块平均成本 = `<$>`/`module`

### 3.3 Graph 规模 vs LOC 关系

| 项目 | LOC | graph 节点 | graph 边 | 节点/kLOC | 边/kLOC |
|------|-----|-----------|---------|-----------|--------|
| `<待回填>` | | | | | |

> 用于判断 graph 序列化 / 加载是否会成为大项目（10k+ LOC）的二次瓶颈。

---

## 4. F145 / F146 并发数建议

> SC-005 要求"对 F145（并发优化）的'并发数建议'有明确结论"。F146（已合并到 master，本仓库 commit b1fab51）已经把手写信号量替换成 p-limit；本节基于实测数据论证当前默认值是否合理。

### 4.1 推荐 concurrency

- **建议 concurrency = `<N>`**
- **理由**：基于实测数据 `<引用 §3.1 LLM 等待占比 + sonnet 4.6 每分钟请求上限>`；超过 `<N>` 后边际收益快速衰减（API rate limit / 单实例上下文压力）

### 4.2 最大安全并发

- 不触 Anthropic API 速率限制的安全上限：sonnet-4-6 标准账户约 `<RPS>` 请求/秒；若批量调用每次约 `<P50>` ms，则单进程最大 concurrency ≈ RPS × P50 / 1000
- 建议保留 30% 安全余量

### 4.3 与 F146（p-limit 实现）的兼容性

- F146 把并发控制从手写信号量替换为 `p-limit`；本节给出的并发数可直接通过 `--concurrency N` 或 `spec-driver.config.yaml batch.concurrency` 注入
- 如需后续验证 F146 是否真的有性能提升，跑：
  ```bash
  npm run baseline:collect -- --target self-dogfood --mode full
  npm run baseline:diff -- <F146_前的_fixture> <F146_后的_fixture>
  ```

---

## 5. Wave 2 优化优先级建议

基于 Wave 1 + Wave 2 的对比数据，给出优先级：

| 优化方向 | 是否必要 | 理由（量化）|
|---------|---------|-----------|
| Graph 分层存储 | `<是/否/有条件>` | 当 `graph.json > 10MB` 时建议；`<引用 fixture 数据>` |
| Embedding cache 改进 | `<是/否>` | `<引用 cache_read 占比；当前 collector 未采集，需补>` |
| LLM 并发提升（已 F146）| 已实施 | `<比较 F146 前后 fixture 数据>` |
| Phase marker 标准化 | 是 | F140 工作；`extractionMethod: "unavailable"` 阻碍精细化分析 |
| AST cache | `<是/否>` | `<基于 graph 重建耗时占比>` |

---

## 6. 与 Phase 3 Success Metrics 的对照

Phase 3 目标：
- 大项目 batch 完成时间 < 20 分钟
- 单次 batch 成本 < $2.00

| 项目 | 当前耗时 | 目标 | 差距 | 主要靠哪个优化弥合 |
|------|---------|------|------|------------------|
| continue / full | `<待回填>` 分钟 | < 20 分钟 | `<分钟>` | `<引用 §4 并发 + §5 cache>` |
| khoj / full | `<待回填>` 分钟 | < 20 分钟 | `<分钟>` | `<同上>` |

| 项目 | 当前成本 | 目标 | 差距 | 主要靠哪个优化弥合 |
|------|---------|------|------|------------------|
| continue / full | $`<待回填>` | < $2.00 | `<差距>` | `<引用 cache + token 优化>` |

---

## 7. 不可量化的观察 / 风险

`<待回填：人工观察，如某些大项目某些模块持续超时、特定语言 AST 提取慢、特定 mode 的 LLM 拒绝率高等。引用 fixture 或 stdout log 行号作为证据。>`
