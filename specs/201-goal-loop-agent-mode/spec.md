---
feature: 201-goal-loop-agent-mode
title: "goal_loop agent_mode — implement↔verify 自主迭代闭环（MVP pilot：feature mode）"
status: Draft
created: 2026-06-19
revised: 2026-06-20
priority: P1
---

# Feature 201 — goal_loop agent_mode 需求规范

## 概述

将 goal-driven 自主迭代融入 spec-driver 编排体系：新增 `goal_loop` agent_mode，在 **feature 模式的 implement 阶段** 把原本的"单次 implement→verify"包装成可迭代闭环。以可执行验收测试集 + Spec-Code 对齐作为 metric，驱动 implement 子代理自主重试，直到 metric 达标、预算耗尽、或无进展，最终由人工 GATE_VERIFY 收口。

**设计范式（修正后）**：沿用 `batch_loop` 的实现形态——orchestration.yaml 声明性标签 + SKILL.md 写循环逻辑。注意与 batch_loop 的语义差异（见下文 §设计约束）。

**pilot 锁定为 feature mode（决策 D1）**：经源码核验，运行时**仅 feature 模式消费 orchestration.yaml 的 phase 序列**（经 `orchestrator-cli get-phases` 动态编排）；fix/story/implement/refactor/resume 的 phase 由各自 SKILL.md 正文固定编排，运行时**不读取 YAML phase 覆盖**（合同 `orchestration-overrides-contract.yaml` 的 `runtime_consumption_caveat` 明确，`runtime_consuming_modes: [feature]`）。因此 goal_loop 的 opt-in（经 `.specify/orchestration-overrides.yaml` 的 `modes.feature` 覆盖）**只在 feature 模式真生效**，pilot 必须是 feature。

---

## 设计约束（修正 Codex C-01/C-02/W-01）

- **C-01 修正**：`pilot` 不是合法 mode 枚举；pilot 锁定为现有 `feature` mode，不引入新 mode。
- **C-02 修正**：goal_loop 仅作用于 feature 模式（唯一运行时消费 YAML phases 的 mode）。本 spec 不声称可经 overrides 对 fix/refactor 启用 goal_loop —— 那需要在对应 SKILL.md 增加 config 开关读取的额外管线，留作后续 Feature（见 Out of Scope）。
- **W-01 修正**：goal_loop 与 batch_loop **不是"完全平行"**。共同点：均为"orchestration.yaml 声明性标签 + SKILL.md 手写循环"的实现形态。差异点：batch_loop 是逐批实现、每批后中间验证、失败时**暂停让用户人工干预**（非 metric 驱动自主重试）；goal_loop 是 **metric 驱动的自主重试闭环**。两者实现形态相似但语义不同。

---

## User Stories

### User Story 1 — 可执行验收测试驱动的 implement 迭代（Priority: P1）

开发者在 feature mode（启用 goal_loop override）下提交一个有界任务和可执行测试集（初始为红），希望 goal_loop 自主执行 implement→verify 轮次，直到测试转绿且全量不回归，最终由人工 GATE_VERIFY 收口。

**独立测试方法**：在 feature mode 的 implement phase 启用 goal_loop override；给定含红色测试的有界任务；观察系统自主迭代到测试全绿并在 GATE_VERIFY 停下等待人工确认。

**验收场景**：

1. **Given** feature mode 启用 goal_loop、任务含 N 个红色可执行验收测试；**When** 触发编排到达 implement phase；**Then** goal_loop 自主执行 implement→verify 轮次，每轮结束后检查 metric，至少一轮后测试全绿且 Layer 1.5 = COMPLIANT，进入 GATE_VERIFY 等待人工确认。
2. **Given** 上述场景，**When** verify Layer 2 某命令本轮 FAIL；**Then** 区分两类：(a) **regression**（前轮 PASS 本轮 FAIL）→ 触发回滚（FR-013）；(b) **尚未转绿的预期红**（目标测试仍红、非回归）→ **不回滚**，仅记录并继续下一轮（若剩余预算>0）或触发 fallback。两类都不掩盖失败，但只有 regression 回滚。
3. **Given** 上述场景完成，**When** 记录收敛轮数和 LLM 调用次数到迭代日志；**Then** 对比手工驱动基线记录数据（供评估 ROI）。

