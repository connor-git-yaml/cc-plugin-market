# Feature Specification: 借鉴 Superpowers 行为约束模式与增强人工控制权

**Feature Branch**: `017-adopt-superpowers-patterns`
**Created**: 2026-02-27
**Status**: Draft
**Input**: 调研 superpowers 与 Spec Driver 的差异，吸取 superpowers 的优势点，增强门禁的人工控制权

## User Scenarios & Testing

### User Story 1 - 验证铁律：杜绝未验证的完成声明 (Priority: P1)

质量工程师 Jordan 使用 Spec Driver 编排一个支付退款功能的开发。实现阶段完成后，系统不再接受"测试应该能通过""代码看起来正确"等模糊声明作为完成依据。系统要求实现子代理必须在当前执行上下文中实际运行验证命令（构建、测试、Lint 等），并将运行结果作为完成的必要证据。如果子代理尝试在没有新鲜验证证据的情况下声称完成，系统会拒绝该声明并要求补充验证。

**Why this priority**: 这是投入产出比最高的改进——"AI 未验证就声称完成"是当前用户反馈最强烈的质量痛点。Superpowers 的 verification-before-completion 机制直接源自真实的失败教训（创始人 24 次因未验证而浪费时间的记忆）。解决这个问题能显著提升 Spec Driver 产出代码的可信度。

**Independent Test**: 在一个有构建和测试命令的项目中启动 Spec Driver 完整流程，观察实现阶段完成时是否包含实际运行的验证命令输出（而非推测性的"should pass"表述）。可通过检查验证报告中是否包含带时间戳的验证命令执行记录来确认。

**Acceptance Scenarios**:

1. **Given** 实现子代理完成了代码编写, **When** 子代理声称任务完成, **Then** 系统要求其在当前执行上下文中运行验证命令（构建、测试、Lint），并将命令输出作为完成证据
2. **Given** 实现子代理尝试使用"should pass""looks correct"等推测性表述声称完成, **When** 系统检测到缺少新鲜验证证据, **Then** 系统拒绝该完成声明，要求补充实际验证
3. **Given** 验证命令执行失败（如测试不通过）, **When** 子代理报告完成状态, **Then** 系统要求子代理先修复问题并重新验证通过后才能标记为完成
4. **Given** 项目未配置验证命令（如纯文档项目）, **When** 子代理完成任务, **Then** 系统允许完成但在报告中标注"无可用验证工具"，不阻断流程

---

### User Story 2 - 门禁粒度增强：三级策略满足不同场景 (Priority: P1)

技术负责人 Alex 带领团队同时开发多个功能。对于核心支付模块，他希望每个质量门都暂停等待人工确认；对于 UI 调整类的小改动，他希望尽量自动化减少打断。独立开发者 Sam 在快速原型阶段希望接近全自动运行，但在提交前保留关键验证。系统提供三级门禁策略——严格模式（所有门禁暂停）、平衡模式（关键门禁暂停）、自主模式（仅失败时暂停），用户通过一个配置项即可切换。每个门禁也支持独立配置，满足高级用户的精细控制需求。

**Why this priority**: 门禁粒度不可配置是三个核心用户角色（Tech Lead、Solo Dev、Quality Engineer）共同的痛点。当前 Spec Driver 的质量门要么全开要么全关，缺少中间态。Superpowers 的门禁虽然强大但固定不可配置，这恰好是 Spec Driver 可以超越的差异化机会。

**Independent Test**: 分别使用三种策略配置运行同一个功能开发流程，验证每种策略下的门禁暂停行为是否符合预期。可通过计算每种策略下实际暂停的次数来量化差异。

**Acceptance Scenarios**:

1. **Given** 用户在配置中设置门禁策略为 strict, **When** 流程经过任意质量门, **Then** 系统暂停并等待用户确认后才继续
2. **Given** 用户在配置中设置门禁策略为 balanced（默认值）, **When** 流程经过关键质量门（设计门、任务门、验证门）, **Then** 系统暂停等待确认；经过非关键门时自动继续
3. **Given** 用户在配置中设置门禁策略为 autonomous, **When** 流程经过质量门且结果为通过, **Then** 系统自动继续不暂停；仅在检测到失败或 CRITICAL 问题时暂停
4. **Given** 用户未配置门禁策略, **When** 首次运行流程, **Then** 系统使用 balanced 作为默认策略，行为与当前版本一致，保持向后兼容
5. **Given** 用户对某个特定门禁进行了独立配置（如"研究门始终自动继续"）, **When** 流程经过该门禁, **Then** 独立配置优先于全局策略生效

