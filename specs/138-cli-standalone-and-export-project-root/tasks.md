# Tasks — 138

## Part A
- [ ] 新建 `plugins/spec-driver/scripts/orchestrator-cli.sh`
- [ ] `chmod +x`

## Part B
- [ ] `src/cli/utils/parse-args.ts` export 子命令加 `--project-root` 解析
- [ ] `src/cli/commands/export.ts` L70 改用 `command.projectRoot ?? process.cwd()`
- [ ] EXPORT_HELP 加 `--project-root` 选项说明

## Part C
- [ ] `tests/panoramic/export-command.test.ts` 移除 process.cwd mock，改用 `projectRoot: tmpDir`

## 验证
- [ ] `npx vitest run` 零失败
- [ ] `npm run build` 零错
- [ ] `npm run repo:check` 全绿
- [ ] 手动从外部目录跑 orchestrator-cli.sh 不报 ERR_MODULE_NOT_FOUND
- [ ] Codex 对抗审查
