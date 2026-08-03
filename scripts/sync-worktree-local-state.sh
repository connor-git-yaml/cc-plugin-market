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
# Feature 239 FR-010：仅 Codex-managed worktree 场景需要"图既没得 copy 也不存在时尝试本地构建"，
# 手工 worktree（hook 无 flag 调用）不应默认触发自动构建。
ATTEMPT_BUILD="false"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GRAPH_STATUS_HELPER="$SCRIPT_DIR/lib/graph-bootstrap-status.mjs"

# C1：把 spectra 解析成**绝对路径**再交给 node helper。
# 裸命令名会随子进程 PATH 变化而失效——Volta 等 shim 型版本管理器在启动 Node 时会把自身
# shim 目录从子进程 PATH 中移除，于是 shell 里 `command -v spectra` 成功、helper 里
# spawn("spectra") 却拿 ENOENT，freshness 永远降级、--attempt-build 永远失败。
# 解析不到时留空，helper 侧回落到裸名（保持"没装 CLI"这一真实降级路径）。
SPECTRA_BIN="$(command -v spectra 2>/dev/null || true)"

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN="true"
      ;;
    --quiet)
      QUIET="true"
      ;;
    --attempt-build)
      ATTEMPT_BUILD="true"
      ;;
    --help|-h)
      cat <<'USAGE'
用法:
  bash scripts/sync-worktree-local-state.sh [--dry-run] [--quiet] [--attempt-build]

说明:
  将主工作区的关键本地态以软链接方式同步到当前 worktree。

选项:
  --attempt-build   图既无法从主仓 copy、worktree 自身也没有时，尝试本地构建
                    （spectra batch --mode graph-only），失败不阻断。
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

# ─────────────────────────────────────────────────────────────
# Feature 239 — .worktreeinclude 清单解析（plan 决策 4）
# ─────────────────────────────────────────────────────────────
# 本函数与 scripts/lib/worktree-local-state-core.mjs::parseWorktreeInclude 是同一份 grammar 的
# 两套独立实现，任何改动必须两侧同步；tests/unit/worktreeinclude-golden-matrix.test.ts 用同一份
# golden 字节 fixture 驱动两侧并逐字节对拍，防止"同一清单被读出不同条目集合"的静默漂移。
#
# grammar 五条：
#   1. 文件首只剥一次 UTF-8 BOM
#   2. 每行剥单个尾部 \r（兼容 CRLF；仓库无 .gitattributes 强制 LF，CRLF 是真实风险面）
#   3. 不做其他任何 trim（含空格的条目按字面处理，由 validate_entry 自然拒绝）
#   4. `#` 仅当是行首第一个字符时才是整行注释；行内 `#` 按字面处理
#   5. 末行无换行符必须被接受——`|| [[ -n "$line" ]]` 不可省略，缺了会静默吞掉末行
read_worktreeinclude_entries() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return 0
  fi

  local line
  local is_first_line="true"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$is_first_line" == "true" ]]; then
      is_first_line="false"
      line="${line#$'\xEF\xBB\xBF'}"
    fi
    line="${line%$'\r'}"
    if [[ -z "$line" ]]; then
      continue
    fi
    if [[ "${line:0:1}" == "#" ]]; then
      continue
    fi
    printf '%s\n' "$line"
  done < "$file"
}

# 解析探针入口：仅供 golden-matrix 测试驱动 bash 侧解析器，不参与生产流程。
# 必须落在任何 git 命令之前——测试在非 git 临时目录内运行，且探针不得产生任何文件系统副作用。
if [[ -n "${WORKTREEINCLUDE_PROBE_FILE:-}" ]]; then
  read_worktreeinclude_entries "$WORKTREEINCLUDE_PROBE_FILE"
  exit 0
fi

