# 技术决策研究: 插件脚本路径发现机制修复

**Feature Branch**: `020-fix-plugin-script-path`
**Created**: 2026-03-02
**Phase**: Phase 0 Research

---

## 决策 1: SessionStart Hook 的工作目录（cwd）

### 问题

spec.md 假设 "SessionStart 事件中的工作目录为插件安装目录"。此假设是否成立？

### 结论

**部分成立，但需要修正策略。**

根据 Claude Code 官方文档和 Plugin 系统行为：

1. **Hook 输入 JSON 中包含 `cwd` 字段**：SessionStart Hook 接收的 JSON stdin 中有 `cwd` 字段，指向**用户会话的工作目录**（即用户项目路径），而非插件安装目录。
2. **`${CLAUDE_PLUGIN_ROOT}` 环境变量**：Claude Code 在执行 Plugin Hook 时会设置 `${CLAUDE_PLUGIN_ROOT}` 环境变量，指向插件的安装根目录。这是 Plugin 系统的标准机制。
3. **相对路径 `./scripts/postinstall.sh` 的解析**：当前 `hooks.json` 中的 `"command": "./scripts/postinstall.sh"` 是以相对路径形式引用脚本。根据 Plugin 系统规范，**推荐使用 `${CLAUDE_PLUGIN_ROOT}/scripts/postinstall.sh`** 以确保路径稳定性。reverse-spec 插件已采用此模式。

### 对技术方案的影响

- Hook 脚本可通过 `${CLAUDE_PLUGIN_ROOT}` 获取自身（插件）所在路径
- Hook 脚本可通过 JSON stdin 中的 `cwd` 字段获取用户项目路径
- `hooks.json` 中的命令应改用 `${CLAUDE_PLUGIN_ROOT}` 前缀以提升可靠性
- 脚本内部通过 `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` 获取自身位置的方式仍然有效且更可靠

### 替代方案

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| A. 仅依赖 `${CLAUDE_PLUGIN_ROOT}` | 官方推荐，最可靠 | 需要更新 hooks.json 格式 | **采用** |
| B. 仅依赖 `BASH_SOURCE` + `dirname` | 不依赖外部环境变量 | 仅获取脚本位置，无法直接区分 Plugin 根 vs 用户项目 | 作为 fallback |
| C. 依赖相对路径 `./scripts/` | 现有方式 | 在不同 cwd 下不可靠 | **淘汰** |

---

## 决策 2: 用户项目路径的传递机制

### 问题

SessionStart Hook 如何获取用户项目根目录，以便在 `.specify/.spec-driver-path` 中写入路径信息？

### 结论

**通过 JSON stdin 中的 `cwd` 字段获取，`$CLAUDE_PROJECT_DIR` 环境变量作为备选。**

根据 Claude Code Hook 文档：

1. **JSON stdin 的 `cwd` 字段**（首选）：所有 Hook 事件均通过 stdin 传入 JSON 数据，其中包含 `cwd` 字段，值为用户会话的工作目录绝对路径。这是最可靠的方式。
2. **`$CLAUDE_PROJECT_DIR` 环境变量**（备选）：Claude Code 也设置此环境变量指向用户项目根目录。
3. **`$PWD` / `$(pwd)`**（最终 fallback）：如果以上两种方式均不可用，`$PWD` 在 SessionStart 时通常指向用户项目目录。

### 推荐实现

```bash
# 从 stdin JSON 解析 cwd（首选）
PROJECT_DIR=$(cat /dev/stdin | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null)

# 如果 JSON 解析失败，使用环境变量
if [[ -z "$PROJECT_DIR" ]]; then
  PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
fi
```

**但考虑到 spec-driver 的零依赖约束（不依赖 python3），推荐简化方案：**

```bash
# 优先使用 CLAUDE_PROJECT_DIR 环境变量，fallback 到 PWD
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
```

### 替代方案

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| A. stdin JSON 解析 `cwd` | 最权威的数据来源 | 需要 `jq` 或 `python3` 解析 JSON，违反零依赖约束 | 淘汰 |
| B. `$CLAUDE_PROJECT_DIR` + `$PWD` fallback | 零依赖，简单可靠 | 依赖 Claude Code 设置环境变量 | **采用** |
| C. 仅使用 `$PWD` | 最简单 | 若 cwd 在 Hook 执行时非项目目录则失败 | 作为最终 fallback |

---

## 决策 3: hooks.json 命令格式升级

