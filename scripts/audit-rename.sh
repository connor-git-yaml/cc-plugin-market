#!/usr/bin/env bash
set -euo pipefail

# 审计脚本：扫描仓库中 reverse-spec 的残留引用
# 排除豁免目录：dist/, .git/, node_modules/, CHANGELOG*, specs/ 用户产物, _reference/

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== reverse-spec 引用审计 ==="
echo "仓库根目录: $REPO_ROOT"
echo ""

# 豁免目录和文件
EXCLUDE_ARGS=(
  --glob '!dist/'
  --glob '!.git/'
  --glob '!node_modules/'
  --glob '!CHANGELOG*'
  --glob '!_reference/'
  --glob '!package-lock.json'
  --glob '!specs/M-100-spectra-evolution/'
  --glob '!specs/099-spectra-rebrand/'
  --glob '!specs/098-fix-batch-structure/'
)

# 已知豁免（在输出中标注）
KNOWN_EXEMPTIONS=(
  "src/config/project-config.ts"  # .reverse-spec.yaml 配置文件名不改
  "src/cli/index.ts"              # deprecation 检测逻辑中的字符串
)

echo "--- 非豁免残留引用 ---"
echo ""

# 使用 rg（如可用）或 grep
if command -v rg &>/dev/null; then
  MATCHES=$(rg --no-heading --line-number "reverse.spec" "${EXCLUDE_ARGS[@]}" "$REPO_ROOT" 2>/dev/null || true)
else
  MATCHES=$(grep -rn "reverse.spec" "$REPO_ROOT" \
    --exclude-dir=dist --exclude-dir=.git --exclude-dir=node_modules \
    --exclude='CHANGELOG*' --exclude-dir=_reference \
    --exclude=package-lock.json 2>/dev/null || true)
fi

if [ -z "$MATCHES" ]; then
  echo "未发现残留引用 ✅"
  exit 0
fi

# 统计
TOTAL=$(echo "$MATCHES" | wc -l | tr -d ' ')
echo "$MATCHES"
echo ""
echo "--- 统计 ---"
echo "总引用数: $TOTAL"
echo ""

# 标注已知豁免
echo "--- 已知豁免项 ---"
for exempt in "${KNOWN_EXEMPTIONS[@]}"; do
  EXEMPT_COUNT=$(echo "$MATCHES" | grep "$exempt" | wc -l | tr -d ' ')
  if [ "$EXEMPT_COUNT" -gt 0 ]; then
    echo "  $exempt: $EXEMPT_COUNT 处（豁免）"
  fi
done

exit 0
