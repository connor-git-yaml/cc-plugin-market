---
feature: 176
phase: Plan
created: 2026-06-08
spec: spec.md
strategy: 复用 F158-F169 SWE-Bench-Lite 评测设施，数据集换 Verified；交付「host 可一键跑」harness（用户 host 执行 150 runs，我从结果写报告）
---

# Feature 176 — 实施计划

## 0. 架构原则与交付边界

- **复用优先**：worktree 准备 / functional oracle / cross-LLM jury / N-repeat + bootstrap CI / fixture schema / verify-feature 脚本模式 **全部复用**既有实现，本 Feature 只做"数据集换 Verified + 新增 cohort 3 + 把 spec 的完整性要求（版本门禁/预注册/oracle-jury 分离/repeat 隔离/blinding/token 来源）落到可运行脚本"。
- **交付边界（用户已拍板）**：我交付 **wired + 尽量本地 smoke 验证过的 harness + host runbook**；150 runs 的实付执行由用户在 **host shell** 跑；我从结果 fixture 写 publish 报告。→ plan/tasks 强调**干净、可复现、自带护栏（预注册/版本门禁/配额检查）的 host 命令交接**，而非在 sandbox 内跑满。

## 1. 复用映射（现状 → F176 用法）

| 能力 | 现有实现 | F176 复用/改动 |
|------|---------|--------------|
| worktree 准备 | `eval-task-runner.mjs::prepareWorktree`（rsync + reset --hard + clean -ffdx）| 复用；**加 repeatIndex 维度**（见 §3.4）|
| cohort 派发 | `buildDriverPrompt` + `buildClaudeArgs`（control/spec-driver/spec-driver-spectra/superpowers/gstack/mcp-pull）| **新增 cohort `spec-driver-spectra-mcp`**（§3.2）|
| functional oracle | `runPrimaryOracle`（eval-task-runner.mjs:456）| 复用；Verified fixture 提供 `primaryOracle` |
| cross-LLM jury | `eval-judge-jury.mjs`（anonymized + adversarial，juryScores/median/spread）| 复用；**仅质量叠加层，不决定 pass/fail**（§3.5）|
| N-repeat + bootstrap CI | `eval-batch-repeat.mjs`（F149，run-i + aggregate.json + CI95）| 复用；**repeat 隔离显式化**（§3.4）|
| mcp trace 解析 | eval-task-runner.mjs:341-367（匹配 `mcp__spectra__*`）| **扩展匹配 `mcp__plugin_spectra_spectra__*`**（§3.2）|
| spectra MCP server | `.mcp.json` → `dist/cli/index.js mcp-server`（volta-bypass）| 复用；**dist 由本 worktree（含 F177-F181）build**（§3.3）|
| 数据集 importer | `swe-bench-fixture-import.py`（princeton-nlp/SWE-bench_Lite）| **Verified 变体**（§3.1）|
| 报告/汇总 | `eval-report.mjs` 等 | 复用骨架 + 新增 cross-cohort 聚合（§3.7）|
| verify 脚本 | `verify-feature-158.mjs` 模式 | **新增 `verify-feature-176.mjs`**（§3.8）|

## 2. 关键设计决策（KD）

