#!/usr/bin/env bash
# speckit-doc — 项目元信息收集脚本
# 从 package.json、git config、目录结构中收集项目元数据
# 输出符合 contracts/scan-project-output.md 定义的 JSON Schema
#
# 用法: bash scan-project.sh [--json]
#   --json  输出 JSON 格式（默认输出人类可读文本）

set -euo pipefail

# ===== 输出模式 =====
OUTPUT_MODE="text"

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

# ===== 项目根目录 =====
PROJECT_ROOT="$(pwd)"
PROJECT_DIR_NAME="$(basename "$PROJECT_ROOT")"

# ===== 辅助函数: JSON 字符串转义 =====
json_escape() {
  local str="$1"
  str="${str//\\/\\\\}"
  str="${str//\"/\\\"}"
  str="${str//$'\n'/\\n}"
  str="${str//$'\r'/}"
  str="${str//$'\t'/\\t}"
  printf '%s' "$str"
}

# ===== 检查完全空目录 =====
file_count=$(find "$PROJECT_ROOT" -maxdepth 1 -not -name '.' -not -name '..' -not -name '.git' | head -1 | wc -l)
if [[ "$file_count" -eq 0 ]]; then
  # 检查是否连 .git 都没有
  if [[ ! -d "$PROJECT_ROOT/.git" ]]; then
    echo "错误: 当前目录为空，无法收集项目元信息。请先执行 git init 和 npm init。" >&2
    exit 1
  fi
fi

# ===== 初始化变量 =====
HAS_PACKAGE_JSON=false
HAS_GIT_REPO=false
MISSING_FIELDS=()

# package.json 字段
PKG_NAME=""
PKG_VERSION="null"
PKG_DESCRIPTION="null"
PKG_LICENSE="null"
PKG_AUTHOR_NAME="null"
PKG_AUTHOR_EMAIL="null"
PKG_SCRIPTS="{}"
PKG_DEPENDENCIES="{}"
PKG_DEV_DEPENDENCIES="{}"
PKG_REPOSITORY="null"
PKG_MAIN="null"
PKG_BIN="null"

# git 字段
GIT_USER_NAME="null"
GIT_USER_EMAIL="null"
GIT_REMOTE_URL="null"
GIT_DEFAULT_BRANCH="main"

# ===== 解析 package.json =====
PKG_FILE="$PROJECT_ROOT/package.json"

