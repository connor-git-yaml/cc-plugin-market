#!/bin/bash
# spectra plugin — 环境检查与自动链接脚本
# 在 SessionStart 时执行，确保 CLI 工具可用
set -euo pipefail

PROJECT_ROOT="/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market"

# 检测旧版 reverse-spec plugin，提示用户卸载
if command -v reverse-spec >/dev/null 2>&1; then
  echo "[spectra] 检测到旧版 reverse-spec CLI，建议执行 'claude plugin uninstall reverse-spec' 并切换到 spectra" >&2
fi

if command -v spectra >/dev/null 2>&1; then
  echo "spectra CLI 已就绪 ($(spectra --version 2>/dev/null || echo 'unknown version'))" >&2
else
  echo "spectra CLI 未找到，正在执行 npm link..." >&2
  if [ -d "$PROJECT_ROOT" ] && [ -f "$PROJECT_ROOT/package.json" ]; then
    (cd "$PROJECT_ROOT" && npm link 2>/dev/null) && \
      echo "spectra CLI 已通过 npm link 安装" >&2 || \
      echo "npm link 失败，MCP server 可能无法启动" >&2
  else
    echo "项目目录不存在: $PROJECT_ROOT，请手动执行 npm link" >&2
  fi
fi
