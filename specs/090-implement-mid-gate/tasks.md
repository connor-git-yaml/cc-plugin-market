---
feature: 090-implement-mid-gate
total_tasks: 7
estimated_effort: small
---

# Tasks: 实现中期门禁（GATE_IMPLEMENT_MID）

## Phase: Setup

- [ ] T-001: 在 implement SKILL.md 的 Step 4 门禁配置加载中追加 GATE_IMPLEMENT_MID [US1, US3]
  - 文件: `plugins/spec-driver/skills/spec-driver-implement/SKILL.md`
  - 变更位置: 初始化阶段 Step 4（约第 106-132 行），门禁子集声明和行为表
  - 具体操作:
    1. 门禁子集从 `GATE_TASKS, GATE_VERIFY` 改为 `GATE_TASKS, GATE_IMPLEMENT_MID, GATE_VERIFY`
    2. 构建行为表的 for 循环追加 `GATE_IMPLEMENT_MID`
    3. balanced 默认值表追加行: `GATE_IMPLEMENT_MID | on_failure | 非关键（仅异常时暂停）`
    4. strict / autonomous 的全覆盖描述无需改动（"全部 always" / "全部 on_failure" 已隐式包含新门禁）
  - 验收: implement SKILL.md Step 4 的门禁子集包含 GATE_IMPLEMENT_MID，balanced 行为表有对应行且默认值为 `on_failure`

- [ ] T-002: 在 feature SKILL.md 的 Step 4 门禁配置加载中追加 GATE_IMPLEMENT_MID [US1, US3]
  - 文件: `plugins/spec-driver/skills/spec-driver-feature/SKILL.md`
  - 变更位置: 初始化阶段 Step 4（约第 117-138 行），门禁子集声明和行为表
  - 具体操作:
    1. 门禁子集从 5 个扩展为 6 个，在 GATE_TASKS 和 GATE_VERIFY 之间插入 GATE_IMPLEMENT_MID
    2. 构建行为表的 for 循环追加 GATE_IMPLEMENT_MID
    3. balanced 默认值表在 GATE_TASKS 和 GATE_VERIFY 之间插入行: `GATE_IMPLEMENT_MID | on_failure | 非关键（仅异常时暂停）`
  - 验收: feature SKILL.md Step 4 的门禁子集包含 6 个门禁（含 GATE_IMPLEMENT_MID），balanced 行为表有对应行且默认值为 `on_failure`，GATE_DESIGN 硬门禁注释保持不变

## Phase: Core Implementation

- [ ] T-003: 在 implement SKILL.md 的 Phase 4 中插入 GATE_IMPLEMENT_MID 前置计算逻辑 [US1, US2]
  - 文件: `plugins/spec-driver/skills/spec-driver-implement/SKILL.md`
  - 变更位置: Phase 4: Implementation 标题下方，现有子代理调用之前
  - 具体操作:
    1. 在 Phase 4 标题和进度提示之后，插入 `#### GATE_IMPLEMENT_MID 前置计算` 小节
    2. 包含 top-level task 行正则解析伪代码（匹配行首 0-3 空格 + `- [ ]` / `- [x]` / `- [X]`）
    3. 包含三路判断: tasks_unparseable → 跳过; total_tasks <= 5 → 跳过; else → 启用并计算 mid_point = floor(total_tasks * 0.5)
    4. 每个分支输出对应的 `[GATE]` 日志行
  - 验收: Phase 4 包含前置计算代码块，覆盖 EC-001（解析失败跳过）、EC-004（边界值 0/1/5/6）、EC-005（仅计数 top-level）、EC-006（基于全量 task 数）

