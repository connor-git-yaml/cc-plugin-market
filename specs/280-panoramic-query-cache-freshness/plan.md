# F280 plan
| # | 步骤 | 落点 | 验收 |
|---|---|---|---|
| P1 | 红先行：engine-cache 失效矩阵 5 例 + honesty 2 例 | tests/unit/panoramic/engine-cache.test.ts、tests/unit/mcp/panoramic-query-honesty.test.ts | 改前红（模块/函数不存在） |
| P2 | 共享缓存模块 | src/panoramic/graph/engine-cache.ts | P1 绿 |
| P3 | qa/index.ts 与 mcp/graph-tools.ts 接入共享缓存 | 两文件 | graph-tools-cache.test 4 例回归绿 |
| P4 | buildPanoramicQueryHonesty + server.ts 挂接 | graph-honesty.ts、server.ts | honesty 测试绿；mcp-server.test 绿 |
| P5 | 对抗复审 ×1 + verify 子代理 | verification/ | 无 CRITICAL |
| P6 | 全量门禁 + rebase master + ff push | — | 零失败（F213 环境耦合 e2e 除外，F281 修） |
不做：合并 getCachedGraphData 的二次 stat；其余 operation 挂标注；coverage 维度。
