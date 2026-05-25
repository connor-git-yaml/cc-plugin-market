#!/usr/bin/env bash
# Feature 169 — Cohort C lift 复现验证（6 fixture × {A, C} × N=3 = 36 runs）
# 验证 §10.5.1.9 L003/L005 的 100% C-pass 信号在更多 fixture 上是否复现
#
# 必须在主仓 root 执行（worktree 缺 dist/ + .env.local）
# 跑前置：cd /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/ && source .env.local
#
# 三道 stop-loss：
#   (1) 全局累计 SiliconFlow 实付 > $20 → 立即停 + 落 partial
#   (2) 总 wall > 4.5h (270 min) → 立即停 + 落 partial
#   (3) 任一 C batch 全 N=3 graph-not-built/SIGTERM → 跳过剩余 fixture 的 C cohort（系统性故障 cascaded skip）

set -uo pipefail

# ───────────────────────────────────────────────
# 配置（环境变量可覆盖）
# ───────────────────────────────────────────────
LOG_DIR="${SPECTRA_F169_LOG_DIR:-/tmp/spectra-f169}"
STOP_LOSS_USD="${SPECTRA_F169_STOP_LOSS_USD:-20}"
STOP_LOSS_WALL_MIN="${SPECTRA_F169_STOP_LOSS_WALL_MIN:-270}"
QUOTA_CHECK_EVERY="${SPECTRA_F169_QUOTA_CHECK_EVERY:-6}"
PER_BATCH_STOP_LOSS="${SPECTRA_F169_PER_BATCH_STOP_LOSS:-10}"  # eval --stop-loss 下沿

