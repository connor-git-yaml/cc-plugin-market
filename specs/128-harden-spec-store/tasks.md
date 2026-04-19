# 任务清单：Feature 128 — Harden SpecStore Abstraction & Source-Kind Metadata & Dev Hot Reload

**Branch**: `128-harden-spec-store` | **生成日期**: 2026-04-19 | **基于**: plan.md（532 行）

---

## 概览

| Step | 目标 | 前置依赖 | 可并行 | Task 数 |
|---|---|---|---|---|
| **A** | 建立 SpecStore 类 + 完整单测 | 无 | 否 | 9 |
| **B** | README 生成器迁移 | Step A | 否 | 7 |
| **C** | Graph Builder 迁移 | Step B | 否 | 8 |
| **D** | Coverage Auditor 迁移 | Step C | 否 | 6 |
| **E** | Index Generator 迁移 | Step D | 否 | 6 |
| **F** | Cross-Reference Builder 迁移 | Step E | 否 | 6 |
| **G** | 删除旧合并逻辑 | Step F | 否 | 5 |
| **H** | 开启 sourceKind 过滤 + 移除 Fix 128 workaround + 完整回归 | Step G | 否 | 11 |
| **Dev Addon** | Dev 模式热重载（FR-010/011/013/014） | 独立（可在 A 完成后启动） | [P] | 7 |
| **I** | Direction Audit 自查工具（FR-015/016/017） | 独立（可在 A 完成后启动） | [P] | 8 |
| **Z** | 最终收尾：rebase + push | 所有 Step 完成 | 否 | 1 |

**并行说明**：Step A-H 严格串行（每步后做完整回归，出问题时可精准 revert）。Dev Addon 和 Step I 相互独立，可与 A-H 并行推进，但最终 rebase 前必须全部合入。

---

## Step A：建立 SpecStore 类 + 完整单测

**目标**：在 `src/spec-store/` 建立统一查询入口，提取并泛化 `batch-orchestrator.ts` 的 `mergeIndexSpecs` 逻辑，为后续 B-F 迁移打基础。

- [ ] A.1 创建目录结构骨架：新建 `src/spec-store/` 目录，创建文件 `src/spec-store/index.ts`（空导出占位）、`src/spec-store/spec-identity.ts`（空导出占位）
  - **验证**：`npm run build` 无新增 TypeScript 错误

- [ ] A.2 在 `src/spec-store/spec-identity.ts` 实现 `SpecSourceKind` 类型枚举（`'canonical' | 'derived' | 'bundle_copy'`）和 `getDefaultSourceKind()` 辅助函数（缺失字段时返回 `'canonical'`）
  - **参考**：`specs/128-harden-spec-store/contracts/source-kind-schema.ts` 的类型定义
  - **验证**：类型定义与合同文件对齐

- [ ] A.3 在 `src/spec-store/index.ts` 实现 `SpecStore` 类构造函数（`SpecStoreOptions` 参数），将 `batch-orchestrator.ts` 第 912-966 行的 `mergeIndexSpecs` 核心逻辑迁移到构造函数中，构建 `mergedMap: Map<string, IndexableModuleSpec>`，保留 `skeletonHash` 存在性检查
  - **参考**：`specs/128-harden-spec-store/contracts/spec-store-interface.ts` 的 `ISpecStore` 接口
  - **验证**：类型检查通过，`mergedMap` 包含正确的去重逻辑

- [ ] A.4 在 `src/spec-store/index.ts` 实现 orphan 检测逻辑：构造时对所有 `storedSpecs` 做 `fs.existsSync(path.join(projectRoot, spec.sourceTarget))` 判断，将 orphan 的 `outputPath` 加入 `orphans: Set<string>`；仅对 `sourceKind === 'canonical'`（或字段缺失）的 spec 做判断
  - **验证**：orphan 集合在构造时正确填充

