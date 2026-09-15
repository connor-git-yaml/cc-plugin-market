---
title: M11 stepback revision 1 — 待办总账、架构坏味道实测与架构 Feature 清单（第二批派发）
status: active（2026-09-15 用户逐条拍板 4 项决策，见 decisions）
created: 2026-09-15
stepback_revision_of: milestone-M11-honest-tooling-engine-debt-eval-prereq.md §3（第二批 / 第三批）、§5（收官判定）、§6（未做 / 未验证承接）
parent_milestone: milestone-M11-honest-tooling-engine-debt-eval-prereq.md
sources:
  - milestone-M11 §10 第一批交付账（8a33a6bb，8 commit）与五卡 fix-report / verification-report 的残余登记
  - milestone-M10 §12.4「M11 移交（架构还债）」清单——本文按 2026-09-15 实测证据逐项复核，不照单开工
  - docs/design/dogfooding-feedback-ledger.md 待处理 12 条（本轮分流）
  - 2026-09-15 主线程直接量测（函数长度 / 调用面 / 子进程 / 词表副本 / typecheck 计数，命令见 §2）
decisions:
  - 排期切分：小债先清、大拆分第三批（第二批 = 4 张 small 架构卡 + typecheck 三卡 + P1-F（先抽 mapper 骨架）+ 簇① 纪律 story；第三批 = runBatch 分阶段 + LLM 调用面收敛；其余 M12）
  - typecheck 燃尽：开专卡按错误类型分 3 批机械清理（TS2532 / TS2339 / TS18048），目标 ≤100 不变
  - 版本：直接切 4.7.0 含第一批（4.6.0 未 publish，其内容并入；本文同批把 release contract 升到 4.7.0，`npm publish` 仍由用户执行）
  - self-dogfood 墙钟 +65% 红项：安静窗口复测 N=2 再定性（复现 ⇒ 立归因卡；不复现 ⇒ 记噪声关闭）
workflow_ran: 否——M10 §12 三路架构审查（09-12）+ 第一批四路异构对抗已覆盖新代码，本轮改为主线程直接量测（≈0 token）；全量三轨 ≈ 4M token 属重复结论
---

# M11 stepback revision 1 — 待办总账、架构坏味道实测与架构 Feature 清单

## 0. 本轮体检结论（五卡合入后，主线程实跑）

| 卡 | 体检动作 | 结论 |
|---|---|---|
| A 诚实工具面 | 本仓图（`repo:sync` 干净树重建）统计 | 4,377 条 calls 边全带 `resolution`，basis 全为 `index`（占位启发式边不进最终图）；策略分布 import-table 3,037 / export-table 899 / class-member 175 / remote-class-member 137 / receiver-type-index 129；1,470 条边合并了多个调用点（11,967 个调用点） |
| B F291a | `npm run judge:doctor` | 3 mismatch / 9 match：本机 Stop hook 仍跑 4.6.0 缓存里的旧判定器——**publish + `claude plugin update` 之前，本机门禁不含 F291a** |
| C 簇④ | 真仓 `--preflight` / `--lint` | 133 / 201 两个同编号 fix-report 目录被指名跳过，冲突 49 → **0**；lint 17 条真写法问题（zero-fr 6 / entries-outside 8 / duplicate-ids 1 / duplicate-dirs 2）。**自伤一例**：`specs/295` 的 spec 正文逐字引用了占位字面量，被判成模板占位剔出活文档（本轮已改写措辞；判据须改为只看结构位置，→ A11） |
| D 图新鲜度 | 干净树 `repo:sync` | `graph-freshness → action=rebuild before=stale after=fresh`，首次自动收敛；但本机 MCP（全局旧构建）对同一张图仍报 `stale`（旧逻辑不认「只改文档的 commit」），同样等 publish |
| E 无头瘦身 | 三目标基线重采 | tokens in+out −89.1% / −79.1% / −48.2%；self-dogfood 墙钟 +65.5%、输出 token +87% 判红（单次采样）→ 决策 4 |

## 1. 待办总账（三来源合一，2026-09-15）

### 1.1 用户动作门（非代码工作，顺序固定）
1. `npm publish` **4.7.0**（本修订稿同批把 release contract 升到 4.7.0；4.6.0 号不再单独发）→ `claude plugin update` → G0-1 三项验收（`npm view` 4.7.0 / 全局 `spectra --version` commit == master / `judge:doctor` + `codex:doctor` 零漂移）。
2. Claude Code 已是 2.1.270（≥2.1.241）：F245 headless 基线可以复跑了——排进第二批「簇① 纪律 story」的验证项（Stop payload 键集本批已探针记录：`background_tasks cwd hook_event_name last_assistant_message permission_mode prompt_id scratchpad_dir session_crons session_id stop_hook_active transcript_path`）。
3. 4.7.0 发布满一周：adoption census 复测（≈ 2026-09-22）。

