# 产研汇总: 借鉴 Superpowers 模式与增强人工控制权

**特性分支**: `017-adopt-superpowers-patterns`
**汇总日期**: 2026-02-27
**输入**: [product-research.md](product-research.md) + [tech-research.md](tech-research.md)
**执行者**: 主编排器（非子代理）

## 1. 产品×技术交叉分析矩阵

| MVP 功能 | 产品优先级 | 技术可行性 | 实现复杂度 | 综合评分 | 建议 |
|---------|-----------|-----------|-----------|---------|------|
| 验证铁律机制 | P0（投入产出比最高） | 高（Prompt 工程为主，Hooks 增强） | 低（2-3 天 Prompt，+2 天 Hooks） | ⭐⭐⭐ | **纳入 MVP 第一批** |
| 双阶段代码审查 | P0（竞品最大差距） | 高（新增 2 个子代理 Markdown + 编排逻辑） | 中（3-4 天） | ⭐⭐⭐ | **纳入 MVP 第一批** |
| 门禁粒度增强（三级策略） | P0（三 Persona 共同痛点） | 高（YAML 配置扩展 + 编排条件分支） | 中（2-3 天） | ⭐⭐⭐ | **纳入 MVP 第一批** |
| 设计硬门禁（HARD-GATE） | P1（借鉴 Superpowers 核心理念） | 高（编排器新增暂停点） | 低（1-2 天） | ⭐⭐⭐ | **纳入 MVP 第一批** |
| TDD 强制执行模式 | P2（Nice-to-have） | 中（需新增 TDD skill + implement 重构） | 中-高 | ⭐⭐ | 二期 |
| 任务级检查点（Batch Execution） | P2 | 中（implement 子代理拆分为批处理） | 中 | ⭐⭐ | 二期 |
| Git Worktree 隔离 | P2 | 高（Claude Code 原生 EnterWorktree 支持） | 中 | ⭐⭐ | 二期 |
| 子代理上下文隔离增强 | P3 | 低（需架构重构） | 高（2-3 周） | ⭐ | 远期 |
| 自适应门禁引擎 | P3 | 低（无成熟参考实现） | 高 | ⭐ | 远期 |
| 并行子代理调度 | P3 | 中（Claude Code 支持但未验证上限） | 高 | ⭐ | 远期 |

**评分说明**:
- ⭐⭐⭐: 高优先 + 高可行 + 低/中复杂度 → 纳入 MVP
- ⭐⭐: 中等匹配 → 二期
- ⭐: 低匹配或高复杂度 → 远期

## 2. 可行性评估

### 技术可行性

**总体评估: 高可行性**。推荐的方案 B（Hooks + Prompt 混合架构）完全基于现有技术栈，零新增运行时依赖。所有 4 项 Must-have 功能通过 Markdown prompt 修改、YAML 配置扩展和 Shell 脚本实现，与 Spec Driver 的"纯 Markdown plugin"架构哲学一致。

关键技术能力已验证：
- **Claude Code Hooks API**: 2025 Q4 发布，2026 Q1 持续迭代，API 稳定
- **Claude Code Task Tool**: 子代理独立 200K token 上下文，支持并行调用
- **Claude Code EnterWorktree**: 2026 年 2 月已稳定，Desktop 原生支持

### 资源评估

- **预估工作量**: MVP 总计 5-7 天（Prompt 层 2-3 天 + Hooks 层 2-4 天），可分两批交付
- **关键技能需求**: Markdown prompt 工程、YAML 配置设计、Shell 脚本（hooks）、Claude Code 编排逻辑
- **外部依赖**: 无新增。仅依赖 Claude Code 原生能力（Task tool、Hooks、EnterWorktree）

### 约束与限制

- **Prompt 遵从性上限**: 验证铁律依赖 LLM 遵从约束文本，在复杂长上下文中可能被忽略。Hooks 层作为补偿但非 100% 保证
- **跨平台限制**: Shell hooks 在 Windows（非 WSL）环境不可用。二期需考虑 PowerShell 替代
- **配置复杂度**: gate_policy + gates 独立配置叠加后，需要"零配置默认值 + 高级自定义"两级体验设计，避免新用户上手障碍

## 3. 风险评估

### 综合风险矩阵

