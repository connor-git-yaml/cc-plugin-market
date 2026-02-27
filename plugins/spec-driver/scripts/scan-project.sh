#!/usr/bin/env bash
# speckit-doc — 项目元信息收集脚本
# 从项目配置文件（package.json、pyproject.toml、Cargo.toml、go.mod、pom.xml、build.gradle）、
# git config、目录结构中收集项目元数据
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
    echo "错误: 当前目录为空，无法收集项目元信息。请先执行 git init 并添加项目配置文件（如 package.json、pyproject.toml、Cargo.toml 等）。" >&2
    exit 1
  fi
fi

# ===== 初始化变量 =====
HAS_PACKAGE_JSON=false
HAS_GIT_REPO=false
MISSING_FIELDS=()
ECOSYSTEM="unknown"

# package.json / 项目配置文件字段
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
PROJECT_TYPE="unknown"

# git 字段
GIT_USER_NAME="null"
GIT_USER_EMAIL="null"
GIT_REMOTE_URL="null"
GIT_DEFAULT_BRANCH="main"

# ===== 多语言项目解析函数 =====

# Python 项目解析: pyproject.toml / setup.py / requirements.txt
parse_python_project() {
  if [[ -f "$PROJECT_ROOT/pyproject.toml" ]]; then
    # 提取 [project] 段内容
    local proj_section
    proj_section=$(sed -n '/^\[project\]/,/^\[/p' "$PROJECT_ROOT/pyproject.toml" 2>/dev/null | sed '$d')

    # 提取 name
    local name_val
    name_val=$(echo "$proj_section" | grep -m1 '^name' | sed 's/^name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/')
    [[ -n "$name_val" ]] && PKG_NAME="$name_val"

    # 提取 version
    local version_val
    version_val=$(echo "$proj_section" | grep -m1 '^version' | sed 's/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/')
    if [[ -n "$version_val" ]]; then
      PKG_VERSION="\"$version_val\""
    else
      MISSING_FIELDS+=("version")
    fi

    # 提取 description
    local desc_val
    desc_val=$(echo "$proj_section" | grep -m1 '^description' | sed 's/^description[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/')
    if [[ -n "$desc_val" ]]; then
      PKG_DESCRIPTION="\"$(json_escape "$desc_val")\""
    else
      MISSING_FIELDS+=("description")
    fi

    # 提取 license
    local license_val
    license_val=$(echo "$proj_section" | grep -m1 '^license' | sed 's/.*"\([^"]*\)".*/\1/')
    if [[ -n "$license_val" ]]; then
      PKG_LICENSE="\"$license_val\""
    else
      MISSING_FIELDS+=("license")
    fi

    # 提取 authors
    local author_val
    author_val=$(sed -n '/^\[project\]/,/^\[/p' "$PROJECT_ROOT/pyproject.toml" 2>/dev/null | grep -A1 'authors' | grep 'name' | sed 's/.*name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/' | head -1)
    if [[ -n "$author_val" ]]; then
      PKG_AUTHOR_NAME="\"$(json_escape "$author_val")\""
    else
      MISSING_FIELDS+=("author")
    fi

    # 判断 python-app vs python-lib
    if grep -q '^\[project\.scripts\]' "$PROJECT_ROOT/pyproject.toml" 2>/dev/null; then
      PROJECT_TYPE="python-app"
    else
      PROJECT_TYPE="python-lib"
    fi

  elif [[ -f "$PROJECT_ROOT/setup.py" ]]; then
    # 降级: 从 setup.py 提取
    local name_val
    name_val=$(grep -m1 "name=" "$PROJECT_ROOT/setup.py" | sed "s/.*name=['\"]\\([^'\"]*\\)['\"].*/\\1/")
    [[ -n "$name_val" ]] && PKG_NAME="$name_val"

    local version_val
    version_val=$(grep -m1 "version=" "$PROJECT_ROOT/setup.py" | sed "s/.*version=['\"]\\([^'\"]*\\)['\"].*/\\1/")
    if [[ -n "$version_val" ]]; then
      PKG_VERSION="\"$version_val\""
    else
      MISSING_FIELDS+=("version")
    fi

    # 检查 console_scripts 判断 app vs lib
    if grep -q 'console_scripts' "$PROJECT_ROOT/setup.py" 2>/dev/null; then
      PROJECT_TYPE="python-app"
    else
      PROJECT_TYPE="python-lib"
    fi

    MISSING_FIELDS+=("description" "license" "author")

  elif [[ -f "$PROJECT_ROOT/requirements.txt" ]]; then
    # 最小降级: 仅标识为 Python 项目
    PKG_NAME="$PROJECT_DIR_NAME"
    PROJECT_TYPE="python-app"
    MISSING_FIELDS+=("version" "description" "license" "author")
  fi

  # Python 项目通用缺失字段
  MISSING_FIELDS+=("scripts" "dependencies" "repository" "main")
}

