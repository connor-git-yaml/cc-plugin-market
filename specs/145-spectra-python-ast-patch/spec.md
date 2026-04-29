# Feature Specification: Spectra v4.x Python AST 函数级 Graph 接入 + Phase 2 集成 Bug 修复

**Feature Branch**: `claude/tender-mayer-644a32`
**Created**: 2026-04-29
**Status**: Draft
**Feature Number**: 145 (originally 143; renumbered after rebase due to upstream collision with specs/143-large-project-e2e-baseline/ + Feature 144)
**Version Impact**: v4.0.x → v4.1.0（P0 为新功能，触发 minor 版本升级）

---

## 背景

Spectra v4.x 在 Phase 2 集成测试（micrograd 项目）中暴露了四个问题：

1. **P0（新功能缺失）**：`graph.json` 仅含 4 个 spec 节点、0 边、0 hyperedge。根因是 Python 文件虽经 `PythonLanguageAdapter` 处理并进入 `mergedGraph`，但知识图谱构建器（`graph-builder.ts`）未把 `CodeSkeleton` 中的函数/类符号转换为 `GraphNode`，导致函数级节点缺失。
2. **P1（集成 bug）**：`--hyperedges` 首次运行时 `designDocAbsPaths` 为空，hyperedge/anchor 集成被静默跳过，导致必须第二次运行才能生成 hyperedge。
3. **P2（集成 bug）**：`README.md` 被 `file-scanner.ts` 的扩展名白名单过滤，`debt-scanner` 无法从 README 提取技术债 Open Questions，`technical-debt.md` 的 Open Questions 区块为空。
4. **P3（估算 bug）**：`--dry-run` 预估偏差 64.8x。`estimateModuleCost` 仅计算源文件内容 token，未包含 system prompt overhead（约 2000 tokens）和 context-assembler 组装倍数（约 1.35x）。

### 目标

- micrograd 跑完后 `graph.json` 包含 ≥ 8 函数级节点、≥ 5 边、≥ 1 hyperedge；
- 5 个 MCP 图工具真实可用；
- `--dry-run` 偏差压缩至 < 30%（实际/预估 < 1.3x）；
- `technical-debt.md` 含 ≥ 1 个 Open Question（提取自 README）；
- 完整 batch **一次跑通**，不需要第二次运行才能生成 hyperedge。

### 为什么现在做

Phase 2 集成测试已明确暴露上述缺口，且技术调研确认四个问题均在现有代码能力范围内修复，不引入新外部依赖，修复窗口成本最低。

---

## 用户场景与功能需求

### User Story 1 — Python 项目一次跑通知识图谱（Priority: P0）

开发者在 Python 项目（如 micrograd）根目录执行 `spectra batch`，期望 `graph.json` 包含项目中的函数/类符号节点，而非仅有 spec 文档节点。

**为什么是 P0**：这是 Spectra 对 Python 项目知识图谱能力的核心缺失，没有函数级节点，5 个 MCP 图工具的查询结果无实际意义。

**独立可测试性**：可通过在 micrograd 上执行 `spectra batch` 并检查输出 `graph.json` 的节点数量独立验证。

**验收场景**：

1. **Given** micrograd 项目含 ≥ 3 个 `.py` 文件（包含函数定义），**When** 执行 `spectra batch`，**Then** 输出 `graph.json` 中节点数量 ≥ 8，其中包含函数/类符号节点（`kind: 'component'`），节点 ID 格式为 `{相对路径}#{symbolName}`。
2. **Given** 同名函数分布在不同 `.py` 文件中，**When** 符号节点被写入 `graph.json`，**Then** 所有节点 ID 全局唯一（不发生 ID 冲突）。
3. **Given** 函数符号节点已生成，**When** 检查 `graph.json` 的边列表，**Then** 至少存在 ≥ 5 条 containment 边（`relation: 'contains'`），表示 function → module 的归属关系。
4. **Given** batch 已生成 graph，**When** 检查 `graph.json` 的 hyperedge 列表，**Then** 至少存在 ≥ 1 条 hyperedge（即 P1 修复后 anchor 集成正常触发）。

---

### User Story 2 — Hyperedge 首次运行即生效（Priority: P1）

开发者首次在项目上执行 `spectra batch --hyperedges`，期望 hyperedge/anchor 集成在本次运行中即完成，不需要二次运行。