- **KD-1（cohort 3 版本来源 = 本地 build dist）**：cohort 3 的 spectra MCP 用 `npm run build` 从**本 worktree src** 产出的 `dist/cli/index.js`，**不用 npm 上的旧 4.2.0**。**注意（codex WARNING 修正）**：本 worktree 分支是 `claude/suspicious-sinoussi-d41c88`（head=master `5e8b9c8`，含 F177-F181），不是 master 本体 —— 故"build 即含最新"不能口头假设，MUST 由 §3.3 版本门禁实测：记录 build source commit + tree-dirty 状态，对非预期祖先链 / stale dist hard-fail。memory: project_spectra_cli_volta_blocker 的 dev-mode 诉求由"本地 build dist + node 绝对路径"满足（既有 writeMcpConfig 已这么做）。
- **KD-7（driver model = opus-4-7 + 全 cohort stream-json，修正既有默认）**：既有 `buildClaudeArgs` 硬编码 `--model claude-sonnet-4-6` 且非 mcp-pull cohort 走 `--output-format text`（token=null）。F176 MUST 覆盖为 **`--model claude-opus-4-7`**（spec/milestone §3，Claude Max OAuth 边际 $0）+ **全部 cohort 走 `--output-format stream-json`**（让既有 `parseStreamJsonUsage` 对每个 cohort 都取到 input/output token，落实 FR-B-003a）。driver 是 **Claude CLI（非 Codex CLI）**；token/quota/usage 口径统一走 claude stream-json。
- **KD-2（pass/fail = functional oracle，jury 不参与判定）**：落实 FR-A-001b。finalize 时 `runPrimaryOracle` 的 `passed` 是唯一真值；jury 只写 `juryScores` 质量分。`ORACLE-UNAVAILABLE` 从分母剔除，不用 jury 补判。
- **KD-3（cohort 3 wiring = plugin namespace，不是 driver-level mcp-pull）**：cohort 3 跑真实 spec-driver workflow（sub-agent 形态），spectra 以 plugin 形式经 `--plugin-dir` 注册，sub-agent 见 `mcp__plugin_spectra_spectra__*`。这区别于既有 `mcp-pull`（driver 顶层 `mcp__spectra__*`）。理由：milestone §3 明确 F176 cohort 3 测"产品真实部署形态"。
- **KD-4（预注册冻结）**：跑全量前把 10 task id + 筛选规则 + seed 冻结到入库的 `verification/preregistration.md`，防 falsification 规避（FR-A-002b）。
- **KD-5（host runbook 自带护栏）**：批跑脚本内置 (a) 启动前版本门禁 hard-fail；(b) smoke→全量两段；(c) 每 6 runs 配额检查点；(d) 预注册一致性校验。让 host 执行"傻瓜化 + 难以无意中作弊"。
- **KD-6（不改产品源码）**：所有改动落在 `scripts/`（评测设施）+ `specs/176/` + `tests/baseline/swe-bench-verified/`（fixture，不入库）+ `package.json` script 入口；**不碰 `src/`**（Spectra/spec-driver 产品代码）。dogfooding 发现的工具问题只记 `verification/m8-fix-candidates.md`。

## 3. 组件实施计划

### 3.1 Verified 数据集 importer
- 复制/参数化 `swe-bench-fixture-import.py` → 支持 `--dataset princeton-nlp/SWE-bench_Verified`（或新文件 `swe-bench-verified-fixture-import.py`，避免破坏 Lite 行为）。
- 输出到 `tests/baseline/swe-bench-verified/fixtures/SWE-V00X-*.json`（+ goldpatch.diff），schema 与 Lite 对齐（`primaryOracle` / `prompt` / `target` / startCommit）。
- 可解性筛选 + 退化策略（候选<10 时降级 + `_DEGRADATION_NOTE.md` + 泄漏增量风险），沿用 Lite importer 逻辑。
- **产物不入库**（CON-1；fixtures 目录 .gitignore）。

### 3.2 cohort 3 `spec-driver-spectra-mcp` 派发（最高技术风险，spike-first）
- **3.2.0 前置 spike（FR-A-007b，gate）**：先写 `scripts/spike-cohort3-plugin-mcp.mjs` —— 在 1 个 wtDir 内以 `claude --print` 跑一个最小 spec-driver workflow 任务，断言 stream-json 里出现 `mcp__plugin_spectra_spectra__*` 的 tool_use（即 sub-agent 真的调到了 plugin MCP）。**spike 不过 → 不进 smoke/全量，按 FR-A-007c 分流升级**。这是整个 cohort 3 的可行性前提，未验证前其余 §3.2 实现都不算数。
- `SUPPORTED_TOOLS` 增加 `spec-driver-spectra-mcp`。
- `buildDriverPrompt`：与 `spec-driver` 同主体 prompt（"用 spec-driver-fix workflow…严格 discipline + 测试覆盖"），**不注入 spec.md context**（那是 cohort 2.5 `spec-driver-spectra` 的 push 模式）；grounding 仅来自 MCP 可用。
- `buildClaudeArgs`：新分支 —— `--model claude-opus-4-7` + `--output-format stream-json` + `--plugin-dir <spectra-plugin-built>` + `--plugin-dir <spec-driver-plugin-4.1.0>`（spec-driver 已全局装，spectra 经 plugin-dir 注册）+ allowedTools 含 `mcp__plugin_spectra_spectra__impact/context/detect_changes/...`。
- mcp trace 解析：prefix 匹配扩展为 `mcp__spectra__*` ∪ `mcp__plugin_spectra_spectra__*`，`mcpToolCallCount` 两者合计。
- wtDir 内预生成 spectra graph（`runSpectraBatchInWorktree`，code-only）供 MCP 工具查询。

