# goal_loop 迭代日志 — Feature 202

配置：max_iterations=5 / no_progress_max_rounds=2 / max_verify_seconds=300 / max_tool_invocations=50（均为 config-schema 默认）

## 前置（红基线建立 = goal_loop 启动信号）
- 委派 implement 子代理写红测试（仅测试，不动 src/）：tests/unit/mcp-server.test.ts +6 用例(A/A2/B/C/D/E) + tests/integration/mcp-batch-graph-only.test.ts 新建
- 红基线确认（orchestrator 独立跑）：单元 5 failed（A/A2/B/C/E）/ D+既有 14 passed；集成 1 failed（isError=true，handler 落 runBatch）→ **启动信号 TRUE**
- **遥测发现 #1（snapshot/rollback vs 未跟踪 pilot 配置）**：goal_loop snapshot 用 `git stash --include-untracked`、rollback 用 `git clean -fd`，对未跟踪且未 gitignore 的 `.specify/orchestration-overrides.yaml`（pilot 验证态 override）有破坏性——会被 stash 走或 clean 删，导致 goal_loop 配置中途消失。缓解：加入 `.git/info/exclude`（本地，不 commit）使其被忽略，stash/clean 均不触及。M9 候选输入：goal_loop core 应把 override/config 路径默认排除出 snapshot 范围。

### 轮次 1（round 1）

```json
{
  "round": 1,
  "verify_mode": "smoke",
  "metric": false,
  "delta": {
    "layer2_pass_count": 1,
    "p1_fr_coverage_pct": 100,
    "layer1_5_status_score": 2,
    "regression_count": 0,
    "net_loc_delta": null
  },
  "exit_reason": null,
  "injection_status": "skipped",
  "snapshot": {
    "clean": false,
    "ref": "8642bb9a064f7957113cf6009cbcb192a29655e3"
  },
  "timestamp": "2026-06-20T14:05:00Z"
}
```
### 轮次 2（round 2）

```json
{
  "round": 2,
  "verify_mode": "full",
  "metric": true,
  "delta": {
    "layer2_pass_count": 3,
    "p1_fr_coverage_pct": 100,
    "layer1_5_status_score": 2,
    "regression_count": 0,
    "net_loc_delta": null
  },
  "exit_reason": "REACHED_GOAL",
  "injection_status": "skipped",
  "snapshot": {
    "clean": false,
    "ref": "34b53ece28d1f40d2ee31fcb7a4518be5cbc6433"
  },
  "timestamp": "2026-06-20T14:20:00Z"
}
```
