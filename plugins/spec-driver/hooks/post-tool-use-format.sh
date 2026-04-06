#!/usr/bin/env bash
# PostToolUse Hook: Edit/Write 后自动 prettier 格式化
# 仅对 JS/TS/JSON 文件生效，其他文件静默放行
# 注意：密集编辑期间可能有性能开销。如需优化可改为 Stop hook 批量格式化。

set -euo pipefail

INPUT=$(cat)

# 优先 jq，降级 grep+sed
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.file_path // empty' 2>/dev/null || echo "")
else
  FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//' || echo "")
fi

[ -z "$FILE_PATH" ] && exit 0
[ -f "$FILE_PATH" ] || exit 0

case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.mjs|*.cjs)
    if command -v npx >/dev/null 2>&1; then
      npx prettier --write "$FILE_PATH" >/dev/null 2>&1 || true
    fi
    ;;
esac

exit 0
