#!/usr/bin/env bash
# Feature 156 — Spectra incremental index 自动触发（post-commit hook）
#
# 用户手动安装：
#   cp plugins/spectra/hooks/post-commit.sh .git/hooks/post-commit
#   chmod +x .git/hooks/post-commit
#
# 行为：
#   1. 仅在仓库根目录已存在 .spectra/ 时触发（用户已显式跑过一次 spectra index）
#   2. 后台异步调用 spectra index --incremental，避免阻塞 commit 流程
#   3. 输出重定向到 .spectra/index-hook.log（已被 .gitignore 涵盖）
#   4. 任何失败都不会回退到 commit 失败（exit 0 总是返回）
#
# 设计决策（clarify Q4）：
#   - 不新增 spectra install --git-hook 子命令，仅提供脚本文件 + README 安装步骤
#   - 不通过 npm postinstall 自动注入，保持非破坏性（FR-16）

set -euo pipefail

# 取仓库根目录（如果不在 git 仓库内则静默退出）
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  exit 0
fi

# .spectra/ 不存在 → 用户尚未启用 spectra index，跳过（FR-16）
if [ ! -d "$REPO_ROOT/.spectra" ]; then
  exit 0
fi

# 后台异步触发 incremental，使用 ORIG_HEAD HEAD（post-commit 上下文标准 ref）
# 输出 redirect 到 .spectra/index-hook.log，避免污染 git commit terminal
(
  cd "$REPO_ROOT"
  npx spectra index --incremental --git-range "ORIG_HEAD HEAD" \
    >> .spectra/index-hook.log 2>&1
) &

# 立即 exit 0；不等待后台进程，不阻塞 commit
exit 0
