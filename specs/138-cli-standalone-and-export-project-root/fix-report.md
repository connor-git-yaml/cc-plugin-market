# 修复报告 — 138: CLI 独立运行 + export --project-root

## 问题描述
两个独立但同主题的痛点（"CLI 在外部项目目录跑得通"）：

**问题 A — orchestrator-cli 不能从外部项目独立运行**
从任意非主项目目录直接 `node plugins/spec-driver/scripts/orchestrator-cli.mjs` 会触发：
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod' imported from
.../spec-driver/contracts/orchestration-schema.mjs
```
原因：ESM 解析 `zod` 时向上查找 `node_modules`，但 plugin cache 目录树里没有 zod。Spec 133/138 验证场景必须从主项目根 cd 过去再调用，对外部使用方不友好。

**问题 B — spectra export 硬编码 process.cwd**
`src/cli/commands/export.ts:70` 用 `const cwd = process.cwd()` 解析项目根。结果：
- 用户从项目外调用 `spectra export` 必报"找不到 graph.json"
- 测试只能用 `vi.spyOn(process, 'cwd')` 绕过（fix(137) 已经这么做了，掩盖了产品行为限制）
- Codex 对抗审查 fix(137) Finding 2 标记 warning 建议跟进

## 5-Why 根因追溯

| 层级 | 问题 A | 问题 B |
|------|--------|--------|
| Why 1 | CLI 抛 ERR_MODULE_NOT_FOUND | export 命令报"找不到 graph.json" |
| Why 2 | Node ESM 找不到 zod 包 | resolveGraphJsonPath 用了错误的 cwd |
| Why 3 | 调用方目录树 node_modules 不含 zod | export 强制用 process.cwd 而非 CLI 参数 |
| Why 4 | 没有显式 NODE_PATH 注入机制 | export 子命令没有 `--project-root` 参数 |
| Why 5 | 假设 CLI 总是从主项目根执行 | 假设 spectra 总在项目内运行 |

**Root Cause（共同）**：CLI 工具假设了"运行时 cwd 就是项目根"，没有为外部项目场景提供显式注入参数（NODE_PATH 或 --project-root）。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 改动 |
|------|------|
| `plugins/spec-driver/scripts/orchestrator-cli.sh` (新建) | shell wrapper：注入 `NODE_PATH=$PLUGIN_ROOT/node_modules` |
| `src/cli/utils/parse-args.ts` | export 子命令加 `--project-root` 解析（CLICommand.projectRoot 字段已存在，无需扩 type） |
| `src/cli/commands/export.ts` | `cwd = command.projectRoot ?? process.cwd()` |
| `tests/panoramic/export-command.test.ts` | 移除 `process.cwd` mock，改用 `command.projectRoot = tmpDir`（更符合产品真实调用模式） |

### 文档更新
| 文件 | 改动 |
|------|------|
| `docs/shared/agent-orchestration-overrides.md` | CLI 调用示例可改用 `bash plugins/spec-driver/scripts/orchestrator-cli.sh ...` 演示外部调用 |
| `CLAUDE.md`、`AGENTS.md` | 通过 `npm run docs:sync:agents` 同步 |

## 修复策略

**方案**：单 commit 修两个独立但同主题的问题。
- Part A：8 行 shell 脚本（注入 NODE_PATH）+ 1 行 chmod
- Part B：parse-args 新增 4 行（identical pattern with batch/etc）+ export.ts 1 行替换 + test 简化（去 cwd mock）

**回归风险**：低
- A：纯新增文件 + 文档示例，不破坏现有调用方
- B：projectRoot 默认 fallback 到 process.cwd()，向后兼容

## 验收
1. 从任意目录跑 `bash plugins/spec-driver/scripts/orchestrator-cli.sh validate-config --project-root <repo>` 应正常输出
2. `spectra export --format obsidian --project-root <repo>` 应识别该路径下的 graph.json
3. `tests/panoramic/export-command.test.ts` 改用 projectRoot 注入后仍 10/10 通过
4. `npx vitest run` 零失败 + build + repo:check 全绿
