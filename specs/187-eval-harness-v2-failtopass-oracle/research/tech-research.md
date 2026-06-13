# 技术调研报告: F187 评测设施 v2 — FAIL_TO_PASS Oracle

**特性分支**: `claude/nostalgic-curie-ab8ca4`
**调研日期**: 2026-06-13
**调研模式**: 在线（Web Search 可用）
**产品调研基础**: [独立模式] 本次技术调研未参考产品调研结论，直接基于需求描述执行。

---

## 1. 调研目标

**核心问题**:
1. 测试执行环境怎么搭？官方 docker harness（含 x86_64 镜像 + QEMU 仿真）vs 轻量自建执行（通用 python 镜像 + git clone）各自的 arm64 可行性、判定保真度、实现成本如何？
2. 如何从 docker 退出码/输出可靠区分"测试真实 fail"vs"环境故障"（三分类 oracle）？
3. failToPass/passToPass pytest node id 如何稳健组成 pytest 调用并解析每条 test 的 pass/fail？
4. 单 instance 执行 timeout 应设多少？

**需求 MVP 范围**（来自需求描述）:
- 给定候选 patch，在目标 repo 的正确历史版本上 apply patch + testPatch，执行 failToPass / passToPass 测试
- 返回结构化 `{passed, exitCode, timedOut}`
- 能区分"真实测试失败"vs"环境故障"
- 自测只用最小 fixture（10 个，pytest/sympy/astropy 系列），不跑全量烧钱评测

---

## 2. 架构方案对比

### 2.1 方案 A：SWE-Bench 官方 docker harness

**概述**：使用 `swebench` pip 包的 `swebench.harness.run_evaluation` 模块，拉取 Epoch AI 公开镜像注册表（`ghcr.io/epoch-research/swe-bench.eval.<arch>.<instance_id>`），在容器内完成 patch apply + pytest 执行，读取 report.json 获取结果。

**输入合同**：

```jsonl
{"instance_id": "pytest-dev__pytest-11143", "model_name_or_path": "spectra-v1", "model_patch": "<unified diff string>"}
```

预测文件为 JSONL 格式，每行三字段。支持 `--instance_ids` 参数对单个 instance 单独执行：

```bash
python -m swebench.harness.run_evaluation \
  --predictions_path predictions.jsonl \
  --max_workers 1 \
  --instance_ids pytest-dev__pytest-11143 \
  --run_id test_run_001
```

**输出位置**：logs 写入 `./logs/run_evaluation/<run_id>/`，结构化报告含 `report[instance_id]["resolved"]` boolean 和 `completed` flag。

**默认 timeout**：`1800` 秒（30 分钟），可通过 `--timeout` 覆盖。

**镜像架构情况**（截至 2026-06 调研）：

| 镜像类型 | 注册表 | 覆盖率 | arm64 支持 |
|---------|--------|--------|-----------|
| Epoch AI 公开镜像 | `ghcr.io/epoch-research/swe-bench.eval.x86_64.*` | 2290/2294 (99.8%) | x86_64 only（生产测试） |
| Epoch AI arm64 镜像 | `ghcr.io/epoch-research/swe-bench.eval.arm64.*` | 1819/2294 (79.3%) | **best-effort，未经完整测试** |
| 官方原版镜像 | `swebench/sweb.eval.x86_64.*` | 旧版，未维护 | 无 |

**arm64 可行性分析**：

- arm64 原生镜像（Epoch AI）：理论上可直接跑，无需 QEMU；但覆盖率 79.3%（1819 张），fixture 中含 astropy（`astropy__astropy-13236` 系列）和 pytest，需逐一核查是否在 1819 张内。[推断] 10 个 fixture 所对应的 instance 大概率在 1819 张内，但未经实测确认。
- x86_64 镜像 + Rosetta/QEMU 仿真：macOS arm64 上 Docker Desktop 支持通过 Rosetta 2 运行 x86_64 容器。实测数据（2026-02 SWE-bench-fast benchmark）显示：
  - ARM64 native：87.3 秒（11 实例）
  - x86_64 emulated via QEMU：551.7 秒（11 实例）
  - **QEMU 性能退化约 6.3x**
  - Rosetta 2（非 QEMU）退化约 1.2–1.5x，比 QEMU 快但仍有开销
