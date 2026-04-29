# Tasks: Feature 145 — Spectra Python AST 函数级 Graph + Phase 2 Bug 修复

**Feature 分支**: `claude/tender-mayer-644a32`
**版本目标**: v4.0.2 → v4.1.0
**生成日期**: 2026-04-29
**输入文档**: spec.md + plan.md

---

## 格式说明

- `⬜` 未开始 / `🔄` 进行中 / `✅` 已完成
- `[P]` 可并行（不同文件、无依赖关系）
- `[USN]` 所属 User Story（US1=P0，US2=P1，US3=P2，US4=P3）
- 每个任务包含：关联 FR/SC、预计时间、完成条件

---

## 提交计划总览

| Commit | 包含 Phase | 核心变更 |
|--------|-----------|---------|
| C1 | Phase 3 + Phase 4 | P0 Python 符号桥接 + P1 designDocAbsPaths 扫盘 |
| C2 | Phase 5 | P2 debt-scanner Open Questions 修复 |
| C3 | Phase 6 | P3 budget-gate 常量校准（P0 实测后） |
| C4 | Phase 7 | 文档追加 + 发布版本同步 |

---

## Phase 1: 环境确认（Shared Infrastructure）

**目标**：确认改动区域接口形状，避免实现时猜测类型。

- ✅ T001 [P] 读取 `src/adapters/python-adapter.ts`，记录现有方法签名、`walkDir` 扫盘逻辑位置（L115-139 附近）
  - **预计时间**：15 分钟
  - **完成条件**：明确 `PythonLanguageAdapter` 现有 public 方法列表，确认 `buildDependencyGraph` 中 `.py` 扫盘代码段行号

- ✅ T002 [P] 读取 `src/extraction/extraction-types.ts`（或同等路径），记录 `ExtractionResult`、`ExtractionNode`、`ExtractionEdge` 接口的字段名与类型
  - **预计时间**：15 分钟
  - **完成条件**：确认 `ExtractionNode` 包含 `id`、`kind`、`label`、`source_file`、`confidence` 字段；`ExtractionEdge` 包含 `source`、`target`、`relation`、`confidence`

- ✅ T003 [P] 读取 `src/batch/batch-orchestrator.ts` L1030-1110 区域，定位 `extractionResults` 赋值点（L1036-1055）和 `designDocAbsPaths` 构建点（L1094-1097）
  - **预计时间**：15 分钟
  - **完成条件**：确认两个修改锚点的精确行号；了解 `resolvedRoot`、`resolvedOutputDir` 变量在此处的来源

**Checkpoint**：接口形状确认完毕，可开始 Phase 2 并行实施。

---

## Phase 2: 基础层（Foundational）

**目标**：无阻塞前置依赖，本 feature 无需新建共享基础设施，此 Phase 留空。

> 本 feature 所有改动均在已有模块上扩展，无需新建公共工具层。跳过此 Phase。

---

## Phase 3: User Story 1 — Python 项目一次跑通知识图谱（Priority: P0）🎯 MVP

**目标**：在 `spectra batch` 默认流程中，提取所有 `.py` 文件的函数/类符号节点，注入 `buildKnowledgeGraph()`，使 `graph.json` 包含函数级节点。

**独立测试**：在 micrograd 副本上执行 `spectra batch`，检查 `graph.json` 中 `kind: 'component'` 节点数量 ≥ 8，containment 边 ≥ 5。

**关联 FR**：FR-001、FR-002、FR-003、FR-004、FR-005
**关联 SC**：SC-002、SC-003

### 测试先行（写测试 → 确认失败 → 再实现）

- ✅ T010 [P] [US1] 在 `tests/adapters/python-adapter.test.ts` 新增测试：fixture `.py` 文件含 `def add(x, y)` → `extractSymbolNodes` 输出节点 ID 格式为 `{relPath}#add`，kind='component'，edges 含 relation='contains'
  - **预计时间**：20 分钟
  - **完成条件**：测试文件可运行，初始状态 FAIL（方法尚未实现）

