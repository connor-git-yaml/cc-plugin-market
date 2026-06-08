---
feature: 176
title: SWE-Bench Verified 5-cohort 横向对比（M7 最终交付）
branch: claude/suspicious-sinoussi-d41c88
created: 2026-06-08
status: Draft
budget: ~11d + ~$30-50 实付（仅 SiliconFlow jury token）+ ChatGPT Pro / Claude Max 周配额
milestone: M7（F176 = 最后一个 feature；ship 即 M7 完成）
design_source: docs/design/milestone-M7-spectra-mcp-productization.md §3 F176
report_anchors_verified: research/report-anchors.md（2026-06 核对，3 处口径修正）
---

# Feature 176 — SWE-Bench Verified Workflow 横向对比

## 背景与目标

M7 主线把 Spectra 从"AST spec 生成器"产品化为"Claude Code 子代理可开箱即用的 MCP 代码智能层"。F170a/F170c 修复了 MCP 真实可用性（plugin namespace 调用 + response next-step hint），F177-F181 收口了统一契约 / telemetry / byte-stable 落盘 / import-resolver 单一权威。**F176 是验收这一系列改进的最终横向评测 + publish-grade 报告交付**。

本 Feature 在 **SWE-Bench Verified 子集** 上，以 5 个 cohort（产品形态）跑同一批 task，用 cross-LLM judge jury 评分，得到组间 **directional**（非绝对）pass-rate 对比与 token 效率对比，证明"Spec Driver + Spectra MCP（修复后真实开箱即用）"相对裸 baseline 与同类框架（SuperPowers / GStack）的提升，并产出 M7 收官报告。

### 核心 Hypothesis

- **H₀**：cohort 3（spec-driver-spectra-mcp）的 Verified pass rate 与 cohort 1（baseline-claude）无显著差异（directional lift < 1.5×）。
- **H₁**：cohort 3 directional lift ≥ 1.5×（相对 cohort 1），且平均 mcp_tool_calls ≥ 2/task（证明 MCP 真实被调用而非"注册未触发"）。

### 关键前提（已收口，不在本 Feature 重新决策）

| 决策 | 结论 | 依据 |
|------|------|------|
| 实验设计（cohort / 数据集 / N / driver / judge）| 固定 | milestone §3 F176 |
| cohort 3 的 Spectra MCP 版本 | **必须含 F177-F181**（master `5e8b9c8` 已全 ship）；走 dev mode（tsx）或重发含最新改动的 npm 版，**禁止用 npm 上不含 F177-F181 的旧 binary（4.2.0=F170b 发）** | research / memory: project_spectra_cli_volta_blocker |
| 评测凭据 | 订阅优先：driver=Codex OAuth / judge1=Claude Max OAuth（边际 $0）；judge2/3=SiliconFlow GLM/Kimi（唯一真实扣费）| CLAUDE.local.md 评测凭据策略 |
| 绝对 pass rate 可比性 | **不可比**（2026 业界共识，OpenAI 2026-02-23 停报 Verified）→ 全程 internal-cohort-only，只做 directional 对比 | research/report-anchors.md §6 |
| 复用既有设施 | worktree / oracle / judge jury 复用 SWE-Bench-Lite（F158-F169）设施，仅**数据集换 Verified** | milestone §3 |

### 实验设计（固定，来自 milestone §3）

| Cohort | id | 配置 | 修复后产品形态 |
|--------|----|------|--------------|
| 1 | `baseline-claude` | 裸 Claude Code（model=opus-4-7）| 既有 |
| 2 | `spec-driver` | + Spec Driver workflow（plugin 4.1.0+）| F162 Phase 0 后 |
| 3 | **`spec-driver-spectra-mcp`** ← 核心 | + Spec Driver + Spectra MCP（F170a+F170c+F177-F181 后真实开箱即用）| **本 Feature 验收对象** |
| 4 | `SuperPowers` | + SuperPowers framework | 既有 |
| 5 | `GStack` | + GStack 23 skills | 既有 |

