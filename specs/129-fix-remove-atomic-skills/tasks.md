---
description: "Task list for fix F2.5 — 删除 spec-driver 遗留原子 skill"
---

# Tasks: 删除 spec-driver 遗留原子 skill（Fix F2.5）

**输入文档**: `specs/129-fix-remove-atomic-skills/`
**前置条件**: plan.md（已完成 Codebase Reality Check）、fix-report.md（scope 定义）
**风险等级**: HIGH（影响文件 ~26、跨包 5 个、含合同变更）
**模式**: fix（无 User Story 结构，无 FR 覆盖映射）

## 概述

本次修复分两个主要阶段实施，对应 plan.md 中的两阶段拆分：

- **阶段 1（核心事实建立）**：删除 9 个原子 skill 文件 + 同步更新 2 份合同 YAML + 修复 1 个集成测试 setup。验证面收敛，可独立提交并验证通过。
- **阶段 2（一致性恢复）**：清理所有 stale reference（9 处 prompt / template / script）+ 更新 2 份 README + 新建迁移指南 + 添加 CHANGELOG 条目 + regen Codex wrapper。阶段内文件各自独立，大量可并行。
- **Final Phase（验证 & Polish）**：跑完整验证套件，手动确认命令面板状态。

两阶段在同一 PR 中完成，但建议以 commit 粒度分离，以便按阶段回滚。

---

## Phase 1: 核心事实建立（合同与删除）

**目标**: 删除 9 个原子 skill 文件，同步改 2 份合同声明，修复集成测试 setup，使仓库在"原子 skill 不存在"这一新事实下保持合同一致。

**独立验证**:
```bash
npm run repo:check          # 合同一致性——最关键
npx vitest run tests/integration/runtime-boundary-contract.test.ts
npx vitest run              # 完整套件
npm run build
```

**checkpoint**: 以上全部通过后，才能推进阶段 2。

### 删除原子 skill 文件（可并行，建议统一 `git rm`）

- [ ] T001 [P] 删除 `.claude/commands/spec-driver.analyze.md`（`git rm .claude/commands/spec-driver.analyze.md`）
- [ ] T002 [P] 删除 `.claude/commands/spec-driver.checklist.md`（`git rm .claude/commands/spec-driver.checklist.md`）
- [ ] T003 [P] 删除 `.claude/commands/spec-driver.clarify.md`（`git rm .claude/commands/spec-driver.clarify.md`）
- [ ] T004 [P] 删除 `.claude/commands/spec-driver.constitution.md`（`git rm .claude/commands/spec-driver.constitution.md`）
- [ ] T005 [P] 删除 `.claude/commands/spec-driver.implement.md`（`git rm .claude/commands/spec-driver.implement.md`）
- [ ] T006 [P] 删除 `.claude/commands/spec-driver.plan.md`（`git rm .claude/commands/spec-driver.plan.md`）
- [ ] T007 [P] 删除 `.claude/commands/spec-driver.specify.md`（`git rm .claude/commands/spec-driver.specify.md`）
- [ ] T008 [P] 删除 `.claude/commands/spec-driver.tasks.md`（`git rm .claude/commands/spec-driver.tasks.md`）
- [ ] T009 [P] 删除 `.claude/commands/spec-driver.taskstoissues.md`（`git rm .claude/commands/spec-driver.taskstoissues.md`）

> 实践提示：可一行完成：`git rm .claude/commands/spec-driver.analyze.md .claude/commands/spec-driver.checklist.md .claude/commands/spec-driver.clarify.md .claude/commands/spec-driver.constitution.md .claude/commands/spec-driver.implement.md .claude/commands/spec-driver.plan.md .claude/commands/spec-driver.specify.md .claude/commands/spec-driver.tasks.md .claude/commands/spec-driver.taskstoissues.md`

### 合同同步（与删除同步，必须在 repo:check 之前完成）

- [ ] T010 修改 `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml`：将 `claudeProjectOverrides.entries` 区块（L44–62）内的全部 9 条 entry 删除，保留 `claudeProjectOverrides` 区块头（`classification`、`root`、`note`），将 `entries` 改为空列表 `[]` 或完全移除 `entries` key。

- [ ] T011 修改 `contracts/runtime-boundary-contract.yaml`：从 `claude.requiredFiles` 列表中删除 `.claude/commands/spec-driver.implement.md` 一条（L14），保留 `.claude/settings.json`；确保列表格式仍是合法 YAML。

### 测试 setup 修复

- [ ] T012 修改 `tests/integration/runtime-boundary-contract.test.ts`：删除 L47 处 `writeFileSync(..., 'spec-driver.implement.md', ...)` 这一行；同步检查后续断言中是否有对该文件存在的显式 expect，若有则一并删除；确保测试仍对 `.claude/settings.json` 的 requiredFiles 行为进行正确断言。

---

## Phase 2: 一致性恢复（stale reference 清理 + 文档 + regen）

**目标**: 清理所有因原子 skill 删除而产生的悬空引用，更新用户面向文档，regen Codex wrapper，使用户体验和维护者体验与"原子 skill 不再存在"这一事实完全一致。

