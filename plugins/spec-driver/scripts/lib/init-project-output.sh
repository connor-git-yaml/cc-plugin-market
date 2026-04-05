build_results_json() {
  local results_json="["
  local first=true
  local result

  for result in "${INIT_RESULTS[@]}"; do
    if [[ "$first" == "true" ]]; then
      first=false
    else
      results_json+=","
    fi
    results_json+="\"$result\""
  done

  results_json+="]"
  printf '%s' "$results_json"
}

output_init_json() {
  local results_json
  results_json="$(build_results_json)"

  cat <<EOF
{
  "PROJECT_ROOT": "${PROJECT_ROOT}",
  "SPECIFY_DIR": "${SPECIFY_DIR}",
  "NEEDS_CONSTITUTION": ${NEEDS_CONSTITUTION},
  "NEEDS_CONFIG": ${NEEDS_CONFIG},
  "HAS_GATE_POLICY": ${HAS_GATE_POLICY},
  "HAS_SPEC_DRIVER_SKILLS": ${HAS_SPEC_DRIVER_SKILLS},
  "PROJECT_CONTEXT_MODE": "${PROJECT_CONTEXT_MODE}",
  "SKILL_MAP": "${SKILL_MAP}",
  "RESULTS": ${results_json}
}
EOF
}

print_init_text_result() {
  local result="$1"
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
        echo -e "     → 建议先运行 /spec-driver.constitution（Claude）或 \$spec-driver-constitution（Codex）创建项目宪法"
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
    spec_driver_skills)
      if [[ "$value" == "none" ]]; then
        echo -e "  ℹ️  未检测到项目已有 spec-driver skills，使用 Plugin 内置版本"
      else
        local skills="${value#found:}"
        echo -e "  ✅ 检测到项目已有 spec-driver skills: ${GREEN}${skills}${NC}"
        echo -e "     → 将优先使用项目已有版本"
      fi
      ;;
    project_context)
      if [[ "$value" == "exists" ]]; then
        echo -e "  ✅ 已检测到 canonical Project Context: .specify/project-context.yaml"
      elif [[ "$value" == "created" ]]; then
        echo -e "  ✅ 已创建最小 Project Context: .specify/project-context.yaml"
      elif [[ "$value" == "legacy_md" ]]; then
        echo -e "  ℹ️  检测到 legacy Project Context: .specify/project-context.md"
        echo -e "     → 当前仍兼容 Markdown fallback，建议迁移到 .specify/project-context.yaml"
      elif [[ "$value" == "dual" ]]; then
        echo -e "  ⚠️  ${YELLOW}同时检测到 .specify/project-context.yaml 与 .specify/project-context.md${NC}"
        echo -e "     → resolver 将只读取 YAML，建议清理 legacy Markdown"
      elif [[ "$value" == "missing_template" ]]; then
        echo -e "  ⚠️  ${YELLOW}未找到 project-context 模板，跳过自动创建${NC}"
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
}

output_init_text() {
  echo ""
  echo -e "${CYAN}${BOLD}[初始化] 项目环境检查${NC}"
  echo ""

  local result
  for result in "${INIT_RESULTS[@]}"; do
    print_init_text_result "$result"
  done

  echo ""
}

output_init_results() {
  if [[ "$OUTPUT_MODE" == "json" ]]; then
    output_init_json
    return
  fi

  output_init_text
}
