# 问题修复报告

## 问题描述

F220（batch-orchestrator 五段拆分）交付期间，Codex 对抗审查在自动再生的 specs/src.spec.md 中发现 Spectra spec 生成器两个缺陷：

1. **接口表不识别 re-export（误导性输出）**：`src/batch/batch-orchestrator.ts` 通过显式 `export { … } from './stages/…'` 保留 14 符号导出契约（含 `export type {} from`），但生成的 src.spec.md 接口表只列本地声明（runBatch/BatchOptions/BatchResult 共 3 个），漏掉 re-export 的 11 个符号。依赖该 spec 的 agent 会误判旧 helper 已删除，转而深导入 @internal 的 stages/ 模块。
2. **生成文本带尾随空格**：src.spec.md 多处行尾空格（当时定位 3174-3207 行附近），`git diff --check` 报错。需修生成器序列化端，勿手改产物。

**实证复现**（本 worktree @8092d1a，`npx tsx` 直跑 `analyzeFileInternal('src/batch/batch-orchestrator.ts')`）：

```
parserUsed: ts-morph
export count: 3
names: runBatch(function), BatchOptions(interface), BatchResult(interface)
```

14 符号契约（batch-orchestrator.ts L106-122）实际只提取到 3 个 → 缺陷一 100% 复现。

## 5-Why 根因追溯

### 缺陷一：re-export 丢失

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 接口表为何少 11 个符号？ | `CodeSkeleton.exports` 只含 3 个本地声明；接口表/文件清单/图谱全部下游消费该数组 |
| Why 2 | exports 为何只有本地声明？ | `ast-analyzer.ts#extractExports`（L109-127）唯一数据源是 ts-morph `sourceFile.getExportedDeclarations()`；re-export 目标模块不可解析时该 API 静默返回空，符号无声丢失 |
| Why 3 | 目标模块为何不可解析？ | `getProject()`（L68-84）出于性能有意配置 `skipFileDependencyResolution: true` + `noResolve: true`，且 `analyzeFileInternal` 只 add 单文件、用完即 remove——跨文件解析被整体关闭 |
| Why 4 | 该设计假设为何不成立？ | 设计时隐含假设"导出=本地声明"（历史代码库确实每文件本地声明）；F220 拆分首次引入 facade 契约（14 符号 re-export 门面），假设破裂。`ExportDeclaration`（`export {} from` / `export type {} from`）从未被独立处理 |
| Why 5 | 为何未被现有机制捕获？ | extractExports 无任何 re-export fixture 单测；spec 再生产物按惯例排除出 feature commit（无 diff 审计面）；F220 的 Codex 对抗审查靠人工读产物才暴露 |

**Root Cause**: 单文件 ts-morph Project 关闭跨文件解析后，`getExportedDeclarations()` 对 re-export 静默返回空；extractExports 缺少对 `ExportDeclaration`（含 type-only 变体）的语法级独立提取路径。
**Root Cause Chain**: 接口表少 11 符号 → exports 数组缺失 → getExportedDeclarations 解析失败静默吞符号 → noResolve 单文件 Project 有意关闭解析 → "导出=本地声明"假设被 F220 facade 打破 → 无 re-export 单测/产物 diff 盲区。

### 缺陷二：尾随空格

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | src.spec.md 为何有行尾空格？ | 写盘内容未做行级归一化（`single-spec-orchestrator.ts` L794 直接 `writeFileSync(renderSpec(...))`） |
| Why 2 | 行尾空格从哪来？ | 27 个 `templates/*.hbs` 中 module-spec.hbs 零行尾空格（仅 pattern-hints.hbs L51 一处，非本链路）；确定性骨架段由代码拼接亦干净 → 来源是注入模板的 **LLM 生成段落**（3174-3207 行聚集形态与 LLM 表格/列表一致） |
| Why 3 | LLM 内容为何直通落盘？ | `renderSpec()`（`src/generator/spec-renderer.ts` L90-102）只做模板渲染+baseline 注释拼接，无序列化清洗步骤 |
| Why 4 | 为何一直没暴露？ | spec 产物历史上不跑 `git diff --check`（自动再生物不入 feature commit）；LLM 输出是否带尾随空格随采样波动 |
| Why 5 | 为何无守护？ | 渲染端无"生成文本卫生"归一化，也无对应单测 |

