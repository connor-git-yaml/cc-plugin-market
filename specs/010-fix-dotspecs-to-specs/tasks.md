# Tasks: 统一 spec 输出目录引用（.specs → specs）

**Input**: Design documents from `specs/010-fix-dotspecs-to-specs/`
**Prerequisites**: plan.md, spec.md, research.md, quickstart.md

**Tests**: 不新增测试文件。在 Polish 阶段验证全量测试和构建通过。

**Organization**: 3 个 User Story（源代码常量 → CLI/SKILL.md → 文档），按优先级分阶段实施。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: User Story 1 - 源代码默认路径常量统一 (Priority: P1)

**Goal**: 将所有源代码中的 `.specs` 默认路径常量改为 `specs`

**Independent Test**: `grep -r '\.specs' src/ --include='*.ts'` 返回零结果

- [x] T001 [US1] 修改 `src/core/single-spec-orchestrator.ts` 中默认 `outputDir` 从 `'.specs'` 改为 `'specs'`（行 244）
- [x] T002 [P] [US1] 修改 `src/batch/batch-orchestrator.ts` 中所有硬编码的 `'.specs'` 目录引用为 `'specs'`（行 131、145、233、243 共 4 处）
- [x] T003 [P] [US1] 修改 `src/batch/checkpoint.ts` 中 `DEFAULT_CHECKPOINT_PATH` 从 `'.specs/.reverse-spec-checkpoint.json'` 改为 `'specs/.reverse-spec-checkpoint.json'`（行 11），同步更新注释
- [x] T004 [P] [US1] 修改 `src/mcp/server.ts` 中 `outputDir` 的 zod default 从 `'.specs'` 改为 `'specs'`（行 67）
- [x] T005 [P] [US1] 修改 `src/cli/commands/batch.ts` 中输出消息 `.specs/_index.spec.md` 改为 `specs/_index.spec.md`（行 36）
- [x] T006 [P] [US1] 修改 `src/installer/skill-templates.ts` 中所有 `.specs` 引用为 `specs`（行 68、98、112、114 共 4 处）
- [x] T007 [P] [US1] 修改 `.gitignore` 中 checkpoint 路径从 `.specs/.reverse-spec-checkpoint.json` 改为 `specs/.reverse-spec-checkpoint.json`

**Checkpoint**: 所有 `src/` 下的 `.ts` 文件和 `.gitignore` 中不再包含 `.specs` 引用

---

## Phase 2: User Story 2 - CLI 帮助文本和 SKILL.md 模板路径统一 (Priority: P2)

**Goal**: 所有 SKILL.md 文件中的 `.specs` 引用改为 `specs`

**Independent Test**: `grep -r '\.specs' src/skills-global/ plugins/reverse-spec/skills/ --include='*.md'` 返回零结果

- [x] T008 [P] [US2] 修改 `src/skills-global/reverse-spec/SKILL.md` 中所有 `.specs` 引用为 `specs`（5 处）
- [x] T009 [P] [US2] 修改 `src/skills-global/reverse-spec-batch/SKILL.md` 中所有 `.specs` 引用为 `specs`（6 处）
- [x] T010 [P] [US2] 修改 `plugins/reverse-spec/skills/reverse-spec/SKILL.md` 中所有 `.specs` 引用为 `specs`（5 处）
- [x] T011 [P] [US2] 修改 `plugins/reverse-spec/skills/reverse-spec-batch/SKILL.md` 中所有 `.specs` 引用为 `specs`（6 处）

**Checkpoint**: 所有 SKILL.md 文件中不再包含 `.specs` 引用

---

## Phase 3: User Story 3 - 设计文档和 README 路径统一 (Priority: P3)

**Goal**: 项目文档中所有 `.specs` 引用改为 `specs`

**Independent Test**: `grep -r '\.specs' CLAUDE.md plugins/reverse-spec/README.md specs/001-*/ specs/002-*/ specs/009-*/` 返回零结果

- [x] T012 [P] [US3] 修改 `CLAUDE.md` 中 `.specs/` 引用为 `specs/`（1 处）
- [x] T013 [P] [US3] 修改 `plugins/reverse-spec/README.md` 中 `.specs` 引用为 `specs`（2 处）
- [x] T014 [P] [US3] 修改 `specs/001-reverse-spec-v2/quickstart.md` 中所有 `.specs` 引用为 `specs`
- [x] T015 [P] [US3] 修改 `specs/001-reverse-spec-v2/data-model.md` 中 `.specs` 引用为 `specs`
- [x] T016 [P] [US3] 修改 `specs/001-reverse-spec-v2/contracts/core-pipeline.md` 中所有 `.specs` 引用为 `specs`
- [x] T017 [P] [US3] 修改 `specs/001-reverse-spec-v2/contracts/batch-module.md` 中所有 `.specs` 引用为 `specs`
- [x] T018 [P] [US3] 修改 `specs/002-cli-global-distribution/quickstart.md` 中 `.specs` 引用为 `specs`
- [x] T019 [P] [US3] 修改 `specs/002-cli-global-distribution/contracts/cli-interface.md` 中所有 `.specs` 引用为 `specs`
- [x] T020 [P] [US3] 修改 `specs/009-plugin-marketplace/plan.md` 中 `.specs` 引用为 `specs`
- [x] T021 [P] [US3] 修改 `specs/009-plugin-marketplace/contracts/mcp-server.md` 中 `.specs` 引用为 `specs`

**Checkpoint**: 所有项目文档（排除 008 和 010 历史 spec）中不再包含 `.specs` 引用

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: 确保所有改动不破坏现有功能

- [x] T022 运行 `npm run build` 确认 TypeScript 编译通过
- [x] T023 运行 `npm run lint` 确认无类型错误
- [x] T024 运行 `npm test` 确认全部现有测试通过
- [x] T025 运行 quickstart.md 场景 1-3 验证：全量搜索 `.specs` 确认零匹配
- [x] T026 运行 quickstart.md 场景 5 验证：`.gitignore` checkpoint 路径正确

---

## Dependencies & Execution Order

### Phase Dependencies

- **US1 (Phase 1)**: 无依赖，可立即开始
- **US2 (Phase 2)**: 与 US1 独立，可并行
- **US3 (Phase 3)**: 与 US1/US2 独立，可并行
- **Polish (Phase 4)**: 依赖全部 User Story 完成

### Parallel Opportunities

- T001-T007 全部可并行（不同文件）
- T008-T011 全部可并行（不同文件）
- T012-T021 全部可并行（不同文件）
- US1、US2、US3 三个 Phase 可完全并行（无交叉文件依赖）
- T022、T023、T024 可并行（不同命令）

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: US1（源代码常量修改）
2. **STOP and VALIDATE**: `grep -r '\.specs' src/ --include='*.ts'` 返回零结果

### Incremental Delivery

1. US1 → 源代码运行时路径正确
2. US2 → SKILL.md 文档路径一致
3. US3 → 所有项目文档路径统一
4. Polish → 全量验证通过

---

## Notes

- 总计 26 个任务（US1: 7 + US2: 4 + US3: 10 + Polish: 5）
- 所有三个 Phase（US1/US2/US3）可完全并行执行
- Feature 008 的历史 spec/tasks 不修改（保留历史准确性）
- Feature 010 自身的 spec/checklist 不修改（引用 `.specs` 是描述性文本）
- 纯字符串替换，不涉及功能变更
