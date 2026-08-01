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

---

## Phase 5 — Implement：T008-T013 ops 脚本（委派 `spec-driver:implement`）+ Codex 对抗审查

- 6 脚本落 `specs/237-v008-retest-gstack/ops/`（732 行），子代理自测含真实功能模拟
  （earlygate 三场景 PASS/WAIT/FAIL；precheck 经 symlink 沙盒端到端跑通全链路）
- 子代理关键微决策（编排器采纳）：
  1. **c3 实际传两个 `--plugin-dir`**（spectra 在前、spec-driver 在后，runner:311/314）——
     `indexOf` 取首个会拿到 spectra 目录 → 永假阴性；已改全量扫描任一命中即 PASS
  2. archive 子命令名从 post 改 v008（tasks.md 字面断言为准）
  3. watcher rsync 用白名单模式（与 F212 存档同构）

### Codex 脚本审查（task-msa847e9-e52c6n，~18m）：6 CRITICAL + 5 WARNING

| 条目 | 要点 | 修法 |
|------|------|------|
| C-1 | **INT/TERM 只杀父 node**：runner 以 `detached:true` 独立进程组 spawn（pool:197），
杀父后孤儿续跑续烧配额，止损语义不成立 | on_interrupt 补 `pgrep -f 'eval-task-runner.mjs.*--fixture-suffix c3-r'` 逐组 TERM→10s→KILL |
| C-2 | earlygate 40min 上限 < 合法最坏 60min（warmup 预算 40min——F212 实测 32min——+首 run 20min） | 上限改 75min |
| C-3 | 「只烧 1 run」不成立：串行调度下 r2 在 gate 轮询间隙已起跑 | 措辞改「≤2 run」；杀伤由 C-1 进程组补杀承担 |
| C-4 | archive v008 无完成态守卫却会杀 watcher | status=completed 硬守卫 + extract JSON 存在校验 + watcher 仅成功路径尾部 kill + --force 人工旁路 |
| C-5 | 归档失败被吞、无条件「归档完成」 | FAIL_COUNT 传播，>0 则 exit 4 |
| C-6 | v008 非幂等：旧证据与旧 .absent 共存串档 | 逐 run 目标目录 rm -rf 重建 + 双向清理 |
| W-3 | **rsync 首匹配定胜负**：graph.json exclude 排在 `--include='*.json'` 之后永不生效（73 万行图会进 live-forensics）| 过滤链重排：全部 exclude 前置 |
| W-1/2/4/5 | RESTORED 过早置位 / 守卫无活性确认 / v008 glob 猜测 / pre 幂等无完整性验证 | 逐条修（v008 改消费 f237-v008-extract.json 权威路径） |

Codex 正面确认：guard/launch 状态字段同名、11 task 完整、macOS openrsync 支持 -R/--prune-empty-dirs、
precheck 与正式门逐项同构（cwd=评测 worktree 根时无分裂）、meta.args 双 plugin-dir 解析实测正确。

修复后终验：`bash -n` ×5 + `node --check` 全绿；11 处修复标记独立复核命中；ops 提交 `44cb919`。

---

## Phase 6 — Phase A 执行 + 发射（编排器 ops，2026-08-01 18:40-18:53 CST）

| 任务 | 结果 |
|------|------|
| T001 存档 | ✅（提前完成，39M：三 tar + bench-text-core） |
| T002 切基线 | ✅ `237-eval-rerun` @ `44cb919`，树干净，四类资产存活 |
| T003 dist 门禁 | ✅ 戳 `44cb9195`，F177+F181 版本门禁过 |
| T004 re-freeze | ✅ H+1=`7208db3`（仅 prereg 1 文件 ±1 行）；三断言 PASS；备份 `f237-refreeze-backup.txt` |
| T005 三 hash 预核验 | ✅ exit 0，`ok:true`（prereg 冻结集 10 task + VB003 独立字节锚），留档 `f237-prehash-check.json` |
| T006 原始状态 | ✅ `f237-plugin-orig-state.json`：spec-driver=true / spectra=true |
| T007 dry-run | ✅ 33 行 + `PASSRATE=DRY_RUN` |
| GATE-A | ✅ 全项记录齐备，放行 |
| T014 watcher | ✅ PID 60603，父退出后存活，心跳 32s 内 3 行（15s 节拍） |
| T015 发射 | ✅ PID 60838，launch_epoch=1785581214，**25s 内达 running** |

