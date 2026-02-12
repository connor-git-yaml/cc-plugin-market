# Tasks: CLI 全局分发与 Skill 自动注册

**Input**: Design documents from `/specs/002-cli-global-distribution/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: 包含测试任务（项目已有 148 个测试，contracts/ 中已定义测试契约）。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 项目配置变更和目录结构创建

- [x] T001 更新 package.json：添加 `bin`、`files`、lifecycle `scripts` 字段，参照 contracts/cli-interface.md 中的 package.json 变更契约
- [x] T002 [P] 创建目录结构：`src/cli/commands/`、`src/cli/utils/`、`src/scripts/`、`src/skills-global/reverse-spec/`、`src/skills-global/reverse-spec-batch/`、`src/skills-global/reverse-spec-diff/`
- [x] T003 [P] 验证 tsconfig.json 编译配置：确认 `src/cli/` 和 `src/scripts/` 被包含在编译范围内，outDir 为 `dist/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: CLI 参数解析和错误处理基础设施，所有子命令和 lifecycle 脚本共享

**CRITICAL**: 所有 User Story 实现都依赖本阶段完成

- [x] T004 创建 CLI 参数解析器 in `src/cli/utils/parse-args.ts`：解析 `process.argv`，输出 CLICommand 对象（参照 data-model.md CLICommand 实体定义），支持 `generate`/`batch`/`diff` 子命令及全局选项 `--version`/`--help`/`--output-dir`
- [x] T005 [P] 创建错误处理工具 in `src/cli/utils/error-handler.ts`：友好的中文错误信息输出，包括无 ANTHROPIC_API_KEY、无 tsconfig.json、目标路径不存在等场景，使用 `process.exitCode` 设置退出码
- [x] T006 [P] 编写 CLI 参数解析单元测试 in `tests/unit/cli-commands.test.ts`：覆盖 contracts/skill-registrar.md 中定义的 8 个测试用例（generate/batch/diff 解析、--version、--help、无效子命令、缺少 target、--output-dir）

**Checkpoint**: CLI 基础设施就绪，子命令和 lifecycle 脚本开发可以开始

---

## Phase 3: User Story 1 — 全局安装并在其他项目中使用 (Priority: P1) MVP

**Goal**: 用户通过 `npm install -g reverse-spec` 后，可在任意项目目录使用 `reverse-spec generate/batch/diff` 命令

**Independent Test**: 在全新项目目录运行 `reverse-spec generate src/`，验证 specs/ 下生成 .spec.md 文件

### Implementation for User Story 1

- [x] T007 [P] [US1] 实现 generate 子命令 in `src/cli/commands/generate.ts`：解析 `<target>` 和 `--deep` 参数，验证路径存在，调用 `generateSpec()`，输出进度信息和结果，设置退出码（参照 contracts/cli-interface.md 退出码定义）
- [x] T008 [P] [US1] 实现 batch 子命令 in `src/cli/commands/batch.ts`：解析 `--force` 参数，调用 `runBatch(cwd(), { force, onProgress })`，输出进度条和结果摘要，设置退出码
- [x] T009 [P] [US1] 实现 diff 子命令 in `src/cli/commands/diff.ts`：解析 `<spec-file>` 和 `<source>` 参数，调用 `detectDrift()`，根据漂移严重级别设置退出码（0=LOW, 1=MEDIUM/HIGH, 2=错误）
- [x] T010 [US1] 创建 CLI 入口点 in `src/cli/index.ts`：添加 `#!/usr/bin/env node` shebang，读取 package.json 版本号，调用参数解析器，调度到对应子命令，输出帮助文本（参照 contracts/cli-interface.md 帮助输出格式）
- [x] T011 [US1] 编译验证：运行 `npm run build`，确认 `dist/cli/index.js` 存在且首行为 `#!/usr/bin/env node`，确认 `dist/cli/commands/*.js` 和 `dist/scripts/*.js` 正确生成
- [x] T012 [US1] 本地 CLI 测试：通过 `node dist/cli/index.js --version`、`node dist/cli/index.js --help`、`node dist/cli/index.js generate src/core/ast-analyzer.ts` 验证基本功能

