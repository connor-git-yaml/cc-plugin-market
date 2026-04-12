# 问题修复报告

## 问题描述

Codex adversarial review 发现两个 [high] 问题：
1. `plugins/spectra/scripts/postinstall.sh` 硬编码本地绝对路径，fresh marketplace install 无法启动 MCP server
2. `specs/products/spectra/` 下的产品文档内容仍是旧 reverse-spec 品牌（cp -r 遗留）

## 5-Why 根因追溯

### 问题 1: postinstall.sh 硬编码路径

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为什么 fresh install 无法启动 MCP server？ | .mcp.json 使用 `"command": "spectra"`，要求 spectra 在 PATH 中；postinstall 回退逻辑只能在特定本地路径执行 npm link |
| Why 2 | 为什么回退逻辑只走本地路径？ | postinstall.sh 直接从旧 reverse-spec/scripts/postinstall.sh 复制，后者也是硬编码本地路径的开发态脚本 |
| Why 3 | 为什么 postinstall.sh 没有被视为需要重写的文件？ | Task 23 只要求"全量更新 postinstall.sh 的品牌引用"，未要求修改安装逻辑 |
| Why 4 | 为什么开发态脚本进入了 marketplace 发布路径？ | plugins/spectra/ 是从开发仓库内的 plugins/reverse-spec/ cp -r 而来，开发便利脚本被当作发布制品 |

**Root Cause**: postinstall.sh 是为"开发者本地 npm link"场景设计的，而不是为"用户 claude plugin install"场景。两种场景的引导逻辑完全不同。

**Root Cause Chain**: fresh install 失败 → npm link 回退路径不存在 → 回退逻辑依赖本地路径 → postinstall 从开发态脚本直接复制 → 发布态场景未独立设计

### 问题 2: specs/products/spectra/ 内容仍是 reverse-spec

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为什么产品文档内容仍是 reverse-spec？ | `specs/products/spectra/` 是 `cp -r specs/products/reverse-spec/ specs/products/spectra/` 的直接产物，文件内容未被更新 |
| Why 2 | 为什么没有更新？ | Feature 099 plan.md 仅要求"复制目录"，未要求重新生成或更新文件内容 |
| Why 3 | 为什么 plan.md 遗漏了这个步骤？ | current-spec.md 是机器生成 + 人工校准的长文档，plan 预估更新成本高，加之产品内容本质上是一致的（同一工具），只做了路径/键名映射 |

**Root Cause**: 产品事实文档被当作"路径对象"复制，而非"内容需要更新的文档"处理。

**Root Cause Chain**: 文档内容不一致 → 仅复制目录未更新内容 → plan 只做了路径映射 → 文档内容重写未列入范围

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 问题 | 修复动作 |
|------|------|------|----------|
| `plugins/spectra/scripts/postinstall.sh` | L6 | `PROJECT_ROOT` 硬编码本地路径 | 重写 fallback 逻辑：改为提示用户 `npm install -g spectra-cli` |
| `plugins/spectra/.mcp.json` | - | `command: spectra` 裸命令——合理保留（靠 PATH，符合规范） | 保持不变 |
| `specs/products/spectra/current-spec.md` | 全文 | 内容仍是 reverse-spec 品牌（标题、产品名、CLI 命令名、plugin 路径） | 全文品牌替换 + 更新版本号 |
| `specs/products/spectra/_generated/entity.yaml` | 全文 | `id: reverse-spec`、`name: Reverse-Spec`、`packageName: reverse-spec` | 替换为 spectra |
| `specs/products/spectra/_generated/quality-report.json` | 全文 | `productId: reverse-spec` | 替换为 spectra |
| `specs/products/spectra/_generated/quality-report.md` | 全文 | 标题/品牌引用仍是 reverse-spec | 替换为 spectra |
| `specs/products/spectra/_generated/scorecard-report.json` | 全文 | 品牌引用 | 替换为 spectra |
| `specs/products/spectra/_generated/scorecard-report.md` | 全文 | 品牌引用 | 替换为 spectra |

### 类似模式（已评估，安全）

| 文件 | 评估结果 |
|------|----------|
| `specs/products/reverse-spec/` 整个目录 | 保留——旧版存档，用于对比历史状态 |
| `plugins/reverse-spec/scripts/postinstall.sh` | 旧 plugin stub，不影响 spectra 安装路径 |

### 同步更新清单
- 调用方: 无（postinstall.sh 是 leaf 节点）
- 测试: 无现有测试覆盖 postinstall.sh（shell 脚本）
- 文档: `plugins/spectra/README.md` 中如有 npm link 安装说明需一并检查

## 修复策略

### 问题 1 — 方案 A（推荐）：移除 npm link fallback，改为友好提示

```bash
# 修复后逻辑（移除 PROJECT_ROOT 硬编码，改为引导用户自行安装）
if command -v spectra >/dev/null 2>&1; then
  echo "[spectra] CLI 已就绪 ($(spectra --version 2>/dev/null || echo 'unknown'))" >&2
else
  echo "[spectra] CLI 未找到。请执行以下命令安装：" >&2
  echo "  npm install -g spectra-cli" >&2
  echo "安装后重新启动 Claude Code 以加载 MCP server。" >&2
fi
```

理由：marketplace 安装的用户应通过 `npm install -g spectra-cli` 安装 CLI，而不是依赖开发仓库的 npm link。postinstall.sh 的职责是"检测并引导"，不是"修复环境"。

### 问题 1 — 方案 B（备选）：使用 npx 作为 MCP server 启动降级

修改 `.mcp.json` 为 `"command": "npx", "args": ["spectra-cli", "mcp-server"]`。
此方案优点是无需全局安装，缺点是每次启动都需要网络 + npx 开销，不推荐。

### 问题 2 — 方案 A（推荐）：精确替换文档中的品牌标识符

对 current-spec.md 和 _generated/ 下各文件做以下替换：
- `Reverse-Spec` / `reverse-spec` → `Spectra` / `spectra`（内容中的品牌名）
- `packageName: reverse-spec` → `packageName: spectra-cli`
- `id: reverse-spec` → `id: spectra`
- CLI 命令示例 `reverse-spec ...` → `spectra ...`
- 路径引用 `plugins/reverse-spec/` → `plugins/spectra/`（非豁免项）
- 版本引用更新为 v3.0.0

不需要重新运行完整 spec-driver sync（成本高），直接精确替换即可。

## Spec 影响
无需更新 spec.md（本修复为配置/文档内容修正，无功能变更）。
