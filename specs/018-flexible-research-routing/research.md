# 技术决策研究: Feature 模式灵活调研路由

**Feature Branch**: `018-flexible-research-routing`
**Date**: 2026-02-27
**Status**: Final

---

## Decision 1: 调研模式路由策略——Prompt 内分支 vs. 多 Skill 文件

### 背景

Feature 模式当前在 `SKILL.md` 中硬编码了固定的三阶段调研流水线（Phase 1a → 1b → 1c）。需要引入 6 种调研模式的路由能力。有两种主要实现策略。

### 方案 A: Prompt 内条件分支（推荐）

在现有 `speckit-feature/SKILL.md` 中，通过 Markdown 条件逻辑（伪代码块 + 自然语言条件描述）实现模式路由。编排器根据确定的 `research_mode` 值，执行对应的调研步骤子集。

**优势**:
- 单一入口，维护简单
- 与现有编排器架构完全一致（已有 `--rerun`、`--preset` 等条件分支先例）
- 不增加文件数量
- 向后兼容——不改变触发方式和 Skill 注册方式

**劣势**:
- SKILL.md 文件会变长（预估增加 80-120 行）
- 所有模式逻辑集中在一个文件中

### 方案 B: 多 Skill 文件分发

为每种调研模式创建独立的编排器 Skill（如 `speckit-feature-techonly/SKILL.md`），用户通过不同 Skill 名触发。

**优势**:
- 每个 Skill 文件更短
- 模式隔离清晰

**劣势**:
- 用户需记住多个 Skill 名，学习成本高
- 无法实现智能推荐（推荐逻辑需要在用户触发之前运行）
- 违背"约定优于配置"原则——增加了认知负担
- 代码重复严重（Phase 2-7 在所有 Skill 中相同）
- 不支持 `--research` 命令行参数覆盖

### 决策

**选择方案 A: Prompt 内条件分支**

**理由**: 方案 A 完全在现有架构内实现，不增加文件数量，保持单一入口的简洁性，且是实现智能推荐和命令行覆盖的唯一可行方案。SKILL.md 文件变长是可接受的代价——当前已有 299 行，增加到 ~400 行仍在合理范围内。

---

## Decision 2: 智能推荐实现策略——LLM 调用 vs. 关键词启发式

### 背景

编排器需要基于需求描述文本自动推荐调研模式。spec.md Clarification #4 已明确"使用关键词 + 启发式规则，不引入额外 LLM 调用"。

### 方案 A: 关键词 + 启发式规则（推荐）

在编排器 Prompt 中定义一组关键词-模式映射规则，编排器（作为 LLM 本身）在解析需求描述时应用这些规则进行模式推荐。

**规则设计**:

```text
# 信号 → 推荐模式映射
signals:
  full:
    keywords: [新产品, 市场, 用户群体, 定价, 商业模式, SaaS, B2B, B2C, 目标用户]
    condition: 出现 >= 2 个关键词
  tech-only:
    keywords: [迁移, 重构, 架构, 性能优化, 技术栈, 升级, 替换, 框架]
    condition: 出现 >= 1 个关键词 且 无 full 信号
  product-only:
    keywords: [竞品, 对标, 用户调研, 市场分析]
    condition: 出现 >= 1 个关键词 且 无 tech 信号
  codebase-scan:
    condition: 需求描述 < 50 字 且 描述为增量功能/修复
  skip:
    condition: 需求描述极短 (< 20 字) 且 为 trivial 变更
  default: full（当无法判断时回退到完整调研）
```

**优势**:
- 零额外 API 成本（复用编排器 LLM 的自然语言理解能力）
- 透明可预测——用户能理解推荐逻辑
- 与 Bash/Markdown Plugin 零运行时依赖约束一致
- 推荐理由可直接从规则推导

**劣势**:
- 规则可能无法覆盖所有边界情况
- 关键词列表需随使用反馈迭代

### 方案 B: 额外 LLM 调用分类

在推荐阶段额外调用一次 LLM（通过 Task tool），传入需求描述，返回分类结果。

**优势**:
- 分类更准确，能理解语义而非仅匹配关键词

**劣势**:
- 增加 API 调用成本和延迟
- 与 Clarification #4 矛盾（已被排除）
- 增加了编排复杂度

### 决策

**选择方案 A: 关键词 + 启发式规则**

**理由**: 这是 spec.md 中 Clarification #4 的明确要求。编排器本身是 LLM，在解析需求描述时天然具备语义理解能力，关键词规则只是提供结构化的判断框架，实际推荐会综合 LLM 的语义理解和关键词匹配。

---

## Decision 3: tech-research 子代理降级策略——条件读取 vs. 分支 Prompt

### 背景

当前 tech-research.md 硬依赖 `product-research.md`（"必须基于产品调研结论"、"product-research.md 不存在 → 返回失败"）。`tech-only` 和 `custom` 模式下需要在无此文件时独立运行。

### 方案 A: 修改现有 Prompt 的条件逻辑（推荐）

修改 `tech-research.md` 中的约束和失败处理，将硬依赖改为软依赖：
- "必须基于产品调研结论" → "基于产品调研结论（如有）或需求描述"
- "product-research.md 不存在 → 返回失败" → "product-research.md 不存在 → 基于需求描述和代码上下文直接执行技术调研"
- 执行流程第 1 步增加条件分支：有 product-research.md 则读取，无则基于需求描述提取核心技术问题

**优势**:
- 最小化变更（修改 ~10 行 Prompt 文本）
- 保持单一子代理文件
- 向后兼容——有 product-research.md 时行为不变