**为什么是 P1**：首次跑不通会破坏用户对工具可靠性的信任，且直接阻断 P0 目标中"≥ 1 hyperedge"的验收。

**独立可测试性**：在空输出目录的 Python 项目上执行一次 batch，检查 `graph.json` hyperedge 列表。

**验收场景**：

1. **Given** 项目 outputDir 为空（首次运行），**When** 执行 `spectra batch`（完整流程），**Then** `graph.json` 中 hyperedge 列表不为空（≥ 1 条），无需再次运行。
2. **Given** 本轮 generator 运行过程中某个 doc generator 抛出异常导致 `writtenFiles` 为空，**When** batch 执行到 hyperedge/anchor 集成阶段，**Then** 系统主动扫描 `outputDir/project/` 目录下已存在的 `.md` 文件作为 `designDocAbsPaths`，集成不被跳过。
3. **Given** `designDocAbsPaths` 构建完成，**When** batch 日志输出 hyperedge 集成阶段信息，**Then** 日志中明确显示 `designDocAbsPaths.length`（诊断日志，便于排查）。

---

### User Story 3 — 技术债 Open Questions 从 README 提取（Priority: P2）

开发者运行 batch 后，期望 `technical-debt.md` 中 Open Questions 区块包含从项目 README.md 中提取的问题，而非空列表。

**为什么是 P2**：技术债扫描是独立链路，不阻断 P0/P1，但直接影响"technical-debt.md 含 ≥ 1 个 Open Question"这条端到端验收标准。

**独立可测试性**：在含 README.md 的 Python 项目上执行 batch，检查 `technical-debt.md`。

**验收场景**：

1. **Given** 项目根目录含 `README.md`（且文件中包含问题描述或 TODO），**When** 执行 `spectra batch`，**Then** `technical-debt.md` 的 Open Questions 区块含 ≥ 1 条记录。
2. **Given** debt-scanner 独立扫描 `.md` 文件，**When** `file-scanner.ts` 的 `supportedExtensions` 不包含 `.md`，**Then** README.md 仍能被 debt-scanner 处理（两条链路解耦，互不依赖）。
3. **Given** `.md` 文件进入 debt-scanner 链路，**When** batch 对 `.md` 文件执行代码分析（AST 分析），**Then** `.md` 文件不触发 AST 分析（`analyzeFile()` 不被调用），不产生解析错误。

---

### User Story 4 — Dry-run 预估偏差压缩至 30% 以内（Priority: P3）

开发者执行 `spectra batch --dry-run` 时，期望预估 token 消耗与实际运行偏差 < 30%（实际/预估 < 1.3x），以便合理规划 API 预算。

**为什么是 P3**：预估偏差不阻断功能，但直接影响"实际 vs 预估偏差 < 1.3x"这条验收标准；P3 的校准应在 P0 实现后实测新偏差再最终定稿常量值。

**独立可测试性**：在 micrograd 上先 `--dry-run` 再完整 batch，对比估算 vs 实际 token 消耗。

**验收场景**：

1. **Given** 执行 `spectra batch --dry-run`，**When** 检查预估总 token 数，**Then** 预估值考虑了 system prompt overhead（≈ 2000 tokens）和 context-assembler 组装倍数（≈ 1.35x）。
2. **Given** 已完成完整 batch 运行并记录实际 token 消耗，**When** 对比 `--dry-run` 预估值与实际值，**Then** 实际/预估比值 < 1.3x。
3. **Given** overhead 常量以命名常量形式存在（`SYSTEM_PROMPT_TOKEN_OVERHEAD`、`CONTEXT_ASSEMBLY_MULTIPLIER`），**When** 查看 `budget-gate.ts`，**Then** 代码中无硬编码魔法数字，常量注释说明测量时间（2026-04）。

---

## 边界约定

### 允许修改的文件范围

