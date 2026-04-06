---
feature: 091-sync-deterministic-merge
title: sync 合并算法确定性化 — 任务分解
branch: claude/agitated-hamilton
created: 2026-04-06
status: Draft
---

# Tasks: sync 合并算法确定性化

**Input**: 设计文档 `/specs/091-sync-deterministic-merge/`
**Prerequisites**: spec.md, plan.md, data-model.md, contracts/merge-engine-output.md, contracts/agent-to-script-interface.md

**Tests**: 本 Feature 未显式要求 TDD，不生成独立测试任务。验收标准内嵌于各任务中。

**Organization**: 按依赖拓扑组织，Phase 2 的 lib 模块按数据流方向串行，Phase 3 的 CLI 入口编排所有模块，Phase 4-5 处理 Prompt 瘦身和降级兼容。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件，无未完成依赖）
- **[Story]**: 对应 spec.md 的 User Story（US1-US5）
- 包含准确文件路径

## Path Conventions

- **Plugin 目录**: `plugins/spec-driver/`
- **脚本目录**: `plugins/spec-driver/scripts/`
- **Lib 目录**: `plugins/spec-driver/scripts/lib/`
- **Agent 目录**: `plugins/spec-driver/agents/`
- **Spec 目录**: `specs/091-sync-deterministic-merge/`

---

## Phase 1: Setup

**Purpose**: 确认前置条件，建立工作基准

- [ ] T001 确认 Feature 090 和 092 已合并到 master，并将 master 最新内容 rebase 到当前分支 `claude/agitated-hamilton`

**Checkpoint**: 分支已同步最新 master，包含 090 + 092 的变更

---

## Phase 2: Foundational Lib 模块（按数据流方向实现）

**Purpose**: 实现 5 个纯函数 lib 模块，构成合并引擎的核心逻辑层

**CRITICAL**: 所有 lib 模块 MUST 为纯函数导出（无副作用），文件 I/O 仅在入口脚本中完成。遵循现有 `plugins/spec-driver/scripts/lib/` 的模块化风格：`.mjs` 后缀、ES Module、`import.meta.url` 守卫、驼峰命名。

### T002 — sync-product-mapping.mjs（产品映射模块）

- [ ] T002 [P] [US4] 实现 `plugins/spec-driver/scripts/lib/sync-product-mapping.mjs` 产品映射模块

**依赖**: 无（复用 `simple-yaml.mjs`）
**FR 映射**: FR-002, FR-012
**US 映射**: US4（可独立测试的纯函数模块）

**文件**: `plugins/spec-driver/scripts/lib/sync-product-mapping.mjs`

**步骤**:

1. 创建文件，添加 ES Module 头部和 JSDoc 类型注释（参照 data-model.md 的 ProductMapping 定义）
2. 实现 `parseProductMapping(yamlContent)` 函数：
   - 输入：YAML 字符串（product-mapping.yaml 内容）
   - 使用 `simple-yaml.mjs` 的 `parseYamlDocument()` 解析
   - 输出：`ProductMapping` 对象（`{ products: Record<string, ProductDefinition> }`）
   - 容错：输入为空或解析失败时返回 `{ products: {} }`，不抛异常
3. 实现 `correctProductNames(mapping, rules)` 函数：
   - 输入：`ProductMapping` + `NAME_CORRECTION_RULES` 常量
   - 遍历 mapping.products，如 key 在 rules 中，将 value 合并到新 key 下
   - 输出：修正后的 `ProductMapping`（纯函数，不修改输入）
4. 导出 `NAME_CORRECTION_RULES` 常量（`{ 'spec-driverdriver': 'spec-driver', 'spec-driver-driver-pro': 'spec-driver' }`）
5. 实现 `detectUnmappedSpecs(mapping, scannedSpecs)` 函数：
   - 输入：`ProductMapping` + 扫描到的 `SpecEntry[]`
   - 计算差集：scannedSpecs 中的 specId 不在任何 product 的 specs 列表中
   - 输出：`UnmappedSpec[]`（含 specId, dirName, title, summary）
