---
feature_id: "156"
tasks_version: "1.1"
status: "draft"
created: "2026-05-08"
revised: "2026-05-08"
estimated_weeks: 4
total_tasks: 44
---

# Feature 156 — Tasks

## Revision Log

| 版本 | 日期 | 变更摘要 |
|------|------|----------|
| v1.0 | 2026-05-08 | 初始版本，40 个任务 |
| v1.1 | 2026-05-08 | Codex 对抗审查修订：CRIT-1 插入 T-012b（language-adapter buildUnifiedGraph 切换）；CRIT-2 T-002 fixture 补 require() + T-023/T-039 断言展开；CRIT-3 T-013 拆分为 T-013a/T-013b/T-013c；WARN-1 T-023 DoD 改脚本化比较；WARN-2 T-026 DoD 增多进程冲突 fixture；WARN-3 增 T-035a 双 worktree 污染验证；WARN-4 T-007 增 isCircular SCC 测试用例；WARN-5 T-033/T-035 DoD 统一调用 verify-feature-156.mjs；净增 4 个任务，总计 44 个 |
| W3 done | 2026-05-09 | T-031（incremental.ts）/ T-032（incremental 单测 10/10 pass）/ T-033（--watch 真实现 + FileWatcher 批量回调）/ T-034（EC-2 / EC-9 / EC-10 降级路径完整）/ T-035（4 e2e pass，含 AC-2b/3a/3b/4 + EC-11 跨 worktree）已落地。vitest 3231/0 fail，build pass，repo:check pass。T-035a/T-036/T-037/T-038/T-039/T-040 留 W4。 |

---

## 任务清单总览

| # | Task ID | Phase / Week | 标题 | 类型 | 优先级 | 估时(h) | 依赖 | FR/AC |
|---|---------|-------------|------|------|--------|--------|------|-------|
| 1 | T-001 | W1.0 | 前置：梳理 ast-analyzer.ts import 提取点 | cleanup | P0 | 2 | - | FR-28 |
| 2 | T-002 | W1.0 | 新建 tests/fixtures/ts-import-scenarios/ | new-file | P0 | 2 | - | FR-28 / AC-11 |
| 3 | T-003 | W1.0 | 新建 src/core/import-resolver.ts | new-module | P0 | 6 | T-001 | FR-28 / AC-11 |
| 4 | T-004 | W1.0 | 修改 src/core/ast-analyzer.ts：接入 import-resolver | modify-large-file | P0 | 4 | T-003 | FR-28 |
| 5 | T-005 | W1.0 | 修改 src/core/tree-sitter-fallback.ts：接入 import-resolver | modify-large-file | P0 | 4 | T-003 | FR-28 |
| 6 | T-006 | W1.1 | 新建 src/graph/legacy-shim.ts（含 isCircular SCC 反查） | new-module | P0 | 6 | T-004, T-005 | FR-18 / FR-27 / FR-31 |
| 7 | T-007 | W1.1 | 新建 tests/unit/knowledge-graph/consumer-shim.test.ts | write-test | P0 | 4 | T-006 | FR-32 / AC-8 |
| 8 | T-008 | W1.2a | rewrite src/graph/dependency-graph.ts（过渡路径） | rewrite | P0 | 6 | T-006 | FR-20 / FR-22 |
| 9 | T-009 | W1.2a | rewrite src/graph/directory-graph.ts | rewrite | P0 | 4 | T-006 | FR-20 |
| 10 | T-010 | W1.2a | rewrite src/adapters/ts-js-adapter.ts | rewrite | P0 | 4 | T-006 | FR-20 |
| 11 | T-011 | W1.2a | rewrite src/adapters/python-adapter.ts | rewrite | P0 | 5 | T-006 | FR-20 |
| 12 | T-012 | W1.2a | rewrite src/adapters/language-adapter.ts（过渡签名） | rewrite | P0 | 3 | T-006 | FR-20 / FR-21 |
| 13 | T-012b | W1.2a | 改造 src/adapters/language-adapter.ts 接口：buildDependencyGraph → buildUnifiedGraph 切换 | shape-map | P0 | 3 | T-012 | FR-21 |
| 14 | T-013a | W1.2a | rewrite src/batch/batch-orchestrator.ts（内部接口切换：buildDependencyGraph → buildUnifiedGraph 调用点） | rewrite | P0 | 4 | T-006 | FR-17 / FR-27 / FR-31 |
| 15 | T-013b | W1.2a | batch-orchestrator.ts 下游兼容：mergedGraph 向 delta-regenerator / module-grouper 传 derived view，验证 npm run build pass | rewrite | P0 | 4 | T-013a | FR-17 / FR-27 |
| 16 | T-013c | W1.2a | batch-orchestrator 集成测试：batch-orchestrator → unified pipeline e2e fixture，含回归测试 | write-test | P0 | 4 | T-013b | FR-17 / FR-31 |
| 17 | T-014 | W1.2b | shape-map src/graph/topological-sort.ts | shape-map | P0 | 4 | T-013c | FR-18 |
| 18 | T-015 | W1.2b | shape-map src/graph/mermaid-renderer.ts | shape-map | P0 | 4 | T-013c | FR-19 |
| 19 | T-016 | W1.2b | shape-map src/panoramic/builders/doc-graph-builder.ts | shape-map | P0 | 4 | T-013c | FR-21 |
| 20 | T-017 | W1.2b | shape-map src/panoramic/generators/cross-package-analyzer.ts | shape-map | P0 | 4 | T-013c | FR-21 |
| 21 | T-018 | W1.2b | shape-map src/generator/index-generator.ts | shape-map | P0 | 3 | T-013c | FR-21 |
| 22 | T-019 | W1.2b | shape-map src/batch/delta-regenerator.ts | shape-map | P0 | 4 | T-013c | FR-21 |
| 23 | T-020 | W1.2b | shape-map src/batch/module-grouper.ts | shape-map | P0 | 4 | T-013c | FR-21 |
| 24 | T-021 | W1.3 | trivial src/adapters/index.ts + src/cli/commands/graph.ts + src/knowledge-graph/unified-graph.ts | trivial | P0 | 2 | T-012b, T-014~T-020 | FR-22 |
| 25 | T-022 | W1.3 | Commit 1（改造 commit）：vitest + build 验证 | verify | P0 | 2 | T-021 | FR-26 / AC-7 |
| 26 | T-023 | W1.3 | AC-11 baseline 采集（dependency-cruiser 删除前） | verify | P0 | 2 | T-022 | AC-11 |
| 27 | T-024 | W1.3 | Commit 2（删除 commit）：删除 legacy-shim.ts + dependency-graph.ts + models/dependency-graph.ts + 移除 cruiser | delete | P0 | 3 | T-023 | FR-22 / AC-5 / AC-6 |
| 28 | T-025 | W1.3 | W1 出口验证：AC-5 / AC-6 + spectra batch micrograd 冒烟 | verify | P0 | 2 | T-024 | FR-23 / AC-5 / AC-6 |
| 29 | T-026 | W2.1 | 新建 src/knowledge-graph/persistence.ts | new-module | P1 | 6 | T-025 | FR-1 / FR-2 / FR-3 / FR-4 / FR-5 |
| 30 | T-027 | W2.1 | 新建 tests/unit/knowledge-graph/persistence.test.ts | write-test | P1 | 4 | T-026 | FR-24 / AC-8 |
| 31 | T-028 | W2.2 | 新建 src/cli/commands/index.ts（全量路径骨架） | new-module | P1 | 4 | T-026 | FR-11 / FR-14 / FR-30 |
| 32 | T-029 | W2.2 | 修改 .gitignore（加入 .spectra/） | trivial | P1 [P] | 1 | - | FR-4 |
| 33 | T-030 | W2.3 | W2 出口验证：AC-9 + snapshot Zod + EC-8 降级路径 | verify | P1 | 3 | T-028 | FR-1 / FR-3 / AC-9 |
| 34 | T-031 | W3.1 | 新建 src/knowledge-graph/incremental.ts | new-module | P1 | 8 | T-026 | FR-6 / FR-7 / FR-8 / FR-9 / FR-10 / FR-29 |
| 35 | T-032 | W3.1 | 新建 tests/unit/knowledge-graph/incremental.test.ts | write-test | P1 | 4 | T-031 | FR-25 / AC-8 |
| 36 | T-033 | W3.2 | 补全 src/cli/commands/index.ts（--watch + --incremental flag + --caller-depth） | modify-small-file | P1 | 4 | T-031, T-028 | FR-12 / FR-13 / FR-30 |
| 37 | T-034 | W3.3 | 实现 EC-2 / EC-9 / EC-10 降级路径（watch 无 git + rename/delete + shallow clone） | modify-small-file | P1 | 4 | T-031 | FR-6 / FR-8 |
| 38 | T-035 | W3.4 | W3 出口验证：self-dogfood incremental < 30 sec；AC-2b / AC-3b | verify | P1 | 3 | T-033, T-034 | FR-29 / AC-2b / AC-3b |
| 39 | T-035a | W3.4 | 双 worktree 污染验证：两个 worktree 各跑 spectra index，验证 .spectra/unified-graph.json 互不污染 | verify | P1 | 2 | T-035 | EC-11 |
| 40 | T-036 | W4.1 | 新建 plugins/spectra/hooks/post-commit.sh + README 安装说明 | new-file | P2 | 3 | T-033 | FR-15 / FR-16 |
| 41 | T-037 | W4.2 | 新建 scripts/verify-feature-156.mjs（full vs incremental 对比验证脚本） | end-to-end-script | P1 | 6 | T-035a | FR-9 / FR-10 / FR-29 / AC-3a / AC-3b |
| 42 | T-038 | W4.2 | 修改 package.json：加入 npm run verify:f156 | trivial | P2 [P] | 1 | T-037 | - |
| 43 | T-039 | W4.3 | 全量验收：AC-1 / AC-2a / AC-7 / AC-8 / AC-11 + baseline:collect 重测 | verify | P1 | 4 | T-037 | AC-1 / AC-2a / AC-7 / AC-8 / AC-11 |
| 44 | T-040 | W4.4 | Buffer：回归修复 + Codex 对抗审查 + 代码 review | buffer | P1 | 8 | T-039 | FR-26 / AC-7 |

