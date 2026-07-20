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
# - .agents/skills                 agents 本地 skills（Feature 213：由整目录 .agents 收窄为
#                                   .agents/skills 子目录，让 tracked 的 .agents/plugins/ 在
#                                   worktree 内保持为真实目录，不被 symlink 穿透污染主仓）
# - node_modules                   npm 依赖（避免每个 worktree 重 install）
# - _reference                     调研参考代码 (graphify / GitNexus / khoj 等)
# - CLAUDE.local.md                本地开发规则；开发约定按设计应跨 worktree 共享
#                                   （编辑 CLAUDE.local.md 在所有 worktree 即时生效是正期望）
SYMLINK_TARGETS=(
  ".claude/settings.local.json"
  ".specify/.spec-driver-path"
  ".agents/skills"
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

# Feature 213（A1）：旧 worktree 迁移守护。
# 收窄前的旧 worktree 仍是整目录软链 `.agents -> $PRIMARY_ROOT/.agents`。
# 若不先迁移，后续对收窄后子链 `.agents/skills` 的处理会沿父级软链解析进主仓：
#   - source 非空 → link_path 判"目标已有非空目录"跳过 → 整目录旧链存续，`.agents/plugins` 继续写穿主仓
#   - source 空/仅隐藏 → entry_count==0 分支 `rm -rf` 沿链删除主仓 `.agents/skills`（数据破坏）
# 因此在处理 `.agents/skills` 之前，必须先把整目录旧链迁移为真实目录（仅删链接本身，不触碰主仓内容）。
# 解析为物理路径（存在则 cd+pwd -P 归一化 symlink，如 macOS /var→/private/var；不存在则原样返回）
resolve_physical_path() {
  local p="$1"
  if [[ -e "$p" ]]; then
    ( cd "$p" 2>/dev/null && pwd -P ) || printf '%s' "$p"
  else
    printf '%s' "$p"
  fi
}

migrate_legacy_agents_symlink() {
  local agents_path="$CURRENT_ROOT/.agents"
  # 非 symlink（已迁移的真实目录 / 不存在）无需处理
  if [[ ! -L "$agents_path" ]]; then
    return 0
  fi
  local current_target expected_target
  current_target="$(readlink "$agents_path")"
  expected_target="$PRIMARY_ROOT/.agents"
  # 归一化后比较（防 raw 字符串因 /var↔/private/var 等 symlink 归一化差异误判为"非预期软链"）
  if [[ "$current_target" == "$expected_target" ]] \
    || [[ "$(resolve_physical_path "$current_target")" == "$(resolve_physical_path "$expected_target")" ]]; then
    log "迁移旧 .agents 整目录软链 → 真实目录（Feature 213 收窄，仅删链接本身，不触碰主仓内容）"
    run rm -- "$agents_path"
    run mkdir -p "$agents_path"
  else
    warn "检测到 .agents 是非预期软链（$agents_path -> $current_target），拒绝自动处理以免误删/写穿。"
    warn "请人工确认后手动移除该软链（rm -- \"$agents_path\"），再重跑本脚本。"
    exit 1
  fi
}

migrate_legacy_agents_symlink

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

# ─────────────────────────────────────────────────────────────
# Feature 193 — graph bootstrap（🅑 / spec FR-007~FR-009 / plan 决策 5）
# ─────────────────────────────────────────────────────────────
# 新 worktree 缺图时从主仓 copy graph.json + 增量快照，使 MCP 工具开箱即用（US1）。
#
# 关键语义（区别于上方 COPY_TARGETS 的每次覆盖）：
# - copy-if-absent 原子（Codex W4）：worktree 增量改图后绝不被 sync 重跑写穿覆盖
# - copy 单元 = specs/_meta/graph.json + .spectra/unified-graph.json 快照（决策 1b；
#   两者均在 .gitignore，属 worktree 本地态）
# - 源优先级：主仓 →（共享缓存 ~/.spectra-graph-cache 为二期）→ 均无则提示构建（不报错）
# - copy 后写 specs/_meta/.graph-source-commit sidecar（源 commit），供 stale 检查
# - 前提：id 相对化（🅐）已使图跨 worktree 可移植，copy 来即可用
GRAPH_REL="specs/_meta/graph.json"
SNAPSHOT_REL=".spectra/unified-graph.json"
SOURCE_COMMIT_REL="specs/_meta/.graph-source-commit"

# 原子 copy（仅当 target 不存在）：temp + mv，避免与 post-commit 增量竞态产生半成品。
# 通过全局 COPY_RESULT 回传结果："copied" | "skipped"（已有真实文件 / 异常类型 / 源不存在）。
# 不用返回码区分（避免 set -e 下 return 1 误触发退出，Codex W）；调用方读 COPY_RESULT。
COPY_RESULT="skipped"
copy_if_absent_atomic() {
  local source_path="$1"
  local target_path="$2"
  local label="$3"
  COPY_RESULT="skipped"

  # 已有真实文件（非 symlink）→ 跳过不覆盖（Codex W：symlink/目录不算"已有真实图"）
  if [[ -f "$target_path" && ! -L "$target_path" ]]; then
    log "graph bootstrap: 跳过 ${label}（worktree 已有真实文件，不覆盖本地增量）"
    return 0
  fi
  # symlink / 目录等异常类型 → warn，不静默当作已有，也不 bootstrap copy（人工处置）
  if [[ -L "$target_path" || -d "$target_path" ]]; then
    warn "graph bootstrap: ${label} 目标为 symlink/目录（非预期），跳过 copy，请人工检查 ${target_path}"
    return 0
  fi
  # 源不存在视为非错误（FR-008：无可用源不报错），COPY_RESULT 保持 skipped
  if [[ ! -e "$source_path" ]]; then
    log "graph bootstrap: 跳过 ${label}（源不存在: ${source_path}）"
    return 0
  fi
  local target_dir tmp
  target_dir="$(dirname "$target_path")"
  run mkdir -p "$target_dir"
  tmp="${target_path}.bootstrap.$$.tmp"
  run cp -p "$source_path" "$tmp"
  # 竞态收窄（Codex W）：mv 前再确认 target 仍不存在（post-commit/另一 sync 可能刚生成）；
  # 不用 mv -f——已确认目标不存在，避免覆盖他人刚写入的新图。
  if [[ -e "$target_path" ]]; then
    log "graph bootstrap: ${label} 期间目标已被其他进程生成，保留对方版本（清理 tmp）"
    run rm -f "$tmp"
    return 0
  fi
  run mv "$tmp" "$target_path"
  COPY_RESULT="copied"
  log "$(action_word) ${label}（bootstrap copy）: $target_path <- $source_path"
  return 0
}

# stale 检查：sidecar 记录的源 commit 与当前 worktree HEAD 不一致 → 提示，不阻断。
# sidecar 缺失（图为本地构建非 bootstrap）→ no-op。
check_graph_source_stale() {
  local sidecar="$CURRENT_ROOT/$SOURCE_COMMIT_REL"
  [[ -f "$sidecar" ]] || return 0
  local recorded current
  recorded="$(cat "$sidecar" 2>/dev/null || true)"
  current="$(git -C "$CURRENT_ROOT" rev-parse HEAD 2>/dev/null || true)"
  if [[ -n "$recorded" && -n "$current" && "$recorded" != "$current" ]]; then
    warn "graph 可能 stale：图来自 commit ${recorded:0:8}，当前 worktree 在 ${current:0:8}。建议增量更新（spectra watch / spectra install --git）或重建（spectra batch）。"
  fi
  return 0
}

bootstrap_graph() {
  local graph_target="$CURRENT_ROOT/$GRAPH_REL"
  local snapshot_target="$CURRENT_ROOT/$SNAPSHOT_REL"

  # graph 与 snapshot 各自独立 copy-if-absent（Codex W：已有 graph 时仍补齐缺失 snapshot，
  # 避免"只有 graph 无 snapshot"的 worktree 永久退化 full reindex）。
  # MVP 源 = 主仓（共享缓存 ~/.spectra-graph-cache 为二期，见 plan 决策 5）。
  copy_if_absent_atomic "$PRIMARY_ROOT/$GRAPH_REL" "$graph_target" "graph.json"
  local graph_copied="$COPY_RESULT"
  copy_if_absent_atomic "$PRIMARY_ROOT/$SNAPSHOT_REL" "$snapshot_target" "unified-graph 快照"
  if [[ ! -e "$snapshot_target" ]]; then
    log "graph bootstrap: 无快照（首次 commit 将走 full reindex，非阻塞）"
  fi

  # 既无 worktree 本地图、也未从主仓 copy 到 → 提示构建（FR-008，不报错）
  if [[ ! -e "$graph_target" ]]; then
    log "graph bootstrap: 主仓与 worktree 均无图（${PRIMARY_ROOT}/${GRAPH_REL}）。请在当前 worktree 运行 \`spectra batch\` 或 \`spectra index\` 构建图。"
    return 0
  fi

  # 仅当本次确实从主仓 copy 了图，才写/更新 sidecar（记录源=主仓 HEAD）；
  # 本地构建的图无"源 commit"概念，不写 sidecar（stale 检查对其 no-op）。
  if [[ "$graph_copied" == "copied" ]]; then
    local src_commit
    if src_commit="$(git -C "$PRIMARY_ROOT" rev-parse HEAD 2>/dev/null)"; then
      if [[ "$DRY_RUN" == "true" ]]; then
        log "graph bootstrap: [dry-run] 计划记录源 commit ${src_commit:0:8} → $SOURCE_COMMIT_REL"
      else
        printf '%s\n' "$src_commit" > "$CURRENT_ROOT/$SOURCE_COMMIT_REL"
        log "graph bootstrap: 记录源 commit ${src_commit:0:8} → $SOURCE_COMMIT_REL"
      fi
    fi
  fi

  # stale 检查：首次 bootstrap 与 rerun 都查（Codex CRITICAL：新 worktree HEAD 若已 ≠ 源 commit，
  # 首次 copy 后也须立即提示，不静默拿 stale 图）。
  check_graph_source_stale
  return 0
}

bootstrap_graph

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