**Checkpoint**: CLI 三个子命令可通过 `node dist/cli/index.js` 正常运行

---

## Phase 4: User Story 2 — Skill 自动注册到 Claude Code (Priority: P2)

**Goal**: 全局安装后三个 SKILL.md 自动出现在 `~/.claude/skills/`，Claude Code 中可直接使用 `/reverse-spec`

**Independent Test**: 运行 `npm_config_global=true node dist/scripts/postinstall.js` 后检查 `~/.claude/skills/` 确认三个文件存在

### Implementation for User Story 2

- [x] T013 [P] [US2] 创建全局版 SKILL.md in `src/skills-global/reverse-spec/SKILL.md`：基于本地版 `skills/reverse-spec/SKILL.md` 的指令逻辑，将调用方式从 `npx tsx ./src/...` 替换为 `reverse-spec generate` CLI 命令
- [x] T014 [P] [US2] 创建全局版 SKILL.md in `src/skills-global/reverse-spec-batch/SKILL.md`：基于本地版，将调用方式替换为 `reverse-spec batch` CLI 命令
- [x] T015 [P] [US2] 创建全局版 SKILL.md in `src/skills-global/reverse-spec-diff/SKILL.md`：基于本地版，将调用方式替换为 `reverse-spec diff` CLI 命令
- [x] T016 [US2] 实现 postinstall 脚本 in `src/scripts/postinstall.ts`：检测 `npm_config_global`，使用 `os.homedir()` + `import.meta.dirname` 定位文件，`fs.mkdirSync` + `fs.copyFileSync` 注册三个 SKILL.md，参照 contracts/skill-registrar.md 核心逻辑
- [x] T017 [US2] 编写 Skill 注册单元测试 in `tests/unit/skill-registrar.test.ts`：覆盖 contracts/skill-registrar.md 中定义的 6 个测试用例（全局注册、本地跳过、目录创建、权限错误、卸载清理、其他 skill 不受影响），使用 mock fs

**Checkpoint**: 全局安装后三个 skill 在 Claude Code 中 100% 可被发现

---

## Phase 5: User Story 3 — 干净卸载 (Priority: P3)

**Goal**: 卸载时自动清理注册的 skill 文件，不影响其他 skill

**Independent Test**: 运行 `npm_config_global=true node dist/scripts/preuninstall.js` 后确认三个 skill 目录已删除

### Implementation for User Story 3

- [x] T018 [US3] 实现 preuninstall 脚本 in `src/scripts/preuninstall.ts`：检测 `npm_config_global`，使用 `fs.rmSync` 删除三个 reverse-spec skill 目录，参照 contracts/skill-registrar.md 安全保证（不删除父目录）
- [x] T019 [US3] 在 `tests/unit/skill-registrar.test.ts` 中补充卸载测试：验证仅删除 reverse-spec 相关目录、其他 skill 不受影响、目录不存在时不报错

**Checkpoint**: 卸载后 `~/.claude/skills/` 中 reverse-spec 相关文件 100% 被清理

---

## Phase 6: User Story 4 — 本地开发向后兼容 (Priority: P3)

**Goal**: 项目本地的 `skills/` 和 `npx tsx` 工作流不受影响

**Independent Test**: 运行 `npm test` 确认所有 148 个现有测试通过

### Implementation for User Story 4

- [x] T020 [US4] 验证本地 SKILL.md 未被修改：确认 `skills/reverse-spec/SKILL.md`、`skills/reverse-spec-batch/SKILL.md`、`skills/reverse-spec-diff/SKILL.md` 仍使用 `npx tsx` 调用方式
- [x] T021 [US4] 运行全量测试套件：执行 `npm test` 确认所有 148 个现有测试通过，执行 `npm run lint` 确认 TypeScript 编译无错误

