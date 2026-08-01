#!/usr/bin/env bash
# F237 首 run 早期门（GATE-B 执行体）—— 对应 plan.md §4.2、tasks.md T013
#
# 用法：f237-first-run-gate.sh <发射时刻 epoch 秒 | f237-launch-timestamp.txt 文件路径>
#   （T015 起跑发射器完成后把发射完成时刻写入 .calibration-output/f237-launch-timestamp.txt；
#    调用方既可以直接传该文件内容(epoch 秒)，也可以传文件路径本身，本脚本自动识别两种形式）
#
# 首个 fixture 落盘后核验 claudeArgs（meta.args）里的 --plugin-dir 是否指向本轮评测 worktree，
# 且该 fixture 是本轮新产出（非 F212 旧同路径残留 —— 编排器实证：F212 旧 fixture 曾原地躺在
# 同路径，mtime 2026-07-19，不加 mtime 守卫会误读旧 fixture 当作本轮通过）。
#
# 止损范围说明（Codex CRITICAL C3 修正）：本门只在断言失败时上报，止损于 ≤2 run——
# 20s 轮询期间 pool 链是串行调度，r2 可能已经起跑，无法在不改冻结链的前提下做调度
# 屏障挡住它；真正的杀伤（终止已起跑的 r1/r2 及其进程组）由发射器 on_interrupt 的
# 进程组补杀负责（见 f237-launch.sh C-1 修复），本脚本只负责判定与上报。
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1

LOG_FILE=.calibration-output/f237-earlygate.log
FIXTURE=tests/baseline/tasks/SWE-V001-sympy-the-evaluate-false-parameter/spec-driver-spectra-mcp-c3-r1/full.json
# 40min warmup 预算（F212 实测 32min）+ 20min 首 run + 15min 余量 = 75min 上限
# （原 40min 上限 < 合法最坏 60min，warmup 尚未跑完首 fixture 就会被误判超时，Codex CRITICAL C2）
MAX_WAIT_SECONDS=4500
TIMEOUT_SECONDS=$MAX_WAIT_SECONDS
POLL_INTERVAL=20
EXPECTED_PLUGIN_DIR_FRAGMENT="/m8-closeout-212/plugins/spec-driver"

mkdir -p .calibration-output

log() {
  echo "$*" | tee -a "$LOG_FILE"
}

LAUNCH_EPOCH_ARG="${1:-}"
if [ -z "$LAUNCH_EPOCH_ARG" ]; then
  log "[earlygate] FAIL missing-launch-epoch-arg expected=<epoch秒或f237-launch-timestamp.txt路径> actual=<empty>"
  exit 1
fi

# 兼容两种入参形态：纯数字 epoch 秒 / 发射时刻文件路径（读取发射时刻文件内容）
if [[ "$LAUNCH_EPOCH_ARG" =~ ^[0-9]+$ ]]; then
  LAUNCH_EPOCH="$LAUNCH_EPOCH_ARG"
elif [ -f "$LAUNCH_EPOCH_ARG" ]; then
  LAUNCH_EPOCH=$(cat "$LAUNCH_EPOCH_ARG" | tr -d '[:space:]')
else
  log "[earlygate] FAIL invalid-launch-epoch-arg expected=<epoch秒或存在的文件路径> actual=${LAUNCH_EPOCH_ARG}"
  exit 1
fi

if ! [[ "$LAUNCH_EPOCH" =~ ^[0-9]+$ ]]; then
  log "[earlygate] FAIL unparsable-launch-epoch expected=<纯数字 epoch 秒> actual=${LAUNCH_EPOCH}"
  exit 1
fi

START_TS=$(date +%s)

while true; do
  if [ ! -f "$FIXTURE" ]; then
    # fixture 尚未产出：非错误，继续轮询而非误判失败（显式分支，区别于其他失败态）
    :
  else
    # mtime 守卫：读取 fixture 的 meta.runTimestampUtc，必须晚于发射时刻，
    # 否则可能是 F212 旧 fixture 原地残留，继续轮询等待本轮真正的新 fixture 覆盖
    RUN_TS_ISO=$(node -e "
      try {
        const fs = require('fs');
        const d = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
        console.log((d.meta && d.meta.runTimestampUtc) ? d.meta.runTimestampUtc : '');
      } catch (e) { console.log(''); }
    " "$FIXTURE")

    if [ -n "$RUN_TS_ISO" ]; then
      RUN_TS_EPOCH=$(node -e "
        const t = Date.parse(process.argv[1]);
        console.log(Number.isFinite(t) ? Math.floor(t / 1000) : 0);
      " "$RUN_TS_ISO" 2>/dev/null || echo 0)

      if [ "${RUN_TS_EPOCH:-0}" -gt "$LAUNCH_EPOCH" ] 2>/dev/null; then
        # fixture 已就绪且是本轮新产出：核验 meta.args 里的 --plugin-dir。
        # 注意：c3（spec-driver-spectra-mcp）会传入两个 --plugin-dir（spectra 本地 build 一个、
        # spec-driver 本地 build 一个），必须扫描全部出现位置而非只取第一个（indexOf 只拿首个
        # 会误判——首个通常是 spectra 的 --plugin-dir，值里不含 plugins/spec-driver 片段）
        PLUGIN_DIR_VALUES=$(node -e "
          try {
            const fs = require('fs');
            const d = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
            const args = (d.meta && d.meta.args) || [];
            const values = [];
            for (let i = 0; i < args.length; i++) {
              if (args[i] === '--plugin-dir' && args[i + 1]) values.push(args[i + 1]);
            }
            console.log(values.join('\n'));
          } catch (e) { console.log(''); }
        " "$FIXTURE")

        MATCHED_VALUE=""
        if [ -n "$PLUGIN_DIR_VALUES" ]; then
          while IFS= read -r CANDIDATE; do
            if [[ "$CANDIDATE" == *"$EXPECTED_PLUGIN_DIR_FRAGMENT"* ]]; then
              MATCHED_VALUE="$CANDIDATE"
              break
            fi
          done <<< "$PLUGIN_DIR_VALUES"
        fi

        if [ -n "$MATCHED_VALUE" ]; then
          log "[earlygate] PASS plugin-dir=${MATCHED_VALUE}"
          exit 0
        else
          log "[earlygate] FAIL plugin-dir-mismatch expected=*${EXPECTED_PLUGIN_DIR_FRAGMENT}* actual=${PLUGIN_DIR_VALUES:-<absent>}"
          log "[earlygate] NOTE 串行调度下 r2 可能已起跑，编排器 kill 发射器时将由进程组补杀一并终止"
          exit 1
        fi
      else
        log "[earlygate] WAIT stale-fixture runTimestampUtc=${RUN_TS_ISO} launchEpoch=${LAUNCH_EPOCH}"
      fi
    fi
  fi

  NOW=$(date +%s)
  if [ $((NOW - START_TS)) -ge "$TIMEOUT_SECONDS" ]; then
    log "[earlygate] TIMEOUT waited=${TIMEOUT_SECONDS}s fixture=${FIXTURE}"
    exit 2
  fi
  sleep "$POLL_INTERVAL"
done
