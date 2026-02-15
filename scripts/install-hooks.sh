#!/usr/bin/env bash
# =============================================================
# install-hooks.sh — 安装 git hooks
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK_TARGET="$REPO_ROOT/.git/hooks/pre-commit"

cp "$SCRIPT_DIR/check-plugin-sync.sh" "$HOOK_TARGET"
chmod +x "$HOOK_TARGET"

echo "✓ 已安装 pre-commit hook: check-plugin-sync → .git/hooks/pre-commit"
