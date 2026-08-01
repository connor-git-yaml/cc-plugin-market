---
feature: v008-retest-gstack
feature_number: 237
status: Draft
input: "F237 V008 修复复测：F216 证据门后全池重跑，验证'超 GStack'"
---

# 任务分解 — F237 V008 修复复测（F216 证据门后全池重跑）

本任务清单严格映射 `plan.md` 的 Phase A-F（发射准备 / 发射器 / 监控 / V008 取证 / 聚合报告 / verify+交付），不引入 plan 之外的新设计决策。所有"评测执行"类任务在**评测 worktree**（`m8-closeout-212` → `237-eval-rerun`）或 **host shell** 执行，脚本源码在**编排 worktree** `specs/237-v008-retest-gstack/ops/` 编写（入库可审计），发射前复制到评测 worktree `.calibration-output/bin/` 运行（对 plan §3.1 的落地细化：源码入库 + 安装态复制两层）。

执行者标签：`[orchestrator]` 编排器亲自（git 操作/发射/监控决策/GATE/风险处置）；`[subagent:implement]` 脚本编写类；`[subagent:verify]` 核对类。

本版为 Codex 对抗审查后的修订版（8 CRITICAL + 7 WARNING 全部处置），修订落点见文末对照说明与各任务内嵌标注。

---

## Phase A — 发射准备（对应 plan §2，评测 worktree 内执行，零凭据消耗）

### T001 `[orchestrator]` F212 现场存档
- **依赖**：无
- **对应 plan**：§2.1
- **动作**：在评测 worktree 内建立 `.calibration-output/f212-archive/`，打包 `tests/baseline/tasks/`（1a）、`tests/baseline/swe-bench-verified/tasks/`（1b）、`run_artifacts/`（2）、bench-worktrees 文本核心（3，rsync -aR 白名单模式）。
- **完成判据**：`.calibration-output/f212-archive/` 下存在 4 类产物（`pool-tasks-*.tar.gz` / `ab-tasks-*.tar.gz` / `run_artifacts-*.tar.gz` / `bench-worktrees-core-*/`）或对应 `[archive][warn]` 日志行（允许部分失败但不允许静默无输出）；执行 `du -sh` 汇总行已打印。

### T002 `[orchestrator]` 切换评测 worktree 基线
- **依赖**：T001
- **对应 plan**：§2.2
- **动作**：`git checkout -B 237-eval-rerun <H>`（H = 编排分支进入 Phase B 发射准备时的 HEAD，取值规则见 plan §2.2，不预先写死 hash）。
- **完成判据**：`git status` 输出干净（无 untracked/modified）；`git rev-parse HEAD` 等于取值时刻的编排分支 HEAD。
- **回退**：若 checkout 后发现 H 取值错误（如误取了未包含 Codex 修复的中间提交），`git checkout -B 237-eval-rerun <正确H>` 重做，不带着错误基线继续。

### T003 `[orchestrator]` 重建本地 spectra dist
- **依赖**：T002
- **对应 plan**：§2.3
- **动作**：`node scripts/build-spectra-stamped.mjs`
- **完成判据**：命令 exit 0；输出 dist 戳与 `<H>` 一致（`v4.4.0 (<H短hash>)` 或对应值）。

### T004 `[orchestrator]` Re-freeze prereg gitCommit 锚
- **依赖**：T003
- **对应 plan**：§2.4
- **分类说明**（Codex WARNING W2 处置）：re-freeze 是评测 worktree 的运行态锚点操作（同类于 plugin disable / checkout 基线），非入库交付制品，归编排器 ops 范围，由编排器亲自执行、不下放子代理——此为编排器显式分类决定。
- **动作**：先记录当前 HEAD/分支到 `.calibration-output/f237-refreeze-backup.txt`；编辑 `specs/176-swe-bench-verified-cross-cohort/verification/preregistration.md` frontmatter 的 `gitCommit` 字段为 `<H>`；`git commit --no-verify` 提交（**仅限本 anchor commit 豁免 pre-commit**，理由见 plan §2.4 决策说明，永不合流回主线）。
- **完成判据**：
  1. `git log -1 --format=%s` 含 "re-freeze prereg gitCommit 锚 → <H>"；
  2. `git -C <eval-wt> show HEAD:specs/176-swe-bench-verified-cross-cohort/verification/preregistration.md | grep "^gitCommit:"` 输出精确等于 `<H>`；
  3. `git -C <eval-wt> diff HEAD~1 HEAD --stat` 仅显示 `preregistration.md` 一个文件、±1 行级改动；
  4. 操作前已生成 `.calibration-output/f237-refreeze-backup.txt`（记录原 HEAD/branch）。
- **回退**：`git -C <eval-wt> checkout 212-eval-rerun-m8-closeout && git branch -D 237-eval-rerun`（回原分支删新分支，prereg 随分支自然还原），并断言 prereg `gitCommit` 回到 `9fb3f89`。

### T005 `[orchestrator]` 独立三 hash 预核验
- **依赖**：T004
- **对应 plan**：§2.5
- **动作**：执行 §2.5 给出的 `node -e` 脚本（`set -o pipefail` + `tee .calibration-output/f237-prereg-precheck.log`），断言 `ok:true`。
- **完成判据**：`.calibration-output/f237-prereg-precheck.log` 存在且 JSON 含 `"ok": true`；shell `$?` 为 0。
- **回退（风险任务，硬性）**：若 `ok:false`，**立即停止，不进入 T006/T007**；用 `git diff <历史冻结点> HEAD -- scripts/eval-*.mjs scripts/lib/*.mjs` 定位漂移文件，上报用户具体漂移点；**禁止**为让检查通过而修改 hash 值或跳过校验（对应 plan §8 风险表第一行）。