- 已知 crash 风险：QEMU 用户态仿真对特定 syscall 或 Python C 扩展可能触发 segfault（exit 139）；Rosetta 更稳定，但 Docker Desktop 已于 2025-07-14 废弃 QEMU 虚拟化选项（注意：仅废弃"虚拟化选项"，不影响跨架构容器仿真）。
- **依赖注意点**：实测发现 arm64 上 Pygments 等传递依赖版本与 x86_64 不同（2.19.2 vs 2.18.0），可能导致极少数 passToPass 测试语义不等价。需 pin 依赖。

**判定语义**：与官方完全等价——harness 本身就是 SWE-Bench 官方评测语义的载体，parse_log 函数逐行匹配 pytest 的 `PASSED`/`FAILED` 输出，再对比 failToPass/passToPass 列表，决定 `resolved`。

### 2.2 方案 B：轻量自建执行（无 harness）

**概述**：起一个通用 `python:3.x-slim` 或 `ghcr.io/astral-sh/uv:python3.x-bookworm-slim` 镜像，在容器内：`git clone <repo>` → `git checkout <base_commit>` → `uv pip install -e .`（conda 不可用，uv 替代）→ `git apply <goldPatch> <testPatch>` → `pytest <failToPass tests> --junit-xml /tmp/result.xml`，解析 junit-xml 得到每条 test 结果。

**依赖安装挑战**：

SWE-Bench 各 repo 的依赖 `requirements_*.txt` 因 instance 不同而异，且部分依赖有版本锁定（official harness 预先在 environment image 层固化了 ~60 种 Python 版本×依赖组合）。自建方案需每次 `pip install` 依赖，首次耗时显著（astropy 依赖树 100+ 包，编译 C 扩展需 5–15 分钟）。

**arm64 可行性**：`python:3.x-slim` 为 multi-arch 镜像，arm64 原生可用，无仿真开销。构建步骤（git clone、pip install）均原生 arm64 执行，速度快。

**判定语义复现难度**：

官方 harness 的判定语义并非仅靠"pytest 跑通"，还需：
1. 与官方完全相同的 Python 版本（pytest-dev__pytest-11143 对应的 env image 固定了 Python 版本）
2. 相同的依赖版本（环境 image 已 freeze）
3. 正确的 `conftest.py`、`tox.ini`、`setup.cfg` 等配置（可能影响测试 collect）

自建方案如果依赖版本与官方不一致，会产生语义漂移，导致本地 oracle 和 SWE-Bench 官方评分不等价。这对 F187（自测设施，不是提交官方榜单）影响可接受，但需记录。

**实现复杂度**：中等。需处理：repo-specific 安装脚本（部分 repo 有 `tox`、`pip install -e ".[testing]"` 等）、网络依赖（首次 pip install 需联网或预缓存）、多 Python 版本管理（uv 可简化）。

### 2.3 方案对比表

| 维度 | 方案 A：官方 harness | 方案 B：轻量自建执行 |
|------|---------------------|---------------------|
| **判定语义保真度** | 完全等价官方 FAIL_TO_PASS 判定 | 近似等价，依赖版本漂移可能导致少量差异 |
| **arm64 可行性** | arm64 原生镜像 best-effort（79.3%覆盖），x86_64 镜像 QEMU 退化 6.3x；Rosetta 约 1.2-1.5x 退化 | 完全原生 arm64，无仿真 |
| **单 instance 墙钟（设施自测）** | arm64 原生：~8-30 秒/实例；x86_64+QEMU：~50-180 秒/实例 | 首次（含 pip install）：5-20 分钟；有缓存层：30-120 秒 |
| **磁盘成本** | Epoch AI 镜像约 30 GiB（500 实例 verified），10 个 fixture 对应 10 张镜像约 600 MB–2 GB | 基础镜像 ~200 MB + 每次运行时 clone+deps |
| **实现+维护复杂度** | 低（调用 pip 包 API，单函数入口）；需处理 report.json 解析 | 中（自写 Dockerfile 逻辑、pip install 脚本、junit-xml 解析） |
| **离线/可复现性** | 镜像一旦 pull 后离线可跑，依赖已固化 | 需网络依赖（git clone + pip install），首次需联网 |
| **与现有 runner 融合难度** | 中（run_evaluation 是 Python CLI，需包装为 TS spawn child process，解析 JSONL 结果）；需确保 report.json 路径 | 低（直接 `docker run`，解析 junit-xml，逻辑完全受控） |
| **社区支持/文档** | 官方文档齐全，GitHub issue 活跃 | 无社区标准，完全自维护 |
| **学习曲线** | 低（现成 API）；但 run_evaluation 参数复杂 | 中（需理解各 repo 环境安装流程） |