6. 实现 `mergeUnmappedSpecs(mapping, unmappedSpecs, agentDecisions)` 函数：
   - 输入：映射 + 未映射列表 + Agent 归属决策（`Record<specId, productId>`）
   - 将每个 unmapped spec 归入对应产品
   - 输出：更新后的 `ProductMapping`（纯函数）
7. 实现 `serializeProductMapping(mapping)` 函数：
   - 输入：`ProductMapping` 对象
   - 使用 `simple-yaml.mjs` 的 `stringifyYaml()` 序列化
   - 输出：YAML 字符串

**验收标准**:
- 导出 5 个函数 + 1 个常量，全部为纯函数
- `parseProductMapping('')` 返回 `{ products: {} }` 而非抛异常
- `correctProductNames()` 不修改输入对象
- `detectUnmappedSpecs()` 在所有 spec 已映射时返回空数组
- 预估 ~250 行

---

### T003 — sync-timeline-builder.mjs（时间线模块）

- [ ] T003 [P] [US4] 实现 `plugins/spec-driver/scripts/lib/sync-timeline-builder.mjs` 时间线构建模块

**依赖**: 无（与 T002 可并行）
**FR 映射**: FR-003, FR-012
**US 映射**: US4

**文件**: `plugins/spec-driver/scripts/lib/sync-timeline-builder.mjs`

**步骤**:

1. 创建文件，添加 JSDoc 类型注释（参照 data-model.md 的 Timeline、TimelineEntry、SpecType 定义）
2. 实现 `classifySpecType(specEntry)` 函数：
   - 输入：单个 `SpecEntry`（含 dirName, id）
   - 分类规则（按 data-model.md Section 1.1）：
     - 产品中编号最小 → `'INITIAL'`（需由调用方上下文提供 isFirst 标记，或在 buildTimeline 内部判断）
     - dirName 含 `fix` → `'FIX'`
     - dirName 含 `refactor` / `rename` / `split` → `'REFACTOR'`
     - dirName 含 `enhance` / `batch` / `improve` → `'ENHANCEMENT'`
     - 其余 → `'FEATURE'`
   - 输出：SpecType 字符串
3. 实现 `buildTimeline(specEntries, productId)` 函数：
   - 输入：某产品下的 `SpecEntry[]` + productId
   - 按 specId 数值升序排序
   - 第一个条目强制标记为 `'INITIAL'`
   - 其余条目调用 `classifySpecType()` 判定类型
   - 生成 `stats`（按 SpecType 计数）
   - 编号重复时按 dirName 字母序排列，向 warnings 收集器记录警告
   - 输出：`Timeline` 对象（`{ productId, entries: TimelineEntry[], stats }`）

**验收标准**:
- 导出 2 个函数，全部为纯函数
- 空 specEntries 输入返回 `{ productId, entries: [], stats: { INITIAL: 0, FEATURE: 0, FIX: 0, REFACTOR: 0, ENHANCEMENT: 0 } }`
- 排序结果稳定（相同输入多次调用结果一致）
- 预估 ~120 行

---

### T004 — sync-merge-strategy.mjs（合并策略模块）

- [ ] T004 [US1] [US4] 实现 `plugins/spec-driver/scripts/lib/sync-merge-strategy.mjs` 增量合并策略模块

**依赖**: T003（需要 Timeline 结构定义）
**FR 映射**: FR-004, FR-012
**US 映射**: US1（确定性合并核心），US4（可独立测试）

**文件**: `plugins/spec-driver/scripts/lib/sync-merge-strategy.mjs`

**步骤**:

1. 创建文件，添加 JSDoc 类型注释（参照 data-model.md 的 MergeSkeleton、ChapterSkeleton、FREntry、UserStoryEntry、MergeStats 定义）
2. 定义 14 章标题常量（与 merge-engine-output.md Section 6 一致）：
   ```
   CHAPTER_TITLES = { "1": "产品概述", "2": "目标与成功指标", ... "14": "附录：增量 spec 索引" }
   ```
