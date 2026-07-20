---
title: Milestone M8 — 可信度修复（双轨）+ Spec Drift 旗舰启动
status: completed (2026-07-20 正式收官：F212 收官评测闭合 SC-002/SC-004，全部 SC 达成；终报 specs/212-eval-rerun-m8-closeout/PUBLISH-REPORT-M8.md)
created: 2026-06-12
parent_milestone: milestone-M7-spectra-mcp-productization.md (✅ 2026-06-12 完成，F176 ship + 4.2.1 发布)
successor_milestone: milestone-M9-codex-trusted-live-graph.md (planning)
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
amendment_2026-06-13b: ① F193✅/F184✅ ship（体检通过：F193 id 相对化避开 F182 护栏+跨 worktree byte 一致+bootstrap copy-if-absent 段实证；F184 instructions/view_file fuzzy 落地+verify 阶段 Codex 抓出 resolvedFile 绝对路径泄露已修；两者在 file-nav-tools.ts 叠加 disjoint 正确）② F184 A/B 触发率评测合理推迟 F188（不单独烧钱，host 全局 plugin 隔离前置）③ 体检挖出新发现 → 用户 2026-06-13 裁决：B1（CLI 帮助文本「code-only 无 LLM/<30s」误导校正，cli/index.ts:99 + batch.ts:74）并入 F183 顺手修；B2 立 F195（全仓纯 AST graph-only 零 LLM 构建路径——拆 batch spec-gen/graph 耦合，dogfooding 首次建图/重建优化 ~2-3d）。根因：F193 perf-profiling 坐实 batch --mode code-only 仍调 sonnet spec-gen（27min 是 LLM I/O 等待），prepare 仅单 target skeleton。F195 排 F183 后（同碰 cli/batch+graph 链，F183 改 code-only 描述 vs F195 加 graph-only 行，避免冲突）
amendment_2026-06-13c: ① F183✅ ship（体检通过：normalizeGraphForWrite 内聚三写盘出口[graph/community/batch 共用归一化]+I-1 执行序文档化保 F193 portable 守卫零回归；B1 帮助文本诚实校正落地[cli/index.ts:99 + batch.ts:74 删「无 LLM/<30s/最快」误导，改「仍逐模块调 spec-gen LLM，非零成本/非最快」]；import-resolver 失败分支 warn 纯加性[仍 return null 行为不变，不碰 resolveKind 契约]→ F181 整合零回归；41 新测 merged HEAD 全绿）② 计划外衍生 F196✅ ship（补齐 F184 dogfooding 发现的 MCP description Output 字段名漂移隐患：test-only 零源码 16 测子集语义守护[动态发现 11 工具+复现 4 类历史漂移+C-01/C-02 完整性]；诚实边界——仅顶层字段名/嵌套 shape out-of-scope/prepare-batch satisfies 在 CI 休眠为 latent 防御；原编号 195→196 避撞 F195）③ 本轮体检再遇 graph.json 未建[27min 重建阻塞]→ 坐实 F195 graph-only 价值，列下一派发首位
amendment_2026-06-14: ① F195✅/F187✅/F189✅ ship（三线并行合入，merged HEAD 4477 测全绿、EXIT 0）+ 跨切面对抗审查 workflow（wf_c4c0461a，34 agent/2.68M token/28 findings → 10 确认/18 证伪；对抗层杀掉 18 误报含 1 个误升 critical[fixtureContentHash]，并复证 F195 零 LLM claim 1-3 成立）。逐 feature 体检：
- **F195✅** graph-only 2.8s 零 LLM（spy 坐实 generateSpec/anchor/hyperedge/embedding=0）+ F183 出口/F193 portable/byte-stable 零回归 + schema 2.0 MCP 可消费（graph_node/impact/path/query 正交于缺失 degree/community 字段，god_nodes/community/hyperedges graceful-degrade）；MCP 恢复提示改引导 graph-only。遗留 W：help **synopsis 行 index.ts:43** 漏 graph-only 取值，与详细行:99 自相矛盾（helptext.test 整文件 toContain 漏防）
- **F189✅** 点锚 prototype 11/11 场景，symbol 级指纹（升级 file-level）消除同文件连累，路线选型诚实（不 over-claim 低误报）。遗留 W：**前导 JSDoc/注释变更静默判 fresh**（span 自 export 声明行起，ts-morph getStartLineNumber 排除前导 trivia），与"注释变化仍触发 stale"三处文案矛盾（实为 under-report，方向反）→ 修文案
- **F187✅** oracle 真实执行（SWE-L003 docker 42s）+ 三分类 error→null 剔分母 + registry 单源 throw + golden 锁竞品方法论。⚠️ **审查挖出 6 真实缺陷（2C+4W），全部"休眠"——仅 F188 真跑 swebench-execution oracle（默认 gated off）时咬人**：🔴[3] classify-oracle:79 OOM/`\bKilled\b` 启发式短路在 report 权威判定:84 前 → 日志含"Killed"/exit137 的真实 resolved=true PASS 被洗成 fail/candidate，跨 cohort 不对称污染排名；🔴[5] freeze-preregistration.mjs（唯一生产冻结工具）从不写 oracleSpecHash/fixtureContentHash/promptSha256 → swebench 预注册门禁:157 必 hard-fail（校验侧焊死/生产侧无法满足，T026 未做）；W[4] swebench-oracle:123 硬编码 Lite，Verified 8/10 实例不在 Lite → 静默剔分母缩 N → lift/CI 失真；W[6] promptSha256 write-only 不比对；W[7] FR-005-d（gitCommit==HEAD/worktree-clean）未实现；W[8] oracleSpecHash 不覆盖 runner 候选-patch 抽取:922 →"改判分输入 hash 不变"反例
- **处置**：6 个 F187 缺陷 = **F188 前置阻断**（F187 verify 报告本已声明 freeze/全量跑批留 F188）→ 立 **F197 评测公正性收口（spec-driver-fix，仅 scripts/，~1-2d）必须先于 F188**；F195 synopsis 修复并入 F186（同碰 cli/index.ts）；F189 文案修并入 F189 残留/M9；cli-e2e dist/ write-read race flake 列 test-infra 候选（非回归）
amendment_2026-06-19: 大批量 ship + 🔴编号漂移校正 + 调研沉淀。
- ① 上轮派发三线全 ship + 体检（spot-check 两最高风险件，均高质量）：
  - **F197✅** 评测公正性收口——6 缺陷（C1-C2/W1-W4）+ fixtureContentHash critical 全闭合；spot-check 确认 classify-oracle.mjs:83-86 report 权威已上移到 OOM/`\bKilled\b` 启发式(:88)前（我上轮挖的 C1 排名污染真修了）；4522 测绿
  - **F186✅** 分发可靠性——contract bump 4.3.0 + wrapper body-sha256 + --version build 元数据 + 3 脱敏 + ESM 死代码修 + F195 synopsis 修；⚠️ **实际 npm publish 未做**（对外不可逆操作，待显式授权才发）
  - **F190✅** scaffold-kb MVP（doc-graph + FTS5 + KB MCP 双层联查）