发射后即时日志确认：
- prereg 三重门（oracleSpec/prompt/fixture/gitState/taskSet）✅ —— 与 T005 预核验一致，无分裂
- F176 子集内容锚（10 fixtures == 19d8d42…）+ 池 taskSetHash 6b2d1845…（11 tasks）+ VB 字节锚 ✅
- 计划：11 task × c3 × N=3 = 33 runs，budget 8h，driver=claude-sonnet-4-6（口径与 F212 全同）
- API 连接门禁 OK；守卫 sidecar GUARD_PID=62334 存活确认 OK
- 串行预热 3 env（sympy@1.12 / pytest@7.2 / astropy@5.2）开始——F212 实测此段 ~32min

监控编排：GATE-B 早期门后台挂起（75min 窗口，mtime 守卫 + 双 plugin-dir 全扫描）；
监控循环每 6 新 run / 95min / 终态唤醒，进度口径 = fixture `primaryOracle.classification`（非 runner status）。
慢验窗口自此开启：禁改 `plugins/**` 与 eval 链脚本，直至批次终态。

## Phase 7 — 跑批全程与终态（2026-08-01 18:53 → 08-02 03:00 CST）

### 主批（6.72h，30 run 后预算保护截停）

- 逐波监控唤醒 5 次（6-run/95min 节拍），进度口径全程用 fixture `primaryOracle.classification`
- 30 run 完成后 pool 判定「余 46min < 下一 task 需 65min」→ 主动截停 exit 2（**预算保护，非故障**），
  数据落盘 partial=true；trap 按原始状态恢复两 plugin ✓
- resume（0.67h）：meta 硬校验过 → 跳过 30 终态 run（终审 W4 更正：日志载入 30 条）→ 补 3 个计分 run（VB003 ×3）
  另执行 3 个 warmup control invocation → **completed exit 0**
- **watcher 跨 aborted 存活**（C4 修复实战兑现：主批截停时心跳 1724 继续跳，completed 后 15s 内自动退出）
- V007 r2 未被 resume 重跑（其 runner status=success 是跳过判据，仅 oracle classification=error）
  → 走离线重判路径（188/F212 同先例）

### 批次终值（离线重判前）

`总计 pass 26/31  infra=0 error=0 oracle_error=2 oracle_missing=0  wall=6.72h+0.67h  PASSRATE=0.8387`

| task | F237 | F212 | Δ |
|------|------|------|---|
| V001/V003/V004/V005/V009 | 3/3 ×5 | 3/3 ×5 | — |
| V002 | 2/3（r3 gen_timeout 20min 打穿） | 3/3 | **−1** |
| V006 | 0/3（r1 oracle fail + r2/r3 gen_timeout） | 0/3 | —（坟场恒定） |
| V007 | 2/2 剔 1（r2 docker 镜像层 infra） | 3/3 | 待离线重判 |
| **V008** | **2/3（pass/pass/fail）** | **1/3（fail/fail/pass）** | **+1** 🎯 |
| V010 | 3/3 | 3/3 | —（终审更正：此前误从 F206 列取数写成 2/3→3/3） |
| VB003 | 2/2 剔 1（r3 同款镜像层 infra） | **2/3（timeout×1，F212 判噪声带）** | 待离线重判（重判后 3/3 = **+1**） |

两个 oracle_error 均为 docker 镜像层瞬时故障（`classifyReason: log 含镜像层失败标志`），
属判分基础设施抖动非能力失败——离线重判器（f237-rejudge-oracle-errors.mjs，F212 脚本适配版，
oracle 语义零改动）用既有 patch 重跑 docker 判分。

### 离线重判结果 + 终值（GATE-C PASS）

