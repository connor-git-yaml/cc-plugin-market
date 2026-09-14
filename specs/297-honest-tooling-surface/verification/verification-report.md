# 验证报告：P1-I 诚实工具面（M11 卡 A）

日期 2026-09-15 · 审查档位：Codex 审查暂停 → 本卡为一般生产代码（`src/mcp/**` / `src/knowledge-graph/**`），主线程自审 + 既有 F266 / F174 / F196 / F249 / F272 护栏全绿；未单独派发对抗子代理（同批 B / C 两卡各派两路，A 卡的返回面变化由客户端侧可见性 e2e 与外部语料 A/B 兜底——如实登记为档位缺席）。

## FR 对账（8 / 8 已实现）

| FR | 判定 | 证据 |
|---|---|---|
| FR-001 | 已实现 | `call-resolution-labels.test.ts` 4 例；`call-resolver-resolution-labels.test.ts` 7 例（Stage 1/2/2-MRO/2-占位/3/3-star/4/F260）；合同 parity 4 例 |
| FR-002 | 已实现 | `graph-builder-call-sites.test.ts` 4 例（单边 / N:1 排序去重 / cap 20 / 诚实缺席） |
| FR-003 | 已实现 | `bfs-edge-provenance.test.ts`；agent-context H-1 / H-2；e2e T-003-D3（stdio 序列化后 callers 带 provenance） |
| FR-004 | 已实现 | H-3 / H-4；query-helpers / f174 e2e / view-file-fuzzy 改名后全绿；合同 `breakingChanges` 3 条 |
| FR-005 | 已实现 | `tool-response-token-budget.test.ts` 4 例（含超 cap 收缩 / 无可截断 key 诚实超限 / UTF-8 字节）；H-5；e2e D3 |
| FR-006 | 已实现 | `tools-list-order.test.ts`（注册顺序 == 合同）；e2e T-003-D1（两次 listTools 逐字节）/ D2（impact / context / graph_node 两次逐字节） |
| FR-007 | 已实现 | e2e T-003-D3 |
| FR-008 | 已实现 | 下表 |

## 外部语料 A/B（A = HEAD `1d7c8b01` 独立 worktree 构建的 dist；B = 本批 dist；同一语料同一 commit）

| 语料 | 节点 | 边 | 节点 id / 边多重集 | calls | 带 resolution | 带 callSites | 多调用点边 | 触 cap | 策略分布 | call precision / recall |
|---|---|---|---|---|---|---|---|---|---|---|
| GORM `688e8ea0` | 1717 = 1717 | 1753 = 1753 | 相同 / 相同 | 192 | 192 | 192 | 48 | 1 | export-table 146 / class-member 46 | A 0.587 / 0.307 = B 0.587 / 0.307（hits 71 / 121 / 231） |
| HikariCP `ea81bfb5` | 1269 = 1269 | 1211 = 1211 | 相同 / 相同 | 53 | 53 | 53 | 6 | 0 | class-member 53 | A 1.0 / 0.034 = B 1.0 / 0.034（hits 28 / 28 / 819） |

读数与 09-12 G0-4 记录逐字相同（GORM 0.587/0.307 修前尺、HikariCP 1.0/0.034）。重算器：`scratchpad/cardA-ab/run-ab.sh`（不入库；命令形态 = README 的 `node dist/cli/index.js batch <copy> --mode graph-only --output-dir` + `scripts/graph-accuracy.mjs` 钉死参数）。

## pinned 资产

四份 pinned graph（ts / java / go / micrograd）与 F249 护栏两份资产按各自 README SOP 再生，审计「剥 `graph.builder` / `graph.sourceTreeDirty` / 边 `resolution` / `callSites` / `callSiteCount` 后深等 0 差异」；`expected-module-graph.json` 逐字节不变。`BEHAVIOR_VERSION` 保持 3（不改采集面）。

## 回归护栏

F266 honesty（`panoramic-query-honesty*` / agent-context honesty 用例）、F174 fuzzy 阈值（H-6 `matchScore < 0.9` 不 autoResolve）、F196 描述漂移守护、F272 pinned 陈旧检测、F249 双轨护栏、F175 byte-stable 全绿；`tests/unit/{knowledge-graph,mcp,panoramic/graph,contracts,graph}` 68 文件 1165 例全绿。

## 冻结快照受控更新（第二次，本卡）

`tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap` 因 calls 边新增字段再次不匹配，做第二次受控 `-u`（preimage 留 `scratchpad/f220.snap.preimage2`）。
审计（排序多重集 diff）：**删除 0 行；插入 168 行 = 14 条 calls 边 × 12 行**（`"resolution": {` / `"stage"` / `"strategy"` / `"basis"` / `},` 各 14；`"callSites": [` / `{` / `"line"` / `"column"` / `},` / `],` 各 14；`"callSiteCount"` 14），
策略分布 import-table 8 + export-table 6 = 14；无其它形态的插入行。两次受控更新合计：9 处 `sourceTreeDirty` + 16 处 cache 行 + 168 行边字段，0 删除。

## 程序闭包守卫

`tests/type-tests` 闭包守卫（≤ 24 文件、禁 `src/knowledge-graph` / `core` 值模块）在首版红：`graph-types.ts` 的 type import 把 `call-resolution-labels.ts` 拖进程序、`tool-response.ts` import 了 `core/token-counter`。
修法：五个形状类型改在 `graph-types.ts` 定义、词表模块反向 import 并 `satisfies`；`tool-response.ts` 用同公式的本地估算（`Math.ceil(len / 3.5)`，与 core 的 `estimateTokens` 由 tokenBudget 测试对拍）。

## 残余（登记）

- `graph_query` / `graph_path` 等 6 个图工具 `tokenBudget` 走 `buildSuccessResponse` 后 `graph_hyperedges` 输出从 pretty-print 改为紧凑 JSON（消费方按 JSON 解析无影响）。
- `tokenBudget` 自身 ~100 字节不计入 `payloadBytes`；恰好压线的 payload 在 `exceedsPayloadCap` 复核时可能超限（0.7 收缩比留有余量）。
- 未做对抗子代理审查（档位缺席，见首段）。