- ✅ T011 [P] [US1] 在 `tests/adapters/python-adapter.test.ts` 新增测试：无 exports 的 `.py` 文件 → 不抛出异常，产出文件级 module 节点，无 containment 边
  - **预计时间**：15 分钟
  - **完成条件**：测试 FAIL（方法尚未实现），异常 case 正确定义

- ✅ T012 [P] [US1] 在 `tests/adapters/python-adapter.test.ts` 新增测试：同名函数跨两个 `.py` 文件（`a.py#forward`、`b.py#forward`）→ ID 全局唯一，不冲突
  - **预计时间**：15 分钟
  - **完成条件**：测试 FAIL，ID 冲突检测逻辑正确定义

- ✅ T013 [US1] 在 `tests/panoramic/graph/graph-builder.test.ts`（或新建）新增测试：注入 3 个 `.py` fixture 文件的 ExtractionResult → `buildKnowledgeGraph` 输出中 kind='component' 节点 ≥ 3，containment 边 ≥ 3
  - **预计时间**：25 分钟
  - **完成条件**：测试 FAIL，fixture 数据结构正确

### 实现

- ✅ T014 [US1] 在 `src/adapters/python-adapter.ts` 新增 `extractSymbolNodes(projectRoot: string): Promise<ExtractionResult[]>` 方法
  - 实现要点：
    1. 复用 `buildDependencyGraph` 中的 `walkDir`/`readdirSync` 扫盘逻辑找所有 `.py` 文件
    2. 对每个 `.py` 文件调用 `this.analyzeFile(absPath)` 获取 `CodeSkeleton`
    3. 将 `skeleton.exports` 中每个 `ExportSymbol` 转换为 `ExtractionNode`：`id = {relPath}#{symbol.name}`，`kind = 'component'`，`label = symbol.name`，`confidence = 'high'`
    4. 为每个文件生成文件级 module 节点：`id = relPath`，`kind = 'module'`
    5. 构建 containment 边：`source = relPath`，`target = symbolNodeId`，`relation = 'contains'`
    6. 每个文件产出一个 `ExtractionResult`，push 至 results 数组
  - **预计时间**：60-90 分钟
  - **完成条件**：T010/T011/T012 测试全部 PASS；`extractSymbolNodes` 方法在 TypeScript 类型检查下零错误

- ✅ T015 [US1] 修改 `src/batch/batch-orchestrator.ts` L1036-1055 区域：在 `if (options.includeDocs || options.includeImages)` 判断前，不依赖 flag，调用 `pythonAdapter.extractSymbolNodes(resolvedRoot)` 并将结果 merge 进 `extractionResults`
  - 实现要点：
    1. 实例化（或获取）`PythonLanguageAdapter`
    2. `const pythonSymbolResults = await pythonAdapter.extractSymbolNodes(resolvedRoot)`
    3. 合并：`const mergedResults = [...pythonSymbolResults, ...(extractionResults ?? [])]`
    4. 将 `mergedResults` 传入 `buildKnowledgeGraph({ ..., extractionResults: mergedResults })`
  - **预计时间**：30 分钟
  - **完成条件**：T013 测试 PASS；`npm run build` 零错误

**Checkpoint**：User Story 1 完整可测试。执行 T010-T013 全 PASS，`extractSymbolNodes` 在 3 个 `.py` fixture 上产出正确节点和边。

---

## Phase 4: User Story 2 — Hyperedge 首次运行即生效（Priority: P1）

**目标**：修复 `designDocAbsPaths` 首次运行为空导致 hyperedge 被静默跳过的 bug，改为"磁盘优先"合并策略。

**独立测试**：清空 outputDir，首次执行 batch，检查 `graph.json` hyperedge 列表 ≥ 1。

**关联 FR**：FR-006、FR-007
**关联 SC**：SC-002、SC-003

> **注**：与 P0 同属 C1 提交，在 T015 同文件 `batch-orchestrator.ts` 的相邻区域修改。

### 测试先行

