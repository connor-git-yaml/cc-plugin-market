# 问题修复报告 — 删除 spec-driver 遗留原子 skill

**Feature**: F2.5（Phase 2 — Spectra as Code Reading Platform）
**分支**: `claude/objective-tereshkova-e812f4`（worktree，已对齐 `origin/master`）
**模式**: fix（架构冗余清理，scope 中等）
**诊断日期**: 2026-04-19

## 问题描述

spec-driver 插件并存**两套重复** skill 实现：

| 套件 | 位置 | 规模 | 状态 |
|------|------|------|------|
| 原子 skill（要删） | `.claude/commands/spec-driver.{specify,plan,tasks,implement,clarify,analyze,checklist,constitution,taskstoissues}.md` | 9 个文件 / 1392 行 | 薄 outline + 脚本调用，落后 |
| 编排器 skill（保留） | `plugins/spec-driver/skills/spec-driver-{feature,implement,story,fix,resume,sync,doc,constitution,refactor}/` | 9 个 skill | 完整多步 prompt + Constitution Check + Impact Radius |

两套互不调用，命令面板对用户同时可见，造成入口混乱、维护双倍。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何命令面板会同时出现两套入口？ | `.claude/commands/spec-driver.*.md` 和 `plugins/spec-driver/skills/spec-driver-*/SKILL.md` 都注册为 user-invocable |
| Why 2 | 为何两者并存？ | spec 032 从 speckit 重命名 9 个原子 skill；后续 spec（feature/story/fix/doc/sync/...）引入编排器 skill，但没删原子 |
| Why 3 | 为何引入编排器时没删原子？ | 设计假设"编排器调用原子作为底层 subroutine" |
| Why 4 | 为何假设不成立？ | 编排器实际用 Task tool 委派到 `plugins/spec-driver/agents/*.md` prompt，从不 dispatch 到原子 skill；两套零代码依赖 |
| Why 5 | 为何没被捕获？ | 缺少"skill 使用度"监控；`wrapper-source-of-truth.yaml` 把 `.claude/commands/spec-driver.*.md` 登记为 `classification: "project-override"`，明确标注"不是 plugin source-of-truth"，但没触发弃用流程 [ROOT CAUSE REACHED at Why 5] |

**Root Cause**: spec 032 仅完成重命名，未规划旧原子 skill 的生命周期；后续编排器开发按新范式独立演进，形成"遗留层 + 新层"并存的历史债务，且无弃用机制。

**Root Cause Chain**: 命令面板混乱 → 两套入口并存 → 原子与编排器零代码依赖 → 编排器不调用原子 → spec 032 未规划生命周期 → 缺弃用流程

## 影响范围扫描

### 同源问题（必删）

| 文件 | 分类 | 动作 |
|------|------|------|
| `.claude/commands/spec-driver.analyze.md` | 原子 skill | 删除 |
| `.claude/commands/spec-driver.checklist.md` | 原子 skill | 删除 |
| `.claude/commands/spec-driver.clarify.md` | 原子 skill | 删除 |
| `.claude/commands/spec-driver.constitution.md` | 原子 skill | 删除 |
| `.claude/commands/spec-driver.implement.md` | 原子 skill | 删除 |
| `.claude/commands/spec-driver.plan.md` | 原子 skill | 删除 |
| `.claude/commands/spec-driver.specify.md` | 原子 skill | 删除 |
| `.claude/commands/spec-driver.tasks.md` | 原子 skill | 删除 |
| `.claude/commands/spec-driver.taskstoissues.md` | 原子 skill | 删除 |

### 合同一致性（必改，coupled change）

删除上述文件**必然破坏**以下合同里声明的"必须存在"条目。不同步改 = `npm run repo:check` 一定失败。

| 文件 | 位置 | 动作 | 理由 |
|------|------|------|------|
| `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` | `claudeProjectOverrides.entries` 9 条 | 删除这 9 条（整个 `claudeProjectOverrides` 区块改为空 entries 或移除） | `validate-wrapper-sources.mjs:144-167` 会检查每条 entry 的 target 文件是否存在；文件删 + 登记留 → fail |
| `contracts/runtime-boundary-contract.yaml` | `claude.requiredFiles` 中 `.claude/commands/spec-driver.implement.md` | 从列表移除 | `validate-runtime-boundaries.mjs` 会检查 requiredFiles；文件删 + 合同留 → fail |

### 悬空引用清理（必改，coupled change）

删除文件后，以下 prompt / template / script 中 `/spec-driver.{cmd}` 字面 slash command 会指向不存在的命令，变成 stale reference。不改 = 用户照 prompt 指引执行会得到 "command not found"。

