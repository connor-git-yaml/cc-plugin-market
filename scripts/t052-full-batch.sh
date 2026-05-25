#!/usr/bin/env bash
# Feature 162 T052 — 全量 450 runs（10 fixture × 3 cohort × N=15 repeat）
# 决策依据：F167 pilot 13 runs 实测投影 ~16.5h opus time + ~55% Max 20x 周配额
# 启动前置：claude CLI 已 login (Claude Max 20x subscription)
# 单次启动：约 17h wall clock；如 hit daily cap 优雅退出，第二天再 run 同脚本续跑
#
# Resume 行为：
#   - 当天已跑的 run_id 在 quota.run_ids → 自动 skip
#   - 跨天的 run-N.json 文件存在 → 会被新跑数据 overwrite（quota reset）
#
# Stop-loss per batch：$50（远高于单 batch 投影 ~$30 max）
# Daily cap：200 runs（Max 20x 单日可承受 ~24h opus 上限）

set -uo pipefail

FIXTURES=(
  "SWE-L001-pytest-module-imported-twice-under"
  "SWE-L002-astropy-in-v5-nddataref-mask"
  "SWE-L003-pytest-rewrite-fails-when-first"
  "SWE-L004-sympy-bug-with-milli-prefix"
  "SWE-L005-astropy-ascii-qdp-table-format"
  "SWE-L006-astropy-please-support-header-rows"
  "SWE-L007-sympy-collect-factor-and-dimension"
  "SWE-L008-sympy-bug-in-expand-of"
  "SWE-L009-sympy-cannot-parse-greek-characters"
  "SWE-L010-sympy-si-collect-factor-and"
)
COHORTS=("A" "B" "C")
REPEAT=15

LOG_DIR="${SPECTRA_T052_LOG_DIR:-/tmp/spectra-t052}"
mkdir -p "$LOG_DIR"

START_TS=$(date +%s)
echo "[t052] 启动: $(date)"
echo "[t052] fixtures=${#FIXTURES[@]} cohorts=${#COHORTS[@]} repeat=$REPEAT total=$(( ${#FIXTURES[@]} * ${#COHORTS[@]} * REPEAT ))"
echo "[t052] log_dir=$LOG_DIR"

TOTAL_BATCHES=0
COMPLETED=0
SKIPPED=0
FAILED=0

for fixture in "${FIXTURES[@]}"; do
  for group in "${COHORTS[@]}"; do
    TOTAL_BATCHES=$((TOTAL_BATCHES + 1))
    LOG="$LOG_DIR/${fixture}-${group}.log"
    echo ""
    echo "[t052] [${TOTAL_BATCHES}/30] group=$group task=$fixture repeat=$REPEAT → $LOG"

    if node scripts/eval-mcp-augmented.mjs \
         --group "$group" \
         --task "$fixture" \
         --repeat "$REPEAT" \
         --stop-loss 50 \
         --max-runs-per-day 200 \
         > "$LOG" 2>&1; then
      tail -3 "$LOG"
      COMPLETED=$((COMPLETED + 1))
    else
      exit_code=$?
      echo "[t052] batch FAILED exit=$exit_code"
      tail -10 "$LOG" || true
      FAILED=$((FAILED + 1))
      # 不中断整体跑批——记录失败 batch，继续下一个
    fi

    # 每 batch 之后打印累计进度
    elapsed=$(($(date +%s) - START_TS))
    echo "[t052] progress: ${COMPLETED}/${TOTAL_BATCHES} done, ${FAILED} failed, elapsed=$((elapsed / 60))min"
  done
done

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

echo ""
echo "==========================================================="
echo "[t052] 完成 $(date)"
echo "[t052] total_batches=$TOTAL_BATCHES completed=$COMPLETED failed=$FAILED"
echo "[t052] wall clock: ${ELAPSED}s ($((ELAPSED / 60)) min / $((ELAPSED / 3600))h)"
echo "==========================================================="
echo "下一步:"
echo "  1. ls tests/baseline/swe-bench-lite/runs/{A,B,C}/SWE-L0*/run-*.json | wc -l (应 ~450)"
echo "  2. npm run eval:report 生成 §10.4 + §10.5 自动报告"
echo "  3. 写 publish-grade competitive-evaluation-report final 章节"