### 1.2 M11 §6 承接项状态
| 项 | 状态 |
|---|---|
| 性能基线两个版本未跑 | **已跑**（三目标 schema 1.2，8a33a6bb）；红项按决策 4 复测 |
| F170c SC-002/004、F170d SC-004 只在 `it.skip` | 仍并入 P1-H |
| `HAS_LLM_E2E` 真实 e2e | 09-14 已首次真跑 5/5 |
| typecheck:tests:full | 1042 → **1006**（第一批顺带 −36）；决策 2：三张专卡 |
| SDK 模式 Stop payload | headless Stop payload 已实录（2.1.270，裸探针插件）；SDK 模式仍未 |
| adoption census 复测 | ≈ 09-22 |
| F277 FR-018 独立观察 | 窗口保持 |

### 1.3 卡级残余（五卡 fix-report 登记，未修）
- E：`agents` / `memory_paths` 未在 init 校验；`baseline-collect` 硬编码 `claude-sonnet-4-6`；debt-intelligence 成本记录无 `reportedCostUsd`（→ A5）；长输出下 `--max-turns 1` 未实测。
- D：`.git/info/exclude` / 全局 excludesFile 不在判定面；建图前脏态采样窗口；`spawnSync` 超时不覆盖进程组（→ A2）；`repo:sync` 对 warn 步仍 exit 0。
- B：非规范目录名共用无目标桶；状态文件无 GC；F291b 仍暂不实施。
- C：占位判据是内容字面量（→ A11）；同目录既有实质 spec 又有 fix-report 时 fix-report 不进活文档（设计如此）；`--lint` 不对占位目录产 finding。
- A：`graph_hyperedges` 改紧凑 JSON；`tokenBudget` 自身字节不计入；未单独派对抗子代理（档位缺席）。

### 1.4 反馈账本分流（12 条）
3 条已由卡 C 处置（generator 漂移 / 分母不可见 / get-phases diagnostics）；2 条 sync 收尾条目已处理；其余 7 条分流：sync `--baseline` 对拍 → A11；审查态图 → A12；改判定器自身须先有制品 + 受控 A/B 口径 → 簇① 纪律 story；共享工作树 global-setup 隔离 → M12；赋值点 / 守卫查询 → M12（P1-J）；perf 红项 → 决策 4。

## 2. 架构问题与坏味道（2026-09-15 实测；命令可复跑）

