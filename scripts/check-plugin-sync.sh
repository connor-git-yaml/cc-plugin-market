#!/usr/bin/env bash
# check-plugin-sync.sh — 仓库级同步校验薄壳
#
# 说明:
#   该脚本保留给 hooks 与历史入口使用，实际校验逻辑统一委托给
#   `node scripts/repo-check.mjs`，避免 Bash 内联更多业务规则。
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

# ---- 检查 src/ 中是否有硬编码版本字符串（Feature 135 Bug 3）----
# grep -rn "spectra v[0-9]" 匹配 "spectra v3.0" 等形式的硬编码版本
HARDCODED_VERSION_HITS=$(grep -rn 'spectra v[0-9]' src/ --include="*.ts" 2>/dev/null || true)
if [[ -n "$HARDCODED_VERSION_HITS" ]]; then
  echo "FAIL: hardcoded version string found in src/"
  echo "$HARDCODED_VERSION_HITS"
  exit 1
fi

exec node scripts/repo-check.mjs --project-root "$REPO_ROOT"
