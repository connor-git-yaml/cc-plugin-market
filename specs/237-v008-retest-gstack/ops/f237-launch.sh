#!/usr/bin/env bash
# F237 V008 复测发射器 —— 对应 plan.md §3.1/§3.2/§3.3、tasks.md T008
#
# 部署位置：评测 worktree `.calibration-output/bin/f237-launch.sh`（由 T014 从
# `specs/237-v008-retest-gstack/ops/f237-launch.sh` 复制而来）；host shell 以
# `nohup ... & disown` 方式起跑（macOS 无 setsid，用 nohup+disown 组合脱离会话）。
#
# 关键修正（trace.md「修订落地 + 编排器复读残余」节）：plugin 原始状态探测不得依赖
# CLI 的插件列表子命令做单行 grep 匹配（该子命令实测无 --scope 选项、输出为多行块，
# 单行 grep 恒不匹配 → ORIG 状态恒判 disabled → 批后不恢复用户插件）。
# 改为直接 node 读取 `~/.claude/settings.json` 的 `enabledPlugins` 字段（与 runner 门禁
# `globalPluginEnabled` 同源，权威且可机械断言）。
#
# 不用 `set -e`：管道/子进程后需要显式判断 EXIT_CODE 才能落 aborted 状态，
# 沿用 F212 f212-launch-ab.sh 同款模式；trap 在非 -e 模式下才能可靠拦截中断。
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "[launch] FATAL: 无法定位评测 worktree 根目录" >&2; exit 1; }

STATUS_FILE=.calibration-output/f237-batch-status.json
LOG_FILE=.calibration-output/f237-headline.log
mkdir -p .calibration-output

# ── 状态机相关变量（set -u 下必须先声明默认值，trap 可能在任意步骤后触发）──────
GUARD_PID=""
CHILD_PID=""
ORIG_SD=""
ORIG_SP=""
RESTORED=0
RESTORE_ATTEMPTS=0

write_status() {
  # $1=status $2=exitCode(可空)
  local status="$1"
  local exit_code="${2:-}"
  if [ -n "$exit_code" ]; then
    printf '{"status":"%s","updatedAt":"%s","pid":%s,"exitCode":%s}\n' \
      "$status" "$(date -u +%FT%TZ)" "$$" "$exit_code" > "$STATUS_FILE"
  else
    printf '{"status":"%s","updatedAt":"%s","pid":%s}\n' \
      "$status" "$(date -u +%FT%TZ)" "$$" > "$STATUS_FILE"
  fi
}

log() {
  echo "[launch] $*" | tee -a "$LOG_FILE"
}

fatal() {
  log "FATAL: $*"
  write_status aborted 1
  exit 1
}

# ── 读取全局 plugin enabled 状态（node 直读 settings.json，容错：文件不存在/键缺省
#    视为 enabled——安装即默认启用，不能默认判 disabled 否则批后误恢复成禁用态）────
read_plugin_state() {
  node -e "
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    let sd = true;
    let sp = true;
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const enabledPlugins = (parsed && parsed.enabledPlugins) || {};
      const sdKey = 'spec-driver@cc-plugin-market';
      const spKey = 'spectra@cc-plugin-market';
      sd = Object.prototype.hasOwnProperty.call(enabledPlugins, sdKey) ? enabledPlugins[sdKey] : true;
      sp = Object.prototype.hasOwnProperty.call(enabledPlugins, spKey) ? enabledPlugins[spKey] : true;
    } catch (err) {
      // settings.json 不存在或解析失败：容错，缺省视为 enabled
    }
    console.log(JSON.stringify({ sd, sp }));
  "
}

plugin_field() {
  # $1=JSON字符串 $2=字段名(sd|sp)
  node -e "console.log(JSON.parse(process.argv[1])[process.argv[2]])" "$1" "$2"
}