- ② 🔴 **编号漂移校正**：实际 ship 的 F191/F192 ≠ 本 plan 原定 F191(全期 review)/F192(doc 收口)——KB 轨道扩张占用了这两个号：
  - **F191✅** = scaffold-kb research 预查注入 Phase 1.5（kb-prequery.mjs 跨插件确定性注入 spec-driver feature/story flow），**非**全期 review
  - **F192✅** = scaffold-kb Phase 2（API 实体层 + 三方导入[office-parser + SSRF url-fetcher] + 冲突仲裁 + kb_api_lookup，1941 行新码），**非**doc 收口；spot-check：url-fetcher SSRF 防线完备（协议白名单 + IP literal 显式校验防经典绕过 + 逐跳 redirect 重校验）
  - **KB 轨道（Track C）实形态**：F190 MVP → F191 注入 → F192 Phase2 = domain-knowledge-scaffold 方案 Phase 1+2 全落地（远超原 plan 单 feature「Phase 1 MVP」，是 M8 最大计划外扩张）
- ③ 计划外 ship：**F198✅/F199✅**（spec-driver/orchestration zod 缺失优雅降级，共享 load-zod helper）；**F176✅** swebench-execution 预注册冻结 + 5 cohort smoke PASS（F188 跑批前置已就位）
- ④ 剩余收尾重新认定（原 F191/F192 号已被 KB 占用）：**F188**（eval 重判+复测，前置 F176 冻结 + F197 公正性修复均就位，可跑·烧配额派发前确认）；**全期架构 review** 由 milestone-next 每轮对抗审查 workflow 替代（上轮 6 维度 wf_c4c0461a + 本轮 spot-check），如需正式收口报告另立新号；**doc 收口**（npm 4.3.0 / KB 新 CLI+MCP / 委派契约 / agent-mainline-focus.md 漂移）另立新号
- ⑤ 调研沉淀（2026-06-19 三方向 detailed 调研，见 §5 M9 候选）：路线确认「站在风口」，新增 3 增强方向 + Goal 自主推进可行性判断
amendment_2026-06-20: 近期批（F200/F201）+ 衍生 fix 全 ship + 体检（均诚实零 over-claim）：
- **F200✅** M8 doc 收口：`agent-mainline-focus.md` 活漂移**修正**（不再写 panoramic Phase 1 为唯一主线，改 M8 三轨；panoramic 降为"既有稳定能力"）；README npm 协调护栏生效（4.3.0 标注 "staged pending explicit authorization"，不声称已在 npm 可装）
- **F201✅ goal_loop**（本会话设计的 feature）：**机制层 READY**（声明层 + goal-loop-core 12 纯函数[1131 测] + SKILL 闭环散文 + verify JSON 模式 + opt-in 模板；vitest 4895/repo:check 57/release:check/FR 23/23/Codex CRITICAL 全闭合）；**opt-in default-off 实证**（get-phases feature=single，仅 override 启 goal_loop；8 mode + batch_loop 零回归）；**诚实留 e2e 缺口不 over-claim**：SC-001/002/003（真实自治闭环红→绿 + max_iter/无进展 fallback + git 回滚）的"编排器真实执行正确"需一次受控 feature-mode + override 端到端 run 才能验（散文是 LLM 解释层，单测 core ≠ 真实编排正确）；人工 GATE_VERIFY + Layer 1.5 + Codex 兜底，reward hacking 列诚实残留风险
- **F201-fix✅** scaffold-kb 命令惰性 import（解 CLI 冷启动 sqlite-wasm 硬依赖，与 goal_loop 共用 201 号）；**config-schema✅ ×2**（batch 段 zod schema 补全解 F146 误报 + --show-effective concurrency；计划外维护 fix）
- **🆕 衍生洞察 → M9 候选**：goal_loop 的 Spectra impact 注入（FR-011）实践高频命中降级路径——loop 迭代的是刚改的新代码（预建图谱不含）+ 缺 graph-only 刷新致图谱 stale；单测降级使其"安全"但 **TDAD 协同价值（结构化 impact 压回归 6%→10%）依赖图谱新鲜度** → **goal_loop 每轮 implement 前 graph-only 增量刷图**，使 impact 注入对本轮改动有效
- **处置**：近期批 done → 用户排最后的 F188 + npm publish 解锁；**F201 goal_loop e2e 验证（= 此前提的 Goal pilot）= F201 诚实收口候选**
amendment_2026-06-20b: goal_loop e2e pilot 链（F202/F203/F204）全 ship + 体检（高质量、零 over-claim）：
- **F202✅ pilot**（载体 MCP batch graph-only + goal_loop 遥测）：载体 READY（FR-001~010 全绿 / vitest 4912 / F196 守卫绿 / 复用 buildAstGraphOnly 不重写）；**goal_loop 闭环首次 e2e 验证成功**——2 轮 REACHED_GOAL，全套机制（单实例锁 / plan-snapshot / 委派 implement + 独立 verify 职责分离 / decide-stop / escalate_full[Codex-C2] / 释放锁）端到端跑通，core 决策全由可执行 CLI 收口（非散文手写）→ **坐实 F201 ⚠️ SC-001 闭环逻辑**
- **诚实修正（pilot 暴露 3 缺陷 + 后续挖出第 4 个，全非 over-claim）**：
  - #1 snapshot/rollback（git stash --include-untracked / clean -fd）卷走未跟踪 override config → goal_loop 配置自毁 → **F203 修**
  - #2 smoke=全量 vitest 含 build 依赖 e2e → 未构建 worktree 假阴性 continue（R1 需 orchestrator 手动 build 才达标）→ **"完全自主无人工"未坐实** → **F203 修**
  - #3 impact 注入两轮全 degraded：(1) live MCP 图谱主仓绝对路径不匹配 worktree (2) **更本质——纯新增代码无 caller，impact 反向 BFS 天然空** → **M9「每轮 graph-only 刷图」候选精化：对"改既有代码"任务有必要（解 worktree 漂移），对"纯新增"任务价值有限 → 应按任务类型条件启用，非无条件每轮刷图**
  - #4（加固期挖出）CRITICAL-8 reward-hacking：full 轮权威门禁不校验命令集完整性（partial verify 可冒充 full → REACHED_GOAL）→ **F204 修**
  - SC-002（fallback）/SC-003（回滚）happy path 未触发 → 诚实标注需对抗任务（故意不可达 / 注入回归）单独验