# ─────────────────────────────────────────────────────────────
# Feature 239 — 发布原语（C11）
# ─────────────────────────────────────────────────────────────
# 只承载"最终发布指令本身"这一件事，**不含** copy_if_absent_atomic 里的 `-e` 二次预检查
# （那是调用方的竞态收窄优化与日志载体）。职责这样切分，测试才能直调本原语验证其排他性，
# 而不会命中调用方的预检查分支得到假绿。
#
# 返回 0 = 本进程赢得发布；返回 1 = 对方已发布，保留对方版本。
# 定义前置到探针区：本原语不依赖 CURRENT_ROOT/PRIMARY_ROOT，前置后测试可在不触发主流程的
# 前提下直调它（探针分支见下）。
publish_exclusive() {
  local tmp="$1"
  local target_path="$2"

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[dry-run] ln $tmp $target_path"
    return 0
  fi

  # 发布前先判 symlink：BSD/GNU `ln` 在 target 是"指向目录的 symlink"时可能跟随它，
  # 从而在**外部目录**里建立硬链接。symlink 目标一律视为"已有他方产物"，不覆盖不跟随。
  if [[ -L "$target_path" ]]; then
    log "graph bootstrap: 目标是 symlink（非预期），保留原样不发布（清理 tmp）"
    rm -f "$tmp"
    return 1
  fi

  # `ln` 的"目标已存在则失败"是内核级原子操作：并发的两个进程只有一个能建立到 target 的
  # 硬链接，另一个必拿 EEXIST。此前的"检查 target 不存在 → mv"存在 TOCTOU 窗口，两个进程
  # 可以都通过检查，随后各自 mv 互相覆盖（后执行者赢，静默丢弃先到达的版本）。
  local ln_error
  if ln_error="$(ln "$tmp" "$target_path" 2>&1)"; then
    rm -f "$tmp"
    return 0
  fi

  # W1：ln 失败有两类完全不同的含义，不能共用一句"对方已发布"。
  # 只有"失败后 target 确实存在"才是并发竞争（EEXIST）；否则是 EXDEV/EACCES/EROFS 等
  # 真实错误——把它们说成"保留对方版本"会让一次真实的发布失败被当成正常降级咽下去。
  if [[ -e "$target_path" || -L "$target_path" ]]; then
    log "graph bootstrap: 目标已被其他进程发布，保留对方版本（清理 tmp）"
    rm -f "$tmp"
    return 1
  fi

  warn "graph bootstrap: 发布失败（target 仍不存在，非并发竞争）：${ln_error}"
  rm -f "$tmp"
  return 1
}

# 发布原语探针：PUBLISH_EXCLUSIVE_PROBE="<tmp>|<target>"，直调原语后立即退出，不进主流程。
if [[ -n "${PUBLISH_EXCLUSIVE_PROBE:-}" ]]; then
  probe_publish_tmp="${PUBLISH_EXCLUSIVE_PROBE%%|*}"
  probe_publish_target="${PUBLISH_EXCLUSIVE_PROBE#*|}"
  publish_exclusive "$probe_publish_tmp" "$probe_publish_target" || true
  exit 0
fi

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

# === copy 类清单：copy-on-checkout（每次 sync 从父仓库复制到 worktree）===
# Codex CRITICAL 修订：含 secret 的文件不能用软链（worktree 误覆盖会污染父仓库）。
# 用户在父仓库更新 .env.local 后，需要在 worktree 重跑 sync 拉取新版本。
#
# Feature 239：清单由硬编码数组外化为仓库根 `.worktreeinclude`（单一事实源，Codex 桌面应用
# 与本脚本双消费）。条目在 copy 之前必须逐条通过 validate_entry 的 containment 校验。
WORKTREEINCLUDE_REL=".worktreeinclude"

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

  # Feature 239：可观察探针。测试据此断言"非法条目从未走到 copy_path"——只有把调用事实
  # 记在函数入口（早于 source 存在性检查），才能区分"被 containment 拦截"与"仅因 source
  # 不存在而跳过"这两种在日志上难以分辨的情形。
  if [[ -n "${PROBE_LOG:-}" ]]; then
    printf 'copy_path called: %s -> %s\n' "$source_path" "$target_path" >> "$PROBE_LOG"
  fi

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

