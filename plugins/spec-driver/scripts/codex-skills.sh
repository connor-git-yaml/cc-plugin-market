#!/usr/bin/env bash
# Spec Driver Codex skills 安装/卸载脚本（独立入口）

set -euo pipefail

MODE="project"
ACTION="install"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

usage() {
  cat <<'USAGE'
用法:
  bash plugins/spec-driver/scripts/codex-skills.sh install [--global]
  bash plugins/spec-driver/scripts/codex-skills.sh remove [--global]

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

write_wrapper() {
  local skill_name="$1"
  local source_skill_path="$2"
  local input_rule="$3"
  local examples="$4"
  local target_file="$TARGET_DIR/$skill_name/SKILL.md"

  mkdir -p "$(dirname "$target_file")"

  cat > "$target_file" <<EOF_SKILL
---
name: $skill_name
description: |
  Codex native wrapper for Spec Driver mode.
  Use this skill when user wants to run this Spec Driver mode in Codex and keep the same artifacts/gates as the original plugin workflow.
---

## User Input

\`\`\`text
\$ARGUMENTS
\`\`\`

## Trigger Examples

$examples

## Input Rule

$input_rule

## Source of Truth

流程定义必须以 \`$source_skill_path\` 为准。

## Codex Execution Rules

1. 按 source skill 的阶段顺序执行，不改变门禁与产物路径。
2. 将 source skill 中每次 \`Task(...)\` 调用改为“当前会话内联子代理执行”：
   - 读取对应 \`plugins/spec-driver/agents/*.md\` prompt
   - 追加 source skill 定义的运行时上下文注入块
   - 在当前会话完成该阶段并写入相同文件
3. 原并行组若受环境限制无法并行，必须回退串行并显式标注 \`[回退:串行]\`。
4. 硬门禁（如 \`GATE_DESIGN\`）不可弱化或跳过。
5. 所有写入路径必须与 source skill 约定一致，不得越界写入。
6. 读取 \`spec-driver.config.yaml\` 的模型配置时，先执行运行时兼容归一化：
   - 优先级保持 \`--preset -> agents.{agent_id}.model(仅显式配置时生效) -> preset 默认\`
   - 当 runtime=codex（或自动识别为 Codex）时，默认将 \`opus/sonnet\` 映射为 \`gpt-5/gpt-5-mini\`
   - 若映射后模型不可用，回退到 \`model_compat.defaults.codex\` 并标注 \`[模型回退]\`
EOF_SKILL
}

ensure_source_exists() {
  local source_skill_path="$1"
  if [[ ! -f "$source_skill_path" ]]; then
    echo "[错误] 找不到 source skill: $source_skill_path" >&2
    exit 1
  fi
}

install_all() {
  local source_feature="$REPO_ROOT/plugins/spec-driver/skills/speckit-feature/SKILL.md"
  local source_story="$REPO_ROOT/plugins/spec-driver/skills/speckit-story/SKILL.md"
  local source_fix="$REPO_ROOT/plugins/spec-driver/skills/speckit-fix/SKILL.md"
  local source_resume="$REPO_ROOT/plugins/spec-driver/skills/speckit-resume/SKILL.md"
  local source_sync="$REPO_ROOT/plugins/spec-driver/skills/speckit-sync/SKILL.md"
  local source_doc="$REPO_ROOT/plugins/spec-driver/skills/speckit-doc/SKILL.md"

  ensure_source_exists "$source_feature"
  ensure_source_exists "$source_story"
  ensure_source_exists "$source_fix"
  ensure_source_exists "$source_resume"
  ensure_source_exists "$source_sync"
  ensure_source_exists "$source_doc"

  write_wrapper \
    "spec-driver-feature" \
    "$source_feature" \
    "参数解析与 speckit-feature 保持一致（支持 --research、--preset、--rerun）。" \
    $'- $spec-driver-feature "实现多租户访问控制"\n- $spec-driver-feature --research tech-only "将 ORM 从 Prisma 迁移到 Drizzle"'

  write_wrapper \
    "spec-driver-story" \
    "$source_story" \
    "参数解析与 speckit-story 保持一致（支持需求描述和 --preset）。" \
    $'- $spec-driver-story "给设置页增加暗色模式开关"\n- $spec-driver-story --preset cost-efficient "增加导出 CSV 按钮"'

  write_wrapper \
    "spec-driver-fix" \
    "$source_fix" \
    "参数解析与 speckit-fix 保持一致（支持问题描述和 --preset）。" \
    $'- $spec-driver-fix "登录在邮箱包含 + 时失败"\n- $spec-driver-fix --preset balanced "批量任务在高并发下偶发死锁"'

  write_wrapper \
    "spec-driver-resume" \
    "$source_resume" \
    "该模式默认无需求描述，按 speckit-resume 规则扫描断点并继续。" \
    $'- $spec-driver-resume\n- $spec-driver-resume --preset quality-first'

  write_wrapper \
    "spec-driver-sync" \
    "$source_sync" \
    "该模式无参数，聚合 specs/NNN-* 到产品级 current-spec.md。" \
    $'- $spec-driver-sync'

  write_wrapper \
    "spec-driver-doc" \
    "$source_doc" \
    "该模式无参数，按 speckit-doc 流程交互生成开源文档套件。" \
    $'- $spec-driver-doc'

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