3. 实现 `executeMerge(timeline, parsedSpecs)` 函数：
   - 输入：`Timeline` + 各 spec 的 `ParsedSpecContent` 映射
   - 初始化空 MergeSkeleton（14 个 ChapterSkeleton，functionalRequirements 和 userStories 均为空数组）
   - 按 timeline.entries 顺序遍历，根据 type 执行增量合并：
     - `INITIAL`：将其 FR 和 UserStory 作为基础写入骨架
     - `FEATURE`：追加新的 FR（id 不重复则 append）和 UserStory
     - `FIX`：查找同 FR ID，更新 description，标记 sourceSpec
     - `REFACTOR`：查找同 FR ID，替换 description，记录 supersededBy
     - `ENHANCEMENT`：查找同 FR ID，增强 description（追加而非替换）
   - 计算 mergeStats（activeFRCount, supersededFRCount 等）
   - 填充各章节的 sourceSpecs 和 changeSummary
   - 输出：`MergeSkeleton` 对象

**验收标准**:
- 导出 `executeMerge` 函数，为纯函数
- 同一 timeline + parsedSpecs 输入多次调用结果完全一致（确定性）
- INITIAL spec 的 FR 全部标记为 `status: 'active'`
- REFACTOR 类型的 spec 正确设置 `supersededBy` 字段
- 预估 ~200 行

---

### T005 — sync-conflict-resolver.mjs（冲突解决模块）

- [ ] T005 [US1] [US4] 实现 `plugins/spec-driver/scripts/lib/sync-conflict-resolver.mjs` 冲突解决模块

**依赖**: T004（需要 MergeSkeleton 结构）
**FR 映射**: FR-005, FR-012
**US 映射**: US1, US4

**文件**: `plugins/spec-driver/scripts/lib/sync-conflict-resolver.mjs`

**步骤**:

1. 创建文件，添加 JSDoc 类型注释（参照 data-model.md 的 ConflictRecord 定义）
2. 实现 `resolveConflicts(skeleton)` 函数：
   - 输入：`MergeSkeleton`（可能含有同一 FR ID 的多个 active 版本）
   - 遍历所有章节的 functionalRequirements：
     - 检测同一 FR ID 是否存在多个 `status: 'active'` 条目
     - 若存在冲突：编号更大者（`sourceSpec` 更大）胜出保持 `active`，编号更小者标记为 `status: 'superseded'` 并设置 `supersededBy`
     - 生成 `ConflictRecord`（subject, winner, loser, reason）
   - 更新 mergeStats（重新计算 activeFRCount, supersededFRCount）
   - 输出：`{ skeleton: MergeSkeleton, conflicts: ConflictRecord[] }`（纯函数，返回新对象）

**验收标准**:
- 导出 `resolveConflicts` 函数，为纯函数
- 无冲突时 conflicts 为空数组，skeleton 不变
- 冲突时编号更大者始终胜出
- 不修改输入的 skeleton 对象
- 预估 ~80 行

---

### T006 — sync-validator.mjs（验证模块）

- [ ] T006 [US1] [US4] 实现 `plugins/spec-driver/scripts/lib/sync-validator.mjs` 验证模块

**依赖**: T004 + T005（需要合并结果和冲突解决后的骨架）
**FR 映射**: FR-006, FR-012
**US 映射**: US1, US4

**文件**: `plugins/spec-driver/scripts/lib/sync-validator.mjs`

**步骤**:

1. 创建文件，添加 JSDoc 类型注释（参照 data-model.md 的 ValidationReport、ValidationCheck 定义）
2. 实现 `validateMergeResult(skeleton, timeline)` 函数，执行三项验证检查：
   - **fr-count 检查**：合并后 activeFRCount >= INITIAL spec 的 FR 数量。从 timeline 找到 INITIAL 条目，提取其 FR 数量作为基线
   - **no-contradiction 检查**：同一 FR ID 不存在两个 `status: 'active'` 版本（冲突解决后应不存在，此为二次校验）
   - **changelog-coverage 检查**：变更历史覆盖所有归属 spec。收集所有 chapter 的 sourceSpecs 去重后的集合 >= timeline.entries 中所有 specId 的集合
3. 每项检查生成 `ValidationCheck`（name, passed, detail, data）
4. 组装 `ValidationReport`（productId, passed = 三项全通过, checks）
5. 输出：`ValidationReport` 对象

