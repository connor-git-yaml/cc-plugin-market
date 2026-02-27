# 深度需求质量检查表: 借鉴 Superpowers 行为约束模式与增强人工控制权

**Purpose**: 对 spec.md 进行深度质量审查，检验需求文档本身的质量（非实现验证）
**Created**: 2026-02-27
**Feature**: [spec.md](../spec.md)
**Reviewer**: 质量检查表子代理
**前置制品**: requirements.md（基础检查，全部通过）

---

## 1. 需求完整性 (Requirement Completeness)

### 功能需求覆盖

- [x] **RC-01**: 每个 User Story 至少有一条对应的 FR（US-1 → FR-001~004, US-2 → FR-010~013, US-3 → FR-005~009, US-4 → FR-014~016, US-5 → FR-016~018, US-6 → FR-019~022）
  - **Ref**: Requirements 章节 FR 编号与 User Story 交叉引用
- [x] **RC-02**: Edge Case 均有对应的处理说明（7 个 Edge Case 覆盖验证超时、共存、中途策略切换、审查矛盾、autonomous 回溯、无效配置、硬门禁超时）
  - **Ref**: Edge Cases 章节
- [ ] **RC-03**: GATE_ANALYSIS 门禁的来源和定义缺失。FR-010 将其列为非关键门禁，但 Key Entities 的门禁列表仅提到"GATE_RESEARCH、GATE_TASKS、GATE_VERIFY，新增 GATE_DESIGN"，未包含 GATE_ANALYSIS。该门禁是现有还是新增？
  - **Ref**: FR-010 vs Key Entities "质量门" 定义 [Gap]
- [x] **RC-04**: 所有 MUST 级 FR（20 条）均有对应的验收场景覆盖
  - **Ref**: User Scenarios 各 Acceptance Scenarios
- [x] **RC-05**: 所有 SHOULD 级 FR（2 条：FR-004、FR-009）已标注为非强制
  - **Ref**: FR-004, FR-009

### 非功能需求覆盖

- [x] **RC-06**: 向后兼容性已覆盖（FR-019, FR-011, SC-006, US-6）
  - **Ref**: FR-019, SC-006
- [x] **RC-07**: 零依赖约束已定义（FR-022）
  - **Ref**: FR-022
- [x] **RC-08**: 本特性以 Markdown prompt 工程为主，性能和安全需求不适用（已确认无需额外关注）
  - **Ref**: 特性性质判断

---

## 2. 需求清晰度 (Requirement Clarity)

### 术语定义

- [x] **CL-01**: 核心术语在 Key Entities 中有定义（门禁策略、质量门、验证证据、Spec 合规审查报告、代码质量审查报告）
  - **Ref**: Key Entities 章节
- [ ] **CL-02**: "新鲜验证证据"的精确判定标准未定义。FR-001 和 FR-002 要求"在当前执行上下文中实际运行"和"新鲜验证证据"，但"新鲜"的含义不明确——是指当前会话内、当前任务内、还是某个时间窗口内？这直接影响 FR-002 的可操作性
  - **Ref**: FR-001, FR-002, Key Entities "验证证据" [Gap]
- [x] **CL-03**: 三级门禁策略的行为语义有明确定义（strict=全部暂停, balanced=关键暂停, autonomous=仅失败暂停）
  - **Ref**: FR-010
- [x] **CL-04**: 门禁级配置的优先级规则明确（门禁级 > 全局策略）
  - **Ref**: FR-012

### 行为语义

- [x] **CL-05**: balanced 模式下关键/非关键门禁的具体列表已通过 Clarification 明确（GATE_DESIGN/TASKS/VERIFY 为关键，GATE_RESEARCH/ANALYSIS 为非关键）
  - **Ref**: FR-010 [AUTO-CLARIFIED]
- [ ] **CL-06**: autonomous 模式下"仅失败或 CRITICAL 问题时暂停"的判定标准不够精确。"失败"是指验证命令返回非零退出码？"CRITICAL 问题"是指 FR-008 中的 CRITICAL 级别？这两个条件的触发源（验证命令 vs 审查报告）需要明确区分
  - **Ref**: FR-010, FR-008 [Gap]
- [x] **CL-07**: 设计硬门禁的暂停行为清晰——展示 spec 摘要，等待明确批准（US-4 Scenario 1）
  - **Ref**: US-4 Acceptance Scenario 1

---

## 3. 需求一致性 (Requirement Consistency)

### 内部一致性

- [ ] **CO-01**: FR-015（"设计门禁不受 autonomous 策略影响，不可绕过"）与 FR-017（"设计门禁在 story/fix 模式下默认豁免"）之间存在表述歧义。"不可绕过"的约束范围需要限定——是"不可被门禁策略配置绕过"但"可以被运行模式影响"？当前措辞可能导致读者认为 FR-015 与 FR-017 矛盾
  - **Ref**: FR-015 vs FR-017
