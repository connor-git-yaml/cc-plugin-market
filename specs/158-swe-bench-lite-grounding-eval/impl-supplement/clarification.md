---
feature_id: "157"
clarify_date: "2026-05-09"
status: "clarification-complete"
---

# Feature 158 — 需求澄清报告

## 执行摘要

扫描 spec.md 全文（含 frontmatter、24 FR、9 SC、14 EC、5 P 前置条件）后：

- **未决定项**：5 项（其中 2 项可在 spec 阶段立即决定，3 项合理 defer 到 plan）
- **歧义点**：4 项（均可通过修订文字消除）
- **需求间冲突**：2 项（均有明确解决方案）
- **可测性问题**：2 项

---

## 1. 未决定项清单

### U-1：Fixture 数量"5-8 task"边界不统一

**现状**：
- 背景章节写 "5-8 task"
- SC-001 写 `≥ 5`
- FR-C-004 写 `≥ 5 个 fixture task`
- FR-E-003 / SC-004 写 "N=5-8 task"
- 成功标准 / MVP 范围内写 "5-8 task fixture"

**影响**：plan 阶段若 fixture 选 5 个，Pass Rate 矩阵"至少 5 行"可达，但"N=5-8"暗示 8 更好——导致验收时对"达成"的判断歧义。

**推荐决定（spec 阶段）**：统一为 **≥ 5 个，目标 8 个**（target=8，acceptance threshold=5）。SC-001 保持 `≥ 5`，其余描述用"5-8 个（目标 8 个，验收下限 5 个）"。

**status**: `resolved-now-by-clarify`（见第 5 节修改清单 M-1）

---

### U-2：FR-D-002 ast-diff 60% 阈值 — spec 阶段能否先 commit 一个

**现状**：spec 写"60% 阈值在 plan 阶段可微调"，同时 FR-D-002 已把 60% 写进功能需求本体（`匹配度 ≥ 60% 时退出码 0`）。

**分析**：60% 既是 spec 阶段的设计决策（oracle 语义），又是 plan 阶段的实验校准值。两层混在一起：
- 语义决策（退化 oracle 用 fuzzy 行级匹配）→ spec 阶段已定
- 数值决策（60% 还是 70%）→ plan 阶段实测后确认

**推荐决定（spec 阶段）**：在 FR-D-002 明确写 **"初始阈值 60%，plan 阶段可根据对 ≥ 3 个候选 task 的实测结果在 [50%, 70%] 范围内微调，最终值须在 plan.md 中记录依据"**。这样 spec 阶段有确定的初始值，plan 阶段有明确的调整窗口和记录义务。

**status**: `resolved-now-by-clarify`（见 M-2）

---

### U-3：FR-G-001 telemetry 方案 A vs B — plan 阶段决定是否合理

**现状**：spec 明确写"plan 阶段决定方案"，首选方案 A（src/mcp/ 侵入式 hook）+ 备选方案 B（wrapper sniff stdio）。

**分析**：方案选择对 implement 影响较大（方案 A 需修改 Feature 155 合同代码 + 补单测；方案 B 不改 src/ 但 stdio sniff 脆弱），defer 到 plan 阶段是合理的——plan 阶段需要先验证 P2（MCP server 启动稳定性），稳定后再决定侵入深度。

**推荐决定**：保持 defer-to-plan，但 spec 阶段应补充决策依据的判断标准：若 P2 验证显示 MCP server stdio 稳定，优先方案 A（侵入式 hook）；若 stdio 不稳定或 JSON-RPC 协议有变化，选方案 B。

**status**: `defer-to-plan`（spec 补充决策标准即可，见 M-3）

---

### U-4：P3 前置条件验证 — "plan/implement 阶段"措辞模糊

**现状**：P3 写 `⚠️ [需 plan/implement 阶段验证]`，而 P2 / P4 / P5 写 `⚠️ [硬前置，必须 implement 前完成]`。

**分析**：P3（裸机 pytest 可行性）的验证结果直接决定 fixture 的 oracle 类型（functional vs ast-diff），这个决策必须在 implement 开始前完成（否则写 fixture 转换脚本时不知道 oracle 路径）。"plan/implement 阶段"比其他三个前置条件的措辞宽松，容易被误解为可以拖到 implement 中途才验证。

**推荐决定（spec 阶段）**：P3 改为 `⚠️ [硬前置，必须 implement 前完成]`，与 P2/P4/P5 保持一致。

**status**: `resolved-now-by-clarify`（见 M-4）

---

### U-5：SC-004 stop-loss 截断场景下的达成判定

**现状**：SC-004 要求"总计 ≥ 45 runs"（5 task × N=3 × 3 group），FR-B-008 允许 stop-loss 在 $40 时提前终止。如果 stop-loss 在第 30 个 run 时触发，SC-004 无法达成。

**现状 spec 对此无任何说明。**

**推荐决定（spec 阶段）**：在 SC-004 增加注记：**"若因 `--stop-loss` 提前停止，以实际产出 runs 目录中的文件为准，不强制要求 ≥ 45；但报告须标注'实验因预算限制提前停止（完成 X/45 runs）'，此时 SC-004 视为'条件达成'（非 fail）"**。

