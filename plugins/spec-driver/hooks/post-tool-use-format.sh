#!/usr/bin/env bash
# PostToolUse Hook: Edit/Write 后自动 prettier 格式化
#
# 前置条件：仅对 JS/TS/JSON 文件生效，且项目自身存在 prettier 配置
#           （.prettierrc* / prettier.config.{js,cjs,mjs} / package.json 的 "prettier" 字段）。
#           无配置时静默放行——否则 npx 会临时安装 prettier 并按默认规则重排整个文件，
#           在没有约定 prettier 的项目里制造大规模意外 diff + 网络开销。
# 失败路径：恒 exit 0。判定材料缺失（读不到 stdin / jq 取不到值 / 文件不存在）一律静默放行；
#           但「畸形 JSON」不等于必然放行——jq 分支解析失败返回空 → 放行，grep 降级分支是纯文本
#           模式匹配，对「畸形但模式仍能匹配」的文本会按提取到的值照常判定，本脚本不提供
#           JSON 有效性保证。
# 注意：密集编辑期间可能有性能开销。如需优化可改为 Stop hook 批量格式化。

set -euo pipefail

# `2>/dev/null || true`：PATH 里没有 cat 时，命令替换失败会在 set -e 下让脚本以 127 退出，
# 而 PostToolUse hook 的合同是恒 0。兜底后 INPUT 为空 → FILE_PATH 为空 → 正常 exit 0。
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
  #      且只识别字符串类型的值：非 ASCII 或含转义的文件名拿到的是字面序列，
  #      后续 [ -f ] 判定为假 → 该文件不会被格式化。
  #   3. 依赖「键与值同行」的文本形态，不保证任意键序 / 换行布局下都能取到值。
  # 这是有意取舍：bash 手写 JSON 解析做不到结构化语义，越修越像解析器就越容易被绕过；
  # 漏判只是少格式化一次，误判才会去改无关文件。要精确取值请在环境中装 jq。
  TOOL_NAME=$(printf '%s' "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//' || echo "")
  case "$TOOL_NAME" in
    Edit|Write|MultiEdit) ;;
    *) exit 0 ;;  # 非编辑类工具（含字段缺失）一律放行
  esac
  FILE_PATH=$(printf '%s' "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//' || echo "")
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.mjs|*.cjs) ;;
  *) exit 0 ;;  # 非 JS/TS/JSON 文件，放行
esac

# 项目是否明确采用 prettier 约定。
# 判据取「宽信号」：独立配置文件存在，或 package.json 里出现完整带引号的 "prettier" token
# （既覆盖 package.json 内联 prettier 配置块，也覆盖 dependencies / devDependencies 里的依赖声明——
#  项目把 prettier 装进依赖，本身就是采用该约定的表态）。
# 已知窄误报面：任意层级的同名键、或恰好等于 "prettier" 的字符串值也会命中。
# 误报代价仅是对「刚被编辑过的那一个文件」多跑一次 prettier，远低于漏报代价
# （用户明明配了 prettier 却不生效，且没有任何信号）——故不引入 JSON 解析来收窄。
HAS_PRETTIER_CONFIG=false
for prettier_config in .prettierrc .prettierrc.* prettier.config.js prettier.config.cjs prettier.config.mjs; do
  if [ -f "$prettier_config" ]; then
    HAS_PRETTIER_CONFIG=true
  fi
done
if [ "$HAS_PRETTIER_CONFIG" = "false" ]; then
  if [ -f package.json ]; then
    if grep -q '"prettier"' package.json 2>/dev/null; then
      HAS_PRETTIER_CONFIG=true
    fi
  fi
fi

if [ "$HAS_PRETTIER_CONFIG" = "false" ]; then
  exit 0  # 项目未采用 prettier，不做任何格式化
fi

if command -v npx >/dev/null 2>&1; then
  # `--` 不可省：FILE_PATH 来自外部 payload，若其值恰好是 flag 形态（如 --config / -e...），
  # 没有分隔符时会被 npx/prettier 的参数解析器当作选项而非文件名。
  npx prettier --write -- "$FILE_PATH" >/dev/null 2>&1 || true
fi

exit 0