### T006 `[orchestrator]` P-8/P-9 二次核验（不依赖历史结论）（Codex CRITICAL C3 已修订）
- **依赖**：T005
- **对应 plan**：§2.6
- **动作**：
  1. `unset FIX_COMPLIANCE_CLI` → `env | grep -c FIX_COMPLIANCE_CLI | tee .calibration-output/f237-env-verify.log`（期望 0）；
  2. 记录发射前插件原始状态（不依赖不存在的 `claude plugin list --scope user`，改用 node 直读 `settings.json`，供 T015 发射器 disable 后核对/供中断恢复用）：
     ```bash
     node -e "const s=require(process.env.HOME+'/.claude/settings.json');const e=s.enabledPlugins||{};const sd=e['spec-driver@cc-plugin-market'];const sp=e['spectra@cc-plugin-market'];console.log(JSON.stringify({sd,sp}));" | tee .calibration-output/f237-plugin-orig-state.json
     ```
     本任务仅记录原始状态（此刻两插件预期为启用态，非 disabled），**不**在此断言 false——真正的"已 disable"断言移至 T015 完成判据（发射器 disable 后用同款单行 node 断言 `sd===false && sp===false`）。
- **完成判据**：`.calibration-output/f237-env-verify.log` 内容为 `0`；`.calibration-output/f237-plugin-orig-state.json` 存在且为合法 JSON。

### T007 `[orchestrator]` Dry-run 冒烟
- **依赖**：T006
- **对应 plan**：§2.7
- **动作**：`node scripts/eval-pool-rerun.mjs --pool specs/212-eval-rerun-m8-closeout/pool-11.json --cohort c3 --repeats 3 --dry-run`
- **完成判据**：输出恰好 11×3=33 条 `[pool-rerun][dry-run]` 行 + `PASSRATE=DRY_RUN`。

### GATE-A `[orchestrator]` Phase A 完成门
- **依赖**：T005（ok:true）+ T006（`f237-env-verify.log`=0 且 `f237-plugin-orig-state.json` 存在）+ T007（33 行）
- **完成判据**：三项全部满足才允许进入 Phase B（对应 plan §2.7 "Phase A 完成 gate"，四项齐全原文含 2.5/2.6/2.7，T005-T007 已覆盖）。

---

## Phase B — 发射器（对应 plan §3，host shell，nohup + disown 后台起跑）

### T008 `[subagent:implement]` 编写 `f237-launch.sh` 源码
- **依赖**：无（可提前编写，仅 T014/T015 起跑本身依赖 GATE-A，见 DAG 说明；Codex WARNING W7 已核对该依赖标注与 DAG 一致）
- **对应 plan**：§3.1/§3.2/§3.3
- **产出位置**：`specs/237-v008-retest-gstack/ops/f237-launch.sh`
- **动作**：按 plan §3.2 骨架落地完整脚本，含：环境净化（`unset FIX_COMPLIANCE_CLI` + 计数断言）、preflight（OAuth 探针整串精确匹配 `[ "$PROBE" = "ok" ]`、docker、Surge 代理）、dist 门禁、全局 plugin disable + trap 恢复、`--resume` 幂等起跑、`$STATUS_FILE` 状态机（preflight/running/completed/aborted）。
- **关键修正（必须包含，来自 trace.md「修订落地 + 编排器复读残余」节）**：plugin 原始状态探测**不得**使用 `claude plugin list --scope user | grep '<name>.*enabled'` 单行匹配（实测该命令无 `--scope` 选项且输出为多行块，恒不匹配，会导致 ORIG 状态恒判 disabled、批后不恢复用户插件）；**必须改为直接 `node` 读取 `~/.claude/settings.json` 的 `enabledPlugins["spec-driver@cc-plugin-market"]` / `enabledPlugins["spectra@cc-plugin-market"]` 字段**（与 runner 门禁 `globalPluginEnabled` 同源，权威且可机械断言）。
- **完成判据（Codex WARNING W3 已补全脚本验收细节）**：
  1. `bash -n specs/237-v008-retest-gstack/ops/f237-launch.sh` 语法检查通过；
  2. 脚本内可 grep 到 `enabledPlugins` 字符串（证明已采用 settings.json 读取而非 `claude plugin list` grep）；
  3. `grep -c "claude plugin list" specs/237-v008-retest-gstack/ops/f237-launch.sh` 结果为 0（确认旧失真写法未残留于状态探测逻辑，允许其他用途如预检信息性输出，但状态判定分支不得依赖它）；
  4. `grep -q 'set -uo pipefail' specs/237-v008-retest-gstack/ops/f237-launch.sh` 为真 且 `grep -q 'set -euo' specs/237-v008-retest-gstack/ops/f237-launch.sh` 为假（trap 需在非 `-e` 模式下才能可靠拦截中断，不得用 `-e`）；
  5. `grep -q 'CHILD_PID=' specs/237-v008-retest-gstack/ops/f237-launch.sh` 且 `grep -q 'kill -TERM "$CHILD_PID"' specs/237-v008-retest-gstack/ops/f237-launch.sh`（子进程句柄 + TERM 转发存在）；
  6. INT/TERM trap 分支写入 `aborted` 状态的逻辑可 grep 定位（如 `grep -q 'aborted' specs/237-v008-retest-gstack/ops/f237-launch.sh`，且出现在 trap 处理函数体内，非仅注释）。

### T009 `[subagent:implement]` 编写 `f237-plugin-guard.sh`（守卫 sidecar，独立脚本）
- **依赖**：无（可与 T008 并行）
- **对应 plan**：§3.2 步骤 3（原为 launch.sh 内嵌 45s 重申 disable 的后台子 shell；trace.md 记录 F212 实物为独立脚本 `f212-plugin-guard.sh` + 状态机 + deadline，implement 按实物模式融合——此处细化为独立文件，便于单独 kill/wait 且与 launch.sh 解耦测试）
- **产出位置**：`specs/237-v008-retest-gstack/ops/f237-plugin-guard.sh`
- **动作**：周期性（45s）重申 `claude plugin disable spec-driver@cc-plugin-market --scope user` / `spectra@cc-plugin-market`；读取 `$STATUS_FILE` 终态或墙钟兜底（沿用 forensics-watcher 同款 9h 兜底模式）后自行退出；由 `f237-launch.sh` 以 `nohup ... & GUARD_PID=$!` 方式拉起并在 `restore_plugins()` 中 `kill "$GUARD_PID"` + `wait`。
- **完成判据（Codex WARNING W3 已补全脚本验收细节）**：
  1. `bash -n` 语法检查通过；
  2. 脚本含读 `$STATUS_FILE` 的终止条件与墙钟兜底两条退出路径；
  3. `f237-launch.sh` 中对应 `GUARD_PID` 拉起与 kill/wait 顺序（先 kill 守卫再恢复 plugin，防守卫在恢复后又抢跑一次 disable）可在源码中定位；
  4. kill+wait 守卫先于 `plugin enable` 命令的顺序断言：`grep -n 'kill "$GUARD_PID"'` 与 `grep -n 'wait "$GUARD_PID"'` 得到的行号均小于 `grep -n 'plugin enable'` 的行号（用 `grep -A` 上下文核对二者出现在 `restore_plugins()` 同一函数体内且顺序正确）。

