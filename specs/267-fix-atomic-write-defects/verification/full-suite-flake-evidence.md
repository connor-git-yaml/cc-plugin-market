# 全量跑批失败归属判定（满载 flake vs 回归）

本卡改动触及 `writeAtomicJson`，而 graph-builder / manifest-manager / extraction-cache 三个
消费方在大量 batch 类测试里被间接调用——因此"全量跑批有红"不能直接归给 flake，必须按
**隔离绿 + 零交集 + 预存清单**三条判据取证（F260 满载 flake 判定协议）。

## 判据 1：三次全量跑批的失败集互不相同

| 跑批 | 失败数 | 失败文件集 |
|------|--------|-----------|
| 第 1 次 | 8 tests / 8 files | （未逐一记录，见下方说明）|
| 第 2 次 | 10 tests / 9 files | batch-concurrency.e2e、feature-175-batch-incremental.e2e、collector-fingerprint-regen-script、graph-quality-cli、spec-drift-canonical-ast-e2e、spec-driver-codex-skills、batch-orchestrator-incremental、graph-quality-core、sync-worktree-local-state |
| 第 3 次 | 7 tests / 7 files | batch-coverage-report、batch-doc-bundle-orchestration、batch-paths、batch-product-ux-docs、batch-root-degraded、python-mapper-callsite、worktree-lifecycle-hook |

**第 2 次与第 3 次的失败文件集交集 = ∅**（零交集）。同一份代码、同一条命令，两次跑批没有
任何一个文件重复失败——真回归会**确定性地**落在同一处，这个形态只能是负载敏感。

## 判据 2：两批失败文件隔离重跑全绿

```bash
npx vitest run --no-file-parallelism <第 2 次的 9 个文件>   # → 9 passed (272 tests)
npx vitest run --no-file-parallelism <第 3 次的 7 个文件>   # → 7 passed (29 tests)
```

16 个文件 / 301 个用例在隔离（关文件并行）下 100% 绿。

## 判据 3：形态与预存 flaky 清单一致

- 失败文件的单文件耗时约 **1,000,000 ms**（正常为秒级）——机器饱和特征，不是逻辑失败
- 伴随 `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` ×6 —— 即 F235 记录的 birpc
  超时形态（当时的修法是 `maxWorkers=CPU/2`）
- `batch-orchestrator-incremental` 本就在预存 flaky 清单上（隔离重跑 7/7 绿）
- 失败集合中的 `community-analysis` 类 perf 断言、`cli-e2e --version` 满载超时同属既有清单形态

## 判据 4：本卡新增/改动的测试从未出现在任一失败集

`tests/unit/atomic-write.test.ts`、`tests/unit/hook-installer.test.ts`、
`tests/unit/codex-runtime-doctor.test.ts`、`tests/integration/atomic-write-concurrent.test.ts`
在三次全量跑批中**零次**失败。

## 结论

三次跑批的红全部归为**满载 flake（既有基础设施问题，非本卡引入）**。本卡不承担修复该
基础设施问题的责任（那是 P1-G 测试资产清淤的范围），但**不得**因此放宽本卡自身的验收：
本卡相关的 112 个用例在任何跑批形态下均全绿，且 7 个变异体被互不相交的用例抓住。

⚠️ 诚实登记：判据 1 的第 1 次跑批只记录了计数（8 failed）未记录文件名，故"零交集"这一条
只在第 2、3 次之间成立，不是三次两两之间。这不削弱结论（两次零交集已足够证明非确定性），
但不应把它转述成"三次两两零交集"。

## 判据 5（事后追认）：第 4 次全量跑批 100% 绿

对抗审查修复全部落地后，在机器负载较低时重跑全量：

```
Test Files  531 passed | 4 skipped (535)
     Tests  7525 passed | 18 skipped | 21 todo (7564)
[exited with code 0]
```

**零失败**。前三次那 16 个失败文件这次一个都没红。这条追认了上面的归属判定：
同一份代码在低负载下全绿、在满载下随机红一批且每次红的都不是同一批 —— 只可能是负载敏感，
不可能是回归（回归不会因为机器闲下来就自愈）。
