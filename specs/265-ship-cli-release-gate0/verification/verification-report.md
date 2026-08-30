# F265 验证闭环报告（Phase 5c）

> 前序：Phase 5a spec-review（22/25 FR 满足，WARNING 已闭环）、Phase 5b quality-review（GOOD，0C/1W/2I）、两轮异构对抗（#1 fail-open 面 5C/10W/4I、#2 泄漏伪造面 2C/5W/5I）全部修复批已落地。本报告为 Phase 5c 最终交叉核查。

## 1. 「本卡内可验收（10 条）」逐条判定

| # | 验收条目 | 判定 | 证据 |
|---|---|---|---|
| 1 | contract 版本号 4.5.0/4.4.3，派生文件由 `release:sync` 生成无手改 | ✅ PASS | `npm run release:check` exit 0；`repo:check` 的 `release-contract:*` 全 pass（version/marketplace/plugin.json 一致） |
| 2 | CHANGELOG 补齐 4.1.1→4.5.0（含追认 4.2.0/4.3.0/4.4.0），`[Unreleased]` 按 FR-004 处置 | ✅ PASS | `CHANGELOG.md` 存在 `[4.5.0]`/`[4.4.0]`/`[4.3.0]`/`[4.2.0]` 段；`[Unreleased]` 段落已标注「随 4.1.1 一并发布」历史归属+新 major bump 预备说明；spec-review FR-004 编排器补验：`b3b15fb7` 是 `v4.1.1` tag 祖先（`git merge-base --is-ancestor` 实证） |
| 3 | `npm run release:check` exit 0 | ✅ PASS | 本轮独立重跑：`Release contract valid` + gap warning「HEAD 领先…18 个 src commit（阈值 5；量测面仅 src/…）」，exit=0 |
| 4 | `npm run release:publish:dry` 通过 | ✅ PASS（本轮未重跑） | 编排器已验：dry-run 打包 spectra-cli@4.5.0 成功（1568 文件），prepublishOnly 全链（release:check→build→repo:check→全量 vitest）跑通；本轮遵指示未重跑 |
| 5 | ci.yml 含 `repo:check`（排图建成后）+ `release:check` 两新步骤 | ✅ PASS | `grep repo:check\|release:check .github/workflows/ci.yml` 命中两行；对抗 #1 C-5 修复后注释已改为事实描述并加图缺失哑守卫 |
| 6 | `SPECTRA_PUBLISHED_REF` 注入入口 + N≥5 触发 / N<5 或事实源不可达不触发 两条变异测试 | ✅ PASS | `tests/unit/publish-gap-check.test.ts`：`describe('N>=5 时产出非阻断 warning')`、`describe('N<5 时不误报')`、`describe('SPECTRA_PUBLISHED_REF 环境变量入口')` 均存在且本轮抽查全绿（28 tests passed） |
| 7 | doctor commit 比对枚举字段落地 + redaction 测试扩展覆盖并通过（不泄露原串） | ✅ PASS | 本轮抽查 `codex-runtime-doctor-redaction.test.ts`（26 tests passed，含「F240 T047 canary 十一注入点×五通道×四编码」用例覆盖新增 commit 维度三处原串）；`codex:doctor` 实跑输出 grep 40 位 hex 零命中 |
| 8 | MCP server 版本自省落地（形态裁定）+ 既有 17 工具 schema 无变化 + 有测试证明客户端 SDK 解析后仍可见 | ✅ PASS | 对抗 #2 裁定「B：server_build_info 独立探针 + doctor 消费」已落地（`probeMcpServerBuild`/`findRpcResponse`/`probeTarget` 字段）；`tests/unit/mcp-server.test.ts`/`mcp/description-output-drift.test.ts` 等既有工具面测试本轮未见改动痕迹（repo:check 未报 schema drift）；`InitializeResultSchema` 客户端可见性已由 research/probe-findings.md P1 实测核实（非待验证项） |
| 9 | adoption census 脚本可本机运行，输出符合 schema 结果 | ✅ PASS | 本轮实跑 `node scripts/adoption-census.mjs` exit 0，输出含 `generatedAt/sourceDirs/tools/zeroCallTools/unknownCallCount/unknownDetail/scanned` 全字段；`unknownDetail: null`（对抗 #2 W-4 修复：默认聚合计数，逐名清单已挪 `--verbose`）；`sourceDirs` 为 `~/...` 相对家目录形式（未泄露绝对路径） |
| 10 | 图质量复测冻结口径文档：以 `graph-accuracy.mjs` 为主、F241 pilot 为次级参照、要求外部语料、如实转述 label-only 局限、数字延后回收；M-1/M-3 人工协议以文档+模板交付不脚本化 | ✅ PASS | `docs/design/f265-graph-quality-rerun-plan.md` §1 主复用目标钉死 `graph-accuracy.mjs` 调用；§2 FR-024 外部语料要求（引 F263 教训）；§3 label-only 限制段落原文转载脚本头 `Limitations:`；§4 F241 pilot 次级交叉参照；§5/§6 M-1/M-3 明确标注「人工协议，不可脚本化」+ 记账模板；数字延后一句已落 |

