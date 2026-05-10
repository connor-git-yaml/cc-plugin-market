# 验证报告

## 修复验证

### 代码变更确认

- **文件**: `scripts/eval-task-runner.mjs` L469
- **变更**: `.replace('<workspace>', wtDir)` → `.replaceAll('<workspace>', wtDir)`
- **验证**: `sed -n '469p' scripts/eval-task-runner.mjs` 确认 `.replaceAll` 已生效

### 新增测试用例

`tests/unit/eval-task-runner.test.ts` 新增 `describe('unit-test kind')` 含 3 个用例：
1. 单个 `<workspace>` 占位符替换 ✅
2. **多个 `<workspace>` 占位符全部替换（边界用例）** ✅ — 直接验证修复效果
3. 命令非零退出 → passed=false ✅

### 测试结果

| 测试范围 | 通过 | 失败 |
|----------|------|------|
| `eval-task-runner.test.ts`（含新增 3 个用例）| 44/44 | 0 |
| 全量 `npx vitest run` | 3262 | 255（全为预存在失败，与本次修改无关） |

**预存在失败确认**：失败集中于 `ts-call-extractor.test.ts` 等不相关模块，基线（改动前）与改动后数量完全相同（38 failed | 264 passed | 3 skipped）。

### repo:check

所有 release-contract 与 orchestration-overrides 检查项全部通过。

### 构建

`npm run build` 在此 worktree 因 d3-force 依赖缺失（预存在问题，与本次改动无关）而失败，TypeScript 类型检查本身不受影响。

## 结论

修复正确、测试覆盖完整、无新增回归。可以提交。
