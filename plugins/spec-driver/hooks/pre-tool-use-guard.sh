#!/usr/bin/env bash
# PreToolUse Hook: 当前 feature 分支存在未完成 spec-driver 任务时，对 src/ 的直接编辑发出警示
#
# 活跃判定：仅看「当前 git 分支同名的 spec 目录」（specs/<branch>/tasks.md）是否含未完成任务，
#           不再扫全仓 specs/*/tasks.md——历史残留的未完成任务不应误伤当前分支的编辑。
# 默认动作：warn-only（stderr 提示 + exit 0）。implement 子代理与主线程在 payload 上无法区分，
#           默认阻断会让 spec-driver 自己的 implement 阶段死锁，故阻断改为显式 opt-in：
#           仅 SPEC_DRIVER_SRC_GUARD=block 时才 exit 2。
# 失败路径：判定材料缺失（非 git 仓库 / detached HEAD / 读不到 stdin / jq 取不到值）一律 fail-open（exit 0）。
#           注意「畸形 JSON」不等于必然放行：jq 分支解析失败返回空 → 放行；而 grep 降级分支是纯文本
#           模式匹配，对「畸形但模式仍能匹配」的文本（如缺闭合括号）会按提取到的值照常判定，
#           本脚本不提供、也无法提供 JSON 有效性保证。
#
# exit 0 = 允许, exit 2 = 阻断

set -euo pipefail

# 从 stdin 读取 hook payload（JSON）
# `2>/dev/null || true`：PATH 里没有 cat 时，命令替换失败会在 set -e 下把退出码放大成 127，
# 而 hook 的退出码是对 harness 的合同（0 放行 / 2 阻断），不能被环境缺陷污染。
# 兜底后 INPUT 为空 → FILE_PATH 为空 → 正常走 exit 0 放行。
INPUT=$(cat 2>/dev/null || true)

# 提取目标文件路径：真实 harness payload 把 file_path 嵌套在 tool_input 下，
# 顶层 .file_path 仅作为自定义桥接的向后兼容回退。
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .file_path // empty' 2>/dev/null || echo "")
else
  # 以下是 best-effort 的降级分支：只在没有 jq 的环境生效，按字面文本匹配 JSON，
  # 不具备结构化语义。先用 tool_name 收窄到编辑类工具，挡掉从 Bash 命令串里误抓
  # "file_path" 文本的情形（jq 分支靠结构定位，天然免疫，无需此门槛）。
  #
  # 已知限制（三条，方向均为 fail-open 漏判、不会误伤）：
  #   1. 按文本先后取首个 "file_path"：payload 同时含顶层与 tool_input 嵌套 file_path 时，
  #      可能取到顶层值，与 jq 分支的「嵌套优先」结构化优先级不一致。
  #   2. 不做任何 JSON 字符串转义反解码（\uXXXX、\\、\"、\n、\/ 等一律保留字面形态），
  #      且只识别字符串类型的值：非 ASCII 或含转义的文件名在此分支判定不生效。
  #   3. 依赖「键与值同行」的文本形态，不保证任意键序 / 换行布局下都能取到值。
  # 这是有意取舍：bash 手写 JSON 解析做不到结构化语义，越修越像解析器就越容易被绕过；
  # 漏判只是门禁不响，误判才会打断正常编辑。要精确判定请在环境中装 jq。
  TOOL_NAME=$(printf '%s' "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//' || echo "")
  case "$TOOL_NAME" in
    Edit|Write|MultiEdit) ;;
    *) exit 0 ;;  # 非编辑类工具（含字段缺失）一律放行
  esac
  FILE_PATH=$(printf '%s' "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//' || echo "")
fi

# 无文件路径时放行
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# 检查是否指向 src/
case "$FILE_PATH" in
  src/*|*/src/*) ;;
  *) exit 0 ;;  # 非 src/ 路径，放行
esac

# 检查当前分支是否有活跃的 spec-driver 工作流
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [ -z "$CURRENT_BRANCH" ]; then
  exit 0  # 非 git 仓库 / detached HEAD / git 不可用
fi

TASKS_FILE="specs/${CURRENT_BRANCH}/tasks.md"
if [ ! -f "$TASKS_FILE" ]; then
  exit 0  # 当前分支无对应 spec 目录（master / 临时分支等）
fi

if grep -q '^\- \[ \]' "$TASKS_FILE" 2>/dev/null; then
  # 两处提示都带 `|| true`：stderr 若不可写（被关闭 / 管道已断），set -e 会把写失败放大成 exit 1，
  # 那既不是放行也不是阻断——更糟的是 block 路径会在抵达 exit 2 之前就死掉。
  echo "[PreToolUse WARN] 当前分支 ${CURRENT_BRANCH} 的 ${TASKS_FILE} 仍有未完成任务；对 ${FILE_PATH} 的直接编辑建议走 spec-driver implement 阶段。" >&2 || true
  if [ "${SPEC_DRIVER_SRC_GUARD:-}" = "block" ]; then
    echo "[PreToolUse BLOCKED] SPEC_DRIVER_SRC_GUARD=block：活跃 spec-driver 工作流中禁止直接编辑 src/。请通过 spec-driver implement 阶段修改代码。" >&2 || true
    exit 2
  fi
fi

exit 0
