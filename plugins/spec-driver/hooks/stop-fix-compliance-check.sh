#!/usr/bin/env bash
# Stop Hook: fix 模式流程依从性判定（Feature 208，阻断型）
#
# 薄壳职责（research.md D3）：读 stdin payload → 转发给 Node CLI → 按 CLI 退出码原样转发 0/2，
# 任何非 0/2 的异常退出码一律兜底为 0（放行）。自身无判定逻辑，构成 FR-013 fail-open 的第二道保险
# （即便 Node 判定器抛出未捕获异常，本层仍兜底放行，不把崩溃泄漏为 Claude Code 侧未定义阻断）。

set -euo pipefail

# 定位插件根（Feature 240 / T028）：CLAUDE_PLUGIN_ROOT → PLUGIN_ROOT → BASH_SOURCE 推导。
#
# 为什么有 PLUGIN_ROOT 这一级：`CLAUDE_PLUGIN_ROOT` 是 Claude adapter 专有的注入变量。
# 🔴 实测结论（_grounding.md §8.6）：**Codex 不注入任何 plugin-root 变量**，所以这一级
# **不是**为了消费 Codex 的注入 —— 那是不存在的东西。它是给我方自身与其他运行时留的
# 通用覆盖口（如从非标准位置执行、测试注入），避免每接一个运行时就往这里加一个专有变量名。
#
# 🔴 为什么 CLAUDE_PLUGIN_ROOT 排在 PLUGIN_ROOT **之前**（spec FR-005 已同步修订）：
# `PLUGIN_ROOT` 是极通用的变量名，环境里任何无关工具导出它都会挤掉 Claude 注入的权威值。
# 那条失败路径是静默的 —— CLI 找不到 → 本薄壳兜底 exit 0 → 依从性判定整个失效却无任何信号。
# 把权威注入放在最前，只在它缺席（即非 Claude 运行时）时才使用通用覆盖口，功能上零损失：
# Claude 下本就该用 CLAUDE_PLUGIN_ROOT，其他运行时下 CLAUDE_PLUGIN_ROOT 恒为空。
# 需要在 Claude 下强制改判定器位置时用 FIX_COMPLIANCE_CLI（下面那一级，语义更精确）。
#
# 第二道保险：逐级**探测 CLI 是否真的存在**，不存在就继续向下 fallback。这样即使某一级被
# 污染成无关目录，也不会静默降级为"判定器缺失 → 放行"。三级都探不到时按脚本自身位置推导。
resolve_cli_path() {
  local root
  for root in "${CLAUDE_PLUGIN_ROOT:-}" "${PLUGIN_ROOT:-}"; do
    [ -n "$root" ] || continue
    if [ -f "$root/scripts/fix-compliance-judge.mjs" ]; then
      printf '%s' "$root/scripts/fix-compliance-judge.mjs"
      return 0
    fi
  done
  local script_dir derived
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  derived="$(cd "$script_dir/.." && pwd)"
  if [ -f "$derived/scripts/fix-compliance-judge.mjs" ]; then
    printf '%s' "$derived/scripts/fix-compliance-judge.mjs"
    return 0
  fi
  # 全都探不到：返回第一个已设置的候选，让下游给出准确的 ENOENT，而不是伪装成"已定位"
  for root in "${CLAUDE_PLUGIN_ROOT:-}" "${PLUGIN_ROOT:-}" "$derived"; do
    [ -n "$root" ] || continue
    printf '%s' "$root/scripts/fix-compliance-judge.mjs"
    return 0
  done
}

CLI="${FIX_COMPLIANCE_CLI:-$(resolve_cli_path)}"

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