**验收标准**:
- 导出 `validateMergeResult` 函数，为纯函数
- 三项检查名称与 data-model.md 一致：`'fr-count'`, `'no-contradiction'`, `'changelog-coverage'`
- `passed` 仅在三项全通过时为 `true`
- 预估 ~120 行

**Checkpoint**: Phase 2 完成后，5 个 lib 模块可独立导入和调用，输入/输出符合 data-model.md 定义

---

## Phase 3: User Story 1 + 2 — CLI 入口与 Dry-run（Priority: P1）

**Goal**: 实现 `sync-merge-engine.mjs` CLI 入口脚本，编排 Phase 2 的全部 lib 模块，支持 `--dry-run`、`--json`、`--project-root` 参数

**Independent Test**: 运行 `node sync-merge-engine.mjs --dry-run --project-root <path>`，验证 stdout 输出有效 JSON 且无文件被修改

### T007 — sync-merge-engine.mjs 入口脚本（spec 扫描 + 流水线编排）

- [ ] T007 [US1] [US2] 实现 `plugins/spec-driver/scripts/sync-merge-engine.mjs` CLI 入口脚本

**依赖**: T002-T006（编排所有 lib 模块）
**FR 映射**: FR-001, FR-007, FR-010, FR-011
**US 映射**: US1（确定性输出），US2（dry-run 预览）
**Contract 映射**: merge-engine-output.md（输出 JSON 结构），agent-to-script-interface.md（CLI 参数规范）

**文件**: `plugins/spec-driver/scripts/sync-merge-engine.mjs`

**步骤**:

1. 创建文件，添加 shebang `#!/usr/bin/env node` 和 ES Module 导入（参照 plan.md Section 4.3 骨架）
2. 导入全部 lib 模块和复用的 helper：
   - `sync-product-mapping.mjs`（5 个函数 + NAME_CORRECTION_RULES）
   - `sync-timeline-builder.mjs`（buildTimeline）
   - `sync-merge-strategy.mjs`（executeMerge）
   - `sync-conflict-resolver.mjs`（resolveConflicts）
   - `sync-validator.mjs`（validateMergeResult）
   - `product-artifact-paths.mjs`（getProductsRoot）
   - `script-report-io.mjs`（writeYamlArtifact）
   - `simple-yaml.mjs`（parseYamlDocument）
3. 实现 `parseArgs(argv)` 函数（参照 plan.md Section 4.2 参数定义）：
   - `--project-root <path>` → 绝对路径（默认 `process.cwd()`）
   - `--dry-run` → boolean
   - `--json` → boolean
   - 未知参数静默忽略
4. 实现 spec 扫描函数 `scanSpecs(projectRoot)`：
   - 遍历 `specs/` 目录，匹配 `NNN-*` 模式
   - 对每个目录：读取 `spec.md`，宽松解析 H1 标题、概述段（前 200 字符）、YAML Front Matter（status, created）
   - 解析失败字段返回 null，不抛异常
   - 输出：`SpecEntry[]`
5. 实现 spec 内容解析函数 `parseSpecContent(specFilePath)`：
   - 宽松 section parser（以 H2 `##` 为分割点）
   - 提取 User Stories（从 "User Scenarios" 章节）、FR（从 "Requirements" 章节的 `FR-NNN` 模式）
   - 输出：`ParsedSpecContent` 对象
6. 实现主流程函数 `syncMergeEngine(options)`，按 plan.md Section 4.1 的 7 阶段流水线：
   - Phase 1：调用 `scanSpecs()`
   - Phase 2：读取 product-mapping.yaml（容错：不存在返回空映射 + warnings）
   - Phase 3：调用 `correctProductNames()`
   - Phase 4：调用 `detectUnmappedSpecs()`
   - Phase 5：逐产品 `buildTimeline()` → `executeMerge()` → `resolveConflicts()` → `validateMergeResult()`
   - Phase 6：组装 `MergeEngineOutput` JSON（含 `schemaVersion: "1.0.0"`）
   - Phase 7：非 dry-run 模式下写入 product-mapping.yaml（仅差集更新）
