# 问题修复报告 — F215 E2E 共享 baseline 解耦

## 问题描述

（用户原始描述）Feature 213 收尾时发现：`npx vitest run` 全量跑批期间，套件内某 full-batch 测试疑似把跨 worktree 共享的 `~/.spectra-baselines/micrograd-output/` 下的 graph fixture 改写为 spec-doc 级图（丢失 `micrograd/nn.py#MLP` 等 symbol 节点，目录 mtime 证据 17:33），导致 4 个 Spectra 图 E2E 文件（feature-180-graph-tools / feature-180-file-nav-stdio / feature-180-symbol-chain / feature-184-view-file-fuzzy，共 8 用例）查询 undefined 失败；隔离单跑仍失败（持久态污染，非负载 flaky）。要求：定位写共享 home 态的测试并改为临时目录；重建 fixture 恢复 E2E 绿；评估 `#`/`::` 统一去留（只记录不实施）。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 8 个用例为何失败？ | 测试断言的 `micrograd/nn.py#MLP` / `micrograd/engine.py#Value` 等 `#` 类级节点在共享 baseline graph 中已不存在，`nodes.find(...)` → undefined、graph_node 查询落空。共享图于 17:33（spec-doc 级过渡态）与 18:17–18:19（统一 `::` canonical 重建）两次被改写 |
| Why 2 | 共享图为何被改写？ | **写入者不是套件内任何测试**。静态排查全套件引用 `.spectra-baselines`/`homedir()`/`SPECTRA_BASELINE_HOME` 的 7 个测试文件，写路径全部为 mkdtemp 临时目录或 env 覆盖的临时 home（docs-bundle-orchestrator、baseline-collect、feature-165/175/176 等），无一写真实 home。运行期证据锁定写入者为**并行 F214 会话**（M9 轨道 B `graph-topology-canonical-id-1de3ab` worktree）：其 dist 进程 PID 10432 正在对 nanoGPT 执行 `batch --full --mode full --output-dir ~/.spectra-baselines/nanoGPT-output/spectra-full`；micrograd 重建 18:19:43 完成（collector 形态产物含 spectra-stdout.log，批 4 模块 145.3s）；17:47 曾误写 `specs/` 进 micrograd 源 clone。F214 tasks.md T001a/T029 明确排有 baseline 快照与重采集任务——这是**合法的 baseline 刷新**（CLAUDE.local.md 升版流程第 3 步），不是事故 |
| Why 3 | 合法的并行重建为何会打爆本套件？ | E2E helper（`tests/e2e/helpers/stdio-client.ts` 的 `BASELINE_GRAPH`）与 2 个集成测试把**跨 worktree 共享可变 home 路径**当稳定 fixture 直读，无 pin、无版本、无形状校验；任何会话的 baseline 重采集都会穿透所有 worktree 的测试运行 |
| Why 4 | 测试为何依赖一个必然漂移的外部产物？ | `#` 预期本身已**潜伏过期**：master 源码中 `#` 只存在于 query-helpers 的**读取兼容层**（"兼容旧格式 graph"），producer 端类级节点 + `::` 成员节点为当前双空间输出；home 旧图是 4 月 30 日 era 的冻结产物。测试输入从未被要求"可由当前 HEAD 重现"，绿=历史巧合。实证：F214 T001a 用 master HEAD graph-only 快照 micrograd 得 38 节点/14 边，含 5 个 `#` 类级 + 28 个 `::` 成员（`#MLP`、`::Value.relu` 都在）——master 当前输出**仍可满足全部消费方断言**，但 F214 重建后的 canonical 图（纯 `::`）不再含 `#` |
| Why 5 | 为何未被现有机制捕获？ | (a) skip-guard 只查 graph.json 存在性，不查形状/hash；(b) 无 in-repo canonical fixture，无 reproducibility 校验；(c) 共享 home 无写者互斥/所有权约定。F214 已排 W3/T028（legacy `#` fixture fail-fast），但那只挡"旧格式输入"，不解决共享可变态耦合本身 |

