#!/usr/bin/env bash
# PostToolUse Hook: 会话证据账本采集器（F270 P1，非阻断型）
#
# 薄壳职责：读 stdin payload → 转发给 ledger-writer CLI → **恒 exit 0**。
# 与 stop-fix-compliance-check.sh 的差别：那边按 CLI 退出码转发 0/2（阻断型判定器），
# 这边是纯采集器——C-10 实测：PostToolUse 返回非零虽不阻断工具，但会向 agent 上下文
# 注入 `hook blocking error` 噪声，且该噪声通道被判方可观测、可诱导触发（P-4）。
# 故本薄壳任何路径（CLI 缺失 / node 缺失 / CLI 崩溃 / 信号）一律静默 exit 0，
# 且不向 stdout/stderr 输出任何内容；失败可观测性由 writer 侧自诊断文件承担（FR-005）。

set -euo pipefail

# 定位 CLI（与 stop-fix-compliance-check.sh 同构三级探测；理由见该文件注释）：
# CLAUDE_PLUGIN_ROOT（Claude 权威注入）→ PLUGIN_ROOT（通用覆盖口）→ BASH_SOURCE 推导。
# 逐级探测文件真实存在，防某级被污染成无关目录时静默指向空路径。
resolve_cli_path() {
  local root
  for root in "${CLAUDE_PLUGIN_ROOT:-}" "${PLUGIN_ROOT:-}"; do
    [ -n "$root" ] || continue
    if [ -f "$root/scripts/lib/ledger-writer.mjs" ]; then
      printf '%s' "$root/scripts/lib/ledger-writer.mjs"
      return 0
    fi
  done
  local script_dir derived
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  derived="$(cd "$script_dir/.." && pwd)"
  if [ -f "$derived/scripts/lib/ledger-writer.mjs" ]; then
    printf '%s' "$derived/scripts/lib/ledger-writer.mjs"
    return 0
  fi
  # 全都探不到：返回空串，主流程据此静默退出（采集器缺失不值得任何噪声）
  printf ''
}

CLI="${LEDGER_WRITER_CLI:-$(resolve_cli_path)}"

# CLI 或 node 缺失 → 静默退出（无采集能力，不产生噪声；判定侧按「账本缺席」回退 FR-009）
if [ -z "$CLI" ] || [ ! -f "$CLI" ]; then
  exit 0
fi
if ! command -v node >/dev/null 2>&1; then
  exit 0
fi

# stdin 转发；writer 自身恒 exit 0 且零输出，此处再兜一层丢弃输出 + 吞非零（信号/崩溃）
set +e
cat | node "$CLI" --project-root "$(pwd)" >/dev/null 2>&1
set -e

exit 0
