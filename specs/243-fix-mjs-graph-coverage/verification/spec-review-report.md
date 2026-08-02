# Spec 合规审查报告（F243, fix 模式 — Phase 4a）

> 归档说明：4a spec-review 子代理的工具面无 Write，报告由编排器按其最终回复原文代为归档落盘，内容未作修改。

> **数字时效括注（2026-08-03 补）**：本报告提及的图节点/边数字（6098/8066 → 7048/9648）采集于旧底座（`2e3a4cd`）。
> 本 fix 已 rebase 至 `264338b` 并重测，旧数字已作废，**最新数字见 `node-edge-totals.json`**（before 6102/9438 → after 7052/11792）。
> 报告中「总节点/边数缺归档 JSON 锚定」的 WARNING 已由 `node-edge-totals.json` 闭合，重测版本同样归档于该文件。

审查对象：fix-report.md（根因）/ plan.md（方案 A）/ tasks.md（T001-T011）与工作树未提交改动的一致性。本 fix 无独立 spec.md（fix 模式无 FR 清单），审查基准改为 plan.md「变更清单（8 条）」+「不在本次范围」清单。

## 逐条改动状态

| # | plan.md 条目 | 状态 | 证据 |
|---|------|------|------|
| 1 | `walkTsJsFiles` 白名单加 `.mjs`/`.cjs` + docstring 同步 | 已实现 | `src/batch/stages/source-discovery.ts:513-522`（endsWith 分支已加两扩展）；L392、L481 docstring 已改；L484-488 新增 F243 归属注释 |
| 2 | `source-commit.ts::TSJS_COLLECTOR_EXTENSIONS` 镜像扩容 | 已实现 | `src/panoramic/graph/source-commit.ts:36-38`，含 6 扩展，L35 注释未改（符合 plan 指示） |
| 3 | `ignore-oracle.ts::TSJS_EXTENSIONS` 镜像扩容 | 已实现 | `src/panoramic/graph/quality/ignore-oracle.ts:112-114`，含 6 扩展 |
| 4 | `source-commit.test.ts` FIX-4 断言按新面更新 | 已实现 | `src/panoramic/graph/source-commit.test.ts:242-253`，`expected` 集合含 `.mjs/.cjs` |
| 5 | 新建 `source-discovery.test.ts` 收集回归测试 | 已实现（落点有登记偏差） | 实际落在 `tests/batch/source-discovery.test.ts`，覆盖三用例（exports 派生、import 解析、忽略目录剪枝）；tasks.md T005 已完整登记偏差原因（F220 `f220-export-surface.test.ts` 会把 `stages/**/*.ts` 判为 stage 模块，共置测试触发未授权依赖边误报）；`source-discovery.ts:9-10` docstring 确认该文件为 `@internal`，佐证守护逻辑成立 |
| 6 | `ignore-oracle.test.ts` 新增 `.mjs` 路由用例 | 已实现（覆盖优于计划） | `ignore-oracle.test.ts:126-140` 新增 `tmp/a.mjs`（仍 ignored）、`venv/a.mjs`（不 ignored）、`venv/a.cjs`（不 ignored）三用例，比 plan 承诺的 2 个用例更完整 |
| 7 | M9 §7.5.4 文档落账 | 已实现，数字基本可溯 | `docs/design/milestone-M9-codex-trusted-live-graph.md:254-283`。symbol 节点 5099→5849（+750）、containsCoverage ratio 100%、五指标全 pass、全节点零度率 2.18%→1.46%，与 `verification/{before,after}-graph-quality.json` 逐条一致。**总节点/边数 6098/8066→7048/9648（+950/+1582）未见于任何已归档 JSON**（before/after-graph-quality.json 只含 symbol 级字段，不含图全量 nodeCount/edgeCount），推测来自对本地未入库 `specs/_meta/graph.json` 的一次性统计；量级与 symbol +750、200 新增 module 节点、1582 新边的归因描述自洽，但缺一份可复核的归档文件锚定 |
| 8 | `src.spec.md` 噪声还原（条件触发） | 未触发/无需处置 | tasks.md T011 标为 `[~]`，未见异常改动登记 |

## tasks.md 对应性

T001-T010 全部 `[x]`，T011 `[~]`（未触发，符合设计）。每项验证方式均有落地证据，未发现"勾选但代码缺失"。T005 落点偏差登记具体、可核实（点名具体守护测试文件），且处置选择迁移测试而非放宽门禁，符合"不为迁就改动放宽门禁"的原则。

## 根因闭合完整性

fix-report.md「同源问题」列出的 3 处（source-discovery.ts / source-commit.ts / ignore-oracle.ts）均已修改，无遗漏第四处。「类似模式（安全不改）」6 处经 Grep 核实：`data-model-generator.ts`、`drift-orchestrator.ts` 均无 `.mjs/.cjs/.mts/.cts` 相关改动痕迹，与判定一致。

## Scope 越界检查

- `.mts`/`.cts`：未越界，三处源码 Grep 仅在注释文字中出现（说明已知残留），无判定分支被加入
- 方案 B（walk 直接消费 adapter.extensions）：未采纳，仍是 endsWith 硬编码
- `data-model-generator.ts` / `drift-orchestrator.ts`：未触及

未发现越界改动或 spec/plan 未定义的公共 API/行为面新增（三处改动均为常量字面量扩容，签名/导出面均未变）。

## 问题分级汇总

- **CRITICAL：0**
- **WARNING：1** — 文档落账中的总节点/边数（6098/8066/7048/9648）缺乏归档 JSON 锚定，仅能靠 symbol 级数字与归因描述做量级自洽核对，无法逐位复核；建议补一份轻量 `node-edge-totals.json` 快照闭合可验证性
- **INFO：1** — T005 测试文件落点相对计划发生目录偏移（`tests/batch/` 而非 `src/batch/stages/`），已在 tasks.md 完整登记原因，不构成合规问题

## 结论

**PASS**（伴 1 条 WARNING、1 条 INFO，均不影响交付判定）。三处根因同源修复全部落地、无第四处遗漏；测试同步充分且偏差登记透明；文档落账与已归档验证数据基本一致（仅总节点/边数缺独立归档文件佐证）；未发现 scope 越界或未声明行为/API 变化。