- **数据集**：SWE-Bench Verified 子集 10 task（从可解性范围内取）。
- **Sample size**：5 cohort × 10 task × N=3 = **150 runs**。
- **Driver**：claude-opus-4-7。**Judge**：claude-opus-4-7 + GLM + Kimi（3 judge majority）。

---

## User Scenarios & Testing

> 整个 Feature 即 E2E。以下 User Story 即 milestone §3 的 4 个 E2E test_scenario（命名"用户故事: …"），按优先级排序，每个可独立测试。

### User Story 1 — 5-cohort smoke 全 finalize（Priority: P1）

研究者希望在投入全量 150 runs 前，先以最小样本（5 cohort × 1 task × N=1 = 5 runs）确认全部 5 个 cohort 的评测管线都能跑通并 finalize，且 cohort 3 真实调用了 Spectra MCP —— 这是后续所有结论的地基。

**Why this priority**：若任一 cohort 管线 broken，或 cohort 3 `mcpToolCallCount=0`（F170a 修复未生效），则全量跑批是浪费 $ 与配额；smoke 是成本闸门。

**Independent Test**：`node scripts/eval-task-runner.mjs --task <verified-task-1> --tool <cohort> --repeats 1` 对 5 个 cohort 各跑 1 次，检查 5/5 finalize + cohort 3 fixture 含 `mcpToolCallTrace.callCount > 0`。

**Acceptance Scenarios**：
1. **Given** spectra MCP 走含 F177-F181 的 dev/最新版 + spec-driver 4.1.0 + SuperPowers/GStack wrapper 就绪，**When** 跑 5 cohort × 1 task × N=1，**Then** 5/5 runs `status='success'`（非 `'broken'`）。
2. **Given** smoke 完成，**When** 解析 cohort 3 fixture，**Then** `mcpToolCallCount > 0`（确认 F170a 修复生效；否则标 `W-3-FLAGGED` 并阻断全量跑批）。
3. **Given** 任一 cohort `status='broken'`，**When** smoke 汇总，**Then** 阻断全量跑批并在 trace 记录 broken 原因，不进入 US-2。

### User Story 2 — cohort 3 MCP 链式调用显著高于 cohort 2（Priority: P1）

研究者希望验证 F170c 的 response next-step hint 确实诱导 cohort 3 比 cohort 2 多发起 ≥1 次链式 MCP 调用（cohort 2 无 MCP，应为 0），证明 MCP 层在真实 workflow 中被有效使用。

**Why this priority**：mcp_tool_calls 是 cohort 3 区别于 cohort 2 的**机制变量**；若 cohort 3 几乎不调 MCP，则任何 pass-rate 差异无法归因于 Spectra grounding，主结论失效。

**Independent Test**：全量跑后解析 cohort 2 vs cohort 3 的 mcp call sequence，比较平均 call count。

**Acceptance Scenarios**：
1. **Given** 全量 150 runs 完成，**When** 解析每个 cohort 3 run 的 mcp call trace，**Then** cohort 3 平均 `mcp_tool_calls ≥ 2/task`。
2. **Given** cohort 2（无 Spectra MCP），**When** 解析其 trace，**Then** cohort 2 平均 mcp call ≈ 0，且 cohort 3 平均 > cohort 2。

### User Story 3 — cohort 3 vs cohort 1 directional lift ≥ 1.5×（Priority: P1）

研究者希望得到 cohort 3（修复后产品形态）相对 cohort 1（裸 baseline）在 Verified 上的 directional pass-rate lift，验证 M7 产品化改进的实际价值（M7-SC-006）。

**Why this priority**：这是 M7 验收的核心成功标准；falsification 路径明确，无论结论正负都如实写。

