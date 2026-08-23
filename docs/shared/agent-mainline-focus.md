## 当前主线焦点

- 当前 `master` 处于 **M9 代码面收官（2026-08-23）+ M10 规划启动**：M9 正式收官仍挂 T062/T063 两项人工验证（须在 Codex ≥0.149 且 M10 P0-B 双注册守卫落地后执行）；M10 路线图见 `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md`，取代 M9 文档 §10 的排期。
- **M10 主题**：先发布、诚实的图、换证据源的门禁——M9 的可信活图链（F243–F263）从未发布到 npm，先发出去、量出来，再做返回面诚实化与门禁证据源换代；可浏览 Wiki 移交 M11。
- **Gate 0（硬前置）**：发布 spectra-cli 4.5.0 + CHANGELOG 补齐、CI 接 `repo:check`/`release:check`、MCP 版本自省与 doctor 按 commit 比对、发布后 adoption census 与 F241 冻结口径复测作为 M10 对照基线。
- **P0 四卡**：A 门禁证据源换代（hook 侧实时账本 + `background_tasks` 判在途，收 GATE 暂停误判 / 锚点取最晚 fix 展开 / 状态竞态；门禁类，异构对抗档位）；B Codex hooks 分发纠偏（插件自带 hooks.json 为主 + 双注册守卫）；C 空图/退化图 fail-loud 链 + MCP 诚实返回面（freshness + coverage/boundary 四分）；D Claude 侧 atomic-write 缺陷群（软链跟随 / mode 保全 / 随机 tmp）。A 串行于 B。
- **P1**：产品表面清扫（lineRange 死功能等）、多语言解析 parity（Python 双 kernel）、测试资产清淤、评测前置（任务池坏题审计 + 重钉 GStack 锚）、诚实工具面（边 stage 标签 / tokenBudget / 确定性回归）、检索内核 v1（图 + FTS5，embedding 门控在离线基准上）、Spec Driver 引擎正确性（orchestrator-cli userConfig 恒空）、brainstorm 入口、Spec Drift adoption 研究。
- **裁决不变量**：builder 戳只可见不判定（F261 D1）；相似度命中永不进 impact/context；图解析类改动验收必带外部语料 A/B；门禁类改动在 Codex 配额恢复前走异构对抗档位并标注。
- 处理 Spectra / 知识图谱任务时继续沿用 `ProjectContext`、`GeneratorRegistry`、`ParserRegistry`、`AbstractRegistry`、`AbstractConfigParser`；保留 AST-only 静默降级，不创建平行 registry、graph 或 retrieval kernel（内核 v1 在既有 graph-query + FTS5 上做 RRF，不新建栈）。
