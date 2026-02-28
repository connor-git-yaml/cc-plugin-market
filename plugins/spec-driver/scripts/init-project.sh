#!/usr/bin/env bash
# Spec Driver - 项目级初始化脚本
# 首次在项目中触发 Spec Driver 时由主编排器调用
# 职责：检查/创建 .specify/ 目录、constitution、spec-driver.config.yaml

set -euo pipefail

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# 输出模式
OUTPUT_MODE="text"
JSON_OUTPUT=""

# 解析参数
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      OUTPUT_MODE="json"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# 项目根目录（假定从项目根运行）
PROJECT_ROOT="$(pwd)"
SPECIFY_DIR="${PROJECT_ROOT}/.specify"
SPECIFY_TEMPLATES_DIR="${SPECIFY_DIR}/templates"
CONSTITUTION_FILE="${SPECIFY_DIR}/memory/constitution.md"
CONFIG_FILE="${PROJECT_ROOT}/spec-driver.config.yaml"
ALT_CONFIG_FILE="${SPECIFY_DIR}/spec-driver.config.yaml"

# 获取 Plugin 目录（相对于脚本位置）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
SPECIFY_BASE_TEMPLATES_DIR="${PLUGIN_DIR}/templates/specify-base"
FALLBACK_SPECIFY_TEMPLATES_DIR="${PLUGIN_DIR}/../../.specify/templates"
REQUIRED_SPECIFY_TEMPLATES=(
  "plan-template.md"
  "spec-template.md"
  "tasks-template.md"
  "checklist-template.md"
  "constitution-template.md"
  "agent-file-template.md"
)

# 初始化结果
INIT_RESULTS=()
NEEDS_CONSTITUTION=false
NEEDS_CONFIG=false
HAS_GATE_POLICY=false
HAS_SPECKIT_SKILLS=false
SKILL_MAP=""

# 步骤 1: 检查/创建 .specify/ 目录
init_specify_dir() {
  if [[ -d "$SPECIFY_DIR" ]]; then
    INIT_RESULTS+=("specify_dir:exists")
  else
    INIT_RESULTS+=("specify_dir:created")
  fi

  # 目录结构确保存在（幂等）
  mkdir -p "${SPECIFY_DIR}/memory"
  mkdir -p "${SPECIFY_DIR}/templates"
  mkdir -p "${SPECIFY_DIR}/scripts/bash"
}