# ─────────────────────────────────────────────────────────────
# Feature 239 — containment 校验（FR-003/FR-011）
# ─────────────────────────────────────────────────────────────
# 输出格式固定为 `[containment] <reason-code>: <entry>`，供测试精确匹配。
# 不复用 warn()：containment 是安全相关拒绝，即便 --quiet 也必须可见；且宽泛的
# "跳过/警告"文案无法与"仅因 source 不存在而跳过"区分，起不到证伪作用。
containment_reject() {
  echo "[containment] $1: $2" >&2
}

# 非 git 环境（批 4 沙箱）无法执行 check-ignore，该子检查降级为 skip 而非把条目判红。
GIT_IGNORE_PROBE=""
git_ignore_check_available() {
  if [[ -z "$GIT_IGNORE_PROBE" ]]; then
    local inside
    inside="$(git -C "$CURRENT_ROOT" rev-parse --is-inside-work-tree 2>/dev/null || true)"
    if [[ "$inside" == "true" ]]; then
      GIT_IGNORE_PROBE="true"
    else
      GIT_IGNORE_PROBE="false"
      log "containment: 非 git 环境，not-ignored 子检查跳过"
    fi
  fi
  [[ "$GIT_IGNORE_PROBE" == "true" ]]
}

# 8 类拒绝 + 1 类合法通过。判定顺序与 scripts/lib/worktree-local-state-core.mjs 的
# SYNTAX_RULES 严格一致：语法类整体优先于存在性/ignored 类，其中 trailing-slash 必须
# 在任何存在性检查之前拒绝——`.env.local/` 能通过 check-ignore，且尾斜杠会让存在性检查
# 解析到目录本身从而绕过 not-regular-file 判定。
# 在 root 下逐段下降，任一**已存在**路径组件（含最终对象）是 symlink 即返回 0。
#
# 为什么必须逐组件判：`[[ -f path ]]` 与 lstat 都只对最终对象免解引用，中间组件仍会被解析。
# 仓库里的 `_reference` 就是指向主工作区的目录软链——`_reference/x/y.env` 在旧实现下
# `[[ -f ]]` 为真，于是一条物理上位于仓库外的路径被当作合法条目 copy。
# mode=all（默认）连最终对象一起判；mode=parents-only 只判父目录组件。
#
# 为什么 target 侧只判父目录：`copy_path` 对"目标本身是 symlink"有既有的安全处置——
# `rm -f` 删的是**链接自身**（绝不写穿），随后 cp 出一个真实文件。这正是 F213 起就被测试
# 守护的"遗留 .env.local 软链迁移为 copy"路径。而父目录是 symlink 时没有这层保护，
# copy 会直接写到 worktree 外，必须拒绝。
has_symlink_component() {
  local root="$1"
  local remaining="$2"
  local mode="${3:-all}"
  local current="$root"
  local component

  while [[ -n "$remaining" ]]; do
    component="${remaining%%/*}"
    if [[ "$component" == "$remaining" ]]; then
      remaining=""
    else
      remaining="${remaining#*/}"
    fi
    if [[ -z "$component" ]]; then
      continue
    fi
    current="$current/$component"
    if [[ "$mode" == "parents-only" && -z "$remaining" ]]; then
      return 1
    fi
    if [[ -L "$current" ]]; then
      return 0
    fi
    if [[ ! -e "$current" ]]; then
      # 该组件不存在 → 更深的组件也不可能存在
      return 1
    fi
  done

  return 1
}

