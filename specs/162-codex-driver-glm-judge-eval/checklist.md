# Feature 162 — Implementation Checklist

> Status: ready-for-plan
> Generated at: 2026-05-10

---

## Phase 0 — sub-agent frontmatter 修复（估算 ~4h）

### 代码改动

- [ ] **P0-1** 修改 `plugins/spec-driver/agents/plan.md` frontmatter：`tools` 字段追加 `mcp__spectra__context, mcp__spectra__impact`（FR-001）—— 0.1h —— critical
- [ ] **P0-2** 修改 `plugins/spec-driver/agents/implement.md` frontmatter：`tools` 字段追加 `mcp__spectra__context, mcp__spectra__impact`（FR-002）—— 0.1h —— critical
- [ ] **P0-3** 修改 `plugins/spec-driver/agents/verify.md` frontmatter：`tools` 字段追加 `mcp__spectra__detect_changes, mcp__spectra__impact`（FR-003）—— 0.1h —— critical
- [ ] **P0-4** 修改 `plugins/spec-driver/agents/quality-review.md` frontmatter：`tools` 字段追加 `mcp__spectra__impact, mcp__spectra__context`（FR-004）—— 0.1h —— critical
- [ ] **P0-5** 修改 `plugins/spec-driver/agents/spec-review.md` frontmatter：`tools` 字段追加 `mcp__spectra__impact, mcp__spectra__context`（FR-005）—— 0.1h —— critical
- [ ] **P0-6** 修改 `contracts/release-contract.yaml`：`spec-driver.version` 从 `4.0.0` 升至 `4.1.0`（FR-007）—— 0.1h —— critical
- [ ] **P0-7** 运行 `npm run repo:sync`，同步 plugin 包装产物（FR-006）—— 0.2h —— critical
- [ ] **P0-8** 运行 `npm run release:sync` + `npm run release:check`，确认 spec-driver 版本一致（FR-006, FR-007）—— 0.2h —— critical
- [ ] **P0-9** 执行 `claude plugin update spec-driver`（或等价命令），将新版 4.1.0 安装到 `~/.claude/plugins/cache/`（FR-006, EC-007）—— 0.2h —— critical

### 测试

- [ ] **P0-T1** 运行全量 `npx vitest run`，确认退出码为 0，无新增 skip/todo，无测试回归（FR-008, SC-001）—— 0.5h —— critical
- [ ] **P0-T2** 重跑 Smoke D Test 3：以修复后的 frontmatter 调用 plan sub-agent，验证 `mcp__spectra__context` 返回 `TOOL_CALL_OUTCOME: success`（非 `tool-not-available`）（FR-008, AC-2, SC-001）—— 1.0h —— critical

### 文档同步

- [ ] **P0-D1** 将 Smoke D Test 3 重测结果（含实际加载 plugin 路径 + 版本号 + MCP 调用成功 trace）落回 `specs/161-fix-workspace-replace-replaceall/verification/sub-agent-mcp-test.md` 的"Test 3: Phase 0 修复后重测"章节（FR-008, SC-001）—— 0.5h —— critical

### 验证

- [ ] **P0-V1** 运行 `npm run repo:check`，确认仓内产物无不一致（FR-006）—— 0.1h —— critical
- [ ] **P0-V2** 落地 Codex 对抗审查 artifact `specs/162-codex-driver-glm-judge-eval/codex-reviews/phase-0.md`（含 critical/warning/info 三档 finding 列表 + 主线程裁决 + 修复 commit 引用）；critical 项 = 0 方可进入 Phase A/B（FR-038, SC-005）—— 0.5h —— critical

---

## Phase A — callExecutor 多 backend 重构（估算 ~12h）

> 依赖：Phase 0 全部通过。Phase A 与 Phase B 可并行。

### 代码改动