- **F203✅** goal_loop core 两缺陷修：snapshot pathspec 排除 PRESERVED_CONFIG_PATHS（含 CRITICAL-7 git status 折叠漏网根因 + staged 态 preflight 硬失败兜底）+ smoke 假阴性区分 feature/环境失败；全链路零回归
- **F204✅** 堵 CRITICAL-8：full_required_kinds 校验，缺 kind→INCOMPLETE_FULL_VERIFY（AC-5 直证漏洞 payload）；7/7 AC。诚实残留：对抗误标在通用插件内无法彻底关（core 不试图全关）
- **处置**：goal_loop **验证 + 加固完成**（happy-path 坐实 + 3 缺陷修 + reward-hack 堵）；**近期 feature 全 done → 用户排最后的 F188 + npm publish 真正轮到**；backlog: SC-002/003 对抗验证 + M9 条件刷图
amendment_2026-07-12: F206-F211 六 feature 体检完成（inline spot-check，零证伪）：
- **F206✅ /goal 第二战役**（深读终报）：全池 c3 27/33=81.8%（+6pp，**反超裸 Claude 77.4%**）；GStack 90.9% 拆解——其"机器没转"（33 run 0 次编码 skill 调用 = 裸 Claude + 咒语，+13.5pp 系 prompt 功效），真实差距仅 3 分（V008×2 结构性 + V010×1 墙钟）；R3 期望行为合同被"流程遗弃"绕过（20-30% run 仪式坍塌 = opus freestyle）→ 催生 F208；R4 轻量路径 untracked 预算化 KEEP；运维沉淀三条（codex-rescue 禁 resume / runId 复用覆盖现场 / 慢验窗口禁改 plugins）
- **F208✅ fix 依从性 Stop hook**（最大生产件，spot-check 实证）：hooks.json Stop 段双 hook 挂载（stop-task-check 并存不破坏）+ fix-compliance-judge 三前缀（BLOCK/WARN/GATE-DEGRADED）+ 有界降级（同 sid 第 3 次放行防锁死）；439 plugin 测 + 5067 vitest + 16/16 手工沙箱 + **真实 haiku headless E2E 实锤阻断→反馈→补救→放行闭环**；慢验 N=6 坍塌 0/6；v4.3.0
- **F207✅** init 脚手架防污染：`.git/info/exclude` 主防线（:297，零 diff 污染）+ .gitignore 兜底（worktree/非 git）实证；**F209✅** dataset-build 测试注入 fetchRows/不存在 venv → 确定性快速失败零 docker 依赖；**F210✅** eval-validate `oracle_error` 哨兵剔分母 + n_oracle_error 桶（:90-115 实证），⚠️ 已知残留：**calibrate 侧同病未修**（F188 走 validate 路径不受阻，列 fix 候选）；**F211✅** `resetBlockState` 补救成功清零阻断计数（交互式额度自愈，堵 F208 C5 边界）
- **判定**：未跑审查 workflow——6 件中 F206 为评测产物（深读）、F207-F211 各带多轮 Codex 审查且 F208 verify 为本 milestone 最严（真模型 E2E），spot-check 全证实，workflow 边际收益低
- **格局**：F206 后续路径 #1(F208)/#2(F207) 均已 ship → **~88% 预测已可测**，F188 全池复测升级为 headline 目标
amendment_2026-07-19: ① 收官前清欠盘点完成——F189 文案矛盾修（4d1fb05）；F210 calibrate 侧同病并入 F188 T0；src/ TODO 零真实欠账；F192 recall 冻结硬门已过。② 清欠附带挖出并修复真实基建债：主仓 `.claude/worktrees` 积欠 **5.4GB/14 个残留 worktree** 致 repo-maintenance-sync-check 测试 hook 超时（copyTree('.claude') 拷全量）——全部安全移除（零 --force，噪声还原后 git 放行）+ 71 个已合并孤儿分支清理，测试 47s 超时→789ms 绿；"交付后删分支/worktree"仓规未被各 session 执行是根因，SYMLINK story 顺带补约定。③ **npm publish 4.3.0 完成（M8-SC-003 闭合）**：registry 实证 4.3.0（首次含 F175-F211 全部），README M8 note 同步；发布经用户本机 2FA browser-auth，同 IP 后续发布免二步验证 → 此后发布动作可由助手代执行（保留列清单等确认 gate）
执行顺序: …→ F205✅ → F206✅-F211✅(体检完·零证伪) → 清欠✅(F189 文案/worktree 5.4GB/71 分支) → **npm publish 4.3.0✅(SC-003 闭合)** → **F212✅(收官评测，原计划号 188)** → **M8 正式收官（2026-07-20）**
amendment_2026-07-20b（收官记账）: F212 终报核心（详见 PUBLISH-REPORT-M8）：
- **SC-002 ✅ 闭合**：c3 MCP 触发率 3.87/run，bootstrap CI [3.10,4.60]——双门（显著超 1.77 基线 + ≥2.0 达标）预注册机判全过，**2.2× 基线**（F184 触发率工程路线验证）
- **SC-004 ✅ 闭合**：133 重判引用 188 P1（fuzzy 翻案定性成立·directional）+ T0 calibrate 对齐 + 全池批**零剔除测量**（infra/error/oracle_error/missing 全 0）+ docker 死窗在冻结语义下正确分桶——判分链在 7 类真实故障下守住口径
- **headline 诚实结论**：F208 依从性达成（**坍塌 20-30% → 0/29**）但 c3 = 27/33 = **81.8% 持平**（CI [69.7,93.9]），**~88% 预测点估计未兑现**；**未超 GStack（90.9%）**——剩余差距全部定位到 **V008 方向误读**（把 base 态误读为"已历史修复"→ 穿 F208 合规外衣的自信 no-op，两 run MCP×0；预测因果链"消坍塌→V008 转化"前半兑现后半证伪）
- **A/B 意外信号**：强 driver（opus-4-8）上 lift 0.852 CI [0.655,1.043]（负向不显著）；**裸 opus V008 = 3/3**（方向误读病不困扰无"先核实"步骤的裸驱动）；三 epoch（133/headline/A/B）按 C1 红线禁横比
- 残余候补已登记终报 §9（V008 产品卡最高值 / 评测 infra 三小件 / plugin 守卫 / upstream 上报 / driver×流程交互开放问题）→ 吸收进 M9 路线图（见该文档 Gate 0 吸收点）
amendment_2026-07-19b: M9 候选已收口为独立后继路线图 `milestone-M9-codex-trusted-live-graph.md`；M9 主题定为 Codex 一等支持 + 可信活图 + Spec Drift 生产化，Wiki / GraphRAG / 深层 KB 调度 / 扩大自治进入 M10 边界。M9 规划启动不改变 F188 仍是 M8 最后收官门禁的事实。
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

