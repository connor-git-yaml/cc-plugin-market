# Spectra — Claude Code Plugin

> 当前发布版本: v4.1.1

通过 AST 静态分析 + LLM 混合流水线，将遗留源代码逆向工程为结构化 Spec 文档。

## 功能

### Skills（3 个）

| Skill | 触发方式 | 说明 |
|-------|---------|------|
| `spectra` | `/spectra <path>` | 对单个文件或目录生成 9 段式 Spec 文档 |
| `spectra-batch` | `/spectra-batch` | 批量生成整个项目的 Spec（按模块级聚合） |
| `spectra-diff` | `/spectra-diff` | 检测 Spec 与源代码之间的漂移 |

### MCP Server（4 个工具）

通过 MCP 协议暴露以下工具供 Claude Code 直接调用：

| 工具 | 说明 |
|------|------|
| `prepare` | AST 预处理 + 上下文组装（无需 API Key） |
| `generate` | 完整 Spec 生成流水线 |
| `batch` | 批量 Spec 生成 |
| `diff` | Spec 漂移检测 |

## 安装方式

### 方式一：Marketplace 安装（推荐）

1. 将本仓库添加为 Claude Code Plugin Marketplace（命令只接收一个 source 参数；marketplace 名 `cc-plugin-market` 由 `.claude-plugin/marketplace.json` 定义）：

   ```bash
   # GitHub 简写（推荐）
   claude plugin marketplace add connor-git-yaml/cc-plugin-market

   # 或使用完整 HTTPS URL
   claude plugin marketplace add https://github.com/connor-git-yaml/cc-plugin-market.git
   ```

2. 安装 Spectra plugin：

   ```bash
   claude plugin install spectra
   ```

3. 重启 Claude Code 会话，plugin 自动加载。

### 方式二：npm 全局安装

```bash
npm install -g spectra-cli
```

安装后可直接使用 CLI：

```bash
spectra generate src/auth/ --deep
spectra batch --force
spectra diff specs/auth.spec.md src/auth/
spectra mcp-server  # 启动 MCP stdio server
```

## 配置

## Skill Source Contract

- `plugins/spectra/skills/**` 是 Spectra Skill 的 **canonical source**
- `src/skills-global/**` 与 `skills/**` 是 compatibility mirrors，不再手工维护
- 同步命令：

  ```bash
  npm run spectra:sync:skills
  ```

- 校验命令：

  ```bash
  npm run spectra:check:skills
  ```

若本次改动同时触及 release contract、shared docs 或 spec-driver 包装层，优先直接运行：

```bash
npm run repo:sync
npm run repo:check
```

### 认证

支持两种认证方式（自动检测，优先级从高到低）：

1. **ANTHROPIC_API_KEY** 环境变量 — 直接 SDK 调用
2. **Claude Code CLI 订阅登录** — spawn CLI 子进程代理

### MCP Server 配置

Plugin 安装后，`.mcp.json` 自动配置 MCP server：

```json
{
  "mcpServers": {
    "spectra": {
      "command": "npx",
      "args": ["spectra", "mcp-server"],
      "cwd": "${CLAUDE_PLUGIN_ROOT}"
    }
  }
}
```

## 使用示例

```bash
# 单模块 Spec 生成
/spectra src/auth/

# 批量生成
/spectra-batch

# 漂移检测
/spectra-diff specs/auth.spec.md src/auth/
```

## Spectra Index — UnifiedGraph 索引（Feature 156）

`spectra index` 把整个项目索引为 `.spectra/unified-graph.json` snapshot，
供下游 panoramic / spectra batch / IDE 工具消费同一份图。

### 三种模式

```bash
# 1. 全量索引（首次使用 / corruption 自愈）
spectra index

# 2. 一次性增量更新（基于 git diff + caller expansion）
spectra index --incremental

# 3. 持续监听模式（chokidar + 批量 incremental，进程不退出，Ctrl+C 退出）
spectra index --watch
```

### post-commit hook 自动触发（可选，FR-15）

每次 `git commit` 完成后自动跑一次 `spectra index --incremental`，
保持 `.spectra/unified-graph.json` 与代码库同步。**不会** 阻塞 commit 流程
（脚本后台异步触发）。

```bash
# 手动安装：拷贝脚本到 .git/hooks/ 并赋可执行权限
cp plugins/spectra/hooks/post-commit.sh .git/hooks/post-commit
chmod +x .git/hooks/post-commit
```

行为说明（FR-16）：
- 仅在仓库根存在 `.spectra/` 时触发；未启用用户不受影响
- 后台异步调用，输出到 `.spectra/index-hook.log`（已被 `.gitignore` 涵盖）
- 任何失败不影响 commit 退出码（hook 始终 exit 0）

不通过 npm postinstall / install --git-hook 子命令自动安装（保持非破坏性）。

### 验证

`scripts/verify-feature-156.mjs` 提供端到端验证：跑 full → 改动 1 个文件 →
跑 incremental → canonical sort 后对比 `depends-on / calls / cross-module` 三类边
diff = 0（AC-3a / AC-3b）。

```bash
node scripts/verify-feature-156.mjs --project-root <dir>
```

## 许可证

MIT