---

## 任务详情（按 Week / Phase 分组）

### Week 1 — DependencyGraph Shim 先行

#### T-001：前置清理——梳理 ast-analyzer.ts import 提取点
- **类型**：cleanup
- **优先级**：P0（W1.0 阻断前置，不梳理就无法安全接入 import-resolver）
- **估时**：2h
- **依赖**：无
- **关联 FR/AC**：FR-28
- **执行步骤**：
  1. 阅读 `src/core/ast-analyzer.ts` 全文，定位 import 提取循环（约 L376）
  2. 统计所有 `resolvedPath` 赋值点（预期 ~8 处），确认是否有隐藏的 resolvedPath 消费逻辑（如 `deriveImportEdges` 是否有其他调用方）
  3. 阅读 `src/core/tree-sitter-fallback.ts` 定位对应的 import 提取点
  4. 在 PR description / task 注释中记录调用点清单
- **完成定义（DoD）**：
  - 调用点清单已记录（文件 + 行号）
  - 确认无隐藏的 resolvedPath 消费逻辑（非 `deriveImportEdges` 的其他消费方）
- **验收命令**：
  ```bash
  # 确认 resolvedPath 在 ast-analyzer 中仅在 L376 区域赋值
  grep -n "resolvedPath" src/core/ast-analyzer.ts
  grep -n "resolvedPath" src/core/tree-sitter-fallback.ts
  ```

---

#### T-002：新建 tests/fixtures/ts-import-scenarios/（AC-11 fixture）
- **类型**：new-file
- **优先级**：P0（AC-11 验证所需 fixture，W1.0 完成标志之一）
- **估时**：2h
- **依赖**：无（可与 T-001 并行）
- **关联 FR/AC**：FR-28 / AC-11
- **执行步骤**：
  1. 创建目录 `tests/fixtures/ts-import-scenarios/`
  2. 新建 `static-import.ts`：一个 static import 语句（`import { foo } from './foo'`）
  3. 新建 `dynamic-import.ts`：一个动态 `import()` 语句
  4. 新建 `type-only-import.ts`：一个 `import type { Bar } from './bar'`
  5. 新建 `commonjs-require.ts`：一个 CommonJS `const baz = require('./baz')` 语句（CRIT-2 补充）
  6. 新建 `circular-a.ts`：import circular-b；新建 `circular-b.ts`：import circular-a（互相依赖）
  7. 新建 `foo.ts` / `bar.ts` / `baz.ts` 作为被 import 的目标文件（空模块即可）
- **完成定义（DoD）**：
  - fixture 目录存在，含 7+ 个文件
  - 4 类 import 场景齐全：static / dynamic / type-only / commonjs-require（含 `require()`）/ circular
- **验收命令**：
  ```bash
  ls tests/fixtures/ts-import-scenarios/
  # 期望含：static-import.ts dynamic-import.ts type-only-import.ts commonjs-require.ts circular-a.ts circular-b.ts foo.ts bar.ts baz.ts
  ```

---

#### T-003：新建 src/core/import-resolver.ts
- **类型**：new-module
- **优先级**：P0（W1.0 核心交付，阻断 T-004/T-005）
- **估时**：6h
- **依赖**：T-001
- **关联 FR/AC**：FR-28 / AC-11
- **执行步骤**：
  1. 创建 `src/core/import-resolver.ts`
  2. 定义 `ResolveTsJsImportOptions` 接口（extensions / indexFiles / pathAliases）
  3. 实现 `resolveTsJsImport(specifier, fromFile, projectRoot, options?) → string | null`：
     - 相对路径：基于 `fromFile` 绝对路径拼接
     - 尝试扩展名列表（.ts/.tsx/.js/.jsx/.mjs/.cjs），找到第一个存在的文件返回
     - 尝试 `index.ts` / `index.js` fallback（目录导入）
     - tsconfig paths 别名：若 `pathAliases` 存在，尝试替换 specifier 前缀
     - node_modules：返回 null（不解析外部依赖）
  4. 实现 `detectImportType(node: ...) → ImportType`，4 类判断规则（见 plan §2.5）：
     - type-only：`node.isTypeOnly()` 为 true
     - dynamic：CallExpression 且 callee 是 import 关键字
     - require：CallExpression 且 callee 文本为 "require"
     - static：其他 ImportDeclaration
  5. 导出 `ImportType = 'static' | 'dynamic' | 'type-only' | 'commonjs-require'`
- **完成定义（DoD）**：
  - `npm run build` 零 type error
  - 对 T-002 的 4 类 fixture 手动验证 `resolveTsJsImport` 返回非 null 路径
  - `detectImportType` 对 4 类 fixture（包含 commonjs-require）输出正确字面量
- **验收命令**：
  ```bash
  npm run build
  # 手动验证（待 T-004 集成后通过 vitest 验证）
  ```

---

#### T-004：修改 src/core/ast-analyzer.ts——接入 import-resolver
- **类型**：modify-large-file
- **优先级**：P0
- **估时**：4h
- **依赖**：T-003
- **关联 FR/AC**：FR-28 / AC-11
- **执行步骤**：
  1. 在 import 提取循环（约 L376）中，对每个 import 节点调用 `resolveTsJsImport`，将结果写入 `CodeSkeleton.imports[i].resolvedPath`
  2. 对每个 import 节点调用 `detectImportType`，写入 `CodeSkeleton.imports[i].importType`
  3. 传入 `projectRoot` 参数（从函数签名或上下文获取）；如需调整函数签名，确保 build 零错误
  4. 在 T-002 fixture 上触发 `buildUnifiedGraph`，确认 `depends-on` 边 ≥ 4（4 类各 ≥ 1 条，含 commonjs-require 边）
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `npx vitest run` 零失败（现有 3155 条）
  - fixture 上 `depends-on` 边 ≥ 4，无 null resolvedPath
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ```

---

#### T-005：修改 src/core/tree-sitter-fallback.ts——接入 import-resolver
- **类型**：modify-large-file
- **优先级**：P0（可与 T-004 并行，不同文件）
- **估时**：4h
- **依赖**：T-003
- **关联 FR/AC**：FR-28
- **执行步骤**：
  1. 定位 `tree-sitter-fallback.ts` 的 import 提取点（按 query 节点类型）
  2. 对每种 import 节点类型映射到 `detectImportType` 4 类：
     - `type_import_declaration` → `'type-only'`
     - `call_expression`（callee 文本 = "import"）→ `'dynamic'`
     - `call_expression`（callee 文本 = "require"）→ `'commonjs-require'`
     - `import_statement` → `'static'`
  3. 调用 `resolveTsJsImport` 填充 `resolvedPath`
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `npx vitest run` 零失败
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ```

---

#### T-006：新建 src/graph/legacy-shim.ts（含 isCircular / importType 派生）
- **类型**：new-module
- **优先级**：P0（W1.1 阻断 T-008~T-013，必须先行）
- **估时**：6h
- **依赖**：T-004, T-005
- **关联 FR/AC**：FR-18 / FR-27 / FR-31
- **执行步骤**：
  1. 创建 `src/graph/legacy-shim.ts`（私有，非 public export——不加入 `src/graph/index.ts`）
  2. 实现 `deriveLegacyDependencyGraph(unified: UnifiedGraph, projectRoot: string) → DependencyGraph`：
     - 过滤 `kind === 'module'` 节点 → `modules: GraphNode[]`
     - 计算 `inDegree / outDegree / level / isOrphan`（O(E) 线性扫描，见 plan §§ 风险 B）
     - 过滤 `relation === 'depends-on'` 边 → `edges: DependencyEdge[]`
     - 从 `edge.evidence.importType` 读取 `importType` 字段
     - isCircular：复用 `detectSCCs`（`src/graph/topological-sort.ts:32`，Tarjan），SCC size > 1 的成员间边标 `isCircular=true`
     - 调用 `topologicalSort` 填充 `topologicalOrder / levels`
  3. 确保函数从**传入的 UnifiedGraph 参数**派生，禁止调用 `getCurrentUnifiedGraph()` 全局 cache（FR-31）
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - 文件没有作为 public export 暴露（grep 确认）
  - isCircular 对 circular-a/b fixture 返回 true，其余返回 false
- **验收命令**：
  ```bash
  npm run build
  grep -rn "legacy-shim" src/graph/index.ts  # 期望无结果
  ```

