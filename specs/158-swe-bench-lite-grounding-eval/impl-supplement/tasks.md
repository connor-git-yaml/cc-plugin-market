---
feature_id: "157"
title: "SWE-Bench Grounding Eval — 任务清单"
branch: "158-swe-bench-lite-grounding-eval/impl-supplement"
created: "2026-05-09"
spec: "specs/158-swe-bench-lite-grounding-eval/impl-supplement/spec.md"
plan: "specs/158-swe-bench-lite-grounding-eval/impl-supplement/plan.md"
status: "Draft"
---

# Tasks: Feature 158 — SWE-Bench Grounding Eval

**输入制品**：`specs/158-swe-bench-lite-grounding-eval/impl-supplement/`（spec.md / plan.md / clarification.md / quality-checklist.md）  
**预期任务总数**：28 个（T-005 框架 smoke + T-014 端到端验证 拆分后；修复 Analyze F-009）  
**独立可并行任务**：12 个（标 [P]）  
**测试策略**：vitest 单测（telemetry hook + fuzzy match）/ dry-run 集成（全链路不调真实 API）

---

## Stage 1：前置条件验证（P1 已完成，验证 P2-P5）

**目标**：确认 MCP server 稳定性、裸机 pytest 可行性、Spectra graph 覆盖、telemetry 机制  
**阻塞关系**：Stage 1 完成后才能开始 Stage 2（telemetry hook 依赖 P2 结论）和 Stage 3（oracle 路径依赖 P3 结论）

---

### T-001：记录 P1 验证结论（`claude --mcp-config` flag 可用）

- **Stage**: 1
- **FR/SC/EC**: P1（已验证）
- **依赖**: 无
- **预估工时**: 0.5 hours
- **改动文件**: `specs/158-swe-bench-lite-grounding-eval/impl-supplement/plan.md`（更新 P1 状态节）
- **复用参考**: 新增（仅文档记录）
- **Acceptance**:
  - [ ] `claude --help | grep mcp` 输出含 `--mcp-config` 和 `--strict-mcp-config`
  - [ ] plan.md P1 行状态更新为 `✅ 已验证（implement 阶段确认）`，附 claude CLI 版本号

---

### T-002：P2 — MCP server stdio health-check

- **Stage**: 1
- **FR/SC/EC**: P2（硬前置）、EC-13
- **依赖**: 无（可先跑）
- **预估工时**: 1 hour
- **改动文件**: `specs/158-swe-bench-lite-grounding-eval/impl-supplement/plan.md`（更新 P2 结论节）
- **复用参考**: `src/mcp/agent-context-tools.ts:1`（被测目标）
- **Acceptance**:
  - [ ] 先执行 `npm run build`，确认 `dist/cli/index.js (启动: `node dist/cli/index.js mcp-server`)` 生成成功
  - [ ] 向 MCP server 发送 `tools/call impact` JSON-RPC 请求，收到含 `symbol-not-found` 或 `graph-not-built` 的合法 JSON-RPC response，进程不 crash（退出码 0 或等待更多 stdin）
  - [ ] 验证 `dist/cli/index.js (启动: `node dist/cli/index.js mcp-server`)` mtime ≥ `src/mcp/*.ts` 最新 mtime（EC-13 检查已可执行）
  - [ ] plan.md P2 节更新结论：server 稳定 → 选方案 A / 不稳定 → 选方案 B，附实测截图 / 日志片段

---

### T-003：P3 — 裸机 pytest 可行性验证（3 个 sympy 候选 task）

- **Stage**: 1
- **FR/SC/EC**: P3（硬前置）、EC-1、FR-A-004
- **依赖**: 无（可先跑）
- **预估工时**: 2 hours
- **改动文件**: `specs/158-swe-bench-lite-grounding-eval/impl-supplement/plan.md`（更新 P3 结论 + 阈值校准节）
- **复用参考**: plan.md §P3（详细步骤）
- **Acceptance**:
  - [ ] 从 HuggingFace `princeton-nlp/SWE-bench_Lite` 选取 3 个 sympy 候选（`FAIL_TO_PASS` 仅 1 条 / patch 改 1 文件）
  - [ ] 对每个候选：`git clone sympy` → `git checkout <startCommit>` → `pip install -e .` → `pytest <FAIL_TO_PASS>` 实测，记录是否 crash 于 `ImportError`
  - [ ] 得出结论：≥ 2/3 可裸机跑 → oracle 路径为 `functional`；≥ 2/3 不可行 → oracle 路径为 `ast-diff`
  - [ ] plan.md P3 节更新 oracle 路径结论，附 3 个候选 task 的实测日志摘要

---

### T-004：P4 — baseline:collect for sympy / astropy / pytest + 5 项深度验证

- **Stage**: 1
- **FR/SC/EC**: P4（硬前置）、EC-3、FR-C-002
- **依赖**: T-002（确认 build 成功）
- **预估工时**: 1.5 hours（跑 3 个 baseline 各 5-15 分钟串行 ≈ 25-35 min + 验证 + buffer，对齐 plan.md §P4 时间估算；修复 Codex INFO [8] 工时虚高）
- **改动文件**: `~/.spectra-baselines/`（外部目录，不入库）/ `specs/158-swe-bench-lite-grounding-eval/impl-supplement/plan.md`（更新 P4 结论）
- **复用参考**: plan.md §P4 详细验证步骤
- **Acceptance**:
  - [ ] `npm run baseline:collect -- --target sympy/sympy --mode full` 成功完成
  - [ ] `npm run baseline:collect -- --target astropy/astropy --mode full` 成功完成
  - [ ] `npm run baseline:collect -- --target pytest-dev/pytest --mode full` 成功完成
  - [ ] 检查 1：`~/.spectra-baselines/sympy-output/spectra-full/_meta/graph.json` 存在且 > 1 KB
  - [ ] 检查 2：`graph.json` 含 modules ≥ 50，symbols ≥ 500（plan.md §P4 验证命令）
  - [ ] 检查 3：`~/.spectra-baselines/sympy-output/spectra-full/modules/*.spec.md` 文件数 ≥ 30
  - [ ] 检查 4：抽样 1 个 spec.md 含 `## summary` 标题且非空
  - [ ] plan.md P4 节更新各 repo 的实测 modules / symbols 数，记录 graph 覆盖质量

---

### T-005：P5 — telemetry 机制框架可行性 smoke（pre-hook）

- **Stage**: 1
- **FR/SC/EC**: P5（硬前置框架部分）、FR-G-001 决策依据
- **依赖**: T-002（MCP server health-check 通过）
- **预估工时**: 0.25 hours
- **改动文件**: `specs/158-swe-bench-lite-grounding-eval/impl-supplement/plan.md`（更新 P5 框架可行性结论）
- **复用参考**: plan.md §P5 验证步骤
- **Acceptance**（仅验证框架可行性，不依赖 telemetry hook 实现 — 修复 Codex CRITICAL：循环依赖打破）：
  - [ ] 设置 `SPECTRA_MCP_TELEMETRY_PATH=/tmp/test-telemetry.jsonl` + `SPECTRA_MCP_RUN_ID=smoke-1`，向 MCP server 发送 impact 请求
  - [ ] MCP server 子进程能正常 spawn 并接收上述环境变量（通过子进程 `process.env` 验证 — 当前因无 hook，jsonl 不会被写入，这是预期）
  - [ ] 未设置 `SPECTRA_MCP_TELEMETRY_PATH` 时，MCP server 正常响应，无报错（验证向后兼容性）
  - [ ] plan.md P5 节更新"框架可行性已确认，端到端验证留 T-014（Stage 2 完成后）"