- [ ] A.5 在 `src/spec-store/index.ts` 实现 4 种查询视图方法：`allKnownSpecs()`（排除 orphan + 排除非 canonical）、`currentRunSpecs()`、`storedOnlySpecs()`、`orphanSpecs()`，以及辅助方法 `asDocGraphInput()` 和 `totalKnownCount()`
  - **参考**：`specs/128-harden-spec-store/data-model.md` 第 1 节方法签名
  - **验证**：`asDocGraphInput()` 返回类型与 `buildDocGraph` 调用签名精确对应

- [ ] A.6 新建 `tests/spec-store/spec-store.test.ts`，覆盖以下场景（最少 15 个 test case）：
  - orphan 识别（storedSpec 的 sourceTarget 不存在时出现在 `orphanSpecs()`）
  - 空集合（currentSpecs=[], storedSpecs=[] 时 `allKnownSpecs()` 返回 []，不报错）
  - 身份过滤（`sourceKind: 'bundle_copy'` 的 spec 不出现在 `allKnownSpecs()`）
  - 本次生成优先（同一 outputPath 在 currentSpecs 和 storedSpecs 都有时，以 currentSpec 为准）
  - 去重逻辑（`allKnownSpecs()` 对同一 outputPath 只返回一条）
  - 全量场景（force batch）：5 个 spec，`totalKnownCount() === 5`
  - 增量场景（只生成 1 个）：`allKnownSpecs().length === 5`（1 新 + 4 缓存）
  - AST-only 场景：`allKnownSpecs()` 结果与全量一致

- [ ] A.7 新建 `tests/spec-store/spec-identity.test.ts`，覆盖：sourceKind 缺失时 `getDefaultSourceKind()` 返回 `'canonical'`；`derivedFrom` 缺失时行为正确
  - **验证**：`npx vitest run tests/spec-store/` 全绿

- [ ] A.8 运行验证门禁：
  ```bash
  npx vitest run tests/spec-store/
  npx vitest run
  npm run build
  ```
  确认新增测试全绿，无新增失败（pre-existing `export-command.test.ts` 除外）

- [ ] A.9 提交并推送：
  ```bash
  git add src/spec-store/ tests/spec-store/
  git commit -m "feat(128): add SpecStore abstraction + unit tests"
  git push origin 128-harden-spec-store
  ```

---

## Step B：README 生成器迁移

**目标**：将 `batch-readme-generator.ts` 的 spec 来源从手动计算的 `allIndexSpecs` 切换为 `specStore.allKnownSpecs()`，消除第一个消费方的手动合并逻辑。

- [ ] B.1 阅读 `src/batch/batch-orchestrator.ts`，定位：`mergeIndexSpecs` 调用点（约第 912 行）、`allIndexSpecs` 变量定义、步骤 7 传入 `generateBatchReadme` 的 `moduleSpecs` 字段赋值（约第 818-830 行）
  - **验证**：理清 `allIndexSpecs` 和 `modulesDirRel` 前缀过滤的完整调用链

- [ ] B.2 在 `src/batch/batch-orchestrator.ts` 步骤 5 位置（原 `mergeIndexSpecs` 调用处）初始化 `SpecStore`：
  ```typescript
  import { SpecStore } from '../spec-store/index.js';
  const specStore = new SpecStore({
    currentSpecs: collectedModuleSpecs,
    storedSpecs: existingStoredSpecs,
    projectRoot: resolvedRoot,
    toProjectPath,
  });
  ```
  **此时保留 `allIndexSpecs` 变量**（其他消费方还未迁移），同时在 SpecStore 构建后赋值 `allIndexSpecs = specStore.allKnownSpecs()`

- [ ] B.3 修改 `src/batch/batch-orchestrator.ts` 步骤 7：将传入 `generateBatchReadme` 的 `moduleSpecs` 从手动过滤的 `allIndexSpecs` 改为 `specStore.allKnownSpecs()`；删除原来步骤 7 中多余的 `modulesDirRel` 前缀过滤代码（该逻辑移入 SpecStore.allKnownSpecs 内部）
  - **注意**：`modulesDirRel` 前缀过滤若在 allKnownSpecs 内部无法处理，可作为参数传入（确认后决策）

