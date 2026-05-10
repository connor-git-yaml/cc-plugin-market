# Feature 162 — Clarification

> Status: NEEDS_RESOLUTION
> Scanned at: 2026-05-10

## 1. 跨制品引用一致性

- **FR-027 vs SC-002 vs EC-005 测试用例数量不一致**：FR-027 明确列出 5 组覆盖测试（(a)~(e)）；SC-002 仅写"self-judge hard-fail（FR-027）3 组覆盖测试全 pass"——3 组 ≠ 5 组。EC-005 描述"hard-fail 检查"，未提数量。**SC-002 须改为 5 组**。
- **FR-032 vs EC-008 partial run 处理一致**：FR-032 描述 `--accept-partial` / `--restart-partial`；EC-008 同样有（a）删除 / （b）接受丢失，但用语与 FR-032 flag 名未直接对应。语义一致，措辞略有偏差，plan 阶段确认即可。
- **FR-037 vs US-4 验收 4 字段路径一致**：FR-037 和 US-4 验收 4 均引用 `perf.mcpToolCalls[]`，与 EC-006 canonical schema 定义一致。无歧义。
- **FR-038 vs SC-005 artifact contract 一致**：两处描述完全对齐，无歧义。

## 2. 命名 / schema 一致性

- **`perf.mcpToolCalls[]` 拼写一致**：EC-006、FR-037、US-4 验收 4 三处拼写一致。
- **DEFAULT_JUDGES 前后版本同步**：FR-020 定义目标值；FR-025 回退方案去掉 GLM 保留 Opus+Kimi；EC-005 未提 DEFAULT_JUDGES 具体内容——均一致。
- **`--judges` CLI flag 在 FR-027 中被引用**（"含 `--judges` CLI 覆盖"），但 FR-032 / 其他 FR 均未定义该 flag 的类型、默认值、错误处理，见第 3 节。

## 3. CLI / env var 完整性

| 参数 | 类型 | 默认值 | 错误输入行为 | spec 已明确？ |
|------|------|--------|--------------|--------------|
| `--max-runs-per-day N` | int | （无） | 未说明（负数？0？非数字？） | 部分——FR-032 仅有 quota 逻辑，无错误输入处理 |
| `--accept-partial` | bool flag | false | N/A | 是（FR-032） |
| `--restart-partial` | bool flag | false | 两 flag 同时传时行为未定义 | 部分——互斥冲突未明确 |
| `SPECTRA_EVAL_EXECUTOR` | string | `codex:gpt-5.5` | 传入无效 backend prefix 时行为未说明 | 部分——FR-011 有默认值但无错误输入路径 |
| `--judges` | string（逗号分隔列表） | DEFAULT_JUDGES | 空字符串？单个无效 id？ | 否——仅在 FR-027 作为覆盖通道被引用，无独立 CLI 定义 |

**需 plan 阶段补充**：`--accept-partial` 与 `--restart-partial` 同时传入时的互斥行为；`--judges` 的完整 CLI spec（类型、默认值、错误处理）。

## 4. 隐含假设（plan 阶段验证清单）

- [ ] **10K tokens 阈值来源**（FR-031 / FR-032）：spec 将单 run ≥ 10K tokens 作为分批触发阈值，但未注明该数字来自 ChatGPT Pro 周配额文档还是经验估算。**不阻断 plan**，但 plan 须标注数据来源或改为"由 pilot batch 实测后决定"。
- [ ] **`claude plugin update spec-driver` 命令存在性**（FR-006）：spec 假设该命令可用，但未确认 claude CLI 支持此子命令形式。**不阻断 plan**，但 plan 阶段须验证命令行为并提供等价 fallback（如手动删 cache 重装）。
- [ ] **SWE-L001~L010 fixture 路径**（依赖 §4.2）：调研已确认 10 个 fixture 在 `tests/baseline/swe-bench-lite/fixtures/`，与 spec 第 305 行一致。**已无歧义**。
- [ ] **`--accept-partial` 与 `--restart-partial` 互斥**：同时传入时 spec 未定义优先级或报错行为。**轻度阻断 plan**——实现前须明确。

## 5. 测量指标的可计算性

- **IoU 计算粒度**（FR-022）：spec 仅写"5 个固定 fixture 子集"上对比，未明确 IoU 是按 fixture 级 pass/fail 集合计算还是 run 级。calibration 每个 fixture 运行多少次？1 次？3 次？粒度不同会导致样本量差异很大。**需 plan 阶段明确**。
- **Pearson correlation 样本量**（FR-023）：5 fixture × ? runs，样本量未定义。Pearson 在 n=5 时统计功效极低（α=0.05 下 r≥0.6 对应 p≈0.28，远不显著）。**需 plan 阶段明确每 fixture 运行次数**，否则结论无统计意义。
- **Bootstrap 重采样次数**（FR-034 / SC-004）：spec 引用 `bootstrapPercentileCi`（已实现），但未指定 B 值（1000？10000？）。调研 §4.7 显示库已实现但默认 B 未在 spec 中引用。**不阻断 plan**，plan 阶段引用库默认值即可。
- **Codex driver token cost 折算**（FR-035）：FR-035 要求填入 token 消耗数据并注明"零边际成本"，但 spec 未说明 ChatGPT Pro 订阅成本如何分摊到 per-run 报告中（是填 $0 还是订阅均摊？）。调研 §4.7 确认 `codex:gpt-5.5` 在 PRICING_TABLE 中存在，但 `eval-mcp-augmented.mjs` 的 `costUsd` 暂置 null。**需 plan 阶段决策折算方式**。

## 结论

- **阻断 plan 阶段的歧义数：3**
  1. SC-002 写"3 组"但 FR-027 定义 5 组覆盖测试（需修 spec）
  2. `--accept-partial` 与 `--restart-partial` 互斥行为未定义（需 plan 补充）
  3. IoU / Pearson 样本量未定义（calibration 每 fixture 跑几次），导致统计有效性无法验证
- **可在 plan 阶段顺带解决的歧义数：4**（10K tokens 来源注释、`claude plugin update` fallback、bootstrap B 值、Codex cost 折算方式）
- **spec 已足够清晰可推进 GATE_DESIGN？否**——SC-002 的测试数量与 FR-027 不一致须在推进前修正