| # | 坏味道 | 实测证据 | 复跑命令 |
|---|---|---|---|
| S1 | `runBatch` 单函数 | **1,476 行**（`src/batch/batch-orchestrator.ts:298-1773`，文件 1,775 行）；graph.json 有 3 处装配（`cli/commands/graph.ts:248`、`batch/stages/graph-assembly.ts:252`、`batch-orchestrator.ts:1301`）+ `community.ts:102` 写回 | `awk` 计函数跨度；`grep -rn "buildKnowledgeGraph(\|writeKnowledgeGraph(" src` |
| S2 | 四份语言 mapper 各自成体系 | typescript 1,405 / java 1,157 / python 1,093 / go 1,042 行；最长函数 java 879、ts 591+441、py 474+307、go 450+388 行；四份只共享 `fieldText` 一个函数 | 函数跨度扫描；`grep -oE "^function [a-zA-Z_]+" ...-mapper.ts` 求交 |
| S3 | `parseArgs` 单函数 934 行 | `src/cli/utils/parse-args.ts:283-1216` | 同上 |
| S4 | LLM 调用面 5 入口 | `core/llm-client.ts callLLM`、`panoramic/utils/llm-facade.ts callLLM`、`panoramic/qa/llm-caller.ts callQnALlm`、`auth/codex-proxy.ts callLLMviaCodex`、`auth/cli-proxy.ts callLLMviaCli` + `debt-scanner/llm-clients.ts`；成本真值（`reportedCostUsd`）只接了 CLI 一条路 | `grep -rnE "^export (async )?function (call\|invoke\|run)[A-Za-z]*(LLM\|Llm\|Claude\|Cli)" src` |
| S5 | git 子进程无统一 runner | 5 文件 7 处 spawn（agent-context-tools ×2、incremental ×2、gitignore-oracle、git-blame、source-commit），**0 处 killSignal**；卡 D 只在 source-commit 加了超时与 `--end-of-options` | `grep -rnE "(spawnSync\|execFileSync)\(\s*'git'" src`；`grep -rl killSignal src` |
| S6 | 新鲜度 / 诊断词表五处副本 | stale 原因码与人读文案在 TS 侧三处（`src/panoramic/graph/quality/quality-types.ts` 类型联合、`src/panoramic/graph/source-commit.ts` 生产、`src/cli/commands/graph-quality.ts` CLI 文案）与 .mjs 侧两处（`scripts/lib/graph-quality-core.mjs`、`plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs` 的 `STALE_REASON_PHRASES`）各写一份，TS↔mjs 边界不能互 import——卡 D 加一个原因码 `source-tree-dirty-at-build` 触碰了这五处 + 一份 JSON schema；MCP honesty 直接内嵌 F249 verdict（不复制词表，但「下一步提示」文案 CLI / MCP 两面各写） | `command grep -rl source-tree-dirty-at-build src scripts plugins/spec-driver/scripts`（剔除测试）；卡 D commit `9b93950d` 触碰文件清单 |
| S7 | MCP handler 样板三抄 | `agent-context-tools.ts` 1,082 行；fuzzy 解析块 ×2 + file-nav ×1，honesty 装配 ×3，enrichment 三路径 ×3；卡 A 每个返回面字段都要改 2–3 处 | `grep -c "resolveSymbolFuzzy(" src/mcp/*.ts`；`grep -rn "buildHonestyAnnotation(" src` |
| S8 | 合同副本手工同步 | 卡 B 状态形状改动要手改 data-model §8、judge-cli 合同、事件 schema 三处；卡 A 用「YAML 合同 + TS 常量 parity 测试」是本仓第一处机械对拍（`contracts/mcp-return-surface-contract.yaml`） | — |
| S9 | 测试类型闭合 | `typecheck:tests:full` **1,006** 错（TS2532 / TS2339 / TS18048 为主） | `npx tsc -p tsconfig.tests.json --noEmit --pretty false \| grep -c "error TS"` |
| S10 | 原子写三份 | `src/utils/atomic-write.ts writeAtomicJson` + `scripts/eval-judge-jury.mjs` / `eval-batch-repeat.mjs` / `lib/eval-quota-store.mjs` 各一份 `atomicWriteJson`；深比较器两份（`regen-collector-fingerprint-fixtures.ts collectDeepDifferences` / `graph-quality-pinned-staleness.test.ts compareGraphDeep`） | `grep -rnE "function (atomicWrite\|writeAtomic)"` |
| S11 | mapreduce 接通状态 | `architecture-narrative-mapreduce.ts` 570 行，仅 `batch-project-docs.ts` 引用（§12.4 记 1,055 行，现 570，已收缩）——保留，不再列「接通或删」 | `grep -rl architecture-narrative-mapreduce src` |
| — | 源码 TODO 注释 | **0 条真 TODO**（29 处命中 = debt-scanner 关键词表 18 + 其余 11 处全是关键词表 / prompt 文案 / 关于 TODO 检测的注释）——待办不在代码里，在文档账本里 | `grep -rnE "\b(TODO\|FIXME)\b" src` |

未复核、沿用 §12.4 登记（.mjs 侧不便量测）：spec-driver 诊断结果模型（`diagnostic-cli.mjs`）、审计事件合同清扫、判定器回执索引抽象、文档注入引擎合一、慢测试收敛、零守护用例清理。

## 3. 架构 Feature 清单

