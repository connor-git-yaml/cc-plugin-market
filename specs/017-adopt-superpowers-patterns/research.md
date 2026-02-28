# 技术决策研究: 借鉴 Superpowers 行为约束模式与增强人工控制权

**特性分支**: `017-adopt-superpowers-patterns`
**研究日期**: 2026-02-27
**输入**: [spec.md](spec.md) + [research-synthesis.md](research/research-synthesis.md) + [tech-research.md](research/tech-research.md)

## 决策 1: 整体架构方案选择

**Decision**: 采用方案 B — Hooks + Prompt 混合架构

**Rationale**:
1. 方案 B 在方案 A（纯 Prompt）基础上仅增加约 2-4 天工作量，即可获得运行时执法能力
2. 渐进式交付：先交付 Prompt 层（MVP 第一批），再叠加 Hooks 层（MVP 第二批），降低风险
3. 利用 Claude Code 原生 hooks 机制（2025 Q4 发布，API 稳定），是平台鼓励的扩展方式
4. 零新增运行时依赖，完全符合"纯 Markdown plugin"架构哲学
5. 为远期方案 C（子代理架构重构）铺路——gate_policy 和双阶段审查可无缝演进

**Alternatives**:
- **方案 A（纯 Prompt 工程）**: 实现周期短（2-3 天），但 Prompt 遵从性无法强制保证，LLM 在长上下文中可能忽略铁律约束。适合快速验证但长期可靠性不足
- **方案 C（子代理架构重构）**: 架构级保证约束执行，但实现周期 2-3 周，需重写编排器核心逻辑，子代理启动开销大（每 Task ~3-5s），远期演进方向而非当前目标

## 决策 2: 零新增运行时依赖

**Decision**: 所有新增能力通过 Markdown prompt、YAML 配置扩展、Shell 脚本和 Claude Code 原生工具实现，不引入任何新的运行时依赖

**Rationale**:
1. Spec Driver 的核心架构定位是"纯 Markdown plugin"——所有子代理都是 Markdown prompt 文件
2. Constitution 原则 V（纯 Node.js 生态）要求所有运行时依赖属于 npm 生态，本特性连 npm 依赖都不需要新增
3. 本特性的 4 项 Must-have 功能（验证铁律、双阶段审查、门禁策略、设计硬门禁）本质上都是"编排逻辑"和"约束规则"，不涉及数据处理或外部系统集成
4. hooks 脚本依赖的 `jq` 是系统工具（macOS/Linux 预装或 Claude Code 环境已含），不计入运行时依赖

**Alternatives**:
- 引入 `ajv` 或 `zod` 做 spec-driver.config.yaml 的 schema 验证：增加可靠性但违背零依赖原则。通过编排器 prompt 中的"忽略无效配置 + 输出警告"策略替代
- 引入 `yaml` npm 包解析配置：Claude Code 编排器已具备 YAML 读取能力，无需额外依赖

## 决策 3: MVP 分批交付策略

**Decision**: 分两批交付——MVP 第一批（Prompt 层）和 MVP 第二批（Hooks 层），第一批可独立发布

**Rationale**:
1. Prompt 层可独立交付核心价值——验证铁律的行为引导、双阶段审查的结构化报告、门禁策略的配置化、设计硬门禁的暂停点
2. Hooks 层作为增强而非替代——即使不部署 Hooks，Prompt 层 + verify 子代理已构成双层防线
3. 渐进式交付降低风险——如果 Prompt 层效果足够好（>90% 遵从率），Hooks 层的紧迫性降低
4. Hooks 层需要用户配置 `.claude/settings.json`，增加了部署复杂度，分批可以独立评估用户接受度

**Alternatives**:
- 一次性交付 Prompt + Hooks 全部：工期更长（5-7 天 vs 3-4 天），且 Hooks 配置的用户体验未经验证，风险集中
- 仅交付 Prompt 层，Hooks 作为远期：可行但放弃了运行时执法能力，验证铁律的可靠性上限较低

## 决策 4: 门禁配置结构设计

**Decision**: 新增 `gate_policy`（顶层字段，取值 strict/balanced/autonomous，默认 balanced）和 `gates`（顶层字段，map 结构）两个配置项

**Rationale**:
1. 2 个新增顶层字段满足 SC-008 约束（上限 3 个）
2. `gate_policy` 实现"约定优于配置"——大多数用户只需修改一个字段即可切换全局行为（FR-020）
3. `gates` map 结构允许高级用户逐门禁精细控制（FR-012），键为门禁标识，值为 `{pause: always|auto|on_failure}`
4. 默认 balanced 确保向后兼容——未配置新字段时行为与当前版本一致（FR-019）
5. 简化 tech-research.md 中提出的 `strict_override`/`autonomous_override` 设计——三级策略 + 门禁级 `pause` 足以覆盖所有场景

