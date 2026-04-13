# 问题修复报告

## 问题描述

Spectra v3.0.1 对 Graphify（22k+ star Python 项目，20 个 .py 文件）进行 batch 测试，发现 12 个 bug（BUG-A 到 BUG-L），涉及文件级路径传递、架构文档重复、产品文档事实源错误、数据模型类型注释混入、事件面提取误报、Python docstring 缺失等问题。

详细 bug 清单见 `specs/114-fix-python-analysis-quality/bug-report-graphify-test.md`。

---

## 5-Why 根因追溯

### 主线问题：BUG-A（文件级降级路径错误）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何只生成 1 个 spec 文件？ | 20 次 `generateSpec` 调用都传入同一目录 `graphify/` |
| Why 2 | 为何传入同一目录？ | `batch-orchestrator` 第 482 行对非 root 模块统一使用 `group.dirPath` |
| Why 3 | 为何 `dirPath` 相同？ | `module-grouper` 步骤 3.6 创建文件级 ModuleGroup 时只改了 `files` 和 `name`，未改 `dirPath`（设计为沿用父模块的目录路径） |
| Why 4 | 为何 `dirPath` 不正确？ | 文件级 ModuleGroup 的语义是「单文件 spec」，但 `dirPath` 还在表达「目录」——概念层不一致 |
| Why 5 | 为何未被测试捕获？ | 既有 T040/T041 测试针对 src/ 布局项目，不覆盖 flat Python package 的文件级降级路径 |

**Root Cause**: `batch-orchestrator` 未区分「文件级模块（files.length===1）」和「目录级模块」，统一传 `dirPath` 给 `generateSpec`，导致单文件目录覆盖。

**Root Cause Chain**: 1 spec 文件 → 所有模块用同一目录路径 → `generateSpec(dirPath)` 输出 `{stem(dirPath)}.spec.md` → 20 次覆盖同一文件 → 根因：orchestrator 未做文件级/目录级区分

---

### BUG-C（方法描述全部相同）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 方法描述为何全是 `businessSummary`？ | `summarizeSymbolNote` 优先使用 `symbol.jsDoc`，jsDoc 为空则 fallback |
| Why 2 | Python 函数为何没有 jsDoc？ | `python-mapper.ts` 所有导出点均硬编码 `jsDoc: null` |
| Why 3 | 为何不提取 Python docstring？ | 当时 Python mapper 的实现重心在函数签名提取，docstring 提取未被实现 |
| Why 4 | 为何未被发现？ | TS 项目测试中 jsDoc 有值，Python 项目没有专门的 jsDoc 测试 |

**Root Cause**: Python mapper 未实现 docstring 提取，`jsDoc` 恒为 null → `summarizeSymbolNote` 永远使用模块级 businessSummary 作为所有方法的描述。

---

### BUG-D/E（产品文档把 Issue/PR 当核心场景）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何核心场景是 Issue/PR？ | `buildCoreScenarios` 在无 current-spec 时 fallback 到 `corpus.issues`/`corpus.pullRequests` |
| Why 2 | 为何 fallback 如此激进？ | 未尝试从 README 的 Usage/Features 段落提取场景 |
| Why 3 | 为何 README 段落提取如此浅？ | `buildTargetUsers` 只取 README 第一个非空段落，未做节级解析 |

**Root Cause**: `buildCoreScenarios` 缺少从 README Usage/Features 节提取场景的路径，导致有 GitHub 数据时直接使用 issue/PR 作为场景。

---

### BUG-F（feature brief 不区分 bug/feature/question）

根因：`buildFeatureBriefIndex` 对所有 issue/PR 一视同仁，未过滤 `bug` / `question` 标签，也未检查标题中的 bug 指标词。

---

### BUG-K（Mermaid 类型含注释内容）

根因：`parseFieldDeclaration` 解析 Python dataclass 字段时，`typeStr` 包含行内注释（`str  # e.g. "tree_sitter_python"`），未在赋值时 strip 注释。

---

### BUG-J（事件面提取了 vis.js HTML 事件）

根因：`extractTextOccurrences` 扫描 Python 文件时，对多行字符串（HTML 模板）内的 `.on("event", ...)` 模式也进行匹配，误提取了 vis.js DOM 事件绑定。