| # | Feature | 解决的坏味道 | 方案骨架 | 规模 / 档位 | 护栏 | 批次 |
|---|---|---|---|---|---|---|
| A1 | runBatch 真·分阶段 + graph.json 单一装配 | S1 | 把 `runBatch` 拆成 `src/batch/stages/*` 六段（discovery → skeleton → spec-gen → docs → graph-assembly（已有）→ summary），三处 `buildKnowledgeGraph` 收敛到 graph-assembly 一处，`spectra graph` 命令要么走同一 stage 要么裁掉 | large · 一般代码 | F220 charter 冻结快照（禁 `-u`）；F175 byte-stable；三目标 perf 基线不退 | 第三批 |
| A2 | 共享 git runner | S5 | `src/utils/git-runner.ts`：`timeout + SIGKILL`、`--end-of-options`、`-c` 钉死、stderr 尾、进程组收口；7 处调用点迁移；F268 反模式（spawnSync timeout≠硬界）登记为守卫 | small · **安全 / 子进程类** | 每个消费方逐一问「超时 / 信号是收益还是攻击面」；变异：删 killSignal 必红 | 第二批 |
| A3 | 新鲜度 / 诊断词表单源 | S6, S8 | `contracts/graph-freshness-vocabulary.json`（原因码 + 文案 + 下一步）由 TS 与 .mjs 两侧同读；parity 测试钉「五处副本 == 合同」；把卡 A 的「YAML 合同 + parity」做成通用 helper（吸收 A10） | small · **门禁类路径**（`scripts/lib` + `plugins/spec-driver/scripts`） | 文案逐字节不变（受控 A/B）；`graph-quality` / MCP / repo:check 三面输出不变 | 第二批 |
| A4 | MCP handler 管线抽象 | S7 | `resolveGraphSymbol(args)`（load + canonicalize + fuzzy）与 `finishEnvelope(data, honesty, enrichment)` 两个共享段，三个 agent-context handler + file-nav 复用 | small · 一般代码 | `feature-180` / `174` / `214` e2e 逐字节不变；`description-output-drift`；返回面合同 parity | 第二批 |
| A5 | LLM 调用面收敛 + 成本真值全路径 | S4 | 一个 `LLMKernel`（provider 适配 cli / codex / sdk）+ 统一 usage / cost 记录；debt-scanner / QnA / facade 改走 kernel；`reportedCostUsd` 覆盖闸不再因非 CLI 路径落回公式 | medium · 一般代码 | 三目标 perf 基线（含 cost 真值）不退；`HAS_LLM_E2E` 5 例 | 第三批 |
| A6 | mapper 共享骨架（P1-F 前置） | S2 | 先抽 4 份 mapper 共有的「调用点抽取 + import 绑定表 + 成员表」访问器骨架，再修 Java caller recall 3.4%；`.mjs` 顶层具名导出 symbol 缺席一并判 | medium · 图解析类 | **外部语料 A/B 必带**（GORM / HikariCP / hono 逐边 diff）；F249 双轨护栏；pinned 四份 | 第二批（= P1-F） |
| A7 | parseArgs 拆表 | S3 | 命令 → 选项表驱动，`--help` 由表生成 | small · 一般代码 | `cli-e2e` 全绿；`--help` 快照逐字节 | 第三批 |
| A8 | typecheck 燃尽三卡 | S9 | 按错误类型 TS2532（272）/ TS2339（250）/ TS18048（116）各一张 story，纯测试文件，目标合计 ≤100 | 3 × small · 测试 | 全量 vitest 零失败；不改生产代码；禁 `@ts-expect-error` 新增 | 第二批（并行） |
| A9 | 判定器内核整理 | §12.4 | 诊断结果模型 `diagnostic-cli.mjs` / 审计事件合同清扫 / 回执索引抽象 | medium · **门禁类** | 六套 fix-compliance 套件 + 判别语料全绿；异构对抗常设 | M12 |
| A10 | 合同层骨架通用化 | S8 | 并入 A3 | — | — | 并入 A3 |
| A11 | 占位判据结构化 + spec 写法清扫 + sync `--baseline` 对拍 | C 残余、lint 17 条 | 占位只看 H1 / `**Feature Branch**` 行 / FR 条目三个结构位置；本仓 6 份零 FR + 8 份 FR 写在需求节外 + 1 份重复编号按 lint 清单修正；引擎 `--baseline <old.json>` 对 stats 阶跃报警 | small · **门禁类路径** | identity 33 + extraction 3 + m11c 19 全绿；真仓 `--lint` 17 → 0；A/B 活文档 FR 集合不变 | 第二批 |
| A12 | 审查态图（脏树可审） | ledger C7 | `spectra batch --mode graph-only` 在脏树上建的图（`sourceTreeDirty:true`）在 MCP honesty 里标为「可用但含未提交改动」而非劝退；`repo:sync --graph-on-dirty` 显式开关 | small · 一般代码 | 卡 D 的 `builtFromDirtyTree` 语义不变；freshness 五原因用例全绿 | 第二批 |

M12 roadmap（本里程碑不做）：A9；共享工作树 global-setup 隔离；symbol 数据流切面（赋值点 / 守卫查询，随 P1-J）；F291b（仍待用户拍板）；S10 原子写 / 深比较器合一（随第一次触碰这些文件的卡顺带）。

