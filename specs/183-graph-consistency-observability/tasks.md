---
feature: F183
title: graph 一致性收口 + 可观测性 + code-only 帮助文本校正
mode: fix
status: tasks
created: 2026-06-13
---

# F183 任务列表

**输入**：`specs/183-graph-consistency-observability/plan.md`（变更清单 + 回归测试规划 T-01~T-04）
**方法**：TDD（RED→GREEN→回归验证）
**并行策略**：修复 1 是核心；修复 2/3/4 彼此独立可并行；均可在 Phase 1 前置检查后并行推进

---

## Phase 1：前置护栏确认

**目的**：在任何代码改动前确认 F182 三护栏文件当前零改动，作为基线快照，保证整个 fix 过程中该约束持续成立。

- [x] T001 执行 `git diff HEAD -- src/batch/delta-regenerator.ts src/batch/regen-plan.ts src/batch/batch-orchestrator.ts`，确认输出为空（零改动）；若非空则停止并上报。
  **文件**：`src/batch/delta-regenerator.ts`、`src/batch/regen-plan.ts`、`src/batch/batch-orchestrator.ts`（只读验证，不改动）

**检查点**：护栏基线确认 → 可并行启动修复 1/2/3/4

---

## Phase 2：修复 1 — writeKnowledgeGraph 内聚归一化（核心）

**目标**：将 `normalizeGraphForWrite` 内聚进 `writeKnowledgeGraph`，使 graph / community / batch 三路写盘自动经过同一归一化出口，消除跨写盘点形态不一致。

**独立验证**：`npx vitest run tests/unit/graph/graph-builder-normalize.test.ts` 含新增 T-01/T-02 全绿；`graph-builder-bytestable.test.ts` 快照不变。

### 修复 1 — RED 阶段（先写测试，确认失败）

- [x] T002 在 `tests/unit/graph/graph-builder-normalize.test.ts` 追加 describe 块「writeKnowledgeGraph 写盘出口应用归一化（shared write boundary applies normalization，T-01）」（**Codex W-2：诚实命名，unit 测的是共用出口契约，非三条 CLI 端到端路径**）：
  - 构造含乱序 nodes/links + 含 `metadata.currentRun` 的 graphJson，调 `writeKnowledgeGraph` 后读回落盘文件：
  - 断言 `nodes` 按 id 字典序
  - 断言 `links` 按三元组字典序
  - 断言无任何节点 `metadata.currentRun` 字段
  - **不断言** `generatedAt` 逐字节相等（`stripTimestamps:false` 时各路时间戳独立）
  - 注释标注：`hyperedge.nodes` 成员顺序 / `metadata` key 顺序不在 F183 归一化契约内，测试不断言这两项
  - **追加静态断言（W-2）**：用 `fs.readFileSync` 读 `src/cli/commands/graph.ts` / `community.ts` / `src/batch/batch-orchestrator.ts` 源码，断言三者均含 `writeKnowledgeGraph(` 调用文本 —— 诚实建立「三路共用同一出口 → 形态一致来自共享 writeKnowledgeGraph，而非分别端到端验证」
  - 确认测试 RED（当前 writeKnowledgeGraph 未调 normalizeGraphForWrite，currentRun 泄漏 → 断言失败）
  **文件**：`tests/unit/graph/graph-builder-normalize.test.ts`

- [x] T003 在 `tests/unit/graph/graph-builder-normalize.test.ts` 追加 it 块「batch epoch 保留（T-02 防回归）」：
  - 构造含 epoch 时间戳（`1970-01-01T00:00:00.000Z`）的 graphJson
  - 调用 `writeKnowledgeGraph(graphJson, outputDir)`（默认 options，不传 stripTimestamps）
  - 断言写盘后 `generatedAt` 值仍为 epoch（`1970-01-01T00:00:00.000Z`，不变）
  - 确认测试 RED（若 normalizeGraphForWrite 默认行为影响 epoch 则失败）
  **文件**：`tests/unit/graph/graph-builder-normalize.test.ts`

### 修复 1 — GREEN 阶段（改源码）

