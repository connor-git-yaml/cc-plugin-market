# Feature 147 — Tasks

**Input**: [spec.md](./spec.md) + [plan.md](./plan.md)  
**Branch**: `feature/147-competitor-evaluation-platform`  
**Date**: 2026-04-30

每 task 标 `[P]` 表示同 phase 内可并行（仅文件编辑层）；spectra batch / 任务派发实跑必须串行（API rate limit）。每 phase 独立 commit，commit message 末尾标 `[Phase N/5]`。

---

## Phase 0：Feasibility spike + 竞品调研 + schema 1.1 设计（1-1.5 day）

### T0.1 Feasibility spike — SuperPowers / GStack 非交互式调用验证

- 在 `~/.spec-driver-bench-worktrees/spike-T1/superpowers/` 手动 git worktree add（基于 micrograd workspace）
- 安装 SuperPowers plugin 到该 worktree 的 `~/.claude/`（or via `/plugin install`）
- 跑：`claude --print --plugin-dir <superpowers-dir> "在 micrograd 加 Value.relu()"`
- 记录：是否能非交互式跑 + 产物是否合理 + wall + cost
- 同样跑 GStack
- **PASS 标准（SC-010）**：至少 1 个工具 + 1 个任务跑通端到端
- 输出：`research/feasibility-spike-log.md`（手动测试 log）

### T0.2 [P] competitive-landscape.md 深度调研

- 用 perplexity 深度调研每个竞品（每个 ≥ 200 字描述 + GitHub URL + commit/version pin + 工作流 + 与我们的差异点 + 可评估性）
- 至少 10 个：Spectra 类（Graphify / Aider repomap / Cody / RepoMapper / Bloop archived）+ Spec Driver 类（SuperPowers / GStack / Cursor rules / Copilot Workspace / Plandex / Devin）
- 输出：`research/competitive-landscape.md`（200-400 行）

### T0.3 [P] schema 1.1 final design（基于 spec §2.1.D）

- 写 `research/schema-1.1.md`，含完整 JSON Schema 定义
- 标注与 1.0 的 diff（新增字段 / 不变字段）
- 标注 anonymize 协议（哪些字段在 judge 前 strip）

### T0.4 Phase 0 commit

- commit message：`docs(147): Phase 0 — feasibility + landscape + schema 1.1 [Phase 0/5]`
- SC-010 PASS 才 commit

---

## Phase 1：scripts/lib 抽出 + Spectra 竞品 collector + F143 重生（1.5-2 day）

### T1.1 创建 scripts/lib/baseline-common.mjs

- 从 baseline-collect.mjs 抽出公共函数：`getBaselineHome / parseTargetFiles / parseBatchSummary / findLatestBatchSummary / parseGraph / parseLlmCalls / parseTimeStderr / runBatchAndCapture / runDryRun / prepareTarget / assembleFixture（schema 1.1）/ verifyArtifacts / writeFixture / readFixture`
- 加 schema 1.1 字段（`meta.pinnedAt / staleAfterDate` + `quality.specStructure / graphSanity / crossLinks / codingContextGrounding`）
- 加 `anonymizeFixture / reverseAnonymize`（W4 双盲）
- 加 `appendCumulativeCost`（§10.3）

### T1.2 重构 baseline-collect.mjs 基于 lib

- 移除已经移到 lib 的代码
- baseline-collect 主体 ≤ 400 行
- 跑全部现有 28 + 15 baseline 单测确认不破坏

### T1.3 [P] 创建 scripts/eval-competitor.mjs（spectra dispatch 完整 / Graphify + Aider 实现 / Cody stub）

- argv：`--target <name> --tool <spectra|graphify|aider-repomap|cody> --mode full`
- spectra 分支：复用 baseline-common（与 baseline-collect.mjs 等价）
- graphify 分支：spawn `graphify build` (假设 CLI；如不可用 fall back stub)；解析 graphify 产物提取 graph node/edge
- aider-repomap 分支：spawn `aider --map-tokens <N>` 或 `python -m aider.repomap`；解析 repo map 输出提取节点/文件 ranking
- cody 分支：stub（throw "Cody is optional/manual; see CLAUDE.local.md"）
- 每 tool 输出 fixture 到 `tests/baseline/<project>/<tool>/full.json`（schema 1.1）
- quality 段的 specStructure / graphSanity / crossLinks 通过静态分析填充（无需 LLM）

