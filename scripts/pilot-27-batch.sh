#!/usr/bin/env bash
# Feature 162 T050 pilot batch — 3 group × 3 fixture × 3 repeat = 27 runs
# 目的：估算 ChatGPT Pro 单 run token 消耗 + jury wall clock + 跑批稳定性
# 决策依据：plan §0.1 选 5 frozen ids 中前 3 个（pass 类）作为 pilot 子集
#
# 使用前置：
#   export SILICONFLOW_API_KEY="$(cat ~/.config/spectra/siliconflow.key)"
#   codex CLI 已 logged in (~/.codex/auth.json 存在)
#   claude CLI 已 logged in (Claude Max subscription)
#
# 单 run 估算：~5-10 min wall clock；27 runs ≈ 2.5-4.5h；
# ChatGPT Pro 配额需求 medium reasoning：~50-100 tokens/run × 27 ≈ 1.5K tokens（保守预估）
# SiliconFlow API cost：~$1-2 (3 judge × 27 ≈ 81 jury calls × $0.02/call)

set -euo pipefail

if [ -z "${SILICONFLOW_API_KEY:-}" ]; then
  echo "[pilot-27] ERROR: SILICONFLOW_API_KEY 未设置" >&2
  echo "  解决: export SILICONFLOW_API_KEY=\"\$(cat ~/.config/spectra/siliconflow.key)\"" >&2
  exit 73
fi

PILOT_FIXTURES=("SWE-L001" "SWE-L003" "SWE-L005")
COHORTS=("A" "B" "C")
REPEAT=3

LOG_DIR="${SPECTRA_PILOT_LOG_DIR:-/tmp/spectra-pilot-27}"
mkdir -p "$LOG_DIR"

START_TS=$(date +%s)
echo "[pilot-27] 启动: $(date)"
echo "[pilot-27] cohorts: ${COHORTS[*]} | fixtures: ${PILOT_FIXTURES[*]} | repeat: $REPEAT"
echo "[pilot-27] 总跑批数: $((${#COHORTS[@]} * ${#PILOT_FIXTURES[@]} * REPEAT))"
echo "[pilot-27] log dir: $LOG_DIR"

TOTAL=0
SUCCESS=0
FAIL=0

for group in "${COHORTS[@]}"; do
  for fixture in "${PILOT_FIXTURES[@]}"; do
    TOTAL=$((TOTAL + 1))
    LOG="$LOG_DIR/group-${group}-${fixture}.log"
    echo ""
    echo "[pilot-27] [${TOTAL}/9 (group, fixture)] group=${group} task=${fixture} repeat=${REPEAT} → $LOG"

    if node scripts/eval-mcp-augmented.mjs \
         --group "$group" \
         --task "$fixture" \
         --repeat "$REPEAT" \
         --max-runs-per-day 30 \
         > "$LOG" 2>&1; then
      SUCCESS=$((SUCCESS + 1))
      echo "[pilot-27] (group, fixture) #${TOTAL} ✓"
    else
      FAIL=$((FAIL + 1))
      echo "[pilot-27] (group, fixture) #${TOTAL} ✗ exit=$?"
      tail -10 "$LOG" || true
    fi
  done
done

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

echo ""
echo "==========================================================="
echo "[pilot-27] 完成 $(date)"
echo "[pilot-27] 总 (group, fixture) 数: $TOTAL"
echo "[pilot-27] 成功: $SUCCESS"
echo "[pilot-27] 失败: $FAIL"
echo "[pilot-27] wall clock: ${ELAPSED}s ($((ELAPSED / 60)) min)"
echo "==========================================================="
echo ""
echo "下一步："
echo "  1. 检查 tests/baseline/swe-bench-lite/runs/{A,B,C}/{SWE-L001,L003,L005}/run-*.json"
echo "  2. 估算单 run token 消耗（看 perf.tokensInput + tokensOutput）"
echo "  3. 估算单 run wall clock（从 started_at + finalized_at 计算）"
echo "  4. 决策是否进入全量 450 runs（spec FR-031 / plan §0.4）"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