# Rust 项目解析: Cargo.toml
parse_cargo_toml() {
  local file="$PROJECT_ROOT/Cargo.toml"

  # 提取 [package] 段内容
  local pkg_section
  pkg_section=$(sed -n '/^\[package\]/,/^\[/p' "$file" 2>/dev/null | sed '$d')

  # 提取 name
  local name_val
  name_val=$(echo "$pkg_section" | grep -m1 '^name' | sed 's/^name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/')
  [[ -n "$name_val" ]] && PKG_NAME="$name_val"

  # 提取 version
  local version_val
  version_val=$(echo "$pkg_section" | grep -m1 '^version' | sed 's/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/')
  if [[ -n "$version_val" ]]; then
    PKG_VERSION="\"$version_val\""
  else
    MISSING_FIELDS+=("version")
  fi

  # 提取 description
  local desc_val
  desc_val=$(echo "$pkg_section" | grep -m1 '^description' | sed 's/^description[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/')
  if [[ -n "$desc_val" ]]; then
    PKG_DESCRIPTION="\"$(json_escape "$desc_val")\""
  else
    MISSING_FIELDS+=("description")
  fi

  # 提取 license
  local license_val
  license_val=$(echo "$pkg_section" | grep -m1 '^license' | sed 's/^license[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/')
  if [[ -n "$license_val" ]]; then
    PKG_LICENSE="\"$license_val\""
  else
    MISSING_FIELDS+=("license")
  fi

  # 提取 authors
  local author_val
  author_val=$(echo "$pkg_section" | grep -A1 'authors' | grep -o '"[^"]*"' | head -1 | tr -d '"')
  if [[ -n "$author_val" ]]; then
    PKG_AUTHOR_NAME="\"$(json_escape "$author_val")\""
  else
    MISSING_FIELDS+=("author")
  fi

  MISSING_FIELDS+=("scripts" "dependencies" "repository" "main")
  PROJECT_TYPE="rust"
}

