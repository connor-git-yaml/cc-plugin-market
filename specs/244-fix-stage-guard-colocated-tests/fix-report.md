# 问题修复报告 — F244 F220 stage 依赖矩阵守护对共置测试的结构性误报

## 问题描述

`tests/unit/batch/f220-export-surface.test.ts` 的 `listStageFilesRecursive` 把 `src/batch/stages/**/*.ts` 全量当作 stage 生产模块参与「未授权 stage 依赖边」判定。F243（specs/243-fix-mjs-graph-coverage）实施时实测：在 `src/batch/stages/` 下共置 `source-discovery.test.ts` 会被误判「未授权 stage 依赖边 source-discovery.test.ts→source-discovery.ts」，被迫把测试迁到 `tests/batch/source-discovery.test.ts` 规避。守护的设计目标是防生产 stage 间 ESM 环 / TDZ 风险，测试 import 被测模块不构成该风险。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 共置测试为何被判「未授权依赖边」？ | `listStageFilesRecursive`（f220-export-surface.test.ts:52-61）按 `endsWith('.ts')` 全收 stages/ 下文件，`*.test.ts` 与生产模块无差别进入依赖矩阵判定（:140-166） |
| Why 2 | 收集器为何全量收集？ | F220 建守护时（refactor-plan §G3）stages/ 下只有 5 个生产模块、无共置测试，收集器隐含假设「stages/ 目录内容 = 生产模块集合」 |
| Why 3 | 该假设为何有缺陷？ | 仓库测试规范（.claude/rules/tests.md）明确允许 `.test.ts` / `.spec.ts` 与被测文件同名共置；守护实现未与该规范对齐 |
| Why 4 | 假设为何在 F243 时破裂？ | F243 首次在 stages/ 共置 `source-discovery.test.ts`——测试 import 被测模块是标准模式，且 vitest 测试文件不进 `src` 生产 ESM 图，不可能构成 G3 要防的生产 ESM 环 / TDZ 风险 |
| Why 5 | 为何未被现有机制捕获？ | 守护自身没有「共置测试应放行」的回归用例；矩阵判定逻辑内联在 it 块里直接扫真实 stages/ 目录，无法用 fixture 做红/绿双向验证 |

**Root Cause**: G3 守护的文件收集器把「stages/ 目录下的 .ts 文件」等同于「stage 生产模块」，未排除测试文件，导致合同判定面大于其设计意图（生产 ESM 环防护）。
**Root Cause Chain**: 共置测试误红 → 收集器按 `.ts` 后缀全收 → 建守护时无共置测试、隐含"目录=生产集合"假设 → 仓库规范允许共置测试且测试 import 不构成 TDZ 风险 → 守护无 fixture 化红/绿回归用例，判定逻辑不可独立测试

**[ROOT CAUSE REACHED at Why 5]**

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| tests/unit/batch/f220-export-surface.test.ts | L52-61 `listStageFilesRecursive` | `.ts` 后缀全收，未排除 `*.test.ts`/`*.spec.ts` | 收窄为排除测试文件 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| 同文件 L100（导出面用例） | 把 stage 文件加入 ts-morph project 供 re-export 解析 | 安全（测试文件不被 facade re-export，加入仅冗余无误报），但收窄收集器后一并受益，无需单独处理 |

全仓 grep `listStageFilesRecursive` / `STAGES_DIR` 仅此一个文件命中；无其他守护复用该模式。

### 同步更新清单

- 调用方: 无（收集器为测试文件内私有函数，两处调用点均在同文件）
- 测试: 需新增红/绿双向回归用例（见修复策略）
- 文档: 无需更新
- 现存 `tests/batch/source-discovery.test.ts`（F243 规避迁移产物）: 保持原位不迁回——本修复只解除结构性限制，不强制迁移既有测试

## 修复策略

### 方案 A（推荐）

1. `listStageFilesRecursive` 内收窄：排除 `/\.(test|spec)\.(ts|mts)$/` 的文件——单点修复，两处调用点（导出面解析 + 依赖矩阵）同时受益。
2. 把依赖矩阵判定逻辑从 it 块内联提取为纯函数 `collectStageViolations(stageFiles, stagesDir, facadePath)`（仍在同测试文件内），使其可用 fixture 目录独立驱动。
3. 新增红/绿双向回归用例（基于 `mkdtemp` 临时 fixture 目录，不污染真实 stages/）：
   - **绿（放行侧）**: fixture stages 内 `a.ts` + 共置 `a.test.ts`（import `./a.js`）→ 零 violation，且文件收集结果不含 `a.test.ts`
   - **红（拦截侧）**: fixture stages 内生产模块 `a.ts` import `./b.js`（矩阵外边）→ violation 报出「未授权 stage 依赖边」；生产模块 import facade → violation 报出