---

#### T-007：新建 tests/unit/knowledge-graph/consumer-shim.test.ts（≥ 4 条）
- **类型**：write-test
- **优先级**：P0（W1.1 完成标志）
- **估时**：4h（WARN-4 修订：从 3h 提至 4h，新增 isCircular SCC 测试用例）
- **依赖**：T-006
- **关联 FR/AC**：FR-32 / AC-8
- **执行步骤**：
  1. 新建 `tests/unit/knowledge-graph/consumer-shim.test.ts`
  2. **S-1**：`deriveLegacyDependencyGraph` 产出的 `modules[].inDegree` 与手动计算一致（fixture：3 模块 + 2 条 depends-on 边）
  3. **S-2**：`topologicalSort` 接受 UnifiedGraph 子图后，输出 `order` 与原 DependencyGraph 路径等价（对比两条路径的 `order` 数组）
  4. **S-3**：`renderUnifiedGraph`（或等价函数）产出 Mermaid 文本包含所有 depends-on 边的 `source → target` 方向（`-->` 箭头数 = depends-on 边数量）
  5. **S-4**（WARN-4 新增）：`isCircular` 派生——fixture 含 SCC（A→B→A），shim 输出 `edge.isCircular === true` 对应 SCC 内边；非 SCC 边 `edge.isCircular === false`
  6. 参照 `tests/unit/knowledge-graph/build-unified-graph.test.ts` 写法（`afterEach` 清理单例 cache，`mkSk()` 工厂函数）
- **完成定义（DoD）**：
  - 4 条单测全部 pass（`npx vitest run tests/unit/knowledge-graph/consumer-shim.test.ts`）
- **验收命令**：
  ```bash
  npx vitest run tests/unit/knowledge-graph/consumer-shim.test.ts
  ```

---

#### T-008：rewrite src/graph/dependency-graph.ts（过渡路径）
- **类型**：rewrite
- **优先级**：P0
- **估时**：6h
- **依赖**：T-006
- **关联 FR/AC**：FR-20 / FR-22
- **执行步骤**：
  1. 阅读 `src/graph/dependency-graph.ts` 全文（~150 LOC）
  2. 删除 `dependency-cruiser` 调用（`import { cruise }` 等）
  3. 将 `buildGraph()` 改为：调用 `buildUnifiedGraph(input)` → 调用 `deriveLegacyDependencyGraph(unified, projectRoot)`
  4. 保留函数对外签名不变（过渡期——T-024 前不删除本文件）
  5. `npm run build` 零 type error
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `npx vitest run` 零失败
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ```

---

#### T-009：rewrite src/graph/directory-graph.ts
- **类型**：rewrite
- **优先级**：P0（可与 T-008 并行，不同文件）
- **估时**：4h
- **依赖**：T-006
- **关联 FR/AC**：FR-20
- **执行步骤**：
  1. 阅读 `src/graph/directory-graph.ts` 全文
  2. 将 `buildDirectoryGraph()` 改为：调用 `buildUnifiedGraph(input)` + 从 `depends-on` 边派生兼容视图返回
  3. 不依赖 `dependency-cruiser`
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `npx vitest run` 零失败
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ```

---

#### T-010：rewrite src/adapters/ts-js-adapter.ts
- **类型**：rewrite
- **优先级**：P0（可与 T-008/T-009 并行）
- **估时**：4h
- **依赖**：T-006
- **关联 FR/AC**：FR-20
- **执行步骤**：
  1. 阅读 `src/adapters/ts-js-adapter.ts`（~80 LOC）
  2. `buildDependencyGraph()` 改为委托 `buildUnifiedGraph` + `deriveLegacyDependencyGraph`
  3. 移除 `dependency-cruiser` import
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `npx vitest run` 零失败
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ```

---

#### T-011：rewrite src/adapters/python-adapter.ts
- **类型**：rewrite
- **优先级**：P0（可与 T-008~T-010 并行，不同文件）
- **估时**：5h
- **依赖**：T-006
- **关联 FR/AC**：FR-20
- **执行步骤**：
  1. 阅读 `src/adapters/python-adapter.ts`（~280 LOC）
  2. 保留现有 CodeSkeleton 提取逻辑
  3. 将输出路径改为：调用 `buildUnifiedGraph` + `deriveLegacyDependencyGraph` 派生
  4. EC-6（basename map 精度）不在本 Feature 范围，保持现有行为，注释说明
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `npx vitest run` 零失败
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ```

---

#### T-012：rewrite src/adapters/language-adapter.ts（过渡签名）
- **类型**：rewrite
- **优先级**：P0（可与 T-008~T-011 并行）
- **估时**：3h
- **依赖**：T-006
- **关联 FR/AC**：FR-20 / FR-21
- **执行步骤**：
  1. 阅读 `src/adapters/language-adapter.ts`
  2. `buildDependencyGraph?()` 接口签名更新（过渡期保留，T-012b 完成后彻底切换）
  3. 确保 T-010 / T-011 的 adapter 实现类通过类型检查
- **完成定义（DoD）**：
  - `npm run build` 零错误
- **验收命令**：
  ```bash
  npm run build
  ```

---

#### T-012b：改造 src/adapters/language-adapter.ts 接口——buildDependencyGraph → buildUnifiedGraph 切换（CRIT-1 补充）
- **类型**：shape-map
- **优先级**：P0（T-012 过渡签名完成后，正式切换到 UnifiedGraph 接口；阻断 T-021 依赖）
- **估时**：3h
- **依赖**：T-012（language-adapter 过渡签名）
- **关联 FR/AC**：FR-21
- **执行步骤**：
  1. 将 `LanguageAdapter` 接口中的 `buildDependencyGraph?()` 方法签名改为 `buildUnifiedGraph?(input, options?) → Promise<UnifiedGraph>`
  2. 更新所有实现类（`ts-js-adapter.ts`、`python-adapter.ts` 等）以实现新接口，删除旧 `buildDependencyGraph` 方法（或保留 shim 委托，视 T-024 时序决定）
  3. 确认 `src/adapters/index.ts` 导出类型与新接口对齐
  4. `npm run build` 零错误
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `grep -rn "buildDependencyGraph" src/adapters/language-adapter.ts` 期望无结果（已切换完毕）
  - `npx vitest run` 零失败
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  grep -rn "buildDependencyGraph" src/adapters/language-adapter.ts  # 期望: 无输出
  ```

---

#### T-013a：rewrite src/batch/batch-orchestrator.ts——内部接口切换（buildDependencyGraph → buildUnifiedGraph 调用点）
- **类型**：rewrite
- **优先级**：P0（高风险，风险 A，W1.2a 核心第一步）
- **估时**：4h
- **依赖**：T-006
- **关联 FR/AC**：FR-17 / FR-27 / FR-31
- **执行步骤**：
  1. 阅读 `src/batch/batch-orchestrator.ts`（~900 LOC），定位 `buildGraphForLanguageGroup` 函数
  2. 在内部新增 `buildUnifiedGraph` 调用路径（`buildGraphForLanguageGroup` 改为内部调用 `buildUnifiedGraph`）
  3. 在函数内部保留 `deriveLegacyDependencyGraph` 输出点（让 T-013b 的下游 consumer 暂不受影响）
  4. 确保从**传入参数**派生，禁止调用 `getCurrentUnifiedGraph()` 全局 cache（FR-31）
  5. `npm run build` 零 type error
- **完成定义（DoD）**：
  - `npm run build` 零 type error
  - `buildGraphForLanguageGroup` 内部已使用 `buildUnifiedGraph` 调用路径
  - `npx vitest run` 零失败
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ```

---