# Go 项目解析: go.mod
parse_go_mod() {
  local file="$PROJECT_ROOT/go.mod"

  # 提取 module path
  local module_path
  module_path=$(grep -m1 '^module ' "$file" | sed 's/^module[[:space:]]*//')

  if [[ -n "$module_path" ]]; then
    # 从 module path 提取项目短名称（最后一段）
    PKG_NAME=$(basename "$module_path")

    # 如果是 github.com 路径，推断 repository URL
    if [[ "$module_path" == github.com/* ]]; then
      GIT_REMOTE_URL="\"https://$module_path\""
    fi
  fi

  # Go 项目通常不在 go.mod 中声明版本
  MISSING_FIELDS+=("version" "description" "license" "author" "scripts" "dependencies" "main")
  PROJECT_TYPE="go"
}

# Java Maven 项目解析: pom.xml
parse_pom_xml() {
  local file="$PROJECT_ROOT/pom.xml"

  # 跳过 <parent> 块，从前 50 行提取顶层元素
  local content
  content=$(sed '/<parent>/,/<\/parent>/d' "$file" 2>/dev/null | head -50)

  # 提取 artifactId
  local name_val
  name_val=$(echo "$content" | grep -m1 '<artifactId>' | sed 's/.*<artifactId>\(.*\)<\/artifactId>.*/\1/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [[ -n "$name_val" ]] && PKG_NAME="$name_val"

  # 提取 version
  local version_val
  version_val=$(echo "$content" | grep -m1 '<version>' | sed 's/.*<version>\(.*\)<\/version>.*/\1/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  if [[ -n "$version_val" ]]; then
    PKG_VERSION="\"$version_val\""
  else
    MISSING_FIELDS+=("version")
  fi

  # 提取 description
  local desc_val
  desc_val=$(echo "$content" | grep -m1 '<description>' | sed 's/.*<description>\(.*\)<\/description>.*/\1/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  if [[ -n "$desc_val" ]]; then
    PKG_DESCRIPTION="\"$(json_escape "$desc_val")\""
  else
    MISSING_FIELDS+=("description")
  fi

  MISSING_FIELDS+=("license" "author" "scripts" "dependencies" "repository" "main")
  PROJECT_TYPE="java"
}

# Java Gradle 项目解析: build.gradle / build.gradle.kts
parse_gradle() {
  # 尝试从 settings.gradle(.kts) 提取项目名
  if [[ -f "$PROJECT_ROOT/settings.gradle" ]]; then
    local name_val
    name_val=$(grep -m1 "rootProject.name" "$PROJECT_ROOT/settings.gradle" | sed "s/.*=[[:space:]]*['\"]\\([^'\"]*\\)['\"].*/\\1/")
    [[ -n "$name_val" ]] && PKG_NAME="$name_val"
  elif [[ -f "$PROJECT_ROOT/settings.gradle.kts" ]]; then
    local name_val
    name_val=$(grep -m1 "rootProject.name" "$PROJECT_ROOT/settings.gradle.kts" | sed "s/.*=[[:space:]]*['\"]\\([^'\"]*\\)['\"].*/\\1/")
    [[ -n "$name_val" ]] && PKG_NAME="$name_val"
  fi

  # 尝试从 build.gradle 提取 version
  local gradle_file=""
  [[ -f "$PROJECT_ROOT/build.gradle" ]] && gradle_file="$PROJECT_ROOT/build.gradle"
  [[ -f "$PROJECT_ROOT/build.gradle.kts" ]] && gradle_file="$PROJECT_ROOT/build.gradle.kts"

  if [[ -n "$gradle_file" ]]; then
    local version_val
    version_val=$(grep -m1 "^version" "$gradle_file" | sed "s/.*['\"]\\([^'\"]*\\)['\"].*/\\1/" 2>/dev/null)
    if [[ -n "$version_val" ]]; then
      PKG_VERSION="\"$version_val\""
    else
      MISSING_FIELDS+=("version")
    fi
  else
    MISSING_FIELDS+=("version")
  fi

  MISSING_FIELDS+=("description" "license" "author" "scripts" "dependencies" "repository" "main")
  PROJECT_TYPE="java"
}

# ===== 解析项目配置文件（按优先级） =====
PKG_FILE="$PROJECT_ROOT/package.json"

if [[ -f "$PKG_FILE" ]]; then
  # ===== Node.js 项目: 解析 package.json =====
  HAS_PACKAGE_JSON=true
  ECOSYSTEM="node"

  # 检查 node 命令是否可用
  if command -v node &>/dev/null; then
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
    # 纯 Bash 降级: node 不可用时从 package.json 提取基础字段
    echo "警告: node 命令不可用，降级为纯 Bash 解析 package.json（精度有限）。" >&2
    local name_val version_val desc_val license_val
    name_val=$(grep -m1 '"name"' "$PKG_FILE" | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    [[ -n "$name_val" ]] && PKG_NAME="$name_val" || PKG_NAME="$PROJECT_DIR_NAME"

    version_val=$(grep -m1 '"version"' "$PKG_FILE" | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    [[ -n "$version_val" ]] && PKG_VERSION="\"$version_val\"" || MISSING_FIELDS+=("version")

    desc_val=$(grep -m1 '"description"' "$PKG_FILE" | sed 's/.*"description"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    [[ -n "$desc_val" ]] && PKG_DESCRIPTION="\"$(json_escape "$desc_val")\"" || MISSING_FIELDS+=("description")

    license_val=$(grep -m1 '"license"' "$PKG_FILE" | sed 's/.*"license"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    [[ -n "$license_val" ]] && PKG_LICENSE="\"$license_val\"" || MISSING_FIELDS+=("license")

    # 复杂字段标记为缺失
    MISSING_FIELDS+=("author" "scripts" "dependencies" "repository" "main")
  fi

elif [[ -f "$PROJECT_ROOT/Cargo.toml" ]]; then
  # ===== Rust 项目 =====
  ECOSYSTEM="rust"
  PKG_NAME="$PROJECT_DIR_NAME"
  parse_cargo_toml

elif [[ -f "$PROJECT_ROOT/go.mod" ]]; then
  # ===== Go 项目 =====
  ECOSYSTEM="go"
  PKG_NAME="$PROJECT_DIR_NAME"
  parse_go_mod

elif [[ -f "$PROJECT_ROOT/pyproject.toml" ]] || [[ -f "$PROJECT_ROOT/setup.py" ]] || [[ -f "$PROJECT_ROOT/requirements.txt" ]]; then
  # ===== Python 项目 =====
  ECOSYSTEM="python"
  PKG_NAME="$PROJECT_DIR_NAME"
  parse_python_project

elif [[ -f "$PROJECT_ROOT/pom.xml" ]]; then
  # ===== Java Maven 项目 =====
  ECOSYSTEM="java"
  PKG_NAME="$PROJECT_DIR_NAME"
  parse_pom_xml

elif [[ -f "$PROJECT_ROOT/build.gradle" ]] || [[ -f "$PROJECT_ROOT/build.gradle.kts" ]]; then
  # ===== Java Gradle 项目 =====
  ECOSYSTEM="java"
  PKG_NAME="$PROJECT_DIR_NAME"
  parse_gradle

else
  # ===== 未识别的项目 =====
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

  # 仅当 GIT_REMOTE_URL 尚未被语言解析器设置时才从 git 获取
  if [[ "$GIT_REMOTE_URL" == "null" ]]; then
    GIT_REMOTE_URL_RAW=$(git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null || echo "")
    if [[ -n "$GIT_REMOTE_URL_RAW" ]]; then
      GIT_REMOTE_URL="\"$(json_escape "$GIT_REMOTE_URL_RAW")\""
    fi
  fi

  # 检测默认分支
  GIT_DEFAULT_BRANCH_RAW=$(git -C "$PROJECT_ROOT" symbolic-ref --short HEAD 2>/dev/null || echo "main")
  GIT_DEFAULT_BRANCH="$GIT_DEFAULT_BRANCH_RAW"
else
  MISSING_FIELDS+=("git.userName" "git.userEmail" "git.remoteUrl")
fi

# ===== 生成目录树（深度 2） =====
# 排除规则覆盖多语言项目的常见构建/缓存目录
TREE_EXCLUDES='node_modules|.git|dist|coverage|.next|.nuxt|.output|__pycache__|target|vendor|venv|.venv|env|.tox|build|.gradle'

if command -v tree &>/dev/null; then
  DIR_TREE=$(tree -L 2 -I "$TREE_EXCLUDES" --dirsfirst "$PROJECT_ROOT" 2>/dev/null | head -40)
else
  # 降级: 使用 find 生成简易目录树
  DIR_TREE=$(find "$PROJECT_ROOT" -maxdepth 2 \
    -not -path '*/node_modules/*' \
    -not -path '*/.git/*' \
    -not -path '*/dist/*' \
    -not -path '*/coverage/*' \
    -not -path '*/target/*' \
    -not -path '*/vendor/*' \
    -not -path '*/venv/*' \
    -not -path '*/.venv/*' \
    -not -path '*/build/*' \
    -not -path '*/.gradle/*' \
    -not -path '*/__pycache__/*' \
    -not -name 'node_modules' \
    -not -name '.git' \
    -not -name 'target' \
    -not -name 'vendor' \
    -not -name 'venv' \
    -not -name '.venv' \
    | sort \
    | sed "s|$PROJECT_ROOT|.|" \
    | head -40)
fi

# ===== 推断项目类型（仅 Node.js 项目需要细分） =====
if [[ "$ECOSYSTEM" == "node" ]] && [[ "$PROJECT_TYPE" == "unknown" ]]; then
  if [[ "$PKG_BIN" != "null" ]] && [[ "$PKG_BIN" != "{}" ]]; then
    PROJECT_TYPE="cli"
  elif [[ "$PKG_MAIN" != "null" ]]; then
    PROJECT_TYPE="library"
  elif [[ "$HAS_PACKAGE_JSON" == "true" ]]; then
    # 检查是否有 web 应用特征（dev/start 脚本、框架依赖）
    if command -v node &>/dev/null; then
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
      else
        PROJECT_TYPE="node"
      fi
    else
      PROJECT_TYPE="node"
    fi
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
  "ecosystem": "$ECOSYSTEM",
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
  echo "  技术生态:   $ECOSYSTEM"
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