4. 真实 stages/ 目录的矩阵用例保持不变（继续用收窄后的收集器扫真实目录）。

### 方案 B（备选）

只在依赖矩阵 it 块的调用侧过滤测试文件，不动 `listStageFilesRecursive` 本体。缺点：L100 导出面用例仍会把测试文件加进 ts-morph project（冗余解析），且未来新增调用点会重蹈覆辙；不推荐。

## Spec 影响

- 需要更新的 spec: 无需更新。F220 refactor-plan §G3/§4.2 表述的合同语义本就是「stages（生产模块）禁止 import facade + stage 间单向边」，本修复是让实现回归设计意图，非合同变更。

## Codex 对抗审查处置

**结论分档**：0 CRITICAL / 2 WARNING / 若干 INFO

- **W1（生产 ESM 图逃逸面）**：收窄收集器为共置测试放行 `*.test.ts`/`*.spec.ts` 后，只堵住了「测试文件本身被当作 stage 生产模块参与依赖矩阵判定」这一面；没有堵住反向路径——生产文件（facade 或 stage 生产模块）显式 `import` 一个测试命名文件，把它拖入生产 ESM 图与 dist 编译闭包。tsconfig 的 `exclude: src/**/*.test.ts` 只约束编译器自动发现的根文件，不阻止被生产代码 import 的文件进入编译闭包。
  → **已修**：新增合同纯函数 `collectTestNamedImportViolations`（覆盖相对 specifier 归一化后缀匹配 + 非相对 specifier 字面量后缀匹配两类判定），新增 F220 真实 stages/ 目录回归 it，并在 F244 describe 补红③（facade 经 `import './stages/evil.spec.js'` 反向拉测试图的 W1 绕过场景完整复刻）、红④（测试命名 specifier 解析落在 stages 目录外的第二盲区）两个 fixture 用例锁死行为。

- **W2（`.spec.ts` 豁免范围与注释表述）**：`COLOCATED_TEST_RE` 同时豁免 `.test.ts` 与 `.spec.ts`，但仓库当前 vitest include 实际执行的共置测试命名惯例以 `.test.ts` 为主，`.spec.ts` 豁免范围略超出当前实际执行面；此前注释也存在对"谁在消费该收集器"的表述过度声称。
  → **部分采纳**：保留双后缀豁免（理由：`.spec.ts` 是仓库测试命名惯例的合法变体之一，且其安全性已由 W1 新增的 `collectTestNamedImportViolations` 合同兜底，即便豁免范围略宽也不构成生产 ESM 图逃逸面）；修正头部与 `COLOCATED_TEST_RE` 注释表述使其准确指向该兜底合同；在既有「绿：共置测试」用例中补写 `.spec.ts` fixture 覆盖（断言收集器排除 `.spec.ts` 同时仍收 `.ts` 本体，防收集器整体空转假绿）。扩展 vitest include 使 `.spec.ts` 成为实际执行范围的建议判为范围外，不在本次处理。

- **INFO**：
  - 依赖矩阵判定逻辑提取纯函数（`collectStageViolations`）后逐行比对确认与原 it 块内联逻辑无语义漂移。
  - `resolved.startsWith(stagesDir)` 的路径前缀碰撞（如同级 `stages-other/` 会被当作 `stages/` 子目录）系 HEAD 预存实现，本次未扩大其判定面，风险记录留待后续处理（Codex 建议改 `path.relative` 边界判断）。
  - `.mts` 死分支（收集器前置条件已 `endsWith('.ts')`，故 `.mts` 变体在 `COLOCATED_TEST_RE` 分支不可达）已在收窄时一并处理并加注释说明，不构成遗留风险。

### Delta 轮（合同函数对抗审查）

**结论分档**：1 CRITICAL / 1 WARNING / 若干 INFO

