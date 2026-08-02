# F241 — 编排器主线核实记录

spec / plan 里留给「后续核实」的可查事实，由主线程逐条实查并落账。
每条给命令与证据，**不转述子代理结论**。

## V-1 ❗ 分发边界：F239 模块不随插件分发（**与 spec FR-007 / RG-006 冲突**）

```bash
find /Users/connorlu/.claude/plugins/cache/cc-plugin-market/spec-driver/4.4.0 -name "graph-bootstrap-status*"
# → 无输出
ls  /Users/connorlu/.claude/plugins/cache/cc-plugin-market/spec-driver/4.4.0/scripts/lib/
# → goal-loop-core.mjs 等 20 个文件，无 graph-bootstrap-status.mjs
```

**事实**：F239 的 `graph-bootstrap-status.mjs` 位于**仓根** `scripts/lib/`，
插件只分发 `plugins/spec-driver/**`，因此已安装的插件**够不到它**。

**与 spec 的冲突**：
- FR-007 要求插件侧「必须复用 `attemptLocalGraphBuild`，不得另写 spawn 逻辑」
- RG-006 禁止造第二份实现
- 但 D2 又把 B4 决策核心放在 `plugins/spec-driver/scripts/lib/`
→ 三者**不可同时满足**。plan 阶段必须解决。

**补充事实（决定可选方案）**：
- 插件脚本**无任何**跨目录 import 仓根文件的先例（grep `../../../../` 零命中）
- 但插件**有** spawn 全局 `spectra` 的先例：`plugins/spec-driver/scripts/kb-prequery.mjs:55`
  （`return 'spectra'; // 交给 PATH；不存在则 spawnSync ENOENT`）
- F239 模块现有消费方：`scripts/sync-worktree-local-state.sh`；
  测试 `tests/unit/graph-bootstrap-status.test.ts:22` 从仓根路径 import；
  `tests/unit/worktree-lifecycle-hook.test.ts:109` 会把该文件 **copy** 进临时 worktree 的 `scripts/lib/`

**候选解法（plan 拍板，不在本文件决定）**：
- (A) 把模块**移入** `plugins/spec-driver/scripts/lib/`，仓根 `scripts/lib/` 改为薄 re-export
  → 单一实现、可分发；代价是仓库维护脚本反向依赖产品插件目录，且要改上述两处测试
- (B) 插件侧按 kb-prequery 先例**直接 spawn `spectra`**，但这会复制 F239 的有界子进程 + 输出校验硬化逻辑
  → F239 源码注释明确警告「两份各自维护的 deadline 逻辑迟早会漂移」（其中一份就曾完全没有 deadline），**违反 RG-006 精神**
- (C) 只把「有界子进程 + freshness 解析」这一小块抽进插件，仓根 re-export（= A 的最小切片）

## V-2 ✅ FR-011「零改造 goal-loop-core」承诺成立

`formatIterationLogEntry`（goal-loop-core.mjs:777-783）直接 `JSON.stringify(entry)`，
**无字段白名单**：

```js
export function formatIterationLogEntry(entry) {
  const heading = `### 轮次 ${round}（round ${round}）`;
  const json = JSON.stringify(entry, null, 2);
  return `${heading}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}
```

→ 迭代日志新增 `graphDecision` / `degradedReason` 字段**无需修改 goal-loop-core**。

注入点在 feature SKILL.md「goal_loop 闭环编排」的**步骤 2**（编排器散文层发起 MCP impact 调用后
喂 `interpret-impact`）。在步骤 2 之前插入决策 CLI 调用即可，不触碰
`interpretImpactResult` / `decideStop` 函数体。**FR-011 与 RG-003 可同时满足。**

## V-3 ✅ `repo:check` 全绿且**无写入副作用**

```bash
git status --porcelain -uall > before; npm run repo:check; git status --porcelain -uall > after; diff before after
# → 无差异；repo:check exit 0
```

调研当时因担心 `generate*` 函数有写入副作用而未实跑，**该顾虑经实测排除**。
当前全部 family pass，含 `graph-quality:freshness: pass`（重建图之后）。

> **顺带发现的强联动**：`repo:check` 的 graph-quality 族**已经**包含 freshness 门禁。
> 也就是说「条件保活」已有一个天然消费方——图 stale 时 `repo:check` 会告警。
> plan 阶段可考虑让 B4 决策与该族共用判定，而不是各判各的。

## V-4 ✅ `tasks.md` 模板已强制每任务带文件路径（D3 前置预判信号可得）

`plugins/spec-driver/agents/tasks.md:37`：`- [ ] TXXX [P?] [USN?] 描述 + 文件路径`
`:79`：**每个任务必须包含文件路径**

→ spec 中 D3 的「implement 前预判信号 = tasks.md 目标路径是否 `fs.existsSync`」**有据可依**。

## V-5 ✅ `spectra graph-quality` 对缺失/损坏图的行为（决定 FR-003 矩阵正确性）

见 [pilot/baseline-observations.md](pilot/baseline-observations.md) O-6：
图缺失或损坏 → `freshness.state = "unknown-provenance"`、`overallVerdict = "cannot-assess"`、exit 2。
→ `graphAvailability` 与 `freshness` **非独立**；FR-003 的求值顺序（availability 先于 freshness）恰好正确，
但「144 组合」的措辞需修正为「含 6 类 unreachable-by-construction 组合」。

## V-6 ℹ️ `/codex:adversarial-review` slash command **已存在**（CLAUDE.local.md 过时）

`/Users/connorlu/.claude/plugins/cache/openai-codex/codex/1.0.3/commands/adversarial-review.md` 存在，
另有 `prompts/adversarial-review.md` 与 `schemas/review-output.schema.json`。

但 `CLAUDE.local.md` 仍写着「当前技能列表里没有 `/codex:adversarial-review` 这个 slash command」。
→ 该说明已过时，建议收尾时更新（属文档维护，非本 feature 功能范围）。

## V-7 ✅ 回归护栏「改动前」基线（供 RG-001 / RG-005 对照）

改动**任何代码之前**取的基线，交付时逐项复跑对比：

| 护栏 | 命令 | 改动前基线 |
|------|------|-----------|
| RG-005 KB 现有链 | `npx vitest run tests/kb/` | **32 文件 / 293 测试全 pass**，1.23s |
| RG-001 goal_loop core | `node --test plugins/spec-driver/tests/goal-loop-core.test.mjs` | **163 测试 / 23 suite 全 pass**，0 fail，93ms |
| RG-007 图质量门 | `spectra graph-quality --json` | `overallVerdict: pass`，六指标全 pass，freshness `fresh` @ `2e3a4cd` |
| 仓库级 | `npm run repo:check` | exit 0，全 family pass，**无写入副作用** |
| SC-018 全量测试 | `npx vitest run` | **490 文件 pass / 4 skipped（494）；6017 测试 pass / 18 skipped / 21 todo（6056）**，exit 0，58.5s |

图规模基线：**6092 节点 / 8062 边**（calls 926 / depends-on 2040），graph-only 重建 **4.4s**。