---

### User Story 2 — 预算耗尽与无进展 fallback（Priority: P1）

开发者希望当 goal_loop 无法在有限预算内收敛时，系统能诚实停机并移交人工，不陷入无限循环或幻觉收敛。

**独立测试方法**：设置 max_iterations=3，给定系统 3 轮内无法解决的任务，观察 goal_loop 在第 3 轮后触发人工移交，不继续循环。

**验收场景**：

1. **Given** max_iterations=3，任务在 3 轮后 metric 仍未达标；**When** 第 3 轮 verify 后；**Then** goal_loop 输出"已达 max_iterations，metric 未达标：{摘要}"，进入 GATE_VERIFY，不自动继续。
2. **Given** max_iterations=5、no_progress_max_rounds=2，连续 2 轮 metric delta 五维全 0；**When** 检测到无进展；**Then** goal_loop 触发早停 fallback，输出原因，进入 GATE_VERIFY。
3. **Given** 上述 fallback；**When** 人工在 GATE_VERIFY 接管；**Then** 人工可继续（扩大预算）或终止，系统遵从。

---

### User Story 3 — git 原子回滚护栏（Priority: P1）

开发者希望 goal_loop 在某迭代轮次引入回归时，能自动回滚到该轮次开始前的 git snapshot，避免坏变更积累。

**独立测试方法**：设计一个实现步骤引入全量测试回归，观察 git 回滚触发并还原到轮次开始 snapshot。

**验收场景**：

1. **Given** goal_loop 第 K 轮开始前已建立 snapshot（FR-013），第 K 轮 implement 后 verify 检测到 regression（之前 PASS 的测试本轮 FAIL）；**When** 检测到 regression；**Then** goal_loop 回滚到第 K 轮 snapshot，回滚成功则记录并继续；回滚失败则暂停进 GATE_VERIFY（FR-014）。
2. **Given** 回滚成功；**When** 下一轮开始；**Then** 基于回滚后干净状态执行，不继承失败轮次的部分变更。

---

### User Story 4 — opt-in 启用与默认关闭（Priority: P1）

团队希望 goal_loop 仅在 feature mode 显式配置 override 后才生效，未配置时所有现有 mode 行为与之前完全一致。

**独立测试方法**：在未修改 orchestration-overrides.yaml 的项目中跑所有 8 种 mode，验证行为无变化；再用 golden 模板启用，验证仅 feature implement phase 变化。

**验收场景**：

1. **Given** 未配置 goal_loop override；**When** 运行任意 mode；**Then** 行为与 F201 之前完全一致，无 goal_loop 迭代。
2. **Given** 通过 golden override 模板为 feature mode implement phase 声明 `agent_mode: goal_loop`；**When** 触发 feature mode；**Then** implement phase 启用 goal_loop，其他 phase/mode 不受影响。
3. **Given** 已启用；**When** 执行 `orchestrator-cli effective-orchestration feature --annotate`；**Then** 输出显示 implement phase 的 agent_mode 为 goal_loop，来源标注 overrides。

---

### User Story 5 — Spectra impact 上下文注入（Priority: P2，决策 D2：MVP 内做）

开发者希望 goal_loop 每轮 implement 时能获取当前改动的 Spectra impact 分析，减少盲目修改引入跨模块副作用（TDAD 实证：结构化 impact 上下文把自主 TDD 回归率从 6%→10% 反向压低）。

**实现修正（Codex C-03）**：**不复用 F191 注入 hook**——F191 实为 `kb-prequery.mjs` 的 scaffold-kb KB 预查注入，与 Spectra impact 无关，不存在可复用的通用 hook。goal_loop 新建专用 impact 注入小接口（调 Spectra MCP `impact` 工具）。

**独立测试方法**：在 goal_loop 运行日志中观察每轮 implement 前是否含 Spectra impact 摘要注入；graph 不可用时观察静默降级。

**验收场景**：

