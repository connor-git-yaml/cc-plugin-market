#!/usr/bin/env bash
#
# sync-worktree-local-state.sh
# 在 git worktree 中补齐主工作区的本地态：
# - 仓库内但 gitignore 的本地文件/目录：.claude/settings.local.json, .specify/.spec-driver-path, .agents
# - Claude 项目级 memory 目录（按绝对路径建档的外部本机状态）
#
# 设计原则：
# - 仅在 worktree 中执行；主工作区默认 no-op
# - 仅创建缺失的软链接，不覆盖已有真实文件或非预期链接
# - idempotent，可重复执行

set -euo pipefail

ZERO_SHA="0000000000000000000000000000000000000000"

DRY_RUN="false"
QUIET="false"

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN="true"
      ;;
    --quiet)
      QUIET="true"
      ;;
    --help|-h)
      cat <<'USAGE'
用法:
  bash scripts/sync-worktree-local-state.sh [--dry-run] [--quiet]

说明:
  将主工作区的关键本地态以软链接方式同步到当前 worktree。
USAGE
      exit 0
      ;;
    *)
      echo "[worktree-sync] 未知参数: $arg" >&2
      exit 1
      ;;
  esac
done

log() {
  if [[ "$QUIET" != "true" ]]; then
    echo "[worktree-sync] $*" >&2
  fi
}

warn() {
  echo "[worktree-sync] 警告: $*" >&2
}

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[dry-run] $*"
  else
    "$@"
  fi
}

action_word() {
  if [[ "$DRY_RUN" == "true" ]]; then
    printf '计划链接'
  else
    printf '已链接'
  fi
}

slugify_path() {
  local input="$1"
  printf '%s' "$input" | sed 's/[\/.]/-/g'
}

link_path() {
  local source_path="$1"
  local target_path="$2"
  local label="$3"

  if [[ ! -e "$source_path" && ! -L "$source_path" ]]; then
    log "跳过 ${label}: source 不存在 ($source_path)"
    return 0
  fi

  local target_dir
  target_dir="$(dirname "$target_path")"

  if [[ -L "$target_path" ]]; then
    local current_target
    current_target="$(readlink "$target_path")"
    if [[ "$current_target" == "$source_path" ]]; then
      log "已存在 ${label}: $target_path -> $source_path"
      return 0
    fi
    warn "跳过 ${label}: 目标已存在其他软链接 ($target_path -> $current_target)"
    return 0
  fi

  if [[ -e "$target_path" ]]; then
    warn "跳过 ${label}: 目标已存在真实文件/目录 ($target_path)"
    return 0
  fi

  run mkdir -p "$target_dir"
  run ln -s "$source_path" "$target_path"
  log "$(action_word) ${label}: $target_path -> $source_path"
}

CURRENT_ROOT="$(git rev-parse --show-toplevel)"
COMMON_GIT_DIR="$(git rev-parse --git-common-dir)"
PRIMARY_ROOT="$(cd "$COMMON_GIT_DIR/.." && pwd)"

if [[ "$CURRENT_ROOT" == "$PRIMARY_ROOT" ]]; then
  log "当前位于主工作区，跳过 worktree 同步"
  exit 0
fi

log "检测到 worktree:"
log "  current = $CURRENT_ROOT"
log "  primary = $PRIMARY_ROOT"

# 仓库内本地态：只同步真正关键且应与主工作区保持一致的 ignored 内容。
RELATIVE_TARGETS=(
  ".claude/settings.local.json"
  ".specify/.spec-driver-path"
  ".agents"
)

for relative_path in "${RELATIVE_TARGETS[@]}"; do
  link_path \
    "$PRIMARY_ROOT/$relative_path" \
    "$CURRENT_ROOT/$relative_path" \
    "$relative_path"
done

# Claude 项目级 memory：仅在目标 memory 尚不存在时建立软链接。
CLAUDE_PROJECTS_DIR="${HOME}/.claude/projects"
if [[ -d "$CLAUDE_PROJECTS_DIR" ]]; then
  PRIMARY_MEMORY_DIR="${CLAUDE_PROJECTS_DIR}/$(slugify_path "$PRIMARY_ROOT")/memory"
  CURRENT_MEMORY_DIR="${CLAUDE_PROJECTS_DIR}/$(slugify_path "$CURRENT_ROOT")/memory"

  if [[ -d "$PRIMARY_MEMORY_DIR" ]]; then
    link_path "$PRIMARY_MEMORY_DIR" "$CURRENT_MEMORY_DIR" "claude-project-memory"
  else
    log "跳过 claude-project-memory: 主工作区 memory 不存在 ($PRIMARY_MEMORY_DIR)"
  fi
fi

log "同步完成"