### T010 `[subagent:implement]` 编写 `f237-forensics-watcher.sh`（Codex CRITICAL C4 已修订）
- **依赖**：无（可并行）
- **对应 plan**：§3.4
- **产出位置**：`specs/237-v008-retest-gstack/ops/f237-forensics-watcher.sh`
- **动作**：15s 节拍 rsync 全 11 task × r1-r3 的 bench worktree 文本核心到 `.calibration-output/f237-live-forensics/`（`--exclude='.git/' --exclude='node_modules/' --exclude='__pycache__/' --exclude='*.pyc'`）；每轮循环追加写一行时间戳到心跳文件 `.calibration-output/f237-watcher-heartbeat.log`（供 T014 起跑后机械确认存活）；**终止条件统一为三选一**：(1) `$STATUS_FILE` 为 `completed`；(2) 编排器显式 `kill`（Phase D 取证归档完成后由 T023 执行）；(3) 9h 墙钟兜底。**`aborted` 不再是 watcher 退出条件**——中断/resume 期间 watcher 持续覆盖运行，不随发射器中断而退出。
- **完成判据（Codex WARNING W3 已补全脚本验收细节）**：
  1. `bash -n` 通过；
  2. 脚本含 `DEADLINE=$(( $(date +%s) + 9*3600 ))` 等价墙钟兜底逻辑；
  3. rsync 命令行含上述四项 `--exclude`；
  4. `grep -q 'sleep 15' specs/237-v008-retest-gstack/ops/f237-forensics-watcher.sh` 为真；
  5. 退出条件三选一（`completed` / 显式 kill 信号处理 / 9h deadline）均可在源码中定位，且**不含**以 `aborted` 作为退出触发条件的分支；
  6. 心跳行写入逻辑可 grep 定位（每轮循环体内含追加写 `.calibration-output/f237-watcher-heartbeat.log` 的语句）。

### T011 `[subagent:implement]` 编写三 hash 预核验脚本文件化版本
- **依赖**：无（可并行；T005 已用内联 `node -e` 跑过一次，本任务是把它固化为可复用文件供 §2.5 记录留档与未来复跑）
- **对应 plan**：§2.5
- **产出位置**：`specs/237-v008-retest-gstack/ops/f237-prereg-precheck.mjs`
- **动作**：将 plan §2.5 的内联 `node -e` 脚本体固化为独立 `.mjs` 文件（逻辑不变：`checkPreregistration` 调用 + `set -o pipefail` 等价的显式 exit code 处理），供 T005 与后续任何复核调用。
- **完成判据**：`node --check specs/237-v008-retest-gstack/ops/f237-prereg-precheck.mjs` 语法检查通过；脚本 `process.exit(2)` 分支在 `check.ok === false` 时可定位。

### T012 `[subagent:implement]` 编写存档脚本（覆盖 §2.1 + §5.4 两处归档逻辑）
- **依赖**：无（可并行）
- **对应 plan**：§2.1、§5.4
- **产出位置**：`specs/237-v008-retest-gstack/ops/f237-archive.sh`
- **动作**：支持两种调用模式：`f237-archive.sh pre`（对应 §2.1 F212 现场存档）与 `f237-archive.sh v008`（对应 §5.4 V008 归档：入库精简版 copy 到编排 worktree 绝对路径 `evidence/` + 本地全量 tar 备份），均含逐路径存在性守卫（`[ -e "$P" ] && ... || echo "[archive][warn] $P 不存在，跳过"`，不因单路径缺失让整条归档失败）。**`v008` 模式额外负责 Phase D 结束时 kill 取证 watcher**（读取 `.calibration-output/f237-watcher.pid` 并 `kill` + 确认退出，见 T010 定义的三选一退出条件之一）。
- **完成判据**：`bash -n` 通过；两种模式均可在脚本内定位对应分支；对不存在路径的守卫逻辑（`[ -e ... ] || echo warn`）可 grep 到；`v008` 分支含 kill watcher pid 的逻辑可定位。

### T013 `[subagent:implement]` 编写首 run 早期门监控检查脚本（Codex WARNING W4 已修订接口）
- **依赖**：无（可并行）
- **对应 plan**：§4.2
- **产出位置**：`specs/237-v008-retest-gstack/ops/f237-first-run-gate.sh`
- **动作**：读取首个 fixture（`tests/baseline/tasks/<第一个 task>/spec-driver-spectra-mcp-c3-r1/full.json`）的 `meta.args`（`claudeArgs`）字段，断言 `--plugin-dir` 参数值含评测 worktree 绝对路径下的 `plugins/spec-driver`；**新增 mtime 守卫**：读取 `.calibration-output/f237-launch-timestamp.txt`（T015 起跑完成时写入的发射时刻），断言 fixture 的 `meta.runTimestampUtc` 晚于该发射时刻——否则可能误读同路径下的 F212 旧 fixture（编排器实证：F212 旧 fixture 曾原地躺在同路径，mtime 2026-07-19）当作本轮通过；脚本产物固定写入日志 `.calibration-output/f237-earlygate.log`，成功输出稳定行 `[earlygate] PASS plugin-dir=<path>`，失败输出 `[earlygate] FAIL ...` 且 `exit 1`；断言失败时打印期望值与实际值 diff（供编排器据此决定是否 `kill -TERM` 发射进程，止损设计，kill 动作本身由编排器在 T016 执行，本脚本只负责判定与上报，不代为 kill）。
- **完成判据**：
  1. `bash -n` 通过（或若用 node 实现则 `node --check` 通过）；
  2. 脚本对 fixture 不存在时的处理（尚未产出，非错误，应可重试而非误判失败）有显式分支；
  3. 成功/失败两种稳定输出行（`[earlygate] PASS ...` / `[earlygate] FAIL ...`）与固定日志路径 `.calibration-output/f237-earlygate.log` 可在源码中定位；
  4. mtime 守卫逻辑（读取发射时刻文件并与 `meta.runTimestampUtc` 比较）可在源码中定位。

