#!/usr/bin/env bash
# Spec Driver - SessionStart Hook 脚本
# 由 hooks.json 的 SessionStart 事件触发
# 职责：(1) 将插件路径写入项目的 .specify/.spec-driver-path；(2) 首次安装提示

set -euo pipefail

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Plugin 信息
PLUGIN_NAME="Spec Driver"
PLUGIN_VERSION="3.1.0"
MIN_CLAUDE_VERSION="1.0.0"

# 推算插件根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
  PLUGIN_DIR="$CLAUDE_PLUGIN_ROOT"
else
  PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
fi

# 确定用户项目目录
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# 写入插件路径到项目 .specify/.spec-driver-path（幂等）
write_plugin_path() {
  # 验证 PLUGIN_DIR 有效性
  if [[ ! -d "$PLUGIN_DIR/scripts" ]]; then
    echo "[警告] spec-driver 插件目录无效: $PLUGIN_DIR，跳过路径写入" >&2
    return 0
  fi

  # 确保 .specify/ 目录存在
  mkdir -p "$PROJECT_DIR/.specify" 2>/dev/null || true

  # 幂等写入路径文件
  if [[ -d "$PROJECT_DIR/.specify" ]]; then
    echo -n "$PLUGIN_DIR" > "$PROJECT_DIR/.specify/.spec-driver-path"
  else
    echo "[警告] 无法创建 $PROJECT_DIR/.specify/ 目录，跳过路径写入" >&2
  fi
}

# 检查 Claude Code 是否可用
check_claude_code() {
  if command -v claude &>/dev/null; then
    return 0
  else
    return 1
  fi
}

# 主流程
main() {
  # 步骤 1: 写入插件路径（每次 SessionStart 都执行，确保版本升级后路径更新）
  write_plugin_path

  # 步骤 2: 首次安装提示（仅首次显示）
  local marker_file="${HOME}/.claude/.spec-driver-installed"

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
  echo -e "  自治研发编排器——支持 run/story/fix/resume/sync 五种模式"
  echo ""
  echo -e "  ${BOLD}快速开始:${NC}"
  echo -e "    /spec-driver:speckit-feature \"你的需求描述\"     # 完整流程（含调研）"
  echo -e "    /spec-driver:speckit-story \"需求变更\"       # 快速需求实现"
  echo -e "    /spec-driver:speckit-fix \"问题描述\"         # 快速问题修复"
  echo ""
  echo -e "  ${BOLD}其他命令:${NC}"
  echo -e "    /spec-driver:speckit-resume                  # 恢复中断的流程"
  echo -e "    /spec-driver:speckit-sync                    # 聚合产品规范"
  echo -e "    /spec-driver:speckit-feature --rerun plan         # 重跑指定阶段"
  echo ""
  echo -e "  ${BOLD}配置文件:${NC} spec-driver.config.yaml（首次使用时自动引导创建）"
  echo ""

  # 创建安装标记
  mkdir -p "$(dirname "$marker_file")"
  touch "$marker_file"
}

main "$@"
