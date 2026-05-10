# 修复规划

## 修复范围

极小范围单行修复，影响一个函数的一条语句。

## 变更清单

| 文件 | 行号 | 变更类型 | 说明 |
|------|------|----------|------|
| `scripts/eval-task-runner.mjs` | L469 | 修改 | `.replace('<workspace>', wtDir)` → `.replaceAll('<workspace>', wtDir)` |
| `scripts/eval-task-runner.mjs` | 新增测试 | 新增 | 多占位符场景单元测试（如已有 test 文件则在其中追加） |

## 回归风险评估

- **风险级别**: 极低
- `.replaceAll` 在 Node 20+ 环境下行为与 `.replace` 完全一致（单次匹配时），多匹配时修正了遗漏替换
- 无调用方需同步修改

## 修复验证方案

1. `npx vitest run` 全量单元测试零失败
2. `npm run build` 类型检查零错误
3. 手动验证：构造含两个 `<workspace>` 的 oracle.command，确认两处均被替换
