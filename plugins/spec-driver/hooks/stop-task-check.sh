#!/usr/bin/env bash
# Stop Hook: 检查当前 feature 是否有未完成任务并提醒（非阻断）

set -euo pipefail

INCOMPLETE=0
FEATURE_NAME=""

for tasks_file in specs/*/tasks.md; do
  [ -f "$tasks_file" ] || continue
  COUNT=$(grep -c '^\- \[ \]' "$tasks_file" 2>/dev/null || echo "0")
  if [ "$COUNT" -gt 0 ]; then
    FEATURE_NAME=$(dirname "$tasks_file" | xargs basename)
    INCOMPLETE=$((INCOMPLETE + COUNT))
  fi
done

if [ "$INCOMPLETE" -gt 0 ]; then
  echo "[提醒] ${FEATURE_NAME} 还有 ${INCOMPLETE} 个未完成任务" >&2
fi

# 非阻断，始终 exit 0
exit 0