- [ ] T-004: 在 implement SKILL.md 的 Phase 4 中实现分支 A（跳过门禁）和分支 B 三段结构 [US1, US2]
  - 文件: `plugins/spec-driver/skills/spec-driver-implement/SKILL.md`
  - 变更位置: T-003 前置计算逻辑之后，替换/包裹原有单次子代理调用
  - 具体操作:
    1. 插入 `#### 分支 A: 跳过门禁（gate_mid_enabled = false）` — 保留原有完整 Phase 4 逻辑不变
    2. 插入 `#### 分支 B: 触发门禁（gate_mid_enabled = true）` — 包含三段结构:
       - `##### Phase 4a: 前半段实施` — 子代理调用 + 4a 追加指令（限定执行前 mid_point 个任务 + 要求返回中期进度报告）
       - `##### GATE_IMPLEMENT_MID: 中期门禁` — 编排器亲自执行的检查逻辑（架构劣化信号 + 前置假设验证 + 综合判定 + 行为决策 + 日志输出）
       - `##### Phase 4b: 后半段实施` — 子代理调用 + 4b 追加指令（注入 4a 摘要 + 门禁发现 + 用户决策）
    3. Phase 4a 失败时直接标记 Phase 4 FAILED，不进入门禁（EC-008）
  - 验收:
    - Phase 4 包含完整条件分支结构（分支 A + 分支 B）
    - 分支 B 包含 Phase 4a / GATE_IMPLEMENT_MID / Phase 4b 三段
    - 门禁由编排器亲自执行，不委派子代理（FR-009）
    - 4a prompt 包含"仅执行前 N 个任务"指令和中期进度报告要求（FR-010）
    - 4b prompt 包含 4a 执行摘要注入（FR-011）
    - 门禁输出格式与现有门禁日志一致（FR-012）
    - 门禁检查内容限定为架构劣化 + 假设验证两项（NFR-004）

## Phase: Configuration

- [ ] T-005: 在 spec-driver.config.yaml 的 gates 注释块中追加 GATE_IMPLEMENT_MID 示例 [US3]
  - 文件: `spec-driver.config.yaml`
  - 变更位置: `gates` 注释块中 `GATE_TASKS` 和 `GATE_VERIFY` 之间（约第 93-106 行）
  - 具体操作:
    1. 在 `#   GATE_TASKS:` / `#     pause: always` 之后插入两行注释:
       ```
       #   GATE_IMPLEMENT_MID:
       #     pause: on_failure    # 实施中期门禁（>5 tasks 时在 50% 处触发）
       ```
    2. 保持与现有注释块的缩进和风格完全一致
  - 验收: gates 注释块包含 GATE_IMPLEMENT_MID 示例，位于 GATE_TASKS 和 GATE_VERIFY 之间，行内注释说明了触发条件

## Phase: Verification

- [ ] T-006: 验证三个文件的变更完整性和一致性 [US1, US2, US3]
  - 文件: 三个目标文件（只读验证）
  - 验证项:
    1. implement SKILL.md: Phase 4 包含完整三段结构（SC-001），Step 4 门禁子集含 GATE_IMPLEMENT_MID（SC-003），balanced 下 GATE_IMPLEMENT_MID 默认 `on_failure`（SC-003）
    2. feature SKILL.md: Step 4 门禁子集含 GATE_IMPLEMENT_MID（SC-004），balanced 行为表有对应行（SC-004）
    3. spec-driver.config.yaml: gates 注释块含 GATE_IMPLEMENT_MID 示例（SC-002）
    4. <=5 tasks 跳过逻辑存在且输出 SKIPPED 日志（SC-005）
    5. 向后兼容: 分支 A（跳过门禁时）的逻辑与修改前的 Phase 4 完全一致（NFR-001）
    6. 新增内容与现有内容风格一致，无 Feature 090 标记或来源注释（plan.md 第 7 节编码风格要求）
  - 验收: 全部 6 项验证通过

- [ ] T-007: 运行 `npm run repo:check` 确保仓库校验全部通过 [US1, US2, US3]
  - 验证项: 执行 `npm run repo:check`，确认全部检查 pass（SC-006）
  - 验收: `npm run repo:check` 输出无 FAIL / ERROR
