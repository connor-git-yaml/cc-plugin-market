# Skill Deprecation — 原子命令到编排器 Skill 的迁移指南

**生效版本**: spec-driver v4.0
**影响范围**: Claude Code 用户（Codex 用户不受影响，见下方说明）
**破坏性变更**: 是（删除 9 个 `/spec-driver.{phase}` 原子命令）

---

## 背景

自 spec-driver v3.x 起，仓库长期并存两套 skill 分发路径：

- **原子 skill**：`.claude/commands/spec-driver.{specify,plan,tasks,implement,clarify,analyze,checklist,constitution,taskstoissues}.md` —— 单阶段 prompt outline + 脚本调用，由早期 speckit 重命名而来
- **编排器 skill**：`plugins/spec-driver/skills/spec-driver-{feature,implement,story,fix,resume,sync,doc,constitution,refactor}/SKILL.md` —— 多阶段 prompt，携带 Constitution Check、Impact Radius、并行子代理调度等现代能力

两套零代码依赖、互不调用，但都对用户的命令面板可见，长期造成：

- 用户不清楚应该调用哪一组命令
- 同一修改必须在两处维护，长期有漂移
- 原子 skill 在 spec 032 重命名之后**从未进入正式生命周期管理**，功能长期落后编排器

v4.0 起，原子 skill 被整体删除；所有能力由编排器 Skill 提供。

## 迁移映射表

| 旧原子命令 | 新编排器入口 | 使用场景 |
|----------|------------|----------|
| `/spec-driver.specify` → `/spec-driver.plan` → `/spec-driver.tasks` → `/spec-driver.implement` 全跑 | `/spec-driver:spec-driver-feature <需求>` | 完整 Spec-Driven 流程（含调研） |
| 跳过调研，快速跑全流程 | `/spec-driver:spec-driver-story <需求>` | 已有清晰需求，想最短路径实现 |
| 只跑 `/spec-driver.implement`（spec / plan / tasks 已存在） | `/spec-driver:spec-driver-implement` | 对成熟 spec 做实施 |
| 只跑 `/spec-driver.plan`（更新已有 plan） | `/spec-driver:spec-driver-implement --entry-point=plan` | 更新已有计划 |
| 修 bug（原本需拼接 4 步原子命令） | `/spec-driver:spec-driver-fix <问题>` | 4 阶段：诊断 → 规划 → 修复 → 验证 |
| 大规模重构 | `/spec-driver:spec-driver-refactor <目标>` | 5 阶段：影响分析 → 分批规划 → 逐批实现 → 残留扫描 → 最终验证 |
| `/spec-driver.constitution` | `/spec-driver:spec-driver-constitution` | 创建/更新项目宪法（单阶段 skill，无多步编排） |
| 生成 README 等开源文档 | `/spec-driver:spec-driver-doc` | 交互式生成 README / LICENSE / CONTRIBUTING / CODE_OF_CONDUCT |
| 聚合 feature spec 为产品文档 | `/spec-driver:spec-driver-sync` | 合并 `specs/` 为 `current-spec.md` + catalog |
| 中断后恢复 | `/spec-driver:spec-driver-resume` | 从上一份制品继续编排 |
| `/spec-driver.clarify` | 由编排器内部 `clarify` 阶段处理 | 通常不直接调用，编排器自动触发 |
| `/spec-driver.analyze` | 由编排器内部 `analyze` 阶段处理 | 通常不直接调用，编排器自动触发 |
| `/spec-driver.checklist` | 由编排器内部 `checklist` 阶段处理 | 通常不直接调用，编排器自动触发 |
| `/spec-driver.tasks` | 由 feature/story/implement 编排器内的 tasks 阶段处理 | 通常不直接调用，编排器自动触发 |
| `/spec-driver.taskstoissues` | 由 feature 编排器在 tasks 后继承处理 | 通常不直接调用 |

## 使用示例对比

### 示例 1：开发一个新功能

