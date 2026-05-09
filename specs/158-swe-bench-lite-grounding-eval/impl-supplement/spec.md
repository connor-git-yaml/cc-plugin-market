---
feature_id: "157"
title: "SWE-Bench Grounding Eval — Spectra MCP Grounding Lift 验证"
branch: "158-swe-bench-lite-grounding-eval/impl-supplement"
created: "2026-05-09"
status: "Draft"
priority: "P1"
research_basis: "specs/158-swe-bench-lite-grounding-eval/impl-supplement/research/synthesis.md"
---

# Feature 158 — SWE-Bench Grounding Eval

## 背景与目标

Feature 155 实现了 Spectra MCP 的三个 agent-context tool（`impact` / `context` / `detect_changes`）。这三个 tool 的核心价值假说是：**与其把整个 spec.md 作为 system prompt push 给 agent（10k+ token），不如让 agent 按需 pull 精确 context（约 120 token），grounding lift 效果应至少相当，且 token 成本大幅下降。**

然而 Sprint 3 Phase 5 实测显示，spec.md push 方式的 grounding lift = 0（与 baseline 无显著差异）。Feature 158 的目标是用 **SWE-Bench 风格 task fixture** 系统地验证这一假说，通过 3 组对比实验（A: bare baseline / B: spec.md push / C: MCP pull）产出可重现的 pass rate 矩阵和 token 效率静态对比数据。

**预算约束**：~$50 实测 + ~2 周开发。  
**统计声明**：本评测为小样本探索性 pilot（5-8 个 task，目标 8 个，验收下限 5 个），不构成统计显著性声明。

---

## 前置条件验证

以下 5 个前置条件中，P1 已 spec 阶段验证；P2-P5 必须在 plan / implement 阶段逐一验证，否则对应实施路径需降级。

| ID | 前置条件 | 验证方式 | 状态 | 影响 |
|----|---------|---------|------|------|
| P1 | `claude --mcp-config <json>` 及 `--strict-mcp-config` flag 存在且可用 | `claude --help \| grep mcp` 本机确认 | ✅ 已验证（spec 阶段完成） | 决定 Group C 实施路径；若不可用，降级为 `.claude/mcp.json` 项目级配置 |
| P2 | Spectra MCP server `dist/cli/index.js (CLI 子命令 `mcp-server`)` 已 build 且可独立 spawn（stdio 协议正常） | 先跑 `npm run build` 再 `node dist/cli/index.js (CLI 子命令 `mcp-server`)` 启动 + stdio health-check（调 `impact` 返回 `symbol-not-found` 而非 crash） | ⚠️ [硬前置，必须 implement 前完成] | 决定 Group C 能否稳定跑；若启动不稳定，需在脚本里加重试逻辑 |
| P3 | 选定 SWE-Bench Lite 任务在裸机可执行 `pip install -e . + pytest FAIL_TO_PASS` | 从候选 task 中取 3 个实测 | ⚠️ [硬前置，必须 implement 前完成] | 决定 oracle 路径；若无法裸机跑，退化为 ast-diff fuzzy 对比 |
| P4 | Spectra graph 覆盖目标 SWE-Bench 仓库（如 sympy / astropy / pytest）— 当前仓库 baseline 仅有 micrograd / nanoGPT / self-dogfood，目标仓库无 baseline | 对每个选定 task 的 target repo 跑 `npm run baseline:collect -- --target <repo>`，验证 `~/.spectra-baselines/<repo>-output/spectra-full/_meta/graph.json` 存在且非空 | ⚠️ [硬前置，必须 implement 前完成 — 单 repo baseline ~5-10 min × 3-5 个 repo = 15-50 min 增量成本] | 若 graph 为空，Group B/C 无 grounding 数据；必须在 eval 前补跑 |
| P5 | MCP server 侧 telemetry 机制可记录每次 tool call 的 name + response payload 字节数 | 当前 `src/mcp/agent-context-tools.ts` **不含** telemetry，需在 plan 阶段决定：① 在 server 内加 JSONL telemetry，② 通过 wrapper script spawn server 并 sniff stdio JSON-RPC | ⚠️ [硬前置，必须 implement 前完成] | 决定 Group C 是否能采集 token 静态对比数据；如不能采集，FR-E-002 / FR-B-006 的 mcpToolCallCount + payload bytes 需降级为"待手工估算"或本 Feature 删除该 SC |

---

## 用户场景与测试

### 用户故事 1 — SWE-Bench Lite Python 子集 Fixture 入库（优先级：P1）

作为需要验证 MCP grounding lift 的研究者，我希望在 `tests/baseline/swe-bench-lite/fixtures/` 目录下找到 5-8 个结构完整的 SWE-Bench Lite Python 任务 fixture，每个 fixture 含 oracle 定义，让我可以不依赖 Docker、不需要手动构造测试环境，就能复现 3 组对比实验的输入条件。

**为何 P1**：fixture 是整个评测的数据基础，没有合规 fixture 则后续所有对比实验无法执行。它也是独立可交付的——fixture 入库后哪怕其他脚本还未完成，数据层已可供外部使用。

**独立测试方式**：在 CI 环境下运行 `node scripts/verify-feature-158.mjs --fixture-only`，检查 fixture 数量 ≥ 5、JSON schema 合规、所有 fixture 的 `primaryOracle.kind` 为 `functional` 或 `ast-diff`。

**验收场景**：

1. **Given** `tests/baseline/swe-bench-lite/fixtures/` 目录存在，**When** 枚举其中所有 `SWE-L00X-*.json` 文件，**Then** 文件数量 ≥ 5 且每个文件均能通过 JSON schema 校验（含 `taskId` / `description` / `target` / `startCommit` / `prompt` / `primaryOracle` / `swebenchMeta` 全部字段）。