1. **Given** goal_loop 运行、Spectra graph 已构建；**When** 每轮 implement 开始前；**Then** goal_loop 专用注入接口调用 Spectra MCP `impact`，结果摘要注入 implement agent prompt。
2. **Given** Spectra graph 未构建（graph-not-built）或 MCP 不可用；**When** 尝试注入；**Then** 降级：跳过注入、记录警告、迭代正常继续。

---

## Functional Requirements

### A. 枚举扩展与声明

**FR-001 — `goal_loop` enum 扩展** `[必须]`
系统 MUST 在 `plugins/spec-driver/contracts/orchestration-schema.mjs` 的 `agent_mode` Zod 枚举新增 `goal_loop`，并同步更新该枚举的 `error_map` 文案（列出 goal_loop）。合法枚举变为 `[inline|single|parallel_group|gate|orchestrator_verify|batch_loop|goal_loop]`。
- 可测试：对 `agent_mode: goal_loop` 的 phase 定义 schema 校验通过；非法值报错文案含 goal_loop。
- 追踪：US-1、US-4 ｜ EC-06

**FR-002 — orchestration.yaml 声明性标签 + 运行时 agent_mode 分派** `[必须]`（修正 N-03）
系统 MUST 让 `plugins/spec-driver/config/orchestration.yaml` 的 **feature mode implement phase** 能以 `agent_mode: goal_loop` 声明（声明性标签，循环逻辑在 SKILL.md）。base 中 feature implement phase 默认仍为 `single`（FR-015 默认关闭）。

**opt-in 运行时机制（闭合 C-02 复发点）**：feature 模式编排器（feature SKILL.md）**运行时已逐 phase 读取 `phase.agent_mode` 并分派**（现有 inline/single/parallel_group/gate 分派即如此），feature 是唯一运行时消费 effective orchestration phases 的 mode。F201 在该分派逻辑新增 `goal_loop` 分支：当 implement phase 经 override 合并后的 effective `agent_mode == goal_loop` 时走 FR-003 闭环，否则走原 single 路径。因此 opt-in 在运行时真生效，**不是 batch_loop 那种纯文档标签**。SKILL.md 中 goal_loop 分支的具体落点与对现有 implement phase 编排的影响由 plan 定义。
- 可测试：`orchestrator-cli get-phases feature` / `effective-orchestration feature` 在启用 override 后 implement phase 返回 goal_loop；编排器据此走 goal_loop 分支（用 e2e/单测断言分派路径）。
- 追踪：US-1、US-4

### B. goal_loop 循环逻辑（feature SKILL.md）

**FR-003 — implement→verify 闭环执行（含轮次 snapshot 与正确顺序）** `[必须]`（修正 C-05）
feature 模式 SKILL.md 在 goal_loop 激活的 implement phase MUST 实现以下闭环：

```text
loop（轮次 i = 1..max_iterations）:
  1. 建立轮次 snapshot S_i（FR-013：记录回滚锚点，覆盖 uncommitted 场景）
  2. 注入 Spectra impact 上下文（若可用，FR-011/FR-012）
  3. 执行 implement agent（单轮）
  4. 由独立 verify 子代理实跑命令产出结构化 verification-report（Layer 2 分级 + Layer 1 FR 覆盖 + Layer 1.5 证据；FR-010）
  5. 按优先级判定（FR-004）：
       a. 若回滚失败 → 暂停退出（FR-014）                              # 最高优先
       b. 若 regression 检测到 → 回滚到 S_i（FR-013），回滚成功后视预算 continue/停止
       c. 若达标（FR-008）→ 退出 loop（成功）                          # 达标优先于"到顶"
       d. 若达 max_iterations（FR-005）或无进展（FR-006）→ 退出 loop（fallback）
       e. 否则 → i++，继续
退出后 → 进入 GATE_VERIFY（人工终局，FR-021）
```

- 可测试：观察未达标自动进入下一轮、达标退出、regression 先回滚再判停止。
- 追踪：US-1、US-2、US-3

**FR-004 — 停止/处置优先级判定** `[必须]`（修正 C-05）
goal_loop MUST 在每轮 verify 后按**固定优先级**处置（高优先先判）：
1. **回滚失败**（FR-014）→ 立即暂停进 GATE_VERIFY
2. **regression 回滚**（FR-013）→ 回滚后视剩余预算继续/停止
3. **达标**（FR-008）→ 退出（成功）
4. **预算耗尽 / 无进展**（FR-005/FR-006）→ 退出（fallback）