### 5.1 调研沉淀（2026-06-19 三方向 detailed 调研 → M9 候选）

三方向调研（Perplexity detailed）结论：**Spectra（AST 图谱）+ Spec Driver（spec→plan→tasks→implement→verify）双线均"站在风口"**，业界共识与我们路线一致；无需方向性调整，但浮现 3 个**增强**方向值得列 M9 候选：

- **M9 候选 · GraphRAG 排序 + 语义检索叠加**：业界共识 = AST 图谱是 repo-level 理解的 source-of-truth（覆盖率/可验证/多跳 grounding 压倒 embedding RAG），但单纯图谱 + 单纯 agentic grep 各有短板；前沿是在图谱基座上叠加 **symbol-level 语义检索 + GraphRAG 排序**（Sourcegraph Cody / Graph-Code / Omnigrep 路线）。我们已有图基座，缺语义检索层——与 F190 KB 的 FTS5/向量 rerank 升级路径同构，可合流。参照：Omnigrep 在 CodeSearchEval 以 agentic+图混合刷 SOTA（F0.5 +33%）
- **M9 候选 · context-grounding hooks（对齐 Spec Kit Agents 2026）**：业界最新 = GitHub **Spec Kit Agents**（32 repo/128 feature 实证）在 spec→design→verify 各阶段加 "discovery + validation context-grounding hooks"（Agent 显式浏览仓库结构/现有实现作为约束），review 质量显著提升、~100% 测试通过。这正是 **Spectra×Spec Driver 的协同点**——把 Spectra impact/context 作为 spec-driver 各 phase 的 grounding 注入（F191 KB 预查注入已开此路，可泛化到 graph context）
- **M9 候选 · tests-as-spec 强化验收**：业界共识 = 验收标准应可执行（observable/atomic/bounded + repo anchor + assertion anchor），且 **TDAD 实证：仅"先写测试"prompt 而无依赖图上下文会让回归率 6.08%→9.94%（更糟）**——结构化 impact 上下文是自主 TDD 不退化的前提。我们的 graph impact 恰好提供此上下文 → 强协同（详见 Goal 自主推进可行性，下）