#### T-013b：batch-orchestrator.ts 下游兼容——mergedGraph 向 delta-regenerator / module-grouper 传 derived view
- **类型**：rewrite
- **优先级**：P0（依赖 T-013a，W1.2a 核心第二步）
- **估时**：4h
- **依赖**：T-013a
- **关联 FR/AC**：FR-17 / FR-27
- **执行步骤**：
  1. 在 `batch-orchestrator.ts` 中找到向 `delta-regenerator` 和 `module-grouper` 传递 `mergedGraph` 的调用点
  2. 将传参改为通过 `deriveLegacyDependencyGraph` 从 UnifiedGraph 派生的兼容视图，确保下游 consumer 接口不变
  3. 确认 `npm run build` 零错误，下游 consumer 无 type error
  4. 验证 `spectra batch` 在 micrograd 上冒烟无 runtime error
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `npx vitest run` 零失败
  - `spectra batch` micrograd 冒烟无 error
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ```

---

#### T-013c：batch-orchestrator 集成测试——unified pipeline e2e fixture，含回归测试
- **类型**：write-test
- **优先级**：P0（依赖 T-013b，W1.2a 出口测试）
- **估时**：4h
- **依赖**：T-013b
- **关联 FR/AC**：FR-17 / FR-31
- **执行步骤**：
  1. 在 `tests/unit/knowledge-graph/consumer-shim.test.ts` 或新建 `tests/unit/batch/batch-orchestrator-unified.test.ts` 中新增 1-2 条集成测试
  2. **B-1**：输入 LanguageGroup，`buildGraphForLanguageGroup` 输出 `mergedGraph` 包含正确的 `depends-on` 边（通过 mock UnifiedGraph 构造）
  3. **B-2**：`deriveLegacyDependencyGraph` 派生的 `mergedGraph` 传给 delta-regenerator 后，`source/target` 字段正确映射（对比旧 `from/to` 路径）
  4. 确认 `npx vitest run` 全量零失败
- **完成定义（DoD）**：
  - 1-2 条集成测试全部 pass
  - `npx vitest run` 零失败（现有 3155 条 + 新增用例）
- **验收命令**：
  ```bash
  npx vitest run
  ```

---

#### T-014：shape-map src/graph/topological-sort.ts
- **类型**：shape-map
- **优先级**：P0（可与 T-015~T-020 并行，不同文件）
- **估时**：4h
- **依赖**：T-013c
- **关联 FR/AC**：FR-18
- **执行步骤**：
  1. 阅读 `src/graph/topological-sort.ts`（211 LOC）
  2. 为 `detectSCCs` 和 `topologicalSort` 新增重载，接受标准化子图结构 `{ nodes: string[], edges: Array<{from: string, to: string}> }`
  3. 调用方（`legacy-shim.ts`）传入从 UnifiedGraph 过滤后的 `kind === 'module'` 节点 + `depends-on` 边
  4. 保留对 `DependencyGraph` 的原有重载直到 T-024（删除 commit）
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - consumer-shim.test.ts S-2 单测 pass
- **验收命令**：
  ```bash
  npm run build && npx vitest run tests/unit/knowledge-graph/consumer-shim.test.ts
  ```

---

#### T-015：shape-map src/graph/mermaid-renderer.ts
- **类型**：shape-map
- **优先级**：P0（可与 T-014 / T-016~T-020 并行）
- **估时**：4h
- **依赖**：T-013c
- **关联 FR/AC**：FR-19
- **执行步骤**：
  1. 阅读 `src/graph/mermaid-renderer.ts`（~120 LOC）
  2. 新增 `renderUnifiedGraph(unified: UnifiedGraph, options?)` 函数，遍历 `depends-on` 边，产出格式与原有 `renderDependencyGraph` 一致
  3. 保留 `renderDependencyGraph` 直到 T-024（删除 commit）
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - consumer-shim.test.ts S-3 单测 pass（Mermaid `-->` 箭头数 = depends-on 边数量）
- **验收命令**：
  ```bash
  npm run build && npx vitest run tests/unit/knowledge-graph/consumer-shim.test.ts
  ```

---

#### T-016：shape-map src/panoramic/builders/doc-graph-builder.ts
- **类型**：shape-map
- **优先级**：P0（可与 T-014/T-015 并行）
- **估时**：4h
- **依赖**：T-013c
- **关联 FR/AC**：FR-21
- **执行步骤**：
  1. 阅读 `src/panoramic/builders/doc-graph-builder.ts`（~350 LOC）
  2. `BuildDocGraphOptions.dependencyGraph` 改为 `unifiedGraph: UnifiedGraph`
  3. 内部字段映射：`from/to` → `source/target`，`graph.modules` → 过滤后的 `graph.nodes`
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `npx vitest run` 零失败
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ```

---

#### T-017：shape-map src/panoramic/generators/cross-package-analyzer.ts
- **类型**：shape-map
- **优先级**：P0（可与 T-014~T-016 并行）
- **估时**：4h
- **依赖**：T-013c
- **关联 FR/AC**：FR-21
- **执行步骤**：
  1. 阅读 `src/panoramic/generators/cross-package-analyzer.ts`（~300 LOC）
  2. 入参改为 UnifiedGraph；包级图直接从 `depends-on` 边过滤
  3. 移除对 `detectSCCs(dependencyGraph)` 的旧调用，改为 UnifiedGraph 子图传入
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `npx vitest run` 零失败
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ```

---

#### T-018：shape-map src/generator/index-generator.ts
- **类型**：shape-map
- **优先级**：P0（可与 T-014~T-017 并行）
- **估时**：3h
- **依赖**：T-013c
- **关联 FR/AC**：FR-21
- **执行步骤**：
  1. 阅读 `src/generator/index-generator.ts`（~180 LOC）
  2. `identifyCrossCuttingConcerns` 入参改为 UnifiedGraph
  3. `inDegree` 从 UnifiedGraph 邻接表动态计算（`target` 为该节点的 `depends-on` 边数量，O(E)）
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `npx vitest run` 零失败
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ```

---

#### T-019：shape-map src/batch/delta-regenerator.ts
- **类型**：shape-map
- **优先级**：P0（可与 T-014~T-018 并行）
- **估时**：4h
- **依赖**：T-013c
- **关联 FR/AC**：FR-21
- **执行步骤**：
  1. 阅读 `src/batch/delta-regenerator.ts`（~250 LOC）
  2. `DeltaRegeneratorOptions.dependencyGraph` 改为 `unifiedGraph: UnifiedGraph`
  3. 内部 `edges[].from/to` → `edges[].source/target` 字段映射
  4. 新增 1 条单测（delta-regenerator shape-map：入参 UnifiedGraph 后 `source/target` 正确映射）
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `npx vitest run` 零失败
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ```

---

#### T-020：shape-map src/batch/module-grouper.ts
- **类型**：shape-map
- **优先级**：P0（可与 T-014~T-019 并行）
- **估时**：4h
- **依赖**：T-013c
- **关联 FR/AC**：FR-21
- **执行步骤**：
  1. 阅读 `src/batch/module-grouper.ts`（~200 LOC）
  2. `groupFilesToModules` 入参改为 UnifiedGraph
  3. 遍历 `depends-on` 边替代 `graph.modules / edges` 遍历
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `npx vitest run` 零失败
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ```

---

#### T-021：trivial 改造——src/adapters/index.ts + src/cli/commands/graph.ts + src/knowledge-graph/unified-graph.ts
- **类型**：trivial
- **优先级**：P0
- **估时**：2h
- **依赖**：T-012b, T-014, T-015, T-016, T-017, T-018, T-019, T-020
- **关联 FR/AC**：FR-22
- **执行步骤**：
  1. `src/adapters/index.ts`：删除 `DependencyGraphOptions` re-export，改为 re-export UnifiedGraph 相关类型
  2. `src/cli/commands/graph.ts`：检查并清理残余 `DependencyGraph` import
  3. `src/knowledge-graph/unified-graph.ts`：更新注释，删除 DependencyGraph shim 方向说明（trivial，不改 schema 字段）
- **完成定义（DoD）**：
  - `npm run build` 零错误
- **验收命令**：
  ```bash
  npm run build
  ```

---

#### T-022：Commit 1（改造 commit）——build + vitest 全量验证
- **类型**：verify
- **优先级**：P0（W1.3 第一步，必须先通过再进入 T-023）
- **估时**：2h
- **依赖**：T-021
- **关联 FR/AC**：FR-26 / AC-7
- **执行步骤**：
  1. `npm run build`——确认零 type error
  2. `npx vitest run`——确认 ≥ 3155 个测试 pass，0 个失败
  3. 若有失败，定位并修复后重复步骤 1-2
  4. 执行 Commit 1（改造 commit，legacy-shim.ts 仍存在）
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `npx vitest run` 零失败
  - Commit 1 已提交（git log 确认）
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  git log --oneline -3
  ```

---

#### T-023：AC-11 baseline 采集（dependency-cruiser 删除前）
- **类型**：verify
- **优先级**：P0（必须在删除 dependency-cruiser 之前执行）
- **估时**：2h
- **依赖**：T-022
- **关联 FR/AC**：AC-11
- **执行步骤**：
  1. 对 `tests/fixtures/ts-import-scenarios/` fixture 执行 dependency-cruiser，记录 4 类 import 的 `depends-on` 边数至 `tests/baseline/_temp/dep-cruiser-baseline.json`（不入库）
  2. 同时对同一 fixture 执行 `buildUnifiedGraph`（经由 import-resolver.ts），验证 `depends-on` 边数每类 ≥ baseline
  3. 验证 `importType` 字段能区分 `static` / `dynamic` / `type-only` / `commonjs-require`（4 类，含 require）
  4. 验证 `isCircular` 通过 SCC 反查正确标记 circular-a/b 之间的边
- **完成定义（DoD）**：
  - `dep-cruiser-baseline.json` 文件存在，含 4 类边数统计（`static`、`dynamic`、`require`、`type-only` 各字段）
  - `buildUnifiedGraph` 产出的边数每类 ≥ baseline
  - 脚本化比较通过（WARN-1 修订）：
    ```bash
    node scripts/baseline/collect-cruiser-edges.mjs --fixture tests/fixtures/ts-import-scenarios > tests/baseline/_temp/dep-cruiser-baseline.json
    node -e "const j = JSON.parse(require('fs').readFileSync('tests/baseline/_temp/dep-cruiser-baseline.json')); if (j.static < 3 || j.dynamic < 1 || j.require < 1 || j['type-only'] < 1) process.exit(1)"
    ```
  - `importType` / `isCircular` 语义验证通过
- **验收命令**：
  ```bash
  node scripts/baseline/collect-cruiser-edges.mjs --fixture tests/fixtures/ts-import-scenarios > tests/baseline/_temp/dep-cruiser-baseline.json
  node -e "const j = JSON.parse(require('fs').readFileSync('tests/baseline/_temp/dep-cruiser-baseline.json')); if (j.static < 3 || j.dynamic < 1 || j.require < 1 || j['type-only'] < 1) { console.error('FAIL: 边数不足', j); process.exit(1); } else { console.log('PASS', j); }"
  ```

---

#### T-024：Commit 2（删除 commit）——删除 legacy-shim + dependency-graph + cruiser
- **类型**：delete
- **优先级**：P0（FR-22 完成关键步骤）
- **估时**：3h
- **依赖**：T-023
- **关联 FR/AC**：FR-22 / AC-5 / AC-6
- **执行步骤**：
  1. 删除 `src/graph/legacy-shim.ts`
  2. 删除 `src/models/dependency-graph.ts`
  3. 删除 `src/graph/dependency-graph.ts`
  4. 从 `package.json` 移除 `dependency-cruiser` 依赖
  5. `npm run build`——修复任何因删除引起的 import 错误
  6. `npx vitest run`——确认零失败
  7. 提交 Commit 2（删除 commit）
- **完成定义（DoD）**：
  - 三个目标文件已从 git 中删除
  - `npm run build` 零错误
  - `npx vitest run` 零失败
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ls src/graph/legacy-shim.ts 2>&1  # 期望: No such file or directory
  ls src/models/dependency-graph.ts 2>&1  # 期望: No such file or directory
  grep "dependency-cruiser" package.json | wc -l  # 期望: 0
  ```