- [ ] B.4 检查 `src/batch/batch-readme-generator.ts`：确认 `ReadmeGeneratorInput.moduleSpecs` 的类型与 `IndexableModuleSpec[]` 兼容；如有类型不匹配则在此文件做最小调整
  - **验证**：`npm run build` 零 TypeScript 错误

- [ ] B.5 运行验证门禁：
  ```bash
  npx vitest run tests/integration/batch-singlelang.test.ts
  npx vitest run tests/golden-master/golden-master.test.ts
  npx vitest run
  npm run build
  ```

- [ ] B.6 确认 SC-001 部分覆盖（README 消费方）：手动或通过测试验证"全量/增量/无改动/AST-only 4 场景下 README footer 模块计数一致"

- [ ] B.7 提交并推送：
  ```bash
  git add src/batch/batch-orchestrator.ts src/batch/batch-readme-generator.ts
  git commit -m "refactor(128): migrate batch-readme-generator to SpecStore"
  git push origin 128-harden-spec-store
  ```

---

## Step C：Graph Builder 迁移

**目标**：将 `buildDocGraph` 的调用点从直接传 `collectedModuleSpecs + existingStoredSpecs` 改为通过 `specStore.asDocGraphInput()` 提供，同时适配独立运行的 `graph.ts` 命令。

- [ ] C.1 阅读 `src/batch/batch-orchestrator.ts` 中 `buildDocGraph` 调用点（约第 643 行），理解两个原始参数 `collectedModuleSpecs` 和 `existingStoredSpecs` 的传递方式；阅读 `src/cli/commands/graph.ts`（187 行），理解独立运行时的 `scanStoredModuleSpecs` 调用链
  - **验证**：理解 `buildDocGraph` 内部如何区分 `currentRun: true/false`

- [ ] C.2 修改 `src/batch/batch-orchestrator.ts`：将步骤 5 的 `buildDocGraph` 调用改为：
  ```typescript
  const { moduleSpecs, existingSpecs } = specStore.asDocGraphInput();
  const docGraph = buildDocGraph({ projectRoot: resolvedRoot, dependencyGraph: mergedGraph, moduleSpecs, existingSpecs });
  ```
  确认 `asDocGraphInput()` 的返回类型与 `BuildDocGraphOptions` 参数完全对应

- [ ] C.3 修改 `src/cli/commands/graph.ts` 独立运行路径：在 `scanStoredModuleSpecs` 之后构造轻量 SpecStore（`currentSpecs: []`，`storedSpecs: stored`），再通过 `specStore.asDocGraphInput()` 调用 `buildDocGraph`：
  ```typescript
  import { SpecStore } from '../../spec-store/index.js';
  const specStore = new SpecStore({ currentSpecs: [], storedSpecs: stored, projectRoot, toProjectPath });
  const { moduleSpecs, existingSpecs } = specStore.asDocGraphInput();
  ```

- [ ] C.4 确认 `src/spec-store/index.ts` 的 `asDocGraphInput()` 方法正确传递 `currentRun` 标志（本次生成的 spec 标记为 `currentRun: true`，磁盘已有的标记为 `false`）
  - **验证**：对照 `doc-graph-builder.ts` 内部处理 `currentRun` 的逻辑

- [ ] C.5 运行验证门禁：
  ```bash
  npx vitest run tests/panoramic/doc-graph-builder.test.ts
  npx vitest run tests/integration/batch-doc-graph.test.ts
  npx vitest run
  npm run build
  ```

- [ ] C.6 手动验证（可选但推荐）：对本仓库运行 `spectra graph`，对比迁移前后 `graph.json` 节点数一致

- [ ] C.7 提交并推送：
  ```bash
  git add src/batch/batch-orchestrator.ts src/cli/commands/graph.ts src/spec-store/index.ts
  git commit -m "refactor(128): migrate graph-builder to SpecStore.asDocGraphInput"
  git push origin 128-harden-spec-store
  ```

- [ ] C.8 追加：如果 `asDocGraphInput()` 实现需要新增 `ExistingSpecDocument` 转换逻辑（`StoredModuleSpecSummary → ExistingSpecDocument`），在 `src/spec-store/index.ts` 实现该转换，并在此 Step 提交中包含

