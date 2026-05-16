#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Feature 165 T-003 — Pre-build spectra graph for SWE-Bench Python repos
# ─────────────────────────────────────────────────────────────────────────────
#
# 用途：为 SWE-Bench-Lite Python 仓库（pytest / astropy / sympy）调用 spectra CLI
#       生成 LLM full panoramic graph，落在 ~/.spectra-baselines/<repo>/specs/_meta/
#       graph.json，供 Cohort C 注入消费。
#
# 调用方式：
#   bash scripts/baselines/build-swe-l-graphs.sh --repo pytest
#   bash scripts/baselines/build-swe-l-graphs.sh --repo astropy --budget 8
#   bash scripts/baselines/build-swe-l-graphs.sh --all
#   bash scripts/baselines/build-swe-l-graphs.sh --help
#
# 默认 budget：pytest=5 / astropy=10 / sympy=10（USD）；可通过 --budget N 覆盖。
#
# 关键设计（参见 specs/165-.../plan.md §决策 1）：
#   - subshell 包装 cd 防止 cwd 错位（Codex W-1 修复）
#   - 不 hardcode '4.1.1'，从 package.json.version 读取 + spectra --version 二次校验
#     （Codex W-3 修复）
#   - graph.json 末尾注入 spectraVersion / graphSchemaVersion 元数据
#   - 严格 schema 校验：nodes / links / callSites 存在 + callSites.length > 0
#   - 失败累计 FAILED_REPOS 数组，任一失败则 exit 1
#
# ─────────────────────────────────────────────────────────────────────────────

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SPECTRA_BASELINE_HOME="${SPECTRA_BASELINE_HOME:-$HOME/.spectra-baselines}"
SPECTRA_CLI="${SPECTRA_CLI:-node ${PROJECT_ROOT}/dist/cli/index.js}"

# 三个支持的目标仓库及默认 budget（USD）
declare -A REPO_BUDGETS=(
  ["pytest"]="5"
  ["astropy"]="10"
  ["sympy"]="10"
)

# ─── 日志 helper ─────────────────────────────────────────────────────────────
log_info() {
  printf '\033[1;34m[build-swe-l-graphs]\033[0m %s\n' "$*"
}
log_warn() {
  printf '\033[1;33m[build-swe-l-graphs WARN]\033[0m %s\n' "$*" >&2
}
log_error() {
  printf '\033[1;31m[build-swe-l-graphs ERROR]\033[0m %s\n' "$*" >&2
}

print_usage() {
  cat <<EOF
Usage: $0 [--repo <name>] [--all] [--budget <USD>] [--help]

Options:
  --repo <name>     单仓库构建：pytest / astropy / sympy（必须 --repo 或 --all）
  --all             串行构建三个仓库（pytest → astropy → sympy）
  --budget <USD>    覆盖默认 budget（pytest=5 / astropy=10 / sympy=10）
  --help            打印本帮助信息

Examples:
  $0 --repo pytest
  $0 --repo astropy --budget 8
  $0 --all

Environment:
  SPECTRA_BASELINE_HOME   baseline 家目录（默认 \$HOME/.spectra-baselines）
  SPECTRA_CLI             spectra CLI 命令（默认 'node \$PROJECT_ROOT/dist/cli/index.js'）

EOF
}

# ─── 参数解析 ────────────────────────────────────────────────────────────────
REPO=""
ALL_REPOS=0
BUDGET_OVERRIDE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      shift
      [ "$#" -eq 0 ] && { log_error "--repo 缺少参数"; print_usage; exit 1; }
      REPO="$1"
      shift
      ;;
    --all)
      ALL_REPOS=1
      shift
      ;;
    --budget)
      shift
      [ "$#" -eq 0 ] && { log_error "--budget 缺少参数"; print_usage; exit 1; }
      BUDGET_OVERRIDE="$1"
      shift
      ;;
    --help|-h)
      print_usage
      exit 0
      ;;
    *)
      log_error "未知参数: $1"
      print_usage
      exit 1
      ;;
  esac
done

if [ -z "$REPO" ] && [ "$ALL_REPOS" -eq 0 ]; then
  log_error "必须指定 --repo <name> 或 --all"
  print_usage
  exit 1
fi
if [ -n "$REPO" ] && [ "$ALL_REPOS" -eq 1 ]; then
  log_error "--repo 与 --all 互斥"
  exit 1
fi

# ─── 前置校验：dist/cli/index.js 存在 ────────────────────────────────────────
if [ ! -f "${PROJECT_ROOT}/dist/cli/index.js" ]; then
  log_error "${PROJECT_ROOT}/dist/cli/index.js 不存在；请先运行 npm run build"
  exit 1
