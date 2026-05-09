# Feature 158 — Online Supplement Research

> 目的：为 Feature 158（SWE-Bench Lite Grounding Eval Harness）提供 5 个外部事实点的可核实事实和具体落地建议。
> 调研日期：2026-05-09。Perplexity MCP 在调研时段持续 500，主搜索改用 WebSearch + WebFetch 直取一手源；所有 URL 均保留以供 specify phase 复核。

---

## 1. GitNexus eval/ 目录架构

**结论**：GitNexus 已有完整的 eval 框架，**直接以 SWE-bench instance 为评估单元、复用 SWE-bench 官方 harness 做 grading**，并不自建 task fixture，本 Feature 几乎可以照抄它的目录骨架。

### 顶层目录（`abhigyanpatwari/GitNexus/eval/`）

| 目录/文件 | 作用 |
|----------|------|
| `agents/` | Agent 实现层（如 `GitNexusAgent extends DefaultAgent`） |
| `analysis/` | 跑批后的对比分析工具（包含 `analyze_results.py`） |
| `bridge/` | Tool 集成层（bash 包装、MCP bridge） |
| `configs/models/` + `configs/modes/` | YAML 配置：模型选择 + 跑评模式 |
| `environments/` | Docker 环境（GitNexus + eval-server 双容器） |
| `prompts/` | Jinja 模板，按 mode 切换 system prompt |
| `tests/`、`utils/` | 内部测试和工具 |
| `run_eval.py` | 主入口：`debug` / `single` / `matrix` 三个 subcommand |
| `tool_registry.py` | tool 注册表 |

### Task fixture 与 grading

- **task fixture 格式**：完全复用 SWE-bench Lite instance（`django__django-16527` 这类 instance_id）。eval/ 自己**不维护**独立的 input/oracle/metrics fixture
- **跑评 grading**：`python -m analysis.analyze_results summary results/ --swebench-eval` —— 直接调 SWE-bench 官方 harness 的 patch + pytest 验证，不写自己的 judge
- **三种模式对比**（GitNexus 论文级核心实验设计）：
  - `baseline` — agent 仅有 bash 工具（grep / find / cat / sed）
  - `native` — baseline + 显式 GitNexus tool 通过 eval-server 调（~100ms 延迟）
  - `native_augment` —（**推荐**）native + grep 结果自动用 graph context 增强 → 模拟 Claude Code 自然行为
- **指标**：patch rate / resolve rate / API cost / tool call count / augmentation hit rate
- **输出**：terminal summary + `--format csv` + `compare-modes` + `gitnexus-usage` breakdown，结果落 `results/` (gitignored)

### 给 Feature 158 的启发

- **直接借鉴 3-mode 对比设计**：将 spectra MCP 的"baseline / mcp-only / mcp-augmented"映射到这套结构，实验设计已被业内验证
- **不要自建 judge**：grading 直接借 SWE-bench harness（如果走 Lite）或简化为"patch 是否覆盖 oracle test"
- **配置分层**（modes × models）抄 `configs/modes/*.yaml` + `configs/models/*.yaml` 的二维矩阵，避免 hard-code

### URL 来源

- repo 主页：https://github.com/abhigyanpatwari/GitNexus
- eval 目录：https://github.com/abhigyanpatwari/GitNexus/tree/main/eval
- eval README：https://github.com/abhigyanpatwari/GitNexus/blob/main/eval/README.md
- 工具介绍文章：https://www.marktechpost.com/2026/04/24/meet-gitnexus-an-open-source-mcp-native-knowledge-graph-engine-that-gives-claude-code-and-cursor-full-codebase-structural-awareness/

---

## 2. SWE-Bench Lite 数据集

**结论**：HuggingFace 上仍**正常在线、MIT license、可商用**。test split 共 **300 条**，dev split **23 条**，跨 **11 个 Python repo**，每条 instance 字段齐全（含 FAIL_TO_PASS / PASS_TO_PASS）。**强烈建议复用原 fixture**，不要自建。

