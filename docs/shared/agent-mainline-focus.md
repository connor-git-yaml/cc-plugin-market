## 当前主线焦点

- 当前 `master` 处于 **M10 批次 3 全 ship + 4.6.0 待发布**（M9 已于 2026-09-12 正式收官，T062/T063 人工验证全闭合）：M10 路线图 SSoT 见 `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md`（§11 进展账 rolling、§12 架构审查结论与债务清单、§12.4 批次 3 派发与债务结账）。
- **M10 主题**：先发布、诚实的图、换证据源的门禁。Gate 0 已完成；P0 四卡 B/C/D 已 ship，P0-A 走证据账本路线（F270）+ 卡 C（F276）+ **门禁串行链 F287 卡 A → F288 卡 B → F289 续做/旁链入口卡全部 ship**，残余安全面由 F290 收口。
- **批次 3 已全 ship**：F280（panoramic-query 缓存失效 + 诚实 envelope）/ F281（F213 e2e 真实 home 隔离）/ F282（G0-4 尺子）/ F283（hooks 归属表派生化，门禁类）/ F284（采集面 SSoT 忽略目录 + 护栏三维）/ F285（发布 / CI 门补齐）/ F286（P1-K 移交承接）/ F287 / F288 / F289 / F290。
- **发布状态**：`contracts/release-contract.yaml` 两产品已置 `4.6.0` 并经 `release:sync` 派生，CHANGELOG `[4.6.0]` 条目已补齐；**`npm publish` 由用户本人执行，agent 不得自行发布**。npm registry 当前 latest 仍为 4.5.0。
- **裁决不变量**：builder 戳只可见不判定（F261 D1）；相似度命中永不进 impact/context；图解析类改动验收必带外部语料 A/B；门禁/判定器/守护/安全类改动的异构对抗为**常设档位**（不随 Codex 配额恢复取消）；一次性验证 dump 不入库只留重算器；禁 stash/checkout 做隔离；**冻结型行为快照严禁 `vitest -u` 再生，只允许外科替换 + 零漂移审计**（F223/F259，4.6.0 升版再现）。
- **架构债（M11 移交，立卡前按 §12 证据复核）**：runBatch 单函数 / graph.json 三套装配 / LLM kernel ≥6 处 / git 访问 7 模块无 killSignal / 诊断族无共享结果模型 / 判定器三套回执索引 / tests 类型零覆盖 543 处等——不塞 M10。批次 3 收官新增：**fix-compliance 阻断预算 per-target 化**（F291a 已设计、刻意未交付，设计稿 `docs/design/f291-per-target-budget-and-reentry-corroboration.md`，须独立立卡，禁在已交付安全门上于发布前叠改状态模型）/ F288 R-6 / stop_hook_active 第三佐证腿（F291b 待用户拍板）。
- 处理 Spectra / 知识图谱任务时继续沿用 `ProjectContext`、`GeneratorRegistry`、`ParserRegistry`、`AbstractRegistry`、`AbstractConfigParser`；保留 AST-only 静默降级，不创建平行 registry、graph 或 retrieval kernel（内核 v1 在既有 graph-query + FTS5 上做 RRF，不新建栈）。
