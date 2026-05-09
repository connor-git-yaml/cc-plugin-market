# 技术调研报告: SWE-Bench Grounding Eval (Feature 158)

**特性分支**: `158-swe-bench-lite-grounding-eval/impl-supplement`
**调研日期**: 2026-05-09
**调研模式**: 在线
**产品调研基础**: [独立模式] 本次技术调研未参考产品调研结论，直接基于需求描述执行。

---

## 1. 调研目标

**核心问题**:
- SWE-Bench Lite 数据集如何获取、子集如何选取、能否免 Docker 集成到现有 eval 基础设施？
- 3 组对比（bare / spec-push / mcp-pull）的具体实施路径是什么，特别是 Group C 如何让 agent 自动调 MCP tool？
- `scripts/eval-mcp-augmented.mjs` 应独立脚本还是复用 eval-task-runner 的 mode 扩展？
- Oracle 如何设计（FAIL_TO_PASS vs 简化版）？
- $50 预算在 N=3、5-10 task、3 组下是否可行？

**需求范围**:
- Must-have: `scripts/eval-mcp-augmented.mjs`（新增），`tests/baseline/swe-bench-lite/`（新增 fixture），`specs/157-.../competitive-evaluation-report.md` 含 §6，`scripts/verify-feature-158.mjs`
- 验证对象：Feature 155 的 impact / context / detect_changes 3 个 MCP tool 的 grounding lift ROI

---

## 2. 架构方案对比

### 方案 A：独立脚本 `eval-mcp-augmented.mjs`

3 组对比逻辑全部内联在新脚本里，通过 `--group A|B|C` 切换。task fixture 定义在 `tests/baseline/swe-bench-lite/fixtures/` 下（与现有 `specs/147-.../research/task-fixtures/` 并列但独立命名空间）。

**实施路径**：
- Group A（bare）：与 `eval-task-runner` 的 `control` tool 相同逻辑，裸 claude CLI 调用
- Group B（spec-push）：加载对应 module 的 `~/.spectra-baselines/<project>-output/spectra-full/modules/<module>.spec.md`，通过 system prompt 注入（复用 `loadSpectraContext`，来自 `scripts/eval-task-runner.mjs` L157-183）
- Group C（mcp-pull）：在 system prompt 中加入 MCP tool 使用指令，并在 `claude` CLI 参数中通过 `--mcp-config` 注册本地 Spectra MCP server；agent 根据任务场景自主决定何时调 `impact`、`context`、`detect_changes`

### 方案 B：扩展 `eval-task-runner.mjs` 加新 tool `mcp-augmented`

在 `SUPPORTED_TOOLS`（`scripts/eval-task-runner.mjs` L27）加 `'mcp-augmented'`，并在 `buildDriverPrompt` 和 `buildClaudeArgs` 里增加对应分支。

### 方案对比表

| 维度 | 方案 A: 独立脚本 | 方案 B: runner mode 扩展 |
|------|----------------|------------------------|
| 与现有代码耦合 | 低（独立，可按需复用函数） | 高（改共享 runner，影响现有 5 个 tool） |
| 实现速度 | 快（无需顾虑对现有 tool 的回归） | 慢（需额外 test 覆盖避免回归） |
| 代码复用 | 通过 import 复用 `prepareWorktree`、`runTask`、`runPrimaryOracle` 等导出函数 | 原生复用，更紧密 |
| SWE-Bench fixture 路径 | 独立命名空间清晰 | 需扩展 `loadTaskFixture` 的查找路径 |
| MCP server 启动灵活性 | 完全自由（可 spawn child process） | 受 buildClaudeArgs 接口约束 |
| 与 eval-batch-repeat.mjs 兼容 | 需小改（batch-repeat 硬编码 TASK_FIXTURES_DIR，`scripts/eval-batch-repeat.mjs` L28-29） | 更容易复用 |

### 推荐方案

**推荐**: 方案 A（独立脚本 + 按需 import 复用函数）