| # | 风险 | 来源 | 概率 | 影响 | 缓解策略 | 状态 |
|---|------|------|------|------|---------|------|
| 1 | **Prompt 遵从性不可靠**: LLM 在复杂上下文中忽略铁律约束 | 技术 | 中 | 高 | 三层防线（Prompt + Hooks + verify 子代理）；铁律文本使用大写强调 + 禁止/允许对照表 | 待监控 |
| 2 | **配置复杂度膨胀**: gate_policy + gates + tdd_mode 叠加增加认知负担 | 产品+技术 | 中 | 中 | 零配置默认值（balanced）+ init-project.sh 交互引导 + 约定优于配置 | 待监控 |
| 3 | **Story 模式体验退化**: 设计硬门禁可能打断 Story 模式的快速流程 | 产品 | 中 | 中 | Story 模式默认豁免 GATE_DESIGN（仅 Feature 模式启用）；或提供 `story_skip_design_gate: true` 配置 | 待决策 |
| 4 | **Hooks 向后兼容性**: Claude Code hooks API 可能在未来版本变更 | 技术 | 低 | 中 | Hooks 作为增强层非核心依赖——即使失效仍有 Prompt 层基本保障 | 待监控 |
| 5 | **双阶段审查延长流程**: 新增 Spec Compliance Review 约增加 1-2 分钟 | 产品 | 中 | 低 | autonomous 模式可跳过 Spec Review；balanced 模式两个 Review 可并行执行 | 可接受 |
| 6 | **Superpowers 共存冲突**: 用户同时安装两者时约束可能重复/矛盾 | 产品 | 低 | 低 | 文档明确独立性；[推断] 远期可增加 superpowers_compat 检测 | 低优先 |
| 7 | **hooks 脚本跨平台**: Shell 在 Windows 非 WSL 环境不可用 | 技术 | 低 | 中 | macOS/Linux 优先；Windows 二期提供 PowerShell 替代 | 低优先 |
| 8 | **验证证据文件竞态**: 并行 hooks 同时读写 verification-evidence.json | 技术 | 低 | 低 | 原子写入（临时文件 + rename）；唯一时间戳键 | 可接受 |

### 风险分布

- **产品风险**: 3 项（高:0 中:2 低:1）
- **技术风险**: 5 项（高:0 中:2 低:3）

**总体风险评级: 中-低**。无高概率+高影响风险。最主要风险（Prompt 遵从性）已有三层缓解措施。

## 4. 最终推荐方案

### 推荐架构

**方案 B: Hooks + Prompt 混合架构**

核心设计哲学："**Prompt 教化 + Hooks 执法 + 编排兜底**"

