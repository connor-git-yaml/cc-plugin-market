---
feature: 157
title: "修复 SC-008 self-dogfood graph 连通率：import-resolver 扩展"
branch: "157-fix-self-dogfood"
created: 2026-05-09
status: Closed-NotImplemented
closed_reason: "R-1 调研发现 self-dogfood sc008Rate 现状已 96%（≥ 70% 目标）；W1 在 T-001 ~ T-002 编排器手动等价完成（直接跑 verify-152.mjs），T-003 ~ T-027 全部 SKIPPED。本 tasks 清单保留作为未来同类 Feature 的参考。"
spec: ./spec.md
plan: ./plan.md
research: ./research.md
---

# Tasks: 修复 SC-008 self-dogfood graph 连通率

**特性分支**: `157-fix-self-dogfood`
**总任务数**: 27 个
**各批次任务数**: W1 = 5 个，W2a = 6 个，W2b = 3 个，W3 = 8 个，W4 = 5 个
**预估工作量**: 结论 A/C 时 3-4.5 天；结论 B 时 0.5-1 天（仅 W1）

---

## 摘要

本 Feature 通过五个批次串行推进，其中 W1 是独立可交付的调研阶段，W2-W4 依赖 W1 的 R-1 结论。所有任务围绕三个 User Story：US1（sc008Rate ≥ 70%）、US2（量化根因分布）、US3（无回归）。

**关键里程碑**：

| 里程碑 | 时间（估） | 产出 |
|--------|-----------|------|
| M1：R-1 调研完成 | 第 1 天末 | `research.md` + 结论 A/B/C |
| M2（GATE）：用户审查 R-1 输出 | M1 后 | 授权或停止 W2-W4 |
| M3：barrel 追踪实现 | 第 2-3 天 | `import-resolver.ts` 扩展完成 |
| M4：拆条逻辑实现 | 第 3 天 | `batch-orchestrator.ts` 拆条完成 |
| M5：单测覆盖 | 第 3-4 天 | ≥ 8 新增单测全部通过 |
| M6：全量验证 | 第 4-4.5 天 | sc008Rate ≥ 70/100 + 无回归 |

---

## Phase 1: W1 — R-1 调研脚本（独立可交付，必执行）

**目标**: 量化 68 条 false-negative 的三视角分布，产出结论 A/B/C，决定是否执行 W2-W4
**独立测试**: `node scripts/research-feature-157-r1.mjs --target ./src --out specs/157-fix-self-dogfood/research-r1-raw.json` 输出包含结论判定的 JSON 文件，不依赖任何 W2 代码
**对应 User Story**: US2（量化根因分布）

- [ ] T-001 [US2] 编写 R-1 调研脚本框架 + 一致性校验逻辑
  - **文件**: `scripts/research-feature-157-r1.mjs`（新建，~200 行）
  - **内容**: ESM 脚本骨架 + CLI 参数解析（`--target`、`--out`、`--compare-after`）+ 调用 `verify-feature-152.mjs` 拿聚合值 + 独立复刻 `measureSc008` 逻辑 + 一致性校验（两端聚合值不一致时 `[FATAL] exit 1`）
  - **预估 LOC**: +100 行
  - **完成判定**: `node scripts/research-feature-157-r1.mjs --target ./src` 运行后打印 `[CONSISTENCY CHECK] PASS` 或 `[FATAL]`，无 JS 运行时错误

- [ ] T-002 [US2] 实现视角 1（resolver 视角）分析逻辑
  - **文件**: `scripts/research-feature-157-r1.mjs`（修改 T-001 产出）
  - **内容**: 对每条 false-negative，提取 `ec.file` 对应 import 语句的 `moduleSpec`，调用 `resolveTsJsImport`，按分类规则归类为 `barrel-chain / path-alias-miss / type-only / dynamic-import / resolved-correctly`
  - **依赖**: T-001
  - **预估 LOC**: +50 行
  - **完成判定**: 脚本输出每条 false-negative 的 `resolverView` 字段，无 `undefined`