## 4. 第二批（用户拍板后的排期）

| 编号 | 卡 | 模式 | 规模 | 档位 |
|---|---|---|---|---|
| F298 | A2 共享 git runner | fix | small | 安全 / 子进程类 · 异构对抗常设 |
| F299 | A3 新鲜度 / 诊断词表单源（含合同 parity helper） | refactor | small | 门禁类路径 · 异构对抗常设 |
| F300 | A4 MCP handler 管线抽象 | refactor | small | 一般代码（客户端可见性 A/B 逐字节） |
| F301 | A11 占位判据结构化 + spec 写法清扫 + `--baseline` | fix | small | 门禁类路径 · 异构对抗常设 |
| F302 | A12 审查态图 | fix | small | 一般代码 |
| F303 / F304 / F305 | A8 typecheck 燃尽 TS2532 / TS2339 / TS18048 | story ×3 | small ×3 | 测试 |
| F306 | A6 mapper 共享骨架 + P1-F Java recall | feature | medium | 图解析类 · 外部语料 A/B 必带 |
| F307 | 簇① 对抗审查 / implement 纪律 story（冻结 commit 进 prompt、「声称有守护但变异不红」固定切入角、「论据本身」攻击面、受控 A/B 口径、改判定器自身须先有制品、F245 headless 基线在 2.1.270 复跑） | story | small | 文档 + 一次 headless 验证 |
| — | P1-H 评测前置 | feature | medium | 第二批 ship 后启动（09-14 决策 4） |
| — | self-dogfood 墙钟复测 N=2 | 主线程 | 2 × ~95 min | 安静窗口，订阅配额 |

第三批：A1（large）、A5（medium）、A7（small）。

### 4.1 写入路径冲突矩阵（并行判定）

| 卡 | 写入路径 | 冲突 |
|---|---|---|
| F298 | `src/utils/git-runner.ts`（新）、7 处调用点（`src/mcp/agent-context-tools.ts`、`src/knowledge-graph/incremental.ts`、`src/utils/gitignore-oracle.ts`、`src/utils/git-blame.ts`、`src/panoramic/graph/source-commit.ts`） | 与 F300 同碰 `agent-context-tools.ts` → **F300 先 ship，F298 rebase 后迁移该文件的两处调用** |
| F299 | `contracts/`、`src/panoramic/graph/quality/quality-types.ts`、`src/panoramic/graph/source-commit.ts`、`src/cli/commands/graph-quality.ts`、`scripts/lib/graph-quality-core.mjs`、`plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`、`plugins/spec-driver/contracts/graph-quality-report.schema.json`、`tests/unit/contracts/` | 与 F298（runner 迁移）、F302（文案）同碰 `source-commit.ts` 不同区域 → **F299 先 ship**（纯查表替换，最小），F298 / F302 rebase 其后 |
| F300 | `src/mcp/agent-context-tools.ts`、`src/mcp/file-nav-tools.ts`、`src/mcp/lib/`、`tests/unit/mcp/` | 见 F298 |
| F301 | `plugins/spec-driver/scripts/sync-merge-engine.mjs`、`plugins/spec-driver/tests/sync-*`、`specs/<15 份 spec.md>` | disjoint |
| F302 | `src/mcp/lib/graph-honesty.ts`、`scripts/lib/repo-maintenance-core.mjs`、`src/panoramic/graph/source-commit.ts`（文案） | `source-commit.ts` 与 F298 / F299 同碰 → F302 在两者之后 |
| F303–F305 | `tests/**`（按错误类型分文件集，三卡先各自 `tsc` 列出文件集并去重后再开工） | 三卡互相 disjoint；与其余卡只碰测试文件，rebase 即可 |
| F306 | `src/core/query-mappers/**`、`src/knowledge-graph/call-resolver.ts`、`tests/unit/knowledge-graph/`、pinned 四份 | disjoint |
| F307 | `plugins/spec-driver/skills/**`、`templates/**`、`docs/shared/**`、`.codex/skills/**`（再生） | disjoint（wrapper 再生只在本卡） |

可并行：F299 ∥ F300 ∥ F301 ∥ F303–F305 ∥ F306 ∥ F307；F298 在 F299 与 F300 之后；F302 在 F298 与 F299 之后。先 ship 先 push，后者 rebase 最新 master 重跑验证。

## 5. 第二批派发 prompt

