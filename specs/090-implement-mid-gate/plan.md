---
feature: 090-implement-mid-gate
type: plan
date: 2026-04-06
spec: ./spec.md
research: ./research/tech-research.md
---

# 技术规划：实现中期门禁（GATE_IMPLEMENT_MID）

## 1. 变更文件清单

本次变更严格限制在 3 个文件内（NFR-002），全部为追加型修改：

| 文件 | 修改类型 | 修改位置 | 修改内容摘要 |
|------|----------|----------|-------------|
| `plugins/spec-driver/skills/spec-driver-implement/SKILL.md` | 追加 | 初始化阶段 Step 4 门禁配置加载 | 将 GATE_IMPLEMENT_MID 加入 Implement 模式门禁子集和行为表 |
| `plugins/spec-driver/skills/spec-driver-implement/SKILL.md` | 追加 | Phase 4: Implementation | 将单段 Phase 4 拆分为 Phase 4a / GATE_IMPLEMENT_MID / Phase 4b 三段结构 |
| `plugins/spec-driver/skills/spec-driver-feature/SKILL.md` | 追加 | 初始化阶段 Step 4 门禁配置加载 | 将 GATE_IMPLEMENT_MID 加入 Feature 模式门禁子集和行为表 |
| `spec-driver.config.yaml` | 追加 | `gates` 注释块 | 增加 GATE_IMPLEMENT_MID 配置示例注释 |

---

## 2. 修改策略

### 2.1 implement SKILL.md — Step 4 门禁配置加载

**现有内容（第 106-132 行）**：

```text
3. Implement 模式门禁子集: GATE_TASKS, GATE_VERIFY

4. 构建行为表:
   for GATE in [GATE_TASKS, GATE_VERIFY]:
     ...

balanced 默认值表:
  | 门禁         | 默认行为 | 分类       |
  | ------------ | -------- | ---------- |
  | GATE_TASKS   | always   | 关键       |
  | GATE_VERIFY  | always   | 关键       |

strict 默认值: 全部 always
autonomous 默认值: 全部 on_failure
```

**修改方式**：在门禁子集中追加 GATE_IMPLEMENT_MID，在行为表中追加对应行。

**修改后内容**：

```text
3. Implement 模式门禁子集: GATE_TASKS, GATE_IMPLEMENT_MID, GATE_VERIFY

4. 构建行为表:
   for GATE in [GATE_TASKS, GATE_IMPLEMENT_MID, GATE_VERIFY]:
     if gates.{GATE}.pause 有配置:
       behavior[GATE] = gates.{GATE}.pause
     else:
       根据 gate_policy 应用默认行为

balanced 默认值表:
  | 门禁                | 默认行为   | 分类                     |
  | ------------------- | ---------- | ------------------------ |
  | GATE_TASKS          | always     | 关键                     |
  | GATE_IMPLEMENT_MID  | on_failure | 非关键（仅异常时暂停）   |
  | GATE_VERIFY         | always     | 关键                     |

strict 默认值: 全部 always
autonomous 默认值: 全部 on_failure
```

**设计决策**：GATE_IMPLEMENT_MID 在 balanced 下默认 `on_failure`（与 spec.md FR-006 一致），分类为"非关键"——无问题时自动继续，仅发现架构劣化或假设失效时暂停。这确保了向后兼容：升级后无问题的 Feature 体验与升级前一致（NFR-001）。

---

### 2.2 implement SKILL.md — Phase 4 拆分为三段结构

**现有内容（第 343-358 行）**：

Phase 4 目前是单段结构，直接调用 implement 子代理执行全部任务。

**修改方式**：将 Phase 4 拆分为条件型三段结构。在现有 Phase 4 标题下方，先插入 task 计数和跳过判断逻辑，然后将原有单次子代理调用包裹为"跳过时直接执行"分支，新增"触发时拆分为 4a/GATE/4b"分支。

**修改后完整 Phase 4 内容**：