- ✅ T016 [US2] 在 `tests/batch/batch-orchestrator.test.ts` 新增测试：mock `generateBatchProjectDocs` 返回 `writtenFiles: []`，mock `outputDir/project/` 目录下存在两个 `.md` 文件 → 断言 `designDocAbsPaths.length = 2`，hyperedge 集成不被跳过
  - **预计时间**：25 分钟
  - **完成条件**：测试 FAIL（修复前 designDocAbsPaths 为空）

- ✅ T017 [US2] 在同测试文件中新增测试：`outputDir/project/` 目录不存在 → `designDocAbsPaths.length = 0`，不抛出异常，batch 继续执行
  - **预计时间**：15 分钟
  - **完成条件**：测试 FAIL，异常 case 正确定义

### 实现

- ✅ T018 [US2] 修改 `src/batch/batch-orchestrator.ts` L1094-1097 区域：将 `designDocAbsPaths` 构建逻辑改为"磁盘优先"合并策略
  - 实现要点（参考 plan.md ADR-003）：
    ```typescript
    const fromProjectDocs = (projectDocs ?? [])
      .map(rel => path.isAbsolute(rel) ? rel : path.join(resolvedRoot, rel))
      .filter(abs => fs.existsSync(abs));
    const projectDir = path.join(resolvedOutputDir, 'project');
    const fromDisk = fs.existsSync(projectDir)
      ? fs.readdirSync(projectDir).filter(f => f.endsWith('.md'))
          .map(f => path.join(projectDir, f))
      : [];
    const designDocAbsPaths = [...new Set([...fromProjectDocs, ...fromDisk])];
    logger.info(`hyperedge: designDocAbsPaths.length=${designDocAbsPaths.length} (fromDocs=${fromProjectDocs.length}, fromDisk=${fromDisk.length})`);
    ```
  - **预计时间**：20 分钟
  - **完成条件**：T016/T017 全 PASS；`npm run build` 零错误；日志输出包含 `designDocAbsPaths.length`

**Checkpoint**：User Story 2 完整可测试。T016/T017 PASS，首次运行场景下 hyperedge 路径不为空。

---

## Phase 5: User Story 3 — 技术债 Open Questions 从 README 提取（Priority: P2）

**目标**：修复 debt-scanner 无法扫描 `README.md` 的 bug，确保 `technical-debt.md` 的 Open Questions 区块有内容。

**独立测试**：在含 README.md（含 TODO 或问题描述）的项目上执行 batch，检查 `technical-debt.md` Open Questions 区块 ≥ 1 条。

**关联 FR**：FR-008、FR-009
**关联 SC**：SC-004

> **注**：独立 C2 提交。先加诊断日志确认根因，再按诊断结果选择修复路径（ADR-004）。

### 测试先行

- ✅ T020 [US3] 在 `tests/debt-scanner/design-docs/doc-discoverer.test.ts`（或新建）新增测试：fixture 目录含 `README.md` → `discoverDesignDocs(fixtureDir)` 返回非空路径列表，包含 README.md 路径
  - **预计时间**：20 分钟
  - **完成条件**：测试 FAIL（当前实现漏掉 README.md）或确认 PASS（说明根因在下游）

### 实现

- ✅ T021 [US3] 在 `src/panoramic/pipelines/debt-intelligence-pipeline.ts` L75-85 附近添加诊断日志，输出 `docsScanned`、`openQuestions.length`、`confirmedCount`
  - 实现要点（参考 plan.md）：
    ```typescript
    diagnostics.push(
      `扫描 ${report.diagnostics.filesScanned} 个源文件，` +
      `扫描 ${report.diagnostics.docsScanned} 个 design-doc，` +
      `发现 ${report.openQuestions.length} 个 open question（confirmed=${report.diagnostics.confirmedCount ?? 0}）`
    );
    ```
  - **预计时间**：20 分钟
  - **完成条件**：batch 日志中可见 docsScanned 数值；`npm run build` 零错误

