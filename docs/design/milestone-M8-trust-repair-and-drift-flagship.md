---
title: Milestone M8 — 可信度修复（双轨）+ Spec Drift 旗舰启动
status: planning (用户 2026-06-12 拍板：双轨 = 修复线 + 旗舰启动线；133 份 M7 评测答卷已抢救)
created: 2026-06-12
parent_milestone: milestone-M7-spectra-mcp-productization.md (✅ 2026-06-12 完成，F176 ship + 4.2.1 发布)
sources:
  - specs/147-competitor-evaluation-platform/PUBLISH-REPORT-M7.md (§4.5 oracle 翻案 / §4.6 触发率取证 / §5 token 经济)
  - specs/176-swe-bench-verified-cross-cohort/verification/m8-fix-candidates.md (dogfooding 四维度反馈)
  - workflow wf_a084e2f1-09b (M7 全期架构审查：28 agent / 2.4M token；28 findings → 24 对抗验证 0 证伪 → 20 worthFeature)
  - docs/design/M7-stepback-revision.md §3 + M7-stepback-revision-2.md §5 (既有 M8 roadmap，本文吸收合并)
decisions:
  - "M8 主题 = 双轨：轨道 A 可信度修复（增量正确性/触发率/评测设施/分发）+ 轨道 B 旗舰 spec drift 启动（spec+prototype，不求 ship）"
  - "133 份 F176 FAIL 答卷已立即抢救至 ~/.spec-driver-bench-patches/m7-f176/（patch/status/untracked/stream-json 四件套），M8 离线重判成本 ≈ $0"
  - "README 更新 = 事实校正（17 工具/M7 行）+ 诚实成绩（五组打平 + 触发率发现）"
amendment_2026-06-12b: 新增轨道 C（F190 领域知识 AI 脚手架 Phase 1 MVP）——厂商 SDK 知识内化 + 三方知识导入 + 工作流双库联查的通用方案，调研与完整设计见 domain-knowledge-scaffold-solution.md；Phase 2/3 列 M9（与 F189 锚定引擎合流）
amendment_2026-06-12c: 增补收尾质量门（§2.6）——F191 全期架构/代码 review（M7 wf_a084e2f1 模式正式化）+ F192 文档收口（含坐实漂移 agent-mainline-focus.md 仍停 panoramic Phase 1）；F192 完成 = M8 收官
amendment_2026-06-13: ① F182✅/F185✅ ship（体检通过：skeleton-hash 单一权威+测试假绿根因同修；repo:check 49→57 项守护）② 计划外衍生 F194✅（F182 Codex Phase 3 抓出上游 critical：三处自写 walk 不解析 .gitignore 污染 graph，单调收紧修法，与 M8 defer 的 walker 统一不冲突）③ 新增 F193（dogfooding 阻塞转化：worktree graph 开箱可用+增量保活+id 相对化；"graph 不入库"已裁决——共享缓存+保活三件套替代；设计阶段已收口）④ 执行顺序修订：F183 改为等 F193（两者同改 writeKnowledgeGraph：F193 加 portable 守卫 vs F183 归一化内聚，撞车）
执行顺序: F182✅ → F185✅ → F184 → F193(in-flight) → F183(等 F193) → F186 → F187 → F188∥F191 → F192(收官)；F189(旗舰)/F190(轨道 C) 与 F187 并行（写入路径 disjoint）
---

# Milestone M8 — 可信度修复 + Spec Drift 旗舰启动

## 0. M7 留给 M8 的三个教训（为什么 M8 长这样）

M7 的最终评测（F176，150 runs + 两次发布后翻案取证）给出的不是"产品不行"，而是**价值传导链有三处断点**：

1. **工具好但没人用**：MCP 用了的 run 通过率 43% vs 没用的 12%（最难任务 V004 上 5 次 MCP 调用产出全场最强修复），但 16/30 run 子代理零调用——**adoption 问题，不是质量问题**（PUBLISH-REPORT-M7 §4.6）。
2. **评分尺子坏了**：fuzzy-match oracle 单向惩罚"修复带测试"的框架纪律，翻案后五组完成率打平（27-37%，N=30 噪声带）；"重流程 4-12× token 无增益（小任务）"是真的（§4.5/§5）。
3. **发布链滑了**：npm spectra-cli 停在不含 F175-F181 的旧版；codex wrapper 漂移 11 天无门禁拦截；4.1.0 不含 F170a 的事故同构重演风险存续。