### 5.0 共用前置（逐条复制进每张 prompt）
- 在独立 worktree 跑；启动前 `git fetch origin master` 确认 HEAD ≥ `8a33a6bb`（本修订稿 commit 之后取其 hash）。
- 编号先查远端分支与 `specs/` 防撞号；制品落 `specs/<NNN>-<short-name>/`。
- 每 phase 对抗审查：门禁 / 判定器 / 守护 / 安全类改动异构对抗常设（独立子代理 + 换视角 + ≥2 切入角；对抗 prompt 把「论据本身」列为攻击面、要求**归因**不只列现象；「声称有守护但变异不红」固定切入角）；Codex 暂停期在 commit / fix-report 标注「Codex 审查暂停，异构档位缺席」。
- 对抗 / 变异实验只在 scratch 副本上做；派发对抗前冻结改动面；🔴 禁 `git stash` / `checkout` / `switch` 做隔离——受控 A/B 一律「复制副本 → 就地改 → 从副本还原」（同一棵树只换受审文件）。
- `specs/src.spec.md` 是再生噪声，永不入 commit；提交显式路径，禁 `git add -A`；`specs/products/_generated/*` 与 `.specify/project-context.suggestions.*` 只在有意 `repo:sync` 时提交。
- 图解析 / 采集面类改动验收必带外部语料 A/B（`~/.spectra-baselines/{gorm,HikariCP,hono}` 钉死 commit，逐边 diff，用**独立 worktree 构建的 master dist** 当 A 侧——把 dist 拷出仓库会因相对路径失败或产出空图）；语料选型先 `find` / `grep -c` 数目标扩展名文件数。
- 安全 / 权限 / 软链 / 子进程类卡：spec 阶段逐消费方问「这个能力对该消费方是收益还是攻击面」，能力默认 opt-in。
- 长跑对抗代理分段交付（每个切入角一份 partial 报告落 `specs/` 下）。
- 收尾附「工具使用反馈」四维度；有实质反馈同步 append `docs/design/dogfooding-feedback-ledger.md`（状态：待处理），"无"不落账。
- push `origin master` 前列 7 字段 report 等用户「确认 push」；pinned / 冻结快照严禁 `vitest -u`（外科替换 = preimage + 剥新字段深等 + 逐行形态审计）。

### 5.1 F298 · 共享 git runner（`/spec-driver:spec-driver-fix`，small，安全 / 子进程类）
问题：5 文件 7 处直接 `spawnSync/execFileSync('git', …)`，0 处 `killSignal`；卡 D 只给 `source-commit.ts` 加了超时 + `--end-of-options` + `-c` 钉死；F268 实证 spawnSync timeout 不是硬界（SIGTERM 被忽略穿透 60.4s）。
方案：`src/utils/git-runner.ts` 单一入口（`runGit(args, { cwd, timeoutMs, killSignal: 'SIGKILL', maxBuffer })`，恒 `--end-of-options`，`-c core.quotepath=off -c diff.renames=false` 按调用方显式传入不默认）；7 处迁移；返回结构化 `{ ok, stdout, stderr, signal, timedOut }`，调用方不再各自解析 errno。
🔴 护栏：`source-commit.test.ts`、`repo-sync-graph-freshness`（28）、`gitignore-oracle` / `git-blame` / `incremental` 现有用例全绿；F258 三态 gitignore oracle 不得退化为二态；agent-context `detect_changes` 的 `git-timeout` / `git-spawn-failed` 错误码不变（`response-contract` 17 工具错误合同）。
验收：每处迁移一个变异体（删 killSignal / 删 `--end-of-options` / 删超时）必红；进程组实验（子进程 `sleep` 派生孙进程）证明超时后无遗留；spec 阶段逐消费方登记「超时对该消费方是收益还是攻击面」。
预算：small；零 LLM。写入路径见 §4.1（`agent-context-tools.ts` 等 F300 ship 后再迁；`source-commit.ts` 等 F299 ship 后再迁）。

