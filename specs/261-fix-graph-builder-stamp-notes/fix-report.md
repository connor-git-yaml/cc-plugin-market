# 问题修复报告 — F261 图产物 builder build stamp + implement 每 Phase 落 notes

## 问题描述

用户 dogfood 实证两条"工具自身可信度"缺陷：

1. **（主）图产物无 builder 版本戳，`sourceCommit` 反而误导**：`specs/_meta/graph.json` 的
   `graph` 元数据只有 `name / generatedAt / nodeCount / edgeCount / sources / skippedSources /
   schemaVersion / sourceCommit / fingerprint`，**没有任何字段标明这张图是由哪一版 `dist/`
   （builder）建的**。`sourceCommit` 记的是源码树 HEAD，而图实际是 `dist/` 编译产物建的，
   二者可以相差很远。真实事故：某 session 用陈旧 dist 建"基线"图，虚高偏差 148 节点，
   差点被当成回归信号。
2. **（次）implement 子代理断连损失**：implement 子代理中途 API 断连后，恢复方只能靠
   `SendMessage` + 磁盘态核实续接；实测"每完成一个 Phase 落一次进度 notes"显著降低断连损失，
   但该做法目前只是临时口头要求，未写进 `plugins/spec-driver/agents/implement.md` 默认约定。

**基线实证（本 worktree，HEAD=0d3e385f）**：

| 事实源 | commit | 说明 |
|---|---|---|
| 源码树 HEAD | `0d3e385f` | `git rev-parse HEAD` |
| `dist/.spectra-build-meta.json` | `eba46661` | 落后源码树 2 个 commit |
| `specs/_meta/graph.json` 的 `sourceCommit` | `8d25c264` | 更早 |

即"当前在盘的图"三条时间线两两不同，而图产物**只自述了其中一条**（`sourceCommit`），
第二条（builder）在图里完全不可见——这正是缺陷 1 的直接证据。

## 5-Why 根因追溯（缺陷 1）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何无法判断图是哪版 builder 建的？ | 图元数据里根本没有 builder 身份字段 |
| Why 2 | 为何没有？ | 既有 provenance 字段（F217 `sourceCommit`、F249 `fingerprint`）都锚在"**被分析的源码/采集面**"维度，隐含默认了"正在跑的代码 == 源码树" |
| Why 3 | 该默认为何不成立？ | 生产建图路径跑的是 `dist/` 编译产物；`dist` 与源码树是两条独立演进的时间线，只有 `npm run build` 那一刻才同步，开发中长期错位是常态（本次基线即错位 2 个 commit） |
| Why 4 | 为何长期没被发现是缺口？ | F249 collector fingerprint 提供了"provenance 已完备"的错觉，但它只覆盖**采集器扩展名面 + 手工维护的 `behaviorVersion`**；当 dist 落后但采集面恰好未变时，陈旧 dist 建的图与新 dist 建的图指纹**完全相同** → freshness 判定 `fresh`，静默放行 |
| Why 5 | 为何未被现有机制捕获？ | 现成事实源 `dist/.spectra-build-meta.json`（F176 `stampBuild` 盖章、F186 postbuild 接线）**早已存在**，但消费方只有 `spectra --version` 与版本门禁脚本，**从未接入图写盘链路**；也没有任何测试断言"图产物能自述 builder" |

**Root Cause**：图产物 provenance 缺失"**执行体（builder build）**"这一维——现有字段回答"基于哪版源码、
哪版采集面"，唯独不回答"由哪一版编译产物执行"；而现成的 build-meta 事实源未接入图写盘出口。

**Root Cause Chain**：陈旧 dist 建图被当基线 → 图里看不出 builder → provenance 字段只覆盖源码/采集面两维 →
dist 与源码树是两条时间线 → fingerprint 在采集面未变时同构、无法代偿 → build-meta 存在但未接入写盘链路。

## 5-Why 根因追溯（缺陷 2）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 子代理断连后为何损失大？ | 断连时点之前的进度只存在于子代理 transcript 中，主线程不可见 |
| Why 2 | 为何主线程不可见？ | implement 子代理默认只在**任务级**更新 `tasks.md` checkbox，不落"当前处于哪个 Phase / 下一步做什么"的可续接进度快照 |
| Why 3 | 为何没有这层快照？ | `agents/implement.md` 的"进度追踪"章节（第 5 条）只要求逐任务勾 checkbox，没有 Phase 级 notes 落盘约定 |
| Why 4 | checkbox 为何不够？ | checkbox 只答"哪些任务做完了"，不答"未完成任务里哪些已部分改动、下一步动哪个文件、有哪些已知偏差"——恢复方必须重新推断，推断错就重复劳动或覆盖已有改动 |
| Why 5 | 为何未被机制捕获？ | 断连是 harness 层偶发故障（见 `feedback_resumed_subagent_api_error_recovery`），没有任何门禁会因"子代理没留进度快照"报警 |

**Root Cause**：implement 子代理缺少 **Phase 级、落盘、可从磁盘态无损续接**的进度约定。

## 影响范围扫描

### 图写盘链路（缺陷 1 的作用面）

`writeKnowledgeGraph`（`src/panoramic/graph/graph-builder.ts:551`）是 F183 收口后的**唯一写盘出口**
（内部顺序：portable 守卫扫描 → `normalizeGraphForWrite` → `writeAtomicJson`）。其调用方：

