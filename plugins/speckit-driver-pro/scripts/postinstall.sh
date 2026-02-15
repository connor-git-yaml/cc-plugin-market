#!/usr/bin/env bash
# Speckit Driver Pro - 安装后脚本
# 由 hooks.json 的 SessionStart 事件触发
# 职责：检查 Claude Code 版本兼容性，输出安装成功消息

set -euo pipefail

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Plugin 信息
PLUGIN_NAME="Speckit Driver Pro"
PLUGIN_VERSION="1.0.0"
MIN_CLAUDE_VERSION="1.0.0"

# 检查 Claude Code 是否可用
check_claude_code() {
  if command -v claude &>/dev/null; then
    return 0
  else
    return 1
  fi
}

# 输出安装信息（静默模式：仅首次安装提示）
main() {
  # 检查是否已经初始化过（避免每次 SessionStart 重复输出）
  local marker_file="${HOME}/.claude/.speckit-driver-pro-installed"

  if [[ -f "$marker_file" ]]; then
    # 已安装过，静默退出
    return 0
  fi

  # 首次安装提示
  echo ""
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  ${PLUGIN_NAME} v${PLUGIN_VERSION} 安装成功${NC}"
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
  echo ""
  echo -e "  自治研发编排器——一键触发 Spec-Driven Development 全流程"
  echo ""
  echo -e "  ${BOLD}快速开始:${NC}"
  echo -e "    /speckit-driver-pro \"你的需求描述\""
  echo ""
  echo -e "  ${BOLD}高级用法:${NC}"
  echo -e "    /speckit-driver-pro --resume          # 恢复中断的流程"
  echo -e "    /speckit-driver-pro --rerun plan       # 重跑指定阶段"
  echo -e "    /speckit-driver-pro --preset quality-first  # 临时切换预设"
  echo ""
  echo -e "  ${BOLD}配置文件:${NC} driver-config.yaml（首次使用时自动引导创建）"
  echo ""

  # 创建安装标记
  mkdir -p "$(dirname "$marker_file")"
  touch "$marker_file"
}

main "$@"