**同轮冲突规则**：达标（优先级 3）严格高于预算耗尽/无进展（优先级 4）。即最后一轮（i == max_iterations）若同时达标与到顶，exit reason MUST 记为"达标（成功）"而非"已达最大迭代次数"。停止时 MUST 记录停止原因到迭代日志（NFR-002）。
- 可测试：构造各优先级冲突场景（如同轮 regression+达 max_iterations），验证按优先级处置。
- 追踪：US-1、US-2、US-3 ｜ EC-01、EC-02、EC-04

**FR-005 — max_iterations 上限** `[必须]`
goal_loop MUST 支持 `max_iterations` 配置项（spec-driver.config.yaml 的 goal_loop 段）。到顶且**本轮未达标**时立即停止、进入 GATE_VERIFY、输出"已达最大迭代次数"；若本轮恰好达标，则按 FR-004 同轮冲突规则记为达标退出（不输出"已达最大迭代次数"）。
- 可测试：max_iterations=2 + 需 3+ 轮任务 → 第 2 轮后停（fallback）；max_iterations=2 + 第 2 轮恰好达标 → 记达标退出。
- 追踪：US-2 ｜ EC-01

**FR-006 — 无进展 fallback（多维 delta）** `[必须]`（修正 W-04）
goal_loop MUST 把每轮 metric delta 定义为**五维向量**：(1) Layer 2 PASS 数变化、(2) P1 FR 覆盖率变化、(3) Layer 1.5 证据状态变化、(4) 回归数变化、(5) 改动量（净增删行）。连续 `no_progress_max_rounds`（默认 2）轮**五维全 0** 才判无进展，触发早停进 GATE_VERIFY。
- 可测试：构造五维全 0 任务，验证 2 轮后 fallback；任一维有改善则视为有进展不早停。
- 追踪：US-2 ｜ EC-02

**FR-007 — 迭代成本预算** `[必须]`（修正 W-06）
goal_loop MUST 支持 `max_verify_seconds`（单轮 verify 累计墙钟上限）与 `max_tool_invocations`（单轮工具调用次数上限）两个预算项；任一超限标记该轮 infra-failure。连续 infra-failure（计入 EC-02 无进展）触发早停。verify 可选 smoke（快速子集）/full 分层，由 plan 定义粒度。
- 可测试：设极小 max_verify_seconds，验证超限标记 infra-failure 并计入早停。
- 追踪：US-2 ｜ EC-03

### C. Metric 定义（修正 C-04/W-05）

**FR-008 — 达标 metric 定义** `[必须]`（修正 C-04）
goal_loop 达标 MUST 为以下**全部满足**：
- **Layer 2 全 PASS**：所有工具链命令结果为 PASS（见 FR-009 分级）；**无 FAIL / SKIPPED / UNKNOWN**
- **Layer 1 FR 覆盖**：spec 中标注的 **P1 验收条件对应 FR 覆盖率 = 100%**（checkbox 全 marked）
- **Layer 1.5 证据 = COMPLIANT**：**PARTIAL / EVIDENCE_MISSING 均不算达标**

> Layer 1（✅/❌/⚠️ FR 覆盖）与 Layer 1.5（COMPLIANT/PARTIAL/EVIDENCE_MISSING 证据状态）是 verify.md 中**不同层**，本 FR 已区分，不再混用。PARTIAL/SKIPPED/UNKNOWN 一律不自动收敛，只能进人工 GATE_VERIFY 由人裁决。
- 可测试：Layer 2 全 PASS 但 Layer 1.5=PARTIAL 时 goal_loop **不停止**（继续迭代或 fallback），不自动判达标。
- 追踪：US-1 ｜ EC-07