**Root Cause**: E2E/集成测试与跨 worktree 共享可变 home 产物（`~/.spectra-baselines/micrograd-output/.../graph.json`）强耦合，且断言锚定在当前代码已不再作为长期产物维护的历史图形状上；并行 feature（F214）的合法 baseline 重采集改写共享态后，过期锚点暴露为持久性失败。

**Root Cause Chain**: 8 用例 undefined 失败 → `#` 节点从共享图消失 → F214 并行会话合法重建 baseline（17:33 过渡态 / 18:19 canonical `::`）→ 测试直读共享可变 home 无 pin → `#` 预期锚定 4 月冻结产物、输入不可由 HEAD 再生 → 无形状校验/无 in-repo fixture/无写者约定。

**对任务前提的修正**：任务 1 假设"套件内某 full-batch 测试未用临时目录"——排查证伪。套件内所有 batch/baseline 类测试隔离合规，**没有可改为 mkdtemp 的写入者**；病根在读侧共享耦合。任务 1 的精神（杜绝套件内跨测试共享可变 home 态）由读侧解耦达成。

## 影响范围扫描

### 同源问题（需同步修复）
| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| tests/e2e/helpers/stdio-client.ts | L19-27, L59-72 | `BASELINE_GRAPH` 指向共享 home + skip-guard 查其存在性 | repoint 到 in-repo pinned fixture；skip-guard 改查 `MICROGRAD_SOURCE`（源 clone）存在性 |
| tests/integration/mcp-server-stdio.test.ts | L24-35 | 同 pattern 本地复制 | 同上 repoint |
| tests/integration/agent-context-real-graph.test.ts | L19-27 | 同 pattern 本地复制 | 同上 repoint |

（4 个 E2E 文件经 helper 间接消费，**断言零改动**。）

