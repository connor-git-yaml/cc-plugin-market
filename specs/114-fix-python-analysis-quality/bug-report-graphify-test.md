# Spectra v3.0.1 Graphify 测试 — Bug 汇总

> 审查日期: 2026-04-13
> 测试目标: Graphify（22k+ star Python 项目，20 个 .py 文件）
> 测试命令: `spectra batch --force --languages python --concurrency 5`

---

## BUG-A: 文件级降级后 generateSpec 路径错误（严重）

**影响**: modules/ 下只生成 1 个 graphify.spec.md，20 个模块共享同一个 dirPath
**现象**: batch 输出 "聚合为 20 个模块"、"成功: 20"，但实际只产出 1 个 spec 文件
**根因**: 文件级降级创建的 ModuleGroup 中 `dirPath` 仍指向共享目录 `graphify/`，
batch-orchestrator 传 `fullDirPath` 给 `generateSpec`，20 个模块都指向同一个目录，
后续调用覆盖前面的输出
**修复方向**: 文件级模块应传单文件路径给 generateSpec，而非目录路径
**所在文件**: `src/batch/batch-orchestrator.ts` 第 482 行

---

## BUG-B: architecture-narrative 同一模块重复 3 次（严重）

**影响**: "关键模块"段落中 `graphify` 出现 3 次，内容完全相同
**现象**:
```
关键职责主要集中在 `graphify`、`graphify`、`graphify` 等模块。
```
3 个 "关键模块" 段落列出相同的 20 个文件、相同的 10 个方法
**根因**: 3 个 stored-module-spec 都源自同一个 graphify.spec.md（BUG-A 的连锁效应），
architecture-narrative 生成器将 3 个 spec 视为 3 个独立模块
**所在文件**: `src/panoramic/generators/architecture-narrative-generator.ts`

---

## BUG-C: 方法/函数描述全部相同（严重）

**影响**: 10 个关键方法的"说明"列全部是同一句话
**现象**:
```
generate — graphify 的业务逻辑以模块职责为中心组织
save_query_result — graphify 的业务逻辑以模块职责为中心组织
run_benchmark — graphify 的业务逻辑以模块职责为中心组织
...（全部 10 个）
```
**根因**: architecture-narrative 的方法描述来自 spec 的 intent section 第一句，
而非函数级的 docstring 或上下文分析
**所在文件**: `src/panoramic/generators/architecture-narrative-generator.ts`

---

## BUG-D: product-overview 把 Issue/PR 当核心场景（严重）

**影响**: 产品定位完全错误，GitHub bug report 被展示为"核心场景"和"用户旅程"
**现象**:
- 核心场景 = 4 个 GitHub Issue/PR（`--svg export requires matplotlib`、`Windows unstable` 等）
- 目标用户描述 = `# graphify`（只取了标题行）
- 产品定位 = `[English](README.md) | [简体中文]...`（只取了导航链接）
**根因**: product-ux-docs pipeline 的事实源优先级错误，Issue/PR 权重过高，README 正文未被正确提取
**所在文件**: `src/panoramic/pipelines/product-ux-docs.ts`

---

## BUG-E: user-journeys 完全是模板废话（严重）

**影响**: 用户旅程文档无任何实际价值
**现象**: 把 bug report 标题当"用户目标"，关键步骤全是套模板：
```
1. 触发场景: 开发者 识别当前任务需要：--svg export requires matplotlib...
2. 执行关键动作: ### Summary graphify advertises SVG export...
3. 消费输出: 使用生成的文档...完成后续沟通、实现或交接。（推断）
```
**根因**: 与 BUG-D 同源——事实源是 Issue/PR 而非 README 中的真实用户场景
**所在文件**: `src/panoramic/pipelines/product-ux-docs.ts`

---

## BUG-F: feature-briefs 将 bug report 标记为 feature（中等）

