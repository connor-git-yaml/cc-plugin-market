#!/usr/bin/env bash
# Worktree 生命周期 Hook: create 时同步本地态，remove 时检查未提交变更

set -euo pipefail

INPUT=$(cat 2>/dev/null || echo "{}")

# 优先 jq，降级 grep+sed
if command -v jq >/dev/null 2>&1; then
  ACTION=$(echo "$INPUT" | jq -r '.action // empty' 2>/dev/null || echo "")
else
  ACTION=$(echo "$INPUT" | grep -o '"action"[[:space:]]*:[[:space:]]*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"action"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//' || echo "")
fi

case "$ACTION" in
  create)
    # 同步 worktree 本地态
    if [ -f scripts/sync-worktree-local-state.sh ]; then
      bash scripts/sync-worktree-local-state.sh 2>/dev/null || true
    fi
    ;;
  remove)
    WORKTREE_PATH=$(echo "$INPUT" | jq -r '.worktree_path // empty' 2>/dev/null || echo "")
    if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ]; then
      cd "$WORKTREE_PATH" 2>/dev/null || true
    fi
    if ! git diff --quiet 2>/dev/null; then
      echo "[警告] Worktree 中有未提交的变更" >&2
    fi
    ;;
esac

exit 0
