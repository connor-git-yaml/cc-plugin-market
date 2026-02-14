# Contract: Marketplace 结构与 Plugin 资产

**Feature Branch**: `009-plugin-marketplace`
**Date**: 2026-02-14

---

## 1. marketplace.json 契约

**文件路径**：`.claude-plugin/marketplace.json`

### 格式规范

```json
{
  "name": "cc-plugin-market",
  "owner": {
    "name": "Connor Lu"
  },
  "metadata": {
    "description": "Claude Code Plugin Marketplace — 多 plugin 集合仓库",
    "version": "1.0.0",
    "pluginRoot": "./plugins"
  },
  "plugins": [
    {
      "name": "reverse-spec",
      "source": "./plugins/reverse-spec",
      "description": "通过 AST 静态分析 + LLM 混合流水线逆向生成 Spec 文档",
      "version": "2.0.0",
      "category": "documentation",
      "tags": ["spec", "ast", "reverse-engineering", "documentation"]
    }
  ]
}
```

### 验证要求

- `name`：非空，kebab-case
- `owner.name`：非空
- `plugins`：非空数组
- `plugins[].name`：非空，kebab-case，数组内唯一
- `plugins[].source`：以 `./` 开头的相对路径，指向有效目录

---

## 2. plugin.json 契约

**文件路径**：`plugins/reverse-spec/plugin.json`

### 格式规范

```json
{
  "name": "reverse-spec",
  "version": "2.0.0",
  "description": "通过 AST 静态分析 + LLM 混合流水线，将遗留源代码逆向工程为结构化 Spec 文档",
  "author": {
    "name": "Connor Lu",
    "url": "https://github.com/connor-git-yaml"
  },
  "homepage": "https://github.com/connor-git-yaml/cc-plugin-market",
  "repository": "https://github.com/connor-git-yaml/cc-plugin-market",
  "license": "MIT",
  "keywords": ["reverse-engineering", "spec", "ast", "documentation", "claude-code"],
  "mcpServers": "./.mcp.json",
  "hooks": "./hooks/hooks.json"
}
```

### 验证要求

- `name`：必填，与 marketplace.json 中的 `plugins[].name` 一致
- `version`：semver 格式，与 marketplace.json 中的 `plugins[].version` 一致
- `mcpServers`：指向有效的 `.mcp.json` 文件
- `hooks`：指向有效的 `hooks/hooks.json` 文件

---

## 3. Skill 文件结构契约

**目录路径**：`plugins/reverse-spec/skills/`

### 文件布局

```
skills/
├── reverse-spec/
│   └── SKILL.md
├── reverse-spec-batch/
│   └── SKILL.md
└── reverse-spec-diff/
    └── SKILL.md
```

### SKILL.md 格式

每个 SKILL.md 必须包含：
1. **YAML frontmatter**：至少包含 `name` 和 `description`
2. **Markdown 正文**：工作流指令

### 内容来源

- 从 `src/skills-global/<skill-name>/SKILL.md` 复制
- 两处内容必须保持一致

---

## 4. .mcp.json 契约

**文件路径**：`plugins/reverse-spec/.mcp.json`

### 格式规范

```json
{
  "mcpServers": {
    "reverse-spec": {
      "command": "npx",
      "args": ["reverse-spec", "mcp-server"],
      "cwd": "${CLAUDE_PLUGIN_ROOT}"
    }
  }
}
```

### 行为说明

- Plugin 启用后，Claude Code 自动以子进程方式启动 MCP server
- Server 通过 stdin/stdout 进行 JSON-RPC 2.0 通信
- 使用 `npx reverse-spec mcp-server` 确保使用 npm 发布的版本
- `${CLAUDE_PLUGIN_ROOT}` 由 Claude Code 在运行时替换为 plugin 安装路径

---

## 5. hooks.json 契约

**文件路径**：`plugins/reverse-spec/hooks/hooks.json`

### 格式规范

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/postinstall.sh"
          }
        ]
      }
    ]
  }
}
```

### postinstall.sh 行为

```bash
#!/bin/bash
# 检查 reverse-spec CLI 是否可用
if ! command -v reverse-spec >/dev/null 2>&1; then
  echo "reverse-spec CLI 未安装，尝试通过 npx 使用..." >&2
fi
```

### 设计说明

- hook 仅用于环境检查和友好提示
- 不执行自动安装操作（避免在用户不知情的情况下运行 npm install）
- 失败不阻塞会话启动

---

## 6. 目录结构完整契约

### 仓库根目录

```
cc-plugin-market/                     # 仓库根目录
├── .claude-plugin/
│   └── marketplace.json              # marketplace 清单
├── plugins/
│   └── reverse-spec/                 # 第一个 plugin
│       ├── plugin.json               # plugin manifest
│       ├── skills/
│       │   ├── reverse-spec/
│       │   │   └── SKILL.md
│       │   ├── reverse-spec-batch/
│       │   │   └── SKILL.md
│       │   └── reverse-spec-diff/
│       │       └── SKILL.md
│       ├── hooks/
│       │   └── hooks.json
│       ├── scripts/
│       │   └── postinstall.sh
│       └── .mcp.json
├── src/                              # 源码（保持不变 + 新增 mcp/）
├── dist/                             # 编译输出
├── tests/                            # 测试
├── templates/                        # Handlebars 模板
└── package.json                      # npm 包配置
```
