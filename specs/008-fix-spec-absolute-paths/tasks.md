# Tasks: 修复 Spec 输出中的绝对路径问题

**Input**: Design documents from `specs/008-fix-spec-absolute-paths/`
**Prerequisites**: plan.md, spec.md, research.md, contracts/path-normalization.md

**Tests**: 不新增测试文件，仅在 Polish 阶段验证全量测试通过。

**Organization**: 仅 1 个 User Story（P1），任务按修改步骤线性排列。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1)
- Include exact file paths in descriptions

---

## Phase 1: User Story 1 - Spec 中的路径对所有用户可读 (Priority: P1)

**Goal**: 将 `sourceTarget` 从绝对路径转换为相对于项目根目录的相对路径，同时统一 `relatedFiles` 的基准路径

**Independent Test**: 在任意项目中运行 `reverse-spec generate src/some-module`，检查生成的 spec 文件中标题和 frontmatter 的 `sourceTarget` 字段是否为相对路径

### Implementation for User Story 1

- [x] T001 [US1] 修改 `src/core/single-spec-orchestrator.ts` 中 `generateSpec()` 函数：将行 327 的 `const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd()` 提前到行 317（frontmatter 生成之前），删除原行 327 的重复定义
- [x] T002 [US1] 修改 `src/core/single-spec-orchestrator.ts` 中 `generateSpec()` 函数：将行 319 的 `sourceTarget: targetPath` 改为 `sourceTarget: path.relative(baseDir, path.resolve(targetPath))`，将行 320 的 `relatedFiles: filePaths.map((f) => path.relative(process.cwd(), f))` 改为 `relatedFiles: filePaths.map((f) => path.relative(baseDir, f))`
- [x] T003 [US1] 验证 `src/generator/index-generator.ts` 中 `buildModuleMap()` 的 `sourceTarget.includes(n.source)` 和 `sourceTarget.split('/')[0]` 匹配逻辑在相对路径下仍正确工作（无需修改，仅确认）

**Checkpoint**: `sourceTarget` 和标题输出相对路径，`relatedFiles` 基准统一为 `baseDir`

---

## Phase 2: Polish & Validation

**Purpose**: 确保所有改动不破坏现有功能，全量测试和构建通过

- [x] T004 运行 `npm test` 确认全部测试通过，修复任何因路径变更导致的测试失败
- [x] T005 运行 `npm run lint` 确认无 lint 错误
- [x] T006 运行 `npm run build` 确认 TypeScript 编译通过

---

## Dependencies & Execution Order

### Phase Dependencies

- **US1 (Phase 1)**: 无依赖，可立即开始
- **Polish (Phase 2)**: 依赖 US1 全部完成

### Within User Story 1

- T001 必须在 T002 之前执行（T002 依赖 T001 定义的 `baseDir` 变量）
- T003 独立于 T001/T002（仅验证性任务）

### Parallel Opportunities

- T004、T005、T006 彼此独立可并行验证

---

## Implementation Strategy

### MVP (US1)

1. 完成 T001：提前 `baseDir` 定义
2. 完成 T002：修改 `sourceTarget` 和 `relatedFiles`
3. 完成 T003：确认索引生成器兼容
4. **验证**：`npm test` 通过即可确认修复生效

### Full Delivery

1. T001-T003 → 路径修复
2. T004-T006 → 全量验证

---

## Notes

- 总计 6 个任务，仅涉及 1 个源文件的代码修改
- T003 是验证性任务（确认不需要修改），非编码任务
- 预计总改动量 <10 行代码
- 索引生成器的 `includes()` 匹配在相对路径下更准确（dependency-cruiser 返回的 `n.source` 也是相对路径）
