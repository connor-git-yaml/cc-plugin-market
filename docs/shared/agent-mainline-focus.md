## 当前主线焦点

- 当前 `master` 处于 **M10 代码面收官（2026-09-14）+ 4.6.0 待 publish + M11 规划种子**：M10 文档 `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` 已 `status: closed`，收官判定与 M11 候选清单见 **§13**（§11 进展账 rolling、§12 架构审查结论与债务清单）。M11 正式路线图尚未立文件，须经 milestone-next 循环 + 用户拍板。
- **M10 主题兑现**：「先发布」随 4.6.0（`d0b0484d`）闭合，**`npm publish` 由用户本人执行，agent 不得自行发布**（npm registry latest 仍 4.5.0）；「换证据源的门禁」F270→F276→F287→F288→F289→F290 全链 ship，**本机生效待 publish + `claude plugin update`**；「诚实的图」半兑现，P1-I 诚实工具面移交 M11 首批。
- **收官挂起（用户动作门）**：publish → plugin update → G0-1 三项验收（`npm view` 4.6.0 / 全局 `spectra --version` commit == master / `judge:doctor` + `codex:doctor` 零漂移）；升级 Claude Code ≥2.1.241 后重跑 F245 headless 基线（本机 2.1.215 之后 hooks 合同改过四版，门禁链读的 Stop payload 字段未在新版验过）；4.6.0 发布满一周重跑 adoption census 与 09-12 基线对比。
- **M11 种子第一批（§13.3，可并行）**：P1-I 诚实工具面 ∥ `charterPayload` 版本归一化（升版不再触冻结快照）∥ publish-gap 自证（commit 进 tarball）；**F291a per-target 阻断预算串行**于 publish 活体验证 + F245 基线重跑之后。第二批：P1-F 多语言 parity / 对抗审查纪律 story / P1-H 评测前置。**F291b 裁决暂不实施**（反转 F270 既有裁决 + headless 未实测 + 已有 `enforcement: warn` 逃生口）。
- **裁决不变量**：builder 戳只可见不判定（F261 D1）；相似度命中永不进 impact/context；图解析类改动验收必带外部语料 A/B；门禁/判定器/守护/安全类改动的异构对抗为**常设档位**（不随 Codex 配额恢复取消），且**对抗 prompt 须把「论据本身」列为攻击面**（4.6.0 实证：三条论据全被判无效而结论成立）；一次性验证 dump 不入库只留重算器；禁 stash/checkout 做隔离；**冻结型行为快照严禁 `vitest -u`，外科替换的验收 = 回代重建 + 逐字节零残差 + preimage，禁用「diff 过滤后为空集」**（会吞 `currentHash` 类骨架漂移）。
- **架构债（M11 移交，立卡前按 §12 证据复核）**：runBatch 单函数 / graph.json 三套装配 / LLM kernel ≥6 处 / git 访问 7 模块无 killSignal / 诊断族无共享结果模型 / 判定器三套回执索引 / tests 类型零覆盖 543 处等——不照单开工。
- 处理 Spectra / 知识图谱任务时继续沿用 `ProjectContext`、`GeneratorRegistry`、`ParserRegistry`、`AbstractRegistry`、`AbstractConfigParser`；保留 AST-only 静默降级，不创建平行 registry、graph 或 retrieval kernel（内核 v1 在既有 graph-query + FTS5 上做 RRF，不新建栈）。