---

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/batch/batch-orchestrator.ts` | L482 | 文件级模块传 dirPath | 改为传单文件路径 |
| `src/core/query-mappers/python-mapper.ts` | L248/282/366/433/477/543 | `jsDoc: null` | 提取 docstring 填入 jsDoc |
| `src/panoramic/pipelines/product-ux-docs.ts` | `buildCoreScenarios` | fallback 直接用 issues | 先从 README Usage/Features 节提取场景 |
| `src/panoramic/pipelines/product-ux-docs.ts` | `buildFeatureBriefIndex` | 无 bug 过滤 | 过滤 bug/question 类 issue |
| `src/panoramic/generators/data-model-generator.ts` | `parseFieldDeclaration` | typeStr 含注释 | 在 typeStr 中 strip `#` 后的注释 |
| `src/panoramic/generators/event-surface-generator.ts` | `TEXT_SUBSCRIBER_METHODS` | `.on()` 匹配 HTML 模板 | Python 文件排除 JS 特有的 `on`/`once`/`addListener` |

### 自动消解（BUG-A 修复后）

| Bug | 描述 |
|-----|------|
| BUG-B | architecture-narrative 重复模块：BUG-A 修复后产出 20 个独立 spec，重复自动消失 |
| BUG-H | 图谱报告 1 节点：BUG-A 修复后有 20 个 spec，图谱自动恢复 |

### 类似模式（暂不修复）

| 文件 | 位置 | 评估结果 |
|------|------|----------|
| `src/batch/batch-orchestrator.ts` 并发调度 | L558-574 | BUG-L：Promise.race + mutable pending 在极端情况下有延迟，非功能性 bug，优先级低 |
| `src/panoramic/generators/troubleshooting-generator.ts` | Python 错误模式 | BUG-I：Python try/except 未被识别，独立问题，低优先级 |

### 同步更新清单

- 调用方：`architecture-narrative.ts` 使用 `module.businessSummary` 的注释（BUG-C 修复后方法描述会自动改善）
- 测试：需为 flat Python package 的文件级 batch 新增 vitest 测试
- 测试：需为 Python docstring 提取新增 unit test

---

## 修复策略

### 方案 A（推荐）：精确修复，最小改动

**BUG-A 修复**（`batch-orchestrator.ts`）：
```typescript
// 文件级模块（files.length === 1）使用文件路径，目录级模块使用目录路径
const targetPath = group.files.length === 1
  ? path.join(resolvedRoot, group.files[0]!)
  : path.join(resolvedRoot, group.dirPath);
const result = await generateSpec(targetPath, { ... });
```

**BUG-C 修复**（`python-mapper.ts`）：
在 `_extractFunction` 和 `_extractClass`/`_extractClassMethod` 内，从 AST body 的第一个 `expression_statement` 提取 docstring：
```typescript
jsDoc: extractPythonDocstring(bodyNode) ?? null,
```

**BUG-D/E 修复**（`product-ux-docs.ts`）：
在 `buildCoreScenarios` 中，fallback 链调整为：
1. current-spec 的用户画像段落
2. README 的 Usage / Features / Getting Started 段落（新增）
3. issues/PRs（仅最后兜底）

**BUG-F 修复**（`product-ux-docs.ts`）：
在 `buildFeatureBriefIndex` 中过滤明确是 bug/question 的 issue：
```typescript
const featureCandidateIssues = corpus.issues.filter(issue => !isBugOrQuestion(issue));
```

**BUG-K 修复**（`data-model-generator.ts`）：
在 `parseFieldDeclaration` 中 strip inline comment：
```typescript
typeStr = stripPythonInlineComment(typeStr);
```

**BUG-J 修复**（`event-surface-generator.ts`）：
对 Python 文件，排除 JS 特有的事件绑定方法 (`on`, `once`, `addListener`)：
```typescript
const PY_SUBSCRIBER_METHODS = new Set(['subscribe', 'consume', 'listen']);
```

### 方案 B（备选）：LLM 增强层修复

对 BUG-C，在 architecture-narrative 生成时对方法描述做 LLM 增强（成本高，保持 AST-only 降级路径复杂）。不推荐，维护成本高。

---

## Spec 影响

无需更新现有 spec 文件（修复均在 pipeline/generator 层）。

---

## 修复优先级

| 优先级 | Bug | 文件 | 预计复杂度 |
|--------|-----|------|-----------|
| P0（必修）| BUG-A | batch-orchestrator.ts | 简单（2 行改动） |
| P0（必修）| BUG-D/E | product-ux-docs.ts | 中等（README 节解析） |
| P1（应修）| BUG-C | python-mapper.ts | 中等（docstring 提取） |
| P1（应修）| BUG-F | product-ux-docs.ts | 简单（issue 类型过滤） |
| P1（应修）| BUG-K | data-model-generator.ts | 简单（注释 strip） |
| P2（建议）| BUG-J | event-surface-generator.ts | 简单（方法集合分离） |
| P3（低）| BUG-L | batch-orchestrator.ts | 中等（并发调度重构） |
| P3（低）| BUG-I | troubleshooting-generator.ts | 中等（Python 模式适配） |