| 文件/目录 | 允许的操作 |
|-----------|-----------|
| `src/adapters/python-adapter.ts` | 扩展（新增 `extractSymbolNodes()` 方法或桥接逻辑） |
| ~~`src/adapters/python-ast-extractor.ts`（若新建）~~ | [ADR-001 已排除] 不新建独立文件；桥接逻辑内联到 `python-adapter.ts` 中的 `extractSymbolNodes()` 方法 |
| `src/panoramic/graph/**` | 修改（graph-builder.ts 第四路接入逻辑） |
| `src/panoramic/builders/doc-graph-builder.ts` | 修改（如需扩展 DocGraph 构建） |
| `src/panoramic/hyperedges/**` | 修改（hyperedge 集成路径修复） |
| `batch-project-docs.ts` 或 batch-orchestrator.ts | 修改（P1 designDocAbsPaths 扫盘修复；P0 符号提取注入点） |
| `src/utils/file-scanner.ts` | 修改（P2 解耦 debt-scanner 扫描路径） |
| `src/debt-scanner/**` | 修改（P2 独立 .md 文件扫描） |
| `src/batch/budget-gate.ts` | 修改（P3 overhead 常量） |
| `tests/**` | 新增/修改（所有改动需配套单元测试） |
| `specs/M-101-phase2-reading-platform/postmortem.md` | 追加（不重写） |
| `CHANGELOG.md` | 追加 |
| `contracts/release-contract.yaml` | 升 patch → v4.1.0（因 P0 为 minor 新功能，升 minor） |

### 禁止修改的文件范围

| 文件/目录 | 原因 |
|-----------|------|
| `src/adapters/typescript-adapter.ts` 及 ts-morph 相关文件 | TS/JS 链路不受影响，不引入回归风险 |
| `plugins/spec-driver/**` | spec-driver 为独立插件，不在本 feature 范围内 |
| 其他 panoramic Phase 1 已落地能力（WorkspaceIndexGenerator、CrossPackageAnalyzer 等）的核心接口 | 避免破坏已稳定 API 合约 |

---

## 功能需求

### FR-001：Python 符号节点提取与注入 [必须]

系统 MUST 在 `spectra batch` 默认流程中（不需要额外 flag），通过 `PythonLanguageAdapter.analyzeFile()` 提取项目内所有 `.py` 文件的 `CodeSkeleton.exports`，并将每个 `ExportSymbol`（function/class）转换为 `ExtractionResult`，注入 `buildKnowledgeGraph()` 第四路数据源。

**可测试性**：单元测试验证 `ExportSymbol → GraphNode` 转换逻辑；集成测试验证 `graph.json` 节点数量。
**追踪至**：User Story 1

### FR-002：函数级节点 ID 格式规范 [必须]

系统 MUST 使用 `{相对路径}#{symbolName}` 格式生成函数/类符号节点的 `GraphNode.id`，确保跨文件同名符号的全局唯一性。

**可测试性**：单元测试验证同名函数在不同文件中的 ID 不重复。
**追踪至**：User Story 1

### FR-003：节点 kind 映射 [必须]

系统 MUST 将 Python 函数（`'function'`）和类（`'class'`）符号映射为 `GraphNode.kind = 'component'`，文件级节点映射为 `kind = 'module'`。

**可测试性**：检查输出 `graph.json` 中节点 kind 字段值。
**追踪至**：User Story 1

### FR-004：containment 边构建 [必须]

系统 MUST 为每个函数/类符号节点与其所在模块节点之间创建 containment 边（`GraphEdge.relation = 'contains'`），方向为 module → function/class。

**可测试性**：检查 `graph.json` edges 列表中 `relation: 'contains'` 的边数量。
**追踪至**：User Story 1

### FR-005：不引入新外部依赖 [必须]

P0 实现 MUST 复用现有 `web-tree-sitter@^0.24.7` 和 `grammars/python.wasm`，不新增任何 npm 依赖。

**可测试性**：检查 `package.json` 的 `dependencies` 在本 feature 前后无新增条目。
**追踪至**：User Story 1（技术约束）

### FR-006：designDocAbsPaths 改为磁盘扫描 [必须]

系统 MUST 将 `designDocAbsPaths` 的构建逻辑从依赖本轮 `generateBatchProjectDocs()` 的 `writtenFiles` 输出，改为主动扫描 `outputDir/project/` 目录下所有已存在的 `.md` 文件，以解决首次运行时路径为空的问题。

**可测试性**：在空输出目录首次运行 batch，断言 hyperedge 列表不为空。
**追踪至**：User Story 2

### FR-007：hyperedge 集成诊断日志 [可选]

