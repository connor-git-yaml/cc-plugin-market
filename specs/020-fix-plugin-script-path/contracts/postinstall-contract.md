# 契约: postinstall.sh（扩展后）

**版本**: 2.0.0（从 1.0.0 升级）
**触发方式**: SessionStart Hook 通过 `hooks.json`
**调用路径**: `${CLAUDE_PLUGIN_ROOT}/scripts/postinstall.sh`

---

## 输入

### 环境变量

| 变量 | 必需 | 来源 | 说明 |
|------|------|------|------|
| `CLAUDE_PLUGIN_ROOT` | 推荐 | Claude Code Plugin 系统 | 插件安装根目录绝对路径 |
| `CLAUDE_PROJECT_DIR` | 可选 | Claude Code 会话 | 用户项目根目录绝对路径 |
| `PWD` | 内置 | Shell | 当前工作目录（最终 fallback） |
| `HOME` | 内置 | Shell | 用户主目录 |

### stdin

SessionStart Hook 会通过 stdin 传入 JSON（包含 `cwd`、`session_id` 等字段）。当前版本不解析 stdin（零依赖约束，避免引入 JSON 解析器），而是通过环境变量获取项目路径。

---

## 行为

### 执行步骤

1. **推算 PLUGIN_DIR**
   - 首选: `CLAUDE_PLUGIN_ROOT` 环境变量（如可用）
   - Fallback: `dirname "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` 从脚本位置推算

2. **确定 PROJECT_DIR**
   - 首选: `CLAUDE_PROJECT_DIR` 环境变量（如可用）
   - Fallback: `$(pwd)`（SessionStart 时的工作目录）

3. **验证 PLUGIN_DIR**
   - 检查 `$PLUGIN_DIR/scripts/` 目录存在
   - 不存在 → stderr 输出警告，跳过路径写入，继续后续步骤

4. **确保 .specify/ 目录**
   - `mkdir -p "$PROJECT_DIR/.specify"`

5. **幂等写入路径文件**
   - `echo -n "$PLUGIN_DIR" > "$PROJECT_DIR/.specify/.spec-driver-path"`

6. **首次安装提示**（保留现有行为）
   - 检查 `$HOME/.claude/.spec-driver-installed` 标记文件
   - 不存在 → 输出安装成功消息 + 创建标记文件
   - 已存在 → 静默跳过

### 幂等性保证

- 路径写入: 每次执行覆盖写入相同路径，天然幂等
- 目录创建: `mkdir -p` 天然幂等
- 安装提示: 标记文件机制确保仅首次显示

### 错误处理

| 错误条件 | 行为 | 退出码 |
|----------|------|--------|
| PLUGIN_DIR 推算失败（scripts/ 目录不存在） | stderr 警告，跳过路径写入 | 0 |
| PROJECT_DIR 无写入权限 | stderr 警告，跳过路径写入 | 0 |
| 正常执行 | 静默或首次安装提示 | 0 |

**注意**: 所有错误情况均返回 0，不阻断 SessionStart 流程。

---

## 输出

### 文件系统副作用

| 文件 | 操作 | 条件 |
|------|------|------|
| `{PROJECT_DIR}/.specify/.spec-driver-path` | 创建/覆盖 | PLUGIN_DIR 有效 |
| `{PROJECT_DIR}/.specify/` | 创建目录 | 不存在时 |
| `$HOME/.claude/.spec-driver-installed` | 创建空文件 | 首次安装时 |

### stdout

- 首次安装: 彩色安装成功消息和使用指南
- 非首次: 无输出（静默）

### stderr

- PLUGIN_DIR 无效时: `[警告] spec-driver 插件目录无效，跳过路径写入`
- PROJECT_DIR 不可写时: `[警告] 项目目录不可写，跳过路径写入`
