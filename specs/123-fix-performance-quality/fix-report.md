# Fix Report — 性能与质量 5 项修复

## 修复概述

| ID | 级别 | 文件 | 问题摘要 | 状态 |
|----|------|------|----------|------|
| M2 | MEDIUM | `src/panoramic/cross-reference-index.ts` | `alreadyCovered` O(n) 内循环 | 已修复 |
| M4 | MEDIUM | `src/graph/directory-graph.ts` | `resolveAbsoluteImportPath` O(n×imports) 线性扫描 | 已修复 |
| L3 | LOW | `src/panoramic/generators/data-model-generator.ts` | `rawDefault` 不清理尾部注释 | 已修复 |
| L4 | LOW | `src/core/query-mappers/python-mapper.ts` | `extractPythonDocstring` 不处理带前缀的三引号 | 已修复 |
| L5 | LOW | `src/core/single-spec-orchestrator.ts` | enrichment 调用不传 `modelOverride` | 已修复 |

---

## M2 — `alreadyCovered` O(n) 内循环

**文件**：`src/panoramic/cross-reference-index.ts`

**修复方案**：在 `supplementCrossModuleFromSkeletonImports()` 入口，一次性将 `docGraph.references` 中所有 `cross-module` 引用转为 `Set<string>`（key 为 `${fromSpecPath}:${toSpecPath}`），内层检查由 `.some()` 遍历替换为 `Set.has()` O(1) 查找。

**复杂度改进**：O(specs × imports × references) → O(references + specs × imports)

---

## M4 — `resolveAbsoluteImportPath` O(n×imports) 线性扫描

**文件**：`src/graph/directory-graph.ts`

**修复方案**：在 `buildDirectoryGraph()` 构建 `fileSet` 之后，预构建目录前缀索引 `Map<string, string[]>`（dirPrefix → 该目录下的文件列表）。`resolveAbsoluteImportPath` 新增可选参数 `dirPrefixIndex`，存在时使用索引做 O(1) 查找（候选文件列表显著缩小），不存在时回退为原来的全量扫描（向后兼容）。

**复杂度改进**：1000 文件 × 20 imports 时，目录扫描从 20,000 次遍历降到对候选集的直接查询。

---

## L3 — `rawDefault` 不清理尾部注释

**文件**：`src/panoramic/generators/data-model-generator.ts`

**修复方案**：在非 Pydantic-Field 分支中，对 `rawDefault` 同样调用已有的 `stripPythonInlineComment()` 函数，使 `timeout: int = 30  # seconds` 的 `defaultValue` 输出为 `30` 而非 `30  # seconds`。同步更新对应测试的期望值。

---

## L4 — `extractPythonDocstring` 不处理带前缀的三引号

**文件**：`src/core/query-mappers/python-mapper.ts`

**修复方案**：在剥引号前先用 `raw.replace(/^[rRuUbBfF]+/, '')` 去掉合法的字符串前缀（`r`/`u`/`b`/`f` 及其大写和组合形式），确保 `r"""..."""`、`u"""..."""` 等格式能被正确解析为 docstring。

---

## L5 — enrichment 调用不传 `modelOverride`

**文件**：`src/core/single-spec-orchestrator.ts`

**修复方案**：在 Section 2 二次生成的 `callLLM()` 调用中，补充 `...(options.modelOverride ? { model: options.modelOverride } : {})` 参数，与第一次 LLM 调用保持一致，避免同一次 spec 生成前后落到不同模型。

---

## 验证结果

- 命令：`npm run build`
- 退出码：0
- 输出摘要：TypeScript 编译零错误，prebuild 脚本跳过（d3-force 内容无变化）

- 命令：`npx vitest run tests/panoramic/cross-reference-index.test.ts`
- 退出码：0
- 输出摘要：3 tests passed

- 命令：`npx vitest run tests/unit/directory-graph.test.ts`
- 退出码：0
- 输出摘要：13 tests passed

- 命令：`npx vitest run tests/panoramic/data-model-generator.test.ts`
- 退出码：0
- 输出摘要：48 tests passed（含修正期望值的回归测试）

- 命令：`npx vitest run`（全量）
- 退出码：1（1 个偶发性能超时）
- 输出摘要：1578 passed，1 failed（`community-analysis.test.ts` 5000 节点性能测试在全量并发时超时 12.8s，单独运行稳定通过 4.5s < 5s 阈值，与本次修复无关）