---

#### T-025：W1 出口验证——AC-5 / AC-6 + spectra batch micrograd 冒烟
- **类型**：verify
- **优先级**：P0（W1 里程碑出口）
- **估时**：2h
- **依赖**：T-024
- **关联 FR/AC**：FR-23 / AC-5 / AC-6
- **执行步骤**：
  1. 执行 AC-5 验证（grep DependencyGraph）：
     ```bash
     grep -rn "DependencyGraph" src/ --include="*.ts" \
       | grep -v "^[^:]*:[ \t]*//" \
       | grep -v "^[^:]*:[ \t]*\*" \
       | wc -l
     ```
     结果应 = 0
  2. 执行 AC-6 验证（grep dependency-cruiser）：
     ```bash
     grep "dependency-cruiser" package.json \
       | grep -v "^[ \t]*//" \
       | grep -v "^[ \t]*\*" \
       | wc -l
     ```
     结果应 = 0
  3. 在 micrograd 上执行 `spectra batch`，确认无 type error / runtime error
- **完成定义（DoD）**：
  - AC-5 grep 输出 = 0
  - AC-6 grep 输出 = 0
  - `spectra batch micrograd` 冒烟验证通过
- **验收命令**：
  ```bash
  grep -rn "DependencyGraph" src/ --include="*.ts" | grep -v "^[^:]*:[ \t]*//" | grep -v "^[^:]*:[ \t]*\*" | wc -l
  grep "dependency-cruiser" package.json | grep -v "^[ \t]*//" | grep -v "^[ \t]*\*" | wc -l
  ```

---

### Week 2 — persistence + spectra index 骨架

#### T-026：新建 src/knowledge-graph/persistence.ts
- **类型**：new-module
- **优先级**：P1（W2 核心）
- **估时**：6h
- **依赖**：T-025
- **关联 FR/AC**：FR-1 / FR-2 / FR-3 / FR-4 / FR-5
- **执行步骤**：
  1. 创建 `src/knowledge-graph/persistence.ts`
  2. 定义 `SnapshotWrapperSchema`（Zod）：
     - `schemaVersion: z.literal('1.0')`
     - `generatedAt: z.string().datetime()`
     - `graph: UnifiedGraphSchema`
     - `fileHashes: z.record(z.string(), z.string())`
  3. 实现 `save(snapshot, projectRoot)`：原子写入（`unified-graph.{pid}.tmp` → `rename`，见 plan §2.1）；多进程后写者覆盖
  4. 实现 `load(projectRoot)`：`safeParse` 校验失败返回 null（EC-8 降级）；文件不存在返回 null
  5. 实现 `detectStale(snapshot, files)`：对比 SHA-256 hash，返回 stale 文件集合；不存在的路径标为 `deleted`（EC-9）
  6. 实现 `computeFileHashes(files)`：串行 `for...of` 计算（clarify Q-D4 决议）
  7. `load()` 失败时 stdout 记录 `{ fallbackReason: 'json-parse-error' | 'schema-validation-failed' }`
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - `SnapshotWrapperSchema` 导出，Zod 校验可用
  - 多进程冲突 fixture 验证通过（WARN-2 修订）：启动 2 个进程同时调用 `save`，验证写入完成后 `.spectra/unified-graph.json` 可被 `SnapshotWrapperSchema.safeParse` 成功解析（允许"最后写者胜"语义，但不允许 JSON 损坏）
  - **handoff from W1.0+W1.1 v3（spec v3.2）**：SnapshotWrapper 序列化 / 反序列化路径必须**完整保留 UnifiedEdge.metadata 字段**（含 `importType` 等结构化扩展数据）。当前 `src/panoramic/builders/graph-builder.ts:316-325 / 375-383` 的 graph.json 序列化路径**未透传 edge.metadata**——本 task 实现自建的 `persistence.save / load` 必须直接覆盖此问题（不允许复用 panoramic graph-builder 的丢字段路径）；如未来选择复用 panoramic 序列化路径，必须先在 graph-builder.ts 补 edge.metadata 透传。
- **验收命令**：
  ```bash
  npm run build
  # 多进程冲突验证（T-027 实现后通过 persistence.test.ts P-5 执行）
  ```

---

#### T-027：新建 tests/unit/knowledge-graph/persistence.test.ts（5 条）
- **类型**：write-test
- **优先级**：P1（W2 出口条件之一）
- **估时**：4h
- **依赖**：T-026
- **关联 FR/AC**：FR-24 / AC-8
- **执行步骤**：
  1. 新建 `tests/unit/knowledge-graph/persistence.test.ts`
  2. **P-1**：`save(snapshot)` 后 `load()` 返回等价对象（深比较 `schemaVersion / fileHashes / graph.nodes.length`）
  3. **P-2**：schema roundtrip：`SnapshotWrapperSchema.parse(JSON.parse(JSON.stringify(snapshot)))` 不抛异常
  4. **P-3**：stale 检测——修改文件内容后 `detectStale` 返回该文件（写临时文件，修改后检测）
  5. **P-4**：stale 检测——未变更文件 `detectStale` 不返回（检测结果为空集）
  6. **P-5**（WARN-2 新增）：多进程冲突——模拟 2 个并发 `save` 调用（`Promise.all([save(...), save(...)])`），完成后 `load()` 返回非 null，且 `safeParse` 成功（JSON 未损坏，允许任意一个写入结果）
  7. **P-6**（spec v3.2 W1 handoff 新增）：metadata 透传——构造一条带 `metadata: { importType: 'dynamic' }` 的 UnifiedEdge，`save → load` roundtrip 后 `edge.metadata.importType === 'dynamic'` 不丢失（防御 panoramic graph-builder 序列化路径丢字段缺陷）
- **完成定义（DoD）**：
  - 6 条单测全部 pass
- **验收命令**：
  ```bash
  npx vitest run tests/unit/knowledge-graph/persistence.test.ts
  ```

---

#### T-028：新建 src/cli/commands/index.ts（全量路径骨架）
- **类型**：new-module
- **优先级**：P1（W2 出口条件之一）
- **估时**：4h
- **依赖**：T-026
- **关联 FR/AC**：FR-11 / FR-14 / FR-30
- **执行步骤**：
  1. 创建 `src/cli/commands/index.ts`（注意：文件名 `index.ts` 为 CLI 子命令注册文件，需在主 CLI 入口注册 `spectra index` 命令）
  2. 注册 `spectra index` 子命令（yargs 或项目现有 CLI 框架）
  3. 实现全量路径：全量文件扫描 → `buildUnifiedGraph` → 构建 `SnapshotWrapper` → `save()`
  4. stdout 输出机器可读 JSON（FR-14 SHOULD）：`{ mode: 'full', changedFiles: N, duration: X, snapshotPath: '...' }`
  5. 无变更时输出 `{ changedFiles: 0, skippedReason: 'no-diff' }`（AC-4）
  6. exit 0 成功退出
  7. 在主 CLI 入口文件中注册此子命令
- **完成定义（DoD）**：
  - `spectra index` 命令可执行，exit 0
  - 产出 `.spectra/unified-graph.json`，通过 `SnapshotWrapperSchema` Zod 校验
- **验收命令**：
  ```bash
  npm run build
  # 在 micrograd 目录手动执行
  # spectra index && echo "exit 0"
  ```

---

#### T-029：修改 .gitignore——加入 .spectra/
- **类型**：trivial
- **优先级**：P1（可独立并行）
- **估时**：1h
- **依赖**：无（可与 T-026~T-028 并行）
- **关联 FR/AC**：FR-4
- **执行步骤**：
  1. 在 `.gitignore` 末尾加入 `.spectra/`
- **完成定义（DoD）**：
  - `.gitignore` 已包含 `.spectra/`
  - `git status` 显示 `.spectra/` 内容不被追踪
- **验收命令**：
  ```bash
  grep ".spectra/" .gitignore
  ```

---