# 6 fixture × 2 cohort × N=3
FIXTURES=(
  "SWE-L004-sympy-bug-with-milli-prefix"
  "SWE-L006-astropy-please-support-header-rows"
  "SWE-L007-sympy-collect-factor-and-dimension"
  "SWE-L008-sympy-bug-in-expand-of"
  "SWE-L009-sympy-cannot-parse-greek-characters"
  "SWE-L010-sympy-si-collect-factor-and"
)
COHORTS=("A" "C")
REPEAT=3
TOTAL_BATCHES=$(( ${#FIXTURES[@]} * ${#COHORTS[@]} ))   # 12
EXPECTED_RUNS=$(( TOTAL_BATCHES * REPEAT ))             # 36

# 通过环境变量传递 cwd 校验
EXPECTED_CWD="${SPECTRA_F169_EXPECTED_CWD:-/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market}"

# ───────────────────────────────────────────────
# 启动前置检查
# ───────────────────────────────────────────────
echo "[f169] cwd=$(pwd)"
if [[ "$(pwd)" != "$EXPECTED_CWD" ]]; then
  echo "[f169] ❌ FATAL: cwd 必须是 ${EXPECTED_CWD}（worktree 缺 dist/.env.local 不能跑实际 batch）"
  echo "[f169] 当前 cwd: $(pwd)"
  exit 1
fi

if [[ ! -f dist/cli/index.js ]]; then
  echo "[f169] ❌ FATAL: dist/cli/index.js 不存在，先跑 npm run build"
  exit 1
fi

if [[ -z "${SILICONFLOW_API_KEY:-}" ]]; then
  echo "[f169] ❌ FATAL: SILICONFLOW_API_KEY 未 set（先 source .env.local）"
  exit 1
fi

for fx in "${FIXTURES[@]}"; do
  fp="tests/baseline/swe-bench-lite/fixtures/${fx}.json"
  if [[ ! -f "$fp" ]]; then
    echo "[f169] ❌ FATAL: fixture missing $fp"
    exit 1
  fi
done

if ! command -v jq >/dev/null 2>&1; then
  echo "[f169] ❌ FATAL: jq 未安装（macOS: brew install jq）"
  exit 1
fi

mkdir -p "$LOG_DIR"
echo "[f169] log_dir=$LOG_DIR"
echo "[f169] config: fixtures=${#FIXTURES[@]} cohorts=${COHORTS[*]} repeat=$REPEAT expected_runs=$EXPECTED_RUNS"
echo "[f169] stop-loss: cost=\$$STOP_LOSS_USD wall=${STOP_LOSS_WALL_MIN}min per-batch=\$$PER_BATCH_STOP_LOSS quota-check-every=$QUOTA_CHECK_EVERY"

# ───────────────────────────────────────────────
# Manifest
# ───────────────────────────────────────────────
START_TS=$(date +%s)
START_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat > "$LOG_DIR/manifest.json" <<EOF
{
  "feature": "F169",
  "start_iso": "$START_ISO",
  "start_ts": $START_TS,
  "expected_runs": $EXPECTED_RUNS,
  "fixtures": $(printf '%s\n' "${FIXTURES[@]}" | jq -R . | jq -s .),
  "cohorts": $(printf '%s\n' "${COHORTS[@]}" | jq -R . | jq -s .),
  "repeat": $REPEAT,
  "stop_loss": {
    "cost_usd": $STOP_LOSS_USD,
    "wall_min": $STOP_LOSS_WALL_MIN,
    "per_batch_usd": $PER_BATCH_STOP_LOSS
  }
}
EOF
echo "[f169] manifest → $LOG_DIR/manifest.json"

# ───────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────

# 累计指定 cohort/fixture 的 costUsd（读 tests/baseline/swe-bench-lite/runs/<G>/<F>/run-*.json）
batch_cost_sum() {
  local cohort="$1"
  local fixture="$2"
  local rundir="tests/baseline/swe-bench-lite/runs/${cohort}/${fixture}"
  if [[ ! -d "$rundir" ]]; then
    echo "0"
    return
  fi
  jq -s '[.[].costUsd // 0] | add // 0' "$rundir"/run-*.json 2>/dev/null || echo "0"
}

# 判断 C batch 是否系统性 grounding fail（全 N=3 graph-not-built / SIGTERM / claudeTimedOut）
c_batch_systemic_fail() {
  local fixture="$1"
  local rundir="tests/baseline/swe-bench-lite/runs/C/${fixture}"
  if [[ ! -d "$rundir" ]]; then
    echo "false"
    return
  fi
  # 全 N=3 runs 都满足：graphInjection.errorCode 存在 (非 success) OR claudeTimedOut=true
  jq -s '
    if length < 3 then false
    else
      ([.[] |
        (
          (.graphInjection.errorCode != null and .graphInjection.errorCode != "") or
          (.claudeTimedOut == true)
        )
      ] | all)
    end
  ' "$rundir"/run-*.json 2>/dev/null || echo "false"
}

# 配额提示（每 N runs 输出一次）
quota_check_log() {
  local runs_done="$1"
  echo "[f169][quota] $runs_done / $EXPECTED_RUNS runs done — ChatGPT Pro Max 20x usage check (manual): https://chat.openai.com/usage"
}

# ───────────────────────────────────────────────
# 主循环
# ───────────────────────────────────────────────
BATCH_IDX=0
TOTAL_RUNS_DONE=0
TOTAL_COST=0
SKIP_REMAINING_C=false
STOP_LOSS_TRIGGERED=""

for fixture in "${FIXTURES[@]}"; do
  for cohort in "${COHORTS[@]}"; do
    BATCH_IDX=$((BATCH_IDX + 1))

    # stop-loss 3 cascaded skip
    if [[ "$cohort" == "C" && "$SKIP_REMAINING_C" == "true" ]]; then
      echo ""
      echo "[f169] [$BATCH_IDX/$TOTAL_BATCHES] SKIP $fixture cohort C (systemic grounding fail detected earlier)"
      continue
    fi

    BATCH_LOG="$LOG_DIR/${fixture}-${cohort}.log"
    echo ""
    echo "[f169] [$BATCH_IDX/$TOTAL_BATCHES] group=$cohort task=$fixture repeat=$REPEAT → $BATCH_LOG"
    BATCH_START=$(date +%s)

    set +e
    node scripts/eval-mcp-augmented.mjs \
      --group "$cohort" \
      --task "$fixture" \
      --repeat "$REPEAT" \
      --stop-loss "$PER_BATCH_STOP_LOSS" \
      > "$BATCH_LOG" 2>&1
    batch_exit=$?
    set -e

    BATCH_WALL=$(( $(date +%s) - BATCH_START ))
    tail -5 "$BATCH_LOG" 2>/dev/null | sed 's/^/[f169][batch-tail] /'

    if [[ $batch_exit -ne 0 ]]; then
      echo "[f169] ⚠️ batch nonzero exit=$batch_exit fixture=$fixture cohort=$cohort wall=${BATCH_WALL}s — log: $BATCH_LOG"
    fi

    # 解析 batch 实付（从 run-*.json 读 costUsd，最权威）
    BATCH_COST=$(batch_cost_sum "$cohort" "$fixture")
    TOTAL_COST=$(echo "$TOTAL_COST + $BATCH_COST" | bc -l 2>/dev/null || echo "$TOTAL_COST")

    # 累计 runs done（用实际写入的 run-*.json 数）
    rundir="tests/baseline/swe-bench-lite/runs/${cohort}/${fixture}"
    if [[ -d "$rundir" ]]; then
      this_batch_runs=$(ls "$rundir"/run-*.json 2>/dev/null | wc -l | tr -d ' ')
      TOTAL_RUNS_DONE=$(( TOTAL_RUNS_DONE + this_batch_runs ))
    fi

    # stop-loss 3 检测（C cohort batch 后）
    if [[ "$cohort" == "C" ]]; then
      systemic=$(c_batch_systemic_fail "$fixture")
      if [[ "$systemic" == "true" ]]; then
        echo "[f169] 🚨 [stop-loss-3] $fixture cohort C all N=$REPEAT runs are graph-not-built / SIGTERM — 推断系统性 grounding 故障，cascaded skip 剩余 fixture 的 C cohort"
        echo "stop-loss-3: systemic-grounding-fail at $fixture" >> "$LOG_DIR/stop-loss-triggered.txt"
        SKIP_REMAINING_C=true
      fi
    fi

    # 全局累计 cost stop-loss 1
    cost_check=$(echo "$TOTAL_COST > $STOP_LOSS_USD" | bc -l 2>/dev/null || echo "0")
    if [[ "$cost_check" == "1" ]]; then
      echo "[f169] 🚨 [stop-loss-1] global cost \$$TOTAL_COST > \$$STOP_LOSS_USD — abort remaining batches"
      echo "stop-loss-1: global-cost-exceeded total=\$$TOTAL_COST limit=\$$STOP_LOSS_USD at batch $BATCH_IDX/$TOTAL_BATCHES" >> "$LOG_DIR/stop-loss-triggered.txt"
      STOP_LOSS_TRIGGERED="1"
      break 2
    fi

    # wall stop-loss 2
    elapsed_min=$(( ($(date +%s) - START_TS) / 60 ))
    if [[ $elapsed_min -gt $STOP_LOSS_WALL_MIN ]]; then
      echo "[f169] 🚨 [stop-loss-2] wall ${elapsed_min}min > ${STOP_LOSS_WALL_MIN}min — abort remaining batches"
      echo "stop-loss-2: wall-exceeded elapsed=${elapsed_min}min limit=${STOP_LOSS_WALL_MIN}min at batch $BATCH_IDX/$TOTAL_BATCHES" >> "$LOG_DIR/stop-loss-triggered.txt"
      STOP_LOSS_TRIGGERED="2"
      break 2
    fi

    # 进度日志
    echo "[f169][progress] batch=$BATCH_IDX/$TOTAL_BATCHES runs_done=$TOTAL_RUNS_DONE/$EXPECTED_RUNS cost=\$$TOTAL_COST elapsed=${elapsed_min}min"

    # 配额信息日志（每 N runs）
    if (( TOTAL_RUNS_DONE > 0 && TOTAL_RUNS_DONE % QUOTA_CHECK_EVERY == 0 )); then
      quota_check_log "$TOTAL_RUNS_DONE"
    fi
  done
done

# ───────────────────────────────────────────────
# 收尾
# ───────────────────────────────────────────────
END_TS=$(date +%s)
END_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TOTAL_WALL_MIN=$(( (END_TS - START_TS) / 60 ))

cat > "$LOG_DIR/final-summary.json" <<EOF
{
  "feature": "F169",
  "start_iso": "$START_ISO",
  "end_iso": "$END_ISO",
  "wall_min": $TOTAL_WALL_MIN,
  "expected_runs": $EXPECTED_RUNS,
  "runs_done": $TOTAL_RUNS_DONE,
  "global_cost_usd": $TOTAL_COST,
  "batches_total": $TOTAL_BATCHES,
  "batches_done": $BATCH_IDX,
  "stop_loss_triggered": $( [[ -n "$STOP_LOSS_TRIGGERED" ]] && echo "\"$STOP_LOSS_TRIGGERED\"" || echo "null" ),
  "skip_remaining_c_triggered": $SKIP_REMAINING_C
}
EOF

echo ""
echo "==========================================================="
echo "[f169] 完成 $END_ISO"
echo "[f169] wall=${TOTAL_WALL_MIN}min runs_done=$TOTAL_RUNS_DONE/$EXPECTED_RUNS cost=\$$TOTAL_COST"
if [[ -n "$STOP_LOSS_TRIGGERED" ]]; then
  echo "[f169] ⚠️ stop-loss triggered (id=$STOP_LOSS_TRIGGERED) — see $LOG_DIR/stop-loss-triggered.txt"
fi
echo "[f169] final-summary → $LOG_DIR/final-summary.json"
echo "==========================================================="

# Exit code 约定
if [[ $TOTAL_RUNS_DONE -eq $EXPECTED_RUNS ]]; then
  exit 0   # 全 success
elif [[ -n "$STOP_LOSS_TRIGGERED" ]]; then
  # stop-loss 触发 — 检查 partial fixture 数
  fixture_with_data=0
  for fx in "${FIXTURES[@]}"; do
    if [[ -d "tests/baseline/swe-bench-lite/runs/A/${fx}" ]]; then
      fixture_with_data=$((fixture_with_data + 1))
    fi
  done
  if [[ $fixture_with_data -ge 4 ]]; then
    exit 0   # partial 但 ≥4 fixture，verify 仍可判 SC-002
  else
    exit 2   # partial 且 <4 fixture，verify 走 SKIP 分支
  fi
else
  exit 1   # 非 stop-loss 数据缺口（异常）
fi