````markdown
### Phase 4: Implementation / 代码实施 [4/6]

`[4/6] 正在执行代码实施...`

#### GATE_IMPLEMENT_MID 前置计算

在进入子代理调用前，编排器先计算是否需要中期门禁：

```text
1. 解析 tasks.md 中的 top-level task 行
   - 匹配模式: 行首（忽略前导空格 0-3 个）以 `- [ ]` 或 `- [x]` 或 `- [X]` 开头的行
   - 仅计数第一级 checkbox（Markdown 缩进层级 0 或 Phase 标题下第一级）
   - 嵌套子任务（缩进 >= 4 空格或 >= 1 tab 的 checkbox）不计入
   - 设 total_tasks = 匹配到的 top-level task 行总数

2. 判断是否触发 GATE_IMPLEMENT_MID:
   if total_tasks 无法解析（正则无匹配结果）:
     gate_mid_enabled = false
     输出: [GATE] GATE_IMPLEMENT_MID | SKIPPED | reason=tasks_unparseable
   elif total_tasks <= 5:
     gate_mid_enabled = false
     输出: [GATE] GATE_IMPLEMENT_MID | SKIPPED | reason=task_count<=5
   else:
     gate_mid_enabled = true
     mid_point = floor(total_tasks * 0.5)
     输出: [INFO] GATE_IMPLEMENT_MID 已启用 | total_tasks={total_tasks} | mid_point={mid_point}
```

#### 分支 A: 跳过门禁（gate_mid_enabled = false）

直接执行完整 Phase 4，与原有逻辑完全一致：

读取 `prompt_source[implement]`，调用 Task(description: "执行成熟 spec 实施", prompt: "{implement prompt}" + "{上下文注入 + spec.md + plan.md + tasks.md 路径}", model: "{config.agents.implement.model}")。

在 prompt 中追加指示：

```text
[IMPLEMENT 模式] 本次实施建立在成熟 spec/plan 上。
- 严格按 tasks.md 落地
- 不重新打开调研阶段
- 若发现 spec/plan 与真实代码冲突，仅修补与本次任务直接相关的必要差异
- 完成声明仍必须遵守验证铁律，给出实际命令与输出证据
```

#### 分支 B: 触发门禁（gate_mid_enabled = true）

将 Phase 4 拆分为 Phase 4a → GATE_IMPLEMENT_MID → Phase 4b：

##### Phase 4a: 前半段实施

读取 `prompt_source[implement]`，调用 Task(description: "执行前半段实施（前 {mid_point} 个任务）", prompt: "{implement prompt}" + "{上下文注入 + spec.md + plan.md + tasks.md 路径}" + "{4a 追加指令}", model: "{config.agents.implement.model}")。

**4a 追加指令**：

```text
[IMPLEMENT 模式 — 分段实施 Phase 4a]
本次实施建立在成熟 spec/plan 上。

**重要: 本次仅执行 tasks.md 中的前 {mid_point} 个 top-level 任务。**

执行要求:
- 严格按 tasks.md 顺序，完成前 {mid_point} 个 top-level 任务后停止
- 每完成一个 task，在 tasks.md 中将对应 checkbox 标记为 [x]
- 不重新打开调研阶段
- 若发现 spec/plan 与真实代码冲突，仅修补与本次任务直接相关的必要差异

完成时返回以下信息（中期进度报告）:
1. 已完成的 task 编号/标题列表
2. 本次变更的文件列表（每个文件的路径和变更类型：新增/修改/删除）
3. 执行过程中遇到的异常或与预期不符的情况（如有）
4. 对 tasks.md 前置假设的观察（如发现某些假设不成立，明确列出）
```

若 Phase 4a 子代理调用失败（返回错误或超时），不进入 GATE_IMPLEMENT_MID，直接标记 Phase 4 为 FAILED 并进入错误处理流程。

##### GATE_IMPLEMENT_MID: 中期门禁