**理由**：
1. Feature 158 是一次性评测，不是新的长期竞品 tool，不应污染 `SUPPORTED_TOOLS` 常量（`eval-task-runner.mjs` L27），避免未来混淆
2. MCP server 注册需要传 `--mcp-config <json-file>` 给 `claude` CLI，这与现有 `buildClaudeArgs` 的接口不兼容，改动成本高于新增脚本
3. `eval-task-runner.mjs` 的所有核心函数均已 `export`（`prepareWorktree`、`runTask`、`runPrimaryOracle`、`assembleTaskFixture`），新脚本可直接 import 复用，无重复代码

---

## 3. SWE-Bench Lite 任务获取方案

### 数据集格式

官方 `princeton-nlp/SWE-bench_Lite`（HuggingFace）每条记录含：

| 字段 | 说明 |
|------|------|
| `instance_id` | 格式 `owner__repo-PR-number`，如 `django__django-12345` |
| `repo` | `owner/repo`，如 `django/django` |
| `base_commit` | 修复前的 HEAD commit hash |
| `problem_statement` | issue 原文（作为 task prompt） |
| `patch` | 官方修复 patch（gold patch，仅含非测试改动） |
| `test_patch` | 验证 patch（含 FAIL_TO_PASS / PASS_TO_PASS 测试） |
| `FAIL_TO_PASS` | 修复前失败、修复后应通过的测试 id 列表 |
| `PASS_TO_PASS` | 修复前后均应通过的测试 id 列表（regression guard） |
| `hints_text` | issue 上的相关评论 |

### 推荐获取方式：Python datasets + 手工 fixture 转换

```bash
pip install datasets
python3 -c "
from datasets import load_dataset
ds = load_dataset('princeton-nlp/SWE-bench_Lite', split='test')
# 筛选：Python 项目、patch 改动 ≤ 3 文件、FAIL_TO_PASS ≥ 1 条
items = [r for r in ds if r['repo'].split('/')[1] in ['sympy', 'astropy', 'pytest'] and len(r['FAIL_TO_PASS']) >= 1]
# 取前 5-10 条
import json
print(json.dumps(items[:10], indent=2))
"
```

转换为现有 fixture 格式（参考 `specs/147-.../research/task-fixtures/T1-micrograd-add-tanh.json`）：

```json
{
  "taskId": "SWE-L001-sympy-fix-xxx",
  "description": "<来自 problem_statement>",
  "target": "sympy/sympy",
  "startCommit": "<base_commit>",
  "prompt": "<problem_statement>",
  "primaryOracle": {
    "kind": "functional",
    "checks": [
      { "cmd": "python3 -m pytest <FAIL_TO_PASS test ids> -x -q", "timeoutMs": 60000 }
    ]
  },
  "swebenchMeta": {
    "instanceId": "<instance_id>",
    "failToPass": ["<test_id1>", "..."],
    "passToPass": ["<test_id1>", "..."],
    "goldPatch": "<patch text>",
    "testPatch": "<test_patch text>"
  }
}
```

### 任务选取标准

1. **语言**：仅选 Python（Feature 155 的 MCP tool 调用 Spectra graph，graph 已含 Python adapter callSites）
2. **patch 规模**：`gold patch` 改动 ≤ 3 文件（控制任务复杂度，避免 agent timeout）
3. **instance_id 日期**：优先 `2024-01` 以后（降低 Claude 训练集泄漏概率）
4. **目标 repo**：优先 `sympy`、`astropy`、`pytest-dev/pytest`（在 SWE-Bench Lite 300 题中出现频率高，且均为 Python 纯计算类 bug，无 web/DB 依赖）
5. **FAIL_TO_PASS 可执行**：确保 `pytest` 可在 clone 出的仓库里直接跑（不依赖 docker 镜像中的特殊系统依赖）

### Docker 策略

官方 SWE-Bench harness 强制 Docker（每 instance 独立 image，共 67 GiB）。**本 Feature 不使用官方 harness**，而是手工挑选可在裸机直接 `pip install -e .` + `pytest` 验证的任务，退化为"简化版 oracle"。

- **退路**：如果某个 SWE-Bench Lite 任务依赖复杂系统环境，直接用真实 GitHub PR + 手写 oracle（参考现有 T1~T6 的方式，`specs/147-.../research/task-fixtures/`），不强求覆盖官方 300 题。

---

## 4. 3 组对比实施路径

### Group A：Bare（对照组）