- [ ] T-003 [US2] 实现视角 2（graph-edge）+ 视角 3（verify-matcher）分析逻辑
  - **文件**: `scripts/research-feature-157-r1.mjs`（修改）
  - **内容**: 视角 2 — 在 `graphJson.links` 按 `(callerFile, callee)` 搜索 calls 边，分类 `calls-edge-emitted / calls-edge-missing / wrong-target`；视角 3 — 分析 target label / source basename 匹配情况，分类 `label-match-pass / label-mismatch / generator-registry-indirect / other`
  - **依赖**: T-002
  - **预估 LOC**: +60 行
  - **完成判定**: 脚本输出每条 false-negative 的 `graphEdgeView` + `verifyMatcherView` 字段

- [ ] T-004 [US2] 实现聚合统计 + 结论 A/B/C 自动判定 + `research.md` 输出
  - **文件**: `scripts/research-feature-157-r1.mjs`（修改）；`specs/157-fix-self-dogfood/research.md`（新建）
  - **内容**: 聚合各视角计数和占比 + 模拟"resolver 视角全修复后"可达 sc008Rate + 按修订后阈值表自动判定结论 A/B/C（结论 A：resolver 视角 ≥ 38 条 / sc008Rate 模拟可达 ≥ 70；结论 B：resolver 视角 < 56% 且模拟不可达；结论 C：resolver 视角 30-56% 且模拟可达 50-70）+ 输出 traceable YAML checklist + `--compare-after` 模式骨架（W4 时复用）
  - **依赖**: T-003
  - **预估 LOC**: +70 行（脚本）；`research.md` 由脚本运行后填充
  - **完成判定**: `node scripts/research-feature-157-r1.mjs --target ./src --out specs/157-fix-self-dogfood/research-r1-raw.json` 输出 JSON + `research.md` 包含明确的结论 A/B/C 标注

- [ ] T-005 [US2] GATE 检查点：运行 R-1 脚本 + 用户审查结论
  - **文件**: 不修改代码；`specs/157-fix-self-dogfood/research.md`（最终版）
  - **内容**: 运行完整调研脚本，整理输出至 `research.md`，包含：三视角 traceable checklist（每条 false-negative 含 `id + resolverView + graphEdgeView + verifyMatcherView + expectedFix + testAssertionId`）+ 各分类占比统计 + 模拟可达 sc008Rate + 结论判定（A/B/C）+ alias 实际使用次数（R-1-C）+ 建议实施路径
  - **依赖**: T-004
  - **预估 LOC**: N/A（人工整理 + 脚本输出）
  - **完成判定**: `research.md` 可独立阅读，结论明确；若结论 B → Feature 在此 commit，不执行 W2-W4；若结论 A 或 C → 用户授权后继续

> **GATE checkpoint**: 用户审查 T-005 输出的 `research.md` 后决定是否授权 W2-W4。结论 B → 停止，提交 `research.md` + scope-change decision commit（`[scope-change: no-impl]`）。结论 A/C → 继续。

---

## Phase 2: W2a — import-resolver.ts 扩展（条件：R-1 = 结论 A 或 C）

**目标**: 扩展 `src/knowledge-graph/import-resolver.ts` 支持 barrel 链多跳追踪
**独立测试**: 新增单测（W3 T-015 ~ T-020）可在 W2a 完成后独立验证核心函数
**对应 User Story**: US1（sc008Rate ≥ 70%）
**R-1 决策依赖**: 仅当 R-1 输出结论 A 或 C 时执行

- [ ] T-006 [P] [US1] 实现 `BarrelCache` 类型 + `parseBarrelExports` 函数
  - **文件**: `src/knowledge-graph/import-resolver.ts`（修改，当前 638 行）
  - **内容**: `type BarrelCache = Map<string, BarrelExports>`；`type BarrelExports = { namedExports: Map<string, { sourcePath: string; sourceName: string; isType: boolean }>; starExports: string[]; namespaceExports: Map<string, string> }`；`parseBarrelExports(absPath: string, cache: BarrelCache): BarrelExports` 函数 — 含注释剥离（`stripCommentsForRegex`）+ 正则匹配 4 种 re-export 形态（`export { X, Y as Z, type W }` / `export *` / `export * as ns` / `export type { X }`）+ 后处理（拆解 specifier：识别 `type` 前缀、`as alias`、`default as` 形态）+ cache 读写
  - **预估 LOC**: +80 行
  - **完成判定**: 单测 T-015（barrel 单跳）通过