---

### User Story 3 - 双阶段代码审查：Spec 合规 + 代码质量分离 (Priority: P1)

质量工程师 Jordan 在使用 Spec Driver 时发现，当前的单层验证将"是否符合需求规范"和"代码质量是否合格"混在一起检查，容易遗漏问题。借鉴 Superpowers 的双阶段审查模式，系统将验证拆分为两个独立阶段：第一阶段逐条检查功能需求（FR）是否被正确实现、是否存在过度实现或遗漏；第二阶段独立评估代码设计模式、安全性、性能和可维护性。两个阶段各自输出独立的审查报告，问题定位更精准、修复指引更明确。

**Why this priority**: 双阶段代码审查是 Superpowers 最受认可的质量机制之一，也是 Spec Driver 与竞品相比最大的能力差距。将验证拆分为两个正交维度（规范合规性 vs 代码质量）可以在早期独立捕获两类不同性质的问题，避免因审查焦点混合而导致遗漏。

**Independent Test**: 在一个有明确 spec.md 的项目中运行完整流程，验证阶段输出两份独立报告——一份列出每条 FR 的合规状态（通过/偏差/遗漏/过度实现），另一份列出代码质量评估结果（设计模式、安全性、性能、可维护性）。

**Acceptance Scenarios**:

1. **Given** 实现阶段完成, **When** 进入验证阶段, **Then** 系统先执行 Spec 合规审查（逐条检查 FR 实现状态），再执行代码质量审查（评估设计、安全、性能、可维护性）
2. **Given** Spec 合规审查发现某条 FR 未被实现, **When** 审查报告生成, **Then** 报告明确标注遗漏的 FR 编号和缺失描述，便于定位补充实现
3. **Given** 代码质量审查发现安全性问题（如硬编码密钥）, **When** 审查报告生成, **Then** 报告标注问题级别（CRITICAL/WARNING/INFO）、位置和修复建议
4. **Given** 用户使用 autonomous 门禁策略, **When** 两项审查均无 CRITICAL 问题, **Then** 系统自动继续不暂停；任一审查发现 CRITICAL 问题则暂停等待用户决策

---

### User Story 4 - 设计硬门禁：规范未批准禁止实现 (Priority: P1)

技术负责人 Alex 在团队协作中发现，AI 有时在设计方案未经确认的情况下就开始编写代码，导致返工浪费。系统在需求规范（spec.md）阶段完成后增加一道不可绕过的硬门禁：无论用户选择哪种门禁策略（包括 autonomous 模式），都必须暂停等待用户明确批准设计方案后才能进入规划和实现阶段。这借鉴了 Superpowers 的核心理念——"每个项目都需要设计审批，包括'看起来太简单'的项目"。

**Why this priority**: 设计硬门禁体现了 Superpowers 最核心的"行为约束"理念。在所有门禁中，设计审批是唯一应该"永远不可跳过"的环节——因为一旦在错误的设计方向上实现代码，纠正成本远高于在设计阶段花几分钟确认。这是对"自动化"和"人工控制"之间最关键的平衡点。

**Independent Test**: 分别在 strict、balanced、autonomous 三种策略下运行流程，验证 spec.md 生成后系统均暂停等待用户确认，不会自动跳过进入 plan 阶段。

**Acceptance Scenarios**:

1. **Given** 需求规范（spec.md）生成完成, **When** 流程到达设计门禁, **Then** 系统暂停并向用户展示 spec 摘要，等待明确批准
2. **Given** 用户门禁策略为 autonomous, **When** 流程到达设计门禁, **Then** 系统仍然暂停（设计门禁不受 autonomous 策略影响，不可跳过）
3. **Given** 用户查看 spec 后提出修改意见, **When** 用户要求调整, **Then** 系统重新执行规范阶段并再次暂停等待批准
4. **Given** 用户明确批准 spec, **When** 系统收到批准信号, **Then** 流程继续进入规划阶段