7. 实现 dry-run 输出：
   - 不带 `--json`：人类可读混合格式（统计摘要 + 关键变更列表）
   - 带 `--json`：输出完整 JSON，顶层增加 `"dryRun": true`
8. 实现错误处理（参照 plan.md Section 4.4）：
   - `--project-root` 不存在 → `{ "error": "...", "code": "INVALID_PROJECT_ROOT" }` + exit 1
   - `specs/` 不存在 → `{ "error": "...", "code": "NO_SPECS_DIR" }` + exit 1
   - 其他可恢复错误 → warnings 数组
9. 实现 `import.meta.url` 守卫的双入口模式（CLI 入口 + `export function syncMergeEngine`）
10. 计时：记录 `executionTimeMs` 到 stats

**验收标准**:
- `node sync-merge-engine.mjs --dry-run --project-root <path>` 正常退出（exit code 0），stdout 为有效 JSON
- 同一输入连续运行两次，JSON 输出完全一致（SC-002 确定性）
- `--dry-run` 模式不修改任何文件（SC-003）
- `--project-root` 指向不存在路径时返回 exit code 1 和 INVALID_PROJECT_ROOT 错误
- JSON 输出包含 `schemaVersion: "1.0.0"` 字段（FR-011）
- 可通过 `node sync-merge-engine.mjs --dry-run --project-root <path>` 独立运行，不依赖 Claude Code 运行时（FR-010, SC-004）
- 预估 ~200 行（不含 lib 模块）

**Checkpoint**: Phase 3 完成后，合并引擎可独立运行并输出确定性 JSON 结果。US1 和 US2 核心功能就绪

---

## Phase 4: User Story 3 — sync.md Prompt 瘦身（Priority: P1）

**Goal**: 将 `agents/sync.md` 从当前约 15,000 bytes 瘦身至 <5,000 bytes，仅保留语义决策层

**Independent Test**: `wc -c agents/sync.md` < 5,000；审查内容无排序/匹配/差集/格式校验等确定性操作

### T008 — sync.md Prompt 重写

- [ ] T008 [US3] 重写 `plugins/spec-driver/agents/sync.md`，瘦身至 <5,000 bytes

**依赖**: T007（需了解脚本 CLI 调用方式和 JSON 输出结构）
**FR 映射**: FR-008, FR-009
**US 映射**: US3（Prompt 精简提升 LLM 遵循度）

**文件**: `plugins/spec-driver/agents/sync.md`

**步骤**:

1. 完整阅读当前 `plugins/spec-driver/agents/sync.md`（约 14,979 bytes），对照 plan.md Section 2.1 分离决策矩阵，标记每段的归属（脚本 / Agent / 删除）
2. 按 plan.md Section 5.2 骨架结构重写，保留以下内容：
   - **角色描述**（精简至 ~200 bytes）
   - **输入说明**（~200 bytes）
   - **工具权限**（~100 bytes）
   - **Step 1: 调用合并引擎**（~400 bytes）：脚本调用命令、JSON 解析、schemaVersion 兼容性检查（期望 `1.x.x`）
   - **Step 2: 补充语义决策**（~600 bytes）：消费 unmappedSpecs、内容分析推断归属
   - **Step 3: 语义融合生成 current-spec.md**（~1,200 bytes）：基于 MergeSkeleton 骨架、14 章语义填充要点
   - **Step 4: 验证与输出**（~300 bytes）
   - **信息推断规则**（~800 bytes）：保留完整推断规则表
   - **降级路径**（~500 bytes）：按 plan.md Section 5.3 设计，含降级条件和简化合并规则
   - **输出**（~200 bytes）
   - **约束**（~200 bytes）
3. 移除所有已提取到脚本的确定性操作：排序逻辑、匹配逻辑、差集计算、格式校验规则、产品名修正规则表
4. 确保降级路径包含约 500 bytes 的简化合并规则（FR-009）
5. 检查文件大小 < 5,000 bytes