**Alternatives**:
- 单一 `gate_policy` 字段，不提供逐门禁配置：过于简化，无法满足高级用户需求（如"研究门始终自动继续"）
- tech-research.md 提出的 `strict_override`/`autonomous_override` 结构：每个门禁需 3 个字段，配置过于冗余，增加认知负担
- 嵌套在现有 `quality_gates` 字段下：语义不匹配——`quality_gates` 目前控制的是 WARNING/CRITICAL 阈值，门禁策略是不同维度

## 决策 5: 设计硬门禁的模式差异化

**Decision**: Feature 模式始终启用 GATE_DESIGN（不可被 gate_policy 或 gates 配置绕过），Story/Fix 模式默认豁免，用户可通过配置覆盖豁免

**Rationale**:
1. Feature 模式面向中大型需求，设计方向错误的返工成本远高于暂停确认的时间成本
2. Story 模式核心价值是"快速低中断"，设计硬门禁会破坏其流程体验
3. Fix 模式面向快速修复，通常不涉及设计决策，暂停无意义
4. 用户可通过 `gates.GATE_DESIGN.pause: always` 在 story 模式中也启用设计门禁，保留灵活性

**Alternatives**:
- 所有模式统一启用 GATE_DESIGN：Story/Fix 模式体验退化，违背模式差异化设计初衷
- 所有模式统一不启用：失去 Superpowers 核心理念"每个项目都需要设计审批"
- 增加 `design_gate_in_story: true/false` 专用配置项：增加配置项数量，不如复用 gates 配置结构

## 决策 6: 双阶段审查与现有 verify 子代理的关系

**Decision**: 作为 verify 阶段的内部重构——verify.md 的 Layer 1（Spec-Code 对齐）演化为独立的 spec-review.md 子代理，新增 quality-review.md 子代理，verify.md 保留 Layer 2（工具链验证）

**Rationale**:
1. 最小化对现有编排流程的破坏——编排器 Phase 7 仍然是"验证闭环"，内部拆分为 3 个子调用
2. 复用 verify.md 已有的 Layer 2 工具链检测能力（语言检测、Monorepo 支持、命令执行等）
3. spec-review.md 可提供更精细的逐 FR 状态输出（已实现/部分实现/未实现/过度实现），超越 verify.md Layer 1 的 checkbox 级检查
4. quality-review.md 引入四维度评估（设计模式、安全性、性能、可维护性），是当前 verify 完全不覆盖的新能力

**Alternatives**:
- 完全替换 verify.md：丧失 Layer 2 工具链验证能力，需要在新子代理中重新实现
- 在 verify.md 内部增加段落：verify.md 已经较长，继续膨胀会降低 Prompt 遵从性
- 三个子代理完全独立调用（不共享 Phase 7）：增加编排器复杂度，且不符合"验证闭环"的语义统一性

## 决策 7: 验证铁律的实现层次

**Decision**: 三层防线——Layer 1 Prompt 约束（implement.md/verify.md 植入铁律文本）+ Layer 2 Hooks 拦截（PreToolUse 检测未验证的 git commit）+ Layer 3 verify 子代理二次核查（验证证据检查）

**Rationale**:
1. 单层 Prompt 约束的遵从率在长上下文中可能下降至 70-80%（参考 Superpowers 的经验），多层防线显著提升可靠性
2. 每层独立生效——即使 hooks 未配置、即使 verify 子代理被跳过，Prompt 层仍提供基本保障
3. 三层的实现成本递增但价值递减（Prompt 层：1 天，高价值；Hooks 层：2 天，中价值；verify 层：0.5 天，补充价值），MVP 第一批仅需 Layer 1 + Layer 3
4. 参考 Superpowers 的 verification-before-completion 机制，其使用"excuse vs reality"对照表格式，在 Prompt 层已证明有效

**Alternatives**:
- 仅 Prompt 层（方案 A）：可靠性不足，长上下文中 LLM 可能忽略约束
- 仅 Hooks 层：无法引导 LLM 的行为模式，只能在违规后拦截，用户体验差（反复被拦截）
- 架构级保证（方案 C 每任务新鲜子代理）：过度工程，实现周期 2-3 周

## 决策 8: 编排器门禁决策逻辑

**Decision**: 在编排器 SKILL.md 中使用条件分支逻辑（Strategy Pattern 的 Markdown 实现），每个质量门根据 gate_policy + gates 配置决定行为

**Rationale**:
1. 编排器是 Markdown prompt，不适合复杂的代码逻辑。通过清晰的条件分支文本（"如果 gate_policy 为 strict 则暂停"）即可实现
2. Strategy Pattern 在 Markdown 中的表达方式：为每种策略定义一张"门禁行为表"，编排器在每个质量门查表决策
3. 门禁级配置（gates.{GATE_NAME}.pause）优先于全局策略，编排器先检查门禁级再回退到策略级
4. GATE_DESIGN 在 feature 模式下的硬门禁约束作为特例处理——在门禁决策逻辑之前进行模式检查

**Alternatives**:
- 用 Shell 脚本实现门禁决策：增加维护复杂度，且与"编排器负责全局逻辑"的职责划分不符
- 用 TypeScript 代码实现：违背"纯 Markdown plugin"架构，需要编译步骤
