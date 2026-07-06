#!/usr/bin/env bash
# Spec Driver - ignore 自举共享库（Feature 207）
# 由 init-project.sh 与 postinstall.sh 共同 source。
# 职责：确保 Spec Driver 落盘产物的 4 条 ignore 规则就位，避免脚手架与本机绝对路径
#       污染宿主 repo 的 git diff / 交付 patch。提供两个入口：
#         - ensure_spec_driver_gitignore    → 写宿主 <project_root>/.gitignore（团队共享）
#         - ensure_spec_driver_git_exclude  → 写 <project_root>/.git/info/exclude（非 tracked，零 diff）
#       两者共享内部注入实现 _spec_driver_inject_entries，行为契约一致（幂等、CRLF/NUL/symlink/
#       negation 防御、mkdir 原子锁保护并发）。
#
# 注意：本文件只定义函数，不含 set -e / 顶层执行逻辑，避免被 source 时影响调用方主流程。
#       函数内所有写入均显式检查返回值，不依赖 trap EXIT（避免污染被 source 进
#       set -euo pipefail 调用方的退出钩子）。

# Spec Driver 落盘产物的固定 4 条 ignore 条目（与开发仓库 .gitignore 一致，顺序即注入顺序）：
#   .specify/.spec-driver-path  — 机器绝对路径（隐私 / 可移植）
#   .specify/runs/              — 本地运行态
#   .specify/scorecards/        — 插件默认品复制，可再生
#   .specify/templates/         — 插件默认品复制，可再生
# 写死为字面量作为唯一事实来源，不从外部读取，避免引入新的路径依赖。
SPEC_DRIVER_GITIGNORE_ENTRIES=(
  ".specify/.spec-driver-path"
  ".specify/runs/"
  ".specify/scorecards/"
  ".specify/templates/"
)

# ── 并发取舍说明（W1 修复，Codex 四轮）─────────────────────────────────────
# 本库刻意**不做 stale 锁抢占**：曾有的 mtime 阈值 + rmdir 重试逻辑存在 ABA 竞态——
# 预置过期锁 + 高并发时，多个进程会同判 stale、rmdir 互删对方刚建的新锁，导致多个进程
# 同时进入临界区重复注入。故抢锁失败一律直接 skipped:0。
# 残余风险：进程在临界区内被 SIGKILL → 孤儿锁使该 repo 永久 skip 注入。此风险经权衡接受：
#   (1) 临界区为毫秒级窗口，命中概率极低；
#   (2) 孤儿锁只造成静默跳过（主流程零影响，下次会话无法自愈但不报错），
#       危害远小于 ABA 重复写入把用户 .gitignore 堆出重复行。
# ─────────────────────────────────────────────────────────────────────────

# _spec_driver_has_nul <file>
# 检测文件是否含 NUL 字节（0x00）。含 NUL 的文件不是合法文本，装载为 shell 变量会截断，
# 无法可靠做整行匹配 → 一律拒写。跨平台实现：比较原始字节数与去除 NUL 后的字节数。
# 返回 0（真）表示含 NUL，返回 1（假）表示不含或读取失败。
_spec_driver_has_nul() {
  local file="$1"
  local raw stripped
  raw="$(wc -c < "$file" 2>/dev/null)" || return 1
  # LC_ALL=C 确保 tr 按字节而非多字节字符处理；去掉所有 NUL 后再计字节数
  stripped="$(LC_ALL=C tr -d '\000' < "$file" 2>/dev/null | wc -c)" || return 1
  # 归一化空白（wc 输出可能带前导空格）
  raw="${raw//[[:space:]]/}"
  stripped="${stripped//[[:space:]]/}"
  [[ "$raw" != "$stripped" ]]
}

