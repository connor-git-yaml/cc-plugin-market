# Quickstart: Speckit Driver Pro

**Branch**: `011-speckit-driver-pro` | **Date**: 2026-02-15 | **Plan**: [plan.md](plan.md)

## 前置条件

1. **Claude Code** 已安装且可用
2. **API 访问权限**: 支持 Sonnet 和 Opus 模型
3. **Git 仓库**: 项目已初始化 Git

## 安装

```bash
# 通过 Claude Code Plugin marketplace 安装
claude plugin install speckit-driver-pro
```

安装后，Plugin 自动注册 `/speckit-driver-pro` skill。

## 首次使用

### 1. 启动 Driver Pro

```bash
# 在 Claude Code 中输入：
/speckit-driver-pro 给项目添加用户认证功能，支持 OAuth2 和 JWT
```

### 2. 初始化引导

首次在项目中使用时，Driver Pro 会自动引导：

```text
[初始化] 检测到新项目，开始初始化...

1. 创建 .specify/ 目录结构 ✅
2. 检查项目宪法...
   ⚠️ 未找到 constitution.md
   → 是否现在创建项目宪法？(Y/n)
3. 选择模型预设:
   A) balanced（推荐）- 重分析用 Opus，执行用 Sonnet
   B) quality-first - 全部用 Opus
   C) cost-efficient - 大部分用 Sonnet
   请选择 (A/B/C):
```

### 3. 自动编排

初始化完成后，Driver Pro 自动开始 10 阶段编排：

```text
[1/10] 正在检查项目宪法...
✅ Constitution 检查通过

[2/10] 正在执行产品调研...
✅ 产品调研完成：分析了 5 个竞品，识别 3 个差异化机会

[3/10] 正在执行技术调研...
✅ 技术调研完成：评估 4 个架构方案，推荐方案 A

[4/10] 正在生成产研汇总...
✅ 产研汇总完成

═══ 质量门 1: 请确认调研结论 ═══
[呈现 research-synthesis.md 摘要]
确认调研方向？(Y/调整/补充)
```

### 4. 关键决策点

整个流程中最多 4 次人工介入：

| 决策点 | 时机 | 选项 |
| ---- | ---- | ---- |
| 调研确认 | 产研汇总后 | 确认 / 调整 / 补充 |
| CRITICAL 问题 | 分析发现严重问题时 | 修复 / 忽略 / 中止 |
| 任务确认 | 任务分解后 | 确认 / 调整 / 重跑规划 |
| 验证确认 | 验证失败时 | 修复 / 接受 |

## 高级用法

### 恢复中断的流程

```bash
# 如果流程中断（如关闭终端），重新触发即可自动恢复
/speckit-driver-pro --resume
```

### 选择性重跑

```bash
# 重跑某个阶段（后续制品自动标记为过期）
/speckit-driver-pro --rerun plan
```

### 自定义配置

编辑 `spec-driver.config.yaml`：

```yaml
# 切换到全 Opus 模式
preset: quality-first

# 自定义验证命令
verification:
  commands:
    typescript:
      test: "vitest run"
    rust:
      lint: "cargo clippy -- -D warnings"

# 调整重试次数
retry:
  max_attempts: 3
```

## 生成的制品结构

完整流程结束后，specs/ 目录下将包含：

```text
specs/012-user-auth/
├── research/
│   ├── product-research.md      # 产品调研报告
│   ├── tech-research.md         # 技术调研报告
│   └── research-synthesis.md    # 产研汇总（交叉分析矩阵）
├── spec.md                      # 需求规范
├── plan.md                      # 技术计划
├── tasks.md                     # 任务清单
├── checklists/
│   └── requirements.md          # 质量检查表
├── analysis-report.md           # 一致性分析报告
└── verification/
    └── verification-report.md   # 验证报告
```

## 与现有 Speckit 命令的关系

Driver Pro 是 Speckit 命令的"自动驾驶模式"：

| 手动模式 | Driver Pro 自动编排 |
| ---- | ---- |
| `/speckit.constitution` | Phase 0: 自动检查 |
| `/speckit.specify` | Phase 2: 自动生成 |
| `/speckit.clarify` | Phase 3: 自动澄清 |
| `/speckit.checklist` | Phase 3.5: 自动生成 |
| `/speckit.plan` | Phase 4: 自动规划 |
| `/speckit.tasks` | Phase 5: 自动分解 |
| `/speckit.analyze` | Phase 5.5: 自动分析 |
| `/speckit.implement` | Phase 6: 自动实现 |
| 手动验证 | Phase 7: 自动验证 |
| **总计 9 次手动调用** | **1 次触发，≤4 次决策** |
