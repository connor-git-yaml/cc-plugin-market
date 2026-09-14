# F293 问题修复报告 — CLI-proxy 无头调用瘦身 + collector 成本口径（M11 卡 E）

**模式**: fix（M11 §9.5；`/goal` 授权下主线程直接实现，TDD + 两轮异构对抗 + delta 轮）
**日期**: 2026-09-15
**审查档位**: Codex 审查暂停，异构档位缺席 → 内部异构对抗复审 ×2 + delta ×1（一般生产代码档位）

## 问题描述

4.6.0 基线采集显示 micrograd / nanoGPT 的 `tokensInput` 相比 4.3.0 翻倍（358k / 907k），归因为 Claude Code 无头 harness 开销：
`claude --print` 默认装载用户级 MCP / skills / 工具集，每次 spec 生成都把整套工具 schema 塞进 prompt；同时 collector 的成本估算
用固定单价公式、不读 CLI 报告的 `total_cost_usd`，cache 段单价还按 5 分钟 TTL（3.75）算，而 2.1.270 的 cache creation 全落 1h 段（6）。

## 5-Why 根因

| Why | 结论 |
|---|---|
| 1 | 无头调用每次注入 ~340k 输入 token |
| 2 | `--print` 继承宿主 settings：MCP 服务器 / skills / 工具全量装载 |
| 3 | cli-proxy 没有隔离参数（`--setting-sources ''` 只是探索，最终 `--safe-mode` 等价且不动 OAuth） |
| 4 | 成本从未读 CLI 的报告值，公式与实际 cache 段错位 |
| **Root Cause** | **无头调用未隔离宿主运行时 + 成本口径用估算替代 CLI 真值** |

## 修复策略

- `src/auth/cli-proxy.ts`：`HEADLESS_ISOLATION_ARGS = ['--max-turns','1','--safe-mode','--no-session-persistence','--disable-slash-commands','--tools','']`
  （`--tools ''` 是变参，必须最后）；headless cwd 固定到 `os.tmpdir()/spectra-headless-cwd`（避免宿主 `CLAUDE.md` / `.claude` 泄入，
  `findAncestorProjectMarkers` 只告警一次）；`system/init` 里 tools / mcp 非空只告警一次；`result` 的 `is_error` / 非 `success` subtype
  一律抛 `StreamResultError`，`error_during_execution` 判可重试（503），`error_max_turns` 等沿用退出码；`total_cost_usd` 透传为 `reportedCostUsd`。
  `--settings` 透传方案在 delta 轮被否决删除（argv 泄漏 / 键白名单 / OAuth 不变量 / 仓库可控 apiKeyHelper）。
- `src/core/llm-client.ts` / `context-assembler.ts` / `semantic-diff.ts`：`context.systemPrompt` 覆盖（semantic-diff 不再收到 spec-generation 系统提示，`templateInstructions: ''`）。
- `src/core/single-spec-orchestrator.ts` / `batch/cost-summary.ts` / `models/module-spec.ts` / `templates/module-spec.hbs`：`reportedCostUsd` 累计到 costMetadata / frontmatter / 汇总表（「CLI 报告成本 (USD)」行带 k/n 覆盖）。
- `scripts/baseline-collect.mjs`（schema 1.2）：`tokensCacheCreation` / `tokensCacheRead` / `reportedCostUsd` / `reportedCostCoverage`；`estimateCostUsd` 只在报告值有限 > 0 且全覆盖时取真值，否则公式（3 / 6 / 0.30 / 15 per MTok）；`--verify-artifacts` 检查 1.2 键。
- `scripts/baseline-diff.mjs`：`perf.estimatedCostUsd` / `perf.reportedCostUsd` 为展示维度（info，null 时 `na`）；minor 版本不一致降为 warning。

## Spec 影响 / 行为变化

- 无头 spec 生成不再看见宿主 MCP / skills / 工具；`.claude/settings.json` 的 MCP 对无头调用零影响。
- `baseline:collect` fixture schemaVersion 1.1 → 1.2（老 fixture `--verify-artifacts` 会 FAIL，须重采）。
- 冻结快照 `tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap` 做了一次受控 `-u`：留 preimage，逐行审计 = 9 处
  `"sourceTreeDirty": <bool>,` 插入（卡 D）+ 16 处 `| 总 cache_(creation|read) tokens | 0 |` 插入（本卡），0 删除、0 意外行。

## 验收证据（A/B：同一语料、同一 commit，只换 dist）

| 语料 | tokensInput 4.6.0 → 本卡 | 变化 | reportedCostUsd | 图 / spec 产物 |
|---|---|---|---|---|
| micrograd | 358,476 → 16,804 | −95.3% | 0.493553（真值） | 逐字节相同 |
| nanoGPT | 906,725 → 106,238 | −88.3%（墙钟 −23%） | 2.056362（真值） | 逐字节相同 |
| self-dogfood | 待在已提交树上重采（本卡合入后单独 commit fixture） | — | — | — |

Stop payload 探针（2.1.270，裸探针插件）：`stop_hook_active=false` / `background_tasks=[]` 自然停机；`--safe-mode` 探针 tools 0 / mcp 0 / skills 0、`apiKeySource none`（OAuth 不变）。

## 对抗审查（两轮 + delta）与处置

| 轮 | 发现 | 处置 |
|---|---|---|
| 1 | cache 单价 3.75 错（1h 段 = 6）；`--max-turns` 错误 shape 漏过；`resolveHeadlessCwd` memoize 无意义；semantic-diff 收到 spec-generation 系统提示 | 全修 |
| delta | `--settings` 透传是安全面（argv 泄漏 / OAuth 不变量 / 仓库可控 apiKeyHelper）；部分覆盖的报告成本被当真值；展示维度从 diff 消失；minor 版本不一致 exit 2；1.25× 陈旧注释；systemPrompt 发两遍；once-flags 测试耦合；`error_during_execution` 不可重试 | 全修（改 `--safe-mode`、覆盖闸、DISPLAY_ONLY、warning、reset hook、503） |

**残余（记录，未修）**：`agents` / `memory_paths` 未在 init 里校验；`baseline-collect` 硬编码 `claude-sonnet-4-6`；debt-intelligence 成本记录无 reportedCostUsd（覆盖闸落回公式）；长输出下 `--max-turns 1` 未实测。

## 测试

`tests/unit/cli-proxy.test.ts`（safe-mode 守卫 / 错误 shape / 503 / reset hook / W-4 / W-9 / W-10）、`baseline-collect(-cost).test.ts`、`baseline-diff.test.ts`、
`cost-summary-reported-cost.test.ts`、`spec-renderer-cost-fields.test.ts`、`llm-provider-selection.test.ts`（systemPrompt 覆盖）——15 文件 154 例全绿；每处修复有变异体检查（错误谓词 / 单价 / 覆盖闸 / 展示维度各一）。

## 工具使用反馈

见 `docs/design/dogfooding-feedback-ledger.md`「M11 第一批五卡」节（本卡：无头探针只能靠自建 Stop 探针插件取 payload；MCP 对未提交 diff 不可审）。