### 3.3 版本门禁（FR-A-004b / SC-001b）
- 新增 `scripts/lib/spectra-version-gate.mjs`：给定 `dist/cli/index.js`，校验其含 F177-F181 —— 优先用 commit/version marker（如 `dist` 旁记录 build commit，或运行 `node dist/cli/index.js --version` + 比对最小版本，或探测 F177 统一响应契约字段 / F181 单一 import-resolver 行为的运行时特征）。
- smoke 与全量启动时调用；**失败 hard-fail**。
- 负向用例：故意指向旧 binary/dist 应被挡下（SC-001b 佐证）。

### 3.4 repeat 隔离（FR-A-006/006b）
- `prepareWorktree` 加 `repeatIndex` 入参 → wtDir = `getBenchHome()/<task>/<cohort>/r<repeatIndex>`；fixture path 同步加 `r<i>`。
- 保持"同 combo 内 sequential + 每 run fresh rsync/reset/clean"（既有保护），repeatIndex 让**并行/复查也安全**且路径自证隔离。
- verify 校验 3 个 repeat 目录互不共享 dirty state。

### 3.5 oracle 主 + jury 叠加（FR-A-001b / KD-2）
- finalize 流程：`runPrimaryOracle` → `oracleResult.passed`（真值）写 fixture；随后 `eval-judge-jury.mjs`（opus+GLM+Kimi，anonymized）写 `juryScores`（质量分）。
- jury blinding：复用 `anonymizeFixture` 隐藏 cohort/tool/repeat/mcp trace，记 blinding hash（FR-A-008b）。
- pass rate / lift 聚合**只读 oracleResult**；`ORACLE-UNAVAILABLE` 计数并剔除。

### 3.6 token 采集（FR-B-003a）
- 从 driver `claude --print --output-format stream-json` 的 usage 字段取 input/output token；定义 `token-per-completed-task = Σtokens(oracle-pass runs) / #oracle-pass`。
- 缺失标 `TOKENS-UNAVAILABLE` 剔除；不冒充 0；如需估算显式标 `estimated`。

### 3.7 批跑编排 + host runbook（KD-5）
- **路径常量（统一，codex WARNING 修正）**：新增 `scripts/lib/swe-bench-verified-paths.mjs` 导出唯一 fixture 根 `tests/baseline/swe-bench-verified/`，run 路径 `…/tasks/<task>/<cohort>/r<repeatIndex>/full.json`、聚合 `…/aggregate/…`。importer / batch / report / verify / .gitignore **全部 import 此常量**，杜绝 spec/plan 目录漂移。
- 新增 `scripts/swe-bench-verified-cohort-batch.mjs`（复用 `eval-batch-repeat` 的 N-repeat + bootstrap CI 内核，不另造）：
  - 入口校验：spike 通过标记（§3.2.0）+ 版本门禁（§3.3）+ 预注册一致性（§3.1 task 集 hash）+ 凭据 preflight（SILICONFLOW + claude OAuth；**不查 codex**，F176 driver 非 codex）。
  - `--smoke`：5 cohort × 1 task × N=1，断言 5/5 success + cohort3 mcpCallCount>0 + 版本门禁过。
  - `--full`：150 runs，N=3。
  - **配额检查点（INFO 修正 — 默认非交互可无人值守）**：每 6 runs 查配额；**默认 `--on-quota=pause`**（写可 resume checkpoint 并退出，host 隔日 `--resume` 续跑）；可选 `--on-quota=split-days` 自动分日；**仅 `--interactive-quota` 显式开启时才交互询问**。"一键跑"= 默认 pause/resume，不在全自动流程里卡交互。