### 类似模式（需评估）
| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| 同上 3 文件 + 4 E2E | `MICROGRAD_SOURCE` 拷贝 nn.py/engine.py | 读共享 clone 的源文件（只读、.py 从未被改写；17:47 F214 误写的是 specs/ 子目录不动 .py） | 保留 + skip-guard；完全 vendor 化留后续（fixture 与真实 clone 内容需严格一致才可切换，tests/fixtures/micrograd 是 F140 手写 mini 快照与 clone **不同**，不可混用） |
| tests/unit/*（baseline-collect、eval 系、feature-165/175/176、docs-bundle） | — | 全部 mkdtemp/env 隔离 | [安全] |
| tests/fixtures/micrograd/ | — | F140 手写 mini 快照（职责不同） | [安全]（新 fixture 独立目录命名区分） |

### 同步更新清单
- 调用方: 无产品源码变更（纯测试基建）
- 测试: 上述 3 文件 repoint + 新增 fixture 目录（graph.json + README/meta 记 provenance 与再生命令）
- 文档: 本 fix-report + `#`/`::` 评估记录（见下）；无现有 spec 需更新

## 修复策略

### 方案 A（推荐）：in-repo pinned fixture + 读侧 repoint，home 不碰
1. 用**本 worktree master HEAD dist** 对 micrograd 源 clone 的**临时拷贝**跑 `batch --mode graph-only`（纯 AST、零 LLM、确定性、~3s），产物 `_meta/graph.json` 冻结为 `tests/fixtures/micrograd-baseline-graph/graph.json`（含 `#`+`::` 双空间，实证满足全部消费方断言；meta 记录 clone commit、生成命令、再生步骤）
2. 3 个读侧文件 repoint 到 in-repo fixture；skip 条件从"baseline 存在"改为"源 clone 存在"（dist 缺失条件不变）
3. `~/.spectra-baselines/**` **一个字节不动**：micrograd-output 已被 F214 合法重建为 canonical `::` 图且其采集管线正在运行（nanoGPT 进行中），本会话重建/回滚都会与其正面相撞并回退其工作
4. 验收：连续两轮全量 vitest 前后对 in-repo fixture 与 home 目录做 hash 对照，实证"套件不写共享态"

### 方案 B（否决）：按任务字面用 master dist 重建 home 图
恢复 `#` 形状会 clobber F214 刚重建的 canonical 基线并与其运行中的采集进程竞写；且共享可变态原样保留，F214 落地重采集后 8 用例再次爆炸（病根不除）。

### 方案 C（否决）：4 文件预期 `#`→`::` + 钉 `::` fixture
侵入 F214 统一范围（其 T028 fail-fast、T029 重采集及后续 E2E 翻转都在其任务清单内），制造同文件双改冲突；违反本任务"只评估不越界"约束。

## `#`/`::` 统一评估（任务 3：只记录，不实施）

**结论：留 M9-B，且已无需另立 feature——统一工作就是 F214（`graph-topology-canonical-id`），此刻正在兄弟 worktree 实施中**（spec/plan/tasks 已 commit：c609d45/e105160/cd94eaf，45 任务，src/knowledge-graph + graph-builder 改动进行中，baseline 重采集已在跑）。

不在本 fix 顺手修的理由：
1. **归属**：M9 roadmap §B1 与 F214 tasks（T002-T013 ID 收敛 + contains 边、T028 legacy fail-fast、T029 重采集）已完整覆盖该漂移；此处再修=同一仓库两个并行会话改同一批文件，必然冲突（memory `project_spawned_chip_parallel_duplicate` 的教训）。
2. **原子性**：统一需 producer + resolver + E2E 断言 + baseline 重采集作为原子交付单元（F214 R-1 硬约束），远超 fix 模式范围。
3. **兼容衔接**：本 fix 钉的双空间 fixture 是 master 今日真实输出；F214 落地时按其 T028/T029 一并翻转断言并**重生成本 in-repo fixture**（meta 已写明再生命令，反而给 F214 一个单点再生入口）。唯一交接注意：F214 的 T028 fail-fast（拒 `#` fixture）落地时必须同步重生成本 fixture，否则 helper 会对旧 fixture 抛错——已在 fixture README 中显式标注。

## Spec 影响
- 需要更新的 spec：F180 spec 需追加 Amendment（已完成，见 `specs/180-systematic-stdio-e2e/spec.md` 文末「Amendment — F215（2026-07-20）」）——原文 FR-014 / EC-7 / 背景段"baseline gate"把 `BASELINE_GRAPH` 字面定义为 `~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json`，与本次实现（repoint 到 in-repo `tests/fixtures/micrograd-baseline-graph/graph.json`）产生契约漂移；不改写原文语义（保持可考古），追加 Amendment 节说明 repoint + skip 条件语义收窄（从"baseline graph 存在"改为"micrograd 源 clone 存在"），并在 FR-014/EC-7/L28 就地加注"（F215 已修订，见文末 Amendment）"指引
- 交接记录: F214 落地时需重生成 `tests/fixtures/micrograd-baseline-graph/`（见 fixture README 与本报告）；skip 语义反转（已 clone 但未跑过 baseline collect 的机器，6 个消费文件从 skip 变为实跑）已在 fixture README 显式说明，重生成后须重跑 tasks.md T006 的 assertion 级验证方法论（非仅 exit code）

## 附：关键证据清单
- 进程：PID 10432 = F214 worktree dist 对 nanoGPT 的 full batch（运行中，18:19 起）
- 时间线：17:33 spec-doc 级改写（F213 观测）→ 17:47 F214 误写 micrograd 源 clone `specs/`（33 节点纯 `::` 图）→ 18:17:46 spectra-full 目录重建 → 18:19:43 micrograd canonical `::` 全量图完成（37 节点=4 spec+5 module+28 component，0 个 `#`）→ nanoGPT 采集进行中
- master graph-only 真实输出（F214 T001a 快照）：38 节点/14 边，5×`#`（Value/Layer/MLP/Module/Neuron）+ 28×`::`（含 `::Value.relu`）——满足 4 E2E 的 `#` 断言 + mcp-server-stdio 的 `::` 断言 + agent-context 的双格式断言
- 套件静态排查：7 个引用共享路径的测试文件全部 mkdtemp/env 隔离，无写 home 者

## Codex 对抗审查处置记录

| 编号 | 档位 | 结论 | 处置 |
|------|------|------|------|
| CRITICAL-1 | CRITICAL | skip 语义未拆分：`buildSkipCondition`/`buildSkipReason` 与 6 个消费文件把"in-repo fixture 恒存在"与"micrograd 源 clone 是否存在"混为一谈，导致 (a) fixture 若因检出不完整/漏提交缺失会被 skip 机制掩盖成"环境未就绪"而非报错、(b) 不需要拷贝 `.py` 的纯图套件（graph-tools/telemetry/mcp-server-stdio/agent-context）被不必要地要求 clone 存在才跑、(c) batch-repro 实际读 clone 却传 `requireMicrogradSource=false`，三者共同构成既存错配 | ✅ 已修：`installRelativizedBaseline`（stdio-client.ts）与 `writeRelativizedBaseline`（mcp-server-stdio.test.ts）开头加 fail-fast（fixture 缺失直接 throw，不允许被 skip 掩盖）；`buildSkipCondition`/`buildSkipReason` 语义拆分为「dist=硬前置，requireMicrogradSource=仅套件需读 `.py` 源文件时传 true」并写入 JSDoc；graph-tools/telemetry 的 skip 入参 true→false，batch-repro 的 false→true 按真实依赖归位；agent-context-real-graph.test.ts（in-process，无 dist 依赖）移除 clone 存在性 skip，改为 beforeAll fail-fast |
| WARNING-1 | WARNING | F180 spec（`specs/180-systematic-stdio-e2e/spec.md`）的 FR-014/EC-7/背景段与 F215 实现（BASELINE_GRAPH repoint 到 in-repo fixture）产生契约漂移 | ✅ 已修（Phase 4a spec-review 轮次处置）：文末追加「Amendment — F215（2026-07-20）」节说明 repoint + skip 语义收窄，FR-014/EC-7/L28 就地加"（F215 已修订，见文末 Amendment）"指引，不改写原文语义 |
| WARNING-6 | WARNING | 4 项文档细节需对齐：T001 验收命令字段名误用 `edges`（应为 `links`）；T007 保留危险的 `mv ~/.spectra-baselines/micrograd` 改名指引（与实际采用的 HOME 遮蔽法不一致）；T009 未记录真实完成状态；plan.md 的 `SPECTRA_BASELINE_HOME` 环境变量描述与 helper 实现（固定用 `homedir()`，不读环境变量）不符 | ✅ 已修：tasks.md T001 验收命令改 `g.links.length`；T007 动作/验收命令改为 `FAKE_HOME=$(mktemp -d) && HOME="$FAKE_HOME" npx vitest run ...`；T009 按 verification-report.md 实跑数据（两轮 5127 pass / 0 fail，结果一致，tsc 0 错误）补完成状态；plan.md R3 行修正为 HOME 遮蔽法并说明 `SPECTRA_BASELINE_HOME` 是采集脚本专用变量、与本 helper 无关；R5 行补充"vitest 以仓库根为 cwd 运行"前提 |
| WARNING-2 | WARNING | fixture 缺乏自动新鲜度门禁——producer（dist/graph-builder）演进后，fixture 与当前代码真实输出可能悄悄漂移而无 CI 信号提示 | 遗留风险，留 F214/后续 feature：新鲜度门禁（如 CI 定期用当前 dist 重跑 graph-only 对比 fixture diff）需要额外的 CI job 设计与"允许多大 diff"的判定策略，超出本次"解耦共享可变态"这一 fix 的最小闭环范围，且 F214 落地时本就会重生成本 fixture（见 F214 交接注记），先观察其重生成后是否仍需要独立新鲜度门禁再决定是否立项 |
| WARNING-4 | WARNING | fixture 内 5 条 `relation: "contains"` 边缺 `directional: true` 字段（producer 既存缺陷，其余 9 条 calls/depends-on 边均有该字段），顶层 `directed: false` 会使其被消费方当作双向边处理 | 遗留风险，留 F214/后续 feature：已在 fixture README 新增「已知偏差」节忠实记录该现状，明确不手动修改 fixture 掩盖 producer 缺陷；根因在 `graph-builder` 构建 contains 边时未写入该字段，属 producer 侧问题，F214 触及 `src/knowledge-graph`/`src/graph-builder` 时可顺带核查是否修复，本次 fix 硬禁区明确不 touch 这两个目录，故不在本次范围内动 |