### 2.4 推荐方案

**推荐：混合路径 — 优先尝试方案 A（Epoch AI arm64 原生镜像），自建执行作为回退**

**理由**：

1. **判定语义保真度是核心约束**：F187 的 oracle 替换目标是"真实 FAIL_TO_PASS 测试执行"，用官方 harness 保证与 SWE-Bench 评分语义完全对齐，避免自建方案因依赖漂移导致 oracle 结论和官方标准不一致（特别是 F188 跑批时会影响评分可比性）。
2. **arm64 原生镜像已有 79.3% 覆盖**：10 个 fixture 涵盖 pytest、sympy、astropy，这三个都属于 SWE-Bench Lite 高频 repo，大概率在 Epoch AI arm64 覆盖范围内（需执行 `docker manifest inspect` 逐一验证）。
3. **设施自测场景不烧钱**：`--instance_ids` 参数允许对单 instance 跑，不需要拉全量 133 张镜像。
4. **降级路径明确**：若某 instance 无 arm64 镜像，可加 `--platform linux/amd64` 回退到 Rosetta 仿真（约 1.5x 退化，可接受），或在 CI 环境换 x86_64 机器跑。
5. **方案 B 作为回退保险**：若官方 harness 在 arm64 上有系统性 crash（segfault/镜像缺失率高），再切到自建方案。

**不推荐纯方案 B**（作为主路径）的核心原因：pip install 依赖树的冷启动时间（5-20 分钟/实例）使设施自测体验极差，且依赖版本漂移使 oracle 语义不可信。

---

## 3. 依赖库评估

### 3.1 评估矩阵

| 库名 | 用途 | 最新稳定版（2026-06 知识） | 许可证 | 维护状态 | 评级 |
|------|------|--------------------------|--------|---------|------|
| `swebench` (pip) | 官方 harness，run_evaluation API | ~2.1.x（活跃维护，2024-2025 多次发版） | MIT | 活跃，Princeton NLP + Epoch AI 共同维护 | 推荐 |
| `pytest` | 测试执行（容器内使用） | 8.x | MIT | 非常活跃 | 必需（容器内） |
| `pytest-json-report` | 容器内 JSON 格式结果（方案 B 备选） | 1.5.x | MIT | 维护中，活跃度一般 | 备选 |
| `uv` (astral-sh) | Python 环境管理（方案 B） | 0.4.x+ | MIT/Apache-2.0 | 极活跃，2024-2025 快速迭代 | 方案 B 核心 |
| `junit-xml` (Python) | 解析 junit xml 结果（方案 B） | 1.9 | Simplified BSD | 轻度维护 | 方案 B 备选 |

### 3.2 `swebench` 包关键信息

- PyPI 地址：`swebench`
- 安装：`pip install swebench`
- 核心 API：`swebench.harness.run_evaluation`（CLI entrypoint）
- 许可证：MIT，与本项目（设施代码）完全兼容
- [推断] 周下载量在 SWE-Bench 评测热度下应有数千到万级，但非超高流量包
- 关键依赖：`docker` (Python SDK)、`datasets` (HuggingFace)、`rich`；本项目已有 docker CLI，但 Python docker SDK 是新增依赖

### 3.3 与现有项目依赖的兼容性

| 现有依赖/约束 | 兼容性 | 说明 |
|--------------|--------|------|
| Node.js / TypeScript runner | 需要 Python subprocess 桥接 | harness 是 Python 模块，需 `child_process.spawn` 调用 |
| docker v29.2.1（已验证可用） | 完全兼容 | harness 通过 Docker SDK 调用 Docker daemon，与 docker CLI 版本无关 |
| Python 3.14.3（host） | 兼容 | `swebench` 支持 Python 3.9+；3.14 属于极新版本，[推断] 可能有小概率包依赖兼容问题，建议在 venv 内隔离运行 |
| conda 不可用 | 无影响 | harness 在 docker 容器内运行，容器内 Python 版本独立 |
| 现有 `<SPECTRA_REPO_ROOT>` 占位符替换逻辑 | 需适配 | patch 内容作为字符串传入 `model_patch`，占位符替换在 TS 侧组装 JSONL 时完成 |