2. **Given** 一个 fixture 文件，**When** 解析其 `swebenchMeta` 字段，**Then** `swebenchMeta.createdAt`（issue 创建时间，从 GitHub API 派生）日期 ≥ `2024-01-01`（降低 Claude 训练集泄漏风险，instance_id 本身格式为 `owner__repo-PR-number` 不含日期），且 `swebenchMeta.goldPatch` 和 `swebenchMeta.testPatch` 均非空字符串。

3. **Given** 某个 fixture 的 `primaryOracle.kind` 为 `functional`，**When** 在 dry-run 模式下解析 oracle 的 `checks` 列表，**Then** 每条 check 含有效的 `cmd` 字符串和 `timeoutMs` 数值，且 `cmd` 中包含 `pytest` 关键字。

4. **Given** 所有入库 fixture，**When** 检查其 `target` 字段，**Then** 目标仓库均属于 Python 纯计算类项目（如 sympy、astropy、pytest-dev/pytest），不包含依赖 web 框架或数据库的仓库。

---

### 用户故事 2 — 3 组对比评测脚本可执行（优先级：P1）

作为 Spectra MCP 价值验证的执行者，我希望运行一条命令（`node scripts/eval-mcp-augmented.mjs --group A --task SWE-L001 --repeat 3`）就能完整跑通一个 task 的一个对照组，并在 `tests/baseline/swe-bench-lite/runs/` 目录下看到 JSON 结果文件，以便逐步积累 3 组 × 5-8 task 的对比数据。

**为何 P1**：这是评测假说的核心执行层。对比数据若无法产出，整个 Feature 的价值假说验证就无从实现。

**独立测试方式**：选取 1 个 fixture（如 `SWE-L001`），分别以 `--group A`、`--group B`、`--group C` 各跑 1 次（`--repeat 1`），确认三组均产出 `full.json` 且 schema 合规。

**验收场景**：

1. **Given** `eval-mcp-augmented.mjs` 和至少 1 个合规 fixture 存在，**When** 运行 `node scripts/eval-mcp-augmented.mjs --group A --task SWE-L001 --repeat 1 --dry-run`，**Then** 脚本输出预估 cost（单位 USD）和预估 run 次数，并以退出码 0 正常结束，不触发真实 claude 调用。

2. **Given** Group B 运行条件具备（目标仓库已完成 `baseline:collect`），**When** 运行 `--group B --task SWE-L001 --repeat 1`，**Then** `tests/baseline/swe-bench-lite/runs/B/SWE-L001/run-1.json` 被写入，包含 `group / taskId / repeatIndex / oracleResult / wallMs` 字段，且 `oracleResult` 值为 `pass` 或 `fail`。

3. **Given** Group C 运行条件具备（Spectra MCP server 已 build，P2 前置验证通过），**When** 运行 `--group C --task SWE-L001 --repeat 1`，**Then** 产出 `run-1.json` 还额外包含 `mcpToolCallCount` 字段（整数，记录 agent 实际调 MCP tool 的次数，可为 0）。

4. **Given** `--repeat 3` 运行一个 task 一组，**When** 脚本执行完毕，**Then** 对应目录下产出 3 个文件 `run-1.json` / `run-2.json` / `run-3.json`（`repeatIndex` 分别为 1、2、3），且脚本总体退出码 0（即使部分 run oracle = fail，脚本本身不应因 oracle fail 而退出码非零）。

---

### 用户故事 3 — 报告含 Token 效率静态对比 + 跨链接到 147 报告（优先级：P2）

作为关注 Spectra MCP ROI 的产品决策者，我希望在 `specs/158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md` 中找到 pass rate 矩阵、token cost 静态对比表，以及明确结论（哪组效果更好、token 节省了多少），同时能从 147 号报告一键跳转查阅详情。

**为何 P2**：报告是评测数据的呈现层，依赖 P1 的对比实验产出数据。在实验数据生成前，报告框架可以预先搭建（章节结构、静态 token 对比表），但最终数字和结论必须基于真实实验数据人工撰写，所以它是 P2（呈现层，不阻塞核心数据采集）。

**独立测试方式**：验证 `competitive-evaluation-report.md` 存在且包含 4 个必须章节的 Markdown 标题，以及 `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` 含有指向 157 报告的相对路径链接。

**验收场景**：

1. **Given** `competitive-evaluation-report.md` 已生成，**When** 解析其 Markdown 结构，**Then** 文件含以下 4 个章节标题：`实验设计`、`Pass Rate 矩阵`、`Token Cost 静态对比`、`结论`，且章节顺序符合报告结构要求。

2. **Given** Token Cost 静态对比章节，**When** 检查对比表，**Then** 表格至少包含 3 行数据：Group A（0 额外 token）/ Group B（spec.md 字符数 × 4 估算 tokens）/ Group C（MCP response payload 字节数），以及各组对应的数值（静态测量，非 runtime 捕获）。

3. **Given** Pass Rate 矩阵章节存在，**When** 检查矩阵内容，**Then** 矩阵至少包含 5 行 task 数据和 3 列组别（A / B / C），并在矩阵下方标注"本评测为小样本探索性 pilot（N=5-8 task），不构成统计显著性声明"。

4. **Given** `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md`，**When** 在文件中搜索指向 157 的链接，**Then** 能找到格式为 `[...](../../158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md)` 或等效的相对路径 Markdown 链接。

---

### 边界情况

- **EC1：SWE-Bench Lite 任务裸机 pytest 失败（系统依赖缺失，如 C extension）**  
  → fixture 状态字段 `status` 标记为 `deferred`，从 5-8 task 中替换候补，维持总数 ≥ 5 个可执行 fixture。替换候选仓库：sympy / astropy / pytest-dev/pytest（纯 Python 计算类）。

- **EC2：Group C agent 不主动调 MCP tool（mandatory instruction 失效）**  
  → 在 `full.json` 的 `mcpToolCallCount` 字段记录实际调用次数（可为 0）。报告分析时区分"agent 调过 tool"与"agent 完全忽略 tool"两种情况，避免将 Group C 中无 MCP 调用的 run 误计为 MCP-grounded 数据点。