validate_entry() {
  local entry="$1"

  case "$entry" in
    /*) containment_reject "absolute-path" "$entry"; return 1 ;;
    '!'*) containment_reject "negation-prefix" "$entry"; return 1 ;;
    *\\*) containment_reject "escape-char" "$entry"; return 1 ;;
    *'*'*|*'?'*|*'['*|*']'*) containment_reject "glob-char" "$entry"; return 1 ;;
    */) containment_reject "trailing-slash" "$entry"; return 1 ;;
  esac

  case "/$entry/" in
    */../*) containment_reject "dot-dot-segment" "$entry"; return 1 ;;
  esac

  if git_ignore_check_available; then
    local ignore_status=0
    git -C "$CURRENT_ROOT" check-ignore --quiet -- "$entry" || ignore_status=$?
    # 0 = 已忽略（唯一通过态）；1 = 明确未忽略；其余（128 等）= git 无法判定。
    # 128 不再放行：`git check-ignore -- <穿过 symlink 的路径>` 正是返回
    # `fatal: beyond a symbolic link` + 128，旧实现把它当"无法判定→不拒绝"，
    # 于是一条逃逸到仓库外的路径同时绕过了 ignored 前提与词法过滤。
    if [[ "$ignore_status" == "1" ]]; then
      containment_reject "not-ignored" "$entry"
      return 1
    fi
    if [[ "$ignore_status" != "0" ]]; then
      containment_reject "check-ignore-error" "$entry"
      return 1
    fi
  fi

  # 物理 containment：source 侧连最终对象一起查（symlink source 会读穿到仓库外）；
  # target 侧只查父目录（最终对象是 symlink 时由 copy_path 安全地删链接再写真实文件）。
  if has_symlink_component "$PRIMARY_ROOT" "$entry" "all"; then
    containment_reject "symlink-component" "$entry"
    return 1
  fi
  if has_symlink_component "$CURRENT_ROOT" "$entry" "parents-only"; then
    containment_reject "symlink-component" "$entry"
    return 1
  fi

  # FR-001(c)：路径存在时必须是常规文件；不存在不违规（干净 checkout 里 ignored 文件缺席是常态）
  local source_path="$PRIMARY_ROOT/$entry"
  if [[ -e "$source_path" && ! -f "$source_path" ]]; then
    containment_reject "not-regular-file" "$entry"
    return 1
  fi

  return 0
}

# 动态读取 `.worktreeinclude` 并逐条 copy；校验失败的条目仅 skip，不中断其余同步步骤。
copy_worktreeinclude_targets() {
  local manifest="$CURRENT_ROOT/$WORKTREEINCLUDE_REL"

  if [[ ! -f "$manifest" ]]; then
    # 变量必须用 ${} 包裹：紧跟其后的全角括号会被 bash 当作变量名的一部分，
    # 在 set -u 下直接报"未绑定的变量"并以 1 退出（沿用本脚本既有 ${label} 写法）。
    warn "未找到 .worktreeinclude（${manifest}），本次跳过全部 copy 类同步；其余步骤继续。"
    return 0
  fi

  local entry
  while IFS= read -r entry; do
    if validate_entry "$entry"; then
      copy_path "$PRIMARY_ROOT/$entry" "$CURRENT_ROOT/$entry" "$entry"
    fi
  done < <(read_worktreeinclude_entries "$manifest")
}

copy_worktreeinclude_targets

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
# - 前提：id 相对化（🅐）已使图跨 worktree 可移植，copy 来即可用
#
# Feature 239 变更：F193 的 specs/_meta/.graph-source-commit sidecar 被**完全移除**（写入逻辑
# 删除 + 遗留文件迁移性删除）。sidecar 只在"本次确实 copy 了图"时才写、记的还是主仓 HEAD，
# 本地重建路径下 provenance 必然失准；改由 graph-bootstrap-status.mjs 读图内嵌
# `graph.sourceCommit` 现算 freshness，并把 bootstrap 时刻的 provenance 落进结构化状态文件。
GRAPH_REL="specs/_meta/graph.json"
SNAPSHOT_REL=".spectra/unified-graph.json"

# 生产路径需要 node 可执行；缺失时全部 node 相关步骤跳过并 warn，其余同步照常完成。
# 不加这层守卫的话，set -euo pipefail 会让一次 `node: command not found`（127）直接中断整条 sync。
node_available() {
  command -v node >/dev/null 2>&1
}

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
  # 最终发布交给 publish_exclusive 原语（定义在文件前部的探针区）
  if publish_exclusive "$tmp" "$target_path"; then
    COPY_RESULT="copied"
    log "$(action_word) ${label}（bootstrap copy）: $target_path <- $source_path"
  fi
  return 0
}

# freshness 检查（取代 F193 的 sidecar 比对）：委托 graph-bootstrap-status.mjs 现算。
#
# 判定实现只有一份——编译进全局 spectra CLI 的那份 F217 实现；本脚本既不缓存 stale 布尔值，
# 也不自己比较 commit。四态映射：stale / unknown-provenance → warn；fresh / dirty → 静默
# （提交前工作树几乎必然 dirty，对 dirty 告警会让每次正常流程都产生噪音）。
check_graph_freshness() {
  local graph_target="$CURRENT_ROOT/$GRAPH_REL"
  [[ -f "$graph_target" ]] || return 0

  if ! node_available; then
    warn "freshness 检查跳过：node 不可用"
    return 0
  fi

  local -a freshness_args=(check-freshness --project-root "$CURRENT_ROOT" --graph "$graph_target")
  if [[ -n "$SPECTRA_BIN" ]]; then
    freshness_args+=(--spectra-bin "$SPECTRA_BIN")
  fi

  local verdict state reason diagnostic
  verdict="$(node "$GRAPH_STATUS_HELPER" "${freshness_args[@]}" 2>/dev/null || true)"
  state="$(printf '%s' "$verdict" | sed -n 's/.*"state":"\([^"]*\)".*/\1/p')"
  reason="$(printf '%s' "$verdict" | sed -n 's/.*"reason":"\([^"]*\)".*/\1/p')"
  # F249 W-001：stale 诊断文案由 helper 侧按 staleReasons 现算并整串回传，本脚本**不自行拼装原因**。
  # 旧写法在这里硬编码"sourceCommit 与 HEAD 不一致"，于是三类指纹型 stale 全被渲染成 commit 型
  # 诊断，人照提示去查 commit 反而被误导。helper 契约保证该串不含引号/反引号/$（可安全内插）。
  diagnostic="$(printf '%s' "$verdict" | sed -n 's/.*"freshnessDiagnostic":"\([^"]*\)".*/\1/p')"

  case "$state" in
    fresh|dirty)
      : # 图与工作树一致（dirty 刻意不告警：提交前工作树几乎必然 dirty）
      ;;
    stale)
      # 兜底：字段缺席（旧版本 helper / 提取失败）时仍必须告警 stale，只是没有原因明细
      if [[ -n "$diagnostic" ]]; then
        warn "$diagnostic"
      else
        warn "graph 可能 stale：判定器未回传原因明细，请手动运行 spectra graph-quality --json 查看 staleReasons。"
      fi
      ;;
    unknown-provenance)
      warn "graph provenance 不明（unknown-provenance${reason:+, reason=$reason}）：无法确认图的来源 commit，建议重建（spectra batch）后再依赖其结论。"
      ;;
    *)
      # W2：默认分支不再静默。helper 崩溃（空输出）或返回枚举外的 state 都必须可见，
      # 否则"判定链路坏了"会伪装成"图很健康"。
      warn "graph freshness 判定不可用（unknown-provenance）：收到非预期结果 state='${state:-<空>}'，请手动运行 \`spectra graph-quality --json\` 核实。"
      ;;
  esac
  return 0
}