### T1.4 [P] 升级 baseline-diff.mjs schema 1.0/1.1 兼容（W7）

- 加 `--major-only` flag（默认）：1.0 vs 1.1 跨比 perf/output 段，quality 段 ignore
- 保留 `--ignore-quality` flag（F143 已有）

### T1.5 [P] 创建 tests/unit/eval-competitor.test.ts（单测 ~150 行）

- mock fixture 测 dispatch / parse / verify
- 不调真实 graphify / aider

### T1.6 重生 F143 fixture（升级 1.0 → 1.1）

- 跑：`npm run baseline:collect -- --targets self-dogfood,karpathy/micrograd,karpathy/nanoGPT --mode full`
- 期望：3 个 fixture 升级到 schema 1.1 + 含 quality.specStructure（structure check）+ crossLinks 检查
- cost ~$13（与 F143 重跑一致）

### T1.7 [P] 跑 Spectra 类竞品冷冻 fixture（micrograd × {graphify, aider-repomap}）

- `npm run eval:competitor -- --target karpathy/micrograd --tool graphify`
- `npm run eval:competitor -- --target karpathy/micrograd --tool aider-repomap`
- 同样跑 nanoGPT / self-dogfood
- 期望：6 个新 fixture（micrograd/nanoGPT/self-dogfood × graphify/aider-repomap）
- cost ~$10

### T1.8 Phase 1 commit

- commit message：`feat(147): scripts/lib 抽出 + Spectra 竞品 collector + F143 fixture 升级 1.1 [Phase 1/5]`
- 全部单测绿才 commit；累计成本守卫 surface

---

## Phase 2：scripts/eval-judge.mjs + Spectra 质量评估实跑（1.5 day）

### T2.1 创建 scripts/eval-judge.mjs

- argv：`--fixture <path> [--rubric spec-quality|task-execution|commit-quality] [--inter-rater 2]`
- 读 fixture → anonymize → opus rubric → 2 次 inter-rater check → reverse-map → 写回 quality 段
- rubric prompt 模板存 `scripts/lib/rubric-templates/{spec-quality,task-execution,commit-quality}.md`
- 单测 ~120 行（mock fixture + 期望 anonymize 输出）

### T2.2 在 micrograd 上调试 rubric prompt（可能多轮）

- 跑 `npm run eval:judge -- --fixture tests/baseline/micrograd/spectra/full.json --rubric spec-quality`
- 检查 opus 输出是否有 reasonable variance（不是全 8 分）
- 调整 rubric 直到 inter-rater diff < 1 分稳定（D3）

### T2.3 [P] Spectra spec-quality 维度全跑

- 3 项目 × 3 工具（spectra / graphify / aider-repomap）= 9 fixture × judge 2 次（inter-rater）= 18 次 opus 调用
- 写回 quality.specStructure / crossLinks / graphSanity 段（其中很多是静态分析已填，judge 只填 LLM 评分类）
- cost ~$5

### T2.4 Spectra coding-context grounding 维度评估（CLI prompt injection）

- 选 1 个简单任务（如 micrograd `Value.relu()` outline）作为 grounding 测试
- 4 个对照组：no context / spectra spec / aider repomap / graphify
- 每组让 sonnet 跑该任务 → opus judge 完成质量
- 记录 controlScore / taskScore / groundingDelta
- 写回 codingContextGrounding 段
- cost ~$3

### T2.5 Phase 2 commit

- commit message：`feat(147): eval-judge + Spectra spec-quality + grounding 评估 [Phase 2/5]`
- quality 段所有字段非 null + interRaterDelta < 1

---

## Phase 3：scripts/eval-task-runner.mjs + 任务集 + 工具 driver（2-3 day）