- [ ] **PA-1** 新建 `scripts/lib/llm-backend-dispatcher.mjs`：提取 `parseJudgeBackend`（来自 `eval-judge-jury.mjs` 第 91-135 行）及 codex CLI spawn 实现（第 347-384 行）为共享模块；导出 `dispatchBackend(model, prompt, opts)`（FR-013）—— 2.0h —— critical
- [ ] **PA-2** 在 `scripts/lib/llm-backend-dispatcher.mjs` 实现 `MODEL_ALIASES` 常量（别名映射）和 `normalizeModelId(id)` 函数（normalize 规则：剥离 backend prefix、vendor org prefix、case-fold、别名映射）；导出供 hard-fail 检查使用（FR-027）—— 1.0h —— critical
- [ ] **PA-3** 重构 `scripts/eval-task-executor.mjs` 的 `callExecutor` 函数，从当前 SiliconFlow-only 改为多 backend dispatch（调用 PA-1 的 `dispatchBackend`），支持 `siliconflow:` / `openai:` / `claude-cli:` / `codex:` 四种前缀（FR-010）—— 1.5h —— critical
- [ ] **PA-4** 修改 `DEFAULT_EXECUTOR_MODEL` 常量从 `'Pro/zai-org/GLM-5.1'` 改为 `'codex:gpt-5.5'`；支持 `SPECTRA_EVAL_EXECUTOR` 环境变量覆盖（FR-011）—— 0.3h —— critical
- [ ] **PA-5** 在 `callExecutor` 的 codex backend 路径中，将 `model_reasoning_effort` 设为 `medium`（非 `high`），与现有 jury 的 `high` 分开（FR-012）—— 0.2h —— critical
- [ ] **PA-6** 在 `callExecutor` 实现 retry 决策矩阵：transient 错误最多 retry 1 次；配额错误（HTTP 429 / quota_exceeded / rate_limit_exceeded）禁止 retry 立即 fail；`finishReason=length` 截断标记 `partial=true` 并 fail；JSON/schema 无效记录 `error.rawResponse` 并 fail（FR-014）—— 2.0h —— critical
- [ ] **PA-7** 在 `eval-mcp-augmented.mjs`、`eval-judge-jury.mjs`、`callExecutor` 共用启动入口实施 self-judge hard-fail 检查：调用 PA-2 的 `normalizeModelId` 比较 driver 与所有 jury judge，任一相同则抛出配置错误并 exit 非零；错误信息含原始字符串 + normalize 后字符串（FR-027）—— 1.5h —— critical
- [ ] **PA-8** 确认 `scripts/lib/llm-pricing.mjs` 的 PRICING_TABLE 包含 `codex:gpt-5.5` executor 条目（调研 §4.7 确认已存在，执行验证即可）（FR-016）—— 0.2h —— 非 critical

### 测试

- [ ] **PA-T1** 新增 8 个 vitest unit case，覆盖 4 backend × {success / error / token-usage 解析} 矩阵：siliconflow/openai/claude-cli/codex 各 2 case，验证返回 schema 字段（`text / promptTokens / completionTokens / finishReason`）（FR-015, SC-002）—— 2.0h —— critical
- [ ] **PA-T2** 新增至少 5 组 self-judge hard-fail vitest unit case，覆盖 FR-027 要求的场景 (a)(b)(c)(d)(e)（FR-027, SC-002）—— 1.5h —— critical
- [ ] **PA-T3** 以 Codex driver 重跑 25 个既有 task fixture（`tests/baseline/tasks/`），验证输出 schema 字段集合 byte-stable（字段名、类型、nullable 规则与 GLM 产物一致，内容可不同）（FR-015, AC-3, SC-002）—— 1.0h —— critical
- [ ] **PA-T4** 运行全量 `npx vitest run`，确认零回归（FR-015, SC-002）—— 0.5h —— critical

### 文档同步

- [ ] **PA-D1** 在 `scripts/eval-judge-jury.mjs` 中更新 `parseJudgeBackend` 注释，标注"共享实现已迁移至 `scripts/lib/llm-backend-dispatcher.mjs`"（FR-013）—— 0.2h —— 非 critical

### 验证

- [ ] **PA-V1** 运行 `npm run build`，确认 TypeScript 类型检查零错误（FR-013）—— 0.2h —— critical
- [ ] **PA-V2** 落地 Codex 对抗审查 artifact `specs/162-codex-driver-glm-judge-eval/codex-reviews/phase-a.md`；critical 项 = 0 方可进入 Phase C（FR-038, SC-005）—— 0.5h —— critical

---

## Phase B — GLM judge calibration（估算 ~4h + LLM 调用 ~$5）

> 依赖：Phase 0 全部通过。Phase B 与 Phase A 可并行。

### 代码改动

