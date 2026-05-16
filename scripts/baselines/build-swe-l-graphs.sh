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

  # 真实生成（subshell cd 包装，Codex W-1 修复）
  log_info "[$repo] 调用 spectra batch . --mode full --budget ${budget} --concurrency 3 --on-over-budget cancel --no-html"
  if ! (cd "$repo_dir" && $SPECTRA_CLI batch . \
        --mode full \
        --budget "$budget" \
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

  # schema 校验（nodes / links / callSites + callSites.length > 0）
  if ! node -e "
    const g = JSON.parse(require('fs').readFileSync('${graph_path}', 'utf-8'));
    if (!g.nodes || !g.links || !g.callSites) throw new Error('schema missing fields (nodes/links/callSites)');
    if (!Array.isArray(g.callSites) || g.callSites.length === 0) throw new Error('callSites empty');
    process.stdout.write('callSites=' + g.callSites.length + '\n');
  "; then
    log_error "[$repo] graph.json schema 校验失败"
    return 1
  fi

  # 注入 spectraVersion / graphSchemaVersion 元数据（若缺失）
  node -e "
    const p = '${graph_path}';
    const fs = require('fs');
    const g = JSON.parse(fs.readFileSync(p, 'utf-8'));
    let changed = false;
    if (!g.spectraVersion) { g.spectraVersion = '${SPECTRA_PKG_VERSION}'; changed = true; }
    if (!g.graphSchemaVersion) { g.graphSchemaVersion = '${SPECTRA_PKG_VERSION}'; changed = true; }
    if (changed) {
      fs.writeFileSync(p, JSON.stringify(g, null, 2) + '\n', 'utf-8');
      process.stdout.write('injected version metadata\n');
    } else {
      process.stdout.write('version metadata already present\n');
    }
  " || {
    log_error "[$repo] 注入 version 元数据失败"
    return 1
  }

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
