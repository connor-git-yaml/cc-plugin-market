# Quickstart：验收命令速查

本卡不新增用户可见功能，"快速上手"指审查者/后续维护者验证七项处置是否落地的最短命令路径。全部命令假定在仓库根（本 worktree）执行，`dist/` 已构建（`npm run build`）。

## ① qa 测试套件

```bash
# 陈旧副本已删除
test ! -d src/panoramic/qa/__tests__ && echo "OK: 陈旧副本已删除"

# 在维护副本用例数 83 -> 85，全绿
npx vitest run --project unit tests/panoramic/qa
# 期望：Test Files 8 passed (8) / Tests 85 passed (85)

# durationMs 断言已修回
grep -n "durationMs" tests/panoramic/qa/index.test.ts
```

## FR-011 零执行测试文件守卫

```bash
npx vitest run tests/integration/zero-execution-test-file-guard.test.ts
# 期望：1 passed，断言全仓 .test.ts 磁盘集合与 vitest 收集集合的差集恰好等于白名单
```

## ② self-dogfood 快照块

```bash
grep -rn "self-dogfood-graph_god_nodes\|self-dogfood-graph_query" --include="*.ts" --include="*.snap" .
# 期望：无输出（全仓无残留）

npx vitest run tests/integration/graph-mcp-snapshot.test.ts
# 期望：所有保留用例通过，无 skipped
```

## ③ typecheck:tests CI 接入

```bash
npm run typecheck:tests
# 期望：exit 0，耗时约 2-3s

grep -n "typecheck:tests" .github/workflows/ci.yml
# 期望：命中新增的 Type Check Tests 步骤
```

CI 真实 run 结果需等待 GitHub Actions 回填（走 F269 惯例，implement 报告先落盘 PENDING 节）。

## ④ pinned graph 陈旧检查

```bash
npx vitest run tests/integration/graph-quality-lang-matrix.test.ts tests/integration/graph-quality-pinned-staleness.test.ts
# 期望：全绿；lang-matrix 的 TS/JS expectedEdgeCount 应为 14

cat tests/fixtures/graph-quality-ts-graph/README.md | grep "边总数"
# 期望：14（1 depends-on + 5 calls + 8 contains）
```

## ⑤ fingerprint regen 差异输出

```bash
npx vitest run tests/integration/collector-fingerprint-regen-script.test.ts
# 期望：全绿，含新增的 contentMismatch=true 放行场景用例
```

## ⑥ it.todo 三分处置

```bash
npx vitest run 2>&1 | tail -5
# 期望：todo 计数 = 7（不是处置前的 21，也不是 spec.md 修正前误写的 8）

grep -c "it.todo\|test.todo" tests/integration/cross-project-isolation.test.ts tests/integration/adr-cross-fixture.test.ts tests/integration/hyperedge-first-run.test.ts
# 期望：三份文件均为 0（结构性不可填充的 13 条已删除，理由转入各自文件 docblock）
```

## ⑦ 虚化断言清单

```bash
# B 类 35 条：逐条对照 inventory-item7.md 的坐标核实已处置（tasks.md 会给出逐条勾选清单）
# A 类 64 条：inventory-item7.md 本身已入库，无需额外命令验证（清单存在即完成交付）
git log --oneline -- specs/272-test-guard-asset-cleanup/inventory-item7.md
```

## 全量回归判据（对照 `verification/baseline-before.md`）

```bash
npx vitest run
```

判定标准（与 `verification/baseline-before.md` 一致）：
1. 失败文件集合 ⊆ 预存 flaky 清单（`watch-command`/`batch-orchestrator-incremental`/`community-analysis` perf/`cli-e2e --version`）∪ 本次新发现的两条（`graph-bootstrap-status.test.ts`/`sync-worktree-local-state.test.ts`，隔离重跑复绿）
2. `Tests passed` 不低于 `7892 - 本卡有意删除的用例数`，删除数与 tasks 记录逐条对得上
3. `todo` 计数从 21 降至 **7**

```bash
npm run build && npm run repo:check
# 期望：两者均零失败
```