### 5.2 F299 · 新鲜度 / 诊断词表单源 + 合同 parity helper（`/spec-driver:spec-driver-refactor`，small，门禁类路径）
问题：stale 原因码与文案在 TS 侧三处 + .mjs 侧两处各写一份（S6），TS↔mjs 不能互 import；卡 D 加一个原因码改了五处 + 一份 schema；卡 A 首次用 YAML 合同 + parity 测试机械对拍，但只此一处。
方案：`contracts/graph-freshness-vocabulary.json`（原因码、人读文案、下一步提示、severity），TS 侧 `import` JSON、.mjs 侧 `readFileSync`，五处改为查表（类型联合由合同派生）；通用 `tests/helpers/contract-parity.ts`（加载 YAML/JSON 合同 + 与运行时常量逐项对拍）供 `mcp-return-surface`、`gate-class-path-list`、本合同三处复用。
🔴 护栏：`graph-quality` CLI 文本、MCP honesty JSON、`repo:check` 输出对同一张图受控 A/B **逐字节相同**；`freshness-stale-scenarios` 五原因 + `source-tree-dirty-at-build`；`bootstrap-status` 短语表测试；`graph-quality-report.schema.json` 的原因码枚举与合同同源。
验收：变异「合同删一个原因码」五处消费方测试全部红；副本 grep 归零（只剩合同一处字面量）。
预算：small；零 LLM。

### 5.3 F300 · MCP handler 管线抽象（`/spec-driver:spec-driver-refactor`，small）
问题：`agent-context-tools.ts` 1,082 行，impact / context / detect_changes 三个 handler 各抄一份「载图 → canonicalize → fuzzy → honesty → enrichment 三路径 → envelope」，file-nav 又一份 fuzzy；卡 A 每个字段改 2–3 处（S7）。
方案：`src/mcp/lib/symbol-resolution.ts`（`resolveGraphSymbol`：canonical / fuzzy autoResolve / symbol-not-found 结构化错误）+ `src/mcp/lib/envelope.ts`（honesty + enrichment 三路径 + `buildSuccessResponse`），四处复用；描述文案里的 Output 字段列表与合同 `carriedBy` 对拍。
🔴 护栏：`feature-180` / `174` / `214` / `171` e2e 与 `agent-context-tools` 单测（含 H-1～H-6）**响应逐字节相同**（受控 A/B：改动前后同一 tempRoot 同一输入）；`description-output-drift`；F266 honesty 四种「没查」形态不变；`type-test-program-closure` ≤24 文件。
验收：三 handler 行数合计下降 ≥ 30%（换算式：改动前 / 后 `wc -l` 之差 ÷ 改动前）；变异「fuzzy 阈值 0.9 → 0.5」在共享段一处即让 H-6 红。
预算：small；零 LLM。

### 5.4 F301 · 占位判据结构化 + spec 写法清扫 + `--baseline` 对拍（`/spec-driver:spec-driver-fix`，small，门禁类路径）
问题：`isTemplatePlaceholderSpec` 按内容字面量判定，讨论字面量的文档被误判（`specs/295` 实证）；真仓 lint 17 条写法问题长期存在；引擎 stats（`totalConflicts` 等）无上一版对拍，49 条虚假冲突靠人工双跑才暴露。
方案：占位只看结构位置（H1 含 `[FEATURE NAME]`、`**Feature Branch**` 行含 `[###-feature-name]`、FR 条目正文以样板句开头）；`--baseline <old.json>` 比对 stats 阶跃（conflicts / totalActiveFR / totalSpecs 任一变化 > 阈值即 warning + lint finding `stats-drift`）；按 lint 清单修正 15 份 spec（032 / 082 / 100 / 130 / 136 / 153 / 157 / 175 / 177 / 221 / 224 / 240 / 241 / 265 / 277）的 FR 写法或节位置——**只移位置 / 补编号，不改需求语义**。
🔴 护栏：identity 33 + extraction 3 + m11c 19；真仓 `--dry-run` 活文档 FR 集合改动前后 diff 只含被修正 spec 的新增条目；`--lint` 17 → 0；295 不再被判占位。
验收：变异「占位判据退回内容字面量」m11c W-3 用例红；`--baseline` 用例：conflicts 0 → 49 的构造必报。
预算：small；零 LLM。

### 5.5 F302 · 审查态图（`/spec-driver:spec-driver-fix`，small）
问题：审查者因「树脏 ⇒ 图 stale」放弃 MCP（两轮实证）；卡 D 已标 `builtFromDirtyTree`，但 honesty 文案仍劝退。
方案：脏树图在 MCP honesty 中给出「图含未提交改动（N 文件）—— 审查未提交 diff 时这正是你要的图」的用法提示而非「请重建」；`repo:sync --graph-on-dirty` 显式开关（默认仍 skip-dirty）；`graph-quality` 对 `dirty` 与 `stale` 的下一步分开写。
🔴 护栏：freshness 判定值不变（只改文案与开关）；`repo-sync-graph-freshness` 28 例；`graph-honesty` 单测；卡 D 五原因场景。
验收：脏树上 `impact` 返回的 honesty 文本含「未提交改动」提示且 `state` 仍 `dirty`；`--graph-on-dirty` 重建的图 `sourceTreeDirty:true`。
预算：small；零 LLM。串行于 F299（同碰 `graph-honesty.ts`）与 F298 之后。