- ✅ T022 [US3] 根据诊断结果选择修复路径（在实测 micrograd 副本前，此任务为条件执行）
  - **路径 A（docsScanned=0）**：检查 `src/debt-scanner/design-docs/doc-discoverer.ts` 中 `projectRoot` 传值，确认是否指向 micrograd 根目录；若 `discoverDesignDocs` 不扫描 `.md` 文件，在此添加 `.md` 扩展名支持
  - **路径 B（docsScanned>0 但 confirmed=0）**：检查内容匹配规则（regex 或 LLM prompt），放宽 Open Question 识别条件
  - 修改文件：`src/debt-scanner/design-docs/doc-discoverer.ts`（路径 A）或规则文件（路径 B）
  - **预计时间**：30-60 分钟（取决于根因）
  - **完成条件**：T020 测试 PASS；在含 README.md 的 fixture 上 `discoverDesignDocs` 返回非空

**Checkpoint**：User Story 3 完整可测试。T020 PASS，debt-scanner 能发现 README.md，`.md` 文件不触发 AST 分析（FR-009 通过日志确认无 analyzeFile 调用错误）。

---

## Phase 6: User Story 4 — Dry-run 预估偏差压缩至 30% 以内（Priority: P3）

**目标**：校准 `budget-gate.ts` 中的 token 估算常量，使 dry-run 预估偏差 < 30%。

**独立测试**：先 `spectra batch --dry-run`，再完整 batch，对比实际/预估 < 1.3x。

**关联 FR**：FR-010、FR-011
**关联 SC**：SC-001、SC-005

> **注**：独立 C3 提交。此 Phase 应在 P0（Phase 3）完成后执行实测校准。

### 测试先行

- ✅ T030 [US4] 在 `tests/batch/budget-gate.test.ts` 新增/修改测试：调用 `estimateModuleCost` → 返回的 `estimatedInput` 大于原始内容 token 数（`rawInput`），确认 overhead 常量生效
  - **预计时间**：20 分钟
  - **完成条件**：测试 FAIL（修改前 overhead 未加入）

### 实现

- ✅ T031 [US4] 修改 `src/batch/budget-gate.ts` L102-127 附近：新增 `SYSTEM_PROMPT_TOKEN_OVERHEAD` 和 `CONTEXT_ASSEMBLY_MULTIPLIER` 命名常量
  - 实现要点（参考 plan.md）：
    ```typescript
    /** system prompt（spec 生成指令）实测约 2000 tokens（测量日期：2026-04，P0 后重新校准） */
    const SYSTEM_PROMPT_TOKEN_OVERHEAD = 2000;

    /** context-assembler 结构化开销（skeleton JSON + import/export 列表），约 +35% */
    const CONTEXT_ASSEMBLY_MULTIPLIER = 1.35;
    ```
  - 在 `estimateModuleCost` 内使用：`estimatedInput = Math.round(rawInput * CONTEXT_ASSEMBLY_MULTIPLIER) + SYSTEM_PROMPT_TOKEN_OVERHEAD`
  - 更新 `ESTIMATION_ASSUMPTION` 字符串，说明两个常量及测量时间
  - **预计时间**：20 分钟
  - **完成条件**：T030 测试 PASS；无魔法数字，常量注释含测量日期；`npm run build` 零错误

- ⬜ T032 [US4] （可选，在 micrograd 副本上验证）执行 `spectra batch --dry-run` 记录预估 token，再执行完整 batch 记录实际 token，计算偏差比值
  - **预计时间**：20 分钟
  - **完成条件**：实际/预估 < 1.3x；若仍超出，调整 `SYSTEM_PROMPT_TOKEN_OVERHEAD` 和 `CONTEXT_ASSEMBLY_MULTIPLIER` 值（FR-011）

**Checkpoint**：User Story 4 完整可测试。T030 PASS，budget-gate 估算公式含两个命名常量，dry-run 偏差 < 30%。

---

## Phase 7: Polish & Cross-Cutting Concerns（文档与发布）

**目标**：追加 CHANGELOG、postmortem 教训，升版，同步受控位置。

> **注**：独立 C4 提交。所有前序 Phase 完成后执行。

