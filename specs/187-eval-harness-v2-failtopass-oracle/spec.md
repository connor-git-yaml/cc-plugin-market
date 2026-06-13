---
feature_id: 187
name: 评测设施 v2 — FAIL_TO_PASS Oracle
status: draft
created: 2026-06-13
branch: claude/nostalgic-curie-ab8ca4
---

# Feature 187 功能需求规范：评测设施 v2 — FAIL_TO_PASS Oracle

## 背景与动机

M7（F176）评测暴露了当前评分设施的结构性问题：fuzzy-match oracle 对"修复带测试"存在单向惩罚（已翻案，五组完成率打平 27–37%）；更深层的问题是 oracle 三分类机制失效——环境故障（镜像拉取失败、QEMU segfault、超时等）被全部计入 fail 分母，污染了排名信号。

本 feature 是 M8 的设施代码层：将 oracle 从 fuzzy-match 换成真实 FAIL_TO_PASS 测试执行，修通三分类（pass / fail / error），补齐 patch 持久化和 cohort 注册表，并加固预注册 freezeBlock，为 F188（133 份答卷离线重判 + 触发率复测）提供可信判分基础。

**本 feature 不跑烧钱评测。** 真实全量跑批属于 F188；本 feature 自测用 **1 个真实 smoke fixture（SWE-L003）验证 oracle 执行通路 + 全量 mock 分类矩阵验证三分类逻辑**（见 SC-002 / SC-010）。

---

## Oracle 结果统一合同

### 结果结构

oracle 执行完成后，runner 必须返回符合以下合同的结构化对象（字段名为英文 key，内容由 runner 填写）：

```
OracleResult {
  cmd:            string          // 实际执行的命令字符串（含参数）
  passed:         boolean         // 最终判定是否通过（等价 classification === 'pass'）
  exitCode:       number | null   // harness 进程退出码；进程被信号杀死或 watchdog kill 时为 null
  signal:         string | null   // 进程终止信号（如 'SIGKILL' / 'SIGSEGV' / 'SIGTERM'），无则 null
  timedOut:       boolean         // 外层 TS watchdog 触发的超时
  classification: OracleClass     // 三分类枚举 pass | fail | error
  failureSource:  FailureSource   // 失败归因：'none' | 'infra' | 'candidate' | 'fixture'
  phaseReached:   OraclePhase     // 失败时已到达的阶段（决定 candidate vs infra 归因）
  stdoutTail:     string          // stdout 末尾不超过 2000 字符（调试用）
  stderrTail:     string          // stderr 末尾不超过 2000 字符
  details:        OracleDetails   // 结构化详情，禁止整体 stringify 截断
}
```

- **OracleClass** = `pass | fail | error`
- **FailureSource** = `none`（pass 时）`| infra`（基础设施层故障，结果不可信，剔除分母）`| candidate`（候选 patch 导致的失败，计入 fail）`| fixture`（fixture 数据/配置错误，剔除分母并告警）
- **OraclePhase**（执行阶段，自前向后）= `image`（镜像拉取/构建）`→ container_start`（容器启动）`→ patch_apply`（候选 patch + testPatch 应用）`→ test_exec`（pytest 执行中）`→ report_parse`（解析 report/log）`→ done`

### 三分类穷尽式决策表（按优先级从上到下，首个命中即判定）

> 设计原则（用户裁决 Q1 = 分阶段判定）：**测试开跑（`test_exec`）之前的失败归 `infra`/`fixture` → `error`，剔除分母；测试开跑之后的失败默认归 `candidate` → `fail`，计入分母。** 唯一例外是 arm64 仿真伪影（segfault），归 `infra` 并重试一次。未匹配的未知组合按"出现在测试执行前→error / 测试执行后→fail"的 fallback 兜底，绝不静默吞掉。

| 优先级 | 条件（信号组合） | phaseReached | classification | failureSource | 说明 |
|----|------|------|------|------|------|
| 1 | exitCode=125 | image / container_start | `error` | infra | docker daemon 不可用 |
| 2 | exitCode=126 / 127 | container_start | `error` | infra | 命令/可执行未找到 |
| 3 | log 含 `BuildImageError` / `ImagePullError` | image | `error` | infra | 镜像层失败（含 arm64 镜像缺失且 fallback 也失败） |
| 4 | exitCode=139 或 signal=`SIGSEGV` | 任意 | `error` | infra | segfault（QEMU/arm64 伪影）→ **重试一次**；重试后仍 SIGSEGV 才终判 error |
| 5 | log 含 patch apply 失败标志（`patch does not apply` / `git apply` 非零且发生在 test_exec 前） | patch_apply | `error` | fixture | 候选/test patch 无法应用 = 数据/前置问题，非候选代码逻辑失败（注：candidate patch 自身格式坏属 fixture/输入层，剔除分母并告警，不污染 fail） |
| 6 | pytest exit 5（未收集到测试） | test_exec | `error` | fixture | node ID / testPatch 错配，测试根本没跑 |
| 7 | `timedOut=true` 或 signal=`SIGKILL`/`SIGTERM`，且 phaseReached ∈ {image, container_start, patch_apply} | 测试开跑前 | `error` | infra | 测试还没跑就超时/被杀 = 基础设施慢（如 arm64 镜像拉取慢） |
| 8 | `timedOut=true` 或 signal=`SIGKILL`/`SIGTERM` 或 OOM（log 含 `Killed`/`OOMKilled`），且 phaseReached = test_exec | 测试执行中 | `fail` | candidate | **候选 patch 让测试卡死/爆内存 = 没修好**（用户裁决 Q1） |
| 9 | harness exit 0 + `completed=true` + `resolved=true` | done | `pass` | none | 所有 failToPass 通过且 passToPass 无回归 |
| 10 | harness exit 0 + `completed=true` + `resolved=false` | done | `fail` | candidate | 测试真实失败（含 passToPass 回归） |
| 11 | harness exit 0 + `completed=false` | report_parse | `error` | infra | harness 未正常完成（异常退出未报错） |
| 12 | pytest exit 2/3/4（中断/内部错/用法错），phaseReached=test_exec | test_exec | `error` | infra | pytest 自身异常，非候选代码 PASS/FAIL 信号 |
| 13 | report.json / log 文件缺失 | 任意 | `error` | infra | 无法判定，降级（见 E-10） |
| 14 | **fallback（未匹配任何上行）** | — | phaseReached ≥ test_exec → `fail`(candidate)；否则 `error`(infra) | — | 未知组合兜底，必须 log 原始 exitCode/signal/phase 供事后排查 |

