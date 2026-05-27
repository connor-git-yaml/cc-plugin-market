# Spec Driver 定制指引（Fork 用户）

本文档针对 **fork 了 spectra plugin 并修改 plugin name** 的用户，说明如何调整 spec-driver 的 sub-agent 配置以匹配自定义 namespace。

---

## 背景

Spec Driver 的 5 个 sub-agent（`plan` / `implement` / `verify` / `spec-review` / `quality-review`）在 frontmatter 中声明了访问 spectra MCP 工具的 namespace：

```yaml
tools: [..., mcp__plugin_spectra_spectra__context, mcp__plugin_spectra_spectra__impact]
```

这个 namespace 由 Claude Code plugin 系统根据 **plugin name** 自动生成：

```
mcp__plugin_{your-plugin-name}_spectra__{tool-name}
```

如果你将 spectra fork 并改名，需要批量更新这些 namespace。

---

## 一键替换指引

### 方法 1: sed（macOS / Linux）

假设你将 spectra plugin 改名为 `my-spectra-fork`：

```bash
# 预览变更（dry-run）
grep -rn "mcp__plugin_spectra_spectra__" plugins/spec-driver/agents/

# 执行替换（macOS）
find plugins/spec-driver/agents -name "*.md" -exec sed -i '' \
  's/mcp__plugin_spectra_spectra__/mcp__plugin_my-spectra-fork_spectra__/g' {} \;

# 执行替换（Linux）
find plugins/spec-driver/agents -name "*.md" -exec sed -i \
  's/mcp__plugin_spectra_spectra__/mcp__plugin_my-spectra-fork_spectra__/g' {} \;

# 验证替换结果
grep -rn "mcp__plugin_" plugins/spec-driver/agents/
```

### 方法 2: awk

```bash
for f in plugins/spec-driver/agents/plan.md \
         plugins/spec-driver/agents/implement.md \
         plugins/spec-driver/agents/verify.md \
         plugins/spec-driver/agents/spec-review.md \
         plugins/spec-driver/agents/quality-review.md; do
  awk '{gsub(/mcp__plugin_spectra_spectra__/, "mcp__plugin_my-spectra-fork_spectra__"); print}' \
    "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
```

### 方法 3: 使用脚本（推荐，可重复运行）

创建 `scripts/update-spectra-namespace.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

OLD_NAMESPACE="${1:-mcp__plugin_spectra_spectra__}"
NEW_NAMESPACE="${2:?需要提供新 namespace，例如: mcp__plugin_my-spectra-fork_spectra__}"

echo "替换 namespace: $OLD_NAMESPACE → $NEW_NAMESPACE"

find plugins/spec-driver/agents -name "*.md" | while read -r f; do
  if grep -q "$OLD_NAMESPACE" "$f"; then
    sed -i '' "s|${OLD_NAMESPACE}|${NEW_NAMESPACE}|g" "$f"
    echo "  已更新: $f"
  fi
done

echo "完成。验证结果："
grep -rn "mcp__plugin_" plugins/spec-driver/agents/ | head -20
```

运行：

```bash
chmod +x scripts/update-spectra-namespace.sh
bash scripts/update-spectra-namespace.sh \
  "mcp__plugin_spectra_spectra__" \
  "mcp__plugin_my-spectra-fork_spectra__"
```

---

## 受影响的文件清单

| 文件 | 需替换的工具 |
|------|------------|
| `plugins/spec-driver/agents/plan.md` | `context`, `impact` |
| `plugins/spec-driver/agents/implement.md` | `context`, `impact` |
| `plugins/spec-driver/agents/verify.md` | `detect_changes`, `impact` |
| `plugins/spec-driver/agents/spec-review.md` | `impact`, `context` |
| `plugins/spec-driver/agents/quality-review.md` | `impact`, `context` |

---

## 验证替换正确性

```bash
# 1. 不应有旧 namespace 残留
grep -rn "mcp__plugin_spectra_spectra__" plugins/spec-driver/agents/ && echo "ERROR: 旧 namespace 残留" || echo "✅ 旧 namespace 已清除"

# 2. 新 namespace 应存在于所有 5 个文件
grep -rn "mcp__plugin_my-spectra-fork_spectra__" plugins/spec-driver/agents/ | wc -l
# 预期: 至少 8 行（5 个文件共 8 个工具声明）

# 3. 验证 MCP server 名称不变（server-name 仍是 spectra）
cat plugins/spectra/.mcp.json 2>/dev/null | grep -i "spectra" || cat plugins/my-spectra-fork/.mcp.json | grep -i "spectra"
```

---

## 注意事项

- **替换的是 plugin-name 部分**，不是 server-name（`spectra`）。server-name 由 `.mcp.json` 的 server key 决定，若你的 fork 保持 server key 为 `spectra`，则 namespace 中间段仍是 `_spectra__`。
- 如果同时修改了 server key，需调整替换命令中的 `_spectra__` 部分为你的新 server key。
- 替换后运行 `npm run repo:check` 确认仓库同步状态正常。

---

## 相关文档

- [Spectra MCP 集成指引](./spectra-mcp-integration.md) — namespace 规则详细说明
- [Milestone M7 设计文档](../../docs/design/milestone-M7-spectra-mcp-productization.md)