- **EC3：Spectra graph 未覆盖目标仓库（如 sympy 未跑过 `baseline:collect`）**  
  → 实施前每个 task 的目标仓库必须前置运行 `npm run baseline:collect -- --target <repo>`，验证 `_meta/graph.json` 存在且非空。graph 为空时 Group B/C 降级：Group B 注入空 spec.md（视为 bare）、Group C MCP tool 返回空结果，结果在报告中单独标注。

- **EC4：`--mcp-config` flag 在实施环境不可用**  
  → P1 已验证 flag 存在。若实施时仍失败（版本升级后 flag 改名），fallback 方案为在 eval worktree 目录下写入 `.claude/mcp.json` 项目级配置，达到同等效果。

- **EC5：$50 预算超支风险**  
  → eval 脚本支持 `--dry-run` flag，先估算总 API 调用次数。Opus judge 调用次数上限 ≤ 20 次；全量评测前用 `--dry-run` 确认总估算成本 < $40（留缓冲）。

- **EC6：5-8 task 统计功效不足，对照组差异不显著**  
  → 报告中明确标注"探索性 pilot 评测，不声明统计显著性"。如数据支持，可附 N=3 重复的 bootstrap 95% CI（复用 `scripts/eval-batch-repeat.mjs` 的 `bootstrapPercentileCi` 函数），但不以此声称结论可推广。

- **EC7：SWE-Bench Lite 任务训练集泄漏，Group A baseline 虚高**  
  → 优先选 issue createdAt ≥ 2024-01 的 instance（instance_id 本身不含日期，需从 GitHub API 派生 createdAt）；报告结论中明确标注"存在训练集泄漏风险，Group A pass rate 可能因 Claude 训练集包含相关 patch 而虚高"。

- **EC8：HuggingFace 数据集下载失败（网络或限流）**  
  → fixture 转换脚本必须支持本地缓存（`~/.cache/huggingface/datasets/`）；若 CI 网络受限，把转换后的 5-8 个最终 fixture 直接 commit 入库（一次性 5-50 KB），避免每次 verify 都拉取 HF。

- **EC9：SWE-Bench Lite 与 SWE-Bench Verified 数据集混淆**  
  → fixture 转换脚本必须显式指定 `princeton-nlp/SWE-bench_Lite`（split=`test`），并在 fixture 中记录 `swebenchMeta.dataset = 'lite'`，以便后续追溯。

- **EC10：`eval-task-runner.mjs` 已导出函数将来发生 breaking change**  
  → `eval-mcp-augmented.mjs` 通过 import 复用的函数列表必须在 spec 中明确（见 FR-B-001 备注）；如果 runner 重构破坏接口，本 Feature 单独适配，不阻塞其他 eval 流程。

- **EC11：多 worktree 并行 eval 时资源/状态干扰**  
  → 复用 `~/.spec-driver-bench-worktrees/<task>/<tool>/` 协议，每个 (task, group, repeatIndex) 对应独立 worktree 子目录；MCP server 实例独立 spawn（每个 run 用独立临时端口/stdio 不共享）。

- **EC12：goldPatch 与 git diff HEAD 格式不一致（行结尾、空白、context lines）**  
  → ast-diff 退化 oracle 在比对前必须做 normalize（trim trailing whitespace / 统一 LF / 移除 unified diff 的 context lines `^[+\-]` 之外的部分），归一化后再比对相似度。

- **EC13：Spectra MCP server 因 build 缓存陈旧，行为与最新代码不一致**  
  → `eval-mcp-augmented.mjs --group C` 启动前必须验证 `dist/cli/index.js (CLI 子命令 `mcp-server`)` mtime ≥ src/mcp/ 任意 .ts mtime，否则报错并提示 `npm run build`。

- **EC14：claude CLI 在不同 Claude Code 版本下 `--mcp-config` 行为差异**  
  → eval 脚本启动时记录 `claude --version` 到 `full.json` 的 `claudeCliVersion` 字段，便于报告复现。如未来 flag 改名，结合 P1 fallback 路径处理。

---

## 功能需求

### FR-A：数据集与 Fixture [必须]

- **FR-A-001** [必须]：系统 MUST 在 `tests/baseline/swe-bench-lite/fixtures/` 目录下提供 ≥ 5 个 SWE-Bench Lite Python 子集任务 fixture 文件，命名格式为 `SWE-L00X-<repo>-<short-desc>.json`（X 为 3 位零填充序号）。  
  *可追踪至：用户故事 1、SC-001*

- **FR-A-002** [必须]：每个 fixture JSON 文件 MUST 包含以下全部顶层字段：`taskId`（字符串）/ `description`（字符串）/ `target`（`owner/repo` 格式）/ `startCommit`（git commit hash）/ `prompt`（任务描述，来源于 `problem_statement`）/ `primaryOracle`（含 `kind` 和 `checks` 的对象）/ `swebenchMeta`（含 `instanceId` / `dataset` / `createdAt` / `mergedAt` / `failToPass` / `passToPass` / `goldPatch` / `testPatch` 的对象）。`createdAt` 和 `mergedAt` 来自 GitHub API（issue/PR 的 ISO 8601 时间戳）；`dataset` 固定为 `'lite'`。  
  *可追踪至：用户故事 1、SC-002、EC-9*

- **FR-A-003** [必须]：所有 fixture MUST 仅选取 Python 语言的目标仓库，且 `swebenchMeta.createdAt` 日期 ≥ `2024-01-01T00:00:00Z`（注意：instance_id 本身格式为 `owner__repo-PR-number` 不含日期，必须用 createdAt 字段）。**降级条款（CON-2 解决）**：若过滤后候选 task 数量 < 5，可放宽到 ≥ `2023-07-01T00:00:00Z`（Claude 3 训练截止前），并在 `competitive-evaluation-report.md` §6.4 结论中显式标注"日期阈值已降级到 2023-07-01"以及该选择的训练集泄漏风险评估。  
  *可追踪至：用户故事 1、EC-7、CON-2*