- **CRITICAL（二跳桥接绕过共置测试豁免闭合 facade ESM 环）**：W1 修复堵住了「生产文件直接 import 测试命名文件」这一跳，但没堵住二跳桥接：`facade → ./bridge.js`（`bridge.ts` 位于 src/batch/ 等扫描集之外——既非 facade 也非 stages/ 生产模块，其出边从不被任何判定函数检查；若它在 stages/ 内则会被矩阵与 W1 合同双重拦截，绕过不成立）→ `bridge → ./stages/evil.spec.js`（`evil.spec.ts` 命中 `COLOCATED_TEST_RE`，被 `listStageFilesRecursive` 排除出扫描集，从未被任何判定函数处理）→ `evil.spec.ts → ../batch-orchestrator.js`（反向 import facade，构成 ESM 环，HEAD 时代 `listStageFilesRecursive` 未做共置测试豁免时会因这条边直接落入「非相对/相对 import facade」分支被拒，但 F244 收窄收集器后该文件整体退出扫描，边本身不再被任何函数看到）。
  → **已修**：不采用"全 src 扫描消灭盲区"的方案（成本随仓库规模线性增长且与 F244/F243 的收窄意图相悖），而是恢复一条与 HEAD 时代等价的独立检查——新增 `listColocatedTestFilesRecursive`（收集 stages/ 下共置测试文件）+ `collectColocatedTestFacadeViolations`（仅判定"共置测试是否 import facade"，**不**判定 stage→stage 边，因为后者正是 F243 要保留的合法用例：测试可以自由 import 被测 stage 模块）。新增 F220 真实 stages/ 目录回归 it（空转即绿）+ F244 红⑤ fixture（`evil.spec.ts` import facade 触发违规；同批 `clean.spec.ts` import `./a.js` 不触发，双向证明豁免面精确落在"禁 facade"而非"禁一切生产 import"）。拦截点与成本相当于 HEAD 时代的原始检查，只是与"生产文件禁测试命名 import"合同分离为独立函数，避免二者职责耦合导致后续修改任一侧误伤另一侧。

- **WARNING（resolveSpecifier 未归一化 query/hash 与 cjs/cts 后缀）**：`resolveSpecifier` 原实现仅剥离 `.js/.ts/.mjs/.mts` 后缀，未处理 `?query`/`#hash` 变体（如 `./b.spec.js?v=1` 解析后仍带 query 尾巴，无法命中 `resolvedTestSuffixRe`），也未覆盖 `.cjs/.cts` 后缀（如 `./c.spec.cjs` 解析后保留完整后缀，同样逃逸 `.test/.spec` 结尾匹配）。该盲区同时影响 `collectStageViolations`（矩阵边判定）与 `collectTestNamedImportViolations`（测试命名判定）两条消费链。
  → **已修**：`resolveSpecifier` 入口在 `startsWith('.')` 判断之后、`resolve()` 之前新增 `spec = spec.replace(/[?#].*$/, '')`，并将后缀剥离正则从 `(js|ts|mjs|mts)` 扩为 `(js|ts|mjs|mts|cjs|cts)`。新增 F244 红⑥ fixture（`./b.spec.js?v=1` 与 `./c.spec.cjs` 两种变体同时验证仍被 `collectTestNamedImportViolations` 命中）。该归一化对 `collectStageViolations` 消费同一函数亦生效，顺带闭合矩阵侧 HEAD 预存的同源盲区，无需单独改动矩阵判定逻辑。

- **INFO**：
  - 无后缀 specifier（如 `./b.spec`）、路径穿越拼写（`.././`）、`export * from` 均在既有用例（红①②/绿用例/facade star export 用例）覆盖确认，delta 轮未发现新遗漏。
  - 模板字符串动态 import（`` import(`./stages/${name}.js`) ``）不在 `collectModuleSpecifiers` 的 `StringLiteral` 分支识别范围内，属 HEAD 既有边界（`getArguments()[0]` 仅接受字符串字面量），delta 轮未扩大该边界，风险记录留待后续处理。
  - 真实 `src/batch/stages/` 含 5 个生产模块，矩阵 it 与「生产文件禁测试命名 import」it 均实际扫描真实文件并绿；当前 stages/ 下**共置测试子集为空**，故「共置测试禁 import facade」it 现阶段空转通过（由红⑤ fixture 用例保证判定力）。未发现大小写变体（`.Test.ts`）或软链路径导致 `listColocatedTestFilesRecursive`/`listStageFilesRecursive` 判定脱节的情况。