### T014 `[orchestrator]` 复制脚本到评测 worktree 并起跑取证 watcher（Codex CRITICAL C1 已重排）
- **依赖**：GATE-A + T008 + T009 + T010 + T011 + T012 + T013
- **对应 plan**：§3.1/§3.4
- **修订说明**：Codex 指出原版本先起跑发射器、后起跑 watcher，会导致首 run 现场在 watcher 就绪前已产生且无法追溯；现改为 watcher 先于发射器起跑并机械确认存活，发射器（T015）才起跑。
- **动作**：`mkdir -p .calibration-output/bin`（评测 worktree 内）；复制 `ops/f237-launch.sh`、`ops/f237-plugin-guard.sh`、`ops/f237-forensics-watcher.sh`、`ops/f237-first-run-gate.sh` 到 `.calibration-output/bin/`；复制 `ops/f237-prereg-precheck.mjs`、`ops/f237-archive.sh` 到评测 worktree 对应可执行位置；`chmod +x` 全部 `.sh`；host shell 执行 `nohup .calibration-output/bin/f237-forensics-watcher.sh </dev/null >> .calibration-output/f237-forensics-watcher.log 2>&1 & disown`，将 PID 写入 `.calibration-output/f237-watcher.pid`。
- **完成判据**：
  1. `kill -0 $(cat .calibration-output/f237-watcher.pid)` 成功；
  2. watcher 心跳文件 `.calibration-output/f237-watcher-heartbeat.log` 在 30s 内新增至少 1 行（T010 已要求 watcher 每轮循环写一行时间戳）；
  3. 发射方 shell 退出后（`disown` 已生效）`kill -0` 仍成功（父退出存活断言）。
- **回退**：若 watcher 未存活或心跳未增长，检查脚本路径/权限/语法错误后重新起跑，不得进入 T015。

### T015 `[orchestrator]` 起跑发射器（Codex CRITICAL C1+C2 已重排）
- **依赖**：T014（watcher 已确认存活）
- **对应 plan**：§3.1/§3.3
- **动作**：host shell 执行 `nohup .calibration-output/bin/f237-launch.sh </dev/null >> .calibration-output/f237-launch.log 2>&1 & disown`；记录发射完成时刻到 `.calibration-output/f237-launch-timestamp.txt`（供 T013/T016 mtime 守卫使用）。
- **完成判据**：
  1. `f237-batch-status.json` 的 `status` 在 **5 分钟内**进入 `running`（`preflight` 只是中间态，超时未达 `running` 或 launcher 进程死亡 → 判定失败，走回退，不得视为完成——Codex C2 指出的原漏洞已收口）；
  2. `kill -0 <launcher PID>` 成功；
  3. 发射方 shell 退出后 `kill -0` 仍成功（父退出存活断言）；
  4. 发射器完成 plugin disable 后，用与 T006 同款单行 node 断言核验（结果写入 `.calibration-output/f237-plugin-disabled-verify.json`）：`sd===false && sp===false`。
- **回退（风险任务）**：若 5 分钟内未进入 `running`，或 launcher 进程已死亡，或 preflight 内部断言失败（OAuth/docker/代理/dist 门禁任一项），`f237-launch.log` 尾部应含 `[launch] FATAL: ...`；按对应故障源修复后重新执行本任务（脚本自身具备 `--resume` 幂等，无需清理已产出的 fixture）。

---

## Phase C — 监控（对应 plan §4，编排器长时任务）

### T016 `[orchestrator]` 首 run 早期门核验（风险任务，止损设计；对应 GATE-B 执行体）
- **依赖**：T014 + T015
- **对应 plan**：§4.2
- **动作**：首个 fixture（`tests/baseline/tasks/<第一个 task>/spec-driver-spectra-mcp-c3-r1/full.json`）落盘后，立即（不等常规 15-30min 轮询周期，本任务需比常规节奏更紧）执行 T013 产出的 `f237-first-run-gate.sh`，读取 `.calibration-output/f237-earlygate.log` 判定结果（含 mtime 守卫）；断言通过则放行，转入 GATE-B → T017 常规监控。
- **完成判据**：`f237-earlygate.log` 尾行为 `[earlygate] PASS plugin-dir=<path>` 且脚本 exit 0；mtime 守卫通过（fixture `meta.runTimestampUtc` 晚于 `f237-launch-timestamp.txt` 记录的发射时刻）。
- **回退（硬性，风险任务）**：断言失败 → 立即 `kill -TERM <发射 PID>`（触发 `f237-launch.sh` 的 `on_interrupt` trap：终止子进程 + 按原始记录状态恢复全局 plugin）+ 确认 `f237-batch-status.json` 落 `aborted` + 向用户上报具体 `claudeArgs` 取值与预期值的 diff。33 run 只烧掉 1 run 即止损。取证 watcher（T014）不受此中断影响，持续运行。

### GATE-B `[orchestrator]` 首 run 早期门（Codex WARNING W7 正式命名）
- **依赖**：T016（通过）
- **完成判据**：T016 完成判据全部满足后方可放行进入 T017 常规监控；此 gate 与 GATE-A/GATE-C 采用一致命名规范。

### T017 `[orchestrator]` 常规轮询监控（跑批本体，长时任务 5-8h）
- **依赖**：GATE-B
- **对应 plan**：§4.1/§4.3
- **动作**：每 15-30 分钟（跑批前段）/ 每次用户交互间隙（后段）执行 `cat f237-batch-status.json`、`tail -n 40 f237-headline.log`、`tail -n 20 f237-forensics-watcher.log`；任何面向用户的 pass/fail 播报 MUST 读 `.calibration-output/f237-headline.json` 的 `stats`/`perTask` 字段，**禁止**用 stdout 里的 `success` 字样直接计数（FR-009，runner success ≠ oracle pass）。
- **完成判据**：`f237-batch-status.json` 的 `status` 最终转为 `completed`（或 `aborted` 触发 T018/T019 处置）；每次面向用户的进度播报都能溯源到 `f237-headline.json` 的具体字段读取记录（而非日志 grep `success`）。