sync_specify_templates() {
  local copied_count=0
  local missing_templates=()

  for template_name in "${REQUIRED_SPECIFY_TEMPLATES[@]}"; do
    local target_path="${SPECIFY_TEMPLATES_DIR}/${template_name}"
    if [[ -f "$target_path" ]]; then
      continue
    fi

    local source_path=""
    if [[ -f "${SPECIFY_BASE_TEMPLATES_DIR}/${template_name}" ]]; then
      source_path="${SPECIFY_BASE_TEMPLATES_DIR}/${template_name}"
    elif [[ -f "${FALLBACK_SPECIFY_TEMPLATES_DIR}/${template_name}" ]]; then
      source_path="${FALLBACK_SPECIFY_TEMPLATES_DIR}/${template_name}"
    fi

    if [[ -n "$source_path" ]]; then
      cp "$source_path" "$target_path"
      copied_count=$((copied_count + 1))
    else
      missing_templates+=("$template_name")
    fi
  done

  if [[ $copied_count -gt 0 ]]; then
    INIT_RESULTS+=("specify_templates:copied:${copied_count}")
  fi

  if [[ ${#missing_templates[@]} -eq 0 ]]; then
    INIT_RESULTS+=("specify_templates:ready")
  else
    local missing_csv
    missing_csv="$(IFS=','; echo "${missing_templates[*]}")"
    INIT_RESULTS+=("specify_templates:missing:${missing_csv}")
  fi
}

# 步骤 2: 检查 constitution.md
check_constitution() {
  if [[ -f "$CONSTITUTION_FILE" ]]; then
    INIT_RESULTS+=("constitution:exists")
    return 0
  fi

  NEEDS_CONSTITUTION=true
  INIT_RESULTS+=("constitution:missing")
}

# 步骤 3: 检查 spec-driver.config.yaml
check_config() {
  if [[ -f "$CONFIG_FILE" ]] || [[ -f "$ALT_CONFIG_FILE" ]]; then
    INIT_RESULTS+=("config:exists")
    return 0
  fi

  NEEDS_CONFIG=true
  INIT_RESULTS+=("config:missing")
}

# 步骤 4: 检查 gate_policy 配置
check_gate_policy() {
  local config_path=""
  if [[ -f "$CONFIG_FILE" ]]; then
    config_path="$CONFIG_FILE"
  elif [[ -f "$ALT_CONFIG_FILE" ]]; then
    config_path="$ALT_CONFIG_FILE"
  fi

  if [[ -z "$config_path" ]]; then
    # 配置文件不存在，跳过检查
    HAS_GATE_POLICY=false
    INIT_RESULTS+=("gate_policy:no_config")
    return 0
  fi

  if grep -q "^gate_policy:" "$config_path" 2>/dev/null; then
    HAS_GATE_POLICY=true
    INIT_RESULTS+=("gate_policy:exists")
  else
    HAS_GATE_POLICY=false
    INIT_RESULTS+=("gate_policy:missing")
  fi
}

# 步骤 5: 检测已有 speckit skills
detect_speckit_skills() {
  local skills_dir="${PROJECT_ROOT}/.claude/commands"
  local found_skills=()

  if [[ -d "$skills_dir" ]]; then
    for skill_file in "$skills_dir"/speckit.*.md; do
      if [[ -f "$skill_file" ]]; then
        local phase
        phase="$(basename "$skill_file" .md | sed 's/speckit\.//')"
        found_skills+=("$phase")
      fi
    done
  fi

  if [[ ${#found_skills[@]} -gt 0 ]]; then
    HAS_SPECKIT_SKILLS=true
    SKILL_MAP=$(printf '%s,' "${found_skills[@]}" | sed 's/,$//')
    INIT_RESULTS+=("speckit_skills:found:${SKILL_MAP}")
  else
    INIT_RESULTS+=("speckit_skills:none")
  fi
}

# 输出结果
output_results() {
  if [[ "$OUTPUT_MODE" == "json" ]]; then
    local results_json="["
    local first=true
    for result in "${INIT_RESULTS[@]}"; do
      if [[ "$first" == "true" ]]; then
        first=false
      else
        results_json+=","
      fi
      results_json+="\"$result\""
    done
    results_json+="]"

    cat <<EOF
{
  "PROJECT_ROOT": "${PROJECT_ROOT}",
  "SPECIFY_DIR": "${SPECIFY_DIR}",
  "NEEDS_CONSTITUTION": ${NEEDS_CONSTITUTION},
  "NEEDS_CONFIG": ${NEEDS_CONFIG},
  "HAS_GATE_POLICY": ${HAS_GATE_POLICY},
  "HAS_SPECKIT_SKILLS": ${HAS_SPECKIT_SKILLS},
  "SKILL_MAP": "${SKILL_MAP}",
  "RESULTS": ${results_json}
}
EOF
  else
    echo ""
    echo -e "${CYAN}${BOLD}[初始化] 项目环境检查${NC}"
    echo ""

    for result in "${INIT_RESULTS[@]}"; do
      local key="${result%%:*}"
      local value="${result#*:}"
      case "$key" in
        specify_dir)
          if [[ "$value" == "exists" ]]; then
            echo -e "  ✅ .specify/ 目录已存在"
          else
            echo -e "  ✅ .specify/ 目录已创建"
          fi
          ;;
        constitution)
          if [[ "$value" == "exists" ]]; then
            echo -e "  ✅ constitution.md 已存在"
          else
            echo -e "  ⚠️  ${YELLOW}未找到 constitution.md${NC}"
            echo -e "     → 建议先运行 /speckit.constitution 创建项目宪法"
          fi
          ;;
        config)
          if [[ "$value" == "exists" ]]; then
            echo -e "  ✅ spec-driver.config.yaml 已存在"
          else
            echo -e "  ⚠️  ${YELLOW}未找到 spec-driver.config.yaml${NC}"
            echo -e "     → 将在首次运行时引导选择模型预设"
          fi
          ;;
        gate_policy)
          if [[ "$value" == "exists" ]]; then
            echo -e "  ✅ gate_policy 配置已存在"
          elif [[ "$value" == "no_config" ]]; then
            echo -e "  ℹ️  配置文件不存在，gate_policy 将在创建配置时设置"
          else
            echo -e "  ℹ️  ${YELLOW}未配置门禁策略，使用默认值 balanced${NC}"
          fi
          ;;
        speckit_skills)
          if [[ "$value" == "none" ]]; then
            echo -e "  ℹ️  未检测到项目已有 speckit skills，使用 Plugin 内置版本"
          else
            local skills="${value#found:}"
            echo -e "  ✅ 检测到项目已有 speckit skills: ${GREEN}${skills}${NC}"
            echo -e "     → 将优先使用项目已有版本"
          fi
          ;;
        specify_templates)
          if [[ "$value" == ready ]]; then
            echo -e "  ✅ .specify/templates 基础模板已就绪"
          elif [[ "$value" == copied:* ]]; then
            local count="${value#copied:}"
            echo -e "  ✅ 已自动导入 .specify/templates 基础模板: ${count} 个"
          elif [[ "$value" == missing:* ]]; then
            local missing="${value#missing:}"
            echo -e "  ⚠️  ${YELLOW}.specify/templates 仍缺少模板: ${missing}${NC}"
          fi
          ;;
      esac
    done

    echo ""
  fi
}

# 主流程
main() {
  init_specify_dir
  sync_specify_templates
  check_constitution
  check_config
  check_gate_policy
  detect_speckit_skills
  output_results
}

main "$@"
