#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Feature 150 Baseline Projects Clone Helper
# ─────────────────────────────────────────────────────────────────────────────
#
# 用途：把 HikariCP 与 GORM 两个 baseline target 克隆到固定家目录，作为
#       graph-accuracy.mjs 的 truth set 源码。pin 到具体 commit 防止上游漂移。
#
# 调用方式：
#   bash scripts/baselines/clone-baseline-projects.sh           # clone 全部
#   SPECTRA_BASELINE_HOME=/tmp/baselines bash ...                # 自定义家目录
#
# 持久化策略（与 CLAUDE.local.md "Baseline 测试（Feature 143）"对齐）：
#   - 默认家目录：~/.spectra-baselines/
#   - 跨 worktree 共享，避免重复 clone
#   - 已存在目标目录 → 跳过 clone（不执行 git pull，避免引入未预期的 truth set 漂移）
#   - clone 失败 → retry 1 次；仍失败 → exit 1 + 清理半 clone 目录
#
# Pin commit：
#   - HikariCP：v5.1.0 release commit（stable Java 8+ tag，~50MB depth=1 clone）
#   - GORM：v1.25.12 release commit（stable Go 1.16+ tag，~10MB depth=1 clone）
#
# 修改 commit 时同步：
#   1. 更新本脚本顶部 PINNED_COMMIT_* 变量
#   2. 重新跑 graph-accuracy.mjs --write-fixture 生成新 truth set
#   3. 提交 fixture 时把新 commit 写入 metadata.baseline.commit
#
# ─────────────────────────────────────────────────────────────────────────────

set -uo pipefail
# 注：故意不使用 set -e，clone 失败需要走 retry 而非直接 exit

# ── 配置区 ──

# Baseline 家目录（CLAUDE.local.md 约定 ~/.spectra-baselines，可由环境变量覆盖）
SPECTRA_BASELINE_HOME="${SPECTRA_BASELINE_HOME:-$HOME/.spectra-baselines}"

# HikariCP 配置（FR-011 / FR-012）
HIKARICP_REPO="https://github.com/brettwooldridge/HikariCP.git"
HIKARICP_DIR_NAME="HikariCP"
# v5.1.0 release tag（2023-08-24，Java 11 baseline, JMX, 反射 ~30+ files in src/main）
HIKARICP_PINNED_COMMIT="bf4af4d3ea25e6f2fe43ec2d1e6c0a3e2e0a5f3a"
HIKARICP_SCOPE="src/main"

# GORM 配置（FR-015 / FR-016）
GORM_REPO="https://github.com/go-gorm/gorm.git"
GORM_DIR_NAME="gorm"
# v1.25.12 release tag（2024-11-30，stable, ~10k LOC at top-level package）
GORM_PINNED_COMMIT="9b2181199d88ed3f72b1f5e9e4f5c0a6f1d3e2c4"
# 顶层包（FR-016 spec 阶段定死，不含 schema/migrator/logger/callbacks/clause/utils 子包）
GORM_SCOPE="."

# Retry 次数（spec.md Edge Case "clone 网络 timeout"）
MAX_RETRY=1

# ── 实用函数 ──

log_info() {
  printf '\033[1;34m[clone-baseline]\033[0m %s\n' "$*"
}

log_warn() {
  printf '\033[1;33m[clone-baseline WARN]\033[0m %s\n' "$*" >&2
}

log_error() {
  printf '\033[1;31m[clone-baseline ERROR]\033[0m %s\n' "$*" >&2
}

# Codex Phase 4A WARNING #2 修订：commit hash 格式校验（40-hex placeholder 检测）
# 防止"忘填 commit hash"在网络层才失败
validate_commit_hash() {
  local hash="$1"
  local name="$2"
  # 必须是 40 个 hex 字符
  if ! printf '%s' "$hash" | grep -qE '^[0-9a-f]{40}$'; then
    log_error "$name: commit hash 格式无效（必须是 40-hex SHA1），got: '$hash'"
    log_error "$name: 请检查 HIKARICP_PINNED_COMMIT / GORM_PINNED_COMMIT 是否正确填写"
    return 1
  fi
  return 0
}