**此阶段由编排器亲自执行，不委派子代理。**

```text
1. 获取 behavior[GATE_IMPLEMENT_MID]

2. 收集检查输入:
   - 从 Phase 4a 子代理返回中提取: 已完成 task 列表、变更文件列表、异常观察
   - 读取 plan.md 的变更文件预期范围
   - 读取 tasks.md 中的前置条件和依赖假设

3. 执行检查（两项轻量级信号检测）:

   检查项 A — 架构劣化信号:
     对比 Phase 4a 的变更文件列表与 plan.md 的预期范围
     - 是否出现 plan.md 未提及的核心模块改动
     - 是否出现与 plan.md 预期不一致的文件结构变更
     - 判定: PASS（无偏离）| WARNING（轻微偏离）| CRITICAL（显著偏离）

   检查项 B — 前置假设验证:
     检查 tasks.md 中声明的前置条件在实施过程中是否仍然成立
     - Phase 4a 子代理是否报告了"与预期不符"的异常
     - 已完成任务是否依赖了不存在的 API / 文件路径 / 模块接口
     - 判定: PASS（假设成立）| WARNING（部分假设需调整）| CRITICAL（关键假设失效）

   综合判定:
     if 任一检查项为 CRITICAL:
       gate_result = CRITICAL
     elif 任一检查项为 WARNING:
       gate_result = WARNING
     else:
       gate_result = PASS

4. 根据 behavior 和 gate_result 决策:
   - always → 暂停展示检查结果摘要，用户选择:
     A) 修复后继续（编排器等待用户修复后重新进入 Phase 4b）
     B) 强制继续（忽略问题，进入 Phase 4b）
     C) 中止（终止实施流程）
   - auto → 自动继续（仅在日志中记录检查结果）
   - on_failure →
     if gate_result == CRITICAL:
       暂停展示检查结果，用户选择 A/B/C
     else:
       自动继续

5. 输出:
   [GATE] GATE_IMPLEMENT_MID | policy={gate_policy} | override={有/无} | decision={PAUSE|AUTO_CONTINUE|SKIPPED} | reason={理由}
   [GATE_DETAIL] architecture_drift={PASS|WARNING|CRITICAL} | assumption_validity={PASS|WARNING|CRITICAL}
```

##### Phase 4b: 后半段实施

读取 `prompt_source[implement]`，调用 Task(description: "执行后半段实施（剩余任务）", prompt: "{implement prompt}" + "{上下文注入 + spec.md + plan.md + tasks.md 路径}" + "{4b 追加指令}", model: "{config.agents.implement.model}")。

**4b 追加指令**：

```text
[IMPLEMENT 模式 — 分段实施 Phase 4b]
本次实施建立在成熟 spec/plan 上。

**重要: 本次继续执行 tasks.md 中尚未完成的剩余 top-level 任务。**

前半段实施摘要（Phase 4a 已完成）:
- 已完成 task: {4a 已完成的 task 编号/标题列表}
- 已变更文件: {4a 变更文件列表}
- 异常观察: {4a 报告的异常，若无则 "无"}
{若 GATE_IMPLEMENT_MID 产生了 WARNING 以上的发现}:
- 门禁检查发现: {检查结果摘要}
- 用户决策: {用户在门禁中的选择}

执行要求:
- 从 tasks.md 中第一个未标记 [x] 的 top-level task 开始，按顺序完成全部剩余任务
- 每完成一个 task，在 tasks.md 中将对应 checkbox 标记为 [x]
- 不重新打开调研阶段
- 若发现 spec/plan 与真实代码冲突，仅修补与本次任务直接相关的必要差异
- 完成声明仍必须遵守验证铁律，给出实际命令与输出证据
```
````

---

### 2.3 feature SKILL.md — Step 4 门禁配置加载

**现有内容（第 117-138 行）**：