叠加本次 M7 全期架构审查（wf_a084e2f1，4 子系统 + 对抗验证 0 证伪）发现的**增量缓存 critical**：对外部常见项目形态（混合大小写文件名、混语言目录），F175 的默认增量是坏的——只是 npm 用户还没拿到 F175，**必须在重发 npm 前修掉**。

**双轨决策**（用户拍板）：轨道 A 把价值链修通并用重构后的评测设施复证；轨道 B 同步启动旗舰 spec drift detection 的 spec/prototype（不求 ship），保持产品前进感。

---

## 1. 轨道 A — 可信度修复线

### F182 (fix, 🔴 critical) — 增量缓存正确性

**问题**（架构审查，对抗验证证伪失败坐实）：
- **skeletonHash 读写公式分叉**（`delta-regenerator.ts:279` vs `single-spec-orchestrator.ts:173`）：写侧按 scanFiles code-unit 排序 + 目录重扫，读侧按 group.files localeCompare 排序——node 实证混合大小写文件名（如 React PascalCase 组件 + camelCase 工具混排）两序相反 → sha256 必不同 → **每轮判 skeleton-changed，增量永久 cache miss，每轮重调 LLM**。F175 省钱 SC 与 F179 byte-stable 双双静默失效。本仓库/micrograd/nanoGPT 全小写故 verify 全绿（测试 helper 逐字复刻读侧公式，结构上测不出分叉）。localeCompare 还受 ICU locale 影响，跨机 cache 不可移植。
- **混语言目录 sourceTarget 碰撞**（`regen-plan.ts:111`）：同目录 .py+.ts 时 language-split 两组共享 dirPath sourceTarget → 双 Map 键碰撞 + hash 口径错位 → **多语言目录增量每轮重生成两份 spec**（且 language-split 未按语言限定分析，首轮即双倍付费）。多语言是 spectra 主打，3 个 baseline 全单语言故无 E2E 暴露。
- **checkpoint 失效重跑重复条目**（`batch-orchestrator.ts:758`）：mustRegen fall-through 后 :904/:950 无条件 push 不剔旧条目 → resume 进度可超 totalModules、失败时 completed/failed 双记自相矛盾（F175 新引入）。
- **forceRegenerate 死字段**（`batch-orchestrator.ts:660`）：写入后全仓零读取——中断的 --full run 被裸增量 resume 静默降级，产出"半新半旧"混合产物且报成功。

**方案**：单一共享 `computeModuleSkeletonHash`（项目相对 POSIX 路径 + 确定性 code-unit 比较器；两侧文件集统一以 group.files 为准，generateSpec 加 files 注入参数）；language-split sourceTarget 加语言维度（`${dirPath}::${language}`）；fall-through 时 filter 旧 checkpoint 条目；forceRegenerate 要么实现 full-resume 语义要么删字段。公式变更一次性失效存量 hash（release note 标注）。
**回归护栏**：混合大小写 + 混语言目录的增量 E2E（第二轮应零重生成）；graph.json byte-stable gate。
**估时**：2-3d。**Mode**: spec-driver-fix。⚠️ **F186 npm 重发的前置**（修完才能把 F175 增量发给外部用户）。

### F183 (fix) — graph 一致性收口 + 可观测性

**问题**（架构审查）：
- `writeKnowledgeGraph` 3 个写盘点只有 batch 路径归一化（`cli/commands/graph.ts:198` 直接写盘含 currentRun 运行态泄漏 + 真实时间戳 + 非字典序；F179 fix-report 影响面扫描漏审了这 2 个写盘点）。
- `buildTsConfigContext` 失败路径双重静默（`core/import-resolver.ts:443-445/:464-466` 零日志）：monorepo 子包 tsconfig JSON 损坏 → 该子树 alias/baseUrl 边静默蒸发，无任何信号（F181 W#4b 文档化了语义但无运行时告警）。
- 增量传播图与 graph.json 双口径（`module-derivation.ts:354` root-only tsconfig vs batch per-file nearest）：F175 默认增量下改子包公共模块不联动重生成 alias 依赖方 spec；.d.ts 是一等节点但入边全 external → 改手写 .d.ts 零传播。F181 已 defer "nearest 统一"，本项先补 DeltaReport warn + 文档，统一并入本 feature 或视成本 defer。