---

## Step D：Coverage Auditor 迁移

**目标**：确认 coverage auditor 通过 SpecStore 驱动的 `docGraph` 链路获取数据，确认 bundle_copy spec 不会混入 `unlinkedSpecs`。

- [ ] D.1 阅读 `src/panoramic/pipelines/coverage-auditor.ts`（460 行），确认：`CoverageAuditor` 接收的是 `DocGraph` 还是原始 spec 列表；理解 `unlinkedSpecs` 如何在 docGraph 中产生

- [ ] D.2 阅读 `src/batch/batch-orchestrator.ts` 中 coverage auditor 调用点，确认 docGraph 此时已通过 Step C 由 SpecStore 驱动构建
  - **若 coverage auditor 直接使用 Step C 迁移后的 docGraph**：此 Step 主要是验证链路正确，无需修改接口
  - **若 coverage auditor 仍有独立的 spec 列表参数**：在此 Step 修改传参，改为 `specStore.allKnownSpecs()`

- [ ] D.3 验证 bundle_copy 隔离：确认 `docGraph.specs` 中不包含 `sourceKind === 'bundle_copy'` 的 spec（Step C 中 SpecStore 已过滤），coverage auditor 的 `unlinkedSpecs` 和 `totalModules` 不含副本干扰
  - **验证方式**：在测试中构造含 bundle_copy spec 的场景，断言 coverage report 的 `totalModules` = canonical spec 数量

- [ ] D.4 运行验证门禁：
  ```bash
  npx vitest run tests/panoramic/coverage-auditor.test.ts
  npx vitest run tests/integration/batch-coverage-report.test.ts
  npx vitest run
  npm run build
  ```

- [ ] D.5 确认 SC-001 部分覆盖（coverage auditor 消费方）：4 种场景下 coverage-report 的 `totalModules` 与 README footer 一致

- [ ] D.6 提交并推送：
  ```bash
  git add src/batch/batch-orchestrator.ts src/panoramic/pipelines/coverage-auditor.ts
  git commit -m "refactor(128): migrate coverage-auditor to SpecStore-driven docGraph"
  git push origin 128-harden-spec-store
  ```

---

## Step E：Index Generator 迁移

**目标**：将 `generateIndex` 的入参从手动计算的 `allIndexSpecs` 改为 `specStore.allKnownSpecs()`，使 index 生成与 README 计数对齐。

- [ ] E.1 阅读 `src/generator/index-generator.ts`（196 行），确认 `IndexableModuleSpec` 接口定义（第 18-23 行）与 `src/spec-store/index.ts` 导出的 `IndexableModuleSpec` 是否为同一类型或兼容
  - **若类型不同**：在此 Step 统一类型（从 SpecStore 重新导出，或在 index-generator.ts 中 import）

- [ ] E.2 修改 `src/batch/batch-orchestrator.ts` 步骤 6：将 `generateIndex(allIndexSpecs, ...)` 改为 `generateIndex(specStore.allKnownSpecs(), ...)`；确认 `allIndexSpecs` 变量此时已无其他引用（若有，推迟到 Step G 删除）
  - **验证**：`npm run build` 零错误

- [ ] E.3 检查 `src/generator/index-generator.ts` 内部：确认 `specs.length` 用于 `totalModules` 计数，与 Fix 127 修复行为等效（即：增量场景下 index 的 totalModules = N，不是只计本次生成的）

- [ ] E.4 运行验证门禁：
  ```bash
  npx vitest run tests/integration/batch-singlelang.test.ts
  npx vitest run
  npm run build
  ```

- [ ] E.5 确认 SC-001 部分覆盖（index generator 消费方）：4 种场景下 index 的 totalModules 与 README footer 一致

- [ ] E.6 提交并推送：
  ```bash
  git add src/batch/batch-orchestrator.ts src/generator/index-generator.ts
  git commit -m "refactor(128): migrate index-generator to SpecStore"
  git push origin 128-harden-spec-store
  ```

---

## Step F：Cross-Reference Builder 迁移

