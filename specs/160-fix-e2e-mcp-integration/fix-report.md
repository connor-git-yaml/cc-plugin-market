# 问题修复报告 — Feature 160

## 问题描述

Feature 158 Stage 7b（≥45 runs SWE-Bench-Lite eval，~$15-30 LLM 成本）启动前，扫描发现 4 类端到端链路从未在 CI 中验证，存在 eval 数据全废风险：

1. **Smoke A**: Spectra MCP server stdio 子进程 E2E — 现有 `agent-context-real-graph.test.ts` in-process 直接 import handler，跳过 stdio/JSON-RPC 协议链路
2. **Smoke B**: Claude Code + spectra MCP 子进程集成 — `claude --print --mcp-config` 从未在 CI 验证
3. **Smoke C**: Cohort 隔离 — `control` 零 `mcp_tool_use` / `mcp-pull` 至少 1 次从未端到端验证
4. **Smoke D**: spec-driver workflow + MCP 结合 — spec-driver 子代理能否调到 `mcp__spectra` tools 从未集成测试

**追加发现**：
- `dist/cli/index.js` 不在 git 中，`writeMcpConfig()` 在未 build 时会立即抛错
- `parseMcpToolCallTrace` 只有合成数据单测，真实 `stream-json` 格式差异可能导致解析失败

---

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | Stage 7b eval 数据为何有全废风险？ | 4 个 E2E 链路（MCP stdio / Claude+MCP / cohort 隔离 / spec-driver+MCP）从未在 CI 中跑通 |
| Why 2 | 为什么这些链路没有被 CI 验证？ | Feature 158 dry-run 设计只验证 exit 0 + fixture 结构 + telemetry hook，未跑真 Claude Code + MCP 子进程 |
| Why 3 | 为什么 dry-run 跳过了这些验证？ | dry-run 的设计目标是"避免 LLM API 调用成本"，但基础设施验证（MCP stdio/不需要 LLM）也被附带跳过 |
| Why 4 | 为什么基础设施验证与 LLM 成本管控被混淆？ | 缺少明确的"infra-ready smoke gate"阶段定义，干净分离"需 LLM 的验证"与"不需 LLM 的基础设施验证" |
| Why 5 | 为何该设计缺陷未被现有机制捕获？ | vitest 套件只跑单元/集成测试；CI 在运行测试前不执行 `npm run build`；`dist/cli/index.js` 缺失但没有明确 gate 阻止后续步骤 |

**Root Cause**: 缺少独立的"基础设施 smoke 验证阶段"——把"不需 LLM 的 MCP stdio 验证"与"需 LLM 的 eval 运行"混在 Stage 7b 里，导致前置 infra 验证从未执行。

**Root Cause Chain**: Stage 7b eval 数据废 → 4 链路未验证 → dry-run 跳过 infra → infra/LLM 验证混淆 → 缺 smoke gate 阶段定义 → CI 无 build step + 无 infra smoke

---

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `scripts/eval-task-runner.mjs` | L258 `writeMcpConfig()` | `dist/cli/index.js` 存在性检查在运行时抛错 | 写 infra smoke 确保 build 是前置条件 |
| `tests/integration/agent-context-real-graph.test.ts` | 全文 | in-process import handler，无 stdio/JSON-RPC 测试 | 补写 stdio subprocess E2E |
| `tests/unit/eval-mcp-augmented-classic.test.ts` | 全文 | 仅 `parseArgs` + `aggregateBootstrap` 单测 | 补写 cohort 隔离 + `parseMcpToolCallTrace` 真实格式测试 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `scripts/eval-mcp-augmented.mjs` | L258+ | 同样调 `writeMcpConfig` | 安全（与 classic 版本复用同一函数，修复覆盖） |
| `src/mcp/graph-tools.ts` | 全文 | 也是 in-process 测试 | 安全（graph-tools 不参与 stdio 链路，影响域不同） |

### 同步更新清单

- **构建**: CI/本地跑 eval 前必须先 `npm run build`
- **测试**: 新增 4 类 smoke 测试文件（Smoke A/C/E 在 CI 中，Smoke B/D 手动跑需 LLM）
- **文档**: 在 Feature 158 `verification/` 下补注 smoke 验证状态

---

## 修复策略

### 方案 A — 补齐可自动化 smoke + 标注手动 smoke（推荐）

**范围**：
- **Smoke A** (自动): `tests/integration/mcp-server-stdio.test.ts` — 用 `@modelcontextprotocol/sdk` `Client + StdioClientTransport` 启动 dist/cli/index.js 子进程，验证 tools/list 9 个 tool + 跑 5 个真实 query（需 micrograd baseline；无 baseline → skip）
- **Smoke C** (自动, 仅 dry-run 结构验证): `tests/unit/eval-mcp-classic-cohort.test.ts` — 验证 `buildClaudeArgs` 对 3 cohort 产出正确参数结构；验证 `writeMcpConfig` 写入正确 JSON（不需 LLM）
- **Smoke E** (自动): `tests/unit/eval-mcp-parse-trace.test.ts` — `parseMcpToolCallTrace` + `parseStreamJsonUsage` ≥ 8 个 unit test，覆盖真实 stream-json 格式字段（`tool_use_id`/`partial result`/`error path`/`modelUsage` 多 key）
- **Smoke B/D** (手动): 在 `specs/160-.../verification/smoke-b-d-checklist.md` 记录手动验证步骤（需 LLM，不计入 CI）

**优点**: CI 可自动运行 A/C/E，不需要 LLM API 成本；B/D 清晰标注为手动前置

### 方案 B — 全部 smoke 转 manual

仅在 verification checklist 里记录，不写自动化测试。**不推荐**：每次 Stage 7b 重启都要手动跑，无法回归防护。

---

## Spec 影响

- 需要更新：`specs/158-swe-bench-lite-grounding-eval/verification/` — 补充 infra smoke 验证结论
- 无需更新 spec.md（功能 spec 正确，缺的是测试覆盖）

---

## 已知限制（Codex 对抗审查记录，接受并文档化）

| 编号 | 描述 | 接受原因 |
|------|------|----------|
| CRITICAL-1 | CI 无 build step，Smoke A/C `describe.skipIf` 静默跳过 | CI 加 build 超出本 fix 范围；stage7b-infra-smoke.md 明确要求本地 `npm run build` 前置 |
| CRITICAL-2 | Smoke E 仍是合成 NDJSON，非真实 Claude stream-json | 产出真实 fixture 需 LLM（$0.5+）；当前合成 fixture 已比原有测试大幅改进；留 Feature 162 补真实 fixture |
| WARNING-1 | Smoke C 只验证参数结构，不验证真实 cohort 隔离 | 真实 cohort 隔离（LLM 调用）属 Smoke B/D 手动验证；参数结构验证已防止最常见的配置错误 |
| WARNING-2 | writeMcpConfig dist 缺失负路径是占位断言 | 改 cwd 会污染并行测试；dist 缺失时 writeMcpConfig 抛 Error 的代码路径已有源码 cover |
| WARNING-6 | Smoke D 不是可执行 gate | spec-driver + MCP 完整集成留 Feature 162；stage7b-infra-smoke.md 明确标注 D 为已接受风险 |

已修复：
- W-3：Smoke A `affected.length > 0` 断言
- W-4：StdioClientTransport 加 `cwd: tempRoot`
- W-5：Smoke B 文档 `require()` 改 `await import()`
- INFO-4：duration 断言改 `toBe(2500)`