**方案**：归一化内聚进 writeKnowledgeGraph（默认排序归一化，stripTimestamps 按需传）；buildTsConfigContext 失败分支 logger.warn（negative cache 限频）；多 tsconfig/手写 .d.ts 场景 DeltaReport 提示。
**估时**：1-2d。**Mode**: spec-driver-fix。

### F184 (feature) — 子代理 MCP 触发率工程（对症 §4.6）

**问题**：16/30 run 零 MCP 调用；触发率 1.77/run 未达 SC-002 ≥2；"编排器可见 17 工具但无使用动机"。

**方案**（架构审查给出的具体抓手 + m8-fix-candidates）：
1. **MCP 协议原生 `instructions` 字段**（`server.ts:40` 当前只传 name/version）：SDK ^1.26.0 已支持、Claude Code 真实消费——向 driver 全局解释"17 工具分组导览 + 典型链路 + graph-not-built 恢复流"。验证 agent 确认这是**净增量抓手**（m8-fix-candidates 与 F176 手段清单均未含）。⚠️ instructions 是否传播到 Task 子代理未经验证——A/B 验收件不可砍。
2. **description 三档割裂补齐**：server 5 工具从 2-6 字标签补到 F170c 4 要素；graph 6 工具补 "Use when / chained usage"。
3. **view_file 接入 fuzzy**（`file-nav-tools.ts:98`）：context 能 resolve 的 symbolId 传给 view_file 硬失败（宣传链路 context→view_file 自断）——并入既有"graph_node 复用 resolveSymbolFuzzy"项并扩 scope，17 工具 symbol 入参语义单一化。
4. F170d 任务→工具匹配引导强化 / orchestrator 预查注入（报告 §4.6 三选项），与 1-3 一并 A/B。
**验收**：A/B 评测（沿用 F176 telemetry 基线）触发率显著提升；工具改名不做（牵动 agents frontmatter 白名单跨仓同步，单独评估）。
**估时**：3-4d。**Mode**: spec-driver-feature。

### F185 (fix) — spec-driver 委派契约与编排单源化

