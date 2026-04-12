# Feature 104: pretooluse-hook

## Prompt

```
/spec-driver:spec-driver-feature 104-pretooluse-hook

PreToolUse Hook 注入 + Post-commit Hook。让 Claude Code 在搜索代码前自动获得架构摘要，让 git commit 后自动增量更新图谱。

## 需求概述

### 核心能力

1. **PreToolUse Hook 注入 (`spectra install`)**
   - 在项目级 `.claude/settings.json` 中注册 hook：
     - 事件：`PreToolUse`
     - 匹配工具：`Glob`、`Grep`（即 Claude 搜索代码前触发）
     - hook 脚本路径：`_meta/hooks/spectra-context.sh`
   - hook 脚本逻辑：
     - 检查 `_meta/graph.json` 是否存在
     - 存在 → 读取 graph 元数据 + god nodes + 社区摘要 → 注入到 stdout（Claude 的 additionalContext）
     - 不存在 → 静默跳过（exit 0，不阻塞 Claude 操作）
   - 注入输出格式：
     ```
     spectra: Knowledge graph loaded ({N} nodes · {K} communities)
     God nodes: {name}({degree}), {name}({degree}), ...
     → Read specs/project/graph-report.md before searching raw files.
     ```
   - 安全约束：
     - **只写项目级** `.claude/settings.json`（非 user 级 `~/.claude/settings.json`）
     - 写入前备份原文件到 `.claude/settings.json.bak`
     - JSON merge 策略：保留已有 hooks，追加 spectra hook；不覆盖、不删除已有条目
     - hook 已存在时跳过（幂等）

2. **Post-commit Hook (`spectra install --git`)**
   - 在 `.git/hooks/post-commit` 安装钩子（追加模式，不覆盖已有钩子内容）
   - 钩子逻辑：
     - `git diff HEAD~1 HEAD --name-only` 获取变化文件列表
     - 代码文件变化 → 调用 `spectra graph` 增量更新 graph.json（纯 AST，0 token）
     - 文档文件变化 → 打印提示 `[spectra] Docs changed. Run 'spectra batch --update' to refresh.`
   - 性能要求：< 3 秒（不能阻塞 git 工作流）

3. **Uninstall 支持**
   - `spectra install --remove`：移除 `.claude/settings.json` 中的 spectra hook 条目
   - `spectra install --remove --git`：移除 `.git/hooks/post-commit` 中的 spectra 段落
   - 移除时保留其他非 spectra 的 hooks

4. **CLI 命令**
   - `spectra install [--git] [--remove]`
   - 注意：现有 `spectra init` 是 skill 安装命令（`src/installer/`），此处是 **hook 安装**，使用 `install` 子命令区分
   - 新建 `src/cli/commands/install.ts`

### 与现有系统的关系

- **Feature 101 graph.json** (`src/panoramic/graph/`)
  - `GraphJSON` 类型：hook 脚本读取此文件获取节点/社区统计
  - `buildKnowledgeGraph()` / `writeKnowledgeGraph()`：post-commit hook 调用

- **Feature 102 community-analysis** (`src/panoramic/community/`)
  - God Node 数据：hook 输出需要 god nodes 列表
  - 社区统计：hook 输出需要社区数量
  - graph-report.md 路径：hook 输出中引导 Claude 阅读

- **现有 init 命令** (`src/installer/skill-installer.ts`)
  - `installSkills()` 模式参考：递归目录创建 → 原子写入
  - `spectra init` 处理 skill 安装；`spectra install` 处理 hook 安装，两者分离

- **Claude Code Hooks 格式**
  - `.claude/settings.json` 中的 hooks 结构：
    ```json
    {
      "hooks": {
        "PreToolUse": [
          { "matcher": "Glob|Grep", "command": "bash _meta/hooks/spectra-context.sh" }
        ]
      }
    }
    ```

### 目录结构建议

```
src/hooks/
  hook-installer.ts      # .claude/settings.json hook 注册/移除
  git-hook-installer.ts  # .git/hooks/post-commit 安装/移除
  hook-script-generator.ts  # 生成 _meta/hooks/spectra-context.sh 内容
  hook-types.ts          # HookConfig / InstallOptions 类型
  index.ts               # 统一导出
src/cli/commands/
  install.ts             # spectra install [--git] [--remove] 命令
tests/unit/
  hook-installer.test.ts    # settings.json 读写测试（mock fs）
  git-hook-installer.test.ts
  hook-script-generator.test.ts
tests/integration/
  install-e2e.test.ts    # 端到端：安装 → 验证 hook 存在 → 移除 → 验证清理
```

### 约束

- **绝不写 user 级配置**：只操作项目级 `.claude/settings.json`
- settings.json 写入前必须备份（`.claude/settings.json.bak`）
- JSON merge 使用深度合并，不删除已有 hooks
- hook 脚本（`spectra-context.sh`）必须 `set -euo pipefail`、exit 0 即使 graph.json 不存在
- post-commit hook 追加模式：用 `# --- spectra begin ---` / `# --- spectra end ---` 标记段落
- `spectra install` 幂等：重复执行不产生重复条目
- 所有新增代码遵循项目现有模式：TypeScript strict、Zod schema 验证、中文注释
```

## 上下文速查

| 文件 | 作用 |
|------|------|
| `src/panoramic/graph/graph-types.ts` | GraphJSON 类型（hook 读取） |
| `src/panoramic/graph/graph-builder.ts` | buildKnowledgeGraph()（post-commit 调用） |
| `src/panoramic/community/god-node-analyzer.ts` | God Node 数据 |
| `src/installer/skill-installer.ts` | 现有 init 命令模式参考 |
| `src/cli/commands/graph.ts` | CLI 命令模式参考 |
| `.claude/settings.json` | hook 注入目标文件 |

### 里程碑上下文

- 属于 **M-100 Spectra Evolution** Phase 3
- 优先级 P3，目标版本 v3.3.0
- 前置依赖：Feature 102 (community-analysis) ✅ 已完成
- 与 Feature 103 (multi-format-export) **互不依赖**，可并行开发