> 关键不变量：
> - `pass` 必须同时满足 exit 0 + `completed=true` + `resolved=true`（不允许仅凭 exit 0 判 pass）。
> - 分类**不依赖 details 字段内的 exitCode**（修正现有 classifyOracle 依赖 details 携带 exitCode 的结构性缺陷）；判定输入是 harness 进程的 exitCode/signal + log 文件解析 + phaseReached。
> - `phaseReached` 由 runner 在执行各阶段时实时打点（不是事后从 log 猜），是 candidate vs infra 归因的事实源。

### 环境故障的分母规则

- `classification='error'`（无论 failureSource 是 infra 还是 fixture）的实例**不计入 fail 分母**；完成率分母 = 总实例数 − error 实例数。
- `classification='fail'`（failureSource='candidate'）**计入 fail 分母**。
- `failureSource='fixture'` 的 error 额外触发告警（说明 fixture 本身有问题，需人工修，不是工具的锅也不是环境抖动）。

### details 结构化持久化约定

- `details` 字段必须是结构化 JSON 对象，不得整体 `JSON.stringify(...).slice(0, N)` 截断。
- 各 oracle kind 的 details 结构独立定义，`swebench-execution` kind 的 details 至少包含：
  ```
  {
    instanceId:        string       // SWE-Bench instance_id
    candidatePatchSha: string       // 实际提交给 harness 的候选 patch 的 sha256（防 goldPatch 误用，见 FR-001-e）
    resolved:          boolean|null // harness report.json resolved 字段
    completed:         boolean|null // harness report.json completed 字段
    failToPassExecuted: string[]    // report/log 中实际执行到的 failToPass test ids（用于校验 W1 不变量）
    passToPassExecuted: string[]    // 实际执行到的 passToPass test ids
    failToPassCount:   number       // failToPass 列表长度
    passToPassCount:   number       // passToPass 列表长度
    pytestExitCode:    number|null  // 从 log 反解的容器内 pytest 退出码
    archFallback:      string|null  // 'rosetta' | null，arm64 镜像缺失时回退标记
    retried:           boolean      // 是否因 segfault 触发过重试
    logPath:           string       // harness log 文件落盘路径
  }
  ```

---

## User Stories

### User Story 1 — oracle 换真实 FAIL_TO_PASS 测试执行（Priority: P1）

评测工程师给定一个 SWE-Bench fixture（含 `swebenchMeta.failToPass`、`passToPass`、`goldPatch`、`testPatch`）**和一个被评测工具产出的候选 patch**，希望通过 oracle runner 实际执行测试（而非 fuzzy-match 字符串比对），得到可信的通过/失败判定，且判定语义与 SWE-Bench 官方完全对齐。

**为什么是 P1**：这是本 feature 的核心目标——oracle 替换是 F188 可信判分的前提；如果 oracle 仍是 fuzzy-match，其余所有改进都失去意义。

**独立可测**：单独对 SWE-L003 fixture + 一个候选 patch 调用新 oracle runner，可验证是否触发 docker harness 执行并返回结构化结果。

**验收场景**：

1. **Given** fixture `SWE-L003`（`pytest-dev__pytest-11143`）+ 候选 patch 字符串，**When** runner 以 kind=`swebench-execution` 调用 oracle，**Then** runner 向 SWE-Bench 官方 docker harness 提交 predictions JSONL，其中 `model_patch` 等于**候选 patch**（而非 goldPatch），并返回符合统一合同的 `OracleResult`。
2. **Given** 候选 patch 恰好等于 goldPatch（正控场景），**When** runner 执行 oracle，**Then** `classification='pass'`、`resolved=true`。
3. **Given** 候选 patch 为空字符串（模拟未修复），**When** runner 执行 oracle，**Then** `classification='fail'`、`failureSource='candidate'`、`passed=false`、exitCode 为 0（harness 正常完成）。
4. **Given** oracle 执行结果，**When** 读取 `details.resolved`，**Then** 值与 `passed` 字段一致（不矛盾）。
5. **Given** runner 生成的 predictions JSONL，**When** 校验其 `model_patch`，**Then** `details.candidatePatchSha` 等于候选 patch 的 sha256，且**不等于** goldPatch 的 sha256（除非候选恰好就是 goldPatch 的正控场景）。

---

### User Story 2 — 三分类正确区分环境故障 vs 候选失败（Priority: P1）

评测工程师希望：基础设施层故障（镜像缺失、docker 挂、arm64 segfault、镜像拉取慢超时）归 `error` 剔除分母；而候选 patch 自身导致的失败（测试真实 FAILED、测试卡死、爆内存）归 `fail` 计入分母——既不让环境抖动污染排名，也不让烂 patch 借"环境故障"免责。