**status**: `resolved-now-by-clarify`（见 M-5）

---

## 2. 歧义点修订建议

### A-1：FR-A-005 "无需执行环境"语义不清

**原文**：`Fixture 不使用官方 SWE-Bench Docker harness，MUST 可在裸机通过 pip install -e . + pytest 方式验证（或在 ast-diff 退化路径下无需执行环境）。`

**歧义**：ast-diff 退化路径写"无需执行环境"，但 FR-D-002 的 `oracle.checks[]` 写 `node scripts/eval-diff-fuzzy-match.mjs --actual <(git diff HEAD)` —— `git diff HEAD` 需要 git，并非真正"无需执行环境"。

**修订建议**：
- 修订前：`或在 ast-diff 退化路径下无需执行环境`
- 修订后：`或在 ast-diff 退化路径下无需 Python 执行环境（仅需 git 和 Node.js，不需要 pip install -e .）`

---

### A-2：FR-B-004 run 文件路径与 SC-004 验收路径不一致

**FR-B-004 原文**：路径 `tests/baseline/swe-bench-lite/runs/<group>/<taskId>/run-<N>.json`

**FR-B-006 / 用户故事 2 验收场景 2 原文**：路径 `tests/baseline/swe-bench-lite/runs/B/SWE-L001/full.json`

**歧义**：文件名在两处不一致，一处是 `run-<N>.json`，另一处是 `full.json`。

**修订建议**：统一为 `run-<N>.json`（与 FR-B-004 保持一致），用户故事 2 验收场景 2 的 `full.json` 改为 `run-1.json`（repeatIndex=1 时）。

---

### A-3：SC-009 可测性依赖 LLM 行为

**原文**：`SC-009：MCP telemetry 机制可工作 — 在 Group C run 完成后，对应 <runtime-tmp>/mcp-telemetry-<runId>.jsonl 文件存在且包含 ≥ 1 条 JSON 记录（仅当 agent 至少调过一次 MCP tool 时；agent 未调时记录数为 0 是合理状态，但 jsonl 文件本身必须可解析）。`

**歧义**：验收条件用括号注明"仅当 agent 至少调过一次 MCP tool 时"，但 verify 脚本（FR-F-002）不触发真实 API 调用，无法保证触发 MCP tool 调用。SC-009 本质上只能在真实 eval run 后验证，而非 CI 中验证。

**修订建议**：将 SC-009 拆分为两个可独立验证的子目标：
- SC-009a（CI 可验证）：`eval-mcp-augmented.mjs --group C --dry-run` 时，脚本内部构造 `SPECTRA_MCP_TELEMETRY_PATH` 环境变量，telemetry JSONL 文件路径正确传递给子进程（可通过 dry-run 日志检查环境变量注入）
- SC-009b（真实 eval 后验证）：完成至少 1 次非 dry-run Group C run 后，telemetry JSONL 文件存在且可被 JSON.parse（记录数 ≥ 0）

---

### A-4：FR-E-001 §6 摘要与 detail 报告内容重复问题

**原文**：`147 §6 仅作 executive summary` + `同时 MUST 产出独立 detail 报告`

**歧义**：spec 没有明确 §6 摘要与 detail 报告的内容边界。若两份文件都含 Pass Rate 矩阵和 Token Cost 表，维护时需同步两处数据；若 §6 只写结论文字而引用 detail，则"每子章节均有实质内容（SC-005）"要求又会与之冲突。

**修订建议**：在 FR-E-001 补充内容分工说明：
- **§6（147 报告）**：含完整 4 个子章节，数据表格直接嵌入（方便独立阅读），章节末尾加跨链接
- **detail 报告（157）**：在 §6 数据基础上额外提供 per-run 明细（每个 run 的 `oracleResult` / `wallMs` / `mcpToolCallCount`）和风险展开分析
- 两份文档的 Pass Rate 矩阵 / Token Cost 表数据必须一致（由同一脚本生成）

---

## 3. 需求间冲突解决方案

### CON-1：SC-004（≥ 45 runs）vs FR-B-008（stop-loss 可提前终止）

**冲突描述**：SC-004 要求 "总计 ≥ 45 runs 的文件"，FR-B-008 允许 stop-loss 在 $40 时提前停止。两者直接冲突——合规的 stop-loss 行为会导致 SC-004 无法达成。

**解决方案**：
1. SC-004 改为"尽力完成"目标，增加 stop-loss 豁免条款（已在 U-5 中处理）
2. 顺序约束：stop-loss 启动后，已完成的 runs 目录文件保留，不删除；SC-004 验收以实际文件数为准
3. 验收脚本（FR-F-002）不检查 SC-004（SC-004 是 post-eval 的人工确认项，非 CI 自动验收项）

---

### CON-2：FR-A-003 日期过滤（≥ 2024-01-01）vs 候选仓库实际 issue 时间