- **FR-A-004** [必须]：每个 fixture 的 `primaryOracle` MUST 定义至少 1 条 FAIL_TO_PASS pytest 检查，成功判定条件为：FAIL_TO_PASS 列表中全部测试转绿 + PASS_TO_PASS 列表中无新 regression。若裸机执行 pytest 不可行（系统依赖缺失），MUST 降级为 `kind: ast-diff`（行级匹配 ≥ 60% 视为 pass），并在 fixture `status` 字段标注 `degraded-oracle`。  
  *可追踪至：用户故事 1、EC-1*

- **FR-A-005** [必须]：Fixture 不使用官方 SWE-Bench Docker harness，MUST 可在裸机通过 `pip install -e .` + `pytest` 方式验证（或在 ast-diff 退化路径下无需 Python 执行环境，仅需 git 与 Node.js，不需要 `pip install -e .`）。  
  *可追踪至：调研结论：不使用 Docker harness、A-1*

- **FR-A-006** [可选]：fixture 中 MAY 包含可选字段 `status`（枚举：`active` / `deferred` / `degraded-oracle`）和 `notes`（字符串），用于记录选取理由或降级原因。

### FR-B：评测脚本 `scripts/eval-mcp-augmented.mjs` [必须]

- **FR-B-001** [必须]：系统 MUST 提供独立脚本 `scripts/eval-mcp-augmented.mjs`，通过 `import` 复用 `scripts/eval-task-runner.mjs` 已导出函数的**精炼子集**（plan 阶段最终决定为 `prepareWorktree / runTask / runPrimaryOracle / captureProductMetrics`；其他函数如 `loadSpectraContext` 因 target map 不含 SWE-Bench 仓库 而**不**直接 import，由本 Feature 在 `eval-mcp-augmented.mjs` 内自实现 `loadSpectraContextForSweBench`），**不得**修改 `eval-task-runner.mjs` 中的 `SUPPORTED_TOOLS` 常量或现有 tool 逻辑。具体 import 清单以 plan.md §4 为准。如未来 runner 重构破坏 import 接口，本 Feature 自适配（EC-10）。  
  *可追踪至：用户故事 2、调研方案 A 推荐、EC-10、Analyze F-010 修复*

- **FR-B-002** [必须]：脚本 MUST 支持 `--group A|B|C` 参数，切换对照组：A = bare baseline，B = spec.md push，C = MCP pull。参数缺失时 MUST 报错并输出用法说明。  
  *可追踪至：用户故事 2、FR-C*

- **FR-B-003** [必须]：脚本 MUST 支持 `--task <taskId>` 参数，指定运行单个 task（taskId 与 fixture 的 `taskId` 字段精确匹配）。  
  *可追踪至：用户故事 2*

- **FR-B-004** [必须]：脚本 MUST 支持 `--repeat N` 参数（默认 N=3），对每个 (group, task) 组合重复运行 N 次，每次产出独立的运行结果文件 `run-<N>.json`（路径 `tests/baseline/swe-bench-lite/runs/<group>/<taskId>/run-<N>.json`，N=1, 2, 3, ...）。**全文统一使用 `run-<N>.json` 命名**（非 `full.json`），消除歧义 A-2。  
  *可追踪至：用户故事 2、A-2*

- **FR-B-005** [必须]：脚本 MUST 支持 `--dry-run` 参数，在不触发真实 claude API 调用的情况下输出预估 run 次数、预估 cost（单位 USD）、各 group 参数配置摘要，并以退出码 0 正常退出。  
  *可追踪至：EC-5、SC-003*

- **FR-B-006** [必须]：每次 run 产出的 `full.json` MUST 包含以下字段：`group`（A/B/C）/ `taskId` / `repeatIndex`（1-based 整数）/ `oracleResult`（`pass` / `fail` / `error`）/ `wallMs`（整数毫秒）/ `timestamp`（ISO 8601 字符串）/ `costUsd`（数值，估算成本，dry-run 时为 0）/ `claudeCliVersion`（字符串，启动时从 `claude --version` 捕获）。Group C 的输出 MUST 额外包含 `mcpToolCallCount`（整数，agent 实际调用 MCP tool 的次数，无调用时为 0）和 `mcpResponseBytes`（整数，所有 MCP tool response payload 字节数累计），数据来源见 FR-G。  
  *可追踪至：用户故事 2、EC-14、FR-G*

- **FR-B-007** [必须]：脚本整体退出码 MUST 为 0（即使部分 run 的 `oracleResult` 为 `fail`），仅在脚本自身发生 infrastructure error（如 claude 调用抛出非预期异常、fixture 解析失败）时退出码为非零。  
  *可追踪至：用户故事 2 验收场景 4*

- **FR-B-008** [必须]：脚本 MUST 支持 `--stop-loss <USD>` 参数（默认 $40，留 $10 缓冲），累计 `costUsd` 超过阈值时立即停止后续 run 并以退出码 0 + 警告信息正常退出（已写入的 `full.json` 不删）。MUST 同时支持 `--max-judge-calls <N>` 参数（默认 20）限制 Opus judge 调用次数。  
  *可追踪至：EC-5、调研预算约束*

### FR-C：3 组对比设计与执行 [必须]

- **FR-C-001** [必须]：Group A（bare baseline）MUST 仅以 fixture 的 `prompt` 字段内容调用 claude，不附加任何额外 context，不启用 MCP server。调用方式复用 `eval-task-runner.mjs` 的 `control` tool 逻辑。  
  *可追踪至：用户故事 2*

- **FR-C-002** [必须]：Group B（spec.md push）MUST 在调用 claude 前，从 `~/.spectra-baselines/<repo>-output/spectra-full/modules/` 加载目标仓库的 Spectra spec.md 内容（通过复用 `loadSpectraContext` 函数），将其作为 system prompt 前缀注入。若目标仓库的 spec.md 不存在，MUST 降级为 Group A 行为并在 `full.json` 中标注 `specPushDegraded: true`。  
  *可追踪至：用户故事 2、EC-3*