**为什么是 P1**：与 Story 1 并列核心——修通三分类是修复 M7 评分失真的必要条件，且"分阶段归因"（用户裁决 Q1）是评分公正性的关键。

**独立可测**：通过 unit test mock harness 返回特定 exitCode / signal / phaseReached / log 字符串，驱动决策表全部 14 行，验证 classifyOracle 输出正确分类 + failureSource。

**验收场景**（覆盖决策表关键行）：

1. **Given** exitCode=125（docker 挂），**Then** `classification='error'`、`failureSource='infra'`，不计入 fail 分母。
2. **Given** exitCode=139 / SIGSEGV，**Then** 触发一次重试；重试仍 SIGSEGV → `classification='error'`、`failureSource='infra'`、`details.retried=true`。
3. **Given** `phaseReached='image'` 且 timedOut（镜像拉取慢），**Then** `classification='error'`、`failureSource='infra'`。
4. **Given** `phaseReached='test_exec'` 且 timedOut（候选 patch 让测试死循环），**Then** `classification='fail'`、`failureSource='candidate'`，计入 fail 分母。
5. **Given** `phaseReached='test_exec'` 且 log 含 `OOMKilled`（候选 patch 爆内存），**Then** `classification='fail'`、`failureSource='candidate'`。
6. **Given** pytest exit 5（未收集到测试），**Then** `classification='error'`、`failureSource='fixture'`，触发 fixture 告警。
7. **Given** harness exit 0 + completed=true + resolved=false（含 passToPass 回归），**Then** `classification='fail'`、`failureSource='candidate'`。
8. **Given** harness exit 0 + completed=false，**Then** `classification='error'`、`failureSource='infra'`。
9. **Given** harness exit 0 + completed=true + resolved=true，**Then** `classification='pass'`。
10. **Given** 一个决策表未显式列出的未知组合（如 exitCode=1 无任何匹配 log，phaseReached='test_exec'），**Then** fallback 判 `fail`(candidate) 并 log 原始信号；若 phaseReached 在 test_exec 之前则判 `error`(infra)。

---

### User Story 3 — patch 持久化并供 jury 读取（Priority: P2）

评测工程师在 PASS 判定完成后、worktree cleanup 执行前，希望 runner 自动将候选 patch diff 和执行日志持久化到 fixture 同级目录，使 jury 评分时能读取真实 diff 而非依赖截断的 diffStat。

**为什么是 P2**：直接影响 jury 评分质量（证据对称性），但 oracle 三分类正确性优先级更高；patch 持久化是 jury 可信度的增量改进。

**独立可测**：执行一次带 cleanup 的 run，验证 `patch.diff` / `stdout.log` / `stderr.log` 已落盘且与现场字节级一致，且 jury extractDiff 优先读取持久化文件。

**验收场景**：

1. **Given** 一次 PASS 判定的 run（cleanup 策略为 `on-success`），**When** cleanup 销毁 worktree 前，**Then** `patch.diff`、`stdout.log`、`stderr.log` 三个文件已**原子写入**（temp file + rename）到 `<run_artifacts_dir>/<run_id>/`，且 `patch.diff` 内容与 cleanup 前 worktree 的 `git diff` 字节级一致。
2. **Given** patch 持久化文件存在，**When** jury 的 `extractDiff` 被调用，**Then** 优先读取持久化的 `patch.diff`，而非回退到 `fixture.taskExecution.diffStat`。
3. **Given** 持久化写入过程中发生 fs 错误（注入），**When** run 收尾，**Then** cleanup **不执行**、worktree 原地保留（保住现场），并记录错误。
4. **Given** FAIL / ERROR 判定的 run（不触发 on-success cleanup），**When** run 结束，**Then** stdout.log / stderr.log 同样落盘（不只 PASS 才持久化日志）；patch.diff 因 worktree 现场保留可由 jury 直接从 worktree 读取，不强制额外落盘。

---

### User Story 4 — cohort registry 单一来源，漏接 cohort 抛错（Priority: P2）

评测工程师新增一个 cohort 时，只需在单一注册表（`cohort-registry.mjs` 或等价文件）中声明 `{id, tool, promptBuilder, claudeArgsProfile, prepSteps, stdinPolicy}`，不再需要分散修改 6 处文件；如果漏接了 `promptBuilder`，系统应抛出明确错误而非静默跑成对照组。

**为什么是 P2**：消除当前 6 处散布的维护痛点，防止"静默错误配置"，但不阻塞 oracle 核心功能。

**独立可测**：在 registry 中注册一个不含 `promptBuilder` 的 cohort，调用 `buildDriverPrompt` 时应 throw。

**验收场景**：

1. **Given** 单一 cohort registry 文件，**When** 新增 cohort 只修改该文件，**Then** `COHORT_IDS`、`COHORT_TO_TOOL`、runner 固定参数、aggregate 统计均自动从 registry 派生，无需手动同步其他 6 处。
2. **Given** registry 中某 cohort 未声明 `promptBuilder`，**When** `buildDriverPrompt` 被调用，**Then** 抛出包含 cohort id 的明确错误（而非 default 裸回退静默执行）。
3. **Given** 正确声明了所有字段的 cohort，**When** `buildDriverPrompt` 被调用，**Then** 返回正确的 prompt 字符串。
4. **Given** 竞品 cohort（graphify/aider/superpowers/gstack）在 registry 中的声明，**When** 重构前后对比，**Then** 其 promptBuilder / claudeArgsProfile / 统计口径**逐字不变**（回归护栏，见 SC-013）。

---

### User Story 5 — 预注册 freezeBlock 冻结 oracle 语义（Priority: P2）

