# F288 plan（承接 handoff 第 3 轮裁决，不重开讨论）

| 裁决 | 落点 |
|---|---|
| 1 删级 2/3：锁不可得 ⇒ 有界重试后降级为无锁 RMW + `state-lock-unavailable` | `mutateBlockState`：`acquired:false` 时同样 load → mutator → save |
| 2 不做 pidStartedAt：pid 存活 + 墙钟 300s 兜底；安全性不押在锁判据 | `acquireStateLock` |
| 3 耗尽放行传真实 `blockCount`（number，键不消失） | `releaseDegraded({ blockCount })` + `dispatchRoute` |
| 4 userFacing 白名单 | 卡 A 已交付；本卡五个新码全部不可见（T0-U5 集合不变） |
| 5 G3 | 卡 A 已交付 |
| 6b 状态文件不可伪造性 | 放行佐证 `releaseCorroborated`（反馈条目 ≥ 2 或 420）+ 终态账本核对 |
| 6 卡 C 落地后的 `routeBlock` 为基线；`routeNonBlock` 按修订合同重写 | `routeByFingerprint` + `dispatchRoute`（`buildFeedbackText` 复用 / 真实 blockCount / warn 门控 / 所有分支写回指纹）|

关键取舍：
- **锁文件原子创建用 `link`**：`wx` 后再写内容的空窗被 8 进程并发实测击穿（等待者读空判陈旧即接管）。
- **佐证计数复用卡 C 谓词**（`startsWith` 前缀 + 单文本块 + role user + latest 窗口），只把 token 条件放宽到 `[FIX-COMPLIANCE]`，两条放行路径共用一条 storage-free 上界。
- **既有测试的 harness 回灌模拟**放在 `runCli`（影子拷贝，夹具不动），因为 6b 让「第 3 次放行」在没有回灌的静态夹具上不再成立——这是对真实 harness 行为的建模，而不是把判据放宽。