- **FR-C-003** [必须]：Group C（MCP pull）MUST 在调用 claude 前构造临时 `mcp-config.json`（server 名 `spectra`，注册本仓库 `dist/cli/index.js (CLI 子命令 `mcp-server`)`），通过 `claude --mcp-config <tmp-file> --strict-mcp-config` flag 让 agent 能访问以下 3 个工具（client 侧暴露名）：  
  - `mcp__spectra__impact`，入参 `target: string`（symbol id）+ 可选 `depth`、`minConfidence`、`budget`  
  - `mcp__spectra__context`，入参 `symbolId: string` + 可选 `include: string[]`  
  - `mcp__spectra__detect_changes`，入参 `diff: string` 或 `baseRef: string`（二选一，可选 `projectRoot`）  
  System prompt MUST 包含 mandatory tool use instruction，引导 agent 在修复前调用 `mcp__spectra__context` 确认 symbol 定义、调 `mcp__spectra__impact` 评估影响范围。  
  *可追踪至：用户故事 2、EC-2、EC-4、`src/mcp/agent-context-tools.ts:127/238/388`*

- **FR-C-004** [必须]：3 组对比 MUST 覆盖 ≥ 5 个 fixture task（目标 8 个，验收下限 5 个），每组每 task 完成 N=3 重复（总计 ≥ 45 runs，stop-loss 豁免见 SC-004）。  
  *可追踪至：SC-004、CON-1*

### FR-D：Oracle 设计 [必须]

- **FR-D-001** [必须]：主 oracle（`kind: functional`）MUST 执行以下两步验证：① `FAIL_TO_PASS` 列表中的所有 pytest test id 全部转绿；② `PASS_TO_PASS` 列表中的所有 pytest test id 无新 regression。两步均通过时 `oracleResult = pass`，任一步失败时 `oracleResult = fail`。  
  *可追踪至：用户故事 1*

- **FR-D-002** [必须]：退化 oracle（`kind: ast-diff`）通过 `runPrimaryOracle` 既有 `ast-diff` 分支语义实现：每条 `oracle.checks[]` 是一个 bash 命令，`status === 0` 视为 PASS（参见 `scripts/eval-task-runner.mjs:249-260`）。本 Feature MUST 新增脚本 `scripts/eval-diff-fuzzy-match.mjs`，接受 `--expected <patch-file>` 与 `--actual <patch-file>` 参数，执行 normalize（trim 尾空白 / 统一 LF / 移除 unified diff context lines）后做行级 token 匹配。**初始阈值 60% → 退出码 0**；plan 阶段可在 [50%, 70%] 范围内根据对 ≥ 3 个候选 task 实测 ground truth 微调，最终值须在 plan.md 中以"实测依据 + 调整理由"形式记录。fixture 的 `oracle.checks[]` 写形如 `node scripts/eval-diff-fuzzy-match.mjs --expected <path-to-goldpatch.diff> --actual <(git diff HEAD)>`。  
  *可追踪至：用户故事 1、EC-1、EC-12、U-2、`scripts/eval-task-runner.mjs:249-260`*

- **FR-D-003** [可选]：oracle 执行 MAY 支持 `timeoutMs` 字段（fixture 级配置），超时时 `oracleResult = error` 并在 `full.json` 中记录 `oracleError: "timeout"`。

### FR-E：报告生成 [必须]

- **FR-E-001** [必须]：系统 MUST 在 `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` 中**新增「SWE-Bench Grounding Lift 实验」章节**（按用户原始验收要求"§6 含完整对比 + 数据 + 结论"）。**章节号偏离说明（implement 阶段确认）**：147 §6 在落地前已被「Fixture 完整清单」占用，本 Feature 实际新增章节为 **§10**（不是原 spec 写的 §6），含 4 个子章节：`10.1 实验设计` / `10.2 Pass Rate 矩阵` / `10.3 Token Cost 静态对比` / `10.4 结论`。verify 脚本、跨链接、tasks、checklist 均已同步修订。功能完全满足"独立章节 + 完整对比 + 数据 + 结论"语义，仅章节序号从 §6 调整为 §10。**§6 内容分工（A-4 解决）**：147 §6 含完整 4 个子章节实质内容（Pass Rate 矩阵 + Token Cost 表直接嵌入，方便独立阅读），章节末尾加跨链接指向 detail 报告；`specs/158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md` detail 报告含 §6 数据 + per-run 明细（每个 run 的 oracleResult / wallMs / mcpToolCallCount）+ 风险展开分析。两份文档的 Pass Rate 矩阵 / Token Cost 表的数据数字 MUST 一致（由同一脚本生成同一份数据，分别引用）。Pass Rate 矩阵和 Token Cost 静态对比表数据可由脚本自动生成；结论子章节 MUST 由人工撰写（not auto-generated）。  
  *可追踪至：用户故事 3、SC-005、原始验收第 3 条、A-4*

- **FR-E-002** [必须]：Token Cost 静态对比表 MUST 包含以下 3 行静态测量数据（不依赖 claude CLI runtime token 输出，数据来源见 FR-G）：  
  - Group A：额外 grounding context = 0 tokens  
  - Group B：Spectra spec.md 字符数 × 0.25（chars → tokens 估算系数 ≈ 1 token / 4 chars）  
  - Group C：取自 MCP telemetry JSONL 日志，求所有 tool call response payload bytes 之和 × 0.25  
  *可追踪至：用户故事 3、调研冲突 3 合并立场、FR-G、P5*

- **FR-E-003** [必须]：Pass Rate 矩阵 MUST 以表格形式展示 (task × group) 的 pass rate（格式：`x/N`，如 `2/3`），并在表格下方明确标注"本评测为小样本探索性 pilot（N=5-8 task，目标 8 个，验收下限 5 个），不构成统计显著性声明"。  
  *可追踪至：用户故事 3、EC-6、调研统计可信度声明、U-1*