#### T-030：W2 出口验证——AC-9 + EC-8 降级路径
- **类型**：verify
- **优先级**：P1（W2 里程碑出口）
- **估时**：3h
- **依赖**：T-028
- **关联 FR/AC**：FR-1 / FR-3 / AC-9
- **执行步骤**：
  1. AC-9 验证：在项目根执行 `spectra index`，检查：
     - exit 0
     - `.spectra/unified-graph.json` 存在
     - 通过 `SnapshotWrapperSchema.safeParse()` 校验
     - 内嵌 `graph` 通过 `UnifiedGraphSchema` 校验
  2. EC-8 降级路径验证：手动损坏 `.spectra/unified-graph.json`（写入无效 JSON），重新运行 `spectra index`，确认自动降级为 full re-index，不报错退出，stdout 含 `fallbackReason`
  3. 评估 self-dogfood snapshot 大小（预期 < 2 MB）
- **完成定义（DoD）**：
  - AC-9 通过
  - EC-8 降级路径验证通过
  - snapshot 大小 < 2 MB（如超过，记录到 PR description）
- **验收命令**：
  ```bash
  npm run build
  spectra index
  echo $?  # 期望: 0
  node -e "const s = require('./src/knowledge-graph/persistence'); s.load('.').then(r => console.log(r ? 'valid' : 'null'))"
  ```

---

### Week 3 — incremental + watch

#### T-031：新建 src/knowledge-graph/incremental.ts
- **类型**：new-module
- **优先级**：P1（W3 核心）
- **估时**：8h
- **依赖**：T-026
- **关联 FR/AC**：FR-6 / FR-7 / FR-8 / FR-9 / FR-10 / FR-29
- **执行步骤**：
  1. 创建 `src/knowledge-graph/incremental.ts`
  2. 实现 `gitDiff(projectRoot, context: 'post-commit' | 'watch') → string[]`：
     - `post-commit`：`git diff --name-only ORIG_HEAD HEAD`（execSync）
     - 失败（EC-10 shallow clone）→ 返回空数组 + stdout 记录 `{ fallbackReason: 'git-diff-failed' }`
  3. 实现 `expandCallers(changedFiles, snapshot, depth=1) → Set<string>`：
     - 遍历 `snapshot.graph.edges`，找出 `target ∈ changedFiles` 的所有 `source` 节点（使用 `node.filePath` 字段反查，见 plan §2.2 mergeIncremental 核心算法）
     - 返回 `changed ∪ callers`
  4. 实现 `mergeIncremental(oldSnapshot, expandedSet, newPartialGraph) → SnapshotWrapper`（见 plan §2.2 完整算法：`findOwningNodes` → 按 `node.filePath` 反查 → 删旧节点+边 → 插入新局部图）
  5. 实现 `buildIncremental(projectRoot, options) → Promise<{mode, changedFiles, duration}>`：主入口，协调 `load → expand → partial build → merge → save`；超时（EC-1）降级为 full re-index
  6. EC-9（rename/delete）：`detectStale` 检测文件不存在 → 标记 `deleted`，从 snapshot 移除对应节点/边/hash
- **完成定义（DoD）**：
  - `npm run build` 零错误
  - incremental.test.ts 4 条单测 pass（T-032 完成后）
- **验收命令**：
  ```bash
  npm run build
  npx vitest run tests/unit/knowledge-graph/incremental.test.ts
  ```

---

#### T-032：新建 tests/unit/knowledge-graph/incremental.test.ts（4 条）
- **类型**：write-test
- **优先级**：P1（W3 出口条件之一）
- **估时**：4h
- **依赖**：T-031
- **关联 FR/AC**：FR-25 / AC-8
- **执行步骤**：
  1. 新建 `tests/unit/knowledge-graph/incremental.test.ts`
  2. **I-1**：`gitDiff` 在 mock `execSync` 返回两行时正确解析为 2 个绝对路径（Set 大小 = 2）
  3. **I-2**：`expandCallers`——changed file 有一个直接 caller 时返回 changed + caller 共 2 个文件（构造 mock snapshot）
  4. **I-3**：`mergeIncremental`——变更文件的旧边被替换为新 partial graph 的边（通过 `node.filePath` 反查，非文件路径直接匹配；对比 merged.graph.edges：旧边消失、新边存在）
  5. **I-4**：`mergeIncremental`——未变更文件的节点和边保持不变（对比 merged.graph.nodes，确认非变更节点 id 相同）
- **完成定义（DoD）**：
  - 4 条单测全部 pass
- **验收命令**：
  ```bash
  npx vitest run tests/unit/knowledge-graph/incremental.test.ts
  ```

---

#### T-033：补全 src/cli/commands/index.ts（--watch + --incremental + --caller-depth）
- **类型**：modify-small-file
- **优先级**：P1（W3.2 核心）
- **估时**：4h
- **依赖**：T-031, T-028
- **关联 FR/AC**：FR-12 / FR-13 / FR-30
- **执行步骤**：
  1. 在 `src/cli/commands/index.ts` 补充 flag 处理：
     - `--watch`：持续监听模式（进程不退出）
     - `--incremental`：一次性增量更新（完成后 exit 0）
     - `--caller-depth N`：默认 1（接口预留，行为固定为深度 1）
     - `--watch` 与 `--incremental` 互斥：同时传入 → 打印错误 + exit 1（FR-30）
  2. `--watch` 模式实现（WARN-1 关闭，见 plan §2.3）：
     ```typescript
     watcher.on('change', (events: FileChangeEvent[]) => {
       const changedPaths = new Set(
         events.filter(e => e.category === 'code').map(e => e.path)
       );
       if (changedPaths.size > 0) {
         buildIncremental(projectRoot, { changedFiles: Array.from(changedPaths) });
       }
     });
     ```
  3. debounce = 200 ms（clarify Q-D1 决议）
  4. 确保 `spectra watch`（现有 batch 增量路径）不受影响（FR-13）
- **完成定义（DoD）**：
  - `spectra index --watch` 启动后监听文件变更并触发 incremental
  - `spectra index --incremental` 完成后 exit 0
  - `spectra watch` 行为不变
  - DoD 验证通过 `npm run verify:f156`（T-037 实现后调用，WARN-5 修订）：三类边 canonical sort + diff = 0
- **验收命令**：
  ```bash
  npm run build
  # watch 触发验证需手动；diff 验证通过 verify:f156 脚本
  npm run verify:f156  # T-037 完成后执行
  ```

---

#### T-034：实现 EC-2 / EC-9 / EC-10 降级路径
- **类型**：modify-small-file
- **优先级**：P1（W3.3，可与 T-033 并行）
- **估时**：4h
- **依赖**：T-031
- **关联 FR/AC**：FR-6 / FR-8
- **执行步骤**：
  1. **EC-2（watch 无 git context）**：`--watch` 模式下直接用 `FileChangeEvent[].path` 作为 `changedFiles`，不调用 `gitDiff`；确认 `buildIncremental` 支持 `changedFiles` 直接传入
  2. **EC-9（rename/delete）**：在 `detectStale` 里检测文件是否存在（`fs.access`）；不存在的路径标记 `deleted`，在 `mergeIncremental` 中移除对应节点/边/hash key
  3. **EC-10（shallow clone）**：`gitDiff` 失败时，`buildIncremental` 切换为 `detectStale` 全量 hash 比对，stdout 记录 `{ fallbackReason: 'git-diff-failed' }`
  4. 补充相应单测（可扩展 `incremental.test.ts`，各场景 1 条，不超过 3 条追加）
- **完成定义（DoD）**：
  - 3 个降级路径均有对应逻辑
  - `npx vitest run` 零失败
- **验收命令**：
  ```bash
  npm run build && npx vitest run
  ```

---

#### T-035：W3 出口验证——self-dogfood incremental < 30 sec；AC-2b / AC-3b
- **类型**：verify
- **优先级**：P1（W3 里程碑出口）
- **估时**：3h
- **依赖**：T-033, T-034
- **关联 FR/AC**：FR-29 / AC-2b / AC-3b
- **执行步骤**：
  1. 在 self-dogfood（本仓库）上执行 full index：`spectra index`
  2. 修改 1 个 .ts 文件
  3. 执行 incremental：`spectra index --incremental`
  4. 计时确认 < 30 秒（macOS M 系列，AC-2b）
  5. 对比 full index 与 incremental 的 `depends-on + calls + cross-module` 边，属于变更文件的边 diff = 0（AC-3b）
  6. 修改 1 个 .mjs 文件（`plugins/spec-driver/scripts/*.mjs`），重复步骤 3-5
- **完成定义（DoD）**：
  - incremental < 30 秒（macOS M 系列）
  - 变更文件的边 diff = 0，通过 `npm run verify:f156` 脚本验证（WARN-5 修订）：canonical sort 后三类边 diff = 0
- **验收命令**：
  ```bash
  time spectra index --incremental
  npm run verify:f156  # T-037 完成后执行
  ```

---

