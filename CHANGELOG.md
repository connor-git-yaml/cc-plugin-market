# Changelog

本文件记录 cc-plugin-market（Spectra + Spec Driver）仓库的重要变更。
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)，
破坏性变更（major bump）会在条目头标注 **BREAKING**。

## [Unreleased]

### spec-driver — BREAKING

- **删除 9 个遗留原子命令** `/spec-driver.{specify,plan,tasks,implement,clarify,analyze,checklist,constitution,taskstoissues}`。这些命令由 spec 032 从 speckit 重命名继承而来，但功能长期落后于 `plugins/spec-driver/skills/spec-driver-*/` 下的编排器 Skill，且两套零代码依赖、互不调用，长期造成命令面板混乱与维护双倍负担。
- 所有旧原子命令的能力均已被编排器 Skill 覆盖。迁移映射、使用示例与升级步骤详见 [`docs/migrations/skill-deprecation.md`](docs/migrations/skill-deprecation.md)。
- 同步变更：
  - `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` 中 `claudeProjectOverrides.entries` 清空（9 条 → 0 条）
  - `contracts/runtime-boundary-contract.yaml` 中 `claude.requiredFiles` 移除 `.claude/commands/spec-driver.implement.md`
  - 所有 `plugins/spec-driver/skills/*/SKILL.md` 与 `plugins/spec-driver/agents/constitution.md` 中的 `/spec-driver.constitution` 引用改为 `/spec-driver:spec-driver-constitution`
  - `.codex/skills/spec-driver-{constitution,implement,resume,story}/SKILL.md` 通过 `npm run codex:spec-driver:install` 同步再生
  - `README.md`、`plugins/spec-driver/README.md` 的命令参考段与迁移映射表已更新
  - `.specify/scripts/bash/check-prerequisites.sh` 与 `plugins/spec-driver/scripts/lib/init-project-output.sh` 的错误提示已指向编排器 Skill
  - `plugins/spec-driver/templates/specify-base/{plan,tasks,checklist}-template.md` 注释中的原子命令引用已改为中性描述
- Codex 用户不受影响：`$spec-driver-*` 入口保持原状，所有功能通过编排器 Skill 继续提供。

### 影响评估

- 用户手工调用 `/spec-driver.specify` 等旧命令将得到"command not found"，需要按迁移指南改为对应编排器入口。
- 用户项目 `.claude/commands/` 下的自定义 `spec-driver.*.md` 覆盖文件**不会被自动清理**，建议参照迁移指南手动处理。
- Spectra 插件、仓库发布流程（`npm run repo:check` / `npm run release:sync`）、已有 spec/plan/tasks 制品均不受影响。

### 相关 PR / Spec

- Spec: `specs/129-fix-remove-atomic-skills/`（fix-report.md / plan.md / tasks.md）
