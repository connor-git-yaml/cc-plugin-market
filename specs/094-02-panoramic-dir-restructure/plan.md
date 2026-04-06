# Implementation Plan: F-094-02 Panoramic 目录结构分层重组

**Branch**: `feature/089-skill-orchestration-split` | **Date**: 2026-04-06 | **Spec**: [spec.md](spec.md)

---

## Summary

将 `src/panoramic/` 根目录的 35 个 `.ts` 文件按职责迁移至 5 个新建子目录（`generators/`、`pipelines/`、`models/`、`builders/`、`exporters/`），使根目录文件数从 45 降至 10 个。同步更新 `index.ts` 桶文件、迁移文件内部引用、外部调用方路径（4 处）、测试文件路径（~28 个）。零业务逻辑变更，零破坏性变更。

---

## 实施策略：自底向上分层迁移

依赖层级分析决定迁移顺序：models（无依赖）→ builders（依赖 models）→ exporters（依赖 models）→ generators（依赖 models + builders）→ pipelines（依赖 models + generators + builders）。

每个批次完成后立即更新该批次文件内部的 import 路径，然后运行 `npm run build` 验证。

### 路径更新规则

| 变更类型 | 旧路径模式 | 新路径模式 |
|--------|-----------|-----------|
| 子目录文件引用根目录保留文件 | `'./interfaces.js'` | `'../interfaces.js'` |
| 子目录文件引用其他子目录文件 | `'./xxx-model.js'` | `'../models/xxx-model.js'` |
| 同子目录文件互引 | `'./xxx.js'` | `'./xxx.js'`（不变） |
| index.ts 导入迁移文件 | `'./xxx.js'` | `'./subdir/xxx.js'` |
| 外部调用方 | `'../panoramic/xxx.js'` | `'../panoramic/subdir/xxx.js'` |
| 测试文件 | `'../../src/panoramic/xxx.js'` | `'../../src/panoramic/subdir/xxx.js'` |

---

## 验证策略

每个迁移批次完成后：
1. `npm run build` — TypeScript 编译验证
2. 全量迁移完成后 `npm test` — 运行时路径验证
3. `ls src/panoramic/*.ts | wc -l` — 根目录文件数 ≤ 10
4. 循环依赖检测（最终验证）

---

## 风险等级

**MEDIUM** — 影响 66 个文件，但所有变更均为机械性路径替换，TypeScript 编译器可精确定位所有路径错误。