**Independent Test**：聚合各 cohort pass rate（含 bootstrap 95% CI），计算 `lift = cohort3.passRate / cohort1.passRate`。

**Acceptance Scenarios**：
1. **Given** 全量 150 runs + jury 评分完成，**When** 计算 aggregate pass rate per cohort，**Then** 输出每 cohort `{passRate, bootstrapCI95}`。
2. **Given** lift 已算，**When** lift ≥ 1.5×，**Then** US-3 通过，报告 §结论确认 M7-SC-006 达成。
3. **Given** lift < 1.5×（falsification），**When** 写报告，**Then** 在报告 §10.6 如实写"M7 修复后 Spectra MCP 在 Verified 上 lift 不足 1.5×，需重新评估产品定位"，**不藏、不重跑挑数据**，并在 internal-cohort-only 框架下分析原因（task 难度分布 / MCP 触发率 / judge 一致性）。

### User Story 4 — cohort 3 aggregate ≥ cohort 4（SuperPowers）（Priority: P2）

研究者希望判断 spec-driver-spectra-mcp 是否在 aggregate 上不弱于同类框架 SuperPowers（允许 fixture-level 互有胜负）。

**Why this priority**：相对同类竞品定位是 publish 报告的重要论点，但非 M7 硬验收门（硬门是 US-3）。

**Independent Test**：cohort 3 aggregate vs cohort 4/5 aggregate + fixture-by-fixture 对比表。

**Acceptance Scenarios**：
1. **Given** 全量完成，**When** 比较 aggregate pass rate，**Then** cohort 3 ≥ cohort 4（aggregate）。
2. **Given** aggregate 持平/略低，**When** 看 fixture-level，**Then** 报告如实呈现 fixture-by-fixture 胜负分布，不掩盖。

### Edge Cases

- **某 cohort 的 wrapper 不可用**（SuperPowers/GStack 未装）：smoke 即暴露为 broken，阻断全量；不静默跳过。
- **cohort 3 MCP server 启动失败**（volta blocker → status:failed）：走 dev mode（tsx）绕开；smoke 第 2 条断言会捕获 `mcpToolCallCount=0`。
- **judge jury 分歧**（3 judge 无 majority）：jury 只影响质量分，不影响 pass/fail；按既有规则（多数决；平票记 abstain 并标注）。
- **oracle 无法执行**（Verified repo 测试环境缺失 / flaky / 超时）：标 `ORACLE-UNAVAILABLE`，从 pass-rate 分母剔除并在报告计数，**不**用 jury 补判（FR-A-001b）。若某 cohort 的 ORACLE-UNAVAILABLE 比例过高（如 >20%），报告须提示该 cohort lift 可信度下降。
- **N=3 repeat 串扰**：每 repeat 独立 worktree（FR-A-006b）；若检测到跨 repeat 残留 dirty state，该组重跑或标污染。
- **SiliconFlow 余额耗尽**：临时降级为 2-judge（spec 允许，显著性下降，报告标注）；不改回 API key 模式。
- **周配额 ≥60% weekly**：每 6 runs 检查一次；触发则警告 / 询问用户 / 分日跑（不静默续跑烧爆配额）。
- **Verified 任务可解性不足**（import 后 <10 个合格 task）：走 fixture import 退化策略（参照 Lite importer 的 `_DEGRADATION_NOTE`），并记录训练集泄漏增量风险。
- **lift < 1.5×**：见 US-3 场景 3（falsification 如实写）。

---

## Requirements

### Functional Requirements — 评测执行