- [ ] **CO-02**: FR-012 允许用户对每个门禁进行独立配置（gates.GATE_DESIGN.pause = auto），而 FR-015 声明设计门禁不可绕过。如果用户在 feature 模式下配置 `gates.GATE_DESIGN.pause: auto`，系统应如何处理？是忽略该配置、输出警告、还是报错？spec 未明确说明门禁级配置与硬门禁的优先级关系
  - **Ref**: FR-012 vs FR-015 [Gap]
- [x] **CO-03**: FR-011（balanced 为默认值）与 FR-019（向后兼容）和 SC-006（零破坏性变更）三者一致
  - **Ref**: FR-011, FR-019, SC-006
- [x] **CO-04**: 门禁配置结构（gate_policy + gates 两个顶层字段）满足 SC-008（不超过 3 个顶层配置项）
  - **Ref**: FR-012, SC-008

### Key Entities 与 FR 一致性

- [ ] **CO-05**: Key Entities "质量门"定义中门禁列表不完整。列出了"GATE_RESEARCH、GATE_TASKS、GATE_VERIFY，新增 GATE_DESIGN"共 4 个，但 FR-010 中还引用了 GATE_ANALYSIS，总计应为 5 个门禁。Key Entities 需补充 GATE_ANALYSIS 或明确其来源
  - **Ref**: Key Entities "质量门" vs FR-010 [Gap]

---

## 4. 验收标准质量 (Acceptance Criteria Quality)

### Given-When-Then 结构

- [x] **AC-01**: 所有 23 个验收场景使用标准 Given-When-Then 格式，结构清晰
  - **Ref**: US-1 至 US-6 Acceptance Scenarios
- [x] **AC-02**: 每个场景仅测试一个行为（单一职责），无复合断言
  - **Ref**: 全部 Acceptance Scenarios

### 可测试性

- [x] **AC-03**: US-1（验证铁律）场景可通过检查输出中是否包含实际命令执行记录来验证
  - **Ref**: US-1 Independent Test
- [x] **AC-04**: US-2（门禁粒度）场景可通过计算暂停次数来量化验证
  - **Ref**: US-2 Independent Test
- [x] **AC-05**: US-4（设计硬门禁）场景可通过三种策略下运行来交叉验证
  - **Ref**: US-4 Independent Test
- [ ] **AC-06**: US-1 Scenario 2 中"系统检测到缺少新鲜验证证据"的检测机制不够具体。是编排器检测还是 verify 子代理检测？检测时机是在子代理返回时还是在门禁评估时？这影响验收测试的设计
  - **Ref**: US-1 Acceptance Scenario 2 [Gap]

---

## 5. 场景覆盖 (Scenario Coverage)

### 主要流程

- [x] **SC-C01**: 三种门禁策略的正常流程均有场景覆盖（US-2 Scenarios 1-4）
  - **Ref**: US-2 Acceptance Scenarios
- [x] **SC-C02**: 双阶段审查的正常流程有场景覆盖（US-3 Scenarios 1-4）
  - **Ref**: US-3 Acceptance Scenarios
- [x] **SC-C03**: 设计硬门禁在 feature/story/fix 三种模式下的行为均有场景覆盖（US-4 + US-5）
  - **Ref**: US-4, US-5 Acceptance Scenarios

### 异常/边界流程

- [x] **SC-C04**: 验证命令超时/异常退出场景已覆盖
  - **Ref**: Edge Cases 第 1 条
- [x] **SC-C05**: 中途策略切换场景已覆盖
  - **Ref**: Edge Cases 第 3 条
- [x] **SC-C06**: 审查结论矛盾场景已覆盖，明确以 Spec 合规审查为准
  - **Ref**: Edge Cases 第 4 条
- [x] **SC-C07**: 无效配置场景已覆盖（忽略 + 警告）
  - **Ref**: Edge Cases 第 6 条
- [ ] **SC-C08**: 缺少"项目无测试/构建命令但有 Lint"场景。US-1 Scenario 4 仅覆盖了"纯文档项目（无任何验证工具）"，但未覆盖"有部分验证工具但不全"的场景（如有 Lint 但无测试）。验证铁律在这种情况下应如何判定"通过"？
  - **Ref**: US-1 Acceptance Scenario 4 [Gap]

---

## 6. 边界条件 (Boundary Conditions)

- [x] **BC-01**: 空配置/默认值场景已覆盖（US-2 Scenario 4, US-6 Scenario 1）
  - **Ref**: US-2, US-6
- [x] **BC-02**: 用户长时间未响应硬门禁的行为已定义（保持暂停，不超时）
  - **Ref**: Edge Cases 第 7 条