### 完整 instance 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `instance_id` | str | 形如 `repo_owner__repo_name-PR-number` |
| `repo` | str | `owner/name` |
| `base_commit` | str | 解决 PR 应用前的 HEAD commit hash |
| `patch` | str | gold patch（PR 中除测试外的源码 diff） |
| `test_patch` | str | PR 中的测试文件 diff |
| `problem_statement` | str | issue 标题 + body |
| `hints_text` | str | issue 在 PR 提交前的评论 |
| `created_at` | str | PR 创建日期 |
| `version` | str | 用于环境配置的版本号 |
| `environment_setup_commit` | str | 用于安装环境的 commit hash |
| `FAIL_TO_PASS` | JSON list | 该 PR 修复后从 FAIL 转 PASS 的测试名 |
| `PASS_TO_PASS` | JSON list | 应用 PR 前后都应 PASS 的回归测试名 |

### 数据集规模

- **test**: 300 条（评估用）
- **dev**: 23 条（开发用）
- **总计**: 323 条；parquet 格式；总大小 1.25 MB
- 派生数据集：`SWE-bench_Lite_oracle`（gold context 注入）、`SWE-bench_Lite_bm25_13K/27K`（BM25 retrieval baseline）

### 11 个 Python repo

`django/django` · `sympy/sympy` · `matplotlib/matplotlib` · `scikit-learn/scikit-learn` · `pallets/flask` · `astropy/astropy` · `psf/requests` · `mwaskom/seaborn` · `sphinx-doc/sphinx` · `pydata/xarray` · `pylint-dev/pylint` · `pytest-dev/pytest`（官方说 11 个 repo，列出 12 个 owner/name 是因为 SWE-bench full 共 12 个，Lite 排除 1 个；以 HuggingFace 最终 unique 为准）

### Lite instance 筛选标准

- 排除含图片、外部链接、commit SHA 引用、其他 issue/PR 引用的 instance
- 排除 problem_statement 短于 40 词的
- 保持 11 个 repo 的多样性分布

### 许可证

- **代码**：SWE-bench 主仓库 MIT License（Copyright 2023 Carlos E Jimenez et al.），**允许商业用途**
- **数据集**：HuggingFace dataset card 的 license 字段未在网页直接显示；惯例为继承代码 MIT。**保守做法**：specify phase 在 spec.md 里明确"内部研究 + 评估用途，遵守 MIT" + 在 fixture 文件头注明出处

### 给 Feature 158 的启发

- **直接复用 test split 的 5-10 条**，不要 fork 也不要改字段
- 评分用 **`FAIL_TO_PASS` + `PASS_TO_PASS`** 即可，不需要再设计 oracle —— SWE-bench 已经标好"哪些测试该过 / 哪些不该退化"
- `hints_text` 字段对 grounding 评估有特殊价值：可以作为"system prompt push"的上下文输入，用于对比"MCP tool pull"

### URL 来源

- 数据集主页：https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite
- 官方介绍：https://www.swebench.com/lite.html
- 论文：https://arxiv.org/pdf/2310.06770 (ICLR 2024)
- LICENSE：https://github.com/SWE-bench/SWE-bench/blob/main/LICENSE

---

## 3. MCP grounding ROI 量化

**结论**：业内已有 **MCP-Atlas (1000 task)** 和 **MCP-Bench** 两套权威 benchmark；核心可借鉴的两个方法论是：(a) **claims-based rubric with partial credit**（0/0.5/1）替代 binary pass/fail；(b) **coverage-based pass rate**（覆盖率 ≥ 0.75 即通过）。Claude Opus 4.5 在 grounding 上 **62.3% pass / 78.5% coverage**，是当前 SOTA 参考线。

### MCP-Atlas (arXiv 2602.00933)

- **数据集**：1000 task × 36 个真实 MCP server × 220 tool；每个 task 平均 3-6 次 tool 调用，含 5-10 个 systematic distractor
- **三大 metric**：
  1. **Pass rate**：claims-based coverage 是否 ≥ 0.75 阈值
  2. **Coverage score**：每条声明给 0/0.5/1（partial credit 容忍小遗漏）
  3. **Internal diagnostics**：discovery precision/recall、参数正确率、错误恢复