### T3.1 准备 6 个真实任务的 fixture 数据

- 写 `research/task-fixtures/{T1..T6}.json`，每个含：
  - 任务描述（自然语言 + 起始文件状态）
  - 主 oracle（unit-test 命令 / AST diff 检查 / regression curve / stop-condition）
  - 期望 diff outline（关键 marker，不强制完整代码）
  - 必跑 test 命令（如 `pytest tests/test_value.py -k relu`）
- 这是 1-1.5 day 的人工设计工作

### T3.2 创建 scripts/eval-task-runner.mjs

- argv：`--task <T1..T6> --tool <spec-driver|superpowers|gstack|control>`
- 流程：
  1. 准备 worktree（已存在 reuse）+ checkout 起始 commit
  2. 加载工具配置（plugin-dir / skills-dir，按 Phase 0 feasibility spike 决定的路径）
  3. spawn `claude --print --plugin-dir <path> "<task-prompt>"`（或 user-assisted fallback）
  4. 监测产物（git log / files changed）+ wall + tokens（从 claude 输出 / cost summary 解析）
  5. 跑主 oracle（动态 dispatch by oracle.kind）
  6. 写 fixture 到 `tests/baseline/tasks/<task-id>/<tool>/full.json`
  7. cleanup（按 --cleanup flag）
- 单测 ~150 行（mock 产物）

### T3.3 [P] 工具 driver wrapper

- `scripts/lib/drivers/spec-driver.mjs`：用 `/spec-driver:spec-driver-feature` skill
- `scripts/lib/drivers/superpowers.mjs`：用 SuperPowers `/getting-started/SKILL.md` 触发
- `scripts/lib/drivers/gstack.mjs`：用 GStack `/autoplan` 等 skill 链
- `scripts/lib/drivers/control.mjs`：纯 Claude Code，无插件
- 每个 driver 暴露统一接口：`async function run(workspaceDir, taskPrompt, options) → { wallMs, tokens, exitCode, ... }`

### T3.4 端到端验证（1 个任务 × 1 个工具）

- 跑 `npm run eval:task-runner -- --task T1 --tool spec-driver`
- 期望：fixture 落地 + oracle PASS
- 如失败：触发降级路径（plan §11）

### T3.5 Phase 3 commit

- commit message：`feat(147): eval-task-runner + 任务集 fixture + 工具 driver [Phase 3/5]`
- 至少 T1 × spec-driver 落地

---

## Phase 4：Spec Driver 维度全跑 + judge（1.5-2 day）

### T4.1 跑 6 任务 × 4 工具 = 24 worktree runs

- 串行跑（避免并发污染）；每 run cost ~$0.30-0.80，总 ~$20-30
- 每 run 输出 fixture 到 `tests/baseline/tasks/<task-id>/<tool>/full.json`
- 失败 run 触发降级（如 SuperPowers/GStack 非交互式不可行 → user-assisted）

### T4.2 跑 task-execution judge

- 24 fixture × 2 次 inter-rater = 48 opus 调用
- 评分维度：完成质量（rubricJudgeScore）+ commit history quality
- 写回 quality 段
- cost ~$15-25

### T4.3 worktree cleanup（plan §10.1 worktree 守卫）

- 跑 `git worktree prune` + 删除 cleanup=on-success 的成功 run worktree
- 失败 run worktree 保留供 debug

### T4.4 Phase 4 commit

- commit message：`feat(147): Spec Driver 4 工具 × 6 任务实跑 + judge [Phase 4/5]`
- 24 fixture（或降级后少）落地 + judge 通过

---

## Phase 5：总报告 + eval:refresh-self + release gate（1 day）

### T5.1 创建 scripts/eval-report.mjs

- 聚合所有 fixture 数据生成 markdown 总报告
- 表格：spectra vs Graphify vs Aider 对比（perf + spec quality + grounding）
- 表格：spec-driver vs SuperPowers vs GStack vs control 对比（task quality + wall + cost + intervention）
- 输出：`specs/147-*/competitive-evaluation-report.md`