```text
3. Feature 模式门禁子集: GATE_RESEARCH, GATE_DESIGN, GATE_ANALYSIS, GATE_TASKS, GATE_VERIFY（全部 5 个）

4. 构建行为表:
   for GATE in [GATE_RESEARCH, GATE_DESIGN, GATE_ANALYSIS, GATE_TASKS, GATE_VERIFY]:
     ...

balanced 默认值表:
  | 门禁           | 默认行为   | 分类                     |
  | -------------- | ---------- | ------------------------ |
  | GATE_RESEARCH  | auto       | 非关键                   |
  | GATE_ANALYSIS  | on_failure | 非关键（CRITICAL 时暂停）|
  | GATE_DESIGN    | always     | 关键（且硬门禁）         |
  | GATE_TASKS     | always     | 关键                     |
  | GATE_VERIFY    | always     | 关键                     |

strict 默认值: 全部 always
autonomous 默认值: 全部 on_failure

注: GATE_DESIGN 在 feature 模式下为硬门禁，...
```

**修改方式**：在门禁子集中追加 GATE_IMPLEMENT_MID，在行为表的 GATE_TASKS 和 GATE_VERIFY 之间插入 GATE_IMPLEMENT_MID 行。

**修改后内容**：

```text
3. Feature 模式门禁子集: GATE_RESEARCH, GATE_DESIGN, GATE_ANALYSIS, GATE_TASKS, GATE_IMPLEMENT_MID, GATE_VERIFY（全部 6 个）

4. 构建行为表:
   for GATE in [GATE_RESEARCH, GATE_DESIGN, GATE_ANALYSIS, GATE_TASKS, GATE_IMPLEMENT_MID, GATE_VERIFY]:
     if gates.{GATE}.pause 有配置:
       behavior[GATE] = gates.{GATE}.pause  // always | auto | on_failure
     else:
       根据 gate_policy 应用默认行为（见下表）

balanced 默认值表:
  | 门禁                | 默认行为   | 分类                     |
  | ------------------- | ---------- | ------------------------ |
  | GATE_RESEARCH       | auto       | 非关键                   |
  | GATE_ANALYSIS       | on_failure | 非关键（CRITICAL 时暂停）|
  | GATE_DESIGN         | always     | 关键（且硬门禁）         |
  | GATE_TASKS          | always     | 关键                     |
  | GATE_IMPLEMENT_MID  | on_failure | 非关键（仅异常时暂停）   |
  | GATE_VERIFY         | always     | 关键                     |

strict 默认值: 全部 always
autonomous 默认值: 全部 on_failure

注: GATE_DESIGN 在 feature 模式下为硬门禁，gates 配置中对 GATE_DESIGN 的覆盖在 feature 模式下亦不生效
```

**注意**：feature SKILL.md 的 Phase 6（代码实现 [9/10]）本身不需要修改。GATE_IMPLEMENT_MID 的触发逻辑完全内联在 implement SKILL.md 的 Phase 4 中。当 feature 模式通过 Task tool 调用 implement 子代理时，implement 子代理内部的 Phase 4 会自行执行门禁逻辑。但 feature 模式的门禁配置加载需要包含 GATE_IMPLEMENT_MID，以确保配置一致性和 `gates.GATE_IMPLEMENT_MID.pause` 的显式覆盖在 feature 模式下也能生效。

---

### 2.4 spec-driver.config.yaml — 追加注释

**现有内容（第 93-106 行）**：

```yaml
# 门禁级配置（高级，可选）
# 对每个门禁独立配置，优先于 gate_policy
# 可选值: always | auto | on_failure
# gates:
#   GATE_RESEARCH:
#     pause: auto
#   GATE_DESIGN:
#     pause: always
#   GATE_ANALYSIS:
#     pause: auto
#   GATE_TASKS:
#     pause: always
#   GATE_VERIFY:
#     pause: always
```

**修改方式**：在 `GATE_TASKS` 和 `GATE_VERIFY` 之间插入 GATE_IMPLEMENT_MID 注释行。

**修改后内容**：

