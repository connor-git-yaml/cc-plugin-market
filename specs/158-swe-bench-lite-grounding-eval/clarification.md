---
feature: 158
title: SWE-Bench Lite Grounding Eval — 需求澄清记录
created: 2026-05-09
phase: clarify
---

# Feature 158 — 需求澄清记录

## 概览

| 类别 | 数量 |
|------|------|
| 歧义点（已自动收口） | 3 |
| 待 plan 阶段决策 | 4 |
| 跨制品依赖未定义 | 2 |
| 数值参数集（plan 确认） | 3 |
| **CRITICAL 问题（需用户决策）** | **0** |

---

## 一、歧义点（AUTO-RESOLVED — clarify 阶段直接收口）

### CL-001 `expectedSpectraToolCalls` 字段值语义

**出处**：spec.md FR-001 表格 + Key Entities `T158-* Task Fixture` schema（第 115、247 行）

**歧义**：字段示例写 `["impact", "context"]`，但 FR-002 allowedTools 用的是 `mcp__spectra__impact` 全名；两处命名规范不一致，fixture schema 与运行时 tool name 之间需要对齐规则。

**决策**：`[AUTO-RESOLVED: 字段值使用短名（"impact" / "context" / "detect_changes"），W-3 判定逻辑负责做前缀匹配（toolName.endsWith(shortName)），不要求 fixture 字段写全限定名]`

**理由**：fixture 面向人类可读，短名更直观；运行时 `mcp__spectra__impact` 以 "impact" 结尾，endsWith 判定成本为零且不会误判（三个 tool 名均唯一后缀）。plan 阶段在 W-3 判定逻辑子任务中落实。

---

### CL-002 `primaryOracle.checks` 多 check 之间的逻辑关系

**出处**：spec.md W-6 缓解策略（第 327 行）："`primaryOracle.checks.length >= 2`"；Key Entities schema 示例（第 243-246 行）：`"checks": [{ "cmd": ..., "mustPass": true }]`

**歧义**：spec 要求 ≥ 2 个 check，但未说明多个 check 是 AND（全部 mustPass=true 才 PASS）还是 OR（任一通过即 PASS）。`mustPass` 字段已存在但与 task 级别的 PASS 判定关系不明确。

**决策**：`[AUTO-RESOLVED: 多 check 采用 AND 语义——所有 mustPass=true 的 check 必须全部通过，task 才记为 PASS；mustPass=false 的 check 仅警告不阻断]`

**理由**：AND 语义更严格，与"缓解 oracle false positive"的目标一致（一个 check 通过另一个 check 不通过，说明 patch 有副作用，应判 FAIL）。plan 阶段在 oracle runner 子任务中落实。

---

### CL-003 bootstrap 1000 resample — 是否需要调整

**出处**：spec.md FR-004（第 154 行）："`bootstrap-ci.mjs`（1000 resample）"

**歧义**：spec 直接引用了 1000 resample，但 N=3 × 6 task = 18 sample 场景下，1000 resample 是否过多（CPU 浪费）或过少（CI 不收敛）未分析。

**发现**：查阅 `scripts/lib/bootstrap-ci.mjs`（第 57 行）：`b = 1000` 是库的默认值，与 spec 引用一致；该库已有 deterministic rng 注入接口，测试友好；注释已标注"N=5 时 CI 偏窄是 percentile method well-known issue"。

**决策**：`[AUTO-RESOLVED: 保持 1000 resample 默认值，不调整——与现有库默认对齐，18 sample × 1000 resample 计算时间 < 10ms，成本可忽略；CI 偏窄风险已在 W-1 缓解策略中用文字说明处理]`

---

## 二、待 plan 阶段决策的项

### PL-001 Task 数量：4 还是 6 个？

**出处**：spec.md FR-001（第 109 行）："4-6 个新 T158-* fixture"；US-1 验收场景（第 43 行）："6 个 T158-* task fixture"；US-3（第 65 行）："4-6 个新 task fixture"；US-4（第 79 行）："6 task × N=3 重测的 90 次运行"

**现状**：US-1 和 US-4 均以 "6" 为基准做成本和结构设计（90 次 = 3 cohort × 6 task × N=3），而 FR-001 保留了 "4-6" 的弹性区间。

**建议**：plan 阶段锁定为 **6 个**（与 US-1/US-4 的 90 次计算对齐），理由：
- 更大 task 样本改善统计功效（W-1）
- 6 task 在 NFR-001 成本估算中已包含（3 cohort × 6 task × N=3 × $0.30 ≈ $16）
- 若第 5-6 个 task 设计有难度，plan 可降为 5 个（留 1 个缺口），但不应低于 4 个

**处理阶段**：plan — task fixture 设计子任务

---

### PL-002 `projectRoot` 如何传入 MCP server

**出处**：spec.md FR-002（第 130 行）："MCP server 的 `projectRoot` MUST 指向 worktree 内 target 项目"

**歧义**：spec 只说"指向 worktree 内 target"，但未说明 projectRoot 通过什么机制传入：
- 方案 A：MCP server **启动时**通过 CLI 参数传入（`--mcp-config` JSON 中 `args: ["--projectRoot", "/path/to/target"]`），server 固定服务一个 projectRoot
- 方案 B：每次 **tool call 时**通过工具参数传入（每次调用 impact/context 时携带 `projectRoot` 字段），server 无状态