- [x] **BC-03**: Superpowers 共存场景已定义（独立运行不冲突）
  - **Ref**: Edge Cases 第 2 条 [AUTO-RESOLVED]
- [x] **BC-04**: autonomous 模式连续自动通过后最终验证失败的回溯场景已覆盖
  - **Ref**: Edge Cases 第 5 条
- [x] **BC-05**: 配置文件中无法识别的字段名处理已定义（忽略 + 警告）
  - **Ref**: FR-021, Edge Cases 第 6 条

---

## 7. 依赖与假设 (Dependencies & Assumptions)

- [x] **DA-01**: 对 Claude Code 原生能力的依赖已识别（Task tool, Hooks API, EnterWorktree）
  - **Ref**: research-synthesis.md 技术可行性章节
- [x] **DA-02**: 零新增运行时依赖约束已声明（FR-022）
  - **Ref**: FR-022
- [x] **DA-03**: Prompt 遵从性上限风险已在调研报告中识别并有缓解措施
  - **Ref**: research-synthesis.md 风险评估 #1
- [x] **DA-04**: 跨平台限制（Windows 非 WSL）已在调研报告中标注为二期
  - **Ref**: research-synthesis.md 约束与限制

---

## 8. 内容质量特别审查 (Content Quality Deep Review)

### 实现细节泄漏检查

- [ ] **CQ-01**: Key Entities "验证证据"描述中包含实现细节——"MVP 第一批通过 Prompt 层实现（在 implement.md 和 verify.md 中植入约束文本...）, Hooks 层（PreToolUse/PostToolUse + 结构化 verification-evidence.json）作为 MVP 第二批增强"。这些是实现方案而非需求定义，应从 spec.md 中移除或移至 plan.md
  - **Ref**: Key Entities "验证证据" 段落
- [ ] **CQ-02**: Key Entities "Spec 合规审查报告"描述中包含实现细节——"由新增的 spec-review.md 子代理生成（演化自现有 verify.md 的 Layer 1 Spec-Code 对齐验证...）"。子代理文件名和演化路径属于实现层面
  - **Ref**: Key Entities "Spec 合规审查报告" 段落
- [ ] **CQ-03**: Key Entities "代码质量审查报告"描述中包含实现细节——"由新增的 quality-review.md 子代理生成。编排器在 Phase 7 中依次（或并行）调用 spec-review 和 quality-review"。编排器的调用方式属于实现层面
  - **Ref**: Key Entities "代码质量审查报告" 段落

### 自动决策标记

- [x] **CQ-04**: 无 [NEEDS CLARIFICATION] 标记残留
  - **Ref**: 全文搜索确认
- [ ] **CQ-05**: [AUTO-CLARIFIED] 标记有 4 处（FR-010, FR-012, Key Entities "验证证据", Key Entities "Spec 合规审查报告"），[AUTO-RESOLVED] 有 2 处（US-5 Scenario 3, Edge Case 第 2 条），合计 6 处自动决策。已有的 requirements.md 仅统计了 2 处 AUTO-RESOLVED 而遗漏了 4 处 AUTO-CLARIFIED。虽然每处自动决策都有理由说明，但总量偏多（6 处），建议审查是否所有自动决策的理由都充分
  - **Ref**: 全文 [AUTO-CLARIFIED] 和 [AUTO-RESOLVED] 标记

---

## 检查结果汇总

| 维度 | 总项数 | 通过 | 未通过 | 通过率 |
|------|--------|------|--------|--------|
| 1. 需求完整性 | 8 | 7 | 1 | 87.5% |
| 2. 需求清晰度 | 7 | 5 | 2 | 71.4% |
| 3. 需求一致性 | 5 | 2 | 3 | 40.0% |
| 4. 验收标准质量 | 6 | 5 | 1 | 83.3% |
| 5. 场景覆盖 | 8 | 7 | 1 | 87.5% |
| 6. 边界条件 | 5 | 5 | 0 | 100% |
| 7. 依赖与假设 | 4 | 4 | 0 | 100% |
| 8. 内容质量特别审查 | 5 | 1 | 4 | 20.0% |
| **总计** | **48** | **36** | **12** | **75.0%** |

---

## 未通过项详细清单

### CRITICAL（阻断性问题——影响需求可执行性）