- [x] T004 修改 `src/panoramic/graph/graph-builder.ts` 中 `writeKnowledgeGraph` 函数（L514-530）：
  1. 函数签名新增可选第三参：`options?: NormalizeGraphOptions`
  2. 函数体顺序：① `scanGraphPortabilityViolations`（F193 守卫，保留不动）→ ② `normalizeGraphForWrite(graphJson, options)`（新增内聚调用）→ ③ `writeAtomicJson`
  3. 添加中文 why 注释，标注执行顺序及 F183 理由
  4. 注释中标注：「若未来 normalizeGraphForWrite 增路径转换需重排顺序（见 I-1）」
  - **不改动**：`normalizeGraphForWrite` 函数本体；`NormalizeGraphOptions` 类型定义；F193 portable 守卫逻辑
  - **不改动调用点**：`graph.ts:198`、`community.ts:99`、`batch-orchestrator.ts:1631`（options 默认 undefined，等价于 `{stripTimestamps:false}`）
  **文件**：`src/panoramic/graph/graph-builder.ts`

### 修复 1 — 回归验证

- [x] T005 检查 `tests/panoramic/graph-persistence.test.ts` 中直接调用 `writeKnowledgeGraph` 的断言（Codex I-4 补漏）：Codex I-1 已确认该文件**无 order-sensitive 断言**（只查结构字段/计数/文件大小/NetworkX 必填字段），新排序逻辑不会打破现有断言。仅需运行确认全绿；若某 fixture 注入了 `currentRun` 且被断言存在，则更新为"已剥除"。预期无需改动，跑通即可。
  **文件**：`tests/panoramic/graph-persistence.test.ts`

- [x] T006 运行 `npx vitest run tests/unit/graph/graph-builder-normalize.test.ts`，确认 T-01/T-02 及现有归一化用例全绿
  **文件**：`tests/unit/graph/graph-builder-normalize.test.ts`（验证）

- [x] T007 运行 `npx vitest run tests/unit/graph/graph-builder-bytestable.test.ts`，确认 byte-stable 快照不变（双重归一化幂等）
  **文件**：`tests/unit/graph/graph-builder-bytestable.test.ts`（验证）

- [x] T008 运行 `npx vitest run tests/panoramic/graph-persistence.test.ts`，确认 currentRun 剥除行为正确
  **文件**：`tests/panoramic/graph-persistence.test.ts`（验证）

**检查点**：修复 1 全绿 → 继续 Phase 3/4/5

---

## Phase 3：修复 2 — buildTsConfigContext warn 限频（[P] 可与修复 3/4 并行）

**目标**：`buildTsConfigContext` 两失败分支（`configFile.error` 与 `catch`）加 `logger.warn` + 模块级 Set 限频，消除 monorepo 子包 tsconfig 损坏时的双静默。

**独立验证**：`npx vitest run tests/unit/core/import-resolver-warn.test.ts` 全绿；`import-resolver.test.ts` 现有用例零回归。

### 修复 2 — RED 阶段

- [x] T009 [P] 新建 `tests/unit/core/import-resolver-warn.test.ts`：（**Codex C-1 mock 方案**）
  - **logger 断言方式**：logger 是模块级私有实例无法 `vi.spyOn`；改 `vi.spyOn(process.stderr, 'write')`（logger 默认 warn 级别写 stderr），断言被调用且参数字符串含 configPath
  - `configFile.error` 分支（可靠触发）：写一个语法损坏的 tsconfig（如 `{ "compilerOptions": ` 缺闭合）→ `ts.readConfigFile` 返回 `{error}` → 断言 stderr.write 调用一次且含该 configPath
  - 相同 `configPath` 第二次调用 → 断言 stderr.write **不重复**触发（negativeCache 限频）
  - 不同 configPath → 断言各自 warn 一次（cache 不误伤其他路径）
  - catch 分支：用 `vi.mock('ts-morph')` 让 `ts.readConfigFile` throw → 断言 stderr.write 触发一次
  - 断言所有失败路径函数仍 `return null`（行为语义不变）
  - 确认测试 RED（当前无 warn 调用）
  **文件**：`tests/unit/core/import-resolver-warn.test.ts`（新建）