评测工程师在跑批前冻结 oracle **语义**（不只是配置参数），若跑批期间有人通过 `fix-fixture-oracle.mjs` 动态替换 oracle、或改动 classifyOracle 分类逻辑代码、或换 harness 版本，系统应在校验时检测到 `oracleSpecHash` 不匹配并拦截。

**为什么是 P2**：加固评测可信度的护栏，堵住需求点名的"跑前换判分"漏洞。

**威胁模型（用户裁决 Q2 = 冻结 oracle 语义）**：防的是"诚实但马虎的团队"——防误改、防随手换判分标准、防忘了同步。**不防**能任意改仓库的恶意攻击者（理论上无法防：攻击者可同时改 checker、改 hash 算法、改 freezeBlock 自身重写一切）。spec 把门槛抬到"任何对判分语义的改动都会被默认流程拦下"，并要求 clean worktree + 记录 git commit 作为外锚。

**独立可测**：修改 classifyOracle 源码或 oracle 配置后重算 `oracleSpecHash`，与预注册记录中的 hash 对比，应不匹配并抛出校验错误。

**验收场景**：

1. **Given** 预注册文件含 `schemaVersion` + `oracleSpecHash` + `fixtureContentHash` + `promptSha256` + `gitCommit`，**When** 跑批时 oracle 语义未变且 worktree clean，**Then** hash 校验通过，跑批正常进行。
2. **Given** 预注册 `oracleSpecHash=H`，**When** 跑批前通过 `fix-fixture-oracle.mjs` 改了 oracle 配置（重算得 H'≠H），**Then** 校验拦截，输出含 oracleSpecHash 期望/实际前缀的错误。
3. **Given** 预注册 `oracleSpecHash=H`，**When** 有人**改动 classifyOracle 分类逻辑源码**（H 的输入含该源码摘要），**Then** 重算 hash ≠ H，校验拦截（这是 Q2 决策的核心：语义代码变更也被冻结）。
4. **Given** 预注册 `fixtureContentHash`，**When** fixture 文件内容在冻结后被修改（即便同步改了 freezeBlock 内的 hash），**Then** 校验对比当前 git commit 下 fixture 的 canonical hash 与 freezeBlock 记录，二者不一致即拦截，或要求新实验 ID。
5. **Given** worktree 非 clean（有未提交改动），**When** 跑批启动校验，**Then** 警告或拦截（freezeBlock 的 gitCommit 外锚无意义）。

---

### User Story 6 — batch 编排器参数化，去掉硬编码（Priority: P3）

评测工程师在发起 batch 跑时，希望通过 experiment manifest（YAML/JSON 配置文件）声明 model、output-format、cleanup 策略、repeat 数、skipJury、配额检查倍数等参数，而非修改 `cohort-batch.mjs` 源码中的 ~6 处硬编码。

**为什么是 P3**：改善可操作性，但不影响 oracle 正确性；oracle 核心功能 P1/P2 完成后再处理。

**独立可测**：通过 manifest 文件调整 repeat 数和 model，验证 batch 编排器读取 manifest 参数而非硬编码值。

**验收场景**：

1. **Given** experiment manifest 声明 `repeat: 5`，**When** 编排器启动，**Then** 每个 task 跑 5 次，不需修改源码。
2. **Given** manifest 声明 `skipJury: true`，**When** batch 完成，**Then** jury 评分步骤被跳过。
3. **Given** manifest 声明 `cleanup: never`，**When** run 完成，**Then** worktree 不销毁（不论 pass/fail）。
4. **Given** manifest 未提供某字段，**When** 编排器启动，**Then** 保留现有默认值（向后兼容），不 break 已有跑批脚本。

---

## 边界场景（Edge Cases）

以下边界场景必须在 unit test 或集成测试中覆盖：

| # | 场景 | 预期行为 | 关联 FR |
|---|------|----------|---------|
| E-01 | **arm64 镜像缺失**：`docker manifest inspect` 发现某 instance 无 arm64 原生镜像 | 自动加 `--platform linux/amd64` 回退 Rosetta 仿真，`details.archFallback='rosetta'`；若 fallback 镜像也缺失 → `error/infra`（决策表行 3） | FR-001-b |
| E-02 | **QEMU segfault（exit 139 / SIGSEGV）** | classifyOracle 判 `error/infra`，触发一次自动重试；重试仍 segfault 标 `details.retried=true` 终判 `error`（决策表行 4） | FR-002 |
| E-03 | **测试执行前 watchdog 超时**（phaseReached < test_exec） | kill harness，`timedOut=true`，`error/infra`（决策表行 7） | FR-002 |
| E-03b | **测试执行中 watchdog 超时**（候选 patch 死循环，phaseReached=test_exec） | kill harness，`timedOut=true`，`fail/candidate`（决策表行 8，用户裁决 Q1） | FR-002 |
| E-04 | **pytest exit 5（未收集到测试）**：testPatch 未应用或 node ID 有误 | 解析 log 中 pytest exit code，`error/fixture`，`details.pytestExitCode=5`，触发 fixture 告警（决策表行 6） | FR-002 |
| E-05 | **docker 不可用（exit 125）** | `error/infra`，stdoutTail/stderrTail 携带完整错误信息 | FR-002 |
| E-06 | **passToPass 回归**：goldPatch/候选 patch 修了 failToPass 但破坏了 passToPass | harness `resolved=false`，`fail/candidate`，details 记录 passToPass 回归（决策表行 10） | FR-001 |
| E-07 | **cleanup 与 patch 持久化先后顺序 + 写盘失败** | 先 atomic 持久化再 cleanup；持久化失败则 cleanup 不执行、保留现场（FR-003 + 注入测试 SC-012） | FR-003 |
| E-08 | **漏接 cohort promptBuilder** | `buildDriverPrompt` 运行时 throw，错误含未注册 cohort id | FR-004 |
| E-09 | **跑前换 oracle / 改分类逻辑**：预注册后改 oracle 配置或 classifyOracle 源码 | 校验检测 oracleSpecHash 不匹配，拦截（决策见 US5 场景 2/3） | FR-005 |
| E-09b | **改 fixture + 同步改 freezeBlock 内 hash** | 校验对比当前 git commit 下 fixture canonical hash 与记录，不一致拦截或要求新实验 ID | FR-005 |
| E-10 | **harness log/report 文件缺失** | classifyOracle 降级：无法判定时归 `error`，不抛未捕获异常（决策表行 13） | FR-002 |
| E-11 | **details 字段过大**：passToPass 有 500 条 | details 结构化存储不截断；只裁剪 `stdoutTail`/`stderrTail` 文本字段，不裁剪 details 对象 | FR-002 |
| E-12 | **候选 patch 误用 goldPatch**：实现把 goldPatch 当 model_patch 提交 | `details.candidatePatchSha` 暴露与 goldPatch 一致（非正控场景视为缺陷）；SC-011 断言候选 patch 来源 | FR-001-e |
| E-13 | **执行 test 集与冻结集不符**：harness 实际跑的 test ids 与 fixture.swebenchMeta 不一致 | `details.failToPassExecuted/passToPassExecuted` 与 swebenchMeta 比对，不一致告警/拦截（W1 不变量，SC-014） | FR-001-f |