- **关键 finding**：失败的 36-42% 来自 **"no tools called"**（agent 都没意识到该用 tool）—— **bottleneck 不是用 tool 的能力，而是触发 tool 的觉知**
- **Claude SOTA**：Opus 4.5 = 62.3% pass / 78.5% coverage；Sonnet 4.5 = 43.8% / 62.1%
- **方法论价值**：claims-based rubric 与人类评判 78% agreement，**优于 holistic LLM-as-judge**

### MCP-Bench (arXiv 2508.20453)

- 通过 execution history + rubric LLM judgment 评估 grounding
- 强调 "factual consistency across calls" 与 "traceable evidence"

### "system prompt push" vs "MCP tool pull" 对比

- **明确事实**：MCP-Atlas 论文**未直接做**这种对比实验
- **业内变通**：GitNexus 的 baseline / native / native_augment 三模式是目前业内对该问题最完整的实证（见事实点 1）—— Feature 158 走类似路径即可填补这个 gap

### 给 Feature 158 的启发

- 选 **pass rate**（patch resolved）+ **tokens consumed** + **wall time** + **dollar cost** 四指标即可，不用搞太复杂
- 如果想加深度评估，加一个 **claims-based rubric**：让 LLM judge 对每个 task 输出"agent 是否调用了正确 spectra tool"的 0/0.5/1 评分
- **不要绕开 "no tools called" 这个 trap**：实验设计要显式验证 spectra MCP 是否被 agent 触发（log tool call 序列），别只看终态 pass rate

### URL 来源

- MCP-Atlas: https://arxiv.org/html/2602.00933v2
- MCP-Bench: https://arxiv.org/pdf/2508.20453
- MCP vs RAG 对比: https://www.truefoundry.com/blog/mcp-vs-rag

---

## 4. Claude Code MCP 多 tool 调用最佳实践

**结论**：Claude Code 内**默认通过 subagent 机制**调 MCP tool；subagent **默认继承 main agent 的所有 MCP tool**；要让 agent 自然选对 tool，关键是 **tool description 写清楚 + tool list 短**（业内共识）。Feature 158 应**让 evaluation harness spawn subagent 跑每个 task**，不用自己重新发明调用机制。

### Subagent 调用机制

- subagent 在**独立 context window** 中运行，有自己的 system prompt + 工具集 + 权限
- main agent 通过 subagent 的 **description 字段**决定何时 delegate
- **tool 默认继承**：subagent 自动获得 main conversation 的所有 MCP tool（包括 spectra MCP 注册的工具）
- **过滤手段**：用 `tools` 字段（白名单）或 `disallowedTools` 字段（黑名单）限制 subagent 可见 tool

### Tool 选择最佳实践（业内共识）

- **Tool list 越短越好**：模型每轮都要扫所有 tool，列表臃肿会拖慢 + 选错
- **Feature-specific subagent > 通用 "qa" / "backend engineer"**：specificity 让 tool selection 更准、context 更紧
- **Tool description 要明确写清楚 "何时用 / 不用"**：是触发 tool 调用的关键
- **Scope 分层**：跨项目稳定的 tool（GitHub、Slack、文件系统）用 user level；项目专用 tool（如 spectra MCP）用 project level

### 解决"agent 没意识到该调 tool"

- 把 tool description 中显式列出场景：例：spectra MCP 的 `query_dependency` tool 描述要写"查任意符号的 caller / callee 关系"，让 agent 看一眼就知道这是查代码结构的入口
- system prompt 顶部加引导："when investigating code structure, prefer using the spectra MCP tools (query_dependency / impact_analysis) over reading files line by line" —— 这是 GitNexus 在 native_augment 模式里做的事

### 给 Feature 158 的启发

- **harness 架构**：写一个 evaluation orchestrator（Node 或 Python 脚本），按 task 调 Claude Code subagent，subagent system prompt 里注入 spectra MCP tool description
- **不需要再封装 child process**：Claude Code 本身的 subagent 机制就是为这种场景设计的
- **三模式映射**（GitNexus 启发）：
  - `baseline` — subagent 没注册 spectra MCP，只有 Read / Grep / Glob
  - `mcp-explicit` — subagent 注册 spectra MCP，system prompt 显式告知 tool 列表
  - `mcp-augmented` — `mcp-explicit` + system prompt 指引"先用 spectra 查全局结构再读文件"

