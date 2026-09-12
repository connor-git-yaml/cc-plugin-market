## 当前主线焦点

- 当前 `master` 处于 **M9 正式收官（2026-09-12，T062/T063 人工验证全闭合）+ M10 批次 3**：M10 路线图 SSoT 见 `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md`（§11 进展账 rolling、§12 架构审查结论与债务清单）。
- **M10 主题**：先发布、诚实的图、换证据源的门禁。Gate 0 已完成（4.5.0 已发布、CI 接治理链、adoption census + 图质量复测首次取数，尺子口径缺陷已登记待 F282 修后重取）；P0 四卡中 B/C/D 已 ship，P0-A 走证据账本路线部分交付（F270）+ 卡 C（F276）已 ship，残余卡 A（F287）→ 卡 B → 续做/旁链入口卡**串行**。
- **批次 3 在途**：F280 panoramic-query 引擎缓存失效+诚实 envelope（critical）∥ F281 F213 e2e 真实 home 隔离 ∥ F282 G0-4 尺子修复 ∥ F283 hooks 归属表派生化+判据钉住（门禁类）∥ F284 采集面 SSoT 忽略目录+护栏边属性 ∥ F285 发布/CI 门补齐 ∥ F286 P1-K 移交承接 ∥ F287 卡 A（门禁链头）。
- **裁决不变量**：builder 戳只可见不判定（F261 D1）；相似度命中永不进 impact/context；图解析类改动验收必带外部语料 A/B；门禁/判定器/守护/安全类改动的异构对抗为**常设档位**（不随 Codex 配额恢复取消）；一次性验证 dump 不入库只留重算器；禁 stash/checkout 做隔离。
- **架构债（M11 移交，立卡前按 §12 证据复核）**：runBatch 单函数 / graph.json 三套装配 / LLM kernel ≥6 处 / git 访问 7 模块无 killSignal / 诊断族无共享结果模型 / 判定器三套回执索引 / tests 类型零覆盖 543 处等——不塞 M10。
- 处理 Spectra / 知识图谱任务时继续沿用 `ProjectContext`、`GeneratorRegistry`、`ParserRegistry`、`AbstractRegistry`、`AbstractConfigParser`；保留 AST-only 静默降级，不创建平行 registry、graph 或 retrieval kernel（内核 v1 在既有 graph-query + FTS5 上做 RRF，不新建栈）。