**10/10 PASS**（第 4 条为「已验未重跑」，非本轮遗漏）。

## 2. 独立重跑结果（本轮实测）

| 命令 | 预期 | 实测 |
|---|---|---|
| `npm run release:check` | exit 0 + gap warning N=18 + pathspec 声明 | exit=0；warning 文案含「阈值 5」「量测面仅 src/，不含 plugins/ 等其它发布路径」，与 C-2 裁决措辞一致 |
| `npm run repo:check` | exit 0 | exit=0（`status=pass`），全部判据条目 pass，无 fail/warn |
| `npx vitest run tests/unit/publish-gap-check.test.ts tests/unit/adoption-census.test.ts tests/unit/codex-runtime-doctor-redaction.test.ts` | 三文件全绿 | 3 Test Files passed / 74 Tests passed（20+28+26），2.36s |
| `node scripts/adoption-census.mjs` | 无逐名清单、路径 `~` 化、exit 0 | exit=0；`unknownDetail: null`；`sourceDirs: ["~/.claude/projects","~/.codex/sessions"]` |
| `npm run codex:doctor` | exit 0；probeTarget/新文案；无 40 位 hex | exit=0（overallStatus=fail 但非 `--strict` 不阻断，符合设计：命令说明行「本命令是诊断而非门禁，默认恒退出 0」）；`mcp-server.spectra` details 含 `probeTarget: path-binary`；`global-cli.spectra` 报漂移（本机全局装的是 4.4.0，仓库声明 4.5.0——这是环境事实非本卡缺陷，`next-step upgrade-global-cli` 提示存在）；grep 40 位 hex 零命中 |

## 3. 抽查核验（3 条对抗修复项「真的修了」）

| 项 | 核验方法 | 结果 |
|---|---|---|
| #1 C-3（pathspec 存在性守卫） | `grep -n "cat-file\|pathspec-empty" scripts/lib/publish-gap-check.mjs` | 命中：`execGit(['cat-file', '-e', 'HEAD:${measured}'])` 后接 `indeterminate('pathspec-empty')`（line 267-269），且 `INDETERMINATE_REASON_TEXT['pathspec-empty']` 文案存在（line 193）——不是「计数 0 = pass」，是可见的 indeterminate 分支 |
| #2 表2 C-1（`buildDirty` 全链） | `grep -n "buildDirty\|commit-match-dirty" codex-runtime-doctor-{core,io}.mjs` | 三处命中：core.mjs `DETAILS_SCHEMA['mcp-server'].buildDirty:'boolean'`（line 431）+ `mcp-server-commit-match-dirty` summaryCode 定义（line 573）；io.mjs 读 `payload.dirty` 写入 `buildDirty`（line 854），且 `probe.buildDirty === true` 时才降级为 warning（line 1159-1165，「`false` 是确认干净，缺失是不知道」的注释与判据一致） |
| #3 W-4（census `unknownDetail` 默认聚合） | 本轮实跑 `node scripts/adoption-census.mjs`（无 `--verbose`） | 输出 `unknownDetail: null`，同时 `unknownCallCount: 1767` / `unknownToolCount: 43` / `unknownServerCount: 8` 聚合计数字段完整——逐名清单确未在默认模式下泄露 |