```text
┌─────────────────────────────────────────────────────────┐
│                  Spec Driver 编排器                       │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐   │
│  │ gate_policy  │  │ GATE_DESIGN  │  │ 双阶段审查    │   │
│  │ 策略引擎     │  │ 硬门禁       │  │ Spec + Quality│   │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘   │
│         │                │                   │           │
│  ┌──────┴──────────────┴───────────────────┴─────┐     │
│  │              子代理 Prompt 层                    │     │
│  │  implement.md（植入验证铁律）                     │     │
│  │  spec-review.md（Spec 合规审查）                  │     │
│  │  quality-review.md（代码质量审查）                 │     │
│  │  verify.md（验证证据检查）                        │     │
│  └──────────────────────┬────────────────────────┘     │
│                         │                               │
│  ┌──────────────────────┴────────────────────────┐     │
│  │              Hooks 执法层（增强）                │     │
│  │  PreToolUse: 验证铁律执法器（拦截未验证 commit）  │     │
│  │  PostToolUse: 验证证据收集器（记录验证结果）      │     │
│  └───────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

### 推荐技术栈

| 类别 | 选择 | 理由 |
|------|------|------|
| 约束植入 | Markdown prompt 模板 | 与现有架构一致，零侵入性 |
| 运行时执法 | Claude Code Hooks (Shell + jq) | 原生支持，无新增依赖 |
| 配置扩展 | YAML (spec-driver.config.yaml) | 现有配置格式，向后兼容 |
| 审查子代理 | Markdown prompt (spec-review.md, quality-review.md) | 复用现有子代理委派机制 |
| 工作区隔离 | Claude Code EnterWorktree | 原生支持，二期集成 |

### 推荐实施路径

1. **Phase 1 (MVP 第一批 — Prompt 层)**: 验证铁律 prompt 植入 + 双阶段审查子代理 + 门禁策略配置 + 设计硬门禁（预估 3-4 天）
2. **Phase 2 (MVP 第二批 — Hooks 层)**: PreToolUse 验证铁律执法器 + PostToolUse 证据收集器 + init-project.sh 自动注入（预估 2-3 天）
3. **Phase 3 (二期)**: TDD 模式 + 任务级检查点 + Git Worktree 隔离
4. **Phase 4 (远期)**: 子代理架构重构 + 自适应门禁 + 并行调度

## 5. MVP 范围界定

### 最终 MVP 范围

**纳入**:
- **验证铁律机制**: 三层防线确保"完成声明必须有新鲜验证证据"。投入产出比最高（prompt 工程为主），直接解决"AI 未验证就声称完成"的核心痛点
- **双阶段代码审查**: Spec Compliance Review + Code Quality Review，弥补与 Superpowers 的最大能力差距。两个审查可并行执行以控制时间开销
- **门禁粒度增强**: 三级策略（strict/balanced/autonomous）+ 每门禁独立配置（通过 gates 字段）。解决三个 Persona 共同的"门禁不可配置"痛点
- **设计硬门禁**: GATE_DESIGN 在 spec 完成后强制暂停等待用户确认。借鉴 Superpowers 的 `<HARD-GATE>` 理念——"每个需求都需要设计审批"

**排除（明确不在 MVP）**:
- **TDD 强制执行**: 实现复杂度中-高，且需要 implement 子代理重构。二期实现
- **任务级检查点**: 需要 implement 子代理拆分为批处理模式。二期实现
- **Git Worktree 隔离**: 技术可行但非核心痛点。二期集成
- **子代理架构重构**: 破坏性变更，实现周期 2-3 周。远期
- **自适应门禁引擎**: 无成熟参考实现，需构建风险评估模型。远期
- **并行子代理调度**: 技术可行但稳定性需验证。远期

### MVP 成功标准

- implement 和 verify 子代理在 ≥90% 的场景中产生新鲜验证证据（而非"should pass"式声明）
- 双阶段审查能独立捕获 Spec 偏差和代码质量问题
- gate_policy 三级策略切换正常工作，每门禁独立配置生效
- 设计硬门禁在所有模式（含 autonomous）下均暂停等待用户确认
- spec-driver.config.yaml 变更向后兼容——未配置新字段时行为与当前一致
- 新增子代理 prompt 不超过 300 行/文件，维护复杂度可控

## 6. 结论

### 综合判断

Superpowers 和 Spec Driver 代表两种互补的 AI 辅助开发哲学——Superpowers 是"行为约束框架"（通过铁律和硬门禁教化 AI），Spec Driver 是"流程编排器"（通过阶段化子代理编排自动化开发流程）。本次特性的核心价值在于将 Superpowers 的**质量约束理念**嫁接到 Spec Driver 的**编排层**之上，同时保持 Spec Driver 独有的调研能力和断点恢复优势。推荐的方案 B（Hooks + Prompt 混合架构）以零新增依赖、分批交付的方式实现 4 项 Must-have 功能，预估 5-7 天完成 MVP。

### 置信度

| 维度 | 置信度 | 说明 |
|------|--------|------|
| 产品方向 | 高 | Superpowers 64K+ stars 验证了市场需求；三 Persona 痛点分析充分；差异化定位清晰（借鉴理念而非复制架构） |
| 技术方案 | 高 | 方案 B 基于成熟的 Claude Code 原生能力；零新增依赖；渐进式交付降低风险；三层防线设计已有类似案例佐证 |
| MVP 范围 | 中-高 | 4 项 Must-have 的产品-技术对齐度均为"完全覆盖"；主要不确定性在于 Story 模式与设计硬门禁的兼容性（需用户决策） |

### 待决策项

1. **Story 模式与设计硬门禁**: Story 模式是否启用 GATE_DESIGN？建议 Feature 模式默认启用，Story 模式默认豁免
2. **分批交付策略**: 是否接受先交付 Prompt 层（第一批），再补充 Hooks 层（第二批）？
3. **验证可靠性预期**: "尽力而为"（方案 B）还是"必须保证"（需评估方案 C）？

### 后续行动建议

- 确认推荐方案和待决策项后，进入需求规范阶段（specify）
- 需求规范应明确 gate_policy 的默认值选择和 Story/Feature 模式的差异化行为
- 技术规划应细化 Prompt 层和 Hooks 层的分批交付里程碑