**独立验证**:
```bash
npm run repo:check
npx vitest run
npm run codex:spec-driver:install   # regen wrapper
npm run build
# 手动：ls .claude/commands/ | grep spec-driver  → 应为空
# 手动：Claude Code 命令面板搜索 spec-driver:spec-driver-feature → 应可见
```

> 阶段 2 内各任务针对不同文件，全部可并行（[P]），等阶段 1 通过后可并发执行。

### Skill prompt 悬空引用清理

- [ ] T013 [P] 修改 `plugins/spec-driver/skills/spec-driver-constitution/SKILL.md`：将触发方式段（L17）的 `/spec-driver.constitution` 改为 `/spec-driver:spec-driver-constitution`（self-declaration 入口，本 SKILL.md 自身的触发命令）。

- [ ] T014 [P] 修改 `plugins/spec-driver/skills/spec-driver-implement/SKILL.md`：将 L74 处的 `/spec-driver.constitution` 改为 `/spec-driver:spec-driver-constitution`。

- [ ] T015 [P] 修改 `plugins/spec-driver/skills/spec-driver-resume/SKILL.md`：将 L55（实际行号，fix-report 标注 L49 有偏差）处的 `/spec-driver.constitution` 改为 `/spec-driver:spec-driver-constitution`。

- [ ] T016 [P] 修改 `plugins/spec-driver/skills/spec-driver-story/SKILL.md`：将 L56（实际行号，fix-report 标注"L79 左右"有偏差）处的 `/spec-driver.constitution` 改为 `/spec-driver:spec-driver-constitution`。

- [ ] T017 [P] 修改 `plugins/spec-driver/agents/constitution.md`：将 L99 处的 `/spec-driver.constitution` 改为 `/spec-driver:spec-driver-constitution`。

- [ ] T018 [P] 修改 `plugins/spec-driver/scripts/lib/init-project-output.sh`：将 L56 处的 `/spec-driver.constitution` 引用改为 `/spec-driver:spec-driver-constitution`（此文件为 plan.md 补充发现，fix-report 未列出，属于同类 stale reference）。

### 前置检查脚本悬空引用清理

- [ ] T019 [P] 修改 `.specify/scripts/bash/check-prerequisites.sh`：将 L105、L111、L118 三处错误提示中的原子命令引用改为对应编排器命令——L105 处改为推荐 `/spec-driver:spec-driver-feature`；L111 处改为推荐 `/spec-driver:spec-driver-implement --entry-point=plan`；L118 处改为推荐 `/spec-driver:spec-driver-implement`。

### 模板注释悬空引用清理

- [ ] T020 [P] 修改 `plugins/spec-driver/templates/specify-base/plan-template.md`：将 L6 注释和 L72–77 注释中的 `/spec-driver.plan`、`/spec-driver.tasks` 等具体原子命令引用改为中性描述（如"由 plan 阶段生成"、"由 tasks 阶段生成"），或直接删除对具体命令的引用。

- [ ] T021 [P] 修改 `plugins/spec-driver/templates/specify-base/tasks-template.md`：将 L32 注释中的 `/spec-driver.tasks` 改为中性描述（如"由 tasks 阶段生成"）。

- [ ] T022 [P] 修改 `plugins/spec-driver/templates/specify-base/checklist-template.md`：将 L7、L13 注释中的 `/spec-driver.checklist` 改为中性描述（如"由 checklist 阶段生成"）。

### 产品文档更新

- [ ] T023 [P] 修改 `README.md`：将 L499–527 "Individual Phase Commands" 原子 skill 命令参考段替换为编排器 skill 参考（列出 9 个编排器命令及其简要说明），并在段末增加指向 `docs/migrations/skill-deprecation.md` 的链接，注明"原子命令用户请参阅迁移指南"。

- [ ] T024 [P] 修改 `plugins/spec-driver/README.md`：将 L76 处的 `/spec-driver.constitution` 改为 `/spec-driver:spec-driver-constitution`；将 L340–356 命令映射表改写——新增"已弃用的原子命令"列与"当前编排器命令"列的对照，或在映射表后补充迁移说明段落，保留 L347–355 历史参考但标注"已弃用"。

### 新建迁移文档

- [ ] T025 [P] 新建 `docs/migrations/skill-deprecation.md`：内容包括——背景说明（原子 skill 于 v4.x 起弃用，原因是编排器 skill 已完整覆盖所有旧场景）；完整的一一映射表（旧原子命令 → 新编排器命令，共 9 条）；使用示例（至少展示 2–3 个典型调用对比）；升级指引（如何确认旧命令已消失）。

- [ ] T026 [P] 更新 `CHANGELOG.md`（文件已存在则在顶部追加，不存在则新建）：添加 breaking change 条目，说明版本节点、删除的 9 个原子命令列表、迁移指引链接（`docs/migrations/skill-deprecation.md`）。

### Codex wrapper regen（依赖 T013–T016 完成）

