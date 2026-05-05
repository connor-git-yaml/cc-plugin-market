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
    # 空目录自动清理后重建软链接（典型场景：vitest 等工具提前创建空 node_modules/）
    if [[ -d "$target_path" && -d "$source_path" ]]; then
      local entry_count
      entry_count=$(find "$target_path" -maxdepth 1 -not -name '.*' -not -path "$target_path" 2>/dev/null | wc -l | tr -d ' ')
      if [[ "$entry_count" == "0" ]]; then
        log "清理空目录 ${label}: $target_path（将替换为软链接）"
        run rm -rf "$target_path"
      else
        warn "跳过 ${label}: 目标已存在非空目录 ($target_path, $entry_count 项)"
        return 0
      fi
    else
      warn "跳过 ${label}: 目标已存在真实文件/目录 ($target_path)"
      return 0
    fi
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
#
# 2026-05-05 扩展：补齐开发上下文（用户原话："不损失上下文"）+ Codex 对抗审查
# 修订（CRITICAL / WARNING #1）：区分 SYMLINK_TARGETS vs COPY_TARGETS。
#
# === SYMLINK_TARGETS：软链同步（修改实时 reflect 到所有 worktree）===
# - .claude/settings.local.json    Claude Code 项目级 local settings（设计上共享）
# - .specify/.spec-driver-path     spec-driver plugin 路径解析缓存
# - .agents                        agents config（spec-driver / spectra / codex）
# - node_modules                   npm 依赖（避免每个 worktree 重 install）
# - _reference                     调研参考代码 (graphify / GitNexus / khoj 等)
# - CLAUDE.local.md                本地开发规则；开发约定按设计应跨 worktree 共享
#                                   （编辑 CLAUDE.local.md 在所有 worktree 即时生效是正期望）
SYMLINK_TARGETS=(
  ".claude/settings.local.json"
  ".specify/.spec-driver-path"
  ".agents"
  "node_modules"
  "_reference"
  "CLAUDE.local.md"
)

# === COPY_TARGETS：copy-on-checkout（每次 sync 从父仓库复制到 worktree）===
# Codex CRITICAL 修订：含 secret 的文件不能用软链（worktree 误覆盖会污染父仓库）。
# 用户在父仓库更新 .env.local 后，需要在 worktree 重跑 sync 拉取新版本。
# - .env.local                     本地 secret (API key 等)，per-worktree 独立副本
COPY_TARGETS=(
  ".env.local"
)

# === 不同步（per-worktree 独立）===
# - .claude/scheduled_tasks.lock   Codex WARNING #1 修订：lock 跨 worktree 共享有
#                                   stale/PID/TTL handling 风险，每个 worktree 独立
#                                   lock 更安全。如果未来需要全局 lock，由 lock
#                                   消费方实现 TTL + owner 校验，不通过 sync 脚本。
# - .claire/                       Claude Code 内部 worktree state，per-worktree 独立。

for relative_path in "${SYMLINK_TARGETS[@]}"; do
  link_path \
    "$PRIMARY_ROOT/$relative_path" \
    "$CURRENT_ROOT/$relative_path" \
    "$relative_path"
done

# Copy targets: 每次 sync 从父仓库 copy 到 worktree（避免软链导致写穿污染父仓库）
copy_path() {
  local source_path="$1"
  local target_path="$2"
  local label="$3"

  if [[ ! -e "$source_path" ]]; then
    log "跳过 ${label}: source 不存在 ($source_path)"
    return 0
  fi

  if [[ -L "$target_path" ]]; then
    # worktree 内之前是软链（旧 sync 脚本遗留），警告并改为 copy
    warn "${label}: 目标当前是软链，将转换为 copy（避免写穿污染父仓库）"
    run rm -f "$target_path"
  fi

  local target_dir
  target_dir="$(dirname "$target_path")"
  run mkdir -p "$target_dir"
  run cp -p "$source_path" "$target_path"
  log "$(action_word) ${label} (copy): $target_path <- $source_path"
}

for relative_path in "${COPY_TARGETS[@]}"; do
  copy_path \
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
