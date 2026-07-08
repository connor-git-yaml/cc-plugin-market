#!/usr/bin/env bash
# Stop Hook: fix 模式流程依从性判定（Feature 208，阻断型）
#
# 薄壳职责（research.md D3）：读 stdin payload → 转发给 Node CLI → 按 CLI 退出码原样转发 0/2，
# 任何非 0/2 的异常退出码一律兜底为 0（放行）。自身无判定逻辑，构成 FR-013 fail-open 的第二道保险
# （即便 Node 判定器抛出未捕获异常，本层仍兜底放行，不把崩溃泄漏为 Claude Code 侧未定义阻断）。

set -euo pipefail

# 定位插件根：优先 CLAUDE_PLUGIN_ROOT，缺省时按脚本自身相对路径推导（hooks/ 的上一级）
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
if [ -z "$PLUGIN_ROOT" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

CLI="${FIX_COMPLIANCE_CLI:-$PLUGIN_ROOT/scripts/fix-compliance-judge.mjs}"

# node 不可用 → 放行（无法判定不阻断，FR-013）
if ! command -v node >/dev/null 2>&1; then
  exit 0
fi

# stdin 转发给 CLI；临时禁用 errexit 以便捕获非零退出码做兜底判定
STDIN_PAYLOAD="$(cat)"

set +e
printf '%s' "$STDIN_PAYLOAD" | node "$CLI" --mode hook --project-root "$(pwd)"
CLI_EXIT=$?
set -e

# 退出码转发：0/2 原样转发，其余（崩溃/信号）兜底放行
if [ "$CLI_EXIT" -eq 2 ]; then
  exit 2
fi
exit 0