**问题**（架构审查 + F176 实测）：
- 4.2.1 委派硬约束**只盖 fix skill**；story/feature/implement 仍是描述性措辞；**resume 编排器 frontmatter 还是 sonnet**（probe2 实证 sonnet 对 MUST 委派 0 服从）且无硬约束块——所有中断流程的唯一恢复入口必塌，F170a/d/c 集成链在恢复路径整体失效。
- frontmatter model 不在任何 contract/check 管辖（6281a27 的根因未机制化）。
- **orchestration.yaml 与 SKILL.md 双源漂移**（critical→high）：fix 模式 yaml 3 阶段 vs SKILL 4 阶段、story yaml 6 vs SKILL 5；只有 feature skill 运行时消费 get-phases——**用户的 modes.fix 覆盖显示生效实际纹丝不动**（合同失真），也是自适应裁剪的结构前置。
- 委派硬约束/preference-rules 注入段在 5 个 SKILL 复制无 sync 守护（sync-preference-rules.mjs 只盖 agents/*.md）。

**方案**：resume sonnet→opus（双层）+ 移植硬约束块；委派契约抽共享片段经 sync 注入 5 SKILL + repo:check 校验；repo:check 增加"编排器清单 model 必须 opus"断言；短期对齐 orchestration.yaml fix/story 段 + contract 标注"phase 覆盖仅 feature 模式运行时生效"caveat；fix/story/refactor 的 get-phases 动态编排单源化视成本可拆后续。
**估时**：2d。**Mode**: spec-driver-fix。

### F186 (fix) — 分发可靠性（npm 重发 + 同构事故防再发）

**问题**：npm spectra-cli 停在 4.2.0（不含 F175-F181）；codex wrapper 校验只查 4 个 header 标记不比对内容（F170d 实证漂移 11 天/66 commits 未拦截，spectra mirror 早有全文比对先例）；`spectra --version` 对新旧 build 都报 v4.2.0 无法区分；prepare 工具 detectedLanguages 是 ESM 死代码（裸 require 必抛被吞，假绿）；3/17 工具脱敏漏口（runAgentContextTool 顶层 catch 回传 err.message+stack 可含绝对路径，graph-not-built message 内插 projectRoot）。

**方案**：⚠️ **等 F182 修完**后 npm publish 4.3.0（含 F175-F182 全部）；wrapper 生成时写入 source body sha256 + 校验比对（plan 时在"hash 源文件" vs "regenerate-and-diff"间二选一）；--version 嵌入 build 元数据（commit hash）；require→ESM import + 补目录场景断言；3 处脱敏对齐固定文案。附带小 fix 串：orchestrator-cli zod 缺依赖优雅降级、MCP server volta 启动鲁棒性、plugin 同名冲突行为文档化。
**估时**：2d。**Mode**: spec-driver-fix。

### F187 (feature) — 评测设施 v2（FAIL_TO_PASS oracle）

**问题**：fuzzy oracle 单向偏差（已翻案）；oracle 三分类结构性失效（`cohort-batch.mjs:189`——ast-diff details 无 exitCode/timedOut + stringify 截 1000 字符破坏 JSON，环境故障全进 fail 分母）；patch/transcript 不持久化（--cleanup on-success 销毁答卷 + jury 对 PASS run 只能凭 diffStat 打分的证据不对称）；cohort 配置散布 6 处/4 文件（buildDriverPrompt default 裸回退 = 漏接的新 cohort 静默跑成对照组）；预注册只冻结 task ids 不冻结 oracle 语义（"跑前换判分"无拦截，fix-fixture-oracle.mjs 证明通道被用过）。

**方案**（含 4 项归并的对抗验证设计输入）：
1. oracle 换**真实 FAIL_TO_PASS 测试执行**：runner 加 kind='swebench-execution'，从 fixture.swebenchMeta（failToPass/passToPass/testPatch/goldPatch 四字段已齐）合成——importer 零改动、存量 fixture 直接复用；环境执行委托 SWE-Bench 官方 docker harness 或 per-repo conda（plan 阶段选型）；fuzzy 降级为 secondary 对照。
2. oracle 结果统一合同 `{cmd, passed, exitCode, timedOut, stdoutTail}` + details 结构化持久化（不整体 stringify 截断）+ classifyOracle 修通三分类。
3. **patch 持久化进 runner**（cleanup 前落 patch.diff + stdout/stderr log 到 fixture 同级；jury extractDiff 优先读持久化 patch，消除证据不对称）。
4. 声明式 cohort registry（id/tool/promptBuilder/claudeArgsProfile/prepSteps/stdinPolicy 单一来源；default 裸回退改 throw；对比对保持按 study 显式声明的预注册纪律）。
5. 预注册扩展：oracleSpecHash + fixtureContentHash + promptSha256 纳入 freezeBlock（对新 oracle 一次到位）。
6. batch 编排器 experiment manifest 参数化（去 F176 焊死，~6 处）。
**估时**：4-5d。**Mode**: spec-driver-feature。

### F188 (eval) — M7 数据离线重判 + 触发率修复复测

**前提**：F184 ship（触发率修复）+ F187 ship（新 oracle）。
1. **离线重判**：用 FAIL_TO_PASS oracle 重判 `~/.spec-driver-bench-patches/m7-f176/` 的 133 份答卷（成本 ≈$0，只有测试环境执行开销）——回答"fuzzy 翻案的修正排名在真实判分下是否成立"。
2. **复测**：触发率工程后的增量验证（scope 视 F184 A/B 结果定：最小 c1/c3 两 cohort × 10 task × N=3；触发率 + lift 双指标）。报告按 PUBLISH-REPORT-M7 增补 M8 章节。
**估时**：2-3d + 评测费（订阅优先策略；SiliconFlow jury 实付预估 <$20）。**Mode**: spec-driver-feature（评测产物不入库约定沿用）。

---

## 2. 轨道 B — 旗舰启动线

### F189 (design+prototype) — AST-anchored Spec Drift Detection 启动

用户既定 M8 旗舰（M7-stepback-revision §3），本期**只做 spec + prototype，不求 ship**（双轨决策）。

- **必做 prior art 深读**（M7-stepback-revision-2 §5）：Fiberplane Drift（tree-sitter AST 指纹 + git provenance 点锚路线；drift.lock schema 作兼容性参照）/ Dusk Pituitary（全仓矛盾 lint + MCP 暴露路线）/ OpenLore（spec 实体映射代码图节点 + drift 三态——与"我们既有图又有 spec"资产最契合）。
- **立项弹药**：Meta 生产分类法 Specification Drift ~30%（问题规模证据）；AGENTbench 反例边界（drift 检测服务于"spec 精简且真实"而非生成更多内容——写进非目标）。
- **prototype 范围**：spec/plan 引用的代码实体锚定到 Spectra symbol id（复用 F174 canonicalize/fuzzy 资产）+ symbol 变化标 stale 的最小闭环 + repo:check 集成草案。**注意**：F182 的 skeletonHash 修复与 F181 的 symbol id 稳定性是锚定可靠性的地基——架构审查确认 graph 链无阻碍扩展的封闭设计。
- **产出**：specs/189-*/（spec.md + prototype 分支 + 决策文档：点锚 vs 全仓两路线选型）。
**估时**：3-4d。**Mode**: spec-driver-feature（implement 阶段做 prototype）。

