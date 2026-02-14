# Tasks: 修复 Spec 输出中的绝对路径问题

**Input**: Design documents from `specs/008-fix-spec-absolute-paths/`
**Prerequisites**: plan.md, spec.md, research.md, contracts/path-normalization.md

**Tests**: 不新增测试文件，仅在 Polish 阶段验证全量测试通过。

**Organization**: 仅 1 个 User Story（P1），分三轮实施。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1)
- Include exact file paths in descriptions

---

## Phase 1: User Story 1 - Spec 中的路径对所有用户可读 (Priority: P1)

**Goal**: 将所有 spec 输出中的绝对路径转换为相对路径，并将输出目录改为 `.specs`

**Independent Test**: 在任意项目中运行 `reverse-spec generate src/some-module`，检查生成的 spec 文件中所有路径均为相对路径

### Round 1: frontmatter 和标题（已完成）

- [x] T001 [US1] 修改 `src/core/single-spec-orchestrator.ts` 中 `generateSpec()` 函数：将行 327 的 `const baseDir` 提前到行 317（frontmatter 生成之前），删除原行 327 的重复定义
- [x] T002 [US1] 修改 `src/core/single-spec-orchestrator.ts` 中 `generateSpec()` 函数：将 `sourceTarget: targetPath` 改为 `sourceTarget: path.relative(baseDir, path.resolve(targetPath))`，将 `relatedFiles` 基准从 `process.cwd()` 改为 `baseDir`
- [x] T003 [US1] 验证 `src/generator/index-generator.ts` 中 `buildModuleMap()` 的匹配逻辑在相对路径下仍正确工作（无需修改，仅确认）

### Round 2: Mermaid 图、baseline skeleton、输出目录

- [x] T007 [US1] 修改 `src/core/single-spec-orchestrator.ts` 中 `generateSpec()` 函数：在调用 `generateDependencyDiagram()` 之前，将 `mergedSkeleton.filePath` 转换为相对于 `baseDir` 的相对路径，确保 Mermaid 图节点使用相对路径
- [x] T008 [US1] 修改 `src/core/single-spec-orchestrator.ts` 中 `generateSpec()` 函数：在构建 `moduleSpec` 时，将 `baselineSkeleton` 的 `filePath` 转换为相对于 `baseDir` 的相对路径，确保 HTML 注释中序列化的 skeleton 不含绝对路径
- [x] T009 [P] [US1] 修改 `src/core/single-spec-orchestrator.ts` 中默认 `outputDir` 从 `'specs'` 改为 `'.specs'`（行 244）
- [x] T010 [P] [US1] 修改 `src/batch/batch-orchestrator.ts` 中所有硬编码的 `'specs'` 目录引用为 `'.specs'`（行 131、145、233、243 共 4 处）

**Checkpoint**: Mermaid 图、baseline skeleton、输出目录全部使用相对路径或正确目录名

### Round 3: checkpoint 文件路径

- [x] T014 [P] [US1] 修改 `src/batch/checkpoint.ts` 中 `DEFAULT_CHECKPOINT_PATH` 从 `'specs/.reverse-spec-checkpoint.json'` 改为 `'.specs/.reverse-spec-checkpoint.json'`（行 11），同步更新注释
- [x] T015 [P] [US1] 修改 `.gitignore` 中 checkpoint 路径从 `specs/.reverse-spec-checkpoint.json` 改为 `.specs/.reverse-spec-checkpoint.json`（行 36）

**Checkpoint**: 断点恢复检查点默认路径与输出目录 `.specs` 一致

---

## Phase 2: Polish & Validation

**Purpose**: 确保所有改动不破坏现有功能，全量测试和构建通过

- [x] T004 运行 `npm test` 确认全部测试通过，修复任何因路径变更导致的测试失败
- [x] T005 运行 `npm run lint` 确认无 lint 错误
- [x] T006 运行 `npm run build` 确认 TypeScript 编译通过
- [x] T011 运行 `npm test` 确认 Round 2 改动后全部测试通过
- [x] T012 运行 `npm run lint` 确认无 lint 错误
- [x] T013 运行 `npm run build` 确认 TypeScript 编译通过
- [x] T016 运行 `npm test` 确认 Round 3 改动后全部测试通过
- [x] T017 运行 `npm run lint` 确认无 lint 错误
- [x] T018 运行 `npm run build` 确认 TypeScript 编译通过

---

## Dependencies & Execution Order

### Phase Dependencies

- **US1 Round 1 (Phase 1)**: 已完成
- **US1 Round 2 (Phase 1)**: T007 和 T008 依赖 Round 1 的 baseDir；T009 和 T010 独立
- **US1 Round 3 (Phase 1)**: T014 和 T015 独立，与 Round 2 无依赖
- **Polish (Phase 2)**: 依赖 US1 全部完成

### Parallel Opportunities

- T009 和 T010 可并行（修改不同文件）
- T014 和 T015 可并行（修改不同文件）
- T011、T012、T013 可并行
- T016、T017、T018 可并行

---

## Notes

- 总计 18 个任务（Round 1: 3 + Round 2: 4 + Round 3: 2 + Polish: 9）
- Round 3 涉及 2 个文件：`checkpoint.ts`、`.gitignore`
- baseline skeleton 的 filePath Zod schema 要求以 `.ts/.js` 结尾——相对路径同样满足此约束
