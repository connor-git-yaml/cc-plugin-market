# 修复任务列表 — F221

> 依据 plan.md 变更清单 C1-C7。产出方式备注：tasks 阶段 Task 委派（spec-driver:tasks）同因 API `Connection closed mid-response` 失败，按唯一降级通道 inline 产出。
> 硬约束：T1-T4 的实现与 T5 对应测试必须同 commit；全程不动 F148 截断常量、不动 getProject() 性能契约。

## T1 模型层扩展（C1）

- **文件**: src/models/code-skeleton.ts
- **内容**: ExportKindSchema 追加 `'re-export'`；ExportSymbolSchema 追加 `reExportFrom?: string(min 1)`、`isTypeOnly?: boolean`；中文 jsdoc 注明"仅 re-export 条目携带"
- **验收**: `npm run build` 零错误；ExportSymbolSchema.parse 旧数据（无新字段）通过
- **依赖**: 无（首任务）

## T2 提取端主修复（C2）

- **文件**: src/core/ast-analyzer.ts（extractExports）
- **内容**: 追加 getExportDeclarations() 遍历——仅带 module specifier 的声明；name=alias 优先；kind='re-export'；reExportFrom=specifier 原文；isTypeOnly=语句级||说明符级；signature=规范化单行重建；startLine/endLine=语句本文件行号；无 members；沿用 seen 本地优先去重；`export * from`/`export * as ns from` 跳过（注释记限界）
- **验收**: 实证脚本对 src/batch/batch-orchestrator.ts 提取 count=14（3 本地 + 11 re-export 携 reExportFrom）
- **依赖**: T1

## T3 图派生与解析口径过滤（C3+C4）

- **文件**: src/knowledge-graph/index.ts（deriveNodesFromSkeletons L231 循环、deriveContainsEdges L291 循环）、src/knowledge-graph/call-resolver.ts（buildModuleSymbolIndex L100 循环）
- **内容**: 三处循环 `if (exp.kind === 're-export') continue;` + why 注释（防 F217 duplicate/orphan/dangling）
- **验收**: 用例⑩⑪通过；修复后重建 graph-only 节点/边数与修复前一致
- **依赖**: T1（T2 可并行）

## T4 序列化端归一化（C5+C6）

- **文件**: src/generator/spec-renderer.ts、templates/pattern-hints.hbs L51
- **内容**: 新增 stripTrailingWhitespace（`/[ \t]+$/gm` 剥离）；renderSpec/renderIndex/renderDriftReport 三出口 return 前套用；pattern-hints.hbs L51 尾随空格删除（1 字符）
- **验收**: 用例⑧⑨通过；三渲染函数输出 `/[ \t]+$/m` 零匹配
- **依赖**: 无（与 T1-T3 并行）

## T5 测试补齐（C7，拆入 T1-T4 同 commit）

- **文件**: ast-analyzer / spec-renderer / knowledge-graph(index+call-resolver) / single-spec-orchestrator 的既有测试文件（沿用现有命名与布局，勿新建平行结构）
- **内容**: plan.md C7 表 ①-⑫ 全部用例（re-export 各形态 ×6 + 14 符号集成 fixture + 渲染归一化 ×2 + 图过滤 ×2 + 接口表渲染 ×1）
- **验收**: `npx vitest run` 全量零失败
- **依赖**: T1-T4

## T6 验证闭环（Phase 4 输入）

- **内容**: plan.md §4 验证方案 1-7 逐项执行（vitest / build / repo:check + graph-only 重建对账 / 验收 (a) 实证 + AST-only 再生 / 验收 (b) git diff --check / 产物还原）
- **验收**: 三条验收标准 (a)(b)(c) 全过，证据归档 verification/verification-report.md
- **依赖**: T1-T5