- **FR-A-001**: 系统 MUST 复用 SWE-Bench-Lite 设施（worktree 准备 / functional oracle / judge jury），仅将数据集替换为 SWE-Bench Verified 子集。
- **FR-A-001b（pass/fail 与 jury 角色分离 — 关键）**: 一个 run 的 **pass/fail 真值（ground truth）MUST 由 functional oracle 决定**（在 worktree 真实执行 Verified task 的 FAIL_TO_PASS / PASS_TO_PASS 测试，`runPrimaryOracle`），**不由 LLM 判定**；US-3/US-4 的 pass rate 与 lift MUST 基于 oracle 结果计算。3-judge jury（FR-A-008）MUST 仅作为**独立质量 / grounding 评分 + inter-rater agreement 信号**叠加层（去 self-judge bias），**MUST NOT** 覆盖或替代 oracle 的 pass/fail。oracle 无法执行（环境缺失 / flaky）的 run MUST 标 `ORACLE-UNAVAILABLE` 并从 pass-rate 分母剔除（在报告如实记录剔除数），**MUST NOT** 用 jury 多数决补判为 pass。
- **FR-A-002**: 系统 MUST 提供 Verified 子集 fixture（10 task），含可解性筛选；候选不足时 MUST 走退化策略并写降级说明（含训练集泄漏增量风险评估）。
- **FR-A-002b（预注册 — 防 falsification 规避，关键）**: 在跑首个全量 run **之前**，系统 MUST 将 10 个 task id、筛选规则（repos / min-date / max-patch-files）、random seed 冻结写入入库的 `verification/preregistration.md`（含冻结时的 git commit）。全量阶段 MUST 跑满全部 10 task × 5 cohort × N=3 = 150 runs，**MUST NOT** 在跑后剔除/替换 task 来影响 lift；唯一允许的剔除是 `ORACLE-UNAVAILABLE`（FR-A-001b，且如实计数）。run 级失败重跑 MUST 设上限（每 (task,cohort,repeat) 最多 1 次因 infra error 重跑，且记录原因）；任何对预注册的偏离 MUST 进入报告 falsification 附录。
- **FR-A-003**: 系统 MUST 支持 5 个 cohort 的 driver 派发：`baseline-claude`(control) / `spec-driver` / `spec-driver-spectra-mcp` / `SuperPowers` / `GStack`。**confound 控制的精确边界**：所有 cohort MUST 用**逐字一致的 task statement + 同一 oracle**；cohort 之间合法差异**仅**为 workflow wrapper / MCP server 注册 / skill 装载（这就是被测的 treatment 本身）。
- **FR-A-003b（prompt 审计 + 因果口径）**: 系统 MUST 保存每个 cohort 的 effective driver prompt（落 trace + hash），报告 MUST 附 cohort 间 prompt diff。报告 MUST 将 lift 表述为 **product-bundle directional 效应（Spec Driver + Spectra MCP 整体），不是 Spectra MCP 单因果效应**（cohort 2→3 的增量才更接近 MCP 边际贡献，亦只作 directional）。
- **FR-A-004**: cohort 3 的 Spectra MCP MUST 以含 F177-F181 改动的版本运行（dev mode tsx 或重发版），并以 **plugin namespace**（`mcp__plugin_spectra_spectra__*`，sub-agent 调用形态）注册；系统 MUST 在 fixture 记录所用 spectra 版本/commit 以供审计。
- **FR-A-004b（版本门禁可证伪 — 关键）**: 仅记录 commit 不足以防"误用旧 binary"。smoke MUST 主动验证运行中的 spectra **含 F177-F181**：检查其 commit 是否包含 F177-F181 的可探测 marker（如 F177 统一 MCP 响应契约字段 / F181 单一 import-resolver 行为 / 版本 ≥ 含这些改动的最小版本，或 commit 是 master `5e8b9c8` 的祖先链成员）。**验证失败 MUST hard-fail（阻断 smoke 与全量），MUST NOT 仅警告**。旧 binary 即便能产生 MCP call 也 MUST 被此门禁挡下（不能只靠 `mcpToolCallCount>0`）。
- **FR-A-005**: 系统 MUST 对每个 cohort 3 run 采集 `mcpToolCallTrace`（toolName / callCount / firstCallTurn / totalDurationMs）；`callCount=0` 的 run MUST 标 `W-3-FLAGGED`。
- **FR-A-006**: 系统 MUST 以 N=3 repeats 跑全量（5×10×3=150），每 run 落 fixture 到含 **repeatIndex** 的独立路径 `tests/baseline/tasks/<task>/<cohort>/r<repeatIndex>/...`（不入库）。
- **FR-A-006b（repeat 隔离 — 防串扰）**: 每个 (task, cohort, repeatIndex) run MUST 在**独立 worktree**（fresh clone 或 reset 到 startCommit 的干净状态）执行，**MUST NOT** 跨 repeat 复用同一 worktree / patch / cache / .mcp.json 残留状态；验证 MUST 检查 3 次 repeat 无共享 dirty state（独立性前提）。
- **FR-A-007**: 系统 MUST 提供 smoke 模式（5 cohort × 1 task × N=1）作为全量前的成本闸门，smoke 任一 broken 或 cohort3 mcpCallCount=0 MUST 阻断全量。
- **FR-A-008**: 系统 MUST 用 3-judge jury（opus + GLM + Kimi，majority）做质量/grounding 评分（角色见 FR-A-001b）；judge 凭据 MUST 遵循订阅优先策略（driver/Claude judge 走 OAuth，GLM/Kimi 走 SILICONFLOW_API_KEY）。
- **FR-A-008b（judge blinding — 去偏）**: judge 输入 MUST 仅含 issue 描述、patch、test/oracle evidence，**MUST 隐藏 cohort label / tool 名 / agent 身份 / repeatIndex / mcp trace 等元数据**（复用既有 `anonymizeFixture`），并记录 blinding hash 供审计。理由：judge1=claude-opus 与 driver 同源，盲化可降低对特定 cohort 叙述/风格的偏好（该偏好对各 cohort 虽大体一致、不直接偏置 directional，但盲化进一步保护边界样本）。
- **FR-A-009**: 跑批 ≥30 runs 时系统 MUST 每 6 runs 检查周配额；≥60% weekly MUST 警告并征询用户（继续 / 分日跑）。