**完整端到端 P5 验证移到 T-014**（Stage 2 后），见下方。

**注**：T-003 / T-004 无相互依赖，可与 T-002 并行启动。

---

## Stage 2：MCP Telemetry Hook 实现（FR-G）

**目标**：在 `src/mcp/agent-context-tools.ts` 的 3 个 handler 加 telemetry hook，补单测，确保静默降级  
**阻塞关系**：Stage 2 必须在 T-002 P2 验证（方案 A/B 确认）后开始

---

### T-010：实现 `writeTelemetry` 函数和 `TelemetryEntry` 类型

- **Stage**: 2
- **FR/SC/EC**: FR-G-001、FR-G-002
- **依赖**: T-002（方案 A 确认）
- **预估工时**: 1 hour
- **改动文件**: `src/mcp/agent-context-tools.ts`（L1-30 区域新增 import + type + function）
- **复用参考**: `src/mcp/agent-context-tools.ts:1`（文件顶部）、plan.md §3 telemetry hook 伪代码
- **Acceptance**:
  - [ ] `TelemetryEntry` 类型定义包含 `ts / toolName / requestSize / responseSize / durationMs / runId / error` 字段
  - [ ] `writeTelemetry(entry)` 函数：`SPECTRA_MCP_TELEMETRY_PATH` 未设置时直接 return（无副作用）
  - [ ] `writeTelemetry` 用 `fs.appendFileSync` 写入，写入失败时 try/catch 静默吞掉异常（FR-G-002）
  - [ ] `npm run build` 零 TypeScript 错误

---

### T-011：实现 `recordAndReturn` wrapper，改写 handleImpact / handleContext / handleDetectChanges

- **Stage**: 2
- **FR/SC/EC**: FR-G-001、FR-G-003、plan.md §测试策略 FR-G 实现关键约束
- **依赖**: T-010
- **预估工时**: 2 hours
- **改动文件**: `src/mcp/agent-context-tools.ts`（handleImpact L144、handleContext L252、handleDetectChanges L416）
- **复用参考**: `src/mcp/agent-context-tools.ts:144,252,416`（各 handler 入口）、plan.md §telemetry hook 伪代码
- **Acceptance**:
  - [ ] `recordAndReturn(result, runIdContext)` wrapper 包裹 3 个 handler 所有 return 路径（含 `buildErrorResponse` 的 early return 分支）
  - [ ] 每次调用记录：`toolName / requestSize（JSON.stringify(args).length）/ responseSize / durationMs / runId（process.env.SPECTRA_MCP_RUN_ID ?? 'unknown'）`
  - [ ] error path（handler 内抛异常时 catch 分支）也记录 `error: true`
  - [ ] `handleImpact / handleContext / handleDetectChanges` 的 input/output schema 不变（Feature 155 合同不破坏）
  - [ ] `npm run build` 零错误

---

### T-012：编写 telemetry.test.ts（4 状态矩阵单测）

- **Stage**: 2
- **FR/SC/EC**: FR-G-001、FR-G-002、plan.md §单元测试 4 状态矩阵
- **依赖**: T-010（需要 writeTelemetry 函数可 import）
- **预估工时**: 1.5 hours
- **改动文件**: `tests/unit/mcp/telemetry.test.ts`（新增）
- **复用参考**: plan.md §测试策略（4 状态矩阵定义）
- **Acceptance**:
  - [ ] 状态 1：`SPECTRA_MCP_TELEMETRY_PATH` 未设置 → 调用 `writeTelemetry` 无文件副作用，返回 undefined
  - [ ] 状态 2：env 设置 + `appendFileSync` 成功 → JSONL 文件含正确 entry，handler 返回原 result 不受影响
  - [ ] 状态 3：env 设置 + `appendFileSync` 抛异常 → 静默吞异常，handler 仍返回原 result（不阻塞 MCP response）
  - [ ] 状态 4：error path（`buildErrorResponse`）→ 也记录 telemetry 含 `error: true / errorCode` 字段
  - [ ] 测试文件 vitest 可识别（`describe / it / expect` 语法正确）

---

### T-013：运行全量 vitest，确认 telemetry 单测通过

- **Stage**: 2
- **FR/SC/EC**: FR-G-001、SC-007（vitest 零失败是 CI 前置）
- **依赖**: T-011、T-012
- **预估工时**: 0.5 hours
- **改动文件**: 无（仅运行验证）
- **复用参考**: 无
- **Acceptance**:
  - [ ] `npx vitest run` 全量通过，零失败（含新增 telemetry.test.ts 的 4 条用例）
  - [ ] `npm run build` 零 TypeScript 错误
  - [ ] `npm run repo:check` 通过（确认仓库同步状态合规）

---

### T-014：P5 — telemetry 机制端到端验证（post-hook，修复 Codex CRITICAL：循环依赖第二步）

- **Stage**: 2 末尾
- **FR/SC/EC**: P5 完整验证、FR-G-001 / FR-G-002 / FR-G-003、SC-009b 准备
- **依赖**: T-013（telemetry hook 实现 + 单测通过 + build 零错误）
- **预估工时**: 0.25 hours
- **改动文件**: `specs/158-swe-bench-lite-grounding-eval/impl-supplement/plan.md`（P5 完整结论 + telemetry 选定方案的实测确认）
- **复用参考**: plan.md §P5 验证步骤完整版
- **Acceptance**:
  - [ ] 重跑 T-005 的 echo + jsonrpc 测试，但本次 `dist/cli/index.js (启动: `node dist/cli/index.js mcp-server`)` 已含 telemetry hook
  - [ ] `/tmp/test-telemetry.jsonl` 被实际写入 ≥ 1 行 JSON，含 `ts / toolName / requestSize / responseSize / durationMs / runId` 全部字段
  - [ ] 故意制造写失败场景（路径不可写如 `/tmp/readonly/x.jsonl`）→ MCP server 正常响应，不抛错
  - [ ] plan.md P5 节填入完整结论："Telemetry 方案 A 端到端验证通过，可进入 Stage 5"

---

## Stage 3：Fixture 转换脚本 + ≥5 Fixture 入库（FR-A）

**目标**：编写 Python 转换脚本，生成 5-8 个合规 fixture 入库，实现退化 oracle 的 goldPatch 路径  
**阻塞关系**：依赖 T-003（P3 oracle 路径结论）

---

### T-020：编写 `scripts/swe-bench-fixture-import.py` ✅ 已完成（Batch 2）

- **Stage**: 3
- **FR/SC/EC**: FR-A-001、FR-A-002、FR-A-003、FR-A-005、EC-8、EC-9
- **依赖**: T-003（P3 结论确定 oracle kind）
- **预估工时**: 2 hours
- **改动文件**: `scripts/swe-bench-fixture-import.py`（新增，Python，~432 行）
- **复用参考**: plan.md §1（swe-bench-fixture-import.py 接口设计）
- **Acceptance**:
  - [x] 脚本支持参数：`--output-dir / --repos / --min-date / --max-patch-files / --limit / --fallback-min-date`（含 `--min-fixtures`）
  - [x] `load_dataset('princeton-nlp/SWE-bench_Lite', split='test')` 显式指定，不用 Verified（EC-9）
  - [x] 直接复用 SWE-Bench Lite 自带 `created_at` 字段（无需 GitHub API），过滤 `≥ min-date`（FR-A-003）
  - [x] 三阶段降级：strict → fallback → 数据集天然最大日期，并写 `_DEGRADATION_NOTE.md`（FR-A-003 / CON-2）
  - [x] 输出 fixture JSON 含全部必须顶层字段（FR-A-002）
  - [x] `swebenchMeta.dataset` 固定为 `"lite"`（EC-9）
  - [x] oracle.kind=`ast-diff` + checks[].cmd 引用 `.goldpatch.diff` 文件（保守路径，因 P3 未实测裸机 pytest）
  - [x] 利用 HuggingFace 本地缓存 `~/.cache/huggingface/datasets/`（EC-8）

