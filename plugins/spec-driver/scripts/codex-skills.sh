#!/usr/bin/env bash
# Spec Driver Codex skills 安装/卸载脚本（独立入口）

set -euo pipefail

MODE="project"
ACTION="install"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'USAGE'
用法:
  bash "\$PLUGIN_DIR/scripts/codex-skills.sh" install [--global]
  bash "\$PLUGIN_DIR/scripts/codex-skills.sh" remove [--global]

说明:
  install   安装 Spec Driver 的 Codex 包装技能到 .codex/skills
  remove    移除已安装的 Spec Driver Codex 包装技能
  --global  目标目录改为 ~/.codex/skills

环境变量:
  CODEX_SKILL_PROJECT_ROOT  覆盖 project 模式的目标项目根目录
USAGE
}

for arg in "$@"; do
  case "$arg" in
    install|remove)
      ACTION="$arg"
      ;;
    --global|-g)
      MODE="global"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[错误] 未知参数: $arg" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$MODE" == "global" ]]; then
  TARGET_DIR="$HOME/.codex/skills"
else
  if [[ -n "${CODEX_SKILL_PROJECT_ROOT:-}" ]]; then
    PROJECT_ROOT="$CODEX_SKILL_PROJECT_ROOT"
  elif git -C "$PWD" rev-parse --show-toplevel >/dev/null 2>&1; then
    PROJECT_ROOT="$(git -C "$PWD" rev-parse --show-toplevel)"
  else
    PROJECT_ROOT="$PWD"
  fi
  TARGET_DIR="$PROJECT_ROOT/.codex/skills"
fi

SKILLS=(
  "spec-driver-feature"
  "spec-driver-story"
  "spec-driver-fix"
  "spec-driver-resume"
  "spec-driver-sync"
  "spec-driver-doc"
)

ensure_source_exists() {
  local source_skill_path="$1"
  if [[ ! -f "$source_skill_path" ]]; then
    echo "[错误] 找不到 source skill: $source_skill_path" >&2
    exit 1
  fi
}

rewrite_codex_runtime_text() {
  sed \
    -e 's|/spec-driver:spec-driver-feature|$spec-driver-feature|g' \
    -e 's|/spec-driver:spec-driver-story|$spec-driver-story|g' \
    -e 's|/spec-driver:spec-driver-fix|$spec-driver-fix|g' \
    -e 's|/spec-driver:spec-driver-resume|$spec-driver-resume|g' \
    -e 's|/spec-driver:spec-driver-sync|$spec-driver-sync|g' \
    -e 's|/spec-driver:spec-driver-doc|$spec-driver-doc|g' \
    -e 's|Claude Code 的 Task tool|Task tool（Codex 下按内联子代理执行）|g' \
    -e 's|在同一消息中同时发出多个 Task tool 调用。Claude Code 的 function calling 机制支持在单个 assistant 消息中发出多个 tool calls，这些 tool calls 会被并行执行。|若当前环境支持并行工具调用，则在同一消息中并行执行；否则按本 Skill 的回退规则串行执行。|g'
}

write_frontmatter() {
  local skill_name="$1"
  local source_skill_path="$2"

  awk -v skill_name="$skill_name" '
    NR == 1 && $0 == "---" {
      in_frontmatter = 1
      print
      next
    }
    in_frontmatter {
      if ($0 ~ /^name:[[:space:]]/) {
        print "name: " skill_name
        next
      }
      print
      if ($0 == "---") {
        exit
      }
    }
  ' "$source_skill_path"
}

write_codex_adapter() {
  local skill_name="$1"
  local source_skill_name="$2"

  cat <<EOF_ADAPTER
## Codex Runtime Adapter

此 Skill 在安装时直接同步自 \`\$PLUGIN_DIR/skills/$source_skill_name/SKILL.md\` 的描述与正文，只额外叠加以下 Codex 运行时差异：

- 命令别名：正文中的 \`/spec-driver:$source_skill_name\` 在 Codex 中等价于 \`\$$skill_name\`
- 子代理执行：正文中的 \`Task(...)\` / \`Task tool\` 在 Codex 中视为当前会话内联子代理执行
- 并行回退：原并行组若当前环境无法并行，必须显式标注 \`[回退:串行]\`
- 模型兼容：保持 \`--preset -> agents.{agent_id}.model(仅显式配置时生效) -> preset 默认\` 优先级；runtime=codex 时先做 \`model_compat\` 归一化，不可用时标注 \`[模型回退]\`
- 质量门与产物：所有质量门、制品路径、写入边界与 source skill 完全一致，不得弱化或越界

---
EOF_ADAPTER
}

write_skill_body() {
  local source_skill_path="$1"

  awk '
    NR == 1 && $0 == "---" {
      in_frontmatter = 1
      next
    }
    in_frontmatter {
      if ($0 == "---") {
        in_frontmatter = 0
      }
      next
    }
    {
      print
    }
  ' "$source_skill_path" | rewrite_codex_runtime_text
}

write_wrapper() {
  local skill_name="$1"
  local source_skill_name="$2"
  local source_skill_path="$PLUGIN_DIR/skills/$source_skill_name/SKILL.md"
  local target_file="$TARGET_DIR/$skill_name/SKILL.md"

  ensure_source_exists "$source_skill_path"
  mkdir -p "$(dirname "$target_file")"

  {
    write_frontmatter "$skill_name" "$source_skill_path"
    printf '\n'
    write_codex_adapter "$skill_name" "$source_skill_name"
    printf '\n'
    write_skill_body "$source_skill_path"
  } > "$target_file"
}

install_all() {
  write_wrapper "spec-driver-feature" "spec-driver-feature"
  write_wrapper "spec-driver-story" "spec-driver-story"
  write_wrapper "spec-driver-fix" "spec-driver-fix"
  write_wrapper "spec-driver-resume" "spec-driver-resume"
  write_wrapper "spec-driver-sync" "spec-driver-sync"
  write_wrapper "spec-driver-doc" "spec-driver-doc"

  echo "Spec Driver Codex skills 安装完成: $TARGET_DIR"
}

remove_all() {
  local removed=0
  for skill in "${SKILLS[@]}"; do
    local dir="$TARGET_DIR/$skill"
    if [[ -d "$dir" ]]; then
      rm -rf "$dir"
      echo "✓ 已删除: $dir"
      removed=$((removed + 1))
    fi
  done

  if [[ $removed -eq 0 ]]; then
    echo "未检测到已安装的 Spec Driver Codex skills，无需清理"
  else
    echo "Spec Driver Codex skills 已移除: $removed 个"
  fi
}

if [[ "$ACTION" == "install" ]]; then
  install_all
else
  remove_all
fi
