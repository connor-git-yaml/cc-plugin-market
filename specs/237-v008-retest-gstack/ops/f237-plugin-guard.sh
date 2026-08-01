#!/usr/bin/env bash
# F237 全局 plugin disable 守卫 sidecar —— 对应 plan.md §3.2 步骤 3、tasks.md T009
#
# 独立脚本（非 f237-launch.sh 内嵌子 shell）：周期性重申 disable spec-driver / spectra
# 两个全局 plugin，防 Claude app 周期性重启回写 enabledPlugins；由 f237-launch.sh 以
# `nohup bash f237-plugin-guard.sh & GUARD_PID=$!` 方式拉起，收尾时由 f237-launch.sh 的
# restore_plugins() `kill "$GUARD_PID"` + `wait "$GUARD_PID"`（先于 plugin enable）终止。
#
# 退出路径二选一：
#   (1) $STATUS_FILE 的 status 进入终态（completed/aborted）——批次已结束，无需再守卫；
#   (2) 9h 墙钟兜底（沿用 f237-forensics-watcher.sh 同款模式，防状态文件异常导致永不退出）。
# 除此之外（preflight/running/未知态）持续重申 disable。
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1

STATUS_FILE=.calibration-output/f237-batch-status.json
DEADLINE=$(( $(date +%s) + 9*3600 ))   # 9h 墙钟兜底
INTERVAL=45

read_status() {
  node -e "
    try {
      const fs = require('fs');
      const s = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
      console.log(s.status || 'unknown');
    } catch (e) {
      console.log('unknown');
    }
  " "$STATUS_FILE" 2>/dev/null
}

disable_both() {
  claude plugin disable spec-driver@cc-plugin-market --scope user >/dev/null 2>&1 || true
  claude plugin disable spectra@cc-plugin-market --scope user >/dev/null 2>&1 || true
}

while true; do
  STATUS=$(read_status)
  case "$STATUS" in
    completed|aborted)
      echo "[guard] 终态 ${STATUS}，退出"
      exit 0
      ;;
    preflight|running)
      disable_both
      ;;
    *)
      # 状态文件不可读/未知态：宁可多重申一次 disable，不可漏（防御纵深）
      disable_both
      ;;
  esac

  NOW=$(date +%s)
  if [ "$NOW" -ge "$DEADLINE" ]; then
    echo "[guard] 墙钟 9h 兜底触发，退出"
    exit 0
  fi
  sleep "$INTERVAL"
done
