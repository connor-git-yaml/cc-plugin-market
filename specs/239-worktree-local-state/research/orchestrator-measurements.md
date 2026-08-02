# F239 主编排器实测证据

> 由主编排器在本 worktree 实测采集（调研子代理无 Bash 权限，本文件补齐其空白）。
> 采集时间：2026-08-02；worktree：`priceless-taussig-d61d73`；HEAD：`0ae3eb7`。
> 下游 plan / implement 阶段可直接采信本文件数据，无需重测。

## M1. AGENTS.md byte budget（对应 FR-007 / SC-004）

| 项 | 实测值 |
|---|---|
| `AGENTS.md` 字节数 | **23346 bytes** |
| Codex `project_doc_max_bytes` 默认 | 32768 bytes（32 KiB） |
| 占用率 | **71.2%** |
| 余量 | **9422 bytes** |
| 仓库内 `AGENTS*.md` 数量 | **1**（仅仓库根，无 nested） |

**结论**：当前**未超限**。调研报告 §C4 风险 2 中"粗估大概率已超限"的推断**已被实测证伪**，spec/plan 不得沿用该错误前提。但余量仅 28.8%，且共享区块由 `npm run docs:sync:agents` 自动生成、会随 `docs/shared/*.md` 增长，因此 budget 断言有真实守护价值。

## M2. 各 target 的 git ignored 状态（对应 FR-001 / FR-003）

Codex `.worktreeinclude` 官方语义**只处理 git ignored 路径**，故需确认候选项都满足前提：

| 路径 | 状态 | 归类 |
|---|---|---|
| `.env.local` | IGNORED | copy 类（secret） |
| `.claude/settings.local.json` | IGNORED | symlink 类 |
| `.specify/.spec-driver-path` | IGNORED | symlink 类 |
| `.agents/skills` | IGNORED | symlink 类 |
| `node_modules` | IGNORED | symlink 类 |
| `_reference` | IGNORED | symlink 类 |
| `CLAUDE.local.md` | IGNORED | symlink 类 |

**结论**：全部 7 项均为 ignored，满足 `.worktreeinclude` 的前提约束。

## M3. graph-only bootstrap 实测耗时（对应 SC-001）

```
spectra v4.4.0 — 批量生成 / 模式: graph-only（纯 AST · 零 LLM）
节点: 6079 | 边: 8050 (calls 926, depends-on 2034) | Python 符号: 16
CLI 自报耗时: 3.4s
外层墙钟（含进程启动）: 3690 ms
```

**结论**：相对 SC-001 的 1 分钟预算有约 **16×** 余量。即便 Codex-managed worktree 场景下拿不到主仓路径（调研 §A4 的社区 gap）、必须每次全量 `graph-only` 重建，也远在预算内——**这消解了调研 §C4 风险 3 的严重度**：不必为"从主仓 copy 现成图"的捷径做复杂设计，直接重建即可满足验收。

## M4. 🔴 实测发现的真实缺陷：本地重建后 sidecar 变成错误元数据

**复现步骤**（本 worktree 实地复现，非推演）：

1. 初始状态：`specs/_meta/.graph-source-commit` = `8092d1a`，`graph.json` mtime 为 10 天前；当前 HEAD = `0ae3eb7`，两者相差 **37 个 commit**
2. 执行 `spectra batch --mode graph-only` → `graph.json` 被从当前 HEAD 全新重建（mtime 更新为当前时刻）
3. 复查 sidecar：**内容仍为 `8092d1a`，未更新**

**为什么是缺陷**：`bootstrap_graph` 只在"从主仓 copy 了图"时才写 sidecar（`sync-worktree-local-state.sh:349-357`），本地重建路径完全不触碰它。于是重建后 sidecar 声称"此图来自 8092d1a"，而图实际来自 `0ae3eb7`——sidecar 从"缺失"退化为**主动误导**。任何按 sidecar 判定新鲜度的消费者都会拿到假阳性 stale（图其实是新的），反向场景下也可能拿到假阴性 ready。

**对 spec 的影响**：这实证了 FR-005 的必要性，并给出一条硬性要求——结构化状态必须在**每一次图内容变更后**更新（copy 与 local-build 两条路径都要覆盖），而不能沿用现有"仅 copy 时写"的语义。仅新增一个状态文件而不修正写入时机，会把同一个错误复制到新格式里。

**附带结论**：本 worktree 图在实测前已 stale 37 个 commit，且除人眼可见的 shell warning 外**没有任何程序化信号**——这是"静默宣称 ready"问题的活体样本，可作为本 feature 的 motivating evidence。

## M6. 🔴 仓库已存在两套互相矛盾的 provenance 记录（M4 的根因细化）

继续追查 M4 后发现：`graph.json` **自身内嵌** `graph.sourceCommit` 字段（`schemaVersion: 2.0`），且 `spectra batch --mode graph-only` 本地重建后该字段**正确更新**为构建时 HEAD（实测重建后 = `0ae3eb7`）。于是当前状态是：

| provenance 记录 | 位置 | 写入者 | 消费者 | 本次实测值 | 正确性 |
|---|---|---|---|---|---|
| 内嵌 `graph.sourceCommit` | `specs/_meta/graph.json` 的 `graph` 属性 | spectra 构建器（每次构建都写） | **F217** `GraphFreshnessVerdict.recordedSourceCommit` | `0ae3eb7`（=HEAD） | ✅ 正确 |
| F193 sidecar | `specs/_meta/.graph-source-commit` | `sync-worktree-local-state.sh`（仅 bootstrap copy 时写） | `check_graph_source_stale`（sync 脚本 rerun warn） | `8092d1a`（37 commit 前） | ❌ 已失准 |