**目标**：确认 `buildCrossReferenceIndex` 通过 SpecStore 驱动的 `docGraph` 获取数据，保证 bundle_copy spec 不混入 cross-reference 构建。

- [ ] F.1 阅读 `src/panoramic/cross-reference-index.ts`（294 行），确认 `buildCrossReferenceIndex` 的输入参数（`ModuleSpec + DocGraph`）；定位第 32 行 `docGraph.specs` 中查找 canonical spec 的逻辑

- [ ] F.2 阅读 `src/batch/batch-orchestrator.ts` 中 `buildCrossReferenceIndex` 调用点，确认 docGraph 已由 Step C 的 SpecStore 链路提供
  - **若调用链已正确**：此 Step 主要是验证和补充测试
  - **若仍有独立 spec 列表参数**：在此 Step 修改，改为通过 `specStore.allKnownSpecs()` 获取

- [ ] F.3 验证 bundle_copy 排除后 canonical spec 查找不受影响：在 `docGraph.specs` 中 `sourceKind === 'bundle_copy'` 的 spec 已被过滤，确认 `buildCrossReferenceIndex` 第 32 行的查找逻辑在过滤后仍能找到所有 canonical spec
  - **验证方式**：构造含 bundle_copy 的测试场景，断言 cross-reference 报告不包含副本节点

- [ ] F.4 运行验证门禁：
  ```bash
  npx vitest run tests/panoramic/cross-reference-index.test.ts
  npx vitest run
  npm run build
  ```

- [ ] F.5 确认 SC-001 部分覆盖（cross-reference 消费方）：cross-reference 报告的 spec 引用数与其他消费方一致

- [ ] F.6 提交并推送：
  ```bash
  git add src/batch/batch-orchestrator.ts src/panoramic/cross-reference-index.ts
  git commit -m "refactor(128): migrate cross-reference-builder to SpecStore"
  git push origin 128-harden-spec-store
  ```

---

## Step G：删除旧合并逻辑

**目标**：5 个消费方全部迁移完成后，删除 `batch-orchestrator.ts` 中已无用的 `mergeIndexSpecs` 私有函数和 `allIndexSpecs` 变量，完成架构清理。

- [ ] G.1 阅读 `src/batch/batch-orchestrator.ts`，确认以下变量和函数已无引用：`mergeIndexSpecs` 函数（第 912-966 行）、`allIndexSpecs` 变量的所有使用点
  - **不要删除** `storedSpecByTarget`（第 298 行起）：该变量用于增量模式的 `regenerateTargets` 计算，属于 batch 策略逻辑，不属于 SpecStore 管理范围

- [ ] G.2 从 `src/batch/batch-orchestrator.ts` 删除 `mergeIndexSpecs` 函数（第 912-966 行附近的完整函数体）

- [ ] G.3 从 `src/batch/batch-orchestrator.ts` 删除所有 `allIndexSpecs` 变量定义（确认此时 5 个消费方都已通过 `specStore` 获取数据，`allIndexSpecs` 赋值语句也可删除）

- [ ] G.4 检查 `existingStoredSpecs` 变量：确认其仅在 `SpecStore` 构造传参处被使用，其他直接使用点（第 298、324、647 行）不属于删除范围

- [ ] G.5 运行完整门禁（删除后最关键的验证）：
  ```bash
  npm run build
  npx vitest run
  ```
  确认：零 TypeScript 错误，除 pre-existing `export-command.test.ts` 外无新增失败

- [ ] G.6 提交并推送：
  ```bash
  git add src/batch/batch-orchestrator.ts
  git commit -m "refactor(128): delete mergeIndexSpecs and allIndexSpecs (all consumers migrated)"
  git push origin 128-harden-spec-store
  ```

---

## Step H：开启 sourceKind 过滤 + 移除 Fix 128 workaround + 完整回归

**目标**：这是最关键的一步。在 `SpecFrontmatterSchema` 新增 `sourceKind`/`derivedFrom` 字段，在 bundle 复制时写入标识，在 `scanStoredModuleSpecs` 启用 sourceKind 过滤，并移除 Fix 128 的目录排除 workaround。