---

### T-021：运行 fixture import + 选定 5-8 个 task + 人工校验（含降级条款）✅ 已完成（Batch 2，触发二阶段降级）

- **Stage**: 3
- **FR/SC/EC**: FR-A-001、FR-A-003（含降级）、FR-A-004、SC-001、EC-7、EC-11、CON-2
- **依赖**: T-020、T-004（baseline:collect 已完成，确认 repo 可用）
- **预估工时**: 2 hours（含人工校验）
- **改动文件**: `tests/baseline/swe-bench-lite/fixtures/`（新增目录 + 21 个文件）
- **复用参考**: 新增
- **Acceptance**（修复 Codex WARNING：日期降级条款冲突）：
  - [x] 执行 `/tmp/swebench-venv/bin/python scripts/swe-bench-fixture-import.py --repos sympy/sympy,astropy/astropy,pytest-dev/pytest --min-date 2024-01-01 --max-patch-files 3 --limit 10 --fallback-min-date 2023-07-01 --output-dir tests/baseline/swe-bench-lite/fixtures/`
  - [x] 产出 10 个 `SWE-L00X-<repo>-<desc>.json` 文件（FR-A-001 / SC-001，超过下限 5、达到目标 8）
  - [x] **条件验收（最深层降级）**：strict 2024-01 / fallback 2023-07 候选均 < 5；自动降级到数据集天然最大日期 (2023-06-29)，所有 fixture 的 `swebenchMeta.dateThresholdDegraded` 含降级原因字符串（FR-A-003 / EC-7 / CON-2）
  - [x] 触发降级，已写 `_DEGRADATION_NOTE.md`，T-063 §6.4 audit 待 Stage 7b 落地
  - [x] 所有目标仓库为 Python 纯计算类（sympy / astropy / pytest-dev/pytest）（FR-A-004）
  - [x] `goldPatch` 和 `testPatch` 均非空字符串（CHECK-07，已校验）
  - [x] `failToPass` 列表 ≥ 1 条 pytest test id（已校验）

---

### T-022：Fixture JSON + goldPatch .diff 文件 commit 入库 ✅ 已完成（Batch 2，已 git add 至 staging）

- **Stage**: 3
- **FR/SC/EC**: FR-A-001、SC-001、EC-8、FR-D-002（goldPatch 文件路径产物）
- **依赖**: T-021（fixture 已生成且校验通过）
- **预估工时**: 0.5 hours
- **改动文件**: 
  - `tests/baseline/swe-bench-lite/fixtures/SWE-L*.json`（10 个）
  - `tests/baseline/swe-bench-lite/fixtures/SWE-L*.goldpatch.diff`（10 个）
  - `tests/baseline/swe-bench-lite/fixtures/_DEGRADATION_NOTE.md`
  - `.gitignore`（新增 `tests/baseline/swe-bench-lite/runs/` 规则）
- **复用参考**: 无
- **Acceptance**:
  - [x] swe-bench-fixture-import.py 输出脚本除写 fixture JSON 外，同时为每个 fixture 把 `swebenchMeta.goldPatch` 内容单独写入 `<taskId>.goldpatch.diff`
  - [x] fixture JSON 中 `oracle.checks[]` 引用 `tests/baseline/swe-bench-lite/fixtures/<taskId>.goldpatch.diff`（相对仓库根稳定路径）
  - [x] `git add tests/baseline/swe-bench-lite/fixtures/` + `git status` 显示 10 个 JSON + 10 个 .diff + 1 个降级 note 在暂存区
  - [x] `git diff --cached` 内容可读（fixture JSON 格式正确，diff 文件含 unified diff header）
  - [x] `.gitignore` 中 `tests/baseline/swe-bench-lite/runs/` 已被忽略（验证：`git check-ignore` 命中），fixtures/ 不被忽略
  - [x] 暂存区不包含 `tests/baseline/swe-bench-lite/runs/` 中任何内容

---

### T-023：用 JSON schema 校验工具 dry-run 验证 fixture schema 合规 ✅ 已完成（Batch 2）

- **Stage**: 3
- **FR/SC/EC**: FR-A-002、SC-001、CHECK-03 ~ CHECK-10
- **依赖**: T-022
- **预估工时**: 0.5 hours
- **改动文件**: 无（仅验证）
- **复用参考**: `quality-checklist.md` CHECK-03 ~ CHECK-10 验证命令
- **Acceptance**:
  - [x] 每个 fixture JSON 可被 `JSON.parse` 解析，无语法错误（10/10 PASS）
  - [x] 7 个必须顶层字段全存在（CHECK-03，10/10 PASS）
  - [x] `swebenchMeta` 6 个必须子字段全存在（instanceId/dataset/failToPass/passToPass/goldPatch/testPatch；createdAt/mergedAt 也存在）（CHECK-04，10/10 PASS）
  - [x] `swebenchMeta.dataset` 全为 `"lite"`（CHECK-05，10/10 PASS）
  - [x] `primaryOracle.kind` 全为 `ast-diff`（保守路径，⊆ {functional, ast-diff}）（CHECK-08，10/10 PASS）
  - [N/A] `functional` 类型 checks（本批次全部走 ast-diff 路径，CHECK-09 不适用；ast-diff cmd 引用 `eval-diff-fuzzy-match.mjs` + `.goldpatch.diff` 相对路径已验证）
  - [x] 全量 vitest 3484 PASS（与 Batch 1 后基线一致，fixture 入库无回归）

---

## Stage 4：eval-diff-fuzzy-match.mjs 实现（FR-D）

**目标**：实现退化 oracle 的 fuzzy match 脚本 + 单测，完成阈值校准  
**并行机会**：Stage 4 可与 Stage 3 并行（互不依赖）

---

### T-030：实现 `scripts/eval-diff-fuzzy-match.mjs` [P]

- **Stage**: 4
- **FR/SC/EC**: FR-D-002、EC-12
- **依赖**: 无（可与 Stage 3 并行）
- **预估工时**: 2 hours
- **改动文件**: `scripts/eval-diff-fuzzy-match.mjs`（新增）
- **复用参考**: plan.md §2（normalize 算法详细设计）
- **Acceptance**:
  - [ ] 支持参数：`--expected <gold-patch-file> / --actual <actual-diff-file> / --threshold <N>（默认 60）`
  - [ ] normalize 过滤规则正确：保留 `+/-` 开头语义行；排除 `---/+++` file header / `@@` hunk header / 空格开头 context lines / 空行（EC-12）
  - [ ] 使用 token multiset Jaccard（而非行集合 Jaccard），能区分重复行差异（plan.md §2 算法）
  - [ ] 相似度 ≥ threshold/100 → 退出码 0；否则退出码 1
  - [ ] 支持从文件读入 actual（避免 process substitution `<(...)` 兼容性问题，plan.md §额外技术风险）

