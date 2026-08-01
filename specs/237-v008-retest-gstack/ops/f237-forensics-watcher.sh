#!/usr/bin/env bash
# F237 取证 watcher sidecar —— 对应 plan.md §3.4、tasks.md T010
#
# 背景：pool 链 --cleanup on-success 会在 oracle 判分完成后删除 PASS run 的 bench worktree，
# 本 watcher 与发射器同时独立起跑（先于发射器起跑并确认存活，见 tasks.md T014），15s 节拍
# rsync 全 11 task × r1-r3 的 bench worktree 文本核心到 f237-live-forensics/，弥补该窗口。
#
# 11 个 task ID 取自 specs/212-eval-rerun-m8-closeout/pool-11.json（硬编码展开，不运行时解析
# JSON —— 保持零依赖，且 zsh/bash 下对未引号变量分词/空 glob 报错的坑已在 F212 存档脚本踩过，
# 内联列表可规避）。
#
# 退出条件三选一（aborted 不在其中——中断/resume 期间 watcher 持续覆盖运行，不随发射器中断退出）：
#   (1) $STATUS_FILE 的 status 为 completed；
#   (2) 收到 TERM（编排器 Phase D 取证归档完成后由 f237-archive.sh v008 显式 kill）；
#   (3) 9h 墙钟兜底。
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1

STATUS_FILE=.calibration-output/f237-batch-status.json
DEST_ROOT=.calibration-output/f237-live-forensics
HEARTBEAT_FILE=.calibration-output/f237-watcher-heartbeat.log
DEADLINE=$(( $(date +%s) + 9*3600 ))   # 9h 墙钟兜底

mkdir -p "$DEST_ROOT"

# 收到 TERM 时设置标志位，循环体检测到后优雅退出（而非 trap 内直接 exit 打断正在进行的 rsync）
TERMINATED=0
on_term() {
  TERMINATED=1
}
trap on_term TERM

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

# 11 个 pool task（硬编码，来自 pool-11.json taskIds，顺序一致）
TASKS=(
  "SWE-V001-sympy-the-evaluate-false-parameter"
  "SWE-V002-sympy-rational-calc-value-error"
  "SWE-V003-sympy-polyelement-as-expr-not"
  "SWE-V004-sympy-check-homomorphism-is-broken"
  "SWE-V005-sympy-collect-factor-and-dimension"
  "SWE-V006-pytest-consider-mro-when-obtaining"
  "SWE-V007-sympy-si-collect-factor-and"
  "SWE-V008-sympy-contains-as-set-returns"
  "SWE-V009-sympy-physics-hep-kahane-simplify"
  "SWE-V010-pytest-unittest-testcase-teardown-exe"
  "SWE-VB003-astropy-in-v5-nddataref-mask"
)
REPEATS=(r1 r2 r3)

sync_one_round() {
  local TASK R SRC DST
  for TASK in "${TASKS[@]}"; do
    for R in "${REPEATS[@]}"; do
      SRC="$HOME/.spec-driver-bench-worktrees/${TASK}/spec-driver-spectra-mcp/${R}"
      [ -d "$SRC" ] || continue
      DST="${DEST_ROOT}/${TASK}/${R}"
      mkdir -p "$DST"
      # 只抽文本核心（specs/ 与 .specify/ 下的 *.md *.jsonl *.log *.json *.yaml），排除
      # specs/_meta/graph.json（单份实测 ~30M 纯 scaffolding，不是取证需要的内容）以及
      # .git/ node_modules/ __pycache__/ *.pyc（rsync 首匹配定胜负，exclude 必须排在
      # include='*.json' 等泛匹配之前，否则 graph.json 会被 *.json 抢先命中纳入——
      # Codex WARNING W3 已实测该图 73 万行，顺序错误会拖垮 rsync 与磁盘占用）
      rsync -a --prune-empty-dirs \
        --exclude='.git/' --exclude='node_modules/' --exclude='__pycache__/' --exclude='*.pyc' \
        --exclude='specs/_meta/graph.json' \
        --include='*/' \
        --include='*.md' --include='*.jsonl' --include='*.log' --include='*.json' --include='*.yaml' \
        --exclude='*' \
        "${SRC}/specs" "${SRC}/.specify" "${DST}/" 2>/dev/null || true
      # task-runner 日志（若存在于 worktree 根，非 specs/.specify 树下）
      if compgen -G "${SRC}/task-runner-*.log" > /dev/null 2>&1; then
        cp "${SRC}"/task-runner-*.log "${DST}/" 2>/dev/null || true
      fi
    done
  done
}

while true; do
  STATUS=$(read_status)
  sync_one_round

  # 每轮循环写一行心跳时间戳，供 T014 起跑后机械确认 watcher 存活
  date -u +%FT%TZ >> "$HEARTBEAT_FILE"

  if [ "$STATUS" = "completed" ]; then
    echo "[watcher] status=completed，退出"
    break
  fi
  if [ "$TERMINATED" = "1" ]; then
    echo "[watcher] 收到 TERM，退出"
    break
  fi
  NOW=$(date +%s)
  if [ "$NOW" -ge "$DEADLINE" ]; then
    echo "[watcher] 墙钟 9h 兜底触发，退出"
    break
  fi
  sleep 15
done