---

## 2.5 轨道 C — 领域知识 AI 脚手架（Phase 1 MVP）

### F190 (feature) — scaffold-kb MVP：厂商文档知识库构建 + KB MCP 查询 + 工作流注入

**需求来源**：厂商 PaaS SDK 类业务希望基于我们的 plugin 体系构建"精通其 SDK 的 AI 脚手架"（集成商开箱即用 + 三方行业知识导入 + Feature/Story/Fix 工作流双库联查）。**完整调研与方案见 [domain-knowledge-scaffold-solution.md](domain-knowledge-scaffold-solution.md)**（4 域 Perplexity 调研 + 仓内资产盘点，主线程综合）。

**关键选型结论**（证据见方案文档 §1）：
- ❌ Microsoft GraphRAG 否决（10-40× 成本、API 查询类不优于 vector RAG 基线、产物不利打包）
- ✅ 「文档结构图 + API 实体层 + SQLite FTS5 + agentic MCP 按需查询」混合——与业界"coding agent 场景 agentic search > embedding RAG"实证一致，零运维、单文件可打包、与 Spectra 既有范式同构
- ✅ plugin 打包预建知识库先例成立（Context7 plugin / Zilliz claude-context），我们 marketplace 整目录分发机制实测支持

**Phase 1 scope（MVP，经 codex 对抗审查收窄——5 critical / 6 warning 全采纳，见方案文档 §3/§4）**：
1. `scaffold-kb` CLI：llms.txt URL / 文档目录 → `kb/`（doc-graph.json 文档结构图 + chunks.sqlite FTS5 全文层）；🔴 **CJK tokenizer 决策是硬课题**（unicode61 不切中文词 / trigram <3 字符失效，本方案原始场景即中文厂商文档）；SDK 源码侧直接复用 `spectra batch` 产物
2. KB MCP server（复用 Spectra MCP 骨架/`{code}` 契约/telemetry）：`kb_search` + `kb_doc_lookup`（文档锚点版；`kb_api_lookup` 名留给 Phase 2 实体版）两工具，厂商库（只读）+ 项目库（可写）双层联查；KB 内容按 **untrusted evidence** 消费（带 source/version trace + token cap，防 prompt-injection）
3. demo 厂商 plugin：真实公开 SDK 文档构建（**中文/英文各一套 fixture**），验证 marketplace 分发 + 开箱即用