- [ ] H.1 修改 `src/models/module-spec.ts`：在 `SpecFrontmatterSchema` 末尾追加两个 optional 字段：
  ```typescript
  sourceKind: z.enum(['canonical', 'derived', 'bundle_copy']).optional(),
  derivedFrom: z.string().nullable().optional(),
  ```
  **参考**：`specs/128-harden-spec-store/contracts/source-kind-schema.ts` 的 `SpecFrontmatterIdentityExtensionSchema`
  - **验证**：`npm run build` 零错误，新字段的 inferred type 正确

- [ ] H.2 修改 `src/generator/frontmatter.ts`：在 `FrontmatterInput` 接口新增 `sourceKind?: SpecSourceKind` 和 `derivedFrom?: string | null` 可选字段；在 `generateFrontmatter` 函数中，若两字段有值则写入 YAML frontmatter 输出
  - **验证**：传入 `sourceKind: 'bundle_copy'` 时输出的 frontmatter 包含该字段

- [ ] H.3 修改 `src/panoramic/builders/doc-graph-builder.ts`：
  - 在 `StoredModuleSpecSummary` 接口新增 `sourceKind?: SpecSourceKind` 和 `derivedFrom?: string | null`
  - 在 `extractStoredModuleSpecSummary` 手动解析器（逐行扫描循环）中，按 `source-kind-schema.ts` 合同文件的 `extractSourceKindFromLine` 模式，新增 `sourceKind:` 和 `derivedFrom:` 两个分支
  - **验证**：手动解析器能正确解析 frontmatter 中的 `sourceKind: bundle_copy`

- [ ] H.4 修改 `src/panoramic/builders/doc-graph-builder.ts` 的 `scanStoredModuleSpecs` 函数：**启用 sourceKind 过滤**，在扫描结果中排除 `sourceKind === 'bundle_copy'` 和 `'derived'` 的 spec（向后兼容：缺失字段视为 `canonical`，不排除）；**同时移除 `excludeDir` 参数**（Fix 128 workaround）及其调用逻辑
  - **注意**：`walkSpecFiles` 函数签名也需要同步移除 `excludeDir` 参数

- [ ] H.5 修改 `src/panoramic/pipelines/docs-bundle-orchestrator.ts`：在 spec 文件复制逻辑中，写入 `sourceKind: 'bundle_copy'` 和 `derivedFrom: <源 canonical spec 的 outputPath 相对路径>` 到目标 spec 的 frontmatter
  - **参考**：`specs/128-harden-spec-store/quickstart.md` 第 3 节的 frontmatter 示例
  - **验证**：bundle 生成后，目标 spec 文件的 frontmatter 包含正确的 `sourceKind` 和 `derivedFrom` 字段

- [ ] H.6 修改 `tests/panoramic/doc-graph-builder.test.ts`：移除 `excludeDir` 参数相关的测试用例，新增 sourceKind 过滤测试（构造含 `bundle_copy` spec 的场景，断言 `scanStoredModuleSpecs` 结果不包含副本）

- [ ] H.7 运行完整单元测试验证：
  ```bash
  npx vitest run tests/panoramic/doc-graph-builder.test.ts
  npx vitest run tests/integration/
  npx vitest run
  npm run build
  ```

- [ ] H.8 **SC-002 验收验证**：手动构造或使用现有测试验证"15 个 .spec.md（5 canonical + 10 bundle_copy）场景下 graph 节点数 = 5，所有边指向 canonical 路径"；确认 Fix 128 的 bundle 目录排除规则已完全移除且测试仍通过
  - **验证命令**（本仓库示例）：
    ```bash
    spectra batch --force
    # 查看 graph.json 节点数 = canonical spec 数量
    node -e "const g=require('./specs/_meta/graph.json'); console.log('nodes:', g.nodes.length)"
    ```

- [ ] H.9 验证 SC-003（可扩展性）：确认新增 `sourceKind: 'derived'` 的 spec 时，所有分析器自动忽略，不需要修改任何分析器代码

- [ ] H.10 验证 SC-007（现有测试不回归）：
  ```bash
  npx vitest run
  ```
  除 pre-existing `export-command.test.ts` 失败外，确认零新增失败