### Functional Requirements — 度量与统计

- **FR-B-001**: 系统 MUST 计算每 cohort aggregate pass rate + bootstrap 95% CI。
- **FR-B-002**: 系统 MUST 计算 directional lift = cohort3.passRate / cohort1.passRate（不声称绝对可比）。
- **FR-B-003**: 系统 MUST 采集**第二指标 token-per-completed-task**（每个 oracle-pass 的 task 平均消耗 token），分 cohort 报告；以对标 Augment 3× / Anthropic -98.7% 量级（仅作 internal-cohort-only directional 参照，不声称外部可比）。
- **FR-B-003a（token 数据来源 — 防纸面数字）**: token MUST 优先取自 driver 的 `claude --print --output-format stream-json` usage 字段（OAuth 下该 CLI 仍输出 input/output token usage）。MUST 明确定义计入口径（input + output total；cache-read 可能为 null，按既有已知偏差标注）。某 run 无法取得 usage 时 MUST 标 `TOKENS-UNAVAILABLE` 并从该指标分母剔除（如实计数），**MUST NOT** 静默填 0 或仅用 tokenizer 估算冒充实测；若确需估算 MUST 显式标 `estimated` + 误差说明。报告引用的口径 MUST 与 FR-C-004 限定（code-execution-with-MCP / 相对提升）一致，不与外部绝对值混用。
- **FR-B-004**: 系统 MUST 提供 fixture-by-fixture（task × cohort）pass/fail 明细表。

### Functional Requirements — 报告交付（含锚点增强，口径以 research/report-anchors.md 为准）