**移出 Phase 1**：spec-driver research phase 预查注入 → **Phase 1.5**（codex 实证：project-context schema 是固定字段白名单，`knowledge_sources` 需扩 schema+resolver 三处，非小接线；MVP 调试面要小）。
**不做**（Phase 2/3 → M9）：API 实体 LLM 抽取、文档↔SDK 符号锚定（与 F189 锚定引擎合流）、三方异构导入管线、会议纪要加工、门禁深度集成、自动冲突仲裁（Phase 1 仅双呈现+标来源）。

**E2E + 质量门禁**（用户故事命名）：
- "集成商装 demo plugin → 问 SDK API 问题 → kb_search 命中并引用来源文档"
- **recall@k 测试集**：中文查询 + 同义改写 + 短错误码 + 含 `.`/`-`/`_` 的 API 符号；不达标 → 触发向量 rerank 升级路径评估
**估时**：5-7d（codex 校正原 4-5d 乐观：新 CLI + sqlite 依赖选型 + doc-graph 泛化 + CJK 课题）。**Mode**: spec-driver-feature。
**协同**：F184 的 instructions/description 改造与 A/B 设施直接服务 KB 工具 adoption；F189 的 AST 锚定引擎是 Phase 2 文档↔符号锚定的同构底座。

---

## 2.6 收尾质量门（跨轨道，2026-06-12 增补）

### F191 (review) — M8 全期架构/代码 review

复刻 M7 收尾的成功模式（wf_a084e2f1：4 子系统审查 + 对抗验证 → 28 findings / **0 证伪** / 20 worthFeature，纠正过 critical 误报与错误删除清单）——但 M7 是临时起意跑的，M8 把它**正式立为收尾 feature**（有验收、防漏掉）。

- **时机**：全部代码 feature（F182-F187 / F189 / F190）ship 后；与 F188 评测跑批**可并行**（review 审代码，评测烧配额，互不抢资源）
- **审查面**（按 M8 触及子系统分 agent）：batch 增量链（F182/F183 修复后的状态机）、MCP 层（F184 instructions/description 改造后）、spec-driver plugin（F185 委派契约）、分发链（F186）、评测设施 v2（F187 oracle 重构）、**KB 新模块（F190 全新代码，重点盯）**、drift 原型（F189）
- **形式**：workflow（审查 agent × N + **对抗验证层保留**）+ 主线程综合收口（核心判断不下放）
- **产出**：critical 当场转 Fix；worthFeature 分流 M9 候选清单；文档类发现移交 F192
- **验收**：覆盖全部 M8 ship 代码；对抗验证 0 证伪率作为审查质量参照；M9 roadmap 初稿成形
- **估时**：1d（workflow ~2.5M token 量级 + 主线程综合）。**Mode**: 主线程 + workflow（不走 spec-driver——它本身是 step-back 环节）

### F192 (doc) — M8 文档收口与对齐

M8 改了大量对外行为（增量默认语义、--version、npm 4.3.0、委派契约、KB 新 CLI），用户文档若不收口将系统性漂移。**已坐实一个活漂移**（本次 review 实证）：`docs/shared/agent-mainline-focus.md` 仍写"主线 = panoramic Phase 1（Feature 040/041/051）"——该文件经 sync 注入 CLAUDE.md/AGENTS.md，**每个新会话都被它误导**。

- **范围**：
  1. 🔴 `agent-mainline-focus.md` 重写为 M8 后真实主线（三轨能力 + KB 脚手架 + 评测设施 v2）→ `docs:sync:agents` 同步双文件
  2. M8 触及面用户文档对齐：`configuration.md`（F185 orchestration caveat）、`spec-driver-modes.md`（委派契约/模式行为）、`spectra-cli-reference.md`（F186 --version 元数据 + F190 scaffold-kb 新命令）、README（npm 4.3.0 / KB 能力 / M8 行 Delivered + 复测成绩更新）
  3. F190 厂商使用指南校验（scaffold-kb 构建定制 plugin 的 how-to——F190 自带则只校验完整性，缺则补）
  4. 历史 roadmap 文档（`spectra-v4-hotfix-roadmap.md` / `spectra-v4.1-*`）加"已完成/历史归档"标注（轻量，不重写）
  5. F188 的 PUBLISH-REPORT-M8 交叉链接校验（报告本体由 F188 产出）