**Goal 自主推进可行性判断**（回应"用测试集 + Goal loop 推进 Milestone"）：可行且对我们**特别**契合——治理共识 = "分支内无人值守自主迭代 + 人在环最终把关 + 沙箱/审计/最小权限/kill switch"；我们已具备最难的两半（Spec Driver = 护栏+gate，Spectra impact = TDAD 证明必需的结构化上下文），缺的只是 Goal loop driver（autoresearch skill）+ 每任务可执行测试集。边界：适合**有界**任务（well-bounded fix / 测试补齐），不适合烧钱评测（F188）或架构级 feature（F192 类）；风险 = reward hacking/测试过拟合/长程局部最优，用我们既有的 Codex 对抗审查 + verify 阶段兜底。建议 M9 做**单任务 pilot** 验证收敛性，不直接全自动化 Milestone

### 5.2 调研沉淀（2026-07-19 三方向 detailed：LLM Wiki / 文档 KB 格局 / SuperPowers 脑爆）→ M9 候选增补

**① Wiki 消费形态（vs DeepWiki/Komment/Repowise/DeepWiki-Open）**：核心判断——**我们已拥有 DeepWiki 后端的 ~80%**（AST 图谱/模块 spec/架构叙事/mermaid/graph.html/panoramic-query 问答），缺的是**消费表面**：可浏览分层 wiki 站（总览→模块→符号导航）、**行级引用体系**（回答/页面可点击回源码行——业界缓解幻觉口碑的关键，我们 AST-grounded 路线天然适配）、每页 freshness 评分（Repowise 按 git 历史）、配置驱动页面规划（`.devin/wiki.json` 的 repo_notes+pages 模式）、Fast/Deep 双模式查询。MCP 暴露（DeepWiki mcp.deepwiki.com 刚做）我们反而领先。行业教训：纯自动生成口碑两极（幻觉+自信语气），方向是"可审阅+可核查引用+人机协作 overlay"。→ **M9 候选：wiki 输出形态**（从既有产物生成本地/私有可浏览 wiki 站 + 行锚引用 + freshness 徽标；差异化 = local/private vs DeepWiki hosted-public）
**② scaffold-kb 缺口（vs Context7/Kapa/Inkeep/Mintlify）**：底座（doc-graph+FTS5+实体层+双层联查+溯源+token cap+plugin 分发）已是前沿形态；三个行业基线能力缺失，按优先级：
  1. 🔴 **coverage-gap 分析**（Kapa/Inkeep 杀手锏：**未命中查询聚合 = 文档缺口 backlog**；我们 KB MCP 已有 telemetry，聚合 no-hit 即可——高价值低成本，M9 候选首位）
  2. 🟡 **版本 pinning**（Context7 `/lib@version` + lockfile 自动检测项目版本；我们仅 build 时 sdk-version 标签，无查询时多版本选择）
  3. 🟡 **freshness 分级同步**（Context7 按热度分级刷新 Top100 每日/Top1000 半月；我们建后静止靠手动重建）+ no-hit 诚实表面（明确"KB 无此内容"而非静默空）
  4. ✅ embedding+rerank 混合：F190 spec 已预留"recall 不达标→向量 rerank 评估"触发器，与行业结论一致，维持
**③ SuperPowers 脑爆借鉴（14+ skill 谱系拆解）**：诚实结论——其七阶段（brainstorm→worktree→plan→TDD→review→finish）我们**几乎全覆盖且执法更强**（Stop hook 依从性/goal_loop/verify 证据检查 vs 其 prompt 级约束；systematic-debugging≈fix 5-Why；receiving-review 反表演式同意≈Codex 处置三档；parallel dispatch≈workflow）。**唯一真缺口 = brainstorm 发散阶段**：苏格拉底式逐问澄清（一次一问）+ **多方案发散→trade-off→收敛**（我们 specify→plan 纯收敛，无"生成 2-3 候选方案+权衡对比让用户拍板"段）+ YAGNI 无情裁剪。与既有 AskUserQuestion 决策点惯例、judge-panel 结论（宽解空间多方案>单方案迭代）同构。→ **M9 候选：spec-driver brainstorm phase**（opt-in 前置发散段，feature mode specify 前）
