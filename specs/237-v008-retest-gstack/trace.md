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

## GATE_DESIGN — 暂停 → 用户解除

跑批被 **OAuth 过期**硬阻塞，暂停并向用户提交了阻塞清单 + spec 摘要 + 两个待拍板点
（spec 方向 / 4.4.0 分发是否本轮处理）。
用户回复「登录了」：解除 OAuth 阻塞，且对 spec 方向无异议 → 视为 GATE_DESIGN 通过，
分发问题按 spec Non-Goals 默认（本轮不处理）。复验 `claude --print` haiku 探针回 `ok` ✓。

---

## Phase 2 — Plan 前置实证（编排器亲自执行：诊断/扫描类）

### 评测链零漂移实证（re-freeze 合法性判据）

自 F212 冻结基线 `4852bf1` 至本分支 HEAD，以下全部 `git diff` 为 0：
- eval 链 12 文件（runner/pool-rerun/validate/calibrate/cohort-batch/split-sets/
  parallel-run-pool/preregistration-check/generation-infra/warmup-planner/verified-paths/build-spectra-stamped）
- oracle 语义 5 模块（`SEMANTIC_MODULES`：classify-oracle/phase-markers/swebench-oracle/
  swebench-dataset-build/swebench_fetch_rows.py）
- 判分周边 6 文件（eval-quota-store/cohort-aggregate/cohort-registry/local-spectra-plugin/eval-judge/eval-judge-jury）
- 数据文件：ab-manifest.json / pool-11.json / preregistration.md
- package.json dependencies 段零变化（仅 version 字符串与 scripts 段）→ eval worktree node_modules 免重装（实测 tsc/vitest/zod 可用）

→ 三 hash（oracleSpecHash `f4044f21…` / promptSha256 `a06fd18a…` / fixtureContentHash `19d8d42…`）
输入源全部不变，**re-freeze 仅需更新 prereg `gitCommit` 锚**（当前锚 `9fb3f89`），与 F212 先例同构。

### F237 前提成立性核验（F212 是否已含 F216）

- `git merge-base --is-ancestor c318351 4852bf1` → **NO**（4852bf1 早于 F216）
- `git merge-base --is-ancestor c318351 9fb3f89` → **NO**（F212 headline prereg 锚早于 F216）
→ F212 的 81.8% 确实测于 **pre-F216** 判定器，"F216 后复测"前提成立。

**归因诚实性备忘（写进最终报告）**：本轮 treatment 不是纯 F216——从 F212 基线到本轮基线，
`plugins/spec-driver` 累计含 F213–F236 全部变更（判定器直接相关：F216 证据门 + F218 拆分[行为保持] +
F228 占位符误报收口 + F229/F230/F231 绕过闭合）。headline 归因指向 F216（V008 病根的设计机制），
但报告须注明 treatment 是累计判定器 delta。

### F212 headline 实跑口径确认（`f212-headline.json` meta）

driver=`claude-sonnet-4-6` / runTimeoutMs=1200000 / swebenchTimeoutMsActual=1200000（透传口径，
prereg 冻结 300000 属 cohort-batch 链的已归档 lineage deviation）/ preregGatePassed=true /
wallMs=25.97M（约 7.2h，含 warmup 32min）→ 本轮 8h 预算够但不宽裕。
`DEFAULT_DRIVER_MODEL='claude-sonnet-4-6'`（parallel-run-pool.mjs:90）与口径一致。

### run 现场三层结构与撞名覆盖面（存档方案判据）

1. `tests/baseline/swe-bench-verified/tasks/<task>/<tool>/r<N>/full.json` — 判分 fixture，同键覆盖
2. `<eval-wt>/run_artifacts/<task>__<tool>__r<N>/` — patch.diff/stdout.log/stderr.log/oracle logs，同键覆盖
3. `~/.spec-driver-bench-worktrees/<task>/<tool>/r<N>/` — 完整 task worktree
   （含 `specs/001-fix-*/fix-report.md`、`.specify/runs/YYYY-MM.jsonl` 审计事件、task-runner-*.log），
   `prepareWorktree` 同键 **rm -rf** 重建（eval-task-runner.mjs:138-140）