### 问题

当前 spec-driver 的 `hooks.json` 使用 `"command": "./scripts/postinstall.sh"` 格式，应该升级为 `${CLAUDE_PLUGIN_ROOT}` 格式吗？

### 结论

**是的，必须升级。**

证据：
- reverse-spec 插件已使用 `"command": "${CLAUDE_PLUGIN_ROOT}/scripts/postinstall.sh"` 格式
- Claude Code 官方文档推荐使用 `${CLAUDE_PLUGIN_ROOT}` 引用插件内文件
- 当前 `./scripts/postinstall.sh` 相对路径在不同 cwd 下不稳定

### 变更

```json
// 当前（不可靠）
{
  "event": "SessionStart",
  "commands": [
    { "type": "shell", "command": "./scripts/postinstall.sh" }
  ]
}

// 修改后（可靠）
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/postinstall.sh" }
        ]
      }
    ]
  }
}
```

注意：同时需要将 hooks.json 的格式从旧版（`hooks` 数组 + `event` 字段）升级为新版（`hooks` 对象 + 事件名作 key），与 reverse-spec 插件保持一致。

---

## 决策 4: SKILL.md 中脚本路径发现的 fallback 策略

### 问题

SKILL.md 中如何同时支持全局安装和源码开发两种场景？

### 结论

**双路径 fallback：先读 `.specify/.spec-driver-path`，不存在时 fallback 到相对路径。**

```bash
# 路径发现逻辑（嵌入每个引用脚本的 SKILL.md）
if [ -f .specify/.spec-driver-path ]; then
  PLUGIN_DIR=$(cat .specify/.spec-driver-path)
else
  PLUGIN_DIR="plugins/spec-driver"
fi
bash "$PLUGIN_DIR/scripts/{script_name}" --json
```

### 理由

- 全局安装场景：`.specify/.spec-driver-path` 由 SessionStart Hook 写入，包含缓存目录绝对路径
- 源码开发场景：`.specify/.spec-driver-path` 不存在（或指向源码目录），fallback 到 `plugins/spec-driver/` 相对路径
- 两种路径最终都指向包含 `scripts/` 子目录的插件根目录

---

## 决策 5: codex-skills.sh 的 REPO_ROOT 修复策略

### 问题

`codex-skills.sh` 第 9 行 `REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"` 硬编码了从脚本位置到仓库根的三级相对路径。全局安装时目录层级不同，此推算失败。

### 结论

**将 `REPO_ROOT` 改为 `PLUGIN_DIR`，从 `SCRIPT_DIR` 上推一级。**

```bash
# 当前（硬编码三级路径，全局安装场景失败）
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# 修改后（从脚本位置推算插件根目录，一级路径，任何场景均正确）
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
```

脚本中后续所有引用 `$REPO_ROOT/plugins/spec-driver/` 的路径替换为 `$PLUGIN_DIR/`。

### 理由

- 脚本位于 `{PLUGIN_DIR}/scripts/codex-skills.sh`，上一级即为插件根目录
- 无论是源码场景（`/repo/plugins/spec-driver/scripts/`）还是全局安装场景（`~/.claude/plugins/cache/.../scripts/`），上推一级均正确
- 脚本内引用 source skill 时直接使用 `$PLUGIN_DIR/skills/...` 替代 `$REPO_ROOT/plugins/spec-driver/skills/...`

---

## 决策 6: postinstall.sh 功能扩展策略

### 问题

当前 `postinstall.sh` 仅输出安装成功消息（首次安装时）。需要扩展哪些功能？

### 结论

**扩展为三合一入口：(1) 路径写入 (2) 项目初始化 (3) 首次安装提示。**

```bash
main() {
  # 1. 推算自身路径（PLUGIN_DIR）
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"

  # 2. 确定用户项目目录
  PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

  # 3. 确保 .specify/ 目录存在
  mkdir -p "$PROJECT_DIR/.specify"

  # 4. 幂等写入路径文件
  echo -n "$PLUGIN_DIR" > "$PROJECT_DIR/.specify/.spec-driver-path"

  # 5. 首次安装提示（保留现有逻辑）
  ...
}
```

### 理由

- 合并到 `postinstall.sh` 而非创建新脚本，因为 SessionStart 已绑定此文件
- 路径写入（`echo -n`）天然幂等——每次覆盖写入相同内容
- `mkdir -p` 天然幂等——目录已存在时静默成功