- [ ] **PB-1** 修改 `scripts/eval-judge-jury.mjs` 的 `DEFAULT_JUDGES`：将 `codex:gpt-5.5` 替换为 `siliconflow:Pro/zai-org/GLM-5.1`；结果为 `[claude-cli:claude-opus-4-7, siliconflow:Pro/zai-org/GLM-5.1, siliconflow:Pro/moonshotai/Kimi-K2.6]`（FR-020）—— 0.3h —— critical
- [ ] **PB-2** 在 `DEFAULT_JUDGES` 定义处增加注释，明确说明"driver=codex:gpt-5.5 时 jury 不含 GPT-5.5（self-judge 禁忌）"（FR-021）—— 0.1h —— critical
- [ ] **PB-3** 在 `scripts/lib/` 实现零依赖 Pearson correlation 计算函数（`pearsonCorrelation(xs, ys)`），与 SciPy 结果误差 ε ≤ 1e-6（FR-023）—— 1.0h —— critical
- [ ] **PB-4** 确定 5 个固定 calibration fixture 子集（分层抽样：覆盖 pass / fail / 拒答 + 至少 2 种 task 类型），将 fixture id 列表写入 `specs/162-codex-driver-glm-judge-eval/calibration-fixture-list.json`（FR-022）—— 0.5h —— critical

### 测试

- [ ] **PB-T1** 用 5 个固定 calibration fixture 同时跑 GLM judge 和旧 Codex judge，计算 oracle pass rate IoU；验证 IoU ≥ 0.7（FR-022, SC-003）—— 1.0h —— critical
- [ ] **PB-T2** 计算 GLM judge quality score 与 oracle pass rate 的 Pearson correlation；验证 ≥ 0.6（FR-023, SC-003）—— 0.5h —— critical
- [ ] **PB-T3** 计算 GLM judge surface refusal detection IoU；验证 ≥ 0.5（FR-024, SC-003）—— 0.5h —— critical
- [ ] **PB-T4** 若任一阈值未达标：调整 `buildAdversarialPrompt` rubric，最多重测 2 轮；若 2 轮后仍未达标，启用回退方案（2-judge：Opus + Kimi + fail-closed tie-break），在注释中记录触发回退的指标、时间、2 轮调整的 commit hash（FR-025, EC-003, SC-003）—— 1.5h —— critical
- [ ] **PB-T5** 运行全量 `npx vitest run`，验证 rubric 微调后零回归（FR-026, SC-003）—— 0.3h —— critical

### 文档同步

- [ ] **PB-D1** 若启用回退方案，在 `scripts/eval-judge-jury.mjs` jury 主模块注释中记录回退原因 + 实测数据（FR-025）—— 0.3h —— 非 critical（仅回退路径触发）

### 验证

- [ ] **PB-V1** 落地 Codex 对抗审查 artifact `specs/162-codex-driver-glm-judge-eval/codex-reviews/phase-b.md`；critical 项 = 0 方可进入 Phase C（FR-038, SC-005）—— 0.5h —— critical

---

## Phase C — SWE-Bench-Lite 450 runs eval（估算 ~16h + LLM 调用 ~$15）

> 依赖：Phase 0 + Phase A + Phase B 全部通过。

### 代码改动

- [ ] **PC-1** 在 `scripts/eval-mcp-augmented.mjs` 的 `parseArgs()` 中新增 `--max-runs-per-day N` CLI 参数，默认值待 pilot 配额评估后确定（FR-032）—— 0.5h —— critical
- [ ] **PC-2** 实现 quota state store（`~/.cache/spectra/eval-quota/feature-162.json`）：schema `{ date, timezone, runs, run_ids, updatedAt }`；日切边界重置 counter（保留 `feature-162-history.jsonl` 7 天历史）（FR-032）—— 1.5h —— critical
- [ ] **PC-3** 实现 `O_EXCL` lock-file 互斥锁（`feature-162.lock`）：指数 backoff（初始 50ms，上限 1.6s，最多 30 次重试），超时后 exit code 73 + 诊断信息；孤儿 lock 自动清理（PID 已不存在 + 时间戳 > 60s）（FR-032）—— 2.0h —— critical
- [ ] **PC-4** 实现 finalized / partial run 区分逻辑：扫描 `run-N.json` 的 `started_at` / `finalized_at` 双字段；partial run 不自动重跑，输出 unfinished 列表等待用户决策（FR-032, EC-008）—— 1.0h —— critical
- [ ] **PC-5** 新增 `--accept-partial` 和 `--restart-partial` CLI flag（FR-032, EC-008）—— 0.5h —— critical
- [ ] **PC-6** 在 `eval-mcp-augmented.mjs` 写入 run 结果时统一使用 canonical schema `perf.mcpToolCalls[]`（`{ tool, success, error, responseBytes, timestamp }`），同时保留 legacy 兼容字段 `mcpToolCallCount + mcpResponseBytes`（从 `mcpToolCalls[]` 派生）；将 `eval-task-runner.mjs` 的 `perf.mcpToolCallTrace` rename 为 `perf.mcpToolCalls`（读取时同时识别旧字段名）（EC-006）—— 1.5h —— critical
- [ ] **PC-7** 在 `eval-mcp-augmented.mjs` 集成 `scripts/lib/llm-pricing.mjs` 的 `estimateCost()`，填充 `costUsd` 字段（当前第 741 行暂置 null）（FR-035）—— 0.5h —— 非 critical