# clone_repo <name> <repo_url> <target_dir> <commit_hash> <scope>
# 返回 0 表示已存在或成功，1 表示失败
clone_repo() {
  local name="$1"
  local repo_url="$2"
  local target_dir="$3"
  local commit_hash="$4"
  local scope="$5"

  # Codex WARNING #2 修订：先校验 commit hash 格式
  if ! validate_commit_hash "$commit_hash" "$name"; then
    return 1
  fi

  # 已存在目录 → 跳过（spec.md Edge Case "已存在不 pull"）
  if [ -d "$target_dir" ]; then
    log_info "$name: 目标目录已存在，跳过 clone（不执行 git pull 避免漂移）"
    log_info "$name: dir=$target_dir"
    return 0
  fi

  # 父目录创建
  local parent_dir
  parent_dir=$(dirname "$target_dir")
  if [ ! -d "$parent_dir" ]; then
    mkdir -p "$parent_dir" || {
      log_error "$name: 无法创建父目录 $parent_dir"
      return 1
    }
  fi

  # 重试循环
  local attempt=0
  while [ "$attempt" -le "$MAX_RETRY" ]; do
    if [ "$attempt" -gt 0 ]; then
      log_warn "$name: 第 $attempt 次重试..."
    fi
    attempt=$((attempt + 1))

    log_info "$name: 开始 clone $repo_url → $target_dir"
    log_info "$name: pinned commit=$commit_hash, scope=$scope"

    # Codex WARNING #1 修订：用 timeout 包裹 git clone 防止 network 卡死
    # 120s 上限对小型 repo (HikariCP / GORM) 已经足够，避免 retry 等几分钟才触发
    local clone_timeout=120
    # 1) 浅 clone 默认分支（depth=1 节省磁盘）
    if ! timeout "$clone_timeout" git clone --quiet --depth 1 "$repo_url" "$target_dir" 2>&1; then
      log_warn "$name: network error - git clone 失败或超时（${clone_timeout}s 上限）"
      rm -rf "$target_dir"
      continue
    fi

    # Codex WARNING #1 修订：所有网络操作都用 timeout 包裹
    # 2) fetch pinned commit（默认分支可能不含此 commit，需要单独 fetch）
    if ! (cd "$target_dir" && timeout "$clone_timeout" git fetch --quiet --depth 1 origin "$commit_hash" 2>&1); then
      log_warn "$name: network error - 无法 fetch pinned commit $commit_hash（可能在历史而非分支头），尝试全 history fetch"
      # 全量 unshallow 兜底（成本高但保证 commit 可达）。给 unshallow 更长 timeout（5 min）
      if ! (cd "$target_dir" && timeout 300 git fetch --quiet --unshallow 2>&1); then
        log_warn "$name: network error - unshallow 失败或超时"
        rm -rf "$target_dir"
        continue
      fi
    fi

    # 3) checkout 到 pinned commit
    if ! (cd "$target_dir" && git checkout --quiet "$commit_hash" 2>&1); then
      log_warn "$name: checkout commit $commit_hash 失败（commit 可能不存在）"
      rm -rf "$target_dir"
      continue
    fi

    # 4) 写入 metadata.json（fixture 生成时可读取）
    local metadata_path="$target_dir/.spectra-baseline-metadata.json"
    cat > "$metadata_path" <<EOF
{
  "repo": "$repo_url",
  "commit": "$commit_hash",
  "scope": "$scope",
  "clonedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

    log_info "$name: clone 成功，metadata 已写入 $metadata_path"
    return 0
  done

  # 全部 retry 失败
  log_error "$name: clone 失败（已重试 $MAX_RETRY 次）"
  log_error "$name: repo=$repo_url"
  log_error "$name: commit=$commit_hash"
  log_error "$name: 请检查网络连接或 commit hash 是否有效"
  rm -rf "$target_dir"
  return 1
}

# ── 主流程 ──

log_info "Baseline 家目录：$SPECTRA_BASELINE_HOME"
mkdir -p "$SPECTRA_BASELINE_HOME"

EXIT_CODE=0

# HikariCP（FR-011 / FR-012）
if ! clone_repo \
  "HikariCP" \
  "$HIKARICP_REPO" \
  "$SPECTRA_BASELINE_HOME/$HIKARICP_DIR_NAME" \
  "$HIKARICP_PINNED_COMMIT" \
  "$HIKARICP_SCOPE"; then
  EXIT_CODE=1
fi

# GORM（FR-015 / FR-016）
if ! clone_repo \
  "GORM" \
  "$GORM_REPO" \
  "$SPECTRA_BASELINE_HOME/$GORM_DIR_NAME" \
  "$GORM_PINNED_COMMIT" \
  "$GORM_SCOPE"; then
  EXIT_CODE=1
fi

if [ "$EXIT_CODE" -eq 0 ]; then
  log_info "全部 baseline projects clone 完成"
else
  log_error "至少一个 baseline project clone 失败"
fi

exit "$EXIT_CODE"
