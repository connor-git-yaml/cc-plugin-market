# Research: 003-skill-init

**Date**: 2026-02-12
**Branch**: `003-skill-init`

## R1: Claude Code Skill 目录结构与发现机制

### Decision

每个 skill 目录仅需一个 SKILL.md 文件，包含 YAML frontmatter 和 markdown 指令。无需额外脚本文件。

### Rationale

官方文档明确说明：_"Skills are simple to create - just a folder with a SKILL.md file."_ SKILL.md 是唯一必需的文件。

### Key Findings

**Frontmatter 字段**:

- `name`: 可选，省略时使用目录名作为 `/slash-command` 名称
- `description`: 推荐，Claude 用来判断何时自动加载
- `allowed-tools`: 可选，指定 skill 激活时可无需权限使用的工具
- 其他可选字段: `argument-hint`, `disable-model-invocation`, `user-invocable`, `model`, `context`, `agent`, `hooks`

**Bash 代码块不自动执行**: SKILL.md 中的 bash 代码块是**指令**，告诉 Claude 应该执行什么命令。Claude 读取后通过 Bash 工具执行。这意味着「内联降级逻辑」实际上是写在指令文本中，Claude 在执行时会遵循该逻辑。

**`!`command`` 预处理语法**: 在 SKILL.md 发送给 Claude 之前执行命令并替换输出。可用于动态注入环境信息。

**`$ARGUMENTS` 变量**: 自动替换为用户输入。支持位置参数 `$0`, `$1`, `$2`。如果 SKILL.md 不包含 `$ARGUMENTS`，会自动追加到末尾。

### Alternatives Considered

- 使用独立 `run.sh` 脚本: 增加文件数量，复杂化安装逻辑，且 skill 目录结构更臃肿
- 使用 `!`command`` 预处理: 语法更强大但依赖特定 Claude Code 版本，且不如指令式写法灵活

## R2: Skill 优先级规则（关键发现）

### Decision

接受 Claude Code 的优先级规则（`enterprise > personal > project`），在安装时向用户说明。项目级安装主要面向未全局安装的场景。

### Rationale

Claude Code 的 skill 优先级是：**全局（personal）> 项目（project）**。这意味着如果用户已通过 `npm install -g` 安装了全局 skill，再用 `reverse-spec init` 安装项目级 skill 时，全局版本仍然优先。

### Impact on Design

1. `reverse-spec init`（项目级）主要服务于以下场景:
   - 未全局安装 reverse-spec 的用户
   - 想在项目中试用但不想全局安装的用户
   - 需要在项目仓库中锁定特定版本 skill 的团队
2. `reverse-spec init --global` 提供不依赖 `npm install -g` 的全局安装途径
3. 安装完成的提示信息中应说明优先级规则

### Alternatives Considered

- 使用不同的 skill 名称前缀避免冲突: 会导致用户需要记住不同的 slash command 名称，体验差
- 自动检测并警告冲突: 增加复杂度，且不改变 Claude Code 的优先级行为

## R3: 内联降级逻辑实现方案

### Decision

在 SKILL.md 的执行指令中使用 if-elif-else 结构的 bash 代码块，配合 `command -v` 检测和 `npm_config_yes=true` 环境变量。

### Rationale

- `command -v` 是 POSIX 标准，比 `which` 更可靠（跨平台、能检测 shell 内建命令）
- `npm_config_yes=true` 环境变量同时兼容 npm 6 和 npm 7+（避免 npx 安装提示）
- if-elif-else 结构在 SKILL.md 中可读性最好

### Recommended Template

```bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec generate "$TARGET_PATH" --deep
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec generate "$TARGET_PATH" --deep
else
  echo "无法找到 reverse-spec 命令" >&2
  echo "请安装: npm install -g reverse-spec" >&2
  echo "或确保 Node.js >=20.x 已安装（提供 npx）" >&2
  exit 1
fi
```

### Alternatives Considered

- 单行 `||` 链式写法: 更紧凑但可读性差，不适合 SKILL.md 中的指令文本
- 函数封装写法: 对于 SKILL.md 指令来说过度设计

## R4: SKILL.md 模板存储策略

### Decision

SKILL.md 模板内容以 TypeScript 字符串常量存储在 `src/installer/skill-templates.ts` 中，`init` 命令直接从代码生成 SKILL.md 文件，不从磁盘读取 `skills-global/` 目录。

### Rationale

1. **自包含**: `reverse-spec init` 通过 npx 运行时，模板内容已编译在 dist/ 中，无需访问源码目录
2. **版本一致性**: 模板内容与 CLI 版本绑定，避免文件路径解析的不确定性
3. **简化测试**: 可直接 import 模板常量进行单元测试
4. **保留 skills-global/**: 现有的 `src/skills-global/` 目录保留作为全局安装（postinstall）的参考源和开发参考

### Alternatives Considered

- 从 `skills-global/` 目录读取并动态替换命令: 需要运行时路径解析（`import.meta.url`），npx 场景下路径不确定
- 外部模板文件: 需要在 `files` 中包含模板，增加包体积和路径管理复杂度

## R5: 现有测试架构与重构影响

### Decision

保留现有 `skill-registrar.test.ts` 的测试模式（临时目录隔离），重构为测试新的 `skill-installer` 模块。

### Rationale

现有测试使用 `mkdtempSync` 创建临时目录，模拟注册/卸载操作，覆盖了:
- 全局安装注册（3 个 skill）
- 本地安装跳过
- 自动创建目录
- 源文件不存在时跳过
- 卸载清理 + 隔离保护
- 异常处理

重构后，核心逻辑移到 `skill-installer.ts`，测试目标改为该模块的 `installSkills()`/`removeSkills()` 函数。现有 7 个测试用例的断言逻辑大部分可复用。

### Key Test Patterns to Preserve

- 使用 `mkdtempSync` 隔离每个测试用例
- 验证文件系统操作（`existsSync`, `readFileSync`）
- 容错测试（源文件不存在、目录不存在时的行为）
- 隔离测试（不影响其他 skill）

## Sources

- [Claude Code Skills 官方文档](https://code.claude.com/docs/en/skills)
- [Anthropic Skills 仓库](https://github.com/anthropics/skills)
- [Skill 最佳实践](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [command -v 是 POSIX 标准](https://news.ycombinator.com/item?id=29027095)
- [npm 7 npx 变更](https://github.com/npm/cli/issues/3007)
