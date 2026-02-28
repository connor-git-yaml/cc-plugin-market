# Orchestrator Contract: 主编排器输入输出契约

**Branch**: `011-speckit-driver-pro` | **Date**: 2026-02-15

## 触发入口

**Skill**: `/speckit-driver-pro`
**触发方式**: 用户在 Claude Code 中输入 `/speckit-driver-pro <需求描述>`

## 输入契约

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| 需求描述 | string | 是 | 用户输入的自然语言需求描述（`$ARGUMENTS`） |
| --resume | flag | 否 | 恢复模式：从上次中断的阶段继续 |
| --rerun \<phase\> | string | 否 | 选择性重跑：指定要重新执行的阶段名 |
| --preset \<name\> | string | 否 | 临时覆盖模型预设（不修改 spec-driver.config.yaml） |

## 输出契约

### 正常完成

```text
══════════════════════════════════════════
  Speckit Driver Pro - 流程完成报告
══════════════════════════════════════════

特性分支: 012-user-auth
总耗时: ~15 分钟
阶段完成: 10/10
人工介入: 2 次（调研确认、任务确认）

生成的制品:
  ✅ research/product-research.md
  ✅ research/tech-research.md
  ✅ research/research-synthesis.md
  ✅ spec.md
  ✅ plan.md
  ✅ tasks.md
  ✅ checklists/requirements.md
  ✅ analysis-report.md
  ✅ verification/verification-report.md

验证结果:
  构建: ✅ 通过
  Lint:  ✅ 通过（2 个警告）
  测试: ✅ 通过（18/18）

建议下一步: git add && git commit
══════════════════════════════════════════
```

### 暂停状态

```text
[暂停] 质量门 2 阻断 - 发现 CRITICAL 问题

问题:
  1. [CRITICAL] spec.md 中 FR-003 与 plan.md 的架构决策矛盾
  2. [WARNING] tasks.md 中 T012 缺少依赖声明

操作选项:
  A) 修复问题后重跑分析（推荐）
  B) 忽略警告，继续执行
  C) 中止流程

请输入选项 (A/B/C):
```

### 恢复模式

```text
[恢复] 检测到已有制品，从 Phase 5 (tasks) 继续...

已有制品:
  ✅ research/ (完整)
  ✅ spec.md
  ✅ plan.md
  ⏳ tasks.md (待生成)

继续执行...
[5/10] 正在生成任务分解...
```

## 阶段级进度输出格式

每个阶段的标准进度输出：

```text
[N/10] 正在执行 {阶段中文名}...

# 阶段完成后：
✅ {阶段中文名} 完成：{关键产出摘要}
```

示例：

```text
[1/10] 正在执行产品调研...
✅ 产品调研完成：分析了 5 个竞品，识别 3 个差异化机会

[2/10] 正在执行技术调研...
✅ 技术调研完成：评估 4 个架构方案，推荐微服务 + Event Sourcing

[3/10] 正在生成产研汇总...
✅ 产研汇总完成：交叉分析矩阵已生成，推荐 MVP 范围已界定
```