**影响**: Issue #288（`--svg requires matplotlib`）是依赖缺失 bug，但被生成为 "feature brief"
**现象**: brief 的"摘要"和"问题"段落内容完全相同，"方案"段是模板套话
**根因**: pipeline 不区分 issue 类型（bug vs feature vs question），统一当作 feature candidate
**所在文件**: `src/panoramic/pipelines/product-ux-docs.ts`

---

## BUG-G: 中英文混杂（中等）

**影响**: 文档框架用中文、内容用英文原文，阅读体验割裂
**现象**: 
- 标题 "核心场景" "用户旅程" "事实来源" 用中文
- 内容直接粘贴英文 Issue 标题和 PR Summary，无翻译无摘要
- config-reference 的"说明"列全部为 `—`（空）
**根因**: LLM prompt 未要求输出语言与用户项目语言一致，也未做语言检测
**所在文件**: `src/panoramic/pipelines/product-ux-docs.ts`、各 generator 的 prompt 模板

---

## BUG-H: 图谱报告只有 1 节点 0 边（严重，BUG-A 连锁）

**影响**: GRAPH_REPORT.md 完全无用，无法识别 God Nodes 和社区结构
**现象**: "节点: 1, 边: 0, 社区: 1, 孤立节点: 1"
**根因**: graph 命令基于 specs/modules/ 下的 spec 文件构建图谱，
而 BUG-A 导致只有 1 个 graphify.spec.md → 1 个节点
**修复**: 修复 BUG-A 后自动解决

---

## BUG-I: troubleshooting 输出 0 条目（低）

**影响**: 故障排查文档为空
**现象**: "当前仅提取 0 条 grounded troubleshooting entries，低于蓝图建议的 5 条"
**根因**: troubleshooting generator 依赖代码中的错误处理模式提取，
Python 项目的异常处理模式可能不在识别范围内
**所在文件**: `src/panoramic/generators/troubleshooting-generator.ts`

---

## BUG-J: event-surface 提取了 vis.js HTML 事件（低）

**影响**: 事件面文档把 HTML 可视化模板中的 vis.js DOM 事件当成项目事件
**现象**: 5 个 channel 全部是 vis.js 事件（`afterDrawing`、`blurNode`、`click`、`hoverNode`、`stabilizationIterationsDone`）
**根因**: event-surface generator 提取了 export.py 中嵌入的 HTML/JS 模板字符串里的事件绑定
**所在文件**: `src/panoramic/generators/event-surface-generator.ts`

---

## BUG-K: data-model 类型列异常（低）

**影响**: LanguageConfig 的 ts_module 字段类型显示为 `stregtree_sitter_python`
**现象**: Mermaid ER 图中类型名被截断/拼错
**根因**: 字段类型提取时把注释内容混入了类型字符串（`str  # e.g. "tree_sitter_python"`）
**所在文件**: `src/panoramic/generators/data-model-generator.ts`

---

## BUG-L: 并行处理的并发控制逻辑有缺陷（中等）

**影响**: `--concurrency 5` 实际行为可能不是真正的 5 并发
**现象**: batch 输出中模块完成时间显示第一波 5 个模块的最慢模块耗时 640s，
但 build(255s) 完成后没有立即开始第 6 个模块
**根因**: 并发控制使用 `while (activeCount >= concurrency) { await Promise.race(pending) }` 
但 `Promise.race(pending)` 在 pending 数组被 splice 修改后行为可能不符合预期
**所在文件**: `src/batch/batch-orchestrator.ts` 并发调度块

---

## 总结

| 严重度 | 数量 | Bug ID |
|--------|------|--------|
| **严重** | 5 | A, B, C, D, E |
| **中等** | 3 | F, G, L |
| **低** | 3 | I, J, K |

### 根因分类

| 根因类别 | Bug 数量 | Bug ID |
|----------|---------|--------|
| **文件级降级路径传递错误** | 3 | A → B, H（连锁） |
| **product-ux-docs Issue/PR 权重过高** | 3 | D, E, F |
| **generator 输入质量退化** | 3 | C, G, K |
| **非源码内容误提取** | 1 | J |
| **并发调度实现** | 1 | L |
| **Python 适配不足** | 1 | I |