- **FR-E-004** [必须]：147 §6 子章节末尾 MUST 添加指向 Feature 158 detail 报告的 Markdown 相对路径链接，格式为 `[完整明细 → SWE-Bench Grounding Lift Detail Report](../158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md)`。  
  *可追踪至：用户故事 3、SC-008*

- **FR-E-005** [可选]：报告 MAY 包含 Group C 中 `mcpToolCallCount = 0` 与 `> 0` 的 run 分别统计的子矩阵，用于区分"agent 实际使用 MCP"与"agent 忽略 MCP"两种情况。

### FR-F：独立验收脚本 [必须]

- **FR-F-001** [必须]：系统 MUST 提供 `scripts/verify-feature-158.mjs`，复用 `verify-feature-156.mjs` 的 step/report 模式（`parseArgs` / 步骤函数 / JSON 报告输出）。  
  *可追踪至：SC-007*

- **FR-F-002** [必须]：验收脚本 MUST 验证以下检查点，任一失败则退出码为 1：  
  ① fixture 数量 ≥ 5（`tests/baseline/swe-bench-lite/fixtures/` 目录枚举）  
  ② 所有 fixture JSON schema 合规（含全部必须字段，含 createdAt / dataset）  
  ③ 能以 dry-run 模式调用 eval-mcp-augmented.mjs（不触发真实 API 调用）  
  ④ dry-run 时 `SPECTRA_MCP_TELEMETRY_PATH` 环境变量正确注入子进程命令行（即 SC-009a 检查）  
  ⑤ 147 报告 §6 章节存在且含 4 个子章节标题（`6.1 实验设计` / `6.2 Pass Rate 矩阵` / `6.3 Token Cost 静态对比` / `6.4 结论`）  
  ⑥ 147 §6 末尾跨链接指向 157 detail 报告（SC-008）  
  
  **验收脚本范围边界（T-1 解决）**：以下 SC 需要真实 eval run 后人工或非 CI 环境确认，不在 verify 脚本范围内：SC-004（≥45 runs，post-eval 人工确认）/ SC-005（§6 实质内容判定，spec-review 阶段确认）/ SC-006（Token Cost 数值，post-eval 数据填入后确认）/ SC-009b（telemetry JSONL 文件存在，post-eval 后验证）。  
  *可追踪至：SC-007、SC-009a、T-1*

- **FR-F-003** [必须]：验收脚本 MUST 将验证结果输出至 `specs/158-swe-bench-lite-grounding-eval/impl-supplement/verification/verification-report.md`，格式含通过/失败的检查点列表、总体状态（PASS / FAIL）、以及"不在 verify 范围内的 SC 列表"以避免误解。  
  *可追踪至：SC-007、verify-feature-156 pattern、T-1*

- **FR-F-004** [YAGNI-移除]：~~验收脚本不应执行完整的 3 组对比实验运行~~。CI 中的完整 eval 运行成本过高（~$15-25），不应作为 verify 脚本的默认行为。`verify-feature-158.mjs` 只做结构检验，不触发 claude API 调用。

### FR-G：MCP Telemetry 桥接 [必须]

- **FR-G-001** [必须]：为支持 FR-B-006 的 `mcpToolCallCount` 与 `mcpResponseBytes` 采集，本 Feature 必须实现 MCP server 侧 telemetry 机制。**首选方案 A**：在 `src/mcp/agent-context-tools.ts` 的 3 个 handler（handleImpact / handleContext / handleDetectChanges）入口加最小侵入 telemetry hook，通过环境变量 `SPECTRA_MCP_TELEMETRY_PATH=<jsonl-file>` 控制是否启用，启用时把每次调用追加一行 JSON：`{ts, toolName, requestSize, responseSize, durationMs, runId}`。**备选方案 B**：通过 wrapper script 启动 server 并 sniff stdio JSON-RPC（无需改动 src/）。**plan 阶段决策标准（U-3 解决）**：若 P2 验证显示 MCP server 启动稳定且 stdio JSON-RPC 协议无异常 → 选方案 A（侵入式 hook，更精确）；若 P2 验证显示 stdio 不稳定 / 协议有变动 / 修改 src/ 风险评估为高 → 选方案 B（wrapper sniff，零侵入）。最终选择须在 plan.md 中明确记录依据。  
  *可追踪至：FR-B-006、FR-E-002、P5、Codex C-4、U-3*

- **FR-G-002** [必须]：telemetry 在 `SPECTRA_MCP_TELEMETRY_PATH` 未设置或文件不可写时 MUST 静默降级（不影响正常 MCP 响应），且 telemetry 写入失败不能阻塞 MCP request 返回。  
  *可追踪至：架构约束（不破坏 Feature 155 现有合同）*

- **FR-G-003** [必须]：`eval-mcp-augmented.mjs` Group C 启动子进程时 MUST 传 `SPECTRA_MCP_TELEMETRY_PATH` 指向独立文件 `<runtime-tmp>/mcp-telemetry-<runId>.jsonl`，并在 run 结束后解析该文件 → 计算 mcpToolCallCount + mcpResponseBytes 写入 `full.json`。  
  *可追踪至：FR-B-006、用户故事 2 验收场景 3*

---

## 关键数据实体

- **TaskFixture**：单个评测任务的完整定义，含 task 描述、起始状态（commit）、oracle 规则、SWE-Bench 元数据。路径：`tests/baseline/swe-bench-lite/fixtures/SWE-L00X-*.json`。

- **RunResult**：单次 (group, task, repeatIndex) 运行的输出快照，含 oracle 结果、耗时、MCP 调用次数（Group C）。路径：`tests/baseline/swe-bench-lite/runs/<group>/<taskId>/run-<N>.json`。

- **GroundingLiftReport**：3 组对比的汇总报告，含 pass rate 矩阵、token 静态对比表、人工结论。路径：`specs/158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md`。

---

## 成功标准

### 可量化验收指标

- **SC-001**：`tests/baseline/swe-bench-lite/fixtures/` 目录下存在 ≥ 5 个 `SWE-L00X-*.json` 文件（目标 8 个，验收下限 5 个），且 JSON schema 校验全部通过（`verify-feature-158.mjs` 检查点 ① ② 均为 PASS）。