---

### User Story 5 - Story 模式差异化：设计硬门禁的智能豁免 (Priority: P2)

独立开发者 Sam 使用 story 模式处理一个"给用户列表添加分页功能"的快速需求。Story 模式的设计初衷是跳过调研、减少中断、快速交付。如果设计硬门禁在 story 模式中也强制暂停，会破坏 story 模式的快速流程体验。系统默认在 story 模式中豁免设计硬门禁（因为 story 模式面向的是小范围、低风险的增量需求），但在 feature 模式中始终启用。用户可通过配置覆盖此默认行为。

**Why this priority**: 调研结论明确指出"Story 模式体验退化"是中等概率、中等影响的产品风险。Story 模式的核心价值在于速度和低中断，如果设计硬门禁无差别应用，会使 story 模式退化为 feature 模式的简化版，失去其独特价值。

**Independent Test**: 分别在 feature 模式和 story 模式下运行同一个需求，验证 feature 模式在 spec.md 后暂停、story 模式默认不暂停。然后通过配置启用 story 模式的设计门禁，验证配置生效。

**Acceptance Scenarios**:

1. **Given** 用户使用 feature 模式（run 命令）运行流程, **When** spec.md 生成完成, **Then** 系统在设计门禁处暂停等待批准
2. **Given** 用户使用 story 模式运行流程, **When** spec.md 生成完成, **Then** 系统默认跳过设计门禁，自动继续进入规划阶段
3. **Given** 用户在配置中显式要求 story 模式也启用设计门禁, **When** story 模式下 spec.md 生成完成, **Then** 系统暂停等待批准（用户配置覆盖默认行为） [AUTO-RESOLVED: 采用"Feature 模式启用、Story 模式豁免"作为默认行为，理由是 story 模式面向小范围增量需求，暂停打断与其设计初衷矛盾]
4. **Given** 用户使用 fix 模式运行流程, **When** 修复规划生成完成, **Then** 系统默认跳过设计门禁（fix 模式面向快速修复，行为与 story 模式一致）

---

### User Story 6 - 零配置开箱体验与高级自定义 (Priority: P2)

新用户首次使用 Spec Driver 时，不需要理解门禁策略、验证铁律等高级概念。系统使用合理的默认配置（balanced 策略）开箱即用，行为与升级前一致，不增加认知负担。高级用户（如 Tech Lead Alex）可以根据团队需求精细配置每个门禁的行为，实现"约定优于配置"的两级体验——大多数用户只需修改一个配置项（门禁策略），少数高级用户可以逐门禁调整。

**Why this priority**: 配置复杂度膨胀是本次特性最显著的产品风险。如果新增的门禁策略、验证铁律、双阶段审查等能力让配置文件变得难以理解，反而会阻碍用户采纳。"零配置默认值 + 高级自定义"的两级设计是缓解该风险的关键。

**Independent Test**: 在一个未配置任何新字段的项目中升级 Spec Driver，验证流程行为与升级前完全一致（向后兼容）。然后添加一行 `gate_policy: strict` 配置，验证所有门禁行为立即切换。

**Acceptance Scenarios**:

1. **Given** 用户升级到新版本但未修改配置文件, **When** 运行流程, **Then** 行为与升级前一致——使用 balanced 默认策略，不出现新的暂停点或行为变化
2. **Given** 用户仅修改一个配置项（门禁策略）, **When** 运行流程, **Then** 所有门禁按新策略统一执行，无需逐门禁配置
3. **Given** 用户需要精细控制（如"设计门禁始终暂停，研究门禁始终自动继续"）, **When** 在配置中添加门禁级别的覆盖项, **Then** 覆盖项优先于全局策略生效

---

### Edge Cases

