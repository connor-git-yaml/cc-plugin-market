# F272 改动前基线（回归判定对照组）

- **基线 commit**：`f7a65aa9`（分支 `claude/test-guard-asset-cleanup-6b29b3`，工作区零改动）
- **采集时间**：2026-08-31 00:23–00:30
- **命令**：`npx vitest run`（本机满载，无 `VITEST_MAX_FORKS` 覆盖）

## 全量结果

```
Test Files  2 failed | 536 passed | 4 skipped (542)
     Tests  2 failed | 7892 passed | 18 skipped | 21 todo (7933)
    Errors  1 error
  Duration  407.91s
```

- `21 todo` 与 F272 ⑥ 的 it.todo 调用点计数**逐字吻合**（见 `../verified-facts.md` ⑥），
  是本卡处置后应当归零/下降的可观测量。
- `1 error` = `[vitest-worker]: Timeout calling "onTaskUpdate"` —— F235/F269 已登记的
  birpc 60s 硬超时假红，本机满载复现，**非本卡引入**。

## 2 个失败文件的归因（满载 flake 判定协议）

| 文件 | 满载 | 隔离重跑 | 判定 |
|---|---|---|---|
| `tests/unit/graph-bootstrap-status.test.ts` | FAIL | ✅ 绿 | 负载敏感 flaky |
| `tests/unit/sync-worktree-local-state.test.ts` | FAIL（`pattern '\bcredential'` 用例）| ✅ 绿 | 负载敏感 flaky |

隔离重跑证据：`npx vitest run tests/unit/graph-bootstrap-status.test.ts tests/unit/sync-worktree-local-state.test.ts`
→ `Test Files 2 passed (2) / Tests 172 passed (172) / Duration 29.48s`。

### ⚠️ 这两条**不在**仓库预存 flaky 清单里

预存清单（`watch-command` / `batch-orchestrator-incremental` / `community-analysis` perf /
`cli-e2e --version`）**不含**这两个文件。按满载 flake 判定协议三条件核对：

- 隔离绿 ✅
- 与本卡改动零交集 ✅（采集时工作区零改动，基线 commit 未被触碰）
- 在预存清单内 ❌ —— **这是本次新发现的两条**

两者都跑真实 shell / 子进程（`sync-worktree-local-state.sh`、`attemptLocalGraphBuild` 进程组
deadline），与预存清单里几条同属"满载下子进程时序被拖垮"的形态。

**处置**：不在本卡修（不属七项之一，且卡面明令预存 flaky 勿当回归修）。如实登记于此 +
交付报告 + dogfooding 账本，另开卡跟进。

## 对本卡的回归判据

改动后全量跑批，只要满足以下三条即判"无新引入回归"：

1. 失败文件集合 ⊆ {上述 2 个 flaky} ∪ {预存 flaky 清单}，且新增的失败文件在隔离下能复绿
2. `Tests passed` 不低于 7892 减去本卡**有意删除**的用例数，且删除数与 tasks 记录逐条对得上
3. `todo` 计数按本卡 ⑥ 的裁决量下降，降幅与实际删除的 it.todo 条数一致