- **时机**：F191 后（吸收 review 的文档类发现一并收口）→ **F192 完成 = M8 收官**
- **验收**：mainline-focus 反映真实主线；M8 触及面文档与实际行为一致（抽查跑通文档里的命令）；repo:check + docs sync 全绿
- **估时**：1-1.5d。**Mode**: spec-driver-story（doc 类，无生产代码）

---

## 3. 执行顺序与并行

```
F182 增量正确性 (critical, 2-3d)        ← 最先（F186 npm 重发的前置）
  ├─→ F183 graph 收口 (1-2d)      ┐ 并行（写入路径 disjoint：
  └─→ F185 spec-driver 委派 (2d)  ┘ src/batch+core vs plugins/spec-driver）
F184 触发率工程 (3-4d)                  ← F185 后（委派修通才能测子代理触发率）
F186 分发可靠性 + npm 4.3.0 (2d)        ← F182 后即可启动，发版等 F184 ship 一并含入
F187 评测设施 v2 (4-5d)         ┐
F189 旗舰 spec+prototype (3-4d) ├ 三线并行（评测 scripts vs drift 原型 vs
F190 scaffold-kb MVP (5-7d)     ┘ 新 CLI/KB 模块，写入路径完全 disjoint）
F188 重判 + 复测 (2-3d)  ┐ 并行（评测烧配额 vs 代码审查，
F191 全期架构 review (1d) ┘ 互不抢资源；均需全部代码 feature ship）
F192 文档收口 (1-1.5d)                  ← F191 后（吸收文档类发现）= M8 收官

合计轨道 A ~14-19d + 轨道 B 3-4d + 轨道 C 5-7d + 收尾 2-2.5d（并行后日历 ~4 周）
```

## 4. M8 验收标准

| SC | 描述 | 验证 |
|----|------|------|
| M8-SC-001 | 增量缓存对混合大小写/混语言项目正确（第二轮零重生成）| F182 E2E |
| M8-SC-002 | 子代理 MCP 触发率较 F176 基线显著提升（A/B + 复测）| F184 + F188 |
| M8-SC-003 | npm spectra-cli ≥4.3.0 含 F175-F182，--version 可区分 build | F186 |
| M8-SC-004 | 评测 oracle = 真实测试执行；M7 133 份答卷完成离线重判 | F187 + F188 |
| M8-SC-005 | 委派契约全 skill 生效（含 resume），repo:check 机器可查 | F185 |
| M8-SC-006 | 旗舰 spec + prototype 落地，点锚/全仓路线完成选型决策 | F189 |
| M8-SC-007 | TDD + E2E per feature（沿用 M7 约定）| 各 feature verify |
| M8-SC-008 | scaffold-kb MVP：demo 厂商 plugin 开箱即用（kb_search 命中引用来源）+ spec-driver research phase 预查注入生效 | F190 E2E |
| M8-SC-009 | M8 全期架构 review 完成：覆盖全部 ship 代码 + 对抗验证层 + M9 候选清单成形 | F191 |
| M8-SC-010 | 文档与行为一致：mainline-focus 反映真实主线 + M8 触及面用户文档对齐（含 README/CLI reference/modes）| F192（M8 收官件）|

## 5. defer（M8 不做，候选 M9+）

- runBatch 1458 行拆解、walker 17+ 处统一（M7 既定 defer，维持）
- 自适应流程裁剪**实施**（4-12× token 的结构性解法）：设计输入已齐（fix SKILL 36k 注入 + 6 子代理全文 handoff + artifact 锁死），但前置依赖 F185 的 phase 单源化先落地——M8 仅在 F185 内做短期对齐，裁剪机制 M9
- telemetry 形态统一（3 处采样骨架 → 单一装饰器）：对抗验证判"风险被夸大"，随下次动 telemetry 顺带
- projectRoot 信任模型统一（11 工具 client-settable vs file-nav pinned）：对抗验证判安全危害有限，M9 做一次性决策
- aider personalized PageRank / Spec Kit analyze gate / Conductor 条件路由 / Codanna RRF / Augment 时间维度 / live watching（M7-stepback 既定，维持 defer）
- graph_hyperedges pretty-print 等 envelope 细碎不一致（info 级，攒批处理）