**FR-009 — verify 结果四级分类** `[必须]`（修正 W-05）
goal_loop 消费的 verify 结果 MUST 区分 **PASS / FAIL / SKIPPED / UNKNOWN**：工具未安装→SKIPPED；命令未运行/输出无法解析→UNKNOWN；非零退出/超时→FAIL；零退出且有有效输出→PASS。仅 PASS 计入达标；SKIPPED/UNKNOWN 阻止自动达标（进人工 gate）。
- 可测试：在零构建工具环境运行，验证 Layer 2 标 SKIPPED 且 goal_loop 不自动判达标。
- 追踪：US-1 ｜ EC-03、EC-07

**FR-010 — 结构化 verification-report 契约 + 证据 provenance（职责分离）** `[必须]`（修正 I-05、N-01）
goal_loop MUST 消费 verify 产出的**结构化** verification-report（字段 schema 由 plan 定义，至少含：每命令 PASS/FAIL/SKIPPED/UNKNOWN、Layer 1 FR 覆盖率、Layer 1.5 证据状态、回归测试清单），**不靠自然语言解析** verify agent 自由文本。

**职责分离（降低 reward-hacking，N-01）**：verification-report MUST 由**独立的 verify 子代理实际执行命令并捕获真实退出码**产出，**不接受 implement 子代理自报**的达标字段。report 中每条 PASS/FAIL MUST 可追溯到具体命令名 + 退出码（provenance）；缺退出码/缺命令证据的条目按 UNKNOWN 处理（FR-009，不计入达标）。这把"implement 自证达标"的通道堵死；但**无法阻止 implement 篡改测试本身使其 trivially 真绿**（测试过拟合），该残口仍为残留风险，由 FR-023 + 人工 GATE_VERIFY + Codex 对抗审查兜底，不 over-claim 已消除。
- 可测试：给定结构化 report fixture，goal_loop 正确提取五维 delta 与达标判定；给定缺退出码的伪造 report 条目，goal_loop 判 UNKNOWN 不自动达标。
- 追踪：US-1、US-2 ｜ EC-07

### D. Spectra Impact 注入（决策 D2：MVP 新建专用接口）

**FR-011 — goal_loop 专用 Spectra impact 注入** `[必须]`（修正 C-03）
goal_loop MUST 在每轮 implement 前，通过**新建的 goal_loop 专用注入接口**（调 Spectra MCP `impact` 工具，**非复用 F191 kb-prequery**）获取改动 impact 摘要，注入 implement agent prompt。
- 可测试：检查迭代日志，每轮 implement prompt 含 Spectra impact 注入标记。
- 追踪：US-5

**FR-012 — Spectra 不可用降级** `[必须]`
graph-not-built 或 MCP 不可用时，系统 MUST 降级：跳过注入、记录警告、迭代正常继续，不中止。
- 可测试：未建 graph 环境运行，迭代正常完成且日志含降级警告。
- 追踪：US-5 ｜ EC-05

### E. git 原子回滚

**FR-013 — 轮次 snapshot 与 regression 回滚** `[必须]`（修正 C-05）
goal_loop MUST 在每轮 implement **开始前**建立 snapshot（机制由 plan 定）——覆盖 uncommitted 工作区（如临时 commit / `git stash create` / patch 落盘），保证"轮次开始前状态"可定义、可还原。verify 检测 regression（前轮 PASS 的测试本轮 FAIL）时回滚到本轮 snapshot。
- 可测试：故意引入全量回归，验证回滚到轮次 snapshot、工作区还原。
- 追踪：US-3 ｜ EC-04

**FR-014 — 回滚失败时暂停** `[必须]`
git 回滚失败时 goal_loop MUST 立即暂停、输出失败详情、进入 GATE_VERIFY，不继续下一轮。
- 可测试：模拟回滚失败（脏状态冲突），验证暂停进 GATE_VERIFY。
- 追踪：US-3 ｜ EC-04

### F. Opt-in 与配置安全

**FR-015 — opt-in via orchestration-overrides，默认关闭** `[必须]`
goal_loop MUST 默认关闭：base orchestration.yaml 不启用；仅通过 `.specify/orchestration-overrides.yaml` 的 `modes.feature` 整段替换声明 implement phase 的 `agent_mode: goal_loop` 才激活。未配置时所有 mode 行为不变。
- 可测试：未配 override 跑 8 mode 行为不变；配置后仅 feature implement phase 变。
- 追踪：US-4 ｜ EC-05