- [ ] T-007 [P] [US1] 实现 `isExternalPackage` 辅助函数
  - **文件**: `src/knowledge-graph/import-resolver.ts`（修改）
  - **内容**: `isExternalPackage(moduleSpec: string): boolean` — 判断是否为 npm 包路径（不以 `./`、`../`、`/` 开头，且不是绝对路径；识别 scoped package `@xxx/yyy` 形态）
  - **预估 LOC**: +15 行
  - **完成判定**: 单测 T-019（external re-export 终止）通过

- [ ] T-008 [US1] 实现 `traceBarrelChain` 迭代算法
  - **文件**: `src/knowledge-graph/import-resolver.ts`（修改）
  - **依赖**: T-006, T-007
  - **内容**: `traceBarrelChain(barrelFile: string, exportName: string | null, projectRoot: string, cache: BarrelCache, visited: Set<string>, fanoutCounter: { count: number }): BarrelTraceResult` — 迭代算法（显式 worklist，不用递归）+ visited Set 循环检测（`barrelFile ∈ visited → return { kind: 'unresolved', reason: 'cycle' }`）+ 深度上限 10（`visited.size ≥ 10 → return { kind: 'unresolved', reason: 'depth-limit' }`）+ fan-out 上限 50（`fanoutCounter.count ≥ 50 → return { kind: 'unresolved', reason: 'fanout-limit' }`）+ 优先 namedExports 查找 → 次 starExports 遍历 + external 包终止返回 `{ kind: 'external', pkg }` + 最终 `{ kind: 'resolved', absPath, depth, visitedCount }` 或 `{ kind: 'unresolved', reason: 'not-found' }`
  - **预估 LOC**: +70 行
  - **完成判定**: 单测 T-016（多跳命中）+ T-017（循环检测）通过

- [ ] T-009 [US1] 修改 `resolveTsJsImport` 签名：新增第 5/6 可选参数
  - **文件**: `src/knowledge-graph/import-resolver.ts`（修改）
  - **依赖**: T-008
  - **内容**: 在 `resolveTsJsImport(moduleSpec, callerFile, projectRoot, tsConfigContext?)` 签名后追加 `importedName?: string | null` + `barrelCache?: BarrelCache`；不传时行为与原签名完全一致（向后兼容）；更新函数签名上方的 JSDoc 注释
  - **预估 LOC**: +5 行（签名修改 + JSDoc）
  - **完成判定**: `npm run build` 零类型错误；现有调用方（`batch-orchestrator.ts` 等）不传新参数时编译通过

- [ ] T-010 [US1] 在 `resolveTsJsImport` 各解析分支接入 barrel 追踪逻辑
  - **文件**: `src/knowledge-graph/import-resolver.ts`（修改）
  - **依赖**: T-009
  - **内容**: 两个分支各接入 barrel 追踪：(1) alias 分支 — `matchPathsPattern` 命中 → 解析出 resolvedPath → 若 resolvedPath 是 barrel index（`isBarrelFile` 判断 + `importedName` 不为空）→ 调 `traceBarrelChain`，命中则更新 resolvedPath；(2) 相对路径分支 — 解析出 resolvedPath 是 barrel index 且 `importedName` 不为空 → 同上；两分支均在 barrel 追踪结果为 `kind: 'external'` 时返回 `{ resolvedPath: null, kind: 'external' }`；debug 字段 `_via?: 'direct' | 'barrel-chain'` 在 `process.env.IMPORT_RESOLVER_DEBUG=1` 时填充
  - **预估 LOC**: +40 行
  - **完成判定**: 单测 T-018（alias + barrel 串联）通过；`process.env.IMPORT_RESOLVER_DEBUG=1` 时 resolve 结果含 `_via` 字段

