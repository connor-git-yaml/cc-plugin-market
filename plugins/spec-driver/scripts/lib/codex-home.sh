#!/usr/bin/env bash
# Spec Driver - Codex 家目录解析共享库（Feature 240 / FR-006）
# 由 codex-skills.sh 等需要定位**全局** Codex 家目录的脚本 source。
#
# 语义：CODEX_HOME 存在且非空时使用其值；否则 fallback 到 <家目录>/.codex。
#
# 🔴 与 Node 侧 src/core/codex-home.ts 的等价性范围
#    （Codex 对抗审查 W1 修订：原注释声称「逐字节等价」属 over-claim，已按实测收窄）
#
#    等价范围（由 tests/unit/codex-home-shell.test.ts 的对拍用例机械保证）：
#      (a) CODEX_HOME 显式非空（绝对 / 相对 / 尾斜杠 / 内部重复斜杠 / 含空格 /
#          波浪号字面量 / symlink / 不存在 / 无权限）——一律原样返回，两侧逐字节一致；
#      (b) CODEX_HOME 未设置或为空串，且家目录为**不含 dot-segment** 的非空值
#          ——两侧同为 <家目录>/.codex，逐字节一致。
#
#    已知差异（实测确认，两侧注释与测试矩阵同步登记，不得再声称等价）：
#      1. 值含换行符 \n：Node 原样保留，shell 消费端 $() 会剥尾换行 → 同一变量指向不同目录。
#         **已消除**：两侧统一 fail-loud 拒绝（见下方 _codex_home_reject_newline）。
#      2. HOME 与 CODEX_HOME 同时 unset：Node 的 os.homedir 经**系统账户**仍能得到家目录，
#         shell 的 ${HOME:-} 为空 → 本库非零退出。**保留该差异**（shell fail-loud，Node 系统 fallback）。
#         不修理由：让 shell 侧也取系统账户需引入 getent(Linux)/dscl(macOS) 平台分支，
#         把纯字符串函数变成依赖平台工具链的探测器；而 HOME unset 在实际运行环境属异常态，
#         此时 fail-loud（提示显式设置 CODEX_HOME）比静默猜一个家目录更安全。
#      3. 家目录含 dot-segment（. / ..）：Node 的 path.join 做词法规约（'.'→'.codex'、
#         '/tmp/a/../b'→'/tmp/b'），shell 原样拼接（'./.codex'、'/tmp/a/../b/.codex'）。
#         **保留该差异**。不修理由：对齐 path.join 需在 bash 里重写一份 path.normalize，
#         等于手写路径解析器（F231 已实证该类手写解析器是逃逸面而非防线）；且词法规约
#         dot-segment 在 symlink 存在时与内核实际解析结果本就不一致，"两侧都规约"并不更正确。
#
# 🔴 与官方 codex doctor 的对齐边界（实测见 specs/240-codex-runtime-closeout/_grounding.md §9.6）：
#     - 对齐：空串等同未设置 → fallback。
#     - 不对齐（我方自定义语义，不得声称对齐）：doctor 会去尾斜杠 / 转绝对 / 解 symlink，
#       且对不存在的目录直接判 fail。本库只做取值与 fallback，不规范化 CODEX_HOME、
#       不做存在性校验；存在性与可写性由各调用点自行处理并 fail-loud。
#
# 🔴 作用域边界（_grounding.md §9.2）：本库只服务于**以家目录为基**的全局 Codex 路径。
#     仓库内 .codex/ 路径（project 模式安装目标、.codex/skills/ 下的 F238 wrapper 产物）
#     MUST NOT 消费本库 —— 二者语义相反，误用会同时打断 repo:check 与 F238 门禁。
#
# 注意：本文件只定义函数，不含 set -e / 顶层执行逻辑，避免被 source 时影响调用方主流程。

# 折叠连续斜杠为单个（对齐 Node 侧 path.join 的行为）。$1 = 待折叠字符串。
#
# 🔴 为何**不能**写成 `${v//\/\//\/}`（W1 修复轮实测踩到的坑）：
# 该写法在 bash 5.x 下正确，但在 **bash 3.2**（macOS 自带 /bin/bash，
# 无 Homebrew bash 的 Mac 上就是它）下，替换串里的 `\/` 不会被解析成字面 `/`，
# 而是产出**字面反斜杠**——`//x` 会变成 `\/x`，把合法路径写坏。
# 本仓库脚本以 `#!/usr/bin/env bash` 启动，实际解释器取决于用户 PATH，
# 3.2 与 5.x 都必须正确，故改用**不含任何反斜杠转义**的前缀/后缀切分写法
# （`%%"//"*` 与 `#*"//"` 中的引号使 `//` 按字面匹配），两个版本行为一致。
_codex_collapse_slashes() {
  local v="$1"
  while [[ "$v" == *"//"* ]]; do
    v="${v%%"//"*}/${v#*"//"}"
  done
  printf '%s\n' "$v"
}

