#!/usr/bin/env bash
# Stop Hook: 检查当前 feature 是否有未完成任务并提醒（非阻断）

set -euo pipefail

FEATURES=""

for tasks_file in specs/*/tasks.md; do
  [ -f "$tasks_file" ] || continue
  COUNT=$(grep -c '^\- \[ \]' "$tasks_file" 2>/dev/null || echo "0")
  if [ "$COUNT" -gt 0 ]; then
    NAME=$(dirname "$tasks_file" | xargs basename)
    FEATURES="${FEATURES}${NAME}(${COUNT}) "
  fi
done

if [ -n "$FEATURES" ]; then
  echo "[提醒] 未完成任务: ${FEATURES}" >&2
fi

# 非阻断，始终 exit 0
exit 0
