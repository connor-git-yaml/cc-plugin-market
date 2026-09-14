# 任务分解：P1-I 诚实工具面（M11 卡 A）

- [x] T1 合同 `contracts/mcp-return-surface-contract.yaml` + 词表模块 + parity 测试（RED → GREEN）
- [x] T2 call-resolver / receiver-type 每条边带 `metadata.resolution` + `metadata.callSite`（7 例 RED → GREEN）
- [x] T3 graph-builder 合并 callSites（4 例）；GraphEdge 类型
- [x] T4 BFS provenance（`edgeProvenance`）+ context / impact 返回面 + 词表改名（H-1 ~ H-6）
- [x] T5 tokenBudget（tool-response 4 例；graph 工具 6 处走 envelope）
- [x] T6 tools/list 顺序单测 + e2e 确定性 / 可见性三例
- [x] T7 既有套件更新（call-resolver 24+6 处 stripMeta、fuzzy 字段改名、描述漂移守护、F171 小 payload）
- [x] T8 四份 pinned graph 受控再生 + README 记录；F249 护栏两份资产 `--init` 冷启动再生 + README 记录（均「剥新字段深等 0 差异」）
- [x] T9 外部语料 A/B（HEAD 工作树 dist vs 本批 dist）

冻结值：feature 最小制品集，`GATE_TASKS` 冻结字段位留空（`/goal` 授权直接实现，未走编排器门）。
