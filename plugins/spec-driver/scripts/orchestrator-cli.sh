#!/usr/bin/env bash
# orchestrator-cli.sh
# 包装器：使 orchestrator-cli.mjs 可从任意目录运行
#
# 问题：直接 `node plugins/spec-driver/scripts/orchestrator-cli.mjs` 时，
# Node ESM 解析 zod 等依赖按 cwd 向上查找 node_modules，外部项目目录
# 通常找不到，触发 ERR_MODULE_NOT_FOUND。
#
# 方案：注入 NODE_PATH 指向插件已知有 zod 的 node_modules 位置：
#   1. plugin 目录自带 node_modules（生产安装场景）
#   2. 主项目 node_modules（仓库内开发场景）
#
# 用法：
#   bash plugins/spec-driver/scripts/orchestrator-cli.sh <command> [options]
#   bash plugins/spec-driver/scripts/orchestrator-cli.sh effective-orchestration fix --project-root /path/to/project

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

# 同时注入 plugin 自带 node_modules（生产安装场景）和主项目 node_modules（开发场景）
# 非互斥，避免 plugin/node_modules 存在但缺 zod 时漏注入主项目路径
NODE_PATH_PARTS=""
if [ -d "$PLUGIN_ROOT/node_modules" ]; then
  NODE_PATH_PARTS="$PLUGIN_ROOT/node_modules"
fi
if [ -d "$PLUGIN_ROOT/../../node_modules" ]; then
  REPO_NODE_MODULES="$(cd "$PLUGIN_ROOT/../.." && pwd)/node_modules"
  NODE_PATH_PARTS="${NODE_PATH_PARTS:+$NODE_PATH_PARTS:}$REPO_NODE_MODULES"
fi
if [ -n "$NODE_PATH_PARTS" ]; then
  export NODE_PATH="$NODE_PATH_PARTS${NODE_PATH:+:$NODE_PATH}"
fi

exec node "$SCRIPT_DIR/orchestrator-cli.mjs" "$@"
