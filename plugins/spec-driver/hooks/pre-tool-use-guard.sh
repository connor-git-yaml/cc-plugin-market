#!/usr/bin/env bash
# PreToolUse Hook: 活跃 spec-driver 工作流中阻止对 src/ 的直接编辑
# exit 0 = 允许, exit 2 = 阻断

set -euo pipefail

# 从 stdin 读取 hook payload（JSON）
INPUT=$(cat)

# 提取目标文件路径（Edit/Write 工具的 file_path 参数）
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//' || echo "")

# 无文件路径时放行
[ -z "$FILE_PATH" ] && exit 0

# 检查是否指向 src/
case "$FILE_PATH" in
  src/*|*/src/*) ;;
  *) exit 0 ;;  # 非 src/ 路径，放行
esac

# 检查是否有活跃的 spec-driver 工作流（specs/*/tasks.md 含未完成任务）
ACTIVE_WORKFLOW=false
for tasks_file in specs/*/tasks.md; do
  [ -f "$tasks_file" ] || continue
  if grep -q '^\- \[ \]' "$tasks_file" 2>/dev/null; then
    ACTIVE_WORKFLOW=true
    break
  fi
done

if [ "$ACTIVE_WORKFLOW" = "true" ]; then
  echo "[PreToolUse BLOCKED] 活跃 spec-driver 工作流中禁止直接编辑 src/。请通过 spec-driver implement 阶段修改代码。" >&2
  exit 2
fi

exit 0
