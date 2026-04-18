# 问题修复报告

## 问题描述

通过三工具横向对比（Spectra vs Graphify vs LLM Agent）分析 graphify 示例项目时，发现 Spectra batch 输出存在 5 个质量问题：

1. **P0** `dist/` 过期 6 天 — MCP server 运行 Apr 13 构建的旧版本，含已修复的 GitHub issue 爬取逻辑
2. **P1** `collectLocalDesignDocs` 正则过严 — `architecture.md`/`notes.md` 被排除
3. **P2** 模块 spec 语义节为空 — `api.spec.md` 等 ## 1. 意图 / ## 2. 业务逻辑 节内容为空
4. **P3** `graph.json` 无代码级边 — Python 项目显示 "5 nodes | 0 edges"
5. **P5** README 模块规范计数错误 — 显示 "1 个模块规范" 实际有 5 个 spec 文件

---

## 5-Why 根因追溯

### P0: dist 过期（6天）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | dist 为什么过期？ | `dist/` 最后构建 Apr 13，`src/` 更新至 Apr 18（Fix 116/118/125 已合入） |
| Why 2 | 为什么没有触发重建？ | 依赖手工 `npm run build`，无 CI 门控 |
| Why 3 | 旧 dist 有什么影响？ | `dist/.../product-ux-docs.js:396` 仍含 `spawnSync('gh', args)`（已被 Fix 116 移除） |
| Why 4 | 为什么 MCP 运行旧版本？ | Volta 管理的 `spectra-cli@3.0.1` 指向 `dist/`，不跟随 src |
| Why 5 | 为什么未被检测到？ | 无 dist vs src 差异检测机制，无自动化构建保障 |

**Root Cause**: 手工构建 + 无 dist 过期检测，MCP server 长期运行 6 天前的旧版本

---

### P1: collectLocalDesignDocs 正则过严

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为什么 architecture.md / notes.md 未被收集？ | `isDesignLike` 正则仅匹配 `design\|product\|roadmap\|journey\|ux\|persona\|brief` |
| Why 2 | 为什么正则未包含这些词？ | 原实现者假设只有"design-tagged"文档才有价值 |
| Why 3 | 这些文件有什么信息价值？ | graphify 的 `architecture.md` 记录 4 阶段 pipeline，`notes.md` 记录关键设计决策 |
| Why 4 | 为什么小项目特别受影响？ | 小项目常以 `architecture.md`/`notes.md` 为主要设计文档 |
| Why 5 | 为什么未被测试覆盖？ | 无针对此场景的回归测试 |

**Root Cause**: `collectLocalDesignDocs` 词表覆盖不足，漏掉了常见架构文档命名约定  
**Root Cause Chain**: 小项目无 design/ 目录 → isDesignLike 正则未匹配 architecture.md/notes.md → design-doc corpus 为空 → product-overview 无 design-doc 事实源 → LLM 只能推断

---

### P2: 模块 spec 语义节为空

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为什么意图/业务逻辑节为空？ | LLM 被调用但返回空内容（无 "推断: LLM 不可用" 占位符）或解析失败 |
| Why 2 | 为什么 LLM 对简单模块返回空内容？ | LLM context 缺少模块级 docstring（"API module - exposes the document pipeline"） |
| Why 3 | 为什么模块级 docstring 未进入 context？ | `CodeSkeleton` schema 无 `moduleDoc` 字段，`context-assembler.ts` 无法注入 |
| Why 4 | 为什么 python-mapper.ts 未提取模块级 docstring？ | 仅实现了函数/类级别的 `extractPythonDocstring`，未处理根节点 module docstring |
| Why 5 | 为什么未检测到？ | 生成的 spec 外观"完整"（有接口表），空节不容易被肉眼发现 |

**Root Cause**: `CodeSkeleton` 缺失 `moduleDoc` 字段，Python 模块级 docstring 无法流入 LLM context  
**Root Cause Chain**: api.py 有模块 docstring → python-mapper 未提取 → CodeSkeleton.moduleDoc 为 null → context-assembler 无法注入 → LLM 缺少最关键的意图描述信号 → 意图/业务逻辑节为空

---

