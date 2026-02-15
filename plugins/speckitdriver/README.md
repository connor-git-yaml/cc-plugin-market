# Speckitdriver

**自治研发编排器** — 支持 5 种模式（run/story/fix/resume/sync），一键触发 Spec-Driven Development 全流程。

## 功能概述

Speckitdriver 根据场景选择最优流程，将手动 speckit 命令统一为一次触发：

| 模式 | 命令 | 阶段数 | 人工介入 | 适用场景 |
|------|------|--------|----------|---------|
| **run** | `/speckitdriver:run` | 10 | ≤ 4 次 | 全新功能、大型需求（含调研） |
| **story** | `/speckitdriver:story` | 5 | ≤ 2 次 | 常规需求变更、功能迭代 |
| **fix** | `/speckitdriver:fix` | 4 | ≤ 1 次 | Bug 修复、问题定位 |
| **resume** | `/speckitdriver:resume` | - | - | 恢复中断的流程 |
| **sync** | `/speckitdriver:sync` | 3 | 0 次 | 聚合 spec 为产品活文档 |

## 安装

```bash
claude plugin install speckitdriver
```

## 使用方法

### 完整研发流程（run）

```bash
/speckitdriver:run 给项目添加用户认证功能，支持 OAuth2 和 JWT
```

10 阶段编排：Constitution → 产品调研 → 技术调研 → 产研汇总 → 规范 → 澄清 → 规划 → 任务 → 实现 → 验证

### 快速需求实现（story）

```bash
/speckitdriver:story 给用户列表添加分页功能
```

5 阶段快速通道：Constitution → 规范（基于代码分析）→ 规划+任务 → 实现 → 验证。**跳过调研阶段**，直接分析现有代码和 spec 文档。

### 快速问题修复（fix）

```bash
/speckitdriver:fix 登录页面在移动端布局错位
```

4 阶段极速修复：诊断（根因定位）→ 修复规划 → 代码修复 → 验证。自动分析代码和 spec 定位根因，修复后自动同步 spec。

### 恢复中断的流程（resume）

```bash
/speckitdriver:resume
```

### 产品规范聚合（sync）

```bash
/speckitdriver:sync
```

### 选择性重跑

```bash
/speckitdriver:run --rerun plan
```

### 临时切换模型预设

```bash
/speckitdriver:run --preset quality-first "添加支付系统"
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

- **独立于 reverse-spec plugin**：Speckitdriver 是正向研发工具，reverse-spec 是逆向分析工具，互补关系
- **共享 `.specify/memory/constitution.md`**：复用项目宪法
- **兼容已有 speckit skills**：检测到项目已有定制版 speckit skills 时优先使用

## 目录结构

```text
plugins/speckitdriver/
├── .claude-plugin/plugin.json    # Plugin 元数据
├── hooks/hooks.json              # SessionStart hook
├── skills/
│   ├── run/SKILL.md              # 完整 10 阶段编排
│   ├── story/SKILL.md            # 快速 5 阶段需求实现
│   ├── fix/SKILL.md              # 快速 4 阶段问题修复
│   ├── resume/SKILL.md           # 中断恢复
│   └── sync/SKILL.md             # 产品规范聚合
├── agents/                       # 12 个子代理 prompt
├── templates/                    # 6 个模板
├── scripts/                      # 初始化脚本
└── README.md
```

### 迁移说明（v2.0.0）

Plugin 名称从 `speckit-driver-pro` 更名为 `speckitdriver`，新增 story 和 fix 快速模式：

| 旧命令 | 新命令 |
| ------ | ------ |
| `/speckit-driver-pro:run <需求>` | `/speckitdriver:run <需求>` |
| `/speckit-driver-pro:resume` | `/speckitdriver:resume` |
| `/speckit-driver-pro:sync` | `/speckitdriver:sync` |
| （新增） | `/speckitdriver:story <需求>` |
| （新增） | `/speckitdriver:fix <问题>` |

## 许可证

MIT