bootstrap_graph() {
  local graph_target="$CURRENT_ROOT/$GRAPH_REL"
  local snapshot_target="$CURRENT_ROOT/$SNAPSHOT_REL"

  # graph 与 snapshot 各自独立 copy-if-absent（Codex W：已有 graph 时仍补齐缺失 snapshot，
  # 避免"只有 graph 无 snapshot"的 worktree 永久退化 full reindex）。
  # MVP 源 = 主仓（共享缓存 ~/.spectra-graph-cache 为二期，见 plan 决策 5）。
  # 四事实追踪（Feature 239 C4）：状态机只依据"本次确实发生了什么"判定 provenance，
  # 不从"图当前存在"反推来源。snapshot 的 copy 事实**永不**参与 graph 来源判定。
  copy_if_absent_atomic "$PRIMARY_ROOT/$GRAPH_REL" "$graph_target" "graph.json"
  local graph_copied="false"
  if [[ "$COPY_RESULT" == "copied" ]]; then graph_copied="true"; fi

  copy_if_absent_atomic "$PRIMARY_ROOT/$SNAPSHOT_REL" "$snapshot_target" "unified-graph 快照"
  local snapshot_copied="false"
  if [[ "$COPY_RESULT" == "copied" ]]; then snapshot_copied="true"; fi

  if [[ ! -e "$snapshot_target" ]]; then
    log "graph bootstrap: 无快照（首次 commit 将走 full reindex，非阻塞）"
  fi

  # 本地构建兜底（FR-010）：仅 --attempt-build 且图既没 copy 到、自身也不存在时触发
  local build_attempted="false"
  local build_succeeded="false"
  if [[ "$ATTEMPT_BUILD" == "true" && "$graph_copied" != "true" && ! -e "$graph_target" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      # C3：dry-run 绝不 spawn 真实构建。此前 dry-run 只作用于状态写入，构建分支没查
      # DRY_RUN，于是一次"预演"会真的跑起 `spectra batch` 并写出图——dry-run 的基本契约破裂。
      log "[dry-run] 拟执行本地构建：spectra batch --mode graph-only（本次不执行）"
    elif node_available; then
      build_attempted="true"
      log "graph bootstrap: 尝试本地构建（spectra batch --mode graph-only）"
      local -a build_args=(attempt-build --project-root "$CURRENT_ROOT")
      if [[ -n "$SPECTRA_BIN" ]]; then
        build_args+=(--spectra-bin "$SPECTRA_BIN")
      fi
      if node "$GRAPH_STATUS_HELPER" "${build_args[@]}"; then
        build_succeeded="true"
      else
        warn "graph bootstrap: 本地构建未成功（不阻断）"
      fi
    else
      warn "本地构建跳过：node 不可用"
    fi
  fi

  # 既无 worktree 本地图、也未从主仓 copy 到、本地构建也没产出 → 提示构建（FR-008，不报错）
  if [[ ! -e "$graph_target" ]]; then
    log "graph bootstrap: 主仓与 worktree 均无图（${PRIMARY_ROOT}/${GRAPH_REL}）。请在当前 worktree 运行 \`spectra batch\` 或 \`spectra index\` 构建图。"
  fi

  # 状态文件：无论走到哪条分支都要写——"图不存在"本身也是必须被记录的 provenance 事实
  # （bootstrapSource=none + assessable=false），否则下游无从区分"没图"与"没记录"。
  if node_available; then
    local -a status_args=(
      write-status
      --project-root "$CURRENT_ROOT"
      --graph-copied "$graph_copied"
      --snapshot-copied "$snapshot_copied"
      --build-attempted "$build_attempted"
      --build-succeeded "$build_succeeded"
    )
    if [[ "$DRY_RUN" == "true" ]]; then
      status_args+=(--dry-run)
    fi
    if ! node "$GRAPH_STATUS_HELPER" "${status_args[@]}"; then
      warn "graph bootstrap: 状态文件写入失败（不阻断）"
    fi
  else
    warn "状态文件写入跳过：node 不可用"
  fi

  # freshness：首次 bootstrap 与 rerun 都查（Codex CRITICAL：新 worktree HEAD 若已 ≠ 图的
  # 来源 commit，首次 copy 后也须立即提示，不静默拿 stale 图）。
  check_graph_freshness
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