### T5.2 [P] 创建 npm run eval:refresh-self 命令

- package.json 加：`"eval:refresh-self": "node scripts/eval-refresh-self.mjs"`
- 流程：跑 baseline-collect + eval-competitor（仅 spectra tool，不动 frozen 竞品）+ eval-judge + eval-report
- cost ~$30-40 / 次

### T5.3 [P] 创建 docs/release-gate.md（release gate B 文档约束）

- 描述触发条件 + 必跑命令 + PR 描述模板
- 加 `.github/pull_request_template.md`（如不存在）含 checkbox

### T5.4 Verification

- 跑全量验证：
  ```bash
  npx vitest run                              # 全 vitest
  npm run build
  npm run repo:check
  npm run baseline:collect -- --verify-artifacts
  test -f specs/147-*/competitive-evaluation-report.md
  test -f docs/release-gate.md
  grep -c "spectra vs Graphify" specs/147-*/competitive-evaluation-report.md  # ≥ 1
  ```

### T5.5 写 verification-report.md

- 文件：`specs/147-*/verification/verification-report.md`
- SC-001~010 验收记录（每条对应 fixture / 命令 / 输出）
- 累计 cost summary
- 已知偏差与 follow-up

### T5.6 Phase 5 commit

- commit message：`feat(147): 总报告 + eval:refresh-self + release gate [Phase 5/5]`

---

## Push 阶段

按 [CLAUDE.md](http://CLAUDE.md) "交付到 master" 约定：

```bash
git fetch origin
git rebase master
npx vitest run && npm run build && npm run repo:check
# 等待用户授权 push
```

不得自行 push。

---

## 任务依赖关系（DAG 简图）

```
Phase 0:
  T0.1 (feasibility) ⊥ T0.2 (landscape) ⊥ T0.3 (schema)
  ↓ 全部完成
  T0.4 (commit)

Phase 1:
  T1.1 (lib) → T1.2 (refactor collect)
  T1.1 → T1.3 (eval-competitor)
  T1.1 → T1.4 (diff schema 1.1)
  T1.1 → T1.5 (单测)
  ↓
  T1.6 (F143 重生) → T1.7 (Spectra 竞品冷冻)
  ↓
  T1.8 (commit)

Phase 2:
  T2.1 (judge) → T2.2 (rubric 调试) → T2.3 (spec-quality 全跑) ⊥ T2.4 (grounding)
  ↓
  T2.5 (commit)

Phase 3:
  T3.1 (任务 fixture) ⊥ T3.3 (drivers)
  ↓
  T3.2 (task-runner) → T3.4 (端到端 1 任务) → T3.5 (commit)

Phase 4:
  T4.1 (实跑) → T4.2 (judge) → T4.3 (cleanup) → T4.4 (commit)

Phase 5:
  T5.1 (report) ⊥ T5.2 (refresh-self) ⊥ T5.3 (release-gate)
  ↓
  T5.4 (verification) → T5.5 (verification-report) → T5.6 (commit)
```

---

## 实跑可行性说明

部分 task 需要：
- 配置好的 ANTHROPIC_API_KEY 或 Claude CLI 已登录（F143 已确认）
- 网络可访问 GitHub clone target / 安装 SuperPowers / GStack plugin
- 磁盘空间（~/.spec-driver-bench-worktrees/ 下 24 个 worktree × ~50MB = ~1.2GB）
- 时间预算（Phase 4 task 24 runs × ~5-15 min/run 串行 = 2-6 hours）
- 成本预算（首次累计 ~$120）

**累计成本守卫**：每 Phase commit 时输出 cumulative cost；超 $80 surface，超 $120 暂停等用户决策。

**降级触发条件**（natural fallback，不写专门测试）：
- Phase 0 SC-010 失败 → SuperPowers/GStack 改 user-assisted 或 skip
- Cumulative cost 超 $120 → Phase 4 跳过部分任务 / 部分工具
- Inter-rater diff 频繁 > 1 分（> 50% fixture）→ rubric 再迭代或人审兜底