# _spec_driver_inject_entries <target_file> <with_header>
#
# 向 <target_file> 注入 SPEC_DRIVER_GITIGNORE_ENTRIES 中缺失的条目（幂等）。
# 调用方须在持锁状态下调用；本函数不负责加锁/解锁（由入口函数统一管理）。
#
# 参数：
#   target_file  - 目标 ignore 文件绝对路径（.gitignore 或 .git/info/exclude）
#   with_header  - "1" 表示新建文件时写注释头；"0" 表示不写（exclude 场景不带头）
#
# 行为契约：
#   - target_file 为 symlink（含 dangling）→ 一律不写，stdout: failed:0
#     （-L 检测必须先于 -f 分支：dangling symlink 时 [[ ! -f ]] 为真会走创建分支，
#      `>` 重定向会跟随 symlink 在 symlink 指向的外部路径创建文件——安全隐患）
#   - target_file 含 NUL 字节 → 拒写，stdout: failed:0（文件不被改动）
#   - target_file 不存在 → 创建（with_header=1 时带注释头 + 4 行条目），stdout: created:N
#   - target_file 存在但缺条目 → 精确整行匹配缺失项追加到末尾，stdout: appended:N
#   - target_file 存在且 4 条全就位 → 不写文件（mtime 不变），stdout: ready:0
#   - negation 尊重：归一化视图中若存在以 '!' 开头、去掉 '!' 后等于该条目或以该条目为
#     前缀的行（如 !.specify/templates/ 或 !.specify/templates/**），该条目跳过不追加
#     （尊重用户显式 un-ignore 意图），跳过条目不计入 appended:N
#   - 匹配采用 CRLF 归一化视图（tr -d '\r'）：CRLF 行尾文件不被误判为缺失而重复追加；
#     但不改写原文件行尾
#   - 写入失败（只读 FS 等）→ stdout: failed:0
#   - 始终 return 0
_spec_driver_inject_entries() {
  local target_file="$1"
  local with_header="$2"

  # symlink 防御（含 dangling）：必须先于 -f 分支判断
  if [[ -L "$target_file" ]]; then
    printf 'failed:0\n'
    return 0
  fi

  # NUL 防御：仅对已存在的普通文件检测（不存在时无从检测，创建分支会写纯文本）
  if [[ -f "$target_file" ]] && _spec_driver_has_nul "$target_file"; then
    printf 'failed:0\n'
    return 0
  fi

  # 场景 1：文件不存在 → 创建新文件，stdout: created:N
  if [[ ! -f "$target_file" ]]; then
    # 关键 bash 地雷（W-A 修复）：绝不用「复合命令组 { …; } > file」形式写入。
    #   1. 命令组的重定向失败退出码在 `if ! { …; } > file` 形式下会被吞掉——
    #      直接跑 rc=1，但 `if !` 包裹时不进 then 分支 → failed 分支永不触发 →
    #      落到 created:N 误报（.git/info 被普通文件占用时 `> exclude` 必然失败）。
    #   2. `> file 2>/dev/null` 中 stdout 重定向失败发生在 `2>/dev/null` 生效之前 →
    #      "Not a directory" 等 stderr 泄漏。
    # 正解：内容先攒进变量，再用「简单命令」写入，且把 `2>/dev/null` 置于 `>` 之前
    # 先吞 stderr。简单命令的 `if !` 重定向失败已实测能被捕获（bash 3.2 与 5.x 一致）。
    local content=""
    if [[ "$with_header" == "1" ]]; then
      content="# Spec Driver 本地缓存与运行态（自动注入，可手动调整顺序）"$'\n'
    fi
    local entry
    for entry in "${SPEC_DRIVER_GITIGNORE_ENTRIES[@]}"; do
      content+="${entry}"$'\n'
    done
    if ! printf '%s' "$content" 2>/dev/null > "$target_file"; then
      printf 'failed:0\n'
      return 0
    fi
    printf 'created:%d\n' "${#SPEC_DRIVER_GITIGNORE_ENTRIES[@]}"
    return 0
  fi

  # 场景 2/3：文件已存在 → 逐条精确整行匹配（CRLF 归一化视图），收集缺失项
  # tr -d '\r' 剥离视图内的 CR，使 CRLF 行尾文件不被误判为缺失；不改写原文件。
  local normalized_view
  normalized_view="$(tr -d '\r' < "$target_file" 2>/dev/null)" || normalized_view=""
  local missing=()
  local entry
  for entry in "${SPEC_DRIVER_GITIGNORE_ENTRIES[@]}"; do
    # -F 纯字符串、-x 整行匹配：避免 .specify/runs/ 被 .specify/runs/xxx 宽松误判为已存在
    # 用 here-string 而非管道喂 grep：调用方多为 set -o pipefail，大文件（>64KB pipe buffer）
    # 且目标条目在文件前部时，grep -q 匹配即退会令 printf 写端收 SIGPIPE，管道退出码 141
    # 被 pipefail 放大成整体失败 → 已存在条目被误判缺失而重复追加。here-string 无管道，规避此问题。
    if grep -qxF -- "$entry" <<< "$normalized_view"; then
      continue
    fi
    # negation 冲突检测：用户显式 un-ignore（! 前缀）时尊重其意图，跳过该条目。
    # 匹配 !<entry> 精确等，或 !<entry>* 前缀形式（如 !.specify/templates/**）。
    if _spec_driver_has_negation "$normalized_view" "$entry"; then
      continue
    fi
    missing+=("$entry")
  done

  # 全部就位（或被 negation 尊重跳过）→ 不触碰文件（幂等契约：mtime 不变），stdout: ready:0
  if [[ ${#missing[@]} -eq 0 ]]; then
    printf 'ready:0\n'
    return 0
  fi

  # 部分缺失 → 追加缺失条目到文件末尾（不带注释头，追加场景保持幂等最简）
  # 末尾无换行边界：若最后一个字节非换行符，先补一个 \n 再追加，避免与最后一行粘连
  if [[ -s "$target_file" ]]; then
    local last_char
    last_char="$(tail -c 1 "$target_file" 2>/dev/null)"
    if [[ -n "$last_char" ]]; then
      # 2>/dev/null 置于 >> 之前先吞 stderr（同 W-A：避免重定向失败时 "Not a directory" 泄漏）
      if ! printf '\n' 2>/dev/null >> "$target_file"; then
        printf 'failed:0\n'
        return 0
      fi
    fi
  fi

  for entry in "${missing[@]}"; do
    # 同上：2>/dev/null 前置于 >>，消除 stderr 泄漏
    if ! printf '%s\n' "$entry" 2>/dev/null >> "$target_file"; then
      printf 'failed:0\n'
      return 0
    fi
  done

  printf 'appended:%d\n' "${#missing[@]}"
  return 0
}

# _spec_driver_has_negation <normalized_view> <entry>
# 判断归一化视图中是否存在尊重该条目的 negation 行（以 '!' 开头）。
# 命中形式：!<entry>（精确）或 !<entry> 后接任意字符（前缀，如 !.specify/templates/**）。
# 返回 0（真）表示存在 negation，返回 1（假）表示不存在。
_spec_driver_has_negation() {
  local view="$1"
  local entry="$2"
  local line stripped
  while IFS= read -r line; do
    [[ "$line" == '!'* ]] || continue
    stripped="${line#!}"
    # 精确等 或 以 entry 为前缀（覆盖 !<entry> / !<entry>** / !<entry>foo）
    if [[ "$stripped" == "$entry" || "$stripped" == "$entry"* ]]; then
      return 0
    fi
  done <<< "$view"
  return 1
}

# _spec_driver_acquire_lock <lock_dir>
# 尝试获取 mkdir 原子锁。成功返回 0；失败（已被占用）返回 1。
# 不做 stale 抢占（见文件顶部并发取舍说明）。
_spec_driver_acquire_lock() {
  mkdir "$1" 2>/dev/null
}

# ensure_spec_driver_gitignore <project_root>
#
# 写宿主 <project_root>/.gitignore（团队共享的 ignore 配置）。
# 行为契约见 plan.md §1.1：
#   - 三态输出 created:N / appended:N / ready:0 / failed:0 / skipped:0
#   - symlink / NUL / negation 防御见 _spec_driver_inject_entries
#   - 非 git 目录也照常写入（用户后续 git init 即生效）
#   - 并发：mkdir 原子锁保护临界区；抢锁失败 → skipped:0（不 stale 抢占）
#   - 始终 return 0；仅 project_root 为空或非目录时 return 1
ensure_spec_driver_gitignore() {
  local project_root="$1"
  if [[ -z "$project_root" || ! -d "$project_root" ]]; then
    return 1
  fi

  local gitignore_file="${project_root}/.gitignore"
  local lock_dir="${project_root}/.specify/.ensure-gitignore.lock"

  # 锁父路径 .specify/ 兜底创建（.specify/ 是 Spec Driver 自身域，不越界）
  mkdir -p "${project_root}/.specify" 2>/dev/null || true

  if ! _spec_driver_acquire_lock "$lock_dir"; then
    printf 'skipped:0\n'
    return 0
  fi

  local result
  result="$(_spec_driver_inject_entries "$gitignore_file" "1")"
  rmdir "$lock_dir" 2>/dev/null || true
  printf '%s\n' "$result"
  return 0
}

# ensure_spec_driver_git_exclude <project_root>
#
# 写 <project_root>/.git/info/exclude（Git 原生的非 tracked 项目级 ignore）。
# 动机：用户 repo 的 .gitignore 几乎都被 track，注入产生 `M .gitignore` 仍进 patch；
#       写 .git/info/exclude 零 diff 污染。这是分层防线的主防线。
# 行为契约：
#   - 仅当 <project_root>/.git 是**目录**时执行；.git 为文件（worktree/submodule 的
#     gitdir 指针）→ skipped:0（gitdir 解析复杂且 exclude 共享主仓库，.gitignore 路径覆盖）
#   - 非 git repo（无 .git）→ skipped:0
#   - .git/info/ 不存在则 mkdir -p 创建
#   - 三态输出与防御同 _spec_driver_inject_entries（不带注释头）
#   - 复用同一把锁（与 gitignore 各自独立拿/放锁，无死锁）
#   - 始终 return 0；仅 project_root 为空或非目录时 return 1
ensure_spec_driver_git_exclude() {
  local project_root="$1"
  if [[ -z "$project_root" || ! -d "$project_root" ]]; then
    return 1
  fi

  local git_dir="${project_root}/.git"
  # .git 必须是目录：非 git repo 或 worktree/submodule（.git 为文件）→ 跳过
  if [[ ! -d "$git_dir" ]]; then
    printf 'skipped:0\n'
    return 0
  fi

  local exclude_file="${git_dir}/info/exclude"
  local lock_dir="${project_root}/.specify/.ensure-gitignore.lock"

  # info/ 目录兜底创建（标准 git repo 一般已有，但防御缺失）
  mkdir -p "${git_dir}/info" 2>/dev/null || true
  # 锁父路径 .specify/ 兜底创建
  mkdir -p "${project_root}/.specify" 2>/dev/null || true

  if ! _spec_driver_acquire_lock "$lock_dir"; then
    printf 'skipped:0\n'
    return 0
  fi

  local result
  result="$(_spec_driver_inject_entries "$exclude_file" "0")"
  rmdir "$lock_dir" 2>/dev/null || true
  printf '%s\n' "$result"
  return 0
}
