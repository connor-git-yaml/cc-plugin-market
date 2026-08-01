# Trace — F237 V008 修复复测（F216 证据门后全池重跑）

分支：`claude/f237-v008-retest-f216-87eefb`
worktree（编排）：`.claude/worktrees/modest-ellis-e4f0fe`
基线：`0d292e3`（含 F216 / F219 / F220 / F231 全链 + 双 4.4.0）

---

## Phase 0 — 编排器 preflight（亲自执行）

用户 preflight 五件套逐条实测，结果与新发现如下。

| # | 检查项 | 结果 |
|---|--------|------|
| 1 | `SILICONFLOW_API_KEY` in `.env.local` | ✅ 存在（计数 1） |
| 2 | `claude --print` OAuth | ❌ **过期**：`Failed to authenticate: OAuth session expired and could not be refreshed`（绕过 sandbox 复测同样失败，排除沙箱阻隔） |
| 3 | `~/.codex/auth.json` | ✅ 存在；`codex-cli 0.144.6` 可用 |
| 4 | `npm run judge:doctor` | ❌ **status=drift**：active 快照 `~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.3.0`，2 mismatch + 1 missingInSnapshot |
| 5 | spectra 版本一致性 | ⚠️ 初测 dist 戳 `f8df35f` ≠ HEAD；`npm run build` 后已对齐 `v4.4.0 (0d292e3)`。全局 `spectra` 仍为 4.3.0（不入评测链路） |

### preflight 之外的新发现

- **P-7 分发链断裂**：`4.4.0` 从未推送到 `origin/master`（origin 停在 `ce2c036`，本地 HEAD 领先 2 commit）；npm `latest` = 4.3.0；marketplace clone 落后 `origin/master` 80 个 commit。
  → 用户 preflight #4 给出的补救路径「marketplace update + 重装 4.4.0」**物理上不可执行**（远端根本没有 4.4.0）。
- **P-8 全局 plugin 启用**：`~/.claude/settings.json` 中 `enabledPlugins["spec-driver@cc-plugin-market"] = true`
  → `eval-task-runner.mjs:917` 的同名加载歧义门禁会在 spawn driver 前硬 `throw`，整批变 runner error。
- **P-9 `FIX_COMPLIANCE_CLI` 覆盖入口**（Codex 发现）：详见下方 Codex 审查。当前实测 UNSET，shell rc 亦未导出。

### 评测资产盘点（复用 F212 worktree 的可行性）

| 资产 | `m8-closeout-212` | 本 worktree |
|------|-------------------|-------------|
| swebench venv | ✅ `scripts/.swebench-venv` | ❌ 缺 |
| pool-11 fixtures | ✅ 11/11 task 齐全（`.json` + `.goldpatch.diff`） | ❌ 空 |
| `.env.local` | ✅ | ✅ |
| F212 取证产物 | ✅ `.calibration-output/`（**取证保护红线，禁覆盖**） | — |
| git 状态 | ✅ 完全干净（0 改动） | — |
| 基线 | `4852bf1`，落后 `0d292e3` 共 66 commit | `0d292e3` ✅ |

外部依赖：Docker `29.2.1` 运行中 ✅；Surge 代理 `127.0.0.1:6152` 监听中 ✅。

**结论**：复用 `m8-closeout-212` 为评测 worktree 最省，但需切基线到 `0d292e3`，
而这会触发 prereg 的 `gitState` 门 —— `computePreregGitState`（`swe-bench-verified-cohort-batch.mjs:152-166`）
以 `git diff <frozenGitCommit> HEAD -- . :(exclude)<prereg>` 输出为空判定 `codeMatchesFrozen`，
跨 66 个 commit 必然非空 → 拒跑。故须按 F212 先例 **re-freeze prereg**（参照 `4852bf1` 的做法：
三 hash 零变化、仅更新 gitCommit 锚）。

---

## Phase 1 — Specify（委派 `spec-driver:specify`）

- 产出：`specs/237-v008-retest-gstack/spec.md`
- 规模：3 个 P1 User Story / 12 FR / 8 SC，无 NEEDS CLARIFICATION
- 子代理独立印证：drift 不污染跑批结果，但会在 launch 前造成一次硬报错（与编排器 P-6/P-8 结论一致）
- 子代理提出的口径分歧（编排器已核实收口）：
  `docs/shared/agent-eval-credentials-policy.md` 记的是 driver = `codex:gpt-5.6-sol` 的**另一条评测轨道**；
  本轮 headline 链按 F212 `RUNBOOK.md:6` 实证为 **driver = claude-sonnet-4-6（claude CLI）**。
  → 因此 OAuth 过期是**真阻塞**，不能用 codex 凭据替代。

## Phase 1-review — Codex 对抗审查（`codex:codex-rescue`，task-msa2zvzk-50pagh，7m）

总裁决：**不充分** —— 结论 2/3 成立，结论 1 需补两个前提。

| 档位 | 条目 | 处置 |
|------|------|------|
| CRITICAL-1 | `FIX_COMPLIANCE_CLI` 可整体覆盖判定器路径（`stop-fix-compliance-check.sh:17`），而 `eval-task-runner.mjs:567` 原样继承父环境且**无起跑门禁** | ✅ 实测当前 UNSET；已写入 spec 为前置条件 P-9 + FR-003 核验项 + 发射器显式 `unset` |
| CRITICAL-2 | 4.3.0 快照确缺 F216 证据门（成立） | ✅ 采纳，无需修 |
| CRITICAL-3 | 必须先 disable 全局 spec-driver，否则每个 runner 在 spawn 前 `throw`（成立；`parallel-run-pool.mjs:267` 固定传 `--skill-invocation`） | ✅ 采纳；F212 `RUNBOOK.md:20` 由发射器自动 disable + trap 恢复 |
| WARNING-1 | 「`--plugin-dir` 必然压过同名全局插件」**无仓库实证** | ✅ 已把 P-6 改写为带前提的条件性结论（依赖 P-8 + P-9 机械保证） |
| WARNING-2 | `.spec-driver-path` 在同名双加载下最后写入者不明（`postinstall.sh:44,73` 每次 SessionStart 覆盖写）；但 Stop hook 不读它 | ✅ 由 P-8 disable 排除该分支 |
| INFO-1 | 判定器闭包纯 `.mjs` + Node 内置，**不依赖 dist/编译产物** → 排除"路径对但构建旧" | ✅ 采纳为 P-6 支撑说明 |
| INFO-2 | 编排器原述「`noop:repro-fields` 仓库 3 处」「diff 980 行」计量不精确 | ✅ 修正为「4 次 occurrence / 3 个文件」，并标注行数为非稳定指标 |
| INFO-3 | disable 不会破坏源码 skill / agents / cohort3 MCP（F208 verification 实证） | ✅ 采纳 |

---

## GATE_DESIGN — 暂停（硬门禁 + 硬阻塞并发）

跑批被 **OAuth 过期**硬阻塞（只有用户能交互式 `claude /login` 解除），
故在此暂停并向用户提交阻塞清单与执行方案，等待裁决。