```yaml
# 门禁级配置（高级，可选）
# 对每个门禁独立配置，优先于 gate_policy
# 可选值: always | auto | on_failure
# gates:
#   GATE_RESEARCH:
#     pause: auto
#   GATE_DESIGN:
#     pause: always
#   GATE_ANALYSIS:
#     pause: auto
#   GATE_TASKS:
#     pause: always
#   GATE_IMPLEMENT_MID:
#     pause: on_failure    # 实施中期门禁（>5 tasks 时在 50% 处触发）
#   GATE_VERIFY:
#     pause: always
```

---

## 3. GATE_IMPLEMENT_MID 触发逻辑伪代码

```text
function execute_phase4(tasks_md, plan_md, spec_md, config):
  # ─── 步骤 1: 计算 top-level task 总数 ───
  lines = read_file(tasks_md)
  top_level_tasks = []
  for line in lines:
    # 匹配第一级 checkbox: 行首 0-3 空格 + "- [ ]" 或 "- [x]" 或 "- [X]"
    if regex_match(line, /^[ ]{0,3}- \[([ xX])\] /):
      top_level_tasks.append(line)

  total_tasks = len(top_level_tasks)

  # ─── 步骤 2: 判断是否启用中期门禁 ───
  if total_tasks == 0:
    log("[GATE] GATE_IMPLEMENT_MID | SKIPPED | reason=tasks_unparseable")
    execute_full_phase4()    # 回退到完整单次执行
    return

  if total_tasks <= 5:
    log("[GATE] GATE_IMPLEMENT_MID | SKIPPED | reason=task_count<=5")
    execute_full_phase4()    # 直接执行完整 Phase 4
    return

  # ─── 步骤 3: 计算 50% 触发点 ───
  mid_point = floor(total_tasks * 0.5)
  log("[INFO] GATE_IMPLEMENT_MID 已启用 | total_tasks={total_tasks} | mid_point={mid_point}")

  # ─── 步骤 4: Phase 4a — 前半段实施 ───
  result_4a = call_implement_subagent(
    tasks_md, plan_md, spec_md,
    instruction="执行前 {mid_point} 个 top-level 任务后返回中期进度报告"
  )

  if result_4a.failed:
    log("[ERROR] Phase 4a FAILED")
    mark_phase4_failed()
    return

  # ─── 步骤 5: GATE_IMPLEMENT_MID — 中期门禁检查 ───
  # 编排器亲自执行，不委派子代理
  behavior = get_gate_behavior("GATE_IMPLEMENT_MID", config)

  # 检查项 A: 架构劣化信号
  changed_files = result_4a.changed_files
  planned_scope = extract_planned_scope(plan_md)
  arch_drift = compare_scope(changed_files, planned_scope)
  # arch_drift ∈ {PASS, WARNING, CRITICAL}

  # 检查项 B: 前置假设验证
  assumptions = extract_assumptions(tasks_md)
  anomalies = result_4a.anomalies
  assumption_validity = validate_assumptions(assumptions, anomalies)
  # assumption_validity ∈ {PASS, WARNING, CRITICAL}

  # 综合判定
  if arch_drift == CRITICAL or assumption_validity == CRITICAL:
    gate_result = CRITICAL
  elif arch_drift == WARNING or assumption_validity == WARNING:
    gate_result = WARNING
  else:
    gate_result = PASS

  # 三策略行为决策
  decision = null
  if behavior == "always":
    decision = PAUSE    # 强制暂停，展示检查结果
  elif behavior == "auto":
    decision = AUTO_CONTINUE    # 仅记录日志
  elif behavior == "on_failure":
    if gate_result == CRITICAL:
      decision = PAUSE
    else:
      decision = AUTO_CONTINUE

  log("[GATE] GATE_IMPLEMENT_MID | policy={gate_policy} | override={有/无} | decision={decision} | reason={gate_result}")
  log("[GATE_DETAIL] architecture_drift={arch_drift} | assumption_validity={assumption_validity}")

  if decision == PAUSE:
    user_choice = prompt_user(
      "A) 修复后继续 | B) 强制继续 | C) 中止"
    )
    if user_choice == "C":
      abort_phase4()
      return

  # ─── 步骤 6: Phase 4b — 后半段实施 ───
  result_4b = call_implement_subagent(
    tasks_md, plan_md, spec_md,
    context_from_4a=result_4a.summary,
    gate_findings=gate_findings_if_any,
    instruction="继续执行 tasks.md 中剩余未完成的 top-level 任务"
  )

  return result_4b


function get_gate_behavior(gate_name, config):
  # 优先读取显式配置
  if config.gates[gate_name].pause exists:
    return config.gates[gate_name].pause

  # 否则按 gate_policy 应用默认值
  policy = config.gate_policy or "balanced"
  defaults = {
    "balanced":   "on_failure",
    "strict":     "always",
    "autonomous": "on_failure"
  }
  return defaults[policy]
```