### 修复 2 — GREEN 阶段

- [x] T010 [P] 修改 `src/core/import-resolver.ts`：
  1. 新增 import：`import { createLogger } from '../panoramic/utils/logger.js';`
  2. 模块级常量：`const logger = createLogger('import-resolver');`
  3. 模块级 Set：`const warnedConfigPaths = new Set<string>();`（仅限频 warn emission，不跳过解析）
  4. `configFile.error` 分支（L443-445）：加 `logger.warn('[import-resolver] buildTsConfigContext 失败（${configPath}）：${errorSummary}')` + `warnedConfigPaths.add(configPath)`（仅首次）
  5. `catch` 分支（L464-466）：同上限频 warn
  - **关键**：`buildTsConfigContext` 始终尝试解析，失败仍 return null；Set 只缓存已 warn 的 configPath（emission 限频），绝不跳过解析
  **文件**：`src/core/import-resolver.ts`

### 修复 2 — 回归验证

- [x] T011 [P] 运行 `npx vitest run tests/unit/core/import-resolver-warn.test.ts`，确认新增测试全绿
  **文件**：`tests/unit/core/import-resolver-warn.test.ts`（验证）

- [x] T012 [P] 运行 `npx vitest run tests/unit/core/import-resolver.test.ts`，确认现有 import-resolver 用例零回归
  **文件**：`tests/unit/core/import-resolver.test.ts`（验证）

**检查点**：修复 2 全绿 → 可继续

---

## Phase 4：修复 3 — module-derivation monorepo 双口径 warn（[P] 可与修复 2/4 并行）

**目标**：`module-derivation.ts` 中 `buildModuleGraph` 在解析 tsConfigPath 后加 monorepo 多 tsconfig fs 扫描（可行半），检测到 root 下存在非 root `tsconfig*.json` 时 `logger.warn`。不可行半（.d.ts 零传播）仅文档化，不加运行时检测。

**独立验证**：新建 warn 测试全绿；`module-derivation.ts` 现有用例零回归。

### 修复 3 — RED 阶段

- [x] T013 [P] 新建 `tests/unit/knowledge-graph/module-derivation-warn.test.ts`，**单测纯 helper `collectNonRootTsConfigNames`（Codex C-2：避免全局 mock fs.readdirSync 污染 scanFiles）**：
  - 传入 `['tsconfig.json','tsconfig.app.json','tsconfig.node.json','package.json']` → 断言返回 `['tsconfig.app.json','tsconfig.node.json']`（仅非 root tsconfig*.json）
  - 传入 `['tsconfig.json','src','package.json']` → 断言返回 `[]`（无非 root tsconfig）
  - 传入 `['tsconfig.base.json']`（仅子 tsconfig 无 root）→ 断言返回 `['tsconfig.base.json']`
  - 边界：空数组 → `[]`；大小写/扩展名精确匹配 `tsconfig*.json`
  - **零 fs mock**（纯函数输入输出），不触碰 scanFiles
  - 确认测试 RED（helper 尚不存在）
  **文件**：`tests/unit/knowledge-graph/module-derivation-warn.test.ts`（新建）

### 修复 3 — GREEN 阶段

- [x] T014 [P] 修改 `src/knowledge-graph/module-derivation.ts`：
  1. **新增导出纯 helper**：`export function collectNonRootTsConfigNames(fileNames: string[]): string[]` —— 过滤出匹配 `tsconfig*.json` 且 **不等于** `tsconfig.json` 的项（纯函数，无 fs，供 T013 单测）
  2. 在 `buildModuleGraph` 解析 `tsConfigPath` 后、`buildTsConfigContext` 调用前：`const nonRoot = collectNonRootTsConfigNames(fs.readdirSync(resolvedRoot))`（**无 withFileTypes，返回 string[]，不与 scanFiles 的 Dirent 调用冲突**）；用 `try/catch` 包裹 readdirSync 防 root 不可读抛错
  3. 若 `nonRoot.length >= 1`：`logger.warn('[module-derivation] 检测到 monorepo 结构（${resolvedRoot} 下存在非 root tsconfig：${nonRoot.join(', ')}）。module-derivation 使用 root-only tsconfig，batch 使用 per-file nearest tsconfig，子包 alias 可能漏解析。详见 F183 已知限制。')`
  - **不改动**：`logger`（L29-31）/`fs`（L19）已存在；`buildTsConfigContext` 调用逻辑不变
  - **不可行半**：.d.ts 零传播不加运行时检测，仅 plan.md「已知限制」节文档化
  **文件**：`src/knowledge-graph/module-derivation.ts`

