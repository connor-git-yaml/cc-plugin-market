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

---

## Follow-up（commit bf9cba5 之后追加）

### 主会话独立 Codex 对抗审查发现 [C1 CRITICAL]

主会话在 commit bf9cba5 落地后，对改动重跑了一次独立 Codex 对抗审查，发现 1 项 CRITICAL：

**[C1]** `String.prototype.replaceAll(searchValue, replaceValue)` 当 replaceValue 为字符串时，会把 `$&` / `$$` / `` $` `` / `$'` 解析为特殊替换模式（`$&` → 匹配子串）。`wtDir` 来源含 `process.env.SPEC_DRIVER_BENCH_HOME` 与用户 `homedir()`，存在 `$&` 等字符的极小概率会让路径被静默损坏。

### 修复（follow-up commit）

- `scripts/eval-task-runner.mjs:469-470`：把 `.replaceAll('<workspace>', wtDir)` 改为函数式 `.replaceAll('<workspace>', () => wtDir)`，函数 replacement 不走特殊模式解析。
- `tests/unit/eval-task-runner.test.ts`：新增第 4 个 case `replaceAll function-form preserves $& / $$ in wtDir literally (Codex C1)` — 直接断言替换输出（不经 bash），同时 explicit 验证字符串 replacement 形式会损坏路径，函数式形式保持字面 `$&`。

### 复跑结果

- `npx vitest run tests/unit/eval-task-runner.test.ts`: 45/45 PASS（新增 1 个 C1 测试）
- `npx vitest run`（全量）: 38 failed file（全部预存在）/ 264 passed / 3263 passed tests（比 bf9cba5 多 1 个 — 即 C1 新测试）
- `npm run repo:check`: 全部通过

### Codex W1 / W2 处置

- **W1（特殊字符路径回归测试）**: 已合入 follow-up commit（即 C1 测试本身覆盖 `$&` 路径场景）
- **W2（fix-report.md MCP 调用语义价值零）**: 接受为 design-level 反馈记录，不在本 commit 修。MCP 集成测试本身的目标是验证 e2e 链路通畅（"call goes through, returns valid envelope"），本次 callees=[] 的语义贫乏由"图谱当前仅含 depends-on，无 calls 关系"引起，需等 Feature 152 ts-callsites 上线补全 calls 边后才能拿到真正的 callee 列表。本约束已在 fix-report.md MCP 集成证据章节明确标注。
