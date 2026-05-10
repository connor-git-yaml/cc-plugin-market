# 修复任务

## Task 1：应用单行修复

**文件**: `scripts/eval-task-runner.mjs` L469
**动作**: 将 `.replace('<workspace>', wtDir)` 改为 `.replaceAll('<workspace>', wtDir)`

## Task 2：补充多占位符边界测试

查找现有测试文件（`tests/` 目录下与 eval-task-runner 相关的测试），新增如下测试用例：

```
oracle.command = 'pytest <workspace>/a_test.py <workspace>/b_test.py'
期望：替换后所有 <workspace> 均变为 wtDir 路径
```

## Task 3：全量验证

- `npx vitest run`（零失败）
- `npm run build`（零类型错误）
- `npm run repo:check`（同步检查）