- **FR-C-001**: 系统 MUST 新建 `specs/147-competitor-evaluation-platform/PUBLISH-REPORT-M7.md`（publish-grade M7 摘要）。
- **FR-C-002**: 系统 MUST 在 `specs/147-.../PUBLISH-REPORT.md` §11 增加 M7 章节。
- **FR-C-003（锚点·第二指标）**: 报告 MUST 含 token-per-completed-task 章节。引用 Augment 3× / Anthropic -98.7% 时 MUST 内联 FR-C-004 的限定口径（-98.7% = code-execution-with-MCP 特定场景，非通用），且 MUST 标 internal-cohort-only —— 防止 token 章节脱离 FR-C-004 口径变成误导性绝对对比。
- **FR-C-004（锚点·业界参照）**: 报告 MUST 引用业界锚点并**全部标 internal-cohort-only 不声称绝对可比**：
  - Augment 70.6%（Sonnet 4 + Context Engine，single-pass）
  - Anthropic **-98.7%**（**code-execution-with-MCP**，~150k→~2k tokens；**不得**误标为通用 context editing）
  - RepoGraph ICLR2025 **+32.8% 平均相对**提升（plug-in，4 框架均值；**不得**写成 +30 绝对百分点）
  - RANGER · CGM · CodeRAG —— graph-RAG > embedding-RAG（复杂 repo 任务）学界共识
- **FR-C-005（锚点·Serena peer）**: 报告 MUST 含 Serena peer 对比，框架为 **Spectra（纯 AST，免 build，对未配置/编译失败工程可工作）vs Serena（LSP，需可索引/配置正确工程）**（主体方向以 report-anchors.md §5 为准，不得写反）。
- **FR-C-006（锚点·drift 定性栏）**: 报告 MUST 含各 cohort 的 spec-drift / living-doc 能力定性栏，并标注为 M8 roadmap（本 Feature 不量化）。
- **FR-C-007（锚点·Codex review 分类）**: 报告中的 Codex 对抗审查结论 MUST 按"**两模型重叠（高置信）+ 各自独有（盲点）**"分类呈现。
- **FR-C-008（锚点·leakage 背景）**: 报告 MUST 含 leakage 背景段（OpenAI 2026-02-23 停报 Verified / 59.4% flawed test / harness 10-20pp 摆动），论证 internal-cohort-only 立论。
- **FR-C-009（falsification）**: 若 US-3 lift<1.5×，报告 MUST 在 §10.6 如实记录并重评定位，禁止隐藏/挑数据/选择性重跑。

### Functional Requirements — Dogfooding 工具反馈（收尾必附）

- **FR-D-001**: deliverable report MUST 附「工具使用反馈」一节，对 **Spec Driver**（评测+报告类需求的 5 阶段编排 / gate / 产物顺手度）与 **Spectra MCP**（cohort 3 真实调用 17 工具时的连接 / 工具缺失 / 调用报错 / namespace / 返回字段缺失 / 缺 next-step / impact·graph·fuzzy 准确性）逐项如实记录。
- **FR-D-002**: 反馈 MUST 覆盖四维度（可用性 / 信息完整性 / 流程顺畅度 / 结果准确性），未遇问题写"无"。
- **FR-D-003**: 真实问题 MUST 转化为 M8 或后续 Fix 候选，写入入库的 `verification/m8-fix-candidates.md`（每条含 问题 / 所属维度 / 建议去向 M8|Fix）；**MUST NOT** 在 F176 内顺手改 Spectra / Spec Driver 工具源码。

### Constraints（关键约束）

- **CON-1**: 评测数据 / fixture / auto-report **不入库**（CLAUDE.local.md：tasks/repeats fixture .gitignore）；仓库只 track manual report + spec/verification。
- **CON-2**: self-dogfood 再生的 `specs/**/src.spec.md` MUST 排除出 commit（用显式路径 add，**禁止 `git add -A`**）。
- **CON-3**: 凭据走订阅 OAuth，**不**以"需 ANTHROPIC_API_KEY + OPENAI_API_KEY"为前提；SILICONFLOW_API_KEY MUST 在 `.env.local`。
- **CON-4**: 不重新设计 cohort / 数据集 / N（milestone §3 已固定）。