- 当验证命令执行超时或异常退出时，系统将该验证标记为"执行异常"（而非通过或失败），并要求子代理重新运行或人工介入，不允许以异常结果作为通过依据
- 当项目同时安装了 Superpowers 和 Spec Driver 时，两者的行为约束可能重复（如都要求验证铁律），系统应能独立运行不产生冲突——两套约束叠加不会导致错误，只是冗余 [AUTO-RESOLVED: 当前阶段不做主动兼容检测，文档中明确两者独立性即可，理由是两者共存场景概率低且叠加不产生破坏性冲突]
- 当用户在流程中途切换门禁策略（如从 balanced 改为 autonomous）时，系统在下一个质量门生效新策略，已通过的门禁不受影响
- 当 Spec 合规审查和代码质量审查结论相互矛盾时（如代码质量优秀但偏离了 spec），以 Spec 合规审查结论为准——功能正确性优先于代码优雅性
- 当 autonomous 模式下连续多个门禁自动通过后最终验证失败时，系统回溯展示哪些门禁的自动通过决策可能有误，帮助用户调整策略
- 当配置文件中包含无法识别的门禁名称时，系统忽略该配置并输出警告，不阻断流程
- 当设计硬门禁等待用户确认时用户长时间未响应，系统保持暂停状态直到收到明确响应，不超时自动继续（硬门禁的设计意图就是必须等待人工决策）

## Requirements

### Functional Requirements

#### 验证铁律

- **FR-001**: 系统 MUST 要求实现子代理在声称任务完成前，在当前执行上下文中实际运行验证命令（构建、测试、Lint 等），并将命令输出作为完成的必要证据 (→ US-1)
- **FR-002**: 系统 MUST 拒绝不包含新鲜验证证据的完成声明，包括但不限于"should pass""looks correct""tests will likely pass"等推测性表述 (→ US-1)
- **FR-003**: 系统 MUST 在验证子代理中增加对验证证据的二次核查——检查是否存在实际运行的验证记录，而非仅依赖实现子代理的自我声明 (→ US-1)
- **FR-004**: 系统 SHOULD 在验证证据缺失时，提供明确的错误信息说明缺少哪类验证（构建/测试/Lint），指引子代理或用户补充 (→ US-1)

#### 双阶段代码审查

- **FR-005**: 系统 MUST 将验证阶段拆分为两个独立审查：Spec 合规审查（逐条检查 FR 实现状态）和代码质量审查（评估设计、安全、性能、可维护性） (→ US-3)
- **FR-006**: Spec 合规审查 MUST 逐条检查 spec.md 中的每个功能需求（FR），输出每条 FR 的状态：已实现/部分实现/未实现/过度实现 (→ US-3)
- **FR-007**: 代码质量审查 MUST 从设计模式合理性、安全性（如硬编码密钥、SQL 注入）、性能（如 N+1 查询、内存泄漏风险）、可维护性（如过长函数、缺少注释）四个维度评估 (→ US-3)
- **FR-008**: 两项审查 MUST 各自输出独立的结构化报告，问题按严重程度分级（CRITICAL/WARNING/INFO） (→ US-3)
- **FR-009**: 系统 SHOULD 支持两项审查并行执行以缩短总耗时 (→ US-3)

#### 门禁粒度增强

- **FR-010**: 系统 MUST 支持三级门禁策略配置：strict（所有门禁暂停等待确认）、balanced（关键门禁暂停，非关键按风险决策）、autonomous（仅失败或 CRITICAL 问题时暂停）。balanced 模式下关键门禁为 GATE_DESIGN、GATE_TASKS、GATE_VERIFY（暂停等待确认）；GATE_ANALYSIS 为非关键但 CRITICAL 时暂停（on_failure）；GATE_RESEARCH 为非关键自动继续（auto）。**注意**: Story 模式仅包含 GATE_DESIGN/GATE_TASKS/GATE_VERIFY（3 个门禁），Fix 模式仅包含 GATE_DESIGN/GATE_VERIFY（2 个门禁），门禁策略仅作用于当前模式实际存在的门禁 [AUTO-CLARIFIED: GATE_DESIGN/TASKS/VERIFY 为关键门禁；GATE_ANALYSIS 保留 CRITICAL 暂停能力以保持与现有行为一致] (→ US-2)
- **FR-011**: 系统 MUST 提供 balanced 作为默认门禁策略，确保未配置新字段时行为与当前版本一致（向后兼容） (→ US-2, US-6)
- **FR-012**: 系统 MUST 支持对每个门禁进行独立配置，门禁级配置优先于全局策略。配置结构为 spec-driver.config.yaml 新增 `gate_policy` 顶层字段（取值 strict/balanced/autonomous，默认 balanced）和 `gates` 顶层字段（map 结构，键为门禁标识如 GATE_DESIGN/GATE_RESEARCH/GATE_ANALYSIS/GATE_TASKS/GATE_VERIFY，值为 `{pause: always|auto|on_failure}`），门禁级配置优先于 gate_policy。**例外**：在 feature 模式下，GATE_DESIGN 的门禁级配置被忽略（硬门禁始终暂停），此约束仅可通过 FR-017 定义的模式级豁免（story/fix）解除 [AUTO-CLARIFIED: 2 个新增顶层配置项满足 SC-008 约束（上限 3 个），结构清晰且向后兼容] (→ US-2)
- **FR-013**: 系统 MUST 在每次门禁决策时输出格式化的决策日志，包含门禁名称、当前策略、决策结果和原因 (→ US-2)