| 文件 | 位置 | 动作 |
|------|------|------|
| `.specify/scripts/bash/check-prerequisites.sh` | L105, L111, L118 错误提示 `Run /spec-driver.specify/plan/tasks first` | 改为推荐编排器 skill（如 `/spec-driver:spec-driver-feature` 或 `/spec-driver:spec-driver-implement`） |
| `plugins/spec-driver/skills/spec-driver-implement/SKILL.md` | L74 `/spec-driver.constitution` | 改为 `/spec-driver:spec-driver-constitution` |
| `plugins/spec-driver/skills/spec-driver-resume/SKILL.md` | L49, 引用 `/spec-driver.constitution` | 同上 |
| `plugins/spec-driver/skills/spec-driver-story/SKILL.md` | L79 左右 | 同上 |
| `plugins/spec-driver/skills/spec-driver-constitution/SKILL.md` | 触发方式段 `/spec-driver.constitution` | 改为 `/spec-driver:spec-driver-constitution`（自身入口，重要） |
| `plugins/spec-driver/agents/constitution.md` | L99 | 改为 `/spec-driver:spec-driver-constitution` |
| `plugins/spec-driver/templates/specify-base/plan-template.md` | L6, L72-77 注释 `/spec-driver.plan`/`/spec-driver.tasks` | 改为编排器 skill 或改为中性描述（"由 plan 阶段生成"） |
| `plugins/spec-driver/templates/specify-base/tasks-template.md` | L32 | 同上 |
| `plugins/spec-driver/templates/specify-base/checklist-template.md` | L7, L13 | 同上 |

**读写边界说明**：Prompt 原文 `plugins/spec-driver/**: 默认只读，例外：发现编排器 entryPoint 空白时可补齐`。本组改动不是 entryPoint 补齐，但是**删除文件的必然衍生**（stale reference 清理），否则完成标准"本 Feature 完成后 /spec-driver.specify 应得 command not found" 会与"spec-driver-implement SKILL.md 指引用户跑 /spec-driver.constitution" 产生内部矛盾。GATE_DESIGN 阶段请用户批准此范围。

### 产品文档更新（必改）

| 文件 | 位置 | 动作 |
|------|------|------|
| `README.md` | L505-526（顶层命令参考段） | 替换为编排器 skill 参考 + 指向迁移指南 |
| `plugins/spec-driver/README.md` | L76（constitution 说法），L347-355（命令映射表） | 改写为编排器 skill |
| `CHANGELOG.md` | （新 entry） | 添加 breaking change 条目 |
| `docs/migrations/skill-deprecation.md` | （新建） | 迁移指南 + 映射表 + 示例 |

### 测试更新（必改）

| 文件 | 位置 | 动作 |
|------|------|------|
| `tests/integration/runtime-boundary-contract.test.ts` | L47 `writeFileSync(..., 'spec-driver.implement.md', ...)` | 删除此 setup 行；可能需要相应调整测试断言（因为 `requiredFiles` 不再含该文件） |

### 再生成产物（执行同步脚本）

| 产物 | 脚本 | 理由 |
|------|------|------|
| `.codex/skills/spec-driver-{constitution,implement,resume,story}/SKILL.md` 四份 wrapper | `npm run codex:spec-driver:install` | Codex wrapper 由 `plugins/spec-driver/skills/*/SKILL.md` 通过 source-of-truth 脚本生成；source 改后必须 regen |

### 类似模式（已评估安全，不改）

| 文件 | 评估 |
|------|------|
| `plugin.json` / `.claude-plugin/marketplace.json` | 不引用原子 skill；描述里只提"八种模式"（新编排器） |
| `contracts/release-contract.yaml` | 不引用原子 skill |
| `tests/integration/spec-driver-init-project.test.ts` | 测试 `detect_spec_driver_skills` 函数行为，在临时目录自建 `.claude/commands/spec-driver.plan.md`，不受仓库文件删除影响 |
| `plugins/spec-driver/scripts/init-project.sh` 的 `detect_spec_driver_skills` 函数 | 保留（向后兼容：在别的项目里可能还有原子 skill override） |
| `specs/032-*`, `specs/038-*`, `specs/081-*` 等历史 spec | 历史记录，不改（按仓规） |
| `.codex/skills/` 下 8 个编排器 skill | 由 source-of-truth 生成，sync 阶段自动 regen |

### 同步更新清单汇总

- **文件删除**: 9 个（`.claude/commands/spec-driver.*.md`）
- **文件修改**: 14 个（2 合同 + 2 README + 5 prompt + 3 template + 1 script + 1 test）
- **文件新增**: 2 个（`docs/migrations/skill-deprecation.md`、`CHANGELOG.md` entry，如该文件不存在则新建）
- **再生成**: `.codex/skills/` 下 4 个 wrapper（由 `npm run codex:spec-driver:install` 处理）
- **测试验证**: `.claude/commands/spec-driver.*.md` → 零文件；`detect_spec_driver_skills` 在本仓库返回 `HAS_SPEC_DRIVER_SKILLS=false`（符合预期）

## Entry Point 覆盖性验证

Prompt 前置调查怀疑 `spec-driver-refactor` 和 `spec-driver-constitution` entryPoint 空白。**重新验证结论**：