- **tool 名/mode**：`control`（复用 `eval-task-runner` 的 `control` 逻辑）
- **prompt**：直接传入 `problem_statement`，不附加任何额外 context
- **claude 调用**：`claude --print --model claude-sonnet-4-6 --permission-mode bypassPermissions --dangerously-skip-permissions "<prompt>"`
- **MCP**：无

### Group B：Spec-Push（Spectra spec.md 注入）

- **tool 名/mode**：`spec-driver-spectra`（复用 `loadSpectraContext`，`eval-task-runner.mjs` L157-183）
- **prompt**：在 problem_statement 之前注入 Spectra 生成的 `<module>.spec.md` 内容（system prompt push 方式）
- **前置条件**：目标仓库已完成 `npm run baseline:collect`，`~/.spectra-baselines/<repo>-output/spectra-full/modules/` 下存在对应 spec.md

### Group C：MCP-Pull（agent 自主调 tool）

- **tool 名/mode**：新增 `mcp-augmented`（仅在 `eval-mcp-augmented.mjs` 内部使用，不写入 `SUPPORTED_TOOLS`）
- **MCP server 启动**：eval 脚本在调 `claude` 之前，构造一个临时 `mcp-config.json`，注册本仓库的 Spectra MCP server：

  ```json
  {
    "mcpServers": {
      "spectra": {
        "command": "node",
        "args": ["<PROJECT_ROOT>/dist/mcp/index.js"],
        "env": { "SPECTRA_PROJECT_ROOT": "<wtDir>" }
      }
    }
  }
  ```

  然后 `claude --mcp-config <tmp-mcp-config.json> --print ...` 让 agent 能访问 `impact`、`context`、`detect_changes` tool。

- **system prompt 指令**：在 problem_statement 之前加一段 instruction：

  ```
  你有以下 MCP tools 可用：
  - spectra_impact: 分析修改一个 symbol 的 blast radius
  - spectra_context: 获取 symbol 的 360° 定义 / callers / callees
  - spectra_detect_changes: 分析 diff 影响哪些 symbols

  在开始修复前，建议先调用 spectra_context 确认要修改的 symbol 定义，
  再调 spectra_impact 评估影响范围，最后修复并验证。
  ```

- **token cost 捕获**：`claude --print` 的 stdout 中目前不含 token usage（`eval-task-runner.mjs` L368-371 中 `tokensInput: null`）。Group C 的额外 MCP 调用 token 目前无法精确捕获，标注为 [需 spec/clarify 阶段决定]，退化到 wallMs 对比。

---

## 5. Oracle 设计

### 推荐：简化版功能 oracle（非官方 harness）

```json
{
  "primaryOracle": {
    "kind": "functional",
    "checks": [
      {
        "cmd": "pip install -e . -q && python3 -m pytest <FAIL_TO_PASS 测试路径> -x -q 2>&1 | tail -5",
        "description": "FAIL_TO_PASS 测试必须转绿",
        "timeoutMs": 120000
      },
      {
        "cmd": "python3 -m pytest <PASS_TO_PASS 测试路径> -x -q 2>&1 | tail -5",
        "description": "PASS_TO_PASS 无 regression",
        "timeoutMs": 120000
      }
    ]
  }
}
```

成功定义：FAIL_TO_PASS 全部转绿 + PASS_TO_PASS 无新失败。

### 退化方案：ast-diff 对比

若某个任务无法裸机跑测试，退化为 `git diff HEAD` 与 `goldPatch` 的 fuzzy 比对（行级匹配 ≥ 60% 视为 pass）。这是已验证的 oracle 形式，参见 `eval-task-runner.mjs` L247-292 的 `runPrimaryOracle` 实现。

**不使用官方 SWE-Bench harness**：Docker 镜像 67 GiB、启动慢、需要 root，与现有 worktree rsync 方式不兼容。

---

## 6. 统计方法 + 预算估算

### N 与 task 数量

| 参数 | 值 | 说明 |
|------|-----|------|
| task 数量 | 5-8 | 在 $50 预算内可接受的规模 |
| 组数 | 3 | A / B / C |
| N（重复次数） | 3 | 平衡随机性与成本 |
| 总 runs | 5×3×3 = 45 ～ 8×3×3 = 72 | 中间值约 60 次 |

### 成本估算

