#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Feature 162 T050 — SWE-Bench upstream repos clone helper
# ─────────────────────────────────────────────────────────────────────────────
#
# 用途：clone SWE-Bench-Lite fixture（SWE-L001~L010）的上游 repo 到
#       ~/.spectra-baselines/<name>/，供 eval-mcp-augmented.mjs 的
#       prepareWorktree 函数 rsync + checkout fixture.startCommit。
#
# 不在 spec FR-030 显式列出（design gap，pilot 启动后实测发现），但是 Phase C
# 跑批硬前置（无 clone → prepareWorktree 第一行就 throw "baseline workspace
# /Users/<u>/.spectra-baselines/<name> not found"）。
#
# 调用方式：
#   bash scripts/baselines/clone-swe-bench-upstream.sh           # clone 全部
#   SPECTRA_BASELINE_HOME=/tmp/baselines bash ...                # 自定义家目录
#
# 持久化策略：跨 worktree 共享，已存在跳过 clone（不 pull 避免漂移）
# 用 git clone（无 depth=1，因 fixture startCommit 可能很老不在浅 history）
#
# Pilot 27 (SWE-L001 / L003 / L005) 需要：pytest + astropy
# 全量 450 (SWE-L001~L010) 需要：pytest + astropy + sympy
#
# ─────────────────────────────────────────────────────────────────────────────

set -uo pipefail

SPECTRA_BASELINE_HOME="${SPECTRA_BASELINE_HOME:-$HOME/.spectra-baselines}"

# SWE-Bench-Lite 上游 repo（按 fixture 用到的范围）
declare -a REPOS=(
  "pytest|https://github.com/pytest-dev/pytest.git"
  "astropy|https://github.com/astropy/astropy.git"
  "sympy|https://github.com/sympy/sympy.git"
)

MAX_RETRY=1

log_info() {
  printf '\033[1;34m[clone-swe-bench]\033[0m %s\n' "$*"
}
log_warn() {
  printf '\033[1;33m[clone-swe-bench WARN]\033[0m %s\n' "$*" >&2
}
log_error() {
  printf '\033[1;31m[clone-swe-bench ERROR]\033[0m %s\n' "$*" >&2
}

TIMEOUT_CMD=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD="gtimeout"
fi

wrap_with_timeout() {
  local seconds="$1"
  shift
  if [ -n "$TIMEOUT_CMD" ]; then
    "$TIMEOUT_CMD" "$seconds" "$@"
  else
    "$@"
  fi
}

clone_repo() {
  local name="$1"
  local repo_url="$2"
  local target_dir="${SPECTRA_BASELINE_HOME}/${name}"

  if [ -d "$target_dir" ]; then
    # 幂等校验：用 git rev-parse 判断 git 完整性（C-1 fix：比检 .git/config 更可靠）
    if ! git -C "$target_dir" rev-parse --git-dir > /dev/null 2>&1; then
      # 目录存在但不是合法 git repo（中断残留 / 空目录 / 非 git 目录）
      # 安全性保护：只有目录非常小（< 10 文件/子目录）才自动清理；否则 hard fail
      local item_count
      # 2>/dev/null 防 pipefail 在权限不足时 abort；-maxdepth 1 结果含目录自身（空目录=1，有1个文件=2）
      item_count=$(find "$target_dir" -maxdepth 1 2>/dev/null | wc -l) || item_count=0
      if [ "$item_count" -lt 10 ]; then
        log_warn "$name: 目标目录存在但 git 不完整（items=${item_count}（含目录自身），疑似中断残留），自动 rm -rf 重 clone"
        rm -rf "$target_dir"
        # fall through to clone
      else
        log_error "$name: 目标目录存在但 git 不完整，且文件数多（items=${item_count}），请手动检查后删除再重跑"
        return 1
      fi
    else
      # git 完整；校验 origin URL（C-2 fix：区分无 origin 和 URL 不匹配两种情形）
      local actual_url
      actual_url=$(git -C "$target_dir" remote get-url origin 2>/dev/null || echo "")
      if [ -z "$actual_url" ]; then
        # 无 origin remote：视同中断残留，rm -rf 重 clone
        log_warn "$name: 目标目录 git 完整但无 origin remote，视为损坏 clone，自动 rm -rf 重 clone"
        rm -rf "$target_dir"
        # fall through to clone
      elif [ "$actual_url" != "$repo_url" ]; then
        # URL 不匹配：保留用户已有 clone，跳过但报 warning（不视为成功）
        log_warn "$name: origin URL 不匹配（expected=$repo_url actual=$actual_url），跳过（保留现有 clone）"
        log_warn "$name: 如需用正确 repo 重 clone，请手动 rm -rf ${target_dir} 后重跑"
        return 0
      else
        log_info "$name: 目标目录已存在且 git 完整，跳过 clone (dir=${target_dir})"
        return 0
      fi
    fi
  fi

  mkdir -p "$SPECTRA_BASELINE_HOME"

  local attempt=0
  while [ "$attempt" -le "$MAX_RETRY" ]; do
    if [ "$attempt" -gt 0 ]; then
      log_warn "$name: 第 $attempt 次重试..."
    fi
    attempt=$((attempt + 1))

    log_info "$name: 开始 full clone $repo_url → $target_dir"
    log_info "$name: 注意 — 此 clone **不 shallow**（fixture startCommit 可能很老），可能需 5-15 min + ~150MB-1GB"

    # 不用 depth=1，因为 fixture 的 startCommit 可能在 history 深处
    # 5 min timeout（每 repo 单独，~150MB pytest 应 < 3 min，~1GB astropy 可能 5-10 min）
    local clone_timeout=900
    if ! wrap_with_timeout "$clone_timeout" git clone --quiet "$repo_url" "$target_dir" 2>&1; then
      log_warn "$name: clone 失败或超时（${clone_timeout}s 上限）"
      rm -rf "$target_dir"
      continue
    fi

    log_info "$name: clone 成功（$(du -sh "$target_dir" 2>/dev/null | cut -f1)）"
    return 0
  done

  log_error "$name: clone 失败（已重试 $MAX_RETRY 次）"
  rm -rf "$target_dir"
  return 1
}

log_info "Baseline 家目录：$SPECTRA_BASELINE_HOME"
log_info "需 clone 数量：${#REPOS[@]} 个 repo（pytest ~150MB / astropy ~1GB / sympy ~500MB）"
log_info "wall clock 预估：full clone ~10-30 min 总（取决于网络）"
log_info ""

EXIT_CODE=0
for entry in "${REPOS[@]}"; do
  IFS='|' read -r name repo_url <<<"$entry"
  if ! clone_repo "$name" "$repo_url"; then
    EXIT_CODE=1
  fi
done

if [ "$EXIT_CODE" -eq 0 ]; then
  log_info ""
  log_info "全部 SWE-Bench upstream repo clone 完成"
  log_info "下一步：重启 pilot 27 — bash scripts/pilot-27-batch.sh"
else
  log_error "至少一个 repo clone 失败"
fi

exit "$EXIT_CODE"