#### 设计硬门禁

- **FR-014**: 系统 MUST 在需求澄清和质量检查完成后增加设计门禁暂停点，等待用户明确批准已澄清的 spec 后才继续进入规划阶段。设计门禁审批的是经过澄清的完整规范，而非初稿 (→ US-4)
- **FR-015**: 在 feature 模式下，设计门禁 MUST 不受 gate_policy 策略配置影响——即使门禁策略为 autonomous，设计门禁仍然暂停等待用户确认。门禁级配置（`gates.GATE_DESIGN.pause`）在 feature 模式下亦不可覆盖此行为。仅 FR-017 定义的模式级豁免（story/fix 模式）可跳过设计门禁 (→ US-4)
- **FR-016**: 设计门禁 MUST 在 feature 模式（run 命令）下默认启用 (→ US-4, US-5)
- **FR-017**: 设计门禁 MUST 在 story 模式和 fix 模式下默认豁免（不暂停） (→ US-5)
- **FR-018**: 系统 MUST 允许用户通过配置覆盖 story/fix 模式的设计门禁豁免行为（即用户可以在配置中要求 story 模式也启用设计门禁） (→ US-5)

#### 配置与兼容性

- **FR-019**: 配置文件变更 MUST 向后兼容——未配置新字段时，所有行为与当前版本一致 (→ US-6)
- **FR-020**: 系统 MUST 遵循"约定优于配置"原则——用户只需修改一个配置项（门禁策略）即可切换全局行为，无需逐门禁配置 (→ US-6)
- **FR-021**: 系统 MUST 对配置文件中无法识别的字段或值输出警告但不阻断流程 (→ Edge Case)
- **FR-022**: 系统 MUST 不引入任何新的运行时依赖，所有新增能力在现有架构内实现 (→ 全局约束)

### Key Entities

- **门禁策略 (Gate Policy)**: 控制所有质量门行为的全局配置，取值为 strict/balanced/autonomous。决定每个门禁在流程执行中是暂停等待确认还是自动继续
- **质量门 (Quality Gate)**: 流程中的检查点，用于在阶段转换时评估产出质量。包含门禁名称、是否暂停、覆盖配置等属性。现有门禁包括 GATE_RESEARCH、GATE_TASKS、GATE_VERIFY，新增 GATE_DESIGN（设计硬门禁）
- **验证证据 (Verification Evidence)**: 实现子代理在当前执行上下文中实际运行验证命令后产生的输出记录，包含命令名称、执行时间、退出状态和输出摘要。是验证铁律的核心数据实体。"新鲜"的判定标准：验证证据必须在当前任务的当前实现迭代中产生——即子代理在本次 Task 调用内运行的验证命令输出，而非引用先前迭代、先前任务或先前会话的历史结果。判定方式：验证子代理检查返回消息中是否包含验证命令的实际输出文本（非引用性描述）。MVP 第一批通过 Prompt 层实现（在 implement.md 和 verify.md 中植入约束文本，要求子代理必须执行验证命令并在返回中包含命令输出），Hooks 层（PreToolUse/PostToolUse + 结构化 verification-evidence.json）作为 MVP 第二批增强 [AUTO-CLARIFIED: MVP 分批交付 Prompt 层优先 -- 与 research-synthesis.md 推荐路径一致，Prompt 层可独立交付价值且零新增依赖]
- **Spec 合规审查报告 (Spec Compliance Report)**: 双阶段审查的第一阶段产出，逐条列出每个 FR 的实现状态（已实现/部分实现/未实现/过度实现）及偏差说明。由新增的 spec-review.md 子代理生成（演化自现有 verify.md 的 Layer 1 Spec-Code 对齐验证，提供更精细的逐 FR 状态输出）
- **代码质量审查报告 (Code Quality Report)**: 双阶段审查的第二阶段产出，从设计模式、安全性、性能、可维护性四个维度评估代码，问题按 CRITICAL/WARNING/INFO 分级。由新增的 quality-review.md 子代理生成。编排器在 Phase 7 中依次（或并行）调用 spec-review 和 quality-review，两份报告合并后触发 GATE_VERIFY [AUTO-CLARIFIED: 双阶段审查作为现有 verify 阶段的内部重构而非替换 -- 最小化对现有流程的破坏，verify.md 的 Layer 2 工具链验证能力保留不变]