### 修复 3 — 回归验证

- [x] T015 [P] 运行 `npx vitest run tests/unit/knowledge-graph/module-derivation-warn.test.ts`，确认新增测试全绿
  **文件**：`tests/unit/knowledge-graph/module-derivation-warn.test.ts`（验证）

**检查点**：修复 3 全绿 → 可继续

---

## Phase 5：修复 4 — CLI 帮助文本校正（[P] 可与修复 2/3 并行）

**目标**：校正 `cli/index.ts:99` 和 `batch.ts:73-74` 的 code-only 描述，移除「纯 AST」「< 30s」「无 LLM」「最快」等误导文案，改为诚实的定性表述。红线：不新增 `graph-only` 描述行（归 F195）。

**独立验证**：新增帮助文本断言测试全绿。

### 修复 4 — RED 阶段

- [x] T016 [P] 新建 `tests/unit/cli/helptext.test.ts`（或向现有 CLI 测试追加 describe 块）：
  - 断言 `cli/index.ts` 的 mode 帮助文本**不含**字符串 `无 LLM`
  - 断言 `cli/index.ts` 的 mode 帮助文本**不含**字符串 `< 30s`
  - 断言 `batch.ts` TTY hint **不含**字符串 `< 30s`
  - 确认测试 RED（当前文案含上述误导字符串）
  **文件**：`tests/unit/cli/helptext.test.ts`（新建）

### 修复 4 — GREEN 阶段

- [x] T017 [P] 修改 `src/cli/index.ts:99`（**Codex W-1：删未验证的「约 5min」，纯定性**）：
  - 当前：`code-only（纯 AST，< 30s，无 LLM，最快）`
  - 修改为：`code-only（仅跳 enrichment 层，仍逐模块调 spec-gen LLM，非零成本/非最快，耗时随模块数增长）`
  - **红线**：不新增 `graph-only` 描述行（归 F195）；**不写任何具体耗时数字**（评测仅支撑 ~27min 自用仓 / <30s 极端极小，无「中间值」证据）
  **文件**：`src/cli/index.ts`

- [x] T018 [P] 修改 `src/cli/commands/batch.ts:73-74`（**Codex W-1：删「< 30s」**）：
  - 当前：`如需最快分析（< 30s），请使用 --mode code-only`
  - 修改为：`如需进一步跳过 enrichment 层，可使用 --mode code-only（注：仍逐模块调 spec-gen LLM，非零成本）`
  - **红线**：不新增 `graph-only` 行（归 F195）；不写具体耗时数字
  **文件**：`src/cli/commands/batch.ts`

### 修复 4 — 回归验证

- [x] T019 [P] 运行 `npx vitest run tests/unit/cli/helptext.test.ts`，确认新增断言全绿
  **文件**：`tests/unit/cli/helptext.test.ts`（验证）

**检查点**：修复 4 全绿 → 可继续

---

## Phase 6：综合回归验证 + 护栏收口

**目的**：全量回归确认，并最终验证 F182 三护栏文件零改动（F183 fix 全程未碰这三个文件）。

### 必查现有测试

- [x] T020 运行 `npx vitest run tests/unit/graph/graph-builder-upsert.test.ts`，确认 upsert 逻辑零回归（不涉及写盘）
  **文件**：`tests/unit/graph/graph-builder-upsert.test.ts`（验证）

- [x] T021 运行 `npx vitest run tests/unit/graph/cross-worktree-byte.test.ts`（若存在），确认跨 worktree byte 一致、F193 portable 守卫零回归
  **文件**：`tests/unit/graph/cross-worktree-byte.test.ts`（验证，若存在）