### T018 `[orchestrator]` fail-closed 触发处置（风险任务，条件触发）
- **依赖**：T017（条件：日志出现 `[pool-rerun] ❌ 连续 N 个 task 全剔除` exit 2）
- **对应 plan**：§4.4
- **动作**：停止，不立即 `--resume`；先判断故障类型（OAuth 401 / 代理挂 / docker 僵死 / dist 门禁报错）；修复对应故障源；确认取证 watcher 仍存活（`kill -0 $(cat .calibration-output/f237-watcher.pid)`；watcher 设计上跨 abort 存活，无需重启——若已死如超 9h deadline 则先重跑 T014 起跑 watcher）；重新执行 T015 的起跑命令（脚本内部自动检测 `f237-headline.json` 存在并带 `--resume`）。
- **完成判据**：故障类型已在报告/trace 中记录一句诊断结论；重跑后 `f237-batch-status.json` 重新进入 `running`。
- **回退**：若修复后仍连续 fail-closed，暂停并上报用户，不无限重试消耗预算。

### T019 `[orchestrator]` OAuth 中途过期处置（风险任务，条件触发）
- **依赖**：T017（条件：怀疑 OAuth 将过期或已观测到连续 `infra` 分类）
- **对应 plan**：§4.5
- **动作**：`kill -INT <发射 PID>`（触发 `on_interrupt` trap：先 `kill -TERM` 子进程、再按原始记录状态恢复全局 plugin、`exit 130`）；交互式 `claude /login`；确认取证 watcher（T014）存活（同 T018 判据，跨中断持续运行，不受影响）；重新执行 T015 起跑命令（自动 `--resume`）。
- **完成判据**：`claude /login` 后 haiku 探针再次输出 `ok`；重跑后 `f237-batch-status.json` 重新进入 `running`；`f237-forensics-watcher.log` 期间无中断（时间戳连续性核对）。

### T020 `[orchestrator]` 配额检查点播报
- **依赖**：T017（≥30 runs 后每 6 runs 触发一次）
- **对应 plan**：§4.3、spec FR-011
- **动作**：日志出现 `💰 已新跑 N runs — 人工检查 Claude Max 配额面板` 提醒行时，转发为对用户的进度播报（advisory 人工模式，无 dashboard API，非自动硬门）；记录提醒出现次数与时间戳，供 Phase E 报告 §9 成本与配额小节使用。
- **完成判据**：每次提醒行出现都对应一条转发给用户的播报记录（时间戳可追溯）；若用户主动反馈配额紧张，暂停跑批并协商是否继续或分日跑，该协商结果落 trace.md。

### GATE-C `[orchestrator]` Phase C 完成门（Codex CRITICAL C5 已修订）
- **依赖**：T017（`status=completed`）
- **完成判据**：`f237-batch-status.json.status === "completed"` 且 `f237-headline.json` 的 `stats.n_total === 33` 且零剔除（`infra`/`error`/`oracle_error`/`oracle_missing` 计数均为 0）**或** 当场生成结构化异常清单 `.calibration-output/f237-anomalies.json`（逐 run 记录 `task`/`repeat`/`status`/`oracle 分类`/`reason`，每条 `reason` 字段非空）——gate 判据为「33/33 零剔除」或「异常清单文件存在且逐条含 `reason`」二选一满足即放行；Phase E 报告（T025）引用该清单而非在报告撰写阶段现场重查（对应 SC-001）。

---

## Phase D — V008 取证（对应 plan §5，跑批完成后立即执行，先于任何后续可能复用 runId 的操作）

### T021 `[orchestrator]` 三层现场逐 run 定位（Codex CRITICAL C6 已修订字段选择器与产物接口）
- **依赖**：GATE-C
- **对应 plan**：§5.1/§5.2
- **动作**：对 `task=SWE-V008-sympy-contains-as-set-returns`、`repeat∈{r1,r2,r3}`，定位 L1（`tests/baseline/tasks/SWE-V008-sympy-contains-as-set-returns/spec-driver-spectra-mcp-c3-r{N}/full.json`）、L2（`run_artifacts/` 下实名目录，取证时先 `ls run_artifacts/ | grep V008` 现场确认命名，不硬编码猜测）、L3（优先 `~/.spec-driver-bench-worktrees/.../r{N}/`，已 cleanup 则退化读 `.calibration-output/f237-live-forensics/.../r{N}/`）三层现场。从 L1 抽取的权威字段为 `taskExecution.primaryOracle.classification` / `taskExecution.primaryOracle.failureSource` / `taskExecution.primaryOracle.details.classifyReason`（Codex 已实测确认该嵌套路径，**不存在**顶层 `reason` 字段，原版本字段选择器有误已修正）；L2 抽取 `patch.diff`/`stdout.log`/`stderr.log`；L3 抽取 `fix-report.md` 全文 + `.specify/runs/*.jsonl` 审计事件（审计事件源先 `ls .../.specify/runs/` 确认实际文件名，不假设固定月份）。将抽取结果落为固定接口产物 `.calibration-output/f237-v008-extract.json`，schema：`{ runs: [{ repeat, fixturePath, classification, failureSource, classifyReason, fixReportSource: "live-worktree|watcher-copy|stdout-reconstruct|absent", fixReportPath, auditJsonlPath, patchPath, evidenceGate: {...} }] }`。
- **完成判据**：
  1. `.calibration-output/f237-v008-extract.json` 存在且可解析，含恰好 3 条 run 记录（r1/r2/r3）；
  2. 每条记录的 L1 字段（`fixturePath`/`classification`/`failureSource`/`classifyReason`）必须非 `absent`——L1 fixture 是 runner 必写产物，缺失即取证失败，任务不得判完成；
  3. fix-report/审计 JSONL 允许 `absent`，但必须标注 `fixReportSource` 降级来源；
  4. 3 个 run 中若存在 oracle PASS 的 run，其 `fixReportSource` **不得**三源（`live-worktree`/`watcher-copy`/`stdout-reconstruct`）全为 `absent`——至少给出 `watcher-copy` 或 `stdout-reconstruct` 之一（watcher 就是为此而生）。