## Success Criteria

### Measurable Outcomes

- **SC-001**: 实现和验证子代理在 90% 以上的场景中产生新鲜验证证据（实际运行的命令输出），而非推测性的"should pass"式声明
- **SC-002**: 双阶段审查能独立捕获 Spec 偏差（如 FR 遗漏或过度实现）和代码质量问题（如安全漏洞、性能隐患），两类问题不再混合在同一份报告中
- **SC-003**: 三级门禁策略切换正常工作——strict 模式下所有门禁暂停，balanced 模式下仅关键门禁暂停，autonomous 模式下仅失败时暂停
- **SC-004**: 每个门禁的独立配置能正确覆盖全局策略，覆盖优先级清晰无歧义
- **SC-005**: 设计硬门禁在所有门禁策略（含 autonomous）下均暂停等待用户确认，不可被任何策略绕过
- **SC-006**: 升级到新版本后，未修改配置文件的用户体验到与升级前完全一致的流程行为（零破坏性变更）
- **SC-007**: Story 模式默认跳过设计门禁，Feature 模式默认启用设计门禁，两种模式的差异化行为清晰可预测
- **SC-008**: 配置文件新增字段不超过 3 个顶层配置项，单字段切换即可完成策略变更，保持配置简洁性

## Clarifications

### Session 2026-02-27

| # | 问题 | 自动选择 | 理由 |
| --- | ------ | --------- | ------ |
| 1 | balanced 模式下"关键门禁"与"非关键门禁"的具体划分未明确列出 | GATE_DESIGN、GATE_TASKS、GATE_VERIFY 为关键门禁（暂停），GATE_RESEARCH、GATE_ANALYSIS 为非关键门禁（自动继续） | 研究门和分析门的产出是中间制品，后续有多重质量检查兜底；设计门、任务门、验证门直接影响实现方向和交付质量。US-2 Scenario 2 已给出"设计门、任务门、验证门"的线索 |
| 2 | 验证铁律的 MVP 实现范围——Prompt 层 vs Hooks 层的交付分批策略 | MVP 第一批仅实现 Prompt 层（implement.md/verify.md 植入约束 + 新增 spec-review.md/quality-review.md），Hooks 层作为 MVP 第二批 | 与 research-synthesis.md 推荐路径一致；Prompt 层可独立交付价值且零新增依赖；FR 仅描述行为语义不预设实现手段 |
| 3 | 双阶段审查与现有 verify 子代理的关系——替换还是内部重构 | 作为现有 verify 阶段的内部重构：verify.md Layer 1 演化为 spec-review.md，新增 quality-review.md，verify.md 保留 Layer 2 工具链验证 | 最小化对现有编排流程的破坏；复用 verify.md 的 Layer 2 工具链检测能力；编排器 Phase 7 调用顺序调整即可 |
| 4 | 门禁独立配置的 YAML 结构未定义 | 新增 `gate_policy`（取值 strict/balanced/autonomous，默认 balanced）和 `gates`（map，键为门禁标识，值为 `{pause: always\|auto\|on_failure}`）两个顶层字段 | 2 个新增顶层字段满足 SC-008 约束（上限 3 个）；结构清晰，单字段切换满足 FR-020 的"约定优于配置"原则 |