**冲突描述**：FR-A-003 要求 `swebenchMeta.createdAt ≥ 2024-01-01`，但 SWE-Bench Lite 数据集（Princeton NLP 发布）中 Python 单文件 patch 类 task 的 issue 创建时间分布未知——若候选仓库（sympy / astropy / pytest-dev/pytest）在 2024 年后的 issue 数量不足 5 个，fixture 选取将无法达成 SC-001。

**解决方案**：
1. 在 fixture 转换脚本（`swe-bench-fixture-import.mjs`）中先拉全量 task 列表，过滤 `createdAt ≥ 2024-01-01` 后计数
2. 若过滤后数量 < 5，**降级策略**：放宽到 `createdAt ≥ 2023-07-01`（Claude 3 训练截止前），并在报告中标注日期放宽原因
3. 此降级策略需在 spec 中显式声明（而非留给 implement 阶段临时决定）

**修订建议**：在 FR-A-003 补充降级注记（见 M-6）

---

## 4. 可测性改进建议

### T-1：verify-feature-158.mjs 的验收范围需明确

**现状**：FR-F-002 列出 3 个检查点（fixture 数量 / schema / dry-run 成功），但 SC-004/SC-005/SC-006/SC-008/SC-009 均未被 verify 脚本覆盖。这意味着 verify 阶段只能验证一部分 SC。

**建议**：在 FR-F-002 / FR-F-003 明确说明 verify 脚本的设计边界：**"以下 SC 需要真实 eval run 后人工确认，不在 verify 脚本范围内：SC-004 / SC-005 / SC-006 / SC-008 / SC-009b"**，避免 verify 阶段产生"验收报告 PASS 但实验数据未产出"的误解。

### T-2：SC-009 依赖非确定性 LLM 行为（已在 A-3 中分析）

SC-009 的"agent 调过 MCP tool"条件无法在 CI 中稳定触发。拆分为 SC-009a（CI 验证 env var 注入）+ SC-009b（真实 eval 后验证）是最小侵入的改法。

---

## 5. Spec 修改清单

以下每条均注明 spec.md 对应位置，由主编排器 / spec-review 阶段决定是否采纳：

| # | 位置 | 修改内容 | 理由 | 优先级 |
|---|------|---------|------|--------|
| M-1 | 全文（背景、SC-001、FR-C-004、FR-E-003、MVP 范围）| 统一 fixture 数量表述为"5-8 个（目标 8 个，验收下限 5 个）"，SC-001 / FR-C-004 验收阈值保持 `≥ 5` | 消除歧义 U-1 | 高 |
| M-2 | FR-D-002 | 补充"初始阈值 60%，plan 阶段可在 [50%, 70%] 内微调，需在 plan.md 记录依据" | 消除歧义 U-2 | 中 |
| M-3 | FR-G-001 / 复杂度评估章节 | 补充 telemetry 方案 A vs B 的决策标准：P2 验证稳定 → 方案 A；否则 → 方案 B | 减少 plan 阶段不确定性 | 中 |
| M-4 | P3 前置条件 | 状态改为 `⚠️ [硬前置，必须 implement 前完成]`，与 P2/P4/P5 一致 | 消除歧义 U-4 | 高 |
| M-5 | SC-004 | 增加 stop-loss 豁免注记：预算限制导致提前停止时，以实际完成 runs 为准，视为"条件达成" | 解决冲突 CON-1 | 高 |
| M-6 | FR-A-003 | 补充降级注记：若 createdAt ≥ 2024-01-01 的候选 task 数量 < 5，可降级到 ≥ 2023-07-01，并在报告中标注 | 解决冲突 CON-2 | 中 |
| M-7 | FR-A-005 | 改"无需执行环境"为"无需 Python 执行环境（仅需 git 和 Node.js）" | 消除歧义 A-1 | 中 |
| M-8 | FR-B-004 / 用户故事 2 验收场景 2 | 统一文件名为 `run-<N>.json`，场景 2 中 `full.json` 改为 `run-1.json` | 消除歧义 A-2 | 高 |
| M-9 | SC-009 | 拆分为 SC-009a（CI 可验证：dry-run 环境变量注入）+ SC-009b（真实 eval 后验证：JSONL 文件存在且可解析） | 消除歧义 A-3、提升可测性 T-2 | 高 |
| M-10 | FR-E-001 | 补充 §6 与 detail 报告内容分工：§6 含完整数据表 + 跨链接，detail 含 per-run 明细 + 风险展开，两份文档数据必须一致 | 消除歧义 A-4 | 中 |
| M-11 | FR-F-002 / FR-F-003 | 明确 verify 脚本范围边界，列出不在 CI 验证范围的 SC（SC-004/005/006/008/009b） | 可测性改进 T-1 | 中 |

---

## 附：推迟到 plan 阶段的项目（合理 defer，不需 spec 修改）

- FR-G-001 方案 A vs B 最终选择（已在 spec 写明 plan 阶段决定，添加决策标准后足够）
- FR-D-002 60% 阈值实测校准（spec 阶段先 commit 初始值 60%，plan 阶段实测 ≥ 3 个 task 后微调）
- P2 / P4 / P5 具体验证流程（由 plan 任务分解覆盖）
- baseline:collect 对 sympy/astropy/pytest 的实际耗时（plan 阶段预跑估算）