- ✅ T040 [P] 在 `CHANGELOG.md` 追加 v4.1.0 条目，包含 4 个修复点（Python 函数级 graph、hyperedge 首次运行修复、debt-scanner README 修复、dry-run 偏差校准）
  - **预计时间**：10 分钟
  - **完成条件**：CHANGELOG 顶部新增 `## [v4.1.0] - 2026-04-29` 区块，4 条变更均列出

- ✅ T041 [P] 在 `specs/M-101-phase2-reading-platform/postmortem.md` 追加"Python 集成测试盲区"教训（不重写全文，仅末尾追加）
  - 追加内容要点：Python 函数级节点在 Phase 2 集成测试才发现缺失；建议在适配器开发阶段即配套 e2e 场景测试
  - **预计时间**：10 分钟
  - **完成条件**：文件末尾新增追加内容，原文无改动

- ✅ T042 修改 `contracts/release-contract.yaml`：将 `version` 字段从 `v4.0.2` 升至 `v4.1.0`
  - **预计时间**：5 分钟
  - **完成条件**：YAML 中 version 字段值为 `v4.1.0`

- ✅ T043 执行 `npm run release:sync`，同步 version 至 `package.json`、`marketplace.json` 等所有受控位置
  - **预计时间**：5 分钟
  - **完成条件**：命令执行成功，无错误输出

- ✅ T044 执行 `npm run release:check` 确认所有受控位置版本一致
  - **预计时间**：5 分钟
  - **完成条件**：check 通过，零差异报告

---

## Phase 8: 全量验证

**目标**：确保所有改动零回归，符合发布门禁要求。

- ✅ T050 执行 `npx vitest run`，确认零失败
  - **预计时间**：5-10 分钟
  - **完成条件**：所有测试 PASS（pre-existing `export-command.test.ts` 失败不计入）；本 feature 新增的 T010-T013、T016-T017、T020、T030 均为 PASS

- ✅ T051 执行 `npm run build`，确认 TypeScript 类型检查零错误
  - **预计时间**：3 分钟
  - **完成条件**：构建成功，stdout 无 `error TS` 字样

- ✅ T052 执行 `npm run repo:check`，确认仓库级同步完整
  - **预计时间**：3 分钟
  - **完成条件**：check 通过，无 drift 报告

- ⬜ T053 [P] （可选）微型 e2e 验证——在 micrograd 副本上执行 5 个 SC 验证场景：
  - SC-001：dry-run 预估 token 含 overhead
  - SC-002：首次运行 hyperedge ≥ 1
  - SC-003：graph.json 含 ≥ 8 component 节点、≥ 5 边、≥ 1 hyperedge
  - SC-004：technical-debt.md Open Questions ≥ 1 条
  - SC-005：实际/预估偏差 < 1.3x
  - **预计时间**：20-30 分钟
  - **完成条件**：5 个场景均通过

---

## FR 覆盖映射表

| FR | 描述（摘要） | 对应 Task ID |
|----|------------|------------|
| FR-001 | Python 符号节点提取与注入 | T014, T015 |
| FR-002 | 函数级节点 ID 格式规范 | T014, T010 |
| FR-003 | 节点 kind 映射（component/module） | T014, T010 |
| FR-004 | containment 边构建 | T014, T010 |
| FR-005 | 不引入新外部依赖 | T014（复用 web-tree-sitter） |
| FR-006 | designDocAbsPaths 改为磁盘扫描 | T018 |
| FR-007 | hyperedge 集成诊断日志（SHOULD） | T018 |
| FR-008 | debt-scanner 独立扫描 .md 文件 | T022 |
| FR-009 | .md 文件不触发 AST 分析 | T022（路径 A/B 均需确认） |
| FR-010 | budget-gate 加入 overhead 常量 | T031 |
| FR-011 | P3 常量在 P0 后校准（SHOULD） | T032 |

**FR 覆盖率**：11/11（100%）

---

## 依赖与并行说明

### Phase 依赖关系