- **SC-002**：所有入库 fixture 均可在 dry-run 模式下被 `eval-mcp-augmented.mjs` 正常解析（不抛 JSON parse error / schema violation），dry-run 以退出码 0 正常退出。

- **SC-003**：`scripts/eval-mcp-augmented.mjs` 脚本存在且实现完整，支持 `--group A|B|C` / `--task <taskId>` / `--repeat N` / `--dry-run` 全部参数，`--help` 或参数缺失时输出用法说明。

- **SC-004**：3 组对比实验（A / B / C）分别对 ≥ 5 个 task 各完成 N=3 重复（总计 ≥ 45 runs），`tests/baseline/swe-bench-lite/runs/` 目录下存在对应 `run-<N>.json` 文件（含真实 oracle 执行结果）。**Stop-loss 豁免（CON-1 解决）**：若因 `--stop-loss <USD>` 提前停止导致总 runs < 45，以实际产出 runs 目录中的文件为准，不强制要求 ≥ 45；但报告必须显式标注"实验因预算限制提前停止（完成 X/45 runs）"，此时 SC-004 视为"条件达成"（非 fail）。SC-004 是 post-eval 人工确认项，不在 verify-feature-158 自动检查范围。

- **SC-005**：`specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` 含 §6 章节，且 §6 含 4 个子章节标题（`6.1 实验设计` / `6.2 Pass Rate 矩阵` / `6.3 Token Cost 静态对比` / `6.4 结论`），每子章节均有实质内容（非空占位符）。同时 `specs/158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md` detail 报告存在且非空。

- **SC-006**：Token Cost 静态对比表至少包含 3 行数据（Group A / B / C 的 token 数量对比），Group B 的 spec.md 字符数和 Group C 的 MCP telemetry JSONL 解析结果均有明确数值。

- **SC-007**：`scripts/verify-feature-158.mjs` 在 CI 环境（无 claude API key、无 docker、无网络）下以退出码 0 完成运行（所有 fixture schema 检查通过），并产出 `verification-report.md`。CI 环境无 HuggingFace 网络访问时，verify 必须能从已 commit 入库的 fixture 直接验证（不触发 HF 拉取，见 EC-8）。

- **SC-008**：`specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` 的 §6 末尾含指向 Feature 158 detail 报告的有效 Markdown 相对路径链接。

- **SC-009a**（CI 可验证）：在 `eval-mcp-augmented.mjs --group C --dry-run` 时，脚本内部的子进程命令行（log 输出可见）必须包含 `SPECTRA_MCP_TELEMETRY_PATH=<某有效路径>`，证明环境变量正确注入。该检查由 verify-feature-158.mjs 检查点 ④ 自动覆盖。

- **SC-009b**（真实 eval 后验证，post-eval 人工确认）：完成至少 1 次非 dry-run Group C run 后，对应 `<runtime-tmp>/mcp-telemetry-<runId>.jsonl` 文件存在且能被 `JSON.parse` 逐行解析（记录数 ≥ 0 均可接受；agent 完全未调用 MCP tool 时空文件 / 0 行也合理）。SC-009b 不在 verify-feature-158 自动检查范围。

---

## 范围界定

### MVP 范围内（本 Feature 交付）

- SWE-Bench Lite Python 子集 5-8 task fixture（目标 8 个，验收下限 5 个；单文件 / 简单 patch / 裸机可执行 oracle）
- `scripts/eval-mcp-augmented.mjs` 独立脚本（3 组对比 + dry-run 支持）
- 3 组 × ≥ 5 task × N=3 次完整实验数据
- `competitive-evaluation-report.md`（pass rate 矩阵 + token 静态对比 + 人工结论）
- `scripts/verify-feature-158.mjs` 独立验收脚本
- 147 报告跨链接

### 明确 Out-of-scope（当前 Feature 不做）

- **多语言扩展**（Multi-SWE-bench TypeScript / Go / Java task）— 留 P2 Future
- **第 4 对照组**（baseline + Read/Grep 自由搜索）— 留 Future work；当前 $50 预算不支持
- **官方 SWE-Bench Docker harness 集成**（67 GiB 镜像 + root 权限，与现有 worktree rsync 架构不兼容）
- **300 task 全量评测**（需 $500+ 预算，超出本 Feature 范围）
- **claude CLI runtime token count 解析**（`claude --print` 当前不返回 token usage；等待 CLI 升级）
- **task 难度分层分析**（按 patch 大小 / 复杂度切桶，需要更大样本量才有意义）
- **Spectra graph 的 Python callSites 覆盖质量改进**（属于 Feature 155 的 followup，不在本 Feature 范围）

---

## 复杂度评估（供 GATE_DESIGN 审查）

### 组件与接口统计

| 维度 | 计数 | 明细 |
|------|------|------|
| 新增组件/模块 | 4 | `scripts/eval-mcp-augmented.mjs`（评测脚本）+ `scripts/verify-feature-158.mjs`（验收脚本）+ `scripts/eval-diff-fuzzy-match.mjs`（ast-diff fuzzy matcher）+ `scripts/swe-bench-fixture-import.mjs`（HF dataset → fixture 转换器，一次性使用） |
| 新增接口/契约 | 5 | TaskFixture JSON schema / RunResult JSON schema / MCP config JSON 临时文件 / MCP telemetry JSONL schema / 147 §6 章节模板 |
| 新引入外部依赖 | 1 | `datasets`（Python HuggingFace，仅用于 fixture 转换 + 一次性 Python 脚本；不入 package.json） |
| 内部代码改动 | 中 | `src/mcp/agent-context-tools.ts` 加 telemetry hook（FR-G-001 首选方案）— 这是 Feature 155 已 ship 模块的最小侵入修改，需补单测 |
| 跨模块耦合 | 中 | `import` 复用 `eval-task-runner.mjs` 已导出函数 + 修改 src/mcp/ 加 telemetry；不修改 `SUPPORTED_TOOLS` |