系统 SHOULD 在 hyperedge/anchor 集成阶段输出诊断日志，包含 `designDocAbsPaths.length`，便于排查路径为空的情况。

**可测试性**：检查 batch 日志输出。
**追踪至**：User Story 2

### FR-008：debt-scanner 独立扫描 .md 文件 [必须]

debt-scanner MUST 独立遍历项目目录查找 `.md` 文件，不依赖 `file-scanner.ts` 的 `supportedExtensions` 白名单过滤，确保 `README.md` 等文档被纳入技术债扫描。

**可测试性**：在含 README.md 的项目上运行 batch，检查 `technical-debt.md` Open Questions 区块。
**追踪至**：User Story 3

### FR-009：.md 文件不触发 AST 分析 [必须]

系统 MUST 确保 `.md` 文件仅进入 debt-scanner 的文本读取链路，不触发 `LanguageAdapterRegistry.getAdapter()` 及 `analyzeFile()` 的 AST 分析流程。

**可测试性**：检查 batch 运行日志，确认无 `.md` 文件解析错误。
**追踪至**：User Story 3

### FR-010：budget-gate 加入 overhead 常量 [必须]

`estimateModuleCost` MUST 在计算预估 token 时，乘以 `CONTEXT_ASSEMBLY_MULTIPLIER`（推荐值 1.35）并加上 `SYSTEM_PROMPT_TOKEN_OVERHEAD`（推荐值 2000 tokens），两个常量需有命名并在注释中标明测量时间。

**可测试性**：单元测试验证 `estimateModuleCost` 输出值包含 overhead；端到端对比 dry-run 与实际偏差。
**追踪至**：User Story 4

### FR-011：P3 常量在 P0 实现后校准 [可选]

`SYSTEM_PROMPT_TOKEN_OVERHEAD` 和 `CONTEXT_ASSEMBLY_MULTIPLIER` SHOULD 在 P0 实现后，通过实际运行 batch 测量 token 消耗，再做最终校准，确保 dry-run 偏差 < 30%。

**可测试性**：实际/预估比值 < 1.3x。
**追踪至**：User Story 4

---

## 非功能需求

- **NF-001**：本 feature 涉及的所有改动不得导致现有 `npx vitest run` 任何测试失败（零回归）。
- **NF-002**：`npm run build` TypeScript 类型检查零错误。
- **NF-003**：新增功能和 bug 修复均需配套单元测试，且在同一提交中包含（重点：`budget-gate.test.ts`、`batch-orchestrator.test.ts`、`graph-builder.test.ts`）。
- **NF-004**：大型 Python 项目（> 100 个 `.py` 文件）批量提取符号时，复用 `TreeSitterAnalyzer.dispose()` 机制，batch 结束后释放 parser，不集中持有全量 skeleton，避免内存压力。
- **NF-005**：Python WASM grammar 冷启动延迟由 `GrammarManager` 单例缓存处理，P0 实现不需要额外处理。

---

## 边界情况

- **同名函数跨文件**：ID 使用相对路径前缀，不发生冲突（FR-002 覆盖）。
- **Python 文件无任何导出符号**：`CodeSkeleton.exports` 为空时，该文件仍生成文件级 `module` 节点，不报错。
- **outputDir/project/ 目录不存在**（首次运行且未创建）：P1 修复中的磁盘扫描应做目录存在性检查，目录不存在时 `designDocAbsPaths` 为空但不抛出异常，batch 继续。
- **README.md 不含任何 Open Question 文本**：debt-scanner 正常处理，`technical-debt.md` Open Questions 区块为空（此为合法结果，不报错）；micrograd README 包含 Open Questions，可满足端到端验收。
- **P3 常量首版精度**：`SYSTEM_PROMPT_TOKEN_OVERHEAD` 基于实测约 2000 tokens，但随 spec 模板版本变化会漂移；首版以命名常量形式存在，待 P0 后实测校准（FR-011）。
- **call graph（function → function 调用边）**：当前 MVP 仅实现 containment 边（function → module），call graph 超出当前迭代范围，标注为 `[YAGNI-移除]`，后续迭代按需实现。

---

## 端到端验收标准（5 场景）

以下 5 个验收场景为本 feature 交付的最终门禁，均基于 micrograd 项目执行：

### SC-001：Dry-run 偏差 < 30%