### 测试

- [ ] **PC-T1** 新增 vitest case：模拟两进程并发写 quota store，验证最终 runs 计数恰好为 2（O_EXCL 互斥生效）（FR-032）—— 1.0h —— critical
- [ ] **PC-T2** 新增 vitest case：模拟孤儿 lock（PID 不存在 + 时间戳 > 60s），验证自动清理逻辑（FR-032）—— 0.5h —— critical
- [ ] **PC-T3** 新增 vitest case：partial run 检测不自动重跑，输出 unfinished 列表（FR-032, EC-008）—— 0.5h —— critical
- [ ] **PC-T4** 执行 pilot batch（3 fixture × 3 cohort × 3 repeat = 27 runs），验证所有 27 run 退出码为 0，产出 `run-N.json` 包含有效 oracle 判定和 jury scores（FR-030, SC-004）—— 2.0h —— critical
- [ ] **PC-T5** 根据 pilot batch 单 run token 消耗决策分批策略：若 < 10K 则一次性跑全量；若 ≥ 10K 则配置 `--max-runs-per-day` 分周执行（FR-031）—— 0.5h —— critical
- [ ] **PC-T6** 执行全量 450 runs（3 cohort × 15 runs × 10 fixture），使用 Codex driver（`codex:gpt-5.5`，`model_reasoning_effort=medium`）+ Phase B 修订后的 DEFAULT_JUDGES；验证全部退出码为 0（FR-033, SC-004）—— 可能跨多天 —— critical
- [ ] **PC-T7** 运行全量 `npx vitest run`，确认 schema 迁移（PC-6）零回归（EC-006）—— 0.5h —— critical

### 文档同步

- [ ] **PC-D1** 更新 `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` §10.1：将实验设计从 N=3/90 runs 改为 N=15/450 runs，更新统计功效说明 + 复现命令文本块（FR-040）—— 0.5h —— critical
- [ ] **PC-D2** 填写 §10.2 Pass Rate 矩阵（10 task × 3 group）：将所有 `<pending Stage 7b>` 替换为真实数值 + Bootstrap 95% CI（FR-034）—— 1.0h —— critical
- [ ] **PC-D3** 填写 §10.3 Token Cost：Codex driver 零边际成本标注，GLM/Kimi judge API cost 据实填入（FR-035）—— 0.3h —— critical
- [ ] **PC-D4** 填写 §10.4 战略结论：按实测数据选择三种情境模板之一（lift > 0 / lift ≈ 0 / 天花板）（FR-036）—— 0.5h —— critical
- [ ] **PC-D5** 新建 §10.5 章节（标题：`### 10.5 Sub-agent MCP 继承 fix 影响验证（Feature 162 Phase 0）`），包含 `run id / cohort / mcp_tool_calls / mcp_called / mcp_tools / mcp_response_bytes / inheritance_status` 表格，填入 Phase C 实测数据；若 `inheritance_status=unavailable` 占比 > 30% 追加异常分析段（FR-037, SC-004）—— 1.5h —— critical
- [ ] **PC-D6** 同步更新 `specs/158-swe-bench-lite-grounding-eval/` detail 报告中的实验配置（行 50-55 / 139），与 Feature 162 实施配置保持一致（FR-040）—— 0.5h —— critical

### 验证

- [ ] **PC-V1** 确认竞品评测报告 §10 各章节无 `<pending>` 占位符（FR-034, FR-035, FR-036, FR-037, SC-004）—— 0.2h —— critical
- [ ] **PC-V2** 运行 `npm run repo:check` + `npm run release:check`（FR-038）—— 0.2h —— critical
- [ ] **PC-V3** 落地 Codex 对抗审查 artifact `specs/162-codex-driver-glm-judge-eval/codex-reviews/phase-c.md`；critical 项 = 0（FR-038, SC-005）—— 0.5h —— critical