#### T-035a：双 worktree 污染验证——两个 worktree .spectra/ 互不污染（WARN-3 新增）
- **类型**：verify
- **优先级**：P1（W3.4，在 T-035 完成后执行）
- **估时**：2h
- **依赖**：T-035
- **关联 FR/AC**：EC-11（跨 worktree snapshot 共享冲突）
- **执行步骤**：
  1. 在本仓库选择两个已有的 worktree（或临时创建一个 `git worktree add /tmp/wt-152-test`）
  2. 在 worktree A 执行 `spectra index`，记录产出的 `.spectra/unified-graph.json` 路径（期望为 worktree A 根目录下的 `.spectra/`）
  3. 在 worktree B 执行 `spectra index`，记录产出路径
  4. 验证 worktree A 的 `.spectra/unified-graph.json` 与 worktree B 的路径不同（各自独立）
  5. 修改 worktree A 中的一个文件，执行 `spectra index --incremental`，确认 worktree B 的 snapshot 未被修改（hash 比较）
  6. 清理临时 worktree（若创建了的话）
- **完成定义（DoD）**：
  - 两个 worktree 的 `.spectra/unified-graph.json` 路径不同（各在自己的根目录）
  - worktree A 的 incremental 更新不影响 worktree B 的 snapshot
- **验收命令**：
  ```bash
  # worktree A
  cd /path/to/worktree-a && spectra index && echo "A: $(wc -c < .spectra/unified-graph.json) bytes"
  # worktree B
  cd /path/to/worktree-b && spectra index && echo "B: $(wc -c < .spectra/unified-graph.json) bytes"
  # 验证路径隔离
  ls /path/to/worktree-a/.spectra/unified-graph.json
  ls /path/to/worktree-b/.spectra/unified-graph.json
  ```

---

### Week 4 — post-commit hook + verify-script + buffer + 全量验收

#### T-036：新建 plugins/spectra/hooks/post-commit.sh + README 安装说明
- **类型**：new-file
- **优先级**：P2（MAY，可选交付）
- **估时**：3h
- **依赖**：T-033
- **关联 FR/AC**：FR-15 / FR-16
- **执行步骤**：
  1. 创建 `plugins/spectra/hooks/post-commit.sh`（见 plan §2.4）：
     ```bash
     #!/usr/bin/env bash
     set -euo pipefail
     if [ ! -d ".spectra" ]; then exit 0; fi
     npx spectra index --incremental
     ```
  2. 脚本中检测 `.spectra/` 目录：不存在则跳过，不影响未安装的用户（FR-16）
  3. 在 `plugins/spectra/README.md` 或 `docs/` 中说明手动安装步骤：`cp ... .git/hooks/post-commit && chmod +x ...`
  4. 不新增 `--install-hook` CLI 子命令（clarify Q4 决议）
- **完成定义（DoD）**：
  - `post-commit.sh` 文件存在，可执行权限
  - README 含安装说明
- **验收命令**：
  ```bash
  ls -la plugins/spectra/hooks/post-commit.sh
  ```

---

#### T-037：新建 scripts/verify-feature-156.mjs
- **类型**：end-to-end-script
- **优先级**：P1（W4 核心，AC-3a/3b 验证入口）
- **估时**：6h
- **依赖**：T-035a
- **关联 FR/AC**：FR-9 / FR-10 / FR-29 / AC-3a / AC-3b
- **执行步骤**：
  1. 创建 `scripts/verify-feature-156.mjs`
  2. 验证步骤（三个项目：micrograd / nanoGPT / self-dogfood）：
     - 在 baseline project 上执行 full index → snapshot A
     - 修改 1 个文件
     - 执行 incremental index → snapshot B
     - 边比较前执行 canonical sort（WARN-2）：`edges.sort((a,b) => a.relation.localeCompare(b.relation) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target))`
     - 属于变更文件的 `depends-on + calls + cross-module` 边 diff = 0
     - 耗时验证 < 30 秒（`--timeout` 参数支持两种阈值：30000 / 60000 ms，plan §3 B3 约定）
  3. 退出码：全 pass → 0；任意失败 → 1（附失败原因 JSON）
  4. 支持 `--timeout N` 参数（macOS M 系列 30 秒 / CI 60 秒）
- **完成定义（DoD）**：
  - 脚本在 micrograd / nanoGPT / self-dogfood 三个 baseline 全部 pass（exit 0）
- **验收命令**：
  ```bash
  node scripts/verify-feature-156.mjs
  echo $?  # 期望: 0
  ```

---

#### T-038：修改 package.json——加入 npm run verify:f156
- **类型**：trivial
- **优先级**：P2（可独立并行）
- **估时**：1h
- **依赖**：T-037
- **关联 FR/AC**：- （辅助开发体验，非 FR 要求）
- **执行步骤**：
  1. 在 `package.json` scripts 中加入 `"verify:f156": "node scripts/verify-feature-156.mjs"`
  2. 执行 `npm run release:check` 确认发布合同未受影响
- **完成定义（DoD）**：
  - `npm run verify:f156` 可执行
- **验收命令**：
  ```bash
  npm run verify:f156
  ```

---

#### T-039：全量验收——AC-1 / AC-2a / AC-7 / AC-8 / AC-11 + baseline:collect 重测
- **类型**：verify
- **优先级**：P1（W4.3，Feature 156 最终验收）
- **估时**：4h
- **依赖**：T-037
- **关联 FR/AC**：AC-1 / AC-2a / AC-7 / AC-8 / AC-11
- **执行步骤**：
  1. **AC-1**：micrograd 改 1 个 .py 文件，incremental 索引 < 30 秒（10 次均值）
  2. **AC-2a**：micrograd Python incremental < 30 秒
  3. **AC-7**：`npx vitest run` ≥ 3155 个测试 pass，0 个失败
  4. **AC-8**：`npx vitest run tests/unit/knowledge-graph/persistence.test.ts tests/unit/knowledge-graph/incremental.test.ts tests/unit/knowledge-graph/consumer-shim.test.ts` ≥ 13 条 pass（含 T-007 S-4、T-027 P-5 新增用例）
  5. **AC-11**（CRIT-2 修订）：4 类 import fixture 验证，各类边数断言如下：
     - static 边数 ≥ 3，dynamic 边数 ≥ 1，commonjs-require 边数 ≥ 1，type-only 边数 ≥ 1
     - importType 字段能区分 4 类；isCircular 正确标记循环依赖
     - incremental 路径与 full 路径产出等价（通过 `verify-feature-156.mjs` 脚本验证）
     ```bash
     node -e "const j = JSON.parse(require('fs').readFileSync('tests/baseline/_temp/dep-cruiser-baseline.json')); if (j.static < 3 || j.dynamic < 1 || j.require < 1 || j['type-only'] < 1) { console.error('AC-11 FAIL', j); process.exit(1); }"
     ```
  6. **baseline:collect 重测**：`npm run baseline:collect -- --targets self-dogfood,karpathy/micrograd,karpathy/nanoGPT --mode full`；对比旧 fixture，边数差异 < 5%
- **完成定义（DoD）**：
  - 所有 AC 通过
  - baseline:collect 无 perf regression
- **验收命令**：
  ```bash
  npx vitest run
  npx vitest run tests/unit/knowledge-graph/persistence.test.ts tests/unit/knowledge-graph/incremental.test.ts tests/unit/knowledge-graph/consumer-shim.test.ts
  npm run verify:f156
  npm run baseline:collect -- --targets self-dogfood,karpathy/micrograd,karpathy/nanoGPT --mode full
  ```

---

#### T-040：Buffer——回归修复 + Codex 对抗审查 + 代码 review
- **类型**：buffer
- **优先级**：P1（W4.4）
- **估时**：8h（预留）
- **依赖**：T-039
- **关联 FR/AC**：FR-26 / AC-7
- **执行步骤**：
  1. 修复 T-039 发现的任何遗留问题
  2. 启动 Codex 对抗审查（`codex:codex-rescue` 子代理），对本 Feature 所有改动执行对抗性 review
  3. 处理 Codex CRITICAL / WARNING 发现（真实 bug → 修复 + 重测；风格偏好 → 记录）
  4. 确认 `npm run build` + `npx vitest run` + `npm run repo:check` + `npm run release:check` 全部零失败
  5. 版本号 minor bump：更新 `contracts/release-contract.yaml`，运行 `npm run release:sync`
- **完成定义（DoD）**：
  - 无 CRITICAL issue
  - 4 个 check 命令全部零失败
  - 版本号已 minor bump，release contract 已同步
- **验收命令**：
  ```bash
  npm run build && npx vitest run && npm run repo:check && npm run release:check
  ```

---

## 关键路径（Critical Path）

```
T-001 ──→ T-003 ──→ T-004 ──→ T-006 ──→ T-013a ──→ T-013b ──→ T-013c ──→ T-014~T-020（可并行）
                  ──→ T-005 ──→ T-006 ↗                                          ↓
T-002 ─────────────────────────────────────────────────────────────────────→  T-021 ──→ T-022 ──→ T-023 ──→ T-024 ──→ T-025
T-012 ──→ T-012b ─────────────────────────────────────────────────────────────────↗
                                                                                              ↓
                                                                                            T-026 ──→ T-027
                                                                                              ↓
                                                                                            T-028 ──→ T-030
                                                                                              ↓
                                                                                            T-031 ──→ T-032
                                                                                              ↓
                                                                                            T-033 ──→ T-035 ──→ T-035a
                                                                                              ↓
                                                                                            T-037 ──→ T-039 ──→ T-040
```

**关键路径长度**：~20 个串行节点（T-001 → T-003 → T-004 → T-006 → T-013a → T-013b → T-013c → T-021 → T-022 → T-023 → T-024 → T-025 → T-026 → T-028 → T-031 → T-033 → T-035 → T-035a → T-037 → T-039 → T-040）