---

### T-031：编写 fuzzy-match.test.ts + 9 候选场景校准 [P]

- **Stage**: 4
- **FR/SC/EC**: FR-D-002、EC-12、plan.md §阈值实测校准计划
- **依赖**: T-030、T-003（需要 P3 候选 task 的 goldPatch 作为校准输入）
- **预估工时**: 2 hours
- **改动文件**: `tests/unit/eval/fuzzy-match.test.ts`（新增）
- **复用参考**: plan.md §eval-diff-fuzzy-match.mjs 单测 + 校准计划
- **Acceptance**:
  - [ ] 单测用例：完全匹配 → 100%（identical patch）
  - [ ] 单测用例：空 gold + 空 actual → 100%（business-defined edge case）
  - [ ] 单测用例：完全不同 → 0%
  - [ ] 单测用例：仅尾部空白差异 → normalize 后 ≥ 99%
  - [ ] 单测用例：阈值边界（59% < threshold / 60% ≥ threshold）→ 退出码差异
  - [ ] 单测用例：diff metadata 排除（`--- a/x` / `+++ b/x` / `@@ -1,3`不计入分子分母）
  - [ ] 单测用例：重复行差异（`+a\n+a\n+a` vs `+a` 相似度 < 100%，multiset 能区分）
  - [ ] 校准：对 sympy / astropy / pytest 各 3 个候选场景（完整匹配 / 重命名变量 / 完全错误）测试相似度，填入 plan.md §阈值实测校准结果（最终阈值 = 60% 或调整后值）
  - [ ] **占位符 audit（修复 Analyze F-007）**：plan.md §最终阈值记录节不再含 `[实测后填入]` 占位符（已被实测值替换 + 实测依据段落）
  - [ ] `npx vitest run tests/unit/eval/fuzzy-match.test.ts` 全部通过

---

## Stage 5：eval-mcp-augmented.mjs 实现（FR-B/C）

**目标**：实现评测主脚本，覆盖 Group A/B/C 三组、dry-run、stop-loss  
**阻塞关系**：依赖 Stage 2（telemetry hook 已实现）、Stage 3（至少 1 个 fixture 已入库）、Stage 4（fuzzy match 可用）

---

### T-040：实现 parseArgs + 参数校验 + --help 输出

- **Stage**: 5
- **FR/SC/EC**: FR-B-002、FR-B-003、FR-B-004、FR-B-005、FR-B-007、FR-B-008、SC-003
- **依赖**: T-013（build 通过）、T-022（有可用 fixture）
- **预估工时**: 1 hour
- **改动文件**: `scripts/eval-mcp-augmented.mjs`（新增，parseArgs 部分）
- **复用参考**: `scripts/eval-task-runner.mjs:41`（parseArgs 结构参考，不直接 import）
- **Acceptance**:
  - [ ] 支持参数：`--group A|B|C`（必填，缺失时报错 + 退出码非 0）
  - [ ] 支持参数：`--task <taskId>`（必填）/ `--repeat N`（默认 3）/ `--dry-run` / `--stop-loss <USD>`（默认 40）/ `--max-judge-calls N`（默认 20）/ `--keep-temp`
  - [ ] `--group` 值不在 `{A,B,C}` 时：输出用法说明 + 退出码非 0（FR-B-002）
  - [ ] `--help` 或参数缺失时：输出包含 `--group / --task / --repeat / --dry-run / --stop-loss` 说明
  - [ ] `node scripts/eval-mcp-augmented.mjs --help` 退出码 0

---

### T-041：实现 `loadSpectraContextForSweBench` 函数（自实现，不复用 runner 内部 loadSpectraContext）

- **Stage**: 5
- **FR/SC/EC**: FR-C-002、EC-3、plan.md §4 import 复用清单注意事项
- **依赖**: T-040、T-004（sympy/astropy/pytest baseline 已生成）
- **预估工时**: 1.5 hours
- **改动文件**: `scripts/eval-mcp-augmented.mjs`（loadSpectraContextForSweBench 函数）
- **复用参考**: `scripts/eval-task-runner.mjs:157-183`（参考算法逻辑，不直接 import）
- **Acceptance**:
  - [ ] 接受 SWE-Bench target（`sympy/sympy` / `astropy/astropy` / `pytest-dev/pytest`）
  - [ ] 显式 map 到 baselineName（`{ 'sympy/sympy': 'sympy', 'astropy/astropy': 'astropy', 'pytest-dev/pytest': 'pytest' }`）
  - [ ] 路径 `~/.spectra-baselines/<baselineName>-output/spectra-full/modules/` 下加载 spec.md
  - [ ] modulesDir 不存在时：返回 `null`（触发 `specPushDegraded: true`，FR-C-002）
  - [ ] 与 runner 内部 `loadSpectraContext` 相同的相关性排序：targetBasenames 直接匹配 100 / 部分匹配 50 / `_index` 兜底 10
  - [ ] **集成验证（修复 Analyze F-005）**：单测或集成测试中，对 `sympy/sympy` 调用 `loadSpectraContextForSweBench`，前提 P4 已通过且 `~/.spectra-baselines/sympy-output/spectra-full/modules/` 存在 ≥ 30 个 spec.md → 验证返回非 null 字符串（长度 > 0）

---

### T-042：实现 Group A 分支（bare baseline）

- **Stage**: 5
- **FR/SC/EC**: FR-C-001、FR-B-006
- **依赖**: T-041
- **预估工时**: 1 hour
- **改动文件**: `scripts/eval-mcp-augmented.mjs`（Group A 分支）
- **复用参考**: `scripts/eval-task-runner.mjs:218`（runTask 函数，import 复用）
- **Acceptance**:
  - [ ] 仅以 fixture `prompt` 内容调用 claude，不附加额外 context，不启用 MCP server（FR-C-001）
  - [ ] import 复用 `eval-task-runner.mjs` 的 `prepareWorktree / runTask / runPrimaryOracle / captureProductMetrics`
  - [ ] run 结束后写入 `tests/baseline/swe-bench-lite/runs/A/<taskId>/run-<N>.json`，含全部必须字段（FR-B-006：group / taskId / repeatIndex / oracleResult / wallMs / timestamp / costUsd / claudeCliVersion）
  - [ ] 脚本整体退出码为 0（oracle fail 不影响脚本退出码，FR-B-007）

---

### T-043：实现 Group B 分支（spec.md push）

- **Stage**: 5
- **FR/SC/EC**: FR-C-002、FR-B-006、EC-3
- **依赖**: T-041（loadSpectraContextForSweBench 已实现）
- **预估工时**: 1 hour
- **改动文件**: `scripts/eval-mcp-augmented.mjs`（Group B 分支）
- **复用参考**: `scripts/eval-task-runner.mjs:157-183`（参考 loadSpectraContext 逻辑）
- **Acceptance**:
  - [ ] 调用 `loadSpectraContextForSweBench(target)` 获取 spec.md 内容作为 system prompt 前缀注入
  - [ ] `loadSpectraContextForSweBench` 返回 `null` 时：`run-N.json` 含 `specPushDegraded: true`，行为退化为 Group A（FR-C-002）
  - [ ] `run-N.json` 写入路径为 `tests/baseline/swe-bench-lite/runs/B/<taskId>/run-<N>.json`
  - [ ] `run-N.json` 含全部 FR-B-006 必须字段 + `specPushDegraded` 字段

---