### 5.6 F303 / F304 / F305 · typecheck 燃尽（`/spec-driver:spec-driver-story` ×3，small，测试）
问题：`typecheck:tests:full` 1,006 错；目标 ≤100（用户拍板）。
方案：三卡按错误码分工——F303 TS2532（可能为 undefined）、F304 TS2339（属性不存在）、F305 TS18048（可能为 undefined 的表达式）；开工前各自 `npx tsc -p tsconfig.tests.json --noEmit --pretty false | grep <code>` 列出文件集，三卡按文件去重后认领（同一文件只归一卡）；修法优先类型收窄与 non-null 断言的**就地证据**（`expect(x).toBeDefined()` 后用 `x!`），禁新增 `@ts-expect-error` / `any`。
🔴 护栏：每卡结束跑全量 `npx vitest run` 零失败（改断言语义 = 红）；`typecheck:tests` 门绿；`tests/unit/type-test-program-closure` ≤24。
验收：三卡合计后 `typecheck:tests:full` ≤100；每卡 fix-report 列「修前 / 修后计数 + 换算式」。
预算：3 × small；零 LLM；可并行。

### 5.7 F306 · mapper 共享骨架 + P1-F Java recall（`/spec-driver:spec-driver-feature`，medium，图解析类）
问题：四份 mapper 各 1k+ 行只共享 1 个函数（S2）；Java caller recall 3.4%（可达上界 8.5%，truth 含 JDK / 外部），部分在符号抽取层（图缺 private 方法节点）；`.mjs` 顶层具名导出 symbol 缺席待判；Python import 双 kernel 收敛。
方案：先抽共享访问器骨架（调用点抽取 / import 绑定表 / 成员表 / receiver 类型推断的语言无关部分），四份 mapper 改为语言差异层；再修 Java：private 方法进节点集 + 调用边；然后 Python import 双 kernel 收敛与 `.mjs` 具名导出。
🔴 护栏：**外部语料 A/B 必带**（GORM `688e8ea0` / HikariCP `ea81bfb5` / hono，逐边 diff，A 侧 = 独立 worktree master dist）；`graph-accuracy.mjs` 读数不得下降；F249 双轨护栏 + 四份 pinned（须再生时按 SOP「剥新字段深等」）；F263 receiver 遮蔽守卫；F259 假边判据存在性判定不改。
验收：Java call recall 3.4% → ≥ 6%（换算式：hits ÷ 819，单位：truth callee）且 precision 不降；四份 mapper 行数合计下降 ≥ 25%；`.mjs` 具名导出裁决落制品。
预算：medium；建图零 LLM。

### 5.8 F307 · 簇① 对抗审查 / implement 纪律 story（`/spec-driver:spec-driver-story`，small）
内容：把本文 §5.0 共用前置里的方法学条款落进 `plugins/spec-driver/templates/`（共享块）与 `docs/shared/`：冻结 commit 进 prompt；「声称有守护但变异不红」固定切入角；「论据本身」攻击面；受控 A/B「同一棵树只换受审文件」；改判定器自身的卡须先有 `specs/NNN` 制品；对拍基准须与被对拍路径同源；外部语料 A 侧须独立 worktree dist。附带验证项：F245 headless 基线在 Claude Code 2.1.270 复跑（Stop payload 键集与 F245 记录对拍）。
🔴 护栏：`validateSharedAgentDocs` 第 7 块 + wrapper 再生（`repo:sync`）；`spec-drift-repo-check-regression` 清单同批更新；`agent-docs-sd-mode-guard` 计数。
预算：small；headless 复跑走订阅。

## 6. 纪律追加（进 F307 共享块；本文先登记）
1. 给另一个代理当对拍基准的数字，取数路径必须与被对拍者同源（卡 C W-1）。
2. 「改动前 / 后」类结论一律要求同一棵树只换受审文件；纸面读码不得下方向结论（卡 B 审查者实证）。
3. 改判定器自身的卡必须先有 `specs/NNN` 制品，门禁对此结构性失明。
4. 外部语料 A/B 的 A 侧 = 独立 worktree 构建的 master dist（dist 拷出仓库会失败或出空图）。
5. 内容字面量判据会误伤讨论它的文档（`specs/295` 实证），结构位置判据优先。