**FR-016 — golden override 模板、校验与 drift 检测** `[必须]`（修正 W-08、N-04）
鉴于 `modes.<mode>` 整段替换不继承 base（resolver 语义），系统 MUST 提供 feature mode 的 **golden override 模板**（完整 phase 列表，仅 implement phase 改 goal_loop），并附校验测试断言模板经 resolver 后 feature 其余 phase 与 base 等价、仅 implement agent_mode 变。

**stale override 检测（N-04）**：模板 MUST 携带与 base 一致的 `version` 字段；当 base feature phase 序列未来变更导致整段替换的 override 漂移时，复用 resolver 现有的 `orchestration-overrides.version-mismatch` 诊断（见 CLAUDE.md 降级信号排查）发出 warning，提示用户重新生成模板。F201 文档 MUST 诚实标注：整段替换 modes.feature 存在与 base 漂移的长期维护负担，phase 序列单源化（消除整段替换）留后续 milestone（见 Out of Scope #2）。
- 可测试：模板经 `effective-orchestration feature` 后 phase 集合与 base 差异仅 implement.agent_mode；version 不一致时 diagnostics 含 version-mismatch。
- 追踪：US-4 ｜ EC-05

**FR-017 — goal_loop 误配非 implement 阶段降级** `[可选]`
goal_loop 被声明到非 implement phase 时，SKILL.md SHOULD 检测并降级为 single、输出警告、不中止。
- 可测试：配置到 specify phase，验证警告且行为等同 single。
- 追踪：EC-06

### G. 并发与可观测

**FR-018 — 单实例并发锁与 run_id 日志** `[必须]`（修正 W-07）
goal_loop MUST 对同一 worktree/feature_dir 强制单实例（检测到并发实例则失败并进人工 gate）；迭代日志按 `run_id` 原子追加。
- 可测试：并发启动两个 goal_loop 实例，第二个被拒并进人工 gate。
- 追踪：US-1（工程保障）

**FR-019 — 结构化迭代日志** `[必须]`
每轮 MUST 输出结构化日志（轮次号、五维 metric 状态、delta、停止/处置判定、snapshot 锚点、git hash 若有），供 GATE_VERIFY 人工回顾。
- 可测试：日志含上述字段且每轮可解析。
- 追踪：US-1、US-2、US-3

### H. 护栏与不回归

**FR-020 — 现有 8 mode 与 batch_loop 不回归** `[必须]`
goal_loop 作为新增 opt-in MUST NOT 破坏 feature/fix/refactor/story/implement/resume/sync/doc 任何行为；batch_loop 不回归。
- 可测试：合入后全量 vitest/build/repo:check 零失败，现有 mode 测试不变。
- 追踪：所有 US

**FR-021 — GATE_VERIFY 人工终局语义不变 + 字段锁** `[必须]`（修正 I-02）
无论 goal_loop 结果如何，最终 MUST 进入 GATE_VERIFY（default_behavior=always、severity=critical）。F201 MUST 增加回归测试锁住 GATE_VERIFY 这两个字段不被无意修改。
- 可测试：goal_loop 达标后系统仍停 GATE_VERIFY 等人工；回归测试断言两字段值。
- 追踪：US-1、US-2、US-3

**FR-022 — Codex 对抗审查产出可校验制品** `[必须]`（修正 W-09）
所有 `plugins/spec-driver/` 改动 MUST 经 Codex 对抗审查，并产出 `specs/201-goal-loop-agent-mode/verification/codex-adversarial-review-<phase>.md` 制品（含发现级别、处置状态、未解决项计数），commit message 仅作备注。
- 可测试：制品存在且 CRITICAL 项处置状态全 closed。
- 追踪：US-1（工程保障）

