#!/usr/bin/env bash
# =============================================================
# check-plugin-sync.sh — 校验 Plugin Marketplace 配置同步一致性
#
# 检查项:
#   CHECK-1: marketplace.json 中每个插件的 source 目录存在
#   CHECK-2: plugin.json 的 name 与 marketplace 注册一致
#   CHECK-3: plugin.json 的 version 与 marketplace 注册一致
#   CHECK-4: settings.json 的 enabledPlugins 引用在 marketplace 中存在
#
# 用法:
#   bash scripts/check-plugin-sync.sh          # 手动运行
#   作为 .git/hooks/pre-commit 被自动调用
# =============================================================
set -euo pipefail

# ---- 定位项目根目录 ----
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# 支持从 scripts/ 或 .git/hooks/ 两种位置调用
if [[ "$SCRIPT_DIR" == */.git/hooks ]]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
else
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$REPO_ROOT"

# ---- 配置 ----
MARKETPLACE=".claude-plugin/marketplace.json"
SETTINGS=".claude/settings.json"

# ---- 颜色（支持无色终端降级） ----
if [ -t 2 ]; then
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  GREEN='\033[0;32m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED='' YELLOW='' GREEN='' BOLD='' NC=''
fi

# ---- 工具检查 ----
if ! command -v jq &>/dev/null; then
  echo -e "${RED}错误: 需要 jq 来解析 JSON。请安装: brew install jq${NC}" >&2
  exit 1
fi

# ---- marketplace.json 存在性 ----
if [ ! -f "$MARKETPLACE" ]; then
  echo -e "${RED}错误: 找不到 ${MARKETPLACE}${NC}" >&2
  exit 1
fi

# ---- 开始校验 ----
ERRORS=()
WARNINGS=()

echo -e "${BOLD}[plugin-sync] 校验 Plugin Marketplace 同步一致性...${NC}" >&2

MARKET_CONTENT=$(cat "$MARKETPLACE")
MARKET_REPO_NAME=$(echo "$MARKET_CONTENT" | jq -r '.name // empty')
PLUGIN_COUNT=$(echo "$MARKET_CONTENT" | jq '.plugins | length')

for i in $(seq 0 $((PLUGIN_COUNT - 1))); do
  M_NAME=$(echo "$MARKET_CONTENT" | jq -r ".plugins[$i].name")
  M_SOURCE=$(echo "$MARKET_CONTENT" | jq -r ".plugins[$i].source")
  M_VERSION=$(echo "$MARKET_CONTENT" | jq -r ".plugins[$i].version")

  # source 格式 "./plugins/<name>"，转为相对路径
  PLUGIN_DIR="${M_SOURCE#./}"
  PLUGIN_JSON="${PLUGIN_DIR}/.claude-plugin/plugin.json"

  # CHECK-1: 插件目录存在
  if [ ! -d "$PLUGIN_DIR" ]; then
    ERRORS+=("CHECK-1 失败: marketplace.json 注册了 '${M_NAME}'，但目录 '${PLUGIN_DIR}/' 不存在")
    continue
  fi

  # plugin.json 存在
  if [ ! -f "$PLUGIN_JSON" ]; then
    ERRORS+=("CHECK-1 失败: 目录 '${PLUGIN_DIR}/' 存在，但缺少 '${PLUGIN_JSON}'")
    continue
  fi

  P_CONTENT=$(cat "$PLUGIN_JSON")
  P_NAME=$(echo "$P_CONTENT" | jq -r '.name // empty')
  P_VERSION=$(echo "$P_CONTENT" | jq -r '.version // empty')

  # CHECK-2: 名称一致
  if [ "$M_NAME" != "$P_NAME" ]; then
    ERRORS+=("CHECK-2 失败: 名称不匹配 — marketplace.json 中为 '${M_NAME}'，${PLUGIN_JSON} 中为 '${P_NAME}'")
  fi

  # CHECK-3: 版本一致
  if [ "$M_VERSION" != "$P_VERSION" ]; then
    ERRORS+=("CHECK-3 失败: 版本不匹配（插件 '${M_NAME}'） — marketplace.json 为 '${M_VERSION}'，${PLUGIN_JSON} 为 '${P_VERSION}'")
  fi
done

# CHECK-4: settings.json 中 enabledPlugins 引用有效
if [ -f "$SETTINGS" ]; then
  MARKET_NAMES=$(echo "$MARKET_CONTENT" | jq -r '.plugins[].name' 2>/dev/null || true)
  ENABLED_KEYS=$(jq -r '.enabledPlugins // {} | keys[]' "$SETTINGS" 2>/dev/null || true)

  while IFS= read -r key; do
    [ -z "$key" ] && continue
    PLUGIN_NAME="${key%%@*}"

    if ! echo "$MARKET_NAMES" | grep -qx "$PLUGIN_NAME"; then
      ERRORS+=("CHECK-4 失败: settings.json 启用了 '${key}'，但 marketplace.json 中不存在名为 '${PLUGIN_NAME}' 的插件")
    fi
  done <<< "$ENABLED_KEYS"
else
  WARNINGS+=("警告: 找不到 ${SETTINGS}，跳过 enabledPlugins 校验")
fi

# ---- 输出结果 ----
if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo "" >&2
  for w in "${WARNINGS[@]}"; do
    echo -e "  ${YELLOW}⚠ ${w}${NC}" >&2
  done
fi

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo "" >&2
  echo -e "${RED}${BOLD}========================================${NC}" >&2
  echo -e "${RED}${BOLD} Plugin Marketplace 同步校验失败！${NC}" >&2
  echo -e "${RED}${BOLD}========================================${NC}" >&2
  echo "" >&2
  for err in "${ERRORS[@]}"; do
    echo -e "  ${RED}✗ ${err}${NC}" >&2
  done
  echo "" >&2
  echo -e "${YELLOW}提示: 请确保以下文件保持同步:${NC}" >&2
  echo -e "  1. ${MARKETPLACE}" >&2
  echo -e "  2. plugins/<name>/.claude-plugin/plugin.json" >&2
  echo -e "  3. ${SETTINGS}" >&2
  echo "" >&2
  exit 1
fi

echo -e "${GREEN}[plugin-sync] Plugin Marketplace 同步校验通过 ✓${NC}" >&2
exit 0