- `specs/176/verification/host-runbook.md`：host shell 流程（build → 版本门禁 → 凭据 verify → import → preregister → spike → smoke → full → report），每步可复制命令 + 期望输出。

### 3.8 报告 + verify
- `scripts/eval-report.mjs` 扩展 cross-cohort 聚合 → 生成 auto-report（不入库）。
- 人工撰写 `PUBLISH-REPORT-M7.md` + `PUBLISH-REPORT.md §11`（入库，含 FR-C-003..C-009 锚点，口径依 report-anchors.md）。
- `scripts/verify-feature-176.mjs`：逐条断言 SC-001..008（含版本门禁负向用例、oracle-only pass rate、预注册一致、禁用词扫描、fixture 未入库）。

## 4. 不做（Out of scope，呼应 spec）
- 不改 `src/`（产品代码）；不量化 drift；不声称绝对可比；不跑 500+ 大项目。

## 5. 风险与缓解
| 风险 | 缓解 |
|------|------|
| **cohort 3 plugin-namespace wiring 跑不通**（claude --print 下 sub-agent 是否继承 plugin MCP，既有 infra 从未验证）| **§3.2.0 spike 先验**（150 runs 前的硬 gate）。失败后**不静默降级、不假装达标**，按下方决策树分流 |
| ↳ 决策树（FR-A-007c，解 codex CRITICAL：fallback 与 SC 5/5 冲突）| **(a) harness 配置问题**（少 `--plugin-dir`/flag）→ 本 scope 内修 harness 重试；**(b) 产品能力限制**（plugin MCP 确实不传播到 `--print` sub-agent）→ 记 `m8-fix-candidates.md`，cohort 3 无法满足 SC-002/003 → **升级用户拍板**：先修产品 wiring(M8) 再跑 / cohort 3 降范围为可行形态（如 driver 顶层 mcp 显式声明，但须改 spec）/ M7 带 known-limitation 交付。**绝不在不达标时偷偷过 SC** |
| Verified repo oracle 环境重（需装依赖跑测试）| importer 选可解性高 + 依赖轻的 task；oracle 不可跑标 ORACLE-UNAVAILABLE 而非伪 pass |
| sandbox 内 claude OAuth 不可用 → 无法本地 spike/smoke | 退而把 harness 单元测/dry-run + 路径/版本门禁跑通；spike/smoke 交 host runbook 第一步，结果回报后再决定是否进全量 |
| 周配额 ≥60% | §3.7 默认 `--on-quota=pause` + `--resume`（非交互可无人值守）|

## 6. 任务分组（tasks 阶段种子）
0. **G0 spike（前置 gate）**：`spike-cohort3-plugin-mcp.mjs` 证明 `--print` sub-agent 能调 plugin MCP（§3.2.0）。**spike 结果决定 G2 是否成立 / 是否走 FR-A-007c 升级** —— host 跑（需 claude OAuth），结果回报后再继续。
1. **G1 数据集**：Verified importer + 预注册冻结 + 路径常量（§3.7）
2. **G2 cohort3**：派发分支（opus + stream-json）+ plugin-namespace wiring + trace 解析扩展（依赖 G0 通过）
3. **G3 完整性护栏**：版本门禁（含 source commit/dirty）+ repeat 隔离 + oracle/jury 分离 + 全 cohort token 采集 + blinding
4. **G4 编排**：batch 脚本（复用 eval-batch-repeat 内核；smoke/full + `--on-quota=pause/resume`）+ host-runbook
5. **G5 报告/验收**：cross-cohort 聚合 + verify-feature-176 + 报告骨架
（G1/G3 可并行；G0 是 G2 前置 gate；G4 依赖 G1-G3；G5 依赖 G4。**G0 未过则暂停在 FR-A-007c 决策，不强推 G2-G5**）