**FR-023 — reward hacking 残留风险文档化 + 护栏诚实** `[必须]`（修正 W-02，并入 EC-07）
设计文档 MUST 显式记录 reward hacking / 测试过拟合 / 长程局部最优为残留风险，不 over-claim "全自动安全"。MUST 诚实标注护栏现状：**GATE_IMPLEMENT_MID 默认 `on_failure` / `non_critical`、仅 implement mode**，作为 goal_loop reward-hacking 护栏时需在 override 中显式升级为 `always`/`critical`，否则不得当作强护栏宣称。核心兜底是 GATE_VERIFY（always/critical）+ Layer 1.5 证据 + Codex 对抗审查。
- 可测试：plan.md / spec.md 含上述风险与护栏现状声明；启用 goal_loop 的 golden 模板若依赖 GATE_IMPLEMENT_MID 则同步升级其 severity。
- 追踪：EC-07

---

## Edge Cases（EC↔FR 已重建，修正 W-03）

| EC | 场景 | 期望行为 | 关联 FR |
|----|------|---------|---------|
| EC-01 | max_iterations 到顶但 metric 未达标 | 输出"已达最大迭代次数 {N}，metric：{摘要}"，进 GATE_VERIFY，不自动扩预算 | FR-004、FR-005 |
| EC-02 | 连续 N 轮五维 delta 全 0（无进展） | 触发早停 fallback，输出原因，进 GATE_VERIFY | FR-004、FR-006 |
| EC-03 | 某轮 verify build 崩溃 / 超预算 | 标 FAIL/infra-failure；若构成 regression（前轮 PASS 本轮 FAIL）则回滚，否则不回滚仅记录；continue 或计入无进展 fallback | FR-007、FR-009、FR-013 |
| EC-04 | git 回滚失败 | 立即暂停，输出失败详情，进 GATE_VERIFY，不继续 | FR-013、FR-014 |
| EC-05 | orchestration-overrides 缺失 / 未声明 goal_loop | 所有 mode 按 base 运行，feature implement = single，行为无变化 | FR-015、FR-016 |
| EC-06 | goal_loop 误配非 implement 阶段 | Zod 校验通过（合法 enum），SKILL.md 运行时检测降级 single + 警告，不中止 | FR-001、FR-017 |
| EC-07 | reward hacking / 测试过拟合（诚实残留风险） | **不可完全消除**；缓解：Layer 1.5 证据（COMPLIANT 才达标）+ GATE_VERIFY 人工 + Codex 对抗审查；GATE_IMPLEMENT_MID 默认 non_critical 需显式升级；不 over-claim 全自动安全 | FR-008、FR-009、FR-023 |

---

## Non-Functional Requirements

- **NFR-001 — 阶段边界**：goal_loop 仅包裹 feature 的 implement 阶段，MUST NOT 触及 research/specify/plan/tasks；feature 整体不自动化（研究/设计/spec/plan/tasks 与 GATE 全保留）。
- **NFR-002 — 可观测性**：见 FR-019（结构化迭代日志）。
- **NFR-003 — 工程约定**：显式路径 commit、禁 `git add -A`、`specs/src.spec.md` 排除、独立 worktree、改动后 `npm run repo:sync`/`repo:check`/`release:check`。

---

## Success Criteria

- **SC-001**：feature mode（启用 goal_loop override）下给定有界任务 + 红色验收测试集，goal_loop 自主迭代到达标（Layer2 全 PASS + P1 FR 100% + Layer1.5 COMPLIANT）且全量不回归，GATE_VERIFY 人工收口正常。
- **SC-002**：max_iterations / 无进展 fallback 实测触发，系统在预期轮次停止进 GATE_VERIFY，不无限循环。
- **SC-003**：regression 触发 git 回滚到轮次 snapshot，工作区还原，后续从干净状态继续。
- **SC-004**：未配 override 时 8 mode 行为与 F201 之前完全一致（全量 vitest/build/repo:check 零失败）。
- **SC-005**：`npx vitest run` 零失败、`npm run build` 零类型错误、`npm run repo:check` 零告警、`npm run release:check` 通过。
- **SC-006**：所有 plugins/spec-driver/ 改动经 Codex 对抗审查，CRITICAL 全修复，产出 codex-adversarial-review-*.md 制品（FR-022）。

---

## Out of Scope（本 MVP 不做）