- [ ] T-011 [P] [US1] 实现 `isBarrelFile` 启发式判断辅助函数
  - **文件**: `src/knowledge-graph/import-resolver.ts`（修改）
  - **内容**: `isBarrelFile(absPath: string): boolean` — 基于文件名（是否为 `index.ts` / `index.js` / `index.tsx`）的快速判断；注释说明：barrel 判断目前仅基于文件名约定，不做内容扫描（性能考量）
  - **预估 LOC**: +10 行
  - **完成判定**: 对 `src/panoramic/index.ts` 返回 `true`，对 `src/core/resolver.ts` 返回 `false`

---

## Phase 3: W2b — batch-orchestrator.ts 拆条逻辑（条件：R-1 = 结论 A 或 C）

**目标**: 修改 `collectTsJsCodeSkeletons` 按 namedImports 拆条，使 barrel symbol 级追踪得以工作
**独立测试**: 现有 `tests/unit/batch-orchestrator-tsjs-resolve.test.ts` 调整断言后可独立验证
**对应 User Story**: US1（sc008Rate ≥ 70%）
**R-1 决策依赖**: 仅当 R-1 输出结论 A 或 C 时执行
**依赖**: W2a 全部完成（T-006 ~ T-011）

- [ ] T-012 [US1] 修改 `collectTsJsCodeSkeletons` import 拆条逻辑
  - **文件**: `src/batch/batch-orchestrator.ts`（修改，仅 L2200-2205 区域的 `collectTsJsCodeSkeletons` 函数内）
  - **内容**: 对每条 `import { A, B, C } from './x'`，按 namedImports 拆为独立条目：`[{ moduleSpecifier: './x', namedImports: ['A'], resolvedPath: ? }, { moduleSpecifier: './x', namedImports: ['B'], resolvedPath: ? }, ...]`；每条调用 `resolveTsJsImport(spec, file, root, ctx, singleNamedImport)` 传入单个 namedImport 的 source name（去掉 `as alias` 后的原名）；数据 schema 不变（`ImportReference` 结构保持，仅 namedImports 由多元素数组变为单元素数组）
  - **依赖**: T-009（新签名就位）
  - **预估 LOC**: +30 行（拆条逻辑），-5 行（原始代码替换）
  - **完成判定**: 对 `import { A, B } from './index'` 的调用，输出 2 条独立 import 记录，每条 `namedImports.length === 1`

- [ ] T-013 [US1] 创建 batch 作用域 `BarrelCache` 实例并传递给 resolveTsJsImport
  - **文件**: `src/batch/batch-orchestrator.ts`（修改，`collectTsJsCodeSkeletons` 入口处）
  - **内容**: 在 `collectTsJsCodeSkeletons` 函数顶部创建 `const barrelCache: BarrelCache = new Map()`；调用 `resolveTsJsImport` 时传入第 6 参数 `barrelCache`；cache 生命周期与单次 batch 调用一致（函数返回后自然 GC）
  - **依赖**: T-012
  - **预估 LOC**: +5 行
  - **完成判定**: `BarrelCache` 类型可从 `import-resolver.ts` 导入（需在 T-006 中导出）；同一 batch 中多次引用同一 barrel index 文件时，`parseBarrelExports` 仅调用一次（cache 命中）

- [ ] T-014 [US1] 调整 `batch-orchestrator-tsjs-resolve` 现有 4 个单测断言
  - **文件**: `tests/unit/batch-orchestrator-tsjs-resolve.test.ts`（修改）
  - **内容**: 更新现有 4 个单测的断言，适配 namedImports 拆条后的新形态（import 记录数从 N 变为 N×K）；确保所有原有测试场景的语义不变（仅断言形式改变，逻辑等价）
  - **依赖**: T-012, T-013
  - **预估 LOC**: +10 行修改（断言更新）
  - **完成判定**: `npx vitest run tests/unit/batch-orchestrator-tsjs-resolve.test.ts` 所有原有用例通过

---

## Phase 4: W3 — 单测扩展（条件：R-1 = 结论 A 或 C）

**目标**: 新增 ≥ 8 个单测覆盖 barrel 追踪和拆条场景，满足 FR-007 和 SC-4
**独立测试**: `npx vitest run tests/unit/knowledge-graph/import-resolver.test.ts` 零失败
**对应 User Story**: US1 + US3
**R-1 决策依赖**: 仅当 R-1 输出结论 A 或 C 时执行
**注意**: T-015 ~ T-020 在 W2a 完成后即可开始（并行于 W2b）