```
Phase 1（环境确认）
  └→ Phase 3（P0 Python 符号桥接）⎤ 可并行实施
  └→ Phase 4（P1 designDocAbsPaths）⎦ 同 C1 提交，文件相邻
  └→ Phase 5（P2 debt-scanner）      独立 C2 提交，无交叉
  └→ Phase 6（P3 budget-gate）       需 P0 实测偏差后最终校准
Phase 3 + Phase 4 完成 → Phase 6 校准
所有 Phase 3-6 完成 → Phase 7（文档发布）→ Phase 8（全量验证）
```

### User Story 间依赖

- **US1（P0）与 US2（P1）**：共用 `batch-orchestrator.ts` 同一文件，建议同 commit（C1）；US1 的实现（T015）写在 L1036 附近，US2 的实现（T018）写在 L1094 附近，无代码行冲突
- **US3（P2）**：完全独立链路，可与 US1/US2 并行开发，独立 C2 提交
- **US4（P3）**：需在 US1（P0）完成后实测偏差，才能确认常量精度；C3 提交顺序在 C1 之后

### 单 Story 内并行机会

- **Phase 3**：T010/T011/T012（3 个测试用例）可并行编写，均为 `python-adapter.test.ts` 同文件不同测试 case；T013 独立文件，与前三个并行
- **Phase 7**：T040（CHANGELOG）与 T041（postmortem）可并行追加，文件不同

### 推荐实现策略

**MVP First（单人开发推荐顺序）**：

1. Phase 1 环境确认（T001-T003，30 分钟）
2. Phase 3 Python 符号桥接（T010-T015，2-2.5 小时）→ 完成 US1，可独立测试
3. Phase 4 designDocAbsPaths 修复（T016-T018，1 小时）→ 与 Phase 3 同 C1 提交
4. Phase 5 debt-scanner 修复（T020-T022，1-1.5 小时）→ C2 提交
5. Phase 6 budget-gate 校准（T030-T032，1 小时）→ C3 提交（P0 实测后）
6. Phase 7 文档发布（T040-T044，30 分钟）→ C4 提交
7. Phase 8 全量验证（T050-T053，30-45 分钟）→ 提交前门禁

**预计总耗时**：5-6.5 小时（不含 e2e micrograd 验证）；含微型 e2e 验证约 6.5-8 小时。

---

## 任务统计

| 维度 | 数值 |
|------|------|
| 总 Task 数 | 27 个（含可选 T032、T053） |
| 必须任务 | 25 个 |
| 可选任务 | 2 个（T032 实测校准、T053 e2e 验证） |
| 测试任务 | 8 个（T010-T013、T016-T017、T020、T030） |
| 实现任务 | 6 个（T014-T015、T018、T021-T022、T031） |
| 验证/发布任务 | 8 个（T040-T044、T050-T053） |
| 可并行任务比例 | 约 40%（T001-T003、T010-T013、T040-T041、T053） |
| 覆盖 User Stories | 4 个（US1/US2/US3/US4） |
| FR 覆盖率 | 100%（11/11） |
| 预计总耗时 | 5-6.5 小时（核心任务） |

---

## Blocker 说明

| 潜在 Blocker | 影响 | 处置方式 |
|-------------|------|---------|
| `ExtractionResult` 接口字段与预期不符 | T014 实现需调整字段名 | T001/T002 环境确认阶段先读接口，避免盲改 |
| P2 根因不明（docsScanned=0 vs confirmed=0）| T022 修复路径不确定 | T021 先加诊断日志，实测后再修；不影响其他 Phase |
| P3 常量校准需 P0 完成后实测 | T032 时序依赖 C1 | Phase 6 排在 Phase 3 之后，T032 标注为可选确认步骤 |
| `outputDir/project/` 目录不存在时异常 | T018 存在边界风险 | T017 单测已覆盖此 case，修复前 FAIL 确认 |
| FR-009 (.md 不触 AST 分析) 可能被跳过（analyze F-003） | T022 条件执行时无独立 verify | T051 build 验证时确认 debt-scanner 无 ".md AST" 相关错误输出 |