**验收标准**:
- `wc -c plugins/spec-driver/agents/sync.md` < 5,000（SC-001）
- 内容仅包含语义决策层（FR-008）：产品归属内容分析推断、14 章语义融合、信息推断规则表、摘要生成
- 不包含排序、匹配、差集、格式校验等确定性操作
- 包含脚本调用指令和 JSON 消费方式
- 包含降级路径描述（FR-009），含降级标记格式
- 瘦身后 + 合并引擎执行完整 sync 流程时，current-spec.md 包含全部 14 章标题

**Checkpoint**: sync.md 瘦身完成，US3 就绪

---

## Phase 5: User Story 5 — 降级兼容（Priority: P2）

**Goal**: 确保脚本不可用时 sync 流程不中断，Agent 回退到 LLM 全量合并模式

**Independent Test**: 临时重命名 `sync-merge-engine.mjs`，运行 sync 流程，验证 Agent 降级行为

### T009 — 降级路径验证与加固

- [ ] T009 [US5] 验证降级路径在 `plugins/spec-driver/agents/sync.md` 中正确实现

**依赖**: T008（降级路径已写入 sync.md）
**FR 映射**: FR-009
**US 映射**: US5

**文件**: `plugins/spec-driver/agents/sync.md`（可能微调降级路径措辞）

**步骤**:

1. 审查 T008 中写入的降级路径部分，确认涵盖所有降级触发条件（agent-to-script-interface.md Section 6 的 D1-D6）：
   - D1：脚本文件不存在
   - D2：exit code != 0
   - D3：stdout 不是有效 JSON
   - D4：缺少 schemaVersion 字段
   - D5：schemaVersion major 版本不兼容
   - D6：JSON 中存在 error 字段
2. 确认降级行为描述完整：
   - 回退到 LLM 全量合并模式
   - 在 trace 中记录降级原因
   - 在输出摘要中标注 `[降级: 合并引擎不可用，使用 LLM 全量合并]`
3. 确认降级模式明确不执行的操作：产品名修正、差集自动检测、结构化验证
4. 如需微调措辞使其更清晰，编辑 sync.md 降级路径段落（保持 <5,000 bytes 总约束）

**验收标准**:
- sync.md 降级路径覆盖 D1-D6 全部触发条件
- 降级行为描述与 spec.md US5 验收场景一致
- 文件大小仍 <5,000 bytes

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 集成验证、同步检查、最终确认

### T010 — 端到端集成验证

- [ ] T010 [US1] [US2] 端到端验证：在当前项目上运行 `node plugins/spec-driver/scripts/sync-merge-engine.mjs --dry-run --project-root .`

**依赖**: T007
**FR 映射**: FR-001, FR-007, FR-010
**SC 映射**: SC-002, SC-003, SC-004

**步骤**:

1. 运行 `node plugins/spec-driver/scripts/sync-merge-engine.mjs --dry-run --project-root .`
2. 确认 exit code 0，stdout 为有效 JSON
3. 确认 JSON 包含 `schemaVersion: "1.0.0"`
4. 确认 JSON 中 `products` 非空（当前项目有产品映射）
5. 确认 JSON 中 `stats` 各字段合理（totalProducts > 0, totalSpecs > 0）
6. 确认 warnings 无致命错误（可有宽松解析的警告）
7. 连续运行两次，比对 JSON 输出完全一致（确定性验证 SC-002）
8. 运行 `--dry-run` 前后对比 `git status`，确认无文件变更（SC-003）
9. 运行 `node plugins/spec-driver/scripts/sync-merge-engine.mjs --dry-run --json --project-root .`，确认组合参数正常工作
10. 运行 `node plugins/spec-driver/scripts/sync-merge-engine.mjs --project-root /nonexistent`，确认 exit code 1 和 INVALID_PROJECT_ROOT 错误

**验收标准**:
- 所有 10 步均通过
- 确定性验证（两次输出一致）
- dry-run 模式无文件修改
- 错误处理正确

---

### T011 — 仓库同步检查

- [ ] T011 运行 `npm run repo:check` 确认仓库同步状态通过

**依赖**: T002-T010
**SC 映射**: SC-005

**步骤**:

1. 运行 `npm run repo:check`
2. 如有失败，修复并重新运行
3. 确认全部通过