**含义**：
1. M4 的缺陷影响面收窄——F217 侧的 freshness 判定读内嵌字段，本地重建后**不受** sidecar 失准影响；受影响的是 **sync 脚本自己的 stale warning 路径**：下次 rerun 会基于失准 sidecar 对一张实际新鲜的图**误报 stale**（假阳性）。
2. 但"两套 provenance 并存且可互相矛盾"本身就是 spec Non-Goals 里警惕的"两套不一致 stale 判定"——**它今天已经在仓库里发生了**，不是未来风险。
3. **对 FR-005 设计的直接建议**：结构化状态文件不应发明第三套 provenance；应以**内嵌 `graph.sourceCommit` 为唯一权威源**（与 F217 同源），状态文件只做"派生视图 + bootstrap 来源标注"；F193 sidecar 的角色需要在 plan 阶段明确处置（更新写入时机 / 降级为纯 bootstrap 溯源记录 / 由状态文件取代），不能三套并存。

另注：`graph.generatedAt` 恒为 `1970-01-01T00:00:00.000Z`（epoch 零值）——这是 F193 跨 worktree byte-level 可复现设计的一部分（时间戳会破坏 determinism，见 `tests/unit/graph/cross-worktree-byte.test.ts`）。**FR-005 要求状态文件含"生成时间戳"，plan 阶段须注意状态文件是本地运行态（gitignored、不参与 byte 对比）才能安全携带真实时间戳；若误把时间戳写进图产物本身会打破 F193 的可复现性护栏。**

## M7. F217 freshness 合同精确形状（FR-005 对齐依据）

`src/panoramic/graph/quality/quality-types.ts:79-93`：

```ts
export interface GraphFreshnessVerdict {
  state: 'fresh' | 'dirty' | 'stale' | 'unknown-provenance';  // 四态，非布尔
  recordedSourceCommit: string | null | undefined;
  currentHead: string | null;
  dirtyFiles?: string[];
  porcelainReadFailed?: boolean;  // porcelain 读取失败时保守判 dirty 并标注
}
```

**注意**：spec FR-005 当前写的是"是否 stale（布尔）"，与 F217 的**四态**口径存在对齐缺口——布尔无法表达 `dirty`（HEAD 一致但工作树有未提交改动）与 `unknown-provenance`（来源不可知，恰是"来源 commit 不明"的 B3 核心场景！）。spec 修订时应把状态字段改为四态（或显式说明映射关系），`unknown-provenance` 正好承载"不得复制来源 commit 不明的图后静默宣称 ready"的判定语义。

## M9. 全冷环境 graph-only 实测（C8 假设闭合）

针对 Codex 审查 C8 留下的开放假设「repo node_modules 是否为 graph-only 前置」，在 scratchpad 用 `git clone --local` 制造**零 node_modules、零预置图**的全冷副本（HEAD=`0ae3eb7`）实测：

```
spectra batch --mode graph-only（全局 CLI v4.4.0，via volta）
节点: 6079 | 边: 8050 —— 与热环境完全一致
外层墙钟: 3524 ms | exit 0
图内嵌 graph.sourceCommit = 0ae3eb7 ✅（冷路径 provenance 同样正确）
```

**结论**：全局 spectra CLI 自带依赖，graph-only **不需要** repo node_modules。SC-001 的 ≤60s 预算在最冷的 Codex-managed worktree 场景（无 node_modules、无主仓路径可达）下依然有 ~17× 余量，且**不需要**把 `npm ci` 计入 bootstrap 关键路径。spec 中可把「repo node_modules 非前置」从 [推断] 升级为已实测事实；唯一保留前置 = 全局 spectra CLI 可用。

## M8. 改动前测试基线（A/B 对照锚点）

2026-08-02 18:25 于本 worktree 实测 `npx vitest run`：

```
Test Files  483 passed | 4 skipped (487)
     Tests  5773 passed | 18 skipped | 21 todo (5812)
  Duration  48.39s
```

**零失败**。后续任何测试红都以此基线做 A/B 归因（基线绿 → 红为本 feature 引入；参考 [[project_f225_compound_command_hijack]] 的 detach A/B 判法）。

## M5. repo:check 校验族接入点（对应 FR-004 / FR-007 落点）

`scripts/repo-check.mjs`（26 行）是薄壳，实际逻辑在 `scripts/lib/repo-maintenance-core.mjs` 的 `validateRepository`（`:251-374`）。现有 **13 个校验族**，统一采用三段式契约：

```js
aggregateValidation('<族名>', validate<Feature>({ projectRoot: resolvedRoot }), warnings, errors, checks);
```

第 12 族 `graph-quality`（F217）与第 13 族 `spec-drift`（F219）的注释（`:345-358`）明确写了"照抄本行的三段式契约"。**本 feature 新增校验应作为第 14 族接入**，与既有风格一致。

⚠️ 注意 `:355-358` 的既有教训：若被接入的 validate 函数是 async 而漏写 `await`，`aggregateValidation` 会拿到 Promise 对象，`result.warnings ?? []` 退化为空数组造成**静默假通过**。新增族若为 async 必须保留 `await`。