### T-044：实现 Group C 分支（MCP pull，含 mcp-config / telemetry 解析 / runId）

- **Stage**: 5
- **FR/SC/EC**: FR-C-003、FR-B-006、FR-G-003、EC-4、EC-11、EC-13、EC-14、SC-009a
- **依赖**: T-041、T-011（telemetry hook 已实现 + build 通过）
- **预估工时**: 2 hours
- **改动文件**: `scripts/eval-mcp-augmented.mjs`（Group C 分支）
- **复用参考**: plan.md §4 Group C 特殊逻辑（6 步）/ Schema 3（mcp-config JSON）/ Schema 4（telemetry JSONL）
- **Acceptance**:
  - [ ] 验证 `dist/cli/index.js (启动: `node dist/cli/index.js mcp-server`)` mtime ≥ `src/mcp/*.ts` 最新 mtime，否则报错提示 `npm run build`（EC-13）
  - [ ] runId 生成：`"${taskId}-${group}-${repeatIndex}-${Date.now()}"`（plan.md Schema 3）
  - [ ] 构造临时 `/tmp/spectra-mcp-<runId>.json`，包含正确 mcpServers.spectra 配置（含 `SPECTRA_MCP_TELEMETRY_PATH / SPECTRA_MCP_RUN_ID`）
  - [ ] claude 调用时传 `--mcp-config <tmp-file> --strict-mcp-config`（FR-C-003）
  - [ ] System prompt 含 mandatory tool use instruction（引导 agent 调 `mcp__spectra__context / mcp__spectra__impact`）（FR-C-003）
  - [ ] run 结束后通过 `child.on('exit', () => parseTelemetry(...))` 读取 JSONL（plan.md §race condition 修复）
  - [ ] `run-N.json` 额外含 `mcpToolCallCount`（整数）+ `mcpResponseBytes`（整数）（FR-B-006 / FR-G-003）
  - [ ] `finally` 块清理临时 mcp-config 和 telemetry JSONL（除非 `--keep-temp`）（plan.md §cleanup 策略）
  - [ ] dry-run 时 stdout 含 `SPECTRA_MCP_TELEMETRY_PATH=` 字样（SC-009a 可验证）
  - [ ] **EC-11 worktree 唯一性验收（修复 Analyze F-004）**：worktree 子目录路径含 `<taskId>-<group>-<repeatIndex>` 唯一段；模拟两个并行 run 时验证它们不共享同一 worktree 目录（单测 or shell smoke）

---

### T-045：实现 stop-loss 机制（FR-B-008）

- **Stage**: 5
- **FR/SC/EC**: FR-B-007、FR-B-008、EC-5
- **依赖**: T-042（Group A 基础框架，可测 run 计数逻辑）
- **预估工时**: 1 hour
- **改动文件**: `scripts/eval-mcp-augmented.mjs`（stop-loss 逻辑，在主循环内）
- **复用参考**: plan.md §4 stop-loss 机制描述
- **Acceptance**:
  - [ ] 每次 run 结束后累加 `costUsd`（估算值）
  - [ ] 累计 `costUsd` 超过 `--stop-loss` 阈值时：输出警告 + 已完成的 `run-N.json` 保留 + 退出码 0（FR-B-008）
  - [ ] `--max-judge-calls N` 参数限制 Opus judge 调用次数，超过时停止并输出警告（FR-B-008）
  - [ ] dry-run 模式：输出预估 run 次数 + 预估 cost（$0.25/run × N），退出码 0，不调用真实 API（FR-B-005）
  - [ ] 脚本因 infrastructure error（claude 调用非预期异常 / fixture 解析失败）时退出码非零（FR-B-007）

---

### T-046：dry-run 集成测试（全链路 + 全 fixture 遍历，不调真实 API）

- **Stage**: 5
- **FR/SC/EC**: SC-002（修复 Codex WARNING：全 fixture 覆盖）、SC-003、SC-009a、FR-B-005
- **依赖**: T-031（ast-diff matcher 就绪，dry-run 时若引用 ast-diff oracle 不会因 matcher 缺失而失败）+ T-044（Group C 实现完整）
- **预估工时**: 1 hour
- **改动文件**: 无（仅执行验证）
- **复用参考**: plan.md §集成测试 dry-run 全链路
- **Acceptance**（修复 Codex WARNING：SC-002 要求所有 fixture dry-run）：
  - [ ] **遍历所有 fixture taskId**（不仅 first），每个跑 `--group A/B/C --repeat 1 --dry-run`，全部退出码 0（SC-002）
  - [ ] Group C dry-run stdout 含 `SPECTRA_MCP_TELEMETRY_PATH=`（SC-009a）
  - [ ] `--group` 参数缺失时退出码非 0 + 输出用法说明（FR-B-002）
  - [ ] dry-run 输出预估 cost（USD）和预估 run 次数（每 fixture × 3 group）
  - [ ] 任一 fixture × 任一 group 的 dry-run 失败 → 整体退出码非 0，列出失败的 fixture 列表

---

## Stage 6：verify-feature-158.mjs 实现（FR-F）

**目标**：实现独立验收脚本，覆盖 6 个 CI 可验证检查点，产出 verification-report.md  
**并行机会**：Stage 6 可与 Stage 5 T-040 ~ T-045 并行（verify 脚本框架不依赖 eval 主脚本内部实现）

---

### T-050：实现 `scripts/verify-feature-158.mjs`（6 个检查点）[P]

- **Stage**: 6
- **FR/SC/EC**: FR-F-001、FR-F-002、FR-F-003、SC-007、SC-009a
- **依赖**: T-022（fixture 已入库，验收脚本才有数据可验）/ T-046（eval 脚本 dry-run 可用）
- **预估工时**: 2 hours
- **改动文件**: `scripts/verify-feature-158.mjs`（新增）/ `specs/158-swe-bench-lite-grounding-eval/impl-supplement/verification/`（目录新增）
- **复用参考**: `scripts/verify-feature-156.mjs:171-181`（step/report 模式复用）
- **Acceptance**:
  - [ ] 复用 `verify-feature-156.mjs` 的 `step(name, ok, detail)` 函数 + `report` 对象模式（FR-F-001）
  - [ ] 检查点 ①：`fs.readdirSync` 枚举 `SWE-L00X-*.json`，数量 ≥ 5（FR-F-002 ①）
  - [ ] 检查点 ②：逐文件 JSON.parse + 必须字段存在性检查（含 `createdAt / dataset`）（FR-F-002 ②）
  - [ ] 检查点 ③：`spawnSync('node', ['scripts/eval-mcp-augmented.mjs', '--group', 'A', '--task', firstTaskId, '--dry-run'])` 退出码 0（FR-F-002 ③）
  - [ ] 检查点 ④：解析 dry-run stdout 是否含 `SPECTRA_MCP_TELEMETRY_PATH=`（SC-009a / FR-F-002 ④）
  - [ ] 检查点 ⑤：`fs.readFileSync` 147 报告 + 正则搜索 `6.1 实验设计 / 6.2 Pass Rate 矩阵 / 6.3 Token Cost 静态对比 / 6.4 结论` 四个标题（FR-F-002 ⑤）
  - [ ] 检查点 ⑥：正则搜索 `../158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md` 链接（SC-008 / FR-F-002 ⑥）
  - [ ] 任一检查点失败 → 退出码 1（FR-F-002）
  - [ ] 报告输出至 `specs/158-swe-bench-lite-grounding-eval/impl-supplement/verification/verification-report.md`（FR-F-003）
  - [ ] 报告含"不在 verify 范围内的 SC 列表"（SC-004 / SC-005 / SC-006 / SC-009b）（FR-F-002 边界）