### T022 `[subagent:implement]` 撰写逐 run 取证表（Codex CRITICAL C6 已修订产物依赖；WARNING W1 已改执行者）
- **依赖**：T021
- **对应 plan**：§5.3
- **动作**：基于 T021 产出的 `.calibration-output/f237-v008-extract.json` 汇总 markdown 表，字段：`run id | closureForm | 证据门触发状态 | missing keys | 最终判定 | oracle pass/fail | fix-report 摘录（≤200字）| patch diff 摘要`。**无论三行结果如何都必须完整呈现**（FR-002 硬约束）。L1 字段（`classification`/`failureSource`/`classifyReason`）不允许标 `absent`（T021 已保证非 absent）；fix-report/audit 摘录字段允许显式 `absent` 并须标注来源（`fixReportSource`）。
- **完成判据**：表格恰好 3 行，每行 8 个字段全部非空（`absent` 仅对 fix-report/audit 类字段合法，且须附来源标注；L1 字段一律为实际取值）；对照 trace.md 记录的 F212 V008 基线（r1 fail / r2 fail / r3 pass-已清理）核对本轮是否复现同结构或已改变。

### T023 `[orchestrator]` V008 归档（入库精简版 + 本地全量备份）（Codex CRITICAL C4 已补充 watcher 退出路径）
- **依赖**：T022
- **对应 plan**：§5.4
- **动作**：执行 T012 产出的 `f237-archive.sh v008`：入库部分写入编排 worktree 绝对路径 `specs/237-v008-retest-gstack/evidence/v008-r{1,2,3}/{fix-report.md, patch.diff, audit-events.jsonl, meta.json}`（逐路径存在性守卫，缺失记 `.absent` 后缀文件）；本地全量备份 tar 到评测 worktree `.calibration-output/f237-archive/v008-full-<STAMP>.tar.gz`；归档完成后，脚本内的 kill-watcher 分支显式 `kill $(cat .calibration-output/f237-watcher.pid)`（T010 定义的 watcher 三种退出路径之一：取证归档完成后编排器显式 kill）。
- **完成判据**：`specs/237-v008-retest-gstack/evidence/` 下存在 v008-r1/r2/r3 三个子目录，各自 4 个文件（或 `.absent` 占位）齐全；本地 tar 文件存在；`kill -0 $(cat .calibration-output/f237-watcher.pid)` 返回非零（watcher 已确认退出）。
- **回退/风险说明**：本任务必须在任何后续可能复用 runId 的操作之前完成（Edge Cases 硬约束：runId 跨链撞名会覆盖取证）；若发现取证时现场已被覆盖（如 watcher 进程死亡且 bench worktree 已 cleanup 且 live-forensics 也无副本），按 plan §8 风险表"取证 watcher 进程死亡"行处置：从 `run_artifacts/stdout.log` 转录重建并诚实标注"现场文件缺失，从会话转录重建"。

---

## Phase E — 聚合与报告（对应 plan §6，Codex WARNING W1 已将撰写类任务执行者改为 `[subagent:implement]`，编排器提供数据包与模板并审定）

### T024 `[subagent:implement]` 撰写 `PUBLISH-REPORT-M9-interim.md` 骨架
- **依赖**：T023
- **对应 plan**：§6.2
- **动作**：按 plan §6.2 给出的 9 节结构（Headline / 四方终表 / V008 取证表 / C1 红线声明 / 诚实结论 / Dogfooding / Falsification 附录 / Followup 候补 / 成本与配额）建立文档骨架，交叉链接 `../212-eval-rerun-m8-closeout/PUBLISH-REPORT-M8.md`、`../216-fix-noop-evidence-gate/{spec.md,verification/verification-report.md}`。
- **完成判据**：文件存在且 9 节标题齐全（`## 1.` ~ `## 9.`）；顶部含交叉链接行。

### T025 `[subagent:implement]` 填充 Headline + 四方终表
- **依赖**：T024
- **对应 plan**：§6.1、spec FR-004
- **动作**：从 `f237-headline.json` 的 `stats`（含 bootstrap 95% CI）读取本轮 c3 新数；若 GATE-C 阶段生成了 `.calibration-output/f237-anomalies.json`，本节直接引用该清单而非现场重查；历史对照数字直接引用 `PUBLISH-REPORT-M8.md` §5（GStack 90.9% / F212 c3 81.8% / F206 c3 81.8% / c1 77.4% / c4 66.7%），**不重新计算**。
- **完成判据**：报告 §1/§2 含具体数字（非占位符）；`n_total=33` 且 `infra/error/oracle_error/oracle_missing` 计数明确可读（对应 SC-001）。

### T026 `[subagent:implement]` 填充 V008 取证表 + C1 红线声明
- **依赖**：T024、T022
- **对应 plan**：§6.2 报告结构 §3/§4
- **完成判据**：报告 §3 含 T022 产出的完整 3 行取证表；§4 显式声明"本轮结果仅与 F206/F212 全池 sonnet 链横比，不与 133/A-B opus 链做绝对率横比"。

### T027 `[subagent:implement]` 撰写诚实结论（对称模板，5a/5b 必须都存在）
- **依赖**：T025、T026
- **对应 plan**：§6.2 报告结构 §5、spec FR-006/SC-006
- **动作**：无论 V008 实际结果为 0/3、1/3、2/3、3/3，均撰写 §5a（若未完全转化的归因路径：证据门是否触发/是否命中已知能力边界 EC-003/007/008/009/010/若未触发的新失败形态）与 §5b（若完全转化的交叉核验：是否任务波动或 driver 差异导致的巧合/是否有 audit event 因果证据链）两个子结构，**不得仅在其中一种结局下才有内容**。
- **完成判据**：§5a 与 §5b 均非空且各自逐点作答（对应 SC-006 的"结论段落模板对称设计"验证方式）。

### T028 `[subagent:implement]` 撰写 Dogfooding 反馈 + Falsification 附录 + Followup 候补 + 成本与配额
- **依赖**：T027
- **对应 plan**：§6.2 报告结构 §6/§7/§8/§9、spec FR-012
- **动作**：§6 按四维度（MCP 可用性/信息完整性/流程顺畅度/结果准确性）如实填写，无问题显式写"无"；§7 如实记录本轮运维实录（沿 F212 §7 格式）；§9 记录 SiliconFlow 实付（预期 ≈$0）+ Claude Max advisory 配额播报时间线（引用 T020 记录）+ 若有中断则记录 `--resume` 续跑次数与额外耗时。
- **完成判据**：4 节均非空；§9 含可追溯的成本数字来源（对应 SC-008）。

---

## Phase F — verify + 交付（对应 plan §7）

