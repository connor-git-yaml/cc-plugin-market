# Quickstart: 003-skill-init

**Date**: 2026-02-12

## 核心变更概览

### 新增文件

| 文件 | 用途 |
| --- | --- |
| `src/cli/commands/init.ts` | `init` 子命令入口 |
| `src/installer/skill-installer.ts` | 安装/卸载核心逻辑（共享模块） |
| `src/installer/skill-templates.ts` | 3 个 SKILL.md 的模板内容常量 |
| `tests/unit/skill-installer.test.ts` | 安装核心逻辑单元测试 |
| `tests/unit/init-command.test.ts` | init 命令单元测试 |
| `tests/integration/init-e2e.test.ts` | init 端到端集成测试 |

### 修改文件

| 文件 | 变更 |
| --- | --- |
| `src/cli/utils/parse-args.ts` | 新增 `init` 子命令 + `--global`/`--remove` 选项解析 |
| `src/cli/index.ts` | 新增 `init` 命令分发 + 更新帮助文本 |
| `src/scripts/postinstall.ts` | 重构为调用 `skill-installer.installSkills()` |
| `src/scripts/preuninstall.ts` | 重构为调用 `skill-installer.removeSkills()` |
| `tests/unit/skill-registrar.test.ts` | 适配新的 installer 模块 |

## 实现顺序

```text
Phase 1: 基础模块
  T001: skill-templates.ts（3 个 SKILL.md 模板内容）
  T002: skill-installer.ts（installSkills / removeSkills / resolveTargetDir / formatSummary）
  T003: skill-installer.test.ts（单元测试）

Phase 2: CLI 集成
  T004: parse-args.ts 扩展（init + --global + --remove）
  T005: init.ts 命令入口
  T006: index.ts 分发 + 帮助文本
  T007: init-command.test.ts + parse-args 测试扩展

Phase 3: 脚本重构
  T008: postinstall.ts 重构
  T009: preuninstall.ts 重构
  T010: skill-registrar.test.ts 适配

Phase 4: 集成测试与验证
  T011: init-e2e.test.ts
  T012: 全量测试回归验证
```

## 关键决策

1. **SKILL.md 模板存储为代码**: 模板内容作为 TypeScript 字符串常量（非磁盘读取），确保 npx 场景可靠
2. **内联降级逻辑**: SKILL.md 中 bash 代码块内联 `command -v` 三级降级，无独立脚本文件
3. **全局 > 项目优先级**: Claude Code 的规则，安装提示中说明
4. **不修改 .gitignore**: 由用户自行决定版本控制策略（FR-015）