---

### T-051：运行 verify-feature-158.mjs + 输出 verification-report.md

- **Stage**: 6
- **FR/SC/EC**: SC-007、FR-F-003
- **依赖**: T-050、T-046（eval 脚本 dry-run 可用）、T-054（147 报告 §6 已添加）
- **预估工时**: 0.5 hours
- **改动文件**: `specs/158-swe-bench-lite-grounding-eval/impl-supplement/verification/verification-report.md`（自动生成）
- **复用参考**: 无
- **Acceptance**:
  - [ ] `node scripts/verify-feature-158.mjs` 退出码 0（所有 6 个检查点 PASS）
  - [ ] `specs/158-swe-bench-lite-grounding-eval/impl-supplement/verification/verification-report.md` 存在且含 PASS 状态
  - [ ] verification-report.md 含"不在 verify 范围内的 SC"列表

---

## Stage 6b：147 报告 §6 章节框架（FR-E，为 verify 检查点 ⑤⑥ 做准备）

**目标**：在 147 报告中添加 §6 章节骨架（含 4 个子章节标题 + 数据占位符 + 跨链接），实验数据留待 Stage 7b 填入

---

### T-054：在 147 报告添加 §6 章节骨架 + 跨链接

- **Stage**: 6b（与 Stage 5 / Stage 6 并行）
- **FR/SC/EC**: FR-E-001、FR-E-003、FR-E-004、SC-005、SC-008
- **依赖**: T-022（fixture 已入库，§6.1 实验设计可填入 task 数量）
- **预估工时**: 1 hour
- **改动文件**: `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md`（新增 §6 章节）
- **复用参考**: plan.md §Schema 5（147 §6 章节模板）
- **Acceptance**:
  - [ ] 147 报告新增 `## §6 SWE-Bench Grounding Lift 实验` 章节
  - [ ] 含 4 个子章节标题：`### 6.1 实验设计 / ### 6.2 Pass Rate 矩阵 / ### 6.3 Token Cost 静态对比 / ### 6.4 结论`（FR-E-001 / SC-005）
  - [ ] `6.2` 含 Pass Rate 矩阵表格骨架（`<!-- 实验完成后填入 -->` 占位符 + 表头 Task / Group A / Group B / Group C）（FR-E-003）
  - [ ] `6.3` 含 Token Cost 对比表骨架（3 行：Group A / B / C，数值占位符）（FR-E-002）
  - [ ] 矩阵下方含统计声明文字（EC-6）
  - [ ] `6.4` 结论含 `<!-- 人工撰写 -->` 占位符
  - [ ] §6 末尾含跨链接：`[完整明细 → SWE-Bench Grounding Lift Detail Report](../158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md)`（FR-E-004 / SC-008）

---

## Stage 7a：3-Run Pilot（摸底单 run 耗时）

**目标**：用 1 个 task × 3 group × N=1 做 pilot，测量 p50/p95 单 run 耗时，为 Stage 7b 重估总时长提供数据

---

### T-060：执行 3-run pilot（1 task × 3 group × N=1）

> **依赖更新（修复 Codex WARNING：T-031 ast-diff 缺失依赖）**：T-046 / T-060 / T-061 必须显式依赖 T-031（ast-diff matcher 就绪 + 9 候选场景校准完成），否则若选定 fixture 走 ast-diff 路径但 matcher 阈值未校准，pilot 可能给假信号。


- **Stage**: 7a
- **FR/SC/EC**: plan.md §Stage 7a（pilot 设计）、EC-5（预算约束）
- **依赖**: T-046（eval 脚本完整可用）、T-051（verify 检查点 ①~④ 通过）
- **预估工时**: 0.5 hours（执行）+ 0.5 hours（分析记录）
- **改动文件**: `tests/baseline/swe-bench-lite/runs/`（运行结果，不入库）/ `specs/158-swe-bench-lite-grounding-eval/impl-supplement/plan.md`（更新 Stage 7a 实测节）
- **复用参考**: plan.md §实测验收（测试命令）
- **Acceptance**:
  - [ ] `node scripts/eval-mcp-augmented.mjs --group A --task <SWE-L001> --repeat 1` 成功，产出 `run-1.json`
  - [ ] `node scripts/eval-mcp-augmented.mjs --group B --task <SWE-L001> --repeat 1` 成功
  - [ ] `node scripts/eval-mcp-augmented.mjs --group C --task <SWE-L001> --repeat 1` 成功，`run-1.json` 含 `mcpToolCallCount` 字段
  - [ ] 记录 3 组各自 `wallMs`（p50 / p95 单 run 耗时）
  - [ ] plan.md Stage 7b 节据 pilot 结果更新总时长重估 + 若 p95 > 15 min 则说明缩减计划（N=2 或 task 数 = 5）

---

## Stage 7b：完整实验运行 + 报告撰写（FR-E、SC-004）

**目标**：对 ≥5 个 task × 3 group × N=3 完成全量实测，汇总数据，撰写 §6 和 detail 报告结论

---

### T-061：实跑 ≥5 task × 3 group × N=3（完整实验）

- **Stage**: 7b
- **FR/SC/EC**: FR-C-004、SC-004、EC-2、EC-5、EC-6
- **依赖**: T-060（pilot 结论，确认单 run 耗时 + 无阻塞 bug）
- **预估工时**: 3-5 天（含 stop-loss 监控，约 45+ runs，单 run 预估 5-15 分钟）
- **改动文件**: `tests/baseline/swe-bench-lite/runs/`（运行结果，不入库）
- **复用参考**: plan.md §实测验收（完整命令序列）
- **Acceptance**:
  - [ ] 对每个 task（≥5 个），依次运行 Group A → B → C，各 N=3（可调整，见 pilot 结论）
  - [ ] `tests/baseline/swe-bench-lite/runs/{A,B,C}/<taskId>/run-{1,2,3}.json` 文件全部存在
  - [ ] 所有 `run-N.json` 含 `oracleResult`（pass / fail / error）和 `wallMs`
  - [ ] Group C 所有 `run-N.json` 含 `mcpToolCallCount`（可为 0，EC-2）
  - [ ] 累计 `costUsd` < `--stop-loss 40`（EC-5）；若触发 stop-loss 则在 plan.md 记录"实验因预算提前停止（完成 X/45 runs）"
  - [ ] SC-004 状态：post-eval 人工确认 runs 目录下 `run-N.json` 文件数

---

### T-062：运行 eval-report 脚本生成 §6 数据（Pass Rate 矩阵 + Token Cost 表）

- **Stage**: 7b
- **FR/SC/EC**: FR-E-001、FR-E-002、FR-E-003、SC-005、SC-006
- **依赖**: T-061（完整实验数据已产出）
- **预估工时**: 1 hour
- **改动文件**: `specs/158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md`（新增，detail 报告）/ `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md`（更新 §6 数据）
- **复用参考**: `scripts/eval-mcp-augmented.mjs`（runs/ 目录结构）
- **Acceptance**:
  - [ ] 汇总 `runs/A|B|C/<taskId>/run-N.json` → 计算每个 (task, group) 的 pass rate（`x/N` 格式）
  - [ ] Pass Rate 矩阵填入 147 报告 §6.2（含 ≥5 行 task 数据 × 3 列 group）（FR-E-003）
  - [ ] Token Cost 表填入 147 报告 §6.3（Group A=0 / Group B=spec.md 字符数 × 0.25 / Group C=telemetry JSONL responseSize 累计 × 0.25）（FR-E-002）
  - [ ] 147 §6.2 矩阵数据与 detail 报告数据一致（FR-E-001 数据一致性约束）
  - [ ] detail 报告 `specs/158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md` 含 per-run 明细（每个 run 的 oracleResult / wallMs / mcpToolCallCount）（FR-E-001）