### P3: graph.json 无代码级边

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为什么 graph.json 显示 0 边？ | `buildKnowledgeGraph` 的 `docGraph.references = []`，`extractionResults = undefined` |
| Why 2 | 为什么 docGraph.references 为空？ | `buildReferenceList` 遍历 `dependencyGraph.edges`，但 edges 数组为空 |
| Why 3 | 为什么 dependencyGraph.edges 为空？ | `buildFallbackGraph` 创建的骨架 `imports: []` 全为空，dependency-cruiser 不支持 Python |
| Why 4 | 为什么走 fallback 路径？ | Python adapter 未实现 `buildDependencyGraph` 方法，`buildGraphForLanguageGroup` 回落到 fallback |
| Why 5 | 为什么未检测到？ | 无针对非 TS/JS 项目的 graph edge 生成回归测试 |

**Root Cause**: Python adapter 缺少 `buildDependencyGraph` 实现，fallback 路径创建空 imports 骨架  
**Root Cause Chain**: Python adapter 无 buildDependencyGraph → buildFallbackGraph → 空 imports 骨架 → DependencyGraph.edges=[] → buildReferenceList 返回[] → docGraph.references=[] → graph.json 0 边

---

### P5: README 模块规范计数错误

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为什么 README 显示 "1 个模块规范"？ | `generateBatchReadme({ moduleSpecs: successful })` 中 `successful` 只有 1 个根组名 |
| Why 2 | 为什么 successful 只有 1 条？ | 所有 5 个 Python 文件属于同一根模块组，成功后只 push 一次 `moduleName` |
| Why 3 | 为什么用 successful 而非实际文件数？ | README 生成器调用传入了 `successful`（处理组名列表），而非 `collectedModuleSpecs`（实际 spec 对象） |
| Why 4 | 为什么计数错误被忽略？ | 根模块组下的文件被单独生成 spec，但计数逻辑未跟随 |
| Why 5 | 为什么未被测试覆盖？ | 无针对根模块组多文件场景的 README 计数测试 |

**Root Cause**: `batch-orchestrator.ts` 传递 `successful`（组名）给 `generateBatchReadme`，而非实际生成的 spec 文件名  
**Root Cause Chain**: 5个Python文件 → 1个根模块组 → successful.length=1 → README count=1 但实际5个spec文件

---

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/panoramic/pipelines/product-ux-docs.ts` | L490-491 | isDesignLike 正则过窄 | 扩展词表 |
| `src/models/code-skeleton.ts` | L116-127 | CodeSkeleton 无 moduleDoc 字段 | 添加 optional `moduleDoc` 字段 |
| `src/core/query-mappers/python-mapper.ts` | PythonMapper | 无模块级 docstring 提取 | 实现 `extractModuleDoc()` |
| `src/core/context-assembler.ts` | formatSkeleton | 未注入 moduleDoc | 在文件信息区块追加 moduleDoc |
| `src/core/ast-analyzer.ts` | buildSkeleton | 未传递 moduleDoc | 从 mapper 读取并设置 |
| `src/adapters/python-adapter.ts` | PythonAdapter | 无 `buildDependencyGraph` | 实现基于 AST 的 Python 依赖图构建 |
| `src/batch/batch-orchestrator.ts` | L790 | `moduleSpecs: successful` 传参错误 | 改用 `collectedModuleSpecs` 推导名称 |

### 同步更新清单

- **dist 重建**: 修复后执行 `npm run build`（P0）
- **测试**: 为 P1/P2/P3/P5 各新增或更新单元测试

---

## 修复策略

### 方案 A（推荐）: 逐项精确修复 + 重建 dist

按 P5 → P1 → P2 → P3 → P0 顺序：

1. **P5**: `batch-orchestrator.ts` L790 — 将 `moduleSpecs: successful` 改为 `moduleSpecs: collectedModuleSpecs.map(s => path.basename(s.outputPath, '.spec.md'))`
2. **P1**: `product-ux-docs.ts` L490 — 扩展正则：增加 `architecture|arch|notes|overview|guide|system|model|diagram`
3. **P2**: 4 文件联动 — `code-skeleton.ts` + `python-mapper.ts` + `context-assembler.ts` + `ast-analyzer.ts`
4. **P3**: `python-adapter.ts` — 实现 `buildDependencyGraph`，用 tree-sitter AST 提取 Python 相对 import 并解析为本地文件路径
5. **P0**: `npm run build` 重建 dist

### 方案 B（备选）: 跳过 P2/P3，仅修 P5/P1/P0

如果 P2/P3 范围超出预期，可先修最直接影响 README 和 design-doc 收集的问题，P2/P3 留后续 feature 处理。

---

## Spec 影响

- 无需更新现有 spec 文件（P0-P5 均为实现层 bug，非规格变更）