- Group A/B：每次 claude 调用约 $0.15-0.30（Sonnet 价格，~5k-10k token per run）
- Group C：每次额外 MCP 调用 ~3-5 次，增加约 $0.05-0.10 per run
- 总估算：60 runs × $0.25 平均 ≈ **$15**，有 $35 缓冲空间用于失败重跑和 judge 调用（Opus）

**$50 预算充足**，但 Opus judge 调用（`eval-judge.mjs` 已有 `JUDGE_MODEL = 'claude-opus-4-7'`）会额外消耗，需控制 judge 调用次数（建议 5 task × 3 组 × 1 judge = 15 次 Opus 调用 ≈ $10）。

### 统计可信度

300 task 才有强统计显著性（SWE-Bench 论文设计）。5-8 task 在统计上仅为"信号探测"，不能声称绝对 pass rate。**报告中需明确标注**: "本评测为小样本信号验证（N=5-8 task），不构成统计显著性证明"。

复用 `eval-batch-repeat.mjs`（`scripts/eval-batch-repeat.mjs`）的 bootstrap CI 函数 `bootstrapPercentileCi`（L25）计算 95% CI，配合 N=3 重复。

---

## 7. 报告生成 §6 章节

### 现有报告位置

既有竞品评估报告：`specs/147-competitor-evaluation-platform/`（已有 `competitive-evaluation-report.md`）。Feature 158 的报告应独立建在 `specs/158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md`，不覆盖 147 的报告。

### §6 章节结构

```markdown
## §6 SWE-Bench Grounding Lift 实验

### 6.1 实验设计
- 数据集：SWE-Bench Lite 子集，N=<K> tasks，选取标准 ...
- 3 对照组：A（bare）/ B（spec-push）/ C（mcp-pull）
- 重复次数：N=3 per (task, group)

### 6.2 Pass Rate 矩阵

| Task | Group A | Group B | Group C |
|------|---------|---------|---------|
| SWE-L001 | 0/3 | 1/3 | 2/3 |
| ...

### 6.3 Token Cost 对比（wallMs 作为代理指标）

（由于 claude --print 不返回 token count，用 wallMs 作为代理）

### 6.4 结论

grounding lift = (C pass rate - A pass rate) / A pass rate
```

**auto-report 边界**：按 CLAUDE.local.md 约定，`§6` 矩阵数据部分可由脚本生成（auto），但结论段必须人工撰写（manual report 入库）。

---

## 8. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | SWE-Bench Lite instance 泄漏到 Claude 训练集，Group A baseline 虚高 | 中 | 高 | 优先选 2024 年以后的 instance_id；结论中标注泄漏风险 |
| 2 | 选出的 task 裸机 pytest 依赖系统库（如 C extension），无法免 Docker 跑 | 高 | 中 | 严格筛选 sympy/astropy 纯 Python 类任务；准备 5 个备选 task |
| 3 | Group C 的 MCP server 启动不稳定（`dist/mcp/index.js` 冷启动 / projectRoot 设置错误） | 中 | 高 | 在 eval 脚本中加 health-check（调一次 `impact({target:'nonexistent'})`，期望返回 `symbol-not-found` 而非 crash） |
| 4 | $50 预算超支（Opus judge + 失败重跑） | 低 | 中 | 先 dry-run 估算（`--dry-run` flag），限制 judge 调用 ≤ 20 次 |
| 5 | claude CLI 的 `--mcp-config` flag 在当前版本不可用或 flag 名不同 | 中 | 高 | [需 spec/clarify 阶段决定] 实施前用 `claude --help` 确认 flag 名，备选：通过 `.claude/mcp.json` 项目级配置 |
| 6 | Group C 中 agent 不主动调 MCP tool（system prompt 引导失效） | 中 | 高 | 加 mandatory instruction（"你必须在修改前调用 spectra_context 确认 symbol 定义"）；记录实际 tool call 次数到 fixture |
| 7 | 5-8 task 样本量统计可信度不足，diff 不显著 | 高 | 中 | 结论明确限定为"探索性信号"；如有预算则扩展到 20 task |
| 8 | Spectra graph 未覆盖 SWE-Bench 目标仓库（未跑 `baseline:collect`） | 中 | 高 | 每个选定 task 的目标仓库必须事先跑一次 `npm run baseline:collect`，验证 `_meta/graph.json` 存在且非空 |

