#!/bin/bash
# spectra plugin — 环境检查脚本
# 在 SessionStart 时执行，确保 CLI 工具可用
set -euo pipefail

# 检测旧版 reverse-spec plugin，提示用户卸载
if command -v reverse-spec >/dev/null 2>&1; then
  echo "[spectra] 检测到旧版 reverse-spec CLI，建议执行 'claude plugin uninstall reverse-spec' 并切换到 spectra" >&2
fi

if command -v spectra >/dev/null 2>&1; then
  echo "[spectra] CLI 已就绪 ($(spectra --version 2>/dev/null || echo 'unknown version'))" >&2
else
  echo "[spectra] CLI 未找到。请执行以下命令安装后重新启动 Claude Code：" >&2
  echo "  npm install -g spectra-cli" >&2
  echo "[spectra] 安装完成前 MCP server 无法启动。" >&2
fi