# 拒绝含换行符的取值（上表已知差异 1 的两侧统一处置，对称于 Node 侧 assertNoNewline）。
#   $1 = 待校验值    $2 = 用于报错的名称
# 为何 fail-loud 而非各自返回：所有 shell 消费端都以 $(resolve_codex_home_from_env) 取值，
# command substitution 会剥掉全部尾部换行，Node 侧则原样保留 —— 同一个 CODEX_HOME 会在
# 两条链路上指向不同目录，而 `remove --global` 会据此删除**错误的目录**（静默破坏性后果）。
# 只拦 \n 不拦 \r：command substitution 不剥 \r，两侧对 \r 行为一致，不构成分叉。
_codex_home_reject_newline() {
  if [[ "$1" == *$'\n'* ]]; then
    echo "[错误] resolve_codex_home：$2 含换行符，无法在 Node 与 shell 两侧一致解析（shell 的 \$() 会剥掉尾部换行导致指向不同目录），请修正取值" >&2
    return 2
  fi
  return 0
}

# 纯函数：两个参数均必传，函数体不读任何全局环境变量。
#   $1 = CODEX_HOME 的值（可为空串，空串视同未设置）
#   $2 = 家目录的值（仅 fallback 分支使用）
# 参数缺失、取值含换行、或 fallback 分支下家目录为空时非零退出（fail-loud），
# 绝不静默取全局或产出相对路径 —— 与 Node 侧 TypeError 守卫对称。
resolve_codex_home() {
  if [[ $# -lt 2 ]]; then
    echo "[错误] resolve_codex_home 需要两个显式参数: <CODEX_HOME 值> <家目录值>" >&2
    return 2
  fi

  local codex_home="$1"
  local home_dir="$2"

  # 非空即原样返回：不 trim、不规范化、不校验存在性（唯一例外是换行符）
  if [[ -n "$codex_home" ]]; then
    _codex_home_reject_newline "$codex_home" "CODEX_HOME" || return 2
    printf '%s\n' "$codex_home"
    return 0
  fi

  if [[ -z "$home_dir" ]]; then
    # 空家目录会拼出相对路径，写操作将落进当前工作目录（静默灾难）；Node 侧同为 fail-loud
    echo "[错误] resolve_codex_home 无法 fallback：家目录取值为空，请显式设置 CODEX_HOME" >&2
    return 2
  fi

  _codex_home_reject_newline "$home_dir" "家目录取值" || return 2

  # 折叠重复斜杠并剥去尾部斜杠，对齐 Node 侧 path.join 的规范化行为
  # （path.join('//h/u', '.codex') === '/h/u/.codex'，若不折叠两侧会逐字节漂移）
  # 注意：dot-segment（. / ..）**不**在此规约，属上表已知差异 3。
  home_dir="$(_codex_collapse_slashes "$home_dir")"
  printf '%s\n' "${home_dir%/}/.codex"
}

# 纯函数：把 Codex 家目录与一段子路径拼接，对齐 Node 侧 path.join(base, sub)。
#   $1 = base（Codex 家目录）    $2 = 子路径（如 skills）
#
# 🔴 为何必须存在（Codex 对抗审查 W1 实测反例）：消费端曾直接写
# `TARGET_DIR="$(resolve_codex_home_from_env)/skills"`，在 CODEX_HOME=/tmp/x/ 时
# 产出 `/tmp/x//skills`，而 Node 侧 join('/tmp/x/','skills') 得 `/tmp/x/skills` ——
# **纯函数对拍通过、消费链却漂移**。故拼接必须同样收进本库并纳入对拍。
codex_path_join() {
  if [[ $# -lt 2 ]]; then
    echo "[错误] codex_path_join 需要两个显式参数: <base> <子路径>" >&2
    return 2
  fi

  # 折叠重复斜杠（吸收 base 的尾斜杠与内部 //），对齐 path.join；
  # 末尾不再额外剥斜杠：子路径由调用方给定且恒不以 / 结尾。
  _codex_collapse_slashes "$1/$2"
}

# 唯一读取环境的薄封装（对称于 Node 侧 resolveCodexHomeFromProcess）。
# 所有生产调用点 MUST 经本函数取值，不得各自展开 $CODEX_HOME / $HOME。
resolve_codex_home_from_env() {
  resolve_codex_home "${CODEX_HOME:-}" "${HOME:-}"
}

# 消费端唯一入口：解析家目录并拼接子路径，等价于 Node 侧
# `join(resolveCodexHomeFromProcess(), sub)`。
# 所有需要 "<Codex 家目录>/<子目录>" 的调用点 MUST 经本函数，
# 不得自行写 `"$(resolve_codex_home_from_env)/sub"`（会漏掉尾斜杠吸收，见 codex_path_join）。
resolve_codex_home_subdir() {
  if [[ $# -lt 1 ]]; then
    echo "[错误] resolve_codex_home_subdir 需要一个显式参数: <子路径>" >&2
    return 2
  fi

  # 不依赖调用方的 set -e：显式检查解析是否 fail-loud，避免把空 base 拼成相对路径
  local base
  if ! base="$(resolve_codex_home_from_env)"; then
    return 2
  fi
  codex_path_join "$base" "$1"
}