- [x] T022 运行 F180 的 44 stdio E2E，确认 graph CLI 端到端零回归（`graph.ts` 调用签名不变）

### 全量验证

- [x] T023 运行 `npm run build`，确认 TypeScript 类型检查零错误（`options?: NormalizeGraphOptions` 可选参数 I-3 源码兼容）

- [x] T024 运行 `npx vitest run`，确认 4300+ 用例全绿（含新增 T-01/T-02/T-03/T-04 四组测试）

- [x] T025 运行 `npm run repo:check`，确认仓库健康检查 57 项全绿

### F182 护栏最终收口（关键）

- [x] T026 执行 `git diff HEAD -- src/batch/delta-regenerator.ts src/batch/regen-plan.ts src/batch/batch-orchestrator.ts`，确认输出为空。
  **这是 F183 的硬性红线：三护栏文件在整个 fix 过程中零改动。**
  **文件**：`src/batch/delta-regenerator.ts`、`src/batch/regen-plan.ts`、`src/batch/batch-orchestrator.ts`（只读验证）

**检查点**：所有验证全绿 + 护栏确认 → F183 fix 完成，可进入 commit

---

## 任务依赖关系

### Phase 依赖

```
Phase 1（护栏确认）
    ↓
Phase 2（修复 1，核心）── Phase 3（修复 2）[P]
                       ├── Phase 4（修复 3）[P]
                       └── Phase 5（修复 4）[P]
    修复 2/3/4 完成后 ──→ Phase 6（综合回归）
```

- **Phase 1 → Phase 2/3/4/5**：前置护栏确认后，四项修复可同时启动
- **修复 2、3、4 互不依赖**，可并行推进
- **修复 1 是核心**：`writeKnowledgeGraph` 签名变更（新增可选参数），其他修复不依赖此变更
- **Phase 6** 依赖所有修复完成

### 修复间并行机会

| 修复 | 涉及文件 | 是否互相依赖 |
|------|---------|------------|
| 修复 1 | `graph-builder.ts` + normalize 测试 | 独立 |
| 修复 2 | `import-resolver.ts` + warn 测试 | 独立 |
| 修复 3 | `module-derivation.ts` + warn 测试 | 独立 |
| 修复 4 | `cli/index.ts` + `batch.ts` + helptext 测试 | 独立 |

修复 2/3/4 三项在修复 1 Phase 2 启动后即可并行。

---

## FR 覆盖映射

| plan.md 修复项 | 关键任务 | 测试覆盖 |
|--------------|---------|---------|
| 修复 1（writeKnowledgeGraph 内聚） | T004 | T002（T-01）、T003（T-02）、T005、T006、T007、T008 |
| 修复 2（buildTsConfigContext warn） | T010 | T009（T-03）、T011、T012 |
| 修复 3（module-derivation monorepo warn） | T014 | T013、T015 |
| 修复 4（CLI 帮助文本校正） | T017、T018 | T016（T-04）、T019 |
| F182 护栏零改动 | T001（前置）、T026（收口）| — |
| plan.md T-01 跨写盘点形态一致 | T002 | T006 |
| plan.md T-02 batch epoch 保留 | T003 | T006 |
| plan.md T-03 tsconfig warn 限频 | T009、T010 | T011 |
| plan.md T-04 帮助文本不含「无 LLM」「< 30s」 | T016、T017、T018 | T019 |

---

## 执行摘要

**任务总数**：26 个（T001~T026）
**阶段**：6 个 Phase
**可并行任务**：修复 2/3/4 各自独立，标注 [P] 的任务 10 个
**护栏验证任务**：T001（前置确认）+ T026（最终收口），共 2 个，**均已包含**
**新增/修改测试**：T002/T003（T-01/T-02，追加到 graph-builder-normalize.test.ts）、T009（T-03，import-resolver-warn.test.ts 新建）、T013（module-derivation-warn.test.ts 新建）、T016（T-04，helptext.test.ts 新建）+ T005（graph-persistence.test.ts 现有测试修正）
