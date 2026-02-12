# 研究报告：CLI 全局分发与 Skill 自动注册

**Branch**: `002-cli-global-distribution` | **Date**: 2026-02-12

## 决策 1：CLI 入口运行时策略

**决策**: CLI bin 入口指向编译后的 `dist/cli/index.js`，不依赖 tsx 运行时。

**理由**:
- 用户全局安装时不应需要额外安装 tsx 开发工具
- 编译后的 JS 启动更快（无运行时转译开销）
- 项目已有 `tsc` 编译流水线（`npm run build`），outDir 为 `dist/`
- `package.json` 的 `type: "module"` 和 `tsconfig.json` 的 `module: "NodeNext"` 确保 ESM 输出

**备选方案**:
- ~~使用 tsx 运行时~~：需要用户额外安装 tsx，不符合"5 分钟内开始使用"目标
- ~~使用 ts-node~~：性能差，不推荐用于生产 CLI

## 决策 2：npm lifecycle 脚本实现

**决策**: 使用 `postinstall` 和 `preuninstall` lifecycle 脚本，仅在全局安装时触发 skill 注册。

**理由**:
- npm lifecycle 脚本在 `npm install -g` 和 `npm uninstall -g` 时**确认会执行**
- 通过 `process.env.npm_config_global === 'true'` 检测全局安装
- 本地安装（`npm install`）时不触发 skill 注册，避免干扰开发环境

**关键环境变量**:
- `npm_config_global`: `'true'` 时为全局安装
- `INIT_CWD`: npm 命令执行时的原始工作目录
- `os.homedir()`: 获取用户 HOME 目录（比 `process.env.HOME` 更可靠，兼容 sudo）

## 决策 3：全局 SKILL.md 模板策略

**决策**: 在 `src/skills-global/` 中维护独立的全局版 SKILL.md，与 `skills/` 中的本地版分离。

**理由**:
- 全局版使用 `reverse-spec generate <target>` CLI 命令调用
- 本地版使用 `npx tsx ./src/core/single-spec-orchestrator.js` 相对路径调用
- 两套 SKILL.md 的指令逻辑（提示词）相同，仅调用方式不同
- 分离后修改互不影响，职责清晰

**备选方案**:
- ~~单一 SKILL.md + 运行时替换占位符~~：增加复杂度，且占位符替换容易出错
- ~~全局版也用 npx tsx + 绝对路径~~：全局安装路径因平台和 npm 配置而异，不可靠

## 决策 4：文件引用与路径解析

**决策**: lifecycle 脚本通过 `import.meta.dirname`（Node.js 20.11.0+）定位打包文件。

**理由**:
- 项目要求 Node.js 20.x+，`import.meta.dirname` 原生支持
- 比 `fileURLToPath(import.meta.url)` 更简洁
- `INIT_CWD` 在 lifecycle 脚本中可能指向错误位置（npm 的内部 node_modules），`import.meta.dirname` 更可靠

## 决策 5：package.json `files` 字段

**决策**: 显式列出要发布到 npm 的文件，包含 `dist/` 和全局 SKILL.md。

**理由**:
- 减小发布包体积（排除 tests/、specs/、.specify/ 等开发文件）
- 确保 lifecycle 脚本和 SKILL.md 包含在发布包中

**预期配置**:
```json
{
  "files": [
    "dist/",
    "src/skills-global/",
    "templates/",
    "README.md"
  ]
}
```

## 决策 6：现有 orchestrator 函数签名

CLI 直接调用现有编排器，无需包装层：

| 子命令 | 调用函数 | 签名 |
| ------ | -------- | ---- |
| `generate` | `generateSpec()` | `(targetPath: string, options?: GenerateSpecOptions) => Promise<GenerateSpecResult>` |
| `batch` | `runBatch()` | `(projectRoot: string, options?: BatchOptions) => Promise<BatchResult>` |
| `diff` | `detectDrift()` | `(specPath: string, sourcePath: string, options?: DriftOptions) => Promise<DriftReport>` |

所有函数已导出为 async，CLI 仅需解析参数并调用。

## 决策 7：参考实现 — agentskill-installer

**发现**: npm 生态中已有 `@agentskill/installer` 工具实现了类似的 Claude Code skill 自动注册功能。

**核心模式**:
1. 检测安装上下文（`npm_config_global`）
2. 使用 `os.homedir()` 获取用户目录
3. `fs.mkdirSync(dir, { recursive: true })` 创建嵌套目录
4. `fs.copyFileSync()` 复制 SKILL.md
5. 维护 `.skills-manifest.json` 跟踪已安装 skill（本项目简化：不使用 manifest）

**本项目简化**: 仅管理 3 个固定的 skill 目录，不需要通用的 manifest 机制。
