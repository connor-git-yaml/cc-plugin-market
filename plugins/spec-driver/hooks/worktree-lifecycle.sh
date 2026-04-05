#!/usr/bin/env bash
# Worktree 生命周期 Hook: create 时同步本地态，remove 时检查未提交变更

set -euo pipefail

INPUT=$(cat 2>/dev/null || echo "{}")

ACTION=$(echo "$INPUT" | grep -o '"action"[[:space:]]*:[[:space:]]*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"action"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//' || echo "")

case "$ACTION" in
  create)
    # 同步 worktree 本地态
    if [ -f scripts/sync-worktree-local-state.sh ]; then
      bash scripts/sync-worktree-local-state.sh 2>/dev/null || true
    fi
    ;;
  remove)
    # 检查是否有未提交变更
    if ! git diff --quiet 2>/dev/null; then
      echo "[警告] Worktree 中有未提交的变更" >&2
    fi
    ;;
esac

exit 0