1. **非 feature mode 的 goal_loop**：fix/refactor/story 等启用 goal_loop 需在各自 SKILL.md 加 config 开关读取管线（运行时不消费 YAML phases），留后续 Feature。
2. **多 mode 推广 / phase 序列单源化**：让所有 mode 运行时统一消费 YAML（消除 runtime_consumption_caveat）留后续 milestone。
3. **自动 metric 推断**：metric 由系统固定定义（FR-008），不支持用户自定义 metric 表达式。
4. **跨 feature 编排 loop**：goal_loop 仅在单 feature 的 implement phase 内部。
5. **评测/KB 改动**：不触及 scaffold-kb、eval harness、baseline。
6. **GATE_VERIFY 语义变更**：不改人工终局语义。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 评估 |
|------|------|
| 新增组件 | goal_loop SKILL.md 循环逻辑块 + goal_loop 专用 Spectra impact 注入接口 + 结构化 verification-report 消费 + 轮次 snapshot 机制 + 单实例锁 |
| 接口数 | schema 枚举扩展（1）+ SKILL.md goal_loop 入口（1）+ impact 注入接口（1）+ verification-report 契约（1）= 4 |
| 新外部依赖 | 0（复用 Spectra MCP impact、git、verify 现成 Layer 原语）|
| 跨模块 | contracts（schema）+ config（orchestration.yaml）+ skills（feature SKILL.md）+ 新注入接口；均扩展不改已有接口 |
| 复杂度信号 | 迭代状态机 + 多维 delta + snapshot/回滚 + 并发锁 = 多信号 |
| 总体复杂度 | **MEDIUM-HIGH**（较初版上调：metric 分级、snapshot、并发、成本预算均为新增确定项）|

**GATE_DESIGN 建议**：plan 阶段须明确：(1) verification-report 字段 schema；(2) 轮次 snapshot 机制选型（临时 commit vs stash vs patch）；(3) goal_loop 循环逻辑放 feature SKILL.md 的位置与对现有 implement phase 编排的影响；(4) golden override 模板形态。

---

## Open Questions（均已在 plan 阶段决策）

- **OQ-01（已由 D1 解决）**：~~pilot 选哪个 mode~~ → 锁定 feature（唯一运行时消费 YAML phases 的 mode）。
- **OQ-02（已由 plan 解决）**：snapshot 机制 → **`git stash push --include-untracked`（全量捕获含既有 untracked）+ `reset --hard` + `clean -fd` + `stash apply --index` 还原**；回滚命令由 core `planRollbackCommands()` 规划、单测覆盖。**不用临时 commit**（避免污染历史 + `git add -A` 约束冲突）。详见 plan §2 OQ-02。
- **OQ-03（已由 plan 解决）**：verify 分层 → **静态轮次策略**：1..(N-1) 轮 smoke（`tsc --noEmit` + unit test），末轮/达标前 full（`npm run build` + lint + repo:check）。**smoke 子集静态定义、不依赖 Spectra impact BFS**（避免 graph 可用性循环依赖）。详见 plan §2 OQ-03。

---

## 关联文档

- `specs/201-goal-loop-agent-mode/feature-input.md` — 原始需求输入
- `specs/201-goal-loop-agent-mode/verification/codex-adversarial-review-spec.md` — 本 spec 的 Codex 对抗审查记录
- `plugins/spec-driver/contracts/orchestration-schema.mjs` — agent_mode 枚举（:115-126，需扩 goal_loop）
- `plugins/spec-driver/config/orchestration.yaml` — GATE_IMPLEMENT_MID（:84-92，on_failure/non_critical）、GATE_VERIFY（:94-108，always/critical）、refactor batch_loop（:739-744）
- `plugins/spec-driver/contracts/orchestration-overrides-contract.yaml` — `runtime_consumption_caveat`（runtime_consuming_modes: [feature]）
- `plugins/spec-driver/lib/orchestration-resolver.mjs` — modes 整段替换语义（:71-87）
- `plugins/spec-driver/skills/spec-driver-feature/SKILL.md` — feature 编排（goal_loop 循环逻辑落地处）
- `plugins/spec-driver/agents/verify.md` — Layer 1（✅/❌/⚠️）/ 1.5（COMPLIANT/PARTIAL/EVIDENCE_MISSING）/ 2（PASS/SKIP）原语
- `specs/products/spec-driver/current-spec.md` — 产品事实源