**Checkpoint**: 全部现有功能和测试不受影响

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 集成测试、文档更新、端到端验证

- [x] T022 [P] 编写 CLI 端到端集成测试 in `tests/integration/cli-e2e.test.ts`：测试 `generate`/`batch`/`diff` 子命令的完整流程（使用项目自身源码作为测试目标），验证退出码和输出文件
- [x] T023 [P] 更新 README.md：添加全局安装方式（`npm install -g reverse-spec`），更新使用说明中的 CLI 命令示例
- [x] T024 运行 quickstart.md 全部验证步骤：按照 specs/002-cli-global-distribution/quickstart.md 的 6 个步骤逐一验证

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖 — 立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1 完成 — BLOCKS 所有 User Story
- **US1 (Phase 3)**: 依赖 Phase 2 完成
- **US2 (Phase 4)**: 依赖 Phase 2 完成，可与 US1 并行
- **US3 (Phase 5)**: 依赖 US2（需要 postinstall 先完成才能测试 preuninstall）
- **US4 (Phase 6)**: 依赖 US1 完成（确保 CLI 不破坏现有功能）
- **Polish (Phase 7)**: 依赖所有 User Story 完成

### User Story Dependencies

```text
Phase 1 (Setup)
    ↓
Phase 2 (Foundational)
    ├── Phase 3 (US1: CLI) ──────→ Phase 6 (US4: 兼容性验证)
    └── Phase 4 (US2: 注册) ──→ Phase 5 (US3: 卸载)
                                        ↓
                                Phase 7 (Polish)
```

### Within Each User Story

- T007/T008/T009 (三个子命令) 可并行编写
- T013/T014/T015 (三个全局 SKILL.md) 可并行编写
- T010 (CLI 入口) 依赖 T007/T008/T009 完成
- T016 (postinstall) 依赖 T013/T014/T015 完成

### Parallel Opportunities

- Phase 2 中 T005 和 T006 可并行（不同文件）
- Phase 3 中 T007/T008/T009 可并行（三个独立子命令文件）
- Phase 4 中 T013/T014/T015 可并行（三个独立 SKILL.md）
- Phase 7 中 T022 和 T023 可并行

---

## Parallel Example: User Story 1

```bash
# 三个子命令可并行编写:
Task: "实现 generate 子命令 in src/cli/commands/generate.ts"
Task: "实现 batch 子命令 in src/cli/commands/batch.ts"
Task: "实现 diff 子命令 in src/cli/commands/diff.ts"
```

## Parallel Example: User Story 2

```bash
# 三个全局 SKILL.md 可并行创建:
Task: "创建全局版 SKILL.md in src/skills-global/reverse-spec/SKILL.md"
Task: "创建全局版 SKILL.md in src/skills-global/reverse-spec-batch/SKILL.md"
Task: "创建全局版 SKILL.md in src/skills-global/reverse-spec-diff/SKILL.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T006)
3. Complete Phase 3: User Story 1 (T007-T012)
4. **STOP and VALIDATE**: `node dist/cli/index.js generate src/` 在新项目中生成 spec
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → CLI 基础设施就绪
2. User Story 1 → CLI 可用 → MVP!
3. User Story 2 → Skill 自动注册 → 完整 Claude Code 集成
4. User Story 3 → 干净卸载 → 分发质量达标
5. User Story 4 → 兼容性验证 → 回归安全
6. Polish → e2e 测试 + README → 发布就绪

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- 本功能不引入任何新的 npm 运行时依赖（Constitution V）
- CLI 入口使用编译后的 `dist/cli/index.js`，不依赖 tsx
- 本地 `skills/` 目录中的 SKILL.md 保持不变（FR-012）
- 所有 lifecycle 脚本错误均为警告，不中断 npm install/uninstall
- Commit after each task or logical group