### 复杂度信号

| 信号类型 | 存在？ | 说明 |
|---------|--------|------|
| 递归结构 | 否 | — |
| 状态机 | 否 | — |
| 并发控制 | 否 | N=3 重复为串行执行（可选并发，不作为 MVP 要求） |
| 数据迁移 | 否 | 仅新增 fixture 目录，不改动现有 baseline 数据 |
| 外部系统集成 | 是 | Group C 需要 spawn Spectra MCP server 子进程（stdio 协议），有启动稳定性风险 |

### 总体复杂度：**MEDIUM**

- 组件数 = 4（≥ 3 阈值），接口数 = 5（≥ 4 阈值）
- 存在 2 个复杂度信号：① 外部进程 spawn（MCP server）② 修改 Feature 155 已 ship 的合同区代码加 telemetry
- 主要不确定性来自 P2/P3/P4/P5 前置条件验证结果（MCP server 稳定性、裸机 pytest 可行性、telemetry 集成方式）
- GATE_DESIGN 建议：在 plan 阶段明确 ① MCP server health-check 机制 ② telemetry 方案 A vs B 的最终选择 ③ ast-diff 60% 阈值的实测依据 ④ baseline:collect 对 sympy/astropy/pytest 的预跑增量成本

---

## Codex 对抗审查迭代记录

### 第 1 轮 Codex Review（2026-05-09，phase=specify）

Codex 找出 4 CRITICAL + 4 WARNING + 2 INFO，全部已在本 spec.md 中修复：

| Codex finding | 类型 | spec.md 修复点 |
|--------------|-----|---------------|
| C-1: instance_id 不含日期，FR-A-003 不可实现 | CRITICAL | 改 FR-A-002/003 用 `swebenchMeta.createdAt` 字段（GitHub API 派生）|
| C-2: 目标仓库无 baseline，Group B/C 系统降级 | CRITICAL | P4 升级为硬前置 + EC-3 已声明 |
| C-3: runPrimaryOracle 无 fuzzy 60% 逻辑 | CRITICAL | FR-D-002 改为新增 `eval-diff-fuzzy-match.mjs` 脚本，60% 阈值 plan 阶段确认 |
| C-4: MCP server 无 telemetry，token 采集无路径 | CRITICAL | 新增 FR-G 章节（3 条 FR）+ P5 前置条件 + SC-009 |
| W-1: 用户原始要求 §6，spec 偏离为独立报告 | WARNING | FR-E-001 改为"在 147 报告加 §6"+ 独立 detail 报告作为 §6 延伸 |
| W-2: EC 漏 7 项 | WARNING | 新增 EC-8 ~ EC-14（HF 下载 / 数据集混淆 / runner breaking / worktree 并行 / patch normalize / build 缓存 / CLI 跨版本）|
| W-3: SC-004 无 stop-loss | WARNING | 新增 FR-B-008（`--stop-loss` + `--max-judge-calls`）|
| W-4: 工具名 `spectra_*` 错误 | WARNING | FR-C-003 改为 `mcp__spectra__impact / context / detect_changes`，并对齐 input schema |
| I-1: 主缺口 C-4 / W-1 | INFO | 已修 |
| I-2: dist/ 不存在，需 npm run build | INFO | P2 加"先跑 npm run build" |

修复后 spec 行数 +47，FR 总数 21 → 24（FR-G 加 3 条）+ SC 8 → 9 + EC 7 → 14。

### 第 2 轮 Clarify Pass（2026-05-09，phase=clarify）

Clarify 子代理（独立执行，未读 codex review）扫描 spec.md 全文后发现 5 未决项 + 4 歧义点 + 2 冲突，输出 11 条 spec 修订建议（见 `specs/158-swe-bench-lite-grounding-eval/impl-supplement/clarification.md`），全部已应用：

| 修订 | 涉及位置 | 修改要点 | 解决问题 |
|------|---------|---------|---------|
| M-1 | 全文（背景 / SC-001 / FR-C-004 / FR-E-003 / MVP）| 统一 "5-8 个（目标 8 个，验收下限 5 个）" | U-1 数量歧义 |
| M-2 | FR-D-002 | "初始 60%，plan 阶段 [50%, 70%] 内微调" | U-2 阈值层次 |
| M-3 | FR-G-001 | 补充 P2 验证稳定 → 方案 A，反之 → 方案 B | U-3 telemetry 决策标准 |
| M-4 | P3 前置条件 | 改为 [硬前置，必须 implement 前完成] | U-4 措辞 |
| M-5 | SC-004 | 加 stop-loss 豁免条款 | CON-1 |
| M-6 | FR-A-003 | 补降级条款（候选 < 5 时放宽到 2023-07） | CON-2 |
| M-7 | FR-A-005 | "无需执行环境" → "无需 Python 执行环境（仅需 git + Node.js）" | A-1 |
| M-8 | FR-B-004 / 用户故事 2 验收 | 统一 `run-<N>.json`（去掉 `full.json`） | A-2 |
| M-9 | SC-009 → SC-009a + SC-009b | 拆 CI 可验证 + post-eval 验证 | A-3 / T-2 |
| M-10 | FR-E-001 | 明确 §6 vs detail 报告内容分工 + 数据一致性约束 | A-4 |
| M-11 | FR-F-002 / FR-F-003 | 明确 verify 范围边界（列出不在 CI 范围的 SC） | T-1 |

所有 11 条均为 spec 文字修订，无新增 FR / SC（除 SC-009 拆分）。

---

*本 spec 基于 `specs/158-swe-bench-lite-grounding-eval/impl-supplement/research/synthesis.md` 调研结论生成。经 2 轮迭代修订：①Codex 对抗审查 4 CRITICAL + 4 WARNING + 2 INFO 全修；②Clarify pass 11 条文字修订全应用。剩余 plan 阶段需决议项：MCP telemetry 方案 A vs B 最终选择、ast-diff 60% 阈值实测校准。*
