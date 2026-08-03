# 验证报告：F248 收敛 extractExtension 私有实现到共享纯函数

- **特性目录**: specs/248-fix-dedupe-extract-extension
- **验证时间**: 2026-08-03
- **验证提交**: 6308e32c4bbb465caa3d2d36009c075be907e307（dirty=false，工作区干净）
- **改动面**: M src/panoramic/graph/source-commit.ts；M src/panoramic/graph/quality/ignore-oracle.ts；新增 src/panoramic/graph/collector-extname.ts + collector-extname.test.ts

## Layer 1 引用：Phase 4a Spec 合规审查结论

总体 PASS。修复与 fix-report 方案 A 严格一致；调用方替换逐字等价无行为漂移；范围边界未触碰；"无需更新 spec"经全仓搜索验证成立；无 CRITICAL/WARNING（唯一流程性瑕疵 tasks.md checkbox 已由编排器补勾）。

## Layer 1.5 引用：Phase 4b 代码质量审查结论

总体 EXCELLENT。0 CRITICAL / 0 WARNING / 1 INFO（plan 草稿注释与最终 doc 注释文案不逐字一致，属实施期加强非偏离）。doc 注释行为合同经 node -e 实跑验证准确；测试 10 用例真锚定；quality/→graph/ import 方向有 legacy-ignored-check.ts 先例。

## Layer 2: 原生工具链验证（本轮亲自实跑）

### 命令 1: `npx vitest run`

- **退出码**: 0
- **结果**: `Test Files 500 passed | 4 skipped (504)`；`Tests 6406 passed | 18 skipped | 21 todo (6445)`
- **耗时**: 55.77s（transform 5.32s / collect 33.29s / tests 398.36s）
- **关键抽查**: `src/panoramic/graph/collector-extname.test.ts (10 tests) 1ms` — 全部真实执行且通过，10 个用例与 tasks.md 声称的测试数一致
- **flaky 免责单命中情况**: 本轮未触发任何已知 flaky 用例（watch-command.test.ts / batch-orchestrator-incremental.test.ts / community-analysis perf / graph-bootstrap-status 心跳 / cli-e2e --version 均未见于失败列表，因为全部通过，无需隔离重跑）

### 命令 2: `npm run build`

- **退出码**: 0
- **输出摘要**:
  - `prebuild`: `[inline-d3] d3-force 3.0.0 内容无变化，跳过写入`
  - `build`: `tsc` 零错误
  - `postbuild`: `[postbuild:stamp] 盖章: commit=6308e32c (dirty)`
- **产物抽查**: `dist/panoramic/graph/collector-extname.js` 存在（2764 bytes，mtime 与本次 build 一致），确认新增共享模块已正确编译产出

### 命令 3: `npm run repo:check`

- **退出码**: 0（top-level `status=warn`，但 warn 不阻断，脚本自身返回 0）
- **结果**: 除下述 1 项 warning 外，全部 ~80 项检查 `pass`
- **warning**: `graph-quality:freshness` — 图产物记录的 sourceCommit（8d25c264530b0297651b869ec8d118178455518f）与当前 HEAD（6308e32c4bbb465caa3d2d36009c075be907e307）不一致（commit 级 stale）
  - **处置**: 本地陈旧图产物，与本次改动无关（属运行时上下文预先声明的免责项：仓库长期存在的本地图未重建，非本次改动引入的回归），不阻断判定

## 验证证据核查

1. `collector-extname.test.ts` 10 个用例：vitest 输出显式列出 `src/panoramic/graph/collector-extname.test.ts (10 tests) 1ms`，全部 passed，确认为真实执行而非空跑或 skip
2. `dist/` 产物含新增共享模块：`ls -la dist/panoramic/graph/collector-extname.js` 确认文件存在

## 最终判定

**PASS**

三条原生工具链验证命令（vitest / build / repo:check）本轮亲自实跑，退出码均为 0；唯一 warning（graph-quality freshness）为预存本地状态，非本次改动引入，不影响判定。Layer 1（Spec 对齐）与 Layer 1.5（代码质量）审查均已在 Phase 4a/4b 得出 PASS/EXCELLENT 结论。特性 248 满足交付质量门，可进入下一阶段。
