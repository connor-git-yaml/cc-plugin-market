# Feature 158 质量检查清单

**生成时间**：2026-05-09  
**spec.md 版本**：Codex 对抗审查第 1 轮修复后（4 CRITICAL + 4 WARNING 全修复）  
**检查方式说明**：所有条目可通过 grep / file exist / json schema check / 命令执行 / 单测断言机械验证

---

## 维度 1：数据集与 Fixture（FR-A 系列）

[ ] CHECK-01：`tests/baseline/swe-bench-lite/fixtures/` 目录存在  
  验证：`test -d tests/baseline/swe-bench-lite/fixtures/`

[ ] CHECK-02：目录下存在 ≥ 5 个 `SWE-L00X-*.json` 文件  
  验证：`ls tests/baseline/swe-bench-lite/fixtures/SWE-L0*.json | wc -l` ≥ 5

[ ] CHECK-03：每个 fixture 文件包含全部必须顶层字段（`taskId` / `description` / `target` / `startCommit` / `prompt` / `primaryOracle` / `swebenchMeta`）  
  验证：JSON schema 校验，7 个字段全存在，无缺失

[ ] CHECK-04：`swebenchMeta` 含 8 个必须子字段（`instanceId` / `dataset` / `createdAt` / `mergedAt` / `failToPass` / `passToPass` / `goldPatch` / `testPatch`）  
  验证：JSON schema 校验，`swebenchMeta` 对象逐字段检查

[ ] CHECK-05：所有 fixture 的 `swebenchMeta.dataset` 值为字符串 `"lite"`  
  验证：`jq '.swebenchMeta.dataset' fixtures/*.json | sort -u` = `"lite"`

[ ] CHECK-06：所有 fixture 的 `swebenchMeta.createdAt` ≥ `2024-01-01T00:00:00Z`  
  验证：`jq '.swebenchMeta.createdAt' fixtures/*.json` 逐条比较 ISO 8601 日期

[ ] CHECK-07：所有 fixture 的 `swebenchMeta.goldPatch` 和 `swebenchMeta.testPatch` 均为非空字符串  
  验证：`jq 'select(.swebenchMeta.goldPatch == "" or .swebenchMeta.testPatch == "")' fixture.json` 无输出

[ ] CHECK-08：所有 fixture 的 `primaryOracle.kind` 值为 `"functional"` 或 `"ast-diff"`（仅此二值）  
  验证：`jq '.primaryOracle.kind' fixtures/*.json | sort -u` 值域 ⊆ `{functional, ast-diff}`

[ ] CHECK-09：`kind: functional` 的 fixture 中每条 `oracle.checks[]` 含有效 `cmd`（含 `pytest` 关键字）和 `timeoutMs`（数值）  
  验证：`jq '.primaryOracle.checks[] | select(.cmd | test("pytest") | not)' fixture.json` 无输出

[ ] CHECK-10：fixture 命名格式为 `SWE-L00X-<repo>-<short-desc>.json`（X 为 3 位零填充序号）  
  验证：`ls fixtures/ | grep -vP '^SWE-L\d{3}-'` 无输出

[ ] CHECK-11：所有 fixture 目标仓库均为 Python 纯计算类项目，无 web 框架或数据库依赖仓库  
  验证：枚举 `target` 字段，人工确认仓库列表

---

## 维度 2：评测脚本（FR-B 系列）

[ ] CHECK-12：`scripts/eval-mcp-augmented.mjs` 文件存在  
  验证：`test -f scripts/eval-mcp-augmented.mjs`

[ ] CHECK-13：脚本支持 `--group A|B|C` 参数，缺失时报错并输出用法说明  
  验证：`node scripts/eval-mcp-augmented.mjs 2>&1 | grep -i "group\|usage"` 有输出；省略 --group 时退出码非 0 且有错误信息

[ ] CHECK-14：脚本支持 `--task <taskId>` 参数  
  验证：`node scripts/eval-mcp-augmented.mjs --help 2>&1 | grep "\-\-task"` 有输出

[ ] CHECK-15：脚本支持 `--repeat N` 参数（默认 N=3）  
  验证：`--help` 输出含 `--repeat`

[ ] CHECK-16：脚本支持 `--dry-run` 参数，dry-run 时退出码 0、不触发 claude API 调用  
  验证：`node scripts/eval-mcp-augmented.mjs --group A --task SWE-L001 --dry-run; echo $?` = 0，且无 HTTP 请求发出