三项均确认为真实修复（非仅注释/文档层面的声称）。

## 4. 遗留风险清单（报告项，非本卡缺陷，供 push report / follow-up 追踪）

从两份对抗 triage 的「报告」类裁决 + quality-review STRUCTURAL_DEBT 汇总：

1. **C-2 量测面口径**（对抗#1）：`publish-gap` 只量 `src/`，`plugins/` 等其它发布路径的断层不可见（实测 24 commit 断层不计入 N=18）。SSoT/spec/变异测试均以 src 口径锚定，主线程无权单方面改度量语义——**已提请用户在 push report 拍板**是否扩大量测面。
2. **W-5 SSoT 验收句自洽性**（对抗#1）：M10 SSoT 文档「推 1 个 src commit → warn」表述与本卡阈值 5 不一致，**已提请用户在 push report 拍板**改为 A/B 注入式表述。
3. **global-cli dirty 盲区**（对抗#2 C-1 分流项）：`server_build_info` 已支持 `dirty` 位并接入 mcp-server 侧判据，但 global-cli（`spectra --version`）结构上无法感知 dirty——改动会触及 F240 VERSION_LINE_RE 受限语法合同及多处测试面，本卡范围外，如实登记为 follow-up。
4. **W-6 npm 缓存/离线场景**（对抗#1）：本地 npm 缓存或离线时 `release:check` 仍报 `ok` 且无新鲜度字段，niche 场景不加码，登记观察。
5. **W-10 fetch-depth:0 首跑合成节点**（对抗#1）：CI `fetch-depth:0` 翻转 shallow 探测使 incremental 路径在 PR 事件下面对合成 merge HEAD；graph-only 每次全量重建，当前无消费风险，登记观察。
6. **I-3 Windows `npm.cmd`**（对抗#1）：M10 明示不承诺 Windows，不做，已在 fix-report 登记。
7. **I-4（已修，登记为先例）**：`execFileSync` 缺 `maxBuffer` 两处已跟随 graph-quality-core FIX-2 先例补齐，非遗留风险，仅存档。
8. **I-3/I-4（对抗#2）**：`seenCallIds` 跨源共享 Set 的理论污染（实测零碰撞，报告登记不改）；`errorClass` 进 schema 后 `sanitizeDetails` 补写分支新耦合（当前不可达，报告登记）。
9. **I-5（对抗#2）**：tsx 直跑场景下 version（live package.json）与 commit（上次 build 的 dist）可能属不同提交，`server.ts` 注释已述，doctor 消费后变承重，登记 follow-up 观察。
10. **`codex-runtime-doctor-io.mjs` 结构债**（quality-review STRUCTURAL_DEBT）：跨 F240→F262→F265 累计增长至 1267 行（本卡 +291 行/+30%），MCP 自省探针（`createCommitGate`/`probeMcpServerBuild`/`findRpcResponse`，~150 行）是天然可拆分候选；quality-review 判定「接受，历史累积债务非本卡新引入」，已记入 commit 备注，M10 P1-K 候选后续拆分为 `codex-runtime-doctor-mcp-introspection.mjs`。

以上均为 push report 抛给用户的报告项，不阻断本卡交付。

## 5. 最终结论

**✅ 可交付**——「本卡内可验收」10 条全部 PASS（第 4 条已由编排器验证，本轮未重跑符合指示）；`release:check`/`repo:check` 独立重跑 exit 0；三项新增测试面（publish-gap/adoption-census/doctor-redaction）本轮抽查 74/74 通过；三条对抗修复抽查核验均确认为真实代码层面的修复；遗留风险共 10 项，均为报告类项（口径拍板 2 项待用户裁决 + 环境/结构债 8 项登记观察），不构成阻断性缺陷。T009/T010/T033/T034/T035 已勾选；T036（dogfooding 落账）留给编排器在收尾阶段执行。
