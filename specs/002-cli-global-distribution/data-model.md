# 数据模型：CLI 全局分发与 Skill 自动注册

**Branch**: `002-cli-global-distribution` | **Date**: 2026-02-12

## 实体定义

本功能不引入数据库或持久化实体。所有数据结构为运行时参数和配置对象。

### 1. CLICommand（运行时）

CLI 入口解析后的命令结构。

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| subcommand | `'generate' \| 'batch' \| 'diff'` | 子命令名称 |
| target | `string \| undefined` | 目标路径（generate/diff 必需） |
| specFile | `string \| undefined` | Spec 文件路径（diff 必需） |
| deep | `boolean` | 是否深度分析（generate 可选） |
| force | `boolean` | 是否强制重新生成（batch 可选） |
| outputDir | `string \| undefined` | 自定义输出目录 |
| version | `boolean` | 是否显示版本 |
| help | `boolean` | 是否显示帮助 |

### 2. InstallContext（lifecycle 脚本运行时）

安装/卸载脚本检测到的上下文信息。

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| isGlobal | `boolean` | 是否全局安装（`npm_config_global === 'true'`） |
| homeDir | `string` | 用户 HOME 目录（`os.homedir()`） |
| packageRoot | `string` | npm 包的安装根目录（`import.meta.dirname` 回溯） |
| skillsTargetDir | `string` | 目标 skill 目录（`~/.claude/skills/`） |
| lifecycleEvent | `string` | 当前生命周期事件（`postinstall` / `preuninstall`） |

### 3. SkillRegistration（文件系统状态）

注册到全局的 skill 文件映射关系。

| 源文件（包内） | 目标文件（用户目录） |
| -------------- | -------------------- |
| `src/skills-global/reverse-spec/SKILL.md` | `~/.claude/skills/reverse-spec/SKILL.md` |
| `src/skills-global/reverse-spec-batch/SKILL.md` | `~/.claude/skills/reverse-spec-batch/SKILL.md` |
| `src/skills-global/reverse-spec-diff/SKILL.md` | `~/.claude/skills/reverse-spec-diff/SKILL.md` |

## 数据流

```text
npm install -g reverse-spec
    ↓
postinstall 脚本触发
    ↓
检测 npm_config_global === 'true'
    ├── false → 跳过（本地安装不注册 skill）
    └── true
        ↓
    获取 os.homedir() → ~/.claude/skills/
        ↓
    fs.mkdirSync(~/.claude/skills/{name}/, { recursive: true })
        ↓
    fs.copyFileSync(skills-global/{name}/SKILL.md → ~/.claude/skills/{name}/SKILL.md) × 3
        ↓
    输出安装成功信息
```

```text
npm uninstall -g reverse-spec
    ↓
preuninstall 脚本触发
    ↓
检测 npm_config_global === 'true'
    ├── false → 跳过
    └── true
        ↓
    fs.rmSync(~/.claude/skills/reverse-spec/, { recursive: true, force: true }) × 3
        ↓
    输出清理完成信息
```

## CLI 命令数据流

```text
reverse-spec generate src/auth/ --deep
    ↓
解析参数 → CLICommand { subcommand: 'generate', target: 'src/auth/', deep: true }
    ↓
验证 target 路径存在
    ↓
调用 generateSpec(targetPath, { deep: true, outputDir: 'specs', projectRoot: cwd })
    ↓
输出结果到 stdout + specs/*.spec.md
```

## 与现有模型的关系

本功能不修改任何现有数据模型（CodeSkeleton、ModuleSpec、DriftReport 等）。CLI 仅作为调度层，将命令行参数转换为对现有 orchestrator 函数的调用。