- [ ] T027 执行 `npm run codex:spec-driver:install`：regen `.codex/skills/spec-driver-constitution/SKILL.md`、`.codex/skills/spec-driver-implement/SKILL.md`、`.codex/skills/spec-driver-resume/SKILL.md`、`.codex/skills/spec-driver-story/SKILL.md` 四份 wrapper，确保 Codex 环境与 source SKILL.md 保持一致。**此任务必须在 T013–T016 完成后执行。**

---

## Final Phase: 验证 & Polish

**目标**: 对 Phase 1 + Phase 2 的全量产出执行验证套件，收集实际输出作为 verification-report 的依据。

**前置条件**: Phase 1 和 Phase 2 全部任务完成（包括 T027 regen）。

- [ ] T028 运行 `npm run repo:check` 并收集完整输出；预期：零错误，不再因 `.claude/commands/spec-driver.*.md` 不存在而报 fail。

- [ ] T029 运行 `npx vitest run` 并收集完整输出；预期：全绿（`export-command.test.ts` 如有 pre-existing failure 可标注排除，但须记录）。

- [ ] T030 运行 `npm run build` 并收集完整输出；预期：TypeScript 类型检查零错误。

- [ ] T031 手动验证：在 worktree 根目录执行 `ls .claude/commands/ | grep spec-driver`，预期输出为空（零匹配）。

- [ ] T032 手动验证：在 Claude Code 命令面板中搜索 `spec-driver.specify`，预期显示"无匹配命令"；搜索 `spec-driver:spec-driver-feature`，预期正常显示。

- [ ] T033 [P] 手动验证：打开 `plugins/spec-driver/skills/spec-driver-constitution/SKILL.md` 和 `.codex/skills/spec-driver-constitution/SKILL.md`，确认触发方式段均为 `/spec-driver:spec-driver-constitution`（非旧格式）。

- [ ] T034 [P] 执行旧命令引用残留扫描，确认清理彻底：
  ```bash
  grep -rn "/spec-driver\." plugins/spec-driver/ --include="*.md" --include="*.sh" --include="*.yaml"
  ```
  预期：无 `/spec-driver.constitution`、`/spec-driver.specify` 等旧格式引用（`plugins/spec-driver/README.md` 中有历史参考标注"已弃用"的行除外）。

---

## Dependencies & 并行说明

### Phase 间依赖

```
Phase 1（T001–T012）
    ↓ 全部通过 repo:check + vitest 验证后
Phase 2（T013–T026）  ←— 阶段内大量 [P] 可并发
    ↓ T013–T016 完成后
T027（regen Codex wrapper）
    ↓ Phase 2 全部 + T027 完成后
Final Phase（T028–T034）
```

### Phase 2 内部并行机会

Phase 2 的 14 个任务（T013–T026）针对不同文件，无相互依赖，可全部并行执行，**唯一例外**是 T027（regen）必须在 T013–T016 四个 SKILL.md 改完后才能运行。

实践建议：Phase 2 的 T013–T026 可一次性并发启动；T027 等待 T013–T016 完成信号后立即执行。

### Final Phase 内部并行

T028（repo:check）、T029（vitest）、T030（build）三个验证命令彼此独立，可并行运行。T031–T034 手动验证步骤之间也无依赖。

---

## 实施策略

**推荐：按阶段串行 commit，以便按阶段验证和回滚。**

### Commit 1：阶段 1（核心事实）

```
fix(129): 删除原子 skill 文件并同步更新合同与测试 setup [Phase 1]

- git rm .claude/commands/spec-driver.{analyze,checklist,clarify,constitution,implement,plan,specify,tasks,taskstoissues}.md
- 清空 plugins/spec-driver/contracts/wrapper-source-of-truth.yaml 中的 claudeProjectOverrides.entries
- 从 contracts/runtime-boundary-contract.yaml requiredFiles 移除 spec-driver.implement.md
- 移除 tests/integration/runtime-boundary-contract.test.ts 中对应的 writeFileSync setup

验证：npm run repo:check 通过 + npx vitest run 通过
```

### Commit 2：阶段 2（一致性恢复）

```
fix(129): 清理 stale reference，更新文档，regen Codex wrapper [Phase 2]

- 清理 9 处 /spec-driver.* 悬空引用（4 个 SKILL.md + 1 agents + 1 sh + 3 template）
- 更新 README.md 和 plugins/spec-driver/README.md 命令参考段
- 新建 docs/migrations/skill-deprecation.md 迁移指南
- 追加 CHANGELOG.md breaking change 条目
- 执行 npm run codex:spec-driver:install regen 4 个 Codex wrapper

验证：npm run repo:check 通过 + npx vitest run 通过 + npm run build 通过
```

两次 commit 在同一 PR 中，PR 合并前经 Final Phase 手动验证确认。

---

## 任务汇总

| 阶段 | 任务范围 | 任务数 | 可并行数 | 并行率 |
|------|----------|--------|----------|--------|
| Phase 1 | T001–T012 | 12 | 9（T001–T009 删除） | 75% |
| Phase 2 | T013–T027 | 15 | 14（T013–T026 全部，T027 有前置） | 93% |
| Final Phase | T028–T034 | 7 | 6（T028–T030 + T033–T034） | 86% |
| **合计** | T001–T034 | **34** | **29** | **~85%** |