---

## 功能需求（Functional Requirements）

> RFC 关键词约定：`MUST`=必须、`SHOULD`=建议、`MAY`=可选。每条 FR 的中文强制等级与 RFC 关键词一致。

### FR-001 oracle 种类扩展：swebench-execution（MUST）

**FR-001** `MUST`：runner 的 oracle dispatch 逻辑必须支持新 kind=`swebench-execution`，执行路径从 fixture.swebenchMeta（`failToPass`、`passToPass`、`testPatch`、`goldPatch` 四字段）合成 harness 调用输入（predictions JSONL）；importer（`swe-bench-fixture-import.py`）零改动，存量 10 个 SWE-L fixture 直接复用。

**FR-001-a** `MUST`：`swebench-execution` runner 向 SWE-Bench 官方 docker harness（`python -m swebench.harness.run_evaluation`）提交 predictions JSONL，以 TS `child_process.spawn` 异步调用，解析 harness 输出的 report.json + log 文件，并按各执行阶段实时打点 `phaseReached`。

**FR-001-b** `MUST`：arm64 macOS 环境下优先尝试 Epoch AI arm64 原生镜像（`ghcr.io/epoch-research/swe-bench.eval.arm64.*`）；若 `docker manifest inspect` 发现无 arm64 镜像，自动加 `--platform linux/amd64` 回退 Rosetta 仿真，并在 `details.archFallback` 标注。

**FR-001-c** `MUST`：fuzzy-match（`eval-diff-fuzzy-match.mjs`）降级为 secondary 对照，保留现有代码；primary oracle 切换为 `swebench-execution`；secondary fuzzy-match 结果写入运行记录的顶层 `secondaryOracle` 字段（与 `primaryOracle` 并列，均为完整 OracleResult），两者不互相覆盖。

**FR-001-d** `MUST`：外层 TS watchdog 独立计时（TS `setTimeout`），与 harness 内部 timeout 相互独立；设施自测默认 timeout 300 秒，全量跑批（F188）默认 900 秒，两者均通过 experiment manifest 可配置。

**FR-001-e** `MUST`（候选 patch 来源合同，修 C1）：runner 输入必须显式接收一个 `candidatePatch`（被评测工具产出的 diff）；predictions JSONL 的 `model_patch` **必须等于 `candidatePatch`**。`goldPatch` **仅可**用作显式声明的正控（positive control）场景的候选输入，**不得**在常规判分路径中被当作 `model_patch`。`details.candidatePatchSha` 记录实际提交的 patch sha256 供审计。

**FR-001-f** `MUST`（执行 test 集校验，修 W1）：runner 必须从 harness report/log 提取实际执行到的 test ids（`details.failToPassExecuted` / `passToPassExecuted`），并与 fixture.swebenchMeta 的 failToPass/passToPass 比对；不一致时告警（标 `failureSource='fixture'`）。harness 的测试集数据源（本地 dataset 喂入 vs HF dataset by instance_id）由 plan 阶段确定并写入 freezeBlock（见 FR-005-c）。

---

### FR-002 oracle 结果统一合同与三分类修通（MUST）

**FR-002** `MUST`：所有 oracle kind 的执行结果必须符合统一合同（见"Oracle 结果统一合同"一节的 OracleResult 结构），details 为结构化 JSON 对象，禁止 `JSON.stringify(...).slice(0, N)` 整体截断。

**FR-002-a** `MUST`：`classifyOracle` 函数必须实现"Oracle 结果统一合同"中的**穷尽式决策表**（14 行 + fallback），分类依据为 harness 进程 exitCode/signal + log 文件特征字符串 + `phaseReached`，**不依赖 details 字段内的 exitCode**。

**FR-002-b** `MUST`：分类为 `error` 的实例不计入 fail 分母（完成率分母 = 总实例数 − error 实例数）；`failureSource='candidate'` 的 `fail` 计入分母；`failureSource='fixture'` 的 error 额外触发告警。