| 迁移映射 | 新入口 | 实现路径 | 状态 |
|----------|--------|----------|------|
| 全流程 specify→plan→tasks→implement | `/spec-driver:spec-driver-feature` | `plugins/spec-driver/skills/spec-driver-feature/` + `workflows/spec-driver-feature.yaml` | ✅ 完整 |
| 跳过调研快速跑 | `/spec-driver:spec-driver-story` | `skills/spec-driver-story/` + `workflows/spec-driver-story.yaml` | ✅ 完整 |
| 只跑 implement | `/spec-driver:spec-driver-implement` | `skills/spec-driver-implement/` + `workflows/spec-driver-implement.yaml` | ✅ 完整 |
| 只跑 plan | `/spec-driver:spec-driver-implement --entry-point=plan` | 同上（通过 entry-point 参数） | ✅ 完整 |
| 修 bug | `/spec-driver:spec-driver-fix` | `skills/spec-driver-fix/` + `workflows/spec-driver-fix.yaml` | ✅ 完整 |
| 大规模重构 | `/spec-driver:spec-driver-refactor` | `skills/spec-driver-refactor/SKILL.md` | ✅ **单阶段原子 skill**（无需 workflow yaml） |
| 项目宪法 | `/spec-driver:spec-driver-constitution` | `skills/spec-driver-constitution/SKILL.md` | ✅ **单阶段原子 skill**（无需 workflow yaml） |
| 生成 README | `/spec-driver:spec-driver-doc` | `skills/spec-driver-doc/` + `workflows/spec-driver-doc.yaml` | ✅ 完整 |
| 聚合产品文档 | `/spec-driver:spec-driver-sync` | `skills/spec-driver-sync/` + `workflows/spec-driver-sync.yaml` | ✅ 完整 |

**结论**：**不存在 entryPoint 空白**。constitution 和 refactor 只作为单阶段 skill 存在（不需要多步 orchestrator），是合理设计，不是遗漏。**本 Feature 不需要补齐 `plugins/spec-driver/**` 任何新 workflow yaml**。

## 修复策略

### 方案 A（推荐）

**一次性完整删除 + 合同同步 + 迁移指南**。分 6 步：

1. 删除 9 个 `.claude/commands/spec-driver.*.md`
2. 改 2 份合同 YAML（wrapper-source-of-truth + runtime-boundary-contract）
3. 清理 9 处 stale reference（prompt + template + script）
4. 更新 2 份 README + 新建 migration guide + CHANGELOG
5. 调整 1 个测试 setup
6. 运行 `npm run codex:spec-driver:install` 再生 `.codex/skills/*`

**优点**: 一次到位，状态一致。
**风险**: scope 不算小（14 改 + 2 新 + 9 删 + 脚本 regen），但全部是机械性替换，无设计决策。
**验证**: `npm run repo:check` + `npx vitest run` + `npm run build`。

### 方案 B（备选，不推荐）

只删 9 个文件 + 写迁移指南 + 关键合同改（wrapper-source + runtime-boundary）。
其他 stale reference 打 TODO，留下次清理。

**缺点**: 留下 stale reference，`plugins/spec-driver/skills/` 下 skill prompt 会指向 "command not found" 的命令，污染 skill 行为；用户按指引操作会报错。

### 推荐

**方案 A**。scope 虽然比"9 个文件 + 迁移指南"大一倍，但属于 fix 语义下的 coupled change：删文件 = 必然触发合同与悬空引用清理。不处理等于"修 bug 时故意留新 bug"。

## Spec 影响

本 Feature 不更新任何现有 spec.md（没有单独的产品 spec 承载"原子 skill"作为特性）。相关历史 spec（`specs/032-rename-speckit-to-spec-driver`）记录当时的重命名事实，不改。

Feature 制品产出：
- `specs/129-fix-remove-atomic-skills/fix-report.md`（本文件）
- `specs/129-fix-remove-atomic-skills/plan.md`（Phase 2 产出）
- `specs/129-fix-remove-atomic-skills/tasks.md`（Phase 2 产出）
- `specs/129-fix-remove-atomic-skills/verification/verification-report.md`（Phase 4 产出）

## 范围过大检测

- 受影响**独立编辑点**数（新增 + 修改 + 删除）= 9 + 14 + 2 = 25
- 涉及模块数：`.claude/commands/`（删）、`plugins/spec-driver/{contracts,skills,agents,templates}/`、`contracts/`、`docs/migrations/`（新）、`tests/integration/`、`.specify/scripts/bash/`、`README.md`、`plugins/spec-driver/README.md`、`CHANGELOG.md` = 10 个模块
- **阈值**：fix skill 文档 "文件 > 10 或 模块 > 3" 触发切换建议

**评估**：超出 fix 典型阈值，但**不切换到 feature/story 模式**。理由：
1. 本质是**原子操作**：所有改动围绕一个单一事实（9 个文件不再存在）派生
2. 无新设计、无新架构、无新合同结构
3. feature/story 模式的调研/规范阶段对这类清理不产生价值
4. 切换模式会把 1 个事实拆成多个 spec，反而污染 spec 树

fix 模式的"快速"本质是"短决策路径"，不是"少改动"。当前场景满足。

---

**下一步**: Phase 2 生成 plan.md 和 tasks.md，GATE_DESIGN 请用户确认是否批准方案 A 的 coupled changes 范围。