if [[ -f "$PKG_FILE" ]]; then
  HAS_PACKAGE_JSON=true

  # 使用 node 解析 package.json（最可靠的方式）
  PKG_JSON=$(node -e "
    try {
      const pkg = require('$PKG_FILE');
      const result = {};

      result.name = pkg.name || null;
      result.version = pkg.version || null;
      result.description = pkg.description || null;
      result.license = pkg.license || null;
      result.main = pkg.main || null;

      // author 解析（支持字符串和对象两种格式）
      if (typeof pkg.author === 'string') {
        const match = pkg.author.match(/^([^<(]+?)(?:\s*<([^>]+)>)?(?:\s*\(([^)]+)\))?$/);
        if (match) {
          result.author = { name: match[1].trim(), email: match[2] || null };
        } else {
          result.author = { name: pkg.author.trim(), email: null };
        }
      } else if (pkg.author && typeof pkg.author === 'object') {
        result.author = { name: pkg.author.name || null, email: pkg.author.email || null };
      } else {
        result.author = null;
      }

      // bin 字段（支持字符串和对象格式）
      if (typeof pkg.bin === 'string') {
        result.bin = {};
        result.bin[pkg.name || 'cli'] = pkg.bin;
      } else if (pkg.bin && typeof pkg.bin === 'object') {
        result.bin = pkg.bin;
      } else {
        result.bin = null;
      }

      // repository 字段（支持字符串和对象格式）
      if (typeof pkg.repository === 'string') {
        result.repository = { url: pkg.repository, type: 'git' };
      } else if (pkg.repository && typeof pkg.repository === 'object') {
        result.repository = { url: pkg.repository.url || '', type: pkg.repository.type || 'git' };
      } else {
        result.repository = null;
      }

      result.scripts = pkg.scripts || {};
      result.dependencies = pkg.dependencies || {};
      result.devDependencies = pkg.devDependencies || {};

      console.log(JSON.stringify(result));
    } catch (e) {
      console.error('警告: package.json 解析失败 — ' + e.message);
      console.log('null');
    }
  " 2>/dev/null) || true

  if [[ "$PKG_JSON" == "null" ]] || [[ -z "$PKG_JSON" ]]; then
    # package.json 解析失败，降级
    echo "警告: package.json 存在但解析失败，将降级为无 package.json 模式。" >&2
    HAS_PACKAGE_JSON=false
    PKG_NAME="$PROJECT_DIR_NAME"
    MISSING_FIELDS+=("version" "description" "license" "author" "scripts" "dependencies" "repository" "main")
  else
    # 使用 node 提取各字段
    PKG_NAME=$(node -e "const d=$PKG_JSON; console.log(d.name || '$PROJECT_DIR_NAME')")
    PKG_VERSION=$(node -e "const d=$PKG_JSON; console.log(d.version ? JSON.stringify(d.version) : 'null')")
    PKG_DESCRIPTION=$(node -e "const d=$PKG_JSON; console.log(d.description ? JSON.stringify(d.description) : 'null')")
    PKG_LICENSE=$(node -e "const d=$PKG_JSON; console.log(d.license ? JSON.stringify(d.license) : 'null')")
    PKG_MAIN=$(node -e "const d=$PKG_JSON; console.log(d.main ? JSON.stringify(d.main) : 'null')")

    # author
    PKG_AUTHOR_NAME=$(node -e "const d=$PKG_JSON; console.log(d.author && d.author.name ? JSON.stringify(d.author.name) : 'null')")
    PKG_AUTHOR_EMAIL=$(node -e "const d=$PKG_JSON; console.log(d.author && d.author.email ? JSON.stringify(d.author.email) : 'null')")

    # bin
    PKG_BIN=$(node -e "const d=$PKG_JSON; console.log(d.bin ? JSON.stringify(d.bin) : 'null')")

    # repository
    PKG_REPOSITORY=$(node -e "const d=$PKG_JSON; console.log(d.repository ? JSON.stringify(d.repository) : 'null')")

    # scripts / dependencies / devDependencies
    PKG_SCRIPTS=$(node -e "const d=$PKG_JSON; console.log(JSON.stringify(d.scripts || {}))")
    PKG_DEPENDENCIES=$(node -e "const d=$PKG_JSON; console.log(JSON.stringify(d.dependencies || {}))")
    PKG_DEV_DEPENDENCIES=$(node -e "const d=$PKG_JSON; console.log(JSON.stringify(d.devDependencies || {}))")

    # 计算缺失字段
    [[ "$PKG_VERSION" == "null" ]] && MISSING_FIELDS+=("version")
    [[ "$PKG_DESCRIPTION" == "null" ]] && MISSING_FIELDS+=("description")
    [[ "$PKG_LICENSE" == "null" ]] && MISSING_FIELDS+=("license")
    [[ "$PKG_AUTHOR_NAME" == "null" ]] && MISSING_FIELDS+=("author")
    [[ "$PKG_REPOSITORY" == "null" ]] && MISSING_FIELDS+=("repository")
    [[ "$PKG_MAIN" == "null" ]] && [[ "$PKG_BIN" == "null" ]] && MISSING_FIELDS+=("main")
  fi
else
  # 无 package.json
  PKG_NAME="$PROJECT_DIR_NAME"
  MISSING_FIELDS+=("version" "description" "license" "author" "scripts" "dependencies" "repository" "main")
fi

# ===== 收集 git 信息 =====
if [[ -d "$PROJECT_ROOT/.git" ]]; then
  HAS_GIT_REPO=true

  GIT_USER_NAME_RAW=$(git -C "$PROJECT_ROOT" config user.name 2>/dev/null || echo "")
  if [[ -n "$GIT_USER_NAME_RAW" ]]; then
    GIT_USER_NAME="\"$(json_escape "$GIT_USER_NAME_RAW")\""
  fi

  GIT_USER_EMAIL_RAW=$(git -C "$PROJECT_ROOT" config user.email 2>/dev/null || echo "")
  if [[ -n "$GIT_USER_EMAIL_RAW" ]]; then
    GIT_USER_EMAIL="\"$(json_escape "$GIT_USER_EMAIL_RAW")\""
  fi

  GIT_REMOTE_URL_RAW=$(git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null || echo "")
  if [[ -n "$GIT_REMOTE_URL_RAW" ]]; then
    GIT_REMOTE_URL="\"$(json_escape "$GIT_REMOTE_URL_RAW")\""
  fi

  # 检测默认分支
  GIT_DEFAULT_BRANCH_RAW=$(git -C "$PROJECT_ROOT" symbolic-ref --short HEAD 2>/dev/null || echo "main")
  GIT_DEFAULT_BRANCH="$GIT_DEFAULT_BRANCH_RAW"
else
  MISSING_FIELDS+=("git.userName" "git.userEmail" "git.remoteUrl")
fi

# ===== 生成目录树（深度 2） =====
if command -v tree &>/dev/null; then
  DIR_TREE=$(tree -L 2 -I 'node_modules|.git|dist|coverage|.next|.nuxt|.output|__pycache__' --dirsfirst "$PROJECT_ROOT" 2>/dev/null | head -40)
else
  # 降级: 使用 find 生成简易目录树
  DIR_TREE=$(find "$PROJECT_ROOT" -maxdepth 2 \
    -not -path '*/node_modules/*' \
    -not -path '*/.git/*' \
    -not -path '*/dist/*' \
    -not -path '*/coverage/*' \
    -not -name 'node_modules' \
    -not -name '.git' \
    | sort \
    | sed "s|$PROJECT_ROOT|.|" \
    | head -40)
fi

# ===== 推断项目类型 =====
PROJECT_TYPE="unknown"
if [[ "$PKG_BIN" != "null" ]] && [[ "$PKG_BIN" != "{}" ]]; then
  PROJECT_TYPE="cli"
elif [[ "$PKG_MAIN" != "null" ]]; then
  PROJECT_TYPE="library"
elif [[ "$HAS_PACKAGE_JSON" == "true" ]]; then
  # 检查是否有 web 应用特征（dev/start 脚本、框架依赖）
  HAS_WEB_INDICATOR=$(node -e "
    const scripts = $PKG_SCRIPTS;
    const deps = $PKG_DEPENDENCIES;
    const devDeps = $PKG_DEV_DEPENDENCIES;
    const allDeps = { ...deps, ...devDeps };
    const webFrameworks = ['react', 'vue', 'next', 'nuxt', 'svelte', 'angular', 'express', 'koa', 'fastify', 'hono'];
    const hasWebDep = webFrameworks.some(fw => fw in allDeps);
    const hasDev = 'dev' in scripts || 'start' in scripts;
    console.log((hasWebDep || hasDev) ? 'true' : 'false');
  " 2>/dev/null || echo "false")
  if [[ "$HAS_WEB_INDICATOR" == "true" ]]; then
    PROJECT_TYPE="web-app"
  fi
fi

# ===== 检测已有文档文件 =====
README_EXISTS=false
LICENSE_EXISTS=false
CONTRIBUTING_EXISTS=false
COC_EXISTS=false

[[ -f "$PROJECT_ROOT/README.md" ]] && README_EXISTS=true
[[ -f "$PROJECT_ROOT/LICENSE" ]] && LICENSE_EXISTS=true
[[ -f "$PROJECT_ROOT/CONTRIBUTING.md" ]] && CONTRIBUTING_EXISTS=true
[[ -f "$PROJECT_ROOT/CODE_OF_CONDUCT.md" ]] && COC_EXISTS=true

# ===== 构建 author JSON =====
AUTHOR_JSON="null"
if [[ "$PKG_AUTHOR_NAME" != "null" ]]; then
  AUTHOR_JSON="{\"name\":$PKG_AUTHOR_NAME"
  if [[ "$PKG_AUTHOR_EMAIL" != "null" ]]; then
    AUTHOR_JSON+=",\"email\":$PKG_AUTHOR_EMAIL"
  else
    AUTHOR_JSON+=",\"email\":null"
  fi
  AUTHOR_JSON+="}"
fi

# ===== 构建 missingFields JSON 数组 =====
MISSING_JSON="["
FIRST=true
for field in "${MISSING_FIELDS[@]}"; do
  if [[ "$FIRST" == "true" ]]; then
    FIRST=false
  else
    MISSING_JSON+=","
  fi
  MISSING_JSON+="\"$field\""
done
MISSING_JSON+="]"

# ===== 输出 =====
if [[ "$OUTPUT_MODE" == "json" ]]; then
  DIR_TREE_ESCAPED=$(json_escape "$DIR_TREE")

  cat <<ENDJSON
{
  "name": "$(json_escape "$PKG_NAME")",
  "version": $PKG_VERSION,
  "description": $PKG_DESCRIPTION,
  "license": $PKG_LICENSE,
  "author": $AUTHOR_JSON,
  "scripts": $PKG_SCRIPTS,
  "dependencies": $PKG_DEPENDENCIES,
  "devDependencies": $PKG_DEV_DEPENDENCIES,
  "repository": $PKG_REPOSITORY,
  "main": $PKG_MAIN,
  "bin": $PKG_BIN,
  "git": {
    "userName": $GIT_USER_NAME,
    "userEmail": $GIT_USER_EMAIL,
    "remoteUrl": $GIT_REMOTE_URL,
    "defaultBranch": "$GIT_DEFAULT_BRANCH"
  },
  "directoryTree": "$DIR_TREE_ESCAPED",
  "projectType": "$PROJECT_TYPE",
  "existingFiles": {
    "README.md": $README_EXISTS,
    "LICENSE": $LICENSE_EXISTS,
    "CONTRIBUTING.md": $CONTRIBUTING_EXISTS,
    "CODE_OF_CONDUCT.md": $COC_EXISTS
  },
  "hasPackageJson": $HAS_PACKAGE_JSON,
  "hasGitRepo": $HAS_GIT_REPO,
  "missingFields": $MISSING_JSON
}
ENDJSON

else
  # 人类可读文本输出
  echo ""
  echo "========================================="
  echo "  项目元信息概要"
  echo "========================================="
  echo ""
  echo "  项目名称:   $PKG_NAME"
  echo "  版本:       $(echo $PKG_VERSION | tr -d '\"')"
  echo "  描述:       $(echo $PKG_DESCRIPTION | tr -d '\"')"
  echo "  协议:       $(echo $PKG_LICENSE | tr -d '\"')"
  echo "  项目类型:   $PROJECT_TYPE"
  echo ""
  echo "  package.json: $( [[ "$HAS_PACKAGE_JSON" == "true" ]] && echo "存在" || echo "不存在" )"
  echo "  git 仓库:     $( [[ "$HAS_GIT_REPO" == "true" ]] && echo "存在" || echo "不存在" )"
  echo ""
  echo "  已有文档:"
  echo "    README.md:         $( [[ "$README_EXISTS" == "true" ]] && echo "存在" || echo "不存在" )"
  echo "    LICENSE:           $( [[ "$LICENSE_EXISTS" == "true" ]] && echo "存在" || echo "不存在" )"
  echo "    CONTRIBUTING.md:   $( [[ "$CONTRIBUTING_EXISTS" == "true" ]] && echo "存在" || echo "不存在" )"
  echo "    CODE_OF_CONDUCT.md:$( [[ "$COC_EXISTS" == "true" ]] && echo "存在" || echo "不存在" )"
  echo ""
  if [[ ${#MISSING_FIELDS[@]} -gt 0 ]]; then
    echo "  缺失字段: ${MISSING_FIELDS[*]}"
  else
    echo "  缺失字段: 无"
  fi
  echo ""
  echo "========================================="
fi
