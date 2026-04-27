# Plan — 138: CLI 独立运行 + export --project-root

## Part A — orchestrator-cli wrapper

**新建** `plugins/spec-driver/scripts/orchestrator-cli.sh`：
```bash
#!/usr/bin/env bash
# 包装器：使 orchestrator-cli.mjs 可从任意目录运行（解决外部项目缺 zod 等依赖问题）
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
# 优先使用 plugin 自带 node_modules；如不存在则回退到主项目（开发场景）
if [ -d "$PLUGIN_ROOT/node_modules" ]; then
  export NODE_PATH="$PLUGIN_ROOT/node_modules${NODE_PATH:+:$NODE_PATH}"
elif [ -d "$PLUGIN_ROOT/../../node_modules" ]; then
  export NODE_PATH="$(cd "$PLUGIN_ROOT/../.." && pwd)/node_modules${NODE_PATH:+:$NODE_PATH}"
fi
exec node "$SCRIPT_DIR/orchestrator-cli.mjs" "$@"
```

**chmod +x**

## Part B — export 子命令加 --project-root

**parse-args.ts**：在 export 子命令解析块（约 L460）`outputDir` 之后加：
```ts
const projectRootIdx = argv.indexOf('--project-root');
const projectRoot = projectRootIdx !== -1 ? argv[projectRootIdx + 1] : undefined;
```
返回对象加 `projectRoot,`。

**export.ts** L70：
```ts
const cwd = command.projectRoot ?? process.cwd();
```
（其余 L73 / L76 已经用 `cwd` 变量，无需再改）

**EXPORT_HELP** 选项块加一行：
```
  --project-root <path>     项目根目录（默认: 当前 shell 目录）
```

## Part C — 测试简化（删 cwd mock）

`tests/panoramic/export-command.test.ts`：
- beforeEach 删除 `processCwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)` 和相关声明
- 4 个 `runExportCommand` 测试的 command 对象加 `projectRoot: tmpDir`
- 测试逻辑等价（用产品真实路径而非 mock）

## 测试方案

1. 现有 10 个测试用 `projectRoot: tmpDir` 注入 → 全过
2. 手动验证：
   ```bash
   bash plugins/spec-driver/scripts/orchestrator-cli.sh validate-config --project-root /tmp/some-project
   # 期望：正常输出，无 ERR_MODULE_NOT_FOUND
   ```

## 验证
- `npx vitest run` 零失败
- `npm run build` 零错（tsc）
- `npm run repo:check` 全绿