---

### T-063：人工撰写 §6.4 结论 + detail 报告风险分析 + 跨链接确认 + 降级 audit

- **Stage**: 7b
- **FR/SC/EC**: FR-E-001、FR-E-004、SC-005、EC-2、EC-6、EC-7、CON-2（日期降级 audit）
- **依赖**: T-062（数据已填入）
- **预估工时**: 2 hours
- **改动文件**: `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md`（§6.4 结论）/ `specs/158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md`（detail 报告结论 + 风险分析）
- **复用参考**: spec.md EC-2 / EC-6 / EC-7 风险说明
- **Acceptance**（修复 Codex WARNING：日期降级未 audit）：
  - [ ] 147 §6.4 人工撰写：grounding lift = (Group C pass rate - Group A pass rate)，token 效率改善分析（FR-E-001，非 auto-generated）
  - [ ] 结论明确标注"探索性 pilot，不构成统计显著性声明"（EC-6）
  - [ ] 若 Group A pass rate 偏高，标注"存在训练集泄漏风险"（EC-7）
  - [ ] **若 T-021 触发了日期降级（`_DEGRADATION_NOTE.md` 存在 / `dateThresholdDegraded=true`）**，§6.4 必须包含降级 audit 段：列出降级原因（候选 < 5）、降级到的日期阈值（2023-07）、训练集泄漏增量风险评估（CON-2）
  - [ ] Group C 中 `mcpToolCallCount = 0` 的 run 单独分析（EC-2 / FR-E-005 可选）
  - [ ] 147 §6 末尾跨链接有效，detail 报告存在且可访问（FR-E-004）
  - [ ] detail 报告风险展开：包含 EC-3（graph 覆盖不足的 specPushDegraded 情况）/ EC-6 / EC-7 分析

---

## Phase Final：Polish & Cross-Cutting Concerns

**目标**：确保所有 check + 仓库同步 + 最终 verify 通过

---

### T-070：最终 vitest + build + repo:check + release:check [P]

- **Stage**: Final
- **FR/SC/EC**: SC-007、仓库级提交前约定
- **依赖**: T-063（所有实现完成）
- **预估工时**: 0.5 hours
- **改动文件**: 无
- **复用参考**: CLAUDE.md §代码质量与架构约定（提交前验证）
- **Acceptance**:
  - [ ] `npx vitest run` 全量通过，零失败（含 telemetry.test.ts + fuzzy-match.test.ts）
  - [ ] `npm run build` 零 TypeScript 错误
  - [ ] `npm run repo:check` 通过
  - [ ] `npm run release:check` 通过

---

### T-071：运行最终 verify-feature-158.mjs + 确认 verification-report.md 为 PASS

- **Stage**: Final
- **FR/SC/EC**: SC-007、FR-F-002、FR-F-003
- **依赖**: T-070、T-063
- **预估工时**: 0.5 hours
- **改动文件**: `specs/158-swe-bench-lite-grounding-eval/impl-supplement/verification/verification-report.md`（最终版本）
- **复用参考**: 无
- **Acceptance**:
  - [ ] `node scripts/verify-feature-158.mjs` 退出码 0，所有 6 个检查点 PASS
  - [ ] verification-report.md 总体状态为 `PASS`
  - [ ] verification-report.md 含不在 verify 范围内的 SC 列表（SC-004 / SC-005 / SC-006 / SC-009b 标注"post-eval 人工确认"）

---

## 依赖关系 DAG

| 任务 | 依赖 | 说明 |
|------|------|------|
| T-001 | 无 | P1 已验证，仅文档记录 |
| T-002 | 无 | 可与 T-001 / T-003 / T-004 并行 |
| T-003 | 无 | 可与 T-002 并行 |
| T-004 | T-002 | 需先 build |
| T-005 | T-002 | **仅** 框架 smoke test（不依赖 Stage 2，不要求 jsonl 写入）|
| T-010 | T-002 | 方案 A 确认后实现 writeTelemetry |
| T-011 | T-010 | recordAndReturn wrapper 依赖 writeTelemetry |
| T-012 | T-010 | 单测依赖 writeTelemetry 可 import |
| T-013 | T-011、T-012 | 验证 build + 单测全通过 |
| T-014 | T-013 | P5 端到端完整验证（hook 实现后），破打 T-005 / Stage 2 循环 |
| T-020 | T-003 | oracle kind 由 P3 结论决定 |
| T-021 | T-020、T-004 | fixture 生成 + baseline 就绪 |
| T-022 | T-021 | 人工校验后 commit |
| T-023 | T-022 | schema 校验 |
| T-030 | 无 [P] | 可与 Stage 3 并行 |
| T-031 | T-030、T-003 | 单测 + 9 场景校准 |
| T-040 | T-013、T-022 | eval 脚本框架，需 build 通过 + 有 fixture |
| T-041 | T-040、T-004 | loadSpectraContextForSweBench 需 baseline 就绪 |
| T-042 | T-041 | Group A 分支 |
| T-043 | T-041 | Group B 分支，可与 T-042 并行 |
| T-044 | T-041、T-011 | Group C 需 telemetry hook 完整 |
| T-045 | T-042 | stop-loss 在 Group A 框架上实现 |
| T-046 | T-044、**T-031** | dry-run 集成测试需 Group C 完整 + ast-diff matcher 就绪（修复 Codex WARNING）|
| T-050 [P] | T-022、T-046 | verify 脚本可与 eval 主脚本并行开发框架，验收时需 eval 可用 |
| T-051 | T-050、T-054 | 运行 verify，需 147 §6 已添加 |
| T-054 [P] | T-022 | 147 §6 骨架，可与 Stage 5 并行 |
| T-060 | T-046、T-051、**T-031** | pilot 需 eval 完整 + verify ①~④ + ast-diff matcher 就绪（修复 Codex WARNING）|
| T-061 | T-060 | 完整实验，依赖 pilot 结论 |
| T-062 | T-061 | 数据汇总，依赖实验完成 |
| T-063 | T-062 | 人工撰写结论，依赖数据填入 |
| T-070 [P] | T-063 | 最终 check |
| T-071 | T-070、T-063 | 最终 verify |

---

## 关键路径分析

```
T-001/T-002/T-003/T-004
    ↓
T-010 → T-011 → T-012 → T-013
         ↑
T-020 → T-021 → T-022 → T-023
         ↑
T-030 → T-031（并行）
         ↓
T-040 → T-041 → T-042/T-043/T-044 → T-045 → T-046
                                              ↓
T-054（并行）→ T-050 → T-051 ←─────────────┘
                               ↓
T-060 → T-061 → T-062 → T-063 → T-070 → T-071
```

**关键路径**（最长依赖链，决定最短完成时间）：  
T-002 → T-010 → T-011 → T-012 → T-013 → T-040 → T-041 → T-044 → T-046 → T-060 → T-061 → T-062 → T-063 → T-070 → T-071