[ ] CHECK-17：脚本支持 `--stop-loss <USD>` 参数（默认 $40）和 `--max-judge-calls <N>` 参数（默认 20）  
  验证：`--help` 输出同时含 `--stop-loss` 和 `--max-judge-calls`

[ ] CHECK-18：RunResult `run-<N>.json` 含全部必须字段（`group` / `taskId` / `repeatIndex` / `oracleResult` / `wallMs` / `timestamp` / `costUsd` / `claudeCliVersion`）  
  验证：JSON schema 校验，8 个字段全存在（修复 F-006: M-8 后已废 `full.json` 命名）

[ ] CHECK-19：Group C 的 `run-<N>.json` 额外包含 `mcpToolCallCount`（整数）和 `mcpResponseBytes`（整数）  
  验证：`jq '.mcpToolCallCount, .mcpResponseBytes' runs/C/<taskId>/run-1.json` 均输出数值

[ ] CHECK-20：脚本整体退出码在 oracle fail 时仍为 0，仅 infrastructure error 时为非零  
  验证：单测断言，模拟 oracleResult=fail 时脚本 exitCode=0

[ ] CHECK-21：脚本通过 `import` 复用 `eval-task-runner.mjs` 导出函数，不修改 `SUPPORTED_TOOLS` 常量  
  验证：`grep "SUPPORTED_TOOLS" scripts/eval-task-runner.mjs` 的定义与 git log 一致（无新增修改）；`grep "import.*eval-task-runner" scripts/eval-mcp-augmented.mjs` 有输出

---

## 维度 3：3 组对比执行（FR-C 系列）

[ ] CHECK-22：Group A 调用 claude 时不传 MCP config、不附加额外 context  
  验证：脚本代码中 Group A 分支无 `--mcp-config` 参数构造；无 spec.md 注入逻辑

[ ] CHECK-23：Group B 从 `~/.spectra-baselines/<repo>-output/spectra-full/modules/` 加载 spec.md 注入，**自实现** `loadSpectraContextForSweBench`（含 SWE-Bench → baselineName 显式 map，因 runner 内部 `loadSpectraContext` 仅支持 micrograd/nanoGPT/self-dogfood）  
  验证：`grep "loadSpectraContextForSweBench" scripts/eval-mcp-augmented.mjs` 在 Group B 分支有定义和调用（修复 F-001: plan/tasks 决定不复用 runner 内部函数）

[ ] CHECK-24：Group B 在 spec.md 不存在时降级为 Group A 行为，并在 `full.json` 标注 `specPushDegraded: true`  
  验证：单测模拟 spec.md 不存在 → `full.json.specPushDegraded === true`

[ ] CHECK-25：Group C 构造临时 `mcp-config.json` 注册 `dist/cli/index.js (`node ... mcp-server`)`，通过 `claude --mcp-config <tmp> --strict-mcp-config` 启动  
  验证：`grep "\-\-mcp-config\|\-\-strict-mcp-config" scripts/eval-mcp-augmented.mjs` 在 Group C 分支有输出

[ ] CHECK-26：Group C 暴露的 MCP 工具名为 `mcp__spectra__impact` / `mcp__spectra__context` / `mcp__spectra__detect_changes`（不是 `spectra_impact` 等旧格式）  
  验证：`grep "spectra_impact\|spectra_context\|spectra_detect" scripts/eval-mcp-augmented.mjs` 无输出；`grep "mcp__spectra__" scripts/eval-mcp-augmented.mjs` 有 3 个匹配

[ ] CHECK-27：Group C system prompt 含 mandatory tool use instruction（引导 agent 调 `mcp__spectra__context` 和 `mcp__spectra__impact`）  
  验证：`grep "mcp__spectra__context\|mcp__spectra__impact" scripts/eval-mcp-augmented.mjs` 在 prompt 构造处有输出

[ ] CHECK-28：3 组 × ≥ 5 task 各 N=3 重复的 `run-*.json` 产出（≥ 45 个文件）  
  验证：`ls tests/baseline/swe-bench-lite/runs/{A,B,C}/*/run-*.json | wc -l` ≥ 45

---

## 维度 4：Oracle / 报告 / Verify / Telemetry（FR-D/E/F/G 系列）

[ ] CHECK-29：`scripts/eval-diff-fuzzy-match.mjs` 存在，支持 `--expected` 和 `--actual` 参数  
  验证：`test -f scripts/eval-diff-fuzzy-match.mjs`；`node scripts/eval-diff-fuzzy-match.mjs --help 2>&1 | grep "expected\|actual"` 有输出