fi

# ─── 读取 package.json.version（不 hardcode 4.1.1）────────────────────────────
SPECTRA_PKG_VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('${PROJECT_ROOT}/package.json','utf-8')).version)")" || {
  log_error "无法读取 package.json.version"
  exit 1
}

# spectra --version 二次校验（不一致仅警告，权威源为 package.json）
SPECTRA_CLI_VERSION="$($SPECTRA_CLI --version 2>/dev/null | head -1 | awk '{print $NF}' || echo "")"
if [ -n "$SPECTRA_CLI_VERSION" ] && [ "$SPECTRA_PKG_VERSION" != "$SPECTRA_CLI_VERSION" ]; then
  log_warn "spectra version 不一致：package=${SPECTRA_PKG_VERSION} CLI=${SPECTRA_CLI_VERSION}；使用 package 值"
fi
log_info "spectra runtime version = ${SPECTRA_PKG_VERSION}"

# ─── 单仓库构建函数 ──────────────────────────────────────────────────────────
# build_one_repo <repo_name> <budget_usd>
# 返回 0 成功 / 非 0 失败
build_one_repo() {
  local repo="$1"
  local budget="$2"
  local repo_dir="${SPECTRA_BASELINE_HOME}/${repo}"
  local graph_path="${repo_dir}/specs/_meta/graph.json"

  log_info "[$repo] 开始 graph build（budget=\$${budget}）"

  # 校验仓库目录存在（clone-swe-bench-upstream.sh 的产物）
  if [ ! -d "$repo_dir" ]; then
    log_error "[$repo] 仓库目录不存在：${repo_dir}"
    log_error "[$repo] 请先运行 bash scripts/baselines/clone-swe-bench-upstream.sh"
    return 1
  fi

  # Codex CRITICAL 修复（FR-008）—— dry-run 预估门控
  # spectra batch --dry-run 生成 _meta/dry-run-estimate.md（无 LLM 调用）；
  # 解析预估 input/output tokens → 按 Sonnet 单价估算 cost → 比对 budget 上限
  # 失败时 (cost > budget 或解析失败) 不阻断，仅 log_warn —— 因为 spectra 内置
  # --budget 是 hard gate（FR-008 软约束 + 校准要求）
  log_info "[$repo] 执行 dry-run 预估（FR-008 校准）..."
  if (cd "$repo_dir" && $SPECTRA_CLI batch . --mode full --dry-run --no-html 2>&1) > /tmp/f165-dryrun-$$.log; then
    local dry_report="${repo_dir}/specs/_meta/dry-run-estimate.md"
    if [ -s "$dry_report" ]; then
      # parse markdown 表格：| 预估 input tokens | N | 和 | 预估 output tokens | M |
      local input_tokens
      local output_tokens
      input_tokens=$(grep "^| 预估 input tokens |" "$dry_report" | awk -F'|' '{gsub(/[ ,]/,"",$3); print $3}')
      output_tokens=$(grep "^| 预估 output tokens |" "$dry_report" | awk -F'|' '{gsub(/[ ,]/,"",$3); print $3}')
      if [[ "$input_tokens" =~ ^[0-9]+$ ]] && [[ "$output_tokens" =~ ^[0-9]+$ ]]; then
        # Sonnet 4.5/4.6 价格：input $3 / Mtoken, output $15 / Mtoken
        # 转 cents 整数避免 bc 依赖：cost_cents = (input*300 + output*1500) / 1_000_000
        local cost_cents=$(( (input_tokens * 300 + output_tokens * 1500) / 1000000 ))
        local budget_cents=$(( budget * 100 ))
        log_info "[$repo] dry-run 估算：input=${input_tokens}, output=${output_tokens}, cost≈\$0.$(printf "%02d" "$cost_cents") (budget=\$${budget})"
        if [ "$cost_cents" -gt "$budget_cents" ]; then
          log_warn "[$repo] dry-run 估算 cost (\$0.${cost_cents}) > budget (\$${budget})，但继续依赖 spectra --on-over-budget cancel 硬门控"
        fi
      else
        log_warn "[$repo] dry-run markdown 解析失败（input=${input_tokens} output=${output_tokens}），跳过 cost gate"
      fi
    else
      log_warn "[$repo] dry-run report 不存在或为空：${dry_report}，跳过 cost gate"
    fi
  else
    log_warn "[$repo] dry-run 调用失败（退出码非零），跳过 cost gate（依赖 --on-over-budget cancel 兜底）"
  fi
  rm -f /tmp/f165-dryrun-$$.log

  # USD → tokens 转换（spectra --budget 是 token 数，非 USD）
  # 转换比例：Sonnet weighted avg ≈ $6.6/Mtoken（input 30% × $3 + output 70% × $15 ÷ 1M)；
  # 取 ≈ 200_000 tokens / USD（含 30% 余量，避免 dry-run 偏差导致提前 cancel）
  local budget_tokens=$(( budget * 200000 ))

  # 真实生成（subshell cd 包装，Codex W-1 修复）
  log_info "[$repo] 调用 spectra batch . --mode full --budget ${budget_tokens} tokens (≈\$${budget} USD) --concurrency 3 --on-over-budget cancel --no-html"
  if ! (cd "$repo_dir" && $SPECTRA_CLI batch . \
        --mode full \
        --budget "$budget_tokens" \
        --concurrency 3 \
        --on-over-budget cancel \
        --no-html); then
    log_warn "[$repo] spectra batch 返回非零退出码，标记 graph-build-failed"
    return 1
  fi

  # 校验 graph.json 存在且非空
  if [ ! -s "$graph_path" ]; then
    log_error "[$repo] graph.json 不存在或为空：${graph_path}"
    return 1
  fi

  # schema 校验 + 派生 callSites + 注入 version 元数据
  # spec FR-001 round 2 实测修正：
  #   spectra graph.json v2.0 schema：calls 信息在 links[].relation === 'calls'，
  #   没有顶层 callSites 字段。本步骤派生 callSites 字段并注入，保持 spec FR-001/011 合同
  # version 元数据：
  #   graphSchemaVersion 从 g.graph.schemaVersion（spectra graph schema 版本，如 "2.0"）派生
  #   spectraVersion 从 package.json version 注入（4.1.1）
  if ! node -e "
    const fs = require('fs');
    const p = '${graph_path}';
    const g = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!g.nodes || !g.links) throw new Error('missing nodes/links');
    // 派生 callSites — 从 links 中 relation='calls' 提取
    const callsLinks = g.links.filter(l => l.relation === 'calls');
    if (callsLinks.length === 0) throw new Error('no calls relation links — graph 未含函数调用边');
    if (!g.callSites) {
      g.callSites = callsLinks.map(l => ({
        source: l.source,
        target: l.target,
        confidence: l.confidence ?? null,
        confidenceScore: l.confidenceScore ?? null,
      }));
    }
    // 注入 version 元数据
    if (!g.spectraVersion) g.spectraVersion = '${SPECTRA_PKG_VERSION}';
    if (!g.graphSchemaVersion) {
      // round 3 修正：使用 spectra package version 作为 graphSchemaVersion
      // 与 RUNTIME_SPECTRA_VERSION IIFE 对齐（runtime 端校验同源）
      // spectra graph format 内部版本（g.graph.schemaVersion='2.0'）保留不动，作为
      // graph format 兼容性诊断字段（不参与 runtime 校验）
      g.graphSchemaVersion = '${SPECTRA_PKG_VERSION}';
    }
    fs.writeFileSync(p, JSON.stringify(g, null, 2) + '\n', 'utf-8');
    process.stdout.write('callSites=' + g.callSites.length + ' spectraVersion=' + g.spectraVersion + ' graphSchemaVersion=' + g.graphSchemaVersion + '\n');
  "; then
    log_error "[$repo] graph.json schema 校验 / 派生 callSites / 注入 version 失败"
    return 1
  fi

  log_info "[$repo] graph build 成功：${graph_path}"
  return 0
}

# ─── 主循环 ──────────────────────────────────────────────────────────────────
FAILED_REPOS=()
REPOS_TO_BUILD=()

if [ "$ALL_REPOS" -eq 1 ]; then
  REPOS_TO_BUILD=("pytest" "astropy" "sympy")
else
  # 单仓库：校验合法名
  if [ -z "${REPO_BUDGETS[$REPO]+set}" ]; then
    log_error "未知 --repo 值: $REPO（合法值：pytest / astropy / sympy）"
    exit 1
  fi
  REPOS_TO_BUILD=("$REPO")
fi

log_info "Baseline 家目录：${SPECTRA_BASELINE_HOME}"
log_info "构建目标：${REPOS_TO_BUILD[*]}"

for r in "${REPOS_TO_BUILD[@]}"; do
  budget="${BUDGET_OVERRIDE:-${REPO_BUDGETS[$r]}}"
  if ! build_one_repo "$r" "$budget"; then
    FAILED_REPOS+=("$r")
  fi
done

if [ "${#FAILED_REPOS[@]}" -gt 0 ]; then
  log_error "以下仓库 graph build 失败：${FAILED_REPOS[*]}"
  exit 1
fi

log_info "全部仓库 graph build 完成"
exit 0
