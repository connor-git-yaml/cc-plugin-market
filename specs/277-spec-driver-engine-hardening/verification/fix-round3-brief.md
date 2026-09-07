# Phase A 对抗修订第三轮 · 实现简报（编排器拍板 · 2026-09-07）

> 执行者：代码实现子代理（角色等同 `plugins/spec-driver/agents/implement.md`）。**禁止使用 `Agent` 工具与任何 `mcp__*` 工具**。
> 项目根：`/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/vigorous-mahavira-7de572`；禁 `git stash` / `git checkout` / 切分支；**不要 `git commit`**。

## 必读
- `specs/277-spec-driver-engine-hardening/verification/adversarial-phaseA-round2-delta.md`（δ-C1「仅措辞变动」的 S2 / S3 / F1 / F2 四组构造；N-1 / N-2 / N-3）
- `specs/277-spec-driver-engine-hardening/implementation-notes.md`（D-1~D-31）
- `plugins/spec-driver/contracts/orchestration-schema.mjs` 的 `evaluateGateMountingAgainstBase` / `isProducerPhase` / `collectForeignProducers`
- `specs/277-spec-driver-engine-hardening/spec.md` FR-052 (丙) 与 `## 修订记录` 第 12–23 行

## 病根
判据 3b 用 phase **自身**的 `name` / `agent` / `agent_mode` 判「是否产出型」，三字段攻击者可写；且 base 自身就有 `agent: null` 的产出型 inline phase（`feature.research_synthesis` / `online_research`）。**废除 `isProducerPhase` / `collectForeignProducers`，不再按任何 phase 自身字段分类。**

## 新判据（只对照 base；若论证会引入恒真/恒假守护项，拒绝并说明）
1. **锚点三元组相等**：base 中挂载门 G 的每个锚点 (name, side)，effective 同名 phase 除「同侧仍挂 + 抑制条件不强于 base」外，`agent` 与 `agent_mode` 须与 base 逐字相等 → violation `anchor-tuple-changed`（否则把 `gate_design` 锚点 agent 改成 plan = gates_after 之前先跑 plan）。
2. **锚点前子序列**：取 base 中门 G **最早**锚点索引 i₀（feature 的 GATE_DESIGN 锚点为 `3.5.gates_after` 与 `4.gates_before`，取 3.5）。effective 中位于该门最早锚点之前的 phase 序列，须是 base 前 i₀ 个 phase 的**子序列**——匹配键 (name, agent, agent_mode)，每个三元组出现次数不超 base 同段计数；不匹配的 phase ⇒ violation `pre-anchor-phase-not-in-base`（可删不可增不可改；S2/S3/F1/F2 全部落此）。
3. **锚点后位序**（沿用）：base 中锚点之后的 base 名在 effective 中仍在其后；缺失即 violation。

`mounted` / resolver 丙 / FR-053 / `mounting_violations` 共用同一谓词；FR-053 断言条数保持 12。合同 yaml 丙条说明改为「锚点前只能是 base 同段子序列」；模板 `orchestrator-gate-mounting-guard.md` 的 `mounted` 语义句同步（禁 `mcp__` 字面量；避开 FR-049 代理判据词，见 notes D-10/D-17）。

## 测试先行
- S2 / S3 / F1 / F2 入库为 fixture（`attack-<mode>-<形态>.yaml`）+ 第五组「锚点 agent 改 plan」；先证现状三防线全绿（`viol=[]` / 仅 info / FR-053 12/12 / `isFallback=false`），再证修后 `error:gate-mounting-lost` + 回退 base + FR-053 红。
- 零误伤：`valid-overrides-goal-loop.yaml` 仍 `isFallback=false`；既有 attack/valid fixture 结论不变；**删掉锚点前某个 base phase**（合法缩减）不判红——正向用例钉死「可删不可增」。
- 变异体：分别去掉规则 1 / 规则 2 / 三元组的 `agent` 比较 / 重数限制，各至少一个用例红；`command grep -rn MUTANT` 归零。
- N-2 / N-3 / INFO 逐条判本轮修或登记；口径类 over-claim 必改文本。

## 收口
- 改模板后 `npm run docs:sync:agents`（幂等：快照→二跑→逐字节 diff 为空）；SKILL 变动触发 wrapper sha ⇒ `npm run repo:sync` 后定向回退无关再生产物（`git show HEAD:<path> > <path>`，只保留本卡 SKILL 的 wrapper）。
- **串行** `npm run build` → `npm run test:plugins` → `npx vitest run` → `npm run repo:check`；起跑前 `sysctl -n vm.loadavg` 1-min ≥ 8 则等待；预期全绿（仅 `graph-quality:freshness: warn`）；FR-049 代理判据 + `mcp__` 四条 `git diff -G` 零输出。
- 零运行时依赖；catch 禁返回空/pass；本环境 `grep` 是 `ugrep` function（原生用 `command grep`）。
- `implementation-notes.md` 覆盖写（当前 Phase「Phase A 对抗修订第三轮 · commit ① 前」/ 已完成 / 下一步 Phase B T034 / D-1~D-31 保留、D-32 起新增）；tasks.md Phase A 段末追加一行「对抗修订第三轮（δ-C1 判据重写）」，不新增编号。
- 不改 `spec.md` / `plan.md`（口径变化在摘要报告）；不动 Phase B/D/E；`repo-check-baseline.json` 禁改；不改 `.snap`。

## 返回摘要
执行摘要；五组构造修前/修后实测输出；「可删不可增」正向用例；变异体表；N-2/N-3/INFO 处置表；docs:sync 幂等与 repo:sync 回退清单；四条命令退出码；口径变化清单；新增/修改文件；工具使用反馈。