---

## 4. 设计模式推荐

### 4.1 三分类 Oracle 信号分离（Strategy Pattern）

oracle runner 分三个明确信号层，用 Strategy 模式封装：

```
OracleRunner
  ├── EnvironmentFaultDetector（检测环境故障）
  │     ├── exit code 125 (docker 不可用)
  │     ├── exit code 126/127 (命令不存在)
  │     ├── exit code 139 (segfault/QEMU crash)
  │     ├── timedOut flag
  │     └── stderr 含特征字符串（"ImagePullError", "No such file", OOM）
  ├── TestResultParser（解析测试结果）
  │     └── 读 report.json resolved 字段（方案 A）或 junit-xml（方案 B）
  └── OracleVerdict（最终三分类）
        ├── ENVIRONMENT_FAULT（环境故障，不可信）
        ├── TEST_FAILED（环境正常，测试真实失败）
        └── TEST_PASSED（全部 failToPass 通过 + passToPass 无回归）
```

### 4.2 Adapter Pattern（harness 调用适配）

harness 是 Python CLI 进程，TS runner 通过 Adapter 封装：

```typescript
interface OracleAdapter {
  runInstance(instanceId: string, patch: string): Promise<OracleResult>
}

class SwebenchHarnessAdapter implements OracleAdapter { ... }
class CustomDockerAdapter implements OracleAdapter { ... }  // 方案 B 回退
```

这样方案 A/B 可在运行时切换，不影响上层 oracle 接口。

### 4.3 Timeout + Watchdog

官方 harness 默认 timeout 1800 秒，对设施自测来说过长。推荐：

- 设施自测 timeout：`300` 秒（5 分钟），覆盖绝大多数 pytest 场景
- 全量跑批（F188）：`900` 秒（15 分钟），给 sympy 等慢测留余量
- 外层 watchdog：TS 侧 `setTimeout` 独立计时，确保 harness 进程异常时不卡住

---

## 5. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | **arm64 镜像缺失（头号风险）**：Epoch AI arm64 镜像覆盖 79.3%，10 个 fixture 中可能有 1-2 个无 arm64 镜像 | 中 | 高 | 提前 `docker manifest inspect` 逐一探测；无 arm64 时加 `--platform linux/amd64` 走 Rosetta 仿真（1.5x 退化可接受），或在 `sweb.eval.x86_64.*` 镜像下用 Rosetta |
| 2 | **QEMU segfault（exit 139）**：x86_64 镜像在 QEMU 仿真下 Python C 扩展（如 numpy、scipy）触发 segfault | 低-中 | 高 | 优先用 Rosetta 而非 QEMU（Docker Desktop 设置 "Use Rosetta for x86/amd64 emulation"）；检测 exit 139 归类为 ENVIRONMENT_FAULT 并重试 1 次 |
| 3 | **传递依赖版本漂移（arm64 vs x86_64）**：Pygments 等包在 arm64 下解析到不同版本，passToPass 测试失败 | 低 | 中 | 使用 arm64 原生镜像（Epoch AI 已在镜像内 pin 依赖）；若用 x86_64 镜像则无此问题 |
| 4 | **parse_log 正则脆弱性**：官方 harness 用行首匹配解析 pytest 输出，非标准 test output（含 print 语句、Unicode）可能导致 test 被漏计 | 中 | 中 | 设施自测的 10 个 fixture 均为标准 pytest 格式，风险低；全量跑批（F188）需监控 `completed=True, resolved=False` 与预期不符的 case |
| 5 | **swebench pip 包与 Python 3.14 兼容性**：3.14 是极新版本，swebench 的某些依赖（如 `datasets`）可能未适配 | 低-中 | 中 | 在 venv 中运行 `pip install swebench`，用 Python 3.11 或 3.12 venv（uv 可管理），host Python 版本不影响容器内执行 |
| 6 | **镜像首次 pull 磁盘占用**：10 个 fixture 对应 ~10 张镜像，估算 600MB–3GB | 低 | 低 | 设施自测按需 pull，CI 环境预缓存；`--cache_level none` 可控制镜像留存 |
| 7 | **timeout 区分不可靠**：timedOut 依赖 harness 内部 `EvaluationError`，TS 侧无法直接读到这个字段 | 中 | 中 | harness 写入 log 文件含 "Test timed out after" 字符串；TS 侧解析 log 文件提取 timedOut 信号，或用外层 watchdog 独立判断 |
| 8 | **单 instance 耗时高于预期**：QEMU 下 551 秒/11 实例 ≈ 50 秒/实例，但 sympy 数学密集测试可能远超此值 | 低 | 低（自测场景） | 设施自测 timeout 设 300 秒；全量 F188 在 x86_64 CI 上跑，回避 arm64 QEMU 问题 |