- [ ] H.11 **同一 commit** 提交并推送（语义：移除 workaround + 启用 sourceKind 过滤是一个原子变更）：
  ```bash
  git add src/models/module-spec.ts src/generator/frontmatter.ts \
          src/panoramic/builders/doc-graph-builder.ts \
          src/panoramic/pipelines/docs-bundle-orchestrator.ts \
          tests/panoramic/doc-graph-builder.test.ts
  git commit -m "refactor(128): drop Fix 128 directory workaround, enable sourceKind filter"
  git push origin 128-harden-spec-store
  ```

---

## Dev Addon [P]：Dev 模式热重载（可与 Step A-H 并行）

**目标**：在 `mcp-server.ts` 新增 `--dev` 入口，dev 模式下通过 tsx --watch 子进程实现热重载，CI 环境自动禁用，满足 FR-010/011/013/014。

- [ ] DevAddon.1 阅读 `src/cli/commands/mcp-server.ts`（预计 < 100 行），理解 `runMcpServerCommand` 的入口参数结构和现有 flag 解析方式

- [ ] DevAddon.2 修改 `src/cli/commands/mcp-server.ts`：新增 `--dev` flag 解析和 `SPECTRA_DEV` 环境变量检测逻辑：
  ```typescript
  const isDev = (command.flags?.dev ?? false || process.env.SPECTRA_DEV === '1')
    && process.env.CI !== 'true';
  ```

- [ ] DevAddon.3 在 `src/cli/commands/mcp-server.ts` 实现 dev 模式分支：dev 为 true 时，通过 `child_process.spawn` 启动 tsx --watch 子进程：
  ```typescript
  import { spawn } from 'child_process';
  const child = spawn('tsx', ['--watch', path.join(srcDir, 'mcp/index.ts')], { stdio: 'inherit' });
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  process.on('SIGINT', () => child.kill('SIGINT'));
  ```
  确认 `srcDir` 路径解析正确（相对于安装位置）

- [ ] DevAddon.4 新建 `tests/cli/dev-reload.test.ts`，覆盖以下场景：
  - CI 环境（`process.env.CI = 'true'`）下 dev 模式不启动 watcher（mock `child_process.spawn`，断言未被调用）
  - `--dev` 标志正确解析为 `isDev = true`
  - `SPECTRA_DEV=0` 显式禁用时 `isDev = false`
  - **不实际 spawn** tsx 进程（所有 spawn 调用 mock）

- [ ] DevAddon.5 运行验证门禁：
  ```bash
  npx vitest run tests/cli/dev-reload.test.ts
  npx vitest run
  npm run build
  ```

- [ ] DevAddon.6 手动 E2E 验证（SC-004，CI 环境跳过）：
  1. 启动 `spectra mcp-server --dev`
  2. 修改 `src/` 下任一源文件（如修改 README 生成器的标题文字）
  3. 保存文件，在同一 AI 助手会话立即调用 MCP batch 工具
  4. 确认输出反映了代码修改，时间 < 5 秒

- [ ] DevAddon.7 提交并推送：
  ```bash
  git add src/cli/commands/mcp-server.ts tests/cli/dev-reload.test.ts
  git commit -m "feat(128): add dev hot-reload mode to mcp-server"
  git push origin 128-harden-spec-store
  ```

---

## Step I [P]：Direction Audit 自查工具（可与 Step A-H 并行）

**目标**：新建 `direction-audit` CLI 命令，接收 `graph.json` 并对照 AST import 数据做方向分类审计，输出结构化报告，满足 FR-015/016/017。

- [ ] I.1 新建 `src/cli/commands/direction-audit.ts` 骨架：实现 `runDirectionAuditCommand` 函数，解析 `--graph`（默认 `specs/_meta/graph.json`）和 `--output` 参数
  - **参考**：`specs/128-harden-spec-store/data-model.md` 第 5 节 `DirectionAuditReport` 结构

