# Speckit Driver Pro

**自治研发编排器** — 通过主编排器 + 10 子代理架构，一键触发 Spec-Driven Development 全流程。

## 功能概述

Speckit Driver Pro 是 Spec Kit 命令的"自动驾驶模式"。它将 9 个手动 speckit 命令调用统一为 1 次触发，全程仅在 ≤ 4 个关键决策点暂停征询用户意见：

| 手动模式 | Driver Pro 自动编排 |
|---------|-------------------|
| `/speckit.constitution` | Phase 0: 自动检查 |
| 新增：产品调研 | Phase 1a: 市场验证 + 竞品分析 |
| 新增：技术调研 | Phase 1b: 架构选型 + 依赖评估 |
| 新增：产研汇总 | Phase 1c: 交叉分析矩阵 |
| `/speckit.specify` | Phase 2: 自动生成 |
| `/speckit.clarify` | Phase 3: 自动澄清 |
| `/speckit.checklist` | Phase 3.5: 自动生成 |
| `/speckit.plan` | Phase 4: 自动规划 |
| `/speckit.tasks` | Phase 5: 自动分解 |
| `/speckit.analyze` | Phase 5.5: 自动分析 |
| `/speckit.implement` | Phase 6: 自动实现 |
| 新增：验证闭环 | Phase 7: 多语言验证 |
| **总计 ≥ 9 次手动调用** | **1 次触发，≤ 4 次决策** |

## 安装

```bash
# 通过 Claude Code Plugin marketplace 安装
claude plugin install speckit-driver-pro
```

## 使用方法

### 基本用法

```bash
/speckit-driver-pro 给项目添加用户认证功能，支持 OAuth2 和 JWT
```

### 恢复中断的流程

```bash
/speckit-driver-pro --resume
```

### 选择性重跑

```bash
/speckit-driver-pro --rerun plan
```

### 临时切换模型预设

```bash
/speckit-driver-pro --preset quality-first "添加支付系统"
```

## 模型配置

三种预设模式，通过 `driver-config.yaml` 配置：

| 预设 | 重分析任务 | 执行任务 | 适用场景 |
|------|-----------|---------|---------|
| **balanced**（默认） | Opus | Sonnet | 日常开发 |
| **quality-first** | Opus | Opus | 关键功能 |
| **cost-efficient** | Sonnet | Sonnet | 探索性需求 |

## 子代理列表

| 子代理 | 阶段 | 职责 |
|--------|------|------|
| constitution | Phase 0 | 宪法原则合规检查 |
| product-research | Phase 1a | 市场需求验证和竞品分析 |
| tech-research | Phase 1b | 架构方案选型和技术评估 |
| specify | Phase 2 | 生成结构化需求规范 |
| clarify | Phase 3 | 检测歧义并自动解决 |
| checklist | Phase 3.5 | 规范质量检查 |
| plan | Phase 4 | 技术规划和架构设计 |
| tasks | Phase 5 | 任务分解和依赖排序 |
| analyze | Phase 5.5 | 跨制品一致性分析 |
| implement | Phase 6 | 按任务清单实现代码 |
| verify | Phase 7 | 多语言构建/Lint/测试验证 |

## 验证支持的语言

JS/TS (npm/pnpm/yarn/bun)、Rust (Cargo)、Go、Python (pip/poetry/uv)、Java (Maven/Gradle)、Kotlin、Swift (SPM)、C/C++ (CMake/Make)、C# (.NET)、Elixir (Mix)、Ruby (Bundler)

## 与现有系统的关系

- **独立于 reverse-spec plugin**：Driver Pro 是正向研发工具，reverse-spec 是逆向分析工具，互补关系
- **共享 `.specify/memory/constitution.md`**：复用项目宪法
- **兼容已有 speckit skills**：检测到项目已有定制版 speckit skills 时优先使用

## 目录结构

```text
plugins/speckit-driver-pro/
├── .claude-plugin/plugin.json    # Plugin 元数据
├── hooks/hooks.json              # SessionStart hook
├── skills/speckit-driver-pro/
│   └── SKILL.md                  # 主编排器（研发总监）
├── agents/                       # 11 个子代理 prompt
├── templates/                    # 5 个模板
├── scripts/                      # 初始化脚本
└── README.md                     # 本文件
```

## 许可证

MIT