**劣势**:
- 无产品调研输入时，技术调研的"产品-技术对齐度评估"步骤可能质量下降

### 方案 B: 创建独立的 tech-research-standalone.md

新建一个不依赖产品调研的技术调研子代理 Prompt。

**优势**:
- 职责分离清晰

**劣势**:
- 代码重复（~80% 内容相同）
- 维护两个文件，容易不同步
- 违反 DRY 原则

### 决策

**选择方案 A: 修改现有 Prompt 的条件逻辑**

**理由**: 变更量最小，保持单一文件，且降级行为是合理的——无产品调研时，技术调研的"产品-技术对齐度评估"步骤自然简化为"需求-技术对齐度评估"，这是功能性降级而非错误。

---

## Decision 4: 配置文件扩展策略——新增配置段 vs. 扩展 agents 段

### 背景

需要在 `spec-driver.config.yaml` 中支持调研模式默认值和自定义步骤配置。

### 方案 A: 新增顶级 `research` 配置段（推荐）

```yaml
# ═══════════════════════════════════════
# 调研阶段配置
# ═══════════════════════════════════════
research:
  # 默认调研模式
  # 可选值: auto | full | tech-only | product-only | codebase-scan | skip
  # auto = 由编排器根据需求特征智能推荐
  default_mode: auto

  # 自定义步骤（仅当 default_mode: custom 时生效）
  # 可选步骤: product-research, tech-research, codebase-scan, synthesis
  custom_steps: []
```

**优势**:
- 语义清晰——调研配置与模型配置、验证配置平级
- 与现有配置文件结构一致（每个关注点一个顶级段）
- 向后兼容——不存在 `research` 段时默认 `auto`（等同于当前 `full` 行为）

**劣势**:
- 增加配置文件长度（~15 行注释 + 配置）

### 方案 B: 在 agents 段下增加 research-mode 字段

```yaml
agents:
  research-mode: auto
  product-research:
    model: opus
  ...
```

**优势**:
- 不增加新的顶级段

**劣势**:
- 语义混乱——`agents` 段是模型配置，混入流程控制配置违反单一职责
- `custom_steps` 放在 `agents` 下不自然

### 决策

**选择方案 A: 新增顶级 `research` 配置段**

**理由**: 与现有配置文件的组织原则一致（preset、agents、verification、quality_gates、retry、progress 各自为顶级段），调研配置是流程控制，不应与模型配置混合。

---

## Decision 5: GATE_RESEARCH 在非 full 模式下的行为设计

### 背景

当前 GATE_RESEARCH 在 Phase 1c（产研汇总）后执行，展示 research-synthesis.md 摘要。非 `full` 模式下不生成此文件，需要重新设计门禁行为。

### 决策

采用**模式感知的分级门禁**策略：

| 模式 | GATE_RESEARCH 行为 |
|------|-------------------|
| `full` | 展示 research-synthesis.md 摘要（现有行为不变） |
| `tech-only` | 展示 tech-research.md 关键发现摘要 |
| `product-only` | 展示 product-research.md 关键发现摘要 |
| `codebase-scan` | 展示代码上下文扫描摘要 |
| `skip` | 完全跳过 GATE_RESEARCH |
| `custom` | 展示实际生成的调研制品摘要 |

非 `full`/`skip` 模式的门禁选项调整为：A) 确认继续 | B) 补充调研 | C) 切换到 `full` 模式。

**理由**: 保持质量门控的精神（Constitution X）——用户在调研完成后仍有机会审查成果并决定是否需要更深入的调研，同时不强制执行不存在的制品的门禁。

---

## Decision 6: 进度编号显示策略

### 背景

不同调研模式下实际执行的步骤数不同，但 spec.md Clarification #2 已明确"进度分母固定为最大步骤数（10）"。

### 决策

采用**固定分母 + 跳过标注**策略：

```text
# tech-only 模式示例
[1/10] 正在检查项目宪法...                         ✅
[2/10] 产品调研 [已跳过 - 调研模式: tech-only]      ⏭️
[3/10] 正在执行技术调研...                          ✅
[4/10] 产研汇总 [已跳过 - 调研模式: tech-only]      ⏭️
[5/10] 正在生成需求规范...                          ✅
...

# skip 模式示例
[1/10] 正在检查项目宪法...                         ✅
[2/10] 产品调研 [已跳过 - 调研模式: skip]           ⏭️
[3/10] 技术调研 [已跳过 - 调研模式: skip]           ⏭️
[4/10] 产研汇总 [已跳过 - 调研模式: skip]           ⏭️
[5/10] 正在生成需求规范...                          ✅
...
```

**理由**: 固定分母确保不同模式间进度可比较，跳过标注保持可追溯性，符合 Clarification #2 的明确要求。

---

## Decision 7: 命令行参数 `--research` 的解析位置

### 背景

需要在 SKILL.md 的输入解析阶段新增 `--research <mode>` 参数。

### 决策

在现有"输入解析"表格中新增一行，并在解析规则中增加：

```text
| `--research <mode>` | string | 指定调研模式，跳过推荐和交互选择（可选值: full, tech-only, product-only, codebase-scan, skip） |
```

解析优先级：`--research` > `spec-driver.config.yaml research.default_mode` > 智能推荐。

无效值处理：输出错误提示 + 回退到推荐交互流程（符合 Constitution XII 向后兼容原则）。

**理由**: 与现有 `--rerun`、`--preset` 参数的解析模式完全一致，用户体验统一。