**估算总工时**：~28-36 hours 实现 + 3-5 天 Stage 7b 实跑（含等待 API）

---

## 独立可并行任务汇总

以下任务在依赖满足后可并行执行（标 [P]）：

| 任务 | 并行前提 | 说明 |
|------|---------|------|
| T-001 / T-002 / T-003 | 无 | Stage 1 中三者均可立即启动 |
| T-003 / T-004 | T-002 build 完成 | T-003 与 T-004 可并行 |
| T-030 / T-031 | T-030 无前置 | Stage 4 与 Stage 3 可并行 |
| T-042 / T-043 | T-041 完成 | Group A/B 分支可并行实现 |
| T-050 / T-054 | T-022 fixture 入库 | verify 框架与 147 §6 骨架可并行 |
| T-070 | T-063 完成 | check 任务可并行 |

---

## FR 覆盖映射表

| FR | 覆盖任务 |
|----|---------|
| FR-A-001（fixture 数量 ≥ 5） | T-020、T-021、T-022 |
| FR-A-002（fixture schema 全字段） | T-020、T-023 |
| FR-A-003（Python / createdAt 过滤） | T-020、T-021 |
| FR-A-004（oracle 定义 / 退化条款） | T-020、T-031 |
| FR-A-005（裸机可执行，无 Docker） | T-003、T-020 |
| FR-A-006（status / notes 可选字段） | T-020 |
| FR-B-001（import 复用 eval-task-runner，不改 SUPPORTED_TOOLS） | T-042、T-043、T-044 |
| FR-B-002（--group A/B/C） | T-040 |
| FR-B-003（--task） | T-040 |
| FR-B-004（--repeat N，run-N.json 命名） | T-040 |
| FR-B-005（--dry-run） | T-045、T-046 |
| FR-B-006（run-N.json 必须字段） | T-042、T-043、T-044 |
| FR-B-007（退出码 0 约定） | T-045 |
| FR-B-008（--stop-loss / --max-judge-calls） | T-045 |
| FR-C-001（Group A bare baseline） | T-042 |
| FR-C-002（Group B spec.md push / degraded） | T-041、T-043 |
| FR-C-003（Group C MCP pull / mcp-config / mandatory instruction） | T-044 |
| FR-C-004（≥5 task × 3 group × N=3） | T-061 |
| FR-D-001（functional oracle 两步验证） | T-020、T-021 |
| FR-D-002（ast-diff fuzzy match / normalize / multiset Jaccard） | T-030、T-031 |
| FR-D-003（timeoutMs / oracleError 可选） | T-020 |
| FR-E-001（147 §6 章节 + detail 报告 + 数据一致） | T-054、T-062、T-063 |
| FR-E-002（Token Cost 静态对比表 3 行） | T-054、T-062 |
| FR-E-003（Pass Rate 矩阵 + 统计声明） | T-054、T-062 |
| FR-E-004（147 §6 跨链接） | T-054 |
| FR-E-005（mcpToolCallCount 子矩阵，可选） | T-063 |
| FR-F-001（verify-feature-158.mjs step/report 模式） | T-050 |
| FR-F-002（6 个检查点） | T-050 |
| FR-F-003（verification-report.md 输出） | T-051、T-071 |
| FR-G-001（telemetry hook 方案 A，3 handler） | T-010、T-011 |
| FR-G-002（静默降级，写入失败不阻塞） | T-010、T-012 |
| FR-G-003（Group C 注入 SPECTRA_MCP_TELEMETRY_PATH，解析 JSONL） | T-044 |

**FR 覆盖率：24/24（100%）**

---

## SC 覆盖映射表

| SC | 自动验证任务 | 人工确认时机 |
|----|------------|------------|
| SC-001（fixture ≥5 + schema 合规） | T-023、T-050 检查点 ①② | — |
| SC-002（dry-run 成功） | T-046、T-050 检查点 ③ | — |
| SC-003（脚本参数完整） | T-040、T-046 | — |
| SC-004（≥45 runs） | — | T-061 完成后 post-eval 人工确认 |
| SC-005（147 §6 实质内容） | T-050 检查点 ⑤（标题存在） | T-063 结论撰写后 spec-review 确认 |
| SC-006（Token Cost 数值） | — | T-062 数据填入后人工确认 |
| SC-007（verify CI 零失败） | T-071 | — |
| SC-008（跨链接有效） | T-050 检查点 ⑥ | T-054 添加链接后 |
| SC-009a（telemetry env var 注入） | T-046、T-050 检查点 ④ | — |
| SC-009b（telemetry JSONL 存在） | — | T-060 pilot 完成后 post-eval 验证 |

---

## 实施策略建议

**MVP First（最小可验证范围）**：  
先完成 Stage 1 → Stage 2 → Stage 3 → Stage 4（T-001 ~ T-031）→ Stage 6b T-054，确认 fixture 入库 + telemetry hook + fuzzy match 可用后，再推进 Stage 5 实现评测主脚本。

**推荐执行顺序**：
1. 并行启动 Stage 1 中的 T-001 / T-002 / T-003
2. T-002 完成后立即启动 T-004 / T-005；T-030 可与 Stage 1 完全并行
3. Stage 2 在 T-002 P2 结论后立即开始（T-010 → T-011 → T-012 → T-013）
4. Stage 3 在 T-003 P3 结论后开始（T-020 → T-021 → T-022 → T-023）
5. Stage 5 + Stage 6 + T-054 在 T-013 / T-022 / T-031 完成后并行推进
6. Stage 7a pilot（T-060）在 T-046 + T-051 双通过后启动
7. Stage 7b 全量实验（T-061 → T-062 → T-063）最后执行

---

*本 tasks.md 基于 spec.md（24 FR / 9 SC / 14 EC）、plan.md（7 stages，含 Codex 1 轮修复）生成，覆盖全部 24 条 FR，任务总数 = 28（T-005 / T-014 拆分后），独立可并行任务 = 12。*

---

## Codex 对抗审查迭代记录（tasks 阶段）

### 第 1 轮 Codex Review（2026-05-09，phase=tasks）

Codex 给出 1 CRITICAL + 4 WARNING + 1 INFO，全部已修复：

| Codex finding | 类型 | tasks.md 修复点 |
|--------------|-----|----------------|
| C-T005: T-005 P5 与 Stage 2 形成循环依赖（jsonl 写入要求 hook 实现）| CRITICAL | T-005 改为 pre-hook smoke（仅验证环境变量传递，不要求 jsonl 写入），新增 T-014 做 post-hook 端到端 P5 验证 |
| W-T031: T-046/T-060 漏 T-031 ast-diff 依赖 | WARNING | T-046 / T-060 显式加 T-031 依赖，确保 fuzzy matcher 就绪 |
| W-SC002: SC-002 验证范围只测 first fixture | WARNING | T-046 改为遍历所有 fixture taskId 跑 dry-run |
| W-FR-A-003: 日期降级条款验收冲突（fallback 与 strict ≥2024 冲突）| WARNING | T-021 改为条件验收（含 dateThresholdDegraded=true 路径），T-063 加 §6.4 降级 audit |
| W-FR-D-002: goldPatch 文件路径无产物保障 | WARNING | T-022 加 .goldpatch.diff 文件入库要求 |
| I-T004: T-004 工时 4h 偏高（plan 估 25-35 min）| INFO | 调整为 1.5h（含 buffer） |

修复后 tasks 总数 27 → 28（新增 T-014），依赖关系 DAG 更新，破解 T-005/Stage 2 循环。