---

## 9. 需求-技术对齐度评估

| 需求 | 技术方案覆盖 | 说明 |
|------|------------|------|
| `scripts/eval-mcp-augmented.mjs` 新增 | ✅ 完全覆盖 | 方案 A 独立脚本，import 复用 eval-task-runner 导出函数 |
| `tests/baseline/swe-bench-lite/` task fixture | ✅ 完全覆盖 | HuggingFace dataset 下载 + 手工转换为现有 fixture JSON 格式 |
| `specs/157-.../competitive-evaluation-report.md` §6 | ✅ 完全覆盖 | 独立报告文件，§6 含 task pass rate 矩阵 + token cost 对比 |
| `scripts/verify-feature-158.mjs` | ✅ 完全覆盖 | 复用 verify-feature-156.mjs 的 step/report 模式，验证 fixture 存在 + oracle PASS |
| 3 组对比（bare/spec-push/mcp-pull） | ✅ 完全覆盖 | Group A/B 复用现有逻辑，Group C 通过 `--mcp-config` 注册 Spectra MCP server |
| MCP tool invocation 可观测 | ⚠️ 部分覆盖 | claude --print 不返回 token count，MCP 调用次数需从 stdout log 解析或靠 server 侧日志 |

### Constitution 约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| 不直接修改 `.codex/skills/` | ✅ 兼容 | Feature 158 不触及 skills |
| 不修改 `src/knowledge-graph/unified-graph.ts` 等 Feature 151 合同区文件 | ✅ 兼容 | Feature 158 仅新增 eval 脚本和 fixture，不改生产代码 |
| 优先修改 `plugins/**` 与 `src/**` | ✅ 兼容 | Feature 158 主体在 `scripts/` 和 `tests/`，无生产代码改动 |

---

## 10. 结论与建议

### 核心结论

1. **任务获取**：推荐直接用 HuggingFace `datasets` 库下载 `princeton-nlp/SWE-bench_Lite`，手工筛选 5-8 个 Python 纯计算类 task，转换为现有 `functional` oracle fixture 格式。不使用官方 Docker harness（成本过高，与现有基础设施不兼容）。

2. **实施路径**：`eval-mcp-augmented.mjs` 应为独立脚本，通过 import 复用 `eval-task-runner.mjs` 的已导出函数，Group C 用 `claude --mcp-config` 注册本地 Spectra MCP server，system prompt 加 mandatory tool use instruction。

3. **Oracle**：功能 oracle（pytest FAIL_TO_PASS + PASS_TO_PASS），退化为 ast-diff 对比。

4. **统计方法**：N=3 重复 × 5-8 task × 3 组 ≈ $15-25，$50 预算充足。结论必须标注"探索性信号，不具统计显著性"。

5. **最大风险**：Group C 的 MCP tool 调用可观测性（`claude --print` 不输出 token count）和 `--mcp-config` flag 的兼容性需在 spec 阶段提前验证。

### 对 spec/plan 阶段的建议

- spec 阶段优先明确：`claude --mcp-config` flag 的实际用法（需在本机 `claude --help` 验证）
- plan 阶段需要：MCP tool 调用次数的记录方案（server 侧日志 vs prompt 解析）
- tasks 阶段建议：先用 `--skip-run` 模式验证 fixture JSON 格式正确，再实际跑 agent

---

*代码引用：*
- `eval-task-runner.mjs` SUPPORTED_TOOLS: `scripts/eval-task-runner.mjs:27`
- `loadSpectraContext`: `scripts/eval-task-runner.mjs:157-183`
- `buildDriverPrompt` spec-driver-spectra 分支: `scripts/eval-task-runner.mjs:138-143`
- `runPrimaryOracle` functional 分支: `scripts/eval-task-runner.mjs:265-291`
- `bootstrapPercentileCi`: `scripts/eval-batch-repeat.mjs:25`
- Feature 155 MCP tool 实现: `src/mcp/agent-context-tools.ts`
- 既有 task fixture 格式: `specs/147-competitor-evaluation-platform/research/task-fixtures/T1-micrograd-add-tanh.json`