### Key Entities

- **Cohort**：一种被测产品形态（id + driver 派发策略 + 注册的 MCP/skill）。5 个。
- **Verified Task fixture**：SWE-Bench Verified 子集单 task（issue + repo@commit + goldPatch + oracle 测试）。10 个，不入库。
- **Run**：(cohort, task, repeatIndex) 一次执行的结构化结果（status / patch / **oracleResult.passed（真值）** / mcpToolCallTrace / tokens（或 TOKENS-UNAVAILABLE）/ jury quality scores / spectraVersion）。150 个。
- **Jury Verdict**：3 judge 对单 run 的**质量/grounding 评分**（anonymized + adversarial）+ inter-rater agreement；**不决定 pass/fail**（pass/fail 见 oracleResult）。
- **PUBLISH-REPORT-M7**：publish-grade 收官报告（入库，manual）。

---

## Success Criteria

### Measurable Outcomes

- **SC-001**（对应 US-1 / M7 smoke 闸门）：5 cohort × 1 task × N=1 smoke = 5/5 `status='success'`，且 cohort 3 `mcpToolCallCount > 0`。
- **SC-001b**（版本门禁，对应 FR-A-004b）：smoke 主动验证 cohort 3 运行的 spectra 含 F177-F181（marker / 祖先链命中）；旧 binary 场景 hard-fail（可用一次"故意挂旧版应被挡下"的负向用例佐证）。
- **SC-002**（对应 US-2）：全量后 cohort 3 平均 `mcp_tool_calls ≥ 2/task`，且 > cohort 2（≈0）。
- **SC-003**（对应 US-3 / M7-SC-006）：pass/fail 取自 functional oracle（FR-A-001b）。**本 SC 的硬性达成项是"报告纪律"**：lift 数值如实呈现（含 bootstrap CI），lift<1.5× 时 §10.6 falsification 段如实写入、不藏不挑数据；lift≥1.5× 则同时确认 M7-SC-006 假设达成。task 集与 run 数符合预注册（FR-A-002b）。
- **SC-004**（对应 US-4）：cohort 3 aggregate（oracle pass rate）≥ cohort 4，附 fixture-by-fixture 明细（允许 fixture-level 互有胜负）。
- **SC-005**（对应 M7-SC-005）：`PUBLISH-REPORT-M7.md` 发布 + `PUBLISH-REPORT.md §11` M7 章节更新，含 FR-C-003..C-008 全部锚点（口径符合 report-anchors.md）。
- **SC-006**（可复核）：deliverable report 含四维度 Dogfooding 工具反馈（FR-D-001..003）；真实问题已转入入库的 `verification/m8-fix-candidates.md`（含每条 问题 / 维度 / 建议去向），reviewer 可逐条核对，非口头声称。
- **SC-007**（可复核）：全程 internal-cohort-only —— 对报告跑禁用词扫描（"SOTA / state-of-the-art / 绝对领先 / 跨实验室可比 / outperforms (无限定)" 等，清单入 `verification/forbidden-claims-checklist.md`），命中数=0 或每处均有 internal-cohort-only 限定；附人工 review checklist 勾选。
- **SC-008**：交付物只 commit manual report + spec/verification；fixture/auto-report/src.spec.md 未入库（`git status` + CON-1/CON-2 验证，显式路径 add）。

---

## Out of Scope

- 重新设计 cohort / 数据集 / sample size（milestone §3 已固定）。
- 修改 Spectra / Spec Driver 工具源码（问题只记录为 M8/Fix 候选）。
- 量化 spec-drift / living-doc（仅定性，标 M8 roadmap）。
- 声称绝对 pass rate 或跨实验室可比（2026 leakage 共识 → 仅 directional）。
- 500+ 大项目 baseline（follow-up，不在本范围）。