### URL 来源

- subagent 文档：https://code.claude.com/docs/en/sub-agents
- Claude Code 系统 prompt 反向工程：https://github.com/Piebald-AI/claude-code-system-prompts
- 业内 best practice 综合：https://mcp.directory/blog/claude-code-best-practices
- MCP Setup 实战：https://nimbalyst.com/blog/claude-code-mcp-setup/

---

## 5. SWE-Bench Lite 本地 reproduce 可行性

**结论**：**官方明确 docker 是必需**，但有两条 escape hatch：(a) **mini-SWE-agent** 的 `LocalEnvironment` 可绕开 docker（不推荐用于跑分但适合快速验证）；(b) **Singularity / Apptainer / Bubblewrap** 替代轻量沙箱。**Feature 158 推荐用 docker**，因为镜像 + 测试时间在 5-10 条 task 量级完全可承受。

### Docker 必要性

- **官方 FAQ 答**：" No. Docker is required for consistent evaluation environments."
- 用 docker 的核心理由：跨机器**可复现**（Python 版本、依赖、OS 差异都封进 image）
- 不用 docker 的代价：每个 repo 要本地 setup Python 环境（`environment_setup_commit` + version 字段标好版本），bug 出现时分不清是 spectra 的问题还是环境问题

### Lightweight 替代方案

| 方案 | 是否需要 docker | 适用场景 |
|------|--------------|---------|
| 官方 docker harness | 是 | 论文级可复现 |
| `--namespace ''` 本地 build image | 是（但本地 build） | M-series Mac、ARM |
| **mini-SWE-agent + LocalEnvironment** | **否** | 快速冒烟、原型验证 |
| Singularity / Apptainer | 否（HPC 沙箱） | 共享集群无 docker 权限 |
| Bubblewrap | 否 | 极简沙箱 |

### mini-SWE-agent 关键事实

- 入口：`mini-extra swebench-single --subset lite --slice 0:5 --model claude-sonnet-4-5-20250929 -i 0`
- `--slice 0:N` **直接选前 N 条**（解决"5-10 条 subset"问题）
- `--filter` 支持正则（按 instance_id 精筛）
- 默认 model 是 Sonnet 4.5，cost 用 `MSWEA_GLOBAL_COST_LIMIT` 环境变量控
- 文档：mini-swe-agent.com/latest/usage/swebench/

### 资源预估（docker 模式 Lite 全量）

- **存储**：120 GB free space（官方推荐，跑全 300 条）
- **内存**：16 GB
- **CPU**：8 cores（worker = `min(0.75 * cpu_count, 24)`）
- **跑分时间**：Epoch AI 报告 1 小时跑完 Verified（500 条）on 1 machine
- **Lite 5-10 条 subset 估算**：**单机 5-15 分钟可完成**（拉镜像 + 跑测试），存储 5-10 GB（按平均每 repo image 1 GB）

### 给 Feature 158 的具体落地建议

- **第一步用 docker（GitNexus 路径）**：5-10 条 subset 的资源消耗完全可承受，可复现性收益远大于 setup 成本
- **挑选标准**：从 11 个 repo 各挑 1 条；优先挑 hints_text 较丰富的（grounding 信息密度高）；避开有大量异步 / network mock 的（容易测试不稳定）
- **首批候选**：scikit-learn、django、sympy、flask、requests 这 5 个 repo —— 项目成熟、依赖少、测试稳定。**避开** matplotlib（图形渲染依赖）、xarray（科学计算 + numpy 版本敏感）
- **CI 友好**：harness 设计里把 docker run 抽象成一个 step，本地用 `docker run`，CI 也用同一套，避免双轨维护
- **降级路径**：如果 CI 不能跑 docker，mini-SWE-agent 的 `--environment-class local` 模式作为 fallback（仅用于 smoke 测试）

### URL 来源

