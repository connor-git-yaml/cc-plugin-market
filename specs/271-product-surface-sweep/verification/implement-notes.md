# F271 实现笔记（Phase 4 收口记录）

> 执行档位说明：implement 主体由 opus 子代理完成；收口段两次 Task 委派均死于宿主环境（600s 看门狗停摆 / 主机休眠杀流），按委派合同降级通道转主编排器 inline 完成。最终报告标注 `[DEGRADED: inline-execution — implement 收口 — 宿主休眠反复杀死后台子代理]`。

## T001-T016 完成矩阵

| 任务 | 状态 | 说明 |
|---|---|---|
| T001 TS/JS 主路径 lineRange | ✅ | `src/knowledge-graph/index.ts`（symbol 写 `{start,end}`，member 诚实缺席） |
| T002 Python 第四路 lineRange | ✅ | `src/adapters/python-adapter.ts`（带 hasSpan 数值校验） |
| T003 graph-builder 双分支透传 | ✅ | 补齐分支 + 新建分支，形状校验后透传 |
| T004 消费侧激活测试 | ✅ | `tests/integration/f271-linerange-consumer-activation.test.ts` |
| T005 byte-stable 双跑 | ✅ | sha `8d5a3f01e09faeda99b1a9252cb0667e810dd17013e232f509ae381f6d6214b1` 两跑相等；活图 7712 nodes / 13123 links / **2863 lineRange** |
| T006 micrograd 外部 A/B | ✅ | A（基线 dist）33/38/0 → B（新 dist）33/38/**7**；字段级全量 diff 唯一差异 `meta:lineRange`，links 逐字节相等；self-dogfood 第二口径 7712/13123，A 0 → B 2863，同样唯一差异。A 侧出处已验（基线 src+dist 零 lineRange） |
| T007 prepare 前置校验 | ✅ | 裸 `statSync`、`file-not-found`、message 只回显 basename（F180 脱敏）；两个新用例含"前置短路未调 orchestrator"与"存在路径仍脱敏 internal-error" |
| T008 graph_community 诚实化 | ✅ | `anyCommunityDataExists` 二分文案；返回结构不变 |
| T009 description 修正 + hyperedges 诚实化 | ✅ | `describeEmptyHyperedges` 纯函数 + 空结果 message |
| T010 7 处 "c-0"→"0" | ✅ | grep 归零 |
| T011 恢复提示统一 | ✅ | FR-013 五处 + **追加 3 处**（见"偏离与追加"） |
| T012 plugins README 18 工具 | ✅ | 四组分表 + 12 免认证工具认证说明 |
| T013 index 退出码 2→1 | ✅ | 附单测 |
| T014 顶层 README 修正 | ✅ | 17→18、topK→limit、filter→label/node_id |
| T015 cli-reference 综合 | ✅ | `--output-dir` ×4、Exit Codes 章节（含 BUDGET_EXCEEDED=3 与 graph-quality 已知例外）、5 子命令 + scaffold-kb 3 op 补齐 |
| T016 release-contract 文案 | ✅ | v4.5.0 领头 + `product-mapping.yaml` 同步；release:check 通过 |

## 偏离 tasks.md 与追加（全部有据）

1. **R1 追加**：`agent-context-tools.ts` 两处 + `file-nav-tools.ts:140` 的 `graph-not-built` hint 从裸 `spectra batch` 统一为 graph-only 措辞（spec FR-013 未圈入，但属卡面 ③"提示统一"意图与复核账 ③ 点名面）。连带更新 `tests/unit/mcp/agent-context-sanitize.test.ts:118` 的钉文案断言（其守护目的"固定文案 + 不漏绝对路径"不变）。
2. **F180 冲突裁决**：初版 file-not-found message 回显完整 targetPath 会破 F180 e2e 脱敏不变量（`assertNoSensitiveData`）→ 改回显 `basename`；本卡新增的 response-contract 用例断言同步改为 basename + 反断言全路径。
3. **feature-180-error-envelope T-007-2 期望更新**：`emptyDir` 实际不存在于盘上，本卡后确定性返回 `file-not-found` → 断言从允许列表收窄为精确 `toBe('file-not-found')`。守护不变量（统一 envelope + 不漏敏感信息）不变。
4. **f220 charter 快照再冻结**：8 键失配全部为 lineRange 纯追加（合法行为变化被守护抓到）。处置：受控 `-u` 仅限该文件 + **全量 diff 审计**（104 行 = 26 个 lineRange 块 × 4 行，零删除零异类）。⚠️ 过程中两次出现「场景7 冻结 2」污染键——由**并发双 vitest 实例**写同一快照文件所致（一次为死亡子代理遗留、一次为主编排器误启后台重跑），均已清除并由场景10a 键集合守护复核。**教训：全量 vitest 期间禁止并发第二个 vitest 实例。**
5. **collector-fingerprint-guardrail pinned 资产再生**：护栏比较器只比 id/边 multiset（metadata 盲），比较路径判"一致"而"已 bump 重写"路径序列化全量含 lineRange → digest 失配。基线 A/B 证实为 F271 真回归（基线绿）。处置：删两资产走脚本 `--init` 冷启动（受批准路径），再生后**剥 lineRange 深等基线**（两份资产均验证），13/13 复绿。护栏"metadata 盲区"作为观察记入 dogfooding 反馈。

## 验证总账（Phase 4.5 编排器独立验证）

- `npx vitest run`：**7924 passed / 0 failed**（541 文件；首轮 11 failed 系误启后台 vitest 双实例竞争假红，串行复跑归零）
- `npm run build`：零 TS 错误
- `npm run repo:check`：全 pass
- `npm run release:check`：valid（publish-gap indeterminate = 已知 fail-loud 正常态，npm registry 缺 gitHead）
- `npm run test:plugins`：0 失败
- byte-stable（SC-001）：✅ 双跑 sha 相等
- 外部语料 A/B（SC 附加口径）：✅ micrograd + self-dogfood 双语料，唯一差异 lineRange

## 改动文件清单（供显式路径 git add）

源码：`src/knowledge-graph/index.ts`、`src/adapters/python-adapter.ts`、`src/panoramic/graph/graph-builder.ts`、`src/panoramic/graph/graph-query.ts`、`src/mcp/server.ts`、`src/mcp/graph-tools.ts`、`src/mcp/agent-context-tools.ts`、`src/mcp/file-nav-tools.ts`、`src/cli/commands/index.ts`、`src/cli/commands/graph-quality.ts`
测试：`src/panoramic/graph/graph-builder.test.ts`、`tests/unit/knowledge-graph-derive-nodes-metadata.test.ts`、`tests/adapters/python-adapter.test.ts`、`tests/unit/mcp/response-contract.test.ts`、`tests/unit/mcp/agent-context-sanitize.test.ts`、`tests/integration/156-w2-spectra-index.test.ts`、`tests/panoramic/graph-tools-v2.test.ts`、`tests/e2e/feature-180-error-envelope.e2e.test.ts`、新增 `tests/panoramic/graph-query-community-honesty.test.ts`、`tests/integration/f271-graph-recovery-hint.test.ts`、`tests/integration/f271-linerange-consumer-activation.test.ts`
守护资产：`tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap`、`tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json`、`expected-module-graph.json`
文档/合同：`README.md`、`plugins/spectra/README.md`、`docs/spectra-cli-reference.md`、`contracts/release-contract.yaml`、`specs/products/product-mapping.yaml`、`skills/spectra-batch/SKILL.md`、`skills/spectra/SKILL.md`、`src/skills-global/spectra-batch/SKILL.md`、`src/skills-global/spectra/SKILL.md`、`plugins/spectra/skills/spectra-batch/SKILL.md`、`plugins/spectra/skills/spectra/SKILL.md`
图产物：`specs/_meta/graph.json`（graph-only 重建，含 lineRange）
制品：`specs/271-product-surface-sweep/**`

---

# 对抗审查修复轮（2026-08-31）

两角异构对抗审查裁决落地，共 9 组（F1–F9）。以下"验证数字"均为本轮实跑输出，非推演。

## F1–F9 状态矩阵

| 项 | 内容 | 状态 | 落点与证据 |
|---|---|---|---|
| **F1** | 同名符号 lineRange 取并集（原 first-wins 会让重载符号只剩签名行） | ✅ | `src/knowledge-graph/index.ts`（`seen` 由 `Set` 改 `Map<id, UnifiedNode>` + `mergeNodeLineRange`，**其余 metadata 仍 first-wins**，不动 F214 身份合同）；`src/adapters/python-adapter.ts`（文件内按 symbolId 聚合，首条定形状、lineRange 并集）；`src/panoramic/graph/graph-builder.ts` 合流补齐分支改并集 + **注释改写**（原注释"两侧同源等值"是错的，已如实改为"不保证等值 ⇒ 不等时取并集"） |
| **F2** | regex 退化条目诚实缺席 | ✅ | 新增 `src/knowledge-graph/line-range.ts` 的 `isRegexFallbackSymbol`；两个生产端统一走 `lineRangeFromSymbol`。核实到退化路径**有三条**（python / go / java-like，`tree-sitter-fallback.ts:313/406/490`），三者 span 一律 `i+1` 单行，前缀均为 `[REGEX] ` |
| **F3** | 结构校验对称强化 | ✅ | `normalizeLineRange`：`Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start`，三处（unified 生产端 / python extraction / graph-builder 合流）共用同一 helper，消除镜像实现 |
| **F4** | view_file 消费端诚实 warning | ✅ | `src/mcp/file-nav-tools.ts`：`lineRange-unavailable`（symbol 解析成功但无行号：member 节点或旧图）、`lineRange-clamped`（symbolId 区间被 `sliceLines` 钳制 ⇒ 图中行号越界）。clamp 检测**只对 symbolId 来源**生效（显式行号被钳制是调用方自己传的越界值） |
| **F5** | prepare 前置校验不对可访问性异常说谎 | ✅ | `src/mcp/server.ts`：仅 `ENOENT` / `ENOTDIR` 返回 `file-not-found`，其余 rethrow 落 `withTelemetry` 脱敏 `internal-error`。可测——用超长路径段触发 `ENAMETOOLONG`（实测 macOS/Linux 均产该 errno），无需 mock |
| **F6** | hyperedges「三前置」文案纠偏 | ✅ | `describeEmptyHyperedges` + `graph_hyperedges` 工具 description + `plugins/spectra/README.md`：改为"启用条件清单 + **必要非充分**"。两处证伪已核实：设计文档来源不限 `docs/project/`（`batch/stages/source-discovery.ts:108-122` README/module spec/project-context 均算）；第四道闸是 budget gate（`batch-orchestrator.ts:1322-1324` `!budgetSkipEnrichmentAll`）+ LLM 是否提取到协作面 |
| **F7** | 死胡同残留与文档失真收尾 | ✅ | `scripts/sync-worktree-local-state.sh:693` → `spectra batch --mode graph-only`；`docs/scaffold-kb-guide.md:17`、`docs/repository-architecture.md:64` 17→18；`plugins/spectra/README.md` 认证说明补 `panoramic-query` 例外（`src/panoramic/qa/index.ts:232-237` 无认证直接抛错、不降级）；`graph-query.ts` `CommunityResult.message` docstring 随新文案更新；`docs/spectra-cli-reference.md` Exit Codes 两处失真 |
| **F8** | 护栏绕过留痕 + 存量图提示 | ✅ | `collector-fingerprint.ts` 在 `BEHAVIOR_VERSION = 3` 注释块加"判定为**不 bump** 的留痕"（**值未改、`BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 数组未动**，SC-016 逐类断言不受影响）；fixture README 追加"再生记录 · 2026-08-31"；cli-reference 加存量图提示块（与 F4 的 `lineRange-unavailable` 呼应） |
| **F9** | CHANGELOG | ✅ | `CHANGELOG.md` 新开 `## [Unreleased]`，Added 2 条 / Fixed 5 条，全部注明 Feature 271 |

## Exit Codes 章节的两处诚实化（F7 细目）

1. 「never calls `process.exit()` directly」→ 改为"约定如此，长驻进程例外"。实测全仓 `process.exit(` 非测试出现 4 处：`cli/commands/watch.ts:62/152`、`cli/commands/mcp-server.ts:85`、`hooks/hook-installer.ts:166`。第 4 处**不是** CLI 进程——它在生成的 hook shell 脚本内嵌的 `node -e` 片段里，文档按此如实区分。
2. code 1 新增 `2b` 行："检查未通过"语义。实证：`cli/commands/diff.ts:64-67`（HIGH **或 MEDIUM** → `TARGET_ERROR`，仅 LOW → 0）、`cli/commands/direction-audit.ts` 多处 `exitCode = 1`。写 CI 脚本时勿与"路径错误"混同。

## 前提迁移：F250 T-overload 探针被改写（非放宽）

`tests/adapters/python-adapter.test.ts` 的 `T-overload` 原先钉死「extraction 路本身**不**去重（`rawNodes` 恰为 2）、收敛只由写入层 upsert 提供」，并在注释里写明"若未来解析层自己去重了，本前提失效"。F1 把折叠前移到 extraction 侧后，该断言**按设计 fail-loud 报出了这次前提变化**。

处置：显式改写而非放宽为 `>= 1`——
- 新前提：extraction 侧恰为 1 条节点；
- **防假绿锚点换成"并集"而非"条数"**：`ov.pyi::parse` 的 `lineRange` 必须是 `{start: 3, end: 6}`（两条 overload 分别在 3-4 / 5-6 行）。退化为 first-wins 则 `end` 停在 4，退化为 last-wins 则 `start` 滑到 5，两种都会红；
- 写入层 upsert 幂等收敛的原断言（`nodeMap` / `edgeMap`）原样保留。

## 验证数字（全部实跑）

| 项 | 命令 | 结果 |
|---|---|---|
| 构建 | `npm run build` | 退出码 0，零 TS 错误 |
| 定向 8 文件 | `npx vitest run tests/unit/knowledge-graph-derive-nodes-metadata.test.ts tests/adapters/python-adapter.test.ts src/panoramic/graph/graph-builder.test.ts tests/integration/f271-linerange-consumer-activation.test.ts tests/unit/mcp/response-contract.test.ts tests/panoramic/graph-tools-v2.test.ts tests/unit/sync-worktree-local-state.test.ts tests/integration/collector-fingerprint-regen-script.test.ts` | **8 files / 259 tests passed / 0 failed** |
| f220 charter 快照 | `npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts` | **12 passed / 0 failed，未动快照（禁 `-u` 未触发）**；本轮改动不影响该 fixture（无同名符号、无 regex 退化条目） |
| 护栏 | `npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` | **23 passed**（pinned 资产与本轮 F1/F2/F3 后的生产端仍一致，未再次再生） |
| 全量 | `npx vitest run` | **541 files passed / 4 skipped；7947 passed / 0 failed / 18 skipped / 21 todo，退出码 0**（修复轮前为 7924，+23 为本轮新增用例） |
| 仓库门禁 | `npm run repo:check` | 退出码 0，88 项全 pass |
| byte-stable 双跑 | `node dist/cli/index.js batch --mode graph-only` ×2 | 两跑 sha256 均 `de9534b8432f2304de345634a26b8b52960f33518b6036501a512a8b701b89b7` |

### lineRange 计数变化的归因（2863 → 2869，+6）

差值**全部**来自本轮新增的源文件 `src/knowledge-graph/line-range.ts`，其导出恰为 6 个符号，逐一核实带 lineRange：

```
line-range.ts::LineRange {"start":15,"end":18}
line-range.ts::REGEX_FALLBACK_SIGNATURE_PREFIX {"start":24,"end":24}
line-range.ts::isRegexFallbackSymbol {"start":33,"end":35}
line-range.ts::normalizeLineRange {"start":43,"end":51}
line-range.ts::mergeLineRanges {"start":60,"end":62}
line-range.ts::lineRangeFromSymbol {"start":69,"end":76}
```

即 2863 + 6 = 2869，**非行为漂移**。同源解释覆盖节点数变化 7712 → **7721**（+9 = 1 个 module 节点 + 6 个 symbol 节点 + `LineRange.start` / `LineRange.end` 两个 member 节点），links 13123 → **13145**（新文件的 contains / depends-on / calls 边）。同图 `LineRange.start` / `LineRange.end` 两个 member 节点仍诚实缺席（FR-002 不变量在活图上复验通过）；全图 member 节点带 lineRange 的条数实测 **0**。

### pinned 资产"剥 lineRange 深等"审计（F8 引用的那份）

对 `tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json` 做工作区版 vs `git show HEAD:` 版比较，递归剔除全部 `lineRange` 键后 `JSON.stringify` 严格相等：

```
strip 后深等: true
当前 pinned 资产 lineRange 条数: 10
HEAD 版 lineRange 条数: 0
```

即该资产的变化面**只有** lineRange 纯追加，没有夹带其他漂移。

## 新增/改动文件（本轮增量）

- 新增：`src/knowledge-graph/line-range.ts`（三处共用的 helper：`normalizeLineRange` / `mergeLineRanges` / `isRegexFallbackSymbol` / `lineRangeFromSymbol`）
- 源码：`src/knowledge-graph/index.ts`、`src/adapters/python-adapter.ts`、`src/panoramic/graph/graph-builder.ts`、`src/panoramic/graph/graph-query.ts`、`src/mcp/file-nav-tools.ts`、`src/mcp/server.ts`、`src/mcp/graph-tools.ts`、`src/panoramic/graph/collector-fingerprint.ts`（仅注释）
- 测试：`tests/unit/knowledge-graph-derive-nodes-metadata.test.ts`、`tests/adapters/python-adapter.test.ts`、`src/panoramic/graph/graph-builder.test.ts`、`tests/integration/f271-linerange-consumer-activation.test.ts`、`tests/unit/mcp/response-contract.test.ts`、`tests/panoramic/graph-tools-v2.test.ts`
- 脚本 / 文档：`scripts/sync-worktree-local-state.sh`、`docs/spectra-cli-reference.md`、`docs/scaffold-kb-guide.md`、`docs/repository-architecture.md`、`plugins/spectra/README.md`、`CHANGELOG.md`、`tests/fixtures/collector-fingerprint-guardrail/README.md`

---

# Rebase 交互轮（2026-08-31，F272 先交付后）

F272（125bfdb3）先落 master，其新增守卫 `tests/integration/graph-quality-pinned-staleness.test.ts` 用当前 builder 重建四语言 fixture 图并与 pinned 资产全字段深比较——F271 的 lineRange 生产使四份 pinned 资产如实报 `stale`（4 failed，守卫正常工作，非缺陷）。处置：
- 按各 fixture README SOP + 守卫同款流程（staged 临时目录 → `batch --mode graph-only`）再生四份：ts 10/14/+4、java 18/13/+5、go 13/9/+6、micrograd 33/38/+7（与 T006 外部语料 A/B 数字一致）
- 审计：四份均「剥 lineRange/builder/generatedAt 后与旧资产深等 = true」，节点/边零变化
- 账本冲突（dogfooding-feedback-ledger 双卡同加待处理条目）：两条目均保留
- 复测：staleness + lang-matrix + agent-context-real-graph + mcp-server-stdio + pinned-asset-swap = 37/37 绿
