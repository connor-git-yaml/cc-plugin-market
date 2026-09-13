#!/usr/bin/env bash
# SubagentStop Hook: sidechain fix 展开检测器（F289，非阻断型采集器）
#
# 薄壳职责：读 stdin payload → 转发给 fix-compliance-sidechain-marker CLI → **恒 exit 0**。
# 与 post-tool-use-ledger.sh 同纪律：任何路径（CLI 缺失 / node 缺失 / CLI 崩溃 / 信号）一律静默 exit 0，
# 不向 stdout/stderr 输出任何内容（SubagentStop 非零同样会向 agent 上下文注入 hook blocking error 噪声）；
# 失败可观测性由 CLI 侧自诊断文件承担。检测与执法分离：阻断只发生在主 Stop 判定器（Tier 2）。
set -euo pipefail

# 定位 CLI（与 stop-fix-compliance-check.sh 同构三级探测；理由见该文件注释）：
# CLAUDE_PLUGIN_ROOT（Claude 权威注入）→ PLUGIN_ROOT（通用覆盖口）→ BASH_SOURCE 推导。
# 逐级探测文件真实存在，防某级被污染成无关目录时静默指向空路径。
resolve_cli_path() {
  local root
  for root in "${CLAUDE_PLUGIN_ROOT:-}" "${PLUGIN_ROOT:-}"; do
    [ -n "$root" ] || continue
    if [ -f "$root/scripts/lib/fix-compliance-sidechain-marker.mjs" ]; then
      printf '%s' "$root/scripts/lib/fix-compliance-sidechain-marker.mjs"
      return 0
    fi
  done
  local script_dir derived
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  derived="$(cd "$script_dir/.." && pwd)"
  if [ -f "$derived/scripts/lib/fix-compliance-sidechain-marker.mjs" ]; then
    printf '%s' "$derived/scripts/lib/fix-compliance-sidechain-marker.mjs"
    return 0
  fi
  # 全都探不到：返回空串，主流程据此静默退出（采集器缺失不值得任何噪声）
  printf ''
}

CLI="${SIDECHAIN_MARKER_CLI:-$(resolve_cli_path)}"

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