- 官方 FAQ：https://www.swebench.com/SWE-bench/faq/
- mini-SWE-agent：https://mini-swe-agent.com/latest/usage/swebench/
- Epoch 1-hour blog：https://epoch.ai/blog/swebench-docker
- SWE-bench docker 项目：https://github.com/aorwall/SWE-bench-docker

---

## 关键决策建议（给 specify phase 用）

### 决策 1：是否复用 SWE-Bench Lite 原 fixture？

**复用**。理由：
- 官方维护、MIT license、HuggingFace 在线、字段齐全（FAIL_TO_PASS / PASS_TO_PASS 直接给 grading 标准）
- 自建 fixture 等于把 SWE-bench 团队 1 年的工作（论文 ICLR 2024）重做一遍，无任何 ROI
- GitNexus 已成功路径验证：直接 task fixture = SWE-bench Lite instance

### 决策 2：选几条 task？

**先 5 条 smoke + 10 条 baseline**：
- **5 条 smoke**：跨 5 个不同 repo（django / scikit-learn / sympy / flask / requests），单机 5-10 分钟跑完，验证 harness 自身正确性
- **10 条 baseline**：smoke 通过后，再叠 5 条（pytest、astropy、sphinx、seaborn、pylint），用作 grounding lift 主实验数据集
- **避开**：matplotlib、xarray（图形 / 科学计算依赖复杂）

理由：
- 10 条已足以暴露三模式（baseline / mcp-only / mcp-augmented）的统计差异
- 全量 300 条 token 成本 + 时间不划算（先证明 lift 存在，再决定是否扩量）

### 决策 3：是否需要 docker？

**需要，用 SWE-bench 官方 docker harness**。理由：
- 5-10 条 subset 资源开销完全可承受（5-10 GB 存储、5-15 分钟时间）
- 可复现性是 grounding lift 实验的生命线，不能让"环境问题"污染信号
- 降级路径已留：mini-SWE-agent + LocalEnvironment 作为 CI 无 docker 时的 fallback

### 决策 4：评估 mode 怎么设？

**抄 GitNexus 的 3 模式 + 调整命名**：
- `baseline`：agent 仅有 Read / Grep / Glob / Bash（无 spectra MCP）
- `mcp-explicit`：baseline + spectra MCP tool 注册 + system prompt 显式列出 tool
- `mcp-augmented`：mcp-explicit + system prompt 引导"优先用 spectra 查代码结构"

### 决策 5：metrics 选哪些？

**4 个核心 + 1 个深度**：
- 核心：**pass rate**（FAIL_TO_PASS 全过 + PASS_TO_PASS 不退化）/ **tokens consumed** / **wall time** / **API cost USD**
- 深度（可选 P1）：**tool call trace**（spectra MCP 是否被实际调用、调用次数、第一次调用时机）—— 直击 MCP-Atlas 揭示的"no tools called" trap

### 决策 6：grading 怎么实现？

**复用 SWE-bench 官方 harness**，不自建：
- `python -m swebench.harness.run_evaluation --predictions_path predictions.jsonl`
- 输出 resolved / not-resolved 二元判定 + per-test 状态
- 自己只写 wrapper 脚本聚合 token / cost / wall time

### 决策 7：harness 架构怎么写？

**Python orchestrator + Node bridge**（GitNexus 路径）：
- Python 脚本（`run_eval.py` 风格）：load fixture → spawn Claude Code subagent（per task）→ collect patch + log → 调 SWE-bench harness grading
- Node bridge：仅当 spectra MCP 是 Node 实现时，作为 MCP server 进程供 subagent 连
- configs 二维矩阵：`configs/modes/*.yaml`（baseline / mcp-explicit / mcp-augmented）× `configs/models/*.yaml`（Sonnet 4.6 / Opus 4.7）

---

## 调研工具说明

- **预期主搜索 Perplexity 在调研时段持续 500 错误**（OpenRouter 上游故障），全部改用 WebSearch + WebFetch 直取一手源
- 关键事实点都从 GitHub repo / HuggingFace dataset card / 官方 FAQ / arXiv 论文取一手数据，未发生信息丢失
- 报告所有结论可通过 URL 列表复核
