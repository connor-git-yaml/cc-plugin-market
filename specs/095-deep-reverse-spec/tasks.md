# Tasks: 深度代码反求增强（Feature 095）

**Feature Branch**: `095-deep-reverse-spec`
**Input**: `specs/095-deep-reverse-spec/plan.md` + `specs/095-deep-reverse-spec/spec.md`
**推荐执行序**: Phase 2-D（Prompt 更新）→ Phase 3-A（切片提取器）→ Phase 4-C（上下文组装）→ Phase 5-B（目录分类）→ Phase 6（Polish）

---

## Phase 1: Setup（前提检查）

- [x] T001 确认 `ExportSymbol` 含 `startLine`/`endLine` 字段
- [x] T002 确认 `AssemblyOptions` 接口可扩展
- [x] T003 确认 `ProjectConfig` 接口可扩展

---

## Phase 2: 任务组 D — LLM Prompt 更新与占位符消除（P1）

**FR**: FR-002、FR-003、FR-012

### D1：消除 parseLLMResponse 占位符注入

- [x] T004 修改 `src/core/llm-client.ts`（~第 538-544 行）
  - [x] 正常流程不注入"此章节待补充"，改为 parseWarnings + 空字符串
  - [x] 仅 LLM 降级时保留 `generateAstOnlyContent` 降级路径

### D2：强化 buildSystemPrompt 占位符禁止约束

- [x] T005 修改 `src/core/llm-client.ts`（`buildSystemPrompt`，spec-generation 分支）
  - [x] 追加"绝对禁止占位符"约束段
  - [x] Section 2 要求行为摘要，Section 3 要求 Mermaid 流程图

### D3：增强 generateAstOnlyContent（降级路径）

- [x] T006 修改 `src/core/single-spec-orchestrator.ts`（`generateAstOnlyContent`）
  - [x] Section 2：从 skeleton.exports 生成签名表格
  - [x] Section 3：从 skeleton.imports 生成 Mermaid 依赖图

### D4：修复 python-mapper 属性提取

- [x] T007 修改 `src/core/query-mappers/python-mapper.ts`
  - [x] 识别 `__init__` 中 `self.xxx = ...` 赋值，作为 kind: 'property' 的 MemberInfo
  - [x] visibility：`__xxx` → private，`_xxx` → protected，其余 public

---

## Phase 3: 任务组 A — 代码切片提取器（P1）

**FR**: FR-001、FR-004、FR-010

### A1：定义 CodeSlice 类型

- [x] T008 在 `src/models/code-skeleton.ts` 追加 CodeSlice 接口和 CodeSlicePriority 枚举

### A2：新建 CodeSliceExtractor

- [x] T009 新建 `src/core/code-slice-extractor.ts`（~80 行）
  - [x] `extractCodeSlices(skeletons, sourceFiles, options)` 主函数
  - [x] `_extractSliceFromLines`：保留控制流行（if/for/try/return/调用），移除注释和空行
  - [x] `_calcPriority`：P1=公开导出，P2=多处import，P3=复杂控制流
  - [x] Token 预算裁剪：按 priority ASC 贪心保留
  - [x] 空函数体和 minified 文件跳过

### A3：单元测试

- [x] T010 新建 `tests/unit/code-slice-extractor.test.ts`
  - [x] 控制流行保留 + 注释移除
  - [x] 优先级排序
  - [x] Token 预算裁剪
  - [x] 空函数体跳过
  - [x] Minified 检测

---

## Phase 4: 任务组 C — 上下文增强组装器（P1）

**FR**: FR-007、FR-008、FR-010

### C1：扩展 AssemblyOptions

- [x] T011 修改 `src/core/context-assembler.ts` 类型定义
  - [x] 新增 `codeSlices?: CodeSlice[]` 和 `readmeContext?: string`

### C2：实现新裁剪优先级

- [x] T012 修改 `src/core/context-assembler.ts`（assembleContext 函数）
  - [x] 新增 `formatCodeSlices` 和 `formatReadmeContext` 内部函数
  - [x] 裁剪顺序：skeleton > codeSlices > readmeContext > codeSnippets > dependencies

### C3：prepareContext 插入切片和 README

- [x] T013 修改 `src/core/single-spec-orchestrator.ts`（prepareContext）
  - [x] 步骤 2.5：调用 extractCodeSlices
  - [x] 步骤 2.6：读取 README.md
  - [x] 传入 assembleContext

### C4：product-overview README 上下文

- [x] T014 在 batch 生成 product-overview 时注入 readmeContext（通过 T013 的 prepareContext 路径覆盖）

---

## Phase 5: 任务组 B — 目录分类器（P2）

**FR**: FR-005、FR-006、FR-013

### B1：扩展 UNIVERSAL_IGNORE_DIRS

- [x] T015 修改 `src/utils/file-scanner.ts` 新增 dist/build/vendor/examples 等

### B2：定义 DirectoryClassification 类型

- [x] T016 新建 `src/batch/directory-classifier.ts` 类型定义

### B3：实现三信号分类逻辑

- [x] T017 实现 `classifyDirectory` 和 `classifyDirectories`
  - [x] 信号 1：目录名模式（examples→example, vendor→vendor）
  - [x] 信号 2：Minified 内容检测
  - [x] 信号 3：Import 反向引用覆盖
  - [x] 用户覆盖优先级最高

### B4：集成 module-grouper

- [x] T018 修改 `src/batch/module-grouper.ts` 新增 classifyDirectories 选项

### B5：ProjectConfig 用户覆盖

- [x] T019 修改 `src/config/project-config.ts` 新增 excludeDirs/includeDirs

### B6：目录分类器测试

- [x] T020 新建 `tests/unit/directory-classifier.test.ts`

---

## Phase 6: Polish

- [x] T021 FR-011 降级保护：extractCodeSlices try/catch 包裹（已在 prepareContext 步骤 2.5 实现）
- [x] T022 FR-010 token 预算验证 + breakdown 日志（已在 assembleContext 的 console.warn 日志实现）
- [x] T023 多语言混合切片验证（已在 code-slice-extractor.test.ts 覆盖）
- [x] T024 空函数体边界验证（已在 code-slice-extractor.test.ts 覆盖）
- [x] T025 更新 checklists/requirements.md FR-Task 映射（FR 映射已在 tasks.md 底部维护，无独立 checklists 文件）
- [ ] T026 graphify 端到端验收（SC-001/002/004/005）[E2E_DEFERRED]
- [ ] T027 claude-obsidian 端到端验收（SC-003）[E2E_DEFERRED]
- [ ] T028 无 API Key 环境验收（SC-006）[E2E_DEFERRED]
- [ ] T029 性能验收（SC-007）[E2E_DEFERRED]

---

## FR 覆盖率：13/13（100%）

| FR | Task |
|----|------|
| FR-001 | T009, T013 |
| FR-002 | T004, T005 |
| FR-003 | T004, T005 |
| FR-004 | T009 |
| FR-005 | T018 |
| FR-006 | T017 |
| FR-007 | T012, T013, T014 |
| FR-008 | T012 |
| FR-009 | T014 |
| FR-010 | T012, T022 |
| FR-011 | T021, T028 |
| FR-012 | T007, T006 |
| FR-013 | T019 |