---

## 6. 三分类信号映射表

这是 F187 的核心实现约定：

| docker/harness 退出状态 | 具体信号 | Oracle 分类 | 说明 |
|------------------------|---------|------------|------|
| exit 0 + `resolved=true` | harness 正常完成，所有 failToPass 通过 | `TEST_PASSED` | 真实通过 |
| exit 0 + `resolved=false` + `completed=true` | harness 正常完成，测试真实失败 | `TEST_FAILED` | 真实失败 |
| exit 0 + `completed=false` | harness 异常退出但不报错（极少见） | `ENVIRONMENT_FAULT` | 需重查 log |
| exit 1 + log 含 "EvaluationError" / "Test timed out" | harness 判定超时 | `ENVIRONMENT_FAULT (timedOut)` | 重跑或放弃 |
| exit 1 + log 含 "BuildImageError" | 镜像构建失败 | `ENVIRONMENT_FAULT` | 镜像问题 |
| exit 125 | docker daemon 不可用 | `ENVIRONMENT_FAULT` | 基础设施问题 |
| exit 126 / 127 | 命令未找到 | `ENVIRONMENT_FAULT` | PATH/安装问题 |
| exit 139 | segfault（QEMU crash） | `ENVIRONMENT_FAULT` | arm64/QEMU 问题，重试 |
| watchdog timeout（TS 侧） | 超出 TS 外层 timeout | `ENVIRONMENT_FAULT (timedOut)` | 总保险 |
| stderr 含 "OOM" / "Killed" | 内存不足 | `ENVIRONMENT_FAULT` | 增加内存或减少并发 |
| pytest exit 5（no tests collected） | pytest 未收集到任何测试 | `ENVIRONMENT_FAULT` | testPatch/节点 ID 有误 |

**pytest exit codes 速查**（容器内 pytest 进程退出码，被 harness 包装）：

| pytest exit | 含义 |
|------------|------|
| 0 | 所有测试通过 |
| 1 | 有测试失败（正常失败，非环境故障） |
| 2 | 被用户中断 |
| 3 | pytest 内部错误 |
| 4 | 命令行参数错误 |
| 5 | 未收集到测试（node ID 错误或 testPatch 未应用）|

注：harness 将 pytest exit code 封装在 report.json 内部，外层 TS runner 只能看到 `python -m swebench.harness.run_evaluation` 的进程退出码，需从 log 文件反推 pytest 退出状态。

---

## 7. 次要问题解答

### 7.1 failToPass/passToPass pytest node id 如何构成 pytest 调用

官方 harness 将 failToPass + passToPass 列表合并为一次 pytest 调用，格式：

```bash
pytest testing/test_assertrewrite.py::TestIssue11140::test_constant_not_picked_as_module_docstring \
       testing/test_assertrewrite.py::TestAssertionRewrite::test_place_initial_imports \
       ... \
       --tb=short --no-header -rN
```

结果解析：harness 的 `parse_log_pytest` 函数按行遍历 pytest 输出，识别行首 `PASSED`/`FAILED`/`ERROR` 关键字（不依赖 junit-xml）。然后 `get_eval_report` 对照 failToPass/passToPass 列表判定：
- 所有 failToPass test 状态为 PASSED，且所有 passToPass test 状态不为 FAILED → `resolved=True`

**稳健性注意**：node ID 含空格时（如 fixture `test_get_assertion_exprs[trivial]`）需保持原始字符串，不要 shell-escape 过度。官方 harness 内部已处理，自建方案需注意。

### 7.2 超时推荐值