- [ ] T-015 [P] [US1] 单测：barrel 单跳命中（T-barrel-001）
  - **文件**: `tests/unit/knowledge-graph/import-resolver.test.ts`（修改）
  - **内容**: mock `fs.readFileSync` 返回含 `export { TypeScriptMapper } from './typescript-mapper'` 的 barrel 内容；调用 `resolveTsJsImport('./index', callerFile, root, null, 'TypeScriptMapper')`；断言 `resolvedPath` 指向 `typescript-mapper.ts` 而非 `index.ts`
  - **依赖**: T-010（barrel 追踪逻辑接入完成）
  - **预估 LOC**: +20 行
  - **完成判定**: 测试通过

- [ ] T-016 [P] [US1] 单测：barrel 多跳命中（T-barrel-002）
  - **文件**: `tests/unit/knowledge-graph/import-resolver.test.ts`（修改）
  - **内容**: 构造 2 层 barrel 链：`a/index.ts` re-export from `b/index.ts`，`b/index.ts` re-export `Foo` from `./foo.ts`；调用 `resolveTsJsImport('./a/index', callerFile, root, null, 'Foo')`；断言最终 `resolvedPath` 指向 `a/b/foo.ts`，`_via === 'barrel-chain'`（需开启 `IMPORT_RESOLVER_DEBUG=1`）
  - **依赖**: T-010
  - **预估 LOC**: +25 行
  - **完成判定**: 测试通过

- [ ] T-017 [P] [US1] 单测：barrel 循环检测防护（T-barrel-003）
  - **文件**: `tests/unit/knowledge-graph/import-resolver.test.ts`（修改）
  - **内容**: 构造循环 barrel：`a/index.ts` re-export from `b/index.ts`，`b/index.ts` re-export from `a/index.ts`；调用 `resolveTsJsImport('./a/index', callerFile, root, null, 'Foo')`；断言返回 `{ resolvedPath: null, kind: 'unresolved' }`，且不超时/不抛异常
  - **依赖**: T-008（循环检测逻辑）
  - **预估 LOC**: +20 行
  - **完成判定**: 测试通过，执行时间 < 100ms

- [ ] T-018 [P] [US1] 单测：alias + barrel 串联（T-barrel-004）
  - **文件**: `tests/unit/knowledge-graph/import-resolver.test.ts`（修改）
  - **内容**: 构造 tsConfigContext 含 `paths: { '@core/*': ['src/core/*'] }`；mock `src/core/mappers/index.ts` 含 `export { TypeScriptMapper } from './typescript-mapper'`；调用 `resolveTsJsImport('@core/mappers', callerFile, root, ctx, 'TypeScriptMapper')`；断言 `resolvedPath` 指向 `src/core/mappers/typescript-mapper.ts`，`kind === 'paths-alias'`
  - **依赖**: T-010
  - **预Estimated LOC**: +25 行
  - **完成判定**: 测试通过

- [ ] T-019 [P] [US1] 单测：external re-export 终止（T-barrel-005）
  - **文件**: `tests/unit/knowledge-graph/import-resolver.test.ts`（修改）
  - **内容**: mock barrel 文件含 `export { jsonStringify } from 'safe-stable-stringify'`；调用 `resolveTsJsImport('./barrel', callerFile, root, null, 'jsonStringify')`；断言返回 `{ resolvedPath: null, kind: 'external' }`，不进入 node_modules
  - **依赖**: T-007, T-010
  - **预估 LOC**: +15 行
  - **完成判定**: 测试通过

- [ ] T-020 [P] [US1] 单测：alias 未命中降级 + `export *` vs `export { X }` 命名冲突（T-barrel-006 + T-barrel-007）
  - **文件**: `tests/unit/knowledge-graph/import-resolver.test.ts`（修改）
  - **内容**: 两个测试用例 — (1) `@nonexistent/foo` 无对应 tsconfig paths 条目 → `{ resolvedPath: null, kind: 'unresolved' }`；(2) barrel 文件同时含 `export * from './a'` 和 `export { Foo } from './b'`，模拟 `a/index.ts` 也导出 `Foo`，断言命名 re-export 优先（resolvedPath → `b/foo.ts`）
  - **依赖**: T-010
  - **预估 LOC**: +25 行
  - **完成判定**: 两个测试用例均通过

