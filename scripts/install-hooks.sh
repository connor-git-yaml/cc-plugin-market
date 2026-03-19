#!/usr/bin/env bash
# =============================================================
# install-hooks.sh — 安装 git hooks
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.githooks"

chmod +x "$HOOKS_DIR/pre-commit" "$HOOKS_DIR/post-checkout"
git config core.hooksPath .githooks

echo "✓ 已启用版本化 hooks: core.hooksPath=.githooks"
echo "  - pre-commit    -> scripts/check-plugin-sync.sh"
echo "  - post-checkout -> scripts/sync-worktree-local-state.sh"
