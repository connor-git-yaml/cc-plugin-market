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
    # 同步 worktree 本地态。
    #
    # Feature 239 FR-009：失败与降级都必须**可见**，但都不阻断 worktree 创建。
    # 原实现是 `2>/dev/null || true`——同步脚本的报错和"node 不可用，状态文件写入跳过"
    # 这类降级 warning 一并被吞掉，新 worktree 带着"看起来成功"的假象继续跑。
    # 现在 stderr 直接透传（脚本自身以 exit 0 表示"已降级但完成"，其 warning 必须能被看到），
    # 非零退出时再补一条明确的失败注记；hook 自身始终 exit 0。
    if [ -f scripts/sync-worktree-local-state.sh ]; then
      SYNC_STATUS=0
      bash scripts/sync-worktree-local-state.sh || SYNC_STATUS=$?
      if [ "$SYNC_STATUS" -ne 0 ]; then
        echo "[worktree-lifecycle] 同步脚本以退出码 ${SYNC_STATUS} 结束（上方为其输出）；不阻断 worktree 创建。" >&2
      fi
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