- [ ] T-021 [P] [US1] 单测：R-1 checklist 具体 false-negative 回归测试（T-barrel-008）
  - **文件**: `tests/unit/knowledge-graph/import-resolver.test.ts`（修改）
  - **内容**: 从 R-1-A checklist（`research.md`）中选取 1 条具体 false-negative（如 `fn-001`），按其 `file`、`callee`、`resolverView` 构造 mock，断言修复后 `resolvedPath` 不再为 null；测试 ID 对应 `testAssertionId: T-barrel-008`
  - **依赖**: T-005（R-1 checklist 确定后），T-010
  - **预估 LOC**: +20 行
  - **完成判定**: 测试通过，且对应的 false-negative 条目 `resolverView` 不再为 `barrel-chain`

- [ ] T-022 [US3] 新增 2 个 batch-orchestrator 拆条单测 + 调整现有断言说明
  - **文件**: `tests/unit/batch-orchestrator-tsjs-resolve.test.ts`（修改）
  - **内容**: 新增 2 个测试用例 — (1) `import { A, B } from './barrel'` 拆条后输出 2 条 import 记录，每条 `namedImports.length === 1`；(2) 同一 batch 中两次引用同一 barrel index，barrelCache 命中（通过 spy 断言 `parseBarrelExports` 仅调用 1 次）
  - **依赖**: T-013, T-014
  - **预估 LOC**: +30 行
  - **完成判定**: 2 个新增用例通过；`npx vitest run tests/unit/batch-orchestrator-tsjs-resolve.test.ts` 全部 6 个用例通过

---

## Phase 5: W4 — 全量验证 + SC-6 归因（条件：R-1 = 结论 A 或 C）

**目标**: 验证所有 Success Criteria 达标，输出 SC-6 before/after 归因表
**独立测试**: 验证命令序列可独立执行，不依赖额外代码修改
**对应 User Story**: US1 + US3
**R-1 决策依赖**: 仅当 R-1 输出结论 A 或 C 时执行
**依赖**: W2a + W2b + W3 全部完成

- [ ] T-023 [US3] 编排器独立验证：TypeScript 类型检查 + 全量单测
  - **文件**: 不修改代码
  - **命令**:
    ```bash
    npm run build
    npx vitest run
    ```
  - **期望输出**: `npm run build` 零类型错误；`npx vitest run` ≥ 3459 条（原有 3459 + 新增 8 条 = ≥ 3467 条）零失败
  - **完成判定**: 两命令均以 exit code 0 退出

- [ ] T-024 [US1] 验证 self-dogfood SC-008 主指标（期望 ≥ 70/100）
  - **文件**: 不修改代码
  - **命令**:
    ```bash
    node scripts/verify-feature-152.mjs --target ./src --metric sc008
    ```
  - **期望输出**: `sc008Rate >= 0.70`（≥ 70 hits / 100 truth-set 条目）
  - **失败处理**:
    - sc008Rate ∈ [50%, 70%)：进入二级裁定路径（R-1 数据若证明 70% 需改 scope 外组件 → 以实测值合并，差距记入 follow-up Feature）
    - sc008Rate < 50%：**不可合并**，必须回到 R-1 重新分析
  - **完成判定**: `sc008Rate >= 0.70` 或满足二级裁定条件（用户明确授权合并）

- [ ] T-025 [P] [US3] 验证 hono sc008Rate 无回归（期望 = 100%）
  - **文件**: 不修改代码
  - **命令**:
    ```bash
    node scripts/verify-feature-152.mjs --target ~/.spectra-baselines/hono/src --metric sc008
    ```
  - **期望输出**: `sc008Rate === 1.0`（841/841，不低于 Feature 152 ship 数字）
  - **完成判定**: sc008Rate = 100%；任何退步均需定向 revert barrel 追踪实现并重测