- F212 V008 bench-worktrees 现存 r1/r2/r4/r5/r6（r3 已被覆盖——撞名事故实证）
- **F216 审计事件落盘**：`appendAuditEvent`（fix-compliance-io.mjs:146-157）写
  `<projectRoot=driver cwd=task worktree>/.specify/runs/YYYY-MM.jsonl` → V008 取证的审计源

### 其他

- `claude plugin disable/enable` 语法确认：`claude plugin disable <plugin> -s user`
- `SPEC_DRIVER_BENCH_HOME` UNSET → 默认 `~/.spec-driver-bench-worktrees` 与 F212 现场一致
- eval worktree `.specify/.spec-driver-path` 指 4.3.0 缓存：不入 driver 链路
  （driver cwd 是 bench worktree，非 eval worktree；且 SessionStart postinstall 会按 `--plugin-dir` 源重写）

---

## Phase 3 — Plan（委派 `spec-driver:plan`）+ Codex 对抗审查

- 初版 plan.md 产出（462 行，10 章）；plan 子代理补 5 个 spec 未定决策：
  re-freeze 锚 H=发射时编排分支 HEAD 且 anchor commit 永不合流 / 发射器进 `.calibration-output/bin/`（F212 教训）/
  取证两层边界（入库 evidence/ 精简版 vs 本地全量 tar）/ 审计事件按月 JSONL 现场 ls 防呆 / headline 无 jury 实付 ≈$0
- F212 发射器实物出土：`.calibration-output/bin/f212-launch-ab.sh`（`set -uo pipefail` 无 -e + trap restore）
  与 `f212-plugin-guard.sh`（独立脚本 + 状态机 + 6h deadline + 30s 节拍）——implement 按实物模式融合

### Codex plan 审查（task-msa5x5fb-iqqjrq，~15m）：7 CRITICAL + 7 WARNING

编排器盘上复核后全部采纳，关键实证：

| 条目 | 实证 | 修法 |
|------|------|------|
| C1 setsid 不存在 | `command -v setsid` 空（Darwin） | nohup + & + disown → reparent launchd |
| C2 set -e 吞 aborted 状态 | bash errexit 语义；F212 实物正是无 -e | 沿 F212 `set -uo pipefail` + `$?` |
| C3 fixture 路径写错链 | **盘上实证** pool 链在 `tests/baseline/tasks/<task>/<tool>-c3-r<N>/`（`_fixturePath` + `--fixture-suffix`）；`swe-bench-verified/tasks/` 是 A/B 链的树 | 存档/取证全改 + 现场 ls 确认 |
| C4 cp --parents 不可用 | BSD cp 实测 illegal option | rsync -aR 白名单抽取 |
| C5 **on-success 即删现场** | `--cleanup on-success` 硬编码（pool:258）+ runner oracle PASS 即 rmSync；**F212 V008 r3 缺失真因是 cleanup 而非撞名**（此前误判，更正） | **取证 watcher sidecar**：15s 节拍 rsync 全 11 task 文本核心到 `f237-live-forensics/`，零 eval 链改动零口径漂移；cleanup 前有 oracle docker 分钟级窗口 |
| C6 evidence 跨 worktree 断链 | Phase D 在评测 wt、git add 在编排 wt | 取证直接写编排 wt 绝对路径 |
| C7 claudeArgs 发射前不可得 | dry-run 不跑 runner；fixture 仅真 run 后落盘 | P-6 重构为**首 run 早期门**：首 fixture 落盘即验 `meta.args` 的 --plugin-dir，不符 kill 止损（只烧 1 run） |
| W1-W7 | trap 不杀子进程/守卫竞态/配额无硬门/re-freeze 触发 pre-commit/收尾 tar 无守卫/报告缺成本节/预核验 tee 吞码 | 逐条修；W3 诚实化为 advisory 人工模式（无 dashboard API，F212 同款）；W4 anchor commit 用 --no-verify（永不合流，理由入 plan） |

Codex I1-I6 正面确认：dry-run 边界表述诚实、re-freeze H/H+1 数学成立、存档体积可行（文本核心 ~25MiB + run_artifacts ~40MiB）、host shell 声明足够、SC-005/SC-009 落点明确。