| # | 检查项 | 问题描述 | 修复建议 |
|---|--------|---------|---------|
| 1 | CO-01 | FR-015"不可绕过"与 FR-017"story/fix 模式豁免"之间存在表述矛盾。读者无法确定"不可绕过"的约束范围 | 修改 FR-015 措辞为"设计门禁不受 gate_policy 策略配置影响"，明确"不可绕过"仅指策略维度，模式维度的豁免由 FR-017 独立控制 |
| 2 | CO-02 | 门禁级配置（gates.GATE_DESIGN.pause）与硬门禁约束的优先级关系未定义。用户可能通过 gates 配置意外绕过硬门禁 | 新增 FR 或在 FR-015 中补充：在 feature 模式下，GATE_DESIGN 的门禁级配置被忽略（或仅限 story/fix 模式下生效），并输出警告 |
| 3 | CL-02 | "新鲜验证证据"缺少精确判定标准，导致 FR-001/FR-002 的可操作性不足 | 在 Key Entities "验证证据"中补充"新鲜"的定义：指在当前任务的当前实现迭代中产生的验证输出（非来自先前迭代或缓存结果） |

### WARNING（重要问题——影响需求质量但不阻断）

| # | 检查项 | 问题描述 | 修复建议 |
|---|--------|---------|---------|
| 4 | RC-03 | GATE_ANALYSIS 在 FR-010 中被引用但在 Key Entities 门禁列表中缺失 | 在 Key Entities "质量门"定义中补充 GATE_ANALYSIS，说明其是现有门禁还是新增 |
| 5 | CO-05 | Key Entities 门禁列表与 FR-010 的门禁枚举不一致（4 vs 5 个） | 同上，确保 Key Entities 与 FR 的门禁枚举一致 |
| 6 | CL-06 | autonomous 模式下"失败"和"CRITICAL 问题"的触发条件和来源不够精确 | 补充说明："失败"指验证命令非零退出码，"CRITICAL 问题"指 FR-008 中 CRITICAL 级别的审查发现 |
| 7 | CQ-01/02/03 | Key Entities 中 3 个实体描述包含实现细节（Prompt 层/Hooks 层、子代理文件名、编排器 Phase 7 调用方式） | 将实现细节从 Key Entities 移至 Clarifications 或 plan.md，Key Entities 仅保留实体的业务定义 |
| 8 | AC-06 | US-1 Scenario 2 的检测机制和检测时机不够具体 | 在 Scenario 2 中补充检测的触发时机（如"当子代理返回完成状态时"） |

### INFO（建议改进——不影响可执行性）

| # | 检查项 | 问题描述 | 修复建议 |
|---|--------|---------|---------|
| 9 | SC-C08 | 缺少"部分验证工具可用"的场景（如有 Lint 但无测试） | 在 Edge Cases 中补充：当项目仅有部分验证工具时，系统运行可用的验证工具，在报告中标注不可用的工具类型 |
| 10 | CQ-05 | 自动决策标记合计 6 处（4 AUTO-CLARIFIED + 2 AUTO-RESOLVED），已有 requirements.md 仅统计了 2 处 | 建议审查所有 6 处自动决策是否都有充分理由，确认无遗漏的用户确认需求 |

---

## 特别关注项审查结论

### 1. 门禁策略三级行为语义是否明确定义

**结论: 基本明确，有一处精确度不足**

- strict 和 balanced 的行为语义清晰（FR-010 + Clarification #1 明确了关键/非关键门禁列表）
- autonomous 模式的"仅失败或 CRITICAL 问题时暂停"的触发条件和来源需要更精确的定义（CL-06）

### 2. 双阶段审查的职责边界是否清晰

**结论: 清晰**

- Spec 合规审查（逐条检查 FR 状态）和代码质量审查（设计/安全/性能/可维护性四维度）的职责划分清晰无重叠（FR-005~009）
- 与现有 verify 阶段的关系已通过 Clarification #3 明确（内部重构而非替换）

### 3. 验证铁律的判定标准是否可操作

**结论: 部分可操作，"新鲜"定义缺失**

- FR-001/FR-002 的行为描述清晰（必须实际运行验证命令，拒绝推测性表述）
- 但"新鲜验证证据"缺少精确的时效性定义（CL-02），影响实际判定的可操作性

### 4. 设计硬门禁的触发条件和豁免规则是否一致

**结论: 存在矛盾，需要修复**

- FR-015 的"不可绕过"与 FR-017 的"模式豁免"存在表述层面的矛盾（CO-01）
- 门禁级配置与硬门禁的优先级关系未定义（CO-02）
- 这是本次检查发现的最关键问题，直接影响实现方向

### 5. 成功标准是否可测量

**结论: 基本可测量**

- SC-001（90%）、SC-003~SC-008 均有可观测的行为指标
- SC-001 的"90%"量化基准的测量方法未定义，但在需求规范阶段可接受，留给测试阶段细化
- SC-002 的"独立捕获"通过检查两份独立报告的存在性可验证

### 6. 实现细节泄漏

**结论: 存在泄漏，需要清理**

- Key Entities 中 3 个实体描述包含 Prompt 层/Hooks 层实现路径、子代理文件名、编排器调用方式等实现细节（CQ-01/02/03）
- 这些内容应移至 plan.md 或 Clarifications 备注