```bash
# 先执行 dry-run，记录预估 token
spectra batch --dry-run 2>&1 | grep "estimated"
# 再执行完整 batch，记录实际 token
spectra batch 2>&1 | grep "actual"
# 验证：实际 / 预估 < 1.3x
```

**通过条件**：实际 token 消耗 / dry-run 预估值 < 1.3x。

---

### SC-002：完整 batch 一次跑通（不需要两次运行 hyperedge）

```bash
# 清空输出目录，首次运行
rm -rf output/
spectra batch
# 检查 graph.json hyperedge 列表
cat output/graph.json | jq '.hyperedges | length'
```

**通过条件**：`hyperedges` 列表长度 ≥ 1，无需执行第二次 batch。

---

### SC-003：graph.json 含 ≥ 8 函数级节点 + ≥ 5 边 + ≥ 1 hyperedge

```bash
cat output/graph.json | jq '
  {
    component_nodes: [.nodes[] | select(.kind == "component")] | length,
    edges: .edges | length,
    hyperedges: .hyperedges | length
  }
'
```

**通过条件**：
- `component_nodes` ≥ 8
- `edges` ≥ 5
- `hyperedges` ≥ 1

---

### SC-004：technical-debt.md 含 ≥ 1 个 Open Question

```bash
grep -c "Open Question" output/project/technical-debt.md
# 或检查专门的 Open Questions 区块
grep -A 20 "## Open Questions" output/project/technical-debt.md
```

**通过条件**：`technical-debt.md` 中 Open Questions 区块包含 ≥ 1 条记录（提取自 micrograd README.md）。

---

### SC-005：实际 vs 预估偏差 < 1.3x（与 SC-001 呼应）

同 SC-001，通过 batch 运行后的 token summary 输出验证：

```bash
spectra batch 2>&1 | grep -E "estimated|actual|ratio"
```

**通过条件**：日志中输出的偏差比值 < 1.3，或手工计算实际/预估 < 1.3。

---

## 版本影响

| 项目 | 当前值 | 目标值 | 原因 |
|------|--------|--------|------|
| `contracts/release-contract.yaml` version | v4.0.x | v4.1.0 | P0 为新功能（Python 函数级 graph），触发 minor 版本升级 |
| `package.json` version | v4.0.x | v4.1.0 | 同上，通过 `npm run release:sync` 同步 |

**注**：P1/P2/P3 为 bug 修复，单独发布时应升 patch（v4.0.x+1）；但本 feature 打包 P0+P1+P2+P3 一并交付，统一升 minor（v4.1.0）。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 值 | 说明 |
|------|----|------|
| **组件总数** | 3 | 扩展：`PythonLanguageAdapter.extractSymbolNodes()`（ADR-001：内联到 python-adapter.ts，不新建文件）；修改：`batch-orchestrator.ts`（P0 注入 + P1 路径修复）；修改：`budget-gate.ts`（P3 overhead） |
| **接口数量** | 2 | `ExtractionResult` 已有接口（复用，无结构变更）；`ScanOptions` 可能新增 `includeDocs?: boolean`（P2 可选方案） |
| **依赖新引入数** | 0 | 复用 `web-tree-sitter` + `grammars/python.wasm`，无新增 npm 依赖 |
| **跨模块耦合** | 低 | P0 主要在 extraction 层新增文件；P1/P2/P3 各自独立修复，改动面无交叉 |
| **复杂度信号** | 无 | 无递归结构、状态机、并发控制、数据迁移 |
| **总体复杂度** | **LOW** | 组件 < 3、接口 < 4、无复杂度信号；P0 主体为桥接转换层约 100-150 行代码 |

---

## 歧义处理

**[AUTO-RESOLVED: P2 修复方案]**：P2 有两种方案——(a) 在 `ScanOptions` 新增 `includeDocs` flag；(b) debt-scanner 独立遍历 `.md` 文件。调研报告明确指出方案 (b) 更轻量且职责分离（debt-scanner 与 file-scanner 解耦），自动选择方案 (b)。

**[AUTO-RESOLVED: P0 触发机制]**：调研推荐在 `runBatch()` 中始终（不需要 flag）注入 Python 符号提取，以确保默认 batch 即可生成函数级节点。此方案与"无 flag、默认即可用"的用户体验目标一致，自动采纳。