restore_plugins() {
  [ "$RESTORED" = "1" ] && return 0
  RESTORE_ATTEMPTS=$((RESTORE_ATTEMPTS + 1))
  # 先 kill 守卫 sidecar 并 wait 其退出，再恢复 plugin
  # （防守卫在恢复后又抢跑一次 disable，顺序必须严格：kill → wait → enable）
  if [ -n "$GUARD_PID" ]; then
    kill "$GUARD_PID" 2>/dev/null || true
    wait "$GUARD_PID" 2>/dev/null || true
  fi
  # W-1：RESTORED 幂等位不在此处提前置位——enable 失败时必须让 EXIT trap 有机会
  # 二次重试，否则批后用户插件会永久卡在 disabled 态且无人知晓
  local ENABLE_FAILED=0
  if [ "$ORIG_SD" = "true" ]; then
    if ! claude plugin enable spec-driver@cc-plugin-market --scope user >/dev/null 2>&1; then
      ENABLE_FAILED=1
      log "[restore][WARN] enable spec-driver@cc-plugin-market 失败——批后需人工 claude plugin enable"
    fi
  fi
  if [ "$ORIG_SP" = "true" ]; then
    if ! claude plugin enable spectra@cc-plugin-market --scope user >/dev/null 2>&1; then
      ENABLE_FAILED=1
      log "[restore][WARN] enable spectra@cc-plugin-market 失败——批后需人工 claude plugin enable"
    fi
  fi
  # 只有两个 enable 尝试都成功（或本就不需要 enable）才置位 RESTORED；失败则保留
  # 未置位状态，等待 EXIT trap 二次调用重试。为防无限循环，重试达 2 次后强制放弃。
  if [ "$ENABLE_FAILED" = "0" ]; then
    RESTORED=1
    log "plugin 已按原始记录状态恢复（spec-driver origSd=${ORIG_SD:-unknown} spectra origSp=${ORIG_SP:-unknown}）"
  elif [ "$RESTORE_ATTEMPTS" -ge 2 ]; then
    RESTORED=1
    log "[restore][WARN] 已重试 ${RESTORE_ATTEMPTS} 次仍有 enable 失败，放弃重试——批后需人工核查 plugin 状态"
  else
    log "[restore][WARN] plugin 恢复未完全成功，等待下次 trap 触发重试（尝试次数=${RESTORE_ATTEMPTS}）"
  fi
}

on_interrupt() {
  log "INT/TERM 收到，终止子进程树..."
  [ -n "$CHILD_PID" ] && kill -TERM "$CHILD_PID" 2>/dev/null || true
  # detached runner 进程组补杀：pool 链每路 run 以 detached:true 独立进程组拉起
  # eval-task-runner.mjs（parallel-run-pool.mjs C-5），仅 kill 父 node 不会终止该进程组，
  # 导致中断后 runner 及其 claude/python/docker 子树继续孤儿跑批（C-1）。
  # pgrep pattern 带 `--fixture-suffix c3-r`（本 pool 链专属标记，见 uniqueSuffix=`${cohort}-r${repeatNo}`）
  # 限定只杀本链衍生的 runner，避免误杀无关进程；对每个 pid 先按进程组 TERM，
  # 宽限 10s 后 KILL 兜底（进程组前缀 `-` 语法失败时退化为单 pid kill）。
  RUNNER_PIDS=$(pgrep -f 'eval-task-runner\.mjs.*--fixture-suffix c3-r' 2>/dev/null || true)
  for p in $RUNNER_PIDS; do kill -TERM -- "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true; done
  sleep 10
  for p in $RUNNER_PIDS; do kill -KILL -- "-$p" 2>/dev/null || true; done
  restore_plugins
  write_status aborted 130
  exit 130
}

trap restore_plugins EXIT
trap on_interrupt INT TERM

write_status preflight

# ── 0. 环境净化（防御纵深，FR-003/FR-013）──────────────────────────────
unset FIX_COMPLIANCE_CLI
FCC_COUNT=$(env | grep -c FIX_COMPLIANCE_CLI || true)
log "FIX_COMPLIANCE_CLI count after unset: ${FCC_COUNT:-0}"
[ "${FCC_COUNT:-0}" = "0" ] || fatal "FIX_COMPLIANCE_CLI 仍存在 (count=${FCC_COUNT})"

# ── 1. Preflight：OAuth / docker / Surge 代理（整串精确匹配，F212 §7-1 教训）───
PROBE=$(echo "say only ok" | claude --print --model claude-haiku-4-5 --max-turns 1 --output-format text)
[ "$PROBE" = "ok" ] || fatal "OAuth probe != 'ok' (got: ${PROBE})"
log "OAuth probe OK"

docker info >/dev/null 2>&1 || fatal "docker 未就绪"
log "docker OK"