**FR-002-c** `MUST`（分阶段归因，用户裁决 Q1）：`test_exec` 阶段之前的超时/被杀/崩溃归 `infra` 或 `fixture`（→error）；`test_exec` 阶段中的超时/OOM/进程崩溃默认归 `candidate`（→fail）。唯一例外：exit 139 / SIGSEGV 归 `infra` 并重试一次。

**FR-002-d** `MUST`：决策表未显式匹配的未知组合，按 fallback 规则兜底（phaseReached ≥ test_exec → fail/candidate；否则 error/infra），且必须 log 原始 exitCode/signal/phaseReached，不得静默吞掉。

---

### FR-003 patch 持久化与 jury extractDiff 优先读持久化文件（MUST）

**FR-003** `MUST`：runner 在 cleanup（worktree 销毁）执行前，必须将 `patch.diff`、`stdout.log`、`stderr.log` 以**临时文件 + 原子 rename** 写入运行产物目录（`<run_artifacts_dir>/<run_id>/`）；`patch.diff` 内容必须与 cleanup 前 worktree 的 `git diff` 字节级一致。

**FR-003-a** `MUST`：jury 的 `extractDiff` 逻辑优先读取持久化的 `patch.diff` 文件；仅在文件不存在时回退到 `fixture.taskExecution.diffStat`。

**FR-003-b** `MUST`：若持久化写入失败，cleanup **不执行**，worktree 原地保留（保住现场），并记录错误。

**FR-003-c** `SHOULD`：stdout.log / stderr.log 对所有 run（含 FAIL / ERROR）均落盘；patch.diff 在 FAIL/ERROR（worktree 现场保留）时可不额外落盘，jury 从 worktree 读取。

---

### FR-004 声明式 cohort registry，漏接抛错（MUST）

**FR-004** `MUST`：将当前散布在 6 处（`cohort-batch.mjs:46-52`、`:167`、`eval-task-runner.mjs:35`、`cohort-aggregate.mjs:17`、`cohort-batch.mjs:210-221`、`:253-259`）的 cohort 配置合并为单一 registry 文件，包含每个 cohort 的 `{id, tool, promptBuilder, claudeArgsProfile, prepSteps, stdinPolicy}` 完整声明。

**FR-004-a** `MUST`：`buildDriverPrompt` 的 default 分支从"裸回退对照组"改为 `throw`，错误信息含未注册的 cohort id；现有已知 cohort 全部在 registry 中显式注册。

**FR-004-b** `MUST`：`COHORT_IDS`、`COHORT_TO_TOOL`、runner 固定参数、aggregate 统计均从 registry 自动派生，新增 cohort 只修改 registry 文件。

**FR-004-c** `MUST`（回归护栏）：竞品 cohort（graphify/aider/superpowers/gstack）迁入 registry 后，其 promptBuilder / claudeArgsProfile / 统计口径与迁移前逐字等价（由 golden 测试守护，见 SC-013）。

---

### FR-005 预注册 freezeBlock 冻结 oracle 语义（MUST）

**FR-005** `MUST`：预注册 freezeBlock 在现有 `{taskSetHash, frozen, count, seed, filterRule, gitCommit, taskIds}` 基础上，新增 `schemaVersion`、`oracleSpecHash`、`fixtureContentHash`、`promptSha256` 字段。

**FR-005-a** `MUST`：预注册校验逻辑（`preregistration-check.mjs`）在跑批前校验新增字段；任一不匹配则拦截跑批，输出明确错误（含字段名 + 期望/实际 hash 前缀）。

**FR-005-b** `MUST`（冻结 oracle 语义，用户裁决 Q2）：`oracleSpecHash` 的 canonical 输入范围为：`oracle 运行时配置（kind + timeout + 镜像策略）` + `classifyOracle 分类逻辑源码摘要` + `swebench harness 版本`，使"改判分代码 / 换 harness 版本"都触发不匹配。`fixtureContentHash` 单独覆盖 fixture 数据完整性，两者职责正交。canonical 输入需有稳定序列化（排序 key、固定换行），并随 `schemaVersion` 演进。

**FR-005-c** `MUST`：freezeBlock 记录 harness 测试集数据源标识（本地 dataset 路径 digest 或 HF dataset name+revision），使"实际跑的测试集"可被冻结校验（呼应 FR-001-f / W1）。

**FR-005-d** `MUST`：校验时核对当前 git commit 与 freezeBlock.gitCommit，并检查 worktree 是否 clean；非 clean 时警告（freezeBlock 外锚失效）。

> 威胁模型边界（写入 spec，非 over-claim）：本机制防"诚实但马虎"的误改/随手换判分，**不**声称防御能任意改写仓库的恶意攻击者。

---

### FR-006 batch 编排器 experiment manifest 参数化（SHOULD，P3）

**FR-006** `SHOULD`：`cohort-batch.mjs` 中以下 ~6 处硬编码改为从 experiment manifest（YAML 或 JSON 文件，路径通过 CLI 参数传入）读取：model（`claude-opus-4-7`）、output-format（`stream-json`）、cleanup 策略（`on-success`）、repeat 数（N=1/3）、skipJury、配额检查倍数（`6`）。

**FR-006-a** `SHOULD`：manifest 未提供某字段时，保留现有默认值（向后兼容），不 break 已有跑批脚本。

> 注：FR-006 为 P3，强制等级 SHOULD。若实现时间紧张，可在 GATE_TASKS 决定降级或拆分到后续，但本 spec 仍将其列入范围。

---

### 凭据与环境约束（强制约束）

