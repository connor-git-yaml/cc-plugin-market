## 仓库级同步约定

- 触及 source-of-truth、包装层、共享片段、产品生成产物后，优先运行 `npm run repo:sync`
- 提交前运行 `npm run repo:check`；仓库级 `check-plugin-sync.sh` 已退化为对该校验链路的薄壳调用
- `.specify/runs/`、`.specify/.spec-driver-path`、`.claude/settings.local.json` 属于本地运行态，保持忽略，不要当作长期人工事实源
- `.claude/commands/**`、`.specify/project-context.yaml`、`.specify/templates/**` 属于受控项目层，修改前先确认不是某个 contract/sync 入口的生成产物
