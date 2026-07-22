# Feature Specification: Spectra spec 生成器 re-export 识别 + 序列化尾随空格修复

**Feature Branch**: `221-fix-specgen-reexport-whitespace`
**Created**: 2026-07-22
**Status**: Delivered（fix 模式）
**Input**: F220 交付期间 Codex 对抗审查在自动再生的 specs/src.spec.md 中发现 Spectra spec 生成器两缺陷，按 spec-driver fix 流程立项修复

> fix 模式精简 spec：问题陈述与验收在此，诊断/规划/任务/验证细节见同目录 fix-report.md / plan.md / tasks.md / verification/。

## 问题陈述

1. **接口表不识别 re-export（误导性输出）**：`src/batch/batch-orchestrator.ts` 通过显式 `export { … } from './stages/…'` 保留 14 符号导出契约，但 CodeSkeleton 提取端只识别本地声明（提取到 3 个），11 个 re-export 符号静默丢失；依赖该 spec 的 agent 会误判旧 helper 已删除，转而深导入 @internal 的 stages/ 模块。
2. **生成文本带尾随空格**：生成的 src.spec.md 多处行尾空格，`git diff --check` 报错；需修生成器序列化端而非手改产物。

## 验收标准

- (a) 重新生成 src.spec.md 后接口表含 14 符号或明确分层标注（实现口径：统一接口表 `类型` 列 `re-export` + `签名` 列携带来源 specifier；折叠汇总表导出数=14；fileInventory purpose 全名单）
- (b) `git diff --check` 零告警（渲染出口统一行尾空白归一化）
- (c) 现有 vitest 全绿（预存 flaky 按隔离+根因归类豁免）

## 方案摘要（方案 A，详见 fix-report.md）

模型层 `ExportKind` 加 `'re-export'` + `ExportSymbol.reExportFrom/isTypeOnly`；提取端语法级识别 `ExportDeclaration`（named/alias/type-only，`export * from` 记已知限界）；图派生与 call-resolver 按 kind 过滤防 F217 质量门污染；`renderSpec/renderIndex/renderDriftReport` 三渲染出口统一剥离行尾空白。