**FR-C01** `MUST`：不得将 `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY` 写入任何启动前提、README 或脚本帮助文本中作为必选凭据；driver 走 Codex CLI 订阅（`~/.codex/auth.json`），judge 1 走 Claude Max 订阅，jury 走 SiliconFlow API key（`.env.local`）。由 SC-015 的 `rg` 检查守护。

---

## 关键实体

- **OracleResult**：oracle 执行的统一结果对象，见"Oracle 结果统一合同"一节。
- **OracleClass**：三分类枚举，值域 `{pass, fail, error}`。
- **FailureSource**：失败归因枚举，值域 `{none, infra, candidate, fixture}`。
- **OraclePhase**：执行阶段枚举，值域 `{image, container_start, patch_apply, test_exec, report_parse, done}`。
- **CohortRegistry**：声明式 cohort 注册表，单一来源。
- **FreezeBlock**：预注册快照块，扩展后含 schemaVersion / oracleSpecHash / fixtureContentHash / promptSha256 / 数据源标识。
- **ExperimentManifest**：batch 编排参数化的配置文件，覆盖原硬编码参数。
- **PatchArtifact**：持久化产物集合，含 patch.diff / stdout.log / stderr.log。

---

## 成功标准（Success Criteria）

> 标注 **[smoke]**=用真实 SWE-L003 fixture 集成测试；**[mock]**=mock harness 输出的 unit test；**[assert]**=设计断言（代码 review / 静态检查）。

| # | 标准 | 类型 | 对应 Story |
|---|------|------|-----------|
| SC-001 | 给定 SWE-L003 + 候选 patch，oracle runner 以 kind=`swebench-execution` 执行，返回符合统一合同的 OracleResult（不崩溃、details 不截断 JSON） | [smoke] | US-1 |
| SC-002 | classifyOracle **表驱动测试覆盖决策表全部 14 行 + fallback**，每行至少一个 mock 用例：exitCode 125/126/127/139、SIGSEGV/SIGKILL/SIGTERM、timedOut×(phaseReached 前/后)、OOMKilled、pytest exit 2/3/4/5、completed=false、resolved true/false、report 缺失、未知组合 fallback | [mock] | US-2 |
| SC-003 | `error` 不计入 fail 分母：给定 1 pass + 1 fail(candidate) + 1 error(infra)，完成率统计为 1/2=50%，而非 1/3 | [mock] | US-2 |
| SC-004 | `test_exec` 阶段 timedOut/OOM 归 `fail/candidate`（计入分母）；`image`/`patch_apply` 阶段 timedOut 归 `error/infra`（剔除）——分阶段归因正确（Q1） | [mock] | US-2 |
| SC-005 | PASS run 结束后，`patch.diff`/`stdout.log`/`stderr.log` 存在于 `<run_artifacts_dir>/<run_id>/`；cleanup 发生在持久化之后，worktree 已删 | [smoke] | US-3 |
| SC-006 | jury extractDiff 在 `patch.diff` 存在时读取该文件，不回退 diffStat | [mock] | US-3 |
| SC-007 | 向 registry 新增不含 `promptBuilder` 的 cohort，调用 `buildDriverPrompt` 抛出含 cohort id 的 Error（不静默执行） | [mock] | US-4 |
| SC-008 | 单一 registry 是 cohort 唯一来源：新增 cohort 后不改其他 6 处，cohort-batch.mjs 与 cohort-aggregate.mjs 均能识别 | [assert]+[mock] | US-4 |
| SC-009 | 预注册含 `oracleSpecHash`；改 oracle 配置**或 classifyOracle 源码**后重算 hash，校验检测到不匹配并输出错误（含字段名） | [mock] | US-5 |
| SC-010 | 本 feature 代码路径不触发真实烧钱评测（不调 F188 全量 133 实例 batch）；设施自测仅 SWE-L003 一个真实 instance + mock 矩阵 | [assert] | 全部 |
| SC-011 | predictions JSONL 的 `model_patch` 等于候选 patch（`details.candidatePatchSha` == 候选 sha），非正控时不等于 goldPatch sha（修 C1） | [smoke]+[mock] | US-1 |
| SC-012 | 注入 patch 持久化写盘失败，断言 cleanup 未调用 + worktree 保留；正常路径断言 patch.diff 与 cleanup 前 git diff 字节级一致（修 W3） | [mock] | US-3 |
| SC-013 | 竞品 cohort（graphify/aider/superpowers/gstack）迁入 registry 前后，promptBuilder/claudeArgsProfile/统计口径 golden 测试逐字不变（回归护栏 #1） | [mock] | US-4 |
| SC-014 | harness 实际执行的 test ids（details.failToPassExecuted/passToPassExecuted）与 fixture.swebenchMeta 一致；不一致告警（修 W1） | [smoke] | US-1 |
| SC-015 | 可执行回归护栏全绿：① `git diff --exit-code -- scripts/swe-bench-fixture-import.py`（importer 零改动）② `rg` 确认无"必选 ANTHROPIC_API_KEY/OPENAI_API_KEY"启动前提 ③ `git check-ignore` 确认 fixture/patch/auto-report 产物路径被忽略 ④ 受控文件 allowlist 校验未误改竞品评估脚本 | [assert] | 护栏 |
| SC-016 | `npx vitest run` 全量零失败、`npm run build` 零类型错误、`npm run repo:check` 零告警 | [assert] | 全部 |

---

## 非目标（Non-Goals）与回归护栏

以下内容明确不在本 feature 范围内（多数已转为 SC-015 可执行检查）：