[ ] CHECK-30：`eval-diff-fuzzy-match.mjs` 在匹配度 ≥ 60% 时退出码 0，否则退出码 1  
  验证：单测构造 60% 匹配的 patch pair → exitCode=0；构造 40% 匹配 → exitCode=1

[ ] CHECK-31：`specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` 含 §6 章节，含 4 个子章节标题（`6.1 实验设计` / `6.2 Pass Rate 矩阵` / `6.3 Token Cost 静态对比` / `6.4 结论`）  
  验证：`grep "6\.1\|6\.2\|6\.3\|6\.4" specs/147-.../competitive-evaluation-report.md` 有 4 行输出

[ ] CHECK-32：147 §6 末尾含指向 157 detail 报告的相对路径 Markdown 链接  
  验证：`grep "158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md" specs/147-.../competitive-evaluation-report.md` 有输出

[ ] CHECK-33：`specs/158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md` 存在且非空  
  验证：`test -s specs/158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md`

[ ] CHECK-34：Token Cost 静态对比表含 3 行数据（Group A / B / C），Group B 含 spec.md 字符数数值，Group C 含 MCP telemetry 数值  
  验证：报告中 Token Cost 表格行数 = 3，A/B/C 各有明确数值（非占位符 `TBD` 或 `—`）

[ ] CHECK-35：Pass Rate 矩阵含 ≥ 5 行 task 数据和 3 列（A / B / C），矩阵下方有统计声明  
  验证：`grep "小样本探索性 pilot\|不构成统计显著性" specs/157-.../competitive-evaluation-report.md` 有输出

[ ] CHECK-36：`scripts/verify-feature-158.mjs` 存在  
  验证：`test -f scripts/verify-feature-158.mjs`

[ ] CHECK-37：`verify-feature-158.mjs` 在无 claude API key / 无 docker / 无网络环境下退出码 0，产出 `verification-report.md`  
  验证：`ANTHROPIC_API_KEY="" node scripts/verify-feature-158.mjs --fixture-only; echo $?` = 0；`test -f specs/157-.../verification/verification-report.md`

[ ] CHECK-38：`verification-report.md` 含通过/失败检查点列表和总体状态（PASS / FAIL）  
  验证：`grep "PASS\|FAIL" specs/157-.../verification/verification-report.md` 有输出

[ ] CHECK-39：`src/mcp/agent-context-tools.ts` 的 telemetry hook 由 `SPECTRA_MCP_TELEMETRY_PATH` 环境变量控制，未设置时静默不写入  
  验证：`grep "SPECTRA_MCP_TELEMETRY_PATH" src/mcp/agent-context-tools.ts` 有输出；单测 unset env → 无文件写入 + MCP 响应正常返回

[ ] CHECK-40：Group C run 结束后 `<runtime-tmp>/mcp-telemetry-<runId>.jsonl` 文件存在且可解析（JSON Lines 格式）  
  验证：dry-run 模拟 Group C → telemetry jsonl 文件存在；`jq -c '.' telemetry-*.jsonl` 无 parse error

---

## 维度 5：架构兼容性

[ ] CHECK-41：不修改 `SUPPORTED_TOOLS` 常量（`scripts/eval-task-runner.mjs` 中该常量定义行与 master 一致）  
  验证：`git diff master -- scripts/eval-task-runner.mjs | grep "SUPPORTED_TOOLS"` 无输出

[ ] CHECK-42：修改 `src/mcp/agent-context-tools.ts` 时补单测（telemetry hook 的 enable / disable / write-fail 路径）  
  验证：`grep "telemetry" src/mcp/*.test.ts` 有 ≥ 3 个测试用例

[ ] CHECK-43：`npm run build` 零错误（含 src/mcp/agent-context-tools.ts 改动后的类型检查）  
  验证：`npm run build 2>&1 | grep -i "error"` 无输出

[ ] CHECK-44：`npx vitest run` 零失败  
  验证：`npx vitest run 2>&1 | tail -5 | grep -i "fail\|error"` 无输出

[ ] CHECK-45：不修改 `.codex/skills/` 下任何包装产物  
  验证：`git diff master -- .codex/skills/` 无输出

---

**检查项总数**：45 条，分 5 个维度  
**全部通过条件**：所有 45 条 `[ ]` 变为 `[x]` 后，Feature 158 方可进入技术规划阶段