---

## 4. 上下文连续性方案（Phase 4a → 4b）

### 4.1 问题分析

将 Phase 4 拆分为两次子代理调用后，Phase 4b 的子代理缺乏 Phase 4a 建立的代码理解上下文。技术调研中将此列为"高概率中影响"风险。

### 4.2 解决方案

采用**显式摘要注入**方式，通过 4b 的 prompt 追加指令将 4a 的执行结果传递给 4b：

| 传递项 | 来源 | 注入位置 |
|--------|------|----------|
| 已完成 task 编号/标题列表 | 4a 子代理返回 + tasks.md 中 `[x]` 标记 | 4b prompt 追加指令 |
| 变更文件列表 | 4a 子代理返回 | 4b prompt 追加指令 |
| 异常观察 | 4a 子代理返回 | 4b prompt 追加指令 |
| 门禁检查发现（若有） | GATE_IMPLEMENT_MID 检查结果 | 4b prompt 追加指令 |
| 用户决策（若门禁暂停） | 用户交互 | 4b prompt 追加指令 |

### 4.3 tasks.md 作为持久化进度源

tasks.md 中的 `[x]` checkbox 标记是跨子代理调用的持久化进度状态。Phase 4b 的子代理通过读取 tasks.md 即可确定哪些任务已完成、从何处继续。这与 implement 子代理的现有行为一致——它本身就依赖 tasks.md 的 checkbox 状态来追踪进度。

### 4.4 设计取舍

**不采用**的方案：
- 共享内存/文件缓存：违反 YAGNI，引入新的运行时依赖
- 单次子代理调用 + 内部 checkpoint：违反关注点分离，门禁决策应由编排器控制（见 tech-research.md 方案 2 分析）
- 完整代码 diff 传递：上下文窗口开销过大，且 4b 子代理可以自行 Read 相关文件

---

## 5. 门禁检查内容定义

### 5.1 检查项 A — 架构劣化信号

**目标**：检测已完成任务的代码变更是否偏离 plan.md 的预期范围。

**检查逻辑**：

```text
输入:
  - Phase 4a 的变更文件列表（文件路径 + 变更类型）
  - plan.md 中描述的变更范围/涉及模块/文件清单

检查规则:
  1. 提取 plan.md 中明确提及的目标文件/目录/模块
  2. 对比 4a 的变更文件列表:
     - 变更文件全部在 plan.md 预期范围内 → PASS
     - 出现少量 plan.md 未提及的辅助文件变更（如 package-lock.json、测试文件）→ WARNING
     - 出现 plan.md 未提及的核心模块/架构层文件变更 → CRITICAL
  3. 特别关注:
     - 新增了 plan.md 未预期的新文件/新模块
     - 修改了不属于本 feature 范围的共享基础设施
     - 删除了 plan.md 中仍需保留的文件
```

### 5.2 检查项 B — 前置假设验证