### 修订落地 + 编排器复读残余（留给 implement 修）

- 14 处修复全部落进 plan（463→612 行），§10 可追溯表同步更新。
- 编排器复读发射器骨架发现残余（plan 明示骨架是伪代码，正式脚本 implement 落地时修）：
  **plugin 原始状态探测两处失真** —— `claude plugin list` 无 `--scope` 选项（实测 unknown option），
  且输出为多行块（`❯ <name>` 与 `Status: ✔ enabled` 分行），单行 grep `'<name>.*enabled'` 永不匹配
  → ORIG 状态恒为 disabled → 批后不会恢复用户插件。
  implement 修法：直接 `node` 读 `~/.claude/settings.json` 的 `enabledPlugins`（与 runner 门禁
  `globalPluginEnabled` 同源，权威且可机械断言）。

### F212 V008 基线明细（取证表对照基线，编排器从 pool 链 fixture 实测）

| repeat | runner status | oracle classification | bench worktree 现状 |
|--------|---------------|----------------------|---------------------|
| r1 | success | **fail** | 存活（fail 不清理） |
| r2 | success | **fail** | 存活 |
| r3 | success | **pass** | **已被 on-success 清理删除**（C5 实证闭环） |

→ F212 V008 = 1/3；runner status 全 success 而 oracle 才见真章（FR-009 教训再次实体化）。
oracle 真值唯一来源：fixture `taskExecution.primaryOracle.classification`。

---

## Phase 4 — Tasks（委派 `spec-driver:tasks`）+ Codex 对抗审查

- 初版 tasks.md：34 任务 + GATE-A/C，零 plan 矛盾上报；T008 判据带 settings.json 修正
- 编排器提前完成 T001（F212 现场存档）：pool-tasks/ab-verified/run_artifacts 三 tar +
  bench-text-core 59 目录（fix-report 36 / 审计 JSONL 25），修剪可再生 graph.json ×34 后总量 39M
  - 执行中 zsh 两坑实录：未加引号变量不分词（循环 0 命中）→ 内联列表；glob 无匹配 nomatch 报错 → NULL_GLOB
- 编排器实证 GATE-B 关键陷阱：F212 旧 fixture 躺在同路径（mtime 07-19）——首 run 早期门必须加
  `meta.runTimestampUtc` > 发射时刻守卫，否则拿旧 fixture 误判通过

### Codex tasks 审查（task-msa6xy26-gtwllr，~13m）：8 CRITICAL + 7 WARNING

全部采纳，要点：
- C1/C2 watcher 起跑时序反了（T014 先发射、T015 才起 watcher → 首 run 现场丢失）→ 重构为
  T014=复制脚本+起 watcher+心跳/存活断言，T015=起发射器+5min 内达 running 硬界
- C3 T006 的 P-8 核验用了不存在的命令形态 → node 直读 settings.json enabledPlugins；
  T006 重定位为「记录原始状态」，disabled 断言移 T015
- C4 watcher 生命周期与 abort/resume 矛盾 → 退出条件收敛三选一（completed / Phase D 后显式 kill /
  9h deadline），aborted 不再触发退出
- C5 GATE-C 前向证据依赖 → 当场生成 f237-anomalies.json，报告引用
- C6 L1 字段 selector 错误（真实为 primaryOracle.details.classifyReason）+ 全 absent 可通过
  → 接口固化 f237-v008-extract.json + 最低线（L1 必须在；PASS run 禁三源全空）
- C7 T032 git add 漏 ops/ → 补
- C8 T034 跳过交付验证链 → 新增 T033a（rebase + vitest + build + repo:check 零失败硬前置）
- W1 委派合同：T022/T024-T028（文档制品）改 [subagent:implement]；T004 保持 orchestrator
  并显式分类为运行态锚点 ops（同类 plugin disable，非入库制品）——编排器分类决定
- W2-W7：T004 判据+回退三断言 / 脚本验收逐条对照 plan 修复清单 / 接口固化（earlygate 稳定输出行 +
  mtime 守卫）/ T030 豁免收紧（降级须附证据反驳）/ 估时 8-11.5h / GATE-B 正名