- V007 r2 → **pass**；VB003 r3 → **pass**（双双恢复，docker 抖动坐实为假故障）
- **终值：c3 = 28/33 = 84.8%，33/33 判分零剔除**（26 批内 + 2 重判并入）
- GATE-C：零剔除达成 + `f237-anomalies.json` 6 条异常全记录（2 重判 / 3 gen_timeout 能力终态 / 1 预算分段）
- 四方对照：GStack 30/33=90.9%（锚）｜ **F237 c3 28/33=84.8%** ｜ F212 c3 27/33=81.8% ｜ c1 裸 77.4%
- 净变化 F212→F237（终审更正后）：**V008 +1、VB003 +1、V002 −1、V010 0 = +1 run（81.8%→84.8%）**。
  VB003 +1（旧单发 timeout 消失）与 V002 −1（新单发 timeout）互为镜像噪声对消（F212 对 VB003 −1 的原判即「单发，噪声带」）——
  **结构性变化只有 V008 +1 一项**。距 GStack 差 2 run = V002 r3（timeout 噪声）+ V008 r3（no-op 边界）；V006 双方同为 0/3 坟场，非差距项。

### Phase D — V008 逐 run 取证（T021-T023 完成）

- `f237-v008-extract.json` 落盘；入库取证层 `evidence/v008-r{1,2,3}/`（fix-report/patch/audit/meta ×3）
  **12 文件零 .absent**——含两个 PASS run（watcher 副本抢救，C5 修复实战兑现）
- **审计事件揭示三 run 路径分岔**：
  - r1/r2（oracle pass）：completedPhases=`[diagnose,plan,implement,verify]` 四制品全套——真修复路径
  - r3（oracle fail）：completedPhases=`[diagnose,no-op-verify]` 仅 fix-report——**no-op 出口**，零阻断一次过 Stop hook
- **r3 机制归因（headline 结论素材）**：fix-report 显示 F216 证据门**完整履约**——
  两条 repro 对账（SPEC-DRIVER-REPRO 哨兵）真实 PASS + 委派 verify 独立核实 + no-op-verify 阶段完成。
  但方向判断仍错：模型断言「上游 c5fb611eed 已修复（as_set 从 return self 改为 raise NotImplementedError），
  无需改动」，其 repro 证明的是**症状消失**（不抛 AttributeError / 显式 NotImplementedError）；
  而 oracle FAIL_TO_PASS 测的是 **as_set 的功能实现**（返回正确集合语义）。
  → **真命题 ≠ 任务目标**：证据门验证 claim 可复现性，不做任务语义对齐——
  **这是 F216 spec 预注册的能力边界**（spec.md「证据门不判断 repro 是否语义对应 issue、不检查声明是否覆盖全部症状」），
  r3 属于**命中已声明边界**而非新失败形态（终审 C2 更正措辞）。对照 F212：其 V008 两个 no-op 均为「无证据自信断言」
  （fix-report 引 contains.py 称已修复、零 repro），F216 后该形态绝迹——F237 唯一 no-op（r3）带真实 repro（评测转录
  可见先 timeout 命令 FAIL 后改 signal.alarm 重试 PASS 的真实执行），no-op 频次亦 2/3→1/3。
  同 base 代码三次 run：r1/r2 判「需修」并真修（过），r3 判「已修好」（挂）——分歧纯在方向解读。

### GATE-B 首 run 早期门 — PASS（发射后 ~42min）

- mtime 守卫按设计工作：F212 旧 fixture（runTimestampUtc=2026-07-19）被连续判 `WAIT stale-fixture`，
  未发生误判通过（此前实证的陷阱被机械挡住）
- 新 fixture 落盘后：`[earlygate] PASS plugin-dir=<eval-wt>/plugins/spec-driver`
  → **P-6 前提此刻起有落盘证据**（f237-earlygate.log）：33-run 批确实跑在含 F216 证据门的仓内源判定器上
- 首 run 判分：V001 r1 = **pass**（warmup 的 sympy/astropy control-c3-r0 亦 pass，不计入 33）
- watcher 心跳 187 行，持续存活