**验收标准**:
- `npm run repo:check` 全部通过（SC-005）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖 — 首先执行
- **Foundational Lib (Phase 2)**: 依赖 Phase 1 完成
- **CLI 入口 (Phase 3)**: 依赖 Phase 2 全部 lib 模块完成
- **Prompt 瘦身 (Phase 4)**: 依赖 Phase 3 完成（需了解脚本接口）
- **降级验证 (Phase 5)**: 依赖 Phase 4 完成
- **Polish (Phase 6)**: 依赖 Phase 3-5 完成

### Task Dependencies（精确）

```
T001 (Setup)
  │
  ├──► T002 (product-mapping) ─────────────────┐
  ├──► T003 (timeline-builder) ──► T004 (merge-strategy) ──► T005 (conflict-resolver) ──► T006 (validator)
  │                                             │
  │    ┌────────────────────────────────────────┘
  │    ▼
  └──► T007 (CLI 入口，依赖 T002-T006)
         │
         ├──► T008 (sync.md 瘦身)
         │      │
         │      └──► T009 (降级验证)
         │
         ├──► T010 (端到端验证)
         │
         └──► T011 (repo:check)
```

### Parallel Opportunities

- **T002 和 T003 可并行**：产品映射模块和时间线模块无直接依赖，操作不同文件
- **T004 依赖 T003**：合并策略需要 Timeline 结构
- **T005 依赖 T004**：冲突解决需要 MergeSkeleton
- **T006 依赖 T004 + T005**：验证需要合并结果
- **T010 和 T011 可并行**：集成验证和仓库检查独立

---

## Parallel Example: Phase 2 Lib 模块

```bash
# 并行启动 T002 和 T003（不同文件，无依赖）:
Task: "实现 plugins/spec-driver/scripts/lib/sync-product-mapping.mjs"
Task: "实现 plugins/spec-driver/scripts/lib/sync-timeline-builder.mjs"

# T002 + T003 完成后，串行执行 T004 → T005 → T006
```

---

## Implementation Strategy

### MVP First（US1 + US2 核心）

1. 完成 Phase 1: Setup（rebase master）
2. 完成 Phase 2: 5 个 lib 模块（核心纯函数逻辑）
3. 完成 Phase 3: CLI 入口脚本（编排 + dry-run）
4. **STOP and VALIDATE**: 运行端到端 dry-run 验证（T010）
5. 此时 US1（确定性合并）和 US2（dry-run 预览）的脚本侧已就绪

### Incremental Delivery

1. Phase 1-2: Lib 模块就绪 → US4（可独立测试模块）基本就绪
2. Phase 3: CLI 入口就绪 → US1 + US2 就绪
3. Phase 4: Prompt 瘦身 → US3 就绪
4. Phase 5: 降级验证 → US5 就绪
5. Phase 6: 全量验证 → 整体就绪

### 行数预估汇总

| 任务 | 文件 | 预估行数 |
|------|------|---------|
| T002 | sync-product-mapping.mjs | ~250 |
| T003 | sync-timeline-builder.mjs | ~120 |
| T004 | sync-merge-strategy.mjs | ~200 |
| T005 | sync-conflict-resolver.mjs | ~80 |
| T006 | sync-validator.mjs | ~120 |
| T007 | sync-merge-engine.mjs | ~200 |
| T008 | sync.md（重写） | ~4,700 bytes |
| **合计** | **6 个 MJS + 1 个 Prompt** | **~970 行 MJS** |

---

## Notes

- [P] 标记 = 不同文件，无依赖，可并行
- [Story] 标记映射到 spec.md 的 User Story（US1-US5）
- 所有 lib 模块遵循 NFR-002：`.mjs` 后缀、ES Module、`import.meta.url` 守卫、驼峰命名
- 零 npm 依赖（NFR-001），仅用 Node.js 内置模块 + 现有 helper
- 错误处理遵循 NFR-004：关键文件缺失抛 Error、可选文件缺失返回 null/默认值、警告收集在 warnings 数组
- T008 Prompt 瘦身是对 `plugins/spec-driver/agents/sync.md` 的大幅重写，需在完成 T007 后执行以确保脚本接口理解完整
- SKILL.md 不在本 Feature 修改范围内（plan.md Section 8.1 确认不需要修改）