| 场景 | 推荐 timeout | 理由 |
|------|-------------|------|
| 设施自测（10 个 fixture，arm64 native）| 120–300 秒 | pytest 跑 100+ 测试约 30-90 秒，留 2-3x 余量 |
| 设施自测（x86_64 + Rosetta） | 300–600 秒 | 1.5x 退化，加余量 |
| 全量 F188 跑批（133 实例，x86_64 CI） | 900 秒（官方默认 1800s 的一半） | 官方 harness 实测 ~8 秒/实例（32 核），单核约 64 秒，900 秒绰绰有余 |
| 外层 TS watchdog | timeout + 60 秒 | 多留 60 秒给 harness 清理工作 |

---

## 8. 需求-技术对齐度评估

### 8.1 覆盖评估

| 需求功能 | 技术方案覆盖 | 说明 |
|---------|------------|------|
| apply patch + testPatch 到 base_commit | 完全覆盖 | 官方 harness 内置 patch apply 逻辑；model_patch 字段直接传入 |
| 执行 failToPass / passToPass 测试 | 完全覆盖 | harness 从 HuggingFace dataset 读取 failToPass/passToPass 列表（需 instance_id 对应） |
| 返回结构化 {passed, exitCode, timedOut} | 部分覆盖 | harness 输出 resolved/completed，需解析 log 补充 timedOut；exitCode 需从进程退出码+log 推断 |
| 区分"测试失败"vs"环境故障" | 覆盖（三分类表已设计） | 需在 TS runner 层实现三分类逻辑 |
| 设施自测不烧钱（最小 fixture） | 完全覆盖 | --instance_ids 支持单 instance 执行 |
| arm64 macOS 可运行 | 部分覆盖（需验证） | arm64 原生镜像 best-effort，需 docker manifest inspect 确认 10 个 fixture 的覆盖情况 |

### 8.2 扩展性

- F188 全量跑批：方案 A 完全支持，`--max_workers N` 并发执行
- 非 SWE-Bench 类型 oracle：方案 A 紧耦合 SWE-Bench 语义；若未来需支持其他 benchmark，用 Adapter Pattern 切换方案 B

### 8.3 Constitution 约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| TypeScript 5.x + Node.js 20.x+ 项目 | 兼容 | harness 通过 TS `child_process.spawn` 调用，不破坏 TS 主体 |
| conda 不可用 | 兼容 | harness 在 docker 内执行，host 不需要 conda |
| arm64 macOS | 需验证 | 见 5-技术风险清单 #1 |
| 设施自测不跑全量评测 | 完全兼容 | --instance_ids 单 instance 模式 |

---

## 9. 结论与建议

### 总结

arm64 macOS 上运行 SWE-Bench FAIL_TO_PASS oracle 的推荐路径：

**主路径**：使用 `swebench` pip 包 + Epoch AI arm64 原生镜像（`ghcr.io/epoch-research/swe-bench.eval.arm64.*`）。判定语义与官方完全对齐，arm64 原生无 QEMU 退化，对 10 个 fixture 覆盖率预期足够（需 docker manifest inspect 确认）。

**回退路径**：特定 instance 无 arm64 镜像时，`--platform linux/amd64` + Rosetta 2 运行 x86_64 镜像（约 1.2-1.5x 退化），避免 QEMU（~6x 退化）。

**F187 实现重点**：
1. TS runner 封装 `swebench.harness.run_evaluation` subprocess 调用，解析 report.json + log 文件
2. 三分类信号映射表（见第 6 节）是 oracle 正确性的关键，需 unit test 覆盖每个分类
3. 外层 watchdog 独立于 harness timeout，防止 harness hang

### 对后续技术规划的建议

- **plan 阶段**：先写 `docker manifest inspect ghcr.io/epoch-research/swe-bench.eval.arm64.<instance_id>` 验证脚本，确认 10 个 fixture 的 arm64 镜像存在率，再定主路径
- **tasks 阶段**：将三分类信号映射表作为独立测试用例清单，每个分类至少一个 unit test
- **F188 跑批提前规划**：在 x86_64 CI 机器（如 GitHub Actions）跑全量，回避 arm64 arm 镜像缺失和仿真性能问题

---

*[独立模式] 本次技术调研未参考产品调研结论，基于需求描述直接执行。*