- [ ] T-026 [US3] 全量 SC 指标复核（SC-001/002/003/006 双 target 不倒退）
  - **文件**: 不修改代码
  - **命令**:
    ```bash
    node scripts/verify-feature-152.mjs --target ./src
    node scripts/verify-feature-152.mjs --target ~/.spectra-baselines/hono/src
    ```
  - **期望输出**:
    - SC-001 fillRate: self-dogfood 100% / hono 100%
    - SC-002 precision: self-dogfood ≥ 91.8% / hono ≥ 96.7%；recall: self-dogfood ≥ 80.1% / hono ≥ 72.4%
    - SC-003 python resolution: 双 target 均 100%
    - SC-006 deltaMs: ≤ 5000ms（双 target）
  - **完成判定**: 所有指标不低于 Feature 152 ship 数字

- [ ] T-027 [US1] R-1 脚本 `--compare-after` 模式：生成 SC-6 归因表
  - **文件**: `scripts/research-feature-157-r1.mjs`（复用 T-004 骨架，激活 `--compare-after` 模式）；`specs/157-fix-self-dogfood/research.md`（更新）
  - **命令**:
    ```bash
    node scripts/research-feature-157-r1.mjs --target ./src --compare-after --out specs/157-fix-self-dogfood/research-r1-after.json
    ```
  - **内容**: 重跑三视角分析，对比 before/after 的 resolver 视角变化，输出 SC-6 before/after 对比表：每个新增 hit（共 ≥ 38 条）标注 `resolver-change`（barrel 链新通 / alias 新通）或 `unexpected`（理论上应为 0 条）；对应 FR 编号
  - **依赖**: T-024, T-025, T-026（验证通过后跑归因）
  - **完成判定**: 输出含 before（32/100）→ after（≥ 70/100）对比表；`unexpected` 计数 = 0；所有新增 hit 可追溯到 `resolver-change`

---

## FR 覆盖映射表

| FR | 描述 | 覆盖任务 |
|----|------|---------|
| FR-001 | alias + barrel 串联解析（SHOULD，W-5 降级） | T-010, T-018 |
| FR-002 | R-1 调研驱动的修复范围 | T-001 ~ T-005（R-1 三视角分析）|
| FR-003 | barrel re-export 多跳追踪（深度 ≤ 10，fan-out ≤ 50，循环检测） | T-006, T-008, T-010, T-015, T-016, T-017 |
| FR-004 | type-only import 容错（MAY，YAGNI-待调研） | T-006（`parseBarrelExports` 记录 `isType` 字段，不中止追踪）|
| FR-005 | 动态 import 容错（MAY，YAGNI-待调研） | T-006（`parseBarrelExports` 跳过 `import(...)` 语句）|
| FR-006 | 纯函数约束 + 零新依赖 | T-006 ~ T-011（仅 `fs`/`path`，无新 npm 依赖）|
| FR-007 | 新增 ≥ 6 单测，覆盖 8 等价类 | T-015 ~ T-022（8 个单测用例）|
| FR-008 | scope 限定 + 必要例外（batch-orchestrator 拆条） | T-012, T-013（仅改 `collectTsJsCodeSkeletons`）|

---

## 任务依赖图

```
W1（串行）:
T-001 → T-002 → T-003 → T-004 → T-005（GATE）

                            ↓（结论 A 或 C）

W2a（T-006/T-007 并行，T-008 串行，T-009 → T-010 → T-011 并行）:
T-006 ─┬─→ T-008 → T-009 → T-010
T-007 ─┘                     ↓
                          T-011 [P]

W2b（串行，依赖 W2a）:
T-010 → T-012 → T-013 → T-014

W3（高度并行，依赖 W2a，T-021 依赖 T-005）:
T-010 →┌→ T-015 [P]
       ├→ T-016 [P]
       ├→ T-017 [P]
       ├→ T-018 [P]
       ├→ T-019 [P]
       ├→ T-020 [P]
T-005 + T-010 → T-021 [P]
T-013 + T-014 → T-022

W4（T-024/T-025 并行，T-027 依赖 T-024/T-025/T-026）:
W2a+W2b+W3 完成 → T-023 → T-024 [P]
                          → T-025 [P]
                          → T-026
                    T-024 + T-025 + T-026 → T-027
```