lsof -i :6152 -sTCP:LISTEN >/dev/null 2>&1 || fatal "Surge 代理未监听 (:6152)"
log "Surge 代理 OK"

# ── 2. dist 门禁 ─────────────────────────────────────────────────────
node scripts/build-spectra-stamped.mjs 2>&1 | tee -a "$LOG_FILE"
DIST_EXIT=${PIPESTATUS[0]}
[ "$DIST_EXIT" = "0" ] || fatal "dist 门禁失败 (exit=${DIST_EXIT})"
log "dist 门禁 OK"

# ── 3. 全局 plugin disable + trap 恢复 ───────────────────────────────
ORIG_STATE_JSON=$(read_plugin_state)
echo "$ORIG_STATE_JSON" > .calibration-output/f237-plugin-orig-state.json
ORIG_SD=$(plugin_field "$ORIG_STATE_JSON" sd)
ORIG_SP=$(plugin_field "$ORIG_STATE_JSON" sp)
log "plugin 原始状态（settings.json enabledPlugins 直读）：spec-driver=${ORIG_SD} spectra=${ORIG_SP}"

claude plugin disable spec-driver@cc-plugin-market --scope user
claude plugin disable spectra@cc-plugin-market --scope user

DISABLED_STATE_JSON=$(read_plugin_state)
echo "$DISABLED_STATE_JSON" > .calibration-output/f237-plugin-disabled-verify.json
DISABLED_SD=$(plugin_field "$DISABLED_STATE_JSON" sd)
DISABLED_SP=$(plugin_field "$DISABLED_STATE_JSON" sp)
log "plugin disable 后核验（settings.json 同款读取）：spec-driver=${DISABLED_SD} spectra=${DISABLED_SP}"
if [ "$DISABLED_SD" != "false" ] || [ "$DISABLED_SP" != "false" ]; then
  fatal "plugin disable 未生效 (spec-driver=${DISABLED_SD} spectra=${DISABLED_SP})，禁止起跑"
fi

# 守卫 sidecar：周期性重申 disable（防 Claude app 重启回写 enabledPlugins），独立脚本，
# 由本发射器以 nohup 拉起，收尾时先 kill+wait 再恢复 plugin（见 restore_plugins()）
nohup bash .calibration-output/bin/f237-plugin-guard.sh \
  </dev/null >> .calibration-output/f237-plugin-guard.log 2>&1 &
GUARD_PID=$!
log "plugin 守卫 sidecar 已起跑 GUARD_PID=${GUARD_PID}"

# 守卫存活确认（W-2）：短暂等待后探测进程是否真的存活，避免脚本路径/权限/语法错误
# 导致守卫瞬间退出却被误判为"已起跑"——若不核验，直到批后才会发现 disable 从未被
# 周期性重申过；必须在 write_status running（起跑判定，见 T015 完成判据）之前完成
sleep 2
kill -0 "$GUARD_PID" 2>/dev/null || fatal "守卫 sidecar 未存活（GUARD_PID=${GUARD_PID}），检查 f237-plugin-guard.sh 路径/权限/语法"
log "plugin 守卫 sidecar 存活确认 OK"

# ── 4. 起跑（--resume 幂等；子进程 PID 单独记录：用 process substitution 保留 tee
#        落盘，同时 $! 拿到 node 真实 PID，INT/TERM trap 才能精确 kill 该 PID）────
write_status running
RESUME_FLAG=""
[ -f .calibration-output/f237-headline.json ] && RESUME_FLAG="--resume"
log "起跑 eval-pool-rerun.mjs（RESUME_FLAG=${RESUME_FLAG:-<none>}）"

node scripts/eval-pool-rerun.mjs \
  --pool specs/212-eval-rerun-m8-closeout/pool-11.json \
  --cohort c3 --repeats 3 \
  --output .calibration-output/f237-headline.json \
  ${RESUME_FLAG} > >(tee -a "$LOG_FILE") 2>&1 &
CHILD_PID=$!
wait "$CHILD_PID"
EXIT_CODE=$?

if [ "$EXIT_CODE" = "0" ]; then
  log "跑批完成，exit=0"
  write_status completed 0
else
  log "跑批异常终止，exit=${EXIT_CODE}"
  write_status aborted "$EXIT_CODE"
fi
exit "$EXIT_CODE"