### T029 `[subagent:verify]` 逐条核对 SC-001..SC-009
- **依赖**：T028
- **对应 plan**：§7.1
- **动作**：逐条核对 spec.md Success Criteria 九项；重点核查 SC-006（对称结论模板是否真的对称呈现）与 SC-007（`git status --porcelain` 仅显示预期显式路径改动）。
- **完成判据**：产出九项逐条通过/不通过的核对记录（可附于 trace.md 或独立 verify 记录）；任一不通过项需回退至对应 Phase 任务修复后重验，不得带着"不通过"结论进入 T031。

### T030 `[orchestrator]` Codex 对抗审查 — implement phase（跑批本体）（Codex WARNING W5 已收紧处置语义）
- **依赖**：GATE-C（跑批完成）
- **对应 plan**：§7.2、用户 CLAUDE.local.md 硬性约定
- **动作**：启动 `codex:codex-rescue` 子代理，对本轮跑批的关键产物（发射器脚本执行记录、首 run 早期门核验结果、V008 取证过程）做对抗性审查；critical/warning 修复后重新验证再继续。
- **完成判据**：审查记录写入 trace.md（对应 SC-004）；critical/warning 项逐条只允许两种处置——**修复后重验**，或**降级为 info/风格项且附证据反驳**；**不允许**原级别直接标"不修"。

### T031 `[orchestrator]` Codex 对抗审查 — verify phase
- **依赖**：T029、T030
- **对应 plan**：§7.2
- **动作**：启动 `codex:codex-rescue` 子代理，专项审查 `PUBLISH-REPORT-M9-interim.md` 是否存在 over-claim / confirmation bias（尤其 §5 诚实结论段落）。
- **完成判据**：审查记录写入 trace.md；critical/warning 项按 T030 同款处置原则（修复后重验 / 降级为 info 且附证据反驳）处置完毕。

### T032 `[orchestrator]` `git status` 核对 + 显式路径提交（Codex CRITICAL C7 已补全清单）
- **依赖**：T031
- **对应 plan**：§7.3、spec FR-010/SC-007
- **动作**：`git status --porcelain` 核对仅显示预期路径改动；显式 `git add specs/237-v008-retest-gstack/{plan.md,tasks.md,PUBLISH-REPORT-M9-interim.md,evidence/,trace.md,ops/}`，**禁止** `git add -A`；显式排除 `tests/baseline/tasks/**`、`tests/baseline/repeats/**`、`.calibration-output/**`、任何跑批过程中被自动再生的 `specs/src.spec.md`（若出现需单独 `git checkout` 还原）。
- **完成判据**：`git status --porcelain` 输出与预期路径清单一致（对应 SC-007）；`git diff --cached --stat` 不含任何非预期路径；确认 `ops/` 目录（脚本源码）已在暂存区内（Codex 指出原清单遗漏该目录，已补全）。

### T033a `[orchestrator]` 交付前验证链（硬前置）（Codex CRITICAL C8 新增任务）
- **依赖**：T032
- **对应**：仓库级分支同步与交付约定（CLAUDE.md）
- **动作**：`git fetch origin master:master`；若本地分支落后 origin master 则 `git rebase master`；随后依序执行 `npx vitest run`（零失败）→ `npm run build`（零错误）→ `npm run repo:check`（无 error）。
- **完成判据**：四步（fetch/rebase 判断、vitest、build、repo:check）均成功、exit code 0；若 rebase 产生冲突，须先解决冲突并重跑三项验证再继续，不得带冲突或红色结果进入 T033/T034。
- **回退**：任一环节失败，回退到对应 Phase 任务修复，不得跳过直接进入交付报告或 push。

### T033 `[orchestrator]` Push 前交付报告（等待用户确认）（Codex CRITICAL C8 已补充硬前置依赖）
- **依赖**：T032、T033a
- **对应 plan**：§7.3、用户 CLAUDE.local.md 硬性约定
- **动作**：在对话中列出：commit hash + 一句话 summary、改动统计（new/modified 文件数 + 行数）、Codex 审查结论（T030/T031 各 critical/warning 处置情况）、验证结果（T033a 的 vitest/build/repo:check 结果）、rebase 状态、下一步建议；等待用户明确"确认 push"。
- **完成判据**：报告已在对话中完整出现且未在无确认情况下执行 push（对应 SC-005）。
- **回退**：用户回复"等等"/提出疑问 → 暂停，回应或修订，不得视为确认。

### T034 `[orchestrator]` Push origin master（用户确认后）+ 分支清理（Codex CRITICAL C8 已补充硬前置依赖）
- **依赖**：T033a、T033（用户已明确确认）
- **对应**：仓库级分支同步与交付约定
- **动作**：`git fetch origin master:master` → 确认 behind==0 或已 rebase → `git push origin HEAD:master`（或 fast-forward 合流方式，按仓库既有约定）；成功后删除本地/远端 feature 分支。
- **完成判据**：`git push` 成功；`git branch -d`/`git push origin --delete` 完成分支清理。
- **回退**：若 push 前发现 origin 已前移，重新 `git rebase master` 并重跑 T033a + T029-T032 验证后再 push，不 force push master。

---

## FR 覆盖映射表

| FR | 覆盖任务 |
|---|---|
| FR-001（33 run 判分零剔除口径） | T015, T016, T017, GATE-C, T025 |
| FR-002（V008 逐 run 完整取证） | T021, T022, T023 |
| FR-003（三 hash + 环境核验记录） | T005, T006, T011 |
| FR-004（四方终表更新 + C1 红线） | T025, T026 |
| FR-005（PUBLISH-REPORT-M9-interim.md 交叉链接） | T024 |
| FR-006（诚实结论段落） | T027 |
| FR-007（每 phase Codex 审查 + push 前交付报告） | T030, T031, T033（spec/plan/tasks 三 phase 的审查发生在本任务清单执行之前，由编排器在各 phase commit 前完成，已见 trace.md） |
| FR-008（冻结窗口 + 运维手段） | T002, T004, T006, T009, T016（首 run 早期门止损）, GATE-B |
| FR-009（禁用 runner success 代替 oracle 播报） | T017 |
| FR-010（产物不入库 + 显式路径提交） | T032 |
| FR-011（成本约束 + 配额检查点） | T020, T028 |
| FR-012（Dogfooding 四维度反馈） | T028 |
| FR-013（`FIX_COMPLIANCE_CLI` 硬阻塞核验） | T006, T008（发射器显式 unset） |