**Root Cause**: 序列化端（renderSpec 等渲染出口）缺少行尾空白归一化，LLM 段落的尾随空格直通写盘。

## 影响范围扫描

### 同源问题（与根因共享同一模式）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| src/core/ast-analyzer.ts | L109-127 | extractExports 仅靠 getExportedDeclarations | **主修复点**：新增 ExportDeclaration 语法级提取（named re-export，含 `as` 别名与 type-only 两种形态） |
| src/core/query-mappers/typescript-mapper.ts | L601-633 | tree-sitter 降级路径经 `_extractExportClause` 把 re-export 产出为 `kind:'variable'`（勘误：并非丢失符号；但无 re-export 标记，不会被 C3/C4 过滤，图污染风险修复前后一致） | [同源] 降级路径 parity；Phase 2 裁决记已知限界（限界注释已落 `_extractExportClause`） |
| src/generator/spec-renderer.ts | L90-122 | renderSpec/renderIndex/renderDriftReport 无序列化清洗 | **主修复点**：渲染出口统一行尾空白归一化 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| src/panoramic/api-surface/express-extractor.ts | L137-147 | 自建 ts-morph 遍历，已显式处理 getExportDeclarations | [安全] 无需改动 |
| src/adapters/python-adapter.ts | — | Python 无 TS re-export 语法（`__all__` 语义已有独立处理） | [安全] 不适用 |
| templates/pattern-hints.hbs | L51 | 模板自带一处行尾空格 | [类似] 序列化端归一化后自然覆盖其产物；模板文件本身可顺手清理（1 字符） |

### 消费面同步清单（exports 数组新增 re-export 条目的下游合约）