**v3.x（已删除）**：
```
/spec-driver.specify 给用户添加订阅功能
/spec-driver.plan
/spec-driver.tasks
/spec-driver.implement
```

**v4.x（推荐）**：
```
/spec-driver:spec-driver-feature 给用户添加订阅功能
```

一条命令走完全流程；编排器会按需触发 clarify / analyze / checklist 子阶段。

### 示例 2：只重新跑 plan 阶段

**v3.x（已删除）**：
```
/spec-driver.plan
```

**v4.x（推荐）**：
```
/spec-driver:spec-driver-implement --entry-point=plan
```

编排器会直接跳入 plan 阶段，重用已有 spec.md。

### 示例 3：修 bug

**v3.x（已删除 → 没有直接等价流程，要手动拼 4 步）**

**v4.x（推荐）**：
```
/spec-driver:spec-driver-fix 登录页面在 Safari 上刷新后状态丢失
```

编排器会走完 4 阶段：5-Why 诊断 → 修复规划 → 代码修复 → 验证闭环。

## 如何确认旧命令已消失

在项目根目录执行：

```bash
ls .claude/commands/ | grep spec-driver
```

期望输出：**空**（原子 skill 文件已全部删除）。

在 Claude Code 命令面板中：

- 搜索 `spec-driver.specify` → 无匹配
- 搜索 `spec-driver:spec-driver-feature` → 正常显示
- 搜索 `spec-driver:spec-driver-constitution` → 正常显示

## Codex 用户说明

Codex 的命令入口是 `$spec-driver-*`，不受本次变更影响：

- `$spec-driver-feature`、`$spec-driver-story`、`$spec-driver-fix` 等依然可用
- `$spec-driver-constitution` 依然是 constitution 入口
- 所有 `.codex/skills/spec-driver-*/SKILL.md` 由 `npm run codex:spec-driver:install` 从 `plugins/spec-driver/skills/` 生成，与原子命令无关

## 自定义命令文件（可选清理）

如果您的项目 `.claude/commands/` 下有从旧版遗留或手工复制的 `spec-driver.*.md` 文件（原子命令覆盖），v4.0 后编排器已不再读取它们。建议：

1. 将它们从版本控制中移除：`git rm .claude/commands/spec-driver.*.md`
2. 若里面有自定义 prompt 需要保留，迁移到编排器 skill 的对应 agent prompt（`plugins/spec-driver/agents/*.md`）

## FAQ

**Q: 我习惯了分阶段调用原子命令看中间产物，现在怎么办？**
A: 编排器每个阶段都会在 `specs/NNN-*/` 下输出制品（spec.md / plan.md / tasks.md / fix-report.md 等），且在 GATE_DESIGN、GATE_VERIFY 等门禁点暂停交互。所有中间产物仍可逐阶段审查。

**Q: `--entry-point` 参数支持哪些阶段？**
A: `spec-driver-implement` 支持 `plan`、`tasks`、`implement`、`verify`；其他编排器按各自 skill 内部定义。

**Q: 本次变更是否影响 `.codex/commands/` 目录？**
A: 不影响。本次只删除 `.claude/commands/spec-driver.*.md`（Claude 侧），Codex 侧通过 `$spec-driver-*` 入口始终由编排器生成，无独立原子命令。

## 相关合同变更

- `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml`：`claudeProjectOverrides.entries` 清空（从 9 条到 0 条）
- `contracts/runtime-boundary-contract.yaml`：`claude.requiredFiles` 移除 `.claude/commands/spec-driver.implement.md`
- 所有 `plugins/spec-driver/skills/*/SKILL.md` 中 `/spec-driver.constitution` 引用改为 `/spec-driver:spec-driver-constitution`
- `.codex/skills/spec-driver-{constitution,implement,resume,story}/SKILL.md` 已通过 `npm run codex:spec-driver:install` 同步再生

## 反馈

若您在迁移过程中遇到特定场景无法映射到新编排器 skill，请在项目 Issue 中描述具体命令和使用场景。