**目标**：检测 tasks.md 中的前置条件和依赖假设在实际实施中是否仍然成立。

**检查逻辑**：

```text
输入:
  - Phase 4a 子代理返回中的"异常观察"和"与预期不符的情况"
  - tasks.md 中剩余任务的前置条件（隐式或显式）

检查规则:
  1. 若 4a 子代理明确报告了"与预期不符"的异常:
     - 异常涉及剩余任务的前置条件 → CRITICAL
     - 异常仅涉及已完成任务的内部实现细节 → WARNING
     - 无异常报告 → PASS
  2. 基于 4a 变更文件和已完成任务，推断剩余任务的前置条件是否可能受影响:
     - 4a 修改了剩余任务依赖的接口/模块/文件 → WARNING
     - 4a 未触碰剩余任务的依赖路径 → PASS
```

### 5.3 检查范围约束

根据 NFR-004，GATE_IMPLEMENT_MID 的检查**严格限制**为上述两项信号扫描：
- 不做全量代码分析或 AST 解析
- 不做性能评估
- 不做安全扫描
- 不做测试运行或构建验证

这些是 Phase 5 Verification 的职责。GATE_IMPLEMENT_MID 是"早期预警"而非"完整验证"。

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|---------|
| **子代理二次调用的上下文丢失** | 高 | 中 | 4b 的 prompt 注入 4a 执行摘要（已完成 task 列表 + 变更文件 + 异常观察）；tasks.md `[x]` 标记作为持久化进度源（见第 4 节） |
| **50% 触发点不精准** | 中 | 低 | Phase 5 仍执行完整三层验证（spec-review + quality-review + verify），GATE_IMPLEMENT_MID 是额外早期预警而非唯一防线 |
| **门禁检查误判** | 中 | 中 | 检查聚焦"结构性信号"（文件路径对比 plan、异常报告检查）而非"代码正确性判断"，降低对 LLM 判断力的依赖 |
| **用户体验退化** | 中 | 高 | <=5 tasks 自动跳过；balanced 默认 on_failure（无问题自动继续）；只有 strict 策略才强制暂停 |
| **tasks.md 格式解析不稳定** | 低 | 低 | 使用简单正则（行首 `- [ ]` / `- [x]`）；解析失败则跳过门禁并记录 warning，不阻断流程 |
| **修改破坏现有 SKILL.md 结构** | 低 | 高 | 全部为追加型修改；Phase 4 拆分使用条件分支（gate_mid_enabled = false 时走原有逻辑）；实施后运行 `npm run repo:check` 验证 |

---

## 7. 编码风格

- **注释语言**：中文（与现有 SKILL.md 保持一致）
- **标识符语言**：英文（`gate_mid_enabled`、`mid_point`、`total_tasks`、`GATE_IMPLEMENT_MID`）
- **文档格式**：Markdown Prompt 格式，使用 ` ```text ``` ` 代码块包裹伪代码逻辑
- **日志格式**：与现有门禁一致的 `[GATE]` 前缀格式
- **新增内容标记**：不添加额外的 Feature 090 标记或来源注释——追加的内容应与现有内容浑然一体

---

## 8. 验证计划

实施完成后执行以下验证：

1. **结构完整性**：确认 implement SKILL.md 的 Phase 4 包含完整的三段结构（4a / GATE / 4b）
2. **门禁配置一致性**：确认 implement SKILL.md 和 feature SKILL.md 的 Step 4 门禁子集都包含 GATE_IMPLEMENT_MID
3. **行为表正确性**：确认 balanced 下 GATE_IMPLEMENT_MID 默认 `on_failure`，strict 下 `always`，autonomous 下 `on_failure`
4. **注释风格一致性**：确认 spec-driver.config.yaml 的新注释与现有注释块风格一致
5. **仓库校验**：运行 `npm run repo:check` 确保全部 pass
6. **向后兼容**：确认 <=5 tasks 场景下 Phase 4 行为与修改前完全一致
