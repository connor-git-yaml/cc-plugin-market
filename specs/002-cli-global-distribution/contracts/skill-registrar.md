# Skill 注册器接口契约

**Branch**: `002-cli-global-distribution` | **Date**: 2026-02-12

## 模块：`src/scripts/postinstall.ts`

### 行为规格

当 `npm install [-g] reverse-spec` 完成后自动执行。

**前置条件**:
- `process.env.npm_lifecycle_event === 'postinstall'`
- 包内 `src/skills-global/` 目录包含三个 SKILL.md 文件

**核心逻辑**:

```
1. 检测 process.env.npm_config_global
   ├── !== 'true' → 输出跳过信息，退出（exit 0）
   └── === 'true' → 继续
2. 获取 homeDir = os.homedir()
3. 获取 packageRoot = import.meta.dirname 回溯到包根目录
4. 定义 skillsTargetDir = path.join(homeDir, '.claude', 'skills')
5. 对 ['reverse-spec', 'reverse-spec-batch', 'reverse-spec-diff'] 遍历:
   a. sourceDir = path.join(packageRoot, 'src', 'skills-global', skillName)
   b. targetDir = path.join(skillsTargetDir, skillName)
   c. fs.mkdirSync(targetDir, { recursive: true })
   d. fs.copyFileSync(sourceDir/SKILL.md, targetDir/SKILL.md)
   e. 输出: "✓ 已注册: ~/.claude/skills/{skillName}/SKILL.md"
6. 输出: "reverse-spec skills 已注册到 Claude Code"
```

**错误处理**:
- 文件系统权限错误 → 输出警告信息（不中断安装）
- 源文件不存在 → 输出警告，跳过该 skill
- 所有错误均为 `console.warn()`，不调用 `process.exit(1)`

**退出码**: 始终 `0`（不阻塞 npm install）

---

## 模块：`src/scripts/preuninstall.ts`

### 行为规格

当 `npm uninstall [-g] reverse-spec` 开始前自动执行。

**前置条件**:
- `process.env.npm_lifecycle_event === 'preuninstall'`

**核心逻辑**:

```
1. 检测 process.env.npm_config_global
   ├── !== 'true' → 退出
   └── === 'true' → 继续
2. 获取 skillsTargetDir = path.join(os.homedir(), '.claude', 'skills')
3. 对 ['reverse-spec', 'reverse-spec-batch', 'reverse-spec-diff'] 遍历:
   a. targetDir = path.join(skillsTargetDir, skillName)
   b. 检查 targetDir 是否存在
   c. fs.rmSync(targetDir, { recursive: true, force: true })
   d. 输出: "✓ 已清理: ~/.claude/skills/{skillName}/"
4. 输出: "reverse-spec skills 已从 Claude Code 注销"
```

**安全保证**:
- 仅删除 reverse-spec 自身注册的 3 个目录
- 不删除 `~/.claude/skills/` 本身（可能包含其他 skill）
- 不删除 `~/.claude/` 本身（包含其他配置）
- 使用 `force: true` 避免目录不存在时抛出错误

**退出码**: 始终 `0`

---

## 全局版 SKILL.md 模板差异

### 本地版（`skills/reverse-spec/SKILL.md`）— 保持不变

```markdown
# 调用方式（现有）
npx tsx -e "
import { generateSpec } from './src/core/single-spec-orchestrator.js';
const result = await generateSpec('$TARGET_PATH', { ... });
"
```

### 全局版（`src/skills-global/reverse-spec/SKILL.md`）— 新增

```markdown
# 调用方式（全局）
reverse-spec generate $TARGET_PATH --deep
```

**差异要点**:
- 全局版使用 `reverse-spec` CLI 命令（已在 PATH 中）
- 全局版不依赖 `npx tsx` 或项目本地文件
- 全局版的 SKILL.md 指令逻辑（提示词内容、分析步骤）与本地版一致
- 仅"调用执行"部分不同

---

## 测试契约

### 单元测试：`tests/unit/skill-registrar.test.ts`

| 用例 | 输入 | 预期输出 |
| ---- | ---- | -------- |
| 全局安装时注册 skill | `npm_config_global='true'`, mock fs | 3 个 SKILL.md 被复制 |
| 本地安装时跳过 | `npm_config_global` 未设置 | 不执行复制 |
| 目标目录不存在时自动创建 | `~/.claude/skills/` 不存在 | `mkdirSync` 被调用（recursive） |
| 权限错误时不中断 | `copyFileSync` 抛出 EACCES | 输出警告，进程不退出 |
| 卸载时清理 skill | mock 已注册的目录 | 3 个目录被删除 |
| 卸载时其他 skill 不受影响 | 存在其他 skill 目录 | 仅删除 reverse-spec 相关目录 |

### 单元测试：`tests/unit/cli-commands.test.ts`

| 用例 | 输入 | 预期输出 |
| ---- | ---- | -------- |
| 解析 generate 子命令 | `['generate', 'src/']` | `{ subcommand: 'generate', target: 'src/' }` |
| 解析 batch --force | `['batch', '--force']` | `{ subcommand: 'batch', force: true }` |
| 解析 diff 子命令 | `['diff', 'a.md', 'src/']` | `{ subcommand: 'diff', specFile: 'a.md', target: 'src/' }` |
| --version 标志 | `['--version']` | 输出版本号 |
| --help 标志 | `['--help']` | 输出帮助信息 |
| 无效子命令 | `['invalid']` | 输出错误 + 帮助 |
| generate 缺少 target | `['generate']` | 输出错误信息 |
| --output-dir 选项 | `['generate', 'src/', '--output-dir', 'out/']` | `{ outputDir: 'out/' }` |