| 消费方 | 位置 | 影响 | 需要的动作 |
|--------|------|------|-----------|
| knowledge-graph 节点/边派生 | src/knowledge-graph/index.ts L231（deriveNodesFromSkeletons）、L291（deriveContainsEdges） | re-export 混入会造出 `orchestrator::X` 别名节点 + contains 边，与 stages 真身重复，触发 F217 质量门/污染图拓扑 | **必须过滤** re-export 条目（真身已由目标文件贡献） |
| call-site 解析 | src/knowledge-graph/call-resolver.ts L100/L113/L176 | 名字→symbol 映射会二义（orchestrator 与 stages 同名） | **必须过滤**或本地声明优先 |
| 接口表渲染 | src/core/single-spec-orchestrator.ts L186/L854/L1201/L1260 | 渲染需区分本地声明与 re-export | 新增"Re-export 导出面"分层小节（满足验收 (a) 的"明确分层标注"） |
| 文件清单 purpose | src/core/single-spec-orchestrator.ts L756-758 | `导出 X, Y, Z` 列表自动补全 14 符号 | 自动受益，无需改 |
| 代码切片 | src/core/code-slice-extractor.ts L250 | re-export 无函数体 | kind 过滤后自然跳过，验证即可 |
| LLM 上下文组装 | src/core/context-assembler.ts L114 | re-export 条目进入上下文 | 无害（信息增益）；验证不崩即可 |
| 数据模型文档 | src/panoramic/generators/data-model-generator.ts L329/L730 | 只挑 interface/type 详情 | re-export 条目无 members，验证跳过逻辑 |
| 漂移检测 | src/diff/drift-orchestrator.ts | 目录级合并按裸名建 Map，re-export 别名会后写覆盖同名真身、掩盖实现变更（Codex W1 实证） | **已修**：目录合并处过滤 re-export，drift 口径与修复前逐字一致；facade 导出面 drift 呈现留 M9 轨道 C |
| 存量 baseline-skeleton | specs/*.spec.md 内嵌 JSON | 兼容方向澄清（Codex W2）：**新 tooling 读旧 baseline** 零破坏（新字段 optional）；**旧 tooling 读新 baseline** 会因 `kind:'re-export'` 枚举值校验失败降级 reconstructed——与历史枚举扩值（struct/trait 等）一致的既有 schema 演进模式，非本次特有 | 新读旧无需迁移；旧读新按既有降级路径工作，随版本升级消化 |

### 同步更新（测试/文档）

- 测试：extractExports 的 re-export fixture 单测（named/alias/type-only 语句级/type-only 说明符级/本地 `export {}` 不误伤/与本地声明同名去重）；renderSpec 行尾空白归一化单测；graph 派生过滤单测；call-resolver 二义防护单测
- 文档：CodeSkeleton 模型 jsdoc（新字段语义）；如实现 tree-sitter parity 则同步 mapper 注释
- Spec 影响：specs/src.spec.md 属自动再生物，本 fix 不提交其再生版本（沿用仓库惯例），验证证据归档 verification/

## 修复策略

### 方案 A（推荐）：语法级 re-export 提取 + 显式标记字段 + 消费端定向过滤

1. **模型**（src/models/code-skeleton.ts）：`ExportKindSchema` 增加 `'re-export'`（枚举本就为前向兼容设计）；`ExportSymbolSchema` 增加 `reExportFrom: z.string().optional()`（module specifier 原文）与 `isTypeOnly: z.boolean().optional()`
2. **提取**（ast-analyzer.ts）：extractExports 在现有循环后遍历 `sourceFile.getExportDeclarations()`，仅处理带 module specifier 的语句；每个 named specifier 产出 `{ name: 导出名(alias 优先), kind: 're-export', reExportFrom, isTypeOnly, signature: 规范化单行（如 export { X } from './y.js'）, startLine/endLine: 语句在本文件的行号 }`；沿用 `seen` 集合本地声明优先去重；不做跨文件解析（保持单文件 Project 性能契约）；`export * from` 不产条目（无解析不可枚举），记入已知限界
3. **消费端**：graph 两处派生 + call-resolver 名字映射按 `kind === 're-export'` 过滤；single-spec-orchestrator 接口汇总表纳入 re-export 并新增"Re-export 导出面"分层小节（符号/来源模块/type-only 三列）
4. **序列化**（spec-renderer.ts）：新增行尾空白归一化（`/[ \t]+$/` 逐行剥离），renderSpec/renderIndex/renderDriftReport 三出口统一套用
5. **测试**：如上同步更新清单

**优点**：不引入跨文件解析（保住性能优化本意）；re-export 在模型层自描述，每个消费者可显式决策；图拓扑零污染（F217 门不受扰）；满足验收 (a) 的"14 符号 + 明确分层标注"口径。
**代价**：ExportKind 枚举扩值需检查各 kind 分支消费点（影响面已列全）。

### 方案 B（备选）：按需解析 re-export 目标文件获取真实 kind/签名

对每条 re-export 解析相对路径并临时 add 目标文件，读出真实声明 kind/signature/members。
**否决理由**：仍必须加 `reExportFrom` 标记（否则图/call-resolver 的别名重复问题反而更隐蔽）；引入链式 re-export 递归、别名换名、额外 parse 开销；复杂度上升但对验收无增益——方案 A 的分层标注已满足"接口表不误导"的产品目标。

## Spec 影响

- 需要更新的 spec：无既有 feature spec 记载 extractExports 行为合同（F220 的 refactor-plan 只约定 facade 导出面本身，不涉生成器）；specs/src.spec.md 为自动再生物不随本 fix 提交
- 验证再生路径：利用 AST-only 降级（主线明确保留的静默降级路径）零 LLM 成本再生 src.spec.md 做验收 (a)/(b)，随后还原工作区

## 验收标准（来自任务）

- (a) 重新生成 src.spec.md 后接口表含 14 符号或明确分层标注（方案 A 走"汇总表 14 符号 + Re-export 分层小节"）
- (b) `git diff --check` 零告警（序列化端归一化后再生产物无行尾空白）
- (c) 现有 vitest 全绿