**影响**：方案 A 需要为每个 task 生成不同的 `.mcp.json`（micrograd 和 nanoGPT 各一份）；方案 B 需要确认 spectra MCP server tool schema 支持 projectRoot 参数。

**处理阶段**：plan — FR-002 MCP pull 接入子任务；需 plan 作者查阅 spectra MCP server 当前 tool schema 后决定

---

### PL-003 `spectra-push` cohort 注入的 spec.md 来自哪里

**出处**：spec.md FR-003 表（第 143 行）："spec.md 注入 system prompt（12 KB cap）"

**歧义**：push 模式注入的是 micrograd/nanoGPT 的 Spectra 分析输出（graph 摘要），还是 F158 本身的 spec.md？这两者内容差别极大，影响实验可重复性。

**背景**：Sprint 3 Phase 5 已有 spectra-push 实现，对照组直接复用现有 `eval-task-runner.mjs` spectra-push case；现有实现的注入内容 plan 阶段需确认并固化（避免与 Sprint 3 不同导致结果不可比）。

**处理阶段**：plan — FR-003 三对照组子任务；复用 Sprint 3 实现前须 review 其 system prompt 构成

---

### PL-004 `eval-task-fixture-check.mjs` 是否已存在

**出处**：spec.md FR-001（第 119 行）、US-3（第 69 行）、SC-001（第 338 行）均引用该脚本

**歧义**：spec 多次引用 `eval-task-fixture-check.mjs`，但未注明该脚本是现有脚本还是需要新建。该脚本在 SC-001 验收信号中是机器验证依赖。

**处理阶段**：plan — 前置检查任务；plan 作者需 `ls scripts/eval-task-fixture-check.mjs` 确认存在性，若不存在则作为 FR-001 的前置子任务新建

---

## 三、跨制品依赖（Plan 阶段须解析）

### DEP-001 T1-T4 历史数据路径

**出处**：spec.md FR-001（第 114 行）："以 T1-T4 历史数据作为难度参考"

**未定义**：spec 引用 "T1-T4 历史数据" 但未给出路径。根据 `specs/147-...` 命名惯例，这些 fixture 可能在 `specs/147-competitor-evaluation-platform/research/task-fixtures/T{1-4}/` 或 `tests/baseline/tasks/T{1-4}/`，但两处都不确定是否入库（CLAUDE.local.md 明确"Task fixture 不入库"）。

**风险**：若 T1-T4 fixture 未入库，难度校准依据缺失，plan 阶段须决定是否从 `~/.spectra-baselines/` 重建，或通过文档记录历史 pass rate 替代。

**处理阶段**：plan — fixture 设计前置

---

### DEP-002 Sprint 3 `eval-task-runner.mjs` 现有 control / spectra-push case 状态

**出处**：spec.md FR-003（第 142 行）："复用的现有实现 — `eval-task-runner.mjs` control case / spectra-push case"

**未定义**：spec 假设这两个 case 已在 `scripts/eval-task-runner.mjs` 中实现，但未验证；若脚本不存在或 case 定义不同，FR-003 的三对照组并行逻辑需要更多实现工作。

**处理阶段**：plan — FR-003 前置检查；`grep SUPPORTED_TOOLS scripts/eval-task-runner.mjs` 确认现有枚举值

---

## 四、数值参数集（Plan 阶段确认）

| # | 参数 | Spec 当前值 | Plan 阶段决策依据 |
|---|------|------------|-----------------|
| P-1 | task fixture 数量 | 4-6 个（US-1/4 以 6 计） | 见 PL-001；建议锁定 6 |
| P-2 | 重测次数 N | N=3 | 已收口；与 Sprint 3 对齐，bootstrap 在 N=3 下库已支持（N≥3 检测） |
| P-3 | bootstrap resample 次数 b | 1000 | 已收口（CL-003）；与库默认值对齐 |
| P-4 | spec.md push 注入 token cap | 12 KB | spec 明确写入；plan 阶段核实 Sprint 3 实际注入量是否与此一致 |
| P-5 | 统计显著性阈值 | lift ≥ 5pp 且 CI 下界 > 0 | 已收口；spec W-1 明确，verify 不强制 lift 必须达到 |
| P-6 | 成本缓冲系数 | 1.5x | 已收口；spec NFR-001 明确 |

---

## 五、已收口项确认（不重复展开）

以下内容 spec 已明确收口，clarify 阶段不再开启：

- MCP pull 技术可行性（spike 已证，spike-claude-print-mcp.md）
- task target 选型（micrograd / nanoGPT，非 SWE-Bench docker）
- 工具栈（Node-only，不引入 Python/Docker）
- 评分方式（functional oracle，不靠 LLM judge）
- cohort 之间 prompt 主体一致（仅 grounding 注入方式不同）
- §6 报告由人工撰写（非自动生成）
- schema 1.2 向后兼容策略（新字段可 null）
- verify FAIL 唯一判定条件（技术性失败，lift = 0 不构成 FAIL）