---

## 依赖 DAG（文本表，Codex CRITICAL C1/C8 修订后重绘）

```
T001 → T002 → T003 → T004 → T005 → T006 → T007 → GATE-A
                                                    │
T008 ─┐                                            │
T009 ─┤                                            │
T010 ─┤（T008-T013 可与 Phase A 并行编写，          │
T011 ─┤ 无需等 GATE-A；仅 T014 起跑本身依赖 GATE-A） │
T012 ─┤                                            │
T013 ─┘                                            │
                                                    ▼
                                        T014（起跑取证 watcher，先起跑并确认存活）
                                          │
                                          ▼
                                        T015（起跑发射器，依赖 watcher 已存活）
                                          │
                                          ▼
                                        T016（首 run 早期门核验，风险任务）
                                          │
                                          ▼
                                        GATE-B（首 run 早期门放行）
                                          │ 通过
                                          ▼
                                        T017（常规监控，长时 5-8h）
                                          │
                              ┌───────────┼───────────┐
                              ▼           ▼           ▼
                            T018        T019        T020
                          (条件触发)  (条件触发)   (周期触发)
                              └───────────┼───────────┘
                                          ▼
                                       GATE-C
                                          │
                                          ▼
                                        T021 → T022 → T023
                                                          │
                                                          ▼
                                                        T024 → T025 → T026 → T027 → T028
                                                                                        │
                                                                                        ▼
                                                                                      T029
                                                                                        │
                                                          GATE-C ──────────────────→ T030
                                                                                        │
                                                                              T029+T030 → T031
                                                                                        │
                                                                                        ▼
                                                                                T032 → T033a → T033 → T034
```

**关键路径估时**（沿用 plan §1 时序预算 + trace.md F212 实测 wallMs=25.97M≈7.21h（不含 warmup 0.53h）作为跑批锚点；Codex WARNING W6 已修订总估时区间）：

| 段落 | 任务 | 估时 |
|---|---|---|
| Phase A | T001-T007, GATE-A | ~30min |
| Phase B | T008-T013（并行编写）→ T014（watcher 起跑确认）→ T015（发射器起跑确认，5min 内进入 running） | ~15-30min（编写可与 Phase A 重叠，不计入串行关键路径；起跑本身 ~5-10min） |
| Phase C | T016（首 run 早期门，~15-25min 等待落盘）→ GATE-B → T017（跑批本体） | ~7.75h+（主导关键路径，参照 F212 实测 7.21h 不含 warmup） |
| Phase D | T021-T023 | ~30-60min |
| Phase E | T024-T028 | ~1h |
| Phase F | T029-T033a-T033-T034（含用户确认等待，不计入编排器主动耗时） | ~30-60min（不含用户响应延迟，T033a 验证链本身 ~5-15min） |

**关键路径总估时**：约 **8–11.5 小时**（主导项为 Phase C 跑批本体 ≈7.75h+；Phase A/B/D/E/F 编排器主动耗时合计约 2.5-3.75h，可部分与跑批监控间隙重叠但 T024-T028 严格依赖 GATE-C 之后的 T021-T023，不可提前）；resume/人工 gate 延迟（T018/T019/用户确认等待）另计，不计入本估时区间。

---

## 上报编排器（发现的 plan 内部细节缺口，非设计矛盾）

- plan §4.1"每隔 15-30 分钟"轮询节奏与 §4.2 首 run 早期门要求"首个 fixture 落盘后立即读取"之间存在隐含的节奏差异：若严格套用 §4.1 默认节奏，首 run 早期门的核验可能延迟最多 30 分钟才被执行，与"止损于 1 run"的设计意图（尽早发现 `--plugin-dir` 错误、少烧预算）存在张力。**这不是 plan 内部矛盾**（§4.2 本身未规定核验节奏，只规定核验时机为"首个 fixture 落盘后"），已在 T016 完成判据中显式要求"不等常规 15-30min 轮询周期，本任务需比常规节奏更紧"，作为对该空白细节的执行层补充，未改动 plan 设计本身。
- 其余各 Phase 之间未发现设计层面的矛盾或冲突；plan §10 已给出的"修订后关键 FR/SC 落点更新"均已在对应任务的"对应 plan"字段中体现，无需进一步上报。

---

## Codex 对抗审查修订落点对照表

| 编号 | 问题摘要 | 修订落点 |
|---|---|---|
| C1 | T014/T015 依赖方向反了 | T014（watcher 先起跑）、T015（发射器后起跑）、T016 依赖改为 T014+T015、DAG 重绘 |
| C2 | preflight 态可被误判完成 | T015 完成判据（5 分钟内必须达 running） |
| C3 | P-8 核验命令不存在 | T006（node 直读 settings.json） |
| C4 | watcher 生命周期 vs abort/resume 矛盾 | T010（三选一退出条件，去掉 aborted）、T018/T019（watcher 无需重启说明）、T023（显式 kill watcher） |
| C5 | GATE-C 前向证据依赖 | GATE-C（当场生成 f237-anomalies.json）、T025（引用清单） |
| C6 | T021 字段选择器错误 + absent 兜底过宽 | T021（字段路径修正 + extract.json 接口 + 最低取证线）、T022（absent 语义收紧） |
| C7 | T032 git add 清单漏 ops/ | T032（补 ops/） |
| C8 | T034 跳过交付验证链 | 新增 T033a、T033/T034 依赖更新 |
| W1 | 委派合同：编排器承担撰写类任务 | T022、T024-T028 执行者改为 `[subagent:implement]`；T004 分类说明 |
| W2 | T004 完成判据与回退不全 | T004（三条完成判据 + 回退字段） |
| W3 | 脚本任务验收未对照 plan 修复清单 | T008/T009/T010 完成判据补全 |
| W4 | T013/T016/T021 接口未固化 | T013（稳定输出行+日志路径+mtime守卫）、T016（引用固定接口） |
| W5 | T030 豁免语义过宽 | T030/T031（只允许"修复后重验"或"降级为 info 附证据反驳"） |
| W6 | 估时偏乐观 | 估时表 + 关键路径总估时改为 8–11.5h |
| W7 | GATE 命名与依赖标注不一致 | T016 后新增 GATE-B 正式命名；T008 依赖改为"无" |
