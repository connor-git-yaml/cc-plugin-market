#!/usr/bin/env bash
# 从 tree-sitter-wasms npm 包获取 grammar WASM 文件
# 使用方法: bash scripts/fetch-grammars.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GRAMMARS_DIR="$PROJECT_ROOT/grammars"
TEMP_DIR=$(mktemp -d)

trap 'rm -rf "$TEMP_DIR"' EXIT

mkdir -p "$GRAMMARS_DIR"

# 需要的语言列表
LANGUAGES=("python" "go" "java" "typescript" "javascript")

echo "正在从 tree-sitter-wasms 获取 grammar WASM 文件..."

# 下载并解压 tree-sitter-wasms
(cd "$TEMP_DIR" && npm pack tree-sitter-wasms --quiet 2>/dev/null)
TARBALL=$(ls "$TEMP_DIR"/tree-sitter-wasms-*.tgz 2>/dev/null | head -1)

if [ -z "$TARBALL" ]; then
  echo "错误: 无法下载 tree-sitter-wasms 包"
  exit 1
fi

tar xzf "$TARBALL" -C "$TEMP_DIR"

WEB_TS_VERSION=$(node -e "console.log(require('$PROJECT_ROOT/node_modules/web-tree-sitter/package.json').version)")
WASMS_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TEMP_DIR/package/package.json','utf8')).version)")

echo "  web-tree-sitter: $WEB_TS_VERSION"
echo "  tree-sitter-wasms: $WASMS_VERSION"
echo ""

# 复制需要的 WASM 文件并生成 manifest
MANIFEST_GRAMMARS=""

for lang in "${LANGUAGES[@]}"; do
  WASM_FILE="tree-sitter-${lang}.wasm"
  SRC="$TEMP_DIR/package/out/$WASM_FILE"

  if [ -f "$SRC" ]; then
    cp "$SRC" "$GRAMMARS_DIR/$WASM_FILE"
    SHA256=$(shasum -a 256 "$GRAMMARS_DIR/$WASM_FILE" | awk '{print $1}')
    SIZE=$(stat -f%z "$GRAMMARS_DIR/$WASM_FILE" 2>/dev/null || stat -c%s "$GRAMMARS_DIR/$WASM_FILE" 2>/dev/null)
    SIZE_KB=$((SIZE / 1024))
    echo "  [$lang] $WASM_FILE (${SIZE_KB}KB)"

    [ -n "$MANIFEST_GRAMMARS" ] && MANIFEST_GRAMMARS="$MANIFEST_GRAMMARS,"
    MANIFEST_GRAMMARS="$MANIFEST_GRAMMARS
    \"$lang\": {
      \"wasmFile\": \"$WASM_FILE\",
      \"sha256\": \"$SHA256\"
    }"
  else
    echo "  [$lang] 警告: $WASM_FILE 未找到"
  fi
done

# 生成 manifest.json
cat > "$GRAMMARS_DIR/manifest.json" << EOF
{
  "abiVersion": 14,
  "webTreeSitterVersion": "$WEB_TS_VERSION",
  "wasmsPackageVersion": "$WASMS_VERSION",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "grammars": {$MANIFEST_GRAMMARS
  }
}
EOF

echo ""
echo "manifest.json 已生成"
TOTAL_SIZE=$(du -sh "$GRAMMARS_DIR" | awk '{print $1}')
echo "总大小: $TOTAL_SIZE"