---

## 任务并行机会

- **T-001 + T-002**：无依赖，可并行（前置清理 + fixture 准备）
- **T-004 + T-005**：均依赖 T-003，但修改不同文件，可并行
- **T-008 ~ T-012**：均依赖 T-006，但修改不同文件（5 个 rewrite），可同步并行
- **T-013a → T-013b → T-013c**：串行（CRIT-3 拆分后，T-013b 依赖 T-013a，T-013c 依赖 T-013b）
- **T-014 ~ T-020**：均依赖 T-013c，但修改不同文件（7 个 shape-map），可全部并行
- **T-012b**：依赖 T-012，可与 T-013a（不同文件）并行
- **T-026 + T-029**：T-029（.gitignore）无依赖，可与 T-026 并行
- **T-027 + T-028**：均依赖 T-026，修改不同文件，可并行
- **T-033 + T-034**：T-034 依赖 T-031，T-033 依赖 T-031 + T-028，两者修改不同逻辑，完成 T-031 后可并行
- **T-036 + T-037**：T-036（post-commit hook）可与 T-037（verify 脚本）准备阶段并行（依赖相同前驱 T-033/T-035）
- **T-038**：依赖 T-037，但改动极小，T-037 完成后 < 1h

**并行机会总数**：8 组（W1 内并行机会最多，减少 W1 关键路径约 20-30%）

---

## FR ↔ Task trace 表

| FR | 关联 Task | AC |
|----|----------|----|
| FR-1（snapshot 产出 + Zod 校验） | T-026, T-028 | AC-9 |
| FR-2（fileHashes 存于 SnapshotWrapper，不修改 UnifiedGraph schema） | T-026 | AC-9 |
| FR-3（stale 检测，未变更复用） | T-026, T-031 | AC-4, AC-9 |
| FR-4（.spectra/ 加入 .gitignore） | T-029 | - |
| FR-5（原子写入） | T-026 | - |
| FR-6（git diff 提取变更文件 + watch 文件系统事件路径） | T-031, T-034 | - |
| FR-7（incremental 扩展深度 1 reverse callers） | T-031 | AC-3a, AC-3b |
| FR-8（合并后更新 hash，未变更不修改） | T-031 | AC-4 |
| FR-9（micrograd < 30 sec） | T-037, T-039 | AC-1, AC-2a |
| FR-10（nanoGPT < 30 sec） | T-037, T-039 | AC-1 |
| FR-11（spectra index 全量，exit 0） | T-028 | AC-9 |
| FR-12（spectra index --watch 持续监听） | T-033 | AC-10 |
| FR-13（--watch 与 spectra watch 独立不干扰） | T-033 | AC-10 |
| FR-14（进度 JSON 输出，SHOULD） | T-028, T-033 | AC-4 |
| FR-15（post-commit.sh，MAY） | T-036 | - |
| FR-16（hook 安装可选非破坏性，MAY） | T-036 | - |
| FR-17（batch-orchestrator buildUnifiedGraph 路径） | T-013a, T-013b, T-013c | - |
| FR-18（topological-sort 接受 UnifiedGraph 子图） | T-006, T-014 | - |
| FR-19（mermaid-renderer 接受 UnifiedGraph） | T-015 | - |
| FR-20（ts-js-adapter / python-adapter / directory-graph 改为 UnifiedGraph 派生） | T-008, T-009, T-010, T-011 | - |
| FR-21（doc-graph-builder / cross-package-analyzer / index-generator / delta-regenerator / module-grouper / language-adapter 入参更新） | T-012, T-012b, T-016, T-017, T-018, T-019, T-020 | - |
| FR-22（删除 dependency-graph.ts + models/dependency-graph.ts + dependency-cruiser） | T-021, T-024, T-025 | AC-5, AC-6 |
| FR-23（grep DependencyGraph = 0） | T-025 | AC-5 |
| FR-24（persistence.test.ts ≥ 4 条） | T-027 | AC-8 |
| FR-25（incremental.test.ts ≥ 4 条） | T-032 | AC-8 |
| FR-26（全量 3155 单测 pass） | T-022, T-039 | AC-7 |
| FR-27（atomic switch，禁止临时双 API public export） | T-006, T-013a, T-013b, T-022, T-024 | - |
| FR-28（import-resolver.ts 接管 depends-on 边，填充 resolvedPath；4 类含 require） | T-001, T-002, T-003, T-004, T-005 | AC-11 |
| FR-29（self-dogfood incremental < 30 sec） | T-035, T-037, T-039 | AC-2b |
| FR-30（--incremental flag 一次性单次运行，与 --watch 互斥） | T-028, T-033 | AC-9 |
| FR-31（派生 helper 从当次输入派生，禁止 getCurrentUnifiedGraph() 全局 cache） | T-006, T-013a, T-013c | - |
| FR-32（consumer-shim.test.ts ≥ 4 条） | T-007 | AC-8 |

---

## AC ↔ Task trace 表

| AC | 验证 Task |
|----|----------|
| AC-1（micrograd incremental < 30 sec，10 次均值） | T-039 |
| AC-2a（micrograd Python incremental < 30 sec） | T-039 |
| AC-2b（self-dogfood .ts/.mjs incremental < 30 sec） | T-035, T-039 |
| AC-3a（micrograd full vs incremental 边 diff = 0） | T-037, T-039 |
| AC-3b（self-dogfood full vs incremental 边 diff = 0） | T-035, T-037, T-039 |
| AC-4（第二次运行 changedFiles=0，jq 可读） | T-028, T-030 |
| AC-5（grep DependencyGraph src/ = 0） | T-025 |
| AC-6（grep dependency-cruiser package.json = 0） | T-025 |
| AC-7（vitest run ≥ 3155 pass，0 失败） | T-022, T-039, T-040 |
| AC-8（persistence + incremental + consumer-shim ≥ 13 条 pass） | T-007, T-027, T-032 |
| AC-9（spectra index exit 0，snapshot Zod 校验通过） | T-028, T-030 |
| AC-10（--watch 监听触发 incremental；spectra watch 不受影响） | T-033 |
| AC-11（4 类 import fixture：static/dynamic/require/type-only；importType/isCircular 语义；各类边数断言；incremental 路径等价） | T-002, T-003, T-004, T-023, T-039 |
| EC-11（跨 worktree snapshot 不污染） | T-035a |

---

## 风险 / 阻断（task 粒度缓解）

### 风险 A（HIGH）：batch-orchestrator rewrite（T-013a/b/c）
- **如果 T-013a 当天超时或出现未知 type error**：
  - 回退策略：仅改 adapter 层（T-010/T-011/T-012 先完成），orchestrator rewrite 推至 T-021 前半段
  - 回滚预案：`git revert T-013a` commit，保留 legacy-shim.ts 继续诊断
  - 拆分触发条件（来自 spec §9）：若 W1 末 `grep DependencyGraph src/ | wc -l` > 0，暂停 T-026~T-040 的 incremental 工作，本 Feature 仅交付 DependencyGraph shim（FR-17~FR-32）
- **T-013 拆分（CRIT-3）**：三步串行（T-013a → T-013b → T-013c），任一步 build 失败立即停止，不进入下一步

### 风险 B（MEDIUM）：topological-sort + detectSCCs 语义等价（T-014）
- **如果 T-014 inDegree/outDegree 重算与原 DependencyGraph 路径结果不一致**：
  - consumer-shim.test.ts S-2 单测会捕获偏差
  - 修复方式：检查过滤条件（`kind !== 'module'` 节点是否混入 symbol 节点），确认边过滤逻辑严格使用 `relation === 'depends-on'`（EC-5 边界）

### 风险 C（MEDIUM）：caller expansion 边界（T-031 / T-037）
- **如果 verify-feature-156.mjs 的 full vs incremental 边 diff ≠ 0**：
  - 脚本打印具体缺失边，提示用户降级为 full re-index
  - 临时缓解：`--caller-depth 0`（仅索引变更文件本身，不扩展）
  - 后续 Feature 可扩展 `--caller-depth 2`（接口 T-033 已预留）

### 风险 D（LOW）：snapshot 文件大小（T-030 验证）
- **如果 T-030 实测 snapshot > 2 MB**：
  - 评估是否改为 minified JSON（stringify 无空格）
  - 如超过 5 MB：persistence.ts 已有 `sizeMB > 5` 警告日志，记录到 PR description 等待后续 Feature 优化

---

## 实施建议

1. **MVP 范围**：W1（T-001~T-025）是 Feature 156 的 DependencyGraph Shim 最小交付范围，可独立 merge 并让 baseline:collect 验证无 regression
2. **实施顺序**：严格按 W1.0 → W1.1 → W1.2a/W1.2b（可并行）→ W1.3 顺序，每步 build + vitest 零失败后才进入下一步（CLAUDE.md 提交前验证约定）
3. **并行策略**：T-008~T-012 和 T-014~T-020 可由多名开发者并行完成；T-013a/b/c 串行，建议分配给最熟悉 batch-orchestrator 代码的成员
4. **每次 commit 前**：按 CLAUDE.local.md 约定运行 Codex 对抗审查（`codex:codex-rescue`）；W1/W2/W3/W4 每个 milestone 各跑一次 phase-level review