1. **不改竞品评估方法论**：graphify/aider/superpowers/gstack 的评分口径、prompt 模板、结果统计逻辑均不触动（SC-013 golden 测试 + SC-015④ allowlist 守护）。
2. **importer 零改动**：`swe-bench-fixture-import.py` 不做任何修改（SC-015① `git diff --exit-code` 守护）；存量 10 个 SWE-L fixture 直接复用。
3. **不跑全量烧钱评测**：F188 的 133 份答卷离线重判和触发率复测不在本 feature 执行（SC-010 守护）；自测仅 SWE-L003 + mock 矩阵。
4. **fuzzy-match 不删除**：`eval-diff-fuzzy-match.mjs` 降级为 secondary 对照，保留代码与调用路径（FR-001-c）。
5. **评测产物不入库**：fixture / patch 持久化文件 / auto-report 按约定不提交 git（SC-015③ `git check-ignore` 守护）；仅 manual report + perf anchor fixture 入库。
6. **不防御恶意篡改仓库者**：freezeBlock 威胁模型限定"诚实但马虎"，不声称防御能改写 checker+hash 算法+freezeBlock 的攻击者（见 FR-005 威胁模型边界）。
7. **不实现方案 B（轻量自建执行）**：技术调研评估的自建 docker 执行路径，因依赖版本漂移导致 oracle 语义不可信，本迭代不实现；如 arm64 镜像缺失率过高，由 plan 决策是否作回退。[YAGNI]

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 值 | 说明 |
|------|----|------|
| **组件总数** | 5 | swebench-execution runner（含 phaseReached 打点）、classifyOracle（决策表版）、cohort registry、freezeBlock 语义冻结、experiment manifest loader |
| **接口数量** | 7 | OracleResult 合同、OracleClass/FailureSource/OraclePhase 枚举、CohortRegistry、FreezeBlock schema、ExperimentManifest schema、jury extractDiff |
| **依赖新引入数** | 1 | `swebench` pip 包（Python venv 隔离 + child_process.spawn 桥接） |
| **跨模块耦合** | 是 | 改 eval-task-runner.mjs、swe-bench-verified-cohort-batch.mjs、cohort-aggregate.mjs、eval-judge-jury.mjs、preregistration-check.mjs 共 5 个现有模块 |
| **复杂度信号** | 3 | subprocess 桥接（TS 调 Python harness + log 解析 + 异步 watchdog）；穷尽式三分类决策表 + 分阶段归因；oracle 语义冻结 hash 链 |
| **总体复杂度** | **HIGH** | 跨 5 模块 + 3 复杂度信号；分阶段归因与决策表正确性是评分公正核心，需重点测试 |

> **GATE_DESIGN 注意**：重点关注 ① 分阶段归因（phaseReached 打点的准确性，决定 candidate vs infra）② classifyOracle 决策表的穷尽性与 fallback ③ oracle 语义冻结的 canonical 序列化稳定性 ④ TS subprocess 错误边界（watchdog + 进程清理）。

---

## 技术现实约束与假设

来源：`research/tech-research.md`

1. **执行环境**：host = arm64 macOS，docker 可用，conda 不可用，host Python 3.14；swebench pip 包建议在 Python 3.11/3.12 venv 隔离安装。
2. **镜像策略**：Epoch AI arm64 原生镜像覆盖 ~79.3%；10 个 SWE-L fixture 对应 instance 的 arm64 覆盖率需 plan 阶段 `docker manifest inspect` 逐一确认。[推断]
3. **harness 测试集数据源**：官方 harness 可能按 instance_id 从 HuggingFace dataset 读取 failToPass/passToPass/testPatch；plan 阶段实测确认并决定"本地 dataset 喂入 vs 冻结 HF revision"，写入 freezeBlock（FR-001-f / FR-005-c）。[推断：风险点]
4. **三分类信号源**：harness 进程退出码/signal + log 文件特征字符串 + runner 实时 phaseReached 打点；TS runner 不直接读容器内 pytest 退出码，从 log 反解。
5. **性能参考**：arm64 native 约 8–30 秒/实例，x86_64+Rosetta 约 12–45 秒/实例，x86_64+QEMU 约 50–180 秒/实例（tech-research 数据）。

---

## Clarifications

### Session 2026-06-13（GATE_DESIGN 用户裁决 + clarify 自动消解）

| # | 问题 | 决议 | 来源 |
|---|------|---------|------|
| Q1 | 候选 patch 导致测试 hang/OOM/crash 算 fail 还是 error | **分阶段判定**：test_exec 前的失败=infra→error；test_exec 中的 timeout/OOM/crash=candidate→fail；exit 139 segfault 例外→infra+重试 | 用户拍板（GATE_DESIGN） |
| Q2 | freezeBlock 防篡改强度 | **冻结 oracle 语义**：oracleSpecHash 覆盖分类逻辑源码 + harness 版本 + 镜像策略 + 配置（不只 kind+timeout）；威胁模型=诚实但马虎，不防恶意改库者 | 用户拍板（GATE_DESIGN，修正 clarify 原"仅 config"自动选择） |
| Q3 | fuzzy-match secondary 结果写入位置 | 顶层 `secondaryOracle` 字段（与 primaryOracle 并列） | clarify 自动消解 |
| Q4 | FAIL run 的 patch.diff 是否落盘 | 否：patch.diff 仅 PASS run 落盘；FAIL/ERROR 保留 worktree 现场即可；日志对所有 run 落盘 | clarify 自动消解 |

### Codex 对抗审查处置

详见 `verification/codex-review-spec.md`：4 CRITICAL（C1 候选 patch 来源 / C2 反向污染 / C3 决策表穷尽 / C4 防篡改）+ 4 WARNING（W1 数据源脱节 / W2 护栏不可执行 / W3 cleanup 竞态 / W4 fixture 范围）+ 1 INFO（命名）全部已在本 spec 修订中落实。