**Phase 间依赖**:
- W1 → GATE(T-005) → W2a（阻塞）
- W2a → W2b（阻塞）
- W2a → W3（T-015 ~ T-020 可在 W2b 并行进行）
- W2a + W2b + W3 → W4（阻塞）

**结论 B 路径**:
T-001 → T-002 → T-003 → T-004 → T-005 → **停止**，提交 `research.md` + scope-change decision commit

---

## 验证命令清单（W4 完整序列）

```bash
# 步骤 1：TypeScript 类型检查（T-023）
npm run build
# 期望：零类型错误，exit 0

# 步骤 2：全量单测（T-023）
npx vitest run
# 期望：≥ 3467 条通过，零失败，exit 0

# 步骤 3：self-dogfood SC-008 主指标（T-024）
node scripts/verify-feature-152.mjs --target ./src --metric sc008
# 期望：sc008Rate >= 0.70（≥ 70/100）

# 步骤 4：hono sc008Rate 无回归（T-025，可与步骤 3 并行）
node scripts/verify-feature-152.mjs --target ~/.spectra-baselines/hono/src --metric sc008
# 期望：sc008Rate = 1.0（100%）

# 步骤 5：全量 SC 指标复核（T-026）
node scripts/verify-feature-152.mjs --target ./src
node scripts/verify-feature-152.mjs --target ~/.spectra-baselines/hono/src
# 期望：SC-001/002/003/006 双 target 不低于 Feature 152 ship 数字

# 步骤 6：SC-6 归因表（T-027）
node scripts/research-feature-157-r1.mjs --target ./src --compare-after --out specs/157-fix-self-dogfood/research-r1-after.json
# 期望：before(32) → after(≥70) 对比表，unexpected=0
```

---

## 失败/回退路径

| 场景 | 触发条件 | 处理方式 |
|------|---------|---------|
| R-1 结论 B | resolver 视角占比 < 56% 且模拟可达 sc008Rate < 70 | T-005 后停止；提交 `research.md` + scope-change decision；标注 `[scope-change: no-impl]`；跳过 T-006 ~ T-027 |
| sc008Rate < 50%（W4 后） | T-024 实测 < 0.50 | **不可合并**；回到 R-1（T-001 重新运行），重新分析根因 |
| sc008Rate ∈ [50%, 70%)（W4 后） | T-024 实测 0.50 ≤ x < 0.70 | 二级裁定：R-1 数据若证明 70% 需改 scope 外组件 → 以实测值合并，差距记入 follow-up Feature；需用户明确授权 |
| hono sc008Rate 退步 | T-025 实测 < 100% | 定向 revert barrel 追踪 `traceBarrelChain` 实现（保留 T-001 ~ T-005 和 T-012 ~ T-013 commit），重新分析 |
| SC-006 deltaMs 超标 | T-026 实测 > 5000ms | 降低 barrel 深度上限（10 → 5）或 fan-out 上限（50 → 20），重测 T-026 |
| TypeScript 编译错误 | T-023 `npm run build` 非零退出 | 修复类型错误（通常是 `BarrelCache` 导出或第 5/6 参数类型），重跑 T-023 |

---

## 实施策略建议

**结论 A/C（推荐 Incremental Delivery 策略）**:

1. 完成 W1（T-001 ~ T-005）→ 获取 R-1 数据，独立可 commit
2. 完成 W2a（T-006 ~ T-011）→ barrel 追踪核心逻辑就位，配合 W3 T-015 ~ T-020 单测验证
3. 完成 W2b（T-012 ~ T-014）+ W3 T-022 →拆条逻辑就位
4. 完成 W4（T-023 ~ T-027）→ 全量验证通过，SC-6 归因完整

**结论 B（MVP = W1 Only）**:

1. 完成 W1（T-001 ~ T-005）→ commit `research.md` + scope-change decision，Feature 结束

**并行机会（多人团队）**:

- W3 T-015 ~ T-020 在 W2a 完成后可与 W2b 并行（不同文件，无依赖）
- W4 T-024 与 T-025 可并行（不同 target，无依赖）