| 文件 | 位置 | 场景 | 现状 provenance 写法 |
|------|------|------|------|
| `src/batch/stages/graph-assembly.ts` | L257-267 | graph-only（纯 AST） | `sourceCommit`=HEAD，`fingerprint`=当前指纹 |
| `src/batch/batch-orchestrator.ts` | L1503-1505 | batch 主链 | 同上 |
| `src/cli/commands/graph.ts` | L198-204 | `spectra graph`（不解析源码） | 二者显式写 `null`（诚实降级） |
| `src/cli/commands/community.ts` | L99 | community 持久化回写 | 沿用图中已有值 |

**结论（同源判断）**：builder stamp 回答的是"**这份文件由哪一版编译产物写出**"，是**写盘动作自身**的属性，
不是"源码分析链路"的属性 —— 因此它与 `sourceCommit`/`fingerprint` 的"非 AST 路径写 null"惯例**不同源**，
应统一注入在 `writeKnowledgeGraph` 写盘出口内部，覆盖全部四条调用链，无需逐调用方接线。

### 同类模式（需评估，非同源）

| 位置 | 模式 | 评估 |
|------|------|------|
| `src/cli/version-meta.ts` | 已读 build-meta 取 `commit` 供 `--version` | **安全**：已是 build-meta 的既有消费方，本次新增第二个消费方，不改它 |
| `src/panoramic/graph/source-commit.ts` `evaluateFreshness` | 五级优先级 freshness 判定 | **需评估**：是否把 builder 差异纳入 stale。**结论：不纳入**（见下"修复策略"决策 2） |
| `src/cli/commands/graph-quality.ts` | 六指标 + freshness 报告渲染 | **需评估**：可作为**非门禁**可见面输出 builder 信息 |

### 回归护栏面（必须不破坏）

- **byte-stable**（F183 `normalizeGraphForWrite` + F193 portable 守卫 + `stripTimestamps` epoch 语义）：
  新字段取值必须**跨两次连续运行确定性相同** → 必须排除 build-meta 里的 `builtAtIso`（时间戳）。
- **e2e pinned fixture**（F215 `tests/fixtures/micrograd-baseline-graph/graph.json`）：经核实，该 fixture
  只被**读取**（`mcp-server-stdio` / `agent-context-real-graph` / `graph-quality-lang-matrix` /
  `feature-180-*` e2e），**没有**"新建图 ↔ fixture 逐字节比对"的用法 → **无需再生**。
- F249 指纹 / F254 图自述面 / F217 六指标 / F193 加载期 stale 检测：新增**纯可选**字段，判据不交叉。

### 同步更新清单

- 调用方：无需逐个改（统一在写盘出口注入）
- 类型：`GraphJSON['graph']` 新增可选字段（`src/panoramic/graph/graph-types.ts`）
- 测试：红先行覆盖两项缺陷（builder stamp 可见性 + byte-stable 不回退；implement.md 约定落地）
- 文档/门禁资产：`plugins/spec-driver/agents/implement.md` 改动后必须 `npm run repo:sync` 重生
  并连带提交 `skills-codex/` 与 `.codex/skills/` 侧（F186/F238 wrapper sha 门禁）

## 修复策略

### 方案 A（推荐）：写盘出口统一注入 + 只做"可见"不升门禁

1. **新增模块** `src/panoramic/graph/builder-stamp.ts`：从**运行中模块自身位置**向上有界回溯定位
   `.spectra-build-meta.json`（编译后 `dist/panoramic/graph/` → 上溯到 `dist/`），解析出
   `{ commit, dirty, distSha256 }` 三项**确定性**字段（**MUST NOT** 携带 `builtAtIso` 等时间戳）。
   - 从源码/tsx 直跑（vitest、dev 模式）时上溯不到 meta → 返回 `null`，**诚实降级**为"非盖章 build"，
     与 F217/F249 的 null 惯例一致。
   - 只查祖先目录、不查 `<祖先>/dist`：避免 tsx 跑 src 时误把仓库 dist 当作自己的 builder。
2. **注入点**：`writeKnowledgeGraph` 内部（归一化之前），写入 `graph.graph.builder`。
   四条写盘链路自动覆盖。
3. **可见面**：`spectra graph-quality` 输出中以**advisory/INFO** 形式展示 builder commit 及其与
   `sourceCommit` 是否一致，**不改 exit code、不改 overallVerdict、不进 freshness 四态**。
4. **implement.md**：在"进度追踪"章节补 Phase 级 notes 落盘默认约定（每完成一个 Phase 写一次
   `{feature_dir}/implementation-notes.md`，含已完成任务 ID、当前 Phase、下一步、已知偏差），
   随后 `npm run repo:sync` 重生 wrapper 并连带提交。

**决策 2 的理由（为何不纳入 stale 判据）**：`dist` 落后于源码树是开发期常态（本仓库当前基线即如此），
直接把 `builderCommit ≠ sourceCommit` 判为 stale 会让 `graph-quality` 天天红、迅速被当作噪声忽略，
反而降低现有 stale 信号（真正的采集面变更）的信噪比。本次目标是把不可见的事实变成**可见且机器可读**；
是否升为门禁应在有实际误判数据后另行决策。

### 方案 B（备选）：只加字段，不动 graph-quality

改动面更小、风险最低，但"让人立刻看出"要靠人肉读 JSON，弱于验收要求。**不采纳**，但若 graph-quality
渲染改动在实施期被证明会扰动既有输出契约测试，则退回本方案并记录理由。

## Spec 影响

- 需要更新的 spec：**无需更新**（本次为纯 provenance 字段新增 + agent 默认约定补充，不改任何已定义行为面）。
- `schemaVersion`：**不 bump**，沿用 F217 决策 5 / F249 的既定约定（纯可选新增字段，向后兼容）。
