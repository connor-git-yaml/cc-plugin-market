#!/bin/bash
# reverse-spec plugin — 环境检查脚本
# 在 SessionStart 时执行，检查 CLI 工具可用性

if command -v reverse-spec >/dev/null 2>&1; then
  echo "reverse-spec CLI 已就绪 ($(reverse-spec --version 2>/dev/null || echo 'unknown version'))" >&2
else
  echo "reverse-spec CLI 未全局安装，将通过 npx 按需调用" >&2
fi