---

## Final — 交付收口

- [ ] **FIN-1** 执行 spec-review（`spec-review` sub-agent）对 spec.md 合规审查（FR-038, SC-005）—— 0.5h —— critical
- [ ] **FIN-2** 执行 quality-review（`quality-review` sub-agent）对代码质量审查（FR-038, SC-005）—— 0.5h —— critical
- [ ] **FIN-3** 执行 verify 工具链（vitest + build + repo:check + release:check），确认 GATE_VERIFY 硬门禁全部通过（SC-001~SC-005）—— 0.5h —— critical
- [ ] **FIN-4** 在 chat 中列出 push deliverable report（含 commit hash、改动统计、codex 审查结论、verify 结果、rebase 状态），等待用户明确"确认 push"—— 0.2h —— critical
- [ ] **FIN-5** `git rebase master` + `git push origin master`（用户确认后执行）—— 0.2h —— critical

---

## 附：报告

### 总 checklist item 数

| Phase | 代码改动 | 测试 | 文档同步 | 验证 | 小计 |
|-------|---------|------|---------|------|------|
| Phase 0 | 9 | 2 | 1 | 2 | **14** |
| Phase A | 8 | 4 | 1 | 2 | **15** |
| Phase B | 4 | 5 | 1 | 1 | **11** |
| Phase C | 7 | 7 | 6 | 3 | **23** |
| Final | — | — | — | 5 | **5** |
| **合计** | **28** | **18** | **9** | **13** | **68** |

### 总工时估算

| Phase | 工时（不含 LLM 调用等待） |
|-------|----------------------|
| Phase 0 | ~4h |
| Phase A | ~12h |
| Phase B | ~4h（+LLM 调用 ~$5）|
| Phase C | ~16h（+LLM 调用 ~$15，可能跨 2-3 calendar week）|
| Final | ~2h |
| **合计** | **~38h**（+LLM 调用 ~$20，日历时间可能 2-3 周） |

### 跨 phase 依赖图

```
Phase 0 ──→ Phase A ──┐
         └──→ Phase B ──┤──→ Phase C ──→ Final
```

- Phase 0 是 Phase A、B、C 的硬前置
- Phase A 与 Phase B 可并行执行
- Phase C 依赖 Phase A + Phase B 全部完成
- Final 依赖 Phase C 完成

### spec → checklist 覆盖率

| FR | 覆盖 checklist item |
|----|-------------------|
| FR-001 | P0-1 |
| FR-002 | P0-2 |
| FR-003 | P0-3 |
| FR-004 | P0-4 |
| FR-005 | P0-5 |
| FR-006 | P0-7, P0-8, P0-9, P0-V1 |
| FR-007 | P0-6, P0-8 |
| FR-008 | P0-T2, P0-D1 |
| FR-010 | PA-3 |
| FR-011 | PA-4 |
| FR-012 | PA-5 |
| FR-013 | PA-1, PA-D1 |
| FR-014 | PA-6 |
| FR-015 | PA-T1, PA-T4 |
| FR-016 | PA-8 |
| FR-020 | PB-1 |
| FR-021 | PB-2 |
| FR-022 | PB-4, PB-T1 |
| FR-023 | PB-3, PB-T2 |
| FR-024 | PB-T3 |
| FR-025 | PB-T4, PB-D1 |
| FR-026 | PB-T5 |
| FR-027 | PA-2, PA-7, PA-T2 |
| FR-030 | PC-T4 |
| FR-031 | PC-T5 |
| FR-032 | PC-1, PC-2, PC-3, PC-4, PC-5, PC-T1, PC-T2, PC-T3 |
| FR-033 | PC-T6 |
| FR-034 | PC-D2 |
| FR-035 | PC-7, PC-D3 |
| FR-036 | PC-D4 |
| FR-037 | PC-D5 |
| FR-038 | P0-V2, PA-V2, PB-V1, PC-V3, FIN-1, FIN-2 |
| FR-039 | （YAGNI 移除，无对应 item）|
| FR-040 | PC-D1, PC-D6 |
| EC-006 | PC-6, PC-T7 |
| EC-007 | P0-9 |
| EC-008 | PC-4, PC-5 |

**覆盖率：所有 MUST 级 FR（FR-001~FR-037, FR-040）均有对应 checklist item，覆盖率 100%。FR-039 明确为 YAGNI 移除，无 item 属正确行为。**