- [ ] I.2 在 `src/cli/commands/direction-audit.ts` 实现核心审计逻辑：
  - 读取 `graph.json`，提取 `links` 中 `relation === 'imports'` 等跨模块依赖边
  - 加载 AST import 数据（优先从 `specs/_meta/architecture-ir.json`，次选内存 docGraph）
  - 对每条边做方向验证，产出 `DirectionAuditResult`（correct / suspicious / incorrect / skipped）
  - 统计 `rootCauseBreakdown`（按 ast-extraction / panoramic-builder / cross-reference-inference 分类）

- [ ] I.3 在 `src/cli/commands/direction-audit.ts` 实现两种输出格式：
  - **控制台**：按 result 分组的 Markdown 表格，incorrect 项明确标注
  - **文件**：`--output` 指定路径时，写入 JSON 格式的 `DirectionAuditReport`

- [ ] I.4 实现 `--snapshot` 和 `--compare-snapshot` 参数（SC-006 CI 守卫支持）：`--snapshot` 写入当前报告快照；`--compare-snapshot` 比较当前 incorrect 数与快照，若增加则以非零退出码退出
  - **参考**：`specs/128-harden-spec-store/quickstart.md` 第 2 节 "CI 回归守卫" 示例

- [ ] I.5 修改 `src/cli/index.ts`：注册 `direction-audit` 子命令，绑定 `runDirectionAuditCommand`
  - **验证**：`spectra direction-audit --help` 能正确输出参数说明

- [ ] I.6 新建 `tests/integration/direction-audit.test.ts`：
  - 对本仓库 `specs/_meta/graph.json` 运行审计，验证报告结构符合 `DirectionAuditReport` schema
  - 验证空 graph（无 links）时，报告返回空 edges，不报错
  - 验证 `--compare-snapshot` 在 incorrect 数增加时返回非零退出码
  - **SC-005 性能**：记录审计时间，断言 < 600 秒（10 分钟）

- [ ] I.7 运行验证门禁：
  ```bash
  npx vitest run tests/integration/direction-audit.test.ts
  npx vitest run
  npm run build
  ```

- [ ] I.8 提交并推送：
  ```bash
  git add src/cli/commands/direction-audit.ts src/cli/index.ts \
          tests/integration/direction-audit.test.ts
  git commit -m "feat(128): add direction-audit CLI command + integration tests"
  git push origin 128-harden-spec-store
  ```

---

## Step Z：最终收尾

**目标**：所有 Step（A-H + Dev Addon + Step I）完成后，做最终 rebase 同步 master 并完整验证。

- [ ] Z.1 最终 push 前 rebase（所有其他 Step 的产物已合入当前分支后执行）：
  ```bash
  git fetch origin master:master
  git rebase master
  npx vitest run
  npm run build
  git push --force-with-lease origin 128-harden-spec-store
  ```

---

## 验证总表（SC 对应关系）

| Success Criteria | 验证 Task | 验证方式 |
|---|---|---|
| **SC-001**：5 个消费方 spec 总数在 4 场景下完全一致 | B.6, D.5, E.5, F.5 + 全量测试 | `batch-incremental.test.ts` 4 场景断言 |
| **SC-002**：15 个 spec 中 graph 节点数 = 5（canonical），Fix 128 workaround 完全移除 | H.8 | `scanStoredModuleSpecs` 不传 `excludeDir` 且测试仍通过；手动验证 graph 节点数 |
| **SC-003**：新增衍生产物类型无需修改分析器 | H.9 | 新增 `sourceKind: derived` spec 场景测试 |
| **SC-004**：Dev 模式改代码 → 下次调用 ≤ 5 秒；非 dev 模式无性能回归 | DevAddon.6 | 手动 E2E；CI 环境跳过实际 spawn |
| **SC-005**：direction audit 全量审计 < 10 分钟 | I.6 | 集成测试时间断言（< 600 秒） |
| **SC-006**：修复后 regression test 守卫纳入 CI | I.4, I.6 | `--compare-snapshot` 逻辑测试 |
| **SC-007**：所有现有测试迁移后仍通过 | G.5, H.10 | `npx vitest run` 全量（pre-existing 失败除外） |
